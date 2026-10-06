// The supplier AP ledger's Branch filter, derived from the branch rows.
//
// supplier_invoices.source_branch is the old system's report origin, stored
// verbatim as the literal 'shop' or 'warehouse', and GET
// /api/suppliers/reports/ap-invoices (cloudflare routes/contacts.ts) filters
// on exactly those two literals -- anything else is ignored, not an error. So
// the API parameter stays the legacy literal, and the only safe bridge from a
// branch ROW to it is the row's canonical_key (immutable, CHECK-constrained
// to the same two literals). A branch's NAME is never read for the mapping:
// after the cutover the Warehouse row is called "LC Store" and the Shop row
// "Old Shop", and neither name says which literal it owns.
//
// The invoice rows themselves keep the origin they were recorded with
// (apInvoiceRecordedBranchLabel): owner rule, old records are never relabelled.
export type ApBranchValue = 'warehouse' | 'shop'
export type ApBranchLabels = { shop: string; warehouse: string; inactive: string }
export type ApBranchRow = { name?: unknown; canonical_key?: unknown; is_active?: unknown }
export type ApBranchOption = { value: ApBranchValue; label: string }

const ORDER: readonly ApBranchValue[] = ['warehouse', 'shop']

// What the recorded origin word of an invoice reads, in the pack's own language.
export function apInvoiceRecordedBranchLabel(value: unknown, labels: ApBranchLabels): string {
  return value === 'warehouse' ? labels.warehouse : labels.shop
}

// A branch still carrying its default name reads in the pack's language, as the
// filter always did; a renamed one reads as the name it was given.
function ownLabel(row: ApBranchRow, key: ApBranchValue, labels: ApBranchLabels): string {
  const name = String(row.name ?? '').trim()
  return !name || name.toLowerCase() === key ? labels[key] : name
}

const isRetired = (row: ApBranchRow): boolean => row.is_active != null && !(row.is_active === true || row.is_active === 1 || row.is_active === '1')

// `rows === null` (not loaded) and rows that carry no canonical_key (identity
// backfill not applied) both give the two legacy literals with their legacy
// words: exactly the filter as it was before any branch was renamed.
export function apInvoiceBranchOptions(rows: readonly ApBranchRow[] | null | undefined, labels: ApBranchLabels): ApBranchOption[] {
  const byKey = new Map<ApBranchValue, ApBranchRow>()
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = row?.canonical_key
    if ((key === 'shop' || key === 'warehouse') && !byKey.has(key)) byKey.set(key, row)
  }
  if (byKey.size === 0) return ORDER.map((value) => ({ value, label: labels[value] }))
  return ORDER.filter((value) => byKey.has(value)).map((value) => {
    const row = byKey.get(value) as ApBranchRow
    const label = ownLabel(row, value, labels)
    return { value, label: isRetired(row) ? `${label} (${labels.inactive})` : label }
  })
}
