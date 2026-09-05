// When a product counts as "low stock" -- ONE rule, read the same way by the
// Dashboard card, the Products/Inventory/Branches badges and filters, the POS
// grid, the notification bell, the Telegram bot and every export.
//
// Before this file the rule was re-typed at ~35 call sites as the literal 10
// (`COALESCE(p.low_stock_threshold, 10)` on the server, `|| 10` / `?? 10` on
// the client), with no way for the owner to change it and two surfaces that
// had already drifted to a fallback of 0. The owner asked (Sep 6 2026) for a
// low-quantity alert switch and a threshold amount in Settings, so the rule
// now lives in the settings table:
//
//   low_stock_alert_enabled   'true' | 'false'   (absent => true)
//   low_stock_threshold_mode  'product' | 'global' (absent => 'product')
//   low_stock_threshold_default  integer >= 0     (absent => 10)
//
// Precedence is explicit rather than implicit because the products column is
// `low_stock_threshold REAL DEFAULT 10` and every write path (product form,
// import, planner) stores a concrete number: a global that only replaced the
// NULL fallback would be inert on real data. So 'product' mode keeps today's
// behaviour exactly (per-product value wins; the global replaces the hardcoded
// 10 only where the row has none) and 'global' mode overrides every row --
// the same two-mode shape the storefront already ships as
// customer_portal_stock_threshold_mode (routes/portal.ts).
//
// Turning the alert OFF resolves the effective threshold to
// NO_LOW_STOCK_THRESHOLD (-1), which no quantity can be at or below, so every
// reader reports "not low" without a single call site having to branch on the
// switch. Out-of-stock is a separate tier and is deliberately unaffected.
//
// The Worker applies the identical rule in cloudflare/src/lib/lowStockSettings.ts.
// The block between the SHARED LOW-STOCK RULE markers below is byte-identical
// in both files and pinned by cloudflare/scripts/test-low-stock-settings-pure.cjs
// -- duplicated rather than imported because the Worker and the frontend are
// separate packages (cloudflare/tsconfig.json only includes "src"; there is no
// cross-package import path, same reasoning as receiptTextContrast/taxSettings).

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

export type StockTier = 'out_of_stock' | 'low_stock' | 'in_stock'

/** The three-way classification the badges/tones on every client surface use. */
export function resolveStockTier(
  config: LowStockConfig,
  quantity: unknown,
  productLowThreshold?: unknown,
  productOutThreshold?: unknown,
): StockTier {
  const qty = Number(quantity)
  const out = Number(productOutThreshold)
  if (!Number.isFinite(qty) || qty <= (Number.isFinite(out) ? out : 0)) return 'out_of_stock'
  return isLowStock(config, quantity, productLowThreshold, productOutThreshold) ? 'low_stock' : 'in_stock'
}
