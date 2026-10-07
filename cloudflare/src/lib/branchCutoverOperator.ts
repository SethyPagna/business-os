import { getDb, type D1Compat } from './db'
import type { SessionUser } from './auth'
import { hasPermission } from './permissions'
import { BranchCutoverCapabilityError, type CutoverIdentity } from './branchCutoverCapture'
import type { ParentHooks } from './branchCutoverParent'
import { parseApprovedFolds } from './branchCutoverInactiveStock'
import type { Env } from '../index'
import { BRANCH_CUTOVER_FINAL_NAMES, beginBranchCutover, continueBranchCutover, inspectBranchCutover, isBranchCutoverRetryable } from './branchCutoverParent'
import { executePlannedBranchCutoverChild } from './branchCutoverChild'
import { abortEffectFreeBranchCutoverJournal, type BranchCutoverJournalRow, type BranchCutoverOwnership } from './branchCutoverJournal'
import type { TransferInvocationBudget } from './transferRunBudget'

/**
 * Production operator path for the Shop -> LC Store consolidation (lane CUTOVER-RUNNER).
 *
 * One request is one bounded durable step of the certified cutover library. The endpoint is disabled unless the
 * Worker has the secret BRANCH_CUTOVER_OPERATOR_TOKEN (32+ characters) and the caller presents the same value in the
 * X-Cutover-Operator-Token header. Nothing here reads a browser session: the acting user is named in the request
 * (begin, inspect) or taken from the journal row (every later step), and the library re-checks that user's
 * permissions, the journal ownership proof and the maintenance flag on every call.
 *
 * Responses carry only the operation id, phase, revision and counters, or a fixed refusal code. No row, name or
 * amount is ever returned except by `inspect`, whose result the ops runner writes to an encrypted report only.
 */
export const BRANCH_CUTOVER_OPERATOR_ACTIONS = ['inspect', 'begin', 'resume', 'status', 'abort', 'finalize'] as const
export type BranchCutoverOperatorAction = typeof BRANCH_CUTOVER_OPERATOR_ACTIONS[number]
export const BRANCH_CUTOVER_OPERATOR_TOKEN_HEADER = 'x-cutover-operator-token'
export const BRANCH_CUTOVER_DEFAULT_IDENTITY: CutoverIdentity = Object.freeze({ sourceBranchId: 2, targetBranchId: 1 })
const MIN_TOKEN_LENGTH = 32
const MAX_BODY_BYTES = 16384
const INCARNATION_FLAG = 'branch_cutover_control_incarnation'
const PARENT_BUDGET: TransferInvocationBudget = { tier: 'paid', alreadyUsed: 0, remainingReads: 0, retryQueries: 0, completionQueries: 0, safetyQueries: 0, extraAtomicStatements: 0 }
// The certified child needs the Paid subrequest allowance (E2): the cutover runs while production is on Paid.
const CHILD_BUDGET: TransferInvocationBudget = { ...PARENT_BUDGET, tier: 'paid' }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const requestIdPattern = /^[A-Za-z0-9_-]{8,120}$/
const digestPattern = /^[0-9a-f]{64}$/
const codePattern = /^[a-z][a-z0-9_]{2,63}$/

export function branchCutoverOperatorEnabled(configured: unknown): configured is string {
  return typeof configured === 'string' && configured.length >= MIN_TOKEN_LENGTH
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

/** Compares SHA-256 digests of both values with no early exit, so neither the length nor the first differing byte shows in the timing. */
export async function operatorTokenMatches(configured: unknown, presented: unknown): Promise<boolean> {
  const left = await sha256(typeof configured === 'string' ? configured : '')
  const right = await sha256(typeof presented === 'string' ? presented : '')
  let difference = 0
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index]
  return difference === 0 && branchCutoverOperatorEnabled(configured) && typeof presented === 'string'
}

export type OperatorOutcome = { status: number; body: Record<string, unknown> }
const reply = (status: number, body: Record<string, unknown>): OperatorOutcome => ({ status, body })
const refused = (code: string, detail?: string): OperatorOutcome => reply(409, { ok: false, code: 'refused', refusal: code, ...(detail ? { detail } : {}) })

function failure(error: unknown): OperatorOutcome {
  if (isBranchCutoverRetryable(error)) return reply(503, { ok: false, code: 'retryable' })
  if (error instanceof BranchCutoverCapabilityError) {
    const refusal = String(error.capability).split(':')[0]
    return refused(codePattern.test(refusal) ? refusal : 'capability_refused', String(error.capability).slice(0, 200))
  }
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return codePattern.test(message) ? refused(message) : reply(500, { ok: false, code: 'internal' })
}

type Next = 'continue' | 'child' | 'ready' | 'completed' | 'aborted'
function nextOf(row: BranchCutoverJournalRow): Next {
  if (row.phase === 'completed' || row.phase === 'aborted' || row.phase === 'ready') return row.phase
  return row.phase === 'moving' && row.planned_child_json !== null ? 'child' : 'continue'
}
function summary(row: BranchCutoverJournalRow, requestId: string | null, replayed: boolean): OperatorOutcome {
  return reply(200, { ok: true, requestId, operationId: row.operation_id, phase: row.phase, revision: row.revision,
    committedChildren: row.committed_children, nextSequence: row.next_sequence, next: nextOf(row), replayed })
}
const proofOf = (row: BranchCutoverJournalRow): BranchCutoverOwnership => ({ operationId: row.operation_id, actorId: row.actor_id,
  organizationId: row.organization_id, controlIncarnation: row.control_incarnation, token: row.maintenance_token })

const actorSql = `SELECT u.id,u.username,u.name,u.organization_id,u.role_id,u.permissions,u.is_active,r.code AS role_code,r.permissions AS role_permissions
  FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=@actor AND u.deleted_at IS NULL`
async function loadActor(db: D1Compat, id: unknown): Promise<SessionUser | null> {
  if (!Number.isSafeInteger(id) || (id as number) < 1) return null
  const actor = await db.prepare(actorSql).get<SessionUser>({ actor: id as number })
  return actor && actor.is_active === 1 && Number.isSafeInteger(actor.organization_id) && (actor.organization_id as number) > 0 && hasPermission(actor, 'backup_restore') ? actor : null
}
function identityOf(body: Record<string, unknown>): CutoverIdentity | null {
  const source = body.sourceBranchId ?? BRANCH_CUTOVER_DEFAULT_IDENTITY.sourceBranchId, target = body.targetBranchId ?? BRANCH_CUTOVER_DEFAULT_IDENTITY.targetBranchId
  return Number.isSafeInteger(source) && Number.isSafeInteger(target) && (source as number) > 0 && (target as number) > 0 && source !== target
    ? { sourceBranchId: source as number, targetBranchId: target as number } : null
}
async function journalOf(db: D1Compat, operationId: unknown): Promise<BranchCutoverJournalRow | null> {
  if (typeof operationId !== 'string' || !uuidPattern.test(operationId)) return null
  return (await db.prepare('SELECT * FROM branch_cutovers WHERE operation_id=@id').get<BranchCutoverJournalRow>({ id: operationId })) ?? null
}
/** The request id of a step is a pure function of the operation and the revision it was issued at, so a retry can never carry a new one. */
export const branchCutoverStepRequestId = (operationId: string, revision: number): string => `bcr_${operationId}_${revision}`

async function stepContext(db: D1Compat, body: Record<string, unknown>): Promise<{ row: BranchCutoverJournalRow; actor: SessionUser; requestId: string; expected: number } | OperatorOutcome> {
  const row = await journalOf(db, body.operationId)
  if (!row) return refused('unknown_operation')
  const expected = body.expectedRevision
  if (!Number.isSafeInteger(expected) || (expected as number) < 0) return refused('bad_revision')
  const requestId = body.requestId
  if (requestId !== branchCutoverStepRequestId(row.operation_id, expected as number)) return refused('bad_request_id')
  const actor = await loadActor(db, row.actor_id)
  if (!actor || String(actor.organization_id) !== row.organization_id) return refused('actor_not_permitted')
  return { row, actor, requestId, expected: expected as number }
}
const isOutcome = (value: unknown): value is OperatorOutcome => typeof (value as OperatorOutcome)?.status === 'number'

async function ensureIncarnation(db: D1Compat): Promise<string> {
  const read = async () => (await db.prepare('SELECT value FROM system_flags WHERE key=@key').get<{ value: string }>({ key: INCARNATION_FLAG }))?.value
  let value = await read()
  if (value === undefined) {
    await db.prepare('INSERT OR IGNORE INTO system_flags(key,value,updated_at) VALUES(@key,@value,CURRENT_TIMESTAMP)').run({ key: INCARNATION_FLAG, value: crypto.randomUUID() })
    value = await read()
  }
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new Error('branch_cutover_incarnation_invalid')
  return value
}

async function runInspect(db: D1Compat, body: Record<string, unknown>): Promise<OperatorOutcome> {
  const identity = identityOf(body), actor = await loadActor(db, body.actorUserId)
  if (!identity || !actor) return refused('actor_not_permitted')
  const inspect = await inspectBranchCutover(db, actor, actor.organization_id as number, identity, PARENT_BUDGET, parseApprovedFolds(body.approvedFolds))
  return reply(200, { ok: true, inspect })
}

/**
 * Why begin would be refused, in the operator's words. The library's own admission guard stays authoritative (it re-checks inside
 * the begin batch); this read only turns an indistinguishable "batch failed" into a named cause, so the runner stops at once.
 */
const ADMISSION_BLOCKERS = [
  ['import_job_active', "SELECT EXISTS(SELECT 1 FROM import_jobs WHERE status IN ('pending','queued','running','analyzing','approved','applying','cancelling') OR julianday(lease_expires_at)>julianday('now')) AS blocked"],
  ['bulk_delete_active', "SELECT EXISTS(SELECT 1 FROM bulk_delete_jobs WHERE status IN ('pending','processing')) AS blocked"],
  ['open_shift_exists', 'SELECT EXISTS(SELECT 1 FROM shift_sessions WHERE closed_at IS NULL AND cancelled_at IS NULL) AS blocked'],
  ['pending_actions_open', "SELECT EXISTS(SELECT 1 FROM pending_actions WHERE status='open') AS blocked"],
  ['active_branch_count', 'SELECT (SELECT count(*) FROM branches WHERE is_active=1)<>2 AS blocked'],
  ['maintenance_already_held', "SELECT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance') AS blocked"],
] as const
async function admissionBlockers(db: D1Compat): Promise<string[]> {
  const blockers: string[] = []
  for (const [code, sql] of ADMISSION_BLOCKERS) if ((await db.prepare(sql).get<{ blocked: number }>())?.blocked) blockers.push(code)
  return blockers
}

async function runBegin(db: D1Compat, body: Record<string, unknown>): Promise<OperatorOutcome> {
  const identity = identityOf(body), actor = await loadActor(db, body.actorUserId)
  if (!identity || !actor) return refused('actor_not_permitted')
  const { requestId, expectedSourceJson, expectedTargetJson, expectedSchemaDigest } = body
  if (typeof requestId !== 'string' || !requestIdPattern.test(requestId) || typeof expectedSourceJson !== 'string' || typeof expectedTargetJson !== 'string'
    || typeof expectedSchemaDigest !== 'string' || !digestPattern.test(expectedSchemaDigest)) return refused('bad_request')
  const existing = await db.prepare('SELECT operation_id FROM branch_cutovers WHERE begin_request_id=@requestId').get({ requestId })
  const blockers = existing ? [] : await admissionBlockers(db)
  if (blockers.length) return refused(blockers[0], blockers.join(','))
  const controlIncarnation = await ensureIncarnation(db)
  const begun = await beginBranchCutover(db, actor, actor.organization_id as number, { ...identity, ...BRANCH_CUTOVER_FINAL_NAMES, requestId, controlIncarnation, approvedFolds: parseApprovedFolds(body.approvedFolds),
    expectedSourceJson, expectedTargetJson, expectedSchemaDigest }, PARENT_BUDGET)
  return summary(begun.row, requestId, begun.replayed)
}

/**
 * The merge an inactive product holding stock goes through (owner ruling 7 Oct 2026): routes/products.ts foldDuplicateProductInto, the one
 * merge path (lots, branch rows, cost and allocations move; audit, movement and undo records), then the twin's cached stock_quantity is
 * recomputed from the ledgers like every merge caller does. Loaded on demand: only a run that has such a product ever pays for it.
 */
function inactiveProductHooks(env: { DB: D1Database }): ParentHooks {
  return { foldInactiveProduct: async (user, dup, keeper, approved) => {
    const { foldDuplicateProductInto } = await import('../routes/products')
    const db = getDb(env)
    const branches = await db.prepare('SELECT id, name FROM branches').all<{ id: number; name: string }>({})
    await foldDuplicateProductInto(env as unknown as Env, db, user, { id: keeper.id, name: keeper.name }, { id: dup.id, name: dup.name, image_path: dup.image_path },
      new Map(branches.map(branch => [branch.id, branch.name])), 'branch cutover: inactive product holding stock', 'merge', undefined, { operationId: crypto.randomUUID() },
      // An owner-approved pair is not an exact identity: the merge's own identity guard is told the pair was confirmed (Keep merge: the keeper's
      // name and barcode stay). The pair was validated server-side by approvedFoldProblem before it got here.
      approved ? { follows: true } : undefined)
    await db.prepare('UPDATE products SET stock_quantity=COALESCE((SELECT SUM(quantity) FROM branch_stock WHERE product_id=@id),0) WHERE id=@id').run({ id: keeper.id })
  } }
}

async function runStep(db: D1Compat, body: Record<string, unknown>, action: 'resume' | 'finalize', env: { DB: D1Database }): Promise<OperatorOutcome> {
  const context = await stepContext(db, body)
  if (isOutcome(context)) return context
  const { row, actor, requestId, expected } = context
  if (row.phase === 'aborted' || row.phase === 'completed' || row.revision > expected) return summary(row, requestId, true)
  if (row.revision < expected) return refused('revision_ahead')
  if (action === 'finalize' ? row.phase !== 'ready' : row.phase === 'ready') return refused(action === 'finalize' ? 'not_ready' : 'ready_use_finalize')
  const organizationId = actor.organization_id as number
  const done = row.phase === 'moving' && row.planned_child_json !== null
    ? (await executePlannedBranchCutoverChild(db, actor, proofOf(row), { sequence: row.next_sequence, childJson: row.planned_child_json }, CHILD_BUDGET, organizationId)).row
    : (await continueBranchCutover(db, actor, organizationId, { operationId: row.operation_id, expectedRevision: expected }, PARENT_BUDGET, inactiveProductHooks(env))).row
  return summary(done, requestId, false)
}

async function runAbort(db: D1Compat, body: Record<string, unknown>): Promise<OperatorOutcome> {
  const context = await stepContext(db, body)
  if (isOutcome(context)) return context
  const { row, requestId, expected } = context
  if (row.phase === 'aborted') return summary(row, requestId, true)
  if (row.revision !== expected) return refused('revision_mismatch')
  return summary(await abortEffectFreeBranchCutoverJournal(db, proofOf(row), expected, 'operator_abort'), requestId, false)
}

async function runStatus(db: D1Compat, body: Record<string, unknown>): Promise<OperatorOutcome> {
  if (body.operationId === undefined) {
    const row = await db.prepare(`SELECT * FROM branch_cutovers ORDER BY CASE WHEN phase IN ('completed','aborted') THEN 1 ELSE 0 END,created_at DESC,rowid DESC LIMIT 1`).get<BranchCutoverJournalRow>()
    return row ? summary(row, null, false) : reply(200, { ok: true, operationId: null, phase: 'none', revision: 0, next: 'none' })
  }
  const row = await journalOf(db, body.operationId)
  return row ? summary(row, null, false) : refused('unknown_operation')
}

/** Executes one operator action. Never throws: every failure is a fixed code (retryable ones are 503). */
/**
 * The consolidation moves every Shop row in many batches: on the free plan's per-invocation limits it cannot finish, so begin
 * and resume are refused there (inspect, status, abort and finalize stay available). Tier semantics are lib/planTier.ts's: only an
 * explicit 'free' is free; unset or anything else is paid.
 */
export const BRANCH_CUTOVER_PAID_ONLY_ACTIONS: ReadonlyArray<BranchCutoverOperatorAction> = ['begin', 'resume']
export const branchCutoverPlanIsFree = (env: { PLAN_TIER?: unknown }): boolean => String(env?.PLAN_TIER ?? '').trim().toLowerCase() === 'free'

export async function runBranchCutoverOperatorAction(env: { DB: D1Database; PLAN_TIER?: string }, action: BranchCutoverOperatorAction, body: Record<string, unknown>): Promise<OperatorOutcome> {
  if (BRANCH_CUTOVER_PAID_ONLY_ACTIONS.includes(action) && branchCutoverPlanIsFree(env)) return refused('plan_tier_free')
  try {
    const db = getDb(env)
    if (action === 'inspect') return await runInspect(db, body)
    if (action === 'begin') return await runBegin(db, body)
    if (action === 'status') return await runStatus(db, body)
    if (action === 'abort') return await runAbort(db, body)
    return await runStep(db, body, action, env)
  } catch (error) { return failure(error) }
}

export function parseOperatorBody(text: string): Record<string, unknown> | null {
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return null
  try {
    const value = JSON.parse(text === '' ? '{}' : text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch { return null }
}
