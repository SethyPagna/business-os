import type { D1Compat } from './db'
import type { SessionUser } from './auth'
import { getActionTier, hasPermission } from './permissions'
import { assertTransferStatementsFit, type TransferInvocationBudget } from './transferRunBudget'
import { beginBranchCutoverJournal, checkpointBranchCutoverJournal, finishBranchCutoverSnapshots, readBranchCutoverJournal,
  sealBranchCutoverManifest, type BranchCutoverJournalRow, type BranchCutoverOwnership } from './branchCutoverJournal'
import { BRANCH_SCALAR_REFERENCES, BranchCutoverCapabilityError, captureRegistryDigest, captureSchemaGuard, cutoverAssert,
  cutoverBytes, missingSnapshotGuards, parseCaptureCursor, readCutoverCapturePage, readCutoverCaptureSchema,
  readUnclassifiedCutoverFamilies, unclassifiedFamilyGuards, type CaptureSchema, type CutoverIdentity, type CutoverStatement } from './branchCutoverCapture'

type Principal = Pick<SessionUser, 'id' | 'organization_id' | 'is_active'>
type ParentIntent = CutoverIdentity & { action: 'retire'; parentVersion: 1; registryDigest: string; schemaDigest: string }
const actorSql = `SELECT u.id,u.username,u.name,u.organization_id,u.role_id,u.permissions,u.is_active,r.code AS role_code,r.permissions AS role_permissions
  FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=@actor AND u.deleted_at IS NULL`
const unsupportedStockSql = `SELECT
  EXISTS(SELECT 1 FROM damaged_stock_lots WHERE branch_id=@source AND quantity_remaining<>0) AS damaged,
  EXISTS(SELECT 1 FROM rfid_tags WHERE branch_id=@source AND status='active') AS rfid,
  EXISTS(SELECT 1 FROM branch_stock s LEFT JOIN products p ON p.id=s.product_id WHERE s.branch_id IN (@source,@target)
    AND (s.quantity IS NULL OR s.quantity<0 OR s.quantity<>0 AND (p.id IS NULL OR p.is_active IS NOT 1))) AS stock,
  EXISTS(SELECT 1 FROM branch_batch_stock s LEFT JOIN product_batches b ON b.id=s.batch_id LEFT JOIN products p ON p.id=b.variant_product_id
    WHERE s.branch_id IN (@source,@target) AND (s.quantity IS NULL OR s.quantity<0 OR s.quantity<>0 AND (b.id IS NULL OR b.is_active IS NOT 1 OR p.id IS NULL OR p.is_active IS NOT 1))) AS lots,
  EXISTS(SELECT 1 FROM branch_batch_stock s JOIN product_batches b ON b.id=s.batch_id WHERE s.branch_id IN (@source,@target)
    GROUP BY s.branch_id,b.variant_product_id HAVING sum(s.quantity)>coalesce((SELECT quantity FROM branch_stock WHERE branch_id=s.branch_id AND product_id=b.variant_product_id),0)) AS lotExcess`
async function stockCapabilities(db: D1Compat, identity: CutoverIdentity) {
  const counts = await db.prepare(unsupportedStockSql).get<Record<string, number>>({ source: identity.sourceBranchId, target: identity.targetBranchId })
  requireParent(counts)
  return Object.entries(counts).filter(([, count]) => count !== 0).map(([detail]) => ({ code: 'unsupported_stock_state', detail }))
}
function stockGuard(identity: CutoverIdentity): CutoverStatement {
  return cutoverAssert(`EXISTS(SELECT 1 FROM (${unsupportedStockSql}) WHERE damaged=0 AND rfid=0 AND stock=0 AND lots=0 AND lotExcess=0)`,
    { source: identity.sourceBranchId, target: identity.targetBranchId })
}
export class BranchCutoverParentOutcomeUnknown extends Error {
  readonly code = 'branch_cutover_parent_outcome_unknown'
  readonly outcome = 'unknown'
  constructor(cause: unknown) { super('Reconcile this same branch cutover operation before continuing.', { cause }) }
}
function requireParent(condition: unknown): asserts condition { if (!condition) throw new Error('branch_cutover_parent_conflict') }
function metered(db: D1Compat, budget: TransferInvocationBudget): D1Compat {
  requireParent(budget.extraAtomicStatements === 0)
  let attempts = 0; let batches = 0
  const chargeRead = () => { assertTransferStatementsFit({ ...budget, remainingReads: budget.remainingReads + attempts }, 2); attempts += 2 }
  return new Proxy(db, { get(target, key, receiver) {
    if (key === 'prepare') return (sql: string) => {
      const prepared = target.prepare(sql)
      return { get: async (params?: Record<string, unknown> | unknown[]) => { chargeRead(); return prepared.get(params) },
        all: async (params?: Record<string, unknown> | unknown[]) => { chargeRead(); return prepared.all(params) } }
    }
    if (key === 'batchOnce') return async (statements: CutoverStatement[]) => {
      requireParent(batches++ === 0)
      assertTransferStatementsFit({ ...budget, remainingReads: budget.remainingReads + attempts + 12 }, statements.length)
      requireParent(statements.every(s => cutoverBytes(s.sql) <= 100000) && statements.reduce((n, s) => n + cutoverBytes(s.sql) + cutoverBytes(JSON.stringify(s.params || {})), 0) <= 1048576)
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
async function branches(db: D1Compat, identity: CutoverIdentity): Promise<{ source: Record<string, unknown>; target: Record<string, unknown> }> {
  requireParent(Number.isSafeInteger(identity.sourceBranchId) && Number.isSafeInteger(identity.targetBranchId) && identity.sourceBranchId > 0
    && identity.targetBranchId > 0 && identity.sourceBranchId !== identity.targetBranchId)
  const rows = await db.prepare('SELECT * FROM branches WHERE id IN (@source,@target) ORDER BY id').all<Record<string, unknown>>({ source: identity.sourceBranchId, target: identity.targetBranchId })
  const source = rows.find(row => row.id === identity.sourceBranchId), target = rows.find(row => row.id === identity.targetBranchId)
  requireParent(source && target && source.is_active === 1 && target.is_active === 1
    && String(source.name).trim().toLowerCase() === 'shop' && String(target.name).trim().toLowerCase() === 'warehouse'
    && source.canonical_key === 'shop' && target.canonical_key === 'warehouse' && source.role === 'shop' && target.role === 'warehouse')
  requireParent(cutoverBytes(JSON.stringify(source)) <= 16384 && cutoverBytes(JSON.stringify(target)) <= 16384)
  return { source, target }
}
function proof(row: BranchCutoverJournalRow): BranchCutoverOwnership { return { operationId: row.operation_id, actorId: row.actor_id,
  organizationId: row.organization_id, controlIncarnation: row.control_incarnation, token: row.maintenance_token } }
function guardsFor(current: SessionUser, schema: CaptureSchema, state: { source: Record<string, unknown>; target: Record<string, unknown> }): CutoverStatement[] {
  const actorParams = { actor: current.id, organization: current.organization_id, role: current.role_id, permissions: current.permissions,
    roleCode: current.role_code ?? null, rolePermissions: current.role_permissions ?? null }
  const guards = [captureSchemaGuard(schema), cutoverAssert(`EXISTS(SELECT 1 FROM (${actorSql}) WHERE is_active=1 AND organization_id=@organization
    AND role_id IS @role AND permissions IS @permissions AND role_code IS @roleCode AND role_permissions IS @rolePermissions)`, actorParams)]
  for (const branch of [state.source, state.target]) {
    const params: Record<string, unknown> = {}; const conditions = Object.entries(branch).map(([key, value], index) => { params['v' + index] = value; return `"${key.replaceAll('"', '""')}" IS @v${index}` })
    guards.push(cutoverAssert(`EXISTS(SELECT 1 FROM branches WHERE ${conditions.join(' AND ')})`, params))
  }
  return guards
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
export async function inspectBranchCutover(db: D1Compat, actor: Principal, organizationId: number, identity: CutoverIdentity, budget: TransferInvocationBudget) {
  db = metered(db, budget); await principal(db, actor, organizationId)
  const state = await branches(db, identity); const schema = await readCutoverCaptureSchema(db)
  const unclassifiedFamilies = schema.capabilities.some(v => v.code === 'capture_table_required') ? [] : await readUnclassifiedCutoverFamilies(db)
  const stock = await db.prepare(`SELECT (SELECT count(*) FROM branch_stock WHERE branch_id=@source AND quantity<>0) AS nonzeroProducts,
    (SELECT count(*) FROM branch_batch_stock WHERE branch_id=@source AND quantity<>0) AS nonzeroLots,
    (SELECT count(*) FROM damaged_stock_lots WHERE branch_id=@source AND quantity_remaining<>0) AS damaged,
    (SELECT count(*) FROM rfid_tags WHERE branch_id=@source AND status='active') AS rfid`).get<Record<string, number>>({ source: identity.sourceBranchId })
  return { sourcePreimageJson: JSON.stringify(state.source), targetPreimageJson: JSON.stringify(state.target), schemaDigest: schema.digest,
    registryDigest: await captureRegistryDigest(), scalarReferences: BRANCH_SCALAR_REFERENCES, capabilities: [...schema.capabilities, ...await stockCapabilities(db, identity)],
    unclassifiedFamilies, stock, coverage: 'scalar-reference-capture', historicalReplayCertified: false, activationReady: false }
}
export async function beginBranchCutover(db: D1Compat, actor: Principal, organizationId: number,
  input: CutoverIdentity & { requestId: string; controlIncarnation: string; expectedSourceJson: string; expectedTargetJson: string; expectedSchemaDigest: string }, budget: TransferInvocationBudget) {
  db = metered(db, budget); const current = await principal(db, actor, organizationId); const state = await branches(db, input)
  const schema = await readCutoverCaptureSchema(db); requireSchema(schema)
  const unsupported = await stockCapabilities(db, input)
  if (unsupported.length) throw new BranchCutoverCapabilityError(unsupported.map(v => v.code + ':' + v.detail).join(';'))
  requireParent(schema.digest === input.expectedSchemaDigest && JSON.stringify(state.source) === input.expectedSourceJson && JSON.stringify(state.target) === input.expectedTargetJson)
  const intent: ParentIntent = { action: 'retire', parentVersion: 1, sourceBranchId: input.sourceBranchId, targetBranchId: input.targetBranchId,
    registryDigest: await captureRegistryDigest(), schemaDigest: schema.digest }
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
  const admission = cutoverAssert(`NOT EXISTS(SELECT 1 FROM import_jobs WHERE status IN ('pending','queued','running','analyzing','approved','applying','cancelling') OR julianday(lease_expires_at)>julianday('now'))
    AND NOT EXISTS(SELECT 1 FROM bulk_delete_jobs WHERE status IN ('pending','processing'))
    AND NOT EXISTS(SELECT 1 FROM shift_sessions WHERE closed_at IS NULL AND cancelled_at IS NULL)
    AND (SELECT count(*) FROM branches WHERE is_active=1 AND lower(trim(name)) IN ('shop','warehouse'))=2`)
  const final = cutoverAssert(`EXISTS(SELECT 1 FROM branch_cutovers WHERE operation_id=@operation AND begin_request_id=@request AND phase='capturing' AND revision=0 AND intent_json=@intent)`, { operation: operationId, request: input.requestId, intent: intentJson })
  try { return await beginBranchCutoverJournal(compose(db, [...guardsFor(current, schema, state), stockGuard(input), admission], [final]), begin) }
  catch (cause) {
    try { const row = await readBranchCutoverJournal(db, begin); requireParent(row.intent_json === intentJson && row.begin_request_id === input.requestId); return { row, replayed: true } } catch { }
    throw new BranchCutoverParentOutcomeUnknown(cause)
  }
}
export async function continueBranchCutover(db: D1Compat, actor: Principal, organizationId: number,
  input: { operationId: string; expectedRevision: number; pageSize?: number }, budget: TransferInvocationBudget) {
  db = metered(db, budget); const current = await principal(db, actor, organizationId)
  const stored = await db.prepare('SELECT * FROM branch_cutovers WHERE operation_id=@id').get<BranchCutoverJournalRow>({ id: input.operationId })
  requireParent(stored && stored.actor_id === current.id && stored.organization_id === String(organizationId))
  const row = await readBranchCutoverJournal(db, proof(stored)); const intent = JSON.parse(row.intent_json) as ParentIntent
  if (intent.parentVersion !== 1 || intent.action !== 'retire' || intent.sourceBranchId !== row.source_branch_id || intent.targetBranchId !== row.target_branch_id
    || Object.keys(intent).sort().join(',') !== 'action,parentVersion,registryDigest,schemaDigest,sourceBranchId,targetBranchId'
    || intent.registryDigest !== await captureRegistryDigest()) throw new BranchCutoverCapabilityError('parent_capture_contract_required')
  requireParent(Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 0)
  if (row.revision > input.expectedRevision) return { row, replayed: true }
  requireParent(row.revision === input.expectedRevision && ['capturing', 'snapshots'].includes(row.phase))
  const schema = await readCutoverCaptureSchema(db); requireSchema(schema); requireParent(schema.digest === intent.schemaDigest)
  const state = await branches(db, intent); requireParent(JSON.stringify(state.source) === row.source_preimage_json && JSON.stringify(state.target) === row.target_preimage_json)
  const stage = row.phase === 'capturing' ? 'capture' : 'snapshot'
  const cursor = parseCaptureCursor(row[`${stage}_cursor_json`]); const priorDigest = row[`${stage}_digest`]
  const page = await readCutoverCapturePage(db, schema, intent, cursor, priorDigest, input.pageSize ?? 8,
    { [intent.sourceBranchId]: String(state.source.name), [intent.targetBranchId]: String(state.target.name) }, stage === 'snapshot')
  const unsupported = await stockCapabilities(db, intent)
  if (unsupported.length) throw new BranchCutoverCapabilityError(unsupported.map(v => v.code + ':' + v.detail).join(';'))
  const before = [...guardsFor(current, schema, state), stockGuard(intent), ...page.statements]
  const final = cutoverAssert(`EXISTS(SELECT 1 FROM branch_cutovers WHERE operation_id=@operation AND revision=@revision+1)`, { operation: row.operation_id, revision: row.revision })
  let perform: (composed: D1Compat) => Promise<BranchCutoverJournalRow>
  if (page.records > 0) {
    perform = composed => checkpointBranchCutoverJournal(composed, proof(row), row.revision, { phase: row.phase as 'capturing' | 'snapshots',
      cursorJson: JSON.stringify(page.cursor), records: row[`${stage}_records`] + page.records, digest: page.digest })
  } else if (stage === 'capture') {
    const families = await readUnclassifiedCutoverFamilies(db)
    const manifest = { version: 2, sourceBranchId: intent.sourceBranchId, targetBranchId: intent.targetBranchId, capturedRecords: row.capture_records,
      movingProducts: cursor.movingProducts, sourceQuantityText: cursor.sourceQuantityText, sourceLotQuantityText: cursor.sourceLotQuantityText,
      anomalies: 0, captureDigest: row.capture_digest, coverage: { kind: 'scalar-reference-capture', registryDigest: intent.registryDigest,
        schemaDigest: intent.schemaDigest, scalarReferences: 32, unclassifiedFamilies: families, historicalReplayCertified: false } }
    perform = composed => sealBranchCutoverManifest(composed, proof(row), row.revision, JSON.stringify(manifest))
  } else {
    const manifest = JSON.parse(row.manifest_json || 'null')
    if (manifest?.version !== 2 || manifest.coverage?.kind !== 'scalar-reference-capture') throw new BranchCutoverCapabilityError('parent_manifest_v2_required')
    const families = await readUnclassifiedCutoverFamilies(db)
    if (families.length) throw new BranchCutoverCapabilityError('unclassified_historical_payloads:' + families.map(f => f.family + '=' + f.rows).join(','))
    requireParent(row.snapshot_digest === row.capture_digest && row.snapshot_records === row.capture_records)
    before.push(...missingSnapshotGuards(intent), ...unclassifiedFamilyGuards())
    if (manifest.movingProducts === 0) before.push(cutoverAssert(`NOT EXISTS(SELECT 1 FROM branch_stock WHERE branch_id=@source AND quantity<>0)
      AND NOT EXISTS(SELECT 1 FROM branch_batch_stock WHERE branch_id=@source AND quantity<>0)`, { source: intent.sourceBranchId }))
    perform = composed => finishBranchCutoverSnapshots(composed, proof(row), row.revision)
  }
  try { return { row: await perform(compose(db, before, [final])), replayed: false } }
  catch (cause) {
    try { const saved = await readBranchCutoverJournal(db, proof(row)); requireParent(saved.revision === row.revision + 1)
      if (page.records > 0) requireParent(saved[`${stage}_cursor_json`] === JSON.stringify(page.cursor) && saved[`${stage}_digest`] === page.digest)
      else requireParent(saved.phase !== row.phase)
      return { row: saved, replayed: true }
    } catch { }
    throw new BranchCutoverParentOutcomeUnknown(cause)
  }
}
