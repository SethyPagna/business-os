import type { RequestMetrics } from '../lib/requestMetrics'
import { productStockGuardError } from '../lib/productStockGuard'
import { stockTransactionRefusal } from '../lib/stockTransaction'
import { Hono, type Context } from 'hono'
import { acquisitionCostResponses, hasAcquisitionCostInput, projectAcquisitionCosts } from '../lib/acquisitionCostAccess'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit, buildAuditStatement } from '../lib/audit'
import { getActionTier, hasPermission, isAdminControlUser, isSensitiveActionHistory, permissionForActionHistory } from '../lib/permissions'
import { SALE_ADD_ITEMS_ACTION_KIND, branchCutoverClosureRefusal, isUndoClosedByMerge, UNDO_CLOSED_BY_MERGE_CODE, UNDO_CLOSED_BY_MERGE_MESSAGE, PRODUCT_MERGE_GROUP_ACTION_KIND, PRODUCT_MERGE_APPLIER_KINDS, isServerReplayable, resolveUndoApplier, applierPermissionTier, applierAlsoActionDenied, mergeReplayPermissionEffects, replayRefusalCode, UNDO_HISTORY_STALE_CODE, UNDO_NEEDS_ORIGINAL_TAB_CODE, type UndoApplierOutcome } from '../lib/undoAppliers'
import { PRODUCT_SUPPLIER_REFUSAL } from '../lib/productSupplierGate'
import { CUSTOMER_GENDER_RESTORATION_KIND, canRestoreCustomerGender, notifyCustomerGenderRestoration } from '../lib/customerGenderRestoration'
import { PRODUCT_REMOVE_ACTION_KIND } from '../lib/productDelete'
import type { Env } from '../index'
import { BULK_STATUS_KIND, notifyBulkStatus } from '../lib/saleBulkStatus'
import { notifySaleBulkUpdate, SALE_BULK_UPDATE_KINDS } from '../lib/saleBulkUpdate'
import { isLoyaltyAssignmentError, LOYALTY_REASSIGNMENT_CODE } from '../lib/saleCustomerAssignmentGuard'
import { notifyReturnBulkAction, RETURN_BULK_ACTION_KIND } from '../lib/returnBulkAction'
import { sendReturnStatusTelegramEvents } from '../lib/telegram'
import { notifySaleSettlementAction, SALE_SETTLEMENT_ACTION_KIND } from '../lib/saleSettlementAction'
import { STOCK_SESSION_KIND, canReplayStockSessionPayload, notifyStockSession } from '../lib/stockSession'
import { actorSnapshot } from '../lib/actorSnapshot'
import { TRANSFER_OPERATION_KIND, canReplayTransferPayload, notifyTransferOperation } from '../lib/transferOperation'
import { STOCK_LOT_SET_KIND, notifyStockLotSet } from '../lib/stockLotAdjustment'
import { STOCK_IN_LINE_EDIT_KIND, notifyStockInLineEdit } from '../lib/stockInLineEdit'
import { productMergeGroupPrefixFingerprint } from '../lib/undoAppliers'
import { parseMergeCostOutcome } from '../lib/productCostReview'

const SERVER_SALE_BULK_KINDS = new Set([BULK_STATUS_KIND, ...SALE_BULK_UPDATE_KINDS])
const SERVER_BULK_KINDS = new Set([...SERVER_SALE_BULK_KINDS, RETURN_BULK_ACTION_KIND, STOCK_SESSION_KIND, SALE_SETTLEMENT_ACTION_KIND])

// Ported from backend/src/routes/actionHistory.ts. This replaces the
// read-only GET-only stub that lived in compat.ts (no create, no
// undo/redo, no per-row permission/sensitivity filtering at all -- any
// logged-in user could read every scope's history). This is the backing
// store for the frontend's undo/redo toasts: a client records an action
// (with an undo_payload/redo_payload it already knows how to replay), then
// POSTs /:id/undo or /:id/redo to flip status and get the payload back to
// replay locally.
//
// K1 (server-level undo/redo) makes this ADDITIVELY more than a status
// machine: when a payload names an applier registered in lib/undoAppliers.ts,
// the Worker replays the reversal ITSELF and the response says applied:true,
// so the client skips its own closure and the action survives a page reload
// (where no in-memory closure exists). A payload that names no applier behaves
// exactly as before -- flip status, return the payload for the client to
// replay -- so nothing that has not opted in is affected.

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)
app.use('*', acquisitionCostResponses)

export type ActionHistoryRow = Record<string, unknown> & {
  id: number
  scope: string
  entity: string | null
  entity_id: string | null
  reversible: number
  status: string
  undo_payload: string | null
  redo_payload: string | null
  created_by_id: number | null
}

function parseJson(value: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (!value) return fallback
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' ? parsed : fallback
  } catch (_) {
    return fallback
  }
}

function normalizeLimit(value: unknown): number {
  const num = Number.parseInt(String(value ?? ''), 10)
  return Math.min(20, Math.max(1, Number.isFinite(num) ? num : 3))
}

function normalizeText(value: unknown, fallback: string, maxLength: number): string {
  const text = String(value || fallback || '').trim()
  return text.slice(0, Math.max(1, Number(maxLength || 120)))
}

function historyPayloadObject(value: unknown): object {
  return value && typeof value === 'object' ? value : {}
}

function serializePayload(value: unknown): string {
  const serialized = JSON.stringify(historyPayloadObject(value))
  if (serialized.length > 20_000) {
    throw new Error('Action history payload is too large')
  }
  return serialized
}

function canReadAllHistory(user: SessionUser, requestedAll = false): boolean {
  return !!requestedAll && (isAdminControlUser(user) || hasPermission(user, 'audit_log'))
}

function canOperateHistoryRow(user: SessionUser, row: ActionHistoryRow | null | undefined): boolean {
  if (!row) return false
  if (parseJson(row.undo_payload).applier === CUSTOMER_GENDER_RESTORATION_KIND) return canRestoreCustomerGender(user) && Number(row.created_by_id) === Number(user.id)
  if (isAdminControlUser(user)) return true
  const transferPayload = parseJson(row.undo_payload)
  const permission = transferPayload.applier === TRANSFER_OPERATION_KIND
    && (transferPayload.permission === 'branches' || transferPayload.permission === 'inventory')
    ? transferPayload.permission : permissionForActionHistory(row)
  if (permission && !hasPermission(user, permission)) return false
  const payload = { ...parseJson(row.undo_payload), ...parseJson(row.redo_payload) }
  if (isSensitiveActionHistory({ ...row, payload })) return false
  if (Number(row.created_by_id || 0) === Number(user?.id || 0)) return true
  return hasPermission(user, 'audit_log')
}

// A payload naming a registered server applier is gated by the APPLIER's own
// declared permission (full tier -- its replay is a direct write with no
// review queue), never by the row's client-supplied entity/scope. Without
// this, an unrecognized entity derived an empty permission and gated nothing,
// so any account could store -- and later have the Worker replay -- a
// 'branch.update' payload under scope 'global' (Part-77 CRITICAL finding).
function canUseNamedAppliers(user: SessionUser, payloads: Array<unknown>): boolean {
  for (const raw of payloads) {
    const applier = resolveUndoApplier(raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null)
    if (applier?.name === TRANSFER_OPERATION_KIND) {
      if (!canReplayTransferPayload(user, raw as Record<string, unknown>)) return false
    } else if (applier?.name === STOCK_SESSION_KIND) {
      const payload = raw as Record<string, unknown>
      if (payload.snapshot_version !== 2 || !canReplayStockSessionPayload(user, payload)) return false
    } else if (applier?.name === CUSTOMER_GENDER_RESTORATION_KIND) {
      if (!canRestoreCustomerGender(user)) return false
    } else if (applier && applierPermissionTier(user, applier) !== 'full') return false
  }
  return true
}

function isServerManagedPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const payload = value as Record<string, unknown>
  const kind = String(payload.applier || '')
  return kind === CUSTOMER_GENDER_RESTORATION_KIND || kind === TRANSFER_OPERATION_KIND || kind === STOCK_LOT_SET_KIND || kind === STOCK_IN_LINE_EDIT_KIND || SERVER_BULK_KINDS.has(kind) || kind === PRODUCT_MERGE_GROUP_ACTION_KIND || kind === PRODUCT_REMOVE_ACTION_KIND
    || (kind === 'product.merge' && payload.merge_version === 3)
    || (kind === SALE_ADD_ITEMS_ACTION_KIND && typeof payload.operation_id === 'string' && payload.operation_id.length > 0)
}

function canRecordHistory(user: SessionUser, body: Record<string, unknown>): boolean {
  if (hasAcquisitionCostInput({ undo_payload: historyPayloadObject(body.undo_payload), redo_payload: historyPayloadObject(body.redo_payload) }, user)) return false
  if ([body.undo_payload, body.redo_payload].some(isServerManagedPayload)) return false
  if (isAdminControlUser(user)) return true
  if (!canUseNamedAppliers(user, [body.undo_payload, body.redo_payload])) return false
  const permission = permissionForActionHistory({ entity: body.entity, scope: body.scope })
  if (permission && !hasPermission(user, permission)) return false
  const payload = {
    ...(body.undo_payload && typeof body.undo_payload === 'object' ? (body.undo_payload as Record<string, unknown>) : {}),
    ...(body.redo_payload && typeof body.redo_payload === 'object' ? (body.redo_payload as Record<string, unknown>) : {}),
    permission: body.permission || body.permissionKey || null,
    sensitivity: body.sensitivity || null,
  }
  return !isSensitiveActionHistory({ entity: body.entity, scope: body.scope, payload })
}

function visibleHistoryReplayResponse(response: Record<string, unknown>, user: SessionUser): Record<string, unknown> {
  const { payload, ...fields } = response
  const projected = projectAcquisitionCosts({ response_json: fields, undo_payload: payload }, user) as { response_json: Record<string, unknown>; undo_payload: unknown }
  return Object.fromEntries(Object.keys(response).map(key => [key, key === 'payload' ? projected.undo_payload : projected.response_json[key]]))
}

export async function pendingGroupRedoReceipts(db: ReturnType<typeof getDb>, rows: ActionHistoryRow[], user: SessionUser) {
  const candidates = rows.filter(row => row.status === 'recorded' && !Number(row.reversible) && row.last_error == null
    && Number(row.created_by_id) === Number(user.id) && canUseNamedAppliers(user, [parseJson(row.undo_payload), parseJson(row.redo_payload)])
    && parseJson(row.redo_payload).applier === PRODUCT_MERGE_GROUP_ACTION_KIND && parseJson(row.redo_payload).merge_version === 3)
  const found = new Map<number, { version: 1; history_id: number; group_operation_id: string; expected_generation: number }>()
  if (!candidates.length) return found
  const metadata = await db.prepare(`SELECT g.action_history_id,g.review_id,g.group_key,g.operation_id,g.reversal_generation,r.actor_id,
    s.id snapshot_id,s.created_by_id snapshot_actor,s.status snapshot_status,
    json_remove(CASE WHEN json_valid(s.payload_json) THEN s.payload_json ELSE '{}' END,'$.graph_receipt.graph_state') group_payload,
    json_type(CASE WHEN json_valid(s.payload_json) THEN s.payload_json ELSE '{}' END,'$.graph_receipt.graph_state') graph_type,
    m.member_ordinal,m.product_id,m.role,m.status member_status,m.undo_snapshot_id,m.operation_id child_operation,
    c.status child_status,c.created_by_id child_actor,
    CASE WHEN json_array_length(json_extract(c.payload_json,'$.dupImagesBefore'))>0
      OR json_array_length(json_extract(c.payload_json,'$.imagesMovedToKeeper'))>0
      OR (json_type(c.payload_json,'$.dupImagePathBefore') IS NOT NULL AND trim(COALESCE(json_extract(c.payload_json,'$.keeperImagePathBefore'),''))=''
        AND trim(COALESCE(json_extract(c.payload_json,'$.dupImagePathBefore'),''))!='') THEN 1 ELSE 0 END changes_images,
    json_object('keeperId',json_extract(c.payload_json,'$.keeperId'),'dupId',json_extract(c.payload_json,'$.dupId'),
      'operationId',json_extract(c.payload_json,'$.operationId'),'fingerprintPending',json_extract(c.payload_json,'$.fingerprintPending'),
      'costReviewOutcome',json_extract(c.payload_json,'$.costReviewOutcome')) child_payload
    FROM product_conflict_action_groups g JOIN product_conflict_action_reviews r ON r.id=g.review_id
    JOIN action_history h ON h.id=g.action_history_id
    JOIN undo_snapshots s ON s.id=json_extract(CASE WHEN json_valid(h.redo_payload) THEN h.redo_payload ELSE '{}' END,'$.snapshot_id') AND s.kind='product.merge.group'
    JOIN product_conflict_action_group_members m ON m.review_id=g.review_id AND m.group_ordinal=g.ordinal
    LEFT JOIN undo_snapshots c ON c.id=m.undo_snapshot_id AND c.kind='product.merge.group.child' AND json_valid(c.payload_json)
    WHERE g.action_history_id IN (SELECT value FROM json_each(@ids)) ORDER BY g.action_history_id,m.member_ordinal`)
    .all<Record<string, unknown>>({ ids: JSON.stringify(candidates.map(row => row.id)) })
  for (const row of candidates) {
    const pointer = parseJson(row.redo_payload), undo = parseJson(row.undo_payload)
    const keys = 'applier,generation,group_key,merge_version,operation_id,review_id,snapshot_id'
    if (Object.keys(pointer).sort().join(',') !== keys || Object.keys(undo).sort().join(',') !== keys
      || Object.keys(pointer).some(key => pointer[key] !== undo[key]) || !Number.isSafeInteger(pointer.generation) || Number(pointer.generation) < 1
      || !/^product-merge-group-[a-f0-9]{64}$/.test(String(pointer.operation_id))) continue
    const members = metadata.filter(item => Number(item.action_history_id) === Number(row.id)), first = members[0]
    if (!first || first.review_id !== pointer.review_id || first.group_key !== pointer.group_key || first.operation_id !== pointer.operation_id
      || Number(first.snapshot_id) !== pointer.snapshot_id || first.reversal_generation !== pointer.generation
      || Number(first.actor_id) !== Number(user.id) || Number(first.snapshot_actor) !== Number(user.id) || first.snapshot_status !== 'applied' || first.graph_type !== 'text') continue
    const group = parseJson(first.group_payload), receipt = group.graph_receipt as Record<string, unknown> | undefined
    const children = members.filter(item => item.undo_snapshot_id != null), keepers = members.filter(item => item.role === 'keeper')
    const ids = children.map(item => Number(item.undo_snapshot_id))
    if (keepers.length !== 1 || keepers[0].undo_snapshot_id != null || members.length !== children.length + 1 || !ids.length || new Set(ids).size !== ids.length
      || JSON.stringify(group.child_snapshot_ids) !== JSON.stringify(ids) || group.version !== 1 || group.generation !== pointer.generation
      || Object.keys(group).sort().join(',') !== 'child_snapshot_ids,generation,graph_receipt,group_key,prefix_fingerprint,review_id,version'
      || Object.keys(receipt || {}).sort().join(',') !== 'applied_prefix,generation,operation_id,version'
      || group.review_id !== pointer.review_id || group.group_key !== pointer.group_key || receipt?.version !== 1
      || receipt.operation_id !== pointer.operation_id || receipt.generation !== pointer.generation || receipt.applied_prefix !== ids.length
      || group.prefix_fingerprint !== await productMergeGroupPrefixFingerprint(String(pointer.review_id), String(pointer.group_key), ids, Number(pointer.generation))) continue
    const parsed = children.map(item => ({ item, payload: parseJson(item.child_payload) }))
    if (parsed.some(({ item, payload }) => item.role !== 'merged' || item.member_status !== 'undo_ready' || item.child_status !== 'applied'
      || Number(item.child_actor) !== Number(user.id) || payload.operationId !== item.child_operation || payload.dupId !== item.product_id
      || payload.keeperId !== keepers[0].product_id || parseMergeCostOutcome(payload.costReviewOutcome)?.keeperId !== keepers[0].product_id
      || (payload.fingerprintPending !== 0 && payload.fingerprintPending !== 1))
      || parsed.filter(({ payload }) => payload.fingerprintPending === 1).length !== 1 || parsed.at(-1)?.payload.fingerprintPending !== 1
      || (children.some(item => Number(item.changes_images) === 1) && getActionTier(user, 'products', 'image') !== 'full')) continue
    found.set(Number(row.id), { version: 1, history_id: Number(row.id), group_operation_id: String(pointer.operation_id), expected_generation: Number(pointer.generation) - 1 })
  }
  return found
}

async function mapRow(row: ActionHistoryRow, user: SessionUser, env: Env, pendingRedo?: { version: 1; history_id: number; group_operation_id: string; expected_generation: number }) {
  const undoPayload = parseJson(row.undo_payload)
  const redoPayload = parseJson(row.redo_payload)
  // K1 slice 2: tells the client this row's next transition can be replayed
  // by the Worker (its payload names a registered applier), so a RELOADED
  // page -- which has no live closure for the row -- can still render a
  // real Undo/Redo button instead of the inert "Recorded" label. ANDed with
  // THIS user's tier on the applier-declared permission, so the UI never
  // offers a button the operate-time gate would refuse with 403.
  const replayable = isServerReplayable(row, undoPayload, redoPayload)
  const applier = replayable
    ? resolveUndoApplier(String(row.status || '').toLowerCase() === 'redoable' ? redoPayload : undoPayload)
    : null
  const replayPermissionEffects = applier
    ? await mergeReplayPermissionEffects(env, String(row.status || '').toLowerCase() === 'redoable' ? redoPayload : undoPayload, user, String(row.status || '').toLowerCase() === 'redoable' ? 'redo' : 'undo')
    : { changesProductImages: false, choicePermissionError: null }
  const { changesProductImages: replayChangesImages, choicePermissionError } = replayPermissionEffects
  return {
    ...row,
    reversible: !!row.reversible,
    undo_payload: undoPayload,
    redo_payload: redoPayload,
    ...(pendingRedo ? { pending_redo: pendingRedo } : {}),
    server_replayable: !!(applier
      && !choicePermissionError
      && canUseNamedAppliers(user, [undoPayload, redoPayload])
      && (applier.name !== CUSTOMER_GENDER_RESTORATION_KIND || Number(row.created_by_id) === Number(user.id))
      && (!replayChangesImages || getActionTier(user, 'products', 'image') === 'full')),
  }
}

// lib/branchCutoverHistory.ts UNDO_CLOSED_BRANCH_CUTOVER_MOVE, kept as a literal here so this list needs no new import;
// test-cutover-ld-historical-readers-native.cjs pins the two equal.
const CUTOVER_MOVE_MARKER = 'undo_closed:branch_cutover_move'

app.get('/', async (c) => {
  const user = c.get('user')
  try {
    const scope = normalizeText(c.req.query('scope'), 'global', 80) || 'global'
    const limit = normalizeLimit(c.req.query('limit'))
    const includeAll = ['1', 'true', 'yes'].includes(String(c.req.query('all') || '').trim().toLowerCase())
    const userIdFilter = String(c.req.query('userId') || '').trim()
    // The ~3,400 closed entries of the branch consolidation (undo_closed:branch_cutover_move) are hidden from the
    // default list: closing bumps their updated_at, so without this they would fill the newest-20 window of the
    // branches scope. They stay in audit, the stock card and Stock Changes, and `?include_cutover=1` lists them.
    const includeCutover = ['1', 'true', 'yes'].includes(String(c.req.query('include_cutover') || '').trim().toLowerCase())
    const cutoverFilter = includeCutover ? '' : ' AND last_error IS NOT @cutover_move'
    const cutoverParams = includeCutover ? {} : { cutover_move: CUTOVER_MOVE_MARKER }
    if (userIdFilter && !isAdminControlUser(user)) {
      return c.json({ success: false, error: 'Administrator access required for action user filters.' }, 403)
    }

    const db = getDb(c.env)
    let rows: ActionHistoryRow[] = []
    if (canReadAllHistory(user, includeAll)) {
      if (userIdFilter) {
        rows = await db.prepare(`
          SELECT * FROM action_history WHERE scope = @scope AND created_by_id = @user_id${cutoverFilter}
          ORDER BY updated_at DESC, id DESC LIMIT @limit
        `).all<ActionHistoryRow>({ scope, user_id: Number.parseInt(userIdFilter, 10) || userIdFilter, ...cutoverParams, limit })
      } else {
        rows = await db.prepare(`
          SELECT * FROM action_history WHERE scope = @scope${cutoverFilter}
          ORDER BY updated_at DESC, id DESC LIMIT @limit
        `).all<ActionHistoryRow>({ scope, ...cutoverParams, limit })
      }
    } else {
      rows = await db.prepare(`
        SELECT * FROM action_history WHERE scope = @scope AND created_by_id = @user_id${cutoverFilter}
        ORDER BY updated_at DESC, id DESC LIMIT @limit
      `).all<ActionHistoryRow>({ scope, user_id: user?.id || 0, ...cutoverParams, limit })
    }
    const pending = await pendingGroupRedoReceipts(db, rows, user)
    return c.json({ success: true, items: await Promise.all(rows.map((row) => mapRow(row, user, c.env, pending.get(Number(row.id))))) })
  } catch (error) {
    const stockGuard = productStockGuardError(error)
    if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
    return c.json({ success: false, error: (error as Error)?.message || 'Failed to load action history' }, 500)
  }
})

app.get('/movements/:id/revert-preview', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'inventory', 'view') === 'none' || getActionTier(user, 'inventory', 'adjust') !== 'full') {
    return c.json({ success: false, error: 'Reverting a stock movement requires Full Access to Inventory.' }, 403)
  }
  const id = Number(c.req.param('id'))
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ success: false, error: 'Invalid movement id.' }, 400)
  const { StockMovementReplayError, stockMovementRevertPreview } = await import('../lib/stockMovementReplay')
  try {
    const db = getDb(c.env)
    const { revert, history } = await stockMovementRevertPreview(db, id)
    if (history && (!canOperateHistoryRow(user, history)
      || !canUseNamedAppliers(user, [parseJson(history.undo_payload), parseJson(history.redo_payload)]))) {
      return c.json({ success: false, error: 'You do not have permission to perform this action.' }, 403)
    }
    // REVERT-SET: what the confirm must say -- the exact change, and any later
    // Set on the same product and branch that this Revert leaves applied.
    const { laterOpenSets, revertEffect } = await import('../lib/stockRevertEffect')
    const [effect, later] = await Promise.all([revertEffect(db, id, revert), laterOpenSets(db, [id])])
    return c.json({ success: true, revert, effect, laterSets: later.get(id) ?? [] })
  } catch (error) {
    const stockGuard = productStockGuardError(error)
    if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
    const status = error instanceof StockMovementReplayError ? error.status : 500
    return c.json({ success: false, error: error instanceof Error ? error.message : 'Unable to preview this stock action.',
      ...(status === 409 ? { code: replayRefusalCode(error) } : {}) }, status)
  }
})

app.get('/:id/details', async (c) => {
  const user = c.get('user'), db = getDb(c.env)
  const row = await db.prepare('SELECT * FROM action_history WHERE id=?').get<ActionHistoryRow>([Number(c.req.param('id'))])
  if (!row || !canOperateHistoryRow(user, row)) return c.json({ error: 'Action not found.' }, 404)
  const payload = parseJson(row.undo_payload)
  const applierKind = String(payload.applier || '')
  if (applierKind === PRODUCT_REMOVE_ACTION_KIND) {
    if (!canUseNamedAppliers(user, [payload])) return c.json({ error: 'No permission.' }, 403)
    const operation = await db.prepare(`SELECT operation_id,product_id,reason,source,status,generation,created_at,updated_at
      FROM product_remove_operations WHERE action_history_id=@history AND operation_id=@operation`)
      .get<Record<string, unknown>>({ history: row.id, operation: String(payload.operation_id || '') })
    if (!operation) return c.json({ error: 'Saved details unavailable.' }, 404)
    return c.json({ success: true, kind: PRODUCT_REMOVE_ACTION_KIND, total: 1, offset: 0, limit: 1,
      items: [operation], next_offset: null })
  }
  if (applierKind === PRODUCT_MERGE_GROUP_ACTION_KIND) {
    if (!canUseNamedAppliers(user, [payload])) return c.json({ error: 'No permission.' }, 403)
    const group = await db.prepare(`
      SELECT g.review_id,g.ordinal,g.group_key,g.status,g.reversal_generation,
             g.updated_at,COUNT(m.undo_snapshot_id) AS child_count
      FROM product_conflict_action_groups g
      JOIN product_conflict_action_reviews r ON r.id=g.review_id
      JOIN action_history h ON h.id=g.action_history_id AND h.created_by_id=r.actor_id
      LEFT JOIN product_conflict_action_group_members m
        ON m.review_id=g.review_id AND m.group_ordinal=g.ordinal
      WHERE g.action_history_id=? AND g.review_id=? AND g.group_key=?
      GROUP BY g.review_id,g.ordinal,g.group_key,g.status,g.reversal_generation,g.updated_at
    `).get<Record<string, unknown>>([row.id, String(payload.review_id || ''), String(payload.group_key || '')])
    if (!group) return c.json({ error: 'Saved details unavailable.' }, 404)
    const offset = Math.max(0, Math.min(3999, Number.parseInt(c.req.query('offset') || '0', 10) || 0))
    const limit = Math.max(1, Math.min(10, Number.parseInt(c.req.query('limit') || '10', 10) || 10))
    const items = await db.prepare(`
      SELECT member_ordinal,product_id,role,status
      FROM product_conflict_action_group_members
      WHERE review_id=? AND group_ordinal=?
      ORDER BY member_ordinal LIMIT ? OFFSET ?
    `).all<Record<string, unknown>>([String(group.review_id), Number(group.ordinal), limit, offset])
    const totalRow = await db.prepare(`
      SELECT COUNT(*) AS total FROM product_conflict_action_group_members
      WHERE review_id=? AND group_ordinal=?
    `).get<{ total: number }>([String(group.review_id), Number(group.ordinal)])
    return c.json({
      action: { review_id: group.review_id, group_key: group.group_key, status: group.status, generation: group.reversal_generation },
      items,
      total: Number(totalRow?.total || 0),
      childCount: Number(group.child_count || 0),
    })
  }
  if (!SERVER_BULK_KINDS.has(applierKind) || !canUseNamedAppliers(user, [payload])) return c.json({ error: 'No permission.' }, 403)
  const operationTable = applierKind === STOCK_SESSION_KIND
    ? 'stock_session_operations'
    : applierKind === RETURN_BULK_ACTION_KIND
      ? 'return_bulk_operations'
      : applierKind === SALE_SETTLEMENT_ACTION_KIND
        ? 'sale_mutation_receipts'
        : 'sale_bulk_operations'
  const receiptColumn = applierKind === SALE_SETTLEMENT_ACTION_KIND ? 'response_json' : 'receipt_json'
  const operation = await db.prepare(`SELECT ${receiptColumn} AS receipt_json FROM ${operationTable} WHERE history_id=?`).get<{ receipt_json: string }>([row.id])
  if (!operation) return c.json({ error: 'Saved details unavailable.' }, 404)
  const receipt = JSON.parse(operation.receipt_json)
  const items = Array.isArray(receipt.items) ? receipt.items : []
  const offset = Math.max(0, Math.min(25, Number.parseInt(c.req.query('offset') || '0', 10) || 0))
  const limit = Math.max(1, Math.min(10, Number.parseInt(c.req.query('limit') || '10', 10) || 10))
  const action = receipt.action || (applierKind === RETURN_BULK_ACTION_KIND
    ? { field: payload.field, source: payload.source, target: payload.target }
    : null)
  return c.json({ action, items: items.slice(offset, offset + limit), total: items.length, changedCount: receipt.changedCount, unchangedCount: receipt.unchangedCount })
})

app.post('/', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  try {
    if (!canRecordHistory(user, body)) return c.json({ success: false, error: 'No permission' }, 403)
    const label = normalizeText(body.label, '', 200)
    if (!label) return c.json({ success: false, error: 'Action label required' }, 400)

    const db = getDb(c.env)
    const reversible = body.reversible === false ? 0 : 1
    const result = await db.prepare(`
      INSERT INTO action_history (
        scope, entity, entity_id, label, undo_label, redo_label, reversible, status,
        undo_payload, redo_payload, created_by_id, created_by_name
      ) VALUES (@scope, @entity, @entity_id, @label, @undo_label, @redo_label, @reversible, @status,
                @undo_payload, @redo_payload, @created_by_id, @created_by_name)
    `).run({
      scope: normalizeText(body.scope, 'global', 80) || 'global',
      entity: body.entity ? normalizeText(body.entity, '', 80) : null,
      entity_id: body.entity_id != null ? normalizeText(body.entity_id, '', 120) : null,
      label,
      undo_label: body.undo_label ? normalizeText(body.undo_label, '', 200) : null,
      redo_label: body.redo_label ? normalizeText(body.redo_label, '', 200) : null,
      reversible,
      status: reversible ? 'undoable' : 'recorded',
      undo_payload: serializePayload(body.undo_payload),
      redo_payload: serializePayload(body.redo_payload),
      created_by_id: user?.id ?? null,
      created_by_name: actorSnapshot(user),
    })
    return c.json({ success: true, id: result.lastInsertRowid })
  } catch (error) {
    const stockGuard = productStockGuardError(error)
    if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
    return c.json({ success: false, error: (error as Error)?.message || 'Failed to record action history' }, 500)
  }
})

app.patch('/:id', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const status = String(body.status || '').trim()
  if (!['undoable', 'redoable', 'recorded', 'failed'].includes(status)) {
    return c.json({ success: false, error: 'Invalid action history status' }, 400)
  }
  try {
    const db = getDb(c.env)
    const actionId = Number(c.req.param('id') || 0)
    if (!Number.isInteger(actionId) || actionId <= 0) return c.json({ success: false, error: 'Action history item not found' }, 404)
    const existing = await db.prepare('SELECT * FROM action_history WHERE id = @id AND created_by_id = @user_id')
      .get<ActionHistoryRow>({ id: actionId, user_id: user?.id || 0 })
    if (!existing) return c.json({ success: false, error: 'Action history item not found' }, 404)

    if ([parseJson(existing.undo_payload), parseJson(existing.redo_payload)].some(isServerManagedPayload)) return c.json({ success: false, error: 'Grouped history is server-managed.' }, 403)

    await db.prepare(`
      UPDATE action_history SET status = @status, last_error = @last_error, updated_at = CURRENT_TIMESTAMP WHERE id = @id
    `).run({ status, last_error: body.last_error ? String(body.last_error) : null, id: actionId })

    if (status === 'redoable' || status === 'undoable') {
      await audit(c.env, user?.id ?? null, actorSnapshot(user), status === 'redoable' ? 'action_undo' : 'action_redo',
        existing.entity || 'action_history', existing.entity_id || existing.id,
        { actionHistoryId: existing.id, scope: existing.scope, label: existing.label, status })
    }
    return c.json({ success: true })
  } catch (error) {
    const stockGuard = productStockGuardError(error)
    if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
    return c.json({ success: false, error: (error as Error)?.message || 'Failed to update action history' }, 500)
  }
})

async function completeServerHistoryTransition(c: Context<{ Bindings: Env; Variables: { user: SessionUser } }>, direction: 'undo' | 'redo') {
  const user = c.get('user')
  const db = getDb(c.env)
  try {
    // require_applied (K1 slice 2): a caller with NO live closure -- a page
    // that reloaded since the action -- sets this so the request only
    // succeeds when the Worker itself replays the reversal. Without the
    // flag, the pre-existing contract holds: flip the status and hand the
    // payload back for the caller's own closure to replay.
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
    const requireApplied = body?.require_applied === true || ['1', 'true'].includes(String(body?.require_applied || '').toLowerCase())
    const actionId = Number(c.req.param('id') || 0)
    if (!Number.isInteger(actionId) || actionId <= 0) return c.json({ success: false, error: 'Action history item not found' }, 404)
    const existing = await db.prepare('SELECT * FROM action_history WHERE id = @id').get<ActionHistoryRow>({ id: actionId })
    if (!existing || !canOperateHistoryRow(user, existing)) return c.json({ success: false, error: 'Action history item not found' }, 404)
    if (isUndoClosedByMerge(existing)) {
      return c.json({ success: false, error: UNDO_CLOSED_BY_MERGE_MESSAGE, code: UNDO_CLOSED_BY_MERGE_CODE }, 409)
    }
    const branchClosure = branchCutoverClosureRefusal(existing)
    if (branchClosure) return c.json({ success: false, error: branchClosure.message, code: branchClosure.code }, 409)
    const mergeCostReplay = parseJson(existing.undo_payload)?.applier === 'product.merge' && parseJson(existing.undo_payload)?.merge_version === 3
    const pendingGroupPointer = parseJson(existing.redo_payload)
    const groupReceiptRetry = direction === 'redo' && pendingGroupPointer?.applier === PRODUCT_MERGE_GROUP_ACTION_KIND
      && pendingGroupPointer?.merge_version === 3 && Object.keys(pendingGroupPointer).sort().join(',') === 'applier,generation,group_key,merge_version,operation_id,review_id,snapshot_id'
    if (!Number(existing.reversible || 0) && !((mergeCostReplay || groupReceiptRetry) && existing.status === 'recorded')) {
      return c.json({ success: false, error: 'This action is recorded only and cannot be reversed' }, 400)
    }
    const currentStatus = String(existing.status || '').toLowerCase()
    const expected = direction === 'undo' ? 'undoable' : 'redoable'
    const nextStatus = direction === 'undo' ? 'redoable' : 'undoable'
    // A scoped Set replays by generation like a stock session: its applier
    // checks the generation and state itself, and a repeat is idempotent.
    const stockReplay = [STOCK_SESSION_KIND, STOCK_LOT_SET_KIND, STOCK_IN_LINE_EDIT_KIND].includes(String(parseJson(existing.undo_payload)?.applier || ''))
    const groupReplay = parseJson(existing.undo_payload)?.applier === PRODUCT_MERGE_GROUP_ACTION_KIND
    const productRemoveReplay = parseJson(existing.undo_payload)?.applier === PRODUCT_REMOVE_ACTION_KIND
    const transferReplay = parseJson(existing.undo_payload)?.applier === TRANSFER_OPERATION_KIND
    const genderReplay = parseJson(existing.undo_payload)?.applier === CUSTOMER_GENDER_RESTORATION_KIND
    if (currentStatus !== expected && !stockReplay && !groupReplay && !productRemoveReplay && !transferReplay && !genderReplay && !mergeCostReplay) {
      return c.json({ success: false, error: `Action is not ${direction === 'undo' ? 'undoable' : 'redoable'} right now`, code: UNDO_HISTORY_STALE_CODE }, 409)
    }

    // The payload for this direction: undo replays the undo_payload, redo the
    // redo_payload. If it names a server applier (lib/undoAppliers.ts), the
    // Worker performs the reversal here, BEFORE the status flip, so a failed
    // applier leaves the action reversible and retryable rather than half-done.
    const payload = direction === 'undo' ? parseJson(existing.undo_payload) : parseJson(existing.redo_payload)
    const applier = resolveUndoApplier(payload)
    const serverManagedReplay = !!(applier && isServerManagedPayload(payload))
    const replayPermissionEffects = applier
      ? await mergeReplayPermissionEffects(c.env, payload, user, direction)
      : { changesProductImages: false, choicePermissionError: null }
    const { changesProductImages: replayChangesProductImages, choicePermissionError } = replayPermissionEffects
    if (choicePermissionError) return c.json({ success: false, code: choicePermissionError, error: 'Current permission is required to replay the saved Resolve choices.' }, 403)
    // The applier's own declared permission gates its replay -- full tier,
    // checked HERE at operate time too (recording is gated the same way, but
    // rows written before this gate existed, or by a user since demoted,
    // must not replay on the strength of the row alone). Runs before any
    // status flip so a refusal changes nothing.
    if (genderReplay && !canRestoreCustomerGender(user)) return c.json({ success: false, error: 'Administrator Contacts edit permission is required.' }, 403)
    if (applier && (applier.name === TRANSFER_OPERATION_KIND
      ? !canReplayTransferPayload(user, payload)
      : applier.name === STOCK_SESSION_KIND
      ? !canReplayStockSessionPayload(user, payload)
      : applierPermissionTier(user, applier) !== 'full'
        || (replayChangesProductImages && getActionTier(user, 'products', 'image') !== 'full'))) {
      return c.json({ success: false, error: 'You do not have permission to perform this action', ...(applierAlsoActionDenied(user, applier) ? { code: PRODUCT_SUPPLIER_REFUSAL.code } : {}) }, 403)
    }
    // Refuse BEFORE any status flip: if the caller cannot replay the payload
    // itself (require_applied) and the Worker cannot either (no registered
    // applier), flipping the status would record a reversal that never
    // happened. Nothing changes, so the row stays exactly as reversible as
    // it was.
    if (requireApplied && !applier) {
      return c.json({
        success: false,
        error: 'This action was recorded without a server-replayable payload, so it can only be reversed from the tab that performed it.',
        code: UNDO_NEEDS_ORIGINAL_TAB_CODE,
      }, 409)
    }
    let applied = false
    let outcome: UndoApplierOutcome | void = undefined
    if (applier) {
      try {
        const metrics = (c as unknown as { get(key: string): unknown }).get('requestMetrics') as RequestMetrics | undefined
        // Include raw maintenance and reserve six cache attempts plus two history-response attempts.
        const stockSessionQueryBudget = applier.name === STOCK_SESSION_KIND && metrics
          ? { statementsUsed: () => metrics.attemptedStatements + 1, reserveStatements: 8 } : undefined
        outcome = await applier.run(payload, { env: c.env, user, direction, historyId: existing.id, generation: body.expected_generation, stockSessionQueryBudget })
        applied = true
        // Server-applied undo/redo rewrites product and stock rows, but the
        // appliers only BROADCAST; none bumps a cache version. Every reader
        // keyed on the 'stock' version (the Dashboard stock overview,
        // stock-filtered product search pages, the storefront) would keep
        // serving the pre-undo numbers until its TTL. One 'stock' bump here
        // covers every applier. Lazy and fully swallowed: a cache fault must
        // never turn an applied undo into an error.
        if (applier.name !== STOCK_SESSION_KIND) {
          const stockBump = import('../lib/cache').then(({ bumpVersion }) => bumpVersion(c.env, 'stock')).catch(() => {})
          try { c.executionCtx.waitUntil(stockBump) } catch { void stockBump }
        }
        // The version the original writer bumps, so the readers keyed on it (the 20 s Dashboard ranking cache, the
        // Sales list cache, the product lists) turn over now and not at their TTL: added lines move 'sales' (an
        // add-items bumps stock and sales); a merge fold moves 'products'. Awaited, so the next read already sees it.
        const replayNamespaces = applier.name === SALE_ADD_ITEMS_ACTION_KIND ? ['sales']
          : PRODUCT_MERGE_APPLIER_KINDS.has(applier.name) ? ['products'] : []
        if (replayNamespaces.length) await import('../lib/cache').then(({ bumpVersions }) => bumpVersions(c.env, replayNamespaces)).catch(() => {})
      } catch (error) {
        const transactionRefusal = stockTransactionRefusal(error)
        if (transactionRefusal) return c.json({ success: false, ...transactionRefusal }, 503)
        const stockGuard = productStockGuardError(error)
        if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
        if (!serverManagedReplay) await db.prepare('UPDATE action_history SET last_error = @last_error, updated_at = CURRENT_TIMESTAMP WHERE id = @id')
          .run({ last_error: (error as Error)?.message || `Failed to ${direction}`, id: existing.id })
        const code = Number((error as Error & { statusCode?: number })?.statusCode) // Preserve statusCode 409 as a conflict.
        const saleCustomerReplay = SALE_BULK_UPDATE_KINDS.has(applier.name) && (payload.action === 'customer' || payload.action === 'customer_name')
        const status = (stockReplay || saleCustomerReplay || genderReplay) && (code === 400 || code === 403 || code === 404 || code === 503) ? code : code === 409 ? 409 : 500
        // Every 409 refusal names a machine code, so the client can restate it
        // in the operator's language.
        const refusalCode = status === 409 ? replayRefusalCode(error) : null
        // RET-D: a stock applier that named the record it collided with
        // (lib/stockRefusalBlocker.ts) hands { reason, blocker, destination }
        // through, so the refusal can say WHY and link WHERE.
        const blocking = status === 409 ? (error as { refusal?: unknown })?.refusal : null
        const blockingFields = blocking && typeof blocking === 'object' && !Array.isArray(blocking) ? blocking as Record<string, unknown> : {}
        // The numbers a coded refusal's sentence names ("only 3 left, 27 needed").
        const refusalParams = status === 409 ? (error as { params?: unknown })?.params : null
        const paramFields = refusalParams && typeof refusalParams === 'object' && !Array.isArray(refusalParams) ? { params: refusalParams } : {}
        return c.json({ success: false, error: (error as Error)?.message || `Failed to ${direction} this action`, ...blockingFields, ...paramFields, ...(refusalCode ? { code: refusalCode } : {}), ...(saleCustomerReplay && isLoyaltyAssignmentError(error) ? { code: LOYALTY_REASSIGNMENT_CODE } : {}) }, status)
      }
    }

    if (serverManagedReplay && applier) {
      if (applier.name !== SALE_ADD_ITEMS_ACTION_KIND && applier.name !== PRODUCT_MERGE_GROUP_ACTION_KIND && !mergeCostReplay) c.executionCtx.waitUntil(applier.name === CUSTOMER_GENDER_RESTORATION_KIND
        ? notifyCustomerGenderRestoration(c.env)
        : applier.name === TRANSFER_OPERATION_KIND
        ? notifyTransferOperation(c.env)
        : applier.name === STOCK_LOT_SET_KIND
        ? notifyStockLotSet(c.env)
        : applier.name === STOCK_IN_LINE_EDIT_KIND
        ? notifyStockInLineEdit(c.env)
        : applier.name === STOCK_SESSION_KIND
        ? notifyStockSession(c.env, { operationId: String(payload.operation_id) }, true)
        : applier.name === SALE_SETTLEMENT_ACTION_KIND
          ? notifySaleSettlementAction(c.env)
          : applier.name === RETURN_BULK_ACTION_KIND
            ? notifyReturnBulkAction(c.env)
            : applier.name === BULK_STATUS_KIND
              ? notifyBulkStatus(c.env)
              : notifySaleBulkUpdate(c.env, String(payload.action || '')))
      // Telegram (owner, 27 Sep 2026): undoing or redoing a grouped return
      // STATUS change cancels or restores those returns, so it is announced
      // like the original action. The sender reads each return's status now,
      // which is what says "cancelled" or "restored".
      if (applier.name === RETURN_BULK_ACTION_KIND && payload.field === 'status') {
        c.executionCtx.waitUntil(db.prepare('SELECT return_id FROM return_bulk_members WHERE operation_id = @operation')
          .all<{ return_id: number }>({ operation: String(payload.operation_id) })
          .then((rows) => sendReturnStatusTelegramEvents(c.env, rows.map((member) => Number(member.return_id)), actorSnapshot(user)))
          .catch((error) => console.error('[telegram] return status notification failed', error)))
      }
      const row = await db.prepare('SELECT * FROM action_history WHERE id = @id').get<ActionHistoryRow>({ id: existing.id })
      return c.json(visibleHistoryReplayResponse({
        success: true,
        applied: true,
        item: row ? await mapRow(row, user, c.env) : null,
        payload,
        ...(applier.name === PRODUCT_MERGE_GROUP_ACTION_KIND || genderReplay || mergeCostReplay
          ? (outcome || { complete: true, continuation_required: false, processed_children: 0, pending_children: 0, generation: Number(body.expected_generation || 0) })
          : {}),
      }, user))
    }

    const transitionDetails = { actionHistoryId: existing.id, scope: existing.scope, label: existing.label, status: nextStatus, serverApplied: applied, appliedBy: applier?.name || null }
    if (applier) {
      // A server applier already replayed the reversal (and guards its own
      // repeats by generation/state); the flip records it, as before.
      await db.prepare(`
        UPDATE action_history SET status = @status, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = @id
      `).run({ status: nextStatus, id: existing.id })

      await audit(c.env, user?.id ?? null, actorSnapshot(user), direction === 'undo' ? 'action_undo' : 'action_redo',
        existing.entity || 'action_history', existing.entity_id || existing.id, transitionDetails)
    } else {
      // K9a: with no server applier this response IS the permission for the
      // browser to replay the reversal, so the flip must happen exactly once.
      // It is conditional on the status that was read, and the flip, a guard
      // that it really flipped, and the audit row are ONE commit: of two Undo
      // requests for the same record, one succeeds and is recorded once; the
      // other is refused stale and replays nothing.
      try {
        await db.batch([
          { sql: `UPDATE action_history SET status = @status, last_error = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE id = @id AND status IS @fromStatus`, params: { status: nextStatus, id: existing.id, fromStatus: existing.status } },
          { sql: `SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('undo_history_stale', '$') END AS history_transition_guard`, params: {} },
          buildAuditStatement(user?.id ?? null, actorSnapshot(user), direction === 'undo' ? 'action_undo' : 'action_redo',
            existing.entity || 'action_history', existing.entity_id || existing.id, transitionDetails),
        ])
      } catch (error) {
        const current = await db.prepare('SELECT status FROM action_history WHERE id = @id').get<{ status: string | null }>({ id: existing.id })
        if (!current || current.status !== existing.status) {
          return c.json({ success: false, error: `Action is not ${direction === 'undo' ? 'undoable' : 'redoable'} right now`, code: UNDO_HISTORY_STALE_CODE }, 409)
        }
        throw error
      }
    }

    const row = await db.prepare('SELECT * FROM action_history WHERE id = @id').get<ActionHistoryRow>({ id: existing.id })
    return c.json(visibleHistoryReplayResponse({
      success: true,
      applied,
      item: row ? await mapRow(row, user, c.env) : null,
      payload,
    }, user))
  } catch (error) {
    const stockGuard = productStockGuardError(error)
    if (stockGuard) return c.json({ error: stockGuard.message, code: stockGuard.code }, 409)
    const transactionRefusal = stockTransactionRefusal(error)
    if (transactionRefusal) return c.json({ success: false, ...transactionRefusal }, 503)
    return c.json({ success: false, error: (error as Error)?.message || `Failed to ${direction} action history` }, 500)
  }
}

app.post('/:id/undo', (c) => completeServerHistoryTransition(c, 'undo'))
app.post('/:id/redo', (c) => completeServerHistoryTransition(c, 'redo'))

export default app
