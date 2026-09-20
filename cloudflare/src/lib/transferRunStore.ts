import type { D1Compat } from './db'

type Statement = { sql: string; params?: Record<string, unknown> }
type Owner = { actorId: number; organizationId: number | null }
/** actual MUST come from authenticated server context, never request JSON.
 * Permission/session admission remains the future route's responsibility. */
export type TransferRunOwnerProof = { actual: Owner; expected: Owner }
type RunPosition = TransferRunOwnerProof & { runId: string; revision: number; sequence: number }
function owner(proof: TransferRunOwnerProof): Owner {
  const { actual, expected } = proof
  if (!Number.isSafeInteger(actual.actorId) || actual.actorId <= 0
    || (actual.organizationId !== null && (!Number.isSafeInteger(actual.organizationId) || actual.organizationId <= 0))
    || actual.actorId !== expected.actorId || actual.organizationId !== expected.organizationId) throw new Error('Transfer actor or organization changed')
  return actual
}
function position(input: RunPosition): Record<string, unknown> {
  const identity = owner(input)
  if (!input.runId || !Number.isSafeInteger(input.revision) || input.revision < 0
    || !Number.isSafeInteger(input.sequence) || input.sequence < 0) throw new Error('Invalid transfer position')
  return { run: input.runId, revision: input.revision, sequence: input.sequence, actor: identity.actorId, org: identity.organizationId }
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
  AND r.revision=@revision AND r.next_sequence=@sequence`

/** Registration is insert-only. On a uniqueness/race error the caller reads the
 * original receipt/run and compares BOTH original bytes and digest. Never retry
 * with a new key or delete a reservation. No stock is changed by registration. */
export function registerTransferRunStatements(input: TransferRunOwnerProof & {
  runId: string; requestId: string; requestJson: string; digest: string; scope: 'branches' | 'inventory'
}): Statement[] {
  const identity = owner(input)
  request(input, 131072)
  if (!input.runId || !['branches', 'inventory'].includes(input.scope)) throw new Error('Invalid transfer run')
  return [{ sql: `INSERT INTO transfer_runs(id,actor_id,organization_id,request_id,request_digest,request_json,scope)
    VALUES(@run,@actor,@org,@request,@digest,@body,@scope)`, params: { run: input.runId, actor: identity.actorId,
    org: identity.organizationId, request: input.requestId, digest: input.digest, body: input.requestJson, scope: input.scope } }]
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
 * on CAS/unique failure read it again, never replay effects under another key. */
export async function commitTransferRunChunk(db: D1Compat, input: RunPosition,
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
  await db.batch(statements)
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
      AND c.sequence=@sequence AND c.status='committed' AND p.status='committed'`)
    .get({ run: input.runId, actor: identity.actorId, org: identity.organizationId, sequence: input.sequence })
}
