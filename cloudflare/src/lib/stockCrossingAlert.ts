// Low and out-of-stock alerts fire when a SALE CROSSES the threshold, once per crossing (owner ruling, 6 Oct 2026).
//
// A crossing is a branch's quantity of a product going from above a threshold to at or below it in one sale:
//   'out'  before > out-of-stock threshold and after <= it
//   'low'  before > low-stock threshold and out < after <= low-stock threshold   (the middle tier only: a sale
//          that jumps straight to out of stock raises the out alert, not two)
// The thresholds are the ones every other surface uses (lib/lowStockSettings.ts effectiveLowStockThreshold and the
// product's out_of_stock_threshold), so an alert and the Inventory badge can never disagree about what "low" means.
// With the low-quantity switch off the low threshold is -1 and no quantity is <= it, so only 'out' can fire.
//
// The quantities are REAL, read AFTER the write committed (never the pre-commit availability read, which two tills
// selling at the same moment both see as the old value): `after` is the branch's quantity now, `before` is
// after + the units this sale took. A caller therefore passes only what it knows (product, branch, units) and the
// read happens here, in the caller's waitUntil, never in front of the response.
//
// Once per crossing is enforced by the database (migration 0272): a claim row is INSERT OR IGNOREd before anything is
// sent, under two unique keys (the restock epoch, and the sale itself), and only the call that inserts the row sends.
// Delivery is at most once and inline: a failed send is recorded and never retried. One message goes out per branch
// and tier for the whole call, listing every product that crossed (capped), not one message per product.
import type { Env } from '../index'
import { getDb } from './db'
import { effectiveLowStockThreshold, LOW_STOCK_SETTING_KEYS, resolveLowStockConfig, type LowStockConfig } from './lowStockSettings'
import { LEDGER_OUT_TYPES } from './stockLedgerQuery'
import { sendTelegramEvent } from './telegram'

export type CrossingTier = 'low' | 'out'

/**
 * What a caller of a stock deduction knows: the product, the branch it left, and how many units. `after` is the branch's
 * quantity straight out of the deduction batch itself (RETURNING on the stock update, so it is exact for THIS write and costs
 * no statement); a caller that cannot have it omits it and the quantity is read after the commit.
 */
export type StockSaleLine = { productId: number; branchId: number; quantity: number; after?: number }

/** A line joined with the branch's quantity NOW (after the commit) and the product's own thresholds. */
export type StockLineState = StockSaleLine & {
  after: number
  name: string
  lowThreshold?: unknown
  outThreshold?: unknown
}

export type StockCrossing = {
  tier: CrossingTier
  productId: number
  branchId: number
  name: string
  before: number
  after: number
}

export const LOW_STOCK_ALERT_HEADING = '⚠️ Low stock'
export const OUT_OF_STOCK_ALERT_HEADING = '🛑 Out of stock'
/** Products listed in one message; the rest are counted ("+ N more item(s)"). */
export const CROSSING_MESSAGE_PRODUCT_CAP = 20

const finite = (value: unknown, fallback: number): number => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

/** The one rule. `low` is the effective low threshold (-1 when the alert is off). */
export function classifyCrossing(before: number, after: number, low: number, out: number): CrossingTier | null {
  if (!(before > after)) return null
  if (before > out && after <= out) return 'out'
  if (before > low && after <= low && after > out) return 'low'
  return null
}

/** Repeated lines of one product at one branch are one line (their units add). Lines with no units are dropped. */
export function mergeSaleLines(lines: readonly StockSaleLine[]): StockSaleLine[] {
  const merged = new Map<string, StockSaleLine>()
  for (const line of lines) {
    const quantity = finite(line.quantity, 0)
    if (!(quantity > 0) || !Number.isSafeInteger(line.productId) || !Number.isSafeInteger(line.branchId)) continue
    const key = `${line.branchId}:${line.productId}`
    const seen = merged.get(key)
    const after = Number.isFinite(Number(line.after)) && line.after != null ? Number(line.after) : undefined
    if (seen) {
      seen.quantity += quantity
      // Lines of one product come from one running quantity, so the LAST one's RETURNING is the final figure.
      if (after !== undefined) seen.after = after
    } else merged.set(key, { productId: line.productId, branchId: line.branchId, quantity, ...(after !== undefined ? { after } : {}) })
  }
  return [...merged.values()]
}

export function detectCrossings(states: readonly StockLineState[], config: LowStockConfig): StockCrossing[] {
  const crossings: StockCrossing[] = []
  for (const state of states) {
    const after = Math.max(0, finite(state.after, 0))
    const before = after + finite(state.quantity, 0)
    const tier = classifyCrossing(before, after, effectiveLowStockThreshold(config, state.lowThreshold), finite(state.outThreshold, 0))
    if (tier) crossings.push({ tier, productId: state.productId, branchId: state.branchId, name: state.name, before, after })
  }
  return crossings
}

/**
 * The Telegram events for crossings that share a branch and a tier: one product is three short rows
 * (Product / Branch / On hand); several are a Branch row, a Products count and one row per product with the
 * quantity left, capped. telegramLang makes it Khmer and English.
 */
export function formatCrossingMessage(crossings: readonly StockCrossing[], tier: CrossingTier, branchName: string | null | undefined): { heading: string; lines: string[] } {
  const heading = tier === 'out' ? OUT_OF_STOCK_ALERT_HEADING : LOW_STOCK_ALERT_HEADING
  if (crossings.length === 1) {
    return { heading, lines: [`Product: ${crossings[0].name}`, branchName ? `Branch: ${branchName}` : '', `On hand: ${crossings[0].after}`] }
  }
  const shown = crossings.slice(0, CROSSING_MESSAGE_PRODUCT_CAP)
  const hidden = crossings.length - shown.length
  return {
    heading,
    lines: [
      branchName ? `Branch: ${branchName}` : '',
      `Product count: ${crossings.length}`,
      ...shown.map((crossing) => `• ${crossing.name} · ${crossing.after}`),
      ...(hidden > 0 ? [`+ ${hidden} more item(s)`] : []),
    ],
  }
}

/** Unique per product, branch, tier and restock epoch (see the 0272 header). */
export const crossingAlertKey = (tier: CrossingTier, branchId: number, productId: number, epoch: number): string =>
  `stock-crossing:${tier}:${branchId}:${productId}:${epoch}`

// The restock marker counts only REAL INFLOWS: a positive quantity whose movement type is not an outflow. Out-type
// movements (transfer_out, move_out, remove, ...) are often stored as positive magnitudes, so "quantity > 0" alone
// would move the marker on an outflow. The outflow list is the Stock Change ledger's own (LEDGER_OUT_TYPES), so the
// two can never disagree about which way a movement type goes; everything else (add, stock_in, transfer_in, move_in,
// return, damage_reversal, adjustment ...) is an inflow, exactly as the ledger's In column.
const OUT_TYPE_LIST = LEDGER_OUT_TYPES.map((type) => `'${type}'`).join(',')
export const RESTOCK_EPOCH_SQL = `SELECT COALESCE(MAX(id), 0) AS epoch FROM inventory_movements
  WHERE product_id = @productId AND branch_id = @branchId AND quantity > 0 AND movement_type NOT IN (${OUT_TYPE_LIST})`

// Memoises only a POSITIVE probe (as lib/telegram.ts scheduledSendsAvailable does): the migration may land after the Worker.
let tableReady = false
export function __resetStockCrossingProbeForTests(): void { tableReady = false }
export async function stockCrossingTableAvailable(env: Env): Promise<boolean> {
  if (tableReady) return true
  try {
    const row = await getDb(env).prepare("SELECT COUNT(*) AS ready FROM sqlite_master WHERE type='table' AND name='stock_crossing_alerts'").get<{ ready: number }>()
    tableReady = Number(row?.ready ?? 0) > 0
  } catch { /* a failed read is not evidence the table is missing */ }
  return tableReady
}

export type RecordCrossingsInput = {
  /** The sale that took the units, or null for a deduction that is not a new sale (an added line, a restore, a replacement). */
  saleId: number | null
  lines: readonly StockSaleLine[]
}
export type RecordCrossingsResult = { crossings: number; claimed: number; sent: number }

type StateRow = { settings_json: string | null; product_id: number; branch_id: number; name: string | null; low_stock_threshold: unknown; out_of_stock_threshold: unknown; quantity: number }

/**
 * The branch quantity of every touched product NOW, with its thresholds AND the low-stock settings: ONE statement for the
 * whole call (the settings ride along as a scalar subselect), because this runs in the request's waitUntil and every D1
 * statement counts against the Free plan's per-request budget (the exchange-return budget test).
 */
async function readStates(env: Env, lines: readonly StockSaleLine[]): Promise<{ states: StockLineState[]; config: LowStockConfig }> {
  // sql-bound-params: the keys are the fixed three-key LOW_STOCK_SETTING_KEYS enum, never data.
  const settingKeys = LOW_STOCK_SETTING_KEYS.map((key) => `'${key}'`).join(',')
  const rows = await getDb(env).prepare(`SELECT (SELECT json_group_object(key, value) FROM settings WHERE key IN (${settingKeys})) AS settings_json, p.id AS product_id, bs.branch_id AS branch_id, p.name AS name,
      p.low_stock_threshold AS low_stock_threshold, p.out_of_stock_threshold AS out_of_stock_threshold, COALESCE(bs.quantity, 0) AS quantity
    FROM products p JOIN branch_stock bs ON bs.product_id = p.id
    WHERE p.id IN (SELECT value FROM json_each(@productIds)) AND bs.branch_id IN (SELECT value FROM json_each(@branchIds))`)
    .all<StateRow>({
      productIds: JSON.stringify([...new Set(lines.map((line) => line.productId))]),
      branchIds: JSON.stringify([...new Set(lines.map((line) => line.branchId))]),
    })
  let settings: Record<string, unknown> = {}
  try { settings = rows.length && rows[0].settings_json ? JSON.parse(rows[0].settings_json) : {} } catch { settings = {} }
  const config = resolveLowStockConfig(settings)
  const byKey = new Map(rows.map((row) => [`${row.branch_id}:${row.product_id}`, row]))
  const states: StockLineState[] = []
  for (const line of lines) {
    const row = byKey.get(`${line.branchId}:${line.productId}`)
    if (row) states.push({ ...line, after: line.after !== undefined ? line.after : Number(row.quantity) || 0, name: String(row.name || `#${line.productId}`), lowThreshold: row.low_stock_threshold, outThreshold: row.out_of_stock_threshold })
  }
  return { states, config }
}

/**
 * Called once the deduction has COMMITTED, inside the caller's waitUntil. Never throws: a sale must not fail because
 * of an alert. Records every new crossing and sends one Telegram message per branch and tier for the crossings this
 * call claimed.
 */
export async function recordStockCrossings(env: Env, input: RecordCrossingsInput): Promise<RecordCrossingsResult> {
  const result: RecordCrossingsResult = { crossings: 0, claimed: 0, sent: 0 }
  try {
    const lines = mergeSaleLines(input.lines)
    if (!lines.length) return result
    const { states, config } = await readStates(env, lines)
    const crossings = detectCrossings(states, config)
    if (!crossings.length) return result
    // The table probe waits until there IS a crossing: the common sale crosses nothing and pays one statement in all.
    if (!(await stockCrossingTableAvailable(env))) return result
    result.crossings = crossings.length
    const db = getDb(env)
    const claimed: Array<{ crossing: StockCrossing; key: string }> = []
    for (const crossing of crossings) {
      const movement = await db.prepare(RESTOCK_EPOCH_SQL).get<{ epoch: number }>({ productId: crossing.productId, branchId: crossing.branchId })
      const key = crossingAlertKey(crossing.tier, crossing.branchId, crossing.productId, Number(movement?.epoch || 0))
      const inserted = await db.prepare(`INSERT OR IGNORE INTO stock_crossing_alerts
        (alert_key, product_id, branch_id, tier, sale_id, quantity_before, quantity_after, created_at)
        VALUES (@key, @productId, @branchId, @tier, @saleId, @before, @after, @now)`).run({
        key, productId: crossing.productId, branchId: crossing.branchId, tier: crossing.tier,
        saleId: input.saleId, before: crossing.before, after: crossing.after, now: new Date().toISOString(),
      })
      if (inserted.changes) claimed.push({ crossing, key })
    }
    result.claimed = claimed.length
    if (!claimed.length) return result
    const branchRows = await db.prepare('SELECT id, name FROM branches WHERE id IN (SELECT value FROM json_each(@ids))')
      .all<{ id: number; name: string | null }>({ ids: JSON.stringify([...new Set(claimed.map((entry) => entry.crossing.branchId))]) })
    const branchNames = new Map(branchRows.map((row) => [Number(row.id), row.name]))
    const groups = new Map<string, typeof claimed>()
    for (const entry of claimed) {
      const groupKey = `${entry.crossing.tier}:${entry.crossing.branchId}`
      groups.set(groupKey, [...(groups.get(groupKey) || []), entry])
    }
    // Out of stock first: it is the one that needs action.
    const ordered = [...groups.values()].sort((a, b) => (a[0].crossing.tier === 'out' ? 0 : 1) - (b[0].crossing.tier === 'out' ? 0 : 1))
    for (const group of ordered) {
      let status: 'sent' | 'skipped' | 'failed' = 'skipped'
      let error: string | null = null
      try {
        const message = formatCrossingMessage(group.map((entry) => entry.crossing), group[0].crossing.tier, branchNames.get(group[0].crossing.branchId))
        status = (await sendTelegramEvent(env, { type: 'stock_alert', heading: message.heading, lines: message.lines })) ? 'sent' : 'skipped'
      } catch (sendError) {
        status = 'failed'
        error = String((sendError as Error)?.message || sendError).slice(0, 300)
        console.error('[telegram] stock crossing alert could not be sent', error)
      }
      if (status === 'sent') result.sent += 1
      await db.prepare('UPDATE stock_crossing_alerts SET telegram_status = @status, telegram_error = @error WHERE alert_key IN (SELECT value FROM json_each(@keys))')
        .run({ keys: JSON.stringify(group.map((entry) => entry.key)), status, error }).catch(() => undefined)
    }
  } catch (error) {
    console.error('[stock] crossing alerts could not be recorded', error)
  }
  return result
}
