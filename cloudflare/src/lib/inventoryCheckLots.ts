// The received dates ("batches") one product holds at one branch, for a count typed per received date (ic_lot_counts). It is read ON DEMAND: only when a person opens the count
// popover of a row, one request for that one product, never for the page. Nothing in the answer is cost, supplier or price: a batch is its id, received date, expiry, the batch
// identity printed on it (lot code, batch number) and the sellable units it holds at THIS branch.
//
// The rows are the ones a count line may name (inventory_check_lot_lines, createInventoryCheckLotSubmission): active batches that have a branch_batch_stock row at the branch, including
// one that holds 0 (units found on it are a count). The same ids and branch are what the submission's guards re-check inside its batch, so what is listed here is exactly what can be written.
import type { D1Compat } from './db'
import { getInventoryCheckAccess } from './inventoryCheckAccess'
import type { PermissionUser } from './permissions'

export type InventoryCheckLot = { batchId: number; receivedAt: string | null; expiry: string | null; lotCode: string | null; batchNumber: number | null; quantity: number }
export type InventoryCheckLotsAnswer = { productId: number; branchId: number; lots: InventoryCheckLot[]; /** More batches than one count may carry exist; only the first `limit` are listed. */ more?: true }

type LotRow = { id: number; received_at: string | null; expiry_date: string | null; lot_code: string | null; batch_number: number | null; quantity: number }

// Batches holding stock first, then the earliest expiry (an undated batch last), then the oldest received: the order the shelf is counted in. The first index of product_batches
// (variant_product_id, expiry_date, received_at, id) serves the seek by product; each batch's branch row is a unique-index step (batch_id, branch_id).
// CROSS JOIN fixes the order of the loops (product first): without table statistics, which production does not have, the planner drove from the branch's whole stock list (every batch at the
// branch, 73,746 rows read on the harness world for one product) instead of from the product's few batches (20 rows).
export const INVENTORY_CHECK_LOTS_SQL = `SELECT pb.id AS id, pb.received_at AS received_at, pb.expiry_date AS expiry_date, pb.lot_code AS lot_code, pb.batch_number AS batch_number, bbs.quantity AS quantity
  FROM product_batches pb
  CROSS JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id AND bbs.branch_id = @branchId
  WHERE pb.variant_product_id = @productId AND pb.is_active = 1
  ORDER BY (bbs.quantity > 0) DESC, (trim(COALESCE(pb.expiry_date,'')) = '') ASC, pb.expiry_date ASC, pb.received_at ASC, pb.id ASC
  LIMIT @limit`

const finite = (value: unknown): number => { const number = Number(value); return Number.isFinite(number) ? number : 0 }

/** The viewer's fields decide what exists for them: no stock field, no received-date field or no view right means no list (the count is then one total, as it always was). */
export async function readInventoryCheckLots(db: Pick<D1Compat, 'prepare'>, user: PermissionUser, input: { productId: number; branchId: number; limit: number }): Promise<InventoryCheckLotsAnswer> {
  const access = getInventoryCheckAccess(user)
  const empty = { productId: input.productId, branchId: input.branchId, lots: [] }
  if (!access.canView || !access.fields.stock || !access.fields.received) return empty
  const rows = await db.prepare(INVENTORY_CHECK_LOTS_SQL).all<LotRow>({ productId: input.productId, branchId: input.branchId, limit: input.limit + 1 })
  const lots = rows.slice(0, input.limit).map((row): InventoryCheckLot => ({ batchId: Number(row.id), receivedAt: row.received_at ?? null, expiry: row.expiry_date ? row.expiry_date : null,
    lotCode: row.lot_code ? String(row.lot_code) : null, batchNumber: row.batch_number === null || row.batch_number === undefined ? null : Number(row.batch_number), quantity: finite(row.quantity) }))
  return { ...empty, lots, ...(rows.length > input.limit ? { more: true as const } : {}) }
}
