import type { D1Compat } from './db'

export const PRODUCT_HAS_STOCK_CODE = 'product_has_stock'
export const PRODUCT_HAS_STOCK_MESSAGE = 'Products with stock cannot be removed. Stock can only be added to products that have not been removed.'

export class ProductStatusUnsupportedError extends Error {
  readonly code = 'product_status_unsupported'
  readonly status = 409
  constructor() {
    super('Products do not have an active or inactive status. Remove the Active column or field and try again.')
    this.name = 'ProductStatusUnsupportedError'
  }
}

export function assertProductStatusInput(body: Record<string, unknown>): void {
  if (body.is_active != null && ![1, true, '1'].includes(body.is_active as number | boolean | string)) {
    throw new ProductStatusUnsupportedError()
  }
}

export class ProductStockGuardError extends Error {
  readonly code = PRODUCT_HAS_STOCK_CODE
  readonly status = 409
  constructor(readonly productIds: number[] = []) {
    super(PRODUCT_HAS_STOCK_MESSAGE)
    this.name = 'ProductStockGuardError'
  }
}

export function productStockGuardError(error: unknown): ProductStockGuardError | ProductStatusUnsupportedError | null {
  const seen = new Set<unknown>()
  let current = error
  while (current && !seen.has(current)) {
    if (current instanceof ProductStockGuardError || current instanceof ProductStatusUnsupportedError) return current
    seen.add(current)
    const message = current instanceof Error ? current.message : String(current)
    if (/\bproduct_has_stock\b/.test(message)) return new ProductStockGuardError()
    if (/\bproduct_status_unsupported\b/.test(message)) return new ProductStatusUnsupportedError()
    current = typeof current === 'object' && 'cause' in current ? current.cause : null
  }
  return null
}

export function productHasStockSql(alias = 'p'): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error('Invalid product SQL alias')
  return `(COALESCE(${alias}.stock_quantity,0)<>0
    OR EXISTS(SELECT 1 FROM branch_stock bs WHERE bs.product_id=${alias}.id AND bs.quantity<>0)
    OR EXISTS(SELECT 1 FROM product_batches pb JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id
      WHERE pb.variant_product_id=${alias}.id AND bbs.quantity<>0)
    OR EXISTS(SELECT 1 FROM damaged_stock_lots dl WHERE dl.product_id=${alias}.id AND dl.quantity_remaining<>0))`
}

function validIds(ids: readonly number[]): number[] {
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid product IDs')
  return [...new Set(ids)]
}

export function stockVisibleProductSql(alias = 'p', indexedActive = true): string {
  return `(${indexedActive ? '' : '+'}${alias}.is_active = 1 OR ${productHasStockSql(alias)})`
}

// The legacy bit records catalog removal; ordinary products have no availability status.
export function catalogProductSql(alias = 'p', indexed = true): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error('Invalid product SQL alias')
  return `${indexed ? '' : '+'}${alias}.is_active = 1`
}

export async function stockedProductIds(db: Pick<D1Compat, 'prepare'>, ids: readonly number[]): Promise<number[]> {
  const unique = validIds(ids)
  if (!unique.length) return []
  const rows = await db.prepare(`SELECT p.id FROM products p
    WHERE p.id IN (SELECT value FROM json_each(@productIds)) AND ${productHasStockSql()} ORDER BY p.id`)
    .all<{ id: number }>({ productIds: JSON.stringify(unique) })
  return rows.map(row => Number(row.id))
}

export async function assertProductsHaveNoStock(db: Pick<D1Compat, 'prepare'>, ids: readonly number[]): Promise<void> {
  const blocked = await stockedProductIds(db, ids)
  if (blocked.length) throw new ProductStockGuardError(blocked)
}

export async function assertProductsActive(db: Pick<D1Compat, 'prepare'>, ids: readonly number[]): Promise<void> {
  const unique = validIds(ids)
  if (!unique.length) return
  const rows = await db.prepare(`SELECT p.id FROM products p
    WHERE p.id IN (SELECT value FROM json_each(@productIds)) AND p.is_active IS NOT 1 ORDER BY p.id`)
    .all<{ id: number }>({ productIds: JSON.stringify(unique) })
  if (rows.length) throw new ProductStockGuardError(rows.map(row => Number(row.id)))
}

export function productStockGuardStatement(ids: readonly number[], mode: 'empty' | 'active' = 'empty') {
  const predicate = mode === 'empty' ? productHasStockSql() : 'p.is_active IS NOT 1'
  return {
    sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM products p
      WHERE p.id IN (SELECT value FROM json_each(@productIds)) AND ${predicate})
      THEN json_extract('[]','$[product_has_stock]') ELSE 1 END`,
    params: { productIds: JSON.stringify(validIds(ids)) },
  }
}
