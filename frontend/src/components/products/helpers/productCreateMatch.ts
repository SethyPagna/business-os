// Add Product live identity guidance.
//
// Product grouping is intentionally VIRTUAL and name-based:
//   - every database row is an ordinary product row
//   - rows with the same normalized name are wrapped under one group title
//   - there is no stored parent product, parent_id, or is_group requirement
//
// Identity guidance while creating:
//   same name + same barcode      -> exact twin; create blocked
//   same name + different barcode -> another ordinary row in that name group
//   different name + same barcode -> legal separate product; flag for review

export interface CreateMatchCandidate {
  id: number | string
  name?: string
  barcode?: string | null
  selling_price_usd?: unknown
}

export type CreateMatchKind =
  | 'exact_twin'
  | 'name_match'
  | 'barcode_match'
  | null

export interface CreateMatchVerdict {
  kind: CreateMatchKind
  primary: CreateMatchCandidate | null
  groupRows: CreateMatchCandidate[]
  canonicalName: string
  priceMatches: boolean
  beforeAfter: { group: string; asNew: string }
  // Only a DIFFERENT-NAME barcode match has a meaningful separate choice.
  // A same-name row is automatically grouped by name, so presenting
  // "separate" there would promise behavior the UI cannot produce.
  allowProceedAsNew: boolean
}

const norm = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const normBarcode = (value: unknown) => String(value ?? '').trim()

export function classifyCreateMatches(
  typed: { name?: unknown; barcode?: unknown; selling_price_usd?: unknown },
  candidates: readonly CreateMatchCandidate[],
): CreateMatchVerdict {
  const typedName = norm(typed.name)
  const typedBarcode = normBarcode(typed.barcode)
  const typedPrice = Number(typed.selling_price_usd) || 0

  const none: CreateMatchVerdict = {
    kind: null,
    primary: null,
    groupRows: [],
    canonicalName: '',
    priceMatches: false,
    beforeAfter: { group: '', asNew: '' },
    allowProceedAsNew: true,
  }
  if (!typedName && !typedBarcode) return none

  const nameRows = typedName ? candidates.filter((row) => norm(row.name) === typedName) : []
  const barcodeRows = typedBarcode ? candidates.filter((row) => normBarcode(row.barcode) === typedBarcode) : []
  const twin = nameRows.find((row) => typedBarcode && normBarcode(row.barcode) === typedBarcode) || null

  if (twin) {
    const canonical = String(nameRows[0]?.name || twin.name || '').trim()
    return {
      kind: 'exact_twin',
      primary: twin,
      groupRows: nameRows,
      canonicalName: canonical,
      priceMatches: false,
      beforeAfter: {
        group: `${canonical} (${nameRows.length}) → no new row; this exact name + barcode already exists`,
        asNew: '',
      },
      allowProceedAsNew: false,
    }
  }

  if (nameRows.length) {
    const canonical = String(nameRows[0]?.name || '').trim()
    const priceMatches = typedPrice > 0 && nameRows.some((row) => Math.abs((Number(row.selling_price_usd) || 0) - typedPrice) < 0.005)
    return {
      kind: 'name_match',
      primary: nameRows[0],
      groupRows: nameRows,
      canonicalName: canonical,
      priceMatches,
      beforeAfter: {
        group: `${canonical} (${nameRows.length} ${nameRows.length === 1 ? 'row' : 'rows'}) → ${canonical} (${nameRows.length + 1} rows under the same automatic group title)`,
        asNew: '',
      },
      // Same normalized name always wraps under the same group title.
      allowProceedAsNew: false,
    }
  }

  if (barcodeRows.length) {
    const match = barcodeRows[0]
    const matchName = String(match.name || '').trim()
    return {
      kind: 'barcode_match',
      primary: match,
      groupRows: [],
      canonicalName: matchName,
      priceMatches: false,
      beforeAfter: {
        group: `Use "${matchName}" → the new ordinary row wraps under that same-name group title`,
        asNew: `Keep your different name → a separate product row shares barcode ${normBarcode(match.barcode)}`,
      },
      allowProceedAsNew: true,
    }
  }

  return none
}
