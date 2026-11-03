import type { D1Compat } from './db'
import { canApproveInventoryCounts } from './inventoryCheckAccess'
import { readInventoryCheckStock } from './inventoryCheckStock'
import { getActionTier } from './permissions'
import { actorSnapshot } from './actorSnapshot'
import { APPROVAL_CLAIM_LOST } from './stockMutationReceipt'
import {
  APPROVAL_DETAIL_COLUMNS, InventoryCheckSessionError, appliedLines, approvalBaselines, approvalsReady, authorityGuard, currentInventoryCheckActor, eventStatement, guard, inventoryCheckDigest,
  object, projectApproval, requestId as requestIdOf, REPLACED_NOTE, schemaReady, sessionRow, supersededLines,
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
 * It can always be ended. A line that cannot be applied (retired product, damaged units tagged since, no received date, ...) is refused ON ITS OWN: the others are
 * applied. An approver can CLOSE what is left: no stock moves, the lines applied stay applied and the rest are recorded as not applied, each with its reason. If the claiming
 * approver is deactivated, has lost the right, or has been idle for the plan's takeover window, any other approver takes the approval over: the claimer's receipts say which
 * lines landed (they are recorded), the others are planned afresh and sent under the new approver's own request id, never the old one (receipts are per approver).
 *
 * The claim is what orders them. Every stock write of an approval carries the claim it is written under, and the stock commits only while that claim is still the writer's own: the
 * check rides inside the batch that writes the stock (stockMutationReceipt.ts). A takeover or a close, in turn, commits only if no write of the old claim landed that it did not read
 * (its batch re-proves the receipts). Whichever commits first wins and the other writes nothing, so the record can never disagree with the stock, whatever the timing. A claimer
 * cannot be closed under by another approver until he is gone, exactly as for a takeover. Every transition of a claimed approval commits only over the plan it read (plan_json): a line that
 * joins the plan after a read may already be written by the claimer, which the receipts of the lines read cannot show. That holds for a takeover, a close, the claimer's own landing and
 * the release of a claim that wrote nothing (which also needs that none of the plan's receipts is written). An unclaimed approval can be rejected, and nothing can write for it.
 *
 * An approval every remaining line of which a newer count replaced ends as REPLACED, whichever way it ends (rejected in the submission that replaced the last line, or finished or closed once it
 * was claimed): rejected by no person (decided_by is NULL), with a note that says why, and the same review alert as any rejection.
 *
 * A line a newer count of the same product has replaced (superseded_json; queue-first, one waiting item per product) is never applied, and is not a line to close either. The replacement
 * is refused while a line's figures are planned, and every decision below writes the approval row only if the set of superseded lines is the one it read, so a replacement and a plan
 * never both happen.
 *
 * One request applies at most the plan's lines per request (Free: 1) and answers { applied, remaining, done }; the client repeats the request until done.
 * A line is recorded in the approval row only after its stock write landed.
 */

const EPSILON = 0.000000001
const fail = (status: InventoryCheckSessionError['status'], code: string, details?: Record<string, unknown>): never => { throw new InventoryCheckSessionError(status, code, details) }

export type ApprovalStockWriter = (lines: StockInCommitLine[]) => Promise<StockInCommitLineResult[]>
/** Told once when a decision commits (never for a replay): who decided is the caller's own account; the reason is the rejection note. */
export type ApprovalDecided = (decided: { decision: ApprovalDecision | 'replaced'; sessionId: string; note: string | null; applied?: number; notApplied?: number }) => Promise<void>
export type ApprovalDecision = 'approve' | 'reject' | 'close'
/** The plan-sized numbers (lib/planTier.ts); the caller reads them, this module holds no literal. */
export type ApprovalLimits = { takeoverSeconds: number }
/** Why one line cannot be applied now. */
type Refusal = { productId: number; code: string }
type ItemFacts = { product_id: number; baseline_quantity: number | null; counted_quantity: number | null; state: 'unstarted' | 'done' | 'issue'; reason: string | null; revision: number }
/** What one line is sent with, stored before the write so a repeat is identical. */
type Plan = { before: number; target: number; counted: number; damaged: number; lot?: number; clamped?: true; wanted?: number }
type Open = { item: ItemFacts; plan: Plan }
type EngineRow = ApprovalRow & { plan_json: string }

/** The ordinary stock a count leaves: the stock of now, moved by what the count found against what the counter saw. This is the figure WANTED; it can be below zero. */
export const approvalWanted = (live: number, counted: number, seen: number): number => live + counted - seen
/** What is applied: the figure wanted, never below zero. A plan records when the floor held it back (clamped, with the figure wanted), so a shortage the stock could not take is never silent. */
export const approvalTarget = (live: number, counted: number, seen: number): number => Math.max(0, approvalWanted(live, counted, seen))
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

/**
 * What a claim left behind. A write that landed has a receipt with written = 1 (the stock writers commit that mark in the same batch as the stock), so its line is RECORDED as applied from
 * the plan it was sent with. A receipt that wrote nothing says nothing: a request that has not written yet can no longer write once the claim moves (stockMutationReceipt.ts).
 * `unseen` are the receipt ids of the lines read as not landed: the batch that moves the claim proves none of them has landed since.
 */
async function reconcile(db: D1Compat, row: EngineRow, remaining: ItemFacts[], stored: Record<string, Plan>): Promise<{ landed: Open[]; unseen: string[] }> {
  const claimKey = row.applying_request_id as string
  const planned = remaining.filter(item => stored[String(item.product_id)])
  const ids = planned.map(item => `${claimKey}-${item.product_id}`)
  const written = ids.length ? new Set((await db.prepare('SELECT request_id FROM stock_mutation_receipts WHERE actor_id=@actorId AND written=1 AND request_id IN (SELECT value FROM json_each(@ids))')
    .all<{ request_id: string }>({ actorId: row.applying_by, ids: JSON.stringify(ids) })).map(receipt => receipt.request_id)) : new Set<string>()
  const landed = planned.filter(item => written.has(`${claimKey}-${item.product_id}`)).map(item => ({ item, plan: stored[String(item.product_id)] }))
  return { landed, unseen: ids.filter(id => !written.has(id)) }
}

/** The approval row is exactly as this decision read it: the same lines applied and the same lines replaced by newer counts. */
const UNCHANGED = `applied_json=@oldApplied AND superseded_json=@oldSuperseded`

/** True while no write of the old claim has landed that this decision did not read; proved inside the batch that ends the claim, so a write that lands in between is refused here, never overwritten. */
const NO_UNSEEN_WRITE_SQL = `NOT EXISTS(SELECT 1 FROM stock_mutation_receipts WHERE actor_id=@oldBy AND written=1 AND request_id IN (SELECT value FROM json_each(@unseenIds)))`

/** Is the approver who holds the claim gone? Deactivated or deleted, no longer allowed to apply counts, or idle for the plan's takeover window. */
async function claimerGone(db: D1Compat, row: EngineRow, takeoverSeconds: number): Promise<'idle' | 'inactive' | 'permission' | null> {
  if (row.applying_at && Date.now() - Date.parse(row.applying_at) >= takeoverSeconds * 1000) return 'idle'
  const claimer = await db.prepare(`SELECT u.id,u.username,u.name,u.organization_id,u.role_id,u.permissions,u.is_active,u.deleted_at,COALESCE(u.must_change_password,0) AS must_change_password,r.code AS role_code,r.permissions AS role_permissions
    FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=@id`).get<Actor & { is_active: number; deleted_at: string | null; must_change_password: number }>({ id: row.applying_by })
  if (!claimer || claimer.is_active !== 1 || claimer.deleted_at !== null || claimer.must_change_password === 1) return 'inactive'
  return canApproveInventoryCounts(claimer) && getActionTier(claimer, 'inventory', 'adjust') === 'full' ? null : 'permission'
}

/** The stock request ids (of this approver) the stock writers already hold a receipt for: whatever has one may have been written, so it is only ever repeated as it was sent. */
async function receiptsOf(db: D1Compat, actorId: number, requestIds: string[]): Promise<Set<string>> {
  if (!requestIds.length) return new Set()
  const rows = await db.prepare('SELECT request_id FROM stock_mutation_receipts WHERE actor_id=@actorId AND request_id IN (SELECT value FROM json_each(@ids))')
    .all<{ request_id: string }>({ actorId, ids: JSON.stringify(requestIds) })
  return new Set(rows.map(row => row.request_id))
}

export async function decideInventoryCheckApproval(db: D1Compat, principal: InventoryCheckPrincipal, sessionId: string, input: unknown, writeStock: ApprovalStockWriter, limits: ApprovalLimits, onDecided?: ApprovalDecided) {
  const body = object(input)
  const decision: ApprovalDecision = body.decision === 'approve' || body.decision === 'reject' || body.decision === 'close' ? body.decision : fail(400, 'inventory_check_invalid_request')
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
    const decidedAs: ApprovalDecision = row.closed_json ? 'close' : row.status === 'approved' ? 'approve' : 'reject'
    if (row.decision_request_id === key && decidedAs === decision) return { approval: projectApproval(actor, row, true), applied: 0, remaining: 0, done: true, replayed: true }
    return fail(409, 'inventory_check_approval_decided')
  }
  if (decision === 'approve' && row.submitted_by === actor.id && await anotherApproverExists(db, actor)) fail(403, 'inventory_check_self_approval')
  const items = await db.prepare(`SELECT product_id,baseline_quantity,counted_quantity,state,reason,revision FROM inventory_check_items
    WHERE session_id=@id AND branch_id=@branchId ORDER BY product_id`).all<ItemFacts>({ id: sessionId, branchId: session.branch_id })
  const lines = items.filter(item => item.baseline_quantity != null && item.counted_quantity != null && Math.abs(item.baseline_quantity - item.counted_quantity) > EPSILON)
  if (lines.length !== row.lines) return fail(409, 'inventory_check_approval_lines_changed')
  const applied = appliedLines(row.applied_json)
  const superseded = supersededLines(row.superseded_json)
  const remaining = lines.filter(item => !applied[String(item.product_id)] && !superseded[String(item.product_id)])
  const now = new Date().toISOString()
  const base = { id: sessionId, organization: actor.organization_id, branchId: session.branch_id, actorId: actor.id, actorName: actorSnapshot(actor), now, note, key, oldApplied: row.applied_json, oldSuperseded: row.superseded_json }

  if (decision === 'reject') {
    if (Object.keys(applied).length) fail(409, 'inventory_check_approval_partly_applied')
    if (row.applying_request_id) fail(409, 'inventory_check_approval_in_progress')
    const hash = await inventoryCheckDigest(JSON.stringify({ action: 'approval', id: sessionId, decision, note }))
    await record(db, actor, [
      guard(`EXISTS(SELECT 1 FROM inventory_check_approvals WHERE session_id=@id AND status='pending' AND ${UNCHANGED} AND applying_request_id IS NULL)`, 'inventory_check_conflict', base),
      decidedUpdate('rejected', base), guard('changes()=1', 'inventory_check_conflict', {}),
      { sql: 'UPDATE inventory_check_sessions SET updated_at=@now WHERE id=@id', params: base },
      eventStatement(actor, { sessionId, action: 'observe', key, hash, before: { approval: 'pending', lines: row.lines }, after: { approval: 'rejected', lines: row.lines }, result: { sessionRevision: session.revision }, now }),
    ])
    await announce(onDecided, { decision, sessionId, note })
    return await respond(db, actor, sessionId, 0, 0, true)
  }

  const stored = plansOf(row.plan_json)
  const count = { sessionId, submittedAt: row.submitted_at }
  if (decision === 'close') return await closeApproval(db, actor, session, row, base, { remaining, applied, stored, count, limits, onDecided })

  if (getActionTier(actor, 'inventory', 'adjust') !== 'full') fail(403, 'inventory_check_adjust_required')
  // Only the approver who started applying continues it, and always under the request id that started it: the stock writers' receipts are per approver and request id.
  // Another approver takes it over only when that approver is gone; the takeover is a request of its own (it moves no stock) and the repeat continues under the new key.
  if (row.applying_request_id && row.applying_by !== actor.id) {
    const why = await claimerGone(db, row, limits.takeoverSeconds)
    if (!why) fail(409, 'inventory_check_approval_in_progress')
    return await takeOver(db, actor, session, row, base, { why: why as string, remaining, applied, stored, limits })
  }
  const stockKey = row.applying_request_id ?? key
  const sent = await receiptsOf(db, actor.id, remaining.filter(item => stored[String(item.product_id)]).map(item => `${stockKey}-${item.product_id}`))
  const fresh = remaining.filter(item => !(stored[String(item.product_id)] && sent.has(`${stockKey}-${item.product_id}`)))
  const { plans: planned, refused } = fresh.length ? await planLines(db, session.branch_id, fresh, approvalBaselines(row.baselines_json), count) : { plans: new Map<string, Plan>(), refused: [] as Refusal[] }
  const refusedIds = new Set(refused.map(refusal => refusal.productId))
  // A line that cannot be applied is refused on its own; the others go on. When nothing is left to apply, the request itself is refused with the first reason, naming every refused line.
  const open: Open[] = remaining.filter(item => !refusedIds.has(item.product_id)).map(item => ({ item, plan: planned.get(String(item.product_id)) ?? stored[String(item.product_id)] }))
  if (!open.length && refused.length) fail(409, refused[0].code, { productIds: refused.filter(refusal => refusal.code === refused[0].code).map(refusal => refusal.productId), refused })
  const todo = open.filter(entry => !settled(entry.plan))
  const plansOfTodo = (entries: Open[]): string => JSON.stringify(Object.fromEntries(entries.map(entry => [String(entry.item.product_id), entry.plan])))
  const claim = { ...base, stockKey, newPlan: plansOfTodo(todo), oldPlan: row.plan_json }
  const claimMine = `(applying_request_id IS NULL OR (applying_request_id=@stockKey AND applying_by=@actorId))`
  let recorded = false
  if (todo.length && (!row.applying_request_id || claim.newPlan !== row.plan_json)) {
    recorded = true
    await record(db, actor, [
      { sql: `UPDATE inventory_check_approvals SET applying_request_id=@stockKey,applying_by=@actorId,applying_at=@now,plan_json=@newPlan
        WHERE session_id=@id AND status='pending' AND ${UNCHANGED} AND plan_json=@oldPlan AND ${claimMine}`, params: claim },
      guard('changes()=1', 'inventory_check_conflict', {}),
    ])
  }

  const results = todo.length ? await writeStock(todo.map(entry => stockLine(entry, stockKey, session.branch_id, sessionId))) : []
  // The claim moved (a takeover or a close committed first): this request wrote nothing for the line, and whoever took the claim records what had landed from the receipts.
  if (results.some(result => result.ok !== true && result.code === APPROVAL_CLAIM_LOST)) fail(409, APPROVAL_CLAIM_LOST)
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
    // Planning a count is the dearest request of an approval, and the stock writer sends nothing once the request has used the invocation's statements (the commit answers those lines 'deferred', untouched).
    // When this request has just recorded the plan, that costs nothing: the claim and the plan stay and the repeat, which does not record again, writes. A repeat that defers again is a refusal.
    if (recorded && !failed.length && results.some(result => result.code === 'deferred')) return await respond(db, actor, sessionId, 0, remaining.length, false, { refused, deferred: true })
    await releaseUntouched(db, actor, { ...claim, planNow: recorded ? claim.newPlan : row.plan_json }, applied, todo.map(entry => `${stockKey}-${entry.item.product_id}`))
    fail(409, 'inventory_check_stock_write_refused', { failed, remaining: remaining.length, ...(refused.length ? { refused } : {}) })
  }

  const nextApplied: Record<string, ApprovalAppliedLine & { settled?: true }> = { ...applied }
  for (const entry of landed) nextApplied[String(entry.item.product_id)] = { before: entry.plan.before, target: entry.plan.target, after: entry.plan.target, at: now, ...(settled(entry.plan) ? { settled: true as const } : {}), ...clampOf(entry.plan) }
  const landedIds = new Set(landed.map(entry => entry.item.product_id))
  // Nothing applied and nothing left to apply: every line was replaced by a newer count after this approval was claimed. It ends as replaced, exactly as a close does in that case.
  const replacedOnly = finish && Object.keys(nextApplied).length === 0
  // The plan this request wrote or read: a request of the same claimer that recorded another plan in between is not overwritten (the repeat replays what landed).
  const next = { ...base, stockKey, planBefore: recorded ? claim.newPlan : row.plan_json, newApplied: JSON.stringify({ lines: nextApplied }), planAfter: plansOfTodo(todo.filter(entry => !landedIds.has(entry.item.product_id))) }
  const statements: Statement[] = [
    guard(`EXISTS(SELECT 1 FROM inventory_check_approvals WHERE session_id=@id AND status='pending' AND ${UNCHANGED} AND plan_json=@planBefore AND ${claimMine})`, 'inventory_check_conflict', next),
  ]
  statements.push(...await landingStatements(actor, sessionId, session.revision, base, landed, stockKey))
  statements.push({ sql: 'UPDATE inventory_check_sessions SET updated_at=@now WHERE id=@id', params: base })
  if (finish) {
    const hash = await inventoryCheckDigest(JSON.stringify({ action: 'approval', id: sessionId, decision, note }))
    statements.push(replacedOnly ? replacedUpdate({ ...next, key: stockKey }) : decidedUpdate('approved', { ...next, key: stockKey }), guard('changes()=1', 'inventory_check_conflict', {}),
      eventStatement(actor, { sessionId, action: 'observe', key: stockKey, hash, before: { approval: 'pending', lines: row.lines }, after: { approval: replacedOnly ? 'rejected' : 'approved', lines: row.lines, ...(replacedOnly ? { replaced: true } : {}) }, result: { sessionRevision: session.revision }, now }))
  } else {
    statements.push({ sql: `UPDATE inventory_check_approvals SET applied_json=@newApplied,plan_json=@planAfter,applying_at=@now WHERE session_id=@id AND status='pending' AND ${UNCHANGED} AND plan_json=@planBefore AND ${claimMine}`, params: next },
      guard('changes()=1', 'inventory_check_conflict', {}))
  }
  await record(db, actor, statements)
  if (finish) await announce(onDecided, replacedOnly ? { decision: 'replaced', sessionId, note: REPLACED_NOTE } : { decision, sessionId, note })
  return await respond(db, actor, sessionId, landed.length, left, finish, { failed, refused })
}

/** The item flips and audit events of lines whose stock write landed; the key is the stock request that carried them. */
async function landingStatements(actor: Actor, sessionId: string, sessionRevision: number, base: Record<string, unknown>, landed: Open[], stockKey: string): Promise<Statement[]> {
  const statements: Statement[] = []
  for (const entry of landed) {
    const { item } = entry, flip = item.state === 'issue', productId = item.product_id
    const params = { ...base, productId }
    if (flip) statements.push({ sql: `UPDATE inventory_check_items SET state='done',reason=NULL,revision=revision+1,updated_by=@actorId,updated_at=@now
      WHERE session_id=@id AND product_id=@productId AND branch_id=@branchId AND state='issue'`, params }, guard('changes()=1', 'inventory_check_conflict', {}))
    statements.push(eventStatement(actor, { sessionId, productId, action: 'observe', key: `${stockKey}-${productId}`,
      hash: await inventoryCheckDigest(JSON.stringify({ action: 'approval-line', id: sessionId, productId, key: stockKey })),
      before: { state: item.state, counted_quantity: item.counted_quantity, reason: item.reason, revision: item.revision },
      after: { state: 'done', counted_quantity: item.counted_quantity, reason: null, revision: flip ? item.revision + 1 : item.revision, approval: 'applied', stock_before: entry.plan.before, stock_after: entry.plan.target, ...clampOf(entry.plan) },
      result: { sessionRevision, itemRevision: flip ? item.revision + 1 : item.revision }, now: base.now as string }))
  }
  return statements
}

/** What a line records once its stock write landed. */
const appliedEntry = (plan: Plan, at: string): ApprovalAppliedLine => ({ before: plan.before, target: plan.target, after: plan.target, at, ...(settled(plan) ? { settled: true as const } : {}), ...clampOf(plan) })

/**
 * Another approver takes over a claim whose approver is gone. Nothing is written to stock here: the claimer's receipts say which lines landed (they are recorded from the plan they were
 * sent with), a write still running refuses the takeover for now, and everything else is planned afresh by the repeat, under the new approver's own request id.
 */
async function takeOver(db: D1Compat, actor: Actor, session: { branch_id: number; revision: number }, row: EngineRow, base: Record<string, unknown>,
  context: { why: string; remaining: ItemFacts[]; applied: Record<string, ApprovalAppliedLine>; stored: Record<string, Plan>; limits: ApprovalLimits }) {
  const sessionId = base.id as string, key = base.key as string, now = base.now as string, oldKey = row.applying_request_id as string
  const { landed, unseen } = await reconcile(db, row, context.remaining, context.stored)
  const nextApplied: Record<string, ApprovalAppliedLine> = { ...context.applied }
  for (const entry of landed) nextApplied[String(entry.item.product_id)] = appliedEntry(entry.plan, now)
  const params = { ...base, oldKey, oldBy: row.applying_by, oldPlan: row.plan_json, newApplied: JSON.stringify({ lines: nextApplied }), unseenIds: JSON.stringify(unseen) }
  const claimed = `session_id=@id AND status='pending' AND ${UNCHANGED} AND plan_json=@oldPlan AND applying_request_id=@oldKey AND applying_by=@oldBy`
  await record(db, actor, [
    guard(`EXISTS(SELECT 1 FROM inventory_check_approvals WHERE ${claimed}) AND ${NO_UNSEEN_WRITE_SQL}`, 'inventory_check_conflict', params),
    ...await landingStatements(actor, sessionId, session.revision, base, landed, oldKey),
    { sql: `UPDATE inventory_check_approvals SET applying_request_id=@key,applying_by=@actorId,applying_at=@now,takeovers=takeovers+1,plan_json='{}',applied_json=@newApplied WHERE ${claimed}`, params },
    guard('changes()=1', 'inventory_check_conflict', {}),
    { sql: 'UPDATE inventory_check_sessions SET updated_at=@now WHERE id=@id', params: base },
    eventStatement(actor, { sessionId, action: 'observe', key: `${key}-takeover`, hash: await inventoryCheckDigest(JSON.stringify({ action: 'approval-takeover', id: sessionId, key })),
      before: { approval: 'pending', claimed_by: row.applying_by, claim: oldKey, applied: Object.keys(context.applied).length },
      after: { approval: 'pending', claimed_by: actor.id, claim: key, takeovers: row.takeovers + 1, reason: context.why, landed: landed.map(entry => entry.item.product_id) },
      result: { sessionRevision: session.revision }, now }),
  ])
  return await respond(db, actor, sessionId, landed.length, context.remaining.length - landed.length, false, { takeover: true })
}

/**
 * Ends an approval for good without moving stock: the lines that landed (including any whose write landed but was never recorded) stay applied, every other line is recorded as not applied
 * with the reason it cannot be applied now. The approval is then approved when something was applied and rejected when nothing was; either way closed_json says it was a close.
 */
async function closeApproval(db: D1Compat, actor: Actor, session: { branch_id: number; revision: number }, row: EngineRow, base: Record<string, unknown>,
  context: { remaining: ItemFacts[]; applied: Record<string, ApprovalAppliedLine>; stored: Record<string, Plan>; count: { sessionId: string; submittedAt: string }; limits: ApprovalLimits; onDecided?: ApprovalDecided }) {
  const sessionId = base.id as string, key = base.key as string, now = base.now as string, note = base.note as string | null
  let landed: Open[] = [], unseen: string[] = []
  if (row.applying_request_id) {
    // Another approver closes under a claim only once its approver is gone, as for a takeover; the claimer himself may always close.
    if (row.applying_by !== actor.id && !await claimerGone(db, row, context.limits.takeoverSeconds)) fail(409, 'inventory_check_approval_in_progress')
    ;({ landed, unseen } = await reconcile(db, row, context.remaining, context.stored))
  }
  const landedIds = new Set(landed.map(entry => entry.item.product_id))
  const unapplied = context.remaining.filter(item => !landedIds.has(item.product_id))
  // The reason each line cannot be applied is what the planner would say now; a line it would still apply is recorded as simply not applied. Failing to read it never keeps the approval open.
  const reasons = new Map<number, string>()
  if (unapplied.length) {
    try { for (const refusal of (await planLines(db, session.branch_id, unapplied, approvalBaselines(row.baselines_json), context.count)).refused) reasons.set(refusal.productId, refusal.code) } catch { /* recorded without a reason */ }
  }
  const nextApplied: Record<string, ApprovalAppliedLine> = { ...context.applied }
  for (const entry of landed) nextApplied[String(entry.item.product_id)] = appliedEntry(entry.plan, now)
  const appliedCount = Object.keys(nextApplied).length, status = appliedCount > 0 ? 'approved' : 'rejected'
  // Nothing applied and no line left to close: every remaining line was replaced by a newer count. It ends as replaced, with no person as its decider, exactly as an approval that finishes so does.
  const replaced = appliedCount === 0 && unapplied.length === 0
  const params = { ...base, deciderId: replaced ? null : base.actorId, deciderName: replaced ? null : base.actorName, decisionNote: replaced ? REPLACED_NOTE : note, oldKey: row.applying_request_id, oldBy: row.applying_by, oldPlan: row.plan_json, newApplied: JSON.stringify({ lines: nextApplied }), unseenIds: JSON.stringify(unseen),
    closed: JSON.stringify({ lines: Object.fromEntries(unapplied.map(item => [String(item.product_id), reasons.get(item.product_id) ?? 'inventory_check_not_applied'])) }) }
  // plan_json=@oldPlan: a line that joined the plan after this read (the claimer planned it and may already have written it) is not covered by the unseen receipts above, so a changed plan refuses the close.
  const claimed = `session_id=@id AND status='pending' AND ${UNCHANGED} AND plan_json=@oldPlan AND applying_request_id IS @oldKey AND applying_by IS @oldBy`
  await record(db, actor, [
    guard(`EXISTS(SELECT 1 FROM inventory_check_approvals WHERE ${claimed}) AND ${NO_UNSEEN_WRITE_SQL}`, 'inventory_check_conflict', params),
    ...await landingStatements(actor, sessionId, session.revision, base, landed, row.applying_request_id as string),
    { sql: 'UPDATE inventory_check_sessions SET updated_at=@now WHERE id=@id', params: base },
    { sql: `UPDATE inventory_check_approvals SET status='${status}',decided_by=@deciderId,decided_by_name=@deciderName,decided_at=@now,decision_note=@decisionNote,decision_request_id=@key,
      applied_json=@newApplied,plan_json='{}',closed_json=@closed WHERE ${claimed}`, params },
    guard('changes()=1', 'inventory_check_conflict', {}),
    eventStatement(actor, { sessionId, action: 'observe', key, hash: await inventoryCheckDigest(JSON.stringify({ action: 'approval', id: sessionId, decision: 'close', note })),
      before: { approval: 'pending', lines: row.lines, applied: Object.keys(context.applied).length },
      after: { approval: status, closed: true, applied: appliedCount, not_applied: JSON.parse(params.closed).lines, ...(replaced ? { replaced: true } : {}) },
      result: { sessionRevision: session.revision }, now }),
  ])
  await announce(context.onDecided, replaced ? { decision: 'replaced', sessionId, note: REPLACED_NOTE } : { decision: 'close', sessionId, note, applied: appliedCount, notApplied: unapplied.length })
  return await respond(db, actor, sessionId, landed.length, 0, true)
}

/** A shortage the floor held back: the line says so (and what the count wanted), wherever it is recorded. */
const clampOf = (plan: Plan): { clamped?: true; wanted?: number } => plan.clamped ? { clamped: true, wanted: plan.wanted } : {}

/** An announcement never fails the decision it announces. */
async function announce(onDecided: ApprovalDecided | undefined, decided: Parameters<ApprovalDecided>[0]): Promise<void> {
  try { await onDecided?.(decided) } catch { /* announced best-effort */ }
}

/** The order reasons are reported in when several lines cannot be applied: the most fundamental first. */
const REFUSAL_ORDER = ['inventory_check_product_retired', 'inventory_check_stock_inconsistent', 'inventory_check_baseline_missing', 'inventory_check_count_below_damaged',
  'inventory_check_target_not_whole', 'inventory_check_count_superseded', 'inventory_check_stock_adjusted', 'inventory_check_no_lot']

/**
 * Read the live stock of the lines still to apply and plan each one. A line the approval cannot do safely is REFUSED ON ITS OWN, with its reason, and left out of the plans; the other
 * lines are planned normally, so one bad line never keeps the rest of a count from being applied.
 */
async function planLines(db: D1Compat, branchId: number, lines: ItemFacts[], baselines: Record<string, number>, count: { sessionId: string; submittedAt: string }): Promise<{ plans: Map<string, Plan>; refused: Refusal[] }> {
  const ids = lines.map(item => item.product_id)
  // What happened since the count rides in the stock read's own batch as ONE more statement: the stock request's budget on the Free plan is counted in statements.
  let facts: D1Result | undefined
  const rows = await readInventoryCheckStock({ batch: async statements => {
    const all = await db.batch([...statements, sinceCountStatement(branchId, ids, count)])
    facts = all[statements.length]
    return all.slice(0, statements.length)
  } }, { branchId, productIds: ids })
  const stock = new Map(rows.map(row => [row.product_id, row]))
  const since = (kind: string): number[] => (facts?.results ?? []).filter(value => (value as { kind: string }).kind === kind).map(value => Number((value as { product_id: number }).product_id))
  const retired = since('retired'), superseded = since('superseded'), adjusted = since('adjusted')
  const refused: Refusal[] = []
  const plans = new Map<string, Plan>()
  for (const item of lines) {
    const row = stock.get(item.product_id), id = String(item.product_id), refuse = (code: string) => { refused.push({ productId: item.product_id, code }) }
    if (retired.includes(item.product_id)) { refuse('inventory_check_product_retired'); continue }
    if (!row || !row.consistent || row.quantity == null || row.recorded_ordinary_quantity == null) { refuse('inventory_check_stock_inconsistent'); continue }
    const seen = baselines[id], counted = item.counted_quantity as number, damaged = row.recorded_damaged_quantity ?? 0
    if (seen === undefined) { refuse('inventory_check_baseline_missing'); continue }
    if (counted + EPSILON < damaged) { refuse('inventory_check_count_below_damaged'); continue }
    const wanted = approvalWanted(row.recorded_ordinary_quantity, counted, seen), target = Math.max(0, wanted)
    if (!whole(target)) { refuse('inventory_check_target_not_whole'); continue }
    if (superseded.includes(item.product_id)) { refuse('inventory_check_count_superseded'); continue }
    if (adjusted.includes(item.product_id)) { refuse('inventory_check_stock_adjusted'); continue }
    plans.set(id, { before: row.recorded_ordinary_quantity, target: Math.round(target), counted, damaged, ...(wanted < -EPSILON ? { clamped: true as const, wanted } : {}) })
  }
  const raising = [...plans.entries()].filter(([, plan]) => plan.target > plan.before)
  if (raising.length) {
    // A raise tops up the newest received date, one that already holds this branch's stock first.
    const lots = await db.prepare(`SELECT b.variant_product_id AS product_id,b.id FROM product_batches b WHERE b.is_active=1
      AND b.variant_product_id IN (SELECT value FROM json_each(@ids))
      ORDER BY EXISTS(SELECT 1 FROM branch_batch_stock s WHERE s.batch_id=b.id AND s.branch_id=@branchId) DESC,b.synthetic ASC,b.received_at DESC,b.id DESC`)
      .all<{ product_id: number; id: number }>({ ids: JSON.stringify(raising.map(([id]) => Number(id))), branchId })
    const newest = new Map<number, number>()
    for (const lot of lots) if (!newest.has(lot.product_id)) newest.set(lot.product_id, lot.id)
    for (const [id, plan] of raising) {
      const lot = newest.get(Number(id))
      if (lot === undefined) { refused.push({ productId: Number(id), code: 'inventory_check_no_lot' }); plans.delete(id) } else plan.lot = lot
    }
  }
  const rank = (code: string) => REFUSAL_ORDER.indexOf(code)
  return { plans, refused: refused.sort((a, b) => rank(a.code) - rank(b.code) || a.productId - b.productId) }
}

/**
 * What happened to these products since the count was submitted, in one statement.
 *  - superseded: another approval of this branch has applied the product since. The two counts are measured from the same stock, so applying both would apply one shortage
 *    twice; the later one is refused. A newer count normally replaces a waiting older line before it can be applied (queue-first), so this covers data from before that rule and races.
 *    Only an approval decided or last claimed after the count can have applied anything since it (an applied line is stamped no later than that), which the index bounds.
 *  - adjusted: a person set the stock by hand (a Set, an adjustment or a removal outside this approval). Such a correction may already contain the shortage the count found, and
 *    stacking the count on top of it would apply it twice, so the line is refused instead. Sales, goods received and adds keep the variance model.
 *    This approval's own writes are told by their reason and are not counted.
 */
const sinceCountStatement = (branchId: number, productIds: number[], count: { sessionId: string; submittedAt: string }): Statement => ({
  sql: `SELECT 'retired' AS kind,id AS product_id FROM products WHERE id IN (SELECT value FROM json_each(@ids)) AND +is_active=0
    UNION
    SELECT 'superseded',CAST(j.key AS INTEGER) FROM inventory_check_approvals a, json_each(a.applied_json,'$.lines') j
      WHERE a.branch_id=@branchId AND COALESCE(a.decided_at,a.applying_at)>@submittedAt AND a.session_id<>@sessionId AND CAST(j.key AS INTEGER) IN (SELECT value FROM json_each(@ids)) AND json_extract(j.value,'$.at')>@submittedAt
    UNION
    SELECT 'adjusted',product_id FROM inventory_movements WHERE branch_id=@branchId AND product_id IN (SELECT value FROM json_each(@ids))
      AND movement_type IN ('set','adjustment','remove') AND COALESCE(reason,'') NOT LIKE 'Inventory check approved:%'
      AND created_at>=date(@submittedFrom,'-1 day') AND julianday(created_at)>=julianday(@submittedFrom)
    ORDER BY 1,2`,
  // Movements are stamped to the second and the count to the millisecond: comparing from the start of the count's second never misses a correction made right after it (a false refusal is safe, a missed one applies a shortage twice).
  // created_at mixes ISO and space forms, so julianday() decides; the plain comparison with the day before is only the floor that lets the (product, created_at) index skip the product's whole history.
  params: { branchId, sessionId: count.sessionId, submittedAt: count.submittedAt, submittedFrom: count.submittedAt.slice(0, 19).replace('T', ' '), ids: JSON.stringify(productIds) } })

/**
 * The stock writers refused every line of this request. If none of them holds a receipt, nothing was written, so a claim made only for this request is
 * released (the approval can be rejected again, and the lines are planned afresh); otherwise it stays: stock may have moved.
 */
async function releaseUntouched(db: D1Compat, actor: Actor, claim: Record<string, unknown>, applied: Record<string, unknown>, requestIds: string[]): Promise<void> {
  if (Object.keys(applied).length || (await receiptsOf(db, actor.id, requestIds)).size) return
  try {
    // Re-proved inside the statement: still the plan this request left, and none of its lines has a written receipt (a request of the same claimer may have written one since the read above).
    await record(db, actor, [{ sql: `UPDATE inventory_check_approvals SET applying_request_id=NULL,applying_by=NULL,applying_at=NULL,plan_json='{}'
      WHERE session_id=@id AND status='pending' AND applied_json='{}' AND plan_json=@planNow AND applying_request_id=@stockKey AND applying_by=@actorId
        AND NOT EXISTS(SELECT 1 FROM stock_mutation_receipts WHERE actor_id=@actorId AND written=1 AND request_id IN (SELECT value FROM json_each(@releaseIds)))`, params: { ...claim, releaseIds: JSON.stringify(requestIds) } }])
  } catch { /* the claim stays; the next request plans again */ }
}

function stockLine(entry: Open, stockKey: string, branchId: number, sessionId: string): StockInCommitLine {
  const { item, plan } = entry, productId = item.product_id
  // approvalClaim: the stock commits only while this approval is still claimed under this key by the approver writing it (stockMutationReceipt.ts).
  const common = { productId, reason: `Inventory check approved: counted ${plan.counted}${plan.damaged > 0 ? `, ${plan.damaged} damaged` : ''}`, branchId, client_request_id: `${stockKey}-${productId}`, approvalClaim: { sessionId, key: stockKey } }
  // Lowering removes the difference (first-in first-out); raising tops up one received date through the lot-level Set writer, which needs no supplier or cost
  // and refuses if the branch's stock moved since it was planned.
  return { key: String(productId), wire: 'adjust', body: plan.target > plan.before
    ? { ...common, type: 'set', quantity: plan.target, setScope: 'branch', batchId: plan.lot, expectedBranchQuantity: plan.before }
    : { ...common, type: 'remove', quantity: plan.before - plan.target } }
}

/** An approval whose every line a newer count replaced: rejected by no person (the system decided), with the sentence that says why; a claimed row may only be rejected with closed_json set. */
const replacedUpdate = (params: Record<string, unknown>): Statement => ({
  sql: `UPDATE inventory_check_approvals SET status='rejected',decided_by=NULL,decided_by_name=NULL,decided_at=@now,decision_note=@replacedNote,decision_request_id=@key,applied_json=@newApplied,plan_json='{}',closed_json='{"lines":{}}'
    WHERE session_id=@id AND status='pending' AND ${UNCHANGED}`, params: { ...params, replacedNote: REPLACED_NOTE } })

const decidedUpdate = (status: 'approved' | 'rejected', params: Record<string, unknown>): Statement => ({
  sql: `UPDATE inventory_check_approvals SET status='${status}',decided_by=@actorId,decided_by_name=@actorName,decided_at=@now,decision_note=@note,decision_request_id=@key${status === 'approved' ? ",applied_json=@newApplied,plan_json='{}'" : ''}
    WHERE session_id=@id AND status='pending' AND ${UNCHANGED}${status === 'rejected' ? ' AND applying_request_id IS NULL' : ''}`, params })

async function record(db: D1Compat, actor: Actor, statements: Statement[]): Promise<void> {
  try { await db.batchOnce([authorityGuard(actor), ...statements]) }
  catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    if (text.includes('inventory_check_authority_changed')) return fail(403, 'inventory_check_authority_changed')
    if (text.includes('inventory_check_conflict')) return fail(409, 'inventory_check_conflict')
    return fail(503, 'inventory_check_outcome_unknown')
  }
}

async function respond(db: D1Compat, actor: Actor, sessionId: string, applied: number, remaining: number, done: boolean,
  extra: { failed?: Array<{ productId: number; code: string | null; error: string }>; refused?: Refusal[]; takeover?: true; deferred?: true } = {}) {
  const row = await db.prepare(`SELECT ${APPROVAL_DETAIL_COLUMNS} FROM inventory_check_approvals WHERE session_id=@id AND organization_id IS @organization`).get<ApprovalRow>({ id: sessionId, organization: actor.organization_id })
  if (!row) return fail(503, 'inventory_check_outcome_unknown')
  return { approval: projectApproval(actor, row, true), applied, remaining, done, ...(extra.failed?.length ? { failed: extra.failed } : {}), ...(extra.refused?.length ? { refused: extra.refused } : {}), ...(extra.takeover ? { takeover: true } : {}), ...(extra.deferred ? { deferred: true } : {}) }
}
