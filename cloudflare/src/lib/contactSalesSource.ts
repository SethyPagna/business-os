import { buildSaleRecordEventsInsert, type SaleRecordEventStatement } from './saleRecordEvents'
import type { SaleRecordChange } from './saleRecords'
import { getPermissionTier, type PermissionUser } from './permissions'
import { contactDisplayAddress } from './contactOptions'

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

export function readContactSalesSource(
  user: PermissionUser,
  table: string,
  body: Record<string, unknown>,
  options: { requireSaleId: boolean },
): ContactSalesSourceRead {
  const raw = body.source
  if (raw === undefined || raw === null || raw === '') return { ok: true, source: null }
  if (raw !== 'pos' && raw !== 'sale') return { ok: false, status: 400, error: 'Unknown source. Use "pos" or "sale".' }
  if (table !== 'customers') return { ok: false, status: 400, error: 'A POS or sale source applies to customers only.' }
  if (getPermissionTier(user, SOURCE_GRANT[raw]) !== 'full') {
    return { ok: false, status: 403, error: 'You do not have permission to perform this action' }
  }
  if (raw === 'pos') return { ok: true, source: { kind: 'pos', saleId: null } }
  const saleId = Number(body.sale_id)
  if (options.requireSaleId && (!Number.isSafeInteger(saleId) || saleId <= 0)) {
    return { ok: false, status: 400, error: 'A sale source needs the sale_id it was made from.' }
  }
  return { ok: true, source: { kind: 'sale', saleId: Number.isSafeInteger(saleId) && saleId > 0 ? saleId : null } }
}

export function contactSourceAuditDetails(source: ContactSalesSource | null): Record<string, unknown> {
  if (!source) return {}
  return { source: source.kind, ...(source.saleId ? { sale_id: source.saleId } : {}) }
}

const RECORD_VALUE_LIMIT = 500

function recordText(column: string, value: unknown): string | null {
  const text = column === 'address' ? contactDisplayAddress(value) : String(value ?? '').trim()
  if (!text) return null
  return text.length > RECORD_VALUE_LIMIT ? `${text.slice(0, RECORD_VALUE_LIMIT - 1)}…` : text
}

// The sale's own record of a customer-details edit: one immutable event on the
// sale_customer source, in the same D1 batch as the customer UPDATE, so the
// change and its record commit together or not at all. null when no field the
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
    const previous = recordText(column, input.before[column])
    const next = recordText(column, input.after[column])
    if (previous === next) continue
    before[column] = previous
    after[column] = next
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
