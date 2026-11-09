// The shapes the storefront order API (cloudflare/src/routes/portalOrders.ts, publicOrderView in lib/onlineOrderStore.ts) answers with.
// Types only: nothing here runs, so the storefront's first paint never pays for it.

export type OrderStatus =
  | 'awaiting_payment' | 'qr_failed' | 'paid' | 'review' | 'expired' | 'cancelled'
  | 'completed' | 'balance_due' | 'delivery_pending' | 'sale_cancelled'

export type OrderFulfilment = 'pickup' | 'delivery'

/** The six optional ways to reach the buyer, in the order the form shows them. */
export const ORDER_CONTACT_FIELDS = ['telegram', 'instagram', 'facebook', 'tiktok', 'whatsapp', 'other'] as const
export type OrderContactField = (typeof ORDER_CONTACT_FIELDS)[number]
export type OrderContacts = Record<OrderContactField, string | null>

export type OrderItem = { product_id: number; name: string; quantity: number; unit_price_usd: number; line_total_usd: number }

export type OrderQr = { amount: number; currency: string; qr_string: string; deeplink: string | null; expires_at: string | null }
export type OrderTopUp = OrderQr & { request_id: number | null }

export type RequestKind = 'items' | 'fulfilment' | 'address' | 'contact' | 'note' | 'cancel' | 'return'
export type RequestStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'applied' | 'reversed'
export type OrderRequest = {
  id: number
  kind: RequestKind
  stage: string
  status: RequestStatus
  staff_reply: string | null
  comment: string | null
  attachments: string[]
  created_at: string
}

export type OrderMoney = { paid_usd: number; refunded_usd: number; refund_due_usd: number; balance_due_usd: number }

export type OrderView = {
  order_no: string
  status: OrderStatus
  phase: 'before_sale' | 'after_sale'
  chips: string[]
  fulfilment: OrderFulfilment
  name: string
  /** `*** 678`: the server never returns the number itself. */
  phone_hint: string
  address: string | null
  contacts: OrderContacts
  note: string | null
  items: OrderItem[]
  total_usd: number
  total_khr: number | null
  currency: string
  created_at: string
  paid_at: string | null
  payment: OrderQr | null
  top_ups: OrderTopUp[]
  requests: OrderRequest[]
  money: OrderMoney
  can_edit: boolean
  can_cancel: boolean
  requests_open: boolean
  request_kinds: RequestKind[]
  /** The owner's setting (default 7): the page quotes it, it is never a literal here. */
  request_window_days: number
}

/** What GET /:token/status answers: one order row, nothing else. */
export type OrderStatusPoll = { state: string; revision: number; paid_at: string | null; total_usd: number }

export type OrderApiFailure = {
  ok: false
  /** The server's `code`, or a client-side one: network, timeout, bad_response. */
  code: string
  status: number
  retryable: boolean
  /** Whatever else the refusal carried (out_of_stock items, product_ids). */
  extra: Record<string, unknown>
  /** Present when a refused create still made an order (the QR failed): the page opens it with "Try again". */
  token: string | null
  orderNo: string | null
}
/** skewMs: server clock minus this device's clock (from the Date header), or null when the response carried none. */
export type OrderApiSuccess<T> = { ok: true; data: T; skewMs: number | null }
export type OrderApiResult<T> = OrderApiSuccess<T> | OrderApiFailure
