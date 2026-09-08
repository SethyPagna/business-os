import type { Env } from '../index'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersion, getVersionWithFallback } from './cache'
import type { D1Compat } from './db'

export const GENERAL_CUSTOMER_REPAIR_STEP = 'mark_shared_general_24969' as const
export const GENERAL_CUSTOMER_REPAIR_CONFIRMATION = 'MARK CUSTOMER 24969 AS SHARED GENERAL' as const
export const GENERAL_CUSTOMER_REPAIR_OPERATION_KEY = 'f72:shared-general:24969:v1' as const
export const GENERAL_CUSTOMER_REPAIR_TARGET_ID = 24969 as const
export const GENERAL_CUSTOMER_REPAIR_PROTECTED_ID = 22305 as const
export const GENERAL_CUSTOMER_REPAIR_BACKUP_TABLES = Object.freeze(['customers'] as const)

const REPAIR_SCHEMA_VERSION = 1
const HISTORY_ENTITY = 'customer_anonymous_repair'
const HISTORY_LABEL = 'Mark confirmed shared General customer as anonymous checkout identity'
const AUDIT_ACTION = 'mark_anonymous_customer'
const REQUEST_KEYS = Object.freeze(['step', 'confirmation', 'manifest_sha256', 'expected_updated_at'])
const CUSTOMER_COLUMNS = Object.freeze([
  'id', 'name', 'phone', 'email', 'address', 'company', 'notes', 'created_at',
  'membership_number', 'updated_at', 'gender', 'phone_normalized', 'is_anonymous',
] as const)

type CustomerColumn = typeof CUSTOMER_COLUMNS[number]
type CustomerSnapshot = Record<CustomerColumn, string | number | null>
type RepairActor = { id?: unknown; name?: unknown }
type RepairStatement = { sql: string; params?: Record<string, unknown> }

type CanonicalManifest = {
  schema_version: 1
  operation_key: typeof GENERAL_CUSTOMER_REPAIR_OPERATION_KEY
  customer: CustomerSnapshot
  sale_ids: number[]
  return_ids: number[]
  portal_account_count: number
  protected_customer: { id: typeof GENERAL_CUSTOMER_REPAIR_PROTECTED_ID; is_anonymous: number }
}

type StoredReceipt = {
  schema_version: number
  operation_key: string
  customer_id: number
  manifest_sha256: string
  expected_updated_at: string | null
  mutation_stamp: string
}

export type GeneralCustomerRepairRequest = {
  step: typeof GENERAL_CUSTOMER_REPAIR_STEP
  confirmation: typeof GENERAL_CUSTOMER_REPAIR_CONFIRMATION
  manifest_sha256: string
  expected_updated_at: string | null
}

export type PreparedGeneralCustomerRepair = {
  outcome: 'apply' | 'already_applied'
  request: GeneralCustomerRepairRequest
  manifest: CanonicalManifest
  mutationStamp: string | null
  statements: RepairStatement[]
  updateStatementIndex: number | null
  historyStatementIndex: number | null
}

export class GeneralCustomerRepairValidationError extends Error {}
export class GeneralCustomerRepairConflictError extends Error {}

function validation(message: string): never {
  throw new GeneralCustomerRepairValidationError(message)
}

function conflict(message = 'The shared General customer changed after preview. No data was changed.'): never {
  throw new GeneralCustomerRepairConflictError(message)
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

function actorIdentity(actor: RepairActor): { id: number; name: string } {
  if (!Number.isSafeInteger(actor.id) || Number(actor.id) < 1) validation('authenticated actor id is required')
  if (typeof actor.name !== 'string' || !actor.name.trim() || actor.name.length > 120) {
    validation('authenticated actor username is required')
  }
  return { id: Number(actor.id), name: actor.name }
}

function normalizeCustomer(raw: Record<string, unknown> | undefined): CustomerSnapshot {
  if (!raw) conflict('Customer 24969 does not exist. No data was changed.')
  const customer = Object.fromEntries(CUSTOMER_COLUMNS.map((column) => [column, raw[column] ?? null])) as CustomerSnapshot
  if (!Number.isSafeInteger(Number(customer.id)) || Number(customer.id) !== GENERAL_CUSTOMER_REPAIR_TARGET_ID) {
    conflict('The fixed shared General customer could not be read. No data was changed.')
  }
  customer.id = Number(customer.id)
  customer.is_anonymous = Number(customer.is_anonymous ?? 0)
  return customer
}

function numberIds(rows: Array<{ id?: unknown }>): number[] {
  const ids = rows.map((row) => Number(row.id))
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
    conflict('The linked customer records could not be represented safely. No data was changed.')
  }
  return ids.sort((left, right) => left - right)
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function readManifest(db: Pick<D1Compat, 'prepare'>): Promise<CanonicalManifest> {
  let customerRow: Record<string, unknown> | undefined
  let protectedRow: { id?: unknown; is_anonymous?: unknown } | undefined
  try {
    customerRow = await db.prepare(`SELECT ${CUSTOMER_COLUMNS.join(',')} FROM customers WHERE id=${GENERAL_CUSTOMER_REPAIR_TARGET_ID}`).get<Record<string, unknown>>()
    protectedRow = await db.prepare(`SELECT id,is_anonymous FROM customers WHERE id=${GENERAL_CUSTOMER_REPAIR_PROTECTED_ID}`).get<{ id?: unknown; is_anonymous?: unknown }>()
  } catch (error) {
    if (/no such column:\s*is_anonymous/i.test(error instanceof Error ? error.message : String(error))) {
      conflict('Migration 0141 is not applied. No data was changed.')
    }
    throw error
  }
  const customer = normalizeCustomer(customerRow)
  if (!protectedRow || Number(protectedRow.id) !== GENERAL_CUSTOMER_REPAIR_PROTECTED_ID) {
    conflict('Protected customer 22305 does not exist. No data was changed.')
  }
  const [sales, returns, portal] = await Promise.all([
    db.prepare(`SELECT id FROM sales WHERE customer_id=${GENERAL_CUSTOMER_REPAIR_TARGET_ID} ORDER BY id`).all<{ id: number }>(),
    db.prepare(`SELECT id FROM returns WHERE customer_id=${GENERAL_CUSTOMER_REPAIR_TARGET_ID} ORDER BY id`).all<{ id: number }>(),
    db.prepare(`SELECT COUNT(*) AS count FROM portal_accounts WHERE contact_id=${GENERAL_CUSTOMER_REPAIR_TARGET_ID}`).get<{ count: number }>(),
  ])
  return {
    schema_version: REPAIR_SCHEMA_VERSION,
    operation_key: GENERAL_CUSTOMER_REPAIR_OPERATION_KEY,
    customer,
    sale_ids: numberIds(sales),
    return_ids: numberIds(returns),
    portal_account_count: Number(portal?.count ?? 0),
    protected_customer: {
      id: GENERAL_CUSTOMER_REPAIR_PROTECTED_ID,
      is_anonymous: Number(protectedRow.is_anonymous ?? 0),
    },
  }
}

async function manifestDigest(manifest: CanonicalManifest): Promise<string> {
  return sha256(JSON.stringify(manifest))
}

function assertRepairableIdentity(manifest: CanonicalManifest): void {
  const customer = manifest.customer
  if (customer.name !== 'general' || customer.phone !== '' || Number(customer.is_anonymous) !== 0) {
    conflict('Customer 24969 no longer matches the owner-confirmed shared General identity. No data was changed.')
  }
  if (manifest.portal_account_count !== 0) {
    conflict('Customer 24969 now has a portal account. No data was changed.')
  }
  if (manifest.protected_customer.id !== GENERAL_CUSTOMER_REPAIR_PROTECTED_ID || manifest.protected_customer.is_anonymous !== 0) {
    conflict('Protected customer 22305 is not in its expected unmarked state. No data was changed.')
  }
}

async function readMaintenance(db: Pick<D1Compat, 'prepare'>): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS active FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore'").get()
  return Boolean(row)
}

async function readReceiptState(db: Pick<D1Compat, 'prepare'>) {
  const histories = await db.prepare(`SELECT id,scope,label,undo_payload,redo_payload,created_by_id,created_by_name,created_at,updated_at FROM action_history
    WHERE entity=@entity AND entity_id=@operation AND reversible=0 AND status='recorded' ORDER BY id`).all<{
      id: number
      scope: string | null
      label: string | null
      undo_payload: string | null
      redo_payload: string | null
      created_by_id: number | null
      created_by_name: string | null
      created_at: string | null
      updated_at: string | null
    }>({
    entity: HISTORY_ENTITY, operation: GENERAL_CUSTOMER_REPAIR_OPERATION_KEY,
  })
  const audits = await db.prepare(`SELECT id,user_id,user_name,details,table_name,record_id,old_value,new_value,created_at FROM audit_logs
    WHERE action=@action AND entity='customer' AND entity_id=@customer ORDER BY id`).all<Record<string, unknown>>({
    action: AUDIT_ACTION, customer: String(GENERAL_CUSTOMER_REPAIR_TARGET_ID),
  })
  return { histories, audits }
}

function parseStoredReceipt(raw: string | null | undefined): StoredReceipt | null {
  try {
    const value = JSON.parse(raw || '') as StoredReceipt
    if (value.schema_version !== REPAIR_SCHEMA_VERSION
      || value.operation_key !== GENERAL_CUSTOMER_REPAIR_OPERATION_KEY
      || value.customer_id !== GENERAL_CUSTOMER_REPAIR_TARGET_ID
      || !/^[a-f0-9]{64}$/.test(value.manifest_sha256)
      || !(value.expected_updated_at === null || typeof value.expected_updated_at === 'string')
      || typeof value.mutation_stamp !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value.mutation_stamp)) return null
    return value
  } catch {
    return null
  }
}

const AUDIT_DETAILS = Object.freeze({
  operation_key: GENERAL_CUSTOMER_REPAIR_OPERATION_KEY,
  customer_id: GENERAL_CUSTOMER_REPAIR_TARGET_ID,
  decision: 'owner_confirmed_shared_general',
  changed_field: 'is_anonymous',
  before: 0,
  after: 1,
  preserved_profile: true,
  preserved_links: true,
})

function exactAudit(
  row: Record<string, unknown> | undefined,
  history: { created_by_id?: unknown; created_by_name?: unknown } | undefined,
  stored: StoredReceipt,
): boolean {
  if (!row) return false
  try {
    return JSON.stringify(JSON.parse(String(row.details || ''))) === JSON.stringify(AUDIT_DETAILS)
      && Number(row.user_id) === Number(history?.created_by_id)
      && row.user_name === history?.created_by_name
      && row.table_name === 'customers'
      && row.record_id === String(GENERAL_CUSTOMER_REPAIR_TARGET_ID)
      && String(row.old_value || '') === JSON.stringify({ is_anonymous: 0 })
      && String(row.new_value || '') === JSON.stringify({ is_anonymous: 1 })
      && row.created_at === stored.mutation_stamp
  } catch {
    return false
  }
}

function exactHistory(row: Record<string, unknown> | undefined, stored: StoredReceipt): boolean {
  return Boolean(row)
    && row?.scope === 'global'
    && row?.label === HISTORY_LABEL
    && row?.undo_payload === '{}'
    && row?.created_at === stored.mutation_stamp
    && row?.updated_at === stored.mutation_stamp
    && Number(row?.created_by_id) >= 1
    && typeof row?.created_by_name === 'string'
    && Boolean(String(row?.created_by_name).trim())
}

async function classifyAlreadyApplied(
  db: Pick<D1Compat, 'prepare'>,
  current: CanonicalManifest,
  request?: GeneralCustomerRepairRequest,
): Promise<{ request: GeneralCustomerRepairRequest; manifest: CanonicalManifest } | null> {
  const receipts = await readReceiptState(db)
  if (receipts.histories.length !== 1 || receipts.audits.length !== 1) return null
  const stored = parseStoredReceipt(receipts.histories[0]?.redo_payload)
  if (!stored || !exactHistory(receipts.histories[0], stored)
    || !exactAudit(receipts.audits[0], receipts.histories[0], stored)
    || Number(current.customer.is_anonymous) !== 1 || current.customer.updated_at !== stored.mutation_stamp
    || current.portal_account_count !== 0 || current.protected_customer.is_anonymous !== 0) return null
  const original: CanonicalManifest = {
    ...current,
    customer: { ...current.customer, updated_at: stored.expected_updated_at, is_anonymous: 0 },
  }
  const digest = await manifestDigest(original)
  if (digest !== stored.manifest_sha256) return null
  const storedRequest: GeneralCustomerRepairRequest = {
    step: GENERAL_CUSTOMER_REPAIR_STEP,
    confirmation: GENERAL_CUSTOMER_REPAIR_CONFIRMATION,
    manifest_sha256: digest,
    expected_updated_at: stored.expected_updated_at,
  }
  if (request && (request.manifest_sha256 !== storedRequest.manifest_sha256
    || request.expected_updated_at !== storedRequest.expected_updated_at)) return null
  return { request: storedRequest, manifest: original }
}

function publicPreview(outcome: 'ready' | 'already_applied', request: GeneralCustomerRepairRequest, manifest: CanonicalManifest) {
  const address = manifest.customer.address
  return {
    success: true as const,
    outcome,
    request,
    target: {
      id: GENERAL_CUSTOMER_REPAIR_TARGET_ID,
      name: manifest.customer.name,
      phone_state: 'known_empty' as const,
      address_state: address === null ? 'known_null' as const : address === '' ? 'known_empty' as const : 'known_present' as const,
      is_anonymous: outcome === 'already_applied' ? 1 : 0,
      portal_account_count: manifest.portal_account_count,
      sale_count: manifest.sale_ids.length,
      return_count: manifest.return_ids.length,
    },
    protected_customer: { id: GENERAL_CUSTOMER_REPAIR_PROTECTED_ID, is_anonymous: 0 },
  }
}

export async function previewGeneralCustomerRepair(db: Pick<D1Compat, 'prepare'>, actor: RepairActor) {
  actorIdentity(actor)
  if (await readMaintenance(db)) conflict('Restore maintenance is active. No data was changed.')
  const manifest = await readManifest(db)
  const receipts = await readReceiptState(db)
  if (Number(manifest.customer.is_anonymous) === 1) {
    const replay = await classifyAlreadyApplied(db, manifest)
    if (!replay) conflict('Customer 24969 is marked without the exact repair receipt. No data was changed.')
    return publicPreview('already_applied', replay.request, replay.manifest)
  }
  if (receipts.histories.length || receipts.audits.length) {
    conflict('A conflicting repair receipt already exists. No data was changed.')
  }
  assertRepairableIdentity(manifest)
  const request: GeneralCustomerRepairRequest = {
    step: GENERAL_CUSTOMER_REPAIR_STEP,
    confirmation: GENERAL_CUSTOMER_REPAIR_CONFIRMATION,
    manifest_sha256: await manifestDigest(manifest),
    expected_updated_at: manifest.customer.updated_at as string | null,
  }
  return publicPreview('ready', request, manifest)
}

function normalizeRequest(raw: unknown): GeneralCustomerRepairRequest {
  const request = exactObject(raw, REQUEST_KEYS, 'request')
  if (request.step !== GENERAL_CUSTOMER_REPAIR_STEP) validation(`request.step must be ${GENERAL_CUSTOMER_REPAIR_STEP}`)
  if (request.confirmation !== GENERAL_CUSTOMER_REPAIR_CONFIRMATION) validation(`request.confirmation must be ${GENERAL_CUSTOMER_REPAIR_CONFIRMATION}`)
  if (typeof request.manifest_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(request.manifest_sha256)) {
    validation('request.manifest_sha256 must be a lowercase SHA-256 digest')
  }
  if (!(request.expected_updated_at === null || (typeof request.expected_updated_at === 'string' && request.expected_updated_at.length <= 40))) {
    validation('request.expected_updated_at must be the exact preview value')
  }
  return request as GeneralCustomerRepairRequest
}

function customerPredicate(prefix = 'customer'): string {
  return CUSTOMER_COLUMNS.map((column) => `${column} IS @${prefix}_${column}`).join(' AND ')
}

function linkedSetPredicate(table: 'sales' | 'returns', jsonParam: 'sale_ids' | 'return_ids'): string {
  return `(SELECT COUNT(*) FROM ${table} WHERE customer_id=${GENERAL_CUSTOMER_REPAIR_TARGET_ID})=json_array_length(@${jsonParam})
    AND NOT EXISTS(SELECT 1 FROM ${table} linked WHERE linked.customer_id=${GENERAL_CUSTOMER_REPAIR_TARGET_ID}
      AND NOT EXISTS(SELECT 1 FROM json_each(@${jsonParam}) expected WHERE CAST(expected.value AS INTEGER)=linked.id))
    AND NOT EXISTS(SELECT 1 FROM json_each(@${jsonParam}) expected
      WHERE NOT EXISTS(SELECT 1 FROM ${table} linked WHERE linked.id=CAST(expected.value AS INTEGER)
        AND linked.customer_id=${GENERAL_CUSTOMER_REPAIR_TARGET_ID}))`
}

function historyCountPredicate(expected: 0 | 1): string {
  const exact = expected === 0 ? '' : ` AND scope='global' AND label=@history_label AND undo_payload='{}'
    AND redo_payload=@receipt AND created_by_id=@actor_id AND created_by_name=@actor_name
    AND created_at=@mutation_stamp AND updated_at=@mutation_stamp`
  return `(SELECT COUNT(*) FROM action_history WHERE entity=@history_entity AND entity_id=@operation
    AND reversible=0 AND status='recorded'${exact})=${expected}
    AND (SELECT COUNT(*) FROM action_history WHERE entity=@history_entity AND entity_id=@operation)=${expected}`
}

function auditCountPredicate(expected: 0 | 1): string {
  const exact = expected === 0 ? '' : ` AND user_id=@actor_id AND user_name=@actor_name
    AND details=@audit_details AND table_name='customers' AND record_id=@customer_id_text
    AND old_value=@audit_old AND new_value=@audit_new AND created_at=@mutation_stamp`
  return `(SELECT COUNT(*) FROM audit_logs WHERE action=@audit_action AND entity='customer' AND entity_id=@customer_id_text${exact})=${expected}
    AND (SELECT COUNT(*) FROM audit_logs WHERE action=@audit_action AND entity='customer' AND entity_id=@customer_id_text)=${expected}`
}

function atomicGuard(before: boolean): string {
  const rowPredicate = before
    ? customerPredicate()
    : CUSTOMER_COLUMNS.map((column) => column === 'updated_at'
      ? 'updated_at IS @mutation_stamp'
      : column === 'is_anonymous' ? 'is_anonymous=1' : `${column} IS @customer_${column}`).join(' AND ')
  return `NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
    AND EXISTS(SELECT 1 FROM customers WHERE id=${GENERAL_CUSTOMER_REPAIR_TARGET_ID} AND ${rowPredicate})
    AND EXISTS(SELECT 1 FROM customers WHERE id=${GENERAL_CUSTOMER_REPAIR_PROTECTED_ID} AND COALESCE(is_anonymous,0)=0)
    AND NOT EXISTS(SELECT 1 FROM portal_accounts WHERE contact_id=${GENERAL_CUSTOMER_REPAIR_TARGET_ID})
    AND ${linkedSetPredicate('sales', 'sale_ids')}
    AND ${linkedSetPredicate('returns', 'return_ids')}
    AND ${historyCountPredicate(before ? 0 : 1)}
    AND ${auditCountPredicate(before ? 0 : 1)}`
}

function assertion(predicate: string, params: Record<string, unknown>): RepairStatement {
  return { sql: `SELECT CASE WHEN (${predicate}) THEN 1 ELSE json_extract('general_customer_repair_conflict','$') END AS guard`, params }
}

function statementParams(manifest: CanonicalManifest, request: GeneralCustomerRepairRequest, actor: { id: number; name: string }, mutationStamp: string) {
  const customerParams = Object.fromEntries(CUSTOMER_COLUMNS.map((column) => [`customer_${column}`, manifest.customer[column]]))
  return {
    ...customerParams,
    sale_ids: JSON.stringify(manifest.sale_ids),
    return_ids: JSON.stringify(manifest.return_ids),
    history_entity: HISTORY_ENTITY,
    history_label: HISTORY_LABEL,
    operation: GENERAL_CUSTOMER_REPAIR_OPERATION_KEY,
    audit_action: AUDIT_ACTION,
    customer_id_text: String(GENERAL_CUSTOMER_REPAIR_TARGET_ID),
    actor_id: actor.id,
    actor_name: actor.name,
    mutation_stamp: mutationStamp,
    receipt: JSON.stringify({
      schema_version: REPAIR_SCHEMA_VERSION,
      operation_key: GENERAL_CUSTOMER_REPAIR_OPERATION_KEY,
      customer_id: GENERAL_CUSTOMER_REPAIR_TARGET_ID,
      manifest_sha256: request.manifest_sha256,
      expected_updated_at: request.expected_updated_at,
      mutation_stamp: mutationStamp,
    } satisfies StoredReceipt),
    audit_details: JSON.stringify(AUDIT_DETAILS),
    audit_old: JSON.stringify({ is_anonymous: 0 }),
    audit_new: JSON.stringify({ is_anonymous: 1 }),
  }
}

export async function prepareGeneralCustomerRepair(
  db: Pick<D1Compat, 'prepare'>,
  rawRequest: unknown,
  rawActor: RepairActor,
): Promise<PreparedGeneralCustomerRepair> {
  const request = normalizeRequest(rawRequest)
  const actor = actorIdentity(rawActor)
  if (await readMaintenance(db)) conflict('Restore maintenance is active. No data was changed.')
  const manifest = await readManifest(db)
  if (Number(manifest.customer.is_anonymous) === 1) {
    const replay = await classifyAlreadyApplied(db, manifest, request)
    if (!replay) conflict('Customer 24969 is marked without this exact repair receipt. No data was changed.')
    return { outcome: 'already_applied', request, manifest: replay.manifest, mutationStamp: null, statements: [], updateStatementIndex: null, historyStatementIndex: null }
  }
  const receipts = await readReceiptState(db)
  if (receipts.histories.length || receipts.audits.length) conflict('A conflicting repair receipt already exists. No data was changed.')
  assertRepairableIdentity(manifest)
  if (manifest.customer.updated_at !== request.expected_updated_at || await manifestDigest(manifest) !== request.manifest_sha256) {
    conflict()
  }
  const mutationStamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const params = statementParams(manifest, request, actor, mutationStamp)
  const statements: RepairStatement[] = [
    assertion(atomicGuard(true), params),
    {
      sql: `UPDATE customers SET is_anonymous=1,updated_at=@mutation_stamp
        WHERE id=${GENERAL_CUSTOMER_REPAIR_TARGET_ID} AND ${customerPredicate()}
          AND NOT EXISTS(SELECT 1 FROM portal_accounts WHERE contact_id=${GENERAL_CUSTOMER_REPAIR_TARGET_ID})`,
      params,
    },
    assertion('changes()=1', params),
    {
      sql: `INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name,created_at,updated_at)
        VALUES('global',@history_entity,@operation,@history_label,0,'recorded','{}',@receipt,@actor_id,@actor_name,@mutation_stamp,@mutation_stamp)`,
      params,
    },
    {
      sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,old_value,new_value,created_at)
        VALUES(@actor_id,@actor_name,@audit_action,'customer',@customer_id_text,@audit_details,'customers',@customer_id_text,@audit_old,@audit_new,@mutation_stamp)`,
      params,
    },
    assertion(atomicGuard(false), params),
  ]
  return { outcome: 'apply', request, manifest, mutationStamp, statements, updateStatementIndex: 1, historyStatementIndex: 3 }
}

function resultChanges(result: unknown): number {
  const shaped = result as { changes?: number; meta?: { changes?: number } } | undefined
  return Number(shaped?.changes ?? shaped?.meta?.changes ?? 0)
}

async function verifyApplied(db: Pick<D1Compat, 'prepare'>, plan: PreparedGeneralCustomerRepair): Promise<void> {
  const current = await readManifest(db)
  const replay = await classifyAlreadyApplied(db, current, plan.request)
  if (!replay) conflict('The repair committed but its exact postcondition could not be verified.')
}

export async function applyGeneralCustomerRepair(
  db: Pick<D1Compat, 'prepare' | 'batch'>,
  plan: PreparedGeneralCustomerRepair,
): Promise<{ outcome: 'applied' | 'already_applied'; changedCustomers: 0 | 1; verification_pending: boolean }> {
  if (plan.outcome === 'already_applied') {
    let verificationPending = false
    try { await verifyApplied(db, plan) } catch { verificationPending = true }
    return { outcome: 'already_applied', changedCustomers: 0, verification_pending: verificationPending }
  }
  try {
    const results = await db.batch(plan.statements)
    const changedCustomers = resultChanges(results[plan.updateStatementIndex!]) > 0 ? 1 : 0
    if (changedCustomers !== 1 || resultChanges(results[plan.historyStatementIndex!]) < 1) {
      throw new Error('Unexpected guarded repair result')
    }
    // The last in-batch assertion already proves the committed state. This
    // second no-store read is operational evidence; a transient read failure
    // after commit must not be reported as a mutation failure that invites an
    // operator to guess whether the write happened. Exact replay re-runs it.
    let verificationPending = false
    try { await verifyApplied(db, plan) } catch { verificationPending = true }
    return { outcome: 'applied', changedCustomers: 1, verification_pending: verificationPending }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/general_customer_repair_conflict|malformed JSON/i.test(message)) {
      const current = await readManifest(db)
      const replay = await classifyAlreadyApplied(db, current, plan.request)
      if (replay) return { outcome: 'already_applied', changedCustomers: 0, verification_pending: false }
      conflict()
    }
    throw error
  }
}

export async function readGeneralCustomerRepairCacheToken(env: Env): Promise<string | null> {
  try {
    return await getVersionWithFallback(env, 'customers')
  } catch {
    return null
  }
}

export async function refreshGeneralCustomerRepair(env: Env, beforeToken: string | null) {
  try { await bumpVersion(env, 'customers') } catch { /* reported as refresh_pending below */ }
  let afterToken: string | null = null
  try { afterToken = await getVersionWithFallback(env, 'customers') } catch { /* reported below */ }
  try {
    await broadcast(env, 'customers', {
      action: 'update',
      id: GENERAL_CUSTOMER_REPAIR_TARGET_ID,
      reason: 'anonymous_marker_repair',
    })
  } catch { /* broadcast is best effort; requested remains the honest claim */ }
  const cacheInvalidated = beforeToken !== null && afterToken !== null && afterToken !== beforeToken
  return {
    cache_invalidated: cacheInvalidated,
    refresh_pending: !cacheInvalidated,
    broadcast_requested: true as const,
  }
}
