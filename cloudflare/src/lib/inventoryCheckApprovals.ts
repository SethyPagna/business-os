import type { D1Compat } from './db'
import { canApproveInventoryCounts } from './inventoryCheckAccess'
import { readInventoryCheckStock } from './inventoryCheckStock'
import { getActionTier } from './permissions'
import { actorSnapshot } from './actorSnapshot'
import {
  APPROVAL_COLUMNS, InventoryCheckSessionError, appliedLines, approvalsReady, authorityGuard, currentInventoryCheckActor, eventStatement, guard, inventoryCheckDigest,
  object, projectApproval, requestId as requestIdOf, schemaReady, sessionRow,
  type Actor, type ApprovalAppliedLine, type ApprovalRow, type InventoryCheckPrincipal, type Statement,
} from './inventoryCheckSessions'
import type { StockInCommitLine, StockInCommitLineResult } from '../routes/stockInCommit'

/*
 * Counts approval (ic_fix_stock, lane 6.0.1045). A submitted count that differs from stock waits here as ONE approval row; stock is untouched until
 * a person holding "approve counts" approves it. Approval sets each differing product's ordinary stock to the counted figure minus its damaged units
 * (Set excludes damaged units: count 12 with 2 damaged sets 10), through the same stock-session writer the Set sessions use, so every change has
 * its movement, history and undo exactly like a hand-made Set. Rejecting changes nothing.
 *
 * One request applies at most the plan's lines per request (Free: 1) and answers { applied, remaining, done }; the client repeats the SAME request id
 * until done. Every line is idempotent twice over: its stock request id derives from the decision request id, and a line already at its target is
 * recorded without writing, so a lost answer is repaired by repeating the request. A line is recorded in the approval row only after its stock write landed.
 */

const EPSILON = 0.000000001
const fail = (status: InventoryCheckSessionError['status'], code: string, details?: Record<string, unknown>): never => { throw new InventoryCheckSessionError(status, code, details) }

export type ApprovalStockWriter = (lines: StockInCommitLine[]) => Promise<StockInCommitLineResult[]>
type ItemFacts = { product_id: number; baseline_quantity: number | null; counted_quantity: number | null; state: 'unstarted' | 'done' | 'issue'; reason: string | null; revision: number }
type Planned = { item: ItemFacts; ordinary: number; damaged: number; total: number; target: number; settled: boolean; drifted: boolean; lotId: number | null }

/** What Set writes for a count: damaged units are not part of Set, and a target is never below zero. */
export const approvalTarget = (counted: number, damaged: number): number => Math.max(0, counted - Math.max(0, damaged))
const whole = (value: number): boolean => Math.abs(value - Math.round(value)) <= EPSILON

/** Can anyone else in the organization decide a count? Only then is a person kept from approving their own; a sole approver must still be able to. */
async function anotherApproverExists(db: D1Compat, actor: Actor): Promise<boolean> {
  const people = await db.prepare(`SELECT u.id,u.username,u.name,u.organization_id,u.role_id,u.permissions,u.is_active,r.code AS role_code,r.permissions AS role_permissions
    FROM users u LEFT JOIN roles r ON r.id=u.role_id
    WHERE u.id<>@actorId AND u.organization_id IS @organization AND u.is_active=1 AND u.deleted_at IS NULL AND COALESCE(u.must_change_password,0)=0`)
    .all<Actor>({ actorId: actor.id, organization: actor.organization_id })
  return people.some(person => canApproveInventoryCounts(person) && getActionTier(person, 'inventory', 'adjust') === 'full')
}

export async function decideInventoryCheckApproval(db: D1Compat, principal: InventoryCheckPrincipal, sessionId: string, input: unknown, writeStock: ApprovalStockWriter) {
  const body = object(input)
  const decision = body.decision === 'approve' || body.decision === 'reject' ? body.decision : fail(400, 'inventory_check_invalid_request')
  const key = requestIdOf(body.requestId)
  const note = body.note == null ? null : typeof body.note === 'string' ? body.note.trim() || null : fail(400, 'inventory_check_invalid_note')
  if (note !== null && note.length > 500) fail(400, 'inventory_check_invalid_note')
  if (body.confirmDrift !== undefined && typeof body.confirmDrift !== 'boolean') fail(400, 'inventory_check_invalid_request')
  const confirmDrift = body.confirmDrift === true
  const actor = await currentInventoryCheckActor(db, principal); await schemaReady(db); await approvalsReady(db)
  if (!canApproveInventoryCounts(actor)) fail(403, 'inventory_check_approve_required')
  const session = await sessionRow(db, actor, sessionId)
  const row = await db.prepare(`SELECT ${APPROVAL_COLUMNS} FROM inventory_check_approvals WHERE session_id=@id AND organization_id IS @organization`)
    .get<ApprovalRow>({ id: sessionId, organization: actor.organization_id })
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
    const hash = await inventoryCheckDigest(JSON.stringify({ action: 'approval', id: sessionId, decision, note }))
    await record(db, actor, [
      guard(`EXISTS(SELECT 1 FROM inventory_check_approvals WHERE session_id=@id AND status='pending' AND applied_json=@oldApplied)`, 'inventory_check_conflict', base),
      decidedUpdate('rejected', base), guard('changes()=1', 'inventory_check_conflict', {}),
      { sql: 'UPDATE inventory_check_sessions SET updated_at=@now WHERE id=@id', params: base },
      eventStatement(actor, { sessionId, action: 'observe', key, hash, before: { approval: 'pending', lines: row.lines }, after: { approval: 'rejected', lines: row.lines }, result: { sessionRevision: session.revision }, now }),
    ])
    return await respond(db, actor, sessionId, 0, 0, true)
  }

  if (getActionTier(actor, 'inventory', 'adjust') !== 'full') fail(403, 'inventory_check_adjust_required')
  const plan = remaining.length ? await preflight(db, session.branch_id, remaining, confirmDrift) : []
  const todo = plan.filter(entry => !entry.settled)
  const results = todo.length ? await writeStock(todo.map(entry => stockLine(entry, key, session.branch_id))) : []
  const resultOf = new Map(results.map(result => [String(result.key), result]))
  const landed: Planned[] = [], failed: Array<{ productId: number; code: string | null; error: string }> = []
  for (const entry of plan) {
    if (entry.settled) { landed.push(entry); continue }
    const result = resultOf.get(String(entry.item.product_id))
    if (result?.ok === true) landed.push(entry)
    else if (result && result.code !== 'deferred') failed.push({ productId: entry.item.product_id, code: typeof result.code === 'string' ? result.code : null, error: String(result.error ?? 'refused') })
  }
  if (!landed.length && failed.length) fail(409, 'inventory_check_stock_write_refused', { failed, remaining: remaining.length })
  const left = remaining.length - landed.length
  const finish = left === 0
  if (!landed.length && !finish) fail(409, 'inventory_check_stock_write_refused', { failed: [], remaining: remaining.length })

  const nextApplied: Record<string, ApprovalAppliedLine & { settled?: true }> = { ...applied }
  for (const entry of landed) nextApplied[String(entry.item.product_id)] = { before: entry.ordinary, target: entry.target, after: entry.target, at: now, ...(entry.settled ? { settled: true as const } : {}) }
  const next = { ...base, newApplied: JSON.stringify({ lines: nextApplied }) }
  const statements: Statement[] = [
    guard(`EXISTS(SELECT 1 FROM inventory_check_approvals WHERE session_id=@id AND status='pending' AND applied_json=@oldApplied)`, 'inventory_check_conflict', base),
  ]
  for (const entry of landed) {
    const { item } = entry, flip = item.state === 'issue', productId = item.product_id
    const params = { ...base, productId }
    if (flip) statements.push({ sql: `UPDATE inventory_check_items SET state='done',reason=NULL,revision=revision+1,updated_by=@actorId,updated_at=@now
      WHERE session_id=@id AND product_id=@productId AND branch_id=@branchId AND state='issue'`, params }, guard('changes()=1', 'inventory_check_conflict', {}))
    statements.push(eventStatement(actor, { sessionId, productId, action: 'observe', key: `${key}-${productId}`,
      hash: await inventoryCheckDigest(JSON.stringify({ action: 'approval-line', id: sessionId, productId, key })),
      before: { state: item.state, counted_quantity: item.counted_quantity, reason: item.reason, revision: item.revision },
      after: { state: 'done', counted_quantity: item.counted_quantity, reason: null, revision: flip ? item.revision + 1 : item.revision, approval: 'applied', stock_before: entry.ordinary, stock_after: entry.target },
      result: { sessionRevision: session.revision, itemRevision: flip ? item.revision + 1 : item.revision }, now }))
  }
  statements.push({ sql: 'UPDATE inventory_check_sessions SET updated_at=@now WHERE id=@id', params: base })
  if (finish) {
    const hash = await inventoryCheckDigest(JSON.stringify({ action: 'approval', id: sessionId, decision, note }))
    statements.push(decidedUpdate('approved', next), guard('changes()=1', 'inventory_check_conflict', {}),
      eventStatement(actor, { sessionId, action: 'observe', key, hash, before: { approval: 'pending', lines: row.lines }, after: { approval: 'approved', lines: row.lines }, result: { sessionRevision: session.revision }, now }))
  } else {
    statements.push({ sql: `UPDATE inventory_check_approvals SET applied_json=@newApplied WHERE session_id=@id AND status='pending' AND applied_json=@oldApplied`, params: next }, guard('changes()=1', 'inventory_check_conflict', {}))
  }
  await record(db, actor, statements)
  return await respond(db, actor, sessionId, landed.length, left, finish, failed)
}

/** Read the live stock of the lines still to apply and refuse, before any write, everything the approval cannot do safely. */
async function preflight(db: D1Compat, branchId: number, remaining: ItemFacts[], confirmDrift: boolean): Promise<Planned[]> {
  const stock = new Map((await readInventoryCheckStock(db, { branchId, productIds: remaining.map(item => item.product_id) })).map(row => [row.product_id, row]))
  const inconsistent: number[] = [], fractional: number[] = [], drifts: Array<{ productId: number; baseline: number; current: number }> = []
  const plan: Planned[] = []
  for (const item of remaining) {
    const row = stock.get(item.product_id)
    if (!row || !row.consistent || row.quantity == null || row.recorded_ordinary_quantity == null) { inconsistent.push(item.product_id); continue }
    const damaged = row.recorded_damaged_quantity ?? 0, target = approvalTarget(item.counted_quantity as number, damaged)
    if (!whole(target)) { fractional.push(item.product_id); continue }
    const ordinary = row.recorded_ordinary_quantity, settled = Math.abs(ordinary - target) <= EPSILON
    const drifted = !settled && Math.abs(row.quantity - (item.baseline_quantity as number)) > EPSILON
    if (drifted) drifts.push({ productId: item.product_id, baseline: item.baseline_quantity as number, current: row.quantity })
    plan.push({ item, ordinary, damaged, total: row.quantity, target: Math.round(target), settled, drifted, lotId: null })
  }
  if (inconsistent.length) fail(409, 'inventory_check_stock_inconsistent', { productIds: inconsistent })
  if (fractional.length) fail(409, 'inventory_check_target_not_whole', { productIds: fractional })
  if (drifts.length && !confirmDrift) fail(409, 'inventory_check_stock_drifted', { lines: drifts })
  const raising = plan.filter(entry => !entry.settled && entry.target > entry.ordinary)
  if (raising.length) {
    const lots = await db.prepare(`SELECT variant_product_id AS product_id,id FROM product_batches WHERE is_active=1
      AND variant_product_id IN (SELECT value FROM json_each(@ids)) ORDER BY synthetic ASC,received_at DESC,id DESC`)
      .all<{ product_id: number; id: number }>({ ids: JSON.stringify(raising.map(entry => entry.item.product_id)) })
    const newest = new Map<number, number>()
    for (const lot of lots) if (!newest.has(lot.product_id)) newest.set(lot.product_id, lot.id)
    const missing = raising.filter(entry => !newest.has(entry.item.product_id)).map(entry => entry.item.product_id)
    if (missing.length) fail(409, 'inventory_check_no_lot', { productIds: missing })
    for (const entry of raising) entry.lotId = newest.get(entry.item.product_id) as number
  }
  return plan
}

function stockLine(entry: Planned, key: string, branchId: number): StockInCommitLine {
  const productId = entry.item.product_id
  const reason = `Inventory check approved: counted ${entry.item.counted_quantity}${entry.damaged > 0 ? `, ${entry.damaged} damaged` : ''}`
  const common = { type: 'set', productId, quantity: entry.target, reason, branchId, client_request_id: `${key}-${productId}` }
  // Lowering uses the stock-session Set conversion (a FIFO removal); raising tops up the newest received date through the lot-level Set writer, which needs no supplier or cost.
  return { key: String(productId), wire: 'adjust', body: entry.target > entry.ordinary
    ? { ...common, setScope: 'branch', batchId: entry.lotId, expectedBranchQuantity: entry.ordinary } : common }
}

const decidedUpdate = (status: 'approved' | 'rejected', params: Record<string, unknown>): Statement => ({
  sql: `UPDATE inventory_check_approvals SET status='${status}',decided_by=@actorId,decided_by_name=@actorName,decided_at=@now,decision_note=@note,decision_request_id=@key${status === 'approved' ? ',applied_json=@newApplied' : ''}
    WHERE session_id=@id AND status='pending' AND applied_json=@oldApplied`, params })

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
  const row = await db.prepare(`SELECT ${APPROVAL_COLUMNS} FROM inventory_check_approvals WHERE session_id=@id AND organization_id IS @organization`).get<ApprovalRow>({ id: sessionId, organization: actor.organization_id })
  if (!row) return fail(503, 'inventory_check_outcome_unknown')
  return { approval: projectApproval(actor, row, true), applied, remaining, done, ...(failed.length ? { failed } : {}) }
}
