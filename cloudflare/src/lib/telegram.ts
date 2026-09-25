import { getDb } from './db'
import { loadLowStockConfig, lowStockThresholdSql } from './lowStockSettings'
import { customerBilledDeliveryFeeUsd } from './saleTotals'
import { BUSINESS_UTC_OFFSET_MINUTES, businessToday, localDateRangeClause } from './businessDateWindow'
import {
  bi, firstCharacters, getTelegramLanguage, HANGING_INDENT, label, labeled, localizeTelegramHeading, localizeTelegramLine, localizeTelegramValue, moreItems, normalizeTelegramLanguage, REPORT_SECTION_EDGE, ROW_BULLET, row, RULE, saleStatusMoneyLabel,
  parseReportDate, setTelegramLanguage, SHIFT_SECTION_EDGE, telegramCommandReference, telegramUnauthorizedReply,
} from './telegramLang'
import type { TelegramLabelKey, TelegramLanguage } from './telegramLang'
import {
  getDeliveryContactTotals, getPaymentMethodBreakdown, getSalesGroupedTotals, getSalesTotals,
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

/** The owner's per-category switches, as every report consumer sees them. */
export type TelegramCategories = Partial<Record<TelegramEventType, boolean>>

type TelegramConfig = {
  enabled: boolean; chatId: string; chatIds: string[]; token: string
  categories: Record<TelegramEventType, boolean>
  /** Settings → Telegram → language: 'both' (default), 'en' or 'km'. */
  language: TelegramLanguage
  /**
   * T10: the Reports overview pushed one minute after a shift closes. Its own
   * switch, not a category: it is a scheduled report, not an event alert.
   * Unset means ON, because the shift report it follows has no switch of its
   * own and is on whenever automation is (the owner's "default ON only if the
   * shift report is on"); `enabled` above still gates both.
   */
  shiftOverview: boolean
  /** Per-message-family forum topic (message_thread_id); undefined = General. */
  topics: Record<TelegramTopicKey, number | undefined>
}
type TelegramMessage = { text?: string; from?: { id?: number | string }; chat?: { id?: number | string }; message_thread_id?: number }
type TelegramUpdate = { message?: TelegramMessage }

// The owner's Telegram forum topics: one settings key per message family,
// read the same way every other Telegram setting is (generic key/value, no
// migration). Empty means "send to General", exactly as before this existed.
export const TELEGRAM_TOPIC_KEYS = [
  'telegram_topic_shift', 'telegram_topic_sales', 'telegram_topic_status',
  'telegram_topic_expenses', 'telegram_topic_stock', 'telegram_topic_reports', 'telegram_topic_alerts',
] as const
export type TelegramTopicKey = typeof TELEGRAM_TOPIC_KEYS[number]

// sql-bound-params: bounded by construction -- this fixed enum is owned by
// this module and never grows from request or database input.
const SETTING_KEYS = [
  'telegram_automation_enabled', 'telegram_chat_id', 'telegram_language',
  'telegram_sales_enabled', 'telegram_status_enabled', 'telegram_fees_enabled', 'telegram_stock_in_enabled', 'telegram_stock_out_enabled',
  'telegram_shift_overview_enabled',
  ...TELEGRAM_TOPIC_KEYS,
] as const

// Integer or empty -- a non-numeric or fractional value is treated as unset
// rather than sent to Telegram as a broken thread id. routes/settings.ts
// enforces the same rule on write; this is the defensive read.
export function parseTelegramTopicId(value: string | undefined | null): number | undefined {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return undefined
  if (!/^\d+$/.test(trimmed)) return undefined
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function isEnabled(value: string | undefined, fallback: boolean): boolean {
  return value == null || value === '' ? fallback : String(value).trim().toLowerCase() !== 'false'
}
// `max` counts characters, not UTF-16 units: a cut never halves an emoji
// (firstCharacters in telegramLang.ts says why that matters).
function cleanLine(value: unknown, max = 300): string {
  return firstCharacters(String(value ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim(), max)
}

// Owner, 23 Sep 2026, over a 15-item sale alert: "for each new line in this
// report to telegram we can do some add spaced so they don't show directly
// from new line so easier to read. like an indentation so it doesn't start
// with numbered list." A phone wraps a row wider than its message bubble back
// to the left edge, under the item numbers and bullets, where the rest of the
// row reads as the next row. So a list row is broken HERE, at a width a phone
// held upright shows whole, and every line after its first is indented. 36
// characters: the widest price line of that sale, indented (`1 × $350.00
// (−$10.00) = $340.00`), still fits.
const TELEGRAM_ROW_WIDTH = 36

// A marker (`1.`, `•`, `↔`) or a separator (`·`, `—`, `=`, `×`, `→`) never
// ends a line: it stays with the word after it.
const BINDS_FORWARD = /(?:^| )(?:\d+\.|[•↔·—=×→])$/
function rowWords(text: string): string[] {
  const words: string[] = []
  for (const word of text.split(' ').filter(Boolean)) {
    const last = words.length - 1
    if (last >= 0 && BINDS_FORWARD.test(words[last])) words[last] += ` ${word}`
    else words.push(word)
  }
  return words
}

/**
 * A list row (`1. name …`, `• name …`) as the lines a phone shows it on.
 * `head` breaks between words. `parts` share one line when they fit one
 * (`1 × $28.00 (−$3.00) = $25.00`); otherwise each part stays whole where it
 * fits, one wider than a line breaks at its own separators (`· Warehouse 90`
 * `· Shop 25` `· all branches 115`), and a piece still wider between words.
 * `nest` indents the whole row under the row above it (a /sales receipt's
 * items), and its continuation lines by the hanging indent beyond that.
 */
export function telegramRowLines(head: string, parts: string[] = [], nest = ''): string[] {
  const first = TELEGRAM_ROW_WIDTH - nest.length
  const rest = first - HANGING_INDENT.length
  const lines: string[] = []
  const place = (piece: string) => {
    const last = lines.length - 1
    if (last >= 0 && lines[last].length + 1 + piece.length <= (last ? rest : first)) lines[last] += ` ${piece}`
    else lines.push(piece)
  }
  const pieces = (part: string): string[] => (part.length <= rest ? [part]
    : part.split(/ (?=[—·] )/).flatMap((piece) => (piece.length <= rest ? [piece] : rowWords(piece))))
  rowWords(head).forEach(place)
  const tail = parts.filter(Boolean)
  const whole = tail.join(' ')
  if (whole && whole.length <= rest) place(whole)
  else tail.flatMap(pieces).forEach(place)
  return lines.map((line, index) => `${nest}${index ? HANGING_INDENT : ''}${line}`)
}

// Money formatters, kept together with money() below so a new message cannot
// grow a third way of printing a dollar amount.
const round2 = (value: number) => Math.round(value * 100) / 100
const usd = (value: unknown) => `$${round2(Number(value) || 0).toFixed(2)}`
// p5/losses (Sep 15 2026): a terse, numbers-only suffix for the "loss" line
// when some of its rows carried no cost anywhere -- the concise-report rule
// (no explanatory prose) means this is a bare count, not a sentence.
const unvaluedSuffix = (count: unknown) => (Number(count) > 0 ? ` (${Math.round(Number(count))}?)` : '')
const riel = (value: unknown) => `${Math.round(Number(value) || 0).toLocaleString('en-US')}៛`
function money(usd: unknown, khr: unknown, separator = ' · '): string {
  const usdValue = Number(usd) || 0; const khrValue = Number(khr) || 0; const parts: string[] = []
  if (usdValue) parts.push(`$${usdValue.toFixed(2)}`)
  if (khrValue) parts.push(`${Math.round(khrValue).toLocaleString()}៛`)
  return parts.length ? parts.join(separator) : '$0.00'
}
// 'N/A', not an em dash, for a currency half with no value -- owner, 25 Sep
// 2026: "No em dash (—) anywhere in Telegram output". Reuses the module's own
// NOT_APPLICABLE constant (declared further down, beside EMPTY_SECTION); the
// reference is safe because this function only ever runs after module load.
function registeredMoney(usdValue: number | null, khrValue: number | null): string {
  const dollars = usdValue == null ? NOT_APPLICABLE : usd(usdValue)
  const rielAmount = khrValue == null ? NOT_APPLICABLE : riel(khrValue)
  return `${dollars} · ${rielAmount}`
}

// The alerts chat id setting doubles as the COMMAND ALLOW-LIST. A Telegram
// chat id is digits with an optional leading '-', so a comma/space separated
// list is unambiguous and an existing single-id setting keeps working
// untouched -- no new setting, no Settings-screen change, and the owner can
// approve a second manager group by typing one more id.
/**
 * Compose one message in the shop's chosen Telegram language.
 *
 * The mode itself is ONE module-level variable in lib/telegramLang.ts (see the
 * note there), and this is the only way this file sets it: the callback is
 * SYNCHRONOUS -- every `format*` builder is -- so nothing can await between
 * setting the mode and restoring it, and the previous value always comes back
 * even if a builder throws. `telegram_language` is shop-wide besides, so two
 * overlapping requests in one isolate are asking for the same mode anyway.
 */
function withLanguage<T>(language: string | null | undefined, compose: () => T): T {
  const previous = getTelegramLanguage()
  setTelegramLanguage(language)
  try { return compose() } finally { setTelegramLanguage(previous) }
}

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
    language: normalizeTelegramLanguage(values.telegram_language),
    shiftOverview: isEnabled(values.telegram_shift_overview_enabled, true),
    // Everything is live after the first setup; individual category switches
    // remain available when a less noisy chat is preferred.
    categories: {
      sales: isEnabled(values.telegram_sales_enabled, true), status: isEnabled(values.telegram_status_enabled, true),
      fees: isEnabled(values.telegram_fees_enabled, true), stock_in: isEnabled(values.telegram_stock_in_enabled, true), stock_out: isEnabled(values.telegram_stock_out_enabled, true),
    },
    topics: Object.fromEntries(TELEGRAM_TOPIC_KEYS.map((key) => [key, parseTelegramTopicId(values[key])])) as Record<TelegramTopicKey, number | undefined>,
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

async function postTelegram(config: TelegramConfig, text: string, chatId = config.chatId, messageThreadId?: number): Promise<void> {
  for (const part of splitTelegramMessage(text)) {
    const response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId, text: part, disable_web_page_preview: true,
        ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
      }),
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
  // No default for `sales` or `status`: those alerts' headings name their
  // receipt number (owner's Sep 23 2026 samples, "🛍️ Sale Invoice /
  // វិក្កយបត្រការលក់: 20260923-153527" and "🧾 Invoice / វិក្កយបត្រ:
  // 20260922-110132"), which only formatSaleTelegramLines and
  // formatSaleStatusTelegramLines know, so their first line IS the heading.
  // A route's own heading still wins (a return).
  const heading: Partial<Record<TelegramEventType, string>> = { fees: '💸 Fee recorded', stock_in: '📥 Stock in', stock_out: '📤 Stock out' }
  // Per-message-family forum topic (owner's Telegram topics, 25 Sep 2026):
  // sales and status get their own topic each; fees, stock in and stock out
  // share the Expenses/Stock slots this event type maps onto.
  const eventTopic: Record<TelegramEventType, TelegramTopicKey> = {
    sales: 'telegram_topic_sales', status: 'telegram_topic_status',
    fees: 'telegram_topic_expenses', stock_in: 'telegram_topic_stock', stock_out: 'telegram_topic_stock',
  }
  // S4-8: the ONE place every event message becomes bilingual. Doing it on
  // the composed line (rather than in each builder) means the one route that
  // still assembles its lines inline -- routes/fees.ts's fee -- is covered
  // without editing a file another lane owns, and any line added later is
  // covered the moment its label is in the table.
  await postTelegram(config, withLanguage(config.language, () => [
    localizeTelegramHeading(event.heading || heading[event.type] || ''),
    // cleanLine trims, so the rest of a list row (telegramRowLines) gets its
    // indent back after cleaning. It continues the row above; it is not a
    // label row of its own to localize. A section marker (eventGroups) is
    // resolved to its titled `====Name/ខ្មែរ====` header HERE, inside
    // withLanguage, so it renders in the shop's own language setting instead
    // of whatever was left in telegramLang's module state when the route
    // built these lines.
    ...event.lines.map((line) => (line.startsWith(HANGING_INDENT)
      ? `${HANGING_INDENT}${cleanLine(line, 400)}`
      : line.startsWith(EVENT_SECTION_MARKER)
        ? sectionHeader(line.slice(EVENT_SECTION_MARKER.length) as TelegramLabelKey, REPORT_SECTION_EDGE)
        : localizeTelegramLine(cleanLine(line, 400)))),
  ].filter(Boolean).join('\n')), config.chatId, config.topics[eventTopic[event.type]])
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
  await postTelegram(config, withLanguage(config.language, () => [
    `✅ ${bi('Business OS alerts and commands are connected.', 'ការជូនដំណឹង និងពាក្យបញ្ជា Business OS បានភ្ជាប់រួចរាល់។')}`,
    '',
    telegramCommandReference(),
  ].join('\n')), config.chatId, config.topics.telegram_topic_alerts)
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
  // to add up the same two things. See expenseTotals() below.
  deliveryCostUsd: number; deliveryCostRecorded: number
  /**
   * Stock removed entirely over the window, priced at cost -- the owner's
   * "if remove directly it also counts toward losses. as cost price no
   * selling price means loss" (Sep 14 2026). OPTIONAL on purpose: the kernel
   * omits the key when it could not scope the window to stock movements, and
   * a missing figure must not print as "Loss $0.00", which would assert that
   * nothing was destroyed.
   */
  removalLossUsd?: number
  /** Of removalLossUsd's rows, how many carried no cost anywhere -- p5/losses
   *  (Sep 15 2026), owner: "i see the report says row removed has 1 no cost
   *  price. this is impossible find issue and fix". Never dropped silently. */
  removalLossUnvaluedRows?: number
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
      // Stock destroyed outright, at cost. Same kernel field the Reports hub
      // and the Dashboard read, so the three surfaces cannot disagree. Note
      // the `stockOut` line below is NOT this figure: it counts quantity over
      // remove + transfer_out + move_out, and a transfer is not a loss.
      removalLossUsd: totals.removal_loss_usd,
      removalLossUnvaluedRows: totals.removal_loss_unvalued_rows,
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
  `${icon} ${bi(en, km)}${date ? `: ${formatBusinessDay(date)}` : ''}`

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
 * ARITHMETIC ONLY (Sep 21 2026). It used to hand back two rendered lines as
 * well; each report now draws its own Expenses SECTION -- the shift lists the
 * individual expenses, the day summary has no per-fee rows to list -- so the
 * shared thing is the sum, not the layout. One definition, two renderings,
 * no second way of adding delivery to fees.
 */
function expenseTotals(input: { otherUsd: unknown; otherKhr: unknown; deliveryCostUsd: unknown; deliveryCostRecorded: unknown }): { courierUsd: number; otherUsd: number; otherKhr: number; totalUsd: number } {
  const courierUsd = Number(input.deliveryCostRecorded) > 0 ? round2(Number(input.deliveryCostUsd) || 0) : 0
  const otherUsd = round2(Number(input.otherUsd) || 0)
  const otherKhr = Number(input.otherKhr) || 0
  return { courierUsd, otherUsd, otherKhr, totalUsd: round2(otherUsd + courierUsd) }
}

// ---- The sectioned layout (owner, Sep 21 2026) -----------------------------
// "Shift should look something like this ... just smarter and compact, same
// for other telegram report enough spacing and separations that it feels easy
// to read and clean, using dividers, numbered list, etc... title etc..."
//
// Every report is: a TITLE line, then titled sections. Inside a section every
// row opens with `·` -- one figure per line, or one list entry per line --
// and only the items under a /sales receipt stay numbered.
//
// Sep 23 2026 the drawn rule and the `N.` number that opened each section
// went. A section now opens with ONE line, its name between two edges and
// nothing drawn above it. Since 25 Sep 2026 EVERY report shares the same
// glyph, `=`: `====Sales/ការលក់====` in the day summary, /sales, /fees,
// /stock, /inventory AND the shift report alike (REPORT_SECTION_EDGE and
// SHIFT_SECTION_EDGE, both `=` now -- see telegramLang.ts). Five marks a
// side is the most: sectionHeader takes fewer when five would push the line
// onto a second row. RULE is left for what separates WHOLE blocks: the shift
// reports a `/shift` answer joins, and the command reference.

/** The most marks a section header stands on either side of its name. */
const SECTION_EDGE_MARKS = 5

/**
 * `=====Sales / ការលក់=====` -- a section's name between its marks, on one
 * line, with nothing drawn above it. The mark names the family:
 * REPORT_SECTION_EDGE or SHIFT_SECTION_EDGE.
 *
 * Five a side is the most, not a fixed count. Owner, Sep 23 2026: "for the
 * header marks, make sure the line stays in one line/row. this means you can
 * use less header marks if it pushes to next row for the telegram message."
 * So a header takes the most marks, up to five a side, that keep it within
 * one phone row -- TELEGRAM_ROW_WIDTH, counted with `.length` exactly as
 * telegramRowLines counts a row -- and never fewer than one:
 * `---Cash count / ការរាប់សាច់ប្រាក់---`. A name that fills the row on its
 * own keeps one mark a side, because the marks are what make it a header:
 * `=Latest receipts / វិក្កយបត្រចុងក្រោយ=` is 36 by that count before its
 * marks, and `.length` counts every Khmer vowel sign and subscript as a
 * character, so it takes 29 characters on screen.
 *
 * Exported for scripts/test-telegram-shift-report-pure.cjs.
 */
export const sectionHeader = (key: TelegramLabelKey, edge: string): string => {
  const name = label(key)
  const marks = edge.repeat(Math.max(1, Math.min(SECTION_EDGE_MARKS, Math.floor((TELEGRAM_ROW_WIDTH - name.length) / 2))))
  return `${marks}${name}${marks}`
}

/** A section the shop has no rows for still prints, so the shape of the
 *  message never moves (the owner's reference shows every section, empty
 *  ones included).
 *
 *  `N/A` since Sep 22 2026 (owner: "show n/a"). The bare `—` it replaced read
 *  as a rendering accident -- a row whose value failed to print -- rather than
 *  as the fact that there is nothing to report. `N/A` is left untranslated on
 *  purpose: it is the same two letters in the Khmer half of every form in this
 *  app, and a Khmer paraphrase of "no data" would be longer than the rows it
 *  stands in for. The shift report's Close row says the same `N/A` while the
 *  shift is still open (the owner's Sep 23 2026 sample: "Close / បិទ: N/A"). */
const NOT_APPLICABLE = 'N/A'
const EMPTY_SECTION = `${ROW_BULLET}${NOT_APPLICABLE}`

/**
 * `· Total: 24 · Cancelled: 1 · Edited: 2` -- one compact row for counts of
 * the SAME thing. The first entry always prints (a shift that rang nothing up
 * still states it); the rest only when they are non-zero.
 *
 * Composed from `label()` rather than `labeled()`: this is ONE row carrying
 * several pairs, so it opens with ONE bullet.
 */
const countRow = (entries: Array<[TelegramLabelKey, number]>): string =>
  ROW_BULLET + entries.filter(([, value], index) => index === 0 || value > 0).map(([key, value]) => `${label(key)}: ${value}`).join(' · ')

/**
 * At most `limit` rows; everything past it folds into ONE "Other" row, so a
 * capped breakdown still adds up to the section's own total instead of
 * quietly losing the tail.
 */
function foldRows<T>(rows: T[], limit: number, fold: (rest: T[]) => T): T[] {
  return rows.length <= limit ? rows : [...rows.slice(0, limit - 1), fold(rows.slice(limit - 1))]
}

/**
 * The day summary -- `/report`, and the scheduled push.
 *
 * SAME SHAPE AS THE SHIFT REPORT, deliberately (owner, Sep 6 2026: "arrange
 * all reports more concise with breakdowns clearly", and Sep 21 2026: "same
 * for other telegram report ... using dividers, numbered list, etc... title
 * etc..."): a title line, then titled sections -- Sales, Invoices, Expenses,
 * Stock, Cashiers -- one figure per line, a zero-value line simply not
 * printed, and not one explanatory sentence. Two people reading the evening
 * `/report` and tonight's shift message see the same section titles carrying
 * the same figures in the same order.
 *
 * Each section opens with `=====Sales / ការលក់=====` since Sep 23 2026
 * (owner: "for telegram reports, instead of plain line ------we can do
 * =====section name===== instead."): no rule above it and no number in
 * front, and the cashier list is `·` rows like every figure.
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
export function formatDaySummary(stats: DayStats, cashiers: CashierRow[], categories?: TelegramCategories): string {
  const showSales = categories?.sales !== false
  const lines = [reportTitle('📊', 'Business summary', 'សង្ខេបអាជីវកម្ម', stats.date)]
  // A section with no rows still prints its heading and says N/A, the rule
  // every other report already follows (the shift report and /fees). It used
  // to return here, so a quiet day's /report stopped after its second section
  // and the reader had to work out whether the shop had no expenses or
  // whether the message had been cut short. A category the owner switched
  // OFF is still removed entirely -- that gate is the `if (showSales)`-style
  // check at each call site, not this emptiness.
  const section = (key: TelegramLabelKey, rows: string[], enabled = true): void => {
    // Switched OFF is not the same fact as empty, and only the call site
    // knows which one it has: a category the owner turned off leaves no
    // heading, while a category that is on and simply had nothing today says
    // N/A under its heading.
    if (!enabled) return
    lines.push(sectionHeader(key, REPORT_SECTION_EDGE), ...(rows.length ? rows : [EMPTY_SECTION]))
  }

  // Expenses is computed first because the Sales section needs one figure out
  // of it: the courier money. See the Expenses comment below.
  const showExpenses = categories?.fees !== false
  const expenses = expenseTotals({
    otherUsd: showExpenses ? stats.fees?.usd : 0,
    otherKhr: showExpenses ? stats.fees?.khr : 0,
    deliveryCostUsd: showSales ? stats.sales?.deliveryCostUsd : 0,
    deliveryCostRecorded: showSales ? stats.sales?.deliveryCostRecorded : 0,
  })

  // Sales -- Revenue and Profit print even at $0.00: a day that took
  // nothing is a fact the owner wants stated, not a blank. Every other line
  // is dropped when it is zero.
  if (showSales) {
    const sales = [labeled('revenue', usd(stats.sales?.usd)), labeled('profit', usd(stats.sales?.profitUsd))]
    if (stats.sales?.deliveryFeeUsd) sales.push(labeled('deliveryFee', usd(stats.sales.deliveryFeeUsd)))
    // The courier money is a SALES figure -- it comes out of the day's
    // deliveries, not out of the fees table -- and it is normally reported
    // under Expenses with the shop's own fees. With Expenses switched off
    // there is no section to report it in, so it stays here, beside the fee
    // the customer was charged, rather than disappearing with a switch that
    // was only ever about the fees table.
    if (!showExpenses && expenses.courierUsd > 0) sales.push(labeled('deliveryCost', usd(expenses.courierUsd)))
    if (stats.sales?.creditUsd) sales.push(labeled('credit', usd(stats.sales.creditUsd)))
    // Directly below Not Paid, the owner's "also add one row below unpaid in
    // reports as well". One number, no sentence. Like Not Paid it is a
    // POSITIVE memo and is never subtracted from the lines above -- those stay
    // the canonical figures the app's own stats show.
    if (stats.sales?.removalLossUsd) sales.push(labeled('loss', usd(stats.sales.removalLossUsd) + unvaluedSuffix(stats.sales.removalLossUnvaluedRows)))
    if (stats.sales?.refundUsd) sales.push(labeled('refunds', usd(stats.sales.refundUsd)))
    section('sales', sales)
    // Invoices -- the counts, on their own. They are the breakdown of the
    // Revenue above (refunds subtracted, voids contributing nothing), never a
    // second total.
    section('invoices', [countRow([['total', Number(stats.sales?.count) || 0], ['cancelled', Number(stats.sales?.cancelled) || 0]])])
  }

  // Expenses -- the SAME sum the shift report prints, through the same
  // function: the fees of the day plus the courier money actually paid out.
  const expenseRows: string[] = []
  // The two component lines print only when the total really has two parts.
  // With one part the total IS that part, and printing it twice under two
  // names is the repeated figure the owner asked us to take out.
  if (expenses.courierUsd > 0 && (expenses.otherUsd > 0 || expenses.otherKhr > 0)) {
    expenseRows.push(labeled('deliveryCost', usd(expenses.courierUsd)), labeled('expensesOther', money(expenses.otherUsd, expenses.otherKhr)))
  }
  if (expenses.totalUsd || expenses.otherKhr) expenseRows.push(labeled('total', money(expenses.totalUsd, expenses.otherKhr)))
  // OFF means gone -- no heading and no `N/A` placeholder. It used to stay
  // alive whenever Sales was on, so a shop that switched Expenses off was
  // still sent the Expenses heading with `· N/A` under it on every quiet
  // day: a section they had asked not to see, saying nothing. `N/A` is for a
  // section that is ON and had nothing today; that distinction is the whole
  // point of the `enabled` argument.
  section('expenses', expenseRows, showExpenses)

  // Stock
  const stock: string[] = []
  if (categories?.stock_in !== false && (stats.stockIn?.count || stats.stockIn?.quantity)) stock.push(labeled('stockIn', `${counted(stats.stockIn?.count, 'movement(s)')} · ${counted(stats.stockIn?.quantity, 'unit(s)')}`))
  if (categories?.stock_out !== false && (stats.stockOut?.count || stats.stockOut?.quantity)) stock.push(labeled('stockOut', `${counted(stats.stockOut?.count, 'movement(s)')} · ${counted(stats.stockOut?.quantity, 'unit(s)')}`))
  section('stock', stock, categories?.stock_in !== false || categories?.stock_out !== false)

  // Cashiers -- name, receipts, money. The bilingual "receipt(s)" counter
  // is dropped here and only here: the section is a list of cashiers, so the
  // count needs no noun, and repeating a two-language word on every bullet is
  // what made this block long.
  section('cashiers', cashiers.flatMap((row) => telegramRowLines(`${ROW_BULLET}${cleanLine(row.cashier, 60)}:`, [`${Number(row.count) || 0} · ${usd(row.usd)}`])))
  return lines.join('\n')
}

export async function sendTelegramTodaySummary(env: Env): Promise<void> {
  const config = await getTelegramConfig(env); const problem = configurationProblem(config)
  if (problem) throw new Error(problem)
  const today = businessToday()
  const [stats, cashiers] = await Promise.all([dayStats(env, today), cashierTotals(env, today)])
  await postTelegram(config, withLanguage(config.language, () => formatDaySummary(stats, cashiers, config.categories)), config.chatId, config.topics.telegram_topic_reports)
}

async function dayReport(env: Env, date: string, language: TelegramLanguage, categories?: TelegramCategories): Promise<string> {
  const [stats, cashiers] = await Promise.all([dayStats(env, date), cashierTotals(env, date)])
  return withLanguage(language, () => formatDaySummary(stats, cashiers, categories))
}

async function salesReport(env: Env, date: string, language: TelegramLanguage): Promise<string> {
  const db = getDb(env); const stats = await dayStats(env, date)
  // Voided receipts are excluded here for the same reason they contribute 0
  // to the total above: listing one under a total it is not part of invites
  // exactly the reconciliation the owner asked us to end. The count of them
  // is printed by formatDaySummary instead.
  const sales = await db.prepare(`SELECT id, receipt_number, cashier_name, total_usd, total_khr FROM sales WHERE ${dayClause('created_at')} AND ${recognizedExpr('')} ORDER BY created_at DESC LIMIT 5`).all<{ id: number; receipt_number: string | null; cashier_name: string | null; total_usd: number; total_khr: number }>({ date })
  if (!sales.length) {
    return withLanguage(language, () => `${reportTitle('🛍️', 'Sales', 'ការលក់', date)}\n${bi('No sales recorded on this day.', 'គ្មានការលក់បានកត់ត្រាក្នុងថ្ងៃនេះទេ។')}`)
  }
  const ids = sales.map((sale) => sale.id)
  const items = await db.prepare(`SELECT sale_id, product_name, quantity, applied_price_usd, applied_price_khr FROM sale_items WHERE sale_id IN (${ids.map(() => '?').join(',')}) ORDER BY id ASC`).all<{ sale_id: number; product_name: string | null; quantity: number; applied_price_usd: number; applied_price_khr: number }>(ids)
  const bySale = new Map<number, typeof items>(); for (const item of items) bySale.set(item.sale_id, [...(bySale.get(item.sale_id) || []), item])
  // The same sectioned shape as every other report (Sep 21 2026): the money,
  // the count, then the list -- each under its own `=====` header.
  return withLanguage(language, () => {
    const lines = [
      reportTitle('🛍️', 'Sales', 'ការលក់', date),
      sectionHeader('sales', REPORT_SECTION_EDGE), labeled('revenue', usd(stats.sales?.usd)),
      sectionHeader('invoices', REPORT_SECTION_EDGE), countRow([['total', Number(stats.sales?.count) || 0], ['cancelled', Number(stats.sales?.cancelled) || 0]]),
      sectionHeader('latestReceipts', REPORT_SECTION_EDGE),
    ]
    const nest = '   '
    for (const sale of sales) {
      lines.push(...telegramRowLines(`${ROW_BULLET}${sale.receipt_number || `#${sale.id}`}`, [
        `· ${money(sale.total_usd, sale.total_khr)}`,
        `· ${localizeTelegramValue(cleanLine(sale.cashier_name || 'No cashier'))}`,
      ]))
      const saleItems = bySale.get(sale.id) || []
      // The same `1. name qty × price = total` equation the sale alert
      // prints (formatSaleTelegramLines), indented under its receipt. It
      // used to read `   2 × name — $1.00`: a different order, a different
      // separator, and no line total, so the one number the reader wanted
      // was the one they had to multiply out themselves.
      saleItems.slice(0, 4).forEach((item, index) => {
        const quantity = Number(item.quantity) || 0
        lines.push(...telegramRowLines(`${index + 1}. ${cleanLine(item.product_name || 'Item', 100)}`, [
          `${quantity} × ${money(item.applied_price_usd, item.applied_price_khr)}`,
          `= ${money(round2(quantity * (Number(item.applied_price_usd) || 0)), Math.round(quantity * (Number(item.applied_price_khr) || 0)))}`,
        ], nest))
      })
      // Indented under its receipt like the item lines above it, and worded by
      // the one helper the alert builders' continuation also goes through. It
      // used to localize only the NOUN -- `+ 3 more មុខទំនិញ` -- leaving the
      // English "more" in a Khmer-only shop's message.
      if (saleItems.length > 4) lines.push(`${nest}${moreItems(saleItems.length - 4)}`)
    }
    return lines.join('\n')
  })
}

async function feesReport(env: Env, date: string, language: TelegramLanguage): Promise<string> {
  const db = getDb(env); const stats = await dayStats(env, date)
  const fees = await db.prepare('SELECT fee_type, label, amount_usd, amount_khr FROM fees WHERE fee_date = @date ORDER BY id DESC LIMIT 8').all<{ fee_type: string; label: string | null; amount_usd: number; amount_khr: number }>({ date })
  // Total, then the records themselves. The record COUNT is gone: the bullets
  // under it are the records, so printing how many of them there are is the
  // repeated figure the owner asked us to drop.
  return withLanguage(language, () => {
    const lines = [
      reportTitle('💸', 'Expenses', 'ចំណាយ', date),
      sectionHeader('expenses', REPORT_SECTION_EDGE), labeled('total', money(stats.fees?.usd, stats.fees?.khr)),
      sectionHeader('eachExpense', REPORT_SECTION_EDGE),
    ]
    if (!fees.length) lines.push(EMPTY_SECTION)
    // Parentheses, not an em dash, join the fee type and its optional label --
    // a trailing "type: label:" double colon reads worse than "type (label):".
    for (const fee of fees) lines.push(...telegramRowLines(`${ROW_BULLET}${cleanLine(fee.fee_type)}${fee.label ? ` (${cleanLine(fee.label, 90)})` : ''}:`, [money(fee.amount_usd, fee.amount_khr)]))
    return lines.join('\n')
  })
}

async function inventoryReport(env: Env, language: TelegramLanguage): Promise<string> {
  const db = getDb(env)
  // Same OR as the notification bell: /stock and /lowstock report BOTH tiers
  // in one list, so filtering on the low fragment alone would take the
  // out-of-stock rows down with the low ones when the alert is switched off.
  const lowThresholdSql = lowStockThresholdSql(await loadLowStockConfig(env), 'low_stock_threshold')
  const rows = await db.prepare(`SELECT name, stock_quantity, ${lowThresholdSql} AS low_threshold, out_of_stock_threshold FROM products WHERE is_active = 1 AND (COALESCE(stock_quantity, 0) <= ${lowThresholdSql} OR COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0)) ORDER BY COALESCE(stock_quantity, 0) ASC, name ASC LIMIT 12`).all<{ name: string; stock_quantity: number; low_threshold: number; out_of_stock_threshold: number }>()
  return withLanguage(language, () => {
    const title = reportTitle('📦', 'Low stock', 'ស្តុកទាប')
    if (!rows.length) return `${title}\n${bi('No active product is at or below its alert level.', 'គ្មានផលិតផលសកម្មណាមួយស្តុកទាបទេ។')}`
    // The Sep 21 2026 sectioned shape (owner: "same for other telegram
    // report ... using dividers, numbered list, etc... title etc..."), the
    // one this reply and /inventory were the two replies left out of when the
    // rest of the reports took it on. One section carrying the count row it
    // already printed, then the capped list, unchanged; its header and its
    // `·` rows are the Sep 23 2026 ones every report shares.
    const lines = [title, sectionHeader('stock', REPORT_SECTION_EDGE), labeled('products', rows.length)]
    for (const row of rows) {
      const out = Number(row.stock_quantity || 0) <= Number(row.out_of_stock_threshold || 0)
      lines.push(...telegramRowLines(`${ROW_BULLET}${out ? bi('OUT', 'អស់ស្តុក') : bi('LOW', 'ស្តុកទាប')}: ${cleanLine(row.name, 120)}:`, [`${Number(row.stock_quantity || 0)} (⚠ ${Number(row.low_threshold)})`]))
    }
    return lines.join('\n')
  })
}

async function inventorySummaryReport(env: Env, language: TelegramLanguage): Promise<string> {
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
  //
  // Sep 22 2026: both sections are titled like every other report, reusing
  // the SAME 'products'/'stock' section titles the day summary and /stock
  // draw from -- no new label. Since Sep 23 2026 each opens with its
  // `=====` header, like theirs.
  const lowStock = Number(row?.low_stock || 0)
  const outOfStock = Number(row?.out_of_stock || 0)
  return withLanguage(language, () => {
    const lines = [
      reportTitle('🏷️', 'Inventory', 'ស្តុក'),
      sectionHeader('products', REPORT_SECTION_EDGE),
      labeled('activeProducts', Number(row?.products || 0).toLocaleString()),
      labeled('unitsOnHand', Number(row?.units || 0).toLocaleString()),
    ]
    const health: string[] = []
    if (lowStock) health.push(labeled('lowStock', lowStock))
    if (outOfStock) health.push(labeled('outOfStock', outOfStock))
    // Prints even when the shop has neither: "no low or out-of-stock
    // products" is the answer to the question /inventory was asked, and a
    // missing Stock section reads as a truncated message instead.
    lines.push(sectionHeader('stock', REPORT_SECTION_EDGE), ...(health.length ? health : [EMPTY_SECTION]))
    return lines.join('\n')
  })
}

// ---- Shift report (S4-7, redesigned Sep 6 and Sep 21 2026) -----------------
//
// The owner's Sep 6 review, verbatim: "for telegram message can be made more
// clearly, summary, less text, no explanation just arrange all reports more
// concise with breakdowns clearly. like i see shift report is so long, much
// more simpler so easy to understand at a glance" -- and, on the same report,
// "you didn't mention the registered cash dollar and khr in open vs end."
//
// On Sep 21 2026 the owner pasted the old POS's shift report as a LAYOUT
// reference (information order only, never its wording or branding) and said
// "Shift should look something like this... just smarter and compact ...
// enough spacing and separations that it feels easy to read and clean, using
// dividers, numbered list, etc... title etc...". So the message is now a
// TITLE line carrying the shift's state, a short identity block, and SIX
// titled sections, always in this order:
//
//   1. Invoices     total · cancelled · edited, one compact row
//   2. Sales        revenue, the two discount cuts, profit, delivery fee,
//                   Not Paid, Loss, refunds -- Not Paid and Loss are ALWAYS
//                   plain positive memos, never a subtraction, per the
//                   owner's separate ruling ("just use credit ... instead of
//                   $-n ... just $n")
//   3. Cash count   registered opening / additional change / closing, both
//                   currencies, then the expected drawer and ONE
//                   informational difference line. The difference is counted
//                   cash minus the expected drawer
//                   (lib/shiftReconciliation.ts, the one shared definition
//                   with the close routes and the shift screen), printed as a
//                   single fact -- never "shortage", never a must-match
//                   claim, and never as its five-part formula.
//   4. Payment methods  reinstated by the Sep 21 reference
//   5. Delivery         reinstated by the Sep 21 reference
//   6. Expenses     every expense as its own bullet, then the total
//
// Sections 4-6 print their title and `· N/A` when the shift has no rows for
// them: the owner's reference shows every section, so the shape of the
// message never moves between one shift and the next.
//
// Sep 23 2026: the numbers and the drawn rules came off the sections. Each
// one opens with a single dashed line, `-----Invoices / វិក្កយបត្រ-----`
// (SHIFT_SECTION_EDGE), and EVERY row inside it is a `·` row -- the payment,
// delivery and expense lists as well as the figures. The owner: "for shift
// instead of line. do ---------Invoices / វិក្កយបត្រ-------- use dash not line.
// and for inside each section do bullet points ·".
//
// The same day the TOP took the owner's sample: "🧑‍💼 Shift report /
// របាយការណ៍វេន: Open / បើក · 22/09/2026", then "Open/បើក: 22/09/2026 08:07",
// "Close / បិទ: N/A", "Shop / ហាង: Leang Cosmetics", "Cashier /
// អ្នកគិតប្រាក់: Za", "ID សម្គាល់: S-20260922-0807-Za" -- and "also for open
// khmer just call បើក". A colon after the title instead of a dash, the
// shift's own two moments (Open, Close) in place of From and To, and the ID
// last.
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
  /**
   * The two discount cuts the owner's reference names separately -- "Discount
   * on Items" (sale_items' product + manual discounts) and "Discount on
   * Invoices" (the store and membership cuts taken on the receipt). Straight
   * off getSalesTotals' item_discount_usd and discount_usd; optional so a
   * caller without the kernel (the pure test) still renders, and each line is
   * printed only when it is non-zero.
   */
  itemDiscountUsd?: number
  invoiceDiscountUsd?: number
  /** The kernel's gross_sales_usd (item subtotals before discounts): the
   *  "Gross Sale" row the reference lists right under the two cuts. */
  grossSalesUsd?: number
  /**
   * The Sep 21 2026 reference reinstates both breakdowns. Compact rows only --
   * the method/courier, how many, and the money -- capped by shiftFigures with
   * the remainder folded into one "Other" row so the list still adds up.
   */
  paymentMethods?: Array<{ method: string; count: number; usd: number }>
  deliveries?: Array<{ name: string; count: number; feeUsd: number; costUsd: number }>
  /** One row per expense paid out of this drawer (lib/shiftReconciliation.ts's
   *  shiftExpenses(...).details, already capped and folded there). */
  expenseDetails?: Array<{ label: string; usd: number; khr: number }>
  /**
   * Stock removed entirely during the shift, at cost. Optional: absent means
   * the kernel could not scope the window to stock movements, not that
   * nothing was destroyed, so the row is omitted rather than printed as $0.00.
   */
  removalLossUsd?: number
  /** Same meaning as SalesBucket's field above. */
  removalLossUnvaluedRows?: number
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
 * The whole message, pure -- no D1 and no clock: `nowMs` is only
 * formatBusinessDateTime's fallback for a stored time that does not parse.
 * scripts/test-shift-report-pure.cjs drives it directly, so the shape and the
 * arithmetic are pinned without a database.
 */
export function formatShiftReport(shopName: string, shift: ShiftReportSession, figures: ShiftReportFigures, nowMs: number = Date.now()): string {
  const cancelled = !!shift.cancelled_at
  // The TITLE states the shift's state, the way the owner's reference does
  // ("Shift Report - Open or Closed"), after a colon since Sep 23 2026. An
  // open shift says `Open / បើក` ("also for open khmer just call បើក"): the
  // same entry as the Open row below, so the word is spelled once. A closed
  // shift follows suit since Sep 24 2026: `Closed / បិទ`, the Khmer of the
  // Close row below, never the longer បានបិទ.
  const state = cancelled ? bi('Cancelled', 'បានបោះបង់') : shift.closed_at ? bi('Closed', 'បិទ') : label('open')
  const lines = [
    `🧑‍💼 ${label('shiftReport')}: ${state} · ${formatBusinessDay(shift.business_date)}`,
    labeled('open', formatBusinessDateTime(shift.opened_at, nowMs)),
    // Close is the moment the shift was CLOSED and nothing else. A shift that
    // is still open has none, so the row says `N/A` (the owner's sample)
    // rather than a time: printing `now` here once rendered a close identical
    // to the open on a shift opened minutes ago (the owner's Sep 22 2026
    // paste), and on a long shift a closing time that never happened. A shift
    // left running overnight is still the honest record (migration 0116
    // refuses to close one on a timer) and still renders. A cancellation is
    // not a close either: a shift cancelled while open keeps `N/A` here and
    // states its cancellation time on its own row below, and a later soft
    // cancellation leaves an already closed shift's close -- the end of its
    // money window, see shiftFilters -- exactly where it was.
    labeled('close', shift.closed_at ? formatBusinessDateTime(shift.closed_at, nowMs) : NOT_APPLICABLE),
    labeled('shop', cleanLine(shopName || 'Business OS', 80)),
    labeled('cashier', localizeTelegramValue(cleanLine(shift.user_name || 'No cashier', 60))),
    // 80 characters (40 until Sep 23 2026): the owner's sample id carries the
    // cashier's name after the time (S-20260922-0807-Za). The new ids keep up
    // to 24 characters of that name and add `-2`, `-3` when the same cashier
    // opens twice in one minute, and an id cut short is one nobody can search
    // for. cleanLine counts characters, so a Khmer or emoji name is never cut
    // in half either.
    labeled('shift', cleanLine(shift.shift_code, 80)),
  ]
  if (cancelled) {
    lines.push(row(bi('Cancelled at', 'បោះបង់នៅ'), formatBusinessDateTime(shift.cancelled_at, nowMs)))
    lines.push(row(bi('Cancelled by', 'បោះបង់ដោយ'), cleanLine(shift.cancelled_by_user_name || 'Unknown', 60)))
    lines.push(row(bi('Reason', 'មូលហេតុ'), cleanLine(shift.cancel_reason || 'Not recorded', 500)))
  }

  // 1. Invoices -- total, and the two counts that qualify it.
  lines.push(sectionHeader('invoices', SHIFT_SECTION_EDGE), countRow([
    ['total', Number(figures.invoices) || 0],
    ['cancelled', Number(figures.cancelled) || 0],
    ['edited', Number(figures.edited) || 0],
  ]))

  // 2. Sales -- Revenue and Profit print unconditionally, even at $0.00 (a
  // quiet shift is still a real one); every other line is dropped when zero.
  const sales = [labeled('revenue', usd(figures.revenueUsd))]
  if (figures.itemDiscountUsd) sales.push(labeled('itemDiscount', usd(figures.itemDiscountUsd)))
  if (figures.invoiceDiscountUsd) sales.push(labeled('invoiceDiscount', usd(figures.invoiceDiscountUsd)))
  // Gross sales explains the two cuts above it, so it prints only when there
  // is a cut to explain; with none it IS the revenue line, and the same figure
  // twice under two names is the repetition the redesign takes out.
  if ((figures.itemDiscountUsd || figures.invoiceDiscountUsd) && figures.grossSalesUsd != null) sales.push(labeled('grossSales', usd(figures.grossSalesUsd)))
  sales.push(labeled('profit', usd(figures.profitUsd)))
  if (figures.deliveryFeeUsd) sales.push(labeled('deliveryFee', usd(figures.deliveryFeeUsd)))
  // Always positive, always labelled "Not Paid" -- never "$-n", never
  // subtracted from anything above it (see the owner's separate ruling).
  if (figures.creditUsd) sales.push(labeled('credit', usd(figures.creditUsd)))
  // Directly below Not Paid (owner, Sep 14 2026: "also add one row below
  // unpaid in reports as well"). A POSITIVE memo, one number and no sentence:
  // Revenue and Profit above stay the canonical figures and are never reduced
  // by it, exactly as Not Paid behaves.
  if (figures.removalLossUsd) sales.push(labeled('loss', usd(figures.removalLossUsd) + unvaluedSuffix(figures.removalLossUnvaluedRows)))
  if (figures.refundUsd) sales.push(labeled('refunds', usd(figures.refundUsd)))
  lines.push(sectionHeader('sales', SHIFT_SECTION_EDGE), ...sales)

  // 3. Cash count -- the owner's specific gap: registered opening and closing
  // cash, both currencies. A factual readout, and an open shift (no count
  // taken yet) simply has no closing half.
  // Opening -> additional change used -> closing, the order the drawer
  // actually moves in and the order every shift surface in the app reads
  // (ShiftGate, the report figures, the amend form): the extra change went in
  // and was spent BEFORE the final count was taken. Printing it after the
  // closing cash made the phone message tell a different story from the app.
  const cash = [labeled('cashOpen', registeredMoney(shift.opening_float_usd, shift.opening_float_khr))]
  const additionalCash = shift.additional_cash_usd || shift.additional_cash_khr
    ? registeredMoney(shift.additional_cash_usd ?? 0, shift.additional_cash_khr ?? 0)
    : ''
  if (additionalCash) cash.push(labeled('additionalCash', additionalCash))
  if (shift.closed_at) cash.push(labeled('cashEnd', registeredMoney(shift.closing_counted_usd, shift.closing_counted_khr)))

  // One informational difference line -- not an expected-must-match check.
  // The reconciliation is still computed (ONE shared definition,
  // lib/shiftReconciliation.ts) but only to answer the single question "does
  // the count differ from what it should be", not to print its own five-part
  // formula.
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
  // Expected is shown for both open and closed shifts. An open drawer has no
  // counted value (and therefore no difference), but the employee still needs
  // the current target while trading.
  const expected = recon.expected.usd == null && recon.expected.khr == null
    ? NOT_APPLICABLE
    : `${recon.expected.usd == null ? NOT_APPLICABLE : usd(recon.expected.usd)} · ${recon.expected.khr == null ? NOT_APPLICABLE : riel(recon.expected.khr)}`
  cash.push(labeled('expectedCash', expected))
  // The closing count only exists once the employee has ended the shift by
  // hand, so an open shift shows no difference against a count that was
  // never taken -- that would read as a missing-cash alarm on every open till.
  if (shift.closed_at) {
    const signed = (n: number, format: (value: number) => string) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${format(Math.abs(n))}`
    const difference = recon.difference.usd == null && recon.difference.khr == null
      ? NOT_APPLICABLE
      : `${recon.difference.usd == null ? NOT_APPLICABLE : signed(recon.difference.usd, usd)} · ${recon.difference.khr == null ? NOT_APPLICABLE : signed(recon.difference.khr, riel)}`
    cash.push(labeled('difference', difference))
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
      cash.push(labeled('cashReview', reasons.length ? reasons.join(' · ') : NOT_APPLICABLE))
    }
  }
  lines.push(sectionHeader('cashCount', SHIFT_SECTION_EDGE), ...cash)

  // 4. Payment methods and 5. Delivery -- both reinstated by the owner's
  // Sep 21 2026 reference. One row per method or courier: the name, how
  // many, and the money, on the same `·` bullet as every other shift row.
  lines.push(sectionHeader('paymentMethods', SHIFT_SECTION_EDGE))
  const paymentMethods = figures.paymentMethods || []
  lines.push(...(paymentMethods.length
    ? paymentMethods.flatMap((row) => telegramRowLines(`${ROW_BULLET}${cleanLine(row.method, 40)}:`, [`${Number(row.count) || 0} · ${usd(row.usd)}`]))
    : [EMPTY_SECTION]))

  lines.push(sectionHeader('delivery', SHIFT_SECTION_EDGE))
  const deliveries = figures.deliveries || []
  lines.push(...(deliveries.length
    ? deliveries.flatMap((row) => telegramRowLines(`${ROW_BULLET}${cleanLine(row.name, 40)}:`, [
      `${Number(row.count) || 0} · ${usd(row.feeUsd)} ${bi('fee', 'ថ្លៃដឹក')}`,
      // An UNRECORDED courier cost is NULL, never $0.00: a "$0.00 cost" tail
      // would claim the courier worked for free, so it is left off instead.
      Number(row.costUsd) > 0 ? `· ${usd(row.costUsd)} ${bi('cost', 'ថ្លៃដើម')}` : '',
    ]))
    : [EMPTY_SECTION]))

  // 6. Expenses -- every expense paid out of this drawer as its own row, then
  // the ONE total. The total is expenseTotals(): the fees plus the courier
  // money actually paid out, the same sum the day summary prints, so the
  // courier payout is a row here rather than a figure with no row.
  const expenses = expenseTotals({
    otherUsd: figures.otherExpenseUsd, otherKhr: figures.otherExpenseKhr,
    deliveryCostUsd: figures.deliveryCostUsd, deliveryCostRecorded: figures.deliveryCostRecorded,
  })
  const expenseRows: string[] = []
  if (expenses.courierUsd > 0) expenseRows.push(...telegramRowLines(`${ROW_BULLET}${label('deliveryCost')}:`, [usd(expenses.courierUsd)]))
  const details = figures.expenseDetails || []
  if (details.length) {
    for (const detail of details) expenseRows.push(...telegramRowLines(`${ROW_BULLET}${cleanLine(detail.label, 60)}:`, [money(detail.usd, detail.khr)]))
  } else if (expenses.otherUsd || expenses.otherKhr) {
    // A caller that has the total but no per-expense rows still shows where
    // the money is, under the same word the day summary uses for it.
    expenseRows.push(...telegramRowLines(`${ROW_BULLET}${label('expensesOther')}:`, [money(expenses.otherUsd, expenses.otherKhr)]))
  }
  lines.push(sectionHeader('expenses', SHIFT_SECTION_EDGE))
  lines.push(...(expenseRows.length
    ? [...expenseRows, labeled('total', money(expenses.totalUsd, expenses.otherKhr))]
    : [EMPTY_SECTION]))

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

async function shiftFigures(env: Env, shift: ShiftReportSession, nowMs: number, language: TelegramLanguage): Promise<ShiftReportFigures> {
  const filters = shiftFilters(shift, nowMs)
  // The two fold labels are the only text this DATA function produces, so they
  // are composed here, in the shop's language, before the awaits -- everything
  // else on these rows is a name or a figure and is never translated.
  const overflowLabel = withLanguage(language, () => bi('Other expenses', 'ចំណាយផ្សេងទៀត'))
  const otherLabel = withLanguage(language, () => label('other'))
  // The payment-method and delivery-contact breakdowns came BACK on Sep 21
  // 2026: the owner's reference layout has a section for each. They are the
  // SAME kernel entry points routes/reports.ts reads, so the phone message and
  // the Reports hub cannot disagree about a method's takings.
  const [totals, counts, expenses, reconciliation, payments, couriers] = await Promise.all([
    getSalesTotals(env, filters),
    shiftInvoiceCounts(env, shift, nowMs),
    shiftExpenses(env, shift, nowMs, { overflowLabel }),
    loadShiftReconciliation(env, shift, nowMs, { overflowLabel }),
    getPaymentMethodBreakdown(env, filters),
    getDeliveryContactTotals(env, filters),
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
    // The owner's two discount rows, straight off the kernel: the per-item
    // cuts, and the store + membership cuts taken on the receipt.
    itemDiscountUsd: totals.item_discount_usd,
    invoiceDiscountUsd: totals.discount_usd,
    grossSalesUsd: totals.gross_sales_usd,
    // Stock destroyed during the shift, at cost -- the same kernel field the
    // day summary and the Reports hub read, so the surfaces cannot disagree.
    removalLossUsd: totals.removal_loss_usd,
    removalLossUnvaluedRows: totals.removal_loss_unvalued_rows,
    otherExpenseUsd: expenses.usd,
    otherExpenseKhr: expenses.khr,
    expenseDetails: expenses.details,
    // Eight rows each at most -- a phone message is not a report page -- with
    // the tail folded into ONE "Other" row so the section still adds up to the
    // money above it.
    paymentMethods: foldRows(
      payments.map((row) => ({ method: row.payment_method || 'Unknown', count: row.tx_count, usd: row.collected_usd })),
      8,
      (rest) => ({
        method: otherLabel,
        count: rest.reduce((sum, row) => sum + (Number(row.count) || 0), 0),
        usd: round2(rest.reduce((sum, row) => sum + (Number(row.usd) || 0), 0)),
      }),
    ),
    deliveries: foldRows(
      couriers.map((row) => ({
        name: row.delivery_contact_name || 'Unknown',
        count: row.deliveries,
        feeUsd: row.charged_fee_usd,
        // Kept NULL-honest: actual_cost_count is how many of these deliveries
        // recorded a courier payout at all, so a contact with none shows no
        // cost rather than a $0.00 that would read as free delivery.
        costUsd: Number(row.actual_cost_count) > 0 ? row.actual_cost_usd : 0,
      })),
      8,
      (rest) => ({
        name: otherLabel,
        count: rest.reduce((sum, row) => sum + (Number(row.count) || 0), 0),
        feeUsd: round2(rest.reduce((sum, row) => sum + (Number(row.feeUsd) || 0), 0)),
        costUsd: round2(rest.reduce((sum, row) => sum + (Number(row.costUsd) || 0), 0)),
      }),
    ),
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

async function shiftReportFor(env: Env, shift: ShiftReportSession, nowMs: number, language: TelegramLanguage): Promise<string> {
  const [name, figures] = await Promise.all([shopName(env), shiftFigures(env, shift, nowMs, language)])
  return withLanguage(language, () => formatShiftReport(name, shift, figures, nowMs))
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
async function shiftReport(env: Env, date: string, nowMs: number, language: TelegramLanguage): Promise<string> {
  const shifts = await getDb(env).prepare(`
    SELECT ${SHIFT_COLUMNS} FROM shift_sessions
    WHERE business_date = @date
    ORDER BY opened_at DESC LIMIT 12
  `).all<ShiftReportSession>({ date })
  if (!shifts.length) {
    return withLanguage(language, () => [
      `🧑‍💼 ${label('shiftReport')}: ${formatBusinessDay(date)}`,
      bi('No shift was registered on this day.', 'គ្មានវេនណាមួយបានចុះបញ្ជីក្នុងថ្ងៃនេះទេ។'),
    ].join('\n'))
  }
  const blocks: string[] = []
  for (const shift of shifts) blocks.push(await shiftReportFor(env, shift, nowMs, language))
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
    await postTelegram(config, await shiftReportFor(env, shift, nowMs, config.language), config.chatId, config.topics.telegram_topic_shift)
    return true
  } catch (error) {
    console.error('[telegram] shift report could not be sent', error)
    return false
  }
}

// ---- T10: the Reports overview, one minute after a shift closes -----------
// Owner, 23 Sep 2026: "One minute after a shift closes, the Reports overview
// is sent to Telegram too" -- with a Free-plan path, a Paid path with
// automatic fallback, and ONE send per shift.
//
// WHAT IS SENT. The Reports hub's Overview for the closed shift's BUSINESS DAY
// and BRANCH (every cashier on that branch, the whole day), i.e. what
// GET /api/reports/overview?startDate=D&endDate=D&branchId=B answers. Every
// sales figure is the kernel's (getSalesTotals, getSalesGroupedTotals by
// payment method -- the same calls that route makes); nothing is re-derived.
// "Expenses" is expenseTotals(), the one sum the shift report and the day
// summary print under that word.
//
// HOW IT IS SCHEDULED (the same on both plans; the plan is not the axis).
//   1. The close commits. Then a `telegram_scheduled_sends` row (migration
//      0194) is written with a UNIQUE key and due_at = now + 60 s. This is
//      the idempotency record, and it exists before anything is sent.
//   2. Queue path: a message on BACKUP_QUEUE with { delaySeconds: 60 }.
//      Both wrangler.toml (Paid) and wrangler.free.toml (Free) bind that
//      producer and its consumer -- Queues work on Free -- so no new queue has
//      to be created before a deploy. One message is three queue operations,
//      against Free's 10,000 a day.
//   3. Fallback, used when the binding is absent or `send` throws: the row
//      stays `dispatch='fallback'` and is drained by the next /api request
//      after it falls due (index.ts, at most once per 20 s per isolate, off
//      the response path) or by the 6-hourly cron. NOT ctx.waitUntil with a
//      60 s sleep: waitUntil work is cut 30 s after the response on both
//      plans, so the sleep would be killed before it sent -- a timer that
//      looks like a mechanism and is not one. A pending row the queue never
//      delivers is picked up the same way five minutes after it fell due.
//
// EXACTLY ONE SEND. A send happens only after the conditional UPDATE that
// moves the row pending -> sending changes one row. A duplicate queue
// delivery, the drain racing the queue, and a retried close all hit that one
// UPDATE, and only one of them wins it. A shift SEGMENT closes once (the close
// UPDATE requires closed_at IS NULL); a reopen writes a NEW segment row with
// its own id, so reopen + close again is a new key and sends again, exactly
// as the shift report is pushed again on every close. Delivery is at most
// once: a claim whose Worker dies mid-send is never retried (see 0194).

export const SHIFT_OVERVIEW_DELAY_SECONDS = 60
export const SHIFT_OVERVIEW_QUEUE_KIND = 'telegram-shift-overview'
export type ShiftOverviewQueueMessage = { kind: typeof SHIFT_OVERVIEW_QUEUE_KIND; key: string }
export function isShiftOverviewQueueMessage(body: unknown): body is ShiftOverviewQueueMessage {
  const value = body as { kind?: unknown; key?: unknown } | null
  return !!value && typeof value === 'object' && value.kind === SHIFT_OVERVIEW_QUEUE_KIND && typeof value.key === 'string'
}
/** One key per closed shift segment: its id and the revision the close wrote. */
export const shiftOverviewKey = (shiftId: number, revision: number): string => `shift-overview:${shiftId}:r${revision}`

/** A failed Telegram call is retried this many times in all, a minute apart. */
const SHIFT_OVERVIEW_MAX_ATTEMPTS = 3
/** A queued row the queue has not delivered this long after it fell due is drained. */
const SHIFT_OVERVIEW_QUEUE_GRACE_MS = 5 * 60_000
/** A claim this old never reported back: its Worker died mid-send. */
const SHIFT_OVERVIEW_STALE_CLAIM_MS = 10 * 60_000

// Memoises only a POSITIVE probe, as lib/stockMutationReceipt.ts does: the
// migration may land after the Worker, and a miss costs one sqlite_master read.
let scheduledSendsReady = false
export function __resetScheduledSendsProbeForTests(): void { scheduledSendsReady = false }
async function scheduledSendsAvailable(env: Env): Promise<boolean> {
  if (scheduledSendsReady) return true
  try {
    const row = await getDb(env).prepare("SELECT COUNT(*) AS ready FROM sqlite_master WHERE type='table' AND name='telegram_scheduled_sends'").get<{ ready: number }>()
    scheduledSendsReady = Number(row?.ready ?? 0) > 0
  } catch { /* a failed read is not evidence the table is missing */ }
  return scheduledSendsReady
}

/** The overview's filters: the shift's business day, on the shift's branch. */
export function shiftOverviewFilters(shift: { business_date: string; branch_id: number | null }): SalesFilters {
  return { startDate: shift.business_date, endDate: shift.business_date, branchId: shift.branch_id ?? null }
}

export type ShiftOverviewFigures = {
  revenueUsd: number; profitUsd: number; grossSalesUsd: number; itemDiscountUsd: number; invoiceDiscountUsd: number
  deliveryFeeUsd: number; creditUsd: number; refundUsd: number
  invoices: number; cancelled: number
  paymentMethods: Array<{ method: string; count: number; usd: number }>
  otherExpenseUsd: number; otherExpenseKhr: number; deliveryCostUsd: number; deliveryCostRecorded: number
  returns: { count: number; refundUsd: number; refundKhr: number }
}

/**
 * The overview message. Pure, exported for
 * scripts/test-telegram-shift-overview-pure.cjs.
 *
 * Same shape as every other report since T4/T7/T8: a title line with the day,
 * the rows that say whose shift and where, then `=====Name=====` sections of
 * `·` rows, long rows on the hanging indent. `categories` is the owner's
 * per-category switch set, applied the way formatDaySummary applies it.
 */
export function formatShiftOverview(shopName: string, shift: ShiftReportSession, figures: ShiftOverviewFigures, categories?: TelegramCategories, nowMs: number = Date.now()): string {
  const lines = [
    `📈 ${label('reportsOverview')}: ${formatBusinessDay(shift.business_date)}`,
    labeled('shop', cleanLine(shopName || 'Business OS', 80)),
    labeled('branch', shift.branch_id == null ? bi('All branches', 'គ្រប់សាខា') : cleanLine(shift.branch_name || `#${shift.branch_id}`, 60)),
    // Who closed which shift, and when: the message is sent BECAUSE of it.
    labeled('cashier', localizeTelegramValue(cleanLine(shift.user_name || 'No cashier', 60))),
    labeled('shift', cleanLine(shift.shift_code, 80)),
    // The shift's window, as the shift report prints it. The figures below
    // are the whole business day on this branch -- the Overview's scope --
    // and these two rows say which close sent them.
    labeled('open', formatBusinessDateTime(shift.opened_at, nowMs)),
    labeled('close', shift.closed_at ? formatBusinessDateTime(shift.closed_at, nowMs) : NOT_APPLICABLE),
  ]
  const section = (key: TelegramLabelKey, rows: string[], enabled = true): void => {
    if (enabled) lines.push(sectionHeader(key, REPORT_SECTION_EDGE), ...(rows.length ? rows : [EMPTY_SECTION]))
  }
  const showSales = categories?.sales !== false
  const showExpenses = categories?.fees !== false

  const sales = [labeled('revenue', usd(figures.revenueUsd))]
  if (figures.itemDiscountUsd) sales.push(labeled('itemDiscount', usd(figures.itemDiscountUsd)))
  if (figures.invoiceDiscountUsd) sales.push(labeled('invoiceDiscount', usd(figures.invoiceDiscountUsd)))
  if (figures.itemDiscountUsd || figures.invoiceDiscountUsd) sales.push(labeled('grossSales', usd(figures.grossSalesUsd)))
  sales.push(labeled('profit', usd(figures.profitUsd)))
  if (figures.deliveryFeeUsd) sales.push(labeled('deliveryFee', usd(figures.deliveryFeeUsd)))
  if (figures.creditUsd) sales.push(labeled('credit', usd(figures.creditUsd)))
  if (figures.refundUsd) sales.push(labeled('refunds', usd(figures.refundUsd)))
  section('sales', sales, showSales)
  section('invoices', [countRow([['total', Number(figures.invoices) || 0], ['cancelled', Number(figures.cancelled) || 0]])], showSales)
  section('paymentMethods', figures.paymentMethods.flatMap((row) => telegramRowLines(`${ROW_BULLET}${cleanLine(row.method, 40)}:`, [`${Number(row.count) || 0} · ${usd(row.usd)}`])), showSales)

  const expenses = expenseTotals({
    otherUsd: showExpenses ? figures.otherExpenseUsd : 0, otherKhr: showExpenses ? figures.otherExpenseKhr : 0,
    deliveryCostUsd: showSales ? figures.deliveryCostUsd : 0, deliveryCostRecorded: showSales ? figures.deliveryCostRecorded : 0,
  })
  const expenseRows: string[] = []
  if (expenses.courierUsd > 0 && (expenses.otherUsd > 0 || expenses.otherKhr > 0)) {
    expenseRows.push(labeled('deliveryCost', usd(expenses.courierUsd)), labeled('expensesOther', money(expenses.otherUsd, expenses.otherKhr)))
  }
  if (expenses.totalUsd || expenses.otherKhr) expenseRows.push(labeled('total', money(expenses.totalUsd, expenses.otherKhr)))
  section('expenses', expenseRows, showExpenses)

  // Returns by the day the RETURN was taken -- the Overview's returns block.
  // Its refund is not the Refunds row above (that one follows the SALE's
  // day), which is why it is its own section and never subtracted.
  const returned = figures.returns
  section('returns', returned.count ? [labeled('total', `${returned.count} · ${money(returned.refundUsd, returned.refundKhr)}`)] : [])
  return lines.join('\n')
}

const OVERVIEW_SHIFT_COLUMNS = `id, revision, ${SHIFT_COLUMNS}`
type OverviewShift = ShiftReportSession & { id: number; revision: number }

/** The Overview's figures for one day and branch, off the same kernel calls. */
export async function shiftOverviewFigures(env: Env, shift: { business_date: string; branch_id: number | null }, otherLabel = 'Other'): Promise<ShiftOverviewFigures> {
  const filters = shiftOverviewFilters(shift)
  const params: Record<string, unknown> = { startDate: filters.startDate, endDate: filters.endDate }
  // routes/reports.ts reportRecordRange's date-only branch, per table; the
  // pure test compares the two clause for clause.
  const branch = (alias: string) => (filters.branchId == null ? '' : ` AND ${alias}.branch_id = @branchId`)
  if (filters.branchId != null) params.branchId = filters.branchId
  const db = getDb(env)
  const [totals, payments, fees, returned] = await Promise.all([
    getSalesTotals(env, filters),
    getSalesGroupedTotals(env, filters, 'payment_method'),
    db.prepare(`SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_khr), 0) AS khr FROM fees
      WHERE fees.fee_date >= @startDate AND fees.fee_date <= @endDate${branch('fees')}`).get<{ usd: number; khr: number }>(params),
    db.prepare(`SELECT COUNT(*) AS count, ROUND(COALESCE(SUM(total_refund_usd), 0), 2) AS usd, ROUND(COALESCE(SUM(total_refund_khr), 0), 0) AS khr FROM returns
      WHERE COALESCE(return_scope, 'customer') = 'customer' AND COALESCE(status, 'completed') <> 'cancelled'
        AND ${localDateRangeClause('returns.created_at')}${branch('returns')}`).get<{ count: number; usd: number; khr: number }>(params),
  ])
  return {
    revenueUsd: totals.revenue_usd, profitUsd: totals.profit_usd, grossSalesUsd: totals.gross_sales_usd,
    itemDiscountUsd: totals.item_discount_usd, invoiceDiscountUsd: totals.discount_usd,
    deliveryFeeUsd: totals.delivery_usd, creditUsd: totals.pending_revenue_usd, refundUsd: totals.refund_usd,
    invoices: totals.tx_count, cancelled: totals.cancelled_tx_count,
    paymentMethods: foldRows(
      payments.map((row) => ({ method: row.label || row.key || 'Unknown', count: row.tx_count, usd: row.revenue_usd })),
      8,
      (rest) => ({
        method: otherLabel,
        count: rest.reduce((sum, row) => sum + (Number(row.count) || 0), 0),
        usd: round2(rest.reduce((sum, row) => sum + (Number(row.usd) || 0), 0)),
      }),
    ),
    otherExpenseUsd: Number(fees?.usd) || 0, otherExpenseKhr: Number(fees?.khr) || 0,
    deliveryCostUsd: totals.delivery_actual_cost_usd, deliveryCostRecorded: totals.delivery_actual_cost_count,
    returns: { count: Number(returned?.count) || 0, refundUsd: Number(returned?.usd) || 0, refundKhr: Number(returned?.khr) || 0 },
  }
}

export type ShiftOverviewScheduleResult = 'queued' | 'fallback' | 'duplicate' | 'off' | 'not-closed' | 'unavailable'

/**
 * Called from the shift close routes once the close has COMMITTED. Never
 * throws: a close must not fail because of a Telegram schedule.
 */
export async function scheduleTelegramShiftOverview(env: Env, shiftId: number, nowMs: number = Date.now()): Promise<ShiftOverviewScheduleResult> {
  try {
    const config = await getTelegramConfig(env)
    if (!config.enabled || !config.shiftOverview || configurationProblem(config)) return 'off'
    if (!(await scheduledSendsAvailable(env))) return 'unavailable'
    const db = getDb(env)
    const shift = await db.prepare('SELECT id, revision, closed_at, cancelled_at FROM shift_sessions WHERE id = @id').get<{ id: number; revision: number; closed_at: string | null; cancelled_at: string | null }>({ id: shiftId })
    if (!shift || !shift.closed_at || shift.cancelled_at) return 'not-closed'
    const key = shiftOverviewKey(shift.id, shift.revision)
    const inserted = await db.prepare(`INSERT OR IGNORE INTO telegram_scheduled_sends (send_key, kind, shift_id, due_at, created_at)
      VALUES (@key, 'shift_overview', @shiftId, @dueAt, @now)`).run({
      key, shiftId: shift.id, dueAt: new Date(nowMs + SHIFT_OVERVIEW_DELAY_SECONDS * 1000).toISOString(), now: new Date(nowMs).toISOString(),
    })
    if (!inserted.changes) return 'duplicate'
    if (env.BACKUP_QUEUE) {
      try {
        const message: ShiftOverviewQueueMessage = { kind: SHIFT_OVERVIEW_QUEUE_KIND, key }
        await env.BACKUP_QUEUE.send(message, { delaySeconds: SHIFT_OVERVIEW_DELAY_SECONDS })
        await db.prepare("UPDATE telegram_scheduled_sends SET dispatch = 'queue' WHERE send_key = @key").run({ key })
        return 'queued'
      } catch (error) {
        console.error('[telegram] overview queue send failed; the request/cron drain will send it', error)
      }
    }
    return 'fallback'
  } catch (error) {
    console.error('[telegram] shift overview could not be scheduled', error)
    return 'unavailable'
  }
}

export type ShiftOverviewDeliveryResult = 'sent' | 'skipped' | 'taken' | 'not-due' | 'retry' | 'failed'

/**
 * Send one scheduled overview, at most once. Every path in -- the queue
 * consumer, the request drain, the cron drain -- comes through the claim.
 */
export async function deliverTelegramShiftOverview(env: Env, key: string, nowMs: number = Date.now()): Promise<ShiftOverviewDeliveryResult> {
  const db = getDb(env)
  const now = new Date(nowMs).toISOString()
  const claimed = await db.prepare(`UPDATE telegram_scheduled_sends SET status = 'sending', claimed_at = @now, attempts = attempts + 1
    WHERE send_key = @key AND status = 'pending' AND due_at <= @now`).run({ key, now })
  if (!claimed.changes) {
    const row = await db.prepare('SELECT status FROM telegram_scheduled_sends WHERE send_key = @key').get<{ status: string }>({ key })
    return row?.status === 'pending' ? 'not-due' : 'taken'
  }
  const settle = (status: string, error: string | null, extra = '') => db.prepare(
    `UPDATE telegram_scheduled_sends SET status = @status, last_error = @error${extra} WHERE send_key = @key AND status = 'sending'`,
  ).run({ key, status, error, now, retryAt: new Date(nowMs + SHIFT_OVERVIEW_DELAY_SECONDS * 1000).toISOString() })
  let attempts = SHIFT_OVERVIEW_MAX_ATTEMPTS
  try {
    const row = await db.prepare('SELECT shift_id, attempts FROM telegram_scheduled_sends WHERE send_key = @key').get<{ shift_id: number; attempts: number }>({ key })
    attempts = Number(row?.attempts) || attempts
    const config = await getTelegramConfig(env)
    // Re-read at send time: a switch turned off during the minute wins.
    if (!row || !config.enabled || !config.shiftOverview || configurationProblem(config)) { await settle('skipped', null); return 'skipped' }
    const shift = await db.prepare(`SELECT ${OVERVIEW_SHIFT_COLUMNS} FROM shift_sessions WHERE id = @id`).get<OverviewShift>({ id: row.shift_id })
    // Cancelled during the minute: its close is no longer a fact to report.
    if (!shift || !shift.closed_at || shift.cancelled_at) { await settle('skipped', null); return 'skipped' }
    // The fold label is the only text the DATA read produces; composed first,
    // synchronously, as shiftFigures does.
    const otherLabel = withLanguage(config.language, () => label('other'))
    const [name, figures] = await Promise.all([shopName(env), shiftOverviewFigures(env, shift, otherLabel)])
    await postTelegram(config, withLanguage(config.language, () => formatShiftOverview(name, shift, figures, config.categories, nowMs)), config.chatId, config.topics.telegram_topic_shift)
    await settle('sent', null, ', sent_at = @now')
    return 'sent'
  } catch (error) {
    const message = firstCharacters(String((error as Error)?.message || error), 300)
    console.error('[telegram] shift overview could not be sent', message)
    if (attempts < SHIFT_OVERVIEW_MAX_ATTEMPTS) {
      // Back to pending a minute on, and to the drain: the queue message
      // that brought it here is acknowledged either way.
      await settle('pending', message, ", due_at = @retryAt, dispatch = 'fallback'").catch(() => undefined)
      return 'retry'
    }
    await settle('failed', message).catch(() => undefined)
    return 'failed'
  }
}

/**
 * The fallback: send what has fallen due and the queue is not carrying. Run
 * by the request drain and the cron. Bounded, and a no-op without 0194.
 */
export async function drainDueTelegramShiftOverviews(env: Env, nowMs: number = Date.now(), options: { limit?: number; sweepStale?: boolean } = {}): Promise<number> {
  if (!(await scheduledSendsAvailable(env))) return 0
  const db = getDb(env)
  const now = new Date(nowMs).toISOString()
  const limit = options.limit ?? 3
  // The cron only: the request drain stays a single indexed read.
  if (options.sweepStale) {
    await db.prepare(`UPDATE telegram_scheduled_sends SET status = 'failed', last_error = 'abandoned mid-send; not retried (at most once)'
      WHERE status = 'sending' AND claimed_at < @stale`).run({ stale: new Date(nowMs - SHIFT_OVERVIEW_STALE_CLAIM_MS).toISOString() })
  }
  const due = await db.prepare(`SELECT send_key FROM telegram_scheduled_sends
    WHERE status = 'pending' AND due_at <= @now AND (dispatch = 'fallback' OR due_at <= @queueGrace)
    ORDER BY due_at LIMIT @limit`).all<{ send_key: string }>({ now, queueGrace: new Date(nowMs - SHIFT_OVERVIEW_QUEUE_GRACE_MS).toISOString(), limit })
  let sent = 0
  for (const row of due) if ((await deliverTelegramShiftOverview(env, row.send_key, nowMs)) === 'sent') sent += 1
  return sent
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

/**
 * `categories` is the owner's per-category switch set, threaded in from the
 * SAME `getTelegramConfig` read that supplies `language` just above it. It was
 * missing until Sep 23 2026, and the effect was that the switches worked on
 * the pushed evening summary (sendTelegramTodaySummary passes them) but did
 * nothing at all when someone typed `/report`: the same report, the same
 * builder, two different answers depending on how it was asked for.
 */
export async function telegramCommandReply(env: Env, text: string, nowMs: number = Date.now(), language: TelegramLanguage = 'both', categories?: TelegramCategories): Promise<string> {
  const parts = String(text || '').trim().split(/\s+/)
  // Group chats deliver "/report@shop_bot"; strip the bot mention.
  const command = String(parts[0] || '').toLowerCase().replace(/@[^\s]+$/, '')
  const argument = parts.slice(1).join(' ')

  if (command === '/help' || command === '/start') return withLanguage(language, telegramCommandReference)
  if (command === '/inventory') return inventorySummaryReport(env, language)
  if (command === '/stock' || command === '/lowstock') return inventoryReport(env, language)
  if (!DATED_COMMANDS.has(command)) return withLanguage(language, () => unknownCommandReply(firstCharacters(command, 32)))

  const parsed = withLanguage(language, () => parseReportDate(argument, businessToday(nowMs)))
  if (!parsed.ok) return parsed.message
  if (command === '/sales') return salesReport(env, parsed.date, language)
  if (command === '/fees') return feesReport(env, parsed.date, language)
  // `/shifts` is accepted as well as `/shift`: the reply is a list, and a
  // manager who types the plural should get the report rather than the
  // unknown-command help.
  if (command === '/shift' || command === '/shifts') return shiftReport(env, parsed.date, nowMs, language)
  return dayReport(env, parsed.date, language, categories)
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
  // A typed command replies IN THE TOPIC IT WAS ASKED FROM -- the reader is
  // already looking at that thread -- rather than the configured push topic,
  // which is for alerts nobody asked for. General chat carries no thread id,
  // so this is undefined there, same as before topics existed.
  const threadId = Number(message?.message_thread_id) || undefined
  // THE ACCESS BOUNDARY (S4-9). A Telegram group carries no Business OS
  // session, so the only thing that can be checked is which chat is asking.
  // Any chat that is not on the owner's allow-list gets a refusal carrying
  // nothing but its own chat id -- never a figure, a receipt or a product.
  if (!config.chatIds.includes(chatId)) {
    await postTelegram(config, withLanguage(config.language, () => telegramUnauthorizedReply(chatId)), chatId, threadId)
    return
  }
  await postTelegram(config, await telegramCommandReply(env, text, Date.now(), config.language, config.categories), chatId, threadId)
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
// promotionLabel: the promotion's title as captured on the sale line
// (product_discount_label), printed inside the cut's parentheses so the
// line names the offer as well as the amount: "(−$0.20 Summer sale)".
export type TelegramSaleItem = { name: string; quantity: number; unitPriceUsd: number; basePriceUsd?: number | null; lineTotalUsd: number; promotionLabel?: string | null }
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
  /** Received date is the display concept; `lot` remains a wire-compatible
   * legacy alias for callers that still carry the stored lot code. */
  receivedDate?: string | null; lot?: string | null
  branchOnHand?: number | null; totalOnHand?: number | null; by?: string | null
}
const TELEGRAM_MAX_ITEM_LINES = 20

/**
 * Join an event message's row GROUPS, each under its own titled section.
 *
 * Owner, Sep 22 2026, over a sale alert: "for sales we can do like this. so it
 * is easier to read." Their reference layout separates when/what-it-is, who
 * rang it up, who it was for, the items, and the money -- distinct blocks a
 * reader can jump between instead of one column of fifteen rows. Owner, 25
 * Sep 2026: "the sale invoice must also use ====Section/ខ្មែរ==== headers
 * instead of the plain ────── lines" -- the same section glyph the reports
 * use (REPORT_SECTION_EDGE), not a second divider style for event messages.
 *
 * A group whose rows are ALL empty (no customer at all, a sale with no
 * delivery) takes its header with it, so an anonymous walk-in never ships a
 * titled section with nothing under it. Blanks are dropped HERE rather than
 * by sendTelegramEvent's `.filter(Boolean)` because only this function can
 * tell an empty group from an empty row.
 *
 * The header text is NOT rendered here: `sale.receiptNumber`'s builder is
 * called by the ROUTE, before sendTelegramEvent has read config.language and
 * called withLanguage -- exactly the ordering bug a nearby comment already
 * warns about ("the route calls it BEFORE sendTelegramEvent sets the shop's
 * language"). Rendering `sectionHeader()` here would bake in whatever
 * language happened to be left in telegramLang's module state, the SAME
 * global-state leak, just for section titles instead of a stray line -- an
 * en-only or km-only shop would still get a bilingual `====Details/
 * ព័ត៌មាន====` row sitting above correctly single-language rows. A marker
 * line instead defers the actual header text to sendTelegramEvent's mapping
 * step, which runs INSIDE withLanguage.
 */
/** Exported for scripts/test-telegram-messages-pure.cjs, which asserts on the
 *  raw builder output directly (before sendTelegramEvent resolves it). */
export const EVENT_SECTION_MARKER = '\u0001SECTION:'
function eventGroups(groups: Array<{ key: TelegramLabelKey; rows: string[] }>): string[] {
  return groups
    .map((group) => ({ key: group.key, rows: group.rows.filter(Boolean) }))
    .filter((group) => group.rows.length)
    .flatMap((group) => [`${EVENT_SECTION_MARKER}${group.key}`, ...group.rows])
}

/**
 * An event message's TITLE line: its heading and the one record it is about,
 * `🛍️ Sale Invoice: 20260923-153527` (owner's Sep 23 2026 sample). The
 * heading words are localized like any heading (localizeTelegramLine), the
 * number is a value and never is. With no number it is the bare heading --
 * never a heading that ends on a colon.
 */
function eventTitle(words: string, record: unknown): string {
  const value = cleanLine(record, 40)
  return value ? `${words}: ${value}` : words
}

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

/**
 * Convert the stored lot identifier used by older event callers into the
 * operator-facing received date. Date-derived lot codes are MMDDYYYY in the
 * database and must be read day-first on screen. A custom legacy code is
 * preserved as a value rather than dropped; it is still better to show the
 * recorded identity than to silently claim that no date exists.
 */
function receivedDateText(receivedDate?: string | null, lotCode?: string | null): string {
  const raw = String(receivedDate || lotCode || '').trim()
  if (!raw) return ''
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return `${String(Number(iso[3])).padStart(2, '0')}/${String(Number(iso[2])).padStart(2, '0')}/${iso[1]}`
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (slash) {
    const year = Number(slash[3]) < 100 ? Number(slash[3]) + 2000 : Number(slash[3])
    return `${String(Number(slash[1])).padStart(2, '0')}/${String(Number(slash[2])).padStart(2, '0')}/${year}`
  }
  if (/^\d{8}$/.test(raw)) {
    const month = Number(raw.slice(0, 2)); const day = Number(raw.slice(2, 4)); const year = Number(raw.slice(4))
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    if (month >= 1 && month <= 12 && day >= 1 && day <= lastDay && year >= 1970 && year <= 2999) {
      return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
    }
  }
  return raw
}

export function formatSaleTelegramLines(sale: TelegramSaleSummary): string[] {
  // P10 (owner, photo of a printed receipt): "i want a numbered list for
  // each products as well just before each products." The Telegram sale
  // alert is the same receipt summary in text form (see the comment above
  // this function), so each line gets the same "1. name ..." numbering the
  // printed receipt now carries instead of a bare bullet -- the +N more
  // line below still counts against sale.items.length, not this slice, so
  // the numbering does not relabel the items it hides. An item too wide for
  // a phone continues on indented lines (telegramRowLines).
  const items = sale.items.slice(0, TELEGRAM_MAX_ITEM_LINES).flatMap((item, index) => {
    const quantity = Number(item.quantity) || 0
    const base = Number(item.basePriceUsd)
    const netUnitPrice = round2(Number(item.unitPriceUsd) || 0)
    const netLineTotal = round2(Number(item.lineTotalUsd) || 0)
    const grossUnitPrice = round2(base)
    const lineDiscount = Number.isFinite(base) && grossUnitPrice > netUnitPrice
      ? round2(Math.max(0, round2(grossUnitPrice * quantity) - netLineTotal))
      : 0
    const displayedUnitPrice = lineDiscount > 0 ? grossUnitPrice : netUnitPrice
    const promotionLabel = lineDiscount > 0 ? cleanLine(item.promotionLabel, 40) : ''
    return telegramRowLines(`${index + 1}. ${cleanLine(item.name, 100)}`, [
      `${quantity} × ${usd(displayedUnitPrice)}`,
      lineDiscount ? `(−${usd(lineDiscount)}${promotionLabel ? ` ${promotionLabel}` : ''})` : '',
      `= ${usd(netLineTotal)}`,
    ])
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
  // Defaulted, because the Status row is unconditional since Sep 22 2026 and a
  // caller that omits the status must not produce `Status:` with nothing after
  // it. `completed` is the same reading the app's own normalizer gives a
  // missing sale_status, and the title already says this is a sale invoice.
  const status = String(sale.status || 'completed').replace(/_/g, ' ')
  // The pre-discount, pre-tax figure the customer was quoted. When there is
  // neither a discount nor a tax it IS the Net Total, and printing the same
  // dollars twice under two labels is precisely what the owner asked us to
  // stop doing -- so on the ordinary sale it does not print at all.
  const grossTotalUsd = round2((Number(sale.subtotalUsd) || 0) + customerDelivery)
  const totalRepeatsNet = grossTotalUsd === round2(Number(sale.totalUsd) || 0)
  // THE TITLE NAMES THE RECEIPT (owner's Sep 23 2026 sample: "🛍️ Sale Invoice
  // / វិក្កយបត្រការលក់: 20260923-153527"). The number used to sit on an INV row
  // under the status and date; it is the invoice the whole message is about,
  // so it heads the message. sendTelegramEvent gives a sales event no heading
  // of its own: this first line is the heading.
  return [eventTitle('🛍️ Sale invoice', sale.receiptNumber), ...eventGroups([
    // WHAT HAPPENED, WHO RANG IT UP. Status leads, and it prints on EVERY
    // sale now (owner's Sep 22 2026 reference layout opens on it). It used to
    // be dropped on a completed sale as "the norm the heading already
    // announces" -- but the reader scanning a phone at the till wants the
    // same row in the same place on every message far more than they want
    // one line saved, and a status that appears only when something is
    // unusual is a row whose ABSENCE has to be interpreted. The value's
    // wording comes from telegramLang's status table, so it says "Not Paid /
    // ប្រាក់ជំពាក់". Status and Date only since Sep 23 2026: the INV row moved
    // into the title. Cashier and Branch join this same section (owner, 25
    // Sep 2026: "====Details/ព័ត៌មាន==== for status, date and cashier").
    {
      key: 'details',
      rows: [
        `Status: ${status}`,
        `Date: ${formatBusinessDateTime(sale.createdAt)}`,
        `Cashier: ${sale.cashier || 'Unknown'}`,
        sale.branch ? `Branch: ${sale.branch}` : '',
      ],
    },
    // WHO IT WAS FOR. The driver belongs with the customer, not alone at the
    // foot of the message: on a delivery the three of them are one fact --
    // who bought it, how to reach them, who is taking it to them.
    {
      key: 'customer',
      rows: [
        sale.customer ? `Customer: ${sale.customer}` : '',
        sale.phone ? `Tel: ${sale.phone}` : '',
        sale.driver?.name ? `Delivery driver: ${sale.driver.name}${sale.driver.phone ? ` · ${sale.driver.phone}` : ''}` : '',
      ],
    },
    // WHAT WAS BOUGHT.
    {
      key: 'items',
      rows: [
        ...items,
        sale.items.length > TELEGRAM_MAX_ITEM_LINES ? `+ ${sale.items.length - TELEGRAM_MAX_ITEM_LINES} more item(s)` : '',
      ],
    },
    // WHAT IT CAME TO.
    {
      key: 'payment',
      rows: [
        sale.isDelivery ? `Delivery service: ${usd(deliveryFee)}${shopAbsorbedDelivery ? ' (shop paid)' : ''}` : '',
        totalRepeatsNet ? '' : `Total: ${usd(grossTotalUsd)}`,
        sale.discountUsd ? `Discount: −${usd(sale.discountUsd)}` : '',
        sale.taxUsd ? `Tax: ${usd(sale.taxUsd)}` : '',
        // totalKhr is the converted equivalent of totalUsd, while paidUsd and
        // paidKhr are native tender amounts. Change from saleTotals is likewise
        // an equivalent pair unless a caller can explicitly establish that both
        // currencies were physically returned.
        //
        // THE MONEY LINE IS LABELLED WITH THE SALE'S STATUS (owner, Sep 23 2026:
        // "a paid sale would usually already use a completed status"). So it
        // reads `Completed / បានបញ្ចប់: $8.00 · 32,800៛` on a settled sale and
        // `Not Paid / ប្រាក់ជំពាក់: $8.00 · 32,800៛` on an unsettled one -- one
        // figure, stated once, under the name of the state the sale is in. The
        // words come from the status table in telegramLang.ts, the same table
        // that renders the `Status:` row at the top of this message, so renaming
        // a status renames this line with it and the two can never disagree.
        // The currency pair uses `·`, the SAME separator the shift report's own
        // money() calls default to (owner, 25 Sep 2026: "no spaced slashes ...
        // for the currency pair use `$8.00 · 32,800៛`, matching the shift
        // report's `$19.25 · 93,500៛`") -- a bare default call, not a literal
        // repeated at this site.
        //
        // It replaced a neutral `Net Total`, which told the reader nothing the
        // heading had not already said, and which the unsettled sale had to be
        // special-cased away from to get its own word.
        `${saleStatusMoneyLabel(status)}: ${money(sale.totalUsd, sale.totalKhr)}`,
        // No recorded tender means no Paid line: the status above carries the
        // "not paid" fact already, so a line saying it again is one more line
        // for nothing.
        paid > 0 ? `Paid: ${money(sale.paidUsd, sale.paidKhr, ' + ')}${sale.paymentMethod ? ` (${sale.paymentMethod})` : ''}` : '',
        change > 0 ? `Change: ${money(sale.changeUsd, sale.changeKhr, sale.changeIsActualDual ? ' + ' : undefined)}` : '',
      ],
    },
  ])]
}

/**
 * The receipt-status change -- `PATCH /api/sales/:id/status`'s alert.
 *
 * Laid out as the owner's Sep 23 2026 sample, updated 25 Sep 2026 to titled
 * sections instead of a plain rule between the two groups:
 *
 *   🧾 Invoice/វិក្កយបត្រ: 20260922-110132
 *   ====Details/ព័ត៌មាន====
 *   · Status updated/ស្ថានភាពផ្លាស់ប្ដូរ: Not Paid/ប្រាក់ជំពាក់ → Completed/បានបញ្ចប់
 *   ====Customer/អតិថិជន====
 *   · Customer/អតិថិជន: bong meta
 *   · By/ដោយ: admin
 *
 * The title names the invoice, like the sale alert's (it replaced the
 * "Receipt status updated" heading and the Receipt row under it), and the
 * change is the one row under Details. The rows the sample does not show --
 * Reason, Stock skipped, Lost fee -- keep their order, after Customer and
 * before By, all under the Customer section.
 *
 * It lived INLINE in routes/sales.ts until Sep 22 2026, and that is exactly
 * why the owner found `Status: awaiting payment → completed` on their phone
 * months after the app stopped using those words anywhere else: a route
 * composing message text is a place the message rules do not reach. It is a
 * builder like every other event message now, beside the sale summary whose
 * Status line it has to agree with, and it emits the SAME raw status strings
 * that summary does so both are translated by the one status table in
 * telegramLang.ts.
 *
 * `reason` arrives already resolved to display text (routes/sales.ts owns the
 * cancellation-reason vocabulary), and `by` is last, the idiom every other
 * builder that names an actor already follows.
 */
export type TelegramStatusChange = {
  // `receipt` and `customer` are read straight off the D1 row, which the
  // status handler holds as a `Record<string, unknown>`, so they arrive
  // untyped and are cleaned here rather than cast at the call site.
  receipt: unknown
  fromStatus: string
  toStatus: string
  customer?: unknown
  reason?: string | null
  /** > 0 when the transition deliberately moved no stock (S4-2). */
  skippedUnits?: number
  lostFeeUsd?: number
  lostFeeKhr?: number
  by?: string | null
}
export function formatSaleStatusTelegramLines(change: TelegramStatusChange): string[] {
  const readable = (value: unknown) => String(value ?? '').replace(/_/g, ' ')
  const skipped = Math.round(Number(change.skippedUnits) || 0)
  const lostFeeUsd = Number(change.lostFeeUsd) || 0
  const lostFeeKhr = Number(change.lostFeeKhr) || 0
  const customer = cleanLine(change.customer, 120)
  return [eventTitle('🧾 Invoice', change.receipt), ...eventGroups([
    // The raw English MUST equal LABELS.statusUpdated.en exactly (telegramLang.ts):
    // localizeTelegramLine finds this label by that string before the first ': '.
    // Both sides of the arrow are the SAME status vocabulary readable() feeds
    // into the phrase table below (VALUE_PHRASES/SALE_STATUS_PHRASES), so a
    // real sale status translates on both sides identically -- never only the
    // "from" side -- because it is one regex pass over the whole line, not a
    // per-argument lookup.
    { key: 'details', rows: [`Status updated: ${readable(change.fromStatus)} → ${readable(change.toStatus)}`] },
    {
      key: 'customer',
      rows: [
        customer ? `Customer: ${customer}` : '',
        change.reason ? `Reason: ${change.reason}` : '',
        // S4-2: say it out loud on the shop's channel too -- a status change
        // that moved no stock must not look like a normal one.
        //
        // A PLAIN ENGLISH LINE, like every other row here. It was briefly
        // composed with bi() instead, and that is a bug this builder cannot
        // survive: the route calls it BEFORE sendTelegramEvent sets the shop's
        // language, so bi() read whatever mode was left in the module -- always
        // the `both` default -- and the note shipped bilingual to an en-only and
        // a km-only shop alike. Emitted as `Stock skipped: 3 unit(s)`, it goes
        // through localizeTelegramLine with the rest of the message: the label
        // pair comes from the table (en/km.json sale_stock_skipped) and the
        // counter from the same `unit(s)` phrase the stock reports use.
        skipped > 0 ? `Stock skipped: ${skipped} unit(s)` : '',
        lostFeeUsd || lostFeeKhr ? `Lost fee: ${money(lostFeeUsd, lostFeeKhr)}` : '',
        change.by ? `By: ${change.by}` : '',
      ],
    },
  ])]
}

// Stock alerts carry the RESULTING on-hand figures (this branch, all
// branches), not only the delta -- "for stock change, should also show total".
export function formatStockChangeTelegramLines(change: TelegramStockChange): string[] {
  const quantity = Math.abs(Number(change.quantity) || 0)
  const received = receivedDateText(change.receivedDate, change.lot)
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
    received ? `Received date: ${received}` : '',
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
  product: string; quantity: number; receivedDate?: string | null; lot?: string | null; mergedInto?: string | null
  fromOnHand?: number | null; toOnHand?: number | null; totalOnHand?: number | null
}
export type TelegramTransferSummary = {
  createdAt?: string | null; fromBranch?: string | null; toBranch?: string | null
  items: TelegramTransferLine[]; note?: string | null; by?: string | null
}
export type TelegramReturnLine = {
  product: string; quantity: number; refundUsd?: number | null; receivedDate?: string | null; lot?: string | null
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

// The resulting on-hand of one bullet, `· Warehouse 90 · Shop 25 · all
// branches 115`. This is a mid-row CONTINUATION piece, not a label: value row
// -- telegramRowLines joins every part with a leading space of its own, so a
// colon here would read as "150 : Warehouse 90" (a space before the colon).
// `·`, the app's own generic figure separator (money()'s join), replaces the
// em dash instead (owner, 25 Sep 2026: "no em dash anywhere"). A figure the
// route could not read back is left out.
function onHandPart(parts: Array<[string, number | null | undefined]>): string {
  const shown = parts.filter(([, value]) => value != null).map(([label, value]) => `${label} ${Number(value) || 0}`)
  return shown.length ? `· ${shown.join(' · ')}` : ''
}

// Each product is one bullet; a bullet too wide for a phone continues on the
// hanging indent (telegramRowLines), like the items of a sale alert.
export function formatTransferTelegramLines(transfer: TelegramTransferSummary): string[] {
  const from = transfer.fromBranch || 'Source'
  const to = transfer.toBranch || 'Destination'
  const items = transfer.items.slice(0, TELEGRAM_MAX_ITEM_LINES).flatMap((item) => {
    const received = receivedDateText(item.receivedDate, item.lot)
    return telegramRowLines(`• ${cleanLine(item.product, 100)}`, [
      String(Math.abs(Number(item.quantity) || 0)),
      received ? `(received date ${cleanLine(received, 40)})` : '',
      item.mergedInto ? `→ ${cleanLine(item.mergedInto, 100)}` : '',
      onHandPart([[from, item.fromOnHand], [to, item.toOnHand], ['all branches', item.totalOnHand]]),
    ])
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
  const items = ret.items.slice(0, TELEGRAM_MAX_ITEM_LINES).flatMap((item) => {
    const received = receivedDateText(item.receivedDate, item.lot)
    return telegramRowLines(`• ${cleanLine(item.product, 100)}`, [
      String(Math.abs(Number(item.quantity) || 0)),
      item.refundUsd != null ? `= ${usd(item.refundUsd)}` : '',
      item.stockAction ? `(${String(item.stockAction).replace(/_/g, ' ')})` : '',
      received ? `(received date ${cleanLine(received, 40)})` : '',
      onHandPart([[ret.branch || 'Branch', item.branchOnHand], ['all branches', item.totalOnHand]]),
    ])
  })
  const replacements = (ret.replacements || []).slice(0, TELEGRAM_MAX_ITEM_LINES)
    .flatMap((rep) => telegramRowLines(`↔ ${cleanLine(rep.product, 100)}`, [String(Math.abs(Number(rep.quantity) || 0))]))
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
type ReturnItemRow = { product_name: string | null; quantity: number; total_usd: number | null; stock_action: string | null; lot_code: string | null; received_at: string | null; branch_on_hand: number | null; total_on_hand: number | null }
export async function sendReturnTelegramEvent(env: Env, returnId: number, base: Omit<TelegramReturnSummary, 'items' | 'replacements'>): Promise<boolean> {
  const db = getDb(env)
  const [items, replacements] = await Promise.all([
    db.prepare(`SELECT ri.product_name, ri.quantity, ri.total_usd, ri.stock_action, pb.lot_code, pb.received_at,
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
        stockAction: base.kind === 'supplier' ? null : row.stock_action,
        receivedDate: row.received_at,
        lot: row.lot_code,
        branchOnHand: row.branch_on_hand == null ? null : Number(row.branch_on_hand) || 0,
        totalOnHand: row.total_on_hand == null ? null : Number(row.total_on_hand) || 0,
      })),
      replacements: replacements.map((row) => ({ product: row.product_name || 'Item', quantity: Number(row.quantity) || 0 })),
    }),
  })
}
