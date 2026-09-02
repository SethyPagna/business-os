import { getDb } from './db'
import { businessToday, localTodayRangeClause } from './businessDateWindow'
import type { Env } from '../index'

export type TelegramEventType = 'sales' | 'status' | 'fees' | 'stock_in' | 'stock_out'
export type TelegramEvent = { type: TelegramEventType; lines: string[] }

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
  await postTelegram(config, [heading[event.type], ...event.lines.map((line) => cleanLine(line))].filter(Boolean).join('\n'))
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
