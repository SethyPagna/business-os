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
  // Not part of the identity comparison -- carried so merge-duplicates can
  // move a duplicate's primary image onto the canonical row instead of
  // orphaning it on a row it is about to deactivate.
  image_path?: string | null
}

// Finds another ACTIVE product row that is genuinely the same item as
// `source` (excluding source itself): same name_key, cost, selling price,
// and barcode. Returns null when nothing else in the catalog matches --
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
// selling price + barcode), independent of any transfer happening. This is
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
// under THE identity rule (name_key + cost + price + barcode) and is safe
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
      SELECT id, name, barcode, cost_price_usd, selling_price_usd, stock_quantity, image_path, name_key
      FROM products
      WHERE is_active = 1 AND COALESCE(is_group, 0) = 0
      ORDER BY id ASC
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
    cost_price_usd: row.cost_price_usd, selling_price_usd: row.selling_price_usd,
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
      SELECT id, name, barcode, cost_price_usd, cost_price_khr, selling_price_usd, selling_price_khr, image_path, name_key
      FROM products
      WHERE is_active = 1 AND COALESCE(is_group, 0) = 0
      ORDER BY name_key ASC, id ASC
    `)
    .all<ProductIdentityRow & { name_key: string }>({})

  const byNameKey = new Map<string, (ProductIdentityRow & { name_key: string })[]>()
  for (const row of rows) {
    if (!row.name_key) continue
    if (!byNameKey.has(row.name_key)) byNameKey.set(row.name_key, [])
    byNameKey.get(row.name_key)!.push(row)
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
      const bucketKey = productDetailSignature(candidate)
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, [])
      buckets.get(bucketKey)!.push(candidate)
    }
    for (const bucket of buckets.values()) {
      if (bucket.length < 2) continue
      const [canonical, ...duplicates] = bucket
      groups.push({ canonical, duplicates })
    }
  }
  return groups
}
