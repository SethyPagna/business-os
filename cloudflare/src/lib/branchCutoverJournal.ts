import type { BindParams, D1Compat } from './db'

type Phase = 'capturing' | 'snapshots' | 'moving' | 'verifying' | 'ready' | 'completed' | 'aborted'
export type BranchCutoverOwnership = {
  operationId: string
  actorId: number
  organizationId: string
  controlIncarnation: string
  token: string
}
export type BranchCutoverBegin = BranchCutoverOwnership & {
  beginRequestId: string
  sourceBranchId: number
  targetBranchId: number
  intentJson: string
  sourcePreimageJson: string
  targetPreimageJson: string
}
export type BranchCutoverJournalRow = {
  operation_id: string
  begin_request_id: string
  actor_id: number
  organization_id: string
  control_incarnation: string
  maintenance_token: string
  source_branch_id: number
  target_branch_id: number
  intent_json: string
  intent_digest: string
  source_preimage_json: string
  target_preimage_json: string
  maintenance_flag_json: string
  phase: Phase
  revision: number
  capture_cursor_json: string
  capture_records: number
  capture_digest: string
  snapshot_cursor_json: string
  snapshot_records: number
  snapshot_digest: string
  verification_cursor_json: string
  verification_records: number
  verification_digest: string
  manifest_json: string | null
  manifest_digest: string | null
  planned_child_json: string | null
  planned_child_key: string | null
  planned_child_digest: string | null
  next_sequence: number
  committed_children: number
  terminal_json: string | null
  created_at: string
  updated_at: string
}
type Statement = { sql: string; params?: BindParams }
const encoder = new TextEncoder()
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const digestPattern = /^[0-9a-f]{64}$/
const requestPattern = /^[A-Za-z0-9_-]{8,120}$/
const phases: Phase[] = ['capturing', 'snapshots', 'moving', 'verifying', 'ready', 'completed', 'aborted']
const emptyDigest = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const selectRow = 'SELECT * FROM branch_cutovers WHERE operation_id = @operationId'

function requireState(condition: unknown): asserts condition {
  if (!condition) throw new Error('branch_cutover_journal_conflict')
}
function integer(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum
}
function objectJson(text: string, limit: number): Record<string, unknown> {
  requireState(typeof text === 'string' && encoder.encode(text).length <= limit)
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('branch_cutover_journal_invalid_json') }
  requireState(value !== null && typeof value === 'object' && !Array.isArray(value))
  let nodes = 0
  const visit = (item: unknown, depth: number): void => {
    requireState(++nodes <= 4096 && depth <= 8)
    if (typeof item === 'number') requireState(Number.isFinite(item))
    if (Array.isArray(item)) requireState(item.length <= 200)
    if (item && typeof item === 'object') for (const entry of Object.values(item)) visit(entry, depth + 1)
  }
  visit(value, 0)
  return value as Record<string, unknown>
}
async function hash(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}
function validateOwnership(input: BranchCutoverOwnership): void {
  requireState(uuidPattern.test(input.operationId) && uuidPattern.test(input.token) && uuidPattern.test(input.controlIncarnation))
  requireState(integer(input.actorId, 1) && typeof input.organizationId === 'string' && input.organizationId.trim() === input.organizationId && input.organizationId.length > 0 && encoder.encode(input.organizationId).length <= 128)
}
function validateBegin(input: BranchCutoverBegin): void {
  validateOwnership(input)
  requireState(requestPattern.test(input.beginRequestId) && integer(input.sourceBranchId, 1) && integer(input.targetBranchId, 1) && input.sourceBranchId !== input.targetBranchId)
  const intent = objectJson(input.intentJson, 16384)
  requireState(intent.action === 'retire' && intent.sourceBranchId === input.sourceBranchId && intent.targetBranchId === input.targetBranchId)
  requireState(objectJson(input.sourcePreimageJson, 16384).id === input.sourceBranchId && objectJson(input.targetPreimageJson, 16384).id === input.targetBranchId)
}
function fromRow(row: BranchCutoverJournalRow): BranchCutoverBegin {
  return { operationId: row.operation_id, beginRequestId: row.begin_request_id, actorId: row.actor_id,
    organizationId: row.organization_id, controlIncarnation: row.control_incarnation, token: row.maintenance_token,
    sourceBranchId: row.source_branch_id, targetBranchId: row.target_branch_id, intentJson: row.intent_json,
    sourcePreimageJson: row.source_preimage_json, targetPreimageJson: row.target_preimage_json }
}
function flagFor(input: BranchCutoverBegin, intentDigest: string): Record<string, unknown> {
  return { mode: 'branch-cutover', operationId: input.operationId, token: input.token, actorId: input.actorId,
    organizationId: input.organizationId, controlIncarnation: input.controlIncarnation, beginRequestId: input.beginRequestId, intentDigest }
}
function terminal(row: BranchCutoverJournalRow): boolean { return row.phase === 'completed' || row.phase === 'aborted' }
function validateManifest(row: BranchCutoverJournalRow, text: string): Record<string, unknown> {
  const value = objectJson(text, 16384)
  const keys = ['version', 'sourceBranchId', 'targetBranchId', 'capturedRecords', 'movingProducts', 'sourceQuantityText', 'sourceLotQuantityText', 'anomalies', 'captureDigest']
  requireState(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)))
  requireState(value.version === 1 && value.sourceBranchId === row.source_branch_id && value.targetBranchId === row.target_branch_id)
  requireState(value.capturedRecords === row.capture_records && value.captureDigest === row.capture_digest && value.anomalies === 0)
  requireState(integer(value.movingProducts) && value.movingProducts <= row.capture_records)
  for (const key of ['sourceQuantityText', 'sourceLotQuantityText']) requireState(typeof value[key] === 'string' && /^(0|[1-9][0-9]{0,30})(\.[0-9]{1,12})?$/.test(value[key] as string))
  if (value.movingProducts === 0) requireState(value.sourceQuantityText === '0' && value.sourceLotQuantityText === '0')
  else requireState(value.sourceQuantityText !== '0' && Number(value.sourceQuantityText) > 0)
  return value
}
function validateChild(row: BranchCutoverJournalRow, text: string): void {
  const body = objectJson(text, 65536)
  requireState(body.operationId === row.operation_id && body.sequence === row.next_sequence && body.actorId === row.actor_id && body.organizationId === row.organization_id)
  requireState(body.controlIncarnation === row.control_incarnation && body.sourceBranchId === row.source_branch_id && body.targetBranchId === row.target_branch_id)
  requireState(body.transfer !== null && typeof body.transfer === 'object' && !Array.isArray(body.transfer))
  const transfer = body.transfer as Record<string, unknown>
  requireState(integer(transfer.productId, 1) && typeof transfer.quantity === 'number' && Number.isFinite(transfer.quantity) && transfer.quantity > 0)
}
async function validateRow(row: BranchCutoverJournalRow, proof: BranchCutoverOwnership): Promise<void> {
  validateOwnership(proof)
  const input = fromRow(row)
  validateBegin(input)
  requireState(proof.operationId === input.operationId && proof.actorId === input.actorId && proof.organizationId === input.organizationId && proof.controlIncarnation === input.controlIncarnation && proof.token === input.token)
  requireState(phases.includes(row.phase) && integer(row.revision) && integer(row.next_sequence) && row.committed_children === row.next_sequence)
  requireState(row.intent_digest === await hash(row.intent_json))
  const flag = objectJson(row.maintenance_flag_json, 4096)
  const expected = flagFor(input, row.intent_digest)
  requireState(Object.keys(flag).length === Object.keys(expected).length && Object.entries(expected).every(([key, value]) => flag[key] === value))
  for (const prefix of ['capture', 'snapshot', 'verification'] as const) {
    objectJson(row[`${prefix}_cursor_json`], 4096)
    requireState(integer(row[`${prefix}_records`]) && digestPattern.test(row[`${prefix}_digest`]))
  }
  requireState((row.manifest_json === null) === (row.manifest_digest === null))
  if (row.manifest_json !== null) { validateManifest(row, row.manifest_json); requireState(row.manifest_digest === await hash(row.manifest_json)) }
  requireState(row.phase === 'capturing' || row.phase === 'aborted' || row.manifest_json !== null)
  requireState((row.planned_child_json === null) === (row.planned_child_key === null) && (row.planned_child_json === null) === (row.planned_child_digest === null))
  if (row.planned_child_json !== null) {
    requireState(row.phase === 'moving'); validateChild(row, row.planned_child_json)
    requireState(row.planned_child_key === `bc_${row.operation_id}_${row.next_sequence}` && row.planned_child_digest === await hash(row.planned_child_json))
  }
  requireState(terminal(row) === (row.terminal_json !== null))
  if (row.terminal_json !== null) {
    const evidence = objectJson(row.terminal_json, 32768)
    requireState(evidence.version === 1 && evidence.kind === row.phase && evidence.operationId === row.operation_id)
  }
}
async function ownedRow(db: D1Compat, proof: BranchCutoverOwnership, revision?: number): Promise<BranchCutoverJournalRow> {
  validateOwnership(proof)
  const row = await db.prepare(selectRow).get<BranchCutoverJournalRow>({ operationId: proof.operationId })
  requireState(row)
  await validateRow(row, proof)
  if (revision !== undefined) requireState(integer(revision) && row.revision === revision && !terminal(row) && revision < Number.MAX_SAFE_INTEGER)
  if (!terminal(row)) {
    const flags = await db.prepare("SELECT key,value FROM system_flags WHERE key IN ('maintenance','branch_cutover_control_incarnation')").all<{ key: string; value: string }>()
    requireState(flags.find(flag => flag.key === 'maintenance')?.value === row.maintenance_flag_json && flags.find(flag => flag.key === 'branch_cutover_control_incarnation')?.value === row.control_incarnation)
  }
  return row
}
export async function readBranchCutoverJournal(db: D1Compat, proof: BranchCutoverOwnership): Promise<BranchCutoverJournalRow> {
  return ownedRow(db, proof)
}
async function commitJournalOnly(db: D1Compat, row: BranchCutoverJournalRow, assignments: string, values: Record<string, unknown>, clearOwnedFlag = false): Promise<BranchCutoverJournalRow> {
  const params = { ...values, operationId: row.operation_id, revision: row.revision, phase: row.phase, actorId: row.actor_id,
    organizationId: row.organization_id, token: row.maintenance_token, controlIncarnation: row.control_incarnation,
    flag: row.maintenance_flag_json, updatedAt: new Date().toISOString() }
  const statements: Statement[] = [{ sql: `SELECT CASE WHEN EXISTS (
    SELECT 1 FROM branch_cutovers WHERE operation_id=@operationId AND revision=@revision AND phase=@phase
    AND actor_id=@actorId AND organization_id=@organizationId AND maintenance_token=@token AND control_incarnation=@controlIncarnation
    ) AND EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND value=@flag)
    AND EXISTS (SELECT 1 FROM system_flags WHERE key='branch_cutover_control_incarnation' AND value=@controlIncarnation)
    THEN 1 ELSE json_extract('[1]', '$[branch_cutover_journal_conflict]') END`, params },
  { sql: `UPDATE branch_cutovers SET ${assignments},revision=revision+1,updated_at=@updatedAt WHERE operation_id=@operationId AND revision=@revision`, params }]
  if (clearOwnedFlag) statements.push({ sql: "DELETE FROM system_flags WHERE key='maintenance' AND value=@flag", params })
  statements.push({ sql: selectRow, params })
  const results = await db.batchOnce(statements)
  const result = results[results.length - 1]?.results?.[0] as BranchCutoverJournalRow | undefined
  requireState(result)
  return result
}
export async function beginBranchCutoverJournal(db: D1Compat, input: BranchCutoverBegin): Promise<{ row: BranchCutoverJournalRow; replayed: boolean }> {
  validateBegin(input)
  const existing = await db.prepare('SELECT * FROM branch_cutovers WHERE operation_id=@operationId OR begin_request_id=@beginRequestId').all<BranchCutoverJournalRow>(input)
  if (existing.length) {
    requireState(existing.length === 1)
    const row = existing[0]
    requireState(Object.entries(fromRow(row)).every(([key, value]) => input[key as keyof BranchCutoverBegin] === value))
    return { row: await ownedRow(db, input), replayed: true }
  }
  const intentDigest = await hash(input.intentJson)
  const flag = JSON.stringify(flagFor(input, intentDigest))
  const params = { ...input, intentDigest, flag, emptyDigest, now: new Date().toISOString() }
  const results = await db.batchOnce([
    { sql: `SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance')
      AND EXISTS (SELECT 1 FROM system_flags WHERE key='branch_cutover_control_incarnation' AND value=@controlIncarnation)
      THEN 1 ELSE json_extract('[1]', '$[branch_cutover_journal_conflict]') END`, params },
    { sql: "INSERT INTO system_flags(key,value,updated_at) VALUES('maintenance',@flag,@now)", params },
    { sql: `INSERT INTO branch_cutovers(operation_id,begin_request_id,actor_id,organization_id,control_incarnation,maintenance_token,
      source_branch_id,target_branch_id,intent_json,intent_digest,source_preimage_json,target_preimage_json,maintenance_flag_json,
      capture_digest,snapshot_digest,verification_digest,created_at,updated_at)
      VALUES(@operationId,@beginRequestId,@actorId,@organizationId,@controlIncarnation,@token,@sourceBranchId,@targetBranchId,
      @intentJson,@intentDigest,@sourcePreimageJson,@targetPreimageJson,@flag,@emptyDigest,@emptyDigest,@emptyDigest,@now,@now)`, params },
    { sql: selectRow, params },
  ])
  const row = results[3]?.results?.[0] as BranchCutoverJournalRow | undefined
  requireState(row)
  return { row, replayed: false }
}
export async function checkpointBranchCutoverJournal(db: D1Compat, proof: BranchCutoverOwnership, revision: number,
  checkpoint: { phase: 'capturing' | 'snapshots' | 'verifying'; cursorJson: string; records: number; digest: string }): Promise<BranchCutoverJournalRow> {
  objectJson(checkpoint.cursorJson, 4096)
  requireState(integer(checkpoint.records) && digestPattern.test(checkpoint.digest))
  const row = await ownedRow(db, proof, revision)
  requireState(row.phase === checkpoint.phase)
  const prefix = checkpoint.phase === 'capturing' ? 'capture' : checkpoint.phase === 'snapshots' ? 'snapshot' : checkpoint.phase === 'verifying' ? 'verification' : null
  requireState(prefix && checkpoint.records > row[`${prefix}_records`])
  return commitJournalOnly(db, row, `${prefix}_cursor_json=@cursorJson,${prefix}_records=@records,${prefix}_digest=@digest`, checkpoint)
}
export async function sealBranchCutoverManifest(db: D1Compat, proof: BranchCutoverOwnership, revision: number, manifestJson: string): Promise<BranchCutoverJournalRow> {
  const row = await ownedRow(db, proof, revision)
  requireState(row.phase === 'capturing' && row.manifest_json === null)
  validateManifest(row, manifestJson)
  return commitJournalOnly(db, row, "phase='snapshots',manifest_json=@manifestJson,manifest_digest=@manifestDigest", { manifestJson, manifestDigest: await hash(manifestJson) })
}
export async function finishBranchCutoverSnapshots(db: D1Compat, proof: BranchCutoverOwnership, revision: number): Promise<BranchCutoverJournalRow> {
  const row = await ownedRow(db, proof, revision)
  requireState(row.phase === 'snapshots' && row.manifest_json !== null)
  const manifest = validateManifest(row, row.manifest_json)
  return commitJournalOnly(db, row, 'phase=@nextPhase', { nextPhase: manifest.movingProducts === 0 ? 'verifying' : 'moving' })
}
export async function sealBranchCutoverChild(db: D1Compat, proof: BranchCutoverOwnership, revision: number, plannedChildJson: string): Promise<BranchCutoverJournalRow> {
  const row = await ownedRow(db, proof, revision)
  requireState(row.phase === 'moving' && row.planned_child_json === null)
  validateChild(row, plannedChildJson)
  const plannedChildKey = `bc_${row.operation_id}_${row.next_sequence}`
  requireState(requestPattern.test(plannedChildKey))
  return commitJournalOnly(db, row, 'planned_child_json=@plannedChildJson,planned_child_key=@plannedChildKey,planned_child_digest=@plannedChildDigest',
    { plannedChildJson, plannedChildKey, plannedChildDigest: await hash(plannedChildJson) })
}
export async function abortEffectFreeBranchCutoverJournal(db: D1Compat, proof: BranchCutoverOwnership, revision: number, reason: string): Promise<BranchCutoverJournalRow> {
  requireState(typeof reason === 'string' && reason.trim().length > 0 && encoder.encode(reason).length <= 1024)
  const row = await ownedRow(db, proof, revision)
  requireState(row.next_sequence === 0 && row.committed_children === 0 && row.planned_child_json === null && row.phase !== 'ready')
  const terminalJson = JSON.stringify({ version: 1, kind: 'aborted', operationId: row.operation_id, beginRequestId: row.begin_request_id,
    actorId: row.actor_id, organizationId: row.organization_id, controlIncarnation: row.control_incarnation, intentDigest: row.intent_digest,
    sourceBranchId: row.source_branch_id, targetBranchId: row.target_branch_id, previousPhase: row.phase, previousRevision: row.revision,
    manifestDigest: row.manifest_digest, captureRecords: row.capture_records, captureDigest: row.capture_digest,
    snapshotRecords: row.snapshot_records, snapshotDigest: row.snapshot_digest, verificationRecords: row.verification_records,
    verificationDigest: row.verification_digest, committedChildren: 0, reason, abortedAt: new Date().toISOString() })
  objectJson(terminalJson, 32768)
  return commitJournalOnly(db, row, "phase='aborted',terminal_json=@terminalJson", { terminalJson }, true)
}
