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
// Quantities are the SELLING BRANCH's (branch_stock): that is what the sale deducted. The routes already read the
// before-quantity for the availability check, so detection costs no extra read. After consolidation (Old Shop
// closed, everything in LC Store) the branch is simply the one store.
//
// Once per crossing is enforced by the database, not by the caller's care (migration 0272): a claim row is
// INSERT OR IGNOREd before anything is sent, under two unique keys (see the migration header): the restock epoch
// (racing sales, retries) and the sale itself (undo then redo). Only the request that inserts the row sends.
// Delivery is at most once and inline: a failed send is recorded and never retried.
import type { Env } from '../index'
import { bumpVersion } from './cache'
import { getDb } from './db'
import { effectiveLowStockThreshold, loadLowStockConfig, type LowStockConfig } from './lowStockSettings'
import { sendTelegramEvent } from './telegram'

export type CrossingTier = 'low' | 'out'

/** One product at the selling branch, as the sale route already knows it. Repeated lines of one product are summed here. */
export type StockSaleLine = {
  productId: number
  branchId: number
  /** Units this line takes. */
  quantity: number
  /** The branch's quantity before the sale (the availability read). */
  before: number
  name: string
  /** products.low_stock_threshold / out_of_stock_threshold, as read. */
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

export function detectCrossings(lines: readonly StockSaleLine[], config: LowStockConfig): StockCrossing[] {
  const merged = new Map<string, StockSaleLine>()
  for (const line of lines) {
    const quantity = finite(line.quantity, 0)
    if (!(quantity > 0) || !Number.isSafeInteger(line.productId) || !Number.isSafeInteger(line.branchId)) continue
    const key = `${line.branchId}:${line.productId}`
    const seen = merged.get(key)
    if (seen) seen.quantity += quantity
    else merged.set(key, { ...line, quantity })
  }
  const crossings: StockCrossing[] = []
  for (const line of merged.values()) {
    const before = finite(line.before, 0)
    const after = Math.max(0, before - line.quantity)
    const tier = classifyCrossing(before, after, effectiveLowStockThreshold(config, line.lowThreshold), finite(line.outThreshold, 0))
    if (tier) crossings.push({ tier, productId: line.productId, branchId: line.branchId, name: line.name, before, after })
  }
  return crossings
}

/** The Telegram event for one crossing: three short lines under a heading; telegramLang makes it Khmer and English. */
export function formatCrossingMessage(crossing: StockCrossing, branchName: string | null | undefined): { heading: string; lines: string[] } {
  return {
    heading: crossing.tier === 'out' ? OUT_OF_STOCK_ALERT_HEADING : LOW_STOCK_ALERT_HEADING,
    lines: [
      `Product: ${crossing.name}`,
      branchName ? `Branch: ${branchName}` : '',
      `On hand: ${crossing.after}`,
    ],
  }
}

/** Unique per product, branch, tier and restock epoch (see the 0272 header). */
export const crossingAlertKey = (tier: CrossingTier, branchId: number, productId: number, epoch: number): string =>
  `stock-crossing:${tier}:${branchId}:${productId}:${epoch}`

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
  saleId: number | null
  branchName?: string | null
  lines: readonly StockSaleLine[]
}
export type RecordCrossingsResult = { crossings: number; claimed: number; sent: number }

/**
 * Called once the sale has COMMITTED. Never throws: a sale must not fail because of an alert.
 * Records every new crossing and sends one Telegram message for each crossing this call claimed.
 */
export async function recordStockCrossings(env: Env, input: RecordCrossingsInput): Promise<RecordCrossingsResult> {
  const result: RecordCrossingsResult = { crossings: 0, claimed: 0, sent: 0 }
  try {
    const config = await loadLowStockConfig(env)
    const crossings = detectCrossings(input.lines, config)
    result.crossings = crossings.length
    if (!crossings.length || !(await stockCrossingTableAvailable(env))) return result
    const db = getDb(env)
    for (const crossing of crossings) {
      const movement = await db.prepare('SELECT COALESCE(MAX(id), 0) AS epoch FROM inventory_movements WHERE product_id = @productId AND branch_id = @branchId AND quantity > 0')
        .get<{ epoch: number }>({ productId: crossing.productId, branchId: crossing.branchId })
      const key = crossingAlertKey(crossing.tier, crossing.branchId, crossing.productId, Number(movement?.epoch || 0))
      const inserted = await db.prepare(`INSERT OR IGNORE INTO stock_crossing_alerts
        (alert_key, product_id, branch_id, tier, sale_id, quantity_before, quantity_after, created_at)
        VALUES (@key, @productId, @branchId, @tier, @saleId, @before, @after, @now)`).run({
        key, productId: crossing.productId, branchId: crossing.branchId, tier: crossing.tier,
        saleId: input.saleId, before: crossing.before, after: crossing.after, now: new Date().toISOString(),
      })
      if (!inserted.changes) continue
      result.claimed += 1
      let status: 'sent' | 'skipped' | 'failed' = 'skipped'
      let error: string | null = null
      try {
        const message = formatCrossingMessage(crossing, input.branchName)
        status = (await sendTelegramEvent(env, { type: 'stock_alert', heading: message.heading, lines: message.lines })) ? 'sent' : 'skipped'
      } catch (sendError) {
        status = 'failed'
        error = String((sendError as Error)?.message || sendError).slice(0, 300)
        console.error('[telegram] stock crossing alert could not be sent', error)
      }
      if (status === 'sent') result.sent += 1
      await db.prepare('UPDATE stock_crossing_alerts SET telegram_status = @status, telegram_error = @error WHERE alert_key = @key')
        .run({ key, status, error }).catch(() => undefined)
    }
    // The bell's inventory section is cached by the 'stock' version, which the sale bumped BEFORE this row existed.
    if (result.claimed) await bumpVersion(env, 'stock').catch(() => undefined)
  } catch (error) {
    console.error('[stock] crossing alerts could not be recorded', error)
  }
  return result
}
