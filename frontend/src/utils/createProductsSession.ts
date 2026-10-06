// Same-session duplicate guard shared by the Stock Session float
// (FastStockInModal.tsx): one session never queues the same article twice.
//
// The create-products session model that used to live here (header, rows,
// summary, permission requirements) belonged to CreateProductsSessionModal,
// which UI-STOCK-3 deleted in favour of the one Stock Session float.

import { normalizeProductGroupName } from './productDetailRule.ts'
import { barcodeKeysMatch } from './searchMatch.ts'

export type SessionProductDuplicateReason = 'name' | 'barcode'

/**
 * A session-entry safety rule, deliberately separate from catalog identity.
 * The operator should not add a second line for the same barcode OR retype the
 * same normalized name in one open session; they should edit the first line's
 * quantity instead. Empty names/barcodes never match. Barcode comparison uses
 * the scanner's guarded UPC/EAN relation, so a valid UPC-E cannot collide with
 * an unrelated seven-digit internal code after its leading zero is stripped.
 */
export function sessionProductDuplicateReason(
  left: { name?: unknown; barcode?: unknown },
  right: { name?: unknown; barcode?: unknown },
): SessionProductDuplicateReason | null {
  const leftName = normalizeProductGroupName(left.name)
  const rightName = normalizeProductGroupName(right.name)
  if (leftName && leftName === rightName) return 'name'
  const leftBarcode = String(left.barcode ?? '').trim()
  const rightBarcode = String(right.barcode ?? '').trim()
  if (!leftBarcode || !rightBarcode || /^0+$/.test(leftBarcode) || /^0+$/.test(rightBarcode)) return null
  return barcodeKeysMatch(leftBarcode, rightBarcode) ? 'barcode' : null
}

export function findSessionProductDuplicate<T extends { key?: unknown; lineId?: unknown; name?: unknown; barcode?: unknown }>(
  rows: readonly T[],
  candidate: { name?: unknown; barcode?: unknown },
  excludeKey?: unknown,
): { row: T; reason: SessionProductDuplicateReason } | null {
  for (const row of rows) {
    const rowKey = row.key ?? row.lineId
    if (excludeKey != null && String(rowKey) === String(excludeKey)) continue
    const reason = sessionProductDuplicateReason(row, candidate)
    if (reason) return { row, reason }
  }
  return null
}
