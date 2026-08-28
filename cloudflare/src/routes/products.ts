import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { paginateProductFamilies } from '../lib/familyPagination'
import { cachedJsonResponse, getVersion, bumpVersion } from '../lib/cache'
import { matchLibraryImagesStrict } from '../lib/importImageMatch'
import { requireAuth, type SessionUser } from '../lib/auth'
import { hasPermission, getPermissionTier, getActionTier, getMergedPermissions, isAdminControlUser } from '../lib/permissions'
import { normalizeCatalogText, hasSuspiciousCatalogText } from '../lib/catalogText'
import { getMediaType, buildUniqueStoredName, sanitizeOriginalFileName } from '../lib/fileAssets'
import { sanitizeMediaList } from '../lib/media'
import { buildInClause, chunkForBinding, selectInChunks } from '../lib/sqlBinding'
import { validateUploadedBuffer } from '../lib/uploadSecurity'
import { checkRateLimit, getClientIp } from '../lib/rateLimit'
import { audit } from '../lib/audit'
import { findDuplicateProductGroups } from '../lib/productIdentity'
import { attachBatchCounts } from '../lib/productBatches'
import { maybeQueueForReview } from '../lib/reviewGate'
import { broadcast } from '../durable-objects/broadcastHub'
import { createBulkDeleteJob, getBulkDeleteJob, reapStalledBulkDeleteJobs } from '../lib/bulkDeleteEngine'
import { ADMIN_MAX_IMAGES_PER_PRODUCT, MAX_IMAGES_PER_PRODUCT } from '../lib/importImageMatch'
import {
  buildFtsMatchExpression,
  buildHybridMatchClause,
  buildIssueStateClauses,
  buildPartialWordMatchClause,
  buildShortWordFallbackClause,
  buildTrigramMatchExpression,
  PRODUCT_SEARCH_COLUMNS,
  PRODUCTS_FTS_BM25_SQL,
  tokenizeSearchTermGroups,
} from '../lib/searchMatch'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
// The real backend requires auth on GET /api/products/search (this is
// internal admin/POS catalog search) -- a real, confirmed gap: an earlier
// version of this port left it fully public. GET /api/portal/catalog/
// products/search is the actually-public equivalent, in routes/portal.ts.
app.use('*', requireAuth)

// Fallback for GET /zero-quantity-candidates when no
// `product_zero_qty_delete_threshold_days` setting has ever been saved
// (fresh install, or an admin who's never touched this feature's config).
// 30 days mirrors the kind of "sold out a while ago, not just today"
// window this feature's spec (progress.md part 91) had in mind -- long
// enough that a normal restock-in-progress product doesn't show up as a
// deletion candidate the day after it happens to hit 0.
const DEFAULT_ZERO_QTY_THRESHOLD_DAYS = 30

// Was `raw.toLowerCase().split(/\s+/)` -- only ever split on whitespace, so
// it never folded accents/diacritics and never treated "+"/"&"/"-" etc. as
// word boundaries, meaning a typed "Cover+Concealer" (no spaces) and a
// stored "Cover + Concealer" (spaces around the plus) landed as different
// single "words" and never matched each other. Then flattened comma and
// space into the same boundary (tokenizeSearchWords alone), which silently
// broke the AND/OR toggle's real meaning -- see tokenizeSearchTermGroups's
// own comment in lib/searchMatch.ts. Now: comma splits into GROUPS, each
// group tokenized into words the same normalized way as before.
function splitSearchTermGroups(raw: string): string[][] {
  return tokenizeSearchTermGroups(raw, 6, 8)
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

// insertRow/updateRow/syncProductImageGallery/defaultBranchId/cleanPayload/
// clampNegativeStockQuantity/tableColumns/nowIso/PRODUCT_SKIP_KEYS moved to
// lib/productWrites.ts (part 152) so lib/reviewApply.ts's Products
// appliers can replay an approved create/update through the EXACT same
// write path this route uses directly, without lib/ importing from
// routes/ (a route file pulls in Hono/auth/rate-limiting that a pure lib
// module has no business depending on, and it broke the pure-source test
// harness that loads lib/ files in isolation). Re-exported here so no
// other call site in this file needed to change its import path -- see
// lib/productWrites.ts for the full comments this code used to carry.
import {
  PRODUCT_SKIP_KEYS, nowIso, tableColumns, clampNegativeStockQuantity,
  cleanPayload, insertRow, updateRow, syncProductImageGallery, defaultBranchId,
  seedBranchStockForNewProduct, seedInitialBatchForNewProduct, isImageOnlyWritePayload, restrictToImageOnlyFields,
  normalizeMultiValue, validateProductImageGallery, validatePreservedProductImageGallery, ProductImageLimitError,
} from '../lib/productWrites'
export {
  PRODUCT_SKIP_KEYS, nowIso, tableColumns, clampNegativeStockQuantity,
  cleanPayload, insertRow, updateRow, syncProductImageGallery, defaultBranchId,
  seedBranchStockForNewProduct, seedInitialBatchForNewProduct,
}

function imageLimitForUser(user: SessionUser): number {
  return isAdminControlUser(user) ? ADMIN_MAX_IMAGES_PER_PRODUCT : MAX_IMAGES_PER_PRODUCT
}

async function validateImageGalleryPayload(
  env: Env,
  user: SessionUser,
  body: Record<string, unknown>,
  productId?: string,
): Promise<ProductImageLimitError | null> {
  if (!('image_gallery' in body)) return null
  try {
    body.image_gallery = validateProductImageGallery(body.image_gallery, imageLimitForUser(user))
    return null
  } catch (error) {
    if (error instanceof ProductImageLimitError) {
      // Existing admin galleries can be preserved/reordered/reduced by a
      // normal editor, but the editor cannot introduce a fourth/fifth path.
      if (productId && !isAdminControlUser(user)) {
        const rows = await getDb(env).prepare(`
          SELECT image_path FROM product_images
          WHERE product_id = @id
          ORDER BY sort_order ASC, id ASC
        `).all<{ image_path: string }>({ id: productId })
        const preserved = validatePreservedProductImageGallery(
          body.image_gallery,
          rows.map((row) => row.image_path),
          ADMIN_MAX_IMAGES_PER_PRODUCT,
        )
        if (preserved) {
          body.image_gallery = preserved
          return null
        }
      }
      return error
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// Surface-scoped product reads
// ---------------------------------------------------------------------------
// /search and /bootstrap are shared endpoints: the Products page, POS and
// Inventory all read products through them. That sharing is fine -- what was
// NOT fine was applying a PRODUCTS-PAGE display restriction
// (`products_image_only`, which exists so a photo-uploader sees pictures and
// not pricing) to every caller regardless of which page was asking. A cashier
// granted {pos, sales} plus `products_image_only` had every catalog row
// stripped to five fields, and POS came back empty. Reported as "for
// employees and other roles, i enter pos, and it says No Data Found", and
// correctly pushed back on as "these are two separate pages -- why is a
// Products image-upload permission affecting POS?".
//
// So the caller now says which SURFACE it is reading for, and each surface is
// gated by its own page permission:
//
//   pos       -> requires `pos`;        never field-restricted.
//   inventory -> requires `inventory`;  never field-restricted.
//   products  -> requires `products` OR `products_image_only`; field-restricted
//                only for the image-only case.
//
// Declaring a surface can never ESCALATE: a caller claiming `surface=pos`
// without the `pos` permission is refused outright rather than quietly
// downgraded, so this is a scoping mechanism, not a trust boundary hole.
// The default stays `products`, so any caller that predates this parameter
// behaves exactly as the Products page always did.
export type ProductReadSurface = 'products' | 'pos' | 'inventory'

export function parseProductReadSurface(raw: unknown): ProductReadSurface {
  const value = String(raw ?? '').trim().toLowerCase()
  if (value === 'pos') return 'pos'
  if (value === 'inventory') return 'inventory'
  return 'products'
}

/** Null when allowed; an error message when this user may not read that surface. */
export function productSurfaceDenialReason(user: SessionUser, surface: ProductReadSurface): string | null {
  if (surface === 'pos') {
    return hasPermission(user, 'pos') || hasPermission(user, 'sales')
      ? null
      : 'You do not have permission to use POS'
  }
  if (surface === 'inventory') {
    return getPermissionTier(user, 'inventory') !== 'none'
      ? null
      : 'You do not have permission to view Inventory'
  }
  return getPermissionTier(user, 'products') !== 'none' || hasPermission(user, 'products_image_only')
    ? null
    : 'You do not have permission to view Products'
}

// The image-only field restriction is a PRODUCTS-PAGE concern and applies on
// that surface only. Whether the user happens to hold `pos` or `inventory` is
// irrelevant here now -- those surfaces are simply never restricted, which is
// what makes the pages genuinely independent instead of relying on this
// predicate remembering to exclude every other page's permission.
function isImageOnlyRead(user: SessionUser, surface: ProductReadSurface): boolean {
  if (surface !== 'products') return false
  if (!hasPermission(user, 'products_image_only')) return false
  return getPermissionTier(user, 'products') === 'none'
}

function restrictListPayloadForImageOnly<T extends { items?: unknown }>(payload: T, user: SessionUser): T {
  if (!Array.isArray(payload?.items)) return payload
  const mergedPermissions = getMergedPermissions(user)
  return { ...payload, items: payload.items.map((item) => restrictToImageOnlyFields(item as Record<string, unknown>, mergedPermissions)) }
}

// Scoped by the SAME active filters as searchProductsPayload (branch,
// brand, category, supplier, stock state, group state, search text) --
// with `initial` itself forced to 'all' so the alphabet bar shows every
// letter that's reachable under the current filters, not just the one
// currently selected. Mirrors routes/inventory.ts's already-fixed
// getInventoryProductMetadata()/appendInventoryProductFilters() pattern.
//
// Before this fix, brand/category/unit/supplier lists and the alphabet
// bar's counts were computed globally across *every* active product,
// ignoring whatever branch/brand/stock/etc. filters the caller had
// applied. That let the alphabet bar (and brand/category dropdowns) show
// letters/values with nonzero counts that had zero actual matches once
// the real filtered query ran -- surfacing as "the letter bar shows data
// but the list below says No data found" in POS and Products.
// Real, confirmed bug (Part 90 "Brand filter option sometimes vanishes
// when picked"): this function used to build ONE filters object (`initial`
// excluded, every other active filter -- including brand/category/unit/
// supplier's OWN currently-selected value -- included) and reuse it for
// every dropdown's option query. That's correct cross-filtering for every
// OTHER facet (picking a brand should narrow which categories show up) but
// wrong for a facet's OWN option list: once "MAC" was picked as the brand
// filter, the brand-options query itself was also scoped to `brand = 'mac'`
// (buildSearchFilters has no way to know "skip this one field"), so the
// dropdown's own option list collapsed to just the one already-selected
// value -- every other brand appeared to "vanish" the moment you picked one.
// Confirmed against real SQLite in scripts/test-search-500-repro.cjs before
// this fix (3 brands seeded, `brand: 'MAC'` in the query -> dropdown query
// returned only `['MAC']`) and after (all 3 still returned).
//
// Fix: compute each facet's own WHERE/params with THAT field's own value
// excluded from the query passed to buildSearchFilters, while every other
// active filter (search term, stock state, the other three facets, branch,
// group, created-date) still narrows it -- standard faceted-search
// behavior. `initial` was already excluded this same way for every facet
// (so the A-Z bar doesn't collapse to one letter); this just extends the
// same "exclude only the field this query is FOR" rule to brand/category/
// unit/supplier instead of blanket-excluding none of them.
function buildFilterVariants(query: Record<string, string>) {
  const base = { ...query, initial: 'all' }
  return {
    brands: buildSearchFilters({ ...base, brand: '' }),
    categories: buildSearchFilters({ ...base, category: '' }),
    units: buildSearchFilters({ ...base, unit: '' }),
    suppliers: buildSearchFilters({ ...base, supplier: '' }),
    tags: buildSearchFilters({ ...base, tag_label: '' }),
    initials: buildSearchFilters(base),
  }
}

async function loadProductFilters(env: Env, query: Record<string, string> = {}) {
  const db = getDb(env)
  // Real, confirmed bug (live user report + screenshot): after clearing
  // the search box in POS, the A-Z initial bar stayed stuck showing only
  // the one letter that matched the just-cleared search term, instead of
  // resetting to every letter in the catalog. Root cause: `query` here is
  // whatever the caller's current product-list request was (including its
  // free-text search), and this metadata call is only re-run when a
  // *structural* filter (branch/brand/category/stock/etc.) changes -- not
  // on every search keystroke -- so whatever search text happened to be
  // active the last time this ran got permanently baked into the initial/
  // brand/category option lists until the next structural-filter change,
  // long after the search itself was cleared or edited.
  // Fix: this function answers "what filter OPTIONS exist", not "what
  // matches the current free-text search" -- those are a different
  // question (the actual product list query still applies the search
  // separately). Stripping the free-text term here keeps every filter
  // facet (brand/category/unit/supplier/initial) scoped to the real
  // structural filters only, same stable behavior Products.tsx's own
  // filter-meta cache already relies on, so it can never again go stale
  // relative to a search box the caller doesn't track in its refresh key.
  const { query: _searchTerm, q: _searchTermAlt, ...structuralQuery } = query
  const variants = buildFilterVariants(structuralQuery)
  const sql = (f: ReturnType<typeof buildSearchFilters>) => `WHERE ${f.where.join(' AND ')}`
  const joinSql = (f: ReturnType<typeof buildSearchFilters>) => f.joins.join('\n')

  // GROUP BY the case/whitespace-normalized value rather than plain DISTINCT
  // -- DISTINCT on trim(p.brand) still compares byte-for-byte, so imported
  // data with inconsistent casing (e.g. "Ariana" vs "ARIANA") produced two
  // dropdown rows that render identically but are different filter values
  // (reported as duplicate/near-duplicate options in the Brand filter).
  // MIN() over each normalized group picks one deterministic casing.
  const [brands, categories, units, suppliers, tags, initials] = await Promise.all([
    db.prepare(`SELECT MIN(trim(p.brand)) AS value FROM products p ${joinSql(variants.brands)} ${sql(variants.brands)} AND trim(COALESCE(p.brand, '')) <> '' GROUP BY lower(trim(p.brand)) ORDER BY lower(value) ASC LIMIT 500`).all<{ value: string }>(variants.brands.params),
    db.prepare(`SELECT MIN(trim(p.category)) AS value FROM products p ${joinSql(variants.categories)} ${sql(variants.categories)} AND trim(COALESCE(p.category, '')) <> '' GROUP BY lower(trim(p.category)) ORDER BY lower(value) ASC LIMIT 500`).all<{ value: string }>(variants.categories.params),
    db.prepare(`SELECT MIN(trim(p.unit)) AS value FROM products p ${joinSql(variants.units)} ${sql(variants.units)} AND trim(COALESCE(p.unit, '')) <> '' GROUP BY lower(trim(p.unit)) ORDER BY lower(value) ASC LIMIT 500`).all<{ value: string }>(variants.units.params),
    db.prepare(`SELECT MIN(trim(p.supplier)) AS value FROM products p ${joinSql(variants.suppliers)} ${sql(variants.suppliers)} AND trim(COALESCE(p.supplier, '')) <> '' GROUP BY lower(trim(p.supplier)) ORDER BY lower(value) ASC LIMIT 500`).all<{ value: string }>(variants.suppliers.params),
    db.prepare(`SELECT MIN(trim(p.tag_label)) AS value FROM products p ${joinSql(variants.tags)} ${sql(variants.tags)} AND trim(COALESCE(p.tag_label, '')) <> '' GROUP BY lower(trim(p.tag_label)) ORDER BY lower(value) ASC LIMIT 500`).all<{ value: string }>(variants.tags.params),
    db.prepare(`
      SELECT upper(substr(trim(p.name), 1, 1)) AS initial,
             COUNT(DISTINCT COALESCE(NULLIF(p.name_key, ''), CAST(p.id AS TEXT))) AS count
      FROM products p
      ${joinSql(variants.initials)}
      ${sql(variants.initials)}
        AND trim(COALESCE(p.name, '')) <> ''
      GROUP BY upper(substr(trim(p.name), 1, 1))
      ORDER BY initial ASC
    `).all<{ initial: string; count: number }>(variants.initials.params),
  ])

  const values = (rows: Array<{ value: string }> = []) => rows.map((row) => row.value).filter(Boolean)
  return {
    brands: values(brands),
    categories: values(categories),
    units: values(units),
    suppliers: values(suppliers),
    tags: values(tags),
    initials: (initials || []).map((row) => ({ initial: row.initial, value: row.initial, label: row.initial, count: row.count })),
  }
}

// Ported from backend/src/routes/products.ts's attachBranchStock. The
// cloudflare product list/search query never selected anything resembling
// this, so every product row was missing `branch_stock` entirely --
// Products.tsx's getProductBranchQuantity() reads `product.branch_stock`,
// found nothing, and the branch column/filter always showed empty/0
// regardless of real per-branch stock.
async function attachBranchStock(env: Env, products: Array<Record<string, unknown>>) {
  const ids = Array.from(new Set(products.map((p) => Number(p.id)).filter((id) => Number.isFinite(id) && id > 0)))
  if (!ids.length) return products
  const db = getDb(env)
  // One `IN (...)` over every product on the page is exactly what took
  // GET /api/products down in production ("too many SQL variables at
  // offset 415" -- the 101st placeholder of this very query). A page is
  // 20 FAMILIES, and a family expands to every same-name row, so the id
  // count is unbounded no matter how small pageSize is. See sqlBinding.ts.
  //
  // Branch rows are read once and joined in JS rather than re-selected per
  // chunk: `branches` is a handful of rows and repeating them per chunk
  // would multiply reads for no gain.
  const branches = await db.prepare(`
    SELECT id, name FROM branches WHERE is_active = 1 ORDER BY is_default DESC, id ASC
  `).all<{ id: number; name: string }>()
  const stockRows = await selectInChunks(ids, 0, (chunk) => {
    const { sql, params } = buildInClause('id', chunk)
    return db.prepare(`
      SELECT product_id, branch_id, COALESCE(quantity, 0) AS quantity
      FROM branch_stock
      WHERE product_id IN (${sql})
    `).all<{ product_id: number; branch_id: number; quantity: number }>(params)
  })

  const quantityByProductBranch = new Map<string, number>()
  for (const row of stockRows) {
    quantityByProductBranch.set(`${row.product_id}:${row.branch_id}`, row.quantity)
  }
  // Every active branch is listed for every product, present in
  // branch_stock or not -- that is what the previous LEFT JOIN produced,
  // and Products.tsx's branch column reads a missing branch as "no data"
  // rather than "zero".
  return products.map((product) => {
    const productId = Number(product.id)
    return {
      ...product,
      branch_stock: branches.map((branch) => ({
        branch_id: branch.id,
        branch_name: branch.name,
        quantity: quantityByProductBranch.get(`${productId}:${branch.id}`) || 0,
      })),
    }
  })
}

// Same read-side gap as attachBranchStock originally had, but for images:
// syncProductImageGallery() (below) already writes every gallery image to
// `product_images`, and catalog.ts's public-portal route already reads
// galleries back from that same table -- but this internal search/list
// endpoint (what Products.tsx's edit form actually loads from) never did,
// so it only ever returned the single `image_path` column. Net effect:
// re-opening the edit form for a product with a saved 3-image gallery
// showed just 1 image, and saving from that state (syncProductImageGallery
// replaces the gallery wholesale) silently deleted the other 2 from the
// database -- the "gallery doesn't persist past the first image" symptom
// was actually this missing read, undoing the write-side fix on every
// re-edit. Mirrors catalog.ts's exact fallback rule (gallery from
// product_images, else the single image_path) so both read paths agree.
async function attachImageGallery(env: Env, products: Array<Record<string, unknown>>) {
  const ids = Array.from(new Set(products.map((p) => Number(p.id)).filter((id) => Number.isFinite(id) && id > 0)))
  if (!ids.length) return products
  const db = getDb(env)
  // Same unbounded-`IN` hazard as attachBranchStock above; sort order is
  // per product, so chunking cannot reorder a product's own images.
  const rows = await selectInChunks(ids, 0, (chunk) => {
    const { sql, params } = buildInClause('id', chunk)
    return db.prepare(`
      SELECT product_id, image_path
      FROM product_images
      WHERE product_id IN (${sql})
      ORDER BY sort_order ASC, id ASC
    `).all<{ product_id: number; image_path: string }>(params)
  })

  const byProduct = new Map<number, string[]>()
  for (const row of rows) {
    if (!byProduct.has(row.product_id)) byProduct.set(row.product_id, [])
    byProduct.get(row.product_id)!.push(row.image_path)
  }
  return products.map((product) => {
    // Admins may deliberately store images 4-5. Reads return the complete
    // stored gallery to every viewer; only mutation authority differs.
    const gallery = sanitizeMediaList(byProduct.get(Number(product.id)) || []).slice(0, ADMIN_MAX_IMAGES_PER_PRODUCT)
    const fallbackImage = sanitizeMediaList([product.image_path as string])[0] || null
    if (!gallery.length && fallbackImage) gallery.push(fallbackImage)
    return {
      ...product,
      image_gallery: gallery,
    }
  })
}

type ProductSearchOptions = { useSearchIndex?: boolean }

// The other half of the "group search hides sibling child rows" fix (see
// familyMemberBaseWhereSql in familyPagination.ts for the parent_id-linked
// half). Most groups in this catalog are NOT parent_id-linked -- they're
// plain same-name duplicate rows (same item, different branch/price/
// barcode), which the client groups by normalized name, not by any DB-side
// relationship (see productGrouping.ts's resolveGroupKey/
// normalizeProductGroupName -- trim + collapse whitespace + lowercase).
// familyMemberBaseWhereSql can't reach these at all: SQL-side "family"
// there is defined by parent_id chains only, so a plain duplicate-name row
// has no parent_id and is already its own one-row "family" as far as that
// helper is concerned -- nothing to expand.
// So: once a search has picked a page of results, look at which OTHER
// active products anywhere in the catalog share a search-result row's
// normalized name (and aren't already in the page), and pull those in too.
// One extra indexed-ish query (name compare is case/whitespace-normalized,
// so it can't use a plain index, but the IN-list is bounded to this page's
// distinct names, not the whole catalog) rather than N queries.
async function expandSearchResultsToNameSiblings(env: Env, items: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  if (!items.length) return items
  const seenIds = new Set(items.map((p) => Number(p.id)).filter((id) => Number.isFinite(id) && id > 0))
  // Matches normalizeProductGroupName's own normalization exactly (trim +
  // collapse internal whitespace + lowercase) so this can't miss a sibling
  // the client would otherwise have grouped it with, or pull in one it
  // wouldn't have.
  const namesByKey = new Map<string, string>()
  for (const item of items) {
    const rawName = String(item.name || '').trim().replace(/\s+/g, ' ')
    if (!rawName) continue
    const key = rawName.toLowerCase()
    if (!namesByKey.has(key)) namesByKey.set(key, rawName)
  }
  if (!namesByKey.size) return items

  const db = getDb(env)
  // pageSize is clamped to 100, and 100 names is already D1's entire
  // bound-parameter budget -- one more and this is the same crash
  // attachBranchStock hit. Chunked rather than capped: dropping names
  // would silently hide the siblings this whole function exists to find.
  const siblingRows = await selectInChunks([...namesByKey.keys()], 0, (chunk) => {
    const { sql, params } = buildInClause('name', chunk)
    return db.prepare(`
      SELECT p.id, p.name, p.sku, p.barcode, p.category, p.brand, p.unit, p.description,
             p.selling_price_usd, p.selling_price_khr,
             p.special_price_usd, p.special_price_khr,
             p.cost_price_usd, p.cost_price_khr, p.stock_quantity, p.low_stock_threshold,
             p.out_of_stock_threshold, p.image_path, p.is_active, p.supplier, p.parent_id,
             p.is_group, p.discount_enabled, p.discount_type, p.discount_percent,
             p.discount_amount_usd, p.discount_amount_khr, p.discount_label,
             p.discount_badge_color, p.discount_starts_at, p.discount_ends_at,
             p.expiry_date, p.expiry_alert_days, p.created_at, p.updated_at
      FROM products p
      WHERE p.is_active = 1
        AND lower(trim(p.name)) IN (${sql})
    `).all<Record<string, unknown>>(params)
  })

  const extras = (Array.isArray(siblingRows) ? siblingRows : []).filter((row) => {
    const id = Number(row.id)
    if (!Number.isFinite(id) || id <= 0 || seenIds.has(id)) return false
    seenIds.add(id)
    return true
  })
  if (!extras.length) return items
  return [...items, ...extras]
}

async function searchProductsPayload(env: Env, query: Record<string, string>, options: ProductSearchOptions = {}) {
  const page = clampInt(query.page, 1, 1, 100000)
  const pageSize = clampInt(query.pageSize, 20, 1, 100)
  const sort = String(query.sort || 'name_asc').toLowerCase()
  // Family-level order (ranks grouped products as one unit -- see
  // paginateProductFamilies) mirrors the row-level order below, just
  // computed off the per-family aggregates instead of a single row's
  // columns: created_* sorts by the family's most-recently-created row,
  // name_* sorts by the family's (root product's) name.
  const familyOrderSql =
    sort === 'created_desc' ? 'latest_created_at DESC, family_name ASC'
    : sort === 'created_asc' ? 'latest_created_at ASC, family_name ASC'
    : sort === 'name_desc' ? 'family_name DESC'
    : 'family_name ASC'
  const intraFamilyOrderSql =
    sort === 'created_desc' ? 'created_at DESC, id DESC'
    : sort === 'created_asc' ? 'created_at ASC, id ASC'
    : sort === 'name_desc' ? 'lower(name) DESC, id ASC'
    : 'lower(name) ASC, id ASC'

  const db = getDb(env)
  const filters = buildSearchFilters(query, options)
  const { where, joins, params, matchRankSql, hasSearchTerm } = filters
  const initial = String(query.initial || '').trim()
  const initialClause = initial && initial.toLowerCase() !== 'all'
    ? "upper(substr(trim(COALESCE(p.name, '')), 1, 1)) = @initial"
    : undefined
  if (initialClause) {
    params.initial = initial.toUpperCase()
    where.push(initialClause)
  }
  const joinSql = joins.join('\n')
  const whereSql = `WHERE ${where.join(' AND ')}`

  // A search term in play takes over the primary sort order (relevance,
  // weighted across the name/sku/barcode columns actually in scope --
  // see buildSearchFilters' matchRankSql and PRODUCT_SEARCH_COLUMNS'S own
  // comment in lib/searchMatch.ts) with the caller's chosen sort demoted to
  // a tiebreaker; with no search term there's no relevance to rank by, so
  // the plain name/created-date order applies as before.
  const effectiveFamilyOrderSql = matchRankSql ? `match_rank ASC, ${familyOrderSql}` : familyOrderSql

  const selectColumns = `p.id, p.name, p.sku, p.barcode, p.category, p.brand, p.unit, p.description,
           p.selling_price_usd, p.selling_price_khr,
           p.special_price_usd, p.special_price_khr,
           p.cost_price_usd, p.cost_price_khr, p.stock_quantity, p.low_stock_threshold,
           p.out_of_stock_threshold, p.image_path, p.is_active, p.supplier, p.parent_id,
           p.is_group, p.discount_enabled, p.discount_type, p.discount_percent,
           p.discount_amount_usd, p.discount_amount_khr, p.discount_label,
           p.discount_badge_color, p.discount_starts_at, p.discount_ends_at,
           p.expiry_date, p.expiry_alert_days, p.created_at, p.updated_at`

  const { items, total, totalPages } = await paginateProductFamilies<Record<string, unknown>>({
    db,
    selectColumns,
    joinSql,
    whereSql,
    params,
    page,
    pageSize,
    familyOrderSql: effectiveFamilyOrderSql,
    intraFamilyOrderSql,
    matchRankSql,
    // Only opted in when a search term is actually in play (see
    // familyMemberBaseWhereSql's own comment in familyPagination.ts) --
    // this is specifically the "search matched one variant's barcode,
    // its sibling variants vanished from the response" bug. Plain
    // browsing (category/brand/branch/stock filters, no typed search)
    // keeps the prior per-row-filtered behavior; nothing reported there.
    familyMemberBaseWhereSql: hasSearchTerm ? 'p.is_active = 1' : undefined,
  })

  // Name-duplicate half of the same fix (see expandSearchResultsToNameSiblings's
  // own comment) -- only when a search term is active, same gating as the
  // parent_id half above. Deliberately runs BEFORE attachBranchStock/
  // attachImageGallery so the newly-pulled-in sibling rows get real
  // branch_stock/image_gallery data too, not left without it.
  const expandedItems = hasSearchTerm ? await expandSearchResultsToNameSiblings(env, items as Array<Record<string, unknown>>) : items

  const itemsWithBranchStock = await attachBranchStock(env, expandedItems as Array<Record<string, unknown>>)
  const itemsWithGallery = await attachImageGallery(env, itemsWithBranchStock)
  // Scalar batch count per row (same shared helper Inventory uses), so the
  // Products page shows "N batches" instead of 0 without shipping every
  // product's full batch array. See lib/productBatches.ts's attachBatchCounts.
  await attachBatchCounts(getDb(env), itemsWithGallery)

  return {
    items: itemsWithGallery,
    total,
    page,
    pageSize,
    totalPages,
  }
}

// Builds the same WHERE/params shape as backend/src/routes/products.ts's
// appendProductSearchFilters -- identical SQL, just @param -> our D1 adapter
// (which itself translates @param to positional ? before binding).
//
// branchId/stockState/groupState were previously accepted from the client
// (Products.tsx sends all three: branchId when a branch is selected,
// stockState from the Low/Out/In-stock filter, and groupState from the
// Grouped/Standalone filter) but silently dropped here, so none of those
// controls did anything server-side. Mirrors inventory.ts's
// appendInventoryProductFilters, which already had this fixed for the
// Inventory page.
//
// Products.tsx used to also force stockState to 'positive' (in-stock +
// low-stock, excluding out-of-stock) the moment a branch was picked, even
// with no stock filter actively selected -- fixed client-side; an empty
// stockState here means no stock-based filtering at all, same as with no
// branch selected.
function buildSearchFilters(query: Record<string, string>, options: ProductSearchOptions = {}) {
  const where: string[] = ['p.is_active = 1']
  const params: Record<string, unknown> = {}
  const joins: string[] = []

  const branchId = Number.parseInt(String(query.branchId || query.branch_id || ''), 10)
  if (Number.isFinite(branchId) && branchId > 0) {
    params.branchId = branchId
    joins.push('LEFT JOIN branch_stock selected_bs ON selected_bs.product_id = p.id AND selected_bs.branch_id = @branchId')
  }
  const stockExpr = params.branchId ? 'COALESCE(selected_bs.quantity, 0)' : 'COALESCE(p.stock_quantity, 0)'

  const searchTermGroups = splitSearchTermGroups(query.query || query.q || '')
  // Relevance rank for ordering (not filtering) results once there's an
  // actual search term -- FTS5's own bm25() relevance function
  // (PRODUCTS_FTS_BM25_SQL, lib/searchMatch.ts) weighted so a
  // barcode/sku match still ranks above a name match, which ranks above
  // brand/category, which ranks above supplier/description/unit. No rank
  // is computed for titleOnly searches (name is the only column the
  // MATCH itself is scoped to, so every match is already the same "kind").
  let matchRankSql: string | undefined
  let searchWhereClause: string | undefined
  const searchMode = String(query.searchMode || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'
  const titleOnly = ['name', 'title'].includes(String(query.searchFields || query.search_fields || '').toLowerCase())
  if (searchTermGroups.length && options.useSearchIndex === false) {
    // Compatibility fallback for a deployment whose D1 database has not
    // yet received one of the FTS migrations. It is deliberately narrower
    // and slower than the normal indexed path, but a catalog search must
    // still work rather than return a 500 while migration catch-up runs.
    const fallbackColumns = titleOnly
      ? ['p.name']
      : ['p.name', 'p.sku', 'p.barcode']
    const allWords = searchTermGroups.flat()
    const wordClauses = allWords.map((word, index) => {
      const key = `fallbackSearch${index}`
      params[key] = `%${String(word).toLowerCase()}%`
      return `(${fallbackColumns.map((column) => `lower(COALESCE(${column}, '')) LIKE @${key}`).join(' OR ')})`
    })
    if (wordClauses.length) where.push(`(${wordClauses.join(searchMode === 'OR' ? ' OR ' : ' AND ')})`)
  } else if (searchTermGroups.length) {
    // See lib/searchMatch.ts's buildFtsMatchExpression for how comma
    // groups/AND-OR/alias-candidates map onto FTS5 MATCH syntax, and
    // migrations/0018_products_fts.sql for why this replaced a
    // REPLACE()-chain-wrapped LIKE scan across 8 columns per row.
    // Scoped to PRODUCT_SEARCH_COLUMNS (name/sku/barcode only) -- see that
    // constant's own comment in lib/searchMatch.ts for the full reasoning
    // (brand/category/unit/supplier/description are all noise for a typed
    // product search box and are already reachable via their own filter
    // dropdowns or, for unit, its own exact-match review filter).
    const ftsMatch = buildFtsMatchExpression(searchTermGroups, searchMode, titleOnly ? 'name' : PRODUCT_SEARCH_COLUMNS)
    // buildTrigramMatchExpression/products_fts_code (migrations/
    // 0019_products_fts_code.sql) covers the real gap ftsMatch alone
    // has: unicode61 prefix matching can't find "012" inside a barcode
    // like "6923644012345" (one unbroken token, "012" isn't its prefix).
    // Computed once and reused below for BOTH the barcode/sku table and
    // products_fts_name_trigram (migrations/0021_products_fts_name_
    // trigram.sql) -- the expression itself only depends on the typed
    // words/mode, not which table it's matched against, so one call
    // covers both. No longer gated on titleOnly: it used to be, back
    // when this only fed products_fts_code (barcode/sku substring
    // matching has no meaning for a name-only search) -- but it's also
    // the source for the name-trigram clause below, which titleOnly
    // *does* need.
    const trigramMatch = buildTrigramMatchExpression(searchTermGroups, searchMode)
    // Both MATCH conditions are expressed as `p.id IN (SELECT rowid FROM
    // <fts table> WHERE <fts table> MATCH ...)` rather than a JOIN +
    // direct `<fts table> MATCH ...` WHERE clause -- confirmed against
    // real FTS5 (better-sqlite3) that combining a JOINed-table's direct
    // MATCH with an OR throws "unable to use function MATCH in the
    // requested context" the moment a second condition needs an OR
    // instead of an AND, even when that second condition doesn't touch
    // the same table at all. The IN-subquery form doesn't have that
    // restriction and combines cleanly via OR either way, so it's used
    // for both parts even when only one of the two is actually present
    // (keeps the two search paths structurally identical instead of
    // branching between a JOIN form and a subquery form).
    const matchClauses: string[] = []
    if (ftsMatch) {
      params.ftsQuery = ftsMatch
      matchClauses.push('p.id IN (SELECT rowid FROM products_fts WHERE products_fts MATCH @ftsQuery)')
    }
    if (trigramMatch && !titleOnly) {
      params.codeQuery = trigramMatch
      matchClauses.push('p.id IN (SELECT rowid FROM products_fts_code WHERE products_fts_code MATCH @codeQuery)')
    }
    // Real, reported gap this closes: unicode61 prefix matching (ftsMatch
    // above) can only find a NAME word from its start -- a product like
    // "Abercrombie Fierce Cologne 100ml" or "Anastasia Foundation 110C"
    // stores "100ml"/"110C" as one unbroken token (no space between the
    // number and the unit/shade-code letters), so typing just the unit
    // ("ml") or shade code fragment never matched, the exact same class of
    // bug 0019_products_fts_code.sql already fixed for barcode/sku.
    // Confirmed at real catalog scale (this project's own real product
    // catalog, ~107,000 realistic test queries via a real better-sqlite3
    // harness) before writing this: fused number+unit/shade-code tokens
    // (10ml, 100ml, 454g, 110C, ...) were by far the single largest cause
    // of "search hides a product that's clearly there".
    // products_fts_name_trigram (migrations/0021_products_fts_name_
    // trigram.sql) mirrors products_fts_code's own trigram-substring
    // approach, scoped to just `name`. Applies in titleOnly mode too
    // (unlike the barcode/sku trigram clause above) -- titleOnly means
    // "search name only", and this table only ever covers name, so it's
    // exactly the fallback that mode needs.
    if (trigramMatch) {
      params.nameCodeQuery = trigramMatch
      matchClauses.push('p.id IN (SELECT rowid FROM products_fts_name_trigram WHERE products_fts_name_trigram MATCH @nameCodeQuery)')
    }
    // Closes the mixed-group gap ftsMatch/trigramMatch can't express on
    // their own -- see buildHybridMatchClause's own comment in
    // lib/searchMatch.ts for why (e.g. one comma-group containing both
    // "mac" and "012", where each word only resolves via a different one
    // of the two tables). No-op (returns undefined) for the common
    // single-word-per-group case, which stays on the cheaper paths above.
    const hybridMatch = titleOnly ? undefined : buildHybridMatchClause(searchTermGroups, searchMode, 'hyb', PRODUCT_SEARCH_COLUMNS)
    if (hybridMatch) {
      Object.assign(params, hybridMatch.params)
      matchClauses.push(hybridMatch.sql)
    }
    // Real gap the two trigram tables above can't fix on their own: FTS5's
    // trigram tokenizer generates no trigrams for a query under 3
    // characters, so a search for just "ml"/"g"/a single shade-code letter
    // (extremely common once separated from this catalog's fused
    // number+unit naming, e.g. "Anastasia Foundation 110C") is
    // unconditionally zero rows via products_fts_code/products_fts_name_
    // trigram no matter how the name is stored. Confirmed by far the
    // largest remaining real-catalog search-accuracy gap (see
    // buildShortWordFallbackClause's own comment in lib/searchMatch.ts) --
    // fixed with a plain LIKE fallback, scoped to name+unit only (not
    // sku/barcode/brand/category/supplier -- a bare 1-2 character LIKE
    // against those would match far too broadly to be a useful "hides a
    // real product" fix and would just add noise), gated so it only ever
    // runs when the query actually contains a sub-3-character word.
    //
    // Real, confirmed gap left behind by migration 0037_product_search_
    // compact_columns.sql: that migration fixed buildCompactBrandMatchClause's
    // own raw-p.brand REPLACE-chain (the "ana" incident its own comment
    // documents), but this call site was still passing the RAW `p.name`/
    // `p.unit` columns with alreadyNormalizedCols left at its default
    // (false) -- so any query containing a sub-3-character word (the exact
    // case this fallback exists for: "an", "a", "ml", a single shade-code
    // letter) still ran normalizedHaystackSql's full ~78-level nested
    // REPLACE() chain per column, per word, and still could exceed D1's
    // depth-100 limit. Reproduced against this migration's own name_
    // normalized/unit_normalized columns (added specifically so callers
    // like this one could skip the REPLACE chain entirely) -- switching to
    // those precomputed columns with alreadyNormalizedCols=true removes the
    // nesting here exactly the way it already does for brand.
    // Scoped to name_normalized only now (unit dropped along with unit
    // leaving PRODUCT_SEARCH_COLUMNS -- see that constant's own comment):
    // unit is no longer a free-text search dimension, it has its own
    // exact-match review filter instead.
    const shortWordMatch = buildShortWordFallbackClause(searchTermGroups, searchMode, ['p.name_normalized'], params, 'shortw', true)
    if (shortWordMatch) matchClauses.push(shortWordMatch)
    // Compact-brand substring fallback intentionally NOT called here
    // anymore -- brand is no longer a free-text search dimension (see
    // PRODUCT_SEARCH_COLUMNS's own comment in lib/searchMatch.ts): product
    // names already carry the brand in this catalog, and brandFilter
    // already covers the exact-brand-lookup case. buildCompactBrandMatchClause
    // itself is untouched (still exported, still covers the portal's own
    // needs -- actually also removed there, see portal.ts) in case a future
    // dedicated brand-search surface needs it again.
    // Partial multi-word fallback -- only ever engages for a genuinely
    // long typed query (4+ words in one comma-group), see
    // buildPartialWordMatchClause's own comment for why that keeps the
    // common short search cheap. Scoped to name only, same reasoning as
    // shortWordMatch above (a loose multi-word LIKE against brand/sku/
    // category would add noise, not signal, for this specific "long
    // product name" case).
    // Same depth-100 fix as shortWordMatch above -- name_normalized instead
    // of raw p.name, alreadyNormalizedCols=true so this skips the REPLACE
    // chain too (this fallback only engages for 4+-word groups, but a long
    // typed query is exactly the case most likely to already be near the
    // depth ceiling once combined with everything else in the WHERE).
    const partialMatch = buildPartialWordMatchClause(searchTermGroups, searchMode, ['p.name_normalized'], params, 'partialw', 4, true)
    if (partialMatch) matchClauses.push(partialMatch)
    if (matchClauses.length) {
      searchWhereClause = matchClauses.length > 1 ? `(${matchClauses.join(' OR ')})` : matchClauses[0]
      // bm25() must be evaluated inside a query that itself carries the
      // matching table's own MATCH constraint directly -- confirmed it
      // can't be called against a table that's only conditionally
      // matched via an outer OR. A correlated scalar subquery (its own
      // FROM + MATCH, just correlated on rowid = p.id) satisfies that
      // requirement while still being usable as a plain SELECT-list
      // expression. Only ftsMatch contributes a relevance score --
      // products_fts_code has no bm25 weighting of its own (trigram
      // relevance isn't meaningful the same way word-match relevance
      // is); a product that matched only via the barcode/sku fallback
      // still ranks (COALESCEs to 0, ties with "no search" rank) rather
      // than being excluded from ordering entirely.
      if (!titleOnly && ftsMatch) {
        matchRankSql = `COALESCE((SELECT ${PRODUCTS_FTS_BM25_SQL} FROM products_fts WHERE products_fts.rowid = p.id AND products_fts MATCH @ftsQuery), 0)`
      }
    }
  }

  // brand/category can now carry more than one value per product (see
  // migrations/0033_product_multi_category_brand.sql) -- a filter for
  // "Skincare" must also surface a product whose PRIMARY category is
  // something else but that's also tagged Skincare as a secondary value.
  // Matches against a `||`-delimited membership check on the new
  // categories/brands column (falling back to the single-value column
  // when categories/brands hasn't been populated yet -- covers any row
  // written before the multi-value columns existed or by a path that
  // doesn't call normalizeMultiValue), in addition to the existing exact
  // match on the primary column so nothing that worked before regresses.
  // % and _ are escaped since this is now a LIKE, not a plain `=`.
  const MULTI_VALUE_COLUMNS: Record<string, string> = { brand: 'brands', category: 'categories' }
  const escapeLike = (value: string) => value.replace(/[%_]/g, (m) => `\\${m}`)
  // tag_label (P4): the operator's own per-product chip -- filterable the
  // same exact-match way as the other facets.
  for (const field of ['brand', 'category', 'unit', 'supplier', 'tag_label']) {
    const values = String(query[field] || '')
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v && v.toLowerCase() !== 'all')
    const multiCol = MULTI_VALUE_COLUMNS[field]
    const matchOneSql = (key: string) => multiCol
      ? `(lower(trim(COALESCE(p.${field}, ''))) = @${key} OR ('||' || lower(COALESCE(p.${multiCol}, p.${field}, '')) || '||') LIKE '%||' || @${key}esc || '||%' ESCAPE '\\')`
      : `lower(trim(COALESCE(p.${field}, ''))) = @${key}`
    if (values.length === 1) {
      params[field] = values[0].toLowerCase()
      if (multiCol) params[`${field}esc`] = escapeLike(values[0].toLowerCase())
      where.push(matchOneSql(field))
    } else if (values.length > 1) {
      const clauses = values.map((value, index) => {
        const key = `${field}${index}`
        params[key] = value.toLowerCase()
        if (multiCol) params[`${key}esc`] = escapeLike(value.toLowerCase())
        return matchOneSql(key)
      })
      where.push(`(${clauses.join(' OR ')})`)
    }
  }

  const stockState = String(query.stockState || query.stock_state || '').toLowerCase()
  if (stockState === 'low') where.push(`${stockExpr} > COALESCE(p.out_of_stock_threshold, 0) AND ${stockExpr} <= COALESCE(p.low_stock_threshold, 10)`)
  if (stockState === 'out') where.push(`${stockExpr} <= COALESCE(p.out_of_stock_threshold, 0)`)
  if (stockState === 'in_stock' || stockState === 'positive') where.push(`${stockExpr} > COALESCE(p.out_of_stock_threshold, 0)`)
  // 'healthy' is a stricter subset of 'in_stock'/'positive' -- above the
  // low stock threshold specifically, not just above zero/out threshold.
  // Lets the stock-status filter isolate the same "healthy" bucket the
  // stats tiles already report separately from low/out.
  if (stockState === 'healthy') where.push(`${stockExpr} > COALESCE(p.low_stock_threshold, 10)`)

  // "Issues" quick filter -- see buildIssueStateClauses' own comment in
  // lib/searchMatch.ts for the exact scoped set and why each candidate
  // that ISN'T here (duplicate SKU/barcode, batch expiry, negative stock)
  // was left out rather than guessed at. Multi-value, OR'd -- a product
  // matching ANY requested issue is surfaced.
  const issueState = String(query.issueState || query.issue_state || '')
  const issueClause = buildIssueStateClauses(issueState, stockExpr)
  if (issueClause) where.push(issueClause)

  // "Grouped" here has to match how the frontend actually decides a product
  // is part of a group (see productGrouping.ts's resolveGroupKey): an
  // explicit is_group/parent_id link, OR simply sharing its (trimmed,
  // case-insensitive) name with another active product -- most real groups
  // in this catalog are plain duplicate-name rows (same item, different
  // branch/price/barcode) with no is_group/parent_id set at all.
  //
  // The name-duplicate half of that used to be a correlated EXISTS re-scan
  // of the whole products table for every row (O(n^2) over the catalog --
  // see migration 0010_product_name_grouping.sql for the full incident).
  // Migration 0010 made that a persisted, trigger-maintained fact on the
  // row itself (products.is_grouped_cached, kept in sync on insert/rename/
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
    if (groupState === 'variant') where.push('COALESCE(p.parent_id, 0) > 0')
    else if (groupState === 'standalone') where.push(`NOT ${groupedExpr}`)
    else where.push(groupedExpr) // group / groups / grouped / parent
  }

  // "Created" filter (Products.tsx's Created filter section) -- scopes to
  // products with at least one active batch received in the given range,
  // via product_batches.received_at (see migration 0001_init.sql). Dates
  // come from <input type="date"> (YYYY-MM-DD), so the upper bound is
  // widened to end-of-day so a same-day batch (which carries a full
  // timestamp) isn't excluded by a plain string-vs-date-only compare.
  // variant_product_id = p.id covers both flat and grouped products --
  // every row in `products` (grouped or not) is itself a "variant" that
  // batches attach to directly, see lib/productBatches.ts.
  const batchDateFrom = String(query.batchDateFrom || query.batch_date_from || '').trim()
  const batchDateTo = String(query.batchDateTo || query.batch_date_to || '').trim()
  if (batchDateFrom || batchDateTo) {
    const batchConditions = ['pb.variant_product_id = p.id', 'pb.is_active = 1']
    if (batchDateFrom) {
      params.batchDateFrom = batchDateFrom
      batchConditions.push('pb.received_at >= @batchDateFrom')
    }
    if (batchDateTo) {
      params.batchDateTo = `${batchDateTo} 23:59:59`
      batchConditions.push('pb.received_at <= @batchDateTo')
    }
    where.push(`EXISTS (SELECT 1 FROM product_batches pb WHERE ${batchConditions.join(' AND ')})`)
  }

  if (searchWhereClause) where.push(searchWhereClause)

  return { where, joins, params, stockExpr, matchRankSql, titleOnly, hasSearchTerm: searchTermGroups.length > 0 }
}

function isProductSearchIndexUnavailable(error: unknown): boolean {
  const message = String((error as Error)?.message || error || '').toLowerCase()
  return /no such table: products_fts|no such table: products_fts_code|no such table: products_fts_name_trigram|no such module: fts5|unable to use function match/.test(message)
}

async function searchProductsWithIndexFallback(env: Env, query: Record<string, string>) {
  try {
    return await searchProductsPayload(env, query)
  } catch (error) {
    if (!isProductSearchIndexUnavailable(error)) throw error
    return searchProductsPayload(env, query, { useSearchIndex: false })
  }
}

app.get('/search', async (c) => {
  const query = c.req.query()
  const user = c.get('user')
  const surface = parseProductReadSurface(query.surface)
  const denial = productSurfaceDenialReason(user, surface)
  if (denial) return c.json({ error: denial }, 403)

  const version = await getVersion(c.env.CACHE, 'products')
  const payload = await cachedJsonResponse(c.req.raw, c.executionCtx, version, 20, async () => {
    return searchProductsWithIndexFallback(c.env, query)
  })

  return c.json(isImageOnlyRead(user, surface) ? restrictListPayloadForImageOnly(payload as { items?: unknown }, user) : payload)
})

app.get('/', async (c) => {
  const user = c.get('user')
  const surface = parseProductReadSurface(c.req.query('surface'))
  const denial = productSurfaceDenialReason(user, surface)
  if (denial) return c.json({ error: denial }, 403)
  const payload = await searchProductsPayload(c.env, { page: '1', pageSize: '100' })
  const items = isImageOnlyRead(user, surface)
    ? payload.items.map((item) => restrictToImageOnlyFields(item as Record<string, unknown>, getMergedPermissions(user)))
    : payload.items
  return c.json(items)
})

app.get('/bootstrap', async (c) => {
  const query = c.req.query()
  const user = c.get('user')
  const surface = parseProductReadSurface(query.surface)
  const denial = productSurfaceDenialReason(user, surface)
  if (denial) return c.json({ error: denial }, 403)
  const db = getDb(c.env)
  // POS.tsx's loadCatalogData() reads this endpoint's response as
  // { items, ..., branches, filters, initials } and only treats branch
  // metadata as loaded once `branches` comes back as a real array (see
  // applyBranchMetadata / catalogMetadataLoadedRef there). This endpoint
  // never actually queried or included branches -- it's not a case of a
  // dropped column, `branches` simply never existed in this response --
  // so that condition could never be satisfied, POS.tsx kept re-entering
  // the bootstrap branch of loadCatalogData on every load instead of ever
  // falling through to the plain /search path, and the branch selector/
  // filter had nothing to populate from. Added the same active-branches
  // query routes/branches.ts's list endpoint uses.
  const [products, filters, branchRows] = await Promise.all([
    searchProductsWithIndexFallback(c.env, query),
    loadProductFilters(c.env, query),
    db.prepare('SELECT * FROM branches WHERE is_active = 1 ORDER BY is_default DESC, id ASC').all(),
  ])
  const restrictedProducts = isImageOnlyRead(user, surface) ? restrictListPayloadForImageOnly(products as { items?: unknown }, user) : products
  return c.json({ ...restrictedProducts, filters, initials: filters.initials, branches: branchRows })
})

app.get('/filters', async (c) => {
  return c.json(await loadProductFilters(c.env, c.req.query()))
})

// The ONE product identity rule's manual-path check: an ACTIVE product with
// the same normalized name AND the same non-empty barcode is the SAME
// product (the import merges such rows — resolveMergedPricing and friends),
// so manual create/edit must refuse to mint a twin of it. A same-name row
// with a DIFFERENT or empty barcode is a legitimate child row and is never
// returned here.
async function findSameNameBarcodeProduct(
  env: Env,
  name: string,
  barcode: unknown,
  excludeId: number | null,
): Promise<{ id: number; name: string; barcode: string } | null> {
  const trimmedBarcode = String(barcode ?? '').trim()
  if (!name.trim() || !trimmedBarcode) return null
  const row = await getDb(env).prepare(`
    SELECT id, name, barcode FROM products
    WHERE is_active = 1
      AND TRIM(COALESCE(barcode, '')) = @barcode
      AND LOWER(TRIM(name)) = LOWER(TRIM(@name))
      AND (@excludeId IS NULL OR id != @excludeId)
    LIMIT 1
  `).get<{ id: number; name: string; barcode: string }>({ name, barcode: trimmedBarcode, excludeId })
  return row || null
}

app.post('/', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'products', 'add') === 'none') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const name = String(body.name || '').trim()
  if (!name) return c.json({ error: 'Product name is required' }, 400)

  // The ONE product identity rule, enforced on the MANUAL path too (Aug 28:
  // "identity rules applied fully across all codepaths"): same name + same
  // barcode IS the same product — the import merges such rows, so manual
  // create must not mint a silent twin the import path would never allow.
  // Same name with a DIFFERENT (or no) barcode stays a legitimate child row
  // and passes through untouched. Checked before the review queue so a
  // reviewer is never asked to approve a duplicate either.
  const duplicate = await findSameNameBarcodeProduct(c.env, name, body.barcode, null)
  if (duplicate) {
    return c.json({
      error: `"${duplicate.name}" already exists with this exact barcode — same name + same barcode is the same product. Edit it or add stock to it instead of creating a duplicate.`,
      code: 'duplicate_product',
      duplicate,
    }, 409)
  }

  const imageLimitError = await validateImageGalleryPayload(c.env, user, body)
  if (imageLimitError) {
    return c.json({
      error: imageLimitError.message,
      code: imageLimitError.code,
      limit: imageLimitError.limit,
      supplied: imageLimitError.supplied,
    }, 409)
  }

  // Review Required tier (progress.md's "Permissions UI redesign" item):
  // unlike Fees (which only queues delete), Products queues every write --
  // add/edit/delete all go to review, nothing applies directly under this
  // tier. maybeQueueForReview() is a no-op (returns null) for a Full-tier
  // user, so the create path below still runs exactly as before for them.
  const pendingId = await maybeQueueForReview(c.env, user, 'products', {
    actionType: 'create',
    entityType: 'product',
    entityId: null,
    payload: body,
    summary: `Create product "${name}"`,
  })
  if (pendingId != null) {
    return c.json({ success: true, pending: true, pendingActionId: pendingId }, 202)
  }

  // Multi-category/multi-brand: keep the new `categories`/`brands`
  // columns in sync with whatever `category`/`brand` this request sent,
  // so a client that only ever sends the single-value fields (every
  // existing caller, until the multi-select UI ships) still populates the
  // multi-value list correctly for the filter-matching in
  // buildSearchFilters below -- see normalizeMultiValue's own comment.
  const normalizedCategories = normalizeMultiValue(body.category, body.categories)
  if (normalizedCategories !== undefined) body.categories = normalizedCategories
  const normalizedBrands = normalizeMultiValue(body.brand, body.brands)
  if (normalizedBrands !== undefined) body.brands = normalizedBrands

  const id = await insertRow(c.env, 'products', body, { name, is_active: body.is_active == null ? 1 : body.is_active })

  // `branch_id` isn't a products column (cleanPayload/insertRow drops it
  // silently), so without this the product would have no branch_stock row
  // at all -- invisible the moment POS or Inventory filters by a specific
  // branch. Use whatever branch the form sent; if none was sent (e.g. a
  // caller that predates the branch picker), fall back to the default
  // branch rather than leaving the product unassigned.
  const rawBranchId = Number.parseInt(String(body.branch_id ?? ''), 10)
  const branchId = Number.isFinite(rawBranchId) && rawBranchId > 0 ? rawBranchId : await defaultBranchId(c.env)
  // `|| 0` alone only catches NaN/0/''-falsy input -- a genuinely negative
  // number (e.g. -5) is truthy and would sail straight through. Same
  // "no negative stock" rule as cleanPayload's clampNegativeStockQuantity
  // above; this branch_stock insert is a separate write path that never
  // goes through cleanPayload at all. Seeds every active branch (not just
  // the chosen one) at 0, per the Aug 19 2026 report that new products only
  // showed up at the one branch they were created against -- see
  // seedBranchStockForNewProduct's own comment.
  const initialQty = Math.max(0, Number(body.stock_quantity ?? 0) || 0)
  await seedBranchStockForNewProduct(c.env, id as number, branchId, initialQty)
  await seedInitialBatchForNewProduct(c.env, id as number, branchId, initialQty)

  const item = await getDb(c.env).prepare('SELECT * FROM products WHERE id = @id').get({ id })
  if ('image_gallery' in body) {
    const gallery = await syncProductImageGallery(c.env, id as number, body.image_gallery, imageLimitForUser(user))
    if (item) (item as Record<string, unknown>).image_gallery = gallery
  }
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'create', id }))
  return c.json({ item, id, success: true })
})

app.put('/:id', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const id = c.req.param('id')
  // Image-only restricted role: normally blocked by the tier==='none' check
  // below (they have no real `products` grant), but let through here ONLY
  // when every key in the body is the one field this role is allowed to
  // write (isImageOnlyWritePayload) -- e.g. a request that also tried to
  // sneak in a cost_price_usd change alongside image_path still hits the
  // tier==='none' 403 below, same as any other field this role can't touch.
  // A product WRITE always comes from the Products page, so it is judged on
  // the products surface -- no other page's permission is consulted, which is
  // the same page-independence the read path now has.
  const isImageOnlyEdit = isImageOnlyRead(user, 'products') && isImageOnlyWritePayload(body)
  if (getActionTier(user, 'products', 'edit') === 'none' && !isImageOnlyEdit) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const imageLimitError = await validateImageGalleryPayload(c.env, user, body, id)
  if (imageLimitError) {
    return c.json({
      error: imageLimitError.message,
      code: imageLimitError.code,
      limit: imageLimitError.limit,
      supplied: imageLimitError.supplied,
    }, 409)
  }

  // Same identity rule as create: an EDIT must not rename/re-barcode a row
  // into an exact name+barcode twin of another product (excluding itself).
  // Only runs when the body actually carries a name or barcode change to
  // judge — an image-only or stock-only edit never reaches the query.
  if (body.name !== undefined || body.barcode !== undefined) {
    const current = await getDb(c.env).prepare('SELECT name, barcode FROM products WHERE id = @id').get<{ name: string; barcode: string | null }>({ id })
    const nextName = body.name !== undefined ? String(body.name || '').trim() : String(current?.name || '')
    const nextBarcode = body.barcode !== undefined ? body.barcode : current?.barcode
    const duplicate = await findSameNameBarcodeProduct(c.env, nextName, nextBarcode, Number(id))
    if (duplicate) {
      return c.json({
        error: `"${duplicate.name}" already exists with this exact barcode — same name + same barcode is the same product. Merge into it instead of creating a twin.`,
        code: 'duplicate_product',
        duplicate,
      }, 409)
    }
  }

  // Image-only edits are never queued for review -- 'review' tier and this
  // restricted role are mutually exclusive access shapes (see
  // isImageOnlyRead's comment), so maybeQueueForReview would just be a
  // guaranteed no-op for this branch; skipping it here avoids a pointless
  // call and keeps this branch's control flow easy to audit on its own.
  if (!isImageOnlyEdit) {
    const pendingId = await maybeQueueForReview(c.env, user, 'products', {
      actionType: 'update',
      entityType: 'product',
      entityId: Number(id),
      payload: body,
      summary: `Update product #${id}`,
    })
    if (pendingId != null) {
      return c.json({ success: true, pending: true, pendingActionId: pendingId }, 202)
    }
  }

  // Same multi-category/multi-brand sync as the create path above --
  // only touches these two columns when the request actually sent
  // category/brand/categories/brands, so an edit to an unrelated field
  // (e.g. just price) never rewrites a product's existing multi-value
  // list back down to a stale single value.
  if ('category' in body || 'categories' in body) {
    const normalizedCategories = normalizeMultiValue(body.category, body.categories)
    if (normalizedCategories !== undefined) body.categories = normalizedCategories
  }
  if ('brand' in body || 'brands' in body) {
    const normalizedBrands = normalizeMultiValue(body.brand, body.brands)
    if (normalizedBrands !== undefined) body.brands = normalizedBrands
  }

  const changes = await updateRow(c.env, 'products', id, body)
  // Real, latent gap this session found while wiring the image-only role's
  // gallery writes through this same handler: `image_gallery` is a virtual
  // key (see syncProductImageGallery's own comment) that updateRow's
  // cleanPayload silently drops -- it's not a real `products` column, so a
  // body containing ONLY `image_gallery` (no other real column changed)
  // left `changes` at 0 and this used to 404 BEFORE ever reaching the
  // syncProductImageGallery call below, even though the write was
  // perfectly valid. Never triggered by the full editor (ProductForm.tsx
  // always sends `image_path` alongside `image_gallery`, and `image_path`
  // IS a real column), but the image-only role's new gallery editor can
  // legitimately send a gallery-only body (e.g. reordering without the
  // first image changing) -- so this can no longer assume "no real column
  // changed" means "nothing to do". Fetch the row first and use its
  // existence (not `changes`) as the real 404 condition; `changes === 0`
  // on an existing row (nothing to update, or an image_gallery-only body)
  // is not an error.
  const item = await getDb(c.env).prepare('SELECT * FROM products WHERE id = @id').get({ id })
  if (!item) return c.json({ error: 'Product not found or unchanged' }, 404)
  if ('image_gallery' in body) {
    // validateImageGalleryPayload already proved this is either inside the
    // caller's limit or a preservation-only edit of an existing admin
    // gallery, so the writer may retain all five stored positions.
    const gallery = await syncProductImageGallery(c.env, id, body.image_gallery, ADMIN_MAX_IMAGES_PER_PRODUCT)
    ;(item as Record<string, unknown>).image_gallery = gallery
  }
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update', id }))
  return c.json({ item: isImageOnlyEdit ? restrictToImageOnlyFields(item as Record<string, unknown>, getMergedPermissions(user)) : item, success: true })
})

app.delete('/:id', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'products', 'delete') === 'none') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const id = c.req.param('id')

  // Delete now requires a reason, same mandatory-reason rule already
  // enforced server-side for stock adjustments (see inventory.ts's /adjust
  // route) -- not just a client-side nicety, so this can't be bypassed by
  // calling the API directly. Applies to single delete and every per-row
  // call the bulk-delete flow makes (Products.tsx calls this same route
  // once per id), so one check here covers both entry points.
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const reason = body.reason != null ? String(body.reason).trim() || null : null
  if (!reason) return c.json({ error: 'A reason is required to delete a product' }, 400)

  // Also a real pre-existing gap fixed alongside the reason requirement:
  // this route never wrote to the audit log at all (every other
  // delete-type route in this app does -- branches.ts, contacts.ts,
  // fees.ts, promotions.ts, etc.), so a product delete previously left no
  // trace of who deleted it, when, or why. Name captured before the
  // update since a soft delete doesn't remove the row but the name is
  // still worth freezing into the audit entry rather than re-reading it
  // live later. Per-branch stock captured the same way, for the
  // inventory_movements entries below -- same reasoning as the audit
  // name capture, and needed before the soft delete zeroes nothing out
  // itself (branch_stock rows are untouched by this route, but their
  // quantities at this moment are what the movement log should reflect).
  const existing = await getDb(c.env).prepare('SELECT name FROM products WHERE id = @id').get<{ name?: string }>({ id })
  const stockRows = await getDb(c.env).prepare(`
    SELECT bs.branch_id AS branchId, bs.quantity AS quantity, b.name AS branchName
    FROM branch_stock bs LEFT JOIN branches b ON b.id = bs.branch_id
    WHERE bs.product_id = @id AND bs.quantity > 0
  `).all<{ branchId: number; quantity: number; branchName: string | null }>({ id })

  // Same Review Required tier as create/update above: delete also queues
  // rather than applying directly for a 'review'-tier user. No-op (null)
  // for Full tier, same as every other maybeQueueForReview call site.
  const pendingId = await maybeQueueForReview(c.env, user, 'products', {
    actionType: 'delete',
    entityType: 'product',
    entityId: Number(id),
    payload: { id, reason },
    summary: `Delete product #${id}`,
  })
  if (pendingId != null) {
    return c.json({ success: true, pending: true, pendingActionId: pendingId }, 202)
  }

  const result = await getDb(c.env).prepare('UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = @id').run({ id })

  // One inventory_movements row per branch that still had stock at delete
  // time -- same table/shape /adjust's own remove path writes to (see
  // that route just above), movement_type: 'delete' so this is
  // distinguishable in the Inventory movements log from an ordinary
  // manual stock_remove. A soft delete doesn't touch branch_stock rows
  // itself (the product just stops showing up as active), so without
  // this the movement history would show no record at all of the stock
  // that existed when the product was removed.
  for (const row of stockRows) {
    await getDb(c.env).prepare(`
      INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_id, user_name, created_at)
      VALUES (@productId, @productName, @branchId, @branchName, 'delete', @quantity, @reason, @userId, @userName, CURRENT_TIMESTAMP)
    `).run({
      productId: Number(id),
      productName: existing?.name ?? null,
      branchId: row.branchId,
      branchName: row.branchName,
      quantity: row.quantity,
      reason,
      userId: user?.id ?? null,
      userName: user?.name ?? null,
    })
  }

  await audit(c.env, user?.id ?? null, user?.name ?? null, 'delete', 'product', Number(id), { name: existing?.name ?? null, reason })
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'delete', id }))
  return c.json({ success: true, changes: result.changes })
})

// POST /api/products/bulk-delete-jobs -- the 10k+-safe path. Products.tsx's
// bulk-delete flow (runBulkDeleteConfirmed) uses this instead of calling
// DELETE /:id once per selected row once the selection is large enough
// that doing so would mean thousands of individual round trips; see
// lib/bulkDeleteEngine.ts's header for the full reasoning. Small
// selections still go through the per-id path above, unchanged -- it
// gives per-item undo/redo, which a queued job (deliberately fire-and-poll,
// not request/response) doesn't fit as naturally.
//
// Same permission rule as single delete, checked once here instead of
// implicitly once per row: 'none' is rejected outright. 'review' tier is
// rejected too, deliberately, rather than half-supported -- queuing one
// review action per id would defeat the entire point of batching, and
// queuing a single review action for the whole batch would need
// reviewQueue.ts's approval-apply path to understand a new 'bulk_delete'
// action type, which it doesn't yet. A review-tier user gets a clear
// error telling them why, not a silently-wrong partial behavior.
app.post('/bulk-delete-jobs', async (c) => {
  const user = c.get('user')
  const tier = getActionTier(user, 'products', 'bulk_delete')
  if (tier === 'none') return c.json({ error: 'You do not have permission to perform this action' }, 403)
  if (tier === 'review') {
    return c.json({ error: 'Bulk delete requires Full access for Products. Ask an admin, or delete a smaller selection through the normal review flow.' }, 403)
  }

  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const reason = body.reason != null ? String(body.reason).trim() || null : null
  if (!reason) return c.json({ error: 'A reason is required to delete products' }, 400)

  const rawIds = Array.isArray(body.ids) ? body.ids : []
  // 50,000 is a generous ceiling, not a tuned limit -- comfortably above
  // "10k+" while still keeping ids_json (see migration 0036) at a size
  // that's obviously fine for a D1 TEXT column (a few hundred KB at most).
  // Raise it later if a real use case needs more; there's no other reason
  // this number is what it is.
  if (!rawIds.length) return c.json({ error: 'No products selected' }, 400)
  if (rawIds.length > 50000) return c.json({ error: 'Select 50,000 or fewer products per bulk delete' }, 400)

  try {
    const { jobId, totalCount } = await createBulkDeleteJob(c.env, 'products', rawIds as number[], reason, { id: user?.id ?? null, name: user?.name ?? null })
    return c.json({ success: true, jobId, totalCount }, 202)
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to start bulk delete' }, 400)
  }
})

// GET /api/products/bulk-delete-jobs/:id -- polled by the frontend while a
// job is in flight (see BulkDeleteJobProgress in Products.tsx). Cheap: one
// row read, no join, so polling every second or two is fine.
app.get('/bulk-delete-jobs/:id', async (c) => {
  const user = c.get('user')
  if (getPermissionTier(user, 'products') === 'none') return c.json({ error: 'You do not have permission to perform this action' }, 403)
  await reapStalledBulkDeleteJobs(c.env)
  const job = await getBulkDeleteJob(c.env, c.req.param('id'))
  if (!job) return c.json({ error: 'Bulk delete job not found' }, 404)
  return c.json({
    success: true,
    job: {
      id: job.id,
      status: job.status,
      totalCount: job.total_count,
      processedCount: job.processed_count,
      failedCount: job.failed_count,
      lastError: job.last_error ?? null,
    },
  })
})

// POST /api/products/bulk-delete-jobs/:id/cancel -- sets cancel_requested;
// the queue consumer checks it once per chunk (see runBulkDeleteJob), so
// this takes effect within one chunk's worth of rows (up to
// BULK_DELETE_CHUNK_SIZE), not instantly and not only at the very end.
// Whatever's already committed at that point stays deleted -- same
// "partial progress is kept, not rolled back" behavior as import job
// cancellation.
app.post('/bulk-delete-jobs/:id/cancel', async (c) => {
  const user = c.get('user')
  if (getPermissionTier(user, 'products') === 'none') return c.json({ error: 'You do not have permission to perform this action' }, 403)
  await getDb(c.env).prepare(`UPDATE bulk_delete_jobs SET cancel_requested = 1, updated_at = CURRENT_TIMESTAMP WHERE id = @id AND status IN ('pending', 'processing')`).run({ id: c.req.param('id') })
  return c.json({ success: true })
})

app.post('/variant', async (c) => {
  if (!hasPermission(c.get('user'), 'products')) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const name = String(body.name || '').trim()
  if (!name) return c.json({ error: 'Product name is required' }, 400)
  const id = await insertRow(c.env, 'products', body, { name, is_active: 1 })

  const rawBranchId = Number.parseInt(String(body.branch_id ?? ''), 10)
  const branchId = Number.isFinite(rawBranchId) && rawBranchId > 0 ? rawBranchId : await defaultBranchId(c.env)
  // Same clamp as POST / above -- `|| 0` alone doesn't catch a genuinely
  // negative number, which is truthy. Same all-active-branches seeding as
  // POST / above -- see seedBranchStockForNewProduct's own comment.
  const initialQty = Math.max(0, Number(body.stock_quantity ?? 0) || 0)
  await seedBranchStockForNewProduct(c.env, id as number, branchId, initialQty)
  await seedInitialBatchForNewProduct(c.env, id as number, branchId, initialQty)

  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'create', id }))
  return c.json({ item: await getDb(c.env).prepare('SELECT * FROM products WHERE id = @id').get({ id }), id, success: true })
})

// POST /api/products/merge-duplicates -- retroactive cleanup for products
// that were already imported as separate rows when they're really the same
// item, differing only in which branch's branch_stock they ended up with
// (see findDuplicateProductGroups' comment for the full "why this exists").
// Import-time de-duplication (classifyProducts) only ever compares an
// incoming batch against itself/the existing catalog going forward -- it
// never retroactively reconciled duplicates already sitting in the
// catalog from before that matching existed, or from two separate import
// runs (e.g. one file per branch) that never saw each other's rows. This
// walks the whole active catalog once, groups by the same identity rule
// transfers already self-heal with (findIdentityMatch/-es -- name_key +
// cost + selling price + barcode), and for every group folds every
// duplicate's branch_stock into the lowest-id ("canonical") row, then
// deactivates the duplicate (soft delete, same as DELETE /:id, so old
// sales/movement rows that still reference its id stay valid).
//
// "Tag it": every merge writes two durable, visible records rather than
// silently disappearing a row -- an `inventory_movements` entry per
// non-zero branch actually moved (shows up in that branch's real stock
// history, reason names the absorbed product by name and id) and an
// `audit` log entry per merged product (action 'merge_duplicate'). No
// schema change needed for this.
// GET /api/products/merge-duplicates/preview -- read-only dry run for the
// endpoint below. MergeDuplicatesReviewModal.tsx used to be unable to show
// which products would actually merge (see progress.md part 91's "Merge-
// duplicates info tool" item) because findDuplicateProductGroups' result
// only ever got computed inside the same request that also acted on it.
// This route reuses that exact function -- same identity rule, same
// canonical-pick order -- but only reads (branch_stock/product_batches
// counts for context), never writes anything, so it's safe to call as
// often as the modal wants (e.g. every time it opens) with zero side
// effects. Kept as a separate route rather than a `dryRun` query param on
// POST /merge-duplicates so this can be a plain GET (cacheable by the
// browser/proxy layer, no CSRF-adjacent concerns a mutating POST has) and
// so the two handlers' very different jobs -- "tell me" vs. "do it" --
// stay easy to reason about independently.
// ---------------------------------------------------------------------------
// Wire library images to products by filename
// ---------------------------------------------------------------------------
// The import path has always been able to match uploaded photos to rows by
// filename. Nothing could do the same for images ALREADY in the Library --
// so a photo uploaded outside an import, or one whose import matched nothing
// at the time, could only be attached by opening each product and picking it
// by hand. For a catalog this size that is not a real option.
//
// Same matcher the import uses (lib/importImageMatch.ts), so "Coca Cola.jpg",
// "Coca Cola_1.jpg", "coca_cola-2.png" and "Coca Cola (3).jpg" all resolve to
// the same product here exactly as they do there. One rule, one
// implementation.
//
// Split into preview and apply on purpose. Attaching photos to thousands of
// products is not something to trigger from a menu and discover afterwards --
// the preview is what makes it reviewable, and it is the same reason import
// image wiring became an explicit action rather than an automatic one.

/** Products that could receive an image, and the library images available. */
async function loadWireImageInputs(env: Env) {
  const db = getDb(env)
  const [products, images, galleryRows] = await Promise.all([
    db.prepare(`
      SELECT id, name, image_path FROM products
      WHERE is_active = 1 AND trim(COALESCE(name, '')) <> ''
    `).all<{ id: number; name: string; image_path: string | null }>(),
    db.prepare(`
      SELECT id, original_name, public_path FROM file_assets
      WHERE COALESCE(media_type, 'image') = 'image'
      ORDER BY id ASC
    `).all<{ id: number; original_name: string; public_path: string }>(),
    // The gallery is read too, so "already wired" means the WHOLE set of
    // photos already matches, not just the cover. Without this a product
    // whose cover happened to be right would be reported as needing no
    // change while its second and third photos were still missing.
    db.prepare(`
      SELECT product_id, image_path FROM product_images
      ORDER BY product_id ASC, sort_order ASC, id ASC
    `).all<{ product_id: number; image_path: string }>(),
  ])
  const galleryByProduct = new Map<number, string[]>()
  for (const row of galleryRows) {
    const list = galleryByProduct.get(row.product_id)
    if (list) list.push(row.image_path)
    else galleryByProduct.set(row.product_id, [row.image_path])
  }
  return { db, products, images, galleryByProduct }
}

/**
 * The `_1` / `_2` / `_3` suffix decides a photo's position, so "Rose
 * Serum_2.jpg" is the second image whichever order the library happens to
 * return it in. Anything without a suffix sorts first.
 *
 * Mirrors the suffix rule matchLibraryImagesStrict uses to decide that a
 * trailing number IS an index rather than part of the name (see its
 * MAX_IMAGES_PER_PRODUCT check -- "Chanel No 5" keeps its 5).
 */
function imagePositionFromName(originalName: string): number {
  const match = String(originalName || '').replace(/\.[^.]+$/, '').match(/[_\-\s](\d+)$/)
  if (!match) return 0
  const position = Number(match[1])
  return position >= 1 && position <= MAX_IMAGES_PER_PRODUCT ? position : 0
}

/** One product's proposed photo set, in the order it would be stored. */
type WireImageChange = {
  productId: number
  productName: string
  imageIds: number[]
  imageNames: string[]
  imagePaths: string[]
  currentImagePath: string | null
  currentGallery: string[]
  replaces: boolean
}

app.post('/wire-images/preview', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'products', 'image') !== 'full') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const { products, images, galleryByProduct } = await loadWireImageInputs(c.env)
  // STRICT, not the import's matcher. That one has a fuzzy fallback, which is
  // right when an operator is reviewing a few hundred rows they just uploaded
  // and a near-miss is a useful suggestion. It is wrong here: this runs
  // across the whole catalog, and a fuzzy hit at that scale silently attaches
  // the wrong photo to a real product. Exact name, or name + _1.._3, only.
  const result = matchLibraryImagesStrict(
    images.map((image) => ({ id: image.id, originalName: image.original_name, relativePath: image.original_name, publicPath: image.public_path })),
    products.map((product) => ({ id: product.id, name: product.name })),
  )

  const productById = new Map(products.map((product) => [product.id, product]))
  const imageById = new Map(images.map((image) => [image.id, image]))

  // Grouped PER PRODUCT, not per image. The matcher deliberately returns up
  // to MAX_IMAGES_PER_PRODUCT images for one product (that is what the
  // `_1`/`_2`/`_3` suffixes are for), and treating each as its own change
  // meant three UPDATEs to the same `image_path` column where the last one
  // silently won and the other two photos were dropped on the floor -- with
  // the gallery table never written at all.
  const pending = new Map<number, WireImageChange>()
  for (const entry of result.matched) {
    const image = imageById.get(Number(entry.image.id))
    const product = productById.get(Number(entry.productId))
    if (!image || !product) continue
    const change = pending.get(product.id) || {
      productId: product.id,
      productName: product.name,
      imageIds: [],
      imageNames: [],
      imagePaths: [],
      currentImagePath: product.image_path,
      currentGallery: galleryByProduct.get(product.id) || [],
      replaces: false,
    }
    change.imageIds.push(image.id)
    change.imageNames.push(image.original_name)
    change.imagePaths.push(image.public_path)
    pending.set(product.id, change)
  }

  const changes: WireImageChange[] = []
  for (const change of pending.values()) {
    // Sort by suffix so the cover is the photo actually named `_1`.
    const order = change.imageNames
      .map((name, index) => ({ index, position: imagePositionFromName(name) }))
      .sort((a, b) => a.position - b.position || a.index - b.index)
    change.imageIds = order.map((slot) => change.imageIds[slot.index])
    change.imageNames = order.map((slot) => change.imageNames[slot.index])
    change.imagePaths = order.map((slot) => change.imagePaths[slot.index])

    // Only rows that would actually CHANGE. A product already showing exactly
    // these photos, in this order, is not a pending action, and listing it
    // would bury the ones that are.
    const galleryUnchanged = change.currentGallery.length === change.imagePaths.length
      && change.currentGallery.every((path, index) => path === change.imagePaths[index])
    if (galleryUnchanged && change.currentImagePath === change.imagePaths[0]) continue

    change.replaces = !!change.currentImagePath || change.currentGallery.length > 0
    changes.push(change)
  }
  changes.sort((a, b) => a.productName.localeCompare(b.productName))

  return c.json({
    success: true,
    changes,
    counts: {
      libraryImages: images.length,
      matched: result.matched.length,
      unmatched: result.unmatched.length,
      ambiguous: result.ambiguous.length,
      wouldChange: changes.length,
      wouldReplace: changes.filter((change) => change.replaces).length,
    },
    unmatched: result.unmatched.slice(0, 50).map((image) => image.originalName),
    // Reported separately from unmatched: a filename that resolves to more
    // than one product is not a miss, it is a grouping question the operator
    // has to settle. Picking one arbitrarily would attach it to the wrong row.
    ambiguous: result.ambiguous.slice(0, 50).map((image) => image.originalName),
  })
})

app.post('/wire-images', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'products', 'image') !== 'full') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  // The client sends back the exact pairs it showed. Re-matching here would
  // risk applying something the reviewer never saw, if the library changed
  // between preview and confirm.
  const pairs = Array.isArray(body.changes) ? body.changes : []
  if (!pairs.length) return c.json({ success: true, updated: 0 })

  const db = getDb(c.env)
  const applied = pairs
    .map((raw) => {
      const pair = raw as { productId?: unknown; imagePaths?: unknown; imagePath?: unknown }
      const productId = Number(pair?.productId)
      if (!Number.isFinite(productId) || productId <= 0) return null
      // `imagePath` (singular) is what the first version of this endpoint
      // accepted. Still honoured so an older client, or a retried request
      // built before this deploy, wires the cover rather than failing.
      const rawPaths = Array.isArray(pair?.imagePaths)
        ? pair.imagePaths
        : pair?.imagePath != null ? [pair.imagePath] : []
      const imagePaths = sanitizeMediaList(rawPaths).slice(0, MAX_IMAGES_PER_PRODUCT)
      if (!imagePaths.length) return null
      return { productId, imagePaths }
    })
    .filter((entry): entry is { productId: number; imagePaths: string[] } => entry !== null)

  if (!applied.length) return c.json({ success: true, updated: 0 })

  // Cover column and gallery table both, through the same
  // syncProductImageGallery every other product write uses -- the gallery is
  // what the Products page, the edit form and the public portal all read, so
  // writing only `image_path` here left the photos invisible everywhere but
  // the row thumbnail.
  for (const entry of applied) {
    await db.batch([{
      sql: `UPDATE products SET image_path = @imagePath, updated_at = CURRENT_TIMESTAMP WHERE id = @id AND is_active = 1`,
      params: { id: entry.productId, imagePath: entry.imagePaths[0] },
    }])
    await syncProductImageGallery(c.env, entry.productId, entry.imagePaths)
  }
  await bumpVersion(c.env, 'products')
  return c.json({ success: true, updated: applied.length, imagesAttached: applied.reduce((sum, entry) => sum + entry.imagePaths.length, 0) })
})

// ---------------------------------------------------------------------------
// Unwire: detach photos from products WITHOUT deleting the files
// ---------------------------------------------------------------------------
// The counterpart to wiring, and the reason it is needed: wiring is applied
// across the whole catalog at once, so getting it wrong has to be reversible
// in one action too. Undoing it by hand, product by product, is not a real
// option at this scale.
//
// This clears the link only. Every file stays in the Library, so re-running
// the wire preview after fixing the filenames finds them all again. Deleting
// the files is a separate, explicit action on the Library page -- keeping
// those apart is what makes this one safe to use.
app.post('/unwire-images', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'products', 'image') !== 'full') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const rawIds = Array.isArray(body.productIds) ? body.productIds : []
  const productIds = [...new Set(rawIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))]
  // `all` has to be asked for explicitly. An empty id list must never mean
  // "everything" -- that is one dropped array away from clearing the whole
  // catalog's photos.
  const clearAll = body.all === true
  if (!clearAll && !productIds.length) {
    return c.json({ success: false, error: 'No products selected. Pass productIds, or all: true to detach every product image.' }, 400)
  }

  const db = getDb(c.env)
  let cleared = 0
  if (clearAll) {
    const result = await db.prepare(
      `UPDATE products SET image_path = NULL, updated_at = CURRENT_TIMESTAMP WHERE is_active = 1 AND image_path IS NOT NULL`,
    ).run()
    cleared = Number(result.changes || 0)
    await db.prepare(`DELETE FROM product_images`).run()
  } else {
    for (const chunk of chunkForBinding(productIds)) {
      const { sql, params } = buildInClause('id', chunk)
      const result = await db.prepare(
        `UPDATE products SET image_path = NULL, updated_at = CURRENT_TIMESTAMP WHERE id IN (${sql}) AND is_active = 1`,
      ).run(params)
      cleared += Number(result.changes || 0)
      await db.prepare(`DELETE FROM product_images WHERE product_id IN (${sql})`).run(params)
    }
  }

  await audit(c.env, user?.id ?? null, user?.name ?? null, 'unwire_images', 'product', null, {
    scope: clearAll ? 'all' : 'selection',
    productCount: clearAll ? cleared : productIds.length,
  })
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  return c.json({ success: true, cleared })
})

app.get('/merge-duplicates/preview', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'products', 'merge_duplicates') !== 'full') {
    return c.json({ success: false, error: 'You do not have permission to perform this action' }, 403)
  }
  const db = getDb(c.env)
  const groups = await findDuplicateProductGroups(db)
  if (!groups.length) {
    return c.json({ success: true, groupCount: 0, duplicateProductCount: 0, groups: [] })
  }

  const branchRows = await db.prepare('SELECT id, name FROM branches').all<{ id: number; name: string }>({})
  const branchNameById = new Map<number, string>(branchRows.map((b) => [b.id, b.name]))

  // One batch of queries per group (not per duplicate) to keep this
  // proportional to group count rather than duplicate count -- same
  // "snapshot once per group" instinct the real merge endpoint below
  // already applies to the canonical's batch set, just extended here to
  // every stock/batch lookup since a preview has no reason to be any
  // cheaper-per-call than the thing it's previewing.
  const previewGroups = await Promise.all(
    groups.map(async (group) => {
      const duplicateIds = group.duplicates.map((d) => d.id)

      const stockRows = await selectInChunks(duplicateIds, 0, (chunk) => {
        const { sql, params } = buildInClause('id', chunk)
        return db
          .prepare(`SELECT product_id, branch_id, quantity FROM branch_stock WHERE product_id IN (${sql})`)
          .all<{ product_id: number; branch_id: number; quantity: number }>(params)
      })
      // GROUP BY is per variant_product_id, so a chunked count is still a
      // complete count for each product -- no cross-chunk re-aggregation.
      const batchCountRows = await selectInChunks(duplicateIds, 0, (chunk) => {
        const { sql, params } = buildInClause('id', chunk)
        return db
          .prepare(`SELECT variant_product_id, COUNT(*) AS cnt FROM product_batches WHERE variant_product_id IN (${sql}) AND is_active = 1 GROUP BY variant_product_id`)
          .all<{ variant_product_id: number; cnt: number }>(params)
      })
      const batchCountByProductId = new Map<number, number>(batchCountRows.map((r) => [r.variant_product_id, Number(r.cnt) || 0]))

      const branchQtyById = new Map<number, number>()
      let totalQuantityToMove = 0
      for (const row of stockRows) {
        const qty = Number(row.quantity) || 0
        if (!qty) continue
        branchQtyById.set(row.branch_id, (branchQtyById.get(row.branch_id) || 0) + qty)
        totalQuantityToMove += qty
      }
      const branchBreakdown = [...branchQtyById.entries()]
        .map(([branchId, quantity]) => ({ branchId, branchName: branchNameById.get(branchId) || null, quantity }))
        .sort((a, b) => (a.branchName || '').localeCompare(b.branchName || ''))

      const duplicates = group.duplicates.map((dup) => ({
        id: dup.id,
        name: dup.name,
        barcode: dup.barcode,
        quantity: stockRows.filter((r) => r.product_id === dup.id).reduce((sum, r) => sum + (Number(r.quantity) || 0), 0),
        batchCount: batchCountByProductId.get(dup.id) || 0,
      }))

      return {
        canonicalId: group.canonical.id,
        canonicalName: group.canonical.name,
        canonicalBarcode: group.canonical.barcode,
        duplicates,
        totalQuantityToMove,
        branchBreakdown,
      }
    }),
  )

  return c.json({
    success: true,
    groupCount: previewGroups.length,
    duplicateProductCount: previewGroups.reduce((sum, g) => sum + g.duplicates.length, 0),
    groups: previewGroups,
  })
})

app.post('/merge-duplicates', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'products', 'merge_duplicates') !== 'full') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const db = getDb(c.env)
  const groups = await findDuplicateProductGroups(db)
  if (!groups.length) {
    return c.json({ success: true, mergedGroups: 0, mergedProducts: 0, groups: [] })
  }

  const branchRows = await db.prepare('SELECT id, name FROM branches').all<{ id: number; name: string }>({})
  const branchNameById = new Map<number, string>(branchRows.map((b) => [b.id, b.name]))

  const groupSummaries: Array<{
    canonicalId: number
    canonicalName: string | null
    mergedIds: number[]
    mergedNames: (string | null)[]
  }> = []
  let mergedProductsCount = 0

  for (const group of groups) {
    const canonicalId = group.canonical.id
    const canonicalName = group.canonical.name
    const mergedIds: number[] = []
    const mergedNames: (string | null)[] = []

    // Batch/lot history reassignment -- fixes the gap
    // MergeDuplicatesReviewModal.tsx explicitly warns about: a duplicate's
    // product_batches rows (lot codes, expiry dates) used to stay pointed
    // at its now-inactive id and never followed the quantity into the
    // canonical product, so "Manage Batches" on the surviving row could
    // silently miss real batch/expiry detail after a merge. Snapshot the
    // canonical's current batches once per group (not per duplicate) so
    // every duplicate in the group checks/reserves the same growing set --
    // two duplicates in one group can each carry a batch with the same
    // batch_key (e.g. both received the same real-world lot before either
    // was merged).
    const canonicalBatchRows = await db
      .prepare('SELECT id, batch_key, batch_number FROM product_batches WHERE variant_product_id = @id')
      .all<{ id: number; batch_key: string; batch_number: number | null }>({ id: canonicalId })
    const canonicalBatchIdByKey = new Map<string, number>(canonicalBatchRows.map((b) => [b.batch_key, b.id]))
    let nextCanonicalBatchNumber = canonicalBatchRows.reduce((max, b) => Math.max(max, Number(b.batch_number) || 0), 0) + 1

    for (const dup of group.duplicates) {
      const stockRows = await db
        .prepare('SELECT branch_id, quantity FROM branch_stock WHERE product_id = @id')
        .all<{ branch_id: number; quantity: number }>({ id: dup.id })
      const dupBatchRows = await db
        .prepare('SELECT id, batch_key FROM product_batches WHERE variant_product_id = @id')
        .all<{ id: number; batch_key: string }>({ id: dup.id })
      // Images were the one thing this merge silently threw away: branch_stock,
      // inventory_movements and product_batches were all carried over, but the
      // duplicate's gallery (product_images) and its image_path were left
      // attached to a row that is about to be deactivated -- so a photo the
      // duplicate carried and the canonical didn't simply vanished from the
      // catalog. That breaks the standing rule that images follow a product
      // through a rename or a regroup.
      const dupImageRows = await db
        .prepare('SELECT image_path, sort_order FROM product_images WHERE product_id = @id ORDER BY sort_order ASC, id ASC')
        .all<{ image_path: string; sort_order: number | null }>({ id: dup.id })
      const canonicalImageRows = await db
        .prepare('SELECT image_path FROM product_images WHERE product_id = @id')
        .all<{ image_path: string }>({ id: canonicalId })
      const canonicalImagePaths = new Set(canonicalImageRows.map((r) => String(r.image_path)))
      let nextCanonicalImageOrder = canonicalImageRows.length

      const statements: Array<{ sql: string; params?: Record<string, unknown> }> = []
      for (const row of stockRows) {
        const qty = Number(row.quantity) || 0
        if (!qty) continue
        statements.push({
          sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@canonicalId, @branchId, @qty)
                ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
          params: { canonicalId, branchId: row.branch_id, qty },
        })
        statements.push({
          sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_id, user_name, created_at)
                VALUES (@productId, @productName, @branchId, @branchName, 'adjustment', @quantity, @reason, @userId, @userName, CURRENT_TIMESTAMP)`,
          params: {
            productId: canonicalId,
            productName: canonicalName,
            branchId: row.branch_id,
            branchName: branchNameById.get(row.branch_id) || null,
            quantity: qty,
            reason: `Merged duplicate product "${dup.name}" (#${dup.id}) into this product -- branch-only duplicate cleanup`,
            userId: user?.id ?? null,
            userName: user?.name ?? null,
          },
        })
      }
      statements.push({ sql: 'DELETE FROM branch_stock WHERE product_id = @id', params: { id: dup.id } })

      // Move any gallery image the canonical doesn't already have, appended
      // after the canonical's own so its existing order is preserved. Deduped
      // by path, since two duplicates of one product very often reference the
      // same stored object.
      let imagesMovedThisDup = 0
      for (const image of dupImageRows) {
        const imagePath = String(image.image_path || '')
        if (!imagePath || canonicalImagePaths.has(imagePath)) continue
        canonicalImagePaths.add(imagePath)
        statements.push({
          sql: 'INSERT INTO product_images (product_id, image_path, sort_order) VALUES (@canonicalId, @path, @order)',
          params: { canonicalId, path: imagePath, order: nextCanonicalImageOrder },
        })
        nextCanonicalImageOrder += 1
        imagesMovedThisDup += 1
      }
      statements.push({ sql: 'DELETE FROM product_images WHERE product_id = @id', params: { id: dup.id } })
      // A canonical with no primary image adopts the duplicate's, so a merge
      // can only ever add imagery, never remove it.
      statements.push({
        sql: `UPDATE products SET image_path = COALESCE(NULLIF(image_path, ''), @dupImagePath), updated_at = CURRENT_TIMESTAMP
              WHERE id = @canonicalId AND @dupImagePath IS NOT NULL AND @dupImagePath != ''`,
        params: { canonicalId, dupImagePath: dup.image_path ?? null },
      })

      statements.push({ sql: 'UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = @id', params: { id: dup.id } })

      // batch_key has a UNIQUE(variant_product_id, batch_key) index, so a
      // batch can't just be re-pointed at the canonical product if the
      // canonical already has a batch with the same key -- fold that
      // duplicate batch's branch_batch_stock into the canonical's existing
      // same-key batch instead (summed per branch, same ON CONFLICT
      // pattern as branch_stock above) and leave the now-empty duplicate
      // batch row deactivated in place rather than deleting it, since
      // sale_item_batch_allocations/return_item_batch_allocations may
      // still reference its id. No collision -> reassign the FK directly
      // and give it a fresh batch_number in the canonical's own sequence
      // (this is the batch's first-ever assignment under that product, not
      // a renumbering of an existing stable one -- see productBatches.ts's
      // "stable once assigned" comment, which is about a batch keeping its
      // number for as long as it stays on the same product).
      let batchesMovedThisDup = 0
      let batchesFoldedThisDup = 0
      for (const batchRow of dupBatchRows) {
        const existingCanonicalBatchId = canonicalBatchIdByKey.get(batchRow.batch_key)
        if (existingCanonicalBatchId) {
          const dupBatchStockRows = await db
            .prepare('SELECT branch_id, quantity FROM branch_batch_stock WHERE batch_id = @id')
            .all<{ branch_id: number; quantity: number }>({ id: batchRow.id })
          for (const bbs of dupBatchStockRows) {
            const qty = Number(bbs.quantity) || 0
            if (!qty) continue
            statements.push({
              sql: `INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (@batchId, @branchId, @qty)
                    ON CONFLICT(batch_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP`,
              params: { batchId: existingCanonicalBatchId, branchId: bbs.branch_id, qty },
            })
          }
          statements.push({ sql: 'DELETE FROM branch_batch_stock WHERE batch_id = @id', params: { id: batchRow.id } })
          statements.push({ sql: 'UPDATE product_batches SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = @id', params: { id: batchRow.id } })
          batchesFoldedThisDup += 1
        } else {
          statements.push({
            sql: 'UPDATE product_batches SET variant_product_id = @canonicalId, batch_number = @batchNumber, updated_at = CURRENT_TIMESTAMP WHERE id = @id',
            params: { canonicalId, batchNumber: nextCanonicalBatchNumber, id: batchRow.id },
          })
          canonicalBatchIdByKey.set(batchRow.batch_key, batchRow.id)
          nextCanonicalBatchNumber += 1
          batchesMovedThisDup += 1
        }
      }

      await db.batch(statements)

      await audit(c.env, user?.id ?? null, user?.name ?? null, 'merge_duplicate', 'product', dup.id, {
        productName: dup.name,
        mergedIntoProductId: canonicalId,
        mergedIntoProductName: canonicalName,
        batchesMoved: batchesMovedThisDup,
        batchesFoldedIntoExistingLot: batchesFoldedThisDup,
        // Recorded so a merge that moved imagery is visible in the audit log
        // rather than being an invisible side effect.
        imagesMoved: imagesMovedThisDup,
      })

      mergedIds.push(dup.id)
      mergedNames.push(dup.name)
      mergedProductsCount += 1
    }

    // One recompute of the canonical row's denormalized stock_quantity
    // cache after all its duplicates for this group have merged in --
    // same pattern branches.ts/returns.ts use after any branch_stock
    // change (see comment there); cheaper as one pass at the end of the
    // group than after every individual duplicate.
    await db
      .prepare('UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @id), updated_at = CURRENT_TIMESTAMP WHERE id = @id')
      .run({ id: canonicalId })

    groupSummaries.push({ canonicalId, canonicalName, mergedIds, mergedNames })
  }

  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'update' }))
  return c.json({ success: true, mergedGroups: groups.length, mergedProducts: mergedProductsCount, groups: groupSummaries })
})

// GET /api/products/zero-quantity-candidates -- read-only scan for the
// "delete products that have been at 0 stock for a while" cleanup feature
// (see progress.md part 91's full spec for the design constraints this
// follows). Never deletes anything by itself -- this is the "multiple
// sources agree, and it's been long enough" candidate list the review
// modal shows before any confirmation.
//
// "Multiple sources, all true": a product only qualifies if its
// denormalized `products.stock_quantity` cache AND a live
// `SUM(branch_stock.quantity)` both agree the real total is 0 -- reading
// only the cache (which could be stale if some code path forgot to
// recompute it) would trust a single, potentially-wrong source; this is
// the same "cache vs. source of truth" pair the merge endpoint's own
// post-merge recompute exists to keep in sync, checked here instead of
// blindly trusted.
//
// Age-at-zero: there's no dedicated "became 0 at this timestamp" column
// anywhere in the schema. The most recent `inventory_movements` row for a
// product (across all its branches) is the last time its stock changed at
// all -- since the live check above already confirms current stock is 0
// and no movement has happened since that row, that row's `created_at` IS
// the moment stock became (or last became) 0, without needing to store a
// resulting-quantity snapshot per movement. A product with zero movement
// history ever (imported at 0, never sold/adjusted/received) has no such
// row to check -- falls back to `products.created_at` and is flagged
// `neverStocked: true` so the review UI can show "never had stock" rather
// than implying a false "went out of stock" history.
app.get('/zero-quantity-candidates', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'products', 'zero_qty_cleanup') !== 'full') {
    return c.json({ success: false, error: 'You do not have permission to perform this action' }, 403)
  }
  const db = getDb(c.env)

  const requestedThreshold = Number.parseInt(c.req.query('thresholdDays') || '', 10)
  let thresholdDays = Number.isFinite(requestedThreshold) && requestedThreshold >= 0 ? requestedThreshold : null
  if (thresholdDays === null) {
    const settingRow = await db.prepare(`SELECT value FROM settings WHERE key = 'product_zero_qty_delete_threshold_days'`).get<{ value: string }>()
    const stored = Number.parseInt(settingRow?.value || '', 10)
    thresholdDays = Number.isFinite(stored) && stored >= 0 ? stored : DEFAULT_ZERO_QTY_THRESHOLD_DAYS
  }

  // Cache vs. live-sum agreement, computed in one query rather than N --
  // LEFT JOIN so a product with zero branch_stock rows at all (never
  // stocked anywhere) still comes through with liveQuantity = 0 via
  // COALESCE, same "no rows present" case the merge endpoint's branch-
  // stock logic already has to account for.
  const rows = await db
    .prepare(`
      SELECT
        p.id, p.name, p.barcode, p.sku, p.created_at,
        p.stock_quantity AS cachedQuantity,
        COALESCE(SUM(bs.quantity), 0) AS liveQuantity,
        COUNT(bs.id) AS branchStockRowCount,
        (SELECT MAX(created_at) FROM inventory_movements im WHERE im.product_id = p.id) AS lastMovementAt
      FROM products p
      LEFT JOIN branch_stock bs ON bs.product_id = p.id
      WHERE p.is_active = 1 AND COALESCE(p.is_group, 0) = 0
      GROUP BY p.id
      HAVING p.stock_quantity = 0 AND COALESCE(SUM(bs.quantity), 0) = 0
    `)
    .all<{
      id: number
      name: string | null
      barcode: string | null
      sku: string | null
      created_at: string | null
      cachedQuantity: number
      liveQuantity: number
      branchStockRowCount: number
      lastMovementAt: string | null
    }>({})

  const now = Date.now()
  const candidates = rows
    .map((row) => {
      const neverStocked = Number(row.branchStockRowCount) === 0
      const zeroSince = row.lastMovementAt || row.created_at
      const zeroSinceMs = zeroSince ? new Date(zeroSince).getTime() : NaN
      const ageDays = Number.isFinite(zeroSinceMs) ? Math.max(0, Math.floor((now - zeroSinceMs) / 86400000)) : null
      return {
        id: row.id,
        name: row.name,
        barcode: row.barcode,
        sku: row.sku,
        neverStocked,
        zeroSince: zeroSince || null,
        ageDays,
        meetsThreshold: ageDays !== null && ageDays >= thresholdDays,
      }
    })
    // A product whose zero-since timestamp can't be determined at all
    // (shouldn't happen -- created_at is NOT NULL with a default -- but
    // defensive rather than crashing the route on a genuinely malformed
    // row) is excluded from the candidate list entirely rather than
    // silently treated as infinitely old.
    .filter((candidate) => candidate.ageDays !== null)

  const eligible = candidates.filter((candidate) => candidate.meetsThreshold)
  eligible.sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0))

  return c.json({
    success: true,
    thresholdDays,
    checkedCount: rows.length,
    totalCandidates: eligible.length,
    candidates: eligible,
  })
})

// POST /api/products/zero-quantity-delete -- the confirm step for the
// candidate list above. Per explicit user instruction (part 91) this must
// ALWAYS require a person to review and confirm a specific id list first
// -- there is deliberately no "just delete everything past the threshold"
// variant of this endpoint, and no scheduled/automatic version anywhere
// in this codebase.
//
// Re-verifies every id server-side against the exact same "both sources
// agree on 0" rule the GET above uses, rather than trusting the id list
// the client sends -- the review list could be stale by the time someone
// confirms it (a sale return, a manual adjustment, another merge) the same
// class of staleness gap the merge-duplicates preview (part 96) already
// calls out as a known, accepted limitation of any read-then-confirm flow
// without a locking primitive. An id that no longer qualifies is skipped
// with a reason instead of force-deleted.
app.post('/zero-quantity-delete', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'products', 'zero_qty_cleanup') !== 'full') {
    return c.json({ success: false, error: 'You do not have permission to perform this action' }, 403)
  }
  const db = getDb(c.env)
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const rawIds = Array.isArray(body.ids) ? body.ids : []
  const ids = [...new Set(rawIds.map((id) => Number.parseInt(String(id), 10)).filter((id) => Number.isFinite(id) && id > 0))]
  if (!ids.length) {
    return c.json({ success: false, error: 'No product ids provided' }, 400)
  }

  // `ids` comes straight from the request body and is deliberately
  // unbounded (the zero-quantity sweep selects thousands at a time).
  // GROUP BY p.id keeps each row's aggregate whole within its chunk.
  const rows = await selectInChunks(ids, 0, (chunk) => {
    const { sql, params } = buildInClause('id', chunk)
    return db
      .prepare(`
        SELECT p.id, p.name, p.stock_quantity AS cachedQuantity, COALESCE(SUM(bs.quantity), 0) AS liveQuantity
        FROM products p
        LEFT JOIN branch_stock bs ON bs.product_id = p.id
        WHERE p.id IN (${sql}) AND p.is_active = 1
        GROUP BY p.id
      `)
      .all<{ id: number; name: string | null; cachedQuantity: number; liveQuantity: number }>(params)
  })
  const rowById = new Map(rows.map((row) => [row.id, row]))

  const deletedIds: number[] = []
  const skipped: Array<{ id: number; reason: string }> = []
  const statements: Array<{ sql: string; params?: Record<string, unknown> }> = []

  for (const id of ids) {
    const row = rowById.get(id)
    if (!row) {
      skipped.push({ id, reason: 'not_found_or_already_inactive' })
      continue
    }
    if (Number(row.cachedQuantity) !== 0 || Number(row.liveQuantity) !== 0) {
      skipped.push({ id, reason: 'no_longer_zero_quantity' })
      continue
    }
    statements.push({
      sql: 'UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = @id',
      params: { id },
    })
    deletedIds.push(id)
  }

  if (statements.length) {
    await db.batch(statements)
    for (const id of deletedIds) {
      const row = rowById.get(id)
      await audit(c.env, user?.id ?? null, user?.name ?? null, 'zero_quantity_delete', 'product', id, {
        productName: row?.name ?? null,
      })
    }
    c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
    c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'delete' }))
  }

  return c.json({ success: true, deletedCount: deletedIds.length, deletedIds, skipped })
})

app.post('/bulk-import', (c) => c.json({ success: true, imported: 0, skipped: 0, message: 'Use Import Jobs for Cloudflare bulk imports.' }))

// POST /api/products/lookups/replace -- was a total no-op stub
// (`c.json({ success: true })`, no DB touched at all). This is the endpoint
// behind "Manage Brands/Categories/Units" -> rename/merge/delete: the
// frontend (ManageBrandsModal.tsx etc, via replaceProductLookupValues())
// showed a success toast and the modal would optimistically update, but no
// product row was ever actually changed, so the rename silently reverted
// the moment the list reloaded from the server. Ported from
// backend/src/routes/products.ts's handler, same SQL shape (bulk
// case-insensitive value swap on the products table), now on D1.
function normalizeLookupKey(value: unknown): string {
  return (normalizeCatalogText(value) || '').toLowerCase()
}

app.post('/lookups/replace', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'products', 'manage_lookups') !== 'full') {
    return c.json({ success: false, error: 'No permission', code: 'forbidden', permission: 'products' }, 403)
  }
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const type = String(body.type || '').trim().toLowerCase()
  const field = ({ brand: 'brand', category: 'category', unit: 'unit', supplier: 'supplier' } as Record<string, string>)[type]
  if (!field) return c.json({ success: false, error: 'Invalid lookup type' }, 400)

  const rawFrom = Array.isArray(body.from) ? body.from : [body.from]
  const sourceEntries: string[] = []
  const fromLookups: string[] = []
  const seen = new Set<string>()
  for (const value of rawFrom) {
    const normalized = normalizeCatalogText(value)
    if (!normalized) continue
    sourceEntries.push(normalized)
    const lookup = normalizeLookupKey(normalized)
    if (!lookup || seen.has(lookup)) continue
    seen.add(lookup)
    fromLookups.push(lookup)
  }
  if (!fromLookups.length) return c.json({ success: false, error: 'At least one source value is required' }, 400)

  const normalizedTarget = normalizeCatalogText(body.to, { preserveNull: true })
  if (normalizedTarget && hasSuspiciousCatalogText(normalizedTarget)) {
    return c.json({ success: false, error: `Invalid ${type} replacement value` }, 400)
  }

  const db = getDb(c.env)
  // `@target` is bound in the same statement, so it costs one of the 100
  // slots the `IN` list is competing for -- hence reservedParams = 1.
  let updatedCount = 0
  for (const chunk of chunkForBinding(fromLookups, normalizedTarget ? 1 : 0)) {
    const { sql, params } = buildInClause('from', chunk)
    if (normalizedTarget) params.target = normalizedTarget
    const result = await db.prepare(`
      UPDATE products
      SET ${field} = ${normalizedTarget ? '@target' : 'NULL'}, updated_at = CURRENT_TIMESTAMP
      WHERE lower(trim(COALESCE(${field}, ''))) IN (${sql})
        AND is_active = 1
    `).run(params)
    updatedCount += Number(result.changes || 0)
  }

  await audit(c.env, user?.id ?? null, user?.name ?? null, 'lookup_replace', 'product', null, {
    type,
    from: sourceEntries,
    to: normalizedTarget || null,
    updated_count: updatedCount,
  })
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  return c.json({ success: true, updatedCount })
})

// GET /api/products/stats -- REMOVED (was here, confirmed dead and broken;
// see CHANGES-VERIFIED.md's 2026-08-03 entry). getStockMetrics() computed
// everything from product_batches/branch_batch_stock, tables nothing in
// this app ever writes to, so it always reported 0 stock/0 value/every
// product "out of stock" regardless of real inventory -- and zero frontend
// code called this route at all (Products.tsx has no stat-tile UI). Kept
// as broken-but-unreachable code, it was a landmine for whoever wires up a
// Products stat-tile UI later and trusts the correct-looking types. If
// that UI gets built, re-add this route pointed at `products`/
// `branch_stock` instead (the same tables inventory.ts's own, correct
// `/stats` endpoint already reads).

type LookupUsageEntry = {
  type: string
  key: string
  name: string
  color: string | null
  usage_count: number
  unresolved_count: number
  sample_products: Array<{ id: number | null; name: string | null }>
}

function buildLookupUsageEntries(
  libraryRows: Array<{ name?: string; color?: string | null } | string>,
  productRows: Array<{ id: number; product_name: string | null; value: string | null }>,
  type: string,
): LookupUsageEntry[] {
  const usageMap = new Map<string, LookupUsageEntry>()
  for (const row of libraryRows) {
    const sourceName = typeof row === 'string' ? row : row?.name
    const name = normalizeCatalogText(sourceName)
    if (!name || hasSuspiciousCatalogText(name)) continue
    const key = name.toLowerCase()
    if (!usageMap.has(key)) {
      usageMap.set(key, { type, key, name, color: (typeof row === 'object' ? row.color : null) ?? null, usage_count: 0, unresolved_count: 0, sample_products: [] })
    }
  }
  for (const row of productRows) {
    const rawValue = String(row?.value || '')
    const normalizedValue = normalizeCatalogText(rawValue)
    const isSuspicious = hasSuspiciousCatalogText(rawValue)
    const key = (normalizedValue || rawValue.trim()).toLowerCase()
    if (!key) continue
    if (!usageMap.has(key)) {
      usageMap.set(key, { type, key, name: normalizedValue || rawValue.trim(), color: null, usage_count: 0, unresolved_count: 0, sample_products: [] })
    }
    const entry = usageMap.get(key)!
    entry.usage_count += 1
    if (isSuspicious) entry.unresolved_count += 1
    if (entry.sample_products.length < 3) {
      entry.sample_products.push({ id: Number(row?.id || 0) || null, name: normalizeCatalogText(row?.product_name) })
    }
  }
  return [...usageMap.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// GET /api/products/lookups/usage -- ported from routes/products.ts's
// buildLookupUsageSummary(). Powers the "merge/rename brand-category-unit"
// admin screen (shows how many products reference each value before you
// bulk-rename or delete one) -- had no Cloudflare route at all before this.
app.get('/lookups/usage', async (c) => {
  if (!hasPermission(c.get('user'), 'products')) {
    return c.json({ success: false, error: 'No permission', code: 'forbidden', permission: 'products' }, 403)
  }
  try {
    const db = getDb(c.env)
    const productRows = await db.prepare(`SELECT id, name AS product_name, brand, category, unit FROM products WHERE is_active = 1`).all<{ id: number; product_name: string | null; brand: string | null; category: string | null; unit: string | null }>()
    const brandRows = productRows.map((r) => ({ id: r.id, product_name: r.product_name, value: r.brand }))
    const categoryRows = productRows.map((r) => ({ id: r.id, product_name: r.product_name, value: r.category }))
    const unitRows = productRows.map((r) => ({ id: r.id, product_name: r.product_name, value: r.unit }))

    const categoryLibrary = await db.prepare(`SELECT id, name, color FROM categories ORDER BY name COLLATE NOCASE ASC`).all<{ name: string; color: string | null }>()
    const unitLibrary = await db.prepare(`SELECT id, name, color FROM units ORDER BY name COLLATE NOCASE ASC`).all<{ name: string; color: string | null }>()
    const brandSetting = await db.prepare(`SELECT value FROM settings WHERE key = 'product_brand_options'`).get<{ value: string }>()
    let brandLibrary: string[] = []
    try {
      const parsed = JSON.parse(brandSetting?.value || '[]')
      if (Array.isArray(parsed)) brandLibrary = parsed.filter((v) => !hasSuspiciousCatalogText(v))
    } catch (_) {
      brandLibrary = []
    }

    const version = await getVersion(c.env.CACHE, 'products')
    return c.json({
      success: true,
      snapshotVersion: version,
      brands: buildLookupUsageEntries(brandLibrary, brandRows, 'brand'),
      categories: buildLookupUsageEntries(categoryLibrary, categoryRows, 'category'),
      units: buildLookupUsageEntries(unitLibrary, unitRows, 'unit'),
    })
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message || 'Failed to load lookup usage' }, 500)
  }
})

// The Workers runtime has no `sharp` (no native image library), so this
// route can't compress on the server the way the old Docker backend did.
// The frontend now compresses/resizes images with Canvas before they're
// ever sent here (see frontend/src/utils/imageCompression.ts), targeting
// 180KB per image. This cap is a safety net, not the primary size
// control -- but it's deliberately tight (1MB, not the old 8MB) rather
// than a generic abuse ceiling: a source image that genuinely tried
// compressImageFile's full plan (down to its 480px/lowest-quality floor)
// realistically never lands anywhere near 1MB, so anything over this
// line means compression didn't run at all (the client is offline/old,
// or hit a bug like the 'data:' upload path that skipped compression
// entirely until this session) -- reject with a clear message instead of
// silently accepting an oversized file into R2/D1.
const MAX_PRODUCT_IMAGE_UPLOAD_BYTES = 1 * 1024 * 1024

// POST /api/products/upload-image -- ported from routes/products.ts's
// upload-image handler. Functionally the same upload files.ts's POST
// /api/files/upload already does (store to R2, insert a file_assets row);
// this is a separate route because the frontend's product-edit screen
// calls this exact path under the 'products' permission specifically,
// not the general file-manager's permission -- and had no Cloudflare
// route at all, so every product image upload from that screen 404ed.
app.post('/upload-image', async (c) => {
  const user = c.get('user')
  if (!hasPermission(user, 'products') && !hasPermission(user, 'products_image_only')) {
    return c.json({ success: false, error: 'No permission', code: 'forbidden', permission: 'products' }, 403)
  }
  const rlKey = user?.id ? `user:${user.id}` : getClientIp(c.req.raw)
  const rl = await checkRateLimit(c.env, 'products:upload_image', rlKey, 30, 5 * 60 * 1000)
  if (!rl.allowed) return c.json({ success: false, error: 'Too many product image uploads. Try again shortly.' }, 429)
  const form = await c.req.formData().catch(() => null)
  const file = form?.get('image')
  if (!(file instanceof File)) return c.json({ success: false, error: 'No image uploaded' }, 400)
  if (file.size === 0) return c.json({ success: false, error: 'Uploaded file is empty' }, 400)

  const originalName = sanitizeOriginalFileName(file.name || 'image')
  const mimeType = file.type || 'application/octet-stream'
  const mediaType = getMediaType(mimeType, originalName)
  if (mediaType !== 'image') return c.json({ success: false, error: 'Only image files are accepted here' }, 400)

  const buffer = new Uint8Array(await file.arrayBuffer())
  try {
    validateUploadedBuffer(buffer, mimeType, originalName)
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 400)
  }
  if (buffer.byteLength > MAX_PRODUCT_IMAGE_UPLOAD_BYTES) {
    return c.json({ success: false, error: 'Image is too large to save (over 1MB after your browser attempted to compress it). Please try again, or pick a smaller/simpler source photo.' }, 400)
  }

  const storedName = buildUniqueStoredName(originalName)
  const objectKey = `uploads/${storedName}`
  await c.env.ASSETS.put(objectKey, buffer, { httpMetadata: { contentType: mimeType } })
  const publicPath = `/uploads/${storedName}`

  const db = getDb(c.env)
  const insert = await db.prepare(`
    INSERT INTO file_assets (original_name, stored_name, public_path, mime_type, media_type, byte_size, source, created_by_id, created_by_name, optimization_status)
    VALUES (@original_name, @stored_name, @public_path, @mime_type, 'image', @byte_size, 'upload', @created_by_id, @created_by_name, 'not_applicable_no_sharp')
  `).run({ original_name: originalName, stored_name: storedName, public_path: publicPath, mime_type: mimeType, byte_size: buffer.byteLength, created_by_id: user?.id ?? null, created_by_name: user?.name ?? null })
  const asset = await db.prepare(`SELECT * FROM file_assets WHERE id = @id`).get({ id: insert.lastInsertRowid })

  await audit(c.env, user?.id ?? null, user?.name ?? null, 'upload', 'product_image', insert.lastInsertRowid, { original_name: originalName })
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))

  return c.json({
    success: true,
    path: publicPath,
    public_path: publicPath,
    asset,
    processing_status: 'ready',
    media_job_id: null,
    cache_version: String(Date.now()),
  })
})

export default app
