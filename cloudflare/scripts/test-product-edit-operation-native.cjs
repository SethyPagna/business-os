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
const authoritative = () => JSON.stringify(Object.fromEntries(['products', 'product_images', 'product_cost_entries', 'audit_logs', 'undo_snapshots', 'action_history', 'pending_actions'].map(table => [table, raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])))
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
}
main().then(() => raw.close()).catch(error => { console.error(error); raw.close(); process.exitCode = 1 })
