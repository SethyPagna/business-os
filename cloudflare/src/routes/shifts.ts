import { Hono } from 'hono'
import { getDb, type D1Compat } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { BUSINESS_TZ_FORWARD, BUSINESS_UTC_OFFSET_MINUTES, localTodayExpr } from '../lib/businessDateWindow'
import { hasAnyPermission, isAdminControlUser } from '../lib/permissions'
import { sendTelegramShiftReport } from '../lib/telegram'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)

export type ShiftScopeMode = 'per_account' | 'shop_wide'
export type ShiftPolicy = { scope_mode: ShiftScopeMode; admin_exempt: boolean }
export type ShiftRow = {
  id: number; shift_code: string; scope_mode: ShiftScopeMode; user_id: number; user_name: string | null
  branch_id: number | null; branch_name: string | null; business_date: string; opened_at: string
  opening_float_usd: number; opening_float_khr: number; opening_note: string | null; closed_at: string | null
  closing_counted_usd: number | null; closing_counted_khr: number | null; closing_note: string | null
  closed_by_user_id: number | null; closed_by_user_name: string | null; revision: number
  parent_shift_id: number | null; reopen_reason: string | null
  reopened_by_user_id: number | null; reopened_by_user_name: string | null
  cancelled_at: string | null; cancelled_by_user_id: number | null
  cancelled_by_user_name: string | null; cancel_reason: string | null
}
type ShiftDbRow = ShiftRow & { has_reopened_child: number }
export type ShiftCapabilities = { can_edit: boolean; can_close: boolean; can_reopen: boolean; can_cancel: boolean }
export type ShiftResponseRow = ShiftRow & { capabilities: ShiftCapabilities }

const SHIFT_COLUMNS = `id, shift_code, scope_mode, user_id, user_name, branch_id, branch_name, business_date,
  opened_at, opening_float_usd, opening_float_khr, opening_note,
  closed_at, closing_counted_usd, closing_counted_khr, closing_note,
  closed_by_user_id, closed_by_user_name, revision,
  parent_shift_id, reopen_reason, reopened_by_user_id, reopened_by_user_name,
  cancelled_at, cancelled_by_user_id, cancelled_by_user_name, cancel_reason,
  EXISTS (SELECT 1 FROM shift_sessions child WHERE child.parent_shift_id=shift_sessions.id) AS has_reopened_child`

function parseBranchId(value: unknown): number | null {
  if (value == null || String(value).trim() === '') return null
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}
function branchIdFrom(c: { req: { query: (k: string) => string | undefined; header: (k: string) => string | undefined } }): number | null {
  return parseBranchId(c.req.query('branch_id') ?? c.req.header('X-Branch-Id'))
}
function bodyBranchId(body: Record<string, unknown>, fallback: number | null): number | null {
  return body.branch_id == null || String(body.branch_id).trim() === '' ? fallback : parseBranchId(body.branch_id)
}
function requiredMoney(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}
function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
function requiredReason(value: unknown): string | null {
  const reason = optionalText(value)
  return reason && reason.length <= 500 ? reason : null
}
function displayName(user: SessionUser): string | null { return user.name || user.username || null }
function canUseShifts(user: SessionUser): boolean { return hasAnyPermission(user, ['pos', 'sales']) }
function shiftPermissionError(c: { json: (body: object, status: 403) => Response }, user: SessionUser): Response | null {
  return canUseShifts(user) ? null : c.json({ error: 'You do not have permission to use shifts.' }, 403)
}
async function resolveBranch(db: D1Compat, branchId: number | null): Promise<{ id: number; name: string } | null> {
  if (branchId == null) return null
  return (await db.prepare('SELECT id, name FROM branches WHERE id=@id AND is_active=1').get<{ id: number; name: string }>({ id: branchId })) ?? null
}
function businessDateFor(iso: string): string {
  return new Date(new Date(iso).getTime() + BUSINESS_UTC_OFFSET_MINUTES * 60 * 1000).toISOString().slice(0, 10)
}
function shiftCode(nowIso: string): string {
  const local = new Date(new Date(nowIso).getTime() + 7 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `S-${local.getUTCFullYear()}${p(local.getUTCMonth() + 1)}${p(local.getUTCDate())}-${p(local.getUTCHours())}${p(local.getUTCMinutes())}-${crypto.randomUUID().slice(0, 6)}`
}

export function canManageShifts(user: SessionUser): boolean {
  return isAdminControlUser(user)
}
function storedShift(shift: ShiftDbRow): ShiftRow {
  const { has_reopened_child: _hasReopenedChild, ...stored } = shift
  return stored
}
function canMutateShift(user: SessionUser, shift: ShiftRow): boolean {
  return canManageShifts(user) || shift.user_id === user.id
}
function responseShift(user: SessionUser, row: ShiftDbRow): ShiftResponseRow {
  const shift = storedShift(row)
  const cancelled = !!shift.cancelled_at; const canMutate = canMutateShift(user, shift) && !cancelled
  return { ...shift, capabilities: {
    can_edit: canMutate,
    can_close: canMutate && !shift.closed_at,
    can_reopen: canMutate && !!shift.closed_at && !row.has_reopened_child
      && shift.business_date === businessDateFor(new Date().toISOString()),
    can_cancel: canManageShifts(user) && !cancelled && !row.has_reopened_child,
  } }
}
function batchChanges(value: unknown): number {
  return Number((value as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0)
}
function transitionAuditSql(): string {
  return `INSERT INTO audit_logs (user_id,user_name,action,entity,entity_id,details,table_name,record_id,old_value,new_value,device_name)
    SELECT @actorId,@actorName,@action,'shift_session',CAST(@shiftId AS TEXT),@details,'shift_session',CAST(@shiftId AS TEXT),@oldValue,@newValue,@deviceName
    WHERE changes()=1`
}
function openAuditSql(): string {
  return `INSERT INTO audit_logs (user_id,user_name,action,entity,entity_id,details,table_name,record_id,old_value,new_value,device_name)
    SELECT @actorId,@actorName,'shift.open','shift_session',CAST(id AS TEXT),@details,'shift_session',CAST(id AS TEXT),NULL,@newValue,@deviceName
    FROM shift_sessions WHERE changes()=1 AND shift_code=@shiftCode`
}
function continuationAuditSql(): string {
  return `INSERT INTO audit_logs (user_id,user_name,action,entity,entity_id,details,table_name,record_id,old_value,new_value,device_name)
    SELECT @actorId,@actorName,@action,'shift_session',CAST(id AS TEXT),@details,'shift_session',CAST(id AS TEXT),@oldValue,@newValue,@deviceName
    FROM shift_sessions WHERE changes()=1 AND shift_code=@shiftCode`
}
export async function readShiftPolicy(db: D1Compat): Promise<ShiftPolicy> {
  const rows = await db.prepare("SELECT key, value FROM settings WHERE key IN ('shift_scope_mode', 'shift_admin_exempt')").all<{ key: string; value: string }>()
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]))
  return {
    scope_mode: values.shift_scope_mode === 'shop_wide' ? 'shop_wide' : 'per_account',
    admin_exempt: values.shift_admin_exempt == null ? true : values.shift_admin_exempt !== 'false',
  }
}
async function readCurrent(db: D1Compat, policy: ShiftPolicy, userId: number, branchId: number | null) {
  const accountClause = policy.scope_mode === 'per_account' ? 'AND user_id = @userId' : ''
  return db.prepare(`SELECT ${SHIFT_COLUMNS} FROM shift_sessions
    WHERE scope_mode = @scopeMode ${accountClause}
      AND business_date = ${localTodayExpr()}
      AND ((@branchId IS NULL AND branch_id IS NULL) OR branch_id = @branchId)
    ORDER BY opened_at DESC, id DESC LIMIT 1`).get<ShiftDbRow>({ scopeMode: policy.scope_mode, userId, branchId })
}
async function readShiftById(db: D1Compat, id: number) {
  return db.prepare(`SELECT ${SHIFT_COLUMNS} FROM shift_sessions WHERE id = @id`).get<ShiftDbRow>({ id })
}
async function readChild(db: D1Compat, id: number) {
  return db.prepare(`SELECT ${SHIFT_COLUMNS} FROM shift_sessions WHERE parent_shift_id = @id LIMIT 1`).get<ShiftDbRow>({ id })
}
async function readShiftByCode(db: D1Compat, shiftCodeValue: string) {
  return db.prepare(`SELECT ${SHIFT_COLUMNS} FROM shift_sessions WHERE shift_code = @shiftCode LIMIT 1`).get<ShiftDbRow>({ shiftCode: shiftCodeValue })
}
async function readAdjacentShift(db: D1Compat, shift: ShiftRow, openedAt: string, direction: 'previous' | 'next') {
  const comparison = direction === 'previous' ? '<' : '>='
  const ordering = direction === 'previous' ? 'DESC' : 'ASC'
  return db.prepare(`SELECT ${SHIFT_COLUMNS} FROM shift_sessions
    WHERE id != @id AND scope_mode=@scopeMode
      AND ((@branchId IS NULL AND branch_id IS NULL) OR branch_id=@branchId)
      AND (@scopeMode='shop_wide' OR user_id=@userId)
      AND cancelled_at IS NULL
      AND opened_at ${comparison} @openedAt
    ORDER BY opened_at ${ordering}, id ${ordering} LIMIT 1`).get<ShiftDbRow>({
      id: shift.id, scopeMode: shift.scope_mode, branchId: shift.branch_id, userId: shift.user_id, openedAt,
    })
}
async function intervalError(db: D1Compat, shift: ShiftRow, openedAt: string, closedAt: string | null): Promise<string | null> {
  const [previous, next] = await Promise.all([
    readAdjacentShift(db, shift, openedAt, 'previous'),
    readAdjacentShift(db, shift, openedAt, 'next'),
  ])
  if (previous && (!previous.closed_at || new Date(previous.closed_at).getTime() > new Date(openedAt).getTime())) {
    return 'Opening time overlaps the previous shift segment.'
  }
  if (next && (!closedAt || new Date(closedAt).getTime() > new Date(next.opened_at).getTime())) {
    return 'Closing time overlaps the next shift segment.'
  }
  return null
}
async function writeContinuation(db: D1Compat, user: SessionUser, parent: ShiftDbRow, input: {
  reason: string; floatUsd: number; floatKhr: number; note: string | null; deviceName: string | null
  afterCancellation: boolean; auditAction: 'shift.reopen' | 'shift.open_after_cancel'
}): Promise<{ changed: boolean; shift?: ShiftDbRow; conflict: boolean }> {
  const nowIso = new Date().toISOString(); const actorName = displayName(user); const childCode = shiftCode(nowIso)
  const child = { shiftCode: childCode, parentId: parent.id, expectedRevision: parent.revision, reason: input.reason,
    actorId: user.id, actorName, openedAt: nowIso, floatUsd: input.floatUsd, floatKhr: input.floatKhr,
    note: input.note, deviceName: input.deviceName, afterCancellation: input.afterCancellation ? 1 : 0 }
  const parentStored = storedShift(parent)
  const childSnapshot = { shift_code: child.shiftCode, scope_mode: parent.scope_mode, user_id: parent.user_id,
    user_name: parent.user_name, branch_id: parent.branch_id, branch_name: parent.branch_name,
    business_date: parent.business_date, opened_at: child.openedAt, opening_float_usd: child.floatUsd,
    opening_float_khr: child.floatKhr, opening_note: child.note, parent_shift_id: parent.id,
    reopen_reason: child.reason, reopened_by_user_id: child.actorId, reopened_by_user_name: child.actorName,
    closed_at: null, cancelled_at: null, revision: 0 }
  let results: unknown[]
  try {
    results = await db.batch([
      { sql: `INSERT INTO shift_sessions (shift_code,scope_mode,user_id,user_name,branch_id,branch_name,business_date,
          opened_at,opening_float_usd,opening_float_khr,opening_note,opened_device_name,parent_shift_id,reopen_reason,
          reopened_by_user_id,reopened_by_user_name)
        SELECT @shiftCode,scope_mode,user_id,user_name,branch_id,branch_name,business_date,
          @openedAt,@floatUsd,@floatKhr,@note,@deviceName,id,@reason,@actorId,@actorName
        FROM shift_sessions parent WHERE id=@parentId AND revision=@expectedRevision
          AND ((@afterCancellation=1 AND cancelled_at IS NOT NULL)
            OR (@afterCancellation=0 AND cancelled_at IS NULL AND closed_at IS NOT NULL))
          AND business_date=date(@openedAt,'${BUSINESS_TZ_FORWARD}')
          AND NOT EXISTS (SELECT 1 FROM shift_sessions child WHERE child.parent_shift_id=parent.id)`, params: child },
      { sql: `INSERT INTO shift_session_amendments (shift_session_id,actor_user_id,actor_name,reason,before_json,after_json,created_at)
        SELECT id,@actorId,@actorName,@reason,@beforeJson,@afterJson,@createdAt FROM shift_sessions
        WHERE changes()=1 AND shift_code=@shiftCode`,
        params: { shiftCode: child.shiftCode, actorId: user.id, actorName, reason: input.reason,
          beforeJson: JSON.stringify(parentStored), afterJson: JSON.stringify(childSnapshot), createdAt: nowIso } },
      { sql: continuationAuditSql(), params: { action: input.auditAction, shiftCode: child.shiftCode,
        actorId: user.id, actorName, details: JSON.stringify({ reason: input.reason, parent_shift_id: parent.id }),
        oldValue: JSON.stringify(parentStored), newValue: JSON.stringify(childSnapshot), deviceName: input.deviceName } },
    ])
  } catch (error) {
    if (await readChild(db, parent.id)) return { changed: false, conflict: true }
    throw error
  }
  if (batchChanges(results[0]) !== 1) return { changed: false, conflict: true }
  return { changed: true, conflict: false, shift: await readShiftByCode(db, child.shiftCode) }
}
function currentResponse(user: SessionUser, shift: ShiftDbRow | undefined, policy: ShiftPolicy, exempt: boolean) {
  const presented = shift ? responseShift(user, shift) : null
  return { shift: presented, policy, exempt, needs_registration: !exempt && (!shift || !!shift.cancelled_at),
    is_open: !!shift && !shift.closed_at && !shift.cancelled_at, can_end: !!presented?.capabilities.can_close }
}

app.get('/policy', async (c) => c.json(await readShiftPolicy(getDb(c.env))))

app.get('/current', async (c) => {
  const user = c.get('user'); const denied = shiftPermissionError(c, user); if (denied) return denied
  const db = getDb(c.env); const requestedBranchId = branchIdFrom(c)
  const rawBranchId = c.req.query('branch_id') ?? c.req.header('X-Branch-Id')
  if (rawBranchId != null && String(rawBranchId).trim() !== '' && requestedBranchId == null) return c.json({ error: 'Invalid branch id.' }, 400)
  if (requestedBranchId != null && !(await resolveBranch(db, requestedBranchId))) return c.json({ error: 'Branch not found or inactive.' }, 400)
  const policy = await readShiftPolicy(db)
  const exempt = policy.admin_exempt && isAdminControlUser(user)
  const shift = exempt ? undefined : await readCurrent(db, policy, user.id, requestedBranchId)
  return c.json(currentResponse(user, shift, policy, exempt))
})

app.get('/', async (c) => {
  const user = c.get('user'); const denied = shiftPermissionError(c, user); if (denied) return denied
  const db = getDb(c.env); const branchId = branchIdFrom(c)
  const rawBranchId = c.req.query('branch_id') ?? c.req.header('X-Branch-Id')
  if (rawBranchId != null && String(rawBranchId).trim() !== '' && branchId == null) return c.json({ error: 'Invalid branch id.' }, 400)
  if (branchId != null && !(await resolveBranch(db, branchId))) return c.json({ error: 'Branch not found or inactive.' }, 400)
  const rawUserId = c.req.query('user_id')
  const parsedUserId = rawUserId == null || rawUserId.trim() === '' ? null : Number(rawUserId)
  if (parsedUserId != null && (!Number.isInteger(parsedUserId) || parsedUserId <= 0)) return c.json({ error: 'Invalid user id.' }, 400)
  const requestedUserId = parsedUserId
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50))
  const filters = `(@requestedUserId IS NULL OR user_id = @requestedUserId)
      AND (@branchId IS NULL OR branch_id = @branchId)
      AND (branch_id IS NULL OR EXISTS (SELECT 1 FROM branches b WHERE b.id=shift_sessions.branch_id AND b.is_active=1))
      AND (@from IS NULL OR business_date >= @from) AND (@to IS NULL OR business_date <= @to)`
  const params = { requestedUserId, branchId, from: c.req.query('from') || null, to: c.req.query('to') || null, limit }
  const [openShifts, closedShifts] = await Promise.all([
    db.prepare(`SELECT ${SHIFT_COLUMNS} FROM shift_sessions WHERE ${filters} AND closed_at IS NULL AND cancelled_at IS NULL
      ORDER BY business_date DESC, opened_at DESC, id DESC`).all<ShiftDbRow>(params),
    db.prepare(`SELECT ${SHIFT_COLUMNS} FROM shift_sessions WHERE ${filters} AND (closed_at IS NOT NULL OR cancelled_at IS NOT NULL)
      ORDER BY business_date DESC, opened_at DESC, id DESC LIMIT @limit`).all<ShiftDbRow>(params),
  ])
  return c.json({ shifts: [...openShifts, ...closedShifts].map((shift) => responseShift(user, shift)), scope: 'all' })
})

app.get('/:id/history', async (c) => {
  const user = c.get('user'); const denied = shiftPermissionError(c, user); if (denied) return denied
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid shift id.' }, 400)
  const db = getDb(c.env); const shift = await readShiftById(db, id)
  if (!shift) return c.json({ error: 'Shift not found.' }, 404)
  if (shift.branch_id != null && !(await resolveBranch(db, shift.branch_id))) return c.json({ error: 'Shift not found.' }, 404)
  const amendments = await db.prepare(`SELECT id, shift_session_id, actor_user_id, actor_name, reason,
    before_json, after_json, created_at FROM shift_session_amendments
    WHERE shift_session_id = @id ORDER BY created_at ASC, id ASC`).all({ id })
  return c.json({ shift: responseShift(user, shift), amendments })
})

app.post('/open', async (c) => {
  const user = c.get('user'); const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const denied = shiftPermissionError(c, user); if (denied) return denied
  const branchId = bodyBranchId(body, branchIdFrom(c))
  if (body.branch_id != null && String(body.branch_id).trim() !== '' && branchId == null) return c.json({ error: 'Invalid branch id.' }, 400)
  const db = getDb(c.env); const branch = await resolveBranch(db, branchId)
  if (branchId != null && !branch) return c.json({ error: 'Branch not found or inactive.' }, 400)
  const policy = await readShiftPolicy(db)
  if (policy.admin_exempt && isAdminControlUser(user)) return c.json({ error: 'This account is exempt from shifts.', exempt: true }, 403)
  const floatUsd = requiredMoney(body.opening_float_usd); const floatKhr = requiredMoney(body.opening_float_khr)
  if (floatUsd == null || floatKhr == null) return c.json({ error: 'Valid USD and KHR opening counts are required.' }, 400)
  const existing = await readCurrent(db, policy, user.id, branchId)
  if (existing && !existing.cancelled_at) return c.json({ ...currentResponse(user, existing, policy, false), already_registered: true }, 200)
  if (existing?.cancelled_at) {
    const inheritedReason = `Replacement after cancellation: ${existing.cancel_reason || 'Cancelled by administrator'}`.slice(0, 500)
    const replacement = await writeContinuation(db, user, existing, { reason: inheritedReason, floatUsd, floatKhr,
      note: optionalText(body.opening_note), deviceName: c.req.header('X-Device-Name') || null,
      afterCancellation: true, auditAction: 'shift.open_after_cancel' })
    if (!replacement.changed || !replacement.shift) {
      const raced = await readCurrent(db, policy, user.id, branchId)
      if (raced && !raced.cancelled_at) return c.json({ ...currentResponse(user, raced, policy, false), already_registered: true }, 200)
      return c.json({ error: 'Cancelled shift replacement changed concurrently. Reload and try again.' }, 409)
    }
    const report = sendTelegramShiftReport(c.env, replacement.shift.id)
    try { c.executionCtx.waitUntil(report) } catch { void report }
    return c.json({ ...currentResponse(user, replacement.shift, policy, false),
      already_registered: false, replaced_cancelled_shift_id: existing.id }, 201)
  }
  const nowIso = new Date().toISOString()
  const row = { shiftCode: shiftCode(nowIso), scopeMode: policy.scope_mode, userId: user.id,
    userName: displayName(user), branchId, branchName: branch?.name ?? null, openedAt: nowIso,
    floatUsd, floatKhr,
    note: optionalText(body.opening_note), deviceName: c.req.header('X-Device-Name') || null }
  try {
    const results = await db.batch([
      { sql: `INSERT INTO shift_sessions (shift_code, scope_mode, user_id, user_name, branch_id,
      branch_name, business_date, opened_at, opening_float_usd, opening_float_khr, opening_note, opened_device_name)
      VALUES (@shiftCode,@scopeMode,@userId,@userName,@branchId,@branchName,date(@openedAt,'${BUSINESS_TZ_FORWARD}'),
      @openedAt,@floatUsd,@floatKhr,@note,@deviceName)`, params: row },
      { sql: openAuditSql(), params: { actorId: user.id, actorName: row.userName, shiftCode: row.shiftCode,
        details: JSON.stringify({ shift_code: row.shiftCode, scope_mode: row.scopeMode, branch_id: row.branchId,
          opening_float_usd: row.floatUsd, opening_float_khr: row.floatKhr }), oldValue: null,
        newValue: JSON.stringify({ shift_code: row.shiftCode, opened_at: row.openedAt,
          opening_float_usd: row.floatUsd, opening_float_khr: row.floatKhr }), deviceName: row.deviceName } },
    ])
    if (batchChanges(results[0]) !== 1) throw new Error('Shift open did not write a row.')
  } catch (error) {
    const raced = await readCurrent(db, policy, user.id, branchId)
    if (raced) return c.json({ ...currentResponse(user, raced, policy, false), already_registered: true }, 200)
    throw error
  }
  const shift = await readCurrent(db, policy, user.id, branchId)
  if (!shift) return c.json({ error: 'Shift registration could not be read back.' }, 500)
  const report = sendTelegramShiftReport(c.env, shift.id)
  try { c.executionCtx.waitUntil(report) } catch { void report }
  return c.json({ ...currentResponse(user, shift, policy, false), already_registered: false }, 201)
})

async function writeClose(db: D1Compat, user: SessionUser, row: ShiftDbRow, input: {
  closedAt: string; recordedAt: string; countedUsd: number; countedKhr: number
  note: string | null; deviceName: string | null; reason: string
}): Promise<{ changed: boolean; shift: ShiftDbRow | undefined }> {
  const shift = storedShift(row)
  const after = { ...shift, closed_at: input.closedAt, closing_counted_usd: input.countedUsd,
    closing_counted_khr: input.countedKhr, closing_note: input.note, closed_by_user_id: user.id,
    closed_by_user_name: displayName(user), revision: shift.revision + 1 }
  const actorName = displayName(user)
  const results = await db.batch([
    { sql: `UPDATE shift_sessions SET closed_at=@closedAt, closing_counted_usd=@countedUsd,
        closing_counted_khr=@countedKhr, closing_note=@note, closed_device_name=@deviceName,
        closed_by_user_id=@closerId, closed_by_user_name=@closerName, revision=revision+1, updated_at=@recordedAt
        WHERE id=@id AND revision=@revision AND closed_at IS NULL`,
      params: { id: shift.id, revision: shift.revision, closedAt: input.closedAt, countedUsd: input.countedUsd,
        countedKhr: input.countedKhr, note: input.note, deviceName: input.deviceName,
        closerId: user.id, closerName: actorName, recordedAt: input.recordedAt } },
    { sql: `INSERT INTO shift_session_amendments (shift_session_id,actor_user_id,actor_name,reason,before_json,after_json,created_at)
        SELECT @id,@actorId,@actorName,@reason,@beforeJson,@afterJson,@createdAt FROM shift_sessions
        WHERE changes()=1 AND id=@id AND revision=@newRevision`,
      params: { id: shift.id, actorId: user.id, actorName, reason: input.reason, beforeJson: JSON.stringify(shift),
        afterJson: JSON.stringify(after), createdAt: input.recordedAt, newRevision: after.revision } },
    { sql: transitionAuditSql(), params: { actorId: user.id, actorName, action: 'shift.close', shiftId: shift.id,
        details: JSON.stringify({ reason: input.reason, revision: after.revision }), oldValue: JSON.stringify(shift),
        newValue: JSON.stringify(after), deviceName: input.deviceName } },
  ])
  const changed = batchChanges(results[0]) === 1
  return { changed, shift: await readShiftById(db, shift.id) }
}

app.post('/close', async (c) => {
  const user = c.get('user'); const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const denied = shiftPermissionError(c, user); if (denied) return denied
  const branchId = bodyBranchId(body, branchIdFrom(c))
  if (body.branch_id != null && String(body.branch_id).trim() !== '' && branchId == null) return c.json({ error: 'Invalid branch id.' }, 400)
  const db = getDb(c.env)
  if (branchId != null && !(await resolveBranch(db, branchId))) return c.json({ error: 'Branch not found or inactive.' }, 400)
  const policy = await readShiftPolicy(db)
  const shift = await readCurrent(db, policy, user.id, branchId)
  if (!shift) return c.json({ error: 'No shift is registered for today. Register the opening float first.' }, 404)
  if (shift.cancelled_at) return c.json({ error: 'This shift was cancelled. Register a replacement opening first.' }, 409)
  if (!canMutateShift(user, shift)) return c.json({ error: 'Only the shift owner or an administrator can close this shift.' }, 403)
  if (shift.closed_at) return c.json({ shift: responseShift(user, shift), already_closed: true, is_open: false }, 200)
  const countedUsd = requiredMoney(body.closing_counted_usd); const countedKhr = requiredMoney(body.closing_counted_khr)
  if (countedUsd == null || countedKhr == null) return c.json({ error: 'Valid USD and KHR closing counts are required.' }, 400)
  const closedAt = new Date().toISOString()
  const overlap = await intervalError(db, storedShift(shift), shift.opened_at, closedAt)
  if (overlap) return c.json({ error: overlap }, 409)
  const result = await writeClose(db, user, shift, { closedAt, recordedAt: closedAt,
    countedUsd, countedKhr,
    note: optionalText(body.closing_note), deviceName: c.req.header('X-Device-Name') || null, reason: 'Manual shift close' })
  if (result.changed) {
    const report = sendTelegramShiftReport(c.env, shift.id)
    try { c.executionCtx.waitUntil(report) } catch { void report }
  }
  return c.json({ shift: result.shift ? responseShift(user, result.shift) : null, already_closed: !result.changed, is_open: false }, 200)
})

app.post('/:id/close', async (c) => {
  const user = c.get('user'); const denied = shiftPermissionError(c, user); if (denied) return denied
  const id = Number(c.req.param('id')); if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid shift id.' }, 400)
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const expectedRevision = Number(body.expected_revision)
  if (body.expected_revision == null || !Number.isInteger(expectedRevision) || expectedRevision < 0) return c.json({ error: 'A valid expected revision is required.' }, 400)
  const parsedClosedAt = typeof body.closed_at === 'string' ? new Date(body.closed_at) : new Date(Number.NaN)
  if (Number.isNaN(parsedClosedAt.getTime())) return c.json({ error: 'A valid closing time is required.' }, 400)
  const closedAt = parsedClosedAt.toISOString(); const now = Date.now()
  if (parsedClosedAt.getTime() > now) return c.json({ error: 'Closing time cannot be in the future.' }, 400)
  const countedUsd = requiredMoney(body.closing_counted_usd); const countedKhr = requiredMoney(body.closing_counted_khr)
  if (countedUsd == null || countedKhr == null) return c.json({ error: 'Valid USD and KHR closing counts are required.' }, 400)
  const db = getDb(c.env); const shift = await readShiftById(db, id)
  if (!shift) return c.json({ error: 'Shift not found.' }, 404)
  if (shift.branch_id != null && !(await resolveBranch(db, shift.branch_id))) return c.json({ error: 'Shift not found.' }, 404)
  if (!canMutateShift(user, shift)) return c.json({ error: 'Only the shift owner or an administrator can close this shift.' }, 403)
  if (shift.cancelled_at) return c.json({ error: 'A cancelled shift cannot be closed.' }, 409)
  if (shift.closed_at) return c.json({ error: 'Shift is already closed.' }, 409)
  if (expectedRevision !== shift.revision) return c.json({ error: 'Shift changed concurrently. Reload and try again.' }, 409)
  if (parsedClosedAt.getTime() < new Date(shift.opened_at).getTime()) return c.json({ error: 'Closing time cannot be before opening time.' }, 400)
  const overlap = await intervalError(db, storedShift(shift), shift.opened_at, closedAt)
  if (overlap) return c.json({ error: overlap }, 409)
  const result = await writeClose(db, user, shift, { closedAt, recordedAt: new Date().toISOString(), countedUsd, countedKhr,
    note: optionalText(body.closing_note), deviceName: c.req.header('X-Device-Name') || null, reason: 'Historic manual close' })
  if (!result.changed || !result.shift) return c.json({ error: 'Shift changed concurrently. Reload and try again.' }, 409)
  const report = sendTelegramShiftReport(c.env, shift.id)
  try { c.executionCtx.waitUntil(report) } catch { void report }
  return c.json({ shift: responseShift(user, result.shift), already_closed: false, is_open: false }, 200)
})

app.post('/:id/cancel', async (c) => {
  const user = c.get('user'); const denied = shiftPermissionError(c, user); if (denied) return denied
  if (!canManageShifts(user)) return c.json({ error: 'Administrator permission is required to cancel a shift.' }, 403)
  const id = Number(c.req.param('id')); if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid shift id.' }, 400)
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const expectedRevision = Number(body.expected_revision); const reason = requiredReason(body.reason)
  if (body.expected_revision == null || !Number.isInteger(expectedRevision) || expectedRevision < 0) return c.json({ error: 'A valid expected revision is required.' }, 400)
  if (!reason) return c.json({ error: 'A cancellation reason of 500 characters or fewer is required.' }, 400)
  const db = getDb(c.env); const before = await readShiftById(db, id)
  if (!before) return c.json({ error: 'Shift not found.' }, 404)
  if (before.branch_id != null && !(await resolveBranch(db, before.branch_id))) return c.json({ error: 'Shift not found.' }, 404)
  if (before.cancelled_at) return c.json({ error: 'Shift is already cancelled.' }, 409)
  if (before.has_reopened_child) return c.json({ error: 'Only the latest shift segment can be cancelled.' }, 409)
  if (before.revision !== expectedRevision) return c.json({ error: 'Shift changed concurrently. Reload and try again.' }, 409)
  const nowIso = new Date().toISOString(); const actorName = displayName(user); const beforeStored = storedShift(before)
  const after = { ...beforeStored, cancelled_at: nowIso, cancelled_by_user_id: user.id,
    cancelled_by_user_name: actorName, cancel_reason: reason, revision: before.revision + 1 }
  const results = await db.batch([
    { sql: `UPDATE shift_sessions SET cancelled_at=@cancelledAt,cancelled_by_user_id=@actorId,
        cancelled_by_user_name=@actorName,cancel_reason=@reason,revision=revision+1,updated_at=@cancelledAt
      WHERE id=@id AND revision=@revision AND cancelled_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM shift_sessions child WHERE child.parent_shift_id=shift_sessions.id)`,
      params: { id, revision: before.revision, cancelledAt: nowIso, actorId: user.id, actorName, reason } },
    { sql: `INSERT INTO shift_session_amendments (shift_session_id,actor_user_id,actor_name,reason,before_json,after_json,created_at)
      SELECT @id,@actorId,@actorName,@reason,@beforeJson,@afterJson,@createdAt FROM shift_sessions
      WHERE changes()=1 AND id=@id AND revision=@newRevision`,
      params: { id, actorId: user.id, actorName, reason, beforeJson: JSON.stringify(beforeStored),
        afterJson: JSON.stringify(after), createdAt: nowIso, newRevision: after.revision } },
    { sql: transitionAuditSql(), params: { actorId: user.id, actorName, action: 'shift.cancel', shiftId: id,
      details: JSON.stringify({ reason, revision: after.revision }), oldValue: JSON.stringify(beforeStored),
      newValue: JSON.stringify(after), deviceName: c.req.header('X-Device-Name') || null } },
  ])
  if (batchChanges(results[0]) !== 1) return c.json({ error: 'Shift changed concurrently. Reload and try again.' }, 409)
  const cancelled = await readShiftById(db, id)
  if (!cancelled) return c.json({ error: 'Cancelled shift could not be read back.' }, 500)
  return c.json({ shift: responseShift(user, cancelled), cancelled: true }, 200)
})

app.post('/:id/reopen', async (c) => {
  const user = c.get('user'); const denied = shiftPermissionError(c, user); if (denied) return denied
  const id = Number(c.req.param('id')); if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid shift id.' }, 400)
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const expectedRevision = Number(body.expected_revision); const reason = requiredReason(body.reason)
  if (body.expected_revision == null || !Number.isInteger(expectedRevision) || expectedRevision < 0) return c.json({ error: 'A valid expected revision is required.' }, 400)
  if (!reason) return c.json({ error: 'A reopen reason is required.' }, 400)
  if (!Object.prototype.hasOwnProperty.call(body, 'opening_float_usd') || !Object.prototype.hasOwnProperty.call(body, 'opening_float_khr')) {
    return c.json({ error: 'Opening USD and KHR counts are required.' }, 400)
  }
  const floatUsd = requiredMoney(body.opening_float_usd); const floatKhr = requiredMoney(body.opening_float_khr)
  if (floatUsd == null || floatKhr == null) return c.json({ error: 'Valid USD and KHR opening counts are required.' }, 400)
  const db = getDb(c.env); const parent = await readShiftById(db, id)
  if (!parent) return c.json({ error: 'Shift not found.' }, 404)
  if (parent.branch_id != null && !(await resolveBranch(db, parent.branch_id))) return c.json({ error: 'Shift not found.' }, 404)
  if (!canMutateShift(user, parent)) return c.json({ error: 'Only the shift owner or an administrator can reopen this shift.' }, 403)
  if (parent.cancelled_at) return c.json({ error: 'A cancelled shift cannot be reopened.' }, 409)
  if (!parent.closed_at) return c.json({ error: 'Only a closed shift can be reopened.' }, 409)
  if (parent.revision !== expectedRevision) return c.json({ error: 'Shift changed concurrently. Reload and try again.' }, 409)
  if (parent.business_date !== businessDateFor(new Date().toISOString())) return c.json({ error: 'Only a shift closed today can be reopened.' }, 409)
  if (parent.has_reopened_child) return c.json({ error: 'This shift segment was already reopened.' }, 409)
  const nowIso = new Date().toISOString(); const overlap = await intervalError(db, storedShift(parent), nowIso, null)
  if (overlap) return c.json({ error: overlap }, 409)
  const continuation = await writeContinuation(db, user, parent, { reason, floatUsd, floatKhr,
    note: optionalText(body.opening_note), deviceName: c.req.header('X-Device-Name') || null,
    afterCancellation: false, auditAction: 'shift.reopen' })
  if (!continuation.changed || !continuation.shift) return c.json({ error: 'This shift segment was already reopened or changed concurrently.' }, 409)
  const reopened = continuation.shift
  const report = sendTelegramShiftReport(c.env, reopened.id)
  try { c.executionCtx.waitUntil(report) } catch { void report }
  return c.json({ shift: responseShift(user, reopened), reopened_from_shift_id: parent.id }, 201)
})

app.patch('/:id', async (c) => {
  const user = c.get('user'); const denied = shiftPermissionError(c, user); if (denied) return denied
  const id = Number(c.req.param('id')); if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid shift id.' }, 400)
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>; const reason = requiredReason(body.reason)
  if (!reason) return c.json({ error: 'A reason is required.' }, 400)
  const db = getDb(c.env); const before = await readShiftById(db, id)
  if (!before) return c.json({ error: 'Shift not found.' }, 404)
  if (before.branch_id != null && !(await resolveBranch(db, before.branch_id))) return c.json({ error: 'Shift not found.' }, 404)
  if (before.cancelled_at) return c.json({ error: 'A cancelled shift cannot be amended.' }, 409)
  if (!canMutateShift(user, before)) return c.json({ error: 'Only the shift owner or an administrator can amend this shift.' }, 403)
  const iso = (key: string, fallback: string | null) => {
    if (!(key in body)) return fallback
    if (body[key] == null || body[key] === '') return null
    const parsed = new Date(String(body[key])); return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
  }
  const openedAt = iso('opened_at', before.opened_at); const closedAt = iso('closed_at', before.closed_at)
  if (!openedAt || closedAt === undefined) return c.json({ error: 'Invalid shift timestamp.' }, 400)
  if (businessDateFor(openedAt) !== before.business_date) return c.json({ error: 'Opening time must remain within the shift business date.' }, 400)
  if (before.closed_at && !closedAt) return c.json({ error: 'Closed shifts cannot be reopened.' }, 400)
  if (!before.closed_at && closedAt) return c.json({ error: 'Open shifts must be closed through the close action.' }, 400)
  if (closedAt && new Date(closedAt).getTime() < new Date(openedAt).getTime()) return c.json({ error: 'Closing time cannot be before opening time.' }, 400)
  const openingUsd = 'opening_float_usd' in body ? requiredMoney(body.opening_float_usd) : before.opening_float_usd
  const openingKhr = 'opening_float_khr' in body ? requiredMoney(body.opening_float_khr) : before.opening_float_khr
  const closingUsd = closedAt && 'closing_counted_usd' in body ? requiredMoney(body.closing_counted_usd) : before.closing_counted_usd
  const closingKhr = closedAt && 'closing_counted_khr' in body ? requiredMoney(body.closing_counted_khr) : before.closing_counted_khr
  if (openingUsd == null || openingKhr == null || (closedAt && (closingUsd == null || closingKhr == null))) {
    return c.json({ error: 'Shift cash counts must be finite, non-negative numbers.' }, 400)
  }
  const beforeStored = storedShift(before)
  const after = { ...beforeStored, opened_at: openedAt,
    opening_float_usd: openingUsd, opening_float_khr: openingKhr,
    opening_note: 'opening_note' in body ? optionalText(body.opening_note) : before.opening_note,
    closed_at: closedAt,
    closing_counted_usd: closedAt ? closingUsd : null,
    closing_counted_khr: closedAt ? closingKhr : null,
    closing_note: closedAt ? ('closing_note' in body ? optionalText(body.closing_note) : before.closing_note) : null,
    revision: before.revision + 1 }
  if (before.parent_shift_id != null) {
    const parent = await readShiftById(db, before.parent_shift_id)
    if (!parent?.closed_at || new Date(openedAt).getTime() < new Date(parent.closed_at).getTime()) {
      return c.json({ error: 'Opening time cannot be before the parent shift closed.' }, 400)
    }
  }
  if (before.has_reopened_child) {
    const child = await readChild(db, before.id)
    if (!closedAt || (child && new Date(closedAt).getTime() > new Date(child.opened_at).getTime())) {
      return c.json({ error: 'Closing time cannot be after the reopened segment began.' }, 400)
    }
  }
  if (openedAt !== before.opened_at || closedAt !== before.closed_at) {
    const overlap = await intervalError(db, beforeStored, openedAt, closedAt)
    if (overlap) return c.json({ error: overlap }, 400)
  }
  const comparableBefore = { ...beforeStored }; delete (comparableBefore as Partial<ShiftRow>).revision
  const comparableAfter = { ...after }; delete (comparableAfter as Partial<ShiftRow>).revision
  if (JSON.stringify(comparableBefore) === JSON.stringify(comparableAfter)) return c.json({ error: 'No shift fields changed.' }, 400)
  const nowIso = new Date().toISOString(); const actorName = displayName(user)
  const results = await db.batch([
    { sql: `UPDATE shift_sessions SET opened_at=@openedAt, opening_float_usd=@openingUsd, opening_float_khr=@openingKhr,
        opening_note=@openingNote, closed_at=@closedAt, closing_counted_usd=@closingUsd, closing_counted_khr=@closingKhr,
        closing_note=@closingNote, revision=revision+1, updated_at=@updatedAt WHERE id=@id AND revision=@revision`,
      params: { id, revision: before.revision, openedAt: after.opened_at, openingUsd: after.opening_float_usd,
        openingKhr: after.opening_float_khr, openingNote: after.opening_note, closedAt: after.closed_at,
        closingUsd: after.closing_counted_usd, closingKhr: after.closing_counted_khr, closingNote: after.closing_note, updatedAt: nowIso } },
    { sql: `INSERT INTO shift_session_amendments (shift_session_id, actor_user_id, actor_name, reason, before_json, after_json, created_at)
        SELECT @id,@actorId,@actorName,@reason,@beforeJson,@afterJson,@createdAt FROM shift_sessions
        WHERE changes()=1 AND id=@id AND revision=@newRevision`,
      params: { id, actorId: user.id, actorName, reason, beforeJson: JSON.stringify(beforeStored),
        afterJson: JSON.stringify(after), createdAt: nowIso, newRevision: after.revision } },
    { sql: transitionAuditSql(), params: { actorId: user.id, actorName, action: 'shift.amend', shiftId: id,
        details: JSON.stringify({ reason, revision: after.revision }), oldValue: JSON.stringify(beforeStored),
        newValue: JSON.stringify(after), deviceName: c.req.header('X-Device-Name') || null } },
  ])
  const changed = batchChanges(results[0])
  if (changed !== 1) return c.json({ error: 'Shift changed concurrently. Reload and try again.' }, 409)
  const saved = await readShiftById(db, id)
  if (!saved || saved.revision !== after.revision) return c.json({ error: 'Shift changed concurrently. Reload and try again.' }, 409)
  return c.json({ shift: responseShift(user, saved) }, 200)
})

export default app
