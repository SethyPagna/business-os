'use strict'
// D1 audit wave 2, d1-money item 4 (REFUTE-W2-HEAVY H5): the shift's removal-loss read filtered inventory_movements by datetime(created_at) only, which no index can
// narrow, so every shift close read every removal the cashier ever made (33,514 rows on the lab seed). whereRemovalMovements now emits the same plain widened bounds
// as shiftWindowWhere beside the exact datetime() terms (-1 day below, +2 days above). Pinned here, modelled on test-shift-window-created-bounds-native.cjs:
//   - DIFFERENTIAL: readRemovalLossRows selects the same ids as the datetime()-only form over 300+ windows and created_at stored as date-only, space, ISO and +/-offset text;
//   - DISCRIMINATING: the "+1 day" upper bound and the "no -1 day" lower bound lose rows in the same windows (required reds);
//   - PLAN: the emitted statement SEARCHes inventory_movements by created_at (the datetime()-only form does not);
//   - WRITER CENSUS: every INSERT INTO inventory_movements site, because the bounds assume the stored text shapes.
// Run (from cloudflare/): node scripts/test-shift-removal-window-bounds-native.cjs
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
  Module._load = function patchedLoad(request, parent, isMain) { return request in requireOverrides ? requireOverrides[request] : originalLoad.call(this, request, parent, isMain) }
  const moduleObj = { exports: {} }
  try { new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath)) } finally { Module._load = originalLoad }
  return moduleObj.exports
}
const directory = path.join(__dirname, '../migrations')
const db = new DatabaseSync(':memory:')
for (const f of fs.readdirSync(directory).filter((n) => n.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(directory, f), 'utf8'))

let rewrite = (sql) => sql
const captured = []
const fakeDb = { getDb: () => ({ prepare: (sql) => ({ all: async (params) => { captured.push({ sql, params }); return db.prepare(rewrite(sql)).all(params) } }) }) }
const moneyPrecision = loadReal('lib/moneyPrecision.ts')
const reportMoneyPrecision = loadReal('lib/reportMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const promotionRules = loadReal('lib/promotionRules.ts', { './moneyPrecision': moneyPrecision })
const saleItemPricing = loadReal('lib/saleItemPricing.ts', { './moneyPrecision': moneyPrecision, './promotionRules': promotionRules })
const saleMoneyPrecision = loadReal('lib/saleMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const refundMoneyPrecision = loadReal('lib/refundMoneyPrecision.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const customerReturnEntitlement = loadReal('lib/customerReturnEntitlement.ts', { './moneyPrecision': moneyPrecision, './refundMoneyPrecision': refundMoneyPrecision, './saleItemPricing': saleItemPricing, './saleMoneyPrecision': saleMoneyPrecision })
const analytics = loadReal('lib/salesAnalytics.ts', {
  './saleStatusResolution': require('./harness/sale_status_resolution.cjs'), './schemaProbe': loadReal('lib/schemaProbe.ts'), './db': fakeDb,
  './removalLosses': loadReal('lib/removalLosses.ts'), './businessDateWindow': loadReal('lib/businessDateWindow.ts'), './reportMoneyPrecision': reportMoneyPrecision,
  './customerReturnEntitlement': customerReturnEntitlement, './refundMoneyPrecision': refundMoneyPrecision, './saleMoneyPrecision': saleMoneyPrecision,
})
let passed = 0
const check = async (name, run) => { await run(); passed += 1; console.log(`PASS ${name}`) }

const pad = (n, w = 2) => String(n).padStart(w, '0')
const shapes = [
  (d, h, m) => `${d} ${pad(h)}:${pad(m)}:00`, (d, h, m) => `${d}T${pad(h)}:${pad(m)}:00.000Z`, (d, h, m) => `${d}T${pad(h)}:${pad(m)}:00+07:00`,
  (d, h, m) => `${d}T${pad(h)}:${pad(m)}:00-05:00`, (d, h, m) => `${d}T${pad(h)}:${pad(m)}:00+14:00`, (d, h, m) => `${d}T${pad(h)}:${pad(m)}:00-12:00`,
  (d, h, m) => `${d}T${pad(h)}:${pad(m)}:00+05:30`, (d) => d, // date-only: the shape the 7 Oct production copy holds most
]
const day = (offset) => new Date(Date.UTC(2026, 10, 1 + offset)).toISOString().slice(0, 10)
const insert = db.prepare("INSERT INTO inventory_movements(product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, total_cost_usd, reason, user_id, created_at) VALUES (1,'P',1,'remove',1,1,1,'damaged',3,?)")
db.exec('BEGIN')
for (let o = 0; o < 14; o++) for (const h of [0, 1, 6, 11, 12, 13, 17, 18, 22, 23]) for (const shape of shapes) insert.run(shape(day(o), h, h === 23 ? 59 : 30))
db.exec('COMMIT')

const windows = []
for (let s = 0; s < 24; s++) {
  const start = Date.UTC(2026, 10, 2) + s * 3 * 3600 * 1000 + (s % 5) * 600000
  for (const hours of [0.5, 1, 4, 8, 13, 16, 23, 24, 30, 48, 72, 24 * 9]) windows.push({ createdFrom: new Date(start).toISOString(), createdTo: new Date(start + hours * 3600 * 1000).toISOString() })
}
for (let s = 0; s < 6; s++) { const at = new Date(Date.UTC(2026, 10, 4) + s * 5 * 3600 * 1000).toISOString(); windows.push({ createdFrom: at }, { createdTo: at }) }
assert.ok(windows.length >= 288)

const idsFor = async (w, transform = (sql) => sql) => { rewrite = transform; try { return (await analytics.readRemovalLossRows({}, { ...w, cashierId: 3 })).map((r) => r.id).sort((a, b) => a - b) } finally { rewrite = (sql) => sql } }
const exactOnly = (sql) => sql.replace(/ AND m\.created_at >= date\(@createdFrom, '-1 day'\)/, '').replace(/ AND m\.created_at < date\(@createdTo, '\+2 day'\)/, '')
const plusOne = (sql) => sql.replace("date(@createdTo, '+2 day')", "date(@createdTo, '+1 day')")
const noMinus = (sql) => sql.replace("date(@createdFrom, '-1 day')", 'date(@createdFrom)')
const lossIn = async (variant) => { let n = 0; for (const w of windows) if (JSON.stringify(await idsFor(w, variant)) !== JSON.stringify(await idsFor(w, exactOnly))) n += 1; return n }

;(async () => {
  await check('DIFFERENTIAL: the emitted statement selects exactly the datetime()-only rows in every window, over date-only, space, ISO and offset created_at', async () => {
    let nonEmpty = 0
    for (const w of windows) { const real = await idsFor(w); const exact = await idsFor(w, exactOnly); assert.deepEqual(real, exact, JSON.stringify(w)); if (exact.length) nonEmpty += 1 }
    assert.ok(nonEmpty > 200, `${nonEmpty} windows with rows`)
    const sql = captured[captured.length - 1].sql
    assert.ok(/m\.created_at >= date\(@createdFrom, '-1 day'\)/.test(sql) || /m\.created_at < date\(@createdTo, '\+2 day'\)/.test(sql), 'the plain bounds are emitted')
  })
  await check('DISCRIMINATING: "+1 day" above and "no -1 day" below each lose rows in many windows; the shipped statement loses none', async () => {
    const a = await lossIn(plusOne), b = await lossIn(noMinus), shipped = await lossIn((s) => s)
    assert.ok(a >= 50, `+1 day: ${a}`); assert.ok(b >= 20, `no -1 day: ${b}`); assert.equal(shipped, 0)
    console.log(`     +1 day: ${a} windows lose rows; no -1 day: ${b}; shipped: ${shipped}`)
  })
  await check('PLAN: the shift statement SEARCHes inventory_movements by created_at; the datetime()-only form does not', async () => {
    const w = { createdFrom: '2026-11-05T00:00:00.000Z', createdTo: '2026-11-06T00:00:00.000Z' }
    await analytics.readRemovalLossRows({}, { ...w, cashierId: 3 })
    const { sql, params } = captured[captured.length - 1]
    const plan = (text) => db.prepare(`EXPLAIN QUERY PLAN ${text}`).all(params).map((r) => r.detail).join(' | ')
    assert.match(plan(sql), /SEARCH m USING (COVERING )?INDEX idx_inventory_movements_\w+ \([^)]*created_at>\? AND created_at<\?\)/, plan(sql))
    assert.doesNotMatch(plan(exactOnly(sql)), /created_at>\?/, 'control: without the plain bounds no index narrows by created_at')
    await analytics.readRemovalLossRows({}, w)
    const shopWide = captured[captured.length - 1]
    assert.match(db.prepare(`EXPLAIN QUERY PLAN ${shopWide.sql}`).all(shopWide.params).map((r) => r.detail).join(' | '), /SEARCH m USING (COVERING )?INDEX idx_inventory_movements_\w+ \([^)]*created_at>\? AND created_at<\?\)/, 'a shop-wide shift too')
  })
  await check('WRITER CENSUS: the INSERT sites of inventory_movements are the reviewed ones (a new writer must be checked against the plain bounds)', async () => {
    const root = path.join(__dirname, '..', 'src'); const found = []
    const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, e.name); if (e.isDirectory()) walk(full); else if (full.endsWith('.ts')) { const m = fs.readFileSync(full, 'utf8').match(/INSERT( OR [A-Z]+)? INTO inventory_movements\b/g); if (m) found.push(`${path.relative(root, full).replace(/\\/g, '/')}:${m.length}`) } } }
    walk(root)
    const expected = fs.readFileSync(__filename, 'utf8').match(new RegExp('^// CENSUS=(.*)$', 'm'))[1].trim().split(',')
    assert.deepEqual(found.sort(), expected.sort(), `a writer of inventory_movements appeared or went: confirm its created_at is CURRENT_TIMESTAMP or an ISO string, then update the CENSUS line. Found: ${found.sort().join(',')}`)
  })
  console.log(`${passed} checks passed.`)
})().catch((e) => { console.error(e); process.exit(1) })
// CENSUS=lib/createFold.ts:1,lib/damagedLotActions.ts:1,lib/datedStockCountApply.ts:1,lib/importEngine.ts:3,lib/productDelete.ts:2,lib/productWrites.ts:1,lib/returnBulkAction.ts:2,lib/returnExchangeWrite.ts:1,lib/returnsStock.ts:3,lib/saleAmendments.ts:1,lib/saleBulkStatus.ts:2,lib/saleLineAddition.ts:2,lib/saleNotPaidStockRecovery.ts:1,lib/saleTransitions.ts:2,lib/salesImportCommit.ts:1,lib/sk2CleanserRepair.ts:3,lib/stockActionCommit.ts:2,lib/stockInLineEdit.ts:1,lib/stockLotAdjustment.ts:1,lib/stockRevert.ts:1,lib/stockSession.ts:2,lib/transferOperation.ts:1,routes/batches.ts:1,routes/inventory.ts:6,routes/products.ts:2,routes/returns.ts:5,routes/sales.ts:3
// Explicit created_at values in these writers: CURRENT_TIMESTAMP (the default), toISOString() (import dates, offset-free Z) and the dated count's `YYYY-MM-DD 00:00:00`: all inside the -1/+2 day prefix bounds.
