import type { D1Compat } from './db'

// Same "is this genuinely the same real-world product" identity rule
// classifyProducts (CSV import, importEngine.ts) uses to decide whether an
// incoming row is the same product or a genuinely different one that
// happens to share a name -- see that file's byName/cost/price/barcode
// fallback comment for the full reasoning. Extracted here so branch
// transfers (routes/branches.ts) can apply the identical rule at
// transfer time: products is a single global table, branch_stock is the
// only per-branch thing that exists, so "same name + same cost + same
// price + same barcode" is what makes two rows the same product no matter
// which route (import or transfer) is the one that noticed it.

function lower(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

// Mirrors products.name_key exactly (migration 0010: `lower(trim(name))`,
// NOT normalizeProductGroupName's extra internal-whitespace collapse) so
// the query below can use the existing idx_products_name_key_pg index
// instead of a fresh unindexed lower(trim(name)) expression -- the same
// O(n) vs. O(n^2) concern migration 0010 itself exists to avoid.
function nameKeyOf(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function moneyEq(a: unknown, b: unknown): boolean {
  return Math.round((Number(a) || 0) * 100) === Math.round((Number(b) || 0) * 100)
}

export type ProductIdentityRow = {
  id: number
  name: string | null
  barcode: string | null
  purchase_price_usd: number | null
  purchase_price_khr: number | null
  selling_price_usd: number | null
  selling_price_khr: number | null
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
      SELECT id, name, barcode, purchase_price_usd, purchase_price_khr, selling_price_usd, selling_price_khr
      FROM products
      WHERE id != @id AND name_key = @nameKey AND is_active = 1
      ORDER BY id ASC
    `)
    .all<ProductIdentityRow>({ id: source.id, nameKey })
  for (const candidate of candidates) {
    const costOk = moneyEq(candidate.purchase_price_usd, source.purchase_price_usd) && moneyEq(candidate.purchase_price_khr, source.purchase_price_khr)
    const priceOk = moneyEq(candidate.selling_price_usd, source.selling_price_usd) && moneyEq(candidate.selling_price_khr, source.selling_price_khr)
    const barcodeOk = lower(candidate.barcode) === lower(source.barcode)
    if (costOk && priceOk && barcodeOk) return candidate
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
  const placeholders = nameKeys.map((_, i) => `@nk${i}`).join(', ')
  const params: Record<string, unknown> = {}
  nameKeys.forEach((key, i) => { params[`nk${i}`] = key })
  const candidates = await db
    .prepare(`
      SELECT id, name, barcode, purchase_price_usd, purchase_price_khr, selling_price_usd, selling_price_khr, name_key
      FROM products
      WHERE name_key IN (${placeholders}) AND is_active = 1
      ORDER BY id ASC
    `)
    .all<ProductIdentityRow & { name_key: string }>(params)
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
      const costOk = moneyEq(candidate.purchase_price_usd, source.purchase_price_usd) && moneyEq(candidate.purchase_price_khr, source.purchase_price_khr)
      const priceOk = moneyEq(candidate.selling_price_usd, source.selling_price_usd) && moneyEq(candidate.selling_price_khr, source.selling_price_khr)
      const barcodeOk = lower(candidate.barcode) === lower(source.barcode)
      if (costOk && priceOk && barcodeOk) { result.set(source.id, candidate); break }
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

export async function findDuplicateProductGroups(db: D1Compat): Promise<ProductDuplicateGroup[]> {
  const rows = await db
    .prepare(`
      SELECT id, name, barcode, purchase_price_usd, purchase_price_khr, selling_price_usd, selling_price_khr, name_key
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
      const bucketKey = [
        Math.round((Number(candidate.purchase_price_usd) || 0) * 100),
        Math.round((Number(candidate.purchase_price_khr) || 0) * 100),
        Math.round((Number(candidate.selling_price_usd) || 0) * 100),
        Math.round((Number(candidate.selling_price_khr) || 0) * 100),
        lower(candidate.barcode),
      ].join('|')
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
