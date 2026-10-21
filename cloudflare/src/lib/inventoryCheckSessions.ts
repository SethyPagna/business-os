import type { D1Compat } from './db'
import type { SessionUser } from './auth'
import { resolveLowStockConfig, type LowStockConfig } from './lowStockSettings'
import { getInventoryCheckAccess, projectInventoryCheckProduct, validateInventoryCheckQuery } from './inventoryCheckAccess'
import { buildInventoryCheckStockQuery, readInventoryCheckStock, resetInventoryCheckStockSchemaMemo, type InventoryCheckStockRow } from './inventoryCheckStock'
import { buildInventoryCheckProductMembershipQuery } from './inventoryCheckProducts'
import { hasPermission, isAdminControlUser } from './permissions'
import { stockVisibleProductSql } from './productStockGuard'
import { actorSnapshot } from './actorSnapshot'
import { localDateExpr } from './businessDateWindow'

export type InventoryCheckPrincipal = { id: number; tokenHash: string }
export type InventoryCheckReceipt = { requestId: string; eventId: number; action: string; sessionId: string; sessionRevision: number; itemRevision?: number; replayed: boolean }
export type InventoryCheckSession = { id: string; branch_id: number; created_by: number; title: string; status: 'open' | 'closed'; revision: number; started_at: string; updated_at: string; closed_at: string | null; scope: Record<string, unknown>; can_edit: boolean; progress: { total: number; unstarted: number; done: number; issue: number } }
export type InventoryCheckSessionListItem = InventoryCheckSession & { branch_name: string | null; creator_name?: string | null }
export type InventoryCheckObservation = { product_id: number; branch_id: number; product_snapshot: Record<string, unknown>; current_product_available: boolean; current_product_name: string | null; state: 'unstarted' | 'done' | 'issue'; reason: string | null; revision: number; counted_quantity?: number | null; baseline_quantity?: number | null; current_quantity?: number | null; stock_changed?: boolean | null; baseline?: Record<string, unknown>; current_stock?: Record<string, unknown> }
type Actor = SessionUser & { tokenHash: string; product_cost_review_key_available?: number }
type SessionRow = Omit<InventoryCheckSession, 'scope' | 'can_edit' | 'progress'> & { organization_id: number | null; scope_json: string }
type ItemRow = { session_id: string; product_id: number; branch_id: number; product_snapshot_json: string; current_product_available?: number; current_product_name?: string | null; baseline_quantity: number | null; baseline_json: string; state: InventoryCheckObservation['state']; counted_quantity: number | null; reason: string | null; revision: number; updated_by: number | null; updated_at: string | null }
type EventRow = { id: number; session_id: string; product_id: number | null; actor_id: number; actor_name: string | null; action: string; request_id: string; request_hash: string; before_json: string; after_json: string; result_json: string; created_at: string }
type Statement = { sql: string; params?: Record<string, unknown> }

export class InventoryCheckSessionError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 503, readonly code: string) { super(code); this.name = 'InventoryCheckSessionError' }
}
const fail = (status: InventoryCheckSessionError['status'], code: string): never => { throw new InventoryCheckSessionError(status, code) }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail(400, 'inventory_check_invalid_request')
const revision = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail(400, 'inventory_check_revision_required')
const positive = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fail(400, 'inventory_check_invalid_id')
const requestId = (value: unknown): string => typeof value === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(value) ? value : fail(400, 'inventory_check_request_id_required')
const parse = (value: string): Record<string, unknown> => object(JSON.parse(value))
export async function inventoryCheckDigest(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
const CURRENT_ACTOR_SQL = `SELECT u.id,u.username,u.name,u.organization_id,u.role_id,u.permissions,u.is_active,
  r.code AS role_code,r.permissions AS role_permissions,
  EXISTS(SELECT 1 FROM pragma_table_info('products') WHERE name='cost_review_key') AS product_cost_review_key_available
  FROM users u LEFT JOIN roles r ON r.id=u.role_id
  WHERE u.id=@actorId AND u.is_active=1 AND u.deleted_at IS NULL AND COALESCE(u.must_change_password,0)=0
    AND EXISTS(SELECT 1 FROM user_sessions s WHERE s.user_id=u.id AND s.token_hash=@tokenHash
      AND s.revoked_at IS NULL AND julianday(s.expires_at)>julianday('now'))`
export async function currentInventoryCheckActor(db: D1Compat, principal: InventoryCheckPrincipal, write = false): Promise<Actor> {
  const actor = await db.prepare(CURRENT_ACTOR_SQL).get<Actor>({ actorId: principal.id, tokenHash: principal.tokenHash })
  if (!actor) return fail(403, 'inventory_check_authority_changed')
  const access = getInventoryCheckAccess(actor)
  if (!access.canView || write && !access.canCheck) fail(403, 'inventory_check_permission_required')
  return { ...actor, tokenHash: principal.tokenHash }
}
// Positive-only per-isolate memos: a miss re-probes, so a migration that lands later is seen on the next request.
let checkSchemaReady = false
let physicalSignature: string | undefined
async function schemaReady(db: D1Compat): Promise<void> {
  if (checkSchemaReady) return
  const ready = await db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN (
    'inventory_check_sessions','inventory_check_items','inventory_check_events','inventory_check_events_no_update',
    'inventory_check_events_no_delete','inventory_check_sessions_identity','inventory_check_sessions_no_delete',
    'inventory_check_items_baseline','inventory_check_items_no_delete')`).get<{ n: number }>()
  if (ready?.n !== 9) fail(503, 'inventory_check_schema_unavailable')
  checkSchemaReady = true
}
const guard = (expression: string, code: string, params: Record<string, unknown>): Statement => ({ sql: `SELECT CASE WHEN ${expression} THEN 1 ELSE json_extract('[]','$[${code}]') END`, params })
function authorityGuard(actor: Actor): Statement {
  return guard(`EXISTS(SELECT 1 FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=@actorId
    AND u.is_active=1 AND u.deleted_at IS NULL AND COALESCE(u.must_change_password,0)=0
    AND u.username IS @actorName AND u.organization_id IS @organization AND u.role_id IS @roleId
    AND u.permissions IS @permissions AND r.code IS @roleCode AND r.permissions IS @rolePermissions
    AND EXISTS(SELECT 1 FROM user_sessions s WHERE s.user_id=u.id AND s.token_hash=@tokenHash
      AND s.revoked_at IS NULL AND julianday(s.expires_at)>julianday('now')))
    AND NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance')`, 'inventory_check_authority_changed', {
    actorId: actor.id, actorName: actor.username, organization: actor.organization_id, roleId: actor.role_id,
    permissions: actor.permissions, roleCode: actor.role_code ?? null, rolePermissions: actor.role_permissions ?? null, tokenHash: actor.tokenHash,
  })
}
async function sessionRow(db: D1Compat, actor: Actor, id: string): Promise<SessionRow> {
  const row = await db.prepare('SELECT * FROM inventory_check_sessions WHERE id=@id AND organization_id IS @organization').get<SessionRow>({ id, organization: actor.organization_id })
  return row || fail(404, 'inventory_check_session_not_found')
}
const canEdit = (actor: Actor, session: SessionRow): boolean => getInventoryCheckAccess(actor).canCheck && (isAdminControlUser(actor) || session.created_by === actor.id)
function sessionGuard(actor: Actor, session: SessionRow, expected: number, status: string): Statement {
  return guard(`EXISTS(SELECT 1 FROM inventory_check_sessions WHERE id=@id AND organization_id IS @organization
    AND branch_id=@branchId AND created_by=@creator AND revision=@expected AND status=@status
    AND (@admin=1 OR created_by=@actorId))`, 'inventory_check_conflict', {
    id: session.id, organization: actor.organization_id, branchId: session.branch_id, creator: session.created_by,
    expected, status, admin: Number(isAdminControlUser(actor)), actorId: actor.id,
  })
}
async function progress(db: D1Compat, id: string) {
  const row = await db.prepare(`SELECT COUNT(*) AS total,SUM(state='unstarted') AS unstarted,SUM(state='done') AS done,SUM(state='issue') AS issue FROM inventory_check_items WHERE session_id=@id`).get<Record<string, number>>({ id })
  return { total: Number(row?.total || 0), unstarted: Number(row?.unstarted || 0), done: Number(row?.done || 0), issue: Number(row?.issue || 0) }
}
// One rule for who may see a staff member's name on any Inventory check surface (history actor_name, session creator_name).
const canSeeStaffIdentity = (actor: Actor, accountId: number): boolean => isAdminControlUser(actor) || hasPermission(actor,'audit_log') || accountId === actor.id
async function projectSession(db: D1Compat, actor: Actor, row: SessionRow, counts?: InventoryCheckSession['progress']): Promise<InventoryCheckSession> {
  const scope = parse(row.scope_json), access = getInventoryCheckAccess(actor)
  if (!access.fields.brand) delete scope.brand
  if (!access.fields.category) delete scope.category
  if (!access.fields.stock) delete scope.stockState
  if (!access.fields.barcode) delete scope.barcode
  if (!access.fields.received) for(const key of ['startDate','endDate','createdFrom','createdTo']) delete scope[key]
  const sortField = {stock:'stock',qty_sold:'sales',customer_count:'customers',received_date:'received',price:'price',cost:'cost'}[String(scope.sortBy)] as keyof typeof access.fields | undefined
  if (sortField && !access.fields[sortField]) delete scope.sortBy
  return { id: row.id, branch_id: row.branch_id, created_by: row.created_by, title: row.title, status: row.status, revision: row.revision,
    started_at: row.started_at, updated_at: row.updated_at, closed_at: row.closed_at, scope, can_edit: canEdit(actor, row), progress: counts ?? await progress(db, row.id) }
}
const STOCK_COLUMNS = ['quantity','recorded_ordinary_quantity','recorded_lot_quantity','recorded_damaged_quantity','recorded_cache_quantity','global_ordinary_quantity','global_lot_quantity','global_damaged_quantity','unallocated_damaged_quantity'] as const
function stockProjection(stock: InventoryCheckStockRow | Record<string, unknown>): Record<string, unknown> {
  const value = stock as Record<string, unknown>
  return { ...Object.fromEntries(STOCK_COLUMNS.map(key => [key, typeof value[key] === 'number' && Number.isFinite(value[key]) ? value[key] : null])),
    consistent: value.consistent === true, flags: Array.isArray(value.flags) ? value.flags.filter(flag => typeof flag === 'string') : [] }
}
function projectObservation(actor: Actor, row: ItemRow, ownSession: boolean, current?: InventoryCheckStockRow): InventoryCheckObservation {
  const access = getInventoryCheckAccess(actor)
  return { product_id: row.product_id, branch_id: row.branch_id, product_snapshot: projectInventoryCheckProduct(parse(row.product_snapshot_json), access),
    current_product_available: row.current_product_available === 1, current_product_name: row.current_product_name ?? null,
    state: row.state, reason: row.reason, revision: row.revision,
    ...(access.fields.stock || ownSession ? { counted_quantity:row.counted_quantity } : {}),
    ...(access.fields.stock ? { baseline_quantity: row.baseline_quantity,
      current_quantity: current?.quantity ?? null, stock_changed: row.baseline_quantity == null || current?.quantity == null ? null : Math.abs(row.baseline_quantity-current.quantity)>1e-9,
      baseline: stockProjection(parse(row.baseline_json)), ...(current ? { current_stock: stockProjection(current) } : {}) } : {}) }
}
export async function getInventoryCheckSession(db: D1Compat, principal: InventoryCheckPrincipal, id: string) {
  let actor = await currentInventoryCheckActor(db, principal); await schemaReady(db)
  const session = await sessionRow(db, actor, id)
  const items = await db.prepare(`SELECT i.*,CASE WHEN ${CURRENT_PRODUCT_CHECKABLE_SQL} THEN 1 ELSE 0 END AS current_product_available,
    CASE WHEN ${CURRENT_PRODUCT_CHECKABLE_SQL} THEN p.name END AS current_product_name
    FROM inventory_check_items i LEFT JOIN products p ON p.id=i.product_id WHERE i.session_id=@id ORDER BY i.product_id`).all<ItemRow>({ id })
  if (items.length > 500) fail(503, 'inventory_check_membership_unavailable')
  const current = await readInventoryCheckStock(db, { branchId: session.branch_id, productIds: items.map(item => item.product_id) })
  actor = await currentInventoryCheckActor(db, principal)
  if (actor.organization_id !== session.organization_id) fail(404, 'inventory_check_session_not_found')
  const byId = new Map(current.map(row => [row.product_id, row]))
  return { item: await projectSession(db, actor, session), items: items.map(item => projectObservation(actor, item, session.created_by === actor.id, byId.get(item.product_id))) }
}
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
function businessDay(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || !ISO_DAY.test(value)) return fail(400, 'inventory_check_invalid_filter')
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value ? fail(400, 'inventory_check_invalid_filter') : value
}
function sessionListFilters(query: Record<string, string>) {
  const status = query.status == null || query.status === '' ? null : query.status === 'open' || query.status === 'closed' ? query.status : fail(400, 'inventory_check_invalid_filter')
  const mine = query.mine == null || query.mine === '' || query.mine === '0' ? 0 : query.mine === '1' ? 1 : fail(400, 'inventory_check_invalid_filter')
  const startDate = businessDay(query.startDate), endDate = businessDay(query.endDate)
  if (startDate && endDate && startDate > endDate) fail(400, 'inventory_check_invalid_filter')
  return { status, mine, startDate, endDate }
}
export async function listInventoryCheckSessions(db: D1Compat, principal: InventoryCheckPrincipal, query: Record<string, string>) {
  let actor = await currentInventoryCheckActor(db, principal); await schemaReady(db)
  const page = pageNumber(query.page, 1, 100000), pageSize = pageNumber(query.pageSize, 20, 100)
  const branchId = query.branchId ? positive(Number(query.branchId)) : null
  const filters = sessionListFilters(query)
  const organization = actor.organization_id
  // Filters run before LIMIT so the page total counts every matching session. started_at is a UTC instant; the day filter is the Cambodia business day.
  const params = { organization, branchId, ...filters, actorId: actor.id, limit: pageSize, offset: (page-1)*pageSize }
  const where = `organization_id IS @organization AND (@branchId IS NULL OR branch_id=@branchId) AND (@status IS NULL OR status=@status)
    AND (@mine=0 OR created_by=@actorId) AND (@startDate IS NULL OR ${localDateExpr('started_at')}>=@startDate) AND (@endDate IS NULL OR ${localDateExpr('started_at')}<=@endDate)`
  const [count, rows] = await db.batch([{ sql: `SELECT COUNT(*) AS total FROM inventory_check_sessions WHERE ${where}`, params },
    { sql: `WITH page AS (SELECT * FROM inventory_check_sessions WHERE ${where} ORDER BY updated_at DESC,id DESC LIMIT @limit OFFSET @offset)
      SELECT page.*,b.name AS branch_name,u.username AS creator_username,COUNT(i.product_id) AS item_total,SUM(i.state='unstarted') AS item_unstarted,SUM(i.state='done') AS item_done,SUM(i.state='issue') AS item_issue
      FROM page LEFT JOIN inventory_check_items i ON i.session_id=page.id LEFT JOIN branches b ON b.id=page.branch_id LEFT JOIN users u ON u.id=page.created_by
      GROUP BY page.id ORDER BY page.updated_at DESC,page.id DESC`, params }])
  actor = await currentInventoryCheckActor(db, principal)
  if (actor.organization_id !== organization) fail(403, 'inventory_check_authority_changed')
  const items: InventoryCheckSessionListItem[] = []
  for (const raw of rows.results || []) {
    const row = raw as SessionRow & { branch_name: string | null; creator_username: string | null; item_total: number; item_unstarted: number; item_done: number; item_issue: number }
    const session = await projectSession(db, actor, row, { total: Number(row.item_total), unstarted: Number(row.item_unstarted), done: Number(row.item_done), issue: Number(row.item_issue) })
    items.push({ ...session, branch_name: row.branch_name ?? null, ...(canSeeStaffIdentity(actor, row.created_by) ? { creator_name: row.creator_username ?? null } : {}) })
  }
  return { items, page, pageSize, total: Number((count.results?.[0] as { total: number })?.total || 0) }
}
function pageNumber(value: unknown, fallback: number, max: number): number {
  if (value == null || value === '') return fallback
  const result = Number(value)
  return Number.isSafeInteger(result) && result >= 1 && result <= max ? result : fail(400, 'inventory_check_invalid_page')
}
async function receipt(db: D1Compat, actor: Actor, key: string, hash: string): Promise<EventRow | undefined> {
  const event = await db.prepare('SELECT * FROM inventory_check_events WHERE actor_id=@actor AND request_id=@key').get<EventRow>({ actor: actor.id, key })
  if (event && event.request_hash !== hash) fail(409, 'inventory_check_request_reused')
  return event
}
function receiptResponse(event: EventRow, replayed: boolean): InventoryCheckReceipt {
  const result = parse(event.result_json)
  return { requestId: event.request_id, eventId: event.id, action: event.action, sessionId: event.session_id,
    sessionRevision: Number(result.sessionRevision), ...(typeof result.itemRevision === 'number' ? { itemRevision: result.itemRevision } : {}), replayed }
}
function eventStatement(actor: Actor, args: { sessionId: string; productId?: number; action: string; key: string; hash: string; before: unknown; after: unknown; result: Record<string, unknown>; now: string }): Statement {
  return { sql: `INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at)
    VALUES(@sessionId,@productId,@actorId,@actorName,@action,@key,@hash,@before,@after,@result,@now)`, params: {
    sessionId: args.sessionId, productId: args.productId ?? null, actorId: actor.id, actorName: actorSnapshot(actor), action: args.action,
    key: args.key, hash: args.hash, before: JSON.stringify(args.before), after: JSON.stringify(args.after), result: JSON.stringify(args.result), now: args.now,
  } }
}
async function commit(db: D1Compat, principal: InventoryCheckPrincipal, actor: Actor, statements: Statement[], key: string, hash: string): Promise<{ event: EventRow; replayed: boolean }> {
  try { await db.batchOnce([authorityGuard(actor), ...statements]) }
  catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    if (text.includes('inventory_check_authority_changed')) fail(403, 'inventory_check_authority_changed')
    if (text.includes('inventory_check_conflict') || text.includes('inventory_check_baseline_changed')) {
      physicalSignature = undefined // a refused guard may mean the remembered signature is stale; the next attempt reads it again
      fail(409, text.includes('baseline_changed') ? 'inventory_check_baseline_changed' : 'inventory_check_conflict')
    }
    try {
      const fresh = await currentInventoryCheckActor(db, principal, true)
      const recovered = await receipt(db, fresh, key, hash)
      if (recovered) return { event: recovered, replayed: true }
    } catch { return fail(503, 'inventory_check_outcome_unknown') }
    fail(503, 'inventory_check_outcome_unknown')
  }
  const event = await receipt(db, actor, key, hash)
  return event ? { event, replayed: false } : fail(503, 'inventory_check_outcome_unknown')
}
async function committedSessionProjection(db: D1Compat, principal: InventoryCheckPrincipal, id: string, observation?: {productId:number;branchId:number}) {
  try {
    const sql = `WITH current_actor AS (${CURRENT_ACTOR_SQL}), post_write_snapshot AS (
      SELECT s.* FROM inventory_check_sessions s JOIN current_actor a ON s.organization_id IS a.organization_id
      WHERE s.id=@id AND (@branchId IS NULL OR s.branch_id=@branchId))
      SELECT json_object('id',a.id,'username',a.username,'name',a.name,'organization_id',a.organization_id,
        'role_id',a.role_id,'permissions',a.permissions,'is_active',a.is_active,'role_code',a.role_code,'role_permissions',a.role_permissions) AS actor_json,
        json_object('id',s.id,'organization_id',s.organization_id,'branch_id',s.branch_id,'created_by',s.created_by,
          'title',s.title,'status',s.status,'revision',s.revision,'scope_json',s.scope_json,'started_at',s.started_at,'updated_at',s.updated_at,'closed_at',s.closed_at) AS session_json,
        (SELECT json_object('total',COUNT(*),'unstarted',COALESCE(SUM(state='unstarted'),0),'done',COALESCE(SUM(state='done'),0),'issue',COALESCE(SUM(state='issue'),0))
          FROM inventory_check_items WHERE session_id=s.id) AS progress_json,
        CASE WHEN @productId IS NOT NULL THEN (SELECT json_object('session_id',i.session_id,'product_id',i.product_id,'branch_id',i.branch_id,
          'product_snapshot_json',i.product_snapshot_json,'baseline_quantity',i.baseline_quantity,'baseline_json',i.baseline_json,
          'state',i.state,'counted_quantity',i.counted_quantity,'reason',i.reason,'revision',i.revision,'updated_by',i.updated_by,'updated_at',i.updated_at,
          'current_product_available',CASE WHEN ${CURRENT_PRODUCT_CHECKABLE_SQL} THEN 1 ELSE 0 END,
          'current_product_name',CASE WHEN ${CURRENT_PRODUCT_CHECKABLE_SQL} THEN p.name END)
          FROM inventory_check_items i LEFT JOIN products p ON p.id=i.product_id WHERE i.session_id=s.id AND i.product_id=@productId AND i.branch_id=s.branch_id) END AS item_json
      FROM post_write_snapshot s JOIN current_actor a ON s.organization_id IS a.organization_id`
    const statement = {sql,params:{actorId:principal.id,tokenHash:principal.tokenHash,id,productId:observation?.productId ?? null,branchId:observation?.branchId ?? null}}
    let result: D1Result[] = [], current: InventoryCheckStockRow | undefined
    if (observation) {
      const stock = await readInventoryCheckStock({batch:async statements=>{
        const combined=await db.batch([...statements,statement])
        result=combined.slice(statements.length)
        return combined.slice(0,statements.length)
      }},{branchId:observation.branchId,productIds:[observation.productId]})
      current=stock.find(row=>row.product_id===observation.productId)
    } else result=await db.batch([statement])
    if (result.length!==1 || result[0].success!==true || result[0].results?.length!==1) return fail(503,'inventory_check_outcome_unknown')
    const row=result[0].results[0] as {actor_json:string;session_json:string;progress_json:string;item_json:string|null}
    const actor={...parse(row.actor_json),tokenHash:principal.tokenHash} as Actor
    if (!getInventoryCheckAccess(actor).canView) return fail(503,'inventory_check_outcome_unknown')
    const session=parse(row.session_json) as unknown as SessionRow
    const counts=parse(row.progress_json) as InventoryCheckSession['progress']
    const summary=await projectSession(db,actor,session,counts)
    if (!observation) return {item:summary}
    if (!row.item_json) return fail(503,'inventory_check_outcome_unknown')
    const item=parse(row.item_json) as unknown as ItemRow
    return {item:summary,observation:projectObservation(actor,item,session.created_by===actor.id,current)}
  } catch { return fail(503,'inventory_check_outcome_unknown') }
}
// One sqlite_master pass for the stock tables and the epoch guards; the write guards compare it inside the transaction.
const PHYSICAL_SCHEMA_SQL = `SELECT json_object('epoch',(SELECT value FROM system_flags WHERE key='stock_schema_epoch'),
  'epoch_present',(SELECT COUNT(*) FROM system_flags WHERE key='stock_schema_epoch'),
  'objects',(SELECT json_group_array(json_array(type,name,sql)) FROM (SELECT type,name,sql FROM sqlite_master
    WHERE type='table' AND name IN ('branch_stock','branch_batch_stock','damaged_stock_lots') OR type='trigger' AND name LIKE 'stock_epoch_%_0243'
    ORDER BY type,name))) AS signature`
// The remembered signature was read with a full structure validation; a fresh one is read with a fresh validation too.
async function validatedStockSnapshot(db: D1Compat, branchId: number, productIds: number[]) {
  const known = physicalSignature
  if (!known) resetInventoryCheckStockSchemaMemo()
  let signature = known
  const rows = await readInventoryCheckStock({batch:async statements=>{
    const results=await db.batch(known ? statements : [...statements,{sql:PHYSICAL_SCHEMA_SQL}])
    if (!known) signature=(results[statements.length]?.results?.[0] as {signature?:string})?.signature
    return results.slice(0,statements.length)
  }},{branchId,productIds})
  if (!signature) return fail(503,'inventory_check_stock_schema_unavailable')
  physicalSignature = signature
  return {rows,signature}
}
const LOW_STOCK_ROWS_SQL = `SELECT key,value FROM settings WHERE key IN ('low_stock_alert_enabled','low_stock_threshold_mode','low_stock_threshold_default') ORDER BY key`
const LOW_STOCK_SIGNATURE_SQL = `SELECT json_group_array(json_object('key',key,'value',value)) FROM (${LOW_STOCK_ROWS_SQL})`
const CHECKABLE_SQL = `(NOT(COALESCE(p.is_group,0)=1 AND EXISTS(SELECT 1 FROM products child WHERE child.id<>p.id
  AND (child.parent_id=p.id OR child.name_key=p.name_key) AND ${stockVisibleProductSql('child')})))`
const CURRENT_PRODUCT_CHECKABLE_SQL = `p.id IS NOT NULL AND ${stockVisibleProductSql()} AND ${CHECKABLE_SQL}`
export async function createInventoryCheckSession(db: D1Compat, principal: InventoryCheckPrincipal, input: unknown, lowStock: LowStockConfig) {
  const body = object(input), actor = await currentInventoryCheckActor(db, principal, true); await schemaReady(db)
  const branchId = positive(body.branchId), key = requestId(body.requestId)
  const productValues = body.productIds
  if (!Array.isArray(productValues) || productValues.length < 1 || productValues.length > 500) return fail(400, 'inventory_check_product_ids_required')
  const productIds = productValues.map(positive).sort((a,b)=>a-b)
  if (new Set(productIds).size !== productIds.length) fail(400, 'inventory_check_invalid_id')
  const title = body.title === undefined ? '' : typeof body.title === 'string' ? body.title.trim() : fail(400, 'inventory_check_invalid_title')
  if (title.length > 120) fail(400, 'inventory_check_invalid_title')
  const rawScope = { ...object(body.scope || {}) }, marker = rawScope.membership
  delete rawScope.membership
  if (marker !== undefined && marker !== 'visible_page') fail(400,'inventory_check_invalid_scope')
  for (const key of ['state','reason','sessionId']) {
    if (rawScope[key] !== undefined && rawScope[key] !== '') fail(400,'inventory_check_invalid_scope')
    delete rawScope[key]
  }
  const query = validateInventoryCheckQuery({...rawScope,branchId:String(branchId)},getInventoryCheckAccess(actor))
  const normalizedScope:Record<string,unknown> = {...query,...(marker ? {membership:marker} : {})}
  const scope = Object.fromEntries(Object.keys(normalizedScope).sort().map(key=>[key,normalizedScope[key]]))
  const hash = await inventoryCheckDigest(JSON.stringify({ action: 'create', branchId, productIds, title, scope }))
  const existing = await receipt(db, actor, key, hash)
  if (existing) return { ...(await committedSessionProjection(db, principal, existing.session_id)), receipt: receiptResponse(existing, true), created: false }
  const settings = await db.prepare(LOW_STOCK_ROWS_SQL).all<{key:string;value:string}>()
  const settingsSignature = JSON.stringify(settings.map(row=>({key:row.key,value:row.value})))
  lowStock = resolveLowStockConfig(Object.fromEntries(settings.map(row=>[row.key,row.value])))
  const membership = buildInventoryCheckProductMembershipQuery(query, productIds, getInventoryCheckAccess(actor), lowStock)
  const eligible = await db.prepare(membership.rowsSql).all<{ id: number }>(membership.params)
  if (eligible.length !== productIds.length) fail(400, 'inventory_check_product_not_eligible')
  const snapshot = await validatedStockSnapshot(db, branchId, productIds)
  const baselines = snapshot.rows
  if (baselines.length !== productIds.length) fail(409, 'inventory_check_baseline_changed')
  const products = await db.prepare('SELECT id,name,image_path,unit,parent_id,is_group FROM products WHERE id IN (SELECT value FROM json_each(@ids)) ORDER BY id').all<Record<string, unknown>>({ ids: JSON.stringify(productIds) })
  const byId = new Map(baselines.map(row => [row.product_id, row]))
  const members = products.map(product => ({ product_id: product.id, product, baseline: byId.get(Number(product.id)) }))
  const now = new Date().toISOString(), id = crypto.randomUUID()
  const params = { id, organization: actor.organization_id, branchId, actorId: actor.id, title, scopeJson: JSON.stringify(scope), now,
    ids: JSON.stringify(productIds), members: JSON.stringify(members), baseline: JSON.stringify(baselines), count: productIds.length, signature: snapshot.signature }
  const stock = buildInventoryCheckStockQuery({ branchId, productIds })
  const comparisons = [...STOCK_COLUMNS, 'consistent'].map(column => `a.${column} IS json_extract(e.value,'$.${column}')`).join(' AND ')
  const statements: Statement[] = [
    guard(`EXISTS(SELECT 1 FROM branches WHERE id=@branchId AND is_active=1)
      AND (${PHYSICAL_SCHEMA_SQL}) IS @signature AND (${LOW_STOCK_SIGNATURE_SQL}) IS @settingsSignature`, 'inventory_check_baseline_changed', { ...params, settingsSignature }),
    guard(`(SELECT COUNT(*) FROM (${membership.rowsSql}))=@count`, 'inventory_check_baseline_changed', { ...membership.params, count: productIds.length }),
    { sql: `WITH actual AS (${stock.rowsSql}) SELECT CASE WHEN (SELECT COUNT(*) FROM actual)=@count AND NOT EXISTS(
      SELECT 1 FROM json_each(@baseline) e LEFT JOIN actual a ON a.product_id=json_extract(e.value,'$.product_id')
      WHERE a.product_id IS NULL OR NOT(${comparisons})) THEN 1 ELSE json_extract('[]','$[inventory_check_baseline_changed]') END`,
      params: { ...stock.params, baseline: params.baseline, count: productIds.length } },
    guard(`NOT EXISTS(SELECT 1 FROM json_each(@members) e LEFT JOIN products p ON p.id=json_extract(e.value,'$.product_id')
      WHERE p.id IS NULL OR p.name IS NOT json_extract(e.value,'$.product.name') OR p.image_path IS NOT json_extract(e.value,'$.product.image_path')
      OR p.unit IS NOT json_extract(e.value,'$.product.unit') OR p.parent_id IS NOT json_extract(e.value,'$.product.parent_id')
      OR p.is_group IS NOT json_extract(e.value,'$.product.is_group') OR NOT ${CHECKABLE_SQL})`, 'inventory_check_baseline_changed', params),
    { sql: `INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at)
      VALUES(@id,@organization,@branchId,@actorId,@title,'open',0,@scopeJson,@now,@now)`, params },
    { sql: `INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json)
      SELECT @id,json_extract(value,'$.product_id'),@branchId,json_extract(value,'$.product'),json_extract(value,'$.baseline.quantity'),json_extract(value,'$.baseline') FROM json_each(@members)`, params },
    eventStatement(actor, { sessionId: id, action: 'create', key, hash, before: null, after: { status: 'open', revision: 0, members: productIds.length }, result: { sessionRevision: 0 }, now }),
  ]
  const saved = await commit(db, principal, actor, statements, key, hash)
  return { ...(await committedSessionProjection(db, principal, saved.event.session_id)), receipt: receiptResponse(saved.event, saved.replayed), created: !saved.replayed }
}
export async function patchInventoryCheckObservation(db: D1Compat, principal: InventoryCheckPrincipal, id: string, productId: number, input: unknown) {
  const body = object(input), actor = await currentInventoryCheckActor(db, principal, true); await schemaReady(db)
  const session = await sessionRow(db, actor, id)
  if (!canEdit(actor, session)) fail(403, 'inventory_check_owner_required')
  const expected = revision(body.expectedRevision), expectedSession = revision(body.expectedSessionRevision), key = requestId(body.requestId)
  const state = body.state
  if (!['unstarted','done','issue'].includes(String(state))) fail(400, 'inventory_check_invalid_state')
  const counted = state === 'unstarted' || body.counted_quantity == null ? null : typeof body.counted_quantity === 'number' && Number.isFinite(body.counted_quantity) && body.counted_quantity >= 0 ? body.counted_quantity : fail(400, 'inventory_check_invalid_quantity')
  const reason = state === 'issue' && typeof body.reason === 'string' ? body.reason.trim() : null
  if (state === 'issue' && (!reason || reason.length > 500)) fail(400, 'inventory_check_reason_required')
  const after = { state, counted_quantity: counted, reason, revision: expected+1 }
  const hash = await inventoryCheckDigest(JSON.stringify({ action: 'observe', id, productId, expected, expectedSession, ...after }))
  const previous = await receipt(db, actor, key, hash)
  if (previous) return observationResponse(db, principal, previous, true,session.branch_id)
  const item = await db.prepare('SELECT * FROM inventory_check_items WHERE session_id=@id AND product_id=@productId AND branch_id=@branchId').get<ItemRow>({ id, productId, branchId: session.branch_id })
  if (!item) return fail(404, 'inventory_check_item_not_found')
  const countGuards: Statement[] = []
  if (counted !== null && getInventoryCheckAccess(actor).fields.stock) {
    if (state === 'done') {
      const snapshot = await validatedStockSnapshot(db,session.branch_id,[productId])
      const current = snapshot.rows[0]
      if (current?.quantity == null || Math.abs(current.quantity-counted)>1e-9) fail(409,'inventory_check_count_requires_issue')
      const stock = buildInventoryCheckStockQuery({branchId:session.branch_id,productIds:[productId]})
      countGuards.push(guard(`(${PHYSICAL_SCHEMA_SQL}) IS @signature AND EXISTS(SELECT 1 FROM (${stock.rowsSql}) current WHERE current.quantity IS NOT NULL AND abs(current.quantity-@counted)<=0.000000001)`, 'inventory_check_conflict', {...stock.params,counted,signature:snapshot.signature}))
    }
  }
  const params = { id, productId, branchId: session.branch_id, expected, expectedSession, state, counted, reason, actor: actor.id, now: new Date().toISOString() }
  const saved = await commit(db, principal, actor, [sessionGuard(actor, session, expectedSession, 'open'),
    ...countGuards,
    guard(`EXISTS(SELECT 1 FROM inventory_check_items WHERE session_id=@id AND product_id=@productId AND branch_id=@branchId AND revision=@expected)
      AND EXISTS(SELECT 1 FROM products p WHERE p.id=@productId AND ${stockVisibleProductSql()} AND ${CHECKABLE_SQL})`, 'inventory_check_conflict', params),
    { sql: `UPDATE inventory_check_items SET state=@state,counted_quantity=@counted,reason=@reason,revision=revision+1,updated_by=@actor,updated_at=@now
      WHERE session_id=@id AND product_id=@productId AND branch_id=@branchId AND revision=@expected`, params },
    guard('changes()=1', 'inventory_check_conflict', {}),
    { sql: 'UPDATE inventory_check_sessions SET updated_at=@now WHERE id=@id', params },
    eventStatement(actor, { sessionId: id, productId, action: 'observe', key, hash, before: { state: item.state, counted_quantity: item.counted_quantity, reason: item.reason, revision: item.revision }, after, result: { sessionRevision: expectedSession, itemRevision: expected+1 }, now: params.now }),
  ], key, hash)
  return observationResponse(db, principal, saved.event, saved.replayed,session.branch_id)
}
async function observationResponse(db: D1Compat, principal: InventoryCheckPrincipal, event: EventRow, replayed: boolean, branchId:number) {
  if (event.product_id===null) return fail(503,'inventory_check_outcome_unknown')
  const detail = await committedSessionProjection(db, principal, event.session_id,{productId:event.product_id,branchId})
  return { item: detail.observation, session: detail.item, receipt: receiptResponse(event, replayed) }
}
export async function patchInventoryCheckSession(db: D1Compat, principal: InventoryCheckPrincipal, id: string, input: unknown) {
  const body = object(input), actor = await currentInventoryCheckActor(db, principal, true); await schemaReady(db)
  const session = await sessionRow(db, actor, id)
  if (!canEdit(actor, session)) fail(403, 'inventory_check_owner_required')
  const expected = revision(body.expectedRevision), key = requestId(body.requestId), action = body.action
  if (action !== 'close' && action !== 'resume') return fail(400, 'inventory_check_invalid_action')
  const hash = await inventoryCheckDigest(JSON.stringify({ action, id, expected })), previous = await receipt(db, actor, key, hash)
  if (previous) return { item: (await committedSessionProjection(db, principal, id)).item, receipt: receiptResponse(previous, true) }
  const status = action === 'close' ? 'closed' : 'open', now = new Date().toISOString()
  const params = { id, status, expected, now, closed: action === 'close' ? now : null }
  const saved = await commit(db, principal, actor, [sessionGuard(actor, session, expected, action === 'close' ? 'open' : 'closed'),
    { sql: 'UPDATE inventory_check_sessions SET status=@status,revision=revision+1,updated_at=@now,closed_at=@closed WHERE id=@id AND revision=@expected', params },
    guard('changes()=1', 'inventory_check_conflict', {}),
    eventStatement(actor, { sessionId: id, action, key, hash, before: { status: session.status, revision: session.revision }, after: { status, revision: expected+1 }, result: { sessionRevision: expected+1 }, now }),
  ], key, hash)
  return { item: (await committedSessionProjection(db, principal, id)).item, receipt: receiptResponse(saved.event, saved.replayed) }
}
export async function inventoryCheckSessionHistory(db: D1Compat, principal: InventoryCheckPrincipal, id: string, query: Record<string,string>) {
  let actor = await currentInventoryCheckActor(db, principal); await schemaReady(db)
  const session = await sessionRow(db, actor, id)
  const page = pageNumber(query.page,1,100000), pageSize = pageNumber(query.pageSize,20,100)
  // product_name is the session's frozen starting name (never a live products lookup), so renames, merges and deletes cannot change or leak it.
  const rows = await db.prepare(`SELECT e.*,json_extract(i.product_snapshot_json,'$.name') AS product_name FROM inventory_check_events e
    LEFT JOIN inventory_check_items i ON i.session_id=e.session_id AND i.product_id=e.product_id AND i.branch_id=@branchId
    WHERE e.session_id=@id ORDER BY e.id DESC LIMIT @limit OFFSET @offset`).all<EventRow & { product_name: string | null }>({ id, branchId: session.branch_id, limit: pageSize, offset: (page-1)*pageSize })
  const count = await db.prepare('SELECT COUNT(*) AS total FROM inventory_check_events WHERE session_id=@id').get<{ total: number }>({ id })
  actor = await currentInventoryCheckActor(db, principal)
  if (actor.organization_id !== session.organization_id) fail(404, 'inventory_check_session_not_found')
  const access = getInventoryCheckAccess(actor), showCount = access.fields.stock || session.created_by === actor.id
  return { items: rows.map(row => {
    const project = (json: string) => {
      const parsed = JSON.parse(json) as Record<string, unknown> | null
      if (!parsed) return null
      return Object.fromEntries(['state','reason','revision','status','members', ...(showCount ? ['counted_quantity'] : [])].filter(key => Object.hasOwn(parsed,key)).map(key => [key, parsed[key]]))
    }
    const productName = projectInventoryCheckProduct({ name: row.product_name }, access).name
    return { id: row.id, session_id: row.session_id, product_id: row.product_id, product_name: typeof productName === 'string' ? productName : null, actor_id: row.actor_id,
      ...(canSeeStaffIdentity(actor, row.actor_id) ? { actor_name: row.actor_name } : {}),
      action: row.action, created_at: row.created_at, before: project(row.before_json), after: project(row.after_json) }
  }), total: Number(count?.total || 0), page, pageSize }
}
