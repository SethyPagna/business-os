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
export type LowStockSettingsWriteError =
  | 'invalid_low_stock_alert_enabled'
  | 'invalid_low_stock_threshold_mode'
  | 'invalid_low_stock_threshold'

/**
 * The write guard, shared by the Settings form and the Worker's
 * POST /api/settings so frontend validation and backend enforcement can never
 * disagree. Returns the first offending key's code, or null when the payload
 * (which normally carries the WHOLE settings form) is acceptable. Keys absent
 * from the payload are not this function's business.
 *
 * Rejects rather than clamps: a threshold quietly rounded or capped is how a
 * shop ends up colouring its catalog by a number nobody chose.
 */
export function validateLowStockSettingsWrite(
  body?: Record<string, unknown> | null,
): LowStockSettingsWriteError | null {
  const payload = body || {}
  if (Object.prototype.hasOwnProperty.call(payload, LOW_STOCK_ALERT_ENABLED_KEY)) {
    const text = String(payload[LOW_STOCK_ALERT_ENABLED_KEY] ?? '').trim().toLowerCase()
    const known = ['true', 'false', '1', '0', 'on', 'off', 'yes', 'no']
    if (known.indexOf(text) < 0) return 'invalid_low_stock_alert_enabled'
  }
  if (Object.prototype.hasOwnProperty.call(payload, LOW_STOCK_THRESHOLD_MODE_KEY)) {
    const text = String(payload[LOW_STOCK_THRESHOLD_MODE_KEY] ?? '').trim().toLowerCase()
    if (text !== 'product' && text !== 'global') return 'invalid_low_stock_threshold_mode'
  }
  if (Object.prototype.hasOwnProperty.call(payload, LOW_STOCK_THRESHOLD_KEY)) {
    if (normalizeLowStockThreshold(payload[LOW_STOCK_THRESHOLD_KEY]) === null) return 'invalid_low_stock_threshold'
  }
  return null
}
// <<< SHARED LOW-STOCK RULE <<<

/** The three states a stock figure can be in. The one vocabulary the pill, the tooltip and the tests share. */
export type StockLevel = 'out' | 'low' | 'healthy'

/** The product fields the rule reads. Rows carry them straight from `products`; NULL / undefined mean "no override". */
export interface StockLevelProduct {
  [field: string]: unknown
  low_stock_threshold?: unknown
  out_of_stock_threshold?: unknown
  is_group?: unknown
  parent_id?: unknown
}

/**
 * THE stock-state rule for one figure, identical to the server's for numeric values (text-typed or
 * non-finite stored values are not modelled; the columns are REAL):
 *   out     when COALESCE(qty, 0) <= COALESCE(out_of_stock_threshold, 0)
 *   low     when COALESCE(qty, 0) <= the effective low threshold (-1 when alerts are off,
 *           the global number in global mode, COALESCE(product threshold, global) in product mode)
 *   healthy otherwise
 * Sources: lowStockThresholdSql (cloudflare/src/lib/lowStockSettings.ts), familyStockStats.ts
 * has_healthy / has_low, notifications.ts is_out. A parity test runs that SQL in SQLite over a
 * matrix and requires the same answer from this function, so a bell, a Dashboard card and a
 * list can never call one product low and healthy.
 */
export function stockLevelState(
  qty: unknown,
  product: StockLevelProduct | null | undefined,
  config: LowStockConfig,
): StockLevel {
  const asNumber = qty == null || qty === '' ? 0 : Number(qty)
  const have = Number.isFinite(asNumber) ? asNumber : 0
  const outRaw = product?.out_of_stock_threshold
  const outNumber = outRaw == null || outRaw === '' ? Number.NaN : Number(outRaw)
  const out = Number.isFinite(outNumber) ? outNumber : 0
  if (have <= out) return 'out'
  if (have <= effectiveLowStockThreshold(config, product?.low_stock_threshold)) return 'low'
  return 'healthy'
}

/** A product-family header row: a group parent that holds no stock of its own. */
export function isStockFamilyHeader(product: StockLevelProduct | null | undefined): boolean {
  // The server's (COALESCE(is_group, 0) = 1 AND COALESCE(parent_id, 0) = 0), familyStockStats.ts: NULL reads as 0,
  // so a negative or fractional parent_id is NOT a header there and is not one here.
  const group = product?.is_group == null ? 0 : Number(product.is_group)
  const parent = product?.parent_id == null ? 0 : Number(product.parent_id)
  return group === 1 && parent === 0
}

/**
 * The family rule the Dashboard uses (familyStockStats.ts has_healthy / has_low): the BEST state
 * among the members wins -- any healthy member makes the family healthy, else any low member makes
 * it low, else out. Header rows are skipped while a real member exists, and count only when the
 * family has nothing else. An empty family is "out", the SQL's final ELSE.
 */
export function stockGroupLevel(
  members: ReadonlyArray<{ qty: unknown; product?: StockLevelProduct | null }>,
  config: LowStockConfig,
): StockLevel {
  const real = members.filter((member) => !isStockFamilyHeader(member.product))
  const counted = real.length ? real : members
  let best: StockLevel = 'out'
  for (const member of counted) {
    const level = stockLevelState(member.qty, member.product, config)
    if (level === 'healthy') return 'healthy'
    if (level === 'low') best = 'low'
  }
  return best
}

export type StockTier = 'out_of_stock' | 'low_stock' | 'in_stock'

/** The three-way classification the badges/tones on every client surface use. */
export function resolveStockTier(
  config: LowStockConfig,
  quantity: unknown,
  productLowThreshold?: unknown,
  productOutThreshold?: unknown,
): StockTier {
  const level = stockLevelState(quantity, { low_stock_threshold: productLowThreshold, out_of_stock_threshold: productOutThreshold }, config)
  return level === 'out' ? 'out_of_stock' : level === 'low' ? 'low_stock' : 'in_stock'
}
