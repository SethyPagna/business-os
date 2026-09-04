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
 */
export function productDetailSignature(row: ProductDetailInput): string {
  return normalizedBarcode(row.barcode)
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
 * Resolves the cost for a merge: the mean of the DISTINCT costs across the
 * rows, per currency field, rounded up to 4 decimals.
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
 * Returns only the fields at least one row actually carried, so the result
 * can be spread over an existing row without clobbering it with zeros.
 */
export function resolveMergedCost(rows: MergeableCost[]): Partial<Record<keyof MergeableCost, number>> {
  const fields: (keyof MergeableCost)[] = ['cost_price_usd', 'cost_price_khr']
  const merged: Partial<Record<keyof MergeableCost, number>> = {}
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
    let sum = 0
    for (const value of distinct) sum += value
    merged[field] = roundCostUp4(sum / distinct.size)
  }
  return merged
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
