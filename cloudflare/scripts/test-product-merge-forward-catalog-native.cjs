const assert = require('node:assert/strict')
const { world, adapter, capture, load, reserve } = require('./test-product-merge-origin-plan-native.cjs')
const { planProductMergeForwardCatalog } = load('lib/productMergeForwardCatalog.ts')
const { executeStockTransaction } = load('lib/stockTransaction.ts')
const { resolveChoiceValues } = load('lib/productResolveChoices.ts')
const { planProductMergeForwardStock } = load('lib/productMergeForwardStock.ts')
const { productMergeProtocolSchemaSql } = load('lib/productMergeProtocol.ts')
const time = '2026-10-09 20:00:00'
const options = { canChangeImages: true, imageIds: [301,302], updatedAt: time }
const all = (d1, table) => d1.db.prepare(`SELECT * FROM "${table}"`).all().map(row => ({ ...row })).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
const state = d1 => Object.fromEntries(d1.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name}) => [name, all(d1, name)]))
const invariantTables = ['product_batches','branch_stock','branch_batch_stock','damaged_stock_lots','sale_items','return_items','sale_item_batch_allocations','return_item_batch_allocations','product_cost_entries','transfer_operation_members','transfer_operation_receipts','inventory_movements','action_history','undo_snapshots']
async function ready() {
  const d1 = world()
  await executeStockTransaction(adapter(d1), [{ sql: `UPDATE products SET name='Keeper',name_normalized='keeper',barcode='00123',image_path='',parent_id=2,
    selling_price_usd=8,selling_price_khr=32000,wholesale_price_usd=5,wholesale_price_khr=20000,brand='Original brand',category='Original category',unit='bottle',updated_at='2026-10-09 19:00:00' WHERE id=1;
    ` }, { sql: "UPDATE products SET barcode='123',image_path='loser-primary',selling_price_usd=9.25,selling_price_khr=37000,wholesale_price_usd=6,wholesale_price_khr=24000,updated_at='2026-10-09 19:00:00' WHERE id=2" },
    { sql: "INSERT INTO products(id,name,is_active,parent_id) VALUES(3,'Child',1,2),(4,'Unrelated',1,NULL)" },
    { sql: "INSERT INTO product_images(id,product_id,image_path,sort_order,created_at) VALUES(101,1,'shared',0,'old-a'),(102,1,'keeper-tail',1,'old-b'),(201,2,'new-first',0,'old-c'),(202,2,'shared',1,'old-d'),(203,2,'new-second',2,'old-e'),(204,2,'new-first',3,'old-f')" },
    { sql: "INSERT INTO promotion_rules(id,title,rule_type,percent_off,product_ids,updated_at) VALUES(1,'Affected','percent_off',10,'[2,1,\"2\",3,\"legacy\"]','old-p'),(2,'Unrelated','percent_off',5,'[4]','old-u'),(3,'Malformed','percent_off',0,'not-json','old-m')" },
    { sql: "INSERT INTO inventory_movements(id,product_id,product_name,branch_id,movement_type,quantity,reason) VALUES(99,2,'Original historical name',1,'add',1,'Original immutable history')" }], 'once')
  return d1
}
function checkEffects(d1, snapshot, plan) {
  for (const [field,value] of Object.entries(plan.effects.keeperPatch)) assert.equal(d1.db.prepare('SELECT * FROM products WHERE id=1').get()[field], value, field)
  for (const row of plan.effects.imageRows) assert.deepEqual({ ...d1.db.prepare('SELECT * FROM product_images WHERE id=?').get(row.id) }, row)
  assert.deepEqual(all(d1,'product_images').filter(row=>row.product_id===1).sort((a,b)=>a.sort_order-b.sort_order||a.id-b.id).map(row=>[row.id,row.image_path,row.sort_order]), [[101,'shared',0],[102,'keeper-tail',1],[301,'new-first',2],[302,'new-second',3]])
  assert.deepEqual(all(d1,'product_images').filter(row=>row.id<=102), snapshot.canonicalImageRows)
  assert.equal(d1.db.prepare('SELECT COUNT(*) n FROM product_images WHERE product_id=2').get().n,0)
  assert.equal(d1.db.prepare('SELECT parent_id FROM products WHERE id=1').get().parent_id,null)
  assert.equal(d1.db.prepare('SELECT parent_id FROM products WHERE id=3').get().parent_id,1)
  assert.equal(d1.db.prepare('SELECT product_ids FROM promotion_rules WHERE id=1').get().product_ids,'[1,3,"legacy"]')
  assert.equal(d1.db.prepare('SELECT updated_at FROM promotion_rules WHERE id=2').get().updated_at,'old-u')
  const raw = JSON.parse(plan.admissionGuards[0].params.observedCapture)
  for (const refs of Object.values(plan.beforeRefs)) for (const ref of Array.isArray(refs)?refs:[refs]) assert.equal(raw[ref.section][ref.index][0],ref.id)
}
async function positive(chosen) {
  const d1 = await ready()
  try {
    const snapshot = await capture(d1), original = JSON.stringify(snapshot), before = state(d1)
    const fields = resolveChoiceValues({ name:{custom:'Chosen name'},brand:{custom:'Chosen brand'},category:{custom:'Chosen category'},unit:{custom:'jar'},selling_price_usd:{custom:7.1234},wholesale_price_usd:{source_id:1},barcode:{source_id:2},image:{source_id:1} }, [snapshot.canonicalProduct,snapshot.duplicateProduct])
    const plan = planProductMergeForwardCatalog(snapshot,{...options,...(chosen?{keeperChoice:{follows:true,requiresProductEdit:true,fields,cost:{cost_price_usd:2.3456,cost_price_khr:1234}}}:{})})
    assert.equal(JSON.stringify(snapshot),original)
    assert.equal(plan.admissionGuards.length,2)
    assert.equal(plan.statements.some(row=>row.sql.includes('merge_source_guard')),false,'admission capture guard is never replayed after physical writes')
    assert.equal(plan.effects.keeperPatch.selling_price_usd,chosen?7.1234:9.25)
    assert.equal(plan.effects.keeperPatch.wholesale_price_usd,chosen?5:6)
    assert.equal(plan.effects.keeperPatch.cost_price_usd,chosen?2.3456:5)
    assert.equal(plan.effects.keeperPatch.cost_price_khr,chosen?1234:10000)
    assert.equal(plan.requiredPermissions.priceEdit,chosen)
    assert.equal(plan.requiredPermissions.acquisitionCostEdit,chosen)
    await executeStockTransaction(adapter(d1),[...plan.admissionGuards,...plan.statements],'once')
    checkEffects(d1,snapshot,plan)
    for(const table of invariantTables)assert.deepEqual(all(d1,table),before[table],table+' original stock/history/finance bytes unchanged')
    assert.equal(d1.db.prepare('SELECT is_active FROM products WHERE id=2').get().is_active,1,'catalog-only prerequisite does not flip lifecycle')
    assert.equal(d1.db.prepare('SELECT barcode FROM products WHERE id=2').get().barcode,chosen?'00123':'123')
    assert.equal(JSON.stringify(snapshot),original,'captured originals remain complete and unchanged')
    console.log('PASS '+(chosen?'chosen fields/cost permission metadata':'default maximum prices/identity')+': gallery ordering, child/promotion effects and original history')
  } finally { d1.db.close() }
}
async function races() {
  const rivals = ["UPDATE products SET brand='Rival' WHERE id=1", "UPDATE products SET barcode='rival' WHERE id=2", "UPDATE product_images SET sort_order=4 WHERE id=101", "UPDATE product_images SET created_at='rival' WHERE id=201", "UPDATE promotion_rules SET updated_at='rival' WHERE id=1", "UPDATE products SET updated_at='rival' WHERE id=3", "UPDATE products SET parent_id=4 WHERE id=3", "UPDATE promotion_rules SET product_ids='[1,4]' WHERE id=1", "INSERT INTO product_images(id,product_id,image_path) VALUES(301,4,'occupied')"]
  for(const sql of rivals){const d1=await ready();try{const plan=planProductMergeForwardCatalog(await capture(d1),options);await executeStockTransaction(adapter(d1),[{sql}],'once');const before=state(d1);await assert.rejects(executeStockTransaction(adapter(d1),[...plan.admissionGuards,...plan.statements],'once'),/merge_conflict_retry|merge_state_conflict/);assert.deepEqual(state(d1),before);console.log('PASS source/reservation rival rollback: '+sql)}finally{d1.db.close()}}
}
async function controls() {
  const d1=await ready()
  try {
    const snapshot=await capture(d1)
    assert.throws(()=>planProductMergeForwardCatalog(snapshot,{...options,canChangeImages:false}),/image_permission_required/)
    for(const bad of [[301],[301,301],[101,302],[0,302]])assert.throws(()=>planProductMergeForwardCatalog(snapshot,{...options,imageIds:bad}),/merge_state_conflict/)
    for(const fields of [{name:[]},{selling_price_usd:-1},{selling_price_usd:null},{brand:{}},{stock_quantity:0},{image_path:['wrong']}])assert.throws(()=>planProductMergeForwardCatalog(snapshot,{...options,keeperChoice:{follows:true,fields}}),/invalid_resolve_choices/)
    for(const cost of [{cost_price_usd:NaN},{cost_price_usd:-1},{cost_price_usd:'2'},{cost_price_usd:2,cost_price_khr:{}}])assert.throws(()=>planProductMergeForwardCatalog(snapshot,{...options,keeperChoice:{follows:true,cost}}),/invalid_merge_cost/)
    snapshot.canonicalImageRows[0].sort_order=9
    assert.throws(()=>planProductMergeForwardCatalog(snapshot,options),/merge_snapshot_incomplete/)
    console.log('PASS malformed choices/cost/reservations and in-memory source mutation refuse before writes')
  } finally {d1.db.close()}
  const wrong=await ready()
  try{const plan=planProductMergeForwardCatalog(await capture(wrong),options);await executeStockTransaction(adapter(wrong),[{sql:"UPDATE products SET brand='Rival' WHERE id=1"}],'once');await executeStockTransaction(adapter(wrong),[...plan.admissionGuards.slice(1),...plan.statements],'once');assert.equal(wrong.db.prepare('SELECT barcode FROM products WHERE id=1').get().barcode,'123');console.log('PASS removed-source-guard wrong writer demonstrably commits stale catalog effects')}finally{wrong.db.close()}
  const empty=await ready()
  try{await executeStockTransaction(adapter(empty),[{sql:'DELETE FROM product_images WHERE product_id=2'},{sql:'UPDATE products SET image_path=NULL WHERE id=2'}],'once');const plan=planProductMergeForwardCatalog(await capture(empty),{canChangeImages:false,imageIds:[],updatedAt:time});await executeStockTransaction(adapter(empty),[...plan.admissionGuards,...plan.statements],'once');assert.equal(plan.requiredPermissions.image,false);console.log('PASS image-denied no-effect merge remains admitted')}finally{empty.db.close()}
}
async function compilerOrdering() {
  const d1=await ready()
  try{d1.db.exec(productMergeProtocolSchemaSql());const snapshot=await capture(d1);const catalog=planProductMergeForwardCatalog(snapshot,options);const stock=planProductMergeForwardStock(snapshot,{planId:1000,transitionId:1001,historyId:1000,actorId:7,actorName:'Operator',requestId:'catalog-proof',requestDigest:'original-digest',origins:reserve});const statements=[...stock.statements];const derive=statements.findIndex(row=>row.sql.includes('cost_price_usd =')&&row.sql.includes('UPDATE products'));assert.ok(derive>0);statements.splice(derive,0,...catalog.statements);statements.splice(1,0,...catalog.admissionGuards.slice(1));await executeStockTransaction(adapter(d1),statements,'once');assert.equal(d1.db.prepare('SELECT cost_price_usd FROM products WHERE id=1').get().cost_price_usd,5);assert.equal(d1.db.prepare('SELECT cost_price_khr FROM products WHERE id=1').get().cost_price_khr,10000);assert.equal(d1.db.prepare('SELECT status FROM undo_snapshots WHERE id=1001').get().status,'sealed');console.log('PASS local actual stock+catalog splice before recompute/head/seal: derived6+4=>5, KHRseed and readable postcapture')}finally{d1.db.close()}
}
async function atomicAndWrongControls() {
  const late=await ready()
  try{const plan=planProductMergeForwardCatalog(await capture(late),options),before=state(late);await assert.rejects(executeStockTransaction(adapter(late),[...plan.admissionGuards,...plan.statements,{sql:"SELECT json_extract('[1]','$[catalog_late_failure]')"}],'once'));assert.deepEqual(state(late),before);console.log('PASS definite late failure rolls back catalog/images/children/promotions/sequences')}finally{late.db.close()}
  const unrelated=await ready()
  try{const plan=planProductMergeForwardCatalog(await capture(unrelated),options);await executeStockTransaction(adapter(unrelated),[{sql:"UPDATE products SET name='Unrelated changed' WHERE id=4"}],'once');await executeStockTransaction(adapter(unrelated),[...plan.admissionGuards,...plan.statements],'once');assert.equal(unrelated.db.prepare('SELECT name FROM products WHERE id=4').get().name,'Unrelated changed');console.log('PASS unrelated product mutation remains admitted and retained')}finally{unrelated.db.close()}
  for(const kind of ['wrong-gallery-order','wrong-maximum-price']){const wrong=await ready();try{const snapshot=await capture(wrong),plan=planProductMergeForwardCatalog(snapshot,options);if(kind==='wrong-gallery-order'){const insert=plan.statements.find(row=>row.sql.startsWith('INSERT INTO product_images'));const rows=JSON.parse(insert.params.catalog_rows);rows[0].sort_order=3;rows[1].sort_order=2;insert.params.catalog_rows=JSON.stringify(rows)}else{plan.statements[0].params.catalog_selling_price_usd=8}await executeStockTransaction(adapter(wrong),[...plan.admissionGuards,...plan.statements],'once');assert.throws(()=>checkEffects(wrong,snapshot,plan),assert.AssertionError);console.log('PASS discriminating actual wrong writer: '+kind)}finally{wrong.db.close()}}
}
async function main(){await positive(false);await positive(true);await races();await controls();await atomicAndWrongControls();await compilerOrdering()}
if (require.main === module) main().catch(error=>{console.error(error);process.exitCode=1})
module.exports = { ready, checkEffects, options, state, main }
