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
import { ordinaryBusinessMaintenanceGuard } from './businessMaintenanceGuard'
import { audit, buildAuditStatement } from './audit'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersion } from './cache'
import { createProductWithInitialStock, updateRow, syncProductImageGallery, readProductMoneyPlan } from './productWrites'
import { branchUpdateStatements, assertBranchExpectedState, BranchEditConflictError, isBranchEditGuardError, BranchApprovalReceiptError } from './branchWrites'
import { assertCanonicalBranchSetMutationAllowed, type BranchIdentitySnapshot } from './canonicalBranchIdentity'
import { assertUpdatedAtMatch, getExpectedUpdatedAt } from './conflictControl'
import { getActionTier, hasPermission } from './permissions'
import { omitUnchangedProductImageFields, productImageFieldsChanged, productImageFieldsChangedResolved, resolveProductImageFields } from './productImagePermission'
import { parseProductRemovePendingPointer, parseProductRemovePlan, productRemoveApprovalStatements, productRemovePlanDigest,
  ProductRemoveError, type ProductRemoveOperationRow } from './productDelete'
import { catalogCostRecomputeStatement, typedCostEntryAfterWriteStatement } from './catalogCostRecompute'
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

export type ReviewApplyOutcome = { pendingActionMarkedAtomically: boolean; replayedBranchAction?: PendingActionRow }
// The approving request's waitUntil. Supplied by routes/reviewQueue.ts so a
// broadcast never holds the approval response; without one (tests, any
// non-request caller) the broadcast is awaited as before. broadcast() never
// rejects, so deferring it cannot hide an error the response would carry.
export type ReviewWaitUntil = (promise: Promise<unknown>) => void
type Applier = (env: Env, row: PendingActionRow, reviewer: ReviewerInfo, waitUntil?: ReviewWaitUntil) => Promise<void | ReviewApplyOutcome>

async function notify(env: Env, waitUntil: ReviewWaitUntil | undefined, channel: Parameters<typeof broadcast>[1], payload: unknown): Promise<void> {
  const sent = broadcast(env, channel, payload)
  if (waitUntil) waitUntil(sent)
  else await sent
}

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

export async function recoverApprovedBranchAction(env: Env, expected: PendingActionRow, reviewerId: number | null): Promise<PendingActionRow | null> {
  if (expected.section !== 'branches' || expected.action_type !== 'update' || expected.entity_type !== 'branch'
    || !Number.isSafeInteger(expected.id) || expected.id <= 0 || !Number.isSafeInteger(reviewerId) || Number(reviewerId) <= 0) return null
  const db = getDb(env)
  try {
    const receipt = await db.prepare('SELECT * FROM pending_actions WHERE id=@id').get<PendingActionRow>({ id: expected.id })
    const keys = ['id', 'section', 'action_type', 'entity_type', 'entity_id', 'requested_by', 'payload_json', 'summary', 'expected_entity_state_json'] as const
    if (!receipt || receipt.status !== 'approved' || receipt.reviewed_by !== reviewerId
      || typeof receipt.reviewed_at !== 'string' || !receipt.reviewed_at.trim()
      || keys.some(key => receipt[key] !== expected[key])) return null
    try {
      const baseline = JSON.parse(receipt.expected_entity_state_json || 'null')
      if (!baseline || baseline.entity_id !== receipt.entity_id) return null
      assertBranchExpectedState(baseline.state, receipt.expected_entity_state_json)
    } catch { return null }
    const reviewer = await db.prepare(`SELECT u.id,u.username,u.permissions,u.is_active,
      r.code AS role_code,r.permissions AS role_permissions
      FROM users u LEFT JOIN roles r ON r.id=u.role_id
      WHERE u.id=@id AND u.is_active=1 AND u.deleted_at IS NULL`).get<SessionUser>({ id: reviewerId })
    if (!reviewer || !hasPermission(reviewer, 'review')) throw new BranchApprovalReceiptError('review_permission_revoked')
    const final = await db.prepare('SELECT * FROM pending_actions WHERE id=@id').get<PendingActionRow>({ id: expected.id })
    if (!final || Object.keys(receipt).some(key => final[key as keyof PendingActionRow] !== receipt[key as keyof PendingActionRow])) return null
    return final
  } catch (error) {
    if (error instanceof BranchApprovalReceiptError) throw error
    throw new BranchApprovalReceiptError()
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
registerApplier('fees', 'delete', 'fee', async (env, row, reviewer, waitUntil) => {
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
  await notify(env, waitUntil, 'fees', { type: 'deleted', id })
})

// --- products / create / product -----------------------------------
registerApplier('products', 'create', 'product', async (env, row, reviewer, waitUntil) => {
  const body = JSON.parse(row.payload_json || '{}') as Record<string, unknown>
  readProductMoneyPlan(body)
  await resolveProductImageFields(getDb(env), body)
  const name = String(body.name || '').trim()
  if (!name) throw new Error('Pending product create is missing a name')
  const changesImages = productImageFieldsChanged(body)
  if (changesImages) await assertPendingProductImagePermission(env, row)
  else omitUnchangedProductImageFields(body)
  const { id } = await createProductWithInitialStock(env, body, { name, is_active: body.is_active == null ? 1 : body.is_active }, undefined,
    { row, reviewer: { reviewedBy: reviewer.id, reviewedByName: reviewer.name } })
  await bumpVersion(env, 'products')
  await notify(env, waitUntil, 'products', { action: 'create', id })
  return { pendingActionMarkedAtomically: true }
})

// --- products / update / product -----------------------------------
// Mirrors routes/products.ts's own PUT /:id direct-write branch. A 404
// (product deleted by some other path since this was queued) is treated
// as a safe no-op, same reasoning as the fees applier above.
registerApplier('products', 'update', 'product', async (env, row, reviewer, waitUntil) => {
  const id = row.entity_id
  if (id == null) throw new Error('Pending product update is missing its entity id')
  const body = JSON.parse(row.payload_json || '{}') as Record<string, unknown>
  readProductMoneyPlan(body)
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
  // U-cost: the approved cost must hold past the next stock movement, which
  // re-derives cost_price_usd (0195 triggers) and honours only a cost with a
  // product_cost_entries row. Record it the way the form does: a planned
  // edit goes through updateRow's own override path (entry + audit +
  // recompute in one batch); a plan-less historical queue row records the
  // same entry right after its write, against the preimage read first. The
  // actor is whoever typed the cost (the requester), else the reviewer.
  const costActor = row.requested_by != null || row.requested_by_name != null
    ? { id: row.requested_by, name: row.requested_by_name }
    : { id: reviewer.id, name: reviewer.name }
  const plannedMoney = readProductMoneyPlan(body)
  const writesCost = { usd: Object.prototype.hasOwnProperty.call(body, 'cost_price_usd'), khr: Object.prototype.hasOwnProperty.call(body, 'cost_price_khr') }
  const legacyCostBefore = !plannedMoney && (writesCost.usd || writesCost.khr)
    ? await getDb(env).prepare('SELECT cost_price_usd, cost_price_khr FROM products WHERE id = @id')
      .get<{ cost_price_usd: number | null; cost_price_khr: number | null }>({ id })
    : null
  const changes = await updateRow(env, 'products', id, body, plannedMoney ? costActor : undefined)
  const legacyEntry = legacyCostBefore && changes ? typedCostEntryAfterWriteStatement(Number(id), legacyCostBefore, writesCost, costActor) : null
  if (legacyEntry) await getDb(env).batch([legacyEntry, catalogCostRecomputeStatement(Number(id))])
  const appliedGroupRename = readProductMoneyPlan(body)?.group_rename
  if (appliedGroupRename) await audit(env, reviewer.id, reviewer.name, 'rename', 'product_group', id,
    { from: appliedGroupRename.from, to: appliedGroupRename.to, rows: appliedGroupRename.members.length })
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
  await notify(env, waitUntil, 'products', { action: 'update', id })
})

// --- products / delete / product -----------------------------------
// Mirrors routes/products.ts's own DELETE /:id (soft delete, same as
// every other product deactivation path in this app, including the
// per-branch inventory_movements rows and the reason carried through).
// The direct route already validated `reason` as required before this
// was ever queued, so it's just carried through here, not re-validated.
registerApplier('products', 'delete', 'product', async (env, row, reviewer, waitUntil) => {
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
  await notify(env, waitUntil, 'products', { action: 'delete', id })
})

// --- inventory / update / inventory_reason -------------------------
// Mirrors routes/inventory.ts's own PUT /reasons direct-write branch.
// The only inventory write wired into the queue so far (Part 152) --
// see that route's own comment for why adjust/transfer/move-row are
// deliberately NOT wired yet (live-state dependencies at apply time
// that this simple settings-row overwrite doesn't have).
registerApplier('inventory', 'update', 'inventory_reason', async (env, row, reviewer, waitUntil) => {
  const payload = JSON.parse(row.payload_json || '{}') as { items?: unknown }
  const items = Array.isArray(payload.items) ? payload.items : []
  await getDb(env).prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES ('inventory_saved_reasons', @value, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run({ value: JSON.stringify(items) })
  await audit(env, reviewer.id, reviewer.name, 'update', 'inventory_reason', null, { count: items.length })
  await notify(env, waitUntil, 'inventory', { action: 'reasons_update' })
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
registerApplier('branches', 'update', 'branch', async (env, row, reviewer, waitUntil) => {
  const id = row.entity_id
  if (id == null) throw new Error('Pending branch update is missing its entity id')
  const body = JSON.parse(row.payload_json || '{}') as Record<string, unknown>
  const db = getDb(env)
  const requester = await db.prepare(`SELECT u.id, u.username, u.role_id, u.permissions, u.is_active,
    r.id AS guard_role_id, r.code AS role_code, r.permissions AS role_permissions
    FROM users u LEFT JOIN roles r ON r.id=u.role_id
    WHERE u.id=@id AND u.is_active=1 AND u.deleted_at IS NULL`)
    .get<SessionUser & { guard_role_id: number | null }>({ id: row.requested_by })
  if (!requester || getActionTier(requester, 'branches', 'edit') === 'none') {
    throw new ReviewRequesterPermissionError('The requester no longer has permission to edit branches.')
  }
  const current = await db.prepare('SELECT * FROM branches WHERE id = @id')
    .get<BranchIdentitySnapshot & { updated_at: string }>({ id })
  if (!current) throw new BranchEditConflictError()
  assertBranchExpectedState(current, row.expected_entity_state_json)
  assertUpdatedAtMatch('branch', current, getExpectedUpdatedAt(body))
  const directory = Number(current.is_active) === 0
    ? await db.prepare('SELECT * FROM branches ORDER BY id').all<BranchIdentitySnapshot>()
    : []
  try {
    await db.batchOnce([
      { sql: `INSERT INTO branches(name) SELECT NULL WHERE NOT EXISTS (
        SELECT 1 FROM pending_actions WHERE id=@pending_id AND status='open' AND section='branches'
          AND action_type='update' AND entity_type='branch' AND entity_id IS @entity_id
          AND requested_by IS @requester_id AND payload_json IS @payload AND summary IS @summary
          AND expected_entity_state_json IS @baseline)`,
        params: { pending_id: row.id, entity_id: row.entity_id, requester_id: row.requested_by, payload: row.payload_json, summary: row.summary, baseline: row.expected_entity_state_json } },
      { sql: `INSERT INTO branches(name) SELECT NULL WHERE NOT EXISTS (
        SELECT 1 FROM users u LEFT JOIN roles r ON r.id=u.role_id
        WHERE u.id=@requester_id AND u.username IS @username AND u.is_active=1 AND u.deleted_at IS NULL
          AND u.role_id IS @role_id AND u.permissions IS @permissions AND r.id IS @joined_role_id
          AND r.code IS @role_code AND r.permissions IS @role_permissions)`,
        params: { requester_id: requester.id, username: requester.username, role_id: requester.role_id,
          permissions: requester.permissions, joined_role_id: requester.guard_role_id, role_code: requester.role_code, role_permissions: requester.role_permissions } },
      ...branchUpdateStatements(id, body, current, directory),
        buildAuditStatement(reviewer.id, reviewer.name, 'update', 'branch', id, { name: current.name }),
      { sql: `UPDATE pending_actions SET status='approved', reviewed_by=@reviewer_id, reviewed_by_name=@reviewer_name,
        reviewed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=@pending_id AND status='open'`,
        params: { pending_id: row.id, reviewer_id: reviewer.id, reviewer_name: reviewer.name } },
      ordinaryBusinessMaintenanceGuard,
    ])
  } catch (error) {
    const receipt = await recoverApprovedBranchAction(env, row, reviewer.id)
    if (receipt) return { pendingActionMarkedAtomically: true, replayedBranchAction: receipt }
    if (isBranchEditGuardError(error)) throw new BranchEditConflictError()
    throw error
  }
  await notify(env, waitUntil, 'branches', { action: 'update', id })
  return { pendingActionMarkedAtomically: true }
})

// --- branches / delete / branch -----------------------------------
// Historical delete requests are refused at approval time as well.
registerApplier('branches', 'delete', 'branch', async (env, row, reviewer) => {
  void env
  void row
  void reviewer
  assertCanonicalBranchSetMutationAllowed()
})

export function productRemovePendingPointer(row: Pick<PendingActionRow, 'payload_json'>): { operation_id: string; plan_digest: string } | null {
  try { return parseProductRemovePendingPointer(JSON.parse(row.payload_json || 'null')) }
  catch { return null }
}

async function applyApprovedProductRemove(
  env: Env,
  row: PendingActionRow,
  reviewer: ReviewerInfo,
  reviewerUser: SessionUser | undefined,
  waitUntil?: ReviewWaitUntil,
): Promise<ReviewApplyOutcome> {
  const pointer = productRemovePendingPointer(row)
  if (!pointer) throw new Error('Invalid product removal approval pointer.')
  // This guard deliberately precedes the operation/idempotency lookup.
  if (!reviewerUser || getActionTier(reviewerUser, 'products', 'delete') !== 'full') {
    throw new ReviewRequesterPermissionError('The reviewer does not have full permission to remove products.')
  }
  const requester = await loadPendingRequester(env, row.requested_by)
  if (!requester || getActionTier(requester, 'products', 'delete') === 'none') {
    throw new ReviewRequesterPermissionError('The requester no longer has permission to remove products.')
  }
  const db = getDb(env)
  const operation = await db.prepare(`SELECT * FROM product_remove_operations
    WHERE operation_id=@operation AND pending_action_id=@pending`).get<ProductRemoveOperationRow>({ operation: pointer.operation_id, pending: row.id })
  if (!operation || operation.plan_digest !== pointer.plan_digest || operation.product_id !== row.entity_id
    || operation.requester_id !== row.requested_by || operation.status !== 'approval_pending') {
    throw new ProductRemoveError('review_state_conflict', 'The saved product removal approval no longer matches its receipt.')
  }
  let plan
  try { plan = parseProductRemovePlan(JSON.parse(operation.plan_json || 'null')) }
  catch { throw new ProductRemoveError('review_state_conflict', 'The saved product removal plan is invalid.') }
  if (plan.product_id !== operation.product_id || plan.reason !== operation.reason
    || plan.state_digest !== operation.state_digest || await productRemovePlanDigest(plan) !== operation.plan_digest) {
    throw new ProductRemoveError('review_state_conflict', 'The saved product removal plan no longer matches its receipt.')
  }
  const transitionStamp = new Date().toISOString()
  try {
    await db.batch(productRemoveApprovalStatements({ operation, plan, pendingActionId: row.id,
      reviewer: reviewerUser, transitionStamp }))
  } catch (error) {
    if (/malformed JSON|product_remove_.*guard|constraint/i.test(String(error))) {
      throw new ProductRemoveError('review_state_conflict', 'The product changed after review. Nothing was approved or removed.')
    }
    throw error
  }
  await bumpVersion(env, 'products')
  await notify(env, waitUntil, 'products', { action: 'delete', id: plan.product_id })
  await notify(env, waitUntil, 'inventory', { action: 'update' })
  void reviewer
  return { pendingActionMarkedAtomically: true }
}

export async function applyApprovedPendingAction(
  env: Env,
  row: PendingActionRow,
  reviewer: ReviewerInfo,
  reviewerUser?: SessionUser,
  waitUntil?: ReviewWaitUntil,
): Promise<ReviewApplyOutcome> {
  if (productRemovePendingPointer(row)) return applyApprovedProductRemove(env, row, reviewer, reviewerUser, waitUntil)
  const fn = appliers.get(applierKey(row.section, row.action_type, row.entity_type))
  if (!fn) throw new NoReviewApplierError(row.section, row.action_type, row.entity_type)
  const outcome = await fn(env, row, reviewer, waitUntil)
  return outcome ?? { pendingActionMarkedAtomically: false }
}
