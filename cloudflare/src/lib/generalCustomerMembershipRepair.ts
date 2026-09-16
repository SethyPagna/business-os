import type { Env } from '../index'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersion, getVersionWithFallback } from './cache'
import type { D1Compat } from './db'

/**
 * The anonymous marker repair (v1) deliberately remains immutable. This is a
 * second, narrowly scoped operation for the legacy membership value that was
 * found on the already-marked shared General customer.
 */
export const GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_STEP = 'clear_shared_general_membership_24969' as const
export const GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_CONFIRMATION = 'CLEAR MEMBERSHIP 24969 SHARED GENERAL' as const
export const GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_OPERATION_KEY = 'f72:shared-general-membership:24969:v1' as const
export const GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_TARGET_ID = 24969 as const
export const GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_PROTECTED_ID = 22305 as const
export const GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_EXPECTED_MEMBERSHIP = 'LC-04971' as const

const SCHEMA_VERSION = 1
const HISTORY_ENTITY = 'customer_anonymous_repair'
const HISTORY_LABEL = 'Clear legacy membership from shared General customer'
const AUDIT_ACTION = 'clear_shared_general_membership'
const REQUEST_KEYS = Object.freeze(['step', 'confirmation', 'manifest_sha256', 'expected_updated_at'])

type Actor = { id?: unknown; name?: unknown }
type Statement = { sql: string; params?: Record<string, unknown> }
type Target = {
  id: typeof GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_TARGET_ID
  name: string
  phone_empty: boolean
  membership: string
  is_anonymous: number
  updated_at: string | null
  sale_count: number
  return_count: number
  portal_account_count: number
  protected_is_anonymous: number
}
type Manifest = { schema_version: 1; operation_key: typeof GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_OPERATION_KEY; target: Target }
type Receipt = {
  schema_version: 1
  operation_key: typeof GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_OPERATION_KEY
  customer_id: typeof GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_TARGET_ID
  manifest_sha256: string
  expected_updated_at: string | null
  mutation_stamp: string
}

export type GeneralCustomerMembershipRepairRequest = {
  step: typeof GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_STEP
  confirmation: typeof GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_CONFIRMATION
  manifest_sha256: string
  expected_updated_at: string | null
}

export type PreparedGeneralCustomerMembershipRepair = {
  outcome: 'apply' | 'already_applied'
  request: GeneralCustomerMembershipRepairRequest
  manifest: Manifest
  mutationStamp: string | null
  statements: Statement[]
  updateStatementIndex: number | null
  historyStatementIndex: number | null
}

export class GeneralCustomerMembershipRepairValidationError extends Error {}
export class GeneralCustomerMembershipRepairConflictError extends Error {}

function validation(message: string): never { throw new GeneralCustomerMembershipRepairValidationError(message) }
function conflict(message = 'The shared General customer changed after preview. No data was changed.'): never {
  throw new GeneralCustomerMembershipRepairConflictError(message)
}

function actorIdentity(actor: Actor): { id: number; name: string } {
  if (!Number.isSafeInteger(actor.id) || Number(actor.id) < 1) validation('authenticated actor id is required')
  if (typeof actor.name !== 'string' || !actor.name.trim() || actor.name.length > 120) validation('authenticated actor username is required')
  return { id: Number(actor.id), name: actor.name }
}

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) validation(`${label} must be an object`)
  const object = value as Record<string, unknown>
  const actual = Object.keys(object).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    validation(`${label} must contain exactly: ${keys.join(', ')}`)
  }
  return object
}

function requestOf(value: unknown): GeneralCustomerMembershipRepairRequest {
  const request = exactObject(value, REQUEST_KEYS, 'request')
  if (request.step !== GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_STEP) validation(`request.step must be ${GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_STEP}`)
  if (request.confirmation !== GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_CONFIRMATION) validation(`request.confirmation must be ${GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_CONFIRMATION}`)
  if (typeof request.manifest_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(request.manifest_sha256)) validation('request.manifest_sha256 must be a lowercase SHA-256 digest')
  if (!(request.expected_updated_at === null || (typeof request.expected_updated_at === 'string' && request.expected_updated_at.length <= 40))) validation('request.expected_updated_at must be the exact preview value')
  return request as GeneralCustomerMembershipRepairRequest
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function readManifest(db: Pick<D1Compat, 'prepare'>): Promise<Manifest> {
  const row = await db.prepare(`SELECT id,name,phone,membership_number,is_anonymous,updated_at FROM customers WHERE id=${GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_TARGET_ID}`).get<{
    id?: unknown; name?: unknown; phone?: unknown; membership_number?: unknown; is_anonymous?: unknown; updated_at?: unknown
  }>()
  const protectedRow = await db.prepare(`SELECT id,is_anonymous FROM customers WHERE id=${GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_PROTECTED_ID}`).get<{ id?: unknown; is_anonymous?: unknown }>()
  if (!row || Number(row.id) !== GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_TARGET_ID) conflict('Customer 24969 does not exist. No data was changed.')
  if (!protectedRow || Number(protectedRow.id) !== GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_PROTECTED_ID || Number(protectedRow.is_anonymous ?? 0) !== 0) conflict('Protected customer 22305 is not unchanged. No data was changed.')
  const [sales, returns, portal] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count FROM sales WHERE customer_id=${GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_TARGET_ID}`).get<{ count: number }>(),
    db.prepare(`SELECT COUNT(*) AS count FROM returns WHERE customer_id=${GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_TARGET_ID}`).get<{ count: number }>(),
    db.prepare(`SELECT COUNT(*) AS count FROM portal_accounts WHERE contact_id=${GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_TARGET_ID}`).get<{ count: number }>(),
  ])
  const target: Target = {
    id: GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_TARGET_ID,
    // Preserve the exact stored values in the manifest.  The SQL guards below
    // intentionally enforce the owner-confirmed lowercase name and exact
    // legacy membership; normalising here could make a preview digest differ
    // from the row that the guarded UPDATE will actually match.
    name: String(row.name ?? ''),
    phone_empty: String(row.phone ?? '').trim() === '',
    membership: String(row.membership_number ?? ''),
    is_anonymous: Number(row.is_anonymous ?? 0),
    updated_at: row.updated_at == null ? null : String(row.updated_at),
    sale_count: Number(sales?.count ?? 0),
    return_count: Number(returns?.count ?? 0),
    portal_account_count: Number(portal?.count ?? 0),
    protected_is_anonymous: 0,
  }
  return { schema_version: SCHEMA_VERSION, operation_key: GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_OPERATION_KEY, target }
}

function assertTarget(manifest: Manifest): void {
  const target = manifest.target
  if (target.id !== GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_TARGET_ID || target.name !== 'general' || !target.phone_empty
    || target.membership !== GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_EXPECTED_MEMBERSHIP || target.is_anonymous !== 1
    || target.portal_account_count !== 0 || target.protected_is_anonymous !== 0) {
    conflict('Customer 24969 is not the owner-confirmed anonymous shared General record with the expected legacy membership. No data was changed.')
  }
}

async function digest(manifest: Manifest): Promise<string> { return sha256(JSON.stringify(manifest)) }

async function readMaintenance(db: Pick<D1Compat, 'prepare'>): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS active FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore'").get<{ active?: unknown }>()
  return Boolean(row)
}

function parseReceipt(raw: unknown): Receipt | null {
  try {
    const value = JSON.parse(String(raw || '')) as Receipt
    if (value.schema_version !== 1 || value.operation_key !== GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_OPERATION_KEY
      || value.customer_id !== GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_TARGET_ID || !/^[a-f0-9]{64}$/.test(value.manifest_sha256)
      || !(value.expected_updated_at === null || typeof value.expected_updated_at === 'string')
      || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value.mutation_stamp)) return null
    return value
  } catch { return null }
}

const AUDIT_DETAILS = Object.freeze({
  operation_key: GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_OPERATION_KEY,
  customer_id: GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_TARGET_ID,
  decision: 'owner_confirmed_shared_general_no_membership',
  changed_field: 'membership_number',
  before: GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_EXPECTED_MEMBERSHIP,
  after: null,
  preserved_anonymous_marker: true,
  preserved_links: true,
})

async function receiptState(db: Pick<D1Compat, 'prepare'>) {
  const histories = await db.prepare(`SELECT id,scope,label,undo_payload,redo_payload,created_by_id,created_by_name,created_at,updated_at FROM action_history WHERE entity=@entity AND entity_id=@operation AND reversible=0 AND status='recorded' ORDER BY id`).all<Record<string, unknown>>({ entity: HISTORY_ENTITY, operation: GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_OPERATION_KEY })
  const audits = await db.prepare(`SELECT id,user_id,user_name,details,table_name,record_id,old_value,new_value,created_at FROM audit_logs WHERE action=@action AND entity='customer' AND entity_id=@customer ORDER BY id`).all<Record<string, unknown>>({ action: AUDIT_ACTION, customer: String(GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_TARGET_ID) })
  return { histories, audits }
}

function exactHistory(row: Record<string, unknown> | undefined, receipt: Receipt): boolean {
  return Boolean(row) && row?.scope === 'global' && row?.label === HISTORY_LABEL && row?.undo_payload === '{}'
    && row?.created_at === receipt.mutation_stamp && row?.updated_at === receipt.mutation_stamp
    && Number(row?.created_by_id) >= 1 && typeof row?.created_by_name === 'string' && Boolean(String(row?.created_by_name).trim())
}

function exactAudit(row: Record<string, unknown> | undefined, history: Record<string, unknown> | undefined, receipt: Receipt): boolean {
  if (!row || !history) return false
  try {
    return JSON.stringify(JSON.parse(String(row.details || ''))) === JSON.stringify(AUDIT_DETAILS)
      && Number(row.user_id) === Number(history.created_by_id) && row.user_name === history.created_by_name
      && row.table_name === 'customers' && row.record_id === String(GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_TARGET_ID)
      && String(row.old_value || '') === JSON.stringify({ membership_number: GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_EXPECTED_MEMBERSHIP })
      && String(row.new_value || '') === JSON.stringify({ membership_number: null }) && row.created_at === receipt.mutation_stamp
  } catch { return false }
}

async function classifyAlreadyApplied(db: Pick<D1Compat, 'prepare'>, current: Manifest, request?: GeneralCustomerMembershipRepairRequest) {
  const receipts = await receiptState(db)
  if (receipts.histories.length !== 1 || receipts.audits.length !== 1) return null
  const stored = parseReceipt(receipts.histories[0]?.redo_payload)
  if (!stored || !exactHistory(receipts.histories[0], stored) || !exactAudit(receipts.audits[0], receipts.histories[0], stored)) return null
  if (current.target.membership !== '' || current.target.is_anonymous !== 1 || current.target.updated_at !== stored.mutation_stamp) return null
  const original: Manifest = { ...current, target: { ...current.target, membership: GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_EXPECTED_MEMBERSHIP, updated_at: stored.expected_updated_at } }
  const manifestSha = await digest(original)
  if (manifestSha !== stored.manifest_sha256) return null
  const replayRequest = { step: GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_STEP, confirmation: GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_CONFIRMATION, manifest_sha256: manifestSha, expected_updated_at: stored.expected_updated_at } satisfies GeneralCustomerMembershipRepairRequest
  if (request && (request.manifest_sha256 !== replayRequest.manifest_sha256 || request.expected_updated_at !== replayRequest.expected_updated_at)) return null
  return { request: replayRequest, manifest: original }
}

export async function previewGeneralCustomerMembershipRepair(db: Pick<D1Compat, 'prepare'>, actor: Actor) {
  actorIdentity(actor)
  if (await readMaintenance(db)) conflict('A restore is in progress. Try again after maintenance finishes.')
  const manifest = await readManifest(db)
  const receipts = await receiptState(db)
  if (manifest.target.membership === '') {
    const replay = await classifyAlreadyApplied(db, manifest)
    if (!replay) conflict('Customer 24969 has no membership but lacks the exact repair receipt. No data was changed.')
    return { success: true as const, outcome: 'already_applied' as const, request: replay.request, target: { id: 24969, name: 'general' as const, membership_state: 'known_empty' as const, is_anonymous: 1 as const, sale_count: manifest.target.sale_count, return_count: manifest.target.return_count }, protected_customer: { id: 22305, is_anonymous: 0 as const } }
  }
  if (receipts.histories.length || receipts.audits.length) conflict('A conflicting shared General membership receipt exists. No data was changed.')
  assertTarget(manifest)
  const request = { step: GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_STEP, confirmation: GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_CONFIRMATION, manifest_sha256: await digest(manifest), expected_updated_at: manifest.target.updated_at } satisfies GeneralCustomerMembershipRepairRequest
  return { success: true as const, outcome: 'ready' as const, request, target: { id: 24969, name: 'general' as const, membership_state: 'legacy_value_present' as const, is_anonymous: 1 as const, sale_count: manifest.target.sale_count, return_count: manifest.target.return_count }, protected_customer: { id: 22305, is_anonymous: 0 as const } }
}

function params(manifest: Manifest, request: GeneralCustomerMembershipRepairRequest, actor: { id: number; name: string }, stamp: string) {
  return {
    expected_name: manifest.target.name, expected_phone: '', expected_membership: manifest.target.membership,
    expected_anonymous: 1, expected_updated_at: manifest.target.updated_at, actor_id: actor.id, actor_name: actor.name,
    mutation_stamp: stamp, history_entity: HISTORY_ENTITY, history_label: HISTORY_LABEL, operation: GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_OPERATION_KEY,
    audit_action: AUDIT_ACTION, customer_id_text: String(GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_TARGET_ID),
    audit_details: JSON.stringify(AUDIT_DETAILS), audit_old: JSON.stringify({ membership_number: GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_EXPECTED_MEMBERSHIP }), audit_new: JSON.stringify({ membership_number: null }),
    receipt: JSON.stringify({ schema_version: SCHEMA_VERSION, operation_key: GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_OPERATION_KEY, customer_id: GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_TARGET_ID, manifest_sha256: request.manifest_sha256, expected_updated_at: request.expected_updated_at, mutation_stamp: stamp } satisfies Receipt),
  }
}

function beforeGuard(): string {
  return `NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
    AND NOT EXISTS(SELECT 1 FROM portal_accounts WHERE contact_id=${GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_TARGET_ID})
    AND EXISTS(SELECT 1 FROM customers WHERE id=${GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_TARGET_ID} AND lower(trim(name))=@expected_name AND trim(COALESCE(phone,''))=@expected_phone AND membership_number=@expected_membership AND is_anonymous=@expected_anonymous AND updated_at IS @expected_updated_at)
    AND EXISTS(SELECT 1 FROM customers WHERE id=${GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_PROTECTED_ID} AND COALESCE(is_anonymous,0)=0)
    AND (SELECT COUNT(*) FROM action_history WHERE entity=@history_entity AND entity_id=@operation)=0
    AND (SELECT COUNT(*) FROM audit_logs WHERE action=@audit_action AND entity='customer' AND entity_id=@customer_id_text)=0`
}

function afterGuard(): string {
  return `NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
    AND NOT EXISTS(SELECT 1 FROM portal_accounts WHERE contact_id=${GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_TARGET_ID})
    AND EXISTS(SELECT 1 FROM customers WHERE id=${GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_TARGET_ID} AND lower(trim(name))='general' AND trim(COALESCE(phone,''))='' AND membership_number IS NULL AND is_anonymous=1 AND updated_at=@mutation_stamp)
    AND EXISTS(SELECT 1 FROM customers WHERE id=${GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_PROTECTED_ID} AND COALESCE(is_anonymous,0)=0)
    AND (SELECT COUNT(*) FROM action_history WHERE entity=@history_entity AND entity_id=@operation AND reversible=0 AND status='recorded' AND scope='global' AND label=@history_label AND undo_payload='{}' AND redo_payload=@receipt AND created_by_id=@actor_id AND created_by_name=@actor_name AND created_at=@mutation_stamp AND updated_at=@mutation_stamp)=1
    AND (SELECT COUNT(*) FROM action_history WHERE entity=@history_entity AND entity_id=@operation)=1
    AND (SELECT COUNT(*) FROM audit_logs WHERE action=@audit_action AND entity='customer' AND entity_id=@customer_id_text AND user_id=@actor_id AND user_name=@actor_name AND details=@audit_details AND table_name='customers' AND record_id=@customer_id_text AND old_value=@audit_old AND new_value=@audit_new AND created_at=@mutation_stamp)=1
    AND (SELECT COUNT(*) FROM audit_logs WHERE action=@audit_action AND entity='customer' AND entity_id=@customer_id_text)=1`
}

export async function prepareGeneralCustomerMembershipRepair(db: Pick<D1Compat, 'prepare'>, rawRequest: unknown, rawActor: Actor): Promise<PreparedGeneralCustomerMembershipRepair> {
  const request = requestOf(rawRequest)
  const actor = actorIdentity(rawActor)
  if (await readMaintenance(db)) conflict('A restore is in progress. Try again after maintenance finishes.')
  const manifest = await readManifest(db)
  if (manifest.target.membership === '') {
    const replay = await classifyAlreadyApplied(db, manifest, request)
    if (!replay) conflict('Customer 24969 has already changed without this exact repair receipt. No data was changed.')
    return { outcome: 'already_applied', request, manifest: replay.manifest, mutationStamp: null, statements: [], updateStatementIndex: null, historyStatementIndex: null }
  }
  const receipts = await receiptState(db)
  if (receipts.histories.length || receipts.audits.length) conflict('A conflicting shared General membership receipt exists. No data was changed.')
  assertTarget(manifest)
  if (manifest.target.updated_at !== request.expected_updated_at || await digest(manifest) !== request.manifest_sha256) conflict()
  const mutationStamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const p = params(manifest, request, actor, mutationStamp)
  const assertion = (predicate: string): Statement => ({ sql: `SELECT CASE WHEN (${predicate}) THEN 1 ELSE json_extract('general_customer_membership_repair_conflict','$') END AS guard`, params: p })
  const statements: Statement[] = [
    assertion(beforeGuard()),
    { sql: `UPDATE customers SET membership_number=NULL,updated_at=@mutation_stamp WHERE id=${GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_TARGET_ID} AND lower(trim(name))=@expected_name AND trim(COALESCE(phone,''))=@expected_phone AND membership_number=@expected_membership AND is_anonymous=@expected_anonymous AND updated_at IS @expected_updated_at AND NOT EXISTS(SELECT 1 FROM portal_accounts WHERE contact_id=${GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_TARGET_ID})`, params: p },
    assertion('changes()=1'),
    { sql: `INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name,created_at,updated_at) VALUES('global',@history_entity,@operation,@history_label,0,'recorded','{}',@receipt,@actor_id,@actor_name,@mutation_stamp,@mutation_stamp)`, params: p },
    { sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,old_value,new_value,created_at) VALUES(@actor_id,@actor_name,@audit_action,'customer',@customer_id_text,@audit_details,'customers',@customer_id_text,@audit_old,@audit_new,@mutation_stamp)`, params: p },
    assertion(afterGuard()),
  ]
  return { outcome: 'apply', request, manifest, mutationStamp, statements, updateStatementIndex: 1, historyStatementIndex: 3 }
}

function changes(value: unknown): number { const item = value as { changes?: number; meta?: { changes?: number } } | undefined; return Number(item?.changes ?? item?.meta?.changes ?? 0) }

export async function applyGeneralCustomerMembershipRepair(db: Pick<D1Compat, 'prepare' | 'batch'>, plan: PreparedGeneralCustomerMembershipRepair) {
  if (plan.outcome === 'already_applied') return { outcome: 'already_applied' as const, changedCustomers: 0 as const, verification_pending: false }
  try {
    const results = await db.batch(plan.statements)
    if (changes(results[plan.updateStatementIndex!]) !== 1 || changes(results[plan.historyStatementIndex!]) < 1) throw new Error('Unexpected guarded repair result')
    let verification_pending = false
    try {
      const current = await readManifest(db); if (!(await classifyAlreadyApplied(db, current, plan.request))) throw new Error('postcondition')
    } catch { verification_pending = true }
    return { outcome: 'applied' as const, changedCustomers: 1 as const, verification_pending }
  } catch (error) {
    if (/general_customer_membership_repair_conflict|malformed JSON/i.test(error instanceof Error ? error.message : String(error))) {
      const current = await readManifest(db); if (await classifyAlreadyApplied(db, current, plan.request)) return { outcome: 'already_applied' as const, changedCustomers: 0 as const, verification_pending: false }
      conflict()
    }
    throw error
  }
}

export async function readGeneralCustomerMembershipRepairCacheToken(env: Env): Promise<string | null> { try { return await getVersionWithFallback(env, 'customers') } catch { return null } }

export async function refreshGeneralCustomerMembershipRepair(env: Env, beforeToken: string | null) {
  try { await bumpVersion(env, 'customers') } catch { /* surfaced as pending */ }
  let afterToken: string | null = null
  try { afterToken = await getVersionWithFallback(env, 'customers') } catch { /* surfaced as pending */ }
  try { await broadcast(env, 'customers', { action: 'update', id: GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_TARGET_ID, reason: 'shared_general_membership_repair' }) } catch { /* best effort */ }
  const cache_invalidated = beforeToken !== null && afterToken !== null && beforeToken !== afterToken
  return { cache_invalidated, refresh_pending: !cache_invalidated, broadcast_requested: true as const }
}
