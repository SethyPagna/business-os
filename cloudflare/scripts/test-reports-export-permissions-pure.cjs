// Real report routers, analytics, SQLite queries and both permission policies.
// Only authentication and the D1 boundary are replaced. Denials must not even
// open the database; authorized export pages must equal ordinary report pages.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
const root = path.resolve(__dirname, '..', '..')
const cache = new Map()
let user, opens = 0, reads = 0, checks = 0
const sql = new Database(':memory:')
sql.exec(`
CREATE TABLE customers(id INTEGER PRIMARY KEY, is_anonymous INTEGER DEFAULT 0);
CREATE TABLE sales(id INTEGER PRIMARY KEY, created_at TEXT, sale_status TEXT, branch_id INTEGER, branch_name TEXT,
 cashier_name TEXT, cashier_id INTEGER, customer_id INTEGER, customer_name TEXT, customer_phone TEXT, receipt_number TEXT, payment_method TEXT,
 subtotal_usd REAL, discount_usd REAL DEFAULT 0, membership_discount_usd REAL DEFAULT 0, tax_usd REAL DEFAULT 0,
 total_usd REAL, delivery_fee_usd REAL DEFAULT 0, delivery_fee_paid_by TEXT DEFAULT 'customer', delivery_actual_cost_usd REAL,
 is_delivery INTEGER DEFAULT 0, delivery_contact_id INTEGER, delivery_contact_name TEXT, source_return_id INTEGER, amount_paid_usd REAL);
CREATE TABLE sale_items(id INTEGER PRIMARY KEY, sale_id INTEGER, cost_price_usd REAL, quantity REAL);
CREATE TABLE returns(id INTEGER PRIMARY KEY, sale_id INTEGER, created_at TEXT, branch_id INTEGER, return_number TEXT,
 receipt_number TEXT, customer_id INTEGER, customer_name TEXT, return_scope TEXT DEFAULT 'customer', return_type TEXT, reason TEXT,
 status TEXT DEFAULT 'completed', total_refund_usd REAL DEFAULT 0, total_refund_khr REAL DEFAULT 0);
CREATE TABLE return_items(id INTEGER PRIMARY KEY, return_id INTEGER, cost_price_usd REAL, quantity REAL, stock_action TEXT, return_to_stock INTEGER);
CREATE TABLE fees(id INTEGER PRIMARY KEY, created_at TEXT, fee_date TEXT, branch_id INTEGER, sale_id INTEGER, fee_type TEXT,
 label TEXT, notes TEXT, amount_usd REAL DEFAULT 0, amount_khr REAL DEFAULT 0);
CREATE TABLE branches(id INTEGER PRIMARY KEY, name TEXT);
INSERT INTO branches VALUES(2,'Shop'),(3,'Warehouse');
INSERT INTO sales(id,created_at,sale_status,branch_id,branch_name,cashier_name,cashier_id,customer_name,customer_phone,receipt_number,payment_method,subtotal_usd,total_usd)
 VALUES(1,'2026-09-04 02:00:00','completed',2,'Shop','Za',7,'Alice','0123','R1','Cash',100,100),
 (2,'2026-09-04T03:00:00.000Z','awaiting_payment',2,'Shop','Za',7,'Bob','0456','R2','Cash',200,200),
 (3,'2026-09-04 04:00:00','cancelled',2,'Shop','Za',7,'Void','','R3','Cash',900,900),
 (4,'2026-09-04 03:00:00','completed',3,'Warehouse','Other',8,'Other','','R4','ABA',500,500);
INSERT INTO sale_items VALUES(1,1,60,1),(2,2,120,1),(3,3,800,1);
INSERT INTO returns(id,sale_id,created_at,branch_id,return_number,receipt_number,customer_name,total_refund_usd) VALUES
 (1,1,'2026-09-04 05:00:00',2,'RET1','R1','Alice',23),
 (2,NULL,'2026-09-04T03:00:00.000Z',2,'RET2','R1','Alice',7),
 (3,NULL,'2026-09-04 04:00:00',2,'RET3','R1','Bob',11);
INSERT INTO return_items VALUES(1,1,10,1,'restock',1);
INSERT INTO fees VALUES(1,'2026-09-04 03:00:00','2026-09-04',2,NULL,'expense','Limes','',0,30000),
 (2,'2026-09-04T03:00:00.000Z','2026-09-04',2,NULL,'delivery','Grab','',0,14000),
 (3,'2026-09-04 04:00:00','2026-09-04',3,NULL,'expense','Other branch','',0,400);
`)
const db = { prepare(query) {
  reads++
  const bind = (params = {}) => {
    const values = []
    const text = query.replace(/@(\w+)/g, (_, key) => { values.push(params[key] ?? null); return '?' })
    return { stmt: sql.prepare(text), values }
  }
  return {
    get(params) { const b = bind(params); return b.stmt.get(...b.values) },
    all(params) { const b = bind(params); return b.stmt.all(...b.values) },
  }
} }
function load(filename) {
  if (cache.has(filename)) return cache.get(filename).exports
  const mod = { exports: {} }
  cache.set(filename, mod)
  let source = fs.readFileSync(filename, 'utf8')
  // Exercise the actual seed definition without changing its public API.
  if (filename.endsWith('coreDataInvariants.ts')) source += '\nexport { DEFAULT_ROLE_PERMISSIONS }\n'
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText
  new Function('require', 'module', 'exports', output)(name => {
    if (name === '../lib/auth') return { requireAuth: async (c, next) => {
      if (!user) return c.json({ error: 'Unauthenticated' }, 401)
      c.set('user', user)
      return next()
    } }
    if (name === '../lib/db' || name === './db') return { getDb: () => { opens++; return db } }
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name.endsWith('.ts') ? name : `${name}.ts`))
    return require(name)
  }, mod, mod.exports)
  return mod.exports
}
const app = load(path.join(root, 'cloudflare/src/routes/reports.ts')).default
const seeds = load(path.join(root, 'cloudflare/src/lib/coreDataInvariants.ts')).DEFAULT_ROLE_PERMISSIONS
const frontend = load(path.join(root, 'frontend/src/utils/permissions.ts'))
const { actionAllowed, isActionOverriddenOff } = load(path.join(root, 'frontend/src/utils/permissionActions.ts'))
const staff = (role = {}, overrides = {}) => ({ id: 17, username: 'employee', role_code: 'employee',
  role_permissions: JSON.stringify(role), permissions: JSON.stringify(overrides) })
const domains = { sales: 'sales', returns: 'returns', expenses: 'fees' }
function frontendAllows(session, domain, exporting) {
  const merged = frontend.getEffectivePermissionMap(session)
  const admin = frontend.isAdminControlUser(session)
  const tier = frontend.getPermissionTierFromMap(merged, domain, admin)
  const action = key => actionAllowed(domain, key, tier,
    name => frontend.getPermissionTierFromMap(merged, name, admin) === 'full',
    (area, name) => !admin && isActionOverriddenOff(merged, area, name))
  return action('view') && (!exporting || action('export'))
}
async function request(kind, session, query = '', method = 'GET') {
  user = session
  opens = reads = 0
  const response = await app.request(`http://local/business-summary/${kind}?startDate=2026-09-04&endDate=2026-09-04&branchId=2&${query}`, { method }, {})
  checks++
  return { status: response.status, body: method === 'HEAD' ? null : await response.json(), opens, reads }
}
async function expectDenied(kind, session, query = 'intent=export', status = 403, method = 'GET') {
  const result = await request(kind, session, query, method)
  assert.equal(result.status, status, `${kind} ${query}: expected ${status}`)
  assert.equal(result.opens, 0, `${kind}: denial must precede opening the DB/kernel`)
  assert.equal(result.reads, 0, `${kind}: denial must precede SQL`)
}
async function samePage(kind, session, query = '') {
  const view = await request(kind, session, query)
  const exported = await request(kind, session, `${query}&intent=export`)
  assert.equal(view.status, 200, `${kind}: normal view still works`)
  assert.equal(exported.status, 200, `${kind}: authorized export works`)
  assert.deepEqual(exported.body, view.body, `${kind}: export preserves the real query/projection/page contract`)
  assert.ok(exported.reads > 0, `${kind}: real SQL was exercised`)
  return exported.body
}
async function main() {
  for (const kind of ['sales', 'returns']) {
    const employee = staff(seeds.employee)
    assert.equal((await request(kind, employee)).status, 200, 'seeded Employee retains report tabs')
    await expectDenied(kind, employee)
    await expectDenied(kind, employee, 'intent=export', 403, 'HEAD')
  }
  for (const [kind, domain] of Object.entries(domains)) {
    for (const invalid of ['', 'view', 'csv', 'EXPORT', '%20export', 'export&intent=view', 'export&intent=export']) {
      await expectDenied(kind, staff({ all: true }), `intent=${invalid}`, 400)
    }
    await expectDenied(kind, null, 'intent=export', 401)
    const sessions = [staff(), staff(seeds.employee),
      staff({ [domain]: true }), staff({ [domain]: 'view' }), staff({ [domain]: 'review' }),
      staff({ [domain]: true, [`${domain}:export`]: false }),
      staff({ [domain]: true }, { [`${domain}:export`]: false }),
      staff({ [domain]: true, [`${domain}:export`]: false }, { [`${domain}:export`]: true }),
      staff({ [domain]: true }, { [`${domain}:view`]: false }),
      staff({ [domain]: true, [`${domain}:view`]: false }, { [`${domain}:view`]: true }),
      staff({ [domain]: true }, { [domain]: false }),
      staff({ [`${domain}:export`]: true }),
      staff({ sales: true, returns: true, fees: true, [domain]: false }),
      staff({ all: true }, { [`${domain}:view`]: false, [`${domain}:export`]: false }),
      { ...staff({}, { [`${domain}:export`]: false }), username: ' ADMIN ' },
      { ...staff({}, { [`${domain}:view`]: false }), role_code: ' AdMiN ' },
      staff({ all: true }, { all: false }),
    ]
    for (const junk of ['true', 'false', 1, {}, [], null]) {
      sessions.push(staff({ [domain]: junk }), staff({ all: junk }),
        staff({ [domain]: true }, { [`${domain}:export`]: junk }),
        staff({ [domain]: true, [`${domain}:export`]: false }, { [`${domain}:export`]: junk }))
    }
    for (const session of sessions) for (const exporting of [false, true]) {
      const allowed = frontendAllows(session, domain, exporting)
      const result = await request(kind, session, exporting ? 'intent=export' : '')
      assert.equal(result.status, allowed ? 200 : 403,
        `${kind}: API/frontend parity (export=${exporting}) ${JSON.stringify(session)}`)
      if (!allowed) {
        assert.equal(result.opens, 0, `${kind}: denied before DB/kernel`)
        assert.equal(result.reads, 0, `${kind}: denied before SQL`)
      } else assert.ok(result.reads > 0, `${kind}: granted route executes actual query`)
    }
    const authorized = staff({ [domain]: true })
    const first = await samePage(kind, authorized, 'order=desc&pageSize=1')
    assert.equal(first.has_more, true)
    assert.equal(first.rows.length, 1)
    const cursor = first.next_cursor
    const second = await samePage(kind, authorized,
      `order=desc&pageSize=1&snapshotMaxId=${first.snapshot_max_id}&afterCreatedAt=${encodeURIComponent(cursor.created_at)}&afterId=${cursor.id}`)
    assert.ok(second.rows.every(row => row.id !== first.rows[0].id), 'cursor advances without repeats')
    const filtered = await samePage(kind, authorized, `q=${kind === 'expenses' ? 'Limes' : 'Alice'}`)
    assert.deepEqual(filtered.rows.map(row => row.id), kind === 'returns' ? [2, 1] : [1], 'search selects actual matching records')
    const timed = await samePage(kind, authorized, 'createdFrom=2026-09-04%2002:30:00&createdTo=2026-09-04%2004:00:00')
    assert.deepEqual(timed.rows.map(row => row.id), kind === 'expenses' ? [1, 2] : [2], 'date-time filter and branch scope persist')
  }
  const plain = await samePage('sales', staff({ sales: true }), 'q=Alice')
  for (const key of ['cost_usd', 'cost_before_floor_usd', 'gross_profit_usd']) assert.equal(key in plain.rows[0], false)
  for (const session of [staff({ sales: true, product_cost_view: true }), staff({ all: true })]) {
    const cost = await samePage('sales', session, 'q=Alice')
    assert.equal(cost.rows[0].cost_usd, 50)
    assert.equal(cost.rows[0].gross_profit_usd, 27)
  }
  const statusFiltered = await samePage('sales', staff({ sales: true }), 'status=awaiting_payment&paymentMethod=Cash')
  assert.deepEqual(statusFiltered.rows.map(row => row.id), [2])
  console.log(`PASS reports export intent: ${checks} real Hono requests; frontend parity, pre-read denials and unchanged report pages`)
}
main().finally(() => sql.close()).catch(error => { console.error(error); process.exitCode = 1 })
