import type { D1Compat } from './db'
import type { SessionUser } from './auth'
import { localDateExpr, localDateOf } from './businessDateWindow'
import { weightedMeanMoney4 } from './moneyPrecision'
import { getActionTier, hasPermission } from './permissions'
import { INACTIVE_STOCKED_ANYWHERE_SQL, applyInactiveStockPlan, parseApprovedFolds, type ApprovedFold, inactiveStockPlanIsEmpty, readInactiveStockPlan, type InactiveStockRow } from './branchCutoverInactiveStock'
import { assertTransferStatementsFit, type TransferInvocationBudget } from './transferRunBudget'
import { beginBranchCutoverJournal, checkpointBranchCutoverJournal, completeBranchCutoverJournal, finishBranchCutoverMoving,
  finishBranchCutoverSnapshots, markBranchCutoverReady, readBranchCutoverJournal, sealBranchCutoverChild, sealBranchCutoverManifest,
  type BranchCutoverJournalRow, type BranchCutoverOwnership } from './branchCutoverJournal'
import { BRANCH_SCALAR_REFERENCES, BranchCutoverCapabilityError, CAPTURE_PAGE_CAP, CAPTURE_STREAMS, addQuantity, captureRegistryDigest,
  captureSchemaGuard, cutoverAssert, cutoverBytes, cutoverDigest, decimal, decimalText, familyGuards, familyStateText, ledgerHashAdd,
  missingSnapshotGuards, parseCaptureCursor, readCutoverCapturePage, readCutoverCaptureSchema, readCutoverFamilies,
  type CaptureCursor, type CaptureSchema, type CutoverIdentity, type CutoverStatement, type FamilyState } from './branchCutoverCapture'
import { BRANCH_CUTOVER_SUMMARY_ENTITY, CLOSURE_AUDIT_COUNT_SQL, HISTORY_DECISION_COUNTS_SQL, HISTORY_OPEN_CLOSABLE_EXISTS,
  UNDO_CLOSED_BRANCH_CUTOVER_MOVE, UNDO_CLOSED_BRANCH_RETIRED, checkCutoverHistoryRow, historyClosureStatements, historyOpenPageSql } from './branchCutoverHistory'

type Principal = Pick<SessionUser, 'id' | 'organization_id' | 'is_active'>
type ParentIntent = CutoverIdentity & { action: 'retire'; parentVersion: 2; registryDigest: string; schemaDigest: string; retiredName: string; successorName: string
  /** Owner-approved inactive-product folds, sealed into the intent at begin so every later step (and a resume after a crash) reads the same list. Absent when empty. */
  approvedFolds?: ApprovedFold[] }
type State = { source: Record<string, unknown>; target: Record<string, unknown> }
type Step = { row: BranchCutoverJournalRow; replayed: boolean; next: BranchCutoverNext }
/** What the driver does next. execute_child = call executePlannedBranchCutoverChild with this exact sequence and JSON. */
export type BranchCutoverNext = { kind: 'continue' } | { kind: 'execute_child'; sequence: number; childJson: string } | { kind: 'completed' }
/** Owner decision 5 Oct 2026; sealed into the intent at begin, never read from the live directory afterwards. */
export const BRANCH_CUTOVER_FINAL_NAMES = Object.freeze({ retiredName: 'Old Shop', successorName: 'LC Store' })
export const BRANCH_CUTOVER_FOLD_AUDIT_ACTION = 'branch_cutover_lot_fold'
export const BRANCH_CUTOVER_COMPLETED_AUDIT_ACTION = 'branch_cutover_completed'
const FOLD_PAGE_CHILDREN = 16
const VERIFY_PAGE_ROWS = 256
const CLOSURE_PAGE_ROWS = 64
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const actorSql = `SELECT u.id,u.username,u.name,u.organization_id,u.role_id,u.permissions,u.is_active,r.code AS role_code,r.permissions AS role_permissions
  FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=@actor AND u.deleted_at IS NULL`
// Quantities are REAL. The certified child adds the source quantity to the target row in SQLite, so a pair such
// as 0.2 + 0.1 becomes 0.30000000000000004, which the exact-decimal ledger proofs refuse after the point of no
// return (verifier E3). 'inexact' refuses BEFORE anything moves (begin, and every boundary): any quantity at either
// branch, or any source + target sum of one product or one lot, that is not exactly a decimal of at most 12 places.
// Lots-versus-stock comparisons of REAL sums carry the same 1e-9 tolerance as the reconcile and the child, since
// sum(0.1, 0.2) > 0.3 in REAL arithmetic although the decimals are equal.
const inexactSql = (value: string) => `CAST(printf('%.12f',${value}) AS REAL)<>${value}`
// Owner rulings 7 Oct 2026: damaged-tagged units (damaged_stock_lots, held OUT of the sellable ledgers) are carried, not refused (finalize
// re-points the held lots). An inactive product holding stock is dealt with before the first capture page (lib/branchCutoverInactiveStock.ts:
// folded into its one active twin, cache drift recomputed, anything else refused with the product listed); it is never reactivated.
const unsupportedStockSql = `SELECT
  EXISTS(SELECT 1 FROM rfid_tags WHERE branch_id=@source AND status='active') AS rfid,
  EXISTS(SELECT 1 FROM branch_stock s LEFT JOIN products p ON p.id=s.product_id WHERE s.branch_id IN (@source,@target)
    AND (s.quantity IS NULL OR s.quantity<0 OR s.quantity<>0 AND p.id IS NULL)) AS stock,
  EXISTS(SELECT 1 FROM branch_batch_stock s LEFT JOIN product_batches b ON b.id=s.batch_id LEFT JOIN products p ON p.id=b.variant_product_id
    WHERE s.branch_id IN (@source,@target) AND (s.quantity IS NULL OR s.quantity<0 OR s.quantity<>0 AND (b.id IS NULL OR b.is_active IS NOT 1 OR p.id IS NULL))) AS lots,
  EXISTS(SELECT 1 FROM branch_batch_stock s JOIN product_batches b ON b.id=s.batch_id WHERE s.branch_id IN (@source,@target)
    GROUP BY s.branch_id,b.variant_product_id HAVING sum(s.quantity)>coalesce((SELECT quantity FROM branch_stock WHERE branch_id=s.branch_id AND product_id=b.variant_product_id),0)+1e-9) AS lotExcess,
  EXISTS(SELECT 1 FROM branch_stock WHERE branch_id IN (@source,@target) AND quantity IS NOT NULL AND ${inexactSql('quantity')})
    OR EXISTS(SELECT 1 FROM branch_batch_stock WHERE branch_id IN (@source,@target) AND quantity IS NOT NULL AND ${inexactSql('quantity')})
    OR EXISTS(SELECT 1 FROM branch_stock s JOIN branch_stock t ON t.product_id=s.product_id AND t.branch_id=@target
      WHERE s.branch_id=@source AND s.quantity>0 AND ${inexactSql('(s.quantity+t.quantity)')})
    OR EXISTS(SELECT 1 FROM branch_batch_stock s JOIN branch_batch_stock t ON t.batch_id=s.batch_id AND t.branch_id=@target
      WHERE s.branch_id=@source AND s.quantity>0 AND ${inexactSql('(s.quantity+t.quantity)')}) AS inexact`
async function stockCapabilities(db: D1Compat, identity: CutoverIdentity) {
  const counts = await db.prepare(unsupportedStockSql).get<Record<string, number>>({ source: identity.sourceBranchId, target: identity.targetBranchId })
  requireParent(counts)
  return Object.entries(counts).filter(([, count]) => count !== 0).map(([detail]) => ({ code: 'unsupported_stock_state', detail }))
}
// Unsupported stock states are checked at every stage boundary (begin, manifest
// seal, snapshot finish, moving finish, ready, finalize), not on every page:
// the fence blocks every writer in between, and the per-product proofs and the
// final ledger reconciliation catch any drift (design §5 plan B, Free reads).
function stockGuard(identity: CutoverIdentity, prepared = true): CutoverStatement {
  return cutoverAssert(`EXISTS(SELECT 1 FROM (${unsupportedStockSql}) WHERE rfid=0 AND stock=0 AND lots=0 AND lotExcess=0 AND inexact=0)${prepared ? ` AND NOT ${INACTIVE_STOCKED_ANYWHERE_SQL}` : ''}`,
    { source: identity.sourceBranchId, target: identity.targetBranchId })
}
const sourceEmptySql = `NOT EXISTS(SELECT 1 FROM branch_stock WHERE branch_id=@source AND quantity<>0)
  AND NOT EXISTS(SELECT 1 FROM branch_batch_stock WHERE branch_id=@source AND quantity<>0)`
export class BranchCutoverParentOutcomeUnknown extends Error {
  readonly code = 'branch_cutover_parent_outcome_unknown'
  readonly outcome = 'unknown'
  constructor(cause: unknown) { super('Reconcile this same branch cutover operation before continuing.', { cause }) }
}
/**
 * Whether the driver may simply call again with the same operation id and revision (the next invocation re-reads the
 * journal; a committed step is recognised by its revision, an uncommitted one is redone). True for an unconfirmed
 * batch (parent or child outcome unknown) and for D1 refusals that write nothing: a CPU-limit reset (code 7429, the
 * whole batch rolls back), an overloaded or queued-too-long database, and transport failures. A capability refusal,
 * a conflict or a SQL error is not retryable: the same call would fail the same way.
 */
const RETRYABLE_D1_ERROR = /exceeded its CPU time limit|\[code: 7429\]|D1 DB is overloaded|Requests queued for too long|network connection lost|fetch failed|ECONNRESET|timed out|internal error/i
export function isBranchCutoverRetryable(error: unknown): boolean {
  if (error instanceof BranchCutoverParentOutcomeUnknown || (error as { code?: unknown } | null)?.code === 'branch_cutover_child_outcome_unknown') return true
  for (let current: unknown = error, depth = 0; current && depth < 4; current = (current as { cause?: unknown }).cause, depth++) {
    if (RETRYABLE_D1_ERROR.test(String((current as { message?: unknown }).message ?? current))) return true
  }
  return false
}
/** An error this code raised before or instead of a D1 round trip (a coded refusal or a failed parent check): the outcome is known, it is not retryable. */
const isLocalRefusal = (cause: unknown): boolean => cause instanceof BranchCutoverCapabilityError || (cause instanceof Error && cause.message === 'branch_cutover_parent_conflict')
function requireParent(condition: unknown): asserts condition { if (!condition) throw new Error('branch_cutover_parent_conflict') }
function refuse(capability: string): never { throw new BranchCutoverCapabilityError(capability) }
function checkStatement(sql: string, params?: Record<string, unknown> | unknown[]): void {
  requireParent(cutoverBytes(sql) <= 100000 && Object.keys(params || {}).length <= 100
    && cutoverBytes(sql) + cutoverBytes(JSON.stringify(params || {})) <= 1048576)
}
/** One batch per invocation, every read charged with its retry reserve, both D1 tiers (Free = 50 queries). */
function metered(db: D1Compat, budget: TransferInvocationBudget): D1Compat {
  requireParent(budget.extraAtomicStatements === 0)
  let attempts = 0; let batches = 0
  // A budget overrun is deterministic and local (nothing was sent): a coded refusal, never an unknown outcome to retry.
  const fit = (extraReads: number, statements: number) => {
    try { assertTransferStatementsFit({ ...budget, remainingReads: budget.remainingReads + extraReads }, statements) }
    catch { throw new BranchCutoverCapabilityError('parent_invocation_budget_exceeded') }
  }
  const chargeRead = () => { fit(attempts, 2); attempts += 2 }
  return new Proxy(db, { get(target, key, receiver) {
    if (key === 'prepare') return (sql: string) => {
      checkStatement(sql)
      const prepared = target.prepare(sql)
      return { get: async (params?: Record<string, unknown> | unknown[]) => { checkStatement(sql, params); chargeRead(); return prepared.get(params) },
        all: async (params?: Record<string, unknown> | unknown[]) => { checkStatement(sql, params); chargeRead(); return prepared.all(params) } }
    }
    if (key === 'batchOnce') return async (statements: CutoverStatement[]) => {
      requireParent(batches++ === 0)
      fit(attempts + 12, statements.length)
      statements.forEach(s => checkStatement(s.sql, s.params))
      requireParent(statements.reduce((n, s) => n + cutoverBytes(s.sql) + cutoverBytes(JSON.stringify(s.params || {})), 0) <= 1048576)
      return target.batchOnce(statements)
    }
    return Reflect.get(target, key, receiver)
  } })
}
async function principal(db: D1Compat, actor: Principal, organizationId: number): Promise<SessionUser> {
  requireParent(Number.isSafeInteger(organizationId) && organizationId > 0 && Number.isSafeInteger(actor.id) && actor.id > 0
    && actor.organization_id === organizationId && actor.is_active === 1)
  const current = await db.prepare(actorSql).get<SessionUser>({ actor: actor.id })
  requireParent(current && current.is_active === 1 && current.organization_id === organizationId && hasPermission(current, 'backup_restore')
    && getActionTier(current, 'branches', 'edit') === 'full' && getActionTier(current, 'branches', 'transfer') === 'full')
  return current
}
/** Admission by stable identity only: the source is canonical 'shop', the target canonical 'warehouse', both active. Names are labels. */
async function branches(db: D1Compat, identity: CutoverIdentity): Promise<State> {
  requireParent(Number.isSafeInteger(identity.sourceBranchId) && Number.isSafeInteger(identity.targetBranchId) && identity.sourceBranchId > 0
    && identity.targetBranchId > 0 && identity.sourceBranchId !== identity.targetBranchId)
  const rows = await db.prepare('SELECT * FROM branches WHERE id IN (@source,@target) ORDER BY id').all<Record<string, unknown>>({ source: identity.sourceBranchId, target: identity.targetBranchId })
  const source = rows.find(row => row.id === identity.sourceBranchId), target = rows.find(row => row.id === identity.targetBranchId)
  requireParent(source && target && source.is_active === 1 && target.is_active === 1
    && source.canonical_key === 'shop' && target.canonical_key === 'warehouse' && source.role === 'shop' && target.role === 'warehouse'
    && source.successor_branch_id === null && target.successor_branch_id === null
    && typeof source.name === 'string' && source.name.trim() !== '' && typeof target.name === 'string' && target.name.trim() !== '')
  requireParent(cutoverBytes(JSON.stringify(source)) <= 16384 && cutoverBytes(JSON.stringify(target)) <= 16384)
  return { source, target }
}
function proof(row: BranchCutoverJournalRow): BranchCutoverOwnership { return { operationId: row.operation_id, actorId: row.actor_id,
  organizationId: row.organization_id, controlIncarnation: row.control_incarnation, token: row.maintenance_token } }
function actorGuard(current: SessionUser): CutoverStatement {
  return cutoverAssert(`EXISTS(SELECT 1 FROM (${actorSql}) WHERE is_active=1 AND organization_id=@organization
    AND role_id IS @role AND permissions IS @permissions AND role_code IS @roleCode AND role_permissions IS @rolePermissions)`,
  { actor: current.id, organization: current.organization_id, role: current.role_id, permissions: current.permissions,
    roleCode: current.role_code ?? null, rolePermissions: current.role_permissions ?? null })
}
function branchGuards(state: State): CutoverStatement[] {
  return [state.source, state.target].map(branch => {
    const params: Record<string, unknown> = {}
    const conditions = Object.entries(branch).map(([key, value], index) => { params['v' + index] = value; return `"${key.replaceAll('"', '""')}" IS @v${index}` })
    return cutoverAssert(`EXISTS(SELECT 1 FROM branches WHERE ${conditions.join(' AND ')})`, params)
  })
}
function guardsFor(current: SessionUser, schema: CaptureSchema | null, state: State): CutoverStatement[] {
  return [...(schema ? [captureSchemaGuard(schema)] : []), actorGuard(current), ...branchGuards(state)]
}
function compose(db: D1Compat, before: CutoverStatement[], after: CutoverStatement[]): D1Compat {
  return new Proxy(db, { get(target, key, receiver) {
    if (key === 'batchOnce') return async (statements: CutoverStatement[]) => {
      const results = await target.batchOnce([...before, ...statements, ...after])
      return results.slice(before.length, before.length + statements.length)
    }
    return Reflect.get(target, key, receiver)
  } })
}
function requireSchema(schema: CaptureSchema): void {
  if (schema.capabilities.length) throw new BranchCutoverCapabilityError(schema.capabilities.map(v => v.code + ':' + v.detail).join(';'))
}
function validName(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && value.length >= 1 && value.length <= 64 && !/[\u0000-\u001f\u007f]/.test(value)
}
const familiesFromText = (text: string): FamilyState => {
  const [undo, session, pending, history] = JSON.parse(text) as [string, string, string, number]
  return { undo_snapshots: undo, stock_session_operations: session, pending_actions: pending, pending_open: 0, action_history_max: history }
}
const familiesFromManifest = (families: Record<string, unknown>): FamilyState => ({ undo_snapshots: String(families.undo_snapshots),
  stock_session_operations: String(families.stock_session_operations), pending_actions: String(families.pending_actions), pending_open: 0,
  action_history_max: Number(families.actionHistoryMax) })
/** Family counts and marks are frozen from capture to finalize except action_history, which grows by exactly the cutover children. */
function familyGuardsWithoutHistory(state: FamilyState): CutoverStatement[] {
  return [cutoverAssert(`(SELECT count(*)||':'||coalesce(max(rowid),0) FROM undo_snapshots)=@undo
      AND (SELECT count(*)||':'||coalesce(max(rowid),0) FROM stock_session_operations)=@session
      AND (SELECT count(*)||':'||coalesce(max(rowid),0) FROM pending_actions)=@pending
      AND NOT EXISTS(SELECT 1 FROM pending_actions WHERE status='open')`,
  { undo: state.undo_snapshots, session: state.stock_session_operations, pending: state.pending_actions })]
}
async function readIntent(db: D1Compat, current: SessionUser, organizationId: number, operationId: string) {
  requireParent(uuidPattern.test(operationId))
  const stored = await db.prepare('SELECT * FROM branch_cutovers WHERE operation_id=@id').get<BranchCutoverJournalRow>({ id: operationId })
  requireParent(stored && stored.actor_id === current.id && stored.organization_id === String(organizationId))
  const row = await readBranchCutoverJournal(db, proof(stored)); const intent = JSON.parse(row.intent_json) as ParentIntent
  if (intent.parentVersion !== 2 || intent.action !== 'retire' || intent.sourceBranchId !== row.source_branch_id || intent.targetBranchId !== row.target_branch_id
    || Object.keys(intent).sort().join(',') !== (intent.approvedFolds === undefined ? 'action,parentVersion,registryDigest,retiredName,schemaDigest,sourceBranchId,successorName,targetBranchId'
      : 'action,approvedFolds,parentVersion,registryDigest,retiredName,schemaDigest,sourceBranchId,successorName,targetBranchId')
    || !validName(intent.retiredName) || !validName(intent.successorName)) throw new BranchCutoverCapabilityError('parent_capture_contract_required')
  requireSameContract('registry', intent.registryDigest, await captureRegistryDigest())
  return { row, intent }
}
/**
 * Code freeze (verifier E7). The capture registry digest (every captured table, predicate, history rule and page
 * cap) and the schema digest are sealed into the intent at begin. A run never resumes under a different contract:
 * it refuses with this explicit capability instead of a generic conflict. Nothing is written by the refusal, the
 * maintenance fence stays held, and the same operation resumes as soon as the deployed build (or the schema) is
 * back to the digests recorded at begin. Operator procedure: docs in the LB report, section E7.
 */
export const BRANCH_CUTOVER_CONTRACT_CHANGED = 'contract_changed_since_begin'
function requireSameContract(kind: 'registry' | 'schema', begun: string, deployed: string): void {
  if (begun === deployed) return
  throw new BranchCutoverCapabilityError(`${BRANCH_CUTOVER_CONTRACT_CHANGED}:${kind}:${String(begun).slice(0, 16)}:${String(deployed).slice(0, 16)}`,
    kind === 'registry'
      ? `The deployed cutover code is not the code this run began with (capture registry ${begun} at begin, ${deployed} now). Nothing was changed. Redeploy the build recorded at begin, or a build whose registry digest is identical, then continue this same operation.`
      : `The database schema changed after this run began (schema ${begun} at begin, ${deployed} now). Nothing was changed. Undo the schema change (or redeploy the build recorded at begin) so the schema digest matches again, then continue this same operation.`)
}
async function commit(db: D1Compat, row: BranchCutoverJournalRow, before: CutoverStatement[], perform: (composed: D1Compat) => Promise<BranchCutoverJournalRow>,
  accept: (saved: BranchCutoverJournalRow) => boolean, next: (saved: BranchCutoverJournalRow) => BranchCutoverNext): Promise<Step> {
  const final = cutoverAssert(`EXISTS(SELECT 1 FROM branch_cutovers WHERE operation_id=@operation AND revision=@revision+1)`, { operation: row.operation_id, revision: row.revision })
  try { const saved = await perform(compose(db, before, [final])); return { row: saved, replayed: false, next: next(saved) } }
  catch (cause) {
    if (isLocalRefusal(cause)) throw cause
    try {
      const saved = await readBranchCutoverJournal(db, proof(row))
      requireParent(saved.revision === row.revision + 1 && accept(saved))
      return { row: saved, replayed: true, next: next(saved) }
    } catch { }
    throw new BranchCutoverParentOutcomeUnknown(cause)
  }
}
const continueNext = (): BranchCutoverNext => ({ kind: 'continue' })
function nextFor(row: BranchCutoverJournalRow): BranchCutoverNext {
  if (row.phase === 'completed') return { kind: 'completed' }
  if (row.phase === 'moving' && row.planned_child_json !== null) return { kind: 'execute_child', sequence: row.next_sequence, childJson: row.planned_child_json }
  return { kind: 'continue' }
}

export async function inspectBranchCutover(db: D1Compat, actor: Principal, organizationId: number, identity: CutoverIdentity, budget: TransferInvocationBudget, approvedFolds: ApprovedFold[] = []) {
  db = metered(db, budget); await principal(db, actor, organizationId)
  const state = await branches(db, identity); const schema = await readCutoverCaptureSchema(db)
  const capabilities = [...schema.capabilities]
  let families: FamilyState | null = null
  let history: Array<{ applier: string; decision: string; n: number }> = []
  if (!schema.capabilities.some(v => v.code === 'capture_table_required')) {
    families = await readCutoverFamilies(db)
    if (families.pending_open) capabilities.push({ code: 'pending_actions_open', detail: String(families.pending_open) })
    history = await db.prepare(HISTORY_DECISION_COUNTS_SQL).all<{ applier: string; decision: string; n: number }>({ source: identity.sourceBranchId, target: identity.targetBranchId })
    for (const entry of history) if (entry.decision === 'unclassified') capabilities.push({ code: 'history_applier_unclassified', detail: String(entry.applier).slice(0, 80) })
  }
  const stock = await db.prepare(`SELECT (SELECT count(*) FROM branch_stock WHERE branch_id=@source AND quantity<>0) AS nonzeroProducts,
    (SELECT count(*) FROM branch_batch_stock WHERE branch_id=@source AND quantity<>0) AS nonzeroLots,
    (SELECT count(*) FROM damaged_stock_lots WHERE branch_id=@source AND quantity_remaining<>0) AS damaged,
    (SELECT count(*) FROM rfid_tags WHERE branch_id=@source AND status='active') AS rfid`).get<Record<string, number>>({ source: identity.sourceBranchId })
  capabilities.push(...await stockCapabilities(db, identity))
  const inactiveStock = await readInactiveStockPlan(db, approvedFolds)
  for (const item of inactiveStock.refuse) capabilities.push({ code: 'inactive_stock_without_twin', detail: item.id + ':' + item.reason })
  return { sourcePreimageJson: JSON.stringify(state.source), targetPreimageJson: JSON.stringify(state.target), schemaDigest: schema.digest,
    registryDigest: await captureRegistryDigest(), scalarReferences: BRANCH_SCALAR_REFERENCES, capabilities, families, history, stock, inactiveStock,
    coverage: 'registry-v3-capture', historicalReplayCertified: true, activationReady: capabilities.length === 0 }
}

export async function beginBranchCutover(db: D1Compat, actor: Principal, organizationId: number,
  input: CutoverIdentity & { requestId: string; controlIncarnation: string; expectedSourceJson: string; expectedTargetJson: string; expectedSchemaDigest: string;
    retiredName: string; successorName: string; approvedFolds?: ApprovedFold[] }, budget: TransferInvocationBudget) {
  requireParent(/^[A-Za-z0-9_-]{8,120}$/.test(input.requestId) && uuidPattern.test(input.controlIncarnation)
    && /^[0-9a-f]{64}$/.test(input.expectedSchemaDigest) && typeof input.expectedSourceJson === 'string' && typeof input.expectedTargetJson === 'string'
    && cutoverBytes(input.expectedSourceJson) <= 16384 && cutoverBytes(input.expectedTargetJson) <= 16384
    && validName(input.retiredName) && validName(input.successorName) && input.retiredName.toLowerCase() !== input.successorName.toLowerCase())
  db = metered(db, budget); const current = await principal(db, actor, organizationId); const state = await branches(db, input)
  const schema = await readCutoverCaptureSchema(db); requireSchema(schema)
  const unsupported = await stockCapabilities(db, input)
  const approvedFolds = parseApprovedFolds(input.approvedFolds ?? [])
  const inactivePlan = await readInactiveStockPlan(db, approvedFolds)
  const unresolved = inactivePlan.refuse.map(item => ({ code: 'inactive_stock_without_twin', detail: item.id + ':' + item.reason }))
  if (unsupported.length || unresolved.length) throw new BranchCutoverCapabilityError([...unsupported, ...unresolved].map(v => v.code + ':' + v.detail).join(';'))
  requireParent(schema.digest === input.expectedSchemaDigest && JSON.stringify(state.source) === input.expectedSourceJson && JSON.stringify(state.target) === input.expectedTargetJson)
  const intent: ParentIntent = { action: 'retire', parentVersion: 2, sourceBranchId: input.sourceBranchId, targetBranchId: input.targetBranchId,
    registryDigest: await captureRegistryDigest(), schemaDigest: schema.digest, retiredName: input.retiredName, successorName: input.successorName,
    ...(approvedFolds.length ? { approvedFolds } : {}) }
  const intentJson = JSON.stringify(intent)
  const existing = await db.prepare('SELECT * FROM branch_cutovers WHERE begin_request_id=@request').get<BranchCutoverJournalRow>({ request: input.requestId })
  if (existing) {
    requireParent(existing.actor_id === current.id && existing.organization_id === String(organizationId) && existing.control_incarnation === input.controlIncarnation
      && existing.intent_json === intentJson && existing.source_preimage_json === input.expectedSourceJson && existing.target_preimage_json === input.expectedTargetJson)
    return { row: await readBranchCutoverJournal(db, proof(existing)), replayed: true }
  }
  const operationId = crypto.randomUUID(), token = crypto.randomUUID()
  const begin = { operationId, token, actorId: current.id, organizationId: String(organizationId), controlIncarnation: input.controlIncarnation,
    beginRequestId: input.requestId, sourceBranchId: input.sourceBranchId, targetBranchId: input.targetBranchId, intentJson,
    sourcePreimageJson: input.expectedSourceJson, targetPreimageJson: input.expectedTargetJson }
  // Exactly the two identified branches are active: after finalize exactly one active branch remains.
  const admission = cutoverAssert(`NOT EXISTS(SELECT 1 FROM import_jobs WHERE status IN ('pending','queued','running','analyzing','approved','applying','cancelling') OR julianday(lease_expires_at)>julianday('now'))
    AND NOT EXISTS(SELECT 1 FROM bulk_delete_jobs WHERE status IN ('pending','processing'))
    AND NOT EXISTS(SELECT 1 FROM shift_sessions WHERE closed_at IS NULL AND cancelled_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM pending_actions WHERE status='open')
    AND (SELECT count(*) FROM branches WHERE is_active=1)=2
    AND (SELECT count(*) FROM branches WHERE is_active=1 AND ((id=@source AND canonical_key='shop') OR (id=@target AND canonical_key='warehouse')))=2`,
  { source: input.sourceBranchId, target: input.targetBranchId })
  const final = cutoverAssert(`EXISTS(SELECT 1 FROM branch_cutovers WHERE operation_id=@operation AND begin_request_id=@request AND phase='capturing' AND revision=0 AND intent_json=@intent)`, { operation: operationId, request: input.requestId, intent: intentJson })
  try { return await beginBranchCutoverJournal(compose(db, [...guardsFor(current, schema, state), stockGuard(input, false), admission], [final]), begin) }
  catch (cause) {
    if (isLocalRefusal(cause)) throw cause
    try { const row = await readBranchCutoverJournal(db, begin); requireParent(row.intent_json === intentJson && row.begin_request_id === input.requestId); return { row, replayed: true } } catch { }
    throw new BranchCutoverParentOutcomeUnknown(cause)
  }
}

/** Advances the operation by exactly one durable step (at most one batch). Re-entrant by revision CAS. */
export async function continueBranchCutover(db: D1Compat, actor: Principal, organizationId: number,
  input: { operationId: string; expectedRevision: number; pageSize?: number }, budget: TransferInvocationBudget, hooks: ParentHooks = {}): Promise<Step> {
  const rawDb = db
  db = metered(db, budget); const current = await principal(db, actor, organizationId)
  const { row, intent } = await readIntent(db, current, organizationId, input.operationId)
  requireParent(Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 0)
  if (row.revision > input.expectedRevision) return { row, replayed: true, next: nextFor(row) }
  requireParent(row.revision === input.expectedRevision && row.phase !== 'aborted')
  if (row.phase === 'completed') return { row, replayed: true, next: { kind: 'completed' } }
  if (row.phase === 'capturing' || row.phase === 'snapshots') return captureStep(db, current, row, intent, input.pageSize ?? CAPTURE_PAGE_CAP, rawDb, hooks)
  if (row.phase === 'moving') return movingStep(db, current, row, intent)
  if (row.phase === 'verifying') return verifyStep(db, current, row, intent)
  return finalizeStep(db, current, row, intent)
}

function manifestOf(row: BranchCutoverJournalRow): Record<string, any> {
  const manifest = JSON.parse(row.manifest_json || 'null')
  if (manifest?.version !== 3 || manifest.coverage?.kind !== 'registry-v3-capture') throw new BranchCutoverCapabilityError('parent_manifest_v3_required')
  return manifest
}

/** What the Worker injects so lib code never imports a route: the product merge (routes/products.ts foldDuplicateProductInto). */
export type ParentHooks = { foldInactiveProduct?: (user: SessionUser, dup: InactiveStockRow, keeper: { id: number; name: string | null }, approved: boolean) => Promise<void> }
async function captureStep(db: D1Compat, current: SessionUser, row: BranchCutoverJournalRow, intent: ParentIntent, pageSize: number, rawDb: D1Compat, hooks: ParentHooks): Promise<Step> {
  const schema = await readCutoverCaptureSchema(db); requireSameContract('schema', intent.schemaDigest, schema.digest); requireSchema(schema)
  const state = await branches(db, intent); requireParent(JSON.stringify(state.source) === row.source_preimage_json && JSON.stringify(state.target) === row.target_preimage_json)
  const stage = row.phase === 'capturing' ? 'capture' : 'snapshot'
  const cursor = parseCaptureCursor(row[`${stage}_cursor_json`]); const priorDigest = row[`${stage}_digest`]
  // The first capture page: inactive products holding stock are resolved BEFORE anything is read, so the capture, the manifest baseline and
  // the end state describe the same stock. Idempotent by state (a retry after a crash re-reads the census and finds only what is left).
  if (stage === 'capture' && cursor.index === 0 && cursor.key === 0 && row.capture_records === 0) {
    const plan = await readInactiveStockPlan(db, intent.approvedFolds ?? [])
    if (plan.refuse.length) refuse(plan.refuse.map(item => 'inactive_stock_without_twin:' + item.id + ':' + item.reason).join(';'))
    if (!inactiveStockPlanIsEmpty(plan)) {
      if (plan.fold.length && !hooks.foldInactiveProduct) refuse('inactive_stock_fold_unavailable')
      await applyInactiveStockPlan(rawDb, plan, { operationId: row.operation_id, actorId: current.id, actorName: current.username ?? null },
        (dup, keeper, approved) => hooks.foldInactiveProduct!(current, dup, keeper, approved))
    }
  }
  let families: FamilyState
  if (cursor.families) families = familiesFromText(cursor.families)
  else if (stage === 'snapshot') families = familiesFromManifest(manifestOf(row).families)
  else {
    families = await readCutoverFamilies(db)
    if (families.pending_open) refuse('pending_actions_open:' + families.pending_open)
  }
  const page = await readCutoverCapturePage(db, schema, intent, cursor.families ? cursor : { ...cursor, families: familyStateText(families) }, priorDigest, pageSize,
    { [intent.sourceBranchId]: String(state.source.name), [intent.targetBranchId]: String(state.target.name) }, stage === 'snapshot')
  const before = [...guardsFor(current, schema, state), ...familyGuards(families, cursor.key === 0 && cursor.index === 0), ...page.statements]
  if (page.records > 0) {
    return commit(db, row, before, composed => checkpointBranchCutoverJournal(composed, proof(row), row.revision, { phase: row.phase as 'capturing' | 'snapshots',
      cursorJson: JSON.stringify(page.cursor), records: row[`${stage}_records`] + page.records, digest: page.digest }),
    saved => saved[`${stage}_cursor_json`] === JSON.stringify(page.cursor) && saved[`${stage}_digest`] === page.digest, continueNext)
  }
  before.push(...familyGuards(families, true), stockGuard(intent))
  if (stage === 'capture') {
    const manifest = { version: 3, sourceBranchId: intent.sourceBranchId, targetBranchId: intent.targetBranchId, capturedRecords: row.capture_records,
      movingProducts: cursor.movingProducts, sourceQuantityText: cursor.sourceQuantityText, sourceLotQuantityText: cursor.sourceLotQuantityText,
      anomalies: 0, captureDigest: row.capture_digest,
      coverage: { kind: 'registry-v3-capture', registryDigest: intent.registryDigest, schemaDigest: intent.schemaDigest, scalarReferences: 32, historicalReplayCertified: true },
      history: cursor.history,
      families: { undo_snapshots: families.undo_snapshots, stock_session_operations: families.stock_session_operations, pending_actions: families.pending_actions,
        pendingOpen: 0, actionHistoryMax: families.action_history_max },
      baseline: { targetQuantityText: cursor.targetQuantityText, targetLotQuantityText: cursor.targetLotQuantityText, stockHash: cursor.stockHash, lotHash: cursor.lotHash } }
    const text = JSON.stringify(manifest)
    return commit(db, row, before, composed => sealBranchCutoverManifest(composed, proof(row), row.revision, text), saved => saved.manifest_json === text, continueNext)
  }
  const manifest = manifestOf(row)
  requireParent(row.snapshot_digest === row.capture_digest && row.snapshot_records === row.capture_records
    && JSON.stringify(cursor.history) === JSON.stringify(manifest.history) && cursor.stockHash === manifest.baseline.stockHash && cursor.lotHash === manifest.baseline.lotHash)
  before.push(...missingSnapshotGuards(intent))
  if (manifest.movingProducts === 0) before.push(cutoverAssert(sourceEmptySql, { source: intent.sourceBranchId }))
  return commit(db, row, before, composed => finishBranchCutoverSnapshots(composed, proof(row), row.revision), saved => saved.phase !== row.phase, continueNext)
}

function childReason(row: BranchCutoverJournalRow, intent: ParentIntent): string {
  return `Branch consolidation: ${String(JSON.parse(row.source_preimage_json).name).trim()} → ${intent.successorName}`
}
const receiptByKey = `SELECT r.id,r.status,r.request_json,r.operation_id,CAST(json_extract(r.request_json,'$.transfer.productId') AS INTEGER) AS product
  FROM transfer_operation_receipts r WHERE r.actor_id=@actor AND r.request_id=@key`
/**
 * One product's lot rows at one branch. CROSS JOIN fixes the order: the product's batches first (variant index), then
 * the (batch_id, branch_id) unique index. Without it D1, which has no ANALYZE statistics, reads every lot row of the
 * branch through the (branch_id, quantity) index for each product: quadratic, ~3.4M rows per 256-row reconcile page
 * at production scale (production-scale workerd bench, 6 Oct 2026).
 */
const productLotsAt = (product: string, branch: string): string =>
  `FROM product_batches b CROSS JOIN branch_batch_stock s ON s.batch_id=b.id AND s.branch_id=${branch} WHERE b.variant_product_id=${product}`
/** Previous product fully drained from the source in both ledgers, and both ledgers agree at the target. */
const drainedSql = `COALESCE((SELECT quantity FROM branch_stock WHERE product_id=@last AND branch_id=@source),0)=0
  AND NOT EXISTS(SELECT 1 ${productLotsAt('@last', '@source')} AND s.quantity<>0)
  AND COALESCE((SELECT sum(s.quantity) ${productLotsAt('@last', '@target')}),0)
    <=COALESCE((SELECT quantity FROM branch_stock WHERE product_id=@last AND branch_id=@target),0)+1e-9`
// The unary plus keeps the planner on the (product_id, branch_id) unique index
// range after @last, so each child plan reads a handful of rows, not every source row.
export const NEXT_SOURCE_PRODUCT_SQL = `SELECT product_id,quantity FROM branch_stock WHERE product_id>@last AND +branch_id=@source AND +quantity>0 ORDER BY product_id LIMIT 1`

async function movingStep(db: D1Compat, current: SessionUser, row: BranchCutoverJournalRow, intent: ParentIntent): Promise<Step> {
  if (row.planned_child_json !== null) return { row, replayed: false, next: nextFor(row) }
  const manifest = manifestOf(row)
  const state = await branches(db, intent); requireParent(JSON.stringify(state.source) === row.source_preimage_json && JSON.stringify(state.target) === row.target_preimage_json)
  let last = 0
  if (row.next_sequence > 0) {
    const previous = await db.prepare(receiptByKey).get<Record<string, unknown>>({ actor: row.actor_id, key: `bc_${row.operation_id}_${row.next_sequence - 1}` })
    requireParent(previous && previous.status === 'committed' && Number.isSafeInteger(previous.product) && Number(previous.product) > 0)
    last = Number(previous.product)
  }
  const ids = { source: intent.sourceBranchId, target: intent.targetBranchId }
  let candidate = await db.prepare(NEXT_SOURCE_PRODUCT_SQL).get<{ product_id: number; quantity: number }>({ ...ids, last })
  // The forward scan found nothing: one full check before declaring the source empty (self-heals an out-of-order product).
  if (!candidate && last > 0) candidate = await db.prepare(NEXT_SOURCE_PRODUCT_SQL).get<{ product_id: number; quantity: number }>({ ...ids, last: 0 })
  const before = [actorGuard(current), ...branchGuards(state), ...(last > 0 ? [cutoverAssert(drainedSql, { ...ids, last })] : [])]
  if (candidate) {
    requireParent(Number.isSafeInteger(candidate.product_id) && candidate.product_id > 0 && typeof candidate.quantity === 'number' && Number.isFinite(candidate.quantity) && candidate.quantity > 0)
    requireParent(row.next_sequence < manifest.movingProducts + 64)
    const childJson = JSON.stringify({ version: 1, kind: 'branch-cutover-child', operationId: row.operation_id, sequence: row.next_sequence, actorId: row.actor_id,
      organizationId: row.organization_id, controlIncarnation: row.control_incarnation, sourceBranchId: intent.sourceBranchId, targetBranchId: intent.targetBranchId,
      reason: childReason(row, intent), transfer: { productId: candidate.product_id, quantity: candidate.quantity, batchId: null } })
    before.push(cutoverAssert(`(SELECT quantity FROM branch_stock WHERE product_id=@product AND branch_id=@source)=@quantity`, { ...ids, product: candidate.product_id, quantity: candidate.quantity }))
    return commit(db, row, before, composed => sealBranchCutoverChild(composed, proof(row), row.revision, childJson), saved => saved.planned_child_json === childJson, nextFor)
  }
  requireParent(row.committed_children === manifest.movingProducts)
  before.push(cutoverAssert(sourceEmptySql, ids), stockGuard(intent))
  return commit(db, row, before, composed => finishBranchCutoverMoving(composed, proof(row), row.revision), saved => saved.phase === 'verifying', continueNext)
}

// ---- date-only lot merge (owner 5 Oct 2026; rulings 6 Oct 2026) -----------
export type CutoverFoldLot = { id: number; product: number; receivedAt: string | null; expiry: string | null; cost: number | null; quantity: number
  supplierId: number | null; supplierName?: string | null }
export type CutoverFold = { product: number; survivor: number; folded: number[]; dateKey: string; expiry: string | null
  costClass: CostClass; before: Array<[number, number]>; after: Array<[number, number]>; costBefore: number | null; costAfter: number | null
  suppliers: Array<number | null>; supplierKey: string; uncosted: number[]; emptySupplier: number[]; freeToUnknown: number[] }
export type CutoverFoldPlan = { folds: CutoverFold[]; expirySplit: number; supplierSplit: number; roundingSplit: number; uncostedMerges: number
  freeUnknownMerges: number; emptySupplierMerges: number }
type CostClass = 'recorded' | 'zero' | 'unknown'
/** SQLite's trim(): spaces only (String.prototype.trim also strips tabs, newlines and NBSP, which the SQL twin keeps). */
const sqlTrim = (text: string): string => text.replace(/^ +| +$/g, '')
const isCalendarDay = (year: number, month: number, day: number): boolean =>
  month >= 1 && month <= 12 && day >= 1 && day <= [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
/**
 * The Cambodia business day (UTC+7, businessDateWindow) a lot was received on.
 * A date-only value is already a business day and stays as stored; a timestamp
 * is converted (no zone = UTC, the house convention). A slash date-only value
 * M/D/YYYY (1-2 digit month and day) is read MONTH-FIRST: the only slash text
 * ever stored in product_batches.received_at came from the Aug-28 catalog
 * import's `batch(mm/dd/yyyy)` column, migration 0077_batch_received_iso.sql
 * rewrote those rows month-first, and every writer since stores ISO
 * (normalizeToIsoDate / normalizeTypedDate). It must be a real calendar day.
 * Owner 6 Oct: the DATE decides, whatever text it was stored as, so
 * 08/24/2026 and 2026-08-24 are the same day. Anything else never merges.
 * SQL twin: cutoverLotDaySql.
 */
export function cutoverLotBusinessDay(value: string | null): string | null {
  if (typeof value !== 'string') return null
  const text = sqlTrim(value)
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
  if (slash) {
    const [month, day, year] = [Number(slash[1]), Number(slash[2]), Number(slash[3])]
    return isCalendarDay(year, month, day) ? `${slash[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  // A timestamp: 'T' or one space, then the time, with nothing SQLite's date() skips and V8 refuses
  // (inner whitespace, control characters, a colon-less +HHMM zone), so both twins read the same set.
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d[!-~]*$/.test(text) || /[+-]\d{4}$/.test(text)) return null
  return localDateOf(text) || null
}
/** M/D/YYYY -> YYYY-MM-DD by shape (the four shapes 0077 rewrote); NULL for any other text. Not yet calendar-checked. */
const slashIsoSql = (t: string): string =>
  `CASE WHEN ${t} GLOB '[0-9][0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]' THEN substr(${t},7,4)||'-'||substr(${t},1,2)||'-'||substr(${t},4,2)
    WHEN ${t} GLOB '[0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]' THEN substr(${t},6,4)||'-0'||substr(${t},1,1)||'-'||substr(${t},3,2)
    WHEN ${t} GLOB '[0-9][0-9]/[0-9]/[0-9][0-9][0-9][0-9]' THEN substr(${t},6,4)||'-'||substr(${t},1,2)||'-0'||substr(${t},4,1)
    WHEN ${t} GLOB '[0-9]/[0-9]/[0-9][0-9][0-9][0-9]' THEN substr(${t},5,4)||'-0'||substr(${t},1,1)||'-0'||substr(${t},3,1) END`
export const cutoverLotDaySql = (column: string): string => {
  const t = `trim(${column})`
  return `CASE WHEN ${t} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN ${t}
    WHEN substr(${t},1,10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(${t},11,2) GLOB '[T ][0-9]'
      AND NOT substr(${t},13) GLOB '*[^!-~]*' THEN ${localDateExpr(t)}
    WHEN date(${slashIsoSql(t)})=${slashIsoSql(t)} THEN ${slashIsoSql(t)} END`
}
/** Supplier identity of a lot: the supplier id, else the trimmed lower-case supplier name, else '' (no supplier). SQL twin: cutoverSupplierKeySql. */
export function cutoverSupplierKey(lot: Pick<CutoverFoldLot, 'supplierId' | 'supplierName'>): string {
  if (typeof lot.supplierId === 'number' && Number.isSafeInteger(lot.supplierId)) return 'id:' + lot.supplierId
  // SQLite's lower() folds ASCII only and its trim() strips spaces only: the twin must agree byte for byte
  const name = typeof lot.supplierName === 'string' ? sqlTrim(lot.supplierName).replace(/[A-Z]+/g, upper => upper.toLowerCase()) : ''
  return name ? 'name:' + name : ''
}
export const cutoverSupplierKeySql = (id: string, name: string): string =>
  `CASE WHEN typeof(${id}) IN ('integer','real') AND ${id}=CAST(${id} AS INTEGER) THEN 'id:'||CAST(${id} AS INTEGER) WHEN trim(coalesce(${name},''))<>'' THEN 'name:'||lower(trim(${name})) ELSE '' END`
const recorded = (cost: number | null): cost is number => typeof cost === 'number' && Number.isFinite(cost) && cost > 0
const costClassOf = (cost: number | null): CostClass => recorded(cost) ? 'recorded' : cost === 0 ? 'zero' : 'unknown'
/**
 * Pure plan. Per moved product at the target, lots received on the same
 * business day become one lot, except (owner rulings, 6 Oct 2026):
 *   - a different expiry date keeps lots apart (expirySplit);
 *   - two different suppliers keep lots apart (supplierSplit); a lot with no
 *     supplier merges into the one supplier its day has, and that supplier's
 *     lot survives (emptySupplierMerges);
 *   - a recorded cost (> 0) and a free (0) or unknown (NULL) cost MERGE: every
 *     unit takes the quantity-weighted average of the recorded costs only
 *     (uncostedMerges);
 *   - with no recorded cost, a free ($0) and an unknown (NULL) cost MERGE and
 *     the merged lot's cost is UNKNOWN, never $0 (freeUnknownMerges);
 *   - a blend that would round to $0.0000 keeps its lots apart (roundingSplit).
 * The survivor is the lowest-id lot already at the target (with the supplier,
 * when the group has one), else the lowest-id arriving lot. Arriving lots fold
 * into it, and so do target lots without a supplier when the survivor has one;
 * lots already at the target never fold into each other otherwise. A blended
 * cost is rounded once to 4 decimals (moneyPrecision); equal recorded costs are
 * kept byte-identical. Quantities are exact decimals.
 * Each split counts an arriving lot once, by the first reason that separates
 * it from another lot of its business day: expiry, then supplier, then cost.
 */
export function planCutoverLotFolds(products: Array<{ productId: number; moved: Array<[number, number]>; lots: CutoverFoldLot[] }>): CutoverFoldPlan {
  const plan: CutoverFoldPlan = { folds: [], expirySplit: 0, supplierSplit: 0, roundingSplit: 0, uncostedMerges: 0, freeUnknownMerges: 0, emptySupplierMerges: 0 }
  for (const { productId, moved, lots } of products) {
    const movedBy = new Map<number, bigint>()
    for (const [batch, quantity] of moved) movedBy.set(batch, (movedBy.get(batch) ?? 0n) + decimal(quantity))
    const facts = lots.filter(lot => lot.product === productId).map(lot => {
      const quantity = decimal(lot.quantity); const arrived = movedBy.get(lot.id) ?? 0n
      if (arrived > quantity) refuse('fold_moved_exceeds_target:' + lot.id)
      const prior = quantity - arrived
      return { lot, quantity, prior, arrival: prior === 0n && arrived > 0n, day: cutoverLotBusinessDay(lot.receivedAt),
        expiry: JSON.stringify(lot.expiry ?? null), supplier: cutoverSupplierKey(lot), costClass: costClassOf(lot.cost), part: '' }
    })
    for (const batch of movedBy.keys()) if (!facts.some(fact => fact.lot.id === batch) && movedBy.get(batch)! > 0n) refuse('fold_moved_lot_missing:' + batch)
    const dated = facts.filter(fact => fact.day !== null)
    // Partition: business day, expiry, supplier (an empty supplier joins the day's only supplier), cost (recorded absorbs free/unknown).
    const key = (fact: typeof facts[number], depth: number) => [fact.day, fact.expiry, fact.part.split('|')[0], fact.part.split('|')[1]].slice(0, depth).join('\u0001')
    for (const fact of dated) {
      const suppliers = new Set(dated.filter(other => other.day === fact.day && other.expiry === fact.expiry && other.supplier !== '').map(other => other.supplier))
      fact.part = (fact.supplier === '' && suppliers.size === 1 ? [...suppliers][0] : fact.supplier) + '|'
    }
    for (const fact of dated) {
      const group = dated.filter(other => key(other, 3) === key(fact, 3))
      fact.part += group.some(other => other.costClass === 'recorded') ? 'recorded' : 'none'
    }
    const parts = new Map<string, typeof facts>()
    for (const fact of dated) parts.set(key(fact, 4), [...(parts.get(key(fact, 4)) ?? []), fact])
    const blended = new Set<number>()
    for (const group of parts.values()) {
      if (!group.some(fact => fact.arrival)) continue
      const sorted = [...group].sort((a, b) => a.lot.id - b.lot.id)
      const supplierKey = sorted[0].part.split('|')[0]
      const eligible = sorted.filter(fact => fact.supplier === supplierKey)
      const survivor = eligible.find(fact => fact.prior > 0n) ?? eligible.find(fact => fact.arrival)
      if (!survivor) continue
      const folded = sorted.filter(fact => fact !== survivor && (fact.arrival || (supplierKey !== '' && fact.supplier === '' && fact.prior > 0n)))
      if (!folded.length) continue
      const members = [survivor, ...folded]
      const total = members.reduce((sum, fact) => sum + fact.quantity, 0n)
      const priced = members.filter(fact => fact.costClass === 'recorded')
      let costAfter = survivor.lot.cost
      if (priced.length) {
        const costs = new Set(priced.map(fact => fact.lot.cost))
        try {
          costAfter = costs.size === 1 ? priced[0].lot.cost : weightedMeanMoney4(priced.map(fact => ({ amount: fact.lot.cost as number, factor: decimalText(fact.quantity) })),
            decimalText(priced.reduce((sum, fact) => sum + fact.quantity, 0n)))
        } catch { costAfter = null }
        // A blend that rounds to free (sub-$0.00005 costs) or is out of money range: keep those lots apart, never stop the run.
        if (!recorded(costAfter)) { for (const fact of group) if (fact.arrival) blended.add(fact.lot.id); continue }
      } else if (members.some(fact => fact.costClass === 'unknown')) costAfter = null // owner 6 Oct: $0 + unknown is unknown, never $0
      const unknownCost = !priced.length && members.some(fact => fact.costClass === 'unknown')
      const freeToUnknown = unknownCost ? members.filter(fact => fact.costClass === 'zero').map(fact => fact.lot.id) : []
      if (freeToUnknown.length) plan.freeUnknownMerges++
      const uncosted = priced.length ? members.filter(fact => fact.costClass !== 'recorded').map(fact => fact.lot.id) : []
      const emptySupplier = supplierKey !== '' ? members.filter(fact => fact.supplier === '').map(fact => fact.lot.id) : []
      if (uncosted.length) plan.uncostedMerges++
      if (emptySupplier.length) plan.emptySupplierMerges++
      plan.folds.push({ product: productId, survivor: survivor.lot.id, folded: folded.map(fact => fact.lot.id), dateKey: survivor.day!,
        expiry: survivor.lot.expiry ?? null, costClass: priced.length ? 'recorded' : unknownCost ? 'unknown' : 'zero',
        before: members.map(fact => [fact.lot.id, Number(decimalText(fact.quantity))]),
        after: [[survivor.lot.id, Number(decimalText(total))], ...folded.map(fact => [fact.lot.id, 0] as [number, number])],
        costBefore: survivor.lot.cost, costAfter, suppliers: members.map(fact => fact.lot.supplierId), supplierKey, uncosted, emptySupplier, freeToUnknown })
    }
    // Every arriving lot kept apart from another lot of its business day, counted once by the first separating reason.
    for (const fact of dated) {
      if (!fact.arrival) continue
      const day = dated.filter(other => other !== fact && other.day === fact.day)
      if (day.some(other => other.expiry !== fact.expiry)) plan.expirySplit++
      else if (day.some(other => key(other, 3) !== key(fact, 3))) plan.supplierSplit++
      else if (blended.has(fact.lot.id)) plan.roundingSplit++
    }
  }
  return plan
}

type VerifyCursor = {
  stage: 'fold' | 'reconcile' | 'closures' | 'done'; after: number
  folds: number; foldedLots: number; costChanged: number; expirySplit: number; supplierSplit: number; roundingSplit: number
  uncostedMerges: number; freeUnknownMerges: number; emptySupplierMerges: number; foldHash: string
  table: 'branch_stock' | 'branch_batch_stock'; stockHash: string; lotHash: string
  sourceText: string; targetText: string; sourceLotText: string; targetLotText: string
  closedRetired: number; closedChildren: number; leaveSeen: number; closeSeen: number; historyDigest: string
}
const initialVerify = (): VerifyCursor => ({ stage: 'fold', after: 0, folds: 0, foldedLots: 0, costChanged: 0, expirySplit: 0, supplierSplit: 0, roundingSplit: 0,
  uncostedMerges: 0, freeUnknownMerges: 0, emptySupplierMerges: 0, foldHash: '0',
  table: 'branch_stock', stockHash: '0', lotHash: '0', sourceText: '0', targetText: '0', sourceLotText: '0', targetLotText: '0',
  closedRetired: 0, closedChildren: 0, leaveSeen: 0, closeSeen: 0, historyDigest: '' })
function parseVerify(text: string): VerifyCursor {
  if (text === '{}') return initialVerify()
  const cursor = JSON.parse(text) as VerifyCursor
  requireParent(Object.keys(cursor).sort().join(',') === Object.keys(initialVerify()).sort().join(',')
    && ['fold', 'reconcile', 'closures', 'done'].includes(cursor.stage) && Number.isSafeInteger(cursor.after) && cursor.after >= 0)
  return cursor
}
const hashSum = (left: string, right: string): string => ((BigInt('0x' + left) + BigInt('0x' + right)) % ((1n << 127n) - 1n)).toString(16)
const lotFingerprintSql = `SELECT json_group_array(json_array(id,printf('%!.17g',quantity),typeof(cost),CASE WHEN cost IS NULL THEN NULL ELSE printf('%!.17g',cost) END)) FROM (
  SELECT b.id,s.quantity,b.unit_cost_usd AS cost FROM product_batches b JOIN branch_batch_stock s ON s.batch_id=b.id AND s.branch_id=@target
  WHERE b.id IN (SELECT CAST(value AS INTEGER) FROM json_each(@ids)) ORDER BY b.id)`

async function verifyStep(db: D1Compat, current: SessionUser, row: BranchCutoverJournalRow, intent: ParentIntent): Promise<Step> {
  const manifest = manifestOf(row)
  const state = await branches(db, intent); requireParent(JSON.stringify(state.source) === row.source_preimage_json && JSON.stringify(state.target) === row.target_preimage_json)
  const cursor = parseVerify(row.verification_cursor_json)
  const ids = { source: intent.sourceBranchId, target: intent.targetBranchId }
  const before = [actorGuard(current), ...branchGuards(state)]
  const checkpoint = (next: VerifyCursor, records: number, digest = row.verification_digest) => {
    const cursorJson = JSON.stringify(next)
    return commit(db, row, before, composed => checkpointBranchCutoverJournal(composed, proof(row), row.revision, { phase: 'verifying', cursorJson,
      records: row.verification_records + Math.max(1, records), digest }), saved => saved.verification_cursor_json === cursorJson, continueNext)
  }
  if (cursor.stage === 'done') {
    before.push(...familyGuardsWithoutHistory(familiesFromManifest(manifest.families)), cutoverAssert(sourceEmptySql, ids), stockGuard(intent))
    return commit(db, row, before, composed => markBranchCutoverReady(composed, proof(row), row.revision), saved => saved.phase === 'ready', continueNext)
  }
  if (cursor.stage === 'fold') {
    if (cursor.after >= row.committed_children) return checkpoint({ ...cursor, stage: 'reconcile', after: 0 }, 1)
    const end = Math.min(row.committed_children, cursor.after + FOLD_PAGE_CHILDREN)
    const keys = Array.from({ length: end - cursor.after }, (_, index) => `bc_${row.operation_id}_${cursor.after + index}`)
    const children = await db.prepare(`SELECT r.request_id,r.status,CAST(json_extract(r.request_json,'$.transfer.productId') AS INTEGER) AS product,
        (SELECT json_group_array(json_array(CAST(json_extract(a.value,'$.source_batch_id') AS INTEGER),json_extract(a.value,'$.quantity')))
          FROM transfer_operation_members m, json_each(m.allocations_json) a WHERE m.receipt_id=r.id AND m.ordinal=0) AS moved
      FROM transfer_operation_receipts r WHERE r.actor_id=@actor AND r.request_id IN (SELECT value FROM json_each(@keys)) ORDER BY r.id`)
      .all<{ request_id: string; status: string; product: number; moved: string }>({ actor: row.actor_id, keys: JSON.stringify(keys) })
    requireParent(children.length === keys.length && children.every(child => child.status === 'committed' && Number.isSafeInteger(child.product) && child.product > 0))
    const products = children.map(child => ({ productId: child.product, moved: JSON.parse(child.moved) as Array<[number, number]> }))
    const lots = await db.prepare(`SELECT b.id,b.variant_product_id AS product,b.received_at AS receivedAt,b.expiry_date AS expiry,b.unit_cost_usd AS cost,
        s.quantity,b.supplier_id AS supplierId,b.supplier_name AS supplierName FROM product_batches b JOIN branch_batch_stock s ON s.batch_id=b.id AND s.branch_id=@target
      WHERE b.variant_product_id IN (SELECT CAST(value AS INTEGER) FROM json_each(@products)) AND s.quantity>0 ORDER BY b.variant_product_id,b.id`)
      .all<CutoverFoldLot>({ target: intent.targetBranchId, products: JSON.stringify(products.map(product => product.productId)) })
    const plan = planCutoverLotFolds(products.map(product => ({ ...product, lots })))
    const next: VerifyCursor = { ...cursor, after: end, folds: cursor.folds + plan.folds.length, expirySplit: cursor.expirySplit + plan.expirySplit,
      supplierSplit: cursor.supplierSplit + plan.supplierSplit, roundingSplit: cursor.roundingSplit + plan.roundingSplit,
      uncostedMerges: cursor.uncostedMerges + plan.uncostedMerges, freeUnknownMerges: cursor.freeUnknownMerges + plan.freeUnknownMerges,
      emptySupplierMerges: cursor.emptySupplierMerges + plan.emptySupplierMerges,
      foldedLots: cursor.foldedLots + plan.folds.reduce((n, fold) => n + fold.folded.length, 0),
      costChanged: cursor.costChanged + plan.folds.filter(fold => fold.costAfter !== fold.costBefore).length }
    if (plan.folds.length) {
      for (const fold of plan.folds) for (const [index, [id, quantity]] of fold.after.entries()) {
        next.foldHash = await ledgerHashAdd(next.foldHash, 'batch', id, quantity)
        next.foldHash = await ledgerHashAdd(next.foldHash, 'batch', id, fold.before[index][1], -1)
      }
      const touched = plan.folds.flatMap(fold => fold.before.map(([id]) => id)).sort((a, b) => a - b)
      const fingerprint = await db.prepare(`SELECT (${lotFingerprintSql}) AS value`).get<{ value: string }>({ target: intent.targetBranchId, ids: JSON.stringify(touched) })
      requireParent(fingerprint && typeof fingerprint.value === 'string')
      const quantities = JSON.stringify(plan.folds.flatMap(fold => fold.after))
      const costs = JSON.stringify(plan.folds.filter(fold => fold.costAfter !== fold.costBefore).map(fold => [fold.survivor, fold.costAfter]))
      const audits = JSON.stringify(plan.folds.map(fold => ({ operationId: row.operation_id, productId: fold.product, survivorBatchId: fold.survivor, foldedBatchIds: fold.folded,
        receivedDate: fold.dateKey, expiryDate: fold.expiry, before: fold.before, after: fold.after, unitCostUsdBefore: fold.costBefore, unitCostUsdAfter: fold.costAfter,
        costClass: fold.costClass, supplierIds: fold.suppliers, supplierKey: fold.supplierKey, uncostedBatchIds: fold.uncosted, freeToUnknownBatchIds: fold.freeToUnknown,
        emptySupplierBatchIds: fold.emptySupplier, branchId: intent.targetBranchId })))
      const productIds = JSON.stringify([...new Set(plan.folds.map(fold => fold.product))])
      before.push(cutoverAssert(`(${lotFingerprintSql})=@fingerprint`, { target: intent.targetBranchId, ids: JSON.stringify(touched), fingerprint: fingerprint.value }),
        // Cost first: the 0195 on-hand trigger fires on the quantity update and must see the merged cost.
        { sql: `UPDATE product_batches SET unit_cost_usd=(SELECT json_extract(c.value,'$[1]') FROM json_each(@costs) c WHERE CAST(json_extract(c.value,'$[0]') AS INTEGER)=product_batches.id),
            updated_at=CURRENT_TIMESTAMP WHERE id IN (SELECT CAST(json_extract(value,'$[0]') AS INTEGER) FROM json_each(@costs))`, params: { costs } },
        { sql: `UPDATE branch_batch_stock SET quantity=(SELECT json_extract(q.value,'$[1]') FROM json_each(@quantities) q WHERE CAST(json_extract(q.value,'$[0]') AS INTEGER)=branch_batch_stock.batch_id),
            updated_at=CURRENT_TIMESTAMP WHERE batch_id IN (SELECT CAST(json_extract(value,'$[0]') AS INTEGER) FROM json_each(@quantities)) AND +branch_id=@target`, params: { quantities, target: intent.targetBranchId } },
        { sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id)
            SELECT @actor,@actorName,@action,'product_batch',CAST(json_extract(a.value,'$.survivorBatchId') AS TEXT),a.value,'product_batches',CAST(json_extract(a.value,'$.survivorBatchId') AS TEXT)
            FROM json_each(@audits) a`, params: { actor: current.id, actorName: current.username ?? null, action: BRANCH_CUTOVER_FOLD_AUDIT_ACTION, audits } },
        cutoverAssert(`NOT EXISTS(SELECT 1 FROM json_each(@quantities) q LEFT JOIN branch_batch_stock s ON s.batch_id=CAST(json_extract(q.value,'$[0]') AS INTEGER) AND s.branch_id=@target
            WHERE s.quantity IS NOT json_extract(q.value,'$[1]'))
          AND NOT EXISTS(SELECT 1 FROM json_each(@costs) c JOIN product_batches b ON b.id=CAST(json_extract(c.value,'$[0]') AS INTEGER) WHERE b.unit_cost_usd IS NOT json_extract(c.value,'$[1]'))
          AND NOT EXISTS(SELECT 1 FROM json_each(@products) p WHERE COALESCE((SELECT sum(s.quantity) ${productLotsAt('CAST(p.value AS INTEGER)', '@target')}),0)>COALESCE((SELECT quantity FROM branch_stock WHERE product_id=CAST(p.value AS INTEGER) AND branch_id=@target),0)+1e-9)`,
        { quantities, costs, products: productIds, target: intent.targetBranchId }))
    }
    return checkpoint(next, keys.length)
  }
  if (cursor.stage === 'reconcile') {
    const table = cursor.table
    // Raw REAL values for the arithmetic (exact decimals, as captured); printf text only pins the page inside the batch.
    const rowsSql = table === 'branch_stock'
      ? `SELECT bs.rowid AS k,bs.product_id AS id,bs.branch_id AS branch,bs.quantity,printf('%!.17g',bs.quantity) AS text,
          (SELECT coalesce(sum(s.quantity),0) ${productLotsAt('bs.product_id', 'bs.branch_id')}) AS lots
          FROM branch_stock bs WHERE +bs.branch_id IN (@source,@target) AND bs.rowid>@after ORDER BY bs.rowid LIMIT @limit`
      : `SELECT rowid AS k,batch_id AS id,branch_id AS branch,quantity,printf('%!.17g',quantity) AS text,0 AS lots
          FROM branch_batch_stock WHERE +branch_id IN (@source,@target) AND rowid>@after ORDER BY rowid LIMIT @limit`
    const params = { ...ids, after: cursor.after, limit: VERIFY_PAGE_ROWS }
    const rows = await db.prepare(rowsSql).all<{ k: number; id: number; branch: number; quantity: number; text: string; lots: number }>(params)
    const next: VerifyCursor = { ...cursor }
    for (const entry of rows) {
      requireParent(Number.isSafeInteger(entry.k) && entry.k > next.after && (entry.branch === ids.source || entry.branch === ids.target) && typeof entry.text === 'string')
      const quantity = decimal(entry.quantity)
      if (entry.branch === ids.source && quantity !== 0n) refuse('reconcile_source_not_empty:' + table + ':' + entry.id)
      if (table === 'branch_stock') {
        if (!(typeof entry.lots === 'number' && entry.lots <= entry.quantity + 1e-9)) refuse('reconcile_ledgers_disagree:' + entry.id + ':' + entry.branch)
        next.stockHash = await ledgerHashAdd(next.stockHash, 'product', entry.id, entry.quantity)
        if (entry.branch === ids.source) next.sourceText = decimalText(decimal(next.sourceText) + quantity); else next.targetText = decimalText(decimal(next.targetText) + quantity)
      } else {
        next.lotHash = await ledgerHashAdd(next.lotHash, 'batch', entry.id, entry.quantity)
        if (entry.branch === ids.source) next.sourceLotText = decimalText(decimal(next.sourceLotText) + quantity); else next.targetLotText = decimalText(decimal(next.targetLotText) + quantity)
      }
      next.after = entry.k
    }
    const pageText = JSON.stringify(rows.map(entry => [entry.k, entry.id, entry.branch, entry.text]))
    before.push(cutoverAssert(`(SELECT json_group_array(json_array(k,id,branch,text)) FROM (${rowsSql}))=@page`, { ...params, page: pageText }))
    if (rows.length === VERIFY_PAGE_ROWS) return checkpoint(next, rows.length)
    if (table === 'branch_stock') return checkpoint({ ...next, table: 'branch_batch_stock', after: 0 }, rows.length)
    // Both ledgers fully read: conservation per product and per lot, exact totals, source empty.
    const expectTarget = addQuantity(manifest.sourceQuantityText, manifest.baseline.targetQuantityText)
    const expectTargetLots = addQuantity(manifest.sourceLotQuantityText, manifest.baseline.targetLotQuantityText)
    if (next.sourceText !== '0' || next.sourceLotText !== '0') refuse('reconcile_source_not_empty')
    if (next.targetText !== expectTarget) refuse('reconcile_product_total_mismatch:' + next.targetText + '<>' + expectTarget)
    if (next.targetLotText !== expectTargetLots) refuse('reconcile_lot_total_mismatch:' + next.targetLotText + '<>' + expectTargetLots)
    if (next.stockHash !== manifest.baseline.stockHash) refuse('reconcile_per_product_mismatch')
    if (next.lotHash !== hashSum(manifest.baseline.lotHash, next.foldHash)) refuse('reconcile_per_lot_mismatch')
    before.push(cutoverAssert(sourceEmptySql, ids))
    return checkpoint({ ...next, stage: 'closures', after: 0, table: 'branch_stock' }, rows.length)
  }
  // closures (design §1.4 step 5): every open applier row, in id order.
  const prefix = `bc_${row.operation_id}_`
  const sql = historyOpenPageSql(`,(SELECT count(*) FROM transfer_operation_receipts r WHERE r.operation_id=hf.entity_id AND r.action_history_id=hf.id
      AND r.actor_id=@actor AND substr(r.request_id,1,@prefixLength)=@prefix AND r.status='committed') AS child`)
  const rows = await db.prepare(sql).all<{ k: number; j: string; child: number }>({ ...ids, after: cursor.after, limit: CLOSURE_PAGE_ROWS, actor: row.actor_id, prefix, prefixLength: prefix.length })
  const maxId = Number(manifest.history.maxId)
  const next: VerifyCursor = { ...cursor }
  const closes: Array<{ id: number; marker: string; previousStatus: string; applier: string; updatedAt: string | null }> = []
  for (const entry of rows) {
    requireParent(cutoverBytes(entry.j) <= 65536)
    const { row: history, decision } = checkCutoverHistoryRow(entry.j, ids)
    requireParent(history.id === entry.k && history.id > next.after)
    if (history.id <= maxId) {
      next.historyDigest = await cutoverDigest(JSON.stringify([next.historyDigest, history.id, history.applier, decision]))
      if (decision === 'close') { next.closeSeen++; closes.push({ id: history.id, marker: UNDO_CLOSED_BRANCH_RETIRED, previousStatus: history.status, applier: history.applier, updatedAt: history.updated_at }) }
      else next.leaveSeen++
    } else {
      if (entry.child !== 1 || history.applier !== 'stock.transfer' || decision !== 'close' || history.status !== 'undoable') refuse('history_written_during_cutover:' + history.id)
      closes.push({ id: history.id, marker: UNDO_CLOSED_BRANCH_CUTOVER_MOVE, previousStatus: history.status, applier: history.applier, updatedAt: history.updated_at })
    }
    next.after = history.id
  }
  next.closedRetired += closes.filter(close => close.marker === UNDO_CLOSED_BRANCH_RETIRED).length
  next.closedChildren += closes.filter(close => close.marker === UNDO_CLOSED_BRANCH_CUTOVER_MOVE).length
  before.push(...historyClosureStatements({ closes, operationId: row.operation_id, actorId: current.id, actorName: current.username ?? null, ...ids }))
  if (rows.length === CLOSURE_PAGE_ROWS) return checkpoint(next, rows.length)
  if (next.historyDigest !== manifest.history.digest || next.leaveSeen !== manifest.history.leave || next.closeSeen !== manifest.history.close
    || next.closedRetired !== manifest.history.close || next.closedChildren !== row.committed_children) refuse('history_closure_mismatch')
  return checkpoint({ ...next, stage: 'done' }, rows.length)
}

async function finalizeStep(db: D1Compat, current: SessionUser, row: BranchCutoverJournalRow, intent: ParentIntent): Promise<Step> {
  const manifest = manifestOf(row)
  const schema = await readCutoverCaptureSchema(db); requireSameContract('schema', intent.schemaDigest, schema.digest); requireSchema(schema)
  const state = await branches(db, intent); requireParent(JSON.stringify(state.source) === row.source_preimage_json && JSON.stringify(state.target) === row.target_preimage_json)
  const verify = parseVerify(row.verification_cursor_json); requireParent(verify.stage === 'done')
  const ids = { source: intent.sourceBranchId, target: intent.targetBranchId }
  const sourceName = String(state.source.name).trim()
  const units = manifest.sourceQuantityText as string
  const label = `Branch consolidation: ${sourceName} → ${intent.successorName} (${row.committed_children} products, ${units} units)`
  const now = new Date().toISOString()
  const terminal = { version: 1, kind: 'completed', operationId: row.operation_id, beginRequestId: row.begin_request_id, actorId: row.actor_id,
    organizationId: row.organization_id, controlIncarnation: row.control_incarnation, intentDigest: row.intent_digest, manifestDigest: row.manifest_digest,
    sourceBranchId: ids.source, targetBranchId: ids.target, committedChildren: row.committed_children, movedQuantityText: units,
    movedLotQuantityText: manifest.sourceLotQuantityText, history: { leave: manifest.history.leave, closedRetired: verify.closedRetired, closedChildren: verify.closedChildren },
    folds: { groups: verify.folds, foldedLots: verify.foldedLots, costChanged: verify.costChanged, expirySplit: verify.expirySplit, supplierSplit: verify.supplierSplit,
      roundingSplit: verify.roundingSplit, uncostedMerges: verify.uncostedMerges, freeUnknownMerges: verify.freeUnknownMerges,
      emptySupplierMerges: verify.emptySupplierMerges },
    names: { retired: intent.retiredName, successor: intent.successorName, sourceBefore: sourceName, targetBefore: String(state.target.name).trim() },
    captureDigest: row.capture_digest, verificationDigest: row.verification_digest, completedAt: now }
  const terminalJson = JSON.stringify(terminal)
  const before: CutoverStatement[] = [captureSchemaGuard(schema), actorGuard(current), ...branchGuards(state),
    ...familyGuardsWithoutHistory(familiesFromManifest(manifest.families)), stockGuard(intent),
    // §1.4 step 6: nothing closable is still open, every child and every retired entry carries its marker.
    cutoverAssert(`${sourceEmptySql} AND NOT ${HISTORY_OPEN_CLOSABLE_EXISTS}
      AND (SELECT count(*) FROM action_history WHERE rowid>@maxId AND last_error=@moveMarker AND reversible=0 AND status='recorded')=@children
      AND (SELECT count(*) FROM action_history WHERE rowid>@maxId AND (reversible<>0 OR status<>'recorded'))=0
      AND (${CLOSURE_AUDIT_COUNT_SQL} AND json_extract(details,'$.marker')=@retiredMarker)=@retired
      AND (${CLOSURE_AUDIT_COUNT_SQL})=@closures`,
    { ...ids, maxId: Number(manifest.families.actionHistoryMax), moveMarker: UNDO_CLOSED_BRANCH_CUTOVER_MOVE, retiredMarker: UNDO_CLOSED_BRANCH_RETIRED,
      children: row.committed_children, retired: manifest.history.close, closures: manifest.history.close + row.committed_children, operation: row.operation_id }),
    // Held (damaged-tagged) units are not in branch_stock / branch_batch_stock, so the child transfers never see them: they follow the
    // branch here, keeping their tag, quantity, cost, batch and return link. Only the owning branch changes.
    { sql: `UPDATE damaged_stock_lots SET branch_id=@target,updated_at=@now WHERE branch_id=@source AND quantity_remaining<>0`, params: { ...ids, now } },
    { sql: `UPDATE branches SET name=@retiredName,is_active=0,is_default=0,successor_branch_id=@target,updated_at=@now WHERE id=@source AND canonical_key='shop' AND is_active=1`,
      params: { ...ids, retiredName: intent.retiredName, now } },
    { sql: `UPDATE branches SET name=@successorName,is_active=1,is_default=1,role='shop',updated_at=@now WHERE id=@target AND canonical_key='warehouse' AND is_active=1`,
      params: { ...ids, successorName: intent.successorName, now } },
    { sql: `INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
        VALUES('branches',@entity,@operation,@label,0,'recorded','{}','{}',@actor,@actorName)`,
      params: { entity: BRANCH_CUTOVER_SUMMARY_ENTITY, operation: row.operation_id, label, actor: current.id, actorName: current.username ?? null } },
    { sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id) VALUES(@actor,@actorName,@action,@entity,@operation,@details,'branch_cutovers',@operation)`,
      params: { actor: current.id, actorName: current.username ?? null, action: BRANCH_CUTOVER_COMPLETED_AUDIT_ACTION, entity: BRANCH_CUTOVER_SUMMARY_ENTITY, operation: row.operation_id, details: terminalJson } },
    cutoverAssert(`(SELECT count(*) FROM branches WHERE is_active=1)=1
      AND NOT EXISTS(SELECT 1 FROM damaged_stock_lots WHERE branch_id=@source AND quantity_remaining<>0)
      AND EXISTS(SELECT 1 FROM branches WHERE id=@target AND is_active=1 AND is_default=1 AND role='shop' AND canonical_key='warehouse' AND name=@successorName AND successor_branch_id IS NULL)
      AND EXISTS(SELECT 1 FROM branches WHERE id=@source AND is_active=0 AND is_default=0 AND role='shop' AND canonical_key='shop' AND name=@retiredName AND successor_branch_id=@target)
      AND (SELECT count(*) FROM action_history WHERE entity=@entity AND entity_id=@operation)=1`,
    { ...ids, successorName: intent.successorName, retiredName: intent.retiredName, entity: BRANCH_CUTOVER_SUMMARY_ENTITY, operation: row.operation_id })]
  return commit(db, row, before, composed => completeBranchCutoverJournal(composed, proof(row), row.revision, terminalJson), saved => saved.phase === 'completed', () => ({ kind: 'completed' }))
}

export { CAPTURE_STREAMS }
export type { CaptureCursor }
