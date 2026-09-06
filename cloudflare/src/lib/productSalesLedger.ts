// Per-PRODUCT revenue / COGS, written ONCE.
//
// lib/salesAnalytics.ts is the kernel for the PERIOD figures (one row per
// window/bucket, measured over whole sales). This file is its per-product
// twin: the same four scoping clauses and the same non-negativity invariants,
// applied to sale_items/return_items so that "what did this product earn"
// cannot disagree with "what did the shop earn".
//
// WHY IT EXISTS (Sep 6 2026, audit finding sibling:F14). routes/inventory.ts
// carried FOUR hand-copied sales-minus-returns joins -- the products-list
// metric enrichment, the two GET /products paths and the GET /stats financial
// join -- and every one of them broke the kernel's rules in the same four
// ways, so the Inventory list could show a product with NEGATIVE revenue and a
// negative profit while inventory/ProductDetailModal.tsx, opened from that very
// row, clamped the same numbers with Math.max(0, ...) and showed 0. The owner
// rule (N6) is that a negative revenue/profit figure is a scoping defect to
// root-cause, never something to floor at display; the clamp in the pane was
// hiding four real defects:
//
//   1. RETURNS WERE SCOPED BY THE RETURN'S OWN DATE. `WHERE date(r.created_at)
//      BETWEEN ...` subtracted a refund from a window that never recognised the
//      sale it reverses -- clause 1 of the scoping rule, and the single largest
//      source of a negative period figure. A refund now reverses its sale in
//      THAT sale's bucket, because the return side joins through `sales` and is
//      filtered by the same clauses the sold side is (`JOIN sales s ON
//      s.id = r.sale_id`), exactly like the kernel's returnedCostSql. A return
//      whose sale is outside the window, or which carries no sale_id at all,
//      reverses nothing -- it has nothing in scope to reverse.
//   2. A CANCELLED SALE'S REFUND STILL CAME OFF. The sold side excluded
//      cancelled sales (recognizedExpr); the return side did not join `sales`
//      at all, so a return against a cancelled sale subtracted refund AND cost
//      from a sale that had contributed neither. Clause 2: a cancelled sale
//      contributes 0 on BOTH sides.
//   3. THE REFUND CAME OFF ON THE WRONG BASIS. Line revenue is net of the
//      sale's store and membership discounts; a refund is the line's CHARGED
//      price, which is not. Subtracting it whole removed that line's share of
//      the discounts a second time. It is now scaled by the sale's own
//      net/subtotal ratio -- the kernel's refundBasisExpr, per line.
//   4. NOTHING CAPPED THE REVERSAL. The kernel's netRefundExpr caps a refund at
//      the sale's own recognised value and floors that value at 0; neither
//      existed here, so one broken row could drag a product's whole figure
//      below zero. Both invariants are now per (sale, product) -- see
//      NON-NEGATIVITY below.
//
// A fifth fork, same shape: the restock test was a hand-written
// `ri.return_to_stock = 1`, while lib/returnsStock.ts's normalizeStockAction --
// which is what routes/returns.ts actually decides with -- reads
// `stock_action` first and falls back to the boolean. A line written as
// 'restock' with the legacy flag left at 0 put goods back on the shelf without
// taking their cost back out of COGS. RESTOCKED_RETURN_LINE is that rule in
// SQL and is now the only test used here.
//
// A SIXTH fork, and the one a cap could not close: A BRANCH SLICE DID NOT
// PARTITION THE LEDGER. Branch lives on the sale LINE, not on the sale row, so
// a sale can recognise one product at two branches while the customer return
// that reverses it names no line. Subtracting the whole return at each branch
// charged the same reversal twice: with 3 units at branch 1 and 2 at branch 2
// and two units brought back, branch 1 -- which had nothing come back -- read
// 1 unit and $10 instead of 3 and $30, and the two branch rows between them
// reversed more than the sale ever had. When `branchScoped` is set, each
// return line is now APPORTIONED over the sale's branch lines for the product:
// the branch the return itself names takes it first, capped at what that
// branch recognised, and whatever it cannot absorb spreads over the sale's
// other branch lines in proportion to what each recognised. The shares of one
// return line sum to exactly 1, so for every column
// `SUM over branches == the unfiltered figure`: slicing by branch partitions
// the ledger instead of duplicating its reversals.
//
// NON-NEGATIVITY, by construction rather than by clamp. Per (sale, product):
//   * net value is floored at 0 -- a line whose apportioned discounts exceed
//     its own charged total is a broken row, not negative income;
//   * the refund is capped at that same net value -- a reversal cannot take
//     back more than the line recognised;
//   * the returned QUANTITY is capped the same way. With the apportionment in
//     place this is a RESIDUAL guard, not the branch fix it was mistaken for:
//     the one case left is a return line that took back more units than the
//     sale recognised for the product at all -- an over-keyed refund, or a
//     line returned twice -- which no scoping rule can make arithmetic;
//   * COGS is floored at 0 after the restocked cost comes off -- the kernel's
//     `Math.max(0, costUsd - returnedCostUsd)`, which covers a returned line
//     whose cost snapshot is larger than the sold line's.
// Therefore `qty_sold >= 0`, `revenue_usd >= 0` and `cogs_usd >= 0` for every product, and
// `profit_usd = revenue_usd - cogs_usd` is negative ONLY when the product was
// genuinely sold below cost. That loss is real and stays visible: profit is not
// floored, here or in the kernel ("hiding it would be the same lie in the other
// direction"). It also makes all FOUR of inventory/ProductDetailModal.tsx's
// clamps -- `Math.max(0, ...)` over qty_sold, revenue_usd and cogs_usd, plus
// the `Math.max(0, revenue) - Math.max(0, cogs)` profit built on the last two
// -- provable no-ops rather than a second, disagreeing definition of the same
// four cells the Inventory list renders raw.
//
// DELIBERATELY NOT MIRRORED from the kernel: valuedSaleExpr. The kernel holds
// zero-subtotal receipts out of COGS because its revenue is derived from the
// sale HEADER, so an unvalued header recognises no revenue for the cost to sit
// against. Per-product revenue is derived from the LINE totals, which those
// receipts do carry, so the pair is already matched and dropping them would
// delete real line income instead of protecting it.
import { netSaleExpr, recognizedExpr, RESTOCKED_RETURN_LINE } from './salesAnalytics'

export type ProductSalesLedgerOptions = {
  /**
   * Restrict both sides to a `requested_ids(product_id)` CTE the CALLER
   * declares, so a paged endpoint enriches only the rows it returned.
   */
  requestedIds?: boolean
  /**
   * Scope the SALE LINE to @branchId, and APPORTION each return line across
   * the branch lines of the sale it reverses (see the share expression in the
   * builder).
   *
   * A per-line branch scope is not something the return side can inherit. The
   * kernel's CUSTOMER_REFUND_JOIN really does inherit its scope through
   * `sale_id`, because every clause it inherits -- recognition, the window --
   * is a property of the sale ROW. Branch is not: it lives on sale_items, so
   * one sale can recognise the same product at two branches while the return
   * that reverses it names no sale line at all. Joining the whole return onto
   * each branch's sold line subtracted it once PER BRANCH, which is how a
   * 3-unit branch-1 line met a 5-unit refund and reported "Net sold -2", and
   * how two branches could between them reverse more than the sale ever had.
   */
  branchScoped?: boolean
  /**
   * Extra clauses over the sale row (aliased `s`) -- the local-day window.
   * Applied to BOTH sides, which is what makes clause 1 hold.
   */
  saleClauses?: string[]
}

/** The sale's net value in KHR -- netSaleExpr's twin, floored the same way. */
function netSaleKhrExpr(p: string): string {
  return `MAX(0, COALESCE(${p}subtotal_khr, 0) - COALESCE(${p}discount_khr, 0) - COALESCE(${p}membership_discount_khr, 0))`
}

/** A line's share of one of the sale's whole-sale discounts. */
function apportionedExpr(lineCol: string, subtotalCol: string, discountSql: string): string {
  return `CASE WHEN COALESCE(${subtotalCol}, 0) > 0 THEN (${lineCol} / ${subtotalCol}) * (${discountSql}) ELSE 0 END`
}

/**
 * The kernel's refundBasisExpr, applied to ONE return line instead of a
 * pre-aggregated per-sale refund: the charged amount scaled onto the same net
 * basis the revenue it reverses is measured on. A sale with no subtotal has no
 * basis to scale against, so the refund passes through unscaled -- the money
 * did leave the till -- and the cap below still bounds it.
 */
function refundBasisLineExpr(lineCol: string, subtotalCol: string, netSql: string): string {
  return `CASE WHEN COALESCE(${subtotalCol}, 0) > 0
      THEN ${lineCol} * (${netSql} / COALESCE(${subtotalCol}, 0))
      ELSE ${lineCol} END`
}

/**
 * One aggregate row per product: `product_id`, `qty_sold`, the two apportioned
 * discount columns, `revenue_usd/khr` and `cogs_usd/khr`. Wrap it as a
 * subquery/CTE and read the columns off it; every caller in routes/inventory.ts
 * does, so the four surfaces cannot drift apart again.
 */
export function buildProductSalesLedgerSql(options: ProductSalesLedgerOptions = {}): string {
  const { requestedIds = false, branchScoped = false, saleClauses = [] } = options
  const soldIdsJoin = requestedIds ? 'JOIN requested_ids ids ON ids.product_id = si.product_id' : ''
  const returnIdsJoin = requestedIds ? 'JOIN requested_ids ids ON ids.product_id = ri.product_id' : ''
  // The sale-side predicate, shared verbatim by both halves apart from the
  // branch clause (which only the sale LINE can carry).
  const saleScope = [recognizedExpr('s.'), ...saleClauses].filter(Boolean).join(' AND ')
  const soldScope = [saleScope, branchScoped ? 'si.branch_id = @branchId' : ''].filter(Boolean).join(' AND ')
  const storeDiscountUsd = apportionedExpr('si.total_usd', 's.subtotal_usd', 'COALESCE(s.discount_usd, 0)')
  const storeDiscountKhr = apportionedExpr('si.total_khr', 's.subtotal_khr', 'COALESCE(s.discount_khr, 0)')
  const memberDiscountUsd = apportionedExpr('si.total_usd', 's.subtotal_usd', 'COALESCE(s.membership_discount_usd, 0)')
  const memberDiscountKhr = apportionedExpr('si.total_khr', 's.subtotal_khr', 'COALESCE(s.membership_discount_khr, 0)')
  const allDiscountUsd = apportionedExpr('si.total_usd', 's.subtotal_usd', 'COALESCE(s.discount_usd, 0) + COALESCE(s.membership_discount_usd, 0)')
  const allDiscountKhr = apportionedExpr('si.total_khr', 's.subtotal_khr', 'COALESCE(s.discount_khr, 0) + COALESCE(s.membership_discount_khr, 0)')
  const refundUsd = refundBasisLineExpr('ri.total_usd', 's.subtotal_usd', netSaleExpr('s.'))
  const refundKhr = refundBasisLineExpr('ri.total_khr', 's.subtotal_khr', netSaleKhrExpr('s.'))

  // ONE return line, never pre-aggregated: `named_branch` is the branch that
  // line was recorded against (routes/returns.ts writes return_items.branch_id
  // on every insert path), and the allocation below needs it per line.
  const returnLineColumns = `r.sale_id AS sale_id,
             ri.product_id AS product_id,
             ri.branch_id AS named_branch,
             ri.quantity AS qty_returned,
             ${refundUsd} AS refund_usd,
             ${refundKhr} AS refund_khr,
             CASE WHEN ${RESTOCKED_RETURN_LINE} THEN ri.cost_price_usd * ri.quantity ELSE 0 END AS cogs_returned_usd,
             CASE WHEN ${RESTOCKED_RETURN_LINE} THEN ri.cost_price_khr * ri.quantity ELSE 0 END AS cogs_returned_khr`
  const returnLineWhere = `WHERE ${saleScope}
          AND COALESCE(r.status, 'completed') <> 'cancelled'
          AND COALESCE(r.return_scope, 'customer') = 'customer'`

  // Every branch line of the sale for that product, NEVER branch-filtered,
  // with the sale's whole total for the product beside each branch's share of
  // it. This is the denominator the apportionment divides by, so it has to see
  // the branches the caller's scope excludes.
  const soldByBranch = `
        SELECT sale_id, product_id, branch_id, qty,
               SUM(qty) OVER (PARTITION BY sale_id, product_id) AS sale_qty
        FROM (
          SELECT si.sale_id AS sale_id, si.product_id AS product_id, si.branch_id AS branch_id,
                 SUM(si.quantity) AS qty
          FROM sale_items si
          ${soldIdsJoin}
          JOIN sales s ON s.id = si.sale_id
          WHERE ${saleScope}
          GROUP BY si.sale_id, si.product_id, si.branch_id
        ) sale_lines`

  // The share of ONE return line that belongs to the branch line `sb`.
  //
  //   * the branch the return names takes it, capped at what that branch
  //     recognised for this (sale, product) -- MIN(returned, that branch's
  //     units) -- and takes it whole when the sale has no other branch line to
  //     give the remainder to;
  //   * whatever the named branch could not absorb spreads over the sale's
  //     OTHER branch lines for the product, in proportion to what each
  //     recognised;
  //   * a return naming a branch that sold none of this product on this sale,
  //     or naming none at all, has named_qty 0, so the whole line spreads
  //     proportionally -- the plain apportionment.
  //
  // The shares of one return line therefore sum to exactly 1 across the sale's
  // branch lines, which is what makes the per-branch columns add back up to
  // the unfiltered ones.
  const namedShare = `CASE
              WHEN COALESCE(sb.sale_qty, 0) <= 0 THEN 0
              WHEN sb.sale_qty <= rl.named_qty THEN 1
              WHEN rl.qty_returned > 0 THEN MIN(rl.qty_returned, rl.named_qty) * 1.0 / rl.qty_returned
              ELSE rl.named_qty * 1.0 / sb.sale_qty
            END`
  const branchShare = `CASE
            WHEN COALESCE(sb.sale_qty, 0) <= 0 THEN 0
            WHEN sb.branch_id = rl.named_branch THEN (${namedShare})
            WHEN sb.sale_qty - rl.named_qty > 0 THEN (1 - (${namedShare})) * sb.qty * 1.0 / (sb.sale_qty - rl.named_qty)
            ELSE 0
          END`

  const retSql = branchScoped ? `
      SELECT rl.sale_id AS sale_id, rl.product_id AS product_id, sb.branch_id AS branch_id,
             SUM(rl.qty_returned * (${branchShare})) AS qty_returned,
             SUM(rl.refund_usd * (${branchShare})) AS refund_usd,
             SUM(rl.refund_khr * (${branchShare})) AS refund_khr,
             SUM(rl.cogs_returned_usd * (${branchShare})) AS cogs_returned_usd,
             SUM(rl.cogs_returned_khr * (${branchShare})) AS cogs_returned_khr
      FROM (
        SELECT ${returnLineColumns},
               COALESCE(sbn.qty, 0) AS named_qty
        FROM return_items ri
        ${returnIdsJoin}
        JOIN returns r ON r.id = ri.return_id
        JOIN sales s ON s.id = r.sale_id
        LEFT JOIN (${soldByBranch}
        ) sbn ON sbn.sale_id = r.sale_id AND sbn.product_id = ri.product_id AND sbn.branch_id = ri.branch_id
        ${returnLineWhere}
      ) rl
      JOIN (${soldByBranch}
      ) sb ON sb.sale_id = rl.sale_id AND sb.product_id = rl.product_id
      WHERE sb.branch_id = @branchId
      GROUP BY rl.sale_id, rl.product_id, sb.branch_id` : `
      SELECT rl.sale_id AS sale_id, rl.product_id AS product_id,
             SUM(rl.qty_returned) AS qty_returned,
             SUM(rl.refund_usd) AS refund_usd,
             SUM(rl.refund_khr) AS refund_khr,
             SUM(rl.cogs_returned_usd) AS cogs_returned_usd,
             SUM(rl.cogs_returned_khr) AS cogs_returned_khr
      FROM (
        SELECT ${returnLineColumns}
        FROM return_items ri
        ${returnIdsJoin}
        JOIN returns r ON r.id = ri.return_id
        JOIN sales s ON s.id = r.sale_id
        ${returnLineWhere}
      ) rl
      GROUP BY rl.sale_id, rl.product_id`

  return `
    SELECT sold.product_id AS product_id,
           -- Units carry the SAME residual cap as the money below. After the
           -- apportionment above, a branch is only offered the share of a
           -- reversal that belongs to it, so this bites on ONE case: a return
           -- line that took back more units than the sale recognised for the
           -- product at all (an over-keyed refund, or a line returned twice).
           -- Before the apportionment it also fired on ordinary branch-split
           -- sales, which is how "Net sold -2" reached the list.
           SUM(sold.qty_sold - MIN(sold.qty_sold, COALESCE(ret.qty_returned, 0))) AS qty_sold,
           SUM(sold.store_discount_usd) AS store_discount_usd,
           SUM(sold.store_discount_khr) AS store_discount_khr,
           SUM(sold.membership_discount_usd) AS membership_discount_usd,
           SUM(sold.membership_discount_khr) AS membership_discount_khr,
           -- The reversal is CAPPED at what this sale recognised for this
           -- product (netRefundExpr, per line), so revenue can never go below
           -- zero however the return was recorded.
           SUM(sold.net_usd - MIN(sold.net_usd, COALESCE(ret.refund_usd, 0))) AS revenue_usd,
           SUM(sold.net_khr - MIN(sold.net_khr, COALESCE(ret.refund_khr, 0))) AS revenue_khr,
           -- Goods back on the sellable shelf are not cost of goods SOLD,
           -- floored at zero so a reversal can never manufacture profit.
           SUM(MAX(0, sold.cogs_usd - COALESCE(ret.cogs_returned_usd, 0))) AS cogs_usd,
           SUM(MAX(0, sold.cogs_khr - COALESCE(ret.cogs_returned_khr, 0))) AS cogs_khr,
           -- The same figures BEFORE the return reversal, for the one surface
           -- the owner asked to keep gross (Z10, Aug 29 2026: the Inventory /
           -- Branch stat cards report revenue and COGS the way the Dashboard
           -- kernel's gross columns do and show refunds in the Returns card
           -- beside them, rather than quietly netting them off). Emitted from
           -- THIS builder so "gross" and "net" stay two readings of one
           -- population instead of two hand-copied joins.
           SUM(sold.net_usd) AS gross_revenue_usd,
           SUM(sold.net_khr) AS gross_revenue_khr,
           SUM(sold.cogs_usd) AS gross_cogs_usd,
           SUM(sold.cogs_khr) AS gross_cogs_khr
    FROM (
      SELECT si.sale_id AS sale_id,
             si.product_id AS product_id,
             si.branch_id AS branch_id,
             SUM(si.quantity) AS qty_sold,
             SUM(${storeDiscountUsd}) AS store_discount_usd,
             SUM(${storeDiscountKhr}) AS store_discount_khr,
             SUM(${memberDiscountUsd}) AS membership_discount_usd,
             SUM(${memberDiscountKhr}) AS membership_discount_khr,
             MAX(0, SUM(si.total_usd - ${allDiscountUsd})) AS net_usd,
             MAX(0, SUM(si.total_khr - ${allDiscountKhr})) AS net_khr,
             SUM(si.cost_price_usd * si.quantity) AS cogs_usd,
             SUM(si.cost_price_khr * si.quantity) AS cogs_khr
      FROM sale_items si
      ${soldIdsJoin}
      JOIN sales s ON s.id = si.sale_id
      WHERE ${soldScope}
      GROUP BY si.sale_id, si.product_id${branchScoped ? ', si.branch_id' : ''}
    ) sold
    LEFT JOIN (${retSql}
    ) ret ON ret.sale_id = sold.sale_id AND ret.product_id = sold.product_id${branchScoped ? ' AND ret.branch_id = sold.branch_id' : ''}
    GROUP BY sold.product_id
  `
}
