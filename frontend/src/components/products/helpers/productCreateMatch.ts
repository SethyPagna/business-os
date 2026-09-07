// Add Product live identity guidance.
//
// Product grouping is intentionally VIRTUAL and name-based:
//   - every database row is an ordinary product row
//   - rows with the same normalized name are wrapped under one group title
//   - there is no stored parent product, parent_id, or is_group requirement
//
// Identity guidance while creating -- deliberately THE SAME question the
// server's findSameProductIdentityProduct / pickSameIdentityRow asks, so the
// form can never promise a row the POST then refuses with a 409:
//   same name + same barcode      -> exact twin; create blocked
//   same name + different barcode -> another row in that name group
//   different name + same barcode -> legal separate product; flag for review
//
// Cost is NOT part of the question (the Sep-4 ruling: only a different barcode
// mints a child row; two costs for one article are averaged by the merge), and
// the barcode is compared through identityBarcodeKey, so '0880123' and '880123'
// are one identity here exactly as they are everywhere else. The stored
// barcode is never rewritten -- only the comparison folds.

import { identityBarcodeKey } from '../../../utils/productDetailRule.ts'

export interface CreateMatchCandidate {
  id: number | string
  name?: string
  barcode?: string | null
  // Not part of identity. Carried because the same rows are offered as Name
  // suggestions (helpers/productNameSuggestions.ts), where the second line
  // has to say WHICH "Serum" this is.
  brand?: string | null
  selling_price_usd?: unknown
  // accepted and DELIBERATELY IGNORED: cost is not product identity
  cost_price_usd?: unknown
  cost_price_khr?: unknown
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
  // cost_price_* are accepted and DELIBERATELY IGNORED -- see the rule above
  typed: { name?: unknown; barcode?: unknown; selling_price_usd?: unknown; cost_price_usd?: unknown; cost_price_khr?: unknown },
  candidates: readonly CreateMatchCandidate[],
): CreateMatchVerdict {
  const typedName = norm(typed.name)
  const typedBarcode = normBarcode(typed.barcode)
  // the identity key -- what every comparison site, client and server, uses
  const typedBarcodeKey = identityBarcodeKey(typed.barcode)
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
  const barcodeRows = typedBarcode ? candidates.filter((row) => identityBarcodeKey(row.barcode) === typedBarcodeKey) : []
  const twin = nameRows.find((row) => identityBarcodeKey(row.barcode) === typedBarcodeKey) || null

  if (twin) {
    const canonical = String(nameRows[0]?.name || twin.name || '').trim()
    return {
      kind: 'exact_twin',
      primary: twin,
      groupRows: nameRows,
      canonicalName: canonical,
      priceMatches: false,
      beforeAfter: {
        group: `${canonical} (${nameRows.length}) → no new row; this name + barcode already exists`,
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
