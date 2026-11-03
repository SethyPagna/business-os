'use strict'
// P2.8-F S1 sweep (3 Nov 2026): every other list that searches a column the response masks reads it through the masking rule.
//
// test-phone-search-masked-columns-pure.cjs covers Sales and Returns. The same mismatch sat in every list that LIKE-matches a name, label or
// note: a value that is wholly a phone shows `093 *** 789`, and a fragment typed into the search found the row. Each list below now asks the
// projection's rule (lib/phoneAccess.ts keyMaskOf, through lib/phoneSearchGuard.ts restrictedColumnSql / searchableColumnSql / restrictedTextOf):
//   Reports > Sales (JS row filter)      salesReportSearchMatcher
//   Audit log (user, device, table)      lib/auditLogQuery.ts buildAuditLogFilters
//   Stock-in sessions (supplier, user)   lib/stockInSessionsQuery.ts buildStockInSessionListQuery
//   Movement log (product, branch, actor, reason)   lib/movementSearch.ts movementSearchHaystackSql
// and, where the search SQL lives inside the route handler (Reports > Returns / Expenses, Expenses list, Shift list, and the wiring of the two
// libs above), the source is pinned so a handler cannot go back to the raw column. Part 5: MUTANTS.
//
// Run (from cloudflare/): node scripts/test-phone-search-other-lists-pure.cjs
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { replaceOnce, readSrc, libLoader } = require('./harness/phone_route_slices.cjs')

const CLOSED = { fullPhone: false }
const OPEN = { fullPhone: true }

function world(lib = {}) {
  const load = libLoader(lib)
  return { load, guard: load('phoneSearchGuard'), audit: load('auditLogQuery'), movement: load('movementSearch'), sessions: load('stockInSessionsQuery') }
}

function run(w, source = {}) {
  const failures = []
  const check = (name, fn) => { try { fn() } catch (error) { failures.push(`${name}: ${String(error && error.message || error).split('\n')[0]}`) } }
  const src = (rel) => (source[rel] || ((text) => text))(readSrc(rel))

  // ---- 1. Reports > Sales: the JS row filter ------------------------------------------------------------------------------------------
  check('Reports > Sales: a customer saved under a number is not found by a fragment of it; the whole number, the name and the phone rules are unchanged', () => {
    const rows = [
      { id: 1, receipt_number: 'P28-0301', customer: '093 456 789', cashier: 'admin', branch: 'main', payment_method: 'cash', customer_phone: '' },
      { id: 2, receipt_number: 'P28-0302', customer: 'Dara', cashier: 'admin', branch: 'main', payment_method: 'cash', customer_phone: '087 654 321' },
    ]
    const found = (search, access) => rows.filter(w.guard.salesReportSearchMatcher(search, access)).map((row) => row.id)
    assert.deepEqual(found('456', CLOSED), [], 'no grant: a fragment of the number-as-name')
    assert.deepEqual(found('456', OPEN), [1], 'holder')
    assert.deepEqual(found('093456789', CLOSED), [1], 'the whole number still finds it')
    assert.deepEqual(found('dara', CLOSED), [2])
    assert.deepEqual(found('admin', CLOSED), [1, 2])
    assert.deepEqual(found('654', CLOSED), [], 'the phone column is never matched by substring')
    assert.deepEqual(found('654', OPEN), [2])
  })

  // ---- 2. the audit log ---------------------------------------------------------------------------------------------------------------
  check('Audit log: a user, device or table saved under a number is not found by a fragment of it; ordinary names are', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, user_id INTEGER, user_name TEXT, action TEXT, entity TEXT, table_name TEXT, details TEXT, old_value TEXT, new_value TEXT, device_name TEXT, entity_id TEXT, record_id TEXT, created_at TEXT)')
    const insert = db.prepare('INSERT INTO audit_logs (id, user_name, action, device_name, table_name) VALUES (?, ?, ?, ?, ?)')
    insert.run(1, '093 456 789', 'login', 'Till 1', 'sessions')
    insert.run(2, 'Dara', 'sale_edit', 'Till 1', 'sales')
    insert.run(3, 'Sokha', 'login', '094 555 818', 'sessions')
    insert.run(4, 'Sokha', 'login', 'Till 2', '095 777 626')
    const found = (search, phoneTextBlocked) => {
      const { where, params } = w.audit.buildAuditLogFilters({ search, phoneTextBlocked })
      return db.prepare(`SELECT id FROM audit_logs ${where} ORDER BY id`).all(params).map((row) => row.id)
    }
    assert.deepEqual(found('456', true), [], 'user saved under a number')
    assert.deepEqual(found('555', true), [], 'device saved under a number')
    assert.deepEqual(found('777', true), [], 'table saved under a number')
    assert.deepEqual(found('456', false), [1], 'holder: the user')
    assert.deepEqual(found('555', false), [3], 'holder: the device')
    assert.deepEqual(found('777', false), [4], 'holder: the table')
    assert.deepEqual(found('dara', true), [2])
    assert.deepEqual(found('till', true), [1, 2, 4])
    assert.deepEqual(found('sokha', true), [3, 4])
    assert.deepEqual(found('sale edit', true), [2])
  })

  // ---- 3. the stock-in session list ----------------------------------------------------------------------------------------------------
  check('Stock-in sessions: a supplier or actor saved under a number is not found by a fragment of it; ordinary names are', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE stock_lines (session_key TEXT, created_at TEXT, received_at TEXT, branch_id INTEGER, branch_name TEXT, user_name TEXT, user_id INTEGER, supplier_id INTEGER,
      supplier_name TEXT, supplier_state TEXT, quantity INTEGER, reverted INTEGER, total_cost_usd REAL, cost_missing INTEGER, payment_state TEXT, payment_status TEXT,
      credit_due_date TEXT, barcode TEXT, product_name TEXT)`)
    const insert = db.prepare(`INSERT INTO stock_lines (session_key, created_at, received_at, branch_id, branch_name, user_name, user_id, supplier_id, supplier_name, supplier_state, quantity,
      reverted, total_cost_usd, cost_missing, payment_state, payment_status, credit_due_date, barcode, product_name) VALUES (?, '2026-11-03', '2026-11-03', 1, 'Main', ?, 1, 1, ?, 's', 1, 0, 1, 0, 'p', 'paid', NULL, '1001', 'Lip Oil')`)
    insert.run('session:1', 'james', '094 555 818')
    insert.run('session:2', '096 321 987', 'Bong Long')
    insert.run('session:3', 'james', 'Bong Long')
    const found = (search, access) => {
      const readable = (sql, key) => w.guard.searchableColumnSql({ sql, key }, access)
      const { groupedSql, params } = w.sessions.buildStockInSessionListQuery(search, readable)
      // The real statement groups the movement ledger; the grouping and HAVING are what is under test, so the row source is the fixture lines.
      const statement = groupedSql.replace(/FROM \([\s\S]*?\) s\s+GROUP BY session_key/, 'FROM stock_lines s GROUP BY session_key')
      assert.ok(statement !== groupedSql, 'the row source was swapped for the fixture')
      return db.prepare(statement).all(params).map((row) => row.session_key).sort()
    }
    assert.deepEqual(found('555', CLOSED), [], 'supplier saved under a number')
    assert.deepEqual(found('321', CLOSED), [], 'user saved under a number')
    assert.deepEqual(found('555', OPEN), ['session:1'], 'holder: the supplier')
    assert.deepEqual(found('321', OPEN), ['session:2'], 'holder: the user')
    assert.deepEqual(found('bong', CLOSED), ['session:2', 'session:3'])
    assert.deepEqual(found('james', CLOSED), ['session:1', 'session:3'])
  })

  // ---- 4. the movement log -------------------------------------------------------------------------------------------------------------
  check('Movement log: an actor, branch, product or reason saved under a number is not found by a fragment of it; ordinary text is', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, name TEXT); CREATE TABLE branches (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY, product_name TEXT, branch_id INTEGER, branch_name TEXT, user_id INTEGER, user_name TEXT, movement_type TEXT, reason TEXT)`)
    db.exec("INSERT INTO users VALUES (1, 'james', 'James'); INSERT INTO branches VALUES (1, 'Main')")
    const insert = db.prepare('INSERT INTO inventory_movements (id, product_name, branch_id, branch_name, user_id, user_name, movement_type, reason) VALUES (?, ?, 1, ?, ?, ?, ?, ?)')
    insert.run(1, 'Lip Oil', 'Main', null, '094 555 818', 'add', 'damaged box')
    insert.run(2, 'Lip Oil', 'Main', 1, 'James', 'add', 'refund to "093 456 789" requested')
    insert.run(3, 'Lip Oil', '095 777 626', 1, 'James', 'add', 'recount')
    insert.run(4, 'Cream', 'Main', 1, 'James', 'add', 'batch 4471 recount')
    const found = (needle, access) => {
      const haystack = w.movement.movementSearchHaystackSql('inventory_movements', (sql, key) => w.guard.searchableColumnSql({ sql, key }, access))
      return db.prepare(`SELECT id FROM inventory_movements WHERE lower(COALESCE(${haystack}, '')) LIKE @needle ORDER BY id`).all({ needle: `%${needle}%` }).map((row) => row.id)
    }
    assert.deepEqual(found('555', CLOSED), [], 'actor saved under a number')
    assert.deepEqual(found('456', CLOSED), [], 'reason quoting a number')
    assert.deepEqual(found('777', CLOSED), [], 'branch saved under a number')
    assert.deepEqual(found('555', OPEN), [1])
    assert.deepEqual(found('456', OPEN), [2])
    assert.deepEqual(found('777', OPEN), [3])
    assert.deepEqual(found('damaged', CLOSED), [1])
    assert.deepEqual(found('4471', CLOSED), [4], 'a digit word inside an ordinary reason')
    assert.deepEqual(found('james', CLOSED), [2, 3, 4])
    assert.deepEqual(found('lip oil', CLOSED), [1, 2, 3])
    assert.deepEqual(w.movement.movementSearchHaystackSql('inventory_movements'), w.movement.movementSearchHaystackSql('inventory_movements', (sql) => sql), 'the holder form is the form before this change')
  })

  // ---- D1 refuses a statement over 100 KB, an expression tree over depth 100 and a LIKE or GLOB pattern over 50 bytes ----------------------
  check('the audit, movement and stock-in statements stay inside D1\'s limits for a search of eight words', () => {
    const { DatabaseSync } = require('node:sqlite')
    const d1 = new DatabaseSync(':memory:', { limits: { exprDepth: 100, sqlLength: 100000, likePatternLength: 50 } })
    d1.exec(`CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, user_id INTEGER, user_name TEXT, action TEXT, entity TEXT, table_name TEXT, details TEXT, old_value TEXT, new_value TEXT, device_name TEXT, entity_id TEXT, record_id TEXT, created_at TEXT);
      CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, name TEXT); CREATE TABLE branches (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY, product_name TEXT, branch_id INTEGER, branch_name TEXT, user_id INTEGER, user_name TEXT, movement_type TEXT, reason TEXT);
      CREATE TABLE stock_lines (session_key TEXT, created_at TEXT, received_at TEXT, branch_id INTEGER, branch_name TEXT, user_name TEXT, user_id INTEGER, supplier_id INTEGER, supplier_name TEXT, supplier_state TEXT,
        quantity INTEGER, reverted INTEGER, total_cost_usd REAL, cost_missing INTEGER, payment_state TEXT, payment_status TEXT, credit_due_date TEXT, barcode TEXT, product_name TEXT)`)
    const words = Array.from({ length: 8 }, (_, i) => `word${i}x`)
    const audit = w.audit.buildAuditLogFilters({ search: words.join(' '), phoneTextBlocked: true, startDate: '2026-11-01', endDate: '2026-11-03' })
    assert.doesNotThrow(() => d1.prepare(`SELECT id FROM audit_logs ${audit.where}`), 'audit log, 8 words, blocked reader')
    const readable = (sql, key) => w.guard.searchableColumnSql({ sql, key }, CLOSED)
    const haystack = w.movement.movementSearchHaystackSql('inventory_movements', readable)
    const movement = `SELECT id FROM inventory_movements WHERE (${words.map((_, i) => `lower(${haystack}) LIKE @t${i}`).join(' AND ')}) AND user_id = 1 AND branch_id = 1`
    assert.doesNotThrow(() => d1.prepare(movement), 'movement log, 8 terms')
    assert.ok(movement.length < 100000, `movement statement ${movement.length} bytes`)
    const sessions = w.sessions.buildStockInSessionListQuery('word0x', readable).groupedSql.replace(/FROM \([\s\S]*?\) s\s+GROUP BY session_key/, 'FROM stock_lines s GROUP BY session_key')
    assert.doesNotThrow(() => d1.prepare(sessions), 'stock-in sessions')
    assert.doesNotThrow(() => d1.prepare(`SELECT id FROM audit_logs WHERE ${w.guard.restrictedColumnSql('user_name')} LIKE @s`), 'a single restricted column')
  })

  // ---- 5. wiring: the handlers that carry their search SQL themselves ------------------------------------------------------------------
  check('Expenses list: the label and the note are read through the account\'s phone access', () => {
    const fees = src('routes/fees.ts')
    assert.ok(fees.includes("searchableColumnSql('f.label', access)") && fees.includes("searchableColumnSql('f.notes', access)"), 'fees search')
    assert.ok(fees.includes('const access = phoneSearchAccessOf(c.get(\'user\'))'), 'fees search takes the account\'s access')
  })
  check('Shift list: the user name is read through the account\'s phone access', () => {
    assert.ok(src('routes/shifts.ts').includes("${searchableColumnSql('user_name', phoneSearchAccessOf(user))} LIKE @search"), 'shift search')
  })
  check('Reports > Returns and Expenses: every searched field is read through the projection\'s rule', () => {
    const reports = src('routes/reports.ts')
    assert.ok(reports.includes('const unrestricted = phoneSearchAccessOf(user).fullPhone'), 'reports record search takes the account\'s access')
    assert.ok(reports.includes('restrictedColumnSql(`${alias}.${name}`)'), 'every field goes through restrictedColumnSql')
    assert.ok(!reports.includes('hideNumericName'), 'the single-column special case is gone')
  })
  check('Stock-in sessions and Movement log routes pass the account\'s phone access into the shared query', () => {
    assert.ok(src('routes/products.ts').includes("buildStockInSessionListQuery(c.req.query('search'), (sql, key) => searchableColumnSql({ sql, key }, phoneSearchAccessOf(user)))"), 'stock-in sessions route')
    assert.ok(src('routes/inventory.ts').includes("movementSearchHaystackSql('inventory_movements', (sql, key) => searchableColumnSql({ sql, key }, phoneAccess))"), 'movements route')
  })
  check('the helpers that read a column for an account: a holder gets the column as stored, everybody else the rule', () => {
    assert.equal(w.guard.searchableColumnSql('f.notes', OPEN), 'f.notes')
    assert.equal(w.guard.searchableColumnSql({ sql: 'x.y', key: 'notes' }, OPEN), 'x.y')
    assert.equal(w.guard.searchableColumnSql('f.notes', CLOSED), w.guard.restrictedColumnSql('f.notes'))
    assert.equal(w.guard.searchableColumnSql('f.fee_type', CLOSED), "COALESCE(f.fee_type,'')")
  })
  return failures
}

const MUTANTS = [
  ['rule: a name or note that is a number is not masked in search', { lib: { phoneAccess: replaceOnce("if (kind & NAME) return 'name'", "if (kind & NAME) return 'none'") } }],
  ['reports sales: the customer is read raw', { lib: { phoneSearchGuard: replaceOnce("restrictedTextOf(key, row[key] || '').toLowerCase().includes(search)", 'text(row, key).includes(search)') } }],
  ['audit: the name columns are read raw', { lib: { auditLogQuery: replaceOnce("input.phoneTextBlocked && keyMaskOf(column) === 'name'", 'false') } }],
  ['stock-in sessions: the supplier is read raw', { lib: { stockInSessionsQuery: replaceOnce("readable('s.supplier_name', 'supplier_name')", "'s.supplier_name'") } }],
  ['stock-in sessions: the actor is read raw', { lib: { stockInSessionsQuery: replaceOnce("readable('s.user_name', 'user_name')", "'s.user_name'") } }],
  ['movements: the actor is read raw', { lib: { movementSearch: replaceOnce("readable(movementActorNameSql(alias), 'user_name')", 'movementActorNameSql(alias)') } }],
  ['movements: the reason is read raw', { lib: { movementSearch: replaceOnce("readable(`${alias}.reason`, 'reason')", '`${alias}.reason`') } }],
  ['movements: the branch is read raw', { lib: { movementSearch: replaceOnce("readable(movementBranchNameSql(alias), 'branch_name')", 'movementBranchNameSql(alias)') } }],
  ['expenses list: the note is read raw', { source: { 'routes/fees.ts': replaceOnce("searchableColumnSql('f.notes', access)", "'f.notes'") } }],
  ['expenses list: the label is read raw', { source: { 'routes/fees.ts': replaceOnce("searchableColumnSql('f.label', access)", "'f.label'") } }],
  ['shift list: the user name is read raw', { source: { 'routes/shifts.ts': replaceOnce("${searchableColumnSql('user_name', phoneSearchAccessOf(user))} LIKE @search", 'user_name LIKE @search') } }],
  ['reports records: the fields are read raw', { source: { 'routes/reports.ts': replaceOnce('restrictedColumnSql(`${alias}.${name}`)', '`COALESCE(${alias}.${name}, \'\')`') } }],
  ['stock-in sessions route: the account\'s access is not passed', { source: { 'routes/products.ts': replaceOnce("(sql, key) => searchableColumnSql({ sql, key }, phoneSearchAccessOf(user))", '(sql) => sql') } }],
  ['movements route: the account\'s access is not passed', { source: { 'routes/inventory.ts': replaceOnce("(sql, key) => searchableColumnSql({ sql, key }, phoneAccess)", '(sql) => sql') } }],
  ['helper: a restricted account reads the column raw', { lib: { phoneSearchGuard: replaceOnce('  return restrictedColumnSql(column)\n}\n\n/** The parts of a restricted haystack', '  return typeof column === \'string\' ? column : column.sql\n}\n\n/** The parts of a restricted haystack') } }],
]

const failures = run(world())
if (failures.length) {
  for (const failure of failures) console.error(`RED ${failure}`)
  console.error(`FAIL ${failures.length} check(s)`)
  process.exit(1)
}
let survivors = 0
let killed = 0
for (const [name, options] of MUTANTS) {
  const outcome = run(world(options.lib || {}), options.source || {})
  if (outcome.length) { killed += 1; console.log(`killed   ${name} (${outcome.length} red)`) } else { survivors += 1; console.error(`SURVIVED ${name}`) }
}
if (survivors) { console.error(`FAIL ${survivors} mutant(s) survived`); process.exit(1) }
console.log(`PASS phone search other lists: all checks green, ${killed} mutants killed`)
