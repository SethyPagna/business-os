/**
 * constants.js — Application-wide constants and configuration.
 *
 * Why this file exists:
 *   Magic values scattered across components make refactoring painful and bugs
 *   easy to introduce. Centralising them here means one change propagates
 *   everywhere, the intent is documented, and reviewers can see the full
 *   configuration surface in one place.
 *
 * Rules for adding to this file:
 *   - Only truly constant values belong here (never mutable state).
 *   - Group by domain; add a comment block for each group.
 *   - Prefer named exports over a single default object so tree-shaking works.
 */

// ─── Storage keys ─────────────────────────────────────────────────────────────
// Keys used in localStorage to persist user preferences across sessions.
export const STORAGE_KEYS = {
  SYNC_SERVER: 'businessos_sync_server',
  SYNC_TOKEN:  'businessos_sync_token',
  AUTH_TOKEN:  'businessos_auth_token',
  USER:        'businessos_user',
  ORGANIZATION: 'businessos_organization',
  USER_EXPIRY: 'businessos_user_expiry',
  SERVER_START_TIME: 'businessos_server_start_time',
  SESSION_DURATION: 'businessos_session_duration',
  DEVICE_SETTINGS: 'businessos_device_settings',
  CLIENT_RUNTIME: 'businessos_client_runtime',
  OAUTH_LOGIN_PENDING: 'businessos_oauth_login_pending',
  OAUTH_LINK_PENDING: 'businessos_oauth_link_pending',
}

// ─── Currency defaults ────────────────────────────────────────────────────────
export const CURRENCY = {
  DEFAULT_EXCHANGE_RATE: 4100,
  USD_SYMBOL: '$',
  KHR_SYMBOL: '៛',
  /** Round a USD amount to KHR using the given exchange rate. */
  usdToKhr: (usd, rate = 4100) => Math.round((usd || 0) * rate),
  /** Convert KHR to USD, keeping 4 decimal places for precision. */
  khrToUsd: (khr, rate = 4100) => +((khr || 0) / rate).toFixed(4),
}

// ─── POS payment methods ──────────────────────────────────────────────────────
// Shown as quick-select buttons on the checkout panel. 'Other' is always appended
// dynamically as a free-text fallback, so do not add it here.
export const PAYMENT_METHODS = [
  'Cash',
  'Card',
  'ABA Bank',
  'Wing',
  'KHQR',
  'Pi Pay',
  'Transfer',
]

// ─── Delivery fee payer options ───────────────────────────────────────────────
export const DELIVERY_FEE_PAYER = {
  CUSTOMER: 'customer',
  STORE:    'store',
}

// ─── Stock threshold defaults ─────────────────────────────────────────────────
export const STOCK = {
  DEFAULT_LOW_THRESHOLD:      10,
  DEFAULT_OUT_OF_STOCK_THRESHOLD: 0,
}

// ─── Sync / networking ────────────────────────────────────────────────────────
export const SYNC = {
  /** Milliseconds before a sync server HTTP request times out. */
  REQUEST_TIMEOUT_MS: 12_000,
  /** Serve IndexedDB/local fallback if a read is still waiting after this long. */
  READ_LOCAL_FALLBACK_MS: 350,
  /** Retry a failed read once after this short pause before falling back locally. */
  READ_SERVER_RETRY_DELAY_MS: 450,
  /** Milliseconds before the WebSocket attempts to reconnect after a drop. */
  WS_RECONNECT_DELAY_MS: 5_000,
  /** Debounce delay (ms) for batching rapid sync-push events in AppContext. */
  EVENT_DEBOUNCE_MS: 150,
}

// ─── API channel sets ─────────────────────────────────────────────────────────
// Used by both preload.js (Electron) and web-api.js (browser) to determine
// whether a failed call should surface an error or silently fall back to local.
export const WRITE_CHANNELS = new Set([
  'products:create',    'products:update',    'products:delete',
  'products:adjustStock', 'products:bulkImport',
  'categories:create',  'categories:update',  'categories:delete',
  'units:create',       'units:update',       'units:delete',
  'branches:create',    'branches:update',    'branches:delete',    'branches:transfer',
  'sales:create',
  'users:create',       'users:update',       'users:resetPassword',
  'roles:create',       'roles:update',       'roles:delete',
  'customers:create',   'customers:update',   'customers:delete',   'customers:bulkImport',
  'suppliers:create',   'suppliers:update',   'suppliers:delete',   'suppliers:bulkImport',
  'deliveryContacts:create', 'deliveryContacts:update', 'deliveryContacts:delete',
  'settings:set',       'data:reset',         'data:factoryReset',
  'customTables:create','customTables:insertRow','customTables:updateRow','customTables:deleteRow',
])

// ─── UI layout ────────────────────────────────────────────────────────────────
export const LAYOUT = {
  /** Tailwind breakpoint at which the POS switches from stacked to side-by-side. */
  POS_BREAKPOINT: 'md',
  /** Maximum number of customer/delivery autocomplete suggestions shown. */
  AUTOCOMPLETE_MAX_RESULTS: 6,
  /** Maximum simultaneous orders a cashier can hold open in POS. */
  MAX_CONCURRENT_ORDERS: 6,
}

// ─── POS empty-state factories ────────────────────────────────────────────────
// Centralised here so every "reset" in the codebase produces identical shape,
// preventing subtle bugs from missing fields after a schema change.

/** The customer sub-object that an order starts with (and resets to). */
export const EMPTY_CUSTOMER = Object.freeze({ name: '', phone: '', address: '' })

/**
 * Create a fresh order object.
 * @param {number} number   Display number shown in the tab label, e.g. 1 → "Order 1".
 * @returns {Object}        A new order with an id, label, and all cart/payment fields reset.
 *
 * NOTE: This intentionally returns a plain object — not a class instance — so it
 * can be spread-merged with `patchActive()` without any prototype surprises.
 */
export function createEmptyOrder(number) {
  return {
    id:                `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label:             `Order ${number}`,
    // Cart
    cart:              [],
    // Customer
    customer:          { ...EMPTY_CUSTOMER },
    customerSearch:    '',
    // Delivery
    isDelivery:        false,
    deliverySearch:    '',
    selectedDelivery:  null,
    deliveryFeeUsd:    '',
    deliveryFeePaidBy: 'customer',   // matches DELIVERY_FEE_PAYER.CUSTOMER
    // Financials
    discountUsd:       '',
    discountKhr:       '',
    membershipDiscountUsd: '',
    membershipDiscountKhr: '',
    membershipRedeemUnits: '',
    paymentMethod:     'Cash',        // matches PAYMENT_METHODS[0]
    customPayment:     false,
    paidUsd:           '',
    paidKhr:           '',
  }
}

// ─── Date formatting ──────────────────────────────────────────────────────────
/** Format a DB datetime string as a human-readable local date. */
export function formatDate(dateStr) {
  if (!dateStr) return '—'
  try {
    const iso = dateStr.includes('T') ? dateStr : dateStr + 'Z'
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    })
  } catch {
    return dateStr
  }
}

// ─── Network error detection ──────────────────────────────────────────────────
const NETWORK_ERROR_SUBSTRINGS = [
  'Failed to fetch', 'Load failed', 'NetworkError',
  'ERR_CONNECTION_REFUSED', 'ERR_NAME_NOT_RESOLVED',
  'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND',
  'connect ENOENT', 'fetch failed', 'Request timed out',
]

export function isNetworkError(err) {
  const msg = err?.message || ''
  return NETWORK_ERROR_SUBSTRINGS.some(s => msg.includes(s))
}
