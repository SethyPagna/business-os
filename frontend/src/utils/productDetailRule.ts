// THE product identity rule. One definition, imported everywhere, so the
// answer to "are these two rows the same product?" can never differ between
// CSV import, branch transfer, merge-duplicates and the Products page.
//
// Before this module existed the rule was implemented three separate times
// and all three disagreed:
//   * importEngine.ts matched on name + cost + selling price + barcode
//     (special price missing entirely);
//   * productIdentity.ts compared `purchase_price_*` -- columns that import
//     and the manual form never write, so they were always 0 and the cost
//     half of every transfer/merge comparison silently did nothing;
//   * the frontend's mergeSameDetailRows compared EVERY field minus a
//     seven-item ignore list, so unit, category, brand, supplier and
//     description all acted as identity.
//
// ---------------------------------------------------------------------------
// THE RULE
// ---------------------------------------------------------------------------
// Products are grouped by NAME. The group's title is the name; the rows
// inside it are the real product rows.
//
// Within one name group, a row is a distinct CHILD ROW when its DETAILS
// differ. Details are exactly two things:
//
//   * barcode  -- a different barcode is a different physical article.
//
// Cost is NOT a detail. Until Sep 4 2026 it was, on the reasoning that real
// money out must never be silently averaged -- and that produced the fault
// the user reported: one article bought twice at two prices rendered as two
// child rows forever, so the shelf showed a product twice and the POS had to
// invent "#7321 / #7322" labels to tell the twins apart. The user's ruling
// (Sep 4 2026, verbatim): "all products if cost is different add different
// costs together and divide by the number different costs... keep 4 decimal
// digits always round up to 4 decimal digits... so now only diffeerent
// barcode creates new child row... rest merge".
//
// So differing costs now MERGE, and the merged cost is the mean of the
// DISTINCT costs (see resolveMergedCost), kept to 4 decimals and rounded up.
// Rounded up, never down, so an averaged cost can never understate what was
// actually paid and quietly overstate profit.
//
// The averaging applies to costs that are ALIKE. The owner's follow-up ruling
// (2026-09-04, verbatim): "the add and divide is only for those similar
// costs...not the 0 cost etc...". A 0 is not a cost at all and is excluded;
// and two figures more than COST_OUTLIER_RATIO apart are one cost and one
// probable typo, so the dearest is kept rather than a mean nobody ever paid.
// Both halves live in resolveMergedCostDetail, which reports the refusal
// instead of applying it silently.
//
// Selling price and special price are likewise NOT details. They are
// what we plan to charge, they are adjusted for sales/POS, and two rows
// differing only in what we hope to sell for are the same product. When
// rows merge and disagree on them, the HIGHEST wins -- never a lower price
// than some row expected to charge. (The public storefront already applied
// exactly this rule; it is now the rule everywhere.)
//
// Nothing else is ever a detail: not unit, category, brand, supplier, sku,
// description, thresholds, discounts or expiry. Branch is never identity
// either -- `products` is one global table and `branch_stock` is the only
// per-branch thing, so one product carries stock at many branches.
//
// Batches are a separate concern and do NOT participate in ordinary catalog
// identity: a batch records WHEN stock arrived so older stock sells first
// (FIFO) and new and old stock don't get mixed. The receiving paths have one
// narrow exception: another receipt with the same non-blank barcode and the
// exact same evidenced batch may share the existing option, while its own
// historical unit/total cost stays on that receipt movement and accumulated
// batch cost. It never replaces the option's catalog cost. Without that exact
// batch evidence, a cost difference remains a product-row difference.

/** Normalized grouping key for a product name: trim, collapse internal whitespace, lowercase. */
export function normalizeProductGroupName(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * FUZZY name key -- a stronger normalization than normalizeProductGroupName,
 * for surfacing "same item, different name" duplicates a human should review
 * (NEVER for auto-merge). On top of trim/collapse/lowercase it:
 *   - strips diacritics (café == cafe),
 *   - turns every run of non-alphanumeric into a token break, so punctuation
 *     and separators stop mattering (Setting-Spray == Setting Spray,
 *     L'Oreal == L Oreal),
 *   - sorts the resulting tokens and drops duplicate tokens, so word ORDER
 *     stops mattering (Day Face Cream == Cream Face Day).
 *
 * Deliberately precision-over-recall: it does NOT split digit/letter runs
 * (so "100ml" and "100 ml" stay different, as do genuinely different sizes),
 * drop "noise"/unit words, or do edit-distance matching -- each of those
 * would over-merge distinct SKUs into one review cluster. What it catches is
 * the common real case: the same name re-typed with different punctuation,
 * spacing, accents or word order. Returns '' for a name with no alphanumerics.
 */
export function normalizeProductFuzzyName(value: unknown): string {
  const base = String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  if (!base) return ''
  const tokens = base.split(/\s+/).filter(Boolean)
  return [...new Set(tokens)].sort().join(' ')
}

function normalizedBarcode(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

/**
 * THE leading-zero barcode fold -- the one normalization every comparison
 * site shares. It lives HERE, in the module both packages carry verbatim,
 * because the rule physically existed three times before (the Worker
 * detector, the Conflicts tab and nowhere else at all) and this codebase has
 * already been bitten by one rule with three implementations that disagreed.
 *
 * The owner's ruling (Sep 4 2026, verbatim): "for same products same barcode
 * the only difference is a leading zero... remove the leading zero and merge
 * them". Three properties make that safe to act on automatically:
 *
 *   * IDEMPOTENT -- strips EVERY leading zero, not one. Stripping exactly one
 *     applies to both sides of a pair and moves them in lockstep, so
 *     '08339327539' and '008339327539' (one real Charlotte Tilbury barcode,
 *     entered twice) never meet. Three such pairs exist in production.
 *   * NUMERIC ONLY -- a code containing any non-digit keeps its zeros, since a
 *     leading zero in an alphanumeric SKU is not a GTIN artefact.
 *   * MINIMUM LENGTH 3 -- if stripping would leave fewer than three digits the
 *     original is returned untouched. That is what keeps '0', '00' and '0000'
 *     (238 production rows carry the placeholder "0") from collapsing to a
 *     blank barcode and colliding with every unbarcoded row. The bound was 4
 *     until the owner ruled on 2026-09-04 that the five MAC shade-code pairs
 *     ('0601'/'601', and the same for 617, 666, 689, 691) must merge; measured
 *     against production first, those ten rows are the ONLY numeric barcodes
 *     in the catalogue whose zero-stripped form is exactly three digits.
 *
 * Narrow by construction: it only ever removes leading zeros, so '1234' and
 * '12345' are untouched and can never fold together. GTIN-14 uses a leading
 * indicator digit of 1-8 for a case/carton and 0 for the plain unit, so
 * folding zeros can never conflate a carton with a single item.
 *
 * COMPARISON ONLY -- nothing anywhere rewrites the stored barcode column. The
 * merge picks the already-clean row as the survivor instead, which matters:
 * 27 zero-stripped barcodes in production are also carried, in their already-
 * stripped form, by a product under a DIFFERENT name, so rewriting barcodes in
 * place would hand those 27 a duplicate of a live code and make a scan
 * ambiguous. Picking the clean row as survivor cannot.
 *
 * Deliberately NOT the same fold as the SEARCH one (searchMatch.ts's
 * normalizedBarcodeSql): search ltrims zeros unboundedly so a scan of either
 * twin finds both rows, and is allowed to be looser because finding a row is
 * reversible and merging two rows is not.
 */
export function normalizeLeadingZeroBarcodeForCleanup(value: unknown): string {
  const barcode = String(value ?? '').trim().toLowerCase()
  if (!/^[0-9]+$/.test(barcode)) return barcode
  const stripped = barcode.replace(/^0+/, '')
  return stripped.length >= 3 ? stripped : barcode
}

/**
 * The barcode as IDENTITY compares it: trimmed, lowercased, and folded past
 * any leading zeros. Every comparison site -- display grouping, the Conflicts
 * sweep, the create/edit duplicate guard, transfer and add-stock matching, CSV
 * import and the auto-merge detector -- reaches the fold through this one
 * function, so a twin can never be one product on one screen and two on the
 * next.
 */
export function identityBarcodeKey(value: unknown): string {
  return normalizeLeadingZeroBarcodeForCleanup(normalizedBarcode(value))
}

export type ProductDetailInput = {
  barcode?: unknown
  cost_price_usd?: unknown
  cost_price_khr?: unknown
}

/**
 * The DETAIL signature: the barcode, and nothing else. Two rows sharing a
 * name and this signature are the same product and must merge into one row;
 * two rows sharing a name but not this signature are sibling child rows
 * inside that name's group.
 *
 * Deliberately excludes cost (merged by averaging instead -- see
 * resolveMergedCost) and selling/wholesale price -- see the rule above.
 *
 * The barcode is compared through identityBarcodeKey, so a pair differing
 * only by a leading zero is ONE product everywhere -- the owner's N15 ruling.
 * The stored column is never rewritten; only the comparison folds.
 */
export function productDetailSignature(row: ProductDetailInput): string {
  return identityBarcodeKey(row.barcode)
}

/**
 * Full identity signature: name group + details. This is what decides
 * "same product row" outright.
 */
export function productIdentitySignature(row: ProductDetailInput & { name?: unknown }): string {
  return `${normalizeProductGroupName(row.name)}${productDetailSignature(row)}`
}

/** True when two rows are the same product row (same name group AND same details). */
export function isSameProductIdentity(
  a: ProductDetailInput & { name?: unknown },
  b: ProductDetailInput & { name?: unknown },
): boolean {
  return productIdentitySignature(a) === productIdentitySignature(b)
}

export type CostVerdict = 'same' | 'missing' | 'differs'

export function compareCostField(a: unknown, b: unknown): CostVerdict {
  const asCents = (value: unknown) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
  }
  const aCents = asCents(a)
  const bCents = asCents(b)
  if (aCents === 0 && bCents === 0) return 'same'
  if (aCents === 0 || bCents === 0) return 'missing'
  return aCents === bCents ? 'same' : 'differs'
}

export function compareCosts(a: ProductDetailInput, b: ProductDetailInput): CostVerdict {
  const usd = compareCostField(a.cost_price_usd, b.cost_price_usd)
  const khr = compareCostField(a.cost_price_khr, b.cost_price_khr)
  if (usd === 'differs' || khr === 'differs') return 'differs'
  if (usd === 'missing' || khr === 'missing') return 'missing'
  return 'same'
}

/** The cost fields that merge by averaging rather than by splitting a row. */
export type MergeableCost = {
  cost_price_usd?: unknown
  cost_price_khr?: unknown
}

/**
 * Rounds UP to 4 decimal places. Up rather than nearest so an averaged cost
 * never lands below what was actually paid: understating cost overstates
 * profit, and this number feeds margin reporting.
 *
 * The 1e-9 nudge absorbs binary float error, so a value that is already
 * exactly 4dp (9.8765, or the 4dp mean of two 4dp costs) is not pushed up a
 * tick by its own representation -- without it, Math.ceil(9.8765 * 10000)
 * can be 98766 on a value whose double sits a hair above 98765.
 *
 * That same nudge is why the result is normalised at the end: Math.ceil of a
 * small negative is -0, so a cost of 0 would come back as -0 and be stored
 * and serialised as "-0". `|| 0` maps it back to 0 and touches nothing else,
 * every other falsy case having already returned above.
 */
export function roundCostUp4(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.ceil(n * 10000 - 1e-9) / 10000 || 0
}

/**
 * The ratio between the cheapest and the dearest DISTINCT recorded cost above
 * which averaging is refused -- see resolveMergedCostDetail.
 *
 * MEASURED, NOT TUNED. Across the 353 active merge-candidate name groups in
 * production on 2026-09-04: 258 groups have one costed row or none (nothing to
 * average), 79 agree within 10%, 15 within 50%, exactly 1 spreads up to 3x, and
 * 0 spread further. The widest genuine pair is 1.58x -- "maybelline concealer
 * eraser n.110" at $5.00 and $7.90, alongside a Charlotte eyeshadow at $27 vs
 * $38 and three Estee Lauder Double Wear shades: every one of them the same
 * article restocked at a different supplier price, exactly what the mean is
 * for. So at 2x this guard fires on NOTHING in today's catalogue. It is purely
 * a FORWARD guard against a mistyped cost (a $2 item entered as $200) turning
 * into a $101 number nobody ever paid. Do not "tune" it down towards the real
 * data -- the real data is what it must never fire on.
 */
export const COST_OUTLIER_RATIO = 2

/** One field whose distinct costs were too far apart to average -- see resolveMergedCostDetail. */
export type MergedCostOutlier = {
  field: keyof MergeableCost
  /** Cheapest distinct recorded cost seen. */
  min: number
  /** Dearest distinct recorded cost seen -- and what was stored. */
  max: number
  /** The value written, i.e. `max`. Named separately so the shape survives a later policy change. */
  chosen: number
}

/**
 * Resolves the cost for a merge: the mean of the DISTINCT costs across the
 * rows, per currency field, rounded up to 4 decimals -- and reports any field
 * where the guard below refused to average.
 *
 * Distinct, not per-row, because the user's rule is "add different costs
 * together and divide by the number different costs" -- ten rows at $4 and
 * one at $5 average to $4.50, not $4.09. Each currency field is resolved
 * independently.
 *
 * A cost of 0 is treated as NOT RECORDED and is excluded from the mean.
 * Both cost columns are `DEFAULT 0` and every importer writes 0 when the
 * source has no cost, so 0 is this schema's "unset", not a free item. Were
 * it averaged in, merging a $50.70 row with a legacy 0-cost row would halve
 * the cost and double the reported profit. If no row carries a cost, the
 * result is 0 -- unchanged from what every row already said.
 *
 * SIMILARITY GUARD (owner ruling, 2026-09-04: "the add and divide is only for
 * those similar costs... not the 0 cost etc"). The 0 half is the exclusion
 * above. The other half is here: when the dearest distinct cost is more than
 * COST_OUTLIER_RATIO times the cheapest, the two figures are not two prices
 * for one article, they are one figure and one probable mistake -- and the
 * mean of $5 and a mistyped $200 is $102.50, a number nobody ever paid for
 * anything. Above the threshold the HIGHEST is stored instead, on the same
 * reasoning as roundCostUp4 rounding up: understating cost overstates profit,
 * so when the rule cannot know which figure is real it must not pick the one
 * that flatters the margin. The refusal is reported in `outliers` rather than
 * being silent -- a merge that quietly rewrote a cost is precisely the failure
 * mode this guard exists to make visible.
 *
 * `merged` carries only the fields at least one row actually carried, so the
 * result can be spread over an existing row without clobbering it with zeros.
 */
export function resolveMergedCostDetail(rows: MergeableCost[]): {
  merged: Partial<Record<keyof MergeableCost, number>>
  outliers: MergedCostOutlier[]
} {
  const fields: (keyof MergeableCost)[] = ['cost_price_usd', 'cost_price_khr']
  const merged: Partial<Record<keyof MergeableCost, number>> = {}
  const outliers: MergedCostOutlier[] = []
  for (const field of fields) {
    const distinct = new Set<number>()
    let sawField = false
    for (const row of rows) {
      const raw = row?.[field]
      if (raw === undefined || raw === null || raw === '') continue
      const value = Number(raw)
      if (!Number.isFinite(value)) continue
      sawField = true
      if (value > 0) distinct.add(roundCostUp4(value))
    }
    if (!sawField) continue
    if (!distinct.size) { merged[field] = 0; continue }
    const values = [...distinct]
    const min = Math.min(...values)
    const max = Math.max(...values)
    if (values.length > 1 && max > min * COST_OUTLIER_RATIO) {
      merged[field] = max
      outliers.push({ field, min, max, chosen: max })
      continue
    }
    let sum = 0
    for (const value of values) sum += value
    merged[field] = roundCostUp4(sum / values.length)
  }
  return { merged, outliers }
}

/**
 * The merged costs alone, for the many callers that only spread the result
 * over a row. Callers that can SHOW the operator something -- the importer's
 * per-row warnings, the merge endpoints' audit entry and response -- should
 * call resolveMergedCostDetail and surface `outliers` instead of this.
 */
export function resolveMergedCost(rows: MergeableCost[]): Partial<Record<keyof MergeableCost, number>> {
  return resolveMergedCostDetail(rows).merged
}

export type MergeablePricing = {
  selling_price_usd?: unknown
  selling_price_khr?: unknown
  wholesale_price_usd?: unknown
  wholesale_price_khr?: unknown
}

/**
 * Resolves the selling and wholesale prices for a merge, taking the HIGHEST
 * of each across the rows involved.
 *
 * Highest rather than first-seen because these are customer-facing prices:
 * merging must never quietly drop a product to a lower price than one of
 * the merged rows expected to charge. Each of the four fields is resolved
 * independently, so a row with the best selling price and another with the
 * best wholesale price both contribute.
 *
 * The discounted tier is `wholesale_price_usd/khr`, NOT the retired
 * `special_price_usd/khr` pair this used to name. The 2026-09-04 owner ruling
 * established that the tier the app called "VIP" was always the wholesale
 * (បោះដុំ) price, and migration 0111 copied the numbers across and zeroed the
 * old columns, keeping them only as inert ballast for stale PWA till tabs.
 * While this list still said `special_price_*` the merge resolved the maximum
 * of 0 and 0: a folded-away duplicate's wholesale price was deactivated with
 * its row and vanished from the catalogue, silently. Never point this list
 * back at the dead pair.
 *
 * Returns only the fields that at least one row actually carried, so a
 * caller can spread the result over an existing row without clobbering
 * unrelated columns with zeros.
 */
export function resolveMergedPricing(rows: MergeablePricing[]): Partial<Record<keyof MergeablePricing, number>> {
  const fields: (keyof MergeablePricing)[] = [
    'selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr',
  ]
  const merged: Partial<Record<keyof MergeablePricing, number>> = {}
  for (const field of fields) {
    let best: number | null = null
    for (const row of rows) {
      const raw = row?.[field]
      if (raw === undefined || raw === null || raw === '') continue
      const value = Number(raw)
      if (!Number.isFinite(value)) continue
      if (best === null || value > best) best = value
    }
    if (best !== null) merged[field] = best
  }
  return merged
}
