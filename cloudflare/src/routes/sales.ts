import { Hono, type Context } from 'hono'
import { broadcast } from '../durable-objects/broadcastHub'
import { getDb } from '../lib/db'
import { chunkForBinding, selectInChunks } from '../lib/sqlBinding'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { hasPermission, hasAnyPermission, getPermissionTier, getActionTier, isAdminControlUser } from '../lib/permissions'

// Sales is a VIEW_TIER section (Part 557 slice 2): a 'view' grant can READ
// every sales list/stat/report but perform no writes. Reads use this
// (tier != none = view OR full); writes use action-specific Full gates.
function canReadSales(user: SessionUser): boolean {
  return getPermissionTier(user, 'sales') !== 'none'
}
import { assertUpdatedAtMatch, getExpectedUpdatedAt, writeConflictResponse, WriteConflictError } from '../lib/conflictControl'
import { bumpVersion, cachedJsonResponse, getVersionWithFallback } from '../lib/cache'
// The POS payment-method field is free text (a datalist, not a select), so a
// sale can introduce a method Settings has never heard of. See
// lib/paymentMethodRegistry.ts for why the merge is server-side and shared by
// every sale writer rather than done in the POS component.
import { mergePaymentMethods, parseConfiguredMethods, saleMethodsUsed } from '../lib/paymentMethodRegistry'
import { planSaleSettlement, SettlementValidationError } from '../lib/paymentSettlement'
import {
  SALE_SETTLEMENT_ACTION_KIND,
  buildSaleSettlementAfterState,
  readSaleSettlementState,
  saleMutationGuard,
  saleSettlementStateStatements,
  type SaleSettlementSnapshot,
} from '../lib/saleSettlementAction'
import { CUSTOMER_REFUND_JOIN, awaitingExpr, getCustomerSalesTotals, getDeliveryContactTotals, getPaymentMethodBreakdown, getSalesDayReport, getSalesPeriodSeries, getSalesTotals, netRefundExpr, netSaleExpr, recognizedExpr } from '../lib/salesAnalytics'
import { allocateAcrossLots, decrementBatchStockStatement, decrementBatchStockStrictStatement, readFifoLotAvailabilityForCart, type FifoLotTake } from '../lib/productBatches'
// S4-24b: adding lines to an EXISTING sale. The rules (which statuses accept
// a line, how much stock moves, which lots, what happens to the totals) are
// all in this one pure module so a test can drive them directly -- see
// POST /:id/items below and scripts/test-sale-add-items-pure.cjs.
import {
  allocateNewSaleLines,
  buildOperationAllocationStatements,
  guardSaleLineAddition,
  planSaleLineAddition,
  captureSaleLineKhrSnapshot,
  rebaseSaleLineKhrSnapshot,
  rebaseSaleLineKhrStatement,
  resolveExplicitSaleLineBatches,
  saleMoneyUpdateStatement,
  saleStatusDeductsStock,
} from '../lib/saleLineAddition'
// S4-30: amending a recorded sale, as an append-only ledger. Same discipline
// as S4-24b above -- every rule about who may amend, for how long, what moves
// stock, and what happens to the money lives in the pure module, and this file
// is the I/O around it. See scripts/test-sale-amendments-pure.cjs.
import {
  AMENDMENT_WINDOW_SETTING_KEY,
  amendmentEntryStatement,
  guardDeliveryFeeAmendment,
  guardSaleAmendment,
  planDeliveryFeeChange,
  planLineQuantityDecrease,
  planLineQuantityIncrease,
  recomputeSaleMoneyAfterAmendment,
  resolveAmendedTaxUsd,
  resolveAmendmentWindowMinutes,
  resolveTaxSettings,
  saleAmendmentMovesStock,
  saleSkipsStock,
  saleTaxUpdateStatement,
  summarizeAmendments,
  taxableBaseUsd,
  TAX_ENABLED_SETTING_KEY,
  TAX_RATE_SETTING_KEY,
  type AmendableSaleRow,
  type AmendedTaxResult,
  type LedgerRow,
  type LineAllocation,
  type TaxSettings,
} from '../lib/saleAmendments'
import { applySaleBulkStatus, bulkAssertion, notifyBulkStatus, SaleBulkError, saleRevisionGuard } from '../lib/saleBulkStatus'
import { applySaleBulkUpdate, notifySaleBulkUpdate } from '../lib/saleBulkUpdate'
import { VALID_SALE_STATUSES, STOCK_DEDUCTED_STATUSES } from '../lib/salesStatus'
import { consumeDamagedLot, restoreDamagedLot, DamagedLotShortfallError, DAMAGE_OUT_MOVEMENT, DAMAGE_IN_MOVEMENT } from '../lib/returnsStock'
import {
  CANCEL_REASONS,
  allocateReturnedQuantities,
  cancelReasonLabel,
  heldQuantity,
  guardSaleStatusTransition,
  normalizeCancelReason,
  planSaleStockTransition,
  type CancelReason,
  type SaleItemAllocation,
} from '../lib/saleTransitions'
import { buildLikeAliasClause, tokenizeSearchTermGroups, normalizeSearchText } from '../lib/searchMatch'
import { computeSaleTotals, resolveChangeExchangeRate, round2 } from '../lib/saleTotals'
import { financialCalculationValue } from '../lib/financialPrecision'
import { planNativeSaleChange, NativeSaleChangeValidationError } from '../lib/nativeSaleChange'
import { normalizeClientReceiptNumber, uniqueBusinessDateTimeNumber } from '../lib/receiptNumber'
import { sanitizeClientCreatedAt } from '../lib/clientTimestamp'
import { localDateAtOrAfter, localDateAtOrBefore, localDateRangeClause, localTimeRangeClause } from '../lib/businessDateWindow'
import { formatSaleTelegramLines, sendTelegramEvent, telegramMoney } from '../lib/telegram'
import type { Env } from '../index'
import { actorId, actorSnapshot } from '../lib/actorSnapshot'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)

const SALES_READ_CACHE_TTL_SECONDS = 20

/**
 * Fold the methods a sale actually used back into `pos_payment_methods`.
 *
 * The ONE I/O wrapper around lib/paymentMethodRegistry -- every sale writer in
 * this file calls this, so a method typed at the till, a method chosen when a
 * credit sale is finally settled, and a method that arrives on an imported row
 * all reach the configured list by the same route.
 *
 * Three properties this deliberately has:
 *
 * - It NEVER fails the caller. A sale that is already committed must not be
 *   reported as failed because a settings row would not write, so every error
 *   is swallowed and logged. Callers hand this to `waitUntil`, off the
 *   response path.
 * - It reads and re-writes the whole array rather than appending, because the
 *   setting IS a JSON array; `mergePaymentMethods` keeps the existing order
 *   and the operator's own capitalisation, so a concurrent Settings edit can
 *   only ever lose the append, never reorder or rename what the operator set.
 * - It writes NOTHING when nothing is new. This runs on every checkout; the
 *   common case (a known method) must not produce a settings write, or
 *   `settings.updated_at` would change on every sale and defeat the
 *   /settings/meta polling that the whole app's refresh cadence is built on.
 */
async function registerUsedPaymentMethods(env: Env, sale: { payment_method?: unknown; payment_details?: unknown }): Promise<string[]> {
  const used = saleMethodsUsed(sale)
  if (!used.length) return []
  try {
    const db = getDb(env)
    const row = await db.prepare("SELECT value FROM settings WHERE key = 'pos_payment_methods'").get<{ value: string }>()
    const configured = parseConfiguredMethods(row?.value)
    const merged = mergePaymentMethods(configured, used)
    if (!merged.changed) return []
    await db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('pos_payment_methods', @value, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    ).run({ value: JSON.stringify(merged.methods) })
    return merged.added
  } catch (error) {
    console.error('[payment-methods] could not register methods used on a sale', error)
    return []
  }
}

async function getSalesReadCacheVersion(env: Env): Promise<string> {
  // The list/search payload also exposes current customer membership data and
  // current product barcode/category data, while refund totals come from
  // returns. Fold each low-cardinality KV version into one Cache API key so a
  // write to any dependency makes the old response unreachable immediately.
  const namespaces = ['sales', 'returns', 'customers', 'products'] as const
  const versions = await Promise.all(namespaces.map((namespace) => getVersionWithFallback(env, namespace)))
  return versions.map((version, index) => `${namespaces[index]}:${version}`).join('|')
}

const LOCAL_TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/

function appendLocalTimeRange(
  query: Record<string, string>,
  clauses: string[],
  params: Record<string, unknown>,
  timestampColumn: string,
): { startTime: string; endTime: string } | null {
  const startTime = String(query.startTime || '').trim()
  const endTime = String(query.endTime || '').trim()
  if (!LOCAL_TIME_RE.test(startTime) || !LOCAL_TIME_RE.test(endTime)) return null
  clauses.push(localTimeRangeClause(timestampColumn))
  params.startTime = startTime
  params.endTime = endTime
  return { startTime, endTime }
}

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
  // 11.9 (Part 416): set when the cashier picked the DAMAGE source for
  // this line -- the units come out of this damaged_stock_lots row
  // (quantity_remaining), not out of branch/batch stock.
  damaged_lot_id?: number | null
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

async function saleMutationDigest(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

app.post('/', async (c) => {
  const db = getDb(c.env)
  // Real gap: this endpoint only checked requireAuth (any logged-in user).
  // Sale creation happens from two places -- POS checkout (frontend gates
  // page access on the 'pos' permission, see AppContext.tsx's
  // PAGE_PERMISSIONS) and, potentially, a manual entry from the Sales page
  // itself ('sales' permission) -- so either grant is accepted here rather
  // than requiring both.
  // N13: one binding for the actor snapshot below -- the sale header, its
  // movement rows, the search blob and the Telegram line all name the SAME
  // authenticated account, resolved here and never read out of the body.
  const user = c.get('user')
  if (!hasAnyPermission(user, ['pos', 'sales'])) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const body = await c.req.json<{
    items: SaleItemInput[]
    // Offline replays only: the sale's queue-time moment, honored with
    // bounded trust (lib/clientTimestamp.ts). Online checkouts omit it.
    created_at?: unknown
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
    change_usd?: number | string
    change_khr?: number | string
    change_is_actual?: boolean
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
    // false = this sale does not earn loyalty points (POS toggle); anything
    // else keeps the default auto-accrual. See migration 0061.
    loyalty_accrual?: boolean
    // Delivery -- same gap: is_delivery/delivery_contact_id/delivery_fee_*
    // are real columns on `sales` (0001_init.sql) and real POS UI state,
    // just never wired into this insert.
    is_delivery?: boolean | number
    delivery_contact_id?: number
    delivery_fee_usd?: number
    delivery_fee_khr?: number
    delivery_fee_paid_by?: string
    // P6: staff-entered actual courier cost -- never printed on receipts.
    delivery_actual_cost_usd?: number | string | null
    delivery_actual_cost_khr?: number | string | null
  }>()

  const clientRequestId = normalizeClientRequestId(body.client_request_id)
  if (clientRequestId) {
    const existingSale = await db
      // Repeat the partial-index predicate explicitly. SQLite does not infer
      // `client_request_id <> ''` from the equality binding, so omitting it
      // turns this idempotency lookup into a full sales-table scan even though
      // idx_sales_client_request_unique_pg already exists.
      .prepare("SELECT id, receipt_number FROM sales WHERE client_request_id = ? AND client_request_id <> '' LIMIT 1")
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
  // Damaged-source lines check against their LOT below, not branch_stock --
  // their units were never in sellable stock to begin with.
  const stockCheckItems = normalized.filter((item) => item.branch_id && shouldDeductStock && !item.damaged_lot_id)
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
        return c.json({ error: `Insufficient stock for ${name}: requested ${item.quantity}, available ${available}` }, 409)
      }
    }
  }

  // 11.9: damaged-source availability (plain read, same validate-then-write
  // shape as above; consumeDamagedLot's own WHERE clause below remains the
  // real race guard).
  const damagedItems = normalized.filter((item) => item.damaged_lot_id && shouldDeductStock)
  if (damagedItems.length) {
    // One chunked read instead of a SELECT per damaged line -- same batched
    // shape as the branch_stock and branch_batch_stock checks above.
    const damagedLotIds = [...new Set(damagedItems.map((item) => item.damaged_lot_id as number))]
    const damagedLotRows = await selectInChunks(damagedLotIds, 0, (chunk) => db
      .prepare(`SELECT id, product_id, quantity_remaining FROM damaged_stock_lots WHERE id IN (${chunk.map(() => '?').join(',')})`)
      .all<{ id: number; product_id: number; quantity_remaining: number }>(chunk))
    const damagedLotMap = new Map(damagedLotRows.map((row) => [Number(row.id), row]))
    for (const item of damagedItems) {
      const lot = damagedLotMap.get(Number(item.damaged_lot_id))
      const name = productMap.get(item.product_id)?.name || `product #${item.product_id}`
      if (!lot || Number(lot.product_id) !== Number(item.product_id)) {
        return c.json({ error: `The damaged lot picked for ${name} no longer exists for that product. Refresh and pick again.` }, 409)
      }
      if (item.quantity > (Number(lot.quantity_remaining) || 0)) {
        return c.json({ error: `Insufficient damaged stock for ${name}: requested ${item.quantity}, available ${Number(lot.quantity_remaining) || 0}` }, 409)
      }
    }
  }

  // ---- 2c. Z0: FIFO auto-allocation for lines with NO picked batch ----
  // The standing rule (user, Aug 28): a return/cancel must put stock back
  // into the SAME batch the sale took it from -- which requires the SALE to
  // know its lot(s). A line whose cashier picked no lot is allocated across
  // the product's active lots at that branch, oldest received first. One
  // lot covering the whole line becomes the line's batch_id (identical to
  // an explicit pick everywhere downstream); a multi-lot split keeps
  // batch_id NULL and records per-lot allocation rows instead. Units beyond
  // what the lot ledger tracks (legacy stock) stay unlotted -- the sale
  // still proceeds on branch_stock, exactly as before this pass existed.
  // Runs for non-deducting statuses too (awaiting_payment): the attribution
  // is recorded now (released_quantity = quantity, nothing physically out),
  // so the later deducting transition draws the same lots.
  const autoAllocationsByItemIndex = new Map<number, FifoLotTake[]>()
  {
    // One batched read of every unlotted line's FIFO availability instead of
    // a round-trip per line -- the grouped Map is still mutated in place
    // below so a second line of the same product can't double-take a lot.
    const fifoPairs = normalized
      .filter((item) => !item.batch_id && !item.damaged_lot_id && item.branch_id)
      .map((item) => ({ productId: item.product_id, branchId: item.branch_id as number }))
    const lotsByKey = await readFifoLotAvailabilityForCart(db, fifoPairs)
    for (const [itemIndex, item] of normalized.entries()) {
      if (item.batch_id || item.damaged_lot_id || !item.branch_id) continue
      const key = `${item.product_id}:${item.branch_id}`
      const lots = lotsByKey.get(key) || []
      const { takes } = allocateAcrossLots(lots, item.quantity)
      if (!takes.length) continue
      // Consume the shared availability so a second line of the same
      // product in this sale cannot double-take the same units.
      for (const take of takes) {
        const lot = lots.find((entry) => entry.batchId === take.batchId)
        if (lot) lot.available -= take.quantity
      }
      if (takes.length === 1 && takes[0].quantity >= item.quantity) {
        item.batch_id = takes[0].batchId
        item.batch_label = takes[0].lotCode || undefined
        item.batch_expiry_date = takes[0].expiryDate || undefined
      } else {
        autoAllocationsByItemIndex.set(itemIndex, takes)
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
  // Part 534: KHR change converts at its own configured rate. Read the
  // SETTING (not a client field) so the stored change_khr matches what the
  // POS displayed from the same setting.
  const changeRateRow = await db.prepare(
    `SELECT value FROM settings WHERE key = 'change_exchange_rate'`,
  ).get<{ value: string }>()
  const changeExchangeRateSetting = changeRateRow?.value
  let customer: { id: number; name: string | null; membership_number: string | null } | null = null
  if (body.customer_id) {
    customer = await db.prepare('SELECT id, name, membership_number FROM customers WHERE id = ?').get([body.customer_id]) || null
  } else if (body.customer_membership_number) {
    customer = await db.prepare('SELECT id, name, membership_number FROM customers WHERE lower(trim(membership_number)) = lower(trim(?))').get([body.customer_membership_number]) || null
  }

  const membershipPointsRedeemed = Math.max(0, Number(body.membership_points_redeemed) || 0)
  let membershipDiscountUsd = round2(Math.max(0, Number(body.membership_discount_usd) || 0))
  let membershipDiscountKhr = round2(Math.max(0, Number(body.membership_discount_khr) || 0))

  // The owner's membership-points master switch (user, Sep 4 2026), read as a
  // SETTING and never from the request -- a stale till that still shows the
  // points panel must not be able to accrue or spend against a programme the
  // shop has switched off. Absent = on, matching buildPortalConfig's default.
  const loyaltyEnabledRow = await db.prepare(
    `SELECT value FROM settings WHERE key = 'loyalty_points_enabled'`,
  ).get<{ value: string }>()
  const loyaltyPointsEnabled = !['0', 'false', 'no', 'off'].includes(String(loyaltyEnabledRow?.value ?? '').trim().toLowerCase())

  if (membershipPointsRedeemed > 0) {
    if (!customer) {
      return c.json({ error: 'A membership customer is required to redeem points' }, 400)
    }
    // Refused, not silently ignored. Dropping the redemption would charge the
    // customer the FULL total while the cashier's screen still showed the
    // discount -- a money difference at the counter is worse than an error.
    if (!loyaltyPointsEnabled) {
      return c.json({ error: 'Membership points are turned off in Settings, so points cannot be redeemed.' }, 400)
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
         COALESCE(SUM(CASE WHEN COALESCE(sale_status, 'completed') NOT IN ('cancelled', 'awaiting_payment') AND COALESCE(loyalty_accrual, 1) = 1 THEN total_usd ELSE 0 END), 0) AS earned_usd,
         COALESCE(SUM(CASE WHEN COALESCE(sale_status, 'completed') NOT IN ('cancelled', 'awaiting_payment') AND COALESCE(loyalty_accrual, 1) = 1 THEN total_khr ELSE 0 END), 0) AS earned_khr,
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
      // `reward_points_voided_at IS NULL` (migration 0116) -- the same clause
      // contacts.ts's bulk read applies. This re-validation and the balance
      // POS displays MUST see the same ledger; the Part-77 note below is the
      // record of what happens when one of them omits a term.
      `SELECT COALESCE(SUM(reward_points), 0) AS rewarded FROM customer_share_submissions WHERE customer_id = ? AND status = 'approved' AND reward_points_voided_at IS NULL`,
    ).get<{ rewarded: number }>([customer.id])
    // Manual awards (Part-77, MEDIUM): summarizePoints -- the balance POS
    // DISPLAYS -- adds loyalty_point_adjustments, but this re-validation
    // didn't, so a customer whose points were manually awarded saw a
    // redeemable balance and then got "Insufficient points balance" at
    // checkout. Same term, same sign (adjustments are positive awards by
    // CHECK constraint).
    const adjustedAgg = await db.prepare(
      `SELECT COALESCE(SUM(points), 0) AS adjusted FROM loyalty_point_adjustments WHERE customer_id = ? AND voided_at IS NULL`,
    ).get<{ adjusted: number }>([customer.id])

    const earned = pointsBasis === 'khr' ? (salesAgg?.earned_khr || 0) * pointsPerKhr : (salesAgg?.earned_usd || 0) * pointsPerUsd
    const deducted = pointsBasis === 'khr' ? (returnsAgg?.refund_khr || 0) * pointsPerKhr : (returnsAgg?.refund_usd || 0) * pointsPerUsd
    const alreadyRedeemed = salesAgg?.redeemed || 0
    const rewarded = rewardedAgg?.rewarded || 0
    const manuallyAwarded = adjustedAgg?.adjusted || 0
    const balance = Math.max(0, earned - deducted - alreadyRedeemed + rewarded + manuallyAwarded)

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
  // P6: what the delivery ACTUALLY cost the shop (courier money out) --
  // staff-only, never on receipts. NULL when not entered, so stats can
  // tell "recorded as zero" apart from "never recorded".
  const rawActualCost = Number(body.delivery_actual_cost_usd)
  const deliveryActualCostUsd = isDelivery && Number.isFinite(rawActualCost) && rawActualCost >= 0 && body.delivery_actual_cost_usd !== undefined && body.delivery_actual_cost_usd !== null && String(body.delivery_actual_cost_usd) !== ''
    ? round2(rawActualCost)
    : null
  const deliveryActualCostKhr = deliveryActualCostUsd != null ? Math.round(Number(body.delivery_actual_cost_khr) || deliveryActualCostUsd * exchangeRate) : null

  // Membership discount reduces the recorded total (previously dropped, so a
  // points-redeemed sale recorded more than the customer actually paid).
  const {
    totalUsd, totalKhr, amountPaidUsd, amountPaidKhr,
    changeUsd: fallbackChangeUsd, changeKhr: fallbackChangeKhr,
  } = computeSaleTotals({
    subtotalUsd,
    discountUsd,
    membershipDiscountUsd,
    taxUsd,
    isDelivery,
    deliveryFeeUsd,
    deliveryFeePaidBy,
    exchangeRate,
    changeExchangeRate: changeExchangeRateSetting,
    rawAmountPaidUsd: body.amount_paid_usd,
    rawAmountPaidKhr: body.amount_paid_khr,
  })
  let nativeChange
  try {
    nativeChange = planNativeSaleChange({
      actualIntent: body.change_is_actual,
      rawChangeUsd: body.change_usd,
      rawChangeKhr: body.change_khr,
      amountPaidUsd,
      amountPaidKhr,
      totalUsd,
      exchangeRate,
      changeExchangeRate: changeExchangeRateSetting,
      fallbackChangeUsd,
      fallbackChangeKhr,
    })
  } catch (error) {
    if (error instanceof NativeSaleChangeValidationError) {
      return c.json({ error: error.message, code: error.code }, error.statusCode)
    }
    throw error
  }
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
  // Y10: an awaiting-payment sale with nothing paid records NO payment
  // method -- the old 'Cash' fallback fabricated a method for a sale whose
  // whole point is deciding the payment later (it is entered when the sale
  // is completed on the Sales page, PATCH /:id/status below).
  const effectivePaymentDetails = paymentDetails.length
    ? paymentDetails
    : saleStatus === 'awaiting_payment' && amountPaidUsd <= 0 && amountPaidKhr <= 0
      ? []
      : [{ method: String(body.payment_method || 'Cash').trim().slice(0, 80) || 'Cash', amount_usd: amountPaidUsd, amount_khr: amountPaidKhr }]
  const paymentMethod = Array.from(new Set(effectivePaymentDetails.map((detail) => detail.method))).join(' + ')
  // YYYYMMDD-HHMMSS in Phnom Penh wall-clock time -- the receipt id encodes
  // the sale's own date+time (user, Aug 30 2026), with NO prefix (user,
  // Aug 31 2026: "Receipt no need RCP"; returns keep RET-/SRET-).
  // A client-provided number (an offline replay whose id was already printed
  // for the customer at queue time) is honored ONLY when it is a real
  // business receipt id -- historical RCP- ids still pass. Anything else,
  // including the old system's `NNNNNN@YYYY-MM-DD` form that the 2026-09-02
  // reconciliation pack wrote onto 15,004 rows (repaired by migration 0107),
  // is dropped and replaced by the server-minted id. Normalise rather than
  // 400: see normalizeClientReceiptNumber for why rejecting an offline
  // replay would strand a sale that really happened in the outbox forever.
  const receiptNumber = normalizeClientReceiptNumber(body.receipt_number) || await uniqueBusinessDateTimeNumber(
    '',
    async (candidate) => !!(await db.prepare('SELECT 1 AS hit FROM sales WHERE receipt_number = ? LIMIT 1').get([candidate])),
  )
  // An offline replay carries the sale's own queue-time moment (stamped in
  // saleWriteTransport); honored with bounded trust so day-ranged reports
  // put the sale on the day it happened, not the day it synced. Online
  // checkouts send no created_at and keep the server clock. See
  // lib/clientTimestamp.ts for the bounds and the storage format.
  const clientCreatedAt = sanitizeClientCreatedAt(body.created_at)

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
        amount_paid_usd, amount_paid_khr, change_usd, change_khr, change_is_actual, change_exchange_rate,
        membership_discount_usd, membership_discount_khr, membership_points_redeemed,
        is_delivery, delivery_contact_id, delivery_contact_name, delivery_contact_phone, delivery_contact_address,
        delivery_fee_usd, delivery_fee_khr, delivery_fee_paid_by,
        delivery_actual_cost_usd, delivery_actual_cost_khr,
        loyalty_accrual, sale_status, search_normalized, created_at, updated_at
      ) VALUES (@receipt_number, @client_request_id, @cashier_id, @cashier_name, @branch_id, @branch_name,
        @customer_id, @customer_name, @customer_phone, @customer_address,
        @payment_method, @payment_details, @payment_currency, @exchange_rate,
        @subtotal_usd, @subtotal_khr, @discount_usd, @discount_khr, @tax_usd, @tax_khr, @total_usd, @total_khr,
        @amount_paid_usd, @amount_paid_khr, @change_usd, @change_khr, @change_is_actual, @change_exchange_rate,
        @membership_discount_usd, @membership_discount_khr, @membership_points_redeemed,
        @is_delivery, @delivery_contact_id, @delivery_contact_name, @delivery_contact_phone, @delivery_contact_address,
        @delivery_fee_usd, @delivery_fee_khr, @delivery_fee_paid_by,
        @delivery_actual_cost_usd, @delivery_actual_cost_khr,
        @loyalty_accrual, @sale_status, @search_normalized, COALESCE(@created_at, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
    `)
    .run({
      receipt_number: receiptNumber,
      created_at: clientCreatedAt,
      client_request_id: clientRequestId,
      // N13: the cashier snapshot is the AUTHENTICATED session's account, not
      // whatever the client put in the body. Before this, POST /api/sales was
      // the one history writer that trusted a client string outright
      // (`cashier_name: body.cashier_name`), so the actor stored on a sale was
      // whatever the caller sent -- and the frontend call sites disagreed about
      // whether to send the username or the full name. Both halves of the pair
      // come from the session so the id and the name can never describe two
      // different people (the rename cascade in lib/userIdentity.ts joins them
      // on cashier_id). body.cashier_id survives only as the fallback for a
      // request that somehow arrives without a session user.
      cashier_id: actorId(user) ?? (body.cashier_id || null),
      cashier_name: actorSnapshot(user),
      branch_id: body.branch_id || null,
      branch_name: branchRow?.name || null,
      customer_id: customer?.id || null,
      customer_name: body.customer_name || customer?.name || null,
      customer_phone: body.customer_phone || null,
      customer_address: body.customer_address || null,
      // Write-time diacritic fold of this sale's own searchable text fields
      // (migration 0082) -- the same normalizeSearchText the typed query is
      // run through, so folded queries match folded storage. Read additively
      // by buildSalesSearchWhere; membership_number is joined from customers
      // at read time, so it stays out of this per-row blob.
      search_normalized: normalizeSearchText(
        [receiptNumber, actorSnapshot(user), body.customer_name || customer?.name, body.customer_phone, branchRow?.name, paymentMethod]
          .filter(Boolean)
          .join(' '),
      ),
      payment_method: paymentMethod,
      payment_details: JSON.stringify(effectivePaymentDetails),
      payment_currency: body.payment_currency || 'USD',
      exchange_rate: exchangeRate,
      // An explicit per-sale boolean wins in either direction. Missing or
      // non-boolean values inherit the current setting. Persist that choice
      // so a later default change cannot retroactively change this sale.
      loyalty_accrual: (typeof body.loyalty_accrual === 'boolean' ? body.loyalty_accrual : loyaltyPointsEnabled) ? 1 : 0,
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
      change_usd: nativeChange.changeUsd,
      change_khr: nativeChange.changeKhr,
      change_is_actual: nativeChange.changeIsActual,
      change_exchange_rate: nativeChange.changeExchangeRate,
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
      delivery_actual_cost_usd: deliveryActualCostUsd,
      delivery_actual_cost_khr: deliveryActualCostKhr,
      sale_status: saleStatus,
    })
  const saleId = saleInsert.lastInsertRowid

  // 11.9: draw the damaged lots FIRST (each consumeDamagedLot is its own
  // atomic, self-guarding statement -- see the kernel); anything that
  // fails after this point restores them in its error path, the same
  // compensation shape the returns route uses for receiveBatchStock.
  const consumedDamagedLots: Array<{ lotId: number; quantity: number }> = []
  const restoreConsumedDamagedLots = async () => {
    for (const consumed of consumedDamagedLots) {
      try { await restoreDamagedLot(db, { lotId: consumed.lotId, quantity: consumed.quantity }) } catch { /* compensation is best-effort; the lot ledger still holds the draw */ }
    }
  }
  if (shouldDeductStock) {
    for (const item of damagedItems) {
      try {
        await consumeDamagedLot(db, { lotId: Number(item.damaged_lot_id), productId: item.product_id, quantity: item.quantity })
        consumedDamagedLots.push({ lotId: Number(item.damaged_lot_id), quantity: item.quantity })
      } catch (error) {
        await restoreConsumedDamagedLots()
        await db.prepare('DELETE FROM sales WHERE id = ?').run([saleId])
        const status = error instanceof DamagedLotShortfallError ? 409 : 400
        return c.json({ error: (error as Error).message }, status)
      }
    }
  }

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
                batch_id, batch_label, batch_expiry_date, damaged_lot_id
              )
              VALUES (
                @sale_id, @product_id, @product_name, @quantity, @applied_price_usd, @applied_price_khr,
                @cost_price_usd, @cost_price_khr, @total_usd, @total_khr, @branch_id,
                @price_mode, @product_discount_type, @product_discount_label, @product_discount_usd, @product_discount_khr,
                @base_price_usd, @base_price_khr, @manual_discount_type, @manual_discount_value, @manual_discount_usd, @manual_discount_khr,
                @batch_id, @batch_label, @batch_expiry_date, @damaged_lot_id
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
          damaged_lot_id: item.damaged_lot_id || null,
        },
      })
      // A damaged-source line's stock ALREADY moved (the lot draw above);
      // only its ledger entry rides this batch. Regular branch/batch
      // deductions never apply to it.
      if (item.damaged_lot_id && item.branch_id && shouldDeductStock) {
        statements.push({
          sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reference_id, user_id, user_name)
                VALUES (@product_id, @product_name, @branch_id, '${DAMAGE_OUT_MOVEMENT}', @quantity, @unit_cost_usd, @unit_cost_khr, @reference_id, @user_id, @user_name)`,
          params: {
            product_id: item.product_id,
            product_name: item.product_name,
            branch_id: item.branch_id,
            quantity: -item.quantity,
            unit_cost_usd: item.costPriceUsd,
            unit_cost_khr: item.costPriceKhr,
            reference_id: saleId,
            user_id: actorId(user),
            user_name: actorSnapshot(user),
          },
        })
      }
      if (item.batch_id && item.branch_id && shouldDeductStock && !item.damaged_lot_id) {
        // Strict (no MAX(0) clamp): under a race two sales can both pass the
        // plain-read availability check above, so the deduction itself is the
        // real guard -- an oversell of this lot violates branch_batch_stock's
        // CHECK(quantity >= 0) (migration 0058) and rolls the whole sale back.
        statements.push(decrementBatchStockStrictStatement(item.batch_id, item.branch_id, item.quantity))
      }
      // Z0: a multi-lot auto-allocated line (batch_id stays NULL) deducts
      // each allocated lot, same strictness as the explicit pick above.
      // Allocation is clamped to availability read moments ago, so an abort
      // here means a genuine concurrent draw on the same lot.
      if (!item.batch_id && item.branch_id && shouldDeductStock && !item.damaged_lot_id) {
        for (const take of autoAllocationsByItemIndex.get(itemIndex) || []) {
          statements.push(decrementBatchStockStrictStatement(take.batchId, item.branch_id, take.quantity))
        }
      }
      if (item.branch_id && shouldDeductStock && !item.damaged_lot_id) {
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
        // 0084: an explicit lot pick stamps the movement; a no-pick line
        // stamps its single auto-allocated lot only when that lot covered
        // the WHOLE quantity (a partial draw with a legacy-aggregate
        // remainder, or a multi-lot spread, stays NULL -- the per-lot
        // detail lives in sale_item_batch_allocations).
        const autoTakes = autoAllocationsByItemIndex.get(itemIndex) || []
        const movementBatchId = item.batch_id
          || (autoTakes.length === 1 && autoTakes[0].quantity === item.quantity ? autoTakes[0].batchId : null)
        statements.push({
          sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reference_id, user_id, user_name, batch_id)
                VALUES (@product_id, @product_name, @branch_id, 'sale', @quantity, @unit_cost_usd, @unit_cost_khr, @reference_id, @user_id, @user_name, @batch_id)`,
          params: {
            product_id: item.product_id,
            product_name: item.product_name,
            branch_id: item.branch_id,
            quantity: -item.quantity,
            unit_cost_usd: item.costPriceUsd,
            unit_cost_khr: item.costPriceKhr,
            reference_id: saleId,
            user_id: actorId(user),
            user_name: actorSnapshot(user),
            batch_id: movementBatchId,
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
    // Z0: one row per lot a line drew from -- single-lot lines (explicit
    // pick OR an auto-allocation one lot fully covered) and multi-lot
    // auto-allocated lines alike. released_quantity starts at 0 for a
    // deducting sale (units are OUT with the sale) and at the full take for
    // a non-deducting one (awaiting_payment -- nothing physically left, the
    // later deducting transition consumes released_quantity back down).
    const allocationItems = priced
      .map((item, itemIndex) => ({
        item,
        itemIndex,
        takes: item.batch_id && item.branch_id
          ? [{ batchId: item.batch_id, lotCode: item.batch_label || null, expiryDate: item.batch_expiry_date || null, quantity: item.quantity } as FifoLotTake]
          : autoAllocationsByItemIndex.get(itemIndex) || [],
      }))
      .filter(({ item, takes }) => takes.length && item.branch_id && !item.damaged_lot_id)
    if (allocationItems.length) {
      try {
        const allocationStatements = allocationItems.flatMap(({ item, itemIndex, takes }) => {
          const statementIndex = saleItemStatementIndexByItemIndex[itemIndex]
          const saleItemId = Number(batchResults[statementIndex]?.meta?.last_row_id || 0)
          if (!(saleItemId > 0)) return []
          return takes.map((take) => ({
            sql: `INSERT INTO sale_item_batch_allocations (sale_item_id, batch_id, branch_id, quantity, lot_code, expiry_date, released_quantity, released_at)
                  VALUES (@sale_item_id, @batch_id, @branch_id, @quantity, @lot_code, @expiry_date, @released_quantity, @released_at)`,
            params: {
              sale_item_id: saleItemId,
              batch_id: take.batchId,
              branch_id: item.branch_id,
              quantity: take.quantity,
              lot_code: take.lotCode || null,
              expiry_date: take.expiryDate || null,
              released_quantity: shouldDeductStock ? 0 : take.quantity,
              released_at: shouldDeductStock ? null : new Date().toISOString(),
            },
          }))
        })
        if (allocationStatements.length) await db.batch(allocationStatements)
      } catch (allocationError) {
        console.error('[sales] failed to record sale_item_batch_allocations (stock already deducted correctly)', allocationError)
      }
    }
  } catch (error) {
    // The atomic batch rolled back, so nothing here was applied; delete the
    // orphaned header written in step 4 so the caller never sees an itemless
    // sale. Damaged-lot draws happened before the batch -- hand them back.
    await restoreConsumedDamagedLots()
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
  c.executionCtx.waitUntil(Promise.all([
    bumpVersion(c.env, 'products'),
    bumpVersion(c.env, 'sales'),
  ]))
  // A method typed at the till joins the configured list (user, Sep 4 2026).
  // Off the response path: the sale is already recorded and must not be held
  // up, or failed, by a settings write. `settings` is bumped only when the
  // merge actually added something, so a normal checkout costs no invalidation.
  c.executionCtx.waitUntil(
    registerUsedPaymentMethods(c.env, { payment_method: paymentMethod, payment_details: effectivePaymentDetails })
      .then((added) => (added.length ? bumpVersion(c.env, 'settings') : undefined)),
  )
  c.executionCtx.waitUntil(sendTelegramEvent(c.env, {
    type: 'sales',
    // Receipt-summary shape (lib/telegram.ts formatSaleTelegramLines): status,
    // date, INV, cashier, customer + tel, item lines with per-line discount,
    // delivery service, total / discount / net / paid, driver.
    lines: formatSaleTelegramLines({
      status: saleStatus,
      createdAt: clientCreatedAt,
      receiptNumber,
      cashier: actorSnapshot(user),
      customer: body.customer_name || customer?.name || null,
      phone: body.customer_phone || null,
      branch: branchRow?.name || null,
      items: priced.map((item) => ({ name: item.product_name, quantity: item.quantity, unitPriceUsd: item.unitPriceUsd, basePriceUsd: Number(item.base_price_usd) || null, lineTotalUsd: item.lineTotalUsd })),
      exchangeRate,
      isDelivery,
      deliveryFeeUsd,
      deliveryPaidBy: deliveryFeePaidBy,
      driver: deliveryContact,
      subtotalUsd: round2(subtotalUsd),
      discountUsd: round2(discountUsd + membershipDiscountUsd),
      taxUsd,
      totalUsd,
      totalKhr,
      paidUsd: amountPaidUsd,
      paidKhr: amountPaidKhr,
      changeUsd: nativeChange.changeUsd,
      changeKhr: nativeChange.changeKhr,
      paymentMethod,
    }),
  }).catch((error) => console.error('[telegram] sale notification failed', error)))

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
    changeUsd: nativeChange.changeUsd,
    changeKhr: nativeChange.changeKhr,
    changeIsActual: nativeChange.changeIsActual,
    changeExchangeRate: nativeChange.changeExchangeRate,
    saleStatus,
    itemCount: priced.length,
  })
})

// PATCH /api/sales/:id/status -- change a sale's lifecycle status
// (completed / awaiting_payment / awaiting_delivery / cancelled; the two
// return statuses are set by the returns flow only).
//
// Rebuilt in Part 383 on lib/saleTransitions.ts's held() invariant: per
// line, held(status) = quantity - alreadyReturned for statuses where the
// goods are out (completed/awaiting_delivery/partial_return/returned) and
// 0 for awaiting_payment/cancelled; every transition moves exactly
// held(new) - held(old) on branch stock, the product total, AND the
// line's batch, as new movements (never by editing old ones). That closed
// the old boolean was/willBeDeducted logic's holes: partial_return ->
// cancelled restored nothing (un-returned units vanished), completed ->
// awaiting_payment restored the FULL quantity even when part had already
// come back through a return, and re-deducting transitions skipped batch
// stock. Cancelling requires a reason (+ note for 'other') and can record
// a lost fee into the fees ledger; un-cancelling goes back only to
// status_before_cancel and removes that fee row.

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

app.post('/bulk-status', async (c) => {
  try {
    const result = await applySaleBulkStatus(c.env, c.get('user'), await c.req.json())
    c.executionCtx.waitUntil(notifyBulkStatus(c.env))
    return c.json(result)
  } catch (error) {
    return c.json({ error: (error as Error).message }, error instanceof SaleBulkError ? error.statusCode : error instanceof SyntaxError ? 400 : 500)
  }
})

app.post('/bulk-update', async (c) => {
  try {
    const result = await applySaleBulkUpdate(c.env, c.get('user'), await c.req.json())
    c.executionCtx.waitUntil(notifySaleBulkUpdate(c.env, result.action?.kind))
    return c.json(result)
  } catch (error) {
    return c.json({ error: (error as Error).message }, error instanceof SaleBulkError ? error.statusCode : error instanceof SyntaxError ? 400 : 500)
  }
})

app.patch('/:id/status', async (c) => {
  const db = getDb(c.env)
  const user = c.get('user')
  // Status transitions (void/refund/complete/etc.) are only reachable from
  // the Sales page (see Sales.tsx's updateSaleStatus caller), which is
  // itself gated on the 'sales' permission -- the API endpoint needs the
  // same gate, since a plain POS-only cashier should not be able to void or
  // refund a sale via direct API calls.
  if (getActionTier(user, 'sales', 'status') !== 'full') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const id = c.req.param('id')
  const body = await c.req.json<{
    sale_status?: string
    notes?: string
    cancel_reason?: string
    cancel_note?: string
    cancel_fee_usd?: number
    cancel_fee_khr?: number
    cancel_fee_note?: string
    // Y10: payment recorded at completion time for a sale that was created
    // as awaiting_payment with no method (see POST / above).
    payment_method?: string
    payment_details?: Array<{ method?: string; amount_usd?: number | string; amount_khr?: number | string }>
    amount_paid_usd?: number | string
    amount_paid_khr?: number | string
    client_request_id?: string
    expected_exchange_rate?: number | string
    // S4-2: admin-only "Don't touch stock" -- change the status and move
    // NO stock (see lib/saleTransitions.ts's planSaleStockTransition for
    // why, and why it is sticky once set).
    skip_stock?: boolean
    [key: string]: unknown
  }>().catch(() => ({} as Record<string, unknown>))
  const saleStatus = String(body.sale_status || '')

  // S4-2, server side. The UI hides the toggle behind an admin check AND a
  // lock, but a hidden control is not a permission: the flag is refused
  // here for anyone who is not an administrator, using the same
  // isAdminControlUser() gate that guards user management, device approval
  // and loyalty awards (reserved `admin` username, `admin` role code, or an
  // explicit permissions.all grant). Refused loudly -- never silently
  // downgraded to a normal stock-moving transition, which would deduct
  // units the caller explicitly said not to touch.
  const skipStockRequested = body.skip_stock === true || String(body.skip_stock ?? '') === 'true'
  if (skipStockRequested && !isAdminControlUser(user)) {
    return c.json({ error: 'Administrator access required to change a sale status without touching stock.' }, 403)
  }

  if (!saleStatus || !VALID_SALE_STATUSES.includes(saleStatus)) {
    return c.json({ error: `Invalid status. Must be one of: ${VALID_SALE_STATUSES.join(', ')}` }, 400)
  }

  const paymentFieldsSent = body.payment_method !== undefined
    || body.payment_details !== undefined
    || body.amount_paid_usd !== undefined
    || body.amount_paid_khr !== undefined
  if (body.payment_method !== undefined || body.amount_paid_usd !== undefined || body.amount_paid_khr !== undefined) {
    return c.json({ error: 'Send the full payment_details snapshot; payment totals and summary are derived by the server.', code: 'unsupported_payment_aggregate' }, 400)
  }
  const settlementRequestId = paymentFieldsSent ? normalizeClientRequestId(body.client_request_id) : null
  if (paymentFieldsSent && !settlementRequestId) {
    return c.json({ error: 'client_request_id is required when settling a sale.', code: 'client_request_id_required' }, 400)
  }
  const settlementCanonical = paymentFieldsSent ? JSON.stringify({
    sale_id: Number(id),
    sale_status: saleStatus,
    payment_details: body.payment_details,
    expected_exchange_rate: body.expected_exchange_rate,
  }) : null
  const settlementDigest = settlementCanonical ? await saleMutationDigest(JSON.parse(settlementCanonical)) : null
  if (settlementRequestId && settlementDigest) {
    const previous = await db.prepare(`
      SELECT request_digest,response_json FROM sale_mutation_receipts
      WHERE actor_id=@actor AND mutation_kind='settlement' AND request_id=@request
    `).get<{ request_digest: string; response_json: string }>({ actor: user.id, request: settlementRequestId })
    if (previous) {
      if (previous.request_digest !== settlementDigest) {
        return c.json({ error: 'client_request_id was already used with different settlement data.', code: 'idempotency_conflict' }, 409)
      }
      return c.json(JSON.parse(previous.response_json) as Record<string, unknown>)
    }
  }

  const sale = await db.prepare('SELECT s.*, COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=s.id),0) AS write_revision FROM sales s WHERE id = ?').get<Record<string, unknown> & {
    id: number
    sale_status: string | null
    updated_at: string | null
    branch_id: number | null
    receipt_number: string | null
    status_before_cancel: string | null
    cancel_fee_id: number | null
    // migration 0114; absent (undefined) on a database that has not run it.
    stock_skipped: number | null
  }>([id])
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
  if (oldStatus === saleStatus && !paymentFieldsSent) {
    return c.json({ id: Number(id), sale_status: saleStatus, updated_at: sale.updated_at || null })
  }

  // Which transitions are legal at all (returns-flow ownership of
  // partial_return/returned; un-cancel only back to where the sale was) --
  // see lib/saleTransitions.ts.
  const guard = guardSaleStatusTransition(oldStatus, saleStatus, sale.status_before_cancel || null)
  if (!guard.ok) return c.json({ error: guard.error }, 400)

  // S4-2: is this transition outside the stock ledger? Either the admin
  // asked for it now, or this sale was ALREADY marked stock-skipped by an
  // earlier transition. The second half is the important one: a sale that
  // reached `completed` without the system deducting anything must never
  // later "give back" units it never took (a cancel would compute
  // delta = 0 - held(completed) and invent stock). Once skipped, always
  // skipped -- see the long note on planSaleStockTransition.
  const saleAlreadyStockSkipped = Number(sale.stock_skipped || 0) === 1
  const skipStock = skipStockRequested || saleAlreadyStockSkipped

  // Cancelling requires its reason (Mistake / Buyer didn't buy / Other +
  // note), and may carry the lost fee -- e.g. a delivery fee the shop
  // already paid out that the buyer refused to cover.
  let cancelReason: CancelReason | null = null
  let cancelNote: string | null = null
  let cancelFeeUsd = 0
  let cancelFeeKhr = 0
  let cancelFeeNote: string | null = null
  if (saleStatus === 'cancelled') {
    cancelReason = normalizeCancelReason(body.cancel_reason)
    if (!cancelReason) {
      return c.json({ error: `Choose a cancellation reason: ${CANCEL_REASONS.join(', ')}.` }, 400)
    }
    cancelNote = String(body.cancel_note || '').trim() || null
    if (cancelReason === 'other' && !cancelNote) {
      return c.json({ error: 'The "Other" reason needs a note saying what happened.' }, 400)
    }
    cancelFeeUsd = round2(Math.max(0, Number(body.cancel_fee_usd) || 0))
    cancelFeeKhr = Math.max(0, Math.round(Number(body.cancel_fee_khr) || 0))
    cancelFeeNote = String(body.cancel_fee_note || '').trim() || null
  }

  const items = await db.prepare('SELECT id, product_id, product_name, quantity, cost_price_usd, cost_price_khr, branch_id, batch_id, damaged_lot_id FROM sale_items WHERE sale_id = ?').all<SaleItemRow & { damaged_lot_id: number | null }>([id])

  // How much of each line already came back through real returns
  // (non-cancelled, customer scope; return_to_stock does NOT matter here:
  // a restocked unit is on the shelf and a damaged one is written off by
  // its return record -- either way it is no longer "out with this sale",
  // so a cancel must not re-add it and an un-cancel must not re-take it).
  const returnedRows = await db.prepare(`
    SELECT ri.sale_item_id AS sale_item_id, ri.product_id AS product_id, SUM(ri.quantity) AS quantity
    FROM return_items ri
    JOIN returns r ON r.id = ri.return_id
    WHERE r.sale_id = @saleId
      AND COALESCE(r.status, 'completed') != 'cancelled'
      AND COALESCE(r.return_scope, 'customer') = 'customer'
    GROUP BY ri.sale_item_id, ri.product_id
  `).all<{ sale_item_id: number | null; product_id: number | null; quantity: number }>({ saleId: id })
  const itemLevelReturned = new Map<number, number>()
  const productLevelReturned = new Map<number, number>()
  for (const row of returnedRows) {
    const qty = Math.max(0, Number(row.quantity) || 0)
    if (!qty) continue
    if (row.sale_item_id) itemLevelReturned.set(Number(row.sale_item_id), (itemLevelReturned.get(Number(row.sale_item_id)) || 0) + qty)
    else if (row.product_id) productLevelReturned.set(Number(row.product_id), (productLevelReturned.get(Number(row.product_id)) || 0) + qty)
  }
  const returnedByItem = allocateReturnedQuantities(items, itemLevelReturned, productLevelReturned)

  const movementReason = saleStatus === 'cancelled'
    ? `Sale cancelled (${cancelReasonLabel(cancelReason!)})${cancelNote ? ` -- ${cancelNote}` : ''}`
    : oldStatus === 'cancelled'
      ? `Sale cancellation reverted (back to ${saleStatus})`
      : `Sale status changed from ${oldStatus} to ${saleStatus}`
  // 11.9: damaged-source lines never touch branch/batch stock -- their
  // units live in damaged_stock_lots.quantity_remaining, so the branch
  // plan below runs on the regular lines only and the damaged lines get
  // their own ops on the SAME heldQuantity state machine.
  const regularItems = items.filter((item) => !item.damaged_lot_id)
  // Z0: attach each line's recorded lot allocations (migration 0078) so the
  // transition kernel restores/re-deducts to the SAME batches the sale drew
  // from -- draw order (id ASC), which the kernel walks in reverse to give
  // last-drawn units back first. A line with no allocation rows (old sales,
  // or a line the lot ledger never tracked) falls back to its single
  // batch_id, unchanged.
  const regularItemIds = regularItems.map((item) => Number(item.id)).filter((value) => value > 0)
  if (regularItemIds.length) {
    const allocRows = await selectInChunks(regularItemIds, 0, (chunk) => db
      .prepare(`SELECT id, sale_item_id, batch_id, quantity, released_quantity FROM sale_item_batch_allocations WHERE sale_item_id IN (${chunk.map(() => '?').join(',')}) ORDER BY id ASC`)
      .all<{ id: number; sale_item_id: number; batch_id: number; quantity: number; released_quantity: number }>(chunk))
    const allocByItem = new Map<number, SaleItemAllocation[]>()
    for (const row of allocRows) {
      const list = allocByItem.get(Number(row.sale_item_id)) || []
      list.push({ id: Number(row.id), batch_id: Number(row.batch_id), quantity: Number(row.quantity) || 0, released_quantity: Number(row.released_quantity) || 0 })
      allocByItem.set(Number(row.sale_item_id), list)
    }
    for (const item of regularItems) {
      const list = allocByItem.get(Number(item.id))
      if (list && list.length) (item as SaleItemRow & { allocations?: SaleItemAllocation[] }).allocations = list
    }
  }
  const damagedTransitionOps: Array<{ lotId: number; productId: number; productName: string | null; branchId: number | null; delta: number }> = []
  let skippedDamagedUnits = 0
  for (const item of items) {
    if (!item.damaged_lot_id || !item.product_id) continue
    const returned = Math.max(0, Number(returnedByItem.get(item.id)) || 0)
    const delta = heldQuantity(saleStatus, item.quantity, returned) - heldQuantity(oldStatus, item.quantity, returned)
    if (delta === 0) continue
    // S4-2: a damaged lot is stock too -- "don't touch stock" means all of
    // it, so these ops (and their damage movements) are counted and then
    // NOT queued, rather than half-applying the transition.
    if (skipStock) {
      skippedDamagedUnits += Math.abs(delta)
      continue
    }
    damagedTransitionOps.push({ lotId: Number(item.damaged_lot_id), productId: item.product_id, productName: item.product_name, branchId: item.branch_id, delta })
  }

  const plan = planSaleStockTransition({
    saleId: id,
    oldStatus,
    newStatus: saleStatus,
    items: regularItems,
    returnedByItem,
    reason: movementReason,
    userId: user?.id ?? null,
    userName: actorSnapshot(user),
    skipStock,
  })
  const totalSkippedUnits = plan.skippedUnits + skippedDamagedUnits

  // Pre-flight availability for anything the plan TAKES (plain read; the
  // CHECK(quantity >= 0) constraints below remain the real race guard,
  // same validate-then-batch shape as POST / -- see lib/db.ts's batch()).
  for (const deduction of plan.deductions) {
    const stockRow = await db.prepare('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = ?').get<{ quantity: number }>([deduction.product_id, deduction.branch_id])
    const available = stockRow?.quantity || 0
    if (deduction.quantity > available) {
      const name = items.find((item) => item.product_id === deduction.product_id)?.product_name || `product #${deduction.product_id}`
      return c.json({ error: `Insufficient stock for ${name}: requested ${deduction.quantity}, available ${available}` }, 409)
    }
  }

  const mutationStamp = new Date().toISOString()
  const statements: Array<{ sql: string; params: Record<string, unknown> }> = [saleRevisionGuard(Number(id), Number(sale.write_revision))]
  const updates = ['sale_status = @sale_status', 'updated_at = @updated_at']
  const updateParams: Record<string, unknown> = { sale_status: saleStatus, id, updated_at: mutationStamp }
  const emptySettlementNote = paymentFieldsSent && body.notes !== undefined && !String(body.notes ?? '').trim()
  if (body.notes !== undefined && !emptySettlementNote) {
    updates.push('notes = @notes')
    updateParams.notes = body.notes
  }

  // S4-2: WRITE DOWN that stock was deliberately not moved (migration
  // 0114). Without this a sale whose deduction was skipped on purpose is
  // indistinguishable, next month, from one whose deduction was lost to a
  // bug -- and the flag is also what makes the skip sticky, so the sale's
  // later transitions cannot invent the units back. Stamped once, on the
  // transition that first skipped; re-marking is a no-op.
  if (skipStockRequested && !saleAlreadyStockSkipped) {
    updates.push(
      'stock_skipped = 1',
      "stock_skipped_at = datetime('now')",
      'stock_skipped_by_name = @stock_skipped_by_name',
    )
    updateParams.stock_skipped_by_name = actorSnapshot(user)
  }

  // Y10: the payment for an awaiting-payment sale is decided when it is
  // completed -- accept it here, on exactly that transition. Same
  // normalization rules as POST /. Payment fields on any other transition
  // are refused rather than silently dropped.
  let settlementSnapshot: SaleSettlementSnapshot | null = null
  let settlementResponse: Record<string, unknown> | null = null
  let settlementOperationId: string | null = null
  let settlementHistoryIndex = -1
  let settlementLineStatements: Array<{ sql: string; params: Record<string, unknown> }> = []
  if (paymentFieldsSent) {
    const isDeferredPaymentSettle = oldStatus === 'awaiting_payment'
      && (saleStatus === 'completed' || saleStatus === 'awaiting_delivery')
    if (!isDeferredPaymentSettle) {
      return c.json({ error: 'Payment can only be recorded when completing an awaiting-payment sale.' }, 400)
    }
    if ((body.notes !== undefined && !emptySettlementNote) || skipStockRequested) {
      return c.json({ error: 'Settle payment separately from notes or stock overrides.' }, 400)
    }
    const settingRows = await db.prepare(`
      SELECT key,value FROM settings WHERE key IN ('exchange_rate','change_exchange_rate','pos_payment_methods')
    `).all<{ key: string; value: string }>()
    const settingMap = Object.fromEntries(settingRows.map((row) => [row.key, row.value]))
    const latestRate = Number(settingMap.exchange_rate || 4100)
    const reviewedRate = Number(body.expected_exchange_rate)
    if (!Number.isFinite(reviewedRate) || reviewedRate <= 0) {
      return c.json({ error: 'expected_exchange_rate is required to confirm the reviewed settlement.', code: 'expected_exchange_rate_required', current_exchange_rate: latestRate }, 400)
    }
    if (!Number.isFinite(latestRate) || latestRate <= 0 || Math.abs(reviewedRate - latestRate) > 0.0000001) {
      return c.json({ error: 'The exchange rate changed. Review the payment again.', code: 'exchange_rate_changed', current_exchange_rate: latestRate, current: { exchange_rate: latestRate } }, 409)
    }
    let settlementPlan
    try {
      settlementPlan = planSaleSettlement({
        configuredMethodsRaw: settingMap.pos_payment_methods,
        paymentDetailsRaw: body.payment_details,
        existingPaidUsd: sale.amount_paid_usd,
        existingPaidKhr: sale.amount_paid_khr,
        existingPaymentDetailsRaw: sale.payment_details,
        existingPaymentMethodRaw: sale.payment_method,
        totalUsd: sale.total_usd,
        exchangeRate: latestRate,
        changeExchangeRateRaw: settingMap.change_exchange_rate,
      })
    } catch (error) {
      if (error instanceof SettlementValidationError) return c.json({ error: error.message, code: error.code }, error.statusCode)
      throw error
    }
    const before = await readSaleSettlementState(db, Number(id))
    if (!before) return c.json({ error: 'Sale not found' }, 404)
    const lineMoneyRows = await db.prepare(`
      SELECT id,applied_price_usd,total_usd,product_discount_usd,
             base_price_usd,manual_discount_usd
      FROM sale_items WHERE sale_id=@id ORDER BY id
    `).all<Record<string, unknown>>({ id: Number(id) })
    const after = buildSaleSettlementAfterState(before, sale, lineMoneyRows, saleStatus, settlementPlan)
    updates.push(
      'exchange_rate = @exchange_rate',
      'subtotal_khr = @subtotal_khr',
      'discount_khr = @discount_khr',
      'tax_khr = @tax_khr',
      'total_khr = @total_khr',
      'delivery_fee_khr = @delivery_fee_khr',
      'membership_discount_khr = @membership_discount_khr',
      'payment_method = @payment_method',
      'payment_details = @payment_details',
      'payment_currency = @payment_currency',
      'amount_paid_usd = @amount_paid_usd',
      'amount_paid_khr = @amount_paid_khr',
      'change_usd = @change_usd',
      'change_khr = @change_khr',
      'change_is_actual = @change_is_actual',
      'change_exchange_rate = @change_exchange_rate',
      'search_normalized = @search_normalized',
    )
    Object.assign(updateParams, { ...after, lines: undefined })
    settlementLineStatements = saleSettlementStateStatements(Number(id), after, mutationStamp).slice(1)
    settlementOperationId = crypto.randomUUID()
    settlementSnapshot = { version: 1, operationId: settlementOperationId, saleId: Number(id), receiptNumber: sale.receipt_number == null ? null : String(sale.receipt_number), before, after }
    settlementResponse = {
      id: Number(id),
      sale_status: saleStatus,
      updated_at: mutationStamp,
      exchange_rate: after.exchange_rate,
      payment_method: after.payment_method,
      payment_details: after.payment_details,
      payment_currency: after.payment_currency,
      amount_paid_usd: after.amount_paid_usd,
      amount_paid_khr: after.amount_paid_khr,
      change_usd: after.change_usd,
      change_khr: after.change_khr,
      change_is_actual: after.change_is_actual,
      change_exchange_rate: after.change_exchange_rate,
      actionKind: SALE_SETTLEMENT_ACTION_KIND,
      operationId: settlementOperationId,
      currentReplayGeneration: 0,
    }
    statements.unshift(
      { sql: 'DELETE FROM sale_mutation_guards', params: {} },
      saleMutationGuard(`
        COALESCE((SELECT value FROM settings WHERE key='exchange_rate'),'')=@exchangeRate
        AND COALESCE((SELECT value FROM settings WHERE key='change_exchange_rate'),'')=@changeRate
        AND COALESCE((SELECT value FROM settings WHERE key='pos_payment_methods'),'')=@paymentMethods
      `, {
        exchangeRate: settingMap.exchange_rate ?? '',
        changeRate: settingMap.change_exchange_rate ?? '',
        paymentMethods: settingMap.pos_payment_methods ?? '',
      }),
    )
  }
  if (saleStatus === 'cancelled') {
    updates.push(
      'cancel_reason = @cancel_reason',
      'cancel_note = @cancel_note',
      "cancelled_at = datetime('now')",
      'cancelled_by_name = @cancelled_by_name',
      'status_before_cancel = @status_before_cancel',
    )
    updateParams.cancel_reason = cancelReason
    updateParams.cancel_note = cancelNote
    updateParams.cancelled_by_name = actorSnapshot(user)
    updateParams.status_before_cancel = oldStatus
  } else if (oldStatus === 'cancelled') {
    // Un-cancel: the cancellation record clears, and its linked lost-fee
    // expense row (if any) is removed WITH it, atomically -- money
    // reporting must not keep a loss for a sale that is live again. The
    // deletion is auditable below.
    updates.push(
      'cancel_reason = NULL',
      'cancel_note = NULL',
      'cancelled_at = NULL',
      'cancelled_by_name = NULL',
      'status_before_cancel = NULL',
      'cancel_fee_id = NULL',
    )
    if (sale.cancel_fee_id) {
      statements.push({ sql: 'DELETE FROM fees WHERE id = @feeId', params: { feeId: sale.cancel_fee_id } })
    }
  }
  // Keep cancellation money and lifecycle state in the same transaction.
  // The former post-commit insert could leave a cancelled/restocked sale with
  // no linked fee, which also made a later un-cancel impossible to reverse
  // exactly. last_insert_rowid() is consumed by the immediately following
  // sale UPDATE in this one D1 batch.
  if (saleStatus === 'cancelled' && (cancelFeeUsd > 0 || cancelFeeKhr > 0)) {
    statements.push({
      sql: `INSERT INTO fees (fee_type, label, amount_usd, amount_khr, fee_date, sale_id, branch_id, notes, created_by, created_by_name)
            VALUES ('expense', @label, @amount_usd, @amount_khr, date('now'), @sale_id, @branch_id, @notes, @created_by, @created_by_name)`,
      params: {
        label: `Cancelled sale ${sale.receipt_number || id} -- lost fee`,
        amount_usd: cancelFeeUsd,
        amount_khr: cancelFeeKhr,
        sale_id: Number(id),
        branch_id: sale.branch_id ?? null,
        notes: cancelFeeNote || `Fee lost to cancellation (${cancelReasonLabel(cancelReason!)})`,
        created_by: user?.id ?? null,
        created_by_name: actorSnapshot(user),
      },
    })
    updates.push('cancel_fee_id = last_insert_rowid()')
  }
  statements.push({ sql: `UPDATE sales SET ${updates.join(', ')} WHERE id = @id`, params: updateParams })
  statements.push(...settlementLineStatements)
  statements.push(...plan.statements)

  // A provisional restore can be spent by another request before a status
  // conflict is discovered. Keep damaged stock and its ledger in the SAME
  // revision-guarded batch as regular stock, with the bulk path's identity
  // and quantity bounds. Any failure rolls back the entire transition.
  for (const op of damagedTransitionOps) {
    const lotParams = { lot: op.lotId, product: op.productId, branch: op.branchId, q: -op.delta }
    statements.push(bulkAssertion(
      'EXISTS(SELECT 1 FROM damaged_stock_lots WHERE id=@lot AND product_id=@product AND branch_id IS @branch AND quantity_remaining+@q BETWEEN 0 AND quantity)',
      lotParams,
    ))
    statements.push({
      sql: `UPDATE damaged_stock_lots SET quantity_remaining=quantity_remaining+@q, updated_at=datetime('now') WHERE id=@lot`,
      params: lotParams,
    })
    statements.push({
      sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name)
            VALUES (@product_id, @product_name, @branch_id, '${op.delta > 0 ? DAMAGE_OUT_MOVEMENT : DAMAGE_IN_MOVEMENT}', @quantity, 0, 0, @reason, @reference_id, @user_id, @user_name)`,
      params: {
        product_id: op.productId,
        product_name: op.productName,
        branch_id: op.branchId,
        quantity: -op.delta,
        reason: movementReason,
        reference_id: id,
        user_id: user?.id ?? null,
        user_name: actorSnapshot(user),
      },
    })
  }

  if (settlementSnapshot && settlementResponse && settlementOperationId && settlementRequestId && settlementDigest && settlementCanonical) {
    const historyPayload = JSON.stringify({
      applier: SALE_SETTLEMENT_ACTION_KIND,
      operation_id: settlementOperationId,
      generation: 0,
    })
    settlementHistoryIndex = statements.length
    statements.push({
      sql: `INSERT INTO action_history(
              scope,entity,entity_id,label,undo_label,redo_label,reversible,status,
              undo_payload,redo_payload,created_by_id,created_by_name
            ) VALUES(
              'sales','sale',@saleId,@label,@undoLabel,@redoLabel,1,'undoable',
              @payload,@payload,@actor,@actorName
            )`,
      params: {
        saleId: String(id),
        label: `Settled sale ${sale.receipt_number || `#${id}`}`,
        undoLabel: `Undo settlement of sale ${sale.receipt_number || `#${id}`}`,
        redoLabel: `Redo settlement of sale ${sale.receipt_number || `#${id}`}`,
        payload: historyPayload,
        actor: user.id,
        actorName: actorSnapshot(user),
      },
    })
    statements.push({
      sql: `INSERT INTO sale_mutation_receipts(
              id,actor_id,sale_id,mutation_kind,request_id,request_digest,request_json,
              before_json,after_json,response_json,history_id,generation,sale_revision,updated_at
            ) VALUES(
              @operation,@actor,@saleId,'settlement',@request,@digest,@requestJson,
              @beforeJson,@afterJson,json_set(@responseJson,'$.actionHistoryId',last_insert_rowid()),
              last_insert_rowid(),0,
              COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=@saleId),0),@stamp
            )`,
      params: {
        operation: settlementOperationId,
        actor: user.id,
        saleId: Number(id),
        request: settlementRequestId,
        digest: settlementDigest,
        requestJson: settlementCanonical,
        beforeJson: JSON.stringify(settlementSnapshot.before),
        afterJson: JSON.stringify(settlementSnapshot.after),
        responseJson: JSON.stringify(settlementResponse),
        stamp: mutationStamp,
      },
    })
    statements.push({
      sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value)
            VALUES(@actor,@actorName,'sale_settlement','sale',@saleId,@details,'sale',@saleId,@details)`,
      params: {
        actor: user.id,
        actorName: actorSnapshot(user),
        saleId: String(id),
        details: JSON.stringify({
          operationId: settlementOperationId,
          before: settlementSnapshot.before,
          after: settlementSnapshot.after,
        }),
      },
    })
  }

  statements.push({ sql: 'DELETE FROM sale_bulk_guards', params: {} })
  if (settlementSnapshot) statements.push({ sql: 'DELETE FROM sale_mutation_guards', params: {} })
  try {
    const results = await db.batch(statements)
    if (settlementResponse && settlementHistoryIndex >= 0) {
      settlementResponse.actionHistoryId = Number(results[settlementHistoryIndex]?.meta?.last_row_id || 0)
    }
  } catch (error) {
    const message = (error as Error).message || ''
    if (settlementRequestId && settlementDigest) {
      const retry = await db.prepare(`
        SELECT request_digest,response_json FROM sale_mutation_receipts
        WHERE actor_id=@actor AND mutation_kind='settlement' AND request_id=@request
      `).get<{ request_digest: string; response_json: string }>({ actor: user.id, request: settlementRequestId })
      if (retry) {
        if (retry.request_digest === settlementDigest) return c.json(JSON.parse(retry.response_json) as Record<string, unknown>)
        return c.json({ error: 'client_request_id was already used with different settlement data.', code: 'idempotency_conflict' }, 409)
      }
    }
    if (/guard_value/i.test(message)) {
      return c.json({ error: 'This sale changed while the status update was being prepared. Refresh and try again.', code: 'write_conflict' }, 409)
    }
    // Same race guard as POST /: a CHECK(quantity >= 0) failure means a
    // concurrent sale consumed the stock (or the line's specific lot)
    // between the availability read above and this write. The batch rolled
    // back atomically (status unchanged, nothing moved), so just report
    // the shortage as a 409 rather than a 500.
    if (/CHECK constraint|constraint failed/i.test(message)) {
      return c.json({ error: 'Insufficient stock to complete this sale: another sale took the last units first. Refresh and try again.', code: 'stock_conflict' }, 409)
    }
    throw error
  }

  await audit(c.env, user?.id ?? null, actorSnapshot(user), 'update', 'sale', id, {
    oldStatus,
    newStatus: saleStatus,
    ...(cancelReason ? { cancelReason, cancelNote, cancelFeeUsd, cancelFeeKhr } : {}),
    ...(oldStatus === 'cancelled' && sale.cancel_fee_id ? { removedCancelFeeId: sale.cancel_fee_id } : {}),
    restoredUnits: plan.restoredUnits,
    deductedUnits: plan.deductedUnits,
    // S4-2: the second half of "record that stock was deliberately
    // skipped" -- the sale carries the flag, the audit trail carries WHO,
    // WHEN, HOW MANY units were not moved, and whether this transition
    // asked for it or merely inherited an earlier skip.
    ...(skipStock ? {
      stockSkipped: true,
      stockSkippedUnits: totalSkippedUnits,
      stockSkipSource: skipStockRequested ? 'requested' : 'sale_already_stock_skipped',
    } : {}),
  })
  // Same cache-invalidation reasoning as POST / above -- a status change
  // here can deduct or restore stock.
  c.executionCtx.waitUntil(Promise.all([
    bumpVersion(c.env, 'products'),
    bumpVersion(c.env, 'sales'),
    ...((sale.cancel_fee_id || (saleStatus === 'cancelled' && (cancelFeeUsd > 0 || cancelFeeKhr > 0)))
      ? [broadcast(c.env, 'fees', { action: 'update' })]
      : []),
  ]))
  const updated = await db.prepare('SELECT id, sale_status, updated_at FROM sales WHERE id = ?').get<{ id: number; sale_status: string; updated_at: string }>([id])
  const payload = settlementResponse || updated || { id: Number(id), sale_status: saleStatus }
  // S4-6: name who made the change. The actor is the request's authenticated
  // user (requireAuth, above) -- known synchronously here regardless of
  // whether it is ALSO persisted for later in-app display (that is S4-11b's
  // job, a separate action_history column). Same name/username fallback as
  // the sale-recorded message's Cashier line (line ~954) and the same
  // omit-the-line-if-unknown idiom `by` already uses in
  // formatStockChangeTelegramLines/formatTransferTelegramLines/
  // formatReturnTelegramLines, rather than printing "By: undefined".
  const actorName = actorSnapshot(user)
  c.executionCtx.waitUntil(sendTelegramEvent(c.env, {
    type: 'status',
    lines: [
      `Receipt: ${sale.receipt_number || id}`,
      `Status: ${oldStatus.replace(/_/g, ' ')} → ${saleStatus.replace(/_/g, ' ')}`,
      sale.customer_name ? `Customer: ${sale.customer_name}` : '',
      cancelReason ? `Reason: ${cancelReasonLabel(cancelReason)}` : '',
      // S4-2: say it out loud on the shop's channel too -- a status change
      // that moved no stock must not look like a normal one.
      skipStock ? `Stock: not changed (${totalSkippedUnits} unit${totalSkippedUnits === 1 ? '' : 's'} deliberately skipped)` : '',
      cancelFeeUsd || cancelFeeKhr ? `Lost fee: ${telegramMoney(cancelFeeUsd, cancelFeeKhr)}` : '',
      actorName ? `By: ${actorName}` : '',
    ],
  }).catch((error) => console.error('[telegram] sale status notification failed', error)))
  // S4-2: echo the skip back so the client can badge the sale immediately
  // (and so a scripted caller can assert the flag actually took effect).
  const statusPayload = skipStock ? { ...payload, stock_skipped: 1 } : payload
  return c.json(statusPayload)
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
  if (getActionTier(user, 'sales', 'customer') !== 'full') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const saleId = c.req.param('id')
  const body = await c.req.json<{ customerId?: number; membershipNumber?: string; clearAssignment?: boolean; [key: string]: unknown }>().catch(() => ({} as Record<string, unknown>))

  const sale = await db.prepare('SELECT s.*,COALESCE(v.revision,0) AS write_revision FROM sales s LEFT JOIN sale_write_revisions v ON v.sale_id=s.id WHERE s.id = ?').get<Record<string, unknown> & { id: number; customer_id: number | null; updated_at: string | null; write_revision: number }>([saleId])
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

  const customerSearchNormalized = normalizeSearchText([
    sale.receipt_number,
    sale.cashier_name,
    customer?.name,
    customer?.phone,
    sale.branch_name,
    sale.payment_method,
  ].filter(Boolean).join(' '))
  const customerReferenceGuard = customer
    ? bulkAssertion("EXISTS(SELECT 1 FROM customers WHERE id=@id AND COALESCE(name,'')=COALESCE(@name,'') AND COALESCE(phone,'')=COALESCE(@phone,'') AND COALESCE(address,'')=COALESCE(@address,''))", {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
    })
    : null

  try {
    await db.batch([
      saleRevisionGuard(Number(saleId), Number(sale.write_revision)),
      ...(customerReferenceGuard ? [customerReferenceGuard] : []),
      {
      sql: `UPDATE sales SET customer_id = @customer_id, customer_name = @customer_name, customer_phone = @customer_phone, customer_address = @customer_address, search_normalized = @search_normalized, updated_at = CURRENT_TIMESTAMP WHERE id = @id`,
      params: {
        customer_id: customer?.id ?? null,
        customer_name: customer?.name ?? null,
        customer_phone: customer?.phone ?? null,
        customer_address: customer?.address ?? null,
        search_normalized: customerSearchNormalized,
        id: saleId,
      },
      },
      {
      sql: `UPDATE returns SET customer_id = @customer_id, customer_name = @customer_name, updated_at = CURRENT_TIMESTAMP WHERE sale_id = @sale_id`,
      params: { customer_id: customer?.id ?? null, customer_name: customer?.name ?? null, sale_id: saleId },
      },
      { sql: 'DELETE FROM sale_bulk_guards', params: {} },
    ])
  } catch (error) {
    if (/constraint/i.test(String(error))) {
      return c.json({ error: 'This sale or one of its linked returns changed. Refresh and try again.', code: 'write_conflict' }, 409)
    }
    throw error
  }

  await audit(c.env, user?.id ?? null, actorSnapshot(user), 'update', 'sale', saleId, {
    previous_customer_id: sale.customer_id ?? null,
    next_customer_id: customer?.id ?? null,
    membership_number: customer?.membership_number ?? null,
    cleared: shouldClear,
  })

  c.executionCtx.waitUntil(Promise.all([
    bumpVersion(c.env, 'sales'),
    bumpVersion(c.env, 'returns'),
  ]))

  const updated = await db.prepare('SELECT id, customer_id, customer_name, updated_at FROM sales WHERE id = ?').get<{ id: number; customer_id: number | null; customer_name: string | null; updated_at: string }>([saleId])
  return c.json({
    ...(updated || { id: Number(saleId) }),
    customer: customer
      ? { id: customer.id, name: customer.name || null, membership_number: customer.membership_number || null, phone: customer.phone || null, address: customer.address || null }
      : null,
  })
})

// ---------------------------------------------------------------------------
// POST /api/sales/:id/items -- add product lines to a sale that already
// exists (S4-24b).
//
// Until now the Sales page could change a sale's status, its customer and
// its membership, but never its CONTENTS: a customer who asked for one more
// item right after paying had to be rung up as a second, unrelated sale.
//
// Every rule this endpoint applies -- which statuses accept a line, how many
// units leave the shelf, which lots they come from, and what happens to the
// totals -- lives in lib/saleLineAddition.ts, which a pure test drives
// against a real in-memory schema (scripts/test-sale-add-items-pure.cjs).
// This handler is the I/O around it: gate, read, plan, one atomic batch,
// bookkeeping, undo record.
//
// It deliberately does NOT touch the PATCH /:id/status handler above or its
// transition planner -- a line added here is a NEW held quantity, computed
// by the same heldQuantity() invariant that route moves stock by, not a
// status change.
//
// PERMISSION (decision 5): the granular `sales -> add_items` action at FULL
// tier, server-side. Adding goods to a recorded sale moves stock and raises
// what the customer owes, so it is not covered by the coarse 'sales' grant
// (a view-tier bookkeeper must not reach it) and it is not the same act as
// changing a status, so it is not folded into `sales.status` either. The
// undo applier declares the identical permission+action, so a replay cannot
// be the one path that writes this section more loosely than the route.
//
// NOT BUILT here, on purpose: damaged-lot sourcing (POST /'s damaged_lot_id
// path), per-line manual/product discounts, and membership point redemption
// against the added line. Each is its own money rule and none of them has a
// place to be entered on this surface yet.
app.post('/:id/items', async (c) => {
  const db = getDb(c.env)
  const user = c.get('user')
  if (getActionTier(user, 'sales', 'add_items') !== 'full') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }

  const id = c.req.param('id')
  const body = await c.req.json<{
    items?: Array<{
      product_id?: number
      id?: number
      quantity?: number
      applied_price_usd?: number
      branch_id?: number
      batch_id?: number | null
      batch_label?: string | null
      batch_expiry_date?: string | null
    }>
    notes?: string
    client_request_id?: string
    expected_exchange_rate?: number | string
    [key: string]: unknown
  }>().catch(() => ({} as Record<string, unknown>))

  const addItemsRequestId = normalizeClientRequestId(body.client_request_id)
  if (!addItemsRequestId) return c.json({ error: 'client_request_id is required when adding sale items.', code: 'client_request_id_required' }, 400)
  const addItemsCanonical = JSON.stringify({
    sale_id: Number(id),
    items: body.items ?? null,
    notes: String(body.notes || '').trim().slice(0, 500) || null,
    expected_exchange_rate: body.expected_exchange_rate,
  })
  const addItemsDigest = await saleMutationDigest(JSON.parse(addItemsCanonical))
  const priorAddition = await db.prepare(`SELECT request_digest,response_json FROM sale_mutation_receipts
    WHERE actor_id=@actor AND mutation_kind='add_items' AND request_id=@request`)
    .get<{ request_digest: string; response_json: string }>({ actor: user.id, request: addItemsRequestId })
  if (priorAddition) {
    if (priorAddition.request_digest !== addItemsDigest) return c.json({ error: 'client_request_id was already used with different added items.', code: 'idempotency_conflict' }, 409)
    return c.json(JSON.parse(priorAddition.response_json) as Record<string, unknown>)
  }

  const rawItems = Array.isArray(body.items) ? body.items : []
  if (!rawItems.length) return c.json({ error: 'Sale items required' }, 400)
  // Bounded so one request cannot build a D1 batch of unbounded size; the
  // POS cart itself is the place for a large order.
  if (rawItems.length > 50) return c.json({ error: 'Add at most 50 lines at a time.' }, 400)

  const sale = await db.prepare('SELECT s.*,COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=s.id),0) AS write_revision FROM sales s WHERE s.id = ?').get<Record<string, unknown> & {
    id: number
    sale_status: string | null
    updated_at: string | null
    branch_id: number | null
    receipt_number: string | null
    write_revision: number
  }>([id])
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

  const saleId = Number(sale.id)
  const saleStatus = String(sale.sale_status || 'completed')
  const moneySettings = await readAmendmentMoneySettings(db)
  const exchangeRate = moneySettings.exchangeRate
  const reviewedRate = Number(body.expected_exchange_rate)
  if (!Number.isFinite(reviewedRate) || reviewedRate <= 0) {
    return c.json({ error: 'expected_exchange_rate is required to confirm the reviewed item addition.', code: 'expected_exchange_rate_required', current: { exchange_rate: exchangeRate } }, 400)
  }
  if (Math.abs(reviewedRate - exchangeRate) > 0.0000001) {
    return c.json({ error: 'The exchange rate changed. Review the added items again.', code: 'exchange_rate_changed', current_exchange_rate: exchangeRate, current: { exchange_rate: exchangeRate } }, 409)
  }

  // A sale can carry real return records while its status row says something
  // else (imported/legacy rows), so the guard is given the evidence, not
  // just the label -- see guardSaleLineAddition's own comment.
  const returnedRow = await db.prepare(`
    SELECT 1 AS found FROM return_items ri
    JOIN returns r ON r.id = ri.return_id
    WHERE r.sale_id = ? AND COALESCE(r.status, 'completed') != 'cancelled'
    LIMIT 1
  `).get<{ found: number }>([saleId])
  const guard = guardSaleLineAddition(saleStatus, !!returnedRow)
  if (!guard.ok) return c.json({ error: guard.error }, 400)

  // ---- Normalize (no DB access yet), same shape as POST /'s step 1 ----
  const requested: Array<{
    productId: number
    quantity: number
    branchId: number | null
    appliedPriceUsd: number | null
    batchId: number | null
    batchLabel: string | null
    batchExpiryDate: string | null
  }> = []
  for (let index = 0; index < rawItems.length; index += 1) {
    const item = rawItems[index] || {}
    const productId = Number(item.product_id || item.id)
    if (!Number.isFinite(productId) || productId <= 0) {
      return c.json({ error: `Added item #${index + 1} is missing a product` }, 400)
    }
    const quantity = Number(item.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return c.json({ error: `Added item #${index + 1} has an invalid quantity` }, 400)
    }
    const rawPrice = Number(item.applied_price_usd)
    requested.push({
      productId,
      quantity,
      // A line inherits the sale's branch unless it names its own, exactly
      // as a checkout line does -- the stock has to come off the shelf the
      // sale was rung up at.
      branchId: Number(item.branch_id || sale.branch_id) || null,
      appliedPriceUsd: Number.isFinite(rawPrice) && rawPrice >= 0 && item.applied_price_usd !== undefined && item.applied_price_usd !== null
        ? rawPrice
        : null,
      batchId: Number(item.batch_id) || null,
      batchLabel: item.batch_label ? String(item.batch_label) : null,
      batchExpiryDate: item.batch_expiry_date ? String(item.batch_expiry_date) : null,
    })
  }

  // ---- Current prices/costs, chunked for D1's parameter ceiling ----
  const productIds = [...new Set(requested.map((item) => item.productId))]
  const products = await selectInChunks(productIds, 0, (chunk) => db
    .prepare(`SELECT id, name, selling_price_usd, cost_price_usd, cost_price_khr FROM products WHERE id IN (${chunk.map(() => '?').join(',')})`)
    .all<{ id: number; name: string; selling_price_usd: number; cost_price_usd: number; cost_price_khr: number }>(chunk))
  const productMap = new Map(products.map((product) => [product.id, product]))
  for (const item of requested) {
    if (!productMap.has(item.productId)) {
      return c.json({ error: `Product #${item.productId} no longer exists.` }, 400)
    }
  }

  // S4-2 + S4-3: the status is only half the question. A sale carrying the
  // sticky `stock_skipped` flag is permanently outside the stock ledger, and
  // adding a line to it must not take units the system never took. Before
  // S4-3 this hole was invisible -- the only stock_skipped sales were
  // migrated ones sitting in awaiting_payment, which held nothing anyway --
  // but now that awaiting_payment holds, the flag is the ONLY thing standing
  // between a migrated sale and a deduction it must never make.
  const skipStock = saleSkipsStock(sale as AmendableSaleRow)
  const deductsStock = saleStatusDeductsStock(saleStatus) && !skipStock

  // ---- Plan the lines: FIFO lots first (the checkout's own rule, called) --
  const lotsByKey = await readFifoLotAvailabilityForCart(
    db,
    requested
      .filter((item) => item.branchId)
      .map((item) => ({ productId: item.productId, branchId: item.branchId as number })),
  )
  const candidateLines = requested.map((item) => {
    const product = productMap.get(item.productId)
    return {
      productId: item.productId,
      productName: product?.name || `product #${item.productId}`,
      quantity: item.quantity,
      branchId: item.branchId,
      unitPriceUsd: item.appliedPriceUsd ?? Number(product?.selling_price_usd || 0),
      costPriceUsd: Number(product?.cost_price_usd || 0),
      costPriceKhr: Number(product?.cost_price_khr || 0),
      batchId: item.batchId,
      batchLabel: item.batchLabel,
      batchExpiryDate: item.batchExpiryDate,
    }
  })
  const explicitBatchResolution = resolveExplicitSaleLineBatches(candidateLines, lotsByKey)
  if (!explicitBatchResolution.ok) {
    return c.json({ error: explicitBatchResolution.error }, 409)
  }
  const planned = allocateNewSaleLines(
    explicitBatchResolution.lines,
    lotsByKey,
    saleStatus,
    skipStock,
  )

  const plan = planSaleLineAddition({
    saleId,
    saleStatus,
    lines: planned,
    exchangeRate,
    userId: user?.id ?? null,
    userName: actorSnapshot(user),
  })

  // ---- Pre-flight availability, plain reads, exactly like POST /'s step 2:
  // D1's batch() is atomic but cannot branch mid-batch, so a shortage has to
  // be reported before the write is built. The CHECK(quantity >= 0)
  // constraints below remain the real race guard. ----
  if (plan.deductions.length) {
    const branchIds = [...new Set(plan.deductions.map((entry) => entry.branch_id))]
    for (const branchId of branchIds) {
      const idsForBranch = [...new Set(plan.deductions.filter((entry) => entry.branch_id === branchId).map((entry) => entry.product_id))]
      const rows = await selectInChunks(idsForBranch, 1, (chunk) => db
        .prepare(`SELECT product_id, quantity FROM branch_stock WHERE branch_id = ? AND product_id IN (${chunk.map(() => '?').join(',')})`)
        .all<{ product_id: number; quantity: number }>([branchId, ...chunk]))
      const available = new Map(rows.map((row) => [row.product_id, row.quantity]))
      for (const entry of plan.deductions.filter((item) => item.branch_id === branchId)) {
        const have = available.get(entry.product_id) || 0
        if (entry.quantity > have) {
          const name = productMap.get(entry.product_id)?.name || `product #${entry.product_id}`
          return c.json({ error: `Insufficient stock for ${name}: requested ${entry.quantity}, available ${have}` }, 409)
        }
      }
    }
  }

  // ---- Totals (decision 3). Subtotal is re-summed from the sale's OWN
  // lines rather than added onto the stored column, so a row whose stored
  // subtotal had drifted is corrected instead of carrying the drift. Both
  // discounts and the tender stay frozen; TAX follows the lines when the sale
  // was taxed at the rate `settings.tax_rate` holds today (S4-30 DECISION 4a).
  // See lib/saleLineAddition.ts and lib/saleAmendments.ts. ----
  const existingSubtotalRow = await db
    .prepare('SELECT COALESCE(SUM(total_usd), 0) AS subtotal FROM sale_items WHERE sale_id = ?')
    .get<{ subtotal: number }>([saleId])
  const subtotalBeforeUsd = Number(existingSubtotalRow?.subtotal) || 0
  const subtotalAfterUsd = subtotalBeforeUsd + plan.addedSubtotalUsd
  const taxPlan = planAmendedTax({
    saleId,
    sale: sale as AmendableSaleRow,
    settings: moneySettings.tax,
    subtotalBeforeUsd,
    subtotalAfterUsd,
    exchangeRate,
  })
  const money = recomputeSaleMoneyAfterAmendment({
    sale: sale as AmendableSaleRow,
    subtotalUsd: subtotalAfterUsd,
    taxUsdOverride: taxPlan.taxUsdOverride,
    changeExchangeRate: moneySettings.changeExchangeRate,
    exchangeRateOverride: moneySettings.exchangeRate,
  })
  const addItemsStamp = new Date().toISOString()
  const addItemsOperationId = crypto.randomUUID()
  const lineMoneyRowsBefore = await db.prepare(`
    SELECT id,applied_price_usd,applied_price_khr,total_usd,total_khr,
           product_discount_usd,product_discount_khr,base_price_usd,base_price_khr,
           manual_discount_usd,manual_discount_khr
    FROM sale_items WHERE sale_id=? ORDER BY id
  `).all<Record<string, unknown>>([saleId])
  const lineMoneyBefore = captureSaleLineKhrSnapshot(lineMoneyRowsBefore)
  const lineMoneyAfter = rebaseSaleLineKhrSnapshot(lineMoneyRowsBefore, exchangeRate)
  const moneyBefore = amendmentMoneyBefore(sale)
  const moneyAfter = amendmentMoneyAfter(
    sale,
    money,
    exchangeRate,
    addItemsStamp,
    taxPlan.outcome.taxUsd,
    Number(sale.delivery_fee_usd) || 0,
  )

  // ---- The amendment ledger entries for this addition (S4-30).
  //
  // S4-24b's endpoint is SUBSUMED by the ledger rather than sitting beside it:
  // there is ONE way to add a line to a recorded sale, and it leaves ONE audit
  // trail. A second addition path with its own trail would make the feature
  // worse than not having it.
  //
  // The entries go in the SAME atomic batch as the lines they describe. That
  // costs one thing -- sale_item_id is not knowable until the batch returns
  // its last_row_ids, so these entries carry NULL there and identify the line
  // by product instead. That is the right trade: an added line whose audit
  // entry silently failed afterwards is a worse outcome than an entry without
  // a foreign key, and the line id is secondary anyway (a removed line's id
  // dangles by design -- the ledger snapshots the product name for exactly
  // this reason).
  //
  // One request is one act, so every line shares a group_id.
  const additionGroupId = crypto.randomUUID()
  let runningTotalUsd = moneyBefore.total_usd
  const ledgerStatements = plan.lines.map((line, lineIndex) => {
    const isLast = lineIndex === plan.lines.length - 1
    const totalBeforeUsd = runningTotalUsd
    const totalAfterUsd = isLast ? moneyAfter.total_usd : round2(runningTotalUsd + line.lineTotalUsd)
    runningTotalUsd = totalAfterUsd
    return amendmentEntryStatement({
      saleId,
      kind: 'line_added',
      groupId: additionGroupId,
      productId: line.productId,
      productName: line.productName,
      quantityBefore: 0,
      quantityAfter: line.quantity,
      totalBeforeUsd,
      totalAfterUsd,
      unitsMoved: -line.heldUnits || 0,
      stockSkipped: skipStock,
      note: String(body.notes || '').trim().slice(0, 500) || null,
      userId: user?.id ?? null,
      userName: actorSnapshot(user),
    })
  })

  const baseResponse: Record<string, unknown> = {
    id: saleId,
    receiptNumber: sale.receipt_number || null,
    saleStatus,
    addedLines: plan.lines.length,
    unitsDeducted: plan.deductedUnits,
    stockMoved: deductsStock,
    subtotalUsd: moneyAfter.subtotal_usd,
    totalUsd: moneyAfter.total_usd,
    totalKhr: moneyAfter.total_khr,
    outstandingUsd: round2(Math.max(0, moneyAfter.total_usd - (Number(sale.amount_paid_usd) || 0) - (Number(sale.amount_paid_khr) || 0) / exchangeRate)),
    exchangeRate,
    undoActionId: null,
    actionHistoryId: null,
    operationId: addItemsOperationId,
    currentReplayGeneration: 0,
    updated_at: addItemsStamp,
  }
  const reversal = {
    saleId,
    receiptNumber: sale.receipt_number || null,
    saleStatus,
    exchangeRate,
    moneyBefore,
    moneyAfter,
    lineMoneyBefore,
    lineMoneyAfter,
    operationId: addItemsOperationId,
    lines: plan.lines.map((line) => ({
      saleItemId: 0,
      productId: line.productId,
      productName: line.productName,
      quantity: line.quantity,
      branchId: line.branchId,
      heldUnits: line.heldUnits,
      unitPriceUsd: line.unitPriceUsd,
      lineTotalUsd: line.lineTotalUsd,
      costPriceUsd: line.costPriceUsd,
      costPriceKhr: line.costPriceKhr,
      takes: line.takes,
    })),
  }

  const statementsForPlan: StatementList = []
  const lineOrdinalByStatement = new Map(plan.saleItemStatementIndexByLine.map((statementIndex, ordinal) => [statementIndex, ordinal]))
  for (const [statementIndex, statement] of plan.statements.entries()) {
    statementsForPlan.push(statement)
    const ordinal = lineOrdinalByStatement.get(statementIndex)
    if (ordinal !== undefined) {
      statementsForPlan.push({
        sql: `INSERT INTO sale_mutation_members(operation_id,entity_kind,entity_id,ordinal)
              VALUES(@operation,'sale_item',last_insert_rowid(),@ordinal)`,
        params: { operation: addItemsOperationId, ordinal },
      })
    }
  }
  let snapshotExpression = '@payload'
  for (let ordinal = 0; ordinal < plan.lines.length; ordinal += 1) {
    snapshotExpression = `json_set(${snapshotExpression},'$.lines[${ordinal}].saleItemId',COALESCE((SELECT entity_id FROM sale_mutation_members WHERE operation_id=@operation AND entity_kind='sale_item' AND ordinal=${ordinal}),0))`
  }
  snapshotExpression = `json_set(${snapshotExpression},'$.saleStateRevision',COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=@saleId),0))`
  const saleLabel = sale.receipt_number || `#${saleId}`
  const lineCount = plan.lines.length
  const auditDetails = JSON.stringify({
    action: 'add_items', operation_id: addItemsOperationId,
    receipt_number: sale.receipt_number || null, sale_status: saleStatus,
    lines: lineCount, units_deducted: plan.deductedUnits,
    subtotal_before: moneyBefore.subtotal_usd, subtotal_after: moneyAfter.subtotal_usd,
    total_before: moneyBefore.total_usd, total_after: moneyAfter.total_usd,
    exchange_rate_before: sale.exchange_rate ?? null, exchange_rate_after: exchangeRate,
    notes: String(body.notes || '').trim().slice(0, 500) || null,
  })

  // Receipt, core rows, lot allocations, ledger, snapshot and action history
  // commit as one D1 transaction. Every dynamic row id is captured through
  // last_insert_rowid() into the operation member table before it is needed.
  let batchResults: Array<{ meta?: { last_row_id?: number } }> = []
  let historyStatementIndex = -1
  try {
    const atomicStatements: StatementList = [
      { sql: 'DELETE FROM sale_mutation_guards', params: {} },
      { sql: 'DELETE FROM sale_bulk_guards', params: {} },
      amendmentSettingsGuard(moneySettings),
      saleRevisionGuard(saleId, Number(sale.write_revision)),
      saleMutationReceiptStatement({
        operationId: addItemsOperationId, actorId: Number(user.id), saleId, kind: 'add_items',
        requestId: addItemsRequestId, requestDigest: addItemsDigest, requestJson: addItemsCanonical,
        before: { money: moneyBefore, lines: lineMoneyBefore },
        after: { money: moneyAfter, lines: lineMoneyAfter },
        response: baseResponse, stamp: addItemsStamp,
      }),
      ...statementsForPlan,
      ...buildOperationAllocationStatements(plan.lines, addItemsOperationId, addItemsStamp),
      ...taxPlan.statements,
      rebaseSaleLineKhrStatement(saleId, exchangeRate),
      saleMoneyUpdateStatement(saleId, moneyAfter),
      ...ledgerStatements,
      {
        sql: `INSERT INTO undo_snapshots(kind,status,payload_json,created_by_id,created_by_name)
              VALUES('sale.add_items','applied',${snapshotExpression},@byId,@byName)`,
        params: { payload: JSON.stringify(reversal), operation: addItemsOperationId, saleId, byId: user.id, byName: actorSnapshot(user) },
      },
      {
        sql: `INSERT INTO sale_mutation_members(operation_id,entity_kind,entity_id,ordinal)
              VALUES(@operation,'undo_snapshot',last_insert_rowid(),0)`,
        params: { operation: addItemsOperationId },
      },
    ]
    historyStatementIndex = atomicStatements.length
    atomicStatements.push({
      sql: `INSERT INTO action_history(scope,entity,entity_id,label,undo_label,redo_label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
            SELECT 'sales','sale',@entityId,@label,@undoLabel,@redoLabel,1,'undoable',
                   json_object('applier','sale.add_items','snapshot_id',entity_id,'operation_id',@operation,'generation',0),
                   json_object('applier','sale.add_items','snapshot_id',entity_id,'operation_id',@operation,'generation',0),@byId,@byName
            FROM sale_mutation_members WHERE operation_id=@operation AND entity_kind='undo_snapshot' AND ordinal=0`,
      params: {
        operation: addItemsOperationId, entityId: String(saleId),
        label: `Added ${lineCount} item${lineCount === 1 ? '' : 's'} to sale ${saleLabel}`,
        undoLabel: `Undo items added to sale ${saleLabel}`,
        redoLabel: `Redo items added to sale ${saleLabel}`,
        byId: user.id, byName: actorSnapshot(user),
      },
    })
    atomicStatements.push(
      {
        sql: `UPDATE sale_mutation_receipts SET history_id=last_insert_rowid(),generation=0,
              sale_revision=COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=@saleId),0),
              response_json=json_set(response_json,'$.undoActionId',last_insert_rowid(),'$.actionHistoryId',last_insert_rowid()),updated_at=@stamp
              WHERE id=@operation`,
        params: { operation: addItemsOperationId, saleId, stamp: addItemsStamp },
      },
      {
        sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value)
              VALUES(@userId,@userName,'update','sale',@saleId,@details,'sale',@saleId,@details)`,
        params: { userId: user.id, userName: actorSnapshot(user), saleId: String(saleId), details: auditDetails },
      },
      { sql: 'DELETE FROM sale_mutation_guards', params: {} },
      { sql: 'DELETE FROM sale_bulk_guards', params: {} },
    )
    batchResults = await db.batch(atomicStatements) as typeof batchResults
  } catch (error) {
    const retry = await db.prepare(`SELECT request_digest,response_json FROM sale_mutation_receipts
      WHERE actor_id=@actor AND mutation_kind='add_items' AND request_id=@request`)
      .get<{ request_digest: string; response_json: string }>({ actor: user.id, request: addItemsRequestId })
    if (retry?.request_digest === addItemsDigest) return c.json(JSON.parse(retry.response_json) as Record<string, unknown>)
    if (retry) return c.json({ error: 'client_request_id was already used with different added items.', code: 'idempotency_conflict' }, 409)
    const message = (error as Error).message || ''
    if (/CHECK constraint|constraint failed/i.test(message)) {
      return c.json({ error: 'The sale, stock, or monetary settings changed. Refresh and review the added items again.', code: 'write_conflict' }, 409)
    }
    return c.json({ error: `Failed to add sale items: ${message}` }, 500)
  }

  c.executionCtx.waitUntil(Promise.all([
    bumpVersion(c.env, 'products'),
    bumpVersion(c.env, 'sales'),
  ]))

  const committed = await db.prepare('SELECT response_json FROM sale_mutation_receipts WHERE id=?')
    .get<{ response_json: string }>([addItemsOperationId])
  if (!committed) return c.json({ error: 'The added items committed without a durable receipt.', code: 'receipt_missing' }, 500)
  const response = JSON.parse(committed.response_json) as Record<string, unknown>
  const historyId = Number(batchResults[historyStatementIndex]?.meta?.last_row_id || 0)
  if (historyId > 0) response.actionHistoryId = response.undoActionId = historyId
  return c.json(response)
})

// ---------------------------------------------------------------------------
// GET /api/sales/:id/amendments -- the sale's audit trail (S4-30).
//
// This is the STAFF-facing read, and it is the whole point of the feature: the
// original value plus every amendment on top of it, each with what changed, by
// how much, who did it and when. The customer-facing receipt reads none of
// this -- it renders the net state off `sale_items` + the `sales` row, exactly
// as it always did.
//
// Read-gated, not write-gated: a view-tier bookkeeper who can see the sale can
// see how it got that way. Hiding the trail from the people who reconcile the
// books would defeat it.
// ---------------------------------------------------------------------------
app.get('/:id/amendments', async (c) => {
  const db = getDb(c.env)
  if (!canReadSales(c.get('user'))) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const saleId = Number(c.req.param('id'))
  if (!Number.isFinite(saleId) || saleId <= 0) return c.json({ error: 'Sale not found' }, 404)

  // Oldest first -- the detail view reads top-to-bottom as a story, and this
  // is the (sale_id, id) index migration 0115 creates.
  const entries = await db.prepare(`
    SELECT id, kind, group_id, sale_item_id, product_id, product_name,
      quantity_before, quantity_after, quantity_delta,
      amount_before_usd, amount_after_usd, amount_delta_usd,
      total_before_usd, total_after_usd,
      units_moved, stock_skipped, via, reverses_amendment_id, undo_action_id,
      note, user_id, user_name, created_at
    FROM sale_amendments WHERE sale_id = ? ORDER BY id ASC
  `).all<LedgerRow>([saleId])

  return c.json({ saleId, entries, summary: summarizeAmendments(entries) })
})

// ---------------------------------------------------------------------------
// POST /api/sales/:id/amendments -- change a recorded sale (S4-30).
//
// The shop owner's ask: "sometimes we input wrong delivery cost, or customers
// change their mind and want to add or replace products... we do an add on
// top, so we know we added."
//
// Kinds handled here: increase a line, decrease a line, remove a line, replace
// one product with another, and correct the delivery fee. ADDING a brand-new
// line is POST /:id/items above -- that endpoint already exists, already has
// its own tested stock kernel and its own undo applier, and it now writes a
// `line_added` entry into this same ledger. Reimplementing it here would be
// the second path this feature must not have.
//
// PERMISSION: the granular `sales -> amend` action at FULL tier. Amending a
// recorded sale moves stock and changes what the customer owes, so it is not
// covered by the coarse 'sales' grant, and it is a different act from adding
// goods (`add_items`) or changing a status (`status`) -- a shop may well want
// a senior cashier who can add a forgotten item but cannot take one off.
//
// NOT BUILT here, on purpose, and each one is named with its reason in
// lib/saleAmendments.ts's DECISION 2: a line's unit price, the manual and
// membership discounts, tax, and the tender.
// ---------------------------------------------------------------------------
const AMENDMENT_REQUEST_KINDS = new Set(['line_quantity_increased', 'line_quantity_decreased', 'line_removed', 'line_replaced', 'delivery_fee_changed'])

app.post('/:id/amendments', async (c) => {
  const db = getDb(c.env)
  const user = c.get('user')
  if (getActionTier(user, 'sales', 'amend') !== 'full') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }

  const body = await c.req.json<{
    kind?: string
    sale_item_id?: number
    quantity?: number
    delivery_fee_usd?: number
    replacement?: { product_id?: number; quantity?: number; applied_price_usd?: number; branch_id?: number }
    notes?: string
    client_request_id?: string
    expected_exchange_rate?: number | string
    [key: string]: unknown
  }>().catch(() => ({} as Record<string, unknown>))

  const kind = String(body.kind || '')
  if (!AMENDMENT_REQUEST_KINDS.has(kind)) {
    return c.json({ error: `Unknown amendment "${kind}".` }, 400)
  }

  const amendmentRequestId = normalizeClientRequestId(body.client_request_id)
  if (!amendmentRequestId) return c.json({ error: 'client_request_id is required for a sale amendment.', code: 'client_request_id_required' }, 400)
  const amendmentCanonical = JSON.stringify({
    sale_id: Number(c.req.param('id')),
    kind,
    sale_item_id: body.sale_item_id ?? null,
    quantity: body.quantity ?? null,
    delivery_fee_usd: body.delivery_fee_usd ?? null,
    replacement: body.replacement ?? null,
    notes: String(body.notes || '').trim().slice(0, 500) || null,
    expected_exchange_rate: body.expected_exchange_rate,
  })
  const amendmentDigest = await saleMutationDigest(JSON.parse(amendmentCanonical))
  const priorAmendment = await db.prepare(`
    SELECT request_digest,response_json FROM sale_mutation_receipts
    WHERE actor_id=@actor AND mutation_kind='amendment' AND request_id=@request
  `).get<{ request_digest: string; response_json: string }>({ actor: user.id, request: amendmentRequestId })
  if (priorAmendment) {
    if (priorAmendment.request_digest !== amendmentDigest) return c.json({ error: 'client_request_id was already used with different amendment data.', code: 'idempotency_conflict' }, 409)
    return c.json(JSON.parse(priorAmendment.response_json) as Record<string, unknown>)
  }

  const sale = await db.prepare('SELECT s.*,COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=s.id),0) AS write_revision FROM sales s WHERE s.id = ?').get<AmendableSaleRow & {
    id: number
    sale_status: string | null
    updated_at: string | null
    branch_id: number | null
    receipt_number: string | null
    created_at: string | null
    total_usd: number | null
    amount_paid_usd: number | null
    amount_paid_khr: number | null
    write_revision: number
  }>([c.req.param('id')])
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

  const saleId = Number(sale.id)
  const saleStatus = String(sale.sale_status || 'completed')
  const moneySettings = await readAmendmentMoneySettings(db)
  const exchangeRate = moneySettings.exchangeRate
  const reviewedRate = Number(body.expected_exchange_rate)
  if (!Number.isFinite(reviewedRate) || reviewedRate <= 0) {
    return c.json({ error: 'expected_exchange_rate is required to confirm the reviewed amendment.', code: 'expected_exchange_rate_required', current: { exchange_rate: exchangeRate } }, 400)
  }
  if (Math.abs(reviewedRate - exchangeRate) > 0.0000001) {
    return c.json({ error: 'The exchange rate changed. Review the amendment again.', code: 'exchange_rate_changed', current_exchange_rate: exchangeRate, current: { exchange_rate: exchangeRate } }, 409)
  }

  // A sale can carry real return records while its status row says something
  // else (imported/legacy rows), so the guard is given the EVIDENCE, not the
  // label -- the identical read S4-24b's addition guard uses, applied to every
  // amendment kind rather than only to additions.
  const returnedRow = await db.prepare(`
    SELECT 1 AS found FROM return_items ri
    JOIN returns r ON r.id = ri.return_id
    WHERE r.sale_id = ? AND COALESCE(r.status, 'completed') != 'cancelled'
    LIMIT 1
  `).get<{ found: number }>([saleId])

  const windowRow = await db.prepare('SELECT value FROM settings WHERE key = ?').get<{ value: string }>([AMENDMENT_WINDOW_SETTING_KEY])
  const guard = guardSaleAmendment({
    saleStatus,
    hasRecordedReturns: !!returnedRow,
    saleCreatedAt: sale.created_at,
    windowMinutes: resolveAmendmentWindowMinutes(windowRow?.value),
    isAdmin: isAdminControlUser(user),
  })
  if (!guard.ok) return c.json({ error: guard.error, code: guard.code }, 400)

  const movesStock = saleAmendmentMovesStock(sale)
  const stockSkipped = saleSkipsStock(sale)
  const note = String(body.notes || '').trim().slice(0, 500) || null
  const subtotalRow = await db
    .prepare('SELECT COALESCE(SUM(total_usd), 0) AS subtotal FROM sale_items WHERE sale_id = ?')
    .get<{ subtotal: number }>([saleId])
  const subtotalBeforeUsd = Number(subtotalRow?.subtotal) || 0
  const totalBeforeUsd = round2(Number(sale.total_usd) || 0)
  const lineMoneyRowsBefore = await db.prepare(`
    SELECT id,applied_price_usd,applied_price_khr,total_usd,total_khr,
           product_discount_usd,product_discount_khr,base_price_usd,base_price_khr,
           manual_discount_usd,manual_discount_khr
    FROM sale_items WHERE sale_id=? ORDER BY id
  `).all<Record<string, unknown>>([saleId])
  const lineMoneyBefore = captureSaleLineKhrSnapshot(lineMoneyRowsBefore)
  const lineMoneyAfterAtLatestRate = rebaseSaleLineKhrSnapshot(lineMoneyRowsBefore, exchangeRate)
  const mutationStamp = new Date().toISOString()
  const mutationOperationId = crypto.randomUUID()
  const moneyBeforeSnapshot = amendmentMoneyBefore(sale)

  // ---- The delivery fee: its own short path, because it touches no line and
  // moves no stock. "$1.50, then we add another $0.50" -> the sale row holds
  // $2.00 (what the receipt prints) and the ledger holds both. ----
  if (kind === 'delivery_fee_changed') {
    const feeGuard = guardDeliveryFeeAmendment(sale)
    if (!feeGuard.ok) return c.json({ error: feeGuard.error }, 400)
    const rawFee = Number(body.delivery_fee_usd)
    if (!Number.isFinite(rawFee) || rawFee < 0) {
      return c.json({ error: 'A delivery fee must be zero or more.' }, 400)
    }
    const feePlan = planDeliveryFeeChange({ saleId, sale, newFeeUsd: rawFee, exchangeRate })
    if (feePlan.feeDeltaUsd === 0) {
      return c.json({ error: 'That is already the delivery fee on this sale.' }, 400)
    }
    // A fee correction changes no line, so the taxable base is unchanged and
    // planAmendedTax emits no write -- but it is still asked, so the response
    // can say whether tax followed or was kept, in the same words every other
    // amendment kind uses.
    const feeTaxPlan = planAmendedTax({
      saleId, sale, settings: moneySettings.tax,
      subtotalBeforeUsd, subtotalAfterUsd: subtotalBeforeUsd, exchangeRate,
    })
    const money = recomputeSaleMoneyAfterAmendment({
      sale,
      subtotalUsd: subtotalBeforeUsd,
      deliveryFeeUsdOverride: feePlan.feeAfterUsd,
      taxUsdOverride: feeTaxPlan.taxUsdOverride,
      changeExchangeRate: moneySettings.changeExchangeRate,
      exchangeRateOverride: exchangeRate,
    })
    const moneyAfterSnapshot = amendmentMoneyAfter(
      sale,
      money,
      exchangeRate,
      mutationStamp,
      feeTaxPlan.outcome.taxUsd,
      feePlan.feeAfterUsd,
    )
    const response = buildAmendmentResponsePayload({
      saleId, sale, money, exchangeRate, stockMoved: false, unitsMoved: 0, stockSkipped, tax: feeTaxPlan.outcome,
    }, mutationStamp)
    try {
      await db.batch([
        { sql: 'DELETE FROM sale_mutation_guards', params: {} },
        { sql: 'DELETE FROM sale_bulk_guards', params: {} },
        amendmentSettingsGuard(moneySettings),
        saleRevisionGuard(saleId, Number(sale.write_revision)),
        ...feePlan.statements,
        ...feeTaxPlan.statements,
        rebaseSaleLineKhrStatement(saleId, exchangeRate),
        saleMoneyUpdateStatement(saleId, moneyAfterSnapshot),
        amendmentEntryStatement({
          saleId,
          kind: 'delivery_fee_changed',
          amountBeforeUsd: feePlan.feeBeforeUsd,
          amountAfterUsd: feePlan.feeAfterUsd,
          totalBeforeUsd,
          totalAfterUsd: money.totalUsd,
          note,
          userId: user?.id ?? null,
          userName: actorSnapshot(user),
        }),
        saleMutationReceiptStatement({
          operationId: mutationOperationId,
          actorId: Number(user.id),
          saleId,
          kind: 'amendment',
          requestId: amendmentRequestId,
          requestDigest: amendmentDigest,
          requestJson: amendmentCanonical,
          before: { money: moneyBeforeSnapshot, lines: lineMoneyBefore },
          after: { money: moneyAfterSnapshot, lines: lineMoneyAfterAtLatestRate },
          response,
          stamp: mutationStamp,
        }),
        { sql: 'DELETE FROM sale_mutation_guards', params: {} },
        { sql: 'DELETE FROM sale_bulk_guards', params: {} },
      ])
    } catch (error) {
      const retry = await db.prepare(`SELECT request_digest,response_json FROM sale_mutation_receipts
        WHERE actor_id=@actor AND mutation_kind='amendment' AND request_id=@request`)
        .get<{ request_digest: string; response_json: string }>({ actor: user.id, request: amendmentRequestId })
      if (retry?.request_digest === amendmentDigest) return c.json(JSON.parse(retry.response_json) as Record<string, unknown>)
      if (retry) return c.json({ error: 'client_request_id was already used with different amendment data.', code: 'idempotency_conflict' }, 409)
      if (/constraint/i.test(String(error))) return c.json({ error: 'The sale or monetary settings changed. Refresh and review this amendment again.', code: 'write_conflict' }, 409)
      return c.json({ error: `Failed to amend the delivery fee: ${(error as Error).message || ''}` }, 500)
    }
    await auditAmendment(c, user, saleId, sale, {
      kind, fee_before: feePlan.feeBeforeUsd, fee_after: feePlan.feeAfterUsd,
      total_before: totalBeforeUsd, total_after: money.totalUsd,
      exchange_rate_before: sale.exchange_rate ?? null, exchange_rate_after: exchangeRate,
      outside_window: guard.outsideWindow, notes: note,
    })
    return c.json(response)
  }

  // ---- Every other kind acts on ONE existing line. ----
  const lineId = Number(body.sale_item_id)
  if (!Number.isFinite(lineId) || lineId <= 0) return c.json({ error: 'Which line is being amended?' }, 400)
  const line = await db.prepare(`
    SELECT id, product_id, product_name, quantity, applied_price_usd, cost_price_usd, cost_price_khr, branch_id
    FROM sale_items WHERE id = ? AND sale_id = ?
  `).get<{ id: number; product_id: number | null; product_name: string | null; quantity: number; applied_price_usd: number; cost_price_usd: number; cost_price_khr: number; branch_id: number | null }>([lineId, saleId])
  if (!line) return c.json({ error: 'That line is not on this sale.' }, 404)

  // Draw order (id ASC) -- the decrease walk relies on it to hand units back
  // to the lots they came from, last-drawn first.
  const allocations = await db.prepare(`
    SELECT id, batch_id, branch_id, quantity, released_quantity
    FROM sale_item_batch_allocations WHERE sale_item_id = ? ORDER BY id ASC
  `).all<LineAllocation>([lineId])

  const statements: StatementList = []
  const ledgerEntries: Array<Parameters<typeof amendmentEntryStatement>[0]> = []
  const groupId = crypto.randomUUID()
  let subtotalDeltaUsd = 0
  let unitsMoved = 0

  // --- increase / the "add to existing" case, and the add half of a replace ---
  const needsLots = kind === 'line_quantity_increased'
  if (needsLots) {
    const requested = Math.max(0, Number(body.quantity) || 0)
    if (!(requested > 0)) return c.json({ error: 'How many more units?' }, 400)
    const lots = line.branch_id
      ? (await readFifoLotAvailabilityForCart(db, [{ productId: Number(line.product_id), branchId: line.branch_id }])).get(`${line.product_id}:${line.branch_id}`) || []
      : []
    // Pre-flight, plain reads, exactly like POST /'s and POST /:id/items's:
    // D1's batch() is atomic but cannot branch mid-batch, so a shortage is
    // reported before the write is built. The CHECK(quantity >= 0) constraints
    // remain the real race guard.
    if (movesStock && line.branch_id) {
      const have = await db.prepare('SELECT quantity FROM branch_stock WHERE branch_id = ? AND product_id = ?')
        .get<{ quantity: number }>([line.branch_id, line.product_id])
      if (requested > (Number(have?.quantity) || 0)) {
        return c.json({ error: `Insufficient stock for ${line.product_name || 'this product'}: requested ${requested}, available ${Number(have?.quantity) || 0}` }, 409)
      }
    }
    const plan = planLineQuantityIncrease({
      saleId, sale, line, addedQuantity: requested, lots, exchangeRate,
      userId: user?.id ?? null, userName: actorSnapshot(user),
    })
    statements.push(...plan.statements)
    subtotalDeltaUsd += plan.subtotalDeltaUsd
    unitsMoved += plan.unitsMoved
    ledgerEntries.push({
      saleId, kind: 'line_quantity_increased', groupId,
      saleItemId: line.id, productId: line.product_id, productName: line.product_name,
      quantityBefore: plan.quantityBefore, quantityAfter: plan.quantityAfter,
      totalBeforeUsd, totalAfterUsd: 0, unitsMoved: plan.unitsMoved, stockSkipped,
      note, userId: user?.id ?? null, userName: actorSnapshot(user),
    })
  }

  // --- decrease / remove, and the remove half of a replace ---
  if (kind === 'line_quantity_decreased' || kind === 'line_removed' || kind === 'line_replaced') {
    const requested = kind === 'line_quantity_decreased'
      ? Math.max(0, Number(body.quantity) || 0)
      : Number(line.quantity) || 0
    if (!(requested > 0)) return c.json({ error: 'How many units are coming off?' }, 400)
    if (requested > (Number(line.quantity) || 0)) {
      return c.json({ error: `This line only has ${line.quantity}.` }, 400)
    }
    const plan = planLineQuantityDecrease({
      saleId, sale, line, removedQuantity: requested, allocations, exchangeRate,
      reason: kind === 'line_replaced'
        ? `Line replaced on sale #${saleId}`
        : `Line ${kind === 'line_removed' ? 'removed from' : 'reduced on'} sale #${saleId}`,
      userId: user?.id ?? null, userName: actorSnapshot(user),
    })
    statements.push(...plan.statements)
    subtotalDeltaUsd += plan.subtotalDeltaUsd
    unitsMoved += plan.unitsMoved
    ledgerEntries.push({
      saleId,
      kind: plan.quantityAfter <= 0 ? 'line_removed' : 'line_quantity_decreased',
      groupId,
      saleItemId: line.id, productId: line.product_id, productName: line.product_name,
      quantityBefore: plan.quantityBefore, quantityAfter: plan.quantityAfter,
      totalBeforeUsd, totalAfterUsd: 0, unitsMoved: plan.unitsMoved, stockSkipped,
      note, userId: user?.id ?? null, userName: actorSnapshot(user),
    })
  }

  // --- the add half of a replace: the removed line's product swapped for
  // another. Deliberately NOT a sixth amendment kind: a replace is a removal
  // plus an addition, which is exactly what it does to stock, and both halves
  // share one group_id so the detail view can render them as the single act
  // the cashier performed. ---
  if (kind === 'line_replaced') {
    const replacement: { product_id?: number; quantity?: number; applied_price_usd?: number; branch_id?: number } =
      (body.replacement && typeof body.replacement === 'object') ? body.replacement : {}
    const productId = Number(replacement.product_id)
    const quantity = Math.max(0, Number(replacement.quantity) || 0)
    if (!Number.isFinite(productId) || productId <= 0) return c.json({ error: 'Which product is replacing it?' }, 400)
    if (!(quantity > 0)) return c.json({ error: 'How many of the replacement?' }, 400)

    const product = await db.prepare('SELECT id, name, selling_price_usd, cost_price_usd, cost_price_khr FROM products WHERE id = ?')
      .get<{ id: number; name: string; selling_price_usd: number; cost_price_usd: number; cost_price_khr: number }>([productId])
    if (!product) return c.json({ error: `Product #${productId} no longer exists.` }, 400)

    const branchId = Number(replacement.branch_id || line.branch_id || sale.branch_id) || null
    const rawPrice = Number(replacement.applied_price_usd)
    const unitPriceUsd = Number.isFinite(rawPrice) && rawPrice >= 0 ? rawPrice : Number(product.selling_price_usd) || 0

    const lotsByKey = branchId
      ? await readFifoLotAvailabilityForCart(db, [{ productId, branchId }])
      : new Map()
    // The replacement line is planned by S4-24b's own addition kernel --
    // called, not re-implemented -- so a replaced-in product draws its lots by
    // the same FIFO rule and emits the same unclamped statements a checkout
    // would. `movesStock` (status AND the sticky stock_skipped flag) is passed
    // as the kernel's explicit skipStock argument.
    //
    // S4-3: this used to pass a literal 'awaiting_payment' as a stand-in for
    // "hold nothing". That was only ever true by coincidence, and the moment
    // awaiting_payment started holding stock the stand-in would have inverted
    // -- planning a FULL deduction for precisely the stock_skipped sales that
    // must never move a unit. The kernel now takes the fact, not a status
    // that happens to imply it.
    const plannedLines = allocateNewSaleLines([{
      productId, productName: product.name || `product #${productId}`, quantity, branchId,
      unitPriceUsd, costPriceUsd: Number(product.cost_price_usd) || 0, costPriceKhr: Number(product.cost_price_khr) || 0,
      batchId: null, batchLabel: null, batchExpiryDate: null,
    }], lotsByKey, saleStatus, !movesStock)

    if (movesStock && branchId) {
      const have = await db.prepare('SELECT quantity FROM branch_stock WHERE branch_id = ? AND product_id = ?')
        .get<{ quantity: number }>([branchId, productId])
      if (quantity > (Number(have?.quantity) || 0)) {
        return c.json({ error: `Insufficient stock for ${product.name}: requested ${quantity}, available ${Number(have?.quantity) || 0}` }, 409)
      }
    }

    // The plan works purely off each line's heldUnits (already 0 when this
    // sale moves no stock), so the status is carried for the record only --
    // no second sentinel.
    const additionPlan = planSaleLineAddition({
      saleId, saleStatus, lines: plannedLines,
      exchangeRate, userId: user?.id ?? null, userName: actorSnapshot(user),
    })
    statements.push(...additionPlan.statements)
    subtotalDeltaUsd += additionPlan.addedSubtotalUsd
    unitsMoved += -additionPlan.deductedUnits || 0
    ledgerEntries.push({
      saleId, kind: 'line_added', groupId,
      productId, productName: product.name,
      quantityBefore: 0, quantityAfter: quantity,
      totalBeforeUsd, totalAfterUsd: 0, unitsMoved: -additionPlan.deductedUnits || 0, stockSkipped,
      note, userId: user?.id ?? null, userName: actorSnapshot(user),
    })
  }

  // ---- Money. Subtotal is the sale's OWN lines re-summed and moved by this
  // amendment's delta, never the stored column carried forward, so a row whose
  // subtotal had drifted is corrected. Both discounts and the tender stay
  // FROZEN by S4-24b's recompute, which is CALLED here rather than
  // re-implemented, so an amendment cannot round differently from a checkout.
  // TAX follows the new base when this sale was taxed at today's configured
  // rate, and is kept verbatim with a stated reason when it was not
  // (DECISION 4a in lib/saleAmendments.ts). ----
  const subtotalAfterUsd = round2(subtotalBeforeUsd + subtotalDeltaUsd)
  const taxPlan = planAmendedTax({
    saleId, sale, settings: moneySettings.tax,
    subtotalBeforeUsd, subtotalAfterUsd, exchangeRate,
  })
  const money = recomputeSaleMoneyAfterAmendment({
    sale,
    subtotalUsd: subtotalAfterUsd,
    taxUsdOverride: taxPlan.taxUsdOverride,
    changeExchangeRate: moneySettings.changeExchangeRate,
    exchangeRateOverride: exchangeRate,
  })
  const moneyAfterSnapshot = amendmentMoneyAfter(
    sale,
    money,
    exchangeRate,
    mutationStamp,
    taxPlan.outcome.taxUsd,
    Number(sale.delivery_fee_usd) || 0,
  )

  // Every ledger entry in this act ends at the sale's real new total; the
  // intermediate ones would be arithmetic nobody performed.
  for (const entry of ledgerEntries) entry.totalAfterUsd = money.totalUsd

  const response = buildAmendmentResponsePayload({
    saleId, sale, money, exchangeRate, stockMoved: movesStock, unitsMoved, stockSkipped, tax: taxPlan.outcome,
  }, mutationStamp)

  // ---- One atomic batch: the line change, its stock, the sale's money, and
  // the ledger entries recording all three. A committed line change whose
  // audit entry failed separately would be exactly the silent gap this feature
  // exists to close. ----
  try {
    await db.batch([
      { sql: 'DELETE FROM sale_mutation_guards', params: {} },
      { sql: 'DELETE FROM sale_bulk_guards', params: {} },
      amendmentSettingsGuard(moneySettings),
      saleRevisionGuard(saleId, Number(sale.write_revision)),
      ...statements,
      ...taxPlan.statements,
      rebaseSaleLineKhrStatement(saleId, exchangeRate),
      saleMoneyUpdateStatement(saleId, moneyAfterSnapshot),
      ...ledgerEntries.map(amendmentEntryStatement),
      saleMutationReceiptStatement({
        operationId: mutationOperationId,
        actorId: Number(user.id),
        saleId,
        kind: 'amendment',
        requestId: amendmentRequestId,
        requestDigest: amendmentDigest,
        requestJson: amendmentCanonical,
        before: { money: moneyBeforeSnapshot, lines: lineMoneyBefore },
        after: { money: moneyAfterSnapshot, lines: lineMoneyAfterAtLatestRate },
        response,
        stamp: mutationStamp,
      }),
      { sql: 'DELETE FROM sale_mutation_guards', params: {} },
      { sql: 'DELETE FROM sale_bulk_guards', params: {} },
    ])
  } catch (error) {
    const retry = await db.prepare(`SELECT request_digest,response_json FROM sale_mutation_receipts
      WHERE actor_id=@actor AND mutation_kind='amendment' AND request_id=@request`)
      .get<{ request_digest: string; response_json: string }>({ actor: user.id, request: amendmentRequestId })
    if (retry?.request_digest === amendmentDigest) return c.json(JSON.parse(retry.response_json) as Record<string, unknown>)
    if (retry) return c.json({ error: 'client_request_id was already used with different amendment data.', code: 'idempotency_conflict' }, 409)
    const message = (error as Error).message || ''
    if (/CHECK constraint|constraint failed/i.test(message)) {
      return c.json({ error: 'The sale, stock, or monetary settings changed. Refresh and review this amendment again.', code: 'write_conflict' }, 409)
    }
    return c.json({ error: `Failed to amend this sale: ${message}` }, 500)
  }

  await auditAmendment(c, user, saleId, sale, {
    kind,
    sale_item_id: lineId,
    product_id: line.product_id,
    entries: ledgerEntries.map((entry) => entry.kind),
    units_moved: unitsMoved,
    stock_skipped: stockSkipped,
    subtotal_before: round2(subtotalBeforeUsd),
    subtotal_after: money.subtotalUsd,
    total_before: totalBeforeUsd,
    total_after: money.totalUsd,
    tax_after: taxPlan.outcome.taxUsd,
    tax_recomputed: taxPlan.outcome.recomputed,
    tax_reason: taxPlan.outcome.reason,
    exchange_rate_before: sale.exchange_rate ?? null,
    exchange_rate_after: exchangeRate,
    outside_window: guard.outsideWindow,
    notes: note,
  })

  return c.json(response)
})

type StatementList = Array<{ sql: string; params: Record<string, unknown> }>

function nullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value) || 0
}

function receiptKhrFromUsd(value: unknown, exchangeRate: number): number | null {
  if (value == null) return null
  return financialCalculationValue(financialCalculationValue(Number(value) || 0) * financialCalculationValue(exchangeRate))
}

function amendmentMoneyBefore(sale: Record<string, unknown>) {
  return {
    exchange_rate: nullableNumber(sale.exchange_rate),
    updated_at: sale.updated_at == null ? null : String(sale.updated_at),
    subtotal_usd: Number(sale.subtotal_usd) || 0,
    subtotal_khr: nullableNumber(sale.subtotal_khr),
    total_usd: Number(sale.total_usd) || 0,
    total_khr: nullableNumber(sale.total_khr),
    change_usd: Number(sale.change_usd) || 0,
    change_khr: nullableNumber(sale.change_khr),
    change_is_actual: Number(sale.change_is_actual) === 1 ? 1 : 0,
    change_exchange_rate: nullableNumber(sale.change_exchange_rate),
    discount_khr: nullableNumber(sale.discount_khr),
    tax_khr: nullableNumber(sale.tax_khr),
    delivery_fee_khr: nullableNumber(sale.delivery_fee_khr),
    membership_discount_khr: nullableNumber(sale.membership_discount_khr),
  }
}

function amendmentMoneyAfter(
  sale: Record<string, unknown>,
  money: { subtotalUsd: number; subtotalKhr: number; totalUsd: number; totalKhr: number; changeUsd: number; changeKhr: number },
  exchangeRate: number,
  stamp: string,
  taxUsd: number,
  deliveryFeeUsd: number,
) {
  return {
    exchange_rate: exchangeRate,
    updated_at: stamp,
    subtotal_usd: money.subtotalUsd,
    subtotal_khr: money.subtotalKhr,
    total_usd: money.totalUsd,
    total_khr: money.totalKhr,
    change_usd: Number(sale.change_is_actual) === 1 ? Number(sale.change_usd) || 0 : money.changeUsd,
    change_khr: Number(sale.change_is_actual) === 1 ? nullableNumber(sale.change_khr) : money.changeKhr,
    change_is_actual: Number(sale.change_is_actual) === 1 ? 1 : 0,
    change_exchange_rate: Number(sale.change_is_actual) === 1 ? nullableNumber(sale.change_exchange_rate) : null,
    discount_khr: receiptKhrFromUsd(sale.discount_usd, exchangeRate),
    tax_khr: receiptKhrFromUsd(taxUsd, exchangeRate),
    delivery_fee_khr: receiptKhrFromUsd(deliveryFeeUsd, exchangeRate),
    membership_discount_khr: receiptKhrFromUsd(sale.membership_discount_usd, exchangeRate),
  }
}

function saleMutationReceiptStatement(input: {
  operationId: string
  actorId: number
  saleId: number
  kind: 'add_items' | 'amendment'
  requestId: string
  requestDigest: string
  requestJson: string
  before: unknown
  after: unknown
  response: Record<string, unknown>
  stamp: string
}): StatementList[number] {
  return {
    sql: `INSERT INTO sale_mutation_receipts(
            id,actor_id,sale_id,mutation_kind,request_id,request_digest,request_json,
            before_json,after_json,response_json,generation,sale_revision,updated_at
          ) VALUES(
            @operation,@actor,@saleId,@kind,@request,@digest,@requestJson,
            @beforeJson,@afterJson,@responseJson,0,
            COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=@saleId),0),@stamp
          )`,
    params: {
      operation: input.operationId,
      actor: input.actorId,
      saleId: input.saleId,
      kind: input.kind,
      request: input.requestId,
      digest: input.requestDigest,
      requestJson: input.requestJson,
      beforeJson: JSON.stringify(input.before),
      afterJson: JSON.stringify(input.after),
      responseJson: JSON.stringify(input.response),
      stamp: input.stamp,
    },
  }
}

function amendmentSettingsGuard(settings: Awaited<ReturnType<typeof readAmendmentMoneySettings>>): StatementList[number] {
  return saleMutationGuard(`
    COALESCE((SELECT value FROM settings WHERE key='exchange_rate'),'')=@exchangeRate
    AND COALESCE((SELECT value FROM settings WHERE key='change_exchange_rate'),'')=@changeRate
    AND COALESCE((SELECT value FROM settings WHERE key=@taxEnabledKey),'')=@taxEnabled
    AND COALESCE((SELECT value FROM settings WHERE key=@taxRateKey),'')=@taxRate
  `, {
    exchangeRate: settings.exchangeRateRaw ?? '',
    changeRate: settings.changeExchangeRateRaw ?? '',
    taxEnabledKey: TAX_ENABLED_SETTING_KEY,
    taxEnabled: settings.taxEnabledRaw ?? '',
    taxRateKey: TAX_RATE_SETTING_KEY,
    taxRate: settings.taxRateRaw ?? '',
  })
}

type AmendmentContext = Context<{ Bindings: Env; Variables: { user: SessionUser } }>

/**
 * The three settings every amendment's money depends on, read in ONE query.
 *
 * `change_exchange_rate` is Part 534's; `tax_enabled` + `tax_rate` are the
 * owner's tax switch (2026-09-04). Reading them together means a single path
 * decides tax for additions, line changes and fee corrections alike -- three
 * separate reads is how the three paths later disagree about whether tax moved.
 */
async function readAmendmentMoneySettings(db: ReturnType<typeof getDb>): Promise<{
  exchangeRate: number
  exchangeRateRaw: string | undefined
  changeExchangeRate: string | undefined
  changeExchangeRateRaw: string | undefined
  taxEnabledRaw: string | undefined
  taxRateRaw: string | undefined
  tax: TaxSettings
}> {
  // Bound, not interpolated. These three are module constants today, but a key
  // name spliced into SQL is a shape that stops being safe the moment someone
  // makes one configurable, and this file should not be the place that teaches
  // that habit.
  const rows = await db.prepare(
    'SELECT key, value FROM settings WHERE key IN (?, ?, ?, ?)',
  ).all<{ key: string; value: string }>(['exchange_rate', 'change_exchange_rate', TAX_ENABLED_SETTING_KEY, TAX_RATE_SETTING_KEY])
  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]))
  return {
    exchangeRate: Number(map.exchange_rate) > 0 ? Number(map.exchange_rate) : 4100,
    exchangeRateRaw: map.exchange_rate,
    changeExchangeRate: map.change_exchange_rate,
    changeExchangeRateRaw: map.change_exchange_rate,
    taxEnabledRaw: map[TAX_ENABLED_SETTING_KEY],
    taxRateRaw: map[TAX_RATE_SETTING_KEY],
    tax: resolveTaxSettings(map[TAX_ENABLED_SETTING_KEY], map[TAX_RATE_SETTING_KEY]),
  }
}

/**
 * Tax for one amendment: the outcome to report, the override the totals need,
 * and the statement (if any) that writes it back.
 *
 * The write is emitted ONLY when the amount actually moves, so a delivery-fee
 * correction -- which changes no line and therefore no taxable base -- does not
 * rewrite `tax_usd` with the value it already holds. Every non-recomputing case
 * still reports its reason, because "your tax line did not move, and here is
 * why" is information a shop needs at closing rather than a silence.
 */
function planAmendedTax(input: {
  saleId: number
  sale: AmendableSaleRow
  settings: TaxSettings
  subtotalBeforeUsd: number
  subtotalAfterUsd: number
  exchangeRate: number
}): { outcome: AmendedTaxResult; taxUsdOverride: number | null; statements: StatementList } {
  const outcome = resolveAmendedTaxUsd({
    sale: input.sale,
    taxableBaseBeforeUsd: taxableBaseUsd(input.sale, input.subtotalBeforeUsd),
    taxableBaseAfterUsd: taxableBaseUsd(input.sale, input.subtotalAfterUsd),
    settings: input.settings,
  })
  const storedTax = round2(Number(input.sale.tax_usd) || 0)
  const moved = outcome.recomputed && Math.abs(outcome.taxUsd - storedTax) >= 0.005
  return {
    outcome,
    taxUsdOverride: outcome.recomputed ? outcome.taxUsd : null,
    statements: moved ? [saleTaxUpdateStatement(input.saleId, outcome.taxUsd, input.exchangeRate)] : [],
  }
}

/**
 * One audit row per amendment, on top of the ledger entry.
 *
 * Not a duplicate of the ledger: `sale_amendments` is the SALE's history, read
 * on that sale's own screen; `audit` is the SYSTEM's history, read by whoever
 * is asking what a given user did last Tuesday. Both are wanted, and the same
 * pairing already exists for POST /:id/items.
 */
async function auditAmendment(
  c: AmendmentContext,
  user: SessionUser | undefined,
  saleId: number,
  sale: { receipt_number?: unknown; sale_status?: unknown },
  details: Record<string, unknown>,
): Promise<void> {
  await audit(c.env, user?.id ?? null, actorSnapshot(user), 'update', 'sale', saleId, {
    action: 'amend',
    receipt_number: sale.receipt_number ?? null,
    sale_status: sale.sale_status ?? null,
    ...details,
  })
  c.executionCtx.waitUntil(Promise.all([
    bumpVersion(c.env, 'products'),
    bumpVersion(c.env, 'sales'),
  ]))
}

/** The shape every amendment answers with, so the client never has to guess. */
async function amendmentResponse(
  c: AmendmentContext,
  db: ReturnType<typeof getDb>,
  input: {
    saleId: number
    sale: { amount_paid_usd?: unknown; amount_paid_khr?: unknown; receipt_number?: unknown }
    money: { totalUsd: number; totalKhr: number; subtotalUsd: number }
    exchangeRate: number
    stockMoved: boolean
    unitsMoved: number
    stockSkipped: boolean
    tax: AmendedTaxResult
  },
) {
  const updated = await db.prepare('SELECT updated_at FROM sales WHERE id = ?').get<{ updated_at: string }>([input.saleId])
  return c.json(buildAmendmentResponsePayload(input, updated?.updated_at || null))
}

function buildAmendmentResponsePayload(
  input: {
    saleId: number
    sale: { amount_paid_usd?: unknown; amount_paid_khr?: unknown; receipt_number?: unknown }
    money: { totalUsd: number; totalKhr: number; subtotalUsd: number }
    exchangeRate: number
    stockMoved: boolean
    unitsMoved: number
    stockSkipped: boolean
    tax: AmendedTaxResult
  },
  updatedAt: string | null,
): Record<string, unknown> {
  return {
    id: input.saleId,
    // DECISION 6: an amended sale keeps its ORIGINAL receipt number, and a
    // reprint is a reprint -- settled by the owner on 2026-09-04. One sale,
    // one number, so no revenue report can count it twice.
    receiptNumber: input.sale.receipt_number ?? null,
    subtotalUsd: input.money.subtotalUsd,
    totalUsd: input.money.totalUsd,
    totalKhr: input.money.totalKhr,
    outstandingUsd: round2(Math.max(0, input.money.totalUsd - (Number(input.sale.amount_paid_usd) || 0) - (Number(input.sale.amount_paid_khr) || 0) / input.exchangeRate)),
    stockMoved: input.stockMoved,
    unitsMoved: input.unitsMoved,
    stockSkipped: input.stockSkipped,
    // Tax, reported rather than left to be inferred. `taxRecomputed: false`
    // with a reason is the interesting case: a shop that sees its total move
    // while the tax line stands still deserves to be told why on the screen,
    // not to discover it at closing. Reasons are in lib/saleAmendments.ts's
    // DECISION 4a; 'no_tax_on_sale' simply means this sale never had tax, so
    // there is no tax row to show at all.
    taxUsd: input.tax.taxUsd,
    taxRecomputed: input.tax.recomputed,
    taxReason: input.tax.reason,
    // Both discounts genuinely are frozen: absolute amounts with no stored
    // rate, and changing one is a money decision rather than a correction.
    discountFrozen: true,
    exchangeRate: input.exchangeRate,
    updated_at: updatedAt,
  }
}

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
// products table, not copied onto the line-item row at sale time), PLUS
// s.legacy_receipt_number (migration 0107) so a sale whose old-system
// `NNNNNN@YYYY-MM-DD` label was rewritten to the business format is still
// findable by the number printed on the customer's old paper receipt.
// Deliberately still a LIKE scan, not FTS5 -- see buildLikeAliasClause's
// own comment in lib/searchMatch.ts for why that's a considered choice
// for this table, not an oversight.
function buildSalesSearchWhere(query: Record<string, string>, params: Record<string, unknown>): string | undefined {
  const raw = query.search || query.q || ''
  const groups = tokenizeSearchTermGroups(raw)
  if (!groups.length) return undefined
  const mode = String(query.searchMode || query.search_mode || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'

  // Keep one shallow haystack per row context. Passing every raw column to
  // buildLikeAliasClause with its default normalization repeats the full
  // ~70-REPLACE diacritic expression for every column and every word. At
  // production history size D1 rejected even an ordinary product-name
  // search with `SQLITE_TOOBIG` before it could return a row. Query words
  // are already normalized/tokenized above; punctuation variants still
  // work because each normalized word is searched independently. Product
  // name/brand also include their write-time-normalized catalog columns.
  // s.search_normalized (migration 0082) is the write-time diacritic-folded
  // form of the sale's own text fields; it is PREPENDED to the unchanged raw
  // concatenation, not substituted for it. So a folded query ("jose") matches
  // a stored "José" via the blob, while a row without a blob yet (historical
  // import rows, which the importer does not populate) still searches exactly
  // as before through the raw columns -- additive, never a regression. See the
  // migration's own comment for why there is no data backfill.
  const flatHaystack = `(
    COALESCE(s.search_normalized, '') || ' ' ||
    COALESCE(s.receipt_number, '') || ' ' || COALESCE(s.legacy_receipt_number, '') || ' ' ||
    COALESCE(s.cashier_name, '') || ' ' ||
    COALESCE(s.customer_name, '') || ' ' || COALESCE(s.customer_phone, '') || ' ' ||
    COALESCE(s.branch_name, '') || ' ' || COALESCE(s.payment_method, '') || ' ' ||
    COALESCE(s.notes, '') || ' ' || COALESCE(c.membership_number, '')
  )`
  const itemHaystack = `(
    COALESCE(sis.product_name, '') || ' ' || COALESCE(sis.sku, '') || ' ' ||
    COALESCE(sip.barcode, '') || ' ' || COALESCE(sip.brand, '') || ' ' ||
    COALESCE(sip.name_normalized, '') || ' ' || COALESCE(sip.brand_compact, '')
  )`

  let groupIndex = 0
  const groupClauses = groups.map((words) => {
    let wordIndex = 0
    const wordClauses = words.map((word) => {
      const keyBase = `srch${groupIndex}_${wordIndex}`
      wordIndex += 1
      const flatClause = buildLikeAliasClause(word, [flatHaystack], params, `${keyBase}_f`, true)
      const itemClause = buildLikeAliasClause(word, [itemHaystack], params, `${keyBase}_i`, true)
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
  // canReadSales admits a 'view' grant (read-only); writes below stay strict.
  if (!canReadSales(user)) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const db = getDb(c.env)

  const where: string[] = ['1=1']
  const params: Record<string, unknown> = {}

  if (query.startDate) { where.push(localDateAtOrAfter('s.created_at')); params.startDate = query.startDate }
  if (query.endDate) { where.push(localDateAtOrBefore('s.created_at')); params.endDate = query.endDate }
  appendLocalTimeRange(query, where, params, 's.created_at')
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

  const limit = Math.max(1, Math.min(Number.parseInt(String(query.limit || '100'), 10) || 100, 200))
  const page = Math.max(1, Number.parseInt(String(query.page || '1'), 10) || 1)
  const offset = (page - 1) * limit
  params.limit = limit
  params.offset = offset

  const sortExpressions: Record<string, string> = {
    date: 's.created_at',
    total: 'COALESCE(s.total_usd, 0)',
    customer: "COALESCE(s.customer_name, '') COLLATE NOCASE",
    cashier: "COALESCE(s.cashier_name, '') COLLATE NOCASE",
    status: "COALESCE(s.sale_status, '') COLLATE NOCASE",
    receipt: "COALESCE(s.receipt_number, '') COLLATE NOCASE",
  }
  const sortExpression = sortExpressions[String(query.sortBy || 'date')] || sortExpressions.date
  const sortDirection = String(query.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC'
  const orderSql = `${sortExpression} ${sortDirection}, s.id ${sortDirection}`

  const cacheVersion = await getSalesReadCacheVersion(c.env)
  const payload = await cachedJsonResponse(c.req.raw, c.executionCtx, cacheVersion, SALES_READ_CACHE_TTL_SECONDS, async () => {

    const sales = await db.prepare(`
      SELECT s.*, c.membership_number AS customer_membership_number,
        dc.name AS linked_driver_name, dc.phone AS linked_driver_phone
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN delivery_contacts dc ON dc.id = s.delivery_contact_id AND COALESCE(s.is_delivery, 0) <> 0
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderSql}
      LIMIT @limit OFFSET @offset
    `).all<SaleRow>(params)

    if (sales.length === 0) return []

  // `limit` above allows up to 500 sales, and D1 refuses a statement with
  // more than 100 bound parameters -- the Sales page's own list read was
  // one `?limit=101` away from the same crash GET /api/products hit.
    const saleIds = sales.map((s) => s.id)

    const itemRows = await selectInChunks(saleIds, 0, (chunk) => db.prepare(`
      SELECT si.*, b.name AS branch_name, p.barcode AS barcode, p.category AS category,
        COALESCE((
          SELECT SUM(ri.quantity)
          FROM return_items ri
          JOIN returns item_return ON item_return.id = ri.return_id
          WHERE ri.sale_item_id = si.id
            AND COALESCE(item_return.status, 'completed') != 'cancelled'
            AND COALESCE(item_return.return_scope, 'customer') = 'customer'
        ), 0) AS returned_quantity,
        -- Does this line still know which lot(s) it drew from? A multi-lot
        -- line carries batch_id NULL and keeps the answer here instead, so a
        -- return of it must NOT be treated as "lot unknown" and asked to pick
        -- one -- that would collapse a real split onto a single lot. Reads
        -- the (sale_item_id, released_at) index; a legacy line predating lot
        -- tracking correctly answers 0.
        (SELECT COUNT(*) FROM sale_item_batch_allocations sia
          WHERE sia.sale_item_id = si.id AND sia.quantity > COALESCE(sia.released_quantity, 0)) AS lot_allocation_count
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

    return sales.map((sale) => {
      const { linked_driver_name, linked_driver_phone, ...snapshot } = sale
      const refund = refundsBySale.get(sale.id)
      const refundUsd = refund?.refund_usd || 0
      const refundKhr = refund?.refund_khr || 0
      return {
        ...snapshot,
        delivery_contact_name: String(sale.delivery_contact_name ?? '').trim() ? sale.delivery_contact_name : linked_driver_name ?? null,
        delivery_contact_phone: String(sale.delivery_contact_phone ?? '').trim() ? sale.delivery_contact_phone : linked_driver_phone ?? null,
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
  const user = c.get('user')
  // Matches GET / above -- same 'sales'-gated data, just aggregated.
  if (!canReadSales(user)) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const db = getDb(c.env)

  const where: string[] = ['1=1']
  const params: Record<string, unknown> = {}
  if (query.startDate) { where.push(localDateAtOrAfter('s.created_at')); params.startDate = query.startDate }
  if (query.endDate) { where.push(localDateAtOrBefore('s.created_at')); params.endDate = query.endDate }
  appendLocalTimeRange(query, where, params, 's.created_at')
  if (query.cashier) { where.push('s.cashier_name LIKE @cashier'); params.cashier = `%${query.cashier}%` }
  if (query.userId) {
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
  if (query.branchId) {
    where.push('(s.branch_id = @branchId OR EXISTS (SELECT 1 FROM sale_items sif WHERE sif.sale_id = s.id AND sif.branch_id = @branchId))')
    params.branchId = query.branchId
  }
  const searchClause = buildSalesSearchWhere(query, params)
  if (searchClause) where.push(searchClause)

  // ONE aggregate, not "read every matching row, then chunk a refund
  // lookup over their ids". The old shape pulled the entire result set
  // into the Worker and then issued a sequential D1 statement per 100
  // sale ids (chunkForBinding caps an IN list at D1's 100 bound
  // parameters), so the page's own unfiltered header -- the request the
  // Sales page fires on load -- cost ~150 round trips against production's
  // 14.9k receipts for three numbers SQLite computes in a single pass.
  // Refunds join as a PRE-AGGREGATED derived table so a sale carrying two
  // returns still subtracts once, exactly as the per-sale Map did.
  //
  // buildSalesSearchWhere's flat clause references `c.membership_number`,
  // so this query needs the same customers join GET / already has --
  // without it, a search including a membership-number term would silently
  // 500 (unknown column c.membership_number) instead of just finding zero
  // matches, and revenue stats would disagree with the list view for that
  // exact query shape (the drift risk buildSalesSearchWhere exists to
  // prevent in the first place).
  //
  // Revenue basis = NET SALES (subtotal net of both discounts), minus customer
  // refunds -- the canonical definition (user directive Sep 1 2026). Tax and
  // delivery fees are pass-through, NOT revenue, so total_usd (which folds tax
  // in) is not the base here. Awaiting-payment (unpaid credit) uses the same net
  // basis but is reported separately as pending, never folded into revenue.
  //
  // This header used to spell that definition out a SECOND time and carry a
  // comment claiming it matched salesAnalytics.ts byte for byte. It stopped
  // matching the moment the kernel began apportioning the refund onto the net
  // basis (Sep 4 2026), and nothing would have said so -- the Sales page and the
  // Dashboard would simply have shown two different revenues for the same
  // filter. So it now interpolates the kernel's OWN exported fragments,
  // including the refund subquery, and agreement is structural rather than
  // asserted. The blank-status rule (both '' and NULL mean completed) lives in
  // recognizedExpr with the rest of it.
  const cacheVersion = await getSalesReadCacheVersion(c.env)
  const payload = await cachedJsonResponse(c.req.raw, c.executionCtx, cacheVersion, SALES_READ_CACHE_TTL_SECONDS, async () => {
    const totals = await db.prepare(`
    SELECT
      COUNT(*) AS total_count,
      COALESCE(SUM(CASE WHEN ${recognizedExpr('s.')} THEN 1 ELSE 0 END), 0) AS revenue_count,
      COALESCE(SUM(CASE WHEN ${recognizedExpr('s.')}
        THEN ${netSaleExpr('s.')} - ${netRefundExpr('s.', 'rf.')} ELSE 0 END), 0) AS revenue_usd,
      COALESCE(SUM(CASE WHEN ${awaitingExpr('s.')}
        THEN ${netSaleExpr('s.')} ELSE 0 END), 0) AS pending_revenue_usd
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    ${CUSTOMER_REFUND_JOIN}s.id
    WHERE ${where.join(' AND ')}
  `).get<{ total_count: number; revenue_count: number; revenue_usd: number; pending_revenue_usd: number }>(params)

    const totalCount = Number(totals?.total_count) || 0
    const listLimit = Math.max(1, Math.min(Number.parseInt(String(query.limit || '100'), 10) || 100, 200))
    return {
      total_count: totalCount,
      revenue_count: Number(totals?.revenue_count) || 0,
      revenue_usd: round2(Number(totals?.revenue_usd) || 0),
      pending_revenue_usd: round2(Number(totals?.pending_revenue_usd) || 0),
      // This now means "more pages exist", not "the data was discarded".
      truncated_in_list: totalCount > listLimit,
    }
  })
  return c.json(payload)
})

// GET /api/sales/stats-strip?startDate&endDate&branchId -- the Sales page's
// foldable stats strip (shared StatsStrip component): headline figures from
// THE salesAnalytics kernel (so they agree with the Dashboard and the daily
// report for the same range) plus the per-card fold breakdowns -- payment
// methods, status mix, and the range's customer returns. Deliberately
// range+branch scoped only, NOT list-filter scoped: the strip answers "how
// was this period", the list header keeps answering "what does this filter
// match".
app.get('/stats-strip', async (c) => {
  if (!canReadSales(c.get('user'))) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const query = c.req.query()
  const startDate = String(query.startDate || '').slice(0, 10)
  const endDate = String(query.endDate || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return c.json({ error: 'startDate and endDate (YYYY-MM-DD) are required' }, 400)
  }
  const db = getDb(c.env)
  const startTime = String(query.startTime || '').trim()
  const endTime = String(query.endTime || '').trim()
  const hasTimeRange = LOCAL_TIME_RE.test(startTime) && LOCAL_TIME_RE.test(endTime)
  const filters = {
    startDate,
    endDate,
    branchId: query.branchId || null,
    startTime: hasTimeRange ? startTime : null,
    endTime: hasTimeRange ? endTime : null,
  }
  const rangeParams: Record<string, unknown> = { startDate, endDate }
  // Status mix counts EVERY status (the kernel's whereActiveSales excludes
  // cancelled/awaiting on purpose for money figures; the mix card exists
  // precisely to show those too).
  const statusClauses = [localDateRangeClause('created_at')]
  if (hasTimeRange) {
    statusClauses.push(localTimeRangeClause('created_at'))
    rangeParams.startTime = startTime
    rangeParams.endTime = endTime
  }
  if (query.branchId) { statusClauses.push('branch_id = @branchId'); rangeParams.branchId = query.branchId }
  const cacheVersion = await getSalesReadCacheVersion(c.env)
  const payload = await cachedJsonResponse(c.req.raw, c.executionCtx, cacheVersion, SALES_READ_CACHE_TTL_SECONDS, async () => {
    const [totals, byPayment, byStatus, returnsRow] = await Promise.all([
      getSalesTotals(c.env, filters),
      getPaymentMethodBreakdown(c.env, filters),
      db.prepare(`
        SELECT COALESCE(NULLIF(TRIM(sale_status), ''), 'completed') AS sale_status,
               COUNT(*) AS count, ROUND(COALESCE(SUM(total_usd), 0), 2) AS total_usd
        FROM sales
        WHERE ${statusClauses.join(' AND ')}
        GROUP BY COALESCE(NULLIF(TRIM(sale_status), ''), 'completed')
        ORDER BY count DESC
      `).all<{ sale_status: string; count: number; total_usd: number }>(rangeParams),
      db.prepare(`
        SELECT COUNT(*) AS count, ROUND(COALESCE(SUM(total_refund_usd), 0), 2) AS refund_usd
        FROM returns
        WHERE ${localDateRangeClause('created_at')}
          ${hasTimeRange ? `AND ${localTimeRangeClause('created_at')}` : ''}
          AND COALESCE(return_scope, 'customer') = 'customer'
          AND COALESCE(status, 'completed') <> 'cancelled'
          ${query.branchId ? 'AND branch_id = @branchId' : ''}
      `).get<{ count: number; refund_usd: number }>(rangeParams),
    ])
    return {
      startDate,
      endDate,
      startTime: hasTimeRange ? startTime : null,
      endTime: hasTimeRange ? endTime : null,
      totals,
      by_payment: byPayment,
      by_status: byStatus || [],
      returns: { count: Number(returnsRow?.count || 0), refund_usd: Number(returnsRow?.refund_usd || 0) },
    }
  })
  return c.json(payload)
})

// ---- Phase X (Part 395): the daily report ---------------------------------
// GET /api/sales/daily-report?startDate&endDate&branchId -- one row per day
// in the range (the report section's list), straight from the shared
// salesAnalytics kernel so every figure agrees with the Dashboard and /stats.
app.get('/daily-report', async (c) => {
  if (!canReadSales(c.get('user'))) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const query = c.req.query()
  const startDate = String(query.startDate || '').slice(0, 10)
  const endDate = String(query.endDate || '').slice(0, 10)
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  if ((startDate && !validDate(startDate)) || (endDate && !validDate(endDate))) {
    return c.json({ error: 'startDate/endDate must use YYYY-MM-DD' }, 400)
  }
  const days = await getSalesPeriodSeries(c.env, {
    startDate: startDate || null,
    endDate: endDate || null,
    branchId: query.branchId || null,
    status: query.status || null,
    paymentMethod: query.paymentMethod || null,
    startTime: query.startTime || null,
    endTime: query.endTime || null,
    tzOffsetMinutes: Number(query.tzOffsetMinutes) || 0,
  }, 'day')
  return c.json({ startDate, endDate, days })
})

// GET /api/sales/day-report?date&branchId -- the click-a-day drill: the
// day's full totals plus the payment-method, delivery (incl. per-courier)
// and discount breakdowns. Actual delivery cost is a staff figure; this
// whole route sits behind the sales permission, and the portal/receipt
// surfaces never call it (C2's redaction scope).
app.get('/day-report', async (c) => {
  if (!canReadSales(c.get('user'))) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const query = c.req.query()
  const date = String(query.date || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'date (YYYY-MM-DD) is required' }, 400)
  }
  const report = await getSalesDayReport(c.env, date, {
    branchId: query.branchId || null,
    status: query.status || null,
    paymentMethod: query.paymentMethod || null,
    startTime: query.startTime || null,
    endTime: query.endTime || null,
    tzOffsetMinutes: Number(query.tzOffsetMinutes) || 0,
  })
  return c.json(report)
})

// GET /api/sales/delivery-contact-report?startDate&endDate&branchId&contactId
// X3: per-courier delivery totals over a range -- "check expenses of
// delivery by contact". Gated on sales OR contacts: the DeliveryTab drill
// belongs to contacts-granted staff, and the figures are the same ones the
// sales surfaces already show them per sale.
app.get('/delivery-contact-report', async (c) => {
  if (!canReadSales(c.get('user')) && !hasPermission(c.get('user'), 'contacts')) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const query = c.req.query()
  const startDate = String(query.startDate || '').slice(0, 10)
  const endDate = String(query.endDate || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return c.json({ error: 'startDate and endDate (YYYY-MM-DD) are required' }, 400)
  }
  const contacts = await getDeliveryContactTotals(c.env, {
    startDate,
    endDate,
    branchId: query.branchId || null,
    contactId: query.contactId || null,
    startTime: query.startTime || null,
    endTime: query.endTime || null,
    tzOffsetMinutes: Number(query.tzOffsetMinutes) || 0,
  })
  return c.json({ startDate, endDate, contacts })
})

// GET /api/sales/customer-report?customerId&startDate&endDate -- X4: the
// customer leg of the per-contact drills. Same sales-OR-contacts gate as
// the courier report (the Customers tab lives behind 'contacts').
app.get('/customer-report', async (c) => {
  if (!canReadSales(c.get('user')) && !hasPermission(c.get('user'), 'contacts')) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const query = c.req.query()
  const customerId = Number(query.customerId)
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return c.json({ error: 'A valid customerId is required' }, 400)
  }
  const startDate = String(query.startDate || '').slice(0, 10)
  const endDate = String(query.endDate || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return c.json({ error: 'startDate and endDate (YYYY-MM-DD) are required' }, 400)
  }
  const totals = await getCustomerSalesTotals(c.env, {
    startDate,
    endDate,
    customerId,
    branchId: query.branchId || null,
    startTime: query.startTime || null,
    endTime: query.endTime || null,
    tzOffsetMinutes: Number(query.tzOffsetMinutes) || 0,
  })
  return c.json({ startDate, endDate, customerId, totals })
})

// GET /api/sales/export -- complete, snapshot-stable accounting export.
// Detail rows are keyset-paged so large ranges never rely on one unbounded
// Worker response. Page 1 freezes `snapshot_max_id`; later requests reuse it
// plus `next_cursor`, so newly-created/backdated sales cannot shift, duplicate,
// or disappear between pages. Summary aggregates are computed over the whole
// frozen snapshot and only need to be requested on page 1.
app.get('/export', async (c) => {
  if (getActionTier(c.get('user'), 'sales', 'export') === 'none') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const db = getDb(c.env)
  const query = c.req.query()
  const clamp = (raw: unknown, fallback: number, min: number, max: number): number => {
    const n = Number(raw)
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : fallback
  }
  const detailLimit = clamp(query.pageSize, 250, 1, 500)
  const detailsOnly = ['1', 'true', 'yes'].includes(String(query.detailsOnly || '').toLowerCase())

  const baseWhere: string[] = ['1=1']
  const baseParams: Record<string, unknown> = {}
  if (query.startDate) { baseWhere.push(localDateAtOrAfter('s.created_at')); baseParams.startDate = query.startDate }
  if (query.endDate) { baseWhere.push(localDateAtOrBefore('s.created_at')); baseParams.endDate = query.endDate }
  if (query.branchId) { baseWhere.push('s.branch_id = @branchId'); baseParams.branchId = query.branchId }

  const requestedSnapshot = Number(query.snapshotMaxId)
  let snapshotMaxId = Number.isSafeInteger(requestedSnapshot) && requestedSnapshot > 0 ? requestedSnapshot : 0
  if (!snapshotMaxId) {
    const snapshotRow = await db.prepare(`
      SELECT MAX(s.id) AS max_id
      FROM sales s
      WHERE ${baseWhere.join(' AND ')}
    `).get<{ max_id: number | null }>(baseParams)
    snapshotMaxId = Number(snapshotRow?.max_id) || 0
  }

  const period = { start: query.startDate || null, end: query.endDate || null }
  const emptySummary = {
    total_transactions: 0, completed_transactions: 0, revenue_usd: 0,
    cogs_usd: 0, gross_profit_usd: 0, gross_margin_pct: 0,
    total_discounts_usd: 0, total_tax_usd: 0, total_delivery_usd: 0,
    total_refunds_usd: 0, net_revenue_usd: 0, avg_order_usd: 0,
  }
  if (!snapshotMaxId) {
    return c.json({
      period, summary: detailsOnly ? undefined : emptySummary,
      by_status: detailsOnly ? undefined : [], by_product: detailsOnly ? undefined : [],
      sales: [], total_matching: 0, snapshot_max_id: null, has_more: false, next_cursor: null, truncated: false,
    })
  }

  const snapshotWhere = [...baseWhere, 's.id <= @snapshotMaxId']
  const snapshotParams: Record<string, unknown> = { ...baseParams, snapshotMaxId }
  const detailWhere = [...snapshotWhere]
  const detailParams: Record<string, unknown> = { ...snapshotParams }
  const afterCreatedAt = String(query.afterCreatedAt || '').trim()
  const afterId = Number(query.afterId)
  if (afterCreatedAt && Number.isSafeInteger(afterId) && afterId > 0) {
    // sales.created_at is NOT one consistent shape: live inserts are
    // 'YYYY-MM-DD HH:MM:SS' (sanitizeClientCreatedAt normalizes offline
    // replays to match the server's CURRENT_TIMESTAMP shape -- see
    // lib/clientTimestamp.ts) but legacy-import rows are ISO
    // 'YYYY-MM-DDTHH:MM:SS.sssZ' (lib/*legacy-reports.mjs's
    // bangkokToUtc/legacyToUtc write .toISOString()), and both eras coexist
    // on the same calendar days. A raw string compares 'T' (0x54) after ' '
    // (0x20) at position 10, so a same-day cross-shape raw comparison
    // misorders -- the datetime() wrap below is required for correctness,
    // not just inherited caution. What IS safe raw is the first 10 chars
    // ('YYYY-MM-DD'): identical in both shapes, so a floor on just the date
    // portion can never exclude a row the exact clause would keep, and it
    // gives the planner a sargable seek into idx_sales_created_pg instead of
    // scanning from the start of the table on every later page.
    if (afterCreatedAt.length >= 10) {
      detailWhere.push('s.created_at >= @afterCreatedAtFloor')
      detailParams.afterCreatedAtFloor = afterCreatedAt.slice(0, 10)
    }
    detailWhere.push(`(datetime(s.created_at) > datetime(@afterCreatedAt) OR (datetime(s.created_at) = datetime(@afterCreatedAt) AND s.id > @afterId))`)
    detailParams.afterCreatedAt = afterCreatedAt
    detailParams.afterId = afterId
  }

  type ExportSaleRow = {
    id: number; receipt_number: string | null; created_at: string; branch_name: string | null
    cashier_name: string | null; customer_name: string | null; customer_phone: string | null; customer_address: string | null
    payment_method: string | null; payment_currency: string | null; exchange_rate: number | null; sale_status: string | null
    subtotal_usd: number | null; subtotal_khr: number | null; discount_usd: number | null; discount_khr: number | null
    membership_discount_usd: number | null; membership_discount_khr: number | null; membership_points_redeemed: number | null
    tax_usd: number | null; amount_paid_usd: number | null; amount_paid_khr: number | null
    is_delivery: number | null; delivery_contact_name: string | null; delivery_contact_phone: string | null; delivery_contact_address: string | null
    delivery_fee_usd: number | null; delivery_fee_khr: number | null; delivery_fee_paid_by: string | null
    total_usd: number | null; total_khr: number | null; notes: string | null
  }

  // Read one extra sale so `has_more` is authoritative without an OFFSET or
  // another COUNT on every details-only page. ORDER BY keeps the datetime()
  // wrap deliberately -- see the mixed-shape note above the keyset cursor --
  // a raw ORDER BY on created_at would misorder same-day rows that mix the
  // ISO and space-separated shapes.
  const pageRows = await db.prepare(`
    SELECT s.id, s.receipt_number, s.created_at, s.branch_name, s.cashier_name,
           s.customer_name, s.customer_phone, s.customer_address,
           s.payment_method, s.payment_currency, s.exchange_rate, s.sale_status,
           s.subtotal_usd, s.subtotal_khr, s.discount_usd, s.discount_khr,
           s.membership_discount_usd, s.membership_discount_khr, s.membership_points_redeemed,
           s.tax_usd, s.amount_paid_usd, s.amount_paid_khr,
           s.is_delivery, s.delivery_contact_name, s.delivery_contact_phone, s.delivery_contact_address,
           s.delivery_fee_usd, s.delivery_fee_khr, s.delivery_fee_paid_by, s.total_usd, s.total_khr, s.notes
    FROM sales s
    WHERE ${detailWhere.join(' AND ')}
    ORDER BY datetime(s.created_at) ASC, s.id ASC
    LIMIT @detailLimit
  `).all<ExportSaleRow>({ ...detailParams, detailLimit: detailLimit + 1 })
  const hasMore = pageRows.length > detailLimit
  const sales = hasMore ? pageRows.slice(0, detailLimit) : pageRows
  const lastSale = sales[sales.length - 1] || null
  const nextCursor = hasMore && lastSale ? { created_at: lastSale.created_at, id: lastSale.id } : null

  const saleIds = sales.map((sale) => sale.id)
  const exportItems = saleIds.length
    ? await selectInChunks(saleIds, 0, (chunk) => db.prepare(`
        SELECT si.*, p.barcode AS barcode
        FROM sale_items si
        LEFT JOIN products p ON p.id = si.product_id
        WHERE si.sale_id IN (${chunk.map(() => '?').join(',')})
        ORDER BY si.id ASC
      `).all<{ sale_id: number; [key: string]: unknown }>(chunk))
    : []
  const exportItemsBySale = new Map<number, Array<Record<string, unknown>>>()
  for (const item of exportItems) {
    if (!exportItemsBySale.has(item.sale_id)) exportItemsBySale.set(item.sale_id, [])
    exportItemsBySale.get(item.sale_id)!.push(item)
  }

  const detailRows = sales.flatMap((sale) => {
    const storedItems = exportItemsBySale.get(sale.id) || []
    const items = storedItems.length ? storedItems : [{}]
    return items.map((item, index) => ({
      receipt_number: index === 0 ? sale.receipt_number : '',
      sale_date: index === 0 ? sale.created_at : '',
      sale_status: index === 0 ? sale.sale_status : '',
      payment_method: index === 0 ? sale.payment_method : '',
      payment_currency: index === 0 ? sale.payment_currency : '',
      exchange_rate: index === 0 ? sale.exchange_rate : '',
      branch: index === 0 ? sale.branch_name : '',
      customer_name: index === 0 ? sale.customer_name : '',
      customer_phone: index === 0 ? sale.customer_phone : '',
      customer_address: index === 0 ? sale.customer_address : '',
      cashier_name: index === 0 ? sale.cashier_name : '',
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
      discount_usd: index === 0 ? sale.discount_usd : '', discount_khr: index === 0 ? sale.discount_khr : '',
      tax_usd: index === 0 ? sale.tax_usd : '', amount_paid_usd: index === 0 ? sale.amount_paid_usd : '', amount_paid_khr: index === 0 ? sale.amount_paid_khr : '',
      membership_discount_usd: index === 0 ? sale.membership_discount_usd : '', membership_discount_khr: index === 0 ? sale.membership_discount_khr : '',
      membership_points_redeemed: index === 0 ? sale.membership_points_redeemed : '',
      is_delivery: index === 0 ? sale.is_delivery : '', delivery_contact_name: index === 0 ? sale.delivery_contact_name : '',
      delivery_contact_phone: index === 0 ? sale.delivery_contact_phone : '', delivery_contact_address: index === 0 ? sale.delivery_contact_address : '',
      delivery_fee_usd: index === 0 ? sale.delivery_fee_usd : '', delivery_fee_khr: index === 0 ? sale.delivery_fee_khr : '',
      delivery_fee_paid_by: index === 0 ? sale.delivery_fee_paid_by : '', notes: index === 0 ? sale.notes : '',
    }))
  })

  if (detailsOnly) {
    return c.json({
      period, sales: detailRows, snapshot_max_id: snapshotMaxId,
      has_more: hasMore, next_cursor: nextCursor, truncated: false,
    })
  }

  const totalMatchingRow = await db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN COALESCE(s.sale_status, 'completed') = 'completed' THEN 1 ELSE 0 END) AS completed
    FROM sales s
    WHERE ${snapshotWhere.join(' AND ')}
  `).get<{ total: number; completed: number }>(snapshotParams)
  const totalMatching = Number(totalMatchingRow?.total) || 0

  const salesTotals = await getSalesTotals(c.env, {
    startDate: query.startDate || null,
    endDate: query.endDate || null,
    branchId: query.branchId || null,
    maxSaleId: snapshotMaxId,
  })

  // Full-snapshot ranking. This must not be derived from the current detail
  // page or a product can disappear simply because its receipts are on a later
  // export page. Top-100 is an explicit ranking output, not a hidden history.
  const byProduct = await db.prepare(`
    SELECT si.product_id, si.product_name,
           COALESCE(SUM(si.quantity), 0) AS qty_sold,
           COALESCE(SUM(si.total_usd), 0) AS revenue_usd
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE ${snapshotWhere.join(' AND ')}
      AND COALESCE(s.sale_status, 'completed') <> 'cancelled'
    GROUP BY si.product_id, si.product_name
    ORDER BY revenue_usd DESC, qty_sold DESC
    LIMIT 100
  `).all<{ product_id: number | null; product_name: string | null; qty_sold: number; revenue_usd: number }>(snapshotParams)

  const byStatusRows = await db.prepare(`
    SELECT COALESCE(s.sale_status, 'completed') AS status, COUNT(*) AS count,
           COALESCE(SUM(s.total_usd), 0) AS revenue
    FROM sales s
    WHERE ${snapshotWhere.join(' AND ')}
    GROUP BY COALESCE(s.sale_status, 'completed')
  `).all<{ status: string; count: number; revenue: number }>(snapshotParams)

  // Canonical SalesTotals.revenue_usd is already NET of customer refunds.
  // Export's accounting view displays the pre-refund net-sales line, refunds,
  // then the canonical net revenue so the visible equation is exact:
  //     Revenue - Refunds = Net Revenue
  // The old export subtracted refunds from salesTotals.revenue_usd a second
  // time, understating net revenue whenever any return existed.
  const totalRefundsUsd = salesTotals.refund_usd
  const revenueBeforeRefunds = round2(salesTotals.revenue_usd + totalRefundsUsd)
  const netRevenueUsd = salesTotals.revenue_usd
  const summary = {
    total_transactions: totalMatching,
    completed_transactions: Number(totalMatchingRow?.completed) || 0,
    revenue_usd: revenueBeforeRefunds,
    cogs_usd: salesTotals.cost_usd,
    gross_profit_usd: salesTotals.profit_usd,
    gross_margin_pct: netRevenueUsd > 0 ? round2((salesTotals.profit_usd / netRevenueUsd) * 100) : 0,
    total_discounts_usd: salesTotals.discount_usd,
    total_tax_usd: salesTotals.tax_usd,
    total_delivery_usd: salesTotals.delivery_usd,
    total_refunds_usd: totalRefundsUsd,
    net_revenue_usd: netRevenueUsd,
    avg_order_usd: salesTotals.avg_order_usd,
  }

  return c.json({
    period, summary,
    by_status: byStatusRows.map((row) => ({ status: row.status, count: Number(row.count) || 0, revenue: round2(Number(row.revenue) || 0) })),
    by_product: byProduct.map((row) => ({ ...row, qty_sold: round2(Number(row.qty_sold) || 0), revenue_usd: round2(Number(row.revenue_usd) || 0) })),
    sales: detailRows,
    total_matching: totalMatching,
    snapshot_max_id: snapshotMaxId,
    has_more: hasMore,
    next_cursor: nextCursor,
    truncated: false,
  })
})
export default app
