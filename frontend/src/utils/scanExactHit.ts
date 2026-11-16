// Which row, if any, a scanned barcode points at.
//
// A scan never adds or picks a product (owner rule, 2 Sep): it fills the search
// box and the list narrows. When exactly ONE product (unmerged twins count as one) carries that barcode the
// surface may highlight it and scroll to it, so the person confirms with one
// deliberate tap or Enter. Barcode is the only identity of a product row, so
// this asks searchRelevanceTier for the exact-barcode tier and nothing else: a
// name match, a substring ('13348901729222' contains '3348901729222') or a
// longer GTIN is not a hit. Leading zeros fold and UPC-E pairs with UPC-A,
// because that is what the tier already does for the server's search.
import { MATCH_TIER_EXACT_BARCODE, searchRelevanceTier } from './searchMatch.ts'
import { productTwinKey } from './productGrouping.ts'

export interface ScanRow {
  barcode?: unknown
  name?: unknown
}

export function isExactBarcodeHit(row: ScanRow | null | undefined, query: unknown): boolean {
  return searchRelevanceTier(row, query, { nameTiers: false }) === MATCH_TIER_EXACT_BARCODE
}

// Two unmerged duplicates (same name, same identity barcode, leading zeros folded) are separate rows
// but one product to a person scanning (productTwinKey): they count as one hit. The first in list order is kept.
/**
 * The one exact-barcode row across every group, with the group that owns it, or
 * null when none matches or two DIFFERENT products share the barcode (then
 * nothing is singled out and the matches are simply listed). Unmerged twins
 * inside one group are the same product: the first of them is the hit.
 * `rowsOf` returns a group's child rows, one per record.
 */
export function findScanHit<G, R extends ScanRow>(
  groups: Iterable<G>,
  rowsOf: (group: G) => readonly R[],
  query: unknown,
): { group: G; row: R } | null {
  let hit: { group: G; row: R } | null = null
  let hitKey = ''
  for (const group of groups) {
    for (const row of rowsOf(group)) {
      if (!isExactBarcodeHit(row, query)) continue
      const key = productTwinKey(row)
      if (hit) {
        if (key && hit.group === group && key === hitKey) continue
        return null
      }
      hit = { group, row }
      hitKey = key
    }
  }
  return hit
}
