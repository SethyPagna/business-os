// D6: rename cascades with a before -> after preview. One shared engine
// answers, for a category / brand / supplier / product-name rename:
//   (1) IMPACT -- how many rows are attached to the old value, split by
//       where they live (primary column, multi-value membership, batches,
//       the lookup/contact row itself, name-group siblings), so the UI can
//       show "before -> after" with real numbers before anything writes;
//   (2) CARRY -- move every attached row to the new value. The "keep a
//       copy, new is new" choice never reaches this engine: it means
//       creating the new value fresh and leaving the old one untouched,
//       which the callers do through their ordinary create paths.
//
// The multi-value `categories`/`brands` columns (migration 0033,
// '||'-delimited) cannot be member-replaced reliably in SQLite SQL, so
// carry rewrites those rows in JS, chunked under D1's 100-bound-parameter
// budget. Historical records (sales lines, movements, audit payloads)
// keep their captured text on purpose -- a rename must never rewrite
// history, only the live catalog.

import type { D1Compat } from './db'

export type RenameKind = 'category' | 'brand' | 'unit' | 'supplier' | 'product_name'

export interface RenameImpact {
  kind: RenameKind
  from: string
  to: string
  // products whose PRIMARY column carries the old value
  products_primary: number
  // products whose multi-value column carries it as a secondary member
  products_secondary: number
  // product_batches rows carrying the old supplier name (supplier only)
  batches: number
  // name-group rows that would rename together (product_name only)
  group_rows: number
  // an existing row/group already using the TARGET value -- a carry would
  // merge into it, worth a louder word in the UI
  target_exists: boolean
  // Event/audit rows are immutable point-in-time evidence. This list makes
  // that boundary explicit to every preview instead of implying that a
  // "full" live-data cascade rewrites history.
  historical_snapshots_preserved: string[]
}

export type RenameBatchStatement = { sql: string; params?: Record<string, unknown> }

export interface LiveLookupMutationPlan {
  statements: RenameBatchStatement[]
  products: number
}

export interface BrandLibraryMutationPlan {
  statements: RenameBatchStatement[]
  brands: string[]
  colorMap: Record<string, string>
}

const lower = (value: unknown) => String(value ?? '').trim().toLowerCase()

// run() result shapes differ between the local adapter type ({ changes })
// and real D1 / the test harness ({ meta: { changes } }) -- read both so
// the carry's reported row counts are true everywhere.
function changesOf(result: unknown): number {
  const shaped = result as { changes?: number; meta?: { changes?: number } } | null | undefined
  return Number(shaped?.meta?.changes ?? shaped?.changes ?? 0)
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

// Members of a '||'-delimited multi-value string, trimmed, empties dropped.
function splitMulti(value: unknown): string[] {
  return String(value ?? '')
    .split('||')
    .map((part) => part.trim())
    .filter(Boolean)
}

function replaceMultiMembers(value: unknown, fromKeys: Set<string>, to: string | null): string {
  const seen = new Set<string>()
  const next: string[] = []
  for (const member of splitMulti(value)) {
    const replaced = fromKeys.has(lower(member)) ? to : member
    if (!replaced) continue
    const key = lower(replaced)
    if (!key || seen.has(key)) continue
    seen.add(key)
    next.push(replaced)
  }
  return next.join('||')
}

function normalizedKeys(values: string[]): string[] {
  return [...new Set(values.map(lower).filter(Boolean))]
}

function buildCaseRewriteStatements(
  column: 'categories' | 'brands',
  rows: Array<{ id: number; value: string }>,
  nowIso: string,
): RenameBatchStatement[] {
  return chunk(rows, 40).map((group) => {
    const params: Record<string, unknown> = { now: nowIso }
    const cases: string[] = []
    const ids: string[] = []
    group.forEach((row, index) => {
      params[`id${index}`] = row.id
      params[`value${index}`] = row.value
      cases.push(`WHEN @id${index} THEN @value${index}`)
      ids.push(`@id${index}`)
    })
    return {
      sql: `UPDATE products SET ${column} = CASE id ${cases.join(' ')} ELSE ${column} END, updated_at = @now WHERE id IN (${ids.join(', ')})`,
      params,
    }
  })
}

// Build every live product rewrite before the caller starts its single D1
// batch. The lookup/settings row mutation can then be placed in the SAME
// batch, so a constraint failure cannot leave products pointing at a name
// the library did not save (or vice versa). Each CASE statement stays under
// D1's 100-bound-parameter ceiling: 40 ids + 40 values + one timestamp.
export async function buildLiveLookupMutationPlan(
  db: D1Compat,
  kind: 'category' | 'brand' | 'unit',
  fromValues: string[],
  to: string | null,
  nowIso: string,
): Promise<LiveLookupMutationPlan> {
  const keys = normalizedKeys(fromValues)
  if (!keys.length) return { statements: [], products: 0 }
  const primary = kind
  const keysJson = JSON.stringify(keys)
  const primaryRows = await db.prepare(
    `SELECT id FROM products WHERE lower(trim(COALESCE(${primary}, ''))) IN (SELECT value FROM json_each(@keysJson))`,
  ).all<{ id: number }>({ keysJson })
  const touched = new Set((primaryRows || []).map((row) => Number(row.id)))
  const statements: RenameBatchStatement[] = [{
    sql: `UPDATE products SET ${primary} = ${to ? '@to' : 'NULL'}, updated_at = @now
          WHERE lower(trim(COALESCE(${primary}, ''))) IN (SELECT value FROM json_each(@keysJson))`,
    params: { to, now: nowIso, keysJson },
  }]

  if (kind === 'category' || kind === 'brand') {
    const multi = kind === 'category' ? 'categories' : 'brands'
    // Read only non-empty membership rows, then perform exact normalized
    // member comparison in JS. No wildcard/fuzzy decision is made here.
    const memberRows = await db.prepare(
      `SELECT id, ${multi} AS value FROM products WHERE trim(COALESCE(${multi}, '')) != ''`,
    ).all<{ id: number; value: string }>()
    const keySet = new Set(keys)
    const rewrites = (memberRows || [])
      .filter((row) => splitMulti(row.value).some((member) => keySet.has(lower(member))))
      .map((row) => ({ id: Number(row.id), value: replaceMultiMembers(row.value, keySet, to) }))
    for (const row of rewrites) touched.add(row.id)
    statements.push(...buildCaseRewriteStatements(multi, rewrites, nowIso))
  }
  return { statements, products: touched.size }
}

function parseStringList(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw ?? '[]'))
    return Array.isArray(parsed) ? parsed.map((value) => String(value ?? '').trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function parseColorMap(raw: unknown): Record<string, string> {
  try {
    const parsed = JSON.parse(String(raw ?? '{}'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [lower(key), String(value ?? '').trim()]).filter(([key, value]) => key && value))
  } catch {
    return {}
  }
}

// Brand names use settings rather than a lookup table. This plan rewrites the
// saved list and color map without inventing fuzzy matches; callers append it
// to the product carry/clear statements in one atomic D1 batch.
export async function buildBrandLibraryMutationPlan(
  db: D1Compat,
  fromValues: string[],
  to: string | null,
): Promise<BrandLibraryMutationPlan> {
  const rows = await db.prepare(
    `SELECT key, value FROM settings WHERE key IN ('product_brand_options', 'product_brand_color_map')`,
  ).all<{ key: string; value: string | null }>()
  const byKey = new Map((rows || []).map((row) => [row.key, row.value]))
  const fromKeys = new Set(normalizedKeys(fromValues))
  const target = String(to ?? '').trim() || null
  const targetKey = lower(target)
  const brands: string[] = []
  const seen = new Set<string>()
  for (const brand of parseStringList(byKey.get('product_brand_options'))) {
    const replaced = fromKeys.has(lower(brand)) ? target : brand
    if (!replaced) continue
    const key = lower(replaced)
    if (!key || seen.has(key)) continue
    seen.add(key)
    brands.push(replaced)
  }
  if (target && !seen.has(targetKey)) brands.push(target)

  const currentColors = parseColorMap(byKey.get('product_brand_color_map'))
  const colorMap: Record<string, string> = {}
  let carriedColor = targetKey ? currentColors[targetKey] || '' : ''
  for (const [key, color] of Object.entries(currentColors)) {
    if (fromKeys.has(key)) {
      if (!carriedColor) carriedColor = color
      continue
    }
    colorMap[key] = color
  }
  if (targetKey && carriedColor) colorMap[targetKey] = carriedColor

  return {
    brands,
    colorMap,
    statements: [
      {
        sql: `INSERT INTO settings (key, value, updated_at) VALUES ('product_brand_options', @value, CURRENT_TIMESTAMP)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        params: { value: JSON.stringify(brands) },
      },
      {
        sql: `INSERT INTO settings (key, value, updated_at) VALUES ('product_brand_color_map', @value, CURRENT_TIMESTAMP)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        params: { value: JSON.stringify(colorMap) },
      },
    ],
  }
}

async function countMultiMembers(db: D1Compat, column: 'categories' | 'brands', primary: 'category' | 'brand', from: string): Promise<number> {
  // Secondary membership only -- rows counted under the primary column
  // already are excluded so the two impact numbers add, not overlap.
  const row = await db.prepare(`
    SELECT COUNT(*) AS n FROM products p
    WHERE ('||' || lower(COALESCE(p.${column}, '')) || '||') LIKE '%||' || @fromEsc || '||%' ESCAPE '\\'
      AND lower(trim(COALESCE(p.${primary}, ''))) <> @from
  `).get<{ n: number }>({ from: lower(from), fromEsc: lower(from).replace(/[%_]/g, (m) => `\\${m}`) })
  return Number(row?.n || 0)
}

export async function computeRenameImpact(db: D1Compat, kind: RenameKind, from: string, to: string): Promise<RenameImpact> {
  const impact: RenameImpact = {
    kind, from, to,
    products_primary: 0, products_secondary: 0, batches: 0, group_rows: 0,
    target_exists: false,
    historical_snapshots_preserved: ['audit_logs', 'action payloads'],
  }
  const params = { from: lower(from), to: lower(to) }
  if (kind === 'category' || kind === 'brand') {
    const primary = kind
    const multi = kind === 'category' ? 'categories' : 'brands'
    impact.products_primary = Number((await db.prepare(
      `SELECT COUNT(*) AS n FROM products p WHERE lower(trim(COALESCE(p.${primary}, ''))) = @from`,
    ).get<{ n: number }>(params))?.n || 0)
    impact.products_secondary = await countMultiMembers(db, multi as 'categories' | 'brands', primary, from)
    impact.target_exists = Boolean(await db.prepare(
      `SELECT 1 AS x FROM products p WHERE lower(trim(COALESCE(p.${primary}, ''))) = @to LIMIT 1`,
    ).get(params))
  } else if (kind === 'unit') {
    impact.products_primary = Number((await db.prepare(
      `SELECT COUNT(*) AS n FROM products p WHERE lower(trim(COALESCE(p.unit, ''))) = @from`,
    ).get<{ n: number }>(params))?.n || 0)
    impact.target_exists = Boolean(await db.prepare(
      `SELECT 1 AS x FROM units WHERE lower(trim(name)) = @to LIMIT 1`,
    ).get(params))
  } else if (kind === 'supplier') {
    impact.products_primary = Number((await db.prepare(
      `SELECT COUNT(*) AS n FROM products p WHERE lower(trim(COALESCE(p.supplier, ''))) = @from`,
    ).get<{ n: number }>(params))?.n || 0)
    impact.batches = Number((await db.prepare(
      `SELECT COUNT(*) AS n FROM product_batches pb WHERE lower(trim(COALESCE(pb.supplier_name, ''))) = @from`,
    ).get<{ n: number }>(params))?.n || 0)
    impact.target_exists = Boolean(await db.prepare(
      `SELECT 1 AS x FROM suppliers WHERE lower(trim(name)) = @to LIMIT 1`,
    ).get(params))
  } else {
    impact.group_rows = Number((await db.prepare(
      `SELECT COUNT(*) AS n FROM products p WHERE p.name_key = @from AND p.is_active = 1`,
    ).get<{ n: number }>(params))?.n || 0)
    impact.target_exists = Boolean(await db.prepare(
      `SELECT 1 AS x FROM products p WHERE p.name_key = @to AND p.is_active = 1 LIMIT 1`,
    ).get(params))
  }
  return impact
}

// CARRY: every attached live row moves to the new value. Returns how many
// rows changed per store, so the caller can audit real numbers.
export async function applyRenameCarry(
  db: D1Compat,
  kind: RenameKind,
  from: string,
  to: string,
  nowIso: string,
): Promise<{ products: number; batches: number }> {
  const params = { from: lower(from), to, now: nowIso }
  let products = 0
  let batches = 0
  if (kind === 'category' || kind === 'brand' || kind === 'unit') {
    const plan = await buildLiveLookupMutationPlan(db, kind, [from], to, nowIso)
    if (plan.statements.length) await db.batch(plan.statements)
    products += plan.products
  } else if (kind === 'supplier') {
    const productResult = await db.prepare(
      `UPDATE products SET supplier = @to, updated_at = @now WHERE lower(trim(COALESCE(supplier, ''))) = @from`,
    ).run(params)
    products += changesOf(productResult)
    const batchResult = await db.prepare(
      `UPDATE product_batches SET supplier_name = @to WHERE lower(trim(COALESCE(supplier_name, ''))) = @from`,
    ).run(params)
    batches += changesOf(batchResult)
    // Imported AP rows can be name-only (supplier_id NULL). Exact normalized
    // equality is deliberate: no LIKE/fuzzy rewrite is safe for finance.
    try {
      await db.prepare(
        `UPDATE supplier_invoices SET supplier_name = @to
         WHERE supplier_id IS NULL AND lower(trim(COALESCE(supplier_name, ''))) = @from`,
      ).run(params)
    } catch {
      // supplier_invoices was introduced by a later migration; old local test
      // databases may not have it. Production databases do.
    }
  } else {
    // product_name carry: every ACTIVE row of the name group takes the new
    // name -- the regroup rule 9.1 asked for ("rename does not regroup"
    // was the bug: renaming one row silently split it from its siblings).
    // name_key follows via migration 0010's trigger.
    const groupResult = await db.prepare(
      `UPDATE products SET name = @to, updated_at = @now WHERE name_key = @from AND is_active = 1`,
    ).run(params)
    products += changesOf(groupResult)
  }
  return { products, batches }
}

// Remove one exact category/brand member from the live catalog. Used by lookup
// deletion and multi-select cleanup so secondary `||` memberships cannot keep
// a deleted/outdated value. Historical sale/movement text remains untouched.
export async function removeLiveLookupValue(
  db: D1Compat,
  kind: 'category' | 'brand' | 'unit' | 'supplier',
  value: string,
  nowIso: string,
): Promise<{ products: number }> {
  if (kind === 'supplier') {
    const from = lower(value)
    if (!from) return { products: 0 }
    const rows = await db.prepare(
      `SELECT id FROM products WHERE lower(trim(COALESCE(supplier, ''))) = @from`,
    ).all<{ id: number }>({ from })
    await db.prepare(
      `UPDATE products SET supplier = NULL, updated_at = @now WHERE lower(trim(COALESCE(supplier, ''))) = @from`,
    ).run({ from, now: nowIso })
    return { products: (rows || []).length }
  }
  const plan = await buildLiveLookupMutationPlan(db, kind, [value], null, nowIso)
  if (plan.statements.length) await db.batch(plan.statements)
  return { products: plan.products }
}
