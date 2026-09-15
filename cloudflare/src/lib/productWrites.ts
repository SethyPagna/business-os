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
import { tableColumnSet } from './schemaProbe'
import { sanitizeMediaList } from './media'
import { dateToBatchCode } from './batchCode'
import { normalizeSearchText, compactSearchText } from './searchMatch'
import { MAX_IMAGES_PER_PRODUCT } from './importImageMatch'
import type { Env } from '../index'
import { roundMoney4, sellingPriceCeilCent, subtractDecimalSum } from './moneyPrecision'

export const PRODUCT_MONEY_VERSION = 'product_money_policy_version'
export const PRODUCT_MONEY_PLAN = '_product_money_write_plan'
const PRODUCT_MONEY_FIELDS_V1 = ['cost_price_usd', 'cost_price_khr', 'selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr'] as const
const PRODUCT_MONEY_FIELDS_V2 = [...PRODUCT_MONEY_FIELDS_V1, 'purchase_price_usd', 'purchase_price_khr'] as const
const LATEST_PRODUCT_MONEY_POLICY_VERSION = 2 as const
type ProductMoneyField = typeof PRODUCT_MONEY_FIELDS_V2[number]
type MoneyBefore = Record<ProductMoneyField, number | null> & { updated_at: string | null; name: string | null }
type MoneyPlan = { version: 1 | 2; kind: 'create' | 'update'; product_id: number | null; before: Partial<MoneyBefore> | null; after: Partial<Record<ProductMoneyField, number | null>>; group_rename: { from: string; to: string; members: Record<string, unknown>[]; target_members: Record<string, unknown>[] } | null }
export class ProductMoneyWriteError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) { super(message); this.name = 'ProductMoneyWriteError' }
}
function invalidMoneyPlan(): never {
  throw new ProductMoneyWriteError('product_money_plan_invalid', 'The saved product price plan is invalid. Submit a new product edit.')
}
const owns = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key)
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const groupSnapshotBytes = (source: unknown[], target: unknown[]) => new TextEncoder().encode(JSON.stringify([source, target])).byteLength
function moneyInput(value: unknown): number | null {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null
  if ((typeof value !== 'number' && typeof value !== 'string') || !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw new ProductMoneyWriteError('product_money_invalid', 'Prices must be finite non-negative numbers.', 400)
  }
  return Number(value)
}
function moneyFields(version: MoneyPlan['version']): readonly ProductMoneyField[] {
  return version === 1 ? PRODUCT_MONEY_FIELDS_V1 : PRODUCT_MONEY_FIELDS_V2
}
function nextMoney(field: ProductMoneyField, value: unknown, before?: number | null): number | null {
  const parsed = moneyInput(value)
  // A no-op must not reprice an authoritative historical value, even >4dp.
  if (parsed === before && (parsed === null || typeof value === 'number')) return before ?? null
  if (parsed == null) return null
  try {
    if (parsed === before && before != null && subtractDecimalSum(value as string, [before]) === '0') return before
    // USD has cents. KHR catalog money is retained at nearest4, not forced
    // into USD cents or a new physical-cash denomination convention.
    return field === 'selling_price_usd' || field === 'wholesale_price_usd'
      ? sellingPriceCeilCent(value as string | number) : roundMoney4(value as string | number)
  } catch { throw new ProductMoneyWriteError('product_money_invalid', 'The price is outside the supported range.', 400) }
}
export function readProductMoneyPlan(body: Record<string, unknown>): MoneyPlan | null {
  if (!isRecord(body)) return invalidMoneyPlan()
  if (!owns(body, PRODUCT_MONEY_VERSION) && !owns(body, PRODUCT_MONEY_PLAN)) return null // historical queue/operation
  const version = body[PRODUCT_MONEY_VERSION]
  if (version !== 1 && version !== 2) return invalidMoneyPlan()
  const raw = body[PRODUCT_MONEY_PLAN]
  if (!isRecord(raw) || raw.version !== version || (raw.kind !== 'create' && raw.kind !== 'update') || !isRecord(raw.after)) return invalidMoneyPlan()
  const fields = moneyFields(version)
  // Version 1 predates purchase-price ownership. It remains readable only
  // in its exact six-field shape; purchase fields may never hitch a ride
  // outside that frozen plan and bypass its before-image guard.
  if (version === 1 && (owns(body, 'purchase_price_usd') || owns(body, 'purchase_price_khr'))) return invalidMoneyPlan()
  if (Object.keys(raw).sort().join(',') !== 'after,before,group_rename,kind,product_id,version') return invalidMoneyPlan()
  if (raw.kind === 'create' ? raw.product_id !== null || raw.before !== null : !Number.isSafeInteger(raw.product_id) || Number(raw.product_id) <= 0 || !isRecord(raw.before)) return invalidMoneyPlan()
  if (raw.kind === 'update') {
    const before = raw.before as Record<string, unknown>
    if (Object.keys(before).sort().join(',') !== [...fields, 'updated_at', 'name'].sort().join(',')) return invalidMoneyPlan()
    if (before.name !== null && typeof before.name !== 'string') return invalidMoneyPlan()
    if (!owns(before, 'updated_at') || (before.updated_at !== null && typeof before.updated_at !== 'string')) return invalidMoneyPlan()
    for (const field of fields) if (!owns(before, field) || (before[field] !== null && (typeof before[field] !== 'number' || !Number.isFinite(before[field])))) return invalidMoneyPlan()
  }
  if (Object.keys(raw.after).some(field => !fields.includes(field as ProductMoneyField))) return invalidMoneyPlan()
  if (raw.group_rename !== null) {
    const group = raw.group_rename
    if (raw.kind !== 'update' || !isRecord(group) || Object.keys(group).sort().join(',') !== 'from,members,target_members,to'
      || typeof group.from !== 'string' || !group.from || typeof group.to !== 'string' || !group.to
      || group.from !== String((raw.before as MoneyBefore).name || '').trim()
      || group.to !== String(body.name || '').trim() || group.from.toLowerCase() === group.to.toLowerCase()
      || Object.keys(raw.after).length) return invalidMoneyPlan()
    if (!Array.isArray(group.members) || !group.members.length || !Array.isArray(group.target_members)
      || group.members.length + group.target_members.length > 500 || groupSnapshotBytes(group.members, group.target_members) > 500_000) return invalidMoneyPlan()
    const ids = new Set<number>()
    for (const [members, key] of [[group.members, group.from.toLowerCase()], [group.target_members, group.to.toLowerCase()]] as const) for (const member of members) {
      if (!isRecord(member) || !Number.isSafeInteger(member.id) || Number(member.id) <= 0 || ids.has(Number(member.id))
        || member.is_active !== 1 || member.name_key !== key
        || Object.entries(member).some(([key, value]) => !/^[a-z_][a-z_0-9]*$/i.test(key)
          || (value !== null && typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))))) return invalidMoneyPlan()
      ids.add(Number(member.id))
    }
    if (!group.members.some(member => isRecord(member) && member.id === raw.product_id)) return invalidMoneyPlan()
  }
  for (const field of fields) {
    if (owns(body, field) !== owns(raw.after, field)) return invalidMoneyPlan()
    if (!owns(raw.after, field)) continue
    const after = raw.after[field]
    if (after !== null && (typeof after !== 'number' || !Number.isFinite(after) || after < 0)) return invalidMoneyPlan()
    if (body[field] !== after || nextMoney(field, after, raw.kind === 'update' ? (raw.before as MoneyBefore)[field] : undefined) !== after) return invalidMoneyPlan()
  }
  return raw as unknown as MoneyPlan
}
/** New HTTP requests only. Never call this when replaying an old queued plan. */
export async function prepareProductMoneyWrite(env: Env, body: Record<string, unknown>, productId: number | null, expectedUpdatedAt?: string | null): Promise<void> {
  if (!isRecord(body)) throw new ProductMoneyWriteError('product_money_version_invalid', 'A product edit must be an object.', 400)
  if (owns(body, PRODUCT_MONEY_PLAN) || owns(body, PRODUCT_MONEY_VERSION)) {
    throw new ProductMoneyWriteError('product_money_version_invalid', 'Unsupported product price policy or client-supplied price plan.', 400)
  }
  const fields = PRODUCT_MONEY_FIELDS_V2.filter(field => owns(body, field))
  let before: MoneyBefore | null = null
  let groupRename = false
  if (productId != null) {
    const current = await getDb(env).prepare(`SELECT ${PRODUCT_MONEY_FIELDS_V2.join(',')}, updated_at, name FROM products WHERE id=@id`).get<MoneyBefore & { name: string | null }>({ id: productId })
    if (!current) throw new ProductMoneyWriteError('product_money_state_conflict', 'The product no longer exists.')
    const { name } = current
    before = current
    if (expectedUpdatedAt && String(current.updated_at || '').trim() !== expectedUpdatedAt) {
      throw new ProductMoneyWriteError('product_money_state_conflict', 'The product changed after the editor loaded. Refresh and submit a new edit.')
    }
    groupRename = body.__rename_scope === 'group' && body.name !== undefined && String(name || '').trim().toLowerCase() !== String(body.name).trim().toLowerCase()
  }
  const after: MoneyPlan['after'] = {}
  for (const field of fields) after[field] = nextMoney(field, body[field], before?.[field])
  if (groupRename) {
    if (fields.some(field => after[field] !== before![field])) {
      throw new ProductMoneyWriteError('product_money_group_rename_requires_separate_save', 'Save changed prices separately from a product-group rename.', 400)
    }
    for (const field of fields) { delete body[field]; delete after[field] }
  }
  for (const field of Object.keys(after) as ProductMoneyField[]) body[field] = after[field]
  let group: MoneyPlan['group_rename'] = null
  if (groupRename) {
    const from = String(before!.name || '').trim()
    const to = String(body.name).trim()
    const members = await getDb(env).prepare('SELECT * FROM products WHERE name_key=@key AND is_active=1 ORDER BY id LIMIT 501').all<Record<string, unknown>>({ key: from.toLowerCase() })
    const target_members = await getDb(env).prepare('SELECT * FROM products WHERE name_key=@key AND is_active=1 ORDER BY id LIMIT 501').all<Record<string, unknown>>({ key: to.toLowerCase() })
    if (members.length + target_members.length > 500 || groupSnapshotBytes(members, target_members) > 500_000) throw new ProductMoneyWriteError('product_group_plan_too_large', 'The product group is too large for a guarded rename.', 400)
    group = { from, to, members, target_members }
  }
  body[PRODUCT_MONEY_VERSION] = LATEST_PRODUCT_MONEY_POLICY_VERSION
  body[PRODUCT_MONEY_PLAN] = { version: LATEST_PRODUCT_MONEY_POLICY_VERSION, kind: productId == null ? 'create' : 'update', product_id: productId, before, after,
    group_rename: group } satisfies MoneyPlan
  readProductMoneyPlan(body)
}

export function hasProductMoneyPolicy(body: unknown): boolean {
  return isRecord(body) && (owns(body, PRODUCT_MONEY_VERSION) || owns(body, PRODUCT_MONEY_PLAN))
}

export const PRODUCT_SKIP_KEYS = new Set([
  'id', 'expectedUpdatedAt', 'expected_updated_at', 'updatedAt', 'updated_at',
  'client_request_id', 'device_name', 'device_tz', 'client_time',
  PRODUCT_MONEY_VERSION, PRODUCT_MONEY_PLAN,
])

export function nowIso() {
  return new Date().toISOString()
}

// Memoized per isolate by schemaProbe.ts -- was a fresh PRAGMA table_info()
// on every product write that needed to know which columns exist.
export async function tableColumns(env: Env, table: string): Promise<Set<string>> {
  return tableColumnSet(getDb(env), table)
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

export function buildInsertPayload(
  body: Record<string, unknown>,
  columns: Set<string>,
  required: Record<string, unknown> = {},
): Record<string, unknown> {
  const moneyPlan = readProductMoneyPlan(body)
  if (moneyPlan && moneyPlan.kind !== 'create') invalidMoneyPlan()
  const payload = { ...cleanPayload(body, columns), ...required }
  applySearchNormalizedColumns(payload, body, columns, true)
  if (columns.has('created_at') && payload.created_at == null) payload.created_at = nowIso()
  if (columns.has('updated_at') && payload.updated_at == null) payload.updated_at = nowIso()
  return Object.fromEntries(Object.entries(payload).filter(([key]) => columns.has(key)))
}

// Side-effect-free counterpart to insertRow. Stock sessions append this
// statement to the operation's single D1 batch instead of creating a product
// before the receipt is known to be durable.
export function planInsertRow(
  table: 'products',
  body: Record<string, unknown>,
  columns: Set<string>,
  required: Record<string, unknown> = {},
): { sql: string; params: Record<string, unknown> } {
  const payload = buildInsertPayload(body, columns, required)
  const keys = Object.keys(payload)
  if (!keys.length) throw new Error(`No writable ${table} fields were supplied`)
  const params = Object.fromEntries(keys.map((key, index) => [`value${index}`, payload[key]]))
  return {
    sql: `INSERT INTO "${table}" (${keys.map((key) => `"${key}"`).join(', ')}) VALUES (${keys.map((_key, index) => `@value${index}`).join(', ')})`,
    params,
  }
}

export async function insertRow(env: Env, table: string, body: Record<string, unknown>, required: Record<string, unknown> = {}) {
  const columns = await tableColumns(env, table)
  const payload = buildInsertPayload(body, columns, required)
  const keys = Object.keys(payload)
  // sql-bound-params: bounded by construction -- one parameter per COLUMN
  // of a single row, capped by the table's schema, not by any row count.
  const placeholders = keys.map(() => '?').join(', ')
  const result = await env.DB.prepare(`INSERT INTO "${table}" (${keys.map((key) => `"${key}"`).join(', ')}) VALUES (${placeholders})`)
    .bind(...keys.map((key) => payload[key]))
    .run()
  return result.meta?.last_row_id
}

export async function updateRow(env: Env, table: string, id: string | number, body: Record<string, unknown>) {
  const moneyPlan = readProductMoneyPlan(body)
  if (moneyPlan && (table !== 'products' || moneyPlan.kind !== 'update' || moneyPlan.product_id !== Number(id))) invalidMoneyPlan()
  const columns = await tableColumns(env, table)
  const payload = cleanPayload(body, columns)
  applySearchNormalizedColumns(payload, body, columns, false)
  if (columns.has('updated_at')) payload.updated_at = nowIso()
  const keys = Object.keys(payload).filter((key) => columns.has(key))
  if (!keys.length) return 0
  const assignments = keys.map((key) => `"${key}" = ?`).join(', ')
  const beforeKeys = moneyPlan ? [...moneyFields(moneyPlan.version), 'updated_at', 'name'] as const : []
  const guard = moneyPlan ? beforeKeys.map(field => ` AND "${field}" IS ?`).join('') : ''
  const statement = env.DB.prepare(`UPDATE "${table}" SET ${assignments} WHERE id = ?${guard}`)
    .bind(...keys.map((key) => payload[key]), id, ...(moneyPlan ? beforeKeys.map(field => moneyPlan.before![field]) : []))
  let result
  if (moneyPlan?.group_rename) {
    // No rename or audit happens before target admission. A failed target CAS
    // aborts the same batch before touching any sibling, including name-only races.
    const group = moneyPlan.group_rename
    const groupColumns = Object.keys(group.members[0])
    if (groupColumns.length !== columns.size || groupColumns.some(key => !columns.has(key))
      || [...group.members, ...group.target_members].some(member => Object.keys(member).sort().join(',') !== [...groupColumns].sort().join(','))) invalidMoneyPlan()
    const guardGroup = (name: string, members: Record<string, unknown>[]) => env.DB.prepare(`SELECT CASE WHEN
      (SELECT COUNT(*) FROM products WHERE name_key=? AND is_active=1)=?
      AND NOT EXISTS (SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS (
        SELECT 1 FROM products p WHERE ${groupColumns.map(key => `p."${key}" IS json_extract(expected.value,'$.${key}')`).join(' AND ')}
      )) THEN 1 ELSE json('product_money_state_conflict') END`)
      .bind(name.toLowerCase(), members.length, JSON.stringify(members))
    try {
      const results = await env.DB.batch([
        guardGroup(group.from, group.members),
        guardGroup(group.to, group.target_members),
        statement,
        env.DB.prepare(`SELECT CASE WHEN changes() > 0 THEN 1 ELSE json('product_money_state_conflict') END`),
        env.DB.prepare(`UPDATE products SET name = ?, updated_at = ? WHERE name_key = ? AND is_active = 1 AND id != ?`)
          .bind(group.to, payload.updated_at, group.from.toLowerCase(), id),
      ])
      result = results[2]
    } catch (error) {
      if (/malformed JSON|product_money_state_conflict/i.test(String(error))) throw new ProductMoneyWriteError('product_money_state_conflict', 'The product changed before the group rename. Submit a new edit.')
      throw error
    }
  } else result = await statement.run()
  if (moneyPlan && !result.meta?.changes) throw new ProductMoneyWriteError('product_money_state_conflict', 'The product changed after the price plan was prepared. Submit a new edit.')
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


export class ProductImageLimitError extends Error {
  readonly code = 'product_image_limit_exceeded'
  constructor(readonly limit: number, readonly supplied: number) {
    super(`A product can have at most ${limit} images; ${supplied} unique images were supplied.`)
    this.name = 'ProductImageLimitError'
  }
}

export function validateProductImageGallery(rawGallery: unknown, maxImages = MAX_IMAGES_PER_PRODUCT): string[] {
  const limit = Math.max(0, Math.floor(Number(maxImages) || 0))
  const gallery = sanitizeMediaList(rawGallery)
  if (gallery.length > limit) throw new ProductImageLimitError(limit, gallery.length)
  return gallery
}

// A non-admin editing a product that already has an admin-created 4/5-image
// gallery must not silently erase those extra images. Permit only a bounded
// reorder/removal of paths already stored; adding any new path still has to
// satisfy the normal three-image limit.
export function validatePreservedProductImageGallery(
  rawGallery: unknown,
  existingGallery: unknown,
  maxStoredImages: number,
): string[] | null {
  const gallery = sanitizeMediaList(rawGallery)
  const maxStored = Math.max(0, Math.floor(Number(maxStoredImages) || 0))
  if (gallery.length > maxStored) return null
  const existing = new Set(sanitizeMediaList(existingGallery))
  return gallery.every((path) => existing.has(path)) ? gallery : null
}

export async function syncProductImageGallery(
  env: Env,
  productId: number | string,
  rawGallery: unknown,
  maxImages = MAX_IMAGES_PER_PRODUCT,
): Promise<string[]> {
  const gallery = validateProductImageGallery(rawGallery, maxImages)
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
  // remains idempotent regardless of what day it's retried on. A retry may
  // find this stable lot inactive (for example, after it was emptied), so
  // the conflict branch explicitly reactivates the existing parent without
  // replacing its original received date or display identity. lot_code
  // (the operator-facing display)
  // is still the same date-derived code every other batch now gets (see
  // batchCode.ts's dateToBatchCode), so this default batch reads no
  // differently from one created through Receive Stock on day one.
  const params = {
    productId: id,
    batchKey,
    lotCode: dateToBatchCode(addedOn),
    notes: 'Default received date created with product',
    branchId: chosenBranchId,
    quantity: Math.max(0, Number(chosenBranchQty) || 0),
  }
  const statements = [{
    sql: `INSERT INTO product_batches (variant_product_id, batch_key, lot_code, received_at, is_active, notes, batch_number)
      VALUES (@productId, @batchKey, @lotCode, datetime('now'), 1, @notes, 1)
      ON CONFLICT(variant_product_id, batch_key) DO UPDATE SET is_active = 1`,
    params,
  }]
  if (chosenBranchId != null) {
    statements.push({
      // Resolve the stable id inside the same transaction that performs
      // the activation above. This closes the read/activation/write race:
      // a positive branch_batch_stock row is never written beneath an
      // inactive initial lot, while retries remain quantity-idempotent.
      sql: `INSERT INTO branch_batch_stock (batch_id, branch_id, quantity)
        SELECT id, @branchId, @quantity
        FROM product_batches
        WHERE variant_product_id = @productId AND batch_key = @batchKey AND is_active = 1
        ON CONFLICT(batch_id, branch_id) DO NOTHING`,
      params,
    })
  }
  await db.batch(statements)
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
  // products_image_only_show_vip (special_price_usd/khr) is GONE. The
  // 2026-09-04 ruling established that the "VIP" tier was the wholesale price
  // under a wrong name and deleted it; migration 0111 moved its values into
  // wholesale_price_* and zeroed special_price_*, so the grant would now only
  // expose two permanently-empty columns. Nothing is stranded by the removal:
  // 0 users and 0 roles held the permission when it was checked in production.
  // Wholesale price is its own grant, separate from selling price (Aug 28): an
  // org can expose the shelf price while keeping wholesale terms private, or
  // grant both for the "view everything, touch nothing" arrangement.
  products_image_only_show_wholesale: ['wholesale_price_usd', 'wholesale_price_khr'],
  products_image_only_show_barcode: ['barcode'],
  products_image_only_show_category: ['category'],
  products_image_only_show_brand: ['brand'],
  // low_stock_threshold rides along with stock rather than being its own
  // permission: it is not independently interesting, and without it a stock
  // figure cannot be coloured -- "12 in stock" says nothing about whether 12
  // is healthy or nearly out. Granting stock visibility without the number
  // that gives it meaning would be a distinction with no use.
  products_image_only_show_stock: ['stock_quantity', 'low_stock_threshold', 'out_of_stock_threshold'],
  // K6 (Part 387): per-branch quantities. `branch_stock` is not a table
  // column -- it is the array attachBranchStock() glues onto each row --
  // but the restriction runs AFTER attachment, so allowlisting the key is
  // the entire server change.
  products_image_only_show_branch_stock: ['branch_stock'],
}

/**
 * K6: lot/batch visibility for the image-only role. No product-row column
 * carries batches (the view fetches GET /api/batches?productId= on demand),
 * so this key lives outside IMAGE_ONLY_OPTIONAL_FIELDS -- it gates the
 * batches READ route (routes/batches.ts) and the drill button in
 * ProductsImageOnlyView.tsx. Listed here so the editor/preset/tests have
 * one authoritative set of every image-only grant.
 */
export const IMAGE_ONLY_EXTRA_GRANTS = ['products_image_only_show_batches'] as const

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
