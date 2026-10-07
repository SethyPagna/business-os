// Request-parsing + DB-lookup layer for the dated stock-reconciliation
// import route (routes/inventory.ts's POST /dated-stock-count/preview and
// /apply). Kept separate from the route handlers themselves -- same
// reasoning datedStockCountApply.ts's own top-of-file comment gives for
// splitting plan computation from I/O: this correctness-critical part
// (turning client-supplied ids into the exact plan inputs
// computeDatedStockCountPlan needs) can be tested against a real DB in
// isolation, instead of only being reachable through a full Hono request.
//
// Scope, deliberately: takes entries that are ALREADY resolved to real
// productId/branchId (not raw CSV rows). CSV column mapping, branch-name
// resolution, product matching/variant creation on an unmatched row, and
// price-conflict resolution all still happen upstream of this -- same
// gaps progress.md's open item on this feature already lists as separate,
// unbuilt work (the frontend upload/review UI's job).
import type { D1Compat } from './db'
import { buildInClause, chunkForBinding, selectInChunks } from './sqlBinding'
import { normalizeToIsoDate } from './batchCode'
import { importBranchRedirectGuards, validateCanonicalImportBranchIds } from './importBranchAuthority'
import {
  BranchRedirectTargetInvalidError, branchEffectRefusal, branchRedirectDetail, readBranchDirectory, resolveBranchEffect,
  type BranchRedirectDetail,
} from './branchEffect'
import { branchRole } from './branchRoles'
import {
  computeDatedStockCountPlan,
  DATED_STOCK_COUNT_REASON,
  type DatedCountEntry,
  type ExistingCountMovement,
  type CurrentStock,
  type ExistingBatchState,
  type StockCountPlan,
} from './datedStockCountImport'

export const MAX_DATED_STOCK_COUNT_ENTRIES = 5000
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// received_at comes straight out of D1 as ISO.
const lotDate = (receivedAt: string | null) =>
  normalizeToIsoDate(receivedAt, 'month-first') || String(receivedAt || '').slice(0, 10)

type LotAction = NonNullable<ExistingCountMovement['batchActions']>[number]
type StrayLotAction = { movement: ExistingCountMovement; action: LotAction; date: string | null; recorded: boolean }

// FX-stock4 E1. A product merge (routes/products.ts foldDuplicateProductInto,
// which every merge entry point calls) reparents the merged-away product's
// movements onto the keeper but leaves their provenance naming the lots they
// were recorded on: a lot folded into the keeper's same-batch_key lot stays
// behind on the merged-away product, deactivated and empty, and a written-off
// lot stays there with its stock cleared. Reversing such a movement onto the
// lot it names put units on a product that no longer sells and left the
// keeper's lots short of its branch_stock (R-stock3: keeper branch 9, lots 7,
// merged-away lot 2). So every superseded action whose lot is not the counted
// product's is moved, before the plan sees it, onto the counted product's lot
// with the same batch_key: exactly where the fold put that lot's units (a
// repointed lot keeps its key, and a chain of merges keeps it too). The
// receipt it reverses is still un-received from the lot that recorded it.
// Actions with no such lot (a written-off lot the keeper has no key for, or a
// lot that no longer exists) come back as strays for placeStrayLotActions.
async function resolveLotsToCountedProduct(db: D1Compat, movements: ExistingCountMovement[]): Promise<StrayLotAction[]> {
  const namedIds = [...new Set(movements.flatMap((m) => (m.batchActions || []).map((a) => Number(a.batchId))))]
  if (!namedIds.length) return []
  const lotRows = await selectInChunks(namedIds, 0, (chunk) => {
    const { sql, params } = buildInClause('lot', chunk)
    return db.prepare(
      `SELECT id, variant_product_id AS productId, batch_key AS batchKey, received_at AS receivedAt FROM product_batches WHERE id IN (${sql})`,
    ).all<{ id: number; productId: number; batchKey: string | null; receivedAt: string | null }>(params)
  })
  const lotById = new Map(lotRows.map((row) => [Number(row.id), row]))
  // Rare (only history a merge reparented), so one indexed read per key.
  const sameKeyLot = new Map<string, number | null>()
  const strays: StrayLotAction[] = []
  for (const movement of movements) {
    if (!movement.batchActions?.length) continue
    const resolved: LotAction[] = []
    for (const action of movement.batchActions) {
      const lot = lotById.get(Number(action.batchId))
      if (lot && Number(lot.productId) === movement.productId) {
        resolved.push(action)
        continue
      }
      let target: number | null = null
      if (lot && lot.batchKey != null) {
        const key = `${movement.productId}:${lot.batchKey}`
        if (!sameKeyLot.has(key)) {
          const row = await db.prepare('SELECT id FROM product_batches WHERE variant_product_id = @productId AND batch_key = @batchKey')
            .get<{ id: number }>({ productId: movement.productId, batchKey: lot.batchKey })
          sameKeyLot.set(key, row ? Number(row.id) : null)
        }
        target = sameKeyLot.get(key) ?? null
      }
      if (target != null) {
        resolved.push({ batchId: target, quantity: action.quantity, ...(action.quantity > 0 ? { receivedBatchId: Number(action.batchId) } : {}) })
      } else {
        strays.push({ movement, action, date: lot ? lotDate(lot.receivedAt) : null, recorded: Boolean(lot) })
      }
    }
    movement.batchActions = resolved
  }
  return strays
}

// The strays still have to move the counted product's lots by exactly what
// they move its branch_stock, or the ledgers fork (up for a reversed drain,
// down for a reversed receipt). They go onto the group's lot with the same
// received date, else its oldest lot (the FIFO head the plan walks first).
// A group with no lot at all has no lot ledger to keep level: the units stay
// on branch_stock only, the convention a movement with no provenance already
// follows, and nothing is ever written to another product's lot.
function placeStrayLotActions(strays: StrayLotAction[], existingBatches: ExistingBatchState[]): void {
  for (const { movement, action, date, recorded } of strays) {
    const lots = existingBatches
      .filter((b) => b.productId === movement.productId && b.branchId === movement.branchId)
      .sort((a, b) => a.date.localeCompare(b.date) || a.batchId - b.batchId)
    const target = lots.find((b) => date != null && b.date === date) || lots[0]
    if (!target) continue
    movement.batchActions = [
      ...(movement.batchActions || []),
      { batchId: target.batchId, quantity: action.quantity, ...(recorded && action.quantity > 0 ? { receivedBatchId: Number(action.batchId) } : {}) },
    ]
  }
}

export interface ParsedDatedCountEntry {
  date: string
  productId: number
  branchId: number
  count: number
  // CUTOVER-LR provenance a /resolve row carried: the disabled branch the sheet addressed, when `branchId` is the
  // landing the operator confirmed there. Kept only while that branch is still disabled.
  addressedBranchId?: number
}

export function parseDatedStockCountEntries(body: Record<string, unknown>): { entries: ParsedDatedCountEntry[] } | { error: string } {
  const raw = body.entries
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'entries is required and must be a non-empty array' }
  if (raw.length > MAX_DATED_STOCK_COUNT_ENTRIES) return { error: `Too many entries (max ${MAX_DATED_STOCK_COUNT_ENTRIES})` }

  const entries: ParsedDatedCountEntry[] = []
  for (let i = 0; i < raw.length; i += 1) {
    const row = (raw[i] || {}) as Record<string, unknown>
    // Entries arrive already resolved to ISO; a slash form could only come
    // from the mapped sheet, which is month-first (datedStockCountResolve.ts).
    const date = normalizeToIsoDate(row.date as string, 'month-first') || (ISO_DATE_RE.test(String(row.date ?? '')) ? String(row.date) : null)
    const productId = Number.parseInt(String(row.productId ?? ''), 10)
    const branchId = Number.parseInt(String(row.branchId ?? ''), 10)
    const count = Number(row.count)
    if (!date) return { error: `Row ${i + 1}: invalid or missing date` }
    if (!Number.isFinite(productId) || productId <= 0) return { error: `Row ${i + 1}: invalid or missing productId` }
    if (!Number.isFinite(branchId) || branchId <= 0) return { error: `Row ${i + 1}: invalid or missing branchId` }
    if (!Number.isFinite(count) || count < 0) return { error: `Row ${i + 1}: count must be a non-negative number` }
    const addressedBranchId = Number.parseInt(String(row.addressedBranchId ?? ''), 10)
    entries.push(Number.isSafeInteger(addressedBranchId) && addressedBranchId > 0
      ? { date, productId, branchId, count, addressedBranchId }
      : { date, productId, branchId, count })
  }
  return { entries }
}

// Builds the real StockCountPlan for a parsed, already-resolved entry
// list -- shared by /preview (read-only) and /apply (writes it). Looks up
// canonical product/branch names from the DB rather than trusting
// client-supplied strings (the client only ever sends ids), same as every
// other write endpoint in this app resolves productId to a real row
// before acting on it.
export type DatedStockCountPlanRefusal = { error: string; status: 400 | 404 } | { error: string; status: 409; code: string; redirect?: BranchRedirectDetail }

type RedirectedEntries = { entries: ParsedDatedCountEntry[]; addressedNames: Map<number, string>; guards: Array<{ addressed: number; effect: number; sells?: boolean }> }

// CUTOVER-LR (owner ruling 6 Oct 2026): an entry naming a disabled branch lands only on the active branch the
// request confirmed (X-Branch-Redirect); without one, or with one that cannot take it, the whole request is refused
// (409) and nothing is planned. An entry naming an active branch with a /resolve row's addressedBranchId keeps that
// provenance while the addressed branch is still disabled. While every branch is active this returns the entries
// untouched and the target is never read.
async function redirectDatedCountEntries(db: D1Compat, entries: ParsedDatedCountEntry[], target: number | null): Promise<RedirectedEntries | { refusal: { error: string; code: string; redirect?: BranchRedirectDetail } }> {
  const directory = await readBranchDirectory(db)
  const retired = new Set(directory.filter((row) => Number(row.is_active ?? 1) !== 1).map((row) => Number(row.id)))
  const addressedNames = new Map<number, string>()
  if (!retired.size) return { entries, addressedNames, guards: [] }
  const guards: RedirectedEntries['guards'] = []
  const out: ParsedDatedCountEntry[] = []
  try {
    for (const entry of entries) {
      if (retired.has(entry.branchId)) {
        const effect = resolveBranchEffect(directory, entry.branchId, { target })
        const landing = directory.find((row) => Number(row.id) === effect.effectBranchId)
        if (!landing || branchRole(landing) === 'other') {
          const detail = branchRedirectDetail(directory, entry.branchId, { requestedTargetId: target })
          if (detail) throw new BranchRedirectTargetInvalidError(detail)
        }
        addressedNames.set(entry.branchId, effect.addressedName ?? '')
        guards.push({ addressed: entry.branchId, effect: effect.effectBranchId })
        out.push({ date: entry.date, productId: entry.productId, branchId: effect.effectBranchId, count: entry.count, addressedBranchId: entry.branchId })
        continue
      }
      if (entry.addressedBranchId != null && retired.has(entry.addressedBranchId)) {
        const addressed = directory.find((row) => Number(row.id) === entry.addressedBranchId)
        addressedNames.set(entry.addressedBranchId, addressed?.name ?? '')
        guards.push({ addressed: entry.addressedBranchId, effect: entry.branchId })
        out.push(entry)
        continue
      }
      out.push({ date: entry.date, productId: entry.productId, branchId: entry.branchId, count: entry.count })
    }
  } catch (error) {
    const refusal = branchEffectRefusal(error)
    if (refusal) return { refusal }
    throw error
  }
  return { entries: out, addressedNames, guards }
}

export async function buildDatedStockCountPlan(
  db: D1Compat,
  requestedEntries: ParsedDatedCountEntry[],
  options: { redirectTarget?: number | null } = {},
): Promise<{ plan: StockCountPlan } | DatedStockCountPlanRefusal> {
  const redirected = await redirectDatedCountEntries(db, requestedEntries, options.redirectTarget ?? null)
  if ('refusal' in redirected) return { ...redirected.refusal, status: 409 }
  const entries = redirected.entries
  const productIds = [...new Set(entries.map((e) => e.productId))]
  const branchIds = [...new Set(entries.map((e) => e.branchId))]
  // D1 refuses any statement with more than 100 bound parameters, and a
  // dated stock count is a spreadsheet import -- `productIds` is however
  // many rows the file had. Branch ids stay whole (a business has a
  // handful of branches) and are counted as reserved parameters wherever
  // the two lists share a statement; the product list is what gets
  // chunked. See lib/sqlBinding.ts.
  const branchList = buildInClause('b', branchIds)
  const bIn = branchList.sql
  const bParams = branchList.params
  const productChunks = chunkForBinding(productIds, branchIds.length + 1)

  const productRows = await selectInChunks(productIds, 0, (chunk) => {
    const { sql, params } = buildInClause('p', chunk)
    return db.prepare(`SELECT id, name FROM products WHERE id IN (${sql})`).all<{ id: number; name: string }>(params)
  })
  const branchRows = await db.prepare(`SELECT id, name FROM branches WHERE id IN (${bIn})`).all<{ id: number; name: string }>(bParams)

  const productById = new Map(productRows.map((p) => [Number(p.id), p.name]))
  const branchById = new Map(branchRows.map((b) => [Number(b.id), b.name]))
  const missingProduct = productIds.find((id) => !productById.has(id))
  if (missingProduct != null) return { error: `Product ${missingProduct} not found`, status: 404 }
  const missingBranch = branchIds.find((id) => !branchById.has(id))
  if (missingBranch != null) return { error: `Branch ${missingBranch} not found`, status: 404 }
  const branchAuthorityError = await validateCanonicalImportBranchIds(db, branchIds)
  if (branchAuthorityError) return { error: branchAuthorityError, status: 400 }

  const datedEntries: DatedCountEntry[] = entries.map((e) => ({
    date: e.date,
    productId: e.productId,
    productName: productById.get(e.productId) as string,
    branchId: e.branchId,
    branchName: branchById.get(e.branchId) as string,
    count: e.count,
    ...(e.addressedBranchId != null && redirected.addressedNames.has(e.addressedBranchId)
      ? { addressedBranchName: redirected.addressedNames.get(e.addressedBranchId) || null } : {}),
  }))

  // Prior runs of THIS import mechanism, for the same product+branch pairs
  // -- reconstructing baseline on a rerun (see datedStockCountImport.ts's
  // own comment) needs to find and undo only its own past movements, so
  // this is scoped to `reason = DATED_STOCK_COUNT_REASON`, not every
  // movement on these rows.
  const pairKeys = new Set(entries.map((e) => `${e.productId}:${e.branchId}`))
  const priorMovementRows: Array<{ id: number; productId: number; branchId: number; quantity: number; movementType: string; createdAt: string }> = []
  for (const chunk of productChunks) {
    const { sql: pIn, params: pParams } = buildInClause('p', chunk)
    const rows = await db.prepare(
      `SELECT id, product_id AS productId, branch_id AS branchId, quantity, movement_type AS movementType, created_at AS createdAt
       FROM inventory_movements
       WHERE reason = @reason AND product_id IN (${pIn}) AND branch_id IN (${bIn})`,
    ).all<{ id: number; productId: number; branchId: number; quantity: number; movementType: string; createdAt: string }>({
      reason: DATED_STOCK_COUNT_REASON,
      ...pParams,
      ...bParams,
    })
    priorMovementRows.push(...rows)
  }
  // A prior movement someone reverted from the stock ledger
  // (lib/stockRevert.ts, reference_id 'revert:<id>') no longer holds its
  // effect in live stock -- its counter-movement took it back. It is left
  // alone: not deleted (that would orphan the counter-movement), not
  // reversed again, and not part of the baseline reconstruction. The apply
  // batch's per-group fingerprint uses the same rule (datedStockCountApply.ts).
  if (priorMovementRows.length) {
    const revertRefs = priorMovementRows.map((row) => `revert:${Number(row.id)}`)
    const reverted = await selectInChunks(revertRefs, 0, (chunk) => {
      const { sql: rIn, params: rParams } = buildInClause('r', chunk)
      return db.prepare(`SELECT reference_id AS ref FROM inventory_movements WHERE reference_id IN (${rIn})`)
        .all<{ ref: string }>(rParams)
    })
    const revertedIds = new Set(reverted.map((row) => Number(String(row.ref).slice('revert:'.length))))
    if (revertedIds.size) {
      const kept = priorMovementRows.filter((row) => !revertedIds.has(Number(row.id)))
      priorMovementRows.length = 0
      priorMovementRows.push(...kept)
    }
  }
  // This same importer's own batch-level provenance for those prior
  // movements (migration 0035) -- needed so reconstructBatchBaseline can
  // reverse only ITS OWN prior batch effects on a rerun, not just its
  // prior aggregate movements. Scoped to the movement ids just loaded
  // above, same "only this importer's own rows" discipline the movement
  // lookup itself already follows via `reason = DATED_STOCK_COUNT_REASON`.
  const priorMovementIds = priorMovementRows.map((row) => Number(row.id))
  const batchActionsByMovementId = new Map<number, { batchId: number; quantity: number }[]>()
  if (priorMovementIds.length) {
    const batchActionRows = await selectInChunks(priorMovementIds, 0, (chunk) => {
      const { sql: mIn, params: mParams } = buildInClause('m', chunk)
      return db.prepare(
        `SELECT movement_id AS movementId, batch_id AS batchId, quantity FROM dated_stock_count_batch_actions WHERE movement_id IN (${mIn})`,
      ).all<{ movementId: number; batchId: number; quantity: number }>(mParams)
    })
    for (const row of batchActionRows) {
      const key = Number(row.movementId)
      const bucket = batchActionsByMovementId.get(key)
      const entry = { batchId: Number(row.batchId), quantity: Number(row.quantity) }
      if (bucket) bucket.push(entry)
      else batchActionsByMovementId.set(key, [entry])
    }
  }

  const existingCountMovements: ExistingCountMovement[] = priorMovementRows
    .filter((row) => pairKeys.has(`${row.productId}:${row.branchId}`))
    .map((row) => ({
      id: Number(row.id),
      productId: Number(row.productId),
      branchId: Number(row.branchId),
      date: String(row.createdAt).slice(0, 10),
      signedQuantity: row.movementType === 'remove' ? -Number(row.quantity) : Number(row.quantity),
      batchActions: batchActionsByMovementId.get(Number(row.id)),
    }))
  // The movements this request supersedes (same product+branch, a date it
  // counts -- computeDatedStockCountPlan's own rule), their lot provenance
  // resolved onto the counted product (FX-stock4 E1).
  const countedDates = new Set(entries.map((e) => `${e.productId}:${e.branchId}:${e.date}`))
  const supersededMovements = existingCountMovements.filter((m) => countedDates.has(`${m.productId}:${m.branchId}:${m.date}`))
  const strayLotActions = await resolveLotsToCountedProduct(db, supersededMovements)

  const stockRows: Array<{ productId: number; branchId: number; quantity: number }> = []
  for (const chunk of productChunks) {
    const { sql: pIn, params: pParams } = buildInClause('p', chunk)
    const rows = await db.prepare(
      `SELECT product_id AS productId, branch_id AS branchId, quantity FROM branch_stock WHERE product_id IN (${pIn}) AND branch_id IN (${bIn})`,
    ).all<{ productId: number; branchId: number; quantity: number }>({ ...pParams, ...bParams })
    stockRows.push(...rows)
  }
  const currentStock: CurrentStock[] = stockRows
    .filter((row) => pairKeys.has(`${row.productId}:${row.branchId}`))
    .map((row) => ({ productId: Number(row.productId), branchId: Number(row.branchId), quantity: Number(row.quantity) || 0 }))

  // Every active batch for the products involved, across every branch it
  // has stock at (not just the branches in this request) -- the plan
  // itself only reads whichever (productId, branchId) groups actually
  // appear in `entries`, same as computeDatedStockCountPlan's own
  // batchesByKey grouping already does; simpler to overfetch by product
  // here than to re-derive which branch each batch matters at.
  const batchRows = await selectInChunks(productIds, 0, (chunk) => {
    const { sql: pIn, params: pParams } = buildInClause('p', chunk)
    return db.prepare(
      `SELECT id, variant_product_id AS productId, received_at AS receivedAt FROM product_batches WHERE variant_product_id IN (${pIn}) AND is_active = 1`,
    ).all<{ id: number; productId: number; receivedAt: string | null }>(pParams)
  })
  // FX-stock F2: every lot the provenance of a movement this plan
  // supersedes names (same product+branch, a date this request counts --
  // computeDatedStockCountPlan's own rule), active or not. A lot a prior
  // count drained may since have been emptied and soft-deleted; the
  // re-apply puts those units back on exactly that lot
  // (datedStockCountApply.ts), so the plan must see it too, or its lot
  // simulation runs short by those units and the ledgers fork.
  const supersededLots = supersededMovements
    .flatMap((m) => (m.batchActions || []).map((a) => ({ batchId: a.batchId, productId: m.productId, branchId: m.branchId })))
  const loadedBatchIds = new Set(batchRows.map((b) => Number(b.id)))
  const provenanceBatchIds = [...new Set(supersededLots.map((lot) => lot.batchId))].filter((id) => !loadedBatchIds.has(id))
  if (provenanceBatchIds.length) {
    batchRows.push(...await selectInChunks(provenanceBatchIds, 0, (chunk) => {
      const { sql: idIn, params: idParams } = buildInClause('pb', chunk)
      return db.prepare(
        `SELECT id, variant_product_id AS productId, received_at AS receivedAt FROM product_batches WHERE id IN (${idIn})`,
      ).all<{ id: number; productId: number; receivedAt: string | null }>(idParams)
    }))
  }
  const batchIds = batchRows.map((b) => Number(b.id))
  let existingBatches: ExistingBatchState[] = []
  if (batchIds.length) {
    const batchStockRows = await selectInChunks(batchIds, 0, (chunk) => {
      const { sql: btIn, params: btParams } = buildInClause('bt', chunk)
      return db.prepare(
        `SELECT batch_id AS batchId, branch_id AS branchId, quantity FROM branch_batch_stock WHERE batch_id IN (${btIn})`,
      ).all<{ batchId: number; branchId: number; quantity: number }>(btParams)
    })
    const batchById = new Map(batchRows.map((b) => [Number(b.id), b]))
    const dateOf = (batch: { receivedAt: string | null }) => lotDate(batch.receivedAt)
    // A lot loaded only because provenance names it joins only the group
    // (its branch) that provenance names -- not every counted branch it has
    // a row at, where it is inactive and no concern of this count.
    const provenanceOnly = new Set(provenanceBatchIds)
    const provenancePairs = new Set(supersededLots.map((lot) => `${lot.batchId}:${lot.branchId}`))
    existingBatches = batchStockRows
      .filter((row) => !provenanceOnly.has(Number(row.batchId)) || provenancePairs.has(`${Number(row.batchId)}:${Number(row.branchId)}`))
      .filter((row) => pairKeys.has(`${batchById.get(Number(row.batchId))?.productId}:${row.branchId}`))
      .map((row) => {
        const batch = batchById.get(Number(row.batchId))!
        return {
          batchId: Number(row.batchId),
          productId: Number(batch.productId),
          branchId: Number(row.branchId),
          date: dateOf(batch),
          quantity: Number(row.quantity) || 0,
        }
      })
    // Such a lot with no stock row at the movement's branch holds 0 there;
    // it still has to be in the plan, with its own date.
    const present = new Set(existingBatches.map((b) => `${b.batchId}:${b.branchId}`))
    for (const lot of supersededLots) {
      const batch = batchById.get(lot.batchId)
      const key = `${lot.batchId}:${lot.branchId}`
      if (!batch || Number(batch.productId) !== lot.productId || present.has(key)) continue
      present.add(key)
      existingBatches.push({ batchId: lot.batchId, productId: lot.productId, branchId: lot.branchId, date: dateOf(batch), quantity: 0 })
    }
  }
  placeStrayLotActions(strayLotActions, existingBatches)

  const plan = computeDatedStockCountPlan(datedEntries, existingCountMovements, currentStock, existingBatches)
  const branchRedirects = importBranchRedirectGuards(redirected.guards)
  if (branchRedirects.length) plan.branchRedirects = branchRedirects
  return { plan }
}
