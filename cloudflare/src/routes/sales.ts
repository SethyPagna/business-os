import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { chunkForBinding, selectInChunks } from '../lib/sqlBinding'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { hasPermission, hasAnyPermission } from '../lib/permissions'
import { assertUpdatedAtMatch, getExpectedUpdatedAt, writeConflictResponse, WriteConflictError } from '../lib/conflictControl'
import { bumpVersion } from '../lib/cache'
import { getSalesTotals } from '../lib/salesAnalytics'
import { decrementBatchStockStatement, decrementBatchStockStrictStatement, incrementBatchStockStatement } from '../lib/productBatches'
import { VALID_SALE_STATUSES, STOCK_DEDUCTED_STATUSES } from '../lib/salesStatus'
import { buildLikeAliasClause, tokenizeSearchTermGroups } from '../lib/searchMatch'
import { computeSaleTotals, round2 } from '../lib/saleTotals'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)

// Valid lifecycle values for sales.sale_status, and which of them hold stock
// deducted, now live in lib/salesStatus.ts -- used by both POST / (initial
// creation) and PATCH /:id/status (later transitions) so the two paths
// can't disagree about what "deducted" means for a given status, and by
// lib/importEngine.ts's sales import so a third copy doesn't drift too.

type SaleItemInput = {
  product_id?: number
  id?: number
  product_name?: string
  name?: string
  quantity: number
  applied_price_usd?: number
  applied_price_khr?: number
  branch_id?: number
  price_mode?: string
  product_discount_type?: string | null
  product_discount_label?: string | null
  product_discount_usd?: number
  product_discount_khr?: number
  // Manual, cashier-entered per-item discount (Tier 2 #1) -- see
  // migration 0007_sale_item_manual_discount.sql for column notes.
  // Reporting-only: applied_price_usd/khr (above) remain the authoritative
  // charged price used in all total calculations, so a client that omits
  // these fields (or sends inconsistent ones) can't corrupt sale totals.
  base_price_usd?: number
  base_price_khr?: number
  manual_discount_type?: string | null
  manual_discount_value?: number
  manual_discount_usd?: number
  manual_discount_khr?: number
  // Set only for products with active batch/expiry tracking (see
  // lib/productBatches.ts) -- the specific lot the cashier picked at
  // checkout. Absent/null for every other product, same as today.
  batch_id?: number | null
  batch_label?: string | null
  batch_expiry_date?: string | null
}

type NormalizedItem = Omit<SaleItemInput, 'branch_id'> & { product_id: number; quantity: number; branch_id: number | null }

// round2 now lives in lib/saleTotals.ts alongside the sale money math that
// depends on it, and is imported above -- one definition, so the route and
// the extracted totals can never round differently. Convention is unchanged:
// currency math stays in plain floats (this schema stores REAL, not
// fixed-point) and is rounded to cents/riel only at display time.

// Idempotency (client_request_id dedupe), same pattern as returns.ts: the
// sales table already has the column + a unique index
// (idx_sales_client_request_unique_pg), and the frontend already sends
// client_request_id on every POS checkout (see saleWriteTransport.ts) to
// guard against a retried submission after a timeout creating a second,
// duplicate sale. Reproduced inline rather than shared, matching returns.ts's
// own reasoning for keeping this as a two-line normalizer per file.
function normalizeClientRequestId(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  if (!normalized) return null
  return normalized.length > 120 ? normalized.slice(0, 120) : normalized
}

app.post('/', async (c) => {
  const db = getDb(c.env)
  // Real gap: this endpoint only checked requireAuth (any logged-in user).
  // Sale creation happens from two places -- POS checkout (frontend gates
  // page access on the 'pos' permission, see AppContext.tsx's
  // PAGE_PERMISSIONS) and, potentially, a manual entry from the Sales page
  // itself ('sales' permission) -- so either grant is accepted here rather
  // than requiring both.
  if (!hasAnyPermission(c.get('user'), ['pos', 'sales'])) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const body = await c.req.json<{
    items: SaleItemInput[]
    branch_id?: number
    cashier_id?: number
    cashier_name?: string
    customer_id?: number
    customer_membership_number?: string
    customer_name?: string
    customer_phone?: string
    customer_address?: string
    payment_method?: string
    payment_details?: Array<{
      method?: string
      amount_usd?: number | string
      amount_khr?: number | string
    }>
    payment_currency?: string
    exchange_rate?: number
    discount_usd?: number
    discount_khr?: number
    tax_usd?: number
    amount_paid_usd?: number
    amount_paid_khr?: number
    receipt_number?: string
    client_request_id?: string
    sale_status?: string
    // Membership/loyalty -- see MIGRATION.md POS section: these were being
    // computed and shown to the cashier by POS.tsx (checked out against the
    // customer's real balance) but never reached the database, so the
    // discount silently vanished from the recorded total and the points
    // "balance" (computed fresh from sales.membership_points_redeemed on
    // every lookup -- see portal.ts's summarizePoints) never saw the
    // redemption, letting the same points be redeemed again indefinitely.
    membership_discount_usd?: number
    membership_discount_khr?: number
    membership_points_redeemed?: number
    // Delivery -- same gap: is_delivery/delivery_contact_id/delivery_fee_*
    // are real columns on `sales` (0001_init.sql) and real POS UI state,
    // just never wired into this insert.
    is_delivery?: boolean | number
    delivery_contact_id?: number
    delivery_fee_usd?: number
    delivery_fee_khr?: number
    delivery_fee_paid_by?: string
  }>()

  const clientRequestId = normalizeClientRequestId(body.client_request_id)
  if (clientRequestId) {
    const existingSale = await db
      .prepare('SELECT id, receipt_number FROM sales WHERE client_request_id = ? LIMIT 1')
      .get<{ id: number; receipt_number: string }>([clientRequestId])
    if (existingSale) return c.json({ id: existingSale.id, receiptNumber: existingSale.receipt_number, duplicate: true })
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ error: 'Sale items required' }, 400)
  }

  // Cashier-selectable at checkout (POS.tsx's "Awaiting Payment" / "Awaiting
  // Delivery" flows) -- previously ignored, so the sale was always recorded
  // (and stock always deducted) as 'completed' regardless of what the
  // cashier actually picked.
  const saleStatus = body.sale_status ? String(body.sale_status) : 'completed'
  if (!VALID_SALE_STATUSES.includes(saleStatus)) {
    return c.json({ error: `Invalid sale_status. Must be one of: ${VALID_SALE_STATUSES.join(', ')}` }, 400)
  }
  const shouldDeductStock = STOCK_DEDUCTED_STATUSES.has(saleStatus)

  // ---- 1. Normalize + validate input shape (no DB access yet) ----
  const normalized: NormalizedItem[] = []
  for (let index = 0; index < body.items.length; index += 1) {
    const item = body.items[index]
    const productId = Number(item.product_id || item.id)
    if (!Number.isFinite(productId) || productId <= 0) {
      return c.json({ error: `Sale item #${index + 1} is missing a product` }, 400)
    }
    const quantity = Number(item.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return c.json({ error: `Sale item #${index + 1} has an invalid quantity` }, 400)
    }
    normalized.push({
      ...item,
      product_id: productId,
      quantity,
      branch_id: Number(item.branch_id || body.branch_id) || null,
    })
  }

  // ---- 2. Read current prices + stock (plain reads, before any writes) ----
  // Chunked for D1's 100-bound-parameter ceiling. A POS cart rarely has
  // 100 distinct products, but a wholesale/imported sale does, and the
  // failure mode is a rejected checkout, not a degraded one.
  const productIds = [...new Set(normalized.map((i) => i.product_id))]
  const products = await selectInChunks(productIds, 0, (chunk) => db
    .prepare(`SELECT id, name, selling_price_usd, selling_price_khr, cost_price_usd, cost_price_khr FROM products WHERE id IN (${chunk.map(() => '?').join(',')})`)
    .all<{ id: number; name: string; selling_price_usd: number; selling_price_khr: number; cost_price_usd: number; cost_price_khr: number }>(chunk))
  const productMap = new Map(products.map((p) => [p.id, p]))

  // D1's batch() is atomic but cannot branch mid-batch (see lib/db.ts) --
  // validate stock as a plain read first, exactly like the original
  // backend/src/routes/sales.ts's assertSaleStockAvailable does, *before*
  // building the atomic write batch below. Skipped entirely when this sale's
  // status won't deduct stock yet (e.g. 'awaiting_payment') -- matches
  // PATCH /:id/status's own wasStockDeducted/willStockBeDeducted gate below.
  //
  // Batched by branch (one query per distinct branch_id in this sale, not
  // one query per line item) -- a sale with, say, 15 line items previously
  // issued 15 sequential `branch_stock` round-trips to D1 here, one right
  // after another, purely to check availability, adding real latency to
  // every checkout. The common case (one branch per sale) now costs exactly
  // one query, matching the same IN(...) batching pattern already used just
  // above for the `products` lookup.
  const stockCheckItems = normalized.filter((item) => item.branch_id && shouldDeductStock)
  const stockByBranch = new Map<number, Map<number, number>>()
  const branchIdsNeedingStock = [...new Set(stockCheckItems.map((item) => item.branch_id as number))]
  for (const branchId of branchIdsNeedingStock) {
    const productIdsForBranch = [...new Set(
      stockCheckItems.filter((item) => item.branch_id === branchId).map((item) => item.product_id),
    )]
    // reservedParams = 1 for the `branch_id = ?` bound alongside the list.
    const stockRows = await selectInChunks(productIdsForBranch, 1, (chunk) => db
      .prepare(`SELECT product_id, quantity FROM branch_stock WHERE branch_id = ? AND product_id IN (${chunk.map(() => '?').join(',')})`)
      .all<{ product_id: number; quantity: number }>([branchId, ...chunk]))
    stockByBranch.set(branchId, new Map(stockRows.map((row) => [row.product_id, row.quantity])))
  }
  for (const item of stockCheckItems) {
    const available = stockByBranch.get(item.branch_id as number)?.get(item.product_id) || 0
    if (item.quantity > available) {
      const name = productMap.get(item.product_id)?.name || `product #${item.product_id}`
      return c.json({ error: `Insufficient stock for ${name}: requested ${item.quantity}, available ${available}` }, 409)
    }
  }

  // Batch stock check -- additional to the branch_stock check above, for
  // any line the cashier picked a specific batch for (see
  // lib/productBatches.ts for why this is a separate table, not folded
  // into the branch_stock check). A batch line still counts against the
  // branch_stock total above too, since branch_stock stays authoritative.
  const batchCheckItems = stockCheckItems.filter((item) => item.batch_id)
  if (batchCheckItems.length) {
    const batchIds = [...new Set(batchCheckItems.map((item) => item.batch_id as number))]
    const batchStockRows = await selectInChunks(batchIds, 0, (chunk) => db
      .prepare(`SELECT batch_id, branch_id, quantity FROM branch_batch_stock WHERE batch_id IN (${chunk.map(() => '?').join(',')})`)
      .all<{ batch_id: number; branch_id: number; quantity: number }>(chunk))
    const batchStockMap = new Map(batchStockRows.map((row) => [`${row.batch_id}:${row.branch_id}`, row.quantity]))
    for (const item of batchCheckItems) {
      const available = batchStockMap.get(`${item.batch_id}:${item.branch_id}`) || 0
      if (item.quantity > available) {
        const name = productMap.get(item.product_id)?.name || `product #${item.product_id}`
        return c.json({ error: `Insufficient batch stock for ${name}: requested ${item.quantity}, available ${available}` }, 409)
      }
    }
  }

  // ---- 2b. Resolve the customer (if any) and re-validate any points
  // redemption server-side. POS.tsx computes membershipInfo.points.balance
  // client-side from a portal lookup and clamps the redeem UI to it, but a
  // stale/replayed request must not be trusted -- recompute the same
  // earned/deducted/redeemed/rewarded balance portal.ts's summarizePoints
  // uses, scoped to this customer, right before spending it.
  const exchangeRate = Number(body.exchange_rate) || 4100
  let customer: { id: number; name: string | null; membership_number: string | null } | null = null
  if (body.customer_id) {
    customer = await db.prepare('SELECT id, name, membership_number FROM customers WHERE id = ?').get([body.customer_id]) || null
  } else if (body.customer_membership_number) {
    customer = await db.prepare('SELECT id, name, membership_number FROM customers WHERE lower(trim(membership_number)) = lower(trim(?))').get([body.customer_membership_number]) || null
  }

  const membershipPointsRedeemed = Math.max(0, Number(body.membership_points_redeemed) || 0)
  let membershipDiscountUsd = round2(Math.max(0, Number(body.membership_discount_usd) || 0))
  let membershipDiscountKhr = round2(Math.max(0, Number(body.membership_discount_khr) || 0))

  if (membershipPointsRedeemed > 0) {
    if (!customer) {
      return c.json({ error: 'A membership customer is required to redeem points' }, 400)
    }
    const settingsRows = await db.prepare(
      `SELECT key, value FROM settings WHERE key IN ('customer_portal_points_basis', 'customer_portal_points_per_usd')`,
    ).all<{ key: string; value: string }>()
    const settingsMap = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]))
    const pointsBasis = String(settingsMap.customer_portal_points_basis || 'usd').toLowerCase() === 'khr' ? 'khr' : 'usd'
    const pointsPerUsd = Number(settingsMap.customer_portal_points_per_usd) || 1
    const pointsPerKhr = pointsPerUsd > 0 && exchangeRate > 0 ? pointsPerUsd / exchangeRate : 0

    const salesAgg = await db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN COALESCE(sale_status, 'completed') NOT IN ('cancelled', 'awaiting_payment') THEN total_usd ELSE 0 END), 0) AS earned_usd,
         COALESCE(SUM(CASE WHEN COALESCE(sale_status, 'completed') NOT IN ('cancelled', 'awaiting_payment') THEN total_khr ELSE 0 END), 0) AS earned_khr,
         COALESCE(SUM(CASE WHEN COALESCE(sale_status, 'completed') NOT IN ('cancelled', 'awaiting_payment') THEN membership_points_redeemed ELSE 0 END), 0) AS redeemed
       FROM sales WHERE customer_id = ?`,
    ).get<{ earned_usd: number; earned_khr: number; redeemed: number }>([customer.id])
    const returnsAgg = await db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN COALESCE(status, 'completed') != 'cancelled' THEN total_refund_usd ELSE 0 END), 0) AS refund_usd,
         COALESCE(SUM(CASE WHEN COALESCE(status, 'completed') != 'cancelled' THEN total_refund_khr ELSE 0 END), 0) AS refund_khr
       FROM returns WHERE customer_id = ?`,
    ).get<{ refund_usd: number; refund_khr: number }>([customer.id])
    const rewardedAgg = await db.prepare(
      `SELECT COALESCE(SUM(reward_points), 0) AS rewarded FROM customer_share_submissions WHERE customer_id = ? AND status = 'approved'`,
    ).get<{ rewarded: number }>([customer.id])

    const earned = pointsBasis === 'khr' ? (salesAgg?.earned_khr || 0) * pointsPerKhr : (salesAgg?.earned_usd || 0) * pointsPerUsd
    const deducted = pointsBasis === 'khr' ? (returnsAgg?.refund_khr || 0) * pointsPerKhr : (returnsAgg?.refund_usd || 0) * pointsPerUsd
    const alreadyRedeemed = salesAgg?.redeemed || 0
    const rewarded = rewardedAgg?.rewarded || 0
    const balance = Math.max(0, earned - deducted - alreadyRedeemed + rewarded)

    if (membershipPointsRedeemed > balance + 0.005) {
      return c.json({ error: `Insufficient points balance: requested ${membershipPointsRedeemed}, available ${Math.floor(balance)}` }, 409)
    }
  } else {
    membershipDiscountUsd = 0
    membershipDiscountKhr = 0
  }

  // ---- 3. Calculate totals (pure computation, no I/O) ----
  let subtotalUsd = 0
  const priced = normalized.map((item) => {
    const product = productMap.get(item.product_id)
    const unitPriceUsd = Number(item.applied_price_usd ?? product?.selling_price_usd ?? 0)
    const lineTotalUsd = round2(unitPriceUsd * item.quantity)
    subtotalUsd += lineTotalUsd
    return {
      ...item,
      product_name: item.product_name || item.name || product?.name || `product #${item.product_id}`,
      unitPriceUsd,
      lineTotalUsd,
      costPriceUsd: Number(product?.cost_price_usd || 0),
      costPriceKhr: Number(product?.cost_price_khr || 0),
    }
  })
  const discountUsd = round2(Number(body.discount_usd) || 0)
  const discountKhr = round2(Number(body.discount_khr) || discountUsd * exchangeRate)
  const taxUsd = round2(Number(body.tax_usd) || 0)

  // Delivery scalars are resolved here, above the totals, because the
  // customer-paid portion of the fee is PART of the total. They used to be
  // computed further down next to the delivery_contacts lookup and so were
  // simply unavailable at total time -- see lib/saleTotals.ts for the two
  // bugs that caused and why this arithmetic now lives in one pure,
  // directly-tested function instead of inline here.
  const isDelivery = Boolean(body.is_delivery)
  const deliveryFeeUsd = round2(Number(body.delivery_fee_usd) || 0)
  const deliveryFeeKhr = Math.round(Number(body.delivery_fee_khr) || deliveryFeeUsd * exchangeRate)
  const deliveryFeePaidBy = String(body.delivery_fee_paid_by || 'customer')

  // Membership discount reduces the recorded total (previously dropped, so a
  // points-redeemed sale recorded more than the customer actually paid).
  const { totalUsd, totalKhr, amountPaidUsd, amountPaidKhr, changeUsd, changeKhr } = computeSaleTotals({
    subtotalUsd,
    discountUsd,
    membershipDiscountUsd,
    taxUsd,
    isDelivery,
    deliveryFeeUsd,
    deliveryFeePaidBy,
    exchangeRate,
    rawAmountPaidUsd: body.amount_paid_usd,
    rawAmountPaidKhr: body.amount_paid_khr,
  })
  const paymentDetails = Array.isArray(body.payment_details)
    ? body.payment_details
      .slice(0, 12)
      .map((detail) => ({
        method: String(detail?.method || '').trim().slice(0, 80),
        amount_usd: round2(Math.max(0, Number(detail?.amount_usd) || 0)),
        amount_khr: Math.round(Math.max(0, Number(detail?.amount_khr) || 0)),
      }))
      .filter((detail) => detail.method && (detail.amount_usd > 0 || detail.amount_khr > 0))
    : []
  const effectivePaymentDetails = paymentDetails.length
    ? paymentDetails
    : [{ method: String(body.payment_method || 'Cash').trim().slice(0, 80) || 'Cash', amount_usd: amountPaidUsd, amount_khr: amountPaidKhr }]
  const paymentMethod = Array.from(new Set(effectivePaymentDetails.map((detail) => detail.method))).join(' + ')
  const receiptNumber = body.receipt_number?.trim() || `RCP-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`

  // isDelivery / deliveryFeeUsd / deliveryFeeKhr / deliveryFeePaidBy are
  // computed with the totals above, since the customer-paid portion is part
  // of the sale total. Only the contact lookup (real I/O) stays here.
  let deliveryContact: { id: number; name: string | null; phone: string | null; area: string | null; address: string | null } | null = null
  if (isDelivery && body.delivery_contact_id) {
    deliveryContact = await db.prepare('SELECT id, name, phone, area, address FROM delivery_contacts WHERE id = ?').get([body.delivery_contact_id]) || null
  }

  // ---- 4. Insert the sale header (single statement -- see lib/db.ts's
  // batch() docs for why this can't be the same atomic unit as step 5) ----
  const branchRow = body.branch_id ? await db.prepare('SELECT name FROM branches WHERE id = ?').get<{ name: string }>([body.branch_id]) : null
  const saleInsert = await db
    .prepare(`
      INSERT INTO sales (
        receipt_number, client_request_id, cashier_id, cashier_name, branch_id, branch_name,
        customer_id, customer_name, customer_phone, customer_address,
        payment_method, payment_details, payment_currency, exchange_rate,
        subtotal_usd, subtotal_khr, discount_usd, discount_khr, tax_usd, tax_khr, total_usd, total_khr,
        amount_paid_usd, amount_paid_khr, change_usd, change_khr,
        membership_discount_usd, membership_discount_khr, membership_points_redeemed,
        is_delivery, delivery_contact_id, delivery_contact_name, delivery_contact_phone, delivery_contact_address,
        delivery_fee_usd, delivery_fee_khr, delivery_fee_paid_by,
        sale_status, created_at, updated_at
      ) VALUES (@receipt_number, @client_request_id, @cashier_id, @cashier_name, @branch_id, @branch_name,
        @customer_id, @customer_name, @customer_phone, @customer_address,
        @payment_method, @payment_details, @payment_currency, @exchange_rate,
        @subtotal_usd, @subtotal_khr, @discount_usd, @discount_khr, @tax_usd, @tax_khr, @total_usd, @total_khr,
        @amount_paid_usd, @amount_paid_khr, @change_usd, @change_khr,
        @membership_discount_usd, @membership_discount_khr, @membership_points_redeemed,
        @is_delivery, @delivery_contact_id, @delivery_contact_name, @delivery_contact_phone, @delivery_contact_address,
        @delivery_fee_usd, @delivery_fee_khr, @delivery_fee_paid_by,
        @sale_status, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `)
    .run({
      receipt_number: receiptNumber,
      client_request_id: clientRequestId,
      cashier_id: body.cashier_id || null,
      cashier_name: body.cashier_name || null,
      branch_id: body.branch_id || null,
      branch_name: branchRow?.name || null,
      customer_id: customer?.id || null,
      customer_name: body.customer_name || customer?.name || null,
      customer_phone: body.customer_phone || null,
      customer_address: body.customer_address || null,
      payment_method: paymentMethod,
      payment_details: JSON.stringify(effectivePaymentDetails),
      payment_currency: body.payment_currency || 'USD',
      exchange_rate: exchangeRate,
      subtotal_usd: round2(subtotalUsd),
      subtotal_khr: Math.round(subtotalUsd * exchangeRate),
      discount_usd: discountUsd,
      discount_khr: discountKhr,
      tax_usd: taxUsd,
      tax_khr: Math.round(taxUsd * exchangeRate),
      total_usd: totalUsd,
      total_khr: totalKhr,
      amount_paid_usd: amountPaidUsd,
      amount_paid_khr: amountPaidKhr,
      change_usd: changeUsd,
      change_khr: changeKhr,
      membership_discount_usd: membershipDiscountUsd,
      membership_discount_khr: membershipDiscountKhr,
      membership_points_redeemed: membershipPointsRedeemed,
      is_delivery: isDelivery ? 1 : 0,
      delivery_contact_id: deliveryContact?.id || null,
      delivery_contact_name: deliveryContact?.name || null,
      delivery_contact_phone: deliveryContact?.phone || null,
      delivery_contact_address: deliveryContact?.address || deliveryContact?.area || null,
      delivery_fee_usd: isDelivery ? deliveryFeeUsd : 0,
      delivery_fee_khr: isDelivery ? deliveryFeeKhr : 0,
      // Same resolved value the total was computed from -- re-deriving it
      // here would let the stored payer disagree with the charged total.
      delivery_fee_paid_by: deliveryFeePaidBy,
      sale_status: saleStatus,
    })
  const saleId = saleInsert.lastInsertRowid

  // ---- 5. Atomically write items + stock deduction + movement log.
  // If ANY of this fails, none of it is applied (D1 batch() semantics) --
  // and we then delete the orphaned sale header from step 4, so the caller
  // never sees a "sale" with no items. ----
  try {
    const statements: Array<{ sql: string; params: Record<string, unknown> }> = []
    // Index into `statements` of each item's own sale_items INSERT, in the
    // same order as `priced` -- D1's batch() returns one result per
    // statement (with meta.last_row_id for inserts), so this is how we find
    // out each sale_item's real id *after* the atomic batch below commits,
    // without being able to branch mid-batch (see lib/db.ts's batch() docs).
    // Only needed for lines with a batch_id -- see the allocation-recording
    // step after the batch commits.
    const saleItemStatementIndexByItemIndex: number[] = []
    for (const [itemIndex, item] of priced.entries()) {
      saleItemStatementIndexByItemIndex[itemIndex] = statements.length
      statements.push({
        sql: `INSERT INTO sale_items (
                sale_id, product_id, product_name, quantity, applied_price_usd, applied_price_khr,
                cost_price_usd, cost_price_khr, total_usd, total_khr, branch_id,
                price_mode, product_discount_type, product_discount_label, product_discount_usd, product_discount_khr,
                base_price_usd, base_price_khr, manual_discount_type, manual_discount_value, manual_discount_usd, manual_discount_khr,
                batch_id, batch_label, batch_expiry_date
              )
              VALUES (
                @sale_id, @product_id, @product_name, @quantity, @applied_price_usd, @applied_price_khr,
                @cost_price_usd, @cost_price_khr, @total_usd, @total_khr, @branch_id,
                @price_mode, @product_discount_type, @product_discount_label, @product_discount_usd, @product_discount_khr,
                @base_price_usd, @base_price_khr, @manual_discount_type, @manual_discount_value, @manual_discount_usd, @manual_discount_khr,
                @batch_id, @batch_label, @batch_expiry_date
              )`,
        params: {
          sale_id: saleId,
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: item.quantity,
          applied_price_usd: item.unitPriceUsd,
          applied_price_khr: Math.round(item.unitPriceUsd * exchangeRate),
          cost_price_usd: item.costPriceUsd,
          cost_price_khr: item.costPriceKhr,
          total_usd: item.lineTotalUsd,
          total_khr: Math.round(item.lineTotalUsd * exchangeRate),
          branch_id: item.branch_id,
          price_mode: item.price_mode || 'selling',
          product_discount_type: item.product_discount_type || null,
          product_discount_label: item.product_discount_label || null,
          product_discount_usd: Number(item.product_discount_usd) || 0,
          product_discount_khr: Number(item.product_discount_khr) || 0,
          // base_price defaults to the applied price itself when a client
          // doesn't send it (e.g. an older frontend build, or a direct API
          // caller) -- that reads as "no manual discount" rather than a
          // misleading base of 0, and keeps this purely additive.
          base_price_usd: Number(item.base_price_usd) || item.unitPriceUsd,
          base_price_khr: Number(item.base_price_khr) || Math.round(item.unitPriceUsd * exchangeRate),
          manual_discount_type: item.manual_discount_type || null,
          manual_discount_value: Number(item.manual_discount_value) || 0,
          manual_discount_usd: Number(item.manual_discount_usd) || 0,
          manual_discount_khr: Number(item.manual_discount_khr) || 0,
          batch_id: item.batch_id || null,
          batch_label: item.batch_label || null,
          batch_expiry_date: item.batch_expiry_date || null,
        },
      })
      if (item.batch_id && item.branch_id && shouldDeductStock) {
        // Strict (no MAX(0) clamp): under a race two sales can both pass the
        // plain-read availability check above, so the deduction itself is the
        // real guard -- an oversell of this lot violates branch_batch_stock's
        // CHECK(quantity >= 0) (migration 0058) and rolls the whole sale back.
        statements.push(decrementBatchStockStrictStatement(item.batch_id, item.branch_id, item.quantity))
      }
      if (item.branch_id && shouldDeductStock) {
        // Plain subtraction, NOT MAX(0, ...): the availability check at step 2
        // is a non-atomic read, so a concurrent sale of the last unit could
        // slip past it. branch_stock's CHECK(quantity >= 0) (migration 0058)
        // turns that race into a real constraint failure that aborts this
        // atomic batch -- the sale is rejected (see the catch below), never
        // silently clamped to 0 with stock quietly lost.
        // (The INSERT ... VALUES (..., 0) branch only fires when no row exists,
        // which the availability check already rejects for any positive qty.)
        statements.push({
          sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@product_id, @branch_id, 0)
                ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = branch_stock.quantity - @quantity`,
          params: { product_id: item.product_id, branch_id: item.branch_id, quantity: item.quantity },
        })
        statements.push({
          sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reference_id, user_id, user_name)
                VALUES (@product_id, @product_name, @branch_id, 'sale', @quantity, @unit_cost_usd, @unit_cost_khr, @reference_id, @user_id, @user_name)`,
          params: {
            product_id: item.product_id,
            product_name: item.product_name,
            branch_id: item.branch_id,
            quantity: -item.quantity,
            unit_cost_usd: item.costPriceUsd,
            unit_cost_khr: item.costPriceKhr,
            reference_id: saleId,
            user_id: body.cashier_id || null,
            user_name: body.cashier_name || null,
          },
        })
        // Keep products.stock_quantity (the all-branches rollup shown on the
        // Products page and used for low-stock checks) in lockstep with the
        // branch_stock deduction above. Previously only branch_stock moved on
        // a sale, so Products/Inventory pages kept showing pre-sale numbers
        // until something else happened to touch that product's row.
        statements.push({
          sql: `UPDATE products SET stock_quantity = MAX(0, stock_quantity - @quantity), updated_at = CURRENT_TIMESTAMP WHERE id = @product_id`,
          params: { product_id: item.product_id, quantity: item.quantity },
        })
      }
    }
    const batchResults = await db.batch(statements)

    // Record which batch each sale line actually drew from, now that we
    // know each sale_item's real id (from the batch's own results, matched
    // back up via saleItemStatementIndexByItemIndex). Deliberately a
    // second, non-atomic pass: stock is already correctly decremented by
    // the atomic batch above (that only ever needed batch_id/branch_id,
    // known up front) -- this is bookkeeping for reporting/returns, not
    // stock-accuracy-critical, so a failure here is logged and swallowed
    // rather than rolling back an otherwise-successful sale.
    const allocationItems = priced
      .map((item, itemIndex) => ({ item, itemIndex }))
      .filter(({ item }) => item.batch_id && item.branch_id)
    if (allocationItems.length) {
      try {
        const allocationStatements = allocationItems.map(({ item, itemIndex }) => {
          const statementIndex = saleItemStatementIndexByItemIndex[itemIndex]
          const saleItemId = Number(batchResults[statementIndex]?.meta?.last_row_id || 0)
          return {
            sql: `INSERT INTO sale_item_batch_allocations (sale_item_id, batch_id, branch_id, quantity, lot_code, expiry_date)
                  VALUES (@sale_item_id, @batch_id, @branch_id, @quantity, @lot_code, @expiry_date)`,
            params: {
              sale_item_id: saleItemId,
              batch_id: item.batch_id,
              branch_id: item.branch_id,
              quantity: item.quantity,
              lot_code: item.batch_label || null,
              expiry_date: item.batch_expiry_date || null,
            },
          }
        }).filter((statement) => Number(statement.params.sale_item_id) > 0)
        if (allocationStatements.length) await db.batch(allocationStatements)
      } catch (allocationError) {
        console.error('[sales] failed to record sale_item_batch_allocations (stock already deducted correctly)', allocationError)
      }
    }
  } catch (error) {
    // The atomic batch rolled back, so nothing here was applied; delete the
    // orphaned header written in step 4 so the caller never sees an itemless
    // sale.
    await db.prepare('DELETE FROM sales WHERE id = ?').run([saleId])
    const message = (error as Error).message || ''
    // A CHECK(quantity >= 0) failure means a concurrent sale consumed the
    // stock between this request's availability read and its write -- report
    // it as the same 409 an up-front shortage gets, not an opaque 500, so the
    // client retries/refreshes rather than treating it as a server fault.
    if (/CHECK constraint|constraint failed/i.test(message)) {
      return c.json({ error: 'Insufficient stock: another sale took the last units while this one was being recorded. Refresh and try again.', code: 'stock_conflict' }, 409)
    }
    return c.json({ error: `Failed to record sale items: ${message}` }, 500)
  }

  // Invalidate the 20s /api/products/search cache (see lib/cache.ts) so
  // Products/POS/Inventory pages reflect this sale's stock deduction
  // immediately instead of waiting out the TTL -- this write path deducts
  // products.stock_quantity above but wasn't bumping the version, so a
  // browsed-then-cached product list could show pre-sale stock for up to 20s.
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))

  return c.json({
    id: saleId,
    receiptNumber,
    subtotalUsd: round2(subtotalUsd),
    discountUsd,
    membershipDiscountUsd,
    membershipDiscountKhr,
    membershipPointsRedeemed,
    taxUsd,
    totalUsd,
    totalKhr,
    changeUsd,
    changeKhr,
    saleStatus,
    itemCount: priced.length,
  })
})

// PATCH /api/sales/:id/status -- change a sale's lifecycle status
// (completed / awaiting_payment / awaiting_delivery / cancelled / partial_return / returned).
//
// Ported from backend/src/routes/sales.ts's version of this route (this
// endpoint did not exist yet in this Worker -- POS "void sale" / "mark
// delivered" actions were hitting a 404 before this). Same simplified shape
// as POST / above: adjusts branch_stock directly and logs one
// inventory_movements row per item, rather than the batch/lot-allocation
// machinery the very original Node backend had. Statuses that hold stock
// deducted: 'completed' and 'awaiting_delivery'. Moving into one of those
// from a status that didn't deduct stock takes stock; moving out (to
// anything other than partial_return/returned, which are handled by the
// returns flow instead) restores it. Also keeps products.stock_quantity in
// sync, same as POST / above. (VALID_SALE_STATUSES / STOCK_DEDUCTED_STATUSES
// now declared once, at the top of the file, so POST / can share them.)

type SaleItemRow = {
  id: number
  product_id: number | null
  product_name: string | null
  quantity: number
  cost_price_usd: number | null
  cost_price_khr: number | null
  branch_id: number | null
  batch_id: number | null
}

app.patch('/:id/status', async (c) => {
  const db = getDb(c.env)
  const user = c.get('user')
  // Status transitions (void/refund/complete/etc.) are only reachable from
  // the Sales page (see Sales.tsx's updateSaleStatus caller), which is
  // itself gated on the 'sales' permission -- the API endpoint needs the
  // same gate, since a plain POS-only cashier should not be able to void or
  // refund a sale via direct API calls.
  if (!hasPermission(user, 'sales')) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const id = c.req.param('id')
  const body = await c.req.json<{ sale_status?: string; notes?: string; [key: string]: unknown }>().catch(() => ({} as Record<string, unknown>))
  const saleStatus = String(body.sale_status || '')

  if (!saleStatus || !VALID_SALE_STATUSES.includes(saleStatus)) {
    return c.json({ error: `Invalid status. Must be one of: ${VALID_SALE_STATUSES.join(', ')}` }, 400)
  }

  const sale = await db.prepare('SELECT * FROM sales WHERE id = ?').get<Record<string, unknown> & { id: number; sale_status: string | null; updated_at: string | null; branch_id: number | null }>([id])
  if (!sale) return c.json({ error: 'Sale not found' }, 404)

  try {
    assertUpdatedAtMatch('sale', sale, getExpectedUpdatedAt(body))
  } catch (error) {
    if (error instanceof WriteConflictError) {
      const { body: conflictBody, status } = writeConflictResponse(error)
      return c.json(conflictBody, status)
    }
    throw error
  }

  const oldStatus = sale.sale_status || 'completed'
  if (oldStatus === saleStatus) {
    return c.json({ id: Number(id), sale_status: saleStatus, updated_at: sale.updated_at || null })
  }

  const wasStockDeducted = STOCK_DEDUCTED_STATUSES.has(oldStatus)
  const willStockBeDeducted = STOCK_DEDUCTED_STATUSES.has(saleStatus)

  const items = await db.prepare('SELECT id, product_id, product_name, quantity, cost_price_usd, cost_price_khr, branch_id, batch_id FROM sale_items WHERE sale_id = ?').all<SaleItemRow>([id])

  // Stock check first (plain read), same validate-then-batch shape as
  // POST / above -- see lib/db.ts's batch() docs for why.
  if (!wasStockDeducted && willStockBeDeducted) {
    for (const item of items) {
      if (!item.product_id || !item.branch_id) continue
      const stockRow = await db.prepare('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = ?').get<{ quantity: number }>([item.product_id, item.branch_id])
      const available = stockRow?.quantity || 0
      if (item.quantity > available) {
        return c.json({ error: `Insufficient stock for ${item.product_name || `product #${item.product_id}`}: requested ${item.quantity}, available ${available}` }, 409)
      }
    }
  }

  const statements: Array<{ sql: string; params: Record<string, unknown> }> = []
  const updates = ['sale_status = @sale_status', 'updated_at = CURRENT_TIMESTAMP']
  const updateParams: Record<string, unknown> = { sale_status: saleStatus, id }
  if (body.notes !== undefined) {
    updates.push('notes = @notes')
    updateParams.notes = body.notes
  }
  statements.push({ sql: `UPDATE sales SET ${updates.join(', ')} WHERE id = @id`, params: updateParams })

  const reason = `Sale status changed from ${oldStatus} to ${saleStatus}`
  for (const item of items) {
    if (!item.product_id || !item.branch_id) continue
    if (!wasStockDeducted && willStockBeDeducted) {
      // Plain subtraction, not MAX(0, ...): same strictness as POST / above --
      // the availability read at line 683 is non-atomic, so branch_stock's
      // CHECK(quantity >= 0) (migration 0058) is what actually guarantees a
      // concurrent oversell rolls this transition back instead of clamping.
      statements.push({
        sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@product_id, @branch_id, 0)
              ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = branch_stock.quantity - @quantity`,
        params: { product_id: item.product_id, branch_id: item.branch_id, quantity: item.quantity },
      })
      statements.push({
        sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name)
              VALUES (@product_id, @product_name, @branch_id, 'sale', @quantity, @unit_cost_usd, @unit_cost_khr, @reason, @reference_id, @user_id, @user_name)`,
        params: {
          product_id: item.product_id,
          product_name: item.product_name,
          branch_id: item.branch_id,
          quantity: -item.quantity,
          unit_cost_usd: item.cost_price_usd || 0,
          unit_cost_khr: item.cost_price_khr || 0,
          reason,
          reference_id: id,
          user_id: user?.id ?? null,
          user_name: user?.name ?? null,
        },
      })
      statements.push({
        sql: `UPDATE products SET stock_quantity = MAX(0, stock_quantity - @quantity), updated_at = CURRENT_TIMESTAMP WHERE id = @product_id`,
        params: { product_id: item.product_id, quantity: item.quantity },
      })
    } else if (wasStockDeducted && !willStockBeDeducted && saleStatus !== 'partial_return' && saleStatus !== 'returned') {
      statements.push({
        sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@product_id, @branch_id, @quantity)
              ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = branch_stock.quantity + @quantity`,
        params: { product_id: item.product_id, branch_id: item.branch_id, quantity: item.quantity },
      })
      statements.push({
        sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name)
              VALUES (@product_id, @product_name, @branch_id, 'return', @quantity, @unit_cost_usd, @unit_cost_khr, @reason, @reference_id, @user_id, @user_name)`,
        params: {
          product_id: item.product_id,
          product_name: item.product_name,
          branch_id: item.branch_id,
          quantity: item.quantity,
          unit_cost_usd: item.cost_price_usd || 0,
          unit_cost_khr: item.cost_price_khr || 0,
          reason,
          reference_id: id,
          user_id: user?.id ?? null,
          user_name: user?.name ?? null,
        },
      })
      statements.push({
        sql: `UPDATE products SET stock_quantity = stock_quantity + @quantity, updated_at = CURRENT_TIMESTAMP WHERE id = @product_id`,
        params: { product_id: item.product_id, quantity: item.quantity },
      })
      // Mirror the branch_stock restore above into the batch this line was
      // sold from, if any -- otherwise voiding a sale would leave that
      // batch's remaining quantity permanently short by whatever was sold,
      // even though branch_stock (and the product's overall stock_quantity)
      // correctly went back up.
      if (item.batch_id) {
        statements.push(incrementBatchStockStatement(item.batch_id, item.branch_id, item.quantity))
        statements.push({
          sql: `UPDATE sale_item_batch_allocations SET released_at = datetime('now')
                WHERE sale_item_id = @sale_item_id AND batch_id = @batch_id AND released_at IS NULL`,
          params: { sale_item_id: item.id, batch_id: item.batch_id },
        })
      }
    }
  }

  try {
    await db.batch(statements)
  } catch (error) {
    const message = (error as Error).message || ''
    // Same race guard as POST /: a CHECK(quantity >= 0) failure means a
    // concurrent sale consumed the stock between the availability read above
    // and this write. The batch rolled back atomically (status unchanged, no
    // deduction), so just report the shortage as a 409 rather than a 500.
    if (/CHECK constraint|constraint failed/i.test(message)) {
      return c.json({ error: 'Insufficient stock to complete this sale: another sale took the last units first. Refresh and try again.', code: 'stock_conflict' }, 409)
    }
    throw error
  }
  await audit(c.env, user?.id ?? null, user?.name ?? null, 'update', 'sale', id, { oldStatus, newStatus: saleStatus })
  // Same cache-invalidation reasoning as POST / above -- a status change
  // here can deduct or restore stock.
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))

  const updated = await db.prepare('SELECT id, sale_status, updated_at FROM sales WHERE id = ?').get<{ id: number; sale_status: string; updated_at: string }>([id])
  return c.json(updated || { id: Number(id), sale_status: saleStatus })
})

// PATCH /api/sales/:id/customer -- attach/detach a customer or membership on
// an already-recorded sale (and mirror it onto any returns already linked
// to that sale, matching the original's dual-table update). Ported from
// backend/src/routes/sales.ts -- did not exist yet in this Worker.
app.patch('/:id/customer', async (c) => {
  const db = getDb(c.env)
  const user = c.get('user')
  // Same reasoning as PATCH /:id/status above -- only reachable from the
  // 'sales'-gated Sales page (Sales.tsx's attachSaleCustomer caller).
  if (!hasPermission(user, 'sales')) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const saleId = c.req.param('id')
  const body = await c.req.json<{ customerId?: number; membershipNumber?: string; clearAssignment?: boolean; [key: string]: unknown }>().catch(() => ({} as Record<string, unknown>))

  const sale = await db.prepare('SELECT * FROM sales WHERE id = ?').get<Record<string, unknown> & { id: number; customer_id: number | null; updated_at: string | null }>([saleId])
  if (!sale) return c.json({ error: 'Sale not found' }, 404)

  try {
    assertUpdatedAtMatch('sale', sale, getExpectedUpdatedAt(body))
  } catch (error) {
    if (error instanceof WriteConflictError) {
      const { body: conflictBody, status } = writeConflictResponse(error)
      return c.json(conflictBody, status)
    }
    throw error
  }

  const shouldClear = Boolean(body.clearAssignment)
  let customer: { id: number; name: string | null; membership_number: string | null; phone: string | null; address: string | null } | undefined
  if (!shouldClear) {
    if (body.customerId) {
      customer = await db.prepare('SELECT id, name, membership_number, phone, address FROM customers WHERE id = ?').get([body.customerId])
    } else {
      const membership = String(body.membershipNumber || '').trim()
      if (membership) {
        customer = await db.prepare('SELECT id, name, membership_number, phone, address FROM customers WHERE lower(trim(membership_number)) = lower(trim(?))').get([membership])
      }
    }
    if (!customer) return c.json({ error: 'Customer or membership number not found' }, 404)
  }

  await db.batch([
    {
      sql: `UPDATE sales SET customer_id = @customer_id, customer_name = @customer_name, customer_phone = @customer_phone, customer_address = @customer_address, updated_at = CURRENT_TIMESTAMP WHERE id = @id`,
      params: {
        customer_id: customer?.id ?? null,
        customer_name: customer?.name ?? null,
        customer_phone: customer?.phone ?? null,
        customer_address: customer?.address ?? null,
        id: saleId,
      },
    },
    {
      sql: `UPDATE returns SET customer_id = @customer_id, customer_name = @customer_name, updated_at = CURRENT_TIMESTAMP WHERE sale_id = @sale_id`,
      params: { customer_id: customer?.id ?? null, customer_name: customer?.name ?? null, sale_id: saleId },
    },
  ])

  await audit(c.env, user?.id ?? null, user?.name ?? null, 'update', 'sale', saleId, {
    previous_customer_id: sale.customer_id ?? null,
    next_customer_id: customer?.id ?? null,
    membership_number: customer?.membership_number ?? null,
    cleared: shouldClear,
  })

  const updated = await db.prepare('SELECT id, customer_id, customer_name, updated_at FROM sales WHERE id = ?').get<{ id: number; customer_id: number | null; customer_name: string | null; updated_at: string }>([saleId])
  return c.json({
    ...(updated || { id: Number(saleId) }),
    customer: customer
      ? { id: customer.id, name: customer.name || null, membership_number: customer.membership_number || null, phone: customer.phone || null, address: customer.address || null }
      : null,
  })
})

type SaleRow = {
  id: number
  branch_id: number | null
  customer_id: number | null
  cashier_id: number | null
  cashier_name: string | null
  customer_name: string | null
  customer_phone: string | null
  branch_name: string | null
  payment_method: string | null
  notes: string | null
  sale_status: string | null
  created_at: string
  discount_usd: number | null
  discount_khr: number | null
  membership_discount_usd: number | null
  membership_discount_khr: number | null
  total_usd: number | null
  total_khr: number | null
  [key: string]: unknown
}

// Shared search-clause builder for GET / and GET /stats below -- both
// used to build their own near-identical copy of this block by hand,
// which is exactly the kind of drift risk this file's own comments
// elsewhere warn about: GET /stats computing a *different* set of
// matching sales than GET / for the same query string would silently
// under- or over-count revenue relative to what the list view actually
// shows, with no error to signal the mismatch. One function, called by
// both routes, makes that impossible instead of relying on remembering
// to edit two places identically.
//
// Search now supports the same comma-separated OR/AND-groups syntax the
// product catalog search does (tokenizeSearchTermGroups: comma splits
// GROUPS, a space inside a group is ordinary word-spacing, not a group
// boundary) instead of the old flat "every space-split word must match,
// no grouping" version -- e.g. "RCP-1234, jane" now means "receipt
// RCP-1234 OR customer jane" rather than requiring both fragments on the
// same sale. No searchMode UI toggle exists on the Sales page yet (see
// Products.tsx's SearchModeToggle for that pattern) so this defaults to
// 'AND' -- matching Products' own default -- but still reads an optional
// searchMode query param so a future toggle can wire straight in without
// another backend change; flagged as a real, not-yet-built follow-up in
// progress.md rather than guessed at without a UI to drive it.
//
// Columns searched: every column the old flat version already covered
// (receipt_number, cashier_name, customer_name, customer_phone,
// branch_name, payment_method, notes, membership_number via the existing
// customers join, and sale_items.product_name) PLUS the real gap this
// session closes -- sale_items.sku (a real column that existed all along
// but was never actually searched) and, via a join from sale_items back
// to products on product_id, barcode and brand (neither sale_items nor
// return_items stores those directly -- they're snapshotted onto the
// products table, not copied onto the line-item row at sale time).
// Deliberately still a LIKE scan, not FTS5 -- see buildLikeAliasClause's
// own comment in lib/searchMatch.ts for why that's a considered choice
// for this table, not an oversight.
function buildSalesSearchWhere(query: Record<string, string>, params: Record<string, unknown>): string | undefined {
  const raw = query.search || query.q || ''
  const groups = tokenizeSearchTermGroups(raw)
  if (!groups.length) return undefined
  const mode = String(query.searchMode || query.search_mode || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'

  const flatColumns = [
    's.receipt_number',
    's.cashier_name',
    's.customer_name',
    's.customer_phone',
    's.branch_name',
    's.payment_method',
    's.notes',
    "COALESCE(c.membership_number, '')",
  ]
  const itemColumns = [
    'sis.product_name',
    "COALESCE(sis.sku, '')",
    "COALESCE(sip.barcode, '')",
    "COALESCE(sip.brand, '')",
  ]

  let groupIndex = 0
  const groupClauses = groups.map((words) => {
    let wordIndex = 0
    const wordClauses = words.map((word) => {
      const keyBase = `srch${groupIndex}_${wordIndex}`
      wordIndex += 1
      const flatClause = buildLikeAliasClause(word, flatColumns, params, `${keyBase}_f`)
      const itemClause = buildLikeAliasClause(word, itemColumns, params, `${keyBase}_i`)
      return `(${flatClause} OR EXISTS (
        SELECT 1 FROM sale_items sis
        LEFT JOIN products sip ON sip.id = sis.product_id
        WHERE sis.sale_id = s.id AND ${itemClause}
      ))`
    })
    groupIndex += 1
    return wordClauses.length > 1 ? `(${wordClauses.join(' AND ')})` : wordClauses[0]
  })
  const joiner = mode === 'OR' ? ' OR ' : ' AND '
  return groupClauses.length > 1 ? groupClauses.map((c) => `(${c})`).join(joiner) : groupClauses[0]
}

// GET /api/sales -- the real list/history/receipt-lookup endpoint (there is
// no separate GET /api/sales/:id in the actual app; a receipt is one row
// out of this same list, matched by search). The original does this with a
// single Postgres query using STRING_AGG / json_agg / json_build_object /
// a ::json cast -- none of which exist in SQLite. Ported as: one filtered
// query for the matching sales, then two follow-up queries (sale_items,
// a refund rollup from returns) grouped in JS, matching the app-side-join
// style already used throughout this migration.
app.get('/', async (c) => {
  const query = c.req.query()
  const user = c.get('user')
  // Listing/browsing sale history is the Sales page's own core feature
  // (gated on 'sales' in the frontend) -- a POS-only cashier shouldn't be
  // able to pull the full transaction history via direct API access either.
  if (!hasPermission(user, 'sales')) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const db = getDb(c.env)

  const where: string[] = ['1=1']
  const params: Record<string, unknown> = {}

  if (query.startDate) { where.push('date(s.created_at) >= @startDate'); params.startDate = query.startDate }
  if (query.endDate) { where.push('date(s.created_at) <= @endDate'); params.endDate = query.endDate }
  if (query.cashier) { where.push('s.cashier_name LIKE @cashier'); params.cashier = `%${query.cashier}%` }
  // Exact-id lookup -- there's still no separate GET /:id route (see this
  // file's own comment above), but a caller that already has a specific
  // sale id (e.g. the Fees form re-displaying an already-attached
  // sale_id on edit) needs a way to fetch that one row without it being
  // findable through the free-text `search` clause, which never matched
  // s.id at all. Comma-separated for parity with the other exact-match
  // filters below (userId, status).
  if (query.id) {
    const ids = String(query.id).split(',').map((v) => v.trim()).filter(Boolean).map((v) => Number(v)).filter((v) => Number.isFinite(v))
    if (ids.length === 1) {
      where.push('s.id = @saleId')
      params.saleId = ids[0]
    } else if (ids.length > 1) {
      const keys = ids.map((id, index) => {
        const key = `saleId${index}`
        params[key] = id
        return `@${key}`
      })
      where.push(`s.id IN (${keys.join(', ')})`)
    }
  }
  if (query.userId) {
    // Matches the original's isAdminControlUser check -- simplified to
    // username==='admin' or an explicit permissions.all flag, since role
    // management (role_code lookups against the roles table) isn't ported
    // yet. Disclosed simplification, not a silent behavior change: see
    // MIGRATION.md.
    const permissions = (() => { try { return JSON.parse(user?.permissions || '{}') } catch { return {} } })()
    const isAdmin = user?.username === 'admin' || permissions?.all === true
    if (!isAdmin) return c.json({ error: 'Administrator access required for cashier user filters.' }, 403)
    const userIds = String(query.userId).split(',').map((v) => v.trim()).filter(Boolean)
    if (userIds.length === 1) {
      where.push('s.cashier_id = @userId')
      params.userId = Number(userIds[0]) || userIds[0]
    } else if (userIds.length > 1) {
      const keys = userIds.map((id, index) => {
        const key = `userId${index}`
        params[key] = Number(id) || id
        return `@${key}`
      })
      where.push(`s.cashier_id IN (${keys.join(', ')})`)
    }
  }
  if (query.branchId) {
    where.push('(s.branch_id = @branchId OR EXISTS (SELECT 1 FROM sale_items sif WHERE sif.sale_id = s.id AND sif.branch_id = @branchId))')
    params.branchId = query.branchId
  }
  if (query.status) {
    const statuses = String(query.status).split(',').map((v) => v.trim()).filter(Boolean)
    if (statuses.length === 1) {
      where.push('s.sale_status = @status')
      params.status = statuses[0]
    } else if (statuses.length > 1) {
      const keys = statuses.map((status, index) => {
        const key = `status${index}`
        params[key] = status
        return `@${key}`
      })
      where.push(`s.sale_status IN (${keys.join(', ')})`)
    }
  }

  const searchClause = buildSalesSearchWhere(query, params)
  if (searchClause) where.push(searchClause)

  const limit = Math.min(Number.parseInt(String(query.limit || '100'), 10) || 100, 500)
  params.limit = limit

  const sales = await db.prepare(`
    SELECT s.*, c.membership_number AS customer_membership_number
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    WHERE ${where.join(' AND ')}
    ORDER BY s.created_at DESC
    LIMIT @limit
  `).all<SaleRow>(params)

  if (sales.length === 0) return c.json([])

  // `limit` above allows up to 500 sales, and D1 refuses a statement with
  // more than 100 bound parameters -- the Sales page's own list read was
  // one `?limit=101` away from the same crash GET /api/products hit.
  const saleIds = sales.map((s) => s.id)

  const itemRows = await selectInChunks(saleIds, 0, (chunk) => db.prepare(`
    SELECT si.*, b.name AS branch_name, p.barcode AS barcode, p.category AS category
    FROM sale_items si
    LEFT JOIN branches b ON b.id = si.branch_id
    LEFT JOIN products p ON p.id = si.product_id
    WHERE si.sale_id IN (${chunk.map(() => '?').join(',')})
    ORDER BY si.id ASC
  `).all<{ sale_id: number; [key: string]: unknown }>(chunk))
  const itemsBySale = new Map<number, unknown[]>()
  for (const row of itemRows) {
    if (!itemsBySale.has(row.sale_id)) itemsBySale.set(row.sale_id, [])
    itemsBySale.get(row.sale_id)!.push(row)
  }

  // GROUP BY sale_id, and every row for one sale lands in the chunk that
  // holds that sale's id -- so a chunked aggregate is still a complete
  // aggregate per sale, with no cross-chunk re-summing needed.
  const refundRows = await selectInChunks(saleIds, 0, (chunk) => db.prepare(`
    SELECT sale_id, COUNT(*) AS return_count, COALESCE(SUM(total_refund_usd), 0) AS refund_usd, COALESCE(SUM(total_refund_khr), 0) AS refund_khr
    FROM returns
    WHERE sale_id IN (${chunk.map(() => '?').join(',')}) AND COALESCE(status, 'completed') != 'cancelled' AND COALESCE(return_scope, 'customer') = 'customer'
    GROUP BY sale_id
  `).all<{ sale_id: number; return_count: number; refund_usd: number; refund_khr: number }>(chunk))
  const refundsBySale = new Map(refundRows.map((r) => [r.sale_id, r]))

  const payload = sales.map((sale) => {
    const refund = refundsBySale.get(sale.id)
    const refundUsd = refund?.refund_usd || 0
    const refundKhr = refund?.refund_khr || 0
    return {
      ...sale,
      items: itemsBySale.get(sale.id) || [],
      refund_usd: refundUsd,
      refund_khr: refundKhr,
      return_count: refund?.return_count || 0,
      total_discount_usd: (sale.discount_usd || 0) + (sale.membership_discount_usd || 0),
      total_discount_khr: (sale.discount_khr || 0) + (sale.membership_discount_khr || 0),
      net_total_usd: (sale.total_usd || 0) - refundUsd,
      net_total_khr: (sale.total_khr || 0) - refundKhr,
    }
  })

  return c.json(payload)
})

// GET /api/sales/stats -- Sales page header revenue figure. The list
// endpoint above caps results at `limit` (default 100, max 500), and
// Sales.tsx used to sum revenue over only that capped page -- correct for
// a small/default view, silently wrong (and silently *smaller* than
// reality, with no indication anything was cut off) once a filtered date
// range or search matched more rows than the cap. This computes the same
// "net_total_usd (fallback total_usd), excluding cancelled/awaiting_payment"
// revenue definition Sales.tsx already uses per-row, but as a single SQL
// aggregate over every matching row, not just the page that was fetched.
app.get('/stats', async (c) => {
  const query = c.req.query()
  // Matches GET / above -- same 'sales'-gated data, just aggregated.
  if (!hasPermission(c.get('user'), 'sales')) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const db = getDb(c.env)

  const where: string[] = ['1=1']
  const params: Record<string, unknown> = {}
  if (query.startDate) { where.push('date(s.created_at) >= @startDate'); params.startDate = query.startDate }
  if (query.endDate) { where.push('date(s.created_at) <= @endDate'); params.endDate = query.endDate }
  if (query.cashier) { where.push('s.cashier_name LIKE @cashier'); params.cashier = `%${query.cashier}%` }
  if (query.branchId) {
    where.push('(s.branch_id = @branchId OR EXISTS (SELECT 1 FROM sale_items sif WHERE sif.sale_id = s.id AND sif.branch_id = @branchId))')
    params.branchId = query.branchId
  }
  const searchClause = buildSalesSearchWhere(query, params)
  if (searchClause) where.push(searchClause)

  // buildSalesSearchWhere's item-side clause references `c.membership_number`
  // via the flat-columns list, so this query needs the same customers join
  // GET / already has -- without it, a search including a membership-number
  // term would silently 500 (unknown column c.membership_number) instead of
  // just finding zero matches, and revenue stats would disagree with the
  // list view for that exact query shape (the drift risk this shared
  // function was written to prevent in the first place).
  const rows = await db.prepare(`
    SELECT s.id, s.sale_status, s.total_usd
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    WHERE ${where.join(' AND ')}
  `).all<{ id: number; sale_status: string | null; total_usd: number | null }>(params)

  if (rows.length === 0) {
    return c.json({ total_count: 0, revenue_usd: 0, pending_revenue_usd: 0, truncated_in_list: false })
  }

  const revenueSaleIds = rows
    .filter((r) => !['cancelled', 'awaiting_payment'].includes(r.sale_status || 'completed'))
    .map((r) => r.id)
  // This list is EVERY matching sale (no LIMIT on the query above), so it
  // is unbounded by construction -- chunked, per-sale aggregate.
  const refundRows = await selectInChunks(revenueSaleIds, 0, (chunk) => db.prepare(`
    SELECT sale_id, COALESCE(SUM(total_refund_usd), 0) AS refund_usd
    FROM returns
    WHERE sale_id IN (${chunk.map(() => '?').join(',')}) AND COALESCE(status, 'completed') != 'cancelled' AND COALESCE(return_scope, 'customer') = 'customer'
    GROUP BY sale_id
  `).all<{ sale_id: number; refund_usd: number }>(chunk))
  const refundBySale = new Map(refundRows.map((r) => [r.sale_id, r.refund_usd || 0]))
  const rowsById = new Map(rows.map((r) => [r.id, r]))

  const revenueUsd = revenueSaleIds.reduce((sum, id) => {
    const row = rowsById.get(id)
    const refund = refundBySale.get(id) || 0
    return sum + ((row?.total_usd || 0) - refund)
  }, 0)
  const pendingRevenueUsd = rows
    .filter((r) => (r.sale_status || 'completed') === 'awaiting_payment')
    .reduce((sum, r) => sum + (r.total_usd || 0), 0)

  const listLimit = Math.min(Number.parseInt(String(query.limit || '100'), 10) || 100, 500)
  return c.json({
    total_count: rows.length,
    revenue_usd: round2(revenueUsd),
    pending_revenue_usd: round2(pendingRevenueUsd),
    // Tells the caller whether the list endpoint (with the same filters)
    // would have been cut off, so the UI can show "N+ more not shown" etc.
    truncated_in_list: rows.length > listLimit,
  })
})

// GET /api/sales/export -- accounting summary + detail rows for a date
// range, consumed by ExportModal.tsx (both "Preview Summary" and
// "Export CSV", the latter falling back to client-side CSV generation
// from this same JSON when the response isn't already a raw CSV string --
// see buildCsvFallback() there). This was a hardcoded-empty stub
// (`{ items: [], rows: [], totals: {} }`) that never matched the shape
// ExportModal actually reads (`period`/`summary`/`by_status`/`by_product`/
// `sales`), so both buttons silently showed nothing. No legacy version to
// port from -- the archived backend snapshot has the identical stub, not
// a real implementation -- so this is a fresh build against ExportModal's
// actual field usage, not a port.
app.get('/export', async (c) => {
  if (!hasPermission(c.get('user'), 'sales')) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const db = getDb(c.env)
  const query = c.req.query()

  const where: string[] = ['1=1']
  const params: Record<string, unknown> = {}
  if (query.startDate) { where.push('date(s.created_at) >= @startDate'); params.startDate = query.startDate }
  if (query.endDate) { where.push('date(s.created_at) <= @endDate'); params.endDate = query.endDate }
  if (query.branchId) { where.push('s.branch_id = @branchId'); params.branchId = query.branchId }

  const emptySummary = {
    total_transactions: 0,
    completed_transactions: 0,
    revenue_usd: 0,
    cogs_usd: 0,
    gross_profit_usd: 0,
    gross_margin_pct: 0,
    total_discounts_usd: 0,
    total_tax_usd: 0,
    total_delivery_usd: 0,
    total_refunds_usd: 0,
    net_revenue_usd: 0,
    avg_order_usd: 0,
  }
  const period = { start: query.startDate || null, end: query.endDate || null }

  const sales = await db.prepare(`
    SELECT s.id, s.receipt_number, s.created_at, s.branch_name, s.cashier_name,
           s.customer_name, s.customer_phone, s.customer_address,
           s.payment_method, s.payment_currency, s.exchange_rate, s.sale_status,
           s.subtotal_usd, s.subtotal_khr, s.discount_usd, s.discount_khr,
           s.membership_discount_usd, s.membership_discount_khr, s.membership_points_redeemed,
           s.tax_usd, s.amount_paid_usd, s.amount_paid_khr,
           s.is_delivery, s.delivery_contact_name, s.delivery_contact_phone, s.delivery_contact_address,
           s.delivery_fee_usd, s.delivery_fee_khr, s.delivery_fee_paid_by, s.total_usd, s.total_khr, s.notes
    FROM sales s
    WHERE ${where.join(' AND ')}
    ORDER BY s.created_at ASC
    LIMIT 5000
  `).all<{
    id: number; receipt_number: string | null; created_at: string; branch_name: string | null
    cashier_name: string | null; customer_name: string | null; customer_phone: string | null; customer_address: string | null
    payment_method: string | null; payment_currency: string | null; exchange_rate: number | null; sale_status: string | null
    subtotal_usd: number | null; subtotal_khr: number | null; discount_usd: number | null; discount_khr: number | null
    membership_discount_usd: number | null; membership_discount_khr: number | null; membership_points_redeemed: number | null
    tax_usd: number | null; amount_paid_usd: number | null; amount_paid_khr: number | null
    is_delivery: number | null; delivery_contact_name: string | null; delivery_contact_phone: string | null; delivery_contact_address: string | null
    delivery_fee_usd: number | null; delivery_fee_khr: number | null; delivery_fee_paid_by: string | null
    total_usd: number | null; total_khr: number | null; notes: string | null
  }>(params)

  // Real gap fixed this session: this route caps its own detail-row query
  // at 5000 (below the CPU/response-size budget of a single request), but
  // `total_transactions`/`completed_transactions`/`by_status` below used
  // to be derived from that same capped `sales` array -- so a date range
  // with more than 5000 matching sales silently under-reported its own
  // headline transaction counts and status breakdown, with nothing in the
  // response telling the caller rows were missing. `revenue_usd`/`cogs_usd`/
  // etc. were already correct regardless (getSalesTotals below runs its
  // own uncapped query), so only the count-shaped fields were wrong.
  // Fixed by computing the true totals from a separate uncapped COUNT/
  // GROUP BY query, and surfacing `truncated`/`total_matching` so the
  // caller (ExportModal.tsx) can warn the person their date range has
  // more sales than the detail rows/CSV actually contain.
  const totalMatchingRow = await db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN COALESCE(s.sale_status, 'completed') = 'completed' THEN 1 ELSE 0 END) AS completed
    FROM sales s
    WHERE ${where.join(' AND ')}
  `).get<{ total: number; completed: number }>(params)
  const totalMatching = totalMatchingRow?.total || 0
  const truncated = totalMatching > sales.length

  if (sales.length === 0) {
    return c.json({ period, summary: emptySummary, by_status: [], by_product: [], sales: [], truncated: false, total_matching: 0 })
  }

  const saleIds = sales.map((s) => s.id)
  const exportItems = await selectInChunks(saleIds, 0, (chunk) => db.prepare(`
    SELECT si.*, p.barcode AS barcode
    FROM sale_items si
    LEFT JOIN products p ON p.id = si.product_id
    WHERE si.sale_id IN (${chunk.map(() => '?').join(',')})
    ORDER BY si.id ASC
  `).all<{ sale_id: number; [key: string]: unknown }>(chunk))
  const exportItemsBySale = new Map<number, Array<Record<string, unknown>>>()
  for (const item of exportItems) {
    if (!exportItemsBySale.has(item.sale_id)) exportItemsBySale.set(item.sale_id, [])
    exportItemsBySale.get(item.sale_id)!.push(item)
  }
  // Cancelled sales are kept in the detail rows and the by-status
  // breakdown (so the report can show they happened), but excluded from
  // revenue/COGS/top-products, same convention as "active" vs "cancelled"
  // elsewhere in this file (e.g. STOCK_DEDUCTED_STATUSES above).
  const activeSales = sales.filter((s) => s.sale_status !== 'cancelled')
  const activeSaleIds = activeSales.map((s) => s.id)

  const refundRows = activeSaleIds.length
    ? await selectInChunks(saleIds, 0, (chunk) => db.prepare(`
        SELECT sale_id, COALESCE(SUM(total_refund_usd), 0) AS refund_usd
        FROM returns
        WHERE sale_id IN (${chunk.map(() => '?').join(',')}) AND COALESCE(status, 'completed') != 'cancelled' AND COALESCE(return_scope, 'customer') = 'customer'
        GROUP BY sale_id
      `).all<{ sale_id: number; refund_usd: number }>(chunk))
    : []
  const refundsBySale = new Map(refundRows.map((r) => [r.sale_id, r.refund_usd || 0]))

  // Shared model (lib/salesAnalytics.ts) for revenue/COGS/profit -- keeps
  // this summary's numbers consistent with the Dashboard's, which
  // previously disagreed (this route summed sales.total_usd, which
  // includes tax, as if it were margin; the shared model excludes tax and
  // delivery from "revenue" the same way Inventory/Products define it).
  const salesTotals = await getSalesTotals(c.env, {
    startDate: query.startDate || period.start || sales[0].created_at.slice(0, 10),
    endDate: query.endDate || period.end || sales[sales.length - 1].created_at.slice(0, 10),
    branchId: query.branchId || null,
  })

  const byProduct: Array<{ product_id: number | null; product_name: string | null; qty_sold: number; revenue_usd: number }> = []
  if (activeSaleIds.length) {
    // The only aggregate here that chunking really does change: a product
    // can appear in sale_items rows spread across several chunks, and
    // `ORDER BY ... LIMIT 100` per chunk would rank partial sums. So the
    // per-chunk groups are re-summed per product, and only then ranked and
    // truncated -- the top-100 is computed over the whole period, exactly
    // as the single-statement version did.
    const chunkRows = await selectInChunks(activeSaleIds, 0, (chunk) => db.prepare(`
      SELECT product_id, product_name, COALESCE(SUM(quantity), 0) AS qty_sold, COALESCE(SUM(total_usd), 0) AS revenue_usd
      FROM sale_items
      WHERE sale_id IN (${chunk.map(() => '?').join(',')})
      GROUP BY product_id, product_name
    `).all<{ product_id: number | null; product_name: string | null; qty_sold: number; revenue_usd: number }>(chunk))
    const totalsByProduct = new Map<string, { product_id: number | null; product_name: string | null; qty_sold: number; revenue_usd: number }>()
    for (const row of chunkRows) {
      const key = `${row.product_id ?? 'null'}:${row.product_name ?? ''}`
      const running = totalsByProduct.get(key)
      if (running) {
        running.qty_sold += Number(row.qty_sold) || 0
        running.revenue_usd += Number(row.revenue_usd) || 0
      } else {
        totalsByProduct.set(key, { product_id: row.product_id, product_name: row.product_name, qty_sold: Number(row.qty_sold) || 0, revenue_usd: Number(row.revenue_usd) || 0 })
      }
    }
    const productRows = [...totalsByProduct.values()]
      .sort((a, b) => b.revenue_usd - a.revenue_usd)
      .slice(0, 100)
    byProduct.push(...productRows.map((r) => ({ ...r, qty_sold: round2(r.qty_sold), revenue_usd: round2(r.revenue_usd) })))
  }

  let totalRefundsUsd = 0
  const detailRows = sales.flatMap((s) => {
    const refundUsd = refundsBySale.get(s.id) || 0
    totalRefundsUsd += refundUsd
    const storedItems = exportItemsBySale.get(s.id) || []
    const items = storedItems.length ? storedItems : [{}]
    return items.map((item, index) => ({
      receipt_number: index === 0 ? s.receipt_number : '',
      sale_date: index === 0 ? s.created_at : '',
      sale_status: index === 0 ? s.sale_status : '',
      payment_method: index === 0 ? s.payment_method : '',
      payment_currency: index === 0 ? s.payment_currency : '',
      exchange_rate: index === 0 ? s.exchange_rate : '',
      branch: index === 0 ? s.branch_name : '',
      customer_name: index === 0 ? s.customer_name : '',
      customer_phone: index === 0 ? s.customer_phone : '',
      customer_address: index === 0 ? s.customer_address : '',
      cashier_name: index === 0 ? s.cashier_name : '',
      name: item.product_name ?? '', sku: item.sku ?? '', barcode: item.barcode ?? '', quantity: item.quantity ?? 1,
      unit_price_usd: item.applied_price_usd ?? 0, unit_price_khr: item.applied_price_khr ?? 0,
      base_price_usd: item.base_price_usd ?? item.applied_price_usd ?? 0,
      base_price_khr: item.base_price_khr ?? item.applied_price_khr ?? 0,
      product_discount_type: item.product_discount_type ?? '', product_discount_label: item.product_discount_label ?? '',
      product_discount_usd: item.product_discount_usd ?? 0, product_discount_khr: item.product_discount_khr ?? 0,
      manual_discount_type: item.manual_discount_type ?? '', manual_discount_value: item.manual_discount_value ?? 0,
      manual_discount_usd: item.manual_discount_usd ?? 0, manual_discount_khr: item.manual_discount_khr ?? 0,
      cost_price_usd: item.cost_price_usd ?? 0, cost_price_khr: item.cost_price_khr ?? 0,
      batch_label: item.batch_label ?? '', returned_quantity: item.returned_quantity ?? '',
      discount_usd: index === 0 ? s.discount_usd : '', discount_khr: index === 0 ? s.discount_khr : '',
      tax_usd: index === 0 ? s.tax_usd : '', amount_paid_usd: index === 0 ? s.amount_paid_usd : '', amount_paid_khr: index === 0 ? s.amount_paid_khr : '',
      membership_discount_usd: index === 0 ? s.membership_discount_usd : '', membership_discount_khr: index === 0 ? s.membership_discount_khr : '',
      membership_points_redeemed: index === 0 ? s.membership_points_redeemed : '',
      is_delivery: index === 0 ? s.is_delivery : '', delivery_contact_name: index === 0 ? s.delivery_contact_name : '',
      delivery_contact_phone: index === 0 ? s.delivery_contact_phone : '', delivery_contact_address: index === 0 ? s.delivery_contact_address : '',
      delivery_fee_usd: index === 0 ? s.delivery_fee_usd : '', delivery_fee_khr: index === 0 ? s.delivery_fee_khr : '',
      delivery_fee_paid_by: index === 0 ? s.delivery_fee_paid_by : '', notes: index === 0 ? s.notes : '',
    }))
  })

  // Real gap fixed alongside the truncation fix above: `totalRefundsUsd`
  // (used for the summary's `total_refunds_usd`/`net_revenue_usd`) was
  // summed from `refundsBySale`, which is only built for the capped
  // `sales` page -- under truncation this silently missed every refund
  // on a sale past the 5000-row cap, the same under-reporting bug as
  // `total_transactions`/`by_status` above. Recomputed here via a direct
  // uncapped query joined against the same date/branch WHERE clause,
  // rather than the capped in-memory map, so the summary total is correct
  // regardless of how many sales matched.
  const totalRefundsRow = truncated
    ? await db.prepare(`
        SELECT COALESCE(SUM(r.total_refund_usd), 0) AS total
        FROM returns r
        JOIN sales s ON s.id = r.sale_id
        WHERE ${where.join(' AND ')}
          AND COALESCE(s.sale_status, 'completed') != 'cancelled'
          AND COALESCE(r.status, 'completed') != 'cancelled'
          AND COALESCE(r.return_scope, 'customer') = 'customer'
      `).get<{ total: number }>(params)
    : null
  if (truncated) totalRefundsUsd = totalRefundsRow?.total || 0

  // by_status now comes from an uncapped SQL GROUP BY over the whole
  // matching range (not the capped in-memory `sales` array above) --
  // otherwise a range with >5000 sales would silently under-report status
  // counts/revenue for whichever statuses happened to fall past the cap.
  const byStatusRows = await db.prepare(`
    SELECT COALESCE(s.sale_status, 'completed') AS status, COUNT(*) AS count, COALESCE(SUM(s.total_usd), 0) AS revenue
    FROM sales s
    WHERE ${where.join(' AND ')}
    GROUP BY COALESCE(s.sale_status, 'completed')
  `).all<{ status: string; count: number; revenue: number }>(params)
  const byStatus = byStatusRows.map((r) => ({ status: r.status, count: r.count, revenue: round2(r.revenue || 0) }))

  const netRevenueUsd = salesTotals.revenue_usd - totalRefundsUsd

  const summary = {
    total_transactions: totalMatching,
    completed_transactions: totalMatchingRow?.completed || 0,
    revenue_usd: salesTotals.revenue_usd,
    cogs_usd: salesTotals.cost_usd,
    gross_profit_usd: salesTotals.profit_usd,
    gross_margin_pct: salesTotals.revenue_usd > 0 ? round2((salesTotals.profit_usd / salesTotals.revenue_usd) * 100) : 0,
    total_discounts_usd: salesTotals.discount_usd,
    total_tax_usd: salesTotals.tax_usd,
    total_delivery_usd: salesTotals.delivery_usd,
    total_refunds_usd: round2(totalRefundsUsd),
    net_revenue_usd: round2(netRevenueUsd),
    avg_order_usd: salesTotals.avg_order_usd,
  }

  return c.json({ period, summary, by_status: byStatus, by_product: byProduct, sales: detailRows, truncated, total_matching: totalMatching })
})

export default app
