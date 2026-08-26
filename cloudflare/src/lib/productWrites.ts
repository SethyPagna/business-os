// Shared product row-write helpers -- extracted from routes/products.ts
// (part 152) so lib/reviewApply.ts's Products appliers can replay an
// approved create/update through the EXACT same write path the route
// uses directly, without lib/ importing from routes/ (a route file can
// pull in Hono, auth, rate-limiting, etc. that a pure lib module has no
// business depending on, and it breaks every pure-source test harness
// that loads lib/ files in isolation). routes/products.ts re-exports
// these same functions for its own use so no call site elsewhere needed
// to change its import path.

import { getDb } from './db'
import { sanitizeMediaList } from './media'
import { dateToBatchCode } from './batchCode'
import { normalizeSearchText, compactSearchText } from './searchMatch'
import { MAX_IMAGES_PER_PRODUCT } from './importImageMatch'
import type { Env } from '../index'

export const PRODUCT_SKIP_KEYS = new Set([
  'id', 'expectedUpdatedAt', 'expected_updated_at', 'updatedAt', 'updated_at',
  'client_request_id', 'device_name', 'device_tz', 'client_time',
])

export function nowIso() {
  return new Date().toISOString()
}

export async function tableColumns(env: Env, table: string): Promise<Set<string>> {
  const rows = await env.DB.prepare(`PRAGMA table_info("${table}")`).all<{ name: string }>()
  return new Set((rows.results || []).map((row) => row.name))
}

// This app doesn't support negative stock -- see routes/products.ts's own
// longer comment (unchanged, kept there) for the full reasoning; moved
// here only because insertRow/updateRow needed it and this is now their
// home.
export function clampNegativeStockQuantity(key: string, value: unknown): unknown {
  if (key !== 'stock_quantity') return value
  const n = Number(value)
  return Number.isFinite(n) && n < 0 ? 0 : value
}

export function cleanPayload(body: Record<string, unknown>, columns: Set<string>) {
  const payload: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body || {})) {
    if (PRODUCT_SKIP_KEYS.has(key) || !columns.has(key)) continue
    const boolNormalized = typeof value === 'boolean' ? (value ? 1 : 0) : value
    payload[key] = clampNegativeStockQuantity(key, boolNormalized)
  }
  return payload
}

// Populates products.name_normalized/unit_normalized/brand_compact (see
// migrations/0037-0049_product_search_compact_columns_*.sql, split into
// small batches after a remote CPU-timeout -- see that migration's own
// comment) from whatever
// name/unit/brand value is actually being written, computed in JS via
// this file's own lib/searchMatch.ts functions (normalizeSearchText/
// compactSearchText -- the exact same normalization search already uses
// everywhere else) instead of an equivalent SQL REPLACE-chain expression.
// Deliberately NOT done as a SQL trigger/expression: hand-tracing (and
// confirming against a real SQLite build) that folding all 70
// DIACRITIC_SQL_PAIRS entries as nested REPLACE() calls in one SQL
// statement -- whether at query time (the original bug: D1_ERROR
// "Expression tree is too large (maximum depth 100)") or bundled into a
// single write-time UPDATE/trigger -- risks the exact same class of
// SQL-parser-depth failure, just moved from "every search request" to
// "every write", not actually eliminated. Computing it in JS and binding
// the result as a plain parameter value has no such limit either way.
// This is the single choke point both routes/products.ts's create/update
// handlers AND lib/reviewApply.ts's replayed Products appliers go through
// (see this file's own header comment on why insertRow/updateRow exist),
// so hooking in here covers every write path without touching each call
// site individually. `columns.has(...)` naturally no-ops this for any
// other table insertRow/updateRow is used against (those columns simply
// don't exist there), and for a partial update that never touched
// name/unit/brand at all (their derived column is left alone, matching
// cleanPayload's existing "don't touch what wasn't sent" behavior).
function applySearchNormalizedColumns(payload: Record<string, unknown>, body: Record<string, unknown>, columns: Set<string>, isInsert: boolean) {
  const shouldSet = (sourceKey: string) => isInsert || sourceKey in body
  if (columns.has('name_normalized') && shouldSet('name')) {
    payload.name_normalized = normalizeSearchText(payload.name ?? body.name)
  }
  if (columns.has('unit_normalized') && shouldSet('unit')) {
    payload.unit_normalized = normalizeSearchText(payload.unit ?? body.unit)
  }
  if (columns.has('brand_compact') && shouldSet('brand')) {
    payload.brand_compact = compactSearchText(payload.brand ?? body.brand)
  }
}

export async function insertRow(env: Env, table: string, body: Record<string, unknown>, required: Record<string, unknown> = {}) {
  const columns = await tableColumns(env, table)
  const payload = { ...cleanPayload(body, columns), ...required }
  applySearchNormalizedColumns(payload, body, columns, true)
  if (columns.has('created_at') && payload.created_at == null) payload.created_at = nowIso()
  if (columns.has('updated_at') && payload.updated_at == null) payload.updated_at = nowIso()
  const keys = Object.keys(payload).filter((key) => columns.has(key))
  // sql-bound-params: bounded by construction -- one parameter per COLUMN
  // of a single row, capped by the table's schema, not by any row count.
  const placeholders = keys.map(() => '?').join(', ')
  const result = await env.DB.prepare(`INSERT INTO "${table}" (${keys.map((key) => `"${key}"`).join(', ')}) VALUES (${placeholders})`)
    .bind(...keys.map((key) => payload[key]))
    .run()
  return result.meta?.last_row_id
}

export async function updateRow(env: Env, table: string, id: string | number, body: Record<string, unknown>) {
  const columns = await tableColumns(env, table)
  const payload = cleanPayload(body, columns)
  applySearchNormalizedColumns(payload, body, columns, false)
  if (columns.has('updated_at')) payload.updated_at = nowIso()
  const keys = Object.keys(payload).filter((key) => columns.has(key))
  if (!keys.length) return 0
  const assignments = keys.map((key) => `"${key}" = ?`).join(', ')
  const result = await env.DB.prepare(`UPDATE "${table}" SET ${assignments} WHERE id = ?`)
    .bind(...keys.map((key) => payload[key]), id)
    .run()
  return result.meta?.changes || 0
}

// --- multi-category / multi-brand normalization ---------------------------
//
// A product can belong to more than one category (e.g. a set that's both
// "Gift Set" and "Skincare"), and can carry more than one brand tag (a
// collab product, or a brand plus a "Limited Edition" marker) -- see
// migrations/0033_product_multi_category_brand.sql's own comment for the
// full schema reasoning. The single-value `category`/`brand` columns stay
// the PRIMARY (first-listed) value, unchanged in shape, so every existing
// sort/filter/group-by/facet-dropdown/merge-rename call site keeps working
// exactly as before with zero changes. The new `categories`/`brands`
// columns hold the FULL `||`-joined list, primary included.
//
// Normalizes a raw multi-value input (array, or an already `||`-joined
// string -- e.g. straight from an import row) into a clean, deduped,
// trimmed `||`-joined string with the primary value guaranteed first.
// Returns undefined (meaning: leave the column alone) when there's
// nothing meaningful to write, so a caller that never touches
// categories/brands at all doesn't overwrite an existing multi-value list
// with a single-value one.
export function normalizeMultiValue(primary: unknown, rawMulti: unknown): string | undefined {
  const primaryStr = String(primary ?? '').trim()
  let parts: string[] = []
  if (Array.isArray(rawMulti)) {
    parts = rawMulti.map((v) => String(v ?? '').trim()).filter(Boolean)
  } else if (typeof rawMulti === 'string' && rawMulti.trim()) {
    parts = rawMulti.split('||').map((v) => v.trim()).filter(Boolean)
  }
  if (primaryStr) parts.unshift(primaryStr)
  if (!parts.length) return primaryStr ? primaryStr : undefined
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const part of parts) {
    const key = part.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(part)
  }
  return deduped.join('||')
}


export async function syncProductImageGallery(env: Env, productId: number | string, rawGallery: unknown): Promise<string[]> {
  const gallery = sanitizeMediaList(rawGallery).slice(0, MAX_IMAGES_PER_PRODUCT)
  const db = getDb(env)
  await db.batch([
    { sql: `DELETE FROM product_images WHERE product_id = @id`, params: { id: productId } },
    ...gallery.map((imagePath, index) => ({
      sql: `INSERT INTO product_images (product_id, image_path, sort_order) VALUES (@id, @path, @order)`,
      params: { id: productId, path: imagePath, order: index },
    })),
  ])
  return gallery
}

// Same selection rule as routes/inventory.ts's own defaultBranchId().
export async function defaultBranchId(env: Env): Promise<number | null> {
  const row = await getDb(env).prepare(
    'SELECT id FROM branches WHERE is_active = 1 ORDER BY is_default DESC, id ASC LIMIT 1',
  ).get<{ id: number }>()
  return row?.id ?? null
}

// A brand-new product used to only get a `branch_stock` row for whichever
// single branch it was created against (the chosen/default branch) -- every
// other branch had no row at all, which reads very differently from "0 in
// stock at that branch": Products/Inventory's per-branch displays (e.g.
// buildProductBranchSummaryLabel) treat a missing row as "not tracked
// there", not as zero, so a newly created product looked like it didn't
// exist at any branch but its one seeded one instead of showing "0" for the
// rest like every other page already does for it once *some* movement
// eventually touches it. Called right after a product's own row is
// inserted (POST / and POST /variant in routes/products.ts) so every active
// branch gets an explicit row from the start -- 0 everywhere except the
// chosen branch, which gets the real initial quantity.
export async function seedBranchStockForNewProduct(
  env: Env,
  productId: number | string,
  chosenBranchId: number | null,
  chosenBranchQty: number,
): Promise<void> {
  const db = getDb(env)
  const branchRows = await db.prepare('SELECT id FROM branches WHERE is_active = 1').all<{ id: number }>()
  const branchIds = (branchRows || []).map((row) => row.id)
  if (chosenBranchId != null && !branchIds.includes(chosenBranchId)) branchIds.push(chosenBranchId)
  if (branchIds.length === 0) return
  await db.batch(branchIds.map((branchId) => ({
    sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, @branchId, @qty)
      ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = excluded.quantity`,
    params: {
      id: productId,
      branchId,
      // Only the chosen branch gets the real initial quantity -- every
      // other active branch starts at 0 (tracked, not just absent).
      qty: branchId === chosenBranchId ? Math.max(0, Number(chosenBranchQty) || 0) : 0,
    },
  })))
}

// Every product has one stable, zero-or-more-quantity "day added" batch
// from its first save. This is an identifier (not a separate receiving
// workflow): it gives the product a batch record even before stock arrives.
// `initial:<productId>` is idempotent, so callers can safely invoke it after
// any creation path without producing duplicate default batches.
export async function seedInitialBatchForNewProduct(
  env: Env,
  productId: number | string,
  chosenBranchId: number | null,
  chosenBranchQty: number,
): Promise<void> {
  const db = getDb(env)
  const id = Number(productId)
  if (!Number.isFinite(id) || id <= 0) return
  const addedOn = new Date().toISOString().slice(0, 10)
  const batchKey = `initial:${id}`
  // batch_key stays `initial:<id>` (not the date code) so this insert
  // remains idempotent regardless of what day it's retried on -- the
  // ON CONFLICT DO NOTHING below only works because this key can't
  // collide with anything else. lot_code (the operator-facing display)
  // is still the same date-derived code every other batch now gets (see
  // batchCode.ts's dateToBatchCode), so this default batch reads no
  // differently from one created through Receive Stock on day one.
  await db.prepare(`
    INSERT INTO product_batches (variant_product_id, batch_key, lot_code, received_at, is_active, notes, batch_number)
    VALUES (@productId, @batchKey, @lotCode, datetime('now'), 1, @notes, 1)
    ON CONFLICT(variant_product_id, batch_key) DO NOTHING
  `).run({ productId: id, batchKey, lotCode: dateToBatchCode(addedOn), notes: 'Default batch created with product' })
  if (chosenBranchId == null) return
  const batch = await db.prepare('SELECT id FROM product_batches WHERE variant_product_id = @productId AND batch_key = @batchKey').get<{ id: number }>({ productId: id, batchKey })
  if (!batch) return
  await db.prepare(`
    INSERT INTO branch_batch_stock (batch_id, branch_id, quantity)
    VALUES (@batchId, @branchId, @quantity)
    ON CONFLICT(batch_id, branch_id) DO NOTHING
  `).run({ batchId: batch.id, branchId: chosenBranchId, quantity: Math.max(0, Number(chosenBranchQty) || 0) })
}

// ---------------------------------------------------------------------------
// "Image actions only" restricted role (progress.md backlog item #7, Part
// 241; expanded from upload-only to full image actions per later user
// direction): a row-level permission for Products where the granted user
// can see only a product's name and selling price, and can only ever
// view/add/remove/reorder its image(s) -- every other field (cost, margin,
// stock, branches, barcode, etc.) stays hidden and unwritable. This is a
// plain boolean permission key (`products_image_only`), not a
// REVIEW_TIER_KEYS tier -- it's a genuinely different shape of access
// (field-restricted), not a Full/Review/None gradient on the same full
// view, so it doesn't belong in that three-tier system. Anyone with real
// `products` access (tier full or review) never hits this restriction --
// it only ever applies to a user whose *only* grant into this page is
// this key.

/**
 * Product row fields this restricted role can ALWAYS see, no matter what --
 * the minimum needed to render a row and save an image against it.
 *
 * Everything else (selling price, barcode, category, brand, stock) used to
 * be a single hardcoded all-or-nothing decision here (Part 242: pricing
 * hidden entirely). Part 243 replaced that with IMAGE_ONLY_OPTIONAL_FIELDS
 * below -- each optional field now hides by default and an admin opts a
 * role INTO seeing it individually via its own permission checkbox
 * (PermissionEditor.tsx, under Products), so orgs that DO want this role to
 * see price/barcode/etc. aren't stuck with the old hardcoded "never" any
 * more than a hardcoded "always" would have suited the org that asked for
 * pricing to be hidden in the first place.
 */
export const IMAGE_ONLY_BASE_FIELDS = [
  'id', 'name', 'image_path', 'image_gallery', 'updated_at',
] as const

/**
 * Optional product row fields this restricted role can be granted
 * visibility into, one at a time -- each key here is a real, independent
 * boolean permission (see permissionDefinitions.ts's matching entries and
 * frontend/src/components/products/ProductsImageOnlyView.tsx's own use of
 * these same keys via useApp().hasPermission()). A field only ever appears
 * for a user whose merged permissions map has that exact key === true;
 * everything not explicitly granted stays hidden -- same "hidden unless
 * opted in" default the base-fields comment above describes.
 */
export const IMAGE_ONLY_OPTIONAL_FIELDS: Record<string, readonly string[]> = {
  products_image_only_show_price: ['selling_price_usd', 'selling_price_khr'],
  products_image_only_show_barcode: ['barcode'],
  products_image_only_show_category: ['category'],
  products_image_only_show_brand: ['brand'],
  // low_stock_threshold rides along with stock rather than being its own
  // permission: it is not independently interesting, and without it a stock
  // figure cannot be coloured -- "12 in stock" says nothing about whether 12
  // is healthy or nearly out. Granting stock visibility without the number
  // that gives it meaning would be a distinction with no use.
  products_image_only_show_stock: ['stock_quantity', 'low_stock_threshold', 'out_of_stock_threshold'],
}

/**
 * Backward-compat alias for callers that only care about "the fields this
 * role sees with nothing optional granted" -- equal to IMAGE_ONLY_BASE_FIELDS.
 */
export const IMAGE_ONLY_VISIBLE_FIELDS = IMAGE_ONLY_BASE_FIELDS

/**
 * Resolves the real visible-field list for one user, given their MERGED
 * permissions map (role.permissions merged with user.permissions -- same
 * shape lib/permissions.ts's getMergedPermissions() returns; passed in
 * directly rather than re-derived here so this whole section stays
 * import-free -- see test-products-image-only-pure.cjs's comment on why it
 * transpiles this section standalone, with no module resolution available).
 */
export function computeImageOnlyVisibleFields(mergedPermissions?: Record<string, unknown> | null): string[] {
  const perms = mergedPermissions || {}
  const fields: string[] = [...IMAGE_ONLY_BASE_FIELDS]
  for (const [permKey, columns] of Object.entries(IMAGE_ONLY_OPTIONAL_FIELDS)) {
    if (perms[permKey] === true) fields.push(...columns)
  }
  return fields
}

/**
 * Product row field(s) this restricted role is allowed to WRITE.
 *
 * Originally just `image_path` (the single "row image") -- per explicit
 * user direction this role now gets full image-*actions*, not just
 * upload: view the existing gallery (up to MAX_IMAGES_PER_PRODUCT, see
 * importImageMatch.ts), add a new one, remove one, and reorder them.
 * `image_gallery` is a virtual key (see syncProductImageGallery above,
 * not a real `products` column) -- routes/products.ts's PUT handler
 * already treats it as a wholesale-replace of the gallery for the full
 * editor (add/remove/reorder are all just "send the new full list"),
 * so granting this role write access to that same virtual key is the
 * whole change; no new gallery-mutation endpoint was needed. `image_path`
 * stays writable too and is kept in sync as the gallery's first entry
 * (mirrors ProductForm.tsx's own `image_path: imageList[0] || ''`), so
 * every other read path that only ever looked at the single `image_path`
 * column (POS, receipts, etc.) keeps working unchanged.
 */
export const IMAGE_ONLY_WRITABLE_FIELDS = new Set(['image_path', 'image_gallery'])

// Request metadata every product write already carries (device info,
// optimistic-concurrency token, the offline client-request id) -- these are
// never real product data and must never trip the "tried to write a
// forbidden field" check below. Mirrors PRODUCT_SKIP_KEYS above, but named
// separately since that set is about what insertRow/updateRow persist, not
// about what this restricted role is allowed to even send.
const IMAGE_ONLY_METADATA_KEYS = new Set([
  'id', 'expectedUpdatedAt', 'expected_updated_at', 'updatedAt', 'updated_at',
  'client_request_id', 'deviceName', 'device_name', 'deviceTz', 'device_tz',
  'clientTime', 'client_time',
])

/**
 * True only when every key in `body` is one of this role's writable fields
 * (image_path/image_gallery), or known request metadata -- i.e. this PUT is
 * asking to change the image(s) and nothing else. Used by routes/products.ts's
 * PUT /:id to let an image-only user through without falling back to the
 * full getPermissionTier(user,'products') check every other editor needs.
 */
export function isImageOnlyWritePayload(body: Record<string, unknown>): boolean {
  const keys = Object.keys(body || {})
  if (!keys.some((key) => IMAGE_ONLY_WRITABLE_FIELDS.has(key))) return false
  return keys.every((key) => IMAGE_ONLY_WRITABLE_FIELDS.has(key) || IMAGE_ONLY_METADATA_KEYS.has(key))
}

/**
 * Strips a product row (or array of rows) down to whatever this specific
 * user's merged permissions actually grant them (IMAGE_ONLY_BASE_FIELDS
 * plus any IMAGE_ONLY_OPTIONAL_FIELDS keys they hold) -- see
 * computeImageOnlyVisibleFields above. `mergedPermissions` is optional and
 * falls back to base-fields-only when omitted, so existing call sites that
 * haven't been updated to pass it degrade to the old (safer, more
 * restrictive) all-hidden behavior rather than erroring. Used by the
 * list/search/bootstrap read endpoints when the requesting user's only
 * route into Products is `products_image_only` -- never applied to a user
 * who also holds real `products`/`pos`/`inventory` access, so a cashier or
 * product editor's own view is completely unaffected.
 */
export function restrictToImageOnlyFields<T extends Record<string, unknown>>(row: T, mergedPermissions?: Record<string, unknown> | null): Partial<T> {
  const fields = computeImageOnlyVisibleFields(mergedPermissions)
  const restricted: Partial<T> = {}
  for (const field of fields) {
    if (field in row) (restricted as Record<string, unknown>)[field] = row[field]
  }
  return restricted
}
