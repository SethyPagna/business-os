import { Hono } from 'hono'
import { enqueueImageNormalization } from '../lib/imageAudit'
import { getDb } from '../lib/db'
import { paginateProductFamilies } from '../lib/familyPagination'
import { cachedJsonResponse, getVersionWithFallback, bumpVersion } from '../lib/cache'
import { matchLibraryImagesStrict } from '../lib/importImageMatch'
import { requireAuth, type SessionUser } from '../lib/auth'
import { hasPermission, getPermissionTier, getActionTier, getMergedPermissions, isAdminControlUser } from '../lib/permissions'
import { normalizeCatalogText, hasSuspiciousCatalogText } from '../lib/catalogText'
import { getMediaType, buildUniqueStoredName, sanitizeOriginalFileName } from '../lib/fileAssets'
import { sanitizeMediaList } from '../lib/media'
import { buildInClause, chunkForBinding, selectInChunks } from '../lib/sqlBinding'
import { attachBeforeQty, buildStockLedgerQuery, type StockLedgerView } from '../lib/stockLedgerQuery'
import { buildStockInSessionListQuery, parseStockInSessionKey, stockInSessionLineParams, stockInSessionLinesSql } from '../lib/stockInSessionsQuery'
import { getProductSalesBreakdown } from '../lib/salesAnalytics'
import { localDateExpr, localMonthExpr } from '../lib/businessDateWindow'
import { validateUploadedBuffer } from '../lib/uploadSecurity'
import { checkRateLimit, getClientIp } from '../lib/rateLimit'
import { audit } from '../lib/audit'
import { findDuplicateProductGroups, findPossiblySameProductClusters, identityBarcodeKey, normalizeProductClusterKey, pickSameIdentityRow, resolveProductIdentityEdit } from '../lib/productIdentity'
import { compareCosts, normalizeProductGroupName, resolveMergedCostDetail, resolveMergedPricing } from '../lib/productDetailRule'
import type { CostVerdict, MergedCostOutlier } from '../lib/productDetailRule'
import { registerMergeFold, recordMergeUndoSnapshot, recordBulkMergeUndoSnapshot, recordSupplierBackfillSnapshot, MERGE_REPARENT_TABLES, type MergeReversal, type MergeStockDisposition } from '../lib/undoAppliers'
import { attachBatchCounts } from '../lib/productBatches'
import { maybeQueueForReview } from '../lib/reviewGate'
import { assertUpdatedAtMatch, getExpectedUpdatedAt, writeConflictResponse, WriteConflictError } from '../lib/conflictControl'
import { broadcast } from '../durable-objects/broadcastHub'
import { createBulkDeleteJob, getBulkDeleteJob, reapStalledBulkDeleteJobs } from '../lib/bulkDeleteEngine'
import { ADMIN_MAX_IMAGES_PER_PRODUCT, MAX_IMAGES_PER_PRODUCT } from '../lib/importImageMatch'
import { loadActivePromotionRules, productPromotedSql, productDiscountActiveSql, anyRuleAppliesSql, singleRuleAppliesSql } from '../lib/promotionRulesSql'
import {
  computeRenameImpact,
  applyRenameCarry,
  removeLiveLookupValue,
  buildLiveLookupMutationPlan,
  buildBrandLibraryMutationPlan,
  type RenameKind,
} from '../lib/renameCascade'
import {
  buildIssueStateClauses,
} from '../lib/searchMatch'
import { buildFamilyRelevanceOrderSql, buildProductSearchQuery } from '../lib/productSearchQuery'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()

async function syncLinkedProductNameSnapshots(env: Env, productIds: number[], productName: string): Promise<void> {
  if (!productIds.length) return
  const db = getDb(env)
  for (const ids of chunkForBinding([...new Set(productIds)], 1)) {
    const placeholders = ids.map(() => '?').join(',')
    // Update only rows carrying a stable product id. Name-only/null-id rows
    // remain untouched so ambiguous legacy conflicts stay visible for review.
    await db.batch([
      { sql: `UPDATE sale_items SET product_name = ? WHERE product_id IN (${placeholders})`, params: [productName, ...ids] },
      { sql: `UPDATE inventory_movements SET product_name = ? WHERE product_id IN (${placeholders})`, params: [productName, ...ids] },
      { sql: `UPDATE return_items SET product_name = ? WHERE product_id IN (${placeholders})`, params: [productName, ...ids] },
      { sql: `UPDATE stock_transfers SET product_name = ? WHERE product_id IN (${placeholders})`, params: [productName, ...ids] },
      { sql: `UPDATE damaged_stock_lots SET product_name = ? WHERE product_id IN (${placeholders})`, params: [productName, ...ids] },
      { sql: `UPDATE return_replacement_items SET product_name = ? WHERE product_id IN (${placeholders})`, params: [productName, ...ids] },
      { sql: `UPDATE stock_row_moves SET source_product_name = ? WHERE source_product_id IN (${placeholders})`, params: [productName, ...ids] },
      { sql: `UPDATE stock_row_moves SET destination_product_name = ? WHERE destination_product_id IN (${placeholders})`, params: [productName, ...ids] },
    ])
  }
}
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

// POS deliberately asks the first catalog bootstrap for products + branches
// only, then loads the heavier faceted filter vocabulary after the route is
// interactive.  Keep the default metadata-on contract for older callers,
// while making `metadata=0` an actual server-side query gate (previously the
// parameter was sent by POS but ignored here, so the bootstrap still ran six
// facet GROUP BY queries plus a second promotion-rule read, then POS fetched
// the same facets again from /filters).
export function shouldLoadProductBootstrapMetadata(raw: unknown): boolean {
  return String(raw ?? '').trim() !== '0'
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
  // `search` is listed alongside query/q because buildSearchFilters now
  // honors it as a third alias (see its own comment there) -- if it were
  // left in, this facet-metadata call would silently start narrowing by a
  // free-text term again, the exact staleness this strip exists to prevent.
  const { query: _searchTerm, q: _searchTermAlt, search: _searchTermAlias, ...structuralQuery } = query
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
    db.prepare(`SELECT MIN(trim(p.brand)) AS value FROM products p ${joinSql(variants.brands)} ${sql(variants.brands)} AND trim(COALESCE(p.brand, '')) <> '' GROUP BY lower(trim(p.brand)) ORDER BY lower(value) ASC`).all<{ value: string }>(variants.brands.params),
    db.prepare(`SELECT MIN(trim(p.category)) AS value FROM products p ${joinSql(variants.categories)} ${sql(variants.categories)} AND trim(COALESCE(p.category, '')) <> '' GROUP BY lower(trim(p.category)) ORDER BY lower(value) ASC`).all<{ value: string }>(variants.categories.params),
    db.prepare(`SELECT MIN(trim(p.unit)) AS value FROM products p ${joinSql(variants.units)} ${sql(variants.units)} AND trim(COALESCE(p.unit, '')) <> '' GROUP BY lower(trim(p.unit)) ORDER BY lower(value) ASC`).all<{ value: string }>(variants.units.params),
    db.prepare(`SELECT MIN(trim(p.supplier)) AS value FROM products p ${joinSql(variants.suppliers)} ${sql(variants.suppliers)} AND trim(COALESCE(p.supplier, '')) <> '' GROUP BY lower(trim(p.supplier)) ORDER BY lower(value) ASC`).all<{ value: string }>(variants.suppliers.params),
    db.prepare(`SELECT MIN(trim(p.tag_label)) AS value FROM products p ${joinSql(variants.tags)} ${sql(variants.tags)} AND trim(COALESCE(p.tag_label, '')) <> '' GROUP BY lower(trim(p.tag_label)) ORDER BY lower(value) ASC`).all<{ value: string }>(variants.tags.params),
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
  // G1's "by promotion" filter needs the live rule list as a facet
  // vocabulary (id + title), same role the other facet lists play.
  const activeRules = await loadActivePromotionRules(db)
  return {
    brands: values(brands),
    categories: values(categories),
    units: values(units),
    suppliers: values(suppliers),
    tags: values(tags),
    promotions: activeRules.map((rule) => ({ id: rule.id, title: rule.title || `#${rule.id}`, rule_type: rule.rule_type })),
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
             -- special_price_* is deliberately no longer selected: migration
             -- 0111 zeroed it and the wholesale pair below now carries those
             -- numbers. Shipping a dead all-zero column to every client just
             -- invites something to read it back as a real price.
             p.wholesale_price_usd, p.wholesale_price_khr,
             p.cost_price_usd, p.cost_price_khr, p.stock_quantity, p.low_stock_threshold,
             p.out_of_stock_threshold, p.image_path, p.is_active, p.supplier, p.parent_id,
             p.is_group, p.discount_enabled, p.discount_type, p.discount_percent,
             p.discount_amount_usd, p.discount_amount_khr, p.discount_label,
             p.discount_badge_color, p.discount_starts_at, p.discount_ends_at,
             p.expiry_date, p.expiry_alert_days, p.created_at, p.updated_at,
           COALESCE(p.auto_merged_count, 0) AS auto_merged_count
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

  // Siblings are SPLICED IN beside the row they belong to, not appended to
  // the end of the page. Appending was the original shape and it quietly
  // undid this page's relevance ordering for every flat-list picker
  // (Stock change, Returns' replacement search, Fast stock-in, Promotions
  // all render this array in order): the top hit's own sibling variants
  // came back detached from it, at the bottom of the list, under whatever
  // lower-ranked products happened to sit between. That reads exactly like
  // "the likely result was at bottom". Grouped surfaces re-collect them by
  // name anyway, so nothing regresses there -- this only fixes the flat
  // ones, and the ranked head of the list is unchanged either way.
  const nameKeyOf = (row: Record<string, unknown>) => String(row.name || '').trim().replace(/\s+/g, ' ').toLowerCase()
  const extrasByName = new Map<string, Array<Record<string, unknown>>>()
  for (const extra of extras) {
    const key = nameKeyOf(extra)
    if (!extrasByName.has(key)) extrasByName.set(key, [])
    extrasByName.get(key)?.push(extra)
  }
  const merged: Array<Record<string, unknown>> = []
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    merged.push(item)
    const key = nameKeyOf(item)
    // Flush after the LAST consecutive row of this name, so a family that
    // already has several matched rows on the page stays contiguous.
    if (!key || nameKeyOf(items[index + 1] || {}) === key) continue
    const pending = extrasByName.get(key)
    if (pending) {
      merged.push(...pending)
      extrasByName.delete(key)
    }
  }
  // Any sibling whose name never matched a row on the page (can't happen
  // via the query above, but never silently drop a row this function went
  // and fetched) keeps the old append behavior.
  for (const pending of extrasByName.values()) merged.push(...pending)
  return merged
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
  const { where, joins, params, matchRankSql, matchTierSql, hasSearchTerm } = filters

  // G1: promoted/discounted products occupy the block ABOVE the
  // alphabetical run (Products page and POS both read this endpoint, so
  // one ordering rule serves both). Which rules are live is decided by the
  // shared kernel (lib/promotionRules.ts); their scope + the per-product
  // discount condition are expressed in SQL so the ordering and the promo
  // filters hold across server-side pagination, not just the loaded page.
  const promotionRules = await loadActivePromotionRules(db)
  const promotedRankSql = `CASE WHEN ${productPromotedSql(promotionRules, params)} THEN 1 ELSE 0 END`
  const promoFilter = String(query.promo || '').trim().toLowerCase()
  if (promoFilter === 'promoted') {
    where.push(productPromotedSql(promotionRules, params))
  } else if (promoFilter === 'discounted') {
    where.push(productDiscountActiveSql(params))
  } else if (promoFilter === 'rules') {
    where.push(anyRuleAppliesSql(promotionRules, params))
  } else if (/^rule:\d+$/.test(promoFilter) || /^\d+$/.test(promoFilter)) {
    where.push(singleRuleAppliesSql(promotionRules, Number(promoFilter.replace('rule:', '')), params))
  }
  // 9.2 (Part 421): the auto-merged facet -- products that absorbed
  // in-file import merges (auto_merged_count, migration 0076), so "what
  // merged automatically" is one click, not archaeology.
  const mergedFilter = String(query.merged || '').trim().toLowerCase()
  if (mergedFilter === 'auto') {
    where.push('COALESCE(p.auto_merged_count, 0) > 0')
  }
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
  // promoted families lead (G1's ordering rule) and the plain name/
  // created-date order applies within each block. During a search,
  // relevance stays primary -- someone typing a specific product's name
  // must not find it buried under unrelated promoted items -- with
  // promoted matches TOP the result set (G1b refinement: "relevance
  // still wins but if relevance also have discounts, discounts top" --
  // relevance decides WHAT matches at all, discounted matches lead, and
  // relevance orders within each block).
  //
  // Refinement (this lane): `family_promoted DESC` used to be the FIRST
  // key, above relevance entirely. Because bm25 is continuous, that made
  // "promoted" the de-facto primary sort of every search -- a discounted
  // product that merely shared a word with the query outranked the exact
  // product the operator typed or scanned, which is the reported "it shows
  // products not really matched, top to bottom". The promoted key now sits
  // BETWEEN the relevance tier and the bm25 rank (buildFamilyRelevanceOrderSql):
  // an exact barcode/name/prefix match always leads, and G1b still holds
  // where it was actually meant to -- among equally relevant matches,
  // discounted ones top. When nothing in the result set is an exact or
  // prefix match (every family lands in the same tier 3) the order is
  // byte-identical to before.
  const effectiveFamilyOrderSql = buildFamilyRelevanceOrderSql(familyOrderSql, {
    hasTier: Boolean(matchTierSql),
    hasRank: Boolean(matchRankSql),
    promotedFirst: true,
  })

  const selectColumns = `p.id, p.name, p.sku, p.barcode, p.category, p.brand, p.unit, p.description,
           p.selling_price_usd, p.selling_price_khr,
           p.wholesale_price_usd, p.wholesale_price_khr,
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
    matchTierSql,
    promotedRankSql,
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
    // The active rule set rides every product payload so POS/Products can
    // evaluate the SAME kernel client-side (badges, cart pricing) without
    // a second fetch -- and inherit it offline with the cached response.
    promotion_rules: promotionRules,
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

  // `ids` is the by-id lookup the client transport has always sent
  // (frontend/src/api/productReadTransport.ts -> getProductsByIds, e.g.
  // `?ids=7231&pageSize=1&include=...`), and this endpoint never read it.
  // The silent-drop consequence is not "an unfiltered list" here, it is the
  // WRONG RECORD: the caller asks for one id, takes items[0], and gets the
  // catalog's first row by the default name order instead. Reported live
  // 2026-09-03 -- opening Adjust Stock on "Dior Backstage Highlighter New
  // 002" (id 7231) loaded and would have written against "Abercrombie
  // Authantic 10ml" (id 1). Verified against a production snapshot:
  // `?ids=7231&pageSize=1` answered total 10212, items[0] = id 1.
  // The same silent drop also fed Products' undo/redo snapshots and the
  // brand/category/unit lookup snapshots.
  // A present-but-unusable `ids` resolves to "no rows", never "everything":
  // returning the whole catalog to a by-id lookup is exactly the failure
  // being fixed.
  // Not every unread param is a bug: `include` is also never parsed here, and
  // that is deliberate and harmless -- attachBranchStock/attachImageGallery/
  // attachBatchCounts run unconditionally for every product read, and the
  // Products page, POS and the branch stock column all depend on that data
  // arriving whether or not they asked for it. Do NOT "tidy" `include` into a
  // gate; it would silently strip fields those surfaces render.
  const rawIdFilter = query.ids ?? query.id
  if (rawIdFilter != null && String(rawIdFilter).trim() !== '') {
    const requestedIds = [...new Set(
      String(rawIdFilter)
        .split(',')
        .map((raw) => String(raw).trim())
        // Whole-token digits only. Number.parseInt is lenient and stops at
        // the first non-digit, so a malformed '1.5.2' would parse to 1 --
        // resolving a bad id to a DIFFERENT VALID PRODUCT, which is the
        // wrong-record failure this filter exists to prevent. A token that
        // is not an id must fall through to the 1 = 0 branch below.
        .filter((raw) => /^\d+$/.test(raw))
        .map((raw) => Number.parseInt(raw, 10))
        .filter((id) => Number.isSafeInteger(id) && id > 0),
    )].slice(0, 100)
    if (!requestedIds.length) where.push('1 = 0')
    else {
      const placeholders = requestedIds.map((id, index) => {
        params[`byId${index}`] = id
        return `@byId${index}`
      })
      where.push(`p.id IN (${placeholders.join(', ')})`)
    }
  }

  // `search` accepted as a third alias alongside query/q. A caller that
  // spells the term with a synonym used to get the WHOLE unfiltered catalog
  // back with a 200 -- a silent drop, not an error -- which is precisely how
  // the Change-stock picker shipped a search box that ignored what was typed
  // or scanned into it (StockAdjustModal.tsx sent `search=`; verified live
  // against a production snapshot: `?search=3348901770569` returned total
  // 10212, `?query=3348901770569` returned total 3). The client transport
  // now canonicalizes the key (frontend/src/api/productReadTransport.ts);
  // this accepts it server-side too so the contract is forgiving on both
  // ends rather than only where this codebase happens to route through.
  // NOTE: /filters strips all three aliases -- see its own comment.
  const rawSearchText = String(query.query || query.q || query.search || '')
  // The WHOLE search tail -- FTS5 MATCH, both trigram tables, the hybrid/
  // short-word/partial-word fallbacks, the exact-barcode equality probe,
  // the bm25 relevance rank and the discrete relevance TIER -- now comes
  // from lib/productSearchQuery.ts, which is the single implementation
  // every product picker in the app shares (Products, POS, Inventory,
  // Stock change, Fast stock-in, Returns' replacement picker, Promotions,
  // and -- via routes/branches.ts -- Transfer and the per-branch search).
  // This file used to carry its own ~90-line copy, and routes/inventory.ts
  // and routes/branches.ts each carried theirs; branches.ts's copy had
  // drifted into computing no bm25 rank at all, so the Transfer picker
  // ordered every name search alphabetically. See that module's header for
  // the ordering contract and why the tier is separate from the rank.
  const searchQuery = buildProductSearchQuery(rawSearchText, params, {
    mode: query.searchMode,
    titleOnly: ['name', 'title'].includes(String(query.searchFields || query.search_fields || '').toLowerCase()),
    useSearchIndex: options.useSearchIndex !== false,
  })
  const { matchRankSql, matchTierSql, titleOnly, hasSearchTerm } = searchQuery
  const searchWhereClause = searchQuery.whereClause

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

  return { where, joins, params, stockExpr, matchRankSql, matchTierSql, titleOnly, hasSearchTerm }
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

  const version = await getVersionWithFallback(c.env, 'products')
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
  const includeFilterMetadata = shouldLoadProductBootstrapMetadata(query.metadata)
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
    includeFilterMetadata ? loadProductFilters(c.env, query) : Promise.resolve(null),
    // POS only consumes these four fields. Keeping this bootstrap projection
    // narrow avoids shipping location/phone/manager/notes/timestamps on every
    // first catalog window.
    db.prepare('SELECT id, name, is_default, is_active FROM branches WHERE is_active = 1 ORDER BY is_default DESC, id ASC').all(),
  ])
  const restrictedProducts = isImageOnlyRead(user, surface) ? restrictListPayloadForImageOnly(products as { items?: unknown }, user) : products
  return c.json({
    ...restrictedProducts,
    ...(filters ? { filters, initials: filters.initials } : {}),
    branches: branchRows,
  })
})

// GET /filters is the catalog's facet vocabulary (categories, brands, suppliers,
// units, initials). It was the one product read with no permission check at
// all, so any signed-in account -- a user with no products/pos/inventory grant
// -- could enumerate the catalog's supplier and brand lists. Callers do not all
// send `surface` (POS and the promotion rule editor omit it), so the gate is
// "may read the catalog on ANY surface", not the caller's declared one.
function catalogVocabularyDenialReason(user: SessionUser): string | null {
  const surfaces: ProductReadSurface[] = ['products', 'pos', 'inventory']
  if (surfaces.some((surface) => productSurfaceDenialReason(user, surface) === null)) return null
  if (getPermissionTier(user, 'promotions') !== 'none') return null
  return 'You do not have permission to view the product catalog'
}

app.get('/filters', async (c) => {
  const denial = catalogVocabularyDenialReason(c.get('user'))
  if (denial) return c.json({ error: denial }, 403)
  return c.json(await loadProductFilters(c.env, c.req.query()))
})

// D4 (Part 578, item 4): a lot's supplier IDENTITY, resolving a name-only lot
// (supplier_id NULL) to the suppliers row its recorded name matches -- the same
// match-only rule D5a applied at receive time, and stockLedgerQuery.ts:112 uses
// when filtering by a supplier. Without this resolution one real supplier splits
// on the detail report into an 'id:5' group (id-attributed lots) and a
// 'name:acme' group (name-only lots that never got linked), double-counting the
// supplier. Resolving name -> id at read time collapses both into one 'id:5'
// group. ORDER BY id keeps the pick deterministic if two rows ever share a name;
// a name with no supplier match falls through to the legacy 'name:' key so an
// unlinked supplier still shows as its own row (not silently merged into another).
const RESOLVED_SUPPLIER_ID_SQL =
  `COALESCE(pb.supplier_id, (SELECT s.id FROM suppliers s WHERE lower(trim(s.name)) = lower(trim(pb.supplier_name)) ORDER BY s.id LIMIT 1))`
const SUPPLIER_KEY_SQL =
  `COALESCE('id:' || (${RESOLVED_SUPPLIER_ID_SQL}), 'name:' || lower(trim(pb.supplier_name)))`

// D3 (Part 422): the product detail page's report read -- per-supplier
// totals from batch attribution plus the sales breakdown (kernel). One
// round trip for the detail modal's Suppliers and Sales sections; the
// Batches section keeps using the existing /batches read and the
// movements section the /stock-ledger read.
app.get('/:id/detail-report', async (c) => {
  const user = c.get('user')
  const allowed = getPermissionTier(user, 'products') !== 'none'
    || getPermissionTier(user, 'inventory') !== 'none'
  if (!allowed) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const productId = Number(c.req.param('id')) || 0
  if (!productId) return c.json({ error: 'Product not found' }, 404)
  const query = c.req.query()
  const today = new Date().toISOString().slice(0, 10)
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(query.startDate || '')) ? String(query.startDate) : '2000-01-01'
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(String(query.endDate || '')) ? String(query.endDate) : today

  const db = getDb(c.env)
  // Distinct suppliers this product was bought from, with per-supplier lot
  // and quantity totals. Same identity rule the D1b supplier report uses:
  // id-attributed and name-only lots of one supplier merge into ONE group
  // (key = supplier_id when present, else the lowercased name). Costs sum
  // only where recorded; lots_without_cost says the rest -- never a
  // fabricated zero total presented as complete.
  const suppliers = await db.prepare(`
    SELECT
      ${SUPPLIER_KEY_SQL} AS supplier_key,
      MAX(${RESOLVED_SUPPLIER_ID_SQL}) AS supplier_id,
      COALESCE(MAX(CASE WHEN pb.supplier_id IS NOT NULL THEN pb.supplier_name END), MAX(pb.supplier_name)) AS supplier_name,
      COUNT(*) AS lot_count,
      COALESCE(SUM(bbs.qty), 0) AS current_qty,
      SUM(CASE WHEN pb.unit_cost_usd IS NOT NULL THEN 1 ELSE 0 END) AS lots_with_cost,
      SUM(CASE WHEN pb.unit_cost_usd IS NULL THEN 1 ELSE 0 END) AS lots_without_cost,
      MIN(pb.received_at) AS first_received_at,
      MAX(pb.received_at) AS last_received_at
    FROM product_batches pb
    LEFT JOIN (
      SELECT batch_id, SUM(quantity) AS qty FROM branch_batch_stock GROUP BY batch_id
    ) bbs ON bbs.batch_id = pb.id
    WHERE pb.variant_product_id = @productId
      AND pb.is_active = 1
      AND (pb.supplier_id IS NOT NULL OR trim(COALESCE(pb.supplier_name, '')) <> '')
    GROUP BY supplier_key
    ORDER BY last_received_at DESC
  `).all<Record<string, unknown>>({ productId })

  // Per-lot summary with the TOTAL quantity across branches -- the
  // detail page's batch card wants "this product's lots", not one
  // branch's slice (the §14 ManageBatchesModal stays the per-branch
  // editor). Synthetic day-added lots are included: they carry the
  // received date history for products that predate real lots.
  const batches = await db.prepare(`
    SELECT pb.id, pb.lot_code, pb.batch_number, pb.received_at, pb.expiry_date,
           pb.supplier_id, pb.supplier_name, pb.unit_cost_usd,
           COALESCE(bbs.qty, 0) AS total_qty
    FROM product_batches pb
    LEFT JOIN (
      SELECT batch_id, SUM(quantity) AS qty FROM branch_batch_stock GROUP BY batch_id
    ) bbs ON bbs.batch_id = pb.id
    WHERE pb.variant_product_id = @productId AND pb.is_active = 1
    ORDER BY pb.received_at DESC, pb.id DESC
    LIMIT 100
  `).all<Record<string, unknown>>({ productId })

  const sales = await getProductSalesBreakdown(c.env, productId, { startDate, endDate })

  return c.json({
    product_id: productId,
    batches: batches || [],
    suppliers: suppliers || [],
    sales,
    range: { startDate, endDate },
  })
})

// Drill-downs for the product detail report's Sales and Suppliers rows (user
// ask: each summary row opens the deeper detail in place). Same read gate as
// /detail-report above: a products OR inventory grant. Both are READ-ONLY and
// product-scoped, and their filters mirror /detail-report's own aggregates so
// the drilled numbers can never disagree with the row that opened them.
function canReadProductDetail(user: SessionUser): boolean {
  return getPermissionTier(user, 'products') !== 'none' || getPermissionTier(user, 'inventory') !== 'none'
}

// Individual sales of this product within ONE day or month (the period a row on
// the sales breakdown represents). Grouped one row per sale so the sum of qty
// equals the breakdown row's qty. Non-cancelled only, matching the aggregate's
// default (whereActiveSales in getProductSalesBreakdown).
app.get('/:id/sales-detail', async (c) => {
  const user = c.get('user')
  if (!canReadProductDetail(user)) return c.json({ error: 'You do not have permission to perform this action' }, 403)
  const productId = Number(c.req.param('id')) || 0
  if (!productId) return c.json({ error: 'Product not found' }, 404)
  const mode = c.req.query('mode') === 'month' ? 'month' : 'day'
  const period = String(c.req.query('period') || '').trim()
  const periodOk = mode === 'month' ? /^\d{4}-\d{2}$/.test(period) : /^\d{4}-\d{2}-\d{2}$/.test(period)
  if (!periodOk) return c.json({ error: 'A valid period is required' }, 400)
  // Local (UTC+7) period, matching getProductSalesBreakdown's local buckets so
  // the drill-down's @period key (a breakdown row's local day/month) resolves to
  // the same rows -- a UTC period here would mismatch on the local-day edges.
  const periodExpr = mode === 'month' ? localMonthExpr('s.created_at') : localDateExpr('s.created_at')
  const rows = await getDb(c.env).prepare(`
    SELECT s.id, s.receipt_number, s.created_at, s.customer_name,
           COALESCE(SUM(si.quantity), 0) AS qty,
           COALESCE(SUM(si.total_usd), 0) AS revenue_usd
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE si.product_id = @productId
      AND COALESCE(s.sale_status, 'completed') <> 'cancelled'
      AND ${periodExpr} = @period
    GROUP BY s.id
    ORDER BY s.created_at DESC
    LIMIT 200
  `).all<Record<string, unknown>>({ productId, period })
  return c.json({ period, mode, sales: rows || [] })
})

// The batches/lots ONE supplier delivered for this product. supplierKey is the
// same resolved key (SUPPLIER_KEY_SQL) the /detail-report supplier rows are
// grouped by -- a name-only lot resolves to its matching supplier's id -- so this
// returns exactly that group's lots, including the name-only lots that D4 folded
// into an id-attributed supplier row.
app.get('/:id/supplier-purchases', async (c) => {
  const user = c.get('user')
  if (!canReadProductDetail(user)) return c.json({ error: 'You do not have permission to perform this action' }, 403)
  const productId = Number(c.req.param('id')) || 0
  if (!productId) return c.json({ error: 'Product not found' }, 404)
  const supplierKey = String(c.req.query('supplierKey') || '').trim()
  if (!supplierKey) return c.json({ error: 'A supplier is required' }, 400)
  const rows = await getDb(c.env).prepare(`
    SELECT pb.id, pb.lot_code, pb.batch_number, pb.received_at, pb.expiry_date,
           pb.unit_cost_usd, pb.supplier_name,
           COALESCE(bbs.qty, 0) AS total_qty
    FROM product_batches pb
    LEFT JOIN (
      SELECT batch_id, SUM(quantity) AS qty FROM branch_batch_stock GROUP BY batch_id
    ) bbs ON bbs.batch_id = pb.id
    WHERE pb.variant_product_id = @productId
      AND pb.is_active = 1
      AND ${SUPPLIER_KEY_SQL} = @supplierKey
    ORDER BY pb.received_at DESC, pb.id DESC
    LIMIT 100
  `).all<Record<string, unknown>>({ productId, supplierKey })
  return c.json({ supplierKey, purchases: rows || [] })
})

// D5 (Part 578, item 3): attribute a supplier to this product's UNATTRIBUTED
// lots after the fact. Supplier attribution lives on the lot (0062); a lot whose
// name never matched a suppliers row at receive time keeps supplier_id NULL and
// "stays linkable later" -- this is that later linking. Only lots with
// supplier_id IS NULL are touched (never re-attributes an already-linked lot);
// when batchIds is given, the set is narrowed to those (still NULL-only). Fully
// undoable/redoable via the supplier.backfill applier -- the reversal (each
// lot's prior supplier_id/_name) goes to undo_snapshots, a small action_history
// row points at it. Gated by the products EDIT action (attributing a lot's
// supplier is a product edit), full tier -- the same tier the applier demands.
app.post('/:id/suppliers/backfill', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'products', 'edit') !== 'full') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const productId = Number(c.req.param('id')) || 0
  if (!productId) return c.json({ error: 'Product not found' }, 404)
  const body = await c.req.json().catch(() => ({})) as { supplierId?: unknown; batchIds?: unknown }
  const supplierId = Number(body.supplierId) || 0
  if (supplierId <= 0) return c.json({ error: 'A supplier is required' }, 400)
  const db = getDb(c.env)
  const supplier = await db.prepare('SELECT id, name FROM suppliers WHERE id = ?').get<{ id: number; name: string }>([supplierId])
  if (!supplier) return c.json({ error: 'Supplier not found' }, 404)

  // Optional narrowing to specific lots (still NULL-only below). Non-integer
  // entries are dropped; an explicitly empty list means "nothing selected".
  const rawIds = Array.isArray(body.batchIds) ? body.batchIds : null
  const wantIds = rawIds == null ? null : rawIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
  if (wantIds != null && wantIds.length === 0) {
    return c.json({ success: true, updated: 0, actionHistoryId: null })
  }
  const narrow = wantIds != null ? ` AND id IN (${wantIds.join(',')})` : ''

  // The lots this backfill will touch: this product's active, still-
  // unattributed lots (optionally narrowed to the chosen ids). Capture each
  // lot's prior attribution for the reversal.
  const targets = await db.prepare(
    `SELECT id, supplier_id, supplier_name FROM product_batches
     WHERE variant_product_id = @productId AND is_active = 1 AND supplier_id IS NULL${narrow}`,
  ).all<{ id: number; supplier_id: number | null; supplier_name: string | null }>({ productId })
  if (!targets.length) {
    return c.json({ success: true, updated: 0, actionHistoryId: null })
  }
  const ids = targets.map((t) => Number(t.id))
  await db.prepare(
    `UPDATE product_batches SET supplier_id = @supplierId, supplier_name = @name, updated_at = CURRENT_TIMESTAMP
     WHERE id IN (${ids.join(',')})`,
  ).run({ supplierId, name: supplier.name })

  const undoRecord = await recordSupplierBackfillSnapshot(c.env, user, {
    productId,
    supplierId,
    supplierName: supplier.name,
    lots: targets.map((t) => ({ id: Number(t.id), prevSupplierId: t.supplier_id == null ? null : Number(t.supplier_id), prevSupplierName: t.supplier_name ?? null })),
  })

  await audit(c.env, user?.id ?? null, user?.name ?? null, 'supplier_backfill', 'product', productId, { supplierId, lots: ids.length })
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'update' }))
  return c.json({ success: true, updated: ids.length, actionHistoryId: undoRecord?.actionHistoryId ?? null })
})

// D1 (Part 415): the Products page's Stock Change ledger -- one row per
// recorded action with a derived running balance. READ-ONLY over the
// EXISTING inventory_movements history; no new write path. Lives under
// /products (the page that hosts the section) but admits an inventory
// grant too, mirroring canAccessPage's door for the same reason:
// movement data is inventory-domain, the surface is the Products page.
// Query/classification semantics live in lib/stockLedgerQuery.ts (the
// kernel the pure test drives directly).
// Stock-in Sessions is the editable view of purchasing/receiving history.
// Grouping happens in D1, not by downloading an arbitrary first 1,000 rows:
// the 21k legacy receipts remain reachable and a multi-line session can never
// be split at a movement-page boundary. Lines load only when a group opens.
app.get('/stock-in-sessions', async (c) => {
  const user = c.get('user')
  const allowed = getPermissionTier(user, 'products') !== 'none' || getPermissionTier(user, 'inventory') !== 'none'
  if (!allowed) return c.json({ error: 'You do not have permission to perform this action' }, 403)
  const page = clampInt(c.req.query('page'), 1, 1, 100000)
  const pageSize = clampInt(c.req.query('pageSize'), 30, 1, 100)
  const { groupedSql, params } = buildStockInSessionListQuery(c.req.query('search'))
  const db = getDb(c.env)
  // The old page did the full legacy grouping twice at the same time: once
  // for COUNT(*) and once for the visible rows. That doubles the D1 work for
  // every normal visit and lets two expensive scans contend with unrelated
  // reads. A window count keeps the page and its total in one bounded query.
  // The rare stale/out-of-range page is the only case that needs a fallback
  // count because OFFSET can legitimately return no row from which to read it.
  const sessions = await db.prepare(`
    SELECT grouped.*, COUNT(*) OVER () AS total
    FROM (${groupedSql}) grouped
    ORDER BY created_at DESC, session_key DESC
    LIMIT @limit OFFSET @offset
  `).all<Record<string, unknown>>({ ...params, limit: pageSize, offset: (page - 1) * pageSize })
  const countRow = sessions.length || page <= 1
    ? null
    : await db.prepare(`SELECT COUNT(*) AS total FROM (${groupedSql}) grouped`).get<{ total: number }>(params)
  const total = sessions.length ? Number(sessions[0]?.total) || 0 : Number(countRow?.total) || 0
  return c.json({ sessions, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) })
})

app.get('/stock-in-session-lines', async (c) => {
  const user = c.get('user')
  const allowed = getPermissionTier(user, 'products') !== 'none' || getPermissionTier(user, 'inventory') !== 'none'
  if (!allowed) return c.json({ error: 'You do not have permission to perform this action' }, 403)
  const sessionKey = String(c.req.query('key') || '').trim()
  if (!sessionKey || sessionKey.length > 300) return c.json({ error: 'A valid stock-in session key is required' }, 400)
  const locator = parseStockInSessionKey(sessionKey)
  if (!locator) return c.json({ error: 'This stock-in session key is not supported. Refresh the sessions list and try again.' }, 400)
  const db = getDb(c.env)
  // This deliberately does not query on STOCK_IN_SESSION_KEY_SQL. The old
  // computed predicate scanned the entire ledger and then executed a
  // correlated receipt-count query for every candidate row, which is why one
  // legacy receipt click could exceed D1's CPU limit. The parsed key maps to
  // the indexes introduced in 0104 instead.
  let rows = await db.prepare(stockInSessionLinesSql(locator)).all<Record<string, unknown>>(stockInSessionLineParams(locator))
  const exceededLineLimit = rows.length > 2000
  const movementIds = rows.map((row) => Number(row.id)).filter((id) => Number.isSafeInteger(id) && id > 0)
  if (movementIds.length) {
    const reverted = new Set<string>()
    for (const chunk of chunkForBinding(movementIds)) {
      const refs = chunk.map((id) => `revert:${id}`)
      const clause = buildInClause('revert', refs)
      const found = await db.prepare(`SELECT reference_id FROM inventory_movements WHERE reference_id IN (${clause.sql})`).all<{ reference_id: string | number }>({ ...clause.params })
      for (const row of found) reverted.add(String(row.reference_id))
    }
    rows = rows.filter((row) => !reverted.has(`revert:${Number(row.id)}`))
  }

  // A shared lot makes a header edit unsafe: it could rewrite another receipt.
  // Count sessions by indexed batch ids in bounded chunks, separately from the
  // line lookup so it cannot turn the normal detail read into an N+1 scan.
  const batchIds = [...new Set(rows.map((row) => Number(row.batch_id)).filter((id) => Number.isSafeInteger(id) && id > 0))]
  const receiptCounts = new Map<number, number>()
  try {
    for (const chunk of chunkForBinding(batchIds)) {
      const clause = buildInClause('batch', chunk)
      const counts = await db.prepare(`
        SELECT m.batch_id,
               COUNT(DISTINCT CASE
                 WHEN m.reference_id IS NOT NULL AND CAST(m.reference_id AS TEXT) NOT LIKE 'revert:%'
                   THEN 'session:' || CAST(m.reference_id AS TEXT)
                 ELSE 'legacy:' || COALESCE(m.created_at, '') || ':' || COALESCE(CAST(m.user_id AS TEXT), '') || ':' ||
                      COALESCE(CAST(m.branch_id AS TEXT), '') || ':' ||
                      COALESCE(CAST(b.supplier_id AS TEXT), lower(trim(COALESCE(b.supplier_name, ''))))
               END) AS receipt_session_count
        FROM inventory_movements m
        JOIN product_batches b ON b.id = m.batch_id
        WHERE m.movement_type = 'add' AND m.batch_id IN (${clause.sql})
        GROUP BY m.batch_id
      `).all<{ batch_id: number; receipt_session_count: number }>({ ...clause.params })
      for (const row of counts) receiptCounts.set(Number(row.batch_id), Number(row.receipt_session_count) || 0)
    }
  } catch {
    // Keep the receipt readable if a historical lot is pathological. A value
    // greater than one is intentionally conservative: it disables the header
    // edit rather than risking an edit that spills into another receipt.
    for (const batchId of batchIds) receiptCounts.set(batchId, 2)
  }
  rows = rows.map((row) => ({ ...row, batch_receipt_session_count: receiptCounts.get(Number(row.batch_id)) ?? 0 }))
  const truncated = exceededLineLimit || rows.length > 2000
  return c.json({ rows: truncated ? rows.slice(0, 2000) : rows, truncated })
})

app.get('/stock-ledger', async (c) => {
  const user = c.get('user')
  // A REAL products or inventory tier is required. products_image_only on
  // its own never qualifies: that flag only exists for users whose
  // products tier is 'none' (see isImageOnlyRead above), so this check
  // already turns them away without naming the flag.
  const allowed = getPermissionTier(user, 'products') !== 'none'
    || getPermissionTier(user, 'inventory') !== 'none'
  if (!allowed) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const query = c.req.query()
  const page = Math.max(1, Number(query.page) || 1)
  // 1000-cap (was 100): the Stock Changes CSV export walks pages of this
  // endpoint for a chosen date range -- 10x fewer round trips per export,
  // still bounded. Interactive views keep asking for 25-100.
  const pageSize = Math.min(1000, Math.max(1, Number(query.pageSize) || 50))
  const ledger = buildStockLedgerQuery({
    view: String(query.view || 'all') as StockLedgerView,
    productId: Number(query.productId) || 0,
    branchId: Number(query.branchId) || 0,
    startDate: String(query.startDate || ''),
    endDate: String(query.endDate || ''),
    startTime: String(query.startTime || ''),
    endTime: String(query.endTime || ''),
    search: String(query.search || ''),
    supplierId: Number(query.supplierId) || 0,
  })

  const db = getDb(c.env)
  const countRow = await db.prepare(ledger.countSql).get<{ total: number }>(ledger.params)
  const total = Number(countRow?.total || 0)
  const rows = await db.prepare(ledger.rowsSql).all<Record<string, unknown>>({
    ...ledger.params,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  })
  // Part 553: In vs Out record counts + magnitude totals for the current
  // date/search/branch/supplier scope, computed over the base filters
  // (ignoring the view chip) so the split is always visible inline. This is
  // what replaced the old "Adjustments" bucket and the Stats expander.
  const summaryRow = await db.prepare(ledger.summarySql).get<{
    in_count: number; out_count: number; in_qty: number; out_qty: number; total: number
  }>(ledger.params)

  return c.json({
    items: attachBeforeQty(rows || []),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    view: ['all', 'in', 'out'].includes(String(query.view || '')) ? String(query.view) : 'all',
    summary: {
      inCount: Number(summaryRow?.in_count || 0),
      outCount: Number(summaryRow?.out_count || 0),
      inQty: Number(summaryRow?.in_qty || 0),
      outQty: Number(summaryRow?.out_qty || 0),
      total: Number(summaryRow?.total || 0),
    },
  })
})

// P3 (Part 387): whole-catalog price adjustment, run server-side as
// set-based UPDATEs -- the explicit "ALL products in the system" scope the
// bulk price modal offers next to its selection scope. Never materializes
// ids in the client; preview=true answers "how many rows would actually
// change" so the confirm can tell the truth. Full products access only
// (bulk edits are not a review-tier action), and there is deliberately NO
// undo at this scope -- the audit entry records the parameters and count,
// and the confirm says so before anything runs.
// Note the tier pair here is wholesale_*, not the old special_* (VIP): after
// the 2026-09-04 ruling and migration 0111, special_price_* is a zeroed dead
// column, so leaving it in this allow-list would have let a bulk price
// adjustment write real money into a column nothing reads -- silently doing
// nothing while reporting "changed N products".
const BULK_PRICE_FIELDS = new Set(['selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr', 'cost_price_usd', 'cost_price_khr'])
app.post('/bulk-price-adjust', async (c) => {
  const user = c.get('user')
  if (getPermissionTier(user, 'products') !== 'full') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const body = await c.req.json<{
    direction?: string
    amount?: number
    fields?: string[]
    skip_zero?: boolean
    preview?: boolean
  }>().catch(() => ({} as Record<string, never>))
  const direction = body.direction === 'decrease' ? 'decrease' : 'increase'
  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) return c.json({ error: 'Amount must be a positive number' }, 400)
  const fields = Array.isArray(body.fields) ? body.fields.filter((f) => BULK_PRICE_FIELDS.has(String(f))) : []
  if (!fields.length) return c.json({ error: 'Pick at least one price field to adjust' }, 400)
  const skipZero = Boolean(body.skip_zero)
  const delta = direction === 'decrease' ? -amount : amount
  const db = getDb(c.env)

  // A row "changes" for a field when: decreasing -> the field is > 0 (a 0
  // price is never pushed negative, matching the selection flow's rule);
  // increasing -> always, unless skip_zero keeps 0-priced rows untouched.
  const fieldCondition = (field: string) => (direction === 'decrease' || skipZero)
    ? `COALESCE(${field}, 0) > 0`
    : '1=1'

  if (body.preview) {
    const where = fields.map((field) => `(${fieldCondition(field)})`).join(' OR ')
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM products WHERE is_active = 1 AND (${where})`).get<{ n: number }>()
    return c.json({ count: row?.n || 0 })
  }

  const statements = fields.map((field) => ({
    sql: `UPDATE products SET ${field} = MAX(0, ROUND(COALESCE(${field}, 0) + @delta, ${field.endsWith('_khr') ? 0 : 2})), updated_at = CURRENT_TIMESTAMP
          WHERE is_active = 1 AND (${fieldCondition(field)})`,
    params: { delta },
  }))
  const results = await db.batch(statements)
  const changed = Math.max(0, ...results.map((r) => Number((r as { changes?: number }).changes) || 0))
  await audit(c.env, user?.id ?? null, user?.name ?? null, 'update', 'product', 'bulk-price-adjust', {
    scope: 'all', direction, amount, fields, skipZero, rowsTouched: changed,
  })
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  await broadcast(c.env, 'products', { action: 'bulk-price-adjust' }).catch(() => {})
  return c.json({ success: true, changed })
})

// The ONE product identity rule's manual-path check: an ACTIVE product with
// the same normalized name, barcode AND cost is the SAME
// product (the import merges such rows — resolveMergedPricing and friends),
// so manual create/edit must refuse to mint a twin of it. A same-name row
// with a DIFFERENT or empty barcode is a legitimate child row and is never
// returned here.
// P7-b: a barcode that reads as scientific notation ("8.85107E+12") is an
// Excel General-format export artifact, never a real code -- the import
// planner already refuses these (barcode_scientific_notation), so the
// manual create/update doors refuse them too, with the same rule.
const SCIENTIFIC_NOTATION_BARCODE = /^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i
const scientificBarcodeError = (barcode: string) => ({
  error: `Barcode "${barcode}" looks like scientific notation (an Excel export artifact). Edit it or clear it -- it cannot be saved as-is.`,
  code: 'barcode_scientific_notation',
})

async function findSameProductIdentityProduct(
  env: Env,
  name: string,
  barcode: unknown,
  excludeId: number | null,
): Promise<{ id: number; name: string; barcode: string; cost_price_usd: number; cost_price_khr: number } | null> {
  const nameKey = normalizeProductGroupName(name)
  if (!nameKey) return null
  // Cost is NO LONGER part of this guard. It was, and that contradicted the
  // Sep-4 identity ruling head-on: the form happily minted a second row for
  // one article bought at a second price, which is the exact duplicate the
  // merge tool then had to clean up. The inflow is the fix; the merge is the
  // repair.
  //
  // The SQL narrows to the name group and nothing else; the barcode is
  // compared in JS through identityBarcodeKey, because folding leading zeros
  // in SQL would mean a THIRD hand-copy of the fold (searchMatch.ts already
  // carries the deliberately-looser search one) and this codebase has been
  // bitten by exactly that before.
  const rows = await getDb(env).prepare(`
    SELECT id, name, barcode, cost_price_usd, cost_price_khr FROM products
    WHERE is_active = 1
      AND LOWER(TRIM(REPLACE(REPLACE(REPLACE(name, '  ', ' '), '  ', ' '), '  ', ' '))) = @nameKey
      AND (@excludeId IS NULL OR id != @excludeId)
    ORDER BY id ASC
    LIMIT 200
  `).all<{ id: number; name: string; barcode: string; cost_price_usd: number; cost_price_khr: number }>({
    nameKey, excludeId,
  })
  return pickSameIdentityRow(rows, barcode)
}

app.post('/', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'products', 'add') === 'none') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const name = String(body.name || '').trim()
  if (!name) return c.json({ error: 'Product name is required' }, 400)
  const createBarcode = String(body.barcode ?? '').trim()
  if (SCIENTIFIC_NOTATION_BARCODE.test(createBarcode)) {
    return c.json(scientificBarcodeError(createBarcode), 400)
  }

  // The ONE product identity rule, enforced on the MANUAL path too (Aug 28:
  // "identity rules applied fully across all codepaths"): same name + same
  // barcode IS the same product — the import merges such rows, so manual
  // create must not mint a silent twin the import path would never allow.
  // Same name with a DIFFERENT (or no) barcode stays a legitimate child row
  // and passes through untouched. Checked before the review queue so a
  // reviewer is never asked to approve a duplicate either.
  const duplicate = await findSameProductIdentityProduct(c.env, name, body.barcode, null)
  if (duplicate) {
    return c.json({
      error: `"${duplicate.name}" already exists with this barcode — same name + barcode is the same product (a leading zero is not a different barcode). Edit it or add stock to it instead of creating a duplicate.`,
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

// D6: before -> after preview numbers for a rename, before anything
// writes. Same gate as the writes the preview leads to.
// 9.2 (Part 421): the auto-merge log for one product -- each row is one
// losing source row's ORIGINAL values (import_auto_merges), the evidence
// "the first row's details win" used to erase. Read-only; supplier/cost
// values may appear inside losing_json, so this stays behind the same
// products read gate as the rest of this router (never portal-exposed).
app.get('/auto-merges/:productId', async (c) => {
  // The header comment above promised this "stays behind the same products read
  // gate as the rest of this router" -- but no gate was ever applied, so every
  // authenticated account (a POS-only cashier, a products_image_only uploader)
  // could walk product ids and read supplier + cost_price out of losing_json.
  // Gate it like the sibling /detail-report: an internal products/inventory
  // reader only. products_image_only resolves to tier 'none' here, so it is
  // correctly excluded from the cost/supplier data.
  const user = c.get('user')
  if (getPermissionTier(user, 'products') === 'none' && getPermissionTier(user, 'inventory') === 'none') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const productId = Number(c.req.param('productId'))
  if (!Number.isInteger(productId) || productId <= 0) return c.json({ error: 'Invalid product id' }, 400)
  const rows = await getDb(c.env).prepare(`
    SELECT id, import_job_id, row_number, losing_json, created_at
    FROM import_auto_merges WHERE product_id = @productId
    ORDER BY id DESC LIMIT 500
  `).all<{ id: number; import_job_id: number | null; row_number: number | null; losing_json: string | null; created_at: string | null }>({ productId })
  return c.json({
    productId,
    merges: rows.map((row) => {
      let losing: unknown = null
      try { losing = row.losing_json ? JSON.parse(row.losing_json) : null } catch { losing = row.losing_json }
      return { id: row.id, import_job_id: row.import_job_id, row_number: row.row_number, losing, created_at: row.created_at }
    }),
  })
})

app.get('/rename-impact', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'products', 'edit') === 'none') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const kind = String(c.req.query('kind') || '') as RenameKind
  const from = String(c.req.query('from') || '').trim()
  const to = String(c.req.query('to') || '').trim()
  if (!['category', 'brand', 'supplier', 'product_name'].includes(kind)) return c.json({ error: 'Unknown rename kind' }, 400)
  if (!from || !to) return c.json({ error: 'from and to are required' }, 400)
  return c.json(await computeRenameImpact(getDb(c.env), kind, from, to))
})

// D6: brand has no lookup table -- a brand "rename" IS the cascade over
// the products that carry it (carry-only; "keep a copy" for a free-text
// value means simply typing the new brand on new products).
app.post('/rename-brand', async (c) => {
  const user = c.get('user')
  // A brand "rename" is a catalog-wide cascade over every product carrying it
  // -- that is lookup management, so it requires the same Full `manage_lookups`
  // grant as its sibling POST /lookups/replace, NOT merely `edit !== 'none'`.
  // The edit check let a Review Required products user through (edit -> 'review',
  // not 'none') and applied the rename immediately, bypassing the review queue
  // their ordinary PUT /:id edits go through. See permissionActions.ts and the
  // /lookups/replace gate below.
  if (getActionTier(user, 'products', 'manage_lookups') !== 'full') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const from = String(body.from || '').trim()
  const to = String(body.to || '').trim()
  if (!from || !to) return c.json({ error: 'from and to are required' }, 400)
  if (from.toLowerCase() === to.toLowerCase()) return c.json({ error: 'New brand name is the same' }, 400)
  const db = getDb(c.env)
  const changed = await buildLiveLookupMutationPlan(db, 'brand', [from, to], to, new Date().toISOString())
  const library = await buildBrandLibraryMutationPlan(db, [from, to], to)
  await db.batch([...changed.statements, ...library.statements])
  await audit(c.env, user?.id ?? null, user?.name ?? null, 'rename', 'brand', null, { from, to, products: changed.products })
  await Promise.all([bumpVersion(c.env, 'products'), bumpVersion(c.env, 'settings')])
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'rename-brand', from, to }))
  return c.json({ renamed: true, products: changed.products, batches: 0, brands: library.brands })
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

  // Optimistic-concurrency guard, the same one every other editable entity
  // enforces (contacts/sales/branches/notes/... via conflictControl). The
  // client (productWriteTransport.updateProduct) already sends an
  // expectedUpdatedAt on every edit; products were the sole entity whose
  // server handler discarded it (PRODUCT_SKIP_KEYS) and never checked it,
  // so two people editing the same product last-write-wins silently. Reject
  // a stale edit before the review-queue gate so it never even queues.
  // No-op when the client sends no token, so token-less/bulk writes are
  // unaffected; a missing row surfaces as a 'deleted' conflict.
  const expectedProductUpdatedAt = getExpectedUpdatedAt(body)
  if (expectedProductUpdatedAt) {
    const currentForConflict = await getDb(c.env)
      .prepare('SELECT updated_at FROM products WHERE id = @id')
      .get<{ updated_at: string | null }>({ id })
    try {
      assertUpdatedAtMatch('product', currentForConflict, expectedProductUpdatedAt)
    } catch (error) {
      if (error instanceof WriteConflictError) {
        const { body: conflictBody, status } = writeConflictResponse(error)
        return c.json(conflictBody, status)
      }
      throw error
    }
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
  // Only runs when the body actually MOVES the row's identity — an image-only,
  // price-only, cost-only or stock-only edit never reaches the query, and
  // neither does a full-form save that re-sends the name and barcode the row
  // already has.
  if (body.barcode !== undefined) {
    const nextBarcodeText = String(body.barcode ?? '').trim()
    if (SCIENTIFIC_NOTATION_BARCODE.test(nextBarcodeText)) {
      return c.json(scientificBarcodeError(nextBarcodeText), 400)
    }
  }
  let renamedProductIds: number[] = []
  let renamedProductName: string | null = null
  if (body.name !== undefined || body.barcode !== undefined) {
    const current = await getDb(c.env).prepare('SELECT name, barcode FROM products WHERE id = @id')
      .get<{ name: string; barcode: string | null }>({ id })
    // Ask whether this edit CHANGES the row's identity, not whether the row's
    // identity is shared. The editor (ProductForm/Products) posts the WHOLE
    // form on every save, so `body.name`/`body.barcode` are present even when
    // only the selling price or the image moved -- and for a pair that already
    // shares an identity (a leading-zero twin, or two rows the Sep-4 cost
    // ruling folded together) the unconditional lookup below is a permanent
    // yes, turning every ordinary save of either row into a 409 merge offer.
    // Worse, for a cost-outlier pair the merge tool refuses too ("correct
    // whichever figure is wrong, then merge") -- so the two refusals deadlock
    // and the operator cannot correct the figure the merge is waiting for.
    // Cost is not identity (Sep 4), so a cost-only change can never move this
    // key and no longer reaches this block at all.
    const { nextName, nextBarcode, changesIdentity } = resolveProductIdentityEdit(current, body)
    if (changesIdentity) {
      const duplicate = await findSameProductIdentityProduct(c.env, nextName, nextBarcode, Number(id))
      if (duplicate) {
        return c.json({
          error: `"${duplicate.name}" already exists with this barcode — same name + barcode is the same product (a leading zero is not a different barcode). Merge into it instead of creating a twin.`,
          code: 'duplicate_product',
          duplicate,
        }, 409)
      }
    }
    // D6 / 9.1 ("rename does not regroup"): when the operator chose to
    // carry the WHOLE name group to the new name, rename the siblings
    // first -- the ordinary row update below then writes this row like
    // any other edit. Only-this-row (the old behavior, a deliberate
    // split) is the default when the flag is absent.
    const isNameChange = body.name !== undefined
      && Boolean(current?.name)
      && String(current?.name || '') !== nextName
    if (isNameChange) {
      renamedProductName = nextName
      if (body.__rename_scope === 'group') {
        const groupRows = await getDb(c.env)
          .prepare('SELECT id FROM products WHERE name_key = @nameKey AND is_active = 1')
          .all<{ id: number }>({ nameKey: String(current?.name || '').trim().toLowerCase() })
        renamedProductIds = groupRows.map((row) => Number(row.id)).filter(Number.isFinite)
      } else {
        renamedProductIds = [Number(id)].filter(Number.isFinite)
      }
    }
    if (body.__rename_scope === 'group' && body.name !== undefined && current?.name) {
      const fromName = String(current.name || '').trim()
      if (fromName && fromName.toLowerCase() !== nextName.toLowerCase()) {
        const carried = await applyRenameCarry(getDb(c.env), 'product_name', fromName, nextName, new Date().toISOString())
        await audit(c.env, user?.id ?? null, user?.name ?? null, 'rename', 'product_group', id, { from: fromName, to: nextName, rows: carried.products })
      }
    }
    delete body.__rename_scope
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
  if (renamedProductName && renamedProductIds.length) {
    await syncLinkedProductNameSnapshots(c.env, renamedProductIds, renamedProductName)
  }
  if ('image_gallery' in body) {
    // validateImageGalleryPayload already proved this is either inside the
    // caller's limit or a preservation-only edit of an existing admin
    // gallery, so the writer may retain all five stored positions.
    const gallery = await syncProductImageGallery(c.env, id, body.image_gallery, ADMIN_MAX_IMAGES_PER_PRODUCT)
    ;(item as Record<string, unknown>).image_gallery = gallery
  }
  await bumpVersion(c.env, 'products')
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
// cost + barcode; selling price is mergeable), and for every group folds every
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

// What the row about to be discarded still holds, per branch and per lot.
// Read BEFORE any decision so the reviewer sees the actual numbers -- "3 pcs in
// Shop across 2 lots" -- rather than agreeing to something described in the
// abstract, and read again server-side so the guard below cannot be talked out
// of firing by a stale client.
export type MergeStockImpact = {
  productId: number
  totalQuantity: number
  lotCount: number
  branches: Array<{ branchId: number; branchName: string | null; quantity: number; lotCount: number }>
}

export async function readMergeStockImpact(
  db: ReturnType<typeof getDb>,
  productId: number,
  branchNameById: Map<number, string>,
): Promise<MergeStockImpact> {
  const [stockRows, lotRows] = await Promise.all([
    db.prepare('SELECT branch_id, quantity FROM branch_stock WHERE product_id = @id')
      .all<{ branch_id: number; quantity: number }>({ id: productId }),
    db.prepare(`SELECT bbs.branch_id AS branch_id, COUNT(*) AS lots
                FROM branch_batch_stock bbs
                JOIN product_batches pb ON pb.id = bbs.batch_id
                WHERE pb.variant_product_id = @id AND bbs.quantity != 0
                GROUP BY bbs.branch_id`)
      .all<{ branch_id: number; lots: number }>({ id: productId }),
  ])
  const lotsByBranch = new Map<number, number>(lotRows.map((r) => [Number(r.branch_id), Number(r.lots) || 0]))
  const branchIds = new Set<number>([...stockRows.map((r) => Number(r.branch_id)), ...lotsByBranch.keys()])
  const qtyByBranch = new Map<number, number>(stockRows.map((r) => [Number(r.branch_id), Number(r.quantity) || 0]))
  const branches = [...branchIds]
    .map((branchId) => ({
      branchId,
      branchName: branchNameById.get(branchId) ?? null,
      quantity: qtyByBranch.get(branchId) || 0,
      lotCount: lotsByBranch.get(branchId) || 0,
    }))
    // A branch with neither stock nor a live lot is not worth a dialog row.
    .filter((b) => b.quantity !== 0 || b.lotCount > 0)
    .sort((a, b) => a.branchId - b.branchId)
  return {
    productId,
    totalQuantity: branches.reduce((sum, b) => sum + b.quantity, 0),
    lotCount: branches.reduce((sum, b) => sum + b.lotCount, 0),
    branches,
  }
}

// The OTHER thing a merge silently changes: foldDuplicateProductInto carries
// the HIGHER of the two rows' selling and WHOLESALE prices onto the keeper
// (resolveMergedPricing), so resolving a twin pair can quietly raise the price
// the shop rings up. That is a defensible rule -- it is not a defensible
// surprise, so the reviewer is shown it before they confirm, and the audit
// entry records it after. Fields that do not move are not reported.
//
// This list named special_price_usd/khr until 2026-09-06. Migration 0111 moved
// the discounted tier to wholesale_price_* and ZEROED the old pair, so the
// preview was wrong twice over one constant: it SELECTed columns that are 0 on
// every row, and it reported over a list that could never contain a change.
// The fold had already been repointed at wholesale_* and moves it for real, so
// the one price change a merge can actually make was the one change the
// preview could never show -- and with no stock and equal selling prices, the
// client's confirm dialog was skipped entirely.
export type MergePricingChange = {
  before: Record<string, number>
  after: Record<string, number>
  changes: Array<{ field: string; from: number; to: number }>
}

const MERGE_PRICE_FIELDS = ['selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr'] as const

export async function readMergePricingChange(
  db: ReturnType<typeof getDb>,
  keeperId: number,
  dupId: number,
): Promise<MergePricingChange> {
  const columns = MERGE_PRICE_FIELDS.join(', ')
  const [keeperRow, dupRow] = await Promise.all([
    db.prepare(`SELECT ${columns} FROM products WHERE id = @id`).get<Record<string, number | null>>({ id: keeperId }),
    db.prepare(`SELECT ${columns} FROM products WHERE id = @id`).get<Record<string, number | null>>({ id: dupId }),
  ])
  const merged = resolveMergedPricing([keeperRow || {}, dupRow || {}]) as Record<string, number | null | undefined>
  const before: Record<string, number> = {}
  const after: Record<string, number> = {}
  const changes: Array<{ field: string; from: number; to: number }> = []
  for (const field of MERGE_PRICE_FIELDS) {
    const from = Number(keeperRow?.[field]) || 0
    // Same fallback chain the fold writes, so the preview cannot promise a
    // price the fold would not actually set.
    const to = Number(merged[field] ?? keeperRow?.[field] ?? 0) || 0
    before[field] = from
    after[field] = to
    if (Math.round(from * 100) !== Math.round(to * 100)) changes.push({ field, from, to })
  }
  return { before, after, changes }
}

// True when discarding this row would destroy or move something real, i.e. when
// the operator MUST be asked. Quantity is the deciding fact; a lot row that is
// live but empty carries nothing and is folded/deactivated either way.
export const mergeStockImpactNeedsChoice = (impact: MergeStockImpact): boolean =>
  impact.branches.some((b) => b.quantity !== 0)

// WHAT THE CLIENT ACTUALLY GATES ON, and what the server never used to send.
//
// useMergeStockChoice skips the confirm dialog entirely when there is no stock
// to move, no price to move, no identity difference and no cost to fill in.
// The last two read `preview.identity` -- a shape that existed only in the
// frontend's types. It was never returned, so both were structurally false and
// an N15 merge that rewrote the kept product's cost to a mean ran with no
// confirmation at all. Building it here is what makes that gate live.
export type MergeIdentityDiff = {
  same: boolean
  differs: Array<{ field: string; keeper: string; discarded: string }>
  costVerdict: CostVerdict
  costFill: Array<{ field: string; value: number }>
  // The cost the fold WILL write, computed with the same resolveMergedCostDetail
  // the fold calls, so a preview cannot promise a cost the fold would not set.
  // Before this the merge preview never mentioned cost at all -- neither the
  // pair preview nor the whole-catalog dry run -- and the only place the mean
  // appeared was inside the fold, i.e. after the point of no return.
  costBefore: Record<string, number>
  costAfter: Record<string, number>
  costOutliers: MergedCostOutlier[]
}

const MERGE_IDENTITY_COST_FIELDS = ['cost_price_usd', 'cost_price_khr'] as const

export async function readMergeIdentityDiff(
  db: ReturnType<typeof getDb>,
  keeperId: number,
  dupId: number,
): Promise<MergeIdentityDiff> {
  const columns = 'id, name, barcode, cost_price_usd, cost_price_khr'
  const [keeper, dup] = await Promise.all([
    db.prepare(`SELECT ${columns} FROM products WHERE id = @id`).get<Record<string, unknown>>({ id: keeperId }),
    db.prepare(`SELECT ${columns} FROM products WHERE id = @id`).get<Record<string, unknown>>({ id: dupId }),
  ])
  const differs: Array<{ field: string; keeper: string; discarded: string }> = []
  if (normalizeProductGroupName(keeper?.name) !== normalizeProductGroupName(dup?.name)) {
    differs.push({ field: 'name', keeper: String(keeper?.name ?? ''), discarded: String(dup?.name ?? '') })
  }
  // identityBarcodeKey, not the raw string: a leading zero is not a different
  // barcode, so it must not be reported to the reviewer as one.
  if (identityBarcodeKey(keeper?.barcode) !== identityBarcodeKey(dup?.barcode)) {
    differs.push({ field: 'barcode', keeper: String(keeper?.barcode ?? ''), discarded: String(dup?.barcode ?? '') })
  }
  const costVerdict = compareCosts(keeper || {}, dup || {})
  const costFill: Array<{ field: string; value: number }> = []
  const costBefore: Record<string, number> = {}
  const costAfter: Record<string, number> = {}
  const { merged, outliers } = resolveMergedCostDetail([keeper || {}, dup || {}])
  for (const field of MERGE_IDENTITY_COST_FIELDS) {
    const before = Number(keeper?.[field]) || 0
    const after = Number(merged[field] ?? before) || 0
    costBefore[field] = before
    costAfter[field] = after
    // The kept row has no cost of its own and takes the discarded row's. Not a
    // difference (0/NULL is a cost nobody recorded) -- but it changes what the
    // kept product cost, so it is said out loud rather than done quietly.
    if (!before && after) costFill.push({ field, value: after })
  }
  return {
    same: differs.length === 0,
    differs,
    costVerdict,
    costFill,
    costBefore,
    costAfter,
    costOutliers: outliers,
  }
}

// OWNER RULING (N15, 2026-09-06): two costs more than COST_OUTLIER_RATIO apart
// are not one product's cost written twice, they are one cost and one probable
// typo -- so the merge REFUSES rather than averaging or silently keeping the
// dearer. (Until this change the fold kept the dearer and merely reported it,
// which meant the stored cost equalled neither row's own figure and nobody had
// to agree to that.) The refusal is the same on both merge routes.
export const mergeCostRefusal = (identity: MergeIdentityDiff): MergedCostOutlier | null =>
  identity.costOutliers[0] ?? null

export function mergeCostRefusalMessage(dupName: string | null, outlier: MergedCostOutlier): string {
  return `"${dupName}" and the product you are keeping record costs too far apart to be one product's cost `
    + `(${outlier.min} and ${outlier.max}). Averaging them would store a cost nobody paid, so this merge is refused -- `
    + 'correct whichever figure is wrong, then merge.'
}

// A merge rewrites the very rows a stock-in session's undo/redo asserts on:
// lib/stockSession.ts rebuilds the session postimage through `IN (SELECT
// product_id FROM stock_session_members WHERE operation_id=@id)` and refuses to
// replay unless live state still equals it. Folding a member product moves its
// branch_stock and reparents its movements, so that equality can never hold
// again and the session's Undo dies -- silently, at the moment someone tries to
// use it. Reparenting the members row does not help: `members` is itself inside
// the postimage, so the UPDATE alone breaks the assertion, and the comparison
// then runs against the KEEPER's rows. So the merge waits instead.
export async function mergeBlockedByReversibleStockSession(
  db: ReturnType<typeof getDb>,
  productIds: number[],
): Promise<{ operationId: string; status: string } | null> {
  const ids = productIds.filter((id) => Number.isFinite(id))
  if (!ids.length) return null
  const { sql, params } = buildInClause('p', ids)
  const row = await db.prepare(`
    SELECT o.id AS operationId, h.status AS status
    FROM stock_session_operations o
    JOIN action_history h ON h.id = o.history_id
    WHERE h.status IN ('undoable', 'redoable')
      AND EXISTS (SELECT 1 FROM stock_session_members m WHERE m.operation_id = o.id AND m.product_id IN (${sql}))
    LIMIT 1
  `).get<{ operationId: string; status: string }>(params)
  return row || null
}

export const mergeStockSessionBlockedMessage = (operationId: string): string =>
  `One of these products is part of stock-in session ${operationId}, which can still be undone. `
  + 'Merging now would break that session\'s Undo. Undo it or let it settle first, then merge.'

// The ledger line a WRITE-OFF leaves behind, and the fragment that finds it
// again afterwards. Both live here so the reason text and the id-capture query
// can never disagree: the "(#id) removed -- stock written off" middle is the
// stable part and everything around it is free prose.
const writeOffMarker = (dupId: number): string => `(#${dupId}) removed -- stock written off`
function writeOffReason(dup: { id: number; name: string | null }, mergeContext: string): string {
  return `Duplicate product "${dup.name}" ${writeOffMarker(dup.id)} instead of being merged -- ${mergeContext}`
}

// The complete fold of ONE duplicate product into a keeper -- branch_stock
// summed per branch (with an inventory_movements record each), gallery +
// primary image carried over, product_batches re-pointed lot-by-lot (or
// folded into the keeper's same-key lot -- see the batch_key comment in the
// body), the duplicate soft-deactivated so old sales/movements referencing
// its id stay valid, and an audit entry written. Shared verbatim by the
// whole-catalog POST /merge-duplicates below and the one-pair
// POST /possible-duplicates/merge, so the two paths can never drift.
// Callers recompute the keeper's denormalized stock_quantity afterwards
// (once per group / once per pair) and bump caches.
//
// `stockDisposition` is the operator's answer to "the row you are discarding
// still holds stock -- what happens to it?", and there are exactly two answers:
//
//   'merge'     -- the default and the historical behaviour. Every lot moves
//                  onto the keeper KEEPING its lot code, batch number, branch
//                  and dates; a lot whose batch_key already exists on the
//                  keeper for the same branch has its quantities added into
//                  that one row rather than being duplicated.
//   'write_off' -- the lots are deactivated in place with their per-branch
//                  stock cleared, and one balancing NEGATIVE inventory_movement
//                  per branch is written on the discarded row (naming the
//                  reason, the user and the time) so the ledger still adds up
//                  after the row is gone. Nothing lands on the keeper's shelf.
//
// There is no third, silent path: the review endpoint refuses to guess when a
// stocked row arrives without a choice (400 stock_choice_required).
export async function foldDuplicateProductInto(
  env: Env,
  db: ReturnType<typeof getDb>,
  user: SessionUser | null,
  canonical: { id: number; name: string | null },
  dup: { id: number; name: string | null; image_path?: string | null },
  branchNameById: Map<number, string>,
  mergeContext: string,
  stockDisposition: MergeStockDisposition = 'merge',
): Promise<{
  batchesMoved: number
  batchesFolded: number
  batchesWrittenOff: number
  imagesMoved: number
  quantityMoved: number
  quantityWrittenOff: number
  salesReparented: number
  movementsReparented: number
  // Empty on every ordinary fold. Non-empty when the two rows' costs were too
  // far apart to average and the higher was kept instead -- the one outcome of
  // a merge where the stored cost equals neither row's own previous figure, so
  // it is reported rather than applied silently.
  costOutliers: MergedCostOutlier[]
  returnsReparented: number
  reparentedSaleItemIds: number[]
  reparentedMovementIds: number[]
  reversal: MergeReversal
}> {
  const writeOffStock = stockDisposition === 'write_off'
  const canonicalId = canonical.id
  const canonicalName = canonical.name
  // Snapshot the keeper's current batch set at call time; a group caller
  // folding several duplicates commits each fold before the next call, so
  // a later duplicate sees (and folds into) batches an earlier one moved.
  const canonicalBatchRows = await db
    .prepare('SELECT id, batch_key, batch_number FROM product_batches WHERE variant_product_id = @id')
    .all<{ id: number; batch_key: string; batch_number: number | null }>({ id: canonicalId })
  const canonicalBatchIdByKey = new Map<string, number>(canonicalBatchRows.map((b) => [b.batch_key, b.id]))
  let nextCanonicalBatchNumber = canonicalBatchRows.reduce((max, b) => Math.max(max, Number(b.batch_number) || 0), 0) + 1

  const stockRows = await db
    .prepare('SELECT branch_id, quantity, rfid_confirmed_qty FROM branch_stock WHERE product_id = @id')
    .all<{ branch_id: number; quantity: number; rfid_confirmed_qty: number | null }>({ id: dup.id })
  // Keeper's branch_stock BEFORE the fold, captured so undo can restore it
  // exactly. The fold adds the dup's per-branch quantity into the keeper (and
  // may create a keeper row for a branch it had none in), so subtracting on
  // undo alone could leave a phantom zero row -- restoring the captured
  // before-image instead is exact.
  const canonicalStockBefore = await db
    .prepare('SELECT branch_id, quantity FROM branch_stock WHERE product_id = @id')
    .all<{ branch_id: number; quantity: number }>({ id: canonicalId })
  // Keeper's image_path BEFORE the fold: the fold adopts the dup's image only
  // when the keeper had none, so undo restores this captured value verbatim.
  const canonicalBefore = await db
    .prepare(`SELECT image_path, selling_price_usd, selling_price_khr, wholesale_price_usd, wholesale_price_khr, cost_price_usd, cost_price_khr
              FROM products WHERE id = @id`)
    .get<{ image_path: string | null; selling_price_usd: number | null; selling_price_khr: number | null; wholesale_price_usd: number | null; wholesale_price_khr: number | null; cost_price_usd: number | null; cost_price_khr: number | null }>({ id: canonicalId })
  const dupPricing = await db
    .prepare(`SELECT selling_price_usd, selling_price_khr, wholesale_price_usd, wholesale_price_khr, cost_price_usd, cost_price_khr
              FROM products WHERE id = @id`)
    .get<{ selling_price_usd: number | null; selling_price_khr: number | null; wholesale_price_usd: number | null; wholesale_price_khr: number | null; cost_price_usd: number | null; cost_price_khr: number | null }>({ id: dup.id })
  // Selling AND wholesale price: highest of the two rows wins (see
  // resolveMergedPricing). Both SELECTs above name wholesale_price_*, not the
  // retired special_price_* pair -- migration 0111 moved the discounted tier
  // across and zeroed the old columns, so while this path still read them the
  // merge resolved max(0, 0) and a folded-away duplicate's wholesale price was
  // deactivated with its row. Nothing threw; the number simply left the
  // catalogue. The dead pair is written by nothing here on purpose.
  const mergedPricing = resolveMergedPricing([canonicalBefore || {}, dupPricing || {}])
  // Cost is no longer identity (Sep 4 2026), so folding a duplicate must also
  // reconcile the two costs rather than silently keeping the keeper's: the
  // survivor carries the mean of the distinct costs, rounded up to 4dp.
  //
  // Detail form, not the plain resolveMergedCost: the rule refuses to average
  // two costs more than COST_OUTLIER_RATIO apart (it keeps the higher one
  // instead of inventing a mean nobody paid), and a merge that rewrote a cost
  // on that basis must say so. `costOutliers` rides out through the audit
  // entry and both merge responses.
  const costResolution = resolveMergedCostDetail([canonicalBefore || {}, dupPricing || {}])
  const mergedCost = costResolution.merged
  const costOutliers: MergedCostOutlier[] = costResolution.outliers
  // Which of the keeper's prices this fold actually moves. Computed from the
  // same two rows and the same fallback chain the UPDATE below writes, so the
  // audit trail cannot claim a change the fold did not make (or miss one it
  // did). Empty on the common case where the keeper already had the higher
  // price -- the audit entry then simply says nothing moved.
  const priceChangesForAudit = ([
    ['selling_price_usd', mergedPricing.selling_price_usd ?? canonicalBefore?.selling_price_usd ?? 0],
    ['selling_price_khr', mergedPricing.selling_price_khr ?? canonicalBefore?.selling_price_khr ?? 0],
    ['wholesale_price_usd', mergedPricing.wholesale_price_usd ?? canonicalBefore?.wholesale_price_usd ?? 0],
    ['wholesale_price_khr', mergedPricing.wholesale_price_khr ?? canonicalBefore?.wholesale_price_khr ?? 0],
  ] as Array<[string, number]>)
    .map(([field, to]) => ({ field, from: Number((canonicalBefore as Record<string, number | null> | null)?.[field]) || 0, to: Number(to) || 0 }))
    .filter((change) => Math.round(change.from * 100) !== Math.round(change.to * 100))
  const dupBatchRows = await db
    .prepare('SELECT id, batch_key, batch_number FROM product_batches WHERE variant_product_id = @id')
    .all<{ id: number; batch_key: string; batch_number: number | null }>({ id: dup.id })
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
  let quantityMoved = 0
  let quantityWrittenOff = 0
  for (const row of stockRows) {
    const qty = Number(row.quantity) || 0
    if (!qty) continue
    if (writeOffStock) {
      // REMOVE: nothing lands on the keeper. One negative movement per branch,
      // equal to exactly what the discarded row held there, written against the
      // DISCARDED product so it sits in that row's own history -- the reparent
      // pass further down then carries it onto the keeper with the rest of that
      // history, which is what keeps the keeper's ledger balanced (the stock
      // came in on the discarded row and went out again on the same row).
      quantityWrittenOff += qty
      statements.push({
        sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_id, user_name, created_at)
              VALUES (@productId, @productName, @branchId, @branchName, 'adjustment', @quantity, @reason, @userId, @userName, CURRENT_TIMESTAMP)`,
        params: {
          productId: dup.id,
          productName: dup.name,
          branchId: row.branch_id,
          branchName: branchNameById.get(row.branch_id) || null,
          quantity: -qty,
          reason: writeOffReason(dup, mergeContext),
          userId: user?.id ?? null,
          userName: user?.name ?? null,
        },
      })
      continue
    }
    quantityMoved += qty
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
        reason: `Merged duplicate product "${dup.name}" (#${dup.id}) into this product -- ${mergeContext}`,
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
  const imagesMovedPaths: string[] = []
  for (const image of dupImageRows) {
    const imagePath = String(image.image_path || '')
    if (!imagePath || canonicalImagePaths.has(imagePath)) continue
    canonicalImagePaths.add(imagePath)
    imagesMovedPaths.push(imagePath)
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
  statements.push({
    sql: `UPDATE products
          SET selling_price_usd = @sellingUsd,
              selling_price_khr = @sellingKhr,
              wholesale_price_usd = @wholesaleUsd,
              wholesale_price_khr = @wholesaleKhr,
              cost_price_usd = @costUsd,
              cost_price_khr = @costKhr,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = @canonicalId`,
    params: {
      canonicalId,
      sellingUsd: mergedPricing.selling_price_usd ?? canonicalBefore?.selling_price_usd ?? 0,
      sellingKhr: mergedPricing.selling_price_khr ?? canonicalBefore?.selling_price_khr ?? 0,
      wholesaleUsd: mergedPricing.wholesale_price_usd ?? canonicalBefore?.wholesale_price_usd ?? 0,
      wholesaleKhr: mergedPricing.wholesale_price_khr ?? canonicalBefore?.wholesale_price_khr ?? 0,
      costUsd: mergedCost.cost_price_usd ?? canonicalBefore?.cost_price_usd ?? 0,
      costKhr: mergedCost.cost_price_khr ?? canonicalBefore?.cost_price_khr ?? 0,
    },
  })

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
  // Reverse-spec captures for the batch disposition: a REPOINTED batch is
  // reversed by pointing it back at the dup with its original number; a FOLDED
  // batch is reversed by reactivating it, re-inserting its branch_batch_stock,
  // and restoring the keeper batch's branch_batch_stock to its before-image
  // (each keeper batch is folded into at most once here -- dup batch_keys are
  // unique per product -- so its before-image is captured exactly once).
  const repointedBatches: Array<{ id: number; batchNumber: number | null }> = []
  const foldedBatches: Array<{
    dupBatchId: number
    keeperBatchId: number
    dupStockBefore: Array<{ branch_id: number; quantity: number }>
    keeperStockBefore: Array<{ branch_id: number; quantity: number }>
    saleAllocationIds?: number[]
    returnAllocationIds?: number[]
  }> = []
  // WRITE-OFF only: each lot deactivated in place, its per-branch stock cleared.
  const writtenOffBatches: Array<{ batchId: number; stockBefore: Array<{ branch_id: number; quantity: number }> }> = []
  // The per-lot detail behind a write-off, recorded in the audit entry so the
  // lots that were destroyed are named (code, number, branch, quantity) rather
  // than collapsing into one anonymous total.
  const writtenOffLotDetail: Array<{ batchId: number; batchNumber: number | null; branchId: number; quantity: number }> = []
  let batchesWrittenOffThisDup = 0
  for (const batchRow of dupBatchRows) {
    if (writeOffStock) {
      // REMOVE: the lot belonged to the row being discarded, so it does not
      // travel. Its branch_batch_stock is cleared and the lot row itself is
      // deactivated in place (never deleted) because
      // sale_item_batch_allocations / return_item_batch_allocations may still
      // point at its id. batch_number is left exactly as it was -- this path
      // writes no batch_number at all, so it cannot introduce a TEXT value into
      // that INTEGER column the way the RECON import once did.
      const dupBatchStockRows = await db
        .prepare('SELECT branch_id, quantity FROM branch_batch_stock WHERE batch_id = @id')
        .all<{ branch_id: number; quantity: number }>({ id: batchRow.id })
      statements.push({ sql: 'DELETE FROM branch_batch_stock WHERE batch_id = @id', params: { id: batchRow.id } })
      statements.push({ sql: 'UPDATE product_batches SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = @id', params: { id: batchRow.id } })
      writtenOffBatches.push({
        batchId: batchRow.id,
        stockBefore: dupBatchStockRows.map((r) => ({ branch_id: r.branch_id, quantity: Number(r.quantity) || 0 })),
      })
      for (const bbs of dupBatchStockRows) {
        writtenOffLotDetail.push({
          batchId: batchRow.id,
          batchNumber: batchRow.batch_number == null ? null : Number(batchRow.batch_number),
          branchId: Number(bbs.branch_id),
          quantity: Number(bbs.quantity) || 0,
        })
      }
      batchesWrittenOffThisDup += 1
      continue
    }
    const existingCanonicalBatchId = canonicalBatchIdByKey.get(batchRow.batch_key)
    if (existingCanonicalBatchId) {
      const dupBatchStockRows = await db
        .prepare('SELECT branch_id, quantity FROM branch_batch_stock WHERE batch_id = @id')
        .all<{ branch_id: number; quantity: number }>({ id: batchRow.id })
      const keeperBatchStockBefore = await db
        .prepare('SELECT branch_id, quantity FROM branch_batch_stock WHERE batch_id = @id')
        .all<{ branch_id: number; quantity: number }>({ id: existingCanonicalBatchId })
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
      foldedBatches.push({
        dupBatchId: batchRow.id,
        keeperBatchId: existingCanonicalBatchId,
        dupStockBefore: dupBatchStockRows.map((r) => ({ branch_id: r.branch_id, quantity: Number(r.quantity) || 0 })),
        keeperStockBefore: keeperBatchStockBefore.map((r) => ({ branch_id: r.branch_id, quantity: Number(r.quantity) || 0 })),
        saleAllocationIds: (await db.prepare('SELECT id FROM sale_item_batch_allocations WHERE batch_id = @id').all<{ id: number }>({ id: batchRow.id })).map((r) => Number(r.id)),
        returnAllocationIds: (await db.prepare('SELECT id FROM return_item_batch_allocations WHERE batch_id = @id').all<{ id: number }>({ id: batchRow.id })).map((r) => Number(r.id)),
      })
      statements.push({ sql: 'UPDATE sale_item_batch_allocations SET batch_id = @keeperBatchId WHERE batch_id = @dupBatchId', params: { keeperBatchId: existingCanonicalBatchId, dupBatchId: batchRow.id } })
      statements.push({ sql: 'UPDATE return_item_batch_allocations SET batch_id = @keeperBatchId WHERE batch_id = @dupBatchId', params: { keeperBatchId: existingCanonicalBatchId, dupBatchId: batchRow.id } })
      batchesFoldedThisDup += 1
    } else {
      statements.push({
        sql: 'UPDATE product_batches SET variant_product_id = @canonicalId, batch_number = @batchNumber, updated_at = CURRENT_TIMESTAMP WHERE id = @id',
        params: { canonicalId, batchNumber: nextCanonicalBatchNumber, id: batchRow.id },
      })
      canonicalBatchIdByKey.set(batchRow.batch_key, batchRow.id)
      nextCanonicalBatchNumber += 1
      repointedBatches.push({ id: batchRow.id, batchNumber: batchRow.batch_number })
      batchesMovedThisDup += 1
    }
  }

  // Re-parent the duplicate's transactional history onto the keeper so the
  // survivor's Sales section and Stock Changes ledger show the COMPLETE
  // history. Previously these rows stayed attached to the now-deactivated
  // dup id and silently dropped out of the keeper's per-product reports --
  // the one thing this fold still left behind (sales especially: the
  // detail-report Sales query keys on sale_items.product_id, so a merged
  // duplicate's sales vanished from the keeper). The line-item product_name
  // is left exactly as-sold (historical receipt fidelity); only the
  // product_id owner moves. Captured first (the ids, not just counts) so the
  // merge is reversible: undo re-parents these exact rows back to the dup.
  //
  // The table list is MERGE_REPARENT_TABLES (lib/undoAppliers.ts) -- the ONE
  // place the forward fold and the undo applier both read, so a link added to
  // the schema is either on that list or provably not a link (see the
  // exclusions documented there). Returns in particular used to be missed:
  // return_items.product_id kept pointing at a deactivated row, so a refund of
  // a merged-away twin vanished from the survivor's history.
  const reparentedByTable: Array<{ table: string; column: string; ids: number[] }> = []
  for (const { table, column } of MERGE_REPARENT_TABLES) {
    // sql-bound-params: `table`/`column` are compile-time constants from
    // MERGE_REPARENT_TABLES, never request input.
    const ids = (await db
      .prepare(`SELECT id FROM ${table} WHERE ${column} = @id`)
      .all<{ id: number }>({ id: dup.id })).map((r) => Number(r.id))
    if (!ids.length) continue
    reparentedByTable.push({ table, column, ids })
    statements.push({
      sql: `UPDATE ${table} SET ${column} = @canonicalId WHERE ${column} = @dupId`,
      params: { canonicalId, dupId: dup.id },
    })
  }
  const byTable = (table: string): number[] => reparentedByTable.find((e) => e.table === table)?.ids ?? []
  const reparentedSaleItemIds = byTable('sale_items')
  const reparentedMovementIds = byTable('inventory_movements')
  const returnsReparented = byTable('return_items').length + byTable('return_replacement_items').length

  await db.batch(statements)

  // The stock-fold inserted one 'adjustment' inventory_movement per branch on
  // the keeper; capture their ids now (right after the batch, when exactly this
  // fold's rows carry the dup-specific reason fragment -- the dup is now
  // inactive and cannot be re-merged, so no other rows can match) so undo
  // deletes those exact rows by id rather than by a fragile reason match.
  // A WRITE-OFF's balancing rows were written on the DUP and then carried onto
  // the keeper by the reparent pass, so they answer to the keeper id here just
  // like the merge path's adjustments. Both fragments are matched so undo
  // deletes exactly this fold's own rows whichever disposition ran.
  const adjustmentMovementIds = (await db
    .prepare(`SELECT id FROM inventory_movements
              WHERE product_id = @keeperId AND movement_type = 'adjustment'
                AND (reason LIKE @frag OR reason LIKE @writeOffFrag)`)
    .all<{ id: number }>({
      keeperId: canonicalId,
      frag: `%(#${dup.id}) into this product%`,
      writeOffFrag: `%${writeOffMarker(dup.id)}%`,
    })).map((r) => Number(r.id))

  await audit(env, user?.id ?? null, user?.name ?? null, 'merge_duplicate', 'product', dup.id, {
    productName: dup.name,
    mergedIntoProductId: canonicalId,
    mergedIntoProductName: canonicalName,
    // Which of the two explicit answers the operator gave for the discarded
    // row's stock. Never absent -- the endpoint refuses to guess.
    stockDisposition,
    // A merge adopts the HIGHER of the two rows' selling/special prices, so it
    // can raise what the shop rings up. Recorded field by field (empty when
    // nothing moved) rather than left as an invisible side effect -- the
    // reviewer is shown the same before/after in the confirm dialog.
    priceChanges: priceChangesForAudit,
    batchesMoved: batchesMovedThisDup,
    batchesFoldedIntoExistingLot: batchesFoldedThisDup,
    batchesWrittenOff: batchesWrittenOffThisDup,
    quantityMoved,
    quantityWrittenOff,
    lotsWrittenOff: writtenOffLotDetail,
    // Recorded so a merge that moved imagery is visible in the audit log
    // rather than being an invisible side effect.
    imagesMoved: imagesMovedThisDup,
    salesReparented: reparentedSaleItemIds.length,
    movementsReparented: reparentedMovementIds.length,
    // Only present on the rare fold that refused to average two costs, so an
    // ordinary merge's audit payload is unchanged -- but when it happens the
    // audit log is where it can still be found months later.
    ...(costOutliers.length ? { costOutliers } : {}),
    returnsReparented,
    reparentedTables: reparentedByTable.map((e) => `${e.table}:${e.ids.length}`),
  })

  return {
    batchesMoved: batchesMovedThisDup,
    batchesFolded: batchesFoldedThisDup,
    batchesWrittenOff: batchesWrittenOffThisDup,
    imagesMoved: imagesMovedThisDup,
    quantityMoved,
    quantityWrittenOff,
    salesReparented: reparentedSaleItemIds.length,
    movementsReparented: reparentedMovementIds.length,
    costOutliers,
    returnsReparented,
    reparentedSaleItemIds,
    reparentedMovementIds,
    // Everything undo needs to restore both products to their exact pre-fold
    // state. Consumed by the 'product.merge' applier (lib/undoAppliers.ts) via
    // the undo_snapshots side table; see makeMergeReversal() for the shape.
    reversal: {
      keeperId: canonicalId,
      keeperName: canonicalName,
      dupId: dup.id,
      dupName: dup.name ?? null,
      keeperImagePathBefore: canonicalBefore?.image_path ?? null,
      keeperPricingBefore: {
        selling_price_usd: Number(canonicalBefore?.selling_price_usd) || 0,
        selling_price_khr: Number(canonicalBefore?.selling_price_khr) || 0,
        wholesale_price_usd: Number(canonicalBefore?.wholesale_price_usd) || 0,
        wholesale_price_khr: Number(canonicalBefore?.wholesale_price_khr) || 0,
        cost_price_usd: Number(canonicalBefore?.cost_price_usd) || 0,
        cost_price_khr: Number(canonicalBefore?.cost_price_khr) || 0,
      },
      keeperStockBefore: canonicalStockBefore.map((r) => ({ branch_id: r.branch_id, quantity: Number(r.quantity) || 0 })),
      dupStockBefore: stockRows.map((r) => ({ branch_id: r.branch_id, quantity: Number(r.quantity) || 0, rfid_confirmed_qty: Number(r.rfid_confirmed_qty) || 0 })),
      dupImagesBefore: dupImageRows.map((r) => ({ image_path: String(r.image_path), sort_order: r.sort_order == null ? null : Number(r.sort_order) })),
      imagesMovedToKeeper: imagesMovedPaths,
      repointedBatches,
      foldedBatches,
      writtenOffBatches,
      reparentedSaleItemIds,
      reparentedMovementIds,
      reparentedByTable,
      adjustmentMovementIds,
      stockDisposition,
      mergeContext,
    },
  }
}

// Hand the fold to the undo/redo registry so the 'product.merge' applier can
// re-run this exact production merge on REDO, without the lib importing this
// route module (which would be a lib->route dependency and an import cycle,
// since this file imports MergeReversal from there). See lib/undoAppliers.ts.
registerMergeFold(foldDuplicateProductInto)

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

      // WHAT THIS RUN WILL DO TO THE COST, which no preview said before.
      // A merge averages the distinct costs (owner ruling, 2026-09-04), so
      // "nothing will change but the row count" was never true and a dry run
      // that hides it is not a dry run. Folded in the SAME sequential order
      // the run below applies -- pairwise, keeper first -- because a mean of
      // means is not the mean, and a preview that promises a cost the fold
      // would not write is worse than no preview.
      const costRows = await selectInChunks([group.canonical.id, ...duplicateIds], 0, (chunk) => {
        const { sql, params } = buildInClause('id', chunk)
        return db
          .prepare(`SELECT id, cost_price_usd, cost_price_khr FROM products WHERE id IN (${sql})`)
          .all<{ id: number; cost_price_usd: number | null; cost_price_khr: number | null }>(params)
      })
      const costById = new Map(costRows.map((r) => [r.id, r]))
      const canonicalCost: { cost_price_usd?: number | null; cost_price_khr?: number | null } = costById.get(group.canonical.id) || {}
      const costBefore = {
        cost_price_usd: Number(canonicalCost.cost_price_usd) || 0,
        cost_price_khr: Number(canonicalCost.cost_price_khr) || 0,
      }
      let running: Record<string, unknown> = { ...canonicalCost }
      const costSkips: Array<{ mergedId: number; field: string; min: number; max: number }> = []
      for (const dup of group.duplicates) {
        const detail = resolveMergedCostDetail([running, costById.get(dup.id) || {}])
        if (detail.outliers.length) {
          // Reported, and NOT folded into the running figure: the run below
          // refuses this pair, so the cost it shows must be the cost of the
          // merges that will actually happen.
          const o = detail.outliers[0]
          costSkips.push({ mergedId: dup.id, field: String(o.field), min: o.min, max: o.max })
          continue
        }
        running = { ...running, ...detail.merged }
      }
      const costAfter = {
        cost_price_usd: Number(running.cost_price_usd) || 0,
        cost_price_khr: Number(running.cost_price_khr) || 0,
      }

      return {
        canonicalId: group.canonical.id,
        canonicalName: group.canonical.name,
        canonicalBarcode: group.canonical.barcode,
        duplicates,
        totalQuantityToMove,
        branchBreakdown,
        costBefore,
        costAfter,
        // Pairs this run will REFUSE, named in the dry run rather than
        // discovered afterwards in the response.
        costRefusals: costSkips,
      }
    }),
  )

  return c.json({
    success: true,
    groupCount: previewGroups.length,
    duplicateProductCount: previewGroups.reduce((sum, g) => sum + g.duplicates.length, 0),
    groups: previewGroups,
    costRefusalCount: previewGroups.reduce((sum, g) => sum + g.costRefusals.length, 0),
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
  // Folds that refused to average two costs (see resolveMergedCostDetail's
  // similarity guard). Normally empty; returned so a bulk run that silently
  // rewrote a cost on one row out of hundreds is still visible in the result
  // rather than only in the audit log.
  const costOutlierReports: Array<{ keeperId: number; mergedId: number; field: string; min: number; max: number; kept: number }> = []
  // Pairs this run REFUSED and left exactly as they were. Same rule as the
  // pair route's 409s, because "merge these two" cannot mean one thing in the
  // review dialog and another in the bulk run: a cost pair too far apart to
  // be one cost needs a person, and a product still inside a reversible
  // stock-in session must not have that session broken underneath it.
  const refusals: Array<{ keeperId: number; mergedId: number; mergedName: string | null; code: string; error: string }> = []
  // Every fold's reversal, in application order, so the whole run can be undone
  // (and redone) as ONE action -- see recordBulkMergeUndoSnapshot below. Kept
  // server-side only; never returned in the response (it's large).
  const reversals: MergeReversal[] = []

  for (const group of groups) {
    const canonicalId = group.canonical.id
    const canonicalName = group.canonical.name
    const mergedIds: number[] = []
    const mergedNames: (string | null)[] = []

    // Batch/lot history reassignment, stock fold, image carry, audit --
    // the whole per-duplicate fold lives in foldDuplicateProductInto
    // (shared with POST /possible-duplicates/merge). Each fold commits
    // before the next runs, so a later duplicate in the group sees -- and
    // folds into -- batches an earlier one already moved (the same
    // "growing set" the old per-group snapshot provided).
    for (const dup of group.duplicates) {
      const identity = await readMergeIdentityDiff(db, canonicalId, dup.id)
      const costOutlier = mergeCostRefusal(identity)
      if (costOutlier) {
        refusals.push({ keeperId: canonicalId, mergedId: dup.id, mergedName: dup.name, code: 'cost_outlier_review', error: mergeCostRefusalMessage(dup.name, costOutlier) })
        continue
      }
      const blockingSession = await mergeBlockedByReversibleStockSession(db, [canonicalId, dup.id])
      if (blockingSession) {
        refusals.push({ keeperId: canonicalId, mergedId: dup.id, mergedName: dup.name, code: 'stock_session_reversible', error: mergeStockSessionBlockedMessage(blockingSession.operationId) })
        continue
      }
      const { reversal, costOutliers } = await foldDuplicateProductInto(
        c.env, db, user,
        { id: canonicalId, name: canonicalName },
        dup,
        branchNameById,
        'branch-only duplicate cleanup',
      )
      reversals.push(reversal)
      for (const outlier of costOutliers) {
        costOutlierReports.push({ keeperId: canonicalId, mergedId: dup.id, field: String(outlier.field), min: outlier.min, max: outlier.max, kept: outlier.chosen })
      }
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

  // Record the whole run as ONE undoable/redoable action (the big reversal set
  // goes to undo_snapshots; a small action_history row points at it). Done
  // synchronously before responding so the returned actionHistoryId is real.
  const undoRecord = await recordBulkMergeUndoSnapshot(c.env, user, reversals)

  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'update' }))
  return c.json({
    success: true,
    mergedGroups: groups.length,
    mergedProducts: mergedProductsCount,
    groups: groupSummaries,
    costOutliers: costOutlierReports,
    // What this run deliberately did NOT do. An empty array is the normal
    // answer; a non-empty one is work left for a person, and the UI says so.
    refusals,
    actionHistoryId: undoRecord?.actionHistoryId ?? null,
  })
})

// ---------------------------------------------------------------------------
// Products → Duplicates review section ("possibly the same" residue).
// Where /merge-duplicates auto-merges rows PROVABLY identical under THE
// identity rule, these three routes back the human review of the looser
// classes the Aug 30 production audit surfaced (same real barcode with
// differing details; same display name with different barcodes): a live
// sweep to look at, a per-cluster dismissal ("reviewed, genuinely two
// items"), and a one-pair merge where the REVIEWER picks the keeper.
// Same permission as the auto-merge -- it is the same kind of action.
// ---------------------------------------------------------------------------
app.get('/possible-duplicates', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'products', 'merge_duplicates') !== 'full') {
    return c.json({ success: false, error: 'You do not have permission to perform this action' }, 403)
  }
  const clusters = await findPossiblySameProductClusters(getDb(c.env))
  return c.json({ success: true, clusters })
})

app.post('/possible-duplicates/dismiss', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'products', 'merge_duplicates') !== 'full') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const body = await c.req.json().catch(() => ({})) as { type?: string; value?: string }
  const type = body.type === 'leadingzero' || body.type === 'barcode' || body.type === 'name' || body.type === 'similar' ? body.type : null
  const value = type ? normalizeProductClusterKey(type, body.value) : ''
  if (!type || !value) return c.json({ error: 'type (leadingzero|barcode|name|similar) and value are required' }, 400)
  await getDb(c.env).prepare(`
    INSERT INTO product_duplicate_dismissals (cluster_type, cluster_value, dismissed_by_id, dismissed_by_name, dismissed_at)
    VALUES (@type, @value, @byId, @byName, CURRENT_TIMESTAMP)
    ON CONFLICT(cluster_type, cluster_value) DO UPDATE SET
      dismissed_by_id = @byId, dismissed_by_name = @byName, dismissed_at = CURRENT_TIMESTAMP
  `).run({ type, value, byId: user?.id ?? null, byName: user?.name ?? null })
  return c.json({ success: true })
})

// GET /api/products/possible-duplicates/merge-preview?keepId=1&mergeId=2 --
// read-only: everything the operator needs to answer "keep this one" honestly.
// What the row being discarded still holds (per branch, per lot), and whether
// the merge would move the keeper's prices. Both callers -- the Conflicts review
// and the product-form collision path -- read this BEFORE opening the dialog, so
// the decision is made with the actual numbers in view rather than in the
// abstract. Writes nothing.
app.get('/possible-duplicates/merge-preview', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'products', 'merge_duplicates') !== 'full') {
    return c.json({ success: false, error: 'You do not have permission to perform this action' }, 403)
  }
  const keepId = Number(c.req.query('keepId'))
  const mergeId = Number(c.req.query('mergeId'))
  if (!Number.isInteger(keepId) || keepId <= 0 || !Number.isInteger(mergeId) || mergeId <= 0 || keepId === mergeId) {
    return c.json({ success: false, error: 'keepId and mergeId (two different product ids) are required' }, 400)
  }
  const db = getDb(c.env)
  const branchRows = await db.prepare('SELECT id, name FROM branches').all<{ id: number; name: string }>({})
  const branchNameById = new Map<number, string>(branchRows.map((b) => [b.id, b.name]))
  const [stockImpact, pricing, identity, blockingSession] = await Promise.all([
    readMergeStockImpact(db, mergeId, branchNameById),
    readMergePricingChange(db, keepId, mergeId),
    readMergeIdentityDiff(db, keepId, mergeId),
    mergeBlockedByReversibleStockSession(db, [keepId, mergeId]),
  ])
  const costOutlier = mergeCostRefusal(identity)
  return c.json({
    success: true,
    keepId,
    mergeId,
    stockImpact,
    needsStockChoice: mergeStockImpactNeedsChoice(stockImpact),
    pricing,
    // The gate the client has always read and the server has never sent.
    identity,
    // Read-only warnings, so the reviewer learns BEFORE choosing a keeper that
    // this pair cannot be merged yet, instead of after pressing Apply.
    blocked: costOutlier
      ? { code: 'cost_outlier_review', field: String(costOutlier.field), min: costOutlier.min, max: costOutlier.max }
      : blockingSession
        ? { code: 'stock_session_reversible', operationId: blockingSession.operationId }
        : null,
  })
})

app.post('/possible-duplicates/merge', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'products', 'merge_duplicates') !== 'full') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const body = await c.req.json().catch(() => ({})) as { keepId?: unknown; mergeId?: unknown; stock?: unknown }
  const keepId = Number(body.keepId)
  const mergeId = Number(body.mergeId)
  // The operator's answer for the discarded row's stock. Anything other than
  // the two words is treated as "no answer given", never as a default.
  const stockChoice: MergeStockDisposition | null =
    body.stock === 'merge' ? 'merge' : body.stock === 'write_off' ? 'write_off' : null
  if (!Number.isFinite(keepId) || !Number.isFinite(mergeId) || keepId === mergeId) {
    return c.json({ error: 'keepId and mergeId (two different ids) are required' }, 400)
  }
  const db = getDb(c.env)
  const [keeper, dup] = await Promise.all([
    db.prepare('SELECT id, name, image_path, is_active, COALESCE(is_group, 0) AS is_group FROM products WHERE id = @id')
      .get<{ id: number; name: string | null; image_path: string | null; is_active: number; is_group: number }>({ id: keepId }),
    db.prepare('SELECT id, name, image_path, is_active, COALESCE(is_group, 0) AS is_group FROM products WHERE id = @id')
      .get<{ id: number; name: string | null; image_path: string | null; is_active: number; is_group: number }>({ id: mergeId }),
  ])
  if (!keeper || !dup) return c.json({ error: 'Both products must exist' }, 404)
  if (!keeper.is_active || !dup.is_active) return c.json({ error: 'Both products must be active — one of them was already merged or deleted' }, 409)
  if (keeper.is_group || dup.is_group) return c.json({ error: 'Group rows cannot be merged — merge the variant products instead' }, 400)

  const branchRows = await db.prepare('SELECT id, name FROM branches').all<{ id: number; name: string }>({})
  const branchNameById = new Map<number, string>(branchRows.map((b) => [b.id, b.name]))

  // THE GUARD. The row being discarded still holds stock and the caller did not
  // say what to do with it -> refuse, describe what is there, and write nothing.
  // Merging it onto the keeper and writing it off are both defensible and they
  // give opposite inventory answers, so the server must not pick one; an
  // unstocked row needs no answer and proceeds as before.
  const stockImpact = await readMergeStockImpact(db, dup.id, branchNameById)
  const identity = await readMergeIdentityDiff(db, keeper.id, dup.id)
  // Cost first: a pair whose costs cannot be one cost is not a merge decision
  // at all, whatever the operator says about the stock.
  const costOutlier = mergeCostRefusal(identity)
  if (costOutlier) {
    return c.json({
      success: false,
      code: 'cost_outlier_review',
      error: mergeCostRefusalMessage(dup.name, costOutlier),
      identity,
      costOutlier: { field: String(costOutlier.field), min: costOutlier.min, max: costOutlier.max },
    }, 409)
  }
  const blockingSession = await mergeBlockedByReversibleStockSession(db, [keeper.id, dup.id])
  if (blockingSession) {
    return c.json({
      success: false,
      code: 'stock_session_reversible',
      error: mergeStockSessionBlockedMessage(blockingSession.operationId),
      operationId: blockingSession.operationId,
    }, 409)
  }
  if (!stockChoice && mergeStockImpactNeedsChoice(stockImpact)) {
    return c.json({
      success: false,
      code: 'stock_choice_required',
      error: `"${dup.name}" still holds ${stockImpact.totalQuantity} in stock. Choose whether that stock moves onto the product you are keeping or is written off before this merge can run.`,
      stockImpact,
      // The 400 refusal carries the same identity read the preview would have,
      // so the dialog the client is about to open is not blind to it.
      identity,
    }, 400)
  }

  const stats = await foldDuplicateProductInto(
    c.env, db, user,
    { id: keeper.id, name: keeper.name },
    { id: dup.id, name: dup.name, image_path: dup.image_path },
    branchNameById,
    'possible-duplicates review merge',
    stockChoice ?? 'merge',
  )
  await db
    .prepare('UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @id), updated_at = CURRENT_TIMESTAMP WHERE id = @id')
    .run({ id: keeper.id })
  // ...and the discarded row's own cache, which both dispositions empty. Left
  // stale it would keep reporting phantom stock on a deactivated product -- and
  // a written-off row reporting stock it no longer has is exactly the kind of
  // silent mismatch this whole change exists to stop.
  await db
    .prepare('UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @id), updated_at = CURRENT_TIMESTAMP WHERE id = @id')
    .run({ id: dup.id })

  // Record the merge as a reload-durable undoable/redoable action. The heavy
  // reversal snapshot goes to undo_snapshots; a small action_history row points
  // at it, so the reviewer (or an admin) can undo this exact merge later from
  // any tab. Recorded only for this reviewer-triggered single-pair merge, not
  // the whole-catalog auto-merge of provably-identical rows.
  const undoRecord = await recordMergeUndoSnapshot(c.env, user, stats.reversal)

  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'update' }))
  const { reversal: _reversal, reparentedSaleItemIds: _si, reparentedMovementIds: _mi, ...publicStats } = stats
  return c.json({
    success: true,
    keptId: keeper.id,
    mergedId: dup.id,
    actionHistoryId: undoRecord.actionHistoryId,
    stockDisposition: stockChoice ?? 'merge',
    stockImpact,
    ...publicStats,
  })
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
  let updatedCount = 0
  // Use the shared exact-value engine so category/brand secondary `||`
  // memberships move or clear together with the primary field. The old bulk
  // UPDATE touched only products.brand/category and left stale secondary
  // values behind. Values are still exact normalized equality, never LIKE.
  if (type === 'brand' || type === 'category' || type === 'unit') {
    const changed = await buildLiveLookupMutationPlan(db, type, sourceEntries, normalizedTarget || null, new Date().toISOString())
    const statements = [...changed.statements]
    if (type === 'brand') {
      const library = await buildBrandLibraryMutationPlan(db, sourceEntries, normalizedTarget || null)
      statements.push(...library.statements)
    }
    if (statements.length) await db.batch(statements)
    updatedCount = changed.products
  } else {
    // Suppliers are stable-ID contact records and can legitimately share a
    // display name, so they intentionally do not use the normalized lookup
    // constraint/library plan.
    for (const source of sourceEntries) {
      if (normalizedTarget && normalizeLookupKey(source) === normalizeLookupKey(normalizedTarget)) continue
      if (normalizedTarget) {
        const changed = await applyRenameCarry(db, 'supplier', source, normalizedTarget, new Date().toISOString())
        updatedCount += changed.products
      } else {
        const changed = await removeLiveLookupValue(db, 'supplier', source, new Date().toISOString())
        updatedCount += changed.products
      }
    }
  }

  await audit(c.env, user?.id ?? null, user?.name ?? null, 'lookup_replace', 'product', null, {
    type,
    from: sourceEntries,
    to: normalizedTarget || null,
    updated_count: updatedCount,
  })
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  if (type === 'brand') c.executionCtx.waitUntil(bumpVersion(c.env, 'settings'))
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

    const version = await getVersionWithFallback(c.env, 'products')
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
// The browser normally converts/resizes product photos below ~900KB. This
// 12MB bound is a fallback for codecs/devices where Canvas cannot decode the
// selected source (notably some HEIC paths): accept the photo, enqueue the
// existing on-upload Cloudflare image normalizer, and keep the user flow
// working instead of blaming the operator for browser compression failure.
// It remains bounded to protect Worker memory/request abuse.
const MAX_PRODUCT_IMAGE_UPLOAD_BYTES = 12 * 1024 * 1024

// POST /api/products/upload-image -- ported from routes/products.ts's
// upload-image handler. Functionally the same upload files.ts's POST
// /api/files/upload already does (store to R2, insert a file_assets row);
// this is a separate route because the frontend's product-edit screen
// calls this exact path under the 'products' permission specifically,
// not the general file-manager's permission -- and had no Cloudflare
// route at all, so every product image upload from that screen 404ed.
app.post('/upload-image', async (c) => {
  const user = c.get('user')
  // Product editors must retain Full access to the specific image action.
  // A Review Required tier cannot queue a multipart/R2 write, and applying it
  // here would bypass the product review flow before any product is updated.
  // products_image_only remains a separate, deliberately image-scoped role.
  if (getActionTier(user, 'products', 'image') !== 'full' && !hasPermission(user, 'products_image_only')) {
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
    return c.json({ success: false, error: 'Image could not be normalized within the upload safety limit.' }, 400)
  }

  const storedName = buildUniqueStoredName(originalName)
  const objectKey = `uploads/${storedName}`
  await c.env.ASSETS.put(objectKey, buffer, { httpMetadata: { contentType: mimeType } })
  // K3: same on-upload normalization every other image entry point gets.
  await enqueueImageNormalization(c.env, objectKey)
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
