// Bounded D1 catalog bridge for the unified stock-action resolver.
// One import queue window enters; only matching catalog rows, the two
// logical branches, and their current stock are read. This avoids the old
// import anti-pattern of loading the entire catalog on every chunk.

import type { D1Compat } from './db'
import { buildInClause, chunkForBinding } from './sqlBinding'
import { IMPORT_BRANCH_COLUMNS_SQL, importBranchRedirect, indexCanonicalImportBranches, type CanonicalImportBranchRow } from './importBranchAuthority'
import { normalizeSearchText } from './searchMatch'
import { identityBarcodeClassKey, identityBarcodeKeySql } from './productIdentity'
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
  warnings?: Array<{ kind: 'stock_action_conflict' | 'other'; message: string }>
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
  // CLASS-FOLDED (Sep 15 2026), not raw. A candidate the SQL never selects is
  // a candidate matchProduct can never fold in JS, so a barcode-only sheet
  // row written in the GTIN-14 form of a code the catalog stores as EAN-13
  // read as "no such product" and the import created the leading-zero twin
  // itself. A broken/short barcode never drives this prefilter on its own
  // (identityBarcodeClassKey folds it to '', filtered out below); the
  // name_normalized prefilter just underneath already brings in every
  // broken-barcode candidate of a matching name for matchProduct's wildcard
  // fold to consider.
  const barcodes = [...new Set(rows.map((row) => identityBarcodeClassKey(row.barcode)).filter(Boolean))]
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

  // identityBarcodeKeySql is the ONE SQL spelling of the fold (it lives beside
  // the JS one in productIdentity.ts and test-stock-session-identity-guard-pure.cjs
  // runs the two over the same fixtures), so both sides of this comparison fold
  // the same way and this stays a bounded, indexed-enough prefilter rather than
  // a third hand-copy of the rule.
  await readMatches(identityBarcodeKeySql('barcode'), barcodes)
  // name_normalized is indexed/search-maintained and acts only as a bounded
  // candidate prefilter; matchProduct still applies exact collapsed-name and
  // folded-barcode equality in JS (never fuzzy identity, and never cost --
  // cost stopped being identity on Sep 4 2026).
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
    warnings: [
      ...row.conflicts.map((message) => ({ kind: 'stock_action_conflict' as const, message })),
      // Columns that landed on one branch, shown before anything is saved
      // (informational: kind 'other' is not one of the serious kinds).
      // code + params let the review screen restate the note in the UI language; message is the English fallback.
      ...(row.branchNotes || []).map((message, index) => ({ kind: 'other' as const, message, ...(row.branchNoteDetails?.[index] ?? {}) })),
    ],
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
  // Every branch row (retired ones too): a sheet column names an identity
  // (shop / warehouse / store) that may now live on a successor branch.
  const branches = await db.prepare(`
    SELECT ${IMPORT_BRANCH_COLUMNS_SQL} FROM branches
    ORDER BY id ASC
  `).all<CanonicalImportBranchRow>()

  const productIds = products.map((product) => Number(product.id)).filter((id) => Number.isFinite(id) && id > 0)
  // Stock is read for the ACTIVE canonical branches only (at most two).
  const branchIds = [...indexCanonicalImportBranches(branches).byRole.values()].flat()
    .map((branch) => Number(branch.id)).filter((id) => Number.isFinite(id) && id > 0)
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

  return resolveUnifiedStockImportRows(rows, getUnifiedStockMode(policyJson), products, branches, currentStock, importBranchRedirect(policyJson, false))
    .map(resultFromResolved)
}
