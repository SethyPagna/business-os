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

/**
 * The key that decides which rows belong to the same product family.
 *
 * NAME is the grouping axis, not `parent_id`. That is the permanent product
 * rule ("all same name is grouped"; a differing barcode or price makes a
 * child row inside that group, not a separate standalone), and until now
 * this helper contradicted it: a family was `COALESCE(parent.id, p.id)`,
 * i.e. `parent_id` chains ONLY. Since CSV import never writes `parent_id`
 * (it is set only by the hand-made Variant modal), essentially every real
 * group in this catalog was invisible here -- same-name rows each consumed
 * their own page slot and counted as separate families, so "20 per page"
 * silently meant "20 rows" rather than "20 products". `routes/products.ts`'s
 * expandSearchResultsToNameSiblings exists as a post-query patch for the
 * same gap, and only runs when a search term is present.
 *
 * Uses `name_key` -- the trigger-maintained, indexed `lower(trim(name))`
 * column from migration 0010 -- rather than recomputing `lower(trim(name))`
 * inline, so this stays an indexed column read instead of an unindexed
 * expression over every product row. That is the same O(n) vs O(n^2)
 * concern migration 0010 was written to solve.
 *
 * The parent's key wins when there is one, so a hand-made `parent_id`
 * variant family still groups under its parent even if a child was named
 * differently. Rows with a blank name fall back to an id-scoped key so they
 * stay separate instead of all collapsing into one nameless mega-family.
 */
export const FAMILY_ROOT_KEY_SQL = `COALESCE(NULLIF(COALESCE(parent.name_key, p.name_key), ''), 'id:' || COALESCE(parent.id, p.id))`

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
  // The CTE matchRankSql reads the FTS rank from (buildProductSearchQuery's
  // `rankCteSql`, computed once per statement). Pass it whenever you pass
  // that search's matchRankSql -- without it the statement fails loudly
  // with "no such table: __fts_rank" (never a silently wrong order).
  rankCteSql?: string
  // Optional per-row DISCRETE relevance-tier expression (referencing `p.`
  // columns), built by lib/productSearchQuery.ts's buildProductSearchQuery:
  // 0 = exact barcode, 1 = exact name, 2 = name prefix, 3 = everything
  // else. Exposed per row as `__match_tier` and per family as
  // `MIN(__match_tier)` under the aggregate name `match_tier`, so a family
  // surfaces at its best row's tier. Reference it FIRST from
  // `familyOrderSql` ('match_tier ASC, ...').
  //
  // Why this is separate from matchRankSql rather than folded into it: the
  // Products page and POS interleave `family_promoted DESC` between the
  // two (a discounted family leads *within* a relevance tier -- the G1b
  // rule). With one combined number there is nowhere to put that key that
  // doesn't either bury the exact match under an unrelated discounted
  // product, or make the promoted rule a no-op tiebreak that never fires
  // (bm25 is continuous, so it essentially never ties). Same additive
  // pattern as matchRankSql: omitted = identical query shape as before.
  matchTierSql?: string
  // Optional per-row 0/1 expression (referencing `p.` columns) marking a
  // row as PROMOTED (G1: live per-product discount or an active promotion
  // rule reaching it). When provided, each family additionally exposes the
  // aggregate `family_promoted` (MAX over its rows -- one promoted variant
  // promotes the family) for use in `familyOrderSql`, e.g.
  // 'family_promoted DESC, family_name ASC' so promoted families occupy
  // the block above the alphabetical run. Same additive pattern as
  // matchRankSql: omitted = identical query shape as before.
  promotedRankSql?: string
  // Optional per-row TEXT sort-key expression (referencing `p.` columns);
  // each family exposes MIN over its rows as the aggregate
  // `family_sort_value` for use in `familyOrderSql`. The portal uses it
  // for brand-first browsing (blank brands keyed to sort last). Same
  // additive pattern as matchRankSql/promotedRankSql.
  familySortValueSql?: string
  // Optional per-row NUMERIC sort-key expression (referencing `p.` columns);
  // each family exposes MAX over its rows as the aggregate
  // `family_num_sort` for use in `familyOrderSql`. MAX because the storefront
  // card for a name group shows its highest-priced row, so a price sort must
  // order by the number the shopper actually sees. Same additive pattern as
  // familySortValueSql: omitted = identical query shape as before.
  familyNumericSortSql?: string
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
  // Opt-in read-cost mode (GET /api/products/search). The default statement pair reads the whole filtered
  // catalogue three times per page: the COUNT, the ranking, and a second walk of `matched` joined to the ranking
  // to pick the page's rows (about 9 rows read per product at 8.6k products, every cache miss). With this set:
  //  - ONE statement ranks the families once and carries the family count on every page row
  //    (COUNT(*) OVER (), the same number the COUNT statement returned);
  //  - the page's rows are fetched by key, not by a second walk: the page's family keys are turned into the ids
  //    that can belong to them (name_key / parent_id index seeks), and only those ids are read.
  // Result, order, total and totalPages are identical to the default path; callers that do not pass it are
  // untouched. A page past the end returns no rows, so only then does a COUNT statement still run.
  seekPage?: boolean
  // Narrow ranking from a candidate list (GET /api/products/search with typed text or ranked ids; lib/productSearchQuery.ts ProductSearchCandidates). `SELECT id, r`: the ids the
  // search matches. The ranking then starts from those ids (CROSS JOIN products p ON p.id = __cand.id), reads only what the family order needs (the family key, name, created date,
  // rank, tier, promotion), and never walks the catalogue to test a search predicate on every product. The caller passes whereSql with the search term replaced by 1 = 1,
  // matchRankSql over __cand.r, and no rankCteSql. Honoured only where the page rows are fetched by key (seekPage, or the ranked scope) and the caller names the family members
  // (familyMemberBaseWhereSql), because the narrow ranking carries no row columns. Same families, order, rows and total as the predicate form.
  candidateSql?: string
  // products_parent_seek: the seek page's child lookups are written as index seeks (see pageCandidatesSql). Same rows either way; absent, the statement text is the one it always was.
  parentSeek?: boolean
}

// Typed-search order in JS (read switch products_typed_order_js), see paginateRankedIdFamilies.
export interface RankedIdDrivenRead {
  // The JSON id-list parameter the read starts from (replaces the `p.id IN listed` term, which whereSql here no longer carries).
  listParam: string
  // The caller's WHERE with the listed-ids term replaced by 1 = 1.
  drivenWhereSql: string
  // The member filter spelled against the list's CSV (buildRankedIdSearchQuery's csvMemberWhereSql).
  csvMemberWhereSql: string
}

export interface FamilyPaginationResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// The alias the candidate list carries in the statement. lib/productSearchQuery.ts PRODUCT_SEARCH_CANDIDATE_ALIAS spells the same name (the rank expression reads `__cand.r`).
const CANDIDATE_ALIAS = '__cand'

// A candidate list is used only by a read that fetches its page rows by key and names the family members: the narrow ranking has no row columns to return.
function narrowRead<T extends { candidateSql?: string; familyMemberBaseWhereSql?: string }>(opts: T, keyedPage: boolean): T {
  return opts.candidateSql && (!keyedPage || !opts.familyMemberBaseWhereSql) ? { ...opts, candidateSql: undefined } : opts
}

function buildCtes(opts: Pick<FamilyPaginationOptions, 'selectColumns' | 'joinSql' | 'whereSql' | 'matchRankSql' | 'rankCteSql' | 'matchTierSql' | 'familyMemberBaseWhereSql' | 'promotedRankSql' | 'familySortValueSql' | 'familyNumericSortSql' | 'candidateSql'> & { inlineFamilies?: boolean; drivenByListParam?: string; narrow?: boolean }) {
  const matchRankSelect = opts.matchRankSql ? `, (${opts.matchRankSql}) AS __match_rank` : ''
  // __fts_rank is productSearchQuery's FTS_RANK_CTE_NAME (not imported: keeps
  // this helper dependency-free). When matchRankSql reads its rank column,
  // join the rank CTE (LEFT JOIN gets an automatic index) instead of a
  // per-row subquery, which scanned the whole CTE per row. `matched` is then
  // MATERIALIZED: the page statement reads it twice (families + result rows)
  // and the planner re-ran the join in the second read without the index.
  const rankJoin = opts.matchRankSql?.includes('__fts_rank.') ? 'LEFT JOIN __fts_rank ON __fts_rank.id = p.id' : ''
  const matchRankAgg = opts.matchRankSql ? ', MIN(__match_rank) AS match_rank' : ''
  const matchTierSelect = opts.matchTierSql ? `, (${opts.matchTierSql}) AS __match_tier` : ''
  const matchTierAgg = opts.matchTierSql ? ', MIN(__match_tier) AS match_tier' : ''
  const promotedSelect = opts.promotedRankSql ? `, (${opts.promotedRankSql}) AS __promoted` : ''
  const promotedAgg = opts.promotedRankSql ? ', MAX(__promoted) AS family_promoted' : ''
  const sortValueSelect = opts.familySortValueSql ? `, (${opts.familySortValueSql}) AS __family_sort` : ''
  const sortValueAgg = opts.familySortValueSql ? ', MIN(__family_sort) AS family_sort_value' : ''
  const numericSortSelect = opts.familyNumericSortSql ? `, (${opts.familyNumericSortSql}) AS __family_num` : ''
  const numericSortAgg = opts.familyNumericSortSql ? ', MAX(__family_num) AS family_num_sort' : ''
  // family_members is only built (and only joined against, see below) when
  // familyMemberBaseWhereSql is actually passed -- omitted entirely for any
  // caller that hasn't opted in, so this stays a no-op for them (same CTEs,
  // same query shape, as before this option existed).
  const familyMembersCte = opts.familyMemberBaseWhereSql
    ? `,
    family_members AS (
      SELECT ${opts.selectColumns},
             ${FAMILY_ROOT_KEY_SQL} AS __family_root_id
      FROM products p
      LEFT JOIN products parent ON parent.id = p.parent_id
      ${opts.joinSql}
      WHERE ${opts.familyMemberBaseWhereSql}
    )`
    : ''
  if (opts.candidateSql && !opts.drivenByListParam) {
    return `
    WITH matched AS (
      SELECT ${FAMILY_ROOT_KEY_SQL} AS __family_root_id,
             lower(trim(COALESCE(parent.name, p.name))) AS __family_name,
             p.created_at AS __created_at${matchRankSelect}${matchTierSelect}${promotedSelect}${sortValueSelect}${numericSortSelect}
      FROM (${opts.candidateSql}) ${CANDIDATE_ALIAS}
      CROSS JOIN products p ON p.id = ${CANDIDATE_ALIAS}.id
      LEFT JOIN products parent ON parent.id = p.parent_id
      ${opts.joinSql}
      ${opts.whereSql}
    ),
    families AS ${opts.inlineFamilies ? 'NOT MATERIALIZED ' : ''}(
      SELECT __family_root_id AS family_root_id,
             MIN(__family_name) AS family_name,
             MAX(__created_at) AS latest_created_at${matchRankAgg}${matchTierAgg}${promotedAgg}${sortValueAgg}${numericSortAgg}
      FROM matched
      GROUP BY __family_root_id
    )
  `
  }
  return `
    WITH ${opts.rankCteSql ? `${opts.rankCteSql},` : ''}
    matched AS ${rankJoin && !opts.narrow ? 'MATERIALIZED ' : ''}(
      SELECT ${opts.narrow ? '' : `${opts.selectColumns},
             `}${FAMILY_ROOT_KEY_SQL} AS __family_root_id,
             lower(trim(COALESCE(parent.name, p.name))) AS __family_name,
             p.created_at AS __created_at${matchRankSelect}${matchTierSelect}${promotedSelect}${sortValueSelect}${numericSortSelect}
      ${opts.drivenByListParam
        ? `FROM json_each(@${opts.drivenByListParam}) __rank_j CROSS JOIN products p ON p.id = CAST(__rank_j.value AS INTEGER)`
        : 'FROM products p'}
      LEFT JOIN products parent ON parent.id = p.parent_id
      ${opts.joinSql}
      ${rankJoin}
      ${opts.whereSql}
    ),
    families AS ${opts.inlineFamilies ? 'NOT MATERIALIZED ' : ''}(
      SELECT __family_root_id AS family_root_id,
             MIN(__family_name) AS family_name,
             MAX(__created_at) AS latest_created_at${matchRankAgg}${matchTierAgg}${promotedAgg}${sortValueAgg}${numericSortAgg}
      FROM matched
      GROUP BY __family_root_id
    )${familyMembersCte}
  `
}

// The seekPage statement (see FamilyPaginationOptions.seekPage).
//
// Why a key can be turned into candidate ids without reading the catalogue: a row's family key is
//   COALESCE(NULLIF(COALESCE(parent.name_key, p.name_key), ''), 'id:' || COALESCE(parent.id, p.id))
// so a row with key K is one of
//   (a) p.name_key = K            (no parent, or a parent without a name_key)
//   (b) a child of a row whose name_key = K
//   (c) K = 'id:N' and p.id = N   (blank name, no parent)
//   (d) K = 'id:N' and p.parent_id = N
// Each is an index seek (idx_products_name_key_pg, idx_products_parent_pg, the primary key). The union is only a
// SUPERSET filter: the rows it admits still go through the caller's own WHERE and the exact
// `__family_root_id = page_families.family_root_id` join, so a stray candidate (a product literally named "id:5") can never
// reach the page.
function buildSeekPageSql(opts: FamilyPaginationOptions, familyOrderSql: string, intraFamilyOrderSql: string): string {
  const { selectColumns, joinSql, whereSql, matchRankSql, familyMemberBaseWhereSql } = opts
  const rankJoin = matchRankSql?.includes('__fts_rank.') ? 'LEFT JOIN __fts_rank ON __fts_rank.id = p.id' : ''
  // `matched` and `families` exactly as the default statement builds them; family_members is replaced by page_rows.
  const ctes = buildCtes({ ...opts, familyMemberBaseWhereSql: undefined, inlineFamilies: true, narrow: true })
  const rowsWhere = familyMemberBaseWhereSql
    ? familyMemberBaseWhereSql
    : whereSql.replace(/^\s*WHERE\s+/i, '') || '1 = 1'
  const rowsJoins = familyMemberBaseWhereSql ? joinSql : `${joinSql}
      ${rankJoin}`
  return `
    ${ctes},
    page_families AS MATERIALIZED (
      SELECT *, COUNT(*) OVER () AS family_total
      FROM families
      ORDER BY ${familyOrderSql}, family_root_id ASC
      LIMIT @__familyPageSize OFFSET @__familyOffset
    ),
    page_candidates AS MATERIALIZED (
      ${pageCandidatesSql(opts.parentSeek === true)}
    ),
    page_rows AS (
      SELECT ${selectColumns},
             ${FAMILY_ROOT_KEY_SQL} AS __family_root_id
      FROM page_candidates pc
      CROSS JOIN products p ON p.id = pc.id
      LEFT JOIN products parent ON parent.id = p.parent_id
      ${rowsJoins}
      WHERE (${rowsWhere})
    )
    SELECT page_rows.*, page_families.family_total AS __family_total
    FROM page_rows
    JOIN page_families ON page_families.family_root_id = page_rows.__family_root_id
    ORDER BY ${familyOrderSql}, page_families.family_root_id ASC, ${intraFamilyOrderSql}
  `
}

// The ids a page reads: the rows of its families' name keys, their children, and for a blank-named root 'id:N' the root and its children. Two spellings of the same four sets.
// The IN (SELECT ...) spelling leaves the child lookup to the planner, which scans the whole parent_id index (once per lookup) as soon as ANALYZE statistics exist: every product has a NULL
// parent_id, so the statistics say every key matches every row. The join spelling pins the order (CROSS JOIN) and the index (INDEXED BY idx_products_parent_pg), so the lookup is a seek.
export function pageCandidatesSql(parentSeek: boolean, familiesTable = 'page_families'): string {
  if (!parentSeek) return `SELECT id FROM products WHERE name_key IN (SELECT family_root_id FROM ${familiesTable})
      UNION SELECT id FROM products WHERE parent_id IN (SELECT id FROM products WHERE name_key IN (SELECT family_root_id FROM ${familiesTable}))
      UNION SELECT CAST(substr(family_root_id, 4) AS INTEGER) FROM ${familiesTable} WHERE substr(family_root_id, 1, 3) = 'id:'
      UNION SELECT id FROM products WHERE parent_id IN (SELECT CAST(substr(family_root_id, 4) AS INTEGER) FROM ${familiesTable} WHERE substr(family_root_id, 1, 3) = 'id:')`
  return `SELECT p.id FROM ${familiesTable} pf CROSS JOIN products p ON p.name_key = pf.family_root_id
      UNION SELECT c.id FROM ${familiesTable} pf CROSS JOIN products r ON r.name_key = pf.family_root_id CROSS JOIN products c INDEXED BY idx_products_parent_pg ON c.parent_id = r.id
      UNION SELECT CAST(substr(family_root_id, 4) AS INTEGER) FROM ${familiesTable} WHERE substr(family_root_id, 1, 3) = 'id:'
      UNION SELECT c.id FROM ${familiesTable} pf CROSS JOIN products c INDEXED BY idx_products_parent_pg ON c.parent_id = CAST(substr(pf.family_root_id, 4) AS INTEGER) WHERE substr(pf.family_root_id, 1, 3) = 'id:'`
}

export async function paginateProductFamilies<T = Record<string, unknown>>(
  options: FamilyPaginationOptions,
): Promise<FamilyPaginationResult<T>> {
  const opts = narrowRead(options, options.seekPage === true)
  const { db, params, page, pageSize, familyOrderSql, intraFamilyOrderSql, familyMemberBaseWhereSql } = opts
  const ctes = buildCtes(opts)
  // The COUNT only needs the families, not their ordering keys. SQLite does
  // not drop unused aggregates from the grouped CTE, so leaving the rank,
  // tier and promotion expressions in made the count evaluate a correlated
  // lookup per matched row for nothing (G37: 1,500 ranked ids rescanned
  // their own id list per row there, while the page statement indexed it).
  const countCtes = buildCtes({ ...opts, matchRankSql: undefined, matchTierSql: undefined, promotedRankSql: undefined, familySortValueSql: undefined, familyNumericSortSql: undefined, narrow: opts.seekPage === true })
  const offset = (page - 1) * pageSize
  // See familyMemberBaseWhereSql's own comment: opted-in callers get every
  // active row of a qualifying family (not just the ones that individually
  // matched whereSql); everyone else keeps selecting straight from
  // `matched`, unchanged.
  const resultSource = familyMemberBaseWhereSql ? 'family_members' : 'matched'

  // `family_root_id ASC` is appended to EVERY caller's familyOrderSql as the
  // terminal key, and it is not decoration: family_root_id is the GROUP BY
  // key of `families`, so it is unique per row and makes the window
  // function's ordering a TOTAL order. Without it, two families tying on
  // every key the caller supplied (two blank-named rows; two families with
  // the same lowercased name but different name_keys; any search where
  // several families share a bm25 score) get an arbitrary, run-to-run
  // ROW_NUMBER assignment -- and because paging is OFFSET-based over that
  // same ranking, page 2 can then repeat a family page 1 already showed and
  // drop one it never did. To an operator that reads exactly as "the
  // results are shuffled / the one I want is at the bottom", which is the
  // symptom this lane was opened for. Appending rather than replacing keeps
  // every existing caller's intended order intact.
  //
  // The COUNT and the ranked page SELECT share the same CTEs/params and have
  // no data dependency on each other (the page query doesn't need the
  // count's result), so they go over the wire as one db.batch() round trip
  // instead of two sequential prepare().get()/prepare().all() calls -- same
  // "independent reads, one batch" shape as
  // productMergeSnapshot.ts's runProductMergeReadBatch.
  const pageParams = { ...params, __familyOffset: offset, __familyOffsetEnd: offset + pageSize, __familyPageSize: pageSize }
  if (opts.seekPage) {
    const rows = await db.prepare(buildSeekPageSql(opts, familyOrderSql, intraFamilyOrderSql)).all<Record<string, unknown>>(pageParams)
    let total = Number(rows[0]?.__family_total) || 0
    // An empty first page means no family at all; any later empty page only says the page is past the end.
    if (!rows.length && page > 1) {
      const counted = await db.prepare(`${countCtes} SELECT COUNT(*) AS count FROM families`).get<{ count?: number }>(params)
      total = Number(counted?.count) || 0
    }
    return {
      items: rows.map((row) => {
        const { __family_root_id, __family_name, __created_at, __match_rank, __match_tier, __promoted, __family_sort, __family_num, __family_total, ...rest } = row
        return rest as unknown as T
      }),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    }
  }
  const [countResult, pageResult] = await db.batch([
    { sql: `${countCtes} SELECT COUNT(*) AS count FROM families`, params },
    {
      sql: `
        ${ctes},
        ranked AS (
          SELECT family_root_id, ROW_NUMBER() OVER (ORDER BY ${familyOrderSql}, family_root_id ASC) AS family_rank
          FROM families
        )
        SELECT ${resultSource}.*
        FROM ${resultSource}
        JOIN ranked ON ranked.family_root_id = ${resultSource}.__family_root_id
        WHERE ranked.family_rank > @__familyOffset AND ranked.family_rank <= @__familyOffsetEnd
        ORDER BY ranked.family_rank ASC, ${intraFamilyOrderSql}
      `,
      params: pageParams,
    },
  ])
  const total = Number((countResult?.results?.[0] as { count?: number } | undefined)?.count) || 0
  const rawRows = (pageResult?.results ?? []) as Record<string, unknown>[]

  const cleaned = (Array.isArray(rawRows) ? rawRows : []).map((row) => {
    const { __family_root_id, __family_name, __created_at, __match_rank, __match_tier, __promoted, __family_sort, __family_num, ...rest } = row
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

// ---- Ranked scope (INV-A S7, behind the read switch catalog_ranked_scope) --------------------------------------------------------------------------------------------
//
// The seekPage statement above re-ranks every family of the filtered catalogue on EVERY page of every scope (about 37K rows read cold at 8.6K products). A ranking does not
// depend on the page, only on the scope, so it is read once and shared: rankProductFamilies answers the ordered family keys of the WHOLE scope and its total, and
// pageFamiliesByKeys reads the rows of one page's keys without ranking anything. Together they return exactly the rows, order and total paginateProductFamilies({ seekPage })
// returns for the same options: same families table, same ORDER BY (the caller's familyOrderSql, then family_root_id), same candidate ids, same row filter, same intra-family order.

/** The ordered family keys of the whole scope, and the family total. */
export async function rankProductFamilies(options: FamilyPaginationOptions): Promise<{ keys: string[]; total: number }> {
  const opts = narrowRead(options, true)
  const { db, params, familyOrderSql } = opts
  const ctes = buildCtes({ ...opts, familyMemberBaseWhereSql: undefined, inlineFamilies: true, narrow: true })
  const rows = await db.prepare(`
    ${ctes}
    SELECT family_root_id FROM families ORDER BY ${familyOrderSql}, family_root_id ASC
  `).all<{ family_root_id: string }>(params)
  return { keys: rows.map((row) => String(row.family_root_id)), total: rows.length }
}

/** The rows of the given family keys, in the keys' order, then the caller's intra-family order. The candidate ids and the row filter are buildSeekPageSql's. */
export async function pageFamiliesByKeys<T = Record<string, unknown>>(opts: FamilyPaginationOptions, keys: readonly string[]): Promise<T[]> {
  if (!keys.length) return []
  const { db, params, selectColumns, joinSql, whereSql, matchRankSql, familyMemberBaseWhereSql, rankCteSql, intraFamilyOrderSql } = opts
  const rankJoin = matchRankSql?.includes('__fts_rank.') ? 'LEFT JOIN __fts_rank ON __fts_rank.id = p.id' : ''
  const rowsWhere = familyMemberBaseWhereSql ? familyMemberBaseWhereSql : whereSql.replace(/^\s*WHERE\s+/i, '') || '1 = 1'
  const rowsJoins = familyMemberBaseWhereSql ? joinSql : `${joinSql}
      ${rankJoin}`
  const rows = await db.prepare(`
    WITH ${rankCteSql ? `${rankCteSql},` : ''}
    page_families AS MATERIALIZED (SELECT value AS family_root_id, key AS family_pos FROM json_each(@__familyKeys)),
    page_candidates AS MATERIALIZED (
      ${pageCandidatesSql(true)}
    ),
    page_rows AS (
      SELECT ${selectColumns},
             ${FAMILY_ROOT_KEY_SQL} AS __family_root_id
      FROM page_candidates pc
      CROSS JOIN products p ON p.id = pc.id
      LEFT JOIN products parent ON parent.id = p.parent_id
      ${rowsJoins}
      WHERE (${rowsWhere})
    )
    SELECT page_rows.*
    FROM page_rows
    JOIN page_families ON page_families.family_root_id = page_rows.__family_root_id
    ORDER BY page_families.family_pos ASC, ${intraFamilyOrderSql}
  `).all<Record<string, unknown>>({ ...params, __familyKeys: JSON.stringify(keys) })
  return rows.map((row) => {
    const { __family_root_id, ...rest } = row
    return rest as unknown as T
  })
}

// ---- Typed search order in JS (read switch products_typed_order_js) ----------------------------------------------------------------------------------------------------
//
// A till's typed search sends up to 1,500 ranked ids. The seek-page statement groups every listed id into families in SQL (GROUP BY, COUNT(*) OVER (), ORDER BY: about 9 rows read per listed id) and
// then walks the whole id list three times to pick the page's member rows. The order of such a read is  match_tier ASC, family_promoted DESC, match_rank ASC, <sort tail>, family_root_id  and
// match_rank is the id's position in the list's deduplicated CSV (parseRankedIds), so MIN(match_rank) is unique per family: (tier, promoted, rank) is already a total order and the tail never
// decides. So: ONE lean read of the matched rows driven by the list (family key, tier, promoted, rank), the families grouped and ordered here, then only the page's families read by key.

export interface RankedIdFamilyRow { k: unknown; r: unknown; t: unknown; pr: unknown }

/** The family keys of the matched rows in page order (tier ASC, promoted DESC, best rank ASC), or null when the order is not provably the SQL order: a rank that is not a positive integer, or two
 * families tied on all three keys (impossible while positions are unique; if it ever happened the SQL tail would decide, so the caller must run the SQL path). Keys group by exact string, like
 * the SQL GROUP BY (BINARY collation). */
export function orderRankedIdFamilies(rows: readonly RankedIdFamilyRow[]): string[] | null {
  const families = new Map<string, { k: string; r: number; t: number; pr: number }>()
  for (const row of rows) {
    const k = String(row.k), r = Number(row.r), t = Number(row.t), pr = Number(row.pr) || 0
    if (!Number.isInteger(r) || r <= 0 || !Number.isFinite(t)) return null
    const f = families.get(k)
    if (!f) families.set(k, { k, r, t, pr })
    else { if (r < f.r) f.r = r; if (t < f.t) f.t = t; if (pr > f.pr) f.pr = pr }
  }
  const ordered = [...families.values()].sort((a, b) => (a.t - b.t) || (b.pr - a.pr) || (a.r - b.r))
  for (let i = 1; i < ordered.length; i += 1) {
    const a = ordered[i - 1], b = ordered[i]
    if (a.t === b.t && a.pr === b.pr && a.r === b.r) return null
  }
  return ordered.map((f) => f.k)
}

/** The family order paginateRankedIdFamilies reproduces. A read whose order does not start with exactly these keys never takes that path. */
export const TYPED_ORDER_PREFIX = 'match_tier ASC, family_promoted DESC, match_rank ASC'

/** Whether a read may take the typed-order path: a ranked-id hydrate on the seek-page path (300 ids or more: shorter lists keep the one-batch statements, which are faster for them), not a restricted
 * read (Inventory Check keeps the ranked scope), not an image-only or by-id read, and an order that starts with exactly TYPED_ORDER_PREFIX. */
export function typedOrderEligible(read: { restricted: boolean; seekPageRead: boolean; rankedIdCount: number; imageOnly: boolean; byId: boolean; orderSql: string }): boolean {
  return !read.restricted && read.seekPageRead && read.rankedIdCount > 0 && !read.imageOnly && !read.byId && read.orderSql.startsWith(TYPED_ORDER_PREFIX)
}

/** The driven read's WHERE: the term that lists the ids replaced by 1 = 1. Not exactly one such term means the read is not the shape the driving join is exact for: undefined, and the statement it always ran is used. */
export function typedOrderDrivenRead(where: readonly string[], driver: { listParam: string; listedWhereSql: string; csvMemberWhereSql: string }): RankedIdDrivenRead | undefined {
  if (where.filter((term) => term === driver.listedWhereSql).length !== 1) return undefined
  return { listParam: driver.listParam, drivenWhereSql: `WHERE ${where.map((term) => (term === driver.listedWhereSql ? '1 = 1' : term)).join(' AND ')}`, csvMemberWhereSql: driver.csvMemberWhereSql }
}

/** A ranked-id hydrate read in two statements instead of one (see the section comment). Returns null when the order could not be proved exact; the caller then runs the SQL path. */
export async function paginateRankedIdFamilies<T = Record<string, unknown>>(opts: FamilyPaginationOptions, driven: RankedIdDrivenRead): Promise<FamilyPaginationResult<T> | null> {
  const { db, params, page, pageSize } = opts
  const ctes = buildCtes({ ...opts, candidateSql: undefined, whereSql: driven.drivenWhereSql, familyMemberBaseWhereSql: undefined, inlineFamilies: true, drivenByListParam: driven.listParam, narrow: true })
  const rows = await db.prepare(`${ctes} SELECT __family_root_id AS k, __match_rank AS r, __match_tier AS t, ${opts.promotedRankSql ? '__promoted' : '0'} AS pr FROM matched`).all<RankedIdFamilyRow>(params)
  const keys = orderRankedIdFamilies(rows)
  if (!keys) return null
  const items = await pageFamiliesByKeys<T>({ ...opts, familyMemberBaseWhereSql: driven.csvMemberWhereSql }, keys.slice((page - 1) * pageSize, page * pageSize))
  return { items, total: keys.length, page, pageSize, totalPages: Math.max(1, Math.ceil(keys.length / pageSize)) }
}
