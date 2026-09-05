import type { Env } from '../index'
import { broadcast } from '../durable-objects/broadcastHub'
import type { SessionUser } from './auth'
import { bumpVersion } from './cache'
import { getDb, type D1Compat } from './db'
import { getActionTier } from './permissions'
import { parseConfiguredMethodsStrict, paymentMethodKey, RETIRED_PAYMENT_METHODS } from './paymentMethodRegistry'
import { normalizeSearchText } from './searchMatch'
import { D1_MAX_BOUND_PARAMS } from './sqlBinding'
import {
  BULK_STATUS_LIMIT,
  BULK_STATUS_MOVEMENT_LIMIT,
  SaleBulkError,
  bulkAssertion,
  saleMovementFingerprint,
  saleRevisionGuard,
} from './saleBulkStatus'
import type { StockStatement } from './saleTransitions'

export const BULK_UPDATE_KIND = 'sale.fields.bulk'
export const BULK_CUSTOMER_UPDATE_KIND = 'sale.customer.bulk'
export const SALE_BULK_UPDATE_KINDS = new Set([BULK_UPDATE_KIND, BULK_CUSTOMER_UPDATE_KIND])

type Row = Record<string, unknown>
type BulkUpdateItem = { id: number; expected_updated_at: string | null }
export type SaleBulkUpdateAction =
  | { kind: 'payment_method'; source: string | null; target: string }
  | { kind: 'delivery_contact'; source_id: number | null; target_id: number | null }
  | { kind: 'customer'; source_id: number | null; target_id: number | null }

export type SaleBulkUpdateRequest = {
  client_request_id: string
  items: BulkUpdateItem[]
  action: SaleBulkUpdateAction
}

export function saleBulkUpdateApplier(action: SaleBulkUpdateAction): string {
  return action.kind === 'customer' ? BULK_CUSTOMER_UPDATE_KIND : BULK_UPDATE_KIND
}

type ReturnCustomerSnapshot = {
  id: number
  customer_id: number | null
  customer_name: string | null
  search_normalized: string | null
}

type BulkUpdateMember = {
  id: number
  receipt: string
  changed: boolean
  reason: 'changed' | 'source_mismatch' | 'already_target'
  before: Row
  after: Row
  returnsBefore: ReturnCustomerSnapshot[]
  returnsAfter: ReturnCustomerSnapshot[]
}

type BulkUpdateSnapshot = {
  version: 1
  operationId: string
  action: SaleBulkUpdateAction
  members: BulkUpdateMember[]
  referenceBefore?: Row | null
  referenceAfter?: Row | null
}

function fail(message: string, status: 400 | 403 | 409 = 409): never {
  throw new SaleBulkError(message, status)
}

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase('en-US')
}

function optionalId(value: unknown, label: string): number | null {
  if (value === null) return null
  if (!Number.isSafeInteger(value) || Number(value) <= 0) fail(`${label} must be a positive id or null.`, 400)
  return Number(value)
}

function permission(user: SessionUser, action: SaleBulkUpdateAction): void {
  const actionKey = action.kind === 'customer' ? 'customer' : 'status'
  if (getActionTier(user, 'sales', actionKey) !== 'full') {
    fail('No permission to change the selected sales.', 403)
  }
}

function parseRequest(raw: Row): SaleBulkUpdateRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('A bulk update object is required.', 400)
  if (Object.keys(raw).some((key) => !['client_request_id', 'items', 'action'].includes(key))) fail('Unsupported bulk update field.', 400)
  if (typeof raw.client_request_id !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(raw.client_request_id)) fail('A stable request id is required.', 400)
  if (!Array.isArray(raw.items) || !raw.items.length || raw.items.length > BULK_STATUS_LIMIT) fail(`Select between 1 and ${BULK_STATUS_LIMIT} sales.`, 400)
  const ids = new Set<number>()
  const items: BulkUpdateItem[] = raw.items.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('Invalid selected sale.', 400)
    const value = item as Row
    if (Object.keys(value).some((key) => !['id', 'expected_updated_at'].includes(key))
      || !Number.isSafeInteger(value.id) || Number(value.id) <= 0 || ids.has(Number(value.id))
      || !(typeof value.expected_updated_at === 'string' || value.expected_updated_at === null)) {
      fail('Unique sale ids and expected states are required.', 400)
    }
    ids.add(Number(value.id))
    return { id: Number(value.id), expected_updated_at: value.expected_updated_at as string | null }
  }).sort((a, b) => a.id - b.id)

  if (!raw.action || typeof raw.action !== 'object' || Array.isArray(raw.action)) fail('Choose one bulk update action.', 400)
  const input = raw.action as Row
  const kind = String(input.kind || '')
  let action: SaleBulkUpdateAction
  if (kind === 'payment_method') {
    if (Object.keys(input).some((key) => !['kind', 'source', 'target'].includes(key))) fail('Unsupported payment method update field.', 400)
    if (!(typeof input.source === 'string' || input.source === null)) fail('Source payment method must be text or null.', 400)
    const target = String(input.target || '').trim()
    if (!target || target.length > 80 || String(input.source ?? '').length > 160) fail('Payment method must contain 1 to 80 characters.', 400)
    action = { kind, source: input.source === null ? null : String(input.source).trim(), target }
  } else if (kind === 'delivery_contact' || kind === 'customer') {
    if (Object.keys(input).some((key) => !['kind', 'source_id', 'target_id'].includes(key))) fail('Unsupported reassignment field.', 400)
    action = { kind, source_id: optionalId(input.source_id, 'Source'), target_id: optionalId(input.target_id, 'Target') }
  } else {
    fail('Unsupported bulk update action.', 400)
  }
  return { client_request_id: raw.client_request_id, items, action }
}

async function rowsIn<T>(db: D1Compat, ids: number[], sql: (marks: string) => string): Promise<T[]> {
  if (!ids.length) return []
  // sql-bound-params: bounded by construction. parseRequest caps every
  // selected-id list at BULK_STATUS_LIMIT (25), below D1's 100-bind limit.
  if (ids.length > BULK_STATUS_LIMIT || ids.length > D1_MAX_BOUND_PARAMS) fail('Selection exceeds the single-query bound.', 400)
  return db.prepare(sql(ids.map(() => '?').join(','))).all<T>(ids)
}

function bounded(statements: StockStatement[], snapshot: BulkUpdateSnapshot): void {
  if (statements.length > 500 || new TextEncoder().encode(JSON.stringify(snapshot)).length > 512000) {
    fail('Selection is too large for one atomic action. Select fewer sales.', 400)
  }
}

function parsePaymentDetails(raw: unknown): Row[] {
  if (raw == null || raw === '') return []
  let parsed: unknown
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    fail('A matching sale has unreadable payment details; correct it on its own first.', 400)
  }
  if (!Array.isArray(parsed) || parsed.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    fail('A matching sale has unreadable payment details; correct it on its own first.', 400)
  }
  return parsed as Row[]
}

function searchSnapshot(sale: Row, overrides: { paymentMethod?: unknown; customerName?: unknown; customerPhone?: unknown } = {}): string {
  return normalizeSearchText([
    sale.receipt_number,
    sale.cashier_name,
    overrides.customerName ?? sale.customer_name,
    overrides.customerPhone ?? sale.customer_phone,
    sale.branch_name,
    overrides.paymentMethod ?? sale.payment_method,
  ].filter(Boolean).join(' '))
}

function saleUpdateStatement(member: BulkUpdateMember, action: SaleBulkUpdateAction, direction: 1 | -1, stamp: string): StockStatement[] {
  if (!member.changed) return []
  const target = direction > 0 ? member.after : member.before
  const statements: StockStatement[] = []
  if (action.kind === 'payment_method') {
    statements.push({
      sql: 'UPDATE sales SET payment_method=@payment_method,payment_details=@payment_details,search_normalized=@search_normalized,updated_at=@stamp WHERE id=@id',
      params: { ...target, id: member.id, stamp },
    })
  } else if (action.kind === 'delivery_contact') {
    statements.push({
      sql: 'UPDATE sales SET delivery_contact_id=@delivery_contact_id,delivery_contact_name=@delivery_contact_name,delivery_contact_phone=@delivery_contact_phone,delivery_contact_address=@delivery_contact_address,updated_at=@stamp WHERE id=@id',
      params: { ...target, id: member.id, stamp },
    })
  } else {
    statements.push({
      sql: 'UPDATE sales SET customer_id=@customer_id,customer_name=@customer_name,customer_phone=@customer_phone,customer_address=@customer_address,search_normalized=@search_normalized,updated_at=@stamp WHERE id=@id',
      params: { ...target, id: member.id, stamp },
    })
    const returns = direction > 0 ? member.returnsAfter : member.returnsBefore
    for (const row of returns) {
      statements.push({
        sql: 'UPDATE returns SET customer_id=@customer_id,customer_name=@customer_name,search_normalized=@search_normalized,updated_at=@stamp WHERE id=@id AND sale_id=@sale_id',
        params: { ...row, sale_id: member.id, stamp },
      })
    }
  }
  return statements
}

function auditStatement(user: SessionUser, operationId: string, direction: string, action: SaleBulkUpdateAction, count: number): StockStatement {
  return {
    sql: "INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value) VALUES(@uid,@name,@event,'sale',@id,@details,'sales',@id,@details)",
    params: { uid: user.id, name: user.name, event: direction, id: operationId, details: JSON.stringify({ kind: BULK_UPDATE_KIND, action: action.kind, count }) },
  }
}

function referenceGuard(action: SaleBulkUpdateAction, state: Row): StockStatement | null {
  if (action.kind === 'payment_method') return null
  const id = state[action.kind === 'customer' ? 'customer_id' : 'delivery_contact_id']
  if (id == null) return null
  if (action.kind === 'customer') {
    return bulkAssertion("EXISTS(SELECT 1 FROM customers WHERE id=@id AND COALESCE(name,'')=COALESCE(@name,'') AND COALESCE(phone,'')=COALESCE(@phone,'') AND COALESCE(address,'')=COALESCE(@address,''))", {
      id, name: state.customer_name, phone: state.customer_phone, address: state.customer_address,
    })
  }
  return bulkAssertion("EXISTS(SELECT 1 FROM delivery_contacts WHERE id=@id AND COALESCE(NULLIF(address,''),area,'')=COALESCE(@address,'') AND COALESCE(name,'')=COALESCE(@name,'') AND COALESCE(phone,'')=COALESCE(@phone,''))", {
    id, name: state.delivery_contact_name, phone: state.delivery_contact_phone, address: state.delivery_contact_address,
  })
}

function referenceState(action: SaleBulkUpdateAction, row: Row | null): Row | null {
  if (!row || action.kind === 'payment_method') return null
  if (action.kind === 'customer') {
    return { customer_id: row.id, customer_name: row.name ?? null, customer_phone: row.phone ?? null, customer_address: row.address ?? null }
  }
  return {
    delivery_contact_id: row.id,
    delivery_contact_name: row.name ?? null,
    delivery_contact_phone: row.phone ?? null,
    delivery_contact_address: row.address || row.area || null,
  }
}

export async function notifySaleBulkUpdate(env: Env, actionKind?: string): Promise<void> {
  if (actionKind === 'customer') {
    await Promise.allSettled([bumpVersion(env, 'sales'), bumpVersion(env, 'returns'), broadcast(env, 'sales', { action: 'update' }), broadcast(env, 'returns', { action: 'update' }), broadcast(env, 'customers', { action: 'update' })])
  } else if (actionKind === 'delivery_contact') {
    await Promise.allSettled([bumpVersion(env, 'sales'), broadcast(env, 'sales', { action: 'update' }), broadcast(env, 'deliveryContacts', { action: 'update' })])
  } else {
    await Promise.allSettled([bumpVersion(env, 'sales'), broadcast(env, 'sales', { action: 'update' })])
  }
}

export async function applySaleBulkUpdate(env: Env, user: SessionUser, raw: Row) {
  const request = parseRequest(raw)
  permission(user, request.action)
  const db = getDb(env)
  const canonical = JSON.stringify(request)
  const previous = await db.prepare('SELECT request_json,receipt_json FROM sale_bulk_operations WHERE actor_id=@actor AND request_id=@request').get<Row>({ actor: user.id, request: request.client_request_id })
  if (previous) {
    if (previous.request_json !== canonical) fail('Request id was already used with different data.')
    return JSON.parse(String(previous.receipt_json))
  }

  let expectedPaymentMethodsRaw: string | null = null
  if (request.action.kind === 'payment_method') {
    const setting = await db.prepare("SELECT value FROM settings WHERE key='pos_payment_methods'").get<{ value: string }>()
    const configured = parseConfiguredMethodsStrict(setting?.value)
    if (!setting || !configured.ok) fail('Configured payment methods are unreadable. Repair them in Settings before changing sales.', 409)
    const targetKey = paymentMethodKey(request.action.target)
    const target = configured.methods.find((method) => paymentMethodKey(method) === targetKey)
    if (!target || RETIRED_PAYMENT_METHODS.has(targetKey)) fail('Choose an active configured payment method.', 400)
    expectedPaymentMethodsRaw = setting.value
    request.action = { ...request.action, target }
  }

  const ids = request.items.map((item) => item.id)
  const sales = await rowsIn<Row>(db, ids, (marks) => `SELECT s.*,COALESCE(v.revision,0) AS write_revision,${saleMovementFingerprint('s.id')} AS movement_fingerprint FROM sales s LEFT JOIN sale_write_revisions v ON v.sale_id=s.id WHERE s.id IN (${marks})`)
  const sourceMatches = new Map<number, boolean>()
  const paymentDetails = new Map<number, Row[]>()
  for (const expected of request.items) {
    const sale = sales.find((row) => Number(row.id) === expected.id)
    if (!sale) fail(`Sale ${expected.id} was not found.`)
    let matches = false
    if (request.action.kind === 'payment_method') {
      const source = normalized(request.action.source)
      const topLevelMatched = normalized(sale.payment_method) === source
      const hasDetails = sale.payment_details != null && String(sale.payment_details).trim() !== ''
      let details: Row[] = []
      if (hasDetails) {
        try {
          details = parsePaymentDetails(sale.payment_details)
        } catch (error) {
          if (topLevelMatched) throw error
        }
      }
      paymentDetails.set(expected.id, details)
      matches = details.some((detail) => normalized(detail.method) === source) || (!details.length && topLevelMatched)
    } else if (request.action.kind === 'delivery_contact') {
      matches = (sale.delivery_contact_id == null ? null : Number(sale.delivery_contact_id)) === request.action.source_id && Number(sale.is_delivery || 0) === 1
    } else {
      matches = (sale.customer_id == null ? null : Number(sale.customer_id)) === request.action.source_id
    }
    sourceMatches.set(expected.id, matches)
    if (!matches) continue
    if ((sale.updated_at ?? null) !== expected.expected_updated_at) fail(`Sale ${expected.id} changed. Refresh before retrying.`)
    if (sale.movement_fingerprint === null) fail(`A selected sale exceeds ${BULK_STATUS_MOVEMENT_LIMIT} stock movements and cannot join a bulk action.`, 400)
  }
  const sourceMatchedIds = request.items.filter((item) => sourceMatches.get(item.id)).map((item) => item.id)
  const returnRows = request.action.kind === 'customer'
    ? await rowsIn<ReturnCustomerSnapshot & Row & { sale_id: number }>(db, sourceMatchedIds, (marks) => `SELECT id,sale_id,customer_id,customer_name,search_normalized,return_number,receipt_number,cashier_name,branch_name,reason,return_type,notes FROM returns WHERE sale_id IN (${marks}) ORDER BY id LIMIT 301`)
    : []
  if (returnRows.length > 300) fail('Select fewer linked return records (maximum 300).', 400)

  let targetContact: Row | null = null
  if (request.action.kind === 'delivery_contact' && request.action.target_id !== null) {
    targetContact = await db.prepare('SELECT id,name,phone,area,address FROM delivery_contacts WHERE id=?').get<Row>([request.action.target_id]) || null
    if (!targetContact) fail('Target delivery contact was not found.', 400)
  }
  let targetCustomer: Row | null = null
  if (request.action.kind === 'customer' && request.action.target_id !== null) {
    targetCustomer = await db.prepare('SELECT id,name,membership_number,phone,address FROM customers WHERE id=?').get<Row>([request.action.target_id]) || null
    if (!targetCustomer) fail('Target customer was not found.', 400)
  }
  let sourceReference: Row | null = null
  if (sourceMatchedIds.length && request.action.kind !== 'payment_method' && request.action.source_id !== null) {
    const table = request.action.kind === 'customer' ? 'customers' : 'delivery_contacts'
    const columns = request.action.kind === 'customer' ? 'id,name,phone,address' : 'id,name,phone,area,address'
    sourceReference = await db.prepare(`SELECT ${columns} FROM ${table} WHERE id=?`).get<Row>([request.action.source_id]) || null
    if (!sourceReference) fail('Source linked record was not found.', 400)
  }

  const operationId = crypto.randomUUID()
  const members: BulkUpdateMember[] = []
  const guards: StockStatement[] = []
  if (expectedPaymentMethodsRaw !== null) {
    guards.push(bulkAssertion("EXISTS(SELECT 1 FROM settings WHERE key='pos_payment_methods' AND value=@expected)", { expected: expectedPaymentMethodsRaw }))
  }
  for (const expected of request.items) {
    const sale = sales.find((row) => Number(row.id) === expected.id)
    if (!sale) fail(`Sale ${expected.id} was not found.`)
    const matchedAtRead = sourceMatches.get(expected.id) === true
    if (matchedAtRead) {
      guards.push(saleRevisionGuard(expected.id, Number(sale.write_revision)))
      guards.push(bulkAssertion(`${saleMovementFingerprint('@id')}=@fingerprint`, { id: expected.id, fingerprint: sale.movement_fingerprint }))
    }

    let sourceMatched = false
    let before: Row
    let after: Row
    const memberReturnRows = returnRows.filter((row) => row.sale_id === expected.id)
    const returnsBefore = memberReturnRows.map(({ id, customer_id, customer_name, search_normalized }) => ({ id, customer_id, customer_name, search_normalized }))
    let returnsAfter: ReturnCustomerSnapshot[] = []
    if (request.action.kind === 'payment_method') {
      const targetMethod = request.action.target
      before = { payment_method: sale.payment_method ?? null, payment_details: sale.payment_details ?? null, search_normalized: sale.search_normalized ?? null }
      const source = normalized(request.action.source)
      const details = paymentDetails.get(expected.id) || []
      sourceMatched = matchedAtRead
      const updatedDetails = details.map((detail) => normalized(detail.method) === source ? { ...detail, method: targetMethod } : detail)
      const updatedSummary = updatedDetails.length
        ? Array.from(new Set(updatedDetails.map((detail) => String(detail.method || '').trim()).filter(Boolean))).join(' + ')
        : targetMethod
      after = sourceMatched ? {
        payment_method: updatedSummary,
        payment_details: updatedDetails.length ? JSON.stringify(updatedDetails) : sale.payment_details ?? null,
        search_normalized: searchSnapshot(sale, { paymentMethod: updatedSummary }),
      } : { ...before }
    } else if (request.action.kind === 'delivery_contact') {
      sourceMatched = matchedAtRead
      before = {
        delivery_contact_id: sale.delivery_contact_id ?? null,
        delivery_contact_name: sale.delivery_contact_name ?? null,
        delivery_contact_phone: sale.delivery_contact_phone ?? null,
        delivery_contact_address: sale.delivery_contact_address ?? null,
      }
      after = sourceMatched ? {
        delivery_contact_id: targetContact?.id ?? null,
        delivery_contact_name: targetContact?.name ?? null,
        delivery_contact_phone: targetContact?.phone ?? null,
        delivery_contact_address: targetContact ? (targetContact.address || targetContact.area || null) : null,
      } : { ...before }
    } else {
      sourceMatched = matchedAtRead
      before = { customer_id: sale.customer_id ?? null, customer_name: sale.customer_name ?? null, customer_phone: sale.customer_phone ?? null, customer_address: sale.customer_address ?? null, search_normalized: sale.search_normalized ?? null }
      after = sourceMatched ? {
        customer_id: targetCustomer?.id ?? null,
        customer_name: targetCustomer?.name ?? null,
        customer_phone: targetCustomer?.phone ?? null,
        customer_address: targetCustomer?.address ?? null,
        search_normalized: searchSnapshot(sale, { customerName: targetCustomer?.name ?? null, customerPhone: targetCustomer?.phone ?? null }),
      } : { ...before }
      returnsAfter = returnsBefore.map((row, index) => {
        const source = memberReturnRows[index]
        return {
          ...row,
          customer_id: after.customer_id as number | null,
          customer_name: after.customer_name as string | null,
          search_normalized: normalizeSearchText([
            source.return_number,
            source.receipt_number,
            source.cashier_name,
            after.customer_name,
            source.branch_name,
            source.reason,
            source.return_type,
            source.notes,
          ].filter(Boolean).join(' ')),
        }
      })
    }
    const changed = sourceMatched && JSON.stringify(before) !== JSON.stringify(after)
    members.push({
      id: expected.id,
      receipt: String(sale.receipt_number || expected.id),
      changed,
      reason: changed ? 'changed' : sourceMatched ? 'already_target' : 'source_mismatch',
      before,
      after,
      returnsBefore,
      returnsAfter,
    })
  }
  const changedReference = members.find((member) => member.changed)
  if (changedReference) {
    for (const state of [referenceState(request.action, sourceReference), referenceState(request.action, request.action.kind === 'customer' ? targetCustomer : targetContact)]) {
      const guard = state ? referenceGuard(request.action, state) : null
      if (guard) guards.push(guard)
    }
  }

  const stamp = new Date().toISOString()
  const snapshot: BulkUpdateSnapshot = {
    version: 1,
    operationId,
    action: request.action,
    members,
    referenceBefore: referenceState(request.action, sourceReference),
    referenceAfter: referenceState(request.action, request.action.kind === 'customer' ? targetCustomer : targetContact),
  }
  const applier = saleBulkUpdateApplier(request.action)
  const changedIds = members.filter((member) => member.changed).map((member) => member.id)
  const unchangedIds = members.filter((member) => !member.changed).map((member) => member.id)
  const receipt = {
    operationId,
    action: request.action,
    changedIds,
    unchangedIds,
    changedCount: changedIds.length,
    unchangedCount: unchangedIds.length,
    currentReplayGeneration: 0,
    items: members.map((member) => ({ id: member.id, receipt_number: member.receipt, before: member.before, after: member.after, changed: member.changed, reason: member.reason })),
  }
  const statements: StockStatement[] = [
    ...guards,
    { sql: 'INSERT INTO sale_bulk_operations(id,actor_id,request_id,request_json,receipt_json) VALUES(@id,@actor,@request,@canonical,@receipt)', params: { id: operationId, actor: user.id, request: request.client_request_id, canonical, receipt: JSON.stringify(receipt) } },
  ]
  for (const member of members) statements.push(...saleUpdateStatement(member, request.action, 1, stamp))
  statements.push({ sql: 'INSERT INTO undo_snapshots(kind,payload_json,created_by_id,created_by_name) VALUES(@kind,@payload,@actor,@name)', params: { kind: BULK_UPDATE_KIND, payload: JSON.stringify(snapshot), actor: user.id, name: user.name } })
  statements.push({ sql: 'UPDATE sale_bulk_operations SET snapshot_id=last_insert_rowid() WHERE id=@id', params: { id: operationId } })
  const historyIndex = statements.length
  statements.push({
    sql: `INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
          SELECT 'global','sale',id,@label,@reversible,@status,
            json_object('applier',@kind,'snapshot_id',snapshot_id,'operation_id',id,'generation',0,'action',@action),
            json_object('applier',@kind,'snapshot_id',snapshot_id,'operation_id',id,'generation',0,'action',@action),@actor,@name
          FROM sale_bulk_operations WHERE id=@id`,
    params: { id: operationId, label: `${changedIds.length} sales: ${request.action.kind}; ${unchangedIds.length} unchanged`, reversible: changedIds.length ? 1 : 0, status: changedIds.length ? 'undoable' : 'recorded', kind: applier, action: request.action.kind, actor: user.id, name: user.name },
  })
  statements.push({ sql: "UPDATE sale_bulk_operations SET history_id=last_insert_rowid(),receipt_json=json_set(receipt_json,'$.actionHistoryId',last_insert_rowid()) WHERE id=@id", params: { id: operationId } })
  for (const member of members.filter((candidate) => candidate.changed)) {
    statements.push({ sql: `INSERT INTO sale_bulk_members(operation_id,sale_id,revision,movement_fingerprint) VALUES(@op,@id,COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=@id),0),${saleMovementFingerprint('@id')})`, params: { op: operationId, id: member.id } })
  }
  statements.push(auditStatement(user, operationId, 'sale_fields_bulk', request.action, changedIds.length))
  statements.push({ sql: 'DELETE FROM sale_bulk_guards', params: {} })
  bounded(statements, snapshot)
  try {
    const results = await db.batch(statements)
    return { ...receipt, actionHistoryId: Number(results[historyIndex].meta.last_row_id) }
  } catch (error) {
    const retry = await db.prepare('SELECT request_json,receipt_json FROM sale_bulk_operations WHERE actor_id=@actor AND request_id=@request').get<Row>({ actor: user.id, request: request.client_request_id })
    if (retry?.request_json === canonical) return JSON.parse(String(retry.receipt_json))
    if (/constraint/i.test(String(error))) fail('A sale or linked record changed. Nothing in the group was applied.')
    throw error
  }
}

export async function replaySaleBulkUpdate(env: Env, user: SessionUser, direction: 'undo' | 'redo', historyId: number, generation: unknown, payload: Row): Promise<void> {
  if (!Number.isSafeInteger(generation) || Number(generation) < 0) fail('Refresh history before replaying this group.')
  const db = getDb(env)
  const op = await db.prepare('SELECT o.*,s.payload_json,s.kind,s.status snapshot_status FROM sale_bulk_operations o JOIN undo_snapshots s ON s.id=o.snapshot_id WHERE o.history_id=?').get<Row>([historyId])
  if (!op || op.kind !== BULK_UPDATE_KIND || op.id !== payload.operation_id || op.snapshot_id !== payload.snapshot_id || op.generation !== generation) fail('This group has changed or its snapshot does not match.')
  const snapshot = JSON.parse(String(op.payload_json)) as BulkUpdateSnapshot
  if (snapshot.version !== 1 || snapshot.operationId !== op.id || snapshot.members.length > BULK_STATUS_LIMIT) fail('Unsupported bulk update snapshot.')
  if (payload.applier !== saleBulkUpdateApplier(snapshot.action)) fail('This group does not match its saved permission scope.')
  permission(user, snapshot.action)
  const sign: 1 | -1 = direction === 'undo' ? -1 : 1
  const expected = direction === 'undo' ? 'undoable' : 'redoable'
  const next = direction === 'undo' ? 'redoable' : 'undoable'
  const stamp = new Date().toISOString()
  const statements: StockStatement[] = [bulkAssertion("NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore') AND EXISTS(SELECT 1 FROM sale_bulk_operations o JOIN action_history h ON h.id=o.history_id JOIN undo_snapshots s ON s.id=o.snapshot_id WHERE o.id=@op AND o.generation=@generation AND h.id=@history AND h.status=@expected AND s.kind=@kind AND s.status=@snap AND s.payload_json=@payload)", { op: op.id, generation, history: historyId, expected, kind: BULK_UPDATE_KIND, snap: direction === 'undo' ? 'applied' : 'reversed', payload: op.payload_json })]
  for (const member of snapshot.members.filter((candidate) => candidate.changed)) {
    statements.push(bulkAssertion(`EXISTS(SELECT 1 FROM sales s JOIN sale_bulk_members m ON m.sale_id=s.id WHERE m.operation_id=@op AND s.id=@id AND m.revision=COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=s.id),0) AND m.movement_fingerprint=${saleMovementFingerprint('s.id')})`, { op: op.id, id: member.id }))
  }
  const changedReference = snapshot.members.find((member) => member.changed)
  if (changedReference) {
    const destinationReference = direction === 'undo'
      ? (snapshot.referenceBefore === undefined ? changedReference.before : snapshot.referenceBefore)
      : (snapshot.referenceAfter === undefined ? changedReference.after : snapshot.referenceAfter)
    const guard = destinationReference ? referenceGuard(snapshot.action, destinationReference) : null
    if (guard) statements.push(guard)
  }
  for (const member of snapshot.members) statements.push(...saleUpdateStatement(member, snapshot.action, sign, stamp))
  for (const member of snapshot.members.filter((candidate) => candidate.changed)) {
    statements.push({ sql: `UPDATE sale_bulk_members SET revision=COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=@id),0),movement_fingerprint=${saleMovementFingerprint('@id')} WHERE operation_id=@op AND sale_id=@id`, params: { op: op.id, id: member.id } })
  }
  statements.push({ sql: 'UPDATE sale_bulk_operations SET generation=generation+1 WHERE id=@op', params: { op: op.id } })
  statements.push({ sql: 'UPDATE undo_snapshots SET status=@status,updated_at=@stamp WHERE id=@id', params: { id: op.snapshot_id, status: direction === 'undo' ? 'reversed' : 'applied', stamp } })
  statements.push({ sql: "UPDATE action_history SET status=@status,last_error=NULL,updated_at=@stamp,undo_payload=json_set(undo_payload,'$.generation',@generation),redo_payload=json_set(redo_payload,'$.generation',@generation) WHERE id=@id", params: { id: historyId, status: next, stamp, generation: Number(generation) + 1 } })
  statements.push(auditStatement(user, String(op.id), `action_${direction}`, snapshot.action, snapshot.members.filter((member) => member.changed).length))
  statements.push({ sql: 'DELETE FROM sale_bulk_guards', params: {} })
  bounded(statements, snapshot)
  try {
    await db.batch(statements)
  } catch (error) {
    if (/constraint/i.test(String(error))) fail('A sale, linked record, or this replay changed. Nothing in the group was applied.')
    throw error
  }
}
