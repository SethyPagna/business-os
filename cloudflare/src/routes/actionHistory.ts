import { Hono, type Context } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { getPermissionTier, hasPermission, isAdminControlUser, isSensitiveActionHistory, permissionForActionHistory } from '../lib/permissions'
import { isServerReplayable, resolveUndoApplier, applierPermissionTier } from '../lib/undoAppliers'
import type { Env } from '../index'
import { BULK_STATUS_KIND, notifyBulkStatus } from '../lib/saleBulkStatus'
import { notifySaleBulkUpdate, SALE_BULK_UPDATE_KINDS } from '../lib/saleBulkUpdate'
import { notifyReturnBulkAction, RETURN_BULK_ACTION_KIND } from '../lib/returnBulkAction'

const SERVER_SALE_BULK_KINDS = new Set([BULK_STATUS_KIND, ...SALE_BULK_UPDATE_KINDS])
const SERVER_BULK_KINDS = new Set([...SERVER_SALE_BULK_KINDS, RETURN_BULK_ACTION_KIND])

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

type ActionHistoryRow = Record<string, unknown> & {
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

function serializePayload(value: unknown): string {
  if (!value || typeof value !== 'object') return '{}'
  const serialized = JSON.stringify(value)
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
  if (isAdminControlUser(user)) return true
  const permission = permissionForActionHistory(row)
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
    if (applier && applierPermissionTier(user, applier) !== 'full') return false
  }
  return true
}

function canRecordHistory(user: SessionUser, body: Record<string, unknown>): boolean {
  if ([body.undo_payload, body.redo_payload].some(p => p && typeof p === 'object' && SERVER_BULK_KINDS.has(String((p as Record<string, unknown>).applier || '')))) return false
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

function mapRow(row: ActionHistoryRow, user: SessionUser) {
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
  return {
    ...row,
    reversible: !!row.reversible,
    undo_payload: undoPayload,
    redo_payload: redoPayload,
    server_replayable: !!(applier && applierPermissionTier(user, applier) === 'full'),
  }
}

app.get('/', async (c) => {
  const user = c.get('user')
  try {
    const scope = normalizeText(c.req.query('scope'), 'global', 80) || 'global'
    const limit = normalizeLimit(c.req.query('limit'))
    const includeAll = ['1', 'true', 'yes'].includes(String(c.req.query('all') || '').trim().toLowerCase())
    const userIdFilter = String(c.req.query('userId') || '').trim()
    if (userIdFilter && !isAdminControlUser(user)) {
      return c.json({ success: false, error: 'Administrator access required for action user filters.' }, 403)
    }

    const db = getDb(c.env)
    let rows: ActionHistoryRow[] = []
    if (canReadAllHistory(user, includeAll)) {
      if (userIdFilter) {
        rows = await db.prepare(`
          SELECT * FROM action_history WHERE scope = @scope AND created_by_id = @user_id
          ORDER BY updated_at DESC, id DESC LIMIT @limit
        `).all<ActionHistoryRow>({ scope, user_id: Number.parseInt(userIdFilter, 10) || userIdFilter, limit })
      } else {
        rows = await db.prepare(`
          SELECT * FROM action_history WHERE scope = @scope
          ORDER BY updated_at DESC, id DESC LIMIT @limit
        `).all<ActionHistoryRow>({ scope, limit })
      }
    } else {
      rows = await db.prepare(`
        SELECT * FROM action_history WHERE scope = @scope AND created_by_id = @user_id
        ORDER BY updated_at DESC, id DESC LIMIT @limit
      `).all<ActionHistoryRow>({ scope, user_id: user?.id || 0, limit })
    }
    return c.json({ success: true, items: rows.map((row) => mapRow(row, user)) })
  } catch (error) {
    return c.json({ success: false, error: (error as Error)?.message || 'Failed to load action history' }, 500)
  }
})

app.get('/:id/details', async (c) => {
  const user = c.get('user'), db = getDb(c.env)
  const row = await db.prepare('SELECT * FROM action_history WHERE id=?').get<ActionHistoryRow>([Number(c.req.param('id'))])
  if (!row || !canOperateHistoryRow(user, row)) return c.json({ error: 'Action not found.' }, 404)
  const payload = parseJson(row.undo_payload)
  const applierKind = String(payload.applier || '')
  if (!SERVER_BULK_KINDS.has(applierKind) || !canUseNamedAppliers(user, [payload])) return c.json({ error: 'No permission.' }, 403)
  const operationTable = applierKind === RETURN_BULK_ACTION_KIND ? 'return_bulk_operations' : 'sale_bulk_operations'
  const operation = await db.prepare(`SELECT receipt_json FROM ${operationTable} WHERE history_id=?`).get<{ receipt_json: string }>([row.id])
  if (!operation) return c.json({ error: 'Saved details unavailable.' }, 404)
  const receipt = JSON.parse(operation.receipt_json)
  const offset = Math.max(0, Math.min(25, Number.parseInt(c.req.query('offset') || '0', 10) || 0))
  const limit = Math.max(1, Math.min(10, Number.parseInt(c.req.query('limit') || '10', 10) || 10))
  const action = receipt.action || (applierKind === RETURN_BULK_ACTION_KIND
    ? { field: payload.field, source: payload.source, target: payload.target }
    : null)
  return c.json({ action, items: receipt.items.slice(offset, offset + limit), total: receipt.items.length, changedCount: receipt.changedCount, unchangedCount: receipt.unchangedCount })
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
      created_by_name: user?.name ?? null,
    })
    return c.json({ success: true, id: result.lastInsertRowid })
  } catch (error) {
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

    if ([parseJson(existing.undo_payload), parseJson(existing.redo_payload)].some(p => SERVER_BULK_KINDS.has(String(p.applier || '')))) return c.json({ success: false, error: 'Grouped history is server-managed.' }, 403)

    await db.prepare(`
      UPDATE action_history SET status = @status, last_error = @last_error, updated_at = CURRENT_TIMESTAMP WHERE id = @id
    `).run({ status, last_error: body.last_error ? String(body.last_error) : null, id: actionId })

    if (status === 'redoable' || status === 'undoable') {
      await audit(c.env, user?.id ?? null, user?.name ?? null, status === 'redoable' ? 'action_undo' : 'action_redo',
        existing.entity || 'action_history', existing.entity_id || existing.id,
        { actionHistoryId: existing.id, scope: existing.scope, label: existing.label, status })
    }
    return c.json({ success: true })
  } catch (error) {
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
    if (!Number(existing.reversible || 0)) {
      return c.json({ success: false, error: 'This action is recorded only and cannot be reversed' }, 400)
    }
    const currentStatus = String(existing.status || '').toLowerCase()
    const expected = direction === 'undo' ? 'undoable' : 'redoable'
    const nextStatus = direction === 'undo' ? 'redoable' : 'undoable'
    if (currentStatus !== expected) {
      return c.json({ success: false, error: `Action is not ${direction === 'undo' ? 'undoable' : 'redoable'} right now` }, 409)
    }

    // The payload for this direction: undo replays the undo_payload, redo the
    // redo_payload. If it names a server applier (lib/undoAppliers.ts), the
    // Worker performs the reversal here, BEFORE the status flip, so a failed
    // applier leaves the action reversible and retryable rather than half-done.
    const payload = direction === 'undo' ? parseJson(existing.undo_payload) : parseJson(existing.redo_payload)
    const applier = resolveUndoApplier(payload)
    // The applier's own declared permission gates its replay -- full tier,
    // checked HERE at operate time too (recording is gated the same way, but
    // rows written before this gate existed, or by a user since demoted,
    // must not replay on the strength of the row alone). Runs before any
    // status flip so a refusal changes nothing.
    if (applier && applierPermissionTier(user, applier) !== 'full') {
      return c.json({ success: false, error: 'You do not have permission to perform this action' }, 403)
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
      }, 409)
    }
    let applied = false
    if (applier) {
      try {
        await applier.run(payload, { env: c.env, user, direction, historyId: existing.id, generation: body.expected_generation })
        applied = true
      } catch (error) {
        if (!SERVER_BULK_KINDS.has(applier.name)) await db.prepare('UPDATE action_history SET last_error = @last_error, updated_at = CURRENT_TIMESTAMP WHERE id = @id')
          .run({ last_error: (error as Error)?.message || `Failed to ${direction}`, id: existing.id })
        const status = Number((error as Error & { statusCode?: number })?.statusCode) === 409 ? 409 : 500
        return c.json({ success: false, error: (error as Error)?.message || `Failed to ${direction} this action` }, status)
      }
    }

    if (applier && SERVER_BULK_KINDS.has(applier.name)) {
      c.executionCtx.waitUntil(applier.name === RETURN_BULK_ACTION_KIND
        ? notifyReturnBulkAction(c.env)
        : applier.name === BULK_STATUS_KIND
          ? notifyBulkStatus(c.env)
          : notifySaleBulkUpdate(c.env, String(payload.action || '')))
      const row = await db.prepare('SELECT * FROM action_history WHERE id = @id').get<ActionHistoryRow>({ id: existing.id })
      return c.json({ success: true, applied: true, item: row ? mapRow(row, user) : null, payload })
    }

    await db.prepare(`
      UPDATE action_history SET status = @status, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = @id
    `).run({ status: nextStatus, id: existing.id })

    await audit(c.env, user?.id ?? null, user?.name ?? null, direction === 'undo' ? 'action_undo' : 'action_redo',
      existing.entity || 'action_history', existing.entity_id || existing.id,
      { actionHistoryId: existing.id, scope: existing.scope, label: existing.label, status: nextStatus, serverApplied: applied, appliedBy: applier?.name || null })

    const row = await db.prepare('SELECT * FROM action_history WHERE id = @id').get<ActionHistoryRow>({ id: existing.id })
    return c.json({
      success: true,
      applied,
      item: row ? mapRow(row, user) : null,
      payload,
    })
  } catch (error) {
    return c.json({ success: false, error: (error as Error)?.message || `Failed to ${direction} action history` }, 500)
  }
}

app.post('/:id/undo', (c) => completeServerHistoryTransition(c, 'undo'))
app.post('/:id/redo', (c) => completeServerHistoryTransition(c, 'redo'))

export default app
