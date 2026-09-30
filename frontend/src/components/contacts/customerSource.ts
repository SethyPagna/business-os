// The customer add/edit made from the POS or a sale. Mirrors the Worker's
// cloudflare/src/lib/contactSalesSource.ts: the same column list and the same
// `source` / `sale_id` request fields, so what this sheet sends is exactly what
// the Worker will keep.
export type CustomerSource = { kind: 'pos' } | { kind: 'sale'; saleId: number }

export const SALES_CUSTOMER_COLUMNS = ['name', 'phone', 'email', 'address', 'notes', 'gender'] as const

type Row = Record<string, unknown>

export function customerSourceFields(source: CustomerSource): Row {
  return source.kind === 'sale' ? { source: 'sale', sale_id: source.saleId } : { source: 'pos' }
}

function pickSalesColumns(row: Row): Row {
  const picked: Row = {}
  for (const column of SALES_CUSTOMER_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(row, column)) picked[column] = row[column] ?? ''
  }
  return picked
}

function sameName(a: unknown, b: unknown): boolean {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
}

// A rename from a till or a sale never rewrites other records' saved names:
// only this contact changes ('record_only'), which is the safer of the two
// choices Contacts offers.
export function buildCustomerSourcePayload(form: Row, loaded: Row | null, source: CustomerSource): Row {
  const payload: Row = { ...pickSalesColumns(form), name: String(form.name ?? '').trim(), ...customerSourceFields(source) }
  if (!loaded) {
    if (form.membership_number) payload.membership_number = form.membership_number
    if (form.duplicateDecision) payload.duplicateDecision = form.duplicateDecision
    return payload
  }
  if (loaded.updated_at) payload.updated_at = loaded.updated_at
  if (form.duplicateDecision) payload.duplicateDecision = form.duplicateDecision
  if (!sameName(loaded.name, payload.name)) payload.__rename_cascade = 'record_only'
  return payload
}

export function customerSourceRestorePayload(row: Row, source: CustomerSource): Row {
  return { ...pickSalesColumns(row), name: String(row.name ?? '').trim(), ...customerSourceFields(source), __rename_cascade: 'record_only' }
}
