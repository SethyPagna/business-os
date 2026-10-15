import { executeStockTransaction } from './stockTransaction'
import { assertProductStatusInput, assertProductsActive, assertProductsHaveNoStock, productStockGuardStatement, productStockGuardError } from './productStockGuard'
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
import { audit, buildAuditStatement, changedFields } from './audit'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersion } from './cache'
import { createProductWithInitialStock, productCreateDestination, updateRow, syncProductImageGallery, readProductMoneyPlan } from './productWrites'
import { foldCreateIntoExisting, foldCreateWithStockInWrite, type FoldDuplicate } from './createFold'
import type { RedirectTarget } from './branchRedirectWrite'
import { branchUpdateStatements, assertBranchExpectedState, BranchEditConflictError, isBranchEditGuardError, BranchApprovalReceiptError } from './branchWrites'
import { assertCanonicalBranchSetMutationAllowed, type BranchIdentitySnapshot } from './canonicalBranchIdentity'
import { assertUpdatedAtMatch, getExpectedUpdatedAt } from './conflictControl'
import { getActionTier, hasPermission } from './permissions'
import { omitUnchangedProductImageFields, productImageFieldsChanged, productImageFieldsChangedResolved, resolveProductImageFields } from './productImagePermission'
import { parseProductRemovePendingPointer, parseProductRemovePlan, productRemoveApprovalStatements, productRemovePlanDigest,
  ProductRemoveError, type ProductRemoveOperationRow } from './productDelete'
import { catalogCostRecomputeStatement, typedCostEntryAfterWriteStatement } from './catalogCostRecompute'
import { findSameIdentityProduct, resolveProductIdentityEdit } from './productIdentity'
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
  // The active branch the approver confirmed for a request addressed to a branch that has since been disabled
  // (X-Branch-Redirect on the approval).
  redirectTarget?: RedirectTarget
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

// Finding I (13 Oct 2026): approving a queued product EDIT that moves a row's
// identity must never mint a second active row with another product's identity
// (no index stops it). The direct route folds such an edit into the existing
// product; the applier does not run that fold -- it is a product merge
// (merge_duplicates Full, its own preflight, undo receipt and stock
// disposition). Approval is refused instead: nothing is written and the
// request stays open, to be rejected and redone directly (which folds under
// the reviewer's own authority). routes/reviewQueue.ts answers 409.
//
// A queued CREATE that now matches an existing product no longer takes that
// refusal: it was only refused because the create-fold dropped the queued
// starting quantity. Since owner ruling 16 (13 Oct 2026) the fold records that
// quantity as a normal stock-in, so approval runs the fold (applyApprovedCreateFold).
export class ReviewIdentityConflictError extends Error {
  readonly code = 'review_identity_conflict'
  readonly existingProductId: number
  constructor(existingProductId: number) {
    super('This request now matches an existing product. Approving it would create a duplicate, so nothing was applied. Reject it and make the change yourself; it will merge into the existing product.')
    this.name = 'ReviewIdentityConflictError'
    this.existingProductId = existingProductId
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
// Mirrors routes/fees.ts's own DELETE /:id direct-write branch: the same
// version-predicated DELETE and the same before-image audit row. The actor on
// the audit row is the *reviewer* approving the change; the requester stays on
// the pending_actions row (requested_by/requested_by_name) and is named in the
// audit details too, with the request id, so the row is self-describing.
//
// The same field list as routes/fees.ts's FEE_AUDIT_COLUMNS (a route module
// cannot be imported from lib/); scripts/test-fees-k-parity-pure.cjs pins the
// two lists identical.
const FEE_DELETE_AUDIT_COLUMNS = [
  'fee_type', 'label', 'amount_usd', 'amount_khr', 'fee_date',
  'sale_id', 'branch_id', 'delivery_contact_id', 'notes',
] as const

// K3: the expense was edited after the delete was requested. Nothing is
// deleted and the request stays open for the reviewer to reject.
export class FeeReviewStaleError extends Error {
  readonly code = 'review_entity_changed'
  constructor() {
    super('This expense changed after the delete was requested. Nothing was deleted. Reject the request, or ask for it again.')
    this.name = 'FeeReviewStaleError'
  }
}

// K6: another reviewer decided (or the requester changed) the request while
// this approval was applying. Nothing is deleted.
export class ReviewDecisionConflictError extends Error {
  readonly code = 'review_already_decided'
  constructor() {
    super('Already reviewed or not found')
    this.name = 'ReviewDecisionConflictError'
  }
}

// The version the requester saw. Requests queued before the delete recorded
// one carry no expected state; they are judged against the version read at
// approval time, which still makes the before-image the record removed.
function reviewedFeeVersion(row: PendingActionRow): { known: boolean; updatedAt: string | null } {
  try {
    const state = JSON.parse(row.expected_entity_state_json || 'null') as Record<string, unknown> | null
    if (state && typeof state === 'object' && Object.prototype.hasOwnProperty.call(state, 'updated_at')) {
      return { known: true, updatedAt: state.updated_at == null ? null : String(state.updated_at) }
    }
  } catch { /* an unreadable baseline is treated as none */ }
  return { known: false, updatedAt: null }
}

registerApplier('fees', 'delete', 'fee', async (env, row, reviewer, waitUntil) => {
  const db = getDb(env)
  const id = row.entity_id
  if (id == null) throw new Error('Pending fee delete is missing its entity id')
  const existing = await db.prepare('SELECT * FROM fees WHERE id = @id').get<Record<string, unknown>>({ id })
  if (!existing) {
    // Already gone by some other path since this was queued (e.g. a
    // full-access user deleted it directly in the meantime) -- treat
    // approval as a safe no-op rather than an error, same "don't fail
    // an operation that's already effectively done" reasoning the rest
    // of this codebase uses for idempotent cleanup paths. The route marks
    // the request approved with its own WHERE status='open' guard.
    return
  }
  const reviewed = reviewedFeeVersion(row)
  const version = (existing.updated_at ?? null) as string | null
  if (reviewed.known && version !== reviewed.updatedAt) throw new FeeReviewStaleError()
  // K4 + K5c + K6: the effect (the delete, a guard that it removed exactly the
  // version read, the audit row with the before-image) and the decision (the
  // request marked approved, conditional on it still being open and exactly
  // as read) are ONE commit. A reject that lands first, a resubmission, or a
  // failure marking the request leaves neither half behind.
  try {
    await db.batch([
      { sql: 'DELETE FROM fees WHERE id = @id AND updated_at IS @version', params: { id, version } },
      { sql: `SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('fee_changed_since_read', '$') END AS fee_delete_guard`, params: {} },
      buildAuditStatement(reviewer.id, reviewer.name, 'delete', 'fee', id, {
        before: existing,
        after: null,
        pending_action_id: row.id,
        requested_by: row.requested_by,
        requested_by_name: row.requested_by_name,
      }, changedFields(existing, null, { keys: FEE_DELETE_AUDIT_COLUMNS })),
      { sql: `UPDATE pending_actions SET status = 'approved', reviewed_by = @reviewedBy, reviewed_by_name = @reviewedByName,
          reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = @pendingId AND status = 'open' AND updated_at IS @pendingVersion`,
        params: { pendingId: row.id, pendingVersion: row.updated_at, reviewedBy: reviewer.id, reviewedByName: reviewer.name } },
      { sql: `SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('review_not_open', '$') END AS review_decision_guard`, params: {} },
    ])
  } catch (error) {
    const request = await db.prepare('SELECT status, updated_at FROM pending_actions WHERE id = @id').get<{ status: string; updated_at: string }>({ id: row.id })
    if (!request || request.status !== 'open' || request.updated_at !== row.updated_at) throw new ReviewDecisionConflictError()
    const current = await db.prepare('SELECT updated_at FROM fees WHERE id = @id').get<{ updated_at: string | null }>({ id })
    if (!current || (current.updated_at ?? null) !== version) throw new FeeReviewStaleError()
    throw error
  }
  await notify(env, waitUntil, 'fees', { type: 'deleted', id })
  return { pendingActionMarkedAtomically: true }
})

// An approved create that matches an existing product: the direct route's fold, under the reviewer's authority. With
// a starting quantity the fold, the stock-in (lot, branch lot stock, branch_stock, product total, 'add' movement,
// catalog cost) and the request's own approved mark are ONE D1 batch, so a request decided meanwhile (or any failure)
// rolls all of it back and a retry cannot add the stock twice. Without one it is the cost/barcode fold, and the
// generic queue marks the request approved. Images on the queued create are not applied, as on the direct fold.
async function applyApprovedCreateFold(
  env: Env,
  row: PendingActionRow,
  reviewer: ReviewerInfo,
  twin: FoldDuplicate,
  name: string,
  body: Record<string, unknown>,
  waitUntil?: ReviewWaitUntil,
): Promise<ReviewApplyOutcome> {
  const destination = await productCreateDestination(env, body, reviewer.redirectTarget ?? null)
  if (destination.quantity > 0 && destination.branchId != null) {
    await foldCreateWithStockInWrite(env, twin, name, body, { ...destination, branchId: destination.branchId }, {
      approval: { row, reviewer: { reviewedBy: reviewer.id, reviewedByName: reviewer.name } },
      source: 'review_create_identity_fold',
      actor: { id: reviewer.id, name: reviewer.name },
      waitUntil,
    })
    return { pendingActionMarkedAtomically: true }
  }
  await foldCreateIntoExisting(env, { id: reviewer.id, username: reviewer.name }, twin, name, body,
    { id: row.requested_by, username: row.requested_by_name })
  return { pendingActionMarkedAtomically: false }
}

// --- products / create / product -----------------------------------
registerApplier('products', 'create', 'product', async (env, row, reviewer, waitUntil) => {
  const body = JSON.parse(row.payload_json || '{}') as Record<string, unknown>
  assertProductStatusInput(body)
  delete body.is_active
  readProductMoneyPlan(body)
  await resolveProductImageFields(getDb(env), body)
  const name = String(body.name || '').trim()
  if (!name) throw new Error('Pending product create is missing a name')
  // Owner rulings 9 and 16 (13 Oct 2026): a create the direct route would fold into an existing product is folded
  // here too, with its starting quantity recorded as a normal stock-in.
  const createTwin = await findSameIdentityProduct(getDb(env), name, body.barcode, null)
  if (createTwin) return applyApprovedCreateFold(env, row, reviewer, createTwin, name, body, waitUntil)
  const changesImages = productImageFieldsChanged(body)
  if (changesImages) await assertPendingProductImagePermission(env, row)
  else omitUnchangedProductImageFields(body)
  const { id } = await createProductWithInitialStock(env, body, { name, is_active: 1 }, undefined,
    { row, reviewer: { reviewedBy: reviewer.id, reviewedByName: reviewer.name } }, reviewer.redirectTarget ?? null)
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
  assertProductStatusInput(body)
  delete body.is_active
  await assertProductsActive(getDb(env), [Number(id)])
  readProductMoneyPlan(body)
  // Finding I: an edit that moves this row onto ANOTHER active product's
  // identity is the fold the direct route runs; refused here. The route's own
  // trigger: only when the identity actually moves (a whole-form save of an
  // unchanged name and barcode never looks).
  if (body.name !== undefined || body.barcode !== undefined) {
    const current = await getDb(env).prepare('SELECT name, barcode FROM products WHERE id = @id')
      .get<{ name: string | null; barcode: string | null }>({ id })
    const { nextName, nextBarcode, changesIdentity } = resolveProductIdentityEdit(current, body)
    const identityTwin = changesIdentity ? await findSameIdentityProduct(getDb(env), nextName, nextBarcode, Number(id)) : null
    if (identityTwin) throw new ReviewIdentityConflictError(identityTwin.id)
  }
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
  const db = getDb(env)
  await assertProductsHaveNoStock(db, [Number(id)])
  const results = await executeStockTransaction(db, [productStockGuardStatement([Number(id)]), {
    sql: 'UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = @id', params: { id },
  }], 'retry')
  if (!results[1]?.meta?.changes) return
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
    await executeStockTransaction(db, productRemoveApprovalStatements({ operation, plan, pendingActionId: row.id,
      reviewer: reviewerUser, transitionStamp }), 'retry')
  } catch (error) {
    const stockError = productStockGuardError(error)
    if (stockError) throw stockError
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
