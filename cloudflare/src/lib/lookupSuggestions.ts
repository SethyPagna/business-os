// Category/unit suggestions = the lookup TABLE union the values products
// actually carry.
//
// Root cause of the owner's 2026-09-06 report ("categories still does not
// show the available options when i write... especially so for add/create
// products"): GET /api/categories returned `SELECT * FROM categories`, and in
// production that table has ZERO rows while products carry 42 distinct
// category strings. Every host of the product form -- Products edit, the
// create-products session item form, the fast stock-in inline create -- fed
// its Category suggestions from that empty table, so typing "s" offered
// nothing while "skincare" sat on dozens of products. Brand looked fine only
// because Products.tsx builds ITS list from the values products use.
//
// The union is computed here, in the ONE read every host already performs, so
// no host needs new plumbing (FastStockInModal's existing getCategories()
// call benefits without being touched).
//
// The MANAGER must not be widened by this. Creating, renaming and deleting
// operate on lookup ROWS, and a category that merely exists on products has
// no row to rename or delete -- offering one would be a delete button with
// nothing behind it. So every row is tagged:
//     source: 'lookup'   -- a real row in categories/units (id is its number)
//     source: 'products' -- used by products only (id is a synthetic
//                           'used:<normalized name>' string, never a row id)
// and the two manager modals keep only source === 'lookup'.
//
// ORDER (documented, and pinned by scripts/test-lookup-suggestions-pure.cjs):
//   1. lookup rows, in the caller's existing `ORDER BY lower(name) ASC`
//   2. used-only names carried by at least one ACTIVE product, alphabetical
//      (case-insensitive)
//   3. used-only names carried only by inactive products, alphabetical
// Managed vocabulary first because it is the curated answer; active before
// inactive because a name nothing sellable uses is the weakest suggestion.

export type LookupSuggestionSource = 'lookup' | 'products'

export type UsedLookupValue = {
  /** One deterministic spelling of the value as products carry it. */
  value: string
  /** 1 when at least one ACTIVE product carries it. */
  active?: number | boolean | null
}

export type LookupSuggestionRow = Record<string, unknown> & {
  id: number | string
  name: string
  source: LookupSuggestionSource
}

function normalizeKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function byNameAsc(a: UsedLookupValue, b: UsedLookupValue): number {
  const left = normalizeKey(a.value)
  const right = normalizeKey(b.value)
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Merge the lookup rows with the values products carry.
 * Lookup rows pass through untouched apart from the `source` tag, so the
 * manager keeps every column (color, updated_at, ...) it already relies on.
 */
export function mergeLookupSuggestionRows(
  lookupRows: ReadonlyArray<Record<string, unknown>> = [],
  usedValues: ReadonlyArray<UsedLookupValue | string> = [],
): LookupSuggestionRow[] {
  const managed: LookupSuggestionRow[] = []
  const taken = new Set<string>()
  for (const row of lookupRows || []) {
    const name = String((row as { name?: unknown })?.name ?? '').trim()
    if (!name) continue
    const key = normalizeKey(name)
    if (taken.has(key)) continue
    taken.add(key)
    managed.push({ ...row, id: (row as { id: number | string }).id, name, source: 'lookup' })
  }

  const usedByKey = new Map<string, UsedLookupValue>()
  for (const raw of usedValues || []) {
    const entry: UsedLookupValue = typeof raw === 'string' ? { value: raw } : raw
    const name = String(entry?.value ?? '').trim()
    if (!name) continue
    const key = normalizeKey(name)
    if (taken.has(key)) continue
    const isActive = entry?.active === true || Number(entry?.active ?? 0) === 1
    const existing = usedByKey.get(key)
    if (existing) {
      if (isActive) existing.active = 1
      continue
    }
    usedByKey.set(key, { value: name, active: isActive ? 1 : 0 })
  }

  const used = [...usedByKey.values()]
  const active = used.filter((entry) => Number(entry.active ?? 0) === 1).sort(byNameAsc)
  const inactive = used.filter((entry) => Number(entry.active ?? 0) !== 1).sort(byNameAsc)

  return [
    ...managed,
    ...[...active, ...inactive].map((entry) => ({
      id: `used:${normalizeKey(entry.value)}`,
      name: entry.value,
      color: null,
      source: 'products' as const,
    })),
  ]
}

/**
 * The values products carry, one deterministic spelling per case-insensitive
 * group -- the same GROUP BY lower(trim(...)) idiom routes/products.ts uses
 * for its filter facets, so the suggestion list and the Category/Unit filter
 * panel can never disagree about what is "in use".
 *
 * `is_active` may be absent on very old rows; COALESCE keeps those countable
 * as active rather than silently demoting them.
 */
export function usedLookupValuesSql(column: 'category' | 'unit'): string {
  return `
    SELECT MIN(trim(p.${column})) AS value,
           MAX(CASE WHEN COALESCE(p.is_active, 1) = 1 THEN 1 ELSE 0 END) AS active
    FROM products p
    WHERE trim(COALESCE(p.${column}, '')) <> ''
    GROUP BY lower(trim(p.${column}))
    ORDER BY lower(MIN(trim(p.${column}))) ASC
  `
}
