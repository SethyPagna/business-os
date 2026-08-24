// Shared pagination helper for any product-listing endpoint that needs to
// respect grouped products ("families" -- a parent product plus its
// parent_id-linked variant children, e.g. same shirt in different
// sizes/colors) as a SINGLE unit for paging purposes.
//
// Why this exists: every product list endpoint (products.ts search,
// inventory.ts search, branches.ts /:id/stock) used a plain
// `LIMIT @pageSize OFFSET @offset` over raw product rows. That counts each
// variant row individually, so a page boundary could land in the middle of
// a grouped product's variants -- e.g. with pageSize=20, if the 20th *row*
// happened to be the 2nd variant of a 4-variant group, the group would be
// split: 2 variants on page 1, 2 more pushed onto page 2, and the family
// itself would occupy "slots" 20 and 24 instead of counting once. Product
// requirement: a grouped product counts as ONE item toward pageSize,
// exactly like a standalone product, and never splits across a page
// boundary -- so page 1 of a 20-per-page listing always contains exactly
// 20 distinct products/families (or fewer on the last page), regardless of
// how many variant rows any of them expand to.
//
// Approach: rank *families* (not rows) with a window function, page over
// that ranking, then return every row belonging to a family whose rank
// falls in the requested page. `total`/`totalPages` are family counts, not
// row counts, since that's what "page N of M" means once a family is the
// paging unit.
import type { D1Compat } from './db'

export interface FamilyPaginationOptions {
  db: D1Compat
  // Column list for the SELECT, using the `p.` alias, e.g.
  // 'p.id, p.name, p.sku, ...'. Must include `p.id` and `p.name` at least;
  // whatever you select here comes back as bare (unprefixed) keys on each
  // returned row, same as a normal `SELECT p.col FROM products p` does.
  selectColumns: string
  // Extra JOINs beyond the family self-join this helper already adds
  // (e.g. a branch_stock join used by filters). Must only reference `p.`.
  joinSql: string
  // Full `WHERE ...` clause (including the `WHERE` keyword), referencing
  // only `p.` columns.
  whereSql: string
  // Named params for joinSql/whereSql (translated via `@name` -> D1 bind).
  params: Record<string, unknown>
  page: number
  pageSize: number
  // ORDER BY expression for ranking families, referencing the two
  // computed per-family aggregates `family_name` (lowercased, trimmed root
  // product name) and `latest_created_at` (max created_at across the
  // family's rows) -- e.g. 'family_name ASC' or
  // 'latest_created_at DESC, family_name ASC'. If `matchRankSql` is also
  // passed, a third aggregate `match_rank` is available too (see below).
  familyOrderSql: string
  // ORDER BY expression for ordering rows *within* a family on the
  // returned page, referencing bare (unprefixed) selected column names --
  // e.g. 'lower(name) ASC, id ASC'.
  intraFamilyOrderSql: string
  // Optional per-row relevance expression (referencing `p.` columns),
  // e.g. a CASE that returns 0 for a name match, 1 for sku/barcode, 2 for
  // brand/category, matching the "name first, then sku/barcode, then
  // brand/category" search-relevance rule. When provided, each row's value
  // is exposed as `__match_rank`, and each family is additionally ranked by
  // `MIN(__match_rank)` over its own rows, exposed as the aggregate
  // `match_rank` -- reference it from `familyOrderSql` (typically first:
  // 'match_rank ASC, family_name ASC') so a family surfaces by its best-
  // matching row, not just alphabetically. Omit when the caller has no
  // active search term -- plain alphabetical/created-date order is
  // unaffected either way since `matched`/`families` only add the extra
  // column when this is set.
  matchRankSql?: string
  // Opt-in fix for "a family matches by one row's field (e.g. one
  // variant's barcode) but its sibling rows -- different branch, price,
  // barcode -- silently never came back at all", reported against POS's
  // grouped-product barcode search: once a family qualifies (any of its
  // rows satisfies the caller's full `whereSql`, exactly as before), this
  // returns EVERY active row belonging to that family, not just the ones
  // that individually matched `whereSql`. Without this, `matched` (the
  // per-row-filtered set) is also what gets returned, so a search that
  // only matches one variant's barcode makes every *other* variant vanish
  // from the response entirely -- the frontend's own grouping
  // (buildVisibleProductCards/buildProductGroups) can only show what it
  // was actually sent, so a group that's real in the catalog renders as
  // if it had a single item, no variant selector, no way to see the
  // sibling rows' price/barcode/stock.
  // Left `undefined` (the default) for any existing caller that doesn't
  // pass it -- exact prior behavior (`matched` rows only), so this is a
  // non-breaking, purely additive change to this shared helper's
  // contract. Pass a base predicate here (e.g. `'p.is_active = 1'`) to
  // opt in: it becomes `family_members`'s WHERE, deliberately narrower
  // than the caller's real `whereSql` -- it should describe "which rows
  // may ever be shown" (active/deleted), not "which rows count as a
  // search/filter match" (that's still `whereSql`'s job, for deciding
  // which *families* qualify and how they're paged/ranked).
  familyMemberBaseWhereSql?: string
}

export interface FamilyPaginationResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

function buildCtes(opts: Pick<FamilyPaginationOptions, 'selectColumns' | 'joinSql' | 'whereSql' | 'matchRankSql' | 'familyMemberBaseWhereSql'>) {
  const matchRankSelect = opts.matchRankSql ? `, (${opts.matchRankSql}) AS __match_rank` : ''
  const matchRankAgg = opts.matchRankSql ? ', MIN(__match_rank) AS match_rank' : ''
  // family_members is only built (and only joined against, see below) when
  // familyMemberBaseWhereSql is actually passed -- omitted entirely for any
  // caller that hasn't opted in, so this stays a no-op for them (same CTEs,
  // same query shape, as before this option existed).
  const familyMembersCte = opts.familyMemberBaseWhereSql
    ? `,
    family_members AS (
      SELECT ${opts.selectColumns},
             COALESCE(parent.id, p.id) AS __family_root_id
      FROM products p
      LEFT JOIN products parent ON parent.id = p.parent_id
      ${opts.joinSql}
      WHERE ${opts.familyMemberBaseWhereSql}
    )`
    : ''
  return `
    WITH matched AS (
      SELECT ${opts.selectColumns},
             COALESCE(parent.id, p.id) AS __family_root_id,
             lower(trim(COALESCE(parent.name, p.name))) AS __family_name,
             p.created_at AS __created_at${matchRankSelect}
      FROM products p
      LEFT JOIN products parent ON parent.id = p.parent_id
      ${opts.joinSql}
      ${opts.whereSql}
    ),
    families AS (
      SELECT __family_root_id AS family_root_id,
             MIN(__family_name) AS family_name,
             MAX(__created_at) AS latest_created_at${matchRankAgg}
      FROM matched
      GROUP BY __family_root_id
    )${familyMembersCte}
  `
}

export async function paginateProductFamilies<T = Record<string, unknown>>(
  opts: FamilyPaginationOptions,
): Promise<FamilyPaginationResult<T>> {
  const { db, params, page, pageSize, familyOrderSql, intraFamilyOrderSql, familyMemberBaseWhereSql } = opts
  const ctes = buildCtes(opts)
  const offset = (page - 1) * pageSize
  // See familyMemberBaseWhereSql's own comment: opted-in callers get every
  // active row of a qualifying family (not just the ones that individually
  // matched whereSql); everyone else keeps selecting straight from
  // `matched`, unchanged.
  const resultSource = familyMemberBaseWhereSql ? 'family_members' : 'matched'

  const totalRow = await db.prepare(`
    ${ctes}
    SELECT COUNT(*) AS count FROM families
  `).get<{ count: number }>(params)
  const total = totalRow?.count || 0

  const rawRows = await db.prepare(`
    ${ctes},
    ranked AS (
      SELECT family_root_id, ROW_NUMBER() OVER (ORDER BY ${familyOrderSql}) AS family_rank
      FROM families
    )
    SELECT ${resultSource}.*
    FROM ${resultSource}
    JOIN ranked ON ranked.family_root_id = ${resultSource}.__family_root_id
    WHERE ranked.family_rank > @__familyOffset AND ranked.family_rank <= @__familyOffsetEnd
    ORDER BY ranked.family_rank ASC, ${intraFamilyOrderSql}
  `).all<Record<string, unknown>>({
    ...params,
    __familyOffset: offset,
    __familyOffsetEnd: offset + pageSize,
  })

  const cleaned = (Array.isArray(rawRows) ? rawRows : []).map((row) => {
    const { __family_root_id, __family_name, __created_at, __match_rank, ...rest } = row
    return rest as unknown as T
  })

  return {
    items: cleaned,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  }
}
