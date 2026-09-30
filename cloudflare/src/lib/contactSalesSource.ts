import { buildSaleRecordEventsInsert, CUSTOMER_DETAILS_AFTER_MARKER, CUSTOMER_DETAILS_BEFORE_MARKER, type SaleRecordEventStatement } from './saleRecordEvents'
import type { SaleRecordChange } from './saleRecords'
import { getPermissionTier, type PermissionUser } from './permissions'

// A customer add or edit made from the POS or a sale (owner, 30 Sep 2026). The
// caller says where it came from with `source`; the Worker widens a Review-tier
// edit from name-only to these columns only for such a request, and only for a
// role that holds the POS (or Sales) grant itself. Identity (membership_number),
// the joined date and everything computed (loyalty, receivables) stay out.
export const SALES_CUSTOMER_COLUMNS = ['name', 'phone', 'email', 'address', 'notes', 'gender']

export type ContactSalesSource = { kind: 'pos' | 'sale'; saleId: number | null }
export type ContactSalesSourceRead =
  | { ok: true; source: ContactSalesSource | null }
  | { ok: false; status: 400 | 403; error: string }

const SOURCE_GRANT = { pos: 'pos', sale: 'sales' } as const

function readSaleId(raw: unknown): number | null {
  const id = typeof raw === 'number' ? raw : typeof raw === 'string' && /^[1-9]\d{0,15}$/.test(raw) ? Number(raw) : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function readContactSalesSource(
  user: PermissionUser,
  table: string,
  body: Record<string, unknown>,
): ContactSalesSourceRead {
  const raw = body.source
  if (raw === undefined || raw === null || raw === '') return { ok: true, source: null }
  if (raw !== 'pos' && raw !== 'sale') return { ok: false, status: 400, error: 'Unknown source. Use "pos" or "sale".' }
  if (table !== 'customers') return { ok: false, status: 400, error: 'A POS or sale source applies to customers only.' }
  if (getPermissionTier(user, SOURCE_GRANT[raw]) !== 'full') {
    return { ok: false, status: 403, error: 'You do not have permission to perform this action' }
  }
  if (raw === 'pos') return { ok: true, source: { kind: 'pos', saleId: null } }
  const saleId = readSaleId(body.sale_id)
  if (saleId === null) return { ok: false, status: 400, error: 'A sale source needs the sale_id it was made from.' }
  return { ok: true, source: { kind: 'sale', saleId } }
}

export type ContactSaleCheckError = { status: 404 | 409; body: { error: string; code: string } }

// A sale source must be a sale that exists and can still be worked on; an edit
// must also be of that sale's own customer. The frontend hides the pencil on a
// cancelled sale, and this is the Worker half of that rule.
export async function checkContactSaleSource(
  db: { prepare(sql: string): { get<T>(params: Record<string, unknown>): Promise<T | undefined | null> } },
  source: ContactSalesSource,
  customerId: number | null,
): Promise<ContactSaleCheckError | null> {
  if (source.kind !== 'sale') return null
  const sale = await db.prepare('SELECT id, customer_id, sale_status FROM sales WHERE id = @saleId')
    .get<{ id: number; customer_id: number | null; sale_status: string | null }>({ saleId: source.saleId })
  if (!sale) return { status: 404, body: { error: 'sale not found', code: 'sale_not_found' } }
  const status = String(sale.sale_status || 'completed')
  if (status === 'cancelled' || status === 'returned') {
    return { status: 409, body: { error: 'This sale is cancelled or fully returned, so its customer cannot be edited from it.', code: 'sale_not_editable' } }
  }
  if (customerId !== null && Number(sale.customer_id) !== customerId) {
    return { status: 409, body: { error: 'This sale is not linked to that customer.', code: 'sale_customer_mismatch' } }
  }
  return null
}

// Columns of a customer row that a caller without Full Contacts access may not stamp: the joined date
// and the membership number belong to the system and to administrators, whether
// or not the request names a source.
export const CUSTOMER_SYSTEM_COLUMNS = ['created_at', 'membership_number']

export function customerCreateColumns(columns: string[], contactsTier: string): string[] {
  return contactsTier === 'full' ? columns : columns.filter((column) => !CUSTOMER_SYSTEM_COLUMNS.includes(column))
}

export function contactSourceAuditDetails(source: ContactSalesSource | null): Record<string, unknown> {
  if (!source) return {}
  return { source: source.kind, ...(source.saleId ? { sale_id: source.saleId } : {}) }
}

const RECORD_VALUE_LIMIT = 500

const QUOTED_COLUMNS = ['name', 'gender']

function recordText(value: unknown): string | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  return text.length > RECORD_VALUE_LIMIT ? `${text.slice(0, RECORD_VALUE_LIMIT - 1)}…` : text
}

// The sale's own record of a customer-details edit: one immutable event on the
// sale_customer source, in the same D1 batch as the customer UPDATE, so the
// change and its record commit together or not at all. It quotes the old and new
// name and gender only; phone, email, address and notes are named with a marker,
// because anyone who can read Sales can read this row and it is never purged
// (the full values stay in the admin-gated audit log). null when no field the
// record shows actually changed.
export function buildCustomerDetailsSaleEvent(input: {
  saleId: number
  customerId: number
  customerName: string
  actorId: number | null
  actorUsername: string | null
  before: Record<string, unknown>
  after: Record<string, unknown>
}): SaleRecordEventStatement | null {
  const columns = Object.keys(input.after).filter((column) => SALES_CUSTOMER_COLUMNS.includes(column))
  const before: Record<string, string | null> = {}
  const after: Record<string, string | null> = {}
  for (const column of columns) {
    const previous = recordText(input.before[column])
    const next = recordText(input.after[column])
    if (previous === next) continue
    before[column] = QUOTED_COLUMNS.includes(column) ? previous : CUSTOMER_DETAILS_BEFORE_MARKER
    after[column] = QUOTED_COLUMNS.includes(column) ? next : CUSTOMER_DETAILS_AFTER_MARKER
  }
  if (!Object.keys(after).length) return null
  const changes: SaleRecordChange[] = [{
    field: 'customer_details',
    before: { state: 'known_value', value: before },
    after: { state: 'known_value', value: after },
  }]
  const insert = buildSaleRecordEventsInsert([{
    saleId: input.saleId,
    sourceKind: 'sale_customer',
    sourceId: `contact:${input.customerId}:${crypto.randomUUID()}`,
    generation: 0,
    kind: 'customer_changed',
    via: 'apply',
    subject: input.customerName.slice(0, 240),
    actorId: input.actorId,
    actorUsername: input.actorUsername,
    occurredAt: new Date().toISOString(),
    changes,
  }])
  return insert ? insert.statement : null
}
