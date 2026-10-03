import type { BindParams, D1Compat } from './db'
import type { SessionUser } from './auth'
import { getActionTier } from './permissions'
import { readBranchCutoverJournal, type BranchCutoverJournalRow, type BranchCutoverOwnership } from './branchCutoverJournal'
import { planTransferOperation } from './transferOperation'
import { transferRequestDigest } from './transferOperationReceipt'
import { assertTransferStatementsFit, type TransferInvocationBudget } from './transferRunBudget'

type Statement = { sql: string; params?: Record<string, unknown> }
type Child = { version: 1; kind: 'branch-cutover-child'; operationId: string; sequence: number; actorId: number; organizationId: string; controlIncarnation: string; sourceBranchId: number; targetBranchId: number; reason: string; transfer: { productId: number; quantity: number; batchId: number | null; destProductId?: number } }
type Receipt = Record<string, unknown>
type ProofRows = { receipt: Receipt | undefined; members: Receipt[]; history: Receipt | undefined }
export type BranchCutoverChildResult = { row: BranchCutoverJournalRow; receipt: Record<string, unknown>; replayed: boolean }
export class BranchCutoverChildOutcomeUnknown extends Error {
  readonly code = 'branch_cutover_child_outcome_unknown'
  readonly outcome = 'unknown'
  constructor(cause: unknown) { super('The planned child outcome is unconfirmed. Reconcile this exact child before continuing.', { cause }) }
}
const encoder = new TextEncoder()
const SNAPSHOT_BYTES = 262144
const SQL_PAYLOAD_BYTES = 1048576
const EPSILON = 0.000000001
const positiveId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0
const quantity = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
const bytes = (value: string): number => encoder.encode(value).length
function requireChild(condition: unknown): asserts condition { if (!condition) throw new Error('branch_cutover_child_conflict') }
function object(text: unknown, limit = SNAPSHOT_BYTES): Record<string, unknown> {
  requireChild(typeof text === 'string' && bytes(text) <= limit)
  const result: unknown = JSON.parse(text)
  requireChild(result !== null && typeof result === 'object' && !Array.isArray(result))
  return result as Record<string, unknown>
}
function childIntent(row: BranchCutoverJournalRow, expected: { sequence: number; childJson: string }): Child {
  requireChild(Number.isSafeInteger(expected.sequence) && expected.sequence >= 0)
  const value = object(expected.childJson, 65536)
  const transfer = value.transfer as Child['transfer'] | undefined
  requireChild(value.version === 1 && value.kind === 'branch-cutover-child' && value.operationId === row.operation_id
    && value.sequence === expected.sequence && value.actorId === row.actor_id && value.organizationId === row.organization_id
    && value.controlIncarnation === row.control_incarnation && value.sourceBranchId === row.source_branch_id && value.targetBranchId === row.target_branch_id
    && typeof value.reason === 'string' && value.reason.trim().length > 0 && bytes(value.reason) <= 1024
    && transfer && positiveId(transfer.productId) && quantity(transfer.quantity) && transfer.quantity > 0
    && (transfer.batchId === null || positiveId(transfer.batchId)) && (transfer.destProductId === undefined || transfer.destProductId === transfer.productId))
  requireChild(Object.keys(value).every(key => ['version', 'kind', 'operationId', 'sequence', 'actorId', 'organizationId', 'controlIncarnation', 'sourceBranchId', 'targetBranchId', 'reason', 'transfer'].includes(key))
    && Object.keys(transfer).every(key => ['productId', 'quantity', 'batchId', 'destProductId'].includes(key)))
  return value as unknown as Child
}
const actorSelect = `SELECT u.id,u.username,u.name,u.organization_id,u.role_id,u.permissions,u.is_active,r.code AS role_code,r.permissions AS role_permissions
  FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=@actor AND u.deleted_at IS NULL`
const receiptSelect = `SELECT id,actor_id,request_id,request_digest,status,operation_id,provenance_version,replay_state,generation,action_history_id,
  CASE WHEN length(CAST(request_json AS BLOB))<=65536 THEN request_json END AS request_json,
  CASE WHEN length(CAST(response_json AS BLOB))<=8192 THEN response_json END AS response_json
  FROM transfer_operation_receipts WHERE actor_id=@actor AND request_id=@request`
const memberSelect = `SELECT ordinal,source_product_id,destination_product_id,source_branch_id,destination_branch_id,quantity,untracked_quantity,
  CASE WHEN length(CAST(source_snapshot AS BLOB))<=262144 THEN source_snapshot END AS source_snapshot,
  CASE WHEN length(CAST(destination_snapshot AS BLOB))<=262144 THEN destination_snapshot END AS destination_snapshot,
  CASE WHEN length(CAST(allocations_json AS BLOB))<=262144 THEN allocations_json END AS allocations_json
  FROM transfer_operation_members WHERE receipt_id=(SELECT id FROM transfer_operation_receipts WHERE actor_id=@actor AND request_id=@request) ORDER BY ordinal LIMIT 2`
const historySelect = `SELECT id,scope,entity,entity_id,status,reversible,created_by_id,
  CASE WHEN length(CAST(undo_payload AS BLOB))<=4096 THEN undo_payload END AS undo_payload,
  CASE WHEN length(CAST(redo_payload AS BLOB))<=4096 THEN redo_payload END AS redo_payload
  FROM action_history WHERE id=(SELECT action_history_id FROM transfer_operation_receipts WHERE actor_id=@actor AND request_id=@request)`
async function readReceipt(db: D1Compat, params: Record<string, unknown>): Promise<ProofRows> {
  const receipt = await db.prepare(receiptSelect).get<Receipt>(params)
  if (!receipt) return { receipt, members: [], history: undefined }
  const members = await db.prepare(memberSelect).all<Receipt>(params)
  const history = await db.prepare(historySelect).get<Receipt>(params)
  return { receipt, members, history }
}
function receiptProof(row: BranchCutoverJournalRow, child: Child, exactJson: string, digest: string, key: string, proof: ProofRows): Record<string, unknown> {
  const r = proof.receipt; const h = proof.history; const m = proof.members[0]
  requireChild(row.next_sequence > child.sequence && row.committed_children === row.next_sequence && r && h && proof.members.length === 1
    && r.actor_id === child.actorId && r.request_id === key && r.request_json === exactJson && r.request_digest === digest
    && r.status === 'committed' && r.provenance_version === 1 && r.generation === 0 && r.replay_state === 'applied'
    && typeof r.operation_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(r.operation_id) && r.operation_id !== row.operation_id
    && positiveId(r.action_history_id) && h.id === r.action_history_id && h.entity_id === r.operation_id && h.entity === 'stock_transfer'
    && h.scope === 'branches' && h.status === 'undoable' && h.reversible === 1 && h.created_by_id === child.actorId
    && m.ordinal === 0 && m.source_product_id === child.transfer.productId && m.destination_product_id === child.transfer.productId
    && m.source_branch_id === child.sourceBranchId && m.destination_branch_id === child.targetBranchId && m.quantity === child.transfer.quantity
    && quantity(m.untracked_quantity))
  for (const payload of [h.undo_payload, h.redo_payload]) {
    const value = object(payload, 4096)
    requireChild(value.applier === 'stock.transfer' && value.operation_id === r.operation_id && value.generation === 0 && value.permission === 'branches')
  }
  const response = object(r.response_json, 8192)
  requireChild(response.success === true && response.parent_operation_id === child.operationId && response.child_sequence === child.sequence
    && response.operation_id === r.operation_id && response.action_history_id === r.action_history_id && response.generation === 0 && response.provenance_version === 1)
  const source = object(m.source_snapshot); const destination = object(m.destination_snapshot)
  requireChild(source.id === child.transfer.productId && destination.id === child.transfer.productId && typeof m.allocations_json === 'string' && bytes(m.allocations_json) <= SNAPSHOT_BYTES)
  const { untracked_cost_snapshot: untrackedCost, ...catalogSource } = source
  requireChild(source.is_active === 1 && JSON.stringify(catalogSource) === JSON.stringify(destination))
  const allocations: unknown = JSON.parse(m.allocations_json)
  requireChild(Array.isArray(allocations) && allocations.length <= 128)
  const seen = new Set<number>(); let total = Number(m.untracked_quantity)
  for (const allocation of allocations) {
    requireChild(allocation && typeof allocation === 'object')
    const a = allocation as Record<string, any>
    requireChild(positiveId(a.source_batch_id) && a.destination_batch_id === a.source_batch_id && !seen.has(a.source_batch_id)
      && quantity(a.quantity) && a.quantity > 0 && (child.transfer.batchId === null || child.transfer.batchId === a.source_batch_id)
      && a.source_snapshot?.id === a.source_batch_id && a.destination_snapshot?.id === a.source_batch_id
      && a.source_snapshot.variant_product_id === child.transfer.productId && a.destination_snapshot.variant_product_id === child.transfer.productId
      && JSON.stringify(a.source_snapshot) === JSON.stringify(a.destination_snapshot) && a.destination_batch_key === a.source_snapshot.batch_key)
    seen.add(a.source_batch_id); total += a.quantity
    validateCost(a.cost_snapshot, a.quantity)
  }
  requireChild(Math.abs(total - child.transfer.quantity) <= EPSILON && (child.transfer.batchId === null || m.untracked_quantity === 0))
  if (Number(m.untracked_quantity) > 0) validateCost(untrackedCost, Number(m.untracked_quantity))
  requireChild(response.destBatchId === (child.transfer.batchId === null ? null : child.transfer.batchId))
  return response
}
function validateCost(value: unknown, amount: number): void {
  requireChild(value && typeof value === 'object')
  const pair = value as Record<string, unknown>
  for (const currency of ['Usd', 'Khr']) {
    const unit = pair['unitCost' + currency]; const total = pair['totalCost' + currency]
    requireChild((unit === null && total === null) || (quantity(unit) && quantity(total) && Math.abs(total - unit * amount) <= 0.000100001))
  }
}
const assertSql = (condition: string, params: Record<string, unknown>): Statement => ({ sql: `SELECT CASE WHEN (${condition}) THEN 1 ELSE json_extract('[1]','$[branch_cutover_child_conflict]') END`, params })
const positiveLots = `SELECT b.id,b.variant_product_id,b.batch_key,b.lot_code,b.received_at,b.expiry_date,b.notes,b.is_active,b.batch_number,b.unit_cost_usd,s.branch_id,s.quantity
  FROM product_batches b JOIN branch_batch_stock s ON s.batch_id=b.id WHERE b.variant_product_id=@product AND s.branch_id IN (@source,@target) AND s.quantity>0`
const lotFingerprint = `SELECT json_group_array(json_array(id,variant_product_id,batch_key,lot_code,received_at,expiry_date,notes,is_active,batch_number,unit_cost_usd,branch_id,quantity)) FROM (${positiveLots} ORDER BY b.id,s.branch_id)`
const lotBytes = `COALESCE(SUM(length(CAST(json_array(id,variant_product_id,batch_key,lot_code,received_at,expiry_date,notes,is_active,batch_number,unit_cost_usd,branch_id,quantity) AS BLOB))+1),0)+2`

export async function executePlannedBranchCutoverChild(db: D1Compat, actor: SessionUser, ownership: BranchCutoverOwnership,
  expected: { sequence: number; childJson: string }, budget: TransferInvocationBudget, organizationId: number): Promise<BranchCutoverChildResult> {
  requireChild(positiveId(organizationId) && actor.id === ownership.actorId && actor.organization_id === organizationId
    && ownership.organizationId === String(organizationId) && actor.is_active === 1)
  requireChild(budget.extraAtomicStatements === 0)
  assertTransferStatementsFit(budget, 38)
  const reservedBudget = { ...budget, remainingReads: budget.remainingReads + 24, retryQueries: budget.retryQueries + 14 }
  assertTransferStatementsFit(reservedBudget, 0)
  const current = await db.prepare(actorSelect).get<SessionUser>({ actor: actor.id })
  requireChild(current && current.is_active === 1 && current.organization_id === organizationId && getActionTier(current, 'branches', 'transfer') === 'full')
  const row = await readBranchCutoverJournal(db, ownership)
  requireChild(['moving', 'verifying', 'ready'].includes(row.phase))
  const child = childIntent(row, expected); const key = `bc_${row.operation_id}_${expected.sequence}`; const digest = await transferRequestDigest(expected.childJson)
  const receiptParams = { actor: actor.id, request: key }
  const existing = await readReceipt(db, receiptParams)
  if (existing.receipt) return { row, receipt: receiptProof(row, child, expected.childJson, digest, key, existing), replayed: true }
  requireChild(row.phase === 'moving' && row.revision < Number.MAX_SAFE_INTEGER && row.next_sequence === expected.sequence && row.next_sequence < Number.MAX_SAFE_INTEGER
    && row.planned_child_json === expected.childJson && row.planned_child_key === key && row.planned_child_digest === digest)
  const stockParams = { product: child.transfer.productId, source: child.sourceBranchId, target: child.targetBranchId }
  const summary = await db.prepare(`SELECT COUNT(*) AS count,COUNT(DISTINCT id) AS lots,COALESCE(SUM(length(CAST(json_array(id,variant_product_id,batch_key,lot_code,received_at,expiry_date,notes,is_active,batch_number,unit_cost_usd,branch_id,quantity) AS BLOB))+1),0)+2 AS bytes,
    COALESCE(SUM(CASE WHEN branch_id=@source THEN quantity ELSE 0 END),0) AS sourceTotal,
    COALESCE(SUM(CASE WHEN branch_id=@target THEN quantity ELSE 0 END),0) AS targetTotal,
    COALESCE(SUM(CASE WHEN COALESCE(is_active,0)<>1 OR quantity>9007199254740991 THEN 1 ELSE 0 END),0) AS invalid FROM (${positiveLots})`).get<Record<string, number>>(stockParams)
  requireChild(summary && summary.lots <= 128 && summary.count <= 256 && summary.bytes <= SNAPSHOT_BYTES && summary.invalid === 0)
  const stocks = await db.prepare(`SELECT branch_id,quantity FROM branch_stock WHERE product_id=@product AND branch_id IN (@source,@target) ORDER BY branch_id`).all<{ branch_id: number; quantity: number }>(stockParams)
  const sourceStock = stocks.find(stock => stock.branch_id === child.sourceBranchId)?.quantity
  const targetRow = stocks.find(stock => stock.branch_id === child.targetBranchId)
  const targetStock = targetRow ? targetRow.quantity : 0
  requireChild(quantity(sourceStock) && quantity(targetStock) && quantity(targetStock + child.transfer.quantity) && sourceStock >= child.transfer.quantity
    && summary.sourceTotal <= sourceStock + EPSILON && summary.targetTotal <= targetStock + EPSILON
    && Math.abs((targetStock + child.transfer.quantity) - targetStock - child.transfer.quantity) <= EPSILON
    && Math.abs(sourceStock - (sourceStock - child.transfer.quantity) - child.transfer.quantity) <= EPSILON)
  const boundedLots = `(SELECT COUNT(DISTINCT id)<=128 AND COUNT(*)<=256 AND ${lotBytes}<=${SNAPSHOT_BYTES} FROM (${positiveLots}))`
  const fingerprint = await db.prepare(`SELECT CASE WHEN ${boundedLots} THEN (${lotFingerprint}) END AS value`).get<{ value: string }>(stockParams)
  requireChild(fingerprint && typeof fingerprint.value === 'string' && bytes(fingerprint.value) <= SNAPSHOT_BYTES)
  assertTransferStatementsFit(reservedBudget, 29 + summary.lots)
  const boundedReadGate = boundedLots.replaceAll('@product', String(child.transfer.productId)).replaceAll('@source', String(child.sourceBranchId)).replaceAll('@target', String(child.targetBranchId))
    + ` AND EXISTS(SELECT 1 FROM products WHERE id=${child.transfer.productId} AND length(CAST(json_array(name,barcode,created_at) AS BLOB))<=65536)`
  const planningDb = new Proxy(db, { get(target, property, receiver) {
    if (property !== 'prepare') return Reflect.get(target, property, receiver)
    return (sql: string) => ({ all: async <T>(params?: BindParams): Promise<T[]> => {
      const rows = await target.prepare(`SELECT * FROM (${sql}) WHERE ${boundedReadGate} LIMIT 129`).all<T>(params)
      requireChild(rows.length <= 128 && bytes(JSON.stringify(rows)) <= SNAPSHOT_BYTES)
      return rows
    } })
  } })
  const planned = await planTransferOperation(planningDb, { user: current, requestId: key, requestJson: expected.childJson, digest, scope: 'branches',
    fromBranchId: child.sourceBranchId, toBranchId: child.targetBranchId, reason: child.reason,
    lines: [{ productId: child.transfer.productId, destProductId: child.transfer.productId, quantity: child.transfer.quantity, batchId: child.transfer.batchId }],
    response: { success: true, parent_operation_id: row.operation_id, child_sequence: expected.sequence } })
  const lotQuantities = JSON.parse(fingerprint.value) as unknown[][]
  for (const take of planned.allocationSummaries[0].takes) {
    const from = lotQuantities.find(lot => lot[0] === take.batchId && lot[10] === child.sourceBranchId)?.[11]
    const to = lotQuantities.find(lot => lot[0] === take.batchId && lot[10] === child.targetBranchId)?.[11] ?? 0
    requireChild(quantity(from) && quantity(to) && from >= take.quantity && quantity(to + take.quantity)
      && Math.abs(from - (from - take.quantity) - take.quantity) <= EPSILON
      && Math.abs((to + take.quantity) - to - take.quantity) <= EPSILON)
  }
  for (const statement of planned.statements) {
    if (typeof statement.params?.allocations !== 'string') continue
    const allocations = JSON.parse(statement.params.allocations) as Array<{ cost_snapshot: unknown; quantity: number }>
    for (const allocation of allocations) validateCost(allocation.cost_snapshot, allocation.quantity)
    if (Number(statement.params.untracked) > 0) validateCost(object(statement.params.sourceSnapshot).untracked_cost_snapshot, Number(statement.params.untracked))
  }
  const params = { operation: row.operation_id, revision: row.revision, sequence: row.next_sequence, actor: actor.id, organization: organizationId,
    organizationText: row.organization_id, token: ownership.token, control: ownership.controlIncarnation, flag: row.maintenance_flag_json,
    child: expected.childJson, key, digest, role: current.role_id, permissions: current.permissions, roleCode: current.role_code ?? null,
    rolePermissions: current.role_permissions ?? null, childOperation: planned.operationId }
  const owned = `EXISTS(SELECT 1 FROM branch_cutovers WHERE operation_id=@operation AND revision=@revision AND phase='moving' AND next_sequence=@sequence
    AND actor_id=@actor AND organization_id=@organizationText AND maintenance_token=@token AND control_incarnation=@control
    AND planned_child_json=@child AND planned_child_key=@key AND planned_child_digest=@digest AND maintenance_flag_json=@flag)
    AND EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND value=@flag)
    AND EXISTS(SELECT 1 FROM system_flags WHERE key='branch_cutover_control_incarnation' AND value=@control)`
  const statements: Statement[] = [assertSql(owned, params), assertSql(`EXISTS(SELECT 1 FROM (${actorSelect}) WHERE is_active=1 AND organization_id=@organization
    AND role_id IS @role AND permissions IS @permissions AND role_code IS @roleCode AND role_permissions IS @rolePermissions)`, params),
    assertSql(`COALESCE((SELECT quantity FROM branch_stock WHERE product_id=@product AND branch_id=@source),-1)=@sourceQuantity
      AND COALESCE((SELECT quantity FROM branch_stock WHERE product_id=@product AND branch_id=@target),0)=@targetQuantity
      AND (${lotFingerprint})=@fingerprint
      AND NOT EXISTS(SELECT 1 FROM branch_batch_stock s JOIN product_batches b ON b.id=s.batch_id WHERE b.variant_product_id=@product
        AND s.branch_id IN (@source,@target) AND (s.quantity<0 OR typeof(s.quantity) NOT IN ('integer','real')))`,
    { ...stockParams, sourceQuantity: sourceStock, targetQuantity: targetStock, fingerprint: fingerprint.value }), ...planned.statements,
    { sql: `UPDATE branch_cutovers SET next_sequence=next_sequence+1,committed_children=committed_children+1,revision=revision+1,
      planned_child_json=NULL,planned_child_key=NULL,planned_child_digest=NULL,updated_at=@now WHERE operation_id=@operation AND revision=@revision AND phase='moving' AND planned_child_json=@child`, params: { ...params, now: new Date().toISOString() } },
    assertSql(`EXISTS(SELECT 1 FROM branch_cutovers WHERE operation_id=@operation AND revision=@revision+1 AND phase='moving' AND next_sequence=@sequence+1 AND committed_children=@sequence+1 AND planned_child_json IS NULL)
      AND EXISTS(SELECT 1 FROM transfer_operation_receipts WHERE operation_id=@childOperation AND actor_id=@actor AND request_id=@key AND request_digest=@digest AND request_json=@child AND status='committed' AND provenance_version=1 AND generation=0 AND replay_state='applied')`, params),
    { sql: 'SELECT * FROM branch_cutovers WHERE operation_id=@operation', params },
    { sql: receiptSelect, params: receiptParams }, { sql: memberSelect, params: receiptParams }, { sql: historySelect, params: receiptParams }]
  assertTransferStatementsFit(reservedBudget, statements.length)
  requireChild(statements.reduce((sum, statement) => sum + bytes(statement.sql) + bytes(JSON.stringify(statement.params ?? {})), 0) <= SQL_PAYLOAD_BYTES)
  requireChild(planned.statements.reduce((sum, statement) => sum + Object.entries(statement.params ?? {}).filter(([key]) => /snapshot|allocations/i.test(key)).reduce((size, [, value]) => size + bytes(String(value)), 0), 0) <= SNAPSHOT_BYTES)
  try {
    const results = await db.batchOnce(statements)
    const committed = results.at(-4)?.results?.[0] as BranchCutoverJournalRow | undefined
    requireChild(committed)
    const proof = { receipt: results.at(-3)?.results?.[0] as Receipt | undefined, members: (results.at(-2)?.results ?? []) as Receipt[], history: results.at(-1)?.results?.[0] as Receipt | undefined }
    return { row: committed, receipt: receiptProof(committed, child, expected.childJson, digest, key, proof), replayed: false }
  } catch (cause) {
    try {
      const committed = await readBranchCutoverJournal(db, ownership)
      const proof = await readReceipt(db, receiptParams)
      if (proof.receipt) return { row: committed, receipt: receiptProof(committed, child, expected.childJson, digest, key, proof), replayed: true }
    } catch { }
    throw new BranchCutoverChildOutcomeUnknown(cause)
  }
}
