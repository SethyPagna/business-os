// Shared "how do we describe a batch that has no lot code" formatting --
// used by both the POS lot picker (ProductDetailSheet.tsx) and the
// Inventory admin surfaces (ManageBatchesModal.tsx, and the mandatory
// batch-picker wiring into InventoryStockModals.tsx). See progress.md's
// "Batch selection made mandatory on add/remove stock" item: "Default
// batch `n+1: mm/dd/yyyy` stays the default for add stock / add product /
// import; batch number still auto-increments per product." `batch_number`
// itself is assigned once, server-side, at INSERT time (migration 0016 +
// lib/productBatches.ts's `nextBatchNumber`) -- this file only turns that
// stored number (plus the stored received-at timestamp) into display text,
// it never invents or recomputes a number on its own.

export type BatchLike = {
  id: number | string
  lot_code?: string | null
  batch_number?: number | null
  received_at?: string | null
}

// `received_at` comes back as a D1 `datetime('now')` string
// ("YYYY-MM-DD HH:MM:SS", UTC, no offset) -- normalize to something
// `Date` parses reliably before formatting, same "add a T, assume Z"
// treatment other date-parsing call sites in this codebase already use
// for D1 timestamps.
export function formatBatchReceivedDate(receivedAt: string | null | undefined): string | null {
  const raw = String(receivedAt || '').trim()
  if (!raw) return null
  const isoish = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`
  const date = new Date(isoish)
  if (Number.isNaN(date.getTime())) return null
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const yyyy = date.getFullYear()
  return `${mm}/${dd}/${yyyy}`
}

// "n: mm/dd/yyyy" -- the decided default label (word "Batch" prefix is
// added by the caller, batchDisplayLabel below, so this stays reusable
// for a plain numeric badge too) for a batch that was never given a lot
// code. Degrades gracefully if either half is missing (old pre-migration
// data, or a received_at that failed to parse) rather than producing a
// broken-looking string.
export function formatDefaultBatchLabel(batchNumber: number | null | undefined, receivedAt: string | null | undefined): string | null {
  const n = Number(batchNumber)
  const hasNumber = Number.isFinite(n) && n > 0
  const datePart = formatBatchReceivedDate(receivedAt)
  if (hasNumber && datePart) return `${n}: ${datePart}`
  if (hasNumber) return String(n)
  if (datePart) return datePart
  return null
}

// Full fallback chain for displaying one batch: the date-derived code
// (lot_code -- see cloudflare/src/lib/batchCode.ts's dateToBatchCode,
// always populated now, e.g. "08222026") wins as the primary identifier,
// then "Batch <n: mm/dd/yyyy>" for pre-redesign rows that predate it,
// then a bare id as the last resort so a pill/row is never blank.
export function batchDisplayLabel(batch: BatchLike, batchWord = 'Batch'): string {
  if (batch.lot_code) return batch.lot_code
  const defaultLabel = formatDefaultBatchLabel(batch.batch_number, batch.received_at)
  if (defaultLabel) return `${batchWord} ${defaultLabel}`
  return `${batchWord} #${batch.id}`
}
