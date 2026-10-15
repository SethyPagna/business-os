import type { Env } from '../index'
import type { SessionUser } from './auth'
import { audit, buildAuditStatement } from './audit'
import { actorId, actorSnapshot, type ActorLike } from './actorSnapshot'
import { addressedStatements, type BranchEffect } from './branchRedirectWrite'
import { bumpVersion } from './cache'
import { catalogCostRecomputeIfChangedStatement, typedCostEntryBeforeWriteStatement } from './catalogCostRecompute'
import { getDb } from './db'
import { nullableMoney4, multiplyMoney4 } from './moneyPrecision'
import { getActionTier } from './permissions'
import { pendingActionApprovalStatements, type PendingActionRow, type ReviewPendingActionInput } from './pendingActions'
import { receiveBatchStock } from './productBatches'
import { appendReceiptNotes, FREE_GOODS_REASON_NOTE } from './stockReceiptGate'
import { resolveMergedCostDetail, type MergedCostOutlier } from './productDetailRule'
import { isRealBarcode, normalizeLeadingZeroBarcodeForCleanup } from './productIdentity'
import { ProductCreateError } from './productWrites'
import { executeStockMutationBatch, withStockMutationReceipt, type StockMutationAtomicMark, type StockMutationOutcome } from './stockMutationReceipt'
import { broadcast } from '../durable-objects/broadcastHub'
import { executeStockTransaction } from './stockTransaction'

// The Sep 16 2026 create-fold: a create request that identifies as the SAME
// product as an existing active row (findSameIdentityProduct) never mints a
// twin and never 409s -- it folds straight into the existing row. Keeps the
// existing row's id (every reference to it -- branch_stock, lots, sales --
// stays valid), cleans the stored barcode to the real zero-stripped code when
// the incoming one is real and the stored one was padded or a wildcard.
//
// Owner ruling 16 (13 Oct 2026): "A full-access create that matches an
// existing name + barcode folds into the existing product. Any starting
// quantity typed is recorded as a normal stock-in, never silently dropped."
// So there are two folds here:
//   - foldCreateIntoExisting: no starting quantity. Merges a non-zero incoming
//     cost through the distinct-cost averaging every other fold uses
//     (resolveMergedCostDetail). Behaviour unchanged since Sep 16.
//   - foldCreateWithStockIn: a starting quantity. The same barcode cleanup,
//     plus a NORMAL stock-in in the same D1 batch: a lot at the addressed
//     branch, its branch lot stock, branch_stock, the product total, the 'add'
//     movement and the catalog-cost recompute, with the fold's audit row. The
//     typed cost is the stock-in's own unit cost, so the catalog cost becomes
//     the quantity-weighted mean over the lots on hand (the 25 Sep rule) -- the
//     fold's distinct-cost mean is NOT also applied, which would count the
//     incoming cost twice. Mirrors Stock Session's create_receive fold
//     (lib/stockSession.ts), which converts a quantity>0 fold into an
//     ordinary receive line for the same reason.
//
// Returns 200, never 409 -- the whole point of the ruling is that a fold is
// not an error the operator has to resolve.

// A cost the requester typed: a 0 is a recorded $0, absent or blank is unknown (null). Local on purpose: this lib is loaded alone by
// source tests that stub every other relative import.
const typedCost = (value: unknown): number | null => {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null
  const cost = Number(value)
  return Number.isFinite(cost) && cost >= 0 ? cost : null
}

export type FoldDuplicate = { id: number; name: string; barcode: string; cost_price_usd: number | null; cost_price_khr: number | null }

/** Where a starting quantity lands: productCreateDestination's answer. */
export type FoldDestination = { branchId: number | null; quantity: number; landing: BranchEffect | null }

/**
 * What a request that carries a starting quantity is fingerprinted by in the stock-receipt table: the facts that
 * decide the stock delta and where it lands -- NOT the product, which a brand-new create does not have yet. One
 * function for both the create (lib/productWrites.ts writes a completed receipt in its own batch) and the fold
 * (which claims the same receipt), so a resend of one request is recognised as that request whichever of the two
 * the first attempt turned out to be.
 */
export function startingStockFingerprint(body: Record<string, unknown>, destination: { branchId: number | null; quantity: number }): Record<string, unknown> {
  return {
    client_request_id: body.client_request_id, source: 'product_starting_stock',
    name: String(body.name ?? '').trim(), barcode: String(body.barcode ?? '').trim(),
    branch_id: destination.branchId, quantity: destination.quantity, unit_cost_usd: typedCost(body.cost_price_usd),
    received_date: body.received_date ?? null, expiry_date: body.expiry_date ?? null,
  }
}

/** The barcode the fold stores on the survivor, or null when it keeps its own. */
export function foldBarcodeCleanup(duplicate: Pick<FoldDuplicate, 'barcode'>, incomingBarcodeRaw: unknown): string | null {
  if (!isRealBarcode(incomingBarcodeRaw)) return null
  const cleanedIncoming = normalizeLeadingZeroBarcodeForCleanup(String(incomingBarcodeRaw).trim().toLowerCase())
  const existingReal = isRealBarcode(duplicate.barcode)
  const existingStored = String(duplicate.barcode ?? '').trim()
  // Only rewrite the stored barcode when it is padded (its own clean form
  // differs) or it was a wildcard/broken value being replaced by a real
  // one -- never overwrite an already-clean real code with a different
  // spelling of the same identity.
  if (!existingReal || (existingStored.toLowerCase() !== cleanedIncoming
    && normalizeLeadingZeroBarcodeForCleanup(existingStored.toLowerCase()) === cleanedIncoming)) {
    return cleanedIncoming
  }
  return null
}

export async function foldCreateIntoExisting(
  env: Env,
  user: ActorLike,
  duplicate: FoldDuplicate,
  name: string,
  body: Record<string, unknown>,
  // Who typed the cost, when that is not the actor of record (an approval: the requester typed it, the reviewer approved).
  costActor: ActorLike = user,
): Promise<{ item: unknown; product: unknown; id: number; folded_into: number; success: true }> {
  const db = getDb(env)
  const updates: Record<string, unknown> = {}
  const cleanedBarcode = foldBarcodeCleanup(duplicate, body.barcode)
  if (cleanedBarcode !== null) updates.barcode = cleanedBarcode
  // A typed 0 is a recorded $0 and folds in; an absent or blank cost is unknown and changes nothing.
  const incomingCostUsd = typedCost(body.cost_price_usd)
  const incomingCostKhr = typedCost(body.cost_price_khr)
  let costOutliers: MergedCostOutlier[] = []
  if (incomingCostUsd !== null || incomingCostKhr !== null) {
    const { merged, outliers } = resolveMergedCostDetail([
      { cost_price_usd: duplicate.cost_price_usd, cost_price_khr: duplicate.cost_price_khr },
      { cost_price_usd: incomingCostUsd, cost_price_khr: incomingCostKhr },
    ])
    costOutliers = outliers
    if (merged.cost_price_usd !== undefined) updates.cost_price_usd = merged.cost_price_usd
    if (merged.cost_price_khr !== undefined) updates.cost_price_khr = merged.cost_price_khr
  }
  if (Object.keys(updates).length) {
    const setSql = Object.keys(updates).map((key) => `${key} = @${key}`).join(', ')
    const write = { sql: `UPDATE products SET ${setSql}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`, params: { ...updates, id: duplicate.id } }
    // U-cost: the folded cost was typed into the product form, so it records
    // the form's product_cost_entries row -- the 0195 triggers re-derive
    // cost_price_usd at every stock movement and honour only a cost with
    // one, so a bare write held until the next sale. Before the UPDATE (it
    // reads the preimage) in one batch; nothing when the cost is unmoved.
    const costEntry = typedCostEntryBeforeWriteStatement(duplicate.id, {
      ...(updates.cost_price_usd !== undefined ? { usd: updates.cost_price_usd as number } : {}),
      ...(updates.cost_price_khr !== undefined ? { khr: updates.cost_price_khr as number } : {}),
    }, { id: actorId(costActor), name: actorSnapshot(costActor) })
    if ('cost_price_usd' in updates || 'cost_price_khr' in updates) await executeStockTransaction(db, [...(costEntry ? [costEntry] : []), write], 'retry')
    else await db.prepare(write.sql).run(write.params)
  }
  await audit(env, actorId(user), actorSnapshot(user), 'fold', 'product', duplicate.id, {
    reason: 'create_identity_fold', requestedName: name, incomingBarcode: body.barcode, updates, costOutliers,
  })
  const item = await db.prepare('SELECT * FROM products WHERE id = @id').get({ id: duplicate.id })
  await bumpVersion(env, 'products')
  await broadcast(env, 'products', { action: 'update', id: duplicate.id }).catch(() => {})
  return { item, product: item, id: duplicate.id, folded_into: duplicate.id, success: true }
}

export type FoldStockInSummary = {
  quantity: number
  branch_id: number
  lot_code: string
  unit_cost_usd: number | null
  batch_id?: number
}

/**
 * The refusal for a create-fold that carries a starting quantity, or null. A stock-in on an EXISTING product is
 * an inventory adjust, whatever door it came through (lib/stockSession.ts requires the same of a create_receive
 * line, and POST /api/batches of any receipt): Full on inventory:adjust. Refused, never dropped.
 */
export function foldStockInPermissionRefusal(user: SessionUser | null): { status: 403; body: Record<string, unknown> } | null {
  if (user && getActionTier(user, 'inventory', 'adjust') === 'full') return null
  return { status: 403, body: { error: 'No permission to receive stock. The starting quantity was not recorded and nothing was changed.', code: 'permission_denied' } }
}

type FoldStockInOptions = {
  /** The receipt claim's atomic mark (direct path). Absent on the approval path, which marks the request instead. */
  atomicMark?: StockMutationAtomicMark
  /** The approval path: the pending action is marked approved by the same batch as the stock. */
  approval?: { row: PendingActionRow; reviewer: ReviewPendingActionInput }
  source: 'create_identity_fold' | 'review_create_identity_fold'
  /** Who is recorded on the movement and the audit row. */
  actor: { id: number | null; name: string | null }
  waitUntil?: (promise: Promise<unknown>) => void
  requestId?: string | null
}

// D1 statements the fold may still need after its one batch: the batch_receive audit, the cache version bump and the
// fresh read of the product row (the receipt completes inside the batch). Measured by
// scripts/test-create-fold-stock-in-native.cjs; a request that cannot fit is refused before it writes.
const FOLD_STOCK_IN_QUERY_RESERVE = 10

const REVIEW_CONFLICT = /bad JSON path: ['"]\$\[product_create_review_conflict\]['"]/i

/**
 * Fold the create into `duplicate` and record its starting quantity as an ordinary stock-in, every ledger in one
 * D1 batch (receiveBatchStock's: lot, branch lot stock, branch_stock, product total) together with the 'add'
 * movement, the catalog-cost recompute, the barcode cleanup and the fold's audit row. Nothing is committed unless
 * all of it is.
 */
export async function foldCreateWithStockInWrite(
  env: Env,
  duplicate: FoldDuplicate,
  name: string,
  body: Record<string, unknown>,
  destination: FoldDestination & { branchId: number },
  options: FoldStockInOptions,
): Promise<{ id: number; folded_into: number; success: true; stock_in: FoldStockInSummary }> {
  const db = getDb(env)
  const { branchId, quantity, landing } = destination
  const cleanedBarcode = foldBarcodeCleanup(duplicate, body.barcode)
  const incomingCostUsd = typedCost(body.cost_price_usd)
  const unitCostUsd = incomingCostUsd === null ? null : nullableMoney4(incomingCostUsd)
  const totalCostUsd = unitCostUsd == null ? null : multiplyMoney4(unitCostUsd, quantity)
  const receivedDate = typeof body.received_date === 'string' && body.received_date.trim() ? body.received_date : null
  const expiryDate = typeof body.expiry_date === 'string' && body.expiry_date.trim() ? body.expiry_date : null
  const productId = duplicate.id
  let lotCode = ''
  let outcome: StockMutationOutcome | undefined
  const baseMark = options.atomicMark
  const approvalStatements = options.approval ? pendingActionApprovalStatements(options.approval.row, options.approval.reviewer) : []
  const atomicMark: StockMutationAtomicMark = baseMark
    // Direct path: the receipt completes with the stock it describes, so a lost acknowledgement replays the answer.
    ? { ...baseMark, execute: (executeDb, statements) => executeStockMutationBatch(executeDb, statements, baseMark, outcome) }
    // Approval path: the request is marked approved by the same batch; a request decided meanwhile rolls it all back.
    : { statement: () => null, committed: () => {}, execute: async (executeDb, statements) => {
      await executeStockTransaction(executeDb, [...statements, ...approvalStatements], 'once')
    } }
  try {
    const received = await receiveBatchStock(db, {
      ordinaryReceiving: true,
      atomicMark,
      productId,
      branchId,
      quantity,
      receivedDate,
      expiryDate,
      unitCostUsd,
      buildBatchStatements: ({ batchKey, lotCode: plannedLot, resolvedBatchIdSql }) => {
        lotCode = plannedLot
        outcome = { status: 200, body: { success: true, id: productId, folded_into: productId,
          stock_in: { quantity, branch_id: branchId, lot_code: plannedLot, unit_cost_usd: unitCostUsd } } }
        return addressedStatements(landing, [
          ...(cleanedBarcode === null ? [] : [{
            sql: 'UPDATE products SET barcode = @foldBarcode, updated_at = CURRENT_TIMESTAMP WHERE id = @productId',
            params: { foldBarcode: cleanedBarcode, productId },
          }]),
          {
            sql: `
          INSERT INTO inventory_movements (
            product_id, product_name, branch_id, branch_name, movement_type, quantity,
            unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, reference_id, user_id, user_name,
            created_at, batch_id
          )
          VALUES (
            @productId, @productName, @branchId, (SELECT name FROM branches WHERE id = @branchId), 'add', @quantity,
            @unitCostUsd, @unitCostKhr, @totalCostUsd, @totalCostKhr, @reason, NULL, @userId, @userName,
            CURRENT_TIMESTAMP, ${resolvedBatchIdSql}
          )
        `,
            params: {
              productId, productName: duplicate.name, branchId, quantity, unitCostUsd, totalCostUsd,
              // A lot holds USD only, so the KHR side is unknown unless the receipt is declared free (a recorded 0).
              unitCostKhr: unitCostUsd === 0 ? 0 : null, totalCostKhr: unitCostUsd === 0 ? 0 : null,
              // The standard stock-in reason (routes/batches.ts), so the ledger reads like any other receipt. A typed $0
              // says so in the reason, as every accepted free-goods receipt does.
              reason: appendReceiptNotes(`Stock received (${plannedLot})`, unitCostUsd === 0 ? [FREE_GOODS_REASON_NOTE] : []),
              userId: options.actor.id, userName: options.actor.name, batchId: null, batchKey,
            },
          },
          catalogCostRecomputeIfChangedStatement(productId),
          buildAuditStatement(options.actor.id, options.actor.name, 'fold', 'product', productId, {
            reason: options.source, requestedName: name, incomingBarcode: body.barcode,
            updates: cleanedBarcode === null ? {} : { barcode: cleanedBarcode },
            stockIn: { quantity, branchId, lotCode: plannedLot, unitCostUsd },
            ...(options.requestId ? { clientRequestId: options.requestId } : {}),
            ...(options.approval ? { pendingActionId: options.approval.row.id, requestedBy: options.approval.row.requested_by_name ?? options.approval.row.requested_by ?? null } : {}),
          }),
        ])
      },
    })
    const summary: FoldStockInSummary = { quantity, branch_id: branchId, lot_code: received.lotCode || lotCode, unit_cost_usd: unitCostUsd, batch_id: received.batchId }
    const announce = Promise.all([
      audit(env, options.actor.id, options.actor.name, 'batch_receive', 'product_batch', received.batchId, {
        product_id: productId, product_name: duplicate.name, branch_id: branchId, quantity, lot_code: summary.lot_code, reason: null, source: options.source,
      }),
      bumpVersion(env, 'products'),
      broadcast(env, 'inventory', { type: 'batch_received', productId, branchId }),
      broadcast(env, 'products', { action: 'update', id: productId }),
    ]).catch(() => {})
    const { waitUntil } = options
    if (waitUntil) waitUntil(announce)
    else await announce
    return { id: productId, folded_into: productId, success: true, stock_in: summary }
  } catch (error) {
    if (REVIEW_CONFLICT.test(error instanceof Error ? error.message : String(error))) {
      throw new ProductCreateError('product_create_review_conflict', 'This product request changed or was already reviewed. Refresh the review queue.', 409)
    }
    throw error
  }
}

/**
 * The direct route's fold with a starting quantity: permission, the receipt claim on (actor, client_request_id)
 * and the write above. Answers { status, body } for the route to send; a retry whose answer was lost replays the
 * stored body, and `item` is re-read fresh either way.
 */
export async function foldCreateWithStockInResponse(
  env: Env,
  user: SessionUser,
  duplicate: FoldDuplicate,
  name: string,
  body: Record<string, unknown>,
  destination: FoldDestination & { branchId: number },
  options: { waitUntil?: (promise: Promise<unknown>) => void; invocation?: { used: () => number; limit: number } } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const db = getDb(env)
  const requestId = typeof body.client_request_id === 'string' ? body.client_request_id.trim() : null
  const receiptBody = startingStockFingerprint(body, destination)
  const response = await withStockMutationReceipt(
    () => db,
    user.id,
    'receive',
    receiptBody,
    (value, status) => new Response(JSON.stringify(value), { status: status ?? 200, headers: { 'content-type': 'application/json' } }),
    async (_markWritten, atomicMark) => {
      // Inside the claim, not before it: a resend of a request that already completed (including the create this
      // request first turned out to be) replays whatever the caller's grants are now; a refusal here writes nothing
      // and releases the claim.
      const refusal = foldStockInPermissionRefusal(user)
      if (refusal) return new Response(JSON.stringify(refusal.body), { status: refusal.status, headers: { 'content-type': 'application/json' } })
      const written = await foldCreateWithStockInWrite(env, duplicate, name, body, destination, {
        atomicMark, source: 'create_identity_fold', actor: { id: actorId(user), name: actorSnapshot(user) }, waitUntil: options.waitUntil, requestId,
      })
      return new Response(JSON.stringify(written), { status: 200, headers: { 'content-type': 'application/json' } })
    },
    { requireReceipt: true, budget: options.invocation ? { ...options.invocation, reserve: FOLD_STOCK_IN_QUERY_RESERVE } : undefined },
  )
  const answered = { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> }
  if (answered.status >= 200 && answered.status < 300) {
    // A replay of the CREATE this request first turned out to be names that product's id; otherwise it is the survivor.
    const item = await db.prepare('SELECT * FROM products WHERE id = @id').get({ id: Number(answered.body.id) || duplicate.id })
    return { status: answered.status, body: { ...answered.body, item, product: item } }
  }
  return answered
}
