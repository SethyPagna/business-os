// Step (2)'s other half: once a reviewer approves a pending_actions row
// (routes/reviewQueue.ts's POST /:id/approve), the underlying write it
// represents has to actually happen -- this file is where that replay
// lives, kept separate from routes/reviewQueue.ts itself so the queue
// route doesn't need to know any section's real write logic, matching
// lib/pendingActions.ts's own "generic queue, no entity-specific
// knowledge" scope note.
//
// One small applier function per (section, action_type, entity_type)
// combination, registered below. Deliberately NOT one giant switch --
// each applier is a short, independent function next to a comment
// explaining what it mirrors, so adding the next section (products,
// inventory, branches, returns, contacts, library -- see
// permissions.ts's REVIEW_TIER_KEYS) is a small, additive block, not an
// edit to a growing conditional. A combination with no registered
// applier throws NoReviewApplierError -- routes/reviewQueue.ts turns
// that into a 501 and leaves the row `open` rather than marking it
// approved without the real change having happened.

import { getDb, toDbBool } from './db'
import { audit } from './audit'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersion } from './cache'
import { insertRow, updateRow, defaultBranchId, syncProductImageGallery, seedBranchStockForNewProduct, seedInitialBatchForNewProduct } from './productWrites'
import { branchUpdateStatements } from './branchWrites'
import type { PendingActionRow } from './pendingActions'
import type { Env } from '../index'

export class NoReviewApplierError extends Error {
  constructor(section: string, actionType: string, entityType: string) {
    super(`No review applier is registered yet for ${section}/${actionType}/${entityType} -- this row can't be approved until one is added to lib/reviewApply.ts.`)
    this.name = 'NoReviewApplierError'
  }
}

export interface ReviewerInfo {
  id: number | null
  name: string | null
}

type Applier = (env: Env, row: PendingActionRow, reviewer: ReviewerInfo) => Promise<void>

const appliers = new Map<string, Applier>()

function applierKey(section: string, actionType: string, entityType: string): string {
  return `${section}:${actionType}:${entityType}`
}

function registerApplier(section: string, actionType: string, entityType: string, fn: Applier): void {
  appliers.set(applierKey(section, actionType, entityType), fn)
}

// --- fees / delete / fee -----------------------------------------------
// Mirrors routes/fees.ts's own DELETE /:id direct-write branch exactly
// (same DELETE statement, same audit/broadcast calls) -- the only
// difference is the actor recorded on the audit row is the *reviewer*
// approving the change, not the person who originally requested it (the
// original requester is already on the pending_actions row itself via
// requested_by/requested_by_name, so that context isn't lost, just not
// duplicated into the audit log's actor field).
registerApplier('fees', 'delete', 'fee', async (env, row, reviewer) => {
  const db = getDb(env)
  const id = row.entity_id
  if (id == null) throw new Error('Pending fee delete is missing its entity id')
  const existing = await db.prepare('SELECT id FROM fees WHERE id = @id').get<{ id: number }>({ id })
  if (!existing) {
    // Already gone by some other path since this was queued (e.g. a
    // full-access user deleted it directly in the meantime) -- treat
    // approval as a safe no-op rather than an error, same "don't fail
    // an operation that's already effectively done" reasoning the rest
    // of this codebase uses for idempotent cleanup paths.
    return
  }
  await db.prepare('DELETE FROM fees WHERE id = @id').run({ id })
  await audit(env, reviewer.id, reviewer.name, 'delete', 'fee', id, null)
  await broadcast(env, 'fees', { type: 'deleted', id })
})

// --- products / create / product -----------------------------------
// Mirrors routes/products.ts's own POST / direct-write branch: same
// insertRow() call (exported by products.ts for exactly this reuse, see
// its own comment), same branch_stock seed, same image_gallery sync,
// same cache bump + broadcast. The pending row's payload is the exact
// request body the requester originally sent, unchanged since queueing.
registerApplier('products', 'create', 'product', async (env, row, reviewer) => {
  const body = JSON.parse(row.payload_json || '{}') as Record<string, unknown>
  const name = String(body.name || '').trim()
  if (!name) throw new Error('Pending product create is missing a name')
  const id = await insertRow(env, 'products', body, { name, is_active: body.is_active == null ? 1 : body.is_active })

  const rawBranchId = Number.parseInt(String(body.branch_id ?? ''), 10)
  const branchId = Number.isFinite(rawBranchId) && rawBranchId > 0 ? rawBranchId : await defaultBranchId(env)
  // Was a hand-rolled single-branch INSERT here (only the chosen branch
  // got a branch_stock row at all) -- despite this applier's own comment
  // above claiming "same branch_stock seed" as the direct-write path, it
  // wasn't actually the same call. That reproduced, for any product
  // created through Review Required and then approved, the exact "new
  // products only showed up at the one branch they were created
  // against" bug seedBranchStockForNewProduct was written to fix for the
  // direct-create path (routes/products.ts's own POST /) -- every other
  // active branch had no row at all instead of an explicit tracked 0, so
  // a branch-filtered Products/Inventory/POS view made the product look
  // like it didn't exist there. Switched to the same shared helper the
  // direct path calls, so both creation paths seed every active branch
  // identically instead of two different implementations drifting apart.
  // seedInitialBatchForNewProduct was missing entirely too -- a
  // review-approved product had no "day added" default batch, unlike a
  // directly-created one.
  const initialQty = Math.max(0, Number(body.stock_quantity ?? 0) || 0)
  await seedBranchStockForNewProduct(env, id as number, branchId, initialQty)
  await seedInitialBatchForNewProduct(env, id as number, branchId, initialQty)
  if ('image_gallery' in body) {
    await syncProductImageGallery(env, id as number, body.image_gallery)
  }
  await audit(env, reviewer.id, reviewer.name, 'create', 'product', id as number, null)
  await bumpVersion(env, 'products')
  await broadcast(env, 'products', { action: 'create', id })
})

// --- products / update / product -----------------------------------
// Mirrors routes/products.ts's own PUT /:id direct-write branch. A 404
// (product deleted by some other path since this was queued) is treated
// as a safe no-op, same reasoning as the fees applier above.
registerApplier('products', 'update', 'product', async (env, row, reviewer) => {
  const id = row.entity_id
  if (id == null) throw new Error('Pending product update is missing its entity id')
  const body = JSON.parse(row.payload_json || '{}') as Record<string, unknown>
  const changes = await updateRow(env, 'products', id, body)
  if (!changes) return
  if ('image_gallery' in body) {
    await syncProductImageGallery(env, id, body.image_gallery)
  }
  await audit(env, reviewer.id, reviewer.name, 'update', 'product', id, null)
  await bumpVersion(env, 'products')
  await broadcast(env, 'products', { action: 'update', id })
})

// --- products / delete / product -----------------------------------
// Mirrors routes/products.ts's own DELETE /:id (soft delete, same as
// every other product deactivation path in this app, including the
// per-branch inventory_movements rows and the reason carried through).
// The direct route already validated `reason` as required before this
// was ever queued, so it's just carried through here, not re-validated.
registerApplier('products', 'delete', 'product', async (env, row, reviewer) => {
  const id = row.entity_id
  if (id == null) throw new Error('Pending product delete is missing its entity id')
  const body = JSON.parse(row.payload_json || '{}') as Record<string, unknown>
  const reason = body.reason ?? null
  const existing = await getDb(env).prepare('SELECT name FROM products WHERE id = @id').get<{ name?: string }>({ id })
  const stockRows = await getDb(env).prepare(`
    SELECT bs.branch_id AS branchId, bs.quantity AS quantity, b.name AS branchName
    FROM branch_stock bs LEFT JOIN branches b ON b.id = bs.branch_id
    WHERE bs.product_id = @id AND bs.quantity > 0
  `).all<{ branchId: number; quantity: number; branchName: string | null }>({ id })
  const result = await getDb(env).prepare('UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = @id').run({ id })
  if (!result.changes) return
  for (const stockRow of stockRows) {
    await getDb(env).prepare(`
      INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_id, user_name, created_at)
      VALUES (@productId, @productName, @branchId, @branchName, 'delete', @quantity, @reason, @userId, @userName, CURRENT_TIMESTAMP)
    `).run({
      productId: id,
      productName: existing?.name ?? null,
      branchId: stockRow.branchId,
      branchName: stockRow.branchName,
      quantity: stockRow.quantity,
      reason,
      userId: reviewer.id ?? null,
      userName: reviewer.name ?? null,
    })
  }
  await audit(env, reviewer.id, reviewer.name, 'delete', 'product', id, { name: existing?.name ?? null, reason })
  await bumpVersion(env, 'products')
  await broadcast(env, 'products', { action: 'delete', id })
})

// --- inventory / update / inventory_reason -------------------------
// Mirrors routes/inventory.ts's own PUT /reasons direct-write branch.
// The only inventory write wired into the queue so far (Part 152) --
// see that route's own comment for why adjust/transfer/move-row are
// deliberately NOT wired yet (live-state dependencies at apply time
// that this simple settings-row overwrite doesn't have).
registerApplier('inventory', 'update', 'inventory_reason', async (env, row, reviewer) => {
  const payload = JSON.parse(row.payload_json || '{}') as { items?: unknown }
  const items = Array.isArray(payload.items) ? payload.items : []
  await getDb(env).prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES ('inventory_saved_reasons', @value, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run({ value: JSON.stringify(items) })
  await audit(env, reviewer.id, reviewer.name, 'update', 'inventory_reason', null, { count: items.length })
  await broadcast(env, 'inventory', { action: 'reasons_update' })
})

// --- branches / create / branch -----------------------------------
// Mirrors routes/branches.ts's own POST / direct-write branch: the same
// is_default reassignment + insert, in one atomic db.batch(). No live-state
// dependency (there's nothing that could have changed since queueing that
// would make "insert this branch" unsafe), so this replays exactly as-is.
registerApplier('branches', 'create', 'branch', async (env, row, reviewer) => {
  const body = JSON.parse(row.payload_json || '{}') as Record<string, unknown>
  const name = String(body.name || '').trim()
  if (!name) throw new Error('Pending branch create is missing a name')
  const db = getDb(env)
  // toDbBool, not plain `value ? 1 : 0` -- see its own comment in lib/db.ts.
  // Was a local re-approximation here that disagreed with routes/
  // branches.ts's real toDbBool on a string "false"/"0" payload (JS
  // truthiness treats those strings as truthy); not reachable through
  // BranchForm.tsx today (it only ever sends real 0/1), but a direct API
  // call or a future form change could have hit it silently, so switched
  // to the shared function rather than leave two implementations able to
  // drift -- same audit that found the products/create/product
  // branch_stock gap logged in progress.md.
  const defaultFlag = toDbBool(body.is_default, 0)
  const activeFlag = toDbBool(body.is_active, 1)
  const statements: Array<{ sql: string; params?: Record<string, unknown> }> = []
  if (defaultFlag) statements.push({ sql: 'UPDATE branches SET is_default = 0' })
  statements.push({
    sql: `INSERT INTO branches (name, location, phone, manager, notes, is_default, is_active, updated_at)
          VALUES (@name, @location, @phone, @manager, @notes, @is_default, @is_active, CURRENT_TIMESTAMP)`,
    params: {
      name,
      location: body.location || null,
      phone: body.phone || null,
      manager: body.manager || null,
      notes: body.notes || null,
      is_default: defaultFlag,
      is_active: activeFlag,
    },
  })
  await db.batch(statements)
  const created = await db.prepare('SELECT id FROM branches WHERE name = ? ORDER BY id DESC LIMIT 1').get<{ id: number }>([name])
  await audit(env, reviewer.id, reviewer.name, 'create', 'branch', created?.id ?? null, { name })
  await broadcast(env, 'branches', { action: 'create', id: created?.id ?? null })
})

// --- branches / update / branch -----------------------------------
// Mirrors routes/branches.ts's own PUT /:id direct-write branch. A missing
// row (deleted by some other path since this was queued) is treated as a
// safe no-op, same reasoning as the fees/products appliers above.
registerApplier('branches', 'update', 'branch', async (env, row, reviewer) => {
  const id = row.entity_id
  if (id == null) throw new Error('Pending branch update is missing its entity id')
  const body = JSON.parse(row.payload_json || '{}') as Record<string, unknown>
  const db = getDb(env)
  const current = await db.prepare('SELECT id FROM branches WHERE id = @id').get<{ id: number }>({ id })
  if (!current) return
  // Route and review-approved writes share the same cascade: a branch rename
  // must update all id-linked display snapshots in both paths.
  await db.batch(branchUpdateStatements(id, body))
  await audit(env, reviewer.id, reviewer.name, 'update', 'branch', id, { name: body.name })
  await broadcast(env, 'branches', { action: 'update', id })
})

// --- branches / delete / branch -----------------------------------
// Mirrors routes/branches.ts's own DELETE /:id direct-write branch -- but,
// unlike every other applier in this file, it does NOT just trust the
// payload was safe when it was queued. routes/branches.ts's own delete
// handler explicitly re-runs these same two checks (not-default, no-stock)
// itself before queueing, but time can pass before a reviewer approves it,
// and either check can flip false in the meantime (the branch gets made
// default, or stock gets transferred back into it). Re-running both here
// against the CURRENT row -- not the state captured at request time -- and
// throwing rather than silently deleting is what makes this safe to queue
// at all; a thrown Error here leaves the pending_actions row 'open'
// (routes/reviewQueue.ts's approve handler doesn't mark it approved on a
// thrown error), so the reviewer sees a clear failure instead of a branch
// silently vanishing while it still holds stock.
registerApplier('branches', 'delete', 'branch', async (env, row, reviewer) => {
  const id = row.entity_id
  if (id == null) throw new Error('Pending branch delete is missing its entity id')
  const db = getDb(env)
  const branch = await db.prepare('SELECT id, name, is_default FROM branches WHERE id = @id').get<{ id: number; name: string; is_default: number }>({ id })
  if (!branch) return
  if (branch.is_default) throw new Error(`Cannot delete "${branch.name}" -- it has since become the default branch. Make another branch the default first, then re-approve.`)
  const stockCheck = await db.prepare('SELECT SUM(quantity) AS total FROM branch_stock WHERE branch_id = @id AND quantity > 0').get<{ total: number | null }>({ id })
  if (stockCheck && Number(stockCheck.total) > 0) {
    throw new Error(`Cannot delete "${branch.name}" -- it now contains ${Math.round(Number(stockCheck.total))} unit(s) of stock. Transfer it out first, then re-approve.`)
  }
  await db.batch([
    { sql: 'DELETE FROM branch_stock WHERE branch_id = @id', params: { id } },
    { sql: 'DELETE FROM branches WHERE id = @id', params: { id } },
  ])
  await audit(env, reviewer.id, reviewer.name, 'delete', 'branch', id, { name: branch.name })
  await broadcast(env, 'branches', { action: 'delete', id })
})

export async function applyApprovedPendingAction(env: Env, row: PendingActionRow, reviewer: ReviewerInfo): Promise<void> {
  const fn = appliers.get(applierKey(row.section, row.action_type, row.entity_type))
  if (!fn) throw new NoReviewApplierError(row.section, row.action_type, row.entity_type)
  await fn(env, row, reviewer)
}
