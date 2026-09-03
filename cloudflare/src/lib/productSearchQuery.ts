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

import {
  buildExactBarcodeMatchClause,
  buildExactBarcodeRankSql,
  buildFtsMatchExpression,
  buildHybridMatchClause,
  buildPartialWordMatchClause,
  buildShortWordFallbackClause,
  buildTrigramMatchExpression,
  normalizeSearchText,
  normalizedBarcodeSql,
  PRODUCT_SEARCH_COLUMNS,
  PRODUCTS_FTS_BM25_SQL,
  searchTermBarcodeKey,
  tokenizeSearchTermGroups,
} from './searchMatch'

export interface ProductSearchQueryOptions {
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
}

export interface ProductSearchQuery {
  // True once the caller actually typed something (used by products.ts to
  // gate its sibling-expansion behaviour).
  hasSearchTerm: boolean
  // The OR-joined disjunction of every match strategy, or undefined when
  // nothing was typed. Callers push this into their own WHERE list.
  whereClause?: string
  // bm25 relevance (+ the exact-barcode offset), or undefined when nothing
  // was typed / nothing scored. ASC.
  matchRankSql?: string
  // Discrete relevance tier, 0..3 per the contract above. ASC. Undefined
  // when nothing was typed.
  matchTierSql?: string
  titleOnly: boolean
}

// Relevance tier constants, exported so tests can assert the contract by
// name instead of by magic number.
export const MATCH_TIER_EXACT_BARCODE = 0
export const MATCH_TIER_EXACT_NAME = 1
export const MATCH_TIER_NAME_PREFIX = 2
export const MATCH_TIER_OTHER = 3

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
    branches.push(`WHEN ${normalizedBarcodeSql(opts.barcodeColumn)} = @${opts.prefix}barcodeKey THEN ${MATCH_TIER_EXACT_BARCODE}`)
  }
  if (nameKey) {
    const normalizedName = normalizedNameSql(opts.nameNormalizedColumn, opts.nameColumn)
    params[`${opts.prefix}nameExactKey`] = nameKey
    params[`${opts.prefix}namePrefixKey`] = `${nameKey}%`
    branches.push(`WHEN ${normalizedName} = @${opts.prefix}nameExactKey THEN ${MATCH_TIER_EXACT_NAME}`)
    branches.push(`WHEN ${normalizedName} LIKE @${opts.prefix}namePrefixKey THEN ${MATCH_TIER_NAME_PREFIX}`)
  }
  if (!branches.length) return undefined
  return `(CASE ${branches.join(' ')} ELSE ${MATCH_TIER_OTHER} END)`
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
export function buildProductSearchQuery(
  rawSearchText: string,
  params: Record<string, unknown>,
  options: ProductSearchQueryOptions = {},
): ProductSearchQuery {
  const prefix = options.paramPrefix || ''
  const nameNormalizedColumn = options.nameNormalizedColumn || 'p.name_normalized'
  const nameColumn = options.nameColumn || 'p.name'
  const barcodeColumn = options.barcodeColumn || 'p.barcode'
  const titleOnly = Boolean(options.titleOnly)
  const mode = String(options.mode || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'
  const termGroups = tokenizeSearchTermGroups(rawSearchText, 6, 8)
  if (!termGroups.length) return { hasSearchTerm: false, titleOnly }

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
      params[key] = `%${String(word).toLowerCase()}%`
      return `(${fallbackColumns.map((column) => `lower(COALESCE(${column}, '')) LIKE @${key}`).join(' OR ')})`
    })
    if (!wordClauses.length) return { hasSearchTerm: true, titleOnly }
    // The exact-barcode tier needs its own bound value on this path too
    // (buildExactBarcodeMatchClause is not called here), so bind it.
    if (!titleOnly) {
      const key = searchTermBarcodeKey(rawSearchText)
      if (key) params[`${prefix}barcodeKey`] = key
    }
    return {
      hasSearchTerm: true,
      titleOnly,
      whereClause: `(${wordClauses.join(mode === 'OR' ? ' OR ' : ' AND ')})`,
      matchTierSql: buildMatchTierSql(rawSearchText, params, {
        prefix, nameNormalizedColumn, nameColumn, barcodeColumn, includeBarcodeTier: !titleOnly,
      }),
    }
  }

  const matchClauses: string[] = []

  // 1. FTS5 word/prefix match over name (+sku/barcode unless titleOnly).
  const ftsMatch = buildFtsMatchExpression(termGroups, mode, titleOnly ? 'name' : PRODUCT_SEARCH_COLUMNS)
  if (ftsMatch) {
    params[`${prefix}ftsQuery`] = ftsMatch
    matchClauses.push(`p.id IN (SELECT rowid FROM products_fts WHERE products_fts MATCH @${prefix}ftsQuery)`)
  }

  // 2 + 3. Trigram substring tables. One expression, two tables: barcode/
  // sku mid-token fragments, and fused name tokens like "100ml"/"110C".
  const trigramMatch = buildTrigramMatchExpression(termGroups, mode)
  if (trigramMatch && !titleOnly) {
    params[`${prefix}codeQuery`] = trigramMatch
    matchClauses.push(`p.id IN (SELECT rowid FROM products_fts_code WHERE products_fts_code MATCH @${prefix}codeQuery)`)
  }
  if (trigramMatch) {
    params[`${prefix}nameCodeQuery`] = trigramMatch
    matchClauses.push(`p.id IN (SELECT rowid FROM products_fts_name_trigram WHERE products_fts_name_trigram MATCH @${prefix}nameCodeQuery)`)
  }

  // 4. Mixed group (one comma-group holding both a word and a code
  // fragment), which neither table resolves alone.
  const hybridMatch = titleOnly ? undefined : buildHybridMatchClause(termGroups, mode, `${prefix}hyb`, PRODUCT_SEARCH_COLUMNS)
  if (hybridMatch) {
    Object.assign(params, hybridMatch.params)
    matchClauses.push(hybridMatch.sql)
  }

  // 5. Sub-3-character words (FTS5's trigram tokenizer emits nothing below
  // 3 chars), name only, on the precomputed normalized column.
  const shortWordMatch = buildShortWordFallbackClause(termGroups, mode, [nameNormalizedColumn], params, `${prefix}shortw`, true)
  if (shortWordMatch) matchClauses.push(shortWordMatch)

  // 6. Long (4+ word) queries, partial-word, name only.
  const partialMatch = buildPartialWordMatchClause(termGroups, mode, [nameNormalizedColumn], params, `${prefix}partialw`, 4, true)
  if (partialMatch) matchClauses.push(partialMatch)

  // 7. Exact barcode with leading zeros folded on both sides (the
  // GTIN-14/EAN-13 twin problem), first in the list so it reads first.
  const exactBarcodeMatch = titleOnly
    ? undefined
    : buildExactBarcodeMatchClause(rawSearchText, params, `${prefix}barcodeKey`, barcodeColumn)
  if (exactBarcodeMatch) matchClauses.unshift(exactBarcodeMatch)

  if (!matchClauses.length) return { hasSearchTerm: true, titleOnly }

  let matchRankSql: string | undefined
  // bm25() only scores rows the FTS5 table itself matched, and it has to be
  // evaluated inside a query carrying that table's own MATCH -- hence the
  // correlated scalar subquery. Rows that arrived via a trigram/LIKE
  // fallback COALESCE to 0 and stay orderable rather than dropping out of
  // the sort.
  if (!titleOnly && ftsMatch) {
    matchRankSql = `COALESCE((SELECT ${PRODUCTS_FTS_BM25_SQL} FROM products_fts WHERE products_fts.rowid = p.id AND products_fts MATCH @${prefix}ftsQuery), 0)`
  }
  // Kept for callers that order by match_rank alone; match_tier expresses
  // the same "exact barcode leads" rule as a discrete key, and the two
  // never disagree.
  if (exactBarcodeMatch) {
    const barcodeRank = buildExactBarcodeRankSql(`${prefix}barcodeKey`, barcodeColumn)
    matchRankSql = matchRankSql ? `(${barcodeRank} + ${matchRankSql})` : barcodeRank
  }

  return {
    hasSearchTerm: true,
    titleOnly,
    whereClause: matchClauses.length > 1 ? `(${matchClauses.join(' OR ')})` : matchClauses[0],
    matchRankSql,
    matchTierSql: buildMatchTierSql(rawSearchText, params, {
      prefix, nameNormalizedColumn, nameColumn, barcodeColumn, includeBarcodeTier: !titleOnly,
    }),
  }
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
