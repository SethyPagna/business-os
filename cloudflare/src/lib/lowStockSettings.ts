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

export const LOW_STOCK_SETTING_KEYS = [
  LOW_STOCK_ALERT_ENABLED_KEY,
  LOW_STOCK_THRESHOLD_MODE_KEY,
  LOW_STOCK_THRESHOLD_KEY,
]

/** The three settings rows, straight from D1. Same `key IN (...)` shape as routes/notifications.ts's loadPreferences. */
async function readLowStockConfigFromDb(env: Env): Promise<LowStockConfig> {
  const db = getDb(env)
  // sql-bound-params: bounded by construction -- this fixed three-key enum is
  // the whole list; it cannot grow with data, so there is nothing to chunk.
  const placeholders = LOW_STOCK_SETTING_KEYS.map(() => '?').join(',')
  const rows = await db.prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`)
    .all<{ key: string; value: string }>(LOW_STOCK_SETTING_KEYS)
  const map: Record<string, unknown> = {}
  for (const row of rows || []) map[row.key] = row.value
  return resolveLowStockConfig(map)
}

// The config only changes when someone saves Settings, yet ~17 call sites
// (Dashboard, Inventory x4, product search, Telegram x3, Branches x3, the bell)
// each paid a D1 round trip for it on every request. It is memoised per
// isolate, keyed by the `settings` cache version every settings writer already
// bumps (lib/cache.ts bumpVersion):
//
//   * younger than FRESH_MS      -> served with no I/O at all (one request's
//                                   several readers, and bursts, cost nothing);
//   * older, same settings token -> still valid, one KV read re-confirms it;
//   * token changed, or older than MAX_AGE_MS, or the token cannot be read
//                                -> re-read from D1.
//
// MAX_AGE_MS is the backstop for a writer that does not bump the version
// (a backup restore, a manual D1 edit). The Settings POST also calls
// invalidateLowStockConfigMemo() so the isolate that served the save sees its
// own change at once instead of after FRESH_MS. With no CACHE binding there is
// nothing to validate against, so nothing is memoised.
export const LOW_STOCK_CONFIG_MEMO_FRESH_MS = 5_000
export const LOW_STOCK_CONFIG_MEMO_MAX_AGE_MS = 60_000

type LowStockMemoEntry = {
  config: LowStockConfig
  token: string
  /** When the config was read from D1 -- bounds how long a non-bumped write can hide. */
  readAt: number
  /** When the settings token was last confirmed -- bounds how often we look. */
  checkedAt: number
  generation: number
}
const lowStockMemo = new WeakMap<object, LowStockMemoEntry>()
const lowStockInflight = new WeakMap<object, { generation: number; promise: Promise<LowStockConfig> }>()
let lowStockMemoGeneration = 0

/** Forget every memoised config in this isolate. Call after writing the three keys. */
export function invalidateLowStockConfigMemo(): void {
  lowStockMemoGeneration += 1
}

// The KV key lib/cache.ts's bumpVersion('settings') writes (its CACHE_VERSION_KEY_PREFIX
// + namespace). Read directly rather than imported so this module keeps a single
// './db' dependency (the pure tests load it with only that stubbed);
// scripts/test-low-stock-config-memo-pure.cjs pins the two spellings together.
// A missing key (KV never bumped, or the namespace handed off to D1 under quota
// pressure) or a failed read yields null: nothing to validate against, so the
// caller reads D1 instead of trusting a memo it cannot confirm.
export const SETTINGS_VERSION_KV_KEY = 'v2:settings'

async function readSettingsToken(env: Env): Promise<string | null> {
  try {
    const value = await env.CACHE.get(SETTINGS_VERSION_KV_KEY)
    return value == null ? null : String(value)
  } catch {
    return null
  }
}

/**
 * The three settings rows for every route that counts, lists or filters low
 * stock -- memoised per isolate (see above), so most calls cost no D1 read.
 */
export async function loadLowStockConfig(env: Env): Promise<LowStockConfig> {
  if (!env || !(env as { CACHE?: unknown }).CACHE) return readLowStockConfigFromDb(env)
  const key = env as unknown as object
  const generation = lowStockMemoGeneration
  const memo = lowStockMemo.get(key)
  const usable = memo && memo.generation === generation ? memo : null

  if (usable) {
    const at = Date.now()
    const sinceCheck = at - usable.checkedAt
    const sinceRead = at - usable.readAt
    // Both clocks: a recent confirmation never stretches the backstop past MAX_AGE.
    if (sinceCheck >= 0 && sinceCheck < LOW_STOCK_CONFIG_MEMO_FRESH_MS && sinceRead >= 0 && sinceRead < LOW_STOCK_CONFIG_MEMO_MAX_AGE_MS) return usable.config
  }

  const pending = lowStockInflight.get(key)
  if (pending && pending.generation === generation) return pending.promise

  const promise = (async () => {
    const token = await readSettingsToken(env)
    const now = Date.now()
    if (usable && token !== null && usable.token === token && now - usable.readAt >= 0 && now - usable.readAt < LOW_STOCK_CONFIG_MEMO_MAX_AGE_MS) {
      if (generation === lowStockMemoGeneration) lowStockMemo.set(key, { ...usable, checkedAt: now })
      return usable.config
    }
    const config = await readLowStockConfigFromDb(env)
    // An invalidation that landed while this read was in flight must not be
    // overwritten by a result that may predate the write.
    if (token !== null && generation === lowStockMemoGeneration) {
      const stamped = Date.now()
      lowStockMemo.set(key, { config, token, readAt: stamped, checkedAt: stamped, generation })
    }
    return config
  })()
  lowStockInflight.set(key, { generation, promise })
  try {
    return await promise
  } finally {
    const current = lowStockInflight.get(key)
    if (current && current.promise === promise) lowStockInflight.delete(key)
  }
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
