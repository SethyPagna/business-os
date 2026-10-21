// Which row, if any, a scanned barcode points at.
//
// A scan never adds or picks a product (owner rule, 2 Sep): it fills the search
// box and the list narrows. When exactly ONE child row carries that barcode the
// surface may highlight it and scroll to it, so the person confirms with one
// deliberate tap or Enter. Barcode is the only identity of a product row, so
// this asks searchRelevanceTier for the exact-barcode tier and nothing else: a
// name match, a substring ('13348901729222' contains '3348901729222') or a
// longer GTIN is not a hit. Leading zeros fold and UPC-E pairs with UPC-A,
// because that is what the tier already does for the server's search.
import { MATCH_TIER_EXACT_BARCODE, searchRelevanceTier } from './searchMatch.ts'

export interface ScanRow {
  barcode?: unknown
  name?: unknown
}

export function isExactBarcodeHit(row: ScanRow | null | undefined, query: unknown): boolean {
  return searchRelevanceTier(row, query, { nameTiers: false }) === MATCH_TIER_EXACT_BARCODE
}

/**
 * The one exact-barcode row across every group, with the group that owns it, or
 * null when none matches or two rows share the barcode (then nothing is singled
 * out and the matches are simply listed). `rowsOf` returns a group's child
 * rows: pass what the person sees as separate rows, not the raw records that a
 * display row merges.
 */
export function findScanHit<G, R extends ScanRow>(
  groups: Iterable<G>,
  rowsOf: (group: G) => readonly R[],
  query: unknown,
): { group: G; row: R } | null {
  let hit: { group: G; row: R } | null = null
  for (const group of groups) {
    for (const row of rowsOf(group)) {
      if (!isExactBarcodeHit(row, query)) continue
      if (hit) return null
      hit = { group, row }
    }
  }
  return hit
}
