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
      await db.batch(receivingProductIds.length
        ? [productStockGuardStatement(receivingProductIds, 'active'), ...statements]
        : statements)
    }
  } catch (e) {
    const refusal = productStockGuardError(e)
    if (refusal) throw refusal
    errors.push(`Stock verification error: ${(e as Error).message}`)
  }

  return { errors, repairs: statements.length, summary: `${repair ? 'Verified and repaired' : 'Checked'} stock quantities: ${statements.length} ${repair ? 'repairs made' : 'issues found'}` }
}

async function checkSaleStatuses(env: Env, repair: boolean): Promise<IntegrityResult> {
  const db = getDb(env)
  const errors: string[] = []
  const statements: Array<{ sql: string; params?: Record<string, unknown> }> = []

  try {
    const sales = await db.prepare(`SELECT id, sale_status FROM sales WHERE sale_status NOT IN ('cancelled')`).all<{ id: number; sale_status: string }>()

    for (const sale of sales) {
      const saleItems = await db.prepare(`
        SELECT product_id, SUM(quantity) as total_qty FROM sale_items WHERE sale_id = @sale_id GROUP BY product_id
      `).all<{ product_id: number; total_qty: number }>({ sale_id: sale.id })
      if (saleItems.length === 0) continue

      const returnedItems = await db.prepare(`
        SELECT ri.product_id, SUM(ri.quantity) as total_qty
        FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
        WHERE r.sale_id = @sale_id AND COALESCE(r.status, 'completed') != 'cancelled'
        GROUP BY ri.product_id
      `).all<{ product_id: number; total_qty: number }>({ sale_id: sale.id })

      const returnedMap: Record<number, number> = {}
      for (const row of returnedItems) returnedMap[row.product_id] = row.total_qty

      const fullyReturned = saleItems.every((item) => (returnedMap[item.product_id] || 0) >= item.total_qty)
      const hasPartialReturn = returnedItems.length > 0 && !fullyReturned
      const correctStatus = fullyReturned ? 'returned' : hasPartialReturn ? 'partial_return' : sale.sale_status

      if (correctStatus !== sale.sale_status) {
        errors.push(`Sale ${sale.id}: status ${repair ? 'corrected' : 'mismatched'} from ${sale.sale_status} to ${correctStatus}`)
        statements.push({
          sql: 'UPDATE sales SET sale_status = @status WHERE id = @id',
          params: { status: correctStatus, id: sale.id },
        })
      }
    }

    if (repair && statements.length) await db.batch(statements)
  } catch (e) {
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
