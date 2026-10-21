// What an empty list means when the query came from a SCAN (camera or gun)
// rather than from typing.
//
// A typed query that finds nothing keeps the generic empty state: the person may
// be mid-word. A scanned code is a whole barcode, so the page can say what
// happened: no product carries it, or one does and the filters hide it (then the
// way out is to clear them). A scan still never adds, opens or picks anything
// (owner rule, 2 Sep): this only chooses the words shown where the list is empty.
//
// "Carries it" is barcode identity, decided by the search index the page already
// holds (api/productSearchIndex.ts catalogHasBarcode): leading zeros fold, UPC-E
// pairs with UPC-A, Khmer digits fold. Never a name or a substring.

export type ScanMissKind = 'no_match' | 'hidden_by_filters'

export interface ScanMissInput {
  /** The scanned code still sitting in the search box; null when the text was typed or edited since. */
  scannedCode: string | null
  /** The list on screen answers that code: its request finished and no newer one is pending. */
  answered: boolean
  listEmpty: boolean
  /** Some filter besides the search text is narrowing the list. */
  filtersActive: boolean
  /** Some catalog product carries the code; null while the search index cannot say. */
  inCatalog: boolean | null
}

export interface ScanMiss {
  kind: ScanMissKind
  code: string
}

export function classifyScanMiss({ scannedCode, answered, listEmpty, filtersActive, inCatalog }: ScanMissInput): ScanMiss | null {
  if (!scannedCode || !answered || !listEmpty) return null
  // Only a product that exists can be hidden. With no filter on, an empty answer
  // means the code is simply not in the catalog, whatever a stale index says.
  if (filtersActive && inCatalog === true) return { kind: 'hidden_by_filters', code: scannedCode }
  // Filters on and no index to ask: the empty list could be either, so neither is
  // claimed and the page keeps its generic empty state (which already offers Clear).
  if (filtersActive && inCatalog === null) return null
  return { kind: 'no_match', code: scannedCode }
}
