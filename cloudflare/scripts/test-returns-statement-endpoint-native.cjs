const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const root = path.join(__dirname, '../src'), migrationDir = path.join(__dirname, '../migrations')
const wrapper = openDb(fs.readdirSync(migrationDir).filter(file => file.endsWith('.sql')).sort().map(file => fs.readFileSync(path.join(migrationDir, file), 'utf8')))
const raw = wrapper.db
raw.exec(`INSERT INTO system_flags(key,value) VALUES('business_dataset_generation','{"generation":"12345678-1234-1234-1234-123456789012"}');
  INSERT INTO customers(id,name,is_anonymous) VALUES(90001,'Private customer',0);
  INSERT INTO products(id,name,sku) VALUES(90001,'Statement product','statement-sku');
  INSERT INTO sales(id,receipt_number) VALUES(90001,'replacement-receipt');`)
const insert = raw.prepare(`INSERT INTO returns(id,return_number,created_at,customer_id,customer_name,replacement_sale_id,total_refund_usd,branch_id,return_scope,supplier_compensation_usd,supplier_loss_usd)
 VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
for (let id = 1; id <= 1205; id++) insert.run(90000 + id, 'return-' + id, id % 2 ? '2026-09-19 17:00:00' : '2026-09-19T17:00:00Z', 90001, 'Private snapshot', 90001, 1.234567, id % 2 ? 1 : 2, id === 1205 ? 'supplier' : 'customer', 3.123456, 2.654321)
raw.exec("INSERT INTO return_items(id,return_id,product_id,product_name,stock_action) VALUES(90001,90001,90001,'Statement product','damaged'); INSERT INTO return_replacement_items(id,return_id,product_id,product_name) VALUES(90001,90001,90001,'Replacement product')")
let actor = { id: 1, username: 'operator', organization_id: 1, role_id: 2, role_code: 'cashier', permissions: JSON.stringify({ returns: true, product_cost_view: true }), role_permissions: '{}' }
let reads = 0
const db = { prepare(sql) { return { async get(params = {}) { reads++; return wrapper.prepare(sql).get(params) } } } }
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const loaded = new Map()
function load(file) {
  if (loaded.has(file)) return loaded.get(file)
  const module = { exports: {} }
  const requireLocal = name => {
    if (name === 'hono') return require('hono')
    if (name.endsWith('/db')) return { getDb: () => db }
    if (name.endsWith('/auth')) return { requireAuth: async (c, next) => { if (!actor) return c.json({ error: 'Login required' }, 401); c.set('user', actor); await next() } }
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), name)) + '.ts'
    if (['lib/returnsStatementExport.ts', 'lib/returnExportWindow.ts', 'lib/searchMatch.ts', 'lib/acquisitionCostAccess.ts', 'lib/permissions.ts'].includes(target)) return load(target)
    return {}
  }
  new Function('exports', 'require', 'module', compile(fs.readFileSync(path.join(root, file), 'utf8')))(module.exports, requireLocal, module)
  loaded.set(file, module.exports)
  return module.exports
}
const app = load('routes/returns.ts').default
const base = { startDate: '2026-09-20', endDate: '2026-09-20', scope: 'all', limit: '500' }
const get = async (patch = {}) => {
  const response = await app.request('/export?' + new URLSearchParams({ ...base, ...patch }), {}, {})
  return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') }
}
const noRows = response => { assert.ok(!('rows' in response.body), JSON.stringify(response)); return response }
;(async () => {
  let cursor, token, total, rows = []
  do {
    const before = reads
    const result = await get(cursor ? { cursor, snapshotToken: token } : {})
    assert.equal(result.status, 200, JSON.stringify(result)); assert.match(result.cache, /no-store/)
    assert.equal(reads - before, 1, 'metadata, projection, total and page use ONE SQL statement')
    if (token) assert.equal(result.body.snapshotToken, token)
    token = result.body.snapshotToken; total = result.body.total; rows.push(...result.body.rows); cursor = result.body.nextCursor
  } while (cursor)
  assert.equal(total, 1205); assert.equal(rows.length, total); assert.equal(new Set(rows.map(row => row.id)).size, total)
  assert.equal(rows[0].total_refund_usd, 1.234567, 'no monetary recalculation')
  assert.equal(rows[0].replacement_receipt_number, 'replacement-receipt')
  assert.equal(rows[0].damaged_item_count, 1)
  assert.equal(rows.at(-1).supplier_compensation_usd, 3.123456)
  assert.ok(!('customer_id' in rows[0]) && !('notes' in rows[0]) && !('items' in rows[0]), 'summary whitelist excludes private/unbounded fields')
  const verify = await get({ snapshotToken: token, verify: '1' })
  assert.equal(verify.status, 200); assert.deepEqual(verify.body.rows, []); assert.equal(verify.body.snapshotToken, token); assert.equal(verify.body.total, total)
  const empty = await get({ search: 'nothing-exists' }); assert.equal(empty.status, 200); assert.equal(empty.body.total, 0); assert.deepEqual(empty.body.rows, []); assert.equal(empty.body.nextCursor, null)
  const byProduct = await get({ search: 'statement-sku' }); assert.equal(byProduct.body.total, 1)
  for (const patch of [{ branchId: '1' }, { scope: 'supplier' }, { search: 'statement-sku' }, { type: 'damaged' }, { status: 'cancelled' }]) assert.equal(noRows(await get({ ...patch, snapshotToken: token })).status, 409)
  for (const mutation of [
    "UPDATE customers SET is_anonymous=1 WHERE id=90001",
    "UPDATE return_replacement_items SET product_name='changed' WHERE id=90001",
    "UPDATE products SET sku='changed' WHERE id=90001",
    "UPDATE sales SET receipt_number='changed' WHERE id=90001",
    "UPDATE return_items SET product_name='changed' WHERE id=90001",
    "UPDATE returns SET reason='changed' WHERE id=90001",
  ]) {
    const before = await get(); raw.exec(mutation)
    assert.equal(noRows(await get({ snapshotToken: before.body.snapshotToken, cursor: '90500' })).status, 409, mutation)
    assert.equal(noRows(await get({ snapshotToken: before.body.snapshotToken, verify: '1' })).status, 409)
  }
  const anonymized = await get(); assert.equal(anonymized.body.rows[0].customer_is_anonymous, 1); assert.equal(anonymized.body.rows[0].customer_name, null)
  const saved = actor
  actor = { ...actor, id: 2 }; assert.equal(noRows(await get({ snapshotToken: anonymized.body.snapshotToken })).status, 409)
  actor = { ...saved, organization_id: 2 }; assert.equal(noRows(await get({ snapshotToken: anonymized.body.snapshotToken })).status, 409)
  actor = { ...saved, permissions: JSON.stringify({ returns: true }) }
  assert.equal(noRows(await get({ snapshotToken: anonymized.body.snapshotToken })).status, 409)
  const deniedCosts = await get({ scope: 'supplier' }); assert.equal(deniedCosts.status, 200)
  for (const key of ['supplier_compensation_usd', 'supplier_loss_usd', 'supplier_compensation_khr', 'supplier_loss_khr']) assert.ok(!(key in deniedCosts.body.rows[0]), key)
  for (const permissions of [{ returns: false }, { returns: true, 'returns:view': false }, { returns: true, 'returns:export': false }]) {
    actor = { ...saved, permissions: JSON.stringify(permissions) }; const before = reads
    assert.equal(noRows(await get()).status, 403); assert.equal(reads, before)
  }
  actor = null; assert.equal(noRows(await get()).status, 401); actor = saved
  for (const patch of [{ cursor: '-1' }, { cursor: '1.2' }, { cursor: '0' }, { cursor: '9007199254740992' }, { cursor: '1' }, { snapshotToken: 'bad' }, { limit: '501' }, { verify: '1' }, { startDate: '' }, { endDate: '2028-01-01' }, { createdFrom: 'bad', createdTo: 'bad' }, { unknown: 'x' }]) {
    const before = reads; assert.equal(noRows(await get(patch)).status, 400, JSON.stringify(patch)); assert.equal(reads, before)
  }
  const originalRevision = raw.prepare("SELECT value FROM system_flags WHERE key='returns_export_revision'").get().value
  for (const value of ['{"revision":null}', '{"revision":9007199254740992}', '{"revision":-1}', '{"revision":"1"}', '{"revision":1.5}', 'bad']) {
    raw.prepare("UPDATE system_flags SET value=? WHERE key='returns_export_revision'").run(value)
    assert.equal(noRows(await get()).status, 503)
  }
  raw.prepare("UPDATE system_flags SET value=? WHERE key='returns_export_revision'").run(originalRevision)
  raw.exec("DELETE FROM system_flags WHERE key='returns_export_revision'"); assert.equal(noRows(await get()).status, 503)
  raw.prepare("INSERT INTO system_flags(key,value) VALUES('returns_export_revision',?)").run(originalRevision)
  for (const value of ['bad', '{}', '{"generation":1}', '{"generation":"not-a-uuid"}']) {
    raw.prepare("UPDATE system_flags SET value=? WHERE key='business_dataset_generation'").run(value)
    assert.equal(noRows(await get()).status, 503)
  }
  raw.exec("DELETE FROM system_flags WHERE key='business_dataset_generation'"); assert.equal(noRows(await get()).status, 503)
  raw.exec("INSERT INTO system_flags(key,value) VALUES('business_dataset_generation','{\"generation\":\"22345678-1234-1234-1234-123456789012\"}')")
  assert.equal(noRows(await get({ snapshotToken: token })).status, 409)
  raw.exec("INSERT INTO system_flags(key,value) VALUES('maintenance','{\"mode\":\"restore\"}')"); assert.equal(noRows(await get()).status, 503)
  raw.exec("DELETE FROM system_flags WHERE key='maintenance'")
  const beforeDelete = await get()
  raw.exec('DELETE FROM returns WHERE id=91204')
  assert.equal(noRows(await get({ snapshotToken: beforeDelete.body.snapshotToken, verify: '1' })).status, 409, 'deletion cannot silently shorten the completed statement')
  const beforeInsert = await get()
  insert.run(99999, 'backdated', '2026-09-19 17:00:00', 90001, 'Private snapshot', 90001, 1.234567, 1, 'customer', 0, 0)
  assert.equal(noRows(await get({ snapshotToken: beforeInsert.body.snapshotToken, cursor: '90500' })).status, 409, 'backdated insertion invalidates rather than shifting pages')
  raw.prepare('UPDATE returns SET reason=? WHERE id=90001').run('x'.repeat(16385)); assert.equal(noRows(await get()).status, 413)
  raw.close()
  console.log('PASS actual Returns export Hono/native migrated SQLite: 1205-row completion, one-SQL snapshot, final validation, all dependency mutations, filters/actor/permissions/privacy/costs, invalid inputs and poisoned tracking')
})().catch(error => { console.error(error); process.exitCode = 1 })
