const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')
const root = path.join(__dirname, '../src')
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function load(file, dependencies = {}) {
  const module = { exports: {} }
  new Function('exports', 'require', 'module', compile(fs.readFileSync(path.join(root, file), 'utf8')))(module.exports,
    name => { assert.ok(name in dependencies, `unexpected read dependency ${name}`); return dependencies[name] }, module)
  return module.exports
}
const dates = load('lib/businessDateWindow.ts')
const permissions = load('lib/permissions.ts')
const access = load('lib/acquisitionCostAccess.ts', { './permissions': permissions })
const raw = new DatabaseSync(':memory:')
raw.exec(`CREATE TABLE returns(id INTEGER PRIMARY KEY,created_at TEXT,return_scope TEXT,status TEXT,branch_id INTEGER,
  total_refund_usd REAL DEFAULT 0,total_refund_khr REAL DEFAULT 0,supplier_compensation_usd REAL DEFAULT 0,
  supplier_compensation_khr REAL DEFAULT 0,supplier_loss_usd REAL DEFAULT 0,supplier_loss_khr REAL DEFAULT 0,
  reason TEXT,return_type TEXT,customer_id INTEGER,replacement_sale_id INTEGER,sale_id INTEGER);
  CREATE TABLE sales(id INTEGER PRIMARY KEY,receipt_number TEXT);
  CREATE TABLE customers(id INTEGER PRIMARY KEY,is_anonymous INTEGER);
  CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,stock_action TEXT);
  INSERT INTO returns(id,created_at,return_scope,status,branch_id,total_refund_usd,reason,return_type) VALUES
  (1,'2026-09-19T16:59:59Z','customer','completed',1,1,'a','restock'),
  (2,'2026-09-19 17:00:00','customer','completed',1,2,'a','restock'),
  (3,'2026-09-19T17:00:59.999Z','customer','completed',2,3,'b','damaged'),
  (4,'2026-09-19T17:01:00Z','customer','completed',1,4,'a','restock'),
  (5,'2026-09-20T18:30:00Z','customer','completed',1,5,'a','restock'),
  (6,'2026-09-20 15:00:00','customer','completed',1,6,'a','restock'),
  (7,'2026-09-19 17:00:30','customer','cancelled',1,7,'a','restock'),
  (8,'2026-09-19T17:00:15Z','supplier','completed',1,0,'supplier','restock'),
  (9,'2026-09-21 05:00:00','customer','completed',1,9,'a','restock');
  UPDATE returns SET supplier_compensation_usd=8,supplier_loss_usd=2 WHERE id=8;`)
let reads = 0
const db = { prepare(sql) { return {
  async all(params = {}) { reads++; return raw.prepare(sql).all(params) },
  async get(params = {}) { reads++; return raw.prepare(sql).get(params) },
} } }
const routeModule = { exports: {} }
new Function('exports', 'require', 'module', compile(fs.readFileSync(path.join(root, 'routes/returns.ts'), 'utf8')))(routeModule.exports, name => {
  if (name === 'hono') return require('hono')
  if (name === '../lib/db') return { getDb: () => db }
  if (name === '../lib/auth') return { requireAuth: async (c, next) => { c.set('user', { id: 1, role_code: 'admin' }); await next() } }
  if (name === '../lib/permissions') return permissions
  if (name === '../lib/acquisitionCostAccess') return access
  if (name === '../lib/businessDateWindow') return dates
  if (name === '../lib/searchMatch') return load('lib/searchMatch.ts')
  return {} // No write-only integration is invoked by these GET handlers.
}, routeModule)
const app = routeModule.exports.default
const get = async (route, query = {}) => {
  const response = await app.request(`${route}?${new URLSearchParams(query)}`, {}, {})
  return { status: response.status, body: await response.json() }
}
function extract(file, name) {
  const ast = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true)
  return ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast)
}
const reports = { exports: {} }
new Function('exports', 'module', ...Object.keys(dates), compile(extract('lib/salesAnalytics.ts', 'shiftWindowBound') + '\n' + extract('routes/reports.ts', 'reportRecordRange')))(reports.exports, reports, ...Object.values(dates))
;(async () => {
  const day = { startDate: '2026-09-20', endDate: '2026-09-20' }
  const exact = { ...day, createdFrom: '2026-09-19 17:00:00', createdTo: '2026-09-19 17:01:00' }
  for (const filter of [day, exact, {}, { startDate: '2026-09-20' }, { endDate: '2026-09-20' },
    { startDate: '2026-09-20', endDate: '2026-09-21', createdFrom: '2026-09-20 15:00:00', createdTo: '2026-09-20 19:01:00' },
    { startDate: '2026-09-20', endDate: '2026-09-22', createdFrom: '2026-09-20 15:00:00', createdTo: '2026-09-21 19:01:00' }]) {
    const list = await get('/', filter), stats = await get('/report', filter)
    assert.equal(list.status, 200, JSON.stringify(list)); assert.equal(stats.status, 200)
    const counted = list.body.filter(row => row.status !== 'cancelled')
    assert.equal(stats.body.totals.count, counted.length)
    assert.equal(stats.body.totals.refund_usd, counted.reduce((sum, row) => sum + row.total_refund_usd, 0))
    for (const key of ['days', 'by_reason', 'by_type']) assert.equal(stats.body[key].reduce((sum, row) => sum + row.count, 0), counted.length)
    const predicate = reports.exports.reportRecordRange('returns', 'r', filter)
    const expected = raw.prepare(`SELECT id FROM returns r WHERE return_scope='customer' AND ${predicate.sql} ORDER BY created_at DESC`).all(predicate.params).map(row => row.id)
    assert.deepEqual(list.body.map(row => row.id), expected, 'Reports and operational Returns use identical interval cohorts')
  }
  assert.deepEqual((await get('/', exact)).body.map(row => row.id).sort(), [2, 3, 7], 'inclusive start/end minute, exclusive next minute, mixed stored timestamp formats')
  assert.deepEqual((await get('/', { createdFrom: '2026-09-20 15:00:00', createdTo: '2026-09-21 19:01:00' })).body.map(row => row.id).sort(), [5, 6, 9], 'multi-day intervals include intervening noon, never a recurring 22:00–02:00 mask')
  assert.equal((await get('/report', exact)).body.totals.count, 2, 'cancelled is listed but never included in financial statistics')
  const supplier = await get('/report', { ...exact, scope: 'supplier' })
  assert.equal(supplier.body.totals.count, 1); assert.equal(supplier.body.totals.compensation_usd, 8); assert.equal(supplier.body.totals.loss_usd, 2)
  assert.deepEqual((await get('/', { ...exact, scope: 'supplier' })).body.map(row => row.id), [8])
  assert.equal((await get('/report', { ...exact, branchId: '1' })).body.totals.count, 1)
  assert.equal((await get('/', { ...exact, limit: '1' })).body.length, 1, 'existing bounded list contract preserved, not silently expanded')
  assert.deepEqual((await get('/', { createdFrom: '2026-09-20T00:00:00+07:00', createdTo: '2026-09-20T00:01:00+07:00' })).body.map(row => row.id).sort(), [2, 3, 7])
  for (const query of [
    { createdFrom: exact.createdFrom }, { createdTo: exact.createdTo },
    { createdFrom: 'bad', createdTo: exact.createdTo }, { createdFrom: exact.createdTo, createdTo: exact.createdFrom },
    { createdFrom: exact.createdFrom, createdTo: exact.createdFrom },
    { createdFrom: '2026-02-30 01:00:00', createdTo: '2026-03-01 02:00:00' },
    { startDate: '2026-02-30' }, { endDate: '2026-09-20extra' }, { startDate: '2026-09-21', endDate: '2026-09-20' },
    { startTime: '08:00', endTime: '09:00' },
  ]) {
    const before = reads
    assert.equal((await get('/', query)).status, 400, JSON.stringify(query))
    assert.equal((await get('/report', query)).status, 400, JSON.stringify(query))
    assert.equal(reads, before, 'invalid range never reaches SQL')
  }
  console.log('PASS actual Returns GET/report SQLite: Reports cohort parity, UTC+7/mixed timestamp boundaries, inclusive minute, scope/cancellation/aggregates and invalid ranges')
})().catch(error => { console.error(error); process.exitCode = 1 })
