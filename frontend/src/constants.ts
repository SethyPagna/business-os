export const STORAGE_KEYS = {
  SYNC_SERVER: 'businessos_sync_server',
  SYNC_TOKEN: 'businessos_sync_token',
  PUBLIC_ASSET_BASE_URL: 'businessos_public_asset_base_url',
  USER: 'businessos_user',
  ORGANIZATION: 'businessos_organization',
  USER_EXPIRY: 'businessos_user_expiry',
  SERVER_START_TIME: 'businessos_server_start_time',
  SESSION_DURATION: 'businessos_session_duration',
  DEVICE_SETTINGS: 'businessos_device_settings',
  CLIENT_RUNTIME: 'businessos_client_runtime',
  OAUTH_LOGIN_PENDING: 'businessos_oauth_login_pending',
  OAUTH_LINK_PENDING: 'businessos_oauth_link_pending',
  OAUTH_CALLBACK_RESULT: 'businessos_oauth_callback_result',
  // The persisted device-approval identifier (utils/deviceInfo.ts's
  // getOrCreatePersistentDeviceId()) -- was a raw literal key that lived
  // outside this map entirely, which meant nothing that clears
  // `businessos_`-prefixed storage keys on logout (see
  // platform/runtime/clientRuntime.ts's resetClientRuntimeState) knew it
  // needed to be kept. Every logout silently deleted it, so the very next
  // login generated a brand-new device id and the device-approval feature
  // treated the same physical device as unrecognized again, forcing the
  // whole pending-approval flow to repeat. Now tracked here so it can be
  // added to the preserve list explicitly.
  DEVICE_ID: 'businessos_device_id',
} as const

const DEFAULT_EXCHANGE_RATE = 4100
export const BUSINESS_TIME_ZONE = 'Asia/Phnom_Penh'

export const CURRENCY = {
  DEFAULT_EXCHANGE_RATE,
  USD_SYMBOL: '$',
  KHR_SYMBOL: '៛',
  usdToKhr: (usd: unknown, rate = DEFAULT_EXCHANGE_RATE): number => Math.round((Number(usd) || 0) * rate),
  khrToUsd: (khr: unknown, rate = DEFAULT_EXCHANGE_RATE): number => Number(((Number(khr) || 0) / rate).toFixed(4)),
} as const

export const PAYMENT_METHODS = [
  'Cash',
  'Card',
  'ABA Bank',
  'Wing',
  'KHQR',
] as const

export const DELIVERY_FEE_PAYER = {
  CUSTOMER: 'customer',
  STORE: 'store',
} as const

export const STOCK = {
  DEFAULT_LOW_THRESHOLD: 10,
  DEFAULT_OUT_OF_STOCK_THRESHOLD: 0,
} as const

export const SYNC = {
  REQUEST_TIMEOUT_MS: 12_000,
  READ_LOCAL_FALLBACK_MS: 350,
  READ_SERVER_RETRY_DELAY_MS: 450,
  WS_RECONNECT_DELAY_MS: 5_000,
  EVENT_DEBOUNCE_MS: 150,
} as const

export const WRITE_CHANNELS = new Set([
  'products:create',
  'products:update',
  'products:delete',
  'products:adjustStock',
  'products:bulkImport',
  'categories:create',
  'categories:update',
  'categories:delete',
  'units:create',
  'units:update',
  'units:delete',
  'branches:create',
  'branches:update',
  'branches:delete',
  'branches:transfer',
  'sales:create',
  'users:create',
  'users:update',
  'users:resetPassword',
  'roles:create',
  'roles:update',
  'roles:delete',
  'customers:create',
  'customers:update',
  'customers:delete',
  'customers:bulkImport',
  'suppliers:create',
  'suppliers:update',
  'suppliers:delete',
  'suppliers:bulkImport',
  'deliveryContacts:create',
  'deliveryContacts:update',
  'deliveryContacts:delete',
  'settings:set',
  'data:reset',
  'data:factoryReset',
] as const)

export const LAYOUT = {
  POS_BREAKPOINT: 'md',
  AUTOCOMPLETE_MAX_RESULTS: 6,
  MAX_CONCURRENT_ORDERS: 6,
} as const

export const EMPTY_CUSTOMER = Object.freeze({ name: '', phone: '', address: '' })

export type PosOrder = {
  id: string
  label: string
  checkoutRequestId: string
  cart: unknown[]
  customer: typeof EMPTY_CUSTOMER
  customerSearch: string
  isDelivery: boolean
  deliverySearch: string
  selectedDelivery: unknown | null
  deliveryFeeUsd: string
  // P6: what the courier is actually paid for this delivery -- staff-only
  // (stored on the sale, shown in stats/detail, never on receipts).
  deliveryActualCostUsd: string
  deliveryFeePaidBy: typeof DELIVERY_FEE_PAYER.CUSTOMER
  discountUsd: string
  discountKhr: string
  // See POS.tsx's local PosOrder shadow type for why these exist: they
  // back the percent-of-subtotal discount mode alongside the fixed
  // USD/KHR fields above. discountType defaults to 'fixed' below so
  // existing orders that never touch this behave exactly as before.
  discountType: 'fixed' | 'percent'
  discountPercent: string
  membershipDiscountUsd: string
  membershipDiscountKhr: string
  membershipRedeemUnits: string
  paymentMethod: typeof PAYMENT_METHODS[number]
  customPayment: boolean
  paidUsd: string
  paidKhr: string
  // Y12: the ACTUAL change handed back, per currency. Change is often given
  // in a different currency than the payment (e.g. owe $3, give 12,000 KHR),
  // so these are editable and additive (USD + KHR are separate amounts, not
  // a dual representation of one). Empty = fall back to the computed change.
  changeGivenUsd: string
  changeGivenKhr: string
}

export function createEmptyOrder(number: number): PosOrder {
  return {
    id: `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label: `Order ${number}`,
    checkoutRequestId: '',
    cart: [],
    customer: { ...EMPTY_CUSTOMER },
    customerSearch: '',
    isDelivery: false,
    deliverySearch: '',
    selectedDelivery: null,
    deliveryFeeUsd: '',
    deliveryActualCostUsd: '',
    deliveryFeePaidBy: DELIVERY_FEE_PAYER.CUSTOMER,
    discountUsd: '',
    discountKhr: '',
    discountType: 'fixed',
    discountPercent: '',
    membershipDiscountUsd: '',
    membershipDiscountKhr: '',
    membershipRedeemUnits: '',
    paymentMethod: PAYMENT_METHODS[0],
    customPayment: false,
    paidUsd: '',
    paidKhr: '',
    changeGivenUsd: '',
    changeGivenKhr: '',
  }
}

export function formatDate(dateStr: unknown): string {
  if (!dateStr) return '—'
  const raw = String(dateStr)
  try {
    const iso = raw.includes('T') ? raw : `${raw}Z`
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: BUSINESS_TIME_ZONE,
    })
  } catch {
    return raw
  }
}

const NETWORK_ERROR_SUBSTRINGS = [
  'Failed to fetch',
  'Load failed',
  'NetworkError',
  'ERR_CONNECTION_REFUSED',
  'ERR_NAME_NOT_RESOLVED',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'connect ENOENT',
  'fetch failed',
  'Request timed out',
] as const

export function isNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String((err as { message?: unknown } | null)?.message || '')
  return NETWORK_ERROR_SUBSTRINGS.some((substring) => msg.includes(substring))
}
