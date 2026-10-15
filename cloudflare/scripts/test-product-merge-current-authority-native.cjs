const assert = require('node:assert/strict')
const { startWorker, recorder, budgetLine, historyStep } = require('./harness/al_money_native.cjs')

async function main() {
  const h = await startWorker({patches:[{name:'synthetic legacy cache entry omits new review boolean',file:'src/lib/cache.ts',
    from:'const response = new Response(JSON.stringify(value), {',
    to:"const response = new Response(JSON.stringify(value, (key, entry) => key === 'cost_needs_review' ? undefined : entry), {"}]}), proof = recorder('current merge authority')
  let nextId = 71000
  const pair = async (kind, value, { echo = false, manual = null, lot = null } = {}) => {
    const keepId = nextId++, mergeId = nextId++, name = `Authority ${keepId}`, barcode = `84500${keepId}`
    for (const [id,cost,display,code] of [[keepId,value,name,barcode],[mergeId,9,kind==='identity'?`Incoming ${mergeId}`:name,kind==='identity'?`84500${mergeId}`:barcode]]) {
      await h.db.prepare(`INSERT INTO products(id,name,name_key,barcode,cost_price_usd,cost_price_khr,purchase_price_usd,purchase_price_khr,selling_price_usd,is_active)
        VALUES(?,?,?,?,?,?,?,?,10,1)`).bind(id,display,display.toLowerCase(),code,cost,cost===null?null:cost*4000,cost,cost===null?null:cost*4000).run()
    }
    if (kind==='selected') {
      await h.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,2)').bind(keepId).run()
      await h.db.prepare('UPDATE products SET stock_quantity=2 WHERE id=?').bind(keepId).run()
    }
    if (manual !== null) await h.db.prepare("INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(?,?,'manual',0)").bind(keepId,manual).run()
    if (lot !== null) {
      await h.db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd,received_at) VALUES(?,?,'actual-receipt',1,?,'2026-10-01')").bind(mergeId+100000,mergeId,lot).run()
      await h.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,1)').bind(mergeId+100000).run()
      await h.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,1)').bind(mergeId).run()
      await h.db.prepare('UPDATE products SET stock_quantity=1 WHERE id=?').bind(mergeId).run()
    }
    return { keepId,mergeId,name,barcode,echo }
  }
  try {
    for (const value of [null,0,5]) {
      const p = await pair('identity',value,{echo:true})
      const before = await h.one('SELECT updated_at FROM products WHERE id=?',p.mergeId)
      const result = await h.call('PUT',`/api/products/${p.mergeId}`,{name:p.name,barcode:p.barcode,expected_updated_at:before.updated_at,
        cost_price_usd:9,cost_price_khr:36000,purchase_price_usd:9,purchase_price_khr:36000,selling_price_usd:15},`identity echo ${value}`)
      const stored = await h.one('SELECT cost_price_usd,cost_price_khr,cost_review_key,selling_price_usd FROM products WHERE id=?',p.keepId)
      proof.check(`identity echo ${value} preserves keeper and selling intent`,()=>{
        assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(stored.cost_price_usd,value)
        assert.equal(stored.cost_price_khr,value===null?null:value*4000);assert.ok(stored.cost_review_key);assert.equal(stored.selling_price_usd,15)
        assert.equal(result.body.item.cost_needs_review,true);assert.ok(!Object.hasOwn(result.body.item,'cost_review_key'));assert.deepEqual(result.body.product,result.body.item)
      })
    }
    for (const [value,manual,lot,expected] of [[null,null,null,null],[0,null,null,0],[5,7,null,7],[5,7.123456789012345,null,7.123456789012345],[5,null,8,8]]) {
      const p = await pair('selected',value,{manual,lot})
      const preview = await h.call('POST','/api/products/possible-duplicates/merge-batch/preview',{cases:[{
        case_key:`barcode:${p.barcode}`,cluster_type:'barcode',cluster_value:p.barcode,product_ids:[p.keepId,p.mergeId],
      }]},`selected preview ${value}/${manual}/${lot}`)
      assert.equal(preview.status,200,JSON.stringify(preview.body));assert.equal(preview.body.cases.length,1,JSON.stringify(preview.body))
      const quoted = preview.body.cases[0], actualKeeper = quoted.keep_id
      assert.equal(actualKeeper,p.keepId,'the fixture keeper is selected by its larger branch quantity')
      const apply = {client_request_id:`current-authority-${p.keepId}`,manifest_version:1,manifest_digest:preview.body.manifest_digest,
        cases:[{ordinal:quoted.ordinal,case_key:quoted.case_key,keep_id:quoted.keep_id,merge_id:quoted.merge_id,state_digest:quoted.state_digest,stock:quoted.needs_stock_choice?'merge':null}]}
      const result = await h.call('POST','/api/products/possible-duplicates/merge-batch',apply,`selected apply ${p.keepId}`)
      const stored = await h.one('SELECT cost_price_usd,cost_review_key FROM products WHERE id=?',actualKeeper)
      proof.check(`selected ${value}/${manual}/${lot} projected and stored authority`,()=>{
        assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.committedCases.length,1)
        assert.equal(stored.cost_price_usd,expected)
        assert.equal(quoted.after_by_stock_choice.merge.costAuthority?.cost_price_usd,expected,JSON.stringify(quoted.after_by_stock_choice.merge))
        assert.equal(Boolean(stored.cost_review_key),lot===null)
      })
      const beforeRetry = await h.one('SELECT COUNT(*) count FROM audit_logs')
      const retry = await h.call('POST','/api/products/possible-duplicates/merge-batch',apply,`selected exact retry ${p.keepId}`)
      const afterRetry = await h.one('SELECT COUNT(*) count FROM audit_logs')
      proof.check(`selected ${p.keepId} committed retry adds no history`,()=>{assert.equal(retry.status,200);assert.deepEqual(afterRetry,beforeRetry)})
      const history = result.body.committedCases?.[0]?.actionHistoryId
      assert.ok(history,JSON.stringify(result.body))
      if (history) {
        const undo = await historyStep(h,history,'undo',0,`current selected undo ${p.keepId}`)
        const redo = await historyStep(h,history,'redo',1,`current selected redo ${p.keepId}`)
        proof.check(`selected ${p.keepId} actual history undo redo`,()=>{assert.equal(undo.status,200,JSON.stringify(undo.body));assert.equal(redo.status,200,JSON.stringify(redo.body))})
        const replayed = await h.one('SELECT cost_price_usd,cost_review_key FROM products WHERE id=?',actualKeeper)
        proof.check(`selected ${p.keepId} redo preserves current authority`,()=>{assert.equal(replayed.cost_price_usd,expected);assert.equal(Boolean(replayed.cost_review_key),lot===null)})
      }
    }
    for (const mutation of ['append','value','baseline']) {
      const p = await pair('selected',5,{manual:7})
      const preview = await h.call('POST','/api/products/possible-duplicates/merge-batch/preview',{cases:[{case_key:`barcode:${p.barcode}`,cluster_type:'barcode',cluster_value:p.barcode,product_ids:[p.keepId,p.mergeId]}]},`selected stale preview ${mutation}`)
      assert.equal(preview.status,200,JSON.stringify(preview.body))
      const quoted=preview.body.cases[0]
      if(mutation==='append') await h.db.prepare("INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(?,42,'manual',0)").bind(p.mergeId).run()
      else await h.db.prepare(`UPDATE product_cost_entries SET ${mutation==='value'?'cost_usd=7.000000000000002':'baseline_batch_id=900000'} WHERE product_id=?`).bind(p.keepId).run()
      const before=await h.all('SELECT id,cost_price_usd,cost_review_key,is_active FROM products WHERE id IN (?,?) ORDER BY id',p.keepId,p.mergeId)
      const result=await h.call('POST','/api/products/possible-duplicates/merge-batch',{client_request_id:`stale-${p.keepId}`,manifest_version:1,manifest_digest:preview.body.manifest_digest,cases:[{ordinal:quoted.ordinal,case_key:quoted.case_key,keep_id:quoted.keep_id,merge_id:quoted.merge_id,state_digest:quoted.state_digest,stock:null}]},`selected stale ${mutation}`)
      const after=await h.all('SELECT id,cost_price_usd,cost_review_key,is_active FROM products WHERE id IN (?,?) ORDER BY id',p.keepId,p.mergeId)
      proof.check(`selected PCE ${mutation} invalidates review without merge`,()=>{assert.equal(result.status,409,JSON.stringify(result.body));assert.deepEqual(after,before)})
    }
    const hidden=await h.addEmployee(950,'hidden_merge',{products:true,'products:merge_duplicates':true,'products:edit':true,'products:image':true,product_cost_view:false,product_cost_edit:false})
    const normalRow=(row,tag)=>{assert.ok(row);assert.equal(typeof row.cost_needs_review,'boolean');assert.equal(row.cost_needs_review,tag);assert.ok(!Object.hasOwn(row,'cost_review_key'))}
    for(const [label,path,shape] of [
      ['search fresh','/api/products/search?ids=71006',body=>body.items],
      ['search legacy cached','/api/products/search?ids=71006',body=>body.items],
      ['bare list','/api/products',body=>body],
      ['bootstrap','/api/products/bootstrap?ids=71006&metadata=0',body=>body.items],
    ]) {
      const response=await h.call('GET',path,undefined,`normal ${label}`)
      proof.check(`normal ${label} boolean and no internal key`,()=>{assert.equal(response.status,200,JSON.stringify(response.body));normalRow(shape(response.body).find(row=>row.id===71006),true)})
    }
    const create=await h.call('POST','/api/products',{name:'Normal response new',barcode:'845009900001'},'normal create')
    proof.check('normal create shapes unknown review state',()=>{assert.equal(create.status,200,JSON.stringify(create.body));normalRow(create.body.item,false)})
    const variant=await h.call('POST','/api/products/variant',{name:'Normal response variant',barcode:'845009900002'},'normal variant')
    proof.check('normal variant shapes review state',()=>{assert.equal(variant.status,200,JSON.stringify(variant.body));normalRow(variant.body.item,false)})
    nextId=Math.max(nextId,Number(create.body.id||0)+1,Number(variant.body.id||0)+1)
    const current=await h.one('SELECT name,barcode,updated_at FROM products WHERE id=71006')
    const updated=await h.call('PUT','/api/products/71006',{description:'Normal response update',expected_updated_at:current.updated_at},'normal update')
    proof.check('normal update retains tag and omits key',()=>{assert.equal(updated.status,200,JSON.stringify(updated.body));normalRow(updated.body.item,true)})
    const folded=await h.call('POST','/api/products',{name:current.name,barcode:current.barcode},'normal create fold')
    proof.check('normal create fold shapes both row aliases',()=>{assert.equal(folded.status,200,JSON.stringify(folded.body));normalRow(folded.body.item,true);normalRow(folded.body.product,true)})
    const hiddenRows=await h.call('GET','/api/products/search?ids=71006',undefined,'normal hidden search',{cookie:hidden})
    proof.check('normal hidden search discloses neither review flag nor key',()=>{assert.equal(hiddenRows.status,200);assert.ok(hiddenRows.body.items.length);assert.ok(!JSON.stringify(hiddenRows.body).includes('cost_needs_review'));assert.ok(!JSON.stringify(hiddenRows.body).includes('cost_review_key'))})
    const hiddenCurrent=await h.one('SELECT updated_at FROM products WHERE id=71006')
    const hiddenUpdate=await h.call('PUT','/api/products/71006',{description:'Hidden response edit',expected_updated_at:hiddenCurrent.updated_at},'normal hidden update',{cookie:hidden})
    proof.check('normal hidden write response omits flag and internal key',()=>{assert.equal(hiddenUpdate.status,200,JSON.stringify(hiddenUpdate.body));assert.ok(!JSON.stringify(hiddenUpdate.body).includes('cost_needs_review'));assert.ok(!JSON.stringify(hiddenUpdate.body).includes('cost_review_key'))})
    const warm=await h.call('GET','/api/products/search?ids=71008',undefined,'normal cache stale warm')
    assert.equal(warm.status,200);normalRow(warm.body.items[0],true)
    await h.db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd,received_at) VALUES(250001,71008,'normal-live-lot',1,8,'2026-10-15')").run()
    const live=await h.one('SELECT cost_review_key FROM products WHERE id=71008')
    assert.equal(live.cost_review_key,null,'real received-lot trigger clears the current marker without a cache-version bump')
    const refreshed=await h.call('GET','/api/products/search?ids=71008',undefined,'normal stale cached refresh')
    proof.check('normal cached row missing field refreshes live cleared review',()=>{assert.equal(refreshed.status,200);normalRow(refreshed.body.items[0],false);assert.ok(h.metrics.findLast(row=>row.label==='normal stale cached refresh').statements<h.metrics.findLast(row=>row.label==='normal cache stale warm').statements)})
    const receiptFold=await h.call('POST','/api/products',{name:current.name,barcode:current.barcode,stock_quantity:1,branch_id:1,cost_price_usd:8,client_request_id:'normal-fold-receipt-71006',received_date:'2026-10-15'},'normal receipt fold')
    proof.check('normal receipt fold shapes both aliases after actual received-cost clear',()=>{assert.equal(receiptFold.status,200,JSON.stringify(receiptFold.body));normalRow(receiptFold.body.item,false);normalRow(receiptFold.body.product,false)})
    const denied=await h.addEmployee(951,'denied_merge',{products:true,'products:merge_duplicates':false,product_cost_view:false})
    const p=await pair('selected',null)
    const body={cases:[{case_key:`barcode:${p.barcode}`,cluster_type:'barcode',cluster_value:p.barcode,product_ids:[p.keepId,p.mergeId]}]}
    const preview=await h.call('POST','/api/products/possible-duplicates/merge-batch/preview',body,'hidden selected preview',{cookie:hidden})
    proof.check('cost-hidden selected preview omits cost authority and amounts',()=>{assert.equal(preview.status,200,JSON.stringify(preview.body));assert.ok(preview.body.cases.length);assert.ok(!JSON.stringify(preview.body).includes('costAuthority'));assert.ok(!JSON.stringify(preview.body).includes('cost_price_usd'))})
    const no=await h.call('POST','/api/products/possible-duplicates/merge-batch/preview',body,'denied selected preview',{cookie:denied})
    proof.check('selected permission denial remains enforced',()=>assert.equal(no.status,403,JSON.stringify(no.body)))
    budgetLine(h.metrics)
    console.log(JSON.stringify({results:proof.results}))
    if (proof.results.some(row=>!row.ok)) process.exitCode=1
  } finally { await h.mf.dispose(); console.log('DISPOSED current authority Worker') }
}
main().catch(error=>{console.error(error);process.exitCode=1})
