'use strict'
// Lane 6.0.997 slice S2: the shift drawer and the Reports "returns" block honour return_refund_corrections (migration 0275).
//
// A return row holds the CURRENT refund. Changing it on a later day must not move a shift that is already closed, so each
// correction is two signed adjustments: minus its difference in the period the return was made in, plus the same difference
// in the period it counts in (counts_at). The TELESCOPING INVARIANT: summed over every shift, the refund equals the drawer
// cash of the current return row, in each currency, for both modes ('today' and 'original_day'), for a cancel and a restore.
//
// This runs the REAL lib/shiftReconciliation.ts and lib/refundCorrectionReport.ts against a real SQLite database. Each
// scenario is a function over a loaded build, so the same scenarios run against the real build (all must pass) and against
// deliberately broken builds (each must fail), which is what makes the invariant discriminating:
//   mutant "positive side only" : the original period is never given its difference back, so a closed shift moves and the sum drifts;
//   mutant "by created_at"      : the difference is counted in the return's own period instead of counts_at, so the period that
//                                 made the change shows 0 and the closed period absorbs it;
//   mutant "after on both sides": the before columns are ignored, so the difference is the whole refund.
//
// Run (from cloudflare/): node scripts/test-shift-refund-corrections-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')

const root = path.join(__dirname, '..')
function load(file, overrides = {}, transform = (text) => text) {
  const filePath = path.join(root, 'src', file)
  const output = ts.transpileModule(transform(fs.readFileSync(filePath, 'utf8')), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const m = { exports: {} }
  new Function('require', 'module', 'exports', output)((name) => (name in overrides ? overrides[name] : require(name)), m, m.exports)
  return m.exports
}

let db = null
const SCHEMA = `
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE sales(id INTEGER PRIMARY KEY, created_at TEXT, sale_status TEXT, branch_id INTEGER, cashier_id INTEGER,
 payment_method TEXT, payment_details TEXT, amount_paid_usd REAL DEFAULT 0, amount_paid_khr REAL DEFAULT 0,
 change_usd REAL, change_khr REAL, change_is_actual INTEGER, change_exchange_rate REAL,
 total_usd REAL DEFAULT 0, exchange_rate REAL DEFAULT 4100,
 delivery_actual_cost_usd REAL, delivery_actual_cost_khr REAL, payments_version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sale_payment_events(id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER NOT NULL, direction TEXT NOT NULL, origin TEXT NOT NULL,
 payment_method TEXT NOT NULL, payment_details TEXT NOT NULL, amount_paid_usd REAL NOT NULL DEFAULT 0, amount_paid_khr REAL NOT NULL DEFAULT 0,
 change_usd REAL NOT NULL DEFAULT 0, change_khr REAL NOT NULL DEFAULT 0, change_is_actual INTEGER NOT NULL DEFAULT 0, change_exchange_rate REAL,
 exchange_rate REAL NOT NULL, drawer_effect INTEGER NOT NULL DEFAULT 1, received_at TEXT NOT NULL, branch_id INTEGER, cashier_id INTEGER);
CREATE INDEX idx_sale_payment_events_received ON sale_payment_events(received_at, branch_id);
CREATE TABLE sale_write_revisions(sale_id INTEGER PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE fees(id INTEGER PRIMARY KEY, created_at TEXT, branch_id INTEGER, sale_id INTEGER, fee_type TEXT,
 label TEXT, amount_usd REAL DEFAULT 0, amount_khr REAL DEFAULT 0, created_by INTEGER);
CREATE TABLE returns(id INTEGER PRIMARY KEY, created_at TEXT, branch_id INTEGER, cashier_id INTEGER,
 status TEXT DEFAULT 'completed', return_scope TEXT DEFAULT 'customer', reason TEXT,
 total_refund_usd REAL DEFAULT 0, total_refund_khr REAL DEFAULT 0, owed_reduction_usd REAL NOT NULL DEFAULT 0, refund_currency TEXT, exchange_rate REAL);
`
// The real table, from the migration, so the fixture cannot drift from the column names the readers use.
const MIGRATION_TABLE = fs.readFileSync(path.join(root, 'migrations/0275_return_refund_corrections.sql'), 'utf8')
  .match(/CREATE TABLE return_refund_corrections \([\s\S]*?\n\);/)[0]

const businessDateWindow = load('lib/businessDateWindow.ts')
const moneyPrecision = load('lib/moneyPrecision.ts')
const reportMoneyPrecision = load('lib/reportMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const promotionRules = load('lib/promotionRules.ts', { './moneyPrecision': moneyPrecision })
const saleItemPricing = load('lib/saleItemPricing.ts', { './moneyPrecision': moneyPrecision, './promotionRules': promotionRules })
const saleMoneyPrecision = load('lib/saleMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const refundMoneyPrecision = load('lib/refundMoneyPrecision.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const customerReturnEntitlement = load('lib/customerReturnEntitlement.ts', { './moneyPrecision': moneyPrecision, './refundMoneyPrecision': refundMoneyPrecision, './saleItemPricing': saleItemPricing, './saleMoneyPrecision': saleMoneyPrecision })
const analyticsPrecision = { './saleMoneyPrecision': saleMoneyPrecision, './reportMoneyPrecision': reportMoneyPrecision, './customerReturnEntitlement': customerReturnEntitlement, './refundMoneyPrecision': refundMoneyPrecision }
const saleTotals = load('lib/saleTotals.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const financialPrecision = load('lib/financialPrecision.ts')
const nativeSaleChange = load('lib/nativeSaleChange.ts', { './financialPrecision': financialPrecision, './saleTotals': saleTotals })
const salesAnalytics = load('lib/salesAnalytics.ts', { './db': { getDb: () => db }, './removalLosses': load('lib/removalLosses.ts'), './schemaProbe': load('lib/schemaProbe.ts'), './businessDateWindow': businessDateWindow, ...analyticsPrecision })
const registry = load('lib/paymentMethodRegistry.ts')

function loadBuild(transform) {
  const recon = load('lib/shiftReconciliation.ts', {
    './db': { getDb: () => db }, './nativeSaleChange': nativeSaleChange, './salesAnalytics': salesAnalytics, './paymentMethodRegistry': registry,
  }, transform)
  const report = load('lib/refundCorrectionReport.ts', { './shiftReconciliation': recon })
  return { recon, report }
}
const REAL = loadBuild()
const NOW = Date.parse('2026-11-30T00:00:00Z')

function adapter(sqlite) {
  return {
    prepare(query) {
      const bind = (params = {}) => {
        const values = []
        const text = query.replace(/@(\w+)/g, (_, key) => { values.push(params[key] ?? null); return '?' })
        return { stmt: sqlite.prepare(text), values }
      }
      return {
        get(params) { const b = bind(params); return b.stmt.get(...b.values) },
        all(params) { const b = bind(params); return b.stmt.all(...b.values) },
        run(params) { const b = bind(params); return b.stmt.run(...b.values) },
      }
    },
  }
}

// ---- fixture -----------------------------------------------------------------------------------------------------------
const shift = (open, close, user = 7, branch = 2, scope = 'per_account') => ({
  scope_mode: scope, user_id: user, branch_id: branch, opened_at: `${open.replace(' ', 'T')}.000Z`, closed_at: `${close.replace(' ', 'T')}.000Z`,
  opening_float_usd: 0, opening_float_khr: 0,
})
const A = (user, scope) => shift('2026-10-26 02:00:00', '2026-10-26 06:00:00', user, 2, scope)
const B = (user, scope) => shift('2026-10-27 02:00:00', '2026-10-27 06:00:00', user, 2, scope)
const C = (user, scope) => shift('2026-10-28 02:00:00', '2026-10-28 06:00:00', user, 2, scope)
const state = (usd, khr, owed = 0, cur = 'USD') => ({ usd, khr, owed, cur })

function fresh() {
  const sqlite = new Database(':memory:')
  sqlite.exec(SCHEMA)
  sqlite.exec(MIGRATION_TABLE)
  sqlite.exec('CREATE TABLE system_flags(key TEXT PRIMARY KEY, value TEXT)')
  sqlite.prepare("INSERT INTO settings VALUES('pos_payment_methods', ?)").run('["Cash","ABA"]')
  db = adapter(sqlite)
  let operation = 0
  return {
    sqlite,
    addReturn(id, createdAt, s, { cashier = 7, branch = 2, reason = 'damaged', scope = 'customer' } = {}) {
      sqlite.prepare(`INSERT INTO returns(id,created_at,branch_id,cashier_id,status,return_scope,total_refund_usd,total_refund_khr,owed_reduction_usd,refund_currency,reason)
        VALUES (?,?,?,?, 'completed', ?,?,?,?,?,?)`).run(id, createdAt, branch, cashier, scope, s.usd, s.khr, s.owed, s.cur, reason)
    },
    // The writer's whole job: append the correction AND rewrite the return row to the AFTER state.
    correct(id, { mode, countsAt, actor = 7, kind = 'edit', before, after, status = 'completed' }) {
      const row = sqlite.prepare('SELECT datetime(created_at) AS at, branch_id FROM returns WHERE id = ?').get(id)
      sqlite.prepare(`INSERT INTO return_refund_corrections(operation_id,return_id,branch_id,kind,mode,counts_at,
        before_total_refund_usd,before_total_refund_khr,before_owed_reduction_usd,before_refund_currency,
        after_total_refund_usd,after_total_refund_khr,after_owed_reduction_usd,after_refund_currency,actor_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(`op-${++operation}`, id, row.branch_id, kind, mode, mode === 'original_day' ? row.at : countsAt,
        before.usd, before.khr, before.owed, before.cur, after.usd, after.khr, after.owed, after.cur, actor)
      sqlite.prepare('UPDATE returns SET total_refund_usd = ?, total_refund_khr = ?, owed_reduction_usd = ?, refund_currency = ?, status = ? WHERE id = ?')
        .run(after.usd, after.khr, after.owed, after.cur, status, id)
    },
  }
}
// What the CURRENT return rows put in the drawer, valued by the real drawer functions.
function currentCash(world) {
  return world.sqlite.prepare(`SELECT COALESCE(SUM(${REAL.recon.refundDrawerUsdSql('returns')}), 0) AS usd, COALESCE(SUM(${REAL.recon.refundDrawerKhrSql('returns')}), 0) AS khr
    FROM returns WHERE status <> 'cancelled' AND COALESCE(return_scope, 'customer') = 'customer'`).get()
}
const refunds = (build, s) => build.recon.shiftRefunds({}, s, NOW)
const pair = (money) => [money.usd, money.khr]
async function summed(build, shifts) {
  let usd = 0; let khr = 0
  for (const s of shifts) { const r = await refunds(build, s); usd += r.usd; khr += r.khr }
  return { usd, khr }
}

// ---- scenarios: each takes a build and throws if the build is wrong ----------------------------------------------------
const TODAY = 'today: a later fix leaves the closed shift alone, lands in the shift that made it, and the sum is the current row'
const CHAIN = 'a chain of fixes in both modes and both currencies telescopes in each currency'
const CANCEL = 'a cancel counts today and a restore counts today; the sum follows the row'
const scenarios = {
  async [TODAY](build) {
    const w = fresh()
    w.addReturn(1, '2026-10-26 03:00:00', state(10, 41000))
    const closedBefore = pair(await refunds(build, A()))
    assert.deepEqual(closedBefore, [10, 0], 'control: shift A reads the refund before any correction')
    w.correct(1, { mode: 'today', countsAt: '2026-10-27 03:00:00', before: state(10, 41000), after: state(7, 28700) })
    assert.deepEqual(pair(await refunds(build, A())), closedBefore, 'closed shift A shows no change when the correction lands in shift B')
    assert.deepEqual(pair(await refunds(build, B())), [-3, 0], 'shift B carries exactly after minus before')
    assert.deepEqual(pair(await refunds(build, C())), [0, 0])
    assert.deepEqual(await summed(build, [A(), B(), C()]), currentCash(w), 'telescoping: summed over all shifts the refund equals the current row')
    w.sqlite.close()
  },
  async 'original_day: a typing mistake corrects the return\'s own day and leaves the later shifts alone'(build) {
    const w = fresh()
    w.addReturn(1, '2026-10-26 03:00:00', state(10, 41000))
    w.correct(1, { mode: 'original_day', before: state(10, 41000), after: state(7, 28700), actor: 8 })
    assert.deepEqual(pair(await refunds(build, A())), [7, 0], 'the original day now reads the corrected refund')
    assert.deepEqual(pair(await refunds(build, B())), [0, 0], 'no later shift absorbs it')
    assert.deepEqual(pair(await refunds(build, B(8))), [0, 0], 'not even the shift of the person who made the fix')
    assert.deepEqual(pair(await refunds(build, A(8))), [0, 0], 'the day belongs to the return\'s cashier, not the fixer')
    assert.deepEqual(await summed(build, [A(), B(), C()]), currentCash(w), 'telescoping')
    w.sqlite.close()
  },
  async [CHAIN](build) {
    const w = fresh()
    const s0 = state(10, 41000, 2, 'USD'); const s1 = state(10, 41000, 2, 'KHR'); const s2 = state(9, 36900, 0, 'KHR'); const s3 = state(4, 16400, 1, 'USD')
    w.addReturn(1, '2026-10-26 03:00:00', s0)
    w.correct(1, { mode: 'today', countsAt: '2026-10-27 03:00:00', before: s0, after: s1 })
    w.correct(1, { mode: 'original_day', before: s1, after: s2 })
    w.correct(1, { mode: 'today', countsAt: '2026-10-28 03:00:00', before: s2, after: s3 })
    const a = await refunds(build, A()); const b = await refunds(build, B()); const c = await refunds(build, C())
    assert.deepEqual(pair(a), [8, 4100], 'A: the original $8 cash, corrected by the original_day fix')
    assert.deepEqual(pair(b), [-8, 32800], 'B: dollars out, the riel cash share (41000 x 8 / 10) in')
    assert.deepEqual(pair(c), [3, -36900], 'C: back to dollars, riel out')
    assert.deepEqual({ usd: a.usd + b.usd + c.usd, khr: a.khr + b.khr + c.khr }, currentCash(w), 'telescoping in each currency')
    w.sqlite.close()
  },
  async [CANCEL](build) {
    const w = fresh()
    const full = state(10, 41000); const zero = state(0, 0, 0, null)
    w.addReturn(1, '2026-10-26 03:00:00', full)
    w.correct(1, { mode: 'today', kind: 'cancel', countsAt: '2026-10-27 03:00:00', before: full, after: zero, status: 'cancelled' })
    assert.deepEqual(pair(await refunds(build, A())), [10, 0], 'the day the return was made still reads its refund')
    assert.deepEqual(pair(await refunds(build, B())), [-10, 0], 'the cancel takes it back out today')
    assert.deepEqual(await summed(build, [A(), B(), C()]), currentCash(w), 'a cancelled return sums to nothing')
    assert.deepEqual(currentCash(w), { usd: 0, khr: 0 })
    w.correct(1, { mode: 'today', kind: 'restore', countsAt: '2026-10-28 03:00:00', before: zero, after: full })
    assert.deepEqual(pair(await refunds(build, A())), [10, 0])
    assert.deepEqual(pair(await refunds(build, B())), [-10, 0])
    assert.deepEqual(pair(await refunds(build, C())), [10, 0])
    assert.deepEqual(await summed(build, [A(), B(), C()]), currentCash(w))
    w.sqlite.close()
  },
  async 'scope: per-account shifts see their own cashier; shop-wide, other branches and supplier returns behave'(build) {
    const w = fresh()
    w.addReturn(1, '2026-10-26 03:00:00', state(10, 41000), { cashier: 7 })
    w.correct(1, { mode: 'today', countsAt: '2026-10-27 03:00:00', actor: 8, before: state(10, 41000), after: state(7, 28700) })
    assert.deepEqual(pair(await refunds(build, A(7))), [10, 0])
    assert.deepEqual(pair(await refunds(build, B(8))), [-3, 0], 'the fix is counted for the cashier who made it')
    assert.deepEqual(pair(await refunds(build, B(7))), [0, 0], 'not for the return\'s cashier')
    assert.deepEqual(pair(await refunds(build, B(9, 'shop_wide'))), [-3, 0], 'a shop-wide shift counts every cashier')
    assert.deepEqual(pair(await refunds(build, shift('2026-10-27 02:00:00', '2026-10-27 06:00:00', 8, 3))), [0, 0], 'another branch is untouched')
    w.addReturn(2, '2026-10-26 03:30:00', state(5, 20500), { scope: 'supplier' })
    w.correct(2, { mode: 'today', countsAt: '2026-10-27 03:30:00', actor: 8, before: state(5, 20500), after: state(1, 4100) })
    assert.deepEqual(pair(await refunds(build, B(8))), [-3, 0], 'a supplier return is not a customer refund, so neither is its fix')
    w.sqlite.close()
  },
  async 'the window is half-open: a fix at the closing second belongs to the next shift'(build) {
    const w = fresh()
    w.addReturn(1, '2026-10-26 03:00:00', state(10, 41000))
    w.correct(1, { mode: 'today', countsAt: '2026-10-27 06:00:00', before: state(10, 41000), after: state(6, 24600) })
    assert.deepEqual(pair(await refunds(build, B())), [0, 0])
    assert.deepEqual(pair(await refunds(build, shift('2026-10-27 06:00:00', '2026-10-27 10:00:00'))), [-4, 0])
    w.sqlite.close()
  },
  async 'the close-inputs digest moves for the window a correction lands in and stays put for an unrelated window'(build) {
    const w = fresh()
    w.addReturn(1, '2026-10-26 03:00:00', state(10, 41000))
    const read = (s) => build.recon.readShiftCloseInputsDigest({}, build.recon.shiftCloseInputsDigestSql(s, NOW))
    const other = () => shift('2026-11-05 02:00:00', '2026-11-05 06:00:00')
    const [bBefore, otherBefore] = [await read(B()), await read(other())]
    w.correct(1, { mode: 'today', countsAt: '2026-10-27 03:00:00', before: state(10, 41000), after: state(7, 28700) })
    assert.notEqual(await read(B()), bBefore, 'a close that read its inputs before the fix aborts and retries')
    assert.equal(await read(other()), otherBefore, 'a window the fix does not touch keeps its digest')
    w.sqlite.close()
  },
  async 'reports: every figure of the returns block moves the same way and the periods add up to the current rows'(build) {
    const w = fresh()
    w.addReturn(1, '2026-10-26 03:00:00', state(10, 41000, 2, 'USD'), { reason: 'damaged' })
    w.addReturn(2, '2026-10-27 03:00:00', state(5, 20500), { reason: 'wrong item' })
    w.correct(1, { mode: 'today', countsAt: '2026-10-27 04:00:00', before: state(10, 41000, 2, 'USD'), after: state(7, 28700, 1, 'USD') })
    const money = `COUNT(*) AS count, COALESCE(SUM(total_refund_usd), 0) AS refund_usd, COALESCE(SUM(total_refund_khr), 0) AS refund_khr, COALESCE(SUM(owed_reduction_usd), 0) AS owed_reduction_usd,
      COALESCE(SUM(${REAL.recon.refundDrawerUsdSql('returns')}), 0) AS cash_refund_usd, COALESCE(SUM(${REAL.recon.refundDrawerKhrSql('returns')}), 0) AS cash_refund_khr`
    const window = (alias) => `datetime(${alias}.created_at) >= @createdFrom AND datetime(${alias}.created_at) < @createdTo`
    const named = (text, from, to) => ({ text: text.replace(/@createdFrom/g, `'${from}'`).replace(/@createdTo/g, `'${to}'`) })
    const period = (from, to) => {
      const base = w.sqlite.prepare(named(`SELECT ${money} FROM returns WHERE status <> 'cancelled' AND ${window('returns')}`, from, to).text).get()
      const byReason = w.sqlite.prepare(named(`SELECT COALESCE(NULLIF(TRIM(reason), ''), '') AS reason, ${money} FROM returns WHERE status <> 'cancelled' AND ${window('returns')} GROUP BY 1`, from, to).text).all()
      const adjTotals = w.sqlite.prepare(named(build.report.refundCorrectionTotalsSql(window('x')), from, to).text).get()
      const adjReasons = w.sqlite.prepare(named(build.report.refundCorrectionByReasonSql(window('x')), from, to).text).all()
      return { totals: build.report.applyRefundCorrections(base, adjTotals), reasons: build.report.mergeReasonAdjustments(byReason, adjReasons) }
    }
    const p1 = period('2026-10-26 00:00:00', '2026-10-27 00:00:00'); const p2 = period('2026-10-27 00:00:00', '2026-10-28 00:00:00')
    assert.equal(p1.totals.count, 1); assert.equal(p2.totals.count, 1, 'a correction never adds or removes a return')
    assert.deepEqual([p1.totals.refund_usd, p1.totals.refund_khr, p1.totals.owed_reduction_usd, p1.totals.cash_refund_usd], [10, 41000, 2, 8], 'the day of the return reads what it paid')
    assert.deepEqual([p2.totals.refund_usd, p2.totals.refund_khr, p2.totals.owed_reduction_usd, p2.totals.cash_refund_usd], [2, 8200, -1, 3], 'the day of the fix carries the difference in every figure')
    const sum = (key) => Math.round((p1.totals[key] + p2.totals[key]) * 100) / 100
    assert.deepEqual([sum('refund_usd'), sum('refund_khr'), sum('owed_reduction_usd')], [12, 49200, 1], 'the periods add up to the current rows')
    assert.deepEqual({ usd: sum('cash_refund_usd'), khr: sum('cash_refund_khr') }, currentCash(w), 'and to the current drawer cash')
    const reasons = Object.fromEntries(p2.reasons.map((row) => [row.reason, row]))
    assert.equal(reasons.damaged.count, 0, 'the fixed return\'s reason appears in the fix period with no returns of its own')
    assert.equal(reasons.damaged.refund_usd, -3)
    assert.equal(reasons['wrong item'].count, 1)
    assert.equal(Math.round(p2.reasons.reduce((n, row) => n + row.cash_refund_usd, 0) * 100) / 100, p2.totals.cash_refund_usd, 'by-reason rows add up to the totals')
    w.sqlite.close()
  },
}

let passed = 0
async function main() {
  for (const [name, run] of Object.entries(scenarios)) { await run(REAL); passed++; console.log(`PASS ${name}`) }

  // The reports route and the shift readers must use these libraries, so they cannot drift to a private reading.
  const reports = fs.readFileSync(path.join(root, 'src/routes/reports.ts'), 'utf8')
  for (const word of ['refundCorrectionTotalsSql', 'refundCorrectionByReasonSql', 'applyRefundCorrections', 'mergeReasonAdjustments']) assert.ok(reports.includes(word), `routes/reports.ts uses ${word}`)
  const recon = fs.readFileSync(path.join(root, 'src/lib/shiftReconciliation.ts'), 'utf8')
  assert.ok((recon.match(/refundCorrectionsSql\(\)/g) || []).length >= 4, 'shiftRefunds (twice), the digest and the report helper read the one derived table')
  passed++; console.log('PASS the Reports route and the shift digest read the shared derived table')

  // Mutants: every deliberately wrong build must fail the scenarios that pin its mistake.
  const mutants = {
    'counts only the positive side (the original period is never given its difference back)': {
      transform: (text) => text.replace('return `(${side(true)} UNION ALL ${side(false)})`', 'return `(${side(true)})`'),
      mustFail: [TODAY, CHAIN],
    },
    'counts by created_at instead of counts_at': {
      transform: (text) => text.replace("counted ? 'c.counts_at AS created_at' : 'r.created_at AS created_at'", "'r.created_at AS created_at'"),
      mustFail: [TODAY, CANCEL],
    },
    'values both sides with the after columns (before is ignored)': {
      transform: (text) => text.replace("refundDrawerUsdSql('c', 'before_')", "refundDrawerUsdSql('c', 'after_')").replace("refundDrawerKhrSql('c', 'before_')", "refundDrawerKhrSql('c', 'after_')"),
      mustFail: [TODAY],
    },
  }
  const source = fs.readFileSync(path.join(root, 'src/lib/shiftReconciliation.ts'), 'utf8')
  for (const [label, mutant] of Object.entries(mutants)) {
    assert.notEqual(mutant.transform(source), source, `mutant "${label}" really changes the source`)
    const build = loadBuild(mutant.transform)
    for (const name of mutant.mustFail) {
      await assert.rejects(() => scenarios[name](build), undefined, `mutant "${label}" must fail: ${name}`)
    }
    passed++; console.log(`PASS mutant killed: ${label}`)
  }
  console.log(`\n${passed} checks passed`)
}
main().catch((error) => { console.error(error); process.exit(1) })
