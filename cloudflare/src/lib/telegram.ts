import { getDb } from './db'
import { loadLowStockConfig, lowStockThresholdSql } from './lowStockSettings'
import { customerBilledDeliveryFeeUsd } from './saleTotals'
import { resolveStoredNativeSaleChange } from './nativeSaleChange'
import { BUSINESS_UTC_OFFSET_MINUTES, businessToday, localDateRangeClause } from './businessDateWindow'
import {
  bi, label, labeled, localizeTelegramHeading, localizeTelegramLine, localizeTelegramValue,
  parseReportDate, telegramCommandReference, telegramUnauthorizedReply,
} from './telegramLang'
import type { TelegramLabelKey } from './telegramLang'
import {
  getSalesGroupedTotals, getSalesTotals,
  recognizedExpr, shiftWindowWhere, type SalesFilters,
} from './salesAnalytics'
// The drawer arithmetic is NOT defined here any more. lib/shiftReconciliation.ts
// owns it, and the close routes, the current/history reads and this message all
// call the same function -- see the header note there for what changed and why.
import {
  computeShiftReconciliation, loadShiftReconciliation, shiftExpenses, shiftFilters, summarizeShiftCash,
  type ShiftReconciliation,
} from './shiftReconciliation'
export { shiftExpenses, shiftFilters, summarizeShiftCash }
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
const riel = (value: unknown) => `${Math.round(Number(value) || 0).toLocaleString('en-US')}៛`
function money(usd: unknown, khr: unknown, separator = ' · '): string {
  const usdValue = Number(usd) || 0; const khrValue = Number(khr) || 0; const parts: string[] = []
  if (usdValue) parts.push(`$${usdValue.toFixed(2)}`)
  if (khrValue) parts.push(`${Math.round(khrValue).toLocaleString()}៛`)
  return parts.length ? parts.join(separator) : '$0.00'
}
function registeredMoney(usdValue: number | null, khrValue: number | null): string {
  const dollars = usdValue == null ? '—' : usd(usdValue)
  const rielAmount = khrValue == null ? '—' : riel(khrValue)
  return `${dollars} · ${rielAmount}`
}

// The ONE section rule every report draws, and the whole of what replaced the
// explanatory sentences the owner asked us to delete ("no explanation just
// arrange all reports more concise with breakdowns clearly"). A bare rule
// reads as a break at phone width; a section heading would cost a line per
// block and a blank line reads as an accident rather than a divider.
const RULE = '━'.repeat(18)

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
export function splitTelegramMessage(text: string): string[] {
  const chunks: string[] = []; let current = ''
  // Iterate the original text: a synthetic final newline would create an
  // empty message when the text length is an exact chunk-size multiple.
  for (const point of text) {
    if (current.length + point.length > 3900) { chunks.push(current); current = '' }
    current += point
  }
  if (current) chunks.push(current)
  return chunks
}

async function postTelegram(config: TelegramConfig, text: string, chatId = config.chatId): Promise<void> {
  for (const part of splitTelegramMessage(text)) {
    const response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: part, disable_web_page_preview: true }),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Telegram rejected the message (${response.status})${body ? `: ${body.slice(0, 160)}` : ''}`)
    }
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
  // One confirmation line, then the reference. The sentence that used to sit
  // between them -- "Every notification category is on by default; turn any
  // off in Settings" -- explained Settings to a reader who was standing in
  // Settings, having just pressed the button there. It was the last
  // explanatory sentence the bot sent.
  await postTelegram(config, [
    `✅ ${bi('Business OS alerts and commands are connected.', 'ការជូនដំណឹង និងពាក្យបញ្ជា Business OS បានភ្ជាប់រួចរាល់។')}`,
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
/** Kernel-derived, so it carries what the kernel knows and the old SUM did not:
 *  how many receipts were VOIDED, and how much was refunded. Profit, delivery
 *  and credit ride along because the day summary now leads with the SAME five
 *  totals the shift report leads with -- one header shape for every report
 *  (the owner's "arrange all reports more concise with breakdowns clearly"),
 *  and no second definition: they are `getSalesTotals` fields, unaltered.
 *  There is no riel half: the kernel's revenue is USD (salesAnalytics.ts's
 *  header), and the column the old code summed for a `khr` was a different
 *  quantity, not a translation of this one. */
type SalesBucket = {
  count: number; usd: number; cancelled: number; refundUsd: number
  profitUsd: number; deliveryFeeUsd: number; creditUsd: number
  // The courier money actually paid out over the day, and how many sales
  // recorded any (a missing cost is NULL, never 0 -- deliveryActualCostExpr,
  // which is why the count exists). It rides along for ONE reason: the day
  // header and the shift header print the same word "Expenses", so they have
  // to add up the same two things. See expenseBlock() below.
  deliveryCostUsd: number; deliveryCostRecorded: number
}
type DayStats = { date: string; sales: SalesBucket; fees: MoneyBucket; stockIn: UnitBucket; stockOut: UnitBucket }
type CashierRow = { cashier: string; count: number; usd: number }

/** One business day as kernel filters. The shift report next door already
 *  reads its money this way (shiftFigures); the day/cashier/sales reports
 *  did not, and that was the whole defect. */
const dayFilters = (date: string): SalesFilters => ({ startDate: date, endDate: date, branchId: null })

// CORRECTED Sep 6 2026 (owner ask N6). The sales figure was
// `SUM(total_usd), SUM(total_khr) FROM sales` over the day with NO status
// filter at all, so it counted VOIDED receipts as takings, included tax and
// the delivery fee in what it called sales, and subtracted no refund. It
// disagreed with the Sales page, the Dashboard, the Reports hub and with the
// shift report inside this very file. It now reads the same kernel as all of
// them -- one implementation, not a lookalike.
//
// The KHR half is gone rather than reproduced: the kernel has ONE canonical
// revenue and it is USD (see salesAnalytics.ts's header). The old `khr` was
// SUM(total_khr) over every row including the voided ones -- a different
// quantity from this one, not a translation of it. money() prints just the
// dollars when the riel side is zero.
async function dayStats(env: Env, date: string): Promise<DayStats> {
  const db = getDb(env)
  const [totals, fees, stockIn, stockOut] = await Promise.all([
    getSalesTotals(env, dayFilters(date)),
    db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_khr), 0) AS khr FROM fees WHERE fee_date = @date').get<{ count: number; usd: number; khr: number }>({ date }),
    // 'stock_in' is the legacy string the unified stock-in session used to
    // write (see stockInSessionsQuery.ts's STOCK_RECEIPT_MOVEMENT_TYPES) --
    // without it this digest under-counted every session committed through
    // the Products page's "Add products" entry.
    db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS quantity FROM inventory_movements WHERE movement_type IN ('add', 'stock_in', 'transfer_in', 'move_in') AND ${dayClause('created_at')}`).get<{ count: number; quantity: number }>({ date }),
    db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS quantity FROM inventory_movements WHERE movement_type IN ('remove', 'transfer_out', 'move_out') AND ${dayClause('created_at')}`).get<{ count: number; quantity: number }>({ date }),
  ])
  return {
    date,
    sales: {
      count: totals.tx_count, usd: totals.revenue_usd,
      cancelled: totals.cancelled_tx_count, refundUsd: totals.refund_usd,
      profitUsd: totals.profit_usd, deliveryFeeUsd: totals.delivery_usd,
      // Not Paid on the kernel's net basis -- inside revenue and profit
      // above, printed on its own line as a POSITIVE "Credit" figure and
      // never subtracted from anything (the owner: "just use credit ...
      // instead of $-n ... just $n").
      creditUsd: totals.pending_revenue_usd,
      // Same call, same two fields the shift report reads -- so the two
      // reports' "Expenses" is one sum with one source, not a lookalike.
      deliveryCostUsd: totals.delivery_actual_cost_usd,
      deliveryCostRecorded: totals.delivery_actual_cost_count,
    },
    fees,
    stockIn,
    stockOut,
  }
}

// "cashier user" in the ask: who rang up how much, on that day. Same kernel,
// sliced by cashier -- so a cashier's line and the Sales total above it are
// the same number cut two ways, and the per-cashier lines sum to the total.
// (They did not: the old query counted voided receipts and gross totals.)
async function cashierTotals(env: Env, date: string): Promise<CashierRow[]> {
  const rows = await getSalesGroupedTotals(env, dayFilters(date), 'cashier', 12)
  // Receipts and money only. The per-cashier VOID count used to ride along on
  // this row; the day block above already reports the day's cancelled count,
  // and repeating it per cashier is exactly the kind of second figure the
  // owner asked us to take out of the message.
  return rows.map((row) => ({
    cashier: row.label || 'Unknown',
    count: row.tx_count,
    usd: row.revenue_usd,
  }))
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

// The stock lines are the only place a bilingual counter still earns its
// keep: "12 · 340" would not say which half is movements and which is units.
// Everywhere else the label already names the noun, so the counter went.
const counted = (count: unknown, noun: 'movement(s)' | 'unit(s)'): string =>
  localizeTelegramValue(`${Number(count) || 0} ${noun}`)

/**
 * "Expenses" -- the ONE definition, shared by the shift report and the day
 * summary because they print the same word for it.
 *
 * They did not share it until Sep 7 2026: the day header added up the fees
 * table alone while the shift header added the fees to the courier money
 * actually paid out, so a single-shift day showed `/shift` "Expenses: $17.00"
 * against `/report` "Expenses: $9.50" and nothing on either message said why.
 *
 * An UNRECORDED courier cost is NULL, never $0.00 (deliveryActualCostExpr in
 * salesAnalytics.ts) -- `recorded` is the count of sales that carry one, and a
 * zero there keeps delivery out of the total entirely rather than claiming
 * delivery was free.
 *
 * The two component lines print only when the total really has two parts.
 * With one part the total IS that part, and printing it twice under two names
 * is the repeated figure the owner asked us to take out ("no explanation just
 * arrange all reports more concise").
 */
function expenseBlock(input: { otherUsd: unknown; otherKhr: unknown; deliveryCostUsd: unknown; deliveryCostRecorded: unknown }): { header: string | null; components: string[] } {
  const courierUsd = Number(input.deliveryCostRecorded) > 0 ? round2(Number(input.deliveryCostUsd) || 0) : 0
  const otherUsd = round2(Number(input.otherUsd) || 0)
  const otherKhr = Number(input.otherKhr) || 0
  const totalUsd = round2(otherUsd + courierUsd)
  const split = courierUsd > 0 && (otherUsd > 0 || otherKhr > 0)
  return {
    header: totalUsd || otherKhr ? labeled('expenses', money(totalUsd, otherKhr)) : null,
    components: split ? [labeled('deliveryCost', usd(courierUsd)), labeled('expensesOther', money(otherUsd, otherKhr))] : [],
  }
}

/**
 * The day summary -- `/report`, and the scheduled push.
 *
 * SAME SHAPE AS THE SHIFT REPORT, deliberately (owner, Sep 6 2026: "arrange
 * all reports more concise with breakdowns clearly"): a header block of the
 * key totals in one fixed order -- Sales, Profit, Expenses, Delivery fee,
 * Credit -- then compact labelled sections, one figure per line, a zero-value
 * line simply not printed, and not one explanatory sentence. Two people
 * reading the evening `/report` and tonight's shift message see the same five
 * words in the same order.
 *
 * Credit is a POSITIVE "Credit $n" line, never a negative and never
 * subtracted from the totals above it: it is unpaid revenue that already
 * counts in Sales and Profit.
 *
 * `categories` is the owner's per-category switch set, unchanged: a category
 * that is off takes its own lines out and nothing else.
 *
 * Exported for scripts/test-telegram-shift-report-pure.cjs, which renders it
 * with no database at all -- the same reason formatShiftReport is exported.
 */
export function formatDaySummary(stats: DayStats, cashiers: CashierRow[], categories?: Partial<Record<TelegramEventType, boolean>>): string {
  const showSales = categories?.sales !== false
  const lines = [reportTitle('📊', 'Business summary', 'សង្ខេបអាជីវកម្ម', stats.date)]

  const header: string[] = []
  // Sales and Profit print even at $0.00: a day that took nothing is a fact
  // the owner wants stated, not a blank. Every other header line is dropped
  // when it is zero.
  if (showSales) header.push(labeled('sales', usd(stats.sales?.usd)), labeled('profit', usd(stats.sales?.profitUsd)))
  // The SAME sum the shift header prints, through the same function: the fees
  // of the day plus the courier money actually paid out. The `fees` switch
  // still governs whether the line exists at all.
  const expenses = expenseBlock({
    otherUsd: categories?.fees === false ? 0 : stats.fees?.usd,
    otherKhr: categories?.fees === false ? 0 : stats.fees?.khr,
    deliveryCostUsd: showSales ? stats.sales?.deliveryCostUsd : 0,
    deliveryCostRecorded: showSales ? stats.sales?.deliveryCostRecorded : 0,
  })
  if (expenses.header) header.push(expenses.header)
  if (showSales && stats.sales?.deliveryFeeUsd) header.push(labeled('deliveryFee', usd(stats.sales.deliveryFeeUsd)))
  if (showSales && stats.sales?.creditUsd) header.push(labeled('credit', usd(stats.sales.creditUsd)))
  if (header.length) lines.push(RULE, ...header)

  if (showSales) {
    // The counts, on their own. They are the breakdown of the header's Sales
    // (refunds subtracted, voids contributing nothing), never a second total.
    const counts = [labeled('invoices', Number(stats.sales?.count) || 0)]
    if (stats.sales?.cancelled) counts.push(labeled('cancelled', Number(stats.sales.cancelled) || 0))
    lines.push(RULE, ...counts)
  }

  // Then the money breakdown, in the shift report's order: the expense split
  // (only when there are two parts of it), then the ONE refunds figure.
  const breakdown = [...expenses.components]
  if (showSales && stats.sales?.refundUsd) breakdown.push(labeled('refunds', usd(stats.sales.refundUsd)))
  if (breakdown.length) lines.push(RULE, ...breakdown)

  const stock: string[] = []
  if (categories?.stock_in !== false && (stats.stockIn?.count || stats.stockIn?.quantity)) stock.push(labeled('stockIn', `${counted(stats.stockIn?.count, 'movement(s)')} · ${counted(stats.stockIn?.quantity, 'unit(s)')}`))
  if (categories?.stock_out !== false && (stats.stockOut?.count || stats.stockOut?.quantity)) stock.push(labeled('stockOut', `${counted(stats.stockOut?.count, 'movement(s)')} · ${counted(stats.stockOut?.quantity, 'unit(s)')}`))
  if (stock.length) lines.push(RULE, ...stock)

  if (cashiers.length) {
    lines.push(RULE, `${label('cashiers')}:`)
    // Name, receipts, money. The bilingual "receipt(s)" counter is dropped
    // here and only here: the section is a list of cashiers, so the count
    // needs no noun, and repeating a two-language word on every bullet is
    // what made this block long.
    for (const row of cashiers) lines.push(`• ${cleanLine(row.cashier, 60)} — ${Number(row.count) || 0} · ${usd(row.usd)}`)
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
  // Voided receipts are excluded here for the same reason they contribute 0
  // to the total above: listing one under a total it is not part of invites
  // exactly the reconciliation the owner asked us to end. The count of them
  // is printed by formatDaySummary instead.
  const sales = await db.prepare(`SELECT id, receipt_number, cashier_name, total_usd, total_khr FROM sales WHERE ${dayClause('created_at')} AND ${recognizedExpr('')} ORDER BY created_at DESC LIMIT 5`).all<{ id: number; receipt_number: string | null; cashier_name: string | null; total_usd: number; total_khr: number }>({ date })
  const title = reportTitle('🛍️', 'Sales', 'ការលក់', date)
  if (!sales.length) return `${title}\n${bi('No sales recorded on this day.', 'គ្មានការលក់បានកត់ត្រាក្នុងថ្ងៃនេះទេ។')}`
  const ids = sales.map((sale) => sale.id)
  const items = await db.prepare(`SELECT sale_id, product_name, quantity, applied_price_usd, applied_price_khr FROM sale_items WHERE sale_id IN (${ids.map(() => '?').join(',')}) ORDER BY id ASC`).all<{ sale_id: number; product_name: string | null; quantity: number; applied_price_usd: number; applied_price_khr: number }>(ids)
  const bySale = new Map<number, typeof items>(); for (const item of items) bySale.set(item.sale_id, [...(bySale.get(item.sale_id) || []), item])
  // The same header shape as every other report: the money first, the count
  // under it, one figure per line, then the list.
  const lines = [title, RULE, labeled('sales', usd(stats.sales?.usd)), labeled('invoices', Number(stats.sales?.count) || 0), RULE, `${label('latestReceipts')}:`]
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
  // Total, then the records themselves. The record COUNT is gone: the bullets
  // under it are the records, so printing how many of them there are is the
  // repeated figure the owner asked us to drop.
  const lines = [reportTitle('💸', 'Expenses', 'ចំណាយ', date), RULE, labeled('expenses', money(stats.fees?.usd, stats.fees?.khr)), RULE]
  if (!fees.length) lines.push(bi('No expense recorded on this day.', 'គ្មានចំណាយបានកត់ត្រាក្នុងថ្ងៃនេះទេ។'))
  for (const fee of fees) lines.push(`• ${cleanLine(fee.fee_type)}${fee.label ? ` — ${cleanLine(fee.label, 90)}` : ''}: ${money(fee.amount_usd, fee.amount_khr)}`)
  return lines.join('\n')
}

async function inventoryReport(env: Env): Promise<string> {
  const db = getDb(env)
  // Same OR as the notification bell: /stock and /lowstock report BOTH tiers
  // in one list, so filtering on the low fragment alone would take the
  // out-of-stock rows down with the low ones when the alert is switched off.
  const lowThresholdSql = lowStockThresholdSql(await loadLowStockConfig(env), 'low_stock_threshold')
  const rows = await db.prepare(`SELECT name, stock_quantity, ${lowThresholdSql} AS low_threshold, out_of_stock_threshold FROM products WHERE is_active = 1 AND (COALESCE(stock_quantity, 0) <= ${lowThresholdSql} OR COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0)) ORDER BY COALESCE(stock_quantity, 0) ASC, name ASC LIMIT 12`).all<{ name: string; stock_quantity: number; low_threshold: number; out_of_stock_threshold: number }>()
  const title = reportTitle('📦', 'Low stock', 'ស្តុកទាប')
  if (!rows.length) return `${title}\n${bi('No active product is at or below its alert level.', 'គ្មានផលិតផលសកម្មណាមួយស្តុកទាបទេ។')}`
  // The same shape as the other six reports (Sep 7 2026): the figure block
  // between rules, then the list. It was the only report still running its
  // count straight into its bullets with no break.
  const lines = [title, RULE, labeled('products', rows.length), RULE]
  for (const row of rows) {
    const out = Number(row.stock_quantity || 0) <= Number(row.out_of_stock_threshold || 0)
    lines.push(`• ${out ? bi('OUT', 'អស់ស្តុក') : bi('LOW', 'ស្តុកទាប')} — ${cleanLine(row.name, 120)} — ${Number(row.stock_quantity || 0)} (⚠ ${Number(row.low_threshold)})`)
  }
  return lines.join('\n')
}

async function inventorySummaryReport(env: Env): Promise<string> {
  const lowThresholdSql = lowStockThresholdSql(await loadLowStockConfig(env), 'low_stock_threshold')
  const row = await getDb(env).prepare(`SELECT
    COUNT(*) AS products,
    COALESCE(SUM(stock_quantity), 0) AS units,
    COALESCE(SUM(CASE WHEN COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0) THEN 1 ELSE 0 END), 0) AS out_of_stock,
    COALESCE(SUM(CASE WHEN COALESCE(stock_quantity, 0) > COALESCE(out_of_stock_threshold, 0) AND COALESCE(stock_quantity, 0) <= ${lowThresholdSql} THEN 1 ELSE 0 END), 0) AS low_stock
    FROM products WHERE is_active = 1`).get<{ products: number; units: number; out_of_stock: number; low_stock: number }>()
  // Sep 7 2026: the header block, then the stock health as its own section --
  // the shape the other six reports took on Sep 6, which this one and /stock
  // were the two replies to miss.
  //
  // The two health figures used to share a line ("Low stock: N · Out of
  // stock: N"), against the one-figure-per-line rule the redesign holds
  // everywhere else, and a `▸ /stock — the product list` pointer closed the
  // message: a line spent telling the reader to send another message, exactly
  // what the shortened command reference dropped. Both are gone; a shop with
  // nothing low simply has no second section, the same way every other report
  // drops a zero line.
  const lowStock = Number(row?.low_stock || 0)
  const outOfStock = Number(row?.out_of_stock || 0)
  const lines = [
    reportTitle('🏷️', 'Inventory', 'ស្តុក'),
    RULE,
    labeled('activeProducts', Number(row?.products || 0).toLocaleString()),
    labeled('unitsOnHand', Number(row?.units || 0).toLocaleString()),
  ]
  const health: string[] = []
  if (lowStock) health.push(labeled('lowStock', lowStock))
  if (outOfStock) health.push(labeled('outOfStock', outOfStock))
  if (health.length) lines.push(RULE, ...health)
  return lines.join('\n')
}

// ---- Shift report (S4-7, redesigned Sep 6 2026) ----------------------------
//
// The owner's own review, verbatim: "for telegram message can be made more
// clearly, summary, less text, no explanation just arrange all reports more
// concise with breakdowns clearly. like i see shift report is so long, much
// more simpler so easy to understand at a glance" -- and, on the same report,
// "you didn't mention the registered cash dollar and khr in open vs end."
//
// The line set is now SHORT and grouped, one figure per line, nothing
// explained in a sentence, no zero line printed:
//
//   1. identity: shop, cashier, [branch], shift code, from/to
//   2. the header block of key totals: sales, profit, [expenses], [delivery
//      fee], [credit] -- credit is ALWAYS a plain positive figure, never a
//      subtraction, per the owner's separate ruling ("just use credit ...
//      instead of $-n ... just $n").
//   3. invoice counts: invoices, [cancelled], [edited]
//   4. registered cash, open vs end, both currencies, as ONE small block --
//      the owner's specific gap above. This is a factual readout, not a
//      claim that it must reconcile to anything.
//   5. expenses split into exactly two plain lines (delivery cost, other
//      expenses -- no itemised fee list), at most one refunds line, and ONE
//      informational difference line. The difference is counted cash minus
//      the expected drawer (lib/shiftReconciliation.ts, the one shared
//      definition with the close routes and the shift screen), but it is
//      printed as a single fact, never as "shortage" or a must-match claim,
//      and the five-part formula behind it is not spelled out any more.
//
// Per-account vs shop-wide scope, and which sales the window covers, are
// unchanged -- see lib/shiftReconciliation.ts and shiftFilters() below.
//
// Riel is never folded into dollars anywhere here -- the drawer holds both and
// the shop counts them separately, the same convention migration 0116 and
// every fee surface already follow.

export type ShiftReportSession = {
  shift_code: string
  scope_mode?: 'per_account' | 'shop_wide'
  user_id: number
  user_name: string | null
  branch_id: number | null
  branch_name: string | null
  business_date: string
  opened_at: string
  opening_float_usd: number | null
  opening_float_khr: number | null
  additional_cash_usd?: number | null
  additional_cash_khr?: number | null
  closed_at: string | null
  closing_counted_usd: number | null
  closing_counted_khr: number | null
  cancelled_at?: string | null
  cancelled_by_user_name?: string | null
  cancel_reason?: string | null
}

export type ShiftReportFigures = {
  invoices: number
  cancelled: number
  edited: number
  // Net sales, straight off getSalesTotals -- the SAME kernel the Reports hub
  // and the day summary read, never a second revenue computed here.
  revenueUsd: number
  profitUsd: number
  // What customers were charged for delivery, and what couriers were
  // actually paid out of it. The margin between them is not printed any
  // more -- the header shows the fee, the breakdown shows the cost, and a
  // reader who wants the difference can do that one subtraction.
  deliveryFeeUsd: number
  deliveryCostUsd: number
  // How many of the window's deliveries recorded a courier cost at all. A
  // missing cost is NULL, never zero (see deliveryActualCostExpr), so a report
  // that printed "cost $0.00" off an empty column would claim free delivery.
  // The delivery-cost line prints only when this is above zero.
  deliveryCostRecorded: number
  // Customer refunds, on the kernel's net basis. NOT the same figure as
  // creditUsd: credit is a sale that has not been paid for, a refund is
  // money that was taken and given back. Printed as the ONE refunds line --
  // no per-return breakdown.
  refundUsd: number
  creditUsd: number
  otherExpenseUsd: number
  otherExpenseKhr: number
  // Native tender currencies, never USD-equivalent sales totals. Null/absent
  // means the source cannot establish a drawer balance, not zero cash.
  cash?: { usd: number; khr: number; needsReview: boolean }
  /** Cash added after opening, kept separate from the registered counts. */
  additionalCash?: { usd: number; khr: number }
  // The drawer reconciliation, from lib/shiftReconciliation.ts. Optional only
  // so a caller with figures but no database (the pure test) still renders:
  // when it is absent the SAME pure function derives one from the fields
  // above, so there is still exactly one formula in the codebase. Consumed
  // ONLY to derive the single Difference line below -- its five components
  // are no longer printed.
  reconciliation?: ShiftReconciliation
}

/**
 * The whole message, pure -- no D1, no clock beyond the `nowMs` an open shift
 * needs for its "to" bound. scripts/test-shift-report-pure.cjs drives it
 * directly, so the shape and the arithmetic are pinned without a database.
 */
export function formatShiftReport(shopName: string, shift: ShiftReportSession, figures: ShiftReportFigures, nowMs: number = Date.now()): string {
  const cancelled = !!shift.cancelled_at
  const open = !shift.closed_at && !cancelled
  // A later soft cancellation must not extend an already closed shift's
  // financial window. The original close remains the operational end; only
  // an open-cancelled row uses cancellation as its terminal bound.
  const endedAt = shift.closed_at || shift.cancelled_at
  const lines = [
    reportTitle('🧑‍💼', 'Shift', 'វេន', shift.business_date),
    labeled('shift', cleanLine(shift.shift_code, 40)),
    labeled('from', formatBusinessDateTime(shift.opened_at, nowMs)),
  ]
  lines.push(
    // An open shift reports up to NOW and says so, rather than printing a
    // closing time that has not happened. A shift left running overnight is
    // the honest record -- migration 0116 refuses to close one on a timer --
    // so the report has to be able to render one. A cancelled shift's "To"
    // line carries the cancellation tag; nothing else needs to repeat it.
    open
      ? `${label('to')}: ${formatBusinessDateTime(new Date(nowMs).toISOString(), nowMs)} — ${bi('still open', 'នៅបើកនៅឡើយ')}`
      : `${labeled('to', formatBusinessDateTime(endedAt, nowMs))}${cancelled ? ` — ${bi('cancelled', 'បានបោះបង់')}` : ''}`,
    labeled('shop', cleanLine(shopName || 'Business OS', 80)),
    labeled('cashier', localizeTelegramValue(cleanLine(shift.user_name || 'No cashier', 60))),
  )
  if (cancelled) {
    if (shift.closed_at) lines.push(`${bi('Cancelled at', 'បោះបង់នៅ')}: ${formatBusinessDateTime(shift.cancelled_at, nowMs)}`)
    lines.push(`${bi('Cancelled by', 'បោះបង់ដោយ')}: ${cleanLine(shift.cancelled_by_user_name || 'Unknown', 60)}`)
    lines.push(`${bi('Reason', 'មូលហេតុ')}: ${cleanLine(shift.cancel_reason || 'Not recorded', 500)}`)
  }

  // The header block: the five totals the owner named, each dropped when it
  // is zero -- Sales and Profit are the two the shop always wants, so they
  // print unconditionally even at $0.00 (a quiet shift is still a real one).
  const expenses = expenseBlock({
    otherUsd: figures.otherExpenseUsd, otherKhr: figures.otherExpenseKhr,
    deliveryCostUsd: figures.deliveryCostUsd, deliveryCostRecorded: figures.deliveryCostRecorded,
  })
  lines.push(RULE, labeled('sales', usd(figures.revenueUsd)), labeled('profit', usd(figures.profitUsd)))
  if (expenses.header) lines.push(expenses.header)
  if (figures.deliveryFeeUsd) lines.push(labeled('deliveryFee', usd(figures.deliveryFeeUsd)))
  // Always positive, always labelled "Not Paid" -- never "$-n", never
  // subtracted from anything above it (see the owner's separate ruling).
  if (figures.creditUsd) lines.push(labeled('credit', usd(figures.creditUsd)))

  lines.push(RULE, labeled('invoices', figures.invoices))

  // The owner's specific gap: registered opening and closing cash, both currencies,
  // as one small block. A factual readout -- it is not compared to anything
  // here, and an open shift (no count taken yet) shows only the open half.
  lines.push(RULE, labeled('cashOpen', registeredMoney(shift.opening_float_usd, shift.opening_float_khr)))
  if (shift.closed_at) lines.push(labeled('cashEnd', registeredMoney(shift.closing_counted_usd, shift.closing_counted_khr)))
  const additionalCash = shift.additional_cash_usd || shift.additional_cash_khr
    ? registeredMoney(shift.additional_cash_usd ?? 0, shift.additional_cash_khr ?? 0)
    : ''
  if (additionalCash) lines.push(labeled('additionalCash', additionalCash))

  // Expenses split into exactly two plain lines and one informational
  // difference line -- none of it an
  // expected-must-match check. The reconciliation is still computed (ONE
  // shared definition, lib/shiftReconciliation.ts) but only to answer the
  // single question "does the count differ from what it should be", not to
  // print its own five-part formula any more.
  const recon = figures.reconciliation ?? computeShiftReconciliation({
    opening: { usd: shift.opening_float_usd, khr: shift.opening_float_khr },
    additionalCash: figures.additionalCash ?? { usd: shift.additional_cash_usd ?? 0, khr: shift.additional_cash_khr ?? 0 },
    cashSales: figures.cash ?? { usd: 0, khr: 0 },
    refunds: { usd: figures.refundUsd, khr: 0 },
    expenses: { usd: figures.otherExpenseUsd, khr: figures.otherExpenseKhr },
    courier: { usd: figures.deliveryCostRecorded > 0 ? figures.deliveryCostUsd : 0, khr: 0 },
    counted: { usd: shift.closing_counted_usd, khr: shift.closing_counted_khr },
    reviewCodes: !figures.cash || figures.cash.needsReview ? ['tender_incomplete'] : [],
  })
  const context: string[] = [...expenses.components]
  // Expected is shown for both open and closed shifts. An open drawer has no
  // counted value (and therefore no difference), but the employee still needs
  // the current target while trading.
  const expected = recon.expected.usd == null && recon.expected.khr == null
    ? '—'
    : `${recon.expected.usd == null ? '—' : usd(recon.expected.usd)} · ${recon.expected.khr == null ? '—' : riel(recon.expected.khr)}`
  context.push(labeled('expectedCash', expected))
  // The closing count only exists once the employee has ended the shift by
  // hand, so an open shift shows no difference against a count that was
  // never taken -- that would read as a missing-cash alarm on every open till.
  if (shift.closed_at) {
    const signed = (n: number, format: (value: number) => string) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${format(Math.abs(n))}`
    const difference = recon.difference.usd == null && recon.difference.khr == null
      ? '—'
      : `${recon.difference.usd == null ? '—' : signed(recon.difference.usd, usd)} · ${recon.difference.khr == null ? '—' : signed(recon.difference.khr, riel)}`
    context.push(labeled('difference', difference))
    if (recon.needs_review) {
      const reviewLabels: Partial<Record<string, TelegramLabelKey>> = {
        tender_incomplete: 'reviewTender',
        change_ambiguous: 'reviewChange',
        sale_limit_reached: 'reviewLimit',
        cash_method_unresolved: 'reviewCashMethod',
      }
      const reasons = recon.review_codes
        .map((code) => reviewLabels[code])
        .filter((key): key is TelegramLabelKey => !!key)
        .map((key) => label(key))
      context.push(labeled('cashReview', reasons.length ? reasons.join(' · ') : '—'))
    }
  }
  if (context.length) lines.push(RULE, ...context)

  return lines.join('\n')
}

const SHIFT_COLUMNS = `shift_code, scope_mode, user_id, user_name, branch_id, branch_name, business_date,
  opened_at,
  CASE WHEN opening_float_usd_registered=1 THEN opening_float_usd ELSE NULL END AS opening_float_usd,
  CASE WHEN opening_float_khr_registered=1 THEN opening_float_khr ELSE NULL END AS opening_float_khr,
  additional_cash_usd, additional_cash_khr, closed_at, closing_counted_usd, closing_counted_khr,
  cancelled_at, cancelled_by_user_name, cancel_reason`

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

async function shiftFigures(env: Env, shift: ShiftReportSession, nowMs: number): Promise<ShiftReportFigures> {
  const filters = shiftFilters(shift, nowMs)
  const overflowLabel = bi('Other expenses', 'ចំណាយផ្សេងទៀត')
  // Payment-method and delivery-contact breakdowns are no longer part of the
  // shift report (see the redesign header comment above formatShiftReport),
  // so those two queries are gone -- getPaymentMethodBreakdown and
  // getDeliveryContactTotals remain in lib/salesAnalytics.ts for
  // routes/reports.ts, just no longer called from here.
  const [totals, counts, expenses, reconciliation] = await Promise.all([
    getSalesTotals(env, filters),
    shiftInvoiceCounts(env, shift, nowMs),
    shiftExpenses(env, shift, nowMs, { overflowLabel }),
    loadShiftReconciliation(env, shift, nowMs, { overflowLabel }),
  ])
  return {
    invoices: counts.invoices,
    cancelled: counts.cancelled,
    edited: counts.edited,
    // Canonical revenue, straight off the kernel -- never re-derived here.
    revenueUsd: totals.revenue_usd,
    // Cost and profit as the Reports hub defines them. No second definition
    // lives here: if that one changes, this line changes with it, which is the
    // only way the shift message and the day report can stay reconcilable.
    profitUsd: totals.profit_usd,
    deliveryFeeUsd: totals.delivery_usd,
    deliveryCostUsd: totals.delivery_actual_cost_usd,
    deliveryCostRecorded: totals.delivery_actual_cost_count,
    // Customer refunds over the window, on the same net basis as revenue (they
    // are already subtracted from it). Attribution follows the kernel: a refund
    // belongs to the SALE's window, so a return taken this shift against
    // yesterday's receipt is yesterday's figure -- otherwise the two surfaces
    // would disagree about the same money.
    refundUsd: totals.refund_usd,
    // Not Paid, on the same net basis. Included in business revenue/profit,
    // but never in collected cash. Always printed as a positive "Credit"
    // figure -- see the owner's ruling in the header comment.
    creditUsd: totals.pending_revenue_usd,
    otherExpenseUsd: expenses.usd,
    otherExpenseKhr: expenses.khr,
    // Refunds and courier payouts no longer suppress the estimate: they are
    // subtracted components of it now (lib/shiftReconciliation.ts), so a shop
    // that takes one return a day stops seeing a permanent dash.
    cash: { ...reconciliation.cash_sales, needsReview: reconciliation.needs_review },
    additionalCash: reconciliation.additional_cash,
    reconciliation,
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
  return blocks.join(`\n${RULE}\n`)
}

/**
 * Push ONE shift's report to the alerts chat.
 *
 * Called from `POST /api/shifts/close` (routes/shifts.ts), inside the
 * `changed > 0` branch and through `c.executionCtx.waitUntil(...)`, so it
 * fires exactly once per close that actually wrote and never delays the till's
 * response. Returns false (never throws) when Telegram is not configured or
 * the id is unknown, so it can never turn a successful close into a failed
 * request.
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
  changeIsActualDual?: boolean
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
    const netUnitPrice = round2(Number(item.unitPriceUsd) || 0)
    const netLineTotal = round2(Number(item.lineTotalUsd) || 0)
    const grossUnitPrice = round2(base)
    const lineDiscount = Number.isFinite(base) && grossUnitPrice > netUnitPrice
      ? round2(Math.max(0, round2(grossUnitPrice * quantity) - netLineTotal))
      : 0
    const displayedUnitPrice = lineDiscount > 0 ? grossUnitPrice : netUnitPrice
    return `• ${cleanLine(item.name, 100)} ${quantity} × ${usd(displayedUnitPrice)}${lineDiscount ? ` (−${usd(lineDiscount)})` : ''} = ${usd(netLineTotal)}`
  })
  const deliveryFee = Number(sale.deliveryFeeUsd) || 0
  // Who paid it comes from the ONE rule that produced total_usd
  // (lib/saleTotals.ts). This used to test the payer against the string
  // 'shop'; the stored column, the POS constant and salesAnalytics all say
  // 'store', so every shop-absorbed delivery was billed into the Total line
  // below while Net Total excluded it, and the "(shop paid)" tag never
  // printed on the one message that was supposed to say it.
  const customerDelivery = customerBilledDeliveryFeeUsd(Boolean(sale.isDelivery), deliveryFee, sale.deliveryPaidBy)
  const shopAbsorbedDelivery = Boolean(sale.isDelivery) && deliveryFee > 0 && customerDelivery === 0
  const paid = (Number(sale.paidUsd) || 0) + (Number(sale.paidKhr) || 0)
  const change = (Number(sale.changeUsd) || 0) + (Number(sale.changeKhr) || 0)
  const status = String(sale.status || '').replace(/_/g, ' ')
  // lib/salesStatus.ts's one unsettled status, with the underscore already
  // taken out above. This is the ONLY thing that makes a sale credit.
  const unsettled = status === 'awaiting payment'
  // The pre-discount, pre-tax figure the customer was quoted. When there is
  // neither a discount nor a tax it IS the Net Total, and printing the same
  // dollars twice under two labels is precisely what the owner asked us to
  // stop doing -- so on the ordinary sale it does not print at all.
  const grossTotalUsd = round2((Number(sale.subtotalUsd) || 0) + customerDelivery)
  const totalRepeatsNet = grossTotalUsd === round2(Number(sale.totalUsd) || 0)
  return [
    // A completed sale is the norm this heading already announces ("Sale
    // recorded"), so only an out-of-the-ordinary status is worth a line.
    status && status !== 'completed' ? `Status: ${status}` : '',
    `Date: ${formatBusinessDateTime(sale.createdAt)}`,
    `INV: ${sale.receiptNumber}`,
    `Cashier: ${sale.cashier || 'Unknown'}`,
    sale.customer ? `Customer: ${sale.customer}` : '',
    sale.phone ? `Tel: ${sale.phone}` : '',
    sale.branch ? `Branch: ${sale.branch}` : '',
    ...items,
    sale.items.length > TELEGRAM_MAX_ITEM_LINES ? `+ ${sale.items.length - TELEGRAM_MAX_ITEM_LINES} more item(s)` : '',
    sale.isDelivery ? `Delivery service: ${usd(deliveryFee)}${shopAbsorbedDelivery ? ' (shop paid)' : ''}` : '',
    totalRepeatsNet ? '' : `Total: ${usd(grossTotalUsd)}`,
    sale.discountUsd ? `Discount: −${usd(sale.discountUsd)}` : '',
    sale.taxUsd ? `Tax: ${usd(sale.taxUsd)}` : '',
    // totalKhr is the converted equivalent of totalUsd, while paidUsd and
    // paidKhr are native tender amounts. Change from saleTotals is likewise
    // an equivalent pair unless a caller can explicitly establish that both
    // currencies were physically returned.
    //
    // A sale the customer has NOT settled states the amount ONCE, under the
    // word CREDIT -- the owner's ruling for this figure everywhere ("just use
    // credit ... instead of $-n ... just $n"). It used to print the same
    // dollars as a Net Total and then "Paid: unpaid" underneath: two lines,
    // one number, and the word the reader was looking for on neither of them.
    //
    // The trigger is the sale's own STATUS, never "no tender was passed to
    // this builder": a replacement hand-out and a completed sale whose
    // payment the caller did not supply are not credit, and calling them
    // credit would put a debt on a customer who owes nothing.
    ...(unsettled && paid <= 0
      ? [`Not Paid: ${money(sale.totalUsd, sale.totalKhr, ' / ')}`]
      : [
        `Net Total: ${money(sale.totalUsd, sale.totalKhr, ' / ')}`,
        // No recorded tender means no Paid line. The status carries the
        // "not paid" fact already, so a line saying it again is one more
        // line for nothing.
        paid > 0 ? `Paid: ${money(sale.paidUsd, sale.paidKhr, ' + ')}${sale.paymentMethod ? ` (${sale.paymentMethod})` : ''}` : '',
      ]),
    change > 0 ? `Change: ${money(sale.changeUsd, sale.changeKhr, sale.changeIsActualDual ? ' + ' : ' / ')}` : '',
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
    // A branch-less movement drops the line instead of printing the word
    // "Unassigned" -- the same zero-value rule the reports follow, and the
    // On hand line below already names whichever branches it can.
    change.branch ? `Branch: ${change.branch}` : '',
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
    // A transfer whose branch names did not reach this builder prints no
    // From/To line at all, rather than the placeholder words "Source" and
    // "Destination" -- the same zero-value rule that took "Branch:
    // Unassigned" out of the stock-change message. The two fallbacks are
    // still used to LABEL the on-hand numbers in the bullets above, where a
    // nameless quantity would be worse than a generic name.
    transfer.fromBranch ? `From: ${from}` : '',
    transfer.toBranch ? `To: ${to}` : '',
    ...items,
    transfer.items.length > TELEGRAM_MAX_ITEM_LINES ? `+ ${transfer.items.length - TELEGRAM_MAX_ITEM_LINES} more item(s)` : '',
    // ONE figure, like every other total this bot sends. The product count
    // that used to ride along here counted the bullets directly above it, and
    // a truncated list already states its own remainder on the line above.
    `Total moved: ${total} unit(s)`,
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
      // No refund money means no refund line. A settlement that moved no cash
      // (a replacement, a write-off) already says so on its own Settlement
      // line, so "Refund: none" was a line that stated nothing.
      : (hasMoney ? `Refund: ${money(ret.refundUsd, ret.refundKhr)}` : ''),
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
