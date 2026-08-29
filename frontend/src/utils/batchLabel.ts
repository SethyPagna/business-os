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

// Z1a: a lot code that is a pure 8-digit MMDDYYYY string (dateToBatchCode's
// output, e.g. "08242026") is really the received date wearing a code's
// clothes -- showing it verbatim next to real mm/dd/yyyy dates on other
// surfaces is exactly the "08242026 where a date belongs" confusion the user
// flagged. Decode it back to mm/dd/yyyy; return null for anything that is not
// a valid MMDDYYYY calendar date (a genuine custom lot code, which must render
// AS a code, per the rule "dates render mm/dd/yyyy, lot codes render as
// codes, never interchanged").
export function lotCodeAsDate(lotCode: string | null | undefined): string | null {
  const raw = String(lotCode || '').trim()
  if (!/^\d{8}$/.test(raw)) return null
  const mm = Number(raw.slice(0, 2))
  const dd = Number(raw.slice(2, 4))
  const yyyy = Number(raw.slice(4, 8))
  if (mm < 1 || mm > 12 || dd < 1 || yyyy < 1970 || yyyy > 2999) return null
  const lastDay = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate()
  if (dd > lastDay) return null
  return `${String(mm).padStart(2, '0')}/${String(dd).padStart(2, '0')}/${yyyy}`
}

// Full fallback chain for displaying one batch. Z1a display rule: a batch
// reads as its received DATE (mm/dd/yyyy) everywhere -- the stored
// received_at wins (authoritative), falling back to decoding a date-derived
// lot code. Only a GENUINE custom lot code (not an MMDDYYYY date) renders as a
// code. Then "Batch <n: mm/dd/yyyy>" for pre-redesign rows, then a bare id so
// a pill/row is never blank.
export function batchDisplayLabel(batch: BatchLike, batchWord = 'Batch'): string {
  const codeAsDate = lotCodeAsDate(batch.lot_code)
  // A real custom code (has a lot_code that is NOT an MMDDYYYY date) shows as
  // the code.
  if (batch.lot_code && !codeAsDate) return batch.lot_code
  // Otherwise show the received date: the stored received_at, or the code
  // decoded to a date.
  const dateLabel = formatBatchReceivedDate(batch.received_at) || codeAsDate
  if (dateLabel) return dateLabel
  const defaultLabel = formatDefaultBatchLabel(batch.batch_number, batch.received_at)
  if (defaultLabel) return `${batchWord} ${defaultLabel}`
  return `${batchWord} #${batch.id}`
}
