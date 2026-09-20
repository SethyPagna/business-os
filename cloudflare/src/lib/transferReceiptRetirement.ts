import type { D1Compat } from './db'
import { hasPermission, type PermissionUser } from './permissions'
import type { TransferRunOwnerProof } from './transferRunStore'

type Statement = { sql: string; params?: Record<string, unknown> }
type Proof = TransferRunOwnerProof & { user: PermissionUser & { id: number; organization_id: number | null } }
const receiptColumns = ['id','actor_id','request_id','request_digest','request_json','response_json','status','created_at','updated_at','operation_id','provenance_version','action_history_id','replay_state','generation'] as const
const identityColumns = ['id','actor_id','request_id','request_digest','request_json','response_json','status','created_at','operation_id','provenance_version','action_history_id'] as const
const memberColumns = ['receipt_id','ordinal','source_product_id','destination_product_id','source_branch_id','destination_branch_id','quantity','untracked_quantity','source_snapshot','destination_snapshot','allocations_json'] as const
/** Exact JSON from retirement views/tables, not parsed/reserialized backup rows.
 * Preserve SQLite REAL lexical representation and embedded historical strings. */
export type RetiredReceiptEvidence = { receiptJson: string; memberJsons: readonly string[] }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function authority(input: Proof): void {
  const { actual, expected, user } = input
  if (!uuid.test(input.datasetGeneration) || !Number.isSafeInteger(actual.actorId) || actual.actorId <= 0
    || (actual.organizationId !== null && (!Number.isSafeInteger(actual.organizationId) || actual.organizationId <= 0))
    || actual.actorId !== expected.actorId || actual.organizationId !== expected.organizationId
    || user.id !== actual.actorId || user.organization_id !== actual.organizationId || !hasPermission(user,'backup_restore')) {
    throw new Error('Trusted restore/reset authority and current owner required')
  }
}
function guard(sql: string, params: Record<string, unknown>): Statement {
  return { sql: `INSERT INTO branches(name) SELECT NULL WHERE COALESCE((${sql}),0)=0`, params }
}
function start(input: Proof, kind: 'retire'|'union'|'restore', token = crypto.randomUUID(), sourceId: string|null = null, sourceDigest: string|null = null): { statements: Statement[]; token: string } {
  authority(input)
  const params = { generation:input.datasetGeneration, kind, token, sourceId, sourceDigest }
  return { token, statements:[guard("(SELECT json_extract(value,'$.generation') FROM system_flags WHERE key='business_dataset_generation')=@generation",params),
    { sql:'INSERT INTO transfer_receipt_lifecycle_guard(id,token,generation,kind,source_id,source_digest) VALUES(1,@token,@generation,@kind,@sourceId,@sourceDigest)',params }] }
}
async function execute(db: Pick<D1Compat,'batchOnce'>, statements: Statement[], token: string, maxStatements: number): Promise<void> {
  statements.push({sql:'DELETE FROM transfer_receipt_lifecycle_guard WHERE id=1 AND token=@token',params:{token}})
  if (!Number.isSafeInteger(maxStatements) || maxStatements < statements.length) throw new Error('Receipt lifecycle statement budget exceeded')
  await db.batchOnce(statements)
}

/** Archives a bounded ID page, deriving every field from the database. No
 * business deletion or invented legacy owner organization. Caller must finish
 * every page under admission control before reset; delete triggers fail closed
 * on omissions. Atomic trusted adapter required. No public prefix API. */
export async function retireTransferReceiptPage(db: Pick<D1Compat,'batchOnce'>, input: Proof & {
  afterReceiptId: number; limit: number; maxStatements: number
}): Promise<void> {
  if (!Number.isSafeInteger(input.afterReceiptId) || input.afterReceiptId<0 || !Number.isSafeInteger(input.limit) || input.limit<1 || input.limit>20) throw new Error('Invalid receipt retirement page')
  const {statements,token}=start(input,'retire')
  const params={after:input.afterReceiptId,limit:input.limit}
  const page='SELECT id FROM transfer_operation_receipts WHERE id>@after ORDER BY id LIMIT @limit'
  statements.push({sql:`INSERT INTO transfer_retired_receipt_keys(actor_id,request_id,identity_json,operation_id,member_count)
    SELECT actor_id,request_id,identity_json,operation_id,(SELECT COUNT(*) FROM transfer_operation_members m WHERE m.receipt_id=p.id)
    FROM transfer_receipt_retirement_rows p WHERE id IN (${page})
    ON CONFLICT(actor_id,request_id) DO NOTHING`,params},
  guard(`NOT EXISTS(SELECT 1 FROM transfer_receipt_retirement_rows p JOIN transfer_retired_receipt_keys k
    ON k.actor_id=p.actor_id AND k.request_id=p.request_id WHERE p.id IN (${page}) AND
    (k.identity_json<>p.identity_json OR k.member_count<>(SELECT COUNT(*) FROM transfer_operation_members m WHERE m.receipt_id=p.id)))`,params),
  {sql:`INSERT INTO transfer_retired_receipt_snapshots(actor_id,request_id,snapshot_json)
    SELECT actor_id,request_id,snapshot_json FROM transfer_receipt_retirement_rows WHERE id IN (${page}) ON CONFLICT DO NOTHING`,params},
  {sql:`INSERT INTO transfer_retired_receipt_members(actor_id,request_id,ordinal,snapshot_json)
    SELECT actor_id,request_id,ordinal,snapshot_json FROM transfer_receipt_member_retirement_rows WHERE receipt_id IN (${page}) ON CONFLICT DO NOTHING`,params},
  guard(`NOT EXISTS(SELECT 1 FROM transfer_receipt_member_retirement_rows p JOIN transfer_retired_receipt_members k
    ON k.actor_id=p.actor_id AND k.request_id=p.request_id AND k.ordinal=p.ordinal WHERE p.receipt_id IN (${page}) AND k.snapshot_json<>p.snapshot_json)`,params))
  await execute(db,statements,token,input.maxStatements)
}

function exactObject(row: Record<string, unknown>, columns: readonly string[]): string {
  if (!row || Object.keys(row).length!==columns.length || columns.some(key=>!Object.hasOwn(row,key))) throw new Error('Exact historical columns required; unknown ownership cannot be invented')
  const text=JSON.stringify(Object.fromEntries(columns.map(key=>[key,row[key]])))
  if (new TextEncoder().encode(text).length>262144 || columns.some(key=>row[key]===undefined || (typeof row[key]==='number' && !Number.isFinite(row[key])))) throw new Error('Invalid or oversized historical row')
  return text
}
function evidence(value: RetiredReceiptEvidence): { receipt: string; identity: string; members: string[]; actor: unknown; request: unknown; operation: unknown; id: unknown } {
  const r=JSON.parse(value.receiptJson) as Record<string, unknown>
  exactObject(r,receiptColumns)
  const receipt=value.receiptJson
  if (!Number.isSafeInteger(r.id) || Number(r.id)<=0 || !Number.isSafeInteger(r.actor_id)
    || !Number.isSafeInteger(r.provenance_version) || Number(r.provenance_version)<0
    || !Number.isSafeInteger(r.generation) || Number(r.generation)<0
    || typeof r.request_id!=='string' || typeof r.request_digest!=='string' || typeof r.request_json!=='string'
    || typeof r.status!=='string' || typeof r.created_at!=='string' || typeof r.updated_at!=='string'
    || typeof r.replay_state!=='string' || !(r.response_json===null || typeof r.response_json==='string')
    || !(r.operation_id===null || typeof r.operation_id==='string')
    || !(r.action_history_id===null || Number.isSafeInteger(r.action_history_id)) || value.memberJsons.length>200) throw new Error('Invalid exact receipt evidence')
  const ordinals=new Set<unknown>()
  const members=value.memberJsons.map(text=>{
    const m=JSON.parse(text) as Record<string, unknown>
    exactObject(m,memberColumns)
    if(m.receipt_id!==r.id || !Number.isSafeInteger(m.ordinal) || Number(m.ordinal)<0 || ordinals.has(m.ordinal)
      || ['source_product_id','destination_product_id','source_branch_id','destination_branch_id'].some(k=>!Number.isSafeInteger(m[k]))
      || typeof m.quantity!=='number' || m.quantity<=0 || typeof m.untracked_quantity!=='number' || m.untracked_quantity<0 || m.untracked_quantity>m.quantity
      || ['source_snapshot','destination_snapshot','allocations_json'].some(k=>typeof m[k]!=='string')) throw new Error('Invalid historical member identity')
    JSON.parse(String(m.source_snapshot));JSON.parse(String(m.destination_snapshot))
    if(!Array.isArray(JSON.parse(String(m.allocations_json)))) throw new Error('Invalid historical allocations')
    ordinals.add(m.ordinal);return text
  })
  return {receipt,identity:JSON.stringify(Object.fromEntries(identityColumns.map(k=>[k,r[k]]))),members,actor:r.actor_id,request:r.request_id,operation:r.operation_id,id:r.id}
}
function boundedRecords(records: readonly RetiredReceiptEvidence[]): void {
  if(records.length>20) throw new Error('Receipt evidence page too large')
  let bytes=0,members=0
  for(const record of records) {
    members+=record.memberJsons.length
    if(members>200) throw new Error('Receipt evidence member page too large')
    for(const text of [record.receiptJson,...record.memberJsons]) {
      if(typeof text!=='string' || text.length>262144) throw new Error('Historical evidence exceeds byte limit')
      bytes+=new TextEncoder().encode(text).length
      if(bytes>1048576) throw new Error('Historical evidence exceeds byte limit')
    }
  }
}
function union(statements: Statement[], value: RetiredReceiptEvidence): ReturnType<typeof evidence> {
  const e=evidence(value),p={actor:e.actor,request:e.request,identity:e.identity,operation:e.operation,receipt:e.receipt,id:e.id,count:e.members.length}
  // Live parent requests can never be historical child/standalone receipts.
  statements.push(guard(`NOT EXISTS(SELECT 1 FROM transfer_runs WHERE actor_id=@actor AND request_id=@request)
    AND NOT EXISTS(SELECT 1 FROM transfer_run_chunks WHERE actor_id=@actor AND request_id=@request)
    AND NOT EXISTS(SELECT 1 FROM transfer_run_retired_keys WHERE actor_id=@actor AND request_id=@request AND sequence IS NULL)
    AND NOT EXISTS(SELECT 1 FROM transfer_receipt_retirement_rows WHERE
      (id=@id OR (operation_id IS NOT NULL AND operation_id=@operation) OR (actor_id=@actor AND request_id=@request)) AND
      (identity_json<>@identity OR (SELECT COUNT(*) FROM transfer_operation_members WHERE receipt_id=@id)<>@count))`,p),
    {sql:'INSERT INTO transfer_retired_receipt_keys(actor_id,request_id,identity_json,operation_id,member_count) VALUES(@actor,@request,@identity,@operation,@count) ON CONFLICT(actor_id,request_id) DO NOTHING',params:p},
    guard('EXISTS(SELECT 1 FROM transfer_retired_receipt_keys WHERE actor_id=@actor AND request_id=@request AND identity_json=@identity AND member_count=@count)',p),
    {sql:'INSERT INTO transfer_retired_receipt_snapshots(actor_id,request_id,snapshot_json) VALUES(@actor,@request,@receipt) ON CONFLICT DO NOTHING',params:p})
  for (const member of e.members) {
    const mp={...p,member}
    statements.push({sql:"INSERT INTO transfer_retired_receipt_members(actor_id,request_id,ordinal,snapshot_json) VALUES(@actor,@request,json_extract(@member,'$.ordinal'),@member) ON CONFLICT DO NOTHING",params:mp},
      guard("EXISTS(SELECT 1 FROM transfer_retired_receipt_members WHERE actor_id=@actor AND request_id=@request AND ordinal=json_extract(@member,'$.ordinal') AND snapshot_json=@member) AND NOT EXISTS(SELECT 1 FROM transfer_receipt_member_retirement_rows WHERE actor_id=@actor AND request_id=@request AND ordinal=json_extract(@member,'$.ordinal') AND snapshot_json<>@member)",mp))
  }
  statements.push(guard('(SELECT COUNT(*) FROM transfer_retired_receipt_members WHERE actor_id=@actor AND request_id=@request)=@count',p))
  return e
}
/** Union permanent identities/evidence from a validated immutable backup.
 * Exact duplicate is idempotent. Conflicts roll back the entire page. */
export async function unionRetiredTransferReceipts(db: Pick<D1Compat,'batchOnce'>, input: Proof & {
  records: readonly RetiredReceiptEvidence[]; maxStatements: number
}): Promise<void> {
  boundedRecords(input.records)
  const {statements,token}=start(input,'union')
  for(const record of input.records) union(statements,record)
  await execute(db,statements,token,input.maxStatements)
}

/** Historical INSERT only, never transfer execution. Caller MUST pin backup
 * source version/ETag+checksums before destructive restore, and retain failed
 * maintenance. This helper does not fetch/verify R2 or release maintenance.
 * Source descriptor/token come from trusted restore context, not request JSON.
 * All exact allowances exist only inside this one awaited batchOnce. */
export async function restoreRetiredTransferReceipts(db: Pick<D1Compat,'batchOnce'>, input: Proof & {
  records: readonly RetiredReceiptEvidence[]; maintenanceToken: string; sourceId: string; sourceDigest: string; maxStatements: number
}): Promise<void> {
  boundedRecords(input.records)
  if(!uuid.test(input.maintenanceToken) || !input.sourceId || !/^[a-f0-9]{64}$/.test(input.sourceDigest)) throw new Error('Pinned restore source required')
  const {statements,token}=start(input,'restore',input.maintenanceToken,input.sourceId,input.sourceDigest)
  statements.push(guard("EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore' AND json_extract(value,'$.token')=@token AND json_extract(value,'$.backupKey')=@source)",{token,source:input.sourceId}))
  for(const record of input.records) {
    const e=evidence(record),p={actor:e.actor,request:e.request,receipt:e.receipt,identity:e.identity,id:e.id,token,count:e.members.length}
    statements.push(guard('EXISTS(SELECT 1 FROM transfer_retired_receipt_keys WHERE actor_id=@actor AND request_id=@request AND identity_json=@identity AND member_count=@count) AND EXISTS(SELECT 1 FROM transfer_retired_receipt_snapshots WHERE actor_id=@actor AND request_id=@request AND snapshot_json=@receipt)',p),
      guard('NOT EXISTS(SELECT 1 FROM transfer_receipt_retirement_rows WHERE (id=@id OR (actor_id=@actor AND request_id=@request)) AND snapshot_json<>@receipt)',p),
      {sql:'INSERT INTO transfer_receipt_restore_allowance(actor_id,request_id,token,snapshot_json) VALUES(@actor,@request,@token,@receipt)',params:p},
      {sql:`INSERT INTO transfer_operation_receipts(${receiptColumns.join(',')}) SELECT ${receiptColumns.map(c=>`json_extract(@receipt,'$.${c}')`).join(',')} WHERE NOT EXISTS(SELECT 1 FROM transfer_operation_receipts WHERE id=@id)`,params:p})
    for(const member of e.members) {
      const mp={...p,member}
      statements.push(guard("EXISTS(SELECT 1 FROM transfer_retired_receipt_members WHERE actor_id=@actor AND request_id=@request AND ordinal=json_extract(@member,'$.ordinal') AND snapshot_json=@member)",mp),
        {sql:`INSERT INTO transfer_operation_members(${memberColumns.join(',')}) SELECT ${memberColumns.map(c=>`json_extract(@member,'$.${c}')`).join(',')} WHERE NOT EXISTS(SELECT 1 FROM transfer_operation_members WHERE receipt_id=@id AND ordinal=json_extract(@member,'$.ordinal'))`,params:mp},
        guard("EXISTS(SELECT 1 FROM transfer_receipt_member_retirement_rows WHERE receipt_id=@id AND ordinal=json_extract(@member,'$.ordinal') AND snapshot_json=@member)",mp))
    }
    statements.push(guard('(SELECT COUNT(*) FROM transfer_operation_members WHERE receipt_id=@id)=@count',p),
      {sql:'DELETE FROM transfer_receipt_restore_allowance WHERE actor_id=@actor AND request_id=@request AND token=@token',params:p})
  }
  await execute(db,statements,token,input.maxStatements)
}
