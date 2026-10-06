// Branch cutover end to end (lane LB): the real parent (registry v3) and the certified child, driven
// phase by phase on a production-shaped native SQLite fixture (every migration, depth 100, 100 binds):
//   both branches, shared batches, lots on different dates, same-date lots with different costs,
//   untracked stock, fractional stock, a retired legacy "Shop" row, history rows of every applier
//   family (design §1.3), blank historical labels, an aborted prior run, and faults injected at
//   every stage: crash before commit, lost acknowledgement after commit, process kill between pages
//   (fresh module instances), kill between seal and execute, duplicate (at-least-once) delivery.
// After EVERY invocation an independent check proves per-product and per-date-lot conservation and that
// both stock ledgers agree. The end state is checked unit by unit against a baseline read before begin.
// Discriminating controls (source mutations) must turn the run RED: name-keyed admission, name-keyed
// finalize, unweighted (mean) cost, a CAS-less parent under duplicate delivery, a missing history close
// stage and a missing classification rule, and one per owner lot rule: the UTC date instead of the Cambodia
// business day (E4), an unrounded blend (E5), a supplier-blind merge (E6), $0 weighted as a real cost, and
// strict REAL lots-versus-stock comparisons that stop the run on exact decimals (E3).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const { seedHistoryFamilies } = require('./test-branch-cutover-history-pure.cjs')
const root = path.resolve(__dirname, '..')

const CONTROLS = {
  'name-admission': [['lib/branchCutoverParent.ts', [
    ["const rows = await db.prepare('SELECT * FROM branches WHERE id IN (@source,@target) ORDER BY id')", "const rows = await db.prepare(\"SELECT * FROM branches WHERE lower(trim(name)) IN ('shop','warehouse') ORDER BY id\")"],
    ['const source = rows.find(row => row.id === identity.sourceBranchId), target = rows.find(row => row.id === identity.targetBranchId)',
      "const source = rows.findLast(row => String(row.name).trim().toLowerCase() === 'shop'), target = rows.findLast(row => String(row.name).trim().toLowerCase() === 'warehouse')"]]]],
  'name-finalize': [['lib/branchCutoverParent.ts', [
    ["WHERE id=@source AND canonical_key='shop' AND is_active=1`", "WHERE lower(trim(name))='shop'`"],
    ["WHERE id=@target AND canonical_key='warehouse' AND is_active=1`", "WHERE lower(trim(name))='warehouse'`"]]]],
  mean: [['lib/branchCutoverParent.ts', [[`weightedMeanMoney4(priced.map(fact => ({ amount: fact.lot.cost as number, factor: decimalText(fact.quantity) })),
            decimalText(priced.reduce((sum, fact) => sum + fact.quantity, 0n)))`, 'priced.reduce((s, fact) => s + Number(fact.lot.cost), 0) / priced.length']]]],
  'utc-slice': [['lib/branchCutoverParent.ts', [['  return localDateOf(text) || null', '  return text.slice(0, 10)']]]],
  'no-round': [['lib/branchCutoverParent.ts', [[`weightedMeanMoney4(priced.map(fact => ({ amount: fact.lot.cost as number, factor: decimalText(fact.quantity) })),
            decimalText(priced.reduce((sum, fact) => sum + fact.quantity, 0n)))`,
    'priced.reduce((s, fact) => s + Number(fact.lot.cost) * Number(decimalText(fact.quantity)), 0) / priced.reduce((s, fact) => s + Number(decimalText(fact.quantity)), 0)']]]],
  'supplier-blind': [['lib/branchCutoverParent.ts', [["  if (typeof lot.supplierId === 'number' && Number.isSafeInteger(lot.supplierId)) return 'id:' + lot.supplierId", "  if (lot) return ''"]]]],
  // owner 6 Oct (final): $0 + unknown merge to UNKNOWN. Keeping them apart, or giving the merged lot $0, must fail.
  'free-unknown-apart': [['lib/branchCutoverParent.ts', [["? 'recorded' : 'none'", "? 'recorded' : fact.costClass"]]]],
  'free-unknown-zero': [['lib/branchCutoverParent.ts', [["} else if (members.some(fact => fact.costClass === 'unknown')) costAfter = null",
    "} else if (members.some(fact => fact.costClass === 'unknown')) costAfter = members.some(fact => fact.costClass === 'zero') ? 0 : null"]]]],
  // owner 6 Oct: the DATE decides, whatever text stored it. Keying a slash date as its own text, or reading it day-first, must fail.
  'slash-apart': [['lib/branchCutoverParent.ts', [['  if (slash) {', '  if (slash) return text\n  if (slash) {']]]],
  'slash-day-first': [['lib/branchCutoverParent.ts', [['const [month, day, year] = [Number(slash[1]), Number(slash[2]), Number(slash[3])]', 'const [month, day, year] = [Number(slash[2]), Number(slash[1]), Number(slash[3])]']]]],
  'zero-weighted': [['lib/branchCutoverParent.ts', [["const priced = members.filter(fact => fact.costClass === 'recorded')", "const priced = members.filter(fact => fact.costClass !== 'unknown')"]]]],
  'strict-real-sums': [['lib/branchCutoverParent.ts', [['product_id=b.variant_product_id),0)+1e-9) AS lotExcess', 'product_id=b.variant_product_id),0)) AS lotExcess'],
    ['product_id=@last AND branch_id=@target),0)+1e-9`', 'product_id=@last AND branch_id=@target),0)`'], ['AND branch_id=@target),0)+1e-9)`,', 'AND branch_id=@target),0))`,']]]],
  double: [['lib/branchCutoverParent.ts', [['const results = await target.batchOnce([...before, ...statements, ...after])',
    "const strip = (list: CutoverStatement[]) => list.filter(s => !s.sql.startsWith('SELECT CASE WHEN')); const results = await target.batchOnce([...strip(before), ...statements, ...strip(after)])"],
    ['return results.slice(before.length, before.length + statements.length)', "return results.slice(before.filter(s => !s.sql.startsWith('SELECT CASE WHEN')).length)"]]],
  ['lib/branchCutoverJournal.ts', [['const statements: Statement[] = [{ sql: `SELECT CASE WHEN EXISTS (', 'const statements: Statement[] = [{ sql: `SELECT CASE WHEN 1 OR EXISTS (']]],
  ['lib/branchCutoverHistory.ts', [['  return [\n    // Every row is still exactly the open row the page read.\n    assert(', '  return [\n    assert(`1=1`, {}) || assert(']]]],
  'no-close': [['lib/branchCutoverHistory.ts', [['  if (!input.closes.length) return []', '  return []']]]],
  'no-rule': [['lib/branchCutoverHistory.ts', [["  'sale.add_items': 'close_if_source',", "  'sale.add_items': 'leave',"]]]],
  // a mid-run redeploy that changes a capture registry input (verifier P7), used by the E7 check, not a RED control
  'page-cap': [['lib/branchCutoverCapture.ts', [['export const CAPTURE_PAGE_CAP = 256', 'export const CAPTURE_PAGE_CAP = 128']]]],
}
function modules(control) {
  const cache = new Map()
  const mutations = new Map((CONTROLS[control] || []).map(([file, list]) => [file, list]))
  const used = new Set()
  function load(name) {
    name = path.posix.normalize(name.endsWith('.ts') ? name : name + '.ts')
    if (cache.has(name)) return cache.get(name).exports
    const module = { exports: {} }; cache.set(name, module)
    let source = fs.readFileSync(path.join(root, 'src', name), 'utf8').replace(/\r\n/g, '\n')
    for (const [from, to] of mutations.get(name) || []) { assert.ok(source.includes(from), control + ': ' + from.slice(0, 80)); source = source.replace(from, to); used.add(from) }
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function('require', 'module', 'exports', js)(request => {
      if (request === './importMaintenanceFence') return new Proxy({}, { get() { throw Error('Unexpected maintenance dependency execution') } })
      assert.ok(request.startsWith('.'), request)
      return load(path.posix.join(path.posix.dirname(name), request))
    }, module, module.exports)
    return module.exports
  }
  const result = { parent: load('lib/branchCutoverParent'), child: load('lib/branchCutoverChild'), journal: load('lib/branchCutoverJournal'), D1Compat: load('lib/db').D1Compat,
    costs: load('lib/acquisitionCostAccess') }
  for (const list of mutations.values()) for (const [from] of list) assert.ok(used.has(from), 'control mutation unused: ' + from.slice(0, 60))
  return result
}

const D1_CPU_RESET = 'D1_ERROR: D1 DB exceeded its CPU time limit and was reset. [code: 7429]'
const ACTOR = { id: 7, username: 'operator', name: 'Operator', organization_id: 1, role_id: null, permissions: '{"branches":true,"backup_restore":true}', is_active: 1 }
const PARENT_BUDGET = { tier: 'free', alreadyUsed: 0, remainingReads: 0, retryQueries: 0, completionQueries: 0, safetyQueries: 0, extraAtomicStatements: 0 }
const CHILD_BUDGET = { ...PARENT_BUDGET, tier: 'paid' }
const IDS = { sourceBranchId: 2, targetBranchId: 1 }
const NAMES = { retiredName: 'Old Shop', successorName: 'LC Store' }
const INCARNATION = '00000000-0000-4000-8000-000000000099'

// lot: [id, product, received_at, expiry, cost, { 2: shopQty, 1: warehouseQty }, supplier_id]
const NAMED = {
  products: [
    // id, name, shop bs, warehouse bs
    [1, 'Shop only two dates', 5, null], [2, 'Shared batch', 4, 6], [3, 'Same date, WH pre-existing, cost differs', 1, 3],
    [4, 'Shop two same-date lots', 4, null], [5, 'Same date different expiry', 2, 2], [6, 'Same date real, unknown and free cost', 3, 2],
    [7, 'No received date', 2, 1], [8, 'Untracked at Shop', 5, 1], [9, 'Fractional', 2.5, 1.25], [10, 'Zero source row', 0, 3],
    [11, 'Warehouse only', null, 4], [12, 'Shared + pre-existing + arrival same date', 3, 3],
    [13, 'Business day: 18:00 UTC is the next day in Cambodia', 1, 1], [14, 'Business day: 20:00 UTC is not the same day', 1, 1],
    [15, 'Same date free and unknown cost, no real cost: merge, cost unknown', 1, 1], [16, 'Same date two suppliers', 2, 1],
    [17, 'Same date, the warehouse lot has no supplier', 1, 1], [18, 'Same date, blend needs rounding', 2, 1],
    // E3: exact decimals whose REAL lot sum at LC Store is 0.30000000000000004 > 0.3 (sum(0.05, 0.05, 0.2) in SQLite)
    [19, 'Fractional lots whose REAL sum ties above the stock', 0.05, 0.25],
    // owner 6 Oct: same DATE, any stored text. Slash dates are month-first (the Aug-28 import column batch(mm/dd/yyyy), 0077).
    [20, 'ISO at the warehouse, slash date at the Shop, same day', 1, 1], [21, 'Ambiguous slash 4/8 follows month-first (8 Apr, not 4 Aug)', 1, 2],
    [22, 'Slash 24/08 is no month-first date: kept apart', 1, 1], [23, 'Slash date and a timestamp on the same Cambodia day', 1, 1],
  ],
  lots: [
    [101, 1, '2026-09-01', '2027-09-01', 2, { 2: 3 }], [102, 1, '2026-09-05', '2027-09-05', 2.5, { 2: 2 }],
    [201, 2, '2026-08-01', '2027-08-01', 1.2, { 2: 4, 1: 6 }],
    [301, 3, '2026-09-10', '2027-09-10', 2, { 1: 3 }, 5], [302, 3, '2026-09-10 08:00:00', '2027-09-10', 6, { 2: 1 }, 5],
    [401, 4, '2026-09-12', null, 1, { 2: 1 }], [402, 4, '2026-09-12T10:30:00Z', null, 4, { 2: 3 }],
    [501, 5, '2026-09-15', '2027-01-01', 2, { 1: 2 }], [502, 5, '2026-09-15', '2027-06-01', 3, { 2: 2 }],
    [601, 6, '2026-09-20', null, null, { 1: 2 }], [602, 6, '2026-09-20', null, 5, { 2: 2 }], [603, 6, '2026-09-20', null, 0, { 2: 1 }],
    [701, 7, null, null, 1, { 2: 2 }], [702, 7, null, null, 1, { 1: 1 }],
    [801, 8, '2026-09-02', null, 3, { 2: 3 }], [802, 8, '2026-09-02', null, 3, { 1: 1 }],
    [901, 9, '2026-09-01', null, 1.1, { 2: 2.5 }], [902, 9, '2026-09-01', null, 3.3, { 1: 1.25 }],
    [1001, 10, '2026-07-07', null, 1, { 1: 3 }], [1101, 11, '2026-07-08', null, 1, { 1: 4 }],
    [1201, 12, '2026-09-03', null, 2, { 2: 1, 1: 1 }], [1202, 12, '2026-09-03', null, 2, { 1: 2 }], [1203, 12, '2026-09-03', null, 4, { 2: 2 }],
    [1301, 13, '2026-09-13', null, 2, { 1: 1 }], [1302, 13, '2026-09-12T18:00:00Z', null, 2, { 2: 1 }],
    [1401, 14, '2026-09-12', null, 3, { 1: 1 }], [1402, 14, '2026-09-12T20:00:00Z', null, 3, { 2: 1 }],
    [1501, 15, '2026-09-21', null, 0, { 1: 1 }], [1502, 15, '2026-09-21', null, null, { 2: 1 }],
    [1601, 16, '2026-09-22', null, 1, { 1: 1 }, 11], [1602, 16, '2026-09-22', null, 3, { 2: 2 }, 12],
    [1701, 17, '2026-09-23', null, 2, { 1: 1 }], [1702, 17, '2026-09-23', null, 2, { 2: 1 }, 11],
    [1801, 18, '2026-09-24', null, 1.0001, { 1: 1 }], [1802, 18, '2026-09-24', null, 1.0002, { 2: 2 }],
    [1901, 19, '2026-09-25', null, 1, { 1: 0.05 }], [1902, 19, '2026-09-25', null, 1, { 2: 0.05 }], [1903, 19, '2026-09-26', null, 1, { 1: 0.2 }],
    [2001, 20, '2026-08-24', null, 2, { 1: 1 }], [2002, 20, '08/24/2026', null, 4, { 2: 1 }],
    [2101, 21, '2026-04-08', null, 1, { 1: 1 }], [2102, 21, '2026-08-04', null, 5, { 1: 1 }], [2103, 21, '4/8/2026', null, 3, { 2: 1 }],
    [2201, 22, '2026-08-24', null, 1, { 1: 1 }], [2202, 22, '24/08/2026', null, 1, { 2: 1 }],
    [2301, 23, '2026-09-12T18:00:00Z', null, 2, { 1: 1 }], [2302, 23, ' 9/13/2026 ', null, 2, { 2: 1 }],
  ],
}
function generated(count, seed = 7) {
  let state = seed; const next = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648
  const products = [], lots = []
  let lot = 5000
  for (let p = 100; p < 100 + count; p++) {
    const kind = Math.floor(next() * 4); const date = (d) => `2026-0${1 + Math.floor(d * 8)}-${String(1 + Math.floor(next() * 27)).padStart(2, '0')}`
    const shop = {}, wh = {}
    const lotCount = 1 + Math.floor(next() * 3)
    for (let i = 0; i < lotCount; i++) {
      const id = ++lot; const received = date(next()); const cost = Math.round((1 + next() * 20) * 100) / 100; const at = {}
      if (kind !== 1) { at[2] = 1 + Math.floor(next() * 9); shop[id] = at[2] }
      if (kind !== 0 && (kind === 1 || next() < 0.6)) { at[1] = 1 + Math.floor(next() * 9); wh[id] = at[1] }
      if (Object.keys(at).length) lots.push([id, p, received, null, cost, at])
      if (kind === 3 && i === 0) { const twin = ++lot; at[2] = at[2] || 1; lots.push([twin, p, received + ' 09:00:00', null, Math.round((1 + next() * 20) * 100) / 100, { 2: 2 }]); shop[twin] = 2 }
    }
    const sum = (m) => Object.values(m).reduce((a, b) => a + b, 0)
    products.push([p, 'Generated ' + p, sum(shop) || (kind === 1 ? null : 0), kind === 0 ? null : sum(wh)])
  }
  return { products, lots }
}

function world({ control, generatedProducts = 28, duplicate = false } = {}) {
  const raw = new DatabaseSync(':memory:'); raw.limits.exprDepth = 100; raw.limits.variableNumber = 100
  raw.exec('PRAGMA foreign_keys=OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter(n => n.endsWith('.sql')).sort()) raw.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  raw.limits.functionArg = 100
  raw.exec(`INSERT INTO branches(id,name,notes,is_active,is_default,canonical_key,role,created_at) VALUES
      (2,'Shop','front of house',1,1,'shop','shop','2026-01-01 00:00:00'),(1,'Warehouse','back store',1,0,'warehouse','warehouse','2026-01-01 00:00:00'),
      (3,'Shop','legacy row retired in 2025',0,0,NULL,NULL,'2025-01-01 00:00:00');
    INSERT INTO users(id,username,password,name,organization_id,permissions,is_active) VALUES(7,'operator','fixture','Operator',1,'{"branches":true,"backup_restore":true}',1);
    INSERT INTO system_flags(key,value) VALUES('branch_cutover_control_incarnation','${INCARNATION}')`)
  const data = generated(generatedProducts)
  const products = [...NAMED.products, ...data.products], lots = [...NAMED.lots, ...data.lots]
  for (const [id, name, shop, wh] of products) {
    raw.prepare('INSERT INTO products(id,name,sku,is_active,stock_quantity,cost_price_usd,created_at,updated_at) VALUES(?,?,?,1,?,1,?,?)').run(id, name, 'SKU' + id, (shop || 0) + (wh || 0), '2026-01-01', '2026-01-01')
    if (shop !== null) raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,2,?)').run(id, shop)
    if (wh !== null) raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,?)').run(id, wh)
  }
  for (const [id, product, received, expiry, cost, at, supplier = null] of lots) {
    raw.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,expiry_date,unit_cost_usd,received_branch_id,received_quantity,supplier_id,is_active,batch_number,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,1,?,'2026-01-01','2026-01-01')`).run(id, product, 'lot-' + id, 'L' + id, received, expiry, cost, at[2] ? 2 : 1, Object.values(at).reduce((a, b) => a + b, 0), supplier, id)
    for (const [branch, quantity] of Object.entries(at)) raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, Number(branch), quantity, '2026-01-01', '2026-01-01')
  }
  // historical rows whose labels are blank (the snapshot pass fills them with the event-time names)
  raw.exec(`INSERT INTO sales(id,branch_id,branch_name,receipt_number) VALUES(1,2,NULL,'S1'),(2,1,'Warehouse as sold','S2'),(3,3,NULL,'S3');
    INSERT INTO sale_items(id,sale_id,product_id,branch_id,quantity,applied_price_usd) VALUES(1,1,1,2,1,5),(2,2,2,1,1,5),(3,3,1,3,1,5);
    INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity) VALUES(1,101,2,1),(2,201,1,1);
    INSERT INTO returns(id,sale_id,branch_id,branch_name) VALUES(1,1,2,' ');
    INSERT INTO inventory_movements(id,product_id,branch_id,branch_name,movement_type,quantity,batch_id) VALUES(900001,1,2,NULL,'sale',-1,101),(900002,2,1,'','sale',-1,201);
    INSERT INTO fees(id,fee_type,amount_usd,fee_date,sale_id,branch_id,branch_name) VALUES(900001,'delivery',1,'2026-09-01',1,2,NULL),(900002,'delivery',1,'2026-09-01',3,3,NULL);
    INSERT INTO shift_sessions(id,shift_code,user_id,branch_id,branch_name,business_date,opened_at,closed_at) VALUES(900001,'SH1',7,2,NULL,'2026-09-01','2026-09-01 08:00:00','2026-09-01 20:00:00');
    INSERT INTO stock_transfers(id,product_id,from_branch_id,to_branch_id,quantity) VALUES(900001,2,1,2,1);
    INSERT INTO pending_actions(section,action_type,entity_type,status) VALUES('inventory','adjust','product','rejected'),('inventory','adjust','product','approved');`)
  const history = seedHistoryFamilies(raw, { source: 2, target: 1, other: 3 }, 20000)
  const stats = { reads: 0, batches: 0, statements: 0, maxBinds: 0, before: null, after: null, cpuRead: null, cpuBatch: false, duplicate, duplicatesCommitted: 0, duplicatesRefused: 0, dbNs: 0n }
  const timed = (fn) => { const t = process.hrtime.bigint(); try { return fn() } finally { stats.dbNs += process.hrtime.bigint() - t } }
  let m = modules(control)
  const prepared = (sql, values = []) => {
    assert.ok(values.length <= 100); stats.maxBinds = Math.max(stats.maxBinds, values.length)
    const execute = () => {
      const args = /\?\d/.test(sql) ? [Object.fromEntries(values.map((v, i) => [String(i + 1), v]))] : values
      const statement = raw.prepare(sql)
      if (/^\s*(SELECT|WITH|PRAGMA)/i.test(sql)) return { success: true, results: statement.all(...args), meta: { changes: 0 } }
      const r = statement.run(...args); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }
    }
    // A D1 CPU-limit reset (code 7429) on a read: the statement never returns and nothing is written.
    const cpuReset = () => { if (stats.cpuRead !== null && stats.cpuRead-- === 0) { stats.cpuRead = null; throw Error(D1_CPU_RESET) } }
    return { bind: (...v) => prepared(sql, v), execute, all: async () => { stats.reads++; cpuReset(); return timed(execute) }, run: async () => { cpuReset(); return timed(execute) } }
  }
  const transaction = (statements) => {
    raw.exec('BEGIN IMMEDIATE')
    try { const result = statements.map(s => s.execute()); raw.exec('COMMIT'); return result } catch (e) { raw.exec('ROLLBACK'); throw e }
  }
  const makeDb = () => new m.D1Compat({ prepare: prepared, batch: async statements => {
    stats.batches++; stats.statements = statements.length
    // A 7429 on a batch: D1 resets the database mid-transaction, so the whole batch rolls back.
    if (stats.cpuBatch) { stats.cpuBatch = false; throw Error(D1_CPU_RESET) }
    if (stats.before) { const before = stats.before; stats.before = null; before(raw) }
    const result = timed(() => transaction(statements))
    if (stats.duplicate) { try { transaction(statements); stats.duplicatesCommitted++ } catch { stats.duplicatesRefused++ } }
    if (stats.after) { const after = stats.after; stats.after = null; after(raw) }
    return result
  } })
  const w = { raw, stats, history, products, lots, get m() { return m }, db: makeDb() }
  w.reload = (next = control) => { m = modules(next); w.db = makeDb() }
  return w
}

// ---- independent state reads (test side, never the implementation's helpers) ----
// Cambodia business day, written independently of businessDateWindow: date-only as stored, a timestamp (UTC unless zoned) + 7 h,
// a slash date month-first (a real calendar day, checked through Date.parse).
const dateKey = (value) => {
  const text = typeof value === 'string' ? value.trim() : ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const slash = text.match(/^(\d\d?)\/(\d\d?)\/(\d{4})$/)
  if (slash) {
    const iso = `${slash[3]}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`
    return !Number.isNaN(Date.parse(iso)) && new Date(Date.parse(iso)).toISOString().slice(0, 10) === iso ? iso : 'none:'
  }
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text)) return 'none:'
  const iso = text.replace(' ', 'T'); const ms = Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : iso + 'Z')
  return Number.isNaN(ms) ? 'none:' : new Date(ms + 7 * 3600000).toISOString().slice(0, 10)
}
const near = (a, b) => Math.abs(a - b) <= 1e-9
function snapshot(raw) {
  const product = new Map(), group = new Map(), lotRows = new Map(), untracked = new Map(), value = new Map()
  for (const r of raw.prepare('SELECT product_id,branch_id,quantity FROM branch_stock WHERE branch_id IN (1,2)').all()) {
    product.set(r.product_id, (product.get(r.product_id) || 0) + r.quantity)
    untracked.set(r.product_id, (untracked.get(r.product_id) || 0) + r.quantity)
  }
  for (const r of raw.prepare(`SELECT b.id,b.variant_product_id p,b.received_at,b.expiry_date,b.unit_cost_usd c,s.branch_id,s.quantity FROM branch_batch_stock s JOIN product_batches b ON b.id=s.batch_id WHERE s.branch_id IN (1,2)`).all()) {
    const key = r.p + '|' + (r.received_at === null ? 'none:' + r.id : dateKey(r.received_at)) + '|' + r.expiry_date
    group.set(key, (group.get(key) || 0) + r.quantity)
    lotRows.set(r.id + '@' + r.branch_id, r.quantity)
    untracked.set(r.p, (untracked.get(r.p) || 0) - r.quantity)
    if (r.c > 0) value.set(r.p, (value.get(r.p) || 0) + r.quantity * r.c)
  }
  return { product, group, lotRows, untracked, value }
}
function invariants(raw, base, label) {
  const now = snapshot(raw)
  for (const [p, q] of base.product) assert.ok(near(now.product.get(p) || 0, q), `${label}: product ${p} total ${now.product.get(p)} <> ${q}`)
  for (const [k, q] of base.group) assert.ok(near(now.group.get(k) || 0, q), `${label}: lot date group ${k} ${now.group.get(k)} <> ${q}`)
  for (const [p, q] of base.untracked) assert.ok(near(now.untracked.get(p) || 0, q), `${label}: untracked ${p}`)
  const disagree = raw.prepare(`SELECT bs.product_id,bs.branch_id FROM branch_stock bs WHERE bs.branch_id IN (1,2) AND bs.quantity+1e-9 <
    (SELECT coalesce(sum(s.quantity),0) FROM branch_batch_stock s JOIN product_batches b ON b.id=s.batch_id WHERE b.variant_product_id=bs.product_id AND s.branch_id=bs.branch_id)`).all()
  assert.deepEqual(disagree, [], label + ': ledgers disagree')
  assert.equal(raw.prepare('SELECT count(*) n FROM branch_stock WHERE quantity<0').get().n + raw.prepare('SELECT count(*) n FROM branch_batch_stock WHERE quantity<0').get().n, 0)
  return now
}
const status = (w) => w.raw.prepare("SELECT * FROM branch_cutovers WHERE phase NOT IN ('aborted') ORDER BY created_at DESC LIMIT 1").get()
const ownership = (row) => ({ operationId: row.operation_id, actorId: row.actor_id, organizationId: row.organization_id, controlIncarnation: row.control_incarnation, token: row.maintenance_token })
function labelOf(row) {
  if (!row) return 'begin'
  if (row.phase === 'moving') return row.planned_child_json ? 'child' : 'seal'
  if (row.phase === 'verifying') { const c = JSON.parse(row.verification_cursor_json); return c.stage ? c.stage : 'fold' }
  return { capturing: 'capture', snapshots: 'snapshot', ready: 'finalize', completed: 'completed' }[row.phase]
}

/** The driver: status read, one invocation, independent invariants. Faults keyed by '<label>#<occurrence>'. */
async function drive(w, { faults = {}, base, requestId = 'cutover_night_001', pageSize, maxTurns = 4000, timings } = {}) {
  const seen = {}; let turns = 0
  const plan = await w.m.parent.inspectBranchCutover(w.db, ACTOR, 1, IDS, PARENT_BUDGET)
  assert.deepEqual(plan.capabilities, [])
  for (;;) {
    assert.ok(turns++ < maxTurns, 'driver did not converge')
    const row = status(w)
    if (row && row.phase === 'completed') return row
    const label = row ? labelOf(row) : 'begin'
    seen[label] = (seen[label] || 0) + 1
    const fault = faults[label + '#' + seen[label]]
    if (fault) (w.fired ||= []).push(label + '#' + seen[label] + ':' + fault)
    if (fault === 'before') w.stats.before = () => { throw Error('injected crash before commit') }
    if (fault === 'after') w.stats.after = () => { throw Error('injected lost acknowledgement') }
    if (fault && fault.startsWith('cpu-read-')) w.stats.cpuRead = Number(fault.slice('cpu-read-'.length))
    if (fault === 'cpu-batch') w.stats.cpuBatch = true
    const reads = w.stats.reads, batches = w.stats.batches, started = process.hrtime.bigint(), db0 = w.stats.dbNs, cpu0 = process.cpuUsage()
    try {
      if (!row) await w.m.parent.beginBranchCutover(w.db, ACTOR, 1, { ...IDS, ...NAMES, requestId, controlIncarnation: INCARNATION,
        expectedSourceJson: plan.sourcePreimageJson, expectedTargetJson: plan.targetPreimageJson, expectedSchemaDigest: plan.schemaDigest }, PARENT_BUDGET)
      else if (label === 'child') await w.m.child.executePlannedBranchCutoverChild(w.db, ACTOR, ownership(row), { sequence: row.next_sequence, childJson: row.planned_child_json }, CHILD_BUDGET, 1)
      else await w.m.parent.continueBranchCutover(w.db, ACTOR, 1, { operationId: row.operation_id, expectedRevision: row.revision, pageSize }, PARENT_BUDGET)
    } catch (error) {
      if (!fault) throw error
      // A 7429 surfaces once (D1Compat never replays a CPU-limit reset) and is retryable: a read throws it as is, a
      // batch as BranchCutoverParentOutcomeUnknown (the parent cannot know the batch did not commit) or the child's own error.
      if (fault.startsWith('cpu')) {
        assert.ok(/code: 7429/.test(String(error.message) + ' ' + String(error.cause?.message)), label + ' ' + fault + ': ' + error.message)
        assert.ok(w.m.parent.isBranchCutoverRetryable(error), label + ' ' + fault + ' is retryable')
        assert.equal(w.stats.cpuRead, null, 'the injected 7429 fired'); assert.equal(w.stats.cpuBatch, false)
      }
    } finally { w.stats.before = null; w.stats.after = null }
    if (timings) {
      const entry = timings[label] ||= { count: 0, ms: [], reads: 0, maxReads: 0, maxStatements: 0 }
      const wall = Number(process.hrtime.bigint() - started) / 1e6, dbMs = Number(w.stats.dbNs - db0) / 1e6
      const cpu = process.cpuUsage(cpu0); const cpuMs = (cpu.user + cpu.system) / 1000
      entry.count++; entry.ms.push(wall); (entry.js ||= []).push(Math.max(0, cpuMs - dbMs)); (entry.db ||= []).push(dbMs)
      entry.reads += w.stats.reads - reads; entry.maxReads = Math.max(entry.maxReads, w.stats.reads - reads)
      if (w.stats.batches > batches) entry.maxStatements = Math.max(entry.maxStatements, w.stats.statements)
    }
    if (fault === 'kill') w.reload()
    if (base) invariants(w.raw, base, label + '#' + seen[label])
  }
}

function round(n) { return Math.round(n * 1e9) / 1e9 }
async function scenario({ control, duplicate = false, faults = {}, generatedProducts = 28, timings, pageSize = 16 } = {}) {
  const w = world({ control, duplicate, generatedProducts })
  const base = snapshot(w.raw)
  const before = {
    batches: w.raw.prepare('SELECT * FROM product_batches ORDER BY id').all(),
    history: w.raw.prepare('SELECT * FROM action_history ORDER BY id').all(),
    legacy: w.raw.prepare('SELECT * FROM branches WHERE id=3').get(),
    branches: w.raw.prepare('SELECT * FROM branches ORDER BY id').all(),
    stock: w.raw.prepare('SELECT product_id,branch_id,quantity FROM branch_stock ORDER BY product_id,branch_id').all(),
    sourceUnits: w.raw.prepare('SELECT sum(quantity) n FROM branch_stock WHERE branch_id=2').get().n,
    movingProducts: w.raw.prepare('SELECT count(*) n FROM branch_stock WHERE branch_id=2 AND quantity>0').get().n,
    productCost: w.raw.prepare('SELECT id,cost_price_usd FROM products ORDER BY id').all(),
  }
  // an earlier attempt, stopped by the operator during capture: effect-free abort, flag released
  {
    const plan = await w.m.parent.inspectBranchCutover(w.db, ACTOR, 1, IDS, PARENT_BUDGET)
    let { row } = await w.m.parent.beginBranchCutover(w.db, ACTOR, 1, { ...IDS, ...NAMES, requestId: 'rehearsal_attempt_01', controlIncarnation: INCARNATION,
      expectedSourceJson: plan.sourcePreimageJson, expectedTargetJson: plan.targetPreimageJson, expectedSchemaDigest: plan.schemaDigest }, PARENT_BUDGET)
    for (let i = 0; i < 3; i++) row = (await w.m.parent.continueBranchCutover(w.db, ACTOR, 1, { operationId: row.operation_id, expectedRevision: row.revision, pageSize: 4 }, PARENT_BUDGET)).row
    row = await w.m.journal.abortEffectFreeBranchCutoverJournal(w.db, ownership(row), row.revision, 'operator stopped the rehearsal')
    assert.equal(row.phase, 'aborted'); assert.equal(w.raw.prepare("SELECT count(*) n FROM system_flags WHERE key='maintenance'").get().n, 0)
  }
  const final = await drive(w, { faults, base: timings ? null : base, pageSize, timings })
  assert.deepEqual((w.fired || []).map(f => f.slice(0, f.lastIndexOf(':'))).sort(), Object.keys(faults).sort(), 'every scheduled fault fired')
  return { w, base, before, final }
}

function verifyEndState({ w, base, before, final }) {
  const raw = w.raw
  // ---- stock: Shop + Warehouse before = LC Store after, to the unit, per product and per date lot
  const after = invariants(raw, base, 'end')
  for (const [p, q] of base.product) {
    const at = (b) => raw.prepare('SELECT coalesce(sum(quantity),0) n FROM branch_stock WHERE product_id=? AND branch_id=?').get(p, b).n
    assert.ok(near(at(1), q), 'LC Store product ' + p); assert.equal(at(2), 0, 'Old Shop product ' + p)
  }
  assert.equal(raw.prepare('SELECT count(*) n FROM branch_batch_stock WHERE branch_id=2 AND quantity<>0').get().n, 0)
  // ---- every fold's cost, from the pre-run lot costs (independent of the implementation): the weighted average of the
  //      REAL costs only, rounded to 4 decimals when it blends; stock value moves only by that rounding and by the
  //      unknown/free units taking the real cost (owner 6 Oct)
  const folds = raw.prepare("SELECT details FROM audit_logs WHERE action='branch_cutover_lot_fold'").all().map(r => JSON.parse(r.details))
  const costOf = new Map(before.batches.map(b => [b.id, b.unit_cost_usd]))
  const expectedValue = new Map(base.value)
  for (const fold of folds) {
    const total = fold.after.reduce((s, [, q]) => s + q, 0)
    const priced = fold.before.filter(([id]) => costOf.get(id) > 0)
    const costs = new Set(priced.map(([id]) => costOf.get(id)))
    if (!priced.length) assert.equal(fold.unitCostUsdAfter, fold.before.some(([id]) => costOf.get(id) !== 0) ? null : 0, 'no real cost: unknown if any unit is unknown, else $0 ' + fold.survivorBatchId)
    else if (costs.size === 1) assert.equal(fold.unitCostUsdAfter, [...costs][0], 'one real cost ' + fold.survivorBatchId)
    else {
      const exact = priced.reduce((s, [id, q]) => s + q * costOf.get(id), 0) / priced.reduce((s, [, q]) => s + q, 0)
      assert.ok(Math.abs(fold.unitCostUsdAfter - exact) <= 0.00005 + 1e-12, 'weighted average of the real costs ' + fold.survivorBatchId + ': ' + fold.unitCostUsdAfter + ' vs ' + exact)
      assert.ok(Math.abs(fold.unitCostUsdAfter * 1e4 - Math.round(fold.unitCostUsdAfter * 1e4)) < 1e-6, '4 decimals ' + fold.unitCostUsdAfter)
    }
    const valueBefore = fold.before.reduce((s, [id, q]) => s + (costOf.get(id) > 0 ? q * costOf.get(id) : 0), 0)
    expectedValue.set(fold.productId, (expectedValue.get(fold.productId) || 0) - valueBefore + (fold.unitCostUsdAfter > 0 ? total * fold.unitCostUsdAfter : 0))
  }
  for (const [p, v] of expectedValue) assert.ok(Math.abs((after.value.get(p) || 0) - v) <= 1e-9 * Math.max(1, v), 'stock value of product ' + p)
  for (const [p] of after.value) assert.ok(expectedValue.has(p), 'value appeared on product ' + p)
  // ---- date-only merge with the weighted average cost
  const lot = (id, b = 1) => raw.prepare('SELECT s.quantity q,b.unit_cost_usd c FROM product_batches b LEFT JOIN branch_batch_stock s ON s.batch_id=b.id AND s.branch_id=? WHERE b.id=?').get(b, id)
  assert.deepEqual({ ...lot(301) }, { q: 4, c: 3 }); assert.equal(lot(302).q, 0)                       // (3x2 + 1x6) / 4
  assert.deepEqual({ ...lot(401) }, { q: 4, c: 3.25 }); assert.equal(lot(402).q, 0)                    // (1x1 + 3x4) / 4, survivor = lowest arriving id
  assert.deepEqual({ ...lot(501) }, { q: 2, c: 2 }); assert.deepEqual({ ...lot(502) }, { q: 2, c: 3 }) // different expiry: kept apart
  assert.deepEqual({ ...lot(601) }, { q: 5, c: 5 }); assert.equal(lot(602).q, 0); assert.equal(lot(603).q, 0) // real + unknown + free: every unit takes the real cost
  assert.deepEqual({ ...lot(701) }, { q: 2, c: 1 }); assert.deepEqual({ ...lot(702) }, { q: 1, c: 1 }) // no received date: never merged
  assert.deepEqual({ ...lot(902) }, { q: 3.75, c: 1.8333 }); assert.equal(lot(901).q, 0)               // 6.875 / 3.75 at 4 decimals
  assert.deepEqual({ ...lot(1301) }, { q: 2, c: 2 }); assert.equal(lot(1302).q, 0)                     // 18:00 UTC 12 Sep = 13 Sep in Cambodia
  assert.deepEqual({ ...lot(1401) }, { q: 1, c: 3 }); assert.deepEqual({ ...lot(1402) }, { q: 1, c: 3 }) // 20:00 UTC 12 Sep is 13 Sep: kept apart
  assert.deepEqual({ ...lot(1501) }, { q: 2, c: null }); assert.equal(lot(1502).q, 0)                  // $0 + unknown, no real cost: merged, cost UNKNOWN
  assert.deepEqual({ ...lot(1601) }, { q: 1, c: 1 }); assert.deepEqual({ ...lot(1602) }, { q: 2, c: 3 }) // two suppliers: kept apart
  assert.deepEqual({ ...lot(1702) }, { q: 2, c: 2 }); assert.equal(lot(1701).q, 0)                     // no supplier folds into the supplier's lot
  assert.deepEqual({ ...lot(1801) }, { q: 3, c: 1.0002 }); assert.equal(lot(1802).q, 0)               // 3.0005 / 3 at 4 decimals
  assert.deepEqual({ ...lot(1901) }, { q: 0.1, c: 1 }); assert.equal(lot(1902).q, 0); assert.equal(lot(1903).q, 0.2) // REAL tie tolerated, exact values kept
  assert.deepEqual({ ...lot(2001) }, { q: 2, c: 3 }); assert.equal(lot(2002).q, 0)                     // 08/24/2026 is 2026-08-24: one lot
  assert.deepEqual({ ...lot(2101) }, { q: 2, c: 2 }); assert.deepEqual({ ...lot(2102) }, { q: 1, c: 5 }); assert.equal(lot(2103).q, 0) // 4/8 = 8 Apr
  assert.deepEqual({ ...lot(2201) }, { q: 1, c: 1 }); assert.deepEqual({ ...lot(2202) }, { q: 1, c: 1 }) // 24/08 is no month-first date: apart
  assert.deepEqual({ ...lot(2301) }, { q: 2, c: 2 }); assert.equal(lot(2302).q, 0)                     // 18:00 UTC 12 Sep = 13 Sep = 9/13
  assert.deepEqual({ ...lot(201) }, { q: 10, c: 1.2 })                                                  // shared batch keeps its identity
  assert.deepEqual({ ...lot(1201) }, { q: 4, c: 3 }); assert.deepEqual({ ...lot(1202) }, { q: 2, c: 2 }); assert.equal(lot(1203).q, 0)
  assert.deepEqual({ ...lot(802) }, { q: 4, c: 3 }); assert.equal(lot(801).q, 0)                       // survivor = the lot already at the warehouse
  // ---- lot identity: every batch row survives; only the label, survivor costs and their updated_at may move
  const batches = raw.prepare('SELECT * FROM product_batches ORDER BY id').all()
  assert.equal(batches.length, before.batches.length)
  const costChanged = new Set(folds.filter(f => f.unitCostUsdAfter !== f.unitCostUsdBefore).map(f => f.survivorBatchId))
  for (const [i, row] of batches.entries()) {
    const prior = before.batches[i]
    const { received_branch_name, unit_cost_usd, updated_at, ...rest } = row
    const { received_branch_name: rn0, unit_cost_usd: c0, updated_at: u0, ...rest0 } = prior
    assert.deepEqual(rest, rest0, 'batch ' + row.id)
    assert.equal(received_branch_name, prior.received_branch_id === 2 ? 'Shop' : 'Warehouse')
    if (!costChanged.has(row.id)) { assert.equal(unit_cost_usd, c0, 'cost of ' + row.id); assert.equal(updated_at, u0) }
  }
  // ---- official transfer record: one receipt, one member and one out/in movement pair per moved product
  const receipts = raw.prepare("SELECT count(*) n FROM transfer_operation_receipts WHERE request_id LIKE 'bc\\_%' ESCAPE '\\'").get().n
  assert.equal(receipts, before.movingProducts); assert.equal(final.committed_children, before.movingProducts)
  assert.equal(raw.prepare("SELECT count(*) n FROM stock_transfers WHERE receipt_id IN (SELECT id FROM transfer_operation_receipts WHERE request_id LIKE 'bc\\_%' ESCAPE '\\')").get().n, before.movingProducts)
  assert.ok(near(raw.prepare("SELECT sum(quantity) n FROM transfer_operation_members WHERE receipt_id IN (SELECT id FROM transfer_operation_receipts WHERE request_id LIKE 'bc\\_%' ESCAPE '\\')").get().n, before.sourceUnits))
  // ---- history: the design's decision per row, leave rows byte-identical, children closed and hidden, one summary row
  const historyNow = new Map(raw.prepare('SELECT * FROM action_history').all().map(r => [r.id, r]))
  for (const prior of before.history) {
    const expected = w.history.find(h => h.id === prior.id)?.expected
    const now = historyNow.get(prior.id)
    if (expected === 'close') assert.deepEqual([now.status, now.reversible, now.last_error], ['recorded', 0, 'undo_closed:branch_retired'], 'close ' + prior.id + ' ' + prior.undo_payload)
    else assert.deepEqual(now, prior, 'untouched ' + prior.id)
  }
  const children = raw.prepare("SELECT * FROM action_history WHERE entity='stock_transfer' AND id>?").all(before.history.at(-1).id)
  assert.equal(children.length, before.movingProducts)
  assert.ok(children.every(h => h.status === 'recorded' && h.reversible === 0 && h.last_error === 'undo_closed:branch_cutover_move'))
  const summary = raw.prepare("SELECT * FROM action_history WHERE entity='branch_cutover'").all()
  assert.equal(summary.length, 1); assert.equal(summary[0].reversible, 0); assert.equal(summary[0].status, 'recorded'); assert.equal(summary[0].entity_id, final.operation_id)
  assert.equal(summary[0].label, `Branch consolidation: Shop → LC Store (${before.movingProducts} products, ${round(before.sourceUnits)} units)`)
  const closures = raw.prepare("SELECT details FROM audit_logs WHERE action='undo_closed_branch_cutover'").all().map(r => JSON.parse(r.details))
  assert.equal(closures.length, w.history.filter(h => h.expected === 'close').length + before.movingProducts)
  assert.equal(new Set(closures.map(c => c.historyId)).size, closures.length)
  // ---- directory: Old Shop retired with successor, LC Store the one active default selling branch, legacy row untouched
  const branches = raw.prepare('SELECT * FROM branches ORDER BY id').all()
  assert.deepEqual(branches.map(b => [b.id, b.name, b.is_active, b.is_default, b.role, b.canonical_key, b.successor_branch_id]),
    [[1, 'LC Store', 1, 1, 'shop', 'warehouse', null], [2, 'Old Shop', 0, 0, 'shop', 'shop', 1], [3, 'Shop', 0, 0, null, null, null]])
  assert.deepEqual(raw.prepare('SELECT * FROM branches WHERE id=3').get(), before.legacy)
  assert.equal(branches[0].notes, 'back store'); assert.equal(branches[1].notes, 'front of house')
  // ---- labels: every row of the two branches carries its event-time name; nonblank labels were never rewritten
  for (const [table, field, branch] of [['sales', 'branch_name', 'branch_id'], ['returns', 'branch_name', 'branch_id'], ['inventory_movements', 'branch_name', 'branch_id'],
    ['fees', 'branch_name', 'branch_id'], ['shift_sessions', 'branch_name', 'branch_id'], ['product_batches', 'received_branch_name', 'received_branch_id'],
    ['stock_transfers', 'from_branch_name', 'from_branch_id'], ['stock_transfers', 'to_branch_name', 'to_branch_id']]) {
    assert.equal(raw.prepare(`SELECT count(*) n FROM ${table} WHERE ${branch} IN (1,2) AND trim(coalesce(${field},''))=''`).get().n, 0, table + '.' + field)
  }
  assert.equal(raw.prepare('SELECT branch_name FROM sales WHERE id=2').get().branch_name, 'Warehouse as sold')
  assert.equal(raw.prepare('SELECT branch_name FROM sales WHERE id=3').get().branch_name, null)
  assert.equal(raw.prepare('SELECT branch_name FROM fees WHERE id=900001').get().branch_name, 'Shop'); assert.equal(raw.prepare('SELECT branch_name FROM fees WHERE id=900002').get().branch_name, null)
  // ---- journal terminal, flag released, terminal evidence
  assert.equal(final.phase, 'completed'); assert.equal(raw.prepare("SELECT count(*) n FROM system_flags WHERE key='maintenance'").get().n, 0)
  const terminal = JSON.parse(final.terminal_json)
  assert.equal(terminal.committedChildren, before.movingProducts); assert.equal(terminal.movedQuantityText, String(round(before.sourceUnits)))
  assert.equal(terminal.folds.groups, folds.length)
  assert.deepEqual([terminal.folds.expirySplit, terminal.folds.supplierSplit, terminal.folds.roundingSplit, terminal.folds.uncostedMerges, terminal.folds.freeUnknownMerges,
    terminal.folds.emptySupplierMerges], [1, 1, 0, 1, 1, 1])
  assert.deepEqual(folds.filter(f => f.freeToUnknownBatchIds.length).map(f => [f.survivorBatchId, f.freeToUnknownBatchIds, f.unitCostUsdAfter]), [[1501, [1501], null]])
  assert.equal(folds.filter(f => f.uncostedBatchIds.length).length, 1); assert.equal(folds.filter(f => f.emptySupplierBatchIds.length).length, 1)
  assert.equal(raw.prepare("SELECT count(*) n FROM branch_cutovers WHERE phase='aborted'").get().n, 1)
  // every fold row is self-describing and conserves its quantity and value
  for (const fold of folds) {
    const sum = (list) => list.reduce((s, [, q]) => s + q, 0)
    assert.ok(near(sum(fold.before), sum(fold.after)))
    assert.equal(fold.after.filter(([, q]) => q !== 0).length, 1)
  }
  return { folds, closures }
}

async function main() {
  let checks = 0
  const check = async (name, fn) => { if (process.env.E2E_FILTER && !name.includes(process.env.E2E_FILTER)) return; await fn(); checks++; console.log('PASS ' + name) }
  const faults = {
    'capture#2': 'after', 'capture#4': 'before', 'capture#6': 'kill', 'snapshot#3': 'after', 'snapshot#5': 'kill',
    'seal#1': 'after', 'seal#2': 'kill', 'child#1': 'after', 'child#3': 'before', 'child#5': 'kill', 'seal#7': 'before',
    'fold#1': 'after', 'fold#2': 'kill', 'reconcile#1': 'before', 'reconcile#2': 'after', 'closures#1': 'after', 'closures#2': 'kill', 'done#1': 'after', 'finalize#1': 'after',
  }
  await check('production-shaped run completes under crash, lost ack, kill and duplicate delivery with every unit conserved', async () => {
    const run = await scenario({ faults, duplicate: true })
    const { folds } = verifyEndState(run)
    assert.ok(run.w.stats.duplicatesRefused > 50); assert.equal(run.w.stats.duplicatesCommitted, 0)
    assert.ok(folds.length >= 6); assert.ok(run.w.stats.maxBinds <= 100)
    // E10: fold and completion audit rows carry lot costs. The one general audit reader, GET /system/audit-logs, runs the
    // acquisition-cost projection, which strips them for a user without product_cost_view and keeps the quantities.
    assert.match(fs.readFileSync(path.join(root, 'src/routes/compat.ts'), 'utf8'), /app\.use\('\/system\/audit-logs', acquisitionCostResponses\)/)
    const logs = run.w.raw.prepare("SELECT action,details FROM audit_logs WHERE action IN ('branch_cutover_lot_fold','branch_cutover_completed') ORDER BY id").all().map(r => ({ ...r }))
    const clerk = { id: 9, username: 'clerk', role_code: 'manager', permissions: JSON.stringify({ audit_log: 'full', products: true, inventory: true }), role_permissions: '{}' }
    const viewer = { ...clerk, permissions: JSON.stringify({ audit_log: 'full', products: true, inventory: true, product_cost_view: true }) }
    assert.deepEqual(run.w.m.costs.projectAcquisitionCosts({ logs }, viewer), { logs })
    const hidden = run.w.m.costs.projectAcquisitionCosts({ logs }, clerk).logs
    assert.equal(hidden.length, logs.length); assert.ok(logs.some(r => JSON.parse(r.details).unitCostUsdAfter > 0))
    for (const [i, row] of hidden.entries()) {
      const shown = JSON.parse(row.details), original = JSON.parse(logs[i].details)
      assert.doesNotMatch(row.details, /unitCostUsd|costClass|costChanged/, row.action)
      if (row.action === 'branch_cutover_lot_fold') assert.deepEqual([shown.survivorBatchId, shown.foldedBatchIds, shown.before, shown.after, shown.uncostedBatchIds, shown.supplierKey],
        [original.survivorBatchId, original.foldedBatchIds, original.before, original.after, original.uncostedBatchIds, original.supplierKey])
      else assert.equal(shown.folds.groups, original.folds.groups)
    }
    // the projection is key-based: a cost under a key it does not recognise would leak (why the fold keys say 'cost')
    assert.deepEqual(JSON.parse(run.w.m.costs.projectAcquisitionCosts({ logs: [{ details: JSON.stringify({ priceBefore: 3, unitCostUsdAfter: 3 }) }] }, clerk).logs[0].details), { priceBefore: 3 })
    console.log('E2E METRICS ' + JSON.stringify({ products: run.w.products.length, lots: run.w.lots.length, children: run.final.committed_children, folds: folds.length,
      duplicatesRefused: run.w.stats.duplicatesRefused, revision: run.final.revision }))
    run.w.raw.close()
  })
  await check('a fault-free run reaches the identical end state (faults change nothing but the journal revision)', async () => {
    const clean = await scenario({})
    const faulted = await scenario({ faults })
    verifyEndState(clean); verifyEndState(faulted)
    const state = (raw) => ['branch_stock', 'branch_batch_stock'].map(t => raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().map(({ updated_at, created_at, ...r }) => r))
      .concat([raw.prepare('SELECT id,unit_cost_usd,received_branch_name FROM product_batches ORDER BY id').all(), raw.prepare('SELECT id,name,is_active,is_default,role,successor_branch_id FROM branches ORDER BY id').all(),
        raw.prepare('SELECT id,status,reversible,last_error FROM action_history WHERE id<20999 ORDER BY id').all()])
    assert.deepEqual(state(faulted.w.raw), state(clean.w.raw))
    clean.w.raw.close(); faulted.w.raw.close()
  })
  await check('E3 a fractional pair whose REAL sum is not an exact decimal refuses at begin, before anything moves (verifier P1)', async () => {
    for (const [label, setup] of [
      ['shared lot 0.2 + 0.1', (raw) => {
        raw.exec(`INSERT INTO products(id,name,sku,is_active,stock_quantity,cost_price_usd) VALUES(60,'P1 fractional shared lot','SKU60',1,0.3,1);
          INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(60,2,0.2),(60,1,0.1);
          INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,unit_cost_usd,received_branch_id,received_quantity,is_active,batch_number)
            VALUES(6001,60,'lot-6001','L6001','2026-09-01',1,2,0.3,1,6001);
          INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(6001,2,0.2),(6001,1,0.1);`)
      }],
      ['product only, untracked 0.7 + 0.1', (raw) => raw.exec(`INSERT INTO products(id,name,sku,is_active,stock_quantity,cost_price_usd) VALUES(61,'untracked fractional','SKU61',1,0.8,1);
          INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(61,2,0.7),(61,1,0.1);`)],
      ['a stored value that is not a 12-place decimal', (raw) => raw.exec(`INSERT INTO products(id,name,sku,is_active,stock_quantity,cost_price_usd) VALUES(62,'stored 0.1+0.2','SKU62',1,1,1);
          INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(62,1,0.1+0.2);`)],
    ]) {
      const w = world({ generatedProducts: 0 }); setup(w.raw)
      const stock = () => w.raw.prepare('SELECT product_id,branch_id,quantity FROM branch_stock ORDER BY product_id,branch_id').all()
      const lots = () => w.raw.prepare('SELECT batch_id,branch_id,quantity FROM branch_batch_stock ORDER BY batch_id,branch_id').all()
      const before = [stock(), lots()]
      const plan = await w.m.parent.inspectBranchCutover(w.db, ACTOR, 1, IDS, PARENT_BUDGET)
      assert.deepEqual(plan.capabilities, [{ code: 'unsupported_stock_state', detail: 'inexact' }], label)
      assert.equal(plan.activationReady, false)
      await assert.rejects(w.m.parent.beginBranchCutover(w.db, ACTOR, 1, { ...IDS, ...NAMES, requestId: 'cutover_night_e3', controlIncarnation: INCARNATION,
        expectedSourceJson: plan.sourcePreimageJson, expectedTargetJson: plan.targetPreimageJson, expectedSchemaDigest: plan.schemaDigest }, PARENT_BUDGET),
      error => error.capability === 'unsupported_stock_state:inexact', label)
      assert.equal(w.raw.prepare('SELECT count(*) n FROM branch_cutovers').get().n, 0, label)
      assert.equal(w.raw.prepare("SELECT count(*) n FROM system_flags WHERE key='maintenance'").get().n, 0, label)
      assert.deepEqual([stock(), lots()], before, label + ': nothing moved')
      w.raw.close()
    }
    // the same fixture with an exactly representable pair (0.25 + 0.5) is admitted
    const w = world({ generatedProducts: 0 })
    w.raw.exec(`INSERT INTO products(id,name,sku,is_active,stock_quantity,cost_price_usd) VALUES(60,'binary exact','SKU60',1,0.75,1);
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(60,2,0.25),(60,1,0.5);`)
    assert.deepEqual((await w.m.parent.inspectBranchCutover(w.db, ACTOR, 1, IDS, PARENT_BUDGET)).capabilities, [])
    w.raw.close()
  })
  await check('E7 a redeploy or migration that changes the begin contract refuses explicitly, writes nothing, and the begin build resumes', async () => {
    const w = world({ generatedProducts: 4 })
    const base = snapshot(w.raw)
    const turn = async () => {
      const row = status(w)
      if (labelOf(row) === 'child') await w.m.child.executePlannedBranchCutoverChild(w.db, ACTOR, ownership(row), { sequence: row.next_sequence, childJson: row.planned_child_json }, CHILD_BUDGET, 1)
      else await w.m.parent.continueBranchCutover(w.db, ACTOR, 1, { operationId: row.operation_id, expectedRevision: row.revision }, PARENT_BUDGET)
      invariants(w.raw, base, 'E7 ' + labelOf(status(w)))
      return status(w)
    }
    const plan = await w.m.parent.inspectBranchCutover(w.db, ACTOR, 1, IDS, PARENT_BUDGET)
    await w.m.parent.beginBranchCutover(w.db, ACTOR, 1, { ...IDS, ...NAMES, requestId: 'cutover_night_e7', controlIncarnation: INCARNATION,
      expectedSourceJson: plan.sourcePreimageJson, expectedTargetJson: plan.targetPreimageJson, expectedSchemaDigest: plan.schemaDigest }, PARENT_BUDGET)
    let row = status(w)
    while (!(row.phase === 'moving' && row.committed_children >= 3 && !row.planned_child_json)) row = await turn()
    const frozen = () => JSON.stringify([w.raw.prepare('SELECT * FROM branch_cutovers ORDER BY operation_id').all(), w.raw.prepare('SELECT * FROM branch_stock ORDER BY rowid').all(),
      w.raw.prepare("SELECT value FROM system_flags WHERE key='maintenance'").get()])
    // P7: CAPTURE_PAGE_CAP 256 -> 128 redeployed mid-run
    const held = frozen()
    w.reload('page-cap')
    await assert.rejects(turn(), error => error.capability.startsWith('contract_changed_since_begin:registry:')
      && /not the code this run began with/.test(error.message) && /Nothing was changed/.test(error.message) && error.capability !== 'parent_capture_contract_required')
    assert.equal(frozen(), held, 'the refusal writes nothing and keeps the fence')
    // redeploying the begin build resumes the same operation
    w.reload()
    while (row.phase !== 'ready') row = await turn()
    // a migration applied before finalize: explicit schema refusal; reverting it lets finalize complete
    w.raw.exec('ALTER TABLE fees ADD COLUMN cutover_probe TEXT')
    const ready = frozen()
    await assert.rejects(turn(), error => error.capability.startsWith('contract_changed_since_begin:schema:') && /schema changed after this run began/.test(error.message))
    assert.equal(frozen(), ready)
    w.raw.exec('ALTER TABLE fees DROP COLUMN cutover_probe')
    row = await turn()
    assert.equal(row.phase, 'completed')
    for (const [p, q] of base.product) assert.ok(near(w.raw.prepare('SELECT coalesce(sum(quantity),0) n FROM branch_stock WHERE product_id=? AND branch_id=1').get(p).n, q), 'LC Store product ' + p)
    w.raw.close()
  })
  await check('a D1 CPU-limit reset (7429) at every stage, on a read and on a batch, is retryable: nothing half-written, same operation, identical end state', async () => {
    const cpuFaults = {
      'begin#1': 'cpu-read-2', 'begin#2': 'cpu-batch', 'capture#1': 'cpu-read-0', 'capture#3': 'cpu-batch', 'snapshot#1': 'cpu-read-1', 'snapshot#2': 'cpu-batch',
      'seal#1': 'cpu-read-1', 'seal#3': 'cpu-batch', 'child#1': 'cpu-read-2', 'child#2': 'cpu-batch', 'fold#1': 'cpu-read-1', 'fold#2': 'cpu-batch',
      'reconcile#1': 'cpu-read-1', 'reconcile#2': 'cpu-batch', 'closures#1': 'cpu-read-1', 'closures#2': 'cpu-batch', 'done#1': 'cpu-batch', 'done#2': 'cpu-read-1',
      'finalize#1': 'cpu-read-2', 'finalize#2': 'cpu-batch',
    }
    const clean = await scenario({})
    const faulted = await scenario({ faults: cpuFaults })
    verifyEndState(clean); verifyEndState(faulted)
    const state = (raw) => ['branch_stock', 'branch_batch_stock'].map(t => raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().map(({ updated_at, created_at, ...r }) => r))
      .concat([raw.prepare('SELECT id,unit_cost_usd,received_branch_name FROM product_batches ORDER BY id').all(), raw.prepare('SELECT id,name,is_active,is_default,role,successor_branch_id FROM branches ORDER BY id').all(),
        raw.prepare('SELECT id,status,reversible,last_error FROM action_history WHERE id<20999 ORDER BY id').all()])
    assert.deepEqual(state(faulted.w.raw), state(clean.w.raw))
    // one operation carried the whole run (plus the rehearsal aborted before it)
    assert.equal(faulted.w.raw.prepare("SELECT count(*) n FROM branch_cutovers WHERE phase<>'aborted'").get().n, 1)
    assert.equal(faulted.w.raw.prepare("SELECT count(DISTINCT request_id) n FROM transfer_operation_receipts WHERE request_id LIKE 'bc\\_%' ESCAPE '\\'").get().n, faulted.final.committed_children)
    clean.w.raw.close(); faulted.w.raw.close()
  })
  // ---- discriminating controls: each plausible wrong implementation must fail this test
  for (const [control, expectation] of [['name-admission', 'refuses'], ['name-finalize', 'red'], ['mean', 'red'], ['double', 'red'], ['no-close', 'refuses'], ['no-rule', 'red'],
    ['utc-slice', 'red'], ['no-round', 'red'], ['supplier-blind', 'red'], ['zero-weighted', 'red'], ['strict-real-sums', 'refuses'],
    ['free-unknown-apart', 'red'], ['free-unknown-zero', 'red'], ['slash-apart', 'red'], ['slash-day-first', 'red']]) {
    await check('control RED: ' + control, async () => {
      let red = false, message = ''
      try {
        const run = await scenario({ control, duplicate: control === 'double', faults: control === 'double' ? { 'closures#1': 'after', 'finalize#1': 'after' } : {} })
        try { verifyEndState(run) } catch (error) { red = true; message = error.message } finally { run.w.raw.close() }
      } catch (error) { red = true; message = error.message }
      assert.ok(red, control + ' must fail the end-to-end proof')
      console.log(`  control ${control} (${expectation}): ${message.split('\n')[0].slice(0, 140)}`)
    })
  }
  console.log(`${checks} branch cutover end-to-end groups passed`)
}
async function bench(products) {
  const timings = {}
  const run = await scenario({ generatedProducts: products, timings, pageSize: Number(process.env.E2E_BENCH_PAGE || 256) })
  verifyEndState(run)
  const pct = (list, p) => { const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
  const table = Object.entries(timings).map(([label, t]) => ({ label, count: t.count, wallP50: +pct(t.ms, 0.5).toFixed(2), wallP95: +pct(t.ms, 0.95).toFixed(2),
    cpuNotDbP50: +pct(t.js, 0.5).toFixed(2), cpuNotDbP95: +pct(t.js, 0.95).toFixed(2), cpuNotDbMax: +Math.max(...t.js).toFixed(2), dbP95: +pct(t.db, 0.95).toFixed(2), maxReads: t.maxReads, maxStatements: t.maxStatements }))
  console.log('BENCH ' + JSON.stringify({ products: run.w.products.length, lots: run.w.lots.length, children: run.final.committed_children, invocations: Object.values(timings).reduce((n, t) => n + t.count, 0) }))
  for (const row of table) console.log('BENCH ' + JSON.stringify(row))
  run.w.raw.close()
}
module.exports = { world, bench, drive, snapshot, scenario, verifyEndState, dateKey, ACTOR, PARENT_BUDGET, CHILD_BUDGET, IDS, NAMES }
if (require.main === module) (process.env.E2E_BENCH ? bench(Number(process.env.E2E_BENCH)) : main()).catch(e => { console.error(e); process.exitCode = 1 })
