// Pure, no-UI resolution-rules layer for the General mode "Add/Sale"
// import sub-option (see progress.md's "CSV-import mode selector" open
// item -- this is the first verified increment of that spec, same
// build-the-pure-layer-first order the dated-stock-reconciliation
// feature's batch-FIFO core was built in before its own apply layer).
// Nothing here writes to the DB or renders UI -- it only turns parsed
// rows into a resolved plan a caller can review/act on, matching every
// other *Resolve.ts / *Planner.ts file in this app's import system.

// ---- Sale-grouping ("actions" column) ----
//
// A new template column (named e.g. `sale1`/`sale2` by convention, but
// any non-empty string works the same way) lets multiple rows in the
// same import file be bundled into ONE sales receipt when they were
// sold together to the same customer -- rows sharing the same action
// label become line items of the same sale. A row with no label still
// becomes its own sale, just not bundled with anything else. Matching
// is case/whitespace-insensitive so "Sale1" and " sale1 " land in the
// same group.

export interface AddSaleImportRow {
  [key: string]: unknown
  name?: string
  barcode?: string
  sku?: string
  branch?: string
  action?: string
  quantity?: string | number | null
  cost_price_usd?: string | number | null
  cost_price_khr?: string | number | null
  selling_price_usd?: string | number | null
  selling_price_khr?: string | number | null
  discount?: string | number | null
  fees?: string | number | null
  customer?: string
}

export interface AddSaleGroup {
  // The normalized label rows in this group shared, or null for an
  // ungrouped row that forms its own singleton sale.
  actionLabel: string | null
  // Indexes into the original `rows` array passed to
  // groupAddSaleImportRows, in their original file order.
  rowIndexes: number[]
}

function normalizeActionLabel(value: unknown): string | null {
  const trimmed = String(value ?? '').trim().toLowerCase()
  return trimmed.length ? trimmed : null
}

export function groupAddSaleImportRows(rows: AddSaleImportRow[]): AddSaleGroup[] {
  const groups: AddSaleGroup[] = []
  const labelToGroupIndex = new Map<string, number>()

  rows.forEach((row, rowIndex) => {
    const label = normalizeActionLabel(row.action)
    if (label == null) {
      // No action label: always its own singleton sale, never merged
      // with another unlabeled row even if adjacent in the file.
      groups.push({ actionLabel: null, rowIndexes: [rowIndex] })
      return
    }
    const existingGroupIndex = labelToGroupIndex.get(label)
    if (existingGroupIndex != null) {
      groups[existingGroupIndex].rowIndexes.push(rowIndex)
      return
    }
    labelToGroupIndex.set(label, groups.length)
    groups.push({ actionLabel: label, rowIndexes: [rowIndex] })
  })

  return groups
}

// ---- Cost-price block resolution ----
//
// Per the spec: if a row's cost price is blank, the row can NOT
// silently import -- it must be resolved via a product-matching step
// (pick which existing product this row's cost should come from)
// before the import can proceed. This is a hard block, unlike every
// other optional field in this sub-mode. This function does the
// read-only matching/lookup half of that: given the row and the set
// of existing products, either resolve a real cost (supplied directly,
// or inherited from a matched existing product that already has one)
// or report exactly why it's still blocked, so a review screen can
// render the right message and let a human pick a product for it.

export interface ExistingProductForCostLookup {
  id: number
  barcode?: string | null
  sku?: string | null
  name?: string | null
  cost_price_usd?: number | null
  cost_price_khr?: number | null
}

export type CostPriceBlockReason =
  // No cost supplied, and no existing product matched this row by
  // barcode/sku/name for the review screen to fall back on.
  | 'missing_cost_no_match'
  // No cost supplied; a product WAS matched by barcode/sku/name, but
  // that product has no cost price on file either -- still blocked,
  // now with a candidate the review screen can point at.
  | 'missing_cost_match_has_no_cost'

export interface CostPriceResolution {
  rowIndex: number
  resolved: boolean
  costPriceUsd?: number
  costPriceKhr?: number
  // The existing product this resolution came from or was matched
  // against, whichever applies -- absent when the row supplied its
  // own cost price directly (nothing to match against was needed).
  matchedProductId?: number
  reason?: CostPriceBlockReason
}

function parseOptionalNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const num = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(num) ? num : null
}

function normalizeLookupKey(value: unknown): string | null {
  const trimmed = String(value ?? '').trim().toLowerCase()
  return trimmed.length ? trimmed : null
}

export function resolveAddSaleCostPrices(
  rows: AddSaleImportRow[],
  existingProducts: ExistingProductForCostLookup[],
): CostPriceResolution[] {
  const byBarcode = new Map<string, ExistingProductForCostLookup>()
  const bySku = new Map<string, ExistingProductForCostLookup>()
  const byName = new Map<string, ExistingProductForCostLookup>()
  for (const product of existingProducts) {
    const barcodeKey = normalizeLookupKey(product.barcode)
    const skuKey = normalizeLookupKey(product.sku)
    const nameKey = normalizeLookupKey(product.name)
    // First match wins on a duplicate key -- same convention as every
    // other lookup map in this app's import layer (e.g.
    // productImportPlanner.ts), not expected to matter in practice
    // since barcode/sku are supposed to be unique already.
    if (barcodeKey && !byBarcode.has(barcodeKey)) byBarcode.set(barcodeKey, product)
    if (skuKey && !bySku.has(skuKey)) bySku.set(skuKey, product)
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, product)
  }

  return rows.map((row, rowIndex): CostPriceResolution => {
    const suppliedCostUsd = parseOptionalNumber(row.cost_price_usd)
    if (suppliedCostUsd != null) {
      const suppliedCostKhr = parseOptionalNumber(row.cost_price_khr)
      return {
        rowIndex,
        resolved: true,
        costPriceUsd: suppliedCostUsd,
        ...(suppliedCostKhr != null ? { costPriceKhr: suppliedCostKhr } : {}),
      }
    }

    const match =
      (normalizeLookupKey(row.barcode) && byBarcode.get(normalizeLookupKey(row.barcode) as string)) ||
      (normalizeLookupKey(row.sku) && bySku.get(normalizeLookupKey(row.sku) as string)) ||
      (normalizeLookupKey(row.name) && byName.get(normalizeLookupKey(row.name) as string)) ||
      null

    if (!match) {
      return { rowIndex, resolved: false, reason: 'missing_cost_no_match' }
    }
    if (match.cost_price_usd == null) {
      return { rowIndex, resolved: false, matchedProductId: match.id, reason: 'missing_cost_match_has_no_cost' }
    }
    return {
      rowIndex,
      resolved: true,
      costPriceUsd: match.cost_price_usd,
      ...(match.cost_price_khr != null ? { costPriceKhr: match.cost_price_khr } : {}),
      matchedProductId: match.id,
    }
  })
}

// ---- Product-identity match resolution (for the sale itself) ----
//
// Separate from cost resolution above. A resolved AddSaleGroup line item
// removes stock from a real product, so each row has to resolve to
// exactly one existing product (or be routed to product creation) --
// this is that resolution step.
//
// Per the spec: the match key is identity details (barcode/sku/name,
// plus branch when the row supplies one -- these rows are branch-
// specific) PLUS cost price, which must agree with the candidate's cost
// price. Selling price is deliberately excluded from the match key --
// POS selling price is expected to move sale-to-sale (discounts,
// negotiated price), so it can't be used to decide whether two rows are
// "the same product." Cost price is not expected to move the same way,
// so a cost mismatch against an otherwise-matching candidate means it
// isn't actually the same product/batch -- it does NOT silently pick a
// candidate the way the cost-block fallback does for a *missing* cost;
// the row is reported unresolved with the conflicting candidate(s) so a
// review screen can let the user either pick one of them anyway or
// create a new product/variant.
//
// A resolved match here never writes anything back to the product
// record -- selling price on a matched row only ever affects the sale
// itself (its line item, and the inventory movement / stats / reports
// derived from that sale), same as a POS cart price override. The only
// way a product's own stored selling price changes is an explicit edit
// on the Products page.

export interface ExistingProductForMatchLookup {
  id: number
  barcode?: string | null
  sku?: string | null
  name?: string | null
  branch?: string | null
  cost_price_usd?: number | null
  cost_price_khr?: number | null
}

export type ProductMatchBlockReason =
  // No candidate shared this row's identity (barcode/sku/name + branch)
  // at all.
  | 'no_identity_match'
  // One or more candidates matched identity, but none of them had a
  // cost price agreeing with this row's resolved cost.
  | 'cost_price_mismatch'
  // This row's cost price isn't resolved yet (see
  // resolveAddSaleCostPrices) -- product matching can't run until the
  // hard cost-price block clears.
  | 'cost_unresolved'

export interface ProductMatchResolution {
  rowIndex: number
  matched: boolean
  matchedProductId?: number
  reason?: ProductMatchBlockReason
  // Candidate product ids that matched identity but not cost, present
  // only for the cost_price_mismatch reason -- a review screen can
  // offer these as "use this one anyway" picks alongside "create new."
  conflictingCandidateIds?: number[]
}

// Cost prices arrive as parsed floats from CSV/XLSX; treat sub-cent
// differences as equal rather than requiring exact float equality.
const COST_PRICE_EPSILON = 0.005

function costPricesAgree(rowCost: number, candidateCost: number | null | undefined): boolean {
  if (candidateCost == null) return false
  return Math.abs(rowCost - candidateCost) < COST_PRICE_EPSILON
}

export function resolveAddSaleProductMatches(
  rows: AddSaleImportRow[],
  resolvedCosts: CostPriceResolution[],
  existingProducts: ExistingProductForMatchLookup[],
): ProductMatchResolution[] {
  const byBarcode = new Map<string, ExistingProductForMatchLookup[]>()
  const bySku = new Map<string, ExistingProductForMatchLookup[]>()
  const byName = new Map<string, ExistingProductForMatchLookup[]>()

  const indexBy = (
    map: Map<string, ExistingProductForMatchLookup[]>,
    key: string | null,
    product: ExistingProductForMatchLookup,
  ) => {
    if (!key) return
    const existing = map.get(key)
    if (existing) existing.push(product)
    else map.set(key, [product])
  }

  for (const product of existingProducts) {
    indexBy(byBarcode, normalizeLookupKey(product.barcode), product)
    indexBy(bySku, normalizeLookupKey(product.sku), product)
    indexBy(byName, normalizeLookupKey(product.name), product)
  }

  return rows.map((row, rowIndex): ProductMatchResolution => {
    const costResolution = resolvedCosts[rowIndex]
    if (!costResolution || !costResolution.resolved || costResolution.costPriceUsd == null) {
      return { rowIndex, matched: false, reason: 'cost_unresolved' }
    }
    const rowCost = costResolution.costPriceUsd
    const rowBranchKey = normalizeLookupKey(row.branch)

    // Priority order matches resolveAddSaleCostPrices: barcode, then
    // sku, then name.
    const tiers = [
      normalizeLookupKey(row.barcode) ? byBarcode.get(normalizeLookupKey(row.barcode) as string) : undefined,
      normalizeLookupKey(row.sku) ? bySku.get(normalizeLookupKey(row.sku) as string) : undefined,
      normalizeLookupKey(row.name) ? byName.get(normalizeLookupKey(row.name) as string) : undefined,
    ]

    const conflicting = new Set<number>()
    for (const candidates of tiers) {
      if (!candidates || candidates.length === 0) continue
      const inBranch = rowBranchKey
        ? candidates.filter((candidate) => normalizeLookupKey(candidate.branch) === rowBranchKey)
        : candidates
      if (inBranch.length === 0) continue

      const costMatch = inBranch.find((candidate) => costPricesAgree(rowCost, candidate.cost_price_usd))
      if (costMatch) {
        return { rowIndex, matched: true, matchedProductId: costMatch.id }
      }
      inBranch.forEach((candidate) => conflicting.add(candidate.id))
    }

    if (conflicting.size > 0) {
      return {
        rowIndex,
        matched: false,
        reason: 'cost_price_mismatch',
        conflictingCandidateIds: Array.from(conflicting),
      }
    }
    return { rowIndex, matched: false, reason: 'no_identity_match' }
  })
}
