import type { D1Compat } from './db'
import { canApproveInventoryCounts } from './inventoryCheckAccess'
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
 * Counts approval (ic_fix_stock, lane 6.0.1045; per received date since INV S6). A submitted count that differs from stock waits here as ONE approval row; stock is untouched until
 * a person holding "approve counts" approves it. Approval applies what the count FOUND, never an absolute figure: the variance (counted minus the stock the counter saw, recorded at submit)
 * is added to the ordinary stock of the moment of approval, never below zero. A sale between the count and the approval therefore survives it (saw 5, a sale leaves 4, counted 3: stock
 * becomes 2, not 3). Damaged units are not part of the count's effect and are never touched.
 *
 * One line is one received date. A count typed per received date (ic_lot_counts, inventory_check_lot_lines) is applied date by date: each line is sent to the lot-level Set writer for ITS
 * received date with `variance: {counted, seen}`, and the writer computes max(0, live + counted - seen) itself from the quantity it reads inside its own pinned write (lib/stockLotAdjustment.ts;
 * it accepts a variance only under this approval's claim). Nothing here reads the stock ledger, verifies stock or picks a received date for a dated line: two dates A=5, B=4 counted A=5, B=2
 * leave B=2 and A untouched, and a sale of one from A in between survives (A=4). A branch-total line, and an older product-level count (it has no dates), goes to the newest received date
 * holding stock, by the same variance. A line whose figures agree (counted = seen) writes nothing.
 *
 * Exactly once. Stock is claimed BEFORE it is written: one guarded update names the request id and the approver that continue the approval, and stores
 * what every line is about to be sent with (plan_json: the received date, counted and seen). A repeat after a lost answer sends the identical request, which the stock writers replay
 * instead of applying twice (their receipts are per approver and request id, so only the claiming approver continues). A claimed approval can no longer
 * be rejected: stock may already have moved. A line the stock writer refused before writing anything is planned again from live stock on the next request.
 *
 * It can always be ended. A line that cannot be applied (retired product, adjusted by hand since the count, replaced by a newer count, no received date, ...) is refused ON ITS OWN: the others are
 * applied. An approver can CLOSE what is left: no stock moves, the lines applied stay applied and the rest are recorded as not applied, each with its reason. If the claiming
 * approver is deactivated, has lost the right, or has been idle for the plan's takeover window, any other approver takes the approval over: the claimer's receipts say which
 * lines landed (they are recorded, from the writer's own answer), the others are planned afresh and sent under the new approver's own request id, never the old one (receipts are per approver).
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
 * Reversal. Every line is one lot-level Set, which records its own Stock Changes movement (reason "Inventory check approved: counted N", the approver as actor) and its own undoable
 * action_history row (stock.quantity_set: the delta, replayed by the server without the client). The approval records each line's history id beside its before and after, so undoing
 * an approval is undoing each of its lines, in any order, each exactly once.
 *
 * One request applies at most the plan's lines per request (Free: 1) and answers { applied, remaining, done }; the client repeats the request until done. `applied` and `remaining` count
 * stock writes (a product counted on two received dates is two). A product is recorded in the approval row only when all its lines landed (a close records what landed of a part-applied one);
 * the lines that landed of a part-applied product are kept in applied_json.units meanwhile.
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
/** One stock write of an approval: a received-date line of a count (scope 'lot'), or a branch-total line (scope 'branch', batchId 0; an older product-level count is one). `many`: the product has several. */
type Unit = { key: string; productId: number; batchId: number; scope: 'lot' | 'branch'; counted: number; seen: number | null; many: boolean }
/** What one line is sent with, stored before the write so a repeat is identical: the received date it lands on and the two figures the writer computes its target from. */
type Plan = { lot: number; scope: 'lot' | 'branch'; counted: number; seen: number }
/** What a landed line did, read from the stock writer's own answer (before and after are the lot's, or the branch's for a branch-total line). */
type UnitEntry = { batchId: number; scope: 'lot' | 'branch'; before: number | null; after: number | null; branchBefore: number | null; branchAfter: number | null; counted: number; seen: number; at: string;
  clamped?: true; wanted?: number; operationId?: string; historyId?: number }
/** A product's line of the approval as it is recorded: before and after are the branch's, `lots` say which received dates moved. */
type AppliedLine = ApprovalAppliedLine & { lots?: UnitEntry[]; partial?: true }
type Open = { item: ItemFacts; unit: Unit; plan: Plan }
type Done = { item: ItemFacts; line: AppliedLine }
type Facts = { units: Map<number, Unit[]>; since?: Array<{ kind: string; product_id: number }>; newest: Map<number, number> }
type EngineRow = ApprovalRow & { plan_json: string }

/** The ordinary stock a count leaves: the stock of now, moved by what the count found against what the counter saw. This is the figure WANTED; it can be below zero. */
export const approvalWanted = (live: number, counted: number, seen: number): number => live + counted - seen
/** What is applied: the figure wanted, never below zero. A line records when the floor held it back (clamped, with the figure wanted), so a shortage the stock could not take is never silent. */
export const approvalTarget = (live: number, counted: number, seen: number): number => Math.max(0, approvalWanted(live, counted, seen))
const whole = (value: number): boolean => Math.abs(value - Math.round(value)) <= EPSILON
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const validPlan = (value: unknown): value is Plan => {
  const plan = value as Plan | null
  return !!plan && typeof plan === 'object' && finite(plan.lot) && (plan.scope === 'lot' || plan.scope === 'branch') && finite(plan.counted) && finite(plan.seen)
}
function plansOf(json: string): Record<string, Plan> {
  try {
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, plan]) => validPlan(plan))) as Record<string, Plan>
  } catch { return {} }
}
/** The part-applied lines of products that have several: unit key -> what landed. */
function appliedUnits(json: string): Record<string, UnitEntry> {
  try {
    const units = (JSON.parse(json) as { units?: unknown }).units
    return units && typeof units === 'object' && !Array.isArray(units) ? units as Record<string, UnitEntry> : {}
  } catch { return {} }
}
const appliedJson = (lines: Record<string, AppliedLine>, units: Record<string, UnitEntry>): string => JSON.stringify({ lines, ...(Object.keys(units).length ? { units } : {}) })
/** The stock request id of one line under a claim key: a product with a single line keeps `<key>-<product>`, one with several `<key>-<product>-<received date>`. */
const stockId = (stockKey: string, unitKey: string): string => `${stockKey}-${unitKey.replace(':', '-')}`
const productOf = (unitKey: string): number => Number.parseInt(unitKey, 10)

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
 * the answer the receipt holds. A receipt that wrote nothing says nothing: a request that has not written yet can no longer write once the claim moves (stockMutationReceipt.ts).
 * `unseen` are the receipt ids of the lines read as not landed: the batch that moves the claim proves none of them has landed since.
 */
async function reconcile(db: D1Compat, row: EngineRow, open: Array<{ item: ItemFacts; unit: Unit }>, stored: Record<string, Plan>, at: string): Promise<{ landed: Map<string, UnitEntry>; unseen: string[] }> {
  const claimKey = row.applying_request_id as string
  const planned = open.filter(entry => stored[entry.unit.key])
  const ids = planned.map(entry => stockId(claimKey, entry.unit.key))
  const rows = ids.length ? await db.prepare('SELECT request_id,response_json FROM stock_mutation_receipts WHERE actor_id=@actorId AND written=1 AND request_id IN (SELECT value FROM json_each(@ids))')
    .all<{ request_id: string; response_json: string | null }>({ actorId: row.applying_by, ids: JSON.stringify(ids) }) : []
  const written = new Map(rows.map(receipt => [receipt.request_id, receipt.response_json]))
  const landed = new Map<string, UnitEntry>()
  for (const entry of planned) {
    const id = stockId(claimKey, entry.unit.key)
    if (written.has(id)) landed.set(entry.unit.key, entryOf(answerOf(written.get(id)), stored[entry.unit.key], at))
  }
  return { landed, unseen: ids.filter(id => !written.has(id)) }
}
const answerOf = (json: string | null | undefined): Record<string, unknown> => { try { const value = JSON.parse(json ?? '{}') as unknown; return value && typeof value === 'object' ? value as Record<string, unknown> : {} } catch { return {} } }

/** What a landed line is recorded as, from the figures the stock writer answered with. */
function entryOf(answer: Record<string, unknown>, plan: Plan, at: string): UnitEntry {
  const snapshot = (value: unknown): { lotQuantity?: unknown; branchQuantity?: unknown } => value && typeof value === 'object' ? value as { lotQuantity?: unknown; branchQuantity?: unknown } : {}
  const before = snapshot(answer.before), after = snapshot(answer.after), variance = (answer.variance && typeof answer.variance === 'object' ? answer.variance : {}) as { wanted?: unknown; clamped?: unknown }
  const num = (value: unknown): number | null => finite(value) ? value : null
  return { batchId: plan.lot, scope: plan.scope, before: num(plan.scope === 'lot' ? before.lotQuantity : before.branchQuantity), after: num(plan.scope === 'lot' ? after.lotQuantity : after.branchQuantity),
    branchBefore: num(before.branchQuantity), branchAfter: num(after.branchQuantity), counted: plan.counted, seen: plan.seen, at,
    ...(variance.clamped === true && finite(variance.wanted) ? { clamped: true as const, wanted: variance.wanted } : {}),
    ...(typeof answer.operation_id === 'string' ? { operationId: answer.operation_id } : {}), ...(Number.isSafeInteger(answer.action_history_id) ? { historyId: Number(answer.action_history_id) } : {}) }
}

/** A product's line as the approval records it: the branch's before and after, and which received dates moved. A shortage the floor held back is told (clamped, with the figure wanted). */
function productLine(entries: UnitEntry[], at: string, partial: boolean): AppliedLine {
  const first = entries[0], last = entries[entries.length - 1]
  const after = last?.branchAfter ?? 0
  const shortage = entries.reduce((sum, entry) => sum + Math.min(0, entry.wanted ?? 0), 0)
  return { before: first?.branchBefore ?? 0, target: after, after, at, ...(shortage < -EPSILON ? { clamped: true as const, wanted: after + shortage } : {}), ...(entries.length ? { lots: entries } : {}), ...(partial ? { partial: true as const } : {}) }
}

/**
 * Records what landed: a product is complete when all its lines have (`partial`: any, for a close, which keeps what landed of a part-applied product). The lines that landed of a product still
 * incomplete stay in `held`; the lines of a complete one move into its product line.
 */
function fold(input: { remaining: ItemFacts[]; units: Map<number, Unit[]>; lines: Record<string, AppliedLine>; held: Record<string, UnitEntry>; landed: Map<string, UnitEntry>; at: string; partial: boolean }):
  { lines: Record<string, AppliedLine>; held: Record<string, UnitEntry>; completed: Done[] } {
  const lines = { ...input.lines }, held = { ...input.held }, completed: Done[] = []
  for (const [key, entry] of input.landed) held[key] = entry
  for (const item of input.remaining) {
    const units = input.units.get(item.product_id) ?? []
    const entries = units.map(unit => held[unit.key]).filter((entry): entry is UnitEntry => !!entry)
    const complete = entries.length === units.length
    if (!complete && !(input.partial && entries.length > 0)) continue
    const line = productLine(entries, input.at, !complete)
    lines[String(item.product_id)] = line; completed.push({ item, line })
    for (const unit of units) delete held[unit.key]
  }
  return { lines, held, completed }
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
  const applied = appliedLines(row.applied_json), held = appliedUnits(row.applied_json)
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
  const baselines = approvalBaselines(row.baselines_json)
  if (decision === 'close') return await closeApproval(db, actor, session, row, base, { remaining, applied, held, stored, count, baselines, limits, onDecided })

  if (getActionTier(actor, 'inventory', 'adjust') !== 'full') fail(403, 'inventory_check_adjust_required')
  // Only the approver who started applying continues it, and always under the request id that started it: the stock writers' receipts are per approver and request id.
  // Another approver takes it over only when that approver is gone; the takeover is a request of its own (it moves no stock) and the repeat continues under the new key.
  if (row.applying_request_id && row.applying_by !== actor.id) {
    const why = await claimerGone(db, row, limits.takeoverSeconds)
    if (!why) fail(409, 'inventory_check_approval_in_progress')
    return await takeOver(db, actor, session, row, base, { why: why as string, remaining, applied, held, stored, count, baselines })
  }
  const stockKey = row.applying_request_id ?? key
  const sent = await receiptsOf(db, actor.id, Object.keys(stored).map(unitKey => stockId(stockKey, unitKey)))
  // The received dates of every product still to apply, from the count's own lines; what must be planned afresh (a line with no stored plan, or one whose stored plan was never sent) rides
  // in the same batch when it is already known to be needed.
  const planned = (unit: Unit): boolean => !!stored[unit.key] && sent.has(stockId(stockKey, unit.key))
  const storedProducts = new Set(Object.keys(stored).map(productOf))
  let facts = await readFacts(db, session.branch_id, count, remaining, baselines, remaining.some(item => !storedProducts.has(item.product_id)) || Object.keys(stored).some(unitKey => !sent.has(stockId(stockKey, unitKey))))
  const freshProducts = remaining.filter(item => (facts.units.get(item.product_id) ?? []).some(unit => !held[unit.key] && !planned(unit)))
  if (freshProducts.length && !facts.since) facts = await readFacts(db, session.branch_id, count, remaining, baselines, true)
  const { plans, refused } = freshProducts.length ? planProducts(facts, freshProducts) : { plans: new Map<string, Plan>(), refused: [] as Refusal[] }
  const refusedIds = new Set(refused.map(refusal => refusal.productId))
  // A line that cannot be applied is refused on its own; the others go on. When nothing is left to apply, the request itself is refused with the first reason, naming every refused line.
  const openProducts = remaining.filter(item => !refusedIds.has(item.product_id))
  if (!openProducts.length && refused.length) fail(409, refused[0].code, { productIds: refused.filter(refusal => refusal.code === refused[0].code).map(refusal => refusal.productId), refused })
  const open: Open[] = openProducts.flatMap(item => (facts.units.get(item.product_id) ?? []).filter(unit => !held[unit.key])
    .map(unit => ({ item, unit, plan: planned(unit) ? stored[unit.key] : plans.get(unit.key) ?? stored[unit.key] })).filter((entry): entry is Open => !!entry.plan))
  const plansOfTodo = (entries: Open[]): string => JSON.stringify(Object.fromEntries(entries.map(entry => [entry.unit.key, entry.plan])))
  const claim = { ...base, stockKey, newPlan: plansOfTodo(open), oldPlan: row.plan_json }
  const claimMine = `(applying_request_id IS NULL OR (applying_request_id=@stockKey AND applying_by=@actorId))`
  let recorded = false
  if (open.length && (!row.applying_request_id || claim.newPlan !== row.plan_json)) {
    recorded = true
    await record(db, actor, [
      { sql: `UPDATE inventory_check_approvals SET applying_request_id=@stockKey,applying_by=@actorId,applying_at=@now,plan_json=@newPlan
        WHERE session_id=@id AND status='pending' AND ${UNCHANGED} AND plan_json=@oldPlan AND ${claimMine}`, params: claim },
      guard('changes()=1', 'inventory_check_conflict', {}),
    ])
  }

  const results = open.length ? await writeStock(open.map(entry => stockLine(entry, stockKey, session.branch_id, sessionId))) : []
  // The claim moved (a takeover or a close committed first): this request wrote nothing for the line, and whoever took the claim records what had landed from the receipts.
  if (results.some(result => result.ok !== true && result.code === APPROVAL_CLAIM_LOST)) fail(409, APPROVAL_CLAIM_LOST)
  const resultOf = new Map(results.map(result => [String(result.key), result]))
  const landed = new Map<string, UnitEntry>(), failed: Array<{ productId: number; code: string | null; error: string }> = []
  for (const entry of open) {
    const result = resultOf.get(entry.unit.key)
    if (result?.ok === true) landed.set(entry.unit.key, entryOf(result, entry.plan, now))
    else if (result && result.code !== 'deferred') failed.push({ productId: entry.unit.productId, code: typeof result.code === 'string' ? result.code : null, error: String(result.error ?? 'refused') })
  }
  const folded = fold({ remaining, units: facts.units, lines: applied, held, landed, at: now, partial: false })
  const left = remaining.length - folded.completed.length
  const finish = left === 0
  const unitsLeft = remaining.reduce((sum, item) => sum + (facts.units.get(item.product_id) ?? []).filter(unit => !landed.has(unit.key) && !held[unit.key]).length, 0)
  if (!landed.size && !finish) {
    // Planning a count is the dearest request of an approval, and the stock writer sends nothing once the request has used the invocation's statements (the commit answers those lines 'deferred', untouched).
    // When this request has just recorded the plan, that costs nothing: the claim and the plan stay and the repeat, which does not record again, writes. A repeat that defers again is a refusal.
    if (recorded && !failed.length && results.some(result => result.code === 'deferred')) return await respond(db, actor, sessionId, 0, unitsLeft, false, { refused, deferred: true })
    await releaseUntouched(db, actor, { ...claim, planNow: recorded ? claim.newPlan : row.plan_json }, applied, open.map(entry => stockId(stockKey, entry.unit.key)))
    fail(409, 'inventory_check_stock_write_refused', { failed, remaining: unitsLeft, ...(refused.length ? { refused } : {}) })
  }

  // Nothing applied and nothing left to apply: every line was replaced by a newer count after this approval was claimed. It ends as replaced, exactly as a close does in that case.
  const replacedOnly = finish && Object.keys(folded.lines).length === 0
  // The plan this request wrote or read: a request of the same claimer that recorded another plan in between is not overwritten (the repeat replays what landed).
  const next = { ...base, stockKey, planBefore: recorded ? claim.newPlan : row.plan_json, newApplied: appliedJson(folded.lines, folded.held), planAfter: plansOfTodo(open.filter(entry => !landed.has(entry.unit.key))) }
  const statements: Statement[] = [
    guard(`EXISTS(SELECT 1 FROM inventory_check_approvals WHERE session_id=@id AND status='pending' AND ${UNCHANGED} AND plan_json=@planBefore AND ${claimMine})`, 'inventory_check_conflict', next),
  ]
  statements.push(...await landingStatements(actor, sessionId, session.revision, base, folded.completed, stockKey))
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
  return await respond(db, actor, sessionId, landed.size, unitsLeft, finish, { failed, refused })
}

/** The item flips and audit events of products whose stock writes all landed; the key is the stock request that carried them. */
async function landingStatements(actor: Actor, sessionId: string, sessionRevision: number, base: Record<string, unknown>, completed: Done[], stockKey: string): Promise<Statement[]> {
  const statements: Statement[] = []
  for (const { item, line } of completed) {
    const flip = item.state === 'issue', productId = item.product_id
    const params = { ...base, productId }
    if (flip) statements.push({ sql: `UPDATE inventory_check_items SET state='done',reason=NULL,revision=revision+1,updated_by=@actorId,updated_at=@now
      WHERE session_id=@id AND product_id=@productId AND branch_id=@branchId AND state='issue'`, params }, guard('changes()=1', 'inventory_check_conflict', {}))
    statements.push(eventStatement(actor, { sessionId, productId, action: 'observe', key: `${stockKey}-${productId}`,
      hash: await inventoryCheckDigest(JSON.stringify({ action: 'approval-line', id: sessionId, productId, key: stockKey })),
      before: { state: item.state, counted_quantity: item.counted_quantity, reason: item.reason, revision: item.revision },
      after: { state: 'done', counted_quantity: item.counted_quantity, reason: null, revision: flip ? item.revision + 1 : item.revision, approval: 'applied', stock_before: line.before, stock_after: line.after, ...clampOf(line), ...(line.lots ? { lots: line.lots } : {}) },
      result: { sessionRevision, itemRevision: flip ? item.revision + 1 : item.revision }, now: base.now as string }))
  }
  return statements
}

/** Every line still to apply, in order: the received dates of the products not yet recorded, less the ones that already landed. */
const openUnits = (remaining: ItemFacts[], facts: Facts, held: Record<string, UnitEntry>): Array<{ item: ItemFacts; unit: Unit }> =>
  remaining.flatMap(item => (facts.units.get(item.product_id) ?? []).filter(unit => !held[unit.key]).map(unit => ({ item, unit })))

/**
 * Another approver takes over a claim whose approver is gone. Nothing is written to stock here: the claimer's receipts say which lines landed (they are recorded from the answer they hold), a write
 * still running refuses the takeover for now, and everything else is planned afresh by the repeat, under the new approver's own request id.
 */
async function takeOver(db: D1Compat, actor: Actor, session: { branch_id: number; revision: number }, row: EngineRow, base: Record<string, unknown>,
  context: { why: string; remaining: ItemFacts[]; applied: Record<string, AppliedLine>; held: Record<string, UnitEntry>; stored: Record<string, Plan>; count: { sessionId: string; submittedAt: string }; baselines: Record<string, number> }) {
  const sessionId = base.id as string, key = base.key as string, now = base.now as string, oldKey = row.applying_request_id as string
  const facts = await readFacts(db, session.branch_id, context.count, context.remaining, context.baselines, false)
  const { landed, unseen } = await reconcile(db, row, openUnits(context.remaining, facts, context.held), context.stored, now)
  const folded = fold({ remaining: context.remaining, units: facts.units, lines: context.applied, held: context.held, landed, at: now, partial: false })
  const params = { ...base, oldKey, oldBy: row.applying_by, oldPlan: row.plan_json, newApplied: appliedJson(folded.lines, folded.held), unseenIds: JSON.stringify(unseen) }
  const claimed = `session_id=@id AND status='pending' AND ${UNCHANGED} AND plan_json=@oldPlan AND applying_request_id=@oldKey AND applying_by=@oldBy`
  await record(db, actor, [
    guard(`EXISTS(SELECT 1 FROM inventory_check_approvals WHERE ${claimed}) AND ${NO_UNSEEN_WRITE_SQL}`, 'inventory_check_conflict', params),
    ...await landingStatements(actor, sessionId, session.revision, base, folded.completed, oldKey),
    { sql: `UPDATE inventory_check_approvals SET applying_request_id=@key,applying_by=@actorId,applying_at=@now,takeovers=takeovers+1,plan_json='{}',applied_json=@newApplied WHERE ${claimed}`, params },
    guard('changes()=1', 'inventory_check_conflict', {}),
    { sql: 'UPDATE inventory_check_sessions SET updated_at=@now WHERE id=@id', params: base },
    eventStatement(actor, { sessionId, action: 'observe', key: `${key}-takeover`, hash: await inventoryCheckDigest(JSON.stringify({ action: 'approval-takeover', id: sessionId, key })),
      before: { approval: 'pending', claimed_by: row.applying_by, claim: oldKey, applied: Object.keys(context.applied).length },
      after: { approval: 'pending', claimed_by: actor.id, claim: key, takeovers: row.takeovers + 1, reason: context.why, landed: folded.completed.map(done => done.item.product_id) },
      result: { sessionRevision: session.revision }, now }),
  ])
  const unitsLeft = openUnits(context.remaining, facts, context.held).filter(entry => !landed.has(entry.unit.key)).length
  return await respond(db, actor, sessionId, landed.size, unitsLeft, false, { takeover: true })
}

/**
 * Ends an approval for good without moving stock: the lines that landed (including any whose write landed but was never recorded) stay applied, every other line is recorded as not applied
 * with the reason it cannot be applied now. The approval is then approved when something was applied and rejected when nothing was; either way closed_json says it was a close.
 * A product part-applied (some of its received dates landed) is recorded with what landed, marked partial.
 */
async function closeApproval(db: D1Compat, actor: Actor, session: { branch_id: number; revision: number }, row: EngineRow, base: Record<string, unknown>,
  context: { remaining: ItemFacts[]; applied: Record<string, AppliedLine>; held: Record<string, UnitEntry>; stored: Record<string, Plan>; count: { sessionId: string; submittedAt: string }; baselines: Record<string, number>; limits: ApprovalLimits; onDecided?: ApprovalDecided }) {
  const sessionId = base.id as string, key = base.key as string, now = base.now as string, note = base.note as string | null
  // Another approver closes under a claim only once its approver is gone, as for a takeover; the claimer himself may always close.
  if (row.applying_request_id && row.applying_by !== actor.id && !await claimerGone(db, row, context.limits.takeoverSeconds)) fail(409, 'inventory_check_approval_in_progress')
  // The reason each line cannot be applied is what the planner would say now; a line it would still apply is recorded as simply not applied. Failing to read it never keeps the approval open.
  let facts: Facts
  try { facts = await readFacts(db, session.branch_id, context.count, context.remaining, context.baselines, true) } catch { facts = await readFacts(db, session.branch_id, context.count, context.remaining, context.baselines, false) }
  let landed = new Map<string, UnitEntry>(), unseen: string[] = []
  if (row.applying_request_id) ({ landed, unseen } = await reconcile(db, row, openUnits(context.remaining, facts, context.held), context.stored, now))
  const folded = fold({ remaining: context.remaining, units: facts.units, lines: context.applied, held: context.held, landed, at: now, partial: true })
  const doneIds = new Set(folded.completed.map(done => done.item.product_id))
  const unapplied = context.remaining.filter(item => !doneIds.has(item.product_id))
  const reasons = new Map<number, string>()
  if (unapplied.length && facts.since) {
    try { for (const refusal of planProducts(facts, unapplied).refused) reasons.set(refusal.productId, refusal.code) } catch { /* recorded without a reason */ }
  }
  const appliedCount = Object.keys(folded.lines).length, status = appliedCount > 0 ? 'approved' : 'rejected'
  // Nothing applied and no line left to close: every remaining line was replaced by a newer count. It ends as replaced, with no person as its decider, exactly as an approval that finishes so does.
  const replaced = appliedCount === 0 && unapplied.length === 0
  const params = { ...base, deciderId: replaced ? null : base.actorId, deciderName: replaced ? null : base.actorName, decisionNote: replaced ? REPLACED_NOTE : note, oldKey: row.applying_request_id, oldBy: row.applying_by, oldPlan: row.plan_json, newApplied: appliedJson(folded.lines, {}), unseenIds: JSON.stringify(unseen),
    closed: JSON.stringify({ lines: Object.fromEntries(unapplied.map(item => [String(item.product_id), reasons.get(item.product_id) ?? 'inventory_check_not_applied'])) }) }
  // plan_json=@oldPlan: a line that joined the plan after this read (the claimer planned it and may already have written it) is not covered by the unseen receipts above, so a changed plan refuses the close.
  const claimed = `session_id=@id AND status='pending' AND ${UNCHANGED} AND plan_json=@oldPlan AND applying_request_id IS @oldKey AND applying_by IS @oldBy`
  await record(db, actor, [
    guard(`EXISTS(SELECT 1 FROM inventory_check_approvals WHERE ${claimed}) AND ${NO_UNSEEN_WRITE_SQL}`, 'inventory_check_conflict', params),
    ...await landingStatements(actor, sessionId, session.revision, base, folded.completed, row.applying_request_id as string),
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
  return await respond(db, actor, sessionId, landed.size, 0, true)
}

/** A shortage the floor held back: the line says so (and what the count wanted), wherever it is recorded. */
const clampOf = (line: { clamped?: true; wanted?: number }): { clamped?: true; wanted?: number } => line.clamped ? { clamped: true, wanted: line.wanted } : {}

/** An announcement never fails the decision it announces. */
async function announce(onDecided: ApprovalDecided | undefined, decided: Parameters<ApprovalDecided>[0]): Promise<void> {
  try { await onDecided?.(decided) } catch { /* announced best-effort */ }
}

/** The order reasons are reported in when several lines cannot be applied: the most fundamental first. */
const REFUSAL_ORDER = ['inventory_check_product_retired', 'inventory_check_baseline_missing', 'inventory_check_target_not_whole', 'inventory_check_count_superseded', 'inventory_check_stock_adjusted', 'inventory_check_no_lot']

/**
 * The received dates of the products still to apply, from the count's own lines (one statement), and, when `plan` is asked for, what happened to those products since the count and the newest
 * received date holding stock for a branch-total line, in the same call. Never the stock ledger: the figures a line is applied from are the count's own seen and counted figures.
 */
async function readFacts(db: D1Compat, branchId: number, count: { sessionId: string; submittedAt: string }, products: ItemFacts[], baselines: Record<string, number>, plan: boolean): Promise<Facts> {
  const ids = products.map(item => item.product_id)
  // The lines table is asked for in the same call as everything else, with no probe of its own (a probe reads the whole schema on a cold isolate); a database without migration 0294 answers
  // "no such table" and the same read is made without it (every count there is an older, product-level one).
  const attempt = async (withDates: boolean): Promise<{ dated: boolean; results: D1Result[] }> => {
    const statements: Statement[] = []
    if (withDates && ids.length) statements.push({ sql: `SELECT product_id,batch_id,scope,seen_quantity,counted_quantity FROM inventory_check_lot_lines
      WHERE session_id=@sessionId AND product_id IN (SELECT value FROM json_each(@ids)) ORDER BY product_id,batch_id`, params: { sessionId: count.sessionId, ids: JSON.stringify(ids) } })
    if (plan && ids.length) statements.push(sinceCountStatement(branchId, ids, count), newestLotStatement(branchId, ids, count.sessionId, withDates))
    return { dated: withDates && ids.length > 0, results: statements.length ? await db.batch(statements) : [] }
  }
  let read: Awaited<ReturnType<typeof attempt>>
  try { read = await attempt(true) } catch (error) {
    if (!/no such table:?\s*inventory_check_lot_lines/i.test(error instanceof Error ? error.message : String(error))) throw error
    read = await attempt(false)
  }
  const { dated, results } = read
  const take = (): D1Result | undefined => results.shift()
  const lotRows = (dated ? take()?.results ?? [] : []) as Array<{ product_id: number; batch_id: number; scope: 'lot' | 'branch'; seen_quantity: number | null; counted_quantity: number }>
  const since = plan && ids.length ? (take()?.results ?? []) as Array<{ kind: string; product_id: number }> : plan ? [] : undefined
  const newest = new Map<number, number>()
  if (plan && ids.length) for (const lot of (take()?.results ?? []) as Array<{ product_id: number; id: number }>) newest.set(Number(lot.product_id), Number(lot.id))
  const dates = new Map<number, typeof lotRows>()
  for (const lot of lotRows) dates.set(Number(lot.product_id), [...dates.get(Number(lot.product_id)) ?? [], lot])
  const units = new Map<number, Unit[]>()
  for (const item of products) {
    const own = dates.get(item.product_id)
    // A count made without received dates (older, or ic_lot_counts OFF) is one branch-total line against the stock its counter saw.
    const lines = own?.length ? own.map(lot => ({ batchId: Number(lot.batch_id), scope: lot.scope, counted: Number(lot.counted_quantity), seen: lot.seen_quantity == null ? null : Number(lot.seen_quantity) }))
      : [{ batchId: 0, scope: 'branch' as const, counted: item.counted_quantity as number, seen: baselines[String(item.product_id)] ?? null }]
    const differing = lines.filter(line => line.seen === null || Math.abs(line.counted - line.seen) > EPSILON)
    const many = differing.length > 1
    units.set(item.product_id, differing.map(line => ({ ...line, productId: item.product_id, many, key: many ? `${item.product_id}:${line.batchId}` : String(item.product_id) })))
  }
  return { units, since, newest }
}

/**
 * Plan the lines of these products. A product the approval cannot do safely is REFUSED ON ITS OWN, with its reason, and left out of the plans; the other products are planned normally, so one bad line
 * never keeps the rest of a count from being applied. A line is planned from the count's own figures: the received date it lands on, what was counted and what was seen.
 */
function planProducts(facts: Facts, products: ItemFacts[]): { plans: Map<string, Plan>; refused: Refusal[] } {
  const since = (kind: string): number[] => (facts.since ?? []).filter(value => value.kind === kind).map(value => Number(value.product_id))
  const retired = since('retired'), superseded = since('superseded'), adjusted = since('adjusted')
  const refused: Refusal[] = []
  const plans = new Map<string, Plan>()
  for (const item of products) {
    const units = facts.units.get(item.product_id) ?? [], refuse = (code: string) => { refused.push({ productId: item.product_id, code }) }
    if (retired.includes(item.product_id)) { refuse('inventory_check_product_retired'); continue }
    if (units.some(unit => unit.seen === null)) { refuse('inventory_check_baseline_missing'); continue }
    if (units.some(unit => !whole(unit.counted) || !whole(unit.seen as number))) { refuse('inventory_check_target_not_whole'); continue }
    if (superseded.includes(item.product_id)) { refuse('inventory_check_count_superseded'); continue }
    if (adjusted.includes(item.product_id)) { refuse('inventory_check_stock_adjusted'); continue }
    const newest = facts.newest.get(item.product_id)
    if (units.some(unit => unit.scope === 'branch') && newest === undefined) { refuse('inventory_check_no_lot'); continue }
    for (const unit of units) plans.set(unit.key, { lot: unit.scope === 'lot' ? unit.batchId : newest as number, scope: unit.scope, counted: unit.counted, seen: unit.seen as number })
  }
  const rank = (code: string) => REFUSAL_ORDER.indexOf(code)
  return { plans, refused: refused.sort((a, b) => rank(a.code) - rank(b.code) || a.productId - b.productId) }
}

/**
 * The newest received date holding this branch's stock, one per product, for the lines that name no received date (a branch total, an older product-level count). A product counted by
 * received date never needs one, so it is left out. Only the first date of each product is returned.
 */
const newestLotStatement = (branchId: number, productIds: number[], sessionId: string, dated: boolean): Statement => ({
  sql: `SELECT product_id,id FROM (SELECT b.variant_product_id AS product_id,b.id,ROW_NUMBER() OVER (PARTITION BY b.variant_product_id ORDER BY
      EXISTS(SELECT 1 FROM branch_batch_stock s WHERE s.batch_id=b.id AND s.branch_id=@branchId AND s.quantity>0) DESC,
      EXISTS(SELECT 1 FROM branch_batch_stock s WHERE s.batch_id=b.id AND s.branch_id=@branchId) DESC,b.synthetic ASC,b.received_at DESC,b.id DESC) AS rn
    FROM product_batches b WHERE b.is_active=1 AND b.variant_product_id IN (SELECT value FROM json_each(@ids))${dated
      ? ' AND NOT EXISTS(SELECT 1 FROM inventory_check_lot_lines l WHERE l.session_id=@sessionId AND l.product_id=b.variant_product_id AND l.scope=\'lot\')' : ''}) WHERE rn=1`,
  params: { branchId, ids: JSON.stringify(productIds), ...(dated ? { sessionId } : {}) } })

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
    SELECT 'adjusted',product_id FROM inventory_movements INDEXED BY idx_inventory_movements_product_created_pg WHERE branch_id=@branchId AND product_id IN (SELECT value FROM json_each(@ids))
      AND movement_type IN ('set','adjustment','remove') AND COALESCE(reason,'') NOT LIKE 'Inventory check approved:%'
      AND created_at>=date(@submittedFrom,'-1 day') AND julianday(created_at)>=julianday(@submittedFrom)
    ORDER BY 1,2`,
  // Movements are stamped to the second and the count to the millisecond: comparing from the start of the count's second never misses a correction made right after it (a false refusal is safe, a missed one applies a shortage twice).
  // created_at mixes ISO and space forms, so julianday() decides; the plain comparison with the day before is only the floor that lets the (product, created_at) index skip the product's whole history. The index is NAMED: left to choose, the planner walked every movement of the branch since that day (+96 rows a day in the read-budget world, 4x the rows of the whole step).
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
  const { unit, plan } = entry
  // The lot-level Set writer, told what the count found (variance) and not what to write: it computes max(0, live + counted - seen) from the quantity it reads inside its own pinned write, for the
  // received date named here. approvalClaim: the stock commits only while this approval is still claimed under this key by the approver writing it (stockMutationReceipt.ts); the writer accepts a
  // variance under no other.
  return { key: unit.key, wire: 'adjust', body: { type: 'set', setScope: plan.scope, productId: unit.productId, branchId, batchId: plan.lot, variance: { counted: plan.counted, seen: plan.seen },
    reason: `Inventory check approved: counted ${plan.counted}`, client_request_id: stockId(stockKey, unit.key), approvalClaim: { sessionId, key: stockKey } } }
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
