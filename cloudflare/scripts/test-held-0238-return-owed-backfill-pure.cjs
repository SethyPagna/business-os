// RET-A Q1 (owner ruling 6 Oct 2026, relayed by the lead): returns recorded on
// a Not Paid sale BEFORE 0234 are rewritten to the model 0234's code uses --
// the refund first lowers what the customer owes, no cash leaves the drawer
// for that part, and a sale that still owes is back in Not Paid.
//
// Companion for ops/scripts/migration/held/0238_return_owed_backfill.sql and
// the two sizing queries ops/queries/ret-a-notpaid-returns-backfill-sizing*.sql.
// Real migrated SQLite (node:sqlite via harness/d1compat.cjs, the full chain),
// the TypeScript kernels bundled by esbuild as the oracle:
//   1. Text: LF-only, held (not in the deploy chain), the plan byte-identical
//      in the migration and both sizing files, both sizing files pass the ops
//      read-only guard.
//   2. Owner example: $10 Not Paid, $4 returned -> owes $6, back in Not Paid,
//      the shift drawer pays out $0 (expected cash rises by $4), revenue
//      inputs unchanged.
//   3. Order and tender: two returns on a part-paid sale split debt then cash;
//      a riel payment counts at the sale's rate; a fully cleared debt keeps
//      the return status.
//   4. Refusals and exclusions write nothing: unreadable money, a row the
//      money-precision triggers would abort on, a negative refund, a cancelled
//      sale, a cancelled return, a Completed sale, a supplier return. A return
//      written by 0234's code caps the replay.
//   5. Double apply writes nothing; the header's recovery restores every
//      rewritten column of a sale nobody wrote since (sale revision snapshot)
//      and leaves a later-settled, -edited or -returned sale exactly as it is.
//   6. Sizing: the pre-0234 file's counts equal what the migration writes.
//   7. Fuzz: 400 random sales against splitReturnRefund / saleStatusWithReturns.
//
// Run (from cloudflare/): node scripts/test-held-0238-return-owed-backfill-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { buildSync } = require('esbuild')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.resolve(__dirname, '..', '..')
const heldPath = path.join(root, 'ops/scripts/migration/held/0238_return_owed_backfill.sql')
const sizingPrePath = path.join(root, 'ops/queries/ret-a-notpaid-returns-backfill-sizing.sql')
const sizingLivePath = path.join(root, 'ops/queries/ret-a-notpaid-returns-backfill-sizing-live.sql')
const rawText = (file) => fs.readFileSync(file, 'utf8')
const migrationText = rawText(heldPath)

function load(entry) {
  const output = buildSync({ stdin: { contents: `export * from './${entry}'`, resolveDir: path.join(__dirname, '../src/lib'), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' }).outputFiles[0].text
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', output)(moduleObj.exports, require, moduleObj)
  return moduleObj.exports
}
const split = load('returnRefundSplit')
const resolution = load('saleStatusResolution')
const { REFUND_DRAWER_USD_SQL } = load('shiftReconciliation')

let checks = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); checks++; console.log(`PASS ${name}`) }
  catch (error) { failed++; console.log(`FAIL ${name}\n${error.stack}`); process.exitCode = 1 }
}

// ---- fixture world -----------------------------------------------------------
function world() {
  const raw = openDb(loadAll()).db
  raw.prepare("INSERT INTO branches(id, name, is_active) VALUES (1, 'Shop', 1)").run()
  raw.prepare("INSERT INTO branches(id, name, is_active) VALUES (2, 'Warehouse', 1)").run()
  let returnSeq = 0
  const sale = (id, { total, paidUsd = 0, paidKhr = 0, rate = 4000, status = 'awaiting_payment', before = null, branch = 1 }) => {
    raw.prepare(`INSERT INTO sales(id, receipt_number, branch_id, total_usd, subtotal_usd, amount_paid_usd, amount_paid_khr,
      exchange_rate, sale_status, status_before_return, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-09-20 03:00:00')`)
      .run(id, `S-${id}`, branch, total, total, paidUsd, paidKhr, rate, status, before)
    return id
  }
  const ret = (saleId, refund, { status = 'completed', scope = 'customer', at = '2026-09-20 05:00:00', cashier = 7, branch = 1,
    currency = null, lowered = 0, id = null } = {}) => {
    const rid = id ?? 1000 + (++returnSeq)
    raw.prepare(`INSERT INTO returns(id, return_number, sale_id, branch_id, cashier_id, return_scope, reason, total_refund_usd,
      total_refund_khr, exchange_rate, status, created_at, refund_currency, owed_reduction_usd)
      VALUES (?, ?, ?, ?, ?, ?, 'fixture', ?, 0, 4000, ?, ?, ?, ?)`)
      .run(rid, `RET-${rid}`, saleId, branch, cashier, scope, refund, status, at, currency, lowered)
    return rid
  }
  const shift = (id, { opened, closed = null, cancelled = null, user = 7, branch = 1, scope = 'per_account' }) => {
    raw.prepare(`INSERT INTO shift_sessions(id, shift_code, user_id, branch_id, business_date, opened_at, closed_at, cancelled_at, scope_mode,
      cancelled_by_user_id, cancelled_by_user_name, cancel_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, `SH-${id}`, user, branch, opened.slice(0, 10), opened, closed, cancelled, scope,
      cancelled ? 1 : null, cancelled ? 'admin' : null, cancelled ? 'fixture' : null)
  }
  return { raw, sale, ret, shift }
}

const apply = (raw) => raw.exec(migrationText)
const returnRow = (raw, id) => raw.prepare('SELECT owed_reduction_usd AS owed, refund_currency AS currency FROM returns WHERE id = ?').get(id)
const saleStatus = (raw, id) => raw.prepare('SELECT sale_status FROM sales WHERE id = ?').get(id).sale_status
// What the app shows a sale still owes: the kernel over the row plus its active
// returns' debt reductions (returnOwedReductionSql, the list's own column).
const owes = (raw, id) => resolution.recordedSaleOutstandingUsd(raw.prepare(`SELECT s.*, ${split.returnOwedReductionSql('s')} FROM sales s WHERE s.id = ?`).get(id))
// What a shift drawer subtracts for refunds (shiftRefunds' own expression and filters).
const drawerRefunds = (raw, from, to) => Number(raw.prepare(`SELECT COALESCE(SUM(${REFUND_DRAWER_USD_SQL}), 0) AS usd FROM returns
  WHERE datetime(returns.created_at) >= datetime(@from) AND datetime(returns.created_at) < datetime(@to)
    AND COALESCE(returns.status, 'completed') <> 'cancelled' AND COALESCE(returns.return_scope, 'customer') = 'customer'
    AND NOT EXISTS (SELECT 1 FROM sales refund_sale WHERE refund_sale.id = returns.sale_id
      AND COALESCE(NULLIF(refund_sale.sale_status, ''), 'completed') = 'cancelled')`).get({ from, to }).usd)
const snapshot = (raw) => JSON.stringify({
  returns: raw.prepare('SELECT id, owed_reduction_usd, refund_currency, total_refund_usd, status FROM returns ORDER BY id').all(),
  sales: raw.prepare('SELECT id, sale_status, status_before_return, total_usd, amount_paid_usd, amount_paid_khr FROM sales ORDER BY id').all(),
})
const backupRows = (raw) => raw.prepare('SELECT return_id, sale_id, refund_usd, owed_reduction_usd, prior_sale_status, new_sale_status FROM return_owed_backfill_0238 ORDER BY return_id').all()

async function guard() { return import(pathToFileURL(path.join(root, 'ops/scripts/ops-sql-guard.mjs')).href) }

async function main() {
  const opsGuard = await guard()
  const sizing = (raw, name) => raw.prepare(opsGuard.loadQuery(name).sql).get()

  await check('text: LF-only, held outside the chain, one plan in all three files, sizing passes the read-only guard', () => {
    assert.ok(!/\r/.test(migrationText), 'the held migration is LF-only')
    const chain = fs.readdirSync(path.join(__dirname, '../migrations'))
    assert.ok(!chain.some((f) => f.startsWith('0238_')), '0238 is held, not in the deploy chain')
    const planOf = (text) => {
      const m = /-- plan:begin\n([\s\S]*?)\n-- plan:end\n/.exec(text.replace(/\r\n/g, '\n'))
      assert.ok(m, 'plan markers present')
      return m[1]
    }
    const plan = planOf(migrationText)
    assert.equal(planOf(rawText(sizingPrePath)), plan, 'pre-0234 sizing carries the migration plan byte for byte')
    assert.equal(planOf(rawText(sizingLivePath)), plan, 'live sizing carries the migration plan byte for byte')
    const srcOf = (text) => /src_returns AS \([\s\S]*?\n\),\n/.exec(text.replace(/\r\n/g, '\n'))[0]
    assert.equal(srcOf(rawText(sizingLivePath)), srcOf(migrationText), 'live sizing reads the returns exactly as the migration does')
    assert.equal(srcOf(rawText(sizingPrePath)), srcOf(migrationText)
      .replace('r.refund_currency, r.owed_reduction_usd,', 'NULL AS refund_currency, 0 AS owed_reduction_usd,'), 'pre-0234 sizing differs only in reading the new columns as NULL/0')
    assert.deepEqual(opsGuard.loadQuery('ret-a-notpaid-returns-backfill-sizing').rules, { minRows: 1, maxRows: 1, expectZero: ['has_0234_columns'] })
    assert.deepEqual(opsGuard.loadQuery('ret-a-notpaid-returns-backfill-sizing-live').rules, { minRows: 1, maxRows: 1, expectZero: ['missing_0234_columns'] })
    assert.ok(!/shift_close_figures|customer_receivables\s+SET|INSERT INTO (sales|returns|sale_items|return_items)\b/i.test(migrationText.split('\nCREATE TABLE')[1]),
      'the statements write neither shift_close_figures nor receivables nor any line table')
  })

  await check('owner example: $10 Not Paid, $4 returned -> owes $6, back in Not Paid, the drawer pays out nothing; double apply is a no-op', () => {
    const { raw, sale, ret, shift } = world()
    shift(1, { opened: '2026-09-20 01:00:00', closed: '2026-09-20 11:00:00' })
    sale(1, { total: 10, status: 'partial_return', before: 'awaiting_payment' })
    const r = ret(1, 4)
    assert.equal(drawerRefunds(raw, '2026-09-20 01:00:00', '2026-09-20 11:00:00'), 4, 'before: $4 cash out of the closed shift drawer')
    assert.equal(owes(raw, 1), 10, 'before: the sale reads $10 owed and sits outside Not Paid')
    apply(raw)
    assert.deepEqual({ ...returnRow(raw, r) }, { owed: 4, currency: 'USD' })
    assert.equal(saleStatus(raw, 1), 'awaiting_payment', 'back in the Not Paid list')
    assert.equal(owes(raw, 1), 6, 'Not Paid owes $6')
    assert.equal(drawerRefunds(raw, '2026-09-20 01:00:00', '2026-09-20 11:00:00'), 0, 'the drawer pays out nothing: expected cash rises by the $4 refund')
    const totals = raw.prepare('SELECT total_usd, (SELECT SUM(total_refund_usd) FROM returns WHERE sale_id = 1) AS refunded FROM sales WHERE id = 1').get()
    assert.equal(totals.total_usd - totals.refunded, 6, 'revenue inputs are untouched: $10 sold - $4 returned = $6')
    const once = snapshot(raw)
    const backup = backupRows(raw)
    const revision = raw.prepare('SELECT revision FROM sale_write_revisions WHERE sale_id = 1').get().revision
    apply(raw)
    assert.equal(snapshot(raw), once, 'second apply changes no return or sale')
    assert.deepEqual(backupRows(raw), backup, 'second apply records nothing new')
    assert.equal(raw.prepare('SELECT revision FROM sale_write_revisions WHERE sale_id = 1').get().revision, revision, 'second apply does not even touch the sale row')
  })

  await check('order and tender: debt first then cash in id order, riel payment at the sale rate, cleared debt keeps the return status', () => {
    const { raw, sale, ret } = world()
    // $20, $5 paid: owes $15. Two $10 returns: $10 lowers the debt, then $5 more and $5 cash.
    sale(2, { total: 20, paidUsd: 5, status: 'returned', before: 'awaiting_payment' })
    const a = ret(2, 10); const b = ret(2, 10)
    // $30, paid 82,000 riel at 4,100 = $20: owes $10. A $12 return lowers it by $10; $2 is cash.
    sale(3, { total: 30, paidKhr: 82000, rate: 4100, status: 'partial_return', before: 'awaiting_payment' })
    const c = ret(3, 12)
    // $10, paid 39,980 riel at 4,000 = $9.995: short by exactly half a cent, which the
    // coverage rule calls paid. A $1 return is all cash and the status stays.
    sale(5, { total: 10, paidKhr: 39980, rate: 4000, status: 'partial_return', before: 'awaiting_payment' })
    const e = ret(5, 1)
    // Still Not Paid ($8 owed, $3 returned): status already right, only the money moves.
    sale(4, { total: 8, status: 'awaiting_payment' })
    const d = ret(4, 3)
    apply(raw)
    assert.deepEqual([returnRow(raw, a).owed, returnRow(raw, b).owed], [10, 5], 'the earlier return lowers the debt first')
    assert.equal(saleStatus(raw, 2), 'returned', 'debt cleared: the quantity status stands')
    assert.equal(owes(raw, 2), 0)
    assert.equal(returnRow(raw, c).owed, 10, 'riel tender counted at the sale\'s own rate: only the $10 still owed is lowered')
    assert.equal(owes(raw, 3), 0)
    assert.equal(saleStatus(raw, 3), 'partial_return')
    assert.equal(returnRow(raw, e).owed, 0, 'half a cent short is paid (saleOutstandingUsd tolerance): nothing to lower')
    assert.equal(saleStatus(raw, 5), 'partial_return')
    assert.equal(returnRow(raw, d).owed, 3)
    assert.equal(saleStatus(raw, 4), 'awaiting_payment')
    assert.equal(owes(raw, 4), 5)
  })

  await check('refusals and exclusions write nothing; a 0234-era return caps the replay; sizing names each', () => {
    const { raw, sale, ret } = world()
    sale(10, { total: 10, status: 'partial_return', before: 'awaiting_payment' }); const ok = ret(10, 4)
    sale(11, { total: 10, status: 'partial_return', before: 'awaiting_payment' }); const neg = ret(11, -2); const negSibling = ret(11, 3)
    sale(12, { total: 10, status: 'partial_return', before: 'awaiting_payment' }); const unreadable = ret(12, 4)
    raw.prepare('UPDATE sales SET exchange_rate = 0 WHERE id = 12').run()
    sale(13, { total: 10, status: 'partial_return', before: 'awaiting_payment' }); const locked = ret(13, 4)
    // A legacy row the 0161 trigger would refuse: v0 with a stray rounding adjustment (written before the trigger).
    raw.exec("DROP TRIGGER sales_money_precision_update_0161; UPDATE sales SET rounding_adjustment_usd = 0.003 WHERE id = 13;")
    raw.exec(rawText(path.join(__dirname, '../migrations/0161_sale_edited_legacy_money_precision.sql')).split('DROP TRIGGER sales_money_precision_update;')[1])
    sale(14, { total: 10, status: 'cancelled' }); const onCancelled = ret(14, 4)
    sale(15, { total: 10, status: 'partial_return', before: 'awaiting_payment' }); const cancelledReturn = ret(15, 4, { status: 'cancelled' })
    sale(16, { total: 10, paidUsd: 10, status: 'partial_return', before: 'completed' }); const completed = ret(16, 4)
    sale(17, { total: 10, status: 'partial_return', before: 'awaiting_payment' }); const supplier = ret(17, 4, { scope: 'supplier' })
    // Mixed: a 0234-era return already lowered $7 of the $10; the older one may only take the remaining $3.
    sale(18, { total: 10, status: 'awaiting_payment' }); const older = ret(18, 5, { id: 1800 }); ret(18, 7, { id: 1801, currency: 'USD', lowered: 7 })
    const before = snapshot(raw)
    const pre = sizing(raw, 'ret-a-notpaid-returns-backfill-sizing-live')
    apply(raw)
    assert.equal(returnRow(raw, ok).owed, 4, 'control: the clean sale is rewritten')
    for (const [id, why] of [[neg, 'negative refund'], [negSibling, 'sibling of a negative refund (whole sale refused)'], [unreadable, 'zero rate'],
      [locked, 'row the money trigger aborts on'], [onCancelled, 'cancelled sale'], [cancelledReturn, 'cancelled return'],
      [completed, 'Completed sale'], [supplier, 'supplier return']]) {
      assert.deepEqual({ ...returnRow(raw, id) }, { owed: 0, currency: null }, `${why}: untouched`)
    }
    for (const id of [11, 12, 13, 14, 15, 16, 17]) {
      assert.equal(saleStatus(raw, id), JSON.parse(before).sales.find((row) => row.id === id).sale_status, `sale ${id} status untouched`)
    }
    assert.equal(returnRow(raw, older).owed, 3, 'the 0234-era reduction counts first: debt lowered never exceeds the debt')
    assert.equal(owes(raw, 18), 0)
    assert.deepEqual({
      refused_sales_money_unreadable: pre.refused_sales_money_unreadable, refused_sales_row_locked: pre.refused_sales_row_locked,
      refused_sales_refund_not_positive: pre.refused_sales_refund_not_positive, refused_returns: pre.refused_returns,
      cancelled_returns_left: pre.cancelled_returns_left, mixed_sales: pre.mixed_sales, backfill_returns: pre.backfill_returns,
    }, { refused_sales_money_unreadable: 1, refused_sales_row_locked: 1, refused_sales_refund_not_positive: 1, refused_returns: 4,
      cancelled_returns_left: 1, mixed_sales: 1, backfill_returns: 2 })
  })

  await check('recovery: restores every column of a sale nobody touched since; a sale settled, edited or returned against later is left exactly as it is', () => {
    const { raw, sale, ret } = world()
    // 1: untouched since -> restored. 5: Not Paid cleared to Partial return, untouched -> restored.
    sale(1, { total: 10, status: 'partial_return', before: 'awaiting_payment' }); ret(1, 4)
    sale(5, { total: 10, status: 'awaiting_payment' }); ret(5, 10)
    // 2: one of its returns edited later. 3: settled later. 4: a new return later.
    sale(2, { total: 20, paidUsd: 5, status: 'returned', before: 'awaiting_payment' }); ret(2, 10); const edited = ret(2, 10)
    sale(3, { total: 10, status: 'partial_return', before: 'awaiting_payment' }); ret(3, 4)
    sale(4, { total: 10, status: 'partial_return', before: 'awaiting_payment' }); ret(4, 4)
    const before = snapshot(raw)
    apply(raw)
    assert.equal(saleStatus(raw, 5), 'partial_return', 'control: sale 5 left Not Paid')
    const revisions = raw.prepare('SELECT COUNT(*) AS n FROM return_owed_backfill_0238 WHERE sale_revision IS NULL').get().n
    assert.equal(revisions, 0, 'the last statement records every backed-up sale\'s revision')
    raw.prepare('UPDATE returns SET owed_reduction_usd = 2 WHERE id = ?').run(edited)
    raw.prepare('UPDATE sales SET amount_paid_usd = 6 WHERE id = 3').run()
    ret(4, 1, { currency: 'USD', lowered: 1 })
    const afterBackfillAndLater = JSON.parse(snapshot(raw))
    const recovery = migrationText.split('\n-- Statements:\n')[1].split('\n-- End of recovery.')[0]
      .split('\n').map((line) => line.replace(/^--\s{3}/, '')).join('\n')
    raw.exec(recovery)
    const after = JSON.parse(snapshot(raw)); const original = JSON.parse(before)
    const pick = (world, saleId) => ({ sale: world.sales.find((row) => row.id === saleId),
      returns: world.returns.filter((row) => raw.prepare('SELECT sale_id FROM returns WHERE id = ?').get(row.id).sale_id === saleId) })
    for (const id of [1, 5]) assert.deepEqual(pick(after, id), pick(original, id), `sale ${id}: every rewritten column is back, status_before_return too`)
    for (const id of [2, 3, 4]) assert.deepEqual(pick(after, id), pick(afterBackfillAndLater, id), `sale ${id}: written after the backfill, so recovery leaves it exactly as it is`)
    assert.deepEqual(raw.prepare('SELECT sale_id FROM return_owed_backfill_0238 WHERE recover_ok = 0 GROUP BY sale_id ORDER BY sale_id').all().map((row) => row.sale_id), [2, 3, 4],
      'the backup names the sales left for review')
    const once = snapshot(raw)
    raw.exec(recovery)
    assert.equal(snapshot(raw), once, 'a second recovery run changes nothing')
  })

  await check('sizing: the pre-0234 file counts exactly what the migration then writes, the live file agrees, then reads zero', () => {
    const { raw, sale, ret, shift } = world()
    shift(1, { opened: '2026-09-20 01:00:00', closed: '2026-09-20 11:00:00' })
    shift(2, { opened: '2026-09-21 01:00:00' })
    shift(3, { opened: '2026-09-22 01:00:00', cancelled: '2026-09-22 09:00:00', scope: 'shop_wide', user: 99 })
    shift(4, { opened: '2026-09-20 01:00:00', closed: '2026-09-20 11:00:00', branch: 2 })
    sale(1, { total: 10, status: 'partial_return', before: 'awaiting_payment' }); ret(1, 4)
    sale(2, { total: 20, paidUsd: 5, status: 'returned', before: 'awaiting_payment' }); ret(2, 10, { at: '2026-09-21 05:00:00' }); ret(2, 10, { at: '2026-09-21 06:00:00' })
    sale(3, { total: 8, paidUsd: 8, status: 'awaiting_payment' }); ret(3, 3, { at: '2026-09-22 05:00:00' })
    sale(4, { total: 10, status: 'partial_return', before: 'awaiting_payment' }); ret(4, 4, { at: '2026-09-22 05:00:00', cashier: 8 })
    const pre = sizing(raw, 'ret-a-notpaid-returns-backfill-sizing')
    const live = sizing(raw, 'ret-a-notpaid-returns-backfill-sizing-live')
    assert.equal(pre.has_0234_columns, 1, 'this fixture has 0234 (production today does not; the expect-zero stops a stale run)')
    assert.equal(live.missing_0234_columns, 0)
    const common = (row) => { const { has_0234_columns, missing_0234_columns, ...rest } = row; void has_0234_columns; void missing_0234_columns; return rest }
    assert.deepEqual(common(pre), common(live), 'with no 0234-era return both files read the same numbers')
    apply(raw)
    const backup = backupRows(raw)
    assert.equal(pre.backfill_returns, backup.length)
    assert.equal(pre.backfill_sales, new Set(backup.map((row) => row.sale_id)).size)
    assert.equal(pre.moves_to_debt_usd, Math.round(backup.reduce((sum, row) => sum + row.owed_reduction_usd, 0) * 10000) / 10000)
    assert.equal(pre.sales_to_not_paid, new Set(backup.filter((row) => row.new_sale_status === 'awaiting_payment' && row.prior_sale_status !== 'awaiting_payment').map((row) => row.sale_id)).size)
    assert.equal(pre.not_paid_cleared_sales, new Set(backup.filter((row) => row.prior_sale_status === 'awaiting_payment' && row.new_sale_status !== 'awaiting_payment').map((row) => row.sale_id)).size)
    assert.deepEqual({
      refund_usd_counted_as_cash: pre.refund_usd_counted_as_cash, moves_to_debt_usd: pre.moves_to_debt_usd, stays_cash_usd: pre.stays_cash_usd,
      returns_with_reduction: pre.returns_with_reduction, sales_to_not_paid: pre.sales_to_not_paid, not_paid_cleared_sales: pre.not_paid_cleared_sales,
      shifts_open: pre.shifts_open, shifts_closed: pre.shifts_closed, shifts_cancelled: pre.shifts_cancelled,
      first_return_date: pre.first_return_date, last_return_date: pre.last_return_date,
    }, {
      // $4 + $10 + $10 + $3 + $4 were all counted as drawer cash; $4 + $10 + $5 + $4 move to the debt.
      refund_usd_counted_as_cash: 31, moves_to_debt_usd: 23, stays_cash_usd: 8, returns_with_reduction: 4, sales_to_not_paid: 2,
      // Sale 3 is Not Paid but fully paid already: its $3 return stays cash and the status is left alone.
      not_paid_cleared_sales: 1,
      // Shift 1 (closed, cashier 7) holds sale 1's return; shift 2 (open) holds sale 2's; shift 3 (cancelled,
      // shop-wide) holds sale 4's from cashier 8. Shift 4 is another branch and sale 3's return moves nothing.
      shifts_open: 1, shifts_closed: 1, shifts_cancelled: 1, first_return_date: '2026-09-20', last_return_date: '2026-09-22' })
    const afterLive = sizing(raw, 'ret-a-notpaid-returns-backfill-sizing-live')
    assert.equal(afterLive.backfill_returns, 0, 'after the backfill nothing is pending')
    assert.equal(afterLive.refused_returns, live.refused_returns)
  })

  await check('fuzz: 400 random debt sales match splitReturnRefund and saleStatusWithReturns exactly', () => {
    const { raw, sale, ret } = world()
    let seed = 20261006
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    const pick = (list) => list[Math.floor(rand() * list.length)]
    const cases = []
    for (let id = 100; id < 500; id++) {
      const total = Math.round((5 + rand() * 300) * 100) / 100
      const rate = pick([4000, 4100, 4050])
      const tender = pick(['none', 'usd', 'khr', 'both'])
      const paidUsd = tender === 'usd' || tender === 'both' ? Math.round(rand() * total * 100) / 100 : 0
      const paidKhr = tender === 'khr' || tender === 'both' ? Math.round(rand() * (total - paidUsd) * rate / 100) * 100 : 0
      // The quantity status is computed HERE from the lines, independently of the
      // sale's current status (verifier: passing the current status in as the
      // quantity status could never catch a wrong mapping).
      const count = 1 + Math.floor(rand() * 4)
      const sold = count + (rand() < 0.5 ? 1 : 0)
      const notPaid = rand() < 0.45
      sale(id, { total, paidUsd, paidKhr, rate, status: 'awaiting_payment', before: null })
      raw.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,applied_price_usd,total_usd)
        VALUES(?,?,NULL,'Fuzz',?,1,1,?)`).run(id, id, sold, total)
      let left = total
      const refunds = []
      for (let k = 0; k < count && left > 0.01; k++) {
        const refund = Math.round(rand() * left * 100) / 100
        if (!(refund > 0)) continue
        left = Math.round((left - refund) * 100) / 100
        const rid = ret(id, refund)
        raw.prepare(`INSERT INTO return_items(return_id,sale_item_id,product_name,quantity,applied_price_usd,total_usd,return_to_stock,stock_action,branch_id)
          VALUES(?,?,'Fuzz',1,?,?,0,'none',1)`).run(rid, id, refund, refund)
        refunds.push({ id: rid, refund })
      }
      const quantityStatus = refunds.length >= sold ? 'returned' : 'partial_return'
      // Before 0234 a return moved the sale to its quantity status (Not Paid kept
      // as status_before_return); a later payment reopen can leave it Not Paid.
      const status = notPaid ? 'awaiting_payment' : quantityStatus
      raw.prepare('UPDATE sales SET sale_status = ?, status_before_return = ? WHERE id = ?').run(status, notPaid ? null : 'awaiting_payment', id)
      if (refunds.length) cases.push({ id, total, paidUsd, paidKhr, rate, status, quantityStatus, refunds })
    }
    apply(raw)
    let reductions = 0
    let clearedNotPaid = 0
    for (const c of cases) {
      const row = { total_usd: c.total, amount_paid_usd: c.paidUsd, amount_paid_khr: c.paidKhr, exchange_rate: c.rate,
        money_precision_version: 0, calculated_total_usd: null, sale_status: c.status, status_before_return: c.status === 'awaiting_payment' ? null : 'awaiting_payment' }
      const prior = { refundUsd: 0, owedReductionUsd: 0, loweredDebt: false }
      for (const r of c.refunds) {
        const want = split.splitReturnRefund({ sale: row, prior, refundUsd: r.refund })
        assert.equal(returnRow(raw, r.id).owed, want.owedReductionUsd, `sale ${c.id} return ${r.id}`)
        if (want.owedReductionUsd > 0) reductions++
        prior.refundUsd += r.refund; prior.owedReductionUsd = Math.round((prior.owedReductionUsd + want.owedReductionUsd) * 10000) / 10000
        prior.loweredDebt = prior.loweredDebt || want.owedReductionUsd > 0
      }
      const wantStatus = split.saleStatusWithReturns({ sale: row, activeOwedReductionUsd: prior.owedReductionUsd, loweredDebt: prior.loweredDebt, quantityStatus: c.quantityStatus })
      assert.equal(saleStatus(raw, c.id), wantStatus, `sale ${c.id} status (was ${c.status}, quantity ${c.quantityStatus})`)
      if (c.status === 'awaiting_payment' && wantStatus !== 'awaiting_payment') {
        clearedNotPaid++
        assert.equal(raw.prepare('SELECT status_before_return AS b FROM sales WHERE id = ?').get(c.id).b, 'awaiting_payment',
          'a Not Paid sale that leaves Not Paid keeps it as status_before_return, as the create path writes it')
      }
    }
    assert.ok(cases.length > 350 && reductions > 300, `control: the fuzz exercised the split (${cases.length} sales, ${reductions} reductions)`)
    assert.ok(clearedNotPaid > 20, `control: the fuzz cleared Not Paid debts and moved them to a quantity status (${clearedNotPaid})`)
  })

  console.log(`\n${checks} check(s) passed${failed ? `, ${failed} failed` : '.'}`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
