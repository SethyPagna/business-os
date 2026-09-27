// Applies a StockCountPlan (lib/datedStockCountImport.ts's pure
// computation) as real DB writes. Kept in its own file, separate from
// the plan computation, per that file's own stated boundary ("does no
// I/O ... those are the caller's job").
//
// H-stock 1 (2026-09-27): the plan's deltas are relative to a baseline
// with this importer's own superseded movements UNDONE. The apply used to
// delete those movements without undoing their stock effect, so every
// re-apply of the same file added the prior run's effect again (stock 7,
// count 10, apply twice -> 13). And it wrote one D1 call per movement, so a
// failure mid-run left stock half-applied.
//
// Now the whole apply is ONE db.batch, in this order:
//   1. per product+branch, a guard that the set of prior, un-reverted
//      movements this importer recorded is still exactly what the plan saw
//      (a concurrent apply of the same file, or a ledger revert since
//      preview, fails the batch -- nothing is written);
//   2. the superseded rows and their provenance deleted -- in the same
//      batch that reverses their effect below, never without it;
//   3. every lot's ONE net change: minus the superseded movements' lot
//      effects (their recorded provenance, migration 0035), plus this
//      run's own lot actions, plus the plan's settlement moves
//      (batchRebalances). A lot this run creates takes its first receipt
//      through the shared planReceiveBatchStock. Increases are written
//      before decreases and every decrease is guarded and strict;
//   4. branch_stock moved by the NET of (new movements - superseded
//      movements), minus what the receipts in 3 already added, guarded
//      and strict the same way; the reversed receipts' received units come
//      off their lots; then products.stock_quantity recomputed from
//      branch_stock;
//   5. the new movement rows and their provenance.
// So applying the same file twice lands exactly on the counted quantity,
// with or without lots, and a failure anywhere leaves stock untouched.
//
// Transition table, one product+branch (P = prior run's signed effect of
// the dates being replaced, N = this run's signed effect, S = live stock):
//   first apply      P = 0          S -> S + N          = count
//   re-apply         P = prior N    S -> S - P + N'      = count (N' = N)
//   apply after a    P (still live) S -> S - P + N'      = count
//     real sale      -- the sale stays in S; only this importer's own
//                       effect is swapped.
//   reverted prior   excluded from P (its counter-movement already undid
//     movement       it) and left in the ledger with that counter-movement.
// The lots follow the SAME arithmetic (FX-stock F2): lot L -> L - p(L) +
// n(L) + s(L), where p/n are P/N's provenance on L and s the settlement.
// Summed over the lots, p is P, n is N and s is 0, so sum(lots) moves by
// exactly what branch_stock moves by, at every re-apply, whatever a sale
// took from which lot in between. Nothing is floored on either side: the
// plan lands every lot at zero or above, and a lot or branch that changed
// under it (a sale between plan and write) fails its guard -- 409,
// nothing written -- instead of being clamped into a fork. 39146f46
// clamped the lot reversal at zero but not the aggregate one, so a sale
// from the count's own lot left sum(lots) above branch_stock for good.
import type { D1Compat } from './db'
import { buildInClause, chunkForBinding } from './sqlBinding'
import { DATED_STOCK_COUNT_REASON, type StockCountPlan, type StockCountPlanMovement, type PlannedBatchAction } from './datedStockCountImport'
import {
  planReceiveBatchStock, planUnreceiveBatchStock, prepareReceiptLotTarget, type StockWriteStatement,
} from './productBatches'
import { validateCanonicalImportBranchIds, withCanonicalImportBranchWriteGuard } from './importBranchAuthority'

function groupKey(productId: number, branchId: number): string {
  return `${productId}:${branchId}`
}

// Thrown when the atomic batch refused because what the plan was computed
// from changed before it could be written. Nothing was applied.
export class DatedStockCountConflictError extends Error {
  constructor() {
    super('The stock count history for these products changed while this import was being applied. Nothing was changed; preview and apply again.')
    this.name = 'DatedStockCountConflictError'
  }
}

// A decrease the plan computed against live stock: first a guard that the
// row still holds it (a 0 fails the whole batch; see the error mapping),
// then a plain subtraction. Never clamped -- a clamp on one ledger and not
// the other is exactly the fork FX-stock F2 closes (see the header).
function guardedDecrease(table: 'branch_stock' | 'branch_batch_stock', rowSql: string, params: Record<string, unknown>): StockWriteStatement[] {
  const touched = table === 'branch_batch_stock' ? `, updated_at = datetime('now')` : ''
  return [
    {
      sql: `INSERT INTO stock_session_guards (guard_value)
            SELECT CASE WHEN EXISTS (SELECT 1 FROM ${table} WHERE ${rowSql} AND quantity >= @need) THEN 1 ELSE 0 END`,
      params,
    },
    { sql: `UPDATE ${table} SET quantity = quantity - @need${touched} WHERE ${rowSql}`, params },
  ]
}

function branchDeltaStatements(productId: number, branchId: number, delta: number): StockWriteStatement[] {
  const params = { productId, branchId, delta, need: -delta }
  if (delta < 0) return guardedDecrease('branch_stock', 'product_id = @productId AND branch_id = @branchId', params)
  return [{
    sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@productId, @branchId, @delta)
          ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = branch_stock.quantity + excluded.quantity`,
    params,
  }]
}

// A lot this run creates has no id until the batch runs; every statement
// that names it resolves it by the (product, batch_key) identity the
// receipt planner chose.
type LotRef = { kind: 'id'; batchId: number } | { kind: 'key'; productId: number; batchKey: string }

function lotIdSql(ref: LotRef, paramPrefix: string, params: Record<string, unknown>): string {
  if (ref.kind === 'id') {
    params[`${paramPrefix}Id`] = ref.batchId
    return `@${paramPrefix}Id`
  }
  params[`${paramPrefix}P`] = ref.productId
  params[`${paramPrefix}K`] = ref.batchKey
  return `(SELECT id FROM product_batches WHERE variant_product_id = @${paramPrefix}P AND batch_key = @${paramPrefix}K)`
}

export interface ApplyDatedStockCountPlanResult {
  movementsDeleted: number
  movementsApplied: number
  batchTrackedGroups: number
  plainGroups: number
}

export async function applyDatedStockCountPlan(
  db: D1Compat,
  plan: StockCountPlan,
  actor: { userId: number | null; userName: string | null } = { userId: null, userName: null },
): Promise<ApplyDatedStockCountPlanResult> {
  const branchIds = [...new Set([
    ...plan.finalBranchStock.map((row) => row.branchId),
    ...plan.movementsToCreate.map((row) => row.branchId),
    ...plan.supersededMovements.map((row) => row.branchId),
    ...plan.batchTopUps.map((row) => row.branchId),
    ...plan.batchCreates.map((row) => row.branchId),
    ...plan.batchDrains.map((row) => row.branchId),
    ...plan.batchDeactivations.map((row) => row.branchId),
  ])]
  const branchAuthorityError = await validateCanonicalImportBranchIds(db, branchIds)
  if (branchAuthorityError) throw new Error(branchAuthorityError)
  const guardedDb = withCanonicalImportBranchWriteGuard(db, branchIds)

  const statements: StockWriteStatement[] = []
  let usesSessionGuards = false

  // 1. Freshness guards (see the header). stock_session_guards'
  // CHECK(guard_value = 1) is the repo's in-batch assertion: a 0 aborts the
  // whole batch. The un-reverted rule matches datedStockCountRoute.ts.
  for (const fingerprint of plan.groupFingerprints) {
    usesSessionGuards = true
    statements.push({
      sql: `INSERT INTO stock_session_guards (guard_value)
            SELECT CASE WHEN COUNT(*) = @movementCount AND COALESCE(SUM(m.id), 0) = @movementIdSum THEN 1 ELSE 0 END
            FROM inventory_movements m
            WHERE m.reason = @reason AND m.product_id = @productId AND m.branch_id = @branchId
              AND NOT EXISTS (SELECT 1 FROM inventory_movements r WHERE r.reference_id = 'revert:' || m.id)`,
      params: { ...fingerprint, reason: DATED_STOCK_COUNT_REASON },
    })
  }

  // Per group: net aggregate delta and what the lot receipts add on their own.
  const netByGroup = new Map<string, { productId: number; branchId: number; net: number; receiptAdds: number; lots: boolean }>()
  const group = (productId: number, branchId: number) => {
    const key = groupKey(productId, branchId)
    let entry = netByGroup.get(key)
    if (!entry) {
      entry = { productId, branchId, net: 0, receiptAdds: 0, lots: false }
      netByGroup.set(key, entry)
    }
    return entry
  }

  // Per lot and branch: the ONE net stock change this apply makes to it, and
  // the units newly received onto it (step 3 writes both).
  const lotNets = new Map<string, { ref: LotRef; branchId: number; stock: number; received: number }>()
  const lotNet = (ref: LotRef, branchId: number) => {
    const key = `${ref.kind === 'id' ? `id:${ref.batchId}` : `key:${ref.productId}:${ref.batchKey}`}@${branchId}`
    let net = lotNets.get(key)
    if (!net) {
      net = { ref, branchId, stock: 0, received: 0 }
      lotNets.set(key, net)
    }
    return net
  }

  // 2. Reverse the superseded movements -- aggregate and lots by the same
  // full amounts -- and delete them. A prior receipt (+) comes back off its
  // lot and out of the lot's received units; a prior drain (-) goes back
  // onto its lot.
  const unreceive: StockWriteStatement[] = []
  for (const prior of plan.supersededMovements) {
    const entry = group(prior.productId, prior.branchId)
    entry.net -= prior.signedQuantity
    for (const action of prior.batchActions || []) {
      entry.lots = true
      const quantity = Number(action.quantity)
      if (!(Math.abs(quantity) > 0)) continue
      lotNet({ kind: 'id', batchId: action.batchId }, prior.branchId).stock -= quantity
      if (quantity > 0) unreceive.push(...planUnreceiveBatchStock({ batchId: action.batchId, quantity, totalCostUsd: null }))
    }
  }
  if (plan.movementsToDelete.length) {
    // D1 has no array bind and a 100-parameter limit per statement.
    for (const chunk of chunkForBinding(plan.movementsToDelete)) {
      const { sql, params } = buildInClause('id', chunk)
      // No FK cascade (migration 0035's own comment) -- this importer owns
      // both tables and deletes a superseded movement's provenance itself.
      statements.push({ sql: `DELETE FROM dated_stock_count_batch_actions WHERE movement_id IN (${sql})`, params })
      statements.push({ sql: `DELETE FROM inventory_movements WHERE id IN (${sql})`, params })
    }
  }

  // 3. This run's lot actions, then the settlement. A lot this run creates
  // resolves its identity now (a read) through the same receipt-target rule
  // every other receipt uses; its FIRST receipt goes through
  // planReceiveBatchStock, whose own guard re-checks that target inside the
  // batch and which also moves branch_stock (counted in receiptAdds). Every
  // other action on a lot -- an existing one, or a new one after its
  // creation -- joins that lot's net.
  const newLotKeys = new Map<string, string>() // `${product}:${date}` -> batch_key
  const newLotRef = (productId: number, date: string, label: string): LotRef => {
    const batchKey = newLotKeys.get(`${productId}:${date}`)
    if (!batchKey) throw new Error(`No received date resolved for ${label} on ${date}`)
    return { kind: 'key', productId, batchKey }
  }
  const refFor = (movement: StockCountPlanMovement, action: PlannedBatchAction): LotRef =>
    action.batchId != null ? { kind: 'id', batchId: action.batchId } : newLotRef(movement.productId, action.date, movement.productName)
  const receipts: StockWriteStatement[] = []
  for (const movement of plan.movementsToCreate) {
    const entry = group(movement.productId, movement.branchId)
    entry.net += movement.movementType === 'add' ? movement.quantity : -movement.quantity
    for (const action of movement.batchActions) {
      entry.lots = true
      const quantity = Number(action.quantity)
      if (!(Math.abs(quantity) > 0)) continue
      if (action.batchId == null && quantity > 0) {
        const lotKey = `${movement.productId}:${action.date}`
        if (!newLotKeys.has(lotKey)) {
          const target = await prepareReceiptLotTarget(db, { productId: movement.productId, receivedDate: action.date })
          newLotKeys.set(lotKey, target.batchKey)
          usesSessionGuards = true
          receipts.push(...planReceiveBatchStock({
            productId: movement.productId,
            branchId: movement.branchId,
            quantity,
            receivedDate: action.date,
            receiptLotTarget: target,
          }).statements)
          entry.receiptAdds += quantity
          continue
        }
      }
      const net = lotNet(refFor(movement, action), movement.branchId)
      net.stock += quantity
      if (quantity > 0) net.received += quantity
    }
  }
  // Plans built before FX-stock F2 carry no settlement.
  for (const move of plan.batchRebalances || []) {
    const quantity = Number(move.quantity)
    if (!(Math.abs(quantity) > 0)) continue
    group(move.productId, move.branchId).lots = true
    const ref: LotRef = move.batchId != null ? { kind: 'id', batchId: move.batchId } : newLotRef(move.productId, move.date, `product ${move.productId}`)
    lotNet(ref, move.branchId).stock += quantity
  }

  // Receipts, then every lot increase (activating the lot first -- 0154:
  // positive lot stock needs an active lot), then every lot decrease.
  statements.push(...receipts)
  const decreases: StockWriteStatement[] = []
  for (const net of lotNets.values()) {
    const params: Record<string, unknown> = { branchId: net.branchId, stock: net.stock, received: net.received, need: -net.stock }
    const idSql = lotIdSql(net.ref, 'lot', params)
    if (net.received > 0) {
      statements.push({
        sql: `UPDATE product_batches SET is_active = 1, received_quantity = COALESCE(received_quantity, 0) + @received,
                updated_at = CURRENT_TIMESTAMP WHERE id = ${idSql}`,
        params,
      })
    }
    if (net.stock > 0) {
      statements.push(
        { sql: `UPDATE product_batches SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${idSql} AND is_active IS NOT 1`, params },
        {
          sql: `INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (${idSql}, @branchId, @stock)
                ON CONFLICT(batch_id, branch_id) DO UPDATE SET quantity = branch_batch_stock.quantity + excluded.quantity,
                  updated_at = datetime('now')`,
          params,
        },
      )
    } else if (net.stock < 0) {
      usesSessionGuards = true
      decreases.push(...guardedDecrease('branch_batch_stock', `batch_id = ${idSql} AND branch_id = @branchId`, params))
    }
  }
  statements.push(...decreases)

  // 4. Aggregate: net of new minus superseded, less what the receipts in 3
  // already put on branch_stock; then the reversed receipts' received units
  // off their lots (after the stock writes, so an emptied lot is seen as
  // empty); then the product total from its branches.
  const productIds = new Set<number>()
  for (const entry of netByGroup.values()) {
    productIds.add(entry.productId)
    const remaining = entry.net - entry.receiptAdds
    if (remaining < 0) usesSessionGuards = true
    if (remaining !== 0) statements.push(...branchDeltaStatements(entry.productId, entry.branchId, remaining))
  }
  statements.push(...unreceive)
  for (const productId of productIds) {
    statements.push({
      sql: `UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @productId),
              updated_at = CURRENT_TIMESTAMP WHERE id = @productId`,
      params: { productId },
    })
  }

  // 5. Movement rows + provenance. inventory_movements is AUTOINCREMENT and
  // the batch is one transaction, so MAX(id) straight after the INSERT is
  // that row's id.
  for (const movement of plan.movementsToCreate) {
    const single = movement.batchActions.length === 1 && Math.abs(movement.batchActions[0].quantity) === movement.quantity
      ? movement.batchActions[0] : null
    const params: Record<string, unknown> = {
      productId: movement.productId,
      productName: movement.productName,
      branchId: movement.branchId,
      branchName: movement.branchName,
      movementType: movement.movementType,
      quantity: movement.quantity,
      reason: movement.reason,
      userId: actor.userId,
      userName: actor.userName,
      // Dated to the snapshot's own date -- a reconciliation import's
      // movement log is historical, not "whenever the file was uploaded".
      createdAt: `${movement.date} 00:00:00`,
    }
    // 0084: stamp the movement's batch_id when exactly ONE lot covered its
    // whole quantity; a multi-lot spread or a shortfall stays NULL.
    const batchIdSql = single ? lotIdSql(refFor(movement, single), 'lot', params) : 'NULL'
    statements.push({
      sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_id, user_name, created_at, batch_id)
            VALUES (@productId, @productName, @branchId, @branchName, @movementType, @quantity, @reason, @userId, @userName, @createdAt, ${batchIdSql})`,
      params,
    })
    movement.batchActions.forEach((action, index) => {
      if (!(Math.abs(action.quantity) > 0)) return
      const actionParams: Record<string, unknown> = { quantity: action.quantity }
      const idSql = lotIdSql(refFor(movement, action), `a${index}`, actionParams)
      statements.push({
        sql: `INSERT INTO dated_stock_count_batch_actions (movement_id, batch_id, quantity)
              VALUES ((SELECT MAX(id) FROM inventory_movements), ${idSql}, @quantity)`,
        params: actionParams,
      })
    })
  }

  if (usesSessionGuards) statements.push({ sql: 'DELETE FROM stock_session_guards', params: {} })

  try {
    await guardedDb.batch(statements)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/guard_value|stock_session_guards/i.test(message)) throw new DatedStockCountConflictError()
    throw error
  }

  let lotGroups = 0
  for (const entry of netByGroup.values()) if (entry.lots) lotGroups += 1
  const movementGroups = new Set(plan.movementsToCreate.map((m) => groupKey(m.productId, m.branchId)))
  return {
    movementsDeleted: plan.movementsToDelete.length,
    movementsApplied: plan.movementsToCreate.length,
    batchTrackedGroups: lotGroups,
    plainGroups: [...movementGroups].filter((key) => !netByGroup.get(key)?.lots).length,
  }
}
