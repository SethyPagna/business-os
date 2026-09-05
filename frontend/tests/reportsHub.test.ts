// Pins the Reports redesign (Sep 3 2026, rc/sec-10): the pure report model
// (src/components/sales/reports/reportModel.ts) and the source-shape
// contracts of the hub + its views.
//
//   - buildIncomeStatement is arithmetically closed on the canonical kernel
//     figures it is given (gross -> discounts -> net sales -> pending ->
//     refunds -> REVENUE; revenue + tax/delivery -> COLLECTED; revenue -
//     COGS + delivery collected - delivery paid to couriers -> GROSS PROFIT;
//     - operating expenses -> TOTAL PROFIT) and never shows a profit line for
//     a caller the server hid cost from.
//   - the awaiting-payment cohort is broken out the same way and kept strictly
//     below and out of every realised total (S4R3-6).
//   - normalizeTotals / sumTotals copy the admin-only keys ONLY when the
//     server sent them (absence, not 0, is the "hidden" signal).
//   - reportQueryParams sends the clock window / status / payment only to
//     views whose endpoints honor them.
//   - every 'rpt_*' key the hub and views look up exists in BOTH packs.
import assert from 'node:assert/strict'
import './reportResponsiveLayout.test.ts'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripTypeScriptTypes } from 'node:module'
import {
  BASIS_LABELS,
  DEFAULT_REPORT_OPTIONS,
  EMPTY_REPORT_FILTERS,
  REPORT_STORAGE_KEYS,
  REPORT_VIEWS,
  STATEMENT_GROUPS,
  basisValue,
  buildIncomeStatement,
  defaultReportStyle,
  getReportView,
  hasProfit,
  hourRangeLabel,
  normalizeReportOptions,
  normalizeReportStyle,
  normalizeTotals,
  periodLabel,
  readStoredJson,
  reportFileName,
  reportQueryParams,
  resolveReportView,
  rowsToCsvObjects,
  sortRows,
  sumTotals,
  toggleSort,
  visibleReportViews,
  writeStoredJson,
  type ReportTotals,
} from '../src/components/sales/reports/reportModel.ts'
import { makeReportMoneyFormatter } from '../src/utils/reportMoney.ts'
import { normalizePriceValue } from '../src/utils/pricing.ts'

let failed = 0
const test = (name: string, fn: () => void): void => {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed += 1; console.error(`FAIL ${name}`); console.error(e) }
}

const rootPath = fileURLToPath(new URL('../', import.meta.url))
const read = (rel: string): string => fs.readFileSync(path.join(rootPath, rel), 'utf8')
const readJson = (rel: string): Record<string, unknown> => JSON.parse(read(rel)) as Record<string, unknown>

// A canonical totals block as the server sends it to an ADMIN. Figures chosen
// so every derived line is a distinct number: gross 300, store discount 20,
// membership 10 -> net sales 270; pending 40; refunds 15 -> revenue 215;
// collected 233 (= revenue + tax 8 + customer delivery 10).
//
// The delivery figures are deliberately SKEWED apart (S4R3-6). delivery_usd 10
// is every customer-paid fee in the window; recognized_delivery_usd 6 is the
// recognized share of it, and recognized_delivery_cost_usd 1 the recognized
// courier cost -- so delivery_net is 5 while delivery_margin (10 - 3) is 7. A
// fixture where those coincide cannot tell the profit-bearing delivery figure
// from the descriptive one, and the whole point of this lane is that they are
// different quantities. cost 90, delivery net 5 -> profit 130.
const adminTotals = {
  tx_count: 6,
  gross_sales_usd: 300,
  store_discount_usd: 20,
  membership_discount_usd: 10,
  discount_usd: 30,
  tax_usd: 8,
  delivery_usd: 10,
  store_delivery_usd: 5,
  delivery_actual_cost_usd: 3,
  delivery_actual_cost_count: 2,
  delivery_sale_count: 4,
  delivery_margin_usd: 7,
  delivery_net_usd: 5,
  recognized_delivery_usd: 6,
  recognized_delivery_cost_usd: 1,
  refund_usd: 15,
  revenue_usd: 255,
  pending_revenue_usd: 40,
  collected_total_usd: 233,
  avg_order_usd: 35.83,
  // The awaiting-payment cohort: unpaid gross 55 - unpaid discounts (9 + 6)
  // -> unpaid net sales 40; unpaid COGS 18; unpaid delivery 4 collected and 3
  // already paid out -> unpaid profit 23.
  pending_tx_count: 2,
  pending_gross_sales_usd: 55,
  pending_store_discount_usd: 9,
  pending_membership_discount_usd: 6,
  pending_delivery_usd: 4,
  pending_delivery_cost_usd: 3,
  cost_usd: 90,
  profit_usd: 170,
  margin_pct: 66.67,
  cost_missing_snapshot_lines: 2,
  pending_cost_usd: 18,
  pending_profit_usd: 23,
}
const {
  cost_usd: _c, profit_usd: _p, margin_pct: _m, cost_missing_snapshot_lines: _l,
  pending_cost_usd: _pc, pending_profit_usd: _pp, ...staffTotals
} = adminTotals
const khrToUsd = (khr: number) => khr / 4000
const lineMap = (lines: ReturnType<typeof buildIncomeStatement>) => Object.fromEntries(lines.map((l) => [l.key, l]))

test('normalizeTotals copies the admin keys only when the server sent them', () => {
  const admin = normalizeTotals(adminTotals)
  const staff = normalizeTotals(staffTotals)
  assert.ok(admin && hasProfit(admin), 'admin totals carry profit')
  assert.equal(admin.cost_missing_snapshot_lines, 2)
  assert.ok(staff && !hasProfit(staff), 'staff totals do not')
  assert.ok(!('cost_usd' in staff) && !('profit_usd' in staff) && !('margin_pct' in staff), 'the keys are ABSENT, not 0')
  assert.equal(staff.revenue_usd, 255)
  assert.equal(normalizeTotals(null), null)
  assert.equal(normalizeTotals('x'), null)
  // margin is derived when the server omitted it
  const derived = normalizeTotals({ ...adminTotals, margin_pct: undefined })
  assert.equal(derived?.margin_pct, 66.7, "client-derived margin uses profit / revenue (1 decimal, the display precision)")
})

test('buildIncomeStatement: revenue and collected groups close arithmetically on kernel figures', () => {
  const lines = buildIncomeStatement({ sales: normalizeTotals(staffTotals), profitMode: 'net', khrToUsd, expenses: { usd: 10, khr: 0 } })
  const m = lineMap(lines)
  assert.equal(m.total_sales.usd, 300)
  assert.equal(m.net_sales.usd, 270, 'net sales = gross - store - membership discounts')
  assert.equal(m.net_sales.kind, 'total')
  assert.equal(m.refunds.usd, 15)
  assert.equal(m.revenue.usd, 255, 'REVENUE is the kernel figure for every non-cancelled sale')
  assert.equal(m.net_sales.usd - m.refunds.usd, m.revenue.usd, 'the revenue group is closed without subtracting Not Paid')
  assert.equal(m.collected_total.usd, 233, 'collected cash is displayed independently from business revenue')
  // No cost on the server side -> no profit group at all, regardless of the profit mode / expenses given.
  assert.ok(!('cogs' in m) && !('gross_profit' in m) && !('expenses' in m) && !('net_result' in m), 'no profit lines for a caller without cost')
  assert.ok(lines.every((l) => l.group !== 'profit'))
  // The delivery memo and the awaiting-payment block are NOT cost-gated: they
  // are measured money in and money out, not a margin, so a staff caller sees
  // them. Only the cost-derived lines inside them drop away.
  assert.equal(m.delivery_charged.usd, 10)
  assert.equal(m.delivery_charged.kind, 'memo', 'the memo lines carry no operator')
  assert.equal(m.pending_revenue.usd, 40)
  assert.equal(m.pending_revenue.kind, 'memo')
})

test('buildIncomeStatement: the profit bridge names every term and never uses the residual', () => {
  const gross = lineMap(buildIncomeStatement({ sales: normalizeTotals(adminTotals), profitMode: 'gross', khrToUsd, expenses: { usd: 10, khr: 40000 } }))
  assert.equal(gross.revenue_carried.usd, 255, 'revenue is carried down so the first input of the bridge is on screen')
  assert.equal(gross.cogs.usd, 90)
  assert.equal(gross.delivery_collected.usd, 6, 'the RECOGNIZED delivery fee, not delivery_usd (10)')
  assert.equal(gross.delivery_paid.usd, 1, 'the RECOGNIZED courier cost, not delivery_actual_cost_usd (3)')
  assert.equal(gross.gross_profit.usd, 170)
  // The pre-S4R3-6 shape: one residual line, `revenue - cost - profit`,
  // labelled "Store-paid delivery". It always footed and it always named the
  // wrong quantity, so its absence from the profit group is the fix.
  assert.ok(!('store_delivery' in gross), 'the residual delivery plug is gone from the profit group')
  assert.equal(gross.delivery_absorbed.group, 'delivery', 'store-paid delivery is a memo now, not a profit term')
  // ... and pinned by VALUE, not only by key and group. Reintroducing the
  // residual keeps both of those and changes only the number, so structure
  // alone does not see the regression come back. On this fixture the measured
  // figure and the residual are the same magnitude with opposite signs
  // (5 against 215 - 90 - 130 = -5) -- which is exactly how a negative
  // "store-paid delivery" used to read as a negative expense.
  assert.equal(gross.delivery_charged.usd, 10, 'charged = every customer-paid fee in the window')
  assert.equal(gross.delivery_actual_cost.usd, 3, 'actual cost = every courier payment recorded in the window')
  assert.equal(gross.delivery_absorbed.usd, 5, 'store-paid delivery is the MEASURED store_delivery_usd')
  // Stated directly, so it survives someone re-picking the fixture numbers: if
  // a future fixture made the two coincide this goes red, which is the signal.
  assert.notEqual(
    gross.delivery_absorbed.usd,
    gross.revenue_carried.usd - gross.cogs.usd - gross.gross_profit.usd,
    'store-paid delivery is never the residual revenue - cost - profit',
  )
  // delivery_margin_usd (7 here) is the descriptive figure over ALL deliveries;
  // substituting it for the recognized halves would miss by 2 and still look
  // plausible, which is why the fixture skews them apart.
  assert.notEqual(gross.delivery_collected.usd - gross.delivery_paid.usd, 7, 'the bridge does not use delivery_margin_usd')
  assert.equal(gross.delivery_net.usd, 5, 'delivery contribution = recognized fees - recognized courier cost')

  const net = lineMap(buildIncomeStatement({ sales: normalizeTotals(adminTotals), profitMode: 'net', khrToUsd, expenses: { usd: 10, khr: 40000 } }))
  assert.equal(net.expenses.usd, 20, '$10 + 40,000៛ at 4000 = $20')
  assert.ok(!('khr' in net.expenses), 'a canonical USD statement line never also carries the source KHR')
  assert.equal(net.expenses.hintKey, 'rpt_hint_expenses_line')
  assert.equal(net.net_result.usd, 150, 'net result = total profit - expenses')
  assert.equal(net.net_result.kind, 'total')
  // The mode no longer decides whether the gross-profit-to-total-profit step
  // EXISTS -- hiding it behind an off-by-default option is what made that step
  // invisible. It only moves which total the summary leads with.
  assert.ok('expenses' in gross && 'net_result' in gross, 'gross mode still shows the step down to total profit')
  assert.equal(gross.gross_profit.headline, true)
  assert.equal(gross.net_result.headline, false)
  assert.equal(net.net_result.headline, true)
  assert.equal(net.gross_profit.headline, false)
  // No expenses block at all (the caller cannot read expenses) -> no net lines.
  const netNoExp = lineMap(buildIncomeStatement({ sales: normalizeTotals(adminTotals), profitMode: 'net', khrToUsd }))
  assert.ok(!('expenses' in netNoExp) && !('net_result' in netNoExp))
})

test('buildIncomeStatement: converted expenses stay canonical through USD/KHR/BOTH, comparison, and CSV rows', () => {
  // Exact Aug 30-Sep 5 source totals: $5,440 + 373,700៛ at 4,065 =
  // $5,531.93. The former statement line also retained 373,700៛, so the
  // real report formatter folded that source amount in a second time and
  // displayed $5,623.87 while Final Profit correctly used $5,531.93.
  const screenshotTotals = normalizeTotals({
    ...adminTotals,
    revenue_usd: 8924,
    cost_usd: 10185.02,
    recognized_delivery_usd: 71,
    recognized_delivery_cost_usd: 29.36,
    profit_usd: -1219.38,
  })
  const expenses = { usd: 5440, khr: 373700 }
  const previousExpenses = { usd: 1, khr: 4065 }
  const lines = buildIncomeStatement({
    sales: screenshotTotals,
    prevSales: screenshotTotals,
    expenses,
    prevExpenses: previousExpenses,
    profitMode: 'net',
    khrToUsd: (value) => normalizePriceValue(value) / 4065,
  })
  const m = lineMap(lines)
  assert.equal(m.expenses.usd, 5531.93)
  assert.ok(!('khr' in m.expenses), 'the source pair stays outside the canonical statement line')
  assert.deepEqual(expenses, { usd: 5440, khr: 373700 }, 'native expense capture remains untouched at the model boundary')

  const deps = (displayCurrency: string) => ({
    displayCurrency,
    fmtUSD: (value: number | string) => `$${normalizePriceValue(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    fmtKHR: (value: number | string) => `${normalizePriceValue(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}៛`,
    khrToUsd: (value: unknown) => normalizePriceValue(value) / 4065,
    usdToKhr: (value: unknown) => normalizePriceValue(value) * 4065,
  })
  const statementKhr = (m.expenses as typeof m.expenses & { khr?: number }).khr
  assert.equal(makeReportMoneyFormatter(deps('usd'))(m.expenses.usd, statementKhr), '$5,531.93')
  const khrDeps = deps('khr')
  assert.equal(
    makeReportMoneyFormatter(khrDeps)(m.expenses.usd, statementKhr),
    khrDeps.fmtKHR(khrDeps.usdToKhr(m.expenses.usd)),
    'KHR display converts the canonical statement value without adding the native KHR again',
  )
  assert.equal(makeReportMoneyFormatter(deps('both'))(m.expenses.usd, statementKhr), '$5,531.93')

  assert.equal(m.expenses.prevUsd, 2, 'comparison converts its native pair exactly once')
  assert.equal(m.net_result.prevUsd, -1221.38, 'comparison final profit uses the same canonical expense basis')
  const csvRows = lines.map((line) => ({ Line: line.key, Amount_USD: line.usd, Previous_USD: line.prevUsd ?? '' }))
  assert.equal(csvRows.find((row) => row.Line === 'expenses')?.Amount_USD, 5531.93)
  assert.equal(csvRows.find((row) => row.Line === 'net_result')?.Amount_USD, -6751.31)
  assert.equal(m.gross_profit.usd - m.expenses.usd, m.net_result.usd, 'statement and canonical CSV rows foot to Final Profit')
})

test('buildIncomeStatement: the waterfall foots to the cent, and says so when cost is missing', () => {
  const m = lineMap(buildIncomeStatement({ sales: normalizeTotals(adminTotals), profitMode: 'net', khrToUsd, expenses: { usd: 10, khr: 40000 } }))
  // Total revenue - COGS + delivery collected - actual delivery cost = gross
  // profit, with every input on screen. `profit_rounding` exists only when the
  // independently round2'd terms miss; it is a term of the chain when it does.
  const rounding = m.profit_rounding ? m.profit_rounding.usd : 0
  assert.equal(
    m.revenue_carried.usd - m.cogs.usd + m.delivery_collected.usd - m.delivery_paid.usd + rounding,
    m.gross_profit.usd,
    'revenue - cogs + delivery collected - delivery paid = gross profit',
  )
  assert.equal(m.gross_profit.usd - m.expenses.usd, m.net_result.usd, 'gross profit - expenses = total profit')
  assert.equal(m.pending_revenue.usd, 40, 'Not Paid is one consolidated memo row')

  // A cent of rounding is CARRIED on its own line, never absorbed into a
  // labelled one.
  const skew = lineMap(buildIncomeStatement({ sales: normalizeTotals({ ...adminTotals, profit_usd: 170.01 }), profitMode: 'net', khrToUsd }))
  assert.equal(skew.profit_rounding.usd, 0.01, 'the cent is its own line')
  assert.equal(skew.cogs.usd, 90, 'and no other line moved to swallow it')
  assert.equal(
    skew.revenue_carried.usd - skew.cogs.usd + skew.delivery_collected.usd - skew.delivery_paid.usd + skew.profit_rounding.usd,
    skew.gross_profit.usd,
  )

  // Absent cost data is LABELLED, not silently rendered as $0.00 of free goods.
  const noCost = lineMap(buildIncomeStatement({ sales: normalizeTotals({ ...adminTotals, cost_usd: 0, cost_missing_snapshot_lines: 4 }), profitMode: 'gross', khrToUsd }))
  assert.equal(noCost.cogs.usd, 0)
  assert.equal(noCost.cogs.note?.key, 'rpt_note_cost_unavailable', 'a zero COGS with missing snapshots says "not available"')
  assert.equal(noCost.cogs.note?.count, 4)
  assert.equal(m.cogs.note?.key, 'rpt_note_cost_partial', 'a partial one says how many lines are uncosted')
  assert.equal(m.delivery_paid.note?.key, 'rpt_note_delivery_partial', 'courier cost states its coverage: 2 of 4 deliveries')
  assert.equal(m.delivery_paid.note?.total, 4)
})

test('buildIncomeStatement: Not Paid is one consolidated memo below business totals', () => {
  const opts = { profitMode: 'net' as const, khrToUsd, expenses: { usd: 10, khr: 40000 } }
  const base = lineMap(buildIncomeStatement({ sales: normalizeTotals(adminTotals), ...opts }))
  // Move EVERY pending input to an unmistakable number. Not one realised line
  // may follow it (binding ruling: unpaid money stays out of the realised
  // arithmetic and is reported below it).
  const skewed = buildIncomeStatement({
    sales: normalizeTotals({
      ...adminTotals,
      pending_tx_count: 99,
      pending_gross_sales_usd: 999,
      pending_store_discount_usd: 99,
      pending_membership_discount_usd: 99,
      pending_delivery_usd: 99,
      pending_delivery_cost_usd: 99,
      pending_cost_usd: 999,
      pending_profit_usd: 999,
    }),
    ...opts,
  })
  const m = lineMap(skewed)
  for (const key of ['net_sales', 'revenue', 'collected_total', 'revenue_carried', 'cogs', 'delivery_collected', 'delivery_paid', 'gross_profit', 'net_result']) {
    assert.equal(m[key].usd, base[key].usd, `${key} is untouched by the unpaid cohort`)
  }
  assert.equal(base.pending_revenue.kind, 'memo')
  assert.equal(base.pending_revenue.usd, 40)
  assert.equal(base.net_sales.usd - base.refunds.usd, base.revenue.usd)

  // The block is last, is its own group, and no realised line sits inside it.
  const groups = skewed.map((l) => l.group)
  const firstPending = groups.indexOf('pending')
  assert.ok(firstPending > 0, 'the block exists')
  assert.ok(groups.slice(firstPending).every((g) => g === 'pending'), 'nothing realised follows the unpaid block')
  assert.ok(groups.lastIndexOf('profit') < firstPending, 'the final realised total precedes it')
  assert.equal(STATEMENT_GROUPS[STATEMENT_GROUPS.length - 1], 'pending', 'and the render order the three surfaces share agrees')
})

test('buildIncomeStatement: previous-period figures ride the same lines; none without a previous block', () => {
  const prev = { ...adminTotals, gross_sales_usd: 200, revenue_usd: 150, collected_total_usd: 160, profit_usd: 80, cost_usd: 60 }
  const lines = buildIncomeStatement({ sales: normalizeTotals(adminTotals), prevSales: normalizeTotals(prev), profitMode: 'net', khrToUsd, expenses: { usd: 10, khr: 0 }, prevExpenses: { usd: 5, khr: 0 } })
  const m = lineMap(lines)
  assert.equal(m.total_sales.prevUsd, 200)
  assert.equal(m.revenue.prevUsd, 150)
  assert.equal(m.gross_profit.prevUsd, 80)
  assert.equal(m.net_result.prevUsd, 75)
  assert.ok(lineMap(buildIncomeStatement({ sales: normalizeTotals(adminTotals), profitMode: 'gross', khrToUsd })).revenue.prevUsd === null)
  assert.deepEqual(buildIncomeStatement({ sales: null, profitMode: 'gross', khrToUsd }), [])
})

test('sumTotals sums additive figures, recomputes the average, and keeps profit only when EVERY row has it', () => {
  const a = normalizeTotals(adminTotals) as ReportTotals
  const b = normalizeTotals({ ...adminTotals, tx_count: 4, revenue_usd: 100.005, profit_usd: 30, cost_usd: 70, cost_missing_snapshot_lines: 1 }) as ReportTotals
  const both = sumTotals([a, b])
  assert.equal(both.tx_count, 10)
  assert.equal(both.revenue_usd, 355.01, 'money re-rounded to cents')
  assert.equal(both.avg_order_usd, 35.5, 'average = revenue / tx, never summed')
  assert.equal(both.profit_usd, 200)
  assert.equal(both.cost_usd, 160)
  assert.equal(both.cost_missing_snapshot_lines, 3)
  assert.equal(both.margin_pct, 56.3)
  // The awaiting-payment cohort has to accumulate too, or a grouped/period row
  // silently reports a $0.00 unpaid block while its parts are non-zero.
  assert.equal(both.pending_gross_sales_usd, 110)
  assert.equal(both.pending_revenue_usd, 80)
  assert.equal(both.pending_delivery_cost_usd, 6)
  assert.equal(both.pending_cost_usd, 36)
  assert.equal(both.pending_profit_usd, 46)
  assert.equal(both.recognized_delivery_usd, 12)
  assert.equal(both.recognized_delivery_cost_usd, 2)
  const mixed = sumTotals([a, normalizeTotals(staffTotals) as ReportTotals])
  assert.ok(!hasProfit(mixed), 'one row without cost -> no profit on the total (never a misleading partial sum)')
  assert.ok(!('cost_usd' in mixed))
  const empty = sumTotals([])
  assert.equal(empty.tx_count, 0)
  assert.equal(empty.avg_order_usd, 0)
  assert.ok(!hasProfit(empty))
})

test('basisValue / BASIS_LABELS: the three calculation bases read distinct kernel figures', () => {
  const t = normalizeTotals(adminTotals)
  assert.equal(basisValue(t, 'revenue'), 255)
  assert.equal(basisValue(t, 'gross'), 300)
  assert.equal(basisValue(t, 'collected'), 233)
  assert.equal(basisValue(null, 'revenue'), 0)
  assert.deepEqual(Object.keys(BASIS_LABELS).sort(), ['collected', 'gross', 'revenue'])
})

test('reportQueryParams: clock window only for timestamp-backed views; status/payment only where understood; all-day window dropped', () => {
  const f = { ...EMPTY_REPORT_FILTERS, startDate: '2026-08-01', endDate: '2026-08-31', startTime: '09:00', endTime: '17:00', branchId: '1', status: 'completed', paymentMethod: 'Cash' }
  const sales = reportQueryParams(f, getReportView('sales'))
  assert.deepEqual(sales, { startDate: '2026-08-01', endDate: '2026-08-31', branchId: '1', startTime: '09:00', endTime: '17:00', status: 'completed', paymentMethod: 'Cash' })
  const returns = reportQueryParams(f, getReportView('returns'))
  assert.deepEqual(returns, { startDate: '2026-08-01', endDate: '2026-08-31', branchId: '1' }, 'a date-only ledger gets neither the clock nor the sale filters')
  const expenses = reportQueryParams(f, getReportView('expenses'))
  assert.deepEqual(expenses, returns)
  const allDay = reportQueryParams({ ...f, startTime: '00:00', endTime: '23:59' }, getReportView('periods'))
  assert.ok(!('startTime' in allDay), 'the whole-day window is the default and is not sent')
  const half = reportQueryParams({ ...f, endTime: '' }, getReportView('periods'))
  assert.ok(!('startTime' in half) && !('endTime' in half), 'a half-set window is not sent')
  assert.deepEqual(reportQueryParams(EMPTY_REPORT_FILTERS, getReportView('overview')), {})
})

test('views: permissions gate the picker, the stored view survives only while allowed', () => {
  const all = { sales: true, returns: true, fees: true }
  assert.equal(visibleReportViews(all).length, REPORT_VIEWS.length)
  const feesOnly = visibleReportViews({ sales: false, returns: false, fees: true }).map((v) => v.id)
  assert.deepEqual(feesOnly, ['overview', 'expenses'], 'the Overview is visible with any one area; sales views are not')
  assert.equal(resolveReportView('products', all), 'products')
  assert.equal(resolveReportView('products', { sales: false, returns: true, fees: false }), 'overview', 'a no-longer-allowed stored view falls back to the first allowed one')
  assert.equal(resolveReportView('bogus', all), 'overview')
  assert.equal(resolveReportView('sales', { sales: false, returns: false, fees: false }), null, 'nothing readable -> null (the hub shows its EmptyState)')
  for (const v of REPORT_VIEWS) {
    if (v.id === 'returns' || v.id === 'expenses') assert.equal(v.supportsTime, false, `${v.id} is date-only`)
    else assert.equal(v.supportsTime, true, `${v.id} honors the clock window`)
    if (v.groupedBy) assert.ok(v.area === 'sales', `${v.id} grouped views are sales-gated`)
  }
  const ids = REPORT_VIEWS.map((v) => v.id)
  assert.equal(new Set(ids).size, ids.length, 'view ids are unique')
})

test('options / style persistence is tolerant of garbage and round-trips through storage', () => {
  assert.deepEqual(normalizeReportOptions(undefined), DEFAULT_REPORT_OPTIONS)
  assert.deepEqual(normalizeReportOptions({ basis: 'collected', profitMode: 'nope', granularity: 'week', compare: 'yes', currency: 'khr' }), { basis: 'collected', profitMode: 'gross', granularity: 'week', compare: false, currency: 'khr' })
  assert.equal(normalizeReportStyle('receipt'), 'receipt')
  assert.equal(normalizeReportStyle('grid'), null)
  assert.equal(defaultReportStyle(true), 'receipt')
  assert.equal(defaultReportStyle(false), 'excel')
  const store = new Map<string, string>()
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } }
  writeStoredJson(storage, REPORT_STORAGE_KEYS.options, { ...DEFAULT_REPORT_OPTIONS, basis: 'gross' })
  assert.equal(readStoredJson(storage, REPORT_STORAGE_KEYS.options, normalizeReportOptions).basis, 'gross')
  store.set(REPORT_STORAGE_KEYS.options, '{not json')
  assert.deepEqual(readStoredJson(storage, REPORT_STORAGE_KEYS.options, normalizeReportOptions), DEFAULT_REPORT_OPTIONS, 'corrupt storage falls back, never throws')
  const throwing = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  assert.deepEqual(readStoredJson(throwing, 'k', normalizeReportOptions), DEFAULT_REPORT_OPTIONS)
  assert.doesNotThrow(() => writeStoredJson(throwing, 'k', 1))
  assert.deepEqual(readStoredJson(null, 'k', normalizeReportOptions), DEFAULT_REPORT_OPTIONS)
})

test('labels: hours read as a clock range, weeks as a Monday–Sunday span, months as mm/yyyy', () => {
  assert.equal(hourRangeLabel('9'), '09:00–09:59')
  assert.equal(hourRangeLabel('13'), '13:00–13:59')
  assert.equal(hourRangeLabel('zz'), 'zz')
  const fmt = (iso: string) => { const [y, m, d] = iso.split('-'); return `${m}/${d}/${y}` }
  assert.equal(periodLabel({ period: '2026-08-17', date_from: '2026-08-17', date_to: '2026-08-23' }, 'week', fmt), '08/17/2026 – 08/23/2026')
  assert.equal(periodLabel({ period: '2026-08', date_from: '2026-08-01', date_to: '2026-08-31' }, 'month', fmt), '08/2026')
  assert.equal(periodLabel({ period: '2026-08-20', date_from: '2026-08-20', date_to: '2026-08-20' }, 'day', fmt), '08/20/2026')
})

test('sorting is stable, numeric-aware, and keeps empties last in both directions', () => {
  const rows = [{ n: 'b', v: 10 }, { n: 'a', v: null }, { n: 'c', v: 2 }, { n: 'd', v: 10 }]
  assert.deepEqual(sortRows(rows, (r) => r.v, 'desc').map((r) => r.n), ['b', 'd', 'c', 'a'])
  assert.deepEqual(sortRows(rows, (r) => r.v, 'asc').map((r) => r.n), ['c', 'b', 'd', 'a'])
  assert.deepEqual(sortRows([{ n: 'x10' }, { n: 'x9' }, { n: 'X1' }], (r) => r.n, 'asc').map((r) => r.n), ['X1', 'x9', 'x10'])
  assert.deepEqual(toggleSort(null, 'revenue'), { key: 'revenue', dir: 'desc' })
  assert.deepEqual(toggleSort({ key: 'revenue', dir: 'desc' }, 'revenue'), { key: 'revenue', dir: 'asc' })
  assert.deepEqual(toggleSort({ key: 'revenue', dir: 'asc' }, 'date', 'asc'), { key: 'date', dir: 'asc' })
})

test('CSV rows use the column headers as keys and never emit undefined; file names carry view + range', () => {
  const out = rowsToCsvObjects([{ header: 'Date', value: (r: { d: string; v?: number }) => r.d }, { header: 'Revenue', value: (r) => r.v }], [{ d: '2026-08-20', v: 5 }, { d: '2026-08-21' }])
  assert.deepEqual(out, [{ Date: '2026-08-20', Revenue: 5 }, { Date: '2026-08-21', Revenue: '' }])
  assert.equal(reportFileName('sales', { startDate: '2026-08-01', endDate: '2026-08-31' }, 'csv'), 'sales-report-2026-08-01_2026-08-31.csv')
  assert.equal(reportFileName('overview', { startDate: '', endDate: '' }, 'csv'), 'overview-report-all_all.csv')
})

// ---- source-shape contracts ----------------------------------------------

const HUB = 'src/components/sales/ReportsHub.tsx'
const VIEW_FILES = [
  'src/components/sales/reports/OverviewReport.tsx',
  'src/components/sales/reports/PeriodReport.tsx',
  'src/components/sales/reports/SalesListReport.tsx',
  'src/components/sales/reports/GroupedReport.tsx',
  'src/components/sales/reports/ReturnsReport.tsx',
  'src/components/sales/reports/ExpensesReport.tsx',
]
const SHARED_FILES = [
  'src/components/sales/reports/reportModel.ts',
  'src/components/sales/reports/reportTypes.ts',
  'src/components/sales/reports/ReportFrame.tsx',
  'src/components/sales/reports/ReportTable.tsx',
  'src/components/sales/reports/ReceiptSheet.tsx',
  'src/components/sales/reports/ReportOptionsFold.tsx',
]

test('every rpt_* key the hub, views and model reference exists in BOTH language packs', () => {
  const en = readJson('src/lang/en.json')
  const km = readJson('src/lang/km.json')
  const missing: string[] = []
  for (const rel of [HUB, ...VIEW_FILES, ...SHARED_FILES]) {
    const src = read(rel)
    for (const m of src.matchAll(/'(rpt_[a-z0-9_]+)'/g)) {
      const key = m[1]
      if (!(key in en)) missing.push(`${rel}: ${key} (en)`)
      if (!(key in km)) missing.push(`${rel}: ${key} (km)`)
      else if (!String(km[key]).trim()) missing.push(`${rel}: ${key} (km empty)`)
    }
  }
  assert.deepEqual(missing, [])
})

test('the hub persists view / style / options under the model\'s storage keys and derives the style from the viewport', () => {
  const hub = read(HUB)
  assert.ok(hub.includes('REPORT_STORAGE_KEYS.view') && hub.includes('REPORT_STORAGE_KEYS.style') && hub.includes('REPORT_STORAGE_KEYS.options'))
  assert.ok(hub.includes('styleChoice ?? defaultReportStyle(compact)'), 'unset style follows the viewport (receipt on phones, excel wider)')
  assert.ok(hub.includes('<ControlRow') && hub.includes('sticky'), 'one shared sticky control row')
  assert.ok(hub.includes('<ReportOptionsFold'), 'the filter menu is wired')
  // The business-summary workbook belongs to the business-workbook lane and
  // its endpoints are not on this line, so the hub deliberately ships without
  // it here. Pinned as an absence so it cannot creep back in half-wired.
  assert.ok(!hub.includes('exportBusinessWorkbook('), 'the hub does not reach for the workbook export that is not on this line')
  assert.ok(!hub.includes('SalesDailyReport') && !hub.includes('ReturnsReportSection') && !hub.includes('FeesReportSection'), 'the old three sections are gone (no zombie imports)')
  for (const old of ['src/components/sales/SalesDailyReport.tsx', 'src/components/sales/ReturnsReportSection.tsx', 'src/components/sales/FeesReportSection.tsx']) {
    assert.ok(!fs.existsSync(path.join(rootPath, old)), `${old} was deleted`)
  }
})

test('the control row keeps every control at each width: nothing is dropped, nothing is doubled', () => {
  const hub = read(HUB)
  // ControlRow renders `overflow` INSTEAD of filters/sort/actions from 1023px
  // down. Passing a tail that held only the export menu silently deleted the
  // view picker and the filter selects between 768 and 1023 -- the tail has to
  // be unconditional.
  assert.ok(/overflow=\{collapsedTail\}/.test(hub), 'the collapsed tail is passed at every width, not only when compact')
  assert.ok(/actions=\{collapsedTail\}/.test(hub), 'the wide tier renders the SAME tail, so no control exists at only one width')
  const tail = hub.slice(hub.indexOf('const collapsedTail'), hub.indexOf('const body'))
  assert.ok(tail.includes('{filtersButton}'), 'the tail carries the filter menu')

  // Desktop and compact layouts share the same picker definition. Each
  // mutually exclusive responsive branch renders it once.
  assert.ok(!tail.includes('viewPicker'), 'the picker is not in the tail any more (it would double up with the search slot)')
  assert.ok(/const searchSlot = \([\s\S]*?\{viewPicker\}/.test(hub), 'the search slot carries the view picker at every tier')
  assert.ok(/reports-mobile-primary[\s\S]*?\{viewPicker\}\{rangePicker\}/.test(hub), 'the compact tier pairs view and range, wrapping when needed')
  assert.equal((hub.match(/\{viewPicker\}/g) || []).length, 2, 'one picker reference exists in each responsive branch')

  // The four controls Part 586 folded into the one menu must not come back as
  // separate control-row citizens -- that crowding is what hid the search box.
  assert.ok(!hub.includes('<OverflowMenu'), 'no separate overflow menu beside the filter menu')
  assert.ok(!hub.includes('const styleToggle'), 'the Excel/Receipt toggle lives in the menu, not on the row')
  assert.ok(!hub.includes('const optionsButton'), 'the calculation options open from the same menu button')
  assert.equal((hub.match(/<Fold\b/g) || []).length, 0, 'the hub opens ONE fold, and it is ReportOptionsFold')

  // The search box is the control the user reported missing. It must render,
  // carry a visible affordance, and hold a width floor so the range picker
  // cannot squeeze it to nothing at the 768-1023 tier.
  assert.ok(hub.includes('type="search"'), 'the search input is present')
  assert.ok(hub.includes('<SearchIcon'), 'the search box reads as a search box')
  assert.ok(/min-w-\[9rem\] flex-1/.test(hub), 'the search box keeps a width floor and takes the free space')

  // The menu owns the filters AND the options, so its badge must count both,
  // and its Reset must clear both -- a Reset that silently left a non-default
  // basis in force would be worse than no Reset.
  assert.ok(/filterControls=\{/.test(hub), 'the filter selects are passed into the menu')
  assert.ok(/onStyleChange=\{/.test(hub), 'the style choice is made in the menu')
  assert.ok(hub.includes('activeFilterCount + (optionsAreDefault ? 0 : 1)'), 'the badge counts filters and non-default options')
  assert.ok(/onReset=\{\(\) => \{ clearFilters\(\); setOptions\(/.test(hub), 'one Reset clears the filters and the options together')

  // The date range is the widest control on a phone row; it only fits because
  // the trigger becomes a full-width field whose labels can truncate.
  assert.ok(hub.includes("triggerClassName={compact ? 'reports-mobile-range flex w-full min-w-0"), 'the range trigger goes full-width and shrinkable on phones')
  const picker = read('src/components/shared/DateTimeRangePicker.tsx')
  const spans = picker.match(/className=\{`min-w-0 truncate /g) || []
  assert.equal(spans.length, 2, 'both endpoint labels can actually truncate (min-w-0, not truncate alone)')
})

// --- Part 586: density, and the Khmer line box ----------------------------
//
// The reports surface reads ~18 `--ui-*` custom properties through the kit.
// styles/tokens.css, which DECLARES them, is on the rc/p2-1-kit line and did
// not come across with the kit port -- so every one of them was undefined and
// `var(--ui-row-h)` etc. was invalid at computed-value time (no row rhythm,
// no hairlines, no zebra, inherited 14px text). reports-surface.css declares
// them on this line. If it ever goes missing again, the surface degrades
// silently -- nothing throws -- so pin it here.
const SURFACE_CSS = 'src/components/sales/reports/reports-surface.css'

test('compact report filters match the stacked mobile control contract', () => {
  const hub = read(HUB)
  const css = read(SURFACE_CSS)
  for (const preset of ['all', 'today', '7d', '30d', 'month']) {
    assert.ok(hub.includes(`id: '${preset}'`), `${preset} is offered as a compact quick range`)
  }
  assert.ok(hub.includes('aria-pressed={selectedMobilePreset === preset.id}'), 'quick ranges expose their selected state')
  assert.ok(hub.includes("trh('show', 'Show')"), 'compact controls have a primary Show action')
  assert.match(css, /\.reports-mobile-controls\s*\{[\s\S]*display:\s*grid/, 'mobile controls stack in a scoped grid')
  assert.match(css, /\.reports-mobile-presets\s*\{[\s\S]*flex-wrap:\s*wrap/, 'quick ranges wrap instead of scrolling horizontally')
  assert.match(css, /\.reports-mobile-range\s*\{[^}]*\bmin-height:\s*44px\s*;/, 'the combined date/calendar target is at least 44px, regardless of declaration order')
  assert.match(css, /\.reports-mobile-show\s*\{[^}]*width:\s*100%/, 'Show fills the available action width')
  assert.match(css, /font-variant-numeric:\s*tabular-nums/, 'report amounts use tabular numerals')
  assert.match(css, /overflow-x:\s*clip/, 'the report surface cannot create page-level horizontal overflow')
})

test('every --ui-* token the reports surface reads is declared, and the density numbers are the tight ones', () => {
  const css = read(SURFACE_CSS)
  assert.ok(read(HUB).includes("import './reports/reports-surface.css'"), 'the hub imports the token layer')

  const sources = [HUB, ...VIEW_FILES, ...SHARED_FILES, 'src/components/shared/kit/DenseTable.tsx']
    .map(read).join('\n')
  const used = new Set([...sources.matchAll(/var\((--ui-[a-z0-9-]+)/g)].map((m) => m[1]))
  // main.css owns these two already; everything else must come from our file.
  const declaredElsewhere = new Set(['--ui-accent', '--ui-radius'])
  const undeclared = [...used].filter((v) => !declaredElsewhere.has(v) && !new RegExp(`\\${v}\\s*:`).test(css))
  assert.deepEqual(undeclared, [], `these tokens are read but declared nowhere:\n  ${undeclared.join('\n  ')}`)

  // The density the user asked for ("much closer"), against P2-1's originals:
  // row 32px -> 24px, body 13px -> 12px, meta 12px -> 11px, cell pad 12px -> 6px.
  assert.match(css, /--ui-row-h:\s*36px/, 'report rows stay in the requested 34–38px readable range')
  assert.match(css, /--ui-size-body:\s*12px/, 'body text is 12px (was 13px)')
  assert.match(css, /--ui-size-meta:\s*11px/, 'meta text is 11px (was 12px)')
  assert.match(css, /--ui-cell-px:\s*6px/, 'cell padding is 6px a side (was 12px)')
})

test('the excel table hugs its columns and pays for density with padding, never with the line box', () => {
  const dense = read('src/components/shared/kit/DenseTable.tsx')
  // `w-full` stretched a 4-column table across a 1400px screen, which is what
  // put a label at one edge and its number at the other.
  assert.ok(dense.includes("fit ? 'w-auto min-w-max' : 'w-full min-w-max'"), 'DenseTable can hug its content')
  assert.match(read('src/components/sales/reports/ReportTable.tsx'), /<DenseTable\s+fit\b/, 'the reports table asks for it')
  // Padding is tokenised so a surface tunes density without forking the kit,
  // and the 12px fallback keeps any other caller looking the way it did.
  assert.ok(dense.includes('px-[var(--ui-cell-px,12px)]'), 'cell padding is a token with a back-compatible fallback')
  assert.ok(!/\[&_tbody_td\]:px-3|\[&_thead_th\]:px-3/.test(dense), 'no hard-coded 12px cell padding is left')
  // Compaction must never come out of line-height: that is what shears Khmer.
  assert.ok(!/leading-\[1[0-4]px\]/.test(read('src/components/sales/reports/ReceiptSheet.tsx')), 'the receipt line box is not squeezed below 15px')
})

test('Khmer keeps a line box tall enough that truncating cells cannot shear it', () => {
  const css = read(SURFACE_CSS)
  // A Khmer cluster stacks a superscript sign above and a coeng subscript
  // below the base, ~1.55-1.65em of ink. main.css's Aug-31 compaction pass
  // pulled the km line-heights down to 1.38-1.52; a short line box inside an
  // `overflow:hidden` box (Tailwind `.truncate`) clips the tops and tails.
  // overflow-x cannot be clipped independently of overflow-y, so the only
  // real fix is to give the line box its height back.
  const kmBlocks = css.split('body.lang-km').slice(1).join('\n')
  const heights = [...kmBlocks.matchAll(/line-height:\s*([0-9.]+)/g)].map((m) => Number(m[1]))
  assert.ok(heights.length >= 3, 'the Khmer block sets line-height in more than one place')
  for (const h of heights) assert.ok(h >= 1.6, `Khmer line-height ${h} is below the 1.6 clip threshold`)
  // main.css's km `.text-xs` / `.text-sm` rules carry !important, so the
  // surface override has to as well or it never lands.
  assert.ok(/\.text-xs[\s\S]{0,80}line-height:[^;]+!important/.test(kmBlocks), 'the .text-xs override can actually win')
  // A taller line box needs a taller row, or the row clips instead of the cell.
  assert.match(kmBlocks, /--ui-row-h:\s*38px/, 'Khmer rows grow to fit the taller line box')
  // The fold is portalled to document.body, i.e. OUTSIDE [data-reports-hub],
  // so it needs its own hook or the menu keeps clipping.
  assert.ok(css.includes('[data-reports-fold]'), 'the portalled fold is covered too')
  assert.ok(read('src/components/sales/reports/ReportOptionsFold.tsx').includes('data-reports-fold'), 'the fold carries that hook')
  // Scoped, not global: the app-wide fix is a separate board item.
  assert.ok(!/^body\.lang-km\s*[,{]/m.test(kmBlocks.replace(/\[data-reports-(hub|fold)\]/g, 'X')), 'the Khmer fix stays scoped to this surface')
})

test('the receipt style puts the label and its value on a bounded line, and keeps Khmer out of the mono stack', () => {
  const sheet = read('src/components/sales/reports/ReceiptSheet.tsx')
  // A full-bleed tape flung the label to the far left and the number to the
  // far right; the cap is what makes them "much closer" on a wide phone.
  assert.ok(sheet.includes('max-w-[26rem]'), 'the one-tape layout is width-capped')
  assert.ok(sheet.includes('md:max-w-none'), 'the cap is lifted where the grid already bounds each card')
  // `font-mono` on the container put Khmer labels into a stack with no Khmer
  // coverage, so they fell back per glyph at a different metric inside a
  // truncate box. Mono belongs on the numbers only.
  assert.ok(!/'font-mono text-/.test(sheet), 'font-mono is off the container')
  assert.ok(sheet.includes('shrink-0 text-right font-mono'), 'font-mono rides the value span')
})

test('no view assigns a cost/profit key itself -- profit is shown only when the server sent it', () => {
  for (const rel of VIEW_FILES) {
    const src = read(rel)
    assert.ok(!/(cost_usd|profit_usd|margin_pct)\s*:\s*0\b/.test(src), `${rel} never fabricates a 0 cost/profit`)
    assert.ok(src.includes('<ReportFrame'), `${rel} renders inside a ReportFrame`)
    assert.ok(src.includes('<ReceiptSheet') && src.includes('<ReportTable'), `${rel} offers both the excel and the receipt style`)
  }
  for (const rel of ['src/components/sales/reports/PeriodReport.tsx', 'src/components/sales/reports/GroupedReport.tsx']) {
    assert.ok(read(rel).includes('rows.every((r) => hasProfit(r))') || read(rel).includes('groupRows.every((r) => hasProfit(r))'), `${rel} shows profit columns only when EVERY row carries profit`)
  }
  // The per-receipt list keys on the server-typed presence of gross_profit_usd in the totals block.
  assert.ok(read('src/components/sales/reports/SalesListReport.tsx').includes("typeof totals.gross_profit_usd === 'number'"), 'the Sales list gates profit on the server having sent it')
  // The Overview reads its profit figure from the statement, which buildIncomeStatement only emits when the server sent cost.
  const overview = read('src/components/sales/reports/OverviewReport.tsx')
  assert.ok(overview.includes("lines.find((l) => l.key === 'gross_profit')"), 'the Overview takes gross profit from the statement lines')
  assert.ok(overview.includes('buildIncomeStatement('), 'the Overview builds its statement through the model')
})

test('the awaiting-payment block is set apart in the warning tint on every surface that renders a statement', () => {
  // The owner asked for it in as many words: "a yellow-highlighted block at
  // the bottom with the unpaid subtotals on their own". The tint is
  // load-bearing -- it is what stops a theoretical figure being read as a
  // realised one -- so it is pinned, and pinned on all three statement
  // surfaces rather than only the Overview.
  const css = read(SURFACE_CSS)
  const dark = css.slice(css.indexOf('.dark {'))
  for (const token of ['--ui-warn-soft', '--ui-warn-line', '--ui-warn-ink']) {
    assert.ok(new RegExp(`${token}\\s*:`).test(css), `${token} is declared`)
    // A light-mode-only amber is a white slab on the dark card, which reads as
    // an error rather than a highlight.
    assert.ok(dark.includes(`${token}:`), `${token} has a dark-mode value`)
  }
  assert.ok(css.includes("tr[data-statement-group='pending']"), 'the excel style tints the block by group')
  const sheet = read('src/components/sales/reports/ReceiptSheet.tsx')
  assert.ok(/highlight\?: boolean/.test(sheet), 'the receipt style takes a highlight flag')
  assert.ok(sheet.includes('bg-[var(--ui-warn-soft)]'), 'and paints it in the warning tint')
  // Khmer: the tinted box buys its separation with PADDING. A box that hugs
  // the Latin metric shears the tops and tails of a Khmer cluster.
  const hl = sheet.slice(sheet.indexOf('block.highlight'), sheet.indexOf('block.highlight') + 200)
  assert.ok(/px-[\d.]+ py-[\d.]+/.test(hl), 'the tinted box is padded')
  assert.ok(!/leading-|line-height/.test(hl), 'and never shortens the line box')

  // Parity: the group order, the group label and the tint predicate all come
  // from the model, so a new group cannot appear on one surface and not the
  // others. These three files each carried their own ['revenue','collected',
  // 'profit'] literal before S4R3-6, which is why the delivery and pending
  // groups would have rendered on none of them.
  for (const rel of ['src/components/sales/reports/OverviewReport.tsx', 'src/components/sales/reports/PeriodReport.tsx', 'src/components/sales/reports/GroupedReport.tsx']) {
    const src = read(rel)
    assert.ok(src.includes('STATEMENT_GROUPS'), `${rel} reads the shared group order`)
    assert.ok(src.includes('statementGroupLabel('), `${rel} reads the shared group labels`)
    assert.ok(src.includes('isTheoreticalGroup('), `${rel} tints the theoretical block`)
    assert.ok(!/\['revenue', ?'collected', ?'profit'\]/.test(src), `${rel} keeps no local copy of the group list`)
  }
})

test('sales receipt and statement cost floors match the canonical aggregate rule', () => {
  const source = read('src/components/sales/reports/SalesListReport.tsx')
  const helpers = source.slice(source.indexOf('const MONEY_KEYS'), source.indexOf('export default function'))
    .replaceAll('export function', 'function')
  const { mapSaleRow, sumSaleRows } = new Function('num', 'round2', `${stripTypeScriptTypes(helpers)}; return {mapSaleRow,sumSaleRows}`)(
    (v: unknown) => Number(v) || 0, (v: number) => Math.round(v * 100) / 100,
  )
  const corrected = mapSaleRow({cost_usd:0,cost_before_floor_usd:-10,gross_profit_usd:85},0)
  const ordinary = mapSaleRow({cost_usd:120,cost_before_floor_usd:120,gross_profit_usd:84},1)
  assert.equal(sumSaleRows([corrected,ordinary]).cost_usd,110)
  assert.equal(sumSaleRows([corrected,ordinary]).gross_profit_usd,179)
  assert.equal(sumSaleRows([corrected]).cost_usd,0)
  assert.equal(sumSaleRows([corrected]).gross_profit_usd,85)
  assert.equal(sumSaleRows([ordinary]).gross_profit_usd,84)
  assert.equal(sumSaleRows([mapSaleRow({},0)]).cost_usd,undefined)
})

// Execute the actual hook bodies with a small deterministic hook scheduler.
// Render and passive effects are deliberately separate so these regressions
// catch stale exports in the interval BEFORE effect cleanup/reset runs.
function hookHarness(file: string, name: string) {
  const slots: any[] = []
  let index = 0
  let writes = 0
  let pending: Array<() => void> = []
  const changed = (a: unknown[] | undefined, b: unknown[]) => !a || a.length !== b.length || b.some((v, i) => !Object.is(v, a[i]))
  const useState = (initial: unknown) => {
    const i = index++
    if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
    return [slots[i], (next: any) => { writes++; slots[i] = typeof next === 'function' ? next(slots[i]) : next }]
  }
  const useRef = (initial: unknown) => {
    const i = index++
    return slots[i] ??= { current: initial }
  }
  const useCallback = (fn: Function, deps: unknown[]) => {
    const i = index++
    if (changed(slots[i]?.deps, deps)) slots[i] = { fn, deps }
    return slots[i].fn
  }
  const useEffect = (fn: () => void | (() => void), deps: unknown[]) => {
    const i = index++
    if (changed(slots[i]?.deps, deps)) pending.push(() => {
      slots[i]?.cleanup?.()
      slots[i] = { deps, cleanup: fn() }
    })
  }
  const source = read(file).slice(read(file).indexOf(`export function ${name}`)).replace('export function', 'function')
  const hook = new Function('useState', 'useRef', 'useCallback', 'useEffect', `${stripTypeScriptTypes(source)}; return ${name}`)(useState, useRef, useCallback, useEffect)
  return {
    render(...args: any[]) { index = 0; return hook(...args) },
    effects() { const jobs = pending; pending = []; jobs.forEach((job) => job()) },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); pending = [] },
    get writes() { return writes },
  }
}

function deferred() {
  let resolve!: (value: any) => void
  let reject!: (error: Error) => void
  const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve))
const asyncTest = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.error(`FAIL ${name}`); console.error(e) }
}

for (const paged of [false, true]) {
  const name = paged ? 'usePagedReport' : 'useReportData'
  const file = `src/components/sales/reports/${paged ? 'usePagedReport.ts' : 'ReportFrame.tsx'}`
  const result = (value: string) => paged ? { rows: [value], has_more: true, next_cursor: { id: value }, snapshot_max_id: 42 } : value
  const visible = (state: any) => paged ? state.rows : state.data
  const empty = paged ? [] : null

  await asyncTest(`${name}: key/refresh renders revoke prior results and failed refresh cannot restore them`, async () => {
    const h = hookHarness(file, name)
    let request = deferred()
    const load = () => request.promise
    const render = (key = 'A', enabled = true) => h.render(load, key, enabled, (row: unknown) => row)
    render(); h.effects(); await settle()
    request.resolve(result('old')); await settle()
    let state = render()
    assert.deepEqual(visible(state), paged ? ['old'] : 'old')
    const oldLoadMore = state.loadMore
    request = deferred()
    state = render('B')
    assert.deepEqual(visible(state), empty, 'new labels never accompany old values, even before effects')
    assert.equal(state.loading, true)
    if (paged) {
      assert.equal(state.hasMore, false)
      const before = h.writes
      state.loadMore(); oldLoadMore()
      assert.equal(h.writes, before, 'neither the new nor a retained old handler may use the old cursor')
    }
    h.effects(); await settle()
    request.reject(new Error('new scope failed')); await settle()
    state = render('B')
    assert.deepEqual(visible(state), empty)
    assert.equal(state.error, 'new scope failed')
    request = deferred()
    state.reload(); state = render('B')
    assert.equal(state.error, null)
    h.effects(); await settle()
    request.resolve(result('fresh')); await settle()
    state = render('B')
    assert.deepEqual(visible(state), paged ? ['fresh'] : 'fresh')
    request = deferred()
    state.reload(); state = render('B')
    assert.deepEqual(visible(state), empty, 'same-key refresh also revokes exportable values before effects')
    h.effects(); await settle()
    request.reject(new Error('refresh failed')); await settle()
    assert.deepEqual(visible(render('B')), empty)
    h.unmount()
  })

  await asyncTest(`${name}: old success/error is rejected before cleanup, while disabled, and after unmount`, async () => {
    for (const reject of [false, true]) {
      for (const boundary of ['key', 'disabled', 'unmount']) {
        const h = hookHarness(file, name)
        const request = deferred()
        const load = () => request.promise
        const render = (key = 'A', enabled = true) => h.render(load, key, enabled, (row: unknown) => row)
        render(); h.effects(); await settle()
        if (boundary === 'unmount') h.unmount()
        else {
          const state = render(boundary === 'key' ? 'B' : 'A', boundary !== 'disabled')
          assert.deepEqual(visible(state), empty)
          if (boundary === 'disabled') assert.equal(state.loading, false)
        }
        const before = h.writes
        if (reject) request.reject(new Error('obsolete'))
        else request.resolve(result('obsolete'))
        await settle()
        assert.equal(h.writes, before, `${boundary}: obsolete ${reject ? 'error' : 'success'} performs no state writes`)
        h.unmount()
      }
    }
  })

  await asyncTest(`${name}: returning to a prior key or re-enabling never resurrects its old request`, async () => {
    for (const disable of [false, true]) {
      const h = hookHarness(file, name)
      const old = deferred()
      const fresh = deferred()
      let request = old
      const load = () => request.promise
      const render = (key = 'A', enabled = true) => h.render(load, key, enabled, (row: unknown) => row)
      render(); h.effects(); await settle()
      render(disable ? 'A' : 'B', !disable); h.effects()
      request = fresh
      assert.deepEqual(visible(render()), empty)
      h.effects(); await settle()
      fresh.resolve(result('fresh')); await settle()
      assert.deepEqual(visible(render()), paged ? ['fresh'] : 'fresh')
      const before = h.writes
      old.resolve(result('old')); await settle()
      assert.equal(h.writes, before)
      assert.deepEqual(visible(render()), paged ? ['fresh'] : 'fresh')
      h.unmount()
    }
  })
}

await asyncTest('usePagedReport: load-more failure preserves rows/cursor, retry appends, duplicate clicks issue one request', async () => {
  const h = hookHarness('src/components/sales/reports/usePagedReport.ts', 'usePagedReport')
  const requests: ReturnType<typeof deferred>[] = []
  const pages: unknown[] = []
  const load = (page: unknown) => { pages.push(page); const d = deferred(); requests.push(d); return d.promise }
  const render = () => h.render(load, 'A', true, (row: unknown) => row)
  render(); h.effects(); await settle()
  requests[0].resolve({ rows: ['first'], snapshot_max_id: 42, has_more: true, next_cursor: { id: 7 } }); await settle()
  let state = render()
  state.loadMore(); state.loadMore(); await settle()
  assert.equal(requests.length, 2)
  assert.deepEqual(pages[1], { snapshotMaxId: 42, cursor: { id: 7 } })
  assert.deepEqual(render().rows, ['first'])
  requests[1].reject(new Error('page failed')); await settle()
  state = render()
  assert.deepEqual(state.rows, ['first'])
  assert.equal(state.error, 'page failed')
  assert.equal(state.hasMore, true)
  state.loadMore(); await settle()
  assert.deepEqual(pages[2], pages[1], 'retry uses the same snapshot and cursor')
  requests[2].resolve({ rows: ['second'], has_more: false }); await settle()
  state = render()
  assert.deepEqual(state.rows, ['first', 'second'])
  assert.equal(state.hasMore, false)
  assert.equal(state.error, null)
  state.reload(); render(); h.effects(); await settle()
  assert.deepEqual(pages[3], { snapshotMaxId: null, cursor: null }, 'refresh starts a new snapshot')
  h.unmount()
})

if (failed) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nreportsHub: all tests passed')
