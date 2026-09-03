import { getDb } from './db'
import { BUSINESS_UTC_OFFSET_MINUTES, businessToday, localTodayRangeClause } from './businessDateWindow'
import type { Env } from '../index'

export type TelegramEventType = 'sales' | 'status' | 'fees' | 'stock_in' | 'stock_out'
// `heading` lets a route name the event (a return is not a sale, a transfer
// is not a plain stock-out) while `type` stays the user's enable switch.
export type TelegramEvent = { type: TelegramEventType; lines: string[]; heading?: string }

type TelegramConfig = {
  enabled: boolean; chatId: string; token: string
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
function money(usd: unknown, khr: unknown): string {
  const usdValue = Number(usd) || 0; const khrValue = Number(khr) || 0; const parts: string[] = []
  if (usdValue) parts.push(`$${usdValue.toFixed(2)}`)
  if (khrValue) parts.push(`${Math.round(khrValue).toLocaleString()}៛`)
  return parts.length ? parts.join(' · ') : '$0.00'
}

async function getTelegramConfig(env: Env): Promise<TelegramConfig> {
  const rows = await getDb(env).prepare(`SELECT key, value FROM settings WHERE key IN (${SETTING_KEYS.map(() => '?').join(',')})`).all<{ key: string; value: string }>([...SETTING_KEYS])
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<string, string>
  return {
    enabled: isEnabled(values.telegram_automation_enabled, true), chatId: cleanLine(values.telegram_chat_id, 80),
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
  await postTelegram(config, [event.heading || heading[event.type], ...event.lines.map((line) => cleanLine(line))].filter(Boolean).join('\n'))
  return true
}

export async function getTelegramStatus(env: Env): Promise<{ configured: boolean; connected: boolean; enabled: boolean }> {
  const config = await getTelegramConfig(env)
  return { configured: Boolean(config.token), connected: !configurationProblem(config), enabled: config.enabled }
}
export async function sendTelegramTest(env: Env): Promise<void> {
  const config = await getTelegramConfig(env); const problem = configurationProblem(config)
  if (problem) throw new Error(problem)
  await postTelegram(config, '✅ Business OS Telegram automation and owner/manager commands are connected. All notification categories are enabled by default; use Settings to turn any category off.')
  await configureTelegramWebhook(env)
}

async function todayStats(env: Env) {
  const db = getDb(env); const today = businessToday()
  const [sales, fees, stockIn, stockOut] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total_usd), 0) AS usd, COALESCE(SUM(total_khr), 0) AS khr FROM sales WHERE ${localTodayRangeClause('created_at')}`).get<{ count: number; usd: number; khr: number }>(),
    db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_khr), 0) AS khr FROM fees WHERE fee_date = @today`).get<{ count: number; usd: number; khr: number }>({ today }),
    db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS quantity FROM inventory_movements WHERE movement_type IN ('add', 'transfer_in', 'move_in') AND ${localTodayRangeClause('created_at')}`).get<{ count: number; quantity: number }>(),
    db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS quantity FROM inventory_movements WHERE movement_type IN ('remove', 'transfer_out', 'move_out') AND ${localTodayRangeClause('created_at')}`).get<{ count: number; quantity: number }>(),
  ])
  return { today, sales, fees, stockIn, stockOut }
}
function formatTodaySummary(stats: Awaited<ReturnType<typeof todayStats>>, categories?: Partial<Record<TelegramEventType, boolean>>): string {
  const lines = [`📊 Business summary — ${stats.today}`]
  if (categories?.sales !== false) lines.push(`Sales: ${Number(stats.sales?.count || 0)} receipt(s) · ${money(stats.sales?.usd, stats.sales?.khr)}`)
  if (categories?.fees !== false) lines.push(`Fees: ${Number(stats.fees?.count || 0)} record(s) · ${money(stats.fees?.usd, stats.fees?.khr)}`)
  if (categories?.stock_in !== false) lines.push(`Stock in: ${Number(stats.stockIn?.count || 0)} movement(s) · ${Number(stats.stockIn?.quantity || 0)} unit(s)`)
  if (categories?.stock_out !== false) lines.push(`Stock out: ${Number(stats.stockOut?.count || 0)} movement(s) · ${Number(stats.stockOut?.quantity || 0)} unit(s)`)
  return lines.join('\n')
}
export async function sendTelegramTodaySummary(env: Env): Promise<void> {
  const config = await getTelegramConfig(env); const problem = configurationProblem(config)
  if (problem) throw new Error(problem)
  await postTelegram(config, formatTodaySummary(await todayStats(env), config.categories))
}

async function salesReport(env: Env): Promise<string> {
  const db = getDb(env); const stats = await todayStats(env)
  const sales = await db.prepare(`SELECT id, receipt_number, cashier_name, total_usd, total_khr FROM sales WHERE ${localTodayRangeClause('created_at')} ORDER BY created_at DESC LIMIT 5`).all<{ id: number; receipt_number: string | null; cashier_name: string | null; total_usd: number; total_khr: number }>()
  if (!sales.length) return `🛍️ Sales — ${stats.today}\nNo sales recorded today.`
  const ids = sales.map((sale) => sale.id)
  const items = await db.prepare(`SELECT sale_id, product_name, quantity, applied_price_usd, applied_price_khr FROM sale_items WHERE sale_id IN (${ids.map(() => '?').join(',')}) ORDER BY id ASC`).all<{ sale_id: number; product_name: string | null; quantity: number; applied_price_usd: number; applied_price_khr: number }>(ids)
  const bySale = new Map<number, typeof items>(); for (const item of items) bySale.set(item.sale_id, [...(bySale.get(item.sale_id) || []), item])
  const lines = [`🛍️ Sales — ${stats.today}`, `Total: ${Number(stats.sales?.count || 0)} receipt(s) · ${money(stats.sales?.usd, stats.sales?.khr)}`, '', 'Latest receipts:']
  for (const sale of sales) {
    lines.push(`• ${sale.receipt_number || `Sale #${sale.id}`} · ${money(sale.total_usd, sale.total_khr)} · ${cleanLine(sale.cashier_name || 'No cashier')}`)
    const saleItems = bySale.get(sale.id) || []
    for (const item of saleItems.slice(0, 4)) lines.push(`  ${Number(item.quantity)} × ${cleanLine(item.product_name || 'Item', 100)} — ${money(item.applied_price_usd, item.applied_price_khr)} each`)
    if (saleItems.length > 4) lines.push(`  + ${saleItems.length - 4} more item(s)`)
  }
  return lines.join('\n')
}
async function feesReport(env: Env): Promise<string> {
  const db = getDb(env); const stats = await todayStats(env)
  const fees = await db.prepare('SELECT fee_type, label, amount_usd, amount_khr FROM fees WHERE fee_date = @today ORDER BY id DESC LIMIT 8').all<{ fee_type: string; label: string | null; amount_usd: number; amount_khr: number }>({ today: stats.today })
  const lines = [`💸 Fees — ${stats.today}`, `Total: ${Number(stats.fees?.count || 0)} record(s) · ${money(stats.fees?.usd, stats.fees?.khr)}`]
  for (const fee of fees) lines.push(`• ${cleanLine(fee.fee_type)}${fee.label ? ` — ${cleanLine(fee.label, 90)}` : ''}: ${money(fee.amount_usd, fee.amount_khr)}`)
  return lines.join('\n')
}
async function inventoryReport(env: Env): Promise<string> {
  const db = getDb(env)
  const rows = await db.prepare(`SELECT name, stock_quantity, low_stock_threshold, out_of_stock_threshold FROM products WHERE is_active = 1 AND COALESCE(stock_quantity, 0) <= COALESCE(low_stock_threshold, 10) ORDER BY COALESCE(stock_quantity, 0) ASC, name ASC LIMIT 12`).all<{ name: string; stock_quantity: number; low_stock_threshold: number; out_of_stock_threshold: number }>()
  const lines = ['📦 Low-stock report']; if (!rows.length) return `${lines[0]}\nNo active product is at or below its low-stock threshold.`
  lines.push(`${rows.length} item(s) need attention:`)
  for (const row of rows) { const status = Number(row.stock_quantity || 0) <= Number(row.out_of_stock_threshold || 0) ? 'OUT' : 'LOW'; lines.push(`• [${status}] ${cleanLine(row.name, 120)} — ${Number(row.stock_quantity || 0)} left (alert at ${Number(row.low_stock_threshold || 10)})`) }
  return lines.join('\n')
}
async function inventorySummaryReport(env: Env): Promise<string> {
  const row = await getDb(env).prepare(`SELECT
    COUNT(*) AS products,
    COALESCE(SUM(stock_quantity), 0) AS units,
    COALESCE(SUM(CASE WHEN COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0) THEN 1 ELSE 0 END), 0) AS out_of_stock,
    COALESCE(SUM(CASE WHEN COALESCE(stock_quantity, 0) > COALESCE(out_of_stock_threshold, 0) AND COALESCE(stock_quantity, 0) <= COALESCE(low_stock_threshold, 10) THEN 1 ELSE 0 END), 0) AS low_stock
    FROM products WHERE is_active = 1`).get<{ products: number; units: number; out_of_stock: number; low_stock: number }>()
  return ['📦 Inventory summary', `Active products: ${Number(row?.products || 0)}`, `Units on hand: ${Number(row?.units || 0)}`, `Low stock: ${Number(row?.low_stock || 0)} · Out of stock: ${Number(row?.out_of_stock || 0)}`, 'Use /stock for the low-stock product list.'].join('\n')
}
function commandHelp(): string { return ['🤖 Business OS reports', '/today — today’s sales, fees, and stock movements', '/sales — today’s sales with items, prices, and cashiers', '/fees — today’s fee records', '/inventory — stock totals and health', '/stock — low-stock products', '/help — this command list'].join('\n') }
function normalizeCommand(text: string): string { return String(text || '').trim().split(/\s+/)[0].toLowerCase().replace(/@[^\s]+$/, '') }

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
  // The configured Telegram chat is the access boundary. It must therefore
  // be a direct owner chat or a manager-only group, never a staff alerts group.
  if (commandProblem(config) || chatId !== config.chatId) return
  const command = normalizeCommand(text)
  let reply = commandHelp()
  if (command === '/today' || command === '/summary') reply = formatTodaySummary(await todayStats(env))
  else if (command === '/sales') reply = await salesReport(env)
  else if (command === '/fees') reply = await feesReport(env)
  else if (command === '/inventory') reply = await inventorySummaryReport(env)
  else if (command === '/stock' || command === '/lowstock') reply = await inventoryReport(env)
  await postTelegram(config, reply, chatId)
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
const round2 = (value: number) => Math.round(value * 100) / 100
const usd = (value: unknown) => `$${(Number(value) || 0).toFixed(2)}`

// mm/dd/yyyy HH:mm in the business day's zone (UTC+7) -- the app-wide display
// convention. D1's CURRENT_TIMESTAMP is 'YYYY-MM-DD HH:MM:SS' UTC without a
// zone marker; client-sent created_at is ISO with one. Missing/invalid -> now.
export function formatBusinessDateTime(value?: string | null, nowMs = Date.now()): string {
  const raw = String(value || '').trim()
  const parsed = raw ? Date.parse(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`) : Number.NaN
  const local = new Date((Number.isFinite(parsed) ? parsed : nowMs) + BUSINESS_UTC_OFFSET_MINUTES * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(local.getUTCMonth() + 1)}/${pad(local.getUTCDate())}/${local.getUTCFullYear()} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`
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
    `Change: ${change.type === 'add' ? '+' : '−'}${quantity}`,
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
