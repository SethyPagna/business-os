// F1 (Part 408): "Add Product = new products only." While the operator
// types a NEW product's name/barcode, the existing catalog is searched
// live; anything matching raises a STRUCTURED verdict before create --
// the identity rule spoken at the moment it matters, not a 409 after the
// fact. Pure: the form fetches candidates, this classifies them.
//
// The identity rule (permanent, see cloudflare lib/productIdentity):
//   same name + same barcode      -> the SAME product (twin; create blocked)
//   same name + different barcode -> a CHILD ROW of that name group
//   different name + same barcode -> a separate product (legal, flagged)

export interface CreateMatchCandidate {
  id: number | string
  name?: string
  barcode?: string | null
  selling_price_usd?: unknown
  is_group?: unknown
  parent_id?: unknown
}

export type CreateMatchKind =
  | 'exact_twin'        // same name + same barcode -- creating is forbidden
  | 'name_match'        // same name, different/absent barcode -- child row expected
  | 'barcode_match'     // same barcode, different name -- legal but worth a look
  | null

export interface CreateMatchVerdict {
  kind: CreateMatchKind
  // the single closest existing product for the headline
  primary: CreateMatchCandidate | null
  // every same-name row (the group this would join as a child)
  groupRows: CreateMatchCandidate[]
  // the group's canonical name (first row's exact casing) -- "add as
  // child" adopts THIS spelling so the new row lands inside the group
  // instead of forking a near-miss name
  canonicalName: string
  // advisory only (user: "price similarity is advisory"): same name+price
  // but different barcode strengthens the child recommendation
  priceMatches: boolean
  // before -> after arrow lines for the confirm step
  beforeAfter: { child: string; asNew: string }
  // 'proceed as new' is withheld for an exact twin -- the backend blocks
  // it anyway (duplicate_product 409); offering the button would promise
  // something the identity rule forbids
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
    kind: null, primary: null, groupRows: [], canonicalName: '',
    priceMatches: false, beforeAfter: { child: '', asNew: '' }, allowProceedAsNew: true,
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
        child: `${canonical} (${nameRows.length}) → ${canonical} (${nameRows.length}) — no new row; this IS that product`,
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
        child: `${canonical} (${nameRows.length} ${nameRows.length === 1 ? 'row' : 'rows'}) → ${canonical} (${nameRows.length + 1} rows — this one joins as a child)`,
        asNew: `${canonical} (${nameRows.length}) stays · a separate new product is created beside it`,
      },
      allowProceedAsNew: true,
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
        child: `${matchName} → this row joins under "${matchName}" (adopting that name)`,
        asNew: `"${matchName}" keeps barcode ${normBarcode(match.barcode)} · your new product shares it as a separate item`,
      },
      allowProceedAsNew: true,
    }
  }

  return none
}
