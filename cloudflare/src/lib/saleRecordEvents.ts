import {
  SALE_RECORD_FIELDS,
  SALE_RECORD_KINDS,
  type SaleRecordChange,
  type SaleRecordField,
  type SaleRecordKind,
  type SaleRecordValueState,
} from './saleRecords'

export const SALE_RECORD_EVENT_LIMIT = 25
export const SALE_RECORD_EVENT_CHANGE_LIMIT = 12
export const SALE_RECORD_EVENT_CHANGE_BYTES = 65_536
export const SALE_RECORD_EVENTS_JSON_BYTES = 131_072
export const SALE_RECORD_COMBINED_SNAPSHOT_BYTES = 512_000

export const SALE_RECORD_SOURCE_KINDS = [
  'sale_status',
  'sale_customer',
  'sale_settlement',
  'sale_bulk_status',
  'sale_bulk_update',
  'return_create',
  'return_edit',
  'return_bulk',
] as const

export type SaleRecordSourceKind = (typeof SALE_RECORD_SOURCE_KINDS)[number]
export type SaleRecordEventVia = 'apply' | 'undo' | 'redo'
export type SaleRecordEventStatement = { sql: string; params: Record<string, unknown> }

export interface SaleRecordEventInput {
  saleId: number
  sourceKind: SaleRecordSourceKind
  sourceId: string
  generation: number
  kind: Exclude<SaleRecordKind, 'legacy_sale_change'>
  via: SaleRecordEventVia
  subject?: string | null
  actorId?: number | null
  actorUsername?: string | null
  occurredAt: string
  changes: SaleRecordChange[]
  requestDigest?: string | null
  response?: Record<string, unknown> | null
}

export class SaleRecordEventError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SaleRecordEventError'
  }
}

const FIELDS = new Set<string>(SALE_RECORD_FIELDS)
const SOURCE_KINDS = new Set<string>(SALE_RECORD_SOURCE_KINDS)
const KINDS = new Set<string>(SALE_RECORD_KINDS.filter((kind) => kind !== 'legacy_sale_change'))
const FIELDS_BY_KIND: Record<Exclude<SaleRecordKind, 'legacy_sale_change'>, readonly SaleRecordField[]> = {
  sale_created: ['receipt_number', 'sale_status', 'items', 'total_usd', 'payment', 'delivery', 'customer', 'membership'],
  driver_changed: ['driver'],
  delivery_cost_changed: ['actual_delivery_cost_usd'],
  delivery_fee_changed: ['delivery_fee_usd', 'total_usd'],
  delivery_added: ['is_delivery', 'driver', 'delivery_fee_usd', 'actual_delivery_cost_usd', 'total_usd'],
  item_added: ['item', 'quantity', 'total_usd'],
  item_removed: ['item', 'quantity', 'total_usd'],
  item_quantity_changed: ['item', 'quantity', 'total_usd'],
  item_price_changed: ['item', 'unit_price_usd', 'total_usd'],
  items_replaced: ['removed_items', 'added_items', 'total_usd'],
  customer_changed: ['customer', 'membership'],
  membership_changed: ['membership'],
  status_changed: ['sale_status'],
  payment_changed: ['payment_method', 'payment_details', 'amount_paid_usd', 'amount_paid_khr', 'change_usd', 'change_khr', 'sale_status'],
  payment_settled: ['payment_method', 'payment_details', 'amount_paid_usd', 'amount_paid_khr', 'change_usd', 'change_khr', 'sale_status'],
  cancelled: ['sale_status', 'cancel_reason', 'cancel_note'],
  sale_items_recovered: ['item_count', 'stock_effect'],
  sale_stock_corrected: ['held_units', 'stock_effect'],
}

const NUMERIC_FIELDS = new Set<SaleRecordField>([
  'total_usd', 'quantity', 'delivery_fee_usd', 'actual_delivery_cost_usd', 'held_units',
  'amount_paid_usd', 'amount_paid_khr', 'change_usd', 'change_khr',
])
const TEXT_FIELDS = new Set<SaleRecordField>([
  'receipt_number', 'sale_status', 'payment_method', 'cancel_reason', 'cancel_note',
])
const RESPONSE_KEYS = new Set(['success', 'id', 'saleId', 'returnId', 'sale_status', 'status', 'updated_at', 'duplicate', 'stock_skipped'])
const SOURCE_RULES: Record<SaleRecordSourceKind, {
  kinds: ReadonlySet<Exclude<SaleRecordKind, 'legacy_sale_change'>>
  replay: boolean
}> = {
  sale_status: { kinds: new Set(['status_changed', 'cancelled']), replay: false },
  sale_customer: { kinds: new Set(['customer_changed']), replay: false },
  sale_settlement: { kinds: new Set(['payment_changed', 'payment_settled']), replay: true },
  sale_bulk_status: { kinds: new Set(['status_changed', 'cancelled']), replay: true },
  sale_bulk_update: { kinds: new Set(['customer_changed', 'payment_changed', 'driver_changed']), replay: true },
  return_create: { kinds: new Set(['status_changed']), replay: false },
  return_edit: { kinds: new Set(['status_changed']), replay: false },
  return_bulk: { kinds: new Set(['status_changed']), replay: true },
}

function fail(message: string): never { throw new SaleRecordEventError(message) }
function bytes(value: string): number { return new TextEncoder().encode(value).byteLength }
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} has an unsupported shape.`)
  }
}
function nullableText(value: unknown, max: number, label: string): void {
  if (value === null) return
  if (typeof value !== 'string' || bytes(value) > max) fail(`${label} must be bounded text or null.`)
}
function nullableNumber(value: unknown, label: string): void {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) fail(`${label} must be a finite number or null.`)
}
function nullableId(value: unknown, label: string): void {
  if (value !== null && (!Number.isSafeInteger(value) || Number(value) <= 0)) fail(`${label} must be a positive integer or null.`)
}

function validateCustomer(value: unknown): void {
  if (!object(value)) fail('customer must be an object.')
  exactKeys(value, ['id', 'name'], 'customer')
  nullableId(value.id, 'customer.id')
  nullableText(value.name, 240, 'customer.name')
}

function validateMembership(value: unknown): void {
  if (!object(value)) fail('membership must be an object.')
  exactKeys(value, ['number', 'discount_usd', 'discount_khr', 'points_redeemed'], 'membership')
  nullableText(value.number, 120, 'membership.number')
  nullableNumber(value.discount_usd, 'membership.discount_usd')
  nullableNumber(value.discount_khr, 'membership.discount_khr')
  nullableNumber(value.points_redeemed, 'membership.points_redeemed')
}

function validateDriver(value: unknown): void {
  if (!object(value)) fail('driver must be an object.')
  exactKeys(value, ['id', 'name', 'phone', 'address'], 'driver')
  nullableId(value.id, 'driver.id')
  nullableText(value.name, 240, 'driver.name')
  nullableText(value.phone, 120, 'driver.phone')
  nullableText(value.address, 500, 'driver.address')
}

function validateItem(value: unknown): void {
  if (!object(value)) fail('item must be an object.')
  exactKeys(value, ['sale_item_id', 'product_id', 'name', 'sku', 'unit_price_usd', 'line_total_usd'], 'item')
  nullableId(value.sale_item_id, 'item.sale_item_id')
  nullableId(value.product_id, 'item.product_id')
  nullableText(value.name, 500, 'item.name')
  nullableText(value.sku, 240, 'item.sku')
  nullableNumber(value.unit_price_usd, 'item.unit_price_usd')
  nullableNumber(value.line_total_usd, 'item.line_total_usd')
}

function validatePaymentDetails(value: unknown): void {
  if (!Array.isArray(value) || value.length > 20) fail('payment_details must be a bounded array.')
  for (const entry of value) {
    if (!object(entry)) fail('payment_details entries must be objects.')
    exactKeys(entry, ['method', 'amount_usd', 'amount_khr'], 'payment_details entry')
    if (typeof entry.method !== 'string' || !entry.method.trim() || bytes(entry.method) > 120) fail('payment_details.method is invalid.')
    if (typeof entry.amount_usd !== 'number' || !Number.isFinite(entry.amount_usd)) fail('payment_details.amount_usd is invalid.')
    if (typeof entry.amount_khr !== 'number' || !Number.isFinite(entry.amount_khr)) fail('payment_details.amount_khr is invalid.')
  }
}

function validatePayment(value: unknown): void {
  if (!object(value)) fail('payment must be an object.')
  exactKeys(value, ['method', 'details', 'amount_paid_usd', 'amount_paid_khr', 'change_usd', 'change_khr'], 'payment')
  nullableText(value.method, 120, 'payment.method')
  if (value.details !== null) validatePaymentDetails(value.details)
  for (const key of ['amount_paid_usd', 'amount_paid_khr', 'change_usd', 'change_khr']) nullableNumber(value[key], `payment.${key}`)
}

function validateKnownValue(field: SaleRecordField, value: unknown): void {
  if (value === null || value === undefined) fail(`${field} must use known_none for an intentional absence.`)
  if (NUMERIC_FIELDS.has(field)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${field} must be a finite number.`)
    return
  }
  if (TEXT_FIELDS.has(field)) {
    if (typeof value !== 'string' || bytes(value) > (field === 'cancel_note' ? 2000 : 500)) fail(`${field} must be bounded text.`)
    return
  }
  if (field === 'is_delivery') {
    if (typeof value !== 'boolean') fail('is_delivery must be boolean.')
    return
  }
  if (field === 'customer') return validateCustomer(value)
  if (field === 'membership') return validateMembership(value)
  if (field === 'driver') return validateDriver(value)
  if (field === 'item') return validateItem(value)
  if (field === 'removed_items' || field === 'added_items' || field === 'items') {
    if (!Array.isArray(value) || value.length > 200) fail(`${field} must be a bounded item array.`)
    value.forEach(validateItem)
    return
  }
  if (field === 'payment_details') return validatePaymentDetails(value)
  if (field === 'payment') return validatePayment(value)
  if (field === 'delivery') {
    if (!object(value)) fail('delivery must be an object.')
    exactKeys(value, ['is_delivery', 'driver', 'delivery_fee_usd', 'actual_delivery_cost_usd'], 'delivery')
    if (value.is_delivery !== true) fail('delivery.is_delivery must be true.')
    if (value.driver !== null) validateDriver(value.driver)
    nullableNumber(value.delivery_fee_usd, 'delivery.delivery_fee_usd')
    nullableNumber(value.actual_delivery_cost_usd, 'delivery.actual_delivery_cost_usd')
    return
  }
  fail(`${field} has no value validator.`)
}

function validateState(field: SaleRecordField, value: unknown): asserts value is SaleRecordValueState {
  if (!object(value) || typeof value.state !== 'string') fail(`${field} state is invalid.`)
  if (value.state === 'known_value') {
    exactKeys(value, ['state', 'value'], `${field} known_value`)
    validateKnownValue(field, value.value)
    return
  }
  if (value.state === 'known_none' || value.state === 'unknown') {
    exactKeys(value, ['state'], `${field} ${value.state}`)
    return
  }
  fail(`${field} state is unknown.`)
}

function validateChanges(kind: Exclude<SaleRecordKind, 'legacy_sale_change'>, changes: SaleRecordChange[]): string {
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > SALE_RECORD_EVENT_CHANGE_LIMIT) {
    fail(`Sales Records events require 1-${SALE_RECORD_EVENT_CHANGE_LIMIT} changed fields.`)
  }
  const allowed = new Set<string>(FIELDS_BY_KIND[kind])
  const seen = new Set<string>()
  for (const change of changes) {
    if (!object(change)) fail('Sales Records changes must be objects.')
    exactKeys(change, ['field', 'before', 'after'], 'Sales Records change')
    if (!FIELDS.has(change.field) || !allowed.has(change.field)) fail(`${String(change.field)} is not allowed for ${kind}.`)
    if (seen.has(change.field)) fail(`${change.field} is duplicated.`)
    seen.add(change.field)
    validateState(change.field, change.before)
    validateState(change.field, change.after)
    if (JSON.stringify(change.before) === JSON.stringify(change.after)) fail(`${change.field} did not change.`)
  }
  const serialized = JSON.stringify(changes)
  if (bytes(serialized) > SALE_RECORD_EVENT_CHANGE_BYTES) fail('Sales Records changes exceed 65536 UTF-8 bytes.')
  return serialized
}

function validateResponse(value: Record<string, unknown> | null | undefined): string | null {
  if (value == null) return null
  if (!object(value) || Object.keys(value).some((key) => !RESPONSE_KEYS.has(key))) fail('Sales Records retry response has unsupported keys.')
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'success' || key === 'duplicate') {
      if (typeof entry !== 'boolean') fail(`Sales Records retry response ${key} must be boolean.`)
    } else if (key === 'id' || key === 'saleId' || key === 'returnId') {
      if (!Number.isSafeInteger(entry) || Number(entry) <= 0) fail(`Sales Records retry response ${key} must be a positive integer.`)
    } else if (key === 'stock_skipped') {
      if (entry !== 1) fail('Sales Records retry response stock_skipped must be 1.')
    } else if (typeof entry !== 'string' || bytes(entry) > 120) {
      fail(`Sales Records retry response ${key} must be bounded text.`)
    }
  }
  const serialized = JSON.stringify(value)
  if (bytes(serialized) > SALE_RECORD_EVENT_CHANGE_BYTES) fail('Sales Records retry response exceeds 65536 UTF-8 bytes.')
  return serialized
}

export function buildSaleRecordEventsInsert(events: SaleRecordEventInput[]): { statement: SaleRecordEventStatement; eventsBytes: number } | null {
  if (!Array.isArray(events) || events.length === 0) return null
  if (events.length > SALE_RECORD_EVENT_LIMIT) fail(`Sales Records event batches are limited to ${SALE_RECORD_EVENT_LIMIT} sales.`)
  const normalized = events.map((event) => {
    if (!Number.isSafeInteger(event.saleId) || event.saleId <= 0) fail('Sales Records saleId is invalid.')
    if (!SOURCE_KINDS.has(event.sourceKind)) fail('Sales Records sourceKind is invalid.')
    const sourceId = String(event.sourceId || '')
    if (!sourceId || sourceId.length > 180) fail('Sales Records sourceId is invalid.')
    if (!Number.isSafeInteger(event.generation) || event.generation < 0 || event.generation > 1_000_000) fail('Sales Records generation is invalid.')
    if (!KINDS.has(event.kind)) fail('Sales Records kind is invalid.')
    if (!['apply', 'undo', 'redo'].includes(event.via)) fail('Sales Records via is invalid.')
    const subject = event.subject == null ? null : String(event.subject)
    if (subject !== null && subject.length > 240) fail('Sales Records subject is too long.')
    const actorUsername = event.actorUsername == null ? null : String(event.actorUsername)
    if (actorUsername !== null && actorUsername.length > 120) fail('Sales Records actor username is too long.')
    if (event.actorId != null && (!Number.isSafeInteger(event.actorId) || event.actorId <= 0)) fail('Sales Records actor id is invalid.')
    const occurredAt = String(event.occurredAt || '')
    if (!occurredAt || occurredAt.length > 40 || !Number.isFinite(Date.parse(occurredAt))) fail('Sales Records occurredAt is invalid.')
    const digest = event.requestDigest == null ? null : String(event.requestDigest)
    if (digest !== null && !/^[0-9a-f]{64}$/.test(digest)) fail('Sales Records request digest is invalid.')
    const changesJson = validateChanges(event.kind, event.changes)
    const sourceRule = SOURCE_RULES[event.sourceKind]
    if (!sourceRule.kinds.has(event.kind)) fail(`${event.kind} is not valid for ${event.sourceKind}.`)
    const expectedVia: SaleRecordEventVia = event.generation === 0 ? 'apply' : event.generation % 2 === 1 ? 'undo' : 'redo'
    if ((!sourceRule.replay && event.generation !== 0) || event.via !== expectedVia) {
      fail(`Sales Records generation and via are invalid for ${event.sourceKind}.`)
    }
    return {
      id: crypto.randomUUID(),
      sale_id: event.saleId,
      source_kind: event.sourceKind,
      source_id: sourceId,
      generation: event.generation,
      kind: event.kind,
      via: event.via,
      subject,
      actor_id: event.actorId == null ? null : event.actorId,
      actor_username: actorUsername,
      occurred_at: occurredAt,
      changes_json: changesJson,
      request_digest: digest,
      response_json: validateResponse(event.response),
    }
  })
  const serialized = JSON.stringify(normalized)
  const eventsBytes = bytes(serialized)
  if (eventsBytes > SALE_RECORD_EVENTS_JSON_BYTES) fail(`Sales Records event batch exceeds ${SALE_RECORD_EVENTS_JSON_BYTES} UTF-8 bytes.`)
  return {
    statement: {
      sql: `INSERT INTO sale_record_events(
              id,sale_id,source_kind,source_id,generation,kind,via,subject,
              actor_id,actor_username,occurred_at,changes_json,request_digest,response_json
            )
            SELECT
              json_extract(value,'$.id'),
              CAST(json_extract(value,'$.sale_id') AS INTEGER),
              json_extract(value,'$.source_kind'),json_extract(value,'$.source_id'),
              CAST(json_extract(value,'$.generation') AS INTEGER),
              json_extract(value,'$.kind'),json_extract(value,'$.via'),json_extract(value,'$.subject'),
              CAST(json_extract(value,'$.actor_id') AS INTEGER),json_extract(value,'$.actor_username'),
              json_extract(value,'$.occurred_at'),json_extract(value,'$.changes_json'),
              json_extract(value,'$.request_digest'),json_extract(value,'$.response_json')
            FROM json_each(@events)`,
      params: { events: serialized },
    },
    eventsBytes,
  }
}

export function assertSaleRecordBatchBounds(statementCount: number, snapshot: unknown, eventsBytes: number): void {
  const snapshotBytes = bytes(JSON.stringify(snapshot))
  if (statementCount > 500 || eventsBytes > SALE_RECORD_EVENTS_JSON_BYTES || snapshotBytes + eventsBytes > SALE_RECORD_COMBINED_SNAPSHOT_BYTES) {
    fail('Selection is too large for one atomic action. Select fewer records.')
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
