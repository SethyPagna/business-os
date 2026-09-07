import type { ActorLike } from './actorSnapshot'
import { actorId, actorSnapshot } from './actorSnapshot'

export const SALE_CREATION_SNAPSHOT_VERSION = 1 as const
export const MAX_SALE_CREATION_SNAPSHOT_LINES = 200
export const MAX_SALE_CREATION_SNAPSHOT_BYTES = 256 * 1024

export type SaleCreationOrigin = 'pos' | 'offline_replay' | 'sales_import' | 'stock_action_import' | 'return_replacement'

const SALE_CREATION_ORIGINS = new Set<SaleCreationOrigin>([
  'pos',
  'offline_replay',
  'sales_import',
  'stock_action_import',
  'return_replacement',
])

export interface SaleCreationLineInput {
  product_id?: unknown
  product_name?: unknown
  name?: unknown
  sku?: unknown
  quantity?: unknown
  applied_price_usd?: unknown
  unitPriceUsd?: unknown
  total_usd?: unknown
  lineTotalUsd?: unknown
}

export interface SaleCreationSnapshotInput {
  origin: SaleCreationOrigin
  recordedAt: string
  saleAt?: unknown
  receiptNumber?: unknown
  actor: ActorLike
  cashierId?: unknown
  cashierName?: unknown
  saleStatus?: unknown
  items: SaleCreationLineInput[]
  totalUsd?: unknown
  paymentMethod?: unknown
  paymentDetails?: unknown
  amountPaidUsd?: unknown
  amountPaidKhr?: unknown
  changeUsd?: unknown
  changeKhr?: unknown
  isDelivery?: unknown
  deliveryContactName?: unknown
  deliveryContactPhone?: unknown
  deliveryFeeUsd?: unknown
  deliveryActualCostUsd?: unknown
}

export interface SaleCreationSnapshotV1 {
  version: typeof SALE_CREATION_SNAPSHOT_VERSION
  origin: SaleCreationOrigin
  recorded_at: string
  sale_at: string | null
  receipt_number: string | null
  actor: { id: number | null; username: string | null }
  cashier: { id: number | null; username: string | null }
  sale_status: string | null
  products: Array<{
    product_id: number | null
    product: string | null
    sku: string | null
    quantity: number | null
    unit_price_usd: number | null
    line_total_usd: number | null
  }>
  total_usd: number | null
  payment_method: string | null
  payment_details: unknown[] | null
  amount_paid_usd: number | null
  amount_paid_khr: number | null
  change_usd: number | null
  change_khr: number | null
  delivery: {
    is_delivery: boolean
    driver_name: string | null
    driver_phone: string | null
    delivery_fee_usd: number | null
    delivery_actual_cost_usd: number | null
  }
}

export class SaleCreationSnapshotError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SaleCreationSnapshotError'
  }
}

function text(value: unknown): string | null {
  if (value == null) return null
  const clean = String(value).trim()
  return clean || null
}

function id(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function finite(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function paymentDetails(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const row = entry as Record<string, unknown>
    return [{
      method: text(row.method),
      amount_usd: finite(row.amount_usd),
      amount_khr: finite(row.amount_khr),
    }]
  })
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? paymentDetails(parsed) : null
  } catch (_) {
    return null
  }
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export function buildSaleCreationSnapshot(input: SaleCreationSnapshotInput): string {
  if (!SALE_CREATION_ORIGINS.has(input.origin)) {
    throw new SaleCreationSnapshotError('Sale creation snapshot origin is invalid.')
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new SaleCreationSnapshotError('Sale creation snapshot requires at least one product line.')
  }
  if (input.items.length > MAX_SALE_CREATION_SNAPSHOT_LINES) {
    throw new SaleCreationSnapshotError(`Sale exceeds the ${MAX_SALE_CREATION_SNAPSHOT_LINES}-line creation-history limit.`)
  }
  const recordedAt = text(input.recordedAt)
  if (!recordedAt || !Number.isFinite(Date.parse(recordedAt))) {
    throw new SaleCreationSnapshotError('Sale creation snapshot recorded_at is invalid.')
  }
  const saleAt = text(input.saleAt)
  if (saleAt && !Number.isFinite(Date.parse(saleAt))) {
    throw new SaleCreationSnapshotError('Sale creation snapshot sale_at is invalid.')
  }
  const snapshot: SaleCreationSnapshotV1 = {
    version: SALE_CREATION_SNAPSHOT_VERSION,
    origin: input.origin,
    recorded_at: recordedAt,
    sale_at: saleAt,
    receipt_number: text(input.receiptNumber),
    actor: { id: actorId(input.actor), username: actorSnapshot(input.actor) },
    cashier: { id: id(input.cashierId), username: text(input.cashierName) },
    sale_status: text(input.saleStatus),
    products: input.items.map((item) => ({
      product_id: id(item.product_id),
      product: text(item.product_name ?? item.name),
      sku: text(item.sku),
      quantity: finite(item.quantity),
      unit_price_usd: finite(item.applied_price_usd ?? item.unitPriceUsd),
      line_total_usd: finite(item.total_usd ?? item.lineTotalUsd),
    })),
    total_usd: finite(input.totalUsd),
    payment_method: text(input.paymentMethod),
    payment_details: paymentDetails(input.paymentDetails),
    amount_paid_usd: finite(input.amountPaidUsd),
    amount_paid_khr: finite(input.amountPaidKhr),
    change_usd: finite(input.changeUsd),
    change_khr: finite(input.changeKhr),
    delivery: {
      is_delivery: input.isDelivery === true || Number(input.isDelivery) === 1,
      driver_name: text(input.deliveryContactName),
      driver_phone: text(input.deliveryContactPhone),
      delivery_fee_usd: finite(input.deliveryFeeUsd),
      delivery_actual_cost_usd: finite(input.deliveryActualCostUsd),
    },
  }
  const serialized = JSON.stringify(snapshot)
  if (utf8Bytes(serialized) > MAX_SALE_CREATION_SNAPSHOT_BYTES) {
    throw new SaleCreationSnapshotError('Sale creation snapshot exceeds the storage safety limit.')
  }
  return serialized
}

export function parseSaleCreationSnapshot(value: unknown): SaleCreationSnapshotV1 | null {
  let parsed: unknown = value
  if (typeof value === 'string') {
    if (utf8Bytes(value) > MAX_SALE_CREATION_SNAPSHOT_BYTES) return null
    try { parsed = JSON.parse(value) } catch (_) { return null }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const candidate = parsed as Partial<SaleCreationSnapshotV1>
  if (candidate.version !== SALE_CREATION_SNAPSHOT_VERSION) return null
  if (!SALE_CREATION_ORIGINS.has(candidate.origin as SaleCreationOrigin)) return null
  if (!Array.isArray(candidate.products) || candidate.products.length === 0
    || candidate.products.length > MAX_SALE_CREATION_SNAPSHOT_LINES
    || candidate.products.some((line) => !line || typeof line !== 'object' || Array.isArray(line))) return null
  if (!candidate.actor || typeof candidate.actor !== 'object' || Array.isArray(candidate.actor)) return null
  if (!candidate.cashier || typeof candidate.cashier !== 'object' || Array.isArray(candidate.cashier)) return null
  if (!candidate.delivery || typeof candidate.delivery !== 'object' || Array.isArray(candidate.delivery)) return null
  if (candidate.payment_details !== null && !Array.isArray(candidate.payment_details)) return null
  if (!text(candidate.recorded_at) || !Number.isFinite(Date.parse(String(candidate.recorded_at)))) return null
  return candidate as SaleCreationSnapshotV1
}
