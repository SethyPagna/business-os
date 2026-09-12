const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const Database = require('better-sqlite3')

async function main() {
  const bundle = await build({ stdin: { contents: `
    import { Hono } from 'hono'; import inventory from './src/routes/inventory';
    import history from './src/routes/actionHistory';
    import { getDb } from './src/lib/db'; import { buildStockLedgerQuery,attachBeforeQty } from './src/lib/stockLedgerQuery';
    const app=new Hono(); app.route('/api/inventory',inventory); app.route('/api/action-history',history);
    app.get('/test-ledger',async c=>{const query=buildStockLedgerQuery({productId:1});const db=getDb(c.env);return c.json({rows:attachBeforeQty(await db.prepare(query.rowsSql).all({...query.params,limit:100,offset:0})),summary:await db.prepare(query.summarySql).get(query.params)});});export default app;`,
    resolveDir: path.join(__dirname, '..'), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    plugins: [{ name: 'fixture', setup(b) {
      b.onResolve({ filter: /lib\/auth$/ }, () => ({ path: 'auth', namespace: 'fixture' }))
      b.onResolve({ filter: /(?:broadcastHub|lib\/cache|lib\/telegram)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'ts', contents: args.path === 'auth' ? `
        export const requireAuth=async(c,next)=>{
          c.set('user',{id:Number(c.req.header('actor')||7),username:'tester',permissions:c.req.header('permissions')||'{"inventory":true}'});
          if(c.req.header('race')) {const original=c.env.DB;let raced=false;c.env.DB={prepare:original.prepare.bind(original),batch:async(statements)=>{
            if(!raced){raced=true;await original.batch([original.prepare('UPDATE branch_batch_stock SET quantity=quantity-1 WHERE batch_id=10 AND branch_id=1'),original.prepare('UPDATE branch_stock SET quantity=quantity-1 WHERE product_id=1 AND branch_id=1')]);}
            return original.batch(statements);
          }};}return next()};`
        : args.path.endsWith('cache') ? `export const bumpVersion=async()=>{};export const getVersion=async()=>0;export const cachedJson=async(c,k,t,fn)=>c.json(await fn());export const cacheKey=(...args)=>args.join(':');`
        : args.path.endsWith('telegram') ? `export const sendTelegramEvent=async()=>{};export const formatStockChangeTelegramLines=()=>[];export const formatTransferTelegramLines=()=>[];`
        : `export const broadcast=async()=>{};` }))
    } }],
  })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'], compatibilityDate: '2026-08-01' })
  try {
    const db = await mf.getD1Database('DB')
    // Build the complete migration chain in SQLite, then run the actual final
    // affected schema in native D1. Historical seed migrations exceed current
    // native compound-SELECT limits; this is not a Wrangler migration claim.
    const schema = new Database(':memory:')
    for (const file of fs.readdirSync(path.join(__dirname, '../migrations')).filter(f=>f.endsWith('.sql')).sort()) schema.exec(fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8'))
    const tables = ['users','sales','returns','sale_items','return_items','cache_versions','system_flags','branches','products','product_batches','branch_stock','branch_batch_stock','stock_session_revisions','stock_session_guards','inventory_movements','audit_logs','action_history','transfer_operation_receipts','transfer_operation_members','stock_transfers','fee_operation_receipts']
    const objects = schema.prepare("SELECT name,type,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all()
    for (const object of objects.filter(o=>tables.includes(o.tbl_name) && (o.type !== 'trigger' || o.name.startsWith('stock_revision_') || o.name.startsWith('positive_lot_') || o.name==='transfer_receipts_require_provenance_insert'))) await db.batch(split(object.sql).map(sql=>db.prepare(sql)))
    schema.close()
    await db.batch([
      db.prepare(`INSERT INTO branches(id,name,is_active) VALUES(1,'Shop',1),(2,'Warehouse',1)`),
      db.prepare(`INSERT INTO products(id,name,stock_quantity) VALUES(1,'Two dated lots',10),(2,'Other product',0)`),
      db.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,supplier_name,is_active) VALUES(10,1,'old','2026-09-02','Original supplier',1),(11,1,'new','2026-09-09','Other supplier',1),(12,2,'other','2026-09-02',NULL,1)`),
      db.prepare(`INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(10,1,3),(11,1,7)`),
      db.prepare(`INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,10)`),
    ])
    const stockState=async()=>JSON.stringify(await Promise.all(['products','product_batches','branch_stock','branch_batch_stock','inventory_movements','audit_logs','action_history'].map(table=>db.prepare('SELECT * FROM '+table).all().then(result=>result.results))))
    const preMigration=await stockState()
    await db.batch(split(fs.readFileSync(path.join(__dirname,'../migrations/0157_stock_lot_adjustment_operations.sql'),'utf8')).map(sql=>db.prepare(sql)))
    assert.equal(await stockState(),preMigration,'schema-only migration must preserve populated business rows exactly')
    const request=async(body,endpoint='/api/inventory/adjust',headers={})=>{
      const res=await mf.dispatchFetch('http://local'+endpoint,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)})
      return {status:res.status,json:await res.json()}
    }
    const base={type:'set',setScope:'lot',productId:1,branchId:1,batchId:10,reason:'Count old date',client_request_id:'set-old-lot',quantity:5}
    const first=await request(base)
    assert.equal(first.status,200,JSON.stringify(first))
    assert.equal(first.json.before.lotQuantity,3); assert.equal(first.json.after.lotQuantity,5); assert.equal(first.json.after.branchQuantity,12)
    assert.equal((await db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=11').first()).quantity,7)
    assert.equal((await db.prepare('SELECT received_at,supplier_name FROM product_batches WHERE id=10').first()).supplier_name,'Original supplier')
    const ledger=async()=>await (await mf.dispatchFetch('http://local/test-ledger')).json()
    let rows=(await ledger()).rows
    assert.equal(rows[0].movement_type,'correction_in'); assert.equal(rows[0].signed_quantity,2)
    assert.equal(rows[0].correction_lot_before,3);assert.equal(rows[0].correction_lot_after,5)
    assert.equal(rows[0].correction_branch_before,10);assert.equal(rows[0].correction_branch_after,12)
    assert.equal(rows[0].correction_history_id,first.json.action_history_id)
    assert.equal(rows[0].batch_receipt_session_count,0,'correction is not a supplier receipt or purchase')
    assert.equal(rows[0].unit_cost_usd,null)
    assert.equal((await request({},'/api/inventory/movements/'+rows[0].id+'/revert')).status,409)
    assert.equal((await request(base)).json.replayed,true)
    assert.equal((await request({...base,setScope:'branch'})).status,409)
    assert.equal((await request({...base,client_request_id:'other-product',batchId:12})).status,409)
    assert.equal((await request({...base,client_request_id:'bad-branch',branchId:999})).status,409)
    assert.equal((await request({...base,client_request_id:'new-not-allowed',batchId:'new'})).status,400)
    assert.equal((await request({...base,client_request_id:'denied-role'},undefined,{permissions:'{"inventory":"view"}'})).status,403)
    const history=first.json.action_history_id
    // Existing history API conceals unauthorized history as 404.
    assert.equal((await request({expected_generation:0},'/api/action-history/'+history+'/undo',{permissions:'{"inventory":"view"}'})).status,404)
    const otherActor=await request({...base,productId:2,batchId:12,quantity:0},undefined,{actor:'8'})
    assert.equal(otherActor.status,200,JSON.stringify(otherActor))
    assert.notEqual(otherActor.json.operation_id,first.json.operation_id,'request IDs are actor-scoped')
    const fromAbsent=await request({...base,productId:2,batchId:12,quantity:4,client_request_id:'absent-rows'},undefined,{actor:'8'})
    assert.equal(fromAbsent.status,200,JSON.stringify(fromAbsent))
    assert.equal((await request({expected_generation:0},'/api/action-history/'+fromAbsent.json.action_history_id+'/undo',{actor:'8'})).status,200)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM branch_batch_stock WHERE batch_id=12').first()).n,0)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM branch_stock WHERE product_id=2').first()).n,0)
    let undo=await request({expected_generation:0},'/api/action-history/'+history+'/undo')
    assert.equal(undo.status,200,JSON.stringify(undo))
    assert.equal((await db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=10').first()).quantity,3)
    rows=(await ledger()).rows
    assert.equal(rows[0].movement_type,'correction_out');assert.equal(rows[0].signed_quantity,-2)
    assert.equal(rows[0].correction_generation,1);assert.equal(rows[0].correction_lot_before,5);assert.equal(rows[0].correction_lot_after,3)
    const beforeGeneric=await stockState()
    assert.equal((await request({},'/api/inventory/movements/'+rows[0].id+'/revert')).status,409)
    assert.equal(await stockState(),beforeGeneric,'generic revert must not bypass exact correction history')
    assert.equal((await ledger()).summary.out_qty,2)
    assert.equal((await request({expected_generation:0},'/api/action-history/'+history+'/undo')).status,200)
    assert.equal((await request({expected_generation:1},'/api/action-history/'+history+'/redo')).status,200)
    // An intervening update back to the same numeric value is still activity:
    // durable revisions must prevent an old correction undo from overwriting it.
    await db.prepare('UPDATE branch_batch_stock SET quantity=quantity WHERE batch_id=10 AND branch_id=1').run()
    assert.equal((await request({expected_generation:2},'/api/action-history/'+history+'/undo')).status,409)
    assert.equal((await request({...base,quantity:0,client_request_id:'set-zero'})).status,200)
    assert.equal((await db.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').first()).quantity,7)
    rows=(await ledger()).rows
    assert.equal(rows[0].movement_type,'correction_out');assert.equal(rows[0].correction_generation,0)
    assert.equal(rows[0].correction_lot_after,0)
    assert.equal((await request({},'/api/inventory/movements/'+rows[0].id+'/revert')).status,409)
    assert.equal((await request({...base,quantity:0,client_request_id:'set-noop'})).status,200)
    const branch=await request({...base,setScope:'branch',quantity:9,client_request_id:'set-branch'})
    assert.equal(branch.status,200,JSON.stringify(branch));assert.equal(branch.json.after.lotQuantity,2)
    assert.equal((await request({...base,setScope:'branch',quantity:1,client_request_id:'set-shortage'})).status,409)
    assert.equal((await request({...base,quantity:4,expectedLotQuantity:9,client_request_id:'stale-preview'})).status,409)
    const countBefore=(await db.prepare('SELECT COUNT(*) n FROM stock_lot_adjustment_operations').first()).n
    assert.equal((await request({...base,quantity:4,client_request_id:'concurrent-consumer'},undefined,{race:'1'})).status,409)
    assert.equal((await db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=10').first()).quantity,1)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM stock_lot_adjustment_operations').first()).n,countBefore)
    const transfer={productId:1,fromBranchId:1,toBranchId:2,quantity:2,batchId:11,reason:'Choose newer lot',client_request_id:'native-selected-transfer',transfer_provenance_version:1}
    const moved=await request(transfer,'/api/inventory/transfer')
    assert.equal(moved.status,200,JSON.stringify(moved))
    assert.equal(moved.json.destBatchId,11)
    assert.equal((await db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=10 AND branch_id=1').first()).quantity,1)
    assert.equal((await db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=11 AND branch_id=2').first()).quantity,2)
    assert.equal((await request(transfer,'/api/inventory/transfer')).json.replayed,true)
    assert.equal((await request({...transfer,batchId:10},'/api/inventory/transfer')).status,409)
    const transferUndo=await request({expected_generation:0},'/api/action-history/'+moved.json.action_history_id+'/undo')
    assert.equal(transferUndo.status,200,JSON.stringify(transferUndo))
    assert.equal((await db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=11 AND branch_id=2').first()).quantity,0)
    // Failure after the quantity writes must roll back stock, history and receipt.
    await db.prepare("CREATE TRIGGER fixture_fail_movement BEFORE INSERT ON inventory_movements BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END").run()
    const beforeFailure=await stockState()
    assert.equal((await request({...base,quantity:4,client_request_id:'transaction-failure'})).status,409)
    assert.equal(await stockState(),beforeFailure)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM stock_lot_adjustment_operations').first()).n,countBefore)
    console.log('PASS full SQLite migration chain + native affected schema/mounted scoped set: selected lot up/down/zero/noop, branch delta, wrong identities, permission, idempotency, exact undo/redo, ABA activity guard')
  } finally { await mf.dispose() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
