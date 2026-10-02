const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const database = openDb(loadAll(path.resolve(__dirname, '../migrations')))
const raw = database.db
const src = path.resolve(__dirname, '../src')
let beforeBatch = null, afterCommit = null, failStatement = -1, loseResponse = false, lastBatchLength = 0
const DB = {
  prepare(sql) {
    let values = []
    const statement = {
      bind(...args) { values = args; return statement },
      async all() { return { results: raw.prepare(sql).all(...values) } },
      async first() { return raw.prepare(sql).get(...values) ?? null },
      async run() { try { const r = raw.prepare(sql).run(...values); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } } } catch (error) { console.error(JSON.stringify({ sql, values, error: String(error) })); throw error } },
    }
    return statement
  },
  async batch(statements) {
    lastBatchLength = statements.length
    if (beforeBatch) { const hook = beforeBatch; beforeBatch = null; hook() }
    raw.exec('BEGIN IMMEDIATE')
    try {
      const results = []
      for (let i = 0; i < statements.length; i++) {
        if (i === failStatement) throw new Error('fixture atomic statement failure')
        results.push(await statements[i].run())
      }
      raw.exec('COMMIT')
      if (afterCommit) { const hook = afterCommit; afterCommit = null; hook() }
      if (loseResponse) { loseResponse = false; throw new Error('fixture response lost after commit') }
      return results
    } catch (error) { if (raw.isTransaction) raw.exec('ROLLBACK'); throw error }
  },
}
const real = new Set(['acquisitionCostAccess', 'permissions', 'productWrites', 'productEditOperation', 'undoAppliers', 'moneyPrecision', 'productMerge', 'productIdentity', 'productDetailRule', 'db', 'sqlBinding', 'searchMatch', 'batchCode', 'actorSnapshot', 'pendingActions', 'reviewGate', 'reviewApply', 'conflictControl', 'renameCascade', 'schemaProbe', 'catalogCostRecompute', 'media'])
const noop = new Proxy(function () {}, { get: () => noop, apply: () => undefined, construct: () => ({}) })
class ProductImageAssetError extends Error {}
const services = {
  auth: { requireAuth: async (c, next) => { c.set('user', c.env.TEST_USER); await next() } },
  audit: { audit: async () => {}, changedFields: () => null, auditChangeColumns: () => ({ old_value: null, new_value: null }), isSecretShapedAuditKey: () => false },
  cache: { bumpVersion: async () => {}, bumpVersions: async () => {} },
  broadcastHub: { broadcast: async () => {} },
  importImageMatch: { MAX_IMAGES_PER_PRODUCT: 3, ADMIN_MAX_IMAGES_PER_PRODUCT: 5 },
  productImagePermission: { ProductImageAssetError, productImageFieldsChanged: () => false, productImageFieldsChangedResolved: async () => false, resolveProductImageFields: async () => {}, omitUnchangedProductImageFields: () => {} },
  saleBulkStatus: { BULK_STATUS_KIND: 'sale.bulk_status' },
  saleBulkUpdate: { SALE_BULK_UPDATE_KINDS: new Set() },
  returnBulkAction: { RETURN_BULK_ACTION_KIND: 'return.bulk' },
  stockSession: { STOCK_SESSION_KIND: 'stock.session' },
  saleSettlementAction: { SALE_SETTLEMENT_ACTION_KIND: 'sale.settlement' },
  transferOperation: { TRANSFER_OPERATION_KIND: 'stock.transfer' },
  customerGenderRestoration: { CUSTOMER_GENDER_RESTORATION_KIND: 'customer.gender' },
  stockLotAdjustment: { STOCK_LOT_SET_KIND: 'stock.quantity_set' },
  stockInLineEdit: { STOCK_IN_LINE_EDIT_KIND: 'stock.line_edit' },
  productDelete: { PRODUCT_REMOVE_ACTION_KIND: 'product.remove', parseProductRemovePendingPointer: () => null },
}
const cache = new Map()
function load(relative) {
  if (cache.has(relative)) return cache.get(relative)
  const mod = { exports: {} }; cache.set(relative, mod.exports)
  const filename = relative === 'lib/productEditOperation.ts' && process.env.BOS_PRODUCT_EDIT_SOURCE_CONTROL ? process.env.BOS_PRODUCT_EDIT_SOURCE_CONTROL : path.join(src, relative)
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const localRequire = request => {
    if (request === 'hono') return { Hono }
    const name = request.split('/').pop()
    if (services[name]) return services[name]
    if (real.has(name)) return load(`lib/${name}.ts`)
    if (request.startsWith('.')) return noop
    return require(request)
  }
  new Function('require', 'module', 'exports', code)(localRequire, mod, mod.exports)
  cache.set(relative, mod.exports)
  return mod.exports
}
const products = load('routes/products.ts').default
const reviews = load('routes/reviewQueue.ts').default
const histories = load('routes/actionHistory.ts').default
const user = (id, view = false, edit = false, tier = true) => ({ id, username: `fixture${id}`, name: `Fixture ${id}`, is_active: 1, role_code: 'manager', permissions: JSON.stringify({ products: tier, product_cost_view: view, product_cost_edit: edit, audit_log: true, review: true }) })
const actor = user(7, false, true)
const context = { waitUntil(p) { Promise.resolve(p).catch(error => { throw error }) }, passThroughOnException() {} }
async function request(app, method, url, body, current = actor) {
  const response = await app.request(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { DB, TEST_USER: current }, context)
  const text = await response.text()
  return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text }
}
let sequence = 0
function seed() {
  sequence++
  return Number(raw.prepare(`INSERT INTO products(name,barcode,brand,description,is_active,cost_price_usd,cost_price_khr,purchase_price_usd,purchase_price_khr,selling_price_usd,wholesale_price_usd,custom_fields,updated_at)
    VALUES(?,?,'Original brand','Original description',1,7.123456,NULL,8.654321,32000,15,12,'{}','2026-10-02T04:00:00Z')`).run(`Fixture ${sequence}`, `native-edit-${sequence}`).lastInsertRowid)
}
const row = id => raw.prepare('SELECT * FROM products WHERE id=?').get(id)
const receipt = id => JSON.parse(raw.prepare('SELECT payload_json FROM undo_snapshots WHERE id=?').get(Number(id)).payload_json)
const authoritative = () => JSON.stringify(Object.fromEntries(['products', 'product_images', 'product_cost_entries', 'inventory_movements', 'product_batches', 'branch_batch_stock', 'branch_stock', 'audit_logs', 'undo_snapshots', 'action_history', 'pending_actions'].map(table => [table, raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])))
async function main() {
  raw.prepare(`INSERT INTO users(id,username,name,password,permissions,is_active) VALUES(7,'fixture7','Fixture 7','admin123',?,1)`).run(actor.permissions)
  const { DatabaseSync } = require('node:sqlite')
  const migration = fs.readFileSync(path.resolve(__dirname, '../migrations/0219_product_edit_request_identity.sql'), 'utf8')
  for (const requestId of ['abcdefgh\0evil', 'abcdefgh', 'abcdefgh\n']) {
    const control = new DatabaseSync(':memory:')
    control.limits.exprDepth = 100
    control.exec(fs.readFileSync(path.resolve(__dirname, '../migrations/0097_undo_snapshots.sql'), 'utf8'))
    control.prepare(`INSERT INTO undo_snapshots(kind,status,payload_json,created_by_id) VALUES('product.edit.v1','undoable',?,7)`).run(JSON.stringify({ request_id: requestId }))
    if (requestId === 'abcdefgh') { control.exec(migration); assert.equal(control.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE name='idx_undo_product_edit_request'`).get().n, 1) }
    else { assert.throws(() => control.exec(migration), /malformed JSON/); assert.equal(control.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE name='idx_undo_product_edit_request'`).get().n, 0) }
    control.close()
  }
  console.log('PASS migration rejects malformed historical request identities before index and accepts exact valid identity')
  const id = seed()
  const body = { description: 'Saved description', client_request_id: 'native-save-0001', expectedUpdatedAt: row(id).updated_at }
  const saved = await request(products, 'PUT', `/${id}`, body, user(7))
  assert.equal(saved.status, 200, JSON.stringify(saved))
  assert.ok(saved.body.action_history_id > 0, 'actual product PUT must publish its server-owned Undo receipt')
  assert.equal(saved.body.undo_payload.applier, 'product.edit.v1')
  assert.equal(saved.body.generation, 0)
  const captured = receipt(saved.body.operation_id)
  assert.equal(captured.before.rows[0].cost_price_usd, 7.123456)
  assert.equal(captured.before.rows[0].purchase_price_usd, 8.654321)
  assert.deepEqual(captured.effects.money_fields, [])
  assert.ok(!JSON.stringify(saved.body).includes('7.123456'), 'no-view response cannot disclose private cost capture')
  const state = authoritative()
  const repeated = await request(products, 'PUT', `/${id}`, body, user(7))
  assert.equal(repeated.status, 200, JSON.stringify(repeated))
  assert.equal(repeated.body.action_history_id, saved.body.action_history_id)
  assert.equal(authoritative(), state)
  const changedIntent = await request(products, 'PUT', `/${id}`, { ...body, description: 'Other intent' }, user(7))
  assert.equal(changedIntent.status, 409)
  assert.equal(authoritative(), state)
  console.log('PASS actual direct save private capture, ordinary effect mask and indexed stable retry')
  const undo = await request(histories, 'POST', `/${saved.body.action_history_id}/undo`, { expected_generation: 0 }, user(7))
  assert.equal(undo.status, 200, JSON.stringify(undo))
  assert.equal(undo.body.applied, true)
  assert.equal(row(id).description, 'Original description')
  assert.equal(row(id).cost_price_usd, 7.123456)
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM product_cost_entries WHERE product_id=?').get(id).n, 0)
  const afterUndo = authoritative()
  const undoRetry = await request(histories, 'POST', `/${saved.body.action_history_id}/undo`, { expected_generation: 0 }, user(7))
  assert.equal(undoRetry.status, 200, JSON.stringify(undoRetry))
  assert.equal(authoritative(), afterUndo)
  const redo = await request(histories, 'POST', `/${saved.body.action_history_id}/redo`, { expected_generation: 1 }, user(7))
  assert.equal(redo.status, 200, JSON.stringify(redo))
  assert.equal(row(id).description, 'Saved description')
  const costId = seed()
  const costBefore = row(costId)
  const costSaved = await request(products, 'PUT', `/${costId}`, { cost_price_usd: 9.4321, client_request_id: 'native-cost-0001', expectedUpdatedAt: row(costId).updated_at })
  assert.equal(costSaved.status, 200, JSON.stringify(costSaved))
  const costAfter = row(costId)
  const costUndo = await request(histories, 'POST', `/${costSaved.body.action_history_id}/undo`, { expected_generation: 0 })
  assert.equal(costUndo.status, 200, JSON.stringify(costUndo))
  for (const key of ['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr']) assert.equal(row(costId)[key], costBefore[key], key)
  const entries = raw.prepare('SELECT * FROM product_cost_entries WHERE product_id=? ORDER BY id').all(costId)
  assert.equal(entries.length, 2)
  assert.equal(entries[1].source, 'undo')
  assert.equal(entries[1].baseline_batch_id, 0)
  const costRedo = await request(histories, 'POST', `/${costSaved.body.action_history_id}/redo`, { expected_generation: 1 })
  assert.equal(costRedo.status, 200, JSON.stringify(costRedo))
  for (const key of ['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr']) assert.equal(row(costId)[key], costAfter[key], key)
  const revoked = await request(histories, 'POST', `/${costSaved.body.action_history_id}/undo`, { expected_generation: 2 }, user(7))
  assert.equal(revoked.status, 403, JSON.stringify(revoked))
  console.log('PASS actual managed ordinary and blind-cost Undo/Redo, exact raw values, saved basis, repeated generation and revoked money grant')
  const reviewUser = user(8, false, true, 'review')
  raw.prepare(`INSERT INTO users(id,username,name,password,permissions,is_active) VALUES(8,'fixture-review','Fixture Review','admin123',?,1)`).run(reviewUser.permissions)
  const reviewedId = seed()
  const queued = await request(products, 'PUT', `/${reviewedId}`, { description: 'Reviewed description', client_request_id: 'native-review-001', expectedUpdatedAt: row(reviewedId).updated_at }, reviewUser)
  assert.equal(queued.status, 202, JSON.stringify(queued))
  assert.equal(queued.body.applied, false)
  assert.equal(row(reviewedId).description, 'Original description')
  const approved = await request(reviews, 'POST', `/${queued.body.pendingActionId}/approve`, {})
  assert.equal(approved.status, 200, JSON.stringify(approved))
  const reviewedReceipt = receipt(queued.body.operation_id)
  assert.equal(row(reviewedId).description, 'Reviewed description')
  assert.ok(reviewedReceipt.history_id > 0)
  const queueUndo = await request(histories, 'POST', `/${reviewedReceipt.history_id}/undo`, { expected_generation: 0 }, reviewUser)
  assert.equal(queueUndo.status, 202, JSON.stringify(queueUndo))
  assert.equal(queueUndo.body.applied, false)
  assert.equal(row(reviewedId).description, 'Reviewed description')
  assert.equal(raw.prepare('SELECT status FROM action_history WHERE id=?').get(reviewedReceipt.history_id).status, 'undoable')
  const approveUndo = await request(reviews, 'POST', `/${queueUndo.body.pendingActionId}/approve`, {})
  assert.equal(approveUndo.status, 200, JSON.stringify(approveUndo))
  assert.equal(row(reviewedId).description, 'Original description')
  assert.equal(raw.prepare('SELECT status FROM action_history WHERE id=?').get(reviewedReceipt.history_id).status, 'redoable')
  console.log('PASS actual review save and generation-bound review replay commit History with approval')
  const lostId = seed()
  const lostBody = { cost_price_usd: 11.25, client_request_id: 'native-lost-0001', expectedUpdatedAt: row(lostId).updated_at }
  loseResponse = true
  const lost = await request(products, 'PUT', `/${lostId}`, lostBody)
  assert.equal(lost.status, 200, JSON.stringify(lost))
  const lostState = authoritative()
  assert.equal((await request(products, 'PUT', `/${lostId}`, lostBody)).body.action_history_id, lost.body.action_history_id)
  assert.equal(authoritative(), lostState)
  loseResponse = true
  const lostUndo = await request(histories, 'POST', `/${lost.body.action_history_id}/undo`, { expected_generation: 0 })
  assert.equal(lostUndo.status, 200, JSON.stringify(lostUndo))
  const lostUndoState = authoritative()
  assert.equal((await request(histories, 'POST', `/${lost.body.action_history_id}/undo`, { expected_generation: 0 })).status, 200)
  assert.equal(authoritative(), lostUndoState)
  const failedId = seed()
  const failureState = authoritative()
  failStatement = 5
  const failed = await request(products, 'PUT', `/${failedId}`, { cost_price_usd: 14.5, client_request_id: 'native-fail-0001' })
  failStatement = -1
  assert.equal(failed.status, 500, JSON.stringify(failed))
  assert.equal(authoritative(), failureState)
  console.log('PASS committed response loss reconciles save and replay; mid-batch failure leaves all authoritative tables unchanged')
  const revokedId = seed()
  const revokedBody = { cost_price_usd: 13.75, client_request_id: 'native-revoke-001' }
  loseResponse = true
  afterCommit = () => raw.prepare('UPDATE users SET permissions=? WHERE id=7').run(user(7).permissions)
  const revokedRecovery = await request(products, 'PUT', `/${revokedId}`, revokedBody)
  assert.equal(revokedRecovery.status, 403, JSON.stringify(revokedRecovery))
  assert.equal(row(revokedId).cost_price_usd, 13.75)
  assert.ok(!revokedRecovery.body.item && !revokedRecovery.body.action_history_id)
  const committedCount = raw.prepare(`SELECT COUNT(*) n FROM undo_snapshots WHERE kind='product.edit.v1' AND json_extract(payload_json,'$.request_id')=?`).get(revokedBody.client_request_id).n
  assert.equal(committedCount, 1)
  raw.prepare('UPDATE users SET permissions=? WHERE id=7').run(actor.permissions)
  const recoveredGrant = await request(products, 'PUT', `/${revokedId}`, revokedBody)
  assert.equal(recoveredGrant.status, 200, JSON.stringify(recoveredGrant))
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM product_cost_entries WHERE product_id=?').get(revokedId).n, 1)
  loseResponse = true
  afterCommit = () => raw.prepare('UPDATE users SET permissions=? WHERE id=7').run(user(7).permissions)
  const revokedReplay = await request(histories, 'POST', `/${recoveredGrant.body.action_history_id}/undo`, { expected_generation: 0 })
  assert.equal(revokedReplay.status, 403, JSON.stringify(revokedReplay))
  assert.equal(row(revokedId).cost_price_usd, 7.123456)
  raw.prepare('UPDATE users SET permissions=? WHERE id=7').run(actor.permissions)
  const recoveredReplay = await request(histories, 'POST', `/${recoveredGrant.body.action_history_id}/undo`, { expected_generation: 0 })
  assert.equal(recoveredReplay.status, 200, JSON.stringify(recoveredReplay))
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM product_cost_entries WHERE product_id=?').get(revokedId).n, 2)
  console.log('PASS grant revoked after commit refuses receipt disclosure; original key and generation reconcile after grant restoration')
  for (const prior of ['none','positive','zero']) {
    const targetId=seed(), controlId=seed()
    const lot=(product,cost,key,quantity=1)=>{ const id=Number(raw.prepare('INSERT INTO product_batches(variant_product_id,batch_key,is_active,unit_cost_usd) VALUES(?,?,1,?)').run(product,key,cost).lastInsertRowid); raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,?)').run(id,quantity); return id }
    lot(targetId,4,`basis-${prior}-a1`); const targetBase=lot(targetId,8,`basis-${prior}-a2`)
    lot(controlId,4,`basis-${prior}-c1`); const controlBase=lot(controlId,8,`basis-${prior}-c2`)
    if(prior!=='none') for(const [product,baseline] of [[targetId,targetBase],[controlId,controlBase]]) raw.prepare("INSERT INTO product_cost_entries(product_id,cost_usd,cost_khr,source,baseline_batch_id) VALUES(?,?,NULL,'manual',?)").run(product,prior==='zero'?0:6.125678,baseline)
    raw.prepare('UPDATE products SET cost_price_usd=7.123456,purchase_price_usd=8.654321,cost_price_khr=NULL,purchase_price_khr=32000 WHERE id=?').run(targetId)
    const before= row(targetId)
    const a=await request(products,'PUT',`/${targetId}`,{cost_price_usd:9.4321,client_request_id:`basis-a-${prior}`})
    assert.equal(a.status,200,JSON.stringify(a)); const afterA=row(targetId)
    lot(targetId,14,`basis-${prior}-a3`); lot(controlId,14,`basis-${prior}-c3`)
    const b=await request(products,'PUT',`/${targetId}`,{cost_price_usd:19,client_request_id:`basis-b-${prior}`})
    assert.equal(b.status,200,JSON.stringify(b))
    const targetNew=lot(targetId,24,`basis-${prior}-a4`),controlNew=lot(controlId,24,`basis-${prior}-c4`)
    const entriesBefore=raw.prepare('SELECT * FROM product_cost_entries WHERE product_id=? ORDER BY id').all(targetId)
    const undoA=await request(histories,'POST',`/${a.body.action_history_id}/undo`,{expected_generation:0})
    assert.equal(undoA.status,200,JSON.stringify(undoA))
    for(const field of ['cost_price_usd','purchase_price_usd','cost_price_khr','purchase_price_khr']) assert.equal(row(targetId)[field],before[field],prior+' '+field)
    assert.deepEqual(raw.prepare('SELECT * FROM product_cost_entries WHERE product_id=? AND id<=? ORDER BY id').all(targetId,entriesBefore.at(-1).id),entriesBefore)
    const overlay=raw.prepare('SELECT * FROM product_cost_entries WHERE product_id=? ORDER BY id DESC LIMIT 1').get(targetId)
    assert.equal(overlay.baseline_batch_id,prior==='none'?0:targetBase)
    assert.equal(overlay.cost_usd,prior==='positive'?6.125678:0)
    for(const id of [targetNew,controlNew]) raw.prepare('UPDATE branch_batch_stock SET quantity=2 WHERE batch_id=?').run(id)
    assert.equal(row(targetId).cost_price_usd,row(controlId).cost_price_usd,prior+' future stock uses saved basis')
    const redoA=await request(histories,'POST',`/${a.body.action_history_id}/redo`,{expected_generation:1})
    assert.equal(redoA.status,200,JSON.stringify(redoA))
    for(const field of ['cost_price_usd','purchase_price_usd','cost_price_khr','purchase_price_khr']) assert.equal(row(targetId)[field],afterA[field],prior+' redo '+field)
    raw.prepare("INSERT INTO product_cost_entries(product_id,cost_usd,cost_khr,source,baseline_batch_id) VALUES(?,9.4321,NULL,'manual',?)").run(controlId,controlBase)
    for(const id of [targetNew,controlNew]) raw.prepare('UPDATE branch_batch_stock SET quantity=3 WHERE batch_id=?').run(id)
    assert.equal(row(targetId).cost_price_usd,row(controlId).cost_price_usd,prior+' redo future stock uses original A baseline')
    const retryState=authoritative()
    const oldRetry=await request(histories,'POST',`/${a.body.action_history_id}/undo`,{expected_generation:0})
    assert.equal(oldRetry.status,200,JSON.stringify(oldRetry)); assert.equal(oldRetry.body.generation,1); assert.equal(oldRetry.body.current_generation,2); assert.equal(oldRetry.body.item.undo_payload.generation,2); assert.equal(authoritative(),retryState)
  }
  console.log('PASS three saved-basis states; A/B/later lots; exact raw Undo/Redo and real subsequent stock triggers match untouched basis controls; old generation retry acknowledges without rewriting')
  for (const original of [null,0,8.654321]) {
    const product=seed(); raw.prepare('UPDATE products SET purchase_price_usd=? WHERE id=?').run(original,product)
    const before=row(product)
    const save=await request(products,'PUT',`/${product}`,{purchase_price_usd:3.123456,client_request_id:`purchase-only-${product}`})
    assert.equal(save.status,200,JSON.stringify(save)); assert.deepEqual(receipt(save.body.operation_id).effects.ordinary_fields,[])
    raw.prepare("UPDATE products SET description='Later ordinary' WHERE id=?").run(product)
    assert.equal((await request(histories,'POST',`/${save.body.action_history_id}/undo`,{expected_generation:0})).status,200)
    assert.equal(row(product).purchase_price_usd,original); assert.equal(row(product).cost_price_usd,before.cost_price_usd); assert.equal(row(product).description,'Later ordinary')
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM product_cost_entries WHERE product_id=?').get(product).n,0)
  }
  const khrId=seed(),khrBefore=row(khrId)
  const khrSave=await request(products,'PUT',`/${khrId}`,{cost_price_khr:6000,client_request_id:'khr-manual-001'})
  assert.equal(khrSave.status,200,JSON.stringify(khrSave)); assert.equal(receipt(khrSave.body.operation_id).effects.manual_cost,true)
  assert.ok(receipt(khrSave.body.operation_id).effects.money_fields.includes('cost_price_usd')); assert.ok(receipt(khrSave.body.operation_id).effects.money_fields.includes('purchase_price_usd'))
  assert.equal((await request(histories,'POST',`/${khrSave.body.action_history_id}/undo`,{expected_generation:0})).status,200)
  for(const field of ['cost_price_usd','purchase_price_usd','cost_price_khr','purchase_price_khr']) assert.equal(row(khrId)[field],khrBefore[field],field)
  console.log('PASS purchase-only null/zero/historical precision without catalog entries or ordinary scope; KHR-only actual manual baseline owns exact USD restoration')
  const galleryId=seed()
  raw.prepare('UPDATE products SET image_path=? WHERE id=?').run('/uploads/old.png',galleryId)
  for(const [order,image] of ['/uploads/old.png','/uploads/second.png'].entries()) raw.prepare('INSERT INTO product_images(product_id,image_path,sort_order) VALUES(?,?,?)').run(galleryId,image,order)
  const gallery=()=>raw.prepare('SELECT image_path FROM product_images WHERE product_id=? ORDER BY sort_order,id').all(galleryId).map(r=>r.image_path)
  const galleryUser={...user(9),permissions:JSON.stringify({products:false,products_image_only:true})}
  const gallerySave=await request(products,'PUT',`/${galleryId}`,{image_path:'/uploads/second.png',image_gallery:['/uploads/second.png','/uploads/old.png'],client_request_id:'gallery-only-0001'},galleryUser)
  assert.equal(gallerySave.status,200,JSON.stringify(gallerySave));assert.deepEqual(gallery(),['/uploads/second.png','/uploads/old.png'])
  assert.ok(!JSON.stringify(gallerySave.body.item).includes('Original description')); assert.deepEqual(receipt(gallerySave.body.operation_id).effects.money_fields,[])
  const galleryUndo=await request(histories,'POST',`/${gallerySave.body.action_history_id}/undo`,{expected_generation:0},galleryUser)
  assert.equal(galleryUndo.status,200,JSON.stringify(galleryUndo)); assert.deepEqual(gallery(),['/uploads/old.png','/uploads/second.png']);assert.equal(row(galleryId).image_path,'/uploads/old.png')
  assert.equal((await request(histories,'POST',`/${gallerySave.body.action_history_id}/redo`,{expected_generation:1},galleryUser)).status,200)
  assert.deepEqual(gallery(),['/uploads/second.png','/uploads/old.png'])
  const imageDenied={...user(9),permissions:JSON.stringify({products:true,'products:image':false})}
  const galleryState=authoritative(); const deniedImage=await request(histories,'POST',`/${gallerySave.body.action_history_id}/undo`,{expected_generation:2},imageDenied)
  assert.equal(deniedImage.status,403,JSON.stringify(deniedImage));assert.equal(authoritative(),galleryState)
  console.log('PASS restricted image-only gallery/order Undo/Redo and revoked-image whole-operation refusal; asset service remains a declared fixture seam')
  const renameId=seed()
  const movement=Number(raw.prepare('INSERT INTO inventory_movements(product_id,product_name,quantity) VALUES(?,?,1)').run(renameId,'Historical display name').lastInsertRowid)
  const renameBefore=row(renameId).name
  const rename=await request(products,'PUT',`/${renameId}`,{name:'Renamed native product',client_request_id:'native-rename-001'})
  assert.equal(rename.status,200,JSON.stringify(rename));assert.equal(raw.prepare('SELECT product_name FROM inventory_movements WHERE id=?').get(movement).product_name,'Renamed native product')
  assert.equal((await request(histories,'POST',`/${rename.body.action_history_id}/undo`,{expected_generation:0})).status,200)
  assert.equal(row(renameId).name,renameBefore);assert.equal(raw.prepare('SELECT product_name FROM inventory_movements WHERE id=?').get(movement).product_name,'Historical display name')
  assert.equal((await request(histories,'POST',`/${rename.body.action_history_id}/redo`,{expected_generation:1})).status,200)
  assert.equal(raw.prepare('SELECT product_name FROM inventory_movements WHERE id=?').get(movement).product_name,'Renamed native product')
  let renameState,concurrentMovement
  beforeBatch=()=>{concurrentMovement=Number(raw.prepare('INSERT INTO inventory_movements(product_id,product_name,quantity) VALUES(?,?,1)').run(renameId,'Concurrent writer name').lastInsertRowid);renameState=authoritative()}
  const renameConflict=await request(histories,'POST',`/${rename.body.action_history_id}/undo`,{expected_generation:2})
  assert.equal(renameConflict.status,409,JSON.stringify(renameConflict))
  assert.equal(authoritative(),renameState);assert.equal(raw.prepare('SELECT product_name FROM inventory_movements WHERE id=?').get(concurrentMovement).product_name,'Concurrent writer name')
  console.log('PASS canonical linked-name replay and concurrent linked-row addition refuses without overwriting its evidence')
  const namespaceId=seed(), namespaceOriginal=row(namespaceId).name, outsideId=seed()
  const namespaceSave=await request(products,'PUT',`/${namespaceId}`,{name:'Namespace renamed',client_request_id:'namespace-race-001'})
  assert.equal(namespaceSave.status,200,JSON.stringify(namespaceSave))
  let namespaceConcurrentState
  beforeBatch=()=>{raw.prepare('UPDATE products SET name=? WHERE id=?').run(namespaceOriginal,outsideId);namespaceConcurrentState=authoritative()}
  const namespaceUndo=await request(histories,'POST',`/${namespaceSave.body.action_history_id}/undo`,{expected_generation:0})
  assert.equal(namespaceUndo.status,409,JSON.stringify(namespaceUndo));assert.equal(authoritative(),namespaceConcurrentState)
  console.log('PASS destination name namespace concurrent membership refuses replay atomically')
  const rejectedId=seed(),rejectedBody={description:'Rejected edit',client_request_id:'rejected-save-001'}
  const rejectedSave=await request(products,'PUT',`/${rejectedId}`,rejectedBody,reviewUser)
  assert.equal(rejectedSave.status,202,JSON.stringify(rejectedSave))
  assert.equal((await request(reviews,'POST',`/${rejectedSave.body.pendingActionId}/reject`,{reason:'Needs correction'})).status,200)
  const rejectedRetry=await request(products,'PUT',`/${rejectedId}`,rejectedBody,reviewUser)
  assert.equal(rejectedRetry.status,409,JSON.stringify(rejectedRetry)); assert.equal(rejectedRetry.body.code,'review_state_conflict');assert.equal(row(rejectedId).description,'Original description')
  const rejectedPointer=JSON.parse(raw.prepare('SELECT payload_json FROM pending_actions WHERE id=?').get(rejectedSave.body.pendingActionId).payload_json)
  assert.equal((await request(reviews,'POST',`/${rejectedSave.body.pendingActionId}/resubmit`,{payload:{...rejectedPointer,description:'Injected'}},reviewUser)).body.code,'product_edit_request_immutable')
  assert.equal((await request(reviews,'POST',`/${rejectedSave.body.pendingActionId}/resubmit`,{payload:rejectedPointer},reviewUser)).status,200)
  assert.equal((await request(products,'PUT',`/${rejectedId}`,rejectedBody,reviewUser)).status,202)
  assert.equal((await request(reviews,'POST',`/${rejectedSave.body.pendingActionId}/approve`,{})).status,200)
  const rejectedHistory=receipt(rejectedSave.body.operation_id).history_id
  const rejectedReplay=await request(histories,'POST',`/${rejectedHistory}/undo`,{expected_generation:0},reviewUser)
  assert.equal(rejectedReplay.status,202,JSON.stringify(rejectedReplay))
  assert.equal((await request(reviews,'POST',`/${rejectedReplay.body.pendingActionId}/reject`,{reason:'Needs correction'})).status,200)
  assert.equal((await request(histories,'POST',`/${rejectedHistory}/undo`,{expected_generation:0},reviewUser)).status,409)
  console.log('PASS rejected save/replay cannot report pending; exact typed pointer resubmission restores the original approval intent')
  const fullAdmin={...actor,role_code:'admin'}
  const managedState=authoritative()
  const forged=await request(histories,'POST','/',{scope:'products',entity:'product',entity_id:String(id),label:'Forged',reversible:true,undo_payload:saved.body.undo_payload,redo_payload:saved.body.redo_payload},fullAdmin)
  assert.ok([400,403,409].includes(forged.status),JSON.stringify(forged))
  assert.ok([400,403,409].includes((await request(histories,'PATCH',`/${saved.body.action_history_id}`,{status:'redoable'},fullAdmin)).status))
  assert.equal(authoritative(),managedState)
  console.log('PASS public History POST/PATCH cannot forge or mutate managed product edit even for administrator')
  for (const flow of ['save','undo','approval']) {
    const setup=async()=>{
      const product=seed(),body={cost_price_usd:22,name:'Atomic '+product,image_path:'/uploads/atomic.png',image_gallery:['/uploads/atomic.png'],description:'Atomic matrix',client_request_id:`atomic-${flow}-${product}`}
      raw.prepare('INSERT INTO inventory_movements(product_id,product_name,quantity) VALUES(?,?,1)').run(product,'Historical atomic name')
      if(flow==='save') return ()=>request(products,'PUT',`/${product}`,body)
      const saved=await request(products,'PUT',`/${product}`,body,flow==='approval'?reviewUser:actor)
      assert.equal(saved.status,flow==='approval'?202:200,JSON.stringify(saved))
      return ()=>flow==='approval'?request(reviews,'POST',`/${saved.body.pendingActionId}/approve`,{}):request(histories,'POST',`/${saved.body.action_history_id}/undo`,{expected_generation:0})
    }
    const probe=await setup(); assert.equal((await probe()).status,200); const length=lastBatchLength
    for(let position=0;position<length;position++) {
      const invoke=await setup(),before=authoritative();failStatement=position
      const result=await invoke();failStatement=-1
      assert.equal(result.status,500,flow+' '+position+' '+JSON.stringify(result));assert.equal(authoritative(),before,flow+' rollback '+position)
    }
    console.log('PASS every '+flow+' batch statement failure rolls back authoritative state: '+length+' positions')
  }




}
main().then(() => raw.close()).catch(error => { console.error(error); raw.close(); process.exitCode = 1 })
