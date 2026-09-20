import type { D1Compat } from './db'
import { hasPermission, type PermissionUser } from './permissions'

type Statement = { sql: string; params?: Record<string, unknown> }
type Owner = { actorId: number; organizationId: number | null }
/** actual MUST come from authenticated server context, never request JSON.
 * Permission/session admission remains the future route's responsibility. */
export type TransferRunOwnerProof = { actual: Owner; expected: Owner; datasetGeneration: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type RunPosition = TransferRunOwnerProof & { runId: string; revision: number; sequence: number }
function owner(proof: TransferRunOwnerProof): Owner {
  const { actual, expected } = proof
  if (!uuid.test(proof.datasetGeneration)) throw new Error('A dataset generation is required')
  if (!Number.isSafeInteger(actual.actorId) || actual.actorId <= 0
    || (actual.organizationId !== null && (!Number.isSafeInteger(actual.organizationId) || actual.organizationId <= 0))
    || actual.actorId !== expected.actorId || actual.organizationId !== expected.organizationId) throw new Error('Transfer actor or organization changed')
  return actual
}
function position(input: RunPosition): Record<string, unknown> {
  const identity = owner(input)
  if (!input.runId || !Number.isSafeInteger(input.revision) || input.revision < 0
    || !Number.isSafeInteger(input.sequence) || input.sequence < 0) throw new Error('Invalid transfer position')
  return { run: input.runId, revision: input.revision, sequence: input.sequence, actor: identity.actorId, org: identity.organizationId, datasetGeneration: input.datasetGeneration }
}
function json(text: string, max: number): void {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > max) throw new Error('Transfer JSON exceeds limit')
  JSON.parse(text)
}
function request(input: { requestId: string; requestJson: string; digest: string }, max: number): void {
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(input.requestId) || !/^[a-f0-9]{64}$/.test(input.digest)) throw new Error('Invalid transfer request identity')
  json(input.requestJson, max)
}
// Existing NOT NULL assertion pattern; execution MUST be in one db.batch.
function guard(condition: string, params: Record<string, unknown>): Statement {
  return { sql: `INSERT INTO branches(name) SELECT NULL WHERE COALESCE((${condition}),0)=0`, params }
}
const ownedPosition = `r.id=@run AND r.actor_id=@actor AND r.organization_id IS @org
  AND r.revision=@revision AND r.next_sequence=@sequence AND r.dataset_generation=@datasetGeneration
  AND r.dataset_generation=(SELECT json_extract(value,'$.generation') FROM system_flags WHERE key='business_dataset_generation')`

/** Registration is insert-only. On a uniqueness/race error the caller reads the
 * original receipt/run and compares BOTH original bytes and digest. Never retry
 * with a new key or delete a reservation. No stock is changed by registration. */
export function registerTransferRunStatements(input: TransferRunOwnerProof & {
  runId: string; requestId: string; requestJson: string; digest: string; scope: 'branches' | 'inventory'
}): Statement[] {
  const identity = owner(input)
  request(input, 131072)
  if (!input.runId || !['branches', 'inventory'].includes(input.scope)) throw new Error('Invalid transfer run')
  return [{ sql: `INSERT INTO transfer_runs(id,actor_id,organization_id,request_id,request_digest,request_json,scope,dataset_generation)
    VALUES(@run,@actor,@org,@request,@digest,@body,@scope,@datasetGeneration)`, params: { run: input.runId, actor: identity.actorId,
    org: identity.organizationId, request: input.requestId, digest: input.digest, body: input.requestJson, scope: input.scope, datasetGeneration: input.datasetGeneration } }]
}

/** Caller supplies a server-generated child key and a validated planner fragment.
 * Future route must derive digest/cursors itself; this is not a wire admission API. */
export function sealTransferRunChunkStatements(input: RunPosition & {
  requestId: string; requestJson: string; digest: string; cursorBefore: string; cursorAfter: string; final: boolean
}): Statement[] {
  const params = position(input)
  request(input, 65536)
  json(input.cursorBefore, 4096); json(input.cursorAfter, 4096)
  if (typeof input.final !== 'boolean') throw new Error('Invalid final chunk flag')
  return [guard(`EXISTS(SELECT 1 FROM transfer_runs r WHERE ${ownedPosition} AND r.status='active')`, params),
    { sql: `INSERT INTO transfer_run_chunks(run_id,sequence,actor_id,request_id,request_digest,request_json,cursor_before,cursor_after,is_final)
      VALUES(@run,@sequence,@actor,@request,@digest,@body,@before,@after,@final)`,
    params: { ...params, request: input.requestId, digest: input.digest, body: input.requestJson,
      before: input.cursorBefore, after: input.cursorAfter, final: input.final ? 1 : 0 } }]
}

/** Execute the EXISTING transfer planner's receipt, stock, provenance and audit
 * SQL in ONE awaited batch. Do not execute transferStatements separately.
 * Their request must equal the sealed chunk (enforced by receipt/link triggers).
 * Caller supplies its remaining atomic-statement allowance after reserving all
 * handler reads/retries. No public statement-builder exposes a split prefix.
 * This is API-enforced batching, NOT a schema transaction-bound marker: arbitrary
 * direct SQL can persist an executing status. Do not expose status mutation.
 * Duplicate/lost-ack commit: read committedTransferRunChunk before planning;
 * on failure recover in a SUBSEQUENT request, never replay effects under another
 * key. No same-invocation batch retry or fallback to retrying batch() is allowed. */
export async function commitTransferRunChunk(db: Pick<D1Compat, 'batchOnce'>, input: RunPosition,
  transferStatements: readonly Statement[], maxAtomicStatements: number): Promise<void> {
  const params = position(input)
  if (!transferStatements.length) throw new Error('Transfer effects required')
  const statements: Statement[] = [guard(`EXISTS(SELECT 1 FROM transfer_runs r JOIN transfer_run_chunks c ON c.run_id=r.id
      AND c.sequence=r.next_sequence WHERE ${ownedPosition} AND r.status='active' AND c.status='planned')`, params),
    // An old route can know the exact child body/key. Its receipt must still
    // fail unless this marker was acquired INSIDE this same atomic batch.
    // No public API exposes marker acquisition as a separate operation.
    { sql: "UPDATE transfer_run_chunks SET status='executing' WHERE run_id=@run AND sequence=@sequence AND status='planned'", params },
    ...transferStatements,
    { sql: `UPDATE transfer_run_chunks SET status='committed',receipt_id=(SELECT p.id FROM transfer_operation_receipts p
        WHERE p.actor_id=transfer_run_chunks.actor_id AND p.request_id=transfer_run_chunks.request_id)
      WHERE run_id=@run AND sequence=@sequence AND status='executing'`, params },
    { sql: `UPDATE transfer_runs SET next_sequence=next_sequence+1,revision=revision+1,
        cursor_json=(SELECT cursor_after FROM transfer_run_chunks WHERE run_id=@run AND sequence=@sequence),
        status=CASE WHEN (SELECT is_final FROM transfer_run_chunks WHERE run_id=@run AND sequence=@sequence)=1 THEN 'completed' ELSE 'active' END,
        updated_at=CURRENT_TIMESTAMP WHERE id=@run`, params }]
  if (!Number.isSafeInteger(maxAtomicStatements) || maxAtomicStatements < statements.length) {
    throw new Error('Transfer atomic envelope exceeds reserved statement budget')
  }
  await db.batchOnce(statements)
}

export function transitionTransferRunStatements(input: RunPosition & { status: 'active' | 'paused' | 'abandoned' }): Statement[] {
  const params = position(input)
  if (!['active', 'paused', 'abandoned'].includes(input.status)) throw new Error('Invalid transfer status')
  return [guard(`EXISTS(SELECT 1 FROM transfer_runs r WHERE ${ownedPosition})`, params),
    { sql: 'UPDATE transfer_runs SET status=@status,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=@run',
      params: { ...params, status: input.status } }]
}

export async function committedTransferRunChunk(db: D1Compat, input: TransferRunOwnerProof & { runId: string; sequence: number }): Promise<{
  request_id: string; request_digest: string; request_json: string; response_json: string; receipt_id: number
} | undefined> {
  const identity = owner(input)
  if (!input.runId || !Number.isSafeInteger(input.sequence) || input.sequence < 0) throw new Error('Invalid transfer chunk')
  return db.prepare(`SELECT c.request_id,c.request_digest,c.request_json,p.response_json,p.id AS receipt_id
    FROM transfer_runs r JOIN transfer_run_chunks c ON c.run_id=r.id
    JOIN transfer_operation_receipts p ON p.id=c.receipt_id
    WHERE r.id=@run AND r.actor_id=@actor AND r.organization_id IS @org
      AND r.dataset_generation=@datasetGeneration
      AND r.dataset_generation=(SELECT json_extract(value,'$.generation') FROM system_flags WHERE key='business_dataset_generation')
      AND c.sequence=@sequence AND c.status='committed' AND p.status='committed'`)
    .get({ run: input.runId, actor: identity.actorId, org: identity.organizationId, sequence: input.sequence, datasetGeneration: input.datasetGeneration })
}

export async function readBusinessDatasetGeneration(db: Pick<D1Compat, 'prepare'>): Promise<string> {
  const row = await db.prepare("SELECT json_extract(value,'$.generation') AS generation FROM system_flags WHERE key='business_dataset_generation'").get<{ generation: string }>()
  if (!row || !uuid.test(row.generation)) throw new Error('Dataset generation is unavailable')
  return row.generation
}

export type RetiredTransferKey = {
  actorId: number; organizationId: number | null; requestId: string; runId: string; sequence: number | null
  datasetGeneration: string; digest: string; requestJson: string; snapshotJson: string
}
type LifecycleProof = TransferRunOwnerProof & {
  /** Trusted live authenticated user, never a client-provided permissions object. */
  user: PermissionUser & { id: number; organization_id: number | null }
}
function lifecycle(proof: LifecycleProof): Record<string, unknown> {
  const identity = owner(proof)
  if (proof.user.id !== identity.actorId || proof.user.organization_id !== identity.organizationId
    || !hasPermission(proof.user, 'backup_restore')) throw new Error('Restore/reset authority required')
  return { before: proof.datasetGeneration, token: crypto.randomUUID() }
}
function lifecycleStart(params: Record<string, unknown>): Statement[] {
  return [guard("(SELECT json_extract(value,'$.generation') FROM system_flags WHERE key='business_dataset_generation')=@before", params),
    { sql: 'INSERT INTO transfer_run_lifecycle_guard(id,token,kind,generation_before,generation_after) VALUES(1,@token,@kind,@before,@after)', params }]
}
function lifecycleEnd(params: Record<string, unknown>): Statement {
  return { sql: 'DELETE FROM transfer_run_lifecycle_guard WHERE id=1 AND token=@token', params }
}
async function executeLifecycle(db: Pick<D1Compat, 'batchOnce'>, statements: Statement[], maxStatements: number): Promise<void> {
  if (!Number.isSafeInteger(maxStatements) || maxStatements < statements.length) throw new Error('Lifecycle statement budget exceeded')
  await db.batchOnce(statements)
}

/** Private complete execution envelope. This retires only transfer continuation
 * state; it does NOT reset business data. Future reset integration must compose
 * its fixed, reviewed mutations inside this private executor, never export a
 * prefix. Restore integration must preserve/union retirement records and add an
 * exact historical-receipt import contract before applying the business backup.
 */
export async function retireTransferRunsForDatasetChange(db: Pick<D1Compat, 'batchOnce'>, input: LifecycleProof & {
  kind: 'restore' | 'reset'; nextGeneration: string; maxStatements: number
}): Promise<void> {
  const params = { ...lifecycle(input), after: input.nextGeneration, kind: input.kind }
  if (!['restore', 'reset'].includes(input.kind) || !uuid.test(input.nextGeneration) || input.nextGeneration === input.datasetGeneration) throw new Error('A fresh lifecycle generation is required')
  const statements = lifecycleStart(params)
  statements.push({ sql: `INSERT INTO transfer_run_retired_keys(actor_id,request_id,organization_id,run_id,sequence,dataset_generation,request_digest,request_json,snapshot_json)
    SELECT r.actor_id,r.request_id,r.organization_id,r.id,NULL,r.dataset_generation,r.request_digest,r.request_json,
      json_object('id',r.id,'actor_id',r.actor_id,'organization_id',r.organization_id,'request_id',r.request_id,
        'request_digest',r.request_digest,'request_json',r.request_json,'scope',r.scope,'status',r.status,
        'revision',r.revision,'next_sequence',r.next_sequence,'cursor_json',r.cursor_json,
        'created_at',r.created_at,'updated_at',r.updated_at,'dataset_generation',r.dataset_generation)
    FROM transfer_runs r` },
  { sql: `INSERT INTO transfer_run_retired_keys(actor_id,request_id,organization_id,run_id,sequence,dataset_generation,request_digest,request_json,snapshot_json)
    SELECT c.actor_id,c.request_id,r.organization_id,c.run_id,c.sequence,r.dataset_generation,c.request_digest,c.request_json,
      json_object('run_id',c.run_id,'sequence',c.sequence,'actor_id',c.actor_id,'request_id',c.request_id,
        'request_digest',c.request_digest,'request_json',c.request_json,'cursor_before',c.cursor_before,
        'cursor_after',c.cursor_after,'is_final',c.is_final,'status',c.status,'receipt_id',c.receipt_id,
        'receipt_response_json',p.response_json,'receipt_operation_id',p.operation_id,
        'receipt_action_history_id',p.action_history_id,'receipt_generation',p.generation,'receipt_replay_state',p.replay_state,
        'receipt',CASE WHEN p.id IS NULL THEN NULL ELSE json_object('id',p.id,'actor_id',p.actor_id,
          'request_id',p.request_id,'request_digest',p.request_digest,'request_json',p.request_json,
          'response_json',p.response_json,'status',p.status,'created_at',p.created_at,'updated_at',p.updated_at,
          'operation_id',p.operation_id,'provenance_version',p.provenance_version,
          'action_history_id',p.action_history_id,'replay_state',p.replay_state,'generation',p.generation) END)
    FROM transfer_run_chunks c JOIN transfer_runs r ON r.id=c.run_id LEFT JOIN transfer_operation_receipts p ON p.id=c.receipt_id` },
  { sql: 'DELETE FROM transfer_run_chunks' }, { sql: 'DELETE FROM transfer_runs' },
  { sql: "UPDATE system_flags SET value=json_object('generation',@after),updated_at=CURRENT_TIMESTAMP WHERE key='business_dataset_generation'", params },
  lifecycleEnd(params))
  await executeLifecycle(db, statements, input.maxStatements)
}

/** Bounded reservation union only, never restoration/reactivation of live runs.
 * Existing immutable evidence wins when exact identity matches; differing digest,
 * body, owner, source generation or run/sequence is a hard conflict, no overwrite.
 */
export async function unionRetiredTransferKeys(db: Pick<D1Compat, 'batchOnce'>, input: LifecycleProof & {
  keys: readonly RetiredTransferKey[]; maxStatements: number
}): Promise<void> {
  if (input.keys.length > 100) throw new Error('Retirement union page too large')
  const params = { ...lifecycle(input), after: input.datasetGeneration, kind: 'union' }
  const statements = lifecycleStart(params)
  for (const key of input.keys) {
    request({ requestId: key.requestId, requestJson: key.requestJson, digest: key.digest }, 131072)
    json(key.snapshotJson, 262144)
    if (!Number.isSafeInteger(key.actorId) || key.actorId <= 0 || !key.runId
      || (key.organizationId !== null && (!Number.isSafeInteger(key.organizationId) || key.organizationId <= 0))
      || (key.sequence !== null && (!Number.isSafeInteger(key.sequence) || key.sequence < 0))
      || (key.datasetGeneration !== '' && !uuid.test(key.datasetGeneration))) throw new Error('Invalid retired identity')
    const p = { actor: key.actorId, org: key.organizationId, request: key.requestId, run: key.runId, sequence: key.sequence,
      generation: key.datasetGeneration, digest: key.digest, body: key.requestJson, snapshot: key.snapshotJson }
    statements.push(guard(`NOT EXISTS(SELECT 1 FROM transfer_runs WHERE actor_id=@actor AND request_id=@request)
      AND NOT EXISTS(SELECT 1 FROM transfer_run_chunks WHERE actor_id=@actor AND request_id=@request)
      AND (NOT EXISTS(SELECT 1 FROM transfer_operation_receipts WHERE actor_id=@actor AND request_id=@request)
        OR EXISTS(SELECT 1 FROM transfer_run_retired_keys WHERE actor_id=@actor AND request_id=@request))`, p),
      { sql: `INSERT INTO transfer_run_retired_keys(actor_id,request_id,organization_id,run_id,sequence,dataset_generation,request_digest,request_json,snapshot_json)
        VALUES(@actor,@request,@org,@run,@sequence,@generation,@digest,@body,@snapshot) ON CONFLICT(actor_id,request_id) DO NOTHING`, params: p },
      guard(`EXISTS(SELECT 1 FROM transfer_run_retired_keys WHERE actor_id=@actor AND request_id=@request
        AND organization_id IS @org AND run_id=@run AND sequence IS @sequence AND dataset_generation=@generation
        AND request_digest=@digest AND request_json=@body)`, p))
  }
  statements.push(lifecycleEnd(params))
  await executeLifecycle(db, statements, input.maxStatements)
}
