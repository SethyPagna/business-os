// The ONE order every lot (received-date) list is shown in. Owner ruling,
// 12 Oct 2026: newest received date first everywhere -- POS picker, Transfer,
// Manage Received Dates, Returns, inventory lists -- and a list that is about
// expiry shows the lot closest to expiring first. This is DISPLAY ONLY: the
// Worker's FIFO deduction (lib/productBatches.ts listBatchesForProduct) and
// the lot a sale actually draws from are not touched, and no list may start
// selecting a lot for staff because of its new order.

import { lotCodeToIsoDate } from './batchLabel.ts'
import { parseServerTimestampMs } from './formatters.ts'

// Structural on purpose, so a pure comparator needs no transport import.
export type LotOrderLike = {
  lot_code?: string | null
  received_at?: string | null
  batch_number?: number | null
  expiry_date?: string | null
  quantity?: unknown
}

export type LotListContext = 'received' | 'expiry'

// A stored date or timestamp as a sortable instant. One without an offset is UTC (D1 writes it so), never the device's zone.
function parseDateInstant(value: unknown): number | null {
  const ms = parseServerTimestampMs(typeof value === 'string' ? value : null)
  return Number.isFinite(ms) ? ms : null
}

/**
 * The instant one lot was received, for ordering: the stored `received_at`
 * wins, else a lot code that is really an MMDDYYYY date decoded back to a date
 * (the same precedence batchLabel.ts's batchDisplayLabel prints). null when
 * neither is usable -- a blank/malformed `received_at` and a genuine custom
 * code such as production's synthetic `RECON-<productId>` both land here, and
 * are listed AFTER every dated lot rather than pretending to be epoch 0.
 * The code is decoded from its ISO form, never from the dd/mm/yyyy display
 * string, so ordering cannot change when display formatting does.
 */
export function batchReceivedInstant(batch: LotOrderLike | null | undefined): number | null {
  const stored = parseDateInstant(batch?.received_at)
  if (stored != null) return stored
  const iso = lotCodeToIsoDate(batch?.lot_code)
  return iso ? parseDateInstant(iso) : null
}

function isNumberedBatch(value: unknown): boolean {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0
}

type KeyedLot<T> = {
  lot: T
  index: number
  received: number | null
  expiry: number | null
  available: boolean
}

// Newest received first. Date is the single dominant key; stock only breaks an
// exact tie (S4-18's "not split into available/unavailable sections" still
// holds), then the higher batch_number -- the later receipt -- and finally the
// incoming order so the sort stays stable.
function compareNewestReceived<T extends LotOrderLike>(left: KeyedLot<T>, right: KeyedLot<T>): number {
  if ((left.received != null) !== (right.received != null)) return left.received != null ? -1 : 1
  if (left.received != null && right.received != null && left.received !== right.received) return right.received - left.received
  if (left.available !== right.available) return left.available ? -1 : 1
  const leftNumbered = isNumberedBatch(left.lot.batch_number)
  const rightNumbered = isNumberedBatch(right.lot.batch_number)
  if (leftNumbered !== rightNumbered) return leftNumbered ? -1 : 1
  if (leftNumbered && Number(left.lot.batch_number) !== Number(right.lot.batch_number)) {
    return Number(right.lot.batch_number) - Number(left.lot.batch_number)
  }
  return left.index - right.index
}

// Closest to expiry first (an already expired lot is the closest), lots with
// no usable expiry last; lots expiring the same day keep the received order.
function compareClosestExpiry<T extends LotOrderLike>(left: KeyedLot<T>, right: KeyedLot<T>): number {
  if ((left.expiry != null) !== (right.expiry != null)) return left.expiry != null ? -1 : 1
  if (left.expiry != null && right.expiry != null && left.expiry !== right.expiry) return left.expiry - right.expiry
  return compareNewestReceived(left, right)
}

export function sortLotsForDisplay<T extends LotOrderLike>(lots: readonly T[] = [], context: LotListContext = 'received'): T[] {
  const rows = Array.isArray(lots) ? lots : []
  const compare = context === 'expiry' ? compareClosestExpiry<T> : compareNewestReceived<T>
  return rows
    .map((lot, index): KeyedLot<T> => ({
      lot,
      index,
      received: batchReceivedInstant(lot),
      expiry: parseDateInstant(lot?.expiry_date),
      available: Number(lot?.quantity || 0) > 0,
    }))
    .sort(compare)
    .map((entry) => entry.lot)
}
