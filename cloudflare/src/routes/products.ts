import { Hono } from 'hono'
import { enqueueImageNormalization } from '../lib/imageAudit'
import { getDb } from '../lib/db'
import { paginateProductFamilies } from '../lib/familyPagination'
import { loadLowStockConfig, lowStockThresholdSql, type LowStockConfig } from '../lib/lowStockSettings'
import { cachedJsonResponse, getVersionWithFallback, bumpVersion } from '../lib/cache'
import { matchLibraryImagesStrict } from '../lib/importImageMatch'
import { requireAuth, type SessionUser } from '../lib/auth'
import { hasPermission, getPermissionTier, getActionTier, getMergedPermissions, isAdminControlUser } from '../lib/permissions'
import { normalizeCatalogText, hasSuspiciousCatalogText } from '../lib/catalogText'
import { getMediaType, buildUniqueStoredName, sanitizeOriginalFileName } from '../lib/fileAssets'
import { sanitizeMediaList } from '../lib/media'
import { buildInClause, chunkForBinding, selectInChunks } from '../lib/sqlBinding'
import { attachBeforeQty, buildStockLedgerQuery, type StockLedgerView } from '../lib/stockLedgerQuery'
import { buildStockInSessionListQuery, parseStockInSessionKey, stockInSessionLineParams, stockInSessionLinesSql, STOCK_RECEIPT_TYPE_SQL } from '../lib/stockInSessionsQuery'
import { getProductSalesBreakdown } from '../lib/salesAnalytics'
import { localDateExpr, localMonthExpr } from '../lib/businessDateWindow'
import { validateUploadedBuffer } from '../lib/uploadSecurity'
import { checkRateLimit, getClientIp } from '../lib/rateLimit'
import { admitRequestBody } from '../lib/requestBodyGuard'
import { audit } from '../lib/audit'
import { canonicalProductBarcode, findDuplicateProductGroups, findPossiblySameProductClusters, identityBarcodeKey, identityBarcodeKeySql, normalizeProductClusterKey, pickSameIdentityRow, productsShareExactIdentity, resolveProductIdentityEdit } from '../lib/productIdentity'
import { compareCosts, normalizeProductGroupName } from '../lib/productDetailRule'
import type { CostVerdict, MergedCostOutlier } from '../lib/productDetailRule'
import { buildAtomicMergeHistoryStatements, finalizeAtomicMergeHistory, mergeStateFingerprint, PRODUCT_MERGE_GROUP_ACTION_KIND, PRODUCT_MERGE_GROUP_CHILD_KIND, productMergeGroupPrefixFingerprint, registerMergeFold, registerProductMergeGroupRedo, recordSupplierBackfillSnapshot, MERGE_REPARENT_TABLES, type AtomicMergeKnownIds, type AtomicMergeStatement, type MergeReversal, type MergeStockDisposition } from '../lib/undoAppliers'
import { createProductMergeClusterPlan, MERGE_COST_FIELDS, MERGE_PRICE_FIELDS, parseProductMergeClusterPlan, productMergeCaseKey, productMergeCasAssertion, productMergeNumericError, productMergePlanKeeperMatches, productMergePlanSourceMemberMatches, resolveProductMergeClusterPlanEconomics, resolveProductMergeEconomics, type ProductMergeClusterPlan, type ProductMergeEconomics, type ProductMergeNumericIssue } from '../lib/productMerge'
import { PRODUCT_MERGE_READ_BATCH_MAX_STATEMENTS, readProductMergeCaseSnapshot, readProductMergeDependentLotSnapshots } from '../lib/productMergeSnapshot'
import type { ProductMergeCaseSnapshot, ProductMergeLotSnapshot } from '../lib/productMergeSnapshot'
import {
  PRODUCT_CONFLICT_MERGE_MANIFEST_VERSION,
  ProductConflictMergeValidationError,
  canonicalProductConflictJson,
  chooseProductConflictMergePair,
  parseProductConflictApplyRequest,
  parseProductConflictCaseKey,
  parseProductConflictPreviewRequest,
  productConflictCaseKey,
  productConflictOperationId,
  productConflictSha256,
  type ProductConflictApplyCase,
  type ProductConflictEligibilityRow,
  type ProductConflictPreviewCase,
  type ProductConflictStockChoice,
} from '../lib/productConflictMergeBatch'
import {
  PRODUCT_CONFLICT_ACTION_PAGE_MAX,
  PRODUCT_CONFLICT_ACTION_READ_CHUNK,
  PRODUCT_CONFLICT_ACTION_MAX_ACTIVE_DRAFTS,
  PRODUCT_CONFLICT_ACTION_MAX_GROUP_DETAIL_BYTES,
  PRODUCT_CONFLICT_ACTION_MAX_GROUP_SOURCE_BYTES,
  PRODUCT_CONFLICT_ACTION_MAX_LOT_ROWS_PER_GROUP,
  PRODUCT_CONFLICT_ACTION_MAX_LOT_ROWS_PER_REVIEW,
  PRODUCT_CONFLICT_ACTION_MAX_REVIEW_DETAIL_BYTES,
  PRODUCT_CONFLICT_ACTION_PREVIEW_BODY_BYTES,
  buildProductConflictActionGroupPlans,
  canonicalizeProductConflictActionGroups,
  isProductConflictActionPreviewRequest,
  isProductConflictActionApplyRequest,
  parseProductConflictActionApplyRequest,
  parseProductConflictActionFinalizeRequest,
  parseProductConflictActionPreviewRequest,
  refuseProductConflictActionGroupDetail,
  type ProductConflictActionFinalizeResolution,
  type ProductConflictActionGroupPlan,
  type ProductConflictActionLotRow,
  type ProductConflictActionProductRow,
  type ProductConflictActionStockRow,
} from '../lib/productConflictActionGroups'
import { attachBatchCounts } from '../lib/productBatches'
import { maybeQueueForReview } from '../lib/reviewGate'
import { ProductRemoveError, parseProductRemovePlan, prepareProductRemovePlan, prepareProductRemoveReviewPlans,
  productRemoveApplyStatements, productRemovePlanDigest, productRemoveQueueStatements, productRemoveReviewQueueStatements,
  type ProductRemoveOperationRow } from '../lib/productDelete'
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
  compactSearchText,
  normalizeSearchText,
} from '../lib/searchMatch'
import { buildFamilyRelevanceOrderSql, buildProductSearchQuery } from '../lib/productSearchQuery'
import { omitUnchangedProductImageFields, productImageFieldsChanged, productImageFieldsChangedResolved, resolveProductImageFields, ProductImageAssetError } from '../lib/productImagePermission'
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
import { actorSnapshot } from '../lib/actorSnapshot'
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

async function loadProductImageState(env: Env, productId: string): Promise<{ image_path: string | null; image_gallery: string[] } | null> {
  const db = getDb(env)
  const product = await db.prepare('SELECT image_path FROM products WHERE id = @id')
    .get<{ image_path: string | null }>({ id: productId })
  if (!product) return null
  const gallery = await db.prepare(`
    SELECT image_path FROM product_images
    WHERE product_id = @id
    ORDER BY sort_order ASC, id ASC
  `).all<{ image_path: string }>({ id: productId })
  return { image_path: product.image_path, image_gallery: gallery.map((row) => row.image_path) }
}

function imagePermissionDenied(user: SessionUser, changed: boolean, imageOnlyEdit = false): boolean {
  return changed && !imageOnlyEdit && getActionTier(user, 'products', 'image') === 'none'
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
function buildFilterVariants(query: Record<string, string>, lowStock: LowStockConfig) {
  const base = { ...query, initial: 'all' }
  return {
    brands: buildSearchFilters({ ...base, brand: '' }, lowStock),
    categories: buildSearchFilters({ ...base, category: '' }, lowStock),
    units: buildSearchFilters({ ...base, unit: '' }, lowStock),
    suppliers: buildSearchFilters({ ...base, supplier: '' }, lowStock),
    tags: buildSearchFilters({ ...base, tag_label: '' }, lowStock),
    initials: buildSearchFilters(base, lowStock),
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
  const variants = buildFilterVariants(structuralQuery, await loadLowStockConfig(env))
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
// One extra query uses migration 0010's indexed, trigger-maintained
// lower(trim(name)) key. The IN-list is bounded to this page's distinct
// names rather than issuing N queries.
async function expandSearchResultsToNameSiblings(env: Env, items: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  if (!items.length) return items
  const seenIds = new Set(items.map((p) => Number(p.id)).filter((id) => Number.isFinite(id) && id > 0))
  // Keep the existing trim + internal-whitespace collapse + lowercase input
  // normalization. The lookup below changes only how SQLite reads the
  // persisted lower(trim(name)) values that the old predicate computed.
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
      FROM products p INDEXED BY idx_products_name_key_pg
      WHERE p.is_active = 1
        AND p.name_key IN (${sql})
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
  const filters = buildSearchFilters(query, await loadLowStockConfig(env), options)
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
function buildSearchFilters(query: Record<string, string>, lowStock: LowStockConfig, options: ProductSearchOptions = {}) {
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
  if (stockState === 'low') where.push(`${stockExpr} > COALESCE(p.out_of_stock_threshold, 0) AND ${stockExpr} <= ${lowStockThresholdSql(lowStock, 'p.low_stock_threshold')}`)
  if (stockState === 'out') where.push(`${stockExpr} <= COALESCE(p.out_of_stock_threshold, 0)`)
  if (stockState === 'in_stock' || stockState === 'positive') where.push(`${stockExpr} > COALESCE(p.out_of_stock_threshold, 0)`)
  // 'healthy' is a stricter subset of 'in_stock'/'positive' -- above the
  // low stock threshold specifically, not just above zero/out threshold.
  // Lets the stock-status filter isolate the same "healthy" bucket the
  // stats tiles already report separately from low/out.
  // The out-of-stock half of this clause is not redundant: it used to be
  // carried implicitly by the low threshold always being >= the out one, an
  // assumption the owner's switch breaks (alerts off makes the low fragment
  // -1, and every out-of-stock row is above -1). Stated, it holds either way.
  if (stockState === 'healthy') where.push(`${stockExpr} > COALESCE(p.out_of_stock_threshold, 0) AND ${stockExpr} > ${lowStockThresholdSql(lowStock, 'p.low_stock_threshold')}`)

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

  await audit(c.env, user?.id ?? null, actorSnapshot(user), 'supplier_backfill', 'product', productId, { supplierId, lots: ids.length })
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
        WHERE ${STOCK_RECEIPT_TYPE_SQL} AND m.batch_id IN (${clause.sql})
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
  await audit(c.env, user?.id ?? null, actorSnapshot(user), 'update', 'product', 'bulk-price-adjust', {
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
  try {
    await resolveProductImageFields(getDb(c.env), body)
  } catch (error) {
    if (error instanceof ProductImageAssetError) return c.json({ error: error.message, code: error.code }, 409)
    throw error
  }

  const changesImages = productImageFieldsChanged(body)
  if (imagePermissionDenied(user, changesImages)) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  if (!changesImages) omitUnchangedProductImageFields(body)

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
  await audit(c.env, user?.id ?? null, actorSnapshot(user), 'rename', 'brand', null, { from, to, products: changed.products })
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
  const submittedImageFields = Object.prototype.hasOwnProperty.call(body, 'image_path')
    || Object.prototype.hasOwnProperty.call(body, 'image_gallery')
  if (submittedImageFields) {
    const currentImageState = await loadProductImageState(c.env, id)
    if (!currentImageState) return c.json({ error: 'Product not found' }, 404)
    const changesImages = await productImageFieldsChangedResolved(getDb(c.env), body, currentImageState)
    if (imagePermissionDenied(user, changesImages, isImageOnlyEdit)) {
      return c.json({ error: 'You do not have permission to perform this action' }, 403)
    }
    if (!changesImages) {
      omitUnchangedProductImageFields(body)
    } else {
      try {
        await resolveProductImageFields(getDb(c.env), body)
      } catch (error) {
        if (error instanceof ProductImageAssetError) return c.json({ error: error.message, code: error.code }, 409)
        throw error
      }
    }
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
        await audit(c.env, user?.id ?? null, actorSnapshot(user), 'rename', 'product_group', id, { from: fromName, to: nextName, rows: carried.products })
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
  const tier = getActionTier(user, 'products', 'delete')
  if (tier === 'none') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const id = Number(c.req.param('id'))
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ success: false, code: 'invalid_product_id', error: 'A valid product id is required.' }, 400)
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const allowed = new Set(['reason', 'expectedUpdatedAt', 'expected_updated_at', 'client_request_id'])
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    return c.json({ success: false, code: 'invalid_remove_request', error: 'The product removal request contains unsupported fields.' }, 400)
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!reason || reason.length > 500) return c.json({ success: false, code: 'invalid_remove_reason', error: 'A reason of 1-500 characters is required.' }, 400)
  const suppliedRequestId = typeof body.client_request_id === 'string' ? body.client_request_id.trim() : ''
  if (suppliedRequestId && !/^[A-Za-z0-9_-]{8,120}$/.test(suppliedRequestId)) {
    return c.json({ success: false, code: 'invalid_client_request_id', error: 'A stable client_request_id is invalid.' }, 400)
  }
  const requestId = suppliedRequestId || `legacy-remove-${id}-${crypto.randomUUID()}`
  const db = getDb(c.env)
  const existingOperation = suppliedRequestId ? await db.prepare(`SELECT * FROM product_remove_operations
    WHERE actor_id=@actor AND source='direct' AND request_id=@request`).get<ProductRemoveOperationRow>({ actor: user.id, request: requestId }) : null
  if (existingOperation) {
    if (Number(existingOperation.product_id) !== id || existingOperation.reason !== reason) {
      return c.json({ success: false, code: 'idempotency_conflict', error: 'client_request_id was already used for a different product removal.' }, 409)
    }
    if (existingOperation.status === 'approval_pending') {
      return c.json({ success: true, pending: true, pendingActionId: existingOperation.pending_action_id,
        operation_id: existingOperation.operation_id, status: existingOperation.status, generation: Number(existingOperation.generation) }, 202)
    }
    if (existingOperation.status === 'undo_ready') {
      let response: Record<string, unknown> = {}
      try { response = existingOperation.response_json ? JSON.parse(existingOperation.response_json) : {} } catch { response = {} }
      return c.json({ success: true, ...response, replayed: true })
    }
    return c.json({ success: false, code: existingOperation.status === 'reversed' ? 'remove_reversed' : 'remove_state_conflict',
      error: 'This product removal request is not available for another forward apply.' }, 409)
  }
  let plan
  try {
    plan = await prepareProductRemovePlan(db, id, reason)
    assertUpdatedAtMatch('product', plan.product, getExpectedUpdatedAt(body))
  } catch (error) {
    if (error instanceof WriteConflictError) {
      const conflict = writeConflictResponse(error); return c.json(conflict.body, conflict.status)
    }
    if (error instanceof ProductRemoveError) {
      if (!suppliedRequestId && error.code === 'product_not_removable') {
        return c.json({ success: true, changes: 0, already_removed: true })
      }
      return c.json({ success: false, code: error.code, error: error.message }, error.status)
    }
    throw error
  }
  const planDigest = await productRemovePlanDigest(plan)
  const operationId = crypto.randomUUID()
  if (tier === 'review') {
    try { await db.batch(productRemoveQueueStatements({ plan, operationId, requestId, user, planDigest })) }
    catch (error) {
      const replay = suppliedRequestId ? await db.prepare(`SELECT * FROM product_remove_operations
        WHERE actor_id=@actor AND source='direct' AND request_id=@request`).get<ProductRemoveOperationRow>({ actor: user.id, request: requestId }) : null
      if (replay?.status === 'approval_pending' && replay.product_id === id && replay.reason === reason) {
        return c.json({ success: true, pending: true, pendingActionId: replay.pending_action_id,
          operation_id: replay.operation_id, status: replay.status, generation: Number(replay.generation) }, 202)
      }
      return c.json({ success: false, code: 'review_state_conflict', error: 'The product changed before the removal request was queued.' }, 409)
    }
    const queued = await db.prepare('SELECT pending_action_id FROM product_remove_operations WHERE operation_id=@operation')
      .get<{ pending_action_id: number }>({ operation: operationId })
    return c.json({ success: true, pending: true, pendingActionId: Number(queued?.pending_action_id),
      operation_id: operationId, status: 'approval_pending', generation: 0 }, 202)
  }
  const transitionStamp = new Date().toISOString()
  try {
    await db.batch(productRemoveApplyStatements({ plan, operationId, source: 'direct', requestId, user, transitionStamp, planDigest }))
  } catch (error) {
    const replay = await db.prepare(`SELECT * FROM product_remove_operations WHERE actor_id=@actor AND source='direct' AND request_id=@request`)
      .get<ProductRemoveOperationRow>({ actor: user.id, request: requestId })
    if (replay?.status === 'undo_ready' && replay.product_id === id && replay.reason === reason) {
      let response: Record<string, unknown> = {}
      try { response = replay.response_json ? JSON.parse(replay.response_json) : {} } catch { response = {} }
      return c.json({ success: true, ...response, replayed: true })
    }
    return c.json({ success: false, code: 'review_state_conflict', error: 'The product changed before the removal committed.' }, 409)
  }
  const committed = await db.prepare(`SELECT operation_id,product_id,status,action_history_id,generation,response_json
    FROM product_remove_operations WHERE operation_id=@operation`).get<ProductRemoveOperationRow>({ operation: operationId })
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'delete', id }))
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'update' }))
  return c.json({ success: true, changes: 1, operation_id: operationId, product_id: id, status: committed?.status || 'undo_ready',
    action_history_id: committed?.action_history_id ?? null, generation: Number(committed?.generation || 0) })
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
    const { jobId, totalCount } = await createBulkDeleteJob(c.env, 'products', rawIds as number[], reason, { id: user?.id ?? null, name: actorSnapshot(user) })
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
  const user = c.get('user')
  if (!hasPermission(user, 'products')) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const name = String(body.name || '').trim()
  if (!name) return c.json({ error: 'Product name is required' }, 400)
  try {
    await resolveProductImageFields(getDb(c.env), body)
  } catch (error) {
    if (error instanceof ProductImageAssetError) return c.json({ error: error.message, code: error.code }, 409)
    throw error
  }
  const changesImages = productImageFieldsChanged({ image_path: body.image_path })
  if (imagePermissionDenied(user, changesImages)) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  if (!changesImages) omitUnchangedProductImageFields(body)
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

  await audit(c.env, user?.id ?? null, actorSnapshot(user), 'unwire_images', 'product', null, {
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
  const economics = resolveProductMergeEconomics([keeperRow || {}, dupRow || {}])
  const before: Record<string, number> = {}
  const after: Record<string, number> = {}
  const changes: Array<{ field: string; from: number; to: number }> = []
  for (const field of MERGE_PRICE_FIELDS) {
    const from = Number(keeperRow?.[field]) || 0
    // Same fallback chain the fold writes, so the preview cannot promise a
    // price the fold would not actually set.
    const to = Number(economics.merged[field] ?? keeperRow?.[field] ?? 0) || 0
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
  numericIssues: ProductMergeNumericIssue[]
}

export async function readMergeIdentityDiff(
  db: ReturnType<typeof getDb>,
  keeperId: number,
  dupId: number,
): Promise<MergeIdentityDiff> {
  const columns = `id, name, barcode, ${[...MERGE_COST_FIELDS, ...MERGE_PRICE_FIELDS].join(', ')}`
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
  const economics = resolveProductMergeEconomics([keeper || {}, dup || {}])
  for (const field of MERGE_COST_FIELDS) {
    const before = Number(keeper?.[field]) || 0
    const after = Number(economics.merged[field] ?? before) || 0
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
    costOutliers: [],
    numericIssues: economics.issues,
  }
}

export const mergeNumericRefusal = (identity: MergeIdentityDiff): ProductMergeNumericIssue | null =>
  identity.numericIssues[0] ?? null

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

type ProductMergeImagePair = {
  keeper: { id: number; image_path?: string | null }
  discarded: { id: number; image_path?: string | null }
}

// The fold changes image state only when it removes gallery rows from the
// discarded product, or when an empty keeper adopts the discarded primary.
// Reading that exact plan before either merge endpoint writes lets an explicit
// products:image override govern image mutations without blocking a merge
// whose image fields remain untouched.
export async function productMergeChangesImages(
  db: ReturnType<typeof getDb>,
  pairs: ProductMergeImagePair[],
): Promise<boolean> {
  const discardedIds = [...new Set(pairs.map(({ discarded }) => discarded.id).filter((id) => Number.isFinite(id) && id > 0))]
  const galleryProductIds = new Set<number>()
  if (discardedIds.length) {
    const rows = await selectInChunks(discardedIds, 0, (chunk) => {
      const { sql, params } = buildInClause('imageProduct', chunk)
      return db.prepare(`SELECT DISTINCT product_id FROM product_images WHERE product_id IN (${sql})`)
        .all<{ product_id: number }>(params)
    })
    for (const row of rows) galleryProductIds.add(Number(row.product_id))
  }
  return pairs.some(({ keeper, discarded }) =>
    galleryProductIds.has(discarded.id)
    || (!String(keeper.image_path || '').trim() && Boolean(String(discarded.image_path || '').trim())))
}

/** Atomic guard for an image-denied merge whose preflight found no image effect. */
export function productMergeNoImageEffectAssertion(keeperId: number, duplicateId: number) {
  return {
    sql: `SELECT CASE WHEN
      NOT EXISTS(SELECT 1 FROM product_images WHERE product_id = @duplicateId)
      AND NOT EXISTS(
        SELECT 1 FROM products keeper JOIN products duplicate
          ON keeper.id = @keeperId AND duplicate.id = @duplicateId
        WHERE COALESCE(keeper.image_path, '') = '' AND COALESCE(duplicate.image_path, '') != ''
      )
      THEN 1 ELSE json_extract('', '$') END AS merge_image_guard`,
    params: { keeperId, duplicateId },
  }
}

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
  economicsOverride?: ProductMergeEconomics,
  atomicHistory?: {
    operationId: string
    bulkClusterPlan?: ProductMergeClusterPlan
    resumedCluster?: boolean
    preStatements?: Array<{ sql: string; params?: Record<string, unknown> }>
    additionalStatements?: Array<{ sql: string; params?: Record<string, unknown> }>
    auditContext?: Record<string, unknown>
    snapshotContext?: Record<string, unknown>
    preparedSnapshot?: ProductMergeCaseSnapshot
    preparedDependentLotSnapshots?: Map<number, ProductMergeLotSnapshot>
    reviewedPlan?: ProductConflictActionFinalPlan
    reviewedRedo?: boolean
    reviewedCatalogBefore?: MergeReversal['keeperCatalogBefore']
    groupCompletionStatements?: (reversal: MergeReversal) => AtomicMergeStatement[]
  },
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
  operationId: string | null
  committed: boolean
  historyResolved: boolean
  actionHistoryId: number | null
  undoReady: boolean
  reversal: MergeReversal
}> {
  const writeOffStock = stockDisposition === 'write_off'
  const canonicalId = canonical.id
  const canonicalName = canonical.name
  const adjustmentMovementMarker = atomicHistory ? `[merge:${atomicHistory.operationId}]` : ''
  // Snapshot the keeper's current batch set at call time; a group caller
  // folding several duplicates commits each fold before the next call, so
  // a later duplicate sees (and folds into) batches an earlier one moved.
  const snapshot = atomicHistory?.preparedSnapshot
    ?? await readProductMergeCaseSnapshot(db, canonicalId, dup.id, MERGE_REPARENT_TABLES)
  const canonicalBatchRows = snapshot.canonicalBatchRows
  const canonicalBatchIdByKey = new Map<string, number>(canonicalBatchRows.map((b) => [b.batch_key, b.id]))
  let nextCanonicalBatchNumber = canonicalBatchRows.reduce((max, b) => Math.max(max, Number(b.batch_number) || 0), 0) + 1

  const stockRows = snapshot.duplicateStockRows
  // Keeper's branch_stock BEFORE the fold, captured so undo can restore it
  // exactly. The fold adds the dup's per-branch quantity into the keeper (and
  // may create a keeper row for a branch it had none in), so subtracting on
  // undo alone could leave a phantom zero row -- restoring the captured
  // before-image instead is exact.
  const canonicalStockBefore = snapshot.canonicalStockBefore
  // Keeper's image_path BEFORE the fold: the fold adopts the dup's image only
  // when the keeper had none, so undo restores this captured value verbatim.
  type MergeProductPricingRow = { id: number; name: string | null; barcode: string | null; image_path?: string | null; is_active: number; updated_at: string | null; selling_price_usd: number | null; selling_price_khr: number | null; wholesale_price_usd: number | null; wholesale_price_khr: number | null; cost_price_usd: number | null; cost_price_khr: number | null }
  const canonicalBefore = snapshot.canonicalProduct as MergeProductPricingRow | undefined
  const dupPricing = snapshot.duplicateProduct as MergeProductPricingRow | undefined
  const reviewedPlan = atomicHistory?.reviewedPlan
  const reviewedAuthorityValid = reviewedPlan?.authority === 'reviewed_product_conflict_v2'
    && reviewedPlan.keeper_id === canonicalId
    && reviewedPlan.member_ids.includes(dup.id)
    && reviewedPlan.fold_members.some((member) => member.member_id === dup.id && member.operation_id === atomicHistory?.operationId)
  if (!canonicalBefore || !dupPricing || (!reviewedAuthorityValid && !productsShareExactIdentity(canonicalBefore, dupPricing))) {
    throw new Error('merge_identity_conflict')
  }
  if (atomicHistory?.bulkClusterPlan) {
    const plan = atomicHistory.bulkClusterPlan
    const reviewedRedoSourceMatches = (row: Record<string, unknown>) => {
      const source = plan.members.find((candidate) => candidate.id === Number(row.id))
      return Boolean(source && Object.entries(source.money).every(([field, value]) => Number(row[field] ?? 0) === Number(value ?? 0)))
    }
    const keeperMatches = atomicHistory.reviewedRedo
      ? (atomicHistory.resumedCluster ? productMergePlanKeeperMatches(plan, canonicalBefore) : reviewedRedoSourceMatches(canonicalBefore))
      : atomicHistory.resumedCluster
        ? productMergePlanKeeperMatches(plan, canonicalBefore)
        : productMergePlanSourceMemberMatches(plan, canonicalBefore)
    const duplicateMatches = atomicHistory.reviewedRedo
      ? reviewedRedoSourceMatches(dupPricing)
      : productMergePlanSourceMemberMatches(plan, dupPricing)
    if (!keeperMatches || !duplicateMatches) {
      throw new Error('merge_cluster_plan_conflict')
    }
  }
  // Selling AND wholesale price: highest of the two rows wins (see
  // resolveMergedPricing). Both SELECTs above name wholesale_price_*, not the
  // retired special_price_* pair -- migration 0111 moved the discounted tier
  // across and zeroed the old columns, so while this path still read them the
  // merge resolved max(0, 0) and a folded-away duplicate's wholesale price was
  // deactivated with its row. Nothing threw; the number simply left the
  // catalogue. The dead pair is written by nothing here on purpose.
  const mergedEconomics = atomicHistory?.bulkClusterPlan
    ? resolveProductMergeClusterPlanEconomics(atomicHistory.bulkClusterPlan)
    : economicsOverride ?? resolveProductMergeEconomics([canonicalBefore, dupPricing])
  if (mergedEconomics.issues.length) throw new Error(`merge_numeric_invalid:${productMergeNumericError(mergedEconomics.issues)}`)
  // Cost is no longer identity (Sep 4 2026), so folding a duplicate must also
  // reconcile the two costs rather than silently keeping the keeper's: the
  // survivor carries the mean of the distinct costs, rounded up to 4dp.
  //
  // Detail form, not the plain resolveMergedCost: the rule refuses to average
  // two costs more than COST_OUTLIER_RATIO apart (it keeps the higher one
  // instead of inventing a mean nobody paid), and a merge that rewrote a cost
  // on that basis must say so. `costOutliers` rides out through the audit
  // entry and both merge responses.
  const mergedPricing = mergedEconomics.merged
  const mergedCost = mergedEconomics.merged
  const costOutliers: MergedCostOutlier[] = []
  const canonicalBarcode = reviewedAuthorityValid ? reviewedPlan.selected.barcode.value : canonicalProductBarcode([canonicalBefore, dupPricing])
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
  const dupBatchRows = snapshot.duplicateBatchRows
  // Images were the one thing this merge silently threw away: branch_stock,
  // inventory_movements and product_batches were all carried over, but the
  // duplicate's gallery (product_images) and its image_path were left
  // attached to a row that is about to be deactivated -- so a photo the
  // duplicate carried and the canonical didn't simply vanished from the
  // catalog. That breaks the standing rule that images follow a product
  // through a rename or a regroup.
  const dupImageRows = snapshot.duplicateImageRows
  const canonicalImageRows = snapshot.canonicalImageRows
  const canonicalImagePaths = new Set(canonicalImageRows.map((r) => String(r.image_path)))
  let nextCanonicalImageOrder = canonicalImageRows.length

  const canChangeProductImages = getActionTier(user, 'products', 'image') === 'full'
  const statements: Array<{ sql: string; params?: Record<string, unknown> }> = [
    productMergeCasAssertion([canonicalBefore, dupPricing]),
    ...(atomicHistory?.preStatements || []),
  ]
  if (!canChangeProductImages) {
    statements.push(productMergeNoImageEffectAssertion(canonicalId, dup.id))
  }
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
          reason: writeOffReason(dup, `${mergeContext}${adjustmentMovementMarker ? ` ${adjustmentMovementMarker}` : ''}`),
          userId: user?.id ?? null,
          userName: actorSnapshot(user),
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
        reason: `Merged duplicate product "${dup.name}" (#${dup.id}) into this product -- ${mergeContext}${adjustmentMovementMarker ? ` ${adjustmentMovementMarker}` : ''}`,
        userId: user?.id ?? null,
        userName: actorSnapshot(user),
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
  if (canChangeProductImages) {
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
  }

  statements.push({ sql: 'UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = @id', params: { id: dup.id } })
  statements.push({
    sql: `UPDATE products
          SET selling_price_usd = @sellingUsd,
              selling_price_khr = @sellingKhr,
              wholesale_price_usd = @wholesaleUsd,
              wholesale_price_khr = @wholesaleKhr,
              cost_price_usd = @costUsd,
              cost_price_khr = @costKhr,
              barcode = @barcode,
              category = CASE WHEN @reviewed = 1 THEN @category ELSE category END,
              categories = CASE WHEN @reviewed = 1 THEN @categories ELSE categories END,
              brand = CASE WHEN @reviewed = 1 THEN @brand ELSE brand END,
              brands = CASE WHEN @reviewed = 1 THEN @brands ELSE brands END,
              brand_compact = CASE WHEN @reviewed = 1 THEN @brandCompact ELSE brand_compact END,
              unit = CASE WHEN @reviewed = 1 THEN @unit ELSE unit END,
              unit_normalized = CASE WHEN @reviewed = 1 THEN @unitNormalized ELSE unit_normalized END,
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
      barcode: canonicalBarcode,
      reviewed: reviewedAuthorityValid ? 1 : 0,
      category: reviewedAuthorityValid ? reviewedPlan.selected.category.value : null,
      categories: reviewedAuthorityValid ? reviewedPlan.selected.category.categories : null,
      brand: reviewedAuthorityValid ? reviewedPlan.selected.brand.value : null,
      brands: reviewedAuthorityValid ? reviewedPlan.selected.brand.brands : null,
      brandCompact: reviewedAuthorityValid ? reviewedPlan.selected.brand.brand_compact : null,
      unit: reviewedAuthorityValid ? reviewedPlan.selected.unit.value : null,
      unitNormalized: reviewedAuthorityValid ? reviewedPlan.selected.unit.unit_normalized : null,
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
  const dependentLotSnapshots = atomicHistory?.preparedDependentLotSnapshots
    ?? await readProductMergeDependentLotSnapshots(db, snapshot, stockDisposition)
  for (const batchRow of dupBatchRows) {
    if (writeOffStock) {
      // REMOVE: the lot belonged to the row being discarded, so it does not
      // travel. Its branch_batch_stock is cleared and the lot row itself is
      // deactivated in place (never deleted) because
      // sale_item_batch_allocations / return_item_batch_allocations may still
      // point at its id. batch_number is left exactly as it was -- this path
      // writes no batch_number at all, so it cannot introduce a TEXT value into
      // that INTEGER column the way the RECON import once did.
      const lotSnapshot = dependentLotSnapshots.get(Number(batchRow.id))
      if (!lotSnapshot) throw new Error('merge_snapshot_incomplete')
      const dupBatchStockRows = lotSnapshot.duplicateStockRows
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
      const lotSnapshot = dependentLotSnapshots.get(Number(batchRow.id))
      if (!lotSnapshot) throw new Error('merge_snapshot_incomplete')
      const dupBatchStockRows = lotSnapshot.duplicateStockRows
      const keeperBatchStockBefore = lotSnapshot.keeperStockBefore
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
        saleAllocationIds: lotSnapshot.saleAllocationIds,
        returnAllocationIds: lotSnapshot.returnAllocationIds,
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
  const reparentedByTable = snapshot.reparentedByTable
  for (const { table, column, ids } of reparentedByTable) {
    statements.push({
      sql: `UPDATE ${table} SET ${column} = @canonicalId WHERE ${column} = @dupId`,
      params: { canonicalId, dupId: dup.id },
    })
  }
  // promotion_rules.product_ids: a LIVE product link the walk above structurally
  // cannot reach -- it is a JSON array of ids inside a TEXT column, not an
  // INTEGER FK, so neither MERGE_REPARENT_TABLES nor the migration sweep that
  // keeps that list honest can see it. promotionRules.ts decides a rule by
  // `rule.product_ids.includes(product.id)`, so a rule scoped to the discarded
  // row stopped applying to anything the instant this fold deactivated that row:
  // the discount left the catalogue with no trace. Rewrite the id in place,
  // de-duplicating (a rule scoped to BOTH rows must not end up naming the keeper
  // twice) and keeping the order and any non-numeric entry untouched. The
  // previous array is captured verbatim so undo restores the exact string.
  // The table is small by design (promotionRulesSql.ts reads it whole), so this
  // is one unfiltered SELECT rather than a LIKE guess at JSON contents.
  const promotionRuleRows = snapshot.promotionRuleRows
  const promotionRulesBefore: Array<{ id: number; product_ids: string }> = []
  for (const rule of promotionRuleRows) {
    const raw = String(rule.product_ids ?? '')
    let parsed: unknown
    try { parsed = JSON.parse(raw || '[]') } catch { continue }
    if (!Array.isArray(parsed)) continue
    if (!parsed.some((entry) => Number(entry) === dup.id)) continue
    const seenIds = new Set<number>()
    const next: unknown[] = []
    for (const entry of parsed) {
      const mapped = Number(entry) === dup.id ? canonicalId : entry
      const asNumber = Number(mapped)
      if (Number.isFinite(asNumber)) {
        if (seenIds.has(asNumber)) continue
        seenIds.add(asNumber)
      }
      next.push(mapped)
    }
    promotionRulesBefore.push({ id: Number(rule.id), product_ids: raw })
    statements.push({
      sql: 'UPDATE promotion_rules SET product_ids = @ids, updated_at = CURRENT_TIMESTAMP WHERE id = @ruleId',
      params: { ids: JSON.stringify(next), ruleId: Number(rule.id) },
    })
  }

  // products.parent_id: the other live product link that is not a *product_id
  // column. A child variant still pointing at the discarded row would be left
  // rooted on a row this fold is about to deactivate (familyPagination.ts joins
  // `parent.id = p.parent_id`), so it falls out of its own family. Move the
  // children onto the keeper -- except the keeper itself, which cannot become
  // its own parent: if the keeper WAS a child of the discarded row, that link is
  // cleared instead (and captured, so undo restores it).
  const childProductRows = snapshot.childProductRows
  const reparentedChildProductIds = childProductRows
    .map((row) => Number(row.id))
    .filter((childId) => Number.isFinite(childId) && childId !== canonicalId)
  const keeperWasChildOfDup = childProductRows.some((row) => Number(row.id) === canonicalId)
  if (reparentedChildProductIds.length) {
    statements.push({
      sql: 'UPDATE products SET parent_id = @canonicalId, updated_at = CURRENT_TIMESTAMP WHERE parent_id = @dupId AND id != @canonicalId',
      params: { canonicalId, dupId: dup.id },
    })
  }
  if (keeperWasChildOfDup) {
    statements.push({
      sql: 'UPDATE products SET parent_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = @canonicalId',
      params: { canonicalId },
    })
  }

  const byTable = (table: string): number[] => reparentedByTable.find((e) => e.table === table)?.ids ?? []
  const reparentedSaleItemIds = byTable('sale_items')
  const reparentedMovementIds = byTable('inventory_movements')
  const returnsReparented = byTable('return_items').length + byTable('return_replacement_items').length

  const auditDetails = {
    productName: dup.name,
    mergedIntoProductId: canonicalId,
    mergedIntoProductName: canonicalName,
    canonicalBarcode,
    stockDisposition,
    priceChanges: priceChangesForAudit,
    batchesMoved: batchesMovedThisDup,
    batchesFoldedIntoExistingLot: batchesFoldedThisDup,
    batchesWrittenOff: batchesWrittenOffThisDup,
    quantityMoved,
    quantityWrittenOff,
    lotsWrittenOff: writtenOffLotDetail,
    imagesMoved: imagesMovedThisDup,
    salesReparented: reparentedSaleItemIds.length,
    movementsReparented: reparentedMovementIds.length,
    returnsReparented,
    promotionRulesRescoped: promotionRulesBefore.map((rule) => rule.id),
    childrenReparented: reparentedChildProductIds.length,
    reparentedTables: reparentedByTable.map((e) => `${e.table}:${e.ids.length}`),
    ...(atomicHistory?.auditContext || {}),
  }
  const reversal: MergeReversal & { selectedConflictContext?: Record<string, unknown> } = {
    keeperId: canonicalId,
    keeperName: canonicalName,
    dupId: dup.id,
    dupName: dup.name ?? null,
    keeperImagePathBefore: canonicalBefore?.image_path ?? null,
    dupImagePathBefore: dup.image_path ?? null,
    keeperBarcodeBefore: canonicalBefore?.barcode ?? null,
    ...(atomicHistory?.reviewedCatalogBefore ? { keeperCatalogBefore: atomicHistory.reviewedCatalogBefore } : {}),
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
    promotionRulesBefore,
    reparentedChildProductIds,
    keeperParentIdBefore: keeperWasChildOfDup ? dup.id : null,
    adjustmentMovementIds: [],
    ...(adjustmentMovementMarker ? { adjustmentMovementMarker } : {}),
    stockDisposition,
    mergeContext,
    ...(atomicHistory?.bulkClusterPlan ? { bulkClusterPlan: atomicHistory.bulkClusterPlan } : {}),
    ...(atomicHistory ? { operationId: atomicHistory.operationId } : {}),
    ...(atomicHistory?.snapshotContext ? { selectedConflictContext: atomicHistory.snapshotContext } : {}),
  }

  const chunksOf80 = (count: number) => Math.ceil(Math.max(0, count) / 80)
  const fingerprintStatementCount = 7
    + chunksOf80(new Set([
      ...repointedBatches.map((batch) => batch.id),
      ...foldedBatches.flatMap((batch) => [batch.dupBatchId, batch.keeperBatchId]),
      ...writtenOffBatches.map((batch) => batch.batchId),
    ]).size)
    + (adjustmentMovementMarker ? 1 : chunksOf80(reversal.adjustmentMovementIds?.length || 0))
    + reparentedByTable.reduce((count, entry) => count + chunksOf80(new Set(entry.ids).size), 0)
    + chunksOf80(new Set(promotionRulesBefore.map((rule) => rule.id)).size)
    + chunksOf80(new Set(reparentedChildProductIds).size)
    + chunksOf80(new Set(foldedBatches.flatMap((batch) => batch.saleAllocationIds || [])).size)
    + chunksOf80(new Set(foldedBatches.flatMap((batch) => batch.returnAllocationIds || [])).size)
  if (fingerprintStatementCount > PRODUCT_MERGE_READ_BATCH_MAX_STATEMENTS) {
    throw new Error('merge_case_fingerprint_statement_budget_exceeded')
  }

  // Product stock caches and durable history belong to this case's transaction.
  // A failure at any later statement rolls the graph mutations back as well.
  statements.push(
    { sql: 'UPDATE products SET stock_quantity=(SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id=@id),updated_at=CURRENT_TIMESTAMP WHERE id=@id', params: { id: canonicalId } },
    { sql: 'UPDATE products SET stock_quantity=(SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id=@id),updated_at=CURRENT_TIMESTAMP WHERE id=@id', params: { id: dup.id } },
  )
  if (atomicHistory?.additionalStatements?.length) statements.push(...atomicHistory.additionalStatements)
  // Record the exact result slots before appending the fixed snapshot/history/
  // audit trio. D1 returns one result per statement in input order.
  let atomicHistoryStatementIndexes: { snapshot: number; actionHistory: number } | null = null
  if (atomicHistory?.groupCompletionStatements) statements.push(...atomicHistory.groupCompletionStatements(reversal))
  else if (atomicHistory) {
    atomicHistoryStatementIndexes = { snapshot: statements.length, actionHistory: statements.length + 1 }
    statements.push(...buildAtomicMergeHistoryStatements(user, reversal, atomicHistory.operationId, auditDetails))
  }

  // Keep each atomic write batch within the same conservative 100-statement
  // bound used by the catalog's D1 query chunking. Refuse before the first
  // write so an unusually linked product cannot create an ambiguous outcome.
  if (statements.length > 100) throw new Error('merge_case_statement_budget_exceeded')

  let batchResults: Array<{ meta?: { last_row_id?: number } }> = []
  try {
    batchResults = await db.batch(statements)
  } catch (error) {
    if (/malformed JSON|merge_guard/i.test(String(error))) throw new Error('merge_state_conflict')
    throw error
  }

  // The stock-fold inserted one 'adjustment' inventory_movement per branch on
  // the keeper; capture their ids now (right after the batch, when exactly this
  // fold's rows carry the dup-specific reason fragment -- the dup is now
  // inactive and cannot be re-merged, so no other rows can match) so undo
  // deletes those exact rows by id rather than by a fragile reason match.
  // A WRITE-OFF's balancing rows were written on the DUP and then carried onto
  // the keeper by the reparent pass, so they answer to the keeper id here just
  // like the merge path's adjustments. Both fragments are matched so undo
  // deletes exactly this fold's own rows whichever disposition ran.
  const adjustmentMovementIds = atomicHistory ? [] : (await db
    .prepare(`SELECT id FROM inventory_movements
              WHERE product_id = @keeperId AND movement_type = 'adjustment'
                AND (reason LIKE @frag OR reason LIKE @writeOffFrag)`)
    .all<{ id: number }>({
      keeperId: canonicalId,
      frag: `%(#${dup.id}) into this product%`,
      writeOffFrag: `%${writeOffMarker(dup.id)}%`,
    })).map((r) => Number(r.id))
  reversal.adjustmentMovementIds = adjustmentMovementIds

  if (!atomicHistory) await audit(env, user?.id ?? null, actorSnapshot(user), 'merge_duplicate', 'product', dup.id, auditDetails)
  let knownAtomicHistoryIds: AtomicMergeKnownIds | undefined
  if (atomicHistoryStatementIndexes) {
    const snapshotId = Number(batchResults[atomicHistoryStatementIndexes.snapshot]?.meta?.last_row_id)
    const actionHistoryId = Number(batchResults[atomicHistoryStatementIndexes.actionHistory]?.meta?.last_row_id)
    if (Number.isSafeInteger(snapshotId) && snapshotId > 0 && Number.isSafeInteger(actionHistoryId) && actionHistoryId > 0) {
      knownAtomicHistoryIds = { snapshotId, actionHistoryId }
    }
  }
  const atomicRecord = atomicHistory && !atomicHistory.groupCompletionStatements
    ? (knownAtomicHistoryIds
      ? await finalizeAtomicMergeHistory(env, atomicHistory.operationId, reversal, db, knownAtomicHistoryIds)
      : await finalizeAtomicMergeHistory(env, atomicHistory.operationId, reversal, db))
    : null

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
    operationId: atomicRecord?.operationId ?? null,
    committed: atomicRecord?.committed ?? true,
    historyResolved: atomicRecord?.historyResolved ?? !atomicHistory,
    actionHistoryId: atomicRecord?.actionHistoryId ?? null,
    undoReady: atomicRecord?.fingerprintReady ?? !atomicHistory,
    reversal,
  }
}

// Hand the fold to the undo/redo registry so the 'product.merge' applier can
// re-run this exact production merge on REDO, without the lib importing this
// route module (which would be a lib->route dependency and an import cycle,
// since this file imports MergeReversal from there). See lib/undoAppliers.ts.
registerMergeFold(foldDuplicateProductInto)

type DuplicatePreviewStockRow = { branch_id: number; quantity: number }
type DuplicatePreviewCatalog = {
  moneyByProductId: Map<number, Record<string, unknown>>
  stockByProductId: Map<number, DuplicatePreviewStockRow[]>
  activeBatchCountByProductId: Map<number, number>
  complexLinkedProductIds: Set<number>
  appliedPlansByKeeperId: Map<number, ProductMergeClusterPlan[]>
  planHistoryUnavailable: boolean
}

const MERGE_DUPLICATES_MULTI_PREFLIGHT_MAX_PRODUCT_IDS = 600
const MERGE_DUPLICATES_MULTI_PREFLIGHT_STATEMENTS_PER_CHUNK = 16
const MERGE_PLAN_HISTORY_MAX_ROWS_PER_KEEPER_CHUNK = 8
const MERGE_PLAN_HISTORY_MAX_ROWS_TOTAL = 64
const MERGE_PLAN_HISTORY_MAX_PLAN_BYTES = 4_096
const MERGE_PLAN_HISTORY_MAX_BYTES_TOTAL = 256 * 1_024
const MERGE_PLAN_KEEPER_INDEX_SQL = `CASE WHEN json_valid(payload_json)
  THEN CAST(json_extract(payload_json,'$.bulkClusterPlan.keeperId') AS INTEGER)
  ELSE NULL END`
const MERGE_PLAN_IDENTITY_INDEX_SQL = `CASE WHEN json_valid(payload_json)
  THEN json_extract(payload_json,'$.bulkClusterPlan.identityKey')
  ELSE NULL END`

function multiClusterComplexLinkPlan(
  groups: Awaited<ReturnType<typeof findDuplicateProductGroups>>,
): { statements: Array<{ sql: string; params: Record<string, unknown> }>; assumedComplexIds: number[] } {
  const allIds = [...new Set(groups
    .filter((group) => group.duplicates.length > 1)
    .flatMap((group) => [group.canonical.id, ...group.duplicates.map((duplicate) => duplicate.id)]))]
  const ids = allIds.slice(0, MERGE_DUPLICATES_MULTI_PREFLIGHT_MAX_PRODUCT_IDS)
  const statements = chunkForBinding(ids).map((chunk) => {
    const { sql, params } = buildInClause('complexProduct', chunk)
    return [
      { sql: `SELECT DISTINCT product_id FROM branch_stock WHERE product_id IN (${sql})`, params },
      { sql: `SELECT DISTINCT product_id FROM product_images WHERE product_id IN (${sql})`, params },
      { sql: `SELECT id AS product_id FROM products WHERE id IN (${sql}) AND NULLIF(TRIM(image_path),'') IS NOT NULL`, params },
      { sql: `SELECT DISTINCT variant_product_id AS product_id FROM product_batches WHERE variant_product_id IN (${sql})`, params },
      ...MERGE_REPARENT_TABLES.map(({ table, column }) => ({
        sql: `SELECT DISTINCT ${column} AS product_id FROM ${table} WHERE ${column} IN (${sql})`,
        params,
      })),
      { sql: `SELECT DISTINCT parent_id AS product_id FROM products WHERE parent_id IN (${sql})`, params },
      {
        sql: `SELECT DISTINCT CAST(j.value AS INTEGER) AS product_id
              FROM promotion_rules pr,
                   json_each(CASE WHEN json_valid(pr.product_ids) THEN pr.product_ids ELSE '[]' END) j
              WHERE CAST(j.value AS INTEGER) IN (${sql})`,
        params,
      },
    ]
  }).flat()
  if (statements.length > MERGE_DUPLICATES_MULTI_PREFLIGHT_STATEMENTS_PER_CHUNK * 6) {
    throw new Error('merge_complex_preflight_statement_budget_exceeded')
  }
  return {
    statements,
    // Catalogs with more than 600 members in multi-row clusters remain safe:
    // uninspected clusters are blocked whole in both preview and POST rather
    // than spending the request's mutation reserve on additional preflight.
    assumedComplexIds: allIds.slice(MERGE_DUPLICATES_MULTI_PREFLIGHT_MAX_PRODUCT_IDS),
  }
}

async function readMultiClusterComplexProductIds(
  db: ReturnType<typeof getDb>,
  groups: Awaited<ReturnType<typeof findDuplicateProductGroups>>,
): Promise<Set<number>> {
  const plan = multiClusterComplexLinkPlan(groups)
  const statements = plan.statements
  const results = statements.length ? await db.batch(statements) : []
  return new Set([...plan.assumedComplexIds, ...results.flatMap((result) => Array.isArray(result.results)
    ? result.results.map((row) => Number((row as { product_id?: unknown }).product_id))
    : []).filter((id) => Number.isSafeInteger(id) && id > 0)])
}

/**
 * Hydrate every product the preview will render in one bounded catalog pass.
 *
 * The duplicate detector already returns the complete member ids. Reading
 * stock, active-batch counts and current money again inside each group's map
 * turned a 2,000-group preview into roughly 6,000 D1 round trips. Chunking the
 * unique catalog member set keeps every statement within D1's 100-bind limit
 * and makes the read count proportional to catalog rows rather than groups.
 * The bounded statements are sent through one D1 read batch so production
 * pays one storage round trip instead of one round trip per 100 products.
 * The correlated batch count uses the existing variant-product index; joining
 * batches directly would multiply branch rows and corrupt quantities.
 */
async function readDuplicatePreviewCatalog(
  db: ReturnType<typeof getDb>,
  groups: Awaited<ReturnType<typeof findDuplicateProductGroups>>,
): Promise<DuplicatePreviewCatalog> {
  const memberIds = [...new Set(groups.flatMap((group) => [
    group.canonical.id,
    ...group.duplicates.map((duplicate) => duplicate.id),
  ]))]
  const readStatements = chunkForBinding(memberIds).map((chunk) => {
    const { sql, params } = buildInClause('id', chunk)
    return {
      sql: `
      SELECT p.id, p.updated_at, ${[...MERGE_COST_FIELDS, ...MERGE_PRICE_FIELDS].map((field) => `p.${field}`).join(', ')},
             bs.branch_id, bs.quantity,
             (SELECT COUNT(*) FROM product_batches pb
              WHERE pb.variant_product_id=p.id AND pb.is_active=1) AS active_batch_count
      FROM products p
      LEFT JOIN branch_stock bs ON bs.product_id=p.id
      WHERE p.id IN (${sql})
      ORDER BY p.id ASC, bs.branch_id ASC
    `,
      params,
    }
  })
  const complexLinkPlan = multiClusterComplexLinkPlan(groups)
  const complexLinkStatements = complexLinkPlan.statements
  const appliedPlanStatements = chunkForBinding([...new Set(groups.map((group) => group.canonical.id))]).map((chunk) => {
    const { sql, params } = buildInClause('planKeeper', chunk)
    return {
      sql: `
        SELECT id,
          length(CAST(json_extract(payload_json,'$.bulkClusterPlan') AS BLOB)) AS plan_bytes,
          CASE WHEN length(CAST(json_extract(payload_json,'$.bulkClusterPlan') AS BLOB)) <= ${MERGE_PLAN_HISTORY_MAX_PLAN_BYTES}
            THEN json_extract(payload_json,'$.bulkClusterPlan') ELSE NULL END AS plan_json
        FROM undo_snapshots INDEXED BY idx_undo_product_merge_plan_keeper
        WHERE kind='product.merge' AND status='applied' AND json_valid(payload_json)=1
          AND ${MERGE_PLAN_KEEPER_INDEX_SQL} IN (${sql})
        ORDER BY id DESC
        LIMIT ${MERGE_PLAN_HISTORY_MAX_ROWS_PER_KEEPER_CHUNK + 1}
      `,
      params,
    }
  })
  const invalidPlanHistoryStatement = {
    sql: `SELECT 1 AS invalid_json
      FROM undo_snapshots INDEXED BY idx_undo_product_merge_invalid_json
      WHERE kind='product.merge' AND status='applied' AND json_valid(payload_json)=0
      LIMIT 1`,
    params: {},
  }
  const batchedResults = readStatements.length || complexLinkStatements.length
    ? await db.batch([...readStatements, ...complexLinkStatements, ...appliedPlanStatements, invalidPlanHistoryStatement])
    : []
  const readResults = batchedResults.slice(0, readStatements.length)
  const complexLinkResults = batchedResults.slice(readStatements.length, readStatements.length + complexLinkStatements.length)
  const planResultsStart = readStatements.length + complexLinkStatements.length
  const appliedPlanResults = batchedResults.slice(planResultsStart, planResultsStart + appliedPlanStatements.length)
  const invalidPlanHistoryRows = batchedResults[planResultsStart + appliedPlanStatements.length]?.results || []
  const rows = readResults.flatMap((result) => Array.isArray(result.results)
    ? result.results as Record<string, unknown>[]
    : [])

  const moneyByProductId = new Map<number, Record<string, unknown>>()
  const stockByProductId = new Map<number, DuplicatePreviewStockRow[]>()
  const activeBatchCountByProductId = new Map<number, number>()
  const appliedPlansByKeeperId = new Map<number, ProductMergeClusterPlan[]>()
  let planHistoryUnavailable = invalidPlanHistoryRows.length > 0
  let planHistoryRows = 0
  let planHistoryBytes = 0
  const complexLinkedProductIds = new Set([...complexLinkPlan.assumedComplexIds, ...complexLinkResults.flatMap((result) => Array.isArray(result.results)
    ? result.results.map((row) => Number((row as { product_id?: unknown }).product_id))
    : []).filter((id) => Number.isSafeInteger(id) && id > 0)])
  for (const row of rows) {
    const productId = Number(row.id)
    if (!Number.isSafeInteger(productId) || productId <= 0) continue
    if (!moneyByProductId.has(productId)) {
      moneyByProductId.set(productId, {
        id: productId,
        updated_at: row.updated_at,
        ...Object.fromEntries([...MERGE_COST_FIELDS, ...MERGE_PRICE_FIELDS].map((field) => [field, row[field]])),
      })
      activeBatchCountByProductId.set(productId, Number(row.active_batch_count) || 0)
    }
    const branchId = Number(row.branch_id)
    if (!Number.isSafeInteger(branchId) || branchId <= 0) continue
    if (!stockByProductId.has(productId)) stockByProductId.set(productId, [])
    stockByProductId.get(productId)!.push({ branch_id: branchId, quantity: Number(row.quantity) || 0 })
  }
  for (const result of appliedPlanResults) {
    const planRows = (result.results || []) as Array<{ plan_bytes?: unknown; plan_json?: unknown }>
    if (planRows.length > MERGE_PLAN_HISTORY_MAX_ROWS_PER_KEEPER_CHUNK) planHistoryUnavailable = true
    for (const row of planRows.slice(0, MERGE_PLAN_HISTORY_MAX_ROWS_PER_KEEPER_CHUNK)) {
      const planBytes = Number(row.plan_bytes)
      planHistoryRows += 1
      planHistoryBytes += Number.isFinite(planBytes) && planBytes >= 0 ? planBytes : MERGE_PLAN_HISTORY_MAX_PLAN_BYTES + 1
      if (planHistoryRows > MERGE_PLAN_HISTORY_MAX_ROWS_TOTAL
        || planHistoryBytes > MERGE_PLAN_HISTORY_MAX_BYTES_TOTAL
        || !Number.isFinite(planBytes) || planBytes < 0 || planBytes > MERGE_PLAN_HISTORY_MAX_PLAN_BYTES
        || typeof row.plan_json !== 'string') {
        planHistoryUnavailable = true
        continue
      }
      try {
        const plan = parseProductMergeClusterPlan(JSON.parse(row.plan_json))
        if (!plan) {
          planHistoryUnavailable = true
          continue
        }
        const plans = appliedPlansByKeeperId.get(plan.keeperId)
        if (plans) plans.push(plan)
        else appliedPlansByKeeperId.set(plan.keeperId, [plan])
      } catch { planHistoryUnavailable = true }
    }
  }
  return {
    moneyByProductId, stockByProductId, activeBatchCountByProductId,
    complexLinkedProductIds, appliedPlansByKeeperId, planHistoryUnavailable,
  }
}

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
  const previewCatalog = await readDuplicatePreviewCatalog(db, groups)

  const previewGroups = groups.map((group) => {
      const duplicateIds = group.duplicates.map((d) => d.id)

      const branchQtyById = new Map<number, number>()
      let totalQuantityToMove = 0
      for (const duplicateId of duplicateIds) {
        for (const row of previewCatalog.stockByProductId.get(duplicateId) || []) {
          const qty = Number(row.quantity) || 0
          if (!qty) continue
          branchQtyById.set(row.branch_id, (branchQtyById.get(row.branch_id) || 0) + qty)
          totalQuantityToMove += qty
        }
      }
      const branchBreakdown = [...branchQtyById.entries()]
        .map(([branchId, quantity]) => ({ branchId, branchName: branchNameById.get(branchId) || null, quantity }))
        .sort((a, b) => (a.branchName || '').localeCompare(b.branchName || ''))

      const duplicates = group.duplicates.map((dup) => ({
        id: dup.id,
        name: dup.name,
        barcode: dup.barcode,
        quantity: (previewCatalog.stockByProductId.get(dup.id) || []).reduce((sum, row) => sum + (Number(row.quantity) || 0), 0),
        batchCount: previewCatalog.activeBatchCountByProductId.get(dup.id) || 0,
      }))

      // WHAT THIS RUN WILL DO TO THE COST, which no preview said before.
      // A merge takes one mean over the whole cluster's distinct valid
      // non-zero costs. It never averages an already-averaged keeper again.
      const costRows = [group.canonical.id, ...duplicateIds]
        .map((id) => previewCatalog.moneyByProductId.get(id))
        .filter((row): row is Record<string, unknown> => !!row)
      const costById = new Map(costRows.map((r) => [Number(r.id), r]))
      const canonicalCost = costById.get(group.canonical.id) || {}
      const costBefore = {
        cost_price_usd: Number(canonicalCost.cost_price_usd) || 0,
        cost_price_khr: Number(canonicalCost.cost_price_khr) || 0,
      }
      const identityKey = JSON.stringify([normalizeProductGroupName(group.canonical.name), identityBarcodeKey(group.canonical.barcode)])
      const persistedPlan = selectAppliedBulkClusterPlan(
        previewCatalog.appliedPlansByKeeperId.get(group.canonical.id) || [],
        group.canonical.id,
        identityKey,
        duplicateIds,
      )
      const hasPlanConflict = Boolean(persistedPlan) && (
        [group.canonical.id, ...duplicateIds].some((id) => !persistedPlan!.memberIds.includes(id))
        || !productMergePlanKeeperMatches(persistedPlan!, canonicalCost)
        || duplicateIds.some((id) => !productMergePlanSourceMemberMatches(persistedPlan!, costById.get(id) || {}))
      )
      const economics = persistedPlan && !hasPlanConflict
        ? resolveProductMergeClusterPlanEconomics(persistedPlan)
        : resolveProductMergeEconomics(costRows)
      const costUnavailable = previewCatalog.planHistoryUnavailable || hasPlanConflict
      const costAfter = {
        cost_price_usd: costUnavailable ? costBefore.cost_price_usd : Number(economics.merged.cost_price_usd ?? costBefore.cost_price_usd) || 0,
        cost_price_khr: costUnavailable ? costBefore.cost_price_khr : Number(economics.merged.cost_price_khr ?? costBefore.cost_price_khr) || 0,
      }
      const groupMemberIds = [group.canonical.id, ...duplicateIds]
      const mergeBlockers = previewCatalog.planHistoryUnavailable ? [{
          code: 'merge_plan_history_unavailable',
          error: 'Saved merge-plan history could not be read within its safety limit. This group remains unchanged until the history is repaired or reconciled.',
        }] : hasPlanConflict ? [{
          code: 'merge_cluster_plan_conflict',
          error: 'This partially saved identity group changed after its original plan. Review it before resuming; no further member will be merged.',
        }] : group.duplicates.length > MERGE_DUPLICATES_MAX_DUPLICATES_PER_CLUSTER ? [{
          code: 'cluster_exceeds_atomic_limit',
          error: `This ${group.duplicates.length + 1}-row identity cluster exceeds the safe atomic merge limit and needs a dedicated manifest.`,
        }] : group.duplicates.length > 1 && groupMemberIds.some((id) => previewCatalog.complexLinkedProductIds.has(id)) ? [{
          code: 'cluster_requires_manifest',
          error: 'This multi-row identity cluster has linked stock or history. It remains unchanged and needs a dedicated manifest.',
        }] : []

      return {
        caseKeys: group.duplicates.map((dup) => productMergeCaseKey(group.canonical.id, dup.id)),
        canonicalId: group.canonical.id,
        canonicalName: group.canonical.name,
        canonicalBarcode: canonicalProductBarcode([group.canonical, ...group.duplicates]),
        duplicates,
        totalQuantityToMove,
        branchBreakdown,
        costBefore,
        costAfter,
        mergeable: mergeBlockers.length === 0 && economics.issues.length === 0,
        mergeBlockers,
        // Pairs this run will REFUSE, named in the dry run rather than
        // discovered afterwards in the response.
        costRefusals: economics.issues.map((issue) => ({
          mergedId: issue.rowId,
          field: issue.field,
          code: issue.code,
          error: productMergeNumericError([issue]),
        })),
      }
    })

  return c.json({
    success: true,
    groupCount: previewGroups.length,
    duplicateProductCount: previewGroups.reduce((sum, g) => sum + g.duplicates.length, 0),
    mergeableDuplicateProductCount: previewGroups.reduce((sum, g) => sum + (g.mergeable ? g.duplicates.length : 0), 0),
    blockedGroupCount: previewGroups.filter((group) => !group.mergeable).length,
    groups: previewGroups,
    costRefusalCount: previewGroups.reduce((sum, g) => sum + g.costRefusals.length, 0),
    batchLimit: 25,
  })
})

async function readAppliedBulkClusterPlan(
  db: ReturnType<typeof getDb>,
  keeperId: number,
  identityKey: string,
  activeDuplicateIds: readonly number[],
): Promise<{ plan: ProductMergeClusterPlan | null; unavailable: boolean }> {
  if (!activeDuplicateIds.length) return { plan: null, unavailable: false }
  const [planResult, invalidHistoryResult] = await db.batch([
    {
      sql: `SELECT id,
          length(CAST(json_extract(payload_json,'$.bulkClusterPlan') AS BLOB)) AS plan_bytes,
          CASE WHEN length(CAST(json_extract(payload_json,'$.bulkClusterPlan') AS BLOB)) <= ${MERGE_PLAN_HISTORY_MAX_PLAN_BYTES}
            THEN json_extract(payload_json,'$.bulkClusterPlan') ELSE NULL END AS plan_json
        FROM undo_snapshots INDEXED BY idx_undo_product_merge_plan_keeper
        WHERE kind='product.merge' AND status='applied' AND json_valid(payload_json)=1
          AND ${MERGE_PLAN_KEEPER_INDEX_SQL}=@keeperId
          AND ${MERGE_PLAN_IDENTITY_INDEX_SQL}=@identityKey
        ORDER BY id DESC
        LIMIT ${MERGE_PLAN_HISTORY_MAX_ROWS_PER_KEEPER_CHUNK + 1}`,
      params: { keeperId, identityKey },
    },
    {
      sql: `SELECT 1 AS invalid_json
        FROM undo_snapshots INDEXED BY idx_undo_product_merge_invalid_json
        WHERE kind='product.merge' AND status='applied' AND json_valid(payload_json)=0
        LIMIT 1`,
      params: {},
    },
  ])
  if ((invalidHistoryResult.results || []).length) return { plan: null, unavailable: true }
  const rows = (planResult.results || []) as Array<{ plan_bytes?: unknown; plan_json?: unknown }>
  if (rows.length > MERGE_PLAN_HISTORY_MAX_ROWS_PER_KEEPER_CHUNK) return { plan: null, unavailable: true }
  const candidates: ProductMergeClusterPlan[] = []
  for (const row of rows) try {
    const planBytes = Number(row.plan_bytes)
    if (!Number.isFinite(planBytes) || planBytes < 0 || planBytes > MERGE_PLAN_HISTORY_MAX_PLAN_BYTES
      || typeof row.plan_json !== 'string') return { plan: null, unavailable: true }
    const plan = parseProductMergeClusterPlan(JSON.parse(row.plan_json))
    if (!plan) return { plan: null, unavailable: true }
    candidates.push(plan)
  } catch { return { plan: null, unavailable: true } }
  return { plan: selectAppliedBulkClusterPlan(candidates, keeperId, identityKey, activeDuplicateIds), unavailable: false }
}

function selectAppliedBulkClusterPlan(
  candidates: readonly ProductMergeClusterPlan[],
  keeperId: number,
  identityKey: string,
  activeDuplicateIds: readonly number[],
): ProductMergeClusterPlan | null {
  if (!activeDuplicateIds.length) return null
  for (const plan of candidates) {
    // A completed old plan is not reused for a newly imported member of the
    // same identity. A partial plan is applicable only while at least one of
    // its original duplicate ids is still active in this group.
    if (plan.keeperId === keeperId && plan.identityKey === identityKey
      && activeDuplicateIds.some((id) => plan.memberIds.includes(id))) return plan
  }
  return null
}

export const MERGE_DUPLICATES_MAX_PRODUCTS_PER_REQUEST = 25
// The runtime counter can stop only between complete identity clusters. A
// first cluster therefore needs its own hard ceiling: an empty fold is already
// 41 D1 statements and six adapter calls, while stock, images and lots add
// more. Two individually capped folds use at most 570 statements, leaving
// headroom under the 700-statement request budget for the catalog scan and
// group guards. Larger clusters remain visible and explicitly blocked
// for a dedicated manifest rather than being split and corrupting their one
// whole-cluster cost mean.
export const MERGE_DUPLICATES_MAX_DUPLICATES_PER_CLUSTER = 2
export const MERGE_DUPLICATES_REQUEST_BUDGET_MS = 20_000
export const MERGE_DUPLICATES_REQUEST_STATEMENT_BUDGET = 700

type MergeDuplicateInterruptionCode = 'merge_budget_reached' | 'merge_infrastructure_interrupted'

function createCountedProductMergeDb(db: ReturnType<typeof getDb>): {
  db: ReturnType<typeof getDb>
  statementCount: () => number
} {
  let statements = 0
  const counted = Object.create(db) as ReturnType<typeof getDb>
  counted.prepare = ((sql: string) => {
    const prepared = db.prepare(sql)
    return {
      get: (params?: Parameters<typeof prepared.get>[0]) => { statements += 1; return prepared.get(params) },
      all: (params?: Parameters<typeof prepared.all>[0]) => { statements += 1; return prepared.all(params) },
      run: (params?: Parameters<typeof prepared.run>[0]) => { statements += 1; return prepared.run(params) },
    }
  }) as typeof counted.prepare
  counted.batch = (items) => {
    statements += items.length
    return db.batch(items)
  }
  return { db: counted, statementCount: () => statements }
}

export function shouldPauseProductMergeBeforeGroup(input: {
  completedGroups: number
  completedProducts: number
  elapsedMs: number
  statementCount: number
  nextDuplicateCount: number
}): boolean {
  if (input.completedGroups <= 0) return false
  const averageGroupMs = input.elapsedMs / input.completedGroups
  const predictedNextGroupMs = Math.max(1_000, averageGroupMs)
  const observedStatementsPerProduct = input.statementCount / Math.max(1, input.completedProducts)
  const predictedNextStatements = Math.ceil(Math.max(50, observedStatementsPerProduct) * Math.max(1, input.nextDuplicateCount))
  return input.elapsedMs + predictedNextGroupMs >= MERGE_DUPLICATES_REQUEST_BUDGET_MS
    || input.statementCount + predictedNextStatements > MERGE_DUPLICATES_REQUEST_STATEMENT_BUDGET
}

function isProductMergeInfrastructureError(error: unknown): boolean {
  return /D1 DB is overloaded|Requests queued for too long|database is locked|network|timeout|timed out|too many requests|busy|reset|ECONNRESET|fetch failed|internal error|D1_ERROR/i
    .test(error instanceof Error ? error.message : String(error))
}

function productMergeInterruptionMessage(code: MergeDuplicateInterruptionCode): string {
  return code === 'merge_budget_reached'
    ? 'This safe chunk finished before the next duplicate group started. Processing can continue under the same confirmed run.'
    : 'The database became busy after completed groups were saved. Review the refreshed preview and choose Merge again to continue.'
}

app.post('/merge-duplicates', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'products', 'merge_duplicates') !== 'full') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const countedDb = createCountedProductMergeDb(getDb(c.env))
  const db = countedDb.db
  const requestBody: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}))
  const rawRequestId = String(requestBody.client_request_id || '').trim()
  const requestId = rawRequestId && rawRequestId.length <= 120 ? rawRequestId : null
  const requestStartedAt = Date.now()
  const groups = await findDuplicateProductGroups(db)
  const remainingProductsBefore = groups.reduce((sum, group) => sum + group.duplicates.length, 0)
  if (!groups.length) {
    return c.json({
      success: true, complete: true, stalled: false, madeProgress: false,
      batchLimit: 25, mergedGroups: 0, mergedProducts: 0,
      remainingProductsBefore: 0, remainingProducts: 0,
      remainingGroupCount: 0, maxAdditionalRequests: 0, requestId, processedCaseKeys: [], actionHistoryIds: [], mergeOperationIds: [], undoPendingOperationIds: [], undoPendingCount: 0, groups: [], refusals: [],
    })
  }
  if (getActionTier(user, 'products', 'image') !== 'full' && await productMergeChangesImages(
    db,
    groups.flatMap((group) => group.duplicates.map((discarded) => ({ keeper: group.canonical, discarded }))),
  )) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }

  const branchRows = await db.prepare('SELECT id, name FROM branches').all<{ id: number; name: string }>({})
  const branchNameById = new Map<number, string>(branchRows.map((b) => [b.id, b.name]))
  const complexMultiClusterProductIds = await readMultiClusterComplexProductIds(db, groups)

  const groupSummaries: Array<{
    canonicalId: number
    canonicalName: string | null
    mergedIds: number[]
    mergedNames: (string | null)[]
  }> = []
  let mergedProductsCount = 0
  const actionHistoryIds: number[] = []
  const mergeOperationIds: string[] = []
  const undoPendingOperationIds: string[] = []
  const processedCaseKeys: string[] = []
  let undoPendingCount = 0
  let completedGroupsForBudget = 0
  let interruptionCode: MergeDuplicateInterruptionCode | null = null
  // Pairs this run REFUSED and left exactly as they were. Same rule as the
  // pair route's 409s, because "merge these two" cannot mean one thing in the
  // review dialog and another in the bulk run: a cost pair too far apart to
  // be one cost needs a person, and a product still inside a reversible
  // stock-in session must not have that session broken underneath it.
  const refusals: Array<{ caseKey: string; keeperId: number; mergedId: number; mergedName: string | null; code: string; error: string }> = []
  // Bounded, resumable work: each request commits at most this many products.
  // The next request simply re-scans the remaining active identities. A whole
  // identity cluster is never split, preserving one global DISTINCT cost mean.
  mergeGroups: try {
    for (const group of groups) {
      if (mergedProductsCount > 0 && mergedProductsCount + group.duplicates.length > MERGE_DUPLICATES_MAX_PRODUCTS_PER_REQUEST) break
      const elapsedMs = Date.now() - requestStartedAt
      if (shouldPauseProductMergeBeforeGroup({
        completedGroups: completedGroupsForBudget,
        completedProducts: mergedProductsCount,
        elapsedMs,
        statementCount: countedDb.statementCount(),
        nextDuplicateCount: group.duplicates.length,
      })) {
        interruptionCode = 'merge_budget_reached'
        break
      }
      const canonicalId = group.canonical.id
      const canonicalName = group.canonical.name
      const mergedIds: number[] = []
      const mergedNames: (string | null)[] = []

    // Never split one identity cluster across requests: doing so would feed a
    // previously averaged keeper back into the next mean. A cluster larger
    // than the transaction budget is quarantined for a dedicated manifest
    // workflow instead of issuing an unbounded D1 batch.
    if (group.duplicates.length > MERGE_DUPLICATES_MAX_DUPLICATES_PER_CLUSTER) {
      for (const dup of group.duplicates) {
        refusals.push({
          caseKey: productMergeCaseKey(canonicalId, dup.id),
          keeperId: canonicalId,
          mergedId: dup.id,
          mergedName: dup.name,
          code: 'cluster_exceeds_atomic_limit',
          error: `This ${group.duplicates.length + 1}-row identity cluster exceeds the safe atomic merge limit and needs a dedicated manifest.`,
        })
      }
      continue
    }
    if (group.duplicates.length > 1
      && [canonicalId, ...group.duplicates.map((duplicate) => duplicate.id)]
        .some((id) => complexMultiClusterProductIds.has(id))) {
      for (const dup of group.duplicates) {
        refusals.push({
          caseKey: productMergeCaseKey(canonicalId, dup.id),
          keeperId: canonicalId,
          mergedId: dup.id,
          mergedName: dup.name,
          code: 'cluster_requires_manifest',
          error: 'This multi-row identity cluster has linked stock or history. It remains unchanged and needs a dedicated manifest.',
        })
      }
      continue
    }

    // Known blockers are checked for the complete identity cluster before the
    // first member is changed. A cluster is one economics decision; merging
    // the easy members while leaving a blocked member would create a partial
    // synthetic keeper and make a later retry financially ambiguous.
    let groupBlocker: { code: string; error: string } | null = null
    for (const dup of group.duplicates) {
      const identity = await readMergeIdentityDiff(db, canonicalId, dup.id)
      if (!identity.same) {
        groupBlocker = { code: 'incompatible_product_identity', error: 'A product identity changed; this whole group remains unchanged.' }
        break
      }
      const blockingSession = await mergeBlockedByReversibleStockSession(db, [canonicalId, dup.id])
      if (blockingSession) {
        groupBlocker = { code: 'stock_session_reversible', error: mergeStockSessionBlockedMessage(blockingSession.operationId) }
        break
      }
    }
    if (groupBlocker) {
      for (const dup of group.duplicates) refusals.push({ caseKey: productMergeCaseKey(canonicalId, dup.id), keeperId: canonicalId, mergedId: dup.id, mergedName: dup.name, ...groupBlocker })
      continue
    }

    const ids = [canonicalId, ...group.duplicates.map((item) => item.id)]
    const moneyRows = await selectInChunks(ids, 0, (chunk) => {
      const { sql, params } = buildInClause('id', chunk)
      return db.prepare(`SELECT id, updated_at, ${[...MERGE_COST_FIELDS, ...MERGE_PRICE_FIELDS].join(', ')} FROM products WHERE id IN (${sql})`)
        .all<Record<string, unknown>>(params)
    })
    if (moneyRows.length !== ids.length) {
      for (const dup of group.duplicates) refusals.push({ caseKey: productMergeCaseKey(canonicalId, dup.id), keeperId: canonicalId, mergedId: dup.id, mergedName: dup.name, code: 'merge_state_conflict', error: 'A product disappeared while this group was being planned; the group remains unchanged.' })
      continue
    }
    const identityKey = JSON.stringify([normalizeProductGroupName(canonicalName), identityBarcodeKey(group.canonical.barcode)])
    const persistedPlanLookup = await readAppliedBulkClusterPlan(db, canonicalId, identityKey, group.duplicates.map((dup) => dup.id))
    if (persistedPlanLookup.unavailable) {
      for (const dup of group.duplicates) refusals.push({
        caseKey: productMergeCaseKey(canonicalId, dup.id), keeperId: canonicalId,
        mergedId: dup.id, mergedName: dup.name, code: 'merge_plan_history_unavailable',
        error: 'Saved merge-plan history could not be read within its safety limit. This whole group remains unchanged until the history is repaired or reconciled.',
      })
      continue
    }
    const persistedPlan = persistedPlanLookup.plan
    let clusterPlan: ProductMergeClusterPlan
    if (persistedPlan) {
      const currentById = new Map(moneyRows.map((row) => [Number(row.id), row]))
      const hasOutsider = ids.some((id) => !persistedPlan.memberIds.includes(id))
      const keeperMatches = productMergePlanKeeperMatches(persistedPlan, currentById.get(canonicalId) || {})
      const sourcesMatch = group.duplicates.every((dup) => productMergePlanSourceMemberMatches(persistedPlan, currentById.get(dup.id) || {}))
      if (hasOutsider || !keeperMatches || !sourcesMatch) {
        for (const dup of group.duplicates) refusals.push({ caseKey: productMergeCaseKey(canonicalId, dup.id), keeperId: canonicalId, mergedId: dup.id, mergedName: dup.name, code: 'merge_cluster_plan_conflict', error: 'This partially saved identity group changed after its original plan. Review it before resuming; no further member was merged.' })
        continue
      }
      clusterPlan = persistedPlan
    } else {
      clusterPlan = createProductMergeClusterPlan(identityKey, canonicalId, moneyRows)
    }
    const economics = resolveProductMergeClusterPlanEconomics(clusterPlan)
    if (economics.issues.length) {
      const message = productMergeNumericError(economics.issues)
      for (const dup of group.duplicates) refusals.push({ caseKey: productMergeCaseKey(canonicalId, dup.id), keeperId: canonicalId, mergedId: dup.id, mergedName: dup.name, code: 'invalid_merge_numeric', error: message })
      continue
    }

    // The complete immutable member/economics plan is stored in every
    // successful case's atomic snapshot. If a later case fails after an
    // earlier one committed, the next request recovers the original raw
    // DISTINCT costs instead of averaging the synthetic keeper again.
    for (const dup of group.duplicates) {
      let stopAfterCommittedCase = false
      try {
        const operationId = crypto.randomUUID()
        const result = await foldDuplicateProductInto(
          c.env, db, user,
          { id: canonicalId, name: canonicalName },
          dup,
          branchNameById,
          'bounded duplicate cleanup',
          'merge',
          economics,
          { operationId, bulkClusterPlan: clusterPlan, resumedCluster: Boolean(persistedPlan) || mergedIds.length > 0 },
        )
        if (result.actionHistoryId) actionHistoryIds.push(result.actionHistoryId)
        if (result.operationId) mergeOperationIds.push(result.operationId)
        if (!result.undoReady) {
          undoPendingCount += 1
          if (result.operationId) undoPendingOperationIds.push(result.operationId)
          stopAfterCommittedCase = true
        }
      } catch (error) {
        if (isProductMergeInfrastructureError(error)) {
          if (mergedIds.length > 0) {
            groupSummaries.push({ canonicalId, canonicalName, mergedIds, mergedNames })
            completedGroupsForBudget += 1
          }
          interruptionCode = 'merge_infrastructure_interrupted'
          break mergeGroups
        }
        const conflict = /merge_state_conflict|merge_identity_conflict|merge_cluster_plan_conflict/.test(String(error))
        const exceedsBudget = /merge_case_statement_budget_exceeded|merge_case_fingerprint_statement_budget_exceeded|merge_read_batch_statement_limit/.test(String(error))
        refusals.push({
          caseKey: productMergeCaseKey(canonicalId, dup.id),
          keeperId: canonicalId,
          mergedId: dup.id,
          mergedName: dup.name,
          code: conflict ? 'merge_state_conflict' : exceedsBudget ? 'merge_case_exceeds_safe_limit' : 'merge_failed',
          error: conflict
            ? 'The product changed during this case; refresh and resume.'
            : exceedsBudget
              ? 'This product has too many linked stock or history rows for one safe merge case and remains unchanged.'
              : String(error),
        })
        break
      }
      mergedIds.push(dup.id)
      mergedNames.push(dup.name)
      processedCaseKeys.push(productMergeCaseKey(canonicalId, dup.id))
      mergedProductsCount += 1
      if (stopAfterCommittedCase) {
        groupSummaries.push({ canonicalId, canonicalName, mergedIds, mergedNames })
        completedGroupsForBudget += 1
        interruptionCode = 'merge_infrastructure_interrupted'
        break mergeGroups
      }
    }

      groupSummaries.push({ canonicalId, canonicalName, mergedIds, mergedNames })
      if (mergedIds.length > 0) completedGroupsForBudget += 1
      if (mergedProductsCount >= MERGE_DUPLICATES_MAX_PRODUCTS_PER_REQUEST) break
    }
  } catch (error) {
    if (mergedProductsCount <= 0) throw error
    interruptionCode = 'merge_infrastructure_interrupted'
  }

  let remainingGroups: Awaited<ReturnType<typeof findDuplicateProductGroups>> | null = null
  if (!interruptionCode) {
    try {
      remainingGroups = await findDuplicateProductGroups(db)
    } catch (error) {
      if (mergedProductsCount <= 0) throw error
      interruptionCode = 'merge_infrastructure_interrupted'
    }
  }
  const remainingProducts = remainingGroups
    ? remainingGroups.reduce((sum, group) => sum + group.duplicates.length, 0)
    : null
  const madeProgress = remainingProducts == null
    ? mergedProductsCount > 0
    : remainingProducts < remainingProductsBefore
  const refusedCaseKeys = new Set(refusals.map((refusal) => refusal.caseKey))
  const onlyRefusedCasesRemain = remainingGroups != null && remainingGroups.every((group) =>
    group.duplicates.every((duplicate) => refusedCaseKeys.has(productMergeCaseKey(group.canonical.id, duplicate.id))))
  const complete = remainingProducts === 0
  const stalled = !complete && !onlyRefusedCasesRemain && remainingProducts != null && remainingProducts > 0 && !madeProgress

  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'update' }))
  return c.json({
    success: true,
    complete,
    blockedOnly: onlyRefusedCasesRemain,
    interrupted: interruptionCode != null,
    interruptionCode,
    error: interruptionCode ? productMergeInterruptionMessage(interruptionCode) : undefined,
    stalled,
    madeProgress,
    batchLimit: MERGE_DUPLICATES_MAX_PRODUCTS_PER_REQUEST,
    mergedGroups: groupSummaries.filter((group) => group.mergedIds.length > 0).length,
    mergedProducts: mergedProductsCount,
    remainingProductsBefore,
    remainingProducts,
    remainingGroupCount: remainingGroups?.length ?? null,
    // Because a cluster is never split, the exact conservative request bound
    // is one remaining group per call rather than ceil(products / 25).
    // A normal budget yield can continue under the same operator confirmation.
    // The groups seen at this call's initial scan are a conservative ceiling:
    // every successful continuation must complete at least one whole group.
    // Infrastructure failures keep this null because they require a fresh
    // reconciliation instead of automatic retries.
    maxAdditionalRequests: interruptionCode === 'merge_budget_reached'
      ? groups.length
      : remainingGroups?.length ?? null,
    requestId,
    processedCaseKeys,
    groups: groupSummaries,
    // What this run deliberately did NOT do. An empty array is the normal
    // answer; a non-empty one is work left for a person, and the UI says so.
    refusals,
    actionHistoryIds,
    mergeOperationIds,
    undoPendingOperationIds,
    undoPendingCount,
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
  `).run({ type, value, byId: user?.id ?? null, byName: actorSnapshot(user) })
  return c.json({ success: true })
})

type SelectedConflictProductRow = ProductConflictEligibilityRow & {
  image_path: string | null
  updated_at: string | null
  cost_price_usd: number | null
  cost_price_khr: number | null
  selling_price_usd: number | null
  selling_price_khr: number | null
  wholesale_price_usd: number | null
  wholesale_price_khr: number | null
}

type SelectedConflictLotRow = {
  batch_id: number
  variant_product_id: number
  batch_key: string
  branch_id: number | null
  quantity: number | null
}

type SelectedConflictPreparedCase = {
  ordinal: number
  caseKey: string
  keeper: SelectedConflictProductRow
  discarded: SelectedConflictProductRow
  stateDigest: string
  stateFingerprint: string
  stateGuards: Array<{ sql: string; params: Record<string, unknown> }>
  needsStockChoice: boolean
  stockImpact: MergeStockImpact
  snapshot: ProductMergeCaseSnapshot
  dependentLots: Map<number, ProductMergeLotSnapshot>
  imageChanges: boolean
  blockingSession: { operationId: string; status: string } | null
  statementEstimate: Record<'merge' | 'write_off', number>
  before: Record<string, unknown>
  afterByStockChoice: Record<'merge' | 'write_off', Record<string, unknown>>
}

type SelectedConflictSkippedCase = {
  ordinal: number
  case_key: string
  product_ids: number[]
  code: string
  message: string
}

const selectedConflictMoneyColumns = [
  ...MERGE_COST_FIELDS,
  ...MERGE_PRICE_FIELDS,
] as const

function selectedConflictClusterPredicateSql(clusterType: ProductConflictPreviewCase['cluster_type']): string {
  if (clusterType === 'leadingzero') {
    return `p.name_key=@clusterNameKey AND ${identityBarcodeKeySql('p.barcode')}=@clusterValue`
  }
  if (clusterType === 'barcode') return `TRIM(COALESCE(p.barcode,''))=@clusterValue`
  if (clusterType === 'name') return `p.name_key=@clusterValue`
  // Fuzzy-only groups can never pass the exact-name eligibility rule. Keep the
  // predicate closed rather than maintain a second SQL fuzzy-name algorithm.
  return '0'
}

const SELECTED_CONFLICT_FINGERPRINT_MAX_COMPOUND_TERMS = 5
const SELECTED_CONFLICT_FINGERPRINT_TERM_COUNT = 12 + MERGE_REPARENT_TABLES.length
const SELECTED_CONFLICT_FINGERPRINT_STATEMENT_COUNT = Math.ceil(
  SELECTED_CONFLICT_FINGERPRINT_TERM_COUNT / SELECTED_CONFLICT_FINGERPRINT_MAX_COMPOUND_TERMS,
)

function selectedConflictStateFingerprintSqlTerms(clusterType: ProductConflictPreviewCase['cluster_type']): string[] {
  const terms = [
    `SELECT 'product' AS kind, printf('%020d', id) AS row_key,
            json_object('id',id,'name',name,'barcode',barcode,'image_path',image_path,
              'is_active',is_active,'is_group',COALESCE(is_group,0),'parent_id',parent_id,
              'stock_quantity',stock_quantity,'updated_at',updated_at,
              'cost_price_usd',cost_price_usd,'cost_price_khr',cost_price_khr,
              'selling_price_usd',selling_price_usd,'selling_price_khr',selling_price_khr,
              'wholesale_price_usd',wholesale_price_usd,'wholesale_price_khr',wholesale_price_khr) AS value
     FROM products WHERE id IN (@keeperId, @mergedId)`,
    `SELECT 'cluster_member' AS kind, printf('%020d', p.id) AS row_key,
            json_object('id',p.id,'name',p.name,'name_key',p.name_key,'barcode',p.barcode,
              'is_active',p.is_active,'is_group',COALESCE(p.is_group,0)) AS value
     FROM products p
     WHERE p.is_active=1 AND COALESCE(p.is_group,0)=0
       AND (${selectedConflictClusterPredicateSql(clusterType)})`,
    `SELECT 'branch_stock' AS kind, printf('%020d:%020d', product_id, branch_id) AS row_key,
            json_object('product_id',product_id,'branch_id',branch_id,'quantity',quantity,
              'rfid_confirmed_qty',rfid_confirmed_qty) AS value
     FROM branch_stock WHERE product_id IN (@keeperId, @mergedId)`,
    `SELECT 'product_batch' AS kind, printf('%020d', id) AS row_key,
            json_object('id',id,'variant_product_id',variant_product_id,'batch_key',batch_key,
              'batch_number',batch_number,'is_active',is_active,'updated_at',updated_at) AS value
     FROM product_batches WHERE variant_product_id IN (@keeperId, @mergedId)`,
    `SELECT 'branch_batch_stock' AS kind, printf('%020d:%020d', bbs.batch_id, bbs.branch_id) AS row_key,
            json_object('batch_id',bbs.batch_id,'branch_id',bbs.branch_id,'quantity',bbs.quantity,
              'updated_at',bbs.updated_at) AS value
     FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id
     WHERE pb.variant_product_id IN (@keeperId, @mergedId)`,
    `SELECT 'product_image' AS kind, printf('%020d:%020d', product_id, id) AS row_key,
            json_object('id',id,'product_id',product_id,'image_path',image_path,'sort_order',sort_order) AS value
     FROM product_images WHERE product_id IN (@keeperId, @mergedId)`,
    ...MERGE_REPARENT_TABLES.map(({ table, column }) => `SELECT 'reparent:${table}' AS kind, printf('%020d', id) AS row_key,
            json_object('id', id, 'linked_product_id', ${column}) AS value
     FROM ${table} WHERE ${column} IN (@keeperId, @mergedId)`),
    `SELECT 'promotion_rule' AS kind, printf('%020d', pr.id) AS row_key,
            json_object('id',pr.id,'product_ids',pr.product_ids) AS value
     FROM promotion_rules pr
     WHERE json_valid(pr.product_ids) AND EXISTS (
       SELECT 1 FROM json_each(pr.product_ids) j WHERE CAST(j.value AS INTEGER) IN (@keeperId, @mergedId)
     )`,
    `SELECT 'child_product' AS kind, printf('%020d', id) AS row_key,
            json_object('id',id,'parent_id',parent_id,'updated_at',updated_at) AS value
     FROM products WHERE parent_id IN (@keeperId, @mergedId)`,
    `SELECT 'sale_batch_allocation' AS kind, printf('%020d', a.id) AS row_key,
            json_object('id',a.id,'sale_item_id',a.sale_item_id,'batch_id',a.batch_id,'quantity',a.quantity) AS value
     FROM sale_item_batch_allocations a JOIN product_batches pb ON pb.id=a.batch_id
     WHERE pb.variant_product_id IN (@keeperId, @mergedId)`,
    `SELECT 'return_batch_allocation' AS kind, printf('%020d', a.id) AS row_key,
            json_object('id',a.id,'return_item_id',a.return_item_id,'batch_id',a.batch_id,'quantity',a.quantity) AS value
     FROM return_item_batch_allocations a JOIN product_batches pb ON pb.id=a.batch_id
     WHERE pb.variant_product_id IN (@keeperId, @mergedId)`,
    `SELECT 'reversible_stock_session' AS kind, o.id AS row_key,
            json_object('operation_id',o.id,'history_id',o.history_id,'history_status',h.status,
              'member_product_id',m.product_id) AS value
     FROM stock_session_operations o
     JOIN action_history h ON h.id=o.history_id
     JOIN stock_session_members m ON m.operation_id=o.id
     WHERE h.status IN ('undoable','redoable') AND m.product_id IN (@keeperId,@mergedId)`,
    `SELECT 'branch' AS kind, printf('%020d', b.id) AS row_key,
            json_object('id',b.id,'name',b.name) AS value
     FROM branches b WHERE b.id IN (
       SELECT branch_id FROM branch_stock WHERE product_id IN (@keeperId,@mergedId)
       UNION SELECT bbs.branch_id FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id
         WHERE pb.variant_product_id IN (@keeperId,@mergedId)
     )`,
  ]
  if (terms.length !== SELECTED_CONFLICT_FINGERPRINT_TERM_COUNT) {
    throw new Error('selected_conflict_fingerprint_term_count_invalid')
  }
  return terms
}

// Read every fingerprint source in one transactional batch and carry the same
// fragments into the atomic write guard. Five compound terms per query match
// the verified local D1 ceiling while the exact-count invariant
// makes a future source addition fail closed instead of weakening the guard.
function selectedConflictStateFingerprintSqlChunks(clusterType: ProductConflictPreviewCase['cluster_type']): string[] {
  const terms = selectedConflictStateFingerprintSqlTerms(clusterType)
  const chunks: string[] = []
  for (let offset = 0; offset < terms.length; offset += SELECTED_CONFLICT_FINGERPRINT_MAX_COMPOUND_TERMS) {
    chunks.push(`
      SELECT kind,row_key,value FROM (
        ${terms.slice(offset, offset + SELECTED_CONFLICT_FINGERPRINT_MAX_COMPOUND_TERMS).join('\n        UNION ALL\n')}
        ORDER BY 1, 2
      )`)
  }
  return chunks
}

async function readSelectedConflictFingerprint(
  db: ReturnType<typeof getDb>,
  keeperId: number,
  mergedId: number,
  clusterType: ProductConflictPreviewCase['cluster_type'],
  clusterValue: string,
  clusterNameKey: string,
): Promise<{ fingerprint: string; guards: Array<{ sql: string; params: Record<string, unknown> }> }> {
  const queries = selectedConflictStateFingerprintSqlChunks(clusterType)
  const params = { keeperId, mergedId, clusterValue, clusterNameKey }
  const results = await db.batch(queries.map((sql) => ({ sql, params })))
  if (results.length !== queries.length) throw new Error('selected_conflict_fingerprint_batch_incomplete')
  const chunks = results.map((result) => {
    if (!Array.isArray(result.results)) {
      throw new Error('selected_conflict_fingerprint_batch_failed')
    }
    return result.results.map((raw) => {
      const row = raw as { kind?: unknown; row_key?: unknown; value?: unknown }
      if (typeof row.kind !== 'string' || typeof row.row_key !== 'string' || typeof row.value !== 'string') {
        throw new Error('selected_conflict_fingerprint_row_invalid')
      }
      try { JSON.parse(row.value) } catch { throw new Error('selected_conflict_fingerprint_value_invalid') }
      return { kind: row.kind, key: row.row_key, value: row.value }
    })
  })
  const encoder = new TextEncoder()
  const compareBinaryText = (left: string, right: string): number => {
    const leftBytes = encoder.encode(left)
    const rightBytes = encoder.encode(right)
    const sharedLength = Math.min(leftBytes.length, rightBytes.length)
    for (let index = 0; index < sharedLength; index += 1) {
      if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index]
    }
    return leftBytes.length - rightBytes.length
  }
  const binaryOrder = (left: { kind: string; key: string }, right: { kind: string; key: string }) => (
    compareBinaryText(left.kind, right.kind) || compareBinaryText(left.key, right.key)
  )
  const serialize = (entries: Array<{ kind: string; key: string; value: string }>) => `[${entries
    .sort(binaryOrder)
    .map((entry) => `{"kind":${JSON.stringify(entry.kind)},"key":${JSON.stringify(entry.key)},"value":${entry.value}}`)
    .join(',')}]`
  const chunkFingerprints = chunks.map((entries) => serialize(entries))
  const fingerprint = serialize(chunks.flat())
  return {
    fingerprint,
    guards: queries.map((query, index) => ({
      sql: `SELECT CASE WHEN (
              SELECT COALESCE(json_group_array(json_object('kind',kind,'key',row_key,'value',json(value))), '[]')
              FROM (${query})
            )=@expectedFingerprint
            THEN 1 ELSE json_extract('', '$') END AS selected_conflict_state_guard`,
      params: { ...params, expectedFingerprint: chunkFingerprints[index] },
    })),
  }
}

async function readSelectedConflictClusterMemberIds(
  db: ReturnType<typeof getDb>,
  clusterType: ProductConflictPreviewCase['cluster_type'],
  clusterValue: string,
  clusterNameKey: string,
): Promise<number[]> {
  const rows = await db.prepare(`SELECT p.id FROM products p
    WHERE p.is_active=1 AND COALESCE(p.is_group,0)=0
      AND (${selectedConflictClusterPredicateSql(clusterType)})
    ORDER BY p.id`).all<{ id: number }>({ clusterValue, clusterNameKey })
  return rows.map((row) => Number(row.id))
}

function selectedConflictStatementEstimate(
  snapshot: ProductMergeCaseSnapshot,
  dependentLots: Map<number, ProductMergeLotSnapshot>,
  stockChoice: 'merge' | 'write_off',
  canChangeImages: boolean,
): number {
  let statements = 1 // product CAS
  statements += SELECTED_CONFLICT_FINGERPRINT_STATEMENT_COUNT // selected-conflict state fingerprint guards
  for (const row of snapshot.duplicateStockRows) {
    if (!Number(row.quantity)) continue
    statements += stockChoice === 'merge' ? 2 : 1
  }
  statements += 1 // clear discarded branch stock
  if (canChangeImages) {
    const keeperPaths = new Set(snapshot.canonicalImageRows.map((row) => String(row.image_path)))
    statements += snapshot.duplicateImageRows.filter((row) => row.image_path && !keeperPaths.has(String(row.image_path))).length
    statements += 2 // discarded gallery delete + primary adoption
  } else {
    statements += 1 // no-image-effect assertion
  }
  statements += 2 // deactivate discarded + keeper economics
  const keeperBatchByKey = new Map(snapshot.canonicalBatchRows.map((row) => [row.batch_key, row.id]))
  for (const batch of snapshot.duplicateBatchRows) {
    if (stockChoice === 'write_off') {
      statements += 2
    } else if (keeperBatchByKey.has(batch.batch_key)) {
      const lot = dependentLots.get(Number(batch.id))
      statements += (lot?.duplicateStockRows.filter((row) => Number(row.quantity)).length || 0) + 4
    } else {
      statements += 1
    }
  }
  statements += snapshot.reparentedByTable.length
  statements += snapshot.promotionRuleRows.filter((rule) => {
    try { return Array.isArray(JSON.parse(String(rule.product_ids || ''))) && JSON.parse(String(rule.product_ids || '')).some((id: unknown) => Number(id) === Number(snapshot.duplicateProduct?.id)) }
    catch { return false }
  }).length
  if (snapshot.childProductRows.some((row) => Number(row.id) !== Number(snapshot.canonicalProduct?.id))) statements += 1
  if (snapshot.childProductRows.some((row) => Number(row.id) === Number(snapshot.canonicalProduct?.id))) statements += 1
  statements += 2 // stock caches
  statements += 2 // committed receipt transition + assertion
  statements += 3 // snapshot + action history + audit
  return statements
}

function selectedConflictProjection(
  rows: readonly SelectedConflictProductRow[],
  keeper: SelectedConflictProductRow,
  discarded: SelectedConflictProductRow,
  snapshot: ProductMergeCaseSnapshot,
  lotRows: readonly SelectedConflictLotRow[],
  branchNameById: Map<number, string>,
): { before: Record<string, unknown>; afterByStockChoice: Record<'merge' | 'write_off', Record<string, unknown>> } {
  const keeperQty = new Map(snapshot.canonicalStockBefore.map((row) => [Number(row.branch_id), Number(row.quantity) || 0]))
  const discardedQty = new Map(snapshot.duplicateStockRows.map((row) => [Number(row.branch_id), Number(row.quantity) || 0]))
  const keeperBatchKeys = new Set(snapshot.canonicalBatchRows.map((row) => row.batch_key))
  const beforeLotKeys = { keeper: new Map<number, Set<string>>(), discarded: new Map<number, Set<string>>() }
  for (const row of lotRows) {
    if (row.branch_id == null || !Number(row.quantity)) continue
    const side = Number(row.variant_product_id) === keeper.id ? beforeLotKeys.keeper : beforeLotKeys.discarded
    if (!side.has(Number(row.branch_id))) side.set(Number(row.branch_id), new Set())
    side.get(Number(row.branch_id))!.add(row.batch_key)
  }
  const branchIds = [...new Set([
    ...keeperQty.keys(), ...discardedQty.keys(), ...beforeLotKeys.keeper.keys(), ...beforeLotKeys.discarded.keys(),
  ])].sort((a, b) => a - b)
  const stock = branchIds.map((branchId) => ({
    branch_id: branchId,
    branch_name: branchNameById.get(branchId) ?? null,
    keeper_quantity: keeperQty.get(branchId) || 0,
    discarded_quantity: discardedQty.get(branchId) || 0,
    keeper_lot_count: beforeLotKeys.keeper.get(branchId)?.size || 0,
    discarded_lot_count: beforeLotKeys.discarded.get(branchId)?.size || 0,
  }))
  const economics = resolveProductMergeEconomics(rows)
  const costs = Object.fromEntries(MERGE_COST_FIELDS.map((field) => [field, Number(economics.merged[field] ?? keeper[field] ?? 0) || 0]))
  const prices = Object.fromEntries(MERGE_PRICE_FIELDS.map((field) => [field, Number(economics.merged[field] ?? keeper[field] ?? 0) || 0]))
  const imageRows = (productId: number) => (productId === keeper.id ? snapshot.canonicalImageRows : snapshot.duplicateImageRows)
    .map((row) => String(row.image_path || '')).filter(Boolean)
  const keeperGallery = imageRows(keeper.id)
  const discardedGallery = imageRows(discarded.id)
  const projectedGallery = [...new Set([...keeperGallery, ...discardedGallery])]
  const images = { primary: keeper.image_path || discarded.image_path || null, gallery: projectedGallery }
  const projectedStock = (choice: 'merge' | 'write_off') => branchIds.map((branchId) => {
    const keeperLots = new Set(beforeLotKeys.keeper.get(branchId) || [])
    if (choice === 'merge') {
      for (const key of beforeLotKeys.discarded.get(branchId) || []) keeperLots.add(keeperBatchKeys.has(key) ? key : key)
    }
    return {
      branch_id: branchId,
      branch_name: branchNameById.get(branchId) ?? null,
      quantity: (keeperQty.get(branchId) || 0) + (choice === 'merge' ? discardedQty.get(branchId) || 0 : 0),
      lot_count: keeperLots.size,
    }
  })
  const identity = (row: SelectedConflictProductRow) => ({
    id: row.id,
    name: row.name,
    barcode: row.barcode,
    is_active: Number(row.is_active),
    is_group: Number(row.is_group),
    stock_quantity: Number(row.stock_quantity) || 0,
    image_path: row.image_path,
  })
  const before = {
    keeper: identity(keeper),
    discarded: identity(discarded),
    stock,
    costs: {
      keeper: Object.fromEntries(MERGE_COST_FIELDS.map((field) => [field, Number(keeper[field]) || 0])),
      discarded: Object.fromEntries(MERGE_COST_FIELDS.map((field) => [field, Number(discarded[field]) || 0])),
    },
    prices: {
      keeper: Object.fromEntries(MERGE_PRICE_FIELDS.map((field) => [field, Number(keeper[field]) || 0])),
      discarded: Object.fromEntries(MERGE_PRICE_FIELDS.map((field) => [field, Number(discarded[field]) || 0])),
    },
    images: {
      keeper: { primary: keeper.image_path || null, gallery: keeperGallery },
      discarded: { primary: discarded.image_path || null, gallery: discardedGallery },
    },
  }
  const after = (choice: 'merge' | 'write_off') => {
    const projected = projectedStock(choice)
    return {
      keeper: { ...identity(keeper), is_active: 1, stock_quantity: projected.reduce((sum, row) => sum + row.quantity, 0) },
      discarded: { ...identity(discarded), is_active: 0, stock_quantity: 0 },
      stock: projected,
      costs,
      prices,
      images,
    }
  }
  return {
    before,
    afterByStockChoice: {
      merge: after('merge'),
      write_off: after('write_off'),
    },
  }
}

async function prepareSelectedConflictCase(
  db: ReturnType<typeof getDb>,
  requested: ProductConflictPreviewCase,
  ordinal: number,
  clustersByKey: Map<string, Array<Awaited<ReturnType<typeof findPossiblySameProductClusters>>[number]>>,
  branchNameById: Map<number, string>,
  canChangeImages: boolean,
  executionStockChoice?: 'merge' | 'write_off',
): Promise<SelectedConflictPreparedCase | SelectedConflictSkippedCase> {
  const requestedIds = [...requested.product_ids].sort((a, b) => a - b)
  const cluster = (clustersByKey.get(requested.case_key) || []).find((candidate) => {
    const ids = candidate.products.map((row) => Number(row.id)).sort((a, b) => a - b)
    return candidate.type === requested.cluster_type
      && productConflictCaseKey(candidate.type, candidate.value) === requested.case_key
      && ids.length === requestedIds.length
      && ids.every((id, index) => id === requestedIds[index])
  })
  const currentIds = cluster?.products.map((row) => Number(row.id)).sort((a, b) => a - b) || []
  if (!cluster || cluster.type !== requested.cluster_type
    || productConflictCaseKey(cluster.type, cluster.value) !== requested.case_key
    || currentIds.length !== 2 || currentIds.some((id, index) => id !== requestedIds[index])) {
    return { ordinal, case_key: requested.case_key, product_ids: requestedIds, code: 'not_exact_pair', message: 'This conflict no longer contains the reviewed exact two-product set.' }
  }
  const authoritativeClusterValue = normalizeProductClusterKey(requested.cluster_type, requested.cluster_value)
  const initialClusterNameKey = normalizeProductGroupName(cluster.products[0]?.name)
  const fingerprintBefore = await readSelectedConflictFingerprint(
    db, requestedIds[0], requestedIds[1], requested.cluster_type, authoritativeClusterValue, initialClusterNameKey,
  )
  const { sql, params } = buildInClause('selectedProduct', requestedIds)
  const rows = await db.prepare(`
    SELECT p.id,p.name,p.barcode,p.image_path,p.is_active,COALESCE(p.is_group,0) AS is_group,p.updated_at,
           p.cost_price_usd,p.cost_price_khr,p.selling_price_usd,p.selling_price_khr,
           p.wholesale_price_usd,p.wholesale_price_khr,COALESCE(SUM(bs.quantity),0) AS stock_quantity
    FROM products p LEFT JOIN branch_stock bs ON bs.product_id=p.id
    WHERE p.id IN (${sql}) GROUP BY p.id ORDER BY p.id
  `).all<SelectedConflictProductRow>(params)
  const eligibility = chooseProductConflictMergePair(rows)
  if (!eligibility.eligible) {
    return { ordinal, case_key: requested.case_key, product_ids: requestedIds, code: eligibility.code, message: eligibility.message }
  }
  const keeper = eligibility.keeper as SelectedConflictProductRow
  const discarded = eligibility.discarded as SelectedConflictProductRow
  const clusterNameKey = normalizeProductGroupName(keeper.name)
  const authoritativeMemberIds = await readSelectedConflictClusterMemberIds(
    db, requested.cluster_type, authoritativeClusterValue, clusterNameKey,
  )
  if (authoritativeMemberIds.length !== requestedIds.length
    || authoritativeMemberIds.some((id, index) => id !== requestedIds[index])) {
    return { ordinal, case_key: requested.case_key, product_ids: requestedIds, code: 'not_exact_pair', message: 'This conflict no longer contains exactly the reviewed two active products.' }
  }
  const snapshot = await readProductMergeCaseSnapshot(db, keeper.id, discarded.id, MERGE_REPARENT_TABLES)
  const [writeOffLots, mergeLots, blockingSession, imageChanges] = await Promise.all([
    executionStockChoice === 'merge' ? Promise.resolve(new Map<number, ProductMergeLotSnapshot>()) : readProductMergeDependentLotSnapshots(db, snapshot, 'write_off'),
    executionStockChoice === 'write_off' ? Promise.resolve(new Map<number, ProductMergeLotSnapshot>()) : readProductMergeDependentLotSnapshots(db, snapshot, 'merge'),
    mergeBlockedByReversibleStockSession(db, [keeper.id, discarded.id]),
    productMergeChangesImages(db, [{ keeper, discarded }]),
  ])
  const dependentLots = new Map(writeOffLots)
  for (const [batchId, lot] of mergeLots) dependentLots.set(batchId, { ...dependentLots.get(batchId), ...lot })
  const lotRows = await db.prepare(`
    SELECT pb.id AS batch_id,pb.variant_product_id,pb.batch_key,bbs.branch_id,bbs.quantity
    FROM product_batches pb LEFT JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id
    WHERE pb.variant_product_id IN (@keeperId,@mergedId)
    ORDER BY pb.variant_product_id,pb.id,bbs.branch_id
  `).all<SelectedConflictLotRow>({ keeperId: keeper.id, mergedId: discarded.id })
  const fingerprint = await readSelectedConflictFingerprint(
    db, keeper.id, discarded.id, requested.cluster_type, authoritativeClusterValue, clusterNameKey,
  )
  if (fingerprintBefore.fingerprint !== fingerprint.fingerprint) {
    return { ordinal, case_key: requested.case_key, product_ids: requestedIds, code: 'merge_state_conflict', message: 'This conflict changed while its authoritative review was being read. Refresh and review it again.' }
  }
  const stateDigest = await productConflictSha256({
    version: PRODUCT_CONFLICT_MERGE_MANIFEST_VERSION,
    case_key: requested.case_key,
    keep_id: keeper.id,
    merge_id: discarded.id,
    state: fingerprint.fingerprint,
  })
  const projection = selectedConflictProjection(rows, keeper, discarded, snapshot, lotRows, branchNameById)
  const stockImpact = await readMergeStockImpact(db, discarded.id, branchNameById)
  return {
    ordinal,
    caseKey: requested.case_key,
    keeper,
    discarded,
    stateDigest,
    stateFingerprint: fingerprint.fingerprint,
    stateGuards: fingerprint.guards,
    needsStockChoice: mergeStockImpactNeedsChoice(stockImpact),
    stockImpact,
    snapshot,
    dependentLots,
    imageChanges,
    blockingSession,
    statementEstimate: {
      merge: selectedConflictStatementEstimate(snapshot, dependentLots, 'merge', canChangeImages),
      write_off: selectedConflictStatementEstimate(snapshot, dependentLots, 'write_off', canChangeImages),
    },
    before: projection.before,
    afterByStockChoice: projection.afterByStockChoice,
  }
}

async function prepareSelectedConflictCases(
  db: ReturnType<typeof getDb>,
  requestedCases: readonly ProductConflictPreviewCase[],
  canChangeImages: boolean,
  executionStockChoices?: readonly ('merge' | 'write_off')[],
): Promise<{ prepared: SelectedConflictPreparedCase[]; skipped: SelectedConflictSkippedCase[] }> {
  const [clusters, branches] = await Promise.all([
    findPossiblySameProductClusters(db),
    db.prepare('SELECT id,name FROM branches').all<{ id: number; name: string }>({}),
  ])
  const clustersByKey = new Map<string, typeof clusters>()
  for (const cluster of clusters) {
    const key = productConflictCaseKey(cluster.type, cluster.value)
    const group = clustersByKey.get(key) || []
    group.push(cluster)
    clustersByKey.set(key, group)
  }
  const branchNameById = new Map(branches.map((branch) => [Number(branch.id), String(branch.name)]))
  const prepared: SelectedConflictPreparedCase[] = []
  const skipped: SelectedConflictSkippedCase[] = []
  for (const [ordinal, requested] of requestedCases.entries()) {
    const result = await prepareSelectedConflictCase(db, requested, ordinal, clustersByKey, branchNameById, canChangeImages, executionStockChoices?.[ordinal])
    if ('stateDigest' in result) prepared.push(result)
    else skipped.push(result)
  }
  return { prepared, skipped }
}

type SelectedConflictApplyPreflightCase = Pick<SelectedConflictPreparedCase,
  'ordinal' | 'caseKey' | 'keeper' | 'discarded' | 'stateDigest' | 'needsStockChoice'
  | 'stateGuards' | 'imageChanges' | 'blockingSession' | 'statementEstimate'>

function selectedConflictLightStatementEstimate(
  fingerprint: string,
  keeperId: number,
  mergedId: number,
  canChangeImages: boolean,
): Record<'merge' | 'write_off', number> {
  let entries: Array<{ kind?: string; value?: Record<string, unknown> }> = []
  try { entries = JSON.parse(fingerprint) as typeof entries } catch { return { merge: 101, write_off: 101 } }
  const ofKind = (kind: string) => entries.filter((entry) => entry.kind === kind).map((entry) => entry.value || {})
  const batches = ofKind('product_batch')
  const keeperBatches = new Map(batches.filter((row) => Number(row.variant_product_id) === keeperId)
    .map((row) => [String(row.batch_key), Number(row.id)]))
  const mergedBatches = batches.filter((row) => Number(row.variant_product_id) === mergedId)
  const batchStock = ofKind('branch_batch_stock')
  const branchStock = ofKind('branch_stock').filter((row) => Number(row.product_id) === mergedId && Number(row.quantity))
  const keeperImagePaths = new Set(ofKind('product_image').filter((row) => Number(row.product_id) === keeperId).map((row) => String(row.image_path || '')).filter(Boolean))
  const mergedImages = ofKind('product_image').filter((row) => Number(row.product_id) === mergedId
    && Boolean(String(row.image_path || '')) && !keeperImagePaths.has(String(row.image_path || '')))
  const reparentGroups = new Map<string, number>()
  for (const entry of entries) {
    if (!entry.kind?.startsWith('reparent:') || Number(entry.value?.linked_product_id) !== mergedId) continue
    reparentGroups.set(entry.kind, (reparentGroups.get(entry.kind) || 0) + 1)
  }
  const promotionCount = ofKind('promotion_rule').filter((row) => {
    try { return (JSON.parse(String(row.product_ids || '[]')) as unknown[]).some((id) => Number(id) === mergedId) } catch { return false }
  }).length
  const childCount = ofKind('child_product').filter((row) => Number(row.parent_id) === mergedId).length
  const collisionBatchIds = new Set<number>()
  let mergeBatchStatements = 0
  for (const batch of mergedBatches) {
    const keeperBatchId = keeperBatches.get(String(batch.batch_key))
    if (keeperBatchId == null) mergeBatchStatements += 1
    else {
      collisionBatchIds.add(Number(batch.id))
      mergeBatchStatements += batchStock.filter((row) => Number(row.batch_id) === Number(batch.id) && Number(row.quantity)).length + 4
    }
  }
  const common = 1 + SELECTED_CONFLICT_FINGERPRINT_STATEMENT_COUNT + 1 // product CAS, selected-state guards, discarded stock clear
    + (canChangeImages ? mergedImages.length + 2 : 1)
    + 2 // deactivate and economics
    + reparentGroups.size + promotionCount + (childCount ? 2 : 0)
    + 2 + 2 + 3 // stock caches, receipt transition/guard, atomic history
  const merge = common + branchStock.length * 2 + mergeBatchStatements
  const writeOff = common + branchStock.length + mergedBatches.length * 2

  const chunksOf80 = (count: number) => Math.ceil(Math.max(0, count) / 80)
  const savedBatchIds = new Set<number>([
    ...mergedBatches.map((row) => Number(row.id)),
    ...collisionBatchIds,
    ...[...collisionBatchIds].map((id) => {
      const batch = mergedBatches.find((row) => Number(row.id) === id)
      return keeperBatches.get(String(batch?.batch_key)) || 0
    }),
  ].filter((id) => id > 0))
  const reparentFingerprintReads = [...reparentGroups.values()].reduce((sum, count) => sum + chunksOf80(count), 0)
  const collisionSaleIds = new Set(ofKind('sale_batch_allocation').filter((row) => collisionBatchIds.has(Number(row.batch_id))).map((row) => Number(row.id)))
  const collisionReturnIds = new Set(ofKind('return_batch_allocation').filter((row) => collisionBatchIds.has(Number(row.batch_id))).map((row) => Number(row.id)))
  const fingerprintReads = 7 + chunksOf80(savedBatchIds.size) + 1 + reparentFingerprintReads
    + chunksOf80(promotionCount) + chunksOf80(childCount)
    + chunksOf80(collisionSaleIds.size) + chunksOf80(collisionReturnIds.size)
  return fingerprintReads > PRODUCT_MERGE_READ_BATCH_MAX_STATEMENTS ? { merge: 101, write_off: 101 } : { merge, write_off: writeOff }
}

async function prepareSelectedConflictApplyPreflightCases(
  db: ReturnType<typeof getDb>,
  requestedCases: readonly ProductConflictPreviewCase[],
  canChangeImages: boolean,
): Promise<{ prepared: SelectedConflictApplyPreflightCase[]; skipped: SelectedConflictSkippedCase[] }> {
  const clusters = await findPossiblySameProductClusters(db)
  const clustersByKey = new Map<string, typeof clusters>()
  for (const cluster of clusters) {
    const key = productConflictCaseKey(cluster.type, cluster.value)
    const group = clustersByKey.get(key) || []
    group.push(cluster)
    clustersByKey.set(key, group)
  }
  const prepared: SelectedConflictApplyPreflightCase[] = []
  const skipped: SelectedConflictSkippedCase[] = []
  for (const [ordinal, requested] of requestedCases.entries()) {
    const requestedIds = [...requested.product_ids].sort((a, b) => a - b)
    const cluster = (clustersByKey.get(requested.case_key) || []).find((candidate) => {
      const ids = candidate.products.map((row) => Number(row.id)).sort((a, b) => a - b)
      return candidate.type === requested.cluster_type && ids.length === 2 && ids.every((id, index) => id === requestedIds[index])
    })
    if (!cluster) {
      skipped.push({ ordinal, case_key: requested.case_key, product_ids: requestedIds, code: 'not_exact_pair', message: 'This conflict no longer contains the reviewed exact two-product set.' })
      continue
    }
    const authoritativeClusterValue = normalizeProductClusterKey(requested.cluster_type, requested.cluster_value)
    const initialClusterNameKey = normalizeProductGroupName(cluster.products[0]?.name)
    const before = await readSelectedConflictFingerprint(db, requestedIds[0], requestedIds[1], requested.cluster_type, authoritativeClusterValue, initialClusterNameKey)
    const { sql, params } = buildInClause('selectedPreflightProduct', requestedIds)
    const rows = await db.prepare(`SELECT p.id,p.name,p.barcode,p.image_path,p.is_active,COALESCE(p.is_group,0) AS is_group,p.updated_at,
      p.cost_price_usd,p.cost_price_khr,p.selling_price_usd,p.selling_price_khr,p.wholesale_price_usd,p.wholesale_price_khr,
      COALESCE(SUM(bs.quantity),0) AS stock_quantity
      FROM products p LEFT JOIN branch_stock bs ON bs.product_id=p.id WHERE p.id IN (${sql}) GROUP BY p.id ORDER BY p.id`)
      .all<SelectedConflictProductRow>(params)
    const eligibility = chooseProductConflictMergePair(rows)
    if (!eligibility.eligible) {
      skipped.push({ ordinal, case_key: requested.case_key, product_ids: requestedIds, code: eligibility.code, message: eligibility.message })
      continue
    }
    const keeper = eligibility.keeper as SelectedConflictProductRow
    const discarded = eligibility.discarded as SelectedConflictProductRow
    const clusterNameKey = normalizeProductGroupName(keeper.name)
    const [memberIds, stockImpact, blockingSession, imageChanges] = await Promise.all([
      readSelectedConflictClusterMemberIds(db, requested.cluster_type, authoritativeClusterValue, clusterNameKey),
      readMergeStockImpact(db, discarded.id, new Map()),
      mergeBlockedByReversibleStockSession(db, [keeper.id, discarded.id]),
      productMergeChangesImages(db, [{ keeper, discarded }]),
    ])
    const after = await readSelectedConflictFingerprint(db, keeper.id, discarded.id, requested.cluster_type, authoritativeClusterValue, clusterNameKey)
    if (memberIds.length !== 2 || memberIds.some((id, index) => id !== requestedIds[index]) || before.fingerprint !== after.fingerprint) {
      skipped.push({ ordinal, case_key: requested.case_key, product_ids: requestedIds, code: 'merge_state_conflict', message: 'This conflict changed during final validation. Refresh the combined review.' })
      continue
    }
    const stateDigest = await productConflictSha256({
      version: PRODUCT_CONFLICT_MERGE_MANIFEST_VERSION, case_key: requested.case_key,
      keep_id: keeper.id, merge_id: discarded.id, state: after.fingerprint,
    })
    prepared.push({
      ordinal, caseKey: requested.case_key, keeper, discarded, stateDigest, stateGuards: after.guards,
      needsStockChoice: mergeStockImpactNeedsChoice(stockImpact), imageChanges, blockingSession,
      statementEstimate: selectedConflictLightStatementEstimate(after.fingerprint, keeper.id, discarded.id, canChangeImages),
    })
  }
  return { prepared, skipped }
}

type SelectedConflictRunRow = {
  id: string
  actor_id: number
  request_id: string
  request_digest: string
  manifest_version: number
  manifest_digest: string
  request_json: string
  status: string
  result_json: string | null
}

type SelectedConflictRunCaseRow = {
  run_id: string
  ordinal: number
  case_key: string
  keeper_product_id: number
  merged_product_id: number
  expected_state_digest: string
  stock_choice: 'merge' | 'write_off' | null
  operation_id: string
  status: 'planned' | 'committed' | 'history_pending' | 'undo_ready' | 'refused'
  action_history_id: number | null
  refusal_code: string | null
  error: string | null
}

async function selectedConflictManifestDigest(cases: ReadonlyArray<Pick<SelectedConflictPreparedCase,
  'caseKey' | 'keeper' | 'discarded' | 'stateDigest'>>): Promise<string> {
  return productConflictSha256({
    manifest_version: PRODUCT_CONFLICT_MERGE_MANIFEST_VERSION,
    cases: cases.map((item, ordinal) => ({
      ordinal,
      case_key: item.caseKey,
      keep_id: item.keeper.id,
      merge_id: item.discarded.id,
      state_digest: item.stateDigest,
    })),
  })
}

function selectedConflictBlocked(
  item: Pick<SelectedConflictPreparedCase, 'blockingSession' | 'imageChanges' | 'statementEstimate'>,
  canChangeImages: boolean,
): { code: string; message: string; operation_id?: string } | null {
  if (item.blockingSession) {
    return {
      code: 'stock_session_reversible',
      message: mergeStockSessionBlockedMessage(item.blockingSession.operationId),
      operation_id: item.blockingSession.operationId,
    }
  }
  if (item.imageChanges && !canChangeImages) {
    return { code: 'image_permission_required', message: 'This merge changes product images and requires full image permission.' }
  }
  if (Math.max(item.statementEstimate.merge, item.statementEstimate.write_off) > 100) {
    return { code: 'merge_case_exceeds_safe_limit', message: 'This product has too many linked rows for one safe merge case.' }
  }
  return null
}

async function reconcileSelectedConflictHistory(
  env: Env,
  db: ReturnType<typeof getDb>,
  item: SelectedConflictRunCaseRow,
): Promise<{ undoAvailability: 'ready' | 'pending' | 'unavailable'; actionHistoryId: number | null }> {
  const record = await db.prepare(`
    SELECT h.id AS history_id,s.payload_json
    FROM action_history h
    JOIN undo_snapshots s ON s.id=CAST(json_extract(h.undo_payload,'$.snapshot_id') AS INTEGER)
    WHERE json_extract(h.undo_payload,'$.operation_id')=@operationId
      AND json_extract(h.undo_payload,'$.applier')='product.merge'
    ORDER BY h.id DESC LIMIT 1
  `).get<{ history_id: number; payload_json: string }>({ operationId: item.operation_id })
  if (!record?.payload_json) {
    await db.prepare(`UPDATE product_conflict_merge_run_cases
      SET status='history_pending',action_history_id=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE run_id=@runId AND ordinal=@ordinal AND status IN ('committed','history_pending','undo_ready')`)
      .run({ runId: item.run_id, ordinal: item.ordinal })
    return { undoAvailability: 'unavailable', actionHistoryId: null }
  }
  let reversal: MergeReversal
  try { reversal = JSON.parse(record.payload_json) as MergeReversal }
  catch {
    await db.prepare(`UPDATE product_conflict_merge_run_cases
      SET status='history_pending',action_history_id=@historyId,updated_at=CURRENT_TIMESTAMP
      WHERE run_id=@runId AND ordinal=@ordinal AND status IN ('committed','history_pending','undo_ready')`)
      .run({ historyId: Number(record.history_id) || null, runId: item.run_id, ordinal: item.ordinal })
    return { undoAvailability: 'unavailable', actionHistoryId: Number(record.history_id) || null }
  }
  const finalized = await finalizeAtomicMergeHistory(env, item.operation_id, reversal, db)
  if (finalized.fingerprintReady) {
    await db.prepare(`UPDATE product_conflict_merge_run_cases
      SET status='undo_ready',action_history_id=@historyId,updated_at=CURRENT_TIMESTAMP
      WHERE run_id=@runId AND ordinal=@ordinal AND status IN ('committed','history_pending')`)
      .run({ historyId: finalized.actionHistoryId, runId: item.run_id, ordinal: item.ordinal })
  } else {
    await db.prepare(`UPDATE product_conflict_merge_run_cases
      SET status='history_pending',action_history_id=COALESCE(action_history_id,@historyId),updated_at=CURRENT_TIMESTAMP
      WHERE run_id=@runId AND ordinal=@ordinal AND status IN ('committed','history_pending')`)
      .run({ historyId: finalized.actionHistoryId, runId: item.run_id, ordinal: item.ordinal })
  }
  return {
    undoAvailability: finalized.fingerprintReady ? 'ready' : 'pending',
    actionHistoryId: finalized.actionHistoryId,
  }
}

async function readSelectedConflictUndoAvailability(
  db: ReturnType<typeof getDb>,
  item: SelectedConflictRunCaseRow,
): Promise<{ availability: 'ready' | 'pending' | 'unavailable'; actionHistoryId: number | null }> {
  const record = await db.prepare(`
    SELECT h.id AS history_id,h.reversible,h.status AS history_status,s.id AS snapshot_id,s.payload_json
    FROM action_history h
    LEFT JOIN undo_snapshots s ON s.id=CAST(json_extract(h.undo_payload,'$.snapshot_id') AS INTEGER)
    WHERE json_extract(h.undo_payload,'$.operation_id')=@operationId
      AND json_extract(h.undo_payload,'$.applier')='product.merge'
    ORDER BY h.id DESC LIMIT 1
  `).get<{ history_id: number; reversible: number; history_status: string; snapshot_id: number | null; payload_json: string | null }>({ operationId: item.operation_id })
  const historyId = Number(record?.history_id)
  if (!Number.isSafeInteger(historyId) || historyId <= 0 || !record?.snapshot_id || !record.payload_json) {
    return { availability: 'unavailable', actionHistoryId: null }
  }
  try {
    const payload = JSON.parse(record.payload_json) as { fingerprintPending?: unknown; operationId?: unknown }
    if (payload.operationId !== item.operation_id) return { availability: 'unavailable', actionHistoryId: historyId }
    if (payload.fingerprintPending === false && Number(record.reversible) === 1 && record.history_status === 'undoable') {
      return { availability: 'ready', actionHistoryId: historyId }
    }
    return { availability: 'pending', actionHistoryId: historyId }
  } catch {
    return { availability: 'unavailable', actionHistoryId: historyId }
  }
}

type ProductConflictActionReviewRow = {
  id: string; actor_id: number; request_id: string; request_digest: string; draft_digest: string; status: string
  finalize_digest: string | null; manifest_digest: string | null
  requested_action_count: number; requested_group_count: number; requested_removal_count: number
  actionable_group_count: number; blocked_group_count: number; total_member_count: number; expires_at: string
}

type ProductConflictActionStoredGroupRow = {
  ordinal: number; group_key: string; source_group_keys_json: string; member_ids_json: string; status: string
  state_digest: string; detail_json: string; resolution_json: string | null; final_plan_json: string | null; operation_id: string | null
  action_history_id?: number | null; reversal_generation?: number
}

type ProductConflictActionStoredRemovalRow = ProductRemoveOperationRow & {
  action_ordinal: number
  blocker_code: string | null
  error_message: string | null
}

function productConflictActionCursor(value: string | undefined): number | null {
  if (value == null || value === '') return 0
  if (!/^\d{1,4}$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed < 1600 ? parsed : null
}

function productConflictActionPageLimit(value: string | undefined): number | null {
  if (value == null || value === '') return 50
  if (!/^\d{1,3}$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= PRODUCT_CONFLICT_ACTION_PAGE_MAX ? parsed : null
}

async function readProductConflictActionReview(db: ReturnType<typeof getDb>, actorId: number, reviewId: string) {
  return db.prepare(`SELECT id,actor_id,request_id,request_digest,draft_digest,finalize_digest,manifest_digest,status,
    requested_action_count,requested_group_count,requested_removal_count,actionable_group_count,blocked_group_count,total_member_count,expires_at
    FROM product_conflict_action_reviews WHERE id=@reviewId AND actor_id=@actorId`)
    .get<ProductConflictActionReviewRow>({ reviewId, actorId })
}

async function productConflictActionReviewPage(db: ReturnType<typeof getDb>, reviewId: string, cursor: number, limit: number) {
  const rows = await db.prepare(`SELECT ordinal,group_key,source_group_keys_json,member_ids_json,status,state_digest,detail_json,
    resolution_json,final_plan_json,operation_id FROM product_conflict_action_groups
    WHERE review_id=@reviewId AND ordinal>=@cursor ORDER BY ordinal LIMIT @limit`)
    .all<ProductConflictActionStoredGroupRow>({ reviewId, cursor, limit: limit + 1 })
  const removalRows = await db.prepare(`SELECT operation_id,actor_id,requester_id,source,request_id,review_id,action_ordinal,
    product_id,reason,state_digest,plan_digest,plan_json,status,blocker_code,error_message,pending_action_id,undo_snapshot_id,
    action_history_id,generation,response_json FROM product_remove_operations
    WHERE review_id=@reviewId AND action_ordinal>=@cursor ORDER BY action_ordinal LIMIT @limit`)
    .all<ProductConflictActionStoredRemovalRow>({ reviewId, cursor, limit: limit + 1 })
  const actions = [
    ...rows.map((row) => ({ kind: 'group' as const, ordinal: Number(row.ordinal), row })),
    ...removalRows.map((row) => ({ kind: 'removal' as const, ordinal: Number(row.action_ordinal), row })),
  ].sort((left, right) => left.ordinal - right.ordinal).slice(0, limit + 1)
  const pageActions = actions.slice(0, limit)
  const groups = pageActions.filter((item) => item.kind === 'group').map((item) => {
    const row = item.row as ProductConflictActionStoredGroupRow
    try {
      const detail = JSON.parse(row.detail_json)
      if (!detail || typeof detail !== 'object' || Array.isArray(detail)) throw new Error('invalid detail')
      const resolution = row.resolution_json ? JSON.parse(row.resolution_json) : null
      const finalPlan = row.final_plan_json ? JSON.parse(row.final_plan_json) : null
      return { ordinal: Number(row.ordinal), ...detail, status: row.status, resolution,
        projected_result: finalPlan?.projected_result ?? null }
    } catch { throw new ProductConflictMergeValidationError('The stored conflict review is unreadable.', 'review_corrupt', 409) }
  })
  const removals = pageActions.filter((item) => item.kind === 'removal').map((item) => {
    const row = item.row as ProductConflictActionStoredRemovalRow
    try {
      const detail = JSON.parse(row.plan_json)
      return { action_ordinal: Number(row.action_ordinal), product_id: Number(row.product_id), reason: row.reason,
        status: row.status, operation_id: row.operation_id, state_digest: row.state_digest, plan_digest: row.plan_digest,
        blocker: row.blocker_code ? { code: row.blocker_code, message: row.error_message } : null,
        product: detail.product ?? null, branch_stock: detail.branch_stock ?? [], batches: detail.batches ?? [],
        branch_batch_stock: detail.branch_batch_stock ?? [], source_bytes: Number(detail.source_bytes) || 0 }
    } catch { throw new ProductConflictMergeValidationError('The stored removal review is unreadable.', 'review_corrupt', 409) }
  })
  return { cursor: String(cursor), next_cursor: actions.length > limit ? String(actions[limit].ordinal) : null, limit, groups, removals }
}

async function readProductConflictActionStoredRemovals(db: ReturnType<typeof getDb>, reviewId: string) {
  return db.prepare(`SELECT operation_id,actor_id,requester_id,source,request_id,review_id,action_ordinal,product_id,reason,
    state_digest,plan_digest,plan_json,status,blocker_code,error_message,pending_action_id,undo_snapshot_id,action_history_id,generation,response_json
    FROM product_remove_operations WHERE review_id=@reviewId ORDER BY action_ordinal`)
    .all<ProductConflictActionStoredRemovalRow>({ reviewId })
}

async function productConflictActionReviewResponse(db: ReturnType<typeof getDb>, review: ProductConflictActionReviewRow, cursor = 0, limit = 50) {
  return {
    success: true, manifest_version: 1, resolution_version: 2, review_id: review.id,
    draft_digest: review.draft_digest, manifest_digest: review.manifest_digest, status: review.status, expires_at: review.expires_at,
    counts: {
      requested_actions: Number(review.requested_action_count), requested_groups: Number(review.requested_group_count),
      requested_removals: Number(review.requested_removal_count), actionable_groups: Number(review.actionable_group_count),
      blocked_groups: Number(review.blocked_group_count), total_members: Number(review.total_member_count),
    },
    page: await productConflictActionReviewPage(db, review.id, cursor, limit),
  }
}

type ProductConflictActionFinalPlan = {
  version: 1
  authority: 'reviewed_product_conflict_v2'
  review_id: string
  group_key: string
  draft_digest: string
  reviewed_state_digest: string
  operation_id: string
  eligibility: { basis: 'name' | 'barcode'; value: string }
  member_ids: number[]
  keeper_id: number
  fold_members: Array<{ member_id: number; operation_id: string }>
  cluster_plan: ProductMergeClusterPlan
  selected: {
    barcode: { mode: 'canonical' | 'member' | 'clear'; source_product_id: number | null; value: string }
    category: { source_product_id: number; value: unknown; categories: unknown }
    brand: { source_product_id: number; value: unknown; brands: unknown; brand_compact: string }
    unit: { source_product_id: number; value: unknown; unit_normalized: string }
  }
  image_effect: boolean
  reviewed_images: Array<{ product_id: number; image_path: string; sort_order: number | null }>
  projected_result: {
    economics: ProductMergeEconomics['merged']
    barcode: string
    category: unknown
    categories: unknown
    brand: unknown
    brands: unknown
    brand_compact: string
    unit: unknown
    unit_normalized: string
    stock_by_branch: ProductConflictActionGroupPlan['stock']['projected_by_branch']
    lot_dispositions: Array<ProductConflictActionLotRow & {
      source_batch_id: number; target_batch_id: number; collision: 'fold' | 'reparent'
    }>
  }
}

function parseProductConflictStoredArray(value: string, field: string): unknown[] {
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) throw new Error('not an array')
    return parsed
  } catch { throw new ProductConflictMergeValidationError(`The stored conflict review ${field} is unreadable.`, 'review_corrupt', 409) }
}

async function readProductConflictActionStoredGroups(db: ReturnType<typeof getDb>, reviewId: string) {
  const rows: ProductConflictActionStoredGroupRow[] = []
  let cursor = 0
  while (true) {
    const page = await db.prepare(`SELECT ordinal,group_key,source_group_keys_json,member_ids_json,status,state_digest,detail_json,
      resolution_json,final_plan_json,operation_id FROM product_conflict_action_groups
      WHERE review_id=@reviewId AND ordinal>=@cursor ORDER BY ordinal LIMIT 11`)
      .all<ProductConflictActionStoredGroupRow>({ reviewId, cursor })
    rows.push(...page.slice(0, 10))
    if (page.length <= 10) return rows
    cursor = Number(page[10].ordinal)
  }
}

function productConflictActionPlanMember(plan: ProductConflictActionGroupPlan, productId: number): Record<string, unknown> {
  const member = plan.members.find((candidate) => Number(candidate.id) === productId)
  if (!member) throw new ProductConflictMergeValidationError('A selected field source is not a current group member.', 'invalid_resolution')
  return member
}

async function buildProductConflictActionFinalPlan(
  review: ProductConflictActionReviewRow,
  plan: ProductConflictActionGroupPlan & { state_digest: string },
  resolution: ProductConflictActionFinalizeResolution,
  imageEffect: boolean,
  imageRows: Array<{ product_id: number; image_path: string; sort_order: number | null }>,
): Promise<ProductConflictActionFinalPlan> {
  if (plan.blocked || plan.detail_status !== 'complete' || !plan.eligibility_basis || !plan.eligibility_value) {
    throw new ProductConflictMergeValidationError('Blocked conflict groups cannot be finalized.', 'invalid_resolution')
  }
  const memberIds = plan.member_ids.map(Number)
  const members = new Set(memberIds)
  const selectedIds = [resolution.keeper_id, resolution.category_source_id, resolution.brand_source_id, resolution.unit_source_id]
  if (resolution.barcode.mode === 'member') selectedIds.push(resolution.barcode.source_product_id)
  if (selectedIds.some((id) => !members.has(id))) {
    throw new ProductConflictMergeValidationError('Every keeper and field source must belong to its conflict group.', 'invalid_resolution')
  }
  productConflictActionPlanMember(plan, resolution.keeper_id)
  const categorySource = productConflictActionPlanMember(plan, resolution.category_source_id)
  const brandSource = productConflictActionPlanMember(plan, resolution.brand_source_id)
  const unitSource = productConflictActionPlanMember(plan, resolution.unit_source_id)
  let barcodeSourceId: number | null = null
  let barcodeValue = ''
  if (resolution.barcode.mode === 'canonical') {
    if (plan.eligibility_basis !== 'barcode') {
      throw new ProductConflictMergeValidationError('Canonical barcode is available only for a barcode-eligible group.', 'invalid_resolution')
    }
    barcodeValue = canonicalProductBarcode(plan.members.map((member) => ({ id: Number(member.id), barcode: member.barcode })))
  } else if (resolution.barcode.mode === 'member') {
    barcodeSourceId = resolution.barcode.source_product_id
    barcodeValue = identityBarcodeKey(productConflictActionPlanMember(plan, barcodeSourceId).barcode)
  }
  const groupOperationId = `product-merge-group-${(await productConflictSha256({ review_id: review.id, group_key: plan.group_key })).slice(7)}`
  const foldMembers = memberIds.filter((id) => id !== resolution.keeper_id).sort((a, b) => a - b)
  const foldOperations = []
  for (const memberId of foldMembers) foldOperations.push({
    member_id: memberId,
    operation_id: `product-merge-member-${(await productConflictSha256({ review_id: review.id, group_key: plan.group_key, member_id: memberId })).slice(7)}`,
  })
  const clusterPlan = createProductMergeClusterPlan(
    `reviewed:${plan.eligibility_basis}:${plan.eligibility_value}`,
    resolution.keeper_id,
    plan.members,
  )
  const keeperBatchByKey = new Map(plan.lots.rows.filter((row) => Number(row.product_id) === resolution.keeper_id)
    .map((row) => [String(row.batch_key), Number(row.batch_id)]))
  const lotDispositions: ProductConflictActionFinalPlan['projected_result']['lot_dispositions'] = []
  for (const memberId of foldMembers) {
    for (const row of plan.lots.rows.filter((candidate) => Number(candidate.product_id) === memberId)) {
      const key = String(row.batch_key)
      const target = keeperBatchByKey.get(key)
      lotDispositions.push({ ...row, source_batch_id: Number(row.batch_id), target_batch_id: target ?? Number(row.batch_id),
        collision: target ? 'fold' : 'reparent' })
      if (target == null) keeperBatchByKey.set(key, Number(row.batch_id))
    }
  }
  const category = categorySource.category ?? null
  const categories = categorySource.categories ?? null
  const brand = brandSource.brand ?? null
  const brands = brandSource.brands ?? null
  const unit = unitSource.unit ?? null
  return {
    version: 1, authority: 'reviewed_product_conflict_v2', review_id: review.id, group_key: plan.group_key,
    draft_digest: review.draft_digest, reviewed_state_digest: plan.state_digest, operation_id: groupOperationId,
    eligibility: { basis: plan.eligibility_basis, value: plan.eligibility_value }, member_ids: memberIds,
    keeper_id: resolution.keeper_id, fold_members: foldOperations, cluster_plan: clusterPlan,
    selected: {
      barcode: { mode: resolution.barcode.mode, source_product_id: barcodeSourceId, value: barcodeValue },
      category: { source_product_id: resolution.category_source_id, value: category, categories },
      brand: { source_product_id: resolution.brand_source_id, value: brand, brands, brand_compact: compactSearchText(brand) },
      unit: { source_product_id: resolution.unit_source_id, value: unit, unit_normalized: normalizeSearchText(unit) },
    },
    image_effect: imageEffect, reviewed_images: imageRows,
    projected_result: {
      economics: plan.economics.merged, barcode: barcodeValue, category, categories, brand, brands,
      brand_compact: compactSearchText(brand), unit, unit_normalized: normalizeSearchText(unit),
      stock_by_branch: plan.stock.projected_by_branch, lot_dispositions: lotDispositions,
    },
  }
}

async function rebuildProductConflictActionStoredPlans(
  db: ReturnType<typeof getDb>, storedGroups: ProductConflictActionStoredGroupRow[],
) {
  const mergeGroups = storedGroups.map((row) => ({
    group_key: row.group_key,
    member_ids: parseProductConflictStoredArray(row.member_ids_json, 'member ids').map(Number),
  }))
  const rebuilt = await buildProductConflictActionReviewPlans(db, mergeGroups)
  const byKey = new Map(rebuilt.map((plan) => [plan.group_key, plan]))
  const plans: Array<ProductConflictActionGroupPlan & { state_digest: string }> = []
  for (const stored of storedGroups) {
    const current = byKey.get(stored.group_key)
    if (!current) throw new ProductConflictMergeValidationError('A reviewed conflict group is missing.', 'review_state_conflict', 409)
    const { state_digest: _ignored, ...currentWithoutDigest } = current
    const sourceKeys = parseProductConflictStoredArray(stored.source_group_keys_json, 'source group keys').map(String)
    const adjusted = { ...currentWithoutDigest, source_group_keys: sourceKeys }
    const stateDigest = await productConflictSha256({ version: 2, group: adjusted })
    plans.push({ ...adjusted, state_digest: stateDigest })
  }
  return plans
}

async function readProductConflictActionImageRows(db: ReturnType<typeof getDb>, productIds: number[]) {
  const rows: Array<{ product_id: number; image_path: string; sort_order: number | null }> = []
  let count = 0
  let bytes = 0
  for (let offset = 0; offset < productIds.length; offset += PRODUCT_CONFLICT_ACTION_READ_CHUNK) {
    const chunk = productIds.slice(offset, offset + PRODUCT_CONFLICT_ACTION_READ_CHUNK)
    const { sql, params } = buildInClause('reviewImageProduct', chunk)
    const stats = await db.prepare(`SELECT COUNT(*) AS count,
      COALESCE(SUM(length(CAST(COALESCE(image_path,'') AS BLOB))),0) AS bytes
      FROM product_images WHERE product_id IN (${sql})`).get<{ count: number; bytes: number }>(params)
    count += Number(stats?.count) || 0
    bytes += Number(stats?.bytes) || 0
  }
  if (count > productIds.length * ADMIN_MAX_IMAGES_PER_PRODUCT || bytes > PRODUCT_CONFLICT_ACTION_MAX_REVIEW_DETAIL_BYTES) {
    throw new ProductConflictMergeValidationError('Product images changed beyond the bounded review.', 'review_state_conflict', 409)
  }
  for (let offset = 0; offset < productIds.length; offset += PRODUCT_CONFLICT_ACTION_READ_CHUNK) {
    const chunk = productIds.slice(offset, offset + PRODUCT_CONFLICT_ACTION_READ_CHUNK)
    const { sql, params } = buildInClause('reviewImageProduct', chunk)
    rows.push(...await db.prepare(`SELECT product_id,image_path,sort_order FROM product_images
      WHERE product_id IN (${sql}) ORDER BY product_id,sort_order,id`)
      .all<{ product_id: number; image_path: string; sort_order: number | null }>(params))
  }
  return rows.map((row) => ({ product_id: Number(row.product_id), image_path: String(row.image_path),
    sort_order: row.sort_order == null ? null : Number(row.sort_order) }))
}

function productConflictActionImageEffect(
  plan: ProductConflictActionGroupPlan,
  keeperId: number,
  imageRows: Array<{ product_id: number; image_path: string; sort_order: number | null }>,
): boolean {
  const discarded = new Set(plan.member_ids.filter((id) => id !== keeperId))
  if (imageRows.some((row) => discarded.has(row.product_id))) return true
  const keeper = productConflictActionPlanMember(plan, keeperId)
  return !String(keeper.image_path ?? '').trim()
    && plan.members.some((member) => discarded.has(Number(member.id)) && Boolean(String(member.image_path ?? '').trim()))
}

function productConflictActionFinalizeStateGuard(
  plans: Array<ProductConflictActionGroupPlan & { state_digest: string }>,
  imageRows: Array<{ product_id: number; image_path: string; sort_order: number | null }>,
) {
  const memberIds = [...new Set(plans.flatMap((plan) => plan.member_ids))].sort((a, b) => a - b)
  const products = plans.flatMap((plan) => plan.members).sort((a, b) => Number(a.id) - Number(b.id))
  const stock = plans.flatMap((plan) => plan.stock.rows)
    .sort((a, b) => Number(a.product_id) - Number(b.product_id) || Number(a.branch_id) - Number(b.branch_id))
  const lots = plans.flatMap((plan) => plan.lots.rows)
    .sort((a, b) => Number(a.product_id) - Number(b.product_id) || Number(a.batch_id) - Number(b.batch_id)
      || Number(a.branch_id ?? -1) - Number(b.branch_id ?? -1))
  const productFields = ['name', 'barcode', 'category', 'categories', 'brand', 'brands', 'brand_compact', 'unit', 'unit_normalized', 'image_path',
    'updated_at', 'cost_price_usd', 'cost_price_khr', 'selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr']
  const lotFields = ['batch_key', 'lot_code', 'expiry_date', 'received_at', 'is_active', 'notes', 'unit_cost_usd', 'received_quantity',
    'received_branch_id', 'received_cost_usd', 'supplier_id', 'supplier_name', 'payment_status', 'credit_due_date', 'quantity']
  const productMismatch = productFields.map((field) => `p.${field} IS NOT json_extract(expected.value,'$.${field}')`).join(' OR ')
  const lotMismatch = lotFields.map((field) => `${field === 'quantity' ? 'bbs' : 'pb'}.${field} IS NOT json_extract(expected.value,'$.${field}')`).join(' OR ')
  return {
    sql: `SELECT CASE WHEN
      (SELECT COUNT(*) FROM products WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(@memberIdsJson)))=json_array_length(@productsJson)
      AND NOT EXISTS(SELECT 1 FROM json_each(@productsJson) expected LEFT JOIN products p
        ON p.id=CAST(json_extract(expected.value,'$.id') AS INTEGER)
        WHERE p.id IS NULL OR COALESCE(p.is_active,0)<>1 OR COALESCE(p.is_group,0)<>0 OR ${productMismatch})
      AND (SELECT COUNT(*) FROM branch_stock WHERE product_id IN (SELECT CAST(value AS INTEGER) FROM json_each(@memberIdsJson)))=json_array_length(@stockJson)
      AND NOT EXISTS(SELECT 1 FROM json_each(@stockJson) expected LEFT JOIN branch_stock bs
        ON bs.product_id=CAST(json_extract(expected.value,'$.product_id') AS INTEGER)
       AND bs.branch_id=CAST(json_extract(expected.value,'$.branch_id') AS INTEGER)
       LEFT JOIN branches b ON b.id=bs.branch_id
       WHERE bs.product_id IS NULL OR bs.quantity IS NOT json_extract(expected.value,'$.quantity')
          OR b.name IS NOT json_extract(expected.value,'$.branch_name'))
      AND (SELECT COUNT(*) FROM product_batches pb LEFT JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id
        WHERE pb.variant_product_id IN (SELECT CAST(value AS INTEGER) FROM json_each(@memberIdsJson)))=json_array_length(@lotsJson)
      AND NOT EXISTS(SELECT 1 FROM json_each(@lotsJson) expected LEFT JOIN product_batches pb
        ON pb.variant_product_id=CAST(json_extract(expected.value,'$.product_id') AS INTEGER)
       AND pb.id=CAST(json_extract(expected.value,'$.batch_id') AS INTEGER)
       LEFT JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id
        AND bbs.branch_id IS json_extract(expected.value,'$.branch_id')
       WHERE pb.id IS NULL
          OR (json_extract(expected.value,'$.branch_id') IS NULL AND EXISTS(SELECT 1 FROM branch_batch_stock actual_bbs WHERE actual_bbs.batch_id=pb.id))
          OR (json_extract(expected.value,'$.branch_id') IS NOT NULL AND bbs.batch_id IS NULL)
          OR ${lotMismatch})
      AND (SELECT COUNT(*) FROM product_images WHERE product_id IN (SELECT CAST(value AS INTEGER) FROM json_each(@memberIdsJson)))=json_array_length(@imagesJson)
      AND NOT EXISTS(SELECT 1 FROM json_each(@imagesJson) expected LEFT JOIN product_images pi
        ON pi.product_id=CAST(json_extract(expected.value,'$.product_id') AS INTEGER)
       AND pi.image_path=json_extract(expected.value,'$.image_path')
       AND pi.sort_order IS json_extract(expected.value,'$.sort_order')
       WHERE pi.id IS NULL)
      THEN 1 ELSE json_extract('', '$') END AS product_conflict_finalize_state_guard`,
    params: {
      memberIdsJson: JSON.stringify(memberIds), productsJson: JSON.stringify(products), stockJson: JSON.stringify(stock),
      lotsJson: JSON.stringify(lots), imagesJson: JSON.stringify(imageRows),
    },
  }
}

function chunkProductConflictActionRows<T>(rows: T[], maxBytes: number): T[][] {
  const chunks: T[][] = []
  let current: T[] = []
  let currentBytes = 2
  const encoder = new TextEncoder()
  for (const row of rows) {
    const rowBytes = encoder.encode(JSON.stringify(row)).length + (current.length ? 1 : 0)
    if (current.length && currentBytes + rowBytes > maxBytes) {
      chunks.push(current)
      current = [row]
      currentBytes = 2 + rowBytes - 1
    } else {
      current.push(row)
      currentBytes += rowBytes
    }
  }
  if (current.length) chunks.push(current)
  return chunks
}

function productConflictActionFinalizeStateGuards(
  plans: Array<ProductConflictActionGroupPlan & { state_digest: string }>,
  imageRows: Array<{ product_id: number; image_path: string; sort_order: number | null }>,
) {
  return chunkProductConflictActionRows(plans, PRODUCT_CONFLICT_ACTION_MAX_GROUP_DETAIL_BYTES).map((chunk) => {
    const memberIds = new Set(chunk.flatMap((plan) => plan.member_ids))
    return productConflictActionFinalizeStateGuard(chunk, imageRows.filter((row) => memberIds.has(row.product_id)))
  })
}

function productConflictActionFinalizeResponse(
  review: ProductConflictActionReviewRow,
  storedGroups: ProductConflictActionStoredGroupRow[],
  finalPlans: ProductConflictActionFinalPlan[],
  manifestDigest: string,
  storedRemovals: ProductConflictActionStoredRemovalRow[] = [],
) {
  const mergeFolds = finalPlans.reduce((sum, plan) => sum + plan.fold_members.length, 0)
  return {
    success: true, manifest_version: 1, resolution_version: 2, review_id: review.id,
    manifest_digest: manifestDigest, status: 'finalized',
    counts: {
      requested_groups: Number(review.requested_group_count), canonical_groups: storedGroups.length,
      ready_groups: finalPlans.length, blocked_groups: storedGroups.length - finalPlans.length,
      total_members: Number(review.total_member_count), merge_folds: mergeFolds,
      ...(storedRemovals.length ? {
        requested_actions: Number(review.requested_action_count), requested_removals: Number(review.requested_removal_count),
        ready_removals: storedRemovals.filter((row) => row.status !== 'blocked').length,
        blocked_removals: storedRemovals.filter((row) => row.status === 'blocked').length,
      } : {}),
    },
    summary: {
      groups_ready: finalPlans.length, groups_blocked: storedGroups.length - finalPlans.length,
      image_effect_groups: finalPlans.filter((plan) => plan.image_effect).length,
      ...(storedRemovals.length ? { removals_ready: storedRemovals.filter((row) => row.status !== 'blocked').length,
        removals_blocked: storedRemovals.filter((row) => row.status === 'blocked').length } : {}),
    },
  }
}

type ProductConflictActionInputStats = {
  compactProducts: ProductConflictActionProductRow[]
  productBytesById: Map<number, number>
  stockRowsByProductId: Map<number, number>
  stockBytesByProductId: Map<number, number>
  lotDetailRowsByProductId: Map<number, number>
  lotBytesByProductId: Map<number, number>
}

function productConflictActionMeasuredBytes(value: unknown): number {
  const measured = Number(value)
  return Number.isSafeInteger(measured) && measured > 0 ? measured : 0
}

async function readProductConflictActionInputStats(db: ReturnType<typeof getDb>, ids: number[]): Promise<ProductConflictActionInputStats> {
  const compactProducts: ProductConflictActionProductRow[] = []
  const productBytesById = new Map<number, number>()
  const stockRowsByProductId = new Map<number, number>()
  const stockBytesByProductId = new Map<number, number>()
  const lotDetailRowsByProductId = new Map<number, number>()
  const lotBytesByProductId = new Map<number, number>()
  for (let offset = 0; offset < ids.length; offset += PRODUCT_CONFLICT_ACTION_READ_CHUNK) {
    const chunk = ids.slice(offset, offset + PRODUCT_CONFLICT_ACTION_READ_CHUNK)
    const { sql, params } = buildInClause('reviewProduct', chunk)
    const productStats = await db.prepare(`SELECT id,is_active,COALESCE(is_group,0) AS is_group,
      cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,wholesale_price_usd,wholesale_price_khr,
      length(CAST(COALESCE(name,'') AS BLOB))+length(CAST(COALESCE(barcode,'') AS BLOB))+
      length(CAST(COALESCE(category,'') AS BLOB))+length(CAST(COALESCE(categories,'') AS BLOB))+
      length(CAST(COALESCE(brand,'') AS BLOB))+length(CAST(COALESCE(brands,'') AS BLOB))+
      length(CAST(COALESCE(brand_compact,'') AS BLOB))+length(CAST(COALESCE(unit,'') AS BLOB))+
      length(CAST(COALESCE(unit_normalized,'') AS BLOB))+length(CAST(COALESCE(image_path,'') AS BLOB))+
      length(CAST(COALESCE(updated_at,'') AS BLOB))+length(CAST(COALESCE(cost_price_usd,'') AS BLOB))+
      length(CAST(COALESCE(cost_price_khr,'') AS BLOB))+length(CAST(COALESCE(selling_price_usd,'') AS BLOB))+
      length(CAST(COALESCE(selling_price_khr,'') AS BLOB))+length(CAST(COALESCE(wholesale_price_usd,'') AS BLOB))+
      length(CAST(COALESCE(wholesale_price_khr,'') AS BLOB)) AS detail_bytes
      FROM products WHERE id IN (${sql}) ORDER BY id`).all<ProductConflictActionProductRow & { detail_bytes: number }>(params)
    for (const row of productStats) {
      const id = Number(row.id)
      productBytesById.set(id, productConflictActionMeasuredBytes(row.detail_bytes))
      compactProducts.push({
        id, name: null, barcode: null, category: null, categories: null, brand: null, brands: null,
        brand_compact: null, unit: null, unit_normalized: null, image_path: null,
        is_active: Number(row.is_active), is_group: Number(row.is_group), updated_at: null,
        cost_price_usd: row.cost_price_usd, cost_price_khr: row.cost_price_khr,
        selling_price_usd: row.selling_price_usd, selling_price_khr: row.selling_price_khr,
        wholesale_price_usd: row.wholesale_price_usd, wholesale_price_khr: row.wholesale_price_khr,
      })
    }
    const stockStats = await db.prepare(`SELECT bs.product_id,COUNT(*) AS detail_rows,
      COALESCE(SUM(length(CAST(COALESCE(bs.branch_id,'') AS BLOB))+
        length(CAST(COALESCE(b.name,'') AS BLOB))+length(CAST(COALESCE(bs.quantity,'') AS BLOB))+
        length(CAST(COALESCE(bs.rfid_confirmed_qty,'') AS BLOB))),0) AS detail_bytes
      FROM branch_stock bs LEFT JOIN branches b ON b.id=bs.branch_id
      WHERE bs.product_id IN (${sql}) GROUP BY bs.product_id ORDER BY bs.product_id`)
      .all<{ product_id: number; detail_rows: number; detail_bytes: number }>(params)
    for (const row of stockStats) {
      const id = Number(row.product_id)
      stockRowsByProductId.set(id, productConflictActionMeasuredBytes(row.detail_rows))
      stockBytesByProductId.set(id, productConflictActionMeasuredBytes(row.detail_bytes))
    }
    const lotStats = await db.prepare(`SELECT pb.variant_product_id AS product_id,COUNT(*) AS detail_rows,
      COALESCE(SUM(length(CAST(COALESCE(pb.id,'') AS BLOB))+length(CAST(COALESCE(pb.batch_key,'') AS BLOB))+
        length(CAST(COALESCE(pb.lot_code,'') AS BLOB))+length(CAST(COALESCE(pb.expiry_date,'') AS BLOB))+
        length(CAST(COALESCE(pb.received_at,'') AS BLOB))+length(CAST(COALESCE(pb.is_active,'') AS BLOB))+
        length(CAST(COALESCE(pb.notes,'') AS BLOB))+length(CAST(COALESCE(pb.unit_cost_usd,'') AS BLOB))+
        length(CAST(COALESCE(pb.received_quantity,'') AS BLOB))+length(CAST(COALESCE(pb.received_branch_id,'') AS BLOB))+
        length(CAST(COALESCE(pb.received_cost_usd,'') AS BLOB))+length(CAST(COALESCE(pb.supplier_id,'') AS BLOB))+
        length(CAST(COALESCE(pb.supplier_name,'') AS BLOB))+length(CAST(COALESCE(pb.payment_status,'') AS BLOB))+
        length(CAST(COALESCE(pb.credit_due_date,'') AS BLOB))+length(CAST(COALESCE(bbs.branch_id,'') AS BLOB))+
        length(CAST(COALESCE(bbs.quantity,'') AS BLOB))),0) AS detail_bytes
      FROM product_batches pb LEFT JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id
      WHERE pb.variant_product_id IN (${sql}) GROUP BY pb.variant_product_id ORDER BY pb.variant_product_id`)
      .all<{ product_id: number; detail_rows: number; detail_bytes: number }>(params)
    for (const row of lotStats) {
      const id = Number(row.product_id)
      lotDetailRowsByProductId.set(id, productConflictActionMeasuredBytes(row.detail_rows))
      lotBytesByProductId.set(id, productConflictActionMeasuredBytes(row.detail_bytes))
    }
  }
  return { compactProducts, productBytesById, stockRowsByProductId, stockBytesByProductId, lotDetailRowsByProductId, lotBytesByProductId }
}

function productConflictActionReviewExpired(review: ProductConflictActionReviewRow, now = Date.now()): boolean {
  const expires = Date.parse(review.expires_at)
  return review.status === 'expired' || (review.status === 'draft' && (!Number.isFinite(expires) || expires <= now))
}

async function expireProductConflictActionReview(db: ReturnType<typeof getDb>, review: ProductConflictActionReviewRow) {
  await db.prepare(`UPDATE product_conflict_action_reviews SET status='expired',updated_at=CURRENT_TIMESTAMP
    WHERE id=@reviewId AND actor_id=@actorId AND status='draft'`).run({ reviewId: review.id, actorId: review.actor_id })
}

async function readBoundedProductConflictActionDetails(db: ReturnType<typeof getDb>, ids: number[], lotIds: number[]) {
  const products: ProductConflictActionProductRow[] = []
  const stock: ProductConflictActionStockRow[] = []
  const lots: ProductConflictActionLotRow[] = []
  for (let offset = 0; offset < ids.length; offset += PRODUCT_CONFLICT_ACTION_READ_CHUNK) {
    const chunk = ids.slice(offset, offset + PRODUCT_CONFLICT_ACTION_READ_CHUNK)
    const { sql, params } = buildInClause('reviewLotProduct', chunk)
    products.push(...await db.prepare(`SELECT id,name,barcode,category,categories,brand,brands,brand_compact,unit,unit_normalized,image_path,is_active,COALESCE(is_group,0) AS is_group,updated_at,
      cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,wholesale_price_usd,wholesale_price_khr
      FROM products WHERE id IN (${sql}) ORDER BY id`).all<ProductConflictActionProductRow>(params))
    stock.push(...await db.prepare(`SELECT bs.product_id,bs.branch_id,b.name AS branch_name,bs.quantity,bs.rfid_confirmed_qty
      FROM branch_stock bs LEFT JOIN branches b ON b.id=bs.branch_id WHERE bs.product_id IN (${sql})
      ORDER BY bs.product_id,bs.branch_id`).all<ProductConflictActionStockRow>(params))
  }
  for (let offset = 0; offset < lotIds.length; offset += PRODUCT_CONFLICT_ACTION_READ_CHUNK) {
    const chunk = lotIds.slice(offset, offset + PRODUCT_CONFLICT_ACTION_READ_CHUNK)
    const { sql, params } = buildInClause('reviewLotProduct', chunk)
    lots.push(...await db.prepare(`SELECT pb.variant_product_id AS product_id,pb.id AS batch_id,pb.batch_key,pb.lot_code,pb.expiry_date,pb.received_at,
      pb.is_active,pb.notes,pb.unit_cost_usd,pb.received_quantity,pb.received_branch_id,pb.received_cost_usd,
      pb.supplier_id,pb.supplier_name,pb.payment_status,pb.credit_due_date,bbs.branch_id,bbs.quantity
      FROM product_batches pb LEFT JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id
      WHERE pb.variant_product_id IN (${sql}) ORDER BY pb.variant_product_id,pb.id,bbs.branch_id`).all<ProductConflictActionLotRow>(params))
  }
  return { products, stock, lots }
}

async function buildProductConflictActionReviewPlans(
  db: ReturnType<typeof getDb>,
  mergeGroups: ReturnType<typeof parseProductConflictActionPreviewRequest>['merge_groups'],
) {
  const ids = [...new Set(mergeGroups.flatMap((group) => group.member_ids))].sort((a, b) => a - b)
  const inputStats = await readProductConflictActionInputStats(db, ids)
  const detailRefusals = new Map<string, { lotRows: number; message: string; compact: boolean }>()
  const detailAllowedIds = new Set<number>()
  const lotAllowedIds = new Set<number>()
  let retainedDetailRows = 0
  let retainedDetailBytes = 0
  for (const group of canonicalizeProductConflictActionGroups(mergeGroups)) {
    const detailRows = group.member_ids.reduce((sum, id) => sum + (inputStats.lotDetailRowsByProductId.get(id) || 0), 0)
    const productBytes = group.member_ids.reduce((sum, id) => sum + (inputStats.productBytesById.get(id) || 0), 0)
    const stockRows = group.member_ids.reduce((sum, id) => sum + (inputStats.stockRowsByProductId.get(id) || 0), 0)
    const stockBytes = group.member_ids.reduce((sum, id) => sum + (inputStats.stockBytesByProductId.get(id) || 0), 0)
    const lotBytes = group.member_ids.reduce((sum, id) => sum + (inputStats.lotBytesByProductId.get(id) || 0), 0)
    // JSON escaping can expand one source byte to six bytes; fixed row allowances cover field names and punctuation.
    const baseEstimatedBytes = 6 * (productBytes + stockBytes) + group.member_ids.length * 512 + stockRows * 192
    const lotEstimatedBytes = 6 * lotBytes + detailRows * 640
    const compact = baseEstimatedBytes > PRODUCT_CONFLICT_ACTION_MAX_GROUP_SOURCE_BYTES
      || retainedDetailBytes + baseEstimatedBytes > PRODUCT_CONFLICT_ACTION_MAX_REVIEW_DETAIL_BYTES
    const refuseLots = detailRows > PRODUCT_CONFLICT_ACTION_MAX_LOT_ROWS_PER_GROUP
      || retainedDetailRows + detailRows > PRODUCT_CONFLICT_ACTION_MAX_LOT_ROWS_PER_REVIEW
      || baseEstimatedBytes + lotEstimatedBytes > PRODUCT_CONFLICT_ACTION_MAX_GROUP_SOURCE_BYTES
      || retainedDetailBytes + baseEstimatedBytes + lotEstimatedBytes > PRODUCT_CONFLICT_ACTION_MAX_REVIEW_DETAIL_BYTES
    if (compact) {
      detailRefusals.set(group.group_key, { lotRows: detailRows, message: 'This group detail is too large for one bounded review. Review it separately.', compact: true })
    } else if (refuseLots) {
      retainedDetailBytes += baseEstimatedBytes
      group.member_ids.forEach((id) => detailAllowedIds.add(id))
      detailRefusals.set(group.group_key, { lotRows: detailRows, message: 'This group has too much lot history for one bounded review. Review it separately.', compact: false })
    } else {
      retainedDetailRows += detailRows
      retainedDetailBytes += baseEstimatedBytes + lotEstimatedBytes
      group.member_ids.forEach((id) => { detailAllowedIds.add(id); lotAllowedIds.add(id) })
    }
  }
  const inputs = await readBoundedProductConflictActionDetails(db,
    [...detailAllowedIds].sort((a, b) => a - b), [...lotAllowedIds].sort((a, b) => a - b))
  const productsById = new Map(inputStats.compactProducts.map((row) => [Number(row.id), row]))
  inputs.products.forEach((row) => productsById.set(Number(row.id), row))
  const builtPlans = buildProductConflictActionGroupPlans(mergeGroups, [...productsById.values()], inputs.stock, inputs.lots)
  const rawPlans: ProductConflictActionGroupPlan[] = []
  let persistedDetailBytes = 0
  for (const plan of builtPlans) {
    const refusal = detailRefusals.get(plan.group_key)
    let bounded = refusal ? refuseProductConflictActionGroupDetail(plan, refusal.lotRows, refusal.message, refusal.compact) : plan
    let bytes = new TextEncoder().encode(canonicalProductConflictJson(bounded)).length
    if (bytes > PRODUCT_CONFLICT_ACTION_MAX_GROUP_DETAIL_BYTES || persistedDetailBytes + bytes > PRODUCT_CONFLICT_ACTION_MAX_REVIEW_DETAIL_BYTES) {
      bounded = refuseProductConflictActionGroupDetail(plan, plan.lots.detail_row_count, 'This group detail is too large for one bounded review. Review it separately.', true)
      bytes = new TextEncoder().encode(canonicalProductConflictJson(bounded)).length
    }
    if (bytes > PRODUCT_CONFLICT_ACTION_MAX_GROUP_DETAIL_BYTES || persistedDetailBytes + bytes > PRODUCT_CONFLICT_ACTION_MAX_REVIEW_DETAIL_BYTES) {
      throw new ProductConflictMergeValidationError('The selected conflict review metadata exceeds the bounded review size.', 'review_detail_limit', 413)
    }
    persistedDetailBytes += bytes
    rawPlans.push(bounded)
  }
  const plans = []
  let storedDetailBytes = 0
  for (const plan of rawPlans) {
    let bounded = plan
    let stateDigest = await productConflictSha256({ version: 2, group: bounded })
    let stored = { ...bounded, state_digest: stateDigest }
    let bytes = new TextEncoder().encode(JSON.stringify(stored)).length
    if (bytes > PRODUCT_CONFLICT_ACTION_MAX_GROUP_DETAIL_BYTES || storedDetailBytes + bytes > PRODUCT_CONFLICT_ACTION_MAX_REVIEW_DETAIL_BYTES) {
      bounded = refuseProductConflictActionGroupDetail(plan, plan.lots.detail_row_count,
        'This group detail is too large for one bounded review. Review it separately.', true)
      stateDigest = await productConflictSha256({ version: 2, group: bounded })
      stored = { ...bounded, state_digest: stateDigest }
      bytes = new TextEncoder().encode(JSON.stringify(stored)).length
    }
    if (bytes > PRODUCT_CONFLICT_ACTION_MAX_GROUP_DETAIL_BYTES || storedDetailBytes + bytes > PRODUCT_CONFLICT_ACTION_MAX_REVIEW_DETAIL_BYTES) {
      throw new ProductConflictMergeValidationError('The selected conflict review metadata exceeds the bounded review size.', 'review_detail_limit', 413)
    }
    storedDetailBytes += bytes
    plans.push(stored)
  }
  return plans
}

async function createProductConflictActionReview(
  db: ReturnType<typeof getDb>, actorId: number,
  request: ReturnType<typeof parseProductConflictActionPreviewRequest>, requestDigest: string,
) {
  const ids = [...new Set([...request.merge_groups.flatMap((group) => group.member_ids),
    ...request.remove_rows.map((row) => row.product_id)])].sort((a, b) => a - b)
  const plans = await buildProductConflictActionReviewPlans(db, request.merge_groups)
  const removalPlans = await prepareProductRemoveReviewPlans(db, request.remove_rows)
  const combinedDetailBytes = plans.reduce((sum, plan) => sum + new TextEncoder().encode(JSON.stringify(plan)).length, 0)
    + removalPlans.reduce((sum, plan) => sum + new TextEncoder().encode(plan.detail_json).length, 0)
  if (combinedDetailBytes > PRODUCT_CONFLICT_ACTION_MAX_REVIEW_DETAIL_BYTES) {
    throw new ProductConflictMergeValidationError('The selected conflict review metadata exceeds the bounded review size.', 'review_detail_limit', 413)
  }
  const reviewId = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  const draftDigest = await productConflictSha256({ manifest_version: 1, resolution_version: 2,
    groups: plans.map((plan, ordinal) => ({ ordinal, group_key: plan.group_key, member_ids: plan.member_ids, state_digest: plan.state_digest })),
    removals: removalPlans.map((plan, index) => ({ action_ordinal: plans.length + index, product_id: plan.product_id,
      state_digest: plan.state_digest, plan_digest: plan.plan_digest, blocked: plan.blocked?.code ?? null })) })
  const actionable = plans.filter((plan) => !plan.blocked).length
  const statements: Array<{ sql: string; params?: Record<string, unknown> }> = [{
    sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM product_conflict_action_reviews
      WHERE actor_id=@actorId AND status='draft' AND expires_at>@now) < @maxDrafts
      THEN 1 ELSE json_extract('', '$') END AS product_conflict_review_limit_guard`,
    params: { actorId, now: new Date().toISOString(), maxDrafts: PRODUCT_CONFLICT_ACTION_MAX_ACTIVE_DRAFTS },
  }, {
    sql: `INSERT INTO product_conflict_action_reviews
      (id,actor_id,request_id,request_digest,manifest_version,resolution_version,draft_digest,status,
       requested_action_count,requested_group_count,requested_removal_count,actionable_group_count,blocked_group_count,total_member_count,expires_at)
      VALUES(@id,@actorId,@requestId,@requestDigest,1,2,@draftDigest,'draft',@actions,@groups,@removals,@actionable,@blocked,@members,@expiresAt)`,
    params: { id: reviewId, actorId, requestId: request.client_request_id, requestDigest, draftDigest,
      actions: plans.length + removalPlans.length, groups: plans.length, removals: removalPlans.length,
      actionable, blocked: plans.length - actionable, members: ids.length, expiresAt },
  }]
  const groups = plans.map((plan, ordinal) => ({ ordinal, group_key: plan.group_key,
    source_group_keys_json: JSON.stringify(plan.source_group_keys), member_ids_json: JSON.stringify(plan.member_ids),
    eligibility_basis: plan.eligibility_basis, eligibility_value: plan.eligibility_value,
    status: plan.blocked ? 'blocked' : 'actionable', blocker_code: plan.blocked?.code ?? null,
    blocker_message: plan.blocked?.message ?? null, state_digest: plan.state_digest, detail_json: JSON.stringify(plan) }))
  for (let offset = 0; offset < groups.length; offset += 100) statements.push({
    sql: `INSERT INTO product_conflict_action_groups
      (review_id,ordinal,group_key,source_group_keys_json,member_ids_json,eligibility_basis,eligibility_value,status,blocker_code,blocker_message,state_digest,detail_json)
      SELECT @reviewId,CAST(json_extract(value,'$.ordinal') AS INTEGER),json_extract(value,'$.group_key'),json_extract(value,'$.source_group_keys_json'),
        json_extract(value,'$.member_ids_json'),json_extract(value,'$.eligibility_basis'),json_extract(value,'$.eligibility_value'),json_extract(value,'$.status'),
        json_extract(value,'$.blocker_code'),json_extract(value,'$.blocker_message'),json_extract(value,'$.state_digest'),json_extract(value,'$.detail_json')
      FROM json_each(@rowsJson)`,
    params: { reviewId, rowsJson: JSON.stringify(groups.slice(offset, offset + 100)) },
  })
  const members = plans.flatMap((plan, groupOrdinal) => plan.member_ids.map((id, memberOrdinal) => ({ group_ordinal: groupOrdinal,
    member_ordinal: memberOrdinal, product_id: id, state_digest: plan.state_digest,
    snapshot_json: JSON.stringify(plan.members.find((member) => Number(member.id) === id) || {}) })))
  for (let offset = 0; offset < members.length; offset += 200) statements.push({
    sql: `INSERT INTO product_conflict_action_group_members
      (review_id,group_ordinal,member_ordinal,product_id,role,status,state_digest,snapshot_json)
      SELECT @reviewId,CAST(json_extract(value,'$.group_ordinal') AS INTEGER),CAST(json_extract(value,'$.member_ordinal') AS INTEGER),
        CAST(json_extract(value,'$.product_id') AS INTEGER),'candidate','reviewed',json_extract(value,'$.state_digest'),json_extract(value,'$.snapshot_json')
      FROM json_each(@rowsJson)`,
    params: { reviewId, rowsJson: JSON.stringify(members.slice(offset, offset + 200)) },
  })
  const removals: Array<Record<string, unknown>> = []
  for (let index = 0; index < removalPlans.length; index += 1) {
    const removal = removalPlans[index]
    removals.push({
      operation_id: `product-remove-review-${(await productConflictSha256({ review_id: reviewId, product_id: removal.product_id })).slice(7)}`,
      request_id: `${request.client_request_id}:remove:${index}`, action_ordinal: plans.length + index,
      product_id: removal.product_id, reason: removal.reason, state_digest: removal.state_digest,
      plan_digest: removal.plan_digest, plan_json: removal.plan ? JSON.stringify(removal.plan) : removal.detail_json,
      status: removal.blocked ? 'blocked' : 'reviewed', blocker_code: removal.blocked?.code ?? null,
      error_message: removal.blocked?.message ?? null,
    })
  }
  for (let offset = 0; offset < removals.length; offset += 100) statements.push({
    sql: `INSERT INTO product_remove_operations(operation_id,actor_id,requester_id,source,request_id,review_id,action_ordinal,
      product_id,reason,state_digest,plan_digest,plan_json,status,blocker_code,error_message)
      SELECT json_extract(value,'$.operation_id'),@actorId,@actorId,'conflict_review',json_extract(value,'$.request_id'),@reviewId,
        CAST(json_extract(value,'$.action_ordinal') AS INTEGER),CAST(json_extract(value,'$.product_id') AS INTEGER),
        json_extract(value,'$.reason'),json_extract(value,'$.state_digest'),json_extract(value,'$.plan_digest'),
        json_extract(value,'$.plan_json'),json_extract(value,'$.status'),json_extract(value,'$.blocker_code'),json_extract(value,'$.error_message')
      FROM json_each(@rowsJson)`,
    params: { actorId, reviewId, rowsJson: JSON.stringify(removals.slice(offset, offset + 100)) },
  })
  await db.batch(statements)
  const review = await readProductConflictActionReview(db, actorId, reviewId)
  if (!review) throw new Error('The conflict action review receipt was not created.')
  return review
}

// Legacy requests remain read-only. Resolution-v2 creates only durable draft
// receipts, so 1600+ reviewed rows can be paged from one immutable snapshot.
app.post('/possible-duplicates/merge-batch/preview', async (c) => {
  const user = c.get('user')
  const bodyRejection = await admitRequestBody(c, PRODUCT_CONFLICT_ACTION_PREVIEW_BODY_BYTES)
  if (bodyRejection) return bodyRejection
  const raw = await c.req.json().catch(() => null)
  if (isProductConflictActionPreviewRequest(raw)) {
    let request
    try { request = parseProductConflictActionPreviewRequest(raw) }
    catch (error) {
      const validation = error instanceof ProductConflictMergeValidationError ? error : new ProductConflictMergeValidationError('The selected conflict review request is invalid.')
      return c.json({ success: false, code: validation.code, error: validation.message }, validation.status as 400 | 409 | 413)
    }
    if (request.merge_groups.length && getActionTier(user, 'products', 'merge_duplicates') !== 'full') {
      return c.json({ success: false, code: 'permission_denied', error: 'Full duplicate merge permission is required.' }, 403)
    }
    if (request.remove_rows.length && getActionTier(user, 'products', 'delete') === 'none') {
      return c.json({ success: false, code: 'permission_denied', error: 'Product removal permission is required.' }, 403)
    }
    const db = getDb(c.env)
    const requestDigest = await productConflictSha256(request)
    const now = new Date()
    let review = await db.prepare(`SELECT id,actor_id,request_id,request_digest,draft_digest,finalize_digest,manifest_digest,status,
      requested_action_count,requested_group_count,requested_removal_count,actionable_group_count,blocked_group_count,total_member_count,expires_at
      FROM product_conflict_action_reviews WHERE actor_id=@actorId AND request_id=@requestId`)
      .get<ProductConflictActionReviewRow>({ actorId: user.id, requestId: request.client_request_id })
    if (review && productConflictActionReviewExpired(review, now.getTime())) {
      await expireProductConflictActionReview(db, review)
      return c.json({ success: false, code: 'review_expired', error: 'This conflict review expired. Start a new review with a new request id.' }, 410)
    }
    if (review && review.request_digest !== requestDigest) {
      return c.json({ success: false, code: 'idempotency_conflict', error: 'client_request_id was already used with a different conflict review.' }, 409)
    }
    if (!review) {
      await db.prepare(`DELETE FROM product_conflict_action_reviews
        WHERE actor_id=@actorId AND status IN ('draft','expired') AND expires_at<=@now`)
        .run({ actorId: user.id, now: now.toISOString() })
      const active = await db.prepare(`SELECT COUNT(*) AS count FROM product_conflict_action_reviews
        WHERE actor_id=@actorId AND status='draft' AND expires_at>@now`)
        .get<{ count: number }>({ actorId: user.id, now: now.toISOString() })
      if (Number(active?.count) >= PRODUCT_CONFLICT_ACTION_MAX_ACTIVE_DRAFTS) {
        return c.json({ success: false, code: 'review_limit_reached', error: 'Finish or wait for an existing conflict review before starting another.' }, 409)
      }
      try { review = await createProductConflictActionReview(db, user.id, request, requestDigest) }
      catch (error) {
        review = await db.prepare(`SELECT id,actor_id,request_id,request_digest,draft_digest,finalize_digest,manifest_digest,status,
          requested_action_count,requested_group_count,requested_removal_count,actionable_group_count,blocked_group_count,total_member_count,expires_at
          FROM product_conflict_action_reviews WHERE actor_id=@actorId AND request_id=@requestId`)
          .get<ProductConflictActionReviewRow>({ actorId: user.id, requestId: request.client_request_id })
        if (!review || review.request_digest !== requestDigest) {
          if (error instanceof ProductConflictMergeValidationError) {
            return c.json({ success: false, code: error.code, error: error.message }, error.status as 400 | 409 | 413)
          }
          const concurrentActive = await db.prepare(`SELECT COUNT(*) AS count FROM product_conflict_action_reviews
            WHERE actor_id=@actorId AND status='draft' AND expires_at>@now`)
            .get<{ count: number }>({ actorId: user.id, now: now.toISOString() })
          if (Number(concurrentActive?.count) >= PRODUCT_CONFLICT_ACTION_MAX_ACTIVE_DRAFTS) {
            return c.json({ success: false, code: 'review_limit_reached', error: 'Finish or wait for an existing conflict review before starting another.' }, 409)
          }
          throw error
        }
      }
    }
    return c.json(await productConflictActionReviewResponse(db, review))
  }
  if (getActionTier(user, 'products', 'merge_duplicates') !== 'full') {
    return c.json({ success: false, code: 'permission_denied', error: 'You do not have permission to perform this action' }, 403)
  }
  let request
  try { request = parseProductConflictPreviewRequest(raw) }
  catch (error) {
    const validation = error instanceof ProductConflictMergeValidationError ? error : new ProductConflictMergeValidationError('The selected merge preview request is invalid.')
    return c.json({ success: false, code: validation.code, error: validation.message }, 400)
  }
  const canChangeImages = getActionTier(user, 'products', 'image') === 'full'
  const { prepared, skipped } = await prepareSelectedConflictCases(getDb(c.env), request.cases, canChangeImages)
  const manifestDigest = await selectedConflictManifestDigest(prepared.filter((item) => !selectedConflictBlocked(item, canChangeImages)))
  return c.json({
    success: true,
    manifest_version: PRODUCT_CONFLICT_MERGE_MANIFEST_VERSION,
    manifest_digest: manifestDigest,
    cases: prepared.map((item) => {
      const blocked = selectedConflictBlocked(item, canChangeImages)
      return {
        ordinal: item.ordinal,
        case_key: item.caseKey,
        keep_id: item.keeper.id,
        merge_id: item.discarded.id,
        needs_stock_choice: item.needsStockChoice,
        before: item.before,
        after_by_stock_choice: item.afterByStockChoice,
        state_digest: item.stateDigest,
        blocked,
      }
    }),
    skipped,
  })
})

app.post('/possible-duplicates/merge-batch/reviews/:reviewId/finalize', async (c) => {
  const user = c.get('user')
  const mergeTier = getActionTier(user, 'products', 'merge_duplicates')
  const removeTier = getActionTier(user, 'products', 'delete')
  const bodyRejection = await admitRequestBody(c, PRODUCT_CONFLICT_ACTION_PREVIEW_BODY_BYTES)
  if (bodyRejection) return bodyRejection
  let request
  try { request = parseProductConflictActionFinalizeRequest(await c.req.json().catch(() => null)) }
  catch (error) {
    const validation = error instanceof ProductConflictMergeValidationError ? error : new ProductConflictMergeValidationError('The conflict finalization request is invalid.')
    return c.json({ success: false, code: validation.code, error: validation.message }, validation.status as 400 | 409 | 413)
  }
  if (c.req.param('reviewId') !== request.review_id) {
    return c.json({ success: false, code: 'review_id_mismatch', error: 'The path and request review ids must match.' }, 400)
  }
  const db = getDb(c.env)
  let review = await readProductConflictActionReview(db, user.id, request.review_id)
  if (!review) return c.json({ success: false, code: 'review_not_found', error: 'Conflict review not found.' }, 404)
  if (Number(review.requested_group_count) > 0 && mergeTier !== 'full') {
    return c.json({ success: false, code: 'permission_denied', error: 'Full duplicate merge permission is required.' }, 403)
  }
  if (Number(review.requested_removal_count) > 0 && removeTier === 'none') {
    return c.json({ success: false, code: 'permission_denied', error: 'Product removal permission is required.' }, 403)
  }
  if (productConflictActionReviewExpired(review)) {
    await expireProductConflictActionReview(db, review)
    return c.json({ success: false, code: 'review_expired', error: 'This conflict review expired. Start a new review.' }, 410)
  }
  const finalizeDigest = await productConflictSha256(request)
  let storedGroups = await readProductConflictActionStoredGroups(db, review.id)
  const storedRemovals = await readProductConflictActionStoredRemovals(db, review.id)
  const readReplayPlans = () => storedGroups.filter((row) => row.status !== 'blocked')
    .map((row) => {
      try {
        const parsed = JSON.parse(String(row.final_plan_json || 'null')) as ProductConflictActionFinalPlan
        if (!parsed || parsed.authority !== 'reviewed_product_conflict_v2' || parsed.review_id !== review?.id || parsed.group_key !== row.group_key) throw new Error('invalid plan')
        return parsed
      } catch { throw new ProductConflictMergeValidationError('The finalized conflict review is unreadable.', 'review_corrupt', 409) }
    })
  if (review.status === 'finalized' || review.status === 'running' || review.status === 'completed' || review.status === 'interrupted') {
    if (review.finalize_digest !== finalizeDigest || !review.manifest_digest) {
      return c.json({ success: false, code: 'finalized_conflict', error: 'This review was finalized with different selections.' }, 409)
    }
    const replayPlans = readReplayPlans()
    if (replayPlans.some((plan) => plan.image_effect) && getActionTier(user, 'products', 'image') !== 'full') {
      return c.json({ success: false, code: 'image_permission_required', error: 'This finalized review changes product images and requires full image permission.' }, 403)
    }
    return c.json(productConflictActionFinalizeResponse(review, storedGroups, replayPlans, review.manifest_digest, storedRemovals))
  }
  if (review.status !== 'draft' || review.draft_digest !== request.draft_digest) {
    return c.json({ success: false, code: 'review_state_conflict', error: 'The reviewed conflict draft changed. Refresh before finalizing.' }, 409)
  }
  const actionableGroups = storedGroups.filter((row) => row.status === 'actionable')
  const blockedKeys = new Set(storedGroups.filter((row) => row.status === 'blocked').map((row) => row.group_key))
  const resolutions = new Map(request.resolutions.map((resolution) => [resolution.group_key, resolution]))
  if (resolutions.size !== actionableGroups.length
    || actionableGroups.some((row) => !resolutions.has(row.group_key))
    || request.resolutions.some((resolution) => blockedKeys.has(resolution.group_key))) {
    return c.json({ success: false, code: 'invalid_resolution', error: 'Provide exactly one resolution for every actionable canonical group and omit blocked groups.' }, 400)
  }
  let currentPlans: Array<ProductConflictActionGroupPlan & { state_digest: string }>
  let actionableCurrentPlans: Array<ProductConflictActionGroupPlan & { state_digest: string }>
  let imageRows: Array<{ product_id: number; image_path: string; sort_order: number | null }>
  let finalPlans: ProductConflictActionFinalPlan[] = []
  try {
    currentPlans = await rebuildProductConflictActionStoredPlans(db, storedGroups)
    if (currentPlans.some((plan, index) => plan.state_digest !== storedGroups[index]?.state_digest)) {
      throw new ProductConflictMergeValidationError('A selected conflict group changed after review.', 'review_state_conflict', 409)
    }
    const actionableKeys = new Set(actionableGroups.map((row) => row.group_key))
    actionableCurrentPlans = currentPlans.filter((plan) => actionableKeys.has(plan.group_key))
    const productIds = [...new Set(actionableCurrentPlans.flatMap((plan) => plan.member_ids))].sort((a, b) => a - b)
    imageRows = await readProductConflictActionImageRows(db, productIds)
    for (const row of actionableGroups) {
      const plan = currentPlans.find((candidate) => candidate.group_key === row.group_key)
      const resolution = resolutions.get(row.group_key)
      if (!plan || !resolution) throw new ProductConflictMergeValidationError('A conflict resolution is missing.', 'invalid_resolution')
      const memberSet = new Set(plan.member_ids)
      const groupImages = imageRows.filter((image) => memberSet.has(image.product_id))
      finalPlans.push(await buildProductConflictActionFinalPlan(review, plan, resolution,
        productConflictActionImageEffect(plan, resolution.keeper_id, groupImages), groupImages))
    }
    const currentRemovals = await prepareProductRemoveReviewPlans(db,
      storedRemovals.map((row) => ({ product_id: Number(row.product_id), reason: row.reason })))
    if (currentRemovals.length !== storedRemovals.length) throw new Error('invalid removal count')
    for (let index = 0; index < currentRemovals.length; index += 1) {
      const current = currentRemovals[index]
      const stored = storedRemovals[index]
      const expectedBlocked = stored.status === 'blocked'
      if (current.product_id !== Number(stored.product_id) || current.state_digest !== stored.state_digest
        || current.plan_digest !== stored.plan_digest || Boolean(current.blocked) !== expectedBlocked
        || (!expectedBlocked && (!current.plan || stored.status !== 'reviewed'))) {
        throw new ProductConflictMergeValidationError('A selected removal changed after review.', 'review_state_conflict', 409)
      }
    }
  } catch (error) {
    const validation = error instanceof ProductConflictMergeValidationError ? error : new ProductConflictMergeValidationError('The reviewed conflict state is invalid.', 'review_state_conflict', 409)
    return c.json({ success: false, code: validation.code, error: validation.message }, validation.status as 400 | 409 | 413)
  }
  const imageDenied = finalPlans.filter((plan) => plan.image_effect).map((plan) => plan.group_key)
  if (imageDenied.length && getActionTier(user, 'products', 'image') !== 'full') {
    return c.json({ success: false, code: 'image_permission_required', error: 'One or more selected groups change product images.', groups: imageDenied }, 403)
  }
  const manifestDigest = await productConflictSha256({
    manifest_version: 1, resolution_version: 2, review_id: review.id, draft_digest: review.draft_digest, final_plans: finalPlans,
    removals: storedRemovals.map((row) => ({ action_ordinal: Number(row.action_ordinal), operation_id: row.operation_id,
      product_id: Number(row.product_id), state_digest: row.state_digest, plan_digest: row.plan_digest, status: row.status })),
  })
  let finalBytes = 0
  for (const plan of finalPlans) {
    const bytes = new TextEncoder().encode(JSON.stringify(plan)).length
    finalBytes += bytes
    if (bytes > PRODUCT_CONFLICT_ACTION_MAX_GROUP_DETAIL_BYTES || finalBytes > PRODUCT_CONFLICT_ACTION_MAX_REVIEW_DETAIL_BYTES) {
      return c.json({ success: false, code: 'review_detail_limit', error: 'The finalized conflict plan exceeds the bounded review size.' }, 413)
    }
  }
  const groupUpdates = finalPlans.map((plan) => ({
    group_key: plan.group_key, operation_id: plan.operation_id,
    resolution: resolutions.get(plan.group_key), final_plan: plan,
  }))
  const memberUpdates = finalPlans.flatMap((plan) => plan.member_ids.map((productId) => ({
    product_id: productId, role: productId === plan.keeper_id ? 'keeper' : 'merged',
    operation_id: productId === plan.keeper_id ? null : plan.fold_members.find((member) => member.member_id === productId)?.operation_id ?? null,
  })))
  const groupGuards = storedGroups.map((row) => ({ group_key: row.group_key, status: row.status, state_digest: row.state_digest }))
  const statements: Array<{ sql: string; params?: Record<string, unknown> }> = [{
    sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM product_conflict_action_reviews
      WHERE id=@reviewId AND actor_id=@actorId AND status='draft' AND draft_digest=@draftDigest AND expires_at>@now)
      THEN 1 ELSE json_extract('', '$') END AS product_conflict_finalize_review_guard`,
    params: { reviewId: review.id, actorId: user.id, draftDigest: review.draft_digest, now: new Date().toISOString() },
  }, {
    sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM product_conflict_action_groups WHERE review_id=@reviewId)=json_array_length(@groupsJson)
      AND NOT EXISTS(SELECT 1 FROM json_each(@groupsJson) expected LEFT JOIN product_conflict_action_groups g
        ON g.review_id=@reviewId AND g.group_key=json_extract(expected.value,'$.group_key')
        WHERE g.group_key IS NULL OR g.status<>json_extract(expected.value,'$.status') OR g.state_digest<>json_extract(expected.value,'$.state_digest'))
      THEN 1 ELSE json_extract('', '$') END AS product_conflict_finalize_group_guard`,
    params: { reviewId: review.id, groupsJson: JSON.stringify(groupGuards) },
  }, ...productConflictActionFinalizeStateGuards(actionableCurrentPlans, imageRows)]
  for (const chunk of chunkProductConflictActionRows(groupUpdates, 2 * 1024 * 1024)) statements.push({
    sql: `UPDATE product_conflict_action_groups SET status='ready',
      resolution_json=(SELECT json_extract(value,'$.resolution') FROM json_each(@rowsJson) WHERE json_extract(value,'$.group_key')=group_key),
      final_plan_json=(SELECT json_extract(value,'$.final_plan') FROM json_each(@rowsJson) WHERE json_extract(value,'$.group_key')=group_key),
      operation_id=(SELECT json_extract(value,'$.operation_id') FROM json_each(@rowsJson) WHERE json_extract(value,'$.group_key')=group_key),
      updated_at=CURRENT_TIMESTAMP
      WHERE review_id=@reviewId AND status='actionable'
        AND group_key IN (SELECT json_extract(value,'$.group_key') FROM json_each(@rowsJson))`,
    params: { reviewId: review.id, rowsJson: JSON.stringify(chunk) },
  })
  for (const chunk of chunkProductConflictActionRows(memberUpdates, PRODUCT_CONFLICT_ACTION_MAX_GROUP_DETAIL_BYTES)) statements.push({
    sql: `UPDATE product_conflict_action_group_members SET status='planned',
      role=(SELECT json_extract(value,'$.role') FROM json_each(@rowsJson) WHERE CAST(json_extract(value,'$.product_id') AS INTEGER)=product_id),
      operation_id=(SELECT json_extract(value,'$.operation_id') FROM json_each(@rowsJson) WHERE CAST(json_extract(value,'$.product_id') AS INTEGER)=product_id),
      updated_at=CURRENT_TIMESTAMP
      WHERE review_id=@reviewId AND product_id IN (SELECT CAST(json_extract(value,'$.product_id') AS INTEGER) FROM json_each(@rowsJson))`,
    params: { reviewId: review.id, rowsJson: JSON.stringify(chunk) },
  })
  if (storedRemovals.length) statements.push({
    sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM product_remove_operations WHERE review_id=@reviewId)=json_array_length(@rowsJson)
      AND NOT EXISTS(SELECT 1 FROM json_each(@rowsJson) expected LEFT JOIN product_remove_operations removal
        ON removal.review_id=@reviewId AND removal.action_ordinal=CAST(json_extract(expected.value,'$.action_ordinal') AS INTEGER)
        WHERE removal.operation_id IS NULL OR removal.product_id<>CAST(json_extract(expected.value,'$.product_id') AS INTEGER)
          OR removal.state_digest<>json_extract(expected.value,'$.state_digest') OR removal.plan_digest<>json_extract(expected.value,'$.plan_digest')
          OR removal.status<>json_extract(expected.value,'$.status'))
      THEN 1 ELSE json_extract('', '$') END AS product_remove_finalize_guard`,
    params: { reviewId: review.id, rowsJson: JSON.stringify(storedRemovals.map((row) => ({ action_ordinal: Number(row.action_ordinal),
      product_id: Number(row.product_id), state_digest: row.state_digest, plan_digest: row.plan_digest, status: row.status }))) },
  }, {
    sql: `UPDATE product_remove_operations SET status='ready',updated_at=CURRENT_TIMESTAMP
      WHERE review_id=@reviewId AND status='reviewed'`,
    params: { reviewId: review.id },
  })
  statements.push({
    sql: `UPDATE product_conflict_action_reviews SET status='finalized',finalize_digest=@finalizeDigest,
      manifest_digest=@manifestDigest,finalized_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE id=@reviewId AND actor_id=@actorId AND status='draft' AND draft_digest=@draftDigest`,
    params: { reviewId: review.id, actorId: user.id, draftDigest: review.draft_digest, finalizeDigest, manifestDigest },
  })
  try { await db.batch(statements) }
  catch {
    review = await readProductConflictActionReview(db, user.id, request.review_id)
    storedGroups = await readProductConflictActionStoredGroups(db, request.review_id)
    if (review?.finalize_digest === finalizeDigest && review.manifest_digest) {
      finalPlans = readReplayPlans()
      return c.json(productConflictActionFinalizeResponse(review, storedGroups, finalPlans, review.manifest_digest, storedRemovals))
    }
    if (review?.status === 'finalized') {
      return c.json({ success: false, code: 'finalized_conflict', error: 'This review was finalized with different selections.' }, 409)
    }
    return c.json({ success: false, code: 'review_state_conflict', error: 'The reviewed conflict state changed before finalization.' }, 409)
  }
  review = await readProductConflictActionReview(db, user.id, review.id)
  if (!review?.manifest_digest) throw new Error('The finalized conflict receipt was not stored.')
  return c.json(productConflictActionFinalizeResponse(review, storedGroups, finalPlans, review.manifest_digest, storedRemovals))
})

type ProductConflictActionMemberReceipt = {
  member_ordinal: number
  product_id: number
  role: 'keeper' | 'merged'
  status: 'planned' | 'history_pending' | 'undo_ready' | 'refused' | 'reversed'
  operation_id: string | null
  undo_snapshot_id: number | null
}

function strictProductConflictActionFinalPlan(row: ProductConflictActionStoredGroupRow, expectedReviewId?: string): ProductConflictActionFinalPlan {
  let plan: ProductConflictActionFinalPlan
  try { plan = JSON.parse(String(row.final_plan_json || 'null')) as ProductConflictActionFinalPlan }
  catch { throw new ProductConflictMergeValidationError('The finalized conflict plan is unreadable.', 'review_corrupt', 409) }
  const memberIds = Array.isArray(plan?.member_ids) ? plan.member_ids.map(Number) : []
  const storedIds = parseProductConflictStoredArray(row.member_ids_json, 'member ids').map(Number)
  const clusterPlan = parseProductMergeClusterPlan(plan?.cluster_plan)
  const foldIds = Array.isArray(plan?.fold_members) ? plan.fold_members.map((member) => Number(member.member_id)) : []
  const selectedSourceIds = plan?.selected ? [plan.selected.category?.source_product_id, plan.selected.brand?.source_product_id,
    plan.selected.unit?.source_product_id, ...(plan.selected.barcode?.mode === 'member' ? [plan.selected.barcode.source_product_id] : [])].map(Number) : []
  if (!plan || plan.version !== 1 || plan.authority !== 'reviewed_product_conflict_v2'
    || plan.review_id == null || plan.review_id === '' || (expectedReviewId != null && plan.review_id !== expectedReviewId) || plan.group_key !== row.group_key
    || plan.operation_id !== row.operation_id || !clusterPlan
    || memberIds.length < 2 || memberIds.length !== storedIds.length
    || memberIds.some((id, index) => id !== storedIds[index])
    || !memberIds.includes(Number(plan.keeper_id))
    || !Array.isArray(plan.fold_members) || plan.fold_members.length !== memberIds.length - 1
    || new Set(foldIds).size !== foldIds.length
    || plan.fold_members.some((member) => !memberIds.includes(Number(member.member_id))
      || Number(member.member_id) === Number(plan.keeper_id) || !String(member.operation_id || '').trim())
    || foldIds.some((id) => !memberIds.includes(id))
    || clusterPlan.keeperId !== Number(plan.keeper_id) || clusterPlan.memberIds.length !== memberIds.length
    || clusterPlan.memberIds.some((id, index) => id !== memberIds[index])
    || !plan.selected || !plan.projected_result || !['canonical', 'member', 'clear'].includes(plan.selected.barcode?.mode)
    || typeof plan.selected.barcode?.value !== 'string' || typeof plan.selected.brand?.brand_compact !== 'string'
    || typeof plan.selected.unit?.unit_normalized !== 'string' || selectedSourceIds.some((id) => !memberIds.includes(id))) {
    throw new ProductConflictMergeValidationError('The finalized conflict plan failed its authority check.', 'review_corrupt', 409)
  }
  return { ...plan, cluster_plan: clusterPlan }
}

function reviewedKeeperCatalogBefore(
  detail: ProductConflictActionGroupPlan,
  plan: ProductConflictActionFinalPlan,
  firstFold: boolean,
): NonNullable<MergeReversal['keeperCatalogBefore']> {
  const source = firstFold
    ? productConflictActionPlanMember(detail, plan.keeper_id)
    : {
        category: plan.selected.category.value, categories: plan.selected.category.categories,
        brand: plan.selected.brand.value, brands: plan.selected.brand.brands,
        brand_compact: plan.selected.brand.brand_compact,
        unit: plan.selected.unit.value, unit_normalized: plan.selected.unit.unit_normalized,
      }
  const nullableText = (value: unknown) => value == null ? null : String(value)
  return {
    category: nullableText(source.category), categories: nullableText(source.categories),
    brand: nullableText(source.brand), brands: nullableText(source.brands),
    unit: nullableText(source.unit), unit_normalized: nullableText(source.unit_normalized),
    brand_compact: nullableText(source.brand_compact),
  }
}

function productConflictOriginalMemberMatches(
  detail: ProductConflictActionGroupPlan,
  productId: number,
  row: Record<string, unknown> | undefined,
): boolean {
  const expected = detail.members.find((candidate) => Number(candidate.id) === Number(productId))
  if (!expected || !row) return false
  const textFields = ['name', 'barcode', 'category', 'categories', 'brand', 'brands', 'brand_compact',
    'unit', 'unit_normalized', 'image_path', 'updated_at'] as const
  const moneyFields = [...MERGE_COST_FIELDS, ...MERGE_PRICE_FIELDS]
  const textMatch = textFields.every((field) => String(row[field] ?? '') === String(expected[field] ?? ''))
  const moneyMatch = moneyFields.every((field) => Number(row[field] ?? 0) === Number(expected[field] ?? 0))
  return textMatch && moneyMatch
    && Number(row.is_active) === 1 && Number(row.is_group) === 0
}

function productConflictKeeperPostFoldMatches(plan: ProductConflictActionFinalPlan, row: Record<string, unknown> | undefined): boolean {
  if (!row || Number(row.id) !== Number(plan.keeper_id) || Number(row.is_active) !== 1) return false
  return productMergePlanKeeperMatches(plan.cluster_plan, row)
    && String(row.barcode ?? '') === plan.selected.barcode.value
    && String(row.category ?? '') === String(plan.selected.category.value ?? '')
    && String(row.categories ?? '') === String(plan.selected.category.categories ?? '')
    && String(row.brand ?? '') === String(plan.selected.brand.value ?? '')
    && String(row.brands ?? '') === String(plan.selected.brand.brands ?? '')
    && String(row.brand_compact ?? '') === plan.selected.brand.brand_compact
    && String(row.unit ?? '') === String(plan.selected.unit.value ?? '')
    && String(row.unit_normalized ?? '') === plan.selected.unit.unit_normalized
}

function productConflictActionSourceStateAssertion(
  detail: ProductConflictActionGroupPlan,
  productId: number,
): AtomicMergeStatement {
  const stockRows = detail.stock.rows.filter((row) => Number(row.product_id) === productId)
    .map((row) => ({ branch_id: Number(row.branch_id), quantity: Number(row.quantity) || 0,
      rfid_confirmed_qty: Number(row.rfid_confirmed_qty) || 0 }))
    .sort((left, right) => left.branch_id - right.branch_id)
  const lotRows = detail.lots.rows.filter((row) => Number(row.product_id) === productId).map((row) => ({
    batch_id: Number(row.batch_id), batch_key: row.batch_key == null ? null : String(row.batch_key),
    lot_code: row.lot_code == null ? null : String(row.lot_code), expiry_date: row.expiry_date == null ? null : String(row.expiry_date),
    received_at: row.received_at == null ? null : String(row.received_at), is_active: Number(row.is_active),
    notes: row.notes == null ? null : String(row.notes), unit_cost_usd: row.unit_cost_usd == null ? null : Number(row.unit_cost_usd),
    received_quantity: row.received_quantity == null ? null : Number(row.received_quantity),
    received_branch_id: row.received_branch_id == null ? null : Number(row.received_branch_id),
    received_cost_usd: row.received_cost_usd == null ? null : Number(row.received_cost_usd),
    supplier_id: row.supplier_id == null ? null : Number(row.supplier_id), supplier_name: row.supplier_name == null ? null : String(row.supplier_name),
    payment_status: row.payment_status == null ? null : String(row.payment_status), credit_due_date: row.credit_due_date == null ? null : String(row.credit_due_date),
    branch_id: row.branch_id == null ? null : Number(row.branch_id), quantity: row.quantity == null ? null : Number(row.quantity),
  })).sort((left, right) => left.batch_id - right.batch_id || Number(left.branch_id ?? -1) - Number(right.branch_id ?? -1))
  return {
    sql: `SELECT CASE WHEN
      (SELECT COUNT(*) FROM branch_stock WHERE product_id=@product)=json_array_length(json(@stockJson))
      AND NOT EXISTS (
        SELECT 1 FROM json_each(json(@stockJson)) expected
        WHERE NOT EXISTS (
          SELECT 1 FROM branch_stock stock
          WHERE stock.product_id=@product
            AND stock.branch_id IS json_extract(expected.value,'$.branch_id')
            AND stock.quantity IS json_extract(expected.value,'$.quantity')
            AND stock.rfid_confirmed_qty IS json_extract(expected.value,'$.rfid_confirmed_qty')
        )
      )
      AND (SELECT COUNT(*) FROM product_batches pb LEFT JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id
        WHERE pb.variant_product_id=@product)=json_array_length(json(@lotJson))
      AND NOT EXISTS (
        SELECT 1 FROM json_each(json(@lotJson)) expected
        WHERE NOT EXISTS (
          SELECT 1 FROM product_batches pb LEFT JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id
          WHERE pb.variant_product_id=@product
            AND pb.id IS json_extract(expected.value,'$.batch_id')
            AND pb.batch_key IS json_extract(expected.value,'$.batch_key')
            AND pb.lot_code IS json_extract(expected.value,'$.lot_code')
            AND pb.expiry_date IS json_extract(expected.value,'$.expiry_date')
            AND pb.received_at IS json_extract(expected.value,'$.received_at')
            AND pb.is_active IS json_extract(expected.value,'$.is_active')
            AND pb.notes IS json_extract(expected.value,'$.notes')
            AND pb.unit_cost_usd IS json_extract(expected.value,'$.unit_cost_usd')
            AND pb.received_quantity IS json_extract(expected.value,'$.received_quantity')
            AND pb.received_branch_id IS json_extract(expected.value,'$.received_branch_id')
            AND pb.received_cost_usd IS json_extract(expected.value,'$.received_cost_usd')
            AND pb.supplier_id IS json_extract(expected.value,'$.supplier_id')
            AND pb.supplier_name IS json_extract(expected.value,'$.supplier_name')
            AND pb.payment_status IS json_extract(expected.value,'$.payment_status')
            AND pb.credit_due_date IS json_extract(expected.value,'$.credit_due_date')
            AND bbs.branch_id IS json_extract(expected.value,'$.branch_id')
            AND bbs.quantity IS json_extract(expected.value,'$.quantity')
        )
      )
      THEN 1 ELSE json_extract('', '$') END AS product_conflict_source_state_guard`,
    params: { product: productId, stockJson: JSON.stringify(stockRows), lotJson: JSON.stringify(lotRows) },
  }
}

function productConflictActionStockStateAssertion(
  productId: number,
  rows: Array<{ branch_id: number; quantity: number; rfid_confirmed_qty?: number | null }>,
): AtomicMergeStatement {
  const expected = rows.map((row) => ({ branch_id: Number(row.branch_id), quantity: Number(row.quantity) || 0,
    rfid_confirmed_qty: Number(row.rfid_confirmed_qty) || 0 })).sort((left, right) => left.branch_id - right.branch_id)
  return {
    sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM branch_stock WHERE product_id=@product)=json_array_length(json(@rowsJson))
      AND NOT EXISTS(SELECT 1 FROM json_each(json(@rowsJson)) expected WHERE NOT EXISTS(
        SELECT 1 FROM branch_stock stock WHERE stock.product_id=@product
          AND stock.branch_id IS json_extract(expected.value,'$.branch_id')
          AND stock.quantity IS json_extract(expected.value,'$.quantity')
          AND stock.rfid_confirmed_qty IS json_extract(expected.value,'$.rfid_confirmed_qty')
      )) THEN 1 ELSE json_extract('', '$') END AS product_conflict_stock_state_guard`,
    params: { product: productId, rowsJson: JSON.stringify(expected) },
  }
}

function productConflictActionKeeperLotStateAssertion(
  productId: number,
  snapshot: ProductMergeCaseSnapshot,
): AtomicMergeStatement {
  const batchFields = ['id', 'variant_product_id', 'batch_key', 'lot_code', 'expiry_date', 'received_at', 'is_active', 'notes',
    'synthetic', 'created_at', 'updated_at', 'batch_number', 'supplier_id', 'supplier_name', 'payment_status', 'credit_due_date',
    'unit_cost_usd', 'received_quantity', 'received_branch_id', 'received_cost_usd'] as const
  const stockFields = ['id', 'batch_id', 'branch_id', 'quantity', 'created_at', 'updated_at'] as const
  const batches = snapshot.canonicalBatchRows.map((row) => Object.fromEntries(batchFields.map((field) => [field, row[field] ?? null])))
  const stock = snapshot.canonicalBatchStockRows.map((row) => Object.fromEntries(stockFields.map((field) => [field, row[field] ?? null])))
  const batchMatch = batchFields.map((field) => `pb.${field} IS json_extract(expected.value,'$.${field}')`).join('\n            AND ')
  const stockMatch = stockFields.map((field) => `bbs.${field} IS json_extract(expected.value,'$.${field}')`).join('\n            AND ')
  return {
    sql: `SELECT CASE WHEN
      (SELECT COUNT(*) FROM product_batches WHERE variant_product_id=@product)=json_array_length(json(@batchesJson))
      AND NOT EXISTS(SELECT 1 FROM json_each(json(@batchesJson)) expected WHERE NOT EXISTS(
        SELECT 1 FROM product_batches pb WHERE pb.variant_product_id=@product AND ${batchMatch}
      ))
      AND (SELECT COUNT(*) FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id
        WHERE pb.variant_product_id=@product)=json_array_length(json(@stockJson))
      AND NOT EXISTS(SELECT 1 FROM json_each(json(@stockJson)) expected WHERE NOT EXISTS(
        SELECT 1 FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id
        WHERE pb.variant_product_id=@product AND ${stockMatch}
      )) THEN 1 ELSE json_extract('', '$') END AS product_conflict_keeper_lot_state_guard`,
    params: { product: productId, batchesJson: JSON.stringify(batches), stockJson: JSON.stringify(stock) },
  }
}

function productConflictActionExpectedKeeperStock(
  detail: ProductConflictActionGroupPlan,
  keeperId: number,
  members: ProductConflictActionMemberReceipt[],
): Array<{ branch_id: number; quantity: number; rfid_confirmed_qty: number }> {
  const byBranch = new Map<number, { branch_id: number; quantity: number; rfid_confirmed_qty: number }>()
  for (const row of detail.stock.rows.filter((candidate) => Number(candidate.product_id) === keeperId)) {
    byBranch.set(Number(row.branch_id), { branch_id: Number(row.branch_id), quantity: Number(row.quantity) || 0,
      rfid_confirmed_qty: Number(row.rfid_confirmed_qty) || 0 })
  }
  const committed = new Set(members.filter((candidate) => candidate.role === 'merged'
    && ['history_pending', 'undo_ready'].includes(candidate.status)).map((candidate) => Number(candidate.product_id)))
  for (const row of detail.stock.rows.filter((candidate) => committed.has(Number(candidate.product_id)))) {
    const quantity = Number(row.quantity) || 0
    if (!quantity) continue
    const branchId = Number(row.branch_id)
    const current = byBranch.get(branchId) || { branch_id: branchId, quantity: 0, rfid_confirmed_qty: 0 }
    current.quantity += quantity
    byBranch.set(branchId, current)
  }
  return [...byBranch.values()].sort((left, right) => left.branch_id - right.branch_id)
}

function productConflictActionStockMatches(
  actual: Array<{ branch_id: number; quantity: number; rfid_confirmed_qty?: number | null }>,
  expected: Array<{ branch_id: number; quantity: number; rfid_confirmed_qty?: number | null }>,
): boolean {
  const normalized = (rows: typeof actual) => rows.map((row) => ({ branch_id: Number(row.branch_id),
    quantity: Number(row.quantity) || 0, rfid_confirmed_qty: Number(row.rfid_confirmed_qty) || 0 }))
    .sort((left, right) => left.branch_id - right.branch_id)
  return canonicalProductConflictJson(normalized(actual)) === canonicalProductConflictJson(normalized(expected))
}

function productConflictActionForwardStatements(args: {
  user: SessionUser
  review: ProductConflictActionReviewRow
  group: ProductConflictActionStoredGroupRow
  plan: ProductConflictActionFinalPlan
  member: ProductConflictActionMemberReceipt
  firstFold: boolean
}): (reversal: MergeReversal) => AtomicMergeStatement[] {
  const { user, review, group, plan, member, firstFold } = args
  const byName = actorSnapshot(user)
  const storedReversal = (reversal: MergeReversal) => JSON.stringify({
    ...reversal, operationId: member.operation_id, fingerprintPending: true,
  })
  const groupSnapshotPlaceholder = 'sha256-' + '0'.repeat(64)
  return (reversal) => {
    const statements: AtomicMergeStatement[] = [{
      sql: `INSERT INTO undo_snapshots(kind,status,payload_json,created_by_id,created_by_name)
            VALUES(@kind,'recorded',@payload,@actor,@byName)`,
      params: { kind: PRODUCT_MERGE_GROUP_CHILD_KIND, payload: storedReversal(reversal), actor: user.id, byName },
    }, {
      sql: `UPDATE product_conflict_action_group_members SET status='history_pending',undo_snapshot_id=last_insert_rowid(),updated_at=CURRENT_TIMESTAMP
            WHERE review_id=@review AND group_ordinal=@ordinal AND member_ordinal=@memberOrdinal
              AND product_id=@product AND role='merged' AND status='planned' AND operation_id=@operationId`,
      params: { review: review.id, ordinal: group.ordinal, memberOrdinal: member.member_ordinal, product: member.product_id, operationId: member.operation_id },
    }]
    if (firstFold) {
      statements.push({
        sql: `INSERT INTO undo_snapshots(kind,status,payload_json,created_by_id,created_by_name)
              VALUES(@kind,'recorded',json_object('version',1,'review_id',@review,'group_key',@groupKey,
                'child_snapshot_ids',json_array(last_insert_rowid()),'prefix_fingerprint',@prefix,'generation',0),@actor,@byName)`,
        params: { kind: PRODUCT_MERGE_GROUP_ACTION_KIND, review: review.id, groupKey: group.group_key, prefix: groupSnapshotPlaceholder, actor: user.id, byName },
      }, {
        sql: `INSERT INTO action_history(scope,entity,entity_id,label,undo_label,redo_label,reversible,status,
                undo_payload,redo_payload,created_by_id,created_by_name)
              VALUES('products','product_conflict_group',@entityId,@label,@undoLabel,@redoLabel,0,'recorded',
                json_object('applier',@applier,'snapshot_id',last_insert_rowid(),'review_id',@review,'group_key',@groupKey,'generation',0),
                json_object('applier',@applier,'snapshot_id',last_insert_rowid(),'review_id',@review,'group_key',@groupKey,'generation',0),
                @actor,@byName)`,
        params: {
          entityId: `${review.id}:${group.group_key}`, label: `Merged reviewed product group "${group.group_key}"`,
          undoLabel: `Undo reviewed product group "${group.group_key}"`, redoLabel: `Redo reviewed product group "${group.group_key}"`,
          applier: PRODUCT_MERGE_GROUP_ACTION_KIND, review: review.id, groupKey: group.group_key, actor: user.id, byName,
        },
      }, {
        sql: `UPDATE product_conflict_action_groups SET action_history_id=last_insert_rowid(),status=@status,updated_at=CURRENT_TIMESTAMP
              WHERE review_id=@review AND ordinal=@ordinal AND status='ready' AND action_history_id IS NULL`,
        params: { status: plan.fold_members.length === 1 ? 'completed' : 'partial', review: review.id, ordinal: group.ordinal },
      })
    } else {
      statements.push({
        sql: `UPDATE undo_snapshots SET status='recorded',
              payload_json=json_insert(payload_json,'$.child_snapshot_ids[#]',last_insert_rowid()),updated_at=CURRENT_TIMESTAMP
              WHERE id=(SELECT CAST(json_extract(undo_payload,'$.snapshot_id') AS INTEGER) FROM action_history WHERE id=@history)
                AND kind=@kind AND status='applied'`,
        params: { history: group.action_history_id, kind: PRODUCT_MERGE_GROUP_ACTION_KIND },
      }, {
        sql: `UPDATE action_history SET reversible=0,status='recorded',updated_at=CURRENT_TIMESTAMP
              WHERE id=@history AND status='undoable' AND reversible=1`,
        params: { history: group.action_history_id },
      }, {
        sql: `UPDATE product_conflict_action_groups SET status=@status,updated_at=CURRENT_TIMESTAMP
              WHERE review_id=@review AND ordinal=@ordinal AND status='partial' AND action_history_id=@history`,
        params: {
          status: member.member_ordinal === Math.max(...plan.fold_members.map((fold) => plan.member_ids.indexOf(fold.member_id))) ? 'completed' : 'partial',
          review: review.id, ordinal: group.ordinal, history: group.action_history_id,
        },
      })
    }
    statements.push({
      sql: `UPDATE product_conflict_action_reviews SET status='running',updated_at=CURRENT_TIMESTAMP
            WHERE id=@review AND actor_id=@actor AND manifest_digest=@manifest AND status IN ('finalized','running','interrupted')`,
      params: { review: review.id, actor: user.id, manifest: review.manifest_digest },
    }, {
      sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value)
            VALUES(@actor,@byName,'merge_duplicate','product',@product,@details,'product',@product,@details)`,
      params: {
        actor: user.id, byName, product: String(member.product_id),
        details: JSON.stringify({ review_id: review.id, group_key: group.group_key, keeper_id: plan.keeper_id,
          merged_id: member.product_id, operation_id: member.operation_id, authority: plan.authority }),
      },
    })
    return statements
  }
}

async function reconcileProductConflictActionChild(
  db: ReturnType<typeof getDb>, user: SessionUser, review: ProductConflictActionReviewRow,
  group: ProductConflictActionStoredGroupRow, member: ProductConflictActionMemberReceipt, reversal: MergeReversal,
): Promise<boolean> {
  if (!member.undo_snapshot_id || !group.action_history_id || !member.operation_id) return false
  const child = await db.prepare(`SELECT payload_json FROM undo_snapshots WHERE id=@id AND kind=@kind AND status='recorded' AND created_by_id=@actor`)
    .get<{ payload_json: string }>({ id: member.undo_snapshot_id, kind: PRODUCT_MERGE_GROUP_CHILD_KIND, actor: user.id })
  if (!child) return false
  const stored = JSON.parse(child.payload_json) as MergeReversal & { operationId?: unknown }
  if (stored.operationId !== member.operation_id || Number(stored.keeperId) !== Number(reversal.keeperId)
    || Number(stored.dupId) !== Number(reversal.dupId)) return false
  const fingerprint = await mergeStateFingerprint(db, [reversal])
  const memberRows = await db.prepare(`SELECT undo_snapshot_id FROM product_conflict_action_group_members
    WHERE review_id=@review AND group_ordinal=@ordinal AND undo_snapshot_id IS NOT NULL ORDER BY member_ordinal`)
    .all<{ undo_snapshot_id: number }>({ review: review.id, ordinal: group.ordinal })
  const childIds = memberRows.map((row) => Number(row.undo_snapshot_id))
  if (!childIds.length || childIds[childIds.length - 1] !== Number(member.undo_snapshot_id)) return false
  const prefix = await productMergeGroupPrefixFingerprint(review.id, group.group_key, childIds, Number(group.reversal_generation || 0))
  const groupSnapshot = await db.prepare(`SELECT CAST(json_extract(undo_payload,'$.snapshot_id') AS INTEGER) AS id
    FROM action_history WHERE id=@history AND created_by_id=@actor AND status='recorded' AND reversible=0`)
    .get<{ id: number }>({ history: group.action_history_id, actor: user.id })
  if (!groupSnapshot?.id) return false
  const finalGroup = !await db.prepare(`SELECT 1 AS found FROM product_conflict_action_group_members
    WHERE review_id=@review AND group_ordinal=@ordinal AND role='merged' AND status='planned' LIMIT 1`)
    .get<{ found: number }>({ review: review.id, ordinal: group.ordinal })
  const readyPayload = JSON.stringify({ ...stored, fingerprintPending: false, mergedStateFingerprint: fingerprint })
  const groupPayload = JSON.stringify({ version: 1, review_id: review.id, group_key: group.group_key,
    child_snapshot_ids: childIds, prefix_fingerprint: prefix, generation: Number(group.reversal_generation || 0) })
  try {
    await db.batch([{
      sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM product_conflict_action_group_members
        WHERE review_id=@review AND group_ordinal=@ordinal AND member_ordinal=@memberOrdinal
          AND status='history_pending' AND undo_snapshot_id=@child AND operation_id=@operationId)
        AND EXISTS(SELECT 1 FROM undo_snapshots WHERE id=@child AND kind=@childKind AND status='recorded' AND payload_json=@oldPayload)
        AND EXISTS(SELECT 1 FROM undo_snapshots WHERE id=@groupSnapshot AND kind=@groupKind AND status='recorded')
        AND EXISTS(SELECT 1 FROM action_history WHERE id=@history AND status='recorded' AND reversible=0)
        THEN 1 ELSE json_extract('', '$') END AS product_conflict_history_guard`,
      params: { review: review.id, ordinal: group.ordinal, memberOrdinal: member.member_ordinal, child: member.undo_snapshot_id,
        operationId: member.operation_id, childKind: PRODUCT_MERGE_GROUP_CHILD_KIND, oldPayload: child.payload_json,
        groupSnapshot: groupSnapshot.id, groupKind: PRODUCT_MERGE_GROUP_ACTION_KIND, history: group.action_history_id },
    }, {
      sql: `UPDATE undo_snapshots SET status='applied',payload_json=@payload,updated_at=CURRENT_TIMESTAMP WHERE id=@id AND status='recorded'`,
      params: { payload: readyPayload, id: member.undo_snapshot_id },
    }, {
      sql: `UPDATE product_conflict_action_group_members SET status='undo_ready',updated_at=CURRENT_TIMESTAMP
            WHERE review_id=@review AND group_ordinal=@ordinal AND member_ordinal=@memberOrdinal AND status='history_pending'`,
      params: { review: review.id, ordinal: group.ordinal, memberOrdinal: member.member_ordinal },
    }, {
      sql: `UPDATE undo_snapshots SET status='applied',payload_json=@payload,updated_at=CURRENT_TIMESTAMP
            WHERE id=@id AND kind=@kind AND status='recorded'`,
      params: { payload: groupPayload, id: groupSnapshot.id, kind: PRODUCT_MERGE_GROUP_ACTION_KIND },
    }, {
      sql: `UPDATE action_history SET reversible=1,status='undoable',updated_at=CURRENT_TIMESTAMP
            WHERE id=@history AND status='recorded' AND reversible=0`,
      params: { history: group.action_history_id },
    }, {
      sql: `UPDATE product_conflict_action_groups SET status=@status,updated_at=CURRENT_TIMESTAMP
            WHERE review_id=@review AND ordinal=@ordinal AND action_history_id=@history`,
      params: { status: finalGroup ? 'completed' : 'partial', review: review.id, ordinal: group.ordinal, history: group.action_history_id },
    }, {
      sql: `UPDATE product_conflict_action_reviews SET status=CASE WHEN NOT EXISTS(
              SELECT 1 FROM product_conflict_action_groups WHERE review_id=@review AND status IN ('ready','running','partial','actionable'))
              AND NOT EXISTS(SELECT 1 FROM product_conflict_action_group_members WHERE review_id=@review AND status='history_pending')
              THEN 'completed' ELSE 'running' END,updated_at=CURRENT_TIMESTAMP
            WHERE id=@review AND actor_id=@actor`,
      params: { review: review.id, actor: user.id },
    }])
    return true
  } catch { return false }
}

async function productConflictActionApplyCounts(db: ReturnType<typeof getDb>, reviewId: string) {
  const groups = await db.prepare(`SELECT COUNT(*) AS canonical_groups,
    SUM(status IN ('ready','actionable','running')) AS pending_groups,SUM(status='partial') AS partial_groups,
    SUM(status='completed') AS completed_groups,SUM(status='refused') AS refused_groups,
    SUM(status='blocked') AS blocked_groups,SUM(status='reversed') AS reversed_groups,
    SUM(EXISTS(SELECT 1 FROM product_conflict_action_group_members m WHERE m.review_id=g.review_id AND m.group_ordinal=g.ordinal AND m.status='history_pending')) AS history_pending_groups,
    SUM(EXISTS(SELECT 1 FROM product_conflict_action_group_members m WHERE m.review_id=g.review_id AND m.group_ordinal=g.ordinal AND m.status='undo_ready')) AS undo_ready_groups
    FROM product_conflict_action_groups g WHERE review_id=@review`).get<Record<string, number>>({ review: reviewId })
  const folds = await db.prepare(`SELECT COUNT(*) AS merge_folds,
    SUM(status='planned') AS pending_folds,SUM(status IN ('history_pending','undo_ready')) AS committed_folds,
    SUM(status='refused') AS refused_folds,SUM(status='reversed') AS reversed_folds
    FROM product_conflict_action_group_members WHERE review_id=@review AND role='merged'`).get<Record<string, number>>({ review: reviewId })
  const removals = await db.prepare(`SELECT COUNT(*) AS removal_actions,
    SUM(status IN ('reviewed','ready')) AS pending_removals,SUM(status='approval_pending') AS approval_pending_removals,
    SUM(status='undo_ready') AS completed_removals,SUM(status='refused') AS refused_removals,
    SUM(status='blocked') AS blocked_removals,SUM(status='reversed') AS reversed_removals
    FROM product_remove_operations WHERE review_id=@review`).get<Record<string, number>>({ review: reviewId })
  const number = (value: unknown) => Number(value) || 0
  return {
    canonical_groups: number(groups?.canonical_groups), pending_groups: number(groups?.pending_groups),
    partial_groups: number(groups?.partial_groups), completed_groups: number(groups?.completed_groups),
    refused_groups: number(groups?.refused_groups), blocked_groups: number(groups?.blocked_groups),
    reversed_groups: number(groups?.reversed_groups), history_pending_groups: number(groups?.history_pending_groups),
    undo_ready_groups: number(groups?.undo_ready_groups), merge_folds: number(folds?.merge_folds),
    pending_folds: number(folds?.pending_folds), committed_folds: number(folds?.committed_folds),
    refused_folds: number(folds?.refused_folds), reversed_folds: number(folds?.reversed_folds),
    removal_actions: number(removals?.removal_actions), pending_removals: number(removals?.pending_removals),
    approval_pending_removals: number(removals?.approval_pending_removals), completed_removals: number(removals?.completed_removals),
    refused_removals: number(removals?.refused_removals), blocked_removals: number(removals?.blocked_removals),
    reversed_removals: number(removals?.reversed_removals),
  }
}

const PRODUCT_CONFLICT_ACTION_APPLY_MAX_DELTA_GROUPS = 12
const PRODUCT_CONFLICT_ACTION_APPLY_MAX_FOLDS = 8
const PRODUCT_CONFLICT_ACTION_APPLY_NEXT_FOLD_RESERVE = 380

class ProductConflictActionApplyStop extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 403 | 409 | 500,
  ) { super(message) }
}

type ProductConflictActionApplyDelta = {
  group_key: string
  status: string
  processed_folds: number
  keeper_id?: number
  merged_ids: number[]
  operation_ids: string[]
}

async function applyProductConflictActionReview(c: any, raw: unknown, user: SessionUser) {
  let request
  try { request = parseProductConflictActionApplyRequest(raw) }
  catch (error) {
    const validation = error instanceof ProductConflictMergeValidationError ? error : new ProductConflictMergeValidationError('The reviewed apply request is invalid.')
    return c.json({ success: false, code: validation.code, error: validation.message }, validation.status as 400 | 409)
  }
  const counted = createCountedProductMergeDb(getDb(c.env))
  const db = counted.db
  const mergeTier = getActionTier(user, 'products', 'merge_duplicates')
  const removeTier = getActionTier(user, 'products', 'delete')
  let review = await readProductConflictActionReview(db, user.id, request.review_id)
  if (!review) return c.json({ success: false, code: 'review_not_found', error: 'Conflict review not found.' }, 404)
  if (Number(review.requested_group_count) > 0 && mergeTier !== 'full') {
    return c.json({ success: false, code: 'permission_denied', error: 'Full duplicate merge permission is required.' }, 403)
  }
  if (Number(review.requested_removal_count) > 0 && removeTier === 'none') {
    return c.json({ success: false, code: 'permission_denied', error: 'Product removal permission is required.' }, 403)
  }
  if (!['finalized', 'running', 'interrupted', 'approval_pending', 'completed'].includes(review.status)
    || review.manifest_digest !== request.manifest_digest) {
    return c.json({ success: false, code: 'manifest_conflict', error: 'This reviewed manifest is stale or does not match.' }, 409)
  }
  if (review.status === 'completed') {
    const counts = await productConflictActionApplyCounts(db, review.id)
    const reversed = counts.reversed_groups > 0 || counts.reversed_folds > 0 || counts.reversed_removals > 0
    if (reversed || counts.pending_groups > 0 || counts.partial_groups > 0
      || counts.history_pending_groups > 0 || counts.pending_folds > 0 || counts.pending_removals > 0
      || counts.approval_pending_removals > 0) {
      return c.json({ success: false, code: reversed ? 'review_reversed' : 'review_state_conflict',
        error: reversed
          ? 'A reviewed group was reversed. Redo it or start a new review before continuing.'
          : 'The completed review no longer has a completed authoritative partition.' }, 409)
    }
    return c.json({ success: true, manifest_version: 1, resolution_version: 2, review_id: review.id,
      manifest_digest: review.manifest_digest, status: review.status, continuation_required: false,
      counts: { requested_actions: Number(review.requested_action_count), requested_groups: Number(review.requested_group_count),
        requested_removals: Number(review.requested_removal_count), total_members: Number(review.total_member_count), ...counts },
      groups: [], removals: [], approval_required: false })
  }
  const requestStartedAt = Date.now()
  const deltaGroups: ProductConflictActionApplyDelta[] = []
  const deltaRemovals: Array<Record<string, unknown>> = []
  let processedFolds = 0
  let interruption: ProductConflictActionApplyStop | null = null
  const branchRows = await db.prepare('SELECT id,name FROM branches').all<{ id: number; name: string }>()
  const branchNameById = new Map(branchRows.map((row) => [Number(row.id), row.name]))
  while (deltaGroups.length < PRODUCT_CONFLICT_ACTION_APPLY_MAX_DELTA_GROUPS
    && processedFolds < PRODUCT_CONFLICT_ACTION_APPLY_MAX_FOLDS) {
    if ((processedFolds > 0 && Date.now() - requestStartedAt + 1_500 >= MERGE_DUPLICATES_REQUEST_BUDGET_MS)
      || counted.statementCount() + PRODUCT_CONFLICT_ACTION_APPLY_NEXT_FOLD_RESERVE > MERGE_DUPLICATES_REQUEST_STATEMENT_BUDGET) {
      interruption = new ProductConflictActionApplyStop('merge_budget_reached',
        'Committed reviewed folds were saved. Continue the same review to process the remaining folds.', 409)
      break
    }
    try {
      let group = await db.prepare(`SELECT ordinal,group_key,source_group_keys_json,member_ids_json,status,state_digest,detail_json,
    resolution_json,final_plan_json,operation_id,action_history_id,reversal_generation
    FROM product_conflict_action_groups g WHERE review_id=@review AND (status IN ('ready','partial') OR EXISTS(
      SELECT 1 FROM product_conflict_action_group_members m WHERE m.review_id=g.review_id AND m.group_ordinal=g.ordinal AND m.status='history_pending'))
    ORDER BY ordinal LIMIT 1`)
    .get<ProductConflictActionStoredGroupRow>({ review: review.id })
      if (!group) break
  let plan: ProductConflictActionFinalPlan
  let detail: ProductConflictActionGroupPlan
  try {
    plan = strictProductConflictActionFinalPlan(group, review.id)
    detail = JSON.parse(group.detail_json) as ProductConflictActionGroupPlan
  } catch (error) {
    const validation = error instanceof ProductConflictMergeValidationError ? error : new ProductConflictMergeValidationError('The stored conflict review is unreadable.', 'review_corrupt', 409)
    throw new ProductConflictActionApplyStop(validation.code, validation.message, 409)
  }
  const members = await db.prepare(`SELECT member_ordinal,product_id,role,status,operation_id,undo_snapshot_id
    FROM product_conflict_action_group_members WHERE review_id=@review AND group_ordinal=@ordinal ORDER BY member_ordinal`)
    .all<ProductConflictActionMemberReceipt>({ review: review.id, ordinal: group.ordinal })
  if (members.some((member) => member.status === 'reversed')) {
    throw new ProductConflictActionApplyStop('review_reversed',
      'This reviewed group has a reversed prefix. Redo it or start a new review before continuing.', 409)
  }
  const pendingHistory = members.find((member) => member.status === 'history_pending')
  if (pendingHistory?.undo_snapshot_id) {
    const child = await db.prepare(`SELECT payload_json FROM undo_snapshots WHERE id=@id AND kind=@kind`)
      .get<{ payload_json: string }>({ id: pendingHistory.undo_snapshot_id, kind: PRODUCT_MERGE_GROUP_CHILD_KIND })
    let stored: MergeReversal | null = null
    try { stored = child ? JSON.parse(child.payload_json) as MergeReversal : null } catch { stored = null }
    const reconciled = stored ? await reconcileProductConflictActionChild(db, user, review, group, pendingHistory, stored).catch(() => false) : false
    deltaGroups.push({ group_key: group.group_key, status: reconciled ? 'history_reconciled' : 'history_pending',
      processed_folds: 0, merged_ids: [], operation_ids: [] })
    if (!reconciled) {
      interruption = new ProductConflictActionApplyStop('merge_history_pending',
        'A committed reviewed fold still needs its history receipt finalized.', 409)
      break
    }
    continue
  }
  const member = members.find((candidate) => candidate.role === 'merged' && candidate.status === 'planned')
  if (!member?.operation_id) throw new ProductConflictActionApplyStop('review_state_conflict', 'The reviewed group member receipt is invalid.', 409)
  if (plan.image_effect && getActionTier(user, 'products', 'image') !== 'full') {
    throw new ProductConflictActionApplyStop('image_permission_required', 'This reviewed group changes product images.', 403)
  }
  const currentProducts = await db.prepare(`SELECT * FROM products WHERE id IN (@keeper,@member)`)
    .all<Record<string, unknown> & { id: number; name: string | null; image_path: string | null }>({ keeper: plan.keeper_id, member: member.product_id })
  const keeper = currentProducts.find((row) => Number(row.id) === Number(plan.keeper_id))
  const duplicate = currentProducts.find((row) => Number(row.id) === Number(member.product_id))
  if (!keeper || !duplicate) throw new ProductConflictActionApplyStop('merge_state_conflict', 'A reviewed product is unavailable.', 409)
  if (getActionTier(user, 'products', 'image') !== 'full'
    && await productMergeChangesImages(db, [{ keeper, discarded: duplicate }])) {
    throw new ProductConflictActionApplyStop('image_permission_required', 'This reviewed group now changes product images.', 403)
  }
  const firstFold = !group.action_history_id
  const preparedSnapshot = await readProductMergeCaseSnapshot(db, plan.keeper_id, member.product_id, MERGE_REPARENT_TABLES)
  if (!firstFold) {
    const prior = [...members].reverse().find((candidate) => candidate.role === 'merged'
      && candidate.status === 'undo_ready' && candidate.undo_snapshot_id)
    const priorSnapshot = prior?.undo_snapshot_id
      ? await db.prepare(`SELECT payload_json FROM undo_snapshots WHERE id=@snapshot AND kind=@kind AND status='applied'`)
        .get<{ payload_json: string }>({ snapshot: prior.undo_snapshot_id, kind: PRODUCT_MERGE_GROUP_CHILD_KIND })
      : null
    let priorReversal: (MergeReversal & { fingerprintPending?: unknown; mergedStateFingerprint?: unknown }) | null = null
    try { priorReversal = priorSnapshot ? JSON.parse(priorSnapshot.payload_json) : null } catch { priorReversal = null }
    if (!priorReversal || priorReversal.fingerprintPending !== false || typeof priorReversal.mergedStateFingerprint !== 'string'
      || await mergeStateFingerprint(db, [priorReversal]) !== priorReversal.mergedStateFingerprint) {
      throw new ProductConflictActionApplyStop('merge_state_conflict',
        'The reviewed keeper graph changed after the prior committed fold.', 409)
    }
  }
  const expectedKeeperStock = productConflictActionExpectedKeeperStock(detail, plan.keeper_id, members)
  if (!productConflictOriginalMemberMatches(detail, member.product_id, duplicate)
    || (firstFold
      ? !productConflictOriginalMemberMatches(detail, plan.keeper_id, keeper)
      : !productConflictKeeperPostFoldMatches(plan, keeper))
    || !productConflictActionStockMatches(preparedSnapshot.canonicalStockBefore, expectedKeeperStock)) {
    throw new ProductConflictActionApplyStop('merge_state_conflict', 'A reviewed product changed after finalization.', 409)
  }
  const preStatements: AtomicMergeStatement[] = [{
    sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM product_conflict_action_reviews
      WHERE id=@review AND actor_id=@actor AND manifest_digest=@manifest AND status IN ('finalized','running','interrupted'))
      AND EXISTS(SELECT 1 FROM product_conflict_action_groups
        WHERE review_id=@review AND ordinal=@ordinal AND group_key=@groupKey AND final_plan_json=@plan
          AND operation_id=@groupOperation AND status=@groupStatus AND reversal_generation=@generation
          AND ((@first=1 AND action_history_id IS NULL) OR (@first=0 AND action_history_id=@history)) )
      AND EXISTS(SELECT 1 FROM product_conflict_action_group_members
        WHERE review_id=@review AND group_ordinal=@ordinal AND member_ordinal=@memberOrdinal
          AND product_id=@member AND role='merged' AND status='planned' AND operation_id=@memberOperation)
      AND (@first=1 OR (
        EXISTS(SELECT 1 FROM action_history WHERE id=@history AND status='undoable' AND reversible=1)
        AND EXISTS(SELECT 1 FROM undo_snapshots WHERE id=(SELECT CAST(json_extract(undo_payload,'$.snapshot_id') AS INTEGER)
          FROM action_history WHERE id=@history) AND kind=@groupSnapshotKind AND status='applied')
        AND NOT EXISTS(SELECT 1 FROM product_conflict_action_group_members
          WHERE review_id=@review AND group_ordinal=@ordinal AND undo_snapshot_id IS NOT NULL AND status<>'undo_ready')
      ))
      AND NOT EXISTS(SELECT 1 FROM stock_session_members sm JOIN stock_session_operations so ON so.id=sm.operation_id
        JOIN action_history sh ON sh.id=so.history_id
        WHERE sm.product_id IN (@keeper,@member) AND sh.status IN ('undoable','redoable'))
      THEN 1 ELSE json_extract('', '$') END AS product_conflict_apply_guard`,
    params: { review: review.id, actor: user.id, manifest: review.manifest_digest, ordinal: group.ordinal,
      groupKey: group.group_key, plan: group.final_plan_json, groupOperation: group.operation_id,
      groupStatus: firstFold ? 'ready' : 'partial', generation: Number(group.reversal_generation || 0),
      first: firstFold ? 1 : 0, history: group.action_history_id, groupSnapshotKind: PRODUCT_MERGE_GROUP_ACTION_KIND, memberOrdinal: member.member_ordinal,
      member: member.product_id, memberOperation: member.operation_id, keeper: plan.keeper_id },
  }, productConflictActionSourceStateAssertion(detail, member.product_id),
  productConflictActionStockStateAssertion(plan.keeper_id, preparedSnapshot.canonicalStockBefore),
  productConflictActionStockStateAssertion(member.product_id, preparedSnapshot.duplicateStockRows),
  productConflictActionKeeperLotStateAssertion(plan.keeper_id, preparedSnapshot)]
  if (firstFold) preStatements.push(productConflictActionSourceStateAssertion(detail, plan.keeper_id))
  let foldResult: Awaited<ReturnType<typeof foldDuplicateProductInto>>
  try {
    foldResult = await foldDuplicateProductInto(c.env, db, user, keeper, duplicate, branchNameById,
      'reviewed product conflict group', 'merge', resolveProductMergeClusterPlanEconomics(plan.cluster_plan), {
        operationId: member.operation_id, bulkClusterPlan: plan.cluster_plan, resumedCluster: !firstFold,
        reviewedPlan: plan, reviewedCatalogBefore: reviewedKeeperCatalogBefore(detail, plan, firstFold),
        preparedSnapshot,
        preStatements, groupCompletionStatements: productConflictActionForwardStatements({ user, review, group, plan, member, firstFold }),
        snapshotContext: { review_id: review.id, group_key: group.group_key, authority: plan.authority },
      })
  } catch (error) {
    const conflict = /merge_state_conflict|merge_identity_conflict|merge_cluster_plan_conflict/.test(String(error))
    const infrastructure = isProductMergeInfrastructureError(error)
    throw new ProductConflictActionApplyStop(conflict ? 'merge_state_conflict' : infrastructure ? 'merge_infrastructure_interrupted' : 'merge_failed',
      conflict ? 'A reviewed product or receipt changed before this fold committed.' : 'The reviewed fold could not be completed.', conflict ? 409 : 500)
  }
  group = await db.prepare(`SELECT ordinal,group_key,source_group_keys_json,member_ids_json,status,state_digest,detail_json,
    resolution_json,final_plan_json,operation_id,action_history_id,reversal_generation
    FROM product_conflict_action_groups WHERE review_id=@review AND ordinal=@ordinal`)
    .get<ProductConflictActionStoredGroupRow>({ review: review.id, ordinal: group.ordinal }) || group
  const refreshedMember = await db.prepare(`SELECT member_ordinal,product_id,role,status,operation_id,undo_snapshot_id
    FROM product_conflict_action_group_members WHERE review_id=@review AND group_ordinal=@ordinal AND member_ordinal=@memberOrdinal`)
    .get<ProductConflictActionMemberReceipt>({ review: review.id, ordinal: group.ordinal, memberOrdinal: member.member_ordinal }) || member
  const reconciled = await reconcileProductConflictActionChild(db, user, review, group, refreshedMember, foldResult.reversal).catch(() => false)
      const existingDelta = deltaGroups.find((candidate) => candidate.group_key === group.group_key)
      if (existingDelta) {
        existingDelta.status = reconciled ? group.status : 'history_pending'
        existingDelta.processed_folds += 1
        existingDelta.keeper_id = plan.keeper_id
        existingDelta.merged_ids.push(member.product_id)
        existingDelta.operation_ids.push(member.operation_id)
      } else {
        deltaGroups.push({ group_key: group.group_key, status: reconciled ? group.status : 'history_pending',
          processed_folds: 1, keeper_id: plan.keeper_id, merged_ids: [member.product_id], operation_ids: [member.operation_id] })
      }
      processedFolds += 1
      if (!reconciled) {
        interruption = new ProductConflictActionApplyStop('merge_history_pending',
          'A committed reviewed fold still needs its history receipt finalized.', 409)
        break
      }
    } catch (error) {
      const stop = error instanceof ProductConflictActionApplyStop
        ? error
        : new ProductConflictActionApplyStop('merge_infrastructure_interrupted', 'The reviewed merge was interrupted.', 500)
      if (processedFolds === 0 && deltaGroups.length === 0) {
        return c.json({ success: false, code: stop.code, error: stop.message }, stop.status)
      }
      interruption = stop
      break
    }
  }
  while (!interruption && deltaGroups.length + deltaRemovals.length < PRODUCT_CONFLICT_ACTION_APPLY_MAX_DELTA_GROUPS) {
    if ((deltaGroups.length + deltaRemovals.length > 0
        && Date.now() - requestStartedAt + 1_000 >= MERGE_DUPLICATES_REQUEST_BUDGET_MS)
      || counted.statementCount() + 100 > MERGE_DUPLICATES_REQUEST_STATEMENT_BUDGET) {
      interruption = new ProductConflictActionApplyStop('remove_budget_reached',
        'Committed reviewed actions were saved. Continue the same review to process the remaining removals.', 409)
      break
    }
    const operation = await db.prepare(`SELECT operation_id,actor_id,requester_id,source,request_id,review_id,action_ordinal,
      product_id,reason,state_digest,plan_digest,plan_json,status,blocker_code,error_message,pending_action_id,undo_snapshot_id,
      action_history_id,generation,response_json FROM product_remove_operations
      WHERE review_id=@review AND status='ready' ORDER BY action_ordinal LIMIT 1`)
      .get<ProductConflictActionStoredRemovalRow>({ review: review.id })
    if (!operation) break
    let plan
    try {
      plan = parseProductRemovePlan(JSON.parse(operation.plan_json))
      if (plan.product_id !== Number(operation.product_id) || plan.reason !== operation.reason
        || plan.state_digest !== operation.state_digest || await productRemovePlanDigest(plan) !== operation.plan_digest) {
        throw new Error('receipt mismatch')
      }
    } catch {
      interruption = new ProductConflictActionApplyStop('review_corrupt', 'The saved product removal plan is unreadable.', 409)
      break
    }
    try {
      if (removeTier === 'review') {
        await db.batch(productRemoveReviewQueueStatements({ operation, plan, user }))
        const pending = await db.prepare('SELECT pending_action_id FROM product_remove_operations WHERE operation_id=@operation')
          .get<{ pending_action_id: number | null }>({ operation: operation.operation_id })
        deltaRemovals.push({ action_ordinal: Number(operation.action_ordinal), product_id: Number(operation.product_id),
          status: 'approval_pending', pending_action_id: pending?.pending_action_id ?? null, undo_availability: 'unavailable', generation: 0 })
      } else {
        const transitionStamp = new Date().toISOString()
        await db.batch(productRemoveApplyStatements({ plan, operationId: operation.operation_id, source: 'conflict_review',
          requestId: operation.request_id, reviewId: review.id, actionOrdinal: Number(operation.action_ordinal), user,
          transitionStamp, planDigest: operation.plan_digest, receiptActorId: operation.actor_id, requesterId: operation.requester_id }))
        const applied = await db.prepare(`SELECT action_history_id,generation FROM product_remove_operations
          WHERE operation_id=@operation AND status='undo_ready'`).get<{ action_history_id: number | null; generation: number }>({ operation: operation.operation_id })
        if (!applied?.action_history_id) throw new Error('product_remove_history_missing')
        deltaRemovals.push({ action_ordinal: Number(operation.action_ordinal), product_id: Number(operation.product_id),
          status: 'undo_ready', action_history_id: applied.action_history_id, undo_availability: 'ready', generation: Number(applied.generation) })
      }
    } catch (error) {
      interruption = new ProductConflictActionApplyStop(/malformed JSON|product_remove_.*guard|constraint/i.test(String(error))
        ? 'review_state_conflict' : 'remove_failed', 'The reviewed product removal could not be applied.',
      /malformed JSON|product_remove_.*guard|constraint/i.test(String(error)) ? 409 : 500)
      break
    }
  }
  review = await readProductConflictActionReview(db, user.id, review.id) || review
  const counts = await productConflictActionApplyCounts(db, review.id)
  const reversed = counts.reversed_groups > 0 || counts.reversed_folds > 0 || counts.reversed_removals > 0
  if (deltaGroups.length === 0 && deltaRemovals.length === 0 && reversed) {
    return c.json({ success: false, code: 'review_reversed',
      error: 'A reviewed group was reversed. Redo it or start a new review before continuing.' }, 409)
  }
  const complete = !reversed && counts.pending_groups === 0 && counts.partial_groups === 0
    && counts.history_pending_groups === 0 && counts.pending_folds === 0
    && counts.pending_removals === 0 && counts.approval_pending_removals === 0
  const continuationRequired = !reversed && (counts.pending_groups > 0 || counts.partial_groups > 0
    || counts.history_pending_groups > 0 || counts.pending_folds > 0 || counts.pending_removals > 0)
  const approvalRequired = counts.approval_pending_removals > 0
  if (complete) interruption = null
  if (!complete && !interruption && (deltaGroups.length >= PRODUCT_CONFLICT_ACTION_APPLY_MAX_DELTA_GROUPS
    || processedFolds >= PRODUCT_CONFLICT_ACTION_APPLY_MAX_FOLDS)) {
    interruption = new ProductConflictActionApplyStop('merge_budget_reached',
      'Committed reviewed folds were saved. Continue the same review to process the remaining folds.', 409)
  }
  if (deltaGroups.length === 0 && deltaRemovals.length === 0 && !complete && !approvalRequired) {
    if (interruption) {
      return c.json({ success: false, code: interruption.code, error: interruption.message }, interruption.status)
    }
    return c.json({ success: false, code: 'review_state_conflict', error: 'No resumable reviewed group is available.' }, 409)
  }
  if (complete && review.status !== 'completed') {
    await db.prepare(`UPDATE product_conflict_action_reviews SET status='completed',updated_at=CURRENT_TIMESTAMP
      WHERE id=@review AND actor_id=@actor AND manifest_digest=@manifest AND status IN ('finalized','running','interrupted')`)
      .run({ review: review.id, actor: user.id, manifest: review.manifest_digest })
    review = await readProductConflictActionReview(db, user.id, review.id) || { ...review, status: 'completed' }
  }
  if (processedFolds > 0 || deltaRemovals.some((row) => row.status === 'undo_ready')) {
    c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
    c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
    c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'update' }))
  }
  return c.json({ success: true, manifest_version: 1, resolution_version: 2, review_id: review.id,
    manifest_digest: review.manifest_digest, status: review.status, continuation_required: continuationRequired,
    approval_required: approvalRequired,
    counts: { requested_actions: Number(review.requested_action_count), requested_groups: Number(review.requested_group_count),
      requested_removals: Number(review.requested_removal_count), total_members: Number(review.total_member_count), ...counts },
    groups: deltaGroups, removals: deltaRemovals,
    ...(interruption ? { interruption_code: interruption.code, interruption_message: interruption.message } : {}) })
}

registerProductMergeGroupRedo(async (ctx) => {
  const group = await ctx.db.prepare(`SELECT ordinal,group_key,source_group_keys_json,member_ids_json,status,state_digest,detail_json,
    resolution_json,final_plan_json,operation_id,action_history_id,reversal_generation
    FROM product_conflict_action_groups WHERE review_id=@review AND ordinal=@ordinal AND group_key=@groupKey`)
    .get<ProductConflictActionStoredGroupRow>({ review: ctx.reviewId, ordinal: ctx.groupOrdinal, groupKey: ctx.groupKey })
  if (!group) throw new Error('merge_group_plan_unavailable')
  const plan = strictProductConflictActionFinalPlan(group, ctx.reviewId)
  const fold = plan.fold_members.find((candidate) => Number(candidate.member_id) === Number(ctx.reversal.dupId))
  if (!fold || fold.operation_id !== ctx.operationId || Number(ctx.reversal.keeperId) !== Number(plan.keeper_id)) {
    throw new Error('merge_group_plan_conflict')
  }
  const products = await ctx.db.prepare(`SELECT id,name,image_path FROM products WHERE id IN (@keeper,@member)`)
    .all<{ id: number; name: string | null; image_path: string | null }>({ keeper: plan.keeper_id, member: fold.member_id })
  const keeper = products.find((row) => Number(row.id) === Number(plan.keeper_id))
  const duplicate = products.find((row) => Number(row.id) === Number(fold.member_id))
  if (!keeper || !duplicate) throw new Error('merge_group_product_unavailable')
  const branches = await ctx.db.prepare('SELECT id,name FROM branches').all<{ id: number; name: string }>()
  await foldDuplicateProductInto(ctx.env, ctx.db, ctx.user, keeper, duplicate,
    new Map(branches.map((row) => [Number(row.id), row.name])), 'reviewed product conflict group redo',
    ctx.reversal.stockDisposition || 'merge', resolveProductMergeClusterPlanEconomics(plan.cluster_plan), {
      operationId: ctx.operationId, bulkClusterPlan: plan.cluster_plan, resumedCluster: ctx.childOrdinal > 0,
      reviewedPlan: plan, reviewedRedo: true, reviewedCatalogBefore: ctx.reversal.keeperCatalogBefore,
      groupCompletionStatements: ctx.completionStatements,
      snapshotContext: { review_id: ctx.reviewId, group_key: ctx.groupKey, authority: plan.authority },
    })
})

app.get('/possible-duplicates/merge-batch/reviews/:reviewId', async (c) => {
  const user = c.get('user')
  const mergeTier = getActionTier(user, 'products', 'merge_duplicates')
  const removeTier = getActionTier(user, 'products', 'delete')
  const cursor = productConflictActionCursor(c.req.query('cursor'))
  const limit = productConflictActionPageLimit(c.req.query('limit'))
  if (cursor == null || limit == null) return c.json({ success: false, code: 'invalid_page', error: 'cursor and limit are invalid.' }, 400)
  const db = getDb(c.env)
  const review = await readProductConflictActionReview(db, user.id, c.req.param('reviewId'))
  if (!review) return c.json({ success: false, code: 'review_not_found', error: 'Conflict review not found.' }, 404)
  if ((Number(review.requested_group_count) > 0 && mergeTier !== 'full')
    || (Number(review.requested_removal_count) > 0 && removeTier === 'none')) {
    return c.json({ success: false, code: 'permission_denied', error: 'You do not have permission to read this review.' }, 403)
  }
  if (productConflictActionReviewExpired(review)) {
    await expireProductConflictActionReview(db, review)
    return c.json({ success: false, code: 'review_expired', error: 'This conflict review expired. Start a new review.' }, 410)
  }
  return c.json(await productConflictActionReviewResponse(db, review, cursor, limit))
})

// Executes one reviewed manifest as independent, atomic pair transactions.
// The durable run/case rows make lost responses and manual continuation
// reconcilable without inferring success from today's product state.
app.post('/possible-duplicates/merge-batch', async (c) => {
  const startedAt = Date.now()
  const user = c.get('user')
  const raw = await c.req.json().catch(() => null)
  if (isProductConflictActionApplyRequest(raw)) {
    return applyProductConflictActionReview(c, raw, user)
  }
  if (isProductConflictActionPreviewRequest(raw)) {
    return c.json({ success: false, code: 'phase_not_available', error: 'Resolution-v2 apply is not available in this review phase.' }, 409)
  }
  if (getActionTier(user, 'products', 'merge_duplicates') !== 'full') {
    return c.json({ success: false, code: 'permission_denied', error: 'You do not have permission to perform this action' }, 403)
  }
  let request
  try { request = parseProductConflictApplyRequest(raw) }
  catch (error) {
    const validation = error instanceof ProductConflictMergeValidationError ? error : new ProductConflictMergeValidationError('The selected merge request is invalid.')
    return c.json({ success: false, code: validation.code, error: validation.message }, 400)
  }

  const counted = createCountedProductMergeDb(getDb(c.env))
  const db = counted.db
  const requestJson = canonicalProductConflictJson(request)
  const requestDigest = await productConflictSha256(request)
  let run = await db.prepare(`SELECT * FROM product_conflict_merge_runs WHERE actor_id=@actorId AND request_id=@requestId`)
    .get<SelectedConflictRunRow>({ actorId: user.id, requestId: request.client_request_id })
  if (run && run.request_digest !== requestDigest) {
    return c.json({ success: false, code: 'idempotency_conflict', error: 'client_request_id was already used with a different selected merge manifest or stock choice.' }, 409)
  }

  const canChangeImages = getActionTier(user, 'products', 'image') === 'full'
  if (!run) {
    const previewCases = request.cases.map((item): ProductConflictPreviewCase => {
      const parsed = parseProductConflictCaseKey(item.case_key)!
      return { case_key: item.case_key, cluster_type: parsed.cluster_type, cluster_value: parsed.cluster_value, product_ids: [item.keep_id, item.merge_id] }
    })
    const preflight = await prepareSelectedConflictApplyPreflightCases(db, previewCases, canChangeImages)
    const refusals: Array<{ caseKey: string; keeperId: number | null; mergedId: number | null; code: string; error: string }> = preflight.skipped.map((item) => ({
      caseKey: item.case_key,
      keeperId: request.cases[item.ordinal]?.keep_id ?? null,
      mergedId: request.cases[item.ordinal]?.merge_id ?? null,
      code: item.code,
      error: item.message,
    }))
    for (const prepared of preflight.prepared) {
      const supplied = request.cases[prepared.ordinal]
      let code: string | null = null
      let error = ''
      if (!supplied || supplied.keep_id !== prepared.keeper.id || supplied.merge_id !== prepared.discarded.id
        || supplied.state_digest !== prepared.stateDigest) {
        code = 'merge_state_conflict'; error = 'This selected pair changed after preview. Refresh the combined review before merging.'
      } else if (prepared.needsStockChoice && supplied.stock == null) {
        code = 'stock_choice_required'; error = 'Choose whether the discarded product stock moves or is written off.'
      } else if (!prepared.needsStockChoice && supplied.stock != null) {
        code = 'stock_choice_not_applicable'; error = 'This unstocked pair must send a null stock choice.'
      } else if (prepared.blockingSession) {
        code = 'stock_session_reversible'; error = mergeStockSessionBlockedMessage(prepared.blockingSession.operationId)
      } else if (prepared.imageChanges && !canChangeImages) {
        code = 'image_permission_required'; error = 'This merge changes product images and requires full image permission.'
      } else {
        const selectedChoice = supplied.stock ?? 'merge'
        if (prepared.statementEstimate[selectedChoice] > 100) {
          code = 'merge_case_exceeds_safe_limit'; error = 'This product has too many linked rows for one safe merge case.'
        }
      }
      if (code) refusals.push({ caseKey: prepared.caseKey, keeperId: prepared.keeper.id, mergedId: prepared.discarded.id, code, error })
    }
    const authoritativeManifestDigest = await selectedConflictManifestDigest(preflight.prepared)
    if (authoritativeManifestDigest !== request.manifest_digest && !refusals.some((item) => item.code === 'merge_state_conflict')) {
      refusals.push({ caseKey: '', keeperId: null, mergedId: null, code: 'merge_state_conflict', error: 'The reviewed manifest digest is stale or reordered.' })
    }
    if (refusals.length) {
      const imageDenied = refusals.some((item) => item.code === 'image_permission_required')
      const stockMissing = refusals.some((item) => item.code === 'stock_choice_required' || item.code === 'stock_choice_not_applicable')
      return c.json({ success: false, code: imageDenied ? 'image_permission_required' : stockMissing ? 'stock_choice_required' : 'merge_state_conflict', error: refusals[0].error, refusals }, imageDenied ? 403 : stockMissing ? 400 : 409)
    }
    const runId = crypto.randomUUID()
    const insertStatements: Array<{ sql: string; params?: Record<string, unknown> }> = preflight.prepared.flatMap((item) => item.stateGuards)
    insertStatements.push({
      sql: `INSERT INTO product_conflict_merge_runs
        (id,actor_id,request_id,request_digest,manifest_version,manifest_digest,request_json,status,result_json)
        VALUES(@id,@actorId,@requestId,@requestDigest,@manifestVersion,@manifestDigest,@requestJson,'planned',NULL)`,
      params: {
        id: runId, actorId: user.id, requestId: request.client_request_id, requestDigest,
        manifestVersion: request.manifest_version, manifestDigest: request.manifest_digest, requestJson,
      },
    })
    for (const item of preflight.prepared) {
      const supplied = request.cases[item.ordinal]
      insertStatements.push({
        sql: `INSERT INTO product_conflict_merge_run_cases
          (run_id,ordinal,case_key,keeper_product_id,merged_product_id,expected_state_digest,stock_choice,operation_id,status)
          VALUES(@runId,@ordinal,@caseKey,@keeperId,@mergedId,@stateDigest,@stockChoice,@operationId,'planned')`,
        params: {
          runId, ordinal: item.ordinal, caseKey: item.caseKey, keeperId: item.keeper.id, mergedId: item.discarded.id,
          stateDigest: item.stateDigest, stockChoice: supplied.stock, operationId: productConflictOperationId(runId, item.ordinal),
        },
      })
    }
    try { await db.batch(insertStatements) }
    catch (error) {
      if (/malformed JSON|selected_conflict_state_guard/i.test(String(error))) {
        return c.json({ success: false, code: 'merge_state_conflict', error: 'A selected product changed during final confirmation. Refresh the combined review; nothing was merged and no receipt was created.' }, 409)
      }
      // A concurrent exact retry can win the unique actor/request insert.
      run = await db.prepare(`SELECT * FROM product_conflict_merge_runs WHERE actor_id=@actorId AND request_id=@requestId`)
        .get<SelectedConflictRunRow>({ actorId: user.id, requestId: request.client_request_id })
      if (!run || run.request_digest !== requestDigest) throw error
    }
    if (!run) run = await db.prepare('SELECT * FROM product_conflict_merge_runs WHERE id=@id').get<SelectedConflictRunRow>({ id: runId })
  }
  if (!run) throw new Error('The selected conflict merge receipt could not be created.')

  let madeProgress = false
  let interruptionCode: 'merge_budget_reached' | 'merge_infrastructure_interrupted' | 'merge_history_pending' | 'merge_history_unavailable' | 'merge_state_conflict' | null = null
  let rows = await db.prepare('SELECT * FROM product_conflict_merge_run_cases WHERE run_id=@runId ORDER BY ordinal')
    .all<SelectedConflictRunCaseRow>({ runId: run.id })

  // Complete a prior fold's pending fingerprint before any new pair. A retry
  // never re-enters the fold for committed/history_pending rows.
  for (const item of rows) {
    if (item.status !== 'committed' && item.status !== 'history_pending' && item.status !== 'undo_ready') continue
    const reconciled = await reconcileSelectedConflictHistory(c.env, db, item)
    if (reconciled.undoAvailability === 'unavailable') interruptionCode = 'merge_history_unavailable'
    else if (reconciled.undoAvailability === 'pending' && interruptionCode !== 'merge_history_unavailable') interruptionCode = 'merge_history_pending'
  }

  if (!interruptionCode) {
    rows = await db.prepare('SELECT * FROM product_conflict_merge_run_cases WHERE run_id=@runId ORDER BY ordinal')
      .all<SelectedConflictRunCaseRow>({ runId: run.id })
    const planned = rows.filter((item) => item.status === 'planned')
    for (const item of planned) {
      if (interruptionCode) break
      const finalizationReserve = PRODUCT_MERGE_READ_BATCH_MAX_STATEMENTS + 6
      const responseReserve = rows.length + 3
      const preparationReserve = 130
      if (Date.now() - startedAt + 1_500 >= MERGE_DUPLICATES_REQUEST_BUDGET_MS
        || counted.statementCount() + preparationReserve + 100 + finalizationReserve + responseReserve > MERGE_DUPLICATES_REQUEST_STATEMENT_BUDGET) {
        interruptionCode = 'merge_budget_reached'
        break
      }
      const parsed = parseProductConflictCaseKey(item.case_key)!
      const previewCase: ProductConflictPreviewCase = {
        case_key: item.case_key,
        cluster_type: parsed.cluster_type,
        cluster_value: parsed.cluster_value,
        product_ids: [item.keeper_product_id, item.merged_product_id],
      }
      const selectedChoice: 'merge' | 'write_off' = item.stock_choice ?? 'merge'
      let prepared: SelectedConflictPreparedCase | undefined
      try {
        const current = await prepareSelectedConflictCases(db, [previewCase], canChangeImages, [selectedChoice])
        if (current.skipped.length) {
          const skipped = current.skipped[0]
          await db.prepare(`UPDATE product_conflict_merge_run_cases SET status='refused',refusal_code=@code,error=@error,updated_at=CURRENT_TIMESTAMP
            WHERE run_id=@runId AND ordinal=@ordinal AND status='planned'`)
            .run({ code: skipped.code, error: skipped.message, runId: run.id, ordinal: item.ordinal })
          interruptionCode = 'merge_state_conflict'
          break
        }
        prepared = current.prepared[0]
      } catch (error) {
        if (isProductMergeInfrastructureError(error)) { interruptionCode = 'merge_infrastructure_interrupted'; break }
        throw error
      }
      if (!prepared || prepared.keeper.id !== item.keeper_product_id || prepared.discarded.id !== item.merged_product_id
        || prepared.stateDigest !== item.expected_state_digest) {
        await db.prepare(`UPDATE product_conflict_merge_run_cases SET status='refused',refusal_code='merge_state_conflict',
          error='This pair changed after confirmation. Refresh before resuming.',updated_at=CURRENT_TIMESTAMP
          WHERE run_id=@runId AND ordinal=@ordinal AND status='planned'`)
          .run({ runId: run.id, ordinal: item.ordinal })
        interruptionCode = 'merge_state_conflict'
        break
      }
      const estimate = prepared.statementEstimate[selectedChoice]
      // The fold's post-commit history finalizer can consume up to the shared
      // 80-statement fingerprint read ceiling plus its two lookups and three
      // finalize statements. Reserve that work, the branch lookup, receipt
      // status update, and bounded final response reconciliation before the
      // pair starts so the request cannot cross the 700-statement ceiling.
      if (Date.now() - startedAt + 1_500 >= MERGE_DUPLICATES_REQUEST_BUDGET_MS
        || counted.statementCount() + estimate + finalizationReserve + responseReserve > MERGE_DUPLICATES_REQUEST_STATEMENT_BUDGET) {
        interruptionCode = 'merge_budget_reached'
        break
      }
      const receiptStatements = [
        {
          sql: `UPDATE product_conflict_merge_run_cases SET status='committed',updated_at=CURRENT_TIMESTAMP
                WHERE run_id=@runId AND ordinal=@ordinal AND status='planned'
                  AND operation_id=@operationId AND expected_state_digest=@stateDigest`,
          params: { runId: run.id, ordinal: item.ordinal, operationId: item.operation_id, stateDigest: item.expected_state_digest },
        },
        {
          sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM product_conflict_merge_run_cases
                  WHERE run_id=@runId AND ordinal=@ordinal AND status='committed' AND operation_id=@operationId)
                AND changes()=1
                THEN 1 ELSE json_extract('', '$') END AS selected_conflict_receipt_guard`,
          params: { runId: run.id, ordinal: item.ordinal, operationId: item.operation_id },
        },
      ]
      try {
        const result = await foldDuplicateProductInto(
          c.env, db, user,
          { id: prepared.keeper.id, name: prepared.keeper.name },
          { id: prepared.discarded.id, name: prepared.discarded.name, image_path: prepared.discarded.image_path },
          new Map((await db.prepare('SELECT id,name FROM branches').all<{ id: number; name: string }>({})).map((branch) => [Number(branch.id), String(branch.name)])),
          'selected conflict review',
          selectedChoice,
          undefined,
          {
            operationId: item.operation_id,
            preStatements: prepared.stateGuards,
            additionalStatements: receiptStatements,
            auditContext: {
              selectedConflictRunId: run.id,
              selectedConflictRequestId: run.request_id,
              selectedConflictManifestDigest: run.manifest_digest,
              selectedConflictCaseKey: item.case_key,
              selectedConflictOrdinal: item.ordinal,
              selectedConflictReviewedBefore: prepared.before,
              selectedConflictProjectedAfter: prepared.afterByStockChoice[selectedChoice],
            },
            snapshotContext: {
              runId: run.id, requestId: run.request_id, manifestDigest: run.manifest_digest,
              caseKey: item.case_key, ordinal: item.ordinal, stateDigest: item.expected_state_digest,
              reviewedBefore: prepared.before,
              projectedAfter: prepared.afterByStockChoice[selectedChoice],
            },
            preparedSnapshot: prepared.snapshot,
            preparedDependentLotSnapshots: prepared.dependentLots,
          },
        )
        madeProgress = true
        await db.prepare(`UPDATE product_conflict_merge_run_cases SET status=@status,action_history_id=@historyId,updated_at=CURRENT_TIMESTAMP
          WHERE run_id=@runId AND ordinal=@ordinal AND status='committed'`)
          .run({ status: result.undoReady ? 'undo_ready' : 'history_pending', historyId: result.actionHistoryId, runId: run.id, ordinal: item.ordinal })
        if (!result.undoReady) { interruptionCode = 'merge_history_pending'; break }
      } catch (error) {
        if (isProductMergeInfrastructureError(error)) {
          interruptionCode = 'merge_infrastructure_interrupted'
          break
        }
        const conflict = /merge_state_conflict|merge_identity_conflict|selected_conflict.*guard|malformed JSON/i.test(String(error))
        const exceeds = /merge_case_statement_budget_exceeded|merge_case_fingerprint_statement_budget_exceeded|merge_read_batch_statement_limit/.test(String(error))
        await db.prepare(`UPDATE product_conflict_merge_run_cases SET status='refused',refusal_code=@code,error=@error,updated_at=CURRENT_TIMESTAMP
          WHERE run_id=@runId AND ordinal=@ordinal AND status='planned'`)
          .run({
            code: conflict ? 'merge_state_conflict' : exceeds ? 'merge_case_exceeds_safe_limit' : 'merge_failed',
            error: conflict ? 'This pair changed during execution and remains unchanged.' : exceeds ? 'This pair exceeds the safe atomic limit and remains unchanged.' : String(error),
            runId: run.id, ordinal: item.ordinal,
          })
        interruptionCode = conflict ? 'merge_state_conflict' : null
        break
      }
    }
  }

  rows = await db.prepare('SELECT * FROM product_conflict_merge_run_cases WHERE run_id=@runId ORDER BY ordinal')
    .all<SelectedConflictRunCaseRow>({ runId: run.id })
  const committed = rows.filter((item) => item.status === 'committed' || item.status === 'history_pending' || item.status === 'undo_ready')
  const refusals = rows.filter((item) => item.status === 'refused').map((item) => ({
    caseKey: item.case_key,
    keeperId: item.keeper_product_id,
    mergedId: item.merged_product_id,
    code: item.refusal_code || 'merge_failed',
    error: item.error || 'This selected pair was refused.',
  }))
  const pending = rows.filter((item) => item.status === 'planned')
  const undoByOperation = new Map<string, Awaited<ReturnType<typeof readSelectedConflictUndoAvailability>>>()
  for (const item of committed) undoByOperation.set(item.operation_id, await readSelectedConflictUndoAvailability(db, item))
  const undoPending = committed.filter((item) => undoByOperation.get(item.operation_id)?.availability === 'pending')
  const undoUnavailable = committed.filter((item) => undoByOperation.get(item.operation_id)?.availability === 'unavailable')
  const complete = committed.length === rows.length
  const blockedOnly = !complete && pending.length === 0 && refusals.length > 0
  const infrastructureUnknown = interruptionCode === 'merge_infrastructure_interrupted'
  const response = {
    success: true,
    complete,
    blockedOnly,
    interrupted: interruptionCode != null,
    interruptionCode,
    madeProgress,
    requestId: run.request_id,
    manifestDigest: run.manifest_digest,
    committedCases: committed.map((item) => {
      const undo = undoByOperation.get(item.operation_id) ?? { availability: 'unavailable' as const, actionHistoryId: null }
      return {
        caseKey: item.case_key,
        keptId: item.keeper_product_id,
        mergedId: item.merged_product_id,
        stockDisposition: item.stock_choice ?? 'merge',
        operationId: item.operation_id,
        actionHistoryId: undo.actionHistoryId,
        undoReady: undo.availability === 'ready',
        undoAvailability: undo.availability,
      }
    }),
    processedCaseKeys: committed.map((item) => item.case_key),
    refusals,
    pendingCaseKeys: pending.map((item) => item.case_key),
    remainingCaseCount: infrastructureUnknown ? null : rows.length - committed.length,
    maxAdditionalRequests: interruptionCode === 'merge_budget_reached' ? Math.max(1, pending.length) : infrastructureUnknown ? null : 0,
    undoPendingOperationIds: undoPending.map((item) => item.operation_id),
    undoUnavailableOperationIds: undoUnavailable.map((item) => item.operation_id),
  }
  await db.prepare(`UPDATE product_conflict_merge_runs SET status=@status,result_json=@result,updated_at=CURRENT_TIMESTAMP WHERE id=@runId`)
    .run({ status: complete && !undoPending.length ? 'completed' : interruptionCode ? 'interrupted' : 'running', result: JSON.stringify(response), runId: run.id })
  if (madeProgress) {
    c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
    c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
    c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'update' }))
  }
  return c.json(response)
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
  const numericIssue = mergeNumericRefusal(identity)
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
    blocked: !identity.same
      ? { code: 'incompatible_product_identity' }
      : numericIssue
        ? { code: 'invalid_merge_numeric', field: numericIssue.field, rowId: numericIssue.rowId }
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
  if (!Number.isSafeInteger(keepId) || keepId <= 0 || !Number.isSafeInteger(mergeId) || mergeId <= 0 || keepId === mergeId) {
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
  if (!identity.same) {
    return c.json({
      success: false,
      code: 'incompatible_product_identity',
      error: 'These products do not have the same normalized name and barcode, so they cannot be merged.',
      identity,
    }, 409)
  }
  const numericIssue = mergeNumericRefusal(identity)
  if (numericIssue) {
    return c.json({
      success: false,
      code: 'invalid_merge_numeric',
      error: productMergeNumericError(identity.numericIssues),
      identity,
      numericIssue,
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
  if (getActionTier(user, 'products', 'image') !== 'full' && await productMergeChangesImages(
    db,
    [{ keeper, discarded: dup }],
  )) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }

  let stats: Awaited<ReturnType<typeof foldDuplicateProductInto>>
  try {
    stats = await foldDuplicateProductInto(
      c.env, db, user,
      { id: keeper.id, name: keeper.name },
      { id: dup.id, name: dup.name, image_path: dup.image_path },
      branchNameById,
      'possible-duplicates review merge',
      stockChoice ?? 'merge',
      undefined,
      { operationId: crypto.randomUUID() },
    )
  } catch (error) {
    if (/merge_state_conflict|merge_identity_conflict/.test(String(error))) {
      return c.json({ success: false, code: 'merge_state_conflict', error: 'One of these products changed while the merge was being prepared. Refresh and try again.' }, 409)
    }
    if (/merge_numeric_invalid:/.test(String(error))) {
      return c.json({ success: false, code: 'invalid_merge_numeric', error: String(error).replace(/^Error:\s*merge_numeric_invalid:/, '') }, 409)
    }
    throw error
  }

  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'update' }))
  const { reversal: _reversal, reparentedSaleItemIds: _si, reparentedMovementIds: _mi, ...publicStats } = stats
  return c.json({
    success: true,
    keptId: keeper.id,
    mergedId: dup.id,
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
      await audit(c.env, user?.id ?? null, actorSnapshot(user), 'zero_quantity_delete', 'product', id, {
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

  await audit(c.env, user?.id ?? null, actorSnapshot(user), 'lookup_replace', 'product', null, {
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
  `).run({ original_name: originalName, stored_name: storedName, public_path: publicPath, mime_type: mimeType, byte_size: buffer.byteLength, created_by_id: user?.id ?? null, created_by_name: actorSnapshot(user) })
  const asset = await db.prepare(`SELECT * FROM file_assets WHERE id = @id`).get({ id: insert.lastInsertRowid })

  await audit(c.env, user?.id ?? null, actorSnapshot(user), 'upload', 'product_image', insert.lastInsertRowid, { original_name: originalName })
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
