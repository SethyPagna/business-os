import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { BUSINESS_TZ_FORWARD, localTodayExpr } from '../lib/businessDateWindow'
import type { Env } from '../index'

// Cash-drawer shift registration -- mounted at /api/shifts.
//
// The owner's rule (2026-09-04): the first use of POS each day prompts the
// employee to register the drawer's opening float and KEEPS prompting until
// they do; once registered that day, never again; ending the shift is manual
// and can happen only once.
//
// Every one of those promises is enforced by migration 0116's schema rather
// than by a check in this file -- UNIQUE(user_id, branch_id, business_date)
// for "once a day", and `WHERE closed_at IS NULL` for "end once". This route
// is deliberately thin on top of them: two POS tabs opening the same morning
// race constantly, and a check-then-insert here is something both tabs pass.
// So the INSERT is allowed to fail on the constraint and that failure is
// translated into the already-registered answer, which is the truthful one.
const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()

app.use('*', requireAuth)

export type ShiftRow = {
  id: number
  shift_code: string
  user_id: number
  user_name: string | null
  branch_id: number | null
  branch_name: string | null
  business_date: string
  opened_at: string
  opening_float_usd: number
  opening_float_khr: number
  opening_note: string | null
  closed_at: string | null
  closing_counted_usd: number | null
  closing_counted_khr: number | null
  closing_note: string | null
}

const SHIFT_COLUMNS = `id, shift_code, user_id, user_name, branch_id, branch_name, business_date,
  opened_at, opening_float_usd, opening_float_khr, opening_note,
  closed_at, closing_counted_usd, closing_counted_khr, closing_note`

// Branch comes from the query for a till that serves more than one, and falls
// back to the request's own branch header. It is part of the daily key: one
// employee working a second branch's drawer is a SECOND float to count, not a
// duplicate registration.
function branchIdFrom(c: { req: { query: (k: string) => string | undefined; header: (k: string) => string | undefined } }): number | null {
  const raw = c.req.query('branch_id') ?? c.req.header('X-Branch-Id')
  if (raw == null || String(raw).trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function money(value: unknown): number {
  const n = Number(value)
  // A missing or unparseable count is 0, never NaN: NaN would be stored as
  // NULL and read back as "not counted", which is a different fact.
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0
}

// S-YYYYMMDD-HHMM in BUSINESS local time, matching the house session-id
// convention. Built from the same +7 offset the rest of the system uses, so a
// shift opened at 08:00 local never carries yesterday's date.
function shiftCode(nowIso: string): string {
  const local = new Date(new Date(nowIso).getTime() + 7 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `S-${local.getUTCFullYear()}${p(local.getUTCMonth() + 1)}${p(local.getUTCDate())}`
    + `-${p(local.getUTCHours())}${p(local.getUTCMinutes())}`
}

// GET /api/shifts/current -- what POS asks on every open.
//
// Answers three states in one shape, so the client never has to infer:
//   needs_registration true  -> prompt, and keep prompting
//   shift.closed_at null     -> an open shift is running
//   shift.closed_at set      -> today is registered AND already ended
async function readCurrent(env: Env, userId: number, branchId: number | null) {
  const db = getDb(env)
  // business_date is compared against the LOCAL today, not UTC's -- otherwise
  // the till re-prompts every evening at 17:00 local, when UTC rolls over but
  // the shop is still mid-shift.
  //
  // The branch term is spelled out rather than using `branch_id = @branchId`
  // because a NULL branch (a single-branch till) must match the NULL row, and
  // `NULL = NULL` is never true in SQL -- that comparison would report "not
  // registered" forever and prompt the employee on every single POS open.
  const row = await db.prepare(`
    SELECT ${SHIFT_COLUMNS}
    FROM shift_sessions
    WHERE user_id = @userId
      AND business_date = ${localTodayExpr()}
      AND ((@branchId IS NULL AND branch_id IS NULL) OR branch_id = @branchId)
    LIMIT 1
  `).get({ userId, branchId })
  return row as ShiftRow | undefined
}

app.get('/current', async (c) => {
  const user = c.get('user')
  const branchId = branchIdFrom(c)
  const shift = await readCurrent(c.env, user.id, branchId)
  return c.json({
    shift: shift ?? null,
    // The prompt condition is the ABSENCE of today's row. Nothing is scheduled
    // at login; a shift that was never registered keeps prompting through a
    // reload, a new tab, or a different device, which is what "will prompt
    // until it is registered" actually requires.
    needs_registration: !shift,
    // An open shift is one registered today and not yet ended by hand.
    is_open: !!shift && !shift.closed_at,
    can_end: !!shift && !shift.closed_at,
  })
})

// POST /api/shifts/open -- register today's opening float. Once only.
app.post('/open', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const branchId = body.branch_id != null && String(body.branch_id).trim() !== ''
    ? Number(body.branch_id)
    : branchIdFrom(c)
  const db = getDb(c.env)
  const nowIso = new Date().toISOString()

  const existing = await readCurrent(c.env, user.id, branchId ?? null)
  if (existing) {
    // Not an error. The employee asked to register and today is already
    // registered, so the honest answer is the existing shift plus the reason
    // nothing changed -- a 409 here would make a double-submit look broken.
    return c.json({ shift: existing, already_registered: true, needs_registration: false, is_open: !existing.closed_at }, 200)
  }

  const row = {
    shiftCode: shiftCode(nowIso),
    userId: user.id,
    userName: user.name || user.username || null,
    branchId: branchId ?? null,
    branchName: typeof body.branch_name === 'string' && body.branch_name.trim() ? body.branch_name.trim() : null,
    openedAt: nowIso,
    floatUsd: money(body.opening_float_usd),
    floatKhr: money(body.opening_float_khr),
    note: typeof body.opening_note === 'string' && body.opening_note.trim() ? body.opening_note.trim() : null,
    deviceName: c.req.header('X-Device-Name') || null,
  }

  try {
    await db.prepare(`
      INSERT INTO shift_sessions (
        shift_code, user_id, user_name, branch_id, branch_name, business_date,
        opened_at, opening_float_usd, opening_float_khr, opening_note, opened_device_name
      ) VALUES (
        @shiftCode, @userId, @userName, @branchId, @branchName,
        date(@openedAt, '${BUSINESS_TZ_FORWARD}'),
        @openedAt, @floatUsd, @floatKhr, @note, @deviceName
      )
    `).run(row)
  } catch (e) {
    // The UNIQUE index is the real "once a day" guarantee, and this is the
    // branch where it does its job: another tab inserted between our read and
    // our write. Re-read and answer with the row that won, rather than
    // surfacing a constraint error the employee cannot act on.
    const raced = await readCurrent(c.env, user.id, branchId ?? null)
    if (raced) {
      return c.json({ shift: raced, already_registered: true, needs_registration: false, is_open: !raced.closed_at }, 200)
    }
    throw e
  }

  const shift = await readCurrent(c.env, user.id, branchId ?? null)
  await audit(c.env, user.id, row.userName, 'shift.open', 'shift_session', shift?.id ?? null, {
    shift_code: row.shiftCode,
    branch_id: row.branchId,
    opening_float_usd: row.floatUsd,
    opening_float_khr: row.floatKhr,
  })
  return c.json({ shift, already_registered: false, needs_registration: false, is_open: true }, 201)
})

// POST /api/shifts/close -- end the shift by hand. Once only.
app.post('/close', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const branchId = body.branch_id != null && String(body.branch_id).trim() !== ''
    ? Number(body.branch_id)
    : branchIdFrom(c)
  const db = getDb(c.env)

  const shift = await readCurrent(c.env, user.id, branchId ?? null)
  if (!shift) {
    return c.json({ error: 'No shift is registered for today. Register the opening float first.' }, 404)
  }
  if (shift.closed_at) {
    // Already ended. Returning 200 with the existing row makes a double-tap or
    // a retried request harmless and visibly a no-op, which is exactly what
    // "end only once" should feel like from the till.
    return c.json({ shift, already_closed: true, is_open: false }, 200)
  }

  const nowIso = new Date().toISOString()
  const patch = {
    id: shift.id,
    closedAt: nowIso,
    countedUsd: money(body.closing_counted_usd),
    countedKhr: money(body.closing_counted_khr),
    note: typeof body.closing_note === 'string' && body.closing_note.trim() ? body.closing_note.trim() : null,
    deviceName: c.req.header('X-Device-Name') || null,
  }

  // `AND closed_at IS NULL` is the concurrency guard, not the check above:
  // two simultaneous closes both pass the read, and only one matches here.
  const result = await db.prepare(`
    UPDATE shift_sessions
       SET closed_at = @closedAt,
           closing_counted_usd = @countedUsd,
           closing_counted_khr = @countedKhr,
           closing_note = @note,
           closed_device_name = @deviceName,
           updated_at = @closedAt
     WHERE id = @id AND closed_at IS NULL
  `).run(patch)

  const after = await readCurrent(c.env, user.id, branchId ?? null)
  const changed = (result as { meta?: { changes?: number } })?.meta?.changes ?? 0
  if (changed > 0) {
    await audit(c.env, user.id, shift.user_name, 'shift.close', 'shift_session', shift.id, {
      shift_code: shift.shift_code,
      closing_counted_usd: patch.countedUsd,
      closing_counted_khr: patch.countedKhr,
      opening_float_usd: shift.opening_float_usd,
      opening_float_khr: shift.opening_float_khr,
    })
  }
  return c.json({ shift: after, already_closed: changed === 0, is_open: false }, 200)
})


export default app
