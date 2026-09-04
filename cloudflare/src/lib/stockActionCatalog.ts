// Bounded D1 catalog bridge for the unified stock-action resolver.
// One import queue window enters; only matching catalog rows, the two
// logical branches, and their current stock are read. This avoids the old
// import anti-pattern of loading the entire catalog on every chunk.

import type { D1Compat } from './db'
import { buildInClause, chunkForBinding } from './sqlBinding'
import { normalizeSearchText } from './searchMatch'
import {
  getUnifiedStockMode,
  resolveUnifiedStockImportRows,
  type UnifiedStockCatalogProduct,
  type UnifiedStockResolvedRow,
} from './stockActionImport'

export type StockActionImportResult = {
  rowNumber: number
  action: 'create' | 'update' | 'skip' | 'error'
  identifier: string | null
  existingId: number | null
  message: string | null
  warnings?: Array<{ kind: 'stock_action_conflict'; message: string }>
  changes: Record<string, { from: unknown; to: unknown }>
  data: Record<string, unknown>
}

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

async function readCatalogProducts(
  db: D1Compat,
  rows: Array<Record<string, unknown>>,
): Promise<UnifiedStockCatalogProduct[]> {
  const barcodes = [...new Set(rows.map((row) => normalized(row.barcode)).filter(Boolean))]
  const names = [...new Set(rows.map((row) => normalizeSearchText(row.name)).filter(Boolean))]
  const found = new Map<number, UnifiedStockCatalogProduct>()

  const readMatches = async (columnSql: string, values: string[]) => {
    // @active is the one non-IN binding. chunkForBinding keeps every query
    // under D1's 100-variable limit even if this function is reused with a
    // larger-than-normal queue window.
    for (const slice of chunkForBinding(values, 1)) {
      const { sql, params } = buildInClause('v', slice)
      const matches = await db.prepare(`
        SELECT id, name, barcode, selling_price_usd, wholesale_price_usd, cost_price_usd
        FROM products
        WHERE is_active = @active AND ${columnSql} IN (${sql})
      `).all<UnifiedStockCatalogProduct>({ ...params, active: 1 })
      for (const product of matches) found.set(Number(product.id), product)
    }
  }

  await readMatches(`LOWER(TRIM(COALESCE(barcode, '')))`, barcodes)
  // name_normalized is indexed/search-maintained and acts only as a bounded
  // candidate prefilter; matchProduct still applies exact collapsed-name,
  // barcode and cost equality in JS (never fuzzy identity).
  await readMatches(`name_normalized`, names)
  const productIds = [...found.keys()]
  for (const slice of chunkForBinding(productIds, 0)) {
    const { sql, params } = buildInClause('p', slice)
    const batches = await db.prepare(`
      SELECT variant_product_id AS productId, batch_key, lot_code
      FROM product_batches
      WHERE is_active = 1 AND variant_product_id IN (${sql})
    `).all<{ productId: number; batch_key: string | null; lot_code: string | null }>(params)
    for (const batch of batches) {
      const product = found.get(Number(batch.productId))
      if (!product) continue
      const values = product.batch_keys || (product.batch_keys = [])
      for (const value of [batch.batch_key, batch.lot_code]) {
        const normalizedValue = normalized(value)
        if (normalizedValue && !values.includes(normalizedValue)) values.push(normalizedValue)
      }
    }
  }
  return [...found.values()]
}

function resultFromResolved(row: UnifiedStockResolvedRow): StockActionImportResult {
  const blocking = row.errors.length > 0 || !row.plan
  const messages = [...row.errors, ...row.conflicts]
  return {
    rowNumber: row.rowNumber,
    action: blocking ? 'error' : row.plan?.kind === 'create' ? 'create' : 'update',
    identifier: row.identifier || null,
    existingId: row.productId,
    message: messages.length ? messages.join(' ') : null,
    warnings: row.conflicts.map((message) => ({ kind: 'stock_action_conflict', message })),
    changes: {},
    data: row as unknown as Record<string, unknown>,
  }
}

export async function classifyUnifiedStockActions(
  db: D1Compat,
  rows: Array<Record<string, unknown> & { _rowNumber?: number }>,
  policyJson?: string | null,
): Promise<StockActionImportResult[]> {
  const products = await readCatalogProducts(db, rows)
  const branches = await db.prepare(`
    SELECT id, name FROM branches
    WHERE is_active = 1 AND LOWER(TRIM(name)) IN ('shop', 'warehouse')
    ORDER BY id ASC
  `).all<{ id: number; name: string }>()

  const productIds = products.map((product) => Number(product.id)).filter((id) => Number.isFinite(id) && id > 0)
  const branchIds = branches.map((branch) => Number(branch.id)).filter((id) => Number.isFinite(id) && id > 0)
  const currentStock: Array<{ productId: number; branchId: number; quantity: number }> = []
  if (productIds.length && branchIds.length) {
    // branchIds contains at most two values. Reserve both of those bindings
    // while slicing product IDs so this remains safely below D1's ceiling.
    for (const productSlice of chunkForBinding(productIds, branchIds.length)) {
      const productClause = buildInClause('p', productSlice)
      const branchClause = buildInClause('b', branchIds)
      const stock = await db.prepare(`
        SELECT product_id AS productId, branch_id AS branchId, quantity
        FROM branch_stock
        WHERE product_id IN (${productClause.sql}) AND branch_id IN (${branchClause.sql})
      `).all<{ productId: number; branchId: number; quantity: number }>({ ...productClause.params, ...branchClause.params })
      currentStock.push(...stock)
    }
  }

  return resolveUnifiedStockImportRows(rows, getUnifiedStockMode(policyJson), products, branches, currentStock)
    .map(resultFromResolved)
}
