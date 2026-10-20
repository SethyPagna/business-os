import { executeStockTransaction } from './stockTransaction'
// Ported from backend/src/helpers.ts's verifyAndRepairStockQuantities /
// verifyAndRepairSaleStatuses / verifyAndRepairCostPrices / runDataIntegrityCheck
// (the cost-price half is report-only now, see checkCostPrices).
//
// The original ran these inside a better-sqlite3 db.transaction() and, for
// the read-only "verify" mode, deliberately threw at the end to roll the
// transaction back -- a trick to get transactional isolation for a dry run.
// D1 has no synchronous, interleaved-read-then-write transaction like that
// (see lib/db.ts's D1Compat.batch() comment) -- so instead each check here
// is split into two phases:
//   1. computeXxx() -- pure reads, decides what *would* change. Always safe.
//   2. repair mode -- if repair=true, the decided writes are sent as one
//      D1Compat.batch() (atomic: all-or-nothing), built from step 1's
//      output. No interleaved read-during-write, matching the constraint
//      D1Compat.batch() documents.
// GET /verify-integrity calls these with repair=false (read-only, no writes
// at all). POST /repair-integrity calls them with repair=true.

import { getDb } from './db'
import { assertProductsActive, productStockGuardError, productStockGuardStatement } from './productStockGuard'
import type { Env } from '../index'

export type IntegrityResult = {
  errors: string[]
  repairs: number
  summary: string
}

async function checkStockQuantities(env: Env, repair: boolean): Promise<IntegrityResult> {
  const db = getDb(env)
  const errors: string[] = []
  const statements: Array<{ sql: string; params?: Record<string, unknown> }> = []
  const receivingProductIds: number[] = []

  try {
    const negativeRows = await db.prepare(`
      SELECT product_id, branch_id, quantity FROM branch_stock WHERE quantity < 0
    `).all<{ product_id: number; branch_id: number; quantity: number }>()

    for (const row of negativeRows) {
      errors.push(`Branch ${row.branch_id}, Product ${row.product_id}: negative branch stock ${repair ? 'clamped' : 'found'} from ${row.quantity} to 0`)
      statements.push({
        sql: 'UPDATE branch_stock SET quantity = 0 WHERE product_id = @product_id AND branch_id = @branch_id',
        params: { product_id: row.product_id, branch_id: row.branch_id },
      })
    }

    // Re-derive branch totals as if the clamp above had already applied, so
    // the product-total check below doesn't flag the same negative rows twice.
    const products = await db.prepare(`
      SELECT p.id, COALESCE(p.stock_quantity, 0) AS stock_quantity,
             COALESCE(SUM(CASE WHEN bs.quantity < 0 THEN 0 ELSE bs.quantity END), 0) AS branch_total
      FROM products p
      LEFT JOIN branch_stock bs ON bs.product_id = p.id
      GROUP BY p.id
    `).all<{ id: number; stock_quantity: number; branch_total: number }>()

    for (const prod of products) {
      const branchTotal = Math.max(0, Number(prod.branch_total || 0))
      const actual = Number(prod.stock_quantity || 0)
      if (Math.abs(actual - branchTotal) > 0.01) {
        if (branchTotal > Math.max(0, actual)) receivingProductIds.push(prod.id)
        errors.push(`Product ${prod.id}: stock ${repair ? 'corrected' : 'mismatched'} from ${actual} to ${branchTotal}`)
        statements.push({
          sql: "UPDATE products SET stock_quantity = @stock_quantity, updated_at = CURRENT_TIMESTAMP WHERE id = @id",
          params: { stock_quantity: branchTotal, id: prod.id },
        })
      }
    }

    if (repair && statements.length) {
      await assertProductsActive(db, receivingProductIds)
      await executeStockTransaction(db, receivingProductIds.length
        ? [productStockGuardStatement(receivingProductIds, 'active'), ...statements]
        : statements, 'retry')
    }
  } catch (e) {
    if (repair) throw productStockGuardError(e) || e
    const refusal = productStockGuardError(e)
    if (refusal) throw refusal
    errors.push(`Stock verification error: ${(e as Error).message}`)
  }

  return { errors, repairs: statements.length, summary: `${repair ? 'Verified and repaired' : 'Checked'} stock quantities: ${statements.length} ${repair ? 'repairs made' : 'issues found'}` }
}

// Return TAGS only (owner, 20 Oct 2026: a return never changes sale_status).
// The old check rewrote sale_status to returned/partial_return and so wiped a
// Not Paid sale's payment state; this one compares the return tag the sale
// reads (retired label or return_state) with the one its evidence gives --
// live customer return lines plus units an import recorded as returned, per
// line, as the returns writers derive it -- and repairs only return_state on
// a row without a retired label. One aggregate read over sales that carry a
// tag or any return evidence.
async function checkSaleStatuses(env: Env, repair: boolean): Promise<IntegrityResult> {
  const db = getDb(env)
  const errors: string[] = []
  const statements: Array<{ sql: string; params?: Record<string, unknown> }> = []

  try {
    const active = `COALESCE(r.status, 'completed') != 'cancelled' AND COALESCE(r.return_scope, 'customer') = 'customer'`
    const rows = await db.prepare(`
      SELECT id, sale_status, stored, expected FROM (
        SELECT s.id, s.sale_status,
          CASE s.sale_status WHEN 'returned' THEN 'full' WHEN 'partial_return' THEN 'partial' ELSE s.return_state END AS stored,
          CASE
            WHEN NOT EXISTS(SELECT 1 FROM returns r WHERE r.sale_id = s.id AND ${active})
              AND NOT EXISTS(SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND COALESCE(si.returned_quantity, 0) > 0) THEN NULL
            WHEN NOT EXISTS(SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND COALESCE((
              SELECT SUM(ri.quantity) FROM return_items ri JOIN returns r ON r.id = ri.return_id
              WHERE r.sale_id = s.id AND ${active} AND (ri.sale_item_id = si.id OR (ri.sale_item_id IS NULL AND ri.product_id = si.product_id))
            ), 0) + MAX(COALESCE(si.returned_quantity, 0), 0) < si.quantity) THEN 'full'
            ELSE 'partial' END AS expected
        FROM sales s
        WHERE COALESCE(s.sale_status, 'completed') != 'cancelled'
          AND (s.return_state IS NOT NULL OR s.sale_status IN ('partial_return', 'returned')
            OR EXISTS(SELECT 1 FROM returns r WHERE r.sale_id = s.id AND ${active})
            OR EXISTS(SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND COALESCE(si.returned_quantity, 0) > 0))
      ) WHERE stored IS NOT expected
    `).all<{ id: number; sale_status: string | null; stored: string | null; expected: string | null }>()

    for (const sale of rows) {
      const labelled = sale.sale_status === 'returned' || sale.sale_status === 'partial_return'
      errors.push(`Sale ${sale.id}: return tag ${repair && !labelled ? 'corrected' : 'mismatched'} from ${sale.stored ?? 'none'} to ${sale.expected ?? 'none'}${labelled ? ' (retired status word; the held normalization rewrites it)' : ''}`)
      if (!labelled) {
        statements.push({
          sql: "UPDATE sales SET return_state = @returnState WHERE id = @id AND COALESCE(sale_status, '') NOT IN ('partial_return', 'returned')",
          params: { returnState: sale.expected, id: sale.id },
        })
      }
    }

    if (repair && statements.length) await db.batch(statements)
  } catch (e) {
    if (repair) throw productStockGuardError(e) || e
    errors.push(`Sale status verification error: ${(e as Error).message}`)
  }

  return { errors, repairs: statements.length, summary: `${repair ? 'Verified and repaired' : 'Checked'} sale statuses: ${statements.length} ${repair ? 'repairs made' : 'issues found'}` }
}

// Cost prices are REPORTED here, never repaired. A missing snapshot is an
// UNKNOWN cost (owner, 14 Oct 2026: "if it is none, it should also be unknown.
// flag it.") and a recorded 0 is a real $0, so the old repair -- which wrote
// today's catalog cost over both a NULL and a real $0 snapshot -- invented
// history. The counts below are the flag; the way to resolve an unknown cost
// is to enter it, not to copy a later catalog price onto a past line.
async function checkCostPrices(env: Env, repair: boolean): Promise<IntegrityResult & { saleItemsUnknownCost: number; movementsUnknownCost: number }> {
  const db = getDb(env)
  const errors: string[] = []
  let saleItemsUnknownCost = 0
  let movementsUnknownCost = 0

  try {
    const saleItems = await db.prepare('SELECT COUNT(*) AS n FROM sale_items WHERE cost_price_usd IS NULL').get<{ n: number }>()
    saleItemsUnknownCost = Number(saleItems?.n || 0)
    const movements = await db.prepare(`
      SELECT COUNT(*) AS n FROM inventory_movements
      WHERE unit_cost_usd IS NULL AND movement_type IN ('sale', 'return')
    `).get<{ n: number }>()
    movementsUnknownCost = Number(movements?.n || 0)
  } catch (e) {
    errors.push(`Cost price verification error: ${(e as Error).message}`)
  }

  return {
    errors,
    repairs: 0,
    saleItemsUnknownCost,
    movementsUnknownCost,
    summary: `${repair ? 'Cost prices are never repaired' : 'Checked cost prices'}: ${saleItemsUnknownCost} sale lines and ${movementsUnknownCost} movements have an unknown cost (flagged, not filled)`,
  }
}

export async function runDataIntegrityCheck(env: Env, repair: boolean) {
  const stockCheck = await checkStockQuantities(env, repair)
  const statusCheck = await checkSaleStatuses(env, repair)
  const costCheck = await checkCostPrices(env, repair)

  const allErrors = [...stockCheck.errors, ...statusCheck.errors, ...costCheck.errors]
  const totalRepairs = stockCheck.repairs + statusCheck.repairs + costCheck.repairs

  return {
    healthy: allErrors.length === 0,
    errors: allErrors,
    repairs: totalRepairs,
    details: { stock: stockCheck, saleStatus: statusCheck, costPrices: costCheck },
    sale_items_unknown_cost: costCheck.saleItemsUnknownCost,
    movements_unknown_cost: costCheck.movementsUnknownCost,
    action: repair ? 'repair-and-verify' : 'verify-only',
    timestamp: new Date().toISOString(),
  }
}
