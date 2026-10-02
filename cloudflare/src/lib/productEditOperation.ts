import type { Env } from '../index'
import type { SessionUser } from './auth'
import type { BindParams, D1Compat } from './db'
import type { PendingActionRow } from './pendingActions'
import { getDb } from './db'
import { actorSnapshot } from './actorSnapshot'
import { canEditAcquisitionCosts, projectAcquisitionCosts } from './acquisitionCostAccess'
import { getActionTier, getMergedPermissions, isAdminControlUser, hasPermission } from './permissions'
import { planProductRowUpdate, readProductMoneyPlan, normalizeMultiValue, tableColumns, validateProductImageGallery, restrictToImageOnlyFields } from './productWrites'
import { planCatalogCostRestoration, type SavedCatalogCostBasis } from './catalogCostRecompute'

export const PRODUCT_EDIT_KIND = 'product.edit.v1'
type SqlStatement = { sql: string; params?: BindParams }
type ProductRow = Record<string, string | number | null>
type Direction = 'undo' | 'redo'
type LinkedRow = { id: number; product_id: number; value: string | null }
type ProductEditState = { rows: ProductRow[]; gallery: ProductRow[]; basis: SavedCatalogCostBasis; linked: Record<string, LinkedRow[]>; valuation?: ProductRow[] }
type ProductEditEffects = { ordinary_fields: string[]; money_fields: string[]; manual_cost: boolean; images: boolean; renamed_ids: number[] }
type ProductEditReceipt = {
  version: 1; request_id: string; digest: string; product_id: number; actor_id: number; actor_name: string | null;
  input_fields: string[]; body: Record<string, unknown>; effects: ProductEditEffects; before: ProductEditState; after: ProductEditState | null;
  history_id: number | null; pending_id: number | null; generation: number; transitions: Array<{ direction: Direction; generation: number; actor_id: number; entry_id: number | null }>;
  pending_replay?: { id: number; direction: Direction; generation: number; actor_id: number } | null;
}
type SnapshotRow = { id: number; status: string; payload_json: string; created_by_id: number }
export type ProductEditIdentity = { requestId: string; digest: string; inputFields: string[] }
const moneyFields = ['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr']
const derivedFields = new Set(['id', 'created_at', 'updated_at', 'name_key', 'is_grouped_cached', 'stock_quantity'])
const nameRelations = [
  ['sale_items', 'product_id', 'product_name'], ['inventory_movements', 'product_id', 'product_name'],
  ['return_items', 'product_id', 'product_name'], ['stock_transfers', 'product_id', 'product_name'],
  ['damaged_stock_lots', 'product_id', 'product_name'], ['return_replacement_items', 'product_id', 'product_name'],
  ['stock_row_moves', 'source_product_id', 'source_product_name'], ['stock_row_moves', 'destination_product_id', 'destination_product_name'],
] as const
const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
const balanced = (terms: string[]): string => terms.length === 0 ? '1' : terms.length === 1 ? terms[0] : `(${balanced(terms.slice(0, Math.ceil(terms.length / 2)))} AND ${balanced(terms.slice(Math.ceil(terms.length / 2)))})`
const guard = (condition: string, params?: BindParams): SqlStatement => ({ sql: `SELECT CASE WHEN ${condition} THEN 1 ELSE json('product_edit_state_conflict') END`, params })
const changedGuard = () => guard('changes() = 1')
const validId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0
const json = (value: unknown) => JSON.stringify(value)

export class ProductEditError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 409) { super(message); this.name = 'ProductEditError' }
}
function denied(code = 'product_edit_permission_required'): never { throw new ProductEditError(code, 'Current permission is required to apply this product change.', 403) }
function authorize(user: SessionUser, effects?: ProductEditEffects, full = false): void {
  const imageOnly = hasPermission(user, 'products_image_only') && getActionTier(user, 'products', 'view') === 'none'
    && (!effects || (!effects.money_fields.length && !effects.renamed_ids.length && effects.ordinary_fields.every(field => field === 'image_path')))
  if (!validId(user.id) || (!imageOnly && (getActionTier(user, 'products', 'edit') === 'none' || (full && getActionTier(user, 'products', 'edit') !== 'full')))) denied()
  if (effects?.money_fields.length && !canEditAcquisitionCosts(user)) denied('product_cost_edit_required')
  if (effects?.images && !imageOnly && (getActionTier(user, 'products', 'image') === 'none' || (full && getActionTier(user, 'products', 'image') !== 'full'))) denied('product_image_edit_required')
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]))
  return value
}
export async function productEditIdentity(productId: number, body: Record<string, unknown>): Promise<ProductEditIdentity> {
  if (!validId(productId)) throw new ProductEditError('invalid_product_id', 'A valid product is required.', 400)
  if (owns(body, '_product_edit_request')) throw new ProductEditError('product_edit_request_invalid', 'The product edit request contains reserved data.', 400)
  const requestId = body.client_request_id == null ? `legacy-edit-${crypto.randomUUID()}` : body.client_request_id
  if (typeof requestId !== 'string' || requestId.length < 8 || requestId.length > 120 || /[^A-Za-z0-9_-]/.test(requestId)) throw new ProductEditError('invalid_client_request_id', 'A stable client_request_id is required.', 400)
  const intent = Object.fromEntries(Object.entries(body).filter(([key]) => !['client_request_id', 'device_name', 'device_tz', 'client_time'].includes(key)))
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json(canonical({ product_id: productId, body: intent })))))].map(value => value.toString(16).padStart(2, '0')).join('')
  return { requestId, digest, inputFields: Object.keys(intent) }
}
function parse(row: SnapshotRow): ProductEditReceipt {
  let value: ProductEditReceipt
  try { value = JSON.parse(row.payload_json) } catch { throw new ProductEditError('undo_history_unusable', 'The saved product edit is invalid.') }
  if (value.version !== 1 || value.actor_id !== row.created_by_id || !validId(value.product_id) || !Array.isArray(value.before?.rows) || !Array.isArray(value.effects?.money_fields) || !Array.isArray(value.transitions)) throw new ProductEditError('undo_history_unusable', 'The saved product edit is invalid.')
  return value
}
async function lookup(db: D1Compat, actorId: number, requestId: string): Promise<SnapshotRow | undefined> {
  return db.prepare(`SELECT id,status,payload_json,created_by_id FROM undo_snapshots WHERE kind='product.edit.v1' AND created_by_id=@actor AND json_extract(payload_json,'$.request_id')=@request`).get<SnapshotRow>({ actor: actorId, request: requestId })
}
const pointer = (id: number, generation: number) => ({ applier: PRODUCT_EDIT_KIND, operation_id: String(id), generation })
async function response(env: Env, row: SnapshotRow, user: SessionUser, replayed = false): Promise<Record<string, unknown>> {
  const saved = parse(row)
  authorize(user, saved.effects)
  if (row.status === 'approval_pending') return { success: true, applied: false, pending: true, pendingActionId: saved.pending_id, operation_id: String(row.id), generation: saved.generation, replayed }
  const db = getDb(env)
  const history = await db.prepare('SELECT * FROM action_history WHERE id=@id').get<Record<string, unknown>>({ id: saved.history_id })
  if (!history || history.entity_id !== String(saved.product_id) || Number(history.created_by_id) !== saved.actor_id) throw new ProductEditError('undo_history_unusable', 'The product edit history is unavailable.')
  const safePointer = pointer(row.id, saved.generation)
  const product = saved.after?.rows.find(product => product.id === saved.product_id)
  const item = product && hasPermission(user, 'products_image_only') && getActionTier(user, 'products', 'view') === 'none' ? restrictToImageOnlyFields(product, getMergedPermissions(user)) : product
  return projectAcquisitionCosts({ success: true, applied: true, action_history_id: saved.history_id, operation_id: String(row.id), generation: saved.generation,
    undo_payload: safePointer, redo_payload: safePointer, history: { ...history, reversible: true, server_replayable: true, undo_payload: safePointer, redo_payload: safePointer }, item, replayed }, user) as Record<string, unknown>
}
export async function recoverProductEdit(env: Env, user: SessionUser, identity: ProductEditIdentity): Promise<Record<string, unknown> | null> {
  authorize(user)
  const row = await lookup(getDb(env), user.id, identity.requestId)
  if (!row) return null
  if (parse(row).digest !== identity.digest) throw new ProductEditError('idempotency_conflict', 'This request was already used for a different product edit.')
  return response(env, row, user, true)
}
function rowJson(columns: string[], alias = 'p'): string {
  let expression = `json('{}')`
  for (let index = 0; index < columns.length; index += 20) expression = `json_set(${expression},${columns.slice(index, index + 20).flatMap(column => [`'$.${column}'`, `${alias}."${column}"`]).join(',')})`
  return expression
}
const basisSql = (productId: number) => `COALESCE((SELECT json_object('kind','entry','original_entry_id',id,'cost_usd',cost_usd,'cost_khr',cost_khr,'baseline_batch_id',baseline_batch_id) FROM product_cost_entries WHERE product_id=${productId} ORDER BY id DESC LIMIT 1),json_object('kind','none'))`
const valuationSql = `SELECT pb.id,pb.unit_cost_usd,pb.received_at,pb.is_active,bbs.branch_id,bbs.quantity FROM product_batches pb LEFT JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id WHERE pb.variant_product_id=@product ORDER BY pb.id,bbs.branch_id`
async function capture(env: Env, productId: number, ids: number[], renamedIds: number[]): Promise<ProductEditState> {
  const db = getDb(env)
  const rows = await db.prepare('SELECT * FROM products WHERE id IN (SELECT value FROM json_each(@ids)) ORDER BY id').all<ProductRow>({ ids: json(ids) })
  if (rows.length !== ids.length) throw new ProductEditError('product_edit_state_conflict', 'A product is no longer available.')
  const gallery = await db.prepare('SELECT * FROM product_images WHERE product_id=@id ORDER BY sort_order,id').all<ProductRow>({ id: productId })
  const basis = await db.prepare(`SELECT ${basisSql(productId)} AS value`).get<{ value: string }>()
  const valuation = await db.prepare(valuationSql).all<ProductRow>({ product: productId })
  const linked: Record<string, LinkedRow[]> = {}
  if (renamedIds.length) for (const [table, productColumn, nameColumn] of nameRelations) {
    linked[`${table}.${nameColumn}`] = await db.prepare(`SELECT id,"${productColumn}" AS product_id,"${nameColumn}" AS value FROM "${table}" WHERE "${productColumn}" IN (SELECT value FROM json_each(@ids)) ORDER BY id`).all<LinkedRow>({ ids: json(renamedIds) })
  }
  return { rows, gallery, basis: JSON.parse(basis!.value), linked, valuation }
}
function stateGuards(state: ProductEditState, productId: number, columns: string[], images: boolean, money: boolean): SqlStatement[] {
  const statements = [guard(`NOT EXISTS (SELECT 1 FROM json_each(@rows) e WHERE NOT EXISTS (SELECT 1 FROM products p WHERE ${balanced(columns.map(column => `p."${column}" IS json_extract(e.value,'$.${column}')`))}))`, { rows: json(state.rows) })]
  if (money) statements.push(guard(`NOT EXISTS(SELECT 1 FROM json_each(@basis) e WHERE json_extract(${basisSql(productId)},'$.'||e.key) IS NOT e.value)`, { basis: json(state.basis) }))
  if (money) statements.push(guard(`(SELECT COUNT(*) FROM (${valuationSql}))=json_array_length(@rows) AND NOT EXISTS(SELECT 1 FROM json_each(@rows) e WHERE NOT EXISTS(SELECT 1 FROM (${valuationSql}) actual WHERE ${balanced(['id','unit_cost_usd','received_at','is_active','branch_id','quantity'].map(key => `actual."${key}" IS json_extract(e.value,'$.${key}')`))}))`, { product: productId, rows: json(state.valuation || []) }))
  if (images) statements.push(guard(`(SELECT json_group_array(json_object('id',id,'product_id',product_id,'image_path',image_path,'sort_order',sort_order,'created_at',created_at)) FROM (SELECT * FROM product_images WHERE product_id=@id ORDER BY sort_order,id))=@gallery`, { id: productId, gallery: json(state.gallery) }))
  for (const [table, productColumn, nameColumn] of nameRelations) {
    const key = `${table}.${nameColumn}`
    if (!owns(state.linked, key)) continue
    statements.push(guard(`NOT EXISTS(SELECT 1 FROM json_each(@rows) e WHERE NOT EXISTS(SELECT 1 FROM "${table}" r WHERE r.id=json_extract(e.value,'$.id') AND r."${productColumn}"=json_extract(e.value,'$.product_id') AND r."${nameColumn}" IS json_extract(e.value,'$.value')))`, { rows: json(state.linked[key]) }))
  }
  return statements
}
function galleryStatements(productId: number, gallery: string[]): SqlStatement[] {
  return [{ sql: 'DELETE FROM product_images WHERE product_id=@id', params: { id: productId } }, ...gallery.map((imagePath, sortOrder) => ({ sql: 'INSERT INTO product_images(product_id,image_path,sort_order) VALUES(@id,@path,@order)', params: { id: productId, path: imagePath, order: sortOrder } }))]
}
function linkedStatements(before: ProductEditState, productId: number, nextName: string): SqlStatement[] {
  return nameRelations.filter(([table, , nameColumn]) => owns(before.linked, `${table}.${nameColumn}`)).map(([table, productColumn, nameColumn]) => ({ sql: `UPDATE "${table}" SET "${nameColumn}"=@name WHERE "${productColumn}"=@id`, params: { id: productId, name: nextName } }))
}
function approvalStatements(row: PendingActionRow, reviewer: SessionUser): SqlStatement[] {
  return [{ sql: `UPDATE pending_actions SET status='approved',reviewed_by=@actor,reviewed_by_name=@name,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=@id AND status='open' AND payload_json=@payload AND requested_by IS @requester`, params: { id: row.id, actor: reviewer.id, name: actorSnapshot(reviewer), payload: row.payload_json, requester: row.requested_by } }, changedGuard(),
    { sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details) VALUES(@actor,@name,'approve','pending_action',@id,@details)`, params: { actor: reviewer.id, name: actorSnapshot(reviewer), id: String(row.id), details: json({ requester_id: row.requested_by }) } }]
}
export async function commitProductEdit(env: Env, user: SessionUser, productId: number, body: Record<string, unknown>, identity: ProductEditIdentity, approval?: { row: PendingActionRow; reviewer: SessionUser }): Promise<Record<string, unknown>> {
  authorize(user)
  const db = getDb(env)
  const previous = await lookup(db, user.id, identity.requestId)
  if (previous && !approval) {
    if (parse(previous).digest !== identity.digest) throw new ProductEditError('idempotency_conflict', 'This request was already used for a different product edit.')
    return response(env, previous, user, true)
  }
  if ('category' in body || 'categories' in body) body.categories = normalizeMultiValue(body.category, body.categories)
  if ('brand' in body || 'brands' in body) body.brands = normalizeMultiValue(body.brand, body.brands)
  const plan = await planProductRowUpdate(env, 'products', productId, body, { id: user.id, name: actorSnapshot(user) })
  const moneyPlan = readProductMoneyPlan(body)
  const ids = moneyPlan?.group_rename ? moneyPlan.group_rename.members.map(row => Number(row.id)).sort((a, b) => a - b) : [productId]
  const renamedIds = owns(body, 'name') ? ids : []
  const before = await capture(env, productId, ids, renamedIds)
  const original = before.rows.find(row => row.id === productId)!
  const effects: ProductEditEffects = {
    ordinary_fields: Object.keys(plan.payload).filter(key => !derivedFields.has(key) && !moneyFields.includes(key)),
    money_fields: moneyFields.filter(key => (owns(plan.payload, key) && plan.payload[key] !== original[key]) || (plan.manualEntry && ['cost_price_usd', 'purchase_price_usd'].includes(key))),
    manual_cost: plan.manualEntry, images: owns(body, 'image_gallery') || (owns(body, 'image_path') && body.image_path !== original.image_path), renamed_ids: renamedIds,
  }
  authorize(user, effects)
  if (approval) authorize(approval.reviewer, effects, true)
  const stored: ProductEditReceipt = { version: 1, request_id: identity.requestId, digest: identity.digest, product_id: productId, actor_id: user.id, actor_name: actorSnapshot(user), input_fields: identity.inputFields, body,
    effects, before, after: null, history_id: null, pending_id: approval?.row.id ?? null, generation: 0, transitions: [] }
  const columns = [...await tableColumns(env, 'products')]
  const identityParams = { actor: user.id, request: identity.requestId }
  const selector = `kind='product.edit.v1' AND created_by_id=@actor AND json_extract(payload_json,'$.request_id')=@request`
  const statements: SqlStatement[] = approval
    ? [...approvalStatements(approval.row, approval.reviewer), { sql: `UPDATE undo_snapshots SET payload_json=@payload,status='applying' WHERE id=@snapshot AND status='approval_pending' AND payload_json=@expected`, params: { payload: json(stored), snapshot: previous?.id, expected: previous?.payload_json } }, changedGuard()]
    : [{ sql: `INSERT INTO undo_snapshots(kind,status,payload_json,created_by_id,created_by_name) VALUES('product.edit.v1','applying',@payload,@actor,@name)`, params: { payload: json(stored), actor: user.id, name: actorSnapshot(user) } }]
  statements.push(...stateGuards(before, productId, columns, effects.images, effects.manual_cost), ...plan.statements)
  if (owns(body, 'image_gallery')) statements.push(...galleryStatements(productId, validateProductImageGallery(body.image_gallery, 5)))
  for (const id of renamedIds) statements.push(...linkedStatements(before, id, String(body.name)))
  statements.push({ sql: `UPDATE undo_snapshots SET payload_json=json_set(payload_json,'$.after',json_object('rows',json((SELECT json_group_array(json(r)) FROM (SELECT ${rowJson(columns)} r FROM products p WHERE id IN (SELECT value FROM json_each(@ids)) ORDER BY id))), 'basis',json(${basisSql(productId)}),'gallery',json((SELECT json_group_array(json_object('image_path',image_path,'sort_order',sort_order)) FROM (SELECT * FROM product_images WHERE product_id=@product ORDER BY sort_order,id))),'linked',json('{}'))) WHERE ${selector}`, params: { ...identityParams, ids: json(ids), product: productId } })
  statements.push({ sql: `INSERT INTO action_history(scope,entity,entity_id,label,undo_label,redo_label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
    SELECT 'products','product',@product,'product.edit.v1','undo','redo',1,'undoable',json_object('applier','product.edit.v1','operation_id',CAST(id AS TEXT),'generation',0),json_object('applier','product.edit.v1','operation_id',CAST(id AS TEXT),'generation',0),@actor,@name FROM undo_snapshots WHERE ${selector}`, params: { ...identityParams, product: String(productId), name: actorSnapshot(user) } }, changedGuard())
  statements.push({ sql: `UPDATE undo_snapshots SET status='undoable',payload_json=json_set(payload_json,'$.history_id',last_insert_rowid()),updated_at=CURRENT_TIMESTAMP WHERE ${selector}`, params: identityParams })
  statements.push({ sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,old_value,new_value,details) SELECT @actor,@name,'update','product',@product,json_extract(payload_json,'$.before.rows'),json_extract(payload_json,'$.after.rows'),json_object('action_history_id',json_extract(payload_json,'$.history_id'),'operation_id',CAST(id AS TEXT),'requested_by',@actor,'reviewed_by',@reviewer) FROM undo_snapshots WHERE ${selector}`, params: { ...identityParams, name: actorSnapshot(user), product: String(productId), reviewer: approval?.reviewer.id ?? null } })
  try { await db.batch(statements) } catch (error) {
    const winner = await lookup(db, user.id, identity.requestId)
    if (winner && parse(winner).digest === identity.digest && winner.status !== 'applying' && winner.status !== 'approval_pending') return response(env, winner, user, true)
    if (/malformed JSON|constraint/i.test(String(error))) throw new ProductEditError('product_edit_state_conflict', 'The product changed while the edit was being saved. Nothing was saved.')
    throw error
  }
  return response(env, (await lookup(db, user.id, identity.requestId))!, user)
}

export async function queueProductEdit(env: Env, user: SessionUser, productId: number, body: Record<string, unknown>, identity: ProductEditIdentity): Promise<Record<string, unknown>> {
  const prior = await recoverProductEdit(env, user, identity)
  if (prior) return prior
  const plan = await planProductRowUpdate(env, 'products', productId, body, { id: user.id, name: actorSnapshot(user) })
  const before = await capture(env, productId, [productId], [])
  const original = before.rows[0]
  const effects: ProductEditEffects = { ordinary_fields: Object.keys(plan.payload).filter(key => !derivedFields.has(key) && !moneyFields.includes(key)),
    money_fields: moneyFields.filter(key => (owns(plan.payload, key) && plan.payload[key] !== original[key]) || (plan.manualEntry && ['cost_price_usd', 'purchase_price_usd'].includes(key))),
    manual_cost: plan.manualEntry, images: owns(body, 'image_gallery') || owns(body, 'image_path'), renamed_ids: [] }
  authorize(user, effects)
  const saved: ProductEditReceipt = { version: 1, request_id: identity.requestId, digest: identity.digest, product_id: productId, actor_id: user.id, actor_name: actorSnapshot(user), input_fields: identity.inputFields, body,
    effects, before, after: null, history_id: null, pending_id: null, generation: 0, transitions: [] }
  const selector = `kind='product.edit.v1' AND created_by_id=@actor AND json_extract(payload_json,'$.request_id')=@request`
  const params = { actor: user.id, request: identity.requestId, name: actorSnapshot(user), product: productId, digest: identity.digest }
  try { await getDb(env).batch([
    { sql: `INSERT INTO undo_snapshots(kind,status,payload_json,created_by_id,created_by_name) VALUES('product.edit.v1','approval_pending',@payload,@actor,@name)`, params: { ...params, payload: json(saved) } },
    { sql: `INSERT INTO pending_actions(section,action_type,entity_type,entity_id,payload_json,summary,status,requested_by,requested_by_name)
      SELECT 'products','update','product',@product,json_object('_product_edit',json_object('operation_id',CAST(id AS TEXT),'direction','save','digest',@digest)),'product.edit.v1','open',@actor,@name FROM undo_snapshots WHERE ${selector}`, params }, changedGuard(),
    { sql: `UPDATE undo_snapshots SET payload_json=json_set(payload_json,'$.pending_id',last_insert_rowid()) WHERE ${selector}`, params },
  ]) } catch (error) {
    const winner = await recoverProductEdit(env, user, identity)
    if (winner) return winner
    throw error
  }
  return response(env, (await lookup(getDb(env), user.id, identity.requestId))!, user)
}

export function productEditPendingPointer(row: Pick<PendingActionRow, 'payload_json'>): { operation_id: string; direction: 'save' | Direction; digest?: string; generation?: number } | null {
  let value: unknown
  try { value = JSON.parse(row.payload_json)._product_edit } catch { return null }
  if (!value || typeof value !== 'object') return null
  const p = value as Record<string, unknown>
  if (typeof p.operation_id !== 'string' || !/^[1-9]\d*$/.test(p.operation_id) || !['save', 'undo', 'redo'].includes(String(p.direction))) return null
  return p as { operation_id: string; direction: 'save' | Direction; digest?: string; generation?: number }
}

export type ProductEditReplayOutcome = { complete: boolean; continuation_required: boolean; processed_children: number; pending_children: number; generation: number; current_generation?: number; pending?: boolean; pendingActionId?: number; applied?: boolean; replayed?: boolean }
export async function replayProductEdit(env: Env, user: SessionUser, operationId: string, historyId: number, direction: Direction, expectedGeneration: unknown, approval?: { row: PendingActionRow; reviewer: SessionUser }): Promise<ProductEditReplayOutcome> {
  authorize(user)
  if (!/^[1-9]\d*$/.test(operationId) || !Number.isSafeInteger(expectedGeneration) || Number(expectedGeneration) < 0) throw new ProductEditError('undo_history_stale', 'The product edit generation is required.')
  const db = getDb(env)
  const snapshot = await db.prepare(`SELECT id,status,payload_json,created_by_id FROM undo_snapshots WHERE id=@id AND kind='product.edit.v1'`).get<SnapshotRow>({ id: Number(operationId) })
  if (!snapshot) throw new ProductEditError('undo_history_unusable', 'The product edit receipt is unavailable.')
  const saved = parse(snapshot)
  authorize(user, saved.effects)
  if (approval) authorize(approval.reviewer, saved.effects, true)
  const history = await db.prepare('SELECT * FROM action_history WHERE id=@id').get<Record<string, unknown>>({ id: historyId })
  if (saved.history_id !== historyId || !history || history.entity !== 'product' || history.entity_id !== String(saved.product_id) || Number(history.created_by_id) !== saved.actor_id || (!isAdminControlUser(user) && user.id !== saved.actor_id && !hasPermission(user, 'audit_log'))) throw new ProductEditError('undo_history_unusable', 'The product edit history does not match its receipt.')
  for (const field of ['undo_payload', 'redo_payload']) {
    let p: Record<string, unknown>
    try { p = JSON.parse(String(history[field])) } catch { throw new ProductEditError('undo_history_unusable', 'The product edit pointer is invalid.') }
    if (p.applier !== PRODUCT_EDIT_KIND || p.operation_id !== operationId || p.generation !== saved.generation) throw new ProductEditError('undo_history_stale', 'The product edit history changed.')
  }
  const completed = saved.transitions.find(item => item.generation === expectedGeneration && item.direction === direction)
  if (completed) return { complete: true, continuation_required: false, processed_children: 1, pending_children: 0, generation: Number(expectedGeneration) + 1, current_generation: saved.generation, applied: true, replayed: true }
  const expectedStatus = direction === 'undo' ? 'undoable' : 'redoable'
  if (saved.generation !== expectedGeneration || snapshot.status !== expectedStatus || history.status !== expectedStatus || !saved.after) throw new ProductEditError('undo_history_stale', 'The product edit has already changed.')
  if (!approval && getActionTier(user, 'products', 'edit') === 'review') {
    if (saved.pending_replay) {
      const pending = saved.pending_replay
      if (pending.direction !== direction || pending.generation !== expectedGeneration || pending.actor_id !== user.id) throw new ProductEditError('review_state_conflict', 'Another product replay is awaiting review.')
      return { complete: false, continuation_required: false, processed_children: 0, pending_children: 1, generation: saved.generation, pending: true, pendingActionId: pending.id, applied: false }
    }
    const payload = { _product_edit: { operation_id: operationId, direction, generation: expectedGeneration } }
    await db.batch([
      guard(`EXISTS(SELECT 1 FROM undo_snapshots WHERE id=@id AND payload_json=@expected AND status=@status)`, { id: snapshot.id, expected: snapshot.payload_json, status: expectedStatus }),
      { sql: `INSERT INTO pending_actions(section,action_type,entity_type,entity_id,payload_json,summary,status,requested_by,requested_by_name) VALUES('products','update','product',@product,@payload,'product.edit.v1','open',@actor,@name)`, params: { product: saved.product_id, payload: json(payload), actor: user.id, name: actorSnapshot(user) } },
      { sql: `UPDATE undo_snapshots SET payload_json=json_set(payload_json,'$.pending_replay',json_object('id',last_insert_rowid(),'direction',@direction,'generation',@generation,'actor_id',@actor)) WHERE id=@id`, params: { id: snapshot.id, direction, generation: expectedGeneration, actor: user.id } },
    ])
    const pending = parse((await db.prepare(`SELECT id,status,payload_json,created_by_id FROM undo_snapshots WHERE id=@id`).get<SnapshotRow>({ id: snapshot.id }))!).pending_replay!
    return { complete: false, continuation_required: false, processed_children: 0, pending_children: 1, generation: saved.generation, pending: true, pendingActionId: pending.id, applied: false }
  }
  if (approval && (!saved.pending_replay || saved.pending_replay.id !== approval.row.id || saved.pending_replay.actor_id !== user.id || saved.pending_replay.direction !== direction || saved.pending_replay.generation !== expectedGeneration)) throw new ProductEditError('review_state_conflict', 'The product replay approval changed.')
  const target = direction === 'undo' ? saved.before : saved.after
  const ids = target.rows.map(row => Number(row.id))
  const current = await capture(env, saved.product_id, ids, saved.effects.renamed_ids)
  const columns = [...await tableColumns(env, 'products')]
  const nextGeneration = saved.generation + 1
  const nextStatus = direction === 'undo' ? 'redoable' : 'undoable'
  const transition = { direction, generation: saved.generation, actor_id: user.id, entry_id: null }
  const nextReceipt = { ...saved, generation: nextGeneration, pending_replay: null, transitions: [...saved.transitions, transition] }
  const statements: SqlStatement[] = [
    guard(`EXISTS(SELECT 1 FROM undo_snapshots WHERE id=@id AND payload_json=@payload AND status=@status)`, { id: snapshot.id, payload: snapshot.payload_json, status: expectedStatus }),
    guard(`EXISTS(SELECT 1 FROM action_history WHERE id=@id AND status=@status AND undo_payload=@undo AND redo_payload=@redo AND created_by_id=@actor AND entity_id=@product)`, { id: historyId, status: expectedStatus, undo: history.undo_payload, redo: history.redo_payload, actor: saved.actor_id, product: String(saved.product_id) }),
    ...stateGuards(current, saved.product_id, columns, saved.effects.images, saved.effects.manual_cost),
    ...(approval ? approvalStatements(approval.row, approval.reviewer) : []),
  ]
  if (saved.effects.images) statements.push(...galleryStatements(saved.product_id, target.gallery.map(row => String(row.image_path))))
  for (const productId of saved.effects.renamed_ids) {
    const name = String(target.rows.find(row => row.id === productId)!.name)
    statements.push(...linkedStatements(current, productId, name))
    for (const [table, , nameColumn] of nameRelations) {
      const rows = target.linked[`${table}.${nameColumn}`] || []
      if (rows.length) statements.push({ sql: `UPDATE "${table}" SET "${nameColumn}"=(SELECT json_extract(e.value,'$.value') FROM json_each(@rows) e WHERE json_extract(e.value,'$.id')="${table}".id) WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(@rows))`, params: { rows: json(rows) } })
    }
  }
  if (saved.effects.manual_cost) statements.push(planCatalogCostRestoration(saved.product_id, target.basis, direction, { id: user.id, name: actorSnapshot(user) }, current.rows.find(row => row.id === saved.product_id)!.cost_price_usd as number | null))
  const fields = [...new Set([...saved.effects.ordinary_fields, ...saved.effects.money_fields])].filter(field => columns.includes(field) && !derivedFields.has(field))
  for (const product of target.rows) {
    const selected = Number(product.id) === saved.product_id ? fields : saved.effects.renamed_ids.includes(Number(product.id)) ? ['name'] : []
    if (!selected.length) continue
    statements.push({ sql: `UPDATE products SET ${selected.map((field, index) => `"${field}"=@v${index}`).join(',')},updated_at=@stamp WHERE id=@id`, params: { ...Object.fromEntries(selected.map((field, index) => [`v${index}`, product[field]])), stamp: new Date().toISOString(), id: product.id } }, changedGuard())
  }
  statements.push({ sql: `UPDATE undo_snapshots SET status=@status,payload_json=@payload,updated_at=CURRENT_TIMESTAMP WHERE id=@id`, params: { status: nextStatus, payload: json(nextReceipt), id: snapshot.id } })
  if (saved.effects.manual_cost) statements.push({ sql: `UPDATE undo_snapshots SET payload_json=json_set(payload_json,@path,(SELECT MAX(id) FROM product_cost_entries WHERE product_id=@product)) WHERE id=@id`, params: { path: `$.transitions[${saved.transitions.length}].entry_id`, product: saved.product_id, id: snapshot.id } })
  statements.push({ sql: `UPDATE action_history SET status=@status,undo_payload=@pointer,redo_payload=@pointer,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=@id`, params: { status: nextStatus, pointer: json(pointer(snapshot.id, nextGeneration)), id: historyId } }, changedGuard())
  statements.push({ sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,old_value,new_value,details) VALUES(@actor,@name,@action,'product',@product,@before,(SELECT json_group_array(json(r)) FROM (SELECT ${rowJson(columns)} r FROM products p WHERE id IN (SELECT value FROM json_each(@ids)) ORDER BY id)),@details)`, params: { actor: user.id, name: actorSnapshot(user), action: direction === 'undo' ? 'action_undo' : 'action_redo', product: String(saved.product_id), before: json(current.rows), ids: json(ids), details: json({ actionHistoryId: historyId, operation_id: operationId, generation: nextGeneration, source: direction, target_basis: saved.effects.manual_cost ? target.basis : null, reviewed_by: approval?.reviewer.id ?? null }) } })
  try { await db.batch(statements) } catch (error) {
    const recovered = await db.prepare(`SELECT id,status,payload_json,created_by_id FROM undo_snapshots WHERE id=@id AND kind='product.edit.v1'`).get<SnapshotRow>({ id: snapshot.id })
    if (recovered && parse(recovered).transitions.some(item => item.generation === expectedGeneration && item.direction === direction)) {
      authorize(user, parse(recovered).effects)
      return { complete: true, continuation_required: false, processed_children: 1, pending_children: 0, generation: nextGeneration, current_generation: parse(recovered).generation, applied: true, replayed: true }
    }
    if (/malformed JSON|constraint/i.test(String(error))) throw new ProductEditError('product_edit_state_conflict', 'The product changed during replay. Nothing was changed.')
    throw error
  }
  return { complete: true, continuation_required: false, processed_children: 1, pending_children: 0, generation: nextGeneration, current_generation: nextGeneration, applied: true }
}

export async function approveProductEdit(env: Env, row: PendingActionRow, requester: SessionUser, reviewer: SessionUser): Promise<void> {
  const p = productEditPendingPointer(row)
  if (!p) throw new ProductEditError('review_state_conflict', 'The product edit approval is invalid.')
  const snapshot = await getDb(env).prepare(`SELECT id,status,payload_json,created_by_id FROM undo_snapshots WHERE id=@id AND kind='product.edit.v1'`).get<SnapshotRow>({ id: Number(p.operation_id) })
  if (!snapshot) throw new ProductEditError('review_state_conflict', 'The product edit receipt is unavailable.')
  const saved = parse(snapshot)
  if (saved.product_id !== row.entity_id || row.requested_by !== requester.id) throw new ProductEditError('review_state_conflict', 'The product edit requester changed.')
  if (p.direction === 'save') {
    if (saved.actor_id !== requester.id || saved.pending_id !== row.id || saved.digest !== p.digest || snapshot.status !== 'approval_pending') throw new ProductEditError('review_state_conflict', 'The saved product edit changed.')
    await commitProductEdit(env, requester, saved.product_id, saved.body, { requestId: saved.request_id, digest: saved.digest, inputFields: saved.input_fields }, { row, reviewer })
  } else await replayProductEdit(env, requester, p.operation_id, saved.history_id!, p.direction, p.generation, { row, reviewer })
}
