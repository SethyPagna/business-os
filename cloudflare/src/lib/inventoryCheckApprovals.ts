import type { D1Compat } from './db'
import { canApproveInventoryCounts } from './inventoryCheckAccess'
import { readInventoryCheckStock } from './inventoryCheckStock'
import { getActionTier } from './permissions'
import { actorSnapshot } from './actorSnapshot'
import {
  APPROVAL_DETAIL_COLUMNS, InventoryCheckSessionError, appliedLines, approvalBaselines, approvalsReady, authorityGuard, currentInventoryCheckActor, eventStatement, guard, inventoryCheckDigest,
  object, projectApproval, requestId as requestIdOf, schemaReady, sessionRow,
  type Actor, type ApprovalAppliedLine, type ApprovalRow, type InventoryCheckPrincipal, type Statement,
} from './inventoryCheckSessions'
import type { StockInCommitLine, StockInCommitLineResult } from '../routes/stockInCommit'

/*
 * Counts approval (ic_fix_stock, lane 6.0.1045). A submitted count that differs from stock waits here as ONE approval row; stock is untouched until
 * a person holding "approve counts" approves it. Approval applies what the count FOUND, never an absolute figure: the variance (counted minus the stock
 * the counter saw, recorded at submit) is added to the ordinary stock of the moment of approval, never below zero. A sale between the count and the
 * approval therefore survives it (saw 5, a sale leaves 4, counted 3: stock becomes 2, not 3); with nothing moved it equals counted minus damaged
 * units (count 12 with 2 damaged sets 10). Damaged units are not part of the count's effect and are never touched.
 *
 * Exactly once. Stock is claimed BEFORE it is written: one guarded update names the request id and the approver that continue the approval, and stores
 * the figures every line is about to be sent with (plan_json). A repeat after a lost answer sends the identical request, which the stock writers replay
 * instead of applying twice (their receipts are per approver and request id, so only the claiming approver continues). A claimed approval can no longer
 * be rejected: stock may already have moved. A line the stock writer refused before writing anything is planned again from live stock on the next request.
 *
 * One request applies at most the plan's lines per request (Free: 1) and answers { applied, remaining, done }; the client repeats the request until done.
 * A line is recorded in the approval row only after its stock write landed.
 */

const EPSILON = 0.000000001
const fail = (status: InventoryCheckSessionError['status'], code: string, details?: Record<string, unknown>): never => { throw new InventoryCheckSessionError(status, code, details) }

export type ApprovalStockWriter = (lines: StockInCommitLine[]) => Promise<StockInCommitLineResult[]>
type ItemFacts = { product_id: number; baseline_quantity: number | null; counted_quantity: number | null; state: 'unstarted' | 'done' | 'issue'; reason: string | null; revision: number }
/** What one line is sent with, stored before the write so a repeat is identical. */
type Plan = { before: number; target: number; counted: number; damaged: number; lot?: number }
type Open = { item: ItemFacts; plan: Plan }
type EngineRow = ApprovalRow & { plan_json: string }

/** The ordinary stock a count leaves: the stock of now, moved by what the count found against what the counter saw; never below zero. */
export const approvalTarget = (live: number, counted: number, seen: number): number => Math.max(0, live + counted - seen)
const whole = (value: number): boolean => Math.abs(value - Math.round(value)) <= EPSILON
const settled = (plan: Plan): boolean => Math.abs(plan.before - plan.target) <= EPSILON

function plansOf(json: string): Record<string, Plan> {
  try {
    const parsed = JSON.parse(json) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, Plan> : {}
  } catch { return {} }
}

/** Can anyone else in the organization decide a count? Only then is a person kept from approving their own; a sole approver must still be able to. */
async function anotherApproverExists(db: D1Compat, actor: Actor): Promise<boolean> {
  const people = await db.prepare(`SELECT u.id,u.username,u.name,u.organization_id,u.role_id,u.permissions,u.is_active,r.code AS role_code,r.permissions AS role_permissions
    FROM users u LEFT JOIN roles r ON r.id=u.role_id
    WHERE u.id<>@actorId AND u.organization_id IS @organization AND u.is_active=1 AND u.deleted_at IS NULL AND COALESCE(u.must_change_password,0)=0`)
    .all<Actor>({ actorId: actor.id, organization: actor.organization_id })
  return people.some(person => canApproveInventoryCounts(person) && getActionTier(person, 'inventory', 'adjust') === 'full')
}

/** The stock request ids (of this approver) the stock writers already hold a receipt for: whatever has one may have been written, so it is only ever repeated as it was sent. */
async function receiptsOf(db: D1Compat, actorId: number, requestIds: string[]): Promise<Set<string>> {
  if (!requestIds.length) return new Set()
  const rows = await db.prepare('SELECT request_id FROM stock_mutation_receipts WHERE actor_id=@actorId AND request_id IN (SELECT value FROM json_each(@ids))')
    .all<{ request_id: string }>({ actorId, ids: JSON.stringify(requestIds) })
  return new Set(rows.map(row => row.request_id))
}

export async function decideInventoryCheckApproval(db: D1Compat, principal: InventoryCheckPrincipal, sessionId: string, input: unknown, writeStock: ApprovalStockWriter) {
  const body = object(input)
  const decision = body.decision === 'approve' || body.decision === 'reject' ? body.decision : fail(400, 'inventory_check_invalid_request')
  const key = requestIdOf(body.requestId)
  const note = body.note == null ? null : typeof body.note === 'string' ? body.note.trim() || null : fail(400, 'inventory_check_invalid_note')
  if (note !== null && note.length > 500) fail(400, 'inventory_check_invalid_note')
  const actor = await currentInventoryCheckActor(db, principal); await schemaReady(db); await approvalsReady(db)
  if (!canApproveInventoryCounts(actor)) fail(403, 'inventory_check_approve_required')
  const session = await sessionRow(db, actor, sessionId)
  const row = await db.prepare(`SELECT ${APPROVAL_DETAIL_COLUMNS},plan_json FROM inventory_check_approvals WHERE session_id=@id AND organization_id IS @organization`)
    .get<EngineRow>({ id: sessionId, organization: actor.organization_id })
  if (!row) return fail(404, 'inventory_check_approval_not_found')
  if (row.status !== 'pending') {
    if (row.decision_request_id === key && (decision === 'approve') === (row.status === 'approved')) return { approval: projectApproval(actor, row, true), applied: 0, remaining: 0, done: true, replayed: true }
    return fail(409, 'inventory_check_approval_decided')
  }
  if (decision === 'approve' && row.submitted_by === actor.id && await anotherApproverExists(db, actor)) fail(403, 'inventory_check_self_approval')
  const items = await db.prepare(`SELECT product_id,baseline_quantity,counted_quantity,state,reason,revision FROM inventory_check_items
    WHERE session_id=@id AND branch_id=@branchId ORDER BY product_id`).all<ItemFacts>({ id: sessionId, branchId: session.branch_id })
  const lines = items.filter(item => item.baseline_quantity != null && item.counted_quantity != null && Math.abs(item.baseline_quantity - item.counted_quantity) > EPSILON)
  if (lines.length !== row.lines) return fail(409, 'inventory_check_approval_lines_changed')
  const applied = appliedLines(row.applied_json)
  const remaining = lines.filter(item => !applied[String(item.product_id)])
  const now = new Date().toISOString()
  const base = { id: sessionId, organization: actor.organization_id, branchId: session.branch_id, actorId: actor.id, actorName: actorSnapshot(actor), now, note, key, oldApplied: row.applied_json }

  if (decision === 'reject') {
    if (Object.keys(applied).length) fail(409, 'inventory_check_approval_partly_applied')
    if (row.applying_request_id) fail(409, 'inventory_check_approval_in_progress')
    const hash = await inventoryCheckDigest(JSON.stringify({ action: 'approval', id: sessionId, decision, note }))
    await record(db, actor, [
      guard(`EXISTS(SELECT 1 FROM inventory_check_approvals WHERE session_id=@id AND status='pending' AND applied_json=@oldApplied AND applying_request_id IS NULL)`, 'inventory_check_conflict', base),
      decidedUpdate('rejected', base), guard('changes()=1', 'inventory_check_conflict', {}),
      { sql: 'UPDATE inventory_check_sessions SET updated_at=@now WHERE id=@id', params: base },
      eventStatement(actor, { sessionId, action: 'observe', key, hash, before: { approval: 'pending', lines: row.lines }, after: { approval: 'rejected', lines: row.lines }, result: { sessionRevision: session.revision }, now }),
    ])
    return await respond(db, actor, sessionId, 0, 0, true)
  }

  if (getActionTier(actor, 'inventory', 'adjust') !== 'full') fail(403, 'inventory_check_adjust_required')
  // Only the approver who started applying continues it, and always under the request id that started it: the stock writers' receipts are per approver and request id.
  if (row.applying_request_id && row.applying_by !== actor.id) fail(409, 'inventory_check_approval_in_progress')
  const stockKey = row.applying_request_id ?? key
  const stored = plansOf(row.plan_json)
  const sent = await receiptsOf(db, actor.id, remaining.filter(item => stored[String(item.product_id)]).map(item => `${stockKey}-${item.product_id}`))
  const fresh = remaining.filter(item => !(stored[String(item.product_id)] && sent.has(`${stockKey}-${item.product_id}`)))
  const planned = fresh.length ? await planLines(db, session.branch_id, fresh, approvalBaselines(row.baselines_json)) : new Map<string, Plan>()
  const open: Open[] = remaining.map(item => ({ item, plan: planned.get(String(item.product_id)) ?? stored[String(item.product_id)] }))
  const todo = open.filter(entry => !settled(entry.plan))
  const plansOfTodo = (entries: Open[]): string => JSON.stringify(Object.fromEntries(entries.map(entry => [String(entry.item.product_id), entry.plan])))
  const claim = { ...base, stockKey, newPlan: plansOfTodo(todo), oldPlan: row.plan_json }
  const claimMine = `(applying_request_id IS NULL OR (applying_request_id=@stockKey AND applying_by=@actorId))`
  if (todo.length && (!row.applying_request_id || claim.newPlan !== row.plan_json)) {
    await record(db, actor, [
      { sql: `UPDATE inventory_check_approvals SET applying_request_id=@stockKey,applying_by=@actorId,plan_json=@newPlan
        WHERE session_id=@id AND status='pending' AND applied_json=@oldApplied AND plan_json=@oldPlan AND ${claimMine}`, params: claim },
      guard('changes()=1', 'inventory_check_conflict', {}),
    ])
  }

  const results = todo.length ? await writeStock(todo.map(entry => stockLine(entry, stockKey, session.branch_id))) : []
  const resultOf = new Map(results.map(result => [String(result.key), result]))
  const landed: Open[] = [], failed: Array<{ productId: number; code: string | null; error: string }> = []
  for (const entry of open) {
    if (settled(entry.plan)) { landed.push(entry); continue }
    const result = resultOf.get(String(entry.item.product_id))
    if (result?.ok === true) landed.push(entry)
    else if (result && result.code !== 'deferred') failed.push({ productId: entry.item.product_id, code: typeof result.code === 'string' ? result.code : null, error: String(result.error ?? 'refused') })
  }
  const left = remaining.length - landed.length
  const finish = left === 0
  if (!landed.length && !finish) {
    await releaseUntouched(db, actor, claim, applied, todo.map(entry => `${stockKey}-${entry.item.product_id}`))
    fail(409, 'inventory_check_stock_write_refused', { failed, remaining: remaining.length })
  }

  const nextApplied: Record<string, ApprovalAppliedLine & { settled?: true }> = { ...applied }
  for (const entry of landed) nextApplied[String(entry.item.product_id)] = { before: entry.plan.before, target: entry.plan.target, after: entry.plan.target, at: now, ...(settled(entry.plan) ? { settled: true as const } : {}) }
  const landedIds = new Set(landed.map(entry => entry.item.product_id))
  const next = { ...base, stockKey, newApplied: JSON.stringify({ lines: nextApplied }), planAfter: plansOfTodo(todo.filter(entry => !landedIds.has(entry.item.product_id))) }
  const statements: Statement[] = [
    guard(`EXISTS(SELECT 1 FROM inventory_check_approvals WHERE session_id=@id AND status='pending' AND applied_json=@oldApplied AND ${claimMine})`, 'inventory_check_conflict', next),
  ]
  for (const entry of landed) {
    const { item } = entry, flip = item.state === 'issue', productId = item.product_id
    const params = { ...base, productId }
    if (flip) statements.push({ sql: `UPDATE inventory_check_items SET state='done',reason=NULL,revision=revision+1,updated_by=@actorId,updated_at=@now
      WHERE session_id=@id AND product_id=@productId AND branch_id=@branchId AND state='issue'`, params }, guard('changes()=1', 'inventory_check_conflict', {}))
    statements.push(eventStatement(actor, { sessionId, productId, action: 'observe', key: `${stockKey}-${productId}`,
      hash: await inventoryCheckDigest(JSON.stringify({ action: 'approval-line', id: sessionId, productId, key: stockKey })),
      before: { state: item.state, counted_quantity: item.counted_quantity, reason: item.reason, revision: item.revision },
      after: { state: 'done', counted_quantity: item.counted_quantity, reason: null, revision: flip ? item.revision + 1 : item.revision, approval: 'applied', stock_before: entry.plan.before, stock_after: entry.plan.target },
      result: { sessionRevision: session.revision, itemRevision: flip ? item.revision + 1 : item.revision }, now }))
  }
  statements.push({ sql: 'UPDATE inventory_check_sessions SET updated_at=@now WHERE id=@id', params: base })
  if (finish) {
    const hash = await inventoryCheckDigest(JSON.stringify({ action: 'approval', id: sessionId, decision, note }))
    statements.push(decidedUpdate('approved', { ...next, key: stockKey }), guard('changes()=1', 'inventory_check_conflict', {}),
      eventStatement(actor, { sessionId, action: 'observe', key: stockKey, hash, before: { approval: 'pending', lines: row.lines }, after: { approval: 'approved', lines: row.lines }, result: { sessionRevision: session.revision }, now }))
  } else {
    statements.push({ sql: `UPDATE inventory_check_approvals SET applied_json=@newApplied,plan_json=@planAfter WHERE session_id=@id AND status='pending' AND applied_json=@oldApplied AND ${claimMine}`, params: next },
      guard('changes()=1', 'inventory_check_conflict', {}))
  }
  await record(db, actor, statements)
  return await respond(db, actor, sessionId, landed.length, left, finish, failed)
}

/** Read the live stock of the lines still to apply and plan each one, refusing before any write everything the approval cannot do safely. */
async function planLines(db: D1Compat, branchId: number, lines: ItemFacts[], baselines: Record<string, number>): Promise<Map<string, Plan>> {
  const stock = new Map((await readInventoryCheckStock(db, { branchId, productIds: lines.map(item => item.product_id) })).map(row => [row.product_id, row]))
  const inconsistent: number[] = [], unseen: number[] = [], belowDamaged: number[] = [], fractional: number[] = []
  const plans = new Map<string, Plan>()
  for (const item of lines) {
    const row = stock.get(item.product_id), id = String(item.product_id)
    if (!row || !row.consistent || row.quantity == null || row.recorded_ordinary_quantity == null) { inconsistent.push(item.product_id); continue }
    const seen = baselines[id], counted = item.counted_quantity as number, damaged = row.recorded_damaged_quantity ?? 0
    if (seen === undefined) { unseen.push(item.product_id); continue }
    if (counted + EPSILON < damaged) { belowDamaged.push(item.product_id); continue }
    const target = approvalTarget(row.recorded_ordinary_quantity, counted, seen)
    if (!whole(target)) { fractional.push(item.product_id); continue }
    plans.set(id, { before: row.recorded_ordinary_quantity, target: Math.round(target), counted, damaged })
  }
  if (inconsistent.length) fail(409, 'inventory_check_stock_inconsistent', { productIds: inconsistent })
  if (unseen.length) fail(409, 'inventory_check_baseline_missing', { productIds: unseen })
  if (belowDamaged.length) fail(409, 'inventory_check_count_below_damaged', { productIds: belowDamaged })
  if (fractional.length) fail(409, 'inventory_check_target_not_whole', { productIds: fractional })
  const raising = [...plans.entries()].filter(([, plan]) => plan.target > plan.before)
  if (raising.length) {
    // A raise tops up the newest received date, one that already holds this branch's stock first.
    const lots = await db.prepare(`SELECT b.variant_product_id AS product_id,b.id FROM product_batches b WHERE b.is_active=1
      AND b.variant_product_id IN (SELECT value FROM json_each(@ids))
      ORDER BY EXISTS(SELECT 1 FROM branch_batch_stock s WHERE s.batch_id=b.id AND s.branch_id=@branchId) DESC,b.synthetic ASC,b.received_at DESC,b.id DESC`)
      .all<{ product_id: number; id: number }>({ ids: JSON.stringify(raising.map(([id]) => Number(id))), branchId })
    const newest = new Map<number, number>()
    for (const lot of lots) if (!newest.has(lot.product_id)) newest.set(lot.product_id, lot.id)
    const missing = raising.map(([id]) => Number(id)).filter(id => !newest.has(id))
    if (missing.length) fail(409, 'inventory_check_no_lot', { productIds: missing })
    for (const [id, plan] of raising) plan.lot = newest.get(Number(id))
  }
  return plans
}

/**
 * The stock writers refused every line of this request. If none of them holds a receipt, nothing was written, so a claim made only for this request is
 * released (the approval can be rejected again, and the lines are planned afresh); otherwise it stays: stock may have moved.
 */
async function releaseUntouched(db: D1Compat, actor: Actor, claim: Record<string, unknown>, applied: Record<string, unknown>, requestIds: string[]): Promise<void> {
  if (Object.keys(applied).length || (await receiptsOf(db, actor.id, requestIds)).size) return
  try {
    await record(db, actor, [{ sql: `UPDATE inventory_check_approvals SET applying_request_id=NULL,applying_by=NULL,plan_json='{}'
      WHERE session_id=@id AND status='pending' AND applied_json='{}' AND applying_request_id=@stockKey AND applying_by=@actorId`, params: claim }])
  } catch { /* the claim stays; the next request plans again */ }
}

function stockLine(entry: Open, stockKey: string, branchId: number): StockInCommitLine {
  const { item, plan } = entry, productId = item.product_id
  const common = { productId, reason: `Inventory check approved: counted ${plan.counted}${plan.damaged > 0 ? `, ${plan.damaged} damaged` : ''}`, branchId, client_request_id: `${stockKey}-${productId}` }
  // Lowering removes the difference (first-in first-out); raising tops up one received date through the lot-level Set writer, which needs no supplier or cost
  // and refuses if the branch's stock moved since it was planned.
  return { key: String(productId), wire: 'adjust', body: plan.target > plan.before
    ? { ...common, type: 'set', quantity: plan.target, setScope: 'branch', batchId: plan.lot, expectedBranchQuantity: plan.before }
    : { ...common, type: 'remove', quantity: plan.before - plan.target } }
}

const decidedUpdate = (status: 'approved' | 'rejected', params: Record<string, unknown>): Statement => ({
  sql: `UPDATE inventory_check_approvals SET status='${status}',decided_by=@actorId,decided_by_name=@actorName,decided_at=@now,decision_note=@note,decision_request_id=@key${status === 'approved' ? ",applied_json=@newApplied,plan_json='{}'" : ''}
    WHERE session_id=@id AND status='pending' AND applied_json=@oldApplied${status === 'rejected' ? ' AND applying_request_id IS NULL' : ''}`, params })

async function record(db: D1Compat, actor: Actor, statements: Statement[]): Promise<void> {
  try { await db.batchOnce([authorityGuard(actor), ...statements]) }
  catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    if (text.includes('inventory_check_authority_changed')) return fail(403, 'inventory_check_authority_changed')
    if (text.includes('inventory_check_conflict')) return fail(409, 'inventory_check_conflict')
    return fail(503, 'inventory_check_outcome_unknown')
  }
}

async function respond(db: D1Compat, actor: Actor, sessionId: string, applied: number, remaining: number, done: boolean, failed: Array<{ productId: number; code: string | null; error: string }> = []) {
  const row = await db.prepare(`SELECT ${APPROVAL_DETAIL_COLUMNS} FROM inventory_check_approvals WHERE session_id=@id AND organization_id IS @organization`).get<ApprovalRow>({ id: sessionId, organization: actor.organization_id })
  if (!row) return fail(503, 'inventory_check_outcome_unknown')
  return { approval: projectApproval(actor, row, true), applied, remaining, done, ...(failed.length ? { failed } : {}) }
}
