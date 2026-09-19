const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')
const root = path.join(__dirname, '../src')
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const raw = new DatabaseSync(':memory:')
raw.exec(`
  CREATE TABLE fees(id INTEGER PRIMARY KEY,fee_type TEXT,label TEXT,notes TEXT,amount_usd REAL,amount_khr REAL,fee_date TEXT,created_at TEXT,sale_id INTEGER,branch_id INTEGER,delivery_contact_id INTEGER);
  CREATE TABLE sales(id INTEGER PRIMARY KEY,receipt_number TEXT);
  CREATE TABLE branches(id INTEGER PRIMARY KEY,name TEXT);
  CREATE TABLE delivery_contacts(id INTEGER PRIMARY KEY,name TEXT);
  INSERT INTO branches VALUES(1,'Shop'),(2,'Warehouse');
  INSERT INTO fees VALUES
    (1,'expense','A','',1,0,'2026-09-20','2026-09-19T16:59:59Z',NULL,1,NULL),
    (2,'expense','B','',2,0,'2026-09-18','2026-09-19 17:00:00',NULL,1,NULL),
    (3,'expense','C','',3,0,'2026-09-20','2026-09-19T17:00:59.999Z',NULL,2,NULL),
    (4,'expense','D','',4,0,'2026-09-20','2026-09-19T17:01:00Z',NULL,1,NULL),
    (5,'expense','E','',5,0,'2026-09-21','2026-09-20T18:30:00Z',NULL,1,NULL),
    (6,'expense','F','',6,0,'2026-09-20','2026-09-20 15:00:00',NULL,1,NULL);
`)
const db = { prepare(sql) { return {
  async all(params = {}) { return raw.prepare(sql).all(params) },
  async get(params = {}) { return raw.prepare(sql).get(params) },
} } }
const moduleObj = { exports: {} }
new Function('exports', 'require', 'module', compile(fs.readFileSync(path.join(root, 'routes/fees.ts'), 'utf8')))(moduleObj.exports, request => {
  if (request === 'hono') return require('hono')
  if (request === '../lib/db') return { getDb: () => db }
  if (request === '../lib/auth') return { requireAuth: async (c, next) => { c.set('user', { id: 1, role: 'admin' }); await next() } }
  if (request === '../lib/permissions') return { getPermissionTier: () => 'full', getActionTier: () => 'full' }
  return {} // Write-only integrations are not invoked by these real GET routes.
}, moduleObj)
const app = moduleObj.exports.default
const get = async (route, query) => {
  const response = await app.request(`${route}?${new URLSearchParams(query)}`, {}, {})
  return { status: response.status, body: await response.json() }
}
function extractFunction(file, name) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  return ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast)
}
const reportModule = { exports: {} }
new Function('exports', 'module', compile(extractFunction('lib/salesAnalytics.ts', 'shiftWindowBound') + '\n' + extractFunction('routes/reports.ts', 'reportRecordRange')))(reportModule.exports, reportModule)

;(async () => {
  const day = { from: '2026-09-20', to: '2026-09-20' }
  const exact = { ...day, createdFrom: '2026-09-19 17:00:00', createdTo: '2026-09-19 17:01:00' }
  const full = await get('/', day)
  assert.equal(full.status, 200)
  assert.deepEqual(full.body.fees.map(row => row.id), [6, 4, 3, 1], 'full days use booked date, not entry date')
  for (const filter of [day, exact, { from: '2026-09-20', to: '2026-09-21', createdFrom: '2026-09-20 15:00:00', createdTo: '2026-09-20 19:01:00' }]) {
    const list = await get('/', filter)
    const report = await get('/report', filter)
    assert.equal(list.status, 200)
    assert.equal(report.status, 200)
    assert.equal(list.body.total, report.body.totals.count)
    assert.equal(list.body.summary.reduce((sum, row) => sum + row.total_usd, 0), report.body.totals.amount_usd)
    const predicate = reportModule.exports.reportRecordRange('expenses', 'f', { startDate: filter.from, endDate: filter.to,
      createdFrom: filter.createdFrom, createdTo: filter.createdTo })
    const expected = raw.prepare(`SELECT id FROM fees f WHERE ${predicate.sql} ORDER BY f.fee_date DESC,f.id DESC`).all(predicate.params).map(row => row.id)
    assert.deepEqual(list.body.fees.map(row => row.id), expected, 'Expenses and Reports select the same cohort')
  }
  const timed = await get('/', exact)
  assert.deepEqual(timed.body.fees.map(row => row.id), [3, 2], 'start inclusive, whole selected minute included, next minute excluded across stored timestamp formats')
  assert.equal((await get('/', { ...exact, limit: '1', offset: '0' })).body.fees[0].id, 3)
  const second = await get('/', { ...exact, limit: '1', offset: '1' })
  assert.equal(second.body.fees[0].id, 2)
  assert.equal(second.body.total, 2)
  assert.equal((await get('/', { ...exact, branch_id: '1' })).body.total, 1)
  assert.equal((await get('/report', { ...exact, branchId: '1' })).body.totals.count, 1)
  const offset = await get('/', { createdFrom: '2026-09-20T00:00:00+07:00', createdTo: '2026-09-20T00:01:00+07:00' })
  assert.deepEqual(offset.body.fees.map(row => row.id), [3, 2])
  for (const query of [
    { createdFrom: exact.createdFrom }, { createdFrom: 'bad', createdTo: exact.createdTo },
    { createdFrom: exact.createdTo, createdTo: exact.createdFrom },
    { createdFrom: '2026-02-30 01:00:00', createdTo: '2026-03-01 02:00:00' },
    { from: '2026-02-30' }, { from: '2026-09-21', to: '2026-09-20' }, { startTime: '08:00', endTime: '09:00' },
  ]) {
    assert.equal((await get('/', query)).status, 400, JSON.stringify(query))
    assert.equal((await get('/report', query)).status, 400, JSON.stringify(query))
  }
  console.log('PASS native Expenses GET/report: booked dates, continuous entry timestamps, Reports parity, UTC+7/end boundaries, pagination, totals and invalid ranges')
})().catch(error => { console.error(error); process.exitCode = 1 })
