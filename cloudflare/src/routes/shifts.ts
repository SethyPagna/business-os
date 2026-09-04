import { Hono } from 'hono'
import { getDb, type D1Compat } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { BUSINESS_TZ_FORWARD, BUSINESS_UTC_OFFSET_MINUTES, localTodayExpr } from '../lib/businessDateWindow'
import { hasAnyPermission, hasPermission, isAdminControlUser } from '../lib/permissions'
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
  return isAdminControlUser(user) || hasPermission(user, 'settings')
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
function currentResponse(shift: ShiftRow | undefined, policy: ShiftPolicy, exempt: boolean) {
  return { shift: shift ?? null, policy, exempt, needs_registration: !exempt && !shift,
    is_open: !!shift && !shift.closed_at, can_end: !!shift && !shift.closed_at }
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
  return c.json(currentResponse(shift, policy, exempt))
})

app.get('/', async (c) => {
  const user = c.get('user'); const manager = canManageShifts(user); const branchId = branchIdFrom(c)
  const rawUserId = Number(c.req.query('user_id'))
  const requestedUserId = manager && Number.isInteger(rawUserId) && rawUserId > 0 ? rawUserId : null
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50))
  const shifts = await getDb(c.env).prepare(`SELECT ${SHIFT_COLUMNS} FROM shift_sessions
    WHERE (@manager = 1 OR user_id = @selfId) AND (@requestedUserId IS NULL OR user_id = @requestedUserId)
      AND (@branchId IS NULL OR branch_id = @branchId) AND (@from IS NULL OR business_date >= @from)
      AND (@to IS NULL OR business_date <= @to)
    ORDER BY business_date DESC, opened_at DESC, id DESC LIMIT @limit`).all<ShiftRow>({
      manager: manager ? 1 : 0, selfId: user.id, requestedUserId, branchId,
      from: c.req.query('from') || null, to: c.req.query('to') || null, limit,
    })
  return c.json({ shifts, scope: manager ? 'all' : 'own' })
})

app.get('/:id/history', async (c) => {
  const user = c.get('user'); const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid shift id.' }, 400)
  const db = getDb(c.env); const shift = await readShiftById(db, id)
  if (!shift) return c.json({ error: 'Shift not found.' }, 404)
  if (!canManageShifts(user) && shift.user_id !== user.id) return c.json({ error: 'Forbidden' }, 403)
  const amendments = await db.prepare(`SELECT id, shift_session_id, actor_user_id, actor_name, reason,
    before_json, after_json, created_at FROM shift_session_amendments
    WHERE shift_session_id = @id ORDER BY created_at ASC, id ASC`).all({ id })
  return c.json({ shift, amendments })
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
  if (existing) return c.json({ ...currentResponse(existing, policy, false), already_registered: true }, 200)
  const nowIso = new Date().toISOString()
  const row = { shiftCode: shiftCode(nowIso), scopeMode: policy.scope_mode, userId: user.id,
    userName: displayName(user), branchId, branchName: branch?.name ?? null, openedAt: nowIso,
    floatUsd: money(body.opening_float_usd), floatKhr: money(body.opening_float_khr),
    note: optionalText(body.opening_note), deviceName: c.req.header('X-Device-Name') || null }
  try {
    await db.prepare(`INSERT INTO shift_sessions (shift_code, scope_mode, user_id, user_name, branch_id,
      branch_name, business_date, opened_at, opening_float_usd, opening_float_khr, opening_note, opened_device_name)
      VALUES (@shiftCode,@scopeMode,@userId,@userName,@branchId,@branchName,date(@openedAt,'${BUSINESS_TZ_FORWARD}'),
      @openedAt,@floatUsd,@floatKhr,@note,@deviceName)`).run(row)
  } catch (error) {
    const raced = await readCurrent(db, policy, user.id, branchId)
    if (raced) return c.json({ ...currentResponse(raced, policy, false), already_registered: true }, 200)
    throw error
  }
  const shift = await readCurrent(db, policy, user.id, branchId)
  await audit(c.env, user.id, row.userName, 'shift.open', 'shift_session', shift?.id ?? null,
    { shift_code: row.shiftCode, scope_mode: row.scopeMode, branch_id: row.branchId,
      opening_float_usd: row.floatUsd, opening_float_khr: row.floatKhr })
  return c.json({ ...currentResponse(shift, policy, false), already_registered: false }, 201)
})

app.post('/close', async (c) => {
  const user = c.get('user'); const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const denied = shiftPermissionError(c, user); if (denied) return denied
  const branchId = bodyBranchId(body, branchIdFrom(c))
  if (body.branch_id != null && String(body.branch_id).trim() !== '' && branchId == null) return c.json({ error: 'Invalid branch id.' }, 400)
  const db = getDb(c.env)
  if (branchId != null && !(await resolveBranch(db, branchId))) return c.json({ error: 'Branch not found or inactive.' }, 400)
  const policy = await readShiftPolicy(db)
  if (policy.admin_exempt && isAdminControlUser(user)) return c.json({ error: 'This account is exempt from shifts.', exempt: true }, 403)
  const shift = await readCurrent(db, policy, user.id, branchId)
  if (!shift) return c.json({ error: 'No shift is registered for today. Register the opening float first.' }, 404)
  if (shift.closed_at) return c.json({ shift, already_closed: true, is_open: false }, 200)
  const patch = { id: shift.id, closedAt: new Date().toISOString(), countedUsd: money(body.closing_counted_usd),
    countedKhr: money(body.closing_counted_khr), note: optionalText(body.closing_note),
    deviceName: c.req.header('X-Device-Name') || null, closerId: user.id, closerName: displayName(user) }
  const result = await db.prepare(`UPDATE shift_sessions SET closed_at=@closedAt, closing_counted_usd=@countedUsd,
    closing_counted_khr=@countedKhr, closing_note=@note, closed_device_name=@deviceName,
    closed_by_user_id=@closerId, closed_by_user_name=@closerName, revision=revision+1, updated_at=@closedAt
    WHERE id=@id AND closed_at IS NULL`).run(patch)
  const after = await readShiftById(db, shift.id)
  if (result.changes > 0) {
    await audit(c.env, user.id, patch.closerName, 'shift.close', 'shift_session', shift.id,
      { shift_code: shift.shift_code, scope_mode: shift.scope_mode,
        closing_counted_usd: patch.countedUsd, closing_counted_khr: patch.countedKhr })
    const report = sendTelegramShiftReport(c.env, shift.id)
    try { c.executionCtx.waitUntil(report) } catch { void report }
  }
  return c.json({ shift: after, already_closed: result.changes === 0, is_open: false }, 200)
})

app.patch('/:id', async (c) => {
  const user = c.get('user')
  if (!canManageShifts(user)) return c.json({ error: 'Manager permission required.' }, 403)
  const id = Number(c.req.param('id')); if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid shift id.' }, 400)
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>; const reason = optionalText(body.reason)
  if (!reason) return c.json({ error: 'A reason is required.' }, 400)
  const db = getDb(c.env); const before = await readShiftById(db, id)
  if (!before) return c.json({ error: 'Shift not found.' }, 404)
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
  ])
  const changed = Number((results[0] as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0)
  if (changed !== 1) return c.json({ error: 'Shift changed concurrently. Reload and try again.' }, 409)
  const saved = await readShiftById(db, id)
  if (!saved || saved.revision !== after.revision) return c.json({ error: 'Shift changed concurrently. Reload and try again.' }, 409)
  await audit(c.env, user.id, actorName, 'shift.amend', 'shift_session', id, { reason, revision: saved.revision })
  return c.json({ shift: saved }, 200)
})

export default app
