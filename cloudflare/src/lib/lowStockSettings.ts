// When a product counts as "low stock" -- the Worker half of ONE rule.
//
// Twin of frontend/src/utils/lowStockSettings.ts: the block between the
// SHARED LOW-STOCK RULE markers below is byte-identical in both files and
// pinned by scripts/test-low-stock-settings-pure.cjs, so the till, the badges
// and the SQL that counts them can never disagree about what "low" means.
// Read that file's header for the settings keys, the precedence rule and why
// this is duplicated rather than imported (the Worker and the frontend are
// separate packages; cloudflare/tsconfig.json only includes "src").
import type { Env } from '../index'
import { getDb } from './db'

// >>> SHARED LOW-STOCK RULE >>>
export const LOW_STOCK_ALERT_ENABLED_KEY = 'low_stock_alert_enabled'
export const LOW_STOCK_THRESHOLD_MODE_KEY = 'low_stock_threshold_mode'
export const LOW_STOCK_THRESHOLD_KEY = 'low_stock_threshold_default'

/** The literal every call site used to carry, now only the unset default. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 10

/**
 * Sane cap for the owner-settable amount. Stock quantities are whole units in
 * this catalog, so the setting is an integer; the cap keeps a fat-fingered
 * paste from turning the whole catalog amber (and keeps the value safe to
 * inline into SQL, see lowStockThresholdSql in the Worker twin).
 */
export const MAX_LOW_STOCK_THRESHOLD = 1000000

/** No quantity can be <= this, so "alerts off" needs no branch at call sites. */
export const NO_LOW_STOCK_THRESHOLD = -1

export type LowStockThresholdMode = 'product' | 'global'

export interface LowStockConfig {
  enabled: boolean
  mode: LowStockThresholdMode
  threshold: number
}

/** What an install that has never touched the switch behaves like: today. */
export const DEFAULT_LOW_STOCK_CONFIG: LowStockConfig = {
  enabled: true,
  mode: 'product',
  threshold: DEFAULT_LOW_STOCK_THRESHOLD,
}

/**
 * The one validation rule, shared by the Settings form and the Worker's POST
 * /api/settings guard: a whole number from 0 to MAX_LOW_STOCK_THRESHOLD.
 * Returns null for anything else -- callers REJECT on null rather than
 * clamping, so a wrong number is never quietly turned into a plausible one.
 */
export function normalizeLowStockThreshold(raw: unknown): number | null {
  const text = String(raw ?? '').trim()
  if (!/^\d+$/.test(text)) return null
  const value = Number(text)
  if (!Number.isSafeInteger(value)) return null
  if (value > MAX_LOW_STOCK_THRESHOLD) return null
  return value
}

/**
 * Absent means ON: an install upgrading into this build keeps showing the
 * low-stock badges it showed yesterday. Values reach the settings table as
 * free text from more than one writer, so anything a shop would read as "no"
 * counts as off (same token set as taxSettings.ts).
 */
export function resolveLowStockAlertEnabled(raw: unknown): boolean {
  const text = String(raw ?? '').trim().toLowerCase()
  if (text === '') return true
  return !(text === '0' || text === 'false' || text === 'off' || text === 'no')
}

export function resolveLowStockThresholdMode(raw: unknown): LowStockThresholdMode {
  return String(raw ?? '').trim().toLowerCase() === 'global' ? 'global' : 'product'
}

/** Read the three keys out of any settings map (API map, offline snapshot). */
export function resolveLowStockConfig(settings?: Record<string, unknown> | null): LowStockConfig {
  const map = settings || {}
  return {
    enabled: resolveLowStockAlertEnabled(map[LOW_STOCK_ALERT_ENABLED_KEY]),
    mode: resolveLowStockThresholdMode(map[LOW_STOCK_THRESHOLD_MODE_KEY]),
    threshold: normalizeLowStockThreshold(map[LOW_STOCK_THRESHOLD_KEY]) ?? DEFAULT_LOW_STOCK_THRESHOLD,
  }
}

/**
 * The number a product's quantity is actually compared against. The
 * per-product column is REAL, so a fractional override is preserved as-is;
 * only the GLOBAL is constrained to a whole number.
 */
export function effectiveLowStockThreshold(config: LowStockConfig, productThreshold?: unknown): number {
  if (!config.enabled) return NO_LOW_STOCK_THRESHOLD
  const global = normalizeLowStockThreshold(config.threshold) ?? DEFAULT_LOW_STOCK_THRESHOLD
  if (config.mode === 'global') return global
  const text = String(productThreshold ?? '').trim()
  const own = text === '' ? Number.NaN : Number(text)
  return Number.isFinite(own) ? own : global
}

/**
 * "Low" is the middle tier: above the out-of-stock threshold, at or below the
 * low threshold. Kept identical to the `qty > out AND qty <= low` shape every
 * SQL filter uses, so a card and the list under it can never disagree.
 */
export function isLowStock(
  config: LowStockConfig,
  quantity: unknown,
  productLowThreshold?: unknown,
  productOutThreshold?: unknown,
): boolean {
  const qty = Number(quantity)
  if (!Number.isFinite(qty)) return false
  const out = Number(productOutThreshold)
  if (qty <= (Number.isFinite(out) ? out : 0)) return false
  return qty <= effectiveLowStockThreshold(config, productLowThreshold)
}
// <<< SHARED LOW-STOCK RULE <<<

export const LOW_STOCK_SETTING_KEYS = [
  LOW_STOCK_ALERT_ENABLED_KEY,
  LOW_STOCK_THRESHOLD_MODE_KEY,
  LOW_STOCK_THRESHOLD_KEY,
]

/**
 * The three settings rows, read once per request by every route that counts,
 * lists or filters low stock. Same `key IN (...)` shape as
 * routes/notifications.ts's loadPreferences.
 */
export async function loadLowStockConfig(env: Env): Promise<LowStockConfig> {
  const db = getDb(env)
  const placeholders = LOW_STOCK_SETTING_KEYS.map(() => '?').join(',')
  const rows = await db.prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`)
    .all<{ key: string; value: string }>(LOW_STOCK_SETTING_KEYS)
  const map: Record<string, unknown> = {}
  for (const row of rows || []) map[row.key] = row.value
  return resolveLowStockConfig(map)
}

/**
 * SQL for the effective low threshold of the row named by `column` (e.g.
 * 'p.low_stock_threshold'). The number is inlined rather than bound because
 * these fragments are composed into CTEs and filter clauses whose binding
 * style differs per route (named `@param` in familyStockStats, positional
 * elsewhere); it is safe to inline because normalizeLowStockThreshold has
 * already proven it is a whole number in [0, MAX_LOW_STOCK_THRESHOLD], and
 * anything else falls back to the constant default.
 *
 * Alerts off yields the bare NO_LOW_STOCK_THRESHOLD, so `qty <= low` matches
 * no row and `qty > low` matches every row -- the low tier disappears without
 * any route having to grow a branch.
 */
export function lowStockThresholdSql(config: LowStockConfig, column: string): string {
  if (!config.enabled) return String(NO_LOW_STOCK_THRESHOLD)
  const global = normalizeLowStockThreshold(config.threshold) ?? DEFAULT_LOW_STOCK_THRESHOLD
  if (config.mode === 'global') return String(global)
  return `COALESCE(${column}, ${global})`
}
