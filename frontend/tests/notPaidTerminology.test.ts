import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>

const saleUnpaidKeys = [
  'awaiting_payment_title',
  'behavior3',
  'stats_profit_hint',
  'notification_sales_alerts_desc',
  'pos_status_awaiting_payment_desc',
  'stats_sales_hint',
  'status_awaiting_payment',
  'summary_awaiting_payment',
  'credit_awaiting_payment',
  'rpt_hint_sales_list',
  'rpt_pending_credit',
  'rpt_profit_hint',
  'rpt_hint_collected',
  'rpt_hint_gross_profit',
  'rpt_hint_delivery_collected',
  'rpt_hint_delivery_net',
  'rpt_pending_block',
  'rpt_pending_gross_sales',
  'rpt_hint_pending_gross',
  'rpt_pending_discounts',
  'rpt_pending_revenue',
  'rpt_hint_pending_revenue',
  'rpt_pending_cogs',
  'rpt_hint_pending_cogs',
  'rpt_pending_delivery_collected',
  'rpt_pending_delivery_paid',
  'rpt_hint_pending_delivery_paid',
  'rpt_pending_profit',
  'rpt_hint_pending_profit',
  'shift_report_hint',
  'shift_credit_hint',
  'sale_not_paid_stock_recovery_status',
  'sale_not_paid_stock_recovery_desc',
  'sale_not_paid_stock_recovery_success',
  'sale_not_paid_stock_recovery_table_label',
  'sale_not_paid_stock_recovery_title',
  'record_kind_sale_stock_corrected',
] as const

for (const key of saleUnpaidKeys) {
  assert.ok(en[key], `en.${key} must be present`)
  assert.ok(km[key], `km.${key} must be present`)
  assert.doesNotMatch(en[key], /\bcredit\b/i, `en.${key} must not expose the superseded Credit wording`)
  assert.doesNotMatch(km[key], /ឥណទាន/, `km.${key} must not expose the superseded Credit wording`)
  assert.match(en[key], /Not Paid/, `en.${key} must use Not Paid`)
  assert.match(km[key], /ប្រាក់ជំពាក់/, `km.${key} must use ប្រាក់ជំពាក់`)
}

assert.equal(en.status_awaiting_payment, '⏳ Not Paid')
assert.equal(km.status_awaiting_payment, '⏳ ប្រាក់ជំពាក់')
assert.equal(en.credit_awaiting_payment, 'Not Paid')
assert.equal(km.credit_awaiting_payment, 'ប្រាក់ជំពាក់')
assert.equal(en.rpt_pending_credit, 'Not Paid')
assert.equal(km.rpt_pending_credit, 'ប្រាក់ជំពាក់')
assert.equal(en.pos_status_awaiting_payment_desc, 'Not Paid — stock deducted')
assert.equal(km.pos_status_awaiting_payment_desc, 'ប្រាក់ជំពាក់ — ស្តុកត្រូវបានកាត់')

// These are different financial concepts, so each keeps a precise visible
// label while the internal wire values remain unchanged. Supplier stock is
// unpaid; a return compensation, store tender balance, and customer
// overpayment are balances rather than another sale status.
assert.equal(en.supplier_credit, 'Supplier balance')
assert.equal(km.supplier_credit, 'សមតុល្យអ្នកផ្គត់ផ្គង់')
assert.equal(en.on_credit, 'Not Yet Paid')
assert.equal(km.on_credit, 'មិនទាន់បង់')
assert.equal(en.settlement_credit, 'Store balance')
assert.equal(km.settlement_credit, 'សមតុល្យហាង')
assert.equal(en.ar_overpaid, 'Customer balance')
assert.equal(km.ar_overpaid, 'សមតុល្យអតិថិជន')

const telegramLang = read('../../cloudflare/src/lib/telegramLang.ts')
const telegram = read('../../cloudflare/src/lib/telegram.ts')
assert.match(telegramLang, /credit: \{ en: 'Not Paid', km: 'ប្រាក់ជំពាក់' \}/)
// UPDATED Sep 23 2026. The unsettled sale's total no longer needs a branch of
// its own to be called Not Paid: the money line is labelled with the sale's
// STATUS, whatever that status is, and `awaiting payment` is spelled Not Paid
// by the status table the line below pins. One rule, every sale.
assert.match(telegram, /\$\{saleStatusMoneyLabel\(status\)\}: \$\{money\(sale\.totalUsd, sale\.totalKhr, ' \/ '\)\}/)
assert.match(telegramLang, /'awaiting payment': \{ en: 'Not Paid', km: 'ប្រាក់ជំពាក់' \}/)
assert.match(telegram, /labeled\('credit'/, 'the internal Telegram key remains credit')

const reportModel = read('../src/components/sales/reports/reportModel.ts')
assert.match(reportModel, /line\('pending_revenue', 'rpt_pending_credit', 'Not Paid'/)
assert.match(reportModel, /pending_revenue_usd/, 'the accounting field remains unchanged')

const saleDetail = read('../src/components/sales/SaleDetailModal.tsx')
assert.match(saleDetail, /translateOr\('credit_awaiting_payment', 'Not Paid', 'ប្រាក់ជំពាក់'\)/)
assert.match(saleDetail, /awaiting_payment/, 'the internal status remains unchanged')


// Sep 22 2026, owner: "status the khmer and english Not Paid / ប្រាក់ជំពាក់ ...
// i see in telegram stil uses the old awaiting payment etc...". The Worker
// keeps its own bilingual table (it has no React language pack at runtime), so
// the only thing that stops the two drifting apart again is this pin: each
// status phrase the Worker rewrites must equal the pack value, emoji aside.
// Only the decorative prefix differs between a pack value and the Worker's --
// the same prefix StatusBadge.tsx drops for its compact badge. The words
// themselves must match exactly, Khmer combining marks and all.
const packStatus = (value: string): string => value.replace(/^[⏳🚚↩️\s]+/u, '').trim()
const workerStatusPhrases: Array<[phrase: string, key: string]> = [
  ['awaiting payment', 'status_awaiting_payment'],
  ['awaiting delivery', 'status_awaiting_delivery'],
  ['partial return', 'status_partial_return'],
  ['completed', 'status_completed'],
  ['cancelled', 'status_cancelled'],
  ['returned', 'status_returned'],
]
for (const [phrase, key] of workerStatusPhrases) {
  const quoted = /^[a-z]+$/.test(phrase) ? phrase : `'${phrase}'`
  const entry = new RegExp(`\\n\\s*${quoted}: \\{ en: '([^']+)', km: '([^']+)' \\}`).exec(telegramLang)
  assert.ok(entry, `telegramLang has no bilingual value phrase for "${phrase}"`)
  assert.equal(entry![1], packStatus(en[key]), `the Worker's English for "${phrase}" must be en.${key}`)
  assert.equal(entry![2], packStatus(km[key]), `the Worker's Khmer for "${phrase}" must be km.${key}`)
}
// The retired wording must not come back through the Worker table either.
assert.doesNotMatch(telegramLang, /'Awaiting Payment'/, 'the Worker must not reintroduce Awaiting Payment')
assert.doesNotMatch(telegramLang, /កំពុងរង់ចាំបង់ប្រាក់/, 'the Worker must not reintroduce the long retired Khmer status')

// The receipt-status notification is composed by a named builder in telegram.ts,
// not inline in the route, so the status words above reach it through one path.
assert.match(telegram, /export function formatSaleStatusTelegramLines/, 'the status-change message has a testable builder')
const salesRoute = read('../../cloudflare/src/routes/sales.ts')
assert.match(salesRoute, /formatSaleStatusTelegramLines\(/, 'the sales route calls the builder')
assert.doesNotMatch(salesRoute, /Status: \$\{oldStatus/, 'the route must not compose the status line itself again')

// The in-app surfaces that name the same status. Each of these carried a second
// copy of the words; a hard-coded fallback is how the retired name survives a
// rename, because it only shows when a pack lookup misses.
// Comments are allowed to name the retired wording -- that is how the rename is
// explained to the next reader; only shipping code is checked.
const code = (source: string): string => source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
// Positive controls, so neither filter can pass this file by deleting the
// evidence instead of by the wording being right.
assert.equal(packStatus(en.status_awaiting_payment), 'Not Paid')
assert.match(code('// awaiting payment\nconst live = 1'), /const live = 1/)
assert.doesNotMatch(code('// awaiting payment\nconst live = 1'), /awaiting/)
// The retired wording, in every spelling it was found in and in either case.
// `/awaiting payment/` alone missed "Awaiting payment" -- the capitalised
// form is what the Worker and three components actually shipped -- and the
// Khmer had drifted into THREE different phrasings, none of them the packs'.
const RETIRED_STATUS_WORDING = /awaiting payment|កំពុងរង់ចាំបង់ប្រាក់|កំពុងរង់ចាំការទូទាត់|រង់ចាំបង់ប្រាក់/i
// Discriminating control: the pattern must catch BOTH cases and a Khmer
// spelling, and must not fire on the wording that replaced them.
// The snake_case wire value `awaiting_payment` is a database enum, not copy,
// so only the spaced prose counts as the retired wording.
assert.doesNotMatch('sale_status = awaiting_payment', RETIRED_STATUS_WORDING)
assert.match('2 awaiting payment', RETIRED_STATUS_WORDING)
assert.match('Awaiting payment - $12.00', RETIRED_STATUS_WORDING)
assert.match('រង់ចាំបង់ប្រាក់ • $12.00', RETIRED_STATUS_WORDING)
assert.doesNotMatch('Not Paid / ប្រាក់ជំពាក់', RETIRED_STATUS_WORDING)

const notificationCenter = read('../src/components/shared/NotificationCenter.tsx')
assert.doesNotMatch(code(notificationCenter), RETIRED_STATUS_WORDING, 'the bell must not hard-code the retired status wording')
assert.match(notificationCenter, /getStatusBadgeLabel\('awaiting_payment', t\)/, 'the bell summary reads the status name from the language packs')

// The bell text the shop actually sees is composed by the WORKER, not by the
// component's copy tables -- those tables were unreachable until this route
// started naming them, which is why a fix inside NotificationCenter.tsx alone
// changed nothing on screen. The English strings beside the keys stay as the
// fallback for a client running an older cached bundle, so they are not a
// violation; what is required is that the keys ship next to them.
const notificationsRoute = read('../../cloudflare/src/routes/notifications.ts')
assert.match(notificationsRoute, /summaryKey: 'notification_sales_summary'/, 'the sales section names its localized summary copy')
assert.match(notificationsRoute, /metaKey: 'notification_sales_awaiting_payment'/, 'the Not Paid rows name their localized meta copy')
assert.match(notificationsRoute, /metaKey: 'notification_sales_awaiting_delivery'/, 'the awaiting-delivery rows name theirs too')
assert.doesNotMatch(notificationsRoute, /កំពុងរង់ចាំបង់ប្រាក់|កំពុងរង់ចាំការទូទាត់|រង់ចាំបង់ប្រាក់/, 'the route must not carry Khmer status copy of its own')

// THE ENGLISH SIDE, which this guard could not check until Sep 23 2026: it
// only looked for Khmer here, because the English "Awaiting payment" in this
// file is DELIBERATE -- it is what a client running an older cached bundle
// renders when it does not recognise the localized key beside it. Deleting it
// would break that client; leaving the guard silent lets the wording spread.
//
// So: count the occurrences and pin each one to its key. Two lines carry the
// retired wording, and each sits in a block that also names a metaKey or a
// summaryKey. A third one, or one of these two losing its key, is drift.
const routeCodeLines = code(notificationsRoute).split('\n')
const retiredInRoute = routeCodeLines
  .map((line, index) => ({ line: line.trim(), index }))
  .filter(({ line }) => RETIRED_STATUS_WORDING.test(line))
assert.equal(retiredInRoute.length, 2,
  `notifications.ts may carry the retired wording ONLY on its two stale-client fallbacks, found ${retiredInRoute.length}:\n  ${retiredInRoute.map(({ line, index }) => `${index + 1}: ${line}`).join('\n  ')}`)
for (const { line, index } of retiredInRoute) {
  assert.match(routeCodeLines.slice(index, index + 6).join('\n'), /(metaKey|summaryKey): '/,
    `the retired wording on this line is not a fallback beside a localized key, so it is what the shop reads: ${line}`)
}
// It must be exactly the two the panel localizes -- the item meta and the
// section summary -- and not, say, two copies of the same one.
assert.match(retiredInRoute[0].line, /^meta: /, retiredInRoute[0].line)
assert.match(retiredInRoute[1].line, /^awaitingPayment\.length \?/, retiredInRoute[1].line)
// DISCRIMINATING CONTROL: the same predicate, run over the same source with
// one extra drifted line spliced in far from any key, must reject it -- a
// count that cannot fail is not a guard.
{
  const drifted = routeCodeLines.slice()
  drifted.splice(5, 0, "  const heading = 'Awaiting payment'")
  const found = drifted.filter((line) => RETIRED_STATUS_WORDING.test(line))
  assert.equal(found.length, 3, 'the control line was not seen by the pattern at all')
  assert.match(drifted.slice(5, 11).join('\n'), /^(?!.*(metaKey|summaryKey): ')[\s\S]*$/,
    'the control line must NOT be near a key, or it would pass for the wrong reason')
}
const dashboardStatus = read('../src/components/dashboard/dashboardSaleStatus.ts')
assert.match(dashboardStatus, /awaiting_payment: \{ key: 'status_awaiting_payment', fallback: 'Not Paid' \}/)
const pos = read('../src/components/pos/POS.tsx')
assert.match(pos, /awaiting_payment: 'Not Paid'/, 'the POS status fallback uses the current name')
for (const [file, source] of [
  ['dashboardSaleStatus.ts', dashboardStatus],
  ['POS.tsx', pos],
  ['SaleNotPaidStockRecovery.tsx', read('../src/components/utils-settings/SaleNotPaidStockRecovery.tsx')],
] as const) {
  assert.doesNotMatch(source, /'Awaiting [Pp]ayment'/, `${file} still ships a retired Awaiting Payment fallback`)
}

console.log('PASS Not Paid terminology preserves sale accounting and distinct credit concepts')
