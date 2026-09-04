import { getDb } from './db'
import { BUSINESS_UTC_OFFSET_MINUTES, businessToday, localDateRangeClause } from './businessDateWindow'
import {
  bi, label, labeled, localizeTelegramHeading, localizeTelegramLine, localizeTelegramValue,
  parseReportDate, telegramCommandReference, telegramUnauthorizedReply,
} from './telegramLang'
import {
  getDeliveryContactTotals, getItemDiscountUsd, getPaymentMethodBreakdown, getSalesTotals,
  shiftWindowWhere, type SalesFilters,
} from './salesAnalytics'
import type { Env } from '../index'

export type TelegramEventType = 'sales' | 'status' | 'fees' | 'stock_in' | 'stock_out'
// `heading` lets a route name the event (a return is not a sale, a transfer
// is not a plain stock-out) while `type` stays the user's enable switch.
export type TelegramEvent = { type: TelegramEventType; lines: string[]; heading?: string }

type TelegramConfig = {
  enabled: boolean; chatId: string; chatIds: string[]; token: string
  categories: Record<TelegramEventType, boolean>
}
type TelegramMessage = { text?: string; from?: { id?: number | string }; chat?: { id?: number | string } }
type TelegramUpdate = { message?: TelegramMessage }

// sql-bound-params: bounded by construction -- this fixed seven-key enum is
// owned by this module and never grows from request or database input.
const SETTING_KEYS = [
  'telegram_automation_enabled', 'telegram_chat_id',
  'telegram_sales_enabled', 'telegram_status_enabled', 'telegram_fees_enabled', 'telegram_stock_in_enabled', 'telegram_stock_out_enabled',
] as const

function isEnabled(value: string | undefined, fallback: boolean): boolean {
  return value == null || value === '' ? fallback : String(value).trim().toLowerCase() !== 'false'
}
function cleanLine(value: unknown, max = 300): string {
  return String(value ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
}
// Money formatters, kept together with money() below so a new message cannot
// grow a third way of printing a dollar amount.
const round2 = (value: number) => Math.round(value * 100) / 100
const usd = (value: unknown) => `$${round2(Number(value) || 0).toFixed(2)}`
function money(usd: unknown, khr: unknown): string {
  const usdValue = Number(usd) || 0; const khrValue = Number(khr) || 0; const parts: string[] = []
  if (usdValue) parts.push(`$${usdValue.toFixed(2)}`)
  if (khrValue) parts.push(`${Math.round(khrValue).toLocaleString()}៛`)
  return parts.length ? parts.join(' · ') : '$0.00'
}

// The alerts chat id setting doubles as the COMMAND ALLOW-LIST. A Telegram
// chat id is digits with an optional leading '-', so a comma/space separated
// list is unambiguous and an existing single-id setting keeps working
// untouched -- no new setting, no Settings-screen change, and the owner can
// approve a second manager group by typing one more id.
function parseChatIds(value: string | undefined): string[] {
  return String(value || '').split(/[,;\s]+/).map((entry) => cleanLine(entry, 40)).filter((entry) => /^-?\d+$/.test(entry))
}

async function getTelegramConfig(env: Env): Promise<TelegramConfig> {
  const rows = await getDb(env).prepare(`SELECT key, value FROM settings WHERE key IN (${SETTING_KEYS.map(() => '?').join(',')})`).all<{ key: string; value: string }>([...SETTING_KEYS])
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<string, string>
  const chatIds = parseChatIds(values.telegram_chat_id)
  return {
    enabled: isEnabled(values.telegram_automation_enabled, true),
    // chatId is where ALERTS are pushed (the first id); chatIds is who may ASK.
    chatId: chatIds[0] || '', chatIds,
    token: String(env.TELEGRAM_BOT_TOKEN || '').trim(),
    // Everything is live after the first setup; individual category switches
    // remain available when a less noisy chat is preferred.
    categories: {
      sales: isEnabled(values.telegram_sales_enabled, true), status: isEnabled(values.telegram_status_enabled, true),
      fees: isEnabled(values.telegram_fees_enabled, true), stock_in: isEnabled(values.telegram_stock_in_enabled, true), stock_out: isEnabled(values.telegram_stock_out_enabled, true),
    },
  }
}

function configurationProblem(config: TelegramConfig): string | null {
  if (!config.token) return 'Telegram bot token is not configured on this Worker.'
  if (!config.chatId) return 'Enter the Telegram alerts chat ID in Settings.'
  return null
}
function commandProblem(config: TelegramConfig): string | null {
  return configurationProblem(config)
}
async function postTelegram(config: TelegramConfig, text: string, chatId = config.chatId): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096), disable_web_page_preview: true }),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Telegram rejected the message (${response.status})${body ? `: ${body.slice(0, 160)}` : ''}`)
  }
}

export async function sendTelegramEvent(env: Env, event: TelegramEvent): Promise<boolean> {
  const config = await getTelegramConfig(env)
  if (!config.enabled || !config.categories[event.type] || configurationProblem(config)) return false
  const heading: Record<TelegramEventType, string> = { sales: '🛍️ Sale recorded', status: '🧾 Receipt status updated', fees: '💸 Fee recorded', stock_in: '📥 Stock in', stock_out: '📤 Stock out' }
  // S4-8: the ONE place every event message becomes bilingual. Doing it on
  // the composed line (rather than in each builder) means the two routes that
  // still assemble their lines inline -- routes/sales.ts's status change and
  // routes/fees.ts's fee -- are covered without editing files other lanes own,
  // and any line added later is covered the moment its label is in the table.
  await postTelegram(config, [
    localizeTelegramHeading(event.heading || heading[event.type]),
    ...event.lines.map((line) => localizeTelegramLine(cleanLine(line, 400))),
  ].filter(Boolean).join('\n'))
  return true
}

export async function getTelegramStatus(env: Env): Promise<{ configured: boolean; connected: boolean; enabled: boolean }> {
  const config = await getTelegramConfig(env)
  return { configured: Boolean(config.token), connected: !configurationProblem(config), enabled: config.enabled }
}
export async function sendTelegramTest(env: Env): Promise<void> {
  const config = await getTelegramConfig(env); const problem = configurationProblem(config)
  if (problem) throw new Error(problem)
  await postTelegram(config, [
    `✅ ${bi('Business OS alerts and commands are connected.', 'ការជូនដំណឹង និងពាក្យបញ្ជា Business OS បានភ្ជាប់រួចរាល់។')}`,
    bi('Every notification category is on by default; turn any off in Settings.', 'គ្រប់ប្រភេទការជូនដំណឹងបើកតាមលំនាំដើម។ អ្នកអាចបិទណាមួយនៅ Settings។'),
    '',
    telegramCommandReference(),
  ].join('\n'))
  await configureTelegramWebhook(env)
}

// ---- Reports (S4-9) --------------------------------------------------------
// Every report is bilingual and every report takes a DAY. `/report 09/01/2026`
// answering only for "today" was the gap: the shop asks about yesterday's till
// far more often than about the current one.

/** One business day (UTC+7) of a UTC timestamp column, as a bound clause. */
const dayClause = (column: string): string => localDateRangeClause(column, '@date', '@date')

type MoneyBucket = { count: number; usd: number; khr: number } | null | undefined
type UnitBucket = { count: number; quantity: number } | null | undefined
type DayStats = { date: string; sales: MoneyBucket; fees: MoneyBucket; stockIn: UnitBucket; stockOut: UnitBucket }
type CashierRow = { cashier: string; count: number; usd: number; khr: number }

async function dayStats(env: Env, date: string): Promise<DayStats> {
  const db = getDb(env)
  const [sales, fees, stockIn, stockOut] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total_usd), 0) AS usd, COALESCE(SUM(total_khr), 0) AS khr FROM sales WHERE ${dayClause('created_at')}`).get<{ count: number; usd: number; khr: number }>({ date }),
    db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_khr), 0) AS khr FROM fees WHERE fee_date = @date').get<{ count: number; usd: number; khr: number }>({ date }),
    db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS quantity FROM inventory_movements WHERE movement_type IN ('add', 'transfer_in', 'move_in') AND ${dayClause('created_at')}`).get<{ count: number; quantity: number }>({ date }),
    db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS quantity FROM inventory_movements WHERE movement_type IN ('remove', 'transfer_out', 'move_out') AND ${dayClause('created_at')}`).get<{ count: number; quantity: number }>({ date }),
  ])
  return { date, sales, fees, stockIn, stockOut }
}

// "cashier user" in the ask: who rang up how much, on that day.
async function cashierTotals(env: Env, date: string): Promise<CashierRow[]> {
  return getDb(env).prepare(`SELECT COALESCE(NULLIF(TRIM(cashier_name), ''), 'Unknown') AS cashier,
      COUNT(*) AS count, COALESCE(SUM(total_usd), 0) AS usd, COALESCE(SUM(total_khr), 0) AS khr
    FROM sales WHERE ${dayClause('created_at')}
    GROUP BY 1 ORDER BY usd DESC, count DESC LIMIT 12`).all<CashierRow>({ date })
}

/**
 * `YYYY-MM-DD` -> `dd/mm/yyyy`. The project pins dd/mm/yyyy + 24-hour
 * everywhere (consistency-audit.md; formatBusinessDateTime above), so a report
 * header must not invent a second date shape.
 */
export function formatBusinessDay(isoDate: string): string {
  const parts = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return parts ? `${parts[3]}/${parts[2]}/${parts[1]}` : String(isoDate || '')
}

const reportTitle = (icon: string, en: string, km: string, date?: string): string =>
  `${icon} ${bi(en, km)}${date ? ` — ${formatBusinessDay(date)}` : ''}`

const counted = (count: unknown, noun: 'receipt(s)' | 'record(s)' | 'movement(s)' | 'unit(s)' | 'product(s)'): string =>
  localizeTelegramValue(`${Number(count) || 0} ${noun}`)

function formatDaySummary(stats: DayStats, cashiers: CashierRow[], categories?: Partial<Record<TelegramEventType, boolean>>): string {
  const lines = [reportTitle('📊', 'Business summary', 'សង្ខេបអាជីវកម្ម', stats.date)]
  if (categories?.sales !== false) lines.push(labeled('sales', `${counted(stats.sales?.count, 'receipt(s)')} · ${money(stats.sales?.usd, stats.sales?.khr)}`))
  if (categories?.fees !== false) lines.push(labeled('fees', `${counted(stats.fees?.count, 'record(s)')} · ${money(stats.fees?.usd, stats.fees?.khr)}`))
  if (categories?.stock_in !== false) lines.push(labeled('stockIn', `${counted(stats.stockIn?.count, 'movement(s)')} · ${counted(stats.stockIn?.quantity, 'unit(s)')}`))
  if (categories?.stock_out !== false) lines.push(labeled('stockOut', `${counted(stats.stockOut?.count, 'movement(s)')} · ${counted(stats.stockOut?.quantity, 'unit(s)')}`))
  if (cashiers.length) {
    lines.push('', `${label('cashiers')}:`)
    for (const row of cashiers) lines.push(`• ${cleanLine(row.cashier, 60)} — ${counted(row.count, 'receipt(s)')} · ${money(row.usd, row.khr)}`)
  }
  return lines.join('\n')
}

export async function sendTelegramTodaySummary(env: Env): Promise<void> {
  const config = await getTelegramConfig(env); const problem = configurationProblem(config)
  if (problem) throw new Error(problem)
  const today = businessToday()
  await postTelegram(config, formatDaySummary(await dayStats(env, today), await cashierTotals(env, today), config.categories))
}

async function dayReport(env: Env, date: string): Promise<string> {
  const [stats, cashiers] = await Promise.all([dayStats(env, date), cashierTotals(env, date)])
  return formatDaySummary(stats, cashiers)
}

async function salesReport(env: Env, date: string): Promise<string> {
  const db = getDb(env); const stats = await dayStats(env, date)
  const sales = await db.prepare(`SELECT id, receipt_number, cashier_name, total_usd, total_khr FROM sales WHERE ${dayClause('created_at')} ORDER BY created_at DESC LIMIT 5`).all<{ id: number; receipt_number: string | null; cashier_name: string | null; total_usd: number; total_khr: number }>({ date })
  const title = reportTitle('🛍️', 'Sales', 'ការលក់', date)
  if (!sales.length) return `${title}\n${bi('No sales recorded on this day.', 'គ្មានការលក់បានកត់ត្រាក្នុងថ្ងៃនេះទេ។')}`
  const ids = sales.map((sale) => sale.id)
  const items = await db.prepare(`SELECT sale_id, product_name, quantity, applied_price_usd, applied_price_khr FROM sale_items WHERE sale_id IN (${ids.map(() => '?').join(',')}) ORDER BY id ASC`).all<{ sale_id: number; product_name: string | null; quantity: number; applied_price_usd: number; applied_price_khr: number }>(ids)
  const bySale = new Map<number, typeof items>(); for (const item of items) bySale.set(item.sale_id, [...(bySale.get(item.sale_id) || []), item])
  const lines = [title, labeled('total', `${counted(stats.sales?.count, 'receipt(s)')} · ${money(stats.sales?.usd, stats.sales?.khr)}`), '', `${label('latestReceipts')}:`]
  for (const sale of sales) {
    lines.push(`• ${sale.receipt_number || `#${sale.id}`} · ${money(sale.total_usd, sale.total_khr)} · ${localizeTelegramValue(cleanLine(sale.cashier_name || 'No cashier'))}`)
    const saleItems = bySale.get(sale.id) || []
    for (const item of saleItems.slice(0, 4)) lines.push(`   ${Number(item.quantity)} × ${cleanLine(item.product_name || 'Item', 100)} — ${money(item.applied_price_usd, item.applied_price_khr)}`)
    if (saleItems.length > 4) lines.push(`   + ${saleItems.length - 4} more ${localizeTelegramValue('item(s)')}`)
  }
  return lines.join('\n')
}

async function feesReport(env: Env, date: string): Promise<string> {
  const db = getDb(env); const stats = await dayStats(env, date)
  const fees = await db.prepare('SELECT fee_type, label, amount_usd, amount_khr FROM fees WHERE fee_date = @date ORDER BY id DESC LIMIT 8').all<{ fee_type: string; label: string | null; amount_usd: number; amount_khr: number }>({ date })
  const lines = [reportTitle('💸', 'Expenses', 'ចំណាយ', date), labeled('total', `${counted(stats.fees?.count, 'record(s)')} · ${money(stats.fees?.usd, stats.fees?.khr)}`)]
  if (!fees.length) lines.push(bi('No expense recorded on this day.', 'គ្មានចំណាយបានកត់ត្រាក្នុងថ្ងៃនេះទេ។'))
  for (const fee of fees) lines.push(`• ${cleanLine(fee.fee_type)}${fee.label ? ` — ${cleanLine(fee.label, 90)}` : ''}: ${money(fee.amount_usd, fee.amount_khr)}`)
  return lines.join('\n')
}

async function inventoryReport(env: Env): Promise<string> {
  const db = getDb(env)
  const rows = await db.prepare(`SELECT name, stock_quantity, low_stock_threshold, out_of_stock_threshold FROM products WHERE is_active = 1 AND COALESCE(stock_quantity, 0) <= COALESCE(low_stock_threshold, 10) ORDER BY COALESCE(stock_quantity, 0) ASC, name ASC LIMIT 12`).all<{ name: string; stock_quantity: number; low_stock_threshold: number; out_of_stock_threshold: number }>()
  const title = reportTitle('📦', 'Low stock', 'ស្តុកទាប')
  if (!rows.length) return `${title}\n${bi('No active product is at or below its alert level.', 'គ្មានផលិតផលសកម្មណាមួយស្តុកទាបទេ។')}`
  const lines = [title, labeled('products', rows.length)]
  for (const row of rows) {
    const out = Number(row.stock_quantity || 0) <= Number(row.out_of_stock_threshold || 0)
    lines.push(`• ${out ? bi('OUT', 'អស់ស្តុក') : bi('LOW', 'ស្តុកទាប')} — ${cleanLine(row.name, 120)} — ${Number(row.stock_quantity || 0)} (⚠ ${Number(row.low_stock_threshold || 10)})`)
  }
  return lines.join('\n')
}

async function inventorySummaryReport(env: Env): Promise<string> {
  const row = await getDb(env).prepare(`SELECT
    COUNT(*) AS products,
    COALESCE(SUM(stock_quantity), 0) AS units,
    COALESCE(SUM(CASE WHEN COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0) THEN 1 ELSE 0 END), 0) AS out_of_stock,
    COALESCE(SUM(CASE WHEN COALESCE(stock_quantity, 0) > COALESCE(out_of_stock_threshold, 0) AND COALESCE(stock_quantity, 0) <= COALESCE(low_stock_threshold, 10) THEN 1 ELSE 0 END), 0) AS low_stock
    FROM products WHERE is_active = 1`).get<{ products: number; units: number; out_of_stock: number; low_stock: number }>()
  return [
    reportTitle('🏷️', 'Inventory', 'ស្តុក'),
    labeled('activeProducts', Number(row?.products || 0).toLocaleString()),
    labeled('unitsOnHand', Number(row?.units || 0).toLocaleString()),
    `${label('lowStock')}: ${Number(row?.low_stock || 0)} · ${label('outOfStock')}: ${Number(row?.out_of_stock || 0)}`,
    `▸ /stock — ${bi('the product list', 'បញ្ជីផលិតផល')}`,
  ].join('\n')
}

// ---- Shift report (S4-7) ---------------------------------------------------
//
// The owner's line set, in the owner's order: shop name, cashier, from/to,
// invoice counts (total / cancelled / edited), revenue, item discount,
// invoice discount, gross sale, credit, other expense, registered cash,
// final amount, then the payment-method and delivery-service breakdowns.
//
// WHAT A SHIFT IS SCOPED TO. One employee, one branch, one business day --
// the key of migration 0116's `shift_sessions`, and the board's own words for
// S4-10 ("the shift report covers whichever user is signed in"). So every
// figure below is scoped to that cashier's own receipts inside the window
// between the minute they registered the float and the minute they counted
// it. A shift whose branch_id is NULL (a single-branch till, the common shop
// here) is not narrowed by branch, because there is only one; the cashier
// scope still holds it to that employee's takings.
//
// WHY IT GOES THROUGH THE SALES KERNEL. Revenue has exactly one definition in
// this system -- net sales, over recognized (neither cancelled nor
// awaiting_payment) receipts, minus customer refunds, tax and delivery
// excluded. A shift report that summed `total_usd` itself would be a second,
// quietly different revenue on a surface the owner reads every evening. So it
// calls getSalesTotals/getPaymentMethodBreakdown/getDeliveryContactTotals
// with the shift window as a filter and formats what comes back.
//
// THE TWO FIGURES THAT ARE JUDGEMENT CALLS, named here rather than buried:
//
//   * "Deleted" is reported as CANCELLED. Nothing deletes a sale in this
//     system (see telegramLang.ts's `cancelled` entry), so the count the
//     owner asked for is the count of voided receipts, under the app's own
//     word for them.
//
//   * "Final amount" is what should be IN THE DRAWER at the end:
//     registered cash + money actually collected - other expense. Collected
//     is the kernel's collected_total (revenue + tax + customer-paid
//     delivery), because tax and a delivery fee the customer handed over are
//     physically in the till even though neither is revenue. Credit is NOT
//     subtracted: unpaid credit was never collected, so it is never in the
//     revenue figure to begin with, and subtracting it would count it twice.
//     The two components are printed under the total so the arithmetic can be
//     checked without opening the app.
//
// Riel is never folded into dollars anywhere here -- the drawer holds both and
// the shop counts them separately, the same convention migration 0116 and
// every fee surface already follow.

export type ShiftReportSession = {
  shift_code: string
  user_id: number
  user_name: string | null
  branch_id: number | null
  branch_name: string | null
  business_date: string
  opened_at: string
  opening_float_usd: number
  opening_float_khr: number
  closed_at: string | null
  closing_counted_usd: number | null
  closing_counted_khr: number | null
}

export type ShiftReportFigures = {
  invoices: number
  cancelled: number
  edited: number
  revenueUsd: number
  itemDiscountUsd: number
  invoiceDiscountUsd: number
  grossSaleUsd: number
  creditUsd: number
  otherExpenseUsd: number
  otherExpenseKhr: number
  collectedUsd: number
  paymentMethods: { method: string; count: number; collectedUsd: number }[]
  deliveryServices: { name: string; deliveries: number; chargedUsd: number }[]
}

/**
 * The whole message, pure -- no D1, no clock beyond the `nowMs` an open shift
 * needs for its "to" bound. scripts/test-shift-report-pure.cjs drives it
 * directly, so the shape and the arithmetic are pinned without a database.
 */
export function formatShiftReport(shopName: string, shift: ShiftReportSession, figures: ShiftReportFigures, nowMs: number = Date.now()): string {
  const open = !shift.closed_at
  const lines = [
    reportTitle('🧑‍💼', 'Shift', 'វេន', shift.business_date),
    labeled('shop', cleanLine(shopName || 'Business OS', 80)),
    labeled('cashier', localizeTelegramValue(cleanLine(shift.user_name || 'No cashier', 60))),
  ]
  if (shift.branch_name) lines.push(labeled('branch', cleanLine(shift.branch_name, 60)))
  lines.push(
    labeled('shift', cleanLine(shift.shift_code, 40)),
    labeled('from', formatBusinessDateTime(shift.opened_at, nowMs)),
    // An open shift reports up to NOW and says so, rather than printing a
    // closing time that has not happened. A shift left running overnight is
    // the honest record -- migration 0116 refuses to close one on a timer --
    // so the report has to be able to render one.
    open
      ? `${label('to')}: ${formatBusinessDateTime(new Date(nowMs).toISOString(), nowMs)} — ${bi('still open', 'នៅបើកនៅឡើយ')}`
      : labeled('to', formatBusinessDateTime(shift.closed_at, nowMs)),
    '',
    // Bare numbers, not `counted(...)`: the label IS the noun here, so
    // "Invoices / វិក្កយបត្រ: 12 receipt(s) / វិក្កយបត្រ" would print the same
    // Khmer word twice on one line. The breakdown bullets further down keep
    // the counted noun, because those lines carry no label.
    labeled('invoices', figures.invoices),
    labeled('cancelled', figures.cancelled),
    labeled('edited', figures.edited),
    '',
    labeled('revenue', usd(figures.revenueUsd)),
    labeled('itemDiscount', usd(figures.itemDiscountUsd)),
    labeled('invoiceDiscount', usd(figures.invoiceDiscountUsd)),
    labeled('grossSale', usd(figures.grossSaleUsd)),
    labeled('credit', usd(figures.creditUsd)),
    labeled('otherExpense', money(figures.otherExpenseUsd, figures.otherExpenseKhr)),
    labeled('registeredCash', money(shift.opening_float_usd, shift.opening_float_khr)),
  )

  // What should be in the drawer. Printed with its two moving parts under it,
  // so the number can be checked against the lines above without arithmetic
  // in the reader's head, and so a disagreement points at a component rather
  // than at "the report is wrong".
  const floatUsd = Number(shift.opening_float_usd) || 0
  const expenseUsd = Number(figures.otherExpenseUsd) || 0
  const finalUsd = floatUsd + (Number(figures.collectedUsd) || 0) - expenseUsd
  lines.push(
    labeled('finalAmount', usd(finalUsd)),
    `     ${usd(floatUsd)} + ${usd(figures.collectedUsd)} − ${usd(expenseUsd)}`,
    // A line each, not a ` / ` pair: this caption is a phrase long enough that
    // joining the two languages wraps into a mush at phone width -- the same
    // rule telegramLang.ts's command reference follows for its sentences.
    '     registered cash + collected − expense',
    '     សាច់ប្រាក់ចុះបញ្ជី + ប្រាក់ទទួល − ចំណាយ',
  )

  // The closing count only exists once the employee has ended the shift by
  // hand, so an open shift shows neither it nor a difference against it --
  // printing "Difference: -$256.00" for a shift still in progress would read
  // as a missing-cash alarm on every open till.
  if (!open) {
    lines.push(labeled('cashCounted', money(shift.closing_counted_usd, shift.closing_counted_khr)))
    const countedUsd = Number(shift.closing_counted_usd) || 0
    const difference = Math.round((countedUsd - finalUsd) * 100) / 100
    // Sign in FRONT of the currency symbol: `$-3.00` reads as a price.
    const sign = difference < 0 ? '−' : difference > 0 ? '+' : ''
    lines.push(labeled('difference', `${sign}${usd(Math.abs(difference))}`))
  }

  if (figures.paymentMethods.length) {
    lines.push('', `${label('paymentMethod')}:`)
    for (const row of figures.paymentMethods) {
      lines.push(`• ${localizeTelegramValue(cleanLine(row.method, 40))} — ${counted(row.count, 'receipt(s)')} · ${usd(row.collectedUsd)}`)
    }
  }
  if (figures.deliveryServices.length) {
    lines.push('', `${label('deliveryService')}:`)
    for (const row of figures.deliveryServices) {
      lines.push(`• ${localizeTelegramValue(cleanLine(row.name, 60))} — ${row.deliveries} · ${usd(row.chargedUsd)}`)
    }
  }
  return lines.join('\n')
}

const SHIFT_COLUMNS = `shift_code, user_id, user_name, branch_id, branch_name, business_date,
  opened_at, opening_float_usd, opening_float_khr,
  closed_at, closing_counted_usd, closing_counted_khr`

/** The filter that turns "this shift" into a query the sales kernel accepts. */
function shiftFilters(shift: ShiftReportSession, nowMs: number): SalesFilters {
  return {
    createdFrom: shift.opened_at,
    // An open shift is reported up to now. shiftWindowBound normalises both.
    createdTo: shift.closed_at || new Date(nowMs).toISOString(),
    cashierId: shift.user_id,
    // Falsy (null) branch is not a filter -- see the section comment.
    branchId: shift.branch_id ?? null,
  }
}

/**
 * Invoice counts. Deliberately NOT through getSalesTotals: the kernel's
 * default guard hides cancelled sales, and "how many receipts were voided" is
 * one of the three counts the owner asked for. It reuses shiftWindowWhere()
 * so the window is the same window, half-open and all.
 *
 * "Edited" is the existence of a `sale_amendments` row (migration 0115) --
 * the append-only ledger IS the record of an edit, so this cannot drift from
 * what the sale-detail sheet shows. EXISTS rather than a join, so a sale
 * amended four times counts once.
 */
async function shiftInvoiceCounts(env: Env, shift: ShiftReportSession, nowMs: number) {
  const filters = shiftFilters(shift, nowMs)
  const { clauses, params } = shiftWindowWhere('sales', filters)
  if (shift.branch_id) {
    clauses.push('sales.branch_id = @branchId')
    params.branchId = shift.branch_id
  }
  const row = await getDb(env).prepare(`
    SELECT COUNT(*) AS invoices,
           COALESCE(SUM(CASE WHEN COALESCE(NULLIF(sales.sale_status, ''), 'completed') = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled,
           COALESCE(SUM(CASE WHEN EXISTS (SELECT 1 FROM sale_amendments a WHERE a.sale_id = sales.id) THEN 1 ELSE 0 END), 0) AS edited
    FROM sales
    WHERE ${clauses.join(' AND ')}
  `).get<{ invoices: number; cancelled: number; edited: number }>(params)
  return { invoices: Number(row?.invoices || 0), cancelled: Number(row?.cancelled || 0), edited: Number(row?.edited || 0) }
}

/**
 * Expenses paid out of THIS drawer: recorded inside the window by the same
 * employee. `created_at` is the moment the record was written and shares
 * sales' timestamp shape; `fee_date` is a bare day and could not tell two
 * shifts on one date apart.
 */
async function shiftExpenses(env: Env, shift: ShiftReportSession, nowMs: number) {
  const { clauses, params } = shiftWindowWhere('fees', shiftFilters(shift, nowMs))
  // fees has no cashier_id -- the equivalent column is created_by. Drop the
  // clause the sales table owns and add the fees one.
  const feeClauses = clauses.filter((clause) => !clause.includes('cashier_id'))
  delete params.cashierId
  feeClauses.push('fees.created_by = @createdBy')
  params.createdBy = shift.user_id
  if (shift.branch_id) {
    feeClauses.push('fees.branch_id = @branchId')
    params.branchId = shift.branch_id
  }
  const row = await getDb(env).prepare(`
    SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_khr), 0) AS khr
    FROM fees
    WHERE ${feeClauses.join(' AND ')}
  `).get<{ usd: number; khr: number }>(params)
  return { usd: Number(row?.usd || 0), khr: Number(row?.khr || 0) }
}

async function shiftFigures(env: Env, shift: ShiftReportSession, nowMs: number): Promise<ShiftReportFigures> {
  const filters = shiftFilters(shift, nowMs)
  const [totals, itemDiscountUsd, counts, expenses, paymentMethods, deliveries] = await Promise.all([
    getSalesTotals(env, filters),
    getItemDiscountUsd(env, filters),
    shiftInvoiceCounts(env, shift, nowMs),
    shiftExpenses(env, shift, nowMs),
    getPaymentMethodBreakdown(env, filters),
    getDeliveryContactTotals(env, filters),
  ])
  return {
    invoices: counts.invoices,
    cancelled: counts.cancelled,
    edited: counts.edited,
    // Canonical revenue, straight off the kernel -- never re-derived here.
    revenueUsd: totals.revenue_usd,
    itemDiscountUsd,
    // The kernel's `discount_usd` is store + membership: both are taken off
    // the whole invoice rather than off a line, which is what makes them the
    // invoice discount.
    invoiceDiscountUsd: totals.discount_usd,
    // Pre-discount value of what left the shelf. `gross_sales_usd` is the sum
    // of subtotals, which are already net of the LINE discounts, so the item
    // discount is added back to reach the price the goods were listed at.
    grossSaleUsd: Math.round((totals.gross_sales_usd + itemDiscountUsd) * 100) / 100,
    // Unpaid credit, on the same net basis. Not revenue, and not in the till.
    creditUsd: totals.pending_revenue_usd,
    otherExpenseUsd: expenses.usd,
    otherExpenseKhr: expenses.khr,
    collectedUsd: totals.collected_total_usd,
    paymentMethods: paymentMethods.map((row) => ({ method: row.payment_method, count: row.tx_count, collectedUsd: row.collected_usd })),
    deliveryServices: deliveries.map((row) => ({ name: row.delivery_contact_name, deliveries: row.deliveries, chargedUsd: row.charged_fee_usd })),
  }
}

async function shopName(env: Env): Promise<string> {
  const row = await getDb(env).prepare("SELECT value FROM settings WHERE key = 'business_name'").get<{ value: string }>()
  return cleanLine(row?.value || 'Business OS', 80)
}

async function shiftReportFor(env: Env, shift: ShiftReportSession, nowMs: number): Promise<string> {
  const [name, figures] = await Promise.all([shopName(env), shiftFigures(env, shift, nowMs)])
  return formatShiftReport(name, shift, figures, nowMs)
}

/**
 * `/shift [date]` -- every shift registered on that business day, one block
 * each, newest first.
 *
 * It cannot be "the signed-in user's shift": a Telegram chat carries no
 * Business OS session, which is why the whole command surface is gated on the
 * CHAT rather than on a user (see routes/telegram.ts). The audience of the
 * allow-listed chat is the owner or a manager, and what they need at closing
 * time is every till, so the day's shifts are what the command answers with.
 * The single-shift message is what `sendTelegramShiftReport` pushes.
 */
async function shiftReport(env: Env, date: string, nowMs: number): Promise<string> {
  const shifts = await getDb(env).prepare(`
    SELECT ${SHIFT_COLUMNS} FROM shift_sessions
    WHERE business_date = @date
    ORDER BY opened_at DESC LIMIT 12
  `).all<ShiftReportSession>({ date })
  if (!shifts.length) {
    return [
      reportTitle('🧑‍💼', 'Shift', 'វេន', date),
      bi('No shift was registered on this day.', 'គ្មានវេនណាមួយបានចុះបញ្ជីក្នុងថ្ងៃនេះទេ។'),
    ].join('\n')
  }
  const blocks: string[] = []
  for (const shift of shifts) blocks.push(await shiftReportFor(env, shift, nowMs))
  return blocks.join(`\n${'━'.repeat(18)}\n`)
}

/**
 * Push ONE shift's report to the alerts chat. This is the hand-off for the
 * lane that owns routes/shifts.ts: its `POST /close` handler can call
 * `c.executionCtx.waitUntil(sendTelegramShiftReport(c.env, shift.id))` after
 * the close succeeds and the report goes out with no other change. Returns
 * false (never throws) when Telegram is not configured or the id is unknown,
 * so it can never turn a successful close into a failed request.
 */
export async function sendTelegramShiftReport(env: Env, shiftId: number, nowMs: number = Date.now()): Promise<boolean> {
  try {
    const config = await getTelegramConfig(env)
    if (!config.enabled || configurationProblem(config)) return false
    const shift = await getDb(env).prepare(`SELECT ${SHIFT_COLUMNS} FROM shift_sessions WHERE id = @id`).get<ShiftReportSession>({ id: shiftId })
    if (!shift) return false
    await postTelegram(config, await shiftReportFor(env, shift, nowMs))
    return true
  } catch (error) {
    console.error('[telegram] shift report could not be sent', error)
    return false
  }
}

// ---- Command dispatch (S4-9) ----------------------------------------------
// Pure-ish and exported so scripts/test-telegram-bilingual-pure.cjs can drive
// every command, including the bad-argument and unknown-command paths, with a
// stubbed D1 and no bot token and no live chat.

/** Commands that accept an optional day argument. */
const DATED_COMMANDS = new Set(['/report', '/today', '/summary', '/sales', '/fees', '/shift', '/shifts'])

function unknownCommandReply(command: string): string {
  return [
    `🤔 ${bi(`I do not know the command ${command}.`, `មិនស្គាល់ពាក្យបញ្ជា ${command} ទេ។`)}`,
    '',
    telegramCommandReference(),
  ].join('\n')
}

export async function telegramCommandReply(env: Env, text: string, nowMs: number = Date.now()): Promise<string> {
  const parts = String(text || '').trim().split(/\s+/)
  // Group chats deliver "/report@shop_bot"; strip the bot mention.
  const command = String(parts[0] || '').toLowerCase().replace(/@[^\s]+$/, '')
  const argument = parts.slice(1).join(' ')

  if (command === '/help' || command === '/start') return telegramCommandReference()
  if (command === '/inventory') return inventorySummaryReport(env)
  if (command === '/stock' || command === '/lowstock') return inventoryReport(env)
  if (!DATED_COMMANDS.has(command)) return unknownCommandReply(command.slice(0, 32))

  const parsed = parseReportDate(argument, businessToday(nowMs))
  if (!parsed.ok) return parsed.message
  if (command === '/sales') return salesReport(env, parsed.date)
  if (command === '/fees') return feesReport(env, parsed.date)
  // `/shifts` is accepted as well as `/shift`: the reply is a list, and a
  // manager who types the plural should get the report rather than the
  // unknown-command help.
  if (command === '/shift' || command === '/shifts') return shiftReport(env, parsed.date, nowMs)
  return dayReport(env, parsed.date)
}


async function webhookSecretFromToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
export async function isTelegramWebhookRequest(env: Env, suppliedSecret: string | undefined): Promise<boolean> {
  const token = String(env.TELEGRAM_BOT_TOKEN || '').trim()
  const expected = token ? await webhookSecretFromToken(token) : ''
  if (!expected || !suppliedSecret || expected.length !== suppliedSecret.length) return false
  let different = 0; for (let index = 0; index < expected.length; index += 1) different |= expected.charCodeAt(index) ^ suppliedSecret.charCodeAt(index)
  return different === 0
}
export async function handleTelegramWebhook(env: Env, update: TelegramUpdate): Promise<void> {
  const message = update?.message; const text = String(message?.text || '').trim(); const chatId = String(message?.chat?.id || '')
  if (!text.startsWith('/') || !chatId) return
  const config = await getTelegramConfig(env)
  // No token means there is no way to reply at all, so say nothing.
  if (commandProblem(config)) return
  // THE ACCESS BOUNDARY (S4-9). A Telegram group carries no Business OS
  // session, so the only thing that can be checked is which chat is asking.
  // Any chat that is not on the owner's allow-list gets a refusal carrying
  // nothing but its own chat id -- never a figure, a receipt or a product.
  if (!config.chatIds.includes(chatId)) {
    await postTelegram(config, telegramUnauthorizedReply(chatId), chatId)
    return
  }
  await postTelegram(config, await telegramCommandReply(env, text), chatId)
}
export async function configureTelegramWebhook(env: Env): Promise<void> {
  const config = await getTelegramConfig(env); const problem = commandProblem(config)
  if (problem) throw new Error(problem)
  const webhookUrl = `${String(env.BUSINESS_OS_ADMIN_URL || '').replace(/\/$/, '')}/api/telegram/webhook`
  if (!/^https:\/\//i.test(webhookUrl)) throw new Error('A public HTTPS Business OS admin URL is required for Telegram commands.')
  const response = await fetch(`https://api.telegram.org/bot${config.token}/setWebhook`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl, secret_token: await webhookSecretFromToken(config.token), allowed_updates: ['message'], drop_pending_updates: false }),
  })
  if (!response.ok) throw new Error(`Telegram could not connect the command webhook (${response.status}).`)
  const result = await response.json<{ ok?: boolean; description?: string }>().catch(() => ({} as { ok?: boolean; description?: string }))
  if (!result.ok) throw new Error(result.description || 'Telegram could not connect the command webhook.')
}
export function telegramMoney(usd: unknown, khr: unknown): string { return money(usd, khr) }

// ---- Event message builders -------------------------------------------------
// The sale alert is a RECEIPT SUMMARY, not a log line -- the user's spec:
//   Status / Date / INV / Cashier / Customer / Tel / one line per item as
//   "name qty × price (−discount) = total" / Delivery service / Total /
//   Discount / Net Total / Paid / Delivery driver.
// Pure and exported so scripts/test-telegram-messages-pure.cjs pins the exact
// shape; routes/sales.ts only assembles the input from values it already holds.
export type TelegramSaleItem = { name: string; quantity: number; unitPriceUsd: number; basePriceUsd?: number | null; lineTotalUsd: number }
export type TelegramSaleSummary = {
  status: string; createdAt?: string | null; receiptNumber: string; cashier?: string | null
  customer?: string | null; phone?: string | null; branch?: string | null
  items: TelegramSaleItem[]; exchangeRate: number
  isDelivery?: boolean; deliveryFeeUsd?: number; deliveryPaidBy?: string | null
  driver?: { name?: string | null; phone?: string | null } | null
  subtotalUsd: number; discountUsd: number; taxUsd?: number; totalUsd: number; totalKhr?: number
  paidUsd?: number; paidKhr?: number; changeUsd?: number; changeKhr?: number; paymentMethod?: string | null
}
export type TelegramStockChange = {
  product: string; type: 'add' | 'remove'; quantity: number; branch?: string | null; reason?: string | null
  lot?: string | null; branchOnHand?: number | null; totalOnHand?: number | null; by?: string | null
}
const TELEGRAM_MAX_ITEM_LINES = 20

// dd/mm/yyyy HH:mm in the business day's zone (UTC+7) -- the app-wide display
// convention (day-first since Sep 4 2026). D1's CURRENT_TIMESTAMP is
// 'YYYY-MM-DD HH:MM:SS' UTC without a zone marker; client-sent created_at is
// ISO with one. Missing/invalid -> now.
export function formatBusinessDateTime(value?: string | null, nowMs = Date.now()): string {
  const raw = String(value || '').trim()
  const parsed = raw ? Date.parse(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`) : Number.NaN
  const local = new Date((Number.isFinite(parsed) ? parsed : nowMs) + BUSINESS_UTC_OFFSET_MINUTES * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}/${local.getUTCFullYear()} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`
}

export function formatSaleTelegramLines(sale: TelegramSaleSummary): string[] {
  const items = sale.items.slice(0, TELEGRAM_MAX_ITEM_LINES).map((item) => {
    const quantity = Number(item.quantity) || 0
    const base = Number(item.basePriceUsd)
    const lineDiscount = Number.isFinite(base) && base > item.unitPriceUsd ? round2((base - item.unitPriceUsd) * quantity) : 0
    return `• ${cleanLine(item.name, 100)} ${quantity} × ${usd(item.unitPriceUsd)}${lineDiscount ? ` (−${usd(lineDiscount)})` : ''} = ${usd(item.lineTotalUsd)}`
  })
  const deliveryFee = Number(sale.deliveryFeeUsd) || 0
  const customerDelivery = sale.isDelivery && sale.deliveryPaidBy !== 'shop' ? deliveryFee : 0
  const paid = (Number(sale.paidUsd) || 0) + (Number(sale.paidKhr) || 0)
  const change = (Number(sale.changeUsd) || 0) + (Number(sale.changeKhr) || 0)
  return [
    `Status: ${String(sale.status || '').replace(/_/g, ' ')}`,
    `Date: ${formatBusinessDateTime(sale.createdAt)}`,
    `INV: ${sale.receiptNumber}`,
    `Cashier: ${sale.cashier || 'Unknown'}`,
    sale.customer ? `Customer: ${sale.customer}` : '',
    sale.phone ? `Tel: ${sale.phone}` : '',
    sale.branch ? `Branch: ${sale.branch}` : '',
    ...items,
    sale.items.length > TELEGRAM_MAX_ITEM_LINES ? `+ ${sale.items.length - TELEGRAM_MAX_ITEM_LINES} more item(s)` : '',
    sale.isDelivery ? `Delivery service: ${usd(deliveryFee)}${sale.deliveryPaidBy === 'shop' ? ' (shop paid)' : ''}` : '',
    `Total: ${usd(round2((Number(sale.subtotalUsd) || 0) + customerDelivery))}`,
    sale.discountUsd ? `Discount: −${usd(sale.discountUsd)}` : '',
    sale.taxUsd ? `Tax: ${usd(sale.taxUsd)}` : '',
    `Net Total: ${money(sale.totalUsd, sale.totalKhr)}`,
    paid > 0 ? `Paid: ${money(sale.paidUsd, sale.paidKhr)}${sale.paymentMethod ? ` (${sale.paymentMethod})` : ''}` : 'Paid: unpaid',
    change > 0 ? `Change: ${money(sale.changeUsd, sale.changeKhr)}` : '',
    sale.driver?.name ? `Delivery driver: ${sale.driver.name}${sale.driver.phone ? ` · ${sale.driver.phone}` : ''}` : '',
  ]
}

// Stock alerts carry the RESULTING on-hand figures (this branch, all
// branches), not only the delta -- "for stock change, should also show total".
export function formatStockChangeTelegramLines(change: TelegramStockChange): string[] {
  const quantity = Math.abs(Number(change.quantity) || 0)
  const onHand: string[] = []
  if (change.branchOnHand != null) onHand.push(`${change.branch || 'Branch'} ${Number(change.branchOnHand) || 0}`)
  if (change.totalOnHand != null) onHand.push(`all branches ${Number(change.totalOnHand) || 0}`)
  return [
    `Product: ${change.product}`,
    `Stock change: ${change.type === 'add' ? '+' : '−'}${quantity}`,
    `Branch: ${change.branch || 'Unassigned'}`,
    change.reason ? `Reason: ${change.reason}` : '',
    change.lot ? `Lot: ${change.lot}` : '',
    onHand.length ? `On hand: ${onHand.join(' · ')}` : '',
    change.by ? `By: ${change.by}` : '',
  ]
}

// Transfers and returns are stock changes too ("for stock change, should
// also show total stock"), so their alerts carry the resulting on-hand of
// every touched product, read back after the write by the route. One
// builder serves the single, bulk and inventory-page transfer routes; one
// serves customer and supplier returns. Both are pure and pinned by
// scripts/test-telegram-messages-pure.cjs. The event heading is chosen by
// the route (TelegramEvent.heading) because a return is not a sale and a
// transfer is not a plain stock-out, while the enable switch stays the
// user's existing five categories.
export type TelegramTransferLine = {
  product: string; quantity: number; lot?: string | null; mergedInto?: string | null
  fromOnHand?: number | null; toOnHand?: number | null; totalOnHand?: number | null
}
export type TelegramTransferSummary = {
  createdAt?: string | null; fromBranch?: string | null; toBranch?: string | null
  items: TelegramTransferLine[]; note?: string | null; by?: string | null
}
export type TelegramReturnLine = {
  product: string; quantity: number; refundUsd?: number | null; lot?: string | null
  stockAction?: string | null; branchOnHand?: number | null; totalOnHand?: number | null
}
export type TelegramReturnSummary = {
  kind: 'customer' | 'supplier'; createdAt?: string | null; returnNumber: string
  receiptNumber?: string | null; party?: string | null; branch?: string | null
  reason?: string | null; returnType?: string | null; settlement?: string | null
  items: TelegramReturnLine[]; refundUsd?: number | null; refundKhr?: number | null
  compensationUsd?: number | null; compensationKhr?: number | null; lossUsd?: number | null; lossKhr?: number | null
  replacements?: Array<{ product: string; quantity: number }>; by?: string | null
}

function onHandLine(parts: Array<[string, number | null | undefined]>): string {
  const shown = parts.filter(([, value]) => value != null).map(([label, value]) => `${label} ${Number(value) || 0}`)
  return shown.length ? `On hand: ${shown.join(' · ')}` : ''
}

export function formatTransferTelegramLines(transfer: TelegramTransferSummary): string[] {
  const from = transfer.fromBranch || 'Source'
  const to = transfer.toBranch || 'Destination'
  const items = transfer.items.slice(0, TELEGRAM_MAX_ITEM_LINES).map((item) => {
    const onHand = onHandLine([[from, item.fromOnHand], [to, item.toOnHand], ['all branches', item.totalOnHand]])
    return `• ${cleanLine(item.product, 100)} ${Math.abs(Number(item.quantity) || 0)}`
      + (item.lot ? ` (lot ${cleanLine(item.lot, 40)})` : '')
      + (item.mergedInto ? ` → ${cleanLine(item.mergedInto, 100)}` : '')
      + (onHand ? ` — ${onHand.slice('On hand: '.length)}` : '')
  })
  const total = transfer.items.reduce((sum, item) => sum + Math.abs(Number(item.quantity) || 0), 0)
  return [
    `Date: ${formatBusinessDateTime(transfer.createdAt)}`,
    `From: ${from}`,
    `To: ${to}`,
    ...items,
    transfer.items.length > TELEGRAM_MAX_ITEM_LINES ? `+ ${transfer.items.length - TELEGRAM_MAX_ITEM_LINES} more item(s)` : '',
    `Total moved: ${total} unit(s) · ${transfer.items.length} product(s)`,
    transfer.note ? `Note: ${transfer.note}` : '',
    transfer.by ? `By: ${transfer.by}` : '',
  ]
}

export function formatReturnTelegramLines(ret: TelegramReturnSummary): string[] {
  const items = ret.items.slice(0, TELEGRAM_MAX_ITEM_LINES).map((item) => {
    const onHand = onHandLine([[ret.branch || 'Branch', item.branchOnHand], ['all branches', item.totalOnHand]])
    return `• ${cleanLine(item.product, 100)} ${Math.abs(Number(item.quantity) || 0)}`
      + (item.refundUsd != null ? ` = ${usd(item.refundUsd)}` : '')
      + (item.stockAction ? ` (${String(item.stockAction).replace(/_/g, ' ')})` : '')
      + (item.lot ? ` (lot ${cleanLine(item.lot, 40)})` : '')
      + (onHand ? ` — ${onHand.slice('On hand: '.length)}` : '')
  })
  const replacements = (ret.replacements || []).slice(0, TELEGRAM_MAX_ITEM_LINES)
    .map((rep) => `↔ ${cleanLine(rep.product, 100)} ${Math.abs(Number(rep.quantity) || 0)}`)
  const hasMoney = (ret.refundUsd || 0) !== 0 || (ret.refundKhr || 0) !== 0
  return [
    `Date: ${formatBusinessDateTime(ret.createdAt)}`,
    `${ret.kind === 'supplier' ? 'SRET' : 'RET'}: ${ret.returnNumber}`,
    ret.receiptNumber ? `INV: ${ret.receiptNumber}` : '',
    ret.party ? `${ret.kind === 'supplier' ? 'Supplier' : 'Customer'}: ${ret.party}` : '',
    ret.branch ? `Branch: ${ret.branch}` : '',
    ret.reason ? `Reason: ${ret.reason}` : '',
    ret.returnType ? `Type: ${String(ret.returnType).replace(/_/g, ' ')}` : '',
    ret.settlement ? `Settlement: ${String(ret.settlement).replace(/_/g, ' ')}` : '',
    ...items,
    ret.items.length > TELEGRAM_MAX_ITEM_LINES ? `+ ${ret.items.length - TELEGRAM_MAX_ITEM_LINES} more item(s)` : '',
    ...replacements,
    ret.kind === 'supplier'
      ? (ret.compensationUsd != null || ret.compensationKhr != null ? `Supplier pays: ${money(ret.compensationUsd, ret.compensationKhr)}` : '')
      : (hasMoney ? `Refund: ${money(ret.refundUsd, ret.refundKhr)}` : 'Refund: none'),
    ret.kind === 'supplier' && ((ret.lossUsd || 0) > 0 || (ret.lossKhr || 0) > 0) ? `Loss: ${money(ret.lossUsd, ret.lossKhr)}` : '',
    ret.by ? `By: ${ret.by}` : '',
  ]
}

// Return alerts read the recorded lines back (return_items is the truth the
// route just wrote, incl. the lot each line landed in and its branch) and the
// resulting on-hand per product, so the route hands over only the header.
type ReturnItemRow = { product_name: string | null; quantity: number; total_usd: number | null; stock_action: string | null; lot_code: string | null; branch_on_hand: number | null; total_on_hand: number | null }
export async function sendReturnTelegramEvent(env: Env, returnId: number, base: Omit<TelegramReturnSummary, 'items' | 'replacements'>): Promise<boolean> {
  const db = getDb(env)
  const [items, replacements] = await Promise.all([
    db.prepare(`SELECT ri.product_name, ri.quantity, ri.total_usd, ri.stock_action, pb.lot_code,
        (SELECT quantity FROM branch_stock WHERE product_id = ri.product_id AND branch_id = ri.branch_id) AS branch_on_hand,
        (SELECT stock_quantity FROM products WHERE id = ri.product_id) AS total_on_hand
      FROM return_items ri LEFT JOIN product_batches pb ON pb.id = ri.batch_id
      WHERE ri.return_id = @returnId ORDER BY ri.id`).all<ReturnItemRow>({ returnId }),
    db.prepare('SELECT product_name, quantity FROM return_replacement_items WHERE return_id = @returnId ORDER BY id').all<{ product_name: string | null; quantity: number }>({ returnId }).catch(() => []),
  ])
  return sendTelegramEvent(env, {
    type: base.kind === 'supplier' ? 'stock_out' : 'sales',
    heading: base.kind === 'supplier' ? '📤 Supplier return recorded' : '↩️ Return recorded',
    lines: formatReturnTelegramLines({
      ...base,
      items: items.map((row) => ({
        product: row.product_name || 'Item', quantity: Number(row.quantity) || 0,
        refundUsd: base.kind === 'supplier' ? null : Number(row.total_usd) || 0,
        stockAction: base.kind === 'supplier' ? null : row.stock_action, lot: row.lot_code,
        branchOnHand: row.branch_on_hand == null ? null : Number(row.branch_on_hand) || 0,
        totalOnHand: row.total_on_hand == null ? null : Number(row.total_on_hand) || 0,
      })),
      replacements: replacements.map((row) => ({ product: row.product_name || 'Item', quantity: Number(row.quantity) || 0 })),
    }),
  })
}
