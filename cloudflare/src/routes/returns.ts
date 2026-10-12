import { parseStockConditionTag } from '../lib/stockCondition'
import { readTaggedSaleSources } from '../lib/saleLineAddition'
import { stockActorPredicate, stockActorParams } from '../lib/stockActorGuard'
import { planCountedTaggedChange, CountedStockBatchPlan, CountedStockConflictError, countedStockFactsSql, isCountedStockConflict, subtractCountedQuantity, sumCountedQuantities, planExactCountedTaggedChange, planExactCountedOrdinaryChange } from '../lib/countedDamagedStock'
import {
  assertReturnKeeperClaimsProven, resolveCountedReturnConditions, resolveCountedReturnConditionsFromSnapshot, returnKeeperClaimError,
  returnKeeperClaimSources, ReturnKeeperClaimError, type OriginalReturnCondition, type ReturnKeeperClaim,
} from '../lib/countedReturnCondition'
import { planProductMergePhysicalOrigins, ProductMergePhysicalOriginError, type ProductMergePhysicalSource } from '../lib/productMergePhysicalOrigins'
import type { MergeOriginIdentity } from '../lib/productMergeOriginPlan'
import { productStockGuardError } from '../lib/productStockGuard'
import { Hono, type Context } from 'hono'
import { getPlanLimits } from '../lib/planTier'
import type { RequestMetrics } from '../lib/requestMetrics'
import { ReturnCreateBudgetError, assertReturnCreateQueryBudget } from '../lib/returnCreateAction'
import { acquisitionCostResponses, canViewAcquisitionCosts, canEditAcquisitionCosts, hasAcquisitionCostInput } from '../lib/acquisitionCostAccess'
import { fillOmittedReturnCosts } from '../lib/returnCostAccess'
import { getDb } from '../lib/db'
import { ordinaryBusinessMaintenanceGuard, runOrdinaryBusinessWrite } from '../lib/businessMaintenanceGuard'
import { executeStockTransaction, stockTransactionStatementCount, stockTransactionRefusal } from '../lib/stockTransaction'
import { selectInChunks } from '../lib/sqlBinding'
import { localDateAtOrAfter, localDateAtOrBefore, localDateExpr } from '../lib/businessDateWindow'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit, buildAuditStatement, changedFields } from '../lib/audit'
import { sendReturnStatusTelegramEvents, sendReturnTelegramEvent, sendTelegramEvent, formatSaleTelegramLines } from '../lib/telegram'
import { getPermissionTier, getActionTier } from '../lib/permissions'
import { assertUpdatedAtMatch, getExpectedUpdatedAt, writeConflictResponse, WriteConflictError } from '../lib/conflictControl'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersion, bumpVersions } from '../lib/cache'
import { buildLikeAliasClause, tokenizeSearchTermGroups, normalizeSearchText } from '../lib/searchMatch'
import { planReceiveBatchStock, planRemoveStockFromBatch } from '../lib/productBatches'
import {
  normalizeStockAction, resolveRefundUnitPrice, matchRefundSaleLine, RefundSaleLineError, planReturnLot, ReturnLotRequiredError,
  type ReversedDamagedLot, planReplacementStock, listOpenDamagedLots,
  ConsumedDamagedStockError, DAMAGE_IN_MOVEMENT, DAMAGE_REVERSAL_MOVEMENT,
  REPLACEMENT_OUT_MOVEMENT, resolveDamagedReturnChoice, planDamagedReturnLine, planCountedReturnReceive, planProjectedCountedReturnReceive,
} from '../lib/returnsStock'
import { uniqueBusinessDateTimeNumber } from '../lib/receiptNumber'
import { computeSaleTotals } from '../lib/saleTotals'
import { applyReturnBulkActionOutcome, notifyReturnBulkAction, ReturnBulkError, type SupplierReturnManifest, type SupplierReturnSource } from '../lib/returnBulkAction'
import { bulkAssertion, saleRevisionGuard } from '../lib/saleBulkStatus'
import { assertSaleRecordBatchBounds, buildSaleRecordEventsInsert, SaleRecordEventError, sha256Hex } from '../lib/saleRecordEvents'
import { loadReturnRecords } from '../lib/returnRecords'
// A replacement line is an ordinary sale line, so the warehouse may not
// carry one -- the same rule, and the same message, POST /sales enforces.
import { WAREHOUSE_NOT_SELLABLE_ERROR } from '../lib/branchRoleGuards'
import { branchCanSell } from '../lib/branchRoles'
import {
  BRANCH_EFFECT_COLUMNS_SQL, BranchEffectResolver, BranchRetiredNoSuccessorError, branchEffectGuardPredicate, branchEffectGuards, branchEffectRefusal, branchHasNoActiveTarget, branchRedirectTarget,
  effectGuardStatement, foldedLotSurvivors, readBranchDirectory, resolveBranchEffect, type BranchEffect, type BranchEffectRow,
} from '../lib/branchEffect'
import type { Env } from '../index'
import { actorId, actorSnapshot } from '../lib/actorSnapshot'
import { buildSaleCreationSnapshot } from '../lib/saleCreationSnapshot'
// N21: sales.customer_address holds the DISPLAY address; the replacement sale
// below copies the SOURCE sale's snapshot, which for a row written before that
// fix is still the Contact Options JSON.
import { contactDisplayAddress } from '../lib/contactOptions'
import { isAnonymousCustomer } from '../lib/anonymousCustomer'
import {
  assertReturnCreateCapacity, assertReturnCreatePlanBounds, canonicalReturnCreateIntent,
  projectedSaleStatusForReturnCreate, projectedSaleStatusForReturnCreateV1, replacementSaleIdSql, returnCreateGuardStatement,
  returnCreateIdSql, RETURN_CREATE_REQUEST_BYTES, type ReturnCreateResponse,
} from '../lib/returnCreateAction'
import {
  buildCustomerReturnQuoteV1, CUSTOMER_RETURN_MAX_SALE_LINES,
  type CustomerReturnPrior, type CustomerReturnQuoteV1, type CustomerReturnSaleLine,
} from '../lib/customerReturnEntitlement'
import { canonicalMoney4, SaleMoneyContractError } from '../lib/saleMoneyPrecision'
import { ProductMergeLineageError, resolveProductMergeLineage } from '../lib/productMergeLineage'
import { TAGGED_DISPOSAL_MOVEMENT_TYPE } from '../lib/stockCondition'

const replacementSourceColumns = `rri.*,
  CASE WHEN ci.sale_item_id IS NULL THEN NULL ELSE json_object('version',1,'lot_id',ci.lot_id,'product_id',ci.product_id,'branch_id',ci.branch_id,'batch_id',ci.batch_id,'condition_tag',ci.condition_tag) END AS condition_snapshot,
  COALESCE(ci.batch_id,rri.batch_id) AS source_batch_id,pb.lot_code AS source_batch_label,pb.received_at AS source_received_at`
const replacementSourceJoins = `LEFT JOIN counted_sale_item_conditions ci ON ci.sale_item_id=rri.sale_item_id
  LEFT JOIN product_batches pb ON pb.id=COALESCE(ci.batch_id,rri.batch_id)`
const replacementSourceRow = (row: Record<string, unknown>) => ({ ...row, condition_snapshot: typeof row.condition_snapshot === 'string' ? JSON.parse(row.condition_snapshot) : null })

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)
app.use('*', acquisitionCostResponses)
// Gates every returns endpoint (reads and writes alike) behind its own
// 'returns' permission, matching the frontend's own
// PAGE_PERMISSIONS.returns = 'returns' gate (see AppContext.tsx/
// navigationConfig.ts) and the same router-level pattern already used by
// inventory.ts/contacts.ts. This was previously shared with the 'sales'
// permission (same key gated both pages) -- split into its own key so
// Sales (Full/None only) and Returns (which will get a Review Required
// tier once that system is built) can be granted independently. Anyone
// who already had 'sales' before this split loses implicit Returns access
// and needs 'returns' granted explicitly; this is intentional now that the
// two are meant to diverge, not a regression.
//
// Part 154 fix: same class of bug found and fixed on inventory.ts in Part
// 153 -- this used the strict `hasPermission()` (=== true only), which
// 403'd a Review Required-tier user out of every returns route, including
// plain reads. Contradicts the spec's own "Review Required can add/view/
// search directly" for Returns. Switched to `getPermissionTier(...) !==
// 'none'`, same pattern as inventory.ts/products.ts.
app.use('*', async (c, next) => {
  const user = c.get('user')
  if (getPermissionTier(user, 'returns') === 'none') return c.json({ error: 'You do not have permission to perform this action' }, 403)
  // Read revocation is independent of create/edit authority. HEAD executes
  // the GET handler in Hono and must have the same read gate.
  if ((c.req.method === 'GET' || c.req.method === 'HEAD') && getActionTier(user, 'returns', 'view') === 'none') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  return next()
})

// The tender a replacement sale defaults to when the client names none. A
// replacement is an ORDINARY sale -- the customer pays for it the ordinary
// way -- so its payment method is one of the shop's real methods, not a
// bespoke "Return Exchange" label standing in for money that never moved.
// (Rows written before this carry that old label and an amount_paid of only
// the price difference; lib/salesAnalytics.ts's collectedExpr keeps reading
// them correctly.)
const DEFAULT_REPLACEMENT_PAYMENT_METHOD = 'Cash'

class ReplacementCustomerStateConflictError extends Error {
  readonly code = 'customer_state_conflict'

  constructor() {
    super('The selected customer changed before the replacement sale was saved. Review the customer and try again.')
    this.name = 'ReplacementCustomerStateConflictError'
  }
}

const CUSTOMER_SCOPE = 'customer'
const SUPPLIER_SCOPE = 'supplier'
const RETURN_REASON_PRESETS_KEY = 'return_reason_presets'
const CUSTOMER_RETURN_MAX_PRIOR_ITEMS = 1_000
const CUSTOMER_RETURN_AUTHORITY_MAX_BYTES = 1_500_000

type CustomerReturnRequestedLine = { sale_item_id: number; quantity: number }
type CustomerReturnQuoteAuthority = {
  sale: Record<string, unknown>
  sale_items: Record<string, unknown>[]
  prior_returns: Record<string, unknown>[]
  prior_items: Record<string, unknown>[]
}

export async function customerReturnQuotePlanFromDb(
  db: ReturnType<typeof getDb>,
  saleId: number,
  requested: CustomerReturnRequestedLine[],
  excludeReturnId: number | null = null,
): Promise<{ quote: CustomerReturnQuoteV1; authority: CustomerReturnQuoteAuthority; authority_json: string;
  lineage: Awaited<ReturnType<typeof resolveProductMergeLineage>> }> {
  const sale = await db.prepare(`SELECT s.id,s.money_precision_version,s.calculated_total_usd,s.total_usd,
    s.subtotal_usd,s.discount_usd,s.membership_discount_usd,s.tax_usd,
    s.exchange_rate,s.is_delivery,s.delivery_fee_usd,s.delivery_fee_paid_by,s.sale_status,s.status_before_return,
    s.receipt_number,s.customer_id,s.customer_name,s.customer_phone,s.customer_address,s.branch_id,s.branch_name,
    COALESCE(v.revision,0) AS sale_revision
    FROM sales s LEFT JOIN sale_write_revisions v ON v.sale_id=s.id WHERE s.id=@saleId`)
    .get<Record<string, unknown>>({ saleId })
  if (!sale) throw new SaleMoneyContractError('customer_return_sale_not_found')
  if (String(sale.sale_status || 'completed') === 'cancelled') throw new SaleMoneyContractError('customer_return_sale_invalid')
  const saleLines = await db.prepare(`SELECT id,sale_id,product_id,quantity,total_usd,total_khr,
    base_price_usd,base_price_khr,applied_price_usd,applied_price_khr,
    product_discount_usd,product_discount_khr,product_discount_type,product_discount_label,manual_discount_usd,manual_discount_khr,
    manual_discount_type,manual_discount_value,price_mode,pricing_snapshot_json,
    product_name,branch_id,cost_price_usd,cost_price_khr,batch_id,batch_label,batch_expiry_date
    FROM sale_items WHERE sale_id=@saleId ORDER BY id LIMIT @limit`)
    .all<Record<string, unknown>>(
      { saleId, limit: CUSTOMER_RETURN_MAX_SALE_LINES + 1 },
    )
  if (saleLines.length > CUSTOMER_RETURN_MAX_SALE_LINES) throw new SaleMoneyContractError('customer_return_sale_invalid')
  let lineage: Awaited<ReturnType<typeof resolveProductMergeLineage>>
  try {
    lineage = await resolveProductMergeLineage(db, saleId, saleLines)
  } catch (error) {
    const stockGuard = productStockGuardError(error)
    if (stockGuard) throw stockGuard
    if (error instanceof ProductMergeLineageError) throw new SaleMoneyContractError(error.code)
    throw error
  }
  const previousRows = await db.prepare(`SELECT r.id AS return_id,r.money_precision_version,r.calculated_refund_usd,
    r.rounding_adjustment_usd,r.total_refund_usd,r.status AS return_status,r.updated_at AS return_updated_at,
    ri.id AS return_item_id,ri.sale_item_id,ri.quantity,ri.total_usd,ri.refund_snapshot_json
    FROM returns r LEFT JOIN return_items ri ON ri.return_id=r.id
    WHERE r.sale_id=@saleId AND COALESCE(r.return_scope,'customer')='customer'
      AND COALESCE(r.status,'completed')<>'cancelled'
      AND (@excludeReturnId IS NULL OR r.id<>@excludeReturnId)
    ORDER BY r.id,ri.id LIMIT @limit`)
    .all<Record<string, unknown>>({ saleId, excludeReturnId, limit: CUSTOMER_RETURN_MAX_PRIOR_ITEMS + 1 })
  if (previousRows.length > CUSTOMER_RETURN_MAX_PRIOR_ITEMS) throw new SaleMoneyContractError('customer_return_cohort_too_large')
  const previousById = new Map<number, CustomerReturnPrior>()
  const priorReturns = new Map<number, Record<string, unknown>>()
  const priorItems: Record<string, unknown>[] = []
  for (const row of previousRows) {
    const id = Number(row.return_id)
    let prior = previousById.get(id)
    if (!prior) {
      prior = {
        id,
        money_precision_version: Number(row.money_precision_version) as 1,
        calculated_refund_usd: Number(row.calculated_refund_usd),
        rounding_adjustment_usd: Number(row.rounding_adjustment_usd),
        total_refund_usd: Number(row.total_refund_usd),
        items: [],
      }
      previousById.set(id, prior)
      priorReturns.set(id, {
        id, money_precision_version: row.money_precision_version,
        calculated_refund_usd: row.calculated_refund_usd, rounding_adjustment_usd: row.rounding_adjustment_usd,
        total_refund_usd: row.total_refund_usd, status: row.return_status, updated_at: row.return_updated_at,
      })
    }
    if (row.return_item_id != null) {
      prior.items.push({
        sale_item_id: row.sale_item_id == null ? null : Number(row.sale_item_id),
        quantity: Number(row.quantity), total_usd: Number(row.total_usd),
        refund_snapshot_json: row.refund_snapshot_json == null ? null : String(row.refund_snapshot_json),
      })
      priorItems.push({ id: row.return_item_id, return_id: id, sale_item_id: row.sale_item_id,
        quantity: row.quantity, total_usd: row.total_usd, refund_snapshot_json: row.refund_snapshot_json })
    }
  }
  const exchangeRate = Number(sale.exchange_rate)
  const customerDeliveryFee = Number(sale.is_delivery) === 1 && String(sale.delivery_fee_paid_by || 'customer') === 'customer'
    ? canonicalMoney4(sale.delivery_fee_usd ?? 0, true) : 0
  const quote = buildCustomerReturnQuoteV1({
    sale: {
      sale_id: Number(sale.id), sale_revision: Number(sale.sale_revision),
      money_precision_version: Number(sale.money_precision_version),
      calculated_total_usd: sale.calculated_total_usd == null ? null : Number(sale.calculated_total_usd),
      total_usd: Number(sale.total_usd), subtotal_usd: Number(sale.subtotal_usd),
      discount_usd: Number(sale.discount_usd), membership_discount_usd: Number(sale.membership_discount_usd),
      tax_usd: Number(sale.tax_usd), exchange_rate: exchangeRate,
      customer_delivery_fee_usd: customerDeliveryFee,
      lines: await Promise.all(saleLines.map(async (line) => ({
        ...line as CustomerReturnSaleLine,
        pricing_snapshot_digest: await sha256Hex(String(line.pricing_snapshot_json ?? '')),
      }))),
    },
    requested,
    previous: [...previousById.values()],
    productIdentityBindings: lineage.bindings,
  })
  if (lineage.bindings.length) {
    const coherent = await db.prepare(`SELECT CASE WHEN (${lineage.condition}) THEN 1 ELSE 0 END AS valid`)
      .get<{ valid: number }>(lineage.params)
    if (Number(coherent?.valid) !== 1) throw new SaleMoneyContractError('product_merge_lineage_conflict')
  }
  const authority: CustomerReturnQuoteAuthority = {
    sale, sale_items: saleLines, prior_returns: [...priorReturns.values()], prior_items: priorItems,
  }
  const authorityJson = JSON.stringify(authority)
  if (new TextEncoder().encode(authorityJson).byteLength > CUSTOMER_RETURN_AUTHORITY_MAX_BYTES) {
    throw new SaleMoneyContractError('customer_return_authority_too_large')
  }
  return { quote, authority, authority_json: authorityJson, lineage }
}

export async function customerReturnQuoteFromDb(
  db: ReturnType<typeof getDb>, saleId: number, requested: CustomerReturnRequestedLine[], excludeReturnId: number | null = null,
): Promise<CustomerReturnQuoteV1> {
  return (await customerReturnQuotePlanFromDb(db, saleId, requested, excludeReturnId)).quote
}

export function publicCustomerReturnQuote(quote: CustomerReturnQuoteV1) {
  return {
    money_precision_version: quote.money_precision_version,
    sale_id: quote.sale_id,
    sale_revision: quote.sale_revision,
    calculated_refund_usd: quote.calculated_refund_usd,
    rounding_adjustment_usd: quote.rounding_adjustment_usd,
    total_refund_usd: quote.total_refund_usd,
    total_refund_khr: quote.total_refund_khr,
    items: quote.items.map(({ refund_snapshot_json: _snapshot, ...line }) => line),
  }
}

function customerReturnAuthorityPredicate(param = '@customerReturnAuthorityJson'): string {
  return `
    EXISTS(SELECT 1 FROM sales s LEFT JOIN sale_write_revisions v ON v.sale_id=s.id
      WHERE s.id=json_extract(${param},'$.sale.id')
        AND s.money_precision_version IS json_extract(${param},'$.sale.money_precision_version')
        AND s.calculated_total_usd IS json_extract(${param},'$.sale.calculated_total_usd')
        AND s.total_usd IS json_extract(${param},'$.sale.total_usd')
        AND s.subtotal_usd IS json_extract(${param},'$.sale.subtotal_usd')
        AND s.discount_usd IS json_extract(${param},'$.sale.discount_usd')
        AND s.membership_discount_usd IS json_extract(${param},'$.sale.membership_discount_usd')
        AND s.tax_usd IS json_extract(${param},'$.sale.tax_usd')
        AND s.exchange_rate IS json_extract(${param},'$.sale.exchange_rate')
        AND s.is_delivery IS json_extract(${param},'$.sale.is_delivery')
        AND s.delivery_fee_usd IS json_extract(${param},'$.sale.delivery_fee_usd')
        AND s.delivery_fee_paid_by IS json_extract(${param},'$.sale.delivery_fee_paid_by')
        AND s.sale_status IS json_extract(${param},'$.sale.sale_status')
        AND s.status_before_return IS json_extract(${param},'$.sale.status_before_return')
        AND COALESCE(v.revision,0)=json_extract(${param},'$.sale.sale_revision'))
    AND (SELECT COUNT(*) FROM sale_items WHERE sale_id=json_extract(${param},'$.sale.id'))
      =json_array_length(${param},'$.sale_items')
    AND NOT EXISTS(SELECT 1 FROM json_each(${param},'$.sale_items') j WHERE NOT EXISTS(
      SELECT 1 FROM sale_items si WHERE si.id=json_extract(j.value,'$.id')
        AND si.sale_id=json_extract(${param},'$.sale.id')
        AND si.product_id IS json_extract(j.value,'$.product_id') AND si.quantity IS json_extract(j.value,'$.quantity')
        AND si.total_usd IS json_extract(j.value,'$.total_usd') AND si.total_khr IS json_extract(j.value,'$.total_khr')
        AND si.base_price_usd IS json_extract(j.value,'$.base_price_usd') AND si.base_price_khr IS json_extract(j.value,'$.base_price_khr')
        AND si.applied_price_usd IS json_extract(j.value,'$.applied_price_usd') AND si.applied_price_khr IS json_extract(j.value,'$.applied_price_khr')
        AND si.product_discount_usd IS json_extract(j.value,'$.product_discount_usd') AND si.product_discount_khr IS json_extract(j.value,'$.product_discount_khr')
        AND si.product_discount_type IS json_extract(j.value,'$.product_discount_type')
        AND si.product_discount_label IS json_extract(j.value,'$.product_discount_label')
        AND si.manual_discount_usd IS json_extract(j.value,'$.manual_discount_usd') AND si.manual_discount_khr IS json_extract(j.value,'$.manual_discount_khr')
        AND si.manual_discount_type IS json_extract(j.value,'$.manual_discount_type') AND si.manual_discount_value IS json_extract(j.value,'$.manual_discount_value')
        AND si.price_mode IS json_extract(j.value,'$.price_mode') AND si.pricing_snapshot_json IS json_extract(j.value,'$.pricing_snapshot_json')))
    AND (SELECT COUNT(*) FROM returns r WHERE r.sale_id=json_extract(${param},'$.sale.id')
      AND COALESCE(r.return_scope,'customer')='customer' AND COALESCE(r.status,'completed')<>'cancelled')
      =json_array_length(${param},'$.prior_returns')
    AND NOT EXISTS(SELECT 1 FROM json_each(${param},'$.prior_returns') j WHERE NOT EXISTS(
      SELECT 1 FROM returns r WHERE r.id=json_extract(j.value,'$.id') AND r.sale_id=json_extract(${param},'$.sale.id')
        AND r.money_precision_version IS json_extract(j.value,'$.money_precision_version')
        AND r.calculated_refund_usd IS json_extract(j.value,'$.calculated_refund_usd')
        AND r.rounding_adjustment_usd IS json_extract(j.value,'$.rounding_adjustment_usd')
        AND r.total_refund_usd IS json_extract(j.value,'$.total_refund_usd')
        AND r.status IS json_extract(j.value,'$.status') AND r.updated_at IS json_extract(j.value,'$.updated_at')
        AND COALESCE(r.return_scope,'customer')='customer' AND COALESCE(r.status,'completed')<>'cancelled'))
    AND (SELECT COUNT(*) FROM return_items ri JOIN returns r ON r.id=ri.return_id
      WHERE r.sale_id=json_extract(${param},'$.sale.id') AND COALESCE(r.return_scope,'customer')='customer'
        AND COALESCE(r.status,'completed')<>'cancelled')=json_array_length(${param},'$.prior_items')
    AND NOT EXISTS(SELECT 1 FROM json_each(${param},'$.prior_items') j WHERE NOT EXISTS(
      SELECT 1 FROM return_items ri JOIN returns r ON r.id=ri.return_id
      WHERE ri.id=json_extract(j.value,'$.id') AND ri.return_id=json_extract(j.value,'$.return_id')
        AND r.sale_id=json_extract(${param},'$.sale.id') AND COALESCE(r.return_scope,'customer')='customer'
        AND COALESCE(r.status,'completed')<>'cancelled'
        AND ri.sale_item_id IS json_extract(j.value,'$.sale_item_id') AND ri.quantity IS json_extract(j.value,'$.quantity')
        AND ri.total_usd IS json_extract(j.value,'$.total_usd') AND ri.refund_snapshot_json IS json_extract(j.value,'$.refund_snapshot_json')))
  `
}

type ReturnReasonPresets = {
  customer: string[]
  supplier: string[]
}

function normalizeReferenceName(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase().replace(/\s+/g, ' ')
}

function normalizeReasonList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const output: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const label = String(typeof entry === 'object' && entry !== null && 'label' in entry
      ? (entry as { label?: unknown }).label
      : entry ?? '').trim().replace(/\s+/g, ' ').slice(0, 160)
    const key = normalizeReferenceName(label)
    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push(label)
  }
  return output
}

function normalizeReturnReasonPresets(value: unknown): ReturnReasonPresets {
  let parsed = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) } catch { parsed = null }
  }
  if (Array.isArray(parsed)) {
    // Compatibility with the brief early shape where one customer list was
    // stored directly. The first explicit save rewrites it to the shared,
    // two-scope object without duplicating entries.
    return { customer: normalizeReasonList(parsed), supplier: [] }
  }
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  return {
    customer: normalizeReasonList(record.customer),
    supplier: normalizeReasonList(record.supplier),
  }
}

async function loadReturnReasonPresets(env: Env): Promise<{ configured: boolean; presets: ReturnReasonPresets }> {
  const row = await getDb(env).prepare('SELECT value FROM settings WHERE key = @key').get<{ value: string }>({ key: RETURN_REASON_PRESETS_KEY })
  return { configured: !!row, presets: normalizeReturnReasonPresets(row?.value) }
}

// ---------------------------------------------------------------------------
// What's simplified vs. the original backend/src/routes/returns.ts (1152
// lines) -- read this before relying on edge cases:
//
// 1. Batch/lot-aware restock (closed -- was open, see history below). A
//    customer return whose item has a resolvable sale_item_id now restocks
//    into the *exact* batch that sale_item was originally sold from
//    (fetchSaleItemBatchInfo below joins sale_items.batch_id), via
//    lib/productBatches.ts's receiveBatchStock -- same helper
//    routes/inventory.ts's own /adjust uses for a manual add. The resolved
//    batch_id is stored on the return_items row itself (migration 0026) so
//    a later PATCH /:id edit can reverse the *same* batch instead of
//    guessing. Multi-lot sale allocations are restored and recorded per lot.
//    When provenance is unavailable, a distinct return-event lot records
//    the return business date. Create and edit keep all stock, allocations,
//    movements and the durable mutation receipt in one atomic batch.
// 2. No returnsListCache (the original's 5s in-memory Map cache for GET
//    /returns). A Worker isolate isn't guaranteed to live long enough for
//    that cache to pay for itself, and D1 reads are already fast; dropped
//    rather than porting a cache whose main job was easing load on a
//    long-running Node/better-sqlite3 process.
// 3. No recordActionHistory (undo/redo) calls -- that infrastructure has
//    still not been ported to any route in this Worker (grep cloudflare/src
//    confirms), so none is added here either, to avoid a route silently
//    depending on infrastructure that doesn't exist. broadcast() (WebSocket
//    push), however, *has* since been added to most other domains
//    (branches.ts, inventory.ts, products.ts, contacts.ts, promotions.ts,
//    settings.ts, users.ts, devices.ts, files.ts, importJobs.ts,
//    lookups.ts, portal.ts) -- this route was missed when that landed, so
//    a Dashboard/Products/Inventory/Sales page open on a different device
//    from the one processing a return wouldn't see it live. Added below on
//    the same channels those other domains already use for stock/product
//    changes ('inventory', 'products') plus a 'returns'/'sales' channel so
//    the Returns and Sales/Dashboard pages themselves refresh too.
// 4. Idempotency (client_request_id dedupe) is kept, since the returns
//    table already has the column and the original backend's
//    idempotency.ts is a two-line normalizer -- reproduced inline below
//    rather than pulled in as its own lib for two call sites.
// ---------------------------------------------------------------------------

function normalizeClientRequestId(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  if (!normalized) return null
  return normalized.length > 120 ? normalized.slice(0, 120) : normalized
}

type PresentIntent = { present: false } | { present: true; value: string | number | boolean | null }

function returnEditIntentField(source: Record<string, unknown>, key: string): PresentIntent {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return { present: false }
  const raw = source[key]
  if (raw == null) return { present: true, value: null }
  if (typeof raw === 'string' || typeof raw === 'boolean') return { present: true, value: raw }
  const numeric = Number(raw)
  return { present: true, value: Number.isFinite(numeric) ? numeric : String(raw) }
}

function canonicalReturnEditIntent(returnId: number, expectedUpdatedAt: string, body: Record<string, unknown>): Record<string, unknown> {
  const itemKeys = [
    'sale_item_id', 'product_id', 'product_name', 'quantity',
    'applied_price_usd', 'applied_price_khr', 'cost_price_usd', 'cost_price_khr',
    'unit_cost_usd', 'unit_cost_khr', 'return_to_stock', 'stock_action', 'branch_id', 'batch_id',
    // P4-3: a resubmit with the same client_request_id but a genuinely
    // different tag/disposition choice must NOT replay the earlier cached
    // response -- see resolveDamagedReturnChoice.
    'condition_tag', 'damaged_disposition',
  ] as const
  const itemsPresent = Object.prototype.hasOwnProperty.call(body, 'items')
  const rawItems = body.items
  if (itemsPresent && !Array.isArray(rawItems)) throw new Error('items must be an array')
  const items = Array.isArray(rawItems) ? rawItems.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Return item ${index + 1} must be an object`)
    const item = raw as Record<string, unknown>
    return { ...Object.fromEntries(itemKeys.map((key) => [key, returnEditIntentField(item, key)])), ...(Object.prototype.hasOwnProperty.call(item,'stock_condition')?{stock_condition:returnEditIntentField(item,'stock_condition')}: {}) }
  }) : []
  return {
    return_id: returnId,
    expected_updated_at: expectedUpdatedAt,
    items: { present: itemsPresent, value: items },
    reason: returnEditIntentField(body, 'reason'),
    return_type: returnEditIntentField(body, 'return_type'),
    notes: returnEditIntentField(body, 'notes'),
    total_refund_usd: returnEditIntentField(body, 'total_refund_usd'),
    total_refund_khr: returnEditIntentField(body, 'total_refund_khr'),
    branch_id: returnEditIntentField(body, 'branch_id'),
  }
}

function projectedSaleStatusForReturnEdit(
  saleItems: Array<{ id: number; product_id: number | null; quantity: number }>,
  returnLines: Array<{ sale_item_id?: number | null; product_id?: number | null; quantity: number }>,
  statusBeforeReturn: string | null,
): string {
  const saleItemIds = new Set(saleItems.map((item) => Number(item.id)))
  const returnedByItem = new Map<number, number>()
  const fallbackByProduct = new Map<number, number>()
  let hasAny = false
  for (const line of returnLines) {
    const quantity = Number(line.quantity) || 0
    if (!(quantity > 0)) continue
    hasAny = true
    const saleItemId = Number(line.sale_item_id) || 0
    if (saleItemId && saleItemIds.has(saleItemId)) {
      returnedByItem.set(saleItemId, (returnedByItem.get(saleItemId) || 0) + quantity)
      continue
    }
    const productId = Number(line.product_id) || 0
    if (productId) fallbackByProduct.set(productId, (fallbackByProduct.get(productId) || 0) + quantity)
  }
  for (const item of saleItems) {
    const productId = Number(item.product_id) || 0
    let fallback = fallbackByProduct.get(productId) || 0
    if (!(fallback > 0)) continue
    const outstanding = Math.max(0, (Number(item.quantity) || 0) - (returnedByItem.get(item.id) || 0))
    const allocated = Math.min(outstanding, fallback)
    if (allocated > 0) returnedByItem.set(item.id, (returnedByItem.get(item.id) || 0) + allocated)
    fallback -= allocated
    fallbackByProduct.set(productId, fallback)
  }
  const fullyReturned = hasAny && saleItems.every((item) => (returnedByItem.get(item.id) || 0) >= (Number(item.quantity) || 0))
  return fullyReturned ? 'returned' : hasAny ? 'partial_return' : (statusBeforeReturn || 'completed')
}

function normalizeScope(value: unknown, fallback: string = CUSTOMER_SCOPE): string {
  const scope = String(value || '').trim().toLowerCase()
  if (scope === 'all') return 'all'
  if (scope === SUPPLIER_SCOPE) return SUPPLIER_SCOPE
  if (scope === CUSTOMER_SCOPE) return CUSTOMER_SCOPE
  return fallback
}

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

// Owner rule (24 Sep 2026): older sales keep their own exchange rate; only a
// NEW record takes today's Settings rate. 4100 is the sales/returns column
// default in migrations/0001_init.sql (`exchange_rate REAL DEFAULT 4100`) and
// the fallback every other Worker rate reader already uses.
const SCHEMA_DEFAULT_EXCHANGE_RATE = 4100

function positiveRate(value: unknown): number | null {
  if (value == null || value === '') return null
  const rate = Number(value)
  return Number.isFinite(rate) && rate > 0 ? rate : null
}

async function liveExchangeRate(db: ReturnType<typeof getDb>): Promise<number> {
  const row = await db.prepare(`SELECT value FROM settings WHERE key='exchange_rate'`).get<{ value: string }>()
  return positiveRate(row?.value) ?? SCHEMA_DEFAULT_EXCHANGE_RATE
}

type ReturnRow = Record<string, unknown> & {
  id: number
  sale_id: number | null
  return_number: string | null
  return_scope: string | null
  branch_id: number | null
  branch_name: string | null
  reason: string | null
  status?: string | null
  updated_at: string | null
  replacement_sale_id?: number | null
  replacement_receipt_number?: string | null
}

type ReturnItemInput = {
  sale_item_id?: number
  product_id?: number
  product_name?: string
  quantity: number
  applied_price_usd?: number
  applied_price_khr?: number
  cost_price_usd?: number | null
  cost_price_khr?: number | null
  unit_cost_usd?: number
  unit_cost_khr?: number
  return_to_stock?: boolean
  // 11.13: 'none' | 'restock' | 'damaged'; absent falls back to the
  // return_to_stock boolean's historical meaning (see normalizeStockAction).
  stock_action?: string
  counted_original_condition?: boolean
  stock_condition?: string
  // P4-3: only meaningful when stock_action is 'damaged'. Both absent means
  // the untouched legacy behavior (tag 'damaged', kept as a held row) --
  // see resolveDamagedReturnChoice.
  condition_tag?: string
  damaged_disposition?: string
  branch_id?: number
  // The lot the operator picked for this line's restock. Only sent when the
  // original sale line cannot say which lot the units came from (see
  // planReturnLot): a lot-tracked product with no answer either way is
  // refused rather than restocked onto unspecified stock.
  batch_id?: number
}

// Looks up which batch/lot (if any) each of the given sale_item_ids was
// originally sold from -- customer returns reference a sale_item, never a
// batch directly (see the file-level note), so restoring the *specific*
// lot's quantity on a return requires this join back to sale_items every
// time, the same as a fresh create and a PATCH /:id re-apply both need it
// independently. Products import's cost_price backfill (lib/importEngine.
// ts's classifySales) uses the same "batch-fetch once, Map lookup per row"
// shape for the same reason: avoids one query per line item.
// It reads the line's PRICE in the same pass: the refund a return pays is
// whatever the original sale charged for those units, and the only place
// that number lives is this row. Reading it here (rather than trusting the
// posted applied_price_*) is what makes the refund unspoofable by a stale or
// edited client payload, and immune to the product's price having moved
// since the sale.
type SaleLineInfo = {
  batch_id: number | null
  batch_label: string | null
  batch_expiry_date: string | null
  applied_price_usd: number | null
  applied_price_khr: number | null
}

async function fetchSaleItemBatchInfo(
  db: ReturnType<typeof getDb>,
  saleItemIds: number[],
): Promise<Map<number, SaleLineInfo>> {
  const map = new Map<number, SaleLineInfo>()
  const ids = [...new Set(saleItemIds)].filter((id) => Number.isFinite(id) && id > 0)
  if (!ids.length) return map
  // Chunked for D1's 100-bound-parameter ceiling (see lib/sqlBinding.ts).
  const rows = await selectInChunks(ids, 0, (chunk) => db
    .prepare(`SELECT id, batch_id, batch_label, batch_expiry_date, applied_price_usd, applied_price_khr FROM sale_items WHERE id IN (${chunk.map(() => '?').join(',')})`)
    .all<{ id: number } & SaleLineInfo>(chunk))
  for (const row of rows) {
    map.set(row.id, {
      batch_id: row.batch_id ?? null,
      batch_label: row.batch_label ?? null,
      batch_expiry_date: row.batch_expiry_date ?? null,
      applied_price_usd: row.applied_price_usd ?? null,
      applied_price_khr: row.applied_price_khr ?? null,
    })
  }
  return map
}

// Z0: the lot(s) each sale line actually drew from, in draw order, with the
// units still OUT (quantity - released_quantity). A multi-lot line's
// sale_items.batch_id is NULL (no single lot), so a return of it must split
// the restock across these -- reverse order (last-drawn first), matching the
// cancel path in saleTransitions.ts. Empty for old sales / legacy-stock lines.
async function fetchSaleItemAllocations(
  db: ReturnType<typeof getDb>,
  saleItemIds: number[],
): Promise<Map<number, Array<{ batch_id: number; outstanding: number }>>> {
  const map = new Map<number, Array<{ batch_id: number; outstanding: number }>>()
  const ids = [...new Set(saleItemIds)].filter((id) => Number.isFinite(id) && id > 0)
  if (!ids.length) return map
  const rows = await selectInChunks(ids, 0, (chunk) => db
    .prepare(`SELECT sale_item_id, batch_id, quantity, released_quantity FROM sale_item_batch_allocations WHERE sale_item_id IN (${chunk.map(() => '?').join(',')}) ORDER BY id ASC`)
    .all<{ sale_item_id: number; batch_id: number; quantity: number; released_quantity: number }>(chunk))
  for (const row of rows) {
    const outstanding = Math.max(0, subtractCountedQuantity(Number(row.quantity) || 0, [Number(row.released_quantity) || 0]))
    if (outstanding <= 0) continue
    const list = map.get(Number(row.sale_item_id)) || []
    list.push({ batch_id: Number(row.batch_id), outstanding })
    map.set(Number(row.sale_item_id), list)
  }
  return map
}

// The lot(s) a sellable restock actually put stock into, per return_item.
// return_items.batch_id holds only ONE lot, but a return of a multi-lot sale
// line restocks several -- recording the real split here (into the
// return_item_batch_allocations table that has existed unused since the
// original schema, mirroring sale_item_batch_allocations on the sale side) is
// what lets a later PATCH /:id reverse each EXACT lot instead of pulling the
// whole quantity out of one and drifting per-lot stock.
type ReturnBatchSplit = { batchId: number; branchId: number | null; quantity: number; saleItemId: number | null }

async function fetchReturnItemBatchAllocations(
  db: ReturnType<typeof getDb>,
  returnItemIds: number[],
): Promise<Map<number, Array<{ batch_id: number; branch_id: number | null; quantity: number }>>> {
  const map = new Map<number, Array<{ batch_id: number; branch_id: number | null; quantity: number }>>()
  const ids = [...new Set(returnItemIds)].filter((id) => Number.isFinite(id) && id > 0)
  if (!ids.length) return map
  const rows = await selectInChunks(ids, 0, (chunk) => db
    .prepare(`SELECT return_item_id, batch_id, branch_id, quantity FROM return_item_batch_allocations WHERE return_item_id IN (${chunk.map(() => '?').join(',')}) ORDER BY id ASC`)
    .all<{ return_item_id: number; batch_id: number; branch_id: number | null; quantity: number }>(chunk))
  for (const row of rows) {
    const list = map.get(Number(row.return_item_id)) || []
    list.push({ batch_id: Number(row.batch_id), branch_id: row.branch_id ?? null, quantity: Number(row.quantity) || 0 })
    map.set(Number(row.return_item_id), list)
  }
  return map
}

// The SALE decides a return's money version -- never the request body. A
// pre-v1 client (an offline queue, or a cached PWA shell that never reloaded)
// posts a legacy return body with no money_precision_version. The legacy
// branch prices such a body at gross line price x quantity: no sale-level
// discount, no cumulative payout cap. Against a v1 sale that is wrong twice
// over -- one whole-line return can be paid more than the sale's entire
// payable, and the v0 row it writes then poisons the sale, because every later
// v1 quote reads that legacy header and fails money_precision_invalid_legacy_shape
// forever. Both create and edit therefore read the SALE's recorded version and
// refuse with the same code POST /api/sales uses for a legacy body, so one
// vocabulary covers "this client is too old to price this correctly".
const MONEY_PRECISION_REVIEW_NEEDED = {
  error: 'Keep this return and review it with the current app before recording it.',
  code: 'money_precision_review_needed',
} as const

/** The sale's recorded money precision version, or null when there is no such
 * sale (a manual return with no sale_id has no version to inherit). */
async function saleMoneyPrecisionVersion(db: ReturnType<typeof getDb>, saleId: unknown): Promise<number | null> {
  const id = Number(saleId)
  if (!Number.isSafeInteger(id) || id <= 0) return null
  const row = await db.prepare('SELECT money_precision_version FROM sales WHERE id=? LIMIT 1')
    .get<{ money_precision_version: number | null }>([id])
  return row ? Number(row.money_precision_version) || 0 : null
}

// Validate requested return quantities against what's actually returnable
// (sold minus already-returned), mirroring assertReturnableItems in the
// original. `excludeReturnId` lets an update re-validate without double
// counting the return being edited against itself.
async function assertReturnableItems(
  db: ReturnType<typeof getDb>,
  saleId: number | null,
  items: ReturnItemInput[],
  excludeReturnId: number | null = null,
): Promise<void> {
  for (const item of items) {
    const qty = Number(item.quantity)
    if (!qty || qty <= 0) throw new Error('Return quantity must be greater than zero')
  }
  if (!saleId) return

  const sale = await db.prepare('SELECT id, sale_status FROM sales WHERE id = ?').get<{ id: number; sale_status: string | null }>([saleId])
  if (!sale) throw new Error('Original sale not found')
  // A cancelled sale's stock was already ADDED BACK by the cancellation
  // itself (routes/sales.ts PATCH /:id/status) -- recording a return on
  // top would restock the same units twice. Un-cancel first if the sale
  // is live again and genuinely has a return.
  if ((sale.sale_status || 'completed') === 'cancelled') {
    throw new Error('This sale is cancelled -- its stock was already added back when it was cancelled, so a return cannot be recorded against it.')
  }

  for (const item of items) {
    const qty = Number(item.quantity) || 0

    if (item.sale_item_id) {
      const saleItem = await db.prepare('SELECT id, quantity, product_name FROM sale_items WHERE id = ? AND sale_id = ?').get<{ id: number; quantity: number; product_name: string | null }>([item.sale_item_id, saleId])
      if (!saleItem) throw new Error('Sale item not found for this return')

      const returnedRow = excludeReturnId
        ? await db.prepare(`
            SELECT COALESCE(SUM(ri.quantity), 0) AS qty
            FROM return_items ri
            JOIN returns r ON r.id = ri.return_id
            WHERE r.sale_id = ? AND ri.sale_item_id = ?
              AND COALESCE(r.status, 'completed') != 'cancelled'
              AND COALESCE(r.return_scope, 'customer') = 'customer'
              AND r.id != ?
          `).get<{ qty: number }>([saleId, item.sale_item_id, excludeReturnId])
        : await db.prepare(`
            SELECT COALESCE(SUM(ri.quantity), 0) AS qty
            FROM return_items ri
            JOIN returns r ON r.id = ri.return_id
            WHERE r.sale_id = ? AND ri.sale_item_id = ?
              AND COALESCE(r.status, 'completed') != 'cancelled'
              AND COALESCE(r.return_scope, 'customer') = 'customer'
          `).get<{ qty: number }>([saleId, item.sale_item_id])
      const returned = returnedRow?.qty || 0
      const remaining = Math.max(0, (saleItem.quantity || 0) - returned)
      if (qty > remaining) throw new Error(`Cannot return ${qty} of ${saleItem.product_name || 'this item'} — only ${remaining} remaining`)
      continue
    }

    if (item.product_id) {
      const soldRow = await db.prepare('SELECT COALESCE(SUM(quantity), 0) AS qty FROM sale_items WHERE sale_id = ? AND product_id = ?').get<{ qty: number }>([saleId, item.product_id])
      const returnedRow = excludeReturnId
        ? await db.prepare(`
            SELECT COALESCE(SUM(ri.quantity), 0) AS qty
            FROM return_items ri
            JOIN returns r ON r.id = ri.return_id
            WHERE r.sale_id = ? AND ri.product_id = ?
              AND COALESCE(r.status, 'completed') != 'cancelled'
              AND COALESCE(r.return_scope, 'customer') = 'customer'
              AND r.id != ?
          `).get<{ qty: number }>([saleId, item.product_id, excludeReturnId])
        : await db.prepare(`
            SELECT COALESCE(SUM(ri.quantity), 0) AS qty
            FROM return_items ri
            JOIN returns r ON r.id = ri.return_id
            WHERE r.sale_id = ? AND ri.product_id = ?
              AND COALESCE(r.status, 'completed') != 'cancelled'
              AND COALESCE(r.return_scope, 'customer') = 'customer'
          `).get<{ qty: number }>([saleId, item.product_id])
      const remaining = Math.max(0, (soldRow?.qty || 0) - (returnedRow?.qty || 0))
      if (qty > remaining) throw new Error(`Cannot return ${qty} of this product — only ${remaining} remaining`)
    }
  }
}

// The Returns list shows one row per return, never its lines, so a damaged
// item was invisible there unless someone opened the return. This counts the
// return's damaged lines in the list read itself -- the list carries a flag,
// not a second round trip and not the whole item set. It matches
// lib/returnsStock.ts's normalizeStockAction: an explicit 'damaged' only.
const DAMAGED_ITEM_COUNT_SQL = `(
      SELECT COUNT(*) FROM return_items dri
      WHERE dri.return_id = r.id AND lower(COALESCE(dri.stock_action, '')) = 'damaged'
    ) AS damaged_item_count`

/** Shared list/statistics cohort. Exact bounds are continuous entry timestamps,
 * not a recurring clock window; full days retain the business-date predicate. */
export function returnRangePredicate(query: Record<string, string>, column: 'r.created_at' | 'created_at'): { sql: string; params: Record<string, unknown> } {
  const startDate = String(query.startDate || '').trim()
  const endDate = String(query.endDate || '').trim()
  const validDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  if ((startDate && !validDate(startDate)) || (endDate && !validDate(endDate))) throw new RangeError('Return dates must use valid YYYY-MM-DD dates')
  if (startDate && endDate && startDate > endDate) throw new RangeError('Return end date must not precede the start date')
  if (query.startTime || query.endTime) throw new RangeError('Use createdFrom and createdTo together for an exact return time range')
  const from = String(query.createdFrom || '').trim()
  const to = String(query.createdTo || '').trim()
  if (!!from !== !!to) throw new RangeError('createdFrom and createdTo must be provided together')
  if (from && to) {
    const bound = (value: string): string => {
      const match = /^(\d{4}-\d{2}-\d{2})[T ](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?([zZ]|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.exec(value)
      if (!match || !validDate(match[1])) throw new RangeError('createdFrom and createdTo must be valid timestamps')
      const parsed = new Date(match[2] ? value.replace(' ', 'T') : `${value.replace(' ', 'T')}Z`)
      if (!Number.isFinite(parsed.getTime())) throw new RangeError('createdFrom and createdTo must be valid timestamps')
      return parsed.toISOString().slice(0, 19).replace('T', ' ')
    }
    const createdFrom = bound(from), createdTo = bound(to)
    if (createdFrom >= createdTo) throw new RangeError('createdTo must be after createdFrom')
    return { sql: `datetime(${column}) >= @createdFrom AND datetime(${column}) < @createdTo`, params: { createdFrom, createdTo } }
  }
  const clauses: string[] = []
  const params: Record<string, unknown> = {}
  if (startDate) { clauses.push(localDateAtOrAfter(column)); params.startDate = startDate }
  if (endDate) { clauses.push(localDateAtOrBefore(column)); params.endDate = endDate }
  return { sql: clauses.length ? clauses.join(' AND ') : '1=1', params }
}

// GET /api/returns
app.get('/', async (c) => {
  const db = getDb(c.env)
  const query = c.req.query()
  const scope = normalizeScope(query.scope, CUSTOMER_SCOPE)
  const search = String(query.search || query.q || '').trim().toLowerCase()
  const typeValues = String(query.type || query.returnType || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v && v !== 'all')
  const includeItems = Boolean(query.saleId) || ['1', 'true', 'yes'].includes(String(query.includeItems || '').trim().toLowerCase())
  const limit = Math.min(1000, Math.max(1, Number.parseInt(String(query.limit || '500'), 10) || 500))

  let range: ReturnType<typeof returnRangePredicate>
  try { range = returnRangePredicate(query, 'r.created_at') } catch (error) { return c.json({ error: (error as Error).message }, 400) }
  const where: string[] = [range.sql]
  const params: Record<string, unknown> = { limit, ...range.params }
  if (query.saleId) { where.push('r.sale_id = @saleId'); params.saleId = query.saleId }
  if (scope !== 'all') { where.push(`COALESCE(r.return_scope, 'customer') = @scope`); params.scope = scope }
  if (typeValues.length === 1) {
    where.push(scope === SUPPLIER_SCOPE
      ? `lower(COALESCE(r.supplier_settlement, 'refund')) = @type`
      : `lower(COALESCE(r.return_type, 'manual')) = @type`)
    params.type = typeValues[0]
  } else if (typeValues.length > 1) {
    const typeExpr = scope === SUPPLIER_SCOPE
      ? `lower(COALESCE(r.supplier_settlement, 'refund'))`
      : `lower(COALESCE(r.return_type, 'manual'))`
    const keys = typeValues.map((value, index) => {
      const key = `type${index}`
      params[key] = value
      return `@${key}`
    })
    where.push(`${typeExpr} IN (${keys.join(', ')})`)
  }
  // Same comma-groups-of-words syntax as products/sales search
  // (tokenizeSearchTermGroups: comma splits GROUPS, space is ordinary
  // word-spacing within one) instead of the old flat "every space-split
  // word must match" version, plus two real coverage gaps closed: the
  // return's own numeric id (CAST to text -- SQLite's LIKE operator does
  // not reliably coerce an INTEGER-affinity column the way `=` does, so
  // this must be explicit rather than assumed to already work), and the
  // product the return is actually for (product_name was already on
  // return_items, but sku/barcode/brand live on products and were never
  // reachable from here at all -- joined in via return_items.product_id,
  // the same shape sales.ts's buildSalesSearchWhere uses for sale_items).
  // No searchMode UI toggle exists on the Returns page (see Products.tsx's
  // SearchModeToggle) so this defaults to 'AND', matching Products' own
  // default, but still reads an optional searchMode param for the same
  // forward-compatibility reason sales.ts's builder does.
  const searchGroups = tokenizeSearchTermGroups(search)
  if (searchGroups.length) {
    const searchMode = String(query.searchMode || query.search_mode || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'
    // Same bounded SQL shape as Sales: one shallow concatenated haystack
    // per row context avoids repeating the full diacritic REPLACE chain
    // for every column/word, which exceeds D1's statement-size limit at
    // production scale. Catalog-side normalized fields retain folded
    // product-name and compact-brand matching without the query-time tree.
    // r.search_normalized (migration 0082) is the write-time diacritic-folded
    // form of the return's own text fields, PREPENDED to the unchanged raw
    // concatenation exactly as buildSalesSearchWhere does -- additive, so a
    // folded query matches folded storage while a row without a blob still
    // searches through the raw columns as before. See the migration comment.
    const flatHaystack = `(
      COALESCE(r.search_normalized, '') || ' ' ||
      COALESCE(r.return_number, '') || ' ' || CAST(r.id AS TEXT) || ' ' ||
      COALESCE(r.receipt_number, '') || ' ' || COALESCE(r.cashier_name, '') || ' ' ||
      COALESCE(r.customer_name, '') || ' ' || COALESCE(r.supplier_name, '') || ' ' ||
      COALESCE(r.reason, '') || ' ' || COALESCE(r.notes, '') || ' ' ||
      COALESCE(r.return_type, '') || ' ' || COALESCE(r.supplier_settlement, '')
    )`
    const itemHaystack = `(
      COALESCE(rii.product_name, '') || ' ' || COALESCE(rip.sku, '') || ' ' ||
      COALESCE(rip.barcode, '') || ' ' || COALESCE(rip.brand, '') || ' ' ||
      COALESCE(rip.name_normalized, '') || ' ' || COALESCE(rip.brand_compact, '')
    )`
    let groupIndex = 0
    const groupClauses = searchGroups.map((words) => {
      let wordIndex = 0
      const wordClauses = words.map((word) => {
        const keyBase = `rsrch${groupIndex}_${wordIndex}`
        wordIndex += 1
        const flatClause = buildLikeAliasClause(word, [flatHaystack], params, `${keyBase}_f`, true)
        const itemClause = buildLikeAliasClause(word, [itemHaystack], params, `${keyBase}_i`, true)
        return `(${flatClause} OR EXISTS (
          SELECT 1 FROM return_items rii
          LEFT JOIN products rip ON rip.id = rii.product_id
          WHERE rii.return_id = r.id AND ${itemClause}
        ))`
      })
      groupIndex += 1
      return wordClauses.length > 1 ? `(${wordClauses.join(' AND ')})` : wordClauses[0]
    })
    const joiner = searchMode === 'OR' ? ' OR ' : ' AND '
    where.push(groupClauses.length > 1 ? groupClauses.map((c) => `(${c})`).join(joiner) : groupClauses[0])
  }

  const returns = await db.prepare(`
    SELECT r.*, EXISTS (SELECT 1 FROM customers ic WHERE ic.id=r.customer_id AND ic.is_anonymous=1) AS customer_is_anonymous, replacement_sale.receipt_number AS replacement_receipt_number,
      ${DAMAGED_ITEM_COUNT_SQL}
    FROM returns r
    LEFT JOIN sales replacement_sale ON replacement_sale.id = r.replacement_sale_id
    WHERE ${where.join(' AND ')}
    ORDER BY r.created_at DESC LIMIT @limit
  `).all<ReturnRow>(params)

  if (!includeItems || returns.length === 0) return c.json(returns)

  const ids = returns.map((r) => r.id)
  const itemRows = await selectInChunks(ids, 0, (chunk) => db.prepare(`SELECT * FROM return_items WHERE return_id IN (${chunk.map(() => '?').join(',')}) ORDER BY return_id ASC, id ASC`).all<{ return_id: number; [key: string]: unknown }>(chunk))
  const itemsByReturn = new Map<number, unknown[]>()
  for (const row of itemRows) {
    if (!itemsByReturn.has(row.return_id)) itemsByReturn.set(row.return_id, [])
    itemsByReturn.get(row.return_id)!.push(row)
  }
  const replacementRows = await selectInChunks(ids, 0, (chunk) => db.prepare(`SELECT ${replacementSourceColumns} FROM return_replacement_items rri ${replacementSourceJoins} WHERE rri.return_id IN (${chunk.map(() => '?').join(',')}) ORDER BY rri.return_id ASC, rri.id ASC`).all<{ return_id: number; [key: string]: unknown }>(chunk))
  const replacementsByReturn = new Map<number, Record<string, unknown>[]>()
  for (const row of replacementRows) {
    if (!replacementsByReturn.has(row.return_id)) replacementsByReturn.set(row.return_id, [])
    replacementsByReturn.get(row.return_id)!.push(row)
  }
  return c.json(returns.map((r) => ({ ...r, items: itemsByReturn.get(r.id) || [], replacement_items: (replacementsByReturn.get(r.id) || []).map(replacementSourceRow) })))
})

// GET /api/returns/damaged-lots?product_id=&branch_id= -- open damaged
// lots (quantity_remaining > 0) for one product. Registered before /:id
// so the param route doesn't swallow it. Carries no cost by design.
app.get('/damaged-lots', async (c) => {
  const db = getDb(c.env)
  const productId = Number(c.req.query('product_id'))
  if (!Number.isFinite(productId) || productId <= 0) return c.json({ error: 'product_id is required' }, 400)
  const branchIdRaw = Number(c.req.query('branch_id'))
  const lots = await listOpenDamagedLots(db, { productId, branchId: Number.isFinite(branchIdRaw) && branchIdRaw > 0 ? branchIdRaw : null })
  return c.json(lots)
})

// --- Receipt typeahead ------------------------------------------------------
// The new-return flow used to pull 500 sales to the browser and Array.find()
// the receipt out of them, so a receipt older than that window was simply
// "not found" and nothing ever listed the candidates. This is the server-side
// lookup behind the typeahead: matching receipts only, newest first, capped.
//
// Three number shapes have to match here:
//   - the current bare `YYYYMMDD-HHMMSS`, including a partial-digit type-ahead
//     ("2026090" or "0903-1430"),
//   - the legacy `NNNNNN@YYYY-MM-DD` numbers still in production history,
//   - and whatever the receipt lane's migration 0107 moves into
//     sales.legacy_receipt_number.
// The last of those may or may not exist when this Worker runs, so the column
// is probed once instead of being assumed: a build of this route that runs
// against a pre-0107 database must still answer, not 500 on "no such column".
const LEGACY_RECEIPT_COLUMN = 'legacy_receipt_number'
const LEGACY_COLUMN_RECHECK_MS = 60_000
let legacyReceiptColumnState: { present: boolean; checkedAt: number } | null = null

// Strip the separators the two formats use so a digits-only query
// ("202609031430") still matches "20260903-143000" and "123456@2026-09-03".
function receiptDigitsExpr(column: string): string {
  return `REPLACE(REPLACE(REPLACE(COALESCE(${column}, ''), '-', ''), '@', ''), ':', '')`
}

export async function salesHasLegacyReceiptColumn(db: ReturnType<typeof getDb>): Promise<boolean> {
  const now = Date.now()
  // A `true` never becomes false again (columns are not dropped here), so it
  // is cached for the isolate's life; a `false` is re-probed, because 0107 can
  // land while this isolate is still warm.
  if (legacyReceiptColumnState?.present) return true
  if (legacyReceiptColumnState && now - legacyReceiptColumnState.checkedAt < LEGACY_COLUMN_RECHECK_MS) return false
  try {
    const rows = await db.prepare('PRAGMA table_info("sales")').all<{ name?: string }>()
    const present = (Array.isArray(rows) ? rows : []).some((row) => String(row?.name || '') === LEGACY_RECEIPT_COLUMN)
    legacyReceiptColumnState = { present, checkedAt: now }
    return present
  } catch {
    // A probe failure must not take the lookup down with it -- answer without
    // the legacy column rather than 500.
    legacyReceiptColumnState = { present: false, checkedAt: now }
    return false
  }
}

// Exported for the pure test: builds exactly the SQL + bindings the route
// runs, so both column shapes can be exercised against a real database.
export function buildReceiptLookupQuery(input: { query: string; limit: number; hasLegacyColumn: boolean }): { sql: string; params: Record<string, unknown> } | null {
  const raw = String(input.query ?? '').trim()
  if (raw.length < 2) return null
  const digits = raw.replace(/\D+/g, '')
  const params: Record<string, unknown> = { like: `%${raw.toLowerCase()}%`, limit: input.limit }
  const clauses = [`lower(COALESCE(s.receipt_number, '')) LIKE @like`]
  if (digits.length >= 4) {
    params.digitsLike = `%${digits}%`
    clauses.push(`${receiptDigitsExpr('s.receipt_number')} LIKE @digitsLike`)
  }
  if (/^\d{1,15}$/.test(raw)) {
    params.saleId = Number(raw)
    clauses.push('s.id = @saleId')
  }
  if (input.hasLegacyColumn) {
    clauses.push(`lower(COALESCE(s.${LEGACY_RECEIPT_COLUMN}, '')) LIKE @like`)
    if (digits.length >= 4) clauses.push(`${receiptDigitsExpr(`s.${LEGACY_RECEIPT_COLUMN}`)} LIKE @digitsLike`)
  }
  const legacySelect = input.hasLegacyColumn ? `s.${LEGACY_RECEIPT_COLUMN}` : `NULL AS ${LEGACY_RECEIPT_COLUMN}`
  const sql = `
    SELECT s.id, s.receipt_number, ${legacySelect}, s.created_at, s.customer_name,
           s.branch_id, s.branch_name, s.total_usd, s.total_khr, s.sale_status
    FROM sales s
    WHERE COALESCE(s.sale_status, 'completed') <> 'cancelled'
      AND (${clauses.join(' OR ')})
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT @limit
  `
  return { sql, params }
}

export const RECEIPT_LOOKUP_MAX_ROWS = 20

// GET /api/returns/receipt-lookup?query=&limit= -- registered before /:id so
// the param route does not swallow it. Gated by the returns-permission
// middleware at the top of this file like every other route here: this is a
// staff lookup, never a customer-facing one.
app.get('/receipt-lookup', async (c) => {
  const db = getDb(c.env)
  const raw = String(c.req.query('query') || c.req.query('q') || '')
  const requested = Number.parseInt(String(c.req.query('limit') || RECEIPT_LOOKUP_MAX_ROWS), 10)
  const limit = Math.min(RECEIPT_LOOKUP_MAX_ROWS, Math.max(1, Number.isFinite(requested) ? requested : RECEIPT_LOOKUP_MAX_ROWS))
  const hasLegacyColumn = await salesHasLegacyReceiptColumn(db)
  const built = buildReceiptLookupQuery({ query: raw, limit, hasLegacyColumn })
  if (!built) return c.json([])
  const rows = await db.prepare(built.sql).all<Record<string, unknown>>(built.params)
  return c.json(Array.isArray(rows) ? rows : [])
})

// GET /api/returns/report?startDate&endDate&branchId -- customer-return
// (refund) totals over a range for the Reports hub: range totals, a per-day
// series, and reason/type breakdowns. Scoped to customer returns
// (return_scope='customer'), where total_refund_usd is the money refunded to
// customers; supplier returns carry compensation/loss instead and are not
// refunds. Cancelled returns are excluded, matching the sales report's
// hide-cancelled default. Registered before /:id so 'report' is not eaten by
// the id param route. Auto-gated by the returns-permission middleware above.
app.get('/report', async (c) => {
  const db = getDb(c.env)
  const query = c.req.query()
  const startDate = String(query.startDate || '').trim()
  const endDate = String(query.endDate || '').trim()
  let range: ReturnType<typeof returnRangePredicate>
  try { range = returnRangePredicate(query, 'created_at') } catch (error) { return c.json({ error: (error as Error).message }, 400) }
  // scope=supplier reports return-to-supplier cases (compensation / business
  // loss) with the SAME response shape -- customer rows simply carry zero in
  // the supplier money columns and vice versa, so one reader serves both the
  // Reports hub (customer) and the Returns page's scope-aware stats strip.
  const scope = String(query.scope || 'customer') === 'supplier' ? 'supplier' : 'customer'
  const clauses = [
    range.sql,
    `COALESCE(return_scope, 'customer') = @scope`,
    `COALESCE(status, 'completed') <> 'cancelled'`,
  ]
  const params: Record<string, unknown> = { scope, ...range.params }
  if (query.branchId) { clauses.push('branch_id = @branchId'); params.branchId = query.branchId }
  const where = clauses.join(' AND ')
  // RETURN-DATE ACTIVITY, not a revenue term. Every figure below is scoped
  // by the date the RETURN was created, which answers "what did the returns
  // desk do in this window". The kernel reverses a refund in the period of
  // the SALE it belongs to, so these two totals differ whenever a return
  // crosses a period boundary, and they are not interchangeable. Nothing may
  // subtract this from a revenue, profit or collected figure -- doing so
  // takes refunds off twice, on mismatched bases, and can drive a period
  // below zero. The sale-basis reversal is SalesTotals.refund_usd.
  //
  // Sum BOTH currencies (Part 553): refunds/compensation/loss can be recorded
  // in KHR, and a USD-only sum showed "$0.00" for real KHR returns (same class
  // of bug the fees report had). No conversion -- the UI shows "$X · Y៛".
  const moneySums = `ROUND(COALESCE(SUM(total_refund_usd), 0), 2) AS refund_usd,
    ROUND(COALESCE(SUM(total_refund_khr), 0), 0) AS refund_khr,
    ROUND(COALESCE(SUM(supplier_compensation_usd), 0), 2) AS compensation_usd,
    ROUND(COALESCE(SUM(supplier_compensation_khr), 0), 0) AS compensation_khr,
    ROUND(COALESCE(SUM(supplier_loss_usd), 0), 2) AS loss_usd,
    ROUND(COALESCE(SUM(supplier_loss_khr), 0), 0) AS loss_khr`
  const [totals, days, byReason, byType] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count, ${moneySums} FROM returns WHERE ${where}`).get<Record<string, number>>(params),
    db.prepare(`SELECT ${localDateExpr('created_at')} AS date, COUNT(*) AS count, ${moneySums} FROM returns WHERE ${where} GROUP BY ${localDateExpr('created_at')} ORDER BY ${localDateExpr('created_at')} DESC`).all<Record<string, unknown>>(params),
    db.prepare(`SELECT COALESCE(NULLIF(TRIM(reason), ''), '—') AS reason, COUNT(*) AS count, ${moneySums} FROM returns WHERE ${where} GROUP BY COALESCE(NULLIF(TRIM(reason), ''), '—') ORDER BY refund_usd DESC, count DESC`).all<Record<string, unknown>>(params),
    db.prepare(`SELECT COALESCE(NULLIF(TRIM(return_type), ''), 'restock') AS return_type, COUNT(*) AS count, ${moneySums} FROM returns WHERE ${where} GROUP BY COALESCE(NULLIF(TRIM(return_type), ''), 'restock') ORDER BY count DESC`).all<Record<string, unknown>>(params),
  ])
  const money = (row: Record<string, unknown> | null | undefined) => ({
    refund_usd: Number(row?.refund_usd || 0),
    refund_khr: Number(row?.refund_khr || 0),
    compensation_usd: Number(row?.compensation_usd || 0),
    compensation_khr: Number(row?.compensation_khr || 0),
    loss_usd: Number(row?.loss_usd || 0),
    loss_khr: Number(row?.loss_khr || 0),
  })
  return c.json({
    startDate,
    endDate,
    scope,
    totals: { count: Number(totals?.count || 0), ...money(totals) },
    days: (days || []).map((d) => ({ date: String(d.date || ''), count: Number(d.count || 0), ...money(d) })),
    by_reason: (byReason || []).map((r) => ({ reason: String(r.reason || ''), count: Number(r.count || 0), ...money(r) })),
    by_type: (byType || []).map((r) => ({ return_type: String(r.return_type || ''), count: Number(r.count || 0), ...money(r) })),
  })
})

// One persisted source for both customer- and supplier-return presets. The
// frontend supplies translated fallbacks only while this row is absent; the
// first edit writes the complete two-scope object, so legacy hard-coded lists
// migrate without creating a second store or duplicate values.
app.get('/reason-presets', async (c) => {
  return c.json(await loadReturnReasonPresets(c.env))
})

app.post('/reason-presets', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'returns', 'edit') !== 'full') {
    return c.json({ error: 'Full Access to Returns is required to edit saved reasons.' }, 403)
  }
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
  const presets = normalizeReturnReasonPresets(body.presets ?? body)
  await runOrdinaryBusinessWrite(getDb(c.env), `
    INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `, { key: RETURN_REASON_PRESETS_KEY, value: JSON.stringify(presets) })
  await audit(c.env, user?.id ?? null, actorSnapshot(user), 'update', 'return_reason_presets', null, {
    customerCount: presets.customer.length,
    supplierCount: presets.supplier.length,
  })
  c.executionCtx.waitUntil(bumpVersion(c.env, 'settings'))
  c.executionCtx.waitUntil(broadcast(c.env, 'settings', { action: 'return_reason_presets_update' }))
  c.executionCtx.waitUntil(broadcast(c.env, 'returns', { action: 'reason_presets_update' }))
  return c.json({ success: true, configured: true, presets })
})

app.get('/reasons/impact', async (c) => {
  const returnScope: keyof ReturnReasonPresets = normalizeScope(c.req.query('return_scope')) === SUPPLIER_SCOPE ? 'supplier' : 'customer'
  const from = String(c.req.query('from') || '').trim()
  const to = String(c.req.query('to') || '').trim()
  if (!from || !to) return c.json({ error: 'Source and target reasons are required' }, 400)
  const fromKey = normalizeReferenceName(from)
  const toKey = normalizeReferenceName(to)
  const db = getDb(c.env)
  const scopeExpr = "COALESCE(NULLIF(lower(trim(return_scope)), ''), 'customer')"
  const linkedRecords = Number((await db.prepare(`
    SELECT COUNT(*) AS n FROM returns
    WHERE ${scopeExpr} = @returnScope AND lower(trim(COALESCE(reason, ''))) = @from
  `).get<{ n: number }>({ returnScope, from: fromKey }))?.n || 0)
  const targetRecords = Number((await db.prepare(`
    SELECT COUNT(*) AS n FROM returns
    WHERE ${scopeExpr} = @returnScope AND lower(trim(COALESCE(reason, ''))) = @to
  `).get<{ n: number }>({ returnScope, to: toKey }))?.n || 0)
  const { presets } = await loadReturnReasonPresets(c.env)
  return c.json({
    from,
    to,
    return_scope: returnScope,
    configured: presets[returnScope].some((reason) => normalizeReferenceName(reason) === fromKey),
    target_exists: presets[returnScope].some((reason) => normalizeReferenceName(reason) === toKey) || targetRecords > 0,
    linked_records: linkedRecords,
    live_snapshots: { returns: linkedRecords },
    historical_snapshots_preserved: ['audit_logs', 'action history payloads', 'inventory movements'],
  })
})

app.post('/reasons/replace', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'returns', 'edit') !== 'full') {
    return c.json({ error: 'Full Access to Returns is required to replace saved reasons.' }, 403)
  }
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
  const returnScope: keyof ReturnReasonPresets = normalizeScope(body.return_scope) === SUPPLIER_SCOPE ? 'supplier' : 'customer'
  const from = String(body.from || '').trim().replace(/\s+/g, ' ').slice(0, 160)
  const to = String(body.to || '').trim().replace(/\s+/g, ' ').slice(0, 160)
  const replaceScope = body.scope === 'linked' ? 'linked' : 'presets_only'
  if (!from || !to) return c.json({ error: 'Source and target reasons are required' }, 400)
  const fromKey = normalizeReferenceName(from)
  const suppliedPresets = body.presets === undefined
    ? (await loadReturnReasonPresets(c.env)).presets
    : normalizeReturnReasonPresets(body.presets)
  const nextList = normalizeReasonList(suppliedPresets[returnScope].map((reason) => (
    normalizeReferenceName(reason) === fromKey ? to : reason
  )))
  if (!nextList.some((reason) => normalizeReferenceName(reason) === normalizeReferenceName(to))) nextList.push(to)
  const nextPresets: ReturnReasonPresets = { ...suppliedPresets, [returnScope]: nextList }
  const db = getDb(c.env)
  const statements: Array<{ sql: string; params: Record<string, unknown> }> = [{
    sql: `INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, CURRENT_TIMESTAMP)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    params: { key: RETURN_REASON_PRESETS_KEY, value: JSON.stringify(nextPresets) },
  }]
  if (replaceScope === 'linked') {
    statements.push({
      sql: `UPDATE returns SET reason = @to, updated_at = CURRENT_TIMESTAMP
            WHERE COALESCE(NULLIF(lower(trim(return_scope)), ''), 'customer') = @returnScope
              AND lower(trim(COALESCE(reason, ''))) = @from`,
      params: { to, returnScope, from: fromKey },
    })
  }
  const results = await db.batch([...statements, ordinaryBusinessMaintenanceGuard])
  const linkedChanged = replaceScope === 'linked' ? Number(results[1]?.meta?.changes || 0) : 0
  await audit(c.env, user?.id ?? null, actorSnapshot(user), 'replace', 'return_reason', null, {
    from, to, returnScope, scope: replaceScope, linkedChanged,
  })
  await Promise.all([bumpVersion(c.env, 'settings'), bumpVersion(c.env, 'returns')])
  c.executionCtx.waitUntil(broadcast(c.env, 'settings', { action: 'return_reason_replace', returnScope, from, to }))
  c.executionCtx.waitUntil(broadcast(c.env, 'returns', { action: 'reason_replace', returnScope, from, to }))
  return c.json({ success: true, configured: true, presets: nextPresets, scope: replaceScope, linkedChanged })
})

// Conditional grouped action: every selected row is revision checked, while
// only rows whose chosen field still equals `source` move to `target`.
// applyReturnBulkActionOutcome owns the atomic stock/snapshot/idempotency contract;
// this route only translates typed business failures to HTTP responses.
app.post('/bulk', async (c) => {
  const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}))
  const user = c.get('user')
  try {
    // `wrote` is true only for the call whose OWN batch committed the change.
    // A replayed request id -- a sequential retry, a retry that overtook a
    // slow original, or that original itself -- gets the stored receipt with
    // wrote=false, so one write is announced once (R-telegram E1). A read made
    // here before the write could not tell; see applyReturnBulkActionOutcome.
    const { receipt: result, wrote } = await applyReturnBulkActionOutcome(c.env, user, body, branchRedirectTarget(c))
    c.executionCtx.waitUntil(notifyReturnBulkAction(c.env))
    // Telegram: a return cancelled or restored (owner, 27 Sep 2026). Only the
    // status field, only the rows that actually moved.
    const changedIds = Array.isArray(result.changedIds) ? result.changedIds.map(Number) : []
    if (wrote && body.field === 'status' && changedIds.length) {
      c.executionCtx.waitUntil(sendReturnStatusTelegramEvents(c.env, changedIds, actorSnapshot(user))
        .catch((error) => console.error('[telegram] return status notification failed', error)))
    }
    return c.json(result)
  } catch (error) {
    const stockGuard = productStockGuardError(error)
    if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
    // A coded refusal's params (return_restore_over_capacity's product and
    // counts) go with it, so the till's restated sentence keeps them.
    if (error instanceof ReturnBulkError) return c.json({ error: error.message, code: error.code || (error.statusCode === 409 ? 'write_conflict' : 'invalid_bulk_action'), ...(error.params ? { params: error.params } : {}), ...(error.extra || {}) }, error.statusCode)
    throw error
  }
})

app.get('/supplier-options', async (c) => {
  const user=c.get('user'), branchId=Number(c.req.query('branch_id'))
  const ids=String(c.req.query('product_ids')||'').split(',').map(Number)
  if (!Number.isSafeInteger(branchId) || branchId<=0 || !ids.length || ids.length>25 || new Set(ids).size!==ids.length
    || ids.some(id=>!Number.isSafeInteger(id)||id<=0)) return c.json({error:'Select at most25 products and an active branch.',code:'supplier_source_invalid'},400)
  c.header('Cache-Control','private, no-store')
  const statement=getDb(c.env).prepare(`WITH captured AS (
    SELECT supplier_product.id,${countedStockFactsSql('supplier_product.id','@branchId')} facts FROM products supplier_product WHERE supplier_product.id IN(SELECT value FROM json_each(@ids))
  ), checked AS (SELECT id,facts,
    NOT EXISTS(SELECT 1 FROM products p WHERE p.id=captured.id AND (p.stock_quantity IS NOT json_extract(facts,'$.product[2]')
      OR p.cost_price_usd IS NOT json_extract(facts,'$.product[3]') OR p.cost_price_khr IS NOT json_extract(facts,'$.product[4]')))
    AND NOT EXISTS(SELECT 1 FROM json_each(facts,'$.branches') j JOIN branch_stock bs ON bs.product_id=captured.id AND bs.branch_id=json_extract(j.value,'$[0]') WHERE bs.quantity IS NOT json_extract(j.value,'$[1]'))
    AND NOT EXISTS(SELECT 1 FROM json_each(facts,'$.receipts') j JOIN product_batches pb ON pb.id=json_extract(j.value,'$[0]')
      LEFT JOIN branch_batch_stock bs ON bs.batch_id=pb.id AND bs.branch_id=@branchId
      WHERE bs.quantity IS NOT json_extract(j.value,'$[3]') OR pb.unit_cost_usd IS NOT json_extract(j.value,'$[4]') OR pb.received_quantity IS NOT json_extract(j.value,'$[10]'))
    AND NOT EXISTS(SELECT 1 FROM json_each(facts,'$.tags') j JOIN damaged_stock_lots d ON d.id=json_extract(j.value,'$[0]')
      WHERE d.quantity IS NOT json_extract(j.value,'$[2]') OR d.quantity_remaining IS NOT json_extract(j.value,'$[3]') OR d.unit_cost_usd IS NOT json_extract(j.value,'$[8]')) accurate
    FROM captured)
    SELECT CASE WHEN COUNT(*)=@count AND SUM(length(CAST(facts AS BLOB)))<=@bytes AND MIN(accurate)=1
      THEN json_group_array(json_object('id',id,'facts',facts)) END captured FROM checked`)
  if(!statement.getOnce) throw new Error('Supplier sources require a single-attempt coherent read')
  const row=await statement.getOnce<{captured:string|null}>({branchId,ids:JSON.stringify(ids),count:ids.length,bytes:RETURN_CREATE_REQUEST_BYTES})
  if(!row?.captured) return c.json({error:'Supplier stock sources require a fresh supported snapshot.',code:'supplier_source_unavailable'},409)
  try {
    const rows=JSON.parse(row.captured) as Array<{id:number;facts:string}>
    const exact=new CountedStockBatchPlan(rows.map(row=>({facts:row.facts,branchId})))
    const items=rows.map(row=>{
      const facts=JSON.parse(row.facts) as {product:[number,number,number,number|null,number|null,string];branch:[number,number,string,string]|null;
        branches:Array<[number,number]>;receipts:Array<[number,number,number|null,number|null,number|null,string|null,string|null,string,number|null,string|null,number|null,number]>;
        tags:Array<[number,number|null,number,number,string,string|null,number|null,number|null,number|null,string|null]>}
      if(facts.product[1]!==1 || facts.branch?.[0]!==branchId || facts.branch[1]!==1 || facts.receipts.some(receipt=>(receipt[3]||0)>0 && receipt[2]!==1)) throw new CountedStockConflictError()
      const context=exact.get(row.id,branchId)
      const ordinary=facts.branches.some(branch=>branch[0]===branchId)?context.ordinaryQuantity(null):0
      const receipts=context.projectedReceiptSources().filter(source=>source.available>0).sort((a,b)=>a.fifoRank-b.fifoRank).map(source=>{
        const receipt=facts.receipts.find(receipt=>receipt[0]===source.batchId)!
        return {batch_id:source.batchId,received_at:source.receivedAt,lot_code:source.lotCode,batch_number:receipt[8],available:source.available,source_cost_usd:receipt[4]}
      })
      const tags=facts.tags.filter(tag=>tag[3]>0).map(tag=>{
        const source=context.projectedTaggedSource(tag[0]),condition=parseStockConditionTag(tag[4])
        if(!source || !condition.ok || !condition.tag) throw new CountedStockConflictError()
        const receipt=facts.receipts.find(receipt=>receipt[0]===source.batchId)
        return {damaged_lot_id:source.lotId,stock_condition:condition.tag,batch_id:source.batchId,available:source.quantityRemaining,
          received_at:receipt?.[5]??null,lot_code:receipt?.[9]??null,batch_number:receipt?.[8]??null,source_cost_usd:tag[8],source:tag[5]}
      })
      return {product_id:row.id,branch_id:branchId,product_name:facts.product[5],ordinary_available:subtractCountedQuantity(context.branchQuantity,facts.tags.map(tag=>tag[3])),
        ordinary_unlotted:ordinary,ordinary_receipts:receipts,tagged_sources:tags,return_cost_usd:facts.product[3],return_cost_khr:facts.product[4]}
    })
    return c.json({supplier_condition_version:1,branch_id:branchId,financial_visibility:canViewAcquisitionCosts(user),financial_editable:canEditAcquisitionCosts(user),items})
  } catch(error) {
    if (error instanceof CountedStockConflictError || error instanceof SyntaxError || (error instanceof Error && error.name==='MoneyPrecisionError')) {
      return c.json({error:'Supplier stock sources changed or cannot be represented exactly.',code:'supplier_source_unavailable'},409)
    }
    throw error
  }
})

app.get('/capabilities', (c) => {
  if (getActionTier(c.get('user'), 'returns', 'add') === 'none') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  c.header('Cache-Control', 'no-store')
  return c.json({ customer_return_create_version: 1, customer_return_edit_version: 0 })
})

// GET /api/returns/:id
app.get('/:id', async (c) => {
  const db = getDb(c.env)
  const id = c.req.param('id')
  const row = await db.prepare(`
    SELECT r.*, EXISTS (SELECT 1 FROM customers ic WHERE ic.id=r.customer_id AND ic.is_anonymous=1) AS customer_is_anonymous, replacement_sale.receipt_number AS replacement_receipt_number,
      ${DAMAGED_ITEM_COUNT_SQL}
    FROM returns r
    LEFT JOIN sales replacement_sale ON replacement_sale.id = r.replacement_sale_id
    WHERE r.id = ?
  `).get<ReturnRow>([id])
  if (!row) return c.json({ error: 'Return not found' }, 404)
  const items = await db.prepare('SELECT * FROM return_items WHERE return_id = ?').all([id])
  const replacementItems = await db.prepare(`SELECT ${replacementSourceColumns} FROM return_replacement_items rri ${replacementSourceJoins} WHERE rri.return_id = ?`).all([id])
  return c.json({ ...row, items, replacement_items: replacementItems.map(replacementSourceRow) })
})

// ---------------------------------------------------------------------------
// GET /api/returns/:id/records -- every change anybody ever made to this
// return, as ONE list. The returns half of the owner's Sep 22 2026 ask
// ("having records in sales, returns ... like sales do before and after, by
// who etc..."), modelled on GET /api/sales/:id/records.
//
// The reads AND the meaning live in lib/returnRecords.ts: this file cannot be
// loaded into a pure test (transpiling 3,000 lines overflows the compiler's
// stack), so SQL written here would be SQL nothing can exercise.
//
// Read-gated by the router's own 'returns' view tier above (the same gate
// GET /:id passes): whoever may open the return may see how it got that way.
// ---------------------------------------------------------------------------
app.get('/:id/records', async (c) => {
  const returnId = Number(c.req.param('id'))
  if (!Number.isFinite(returnId) || returnId <= 0) return c.json({ error: 'Return not found' }, 404)
  const payload = await loadReturnRecords(getDb(c.env), returnId)
  if (!payload) return c.json({ error: 'Return not found' }, 404)
  return c.json(payload)
})

// POST /api/returns -- create a customer return, restocking branch_stock
// for any item with return_to_stock !== false, and rolling the parent
// sale's sale_status to 'partial_return' or 'returned' once everything
// sold on it has been accounted for.
app.post('/quote', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'returns', 'add') === 'none' || getActionTier(user, 'returns', 'view') === 'none') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const rawBody = await c.req.json<unknown>().catch(() => null)
  const body = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
    ? rawBody as Record<string, unknown> : null
  if (!body || Object.keys(body).some((key) => !['sale_id', 'items'].includes(key))) {
    return c.json({ error: 'Choose a sale and between 1 and 50 return lines.', code: 'customer_return_quote_invalid' }, 400)
  }
  const saleId = body.sale_id
  if (typeof saleId !== 'number' || !Number.isSafeInteger(saleId) || saleId <= 0 || !Array.isArray(body.items)
    || body.items.length < 1 || body.items.length > 50) {
    return c.json({ error: 'Choose a sale and between 1 and 50 return lines.', code: 'customer_return_quote_invalid' }, 400)
  }
  const requested: CustomerReturnRequestedLine[] = []
  const seen = new Set<number>()
  for (const raw of body.items) {
    const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
    if (Object.keys(item).some((key) => !['sale_item_id', 'quantity'].includes(key))) {
      return c.json({ error: 'The return quote contains unsupported fields.', code: 'customer_return_quote_invalid' }, 400)
    }
    const saleItemId = item.sale_item_id
    const quantity = item.quantity
    if (typeof saleItemId !== 'number' || !Number.isSafeInteger(saleItemId) || saleItemId <= 0 || seen.has(saleItemId)
      || typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
      return c.json({ error: 'Each return quote line needs one unique sale item and a positive quantity.', code: 'customer_return_quote_invalid' }, 400)
    }
    seen.add(saleItemId)
    requested.push({ sale_item_id: saleItemId, quantity })
  }
  c.header('Cache-Control', 'no-store')
  try {
    return c.json({ ...publicCustomerReturnQuote(await customerReturnQuoteFromDb(getDb(c.env), saleId, requested)),
      customer_return_create_version: 1, customer_return_edit_version: 0 })
  } catch (error) {
    const stockGuard = productStockGuardError(error)
    if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
    if (error instanceof SaleMoneyContractError) {
      const conflict = /legacy|cohort|sale_invalid|not_found|cap|lineage/.test(error.message)
      return c.json({ error: error.message, code: error.message, action: conflict ? 'review_required' : 'fix_request' }, conflict ? 409 : 400)
    }
    throw error
  }
})

app.post('/', async (c) => {
  try { return await createCustomerReturn(c) } catch (error) {
    if (error instanceof ReturnCreateBudgetError) return c.json({ error: error.message, code: error.code }, 400)
    if (isCountedStockConflict(error)) return c.json({ error: 'Stock or its recorded condition changed. Refresh before retrying.', code: 'write_conflict', action: 'reload_required' }, 409)
    throw error
  }
})

type CountedReturnContext = { productId: number; branchId: number; receiptIds: number[]; receiptKeys: string[] }
function addCountedReturnContext(contexts: Map<string, CountedReturnContext>, productId: number, branchId: number, receiptIds: number[] = [], receiptKeys: string[] = []): void {
  const key = productId + ':' + branchId
  const context = contexts.get(key) ?? { productId, branchId, receiptIds: [], receiptKeys: [] }
  context.receiptIds = [...new Set([...context.receiptIds, ...receiptIds])]
  context.receiptKeys = [...new Set([...context.receiptKeys, ...receiptKeys])]
  contexts.set(key, context)
}
async function readProjectedReturnStock(db: ReturnType<typeof getDb>, contexts: Map<string, CountedReturnContext>): Promise<CountedStockBatchPlan> {
  if (!contexts.size) return new CountedStockBatchPlan([], { deferPhysicalWrites: true })
  const pairs = JSON.stringify([...contexts.values()])
  if (new TextEncoder().encode(pairs).byteLength > RETURN_CREATE_REQUEST_BYTES) throw new ReturnCreateBudgetError()
  const additionalIds = "(SELECT json_group_array(pb.id) FROM product_batches pb WHERE pb.variant_product_id=json_extract(j.value,'$.productId') AND (pb.id IN(SELECT value FROM json_each(j.value,'$.receiptIds')) OR pb.batch_key IN(SELECT value FROM json_each(j.value,'$.receiptKeys'))))"
  const rows = await db.prepare(`SELECT json_extract(j.value,'$.branchId') AS branchId,
    ${countedStockFactsSql("json_extract(j.value,'$.productId')", "json_extract(j.value,'$.branchId')", additionalIds)} AS facts
    FROM json_each(@pairs) j`).all<{ branchId: number; facts: string }>({ pairs })
  return new CountedStockBatchPlan(rows, { deferPhysicalWrites: true })
}

// A product merged away holds no stock: its units sit on the keeper's derivative receipt or tag, as the product-merge
// records prove (chains of merges included). Returned units that belonged to it are reversed and received THERE,
// and only the NEW return line names that keeper; the original sale item keeps the refund, cost and entitlement.
const RETURN_MERGE_REFUSAL = {
  error: 'This return names a merged product whose current stock location could not be proven. Nothing was changed. Refresh before retrying.',
  code: 'return_merge_origin_unproven', action: 'reload_required',
}
function returnMergeRefusal(error: unknown): { body: Record<string, string>; status: 400 | 409 } | null {
  if (error instanceof ReturnKeeperClaimError) return { body: { error: error.code }, status: 400 }
  if (error instanceof ProductMergePhysicalOriginError) return { body: RETURN_MERGE_REFUSAL, status: 409 }
  return null
}
type ReturnLotPlan = { splits: Array<{ batchId: number; quantity: number }>; plainQuantity: number }
type ReturnMergeEffects = {
  /** Where a requested tuple's stock is now; a tuple that was not requested is its own effect. */
  effect(tuple: MergeOriginIdentity): MergeOriginIdentity
  guard: { sql: string; params: Record<string, unknown> } | null
}
const mergeTupleKey = (tuple: MergeOriginIdentity) => JSON.stringify([tuple.productId, tuple.branchId, tuple.batchId, tuple.damagedLotId, tuple.conditionTag])
const ordinaryTuple = (productId: number, branchId: number, batchId: number | null): MergeOriginIdentity =>
  ({ productId, branchId, batchId, damagedLotId: null, conditionTag: 'ordinary' })

/** One read for every merged tuple and keeper claim of the request; its guard joins the atomic write batch, so a
 *  merge, undo or redo landing before commit refuses the write instead of moving stock to a stale keeper. */
async function readReturnMergeEffects(db: ReturnType<typeof getDb>, tuples: readonly MergeOriginIdentity[],
  claims: readonly ReturnKeeperClaim[], branchOf: (index: number) => number): Promise<ReturnMergeEffects> {
  const sources = new Map<string, ProductMergePhysicalSource>()
  for (const tuple of tuples) sources.set(mergeTupleKey(tuple), { ...tuple, memberKey: mergeTupleKey(tuple) })
  const claimSources = returnKeeperClaimSources(claims, branchOf)
  if (!sources.size && !claimSources.length) return { effect: tuple => tuple, guard: null }
  const resolve = async (wanted: ProductMergePhysicalSource[]) => {
    const plan = planProductMergePhysicalOrigins(wanted)
    return plan.decode(await db.prepare(plan.read.sql).all<Record<string, unknown>>(plan.read.params))
  }
  let resolution: Awaited<ReturnType<typeof resolve>>
  try { resolution = await resolve([...sources.values(), ...claimSources]) }
  catch (error) {
    // A claimed product the records cannot place at all (deleted, unknown, another organisation's id) is the
    // client's identity error, not a merge-record failure: tell them apart by resolving without the claims.
    if (!(error instanceof ProductMergePhysicalOriginError) || !claimSources.length) throw error
    if (sources.size) await resolve([...sources.values()])
    throw returnKeeperClaimError(claims[0])
  }
  assertReturnKeeperClaimsProven(claims, branchOf, resolution)
  const effects = new Map(resolution.sources.map(source => [source.original.memberKey, source.effect]))
  return {
    effect: tuple => effects.get(mergeTupleKey(tuple)) ?? tuple,
    guard: { sql: resolution.guard.sql, params: resolution.guard.params as Record<string, unknown> },
  }
}

/** The tuples a returned line receives into: each lot split (owned by splitOwner) and its unattributed units. */
function returnLineTuples(productId: number, branchId: number, plan: ReturnLotPlan, splitOwner: number): MergeOriginIdentity[] {
  return [...plan.splits.map(split => ordinaryTuple(splitOwner, branchId, split.batchId)),
    ...(plan.plainQuantity > 0 ? [ordinaryTuple(productId, branchId, null)] : [])]
}

/** Re-target one returned line to where its tuples' stock is now; every tuple of a line lands on one product. */
function landReturnLine(effects: ReturnMergeEffects, productId: number, branchId: number, plan: ReturnLotPlan, splitOwner: number): { productId: number; plan: ReturnLotPlan } {
  const landed = returnLineTuples(productId, branchId, plan, splitOwner).map(tuple => effects.effect(tuple))
  if (!landed.length || landed.some(effect => effect.productId !== landed[0].productId || effect.branchId !== branchId
    || effect.damagedLotId !== null)) throw new ProductMergePhysicalOriginError()
  const splits = new Map<number, number>()
  plan.splits.forEach((split, index) => {
    const batchId = landed[index].batchId
    if (batchId === null) throw new ProductMergePhysicalOriginError()
    splits.set(batchId, sumCountedQuantities([splits.get(batchId) ?? 0, split.quantity]))
  })
  return { productId: landed[0].productId, plan: { splits: [...splits].map(([batchId, quantity]) => ({ batchId, quantity })), plainQuantity: plan.plainQuantity } }
}

async function createCustomerReturn(c: Context<{ Bindings: Env; Variables: { user: SessionUser } }>) {
  const baseDb = getDb(c.env)
  const queryLimit = getPlanLimits(c.env).d1QueriesPerInvocation
  let routeStatements = 0
  let admissionEnabled = false
  const requestMetrics = (c as unknown as { get(key: string): unknown }).get('requestMetrics') as (RequestMetrics & { attemptedStatements?: number }) | undefined
  const initialStatements = requestMetrics?.attemptedStatements ?? requestMetrics?.statements ?? 0
  const statementsUsed = () => {
    if (!requestMetrics) return routeStatements + 10
    const attempted = requestMetrics.attemptedStatements
    if (attempted == null && requestMetrics.failed) return Infinity
    return Math.max(initialStatements + routeStatements, attempted ?? requestMetrics.statements) + 3
  }
  const countRead = () => {
    if (admissionEnabled) assertReturnCreateQueryBudget(queryLimit, statementsUsed(), 1, 1)
    routeStatements += 1
  }
  const db = Object.create(baseDb) as ReturnType<typeof getDb>
  db.prepare = ((sql: string) => {
    const statement = baseDb.prepare(sql)
    return {
      get: async (params) => {
        countRead()
        if (!statement.getOnce) throw new Error('Customer returns require single-attempt database reads')
        return statement.getOnce(params)
      },
      all: async (params) => {
        countRead()
        if (!statement.allOnce) throw new Error('Customer returns require single-attempt database reads')
        return statement.allOnce(params)
      },
      run: async (params) => { countRead(); return statement.run(params) },
    }
  }) as typeof db.prepare
  const user = c.get('user')
  if (getActionTier(user, 'returns', 'add') === 'none' || getActionTier(user, 'returns', 'view') === 'none') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const authenticatedActorId = actorId(user)
  if (!authenticatedActorId) return c.json({ error: 'Authenticated employee identity required' }, 403)
  const body = await c.req.json<{
    items: ReturnItemInput[]
    sale_id?: number
    receipt_number?: string
    customer_id?: number
    customer_name?: string
    branch_id?: number
    reason?: string
    return_type?: string
    notes?: string
    total_refund_usd?: number
    total_refund_khr?: number
    exchange_rate?: number
    return_number?: string
    client_request_id?: string
    replacement_items?: Array<{ product_id: number; product_name?: string; branch_id?: number; batch_id?: number; damaged_lot_id?: number | null; unlotted_stock?: boolean; quantity: number; applied_price_usd?: number; applied_price_khr?: number }>
    replacement_payment_method?: string
    money_precision_version?: unknown
    expected_quote?: unknown
  }>()

  if (hasAcquisitionCostInput(body.items, user)) return c.json({ error: 'Cost-entry permission is required to submit return cost overrides. Omit cost fields to use recorded costs.', code: 'product_cost_edit_required' }, 403)
  const rawRequestId = String(body.client_request_id ?? '').trim()
  const clientRequestId = rawRequestId || null
  if (!clientRequestId || new TextEncoder().encode(clientRequestId).byteLength > 120) {
    return c.json({
      error: 'This return was prepared by an older screen. Refresh before recording it.',
      code: 'client_request_id_required', action: 'refresh_required',
    }, 400)
  }
  // Read the idempotency receipt BEFORE the body is canonicalised so a replay
  // of an already-recorded return still answers with what was recorded: the
  // version gate below is about NEW writes, not about re-reading history.
  let occupiedRequestId: number | null = null
  const readReceipt = async () => {
    const row = await db.prepare(`SELECT r.return_id,r.sale_id,r.request_digest,r.response_json,o.id AS occupied_id
      FROM (SELECT 1) seed
      LEFT JOIN return_create_receipts r ON r.actor_id=? AND r.request_id=?
      LEFT JOIN returns o ON o.client_request_id=? AND o.client_request_id<>'' LIMIT 1`)
      .get<{ return_id: number | null; sale_id: number | null; request_digest: string; response_json: string; occupied_id: number | null }>([authenticatedActorId, clientRequestId, clientRequestId])
    occupiedRequestId = row?.occupied_id ?? null
    return row?.return_id == null ? undefined : { ...row, return_id: row.return_id }
  }
  const priorReceipt = await readReceipt()
  // The sale decides. A body that is not explicitly v1 (absent, or 0) may not
  // open a return against a v1 sale -- refused here, above canonicalisation, so
  // an explicit 0 gets the same reviewable code as an absent one instead of the
  // canonicaliser's generic 400.
  if (!priorReceipt && body.money_precision_version !== 1
    && (await saleMoneyPrecisionVersion(db, body.sale_id)) === 1) {
    return c.json({ ...MONEY_PRECISION_REVIEW_NEEDED }, 409)
  }
  let canonicalIntent: Record<string, unknown>
  // Lines naming a keeper instead of the sold product; proven from merge records before any write (a replay
  // below writes nothing, so it needs no proof).
  const keeperClaims: ReturnKeeperClaim[] = []
  try {
    canonicalIntent = canonicalReturnCreateIntent(body as Record<string, unknown>)
    const legacyDigest = priorReceipt ? await sha256Hex(JSON.stringify(canonicalIntent)) : null
    if (priorReceipt && priorReceipt.request_digest === legacyDigest
      && (priorReceipt.sale_id ?? null) === (Number(canonicalIntent.sale_id) || null)) {
      return c.json(JSON.parse(priorReceipt.response_json) as ReturnCreateResponse)
    }
    body.items = await resolveCountedReturnConditions(db, Number(canonicalIntent.sale_id) || null,
      body.items as unknown as Array<Record<string, unknown>>, keeperClaims) as unknown as ReturnItemInput[]
    canonicalIntent = canonicalReturnCreateIntent(body as Record<string, unknown>)
  } catch (error) {
    if (error instanceof ReturnCreateBudgetError) throw error
    const stockGuard = productStockGuardError(error)
    if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
    return c.json({ error: (error as Error).message }, 400)
  }
  const requestJson = JSON.stringify(canonicalIntent)
  const requestDigest = await sha256Hex(requestJson)
  const requestedSaleId = Number(canonicalIntent.sale_id) || null
  if (priorReceipt) {
    if (priorReceipt.request_digest !== requestDigest || (priorReceipt.sale_id ?? null) !== requestedSaleId) {
      return c.json({ error: 'client_request_id was already used for different return data.', code: 'idempotency_conflict' }, 409)
    }
    return c.json(JSON.parse(priorReceipt.response_json) as ReturnCreateResponse)
  }
  admissionEnabled = true
  if (occupiedRequestId != null) {
    return c.json({ error: 'client_request_id is already owned by another return.', code: 'idempotency_conflict' }, 409)
  }

  const isMoneyV1 = canonicalIntent.money_precision_version === 1
  let customerReturnV1Plan: Awaited<ReturnType<typeof customerReturnQuotePlanFromDb>> | null = null
  if (isMoneyV1) {
    try {
      customerReturnV1Plan = await customerReturnQuotePlanFromDb(db, requestedSaleId!,
        (canonicalIntent.items as Array<{ sale_item_id: number; quantity: number }>).map(item => ({
          sale_item_id: item.sale_item_id, quantity: item.quantity,
        })))
      if (JSON.stringify(publicCustomerReturnQuote(customerReturnV1Plan.quote)) !== JSON.stringify(canonicalIntent.expected_quote)) {
        return c.json({ error: 'The refund quote changed. Review it before recording the return.',
          code: 'customer_return_quote_stale', action: 'review_required' }, 409)
      }
    } catch (error) {
      if (error instanceof ReturnCreateBudgetError) throw error
      const stockGuard = productStockGuardError(error)
      if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
      if (error instanceof SaleMoneyContractError) {
        return c.json({ error: error.message, code: error.message, action: 'review_required' }, 409)
      }
      throw error
    }
  }

  const reason = String(canonicalIntent.reason)
  let returnItems = body.items
  const replacementInputsRaw = Array.isArray(body.replacement_items) ? body.replacement_items : []


  const returnNumber = body.return_number?.trim() || await uniqueBusinessDateTimeNumber(
    'RET', async (candidate) => !!(await db.prepare('SELECT 1 AS hit FROM returns WHERE return_number=? LIMIT 1').get([candidate])),
  )
  type SaleMeta = {
    receipt_number: string | null; customer_id: number | null; customer_name: string | null
    customer_phone: string | null; customer_address: string | null; branch_id: number | null
    branch_name: string | null; exchange_rate: number | null; sale_status: string | null
    status_before_return: string | null; write_revision: number
    sale_money_precision_version: number | null
  }
  let legacyAuthority:(SaleMeta & {sold_json:string;prior_json:string})|null=null
  let saleMeta: SaleMeta | null = null
  let soldLines: Array<{
    id: number; product_id: number | null; product_name: string | null; quantity: number
    branch_id: number | null; cost_price_usd: number | null; cost_price_khr: number | null
    applied_price_usd: number | null; applied_price_khr: number | null
    batch_id?:number|null;batch_label?:string|null;batch_expiry_date?:string|null
  }> = []
  let committedReturnLines: Array<{ sale_item_id: number | null; product_id: number | null; quantity: number }> = []
  if (requestedSaleId) {
    if(!customerReturnV1Plan) legacyAuthority=await db.prepare(`SELECT s.receipt_number,s.customer_id,s.customer_name,s.customer_phone,s.customer_address,
      s.branch_id,s.branch_name,s.exchange_rate,s.sale_status,s.status_before_return,s.money_precision_version AS sale_money_precision_version,COALESCE(v.revision,0) AS write_revision,
      (SELECT json_group_array(json_object('id',si.id,'product_id',si.product_id,'product_name',si.product_name,'quantity',si.quantity,'branch_id',si.branch_id,
        'cost_price_usd',si.cost_price_usd,'cost_price_khr',si.cost_price_khr,'applied_price_usd',si.applied_price_usd,'applied_price_khr',si.applied_price_khr,
        'batch_id',si.batch_id,'batch_label',si.batch_label,'batch_expiry_date',si.batch_expiry_date))
        FROM(SELECT * FROM sale_items WHERE sale_id=s.id ORDER BY id)si) AS sold_json,
      (SELECT json_group_array(json_object('sale_item_id',prior.sale_item_id,'product_id',prior.product_id,'quantity',prior.quantity))
        FROM(SELECT ri.sale_item_id,ri.product_id,ri.quantity FROM return_items ri JOIN returns r ON r.id=ri.return_id
          WHERE r.sale_id=s.id AND COALESCE(r.status,'completed')!='cancelled' AND COALESCE(r.return_scope,'customer')='customer' ORDER BY r.id,ri.id)prior) AS prior_json
      FROM sales s LEFT JOIN sale_write_revisions v ON v.sale_id=s.id WHERE s.id=?`).get<NonNullable<typeof legacyAuthority>>([requestedSaleId])||null
    saleMeta=customerReturnV1Plan?{
      ...customerReturnV1Plan.authority.sale,write_revision:Number(customerReturnV1Plan.authority.sale.sale_revision),
      sale_money_precision_version:Number(customerReturnV1Plan.authority.sale.money_precision_version),
    } as SaleMeta:legacyAuthority
    if (!saleMeta) return c.json({ error: 'Original sale not found' }, 400)
    if (String(saleMeta.sale_status || 'completed') === 'cancelled') {
      return c.json({ error: 'This sale is cancelled -- un-cancel it before recording a return.' }, 400)
    }
    // Second, write-adjacent lock on the same rule, read from the sale row this
    // handler already loads: no legacy-priced return row is inserted for a v1
    // sale, whatever path reached here.
    if (!isMoneyV1 && Number(saleMeta.sale_money_precision_version) === 1) {
      return c.json({ ...MONEY_PRECISION_REVIEW_NEEDED }, 409)
    }
    soldLines=customerReturnV1Plan?customerReturnV1Plan.authority.sale_items as typeof soldLines:JSON.parse(legacyAuthority!.sold_json||'[]') as typeof soldLines
    const soldById = new Map(soldLines.map((line) => [Number(line.id), line]))
    returnItems = body.items.map((item) => {
      const sold = item.sale_item_id ? soldById.get(Number(item.sale_item_id)) : null
      return sold ? {
        ...item,
        product_id: sold.product_id ?? item.product_id,
        product_name: sold.product_name ?? item.product_name,
        branch_id: sold.branch_id ?? item.branch_id,
        cost_price_usd: isMoneyV1 || !canEditAcquisitionCosts(user) ? sold.cost_price_usd : sold.cost_price_usd ?? item.cost_price_usd,
        cost_price_khr: isMoneyV1 || !canEditAcquisitionCosts(user) ? sold.cost_price_khr : sold.cost_price_khr ?? item.cost_price_khr,
      } : item
    })
    committedReturnLines = customerReturnV1Plan ? customerReturnV1Plan.authority.prior_items.map(line => ({
      sale_item_id: line.sale_item_id == null ? null : Number(line.sale_item_id),
      product_id: null, quantity: Number(line.quantity),
    })) : JSON.parse(legacyAuthority!.prior_json||'[]') as typeof committedReturnLines
    if (!isMoneyV1) {
      try {
        assertReturnCreateCapacity(soldLines, committedReturnLines, returnItems)
      } catch (error) {
        if (error instanceof ReturnCreateBudgetError) throw error
        const stockGuard = productStockGuardError(error)
        if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
        return c.json({ error: (error as Error).message }, 400)
      }
    }
  }
  // One rate for the return row and its replacement sale. A return against a
  // sale belongs to that sale and books the sale's own rate, never the body's
  // or today's setting (schema default when the old sale has none). A return
  // with no original sale is a new record: the reviewed body rate, else the
  // live setting.
  const returnExchangeRate = saleMeta
    ? positiveRate(saleMeta.exchange_rate) ?? SCHEMA_DEFAULT_EXCHANGE_RATE
    : positiveRate(body.exchange_rate) ?? await liveExchangeRate(db)
  // P4-3: validate every 'damaged' line's tag/disposition BEFORE any write
  // statement is built -- nothing below this point has executed yet, so a
  // 400 here leaves no partial state.
  for (const item of returnItems) {
    if (normalizeStockAction(item) !== 'damaged') continue
    const choice = resolveDamagedReturnChoice(item)
    if (!choice.ok) return c.json({ error: choice.error }, 400)
  }
  let projectedStatus: string | null = null
  if (saleMeta) {
    if (isMoneyV1) {
      try {
        projectedStatus = projectedSaleStatusForReturnCreateV1(soldLines, committedReturnLines, returnItems, saleMeta.status_before_return)
      } catch (error) {
        if (error instanceof ReturnCreateBudgetError) throw error
        const stockGuard = productStockGuardError(error)
        if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
        return c.json({ error: (error as Error).message, code: 'customer_return_quote_stale', action: 'review_required' }, 409)
      }
    } else {
      projectedStatus = projectedSaleStatusForReturnCreate(soldLines, committedReturnLines, returnItems, saleMeta.status_before_return)
    }
  }
  const beforeSaleStatus = saleMeta ? String(saleMeta.sale_status || 'completed') : null

  // Where the stock (and the refund) of this return lands. A sale recorded at a
  // branch that has since been retired (Old Shop) keeps its branch id and its
  // label, but the units and the refund go to the ACTIVE branch the operator
  // confirmed (X-Branch-Redirect; refused with branch_redirect_required until
  // then) and every new row says so; while every branch is active this is the
  // identity (nothing below changes).
  const recordedBranchId = Number(body.branch_id || saleMeta?.branch_id || replacementInputsRaw[0]?.branch_id) || null
  const branchDirectory = await db.prepare(`SELECT ${BRANCH_EFFECT_COLUMNS_SQL} FROM branches`).all<BranchEffectRow>()
  const redirectTarget = branchRedirectTarget(c)
  let headerEffect: BranchEffect | null = null
  const itemEffects: Array<BranchEffect | null> = []
  let replacementInputs = replacementInputsRaw
  const movesStock = replacementInputsRaw.length > 0 || returnItems.some((item) => normalizeStockAction(item) !== 'none')
  try {
    try {
      headerEffect = recordedBranchId ? resolveBranchEffect(branchDirectory, recordedBranchId, { sells: replacementInputsRaw.length > 0, target: redirectTarget }) : null
    } catch (error) {
      if (error instanceof ReturnCreateBudgetError) throw error
      const stockGuard = productStockGuardError(error)
      if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
      // A return that moves no stock has nothing to strand on a retired branch no active branch could take. One that
      // pays a refund still asks where the cash leaves (branch_redirect_required) while an active branch exists.
      if (!branchHasNoActiveTarget(error) || movesStock) throw error
    }
    for (const item of returnItems) {
      const recordedItemBranch = Number(item.branch_id || recordedBranchId) || null
      try {
        itemEffects.push(recordedItemBranch ? resolveBranchEffect(branchDirectory, recordedItemBranch, { target: redirectTarget }) : null)
      } catch (error) {
        if (error instanceof ReturnCreateBudgetError) throw error
        const stockGuard = productStockGuardError(error)
        if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
        // A line that moves no stock (stock_action none) has nothing to strand, so it never blocks.
        if (!(error instanceof BranchRetiredNoSuccessorError) || normalizeStockAction(item) !== 'none') throw error
        itemEffects.push(null)
      }
    }
    if (replacementInputsRaw.length) {
      replacementInputs = replacementInputsRaw.map((line) => {
        const effect = resolveBranchEffect(branchDirectory, line.branch_id || recordedBranchId, { sells: true, target: redirectTarget })
        return effect.redirected ? { ...line, branch_id: effect.effectBranchId } : line
      })
    }
  } catch (error) {
    if (error instanceof ReturnCreateBudgetError) throw error
    const stockGuard = productStockGuardError(error)
    if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
    const refusal = branchEffectRefusal(error)
    if (refusal) return c.json(refusal, 409)
    throw error
  }
  returnItems = returnItems.map((item, index) => itemEffects[index]?.redirected ? { ...item, branch_id: itemEffects[index]!.effectBranchId } : item)
  const branchId = headerEffect?.redirected ? headerEffect.effectBranchId : recordedBranchId
  const branchRow = branchId ? branchDirectory.find((row) => Number(row.id) === branchId) ?? null : null
  const branch: { id: number; name: string | null; is_active: number | null } | null = branchRow
    ? { id: Number(branchRow.id), name: branchRow.name, is_active: branchRow.is_active == null ? null : Number(branchRow.is_active) }
    : null
  // The label the sale was made under ("Shop", written when it was made), not the retired branch's name today.
  const addressedLabel = (effect: BranchEffect): string | null =>
    (saleMeta && Number(saleMeta.branch_id) === effect.addressedBranchId && saleMeta.branch_name) || effect.addressedName
  const addressedBranchName = headerEffect?.redirected ? addressedLabel(headerEffect) : null
  let branchName = branch?.name || saleMeta?.branch_name || null
  if (replacementInputs.length) {
    if (!branch || Number(branch.is_active || 0) !== 1 || !branchCanSell(branchRow)
      || replacementInputs.some((line) => Number(line.branch_id || branchId) !== branchId)) {
      return c.json({ error: WAREHOUSE_NOT_SELLABLE_ERROR }, 400)
    }
    branchName = branch.name
  }

  type ProductMeta = {
    id: number; name: string; cost_price_usd: number; cost_price_khr: number
    selling_price_usd: number; selling_price_khr: number; updated_at: string | null; is_active: number | null
  }
  const productIds = [...new Set([
    ...returnItems.map((item) => Number(item.product_id)),
    ...replacementInputs.map((item) => Number(item.product_id)),
  ].filter((id) => Number.isSafeInteger(id) && id > 0))]
  const productMap = new Map<number, ProductMeta>()
  if (productIds.length) {
    const rows = await selectInChunks(productIds, 0, (chunk) => db.prepare(`SELECT id,name,cost_price_usd,cost_price_khr,
      selling_price_usd,selling_price_khr,updated_at,is_active FROM products WHERE id IN (${chunk.map(() => '?').join(',')})`).all<ProductMeta>(chunk))
    for (const row of rows) productMap.set(Number(row.id), row)
  }
  try {
    returnItems = returnItems.map(item => ({ ...item, ...fillOmittedReturnCosts(item, requestedSaleId ? soldLines : [...productMap.values()], requestedSaleId ? 'sale' : 'catalog') }))
  } catch (error) {
    if (error instanceof ReturnCreateBudgetError) throw error
    const stockGuard = productStockGuardError(error)
    if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
    return c.json({ error: (error as Error).message, code: 'return_cost_source_review_required' }, 409)
  }
  if (replacementInputs.some((input) => Number(productMap.get(Number(input.product_id))?.is_active || 0) !== 1)) {
    return c.json({ error: 'Each replacement line needs an active catalog product' }, 400)
  }
  if (replacementInputs.some(line => (line.unlotted_stock !== undefined && typeof line.unlotted_stock !== 'boolean') || (line.unlotted_stock === true && line.batch_id != null) || (line.damaged_lot_id != null && (line.batch_id != null || line.unlotted_stock === true || !Number.isSafeInteger(Number(line.damaged_lot_id)) || Number(line.damaged_lot_id) <= 0)))) return c.json({error:'Conflicting replacement stock source'},400)
  const replacementLines = replacementInputs.map((input) => {
    const productId = Number(input.product_id)
    const meta = productMap.get(productId)
    const quantity = Number(input.quantity)
    if (!meta || !(quantity > 0)) throw new Error('Each replacement line needs an active product and positive quantity')
    const lineBranchId = Number(input.branch_id || branchId)
    const priceUsd = input.applied_price_usd != null ? toNumber(input.applied_price_usd) : toNumber(meta.selling_price_usd)
    const priceKhr = input.applied_price_khr != null ? toNumber(input.applied_price_khr) : toNumber(meta.selling_price_khr)
    return {
      productId, productName: input.product_name?.trim() || meta.name, branchId: lineBranchId,
      taggedLotId: input.damaged_lot_id == null ? null : Number(input.damaged_lot_id),
      tagged: undefined as (Awaited<ReturnType<typeof readTaggedSaleSources>> extends Map<number,infer T> ? T : never) | undefined,
      unlottedStock: input.unlotted_stock === true,
      batchId: Number(input.batch_id) > 0 ? Number(input.batch_id) : null, quantity,
      priceUsd, priceKhr, totalUsd: Number((priceUsd * quantity).toFixed(2)), totalKhr: Math.round(priceKhr * quantity),
      unitCostUsd: toNumber(meta.cost_price_usd), unitCostKhr: toNumber(meta.cost_price_khr),
    }
  })

  try { const taggedSources = await readTaggedSaleSources(db,replacementLines,true); for (const line of replacementLines) if(line.taggedLotId) line.tagged=taggedSources.get(line.taggedLotId) } catch(error) { return c.json({error:error instanceof Error ? error.message : 'Invalid tagged replacement source'},409) }

  const returnSaleItemIds = returnItems.map((item) => Number(item.sale_item_id)).filter((id) => Number.isSafeInteger(id) && id > 0)
  const saleItemBatchInfo: Map<number, SaleLineInfo> = customerReturnV1Plan
    ? new Map(customerReturnV1Plan.authority.sale_items.filter(line => returnSaleItemIds.includes(Number(line.id))).map(line => [Number(line.id), {
      batch_id: line.batch_id == null ? null : Number(line.batch_id),
      batch_label: line.batch_label == null ? null : String(line.batch_label),
      batch_expiry_date: line.batch_expiry_date == null ? null : String(line.batch_expiry_date),
      applied_price_usd: line.applied_price_usd == null ? null : Number(line.applied_price_usd),
      applied_price_khr: line.applied_price_khr == null ? null : Number(line.applied_price_khr),
    }])) : new Map(soldLines.filter(line=>returnSaleItemIds.includes(line.id)).map(line=>[line.id,{batch_id:line.batch_id??null,batch_label:line.batch_label??null,batch_expiry_date:line.batch_expiry_date??null,applied_price_usd:line.applied_price_usd,applied_price_khr:line.applied_price_khr}]))
  const saleItemAllocations = await fetchSaleItemAllocations(db, returnSaleItemIds.filter(id=>returnItems.some(item=>Number(item.sale_item_id)===id && !item.counted_original_condition)))
  const v1QuoteBySaleItem = new Map(customerReturnV1Plan?.quote.items.map(item => [item.sale_item_id, item]) || [])
  // A return against a sale is priced from that sale's own lines, matched the
  // same way the quantity cap matched them: by sale_item_id, else by product_id.
  // Only a return with no sale at all falls back to the posted price.
  let refundPrices: Array<{ unitUsd: number; unitKhr: number }>
  try {
    refundPrices = returnItems.map((item) => {
      const exact = v1QuoteBySaleItem.get(Number(item.sale_item_id))
      if (exact) return { unitUsd: exact.applied_price_usd, unitKhr: exact.applied_price_khr }
      if (!saleMeta) {
        return resolveRefundUnitPrice({
          saleLine: item.sale_item_id ? saleItemBatchInfo.get(Number(item.sale_item_id)) || null : null,
          postedUsd: toNumber(item.applied_price_usd), postedKhr: toNumber(item.applied_price_khr),
        })
      }
      const match = matchRefundSaleLine(soldLines, item)
      return resolveRefundUnitPrice({
        saleLine: match?.line ?? null, matchedBy: match?.matchedBy,
        postedUsd: item.applied_price_usd == null ? null : toNumber(item.applied_price_usd),
        postedKhr: item.applied_price_khr == null ? null : toNumber(item.applied_price_khr),
      })
    })
  } catch (error) {
    if (error instanceof ReturnCreateBudgetError) throw error
    const stockGuard = productStockGuardError(error)
    if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
    if (error instanceof RefundSaleLineError) return c.json({ error: error.message, code: error.code }, 400)
    throw error
  }
  const totalRefundUsd = customerReturnV1Plan?.quote.total_refund_usd
    ?? Number(returnItems.reduce((sum, item, index) => sum + refundPrices[index].unitUsd * Number(item.quantity), 0).toFixed(2))
  const totalRefundKhr = customerReturnV1Plan?.quote.total_refund_khr
    ?? Math.round(returnItems.reduce((sum, item, index) => sum + refundPrices[index].unitKhr * Number(item.quantity), 0))

  const returnLotPlans: Array<{ splits: Array<{ batchId: number; quantity: number }>; plainQuantity: number }> = []
  for (const item of returnItems) {
    const quantity = Number(item.quantity)
    const productId = Number(item.product_id)
    const itemBranchId = Number(item.branch_id || branchId)
    if (normalizeStockAction(item) === 'none' || !productId || !itemBranchId) {
      returnLotPlans.push({ splits: [], plainQuantity: 0 })
      continue
    }
    const plan = planReturnLot({
      allocations: item.sale_item_id ? saleItemAllocations.get(Number(item.sale_item_id)) || [] : [],
      saleLineBatchId: item.sale_item_id ? saleItemBatchInfo.get(Number(item.sale_item_id))?.batch_id ?? null : null,
      operatorBatchId: Number(item.batch_id) > 0 ? Number(item.batch_id) : null,
      // Unattributed units receive their own dated return-event lot below.
      quantity, lotTracked: false,
    })
    if (plan.requiresLotPick) {
      const error = new ReturnLotRequiredError(item.product_name?.trim() || productMap.get(productId)?.name || `product #${productId}`, quantity)
      return c.json({ error: error.message, code: error.code, product_id: productId }, 400)
    }
    returnLotPlans.push({ splits: plan.splits, plainQuantity: plan.plainQuantity })
  }

  // A return redirected to the successor gives its units back to the lot that is
  // there NOW: a lot the consolidation folded into another (same product, same
  // received date) is restocked as that survivor, never as the folded id.
  const lotSurvivors = new Map<string, number>()
  const redirectedEffectIds = [...new Set(itemEffects.filter((effect) => effect?.redirected).map((effect) => effect!.effectBranchId))]
  for (const effectId of redirectedEffectIds) {
    const wanted = returnItems.flatMap((item, index) => itemEffects[index]?.effectBranchId === effectId && itemEffects[index]?.redirected
      ? [...returnLotPlans[index].splits.map((split) => split.batchId), ...(item.sale_item_id ? [saleItemBatchInfo.get(Number(item.sale_item_id))?.batch_id ?? 0] : [])]
      : [])
    for (const [folded, survivor] of await foldedLotSurvivors(db, effectId, wanted)) lotSurvivors.set(`${effectId}:${folded}`, survivor)
  }
  const effectiveBatchId = (index: number, batchId: number | null): number | null => {
    const effect = itemEffects[index]
    return batchId != null && effect?.redirected ? lotSurvivors.get(`${effect.effectBranchId}:${batchId}`) ?? batchId : batchId
  }
  if (lotSurvivors.size) {
    for (const [index, plan] of returnLotPlans.entries()) {
      const merged = new Map<number, number>()
      for (const split of plan.splits) {
        const batchId = effectiveBatchId(index, split.batchId)!
        merged.set(batchId, (merged.get(batchId) || 0) + split.quantity)
      }
      returnLotPlans[index] = { splits: [...merged].map(([batchId, quantity]) => ({ batchId, quantity })), plainQuantity: plan.plainQuantity }
    }
  }

  // Refund, cost and entitlement are settled above from the ORIGINAL sale item. A line whose sold product has since
  // been merged away now receives its units on the proven keeper; only that new line's physical tuple names it.
  const isMergedProduct = (productId: number) => Number(productMap.get(productId)?.is_active ?? 1) !== 1
  const unprovableClaim = keeperClaims.find(claim => !isMergedProduct(claim.originalProductId))
  if (unprovableClaim) return c.json({ error: returnKeeperClaimError(unprovableClaim).code }, 400)
  const lineBranchId = (index: number) => Number(returnItems[index].branch_id || branchId)
  // An operator-picked receipt belongs to the product the line names (a proven keeper may hold it); every other
  // split came from the sale's own allocations, so it belongs to the sold product.
  const splitOwner = (index: number) => {
    const item = returnItems[index]
    return Number(item.batch_id) > 0 && !item.counted_original_condition
      ? keeperClaims.find(claim => claim.index === index)?.productId ?? Number(item.product_id) : Number(item.product_id)
  }
  const mergedLines = returnItems.flatMap((item, index) => normalizeStockAction(item) !== 'none' && Number(item.product_id) > 0
    && lineBranchId(index) > 0 && isMergedProduct(Number(item.product_id)) ? [index] : [])
  let mergeEffects: ReturnMergeEffects
  try {
    mergeEffects = await readReturnMergeEffects(db, mergedLines.flatMap(index => returnLineTuples(Number(returnItems[index].product_id),
      lineBranchId(index), returnLotPlans[index], splitOwner(index))), keeperClaims, lineBranchId)
    for (const index of mergedLines) {
      const landed = landReturnLine(mergeEffects, Number(returnItems[index].product_id), lineBranchId(index), returnLotPlans[index], splitOwner(index))
      returnItems[index] = { ...returnItems[index], product_id: landed.productId }
      returnLotPlans[index] = landed.plan
    }
  } catch (error) {
    if (error instanceof ReturnCreateBudgetError) throw error
    const refusal = returnMergeRefusal(error)
    if (refusal) return c.json(refusal.body, refusal.status)
    throw error
  }

  type LotTake = { batchId: number; lotCode: string | null; expiryDate: string | null; quantity: number }
  const replacementFifoTakes = new Map<number, LotTake[]>()
  const replacementExplicitTakes = new Map<number, LotTake[]>()
  // Perf-2: this used to run one product_batches SELECT per replacement
  // line with an explicit batch chosen. Read every explicit batch id once
  // (IN-chunked for D1's bound-param cap) and re-check id+variant_product_id
  // in JS -- same match, same 'does not belong to this replacement product'
  // refusal, one or a handful of round trips instead of one per line.
  const explicitBatchIds = [...new Set(replacementLines
    .filter((line) => line.batchId != null)
    .map((line) => line.batchId as number))]
  const explicitLotById = new Map<number, { lot_code: string | null; expiry_date: string | null; variant_product_id: number }>()
  if (explicitBatchIds.length) {
    const rows = await selectInChunks(explicitBatchIds, 0, (chunk) => db.prepare(
      `SELECT id,lot_code,expiry_date,variant_product_id FROM product_batches WHERE id IN (${chunk.map(() => '?').join(',')}) AND is_active=1`,
    ).all<{ id: number; lot_code: string | null; expiry_date: string | null; variant_product_id: number }>(chunk))
    for (const row of rows) explicitLotById.set(Number(row.id), row)
  }
  for (const [index, line] of replacementLines.entries()) {
    if (line.batchId == null) continue
    const lot = explicitLotById.get(line.batchId)
    if (!lot || Number(lot.variant_product_id) !== line.productId) {
      return c.json({ error: 'Selected received date does not belong to this replacement product' }, 400)
    }
    replacementExplicitTakes.set(index, [{ batchId: line.batchId, lotCode: lot.lot_code, expiryDate: lot.expiry_date, quantity: line.quantity }])
  }

  const occurredAt = new Date().toISOString()
  const receiptId = crypto.randomUUID()
  const operationId = crypto.randomUUID()
  const replacementIdentityDigest = await sha256Hex(`${authenticatedActorId}:${clientRequestId}`)
  const replacementClientRequestId = `return-replacement:${replacementIdentityDigest}`
  let replacementReceiptNumber: string | null = null
  let replacementCreationSnapshot: string | null = null
  let replacementTotals: ReturnType<typeof computeSaleTotals> | null = null
  let replacementNotice: Parameters<typeof formatSaleTelegramLines>[0] | null = null
  let replacementCustomerId: number | null = null
  let replacementCustomerName: string | null = null
  let replacementCustomerPhone: string | null = null
  let replacementCustomerAddress: string | null = null
  let replacementMembershipNumber: string | null = null
  let replacementCustomerGuard: {
    customer_id: number; exists: number; is_anonymous: number; membership_number: string
  } | null = null
  const replacementPaymentMethod = String(body.replacement_payment_method || '').trim() || DEFAULT_REPLACEMENT_PAYMENT_METHOD
  if (replacementLines.length) {
    replacementReceiptNumber = await uniqueBusinessDateTimeNumber('', async (candidate) => !!(await db.prepare('SELECT 1 FROM sales WHERE receipt_number=? LIMIT 1').get([candidate])))
    const subtotalUsd = Number(replacementLines.reduce((sum, line) => sum + line.totalUsd, 0).toFixed(2))
    const exchangeRate = returnExchangeRate
    replacementTotals = computeSaleTotals({
      subtotalUsd, discountUsd: 0, membershipDiscountUsd: 0, taxUsd: 0, deliveryFeeUsd: 0,
      deliveryFeePaidBy: 'customer', isDelivery: false, exchangeRate,
      rawAmountPaidUsd: subtotalUsd, rawAmountPaidKhr: 0,
    })
    const candidateCustomerId = Number(body.customer_id || saleMeta?.customer_id) || null
    const candidateCustomer = candidateCustomerId
      ? await db.prepare('SELECT id,membership_number,is_anonymous FROM customers WHERE id=?')
        .get<{ id: number; membership_number: string | null; is_anonymous: number | null }>([candidateCustomerId])
      : null
    if (candidateCustomerId) {
      replacementCustomerGuard = {
        customer_id: candidateCustomerId, exists: candidateCustomer ? 1 : 0,
        is_anonymous: Number(candidateCustomer?.is_anonymous || 0),
        membership_number: candidateCustomer?.membership_number || '',
      }
    }
    const candidateIsAnonymous = isAnonymousCustomer(candidateCustomer)
    replacementCustomerId = candidateCustomer && !candidateIsAnonymous ? candidateCustomerId : null
    replacementCustomerName = candidateIsAnonymous ? null : body.customer_name || saleMeta?.customer_name || null
    replacementCustomerPhone = candidateIsAnonymous ? null : saleMeta?.customer_phone || null
    replacementCustomerAddress = candidateIsAnonymous ? null : contactDisplayAddress(saleMeta?.customer_address) || null
    replacementMembershipNumber = candidateCustomer && !candidateIsAnonymous ? candidateCustomer.membership_number || null : null
    const paymentDetails = subtotalUsd > 0 ? [{ method: replacementPaymentMethod, amount_usd: subtotalUsd, amount_khr: 0 }] : []
    replacementCreationSnapshot = buildSaleCreationSnapshot({
      origin: 'return_replacement', recordedAt: occurredAt, saleAt: occurredAt,
      receiptNumber: replacementReceiptNumber, actor: user, cashierId: authenticatedActorId,
      cashierName: actorSnapshot(user), saleStatus: 'completed',
      items: replacementLines.map((line) => ({ product_id: line.productId, product_name: line.productName, quantity: line.quantity, applied_price_usd: line.priceUsd, total_usd: line.totalUsd })),
      totalUsd: replacementTotals.totalUsd, paymentMethod: replacementPaymentMethod, paymentDetails,
      amountPaidUsd: replacementTotals.amountPaidUsd, amountPaidKhr: replacementTotals.amountPaidKhr,
      changeUsd: 0, changeKhr: 0, isDelivery: false, deliveryFeeUsd: 0,
      customerSnapshot: replacementCustomerId || String(replacementCustomerName || '').trim() ? { id: replacementCustomerId, name: replacementCustomerName } : null,
      membershipSnapshot: replacementMembershipNumber ? { number: replacementMembershipNumber, discountUsd: 0, discountKhr: 0, pointsRedeemed: 0 } : null,
    })
    replacementNotice = {
      status: 'completed', createdAt: occurredAt, receiptNumber: replacementReceiptNumber,
      cashier: actorSnapshot(user), customer: replacementCustomerName, phone: replacementCustomerPhone,
      branch: branchName, items: replacementLines.map((line) => ({ name: line.productName, quantity: line.quantity, unitPriceUsd: line.priceUsd, basePriceUsd: null, lineTotalUsd: line.totalUsd })),
      exchangeRate, isDelivery: false, deliveryFeeUsd: 0, deliveryPaidBy: null, driver: null,
      subtotalUsd, discountUsd: 0, taxUsd: 0, totalUsd: replacementTotals.totalUsd,
      totalKhr: replacementTotals.totalKhr, paidUsd: replacementTotals.amountPaidUsd,
      paidKhr: replacementTotals.amountPaidKhr, changeUsd: 0, changeKhr: 0, paymentMethod: replacementPaymentMethod,
    }
  }

  const countedContexts = new Map<string, CountedReturnContext>()
  for (const [index, item] of returnItems.entries()) {
    const productId = Number(item.product_id), itemBranchId = Number(item.branch_id || branchId)
    if (normalizeStockAction(item) !== 'none' && productId > 0 && itemBranchId > 0) addCountedReturnContext(countedContexts, productId, itemBranchId,
      returnLotPlans[index].splits.map(split => split.batchId), [` event:return:${clientRequestId}:${index}`])
  }
  for (const line of replacementLines) addCountedReturnContext(countedContexts, line.productId, line.branchId,
    [line.batchId, line.tagged?.batchId].filter((id): id is number => id != null))
  const exactStock = await readProjectedReturnStock(db, countedContexts)
  const createdReceiptGuards: Array<{ sql: string; params: Record<string, unknown> }> = []
  let branchSnapshots: Array<{ product_id: number; branch_id: number; after: number }> = []
  let batchSnapshots: Array<{ batch_id: number | null; batch_key: string | null; product_id: number; branch_id: number; after: number }> = []
  let productSnapshots: Array<{ product_id: number; after: number }> = []

  const guardState = {
    sale: saleMeta ? { id: requestedSaleId, revision: saleMeta.write_revision, status: beforeSaleStatus, status_before_return: saleMeta.status_before_return || '' } : null,
    branch: branch ? { id: branch.id, name: branch.name || '', is_active: Number(branch.is_active || 0) } : null,
    products: productIds.map((id) => {
      const product = productMap.get(id)
      return {
        id, updated_at: product?.updated_at || '', name: product?.name || '', is_active: Number(product?.is_active || 0),
        requires_active: replacementLines.some((line) => line.productId === id) ? 1 : 0,
        cost_price_usd: Number(product?.cost_price_usd) || 0, cost_price_khr: Number(product?.cost_price_khr) || 0,
        selling_price_usd: Number(product?.selling_price_usd) || 0, selling_price_khr: Number(product?.selling_price_khr) || 0,
      }
    }),
    customer: replacementCustomerGuard,

  }
  const guardJson = JSON.stringify(guardState)
  // Every redirected pair is re-proved inside the commit: the landing branch is still active with no successor
  // of its own and the addressed branch still points at it.
  const effectGuards = branchEffectGuards([headerEffect, ...itemEffects].filter((effect): effect is BranchEffect => !!effect), replacementInputs.length > 0)
  const commonGuardParams = {
    guardJson, receiptId, actorId: authenticatedActorId, requestId: clientRequestId,
    requestDigest, returnNumber, replacementClientRequestId,
    replacementReceiptNumber,
    customerReturnAuthorityJson: customerReturnV1Plan?.authority_json ?? null,
    ...(effectGuards.length ? { effectsJson: JSON.stringify(effectGuards) } : {}),
    ...(customerReturnV1Plan?.lineage.params ?? {}),
  }
  const precondition = `
    NOT EXISTS(SELECT 1 FROM return_create_receipts WHERE actor_id=@actorId AND request_id=@requestId)
    AND NOT EXISTS(SELECT 1 FROM returns WHERE client_request_id=@requestId OR return_number=@returnNumber)
    AND (@replacementReceiptNumber IS NULL OR NOT EXISTS(
      SELECT 1 FROM sales WHERE client_request_id=@replacementClientRequestId OR receipt_number=@replacementReceiptNumber
    ))
    AND (json_type(@guardJson,'$.sale')='null' OR EXISTS(
      SELECT 1 FROM sales s LEFT JOIN sale_write_revisions v ON v.sale_id=s.id
      WHERE s.id=json_extract(@guardJson,'$.sale.id')
        AND COALESCE(v.revision,0)=json_extract(@guardJson,'$.sale.revision')
        AND COALESCE(s.sale_status,'completed')=json_extract(@guardJson,'$.sale.status')
        AND COALESCE(s.status_before_return,'')=json_extract(@guardJson,'$.sale.status_before_return')
    ))
    AND (json_type(@guardJson,'$.branch')='null' OR EXISTS(
      SELECT 1 FROM branches b WHERE b.id=json_extract(@guardJson,'$.branch.id')
        AND COALESCE(b.name,'')=json_extract(@guardJson,'$.branch.name')
        AND COALESCE(b.is_active,0)=json_extract(@guardJson,'$.branch.is_active')
    ))
    AND NOT EXISTS(SELECT 1 FROM json_each(@guardJson,'$.products') j
      WHERE NOT EXISTS(SELECT 1 FROM products p WHERE p.id=json_extract(j.value,'$.id')
        AND COALESCE(p.updated_at,'')=json_extract(j.value,'$.updated_at')
        AND COALESCE(p.name,'')=json_extract(j.value,'$.name')
        AND COALESCE(p.is_active,0)=json_extract(j.value,'$.is_active')
        AND (json_extract(j.value,'$.requires_active')=0 OR COALESCE(p.is_active,0)=1)
        AND COALESCE(p.cost_price_usd,0)=json_extract(j.value,'$.cost_price_usd')
        AND COALESCE(p.cost_price_khr,0)=json_extract(j.value,'$.cost_price_khr')
        AND COALESCE(p.selling_price_usd,0)=json_extract(j.value,'$.selling_price_usd')
        AND COALESCE(p.selling_price_khr,0)=json_extract(j.value,'$.selling_price_khr')))
    AND (json_type(@guardJson,'$.customer')='null' OR (
      (json_extract(@guardJson,'$.customer.exists')=0 AND NOT EXISTS(
        SELECT 1 FROM customers c WHERE c.id=json_extract(@guardJson,'$.customer.customer_id')
      )) OR (json_extract(@guardJson,'$.customer.exists')=1 AND EXISTS(
        SELECT 1 FROM customers c WHERE c.id=json_extract(@guardJson,'$.customer.customer_id')
          AND COALESCE(c.is_anonymous,0)=json_extract(@guardJson,'$.customer.is_anonymous')
          AND COALESCE(c.membership_number,'')=json_extract(@guardJson,'$.customer.membership_number')
      ))
    ))
    AND (@customerReturnAuthorityJson IS NULL OR ((${customerReturnAuthorityPredicate()})
      AND (${customerReturnV1Plan?.lineage.condition ?? '1=1'})))${effectGuards.length ? ` AND ${branchEffectGuardPredicate('@effectsJson')}` : ''}
  `
  const statements: Array<{ sql: string; params: Record<string, unknown> }> = [
    ...exactStock.takePreimageGuards(),
    returnCreateGuardStatement(operationId, 'precondition', precondition, commonGuardParams),
    ...(mergeEffects.guard ? [mergeEffects.guard] : []),
  ]
  const returnIdExpression = returnCreateIdSql()
  const replacementSaleExpression = replacementSaleIdSql()
  statements.push({
    sql: `INSERT INTO returns(
      return_number,client_request_id,sale_id,receipt_number,cashier_id,cashier_name,
      customer_id,customer_name,branch_id,branch_name,return_scope,reason,return_type,
      notes,total_refund_usd,total_refund_khr,exchange_rate,status,search_normalized,
      money_precision_version,calculated_refund_usd,rounding_adjustment_usd${addressedBranchName ? ',addressed_branch_name' : ''}
    ) VALUES(
      @return_number,@returnClientRequestId,@sale_id,@receipt_number,@cashier_id,@cashier_name,
      @customer_id,@customer_name,@branch_id,@branch_name,'customer',@reason,@return_type,
      @notes,@total_refund_usd,@total_refund_khr,@exchange_rate,'completed',@search_normalized,
      @money_precision_version,@calculated_refund_usd,@rounding_adjustment_usd${addressedBranchName ? ',@addressed_branch_name' : ''}
    )`,
    params: {
      return_number: returnNumber, returnClientRequestId: clientRequestId, sale_id: requestedSaleId,
      receipt_number: body.receipt_number || saleMeta?.receipt_number || null,
      cashier_id: authenticatedActorId, cashier_name: actorSnapshot(user),
      customer_id: body.customer_id || saleMeta?.customer_id || null,
      customer_name: body.customer_name || saleMeta?.customer_name || null,
      branch_id: branchId, branch_name: branchName, reason,
      // The branch the sale was made at, when the stock went to its successor: the sale keeps its own
      // branch_id and label; this return records where the units really went AND what it was addressed to.
      ...(addressedBranchName ? { addressed_branch_name: addressedBranchName } : {}),
      return_type: String(canonicalIntent.return_type), notes: canonicalIntent.notes,
      total_refund_usd: totalRefundUsd, total_refund_khr: totalRefundKhr,
      exchange_rate: customerReturnV1Plan
        ? Number(customerReturnV1Plan.authority.sale.exchange_rate)
        : returnExchangeRate,
      money_precision_version: isMoneyV1 ? 1 : 0,
      calculated_refund_usd: customerReturnV1Plan?.quote.calculated_refund_usd ?? null,
      rounding_adjustment_usd: customerReturnV1Plan?.quote.rounding_adjustment_usd ?? 0,
      search_normalized: normalizeSearchText([
        returnNumber, body.receipt_number || saleMeta?.receipt_number, actorSnapshot(user),
        body.customer_name || saleMeta?.customer_name, branchName, reason, canonicalIntent.return_type, canonicalIntent.notes,
      ].filter(Boolean).join(' ')),
    },
  })

  if (replacementLines.length && replacementTotals && replacementReceiptNumber) {
    const subtotalUsd = Number(replacementLines.reduce((sum, line) => sum + line.totalUsd, 0).toFixed(2))
    const exchangeRate = returnExchangeRate
    const originalReceipt = body.receipt_number || saleMeta?.receipt_number || null
    const note = `Replacement for return ${returnNumber}${originalReceipt ? ` / receipt ${originalReceipt}` : ''}`
    const paymentDetails = subtotalUsd > 0 ? [{ method: replacementPaymentMethod, amount_usd: subtotalUsd, amount_khr: 0 }] : []
    statements.push({
      sql: `INSERT INTO sales(
        receipt_number,client_request_id,cashier_id,cashier_name,branch_id,branch_name,
        customer_id,customer_name,customer_phone,customer_address,payment_method,payment_details,
        payment_currency,exchange_rate,subtotal_usd,subtotal_khr,discount_usd,discount_khr,tax_usd,tax_khr,
        total_usd,total_khr,amount_paid_usd,amount_paid_khr,change_usd,change_khr,
        membership_discount_usd,membership_discount_khr,membership_points_redeemed,is_delivery,
        loyalty_accrual,sale_status,notes,items,search_normalized,source_return_id,creation_snapshot_json,updated_at
      ) VALUES(
        @receipt_number,@replacementClientRequestId,@cashier_id,@cashier_name,@branch_id,@branch_name,
        @customer_id,@customer_name,@customer_phone,@customer_address,@payment_method,@payment_details,
        'USD',@exchange_rate,@subtotal_usd,@subtotal_khr,0,0,0,0,@total_usd,@total_khr,@amount_paid_usd,
        @amount_paid_khr,0,0,0,0,0,0,1,'completed',@notes,@items,@search_normalized,
        ${returnIdExpression},@creation_snapshot_json,@occurredAt
      )`,
      params: {
        receipt_number: replacementReceiptNumber, replacementClientRequestId,
        cashier_id: authenticatedActorId, cashier_name: actorSnapshot(user), branch_id: branchId, branch_name: branchName,
        customer_id: replacementCustomerId,
        customer_name: replacementCustomerName,
        customer_phone: replacementCustomerPhone,
        customer_address: replacementCustomerAddress,
        payment_method: replacementPaymentMethod, payment_details: JSON.stringify(paymentDetails), exchange_rate: exchangeRate,
        subtotal_usd: subtotalUsd, subtotal_khr: replacementTotals.totalKhr,
        total_usd: replacementTotals.totalUsd, total_khr: replacementTotals.totalKhr,
        amount_paid_usd: replacementTotals.amountPaidUsd, amount_paid_khr: replacementTotals.amountPaidKhr,
        notes: note, occurredAt, creation_snapshot_json: replacementCreationSnapshot,
        items: JSON.stringify(replacementLines.map((line) => ({
          product_id: line.productId, product_name: line.productName, quantity: line.quantity,
          applied_price_usd: line.priceUsd, applied_price_khr: line.priceKhr,
          total_usd: line.totalUsd, total_khr: line.totalKhr, branch_id: line.branchId, batch_id: line.batchId,
        }))),
        search_normalized: normalizeSearchText([
          replacementReceiptNumber, returnNumber, originalReceipt, actorSnapshot(user),
          replacementCustomerName, branchName, ...replacementLines.map((line) => line.productName),
        ].filter(Boolean).join(' ')),
        returnClientRequestId: clientRequestId,
      },
    })
    statements.push({
      sql: `UPDATE returns SET replacement_sale_id=${replacementSaleExpression},updated_at=@occurredAt
            WHERE id=${returnIdExpression}`,
      params: { replacementClientRequestId, returnClientRequestId: clientRequestId, occurredAt },
    })
  }

  const touchedProducts = new Set<number>()
  let returnAllocationCount = 0
  let movementCount = 0
  for (const [index, item] of returnItems.entries()) {
    const quantity = Number(item.quantity)
    const productId = Number(item.product_id) || null
    const itemBranchId = Number(item.branch_id || branchId) || null
    const productName = item.product_name?.trim() || (productId ? productMap.get(productId)?.name : null) || null
    const stockAction = normalizeStockAction(item)
    const unitCostUsd = item.cost_price_usd == null ? null : Number(item.cost_price_usd)
    const unitCostKhr = item.cost_price_khr == null ? null : Number(item.cost_price_khr)
    const plan = returnLotPlans[index] || { splits: [], plainQuantity: 0 }
    const returnReceivedDate = new Date(Date.parse(occurredAt) + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const fallbackReceive = stockAction === 'restock' && !item.counted_original_condition && plan.plainQuantity > 0 && productId && itemBranchId ? planReceiveBatchStock({
      productId, branchId: itemBranchId, quantity: plan.plainQuantity, receivedDate: returnReceivedDate,
      provenanceKey: `return:${clientRequestId}:${index}`, notes: 'Received from customer return; original received date unavailable',
    }) : null
    const fallbackParams = fallbackReceive ? { returnBatchKey: fallbackReceive.batchKey } : {}
    const fallbackBatchSql = '(SELECT id FROM product_batches WHERE variant_product_id=@product_id AND batch_key=@returnBatchKey)'
    const recordedBatchSql = fallbackReceive && !plan.splits.length ? fallbackBatchSql : '@batch_id'
    if (stockAction === 'restock' && productId && itemBranchId) {
      for (const split of plan.splits) {
        const receive = planProjectedCountedReturnReceive(exactStock.get(productId,itemBranchId),split.batchId,split.quantity)
        statements.push(...receive.map((statement) => ({ sql: statement.sql, params: statement.params as Record<string, unknown> })))
      }
      if (fallbackReceive) {
        const exact = exactStock.get(productId,itemBranchId)
        const created = exact.receiveProjectedCreatedReceipt(fallbackReceive.batchKey, plan.plainQuantity)
        createdReceiptGuards.push(...created.guards)
        statements.push(...fallbackReceive.metadataStatements.map(statement => ({sql: statement.sql, params: statement.params as Record<string, unknown>})), ...created.statements)
      }
      if (!fallbackReceive && plan.plainQuantity > 0) statements.push(...planProjectedCountedReturnReceive(exactStock.get(productId,itemBranchId),null,plan.plainQuantity).map(statement=>({sql:statement.sql,params:statement.params as Record<string,unknown>})))
      touchedProducts.add(productId)
    }
    if (stockAction === 'damaged' && productId && itemBranchId) {
      // Already 400'd above (resolveDamagedReturnChoice) if this were invalid.
      const choice = resolveDamagedReturnChoice(item)
      if (choice.ok) {
        const slices = [...plan.splits.map(split=>({batchId:split.batchId,quantity:split.quantity})),...(plan.plainQuantity>0?[{batchId:null,quantity:plan.plainQuantity}]:[])]
        for (const slice of slices) {
          const damagedStatements = planDamagedReturnLine({
            projectedStock: exactStock.get(productId,itemBranchId),productId,productName,branchId:itemBranchId,batchId:slice.batchId,
            returnIdSql:returnIdExpression,quantity:slice.quantity,reason,
            userId:authenticatedActorId,userName:actorSnapshot(user),tag:choice.tag,disposition:choice.disposition,unitCostUsd,unitCostKhr,
          })
          statements.push(...damagedStatements.map(statement=>({sql:statement.sql,params:{...(statement.params as Record<string,unknown>),returnClientRequestId:clientRequestId}})))
          movementCount += choice.disposition === 'remove' ? 2 : 1
        }
        touchedProducts.add(productId)
      }
    }
    const splits = plan.splits
    const recordedBatchId = splits.length === 1 && splits[0].quantity === quantity ? splits[0].batchId : null
    const refund = refundPrices[index]
    const exactRefund = v1QuoteBySaleItem.get(Number(item.sale_item_id))
    statements.push({
      sql: `INSERT INTO return_items(return_id,sale_item_id,product_id,product_name,quantity,applied_price_usd,applied_price_khr,
        cost_price_usd,cost_price_khr,total_usd,total_khr,return_to_stock,stock_action,stock_condition,branch_id,batch_id,refund_snapshot_json)
        VALUES(${returnIdExpression},@sale_item_id,@product_id,@product_name,@quantity,@applied_price_usd,@applied_price_khr,
        @cost_price_usd,@cost_price_khr,@total_usd,@total_khr,@return_to_stock,@stock_action,@stock_condition,@branch_id,${recordedBatchSql},@refund_snapshot_json)`,
      params: {
        returnClientRequestId: clientRequestId, sale_item_id: item.sale_item_id || null, product_id: productId,
        product_name: productName, quantity, applied_price_usd: refund.unitUsd, applied_price_khr: refund.unitKhr,
        cost_price_usd: unitCostUsd, cost_price_khr: unitCostKhr,
        total_usd: exactRefund?.total_usd ?? Number((refund.unitUsd * quantity).toFixed(2)),
        total_khr: exactRefund?.total_khr ?? Math.round(refund.unitKhr * quantity),
        refund_snapshot_json: exactRefund?.refund_snapshot_json ?? null,
        return_to_stock: stockAction === 'restock' ? 1 : 0, stock_action: stockAction,stock_condition:item.stock_condition ?? null,
        branch_id: itemBranchId, batch_id: recordedBatchId, ...fallbackParams,
      },
    })
    for (const split of splits) {
      statements.push({
        sql: `INSERT INTO return_item_batch_allocations(return_item_id,sale_item_id,batch_id,branch_id,quantity)
          VALUES((SELECT id FROM return_items WHERE return_id=${returnIdExpression} ORDER BY id DESC LIMIT 1),
            @sale_item_id,@batch_id,@branch_id,@quantity)`,
        params: { returnClientRequestId: clientRequestId, sale_item_id: item.sale_item_id || null, batch_id: split.batchId, branch_id: itemBranchId, quantity: split.quantity },
      })
      returnAllocationCount += 1
    }
    if (fallbackReceive) {
      statements.push({
        sql: `INSERT INTO return_item_batch_allocations(return_item_id,sale_item_id,batch_id,branch_id,quantity)
          VALUES((SELECT id FROM return_items WHERE return_id=${returnIdExpression} ORDER BY id DESC LIMIT 1),
            @sale_item_id,${fallbackBatchSql},@branch_id,@quantity)`,
        params: { returnClientRequestId: clientRequestId, sale_item_id: item.sale_item_id || null,
          product_id: productId, branch_id: itemBranchId, quantity: plan.plainQuantity, ...fallbackParams },
      })
      returnAllocationCount += 1
    }
    if (stockAction === 'restock' && productId && itemBranchId) {
      // Stock that went to the successor of the branch the sale was made at: the movement names the branch it
      // really landed on and the label it was addressed to (the sale itself is never relabelled).
      const redirect = itemEffects[index]?.redirected ? itemEffects[index] : null
      statements.push({
        sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id${redirect ? ',branch_name,addressed_branch_name' : ''},movement_type,quantity,unit_cost_usd,unit_cost_khr,reason,reference_id,user_id,user_name,batch_id)
          VALUES(@product_id,@product_name,@branch_id${redirect ? ',@branch_name,@addressed_branch_name' : ''},'return',@quantity,@unit_cost_usd,@unit_cost_khr,@reason,${returnIdExpression},@user_id,@user_name,${recordedBatchSql})`,
        params: {
          returnClientRequestId: clientRequestId, product_id: productId, product_name: productName, branch_id: itemBranchId,
          ...(redirect ? { branch_name: redirect.effectName, addressed_branch_name: addressedLabel(redirect) } : {}),
          quantity, unit_cost_usd: unitCostUsd, unit_cost_khr: unitCostKhr,
          reason: `Return: ${reason}${redirect ? ` (sale at ${addressedLabel(redirect)})` : ''}`, user_id: authenticatedActorId, user_name: actorSnapshot(user), batch_id: recordedBatchId, ...fallbackParams,
        },
      })
      movementCount += 1
    }
  }

  let saleAllocationCount = 0
  for (const [index, line] of replacementLines.entries()) {
    const projected = exactStock.get(line.productId,line.branchId)
    if (line.tagged) {
      const source = projected.projectedTaggedSource(line.tagged.lotId)
      if (!source || source.batchId !== line.tagged.batchId || source.conditionTag !== line.tagged.conditionTag) throw new CountedStockConflictError()
    }
    if (line.batchId == null && !line.tagged && !line.unlottedStock) {
      const lots = projected.projectedReceiptSources().sort((a,b) => a.fifoRank-b.fifoRank)
      let remaining = line.quantity
      const takes: LotTake[] = []
      for (const lot of lots) {
        const quantity = Math.min(lot.available,remaining)
        if (quantity > 0) { takes.push({...lot,quantity}); remaining = subtractCountedQuantity(remaining,[quantity]) }
        if (remaining === 0) break
      }
      if (takes.length && remaining > 0) throw new CountedStockConflictError()
      replacementFifoTakes.set(index,takes)
    }
    const physicalTakes = [...(replacementFifoTakes.get(index) || []), ...(replacementExplicitTakes.get(index) || [])]
    const replacementPlan = planReplacementStock({
      projectedStock: projected, projectedTakes: line.batchId == null && !line.tagged && physicalTakes.length ? physicalTakes : undefined,
      ...line, returnIdSql: returnIdExpression, returnNumber,
      userId: authenticatedActorId, userName: actorSnapshot(user),
    })
    statements.push(...replacementPlan.statements.map((statement) => ({
      sql: statement.sql,
      params: { ...(statement.params as Record<string, unknown>), returnClientRequestId: clientRequestId },
    })))
    movementCount += 1
    const takes = [...(replacementFifoTakes.get(index) || []), ...(replacementExplicitTakes.get(index) || [])]
    const recordedBatchId = takes.length === 1 && takes[0].quantity === line.quantity ? takes[0].batchId : null
    statements.push({
      sql: `INSERT INTO sale_items(sale_id,product_id,product_name,quantity,applied_price_usd,applied_price_khr,
        cost_price_usd,cost_price_khr,total_usd,total_khr,branch_id,price_mode,base_price_usd,base_price_khr,batch_id,damaged_lot_id)
        VALUES(${replacementSaleExpression},@product_id,@product_name,@quantity,@applied_price_usd,@applied_price_khr,
        @cost_price_usd,@cost_price_khr,@total_usd,@total_khr,@branch_id,'selling',@base_price_usd,@base_price_khr,@batch_id,@damaged_lot_id)`,
      params: {
        replacementClientRequestId, product_id: line.productId, product_name: line.productName, quantity: line.quantity,
        applied_price_usd: line.priceUsd, applied_price_khr: line.priceKhr,
        cost_price_usd: line.unitCostUsd, cost_price_khr: line.unitCostKhr,
        total_usd: line.totalUsd, total_khr: line.totalKhr, branch_id: line.branchId,
        base_price_usd: line.priceUsd, base_price_khr: line.priceKhr, batch_id: recordedBatchId, damaged_lot_id:line.tagged?.lotId ?? null,
      },
    })
    statements.push({
      sql: `INSERT INTO return_replacement_items(return_id,sale_item_id,product_id,product_name,branch_id,batch_id,quantity,applied_price_usd,applied_price_khr,total_usd,total_khr)
        VALUES(${returnIdExpression},(SELECT id FROM sale_items WHERE sale_id=${replacementSaleExpression} ORDER BY id DESC LIMIT 1),
          @product_id,@product_name,@branch_id,@batch_id,@quantity,@applied_price_usd,@applied_price_khr,@total_usd,@total_khr)`,
      params: {
        returnClientRequestId: clientRequestId, replacementClientRequestId,
        product_id: line.productId, product_name: line.productName, branch_id: line.branchId, batch_id: line.batchId,
        quantity: line.quantity, applied_price_usd: line.priceUsd, applied_price_khr: line.priceKhr,
        total_usd: line.totalUsd, total_khr: line.totalKhr,
      },
    })
    for (const take of takes) {
      statements.push({
        sql: `INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,lot_code,expiry_date,released_quantity,released_at)
          VALUES((SELECT id FROM sale_items WHERE sale_id=${replacementSaleExpression} ORDER BY id DESC LIMIT 1),
            @batch_id,@branch_id,@quantity,@lot_code,@expiry_date,0,NULL)`,
        params: {
          replacementClientRequestId, batch_id: take.batchId, branch_id: line.branchId,
          quantity: take.quantity, lot_code: take.lotCode, expiry_date: take.expiryDate,
        },
      })
      saleAllocationCount += 1
    }
    touchedProducts.add(line.productId)
  }
  const finalPhysical = exactStock.takeFinalPhysicalWrites()
  statements.push(...finalPhysical)
  statements.unshift(...createdReceiptGuards)
  const physicalTargets = exactStock.projectedPhysicalTargets()
  branchSnapshots = physicalTargets.flatMap(target => target.branches)
  batchSnapshots = physicalTargets.flatMap(target => target.receipts)
  productSnapshots = physicalTargets.map(target => target.product)

  let eventBytes = 0
  if (saleMeta && projectedStatus && projectedStatus !== beforeSaleStatus) {
    statements.push({
      sql: `UPDATE sales SET status_before_return=CASE
        WHEN COALESCE(sale_status,'completed') NOT IN ('returned','partial_return') THEN COALESCE(sale_status,'completed')
        ELSE status_before_return END,sale_status=@status,updated_at=@occurredAt WHERE id=@saleId`,
      params: { status: projectedStatus, occurredAt, saleId: requestedSaleId },
    })
    const event = buildSaleRecordEventsInsert([{
      saleId: requestedSaleId!, sourceKind: 'return_create', sourceId: receiptId,
      generation: 0, kind: 'status_changed', via: 'apply', subject: returnNumber,
      actorId: authenticatedActorId, actorUsername: actorSnapshot(user), occurredAt,
      changes: [{
        field: 'sale_status', before: { state: 'known_value', value: beforeSaleStatus! },
        after: { state: 'known_value', value: projectedStatus },
      }],
    }])!
    statements.push(event.statement)
    eventBytes = event.eventsBytes
  }
  const auditDetails = JSON.stringify({
    source_kind: 'return_create', source_id: receiptId, generation: 0,
    sale_id: requestedSaleId, return_number: returnNumber,
    return_items: returnItems.length, replacement_items: replacementLines.length,
    event_recorded: eventBytes > 0,
    ...(addressedBranchName ? { branch_id: branchId, addressed_branch_id: headerEffect!.addressedBranchId, addressed_branch_name: addressedBranchName } : {}),
  })
  statements.push({
    sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value)
      VALUES(@userId,@userName,'create','return_create',@receiptId,@details,'returns',${returnIdExpression},@details)`,
    params: { userId: authenticatedActorId, userName: actorSnapshot(user), receiptId, details: auditDetails, returnClientRequestId: clientRequestId },
  })
  const receiptResultIndex = statements.length
  statements.push({
    sql: `INSERT INTO return_create_receipts(
      id,actor_id,return_id,sale_id,request_id,request_digest,request_json,response_json,occurred_at
    ) VALUES(
      @receiptId,@actorId,${returnIdExpression},@saleId,@requestId,@requestDigest,@requestJson,
      json_object('id',${returnIdExpression},'returnNumber',@returnNumber,
        'replacementSaleId',${replacementLines.length ? replacementSaleExpression : 'NULL'},
        'replacementReceiptNumber',@replacementReceiptNumber),@occurredAt
    ) RETURNING return_id,sale_id,request_digest,response_json`,
    params: {
      receiptId, actorId: authenticatedActorId, returnClientRequestId: clientRequestId,
      replacementClientRequestId, saleId: requestedSaleId, requestId: clientRequestId,
      requestDigest, requestJson, returnNumber, replacementReceiptNumber, occurredAt,
    },
  })

  const expected = {
    return_items: returnItems.length, return_allocations: returnAllocationCount,
    replacement_items: replacementLines.length, sale_allocations: saleAllocationCount,
    movements: movementCount, event: eventBytes > 0 ? 1 : 0,
    status: projectedStatus, branch_stock: branchSnapshots, batch_stock: batchSnapshots, product_stock: productSnapshots,
    v1_header: customerReturnV1Plan ? {
      money_precision_version: 1,
      calculated_refund_usd: customerReturnV1Plan.quote.calculated_refund_usd,
      rounding_adjustment_usd: customerReturnV1Plan.quote.rounding_adjustment_usd,
      total_refund_usd: customerReturnV1Plan.quote.total_refund_usd,
      total_refund_khr: customerReturnV1Plan.quote.total_refund_khr,
    } : null,
    v1_items: customerReturnV1Plan?.quote.items.map(item => ({ sale_item_id: item.sale_item_id,
      quantity: item.quantity, applied_price_usd: item.applied_price_usd, applied_price_khr: item.applied_price_khr,
      total_usd: item.total_usd, total_khr: item.total_khr, refund_snapshot_json: item.refund_snapshot_json })) || [],
  }
  const expectedJson = JSON.stringify(expected)
  const postcondition = `
    EXISTS(SELECT 1 FROM return_create_receipts WHERE id=@receiptId AND actor_id=@actorId
      AND request_id=@requestId AND request_digest=@requestDigest)
    AND (SELECT COUNT(*) FROM return_items WHERE return_id=${returnIdExpression})=json_extract(@expectedJson,'$.return_items')
    AND (SELECT COUNT(*) FROM return_item_batch_allocations WHERE return_item_id IN(
      SELECT id FROM return_items WHERE return_id=${returnIdExpression}))=json_extract(@expectedJson,'$.return_allocations')
    AND (SELECT COUNT(*) FROM return_replacement_items WHERE return_id=${returnIdExpression})=json_extract(@expectedJson,'$.replacement_items')
    AND (SELECT COUNT(*) FROM sale_item_batch_allocations WHERE sale_item_id IN(
      SELECT id FROM sale_items WHERE sale_id=${replacementLines.length ? replacementSaleExpression : 'NULL'}))=json_extract(@expectedJson,'$.sale_allocations')
    AND (SELECT COUNT(*) FROM inventory_movements WHERE reference_id=${returnIdExpression}
      AND movement_type IN ('return','${DAMAGE_IN_MOVEMENT}','${REPLACEMENT_OUT_MOVEMENT}','${TAGGED_DISPOSAL_MOVEMENT_TYPE}'))=json_extract(@expectedJson,'$.movements')
    AND (SELECT COUNT(*) FROM sale_record_events WHERE source_kind='return_create' AND source_id=@receiptId
      AND generation=0)=json_extract(@expectedJson,'$.event')
    AND EXISTS(SELECT 1 FROM audit_logs WHERE entity='return_create' AND entity_id=@receiptId)
    AND (json_type(@expectedJson,'$.v1_header')='null' OR EXISTS(SELECT 1 FROM returns r
      WHERE r.id=${returnIdExpression}
        AND r.money_precision_version=json_extract(@expectedJson,'$.v1_header.money_precision_version')
        AND r.calculated_refund_usd=json_extract(@expectedJson,'$.v1_header.calculated_refund_usd')
        AND r.rounding_adjustment_usd=json_extract(@expectedJson,'$.v1_header.rounding_adjustment_usd')
        AND r.total_refund_usd=json_extract(@expectedJson,'$.v1_header.total_refund_usd')
        AND r.total_refund_khr=json_extract(@expectedJson,'$.v1_header.total_refund_khr')))
    AND NOT EXISTS(SELECT 1 FROM json_each(@expectedJson,'$.v1_items') j WHERE NOT EXISTS(
      SELECT 1 FROM return_items ri WHERE ri.return_id=${returnIdExpression}
        AND ri.sale_item_id=json_extract(j.value,'$.sale_item_id') AND ri.quantity=json_extract(j.value,'$.quantity')
        AND ri.applied_price_usd=json_extract(j.value,'$.applied_price_usd')
        AND ri.applied_price_khr=json_extract(j.value,'$.applied_price_khr')
        AND ri.total_usd=json_extract(j.value,'$.total_usd') AND ri.total_khr=json_extract(j.value,'$.total_khr')
        AND ri.refund_snapshot_json=json_extract(j.value,'$.refund_snapshot_json')))
    AND (json_type(@expectedJson,'$.status')='null' OR COALESCE((SELECT sale_status FROM sales WHERE id=@saleId),'completed')=json_extract(@expectedJson,'$.status'))
    AND NOT EXISTS(SELECT 1 FROM json_each(@expectedJson,'$.branch_stock') j
      WHERE COALESCE((SELECT quantity FROM branch_stock WHERE product_id=json_extract(j.value,'$.product_id')
        AND branch_id=json_extract(j.value,'$.branch_id')),0)!=json_extract(j.value,'$.after'))
    AND NOT EXISTS(SELECT 1 FROM json_each(@expectedJson,'$.batch_stock') j
      WHERE COALESCE((SELECT quantity FROM branch_batch_stock WHERE batch_id=COALESCE(json_extract(j.value,'$.batch_id'),
        (SELECT id FROM product_batches WHERE variant_product_id=json_extract(j.value,'$.product_id') AND batch_key=json_extract(j.value,'$.batch_key')))
        AND branch_id=json_extract(j.value,'$.branch_id')),0)!=json_extract(j.value,'$.after'))
    AND NOT EXISTS(SELECT 1 FROM json_each(@expectedJson,'$.product_stock') j
      WHERE (SELECT stock_quantity FROM products WHERE id=json_extract(j.value,'$.product_id')) IS NOT json_extract(j.value,'$.after'))
  `
  statements.push({
    sql: `DELETE FROM return_create_guards WHERE operation_id=@operationId
      AND CASE WHEN (${postcondition}) THEN 1 ELSE json_extract('[1]','$[return_create_postcondition_conflict]') END=1`,
    params: { ...commonGuardParams, expectedJson, saleId: requestedSaleId, returnClientRequestId: clientRequestId, operationId },
  })

  const hasStockWrite = touchedProducts.size > 0 || returnItems.some(item => normalizeStockAction(item) === 'damaged')
  const transactionStatementCount = hasStockWrite ? stockTransactionStatementCount(statements.length) : statements.length + 1
  try {
    assertReturnCreatePlanBounds(statements, canonicalIntent, eventBytes)
    // Cold cache fallback including quota and retries (six), notification reads including
    // retries (six). The successful atomic batch returns its durable receipt.
    assertReturnCreateQueryBudget(queryLimit, statementsUsed(), transactionStatementCount, 12 + (replacementNotice ? 2 : 0))
  } catch (error) {
    if (error instanceof ReturnCreateBudgetError) throw error
    const stockGuard = productStockGuardError(error)
    if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
    return c.json({ error: (error as Error).message, code: 'return_too_large' }, 400)
  }
  let committed: Pick<NonNullable<Awaited<ReturnType<typeof readReceipt>>>,
    'return_id' | 'sale_id' | 'request_digest' | 'response_json'> | undefined
  try {
    routeStatements += transactionStatementCount
    if (!db.batchOnce) throw new Error('Customer returns require single-attempt atomic writes')
    const results = hasStockWrite ? await executeStockTransaction(db, statements, 'once')
      : (await db.batchOnce([...statements, ordinaryBusinessMaintenanceGuard])).slice(0, -1)
    if (results.length === statements.length) {
      committed = results[receiptResultIndex]?.results?.[0] as typeof committed
    }
  } catch (error) {
    const stockGuard = productStockGuardError(error)
    if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
    try {
      const receipt = await readReceipt()
      if (receipt) {
        if (receipt.request_digest === requestDigest && (receipt.sale_id ?? null) === requestedSaleId) {
          return c.json(JSON.parse(receipt.response_json) as ReturnCreateResponse)
        }
        return c.json({ error: 'client_request_id was already used for different return data.', code: 'idempotency_conflict' }, 409)
      }
      const transactionRefusal = stockTransactionRefusal(error)
      if (transactionRefusal) return c.json(transactionRefusal, 503)
      if (isCountedStockConflict(error) || /return_create_(?:precondition|postcondition)_conflict|return_create_guards|CHECK constraint failed: guard_value|merge_physical_origin_conflict/.test(error instanceof Error ? error.message : String(error))) {
        return c.json({ error: 'The sale or stock changed while this return was being recorded. Reload and try again.', code: 'write_conflict', action: 'reload_required' }, 409)
      }
      return c.json({ error: 'The result could not be confirmed. Keep this return open and retry the same request.', code: 'unknown_outcome', action: 'retry_same_request' }, 503)
    } catch (_) {
      return c.json({
        error: 'The result could not be confirmed. Keep this return open and retry the same request.',
        code: 'unknown_outcome', action: 'retry_same_request',
      }, 503)
    }
  }

  if (!committed || committed.request_digest !== requestDigest
    || (committed.sale_id ?? null) !== requestedSaleId
    || !Number.isSafeInteger(committed.return_id) || committed.return_id <= 0
    || typeof committed.response_json !== 'string') {
    return c.json({ error: 'The result could not be confirmed. Retry the same request.', code: 'unknown_outcome', action: 'retry_same_request' }, 503)
  }
  const response = JSON.parse(committed.response_json) as ReturnCreateResponse
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'return', id: response.id }))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
  c.executionCtx.waitUntil(bumpVersions(c.env, ['products', 'returns', 'sales']))
  c.executionCtx.waitUntil(broadcast(c.env, 'returns', { action: 'create', id: response.id }))
  c.executionCtx.waitUntil(sendReturnTelegramEvent(c.env, response.id, {
    kind: 'customer', returnNumber, receiptNumber: body.receipt_number || saleMeta?.receipt_number || null,
    party: body.customer_name || saleMeta?.customer_name || null, branch: branchName, reason,
    returnType: String(canonicalIntent.return_type), refundUsd: totalRefundUsd, refundKhr: totalRefundKhr,
    by: actorSnapshot(user),
  }).catch((error) => console.error('[telegram] return notification failed', error)))
  if (replacementNotice) c.executionCtx.waitUntil(sendTelegramEvent(c.env, {
    type: 'sales', lines: formatSaleTelegramLines(replacementNotice),
  }).catch((error) => console.error('[telegram] replacement sale notification failed', error)))
  c.executionCtx.waitUntil(broadcast(c.env, 'sales', { action: 'update', id: requestedSaleId }))
  return c.json(response)
}

// POST /api/returns/supplier -- "process" a supplier return: pull stock out
// (it's leaving via the supplier, not going back on the shelf) and record
// how the supplier is settling it (refund / credit / replacement / writeoff),
// tracking any shortfall as supplier_loss_usd/khr.
app.post('/supplier', async (c) => {
  try { return await createSupplierReturn(c) } catch (error) {
    if (error instanceof ReturnCreateBudgetError) return c.json({ error: error.message, code: 'supplier_return_over_plan_budget', outcome: 'not_dispatched' }, 400)
    if (isCountedStockConflict(error)) return c.json({ error: 'Stock or its recorded source changed. Refresh before retrying.', code: 'write_conflict', action: 'reload_required' }, 409)
    throw error
  }
})

function completeSupplierReturnViews(c: Context<{ Bindings: Env; Variables: { user: SessionUser } }>, returnId: number) {
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'supplier_return', id: returnId }))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
  c.executionCtx.waitUntil(bumpVersions(c.env, ['products', 'returns', 'sales']))
  c.executionCtx.waitUntil(broadcast(c.env, 'returns', { action: 'create', id: returnId }))
}

async function createSupplierReturn(c: Context<{ Bindings: Env; Variables: { user: SessionUser } }>) {
  const user = c.get('user')
  if (!canEditAcquisitionCosts(user)) return c.json({ error: 'Cost-entry permission is required to record supplier return costs and settlement.', code: 'product_cost_edit_required' }, 403)
  if (!canViewAcquisitionCosts(user)) return c.json({ error: 'Cost-view permission is required to review supplier return compensation and settlement.', code: 'product_cost_view_required' }, 403)
  const baseDb = getDb(c.env)
  const queryLimit = getPlanLimits(c.env).d1QueriesPerInvocation
  let routeStatements = 0
  const requestMetrics = (c as unknown as { get(key: string): unknown }).get('requestMetrics') as (RequestMetrics & { attemptedStatements?: number }) | undefined
  const initialStatements = requestMetrics?.attemptedStatements ?? requestMetrics?.statements ?? 0
  const statementsUsed = () => requestMetrics
    ? Math.max(initialStatements + routeStatements, requestMetrics.attemptedStatements ?? (requestMetrics.failed ? Infinity : requestMetrics.statements)) + 3
    : routeStatements + 10
  const db = Object.create(baseDb) as ReturnType<typeof getDb>
  db.prepare = ((sql: string) => {
    const statement = baseDb.prepare(sql)
    const countRead = () => { assertReturnCreateQueryBudget(queryLimit, statementsUsed(), 1, 1); routeStatements += 1 }
    return {
      get: async (params) => { countRead(); if (!statement.getOnce) throw new Error('Supplier returns require single-attempt reads'); return statement.getOnce(params) },
      all: async (params) => { countRead(); if (!statement.allOnce) throw new Error('Supplier returns require single-attempt reads'); return statement.allOnce(params) },
      run: async (params) => { countRead(); return statement.run(params) },
    }
  }) as typeof db.prepare
  // Per-action override (Part 546): supplier returns are the same 'add'
  // action as customer returns -- one switch covers both create routes.
  if (getActionTier(user, 'returns', 'add') === 'none') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const body = await c.req.json<{
    items: Array<{ product_id: number; product_name?: string; quantity: number; cost_price_usd?: number; cost_price_khr?: number; unit_cost_usd?: number; unit_cost_khr?: number; branch_id?: number; stock_condition?: string; damaged_lot_id?: number }>
    branch_id?: number
    reason?: string
    notes?: string
    supplier_id?: number
    supplier_name?: string
    settlement?: string
    supplier_compensation_usd?: number
    supplier_compensation_khr?: number
    exchange_rate?: number
    return_number?: string
    client_request_id?: string
  }>()

  const clientRequestId = normalizeClientRequestId(body.client_request_id)
  if (!Array.isArray(body.items) || body.items.length === 0) return c.json({ error: 'Return items required' }, 400)
  if (!body.reason) return c.json({ error: 'Reason is required' }, 400)
  if (body.items.length > 50 || new TextEncoder().encode(JSON.stringify(body)).byteLength > RETURN_CREATE_REQUEST_BYTES) throw new ReturnCreateBudgetError()
  const conditionFields = ['condition_tag','stock_action']
  if (conditionFields.some(key => Object.hasOwn(body, key)) || body.items.some(item => conditionFields.some(key => Object.hasOwn(item, key)))) {
    return c.json({ error: 'Choose ordinary stock for this supplier return. A recorded condition requires an explicit supported source choice.', code: 'supplier_return_condition_selection_required' }, 400)
  }

  for(const item of body.items){
    const chosen=item.stock_condition??'ordinary'
    const tag=parseStockConditionTag(chosen==='ordinary'?null:chosen)
    if(!tag.ok || (chosen==='ordinary' ? item.damaged_lot_id!=null : !tag.tag || !Number.isSafeInteger(item.damaged_lot_id) || Number(item.damaged_lot_id)<=0)) {
      return c.json({error:'Choose ordinary stock or an exact lot with its recorded condition.',code:'supplier_return_condition_selection_required'},400)
    }
  }
  const supplierIntent={branch_id:body.branch_id??null,reason:body.reason,notes:body.notes??null,supplier_id:body.supplier_id??null,
    supplier_name:body.supplier_name??null,settlement:body.settlement??'refund',supplier_compensation_usd:body.supplier_compensation_usd??null,
    supplier_compensation_khr:body.supplier_compensation_khr??null,exchange_rate:body.exchange_rate??null,return_number:body.return_number??null,
    items:body.items.map(item=>({product_id:item.product_id,branch_id:item.branch_id??body.branch_id??null,product_name:item.product_name??null,
      quantity:item.quantity,cost_price_usd:item.cost_price_usd??item.unit_cost_usd??0,cost_price_khr:item.cost_price_khr??item.unit_cost_khr??0,
      stock_condition:item.stock_condition??'ordinary',damaged_lot_id:item.damaged_lot_id??null}))}
  const completeReplay = (existing: { id: number; return_number: string; return_scope: string; return_type: string; request_json: string | null; request_digest: string | null }) => {
    if (!Number.isSafeInteger(existing.id) || existing.id <= 0 || !existing.return_number
      || existing.return_scope !== SUPPLIER_SCOPE || existing.return_type !== 'supplier_return') {
      return c.json({ error: 'This request key belongs to a different return.', code: 'supplier_return_request_conflict' }, 409)
    }
    if(existing.request_json){
      try {
        const saved=JSON.parse(existing.request_json) as SupplierReturnManifest
        if(saved.scope!=='supplier' || JSON.stringify(saved.intent)!==JSON.stringify(supplierIntent)) return c.json({error:'Request id was already used with different supplier return data.',code:'idempotency_conflict'},409)
      }catch(_){return c.json({error:'The saved supplier return source could not be confirmed.',code:'supplier_return_outcome_unknown',action:'retry_same_request'},503)}
    }
    try {
      // Recovery only refreshes views: cache lookup, quota admission and D1 fallback, each with at most two attempts.
      assertReturnCreateQueryBudget(queryLimit, statementsUsed(), 0, 6)
    } catch (error) {
      if (!(error instanceof ReturnCreateBudgetError)) throw error
      return c.json({ error: 'The supplier return is recorded, but its views could not be refreshed within this request. Retry the same request.',
        code: 'supplier_return_refresh_over_plan_budget', outcome: 'committed', action: 'retry_same_request',
        id: existing.id, returnNumber: existing.return_number, duplicate: true }, 503)
    }
    completeSupplierReturnViews(c, existing.id)
    return c.json({ id: existing.id, returnNumber: existing.return_number, duplicate: true })
  }

  if (clientRequestId) {
    const existing = await db.prepare("SELECT r.id, r.return_number, r.return_scope, r.return_type, cr.request_json, cr.request_digest FROM returns r LEFT JOIN return_create_receipts cr ON cr.return_id=r.id WHERE client_request_id = ? AND client_request_id <> '' LIMIT 1").get<{ id: number; return_number: string; return_scope: string; return_type: string; request_json: string | null; request_digest: string | null }>([clientRequestId])
    if (existing) return completeReplay(existing)
  }

  const settlement = ['refund', 'credit', 'replacement', 'writeoff'].includes(String(body.settlement || '').toLowerCase())
    ? String(body.settlement).toLowerCase()
    : 'refund'

  // A supplier return addressed to a branch that has since been retired (Old Shop -> LC Store, a till or a
  // client that still holds the old id) takes its units out of the ACTIVE branch the operator confirmed
  // (X-Branch-Redirect; branch_redirect_required until then) and records both the branch the stock really left
  // and the label it was addressed to. While every branch is active nothing is redirected and nothing changes.
  const supplierResolver = new BranchEffectResolver(await readBranchDirectory(db), branchRedirectTarget(c))
  const supplierLandingEffects = new Map<number, BranchEffect>()
  let supplierAddressedName: string | null = null
  try {
    const headerEffect = body.branch_id ? supplierResolver.effect(body.branch_id) : null
    if (headerEffect?.redirected) { supplierAddressedName = headerEffect.addressedName; body.branch_id = headerEffect.effectBranchId; supplierLandingEffects.set(headerEffect.effectBranchId, headerEffect) }
    body.items = body.items.map((item) => {
      const recorded = Number(item.branch_id || body.branch_id) || null
      const effect = recorded ? supplierResolver.effect(recorded) : null
      if (!effect?.redirected) return item
      supplierLandingEffects.set(effect.effectBranchId, effect)
      return { ...item, branch_id: effect.effectBranchId }
    })
  } catch (error) {
    const stockGuard = productStockGuardError(error)
    if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
    const refusal = branchEffectRefusal(error)
    if (refusal) return c.json(refusal, 409)
    throw error
  }

  // Validate the ordinary lines before capturing their stock sources.
  for (const item of body.items) {
    const qty = toNumber(item.quantity, 0)
    if (!qty || qty <= 0) return c.json({ error: 'Return quantity must be greater than zero' }, 400)
    if (!item.product_id) return c.json({ error: 'Product is required for supplier return' }, 400)
    const branchId = item.branch_id || body.branch_id || null
    if (!branchId) return c.json({ error: 'Branch is required for supplier return' }, 400)
  }

  let totalCostUsd = 0
  let totalCostKhr = 0
  for (const item of body.items) {
    const qty = toNumber(item.quantity, 0)
    totalCostUsd += qty * toNumber(item.cost_price_usd ?? item.unit_cost_usd, 0)
    totalCostKhr += qty * toNumber(item.cost_price_khr ?? item.unit_cost_khr, 0)
  }
  const defaultCompensationUsd = ['refund', 'credit'].includes(settlement) ? totalCostUsd : 0
  const defaultCompensationKhr = ['refund', 'credit'].includes(settlement) ? totalCostKhr : 0
  const supplierCompensationUsd = toNumber(body.supplier_compensation_usd, defaultCompensationUsd)
  const supplierCompensationKhr = toNumber(body.supplier_compensation_khr, defaultCompensationKhr)
  const supplierLossUsd = Math.max(0, Number((totalCostUsd - supplierCompensationUsd).toFixed(2)))
  const supplierLossKhr = Math.max(0, Math.round(totalCostKhr - supplierCompensationKhr))

  // SRET-YYYYMMDD-HHMMSS, same convention as the customer-return path above.
  const returnNumber = body.return_number?.trim() || await uniqueBusinessDateTimeNumber(
    'SRET',
    async (candidate) => !!(await db.prepare('SELECT 1 AS hit FROM returns WHERE return_number = ? LIMIT 1').get([candidate])),
  )
  const branchName = body.branch_id
    ? (await db.prepare('SELECT name FROM branches WHERE id = ?').get<{ name: string }>([body.branch_id]))?.name || null
    : null

  // A server key also covers legacy callers without an idempotency key, so
  // every child can resolve the header within one atomic D1 batch.
  const supplierWriteKey = clientRequestId || `supplier-return:${crypto.randomUUID()}`
  const returnIdExpression = '(SELECT id FROM returns WHERE client_request_id=@supplier_write_key)'
  const returnHeaderStatement = { sql: `
    INSERT INTO returns (
      return_number, client_request_id, cashier_id, cashier_name, branch_id, branch_name,
      return_scope, reason, return_type, notes, total_refund_usd, total_refund_khr, exchange_rate,
      supplier_id, supplier_name, supplier_settlement, supplier_compensation_usd, supplier_compensation_khr,
      supplier_loss_usd, supplier_loss_khr, status, search_normalized${supplierAddressedName ? ', addressed_branch_name' : ''}
    ) VALUES (@return_number, @client_request_id, @cashier_id, @cashier_name, @branch_id, @branch_name,
      @return_scope, @reason, 'supplier_return', @notes, 0, 0, @exchange_rate,
      @supplier_id, @supplier_name, @settlement, @supplier_compensation_usd, @supplier_compensation_khr,
      @supplier_loss_usd, @supplier_loss_khr, 'completed', @search_normalized${supplierAddressedName ? ', @addressed_branch_name' : ''})
  `, params: {
    ...(supplierAddressedName ? { addressed_branch_name: supplierAddressedName } : {}),
    return_number: returnNumber,
    client_request_id: supplierWriteKey,
    cashier_id: user?.id ?? null,
    cashier_name: actorSnapshot(user),
    branch_id: body.branch_id || null,
    branch_name: branchName,
    return_scope: SUPPLIER_SCOPE,
    reason: body.reason,
    notes: body.notes || null,
    // A supplier return is a new record: the rate it was made with, else the
    // live setting at the time of the return.
    exchange_rate: positiveRate(body.exchange_rate) ?? await liveExchangeRate(db),
    supplier_id: body.supplier_id || null,
    supplier_name: body.supplier_name || null,
    settlement,
    // Write-time diacritic fold of this supplier return's own searchable text
    // fields (migration 0082), read additively by the returns search builder.
    search_normalized: normalizeSearchText(
      [returnNumber, actorSnapshot(user), branchName, body.reason, 'supplier_return', body.notes, body.supplier_name, settlement]
        .filter(Boolean)
        .join(' '),
    ),
    supplier_compensation_usd: supplierCompensationUsd,
    supplier_compensation_khr: supplierCompensationKhr,
    supplier_loss_usd: supplierLossUsd,
    supplier_loss_khr: supplierLossKhr,
  } }

  const contexts = new Map<string, CountedReturnContext>()
  for (const item of body.items) addCountedReturnContext(contexts, Number(item.product_id), Number(item.branch_id || body.branch_id))
  const pairs = JSON.stringify([...contexts.values()])
  const captured = await db.prepare(`SELECT json_extract(j.value,'$.branchId') AS branchId,
    (SELECT name FROM products WHERE id=json_extract(j.value,'$.productId')) AS productName,
    ${countedStockFactsSql("json_extract(j.value,'$.productId')", "json_extract(j.value,'$.branchId')")} AS facts
    FROM json_each(@pairs) j`).all<{ branchId: number; productName: string; facts: string }>({ pairs })
  if (new TextEncoder().encode(captured.map(row => row.facts).join('')).byteLength > RETURN_CREATE_REQUEST_BYTES) throw new ReturnCreateBudgetError()
  const exact = new CountedStockBatchPlan(captured, { deferPhysicalWrites: true })
  const productNameMap = new Map(captured.map(row => [Number(JSON.parse(row.facts).product[0]), row.productName]))

  const sources: SupplierReturnSource[]=[]
  const originalTags=new Map(captured.map(row=>[`${JSON.parse(row.facts).product[0]}:${row.branchId}`,JSON.parse(row.facts).tags as unknown[][]]))
  let returnId = 0
  let dispatched = false
  try {
    const supplierEffectGuard = effectGuardStatement(supplierResolver.guards())
    const statements: Array<{ sql: string; params: Record<string, unknown> }> = [
      ...exact.takePreimageGuards(),
      { sql: `SELECT CASE WHEN (${stockActorPredicate}) AND NOT EXISTS(SELECT 1 FROM returns WHERE client_request_id=@supplier_write_key)
        THEN 1 ELSE json_extract('[1]','$[counted_quantity_conflict]') END`, params: { ...stockActorParams(user), supplier_write_key: supplierWriteKey } },
      ...(supplierEffectGuard ? [supplierEffectGuard, { sql: 'DELETE FROM sale_bulk_guards', params: {} }] : []), returnHeaderStatement,
      buildAuditStatement(user?.id ?? null, actorSnapshot(user), 'create', 'supplier_return', null,
        { returnNumber, settlement, supplierName: body.supplier_name || null, supplierLossUsd }, undefined, { entityIdFromLastInsert: true })]
    const supplierPerItemBatchSplits: ReturnBatchSplit[][] = []
    for (const [itemIndex,item] of body.items.entries()) {
      const qty = toNumber(item.quantity, 0)
      const unitCostUsd = toNumber(item.cost_price_usd ?? item.unit_cost_usd, 0)
      const unitCostKhr = toNumber(item.cost_price_khr ?? item.unit_cost_khr, 0)
      const totalUsd = Number((qty * unitCostUsd).toFixed(2))
      const totalKhr = Math.round(qty * unitCostKhr)
      const itemBranchId = item.branch_id || body.branch_id || null
      const safeProductName = item.product_name?.trim() || productNameMap.get(Number(item.product_id)) || `product #${item.product_id}`

      statements.push({
        sql: `INSERT INTO return_items (return_id, sale_item_id, product_id, product_name, quantity, applied_price_usd, applied_price_khr, cost_price_usd, cost_price_khr, total_usd, total_khr, return_to_stock, branch_id, stock_condition,stock_action)
              VALUES (${returnIdExpression}, NULL, @product_id, @product_name, @quantity, @unit_cost_usd, @unit_cost_khr, @unit_cost_usd, @unit_cost_khr, @total_usd, @total_khr, 0, @branch_id,@stock_condition,'none')`,
        params: {
          supplier_write_key: supplierWriteKey,
          stock_condition:item.stock_condition??'ordinary',
          product_id: item.product_id,
          product_name: safeProductName,
          quantity: qty,
          unit_cost_usd: unitCostUsd,
          unit_cost_khr: unitCostKhr,
          total_usd: totalUsd,
          total_khr: totalKhr,
          branch_id: itemBranchId,
        },
      })
      const projected = exact.get(Number(item.product_id), Number(itemBranchId))
      const supplierReturnTakes: Array<{ batchId: number; quantity: number }> = []
      const sourceBase={itemIndex,productId:Number(item.product_id),branchId:Number(itemBranchId),quantity:qty,costUsd:unitCostUsd,costKhr:unitCostKhr}
      let remaining = qty
      if(item.damaged_lot_id){
        const source=projected.projectedTaggedSource(item.damaged_lot_id)
        if(!source || source.conditionTag!==item.stock_condition)throw new CountedStockConflictError()
        const tag=originalTags.get(`${item.product_id}:${itemBranchId}`)?.find(row=>row[0]===item.damaged_lot_id)
        if(!tag)throw new CountedStockConflictError()
        statements.push(...planExactCountedTaggedChange(projected,source,qty,'consume'))
        sources.push({...sourceBase,batchId:source.batchId,lotId:source.lotId,condition:source.conditionTag,
          lotIdentity:[tag[1],tag[2],tag[4],tag[5],tag[6],tag[7],tag[8],tag[9]]})
        if(source.batchId!==null)supplierReturnTakes.push({batchId:source.batchId,quantity:qty})
        remaining=0
      }
      for (const receipt of projected.projectedReceiptSources().sort((left, right) => left.fifoRank - right.fifoRank)) {
        const take = Math.min(remaining, receipt.available)
        if (take <= 0) continue
        statements.push(...planExactCountedOrdinaryChange(projected, receipt.batchId, take, 'consume'))
        supplierReturnTakes.push({ batchId: receipt.batchId, quantity: take })
        sources.push({...sourceBase,quantity:take,batchId:receipt.batchId,lotId:null,condition:'ordinary',lotIdentity:null})
        remaining = subtractCountedQuantity(remaining, [take])
        if (remaining === 0) break
      }
      if (remaining > 0) {
        statements.push(...planExactCountedOrdinaryChange(projected, null, remaining, 'consume'))
        sources.push({...sourceBase,quantity:remaining,batchId:null,lotId:null,condition:'ordinary',lotIdentity:null})
      }
      supplierPerItemBatchSplits.push(supplierReturnTakes.map((take) => ({
        batchId: take.batchId,
        branchId: itemBranchId,
        quantity: take.quantity,
        saleItemId: null,
      })))
      const supplierLanding = itemBranchId ? supplierLandingEffects.get(Number(itemBranchId)) : undefined
      statements.push({
        sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id${supplierLanding ? ', branch_name, addressed_branch_name' : ''}, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name, batch_id)
              VALUES (@product_id, @product_name, @branch_id${supplierLanding ? ', @branch_name, @addressed_branch_name' : ''}, 'supplier_return', @quantity, @unit_cost_usd, @unit_cost_khr, @reason, ${returnIdExpression}, @user_id, @user_name, @batch_id)`,
        params: {
          product_id: item.product_id,
          product_name: safeProductName,
          branch_id: itemBranchId,
          ...(supplierLanding ? { branch_name: supplierLanding.effectName, addressed_branch_name: supplierLanding.addressedName } : {}),
          quantity: -qty,
          unit_cost_usd: unitCostUsd,
          unit_cost_khr: unitCostKhr,
          reason: `Supplier return (${settlement}): ${body.reason}`,
          supplier_write_key: supplierWriteKey,
          user_id: user?.id ?? null,
          user_name: actorSnapshot(user),
          // 0084: attributable only when one lot covered the whole deduction.
          batch_id: supplierReturnTakes.length === 1 && supplierReturnTakes[0].quantity === qty ? supplierReturnTakes[0].batchId : null,
        },
      })
    }
    for (const [itemIndex, splits] of supplierPerItemBatchSplits.entries()) {
      for (const split of splits) {
        statements.push({
          sql: `INSERT INTO return_item_batch_allocations (return_item_id, sale_item_id, batch_id, branch_id, quantity)
                SELECT id, NULL, @batch_id, @branch_id, @quantity
                FROM return_items WHERE return_id = ${returnIdExpression} ORDER BY id ASC LIMIT 1 OFFSET @item_index`,
          params: {
            supplier_write_key: supplierWriteKey,
            item_index: itemIndex,
            batch_id: split.batchId,
            branch_id: split.branchId,
            quantity: split.quantity,
          },
        })
      }
    }
    statements.push(...exact.takeFinalPhysicalWrites())
    const identityIndex = statements.length
    const manifest: SupplierReturnManifest={version:1,scope:'supplier',sale_id:null,intent:supplierIntent,sources}
    const manifestJson=JSON.stringify(manifest)
    if(new TextEncoder().encode(manifestJson).byteLength>RETURN_CREATE_REQUEST_BYTES)throw new ReturnCreateBudgetError()
    statements.push({sql:`INSERT INTO return_create_receipts(id,actor_id,return_id,sale_id,request_id,request_digest,request_json,response_json,occurred_at)
      VALUES(@receipt,@actor,${returnIdExpression},NULL,@supplier_write_key,@digest,@manifest,
        json_object('id',${returnIdExpression},'returnNumber',@returnNumber,'replacementSaleId',NULL,'replacementReceiptNumber',NULL),@stamp)
      RETURNING return_id AS id`,params:{receipt:crypto.randomUUID(),actor:user.id,supplier_write_key:supplierWriteKey,
        digest:await sha256Hex(manifestJson),manifest:manifestJson,returnNumber,stamp:new Date().toISOString()}})
    const plannedCount = stockTransactionStatementCount(statements.length)
    // Shared return tails: cold cache fallback/quota retries six, notification reads/retries six.
    assertReturnCreateQueryBudget(queryLimit, statementsUsed(), plannedCount, 12)
    routeStatements += plannedCount
    dispatched = true
    const results = await executeStockTransaction(db, statements, 'once')
    const committed = results[identityIndex]?.results?.[0] as { id?: number } | undefined
    if (!committed?.id) throw new Error('supplier_return_identity_missing')
    returnId = Number(committed.id)
  } catch (error) {
    const stockGuard = productStockGuardError(error)
    if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
    if (error instanceof ReturnCreateBudgetError) throw error
    if (isCountedStockConflict(error)) {
      if (dispatched && clientRequestId) {
        try {
          const replay = await db.prepare("SELECT r.id,r.return_number,r.return_scope,r.return_type,cr.request_json,cr.request_digest FROM returns r LEFT JOIN return_create_receipts cr ON cr.return_id=r.id WHERE client_request_id=? AND client_request_id<>'' LIMIT 1")
            .get<{ id: number; return_number: string; return_scope: string; return_type: string; request_json: string | null; request_digest: string | null }>([clientRequestId])
          if (replay) return completeReplay(replay)
        } catch (_) {
          return c.json({ error: 'The supplier return outcome could not be confirmed. Retry the original request or review Returns.',
            code: 'supplier_return_outcome_unknown', action: 'retry_same_request' }, 503)
        }
      }
      return c.json({ error: 'Stock or its recorded source changed. Refresh before retrying.', code: 'write_conflict', action: 'reload_required' }, 409)
    }
    const transactionRefusal = stockTransactionRefusal(error)
    if (transactionRefusal) return c.json(transactionRefusal, 503)
    return c.json({ error: dispatched ? 'The supplier return outcome could not be confirmed. Retry the original request or review Returns.' : (error as Error).message,
      code: dispatched ? 'supplier_return_outcome_unknown' : 'supplier_return_failed', action: dispatched ? 'retry_same_request' : 'reload_required' }, dispatched ? 503 : 500)
  }

  completeSupplierReturnViews(c, returnId)
  // Telegram: supplier return = stock out with the settlement money.
  c.executionCtx.waitUntil(sendReturnTelegramEvent(c.env, returnId, {
    kind: 'supplier', returnNumber, party: body.supplier_name || null,
    branch: body.branch_id ? (await db.prepare('SELECT name FROM branches WHERE id = ?').get<{ name: string }>([body.branch_id]))?.name || null : null,
    reason: body.reason || null, settlement, compensationUsd: supplierCompensationUsd, compensationKhr: supplierCompensationKhr,
    lossUsd: supplierLossUsd, lossKhr: supplierLossKhr, by: actorSnapshot(user),
  }).catch((error) => console.error('[telegram] supplier return notification failed', error)))
  return c.json({ id: returnId, returnNumber })
}

// PATCH /api/returns/:id -- edit a customer return's items/reason/notes.
// Reverses the previous restock (deduct what it added back), re-validates
// against current sale quantities, replaces the return_items rows, and
// re-applies stock for the new item list. Supplier returns aren't editable
// from this route (matches the original).
app.patch('/:id', async (c) => {
  try { return await editCustomerReturn(c) }
  catch (error) {
    if (error instanceof ReturnCreateBudgetError) return c.json({ error: error.message, code: 'return_edit_over_plan_budget' }, 400)
    if (isCountedStockConflict(error)) return c.json({ error: (error as Error).message, code: 'write_conflict', action: 'reload_required' }, 409)
    throw error
  }
})

async function editCustomerReturn(c: Context<{ Bindings: Env; Variables: { user: SessionUser } }>) {
  const baseDb = getDb(c.env)
  const queryLimit = getPlanLimits(c.env).d1QueriesPerInvocation
  const requestMetrics = (c as unknown as { get(key: string): unknown }).get('requestMetrics') as (RequestMetrics & { attemptedStatements?: number }) | undefined
  const initialStatements = requestMetrics?.attemptedStatements ?? requestMetrics?.statements ?? 0
  let routeStatements = 0
  const statementsUsed = () => {
    if (!requestMetrics) return routeStatements + 10
    if (requestMetrics.attemptedStatements == null && requestMetrics.failed) return Infinity
    return Math.max(initialStatements + routeStatements, requestMetrics.attemptedStatements ?? requestMetrics.statements) + 3
  }
  const db = Object.create(baseDb) as ReturnType<typeof getDb>
  db.prepare = ((sql: string) => {
    const statement = baseDb.prepare(sql)
    const countRead = () => { assertReturnCreateQueryBudget(queryLimit, statementsUsed(), 1, 1); routeStatements += 1 }
    return {
      get: async (params) => { countRead(); if (!statement.getOnce) throw new Error('Return edits require single-attempt reads'); return statement.getOnce(params) },
      all: async (params) => { countRead(); if (!statement.allOnce) throw new Error('Return edits require single-attempt reads'); return statement.allOnce(params) },
      run: async (params) => { countRead(); return statement.run(params) },
    }
  }) as typeof db.prepare
  const user = c.get('user')
  const id = c.req.param('id')!
  // Part 154: editing a return reverses every previously-restocked item's
  // batch, then re-applies restocking with fresh batch resolution --
  // same live-state dependency (a batch's current available quantity,
  // which can move between when a Review Required user submits an edit
  // and when a reviewer approves it) that kept inventory.ts's /adjust,
  // /transfer, /move-row explicitly unwired in Part 153, and the spec's
  // own "Review Required can add/view/search directly; delete goes to
  // review" for Returns never actually lists edit as allowed. Blocked
  // outright for Review Required rather than assumed-safe or silently
  // left open now that the router-wide gate above admits review-tier
  // users at all.
  if (getPermissionTier(user, 'returns') === 'review') {
    return c.json({ error: 'Editing a return requires Full Access to Returns -- Partial Access support for this action is not built yet.' }, 403)
  }
  // Per-action override (Part 546): 'returns:edit' switched off.
  if (getActionTier(user, 'returns', 'edit') === 'none') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const body = await c.req.json<{
    items?: ReturnItemInput[]
    reason?: string
    return_type?: string
    notes?: string
    total_refund_usd?: number
    total_refund_khr?: number
    branch_id?: number
    client_request_id?: string
    [key: string]: unknown
  }>().catch(() => ({} as Record<string, unknown>))

  if (hasAcquisitionCostInput(body.items, user)) return c.json({ error: 'Cost-entry permission is required to submit return cost overrides.', code: 'product_cost_edit_required' }, 403)
  const returnId = Number(id)
  if (!Number.isSafeInteger(returnId) || returnId <= 0) return c.json({ error: 'Return not found' }, 404)
  const requestId = normalizeClientRequestId(body.client_request_id)
  if (!requestId) {
    return c.json({
      error: 'This return edit was created by an older app version. Refresh and review it before submitting.',
      code: 'client_request_id_required', action: 'refresh_required',
    }, 400)
  }
  const expectedUpdatedAt = getExpectedUpdatedAt(body)
  if (!expectedUpdatedAt) {
    return c.json({
      error: 'Refresh this return before editing it.',
      code: 'expected_updated_at_required', action: 'refresh_required',
    }, 400)
  }
  const authenticatedActorId = actorId(user)
  if (!authenticatedActorId) return c.json({ error: 'Authenticated account id is required.' }, 401)
  let canonicalIntent: Record<string, unknown>
  try {
    canonicalIntent = canonicalReturnEditIntent(returnId, expectedUpdatedAt, body)
  } catch (error) {
    const stockGuard = productStockGuardError(error)
    if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
    return c.json({ error: (error as Error).message }, 400)
  }
  let requestJson = JSON.stringify(canonicalIntent)
  if (new TextEncoder().encode(requestJson).byteLength > 131072) {
    return c.json({ error: 'Return edit is too large. Submit fewer items.', code: 'request_too_large' }, 400)
  }
  let requestDigest = await sha256Hex(requestJson)
  const previousReceipt = await db.prepare(`
    SELECT return_id,request_digest,response_json FROM return_mutation_receipts
    WHERE actor_id=@actor AND mutation_kind='edit' AND request_id=@request
  `).get<{ return_id: number; request_digest: string; response_json: string }>({ actor: authenticatedActorId, request: requestId })
  if (previousReceipt && previousReceipt.request_digest !== requestDigest && Array.isArray(body.items)) {
    const origin=await db.prepare('SELECT sale_id FROM returns WHERE id=?').get<{sale_id:number|null}>([returnId])
    try {
      // Digest only: a replay writes nothing, so a keeper claim normalises without needing fresh merge proof and an
      // already committed edit replays whatever merges happened since.
      body.items=await resolveCountedReturnConditions(db,Number(origin?.sale_id)||null,body.items as unknown as Array<Record<string,unknown>>,[]) as unknown as ReturnItemInput[]
      canonicalIntent=canonicalReturnEditIntent(returnId,expectedUpdatedAt,body)
      requestJson=JSON.stringify(canonicalIntent);requestDigest=await sha256Hex(requestJson)
    } catch(error) { return c.json({error:(error as Error).message},400) }
  }
  if (previousReceipt) {
    if (Number(previousReceipt.return_id) !== returnId || previousReceipt.request_digest !== requestDigest) {
      return c.json({ error: 'client_request_id was already used with different return edit data.', code: 'idempotency_conflict' }, 409)
    }
    return c.json(JSON.parse(previousReceipt.response_json) as { id: number; updated_at: string })
  }

  const existing = await db.prepare(`SELECT r.*,date(r.created_at,'+7 hours') AS received_business_date,COALESCE(v.revision,0) AS write_revision,
      (SELECT json_group_array(json_object('id',id,'sale_item_id',sale_item_id,'product_id',product_id,'product_name',product_name,'quantity',quantity,'applied_price_usd',applied_price_usd,'applied_price_khr',applied_price_khr,'cost_price_usd',cost_price_usd,'cost_price_khr',cost_price_khr,'total_usd',total_usd,'total_khr',total_khr,'return_to_stock',return_to_stock,'stock_action',stock_action,'stock_condition',stock_condition,'branch_id',branch_id,'batch_id',batch_id,
        'product_active',(SELECT p.is_active FROM products p WHERE p.id=line.product_id))) FROM (SELECT * FROM return_items WHERE return_id=r.id ORDER BY id) line) AS item_snapshot,
      (SELECT json_group_array(json_object('id',id,'return_item_id',return_item_id,'condition_tag',condition_tag,'product_id',product_id,'product_name',product_name,'branch_id',branch_id,'batch_id',batch_id,'quantity',quantity,'quantity_remaining',quantity_remaining,'reason',reason,'created_by_user_id',created_by_user_id,'created_by_user_name',created_by_user_name,
        'product_active',(SELECT p.is_active FROM products p WHERE p.id=tag.product_id))) FROM (SELECT * FROM damaged_stock_lots WHERE return_id=r.id AND (return_item_id IS NULL OR EXISTS(SELECT 1 FROM return_items ri WHERE ri.id=damaged_stock_lots.return_item_id AND ri.return_id=r.id)) ORDER BY id) tag) AS tag_snapshot,
      (SELECT json_group_array(json_array(id,return_item_id,batch_id,branch_id,quantity)) FROM (SELECT * FROM return_item_batch_allocations WHERE return_item_id IN(SELECT id FROM return_items WHERE return_id=r.id) ORDER BY id)) AS allocation_snapshot,
      (SELECT json_group_array(json(snapshot_row)) FROM (SELECT json_array(ri.id,sr.id,ri.sale_item_id,ri.product_id,ri.quantity,sr.status) AS snapshot_row FROM return_items ri JOIN returns sr ON sr.id=ri.return_id WHERE sr.sale_id=r.sale_id AND sr.id<>r.id AND COALESCE(sr.status,'completed')!='cancelled' AND COALESCE(sr.return_scope,'customer')='customer' ORDER BY sr.id,ri.id)) AS sibling_snapshot
    FROM returns r LEFT JOIN return_write_revisions v ON v.return_id=r.id WHERE r.id=?`).get<ReturnRow & { write_revision:number; received_business_date:string|null; item_snapshot:string; tag_snapshot:string; allocation_snapshot:string; sibling_snapshot:string }>([id])
  if (!existing) return c.json({ error: 'Return not found' }, 404)
  if (normalizeScope(existing.return_scope, CUSTOMER_SCOPE) !== CUSTOMER_SCOPE) {
    return c.json({ error: 'Supplier returns cannot be edited from this form yet.' }, 400)
  }
  if (Number(existing.money_precision_version) === 1) {
    return c.json({ error: 'Exact net-entitlement returns cannot be edited until the v1 edit flow is available.',
      code: 'customer_return_edit_v1_not_supported', action: 'review_required' }, 409)
  }
  type CapturedEditSaleSource = OriginalReturnCondition & {
    id:number; batch_id:number|null; batch_label:string|null; batch_expiry_date:string|null; quantity:number;
    applied_price_usd:number|null; applied_price_khr:number|null; cost_price_usd:number|null; cost_price_khr:number|null; allocations_json:string
    product_active:number|null
  }
  let editSaleSources: CapturedEditSaleSource[] = []
  type LinkedSaleState = {
    id: number; sale_status: string | null; status_before_return: string | null
    receipt_number:string|null; write_revision:number; money_precision_version:number|null; item_snapshot:string
  }
  let linkedSale: LinkedSaleState | null = null
  if (existing.sale_id) {
    linkedSale = await db.prepare(`SELECT s.id,s.sale_status,s.status_before_return,s.receipt_number,s.money_precision_version,
      COALESCE(v.revision,0) AS write_revision,
        (SELECT json_group_array(json(snapshot_row)) FROM (SELECT json_object('id',si.id,'sale_id',si.sale_id,'product_id',si.product_id,'branch_id',si.branch_id,'batch_id',si.batch_id,'damaged_lot_id',si.damaged_lot_id,'batch_label',si.batch_label,'batch_expiry_date',si.batch_expiry_date,'quantity',si.quantity,'applied_price_usd',si.applied_price_usd,'applied_price_khr',si.applied_price_khr,'cost_price_usd',si.cost_price_usd,'cost_price_khr',si.cost_price_khr,'sale_item_id',si.id,
          'original_product_id',ci.product_id,'original_branch_id',ci.branch_id,'original_batch_id',ci.batch_id,'original_condition_tag',ci.condition_tag,
          'product_active',(SELECT p.is_active FROM products p WHERE p.id=si.product_id),
          'allocations_json',((SELECT json_group_array(json_array(id,batch_id,branch_id,quantity,released_quantity)) FROM (SELECT * FROM sale_item_batch_allocations WHERE sale_item_id=si.id ORDER BY id))||'')) AS snapshot_row
          FROM sale_items si LEFT JOIN counted_sale_item_conditions ci ON ci.sale_item_id=si.id WHERE si.sale_id=s.id ORDER BY si.id)) AS item_snapshot
      FROM sales s LEFT JOIN sale_write_revisions v ON v.sale_id=s.id WHERE s.id=?`)
      .get<LinkedSaleState>([existing.sale_id]) || null
    if (!linkedSale) return c.json({ error: 'Original sale not found' }, 400)
    if (new TextEncoder().encode(linkedSale.item_snapshot).byteLength>RETURN_CREATE_REQUEST_BYTES) throw new ReturnCreateBudgetError()
    editSaleSources=JSON.parse(linkedSale.item_snapshot) as CapturedEditSaleSource[]
  }
  if(linkedSale && String(linkedSale.sale_status||'completed')==='cancelled') return c.json({error:'This sale is cancelled; restore it before editing its return.'},400)
  // The sale decides here too. A v0 return row attached to a v1 sale can only
  // be a legacy-shaped row recorded before that rule was enforced; the edit
  // path below re-derives the refund on the legacy gross-price basis and writes
  // total_refund_* back, which would restate exact money as legacy money.
  if (Number(linkedSale?.money_precision_version) === 1) {
    return c.json({ ...MONEY_PRECISION_REVIEW_NEEDED }, 409)
  }
  // A cancelled return counts for nothing and its restock was already taken
  // back out by the cancel. The reversal below assumes the return's stock is
  // still IN, so editing it would pull those units out a second time and then
  // restock the new lines, and a later restore would add them again. Restore
  // first, then edit. The write-revision guard on the final batch covers a
  // cancel that lands between this read and the write.
  if (String(existing.status || 'completed') === 'cancelled') {
    return c.json({ error: 'This return is cancelled. Restore it before editing.',
      code: 'return_edit_cancelled', action: 'restore_required' }, 409)
  }

  if (new TextEncoder().encode(existing.item_snapshot+existing.tag_snapshot+existing.allocation_snapshot+existing.sibling_snapshot).byteLength>RETURN_CREATE_REQUEST_BYTES) throw new ReturnCreateBudgetError()
  const existingItems = JSON.parse(existing.item_snapshot) as Array<{
    id: number; product_id: number | null; product_name: string | null; quantity: number
    return_to_stock: number; stock_action: string | null; branch_id: number | null; cost_price_usd: number | null; cost_price_khr: number | null
    batch_id: number | null; sale_item_id: number | null; product_active: number | null
  }>
  const explicitEditConditions = Array.isArray(body.items) ? body.items.map(item=>item.stock_condition!=null || item.condition_tag!=null || item.stock_action==='damaged') : []
  let newItems: ReturnItemInput[] = Array.isArray(body.items) ? body.items : existingItems
  // Lines naming a keeper (a return recorded after a product merge names it) resolve on their sale item's own
  // identity and are proven from merge records before any write; a product still active has no keeper.
  const keeperClaims: ReturnKeeperClaim[] = []
  const productActive = new Map<number, boolean>([...editSaleSources, ...existingItems].filter(row => row.product_id != null)
    .map(row => [Number(row.product_id), Number(row.product_active ?? 1) === 1]))
  try {
    newItems = resolveCountedReturnConditionsFromSnapshot(Number(existing.sale_id)||null,newItems as unknown as Array<Record<string,unknown>>,editSaleSources,keeperClaims) as unknown as ReturnItemInput[]
    const unprovable = keeperClaims.find(claim => productActive.get(claim.originalProductId) !== false)
    if (unprovable) throw returnKeeperClaimError(unprovable)
    if(Array.isArray(body.items)) {
      body.items=newItems;canonicalIntent=canonicalReturnEditIntent(returnId,expectedUpdatedAt,body)
      requestJson=JSON.stringify(canonicalIntent);requestDigest=await sha256Hex(requestJson)
    }
  } catch(error) { return c.json({error:(error as Error).message},400) }
  let editCostSources: Record<string,unknown>[] = []
  if (Array.isArray(body.items)) {
    const sourceRows = editCostSources = existing.sale_id
      ? editSaleSources.map(row=>({id:row.id,product_id:row.product_id,branch_id:row.branch_id,cost_price_usd:row.cost_price_usd,cost_price_khr:row.cost_price_khr}))
      : await selectInChunks([...new Set(newItems.map(item => Number(item.product_id)).filter(id => id > 0))], 0, chunk => db.prepare(`SELECT id,cost_price_usd,cost_price_khr FROM products WHERE id IN (${chunk.map(() => '?').join(',')})`).all<Record<string, unknown>>(chunk))
    try {
      newItems = newItems.map(item => {
        // A line keeps its sale item's recorded cost even when its saved row names the proven keeper.
        const previous = existingItems.filter(row => (Number(item.sale_item_id) > 0 ? Number(row.sale_item_id) === Number(item.sale_item_id)
          : Number(row.product_id) === Number(item.product_id)) && (item.branch_id == null || row.branch_id === item.branch_id))
        const costs = previous.length ? fillOmittedReturnCosts(item, previous, 'return') : fillOmittedReturnCosts(item, sourceRows, existing.sale_id ? 'sale' : 'catalog')
        return { ...item, ...costs }
      })
    } catch (error) {
      const stockGuard = productStockGuardError(error)
      if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
      return c.json({ error: (error as Error).message, code: 'return_cost_source_review_required' }, 409)
    }
  }
  if (existingItems.length > 50 || newItems.length > 50) {
    return c.json({ error: 'Edit at most 50 return items at a time.', code: 'return_edit_too_large' }, 400)
  }
  // P4-3: same fail-fast validation the create path runs, before anything
  // below reverses the return's existing stock effect.
  for (const item of newItems) {
    if(!Number.isFinite(Number(item.quantity)) || Number(item.quantity)<=0) return c.json({error:'Return quantity must be greater than zero'},400)
    if (normalizeStockAction(item) !== 'damaged') continue
    const choice = resolveDamagedReturnChoice(item)
    if (!choice.ok) return c.json({ error: choice.error }, 400)
  }

  try {
    assertUpdatedAtMatch('return', existing, expectedUpdatedAt)
  } catch (error) {
    const stockGuard = productStockGuardError(error)
    if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
    if (error instanceof WriteConflictError) {
      const { body: conflictBody, status } = writeConflictResponse(error)
      return c.json(conflictBody, status)
    }
    return c.json({ error: (error as Error).message }, 400)
  }

  // A return recorded at a branch that has since been retired (Old Shop -> LC Store) is edited at the ACTIVE
  // branch the operator confirmed (X-Branch-Redirect; branch_redirect_required until then): its previous restock
  // is reversed there, in the lot that exists there now, and the edited lines are restocked there. The return
  // keeps its own branch and label; its rewritten lines and the movement rows name where the stock really moved.
  // While every branch is active nothing is redirected and nothing changes.
  const editResolver = new BranchEffectResolver(await readBranchDirectory(db), branchRedirectTarget(c))
  const existingLineEffects: Array<BranchEffect | null> = []
  const editEffectByBranch = new Map<number, BranchEffect>()
  try {
    for (const item of existingItems) {
      existingLineEffects.push(item.return_to_stock && item.product_id && item.branch_id ? editResolver.effect(item.branch_id) : null)
    }
    newItems = newItems.map((item) => {
      const recorded = Number(item.branch_id || existing.branch_id) || null
      const effect = recorded ? editResolver.effect(recorded) : null
      return effect?.redirected ? { ...item, branch_id: effect.effectBranchId } : item
    })
    for (const effect of existingLineEffects) if (effect?.redirected) editEffectByBranch.set(effect.effectBranchId, effect)
    for (const recorded of [existing.branch_id, ...existingItems.map((item) => item.branch_id)]) {
      const effect = recorded ? editResolver.effect(recorded) : null
      if (effect?.redirected) editEffectByBranch.set(effect.effectBranchId, effect)
    }
    // CUTOVER-LR: an edit may name a NEW header branch (body.branch_id). A disabled branch is never a new target: it
    // is redirected like every other write (branch_redirect_required until the operator confirms an active branch),
    // and the confirmed branch is what the header records. Keeping the return's own branch is not a new target.
    const requestedHeader = Number(body.branch_id) || null
    if (requestedHeader && requestedHeader !== Number(existing.branch_id)) {
      const headerEffect = editResolver.effect(requestedHeader)
      if (headerEffect?.redirected) body.branch_id = headerEffect.effectBranchId
    }
  } catch (error) {
    const stockGuard = productStockGuardError(error)
    if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
    const refusal = branchEffectRefusal(error)
    if (refusal) return c.json(refusal, 409)
    throw error
  }
  const editAddressedLabel = (effect: BranchEffect): string | null =>
    (Number(existing.branch_id) === effect.addressedBranchId && existing.branch_name) || effect.addressedName
  // newItems already carry the landing branch id; the label is that of the branch the return was made under.
  const editLabelFor = (landingBranchId: number | null): { branchName: string | null; addressedName: string | null } | null => {
    const effect = landingBranchId ? editEffectByBranch.get(landingBranchId) : null
    return effect ? { branchName: effect.effectName, addressedName: editAddressedLabel(effect) } : null
  }

  const branchName = body.branch_id
    ? (await db.prepare('SELECT name FROM branches WHERE id = ?').get<{ name: string }>([body.branch_id]))?.name || null
    : existing.branch_name

  // No settlement gate any more: a return is only a return and a replacement
  // is only a sale, so editing the returned side cannot "break an exchange".
  // The linked replacement sale is untouched by this edit -- it is a separate
  // sale with its own receipt, and a sale is corrected in Sales, not here.
  // The historical settlement_mode/settlement_diff_* on rows written under
  // the old model are left exactly as they were found (the UPDATE below no
  // longer names those columns), so an old return still reads correctly.
  //
  // What DOES stand in the old gate's place is the same pre-write pass POST /
  // runs: resolve each line's refund from the original sale line, and decide
  // the lot every restocked line goes back into. Both live up here, above the
  // damaged-lot reversal and every stock statement, so a line with no lot is
  // refused having touched nothing -- the Part-77 discipline the settlement
  // gate used to hold this slot for.
  const editSaleItemIds = newItems.map((i) => i.sale_item_id).filter((sid): sid is number => Number.isFinite(sid) && Number(sid) > 0)
  const saleItemBatchInfoForEdit = new Map(editSaleSources.filter(row=>editSaleItemIds.includes(row.id)).map(row=>[row.id,row]))
  const saleItemAllocationsForEdit = new Map(editSaleSources.filter(row=>editSaleItemIds.includes(row.id)).map(row=>[row.id,
    (JSON.parse(row.allocations_json) as Array<[number,number,number|null,number,number]>).flatMap(alloc=>{
      const outstanding = Math.max(0,subtractCountedQuantity(alloc[3],[alloc[4]]))
      return outstanding>0 ? [{batch_id:alloc[1],outstanding}] : []
    })]))

  // The refund per line: the ORIGINAL sale line's price, always -- an edit is
  // not a chance to restate what the customer paid. A manual return (no sale
  // line) has only the posted price to go on. A return against a sale is
  // priced from that sale's lines, matched exactly as POST / matches them:
  // by sale_item_id, else by product_id (capped at the recorded price).
  const editSalePriceLines = editSaleSources
  let editRefundPrices: Array<{ unitUsd: number; unitKhr: number; fromSaleLine: boolean }>
  try {
    editRefundPrices = newItems.map((item) => {
      if (!existing.sale_id) {
        return resolveRefundUnitPrice({
          saleLine: item.sale_item_id ? saleItemBatchInfoForEdit.get(Number(item.sale_item_id)) ?? null : null,
          postedUsd: toNumber(item.applied_price_usd, 0),
          postedKhr: toNumber(item.applied_price_khr, 0),
        })
      }
      // Same rule POST / enforces through its quantity cap: a posted line on
      // a sale must name a sale item or a product, or there is no recorded
      // price to hold it to.
      if (Array.isArray(body.items) && !(Number(item.sale_item_id) > 0) && !(Number(item.product_id) > 0)) {
        throw new RefundSaleLineError('return_refund_sale_line_required', 'Each return line needs a sale item or product')
      }
      const match = matchRefundSaleLine(editSalePriceLines, item)
      return resolveRefundUnitPrice({
        saleLine: match?.line ?? null, matchedBy: match?.matchedBy,
        postedUsd: item.applied_price_usd == null ? null : toNumber(item.applied_price_usd, 0),
        postedKhr: item.applied_price_khr == null ? null : toNumber(item.applied_price_khr, 0),
      })
    })
  } catch (error) {
    const stockGuard = productStockGuardError(error)
    if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
    if (error instanceof RefundSaleLineError) return c.json({ error: error.message, code: error.code }, 400)
    throw error
  }

  for (const [index,item] of newItems.entries()) {
    const source = editSalePriceLines.find(row=>row.id===item.sale_item_id)
    if (!source || !source.damaged_lot_id) continue
    if (!item.counted_original_condition || source.original_product_id!==source.product_id || source.original_branch_id!==source.branch_id
      || (item.batch_id ?? null)!==source.original_batch_id
      || (!explicitEditConditions[index] && normalizeStockAction(item)!=='none' && item.stock_condition!==source.original_condition_tag)) throw new CountedStockConflictError()
  }
  const editLotPlans: Array<{ splits: Array<{ batchId: number; quantity: number }>; plainQuantity: number }> = []
  for (const item of newItems) {
    const quantity = Number(item.quantity) || 0
    const productId = Number(item.product_id) || 0
    const itemBranchId = item.branch_id || existing.branch_id || null
    if (normalizeStockAction(item) === 'none' || !productId || !itemBranchId) {
      editLotPlans.push({ splits: [], plainQuantity: 0 })
      continue
    }
    const operatorBatchId = Number.isFinite(Number(item.batch_id)) && Number(item.batch_id) > 0 ? Number(item.batch_id) : null
    const plan = planReturnLot({
      allocations: item.sale_item_id ? (saleItemAllocationsForEdit.get(item.sale_item_id) || []) : [],
      saleLineBatchId: item.sale_item_id ? (saleItemBatchInfoForEdit.get(item.sale_item_id)?.batch_id ?? null) : null,
      operatorBatchId,
      quantity,
      lotTracked: false,
    })
    if (plan.requiresLotPick) {
      const fallbackName = (await db.prepare('SELECT name FROM products WHERE id = ?').get<{ name: string }>([productId]))?.name
      const name = (item.product_name && item.product_name.trim()) || fallbackName || `product #${productId}`
      const error = new ReturnLotRequiredError(name, quantity)
      return c.json({ error: error.message, code: error.code, product_id: productId }, 400)
    }
    editLotPlans.push({ splits: plan.splits, plainQuantity: plan.plainQuantity })
  }
  // The units go back into the lot that exists at the branch NOW: a lot the branch consolidation folded into
  // another (same product, same received date) restocks as its survivor, never as the folded id.
  const editFoldedByBranch = new Map<number, number[]>()
  newItems.forEach((item, index) => {
    const lineBranch = Number(item.branch_id || existing.branch_id) || 0
    if (lineBranch && editLotPlans[index]?.splits.length) editFoldedByBranch.set(lineBranch, [...(editFoldedByBranch.get(lineBranch) || []), ...editLotPlans[index].splits.map((split) => split.batchId)])
  })
  const editSurvivors = new Map<number, Map<number, number>>()
  for (const [lineBranch, batchIds] of editFoldedByBranch) {
    const found = await foldedLotSurvivors(db, lineBranch, batchIds)
    if (found.size) editSurvivors.set(lineBranch, found)
  }
  if (editSurvivors.size) {
    for (const [index, plan] of editLotPlans.entries()) {
      const survivors = editSurvivors.get(Number(newItems[index].branch_id || existing.branch_id) || 0)
      if (!survivors || !plan.splits.length) continue
      const merged = new Map<number, number>()
      for (const split of plan.splits) {
        const batchId = survivors.get(split.batchId) ?? split.batchId
        merged.set(batchId, subtractCountedQuantity(merged.get(batchId) || 0, [-split.quantity]))
      }
      editLotPlans[index] = { splits: [...merged].map(([batchId, quantity]) => ({ batchId, quantity })), plainQuantity: plan.plainQuantity }
    }
  }

  let projectedSaleStatus: string | null = null
  if (linkedSale) {
    const soldLines = editSaleSources.map(row=>({id:row.id,product_id:row.product_id,quantity:row.quantity}))
    const siblingLines = (JSON.parse(existing.sibling_snapshot) as Array<[number,number,number|null,number|null,number,string|null]>).map(row=>({sale_item_id:row[2],product_id:row[3],quantity:row[4]}))
    const proposedLines = String(existing.status || 'completed') === 'cancelled' ? [] : newItems.map((item) => ({
      sale_item_id: item.sale_item_id ?? null,
      product_id: item.product_id ?? null,
      quantity: Number(item.quantity) || 0,
    }))
    try {
      assertReturnCreateCapacity(soldLines, siblingLines, proposedLines)
    } catch (error) {
      const stockGuard = productStockGuardError(error)
      if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
      return c.json({ error: (error as Error).message }, 400)
    }
    projectedSaleStatus = projectedSaleStatusForReturnEdit(
      soldLines,
      [...siblingLines, ...proposedLines],
      linkedSale.status_before_return,
    )
  }

  const statements: Array<{ sql: string; params: Record<string, unknown> }> = []
  const touchedProductIds = new Set<number>()
  const receiptId = crypto.randomUUID()
  const mutationStamp = new Date().toISOString()
  const fixedResponse = { id: returnId, updated_at: mutationStamp }
  let saleEventProvenance: { source_kind: 'return_edit'; source_id: string; generation: 0; sale_id: number } | null = null
  // Declared out here (assigned inside the batch-building try) so the audit
  // row after the commit records the values the UPDATE actually wrote.
  let returnUpdateValues: Record<string, unknown> = {}

  // Damaged stock reversals are planned with every sellable-stock change.
  let editReversedDamaged: ReversedDamagedLot[] = []
  let editDamagedLots: Array<{
    id:number; return_item_id:number|null; condition_tag:string; product_id:number; product_name:string|null;
    branch_id:number|null; batch_id:number|null; quantity:number; quantity_remaining:number; reason:string|null;
    created_by_user_id:number|string|null; created_by_user_name:string|null; product_active:number|null
  }> = []
  let editDispatched = false

  // 11.13: this return's damaged lots come back out before the re-apply.
  // A lot POS already drew from can't be un-damaged (that stock left the
  // building) -- ConsumedDamagedStockError blocks the edit outright.
  try {
    const damagedLots = editDamagedLots = JSON.parse(existing.tag_snapshot) as typeof editDamagedLots
    for (const lot of damagedLots) {
      // A merged product's original tag reads zero by design; its live units are checked on the keeper's derivative tag below.
      if (Number(lot.product_active ?? 1) === 1 && Number(lot.quantity_remaining) < Number(lot.quantity)) {
        throw new ConsumedDamagedStockError(String(lot.product_name || `product #${lot.product_id}`), Number(lot.quantity) - Number(lot.quantity_remaining))
      }
    }
    editReversedDamaged = damagedLots.map((lot) => ({
      product_id: lot.product_id, product_name: lot.product_name, branch_id: lot.branch_id,
      batch_id: lot.batch_id ?? null, quantity: Number(lot.quantity), reason: lot.reason ?? null,
      created_by_user_id: lot.created_by_user_id ?? null, created_by_user_name: lot.created_by_user_name ?? null,
    }))
    for(const lot of damagedLots) {
      if(!lot.return_item_id || !lot.branch_id) return c.json({error:'return_condition_attribution_unproven'},409)
    }
  } catch (error) {
    const stockGuard = productStockGuardError(error)
    if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
    if (error instanceof ConsumedDamagedStockError) return c.json({ error: error.message }, 400)
    throw error
  }

  // Every reversal and restock below joins the guarded atomic edit batch.
  try {

  // Reverse the stock effect of every existing item that had been restocked.
  // Per-lot aware: a return that recorded its restock split into
  // return_item_batch_allocations (POST / and this edit both write it now)
  // reverses each exact lot with strict transaction-time availability guards.
  // Old aggregate-only returns may reverse only the actual unlotted residual;
  // consumed/merged lot stock fails closed instead of taking unrelated units.
  const existingItemIds = existingItems.map((it) => Number(it.id)).filter((n) => Number.isFinite(n) && n > 0)
  const existingReturnAllocations = new Map<number,Array<{id:number;batch_id:number;branch_id:number|null;quantity:number}>>()
  for (const row of JSON.parse(existing.allocation_snapshot) as Array<[number,number,number,number|null,number]>) {
    if (!existingItemIds.includes(row[1])) throw new CountedStockConflictError()
    const entries = existingReturnAllocations.get(row[1]) || []
    entries.push({id:row[0],batch_id:row[2],branch_id:row[3],quantity:row[4]});existingReturnAllocations.set(row[1],entries)
  }
  // Lots the consolidation folded: the reversal takes the units out of the lot that exists NOW.
  const reversalSurvivors = new Map<number, Map<number, number>>()
  for (const [index, effect] of existingLineEffects.entries()) {
    if (!effect?.redirected) continue
    const item = existingItems[index]
    const wanted = [...(existingReturnAllocations.get(Number(item.id)) || []).map((alloc) => Number(alloc.batch_id)), ...(item.batch_id != null ? [Number(item.batch_id)] : [])]
    const found = await foldedLotSurvivors(db, effect.effectBranchId, wanted)
    const merged = reversalSurvivors.get(effect.effectBranchId) || new Map<number, number>()
    for (const [folded, survivor] of found) merged.set(folded, survivor)
    reversalSurvivors.set(effect.effectBranchId, merged)
  }
  // Units of a product merged away are reversed and received where the merge records prove they are now (the keeper's
  // derivative receipt or tag); lines of products still active keep their own tuples. The saved lines, tags and
  // movements of this return are history and are not rewritten; the re-inserted lines name the proven keeper.
  const isMergedProduct = (productId: number | null | undefined) => productId != null && productActive.get(Number(productId)) === false
  const reversalBranch = (index: number) => existingLineEffects[index]?.redirected ? existingLineEffects[index]!.effectBranchId : Number(existingItems[index].branch_id)
  const reversalTuple = (index: number, batchId: number | null) => ordinaryTuple(Number(existingItems[index].product_id), reversalBranch(index),
    batchId === null || !existingLineEffects[index]?.redirected ? batchId : reversalSurvivors.get(reversalBranch(index))?.get(Number(batchId)) ?? batchId)
  const lotTuple = (lot: (typeof editDamagedLots)[number]): MergeOriginIdentity => ({ productId: lot.product_id, branchId: lot.branch_id!,
    batchId: lot.batch_id, damagedLotId: lot.id, conditionTag: lot.condition_tag as MergeOriginIdentity['conditionTag'] })
  const newLineBranch = (index: number) => Number(newItems[index].branch_id || existing.branch_id)
  // An operator-picked receipt belongs to the product the line names (a proven keeper may hold it); every other
  // split came from the sale's own allocations, so it belongs to the sold product.
  const newSplitOwner = (index: number) => {
    const item = newItems[index]
    return Number(item.batch_id) > 0 && !item.counted_original_condition
      ? keeperClaims.find(claim => claim.index === index)?.productId ?? Number(item.product_id) : Number(item.product_id)
  }
  const mergedReversals = existingItems.flatMap((item, index) => item.return_to_stock && item.product_id && item.branch_id && isMergedProduct(item.product_id) ? [index] : [])
  const mergedNewLines = newItems.flatMap((item, index) => normalizeStockAction(item) !== 'none' && Number(item.product_id) > 0
    && newLineBranch(index) > 0 && isMergedProduct(Number(item.product_id)) ? [index] : [])
  const mergeEffects = await readReturnMergeEffects(db, [
    ...editDamagedLots.filter(lot => isMergedProduct(lot.product_id)).map(lotTuple),
    ...mergedReversals.flatMap(index => [reversalTuple(index, null),
      ...(existingReturnAllocations.get(Number(existingItems[index].id)) || []).map(row => reversalTuple(index, row.batch_id)),
      ...(existingItems[index].batch_id != null ? [reversalTuple(index, existingItems[index].batch_id)] : [])]),
    ...mergedNewLines.flatMap(index => returnLineTuples(Number(newItems[index].product_id), newLineBranch(index), editLotPlans[index], newSplitOwner(index))),
  ], keeperClaims, newLineBranch)
  for (const index of mergedNewLines) {
    const landed = landReturnLine(mergeEffects, Number(newItems[index].product_id), newLineBranch(index), editLotPlans[index], newSplitOwner(index))
    newItems[index] = { ...newItems[index], product_id: landed.productId }
    editLotPlans[index] = landed.plan
  }
  if (mergeEffects.guard) statements.unshift(mergeEffects.guard)
  const reversalAt = (index: number, batchId: number | null) => mergeEffects.effect(reversalTuple(index, batchId))
  const lotAt = (lot: (typeof editDamagedLots)[number]) => mergeEffects.effect(lotTuple(lot))
  const editContexts = new Map<string, CountedReturnContext>()
  for (const lot of editDamagedLots) { const at = lotAt(lot); addCountedReturnContext(editContexts,at.productId,at.branchId,at.batchId===null?[]:[at.batchId]) }
  for (const [index,item] of existingItems.entries()) {
    if (!item.return_to_stock || !item.product_id || !item.branch_id) continue
    addCountedReturnContext(editContexts,reversalAt(index,null).productId,reversalBranch(index),
      [...(existingReturnAllocations.get(Number(item.id)) || []).map(row=>reversalAt(index,row.batch_id).batchId!),...(item.batch_id != null ? [reversalAt(index,item.batch_id).batchId!] : [])])
  }
  for (const [index,item] of newItems.entries()) {
    const productId = Number(item.product_id), branchId = Number(item.branch_id || existing.branch_id)
    if (normalizeStockAction(item)==='none' || !productId || !branchId) continue
    addCountedReturnContext(editContexts,productId,branchId,
      editLotPlans[index].splits.map(row=>row.batchId),[
        ...(normalizeStockAction(item)==='restock' && !item.counted_original_condition && editLotPlans[index].plainQuantity>0
          ? [planReceiveBatchStock({productId:Number(item.product_id),branchId:Number(item.branch_id || existing.branch_id),quantity:editLotPlans[index].plainQuantity,
            receivedDate:existing.received_business_date || new Date(Date.parse(mutationStamp)+7*60*60*1000).toISOString().slice(0,10),provenanceKey:`return-edit:${id}:${index}`}).batchKey] : [])])
  }
  const exactEdit = await readProjectedReturnStock(db,editContexts)
  statements.unshift(...exactEdit.takePreimageGuards())
  const originalItemKeys = ['id','product_id','product_name','quantity','return_to_stock','stock_action','branch_id','cost_price_usd','cost_price_khr','batch_id','sale_item_id','stock_condition','applied_price_usd','applied_price_khr','total_usd','total_khr']
  const originalItemsJson = JSON.stringify(existingItems.map(item=>originalItemKeys.map(key=>(item as unknown as Record<string,unknown>)[key] ?? null)))
  const originalAllocationsJson = JSON.stringify([...existingReturnAllocations].sort(([a],[b])=>a-b).flatMap(([itemId,rows])=>rows.map(row=>[row.id,itemId,row.batch_id,row.branch_id,row.quantity])))
  const originalTagsJson = JSON.stringify(editDamagedLots.map(lot=>[lot.id,lot.return_item_id,lot.condition_tag,lot.product_id,lot.product_name,lot.branch_id,lot.batch_id,lot.quantity,lot.quantity_remaining,lot.reason,lot.created_by_user_id,lot.created_by_user_name]))
  const costSourcesJson = JSON.stringify(editCostSources.map(row=>[row.id,row.product_id ?? null,row.branch_id ?? null,row.cost_price_usd ?? null,row.cost_price_khr ?? null]))
  const sourcesJson = JSON.stringify(editSalePriceLines.map(row=>["id","product_id","branch_id","batch_id","damaged_lot_id","quantity","applied_price_usd","applied_price_khr","original_product_id","original_branch_id","original_batch_id","original_condition_tag","allocations_json"].map(key=>(row as unknown as Record<string,unknown>)[key] ?? null)))
  statements.unshift({sql:`SELECT CASE WHEN
    NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance')
    AND (${stockActorPredicate})
    AND EXISTS(SELECT 1 FROM returns r WHERE r.id=@returnId AND r.sale_id IS @saleId AND r.return_scope IS @scope AND r.status IS @returnStatus AND r.updated_at IS @updatedAt AND r.created_at IS @createdAt AND r.return_number IS @returnNumber AND r.money_precision_version IS @returnMoneyVersion)
    AND COALESCE((SELECT revision FROM return_write_revisions WHERE return_id=@returnId),0)=@returnRevision
    AND (@saleId IS NULL OR (EXISTS(SELECT 1 FROM sales s WHERE s.id=@saleId AND COALESCE(s.sale_status,'completed')=@saleStatus AND COALESCE(s.status_before_return,'')=@beforeReturn AND s.money_precision_version IS @saleMoneyVersion)
      AND COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=@saleId),0)=@saleRevision))
    AND (SELECT json_group_array(json(snapshot_row)) FROM (SELECT json_array(ri.id,sr.id,ri.sale_item_id,ri.product_id,ri.quantity,sr.status) AS snapshot_row FROM return_items ri JOIN returns sr ON sr.id=ri.return_id WHERE sr.sale_id=@saleId AND sr.id<>@returnId AND COALESCE(sr.status,'completed')!='cancelled' AND COALESCE(sr.return_scope,'customer')='customer' ORDER BY sr.id,ri.id))=@siblings
    AND NOT EXISTS(SELECT 1 FROM json_each(@costSources) j WHERE
      CASE WHEN @saleId IS NOT NULL THEN NOT EXISTS(SELECT 1 FROM sale_items row WHERE row.sale_id=@saleId
        AND row.id IS json_extract(j.value,'$[0]') AND row.product_id IS json_extract(j.value,'$[1]') AND row.branch_id IS json_extract(j.value,'$[2]')
        AND row.cost_price_usd IS json_extract(j.value,'$[3]') AND row.cost_price_khr IS json_extract(j.value,'$[4]'))
      ELSE NOT EXISTS(SELECT 1 FROM products row WHERE row.id IS json_extract(j.value,'$[0]')
        AND row.cost_price_usd IS json_extract(j.value,'$[3]') AND row.cost_price_khr IS json_extract(j.value,'$[4]')) END)
    AND (@saleId IS NULL OR ((SELECT COUNT(*) FROM sale_items WHERE sale_id=@saleId)=json_array_length(@sources) AND NOT EXISTS(SELECT 1 FROM json_each(@sources) j WHERE NOT EXISTS(SELECT 1 FROM sale_items si LEFT JOIN counted_sale_item_conditions ci ON ci.sale_item_id=si.id WHERE si.sale_id=@saleId AND si.id IS json_extract(j.value,'$[0]') AND si.product_id IS json_extract(j.value,'$[1]') AND si.branch_id IS json_extract(j.value,'$[2]') AND si.batch_id IS json_extract(j.value,'$[3]') AND si.damaged_lot_id IS json_extract(j.value,'$[4]') AND si.quantity IS json_extract(j.value,'$[5]') AND si.applied_price_usd IS json_extract(j.value,'$[6]') AND si.applied_price_khr IS json_extract(j.value,'$[7]') AND ci.product_id IS json_extract(j.value,'$[8]') AND ci.branch_id IS json_extract(j.value,'$[9]') AND ci.batch_id IS json_extract(j.value,'$[10]') AND ci.condition_tag IS json_extract(j.value,'$[11]') AND (SELECT json_group_array(json_array(id,batch_id,branch_id,quantity,released_quantity)) FROM (SELECT * FROM sale_item_batch_allocations WHERE sale_item_id=si.id ORDER BY id)) IS json_extract(j.value,'$[12]')))))
    AND (SELECT COUNT(*) FROM return_items row WHERE row.return_id=@returnId)=json_array_length(@items) AND NOT EXISTS(SELECT 1 FROM json_each(@items) j WHERE NOT EXISTS(SELECT 1 FROM return_items row WHERE row.return_id=@returnId AND row.id IS json_extract(j.value,'$[0]') AND row.product_id IS json_extract(j.value,'$[1]') AND row.product_name IS json_extract(j.value,'$[2]') AND row.quantity IS json_extract(j.value,'$[3]') AND row.return_to_stock IS json_extract(j.value,'$[4]') AND row.stock_action IS json_extract(j.value,'$[5]') AND row.branch_id IS json_extract(j.value,'$[6]') AND row.cost_price_usd IS json_extract(j.value,'$[7]') AND row.cost_price_khr IS json_extract(j.value,'$[8]') AND row.batch_id IS json_extract(j.value,'$[9]') AND row.sale_item_id IS json_extract(j.value,'$[10]') AND row.stock_condition IS json_extract(j.value,'$[11]') AND row.applied_price_usd IS json_extract(j.value,'$[12]') AND row.applied_price_khr IS json_extract(j.value,'$[13]') AND row.total_usd IS json_extract(j.value,'$[14]') AND row.total_khr IS json_extract(j.value,'$[15]')))
    AND (SELECT COUNT(*) FROM return_item_batch_allocations row WHERE row.return_item_id IN(SELECT id FROM return_items WHERE return_id=@returnId))=json_array_length(@allocations) AND NOT EXISTS(SELECT 1 FROM json_each(@allocations) j WHERE NOT EXISTS(SELECT 1 FROM return_item_batch_allocations row WHERE row.return_item_id IN(SELECT id FROM return_items WHERE return_id=@returnId) AND row.id IS json_extract(j.value,'$[0]') AND row.return_item_id IS json_extract(j.value,'$[1]') AND row.batch_id IS json_extract(j.value,'$[2]') AND row.branch_id IS json_extract(j.value,'$[3]') AND row.quantity IS json_extract(j.value,'$[4]')))
    AND (SELECT COUNT(*) FROM damaged_stock_lots row WHERE row.return_id=@returnId AND (row.return_item_id IS NULL OR EXISTS(SELECT 1 FROM return_items ri WHERE ri.id=row.return_item_id AND ri.return_id=@returnId)))=json_array_length(@tags) AND NOT EXISTS(SELECT 1 FROM json_each(@tags) j WHERE NOT EXISTS(SELECT 1 FROM damaged_stock_lots row WHERE row.return_id=@returnId AND (row.return_item_id IS NULL OR EXISTS(SELECT 1 FROM return_items ri WHERE ri.id=row.return_item_id AND ri.return_id=@returnId)) AND row.id IS json_extract(j.value,'$[0]') AND row.return_item_id IS json_extract(j.value,'$[1]') AND row.condition_tag IS json_extract(j.value,'$[2]') AND row.product_id IS json_extract(j.value,'$[3]') AND row.product_name IS json_extract(j.value,'$[4]') AND row.branch_id IS json_extract(j.value,'$[5]') AND row.batch_id IS json_extract(j.value,'$[6]') AND row.quantity IS json_extract(j.value,'$[7]') AND row.quantity_remaining IS json_extract(j.value,'$[8]') AND row.reason IS json_extract(j.value,'$[9]') AND row.created_by_user_id IS json_extract(j.value,'$[10]') AND row.created_by_user_name IS json_extract(j.value,'$[11]')))
    THEN 1 ELSE json_extract('[1]','$[counted_quantity_conflict]') END`,params:{...stockActorParams(user),returnId,saleId:existing.sale_id || null,scope:existing.return_scope,returnStatus:existing.status,updatedAt:existing.updated_at,createdAt:existing.created_at,returnNumber:existing.return_number,returnMoneyVersion:existing.money_precision_version,returnRevision:Number(existing.write_revision),saleStatus:String(linkedSale?.sale_status || 'completed'),beforeReturn:String(linkedSale?.status_before_return || ''),saleMoneyVersion:linkedSale?.money_precision_version ?? null,saleRevision:Number(linkedSale?.write_revision || 0),siblings:existing.sibling_snapshot,costSources:costSourcesJson,sources:sourcesJson,items:originalItemsJson,allocations:originalAllocationsJson,tags:originalTagsJson}})
  for (const [index, lot] of editDamagedLots.entries()) {
    const at = lotAt(lot), merged = isMergedProduct(lot.product_id)
    const exact = exactEdit.get(at.productId,at.branchId)
    const source = exact.projectedTaggedSource(at.damagedLotId!)
    if (!source || source.batchId!==at.batchId || source.conditionTag!==lot.condition_tag || (!merged && source.quantityRemaining!==lot.quantity_remaining)) throw new CountedStockConflictError()
    // The merge zeroed the original tag; only units missing from the keeper's derivative were really drawn.
    if (merged && source.quantityRemaining < lot.quantity) throw new ConsumedDamagedStockError(String(lot.product_name || `product #${lot.product_id}`), subtractCountedQuantity(lot.quantity,[source.quantityRemaining]))
    const reversed = editReversedDamaged[index]
    statements.push({
      sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name, batch_id)
            VALUES (@product_id, @product_name, @branch_id, '${DAMAGE_REVERSAL_MOVEMENT}', @quantity, 0, 0, @reason, @reference_id, @user_id, @user_name, @batch_id)`,
      params: {
        product_id: at.productId,
        product_name: reversed.product_name,
        branch_id: at.branchId,
        quantity: -reversed.quantity,
        reason: `Return #${existing.return_number} updated - reversing damaged stock`,
        reference_id: id,
        user_id: user?.id ?? null,
        user_name: actorSnapshot(user),
        // 0084: the lot the damaged units sit in now (the original sale lot, or its proven merge derivative).
        batch_id: at.batchId,
      },
    })
    statements.push(...exact.change({lotId:at.damagedLotId!,productId:at.productId,branchId:at.branchId,batchId:at.batchId},lot.quantity,'consume'))
  }
  for (const [itemIndex, item] of existingItems.entries()) {
    if (!item.return_to_stock || !item.product_id || !item.branch_id) continue
    const productId = reversalAt(itemIndex,null).productId
    touchedProductIds.add(productId)
    const reversalEffect = existingLineEffects[itemIndex]?.redirected ? existingLineEffects[itemIndex] : null
    const branchIdForItem = reversalBranch(itemIndex)
    // The lot that holds the units now: the consolidation survivor and/or the proven merge derivative.
    const batchNow = (batchId: number): number => reversalAt(itemIndex,batchId).batchId!
    let plainRemainder = Number(item.quantity) || 0
    // 0084: which lots this reversal actually drew from -- the movement row
    // stamps a batch_id only when ONE lot covered the whole quantity.
    const reversalLots: Array<{ batchId: number; quantity: number }> = []
    const exact = exactEdit.get(productId,branchIdForItem)
    const recordedAllocs = existingReturnAllocations.get(Number(item.id)) || []
    if (recordedAllocs.length) {
      for (const alloc of recordedAllocs) {
        const give = Math.min(alloc.quantity,plainRemainder)
        if (give<=0) continue
        if (alloc.branch_id!==null && alloc.branch_id!==item.branch_id) throw new CountedStockConflictError()
        const reversalBatchId = batchNow(alloc.batch_id)
        statements.push(...exact.changeOrdinary(reversalBatchId,give,'consume'))
        reversalLots.push({batchId:reversalBatchId,quantity:give})
        plainRemainder = subtractCountedQuantity(plainRemainder,[give])
      }
    } else if (item.batch_id!==null) {
      const legacyBatchId = batchNow(item.batch_id)
      statements.push(...exact.changeOrdinary(legacyBatchId,plainRemainder,'consume'))
      reversalLots.push({batchId:legacyBatchId,quantity:plainRemainder})
      plainRemainder=0
    }
    if (plainRemainder>0) statements.push(...exact.changeOrdinary(null,plainRemainder,'consume'))
    statements.push({
      sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id${reversalEffect ? ', branch_name, addressed_branch_name' : ''}, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name, batch_id)
            VALUES (@product_id, @product_name, @branch_id${reversalEffect ? ', @branch_name, @addressed_branch_name' : ''}, 'return_reversal', @quantity, @unit_cost_usd, @unit_cost_khr, @reason, @reference_id, @user_id, @user_name, @batch_id)`,
      params: {
        product_id: productId,
        product_name: item.product_name,
        branch_id: branchIdForItem,
        ...(reversalEffect ? { branch_name: reversalEffect.effectName, addressed_branch_name: editAddressedLabel(reversalEffect) } : {}),
        quantity: -(Number(item.quantity) || 0),
        unit_cost_usd: item.cost_price_usd ?? null,
        unit_cost_khr: item.cost_price_khr ?? null,
        reason: `Return #${existing.return_number} updated - reversing previous restock`,
        reference_id: id,
        user_id: user?.id ?? null,
        user_name: actorSnapshot(user),
        // 0084: attributable only when one lot covered the whole reversal.
        batch_id: reversalLots.length === 1 && reversalLots[0].quantity === (Number(item.quantity) || 0) ? reversalLots[0].batchId : null,
      },
    })
  }

  // Old per-lot rows are reversed above; drop them before the re-apply writes
  // fresh ones for the edited item set (delete allocations first -- they
  // reference the return_items rows deleted on the next line).
  statements.push({ sql: 'DELETE FROM return_item_batch_allocations WHERE return_item_id IN (SELECT id FROM return_items WHERE return_id = @return_id)', params: { return_id: id } })
  statements.push({ sql: 'DELETE FROM return_items WHERE return_id = @return_id', params: { return_id: id } })

  let totalRefundUsd = 0
  let totalRefundKhr = 0
  for (const [itemIndex, item] of newItems.entries()) {
    const quantity = Number(item.quantity) || 0
    const refundUnitUsd = editRefundPrices[itemIndex]?.unitUsd ?? 0
    const refundUnitKhr = editRefundPrices[itemIndex]?.unitKhr ?? 0
    const totalUsd = Number((refundUnitUsd * quantity).toFixed(2))
    const totalKhr = Math.round(refundUnitKhr * quantity)
    const stockAction = normalizeStockAction(item)
    const returnToStock = stockAction === 'restock'
    const itemBranchId = item.branch_id || existing.branch_id || null
    totalRefundUsd += totalUsd
    totalRefundKhr += totalKhr

    const itemSplits: ReturnBatchSplit[] = []
    let resolvedBatchId: number | null = null
    const plan = editLotPlans[itemIndex] || { splits: [], plainQuantity: 0 }
    const fallbackReceive = returnToStock && !item.counted_original_condition && item.product_id && itemBranchId && plan.plainQuantity > 0 ? planReceiveBatchStock({
      productId: item.product_id, branchId: itemBranchId, quantity: plan.plainQuantity,
      receivedDate: existing.received_business_date || new Date(Date.parse(mutationStamp) + 7 * 60 * 60 * 1000).toISOString().slice(0, 10),
      provenanceKey: `return-edit:${id}:${itemIndex}`, notes: 'Received from customer return; original received date unavailable',
    }) : null
    const fallbackParams = fallbackReceive ? { returnBatchKey: fallbackReceive.batchKey } : {}
    const fallbackBatchSql = '(SELECT id FROM product_batches WHERE variant_product_id=@product_id AND batch_key=@returnBatchKey)'
    const recordedBatchSql = fallbackReceive && !plan.splits.length ? fallbackBatchSql : '@batch_id'
    if (returnToStock && item.product_id && itemBranchId) {
      // The lots were decided above, before any write: the sale's own lots
      // (last-drawn first), the operator's pick, or a refusal. Nothing here
      // invents a destination.
      for (const split of plan.splits) {
        const received = planProjectedCountedReturnReceive(exactEdit.get(item.product_id,itemBranchId),split.batchId,split.quantity)
        statements.push(...received.map((statement) => ({ sql: statement.sql, params: statement.params as Record<string, unknown> })))
        if (plan.splits.length === 1 && split.quantity === quantity) resolvedBatchId = split.batchId
        itemSplits.push({ batchId: split.batchId, branchId: itemBranchId, quantity: split.quantity, saleItemId: item.sale_item_id ?? null })
      }
      if (fallbackReceive) {
        const exact = exactEdit.get(item.product_id,itemBranchId)
        const capturedReceipt = exact.projectedReceiptByKey(fallbackReceive.batchKey)
        if (capturedReceipt!==null) statements.push(...planProjectedCountedReturnReceive(exact,capturedReceipt,plan.plainQuantity).map(statement=>({sql:statement.sql,params:statement.params as Record<string,unknown>})))
        else {
          const created = exact.receiveProjectedCreatedReceipt(fallbackReceive.batchKey,plan.plainQuantity)
          statements.unshift(...created.guards)
          statements.push(...fallbackReceive.metadataStatements.map(statement=>({sql:statement.sql,params:statement.params as Record<string,unknown>})),...created.statements)
        }
      }
      if(!fallbackReceive && plan.plainQuantity>0) statements.push(...planProjectedCountedReturnReceive(exactEdit.get(item.product_id,itemBranchId),null,plan.plainQuantity).map(statement=>({sql:statement.sql,params:statement.params as Record<string,unknown>})))
      touchedProductIds.add(item.product_id)
    }

    if (stockAction === 'damaged' && item.product_id && itemBranchId) {
      const choice=resolveDamagedReturnChoice(item)
      if(!choice.ok) return c.json({error:choice.error},400)
      const slices=[...plan.splits,...(plan.plainQuantity>0?[{batchId:null,quantity:plan.plainQuantity}]:[])]
      for(const slice of slices) {
        statements.push(...planDamagedReturnLine({productId:item.product_id,productName:item.product_name||null,branchId:itemBranchId,batchId:slice.batchId,
          returnIdSql:'@return_id',quantity:slice.quantity,reason:String(body.reason||existing.reason||'')||null,userId:user?.id??null,userName:actorSnapshot(user),
          tag:choice.tag,disposition:choice.disposition,unitCostUsd:item.cost_price_usd??null,unitCostKhr:item.cost_price_khr??null,
          projectedStock:exactEdit.get(item.product_id,itemBranchId)
        }).map(statement=>({sql:statement.sql,params:{...(statement.params as Record<string,unknown>),return_id:id}})))
      }
      touchedProductIds.add(item.product_id)
    }

    statements.push({
      sql: `INSERT INTO return_items (return_id, sale_item_id, product_id, product_name, quantity, applied_price_usd, applied_price_khr, cost_price_usd, cost_price_khr, total_usd, total_khr, return_to_stock, stock_action, stock_condition, branch_id, batch_id)
            VALUES (@return_id, @sale_item_id, @product_id, @product_name, @quantity, @applied_price_usd, @applied_price_khr, @cost_price_usd, @cost_price_khr, @total_usd, @total_khr, @return_to_stock, @stock_action, @stock_condition, @branch_id, ${recordedBatchSql})`,
      params: {
        return_id: id,
        stock_action: stockAction,stock_condition:item.stock_condition??null,
        sale_item_id: item.sale_item_id || null,
        product_id: item.product_id || null,
        product_name: item.product_name || null,
        quantity,
        applied_price_usd: refundUnitUsd,
        applied_price_khr: refundUnitKhr,
        cost_price_usd: item.cost_price_usd ?? null,
        cost_price_khr: item.cost_price_khr ?? null,
        total_usd: totalUsd,
        total_khr: totalKhr,
        return_to_stock: returnToStock ? 1 : 0,
        branch_id: itemBranchId,
        batch_id: resolvedBatchId, ...fallbackParams,
      },
    })

    // Allocation rows must follow their own return_item immediately. The
    // newest-id subquery is evaluated before any later item insert, so two
    // edited lines with multiple lots cannot bind every split to the last
    // line in the request.
    for (const split of itemSplits) {
      statements.push({
        sql: `INSERT INTO return_item_batch_allocations (return_item_id, sale_item_id, batch_id, branch_id, quantity)
              VALUES ((SELECT id FROM return_items WHERE return_id=@return_id ORDER BY id DESC LIMIT 1), @sale_item_id, @batch_id, @branch_id, @quantity)`,
        params: {
          return_id: id,
          sale_item_id: split.saleItemId ?? null,
          batch_id: split.batchId,
          branch_id: split.branchId ?? null,
          quantity: split.quantity,
        },
      })
    }

    if (fallbackReceive) statements.push({
      sql: `INSERT INTO return_item_batch_allocations(return_item_id,sale_item_id,batch_id,branch_id,quantity)
        VALUES((SELECT id FROM return_items WHERE return_id=@return_id ORDER BY id DESC LIMIT 1),@sale_item_id,${fallbackBatchSql},@branch_id,@quantity)`,
      params: { return_id: id, sale_item_id: item.sale_item_id || null, product_id: item.product_id,
        branch_id: itemBranchId, quantity: plan.plainQuantity, ...fallbackParams },
    })
    if (returnToStock && item.product_id && itemBranchId) {
      const editRestockLabel = editLabelFor(Number(itemBranchId) || null)
      statements.push({
        sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id${editRestockLabel ? ', branch_name, addressed_branch_name' : ''}, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name, batch_id)
              VALUES (@product_id, @product_name, @branch_id${editRestockLabel ? ', @branch_name, @addressed_branch_name' : ''}, 'return', @quantity, @unit_cost_usd, @unit_cost_khr, @reason, @reference_id, @user_id, @user_name, ${recordedBatchSql})`,
        params: {
          product_id: item.product_id,
          product_name: item.product_name || null,
          branch_id: itemBranchId,
          ...(editRestockLabel ? { branch_name: editRestockLabel.branchName, addressed_branch_name: editRestockLabel.addressedName } : {}),
          quantity,
          unit_cost_usd: item.cost_price_usd ?? null,
          unit_cost_khr: item.cost_price_khr ?? null,
          reason: `Return #${existing.return_number} updated: ${body.reason || existing.reason}`,
          reference_id: id,
          user_id: user?.id ?? null,
          user_name: actorSnapshot(user),
          // 0084: same single-lot-covers-all rule as the create path.
          batch_id: itemSplits.length === 1 && itemSplits[0].quantity === quantity ? itemSplits[0].batchId : null, ...fallbackParams,
        },
      })
    }
  }

  statements.push(...exactEdit.takeFinalPhysicalWrites())
  const exactTargets = exactEdit.projectedPhysicalTargets()
  statements.push({sql:`SELECT CASE WHEN
    NOT EXISTS(SELECT 1 FROM json_each(@targets) ctx WHERE
      (SELECT stock_quantity FROM products WHERE id=json_extract(ctx.value,'$.product.product_id')) IS NOT json_extract(ctx.value,'$.product.after'))
    AND NOT EXISTS(SELECT 1 FROM json_each(@targets) ctx,json_each(ctx.value,'$.branches') b WHERE
      (SELECT quantity FROM branch_stock WHERE product_id=json_extract(b.value,'$.product_id') AND branch_id=json_extract(b.value,'$.branch_id')) IS NOT json_extract(b.value,'$.after'))
    AND NOT EXISTS(SELECT 1 FROM json_each(@targets) ctx,json_each(ctx.value,'$.receipts') r WHERE
      (SELECT quantity FROM branch_batch_stock WHERE batch_id=COALESCE(json_extract(r.value,'$.batch_id'),(SELECT id FROM product_batches WHERE variant_product_id=json_extract(r.value,'$.product_id') AND batch_key=json_extract(r.value,'$.batch_key')))
        AND branch_id=json_extract(r.value,'$.branch_id')) IS NOT json_extract(r.value,'$.after'))
    THEN 1 ELSE json_extract('[1]','$[counted_quantity_conflict]') END`,params:{targets:JSON.stringify(exactTargets)}})

  // Named so the audit row below records the values this statement actually
  // wrote -- a recomputed copy would be a second source of truth that can
  // drift from the UPDATE it claims to describe.
  returnUpdateValues = {
    reason: body.reason || existing.reason,
    return_type: body.return_type || existing.return_type,
    notes: body.notes !== undefined ? body.notes : existing.notes,
    // The refund is derived from the sale lines, not accepted from the
    // client: a posted total is exactly the "restate what was paid" the
    // line-level resolution above exists to prevent.
    total_refund_usd: Number(totalRefundUsd.toFixed(2)),
    total_refund_khr: Math.round(totalRefundKhr),
    branch_id: body.branch_id || existing.branch_id,
    branch_name: branchName,
  }
  statements.push({
    sql: `UPDATE returns SET reason=@reason, return_type=@return_type, notes=@notes,
          total_refund_usd=@total_refund_usd, total_refund_khr=@total_refund_khr,
          branch_id=@branch_id, branch_name=@branch_name, updated_at=@updated_at WHERE id=@id`,
    params: {
      ...returnUpdateValues,
      updated_at: mutationStamp,
      id,
    },
  })

  if (editResolver.guards().length) statements.unshift(effectGuardStatement(editResolver.guards())!)
  let eventBytes = 0
  if (linkedSale) {
    const beforeStatus = String(linkedSale.sale_status || 'completed')
    if (projectedSaleStatus && projectedSaleStatus !== beforeStatus) {
      statements.push({
        sql: `UPDATE sales SET
          status_before_return=CASE WHEN COALESCE(sale_status,'completed') NOT IN ('returned','partial_return') THEN COALESCE(sale_status,'completed') ELSE status_before_return END,
          sale_status=@status,updated_at=@updatedAt WHERE id=@sale`,
        params: { status: projectedSaleStatus, updatedAt: mutationStamp, sale: linkedSale.id },
      })
      const event = buildSaleRecordEventsInsert([{
        saleId: linkedSale.id,
        sourceKind: 'return_edit', sourceId: receiptId, generation: 0,
        kind: 'status_changed', via: 'apply',
        subject: existing.return_number == null ? null : String(existing.return_number),
        actorId: authenticatedActorId, actorUsername: actorSnapshot(user), occurredAt: mutationStamp,
        changes: [{
          field: 'sale_status',
          before: { state: 'known_value', value: beforeStatus },
          after: { state: 'known_value', value: projectedSaleStatus },
        }],
      }])!
      eventBytes = event.eventsBytes
      statements.push(event.statement)
      saleEventProvenance = { source_kind: 'return_edit', source_id: receiptId, generation: 0, sale_id: linkedSale.id }
    }
  }
  statements.push({
    sql: `INSERT INTO return_mutation_receipts(
      id,actor_id,return_id,sale_id,mutation_kind,request_id,request_digest,request_json,response_json,occurred_at
    ) VALUES(@receipt,@actor,@returnId,@saleId,'edit',@request,@digest,@requestJson,@responseJson,@occurredAt)`,
    params: {
      receipt: receiptId, actor: authenticatedActorId, returnId,
      saleId: existing.sale_id || null, request: requestId, digest: requestDigest,
      requestJson, responseJson: JSON.stringify(fixedResponse), occurredAt: mutationStamp,
    },
  })
  const hasStockWrite = touchedProductIds.size > 0 || editReversedDamaged.length > 0 || newItems.some(item => normalizeStockAction(item) === 'damaged')
  assertSaleRecordBatchBounds(hasStockWrite ? stockTransactionStatementCount(statements.length) : statements.length, canonicalIntent, eventBytes)

  const plannedCount = hasStockWrite ? stockTransactionStatementCount(statements.length) : statements.length
  assertReturnCreateQueryBudget(queryLimit,statementsUsed(),plannedCount,12)
  routeStatements += plannedCount
  editDispatched = true
  if (hasStockWrite) await executeStockTransaction(db, statements, 'once')
  else { if (!db.batchOnce) throw new Error('Return edits require single-attempt atomic writes'); await db.batchOnce(statements) }

  } catch (error) {
    if (error instanceof ReturnCreateBudgetError) throw error
    // Pre-dispatch refusals first: an unproven merge read and the in-batch merge guard share one marker string.
    const mergeRefusal = returnMergeRefusal(error)
    if (mergeRefusal) return c.json(mergeRefusal.body, mergeRefusal.status)
    if (error instanceof ConsumedDamagedStockError) return c.json({ error: error.message }, 400)
    if (isCountedStockConflict(error) || String(error instanceof Error ? error.message : error).includes('merge_physical_origin_conflict')) return c.json({error:'The return or its stock source changed. Refresh before retrying.',code:'write_conflict',action:'reload_required'},409)
    const stockGuard = productStockGuardError(error)
    if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
    // All lot, branch, return-item and receipt writes share db.batch; a
    // conflict/storage failure rolls them all back before retry inspection.
    let retry: { return_id:number; request_digest:string; response_json:string } | undefined
    try { retry = await db.prepare(`SELECT return_id,request_digest,response_json FROM return_mutation_receipts
      WHERE actor_id=@actor AND mutation_kind='edit' AND request_id=@request`)
      .get<{ return_id: number; request_digest: string; response_json: string }>({ actor: authenticatedActorId, request: requestId })
    } catch (readError) {
      if (!editDispatched) throw readError
      return c.json({error:'The edit result could not be confirmed. Retry the same request.',code:'unknown_outcome',action:'retry_same_request'},503)
    }
    if (retry) {
      if (Number(retry.return_id) === returnId && retry.request_digest === requestDigest) {
        try { return c.json(JSON.parse(retry.response_json) as { id: number; updated_at: string }) }
        catch (_) { return c.json({error:'The edit result could not be confirmed. Retry the same request.',code:'unknown_outcome',action:'retry_same_request'},503) }
      }
      return c.json({ error: 'client_request_id was already used with different return edit data.', code: 'idempotency_conflict' }, 409)
    }
    if (error instanceof SaleRecordEventError) {
      return c.json({ error: error.message, code: 'return_edit_too_large' }, 400)
    }
    const transactionRefusal = stockTransactionRefusal(error)
    if (transactionRefusal) return c.json(transactionRefusal, 503)
    if (editDispatched) return c.json({error:'The edit result could not be confirmed. Retry the same request.',code:'unknown_outcome',action:'retry_same_request'},503)
    return c.json({
      error: `Failed to update return: ${(error as Error).message}`,
    }, 500)
  }

  // The row used to carry the submitted reason and nothing else, so the
  // Audit Log could not say what a return edit actually changed. Every field
  // this handler writes is now diffed against the pre-edit row.
  await audit(c.env, user?.id ?? null, actorSnapshot(user), 'update', 'return', id, {
    reason: body.reason,
    ...(saleEventProvenance ? { record_event: saleEventProvenance } : {}),
  }, changedFields(existing as unknown as Record<string, unknown>, returnUpdateValues, {
    keys: Object.keys(returnUpdateValues),
  }))
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'return_edit', id: Number(id) }))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
  c.executionCtx.waitUntil(bumpVersions(c.env, ['products', 'returns', 'sales']))
  c.executionCtx.waitUntil(broadcast(c.env, 'returns', { action: 'update', id: Number(id) }))
  if (existing.sale_id) {
    c.executionCtx.waitUntil(broadcast(c.env, 'sales', { action: 'update', id: existing.sale_id }))
  }

  return c.json(fixedResponse)
}

export default app
