// Owner (Sep 17, P10-17): "remaining column are only showing 0".
//
// Stock lives in two ledgers: `branch_stock` holds the product-level on-hand
// number every screen reads, and `branch_batch_stock` holds the per-lot slice.
// The sales history imported from the old system wrote the product ledger and
// never the lot ledger, so roughly 19.9k supplier lots carry a real received
// quantity, a lot-ledger total of zero, and no trace of ever having been
// touched at lot level -- no stamped inventory movement, no sale allocation.
//
// `COALESCE(bbs.qty, 0)` turned that absence into the number 0, and 0 in the
// Remaining column is a claim: "this lot sold out". It is not the truth. The
// truth is that the lot was never tracked at lot level, and the system does
// not know what is left of it.
//
// So the untracked case returns NULL, which every surface already renders as
// `--`. A lot that genuinely sold out keeps its honest 0: it has a lot-ledger
// row that went to zero through allocations or movements, and either of those
// traces disqualifies it from the untracked case.
//
// Both probes are covered by an index (`idx_inventory_movements_batch` from
// 0084, `idx_sale_item_batch_allocations_batch` from 0180), and every caller
// applies this to ONE PAGE of lots (<= 200 rows), never to a full-table
// aggregate -- the totals rows deliberately keep summing raw quantities.

/**
 * SQL expression for a lot's remaining quantity that distinguishes "sold out"
 * (0) from "never tracked at lot level" (NULL).
 *
 * @param batchAlias  alias of the `product_batches` row in the query
 * @param qtyExpr     expression holding the lot's summed `branch_batch_stock`
 *                    quantity for that row (typically a LEFT JOIN column)
 */
export function lotRemainingSql(batchAlias: string, qtyExpr: string): string {
  return `CASE
    WHEN COALESCE(${batchAlias}.received_quantity, 0) > 0
     AND COALESCE(${qtyExpr}, 0) = 0
     AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.batch_id = ${batchAlias}.id)
     AND NOT EXISTS (SELECT 1 FROM sale_item_batch_allocations a WHERE a.batch_id = ${batchAlias}.id)
    THEN NULL
    ELSE COALESCE(${qtyExpr}, 0)
  END`
}
