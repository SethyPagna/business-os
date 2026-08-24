import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { paginateProductFamilies } from '../lib/familyPagination'
import { getFamilyStockStats } from '../lib/familyStockStats'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { getPermissionTier } from '../lib/permissions'
import { maybeQueueForReview } from '../lib/reviewGate'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersion } from '../lib/cache'
import { findIdentityMatch, type ProductIdentityRow } from '../lib/productIdentity'
import { buildFtsMatchExpression, buildHybridMatchClause, buildIssueStateClauses, buildPartialWordMatchClause, buildShortWordFallbackClause, buildTrigramMatchExpression, expandAliasCandidates, normalizedHaystackSql, PRODUCT_SEARCH_COLUMNS, PRODUCTS_FTS_BM25_SQL, runFuzzyFallbackMatch, tokenizeSearchTermGroups, tokenizeSearchWords } from '../lib/searchMatch'
import { receiveBatchStock, removeStockFromBatch, removeStockAcrossBatches, InsufficientBatchStockError } from '../lib/productBatches'
import { parseDatedStockCountEntries, buildDatedStockCountPlan } from '../lib/datedStockCountRoute'
import { applyDatedStockCountPlan } from '../lib/datedStockCountApply'
import { parseRawDatedCountRows, resolveDatedStockCountRows } from '../lib/datedStockCountResolve'
import { applyDatedStockCountDecisions, type DatedCountDecision } from '../lib/datedStockCountDecisions'
import type { Env } from '../index'

// Inventory routes, ported from backend/src/routes/inventory.ts.
//
// The read side (search/bootstrap/summary/stats/movements/reasons GET) was
// already live via routes/compat.ts's generic shim and is reproduced here
// unchanged so this file is the single home for /api/inventory/*. The write
// side (adjust/transfer/move-row/reasons PUT) did not exist anywhere on
// Cloudflare -- every stock adjustment, branch transfer, and "move to
// damaged/expired" action 404ed. That's the real fix in this file.
//
// Update: the batch/lot FIFO system (product_batches, branch_batch_stock)
// this comment originally said D1 had no tables for now exists and is live
// -- see lib/productBatches.ts. /adjust below optionally takes a `batchId`
// (add: an existing batch id or the string 'new'; remove: always a real
// batch id) from Inventory's mandatory batch-selection UI, and keeps the
// batch ledger and the plain products.stock_quantity/branch_stock aggregate
// in sync atomically when it's given. `batchId` is opt-in, not required at
// the wire level, on purpose: internal/automated callers (Products.tsx's
// own undo/redo/restore-branch-stock plumbing, bulk edits) call this same
// endpoint without a human in the loop to pick a batch, and must keep
// working exactly as before. Requiring a batch is a *frontend* UI rule
// (InventoryStockModals.tsx, for a person adjusting stock by hand on an
// eligible flat product), not a backend one -- see the /adjust handler's
// own comments for the price-unlock interaction and grouped-product
// exclusion. RFID hardware endpoints are functional stubs (no reader
// hardware exists to talk to from a Worker).

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)
// Legacy gates every single inventory endpoint (reads and writes alike)
// behind requirePermission('inventory') -- this Worker only checked
// requireAuth (any logged-in user), a real gap since inventory data/actions
// are meant to be restricted to roles with the inventory permission.
//
// Part 152 fix: this used to call the strict `hasPermission()` (=== true
// only), which 403'd a Review Required-tier user (permissions.inventory
// === 'review') out of every inventory route, including plain reads --
// contradicting the Permissions item's own spec ("the user can only view
// + submit" implies view must work). Switched to `getPermissionTier(...)
// !== 'none'` per reviewGate.ts's own doc comment, which explicitly flags
// this exact mistake as the thing every Review-Required route's top-level
// gate must avoid. Individual write handlers below are what now
// distinguish Full (apply directly) from Review Required (queue) --
// this middleware only decides "in the door or not".
app.use('*', async (c, next) => {
  const user = c.get('user')
  if (getPermissionTier(user, 'inventory') === 'none') return c.json({ error: 'You do not have permission to perform this action' }, 403)
  return next()
})

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

// ---- Filter/initial helpers, ported from backend/src/routes/inventory.ts
// (appendInventoryProductFilters) and backend/src/initials.ts. The Cloudflare
// version of this endpoint previously ignored every filter and never
// computed `initials` at all -- it just paginated all active products. That
// meant: (1) category/brand/branch/stock/search filters silently did
// nothing server-side, and (2) the alphabet jump bar's real options came
// from `getInitialKey` on d1.
// Was a plain `raw.split(',')` -- only ever split on a literal comma, so a
// space-separated query like "red lipstick" (no comma) was never split into
// per-word terms at all; it was matched as one literal multi-word substring,
// silently stricter than products.ts's per-word AND matching (and than this
// same page's own client-side `searchTerms` memo just above, which already
// splits on comma-or-whitespace for its no-op client fallback -- see that
// comment). Routed through tokenizeSearchWords (lib/searchMatch.ts), same as
// routes/products.ts's own splitSearchTerms, which normalizes (diacritics/
// joiners folded, comma treated as a separator same as any other non-
// alphanumeric char) before splitting on whitespace -- so both a comma-
// joined and a space-separated query now split into individual words.
function splitSearchTerms(raw: unknown): string[] {
  return tokenizeSearchWords(raw as string, 8)
}

// Comma splits into GROUPS, a space inside a group is ordinary
// word-spacing -- see tokenizeSearchTermGroups' own comment in
// lib/searchMatch.ts for why this replaced the flat splitSearchTerms
// above for the AND/OR-toggle-driven product search below (the
// movement-log search further down keeps splitSearchTerms' flat
// word-level behavior -- it has no comma-groups use case reported).
function splitSearchTermGroups(raw: unknown): string[][] {
  return tokenizeSearchTermGroups(raw as string, 6, 8)
}

function getInitialKey(value: unknown): string {
  const first = [...String(value || '').normalize('NFC').trim()][0] || ''
  if (!first) return '#'
  const upper = first.toLocaleUpperCase()
  if (/^[A-Z]$/.test(upper)) return upper
  if (/^[0-9]$/.test(first)) return first
  if (/[\u1780-\u17FF]/.test(first)) return first
  if (/[\p{L}\p{N}]/u.test(first)) return upper || first
  return first
}

function getInitialType(key: unknown): 'latin' | 'number' | 'khmer' | 'other' | 'symbol' {
  const value = String(key || '')
  if (/^[A-Z]$/.test(value)) return 'latin'
  if (/^[0-9]$/.test(value)) return 'number'
  if (/[\u1780-\u17FF]/.test(value)) return 'khmer'
  if (/[\p{L}\p{N}]/u.test(value)) return 'other'
  return 'symbol'
}

type InventoryFilterQuery = Record<string, string | undefined>

function appendInventoryProductFilters(query: InventoryFilterQuery) {
  const where = ['p.is_active = 1']
  const params: Record<string, unknown> = {}
  const joins: string[] = []

  const branchId = Number.parseInt(String(query.branchId || query.branch_id || ''), 10)
  if (Number.isFinite(branchId) && branchId > 0) {
    params.branchId = branchId
    joins.push('LEFT JOIN branch_stock selected_bs ON selected_bs.product_id = p.id AND selected_bs.branch_id = @branchId')
  }

  const termGroups = splitSearchTermGroups(query.query || query.q || '')
  let matchRankSql: string | undefined
  let searchWhereClause: string | undefined
  const mode = String(query.searchMode || query.search_mode || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'
  // Previously opt-in via searchFields=name (Inventory.tsx sent that on
  // every request, forcing a name-only match and silently dropping
  // barcode/sku/brand/category/supplier/description/unit hits). That
  // param is no longer sent by Inventory.tsx -- see its own comment --
  // so titleOnly now only fires for a caller that actually asks for it.
  const titleOnly = ['name', 'title'].includes(String(query.searchFields || query.search_fields || '').toLowerCase())
  if (termGroups.length) {
    // FTS5 MATCH against products_fts (migrations/0018_products_fts.sql)
    // plus products_fts_code (migrations/0019_products_fts_code.sql,
    // barcode/sku substring fallback) -- same approach as products.ts's
    // buildSearchFilters, see that file's comment for the full reasoning
    // (including why both MATCH conditions are IN-subqueries rather than
    // a JOIN + direct MATCH: combining a JOINed FTS5 table's MATCH with
    // an OR throws at the SQLite level, confirmed against real FTS5).
    // Scoped to PRODUCT_SEARCH_COLUMNS, same reasoning as products.ts's identical
    // change (see lib/searchMatch.ts's own comment on that constant).
    const ftsMatch = buildFtsMatchExpression(termGroups, mode, titleOnly ? 'name' : PRODUCT_SEARCH_COLUMNS)
    // Computed once, unconditionally (not gated on titleOnly), and reused
    // for both products_fts_code (barcode/sku) below and
    // products_fts_name_trigram (name) -- see products.ts's identical
    // wiring/comment for the fused-token gap (e.g. "100ml", "110C") this
    // second table closes, confirmed against this project's own real
    // catalog data.
    const trigramMatch = buildTrigramMatchExpression(termGroups, mode)
    const matchClauses: string[] = []
    if (ftsMatch) {
      params.ftsQuery = ftsMatch
      matchClauses.push('p.id IN (SELECT rowid FROM products_fts WHERE products_fts MATCH @ftsQuery)')
    }
    if (trigramMatch && !titleOnly) {
      params.codeQuery = trigramMatch
      matchClauses.push('p.id IN (SELECT rowid FROM products_fts_code WHERE products_fts_code MATCH @codeQuery)')
    }
    if (trigramMatch) {
      params.nameCodeQuery = trigramMatch
      matchClauses.push('p.id IN (SELECT rowid FROM products_fts_name_trigram WHERE products_fts_name_trigram MATCH @nameCodeQuery)')
    }
    // Mixed-group fallback (e.g. one group containing both "mac" and
    // "012") -- see buildHybridMatchClause's own comment in
    // lib/searchMatch.ts and products.ts's identical wiring. No-op for
    // the common single-word-per-group case.
    const hybridMatch = titleOnly ? undefined : buildHybridMatchClause(termGroups, mode, 'hyb', PRODUCT_SEARCH_COLUMNS)
    if (hybridMatch) {
      Object.assign(params, hybridMatch.params)
      matchClauses.push(hybridMatch.sql)
    }
    // Short-word (<3 char) LIKE fallback -- see buildShortWordFallbackClause's
    // own comment in lib/searchMatch.ts and products.ts's identical wiring
    // for why the trigram tables above can't cover "ml"/"g"/a single
    // shade-code letter on their own.
    // Same depth-100 fix as products.ts's identical call site: pass the
    // precomputed name_normalized/unit_normalized columns with
    // alreadyNormalizedCols=true instead of raw p.name/p.unit, so this
    // doesn't run the ~78-level nested REPLACE() chain per column for
    // every sub-3-character word (see migration 0037_product_search_
    // compact_columns.sql and products.ts's own comment on this exact fix).
    // Scoped to name_normalized only -- unit dropped along with unit
    // leaving PRODUCT_SEARCH_COLUMNS (see that constant's own comment in
    // lib/searchMatch.ts): unit has its own exact-match filter now instead
    // of being a free-text search dimension.
    const shortWordMatch = buildShortWordFallbackClause(termGroups, mode, ['p.name_normalized'], params, 'shortw', true)
    if (shortWordMatch) matchClauses.push(shortWordMatch)
    // Compact-brand substring fallback intentionally NOT called here
    // anymore -- brand is no longer a free-text search dimension (see
    // PRODUCT_SEARCH_COLUMNS's own comment in lib/searchMatch.ts): names
    // already carry the brand in this catalog, and the brand filter
    // dropdown already covers exact-brand lookup.
    // Partial multi-word fallback -- same long-name gap and identical
    // wiring as products.ts (see buildPartialWordMatchClause's own
    // comment in lib/searchMatch.ts). Scoped to name only, same reasoning.
    // Same depth-100 fix as products.ts -- name_normalized, alreadyNormalizedCols=true.
    const partialMatch = buildPartialWordMatchClause(termGroups, mode, ['p.name_normalized'], params, 'partialw', 4, true)
    if (partialMatch) matchClauses.push(partialMatch)
    if (matchClauses.length) {
      searchWhereClause = matchClauses.length > 1 ? `(${matchClauses.join(' OR ')})` : matchClauses[0]
      if (!titleOnly && ftsMatch) {
        matchRankSql = `COALESCE((SELECT ${PRODUCTS_FTS_BM25_SQL} FROM products_fts WHERE products_fts.rowid = p.id AND products_fts MATCH @ftsQuery), 0)`
      }
    }
  }

  // Same multi-brand membership check as products.ts's buildSearchFilters
  // (see migrations/0033_product_multi_category_brand.sql and
  // normalizeMultiValue's own comments) -- a product's PRIMARY brand can
  // differ from a secondary brand tag it also carries, and the Inventory
  // filter needs to surface it either way, same as Products does.
  const escapeLike = (value: string) => value.replace(/[%_]/g, (m) => `\\${m}`)
  const brand = String(query.brand || '').normalize('NFC').trim()
  if (brand && brand.toLowerCase() !== 'all') {
    params.brand = brand.toLowerCase()
    params.brandesc = escapeLike(brand.toLowerCase())
    where.push("(lower(trim(COALESCE(p.brand, ''))) = @brand OR ('||' || lower(COALESCE(p.brands, p.brand, '')) || '||') LIKE '%||' || @brandesc || '||%' ESCAPE '\\')")
  }

  // Category filter -- multi-value (comma-joined, "all"/empty means no
  // filter), matching products.ts's IN(...) form now that Inventory's own
  // catFilter UI state is comma-joined multi-select too (upgraded from
  // single-select to support picking several categories, or a whole
  // "Main - Sub" hierarchical group, at once -- see multiSelect.ts and
  // CategoryFilterOptions.tsx on the frontend). Each value also checks
  // multi-category membership (p.categories), same reasoning as brand
  // above.
  const categoryValues = String(query.category || '').normalize('NFC')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v && v.toLowerCase() !== 'all')
  const categoryMatchOne = (key: string) => `(lower(trim(COALESCE(p.category, ''))) = @${key} OR ('||' || lower(COALESCE(p.categories, p.category, '')) || '||') LIKE '%||' || @${key}esc || '||%' ESCAPE '\\')`
  if (categoryValues.length === 1) {
    params.category = categoryValues[0].toLowerCase()
    params.categoryesc = escapeLike(categoryValues[0].toLowerCase())
    where.push(categoryMatchOne('category'))
  } else if (categoryValues.length > 1) {
    const clauses = categoryValues.map((value, index) => {
      const key = `category${index}`
      params[key] = value.toLowerCase()
      params[`${key}esc`] = escapeLike(value.toLowerCase())
      return categoryMatchOne(key)
    })
    where.push(`(${clauses.join(' OR ')})`)
  }

  const stockExpr = params.branchId ? 'COALESCE(selected_bs.quantity, 0)' : 'COALESCE(p.stock_quantity, 0)'
  const stockState = String(query.stockState || query.stock_state || '').toLowerCase()
  if (stockState === 'low') where.push(`${stockExpr} > COALESCE(p.out_of_stock_threshold, 0) AND ${stockExpr} <= COALESCE(p.low_stock_threshold, 10)`)
  if (stockState === 'out') where.push(`${stockExpr} <= COALESCE(p.out_of_stock_threshold, 0)`)
  if (stockState === 'in_stock' || stockState === 'positive') where.push(`${stockExpr} > COALESCE(p.out_of_stock_threshold, 0)`)

  // "Issues" quick filter -- same scoped set and reasoning as products.ts's
  // own buildSearchFilters (see buildIssueStateClauses' comment in
  // lib/searchMatch.ts). Inventory's own search bar hits this same
  // products table, so it needs the same fix.
  const issueState = String(query.issueState || query.issue_state || '')
  const issueClause = buildIssueStateClauses(issueState, stockExpr)
  if (issueClause) where.push(issueClause)

  // "Grouped" has to match how the frontend actually decides a product is
  // part of a group (see utils/productGrouping.ts's resolveGroupKey /
  // buildProductGroups): an explicit is_group/parent_id link, OR simply
  // sharing its (trimmed, case-insensitive) name with another active
  // product -- most real groups in this catalog are plain duplicate-name
  // rows (same item, different branch/price/barcode) with no is_group/
  // parent_id set at all.
  //
  // The name-duplicate half of that used to be a correlated EXISTS re-scan
  // of the whole products table for every row (O(n^2) over the catalog --
  // see migration 0010_product_name_grouping.sql for the full incident, and
  // products.ts's buildSearchFilters for the matching fix there). Migration
  // 0010 made that a persisted, trigger-maintained fact on the row itself
  // (products.is_grouped_cached, kept in sync on insert/rename/
  // (de)activate/delete), but this route was never updated to actually read
  // it -- it kept re-deriving the same answer with the same expensive
  // subquery on every request. is_group/parent_id are already plain indexed
  // column reads (cheap, always current, no cache needed), so only the
  // name-duplicate check is replaced here.
  const groupState = String(query.groupState || query.group_state || '').toLowerCase()
  if (groupState && groupState !== 'all') {
    const groupedExpr = `(
      COALESCE(p.is_group, 0) = 1
      OR COALESCE(p.parent_id, 0) > 0
      OR COALESCE(p.is_grouped_cached, 0) = 1
    )`
    if (groupState === 'parent') where.push('(COALESCE(p.is_group, 0) = 1 AND COALESCE(p.parent_id, 0) = 0)')
    else if (groupState === 'variant') where.push('COALESCE(p.parent_id, 0) > 0')
    else if (groupState === 'standalone') where.push(`NOT ${groupedExpr}`)
    else where.push(groupedExpr) // group / groups / grouped / parents_variants / parent_variant / parents-and-variants
  }

  const initial = String(query.initial || '').normalize('NFC').trim()
  if (initial && initial.toLowerCase() !== 'all') {
    const key = getInitialKey(initial)
    params.initial = key
    if (getInitialType(key) === 'latin') where.push("upper(substr(trim(COALESCE(p.name, '')), 1, 1)) = @initial")
    else where.push("substr(trim(COALESCE(p.name, '')), 1, 1) = @initial")
  }

  if (searchWhereClause) where.push(searchWhereClause)

  return { where, joins, params, stockExpr, matchRankSql, titleOnly }
}

async function getInventoryProductMetadata(env: Env, query: InventoryFilterQuery) {
  const db = getDb(env)
  // Metadata (brand list + initials bar) always reflects "all initials" --
  // only the initial filter itself is excluded so the bar doesn't collapse
  // to a single letter once one is selected, matching the legacy behavior.
  //
  // Real, confirmed bug (Part 90 "Brand filter option sometimes vanishes
  // when picked" -- same root cause found and fixed in products.ts's
  // loadProductFilters, see that function's own comment for the full
  // repro): a single `metaFilters` object used to be reused for BOTH the
  // brand and category option queries, still carrying brand/category's OWN
  // currently-selected value in its WHERE clause. Once "MAC" was picked as
  // the brand filter, the brand-OPTIONS query itself was also scoped to
  // `brand = 'mac'`, so every other brand vanished from the dropdown the
  // moment one was selected. Cross-filtering between DIFFERENT facets
  // (picking a brand narrowing which categories show up) is correct and
  // kept; only a facet's OWN filter is now excluded from its OWN options
  // query, same "exclude only the field this query is FOR" rule `initial`
  // already got.
  // Also strips the free-text search term (see products.ts's loadProductFilters
  // for the full incident this mirrors) -- metadata answers "what filter
  // OPTIONS exist structurally", not "what matches the currently-typed
  // search", so it must never go stale relative to a search box this
  // function doesn't itself track for re-fetch timing.
  const { query: _searchTerm, q: _searchTermAlt, ...structuralQuery } = query
  const metaBase: InventoryFilterQuery = { ...structuralQuery, initial: 'all' }
  const brandMetaFilters = appendInventoryProductFilters({ ...metaBase, brand: '' })
  const categoryMetaFilters = appendInventoryProductFilters({ ...metaBase, category: '' })
  const initialMetaFilters = appendInventoryProductFilters(metaBase)
  const sql = (f: ReturnType<typeof appendInventoryProductFilters>) => `WHERE ${f.where.join(' AND ')}`
  const joinSql = (f: ReturnType<typeof appendInventoryProductFilters>) => f.joins.join('\n')

  const [brandRows, categoryRows, initialRows] = await Promise.all([
    // GROUP BY a normalized (trimmed + case-folded) key rather than plain
    // DISTINCT -- SQLite's DISTINCT compares brand/category values byte-for-
    // byte, so imported data with inconsistent casing (e.g. "Ariana" vs
    // "ARIANA") produced two dropdown rows that render identically but are
    // different filter values under the hood. MIN() over the grouped rows
    // picks one deterministic representative casing per group.
    db.prepare(`
      SELECT MIN(trim(p.brand)) AS value
      FROM products p
      ${joinSql(brandMetaFilters)}
      ${sql(brandMetaFilters)}
        AND COALESCE(trim(p.brand), '') != ''
      GROUP BY lower(trim(p.brand))
      ORDER BY value COLLATE NOCASE ASC
      LIMIT 500
    `).all<{ value: string }>(brandMetaFilters.params),
    // Categories -- previously not queried at all here (see this
    // function's other new comment on the category WHERE clause above);
    // same shape as the brand query so Inventory's filter panel can build
    // a category section the same way it already builds the brand one.
    // Same normalized-grouping fix as the brand query above.
    db.prepare(`
      SELECT MIN(trim(p.category)) AS value
      FROM products p
      ${joinSql(categoryMetaFilters)}
      ${sql(categoryMetaFilters)}
        AND COALESCE(trim(p.category), '') != ''
      GROUP BY lower(trim(p.category))
      ORDER BY value COLLATE NOCASE ASC
      LIMIT 500
    `).all<{ value: string }>(categoryMetaFilters.params),
    db.prepare(`
      SELECT substr(trim(p.name), 1, 1) AS value, COUNT(*) AS count
      FROM products p
      ${joinSql(initialMetaFilters)}
      ${sql(initialMetaFilters)}
        AND COALESCE(trim(p.name), '') != ''
      GROUP BY value
    `).all<{ value: string; count: number }>(initialMetaFilters.params),
  ])

  const initialMap = new Map<string, number>()
  for (const row of initialRows) {
    const key = getInitialKey(row.value)
    const count = num(row.count)
    if (!key || count <= 0) continue
    initialMap.set(key, (initialMap.get(key) || 0) + count)
  }
  const initials = [...initialMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true }))
    .map(([key, count]) => ({ key, label: key, count, type: getInitialType(key) }))

  return { filters: { brands: brandRows.map((row) => row.value), categories: categoryRows.map((row) => row.value) }, initials }
}

async function searchProductsPayload(env: Env, query: Record<string, string>) {
  const page = clampInt(query.page, 1, 1, 100000)
  const pageSize = clampInt(query.pageSize, 20, 1, 100)
  const includeMetadata = String(query.metadata ?? '1') !== '0'
  const metadataOnly = ['1', 'true', 'yes'].includes(String(query.metadataOnly ?? query.metadata_only ?? '').trim().toLowerCase())
  const db = getDb(env)
  const filters = appendInventoryProductFilters(query)
  const { where, joins, params, matchRankSql } = filters
  const joinSql = joins.join('\n')
  const whereSql = `WHERE ${where.join(' AND ')}`

  // A search term takes over the primary sort order (relevance -- see
  // appendInventoryProductFilters' matchRankSql) same as products.ts's
  // searchProductsPayload; no matchRankSql (no search term, or metadataOnly
  // stripped `name`/etc out of selectColumns so there's nothing to rank
  // against) falls back to the plain name order as before.
  const effectiveFamilyOrderSql = (matchRankSql && !metadataOnly) ? 'match_rank ASC, family_name ASC' : 'family_name ASC'

  const selectColumns = metadataOnly ? 'p.id' : `p.id, p.name, p.sku, p.barcode, p.category, p.brand, p.unit, p.description,
           p.selling_price_usd, p.selling_price_khr, p.purchase_price_usd, p.purchase_price_khr,
           p.cost_price_usd, p.cost_price_khr, p.stock_quantity, p.low_stock_threshold,
           p.out_of_stock_threshold, p.image_path, p.is_active, p.supplier, p.parent_id,
           p.is_group, p.expiry_date, p.expiry_alert_days, p.created_at, p.updated_at,
           COALESCE((
             SELECT json_group_array(json_object('branch_id', bs2.branch_id, 'branch_name', b2.name, 'quantity', bs2.quantity))
             FROM branch_stock bs2
             JOIN branches b2 ON b2.id = bs2.branch_id
             WHERE bs2.product_id = p.id
           ), '[]') AS branch_stock_json`

  // Grouped products (parent_id families) are treated as a single unit for
  // paging -- see paginateProductFamilies for why plain LIMIT/OFFSET over
  // raw rows is wrong here. When metadataOnly, still select minimally so
  // `total` (family count) comes back accurately without fetching full rows.
  const [paged, metadata] = await Promise.all([
    paginateProductFamilies<Record<string, unknown>>({
      db,
      // branch_stock_json: this list backs the Inventory page's product rows,
      // and clicking a row opens ProductDetailModal directly off this same
      // object (InventoryProductsSurface's onClick={() => setDetailProduct(p)})
      // -- it never re-fetches with `include=branch_stock`. Without this
      // column the modal's Branch Stock section always showed 0 for every
      // branch, since `p.branch_stock` was simply undefined on rows from
      // this endpoint. Same correlated-subquery shape as GET /summary above.
      selectColumns,
      joinSql,
      whereSql,
      params,
      page,
      pageSize,
      familyOrderSql: effectiveFamilyOrderSql,
      // metadataOnly shrinks selectColumns down to just `p.id`, so `name`
      // isn't a column in the `matched` CTE at that point -- ordering by it
      // would 500 with "no such column: name". The row order is discarded
      // either way in that mode (see `items: metadataOnly ? [] : ...`
      // below), so fall back to the one column guaranteed to exist.
      intraFamilyOrderSql: metadataOnly ? 'id ASC' : 'lower(name) ASC, id ASC',
      matchRankSql: metadataOnly ? undefined : matchRankSql,
    }),
    includeMetadata ? getInventoryProductMetadata(env, query) : Promise.resolve({ filters: { brands: [], categories: [] }, initials: [] }),
  ])

  const pagedResult = paged

  const items = metadataOnly ? [] : (pagedResult.items as Array<Record<string, unknown>>).map((row) => {
    const next = { ...row }
    try {
      next.branch_stock = JSON.parse(String(next.branch_stock_json || '[]'))
    } catch (_) {
      next.branch_stock = []
    }
    delete next.branch_stock_json
    return next
  })

  return {
    items,
    total: pagedResult.total,
    page,
    pageSize,
    totalPages: pagedResult.totalPages,
    filters: metadata.filters,
    initials: metadata.initials,
  }
}

app.get('/products/search', async (c) => c.json(await searchProductsPayload(c.env, c.req.query())))

app.get('/bootstrap', async (c) => {
  const payload = await searchProductsPayload(c.env, c.req.query())
  const db = getDb(c.env)
  // Family-aware, same reasoning as /stats above -- this used to be a flat
  // COUNT(*)/SUM() over all active rows, which overcounted product_count
  // (and split its stock status) vs. the family-grouped `total` the
  // `payload` above already reports for the listing itself.
  const [familyStats, movements, brands, categories] = await Promise.all([
    getFamilyStockStats({
      db,
      joinSql: '',
      whereSql: 'WHERE p.is_active = 1',
      params: {},
      qtyExpr: 'COALESCE(p.stock_quantity, 0)',
    }),
    db.prepare('SELECT * FROM inventory_movements ORDER BY created_at DESC, id DESC LIMIT 50').all({}),
    db.prepare("SELECT DISTINCT trim(brand) AS value FROM products WHERE is_active = 1 AND trim(COALESCE(brand, '')) <> '' ORDER BY lower(trim(brand)) ASC").all<{ value: string }>({}),
    // Previously missing -- same gap as getInventoryProductMetadata's own
    // brands-only query, just this route's separate first-load copy of it.
    db.prepare("SELECT DISTINCT trim(category) AS value FROM products WHERE is_active = 1 AND trim(COALESCE(category, '')) <> '' ORDER BY lower(trim(category)) ASC").all<{ value: string }>({}),
  ])
  return c.json({
    products: payload,
    items: payload.items || [],
    total: payload.total || 0,
    page: payload.page || 1,
    pageSize: payload.pageSize || 20,
    stats: {
      product_count: familyStats.total_products,
      stock_quantity: familyStats.stock_quantity,
      in_stock_count: familyStats.in_stock,
      healthy_count: familyStats.healthy,
      low_stock_count: familyStats.low_stock,
      out_of_stock_count: familyStats.out_of_stock,
      stock_value_usd: familyStats.stock_value_usd,
      stock_value_khr: familyStats.stock_value_khr,
    },
    movements: { items: movements || [], total: (movements || []).length, page: 1, pageSize: 50 },
    filters: { brands: (brands || []).map((row) => row.value), categories: (categories || []).map((row) => row.value) },
  })
})

// GET /summary -- previously returned a single aggregate totals row
// ([{ product_count, stock_quantity, stock_value_usd, stock_value_khr }]),
// which doesn't match what any real caller expects. The only two callers
// (frontend/src/api/methods.ts's getInventorySummary and
// NewSupplierReturnModal.tsx's loadSupplierReturnInventory) both treat the
// response as an array of per-product rows with a branch-scoped
// display_quantity -- that's the Supplier Return modal's entire product
// picker data source, so with the old aggregate-row shape that picker was
// silently empty/broken (`rows.filter(p => p.display_quantity > 0)` on a
// single stats object filters everything out). Ported from
// backend/src/routes/inventory.ts's GET /summary: active products with
// branch-scoped (or store-wide, when no branchId given) stock value and
// sales-minus-returns revenue/COGS/discount figures. D1/SQLite equivalent
// of the Postgres original -- same join logic, json_group_array/json_object
// instead of json_agg/json_build_object for the branch_stock breakdown in
// the no-branchId case.
app.get('/summary', async (c) => {
  const db = getDb(c.env)
  const branchId = c.req.query('branchId') ? Number.parseInt(c.req.query('branchId') as string, 10) : null

  if (branchId) {
    const rows = await db.prepare(`
      SELECT p.*,
        COALESCE(bs.quantity, 0) AS display_quantity,
        COALESCE(bs.quantity * COALESCE(NULLIF(p.purchase_price_usd, 0), p.cost_price_usd, 0), 0) AS stock_value_usd,
        COALESCE(bs.quantity * COALESCE(NULLIF(p.purchase_price_khr, 0), p.cost_price_khr, 0), 0) AS stock_value_khr,
        COALESCE(si.qty_sold, 0) - COALESCE(ret.qty_returned, 0) AS qty_sold,
        COALESCE(si.store_discount_usd, 0) AS store_discount_usd,
        COALESCE(si.store_discount_khr, 0) AS store_discount_khr,
        COALESCE(si.membership_discount_usd, 0) AS membership_discount_usd,
        COALESCE(si.membership_discount_khr, 0) AS membership_discount_khr,
        COALESCE(si.revenue_usd, 0) - COALESCE(ret.refund_usd, 0) AS revenue_usd,
        COALESCE(si.revenue_khr, 0) - COALESCE(ret.refund_khr, 0) AS revenue_khr,
        COALESCE(si.cogs_usd, 0) - COALESCE(ret.cogs_returned_usd, 0) AS cogs_usd,
        COALESCE(si.cogs_khr, 0) - COALESCE(ret.cogs_returned_khr, 0) AS cogs_khr,
        COALESCE((
          SELECT json_group_array(json_object('branch_id', bs2.branch_id, 'branch_name', b2.name, 'quantity', bs2.quantity))
          FROM branch_stock bs2
          JOIN branches b2 ON b2.id = bs2.branch_id
          WHERE bs2.product_id = p.id
        ), '[]') AS branch_stock_json
      FROM products p
      LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = @branchId
      LEFT JOIN (
        SELECT si.product_id, si.branch_id,
               SUM(si.quantity) AS qty_sold,
               SUM(CASE WHEN COALESCE(s.subtotal_usd, 0) > 0 THEN (si.total_usd / s.subtotal_usd) * COALESCE(s.discount_usd, 0) ELSE 0 END) AS store_discount_usd,
               SUM(CASE WHEN COALESCE(s.subtotal_khr, 0) > 0 THEN (si.total_khr / s.subtotal_khr) * COALESCE(s.discount_khr, 0) ELSE 0 END) AS store_discount_khr,
               SUM(CASE WHEN COALESCE(s.subtotal_usd, 0) > 0 THEN (si.total_usd / s.subtotal_usd) * COALESCE(s.membership_discount_usd, 0) ELSE 0 END) AS membership_discount_usd,
               SUM(CASE WHEN COALESCE(s.subtotal_khr, 0) > 0 THEN (si.total_khr / s.subtotal_khr) * COALESCE(s.membership_discount_khr, 0) ELSE 0 END) AS membership_discount_khr,
               SUM(si.total_usd - CASE WHEN COALESCE(s.subtotal_usd, 0) > 0 THEN (si.total_usd / s.subtotal_usd) * (COALESCE(s.discount_usd, 0) + COALESCE(s.membership_discount_usd, 0)) ELSE 0 END) AS revenue_usd,
               SUM(si.total_khr - CASE WHEN COALESCE(s.subtotal_khr, 0) > 0 THEN (si.total_khr / s.subtotal_khr) * (COALESCE(s.discount_khr, 0) + COALESCE(s.membership_discount_khr, 0)) ELSE 0 END) AS revenue_khr,
               SUM(si.cost_price_usd * si.quantity) AS cogs_usd,
               SUM(si.cost_price_khr * si.quantity) AS cogs_khr
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE si.branch_id = @branchId
          AND COALESCE(s.sale_status, 'completed') NOT IN ('awaiting_payment', 'cancelled')
        GROUP BY si.product_id, si.branch_id
      ) si ON si.product_id = p.id
      LEFT JOIN (
        SELECT ri.product_id,
               SUM(ri.quantity) AS qty_returned,
               SUM(ri.total_usd) AS refund_usd,
               SUM(ri.total_khr) AS refund_khr,
               SUM(CASE WHEN ri.return_to_stock = 1 THEN ri.cost_price_usd * ri.quantity ELSE 0 END) AS cogs_returned_usd,
               SUM(CASE WHEN ri.return_to_stock = 1 THEN ri.cost_price_khr * ri.quantity ELSE 0 END) AS cogs_returned_khr
        FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
        WHERE COALESCE(ri.branch_id, r.branch_id) = @branchId
          AND COALESCE(r.status, 'completed') != 'cancelled'
          AND COALESCE(r.return_scope, 'customer') = 'customer'
        GROUP BY ri.product_id
      ) ret ON ret.product_id = p.id
      WHERE p.is_active = 1
      ORDER BY lower(p.name) ASC
    `).all<Record<string, unknown>>({ branchId })
    // Same normalization as the no-branchId path below: this used to omit
    // branch_stock entirely, which the frontend's per-branch availability
    // checks (Inventory.tsx handleAdjust/handleTransfer -- "how much of
    // this product exists in the selected branch?") read as "0 in every
    // branch" whenever a branch filter was active, even though
    // display_quantity right above was already correct for that branch.
    // That's what produced a misleading "no stock in this branch" error on
    // a genuinely successful remove/transfer whenever the Inventory page's
    // branch filter wasn't "All branches".
    const branchScopedItems = (rows || []).map((product) => {
      const next = { ...product } as Record<string, unknown>
      try {
        next.branch_stock = JSON.parse(String(next.branch_stock_json || '[]'))
      } catch (_) {
        next.branch_stock = []
      }
      delete next.branch_stock_json
      return next
    })
    return c.json(branchScopedItems)
  }

  const rows = await db.prepare(`
    SELECT p.*,
      p.stock_quantity AS display_quantity,
      COALESCE(p.stock_quantity * COALESCE(NULLIF(p.purchase_price_usd, 0), p.cost_price_usd, 0), 0) AS stock_value_usd,
      COALESCE(p.stock_quantity * COALESCE(NULLIF(p.purchase_price_khr, 0), p.cost_price_khr, 0), 0) AS stock_value_khr,
      COALESCE(si.qty_sold, 0) - COALESCE(ret.qty_returned, 0) AS qty_sold,
      COALESCE(si.store_discount_usd, 0) AS store_discount_usd,
      COALESCE(si.store_discount_khr, 0) AS store_discount_khr,
      COALESCE(si.membership_discount_usd, 0) AS membership_discount_usd,
      COALESCE(si.membership_discount_khr, 0) AS membership_discount_khr,
      COALESCE(si.revenue_usd, 0) - COALESCE(ret.refund_usd, 0) AS revenue_usd,
      COALESCE(si.revenue_khr, 0) - COALESCE(ret.refund_khr, 0) AS revenue_khr,
      COALESCE(si.cogs_usd, 0) - COALESCE(ret.cogs_returned_usd, 0) AS cogs_usd,
      COALESCE(si.cogs_khr, 0) - COALESCE(ret.cogs_returned_khr, 0) AS cogs_khr,
      COALESCE((
        SELECT json_group_array(json_object('branch_id', bs2.branch_id, 'branch_name', b2.name, 'quantity', bs2.quantity))
        FROM branch_stock bs2
        JOIN branches b2 ON b2.id = bs2.branch_id
        WHERE bs2.product_id = p.id
      ), '[]') AS branch_stock_json
    FROM products p
    LEFT JOIN (
      SELECT si.product_id,
             SUM(si.quantity) AS qty_sold,
             SUM(CASE WHEN COALESCE(s.subtotal_usd, 0) > 0 THEN (si.total_usd / s.subtotal_usd) * COALESCE(s.discount_usd, 0) ELSE 0 END) AS store_discount_usd,
             SUM(CASE WHEN COALESCE(s.subtotal_khr, 0) > 0 THEN (si.total_khr / s.subtotal_khr) * COALESCE(s.discount_khr, 0) ELSE 0 END) AS store_discount_khr,
             SUM(CASE WHEN COALESCE(s.subtotal_usd, 0) > 0 THEN (si.total_usd / s.subtotal_usd) * COALESCE(s.membership_discount_usd, 0) ELSE 0 END) AS membership_discount_usd,
             SUM(CASE WHEN COALESCE(s.subtotal_khr, 0) > 0 THEN (si.total_khr / s.subtotal_khr) * COALESCE(s.membership_discount_khr, 0) ELSE 0 END) AS membership_discount_khr,
             SUM(si.total_usd - CASE WHEN COALESCE(s.subtotal_usd, 0) > 0 THEN (si.total_usd / s.subtotal_usd) * (COALESCE(s.discount_usd, 0) + COALESCE(s.membership_discount_usd, 0)) ELSE 0 END) AS revenue_usd,
             SUM(si.total_khr - CASE WHEN COALESCE(s.subtotal_khr, 0) > 0 THEN (si.total_khr / s.subtotal_khr) * (COALESCE(s.discount_khr, 0) + COALESCE(s.membership_discount_khr, 0)) ELSE 0 END) AS revenue_khr,
             SUM(si.cost_price_usd * si.quantity) AS cogs_usd,
             SUM(si.cost_price_khr * si.quantity) AS cogs_khr
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE COALESCE(s.sale_status, 'completed') NOT IN ('awaiting_payment', 'cancelled')
      GROUP BY si.product_id
    ) si ON si.product_id = p.id
    LEFT JOIN (
      SELECT ri.product_id,
             SUM(ri.quantity) AS qty_returned,
             SUM(ri.total_usd) AS refund_usd,
             SUM(ri.total_khr) AS refund_khr,
             SUM(CASE WHEN ri.return_to_stock = 1 THEN ri.cost_price_usd * ri.quantity ELSE 0 END) AS cogs_returned_usd,
             SUM(CASE WHEN ri.return_to_stock = 1 THEN ri.cost_price_khr * ri.quantity ELSE 0 END) AS cogs_returned_khr
      FROM return_items ri
      JOIN returns r ON r.id = ri.return_id
      WHERE COALESCE(r.status, 'completed') != 'cancelled'
        AND COALESCE(r.return_scope, 'customer') = 'customer'
      GROUP BY ri.product_id
    ) ret ON ret.product_id = p.id
    WHERE p.is_active = 1
    ORDER BY lower(p.name) ASC
  `).all<Record<string, unknown>>({})

  const items = (rows || []).map((product) => {
    const next = { ...product } as Record<string, unknown>
    try {
      next.branch_stock = JSON.parse(String(next.branch_stock_json || '[]'))
    } catch (_) {
      next.branch_stock = []
    }
    delete next.branch_stock_json
    return next
  })
  return c.json(items)
})

// Sales-minus-returns financial join, scoped to a branch when the caller
// filtered by one (mirrors appendInventoryProductFilters's own branch
// scoping so the two join consistently on the same @branchId param).
// Ported from backend/src/routes/inventory.ts's buildInventoryFinancialJoinSql.
function buildInventoryFinancialJoinSql(branchScoped: boolean): string {
  const saleBranchClause = branchScoped ? 'AND si.branch_id = @branchId' : ''
  const returnBranchClause = branchScoped ? 'AND COALESCE(ri.branch_id, r.branch_id) = @branchId' : ''
  return `
    LEFT JOIN (
      SELECT si.product_id,
             SUM(si.quantity) AS qty_sold,
             SUM(CASE WHEN COALESCE(s.subtotal_usd, 0) > 0 THEN (si.total_usd / s.subtotal_usd) * COALESCE(s.discount_usd, 0) ELSE 0 END) AS store_discount_usd,
             SUM(CASE WHEN COALESCE(s.subtotal_khr, 0) > 0 THEN (si.total_khr / s.subtotal_khr) * COALESCE(s.discount_khr, 0) ELSE 0 END) AS store_discount_khr,
             SUM(CASE WHEN COALESCE(s.subtotal_usd, 0) > 0 THEN (si.total_usd / s.subtotal_usd) * COALESCE(s.membership_discount_usd, 0) ELSE 0 END) AS membership_discount_usd,
             SUM(CASE WHEN COALESCE(s.subtotal_khr, 0) > 0 THEN (si.total_khr / s.subtotal_khr) * COALESCE(s.membership_discount_khr, 0) ELSE 0 END) AS membership_discount_khr,
             SUM(si.total_usd - CASE WHEN COALESCE(s.subtotal_usd, 0) > 0 THEN (si.total_usd / s.subtotal_usd) * (COALESCE(s.discount_usd, 0) + COALESCE(s.membership_discount_usd, 0)) ELSE 0 END) AS revenue_usd,
             SUM(si.total_khr - CASE WHEN COALESCE(s.subtotal_khr, 0) > 0 THEN (si.total_khr / s.subtotal_khr) * (COALESCE(s.discount_khr, 0) + COALESCE(s.membership_discount_khr, 0)) ELSE 0 END) AS revenue_khr,
             SUM(si.cost_price_usd * si.quantity) AS cogs_usd,
             SUM(si.cost_price_khr * si.quantity) AS cogs_khr
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE COALESCE(s.sale_status, 'completed') NOT IN ('awaiting_payment', 'cancelled')
        ${saleBranchClause}
      GROUP BY si.product_id
    ) si ON si.product_id = p.id
    LEFT JOIN (
      SELECT ri.product_id,
             SUM(ri.quantity) AS qty_returned,
             SUM(ri.total_usd) AS refund_usd,
             SUM(ri.total_khr) AS refund_khr,
             SUM(CASE WHEN ri.return_to_stock = 1 THEN ri.cost_price_usd * ri.quantity ELSE 0 END) AS cogs_returned_usd,
             SUM(CASE WHEN ri.return_to_stock = 1 THEN ri.cost_price_khr * ri.quantity ELSE 0 END) AS cogs_returned_khr
      FROM return_items ri
      JOIN returns r ON r.id = ri.return_id
      WHERE COALESCE(r.status, 'completed') != 'cancelled'
        AND COALESCE(r.return_scope, 'customer') = 'customer'
        ${returnBranchClause}
      GROUP BY ri.product_id
    ) ret ON ret.product_id = p.id
  `
}

// GET /stats -- previously ignored every filter param the Inventory page
// sends (branchId, search, brand, stockState, groupState, initial) and
// always returned an unfiltered, differently-shaped totals row, so the
// stat cards never matched what the filtered product table below them
// was showing (and didn't even use the field names
// frontend/src/components/inventory/Inventory.tsx actually reads --
// total_products/in_stock/low_stock/out_of_stock/net_sold_qty/revenue_usd/
// cogs_usd/store_discount_usd/membership_discount_usd, confirmed by
// reading that component). Ported from backend/src/routes/inventory.ts's
// GET /stats + getFilteredInventoryStats, reusing this file's own
// appendInventoryProductFilters (same filter logic /products/search
// already applies) plus the financial join above. Always runs the same
// query now -- with no filters applied it's equivalent to the old
// unfiltered totals, just under the field names the frontend expects.
app.get('/stats', async (c) => {
  const query = c.req.query() as InventoryFilterQuery
  const { where, joins, params, stockExpr } = appendInventoryProductFilters(query)
  const joinSql = joins.join('\n')
  const whereSql = `WHERE ${where.join(' AND ')}`
  const branchScoped = Number.isFinite(Number(params.branchId))
  const financialJoinSql = buildInventoryFinancialJoinSql(branchScoped)
  const db = getDb(c.env)

  // total_products/in_stock/low_stock/out_of_stock are family-aware (see
  // familyStockStats.ts) so they agree with the family-grouped pagination
  // total shown on the product list below these stat cards -- previously
  // this counted every variant row (and group-header placeholder rows)
  // individually, which overcounted vs. the listing whenever grouped
  // products existed. net_sold_qty/revenue/cogs/discounts stay summed
  // per-row (unchanged) since those are real per-variant transaction
  // totals, not a "how many products" count.
  const [familyStats, financialRow] = await Promise.all([
    getFamilyStockStats({ db, joinSql, whereSql, params, qtyExpr: stockExpr }),
    db.prepare(`
      SELECT
        COALESCE(SUM(COALESCE(si.qty_sold, 0) - COALESCE(ret.qty_returned, 0)), 0) AS net_sold_qty,
        COALESCE(SUM(COALESCE(si.store_discount_usd, 0)), 0) AS store_discount_usd,
        COALESCE(SUM(COALESCE(si.store_discount_khr, 0)), 0) AS store_discount_khr,
        COALESCE(SUM(COALESCE(si.membership_discount_usd, 0)), 0) AS membership_discount_usd,
        COALESCE(SUM(COALESCE(si.membership_discount_khr, 0)), 0) AS membership_discount_khr,
        COALESCE(SUM(COALESCE(si.revenue_usd, 0) - COALESCE(ret.refund_usd, 0)), 0) AS revenue_usd,
        COALESCE(SUM(COALESCE(si.revenue_khr, 0) - COALESCE(ret.refund_khr, 0)), 0) AS revenue_khr,
        COALESCE(SUM(COALESCE(si.cogs_usd, 0) - COALESCE(ret.cogs_returned_usd, 0)), 0) AS cogs_usd,
        COALESCE(SUM(COALESCE(si.cogs_khr, 0) - COALESCE(ret.cogs_returned_khr, 0)), 0) AS cogs_khr
      FROM products p
      ${joinSql}
      ${financialJoinSql}
      ${whereSql}
    `).get<Record<string, number>>(params),
  ])
  const row = financialRow || {}

  return c.json({
    item: {
      total_products: familyStats.total_products,
      in_stock: familyStats.in_stock,
      healthy: familyStats.healthy,
      low_stock: familyStats.low_stock,
      out_of_stock: familyStats.out_of_stock,
      stock_quantity: familyStats.stock_quantity,
      stock_value_usd: familyStats.stock_value_usd,
      stock_value_khr: familyStats.stock_value_khr,
      net_sold_qty: Number(row.net_sold_qty || 0),
      store_discount_usd: Number(row.store_discount_usd || 0),
      store_discount_khr: Number(row.store_discount_khr || 0),
      membership_discount_usd: Number(row.membership_discount_usd || 0),
      membership_discount_khr: Number(row.membership_discount_khr || 0),
      revenue_usd: Number(row.revenue_usd || 0),
      revenue_khr: Number(row.revenue_khr || 0),
      cogs_usd: Number(row.cogs_usd || 0),
      cogs_khr: Number(row.cogs_khr || 0),
      // Back-compat aliases for the unfiltered shape above, so existing
      // callers reading product_count/low_stock_count/out_of_stock_count
      // keep working whether or not a filter was applied.
      product_count: familyStats.total_products,
      low_stock_count: familyStats.low_stock,
      out_of_stock_count: familyStats.out_of_stock,
    },
  })
})

app.get('/movements', async (c) => {
  const query = c.req.query()
  const page = clampInt(query.page, 1, 1, 100000)
  const pageSize = clampInt(query.pageSize, 100, 1, 50000)
  const offset = (page - 1) * pageSize
  const db = getDb(c.env)

  const where: string[] = []
  const params: Record<string, unknown> = {}

  const branchId = Number.parseInt(String(query.branchId || query.branch_id || ''), 10)
  if (Number.isFinite(branchId) && branchId > 0) {
    params.branchId = branchId
    where.push('branch_id = @branchId')
  }

  // Precise product scoping for the Inventory product-detail "view stock
  // history" preview -- previously the only way to scope movements to one
  // product was the fuzzy `search` (product_name LIKE) filter, which can
  // both under-match (a product renamed since some of its movements were
  // logged) and over-match (another product with a similar/substring name).
  const productId = Number.parseInt(String(query.productId || query.product_id || ''), 10)
  if (Number.isFinite(productId) && productId > 0) {
    params.productId = productId
    where.push('product_id = @productId')
  }

  const userId = Number.parseInt(String(query.userId || query.user_id || ''), 10)
  if (Number.isFinite(userId) && userId > 0) {
    params.userId = userId
    where.push('user_id = @userId')
  }

  const terms = splitSearchTerms(query.search || query.q || '')
  if (terms.length) {
    const mode = String(query.searchMode || query.search_mode || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'
    // Same normalizedHaystackSql/expandAliasCandidates treatment as the
    // product filters above and routes/products.ts's buildSearchFilters --
    // this is the "view stock history" movement-log search, not a product
    // search, so it stays scoped to the movement's own fields
    // (product_name/branch_name/user_name/movement_type/reason), matching
    // its existing (narrower) field set.
    const productNameSql = normalizedHaystackSql("COALESCE(product_name, '')")
    const branchNameSql = normalizedHaystackSql("COALESCE(branch_name, '')")
    const userNameSql = normalizedHaystackSql("COALESCE(user_name, '')")
    const movementTypeSql = normalizedHaystackSql("COALESCE(movement_type, '')")
    const reasonSql = normalizedHaystackSql("COALESCE(reason, '')")
    const termClauses: string[] = []
    terms.forEach((term, index) => {
      const candidateClauses = expandAliasCandidates(term).map((candidate, candidateIndex) => {
        const key = `search${index}_${candidateIndex}`
        params[key] = `%${candidate}%`
        return `(
          ${productNameSql} LIKE @${key}
          OR ${branchNameSql} LIKE @${key}
          OR ${userNameSql} LIKE @${key}
          OR ${movementTypeSql} LIKE @${key}
          OR ${reasonSql} LIKE @${key}
        )`
      })
      termClauses.push(`(${candidateClauses.join(' OR ')})`)
    })
    where.push(`(${termClauses.join(` ${mode} `)})`)
  }

  const startDate = String(query.startDate || query.start_date || '').trim()
  if (startDate) {
    params.startDate = startDate
    where.push('date(created_at) >= date(@startDate)')
  }
  const endDate = String(query.endDate || query.end_date || '').trim()
  if (endDate) {
    params.endDate = endDate
    where.push('date(created_at) <= date(@endDate)')
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = await db.prepare(`SELECT COUNT(*) AS count FROM inventory_movements ${whereSql}`).get<{ count: number }>(params)
  const items = await db.prepare(`
    SELECT * FROM inventory_movements
    ${whereSql}
    ORDER BY created_at DESC, id DESC
    LIMIT @pageSize OFFSET @offset
  `).all({ ...params, pageSize, offset })
  return c.json({ items, total: total?.count || 0, page, pageSize, totalPages: Math.max(1, Math.ceil((total?.count || 0) / pageSize)) })
})

// ---- Reasons (saved as JSON in settings, matching the Docker backend) ----

type InventoryReason = { type: string; label: string }

function normalizeReasons(raw: unknown): InventoryReason[] {
  const list = Array.isArray(raw) ? raw : []
  const seen = new Set<string>()
  const normalized: InventoryReason[] = []
  for (const entry of list) {
    const type = String((entry as Record<string, unknown>)?.type || 'adjust').trim().toLowerCase()
    const label = String((entry as Record<string, unknown>)?.label || '').trim()
    if (!label) continue
    const key = `${type}:${label.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push({ type, label })
  }
  normalized.sort((a, b) => (a.type === b.type ? a.label.localeCompare(b.label) : a.type.localeCompare(b.type)))
  return normalized
}

app.get('/reasons', async (c) => {
  const db = getDb(c.env)
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'inventory_saved_reasons' LIMIT 1").get<{ value: string }>({})
  let items: InventoryReason[] = []
  if (row?.value) {
    try { items = normalizeReasons(JSON.parse(row.value)) } catch (_) { items = [] }
  }
  return c.json({ items })
})

app.put('/reasons', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const items = normalizeReasons(body.items || body.reasons || [])

  // Part 152: the first inventory write wired into the Review Required
  // queue -- picked first because, unlike adjust/transfer/move-row below,
  // it has no live-state dependency at apply time (no batch ledger, no
  // current-stock check that could go stale between queueing and
  // approval) -- replaying it later through the exact same INSERT...ON
  // CONFLICT is exactly as safe as applying it now. See reviewApply.ts's
  // matching applier and the comment on adjust/transfer/move-row below
  // for why those three are NOT wired yet.
  const pendingId = await maybeQueueForReview(c.env, user, 'inventory', {
    actionType: 'update',
    entityType: 'inventory_reason',
    entityId: null,
    payload: { items },
    summary: `Update inventory reasons list (${items.length} item${items.length === 1 ? '' : 's'})`,
  })
  if (pendingId != null) {
    return c.json({ success: true, pending: true, pendingActionId: pendingId }, 202)
  }

  const db = getDb(c.env)
  await db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES ('inventory_saved_reasons', @value, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run({ value: JSON.stringify(items) })
  await audit(c.env, user?.id ?? null, user?.name ?? null, 'update', 'inventory_reason', null, { count: items.length })
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'reasons_update' }))
  return c.json({ items })
})

// ---- Stock writes: adjust / transfer / move-row ----
//
// Part 152 status: NOT wired into the Review Required queue, unlike
// /reasons above -- deliberately scoped out rather than rushed. All
// three read and consume LIVE state as part of applying the write itself
// (current branch_stock quantity for a remove's insufficient-stock check;
// active batch rows for the FIFO drain/receive ledger; a fresh identity-
// match lookup for unlockPricing's sibling-row resolution) -- the same
// "replay through the exact write path" pattern that's safe for fees'
// delete, products' create/update/delete, and /reasons above (all of
// which write straight from the queued payload with no dependency on
// what's changed since) would, here, either need to re-validate all of
// that live state at *approval* time (a batch a requester picked could
// be fully drained by someone else before a reviewer approves; a
// remove's "only N available" check could pass at queue time and fail --
// or silently under/over-remove -- at apply time) or accept replaying
// against state that's since moved. Needs its own design pass (does the
// approval re-check and reject on conflict, or re-resolve against
// current state and tell the reviewer what changed) before wiring, not
// just the same registerApplier pattern used elsewhere. Recorded as its
// own Open item in progress.md rather than left implicit here.

// Fields the "receive stock" grouping decision cares about -- everything
// that makes a row a genuinely different sellable item, deliberately
// excluding branch/stock_quantity (see findIdentityMatch's own comment:
// this is the exact same name_key + cost + selling price + barcode rule
// transfers, CSV import, and merge-duplicates already use, so a manual
// Add Stock with edited pricing resolves to a row the same way every
// other path in the app already would). `cost_price_usd/khr` and
// `purchase_price_usd/khr` are kept mirrored to the same value everywhere
// they're written (see mirrorCostFields below) -- the schema still has
// both columns (0001_init.sql), but nothing user-facing treats them as
// two different numbers any more, so only one ("cost") is ever asked for.
type StockRowFields = {
  id: number
  name: string | null
  sku: string | null
  barcode: string | null
  category: string | null
  brand: string | null
  unit: string | null
  description: string | null
  supplier: string | null
  parent_id: number | null
  selling_price_usd: number | null
  selling_price_khr: number | null
  special_price_usd: number | null
  special_price_khr: number | null
  discount_enabled: number | null
  discount_type: string | null
  discount_percent: number | null
  discount_amount_usd: number | null
  discount_amount_khr: number | null
  purchase_price_usd: number | null
  purchase_price_khr: number | null
  cost_price_usd: number | null
  cost_price_khr: number | null
  low_stock_threshold: number | null
  out_of_stock_threshold: number | null
}

const STOCK_ROW_COLUMNS = `id, name, sku, barcode, category, brand, unit, description, supplier, parent_id,
  selling_price_usd, selling_price_khr, special_price_usd, special_price_khr,
  discount_enabled, discount_type, discount_percent, discount_amount_usd, discount_amount_khr,
  purchase_price_usd, purchase_price_khr, cost_price_usd, cost_price_khr,
  low_stock_threshold, out_of_stock_threshold`

function moneyEq(a: unknown, b: unknown): boolean {
  return Math.round((Number(a) || 0) * 100) === Math.round((Number(b) || 0) * 100)
}

function lowerTrim(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

// Sets purchase_price_* and cost_price_* to the same value -- the single
// "Cost" input the frontend now sends. Kept as its own function (rather
// than inlined at each write site) so every write path that used to ask
// for "cost" and "purchase" separately stays in sync from one place.
function mirrorCostFields(usd: number, khr: number) {
  return { purchase_price_usd: usd, purchase_price_khr: khr, cost_price_usd: usd, cost_price_khr: khr }
}

// "Add stock with pricing unlocked": the receiving-different-stock case
// that used to require the separate Move Stock modal (quick-create a
// destination row, then move quantity onto it). Applies the exact same
// identity rule findIdentityMatch already uses for transfers/import/
// merge-duplicates: same name_key + cost + selling price + barcode is one
// row; anything else is a different row. Returns the product id stock
// should actually be added to -- either an existing sibling row that
// already matches the edited pricing, the source row itself (pricing
// wasn't actually different from what it already had), or a brand-new
// sibling row created to hold this specific combination of details.
async function resolveAddStockTarget(
  env: Env,
  source: StockRowFields,
  overrides: {
    sellingUsd: number; sellingKhr: number
    specialUsd: number; specialKhr: number
    discountEnabled: boolean; discountType: string; discountPercent: number; discountAmountUsd: number; discountAmountKhr: number
    costUsd: number; costKhr: number
    barcode: string | null
  },
): Promise<{ productId: number; created: boolean }> {
  const db = getDb(env)
  const candidate: ProductIdentityRow = {
    id: source.id,
    name: source.name,
    barcode: overrides.barcode,
    purchase_price_usd: overrides.costUsd,
    purchase_price_khr: overrides.costKhr,
    selling_price_usd: overrides.sellingUsd,
    selling_price_khr: overrides.sellingKhr,
  }

  const sameAsSelf = moneyEq(overrides.costUsd, source.purchase_price_usd)
    && moneyEq(overrides.costKhr, source.purchase_price_khr)
    && moneyEq(overrides.sellingUsd, source.selling_price_usd)
    && moneyEq(overrides.sellingKhr, source.selling_price_khr)
    && moneyEq(overrides.specialUsd, source.special_price_usd)
    && moneyEq(overrides.specialKhr, source.special_price_khr)
    && lowerTrim(overrides.barcode) === lowerTrim(source.barcode)
    && Boolean(source.discount_enabled) === overrides.discountEnabled
  if (sameAsSelf) return { productId: source.id, created: false }

  const match = await findIdentityMatch(db, candidate)
  if (match) return { productId: match.id, created: false }

  // No existing row has this exact combination -- create a new sibling
  // row (same name, so it still groups with the source in every view
  // that groups by name -- see products.ts's own "most real groups...
  // share a name with no is_group/parent_id set at all" comment) carrying
  // the edited pricing, and mirror it into the source's parent, if any.
  const cost = mirrorCostFields(overrides.costUsd, overrides.costKhr)
  const insertPayload = {
    name: source.name,
    sku: null,
    barcode: overrides.barcode,
    category: source.category,
    brand: source.brand,
    unit: source.unit,
    description: source.description,
    supplier: source.supplier,
    parent_id: source.parent_id ?? null,
    is_group: 0,
    is_active: 1,
    selling_price_usd: overrides.sellingUsd,
    selling_price_khr: overrides.sellingKhr,
    special_price_usd: overrides.specialUsd,
    special_price_khr: overrides.specialKhr,
    discount_enabled: overrides.discountEnabled ? 1 : 0,
    discount_type: overrides.discountType || 'percent',
    discount_percent: overrides.discountPercent,
    discount_amount_usd: overrides.discountAmountUsd,
    discount_amount_khr: overrides.discountAmountKhr,
    ...cost,
    low_stock_threshold: source.low_stock_threshold,
    out_of_stock_threshold: source.out_of_stock_threshold,
    stock_quantity: 0,
  }
  const columns = Object.keys(insertPayload)
  const result = await db.prepare(`
    INSERT INTO products (${columns.join(', ')}, created_at, updated_at)
    VALUES (${columns.map((col) => `@${col}`).join(', ')}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(insertPayload)
  return { productId: Number(result.lastInsertRowid), created: true }
}

async function defaultBranchId(env: Env): Promise<number | null> {
  const row = await getDb(env).prepare("SELECT id FROM branches WHERE is_active = 1 ORDER BY is_default DESC, id ASC LIMIT 1").get<{ id: number }>({})
  return row?.id ?? null
}

async function branchStockQty(env: Env, productId: number, branchId: number): Promise<number> {
  const row = await getDb(env).prepare('SELECT quantity FROM branch_stock WHERE product_id = @productId AND branch_id = @branchId').get<{ quantity: number }>({ productId, branchId })
  return row ? num(row.quantity) : 0
}

async function applyStockDelta(env: Env, productId: number, branchId: number, delta: number) {
  const db = getDb(env)
  await db.batch([
    {
      sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@productId, @branchId, @delta)
            ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
      params: { productId, branchId, delta },
    },
    {
      sql: 'UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) + @delta, updated_at = CURRENT_TIMESTAMP WHERE id = @productId',
      params: { productId, delta },
    },
  ])
}

app.post('/adjust', async (c) => {
  const user = c.get('user')
  // Part 152: not yet wired into the Review Required queue (see the
  // comment above /reasons for why -- live batch/stock state at apply
  // time makes "queue now, replay later" unsafe without its own design
  // pass). Explicitly blocked for a review-tier user rather than silently
  // falling through to a full-access write now that the top-level
  // middleware admits review-tier users for reads.
  if (getPermissionTier(user, 'inventory') === 'review') {
    return c.json({ error: 'Stock adjustments require Full Access to Inventory -- Review Required support for this action is not built yet.' }, 403)
  }
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const productId = Number.parseInt(String(body.productId ?? ''), 10)
  let type = String(body.type || '')
  let quantity = Number(body.quantity)
  const reason = body.reason != null ? String(body.reason).trim() || null : null
  const requestedBranchId = body.branchId != null ? Number.parseInt(String(body.branchId), 10) : null
  // `unlockPricing` is an explicit flag from the frontend, not inferred by
  // diffing -- see InventoryStockModals.tsx's "Lock current pricing"
  // toggle. Locked (the default) skips the identity lookup below entirely
  // and behaves exactly as before: add straight to productId/branchId.
  const unlockPricing = type === 'add' && Boolean(body.unlockPricing) && body.pricing && typeof body.pricing === 'object'

  if (!productId || !Number.isFinite(quantity)) return c.json({ error: 'Missing required fields' }, 400)
  if (!['add', 'remove', 'set'].includes(type)) return c.json({ error: 'Invalid stock action' }, 400)
  if (!(quantity > 0)) return c.json({ error: 'Quantity must be a positive number' }, 400)
  // Every stock change needs a documented cause -- no add/remove/set can go
  // through undocumented. Checked here, once, ahead of any DB work, so
  // there's no path (direct API call included) that can move stock without
  // one. Undo/redo and the bulk helpers already send a non-empty default
  // (see Products.tsx/Inventory.tsx), so this doesn't newly block any
  // existing caller -- it only closes the gap where a hand-typed request
  // omitted `reason` entirely.
  if (!reason) return c.json({ error: 'A reason is required for stock adjustments' }, 400)

  const db = getDb(c.env)
  const product = unlockPricing
    ? await db.prepare(`SELECT ${STOCK_ROW_COLUMNS} FROM products WHERE id = @id`).get<StockRowFields>({ id: productId })
    : await db.prepare('SELECT id, name FROM products WHERE id = @id').get<{ id: number; name: string }>({ id: productId })
  if (!product) return c.json({ error: 'Product not found' }, 404)

  const branchId = requestedBranchId || (await defaultBranchId(c.env))
  if (!branchId) return c.json({ error: 'An active branch is required before stock can be changed' }, 400)
  const branch = await db.prepare('SELECT id, name FROM branches WHERE id = @id').get<{ id: number; name: string }>({ id: branchId })

  // 'set' ("Set stock to X") is a UI convenience only -- it has never had
  // its own real movement semantics (no batch concept, see the old
  // comment that used to sit on `movementType = 'set'` below) and used to
  // skip the batch ledger entirely, so a set-to-X never left a batch
  // trail the way an add/remove did. Converted here, immediately, into a
  // plain add or remove of the difference so it goes through *exactly*
  // the same mandatory-reason + batch-ledger path as everything else --
  // one stock-changing code path, not two. unlockPricing is only ever
  // true for a request whose *original* type was 'add', so productId is
  // still the correct row to read current stock from at this point.
  const originalType = type
  let setToNote: string | null = null
  if (type === 'set') {
    const current = await branchStockQty(c.env, productId, branchId)
    const diff = quantity - current
    if (diff === 0) {
      return c.json({
        success: true, branchId, movementType: 'set', quantity: 0,
        productId, productName: product.name, createdSibling: false,
        batchNumber: null, batchId: null, autoBatchDrainIds: null,
      })
    }
    setToNote = `Set to ${quantity}`
    type = diff > 0 ? 'add' : 'remove'
    quantity = Math.abs(diff)
  }

  // Resolve which product row actually receives the quantity. Ordinary
  // adds (pricing locked, or type isn't 'add' at all) always target the
  // row the request named -- this is the fast, unchanged path. Only an
  // unlocked add runs the identity-match lookup, since that's the only
  // case where "same name, different details" can mean a different row.
  let targetProductId = productId
  let targetProductName = product.name
  let createdSibling = false
  if (unlockPricing) {
    const pricing = body.pricing as Record<string, unknown>
    const source = product as StockRowFields
    const overrides = {
      sellingUsd: pricing.selling_price_usd != null ? Number(pricing.selling_price_usd) || 0 : Number(source.selling_price_usd) || 0,
      sellingKhr: pricing.selling_price_khr != null ? Number(pricing.selling_price_khr) || 0 : Number(source.selling_price_khr) || 0,
      specialUsd: pricing.special_price_usd != null ? Number(pricing.special_price_usd) || 0 : Number(source.special_price_usd) || 0,
      specialKhr: pricing.special_price_khr != null ? Number(pricing.special_price_khr) || 0 : Number(source.special_price_khr) || 0,
      discountEnabled: pricing.discount_enabled != null ? Boolean(pricing.discount_enabled) : Boolean(source.discount_enabled),
      discountType: pricing.discount_type != null ? String(pricing.discount_type) : String(source.discount_type || 'percent'),
      discountPercent: pricing.discount_percent != null ? Number(pricing.discount_percent) || 0 : Number(source.discount_percent) || 0,
      discountAmountUsd: pricing.discount_amount_usd != null ? Number(pricing.discount_amount_usd) || 0 : Number(source.discount_amount_usd) || 0,
      discountAmountKhr: pricing.discount_amount_khr != null ? Number(pricing.discount_amount_khr) || 0 : Number(source.discount_amount_khr) || 0,
      costUsd: pricing.cost_usd != null ? Number(pricing.cost_usd) || 0 : Number(source.purchase_price_usd) || 0,
      costKhr: pricing.cost_khr != null ? Number(pricing.cost_khr) || 0 : Number(source.purchase_price_khr) || 0,
      barcode: pricing.barcode != null ? (String(pricing.barcode).trim() || null) : source.barcode,
    }
    const resolved = await resolveAddStockTarget(c.env, source, overrides)
    targetProductId = resolved.productId
    createdSibling = resolved.created
    if (createdSibling) {
      const created = await db.prepare('SELECT id, name FROM products WHERE id = @id').get<{ id: number; name: string }>({ id: targetProductId })
      targetProductName = created?.name ?? source.name
      c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'create', id: targetProductId }))
    } else if (targetProductId !== productId) {
      const matched = await db.prepare('SELECT id, name FROM products WHERE id = @id').get<{ id: number; name: string }>({ id: targetProductId })
      targetProductName = matched?.name ?? source.name
    }
  }

  // Mandatory batch selection (InventoryStockModals.tsx, add/remove on flat
  // rows) rides on this same endpoint rather than a separate one, so undo/
  // redo, action-history replay, and every other existing caller of POST
  // /adjust keep working unchanged. `batchId` is opt-in at the wire level:
  // absent -> the original applyStockDelta path, untouched (though see
  // below -- add/remove now auto-routes through the ledger regardless).
  // Present for 'add'/'remove' -> routed
  // through receiveBatchStock/removeStockFromBatch instead, which already
  // do the same aggregate write (branch_stock/products.stock_quantity)
  // atomically alongside the batch ledger -- calling applyStockDelta *as
  // well* would double-count, so the two paths are mutually exclusive, not
  // layered.
  //
  // Price-unlock case: a batch belongs to one specific product row, and an
  // unlocked add can resolve to a *different* row than the one the person
  // had open when they picked a batch (resolveAddStockTarget above) -- that
  // choice would be invalid on whatever row it actually lands on. Enforced
  // here, not just by disabling the picker client-side, so it can't be
  // bypassed by calling this endpoint directly: any client-supplied
  // batchId is ignored whenever unlockPricing is true, and receiveBatchStock
  // is always called without one, which makes it create a fresh batch on
  // targetProductId every time.
  const rawBatchId = body.batchId
  const batchIdRequested = !unlockPricing && rawBatchId != null && rawBatchId !== '' && rawBatchId !== 'new'
    ? Number.parseInt(String(rawBatchId), 10)
    : null
  let useBatchLedger = (type === 'add' || type === 'remove') && (unlockPricing || rawBatchId != null && rawBatchId !== '')

  // Auto-routing for callers that omit `batchId` entirely -- undo/redo
  // replay (Products.tsx's restoreProductBranchStock), bulk add-stock
  // (addStockToProducts), and "clear stock to zero"
  // (clearProductStockByIds) have no interactive picker to source a
  // batchId from, so without this they'd silently fall through to the
  // plain applyStockDelta path below -- moving the aggregate figure while
  // every batch row (and the FIFO list the POS/ProductDetailSheet pickers
  // read) stays frozen at its old quantity.
  let autoBatchDrainIds: number[] | null = null
  // Previously gated on productHasBatchHistory: a product with no batch
  // rows yet stayed on the plain applyStockDelta path forever, so its
  // stock could move add after add, remove after remove, with no batch
  // trail ever created for it. Unconditional now -- every add/remove
  // (short of an explicit batchId, or unlockPricing which always makes
  // its own fresh batch) auto-routes through the ledger, so there's no
  // product for which "in and out" can happen without a batch record.
  if (!useBatchLedger && !unlockPricing && (type === 'add' || type === 'remove') && quantity > 0) {
    useBatchLedger = true
  }

  // type is always 'add' or 'remove' by this point -- 'set' was already
  // converted (or short-circuited as a no-op) above.
  let delta = 0
  const movementType = type
  let batchNumber: number | null = null
  let resolvedBatchId: number | null = batchIdRequested
  if (type === 'add') {
    delta = quantity
  } else {
    const current = await branchStockQty(c.env, targetProductId, branchId)
    if (quantity > current) return c.json({ error: `Cannot remove ${quantity} - only ${current} available in ${branch?.name || 'this branch'}` }, 400)
    delta = -quantity
  }

  if (useBatchLedger && type === 'add') {
    try {
      const received = await receiveBatchStock(db, {
        productId: targetProductId,
        branchId,
        quantity,
        // `unlockPricing` always creates a brand-new batch on the resolved
        // row -- see comment above -- so no batchId is passed through here.
        // Auto-routed adds (batchIdRequested still null, no explicit pick)
        // also create a fresh batch, same as picking "+ New batch" would.
        batchId: unlockPricing ? null : batchIdRequested,
      })
      batchNumber = received.batchNumber
      resolvedBatchId = received.batchId
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to receive batch stock' }, 400)
    }
  } else if (useBatchLedger && type === 'remove') {
    if (batchIdRequested != null) {
      try {
        await removeStockFromBatch(db, { batchId: batchIdRequested, productId: targetProductId, branchId, quantity })
      } catch (err) {
        if (err instanceof InsufficientBatchStockError) return c.json({ error: err.message }, 400)
        return c.json({ error: err instanceof Error ? err.message : 'Failed to remove batch stock' }, 400)
      }
    } else if (rawBatchId != null && rawBatchId !== '') {
      // An interactive picker explicitly requires a choice -- 'new' isn't
      // valid for remove (see BranchStockAdjuster.tsx/
      // InventoryStockModals.tsx's own client-side guard); this only
      // fires if that guard was somehow bypassed.
      return c.json({ error: 'A batch must be selected to remove stock' }, 400)
    } else {
      // Auto-routed remove (no interactive batchId at all) -- FIFO-drain
      // across whatever active batches this branch has rather than
      // require one named lot, since there's no picker in play here to
      // have named one. Any shortfall the batches can't cover (mixed-
      // provenance stock, see removeStockAcrossBatches) falls through to
      // the same plain decrement a batch-less product already used.
      try {
        const drained = await removeStockAcrossBatches(db, { productId: targetProductId, branchId, quantity })
        autoBatchDrainIds = drained.batchIds
        if (drained.remainder > 0) await applyStockDelta(c.env, targetProductId, branchId, -drained.remainder)
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : 'Failed to remove batch stock' }, 400)
      }
    }
  } else if (delta !== 0) {
    await applyStockDelta(c.env, targetProductId, branchId, delta)
  }

  if (delta !== 0) {
    await db.prepare(`
      INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_id, user_name, created_at)
      VALUES (@productId, @productName, @branchId, @branchName, @movementType, @quantity, @reason, @userId, @userName, CURRENT_TIMESTAMP)
    `).run({
      productId: targetProductId,
      productName: targetProductName,
      branchId,
      branchName: branch?.name || null,
      movementType,
      quantity: Math.abs(delta),
      reason: createdSibling
        ? `${reason ? `${reason} - ` : ''}Auto-created row (pricing differs from ${product.name})`
        : setToNote ? `${reason} (${setToNote})` : reason,
      userId: user?.id ?? null,
      userName: user?.name ?? null,
    })
  }

  // `type` is always 'add'/'remove' here (a 'set' request was converted
  // above), so the audit action must key off `originalType` -- keying off
  // `type` would make 'stock_set' unreachable and misreport every "Set
  // stock to X" as a plain add/remove in the audit log.
  await audit(c.env, user?.id ?? null, user?.name ?? null, originalType === 'set' ? 'stock_set' : type === 'remove' ? 'stock_remove' : 'stock_add', 'product', targetProductId, { type: originalType, quantity, reason, branchId, sourceProductId: productId, createdSibling, batchId: batchIdRequested, autoBatchDrainIds, unlockPricing })
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update', id: targetProductId }))
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'adjust', id: targetProductId }))
  c.executionCtx.waitUntil(bumpVersion(c.env.CACHE, 'products'))
  // NOTE: every other route file in this app replies `{ success: true, ... }`
  // on success (see products.ts, branches.ts, etc). This endpoint used to
  // reply with a bare `{}` -- the write went through and the DB was
  // correctly updated, but the frontend's `if (res?.success) {...} else

  // notify('Adjustment failed')` (Inventory.tsx) read the missing field as
  // failure and showed an error toast on every successful adjustment. Fixed
  // here by matching the app-wide response contract instead of patching
  // around it in every caller.
  //
  // `targetProductId`/`createdSibling` only differ from the request when
  // an unlocked add resolved to a different row than the one the request
  // named -- see resolveAddStockTarget above. The frontend uses these to
  // tell the person which row actually received the stock.
  return c.json({
    success: true,
    branchId,
    movementType,
    quantity: Math.abs(delta),
    productId: targetProductId,
    productName: targetProductName,
    createdSibling,
    batchNumber,
    batchId: resolvedBatchId,
    autoBatchDrainIds,
  })
})

// Dated stock-reconciliation import -- route wiring for
// lib/datedStockCountImport.ts's plan computation +
// lib/datedStockCountApply.ts's I/O apply layer (Part 278/279), plus
// lib/datedStockCountResolve.ts's raw-row resolution layer (Part 288).
// Scope of these three endpoints, deliberately: /resolve turns raw rows
// (a branch name string, a product identifier of some kind, a date, a
// count -- whatever a future column-mapping step produces) into
// resolved productId/branchId pairs for a review screen; /preview and
// /apply then turn an already-resolved entry list into a plan and, on
// /apply, real DB writes. Still explicitly NOT built here, same gaps
// progress.md's item 1 already lists: the actual CSV/XLSX column-mapping
// step itself (still blocked on a real file header shape from the user)
// and price-conflict resolution -- those happen upstream of /resolve
// (the frontend upload UI's job) and downstream of it (the review
// screen's job) respectively. The actual query/plan-building/resolution
// work lives in lib/datedStockCountRoute.ts and
// lib/datedStockCountResolve.ts, not here, so it can be
// regression-tested against a real DB the same way
// datedStockCountApply.ts already is, instead of only being reachable
// through a full Hono request.
app.post('/dated-stock-count/resolve', async (c) => {
  const user = c.get('user')
  // Same Full-Access gate as /preview and /apply below -- unlike
  // /preview, this one CAN write (an unrecognized branch name is
  // auto-created, see datedStockCountResolve.ts's own header comment),
  // so it's gated the same way /apply already is, not treated as
  // read-only.
  if (getPermissionTier(user, 'inventory') === 'review') {
    return c.json({ error: 'Dated stock-count import requires Full Access to Inventory -- Review Required support for this action is not built yet.' }, 403)
  }
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const parsed = parseRawDatedCountRows(body)
  if ('error' in parsed) return c.json({ success: false, error: parsed.error }, 400)

  const { resolved, unresolved, branchesCreated } = await resolveDatedStockCountRows(getDb(c.env), parsed.rows)

  if (branchesCreated.length) {
    await audit(c.env, user?.id ?? null, user?.name ?? null, 'dated_stock_count_resolve_branch_create', 'inventory', null, { branchesCreated })
    c.executionCtx.waitUntil(broadcast(c.env, 'branches', { action: 'update' }))
  }

  return c.json({ success: true, resolved, unresolved, branchesCreated })
})

// Executes a human's per-row decisions against /resolve's own output
// (lib/datedStockCountDecisions.ts) -- creates/links products, applies
// price choices, and returns a complete resolved list. Deliberately a
// separate endpoint from /resolve itself: /resolve only ANALYZES (see
// its own comment above), this one is where real product rows get
// created, so it needs the client to have already shown the human
// /resolve's `unresolved`/`priceConflict` output and collected their
// choices. Every row in the request's `unresolved` array must end up in
// the response's `resolved`, `skipped`, or `errors` -- never silently
// absent, per this session's own requirement ("no products are hidden,
// broken, failed, forgotten, loss").
app.post('/dated-stock-count/resolve/apply-decisions', async (c) => {
  const user = c.get('user')
  if (getPermissionTier(user, 'inventory') === 'review') {
    return c.json({ error: 'Dated stock-count import requires Full Access to Inventory -- Review Required support for this action is not built yet.' }, 403)
  }
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const resolvedIn = Array.isArray(body.resolved) ? body.resolved : null
  const unresolvedIn = Array.isArray(body.unresolved) ? body.unresolved : null
  const decisionsIn = Array.isArray(body.decisions) ? body.decisions : []
  if (!resolvedIn || !unresolvedIn) return c.json({ success: false, error: 'resolved and unresolved (from a prior /resolve call) are both required' }, 400)

  const db = getDb(c.env)
  const result = await applyDatedStockCountDecisions(db, resolvedIn as any, unresolvedIn as any, decisionsIn as DatedCountDecision[])

  if (result.productsCreated.length) {
    await audit(c.env, user?.id ?? null, user?.name ?? null, 'dated_stock_count_resolve_products_created', 'inventory', null, { productsCreated: result.productsCreated })
    c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
  }

  return c.json({ success: true, ...result })
})

app.post('/dated-stock-count/preview', async (c) => {
  const user = c.get('user')
  if (getPermissionTier(user, 'inventory') === 'review') {
    return c.json({ error: 'Dated stock-count import requires Full Access to Inventory -- Review Required support for this action is not built yet.' }, 403)
  }
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const parsed = parseDatedStockCountEntries(body)
  if ('error' in parsed) return c.json({ success: false, error: parsed.error }, 400)

  const built = await buildDatedStockCountPlan(getDb(c.env), parsed.entries)
  if ('error' in built) return c.json({ success: false, error: built.error }, built.status)

  return c.json({ success: true, plan: built.plan })
})

app.post('/dated-stock-count/apply', async (c) => {
  const user = c.get('user')
  if (getPermissionTier(user, 'inventory') === 'review') {
    return c.json({ error: 'Dated stock-count import requires Full Access to Inventory -- Review Required support for this action is not built yet.' }, 403)
  }
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const parsed = parseDatedStockCountEntries(body)
  if ('error' in parsed) return c.json({ success: false, error: parsed.error }, 400)

  const db = getDb(c.env)
  const built = await buildDatedStockCountPlan(db, parsed.entries)
  if ('error' in built) return c.json({ success: false, error: built.error }, built.status)

  const result = await applyDatedStockCountPlan(db, built.plan, { userId: user?.id ?? null, userName: user?.name ?? null })

  await audit(c.env, user?.id ?? null, user?.name ?? null, 'dated_stock_count_import', 'inventory', null, {
    entryCount: parsed.entries.length,
    movementsApplied: result.movementsApplied,
    movementsDeleted: result.movementsDeleted,
    batchTrackedGroups: result.batchTrackedGroups,
    plainGroups: result.plainGroups,
  })
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'dated_stock_count_import' }))
  c.executionCtx.waitUntil(bumpVersion(c.env.CACHE, 'products'))

  return c.json({ success: true, ...result })
})

app.post('/transfer', async (c) => {
  const user = c.get('user')
  // Same reasoning as /adjust above -- not wired into the review queue
  // yet, explicitly blocked rather than silently allowed through.
  if (getPermissionTier(user, 'inventory') === 'review') {
    return c.json({ error: 'Branch transfers require Full Access to Inventory -- Review Required support for this action is not built yet.' }, 403)
  }
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const productId = Number.parseInt(String(body.productId ?? body.product_id ?? ''), 10)
  const fromBranchId = Number.parseInt(String(body.fromBranchId ?? body.from_branch_id ?? ''), 10)
  const toBranchId = Number.parseInt(String(body.toBranchId ?? body.to_branch_id ?? ''), 10)
  const quantity = Number(body.quantity)
  const reason = body.reason != null ? String(body.reason).trim() || null : (body.note != null ? String(body.note).trim() || null : null)

  if (!productId || !fromBranchId || !toBranchId || !Number.isFinite(quantity)) return c.json({ error: 'Missing required fields' }, 400)
  if (fromBranchId === toBranchId) return c.json({ error: 'Source and destination cannot be the same' }, 400)
  if (!(quantity > 0)) return c.json({ error: 'Transfer quantity must be greater than zero' }, 400)

  const db = getDb(c.env)
  const product = await db.prepare('SELECT id, name FROM products WHERE id = @id').get<{ id: number; name: string }>({ id: productId })
  if (!product) return c.json({ error: 'Product not found' }, 404)
  const available = await branchStockQty(c.env, productId, fromBranchId)
  if (quantity > available) return c.json({ error: 'Insufficient stock in source branch' }, 400)

  const [fromBranch, toBranch] = await Promise.all([
    db.prepare('SELECT id, name FROM branches WHERE id = @id').get<{ id: number; name: string }>({ id: fromBranchId }),
    db.prepare('SELECT id, name FROM branches WHERE id = @id').get<{ id: number; name: string }>({ id: toBranchId }),
  ])

  await db.batch([
    { sql: 'UPDATE branch_stock SET quantity = quantity - @quantity WHERE product_id = @productId AND branch_id = @branchId', params: { quantity, productId, branchId: fromBranchId } },
    {
      sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@productId, @branchId, @quantity)
            ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
      params: { productId, branchId: toBranchId, quantity },
    },
    {
      sql: `INSERT INTO stock_transfers (product_id, product_name, from_branch_id, to_branch_id, quantity, notes, user_id, user_name, created_at)
            VALUES (@productId, @productName, @fromBranchId, @toBranchId, @quantity, @reason, @userId, @userName, CURRENT_TIMESTAMP)`,
      params: { productId, productName: product.name, fromBranchId, toBranchId, quantity, reason, userId: user?.id ?? null, userName: user?.name ?? null },
    },
    {
      sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_id, user_name, created_at)
            VALUES (@productId, @productName, @branchId, @branchName, 'transfer_out', @quantity, @reason, @userId, @userName, CURRENT_TIMESTAMP)`,
      params: { productId, productName: product.name, branchId: fromBranchId, branchName: fromBranch?.name || null, quantity, reason: `Transfer out to ${toBranch?.name || 'destination'}${reason ? ` - ${reason}` : ''}`, userId: user?.id ?? null, userName: user?.name ?? null },
    },
    {
      sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_id, user_name, created_at)
            VALUES (@productId, @productName, @branchId, @branchName, 'transfer_in', @quantity, @reason, @userId, @userName, CURRENT_TIMESTAMP)`,
      params: { productId, productName: product.name, branchId: toBranchId, branchName: toBranch?.name || null, quantity, reason: `Transfer in from ${fromBranch?.name || 'source'}${reason ? ` - ${reason}` : ''}`, userId: user?.id ?? null, userName: user?.name ?? null },
    },
  ])

  await audit(c.env, user?.id ?? null, user?.name ?? null, 'transfer', 'stock', productId, { productName: product.name, quantity, fromBranchId, toBranchId })
  c.executionCtx.waitUntil(broadcast(c.env, 'branches', { action: 'transfer' }))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update', id: productId }))
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'transfer', id: productId }))
  c.executionCtx.waitUntil(bumpVersion(c.env.CACHE, 'products'))
  // See the matching note in /adjust above -- same missing-`success`-field bug.
  return c.json({ success: true, fromBranchId, toBranchId, quantity })
})

// DEPRECATED as a UI entry point: InventoryStockModals.tsx no longer has a
// "Move stock" action -- receiving stock at different pricing now goes
// through POST /adjust's `unlockPricing` path (resolveAddStockTarget
// above), which finds-or-creates the right row automatically instead of
// asking the person to pick "existing row" vs "quick-create" by hand. The
// route itself is left in place (not deleted) since it's a real, tested,
// independently-useful primitive -- "move N units of this specific row's
// stock to that specific other row" -- or something a future workflow
// (e.g. relabeling already-received stock as damaged) might still want
// as a direct move rather than an add-with-different-pricing.
app.post('/move-row', async (c) => {
  const user = c.get('user')
  // Same reasoning as /adjust above -- not wired into the review queue
  // yet, explicitly blocked rather than silently allowed through.
  if (getPermissionTier(user, 'inventory') === 'review') {
    return c.json({ error: 'Moving stock between rows requires Full Access to Inventory -- Review Required support for this action is not built yet.' }, 403)
  }
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const sourceProductId = Number.parseInt(String(body.sourceProductId ?? body.source_product_id ?? ''), 10)
  const destinationProductId = Number.parseInt(String(body.destinationProductId ?? body.destination_product_id ?? ''), 10)
  const quantity = Number(body.quantity)
  const requestedBranchId = body.branchId ?? body.branch_id ? Number.parseInt(String(body.branchId ?? body.branch_id), 10) : null
  const reason = body.reason != null ? String(body.reason).trim() || null : null

  if (!sourceProductId) return c.json({ error: 'Source product is required' }, 400)
  if (!Number.isFinite(quantity) || quantity <= 0) return c.json({ error: 'Quantity must be a positive number' }, 400)
  if (!destinationProductId) {
    // The Docker backend can create a brand-new destination product inline
    // (e.g. an auto-created "Damaged stock" line item). That path isn't
    // ported -- create the destination product first, then move stock to it.
    return c.json({ error: 'A destination product is required. Create it first, then move stock to it.' }, 400)
  }

  const db = getDb(c.env)
  const [source, destination] = await Promise.all([
    db.prepare('SELECT id, name FROM products WHERE id = @id').get<{ id: number; name: string }>({ id: sourceProductId }),
    db.prepare('SELECT id, name FROM products WHERE id = @id').get<{ id: number; name: string }>({ id: destinationProductId }),
  ])
  if (!source) return c.json({ error: 'Source product not found' }, 404)
  if (!destination) return c.json({ error: 'Destination product not found' }, 404)

  const branchId = requestedBranchId || (await defaultBranchId(c.env))
  if (!branchId) return c.json({ error: 'An active branch is required before stock can be moved' }, 400)
  const branch = await db.prepare('SELECT id, name FROM branches WHERE id = @id').get<{ id: number; name: string }>({ id: branchId })

  const available = await branchStockQty(c.env, sourceProductId, branchId)
  if (quantity > available) return c.json({ error: `Cannot move ${quantity} - only ${available} available in ${branch?.name || 'this branch'}` }, 400)

  await applyStockDelta(c.env, sourceProductId, branchId, -quantity)
  await applyStockDelta(c.env, destinationProductId, branchId, quantity)
  await db.batch([
    {
      sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_id, user_name, created_at)
            VALUES (@productId, @productName, @branchId, @branchName, 'move_out', @quantity, @reason, @userId, @userName, CURRENT_TIMESTAMP)`,
      params: { productId: sourceProductId, productName: source.name, branchId, branchName: branch?.name || null, quantity, reason: reason ? `Moved to ${destination.name} - ${reason}` : `Moved to ${destination.name}`, userId: user?.id ?? null, userName: user?.name ?? null },
    },
    {
      sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_id, user_name, created_at)
            VALUES (@productId, @productName, @branchId, @branchName, 'move_in', @quantity, @reason, @userId, @userName, CURRENT_TIMESTAMP)`,
      params: { productId: destinationProductId, productName: destination.name, branchId, branchName: branch?.name || null, quantity, reason: reason ? `Moved from ${source.name} - ${reason}` : `Moved from ${source.name}`, userId: user?.id ?? null, userName: user?.name ?? null },
    },
  ])

  await audit(c.env, user?.id ?? null, user?.name ?? null, 'move', 'stock', sourceProductId, { toProductId: destinationProductId, quantity, branchId, reason })
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'move_row' }))
  c.executionCtx.waitUntil(bumpVersion(c.env.CACHE, 'products'))
  // See the matching note in /adjust above -- same missing-`success`-field bug.
  return c.json({ success: true, sourceProductId, destinationProductId, branchId, quantity })
})

// ---- RFID: functional stubs -- no reader hardware to talk to from a Worker ----

app.get('/rfid/status', (c) => c.json({ connected: false, status: 'unconfigured', readers: [] }))
app.get('/rfid/tags/search', (c) => c.json({ items: [], total: 0, page: 1, pageSize: 20 }))
app.post('/rfid/tags', (c) => c.json({ error: 'No RFID reader is connected to this Cloudflare Worker.' }, 501))
app.post('/rfid/sessions', (c) => c.json({ error: 'No RFID reader is connected to this Cloudflare Worker.' }, 501))
app.post('/rfid/sessions/:id/events', (c) => c.json({ error: 'No RFID reader is connected to this Cloudflare Worker.' }, 501))
app.get('/rfid/sessions/:id/review', (c) => c.json({ sessionId: c.req.param('id'), items: [], unknown: [], duplicates: [] }))
app.post('/rfid/sessions/:id/apply', (c) => c.json({ error: 'No RFID reader is connected to this Cloudflare Worker.' }, 501))

export default app
