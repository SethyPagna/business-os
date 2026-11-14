'use strict'
// S11 (11 Nov D1 audit): shiftWindowWhere() wrapped created_at in datetime(), which no index on created_at can narrow, so a shift close read every sale, return
// and fee ever recorded. It now also emits plain widened bounds beside the exact datetime() terms, so idx_sales_created_pg / idx_returns_created_pg narrow the scan
// and the datetime() terms still decide. Pinned here:
//   - DIFFERENTIAL over 300+ windows and rows stored in every shape the app has written or could (SQLite 'YYYY-MM-DD HH:MM:SS', ISO 'T...Z' with milliseconds, and
//     offset forms +07:00 / -05:00 / +14:00 / -12:00 / +05:30): the new clauses select exactly the rows the datetime()-only clauses select;
//   - DISCRIMINATING: the plausible wrong bounds (+1 day above, a date-granular floor, +13 / -11 hours) lose rows in the same windows, so the test goes red on them;
//   - the planner SEARCHes sales and returns by their created_at index (and SCANs with the datetime()-only form), for the clauses the code really emits;
//   - what the plain bounds cannot hold (a Julian-day number or a time-only text) and why no writer produces it: the writer census below.
//
// Run (from cloudflare/): node scripts/test-shift-window-created-bounds-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('node:module')
const { DatabaseSync } = require('node:sqlite')

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try { new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath)) } finally { Module._load = originalLoad }
  return moduleObj.exports
}
const moneyPrecision = loadReal('lib/moneyPrecision.ts')
const reportMoneyPrecision = loadReal('lib/reportMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const promotionRules = loadReal('lib/promotionRules.ts', { './moneyPrecision': moneyPrecision })
const saleItemPricing = loadReal('lib/saleItemPricing.ts', { './moneyPrecision': moneyPrecision, './promotionRules': promotionRules })
const saleMoneyPrecision = loadReal('lib/saleMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const refundMoneyPrecision = loadReal('lib/refundMoneyPrecision.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const customerReturnEntitlement = loadReal('lib/customerReturnEntitlement.ts', { './moneyPrecision': moneyPrecision, './refundMoneyPrecision': refundMoneyPrecision, './saleItemPricing': saleItemPricing, './saleMoneyPrecision': saleMoneyPrecision })
const analytics = loadReal('lib/salesAnalytics.ts', {
  './saleStatusResolution': require('./harness/sale_status_resolution.cjs'), './schemaProbe': loadReal('lib/schemaProbe.ts'), './db': { getDb: () => ({}) },
  './removalLosses': loadReal('lib/removalLosses.ts'), './businessDateWindow': loadReal('lib/businessDateWindow.ts'), './reportMoneyPrecision': reportMoneyPrecision,
  './customerReturnEntitlement': customerReturnEntitlement, './refundMoneyPrecision': refundMoneyPrecision, './saleMoneyPrecision': saleMoneyPrecision,
})
const { shiftWindowWhere } = analytics

const directory = path.join(__dirname, '../migrations')
const db = new DatabaseSync(':memory:')
for (const f of fs.readdirSync(directory).filter((n) => n.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(directory, f), 'utf8'))
let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }

// ---- rows: one per (day, hour, shape) over 14 days, plus the exact-boundary seconds ------------------------------------------------------------------------
const pad = (n, w = 2) => String(n).padStart(w, '0')
const shapes = [
  (d, h, m) => `${d} ${pad(h)}:${pad(m)}:00`,
  (d, h, m) => `${d}T${pad(h)}:${pad(m)}:00.000Z`,
  (d, h, m) => `${d}T${pad(h)}:${pad(m)}:00+07:00`,
  (d, h, m) => `${d}T${pad(h)}:${pad(m)}:00-05:00`,
  (d, h, m) => `${d}T${pad(h)}:${pad(m)}:00+14:00`,
  (d, h, m) => `${d}T${pad(h)}:${pad(m)}:00-12:00`,
  (d, h, m) => `${d}T${pad(h)}:${pad(m)}:00+05:30`,
]
const day = (offset) => new Date(Date.UTC(2026, 10, 1 + offset)).toISOString().slice(0, 10)
const stored = []
for (let o = 0; o < 14; o++) for (const h of [0, 1, 6, 11, 12, 13, 17, 18, 22, 23]) for (const shape of shapes) stored.push(shape(day(o), h, h === 23 ? 59 : 30))
const ins = {
  sales: db.prepare('INSERT INTO sales(created_at, cashier_id) VALUES (?, 3)'),
  returns: db.prepare('INSERT INTO returns(created_at) VALUES (?)'),
}
db.exec('BEGIN')
for (const text of stored) { ins.sales.run(text); ins.returns.run(text) }
db.exec('COMMIT')

// ---- windows: 24 starts x 12 lengths = 288, plus open-ended and cashier ones ------------------------------------------------------------------------------
const windows = []
for (let s = 0; s < 24; s++) {
  const start = Date.UTC(2026, 10, 2) + s * 3 * 3600 * 1000 + (s % 5) * 600000
  for (const hours of [0.5, 1, 4, 8, 13, 16, 23, 24, 30, 48, 72, 24 * 9]) windows.push({ from: new Date(start).toISOString(), to: new Date(start + hours * 3600 * 1000).toISOString() })
}
for (let s = 0; s < 6; s++) {
  const at = new Date(Date.UTC(2026, 10, 4) + s * 5 * 3600 * 1000).toISOString()
  windows.push({ from: at }, { to: at })
}
for (const t of ['T11:00:00Z', 'T11:30:00Z', 'T11:59:59Z', 'T05:00:00Z', 'T16:59:00Z', 'T17:00:00Z', 'T23:59:00Z']) for (const d of [3, 4, 7]) for (const hours of [1, 8, 30]) { const from = Date.parse(day(d) + t); windows.push({ from: new Date(from).toISOString(), to: new Date(from + hours * 3600 * 1000).toISOString() }) }
assert.ok(windows.length >= 288)

const ids = (table, clauses, params) => db.prepare(`SELECT id FROM ${table} AS ${table} WHERE ${clauses.join(' AND ') || '1'} ORDER BY id`).all(params).map((r) => r.id)
const exactClauses = (alias, from, to) => {
  const out = []
  if (from) out.push(`datetime(${alias}.created_at) >= @createdFrom`)
  if (to) out.push(`datetime(${alias}.created_at) < @createdTo`)
  return out
}
const lost = (variant) => {
  let windowsWithLoss = 0
  for (const w of windows) {
    const real = shiftWindowWhere('sales', { createdFrom: w.from, createdTo: w.to })
    const exact = ids('sales', exactClauses('sales', real.params.createdFrom, real.params.createdTo), real.params)
    if (JSON.stringify(variant('sales', real.params)) !== JSON.stringify(exact)) windowsWithLoss += 1
  }
  return windowsWithLoss
}

check('DIFFERENTIAL: the emitted clauses select exactly the rows of the datetime()-only clauses in every one of 300+ windows, for sales and returns', () => {
  let nonEmpty = 0
  for (const w of windows) {
    for (const table of ['sales', 'returns']) {
      const real = shiftWindowWhere(table, { createdFrom: w.from, createdTo: w.to })
      const exact = ids(table, exactClauses(table, real.params.createdFrom, real.params.createdTo), real.params)
      assert.deepEqual(ids(table, real.clauses, real.params), exact, `${table} ${JSON.stringify(w)}`)
      if (exact.length) nonEmpty += 1
    }
  }
  assert.ok(windows.length >= 288 && nonEmpty > 400, `${windows.length} windows, ${nonEmpty} with rows`)
  const cashier = shiftWindowWhere('sales', { createdFrom: windows[3].from, createdTo: windows[3].to, cashierId: 3 })
  assert.deepEqual(ids('sales', cashier.clauses, cashier.params), ids('sales', exactClauses('sales', cashier.params.createdFrom, cashier.params.createdTo).concat('sales.cashier_id = @cashierId'), cashier.params))
})
check('the datetime() terms are still there (the plain bounds only prune), with the bounds widened to twelve hours below and two days above', () => {
  const { clauses } = shiftWindowWhere('sales', { createdFrom: '2026-11-05T00:00:00Z', createdTo: '2026-11-06T00:00:00Z' })
  assert.deepEqual(clauses, [
    "sales.created_at >= datetime(@createdFrom, '-12 hours')", 'datetime(sales.created_at) >= @createdFrom',
    "sales.created_at < date(@createdTo, '+2 day')", 'datetime(sales.created_at) < @createdTo',
  ])
  assert.deepEqual(shiftWindowWhere('sales', {}).clauses, [], 'a caller with no shift keys emits nothing')
})
// The floor expression is read OUT of the emitted clause, and every mutant is that clause with the floor (or the upper bound) swapped, so no copy of the formula is evaluated here.
const emitted = shiftWindowWhere('sales', { createdFrom: '2026-11-05T00:00:00Z', createdTo: '2026-11-06T00:00:00Z' }).clauses
const FLOOR_PREFIX = 'sales.created_at >= '
const floorExpr = emitted[0].slice(FLOOR_PREFIX.length)
const mutants = {
  plusOneAbove: (c) => c.replace("date(@createdTo, '+2 day')", "date(@createdTo, '+1 day')"),
  dateGranular: (c) => c.replace(floorExpr, 'date(@createdFrom)'),
  plus13: (c) => c.replace(floorExpr, "datetime(@createdFrom, '+13 hours')"),
  minus11: (c) => c.replace(floorExpr, "datetime(@createdFrom, '-11 hours')"),
}
const mutate = (name, table, p) => shiftWindowWhere(table, { createdFrom: p.createdFrom, createdTo: p.createdTo }).clauses.map(mutants[name])
check('DISCRIMINATING: +1 day above, a date-granular floor, +13 hours and -11 hours each lose rows in the DIFFERENTIAL (clauses mutated from the emitted ones); the shipped clauses lose none', () => {
  for (const name of Object.keys(mutants)) assert.notDeepEqual(mutate(name, 'sales', { createdFrom: '2026-11-05 00:00:00', createdTo: '2026-11-06 00:00:00' }), emitted, name + ' must change the emitted clauses')
  const lose = {}
  for (const name of Object.keys(mutants)) lose[name] = lost((table, p) => ids(table, mutate(name, table, p), p))
  const shipped = lost((table, p) => ids(table, shiftWindowWhere(table, { createdFrom: p.createdFrom, createdTo: p.createdTo }).clauses, p))
  assert.ok(lose.plusOneAbove >= 50, '+1 day lost rows in ' + lose.plusOneAbove + ' windows')
  assert.ok(lose.dateGranular >= 20, 'date(@createdFrom) lost rows in ' + lose.dateGranular + ' windows')
  assert.ok(lose.plus13 >= 20, '+13 hours lost rows in ' + lose.plus13 + ' windows')
  assert.ok(lose.minus11 >= 5, '-11 hours lost rows in ' + lose.minus11 + ' windows')
  assert.equal(shipped, 0)
  console.log('     ' + JSON.stringify(lose) + ' windows lose rows; shipped: ' + shipped)
})

// ---- lane/shift-close-reads: the lower bound is taken from the CAMBODIA business date, never later than any row of the window ----------------------------------
const stamp = (ms, shape) => {
  const iso = new Date(ms).toISOString(), d = iso.slice(0, 10), h = Number(iso.slice(11, 13)), m = Number(iso.slice(14, 16)), sec = Number(iso.slice(17, 19))
  const offsets = [null, 'Z', '+07:00', '-05:00', '+14:00', '-12:00', '+05:30']
  const o = offsets[shape]
  if (o === null) return iso.slice(0, 19).replace('T', ' ')
  if (o === 'Z') return iso
  const sign = o[0] === '-' ? -1 : 1, [oh, om] = o.slice(1).split(':').map(Number)
  const local = new Date(ms + sign * (oh * 60 + om) * 60000).toISOString().slice(0, 19)
  void d; void h; void m; void sec
  return local + o
}
// The floor is evaluated by SQLite from the clause the code emits (floorExpr, above), never from a re-typed formula.
const floorAt = (iso) => db.prepare('SELECT ' + floorExpr + ' AS d').get({ createdFrom: iso.slice(0, 19).replace('T', ' ') }).d
const passesFloor = (expr, text, startIso) => db.prepare('SELECT @text >= ' + expr + ' AS ok').get({ text, createdFrom: startIso.slice(0, 19).replace('T', ' ') }).ok
const startsAround = []
for (let k = 0; k < 144; k++) startsAround.push(Date.UTC(2026, 10, 5) + k * 10 * 60000 + 7000)
for (const t of ['00:00:00', '05:00:00', '11:00:00', '11:30:15', '11:59:59', '12:00:00', '16:59:00', '16:59:59', '17:00:00', '17:00:01', '23:59:00', '23:59:59']) startsAround.push(Date.parse('2026-11-05T' + t + 'Z'))
const dropped = (expr) => {
  let n = 0
  for (const start of startsAround) {
    const iso = new Date(start).toISOString()
    for (let shape = 0; shape < 7; shape++) for (const delta of [0, 1000, 3600000, 86400000]) if (passesFloor(expr, stamp(start + delta, shape), iso) !== 1) n += 1
  }
  return n
}
check('FLOOR: the emitted floor is exactly twelve hours before the window start, in every minute class (11:xx, 05:00, 16:59, 17:00, 23:59), whatever the Cambodia date is', () => {
  for (const t of ['2026-11-05T05:00:00Z', '2026-11-05T11:30:15Z', '2026-11-05T16:59:59Z', '2026-11-05T17:00:00Z', '2026-11-05T20:00:00Z', '2026-11-05T23:59:59Z', '2026-11-06T00:00:00Z', '2026-12-31T23:59:59Z']) {
    assert.equal(floorAt(t), new Date(Date.parse(t) - 12 * 3600000).toISOString().slice(0, 19).replace('T', ' '), t)
  }
  assert.equal(emitted[0], "sales.created_at >= datetime(@createdFrom, '-12 hours')")
})
check('FLOOR SUPERSET: for 156 shift starts (around the clock plus 11:xx, 05:00, 16:59, 17:00 and 23:59) and every stored shape, a row at the start, 1 s, 1 h and 1 day after passes the EMITTED floor; +13 hours, -11 hours and a date-granular floor each drop rows', () => {
  assert.equal(startsAround.length, 156)
  assert.equal(dropped(floorExpr), 0, 'the emitted floor drops a row of the window')
  for (const [name, expr] of [['+13 hours', "datetime(@createdFrom, '+13 hours')"], ['-11 hours', "datetime(@createdFrom, '-11 hours')"], ['date(@createdFrom)', 'date(@createdFrom)']]) assert.ok(dropped(expr) > 0, name + ' must drop rows in the superset check')
})
check('EDGES: a sale 1 s after open, shifts opened just before and just after 17:00Z, and a shift spanning Cambodia midnight select exactly the exact-window rows (plain bounds alone select a superset)', () => {
  const edge = new DatabaseSync(':memory:'); for (const f of fs.readdirSync(directory).filter((n) => n.endsWith('.sql')).sort()) edge.exec(fs.readFileSync(path.join(directory, f), 'utf8'))
  const insert = edge.prepare('INSERT INTO sales(created_at, cashier_id) VALUES (?, 3)')
  const cases = [
    { name: 'opened 03:00:00Z', from: '2026-11-05T03:00:00Z', to: '2026-11-05T09:00:00Z' },
    { name: 'opened 16:59:59Z, closed after Cambodia midnight', from: '2026-11-05T16:59:59Z', to: '2026-11-05T17:00:01Z' },
    { name: 'opened 17:00:00Z', from: '2026-11-05T17:00:00Z', to: '2026-11-05T23:00:00Z' },
    { name: 'opened 17:00:01Z', from: '2026-11-05T17:00:01Z', to: '2026-11-06T03:00:00Z' },
    { name: 'spans Cambodia midnight (23:00 -> 02:00)', from: '2026-11-05T16:00:00Z', to: '2026-11-05T19:00:00Z' },
    { name: 'opened 20:00:00Z', from: '2026-11-05T20:00:00Z', to: '2026-11-06T02:00:00Z' },
    { name: 'opened 11:30:00Z', from: '2026-11-05T11:30:00Z', to: '2026-11-05T15:00:00Z' },
    { name: 'opened 05:00:00Z', from: '2026-11-05T05:00:00Z', to: '2026-11-05T09:00:00Z' },
    { name: 'opened 23:59:00Z', from: '2026-11-05T23:59:00Z', to: '2026-11-06T04:00:00Z' },
  ]
  let checked = 0
  for (const c of cases) {
    edge.exec('DELETE FROM sales')
    const from = Date.parse(c.from), to = Date.parse(c.to)
    const wanted = new Set()
    for (const delta of [-1000, 0, 1000]) for (let shape = 0; shape < 7; shape++) {
      insert.run(stamp(from + delta, shape)); insert.run(stamp(to + delta, shape))
    }
    for (const mid of [60000, (to - from) / 2]) for (let shape = 0; shape < 7; shape++) insert.run(stamp(from + mid, shape))
    const real = shiftWindowWhere('sales', { createdFrom: c.from, createdTo: c.to })
    const idsOf = (clauses) => edge.prepare(`SELECT id FROM sales AS sales WHERE ${clauses.join(' AND ')} ORDER BY id`).all(real.params).map((r) => r.id)
    const exact = idsOf(exactClauses('sales', true, true)), shipped = idsOf(real.clauses), plainOnly = idsOf([real.clauses[0], real.clauses[2]])
    assert.deepEqual(shipped, exact, c.name)
    assert.ok(exact.length >= 10, `${c.name}: ${exact.length} rows in the window`)
    assert.ok(exact.every((id) => plainOnly.includes(id)), `${c.name}: the plain bounds alone keep every window row`)
    const one = edge.prepare("SELECT id FROM sales WHERE created_at = ?").get(stamp(from + 1000, 1)); assert.ok(one && exact.includes(one.id), `${c.name}: the sale 1 s after open is in`)
    const before = edge.prepare("SELECT id FROM sales WHERE created_at = ?").get(stamp(from - 1000, 1)); assert.ok(before && !exact.includes(before.id), `${c.name}: the sale 1 s before open is out`)
    checked += 1
  }
  assert.equal(checked, cases.length)
})

const plan = (statement, params) => db.prepare(`EXPLAIN QUERY PLAN ${statement}`).all(params).map((r) => r.detail).join(' | ')
check('PLAN: sales and returns are SEARCHed by their created_at index with the emitted clauses and SCANned with the datetime()-only form', () => {
  for (const [table, index] of [['sales', 'idx_sales_created_pg'], ['returns', 'idx_returns_created_pg']]) {
    const real = shiftWindowWhere(table, { createdFrom: '2026-11-05T00:00:00Z', createdTo: '2026-11-06T00:00:00Z' })
    const withBounds = plan(`SELECT COUNT(*) FROM ${table} AS ${table} WHERE ${real.clauses.join(' AND ')}`, real.params)
    assert.match(withBounds, new RegExp(`SEARCH ${table} USING (COVERING )?INDEX ${index} \\(created_at>\\? AND created_at<\\?\\)`), withBounds)
    const old = plan(`SELECT COUNT(*) FROM ${table} AS ${table} WHERE ${exactClauses(table, true, true).join(' AND ')}`, real.params)
    assert.match(old, new RegExp(`SCAN ${table}`), old)
  }
})
check('PLAN: the shift close statements (cashier, branch and the shape the close really issues) still use the created_at index', () => {
  const real = shiftWindowWhere('sales', { createdFrom: '2026-11-05T00:00:00Z', createdTo: '2026-11-06T00:00:00Z', cashierId: 3 })
  const p = plan(`SELECT COUNT(*) FROM sales AS sales WHERE ${real.clauses.join(' AND ')} AND COALESCE(sales.sale_status,'Completed') <> 'Cancelled'`, real.params)
  assert.ok(p.startsWith('SEARCH sales USING') && p.includes('created_at>?') && p.includes('created_at<?'), p)
  assert.doesNotMatch(p, /SCAN sales(?! USING)/, p)
})

check('PLAN: fees keep using their datetime(created_at) expression index with the emitted clauses', () => {
  const real = shiftWindowWhere('fees', { createdFrom: '2026-11-05T00:00:00Z', createdTo: '2026-11-06T00:00:00Z' })
  const p = plan('SELECT COUNT(*) FROM fees AS fees WHERE ' + real.clauses.join(' AND '), real.params)
  assert.ok(p.includes('idx_fees_created_dt'), p)
})

// ---- writer census: what the plain bounds assume about stored text -------------------------------------------------------------------------------------------
check('WRITER CENSUS: created_at of sales, returns and fees defaults to CURRENT_TIMESTAMP, and no route stores a client-supplied time', () => {
  for (const table of ['sales', 'returns', 'fees']) {
    const column = db.prepare('SELECT dflt_value AS d FROM pragma_table_info(?) WHERE name = ?').get(table, 'created_at')
    assert.match(String(column.d), /CURRENT_TIMESTAMP/i, table)
  }
  const { resolveClientCreatedAt } = loadReal('lib/clientTimestamp.ts')
  for (const raw of ['2026-11-05 10:00:00', '2026-11-05T10:00:00+07:00', '2026-11-05T10:00:00Z', 'garbage', 12345, '10:30', '2461354.5', '2026-11-05']) {
    const claimed = resolveClientCreatedAt(raw, { nowMs: Date.UTC(2026, 10, 5, 10, 0, 0) }).claimed
    assert.ok(claimed === null || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(claimed), `${raw} -> ${claimed}`)
  }
})
check('WRITER CENSUS: the INSERT sites of sales, returns and fees are the twelve reviewed ones (a new writer must be checked against the plain bounds)', () => {
  const root = path.join(__dirname, '..', 'src')
  const found = []
  const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (full.endsWith('.ts')) { const text = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n'); const m = text.match(/INSERT( OR [A-Z]+)? INTO (sales|returns|fees)\b/g); if (m) found.push(`${path.relative(root, full).replace(/\\/g, '/')}:${m.length}`) } } }
  walk(root)
  assert.deepEqual(found.sort(), [
    'lib/returnExchangeCreate.ts:2', 'lib/saleBulkStatus.ts:2', 'lib/salesImportCommit.ts:1', 'lib/stockActionCommit.ts:1', 'routes/fees.ts:1', 'routes/returns.ts:3', 'routes/sales.ts:2',
  ], 'a new writer of sales, returns or fees appeared: confirm it stores CURRENT_TIMESTAMP or an ISO string, then update this list')
})
check('KNOWN EXCLUSION: the plain bounds cannot hold a Julian-day number or a time-only text, which datetime() would read (none exists in the 7 Oct production copy)', () => {
  const real = shiftWindowWhere('sales', { createdFrom: '2026-11-09T00:00:00Z', createdTo: '2026-11-11T00:00:00Z' })
  db.exec("INSERT INTO sales(id, created_at) VALUES (900001, '12:30'), (900002, 2461354.5)")
  const exact = ids('sales', exactClauses('sales', true, true), real.params)
  const bounded = ids('sales', real.clauses, real.params)
  assert.ok(exact.includes(900002) && !bounded.includes(900002))
  db.exec('DELETE FROM sales WHERE id IN (900001, 900002)')
})
console.log(`${passed} checks passed.`)
