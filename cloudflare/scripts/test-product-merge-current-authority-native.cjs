const assert = require('node:assert/strict')
const { startWorker, recorder, budgetLine, historyStep } = require('./harness/al_money_native.cjs')

async function main() {
  const initialRace=process.argv.includes('--group-initial-race'), redoRace=process.argv.includes('--group-redo-race'), postPce=process.argv.includes('--group-post-pce')
  const racePatches=initialRace?[{name:'group initial committed stock edit before first fingerprint',file:'src/routes/products.ts',from:'  const stored = JSON.parse(child.payload_json) as MergeReversal & { operationId?: unknown }',to:`  const stored = JSON.parse(child.payload_json) as MergeReversal & { operationId?: unknown }
  if (!await db.prepare("SELECT 1 FROM product_conflict_action_group_members WHERE review_id=@review AND group_ordinal=@ordinal AND status='planned' AND role='merged'").get({review:review.id,ordinal:group.ordinal})) await db.prepare('UPDATE branch_stock SET quantity=quantity+1 WHERE product_id=?').run([reversal.keeperId])`}]:redoRace?[{name:'group redo committed stock edit before first fingerprint',file:'src/lib/undoAppliers.ts',from:'    const fingerprinted = JSON.stringify({ ...refreshedReversal, fingerprintPending: false,',to:`    if (final) await db.prepare('UPDATE branch_stock SET quantity=quantity+1 WHERE product_id=?').run([refreshedReversal.keeperId])
    const fingerprinted = JSON.stringify({ ...refreshedReversal, fingerprintPending: false,`}]:[]
  const h = await startWorker({patches:[...racePatches,{name:'synthetic legacy cache entry omits new review boolean',file:'src/lib/cache.ts',
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
    if(!process.argv.includes('--held-only') && !initialRace && !redoRace && !postPce) {
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
    }
    for(const [value,manual,lot,expected] of (initialRace||redoRace||postPce?[[null,null,null,null]]:[[null,null,null,null],[0,null,null,0],[5,7.123456789012345,null,7.123456789012345],[5,null,8,8]])) {
      const p=await pair('selected',value,{manual,lot})
      const third=nextId++
      await h.db.prepare('INSERT INTO products(id,name,name_key,barcode,cost_price_usd,cost_price_khr,selling_price_usd,is_active) VALUES(?,?,?,?,9,36000,10,1)').bind(third,p.name,p.name.toLowerCase(),p.barcode).run()
      const preview=await h.call('POST','/api/products/possible-duplicates/merge-batch/preview',{manifest_version:1,resolution_version:2,client_request_id:`held-${p.keepId}`,merge_groups:[{group_key:`barcode:${p.barcode}`,member_ids:[p.keepId,p.mergeId,third]}],remove_rows:[]},`held preview ${p.keepId}`)
      assert.equal(preview.status,200,JSON.stringify(preview.body))
      const group=preview.body.page.groups[0]
      const final=await h.call('POST',`/api/products/possible-duplicates/merge-batch/reviews/${preview.body.review_id}/finalize`,{manifest_version:1,resolution_version:2,review_id:preview.body.review_id,draft_digest:preview.body.draft_digest,resolutions:[{group_key:group.group_key,keeper_id:p.keepId,barcode:{mode:'member',source_product_id:p.keepId},category_source_id:p.keepId,brand_source_id:p.keepId,unit_source_id:p.keepId}]},`held finalize ${p.keepId}`)
      assert.equal(final.status,200,JSON.stringify(final.body))
      const page=await h.call('GET',`/api/products/possible-duplicates/merge-batch/reviews/${preview.body.review_id}`,undefined,`held page ${p.keepId}`)
      proof.check(`held ${value}/${manual}/${lot} finalized authority`,()=>{assert.equal(final.body.costAuthorities?.[0]?.costAuthority?.cost_price_usd,expected,JSON.stringify(final.body));assert.equal(page.body.page.groups[0].projected_result.costAuthority.cost_price_usd,expected);assert.ok(!JSON.stringify(page.body).includes('cost_dependency'))})
      const body={review_id:preview.body.review_id,manifest_digest:final.body.manifest_digest,client_request_id:preview.body.review_id}
      let result
      for(let attempt=0;attempt<5;attempt++) {result=await h.call('POST','/api/products/possible-duplicates/merge-batch',body,`held apply ${p.keepId}/${attempt}`);if(initialRace||result.status!==200||!result.body.continuation_required)break}
      const stored=await h.one('SELECT cost_price_usd,cost_price_khr,cost_review_key FROM products WHERE id=?',p.keepId)
      proof.check(`held ${p.keepId} actual ordered apply parity`,()=>{assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.continuation_required,initialRace);assert.equal(stored.cost_price_usd,expected);assert.equal(stored.cost_price_khr,value===null?null:value*4000);assert.equal(Boolean(stored.cost_review_key),lot===null)})
      const history=await h.one('SELECT action_history_id,operation_id FROM product_conflict_action_groups WHERE review_id=?',preview.body.review_id)
      const operational=await h.one("SELECT s.payload_json FROM action_history h JOIN undo_snapshots s ON s.id=CAST(json_extract(h.undo_payload,'$.snapshot_id') AS INTEGER) WHERE h.id=?",history.action_history_id)
      const groupReceipt=JSON.parse(operational.payload_json).graph_receipt
      if(!initialRace) proof.check(`held ${p.keepId} group operational receipt identity`,()=>{assert.equal(groupReceipt.version,1);assert.equal(groupReceipt.generation,0);assert.equal(groupReceipt.operation_id,history.operation_id);assert.equal(groupReceipt.applied_prefix,2);assert.ok(Buffer.byteLength(groupReceipt.graph_state,'utf8')<=131072)})
      if(groupReceipt) console.log('GROUP_RECEIPT',JSON.stringify({keeperId:p.keepId,bytes:Buffer.byteLength(groupReceipt.graph_state,'utf8'),scopes:Object.keys(JSON.parse(groupReceipt.graph_state)).length}))
      const costChain=async()=> (await h.all('SELECT s.payload_json FROM undo_snapshots s JOIN product_conflict_action_group_members m ON m.undo_snapshot_id=s.id WHERE m.review_id=? ORDER BY m.member_ordinal',preview.body.review_id)).map(row=>JSON.parse(row.payload_json).costReviewOutcome)
      if(initialRace) {
        const before=await h.all('SELECT * FROM branch_stock WHERE product_id IN (?,?,?) ORDER BY product_id,branch_id',p.keepId,p.mergeId,third)
        const undo=await historyStep(h,history.action_history_id,'undo',0,'group initial race undo')
        const admission=await h.one('SELECT reversible,status FROM action_history WHERE id=?',history.action_history_id)
        proof.check('group initial committed edit remains intact and nonreversible',()=>{assert.equal(admission.reversible,0,JSON.stringify(admission));assert.equal(admission.status,'recorded');assert.equal(undo.status,400,JSON.stringify(undo.body));assert.equal(before.find(row=>row.product_id===p.keepId).quantity,3)})
        assert.deepEqual(await h.all('SELECT * FROM branch_stock WHERE product_id IN (?,?,?) ORDER BY product_id,branch_id',p.keepId,p.mergeId,third),before)
        break
      }
      if(postPce) {
        await h.db.prepare("INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(?,42,'manual',0)").bind(third).run()
        const before=await h.all('SELECT * FROM products WHERE id IN (?,?,?) ORDER BY id',p.keepId,p.mergeId,third), auditBefore=await h.one('SELECT COUNT(*) n FROM audit_logs')
        const undo=await historyStep(h,history.action_history_id,'undo',0,'group inactive loser new PCE undo')
        proof.check('group receipt rejects new entry in empty restored loser scope',()=>assert.equal(undo.status,409,JSON.stringify(undo.body)))
        assert.deepEqual(await h.all('SELECT * FROM products WHERE id IN (?,?,?) ORDER BY id',p.keepId,p.mergeId,third),before)
        assert.deepEqual(await h.one('SELECT COUNT(*) n FROM audit_logs'),auditBefore)
        break
      }
      const originalChain=await costChain()
      const pointer=await h.one('SELECT undo_payload FROM action_history WHERE id=?',history.action_history_id)
      const originalPointer=JSON.parse(pointer.undo_payload)
      proof.check(`held ${p.keepId} truthful current group pointer`,()=>{assert.deepEqual(Object.keys(originalPointer).sort(),['applier','generation','group_key','merge_version','operation_id','review_id','snapshot_id']);assert.equal(originalPointer.operation_id,history.operation_id);assert.equal(originalPointer.merge_version,3)})
      assert.ok(history.action_history_id)
      if(value===null) {
        const financial=()=>h.all('SELECT id,cost_price_usd,cost_review_key,is_active FROM products WHERE id IN (?,?,?) ORDER BY id',p.keepId,p.mergeId,third)
        const before=await financial(), auditBefore=await h.one('SELECT COUNT(*) count FROM audit_logs')
        const wrong={...originalPointer,operation_id:'product-merge-group-'+'0'.repeat(64)}
        await h.db.prepare('UPDATE action_history SET undo_payload=? WHERE id=?').bind(JSON.stringify(wrong),history.action_history_id).run()
        try {
          const refused=await historyStep(h,history.action_history_id,'undo',0,'held wrong group operation')
          proof.check('held real history refuses mismatched group operation',()=>assert.equal(refused.status,409,JSON.stringify(refused.body)))
          assert.deepEqual(await financial(),before);assert.deepEqual(await h.one('SELECT COUNT(*) count FROM audit_logs'),auditBefore)
        } finally {await h.db.prepare('UPDATE action_history SET undo_payload=? WHERE id=?').bind(pointer.undo_payload,history.action_history_id).run()}
        const child=await h.one('SELECT s.id,s.payload_json FROM undo_snapshots s JOIN product_conflict_action_group_members m ON m.undo_snapshot_id=s.id WHERE m.review_id=? ORDER BY m.member_ordinal DESC LIMIT 1',preview.body.review_id)
        const missing=JSON.parse(child.payload_json);delete missing.costReviewOutcome
        await h.db.prepare('UPDATE undo_snapshots SET payload_json=? WHERE id=?').bind(JSON.stringify(missing),child.id).run()
        try {
          const refused=await historyStep(h,history.action_history_id,'undo',0,'held missing child cost receipt')
          proof.check('held current history refuses missing child cost receipt',()=>assert.equal(refused.status,409,JSON.stringify(refused.body)))
          assert.deepEqual(await financial(),before);assert.deepEqual(await h.one('SELECT COUNT(*) count FROM audit_logs'),auditBefore)
        } finally {await h.db.prepare('UPDATE undo_snapshots SET payload_json=? WHERE id=?').bind(child.payload_json,child.id).run()}
      }
      let undo,redo
      for(let attempt=0;attempt<5;attempt++){undo=await historyStep(h,history.action_history_id,'undo',0,`held undo ${p.keepId}/${attempt}`);if(undo.status!==200||!undo.body.continuation_required)break}
      if(undo.status!==200)console.log('HELD_UNDO_D1',p.keepId,JSON.stringify((await h.call('GET','/__fixture/d1-errors',undefined)).body))
      if(undo.status===200&&!undo.body.continuation_required)for(let attempt=0;attempt<5;attempt++){redo=await historyStep(h,history.action_history_id,'redo',1,`held redo ${p.keepId}/${attempt}`);if(redo.status!==200||!redo.body.continuation_required)break}
      if(redoRace) {
        const before=await h.all('SELECT * FROM branch_stock WHERE product_id IN (?,?,?) ORDER BY product_id,branch_id',p.keepId,p.mergeId,third)
        const refused=await historyStep(h,history.action_history_id,'undo',2,'group redo race next undo')
        const admission=await h.one('SELECT status,reversible FROM action_history WHERE id=?',history.action_history_id)
        proof.check('group redo committed edit remains intact and cannot be adopted',()=>{assert.equal(redo.status,409,JSON.stringify(redo.body));assert.match(redo.body.error,/redo committed/);assert.equal(admission.status,'recorded');assert.equal(admission.reversible,0);assert.equal(refused.status,400,JSON.stringify(refused.body));assert.equal(before.find(row=>row.product_id===p.keepId).quantity,3)})
        assert.deepEqual(await h.all('SELECT * FROM branch_stock WHERE product_id IN (?,?,?) ORDER BY product_id,branch_id',p.keepId,p.mergeId,third),before)
        break
      }
      proof.check(`held ${p.keepId} genuine history Undo Redo`,()=>{assert.equal(undo.status,200,JSON.stringify(undo.body));assert.equal(undo.body.continuation_required,false);assert.equal(redo?.status,200,JSON.stringify(redo?.body));assert.equal(redo.body.continuation_required,false)})
      if(redo?.status===200&&!redo.body.continuation_required) {
        const freshChain=await costChain()
        if(lot===null)proof.check(`held ${p.keepId} redo creates fresh review key chain`,()=>{assert.notEqual(freshChain[0].rootKey,originalChain[0].rootKey);assert.equal(freshChain[1].beforeKey,freshChain[0].rootKey);assert.notEqual(freshChain[1].beforeKey,originalChain[0].rootKey)})
        const beforeStale=await h.all('SELECT id,cost_price_usd,cost_review_key,is_active FROM products WHERE id IN (?,?,?) ORDER BY id',p.keepId,p.mergeId,third)
        const stale=await historyStep(h,history.action_history_id,'undo',0,`held stale generation ${p.keepId}`)
        proof.check(`held ${p.keepId} stale group generation refuses`,()=>assert.equal(stale.status,409,JSON.stringify(stale.body)))
        assert.deepEqual(await h.all('SELECT id,cost_price_usd,cost_review_key,is_active FROM products WHERE id IN (?,?,?) ORDER BY id',p.keepId,p.mergeId,third),beforeStale)
        let secondUndo
        for(let attempt=0;attempt<5;attempt++){secondUndo=await historyStep(h,history.action_history_id,'undo',2,`held second undo ${p.keepId}/${attempt}`);if(secondUndo.status!==200||!secondUndo.body.continuation_required)break}
        const events=await h.all("SELECT details FROM audit_logs WHERE json_valid(details) AND json_extract(details,'$.cost_review.kind')='merge_undo' AND json_extract(details,'$.cost_review.history_id')=? ORDER BY id",history.action_history_id)
        proof.check(`held ${p.keepId} second Undo and permanent group compensation`,()=>{assert.equal(secondUndo.status,200,JSON.stringify(secondUndo.body));assert.equal(secondUndo.body.continuation_required,false);assert.equal(events.length,4);for(const row of events){const e=JSON.parse(row.details).cost_review;assert.equal(e.snapshot_id,originalPointer.snapshot_id);assert.equal(e.merge_operation_id,history.operation_id);assert.ok([0,2].includes(e.generation))}})
      }

    }
    for(const phase of (initialRace||redoRace||postPce?[]:['draft','final'])) {
      const p=await pair('selected',5,{manual:7})
      const review=await h.call('POST','/api/products/possible-duplicates/merge-batch/preview',{manifest_version:1,resolution_version:2,client_request_id:`held-stale-${p.keepId}`,merge_groups:[{group_key:`barcode:${p.barcode}`,member_ids:[p.keepId,p.mergeId]}],remove_rows:[]},`held stale preview ${phase}`)
      assert.equal(review.status,200,JSON.stringify(review.body))
      const group=review.body.page.groups[0]
      const finalize=()=>h.call('POST',`/api/products/possible-duplicates/merge-batch/reviews/${review.body.review_id}/finalize`,{manifest_version:1,resolution_version:2,review_id:review.body.review_id,draft_digest:review.body.draft_digest,resolutions:[{group_key:group.group_key,keeper_id:p.keepId,barcode:{mode:'member',source_product_id:p.keepId},category_source_id:p.keepId,brand_source_id:p.keepId,unit_source_id:p.keepId}]},`held stale finalize ${phase}`)
      const final=phase==='final'?await finalize():null
      if(final)assert.equal(final.status,200,JSON.stringify(final.body))
      await h.db.prepare("INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(?,42,'manual',0)").bind(p.mergeId).run()
      const before=await h.all('SELECT id,cost_price_usd,cost_review_key,is_active FROM products WHERE id IN (?,?) ORDER BY id',p.keepId,p.mergeId)
      const result=phase==='draft'?await finalize():await h.call('POST','/api/products/possible-duplicates/merge-batch',{review_id:review.body.review_id,manifest_digest:final.body.manifest_digest,client_request_id:review.body.review_id},'held stale apply')
      const after=await h.all('SELECT id,cost_price_usd,cost_review_key,is_active FROM products WHERE id IN (?,?) ORDER BY id',p.keepId,p.mergeId)
      proof.check(`held ${phase} PCE append invalidates without merge`,()=>{assert.equal(result.status,409,JSON.stringify(result.body));assert.deepEqual(after,before)})
    }
    budgetLine(h.metrics)
    console.log(JSON.stringify({results:proof.results}))
    if (proof.results.some(row=>!row.ok)) process.exitCode=1
  } finally { await h.mf.dispose(); console.log('DISPOSED current authority Worker') }
}
main().catch(error=>{console.error(error);process.exitCode=1})
