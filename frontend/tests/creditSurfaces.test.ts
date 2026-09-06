// The credit figure is SHOWN, and shown POSITIVE (owner, Sep 6 2026):
//
//   "don't minus for credit amount add into revenue and profit, just note the
//    credit amount is that much so instead of $-n... just $n... so we know no
//    need to remove from profit etc..."
//
// Two defects this pins:
//
//  1. DEAD DATA. Sales.tsx fetched `pending_revenue_usd` from
//     GET /api/sales/stats into component state and then rendered it nowhere.
//     The Sales page footer read `12 sales | $351.00` with no indication that
//     $180 of it was sold on credit -- the one number the owner asked to see.
//     The Dashboard's Revenue card had the same hole: the kernel puts the
//     credit cohort inside revenue_usd and reports it additionally as
//     pending_revenue_usd, and no card named it.
//
//  2. NO CLIENT MIRROR. `saleListRevenueUsd` is the fallback the Sales footer
//     uses when /stats is unavailable, and it mirrors the kernel's SQL
//     fragments. There was no matching mirror for the credit, so the footer
//     could show a revenue and no credit for the very same rows.
//
// The credit is a POSITIVE annotation beside the money, never a minus and
// never a deduction row -- the assertions below fail on a leading '-' or on a
// negated value, in the three files that render it.
//
// Run: node tests/creditSurfaces.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isCreditSale, saleListCreditUsd, saleListRevenueUsd } from '../src/utils/statsFormulas.ts'

let checks = 0
const check = (label: string, cond: boolean) => { assert.ok(cond, label); checks++ }
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// ---- 1. The client mirror of the kernel's awaiting cohort -------------------
// Same rows the convergence fixture uses (cloudflare/scripts/
// test-sales-revenue-convergence-pure.cjs), as GET /api/sales returns them.
const rows = [
  { id: 1, sale_status: 'completed', subtotal_usd: 100, discount_usd: 10, membership_discount_usd: 5, tax_usd: 8, total_usd: 93, refund_usd: 20 },
  { id: 2, sale_status: '', subtotal_usd: 50, discount_usd: 0, membership_discount_usd: 0, tax_usd: 4, total_usd: 54, refund_usd: 0 },
  { id: 3, sale_status: null, subtotal_usd: 40, discount_usd: 5, membership_discount_usd: 0, tax_usd: 0, total_usd: 35, refund_usd: 0 },
  { id: 4, sale_status: 'awaiting_payment', subtotal_usd: 200, discount_usd: 20, membership_discount_usd: 0, tax_usd: 10, total_usd: 190, refund_usd: 30 },
  { id: 5, sale_status: 'cancelled', subtotal_usd: 999, discount_usd: 0, membership_discount_usd: 0, tax_usd: 50, total_usd: 1049, refund_usd: 0 },
  { id: 6, sale_status: 'completed', subtotal_usd: 80, discount_usd: 0, membership_discount_usd: 20, tax_usd: 0, total_usd: 60, refund_usd: 20 },
]

check('isCreditSale picks exactly the awaiting_payment rows', rows.filter(isCreditSale).map((r) => r.id).join(',') === '4')
check('a blank or NULL status is completed, never credit', !isCreditSale(rows[1]) && !isCreditSale(rows[2]))

// The kernel's pending_revenue_usd = netSaleExpr over awaitingExpr rows, with
// NO refund subtraction (cloudflare/src/lib/salesAnalytics.ts, line
// `pending_revenue_usd`). 200 - 20 = 180.
check(`saleListCreditUsd mirrors the kernel's net basis (180), got ${saleListCreditUsd(rows)}`, saleListCreditUsd(rows) === 180)

// POSITIVE CONTROL: the three wrong ways to say it give three other numbers on
// these very rows, so the assertion above is discriminating rather than
// accidentally true.
const wrongTotal = rows.filter(isCreditSale).reduce((s, r) => s + r.total_usd, 0)          // folds tax in
const wrongNetOfRefund = 180 - 30 * (180 / 200)                                            // subtracts the refund
const wrongCollected = 0                                                                    // the "collected" basis drops credit entirely
check(`POSITIVE CONTROL: total_usd would give ${wrongTotal}, not 180`, wrongTotal === 190)
check(`POSITIVE CONTROL: net-of-refund would give ${wrongNetOfRefund}, not 180`, Math.abs(wrongNetOfRefund - 153) < 1e-9)
check('POSITIVE CONTROL: the collected basis would give 0, not 180', wrongCollected === 0)

// It is ALWAYS positive: the owner's "$n, not $-n" rule, at the source.
check('saleListCreditUsd is never negative', saleListCreditUsd(rows) >= 0
  && saleListCreditUsd([{ sale_status: 'awaiting_payment', subtotal_usd: 10, discount_usd: 99, membership_discount_usd: 0 }]) === 0)

// And it is a SUBSET of revenue, never a complement: the credit is inside the
// revenue the same rows produce, so nothing may add or subtract the two.
check('the credit is inside the revenue for the same rows, not beside it',
  saleListRevenueUsd(rows) > saleListCreditUsd(rows) && saleListRevenueUsd(rows) === 351)

// ---- 2. Sales.tsx computes it and hands it to the footer --------------------
const sales = read('../src/components/sales/Sales.tsx')
check('Sales.tsx imports the credit mirror', /import \{[^}]*saleListCreditUsd[^}]*\} from '\.\.\/\.\.\/utils\/statsFormulas'/.test(sales))
check('Sales.tsx prefers the server figure and falls back to the same definition',
  /const creditUsd = salesStats\s*\n?\s*\? salesStats\.pending_revenue_usd\s*\n?\s*: saleListCreditUsd\(filtered\)/.test(sales))
check('Sales.tsx passes the credit to the list surface', /creditUsd=\{creditUsd\}/.test(sales))
check('Sales.tsx never negates the credit', !/-\s*creditUsd/.test(sales) && !/creditUsd\s*\*\s*-1/.test(sales))

// ---- 3. The footer prints it as a positive "Credit $n" ---------------------
const surface = read('../src/components/sales/SalesListSurface.tsx')
check('SalesListSurface accepts the credit figure', /creditUsd: number/.test(surface))
check('the footer shows the credit only when there is one', /creditUsd > 0/.test(surface))
check('the footer labels it with the one credit key', /t\('rpt_pending_credit'\) \|\| 'Credit'/.test(surface))
check('the footer formats it with the page formatter, unnegated', /fmtUSD\(creditUsd\)/.test(surface))
check('the footer never prints a minus in front of the credit',
  !/[-−]\s*\$?\{?\s*fmtUSD\(creditUsd\)/.test(surface) && !/fmtUSD\(-\s*creditUsd\)/.test(surface))
// The doc comment on revenueCount claimed awaiting-payment was excluded from
// the footer count. It never was -- isRevenueCountedSale excludes only
// cancelled -- and the wrong comment is what a reader would have "fixed".
check('the revenueCount contract no longer claims awaiting-payment is excluded',
  !/awaiting-payment\s*\n?\s*\*\s*excluded/.test(surface) && !/cancelled \+ awaiting-payment\s*\n?\s*\*?\s*excluded/.test(surface))

// ---- 4. The Dashboard's Revenue card names the credit inside it -------------
const dashboard = read('../src/components/dashboard/Dashboard.tsx')
check('Dashboard reads the kernel credit figure', /const aCredit = analytics\?\.totals\?\.pending_revenue_usd \|\| 0/.test(dashboard))
check('the Revenue card drill carries a Credit line', /translateOr\('rpt_pending_credit', 'Credit'\), value: fmtUSD\(aCredit\)/.test(dashboard))
check('the Dashboard never negates the credit', !/-\s*aCredit/.test(dashboard) && !/fmtUSD\(-\s*aCredit\)/.test(dashboard))
// It is a memo, not a term: the revenue equation must not gain a credit term,
// or the printed formula would stop footing.
check('the credit is not a term of the printed revenue equation',
  !/key: 'rpt_pending_credit'/.test(read('../src/utils/statsFormulas.ts')))

// ---- 5. The notification row says Credit, in BOTH languages ----------------
// NotificationCenter.tsx has carried a localised ITEM_META_COPY/
// SECTION_SUMMARY_COPY map since it was written, keyed by `metaKey` /
// `summaryKey`. routes/notifications.ts never sent either key, so
// `displayMeta` always fell back to the Worker's raw English and the map was
// unreachable: renaming the label in the map alone would have changed nothing
// on screen, in either language. Both halves are asserted together here,
// because either one alone is a no-op.
const notifications = read('../../cloudflare/src/routes/notifications.ts')
const center = read('../src/components/shared/NotificationCenter.tsx')
check('the Worker no longer labels the credit cohort "Awaiting payment"', !/meta: `Awaiting payment/.test(notifications))
check('the Worker labels it Credit', /meta: `Credit\$\{SUMMARY_SEPARATOR\}/.test(notifications))
check('the Worker sends the localisation key for that row', /metaKey: 'notification_sales_awaiting_payment'/.test(notifications))
check('the Worker sends the params that key renders', /metaParams: \{ totalUsd:/.test(notifications))
check('the Worker sends the section summary key and its counts',
  /summaryKey: 'notification_sales_summary'/.test(notifications)
  && /summaryParams: \{ awaitingPaymentCount:/.test(notifications))
check('the Worker summary text says credit, not awaiting payment',
  /\$\{awaitingPayment\.length\} credit/.test(notifications) && !/awaitingPayment\.length\} awaiting payment/.test(notifications))
check('the key the Worker sends is one the client can actually render',
  /notification_sales_awaiting_payment: \{/.test(center) && /notification_sales_summary: \{/.test(center))
check('the client renders it as Credit in English and ឥណទាន in Khmer',
  /en: \(\{ totalUsd \}\) => `Credit • \$\$\{totalUsd\}`/.test(center)
  && /km: \(\{ totalUsd \}\) => `ឥណទាន • \$\$\{totalUsd\}`/.test(center))
check('the notification amount is never negated', !/-\s*\$\$\{totalUsd\}/.test(center))

console.log(`PASS creditSurfaces: ${checks} checks -- the credit is computed once, shown positive on the Sales footer, the Dashboard revenue card and the notification row`)
