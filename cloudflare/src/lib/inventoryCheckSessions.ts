import type { D1Compat } from './db'
import type { SessionUser } from './auth'
import { resolveLowStockConfig, type LowStockConfig } from './lowStockSettings'
import { canApproveInventoryCounts, getInventoryCheckAccess, projectInventoryCheckProduct, validateInventoryCheckQuery } from './inventoryCheckAccess'
import { buildInventoryCheckStockQuery, readInventoryCheckStock, resetInventoryCheckStockSchemaMemo, type InventoryCheckStockRow } from './inventoryCheckStock'
import { buildInventoryCheckProductMembershipQuery } from './inventoryCheckProducts'
import { hasPermission, isAdminControlUser } from './permissions'
import { stockVisibleProductSql } from './productStockGuard'
import { actorSnapshot } from './actorSnapshot'
import { localDateExpr } from './businessDateWindow'

export type InventoryCheckPrincipal = { id: number; tokenHash: string }
export type InventoryCheckReceipt = { requestId: string; eventId: number; action: string; sessionId: string; sessionRevision: number; itemRevision?: number; replayed: boolean }
export type InventoryCheckSession = { id: string; branch_id: number; created_by: number; title: string; status: 'open' | 'closed'; revision: number; started_at: string; updated_at: string; closed_at: string | null; scope: Record<string, unknown>; can_edit: boolean; progress: { total: number; unstarted: number; done: number; issue: number } }
export type InventoryCheckSessionListItem = InventoryCheckSession & { branch_name: string | null; creator_name?: string | null; approval?: InventoryCheckApproval }
export type InventoryCheckObservation = { product_id: number; branch_id: number; product_snapshot: Record<string, unknown>; current_product_available: boolean; current_product_name: string | null; state: 'unstarted' | 'done' | 'issue'; reason: string | null; revision: number; counted_quantity?: number | null; baseline_quantity?: number | null; current_quantity?: number | null; stock_changed?: boolean | null; baseline?: Record<string, unknown>; current_stock?: Record<string, unknown> }
export type Actor = SessionUser & { tokenHash: string; product_cost_review_key_available?: number }
export type SessionRow = Omit<InventoryCheckSession, 'scope' | 'can_edit' | 'progress'> & { organization_id: number | null; scope_json: string }
type ItemRow = { session_id: string; product_id: number; branch_id: number; product_snapshot_json: string; current_product_available?: number; current_product_name?: string | null; baseline_quantity: number | null; baseline_json: string; state: InventoryCheckObservation['state']; counted_quantity: number | null; reason: string | null; revision: number; updated_by: number | null; updated_at: string | null }
type EventRow = { id: number; session_id: string; product_id: number | null; actor_id: number; actor_name: string | null; action: string; request_id: string; request_hash: string; before_json: string; after_json: string; result_json: string; created_at: string }
export type Statement = { sql: string; params?: Record<string, unknown> }

export class InventoryCheckSessionError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 503, readonly code: string, readonly details?: Record<string, unknown>) { super(code); this.name = 'InventoryCheckSessionError' }
}
const fail = (status: InventoryCheckSessionError['status'], code: string, details?: Record<string, unknown>): never => { throw new InventoryCheckSessionError(status, code, details) }
export const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail(400, 'inventory_check_invalid_request')
const revision = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail(400, 'inventory_check_revision_required')
const positive = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fail(400, 'inventory_check_invalid_id')
export const requestId = (value: unknown): string => typeof value === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(value) ? value : fail(400, 'inventory_check_request_id_required')
export const parse = (value: string): Record<string, unknown> => object(JSON.parse(value))
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
export async function schemaReady(db: D1Compat): Promise<void> {
  if (checkSchemaReady) return
  const ready = await db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN (
    'inventory_check_sessions','inventory_check_items','inventory_check_events','inventory_check_events_no_update',
    'inventory_check_events_no_delete','inventory_check_sessions_identity','inventory_check_sessions_no_delete',
    'inventory_check_items_baseline','inventory_check_items_no_delete')`).get<{ n: number }>()
  if (ready?.n !== 9) fail(503, 'inventory_check_schema_unavailable')
  checkSchemaReady = true
}
export const guard = (expression: string, code: string, params: Record<string, unknown>): Statement => ({ sql: `SELECT CASE WHEN ${expression} THEN 1 ELSE json_extract('[]','$[${code}]') END`, params })
export function authorityGuard(actor: Actor): Statement {
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
export async function sessionRow(db: D1Compat, actor: Actor, id: string): Promise<SessionRow> {
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
export const canSeeStaffIdentity = (actor: Actor, accountId: number): boolean => isAdminControlUser(actor) || hasPermission(actor,'audit_log') || accountId === actor.id
/** The branch of one session, for a session view of the products list: same actor and organization fence as reading the session, without its items or stock. */
export async function getInventoryCheckSessionBranch(db: D1Compat, principal: InventoryCheckPrincipal, id: string): Promise<{ branch_id: number }> {
  const actor = await currentInventoryCheckActor(db, principal); await schemaReady(db)
  return { branch_id: (await sessionRow(db, actor, id)).branch_id }
}
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
/** What a submitted count's approval looks like to a viewer who may see stock (the approval row exists only for counts that differ, so it is withheld from everyone else). */
export type ApprovalAppliedLine = { before: number; target: number; after: number; at: string; settled?: true; clamped?: true; wanted?: number }
export type InventoryCheckApproval = { status: 'pending' | 'approved' | 'rejected'; lines: number; applied: number; submitted_at: string; can_approve: boolean;
  /** Decided by the system, not by a person: every line was replaced by a newer count (queue-first). It has no decider; its decision_note says why. */
  replaced?: true;
  decided_at?: string; decision_note?: string | null; decided_by_name?: string | null; applied_lines?: Record<string, ApprovalAppliedLine>;
  /** Stock may already have moved for this approval: it can no longer be rejected; it ends by being finished or closed, and another approver takes it over only when its claimer is gone. */
  applying?: boolean; applying_request_id?: string;
  /** The approval was ended by a close: the lines applied stay applied (status approved), and these were NOT applied, each with the reason (a refusal code or inventory_check_not_applied). */
  closed?: { lines: Record<string, string> };
  /** Per product, the stock the counter saw when counting: the figure the count is measured against. */
  baselines?: Record<string, number>;
  /** Lines replaced by a newer count of the same product (queue-first: one waiting item per product): product id -> the session of the newer count. They are never applied. */
  superseded?: Record<string, string> }
export type ApprovalRow = { session_id: string; status: 'pending' | 'approved' | 'rejected'; lines: number; submitted_by: number; submitted_at: string;
  decided_by: number | null; decided_by_name: string | null; decided_at: string | null; decision_note: string | null; decision_request_id: string | null; applied_json: string;
  applying_request_id: string | null; applying_by: number | null; applying_at: string | null; takeovers: number; closed_json: string | null; baselines_json?: string; superseded_json?: string }
export const APPROVAL_COLUMNS = 'session_id,status,lines,submitted_by,submitted_at,decided_by,decided_by_name,decided_at,decision_note,decision_request_id,applied_json,applying_request_id,applying_by,applying_at,takeovers,closed_json'
export const APPROVAL_DETAIL_COLUMNS = `${APPROVAL_COLUMNS},baselines_json,superseded_json`
let approvalsSchemaReady = false
/** True once migration 0286 (the table and its four triggers) is applied; a positive answer is remembered for the isolate, a miss re-probes. */
export async function approvalsAvailable(db: D1Compat): Promise<boolean> {
  if (approvalsSchemaReady) return true
  try {
    const ready = await db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('inventory_check_approvals','inventory_check_approvals_identity',
      'inventory_check_approvals_decided','inventory_check_approvals_claim','inventory_check_approvals_no_delete')`).get<{ n: number }>()
    approvalsSchemaReady = ready?.n === 5
  } catch { approvalsSchemaReady = false }
  return approvalsSchemaReady
}
let lotLinesSchemaReady = false
/** True once migration 0294 (inventory_check_lot_lines) is applied; a positive answer is remembered for the isolate, a miss re-probes. */
export async function lotLinesAvailable(db: D1Compat): Promise<boolean> {
  if (lotLinesSchemaReady) return true
  try {
    // A zero-row probe of the table itself (the migration creates the table, its index and its two triggers together): it reads no schema rows, which a cold isolate pays for with a sqlite_master scan.
    await db.prepare('SELECT 1 FROM inventory_check_lot_lines LIMIT 0').all()
    lotLinesSchemaReady = true
  } catch { lotLinesSchemaReady = false }
  return lotLinesSchemaReady
}
export async function approvalsReady(db: D1Compat): Promise<void> {
  if (!await approvalsAvailable(db)) fail(503, 'inventory_check_schema_unavailable')
}
export function appliedLines(json: string): Record<string, ApprovalAppliedLine> {
  try {
    const lines = (JSON.parse(json) as { lines?: unknown }).lines
    return lines && typeof lines === 'object' && !Array.isArray(lines) ? lines as Record<string, ApprovalAppliedLine> : {}
  } catch { return {} }
}
export function approvalBaselines(json: string | undefined): Record<string, number> {
  try {
    const parsed = JSON.parse(json ?? '{}') as unknown
    const entries = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.entries(parsed) : []
    return Object.fromEntries(entries.filter(([, value]) => typeof value === 'number' && Number.isFinite(value))) as Record<string, number>
  } catch { return {} }
}
/** The lines a newer count replaced: product id -> the session of that count. */
export function supersededLines(json: string | undefined): Record<string, string> {
  try {
    const parsed = JSON.parse(json ?? '{}') as unknown
    const entries = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.entries(parsed) : []
    return Object.fromEntries(entries.filter(([, value]) => typeof value === 'string')) as Record<string, string>
  } catch { return {} }
}
/** The lines a close left unapplied, each with its reason. */
export function closedLines(json: string | null): { lines: Record<string, string> } | undefined {
  if (!json) return undefined
  try {
    const lines = (JSON.parse(json) as { lines?: unknown }).lines
    return { lines: lines && typeof lines === 'object' && !Array.isArray(lines) ? lines as Record<string, string> : {} }
  } catch { return { lines: {} } }
}
export function projectApproval(actor: Actor, row: ApprovalRow, detail = false): InventoryCheckApproval {
  const applied = appliedLines(row.applied_json), closed = closedLines(row.closed_json)
  return { status: row.status, lines: row.lines, applied: Object.keys(applied).length, submitted_at: row.submitted_at, can_approve: canApproveInventoryCounts(actor),
    ...(row.decided_at ? { decided_at: row.decided_at, decision_note: row.decision_note } : {}),
    ...(row.status === 'rejected' && row.decided_by == null && row.decided_at ? { replaced: true as const } : {}),
    ...(closed ? { closed } : {}),
    ...(row.decided_by != null && canSeeStaffIdentity(actor, row.decided_by) ? { decided_by_name: row.decided_by_name } : {}),
    ...(row.status === 'pending' && row.applying_request_id ? { applying: true, ...(row.applying_by === actor.id ? { applying_request_id: row.applying_request_id } : {}) } : {}),
    ...(detail ? { applied_lines: applied, ...(row.baselines_json ? { baselines: approvalBaselines(row.baselines_json) } : {}),
      ...(Object.keys(supersededLines(row.superseded_json)).length ? { superseded: supersededLines(row.superseded_json) } : {}) } : {}) }
}
/** One query for the approvals of the given sessions, inside the viewer's organization. Callers ask only for viewers who may see stock. */
export async function approvalRows(db: D1Compat, actor: Actor, ids: string[], detail = false): Promise<ApprovalRow[]> {
  if (!ids.length) return []
  await approvalsReady(db)
  return db.prepare(`SELECT ${detail ? APPROVAL_DETAIL_COLUMNS : APPROVAL_COLUMNS} FROM inventory_check_approvals WHERE organization_id IS @organization
    AND session_id IN (SELECT value FROM json_each(@ids))`).all<ApprovalRow>({ organization: actor.organization_id, ids: JSON.stringify(ids) })
}
/** A line waits when its approval is pending, it is a difference, no stock write for it has been recorded and no newer count of the product has replaced it. */
export const waitingLineSql = (a: string, i: string): string => `${a}.status='pending' AND ${i}.baseline_quantity IS NOT NULL AND ${i}.counted_quantity IS NOT NULL AND abs(${i}.baseline_quantity-${i}.counted_quantity)>0.000000001
  AND json_extract(${a}.applied_json,'$.lines."'||${i}.product_id||'"') IS NULL AND json_extract(${a}.superseded_json,'$."'||${i}.product_id||'"') IS NULL`
const WAITING_LINE_SQL = waitingLineSql('a', 'i')
/** Does this one count line still wait for approval? (Fix stock is held while it does.) */
export async function lineWaitsForApproval(db: D1Compat, sessionId: string, productId: number): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 AS waiting FROM inventory_check_approvals a JOIN inventory_check_items i ON i.session_id=a.session_id
    WHERE a.session_id=@sessionId AND i.product_id=@productId AND ${WAITING_LINE_SQL} LIMIT 1`).get<{ waiting: number }>({ sessionId, productId })
  return row?.waiting === 1
}
/** Does ANY count of this product at this branch still wait for approval? (ic_lot_counts: a direct Set is held while one does.) Index 0285 finds the product's lines at the branch, the approval is a primary-key step each. */
export async function productWaitsForApproval(db: D1Compat, productId: number, branchId: number): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 AS waiting FROM inventory_check_items i JOIN inventory_check_approvals a ON a.session_id=i.session_id
    WHERE i.product_id=@productId AND i.branch_id=@branchId AND ${WAITING_LINE_SQL} LIMIT 1`).get<{ waiting: number }>({ productId, branchId })
  return row?.waiting === 1
}
/** The page's counts that still wait for approval, as `${session id}:${product id}`: one query for a page of list rows, inside the viewer's organization. Only a count that differs from stock waits; a matching line of the same submission does not. */
export async function pendingApprovalLines(db: D1Compat, actor: Actor, productIds: number[]): Promise<Set<string>> {
  if (!productIds.length) return new Set()
  await approvalsReady(db)
  const rows = await db.prepare(`SELECT i.session_id,i.product_id FROM inventory_check_approvals a JOIN inventory_check_items i ON i.session_id=a.session_id
    WHERE a.organization_id IS @organization AND i.product_id IN (SELECT value FROM json_each(@ids)) AND ${WAITING_LINE_SQL}`)
    .all<{ session_id: string; product_id: number }>({ organization: actor.organization_id, ids: JSON.stringify(productIds) })
  return new Set(rows.map(row => `${row.session_id}:${row.product_id}`))
}
async function sessionApproval(db: D1Compat, actor: Actor, id: string, options: { approvals?: boolean }): Promise<{ approval?: InventoryCheckApproval }> {
  if (!options.approvals || !getInventoryCheckAccess(actor).fields.stock) return {}
  const row = (await approvalRows(db, actor, [id], true))[0]
  return row ? { approval: projectApproval(actor, row, true) } : {}
}
export async function getInventoryCheckSession(db: D1Compat, principal: InventoryCheckPrincipal, id: string, options: { approvals?: boolean; lotLines?: boolean } = {}) {
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
  const approval = await sessionApproval(db, actor, session.id, options)
  // ic_lot_counts: what was typed per received date (by the table's key, one read), shown under the counts of this session; the figures follow the counted/seen rules of the item itself.
  const linesOf = new Map<number, Array<Record<string, unknown>>>()
  const access = getInventoryCheckAccess(actor), ownSession = session.created_by === actor.id
  if (options.lotLines && (access.fields.stock || ownSession) && await lotLinesAvailable(db)) {
    const rows = await db.prepare(`SELECT l.product_id,l.batch_id,l.scope,l.counted_quantity,l.seen_quantity,pb.received_at FROM inventory_check_lot_lines l LEFT JOIN product_batches pb ON pb.id=l.batch_id
      WHERE l.session_id=@id ORDER BY l.product_id,l.batch_id`).all<{ product_id: number; batch_id: number; scope: string; counted_quantity: number; seen_quantity: number | null; received_at: string | null }>({ id })
    for (const row of rows) {
      const list = linesOf.get(Number(row.product_id)) ?? []
      list.push({ batch_id: Number(row.batch_id), scope: row.scope === 'branch' ? 'branch' : 'lot', counted: Number(row.counted_quantity),
        ...(access.fields.stock && row.seen_quantity != null ? { seen: Number(row.seen_quantity) } : {}), ...(access.fields.received && row.received_at ? { received_at: row.received_at } : {}) })
      linesOf.set(Number(row.product_id), list)
    }
  }
  return { item: await projectSession(db, actor, session), items: items.map(item => ({ ...projectObservation(actor, item, ownSession, byId.get(item.product_id)), ...(linesOf.has(item.product_id) ? { lot_lines: linesOf.get(item.product_id) } : {}) })), ...approval }
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
export async function listInventoryCheckSessions(db: D1Compat, principal: InventoryCheckPrincipal, query: Record<string, string>, options: { approvals?: boolean } = {}) {
  let actor = await currentInventoryCheckActor(db, principal); await schemaReady(db)
  const page = pageNumber(query.page, 1, 100000), pageSize = pageNumber(query.pageSize, 20, 100)
  const branchId = query.branchId ? positive(Number(query.branchId)) : null
  const filters = sessionListFilters(query)
  // "Waiting for approval" (ic_fix_stock): only for a viewer who is shown approvals, and only that value.
  const showsApprovals = options.approvals === true && getInventoryCheckAccess(actor).fields.stock
  const waiting = query.approval == null || query.approval === '' ? false : query.approval === 'pending' && showsApprovals ? true : fail(400, 'inventory_check_invalid_filter')
  const organization = actor.organization_id
  // Filters run before LIMIT so the page total counts every matching session. started_at is a UTC instant; the day filter is the Cambodia business day.
  const params = { organization, branchId, ...filters, actorId: actor.id, limit: pageSize, offset: (page-1)*pageSize }
  const where = `organization_id IS @organization AND (@branchId IS NULL OR branch_id=@branchId) AND (@status IS NULL OR status=@status)
    AND (@mine=0 OR created_by=@actorId) AND (@startDate IS NULL OR ${localDateExpr('started_at')}>=@startDate) AND (@endDate IS NULL OR ${localDateExpr('started_at')}<=@endDate)${waiting
      ? " AND EXISTS(SELECT 1 FROM inventory_check_approvals a WHERE a.session_id=inventory_check_sessions.id AND a.status='pending' AND a.organization_id IS @organization)" : ''}`
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
  if (showsApprovals) {
    const byId = new Map((await approvalRows(db, actor, items.map(item => item.id))).map(row => [row.session_id, row]))
    for (const item of items) { const row = byId.get(item.id); if (row) item.approval = projectApproval(actor, row) }
  }
  // `approvals` tells the page this viewer is shown approvals, so it may offer the "Waiting for approval" filter.
  return { items, page, pageSize, total: Number((count.results?.[0] as { total: number })?.total || 0), ...(showsApprovals ? { approvals: true } : {}) }
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
export function eventStatement(actor: Actor, args: { sessionId: string; productId?: number; action: string; key: string; hash: string; before: unknown; after: unknown; result: Record<string, unknown>; now: string }): Statement {
  return { sql: `INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at)
    VALUES(@sessionId,@productId,@actorId,@actorName,@action,@key,@hash,@before,@after,@result,@now)`, params: {
    sessionId: args.sessionId, productId: args.productId ?? null, actorId: actor.id, actorName: actorSnapshot(actor), action: args.action,
    key: args.key, hash: args.hash, before: JSON.stringify(args.before), after: JSON.stringify(args.after), result: JSON.stringify(args.result), now: args.now,
  } }
}
async function commit(db: D1Compat, principal: InventoryCheckPrincipal, actor: Actor, statements: Statement[], key: string, hash: string): Promise<{ event: EventRow; replayed: boolean; results?: D1Result[] }> {
  let results: D1Result[] | undefined
  try { results = await db.batchOnce([authorityGuard(actor), ...statements]) }
  catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    if (text.includes('inventory_check_authority_changed')) fail(403, 'inventory_check_authority_changed')
    if (text.includes('inventory_check_count_in_progress')) fail(409, 'inventory_check_count_in_progress')
    if (text.includes('inventory_check_stock_changed')) fail(409, 'inventory_check_stock_changed')
    if (text.includes('inventory_check_no_lot')) fail(409, 'inventory_check_no_lot')
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
  return event ? { event, replayed: false, results } : fail(503, 'inventory_check_outcome_unknown')
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
/** `simple` (ic_simple): the scope is the owner's closed query and its membership is the simplified cohort. Absent, the old validation and cohort apply unchanged. */
export async function createInventoryCheckSession(db: D1Compat, principal: InventoryCheckPrincipal, input: unknown, lowStock: LowStockConfig, options: { simple?: boolean } = {}) {
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
  for (const key of options.simple ? ['state','reason','sessionId','summary'] : ['state','reason','sessionId']) {
    if (rawScope[key] !== undefined && rawScope[key] !== '') fail(400,'inventory_check_invalid_scope')
    delete rawScope[key]
  }
  const query = validateInventoryCheckQuery({...rawScope,branchId:String(branchId)},getInventoryCheckAccess(actor),options.simple === true)
  const normalizedScope:Record<string,unknown> = {...query,...(marker ? {membership:marker} : {})}
  const scope = Object.fromEntries(Object.keys(normalizedScope).sort().map(key=>[key,normalizedScope[key]]))
  const hash = await inventoryCheckDigest(JSON.stringify({ action: 'create', branchId, productIds, title, scope }))
  const existing = await receipt(db, actor, key, hash)
  if (existing) return { ...(await committedSessionProjection(db, principal, existing.session_id)), receipt: receiptResponse(existing, true), created: false }
  const settings = await db.prepare(LOW_STOCK_ROWS_SQL).all<{key:string;value:string}>()
  const settingsSignature = JSON.stringify(settings.map(row=>({key:row.key,value:row.value})))
  lowStock = resolveLowStockConfig(Object.fromEntries(settings.map(row=>[row.key,row.value])))
  const membership = buildInventoryCheckProductMembershipQuery(query, productIds, getInventoryCheckAccess(actor), lowStock, options.simple ? { organizationId: actor.organization_id ?? null } : undefined)
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
/** The waiting lines of the submitted products at one branch whose stock figures are planned: they are being applied now and cannot be replaced. */
const BEING_APPLIED_SQL = `FROM inventory_check_approvals a JOIN inventory_check_items i ON i.session_id=a.session_id
  WHERE a.organization_id IS @organization AND a.branch_id=@branchId AND i.product_id IN (SELECT value FROM json_each(@submitted)) AND ${WAITING_LINE_SQL}
    AND json_extract(a.plan_json,'$."'||i.product_id||'"') IS NOT NULL`
/**
 * Queue-first: one waiting item per product, holding the newest count. A count of a product whose earlier count still waits at this branch closes that older line as
 * superseded in the same atomic commit that records the new one; the new count then queues itself if it differs from stock, or is Done if it equals it. An approval left
 * with nothing to apply and nothing applied is rejected there too. A line that is being applied right now (its stock figures are planned) is never replaced: the whole
 * submission is refused, whatever the figures say, so a refusal tells nobody what the stock holds; the guard sits ahead of the replacement in the same batch, so the two never race.
 * Four statements however many approvals are touched, and the same four for every submission (a commit that raced another still replaces what that one queued).
 */
/**
 * The audit events of the older lines a submission replaced. Only approvals this very commit touched can hold the new session, and they are few: the ones still waiting (the queue) and the ones this
 * commit just rejected (their decision time is this commit's). Neither reads the organization's history, however long: the first by the pending index, the second by the progress index.
 */
export const SUPERSEDE_EVENTS_SQL = `INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at)
  SELECT a.session_id,CAST(j.key AS INTEGER),@actorId,@actorName,'observe',@key||'-superseded-'||a.session_id||'-'||j.key,@hash,
    json_object('approval','pending'),json_object('approval',a.status,'superseded_by',@id),json_object('sessionRevision',s.revision),@now
  FROM (SELECT session_id,status,superseded_json FROM inventory_check_approvals INDEXED BY inventory_check_approvals_pending WHERE organization_id IS @organization AND status='pending' AND branch_id=@branchId
    UNION ALL
    SELECT session_id,status,superseded_json FROM inventory_check_approvals WHERE branch_id=@branchId AND COALESCE(decided_at,applying_at)=@now AND status='rejected' AND organization_id IS @organization) a
    JOIN inventory_check_sessions s ON s.id=a.session_id, json_each(a.superseded_json) j
  WHERE j.value=@id`
function supersedeStatements(params: Record<string, unknown>): Statement[] {
  const A = 'inventory_check_approvals'
  const waitingOfApproval = `FROM inventory_check_items i WHERE i.session_id=${A}.session_id AND i.product_id IN (SELECT value FROM json_each(@submitted)) AND ${waitingLineSql(A, 'i')}`
  return [
    guard(`NOT EXISTS(SELECT 1 ${BEING_APPLIED_SQL})`, 'inventory_check_count_in_progress', params),
    { sql: `UPDATE ${A} SET superseded_json=json_patch(superseded_json,(SELECT json_group_object(CAST(i.product_id AS TEXT),@id) ${waitingOfApproval}))
      WHERE organization_id IS @organization AND branch_id=@branchId AND status='pending' AND EXISTS(SELECT 1 ${waitingOfApproval})`, params },
    { sql: `UPDATE ${A} SET status='rejected',decided_by=NULL,decided_by_name=NULL,decided_at=@now,decision_note=@replacedNote,decision_request_id=@key
      WHERE organization_id IS @organization AND branch_id=@branchId AND status='pending' AND applying_request_id IS NULL AND applied_json='{}'
        AND EXISTS(SELECT 1 FROM json_each(superseded_json) WHERE value=@id)
        AND NOT EXISTS(SELECT 1 FROM inventory_check_items i WHERE i.session_id=${A}.session_id AND i.baseline_quantity IS NOT NULL AND i.counted_quantity IS NOT NULL
          AND abs(i.baseline_quantity-i.counted_quantity)>0.000000001 AND json_extract(superseded_json,'$."'||i.product_id||'"') IS NULL)
      RETURNING session_id`, params: { ...params, replacedNote: REPLACED_NOTE } },
    { sql: SUPERSEDE_EVENTS_SQL, params },
  ]
}
/** A differing count with no typed note carries this sentence; the page shows its own translation in its place. */
export const DEFAULT_COUNT_NOTE = 'Count differs from stock'
/** The decision note of an approval every line of which a newer count replaced: no person decided it (decided_by is NULL), and this says why. The page and the alert show their own words. */
export const REPLACED_NOTE = 'Replaced by a newer count'
const COUNT_EPSILON = 0.000000001
const SUBMISSION_LINE_KEYS = new Set(['productId', 'countedQuantity', 'seenQuantity', 'checked', 'note'])
type SubmissionLine = { productId: number; counted: number; seen: number | null; checked: boolean; note: string | null }
function submissionQuantity(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000 ? value : fail(400, 'inventory_check_invalid_quantity')
}
function submissionLine(value: unknown): SubmissionLine {
  const line = object(value)
  if (Object.keys(line).some(key => !SUBMISSION_LINE_KEYS.has(key))) fail(400, 'inventory_check_invalid_request')
  if (line.checked !== undefined && typeof line.checked !== 'boolean') fail(400, 'inventory_check_invalid_request')
  const note = line.note == null ? null : typeof line.note === 'string' ? line.note.trim() || null : fail(400, 'inventory_check_invalid_note')
  if (note !== null && note.length > 500) fail(400, 'inventory_check_invalid_note')
  return { productId: positive(line.productId), counted: submissionQuantity(line.countedQuantity), seen: line.seenQuantity == null ? null : submissionQuantity(line.seenQuantity), checked: line.checked === true, note }
}
/**
 * The owner's way to count (ic_simple): products picked on the list, a count typed in each row, one Submit. The whole submission is recorded
 * at once as a closed count session: a matching count is Done, a differing one an Issue with its note. Stock is never written here.
 * A viewer without the stock field cannot compare, so every line of theirs is recorded Done (as marking Done has always been for them).
 * `approvals` (ic_fix_stock): a submission with at least one count that differs from stock also creates ONE pending approval in the same atomic commit.
 */
export async function createInventoryCheckSubmission(db: D1Compat, principal: InventoryCheckPrincipal, input: unknown, lowStock: LowStockConfig,
  options: { approvals?: boolean; onApprovalCreated?: (created: { sessionId: string }) => Promise<void>; onApprovalsReplaced?: (replaced: { sessionIds: string[] }) => Promise<void> } = {}) {
  const body = object(input), actor = await currentInventoryCheckActor(db, principal, true); await schemaReady(db)
  if (options.approvals) await approvalsReady(db)
  const access = getInventoryCheckAccess(actor)
  const branchId = positive(body.branchId), key = requestId(body.requestId)
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 500) return fail(400, 'inventory_check_product_ids_required')
  const lines = body.lines.map(submissionLine).sort((a, b) => a.productId - b.productId)
  const productIds = lines.map(line => line.productId)
  if (new Set(productIds).size !== productIds.length) fail(400, 'inventory_check_invalid_id')
  const title = body.title === undefined ? '' : typeof body.title === 'string' ? body.title.trim() : fail(400, 'inventory_check_invalid_title')
  if (title.length > 120) fail(400, 'inventory_check_invalid_title')
  if (!access.fields.stock && lines.some(line => line.checked)) fail(400, 'inventory_check_invalid_request')
  const hash = await inventoryCheckDigest(JSON.stringify({ action: 'submit', branchId, title, lines }))
  const existing = await receipt(db, actor, key, hash)
  if (existing) return { ...(await committedSessionProjection(db, principal, existing.session_id)), ...(await sessionApproval(db, actor, existing.session_id, options)), receipt: receiptResponse(existing, true), created: false }
  const settings = await db.prepare(LOW_STOCK_ROWS_SQL).all<{key:string;value:string}>()
  const settingsSignature = JSON.stringify(settings.map(row=>({key:row.key,value:row.value})))
  lowStock = resolveLowStockConfig(Object.fromEntries(settings.map(row=>[row.key,row.value])))
  const membership = buildInventoryCheckProductMembershipQuery({ branchId: String(branchId) }, productIds, access, lowStock, { organizationId: actor.organization_id ?? null })
  const eligible = await db.prepare(membership.rowsSql).all<{ id: number }>(membership.params)
  if (eligible.length !== productIds.length) fail(400, 'inventory_check_product_not_eligible')
  const snapshot = await validatedStockSnapshot(db, branchId, productIds)
  const baselines = snapshot.rows
  if (baselines.length !== productIds.length) fail(409, 'inventory_check_baseline_changed')
  const byId = new Map(baselines.map(row => [row.product_id, row]))
  const products = await db.prepare('SELECT id,name,image_path,unit,parent_id,is_group FROM products WHERE id IN (SELECT value FROM json_each(@ids)) ORDER BY id').all<Record<string, unknown>>({ ids: JSON.stringify(productIds) })
  const productById = new Map(products.map(product => [Number(product.id), product]))
  // "Marked checked" means the count the person saw equalled stock. If stock moved since, the mark is stale and the whole submission is refused, never recorded as a difference.
  const resolved = lines.map(line => {
    const baseline = byId.get(line.productId), quantity = baseline?.quantity ?? null
    const matched = access.fields.stock && quantity !== null && Math.abs(quantity - line.counted) <= COUNT_EPSILON
    const state: 'done' | 'issue' = !access.fields.stock || matched ? 'done' : 'issue'
    return { line, baseline, matched, state, reason: state === 'issue' ? line.note ?? DEFAULT_COUNT_NOTE : null }
  })
  // The figure the counter saw is checked against the stock of now by the server, never trusted: a count that differs is measured from that stock, so a screen that is
  // out of date (or a made-up figure) is a recount. Only a viewer who sees stock has a screen to be out of date; for everyone else the figure means nothing and is ignored.
  const staleScreen = (item: typeof resolved[number]): boolean => options.approvals === true && access.fields.stock && item.line.seen !== null && item.baseline?.quantity != null
    && !item.matched && Math.abs(item.baseline.quantity - item.line.seen) > COUNT_EPSILON
  const stale = resolved.filter(item => (item.line.checked && !item.matched) || staleScreen(item)).map(item => item.line.productId)
  if (stale.length) fail(409, 'inventory_check_stock_changed', { productIds: stale })
  const now = new Date().toISOString(), id = crypto.randomUUID()
  const members = await Promise.all(resolved.map(async item => ({ product_id: item.line.productId, product: productById.get(item.line.productId), baseline: item.baseline,
    state: item.state, counted: item.line.counted, reason: item.reason,
    event_request_id: `${key}-${item.line.productId}`, event_hash: await inventoryCheckDigest(JSON.stringify({ action: 'submit-line', hash, productId: item.line.productId })) })))
  if (members.some(member => !member.product || !member.baseline)) fail(409, 'inventory_check_baseline_changed')
  // A count differs when stock was readable and not equal to it; this is judged here for every viewer, so a count typed without seeing stock is still reviewed.
  const differing = options.approvals ? resolved.filter(item => item.baseline?.quantity != null && Math.abs(item.baseline.quantity - item.line.counted) > COUNT_EPSILON).length : 0
  const scope = { membership: 'submission' }
  // The figure a count is later measured against is the stock at submit. For a viewer who sees stock it equals what the counter saw (checked above); for anyone else it is the only trustworthy figure.
  const seenJson = JSON.stringify(Object.fromEntries(resolved.map(item => [String(item.line.productId), item.baseline?.quantity ?? null]).filter(([, seen]) => seen !== null)))
  const params = { id, organization: actor.organization_id, branchId, actorId: actor.id, actorName: actorSnapshot(actor), title, scopeJson: JSON.stringify(scope), now,
    members: JSON.stringify(members), baseline: JSON.stringify(baselines), count: productIds.length, signature: snapshot.signature }
  const stock = buildInventoryCheckStockQuery({ branchId, productIds })
  const comparisons = [...STOCK_COLUMNS, 'consistent'].map(column => `a.${column} IS json_extract(e.value,'$.${column}')`).join(' AND ')
  const supersede = options.approvals ? supersedeStatements({ ...params, submitted: JSON.stringify(productIds), key, hash }) : []
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
    ...supersede,
    { sql: `INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at)
      VALUES(@id,@organization,@branchId,@actorId,@title,'closed',0,@scopeJson,@now,@now,@now)`, params },
    { sql: `INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at)
      SELECT @id,json_extract(value,'$.product_id'),@branchId,json_extract(value,'$.product'),json_extract(value,'$.baseline.quantity'),json_extract(value,'$.baseline'),
        json_extract(value,'$.state'),json_extract(value,'$.counted'),json_extract(value,'$.reason'),1,@actorId,@now FROM json_each(@members)`, params },
    eventStatement(actor, { sessionId: id, action: 'create', key, hash, before: null, after: { status: 'closed', revision: 0, members: productIds.length }, result: { sessionRevision: 0 }, now }),
    { sql: `INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at)
      SELECT @id,json_extract(value,'$.product_id'),@actorId,@actorName,'observe',json_extract(value,'$.event_request_id'),json_extract(value,'$.event_hash'),
        json_object('state','unstarted','counted_quantity',NULL,'reason',NULL,'revision',0),
        json_object('state',json_extract(value,'$.state'),'counted_quantity',json_extract(value,'$.counted'),'reason',json_extract(value,'$.reason'),'revision',1),
        json_object('sessionRevision',0,'itemRevision',1),@now FROM json_each(@members)`, params },
    ...(differing > 0 ? [{ sql: `INSERT INTO inventory_check_approvals(session_id,organization_id,branch_id,status,lines,submitted_by,submitted_at,baselines_json)
      VALUES(@id,@organization,@branchId,'pending',@differing,@actorId,@now,@seenJson)`, params: { ...params, differing, seenJson } }] : []),
  ]
  let saved: Awaited<ReturnType<typeof commit>>
  try { saved = await commit(db, principal, actor, statements, key, hash) }
  catch (error) {
    // The refusal names the products, read only now that it happened: it is the same for every count of them, whatever the figure typed.
    if (error instanceof InventoryCheckSessionError && error.code === 'inventory_check_count_in_progress') {
      const busy = await db.prepare(`SELECT DISTINCT i.product_id ${BEING_APPLIED_SQL} ORDER BY i.product_id`).all<{ product_id: number }>({ organization: actor.organization_id, branchId, submitted: JSON.stringify(productIds) }).catch(() => [])
      fail(409, 'inventory_check_count_in_progress', { productIds: busy.map(row => row.product_id) })
    }
    throw error
  }
  // Told once, after the commit that made the approval (never for a replay); an announcement never fails the submission it announces.
  if (differing > 0 && !saved.replayed) { try { await options.onApprovalCreated?.({ sessionId: saved.event.session_id }) } catch { /* announced best-effort */ } }
  // The approvals this commit replaced were rejected by the system: each is a review decided, so each is told once (the statement that rejected them names them; a replay is never told again).
  if (!saved.replayed && supersede.length) {
    const replacedAt = statements.indexOf(supersede[2]) + 1 // the batch starts with the authority guard
    const replacedIds = (saved.results?.[replacedAt]?.results ?? []).map(row => String((row as { session_id: string }).session_id))
    if (replacedIds.length) { try { await options.onApprovalsReplaced?.({ sessionIds: replacedIds }) } catch { /* announced best-effort */ } }
  }
  return { ...(await committedSessionProjection(db, principal, saved.event.session_id)), ...(await sessionApproval(db, actor, saved.event.session_id, options)), receipt: receiptResponse(saved.event, saved.replayed), created: !saved.replayed }
}
// ---- ic_lot_counts: a count per received date (INV-B S5; migration 0294; Inventory replan rev. 2, sections 2.6 and 2.7) ----------------------------------------------------------
// The submission of the owner's way to count, with a count typed per received date (or one branch total) for each product. Nothing here reads the stock ledger or verifies stock:
//   - a counter who sees stock sends the figure SEEN for every line; the batch itself refuses (409 inventory_check_stock_changed) unless the quantity of that received date
//     (the branch quantity, for a branch-total line) is that figure at the moment of the write -- the guard sits in the same atomic batch as the inserts;
//   - a counter who may not see stock sends none: the seen figure is read from live stock INSIDE the insert (seen_source 'write'), so a blind count is measured from the stock of the write.
// The product's item row keeps its state and total (counted = the sum of its lines, baseline = the sum of the seen figures), so sessions, history, the Issues filter, queue-first supersede and
// the approval plan work as they always did; the lines ride in inventory_check_lot_lines. A refused stale figure answers with the figures of now, read only on that refusal path.
type LotLine = { batchId: number; scope: 'lot' | 'branch'; counted: number; seen: number | null }
// A plain line (countedQuantity / seenQuantity, as the older writer takes it) counts the product's branch total with no received-date lines: a submission may mix both kinds.
type LotSubmissionLine = { productId: number; checked: boolean; note: string | null; lots: LotLine[]; plain?: { counted: number; seen: number | null } }
const LOT_SUBMISSION_LINE_KEYS = new Set(['productId', 'lots', 'checked', 'note'])
const PLAIN_SUBMISSION_LINE_KEYS = new Set(['productId', 'countedQuantity', 'seenQuantity', 'checked', 'note'])
const LOT_LINE_KEYS = new Set(['batchId', 'scope', 'counted', 'seen'])
/** The lines one product may carry (getPlanLimits.inventoryCheckLotLinesPerProduct): more received dates than that on one product is not a count of it. */
function lotSubmissionLine(value: unknown, sighted: boolean, perProduct: number): LotSubmissionLine {
  const line = object(value)
  if (line.lots === undefined && line.countedQuantity !== undefined) {
    if (Object.keys(line).some(key => !PLAIN_SUBMISSION_LINE_KEYS.has(key))) fail(400, 'inventory_check_invalid_request')
    if (line.checked !== undefined && typeof line.checked !== 'boolean') fail(400, 'inventory_check_invalid_request')
    const plainNote = line.note == null ? null : typeof line.note === 'string' ? line.note.trim() || null : fail(400, 'inventory_check_invalid_note')
    if (plainNote !== null && plainNote.length > 500) fail(400, 'inventory_check_invalid_note')
    const plainSeen = line.seenQuantity == null ? null : submissionQuantity(line.seenQuantity)
    if (sighted && plainSeen === null) fail(400, 'inventory_check_invalid_request')
    return { productId: positive(line.productId), checked: line.checked === true, note: plainNote, lots: [], plain: { counted: submissionQuantity(line.countedQuantity), seen: sighted ? plainSeen : null } }
  }
  if (Object.keys(line).some(key => !LOT_SUBMISSION_LINE_KEYS.has(key))) fail(400, 'inventory_check_invalid_request')
  if (line.checked !== undefined && typeof line.checked !== 'boolean') fail(400, 'inventory_check_invalid_request')
  const note = line.note == null ? null : typeof line.note === 'string' ? line.note.trim() || null : fail(400, 'inventory_check_invalid_note')
  if (note !== null && note.length > 500) fail(400, 'inventory_check_invalid_note')
  if (!Array.isArray(line.lots) || line.lots.length < 1 || line.lots.length > perProduct) return fail(400, 'inventory_check_invalid_request')
  const lots = line.lots.map((raw): LotLine => {
    const lot = object(raw)
    if (Object.keys(lot).some(key => !LOT_LINE_KEYS.has(key))) fail(400, 'inventory_check_invalid_request')
    const scope = lot.scope === 'lot' || lot.scope === 'branch' ? lot.scope : fail(400, 'inventory_check_invalid_request')
    const batchId = scope === 'branch' ? (lot.batchId === undefined || lot.batchId === 0 ? 0 : fail(400, 'inventory_check_invalid_id')) : positive(lot.batchId)
    const seen = lot.seen == null ? null : submissionQuantity(lot.seen)
    if (sighted && seen === null) fail(400, 'inventory_check_invalid_request')
    return { batchId, scope, counted: submissionQuantity(lot.counted), seen: sighted ? seen : null }
  })
  // A product is counted by received date or by its branch total, not both; a received date is counted once.
  if (lots.some(lot => lot.scope === 'branch') && lots.length !== 1) fail(400, 'inventory_check_invalid_request')
  if (new Set(lots.map(lot => lot.batchId)).size !== lots.length) fail(400, 'inventory_check_invalid_id')
  return { productId: positive(line.productId), checked: line.checked === true, note, lots }
}
/** The quantity a line stands for right now: the received date's quantity at the branch, or the branch quantity for a branch-total line. */
const LIVE_LINE_SQL = (line: string) => `CASE json_extract(${line},'$.scope')
  WHEN 'lot' THEN COALESCE((SELECT bbs.quantity FROM branch_batch_stock bbs WHERE bbs.batch_id=json_extract(${line},'$.batch_id') AND bbs.branch_id=@branchId),0)
  ELSE COALESCE((SELECT bs.quantity FROM branch_stock bs WHERE bs.product_id=json_extract(${line},'$.product_id') AND bs.branch_id=@branchId),0) END`
const ACTIVE_LOT_SQL = (productId: string, batchId?: string) => `EXISTS(SELECT 1 FROM product_batches pb JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id AND bbs.branch_id=@branchId
  WHERE pb.variant_product_id=${productId} AND pb.is_active=1${batchId ? ` AND pb.id=${batchId}` : ''})`
export async function createInventoryCheckLotSubmission(db: D1Compat, principal: InventoryCheckPrincipal, input: unknown,
  options: { approvals?: boolean; maxLines: number; maxLinesPerProduct: number; onApprovalCreated?: (created: { sessionId: string }) => Promise<void>; onApprovalsReplaced?: (replaced: { sessionIds: string[] }) => Promise<void> }) {
  const body = object(input), actor = await currentInventoryCheckActor(db, principal, true); await schemaReady(db)
  if (options.approvals) await approvalsReady(db)
  const access = getInventoryCheckAccess(actor), sighted = access.fields.stock
  const branchId = positive(body.branchId), key = requestId(body.requestId)
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 500) return fail(400, 'inventory_check_product_ids_required')
  const lines = body.lines.map(value => lotSubmissionLine(value, sighted, options.maxLinesPerProduct)).sort((a, b) => a.productId - b.productId)
  const productIds = lines.map(line => line.productId)
  if (new Set(productIds).size !== productIds.length) fail(400, 'inventory_check_invalid_id')
  if (lines.reduce((sum, line) => sum + Math.max(1, line.lots.length), 0) > options.maxLines) fail(400, 'inventory_check_too_many_lines')
  const title = body.title === undefined ? '' : typeof body.title === 'string' ? body.title.trim() : fail(400, 'inventory_check_invalid_title')
  if (title.length > 120) fail(400, 'inventory_check_invalid_title')
  if (!sighted && lines.some(line => line.checked)) fail(400, 'inventory_check_invalid_request')
  const hash = await inventoryCheckDigest(JSON.stringify({ action: 'submit-lots', branchId, title, lines }))
  const existing = await receipt(db, actor, key, hash)
  if (existing) return { ...(await committedSessionProjection(db, principal, existing.session_id)), ...(await sessionApproval(db, actor, existing.session_id, options)), receipt: receiptResponse(existing, true), created: false }
  // A product may be counted when it is a stock-visible, countable row (not a family header with children): the point lookups the snapshot guard repeats inside the batch. The older
  // membership cohort is not used here: it carries the stock ledger, which a count per received date never reads.
  const eligible = await db.prepare(`SELECT p.id FROM products p WHERE p.id IN (SELECT value FROM json_each(@ids)) AND ${stockVisibleProductSql()} AND ${CHECKABLE_SQL}`).all<{ id: number }>({ ids: JSON.stringify(productIds) })
  if (eligible.length !== productIds.length) fail(400, 'inventory_check_product_not_eligible')
  const products = await db.prepare('SELECT id,name,image_path,unit,parent_id,is_group FROM products WHERE id IN (SELECT value FROM json_each(@ids)) ORDER BY id').all<Record<string, unknown>>({ ids: JSON.stringify(productIds) })
  const productById = new Map(products.map(product => [Number(product.id), product]))
  if (products.length !== productIds.length) fail(409, 'inventory_check_baseline_changed')
  // "Marked checked" means the count the person saw equalled stock: the figures it was typed against are the ones the batch guards, so a mismatch here is a recount, never a difference.
  const resolved = lines.map(line => {
    const counted = line.plain ? line.plain.counted : line.lots.reduce((sum, lot) => sum + lot.counted, 0)
    const seen = !sighted ? null : line.plain ? line.plain.seen : line.lots.reduce((sum, lot) => sum + (lot.seen ?? 0), 0)
    // Every typed date must equal what it showed: a shortage on one date and a surplus on another (sums equal) is still two wrong figures.
    const matched = seen !== null && Math.abs(seen - counted) <= COUNT_EPSILON && line.lots.every(lot => lot.seen !== null && Math.abs(lot.seen - lot.counted) <= COUNT_EPSILON)
    const state: 'done' | 'issue' = !sighted || matched ? 'done' : 'issue'
    return { line, counted, seen, matched, state, reason: state === 'issue' ? line.note ?? DEFAULT_COUNT_NOTE : null }
  })
  const stale = resolved.filter(item => item.line.checked && !item.matched).map(item => item.line.productId)
  if (stale.length) fail(409, 'inventory_check_stock_changed', { productIds: stale })
  const now = new Date().toISOString(), id = crypto.randomUUID()
  const members = await Promise.all(resolved.map(async item => ({ product_id: item.line.productId, product: productById.get(item.line.productId), baseline: item.seen,
    state: item.state, counted: item.counted, reason: item.reason,
    event_request_id: `${key}-${item.line.productId}`, event_hash: await inventoryCheckDigest(JSON.stringify({ action: 'submit-line', hash, productId: item.line.productId })) })))
  const lotLines = resolved.flatMap(item => item.line.lots.map(lot => ({ product_id: item.line.productId, batch_id: lot.batchId, scope: lot.scope, seen: lot.seen, counted: lot.counted })))
  const params = { id, organization: actor.organization_id, branchId, actorId: actor.id, actorName: actorSnapshot(actor), title, scopeJson: JSON.stringify({ membership: 'submission' }), now,
    members: JSON.stringify(members), lines: JSON.stringify(lotLines),
    plain: JSON.stringify(resolved.filter(item => item.line.plain).map(item => ({ product_id: item.line.productId, seen: item.line.plain!.seen }))), count: productIds.length, sighted: sighted ? 1 : 0, eps: COUNT_EPSILON }
  const supersede = options.approvals ? supersedeStatements({ ...params, submitted: JSON.stringify(productIds), key, hash }) : []
  const lineAlias = 'e.value'
  const statements: Statement[] = [
    guard('EXISTS(SELECT 1 FROM branches WHERE id=@branchId AND is_active=1)', 'inventory_check_baseline_changed', params),
    guard(`NOT EXISTS(SELECT 1 FROM json_each(@members) e LEFT JOIN products p ON p.id=json_extract(e.value,'$.product_id')
      WHERE p.id IS NULL OR p.name IS NOT json_extract(e.value,'$.product.name') OR p.image_path IS NOT json_extract(e.value,'$.product.image_path')
      OR p.unit IS NOT json_extract(e.value,'$.product.unit') OR p.parent_id IS NOT json_extract(e.value,'$.product.parent_id')
      OR p.is_group IS NOT json_extract(e.value,'$.product.is_group') OR NOT (${stockVisibleProductSql()}) OR NOT ${CHECKABLE_SQL})`, 'inventory_check_baseline_changed', params),
    // Each received date exists, belongs to its product and is active at this branch; a branch-total line needs an active received date to land on.
    guard(`NOT EXISTS(SELECT 1 FROM json_each(@lines) e WHERE json_extract(${lineAlias},'$.scope')='lot' AND NOT ${ACTIVE_LOT_SQL(`json_extract(${lineAlias},'$.product_id')`, `json_extract(${lineAlias},'$.batch_id')`)})`, 'inventory_check_baseline_changed', params),
    guard(`NOT EXISTS(SELECT 1 FROM json_each(@lines) e WHERE json_extract(${lineAlias},'$.scope')='branch' AND NOT ${ACTIVE_LOT_SQL(`json_extract(${lineAlias},'$.product_id')`)})`, 'inventory_check_no_lot', params),
    // The seen figures, inside the batch: the quantity of each line is what the counter saw at the moment of the write, or nothing is written.
    // A plain line is measured against the branch total the counter saw, inside the same batch.
    ...(sighted ? [guard(`NOT EXISTS(SELECT 1 FROM json_each(@plain) e WHERE abs(COALESCE((SELECT bs.quantity FROM branch_stock bs WHERE bs.product_id=json_extract(e.value,'$.product_id') AND bs.branch_id=@branchId),0)-json_extract(e.value,'$.seen'))>@eps)`, 'inventory_check_stock_changed', params)] : []),
    ...(sighted ? [guard(`NOT EXISTS(SELECT 1 FROM json_each(@lines) e WHERE abs(${LIVE_LINE_SQL(lineAlias)}-json_extract(${lineAlias},'$.seen'))>@eps)`, 'inventory_check_stock_changed', params)] : []),
    ...supersede,
    { sql: `INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at)
      VALUES(@id,@organization,@branchId,@actorId,@title,'closed',0,@scopeJson,@now,@now,@now)`, params },
    // A blind count's baseline is the live sum of its lines, read by this very statement.
    { sql: `INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at)
      SELECT @id,json_extract(m.value,'$.product_id'),@branchId,json_extract(m.value,'$.product'),
        CASE WHEN @sighted=1 THEN json_extract(m.value,'$.baseline')
          ELSE COALESCE((SELECT SUM(${LIVE_LINE_SQL('e.value')}) FROM json_each(@lines) e WHERE json_extract(e.value,'$.product_id')=json_extract(m.value,'$.product_id')),
            (SELECT COALESCE((SELECT bs.quantity FROM branch_stock bs WHERE bs.product_id=json_extract(m.value,'$.product_id') AND bs.branch_id=@branchId),0))) END,
        '{}',json_extract(m.value,'$.state'),json_extract(m.value,'$.counted'),json_extract(m.value,'$.reason'),1,@actorId,@now FROM json_each(@members) m`, params },
    { sql: `INSERT INTO inventory_check_lot_lines(session_id,product_id,branch_id,batch_id,scope,seen_quantity,counted_quantity,seen_source,created_at)
      SELECT @id,json_extract(e.value,'$.product_id'),@branchId,json_extract(e.value,'$.batch_id'),json_extract(e.value,'$.scope'),
        CASE WHEN @sighted=1 THEN json_extract(e.value,'$.seen') ELSE ${LIVE_LINE_SQL('e.value')} END,json_extract(e.value,'$.counted'),
        CASE WHEN @sighted=1 THEN 'screen' ELSE 'write' END,@now FROM json_each(@lines) e`, params },
    eventStatement(actor, { sessionId: id, action: 'create', key, hash, before: null, after: { status: 'closed', revision: 0, members: productIds.length }, result: { sessionRevision: 0 }, now }),
    { sql: `INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at)
      SELECT @id,json_extract(value,'$.product_id'),@actorId,@actorName,'observe',json_extract(value,'$.event_request_id'),json_extract(value,'$.event_hash'),
        json_object('state','unstarted','counted_quantity',NULL,'reason',NULL,'revision',0),
        json_object('state',json_extract(value,'$.state'),'counted_quantity',json_extract(value,'$.counted'),'reason',json_extract(value,'$.reason'),'revision',1),
        json_object('sessionRevision',0,'itemRevision',1),@now FROM json_each(@members)`, params },
  ]
  // The approval exists only when a count differs (judged from the stored figures, so a blind count is reviewed too); it carries the per-product seen totals.
  const approvalAt = statements.length
  if (options.approvals) statements.push({ sql: `INSERT INTO inventory_check_approvals(session_id,organization_id,branch_id,status,lines,submitted_by,submitted_at,baselines_json)
    SELECT @id,@organization,@branchId,'pending',d.n,@actorId,@now,(SELECT json_group_object(CAST(i.product_id AS TEXT),i.baseline_quantity) FROM inventory_check_items i WHERE i.session_id=@id AND i.baseline_quantity IS NOT NULL)
    FROM (SELECT COUNT(*) AS n FROM inventory_check_items i WHERE i.session_id=@id AND i.baseline_quantity IS NOT NULL AND (abs(i.baseline_quantity-i.counted_quantity)>@eps
      OR EXISTS(SELECT 1 FROM inventory_check_lot_lines l WHERE l.session_id=i.session_id AND l.product_id=i.product_id AND abs(l.seen_quantity-l.counted_quantity)>@eps))) d WHERE d.n>0 RETURNING session_id`, params })
  let saved: Awaited<ReturnType<typeof commit>>
  try { saved = await commit(db, principal, actor, statements, key, hash) }
  catch (error) {
    if (error instanceof InventoryCheckSessionError && error.code === 'inventory_check_count_in_progress') {
      const busy = await db.prepare(`SELECT DISTINCT i.product_id ${BEING_APPLIED_SQL} ORDER BY i.product_id`).all<{ product_id: number }>({ organization: actor.organization_id, branchId, submitted: JSON.stringify(productIds) }).catch(() => [])
      fail(409, 'inventory_check_count_in_progress', { productIds: busy.map(row => row.product_id) })
    }
    if (error instanceof InventoryCheckSessionError && error.code === 'inventory_check_stock_changed') {
      // The figures of now, read only because the write was refused: per line, what the quantity is at this moment (a few rows, never the ledger).
      const liveRows = await db.prepare(`SELECT json_extract(e.value,'$.product_id') AS productId,json_extract(e.value,'$.batch_id') AS batchId,json_extract(e.value,'$.scope') AS scope,
        json_extract(e.value,'$.seen') AS seen,${LIVE_LINE_SQL('e.value')} AS quantity FROM json_each(@lines) e`).all<{ productId: number; batchId: number; scope: string; seen: number | null; quantity: number }>({ lines: params.lines, branchId }).catch(() => [])
      const changed = liveRows.filter(row => row.seen === null || Math.abs(Number(row.quantity) - Number(row.seen)) > COUNT_EPSILON)
      fail(409, 'inventory_check_stock_changed', { productIds: [...new Set(changed.map(row => Number(row.productId)))], current: changed.map(row => ({ productId: Number(row.productId), batchId: Number(row.batchId), scope: row.scope, quantity: Number(row.quantity) })) })
    }
    throw error
  }
  const created = options.approvals && !saved.replayed && (saved.results?.[approvalAt + 1]?.results ?? []).length > 0
  if (created) { try { await options.onApprovalCreated?.({ sessionId: saved.event.session_id }) } catch { /* announced best-effort */ } }
  if (!saved.replayed && supersede.length) {
    const replacedAt = statements.indexOf(supersede[2]) + 1 // the batch starts with the authority guard
    const replacedIds = (saved.results?.[replacedAt]?.results ?? []).map(row => String((row as { session_id: string }).session_id))
    if (replacedIds.length) { try { await options.onApprovalsReplaced?.({ sessionIds: replacedIds }) } catch { /* announced best-effort */ } }
  }
  return { ...(await committedSessionProjection(db, principal, saved.event.session_id)), ...(await sessionApproval(db, actor, saved.event.session_id, options)), receipt: receiptResponse(saved.event, saved.replayed), created: !saved.replayed }
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
  // A submitted count is final: it was recorded closed, and reopening it would let its saved lines be edited after the fact.
  if (action === 'resume' && parse(session.scope_json).membership === 'submission') fail(409, 'inventory_check_session_final')
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
  const approvalKeys = access.fields.stock ? ['approval', 'stock_before', 'stock_after', 'lines', 'superseded_by'] : []
  return { items: rows.map(row => {
    const project = (json: string) => {
      const parsed = JSON.parse(json) as Record<string, unknown> | null
      if (!parsed) return null
      return Object.fromEntries(['state','reason','revision','status','members', ...approvalKeys, ...(showCount ? ['counted_quantity'] : [])].filter(key => Object.hasOwn(parsed,key)).map(key => [key, parsed[key]]))
    }
    const productName = projectInventoryCheckProduct({ name: row.product_name }, access).name
    return { id: row.id, session_id: row.session_id, product_id: row.product_id, product_name: typeof productName === 'string' ? productName : null, actor_id: row.actor_id,
      ...(canSeeStaffIdentity(actor, row.actor_id) ? { actor_name: row.actor_name } : {}),
      action: row.action, created_at: row.created_at, before: project(row.before_json), after: project(row.after_json) }
  }), total: Number(count?.total || 0), page, pageSize }
}
