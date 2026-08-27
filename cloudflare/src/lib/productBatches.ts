// Batch / lot / expiry-date tracking.
//
// Schema (cloudflare/migrations/0001_init.sql) has carried `product_batches`,
// `branch_batch_stock`, `sale_item_batch_allocations`, and
// `return_item_batch_allocations` since the original Postgres->D1 migration,
// but until now nothing in this app ever wrote to them (see the removed-
// route comment in routes/products.ts's old `/stats` handler, and the
// disclosure comment at the top of routes/inventory.ts) -- every batch
// query returned empty/zero. This file is the first real implementation:
// routes/batches.ts (CRUD + POS lookups) and routes/sales.ts (stock
// deduct/restore on sale/return) both depend on it.
//
// Design notes:
// - `product_batches.variant_product_id` is the FK to `products.id` --
//   named `variant_product_id` (not `product_id`) because a "product" row
//   in this app's model can itself be one variant of a grouped product;
//   batches always belong to one specific product row, never a group.
// - A batch's stock is per-branch, in `branch_batch_stock` (batch_id,
//   branch_id) -- the same batch can have different quantities sitting at
//   different branches, mirroring how plain (non-batched) stock already
//   works via `branch_stock`.
// - `product_batches.batch_key` + the unique index on
//   (variant_product_id, batch_key) is what lets `receiveBatchStock` "top
//   up" an existing batch instead of always creating a new row: when the
//   cashier/admin provides a lot code, batch_key is that lot code
//   (normalized), so receiving stock against the same lot code twice adds
//   to the same batch. Receipts with no lot code always create a new batch
//   (there's nothing to match on), keyed by a generated value that can
//   never collide with a real lot code.
// - FIFO ordering (`listBatchesForProduct`) is oldest-expiry-first, then
//   oldest-received-first, then id -- "sell the lot that expires soonest",
//   the standard expiry-tracked-inventory rule referenced in
//   routes/inventory.ts's disclosure comment.
import type { D1Compat } from './db'
import { dateToBatchCode, normalizeToIsoDate } from './batchCode'
import { buildInClause, selectInChunks } from './sqlBinding'

export type ProductBatchRow = {
  id: number
  lot_code: string | null
  expiry_date: string | null
  received_at: string | null
  notes: string | null
  is_active: number
  quantity: number
  batch_number: number | null
}

function normalizeLotCode(lotCode: string | null | undefined): string | null {
  const trimmed = String(lotCode || '').trim()
  return trimmed ? trimmed : null
}

// Generated batch_key for lot-code-less receipts -- guaranteed not to
// collide with any normalized real lot code, which is always trimmed
// (so this leading/trailing-space-free-but-still-not-a-real-code marker
// can never equal one).
function generateBatchKey(): string {
  return ` no-lot:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
}

// GET /api/batches/tracked-product-ids -- product ids the POS should force
// through the batch-picker (ProductDetailSheet) instead of a one-tap add.
// A product counts as "tracked" if it has at least one active batch; when
// branchId is given, further scoped to products that actually have a
// branch_batch_stock row at that branch (a product batch-tracked only at
// other branches shouldn't force the picker here).
// Per-product batch COUNT for a list badge (Products + Inventory). The list
// reads deliberately do NOT ship every product's full batch array
// (production has ~6,700 batches -- the detail view loads them on demand),
// but the row badge still needs the real number instead of the 0 an absent
// array produced. So this attaches a scalar `batch_count` per row: the
// number of ACTIVE batches that still hold stock somewhere. Chunked for
// D1's bound-parameter limit (see lib/sqlBinding.ts). One implementation,
// used by both routes/inventory.ts and routes/products.ts, so the two pages
// can never disagree on how a batch is counted.
export async function attachBatchCounts(db: D1Compat, items: Array<Record<string, unknown>>): Promise<void> {
  const ids = Array.from(new Set(items.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0)))
  if (!ids.length) return
  const rows = await selectInChunks(ids, 0, (chunk) => {
    const { sql, params } = buildInClause('id', chunk)
    return db.prepare(`
      SELECT pb.variant_product_id AS product_id, COUNT(DISTINCT pb.id) AS batch_count
      FROM product_batches pb
      JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id AND bbs.quantity > 0
      WHERE pb.is_active = 1 AND pb.variant_product_id IN (${sql})
      GROUP BY pb.variant_product_id
    `).all<{ product_id: number; batch_count: number }>(params)
  })
  const countByProduct = new Map<number, number>()
  for (const row of rows) countByProduct.set(Number(row.product_id), Number(row.batch_count) || 0)
  for (const item of items) item.batch_count = countByProduct.get(Number(item.id)) || 0
}

export async function getTrackedProductIds(db: D1Compat, branchId: number | null): Promise<number[]> {
  const sql = branchId
    ? `SELECT DISTINCT pb.variant_product_id AS productId
       FROM product_batches pb
       JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id AND bbs.branch_id = @branchId
       WHERE pb.is_active = 1`
    : `SELECT DISTINCT pb.variant_product_id AS productId
       FROM product_batches pb
       WHERE pb.is_active = 1`
  const rows = await db.prepare(sql).all<{ productId: number }>(branchId ? { branchId } : {})
  return rows.map((row) => Number(row.productId)).filter((id) => Number.isFinite(id))
}

// GET /api/batches?productId=&branchId= -- every active batch for one
// product, with that batch's quantity at the given branch (0 if the batch
// has no stock at that branch), FIFO-ordered (soonest expiry first, then
// oldest received, then id).
export async function listBatchesForProduct(
  db: D1Compat,
  productId: number,
  branchId: number,
  options: { onlyAvailable?: boolean } = {},
): Promise<ProductBatchRow[]> {
  const rows = await db.prepare(`
    SELECT
      pb.id AS id,
      pb.lot_code AS lot_code,
      pb.expiry_date AS expiry_date,
      pb.received_at AS received_at,
      pb.notes AS notes,
      pb.is_active AS is_active,
      pb.batch_number AS batch_number,
      COALESCE(bbs.quantity, 0) AS quantity
    FROM product_batches pb
    LEFT JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id AND bbs.branch_id = @branchId
    WHERE pb.variant_product_id = @productId AND pb.is_active = 1
    ${options.onlyAvailable ? 'AND COALESCE(bbs.quantity, 0) > 0' : ''}
    ORDER BY (pb.expiry_date IS NULL), pb.expiry_date ASC, pb.received_at ASC, pb.id ASC
  `).all<ProductBatchRow>({ productId, branchId })
  return rows.map((row) => ({ ...row, quantity: Number(row.quantity) || 0 }))
}

// Next per-product batch number -- stable once assigned (see migration
// 0016's backfill comment), computed fresh from the existing max rather
// than tracked as a separate counter row, matching the rest of this
// codebase's "derive from existing data" preference over adding new
// stateful counters. Only ever called for a genuinely NEW batch (a
// lot-code top-up reuses its existing row/number, see receiveBatchStock
// below).
async function nextBatchNumber(db: D1Compat, productId: number): Promise<number> {
  const row = await db.prepare(
    'SELECT COALESCE(MAX(batch_number), 0) + 1 AS next FROM product_batches WHERE variant_product_id = @productId',
  ).get<{ next: number }>({ productId })
  return Number(row?.next) || 1
}

// POST /api/batches -- receive stock into a batch. Creates a new batch, or
// tops up an existing one (same product + same date-derived batch code, or
// an explicit batchId from an interactive picker -- see Inventory's
// mandatory add-stock batch selection, routes/inventory.ts's /adjust).
// The batch code is no longer an operator-typed lot code -- "lot code can
// be removed... batch column is just a translated version of received
// date" (see lib/batchCode.ts's dateToBatchCode) -- so a receipt on the
// same calendar date as an existing batch on this product naturally tops
// that batch up, the same way a matching typed lot code used to.
//
// Also the ONLY place that should ever move branch_batch_stock, since it's
// the one function that keeps three figures in sync atomically: the
// batch's own per-branch quantity, the plain per-branch aggregate
// (branch_stock), and the denormalized per-product total
// (products.stock_quantity). Earlier versions of this function only wrote
// branch_batch_stock -- receiving stock through ReceiveBatchModal silently
// never moved the product's visible/aggregate stock anywhere else in the
// app (Products list, POS one-tap add, stats all read branch_stock/
// stock_quantity, never branch_batch_stock directly). Fixed here rather
// than patched at each caller, same "one place, not every write site"
// preference the rest of this file already follows (mirrorCostFields,
// nextBatchNumber).
export async function receiveBatchStock(db: D1Compat, input: {
  productId: number
  branchId: number
  quantity: number
  expiryDate?: string | null
  // Read as mm/dd/yyyy (see batchCode.ts's normalizeToIsoDate) or this
  // app's own ISO date shape; blank/omitted defaults to today, same as
  // every other receive-stock date field in this app.
  receivedDate?: string | null
  notes?: string | null
  // Explicit existing batch chosen by the person (Inventory's add-stock
  // batch picker) -- when given, this always wins over date matching;
  // must actually belong to productId (see validation below) so a caller
  // that resolved a *different* target product after fetching this
  // product's batch list (the price-unlock case in routes/inventory.ts)
  // can't silently top up the wrong product's batch.
  batchId?: number | null
}): Promise<{ batchId: number; created: boolean; batchNumber: number | null; lotCode: string }> {
  const resolvedIso = normalizeToIsoDate(input.receivedDate) || new Date().toISOString().slice(0, 10)
  const lotCode = dateToBatchCode(resolvedIso) as string
  const batchKey = lotCode

  let batchId: number | null = null
  let batchNumber: number | null = null

  if (input.batchId != null) {
    const explicit = await db.prepare(
      'SELECT id, batch_number FROM product_batches WHERE id = @id AND variant_product_id = @productId',
    ).get<{ id: number; batch_number: number | null }>({ id: input.batchId, productId: input.productId })
    if (!explicit) throw new Error('Selected batch does not belong to this product')
    batchId = Number(explicit.id)
    batchNumber = explicit.batch_number != null ? Number(explicit.batch_number) : null
  } else {
    const existing = await db.prepare(
      'SELECT id, batch_number FROM product_batches WHERE variant_product_id = @productId AND batch_key = @batchKey',
    ).get<{ id: number; batch_number: number | null }>({ productId: input.productId, batchKey })
    if (existing) { batchId = Number(existing.id); batchNumber = existing.batch_number != null ? Number(existing.batch_number) : null }
  }

  let created = false
  if (batchId == null) {
    // Assigned once at creation, same rule migration 0016's index/backfill
    // comment documents -- a batch_number is never reused or shifted, so
    // "Batch <n>" stays a stable reference even if an earlier batch is
    // later deactivated.
    const nextNumber = await nextBatchNumber(db, input.productId)
    const inserted = await db.prepare(`
      INSERT INTO product_batches (variant_product_id, batch_key, lot_code, expiry_date, received_at, is_active, notes, batch_number)
      VALUES (@productId, @batchKey, @lotCode, @expiryDate, @receivedAt, 1, @notes, @batchNumber)
    `).run({
      productId: input.productId,
      batchKey,
      lotCode,
      expiryDate: input.expiryDate || null,
      receivedAt: resolvedIso,
      notes: input.notes || null,
      batchNumber: nextNumber,
    })
    batchId = Number(inserted.lastInsertRowid)
    batchNumber = nextNumber
    created = true
  } else {
    // Topping up an existing lot -- reactivate it (a previously-deactivated
    // batch receiving new stock should become sellable again) and let a
    // newly-supplied expiry/notes refresh the stored ones, matching how
    // PATCH /:id already treats these fields as independently updatable.
    const updates: string[] = ['is_active = 1', `updated_at = datetime('now')`]
    const params: Record<string, unknown> = { id: batchId }
    if (input.expiryDate !== undefined && input.expiryDate !== null) { updates.push('expiry_date = @expiryDate'); params.expiryDate = input.expiryDate }
    if (input.notes !== undefined && input.notes !== null) { updates.push('notes = @notes'); params.notes = input.notes }
    await db.prepare(`UPDATE product_batches SET ${updates.join(', ')} WHERE id = @id`).run(params)
  }

  // Atomic three-way write -- same db.batch() atomicity guarantee
  // applyStockDelta (routes/inventory.ts) already relies on for its own
  // two-statement version; extended here with the batch-stock row.
  await db.batch([
    {
      sql: `INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (@batchId, @branchId, @quantity)
            ON CONFLICT(batch_id, branch_id) DO UPDATE SET quantity = quantity + @quantity, updated_at = datetime('now')`,
      params: { batchId, branchId: input.branchId, quantity: input.quantity },
    },
    {
      sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@productId, @branchId, @quantity)
            ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
      params: { productId: input.productId, branchId: input.branchId, quantity: input.quantity },
    },
    {
      sql: 'UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) + @quantity, updated_at = CURRENT_TIMESTAMP WHERE id = @productId',
      params: { productId: input.productId, quantity: input.quantity },
    },
  ])

  return { batchId, created, batchNumber, lotCode }
}

// Thrown by removeStockFromBatch when the chosen batch doesn't have enough
// at this branch -- distinct from a generic Error so routes/inventory.ts
// can report the batch's own available figure, not just "insufficient
// stock" (which would be misleading if the *product* has plenty of stock
// sitting in a different batch/lot).
export class InsufficientBatchStockError extends Error {
  available: number
  constructor(available: number) {
    super(`Only ${available} available in this batch at this branch`)
    this.name = 'InsufficientBatchStockError'
    this.available = available
  }
}

// Mirror of receiveBatchStock for the remove side of mandatory batch
// selection (Inventory's "Adjust stock" > Remove, see routes/inventory.ts's
// /adjust). Validates against the BATCH's own quantity at this branch, not
// just the product's overall total -- a product can have plenty of total
// stock while the specific lot the person picked has less than they're
// trying to remove, and that's a real error, not something to silently
// satisfy from a different batch behind their back. Same three-way atomic
// write as receiveBatchStock, decrementing instead of incrementing, with
// the same MAX(0, ...) floor guard routes/inventory.ts's own decrement
// path already uses so a race can never push either figure negative.
export async function removeStockFromBatch(db: D1Compat, input: {
  batchId: number
  productId: number
  branchId: number
  quantity: number
}): Promise<{ productName: string | null; lotCode: string | null; batchNumber: number | null }> {
  const batch = await db.prepare(`
    SELECT pb.id AS id, p.name AS productName, pb.lot_code AS lotCode, pb.batch_number AS batchNumber, COALESCE(bbs.quantity, 0) AS available
    FROM product_batches pb
    JOIN products p ON p.id = pb.variant_product_id
    LEFT JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id AND bbs.branch_id = @branchId
    WHERE pb.id = @batchId AND pb.variant_product_id = @productId
  `).get<{ id: number; productName: string | null; lotCode: string | null; batchNumber: number | null; available: number }>({
    batchId: input.batchId,
    productId: input.productId,
    branchId: input.branchId,
  })
  if (!batch) throw new Error('Selected batch does not belong to this product')
  const available = Number(batch.available) || 0
  if (input.quantity > available) throw new InsufficientBatchStockError(available)

  await db.batch([
    {
      sql: `UPDATE branch_batch_stock SET quantity = MAX(0, quantity - @quantity), updated_at = datetime('now')
            WHERE batch_id = @batchId AND branch_id = @branchId`,
      params: { batchId: input.batchId, branchId: input.branchId, quantity: input.quantity },
    },
    {
      sql: `UPDATE branch_stock SET quantity = MAX(0, quantity - @quantity) WHERE product_id = @productId AND branch_id = @branchId`,
      params: { productId: input.productId, branchId: input.branchId, quantity: input.quantity },
    },
    {
      sql: `UPDATE products SET stock_quantity = MAX(0, COALESCE(stock_quantity, 0) - @quantity), updated_at = CURRENT_TIMESTAMP WHERE id = @productId`,
      params: { productId: input.productId, quantity: input.quantity },
    },
  ])

  return { productName: batch.productName, lotCode: batch.lotCode, batchNumber: batch.batchNumber }
}

// Resolves which batch a transferred lot should land in at the
// destination, for the one case where the destination isn't literally the
// same product row: routes/branches.ts's identity-merge (findIdentityMatch)
// can redirect a transfer's destination-side branch_stock to a *different*
// product_id that's the same real item under a different row -- when that
// happens, the batch has to be redirected too, since product_batches rows
// belong to one specific product_id and can't just move with the stock.
//
// Same "does this identify the same lot" rule as receiveBatchStock's own
// top-up check: an existing active batch on destProductId with the same
// lot_code (if the source batch has one) or, lacking a lot code, the same
// expiry_date, is treated as the same batch and reused (branch_batch_stock
// then just gains a row/quantity there, same as any other transfer). No
// match -> clone a new product_batches row under destProductId carrying
// the same lot_code/expiry_date/notes, so the destination product gains an
// equivalent batch instead of losing lot/expiry tracking on the transfer.
// FIFO ordering elsewhere (listBatchesForProduct) already sorts by
// expiry_date, so a cloned batch takes its place in that order for free --
// nothing extra to "rename" or reorder here.
export async function resolveDestinationBatch(
  db: D1Compat,
  sourceBatch: { lot_code: string | null; expiry_date: string | null; notes: string | null },
  destProductId: number,
): Promise<number> {
  const lotCode = normalizeLotCode(sourceBatch.lot_code)
  const match = lotCode
    ? await db.prepare(
        `SELECT id FROM product_batches WHERE variant_product_id = @productId AND is_active = 1 AND batch_key = @batchKey`,
      ).get<{ id: number }>({ productId: destProductId, batchKey: lotCode })
    : sourceBatch.expiry_date
      ? await db.prepare(
          `SELECT id FROM product_batches WHERE variant_product_id = @productId AND is_active = 1 AND expiry_date = @expiryDate ORDER BY id ASC LIMIT 1`,
        ).get<{ id: number }>({ productId: destProductId, expiryDate: sourceBatch.expiry_date })
      : null
  if (match) return Number(match.id)

  // Cloned batch on the destination product gets its own batch_number in
  // that product's own sequence too -- same "every product_batches INSERT
  // assigns one" rule receiveBatchStock follows above, so a transferred
  // batch doesn't end up with a NULL number and fall back to the bare
  // "Batch #id" label in formatDefaultBatchLabel (frontend/src/utils/
  // batchLabel.ts).
  const batchNumber = await nextBatchNumber(db, destProductId)
  const batchKey = lotCode || generateBatchKey()
  const inserted = await db.prepare(`
    INSERT INTO product_batches (variant_product_id, batch_key, lot_code, expiry_date, received_at, is_active, notes, batch_number)
    VALUES (@productId, @batchKey, @lotCode, @expiryDate, datetime('now'), 1, @notes, @batchNumber)
  `).run({
    productId: destProductId,
    batchKey,
    lotCode,
    expiryDate: sourceBatch.expiry_date || null,
    notes: sourceBatch.notes || null,
    batchNumber,
  })
  return Number(inserted.lastInsertRowid)
}


// sales.ts, which need these as part of one atomic db.batch() alongside the
// sale_items/branch_stock writes (see lib/db.ts's batch() docs for why this
// can't just call receiveBatchStock/an equivalent function directly -- no
// interleaved reads inside an atomic batch).
export function decrementBatchStockStatement(batchId: number, branchId: number, quantity: number): { sql: string; params: Record<string, unknown> } {
  return {
    sql: `UPDATE branch_batch_stock SET quantity = MAX(0, quantity - @quantity), updated_at = datetime('now')
          WHERE batch_id = @batchId AND branch_id = @branchId`,
    params: { batchId, branchId, quantity },
  }
}

// Strict sibling of decrementBatchStockStatement: plain subtraction, no
// MAX(0) clamp, so an oversell of a specific lot violates branch_batch_stock's
// CHECK(quantity >= 0) (migration 0058) and aborts the whole atomic sale batch
// instead of silently flooring the lot at 0. Used only by the POS/sales write
// paths, which pre-validate availability and want a concurrent oversell to
// FAIL the sale rather than clamp it. Other callers (transfers, returns) keep
// the clamped version deliberately -- see each call site.
export function decrementBatchStockStrictStatement(batchId: number, branchId: number, quantity: number): { sql: string; params: Record<string, unknown> } {
  return {
    sql: `UPDATE branch_batch_stock SET quantity = quantity - @quantity, updated_at = datetime('now')
          WHERE batch_id = @batchId AND branch_id = @branchId`,
    params: { batchId, branchId, quantity },
  }
}

export function incrementBatchStockStatement(batchId: number, branchId: number, quantity: number): { sql: string; params: Record<string, unknown> } {
  return {
    sql: `INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (@batchId, @branchId, @quantity)
          ON CONFLICT(batch_id, branch_id) DO UPDATE SET quantity = quantity + @quantity, updated_at = datetime('now')`,
    params: { batchId, branchId, quantity },
  }
}

// True if this product row has ever had a batch created for it (active or
// not). Used by routes/inventory.ts's /adjust as the auto-routing signal
// for callers that omit `batchId` entirely -- undo/redo replay, bulk add-
// stock, and "clear stock to zero" have no interactive picker to source a
// batchId from, but a product that's already batch-tracked (has at least
// one product_batches row) still needs those writes to land in the batch
// ledger, or its aggregate stock (branch_stock/stock_quantity) silently
// drifts away from what listBatchesForProduct/the POS lot-picker shows. A
// product with zero batch rows ever has genuinely never used batch
// tracking, so it correctly keeps going through the plain applyStockDelta
// path unchanged -- this flag doesn't newly opt anything in, only stops
// already-opted-in products from being silently bypassed by callers that
// can't supply a batchId.
export async function productHasBatchHistory(db: D1Compat, productId: number): Promise<boolean> {
  const row = await db.prepare(
    'SELECT 1 AS found FROM product_batches WHERE variant_product_id = @productId LIMIT 1',
  ).get<{ found: number }>({ productId })
  return Boolean(row)
}

// FIFO-drain `quantity` off a product's active batches at one branch,
// across as many batches as it takes (same expiry-then-received-then-id
// order listBatchesForProduct already uses -- "sell/remove the lot that
// expires soonest" applies just as much to a programmatic removal as an
// interactive one). Companion to removeStockFromBatch for callers that
// can't name a single batchId: undo/redo restoring a lower snapshot
// quantity, and "clear stock to zero" (routes/inventory.ts's /adjust,
// Products.tsx's clearProductStockByIds) both need to remove a specific
// total amount from *some* batch(es), not one named lot.
//
// Same atomicity guarantee as removeStockFromBatch: one db.batch() call
// covering every touched branch_batch_stock row plus the single
// branch_stock/products.stock_quantity decrement, so a mid-drain failure
// can't leave the aggregate and the ledger disagreeing.
//
// Unlike removeStockFromBatch (one named lot -- an interactive picker
// choosing a lot with too little available is a real error, must pick a
// different one), this never throws for a shortfall. A product can have
// batch history (productHasBatchHistory true, so an auto-routed caller
// gets here) while some of its current aggregate stock predates that
// batch ever being created -- e.g. stock added before batch tracking
// started for this product, still sitting in branch_stock with nothing
// in branch_batch_stock behind it. Blocking a legitimate removal because
// the *batch* ledger alone can't cover it would be a regression versus
// the plain pre-batch behavior. So: drain whatever active batches have
// (FIFO), and report back how much of the request that covered --
// routes/inventory.ts's /adjust applies the remainder through the
// ordinary applyStockDelta decrement, same as it always did for a
// product with no batch ledger at all.
export async function removeStockAcrossBatches(db: D1Compat, input: {
  productId: number
  branchId: number
  quantity: number
}): Promise<{ batchIds: number[]; batchQuantities: { batchId: number; quantity: number }[]; drained: number; remainder: number }> {
  const batches = await listBatchesForProduct(db, input.productId, input.branchId, { onlyAvailable: true })

  let remaining = input.quantity
  const touched: { batchId: number; take: number }[] = []
  for (const batch of batches) {
    if (remaining <= 0) break
    const take = Math.min(remaining, Number(batch.quantity) || 0)
    if (take <= 0) continue
    touched.push({ batchId: batch.id, take })
    remaining -= take
  }
  const drained = input.quantity - remaining

  if (touched.length) {
    await db.batch([
      ...touched.map(({ batchId, take }) => decrementBatchStockStatement(batchId, input.branchId, take)),
      {
        sql: `UPDATE branch_stock SET quantity = MAX(0, quantity - @quantity) WHERE product_id = @productId AND branch_id = @branchId`,
        params: { productId: input.productId, branchId: input.branchId, quantity: drained },
      },
      {
        sql: `UPDATE products SET stock_quantity = MAX(0, COALESCE(stock_quantity, 0) - @quantity), updated_at = CURRENT_TIMESTAMP WHERE id = @productId`,
        params: { productId: input.productId, quantity: drained },
      },
    ])
  }

  return {
    batchIds: touched.map((entry) => entry.batchId),
    // Signed negative (this is a removal) so a caller recording
    // provenance (datedStockCountApply.ts) can store these rows
    // directly without re-deriving the sign -- symmetric with how a
    // receiveBatchStock top-up's quantity is recorded positive.
    batchQuantities: touched.map((entry) => ({ batchId: entry.batchId, quantity: -entry.take })),
    drained,
    remainder: remaining,
  }
}
