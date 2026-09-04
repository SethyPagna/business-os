import type { D1Compat } from './db'
import { buildInClause, selectInChunks } from './sqlBinding'
import { productDetailSignature, normalizeProductGroupName, normalizeProductFuzzyName } from './productDetailRule'

// Applies THE product identity rule (lib/productDetailRule.ts) at branch-
// transfer, add-stock and merge-duplicates time, so those paths reach the
// same verdict CSV import does.
//
// This file used to spell the rule out itself, and got it wrong in a way
// nothing caught: it compared `purchase_price_usd/khr`, but import and the
// manual Add/Edit form only ever write `cost_price_usd/khr`. Those columns
// default to 0 (migrations/0001_init.sql), so for every import-created or
// form-created product the cost half of the comparison was `0 === 0` -- a
// silent no-op. Two products with genuinely different costs were reported
// as mergeable duplicates. Delegating to the shared rule fixes that and
// means the definition can only ever be changed in one place.

function nameKeyOf(value: unknown): string {
  return normalizeProductGroupName(value)
}

export type ProductIdentityRow = {
  id: number
  name: string | null
  barcode: string | null
  // The columns import and the manual form actually write. `purchase_price_*`
  // is a legacy pair that stays at its 0 default on every real row, which is
  // why comparing it here was a no-op -- see the note at the top of this file.
  cost_price_usd: number | null
  cost_price_khr: number | null
  selling_price_usd: number | null
  selling_price_khr: number | null
  // Live aggregate from branch_stock. Used only to choose the survivor during
  // catalog cleanup; stock is never part of product identity.
  live_stock_quantity?: number
  // Not part of the identity comparison -- carried so merge-duplicates can
  // move a duplicate's primary image onto the canonical row instead of
  // orphaning it on a row it is about to deactivate.
  image_path?: string | null
}

/**
 * Cleanup-only barcode normalization for the import typo the production audit
 * found: the same real barcode entered once normally and once with extra
 * leading zeros. Placeholder/short barcodes stay untouched, and this helper is
 * deliberately not used by ordinary create/transfer identity matching.
 *
 * The owner's ruling (Sep 4 2026, verbatim): "for same products same barcode
 * the only difference is a leading zero... remove the leading zero and merge
 * them". Three properties make that safe to act on automatically:
 *
 *   * IDEMPOTENT -- strips EVERY leading zero, not one. Stripping exactly one
 *     was the original bug: applied to both sides of a pair it moves them in
 *     lockstep and they never meet, so `08339327539` and `008339327539` (one
 *     real Charlotte Tilbury barcode, entered twice) stayed two child rows
 *     forever. Three such pairs exist in production; `ltrim`-style stripping
 *     converges them because the result never begins with a zero.
 *   * NUMERIC ONLY -- a code containing any non-digit keeps its zeros, since a
 *     leading zero in an alphanumeric SKU is not a GTIN artefact.
 *   * MINIMUM LENGTH 4 -- if stripping would leave fewer than four digits the
 *     original is returned untouched. This is what keeps the placeholder codes
 *     safe ('0' stays '0' rather than collapsing to a blank barcode, which
 *     would make it collide with every unbarcoded row) and what keeps the MAC
 *     shade codes ('0601' vs '601') out of automatic merging.
 *
 * Narrow by construction: it only ever removes leading zeros, so `1234` and
 * `12345` are untouched and can never fold together. Because the fold is
 * applied on top of an EXACT name match, and because GTIN-14 uses a leading
 * indicator digit of 1-8 for a case/carton and 0 for the plain unit, folding
 * zeros can never conflate a carton with a single item.
 *
 * COMPARISON ONLY -- nothing here rewrites the stored barcode column. See the
 * bucketing in findDuplicateProductGroups: the already-clean row is chosen as
 * the survivor and the extra-zero row is folded into it, so the catalog ends
 * up with the clean barcode without any UPDATE to a barcode ever being issued.
 * That matters -- 27 zero-stripped barcodes in production are also carried, in
 * their already-stripped form, by a product under a DIFFERENT name. Rewriting
 * barcodes in place would hand those 27 a duplicate of a live code and make a
 * scan ambiguous; picking the clean row as survivor cannot.
 */
export function normalizeLeadingZeroBarcodeForCleanup(value: unknown): string {
  const barcode = String(value ?? '').trim().toLowerCase()
  if (!/^[0-9]+$/.test(barcode)) return barcode
  const stripped = barcode.replace(/^0+/, '')
  return stripped.length >= 4 ? stripped : barcode
}

// Finds another ACTIVE product row that is genuinely the same item as
// `source` (excluding source itself): same name_key, cost, and barcode.
// Selling/special prices are mergeable fields and never identity. Returns
// null when nothing else in the catalog matches --
// the ordinary, unambiguous case, where a transfer is simply the same
// product_id gaining a branch_stock row at the destination branch, no
// different from before this existed. Deterministic when more than one
// candidate matches (picks the lowest id) so repeated transfers of the
// same duplicate-riddled catalog always converge on the same target
// instead of bouncing between equally-valid candidates.
export async function findIdentityMatch(
  db: D1Compat,
  source: ProductIdentityRow,
): Promise<ProductIdentityRow | null> {
  const nameKey = nameKeyOf(source.name)
  if (!nameKey) return null
  const candidates = await db
    .prepare(`
      SELECT id, name, barcode, cost_price_usd, cost_price_khr, selling_price_usd, selling_price_khr
      FROM products
      WHERE id != @id AND name_key = @nameKey AND is_active = 1
      ORDER BY id ASC
    `)
    .all<ProductIdentityRow>({ id: source.id, nameKey })
  for (const candidate of candidates) {
    if (productDetailSignature(candidate) === productDetailSignature(source)) return candidate
  }
  return null
}

// Batched counterpart for the bulk transfer route -- one query for every
// source product instead of N. Returns a Map keyed by source product id;
// a source with no match is simply absent from the map (callers should
// treat a missing entry the same as findIdentityMatch returning null).
export async function findIdentityMatches(
  db: D1Compat,
  sources: ProductIdentityRow[],
): Promise<Map<number, ProductIdentityRow>> {
  const result = new Map<number, ProductIdentityRow>()
  const nameKeys = [...new Set(sources.map((s) => nameKeyOf(s.name)).filter(Boolean))]
  if (!nameKeys.length) return result
  // `sources` is a whole transfer/import batch, so this list is unbounded
  // against D1's 100-bound-parameter limit. ORDER BY id survives chunking
  // because callers group by name_key and only compare within a group,
  // and a name_key's rows never split across chunks.
  const candidates = await selectInChunks(nameKeys, 0, (chunk) => {
    const { sql, params } = buildInClause('nk', chunk)
    return db
      .prepare(`
        SELECT id, name, barcode, cost_price_usd, cost_price_khr, selling_price_usd, selling_price_khr, name_key
        FROM products
        WHERE name_key IN (${sql}) AND is_active = 1
        ORDER BY id ASC
      `)
      .all<ProductIdentityRow & { name_key: string }>(params)
  })
  const candidatesByNameKey = new Map<string, (ProductIdentityRow & { name_key: string })[]>()
  for (const candidate of candidates) {
    if (!candidatesByNameKey.has(candidate.name_key)) candidatesByNameKey.set(candidate.name_key, [])
    candidatesByNameKey.get(candidate.name_key)!.push(candidate)
  }
  for (const source of sources) {
    const nameKey = nameKeyOf(source.name)
    if (!nameKey) continue
    const pool = candidatesByNameKey.get(nameKey) || []
    for (const candidate of pool) {
      if (candidate.id === source.id) continue
      if (productDetailSignature(candidate) === productDetailSignature(source)) { result.set(source.id, candidate); break }
    }
  }
  return result
}

// Standalone counterpart to findIdentityMatches for /api/products/merge-
// duplicates: instead of resolving one source product against the rest of
// the catalog (transfer-time), this scans every ACTIVE product up front and
// buckets them into identity-duplicate groups (same name_key + cost +
// barcode), independent of any transfer happening. Selling/special prices
// are mergeable and the highest value is carried by the fold. This is
// the case a plain CSV/branch-column import has always been able to leave
// behind -- two rows for what's really one product, differing only in
// which branch ended up with the branch_stock row -- and which nothing
// upstream cleans up on its own since import only de-dupes within a single
// import batch, not against the whole existing catalog.
export type ProductDuplicateGroup = {
  canonical: ProductIdentityRow
  duplicates: ProductIdentityRow[]
}

// ---------------------------------------------------------------------------
// "Possibly the same" sweep for the Products → Duplicates review section.
// Where findDuplicateProductGroups (below) finds rows PROVABLY identical
// under THE identity rule (name_key + cost + barcode) and is safe
// to auto-merge, this finds the residue only a human can settle -- the
// classes the Aug 30 production audit surfaced:
//  - same_barcode: two+ active products sharing one real barcode but
//    differing in name/price (an EDP/EDT pair, two shades, or the same
//    item entered twice under two naming conventions).
//  - same_name: two+ active products sharing a display name (name_key)
//    with DIFFERENT barcodes -- usually genuinely distinct SKUs (shades /
//    scents), listed for a glance, never auto-merged.
//  - similar_name: two+ active products whose names collapse to the SAME
//    FUZZY key (normalizeProductFuzzyName: diacritics/punctuation/word-order
//    ignored) but to DIFFERENT exact name_keys -- the "same item, re-typed
//    under a slightly different name, each with its own barcode" case the user
//    reported. This is the weakest evidence of the three (a fuzzy name match,
//    not an exact name or a shared barcode), so it sorts last and, like the
//    others, is only ever surfaced for a human to merge or dismiss.
// Nothing here merges anything; the routes let the reviewer merge one
// pair at a time or dismiss a cluster (product_duplicate_dismissals,
// migration 0083 -- same persistence model as the contacts panel).

export type PossiblySameSeverity = 'same_barcode' | 'same_name' | 'similar_name'

export type PossiblySameProductEntry = {
  id: number
  name: string | null
  barcode: string | null
  cost_price_usd: number | null
  cost_price_khr: number | null
  selling_price_usd: number | null
  stock_quantity: number | null
  image_path: string | null
}

export type PossiblySameProductCluster = {
  type: 'barcode' | 'name' | 'similar'
  value: string
  severity: PossiblySameSeverity
  products: PossiblySameProductEntry[]
}

// The old system stamped '0' (and the empty string) on products without a
// real barcode -- 238 such products share barcode "0" in production. Any
// barcode that short cannot identify a product, so it never forms a
// cluster.
const MIN_REAL_BARCODE_LENGTH = 4

// The in-memory dismissal-lookup key: `<type><DELIM><value>`. The delimiter is
// U+0001 (an ASCII control char that can never appear in a barcode or a
// normalized name), and it is REQUIRED -- without it type 'name' + value 'x'
// would collide with type 'na' + value 'mex'. Every key -- the ones built from
// the dismissals table AND the ones each cluster loop tests -- goes through
// this one helper, so a new cluster type can never silently forget the
// delimiter (which would read as "dismissal silently does nothing"). Written as
// String.fromCharCode(1) rather than a literal control char so the source stays
// legible and greppable.
const DISMISS_DELIM = String.fromCharCode(1)
const dismissKey = (type: string, value: string): string => `${type}${DISMISS_DELIM}${value}`

// Dismissals are stored NORMALIZED (trimmed barcode / name_key / fuzzy key) so
// the same cluster matches its dismissal regardless of the display casing the
// panel happened to show at dismiss time -- the same rule the contacts
// panel applies (contactDuplicates.ts's normalized dismissal compare). Each
// cluster type normalizes with the SAME function the sweep keys that type by,
// so a value the panel echoes back (a display name, say) folds to the exact
// stored key: 'barcode' -> trimmed barcode, 'name' -> name_key, 'similar' ->
// fuzzy key.
export function normalizeProductClusterKey(type: 'barcode' | 'name' | 'similar', value: unknown): string {
  if (type === 'barcode') return String(value ?? '').trim()
  if (type === 'similar') return normalizeProductFuzzyName(value)
  return normalizeProductGroupName(value)
}

export async function findPossiblySameProductClusters(db: D1Compat): Promise<PossiblySameProductCluster[]> {
  const [rows, dismissalRows] = await Promise.all([
    db.prepare(`
      SELECT p.id, p.name, p.barcode, p.cost_price_usd, p.cost_price_khr,
             p.selling_price_usd, COALESCE(SUM(bs.quantity), 0) AS stock_quantity,
             p.image_path, p.name_key
      FROM products p
      LEFT JOIN branch_stock bs ON bs.product_id = p.id
      WHERE p.is_active = 1 AND COALESCE(p.is_group, 0) = 0
      GROUP BY p.id
      ORDER BY p.id ASC
    `).all<PossiblySameProductEntry & { name_key: string | null }>({}),
    db.prepare(`SELECT cluster_type, cluster_value FROM product_duplicate_dismissals`)
      .all<{ cluster_type: string; cluster_value: string }>({}),
  ])
  const dismissed = new Set(dismissalRows.map((row) => dismissKey(row.cluster_type, row.cluster_value)))

  const byBarcode = new Map<string, (PossiblySameProductEntry & { name_key: string | null })[]>()
  const byNameKey = new Map<string, (PossiblySameProductEntry & { name_key: string | null })[]>()
  const byFuzzyKey = new Map<string, (PossiblySameProductEntry & { name_key: string | null })[]>()
  for (const row of rows) {
    const barcode = String(row.barcode || '').trim()
    if (barcode.length >= MIN_REAL_BARCODE_LENGTH) {
      if (!byBarcode.has(barcode)) byBarcode.set(barcode, [])
      byBarcode.get(barcode)!.push(row)
    }
    if (row.name_key) {
      if (!byNameKey.has(row.name_key)) byNameKey.set(row.name_key, [])
      byNameKey.get(row.name_key)!.push(row)
    }
    const fuzzyKey = normalizeProductFuzzyName(row.name)
    if (fuzzyKey) {
      if (!byFuzzyKey.has(fuzzyKey)) byFuzzyKey.set(fuzzyKey, [])
      byFuzzyKey.get(fuzzyKey)!.push(row)
    }
  }

  const toEntry = (row: PossiblySameProductEntry): PossiblySameProductEntry => ({
    id: row.id, name: row.name, barcode: row.barcode,
    cost_price_usd: row.cost_price_usd, cost_price_khr: row.cost_price_khr,
    selling_price_usd: row.selling_price_usd,
    stock_quantity: row.stock_quantity, image_path: row.image_path,
  })

  const clusters: PossiblySameProductCluster[] = []
  for (const [barcode, group] of byBarcode) {
    if (group.length < 2) continue
    if (dismissed.has(dismissKey('barcode', barcode))) continue
    clusters.push({ type: 'barcode', value: barcode, severity: 'same_barcode', products: group.map(toEntry) })
  }
  for (const [nameKey, group] of byNameKey) {
    if (group.length < 2) continue
    if (dismissed.has(dismissKey('name', nameKey))) continue
    // A name group whose members all share one real barcode IS the barcode
    // cluster above -- listing it twice would make one decision look like
    // two. Groups with mixed/placeholder barcodes still show here.
    const barcodes = new Set(group.map((row) => String(row.barcode || '').trim()))
    if (barcodes.size === 1 && [...barcodes][0].length >= MIN_REAL_BARCODE_LENGTH) continue
    clusters.push({ type: 'name', value: group[0].name || nameKey, severity: 'same_name', products: group.map(toEntry) })
  }
  for (const [fuzzyKey, group] of byFuzzyKey) {
    if (group.length < 2) continue
    if (dismissed.has(dismissKey('similar', fuzzyKey))) continue
    // Only NEW evidence: a fuzzy group whose members all share ONE exact
    // name_key is already the same_name cluster above (that one name_key
    // trivially yields one fuzzy key), and one that all shares ONE real
    // barcode is the same_barcode cluster -- surfacing either again would
    // split one decision into two. The similar_name row exists for the case
    // neither catches: DIFFERENT exact names (>=2 name_keys) that only a
    // fuzzier read (diacritics/punctuation/word-order ignored) sees as one
    // item -- the "renamed, own barcode" duplicate the user reported.
    const nameKeys = new Set(group.map((row) => row.name_key || ''))
    if (nameKeys.size < 2) continue
    const barcodes = new Set(group.map((row) => String(row.barcode || '').trim()))
    if (barcodes.size === 1 && [...barcodes][0].length >= MIN_REAL_BARCODE_LENGTH) continue
    clusters.push({ type: 'similar', value: group[0].name || fuzzyKey, severity: 'similar_name', products: group.map(toEntry) })
  }
  // Worst-first: a shared real barcode is the strongest same-item evidence, a
  // shared exact display name next, a fuzzy-only name match the weakest.
  const rank: Record<PossiblySameSeverity, number> = { same_barcode: 0, same_name: 1, similar_name: 2 }
  return clusters.sort((a, b) => rank[a.severity] - rank[b.severity])
}

export async function findDuplicateProductGroups(db: D1Compat): Promise<ProductDuplicateGroup[]> {
  const rows = await db
    .prepare(`
      SELECT p.id, p.name, p.barcode, p.cost_price_usd, p.cost_price_khr,
             p.selling_price_usd, p.selling_price_khr, p.image_path, p.name_key,
             COALESCE(SUM(bs.quantity), 0) AS live_stock_quantity
      FROM products p
      LEFT JOIN branch_stock bs ON bs.product_id = p.id
      WHERE p.is_active = 1 AND COALESCE(p.is_group, 0) = 0
      GROUP BY p.id
      ORDER BY p.name_key ASC, p.id ASC
    `)
    .all<ProductIdentityRow & { name_key: string }>({})

  const byNameKey = new Map<string, (ProductIdentityRow & { name_key: string })[]>()
  const byRawBarcode = new Map<string, (ProductIdentityRow & { name_key: string })[]>()
  const byFuzzyName = new Map<string, (ProductIdentityRow & { name_key: string })[]>()
  for (const row of rows) {
    if (!row.name_key) continue
    if (!byNameKey.has(row.name_key)) byNameKey.set(row.name_key, [])
    byNameKey.get(row.name_key)!.push(row)
    const barcode = String(row.barcode || '').trim().toLowerCase()
    if (barcode.length >= MIN_REAL_BARCODE_LENGTH) {
      if (!byRawBarcode.has(barcode)) byRawBarcode.set(barcode, [])
      byRawBarcode.get(barcode)!.push(row)
    }
    const fuzzyName = normalizeProductFuzzyName(row.name)
    if (fuzzyName) {
      if (!byFuzzyName.has(fuzzyName)) byFuzzyName.set(fuzzyName, [])
      byFuzzyName.get(fuzzyName)!.push(row)
    }
  }

  // Manual review wins over automatic cleanup when classifications overlap.
  // A row sharing its raw barcode with another exact name, or participating
  // in a fuzzy-name cluster spanning exact names, must stay visible for the
  // reviewer even if it also has an otherwise-safe exact duplicate.
  const manualOnlyIds = new Set<number>()
  for (const group of byRawBarcode.values()) {
    if (new Set(group.map((row) => row.name_key)).size < 2) continue
    for (const row of group) manualOnlyIds.add(row.id)
  }
  for (const group of byFuzzyName.values()) {
    if (new Set(group.map((row) => row.name_key)).size < 2) continue
    for (const row of group) manualOnlyIds.add(row.id)
  }

  const groups: ProductDuplicateGroup[] = []
  for (const candidates of byNameKey.values()) {
    if (candidates.length < 2) continue
    // Within one name_key bucket there can be more than one genuinely
    // distinct item (e.g. same name, different cost/price on purpose) --
    // so still bucket by the full identity rule inside the name group,
    // same fields findIdentityMatch/findIdentityMatches check, rather than
    // assuming every same-name row belongs together.
    const buckets = new Map<string, (ProductIdentityRow & { name_key: string })[]>()
    for (const candidate of candidates) {
      if (manualOnlyIds.has(candidate.id)) continue
      // Exact barcode matches behave as before. A pair differing only by one
      // leading zero also lands together, but still only inside the same exact
      // name and same-cost bucket. Same barcode + different name therefore
      // remains in the manual-review list, exactly as requested.
      const bucketKey = productDetailSignature({
        ...candidate,
        barcode: normalizeLeadingZeroBarcodeForCleanup(candidate.barcode),
      })
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, [])
      buckets.get(bucketKey)!.push(candidate)
    }
    for (const bucket of buckets.values()) {
      if (bucket.length < 2) continue
      // For an extra-zero pair, the already-clean barcode must survive; the
      // fold moves all branch stock onto it even when the typo row owns that
      // stock today. Exact-barcode duplicates prefer the stocked row. Id is
      // the stable final tie-break.
      const rawBarcodes = new Set(bucket.map((row) => String(row.barcode ?? '').trim().toLowerCase()))
      const isLeadingZeroPair = rawBarcodes.size > 1
      // How many leading zeros this row would shed. 0 means the row already
      // carries the clean barcode. Ranking on the COUNT rather than on a
      // was-it-normalized boolean is what lets a double-zero row lose to its
      // single-zero twin: '008339327539' and '08339327539' are both "normalized",
      // so the boolean tied them and the dirtier row won on the id tie-break,
      // putting the extra zero back into the catalog as the survivor.
      const zerosShed = (row: ProductIdentityRow) => {
        const raw = String(row.barcode ?? '').trim().toLowerCase()
        return raw.length - normalizeLeadingZeroBarcodeForCleanup(raw).length
      }
      const ordered = [...bucket].sort((a, b) => {
        if (isLeadingZeroPair) {
          const zeroDiff = zerosShed(a) - zerosShed(b)
          if (zeroDiff) return zeroDiff
        }
        const stockDiff = (Number(b.live_stock_quantity) || 0) - (Number(a.live_stock_quantity) || 0)
        if (stockDiff) return stockDiff
        return a.id - b.id
      })
      const [canonical, ...duplicates] = ordered
      groups.push({ canonical, duplicates })
    }
  }
  return groups
}
