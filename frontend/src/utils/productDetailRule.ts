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
//   * cost     -- what was actually spent to buy the item. This is real
//                 money out and must never be silently averaged, replaced
//                 or guessed, so two rows bought at different costs stay
//                 separate rows.
//
// Selling price and special price are deliberately NOT details. They are
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

/** Integer cents, so float noise from CSV round-tripping can't fake a difference. */
function cents(value: unknown): number {
  return Math.round((Number(value) || 0) * 100)
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
 * The DETAIL signature: barcode + cost. Two rows sharing a name and this
 * signature are the same product and must merge into one row; two rows
 * sharing a name but not this signature are sibling child rows inside that
 * name's group.
 *
 * Deliberately excludes selling/special price -- see the rule above.
 */
export function productDetailSignature(row: ProductDetailInput): string {
  return [
    normalizedBarcode(row.barcode),
    cents(row.cost_price_usd),
    cents(row.cost_price_khr),
  ].join('')
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

/**
 * The cost ruling that sits ON TOP of productDetailSignature without changing
 * it: a cost of 0 or NULL means MISSING, not "a different cost".
 *
 * Per cost field (USD and KHR judged independently):
 *   'same'     -- both sides agree (both set and equal, or both missing);
 *   'missing'  -- exactly one side has no cost recorded, so the two rows do
 *                 NOT disagree: they are the same product and the survivor of
 *                 a merge keeps the real cost;
 *   'differs'  -- BOTH sides carry a cost and the costs differ. Only this is a
 *                 real detail difference, and it is REVIEW ONLY: never
 *                 auto-merged, always shown with both costs and both stock
 *                 lines.
 *
 * productDetailSignature stays the exact-detail key (it still says a missing
 * cost is a different signature, so the sibling-row grouping in the product
 * list is unchanged); this verdict is what merge eligibility and the manual
 * create/edit guard read.
 */
export type CostVerdict = 'same' | 'missing' | 'differs'

/** A cost of 0 or NULL is not a value -- nobody has recorded one yet. */
export function costIsMissing(value: unknown): boolean {
  return cents(value) === 0
}

export function compareCostField(a: unknown, b: unknown): CostVerdict {
  const aMissing = costIsMissing(a)
  const bMissing = costIsMissing(b)
  if (aMissing && bMissing) return 'same'
  if (aMissing !== bMissing) return 'missing'
  return cents(a) === cents(b) ? 'same' : 'differs'
}

/** The pair's overall cost verdict: 'differs' if EITHER field differs with both sides set. */
export function compareCosts(a: ProductDetailInput, b: ProductDetailInput): CostVerdict {
  const usd = compareCostField(a.cost_price_usd, b.cost_price_usd)
  const khr = compareCostField(a.cost_price_khr, b.cost_price_khr)
  if (usd === 'differs' || khr === 'differs') return 'differs'
  if (usd === 'missing' || khr === 'missing') return 'missing'
  return 'same'
}

/**
 * Same barcode and costs that do not disagree ('same' or 'missing'): the two
 * rows are ONE product for merge purposes. This is the detail half of the
 * merge-eligibility rule; the caller pairs it with normalizeProductGroupName.
 */
export function detailsMergeCompatible(a: ProductDetailInput, b: ProductDetailInput): boolean {
  return normalizedBarcode(a.barcode) === normalizedBarcode(b.barcode) && compareCosts(a, b) !== 'differs'
}

/**
 * The cost fields a merge survivor takes from the discarded row: those where
 * the survivor has no cost recorded and the discarded row has one. Empty when
 * nothing is missing, and NEVER filled when both sides are set (a real
 * difference is the operator's to resolve, not the fold's to average away).
 */
export function costFillFromDiscarded(
  survivor: ProductDetailInput,
  discarded: ProductDetailInput,
): Array<{ field: 'cost_price_usd' | 'cost_price_khr'; value: number }> {
  const fill: Array<{ field: 'cost_price_usd' | 'cost_price_khr'; value: number }> = []
  for (const field of ['cost_price_usd', 'cost_price_khr'] as const) {
    if (costIsMissing(survivor[field]) && !costIsMissing(discarded[field])) {
      fill.push({ field, value: cents(discarded[field]) / 100 })
    }
  }
  return fill
}

export type MergeablePricing = {
  selling_price_usd?: unknown
  selling_price_khr?: unknown
  special_price_usd?: unknown
  special_price_khr?: unknown
}

/**
 * Resolves the selling/special prices for a merge, taking the HIGHEST of
 * each across the rows involved.
 *
 * Highest rather than first-seen because these are customer-facing prices:
 * merging must never quietly drop a product to a lower price than one of
 * the merged rows expected to charge. Each of the four fields is resolved
 * independently, so a row with the best selling price and another with the
 * best special price both contribute.
 *
 * Returns only the fields that at least one row actually carried, so a
 * caller can spread the result over an existing row without clobbering
 * unrelated columns with zeros.
 */
export function resolveMergedPricing(rows: MergeablePricing[]): Partial<Record<keyof MergeablePricing, number>> {
  const fields: (keyof MergeablePricing)[] = [
    'selling_price_usd', 'selling_price_khr', 'special_price_usd', 'special_price_khr',
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
