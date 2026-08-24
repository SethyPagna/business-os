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
import { normalizeToIsoDate } from './batchCode'
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

export interface ParsedDatedCountEntry {
  date: string
  productId: number
  branchId: number
  count: number
}

export function parseDatedStockCountEntries(body: Record<string, unknown>): { entries: ParsedDatedCountEntry[] } | { error: string } {
  const raw = body.entries
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'entries is required and must be a non-empty array' }
  if (raw.length > MAX_DATED_STOCK_COUNT_ENTRIES) return { error: `Too many entries (max ${MAX_DATED_STOCK_COUNT_ENTRIES})` }

  const entries: ParsedDatedCountEntry[] = []
  for (let i = 0; i < raw.length; i += 1) {
    const row = (raw[i] || {}) as Record<string, unknown>
    const date = normalizeToIsoDate(row.date as string) || (ISO_DATE_RE.test(String(row.date ?? '')) ? String(row.date) : null)
    const productId = Number.parseInt(String(row.productId ?? ''), 10)
    const branchId = Number.parseInt(String(row.branchId ?? ''), 10)
    const count = Number(row.count)
    if (!date) return { error: `Row ${i + 1}: invalid or missing date` }
    if (!Number.isFinite(productId) || productId <= 0) return { error: `Row ${i + 1}: invalid or missing productId` }
    if (!Number.isFinite(branchId) || branchId <= 0) return { error: `Row ${i + 1}: invalid or missing branchId` }
    if (!Number.isFinite(count) || count < 0) return { error: `Row ${i + 1}: count must be a non-negative number` }
    entries.push({ date, productId, branchId, count })
  }
  return { entries }
}

// Builds the real StockCountPlan for a parsed, already-resolved entry
// list -- shared by /preview (read-only) and /apply (writes it). Looks up
// canonical product/branch names from the DB rather than trusting
// client-supplied strings (the client only ever sends ids), same as every
// other write endpoint in this app resolves productId to a real row
// before acting on it.
export async function buildDatedStockCountPlan(
  db: D1Compat,
  entries: ParsedDatedCountEntry[],
): Promise<{ plan: StockCountPlan } | { error: string; status: 400 | 404 }> {
  const productIds = [...new Set(entries.map((e) => e.productId))]
  const branchIds = [...new Set(entries.map((e) => e.branchId))]
  const pIn = productIds.map((_, i) => `@p${i}`).join(', ')
  const bIn = branchIds.map((_, i) => `@b${i}`).join(', ')
  const pParams = Object.fromEntries(productIds.map((id, i) => [`p${i}`, id]))
  const bParams = Object.fromEntries(branchIds.map((id, i) => [`b${i}`, id]))

  const productRows = await db.prepare(`SELECT id, name FROM products WHERE id IN (${pIn})`).all<{ id: number; name: string }>(pParams)
  const branchRows = await db.prepare(`SELECT id, name FROM branches WHERE id IN (${bIn})`).all<{ id: number; name: string }>(bParams)

  const productById = new Map(productRows.map((p) => [Number(p.id), p.name]))
  const branchById = new Map(branchRows.map((b) => [Number(b.id), b.name]))
  const missingProduct = productIds.find((id) => !productById.has(id))
  if (missingProduct != null) return { error: `Product ${missingProduct} not found`, status: 404 }
  const missingBranch = branchIds.find((id) => !branchById.has(id))
  if (missingBranch != null) return { error: `Branch ${missingBranch} not found`, status: 404 }

  const datedEntries: DatedCountEntry[] = entries.map((e) => ({
    date: e.date,
    productId: e.productId,
    productName: productById.get(e.productId) as string,
    branchId: e.branchId,
    branchName: branchById.get(e.branchId) as string,
    count: e.count,
  }))

  // Prior runs of THIS import mechanism, for the same product+branch pairs
  // -- reconstructing baseline on a rerun (see datedStockCountImport.ts's
  // own comment) needs to find and undo only its own past movements, so
  // this is scoped to `reason = DATED_STOCK_COUNT_REASON`, not every
  // movement on these rows.
  const pairKeys = new Set(entries.map((e) => `${e.productId}:${e.branchId}`))
  const priorMovementRows = await db.prepare(
    `SELECT id, product_id AS productId, branch_id AS branchId, quantity, movement_type AS movementType, created_at AS createdAt
     FROM inventory_movements
     WHERE reason = @reason AND product_id IN (${pIn}) AND branch_id IN (${bIn})`,
  ).all<{ id: number; productId: number; branchId: number; quantity: number; movementType: string; createdAt: string }>({
    reason: DATED_STOCK_COUNT_REASON,
    ...pParams,
    ...bParams,
  })
  // This same importer's own batch-level provenance for those prior
  // movements (migration 0035) -- needed so reconstructBatchBaseline can
  // reverse only ITS OWN prior batch effects on a rerun, not just its
  // prior aggregate movements. Scoped to the movement ids just loaded
  // above, same "only this importer's own rows" discipline the movement
  // lookup itself already follows via `reason = DATED_STOCK_COUNT_REASON`.
  const priorMovementIds = priorMovementRows.map((row) => Number(row.id))
  const batchActionsByMovementId = new Map<number, { batchId: number; quantity: number }[]>()
  if (priorMovementIds.length) {
    const mIn = priorMovementIds.map((_, i) => `@m${i}`).join(', ')
    const mParams = Object.fromEntries(priorMovementIds.map((id, i) => [`m${i}`, id]))
    const batchActionRows = await db.prepare(
      `SELECT movement_id AS movementId, batch_id AS batchId, quantity FROM dated_stock_count_batch_actions WHERE movement_id IN (${mIn})`,
    ).all<{ movementId: number; batchId: number; quantity: number }>(mParams)
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

  const stockRows = await db.prepare(
    `SELECT product_id AS productId, branch_id AS branchId, quantity FROM branch_stock WHERE product_id IN (${pIn}) AND branch_id IN (${bIn})`,
  ).all<{ productId: number; branchId: number; quantity: number }>({ ...pParams, ...bParams })
  const currentStock: CurrentStock[] = stockRows
    .filter((row) => pairKeys.has(`${row.productId}:${row.branchId}`))
    .map((row) => ({ productId: Number(row.productId), branchId: Number(row.branchId), quantity: Number(row.quantity) || 0 }))

  // Every active batch for the products involved, across every branch it
  // has stock at (not just the branches in this request) -- the plan
  // itself only reads whichever (productId, branchId) groups actually
  // appear in `entries`, same as computeDatedStockCountPlan's own
  // batchesByKey grouping already does; simpler to overfetch by product
  // here than to re-derive which branch each batch matters at.
  const batchRows = await db.prepare(
    `SELECT id, variant_product_id AS productId, received_at AS receivedAt FROM product_batches WHERE variant_product_id IN (${pIn}) AND is_active = 1`,
  ).all<{ id: number; productId: number; receivedAt: string | null }>(pParams)
  const batchIds = batchRows.map((b) => Number(b.id))
  let existingBatches: ExistingBatchState[] = []
  if (batchIds.length) {
    const btIn = batchIds.map((_, i) => `@bt${i}`).join(', ')
    const btParams = Object.fromEntries(batchIds.map((id, i) => [`bt${i}`, id]))
    const batchStockRows = await db.prepare(
      `SELECT batch_id AS batchId, branch_id AS branchId, quantity FROM branch_batch_stock WHERE batch_id IN (${btIn})`,
    ).all<{ batchId: number; branchId: number; quantity: number }>(btParams)
    const batchById = new Map(batchRows.map((b) => [Number(b.id), b]))
    existingBatches = batchStockRows
      .filter((row) => pairKeys.has(`${batchById.get(Number(row.batchId))?.productId}:${row.branchId}`))
      .map((row) => {
        const batch = batchById.get(Number(row.batchId))!
        return {
          batchId: Number(row.batchId),
          productId: Number(batch.productId),
          branchId: Number(row.branchId),
          date: normalizeToIsoDate(batch.receivedAt) || String(batch.receivedAt || '').slice(0, 10),
          quantity: Number(row.quantity) || 0,
        }
      })
  }

  const plan = computeDatedStockCountPlan(datedEntries, existingCountMovements, currentStock, existingBatches)
  return { plan }
}
