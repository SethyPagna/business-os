// productSearchDoc.ts -- the stored search document of a product
// (products.search_doc, migration 0233) and the code that keeps it complete.
//
// The document is lib/searchCore.ts docTerms(name, brand): the same terms the
// admin pickers index in the browser, written once at product-write time so a
// server search is one FTS5 lookup (lib/productSearchDocQuery.ts) instead of a
// scan. Three mechanisms keep it correct, in order of how much they rely on
// callers:
//
//   1. WRITERS that know both name and brand set the columns in the same
//      statement (productSearchDocColumns): manual create/edit, bulk import,
//      stock-session product creation.
//   2. The products_search_doc_stale trigger nulls the document when name or
//      brand change in a statement that left it alone (the group rename
//      cascade, merges, undo appliers, restore snapshots, dated-count
//      inserts). A NULL document is "missing", never "wrong".
//   3. MISSING documents are matched in code, with the same core, for the few
//      rows that are missing (loadMissingSearchDocRows), and the scheduled
//      repairMissingSearchDocs rewrites them in bounded chunks.

import type { Env } from '../index'
import { getDb, type D1Compat } from './db'
import { ordinaryBusinessBatch } from './businessMaintenanceGuard'
import { SEARCH_DOC_VERSION } from './searchCore'
import { productSearchDocColumns } from './productSearchDocColumns'
import { getPlanLimits } from './planTier'

export { SEARCH_DOC_VERSION, productSearchDocColumns }

// More missing documents than this and the index path is not used at all
// (the legacy clause serves the search): matching them in code costs one
// read per missing row on every search, and a backlog that large means the
// backfill has not run yet.
export const MISSING_DOC_ROW_CAP = 50

export interface MissingSearchDocRow {
  id: number
  name: string | null
  brand: string | null
}

// Reads only the rows of the partial index (idx_products_search_doc_missing):
// at most `limit` rows, and zero when the catalog is complete.
export async function loadMissingSearchDocRows(db: D1Compat, limit = MISSING_DOC_ROW_CAP + 1): Promise<MissingSearchDocRow[]> {
  // INDEXED BY: without table statistics the planner prefers the broad
  // is_active index (every active product) over the partial one, which is the
  // difference between reading the missing rows and reading the catalog.
  return db.prepare(`SELECT id, name, brand FROM products INDEXED BY idx_products_search_doc_missing
    WHERE search_doc IS NULL AND is_active = 1 ORDER BY id LIMIT @limit`)
    .all<MissingSearchDocRow>({ limit })
}

export interface SearchDocRepairResult {
  repaired: number
  // True when the chunk was full, i.e. more rows may still be missing.
  more: boolean
}

// Rewrites up to `limit` missing documents. Each UPDATE is guarded on the
// name and brand it was computed from, so an edit that lands between the read
// and the write is never overwritten with a document for the old text.
export async function repairMissingSearchDocs(env: Env, limit?: number): Promise<SearchDocRepairResult> {
  const chunk = Math.max(1, Math.floor(limit ?? getPlanLimits(env).searchDocRepairChunk))
  const db = getDb(env)
  let rows: MissingSearchDocRow[]
  try {
    rows = await loadMissingSearchDocRows(db, chunk)
  } catch (error) {
    // The migration is not on this database yet: nothing to repair.
    if (/no such column: search_doc|no such index/i.test(String((error as Error)?.message || error))) return { repaired: 0, more: false }
    throw error
  }
  if (!rows.length) return { repaired: 0, more: false }
  const results = await ordinaryBusinessBatch(db, rows.map((row) => ({
    sql: `UPDATE products SET search_doc = @doc, search_doc_version = @version
          WHERE id = @id AND search_doc IS NULL AND name IS @name AND brand IS @brand`,
    params: { id: row.id, name: row.name, brand: row.brand, ...productDocParams(row) },
  })))
  const repaired = results.reduce((sum, result) => sum + Number(result?.meta?.changes ?? 0), 0)
  return { repaired, more: rows.length >= chunk }
}

function productDocParams(row: MissingSearchDocRow): { doc: string; version: number } {
  const columns = productSearchDocColumns(row.name, row.brand)
  return { doc: columns.search_doc, version: columns.search_doc_version }
}
