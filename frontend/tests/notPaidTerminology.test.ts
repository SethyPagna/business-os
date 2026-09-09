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
  'sale_incident_recovery_status_awaiting_payment',
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
assert.equal(en.on_credit, 'Not Paid to supplier')
assert.equal(km.on_credit, 'មិនទាន់បង់អ្នកផ្គត់ផ្គង់')
assert.equal(en.settlement_credit, 'Store balance')
assert.equal(km.settlement_credit, 'សមតុល្យហាង')
assert.equal(en.ar_overpaid, 'Customer balance')
assert.equal(km.ar_overpaid, 'សមតុល្យអតិថិជន')

const telegramLang = read('../../cloudflare/src/lib/telegramLang.ts')
const telegram = read('../../cloudflare/src/lib/telegram.ts')
assert.match(telegramLang, /credit: \{ en: 'Not Paid', km: 'ប្រាក់ជំពាក់' \}/)
assert.match(telegram, /`Not Paid: \$\{money\(sale\.totalUsd, sale\.totalKhr, ' \/ '\)\}`/)
assert.match(telegram, /labeled\('credit'/, 'the internal Telegram key remains credit')

const reportModel = read('../src/components/sales/reports/reportModel.ts')
assert.match(reportModel, /line\('pending_revenue', 'rpt_pending_credit', 'Not Paid'/)
assert.match(reportModel, /pending_revenue_usd/, 'the accounting field remains unchanged')

const saleDetail = read('../src/components/sales/SaleDetailModal.tsx')
assert.match(saleDetail, /translateOr\('credit_awaiting_payment', 'Not Paid', 'ប្រាក់ជំពាក់'\)/)
assert.match(saleDetail, /awaiting_payment/, 'the internal status remains unchanged')

console.log('PASS Not Paid terminology preserves sale accounting and distinct credit concepts')
