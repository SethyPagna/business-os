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

export type RenameKind = 'category' | 'brand' | 'supplier' | 'product_name'

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

function replaceMultiMember(value: unknown, from: string, to: string): string {
  const members = splitMulti(value)
  const target = lower(from)
  const seen = new Set<string>()
  const next: string[] = []
  for (const member of members) {
    const replaced = lower(member) === target ? to : member
    const key = lower(replaced)
    if (seen.has(key)) continue
    seen.add(key)
    next.push(replaced)
  }
  return next.join('||')
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
  if (kind === 'category' || kind === 'brand') {
    const primary = kind
    const multi = kind === 'category' ? 'categories' : 'brands'
    // Distinct products touched (a row can carry the value in BOTH the
    // primary column and the multi-value membership -- it counts once).
    const touched = new Set<number>()
    const primaryRows = await db.prepare(
      `SELECT id FROM products WHERE lower(trim(COALESCE(${primary}, ''))) = @from`,
    ).all<{ id: number }>(params)
    for (const row of primaryRows || []) touched.add(Number(row.id))
    const primaryResult = await db.prepare(
      `UPDATE products SET ${primary} = @to, updated_at = @now WHERE lower(trim(COALESCE(${primary}, ''))) = @from`,
    ).run(params)
    void changesOf(primaryResult)

    // Multi-value membership: rewrite in JS (see header).
    const memberRows = await db.prepare(`
      SELECT p.id AS id, p.${multi} AS value FROM products p
      WHERE ('||' || lower(COALESCE(p.${multi}, '')) || '||') LIKE '%||' || @fromEsc || '||%' ESCAPE '\\'
    `).all<{ id: number; value: string }>({ fromEsc: lower(from).replace(/[%_]/g, (m) => `\\${m}`) })
    const rewrites = (memberRows || [])
      .map((row) => ({ id: row.id, next: replaceMultiMember(row.value, from, to) }))
      .filter((row) => row.next !== undefined)
    for (const group of chunk(rewrites, 40)) {
      await db.batch(group.map((row) => ({
        sql: `UPDATE products SET ${multi} = @value, updated_at = @now WHERE id = @id`,
        params: { value: row.next, id: row.id, now: nowIso },
      })))
    }
    for (const row of rewrites) touched.add(Number(row.id))
    products += touched.size
  } else if (kind === 'supplier') {
    const productResult = await db.prepare(
      `UPDATE products SET supplier = @to, updated_at = @now WHERE lower(trim(COALESCE(supplier, ''))) = @from`,
    ).run(params)
    products += changesOf(productResult)
    const batchResult = await db.prepare(
      `UPDATE product_batches SET supplier_name = @to WHERE lower(trim(COALESCE(supplier_name, ''))) = @from`,
    ).run(params)
    batches += changesOf(batchResult)
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
