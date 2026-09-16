// The one low-stock rule (frontend/src/utils/lowStockSettings.ts).
//
// Every case below is DISCRIMINATING against the behaviour this replaced --
// the hardcoded literal 10 that used to be re-typed at every call site. A
// product carrying its own stored 10 with a quantity of 5 was unconditionally
// "low"; here it is low, healthy or ignored depending on the owner's switch,
// so an implementation that still answered `qty <= (product.low || 10)` fails
// the mode and enabled cases outright.
import assert from 'node:assert/strict'

import {
  DEFAULT_LOW_STOCK_CONFIG,
  DEFAULT_LOW_STOCK_THRESHOLD,
  LOW_STOCK_ALERT_ENABLED_KEY,
  LOW_STOCK_THRESHOLD_KEY,
  LOW_STOCK_THRESHOLD_MODE_KEY,
  MAX_LOW_STOCK_THRESHOLD,
  NO_LOW_STOCK_THRESHOLD,
  effectiveLowStockThreshold,
  isLowStock,
  normalizeLowStockThreshold,
  resolveLowStockAlertEnabled,
  resolveLowStockConfig,
  resolveLowStockThresholdMode,
  resolveStockTier,
  validateLowStockSettingsWrite,
} from '../src/utils/lowStockSettings.ts'

// -- the validation rule shared with the Worker's POST /api/settings guard --
assert.equal(normalizeLowStockThreshold('0'), 0)
assert.equal(normalizeLowStockThreshold('7'), 7)
assert.equal(normalizeLowStockThreshold(7), 7)
assert.equal(normalizeLowStockThreshold(' 12 '), 12)
assert.equal(normalizeLowStockThreshold(String(MAX_LOW_STOCK_THRESHOLD)), MAX_LOW_STOCK_THRESHOLD)
// Rejected, never clamped: a wrong number must not be turned into a plausible one.
assert.equal(normalizeLowStockThreshold(''), null)
assert.equal(normalizeLowStockThreshold(null), null)
assert.equal(normalizeLowStockThreshold('-1'), null)
assert.equal(normalizeLowStockThreshold(-1), null)
assert.equal(normalizeLowStockThreshold('2.5'), null)
assert.equal(normalizeLowStockThreshold(2.5), null)
assert.equal(normalizeLowStockThreshold('abc'), null)
assert.equal(normalizeLowStockThreshold('1e3'), null)
assert.equal(normalizeLowStockThreshold(MAX_LOW_STOCK_THRESHOLD + 1), null)
assert.equal(normalizeLowStockThreshold(Number.NaN), null)
assert.equal(normalizeLowStockThreshold(Infinity), null)

// -- an install that has never touched the switch behaves exactly like before --
assert.deepEqual(resolveLowStockConfig({}), DEFAULT_LOW_STOCK_CONFIG)
assert.deepEqual(resolveLowStockConfig(null), DEFAULT_LOW_STOCK_CONFIG)
assert.equal(DEFAULT_LOW_STOCK_THRESHOLD, 10)
assert.equal(effectiveLowStockThreshold(DEFAULT_LOW_STOCK_CONFIG, null), 10)
assert.equal(effectiveLowStockThreshold(DEFAULT_LOW_STOCK_CONFIG, 4), 4)

// -- the switch: absent is ON, and only "no"-shaped text turns it off --
assert.equal(resolveLowStockAlertEnabled(undefined), true)
assert.equal(resolveLowStockAlertEnabled(''), true)
assert.equal(resolveLowStockAlertEnabled('true'), true)
assert.equal(resolveLowStockAlertEnabled('1'), true)
assert.equal(resolveLowStockAlertEnabled('false'), false)
assert.equal(resolveLowStockAlertEnabled('FALSE'), false)
assert.equal(resolveLowStockAlertEnabled('0'), false)
assert.equal(resolveLowStockAlertEnabled('off'), false)
assert.equal(resolveLowStockAlertEnabled('no'), false)

assert.equal(resolveLowStockThresholdMode(undefined), 'product')
assert.equal(resolveLowStockThresholdMode('product'), 'product')
assert.equal(resolveLowStockThresholdMode('Global'), 'global')
assert.equal(resolveLowStockThresholdMode('anything else'), 'product')

assert.deepEqual(
  resolveLowStockConfig({
    [LOW_STOCK_ALERT_ENABLED_KEY]: 'false',
    [LOW_STOCK_THRESHOLD_MODE_KEY]: 'global',
    [LOW_STOCK_THRESHOLD_KEY]: '3',
  }),
  { enabled: false, mode: 'global', threshold: 3 },
)
// A stored value that fails validation falls back to the constant default
// rather than poisoning every reader with NaN.
assert.deepEqual(
  resolveLowStockConfig({ [LOW_STOCK_THRESHOLD_KEY]: 'oops' }),
  DEFAULT_LOW_STOCK_CONFIG,
)

// -- precedence: the case the whole feature turns on ------------------------
// A product carrying the schema's own DEFAULT 10 with 5 in stock. The old
// hardcoded rule had exactly one answer for this row (low). The three answers
// below are what makes the setting non-inert on existing data.
const storedTen = { stock_quantity: 5, low_stock_threshold: 10, out_of_stock_threshold: 0 }
const productMode = { enabled: true, mode: 'product' as const, threshold: 3 }
const globalMode = { enabled: true, mode: 'global' as const, threshold: 3 }
const alertsOff = { enabled: false, mode: 'product' as const, threshold: 10 }

assert.equal(effectiveLowStockThreshold(productMode, storedTen.low_stock_threshold), 10)
assert.equal(effectiveLowStockThreshold(globalMode, storedTen.low_stock_threshold), 3)
assert.equal(effectiveLowStockThreshold(alertsOff, storedTen.low_stock_threshold), NO_LOW_STOCK_THRESHOLD)

assert.equal(isLowStock(productMode, 5, 10, 0), true)
assert.equal(isLowStock(globalMode, 5, 10, 0), false)
assert.equal(isLowStock(alertsOff, 5, 10, 0), false)

// In product mode the global replaces the old hardcoded 10 wherever the row
// has no threshold of its own -- the only place a NULL-fallback-only design
// would ever have applied.
assert.equal(effectiveLowStockThreshold(productMode, null), 3)
assert.equal(effectiveLowStockThreshold(productMode, ''), 3)
assert.equal(effectiveLowStockThreshold(productMode, 'not a number'), 3)
// A fractional per-product override is preserved: only the GLOBAL is an integer.
assert.equal(effectiveLowStockThreshold(productMode, 7.5), 7.5)
assert.equal(isLowStock(productMode, 7, 7.5, 0), true)
assert.equal(isLowStock(productMode, 8, 7.5, 0), false)

// -- tiers: out-of-stock is a separate concern and survives the switch ------
assert.equal(resolveStockTier(productMode, 0, 10, 0), 'out_of_stock')
assert.equal(resolveStockTier(productMode, 5, 10, 0), 'low_stock')
assert.equal(resolveStockTier(productMode, 50, 10, 0), 'in_stock')
assert.equal(resolveStockTier(globalMode, 5, 10, 0), 'in_stock')
// Alerts off collapses the LOW tier into in_stock; it does not hide OUT.
assert.equal(resolveStockTier(alertsOff, 5, 10, 0), 'in_stock')
assert.equal(resolveStockTier(alertsOff, 0, 10, 0), 'out_of_stock')
assert.equal(resolveStockTier(alertsOff, -3, 10, 0), 'out_of_stock')
// A row whose out-of-stock threshold sits above the low one stays out, never low.
assert.equal(resolveStockTier(productMode, 4, 3, 6), 'out_of_stock')
assert.equal(isLowStock(productMode, 4, 3, 6), false)
// Missing/garbage quantity is not an alert.
assert.equal(isLowStock(productMode, null, 10, 0), false)
assert.equal(isLowStock(productMode, 'abc', 10, 0), false)

// -- the write guard: the SAME function the Worker's POST /api/settings runs --
// (cloudflare/src/lib/lowStockSettings.ts, byte-identical shared block; the
// Worker side of this is pinned by cloudflare/scripts/test-low-stock-settings-pure.cjs)
assert.equal(validateLowStockSettingsWrite({ theme: 'dark' }), null)
assert.equal(validateLowStockSettingsWrite(null), null)
assert.equal(validateLowStockSettingsWrite({
  [LOW_STOCK_ALERT_ENABLED_KEY]: 'false',
  [LOW_STOCK_THRESHOLD_MODE_KEY]: 'product',
  [LOW_STOCK_THRESHOLD_KEY]: '25',
}), null)
assert.equal(validateLowStockSettingsWrite({ [LOW_STOCK_ALERT_ENABLED_KEY]: 'maybe' }), 'invalid_low_stock_alert_enabled')
assert.equal(validateLowStockSettingsWrite({ [LOW_STOCK_THRESHOLD_MODE_KEY]: 'both' }), 'invalid_low_stock_threshold_mode')
assert.equal(validateLowStockSettingsWrite({ [LOW_STOCK_THRESHOLD_KEY]: '-4' }), 'invalid_low_stock_threshold')
assert.equal(validateLowStockSettingsWrite({ [LOW_STOCK_THRESHOLD_KEY]: '2.5' }), 'invalid_low_stock_threshold')
assert.equal(validateLowStockSettingsWrite({ [LOW_STOCK_THRESHOLD_KEY]: '' }), 'invalid_low_stock_threshold')

console.log('lowStockSettings.test.ts OK')
