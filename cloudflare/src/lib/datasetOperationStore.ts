/** Internal MAIN-D1 primitive, not a route or general SQL API. Server planners
 * supply effects, authenticated identity and pinned source metadata. No automatic
 * retries: an uncertain batch is recovered by reading its durable chunk receipt.
 * Pauses before principal-destructive phases; no detached execution authority.
 * Cross-DB/R2 work requires a separately reviewed intent/effect/ack coordinator. */
import { getMaintenance } from './maintenance'

type SqlValue = string | number | null | ArrayBuffer | Uint8Array
export type DatasetEffect = { sql: string; params?: SqlValue[]; maxChangedRows: number }
export type DatasetActor = { actorId: number; organizationId: number | null }
export type DatasetPosition = DatasetActor & { operationId: string; epoch: string; sequence: number; phase: string; cursor: unknown }
export type DatasetChunk = DatasetPosition & { nextPhase: string; nextCursor: unknown; final: boolean; effects: readonly DatasetEffect[] }
type Operation = { id: string; epoch: string; actor_id: number; organization_id: number | null; request_digest: string; phase: string; cursor_json: string; revision: number; status: string }
export class DatasetOperationConflict extends Error { statusCode = 409 }

function json(value: unknown, limit: number): string {
  const normalize = (item: unknown): unknown => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item
    if (typeof item === 'number' && Number.isFinite(item)) return item
    if (Array.isArray(item)) return item.map(normalize)
    if (item && typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) {
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize((item as Record<string, unknown>)[key])]))
    }
    throw new Error('Unsupported operation JSON value')
  }
  const encoded = JSON.stringify(normalize(value))
  if (new TextEncoder().encode(encoded).length > limit) throw new Error('Operation payload exceeds reserved budget')
  return encoded
}
async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('')
}
function text(value: string, max = 160): void {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max) throw new Error('Invalid operation identity')
}
function actor(input: DatasetActor): void {
  if (!Number.isSafeInteger(input.actorId) || input.actorId <= 0 || (input.organizationId !== null && (!Number.isSafeInteger(input.organizationId) || input.organizationId <= 0))) throw new Error('Invalid operation actor')
}
async function maintenanceSnapshot(db: D1Database): Promise<string> {
  const row = await db.prepare("SELECT value FROM system_flags WHERE key='maintenance'").first<{ value: string }>()
  // Reuse the authoritative full validator. It accesses DB only. The revision
  // binds that validated observation to raw SQL bytes, not merely its token.
  const state = await getMaintenance({ DB: db } as Parameters<typeof getMaintenance>[0])
  if (!row || !state?.token || await digest(row.value) !== state.revision) throw new DatasetOperationConflict('Valid current maintenance owner unavailable')
  return row.value
}
const live = `EXISTS(SELECT 1 FROM dataset_operation_current_principals p
 WHERE p.actor_id=o.actor_id AND p.organization_id IS o.organization_id AND p.principal_json=o.principal_json)
 AND NOT EXISTS(SELECT 1 FROM dataset_operation_invalidations i WHERE i.operation_id=o.id)
 AND EXISTS(SELECT 1 FROM system_flags m WHERE m.key='maintenance' AND m.value=? AND CASE WHEN json_valid(m.value)
 THEN json_extract(m.value,'$.mode')='restore' AND json_extract(m.value,'$.token')=o.maintenance_token ELSE 0 END)
 AND EXISTS(SELECT 1 FROM system_flags g WHERE g.key='business_dataset_generation' AND CASE WHEN json_valid(g.value)
 THEN json_extract(g.value,'$.generation')=o.dataset_generation ELSE 0 END)
 AND EXISTS(SELECT 1 FROM dataset_operation_head h WHERE h.id=1 AND h.operation_id=o.id AND h.epoch=o.epoch)`

export async function beginDatasetOperation(db: D1Database, input: DatasetActor & {
  requestId: string; kind: 'reset' | 'restore'; source: { key: string; version: string; sha256: string }; request: unknown;
  maintenanceToken: string; datasetGeneration: string; initialPhase: string
}): Promise<Operation> {
  input = { ...input, source: { ...input.source } }
  actor(input)
  for (const value of [input.requestId, input.maintenanceToken, input.datasetGeneration, input.initialPhase]) text(value)
  if (!['reset', 'restore'].includes(input.kind)) throw new Error('Invalid operation kind')
  for (const value of [input.source.key, input.source.version, input.source.sha256]) text(value, 2048)
  if (!/^[a-f0-9]{64}$/.test(input.source.sha256)) throw new Error('Pinned source digest required')
  const source = json(input.source, 8192), request = json(input.request, 65536)
  const requestDigest = await digest(json({ kind: input.kind, source: input.source, request: input.request, initialPhase: input.initialPhase }, 75000))
  const maintenance = await maintenanceSnapshot(db)
  const existing = await db.prepare(`SELECT o.id,o.epoch,o.actor_id,o.organization_id,o.request_digest,o.phase,o.cursor_json,o.revision,o.status
    FROM dataset_operations o WHERE o.actor_id=? AND o.request_id=?
    AND o.organization_id IS ? AND o.request_digest=? AND o.maintenance_token=? AND o.dataset_generation=? AND ${live}`)
    .bind(input.actorId, input.requestId, input.organizationId, requestDigest, input.maintenanceToken, input.datasetGeneration, maintenance).first<Operation>()
  if (existing) return existing
  const principal = await db.prepare('SELECT principal_json FROM dataset_operation_current_principals WHERE actor_id=? AND organization_id IS ?')
    .bind(input.actorId, input.organizationId).first<{ principal_json: string }>()
  if (!principal) throw new DatasetOperationConflict('Current operation principal unavailable')
  const id = crypto.randomUUID(), epoch = crypto.randomUUID()
  // CHECK(false) raises, unlike a zero-row UPDATE. The whole batch rolls back.
  const admission = `EXISTS(SELECT 1 FROM dataset_operation_current_principals p WHERE p.actor_id=? AND p.organization_id IS ? AND p.principal_json=?)
    AND EXISTS(SELECT 1 FROM system_flags m WHERE m.key='maintenance' AND m.value=? AND CASE WHEN json_valid(m.value) THEN json_extract(m.value,'$.token')=? AND json_extract(m.value,'$.mode')='restore' ELSE 0 END)
    AND EXISTS(SELECT 1 FROM system_flags g WHERE g.key='business_dataset_generation' AND CASE WHEN json_valid(g.value) THEN json_extract(g.value,'$.generation')=? ELSE 0 END)
    AND NOT EXISTS(SELECT 1 FROM dataset_operation_head h JOIN dataset_operations old ON old.id=h.operation_id WHERE old.status='active' AND old.maintenance_token=?)`
  await db.batch([
    db.prepare(`INSERT INTO dataset_operation_fence VALUES(1,CASE WHEN ${admission} THEN 1 ELSE 0 END,?,?,-1)`)
      .bind(input.actorId, input.organizationId, principal.principal_json, maintenance, input.maintenanceToken, input.datasetGeneration, input.maintenanceToken, id, epoch),
    db.prepare(`INSERT INTO dataset_operations(id,epoch,request_id,request_digest,actor_id,organization_id,principal_json,kind,source_json,request_json,dataset_generation,maintenance_token,phase,cursor_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'{}')`).bind(id, epoch, input.requestId, requestDigest, input.actorId, input.organizationId, principal.principal_json, input.kind, source, request, input.datasetGeneration, input.maintenanceToken, input.initialPhase),
    db.prepare('INSERT INTO dataset_operation_head VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET operation_id=excluded.operation_id,epoch=excluded.epoch').bind(id, epoch),
    db.prepare('DELETE FROM dataset_operation_fence WHERE id=1'),
  ])
  return { id, epoch, actor_id: input.actorId, organization_id: input.organizationId, request_digest: requestDigest, phase: input.initialPhase, cursor_json: '{}', revision: 0, status: 'active' }
}

/** All effects and direct-row changes() checks are in ONE awaited raw batch.
 * These checks do not bound scans, cascades, or trigger work; server planners
 * must separately bound those with indexed keyset plans and measured budgets.
 * Do not expose effects to client JSON, execute a prefix, or use D1 retries. */
export async function executeDatasetChunk(db: D1Database, input: DatasetChunk, maxStatements = 45): Promise<unknown> {
  input = { ...input }
  actor(input)
  for (const value of [input.operationId, input.epoch, input.phase, input.nextPhase]) text(value)
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0 || typeof input.final !== 'boolean') throw new Error('Invalid chunk position')
  if (!input.effects.length || input.effects.length > 18 || !Number.isSafeInteger(maxStatements) || maxStatements > 45 || input.effects.length * 2 + 5 > maxStatements) throw new Error('Chunk exceeds atomic statement budget')
  const before = json(input.cursor, 4096), after = json(input.nextCursor, 4096)
  const effects = input.effects.map(effect => {
    text(effect.sql, 32768)
    if (!/^\s*(INSERT|UPDATE|DELETE)\b/i.test(effect.sql) || /\b(dataset_operation\w*|system_flags|business_dataset_generations)\b/i.test(effect.sql) || /\bRETURNING\b/i.test(effect.sql)) throw new Error('Unapproved internal effect SQL')
    if (!Number.isSafeInteger(effect.maxChangedRows) || effect.maxChangedRows < 0 || effect.maxChangedRows > 500) throw new Error('Chunk row budget required')
    const params = (effect.params || []).map(value => value instanceof ArrayBuffer || value instanceof Uint8Array ? value.slice(0) : value)
    if (params.length > 100) throw new Error('D1 binding budget exceeded')
    const normalized = params.map(value => {
      if (value instanceof ArrayBuffer || value instanceof Uint8Array) return { bytes: Array.from(value instanceof Uint8Array ? value : new Uint8Array(value)) }
      if (value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
      throw new Error('Unsupported SQL binding')
    })
    return { sql: effect.sql, params, normalized, maxChangedRows: effect.maxChangedRows }
  })
  const planDigest = await digest(json({ epoch: input.epoch, sequence: input.sequence, phase: input.phase, before, nextPhase: input.nextPhase, after, final: input.final,
    effects: effects.map(({ sql, normalized, maxChangedRows }) => ({ sql, params: normalized, maxChangedRows })) }, 262144))
  const owned = `o.id=? AND o.epoch=? AND o.actor_id=? AND o.organization_id IS ? AND ${live}`
  const maintenance = await maintenanceSnapshot(db)
  const ownerParams = [input.operationId, input.epoch, input.actorId, input.organizationId, maintenance]
  const replay = await db.prepare(`SELECT c.plan_digest,c.response_json FROM dataset_operation_chunks c JOIN dataset_operations o ON o.id=c.operation_id
    WHERE ${owned} AND c.sequence=?`).bind(...ownerParams, input.sequence).first<{ plan_digest: string; response_json: string }>()
  if (replay) {
    if (replay.plan_digest !== planDigest) throw new DatasetOperationConflict('Chunk retry differs from recorded plan')
    return JSON.parse(replay.response_json)
  }
  const position = `${owned} AND o.status='active' AND o.revision=? AND o.phase=? AND o.cursor_json=?`
  const params = [...ownerParams, input.sequence, input.phase, before]
  const response = json({ operationId: input.operationId, epoch: input.epoch, sequence: input.sequence, phase: input.nextPhase, cursor: JSON.parse(after), status: input.final ? 'completed' : 'active' }, 16384)
  const batch = [db.prepare(`INSERT INTO dataset_operation_fence VALUES(1,CASE WHEN EXISTS(SELECT 1 FROM dataset_operations o WHERE ${position}) THEN 1 ELSE 0 END,?,?,?)`)
    .bind(...params, input.operationId, input.epoch, input.sequence)]
  for (const effect of effects) {
    batch.push(db.prepare(effect.sql).bind(...effect.params))
    batch.push(db.prepare('UPDATE dataset_operation_fence SET ok=CASE WHEN changes()<=? THEN 1 ELSE 0 END WHERE id=1').bind(effect.maxChangedRows))
  }
  // Effects cannot invalidate authority and then commit under an earlier read.
  batch.push(db.prepare(`UPDATE dataset_operation_fence SET ok=CASE WHEN EXISTS(SELECT 1 FROM dataset_operations o WHERE ${position}) THEN 1 ELSE 0 END WHERE id=1`).bind(...params))
  batch.push(db.prepare(`INSERT INTO dataset_operation_chunks VALUES(?,?,?,?,?,?,?,?,?)`).bind(input.operationId, input.sequence, planDigest, input.phase, before, input.nextPhase, after, input.final ? 1 : 0, response))
  batch.push(db.prepare(`UPDATE dataset_operations SET phase=?,cursor_json=?,revision=revision+1,status=? WHERE id=?`).bind(input.nextPhase, after, input.final ? 'completed' : 'active', input.operationId))
  batch.push(db.prepare('DELETE FROM dataset_operation_fence WHERE id=1'))
  await db.batch(batch)
  return JSON.parse(response)
}
