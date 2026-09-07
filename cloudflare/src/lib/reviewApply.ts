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

import { getDb } from './db'
import { audit } from './audit'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersion } from './cache'
import { insertRow, updateRow, defaultBranchId, syncProductImageGallery, seedBranchStockForNewProduct, seedInitialBatchForNewProduct } from './productWrites'
import { branchUpdateStatements } from './branchWrites'
import { assertCanonicalBranchSetMutationAllowed } from './canonicalBranchIdentity'
import { getActionTier } from './permissions'
import { omitUnchangedProductImageFields, productImageFieldsChanged, productImageFieldsChangedResolved, resolveProductImageFields } from './productImagePermission'
import type { SessionUser } from './auth'
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

export class ReviewRequesterPermissionError extends Error {
  readonly code = 'request_permission_revoked'
  constructor(message: string) {
    super(message)
    this.name = 'ReviewRequesterPermissionError'
  }
}

async function loadPendingRequester(env: Env, requestedBy: number | null): Promise<SessionUser | null> {
  if (requestedBy == null) return null
  const row = await getDb(env).prepare(`
    SELECT u.id, u.username, u.name, u.organization_id, u.role_id, u.permissions, u.is_active,
           r.code AS role_code, r.permissions AS role_permissions, r.name AS role_name
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = @id AND u.is_active = 1 AND u.deleted_at IS NULL
  `).get<SessionUser>({ id: requestedBy })
  return row ?? null
}

async function assertPendingProductImagePermission(env: Env, row: PendingActionRow): Promise<void> {
  const requester = await loadPendingRequester(env, row.requested_by)
  if (!requester || getActionTier(requester, 'products', 'image') === 'none') {
    throw new ReviewRequesterPermissionError('The requester no longer has permission to change product images.')
  }
}

async function currentProductImages(env: Env, id: number): Promise<{ image_path: string | null; image_gallery: string[] } | null> {
  const db = getDb(env)
  const product = await db.prepare('SELECT image_path FROM products WHERE id = @id')
    .get<{ image_path: string | null }>({ id })
  if (!product) return null
  const gallery = await db.prepare(`
    SELECT image_path FROM product_images
    WHERE product_id = @id
    ORDER BY sort_order ASC, id ASC
  `).all<{ image_path: string }>({ id })
  return { image_path: product.image_path, image_gallery: gallery.map((entry) => entry.image_path) }
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
  await resolveProductImageFields(getDb(env), body)
  const name = String(body.name || '').trim()
  if (!name) throw new Error('Pending product create is missing a name')
  const changesImages = productImageFieldsChanged(body)
  if (changesImages) await assertPendingProductImagePermission(env, row)
  else omitUnchangedProductImageFields(body)
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
  const submittedImageFields = Object.prototype.hasOwnProperty.call(body, 'image_path')
    || Object.prototype.hasOwnProperty.call(body, 'image_gallery')
  if (submittedImageFields) {
    const current = await currentProductImages(env, id)
    if (!current) return
    const changesImages = await productImageFieldsChangedResolved(getDb(env), body, current)
    if (changesImages) {
      await assertPendingProductImagePermission(env, row)
      await resolveProductImageFields(getDb(env), body)
    } else {
      omitUnchangedProductImageFields(body)
    }
  }
  const changes = await updateRow(env, 'products', id, body)
  if (!changes && !('image_gallery' in body)) return
  if (!changes) {
    const existing = await getDb(env).prepare('SELECT id FROM products WHERE id = @id').get<{ id: number }>({ id })
    if (!existing) return
  }
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

// Historical create requests must not bypass the fixed two-branch contract
// when a reviewer approves them after this rule is deployed.
registerApplier('branches', 'create', 'branch', async (env, row, reviewer) => {
  void env
  void row
  void reviewer
  assertCanonicalBranchSetMutationAllowed()
})

// --- branches / update / branch -----------------------------------
// Mirrors routes/branches.ts's metadata-only PUT. The current identity is
// read immediately before the shared atomic guard/write batch.
registerApplier('branches', 'update', 'branch', async (env, row, reviewer) => {
  const id = row.entity_id
  if (id == null) throw new Error('Pending branch update is missing its entity id')
  const body = JSON.parse(row.payload_json || '{}') as Record<string, unknown>
  const db = getDb(env)
  const current = await db.prepare('SELECT id, name, is_active FROM branches WHERE id = @id')
    .get<{ id: number; name: string; is_active: number }>({ id })
  if (!current) throw new Error('The branch this pending action targeted no longer exists.')
  await db.batch(branchUpdateStatements(id, body, current))
  await audit(env, reviewer.id, reviewer.name, 'update', 'branch', id, { name: current.name })
  await broadcast(env, 'branches', { action: 'update', id })
})

// --- branches / delete / branch -----------------------------------
// Historical delete requests are refused at approval time as well.
registerApplier('branches', 'delete', 'branch', async (env, row, reviewer) => {
  void env
  void row
  void reviewer
  assertCanonicalBranchSetMutationAllowed()
})

export async function applyApprovedPendingAction(env: Env, row: PendingActionRow, reviewer: ReviewerInfo): Promise<void> {
  const fn = appliers.get(applierKey(row.section, row.action_type, row.entity_type))
  if (!fn) throw new NoReviewApplierError(row.section, row.action_type, row.entity_type)
  await fn(env, row, reviewer)
}
