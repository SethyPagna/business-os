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
}
export type ShiftCapabilities = { can_edit: boolean; can_close: boolean; can_reopen: boolean }
export type ShiftResponseRow = ShiftRow & { capabilities: ShiftCapabilities }

const SHIFT_COLUMNS = `id, shift_code, scope_mode, user_id, user_name, branch_id, branch_name, business_date,
  opened_at, opening_float_usd, opening_float_khr, opening_note,
  closed_at, closing_counted_usd, closing_counted_khr, closing_note,
  closed_by_user_id, closed_by_user_name, revision`

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
function money(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0
}
function requiredMoney(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}
function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
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
function canMutateShift(user: SessionUser, shift: ShiftRow): boolean {
  return canManageShifts(user) || shift.user_id === user.id
}
function responseShift(user: SessionUser, shift: ShiftRow, canReopen = false): ShiftResponseRow {
  const canMutate = canMutateShift(user, shift)
  return { ...shift, capabilities: {
    can_edit: canMutate,
    can_close: canMutate && !shift.closed_at,
    can_reopen: canMutate && canReopen,
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
    LIMIT 1`).get<ShiftRow>({ scopeMode: policy.scope_mode, userId, branchId })
}
async function readShiftById(db: D1Compat, id: number) {
  return db.prepare(`SELECT ${SHIFT_COLUMNS} FROM shift_sessions WHERE id = @id`).get<ShiftRow>({ id })
}
function currentResponse(user: SessionUser, shift: ShiftRow | undefined, policy: ShiftPolicy, exempt: boolean) {
  const presented = shift ? responseShift(user, shift) : null
  return { shift: presented, policy, exempt, needs_registration: !exempt && !shift,
    is_open: !!shift && !shift.closed_at, can_end: !!presented?.capabilities.can_close }
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
    db.prepare(`SELECT ${SHIFT_COLUMNS} FROM shift_sessions WHERE ${filters} AND closed_at IS NULL
      ORDER BY business_date DESC, opened_at DESC, id DESC`).all<ShiftRow>(params),
    db.prepare(`SELECT ${SHIFT_COLUMNS} FROM shift_sessions WHERE ${filters} AND closed_at IS NOT NULL
      ORDER BY business_date DESC, opened_at DESC, id DESC LIMIT @limit`).all<ShiftRow>(params),
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
  const existing = await readCurrent(db, policy, user.id, branchId)
  if (existing) return c.json({ ...currentResponse(user, existing, policy, false), already_registered: true }, 200)
  const nowIso = new Date().toISOString()
  const row = { shiftCode: shiftCode(nowIso), scopeMode: policy.scope_mode, userId: user.id,
    userName: displayName(user), branchId, branchName: branch?.name ?? null, openedAt: nowIso,
    floatUsd: money(body.opening_float_usd), floatKhr: money(body.opening_float_khr),
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

async function writeClose(db: D1Compat, user: SessionUser, shift: ShiftRow, input: {
  closedAt: string; countedUsd: number; countedKhr: number; note: string | null; deviceName: string | null; reason: string
}): Promise<{ changed: boolean; shift: ShiftRow | undefined }> {
  const after = { ...shift, closed_at: input.closedAt, closing_counted_usd: input.countedUsd,
    closing_counted_khr: input.countedKhr, closing_note: input.note, closed_by_user_id: user.id,
    closed_by_user_name: displayName(user), revision: shift.revision + 1 }
  const actorName = displayName(user)
  const results = await db.batch([
    { sql: `UPDATE shift_sessions SET closed_at=@closedAt, closing_counted_usd=@countedUsd,
        closing_counted_khr=@countedKhr, closing_note=@note, closed_device_name=@deviceName,
        closed_by_user_id=@closerId, closed_by_user_name=@closerName, revision=revision+1, updated_at=@closedAt
        WHERE id=@id AND revision=@revision AND closed_at IS NULL`,
      params: { id: shift.id, revision: shift.revision, closedAt: input.closedAt, countedUsd: input.countedUsd,
        countedKhr: input.countedKhr, note: input.note, deviceName: input.deviceName,
        closerId: user.id, closerName: actorName } },
    { sql: `INSERT INTO shift_session_amendments (shift_session_id,actor_user_id,actor_name,reason,before_json,after_json,created_at)
        SELECT @id,@actorId,@actorName,@reason,@beforeJson,@afterJson,@createdAt FROM shift_sessions
        WHERE changes()=1 AND id=@id AND revision=@newRevision`,
      params: { id: shift.id, actorId: user.id, actorName, reason: input.reason, beforeJson: JSON.stringify(shift),
        afterJson: JSON.stringify(after), createdAt: input.closedAt, newRevision: after.revision } },
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
  if (!canMutateShift(user, shift)) return c.json({ error: 'Only the shift owner or an administrator can close this shift.' }, 403)
  if (shift.closed_at) return c.json({ shift: responseShift(user, shift), already_closed: true, is_open: false }, 200)
  const result = await writeClose(db, user, shift, { closedAt: new Date().toISOString(),
    countedUsd: money(body.closing_counted_usd), countedKhr: money(body.closing_counted_khr),
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
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) return c.json({ error: 'A valid expected revision is required.' }, 400)
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
  if (shift.closed_at) return c.json({ error: 'Shift is already closed.' }, 409)
  if (expectedRevision !== shift.revision) return c.json({ error: 'Shift changed concurrently. Reload and try again.' }, 409)
  if (parsedClosedAt.getTime() < new Date(shift.opened_at).getTime()) return c.json({ error: 'Closing time cannot be before opening time.' }, 400)
  const result = await writeClose(db, user, shift, { closedAt, countedUsd, countedKhr,
    note: optionalText(body.closing_note), deviceName: c.req.header('X-Device-Name') || null, reason: 'Historic manual close' })
  if (!result.changed || !result.shift) return c.json({ error: 'Shift changed concurrently. Reload and try again.' }, 409)
  const report = sendTelegramShiftReport(c.env, shift.id)
  try { c.executionCtx.waitUntil(report) } catch { void report }
  return c.json({ shift: responseShift(user, result.shift), already_closed: false, is_open: false }, 200)
})

app.patch('/:id', async (c) => {
  const user = c.get('user'); const denied = shiftPermissionError(c, user); if (denied) return denied
  const id = Number(c.req.param('id')); if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid shift id.' }, 400)
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>; const reason = optionalText(body.reason)
  if (!reason) return c.json({ error: 'A reason is required.' }, 400)
  const db = getDb(c.env); const before = await readShiftById(db, id)
  if (!before) return c.json({ error: 'Shift not found.' }, 404)
  if (before.branch_id != null && !(await resolveBranch(db, before.branch_id))) return c.json({ error: 'Shift not found.' }, 404)
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
  const after = { ...before, opened_at: openedAt,
    opening_float_usd: 'opening_float_usd' in body ? money(body.opening_float_usd) : before.opening_float_usd,
    opening_float_khr: 'opening_float_khr' in body ? money(body.opening_float_khr) : before.opening_float_khr,
    opening_note: 'opening_note' in body ? optionalText(body.opening_note) : before.opening_note,
    closed_at: closedAt,
    closing_counted_usd: closedAt ? ('closing_counted_usd' in body ? money(body.closing_counted_usd) : before.closing_counted_usd) : null,
    closing_counted_khr: closedAt ? ('closing_counted_khr' in body ? money(body.closing_counted_khr) : before.closing_counted_khr) : null,
    closing_note: closedAt ? ('closing_note' in body ? optionalText(body.closing_note) : before.closing_note) : null,
    revision: before.revision + 1 }
  const comparableBefore = { ...before }; delete (comparableBefore as Partial<ShiftRow>).revision
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
      params: { id, actorId: user.id, actorName, reason, beforeJson: JSON.stringify(before),
        afterJson: JSON.stringify(after), createdAt: nowIso, newRevision: after.revision } },
    { sql: transitionAuditSql(), params: { actorId: user.id, actorName, action: 'shift.amend', shiftId: id,
        details: JSON.stringify({ reason, revision: after.revision }), oldValue: JSON.stringify(before),
        newValue: JSON.stringify(after), deviceName: c.req.header('X-Device-Name') || null } },
  ])
  const changed = batchChanges(results[0])
  if (changed !== 1) return c.json({ error: 'Shift changed concurrently. Reload and try again.' }, 409)
  const saved = await readShiftById(db, id)
  if (!saved || saved.revision !== after.revision) return c.json({ error: 'Shift changed concurrently. Reload and try again.' }, 409)
  return c.json({ shift: responseShift(user, saved) }, 200)
})

export default app
