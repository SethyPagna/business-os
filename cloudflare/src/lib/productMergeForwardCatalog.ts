import type { BindParams } from './db'
import type { ProductMergeCaseSnapshot } from './productMergeSnapshot'
import type { ProductMergeKeeperChoice } from './undoAppliers'
import { planProductMergeCaseSnapshot, productMergeCaptureGuard } from './productMergeSnapshot'
import { canonicalProductBarcode, identityBarcodeKey, isRealBarcode, keeperFollowsBarcode } from './productIdentity'
import { MERGE_PRICE_FIELDS, mergePriceOverrides, parseMergeMoney, resolveProductMergeEconomics, type ProductMergeEconomics } from './productMerge'
import { RESOLVE_CHOICE_VALUE_COLUMNS, type ResolveChoiceValues } from './productResolveChoices'
import { roundMoney4 } from './moneyPrecision'

type Statement = { sql: string; params?: BindParams }
type RowRef = { section: string; index: number; id: number }
export type ProductMergeForwardCatalogOptions = {
  canChangeImages: boolean
  imageIds: readonly number[]
  updatedAt: string
  keeperChoice?: ProductMergeKeeperChoice
  economics?: ProductMergeEconomics
  reviewedFields?: ResolveChoiceValues
}

export function planProductMergeForwardCatalog(snapshot: ProductMergeCaseSnapshot, options: ProductMergeForwardCatalogOptions) {
  const sourceGuard = productMergeCaptureGuard(snapshot)
  const keeper = snapshot.canonicalProduct, loser = snapshot.duplicateProduct
  if (!keeper || !loser || keeper.id === loser.id || keeper.is_active !== 1 || loser.is_active !== 1
    || typeof options.canChangeImages !== 'boolean' || !Array.isArray(options.imageIds)
    || typeof options.updatedAt !== 'string' || !options.updatedAt.trim() || options.updatedAt.length > 64) throw new Error('merge_state_conflict')
  const decoded = planProductMergeCaseSnapshot(keeper.id, loser.id, []).decode(new Map([['capture', [{ data: sourceGuard.params.observedCapture, oversized: 0 }]]]))
  if (JSON.stringify(decoded) !== JSON.stringify({ ...snapshot, reparentedByTable: [] })) throw new Error('merge_snapshot_incomplete')
  const economics = options.keeperChoice?.economics ?? options.economics ?? resolveProductMergeEconomics([keeper, loser])
  if (!Array.isArray(economics.issues) || economics.issues.length || !economics.merged) throw new Error('merge_numeric_invalid')
  for (const value of Object.values(economics.merged)) {
    if (typeof value !== 'number' || parseMergeMoney(value).kind !== 'value') throw new Error('merge_numeric_invalid')
    roundMoney4(value!)
  }
  const merged = { ...economics.merged }
  const chosenCost = options.keeperChoice?.cost
  if (chosenCost !== undefined && (!chosenCost || typeof chosenCost !== 'object' || Array.isArray(chosenCost))) throw new Error('invalid_merge_cost')
  if (chosenCost) {
    for (const [field, value] of Object.entries(chosenCost)) {
      if (!['cost_price_usd', 'cost_price_khr'].includes(field)
        || (field !== 'cost_price_khr' || value !== null) && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error('invalid_merge_cost')
      if (value !== null) roundMoney4(value)
    }
    if (typeof chosenCost.cost_price_usd !== 'number') throw new Error('invalid_merge_cost')
    merged.cost_price_usd = chosenCost.cost_price_usd
    if (chosenCost.cost_price_khr != null) merged.cost_price_khr = chosenCost.cost_price_khr
  }
  const fields = options.keeperChoice?.fields ?? {}
  const reviewed = options.reviewedFields ?? {}
  const validateFields = (values: ResolveChoiceValues) => {
    for (const [field, value] of Object.entries(values)) {
      if (!(RESOLVE_CHOICE_VALUE_COLUMNS as readonly string[]).includes(field)) throw new Error('invalid_resolve_choices')
      if ((MERGE_PRICE_FIELDS as readonly string[]).includes(field)) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('invalid_resolve_choices')
        roundMoney4(value)
      } else if (value !== null && typeof value !== 'string') throw new Error('invalid_resolve_choices')
      if ((field === 'name' || field.endsWith('_normalized') || field === 'brand_compact') && typeof value !== 'string') throw new Error('invalid_resolve_choices')
      if (field === 'name' && !String(value).trim()) throw new Error('invalid_resolve_choices')
    }
  }
  validateFields(fields)
  validateFields(reviewed)
  const has = (values: object, key: string) => Object.prototype.hasOwnProperty.call(values, key)
  const sameBarcode = (a: unknown, b: unknown) => String(a ?? '').trim() === String(b ?? '').trim()
    || (isRealBarcode(a) && isRealBarcode(b) && identityBarcodeKey(a) === identityBarcodeKey(b))
  const chosenBarcode = has(fields, 'barcode') ? fields.barcode : undefined
  const swap = chosenBarcode !== undefined && sameBarcode(loser.barcode, chosenBarcode)
  const displaced = swap && String(keeper.barcode ?? '').trim()
    && String(keeper.barcode).trim() !== String(chosenBarcode ?? '').trim() ? keeper.barcode : null
  const keeperPatch: Record<string, unknown> = { barcode: options.keeperChoice?.follows
    ? keeperFollowsBarcode(keeper, loser) : has(reviewed, 'barcode') ? reviewed.barcode : canonicalProductBarcode([keeper, loser]), updated_at: options.updatedAt }
  for (const field of [...MERGE_PRICE_FIELDS, 'cost_price_usd', 'cost_price_khr'] as const) keeperPatch[field] = merged[field] ?? keeper[field] ?? 0
  Object.assign(keeperPatch, reviewed)
  for (const [field, value] of Object.entries(fields)) if (field !== 'barcode' || swap) keeperPatch[field] = value
  const loserPatch: Record<string, unknown> = displaced === null ? {} : { barcode: displaced, updated_at: options.updatedAt }
  const imagePaths = new Set(snapshot.canonicalImageRows.map(row => row.image_path))
  const additions = snapshot.duplicateImageRows.filter(row => {
    if (!row.image_path || imagePaths.has(row.image_path)) return false
    imagePaths.add(row.image_path)
    return true
  })
  const adoptedPrimary = keeper.image_path === null || keeper.image_path === ''
    ? loser.image_path || keeper.image_path : keeper.image_path
  if (!has(keeperPatch, 'image_path') && adoptedPrimary !== keeper.image_path) keeperPatch.image_path = adoptedPrimary
  const imageChanges = snapshot.duplicateImageRows.length > 0
    || (!String(keeper.image_path || '').trim() && Boolean(String(loser.image_path || '').trim()))
    || (has(keeperPatch, 'image_path') && String(keeperPatch.image_path || '') !== String(keeper.image_path || ''))
  if (imageChanges && !options.canChangeImages) throw Object.assign(new Error('image_permission_required'), { code: 'image_permission_required', status: 403 })
  if (options.imageIds.length !== additions.length || new Set(options.imageIds).size !== options.imageIds.length
    || options.imageIds.some(id => !Number.isSafeInteger(id) || id <= 0
      || [...snapshot.canonicalImageRows, ...snapshot.duplicateImageRows].some(row => row.id === id))) throw new Error('merge_state_conflict')
  const imageRows = additions.map((row, index) => ({ id: options.imageIds[index], product_id: keeper.id,
    image_path: row.image_path, sort_order: snapshot.canonicalImageRows.length + index, created_at: options.updatedAt }))
  const childRows = snapshot.childProductRows.map(row => ({ id: row.id, parent_id: row.id === keeper.id ? null : keeper.id, updated_at: options.updatedAt }))
  if (childRows.some(row => row.id === keeper.id)) keeperPatch.parent_id = null
  const promotionRows: Array<{ id: number; product_ids: string; updated_at: string }> = []
  for (const row of snapshot.promotionRuleRows) {
    let parsed: unknown
    try { parsed = JSON.parse(row.product_ids || '[]') } catch { continue }
    if (!Array.isArray(parsed) || !parsed.some(entry => Number(entry) === loser.id)) continue
    const seen = new Set<number>(), next: unknown[] = []
    for (const entry of parsed) {
      const mapped = Number(entry) === loser.id ? keeper.id : entry
      const id = Number(mapped)
      if (Number.isFinite(id)) { if (seen.has(id)) continue; seen.add(id) }
      next.push(mapped)
    }
    promotionRows.push({ id: row.id, product_ids: JSON.stringify(next), updated_at: options.updatedAt })
  }
  const write = (sql: string, params: BindParams): Statement => ({ sql, params })
  const patchProduct = (id: number, patch: Record<string, unknown>): Statement[] => Object.keys(patch).length ? [write(
    `UPDATE products SET ${Object.keys(patch).map(field => `${field}=@catalog_${field}`).join(',')} WHERE id=@catalog_product_id`,
    { catalog_product_id: id, ...Object.fromEntries(Object.entries(patch).map(([field, value]) => [`catalog_${field}`, value])) })] : []
  const admissionGuards: Statement[] = [sourceGuard]
  if (imageRows.length) admissionGuards.push(write(`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM product_images
    WHERE id IN (SELECT value FROM json_each(@catalog_image_ids))) THEN 1 ELSE json_extract('[1]','$[merge_state_conflict]') END`,
  { catalog_image_ids: JSON.stringify(options.imageIds) }))
  const statements: Statement[] = [...patchProduct(keeper.id, keeperPatch), ...patchProduct(loser.id, loserPatch)]
  if (imageRows.length) statements.push(write(`INSERT INTO product_images(id,product_id,image_path,sort_order,created_at)
    SELECT json_extract(value,'$.id'),@catalog_keeper,json_extract(value,'$.image_path'),json_extract(value,'$.sort_order'),@catalog_time
    FROM json_each(@catalog_rows)`, { catalog_keeper: keeper.id, catalog_time: options.updatedAt, catalog_rows: JSON.stringify(imageRows) }))
  if (snapshot.duplicateImageRows.length) statements.push(write('DELETE FROM product_images WHERE product_id=@catalog_loser', { catalog_loser: loser.id }))
  if (childRows.length) statements.push(write(`UPDATE products SET parent_id=(SELECT json_extract(value,'$.parent_id') FROM json_each(@catalog_children) WHERE json_extract(value,'$.id')=products.id),
    updated_at=@catalog_time WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(@catalog_children))`,
  { catalog_children: JSON.stringify(childRows), catalog_time: options.updatedAt }))
  if (promotionRows.length) statements.push(write(`UPDATE promotion_rules SET product_ids=(SELECT json_extract(value,'$.product_ids') FROM json_each(@catalog_promotions) WHERE json_extract(value,'$.id')=promotion_rules.id),
    updated_at=@catalog_time WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(@catalog_promotions))`,
  { catalog_promotions: JSON.stringify(promotionRows), catalog_time: options.updatedAt }))
  const refs = (section: string, rows: readonly { id: number }[]): RowRef[] => rows.map((row, index) => ({ section, index, id: row.id }))
  const priceOverrides = mergePriceOverrides(economics.merged, { ...reviewed, ...fields })
  const effects = { keeperPatch, loserPatch, imageRows, removedImageIds: snapshot.duplicateImageRows.map(row => row.id), childRows, promotionRows }
  const beforeRefs = {
    keeper: { section: 'canonicalProduct', index: 0, id: keeper.id }, loser: { section: 'duplicateProduct', index: 0, id: loser.id },
    keeperImages: refs('canonicalImages', snapshot.canonicalImageRows), loserImages: refs('duplicateImages', snapshot.duplicateImageRows),
    children: refs('childProducts', snapshot.childProductRows), promotions: refs('promotionRules', snapshot.promotionRuleRows),
  }
  const catalogBytes = new TextEncoder().encode(JSON.stringify({ beforeRefs, effects })).byteLength
  if (catalogBytes > 512 * 1024) throw new Error('merge_case_snapshot_limit')
  return { admissionGuards, statements, effects, beforeRefs, catalogBytes, imagesMoved: imageRows.length, imageChanges, priceOverrides,
    requiredPermissions: { image: imageChanges, priceEdit: priceOverrides.length > 0,
      productEdit: options.keeperChoice?.requiresProductEdit === true, acquisitionCostEdit: chosenCost !== undefined } }
}

export type ProductMergeForwardCatalogPlan = ReturnType<typeof planProductMergeForwardCatalog>
