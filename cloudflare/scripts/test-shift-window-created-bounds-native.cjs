'use strict'
// S11 (11 Nov D1 audit): shiftWindowWhere() wrapped created_at in datetime(), which no index on created_at can narrow, so a shift close read every sale, return
// and fee ever recorded. It now also emits plain widened bounds beside the exact datetime() terms, so idx_sales_created_pg / idx_returns_created_pg narrow the scan
// and the datetime() terms still decide. Pinned here:
//   - DIFFERENTIAL over 300+ windows and rows stored in every shape the app has written or could (SQLite 'YYYY-MM-DD HH:MM:SS', ISO 'T...Z' with milliseconds, and
//     offset forms +07:00 / -05:00 / +14:00 / -12:00 / +05:30): the new clauses select exactly the rows the datetime()-only clauses select;
//   - DISCRIMINATING: the plausible wrong bounds (+1 day above, no -1 day below) lose rows in the same windows, so the test goes red on them;
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
check('the datetime() terms are still there (the plain bounds only prune), with the bounds widened one day below and two days above', () => {
  const { clauses } = shiftWindowWhere('sales', { createdFrom: '2026-11-05T00:00:00Z', createdTo: '2026-11-06T00:00:00Z' })
  assert.deepEqual(clauses, [
    "sales.created_at >= date(@createdFrom, '-1 day')", 'datetime(sales.created_at) >= @createdFrom',
    "sales.created_at < date(@createdTo, '+2 day')", 'datetime(sales.created_at) < @createdTo',
  ])
  assert.deepEqual(shiftWindowWhere('sales', {}).clauses, [], 'a caller with no shift keys emits nothing')
})
check('DISCRIMINATING: an upper bound of +1 day loses +07:00 rows in many windows; a lower bound without -1 day loses -05:00/-12:00 rows; the shipped form loses none', () => {
  const plusOne = lost((table, p) => ids(table, [`${table}.created_at >= date(@createdFrom, '-1 day')`, `${table}.created_at < date(@createdTo, '+1 day')`, ...exactClauses(table, true, true)], p))
  const noMinus = lost((table, p) => ids(table, [`${table}.created_at >= date(@createdFrom)`, `${table}.created_at < date(@createdTo, '+2 day')`, ...exactClauses(table, true, true)], p))
  const shipped = lost((table, p) => ids(table, shiftWindowWhere(table, { createdFrom: p.createdFrom, createdTo: p.createdTo }).clauses, p))
  assert.ok(plusOne >= 50, `+1 day lost rows in ${plusOne} windows`)
  assert.ok(noMinus >= 20, `no -1 day lost rows in ${noMinus} windows`)
  assert.equal(shipped, 0)
  console.log(`     +1 day: ${plusOne} windows lose rows; no -1 day: ${noMinus}; shipped: ${shipped}`)
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
