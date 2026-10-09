const path = require('node:path'), Module = require('node:module'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..')
const req = Module.createRequire(path.join(root, 'cloudflare/package.json'))
const h = req('./scripts/test-counted-quantity-exact-native.cjs')
async function proveReplayFailures(worker) {
  for (const tier of ['paid','free']) for (const control of ['unknown','unknown-marker','ack','tag-race','actor-race','receipt-membership']) {
    const f = await h.world(worker,tier,'zero',sql => {
      h.seed(0.3,true)(sql)
      sql.exec("UPDATE products SET stock_quantity=0.4 WHERE id=1; INSERT INTO branches(id,name,role,is_default,is_active)VALUES(2,'Storage','warehouse',0,1); INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(1,2,0.1);INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(1,2,0.1)")
    })
    try {
      const created = await f.call('/branches/transfer',{productId:1,fromBranchId:1,toBranchId:2,quantity:0.2,batchId:1,reason:'Replay source control',transfer_provenance_version:1,client_request_id:'transfer-'+control})
      assert.equal(created.status,200)
      const before=f.state(), members=f.sql.prepare('SELECT * FROM transfer_operation_members ORDER BY receipt_id,ordinal').all()
      if(control==='unknown') f.sql.exec("CREATE TRIGGER synthetic_transfer_failure BEFORE UPDATE ON branch_batch_stock BEGIN SELECT RAISE(ABORT,'synthetic unrelated transfer write failure'); END")
      if(control==='unknown-marker') f.sql.exec('CREATE TEMP TABLE unrelated_transfer(counted_quantity_conflict INTEGER CHECK(counted_quantity_conflict=1));CREATE TEMP TRIGGER unrelated_transfer_late BEFORE INSERT ON inventory_movements BEGIN INSERT INTO unrelated_transfer VALUES(0);END')
      if(control==='ack') f.loseNextCommitAcknowledgement()
      if(control==='tag-race') f.competeBeforeCommit([{sql:"INSERT INTO damaged_stock_lots(product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)VALUES(1,2,1,0,0,'opened','remove')"}])
      if(control==='actor-race') f.competeBeforeCommit([{sql:"UPDATE roles SET permissions='{}' WHERE code='admin'"}])
      if(control==='receipt-membership') f.competeBeforeCommit([{sql:"INSERT INTO product_batches(variant_product_id,batch_key,received_at,unit_cost_usd,is_active)VALUES(1,'new-empty-earlier','2025-01-01',2,1)"}])
      const result=await f.call(`/action-history/${created.json.action_history_id}/undo`,{expected_generation:0})
      assert.equal(result.status,control.startsWith('unknown')?503:control==='ack'?200:409,JSON.stringify(result.json))
      assert.deepEqual(f.sql.prepare('SELECT * FROM transfer_operation_members ORDER BY receipt_id,ordinal').all(),members)
      if(control!=='ack') {
        assert.equal(f.state().physical,before.physical)
        assert.equal(f.state().cache,before.cache)
        assert.deepEqual(f.state().movements,before.movements)
        assert.deepEqual(f.state().history,before.history)
      } else {
        const committed=f.state()
        assert.equal(committed.physical,0.3)
        assert.equal((await f.call(`/action-history/${created.json.action_history_id}/undo`,{expected_generation:0})).status,200)
        assert.deepEqual(f.state(),committed)
      }
      console.log('PASS transfer replay '+control+' '+tier)
    } finally {f.sql.close()}
  }
}
async function proveReplayTails(makeWorker, fragments) {
  for(const tier of ['paid','free']) for(const direction of ['undo','redo']) {
    let current=makeWorker()
    const factory=()=>({ensureCoreDataInvariants:current.ensureCoreDataInvariants,default:{fetch:(...args)=>current.default.fetch(...args)}})
    const f=await h.world(factory,'paid','zero',sql=>{
      h.seed(fragments,true)(sql)
      sql.exec("INSERT INTO branches(id,name,role,is_default,is_active)VALUES(2,'Storage','warehouse',0,1)")
      sql.exec('UPDATE branch_batch_stock SET quantity=1 WHERE batch_id=1')
      for(let n=2;n<=fragments;n++)sql.exec(`INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,unit_cost_usd,is_active)VALUES(${n},1,'fragment-${n}','2026-09-01',2,1);INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(${n},1,1)`)
    })
    try {
      const created=await f.call('/branches/transfer',{productId:1,fromBranchId:1,toBranchId:2,quantity:fragments,reason:'Tail boundary transfer',transfer_provenance_version:1,client_request_id:'transfer-tail'})
      assert.equal(created.status,200,JSON.stringify(created.json))
      if(direction==='redo')assert.equal((await f.call(`/action-history/${created.json.action_history_id}/undo`,{expected_generation:0})).status,200)
      f.env.PLAN_TIER=tier;current=makeWorker();await current.ensureCoreDataInvariants(f.env)
      const raw=f.env.DB, attempts=new Map(), before=f.state()
      let attempted=0,committed=false
      f.env.CACHE={get:async()=>null,put:async()=>{throw new Error('Synthetic unavailable KV')},delete:async()=>{}}
      f.sql.exec("DELETE FROM cache_versions WHERE namespace IN('stock','products')")
      const retry=(sql,params)=>{
        if(!committed)return false
        const kind=/SELECT generation,replay_state FROM transfer_operation_receipts/.test(sql)?'outcome'
          :/SELECT namespace, version FROM cache_versions/.test(sql)?'versions'
          :/INSERT INTO quota_usage/.test(sql)?'quota'
          :/INSERT INTO cache_versions/.test(sql)?'handoff'
          :/SELECT \* FROM action_history WHERE id/.test(sql)?'history':null
        if(!kind)return false
        const key=kind+':'+JSON.stringify(params),count=(attempts.get(key)||0)+1
        attempts.set(key,count);return count%2===1
      }
      const wrap=(statement,sql)=>new Proxy(statement,{get(target,key){
        if(key==='bind')return(...args)=>wrap(target.bind(...args),sql)
        if(['all','first','run'].includes(key))return(...args)=>{attempted++;return retry(sql,target.params)?Promise.reject(new Error('D1_ERROR: network reset before transfer tail')):target[key](...args)}
        return target[key]
      }})
      f.env.DB=new Proxy(raw,{get(target,key){
        if(key==='prepare')return sql=>wrap(target.prepare(sql),sql)
        if(key==='batch')return async statements=>{
          attempted+=statements.length
          if(statements.some(statement=>retry(statement.text,statement.params)))throw new Error('D1_ERROR: network reset before transfer tail')
          try{return await target.batch(statements)}finally{
            if(statements.some(statement=>/UPDATE transfer_operation_receipts SET generation/.test(statement.text)))committed=f.sql.prepare("SELECT generation FROM transfer_operation_receipts WHERE request_id='transfer-tail'").get().generation===(direction==='undo'?1:2)
          }
        }
        return target[key]
      }})
      f.loseNextCommitAcknowledgement()
      const result=await f.call(`/action-history/${created.json.action_history_id}/${direction}`,{expected_generation:direction==='undo'?0:1})
      console.log('TRANSFER_FULL_TAIL '+JSON.stringify({tier,direction,fragments,attempted,status:result.status,attempts:[...attempts]}))
      assert.ok(attempted<=(tier==='free'?50:1000))
      if(result.status===409){assert.equal(tier,'free');assert.deepEqual(f.state(),before);assert.equal(committed,false)}
      else {assert.equal(result.status,200,JSON.stringify(result.json));for(const kind of ['outcome','versions','handoff','history',...(tier==='free'?['quota']:[])])assert.ok([...attempts.keys()].some(key=>key.startsWith(kind+':')),kind)}
    }finally{f.sql.close()}
  }
}
async function proveCrossProduct(makeWorker) {
  for(const shape of ['cross-new','cross-existing']) {
    const f=await h.world(makeWorker,'paid','zero',sql=>{
      h.seed(0.5,true)(sql)
      sql.exec("INSERT INTO branches(id,name,role,is_default,is_active)VALUES(2,'Storage','warehouse',0,1);INSERT INTO products(id,name,barcode,is_active,stock_quantity,cost_price_usd,cost_price_khr)VALUES(2,'Serum','SER-1',1,0.25,99,500);INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(2,2,0.25);UPDATE product_batches SET lot_code='SOURCE-LOT' WHERE id=1")
      if(shape==='cross-existing')sql.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,unit_cost_usd,is_active)VALUES(2,2,'SOURCE-LOT','SOURCE-LOT','2026-09-01',99,1);INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(2,2,0.25)")
    })
    try {
      const stock=h.loadStockSession('lib/stockTransaction.ts'),db=h.loadStockSession('lib/db.ts').getDb(f.env)
      const before=f.sql.prepare('SELECT product_id,branch_id,quantity FROM branch_stock ORDER BY product_id,branch_id').all()
      const created=await f.call('/branches/transfer',{productId:1,fromBranchId:1,toBranchId:2,quantity:0.25,batchId:1,reason:'Cross-product cost source',transfer_provenance_version:1,client_request_id:shape})
      assert.equal(created.status,200,JSON.stringify(created.json))
      const members=f.sql.prepare('SELECT * FROM transfer_operation_members ORDER BY receipt_id,ordinal').all()
      assert.equal(members[0].destination_product_id,2)
      const costs=f.sql.prepare('SELECT unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr FROM inventory_movements ORDER BY id').all()
      await stock.executeStockTransaction(db,[{sql:'UPDATE products SET cost_price_usd=88,cost_price_khr=999'},{sql:'UPDATE product_batches SET unit_cost_usd=77'}],'once')
      for(const [direction,generation] of [['undo',0],['redo',1]]) {
        const replay=await f.call(`/action-history/${created.json.action_history_id}/${direction}`,{expected_generation:generation})
        assert.equal(replay.status,200,JSON.stringify(replay.json))
        assert.deepEqual(f.sql.prepare('SELECT * FROM transfer_operation_members ORDER BY receipt_id,ordinal').all(),members)
        assert.deepEqual(f.sql.prepare('SELECT unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr FROM inventory_movements ORDER BY id').all().slice(-costs.length),costs)
        if(direction==='undo')assert.deepEqual(f.sql.prepare('SELECT product_id,branch_id,quantity FROM branch_stock ORDER BY product_id,branch_id').all(),before)
      }
      console.log('PASS cross-product original receipt mapping and source cost '+shape)
    }finally{f.sql.close()}
  }
}
async function proveBasic(worker, tagged) {
  for (const tier of ['paid', 'free']) for (const receipt of [true, false]) for (const route of ['inventory', 'branches']) {
    const f = await h.world(worker, tier, 'zero', sql => {
      h.seed(0.3, receipt)(sql)
      sql.exec("UPDATE products SET stock_quantity=0.4 WHERE id=1; INSERT INTO branches(id,name,role,is_default,is_active)VALUES(2,'Storage','warehouse',0,1); INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(1,2,0.1)")
      if (receipt) sql.exec('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(1,2,0.1)')
    })
    try {
      if (tagged) assert.equal((await h.tag(f, 0.1, receipt, 'transfer-ordinary-tag')).status, 200)
      const result = await f.call('/' + route + '/transfer', { productId: 1, fromBranchId: 1, toBranchId: 2, quantity: tagged ? 0.3 : 0.2,
        ...(receipt ? { batchId: 1 } : {}), reason: 'Synthetic exact transfer', transfer_provenance_version: 1, client_request_id: 'fraction-transfer' })
      const after = { products: f.sql.prepare('SELECT id,stock_quantity FROM products').all(),
        branches: f.sql.prepare('SELECT product_id,branch_id,quantity FROM branch_stock ORDER BY product_id,branch_id').all(),
        receipts: f.sql.prepare('SELECT batch_id,branch_id,quantity FROM branch_batch_stock ORDER BY batch_id,branch_id').all(),
        tags: f.sql.prepare('SELECT product_id,branch_id,batch_id,quantity_remaining,condition_tag FROM damaged_stock_lots ORDER BY id').all() }
      console.log('TRANSFER_OBSERVED ' + JSON.stringify({ tier, receipt, route, tagged, status: result.status, code: result.json.code, error: result.json.error, after }))
      if (!process.argv.includes('--observe')) {
        if (tagged) { assert.equal(result.status, 409, JSON.stringify(result.json)); assert.deepEqual(after.branches.map(row => row.quantity), [0.3, 0.1]); continue }
        assert.equal(result.status, 200, JSON.stringify(result.json))
        assert.deepEqual(after.branches.map(row => row.quantity), [0.1, 0.3])
        assert.equal(after.products[0].stock_quantity, 0.4)
        const members = f.sql.prepare('SELECT * FROM transfer_operation_members ORDER BY receipt_id,ordinal').all()
        for (const [direction, generation, expected] of [['undo', 0, [0.3,0.1]], ['redo', 1, [0.1,0.3]]]) {
          const replay = await f.call(`/action-history/${result.json.action_history_id}/${direction}`, { expected_generation: generation })
          assert.equal(replay.status, 200, JSON.stringify(replay.json))
          assert.deepEqual(f.sql.prepare('SELECT quantity FROM branch_stock ORDER BY product_id,branch_id').all().map(row => row.quantity), expected)
          assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity, 0.4)
          assert.deepEqual(f.sql.prepare('SELECT * FROM transfer_operation_members ORDER BY receipt_id,ordinal').all(), members)
          if (receipt) assert.deepEqual(f.sql.prepare('SELECT quantity FROM branch_batch_stock ORDER BY batch_id,branch_id').all().map(row => row.quantity), expected)
          else assert.equal(f.sql.prepare('SELECT SUM(quantity) q FROM branch_batch_stock').get().q, 0)
        }
        console.log('PASS exact transfer, Undo, Redo and immutable provenance ' + tier + ' ' + route + ' receipt=' + receipt)
      }
    } finally { f.sql.close() }
  }
}
async function proveTiny(worker) {
  for(const tier of ['free','paid']) {
    const f=await h.world(worker,tier,'zero',sql=>{h.seed(1,false)(sql);sql.exec("INSERT INTO branches(id,name,role,is_default,is_active)VALUES(2,'Storage','warehouse',0,1)")})
    try {
      const created=await f.call('/branches/transfer',{productId:1,fromBranchId:1,toBranchId:2,quantity:1e-10,reason:'Tiny true NULL source',transfer_provenance_version:1,client_request_id:'tiny-transfer'})
      assert.equal(created.status,200,JSON.stringify(created.json))
      const member=f.sql.prepare('SELECT quantity,untracked_quantity FROM transfer_operation_members').get()
      assert.deepEqual(member,{quantity:1e-10,untracked_quantity:1e-10})
      assert.deepEqual(f.sql.prepare('SELECT quantity,batch_id FROM inventory_movements ORDER BY id').all(),[{quantity:1e-10,batch_id:null},{quantity:1e-10,batch_id:null}])
      for(const [direction,generation,expected]of[['undo',0,[1,0]],['redo',1,[0.9999999999,1e-10]]]) {
        assert.equal((await f.call(`/action-history/${created.json.action_history_id}/${direction}`,{expected_generation:generation})).status,200)
        assert.deepEqual(f.sql.prepare('SELECT quantity FROM branch_stock ORDER BY branch_id').all().map(row=>row.quantity),expected)
      }
      console.log('PASS positive tiny quantity and true NULL cost/history slices '+tier)
    }finally{f.sql.close()}
  }
}
async function proveForwardClassification(worker) {
  for(const tier of ['paid','free'])for(const route of ['branches','inventory']) {
    const f=await h.world(worker,tier,'zero',sql=>{h.seed(0.3,false)(sql);sql.exec("INSERT INTO branches(id,name,role,is_default,is_active)VALUES(2,'Storage','warehouse',0,1)")})
    try {
      const before=f.state()
      f.sql.exec('CREATE TEMP TABLE unrelated_transfer(counted_quantity_conflict INTEGER CHECK(counted_quantity_conflict=1));CREATE TEMP TRIGGER unrelated_transfer_late BEFORE INSERT ON inventory_movements BEGIN INSERT INTO unrelated_transfer VALUES(0);END')
      const result=await f.call('/'+route+'/transfer',{productId:1,fromBranchId:1,toBranchId:2,quantity:0.2,reason:'Unrelated CHECK source',transfer_provenance_version:1,client_request_id:'unrelated-transfer'})
      assert.ok(result.status>=500,JSON.stringify(result.json))
      assert.deepEqual(f.state(),before)
      assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM transfer_operation_receipts').get().n,0)
      console.log('PASS unrelated actual CHECK name is not a stock guard '+tier+' '+route)
    }finally{f.sql.close()}
  }
}
async function main() {
  const worker=await h.bundle.exports.bundleWorker()
  if(process.argv.includes('--replay-failures'))return proveReplayFailures(worker)
  if(process.argv.includes('--tails'))return proveReplayTails(worker,Number(process.env.TRANSFER_FRAGMENTS||1))
  if(process.argv.includes('--cross'))return proveCrossProduct(worker)
  if(process.argv.includes('--tiny'))return proveTiny(worker)
  if(process.argv.includes('--classification'))return proveForwardClassification(worker)
  if(process.argv.includes('--tagged'))return proveBasic(worker,true)
  await proveBasic(worker,false)
  await proveBasic(worker,true)
  await proveReplayFailures(worker)
  await proveCrossProduct(worker)
  await proveTiny(worker)
  await proveForwardClassification(worker)
  for(const fragments of [1,5,6])await proveReplayTails(worker,fragments)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
