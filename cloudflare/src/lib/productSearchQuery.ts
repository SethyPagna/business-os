// productSearchQuery.ts -- the ONE product-search WHERE + relevance
// implementation every product picker in the app orders by.
//
// Why this file exists. Four route files (products.ts, inventory.ts,
// branches.ts and, historically, portal.ts) each carried their own
// hand-copied version of the same ~90-line "search tail": FTS5 MATCH,
// the two trigram tables, the hybrid/short-word/partial-word fallbacks,
// and the exact-barcode disjunct. Copies drift, and they had: products.ts
// and inventory.ts computed a bm25 relevance rank, branches.ts (the
// Transfer picker and the per-branch search on the Branches page) computed
// a rank ONLY when the typed text was a lone barcode, so every ordinary
// name search there came back in plain `family_name ASC` order -- the
// closest match sitting wherever the alphabet happened to put it, which is
// exactly the reported "it shows products not really matched top to bottom
// ... feels like the likely result was at bottom". Copying the ranking
// expression into branches.ts a fourth time would have fixed that one
// picker and left the next new picker to repeat the bug, so the tail and
// the ranking moved here instead and every picker endpoint calls this.
//
// THE ORDERING CONTRACT (this is the whole point of the file):
//   1. exact barcode match          -- match_tier 0
//   2. exact name match             -- match_tier 1
//   3. name-prefix match            -- match_tier 2
//   4. every other field match      -- match_tier 3, ordered by bm25
//   5. a deterministic tiebreak     -- family_name, then family_root_id
//      (added by lib/familyPagination.ts for every caller, so a family that
//      ties on all of the above can never swap places between page 1 and
//      page 2 -- an unstable ORDER BY under OFFSET pagination silently
//      repeats and drops rows, which reads to an operator as "the results
//      are shuffled").
//
// The tier is returned SEPARATELY from the bm25 rank (`matchTierSql` vs.
// `matchRankSql`) rather than folded into one number, because the Products
// page and POS interleave a third ordering key between them: promoted/
// discounted families lead *within* a relevance tier (the G1b rule). Tier
// first means a discounted-but-barely-relevant product can no longer
// outrank the exact product the operator typed, while "among equally
// relevant matches, discounts top" still holds.
//
// Nothing here selects, picks or adds anything: a scan fills the search
// box and narrows the list, and the operator still chooses the row. This
// file only decides what order the narrowed list is drawn in.

import { catalogProductSql, stockVisibleProductSql } from './productStockGuard'
import {
  buildExactBarcodeMatchClause,
  exactBarcodePredicateSql,
  buildExactBarcodeRankSql,
  buildFtsMatchExpression,
  buildHybridMatchClause,
  buildPartialWordMatchClause,
  buildShortWordFallbackClause,
  buildTrigramMatchExpression,
  normalizeSearchText,
  normalizedBarcodeDigitsSql,
  normalizedBarcodeSql,
  PRODUCT_SEARCH_COLUMNS,
  PRODUCTS_FTS_BM25_SQL,
  searchTermBarcodeKey,
  searchTermBarcodeKeys,
  limitSearchTermGroups,
  SEARCH_MAX_GROUPS,
  SEARCH_MAX_WORDS,
  tokenizeSearchTermGroups,
} from './searchMatch'

export interface ProductSearchQueryOptions {
  catalogOnly?: boolean
  // Search mode from the AND/OR toggle. Anything but 'OR' means AND.
  mode?: string
  // name-only search (Products' "search titles only" switch). Disables the
  // barcode/sku trigram table, the hybrid clause and the exact-barcode
  // disjunct, exactly as the inline copies did.
  titleOnly?: boolean
  // false = the FTS migrations are not on this database yet; fall back to a
  // narrower LIKE scan rather than 500ing. Ported verbatim from
  // products.ts's `options.useSearchIndex === false` branch.
  useSearchIndex?: boolean
  // Column aliases, so a caller joining products under a different alias
  // (none today) or a future surface with its own normalized columns can
  // reuse this without a second copy.
  nameNormalizedColumn?: string
  nameColumn?: string
  barcodeColumn?: string
  // Bound-parameter prefix. Left empty by default so the parameter names
  // this produces (@ftsQuery, @codeQuery, @nameCodeQuery, @barcodeKey, ...)
  // are byte-identical to the ones the four inline copies bound -- a route
  // that also binds its own params cannot collide by adopting this.
  paramPrefix?: string
  // G37: matches the client's shared-core index already chose, in rank
  // order (see parseRankedIds). When present the typed text is not matched
  // again here; these ids become the match set and their order the rank.
  rankedIds?: RankedIds
}

// ---- ranked ids (G37 phase 1) ------------------------------------------
//
// The admin pickers match on the client, over the term index built by the
// shared core (lib/searchCore.ts), and send the ranked ids here with the
// filters only the server can evaluate (branch stock, promotions, issues,
// brand/category). Paging, family grouping, promotions, prices and stock
// stay server-side; the WHERE becomes one json_each IN-list instead of the
// FTS/trigram/LIKE disjunction, so the expression depth is constant (no
// growth with the number of ids or words) and the rows read are PK
// lookups of the listed ids.
//
// The rank is the id's character position in one ",id,id," string
// (instr), and the tier is that position against the tier boundaries.
// Deliberately no CTE lookup: SQLite's planner chose to rescan a
// materialized id list once per matched row in some statements (1,500 x
// 1,500 rows), which an instr over a bound string can never do.
//
// Wire format: rankIds=12,45,9 (positive integers, best first) and
// rankTiers=013 (one digit 0-4 per id, the core's tier; missing digits read
// as 3). At most RANKED_ID_LIMIT ids are used.
export const RANKED_ID_LIMIT = 1500

export interface RankedIds {
  ids: number[]
  tiers: number[]
}

export function parseRankedIds(rawIds: unknown, rawTiers?: unknown): RankedIds | undefined {
  if (rawIds == null || String(rawIds).trim() === '') return undefined
  const seen = new Set<number>()
  const ids: number[] = []
  const tiers: number[] = []
  const tierText = String(rawTiers ?? '')
  String(rawIds).split(',').forEach((raw, position) => {
    const text = raw.trim()
    if (!/^\d{1,15}$/.test(text) || ids.length >= RANKED_ID_LIMIT) return
    const id = Number(text)
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) return
    seen.add(id)
    ids.push(id)
    const tier = Number(tierText[position])
    tiers.push(Number.isInteger(tier) && tier >= 0 && tier <= 4 ? tier : MATCH_TIER_OTHER)
  })
  return { ids, tiers }
}

// The family-member predicate of a ranked-id read, asked per candidate row against the list's CSV (the same deduplicated ids as the JSON list) instead of as three IN-lists over the whole
// list: the row is listed, or its parent is, or it is the parent of a listed row. Same set as familyMemberWhereSql, so a page of a few families reads its own rows (typed-search order in JS,
// products_typed_order_js). The text after the visibility term must stay the three terms of familyMemberWhereSql; the parity test pins it.
function rankedIdCsvMemberWhereSql(csvParam: string, catalogOnly: boolean): string {
  const csv = `@${csvParam}`
  const visible = catalogOnly ? catalogProductSql('p', false) : stockVisibleProductSql('p', false)
  return `${visible} AND (instr(${csv}, ',' || p.id || ',') > 0 OR (p.parent_id IS NOT NULL AND instr(${csv}, ',' || p.parent_id || ',') > 0) OR EXISTS (SELECT 1 FROM products listed WHERE listed.parent_id = p.id AND instr(${csv}, ',' || listed.id || ',') > 0))`
}

function buildRankedIdSearchQuery(ranked: RankedIds, params: Record<string, unknown>, prefix: string, titleOnly: boolean, catalogOnly = false): ProductSearchQuery {
  // Present but unusable resolves to no rows, never to the whole catalog.
  if (!ranked.ids.length) return { hasSearchTerm: true, titleOnly, whereClause: '1 = 0' }
  // Tier first (stable), so each tier is one contiguous run of the string.
  const order = ranked.ids.map((id, index) => ({ id, tier: ranked.tiers[index] ?? MATCH_TIER_OTHER, index }))
    .sort((a, b) => (a.tier - b.tier) || (a.index - b.index))
  params[`${prefix}rankIdList`] = JSON.stringify(order.map((entry) => entry.id))
  let csv = ','
  const cuts = [0, 0, 0, 0, 0]
  for (const entry of order) {
    for (let tier = entry.tier + 1; tier <= 4; tier += 1) if (!cuts[tier]) cuts[tier] = csv.length
    csv += `${entry.id},`
  }
  for (let tier = 1; tier <= 4; tier += 1) {
    if (!cuts[tier]) cuts[tier] = csv.length + 1
    params[`${prefix}rankTierCut${tier}`] = cuts[tier]
  }
  params[`${prefix}rankCsv`] = csv
  const position = `instr(@${prefix}rankCsv, ',' || p.id || ',')`
  const listed = `(SELECT CAST(value AS INTEGER) FROM json_each(@${prefix}rankIdList))`
  return {
    hasSearchTerm: true,
    titleOnly,
    whereClause: `p.id IN ${listed}`,
    activeWhereSql: catalogOnly ? catalogProductSql('p', false) : stockVisibleProductSql('p', false),
    familyMemberWhereSql: `${catalogOnly ? catalogProductSql('p', false) : stockVisibleProductSql('p', false)} AND (p.id IN ${listed} OR p.parent_id IN ${listed} OR p.id IN (SELECT listed.parent_id FROM products listed WHERE listed.id IN ${listed}))`,
    rankedIdDriver: {
      listParam: `${prefix}rankIdList`,
      listedWhereSql: `p.id IN ${listed}`,
      csvMemberWhereSql: rankedIdCsvMemberWhereSql(`${prefix}rankCsv`, catalogOnly),
    },
    candidates: { idsSql: `SELECT CAST(value AS INTEGER) AS id, NULL AS r FROM json_each(@${prefix}rankIdList)`, matchRankSql: position },
    matchRankSql: position,
    matchTierSql: `(CASE WHEN ${position} < @${prefix}rankTierCut1 THEN 0 WHEN ${position} < @${prefix}rankTierCut2 THEN 1 WHEN ${position} < @${prefix}rankTierCut3 THEN 2 WHEN ${position} < @${prefix}rankTierCut4 THEN 3 ELSE 4 END)`,
  }
}

export interface ProductSearchQuery {
  // True once the caller actually typed something (used by products.ts to
  // gate its sibling-expansion behaviour).
  hasSearchTerm: boolean
  // The OR-joined disjunction of every match strategy, or undefined when
  // nothing was typed. Callers push this into their own WHERE list.
  whereClause?: string
  // bm25 relevance (+ the exact-barcode offset), or undefined when nothing
  // was typed / nothing scored. ASC. When it reads the FTS rank it refers
  // to the `rankCteSql` CTE's columns, so it is only valid inside a statement
  // whose WITH carries that CTE and whose FROM joins it (lib/familyPagination.ts
  // does both for you).
  matchRankSql?: string
  // `__fts_rank AS MATERIALIZED (...)`: the products_fts MATCH run ONCE per
  // statement, yielding (id, rank) for every FTS hit. Set exactly when
  // matchRankSql references it. See FTS_RANK_CTE_NAME.
  rankCteSql?: string
  // Discrete relevance tier, 0..3 per the contract above. ASC. Undefined
  // when nothing was typed.
  matchTierSql?: string
  titleOnly: boolean
  // Ranked-id path only. The caller's own "p.is_active = 1" term, spelled
  // so it cannot drive an index: without it SQLite (no ANALYZE stats)
  // walks every active row of idx_products_active_grouped_pg and tests the
  // id list per row, instead of looking the listed ids up by primary key.
  activeWhereSql?: string
  // Ranked-id path only. The family-member predicate for
  // familyPagination's familyMemberBaseWhereSql: the listed rows and their
  // parent/child links, instead of every active product (a full scan per
  // page). Same-name siblings still arrive through the name_key expansion.
  familyMemberWhereSql?: string
  // Ranked-id path only. What the typed-search order in JS needs (products_typed_order_js): the name of the JSON id-list parameter, the exact WHERE term that lists the ids (so a driving
  // read can replace it by 1 = 1 and start from the list), and the CSV spelling of familyMemberWhereSql.
  rankedIdDriver?: { listParam: string; listedWhereSql: string; csvMemberWhereSql: string }
  // The same match set as whereClause, as a SOURCE of ids instead of a predicate to test on every product (see ProductSearchCandidates). Absent on the paths that have no such
  // source (the LIKE fallback, a search with nothing to match); the statement then keeps whereClause.
  candidates?: ProductSearchCandidates
}

// The match set of a typed search as a list of ids. whereClause is an OR of terms, and one of them (the exact-barcode catch-all over the stored column) can only be tested row by row,
// which makes the planner read EVERY active product for every typed search whatever the text matches. Each term of that OR names a set of products, so the union of the sets is the
// same match set found by seeks: the statement starts from this list (CROSS JOIN products p ON p.id = __cand.id) and its WHERE carries the caller's other terms with the search term
// replaced by 1 = 1 (lib/familyPagination.ts candidateSql).
//   idsSql         SELECT id, r ... ; r is the FTS bm25 of the row that came from the products_fts term and NULL for every other source. One product can appear more than once (the
//                  sources overlap); everything the family statement computes from the rows is a MIN or MAX over them, so a repeat changes nothing.
//   matchRankSql   matchRankSql with the bm25 read from __cand.r instead of the rank CTE. A product reached by several sources takes its FTS row's value: bm25 is never positive (FTS5
//                  scores a hit as minus a sum of non-negative terms), and the other sources contribute 0, so the family's MIN is the FTS value exactly as the CTE's LEFT JOIN gave it.
export interface ProductSearchCandidates {
  idsSql: string
  matchRankSql?: string
}
// The alias the candidate list is given in the statement (lib/familyPagination.ts spells the same name; scripts/test-products-search-candidates-pure.cjs pins both).
export const PRODUCT_SEARCH_CANDIDATE_ALIAS = '__cand'

// Relevance tier constants, exported so tests can assert the contract by
// name instead of by magic number.
export const MATCH_TIER_EXACT_BARCODE = 0
export const MATCH_TIER_EXACT_NAME = 1
export const MATCH_TIER_NAME_PREFIX = 2
export const MATCH_TIER_OTHER = 3

// The per-statement FTS rank table. bm25() only scores rows the FTS5 table
// itself matched and must be evaluated inside a query carrying that table's
// own MATCH. It used to be a correlated scalar subquery
// (`... WHERE products_fts.rowid = p.id AND products_fts MATCH ...`), which
// re-ran the whole MATCH for every candidate row: a common word ("glow",
// 242 products) or a 2-letter prefix ("ro", 458) cost 216-358 ms per
// statement on the seeded lab DB, twice per search (count + page).
// MATERIALIZED runs the MATCH once (I4-1). The per-row read must be a
// LEFT JOIN on the CTE (lib/familyPagination.ts adds it when matchRankSql
// reads the CTE), never a correlated `SELECT ... FROM __fts_rank WHERE id =
// p.id`: a CTE has no index, so that form scanned the whole table once per
// candidate row (a join gets an automatic index built once).
export const FTS_RANK_CTE_NAME = '__fts_rank'

// The stored, already-normalized name column with a cheap fallback for any
// row written before migration 0037_product_search_compact_columns_01
// backfilled it. Deliberately NOT normalizedHaystackSql() -- that is the
// ~78-level nested REPLACE() chain that trips D1's expression-depth limit,
// and this expression is evaluated once per candidate row.
function normalizedNameSql(nameNormalizedColumn: string, nameColumn: string): string {
  return `COALESCE(NULLIF(${nameNormalizedColumn}, ''), lower(trim(COALESCE(${nameColumn}, ''))))`
}

// The relevance tier expression. See THE ORDERING CONTRACT at the top.
//
// `normalizeSearchText` runs on the typed text here and already ran on the
// stored text at write time (lib/productWrites.ts's insertRow), so the two
// sides compare on the same footing: diacritics folded, joiner punctuation
// treated as spaces, shade-code O/0 folded. That also means the typed key
// can never contain a LIKE metacharacter -- normalizeSearchText keeps only
// letters, numbers and single spaces -- so the prefix probe needs no
// ESCAPE clause.
function buildMatchTierSql(
  rawSearchText: string,
  params: Record<string, unknown>,
  opts: {
    prefix: string
    nameNormalizedColumn: string
    nameColumn: string
    barcodeColumn: string
    includeBarcodeTier: boolean
  },
): string | undefined {
  const nameKey = normalizeSearchText(rawSearchText)
  const barcodeKey = opts.includeBarcodeTier ? searchTermBarcodeKey(rawSearchText) : ''
  if (!nameKey && !barcodeKey) return undefined

  const branches: string[] = []
  if (barcodeKey) {
    // Same bound parameter buildExactBarcodeMatchClause binds (`barcodeKey`
    // under this prefix) -- the WHERE disjunct and this tier must agree on
    // what "the scanned code" is, so they share the value rather than
    // normalizing it twice.
    branches.push(`WHEN ${exactBarcodePredicateSql(`${opts.prefix}barcodeKey`, opts.barcodeColumn)} THEN ${MATCH_TIER_EXACT_BARCODE}`)
  }
  if (nameKey) {
    const normalizedName = normalizedNameSql(opts.nameNormalizedColumn, opts.nameColumn)
    params[`${opts.prefix}nameExactKey`] = nameKey
    branches.push(`WHEN ${normalizedName} = @${opts.prefix}nameExactKey THEN ${MATCH_TIER_EXACT_NAME}`)
    // D1 caps a bound LIKE pattern at 50 characters. A full product name can
    // legitimately exceed that (for example "Clarins Super Restorative
    // Decollete And Neck Concentrate 75ml"), so binding `${nameKey}%` made
    // an otherwise valid exact-name search fail before FTS results could be
    // returned. `instr(...)=1` is the same literal-prefix test here because
    // normalizeSearchText has already removed LIKE metacharacters.
    branches.push(`WHEN instr(${normalizedName}, @${opts.prefix}nameExactKey) = 1 THEN ${MATCH_TIER_NAME_PREFIX}`)
  }
  if (!branches.length) return undefined
  return `(CASE ${branches.join(' ')} ELSE ${MATCH_TIER_OTHER} END)`
}

// The ids of products whose barcode is the typed code, as seeks: the literal forms the catalog stores (the barcode index), then the normalized catch-all (idx_products_barcode_key,
// migration 0307; without that index the same statement scans the barcode index, as the old WHERE did). Same set as buildExactBarcodeMatchClause: the guard terms on the pair flag are
// constants, so only the branch for the typed key's kind runs. The pair branch seeks the NORMALIZED form of its two codes (the leading zeros dropped, which is what the index holds) and
// then keeps only rows whose zero-preserving form is one of them, so it returns exactly the rows `digits IN (upcA, upcE)` returned.
function exactBarcodeCandidatesSql(params: Record<string, unknown>, paramName: string, column: string): string {
  const equalities: string[] = []
  for (let index = 0; Object.hasOwn(params, `${paramName}Eq${index}`); index += 1) equalities.push(`@${paramName}Eq${index}`)
  const rawColumn = column.includes('.') ? column.slice(column.lastIndexOf('.') + 1) : column
  const upcA = `@${paramName}UpcA`, upcE = `@${paramName}UpcE`
  return `SELECT id AS id, NULL AS r FROM products WHERE ${rawColumn} IN (${equalities.join(', ')})
    UNION SELECT p.id, NULL FROM products p WHERE @${paramName}Pair = 1 AND ${normalizedBarcodeSql(column)} IN (ltrim(${upcA}, '0'), ltrim(${upcE}, '0')) AND ${normalizedBarcodeDigitsSql(column)} IN (${upcA}, ${upcE})
    UNION SELECT p.id, NULL FROM products p WHERE @${paramName}Pair = 0 AND ${normalizedBarcodeSql(column)} = @${paramName}`
}

// D1 refuses a compound SELECT of more than 5 terms: sources beyond four are nested one level, which keeps every compound at or under it.
function unionAllCandidates(selects: string[]): string {
  if (selects.length <= 5) return selects.join(' UNION ALL ')
  const wrapped: string[] = []
  for (let index = 0; index < selects.length; index += 4) wrapped.push(`SELECT id, r FROM (${selects.slice(index, index + 4).join(' UNION ALL ')})`)
  return unionAllCandidates(wrapped)
}

// Builds the product-search WHERE disjunction and both ordering
// expressions for a typed/scanned search box value. Mutates `params` with
// every value it binds (same convention the searchMatch.ts builders use).
//
// The strategy list below is the union of what the four inline copies did,
// in the same order, so adopting this changes NO route's matching
// behaviour -- only branches.ts gains the bm25 rank it never computed, and
// every caller gains the tier. Each strategy's own "why" lives on its
// builder in lib/searchMatch.ts; the one-line notes here say only what the
// clause is for.
function buildProductSearchQueryFromGroups(
  rawSearchText: string,
  params: Record<string, unknown>,
  options: ProductSearchQueryOptions,
  termGroups: string[][],
): ProductSearchQuery {
  const prefix = options.paramPrefix || ''
  const nameNormalizedColumn = options.nameNormalizedColumn || 'p.name_normalized'
  const nameColumn = options.nameColumn || 'p.name'
  const barcodeColumn = options.barcodeColumn || 'p.barcode'
  const titleOnly = Boolean(options.titleOnly)
  const mode = String(options.mode || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'

  // A checked UPC-E/UPC-A query is an exact scanner lookup. Letting it also
  // enter FTS/trigram matching would re-admit an unrelated seven-digit
  // internal code through the UPC-E's stripped digits. Keep name-only mode
  // unchanged, but make barcode mode use only the guarded pair predicate.
  const exactSearchKeys = titleOnly ? [] : searchTermBarcodeKeys(rawSearchText)
  const guardedUpcPair = exactSearchKeys.some((key) => key.startsWith('upca:') || key.startsWith('upce:'))
  if (guardedUpcPair) {
    const exactBarcodeMatch = buildExactBarcodeMatchClause(rawSearchText, params, `${prefix}barcodeKey`, barcodeColumn)
    const pairRankSql = exactBarcodeMatch ? buildExactBarcodeRankSql(`${prefix}barcodeKey`, barcodeColumn) : undefined
    return {
      hasSearchTerm: true,
      titleOnly,
      whereClause: exactBarcodeMatch,
      matchRankSql: pairRankSql,
      candidates: exactBarcodeMatch ? { idsSql: `SELECT id, r FROM (${exactBarcodeCandidatesSql(params, `${prefix}barcodeKey`, barcodeColumn)})`, matchRankSql: pairRankSql } : undefined,
      matchTierSql: buildMatchTierSql(rawSearchText, params, {
        prefix, nameNormalizedColumn, nameColumn, barcodeColumn, includeBarcodeTier: true,
      }),
    }
  }

  // Compatibility path for a database that has not received the FTS
  // migrations yet: narrower and slower, but a catalog search must still
  // return rows instead of a 500 while migration catch-up runs. No index,
  // so no bm25 -- the tier below is still computed, which is what keeps an
  // exact name/barcode hit at the top even on this path.
  if (options.useSearchIndex === false) {
    const fallbackColumns = titleOnly ? [nameColumn] : [nameColumn, 'p.sku', barcodeColumn]
    const allWords = termGroups.flat()
    const wordClauses = allWords.map((word, index) => {
      const key = `${prefix}fallbackSearch${index}`
      params[key] = String(word).toLowerCase()
      return `(${fallbackColumns.map((column) => `instr(lower(COALESCE(${column}, '')), @${key}) > 0`).join(' OR ')})`
    })
    if (!wordClauses.length) return { hasSearchTerm: true, titleOnly }
    // The exact-barcode tier needs its own bound value on this path too
    // (buildExactBarcodeMatchClause is not called here), so bind it.
    const exactBarcodeMatch = titleOnly ? undefined : buildExactBarcodeMatchClause(rawSearchText, params, `${prefix}barcodeKey`, barcodeColumn)
    const fallbackWhere = wordClauses.join(mode === 'OR' ? ' OR ' : ' AND ')
    return {
      hasSearchTerm: true,
      titleOnly,
      whereClause: exactBarcodeMatch ? `((${fallbackWhere}) OR ${exactBarcodeMatch})` : `(${fallbackWhere})`,
      matchTierSql: buildMatchTierSql(rawSearchText, params, {
        prefix, nameNormalizedColumn, nameColumn, barcodeColumn, includeBarcodeTier: !titleOnly,
      }),
    }
  }

  const matchClauses: string[] = []
  // One id source per term of matchClauses that names its set by an index (see ProductSearchCandidates). The hybrid, short-word and partial-word terms combine several lookups with AND / OR and
  // brand scans (some capped by an unordered LIMIT), so no source reproduces them exactly: a search that carries one keeps its predicate form (unsourced).
  const sources: string[] = []
  let unsourced = false

  // 1. FTS5 word/prefix match over name (+sku/barcode unless titleOnly).
  const ftsMatch = buildFtsMatchExpression(termGroups, mode, titleOnly ? 'name' : PRODUCT_SEARCH_COLUMNS)
  if (ftsMatch) {
    params[`${prefix}ftsQuery`] = ftsMatch
    matchClauses.push(`p.id IN (SELECT rowid FROM products_fts WHERE products_fts MATCH @${prefix}ftsQuery)`)
    sources.push(`SELECT rowid AS id, ${titleOnly ? 'NULL' : PRODUCTS_FTS_BM25_SQL} AS r FROM products_fts WHERE products_fts MATCH @${prefix}ftsQuery`)
  }

  // 2 + 3. Trigram substring tables. One expression, two tables: barcode/
  // sku mid-token fragments, and fused name tokens like "100ml"/"110C".
  const trigramMatch = buildTrigramMatchExpression(termGroups, mode)
  if (trigramMatch && !titleOnly) {
    params[`${prefix}codeQuery`] = trigramMatch
    matchClauses.push(`p.id IN (SELECT rowid FROM products_fts_code WHERE products_fts_code MATCH @${prefix}codeQuery)`)
    sources.push(`SELECT rowid AS id, NULL AS r FROM products_fts_code WHERE products_fts_code MATCH @${prefix}codeQuery`)
  }
  if (trigramMatch) {
    params[`${prefix}nameCodeQuery`] = trigramMatch
    matchClauses.push(`p.id IN (SELECT rowid FROM products_fts_name_trigram WHERE products_fts_name_trigram MATCH @${prefix}nameCodeQuery)`)
    sources.push(`SELECT rowid AS id, NULL AS r FROM products_fts_name_trigram WHERE products_fts_name_trigram MATCH @${prefix}nameCodeQuery`)
  }

  // 4. Mixed group (one comma-group holding both a word and a code
  // fragment), which neither table resolves alone.
  const visibleProducts = options.catalogOnly ? catalogProductSql() : stockVisibleProductSql()
  const hybridMatch = titleOnly ? undefined : buildHybridMatchClause(termGroups, mode, `${prefix}hyb`, PRODUCT_SEARCH_COLUMNS, visibleProducts)
  if (hybridMatch) {
    Object.assign(params, hybridMatch.params)
    matchClauses.push(hybridMatch.sql)
    unsourced = true
  }

  // 5. Sub-3-character words (FTS5's trigram tokenizer emits nothing below
  // 3 chars), name only, on the precomputed normalized column.
  const shortWordMatch = buildShortWordFallbackClause(termGroups, mode, [nameNormalizedColumn], params, `${prefix}shortw`, true, visibleProducts)
  if (shortWordMatch) {
    matchClauses.push(shortWordMatch)
    unsourced = true
  }

  // 6. Long (4+ word) queries, partial-word, name only.
  const partialMatch = buildPartialWordMatchClause(termGroups, mode, [nameNormalizedColumn], params, `${prefix}partialw`, 4, true, visibleProducts)
  if (partialMatch) {
    matchClauses.push(partialMatch)
    unsourced = true
  }

  // 7. Exact barcode with leading zeros folded on both sides (the
  // GTIN-14/EAN-13 twin problem), first in the list so it reads first.
  const exactBarcodeMatch = titleOnly
    ? undefined
    : buildExactBarcodeMatchClause(rawSearchText, params, `${prefix}barcodeKey`, barcodeColumn)
  if (exactBarcodeMatch) {
    matchClauses.unshift(exactBarcodeMatch)
    sources.unshift(`SELECT id, r FROM (${exactBarcodeCandidatesSql(params, `${prefix}barcodeKey`, barcodeColumn)})`)
  }

  if (!matchClauses.length) return { hasSearchTerm: true, titleOnly }

  let matchRankSql: string | undefined
  let rankCteSql: string | undefined
  // The FTS rank is computed once per statement in rankCteSql (see
  // FTS_RANK_CTE_NAME for why) and joined per row by familyPagination. Rows
  // that arrived via a trigram/LIKE fallback have no FTS hit, COALESCE to 0
  // and stay orderable rather than dropping out of the sort.
  if (!titleOnly && ftsMatch) {
    rankCteSql = `${FTS_RANK_CTE_NAME} AS MATERIALIZED (SELECT rowid AS id, ${PRODUCTS_FTS_BM25_SQL} AS bm25_rank FROM products_fts WHERE products_fts MATCH @${prefix}ftsQuery)`
    matchRankSql = `COALESCE(${FTS_RANK_CTE_NAME}.bm25_rank, 0)`
  }
  // Kept for callers that order by match_rank alone; match_tier expresses
  // the same "exact barcode leads" rule as a discrete key, and the two
  // never disagree.
  if (exactBarcodeMatch) {
    const barcodeRank = buildExactBarcodeRankSql(`${prefix}barcodeKey`, barcodeColumn)
    matchRankSql = matchRankSql ? `(${barcodeRank} + ${matchRankSql})` : barcodeRank
  }

  // The same rank over the candidate list: the bm25 comes from the FTS source's own row.
  let candidateRankSql: string | undefined
  if (!titleOnly && ftsMatch) candidateRankSql = `COALESCE(${PRODUCT_SEARCH_CANDIDATE_ALIAS}.r, 0)`
  if (exactBarcodeMatch) {
    const barcodeRank = buildExactBarcodeRankSql(`${prefix}barcodeKey`, barcodeColumn)
    candidateRankSql = candidateRankSql ? `(${barcodeRank} + ${candidateRankSql})` : barcodeRank
  }

  return {
    hasSearchTerm: true,
    titleOnly,
    whereClause: matchClauses.length > 1 ? `(${matchClauses.join(' OR ')})` : matchClauses[0],
    matchRankSql,
    candidates: unsourced ? undefined : { idsSql: unionAllCandidates(sources), matchRankSql: candidateRankSql },
    rankCteSql,
    matchTierSql: buildMatchTierSql(rawSearchText, params, {
      prefix, nameNormalizedColumn, nameColumn, barcodeColumn, includeBarcodeTier: !titleOnly,
    }),
  }
}

// D1 refuses a statement with more than 100 bound parameters, and each search word binds up to
// ~5 (hybrid + short-word + partial-word clauses). The caps below are the ones the storefront
// already used; the budget trims trailing words of an adversarial query (short or code-like words
// bind the most) so the search tail alone stays at or under SEARCH_PARAM_BUDGET, leaving
// 100 - SEARCH_PARAM_BUDGET for the caller's filters, branch, promotions and paging.
export const SEARCH_PARAM_BUDGET = 56

export function buildProductSearchQuery(
  rawSearchText: string,
  params: Record<string, unknown>,
  options: ProductSearchQueryOptions = {},
): ProductSearchQuery {
  const titleOnly = Boolean(options.titleOnly)
  if (options.rankedIds) return buildRankedIdSearchQuery(options.rankedIds, params, options.paramPrefix || '', titleOnly, options.catalogOnly)
  let termGroups = limitSearchTermGroups(tokenizeSearchTermGroups(rawSearchText, SEARCH_MAX_GROUPS, SEARCH_MAX_WORDS), SEARCH_MAX_GROUPS, SEARCH_MAX_WORDS)
  while (termGroups.length) {
    const bound: Record<string, unknown> = {}
    const query = buildProductSearchQueryFromGroups(rawSearchText, bound, options, termGroups)
    if (Object.keys(bound).length <= SEARCH_PARAM_BUDGET || termGroups.flat().length === 1) {
      Object.assign(params, bound)
      return query
    }
    termGroups = termGroups.map((group, index) => (index === termGroups.length - 1 ? group.slice(0, -1) : group)).filter((group) => group.length)
  }
  return { hasSearchTerm: false, titleOnly }
}

// The family-level ORDER BY every product picker uses, assembled in one
// place so a new picker cannot ship with half of it. `tail` is the caller's
// own non-relevance ordering (name/created sort, branch listing order,
// ...); `promotedFirst` inserts the Products/POS promoted-leads key
// BETWEEN the tier and the bm25 rank, which is what keeps a discounted but
// barely-relevant product below the product the operator actually typed.
//
// familyPagination.ts appends the deterministic `family_root_id ASC`
// terminal key itself, for every caller, so it is deliberately absent here.
export function buildFamilyRelevanceOrderSql(
  tail: string,
  { hasTier, hasRank, promotedFirst = false }: { hasTier: boolean; hasRank: boolean; promotedFirst?: boolean },
): string {
  const keys: string[] = []
  if (hasTier) keys.push('match_tier ASC')
  if (promotedFirst) keys.push('family_promoted DESC')
  if (hasRank) keys.push('match_rank ASC')
  if (tail) keys.push(tail)
  return keys.join(', ')
}
