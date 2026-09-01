import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { hasPermission, isActionBlocked } from '../lib/permissions'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersion } from '../lib/cache'
import { getTrackedProductIds, listBatchesForProduct, receiveBatchStock } from '../lib/productBatches'
import { listOpenDamagedLots } from '../lib/returnsStock'
import { dateToBatchCode, normalizeToIsoDate } from '../lib/batchCode'
import { assertUpdatedAtMatch, getExpectedUpdatedAt, writeConflictResponse, WriteConflictError } from '../lib/conflictControl'
import type { Env } from '../index'

// Batch / expiry-date tracking -- schema notes and design rationale live in
// lib/productBatches.ts. Gated behind the same 'inventory' permission as
// routes/inventory.ts, since receiving/correcting batch stock is the same
// class of action as any other stock adjustment.
const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)
app.use('*', async (c, next) => {
  const user = c.get('user')
  // Receiving or correcting batch stock is a stock adjustment, so WRITES
  // stay behind 'inventory', same as routes/inventory.ts.
  //
  // READS cannot. The POS calls GET /tracked-product-ids on load to learn
  // which products need the lot picker instead of a one-tap add, and GET /
  // to list a product's lots once one is tapped. A cashier holding only
  // 'pos' was getting 403 on both, and the frontend treats that failure as
  // "no product is batch-tracked" (a deliberate non-blocking fallback) --
  // so the picker never appeared and the cashier sold batch-tracked stock
  // WITHOUT choosing a lot. Silent, and wrong in the worst direction: it
  // quietly bypasses FIFO/expiry selection rather than failing visibly.
  //
  // Reading which lots exist is not a privileged action -- it is strictly
  // less than the product/price data 'pos' already grants.
  const isRead = c.req.method === 'GET'
  // products_image_only_show_batches (K6): the image-only role's opt-in
  // lot VIEW -- read-only by construction (writes stay inventory-only),
  // and note batch rows carry unit_cost_usd, so this grant is the
  // admin's explicit choice to show that.
  // Writes (receive batch stock, fast stock-in, edit/deactivate a lot)
  // ride the 'inventory:adjust' per-action override (Part 546) -- the same
  // action key Branches.tsx's canReceiveStock reads via can().
  const allowed = isRead
    ? (hasPermission(user, 'inventory') || hasPermission(user, 'pos') || hasPermission(user, 'sales') || hasPermission(user, 'products_image_only_show_batches'))
    : hasPermission(user, 'inventory') && !isActionBlocked(user, 'inventory', 'adjust')
  if (!allowed) return c.json({ error: 'You do not have permission to perform this action' }, 403)
  return next()
})

// GET /api/batches/tracked-product-ids?branchId= -- POS fetches this once
// (not per product tap) to know which products need the batch-picker
// instead of a one-tap add. Kept as its own lightweight endpoint rather
// than adding a column to the main product-search query, to avoid touching
// that hot path for a feature most products won't use.
app.get('/tracked-product-ids', async (c) => {
  const db = getDb(c.env)
  const branchId = Number(c.req.query('branchId')) || null
  const productIds = await getTrackedProductIds(db, branchId)
  return c.json({ productIds })
})

// GET /api/batches/damaged-lots?productId=&branchId= -- 11.9 (Part 416):
// the POS picker lists a product's OPEN damaged lots beside its sellable
// ones ("Damage alongside batch/branch/barcode/SP/VIP" -- locked note).
// Registered on this router because it shares the POS-readable gate above;
// carries no cost by construction (damaged lots never store money terms).
app.get('/damaged-lots', async (c) => {
  const db = getDb(c.env)
  const productId = Number(c.req.query('productId'))
  if (!productId) return c.json({ error: 'productId is required' }, 400)
  const branchId = Number(c.req.query('branchId')) || null
  const lots = await listOpenDamagedLots(db, { productId, branchId })
  return c.json({ lots })
})

// GET /api/batches?productId=&branchId=&onlyAvailable=1
app.get('/', async (c) => {
  const db = getDb(c.env)
  const user = c.get('user')
  const productId = Number(c.req.query('productId'))
  const branchId = Number(c.req.query('branchId'))
  if (!productId || !branchId) return c.json({ error: 'productId and branchId are required' }, 400)
  const onlyAvailable = c.req.query('onlyAvailable') === '1' || c.req.query('onlyAvailable') === 'true'
  const batches = await listBatchesForProduct(db, productId, branchId, { onlyAvailable })
  // A reader admitted ONLY via the image-only lot-view grant (K6) sees the
  // lots -- code, expiry, quantity, supplier NAME -- but never the money
  // terms: unit cost and paid/credit state stay with the roles that manage
  // purchasing. Same name-only supplier rule batches follow everywhere.
  const moneyBlind = !hasPermission(user, 'inventory') && !hasPermission(user, 'pos') && !hasPermission(user, 'sales')
  const payload = moneyBlind
    ? (batches as Array<Record<string, unknown>>).map(({ unit_cost_usd: _c, payment_status: _p, credit_due_date: _d, ...rest }) => rest)
    : batches
  return c.json({ batches: payload })
})

// POST /api/batches -- receive stock into a batch (creates a new batch, or
// tops up an existing one if the received date's derived code matches one
// already on this product -- see lib/batchCode.ts).
app.post('/', async (c) => {
  const db = getDb(c.env)
  const user = c.get('user')
  type ReceiveBody = {
    product_id?: number
    branch_id?: number
    quantity?: number
    expiry_date?: string | null
    received_date?: string | null
    // D4b: explicit existing lot to top up -- the same picker every adjust
    // surface has. receiveBatchStock validates it belongs to product_id and
    // keeps the lot's own received_at (first attribution sticks).
    batch_id?: number | null
    notes?: string | null
    supplier_id?: number | null
    supplier_name?: string | null
    unit_cost_usd?: number | null
    payment_status?: string | null
    credit_due_date?: string | null
    session_id?: number | null
  }
  const body = await c.req.json<ReceiveBody>().catch(() => ({} as ReceiveBody))

  const productId = Number(body.product_id)
  const branchId = Number(body.branch_id)
  const quantity = Number(body.quantity)
  if (!productId || !branchId) return c.json({ error: 'product_id and branch_id are required' }, 400)
  if (!Number.isFinite(quantity) || quantity <= 0) return c.json({ error: 'quantity must be a positive number' }, 400)
  // Paid vs on-credit (migration 0065). A credit purchase without a due
  // date has no reminder to fire, which defeats the point of recording it.
  const paymentStatus = body.payment_status === 'paid' || body.payment_status === 'credit' ? body.payment_status : null
  const creditDueDate = String(body.credit_due_date || '').slice(0, 10) || null
  if (paymentStatus === 'credit' && !creditDueDate) {
    return c.json({ error: 'A credit purchase needs its due date — that is what the admin reminder is built on.' }, 400)
  }

  const product = await db.prepare('SELECT id, name FROM products WHERE id = ?').get<{ id: number; name: string }>([productId])
  if (!product) return c.json({ error: 'Product not found' }, 404)
  const branch = await db.prepare('SELECT id, name FROM branches WHERE id = ?').get<{ id: number; name: string }>([branchId])

  let received: { batchId: number; batchNumber: number | null; lotCode: string }
  try {
    received = await receiveBatchStock(db, {
      productId,
      branchId,
      quantity,
      expiryDate: body.expiry_date || null,
      receivedDate: body.received_date || null,
      batchId: Number.isFinite(Number(body.batch_id)) && Number(body.batch_id) > 0 ? Number(body.batch_id) : null,
      notes: body.notes || null,
      supplierId: Number.isFinite(Number(body.supplier_id)) && Number(body.supplier_id) > 0 ? Number(body.supplier_id) : null,
      supplierName: body.supplier_name || null,
      unitCostUsd: body.unit_cost_usd == null ? null : Number(body.unit_cost_usd),
      paymentStatus,
      creditDueDate,
    })
  } catch (err) {
    // The explicit-lot pick can fail validation ("Selected batch does not
    // belong to this product") -- a caller mistake, not a server fault, so
    // it answers 400 exactly as /inventory/adjust's batch path does.
    return c.json({ error: err instanceof Error ? err.message : 'Failed to receive batch stock' }, 400)
  }
  const { batchId, batchNumber, lotCode } = received

  // receiveBatchStock now also moves branch_stock/products.stock_quantity
  // (see that function's own comment for why -- it used to only touch
  // branch_batch_stock, silently leaving the aggregate stock unchanged).
  // Log it as an ordinary inventory_movements 'add' row too, same as any
  // other stock addition, so this doesn't become a receipt that's visible
  // in the batch ledger and the audit log but invisible in Stock History.
  await db.prepare(`
    INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, reference_id, user_id, user_name, created_at, batch_id)
    VALUES (@productId, @productName, @branchId, @branchName, 'add', @quantity, @reason, @referenceId, @userId, @userName, CURRENT_TIMESTAMP, @batchId)
  `).run({
    productId,
    productName: product.name,
    branchId,
    branchName: branch?.name || null,
    quantity,
    reason: `Batch receipt (${lotCode})`,
    referenceId: Number.isSafeInteger(Number(body.session_id)) && Number(body.session_id) > 0 ? Number(body.session_id) : null,
    userId: user?.id ?? null,
    userName: user?.name ?? null,
    batchId,
  })

  await audit(c.env, user?.id ?? null, user?.name ?? null, 'batch_receive', 'product_batch', batchId, {
    product_id: productId,
    product_name: product.name,
    branch_id: branchId,
    quantity,
    expiry_date: body.expiry_date || null,
    lot_code: lotCode,
  })
  c.executionCtx.waitUntil(Promise.all([
    bumpVersion(c.env, 'products'),
    broadcast(c.env, 'inventory', { type: 'batch_received', productId, branchId }),
    broadcast(c.env, 'products', { action: 'update', id: productId }),
  ]))

  return c.json({ success: true, batchId, batchNumber, lotCode })
})

// PATCH /api/batches/:id -- edit a batch's own fields (expiry/lot/notes) or
// deactivate it. Does NOT take a branch_id/quantity -- a batch can span
// several branches (one branch_batch_stock row each), so quantity
// corrections are scoped separately below.
app.patch('/:id', async (c) => {
  const db = getDb(c.env)
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ expiry_date?: string | null; notes?: string | null; is_active?: boolean; received_at?: string | null }>()
    .catch(() => ({} as { expiry_date?: string | null; notes?: string | null; is_active?: boolean; received_at?: string | null }))

  const existing = await db.prepare('SELECT id, updated_at FROM product_batches WHERE id = ?').get<{ id: number; updated_at: string | null }>([id])
  if (!existing) return c.json({ error: 'Batch not found' }, 404)

  // Optimistic-concurrency guard, the same one products/contacts/sales use.
  // No-op when the editor sends no token; a stale token means someone else
  // changed this lot first, so reject instead of silently clobbering it.
  try {
    assertUpdatedAtMatch('batch', existing, getExpectedUpdatedAt(body as Record<string, unknown>))
  } catch (error) {
    if (error instanceof WriteConflictError) {
      const { body: conflictBody, status } = writeConflictResponse(error)
      return c.json(conflictBody, status)
    }
    throw error
  }

  const updates: string[] = []
  const params: Record<string, unknown> = { id }
  if (body.expiry_date !== undefined) { updates.push('expiry_date = @expiry_date'); params.expiry_date = body.expiry_date || null }
  if (body.notes !== undefined) { updates.push('notes = @notes'); params.notes = body.notes || null }
  if (body.is_active !== undefined) { updates.push('is_active = @is_active'); params.is_active = body.is_active ? 1 : 0 }
  // received_at (the "batch date" -- when this lot actually came in) is
  // the ONLY thing that determines this batch's code now -- editing it
  // recomputes both batch_key and lot_code from the corrected date (see
  // lib/batchCode.ts's dateToBatchCode), instead of accepting a
  // separately-typed lot_code that could drift out of sync with the date
  // shown right next to it. If the corrected date now matches another
  // active batch on this product, that collides on the unique index --
  // surfaced as a normal 409/error rather than silently merging two
  // distinct batch rows into one.
  if (body.received_at !== undefined) {
    const iso = normalizeToIsoDate(body.received_at) || (body.received_at ? null : new Date().toISOString().slice(0, 10))
    if (body.received_at && !iso) return c.json({ error: 'received_at is not a valid date' }, 400)
    const resolvedIso = iso || new Date().toISOString().slice(0, 10)
    const code = dateToBatchCode(resolvedIso) as string
    updates.push('received_at = @received_at', 'batch_key = @batch_key', 'lot_code = @lot_code')
    params.received_at = resolvedIso
    params.batch_key = code
    params.lot_code = code
  }
  // Supplier credit lifecycle (0065): the admin can flip credit -> paid
  // (clearing the reminder), fix the due date, or correct supplier/cost —
  // an explicit EDIT overrides, unlike the receive path's fill-if-NULL.
  const bodyExtra = body as typeof body & { payment_status?: string | null; credit_due_date?: string | null; supplier_name?: string | null; supplier_id?: number | null; unit_cost_usd?: number | null }
  if (bodyExtra.payment_status !== undefined) {
    const nextStatus = bodyExtra.payment_status === 'paid' || bodyExtra.payment_status === 'credit' ? bodyExtra.payment_status : null
    const nextDue = String(bodyExtra.credit_due_date || '').slice(0, 10) || null
    if (nextStatus === 'credit' && !nextDue) return c.json({ error: 'A credit purchase needs its due date.' }, 400)
    updates.push('payment_status = @payment_status', 'credit_due_date = @credit_due_date')
    params.payment_status = nextStatus
    params.credit_due_date = nextStatus === 'credit' ? nextDue : null
  } else if (bodyExtra.credit_due_date !== undefined) {
    updates.push('credit_due_date = @credit_due_date')
    params.credit_due_date = String(bodyExtra.credit_due_date || '').slice(0, 10) || null
  }
  if (bodyExtra.supplier_name !== undefined) {
    updates.push('supplier_name = @supplier_name', 'supplier_id = @supplier_id')
    params.supplier_name = String(bodyExtra.supplier_name || '').trim() || null
    params.supplier_id = Number.isFinite(Number(bodyExtra.supplier_id)) && Number(bodyExtra.supplier_id) > 0 ? Number(bodyExtra.supplier_id) : null
  }
  if (bodyExtra.unit_cost_usd !== undefined) {
    const cost = Number(bodyExtra.unit_cost_usd)
    updates.push('unit_cost_usd = @unit_cost_usd')
    params.unit_cost_usd = Number.isFinite(cost) && cost >= 0 ? cost : null
  }
  if (!updates.length) return c.json({ error: 'No fields to update' }, 400)
  updates.push(`updated_at = datetime('now')`)

  await db.prepare(`UPDATE product_batches SET ${updates.join(', ')} WHERE id = @id`).run(params)
  await audit(c.env, user?.id ?? null, user?.name ?? null, 'batch_update', 'product_batch', id, body)
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { type: 'batch_updated', batchId: id }))
  return c.json({ success: true })
})

// PATCH /api/batches/:id/branches/:branchId -- correct the quantity sitting
// in one branch for this batch (e.g. a stock-take found the real number is
// different from what sales/receipts computed). A direct set, not an add --
// distinct from POST / above, which always adds.
app.patch('/:id/branches/:branchId', async (c) => {
  const db = getDb(c.env)
  const user = c.get('user')
  const batchId = Number(c.req.param('id'))
  const branchId = Number(c.req.param('branchId'))
  const body = await c.req.json<{ quantity?: number }>().catch(() => ({} as { quantity?: number }))
  const quantity = Number(body.quantity)
  if (!Number.isFinite(quantity) || quantity < 0) return c.json({ error: 'quantity must be a non-negative number' }, 400)

  const batch = await db.prepare('SELECT id, variant_product_id AS productId FROM product_batches WHERE id = ?').get<{ id: number; productId: number }>([batchId])
  if (!batch) return c.json({ error: 'Batch not found' }, 404)
  const product = await db.prepare('SELECT id, name FROM products WHERE id = ?').get<{ id: number; name: string }>([batch.productId])

  // A direct SET (a stock-take correction, not a delta) -- read the
  // previous quantity first so the aggregate (branch_stock/
  // stock_quantity) can be adjusted by the same delta this batch's own
  // figure is about to move by, keeping the two ledgers in agreement the
  // same way receiveBatchStock/removeStockFromBatch do for their own
  // add/remove paths. Without this, correcting a batch's quantity here
  // moved the batch ledger but silently left the aggregate stale -- the
  // same class of gap fixed on the receive side above.
  const existingRow = await db.prepare(
    'SELECT quantity FROM branch_batch_stock WHERE batch_id = @batchId AND branch_id = @branchId',
  ).get<{ quantity: number }>({ batchId, branchId })
  const previousQuantity = Number(existingRow?.quantity) || 0
  const delta = quantity - previousQuantity

  const statements: Array<{ sql: string; params: Record<string, unknown> }> = [
    {
      sql: `INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (@batchId, @branchId, @quantity)
            ON CONFLICT(batch_id, branch_id) DO UPDATE SET quantity = @quantity, updated_at = datetime('now')`,
      params: { batchId, branchId, quantity },
    },
  ]
  if (delta !== 0) {
    // The branch_stock floor is DELIBERATE here (Part-77 clamp audit,
    // reviewed and kept): this is a stock-take CORRECTION -- the tool an
    // operator uses precisely when the ledgers have drifted -- and aborting
    // because the aggregate is lower than the batch delta would make the
    // repair itself impossible on the data that most needs it. The batch
    // figure being SET is authoritative; the aggregate floors at zero.
    statements.push({
      sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@productId, @branchId, MAX(0, @delta))
            ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = MAX(0, quantity + @delta)`,
      params: { productId: batch.productId, branchId, delta },
    })
    // Re-derive rather than clamp a delta: when the branch_stock update above
    // DID floor, a +/-delta on stock_quantity would bake the discrepancy into
    // the product total too -- summing the actual per-branch rows keeps the
    // denormalized total honest no matter what the floor did.
    statements.push({
      sql: 'UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @productId), updated_at = CURRENT_TIMESTAMP WHERE id = @productId',
      params: { productId: batch.productId },
    })
  }
  await db.batch(statements)

  if (delta !== 0) {
    await db.prepare(`
      INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, reason, user_id, user_name, created_at, batch_id)
      VALUES (@productId, @productName, @branchId, 'set', @quantity, @reason, @userId, @userName, CURRENT_TIMESTAMP, @batchId)
    `).run({
      productId: batch.productId,
      productName: product?.name || null,
      branchId,
      quantity: Math.abs(delta),
      reason: `Batch quantity correction (Batch #${batchId})`,
      userId: user?.id ?? null,
      userName: user?.name ?? null,
      batchId,
    })
  }

  await audit(c.env, user?.id ?? null, user?.name ?? null, 'batch_quantity_correction', 'product_batch', batchId, { branch_id: branchId, quantity, previous_quantity: previousQuantity })
  c.executionCtx.waitUntil(Promise.all([
    bumpVersion(c.env, 'products'),
    broadcast(c.env, 'inventory', { type: 'batch_updated', batchId }),
    broadcast(c.env, 'products', { action: 'update', id: batch.productId }),
  ]))
  return c.json({ success: true })
})

// DELETE /api/batches/:id -- soft delete (is_active = 0). Never a hard
// delete: sale_item_batch_allocations rows reference batch_id for
// historical receipts/reports, so the row needs to keep existing even once
// it's no longer offered in the POS picker.
app.delete('/:id', async (c) => {
  const db = getDb(c.env)
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const existing = await db.prepare('SELECT id FROM product_batches WHERE id = ?').get<{ id: number }>([id])
  if (!existing) return c.json({ error: 'Batch not found' }, 404)

  // A deactivated batch drops out of every FIFO picker (listBatchesForProduct
  // filters `is_active = 1`) -- POS's lot picker, Inventory's mandatory
  // batch selection, everything. If it still holds stock anywhere,
  // deactivating it here would leave that quantity permanently
  // unreachable through any batch-aware path while the aggregate
  // (branch_stock/stock_quantity) still counts it -- exactly the ledger-
  // divergence bug fixed elsewhere in this file. Block instead of quietly
  // stranding it; the admin corrects the quantity to zero first (PATCH
  // .../branches/:branchId, which reconciles the aggregate down with it),
  // then deactivates.
  const remaining = await db.prepare(
    'SELECT COALESCE(SUM(quantity), 0) AS total FROM branch_batch_stock WHERE batch_id = ?',
  ).get<{ total: number }>([id])
  const remainingQty = Number(remaining?.total) || 0
  if (remainingQty > 0) {
    return c.json({ error: `This batch still has ${remainingQty} unit(s) of stock. Correct the quantity to 0 before deactivating.` }, 400)
  }

  await db.prepare(`UPDATE product_batches SET is_active = 0, updated_at = datetime('now') WHERE id = ?`).run([id])
  await audit(c.env, user?.id ?? null, user?.name ?? null, 'batch_deactivate', 'product_batch', id, null)
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { type: 'batch_updated', batchId: id }))
  return c.json({ success: true })
})

export default app
