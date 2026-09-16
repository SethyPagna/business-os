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
// reversals of one sale for one product are grouped by the branch they NAME
// (COALESCE(ri.branch_id, r.branch_id)) and APPORTIONED over the sale's branch
// lines: the named branch takes the reversal first, up to what it recognised,
// and the rest spreads over the capacity the other lines have left.
//
// Each COLUMN is apportioned against its OWN denominator -- units by the unit
// share, money by each line's share of the sale's net VALUE for the product,
// returned cost by its share of the COST. One share for all three is a defect
// in its own right: a $50 refund split by UNITS over a sale of 1 unit at $1
// and 1 unit at $99 puts $25 on the branch that took $1, and the per-branch
// cap then swallows the excess, so the branch rows read $0 and $74 against an
// unfiltered $50.
//
// UNITS carry one more rule on top: their spill is allocated by LARGEST
// REMAINDER, not proportionally. The Inventory list renders Net sold with no
// formatting at all, so a proportional split of a 2-unit reversal over a
// 3-and-2 branch sale would put "1.8" -- and off a less convenient share
// 1.7999999999999998 -- into a column that counts things. Whole units stay
// whole while every sold quantity is whole, and the total allocated is the
// same either way, so the partition below is untouched.
//
// What that buys, stated exactly rather than absolutely: the shares of ONE
// return group sum to 1, so for every column the branch rows add back up to
// the unfiltered row whenever the sale has a single return group, or every
// group's reversal fits inside the branch line it names -- which is every
// return the app writes against a sale it recognised. Past that lies the
// over-refund regime the residual caps below exist for: a reversal larger than
// the whole sale recognised clamps every branch row AND the unfiltered row to
// 0, so they still agree; two groups naming different branches that between
// them push more onto one line than that line recognised clamp separately and
// can differ by the excess. No scoping rule makes that arithmetic, and an
// unconditional invariant written here would simply be false.
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

  // ONE sold-side aggregate, written once and read twice: as the figures
  // themselves (`sold`, with the caller's branch filter applied) and -- with
  // that filter deliberately OFF -- as the denominators the apportionment
  // divides by. They have to be the same expression, or a branch's share would
  // be measured against a different number from the one it is subtracted from.
  const soldLinesSql = (scope: string, byBranch: boolean) => `
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
      WHERE ${scope}
      GROUP BY si.sale_id, si.product_id${byBranch ? ', si.branch_id' : ''}`

  // Every branch line of the sale for that product, NEVER branch-filtered,
  // with the sale's whole figure for the product beside each branch's share of
  // it -- in UNITS, in MONEY and in COST, because each column is apportioned
  // against its own denominator.
  const soldByBranch = `
        SELECT l.sale_id AS sale_id, l.product_id AS product_id, l.branch_id AS branch_id,
               l.qty_sold AS qty_sold, l.net_usd AS net_usd, l.net_khr AS net_khr,
               l.cogs_usd AS cogs_usd, l.cogs_khr AS cogs_khr,
               SUM(l.qty_sold) OVER (PARTITION BY l.sale_id, l.product_id) AS sale_qty,
               SUM(l.net_usd) OVER (PARTITION BY l.sale_id, l.product_id) AS sale_net_usd,
               SUM(l.net_khr) OVER (PARTITION BY l.sale_id, l.product_id) AS sale_net_khr,
               SUM(l.cogs_usd) OVER (PARTITION BY l.sale_id, l.product_id) AS sale_cogs_usd,
               SUM(l.cogs_khr) OVER (PARTITION BY l.sale_id, l.product_id) AS sale_cogs_khr
        FROM (${soldLinesSql(saleScope, true)}
        ) l`

  const returnScopeWhere = `WHERE ${saleScope}
          AND COALESCE(r.status, 'completed') <> 'cancelled'
          AND COALESCE(r.return_scope, 'customer') = 'customer'`
  const returnMeasures = `SUM(ri.quantity) AS qty_returned,
               SUM(${refundUsd}) AS refund_usd,
               SUM(${refundKhr}) AS refund_khr,
               SUM(CASE WHEN ${RESTOCKED_RETURN_LINE} THEN ri.cost_price_usd * ri.quantity ELSE 0 END) AS cogs_returned_usd,
               SUM(CASE WHEN ${RESTOCKED_RETURN_LINE} THEN ri.cost_price_khr * ri.quantity ELSE 0 END) AS cogs_returned_khr`
  const returnFrom = `FROM return_items ri
        ${returnIdsJoin}
        JOIN returns r ON r.id = ri.return_id
        JOIN sales s ON s.id = r.sale_id
        ${returnScopeWhere}`

  // The reversals of one sale for one product, grouped by the branch they
  // NAME -- COALESCE(ri.branch_id, r.branch_id), for the reason above.
  //
  // routes/returns.ts USUALLY writes return_items.branch_id, and leaves it
  // NULL whenever neither the line nor the request carried a branch: all five
  // of its insert paths resolve the column as `item.branch_id || <the
  // request's branch> || null` (routes/returns.ts:1397, :1921, :1944, :2173,
  // :2335). That is why the fallback is here -- the RETURN's own branch is the
  // name three of those paths already apply themselves, and it is the name
  // base 6e3abfea used too (the old returnScope / returnBranchClause in
  // routes/inventory.ts). Without it a NULL-branch line names nobody and
  // smears proportionally over branches that had nothing come back.
  const retGroupsSql = `
        SELECT r.sale_id AS sale_id,
               ri.product_id AS product_id,
               COALESCE(ri.branch_id, r.branch_id) AS named_branch,
               ${returnMeasures}
        ${returnFrom}
        GROUP BY r.sale_id, ri.product_id, COALESCE(ri.branch_id, r.branch_id)`

  // ONE return group's share of the branch line `sb`, for ONE column, against
  // that column's OWN denominator:
  //
  //   * `ownTake` -- the branch the group names absorbs the reversal first, up
  //     to what that branch recognised in this column: MIN(group, named);
  //   * `spill` -- whatever it cannot absorb spreads over the RESIDUAL capacity
  //     of the sale's branch lines: what each recognised, less what the step
  //     above already took from it. Dividing by residual capacity rather than
  //     by the whole is what keeps the spill off a branch line that is already
  //     full, where the cap further down would swallow it and the branch rows
  //     would stop adding up to the unfiltered row;
  //   * a group naming a branch that sold none of this product on this sale,
  //     or naming none at all, has named = 0, so the whole group spreads
  //     proportionally -- the plain apportionment.
  //
  // Applied to `qty_sold` this is the UNIT share; applied to `net_*` it is the
  // VALUE share, and to `cogs_*` the COST share. They are three different
  // splits of one return group and they have to be: multiplying a refund by
  // the unit share hands a branch money out of proportion to the value it
  // recognised, which is how a sale of 1 unit at $1 and 1 unit at $99 met a
  // $50 refund and reported $0 at one branch and $74 at the other against an
  // unfiltered $50.
  const ownTake = (groupCol: string, namedCol: string) =>
    `CASE WHEN sb.branch_id = rg.named_branch THEN MIN(${groupCol}, ${namedCol}) ELSE 0 END`
  const spill = (groupCol: string, namedCol: string, branchCol: string, saleCol: string) => {
    const take = `MIN(${groupCol}, ${namedCol})`
    return `CASE WHEN (${saleCol} - ${take}) > 0
                 THEN (${groupCol} - ${take}) * ((${branchCol}) - (${ownTake(groupCol, namedCol)})) / (${saleCol} - ${take})
                 ELSE 0 END`
  }
  const groupShare = (groupCol: string, namedCol: string, branchCol: string, saleCol: string) =>
    `(${ownTake(groupCol, namedCol)}) + ${spill(groupCol, namedCol, branchCol, saleCol)}`
  const refundUsdShare = groupShare('rg.refund_usd', 'rg.named_net_usd', 'sb.net_usd', 'sb.sale_net_usd')
  const refundKhrShare = groupShare('rg.refund_khr', 'rg.named_net_khr', 'sb.net_khr', 'sb.sale_net_khr')
  const cogsUsdShare = groupShare('rg.cogs_returned_usd', 'rg.named_cogs_usd', 'sb.cogs_usd', 'sb.sale_cogs_usd')
  const cogsKhrShare = groupShare('rg.cogs_returned_khr', 'rg.named_cogs_khr', 'sb.cogs_khr', 'sb.sale_cogs_khr')

  // UNITS are the one column that must not come out fractional. Money is money
  // and is money-formatted; a unit count is rendered raw by the Inventory list
  // (InventoryProductsSurface.tsx renders `metric(product, 'qty_sold')` with no
  // formatting at all), so a proportional split of a 2-unit reversal over a
  // 3-and-2 branch sale would put "Net sold 1.8" -- or, once the share is not a
  // clean fifth, 1.7999999999999998 -- in a column that counts things.
  //
  // So the spill is allocated in largest-remainder order: every branch line
  // takes the whole part of its share, then the remainder fills each line only
  // up to its residual capacity (branch_id breaks a tie). For ordinary whole
  // quantities, residual capacity and leftover are whole, so every allocation
  // stays whole. Fractional sale lines need the capacity-aware form: a one-unit
  // leftover can be covered by two residual capacities of 0.6 and 0.4, while a
  // one-unit-per-ranked-line implementation would reject both and lose the
  // return entirely. The cumulative fill below preserves the total in that
  // case without allocating more than a branch sold.
  const qtyOwn = ownTake('rg.qty_returned', 'rg.named_qty')
  const qtySpill = spill('rg.qty_returned', 'rg.named_qty', 'sb.qty_sold', 'sb.sale_qty')
  const qtyRem = 'rg.qty_returned - MIN(rg.qty_returned, rg.named_qty)'
  const qtyBase = `CAST((${qtySpill}) AS INTEGER)`
  const qtyCapacity = `MAX(0, (sb.qty_sold - (${qtyOwn})) - ${qtyBase})`
  const qtyFrac = `CASE WHEN ${qtyCapacity} > 0
                     THEN (${qtySpill}) - ${qtyBase} ELSE -1 END`
  const qtyAllocated = `part.own_qty + part.base_qty
               + MIN(part.residual_capacity,
                     MAX(0, part.leftover - COALESCE(part.capacity_before, 0)))`

  const retSql = branchScoped ? `
      SELECT part.sale_id AS sale_id, part.product_id AS product_id, part.branch_id AS branch_id,
             SUM(${qtyAllocated}) AS qty_returned,
             SUM(part.refund_usd) AS refund_usd,
             SUM(part.refund_khr) AS refund_khr,
             SUM(part.cogs_returned_usd) AS cogs_returned_usd,
             SUM(part.cogs_returned_khr) AS cogs_returned_khr
      FROM (
        SELECT share.sale_id AS sale_id, share.product_id AS product_id, share.branch_id AS branch_id,
               share.own_qty AS own_qty, share.base_qty AS base_qty,
               share.residual_capacity AS residual_capacity,
               share.refund_usd AS refund_usd, share.refund_khr AS refund_khr,
               share.cogs_returned_usd AS cogs_returned_usd, share.cogs_returned_khr AS cogs_returned_khr,
               share.rem_qty - SUM(share.base_qty) OVER (PARTITION BY share.sale_id, share.product_id, share.named_branch) AS leftover,
               SUM(share.residual_capacity) OVER (
                 PARTITION BY share.sale_id, share.product_id, share.named_branch
                 ORDER BY share.order_frac DESC, share.branch_id
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ) AS capacity_before
        FROM (
          SELECT rg.sale_id AS sale_id, rg.product_id AS product_id, sb.branch_id AS branch_id,
                 rg.named_branch AS named_branch,
                 (${qtyOwn}) AS own_qty,
                 (${qtyRem}) AS rem_qty,
                 ${qtyBase} AS base_qty,
                 ${qtyCapacity} AS residual_capacity,
                 ${qtyFrac} AS order_frac,
                 ${refundUsdShare} AS refund_usd,
                 ${refundKhrShare} AS refund_khr,
                 ${cogsUsdShare} AS cogs_returned_usd,
                 ${cogsKhrShare} AS cogs_returned_khr
          FROM (
            SELECT g.sale_id AS sale_id, g.product_id AS product_id, g.named_branch AS named_branch,
                   g.qty_returned AS qty_returned, g.refund_usd AS refund_usd, g.refund_khr AS refund_khr,
                   g.cogs_returned_usd AS cogs_returned_usd, g.cogs_returned_khr AS cogs_returned_khr,
                   COALESCE(nb.qty_sold, 0) AS named_qty,
                   COALESCE(nb.net_usd, 0) AS named_net_usd,
                   COALESCE(nb.net_khr, 0) AS named_net_khr,
                   COALESCE(nb.cogs_usd, 0) AS named_cogs_usd,
                   COALESCE(nb.cogs_khr, 0) AS named_cogs_khr
            FROM (${retGroupsSql}
            ) g
            LEFT JOIN (${soldLinesSql(saleScope, true)}
            ) nb ON nb.sale_id = g.sale_id AND nb.product_id = g.product_id AND nb.branch_id = g.named_branch
          ) rg
          JOIN (${soldByBranch}
          ) sb ON sb.sale_id = rg.sale_id AND sb.product_id = rg.product_id
        ) share
      ) part
      WHERE part.branch_id = @branchId
      GROUP BY part.sale_id, part.product_id, part.branch_id` : `
      SELECT r.sale_id AS sale_id, ri.product_id AS product_id,
             ${returnMeasures}
      ${returnFrom}
      GROUP BY r.sale_id, ri.product_id`

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
    FROM (${soldLinesSql(soldScope, branchScoped)}
    ) sold
    LEFT JOIN (${retSql}
    ) ret ON ret.sale_id = sold.sale_id AND ret.product_id = sold.product_id${branchScoped ? ' AND ret.branch_id = sold.branch_id' : ''}
    GROUP BY sold.product_id
  `
}
