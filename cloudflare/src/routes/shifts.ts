import { Hono } from 'hono'
import { getDb, type D1Compat } from '../lib/db'
import { CLIENT_TIMESTAMP_MAX_FUTURE_SKEW_MS } from '../lib/clientTimestamp'
import { requireAuth, type SessionUser } from '../lib/auth'
import { BUSINESS_TZ_FORWARD, BUSINESS_UTC_OFFSET_MINUTES, localTodayExpr } from '../lib/businessDateWindow'
import { hasAnyPermission, isAdminControlUser } from '../lib/permissions'
import { sendTelegramShiftReport } from '../lib/telegram'
import {
  loadShiftFigures, loadShiftReconciliation, type ShiftFigures, type ShiftReconciliation,
} from '../lib/shiftReconciliation'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)

// The existing immutable audit row is the receipt, committed in the same D1
// batch as the transition. No separate receipt write can lose a committed ack.
function mutationRequest(body: Record<string, unknown>, target: number) {
  if (typeof body.client_request_id !== 'string') return undefined
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(body).sort(([a], [b]) => a.localeCompare(b))))
  return { id: body.client_request_id, target, canonical }
}

app.use('*', async (c, next) => {
  const match = c.req.path.match(/\/(\d+)(?:\/(close|reopen|cancel))?$/)
  const legacyClose = c.req.method === 'POST' && (c.req.path === '/close' || c.req.path.endsWith('/shifts/close'))
  if ((!match && !legacyClose) || !['POST', 'PATCH'].includes(c.req.method)) return next()
  const action = legacyClose ? 'close' : match?.[2] || (c.req.method === 'PATCH' ? 'amend' : '')
  if (!action) return next()
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const user = c.get('user'); const denied = shiftPermissionError(c, user); if (denied) return denied
  if (legacyClose && (!Number.isInteger(body.shift_id) || Number(body.shift_id) <= 0 || !Number.isInteger(body.expected_revision) || Number(body.expected_revision) < 0 || !body.client_request_id)) {
    return c.json({ error: 'Refresh the app before closing. The exact shift, revision and request identity are required.', code: 'client_request_id_required' }, 400)
  }
  if (body.client_request_id == null) return next() // older clients retain revision protection
  if (typeof body.client_request_id !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(body.client_request_id)) {
    return c.json({ error: 'Invalid shift request identity.' }, 400)
  }
  const db = getDb(c.env); const target = await readShiftById(db, legacyClose ? Number(body.shift_id) : Number(match?.[1]))
  if (!target) return c.json({ error: 'Shift not found.' }, 404)
  // The same split the handlers enforce, applied before the replay lookup so
  // a caller who may not act cannot probe a receipt: amend follows
  // canAmendShift (any shifts user), cancel is administrator-only, and the
  // close/reopen transitions stay with the owner or an administrator.
  const permitted = action === 'amend' ? canAmendShift(user, target)
    : action === 'cancel' ? canManageShifts(user) && canMutateShift(user, target)
      : canMutateShift(user, target)
  if (!permitted) return c.json({ error: 'Shift permission is required.' }, 403)
  if (target.branch_id != null && !(await resolveBranch(db, target.branch_id))) return c.json({ error: 'Shift not found.' }, 404)
  const replay = async () => {
    const receipt = await db.prepare(`SELECT entity_id, details FROM audit_logs
      WHERE user_id=@actor AND action=@action AND json_valid(details)
        AND json_extract(details,'$.request.id')=@requestId ORDER BY id DESC LIMIT 1`)
      .get<{ entity_id: string; details: string }>({ actor: user.id, action: `shift.${action}`, requestId: body.client_request_id })
    if (!receipt) return null
    const request = JSON.parse(receipt.details).request
    if (JSON.stringify(request) !== JSON.stringify(mutationRequest(body, target.id))) return c.json({ error: 'Shift request identity was reused with different values.' }, 409)
    const saved = await readShiftById(db, Number(receipt.entity_id))
    if (!saved) return c.json({ error: 'Committed shift could not be read back.' }, 503)
    return c.json({ shift: await reconciledShift(c.env, user, saved), mutation_committed: true,
      ...(action === 'close' ? { already_closed: true, is_open: false } : {}),
      ...(action === 'cancel' ? { cancelled: true } : {}),
      ...(action === 'reopen' ? { reopened_from_shift_id: target.id } : {}),
    }, 200)
  }
  const prior = await replay(); if (prior) return prior
  await next()
  // A concurrent exact retry may reach the revision guard before its peer's
  // commit is visible. Re-read the immutable receipt after the handler.
  if (c.res.status >= 409) {
    const committed = await replay()
    if (committed) c.res = committed
    else if (c.res.status === 409) {
      const latest = await readShiftById(db, target.id)
      // A different committed revision (or existing continuation) makes the
      // frozen CAS impossible. This is authoritative rejection, not an
      // endlessly pending timeout that traps the operator in Retry.
      if (latest && (latest.revision !== Number(body.expected_revision) || (action === 'reopen' && latest.has_reopened_child))) {
        c.res = c.json({ error: 'Shift changed concurrently. Reload and try again.', code: 'shift_request_superseded', outcome: 'rejected' }, 409)
      }
    }
  }
})

export type ShiftScopeMode = 'per_account' | 'shop_wide'
export type ShiftPolicy = { scope_mode: ShiftScopeMode; admin_exempt: boolean }
export type ShiftRow = {
  id: number; shift_code: string; scope_mode: ShiftScopeMode; user_id: number; user_name: string | null
  branch_id: number | null; branch_name: string | null; business_date: string; opened_at: string
  opening_float_usd: number | null; opening_float_khr: number | null; opening_note: string | null; closed_at: string | null
  additional_cash_usd: number; additional_cash_khr: number
  closing_counted_usd: number | null; closing_counted_khr: number | null; closing_note: string | null
  closed_by_user_id: number | null; closed_by_user_name: string | null; revision: number
  parent_shift_id: number | null; reopen_reason: string | null
  reopened_by_user_id: number | null; reopened_by_user_name: string | null
  cancelled_at: string | null; cancelled_by_user_id: number | null
  cancelled_by_user_name: string | null; cancel_reason: string | null
}
type ShiftDbRow = ShiftRow & { has_reopened_child: number; amendment_count: number }
export type ShiftCapabilities = { can_edit: boolean; can_close: boolean; can_reopen: boolean; can_cancel: boolean }
export type ShiftResponseRow = ShiftRow & { capabilities: ShiftCapabilities; amendment_count: number }

/**
 * ---- The EDITED badge: how many CORRECTIONS this shift record carries ----
 *
 * `shift_session_amendments` is the before/after journal for everything that
 * ever moved a shift row, so a plain COUNT(*) would badge every closed shift
 * as edited -- the close writes a row there, and so do the cancel and the
 * reopen. An edit is a CORRECTION of a recorded fact, so the three lifecycle
 * transitions are excluded by what their own snapshots say:
 *
 *   * a reopen (and the replacement opened after a cancellation) is the only
 *     kind whose before/after describe two DIFFERENT rows, so the shift_code
 *     differs;
 *   * a cancellation is the only kind whose after-snapshot is cancelled;
 *   * a close is the only kind that turns a null closed_at into a real one.
 *
 * Counted across the whole LINEAGE, not the one row: a reopened shift is one
 * record to the owner (one list row -- see the list read), and an edit made on
 * an earlier segment must still light the badge on it. The chain is walked
 * upwards through parent_shift_id, which is at most a handful of rows.
 *
 * Mirrors the sale rows' Edited badge (lib/saleRecords.ts), which counts
 * `sale_amendments` the same way and for the same reason.
 */
const AMENDMENT_COUNT_SQL = `(SELECT COUNT(*) FROM shift_session_amendments amend
    WHERE amend.shift_session_id IN (
      WITH RECURSIVE lineage(segment_id) AS (
        SELECT shift_sessions.id
        UNION ALL
        SELECT older.parent_shift_id FROM shift_sessions older
          JOIN lineage ON older.id = lineage.segment_id WHERE older.parent_shift_id IS NOT NULL)
      SELECT segment_id FROM lineage)
      AND json_valid(amend.before_json) AND json_valid(amend.after_json)
      AND json_extract(amend.before_json, '$.shift_code') = json_extract(amend.after_json, '$.shift_code')
      AND json_extract(amend.after_json, '$.cancelled_at') IS NULL
      AND NOT (json_extract(amend.before_json, '$.closed_at') IS NULL
        AND json_extract(amend.after_json, '$.closed_at') IS NOT NULL))`

const SHIFT_COLUMNS = `id, shift_code, scope_mode, user_id, user_name, branch_id, branch_name, business_date,
  opened_at,
  CASE WHEN opening_float_usd_registered=1 THEN opening_float_usd ELSE NULL END AS opening_float_usd,
  CASE WHEN opening_float_khr_registered=1 THEN opening_float_khr ELSE NULL END AS opening_float_khr,
  opening_note, additional_cash_usd, additional_cash_khr,
  closed_at, closing_counted_usd, closing_counted_khr, closing_note,
  closed_by_user_id, closed_by_user_name, revision,
  parent_shift_id, reopen_reason, reopened_by_user_id, reopened_by_user_name,
  cancelled_at, cancelled_by_user_id, cancelled_by_user_name, cancel_reason,
  EXISTS (SELECT 1 FROM shift_sessions child WHERE child.parent_shift_id=shift_sessions.id) AS has_reopened_child,
  ${AMENDMENT_COUNT_SQL} AS amendment_count`

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
/**
 * ---- The counted drawer at CLOSE is a record, not a gate -----------------
 *
 * Owner ruling (Sep 6 2026): "closing shift is only a breakdown for admins in
 * reports and so on ... it is not calculated in the internal system, it is
 * calculated only for shift report". A cashier who cannot make the drawer
 * agree, or who has not counted it at all, must still be able to end the
 * shift, because nothing downstream of a shift depends on the count.
 *
 * So a blank/absent count is ACCEPTED and stored as NULL (the column has
 * always been nullable and every reader already prints "—" for it), while a
 * value that is not a non-negative number is still a 400. Opening registration
 * now uses this same strict blank/null distinction.
 *
 * There is no variance rule anywhere on this path. counted − expected is
 * computed for the report (lib/shiftReconciliation.ts) and printed; it never
 * decides whether the close is allowed.
 */
function countedMoney(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value == null) return { ok: true, value: null }
  if (typeof value !== 'number' && typeof value !== 'string') return { ok: false }
  if (typeof value === 'string' && value.trim() === '') return { ok: true, value: null }
  const n = Number(typeof value === 'string' ? value.trim() : value)
  return Number.isFinite(n) && n >= 0 ? { ok: true, value: Math.round(n * 100) / 100 } : { ok: false }
}
/** Additional change used is an optional non-negative inflow. Blank means no cash
 * was added, so it is stored as numeric zero and never changes the opening or
 * closing registration. */
function additionalMoney(value: unknown): { ok: true; value: number } | { ok: false } {
  const parsed = countedMoney(value)
  return parsed.ok ? { ok: true, value: parsed.value ?? 0 } : parsed
}
function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
function requiredReason(value: unknown): string | null {
  const reason = optionalText(value)
  return reason && reason.length <= 500 ? reason : null
}
/**
 * The ACTOR SNAPSHOT written onto a shift row and its audit line. The
 * account's username, not its display name: the id is the source of truth,
 * the username is the stable handle a rename cascades through, and a display
 * name is free text that can be changed to anything by the person it names.
 * `user.name` remains the fallback only for accounts that carry no username.
 */
function displayName(user: SessionUser): string | null { return user.username || user.name || null }
function canUseShifts(user: SessionUser): boolean { return hasAnyPermission(user, ['pos', 'sales']) }
function shiftPermissionError(c: { json: (body: object, status: 403) => Response }, user: SessionUser): Response | null {
  return canUseShifts(user) ? null : c.json({ error: 'You do not have permission to use shifts.' }, 403)
}
async function resolveBranch(db: D1Compat, branchId: number | null): Promise<{ id: number; name: string } | null> {
  if (branchId == null) return null
  return (await db.prepare('SELECT id, name FROM branches WHERE id=@id AND is_active=1').get<{ id: number; name: string }>({ id: branchId })) ?? null
}
/**
 * D1/SQLite datetime columns are written without a timezone suffix
 * ("YYYY-MM-DD HH:MM:SS", always UTC by SQLite's own convention -- see
 * lib/auth.ts's asUtc and the same idiom in lib/salesAnalytics.ts). Passing
 * that bare form straight to `new Date()` parses it as LOCAL time, which is
 * harmless in the deployed Worker (workerd always runs UTC) but silently
 * wrong anywhere the route runs on a non-UTC host -- this file's own pure
 * test harness among them, where it read a shift opened seven hours before
 * local midnight as if it were opened seven hours before UTC midnight and
 * failed the business-date check on a shift the caller had every right to
 * amend. Every raw D1 timestamp goes through this before arithmetic.
 */
/**
 * ---- Device clocks are not the time authority ---------------------------
 *
 * The POS End Shift button used to stamp the closing moment with the phone's
 * own clock and the route refused anything even one second ahead of the
 * Worker's clock ("Closing time cannot be in the future."). A device running
 * a few seconds fast therefore could never end its shift from POS at all,
 * while the Shifts popup -- where the operator picks an earlier minute --
 * still worked. Production shift 20 (2026-09-21) was closed exactly that way.
 *
 * A requested time within the shared client-clock tolerance (lib/clientTimestamp,
 * the same window offline sale timestamps get) ahead of the server is what the client
 * meant by "now" and is clamped to the server's now; only a time further
 * ahead is a genuine future timestamp and is still refused. A missing
 * closed_at on the close route means "now" and is stamped server-side.
 */
function withinServerClock(requestedMs: number, now: number): number | null {
  if (!Number.isFinite(requestedMs) || requestedMs > now + CLIENT_TIMESTAMP_MAX_FUTURE_SKEW_MS) return null
  return Math.min(requestedMs, now)
}
function utcMs(value: string): number {
  const text = value.trim()
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text.replace(' ', 'T') : `${text.replace(' ', 'T')}Z`)
}
function businessDateFor(iso: string): string {
  return new Date(utcMs(iso) + BUSINESS_UTC_OFFSET_MINUTES * 60 * 1000).toISOString().slice(0, 10)
}
function shiftCode(nowIso: string): string {
  const local = new Date(new Date(nowIso).getTime() + 7 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `S-${local.getUTCFullYear()}${p(local.getUTCMonth() + 1)}${p(local.getUTCDate())}-${p(local.getUTCHours())}${p(local.getUTCMinutes())}-${crypto.randomUUID().slice(0, 6)}`
}

export function canManageShifts(user: SessionUser): boolean {
  return isAdminControlUser(user)
}

/**
 * ---- O8: a shift row is cash, so it is not public to the shop ------------
 *
 * Every row carries an opening float and a counted drawer, so listing all of
 * them to anyone holding the `pos` permission published each cashier's till
 * to their colleagues. A caller sees:
 *
 *   - their OWN shifts, always;
 *   - shop_wide shifts, when the shop runs on `shift_scope_mode=shop_wide`
 *     (migration 0118) -- such a shift belongs to the branch by definition,
 *     which is what that setting means;
 *   - everything, if they hold the shift-review capability. That is the SAME
 *     capability that already gates cancel (canManageShifts), not a new one.
 *
 * `shift_admin_exempt` is the other half of 0118 and is unchanged: it decides
 * whether an admin must register a shift, not what an admin may read.
 *
 * The clause is SQL, not a filter applied after the read, so a hidden row
 * never leaves D1; and a caller-supplied `user_id` narrows within it and can
 * never widen it.
 */
function shiftVisibility(user: SessionUser, policy: ShiftPolicy) {
  const reviewer = canManageShifts(user)
  const shopWide = policy.scope_mode === 'shop_wide'
  return {
    reviewer,
    scope: reviewer || shopWide ? 'all' as const : 'own' as const,
    clause: `(@reviewer = 1 OR shift_sessions.user_id = @selfId
      OR (@shopWide = 1 AND shift_sessions.scope_mode = 'shop_wide'))`,
    params: { reviewer: reviewer ? 1 : 0, selfId: user.id, shopWide: shopWide ? 1 : 0 },
  }
}
function canSeeShift(user: SessionUser, policy: ShiftPolicy, shift: ShiftRow): boolean {
  return canManageShifts(user) || shift.user_id === user.id
    || (policy.scope_mode === 'shop_wide' && shift.scope_mode === 'shop_wide')
}
/** The row as it is STORED, which is what a before/after snapshot must hold:
 * the two derived columns above are answers about the row, not fields of it,
 * and writing them into before_json/after_json would make every amendment
 * diff carry a count of itself. */
function storedShift(shift: ShiftDbRow): ShiftRow {
  const { has_reopened_child: _hasReopenedChild, amendment_count: _amendmentCount, ...stored } = shift
  return stored
}
function canMutateShift(user: SessionUser, shift: ShiftRow): boolean {
  return canManageShifts(user) || shift.user_id === user.id
}
/**
 * ---- Who may AMEND a shift record (owner ruling, Sep 14 2026) ------------
 *
 * "shift should be aditable for employees. it just leaves record basially
 * each shift have record shown one row last row of each record. like sales
 * record for any change, before and after."
 *
 * Amending is therefore NOT an ownership privilege. Any account that may use
 * shifts at all -- the same pos/sales tier that opens and closes one in POS,
 * already required by `shiftPermissionError` on every route here -- may
 * correct any shift record it can reach, exactly as a cashier may edit a sale
 * they did not ring up. The correction is not silent: it writes a before/after
 * row in `shift_session_amendments` and an audit line naming the actor.
 *
 * What did NOT widen: CANCEL stays administrator-only (canManageShifts), and
 * the CLOSE and REOPEN lifecycle transitions stay with the shift owner or an
 * administrator (canMutateShift) -- they end and restart a working shift
 * rather than correct a record of one. A cancelled row is not amendable at
 * all; its amendment would have nothing left to correct.
 */
function canAmendShift(user: SessionUser, shift: ShiftRow): boolean {
  return canUseShifts(user) && !shift.cancelled_at
}
function responseShift(user: SessionUser, row: ShiftDbRow): ShiftResponseRow {
  const shift = storedShift(row)
  const cancelled = !!shift.cancelled_at; const canMutate = canMutateShift(user, shift) && !cancelled
  return { ...shift, amendment_count: Number(row.amendment_count) || 0, capabilities: {
    can_edit: canAmendShift(user, shift),
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
/**
 * ---- The shift left OPEN on an earlier business day ----------------------
 *
 * A cashier who never pressed End Shift yesterday could not close it from the
 * POS at all: `readCurrent` answers with today only, so /current returned
 * `shift: null` and nothing in the payload carried the id that
 * `POST /:id/close` (which already accepts any business date) needs.
 *
 * This is a SECOND query on purpose. Widening `readCurrent` to reach back in
 * time would delete the daily prompt the owner ruled must always appear --
 * yesterday's row would answer as "current", `needs_registration` would go
 * false, and `POST /open` would return `already_registered` on that stale row
 * instead of creating today's. So the carry-over is reported ALONGSIDE the
 * prompt, never instead of it.
 *
 * Scope, branch and continuation rules are the list read's: cancelled rows are
 * not offered, and a segment that has already been continued is not either --
 * the row that stands for the record is the last one of its lineage.
 *
 * OLDEST first, not most recent: intervalError refuses to close a later
 * segment while an earlier one is still open, so with two stale days the only
 * order the POS can drain is oldest to newest.
 *
 * Read for EVERY caller, exempt administrators included: the exemption decides
 * whether an account is PROMPTED to register its own day, never what it may
 * close, and under shop_wide an administrator is the only account that may end
 * a stale row another cashier left open. /current reports the row together
 * with the close bound the Worker itself will enforce (see the handler), so
 * the client never has to guess a closing time that comes back 409.
 */
async function readPreviousOpen(db: D1Compat, policy: ShiftPolicy, userId: number, branchId: number | null) {
  const accountClause = policy.scope_mode === 'per_account' ? 'AND user_id = @userId' : ''
  return db.prepare(`SELECT ${SHIFT_COLUMNS} FROM shift_sessions
    WHERE scope_mode = @scopeMode ${accountClause}
      AND business_date < ${localTodayExpr()}
      AND closed_at IS NULL AND cancelled_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM shift_sessions later WHERE later.parent_shift_id = shift_sessions.id)
      AND ((@branchId IS NULL AND branch_id IS NULL) OR branch_id = @branchId)
    ORDER BY business_date ASC, opened_at ASC, id ASC LIMIT 1`)
    .get<ShiftDbRow>({ scopeMode: policy.scope_mode, userId, branchId })
}
async function readShiftById(db: D1Compat, id: number) {
  return db.prepare(`SELECT ${SHIFT_COLUMNS} FROM shift_sessions WHERE id = @id`).get<ShiftDbRow>({ id })
}
async function readChild(db: D1Compat, id: number) {
  return db.prepare(`SELECT ${SHIFT_COLUMNS} FROM shift_sessions WHERE parent_shift_id = @id LIMIT 1`).get<ShiftDbRow>({ id })
}
/**
 * Every segment of ONE shift record, oldest first. A reopen -- and the
 * replacement opened after a cancellation -- writes a new row that points at
 * the segment it continues (`parent_shift_id`, migration 0123), and the owner
 * reads the whole chain as one shift. One child per parent is an invariant of
 * the continuation insert (its NOT EXISTS guard), so this is a list, not a
 * tree; the step cap and the seen check only keep a corrupted chain from
 * looping forever.
 */
const MAX_SHIFT_SEGMENTS = 20
async function readLineage(db: D1Compat, shift: ShiftDbRow): Promise<ShiftDbRow[]> {
  const chain = [shift]
  while (chain.length < MAX_SHIFT_SEGMENTS) {
    const parentId = chain[0].parent_shift_id
    if (parentId == null) break
    const parent = await readShiftById(db, parentId)
    if (!parent || chain.some((segment) => segment.id === parent.id)) break
    chain.unshift(parent)
  }
  while (chain.length < MAX_SHIFT_SEGMENTS) {
    const child = await readChild(db, chain[chain.length - 1].id)
    if (!child || chain.some((segment) => segment.id === child.id)) break
    chain.push(child)
  }
  return chain
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
  if (previous && (!previous.closed_at || utcMs(previous.closed_at) > utcMs(openedAt))) {
    return 'Opening time overlaps the previous shift segment.'
  }
  if (next && (!closedAt || utcMs(closedAt) > utcMs(next.opened_at))) {
    return 'Closing time overlaps the next shift segment.'
  }
  return null
}
async function writeContinuation(db: D1Compat, user: SessionUser, parent: ShiftDbRow, input: {
  reason: string; floatUsd: number | null; floatKhr: number | null; note: string | null; deviceName: string | null
  afterCancellation: boolean; auditAction: 'shift.reopen' | 'shift.open_after_cancel'
  request?: ReturnType<typeof mutationRequest>
}): Promise<{ changed: boolean; shift?: ShiftDbRow; conflict: boolean }> {
  const nowIso = new Date().toISOString(); const actorName = displayName(user); const childCode = shiftCode(nowIso)
  const child = { shiftCode: childCode, parentId: parent.id, expectedRevision: parent.revision, reason: input.reason,
    actorId: user.id, actorName, openedAt: nowIso, floatUsd: input.floatUsd, floatKhr: input.floatKhr,
    storedFloatUsd: input.floatUsd ?? 0, storedFloatKhr: input.floatKhr ?? 0,
    floatUsdRegistered: input.floatUsd == null ? 0 : 1, floatKhrRegistered: input.floatKhr == null ? 0 : 1,
    note: input.note, deviceName: input.deviceName, afterCancellation: input.afterCancellation ? 1 : 0 }
  const parentStored = storedShift(parent)
  const childSnapshot = { shift_code: child.shiftCode, scope_mode: parent.scope_mode, user_id: parent.user_id,
    user_name: parent.user_name, branch_id: parent.branch_id, branch_name: parent.branch_name,
    business_date: parent.business_date, opened_at: child.openedAt, opening_float_usd: child.floatUsd,
    opening_float_khr: child.floatKhr, opening_note: child.note, additional_cash_usd: 0, additional_cash_khr: 0,
    parent_shift_id: parent.id,
    reopen_reason: child.reason, reopened_by_user_id: child.actorId, reopened_by_user_name: child.actorName,
    closed_at: null, cancelled_at: null, revision: 0 }
  let results: unknown[]
  try {
    results = await db.batch([
      { sql: `INSERT INTO shift_sessions (shift_code,scope_mode,user_id,user_name,branch_id,branch_name,business_date,
          opened_at,opening_float_usd,opening_float_khr,opening_float_usd_registered,opening_float_khr_registered,
          opening_note,opened_device_name,parent_shift_id,reopen_reason,
          reopened_by_user_id,reopened_by_user_name)
        SELECT @shiftCode,scope_mode,user_id,user_name,branch_id,branch_name,business_date,
          @openedAt,@storedFloatUsd,@storedFloatKhr,@floatUsdRegistered,@floatKhrRegistered,
          @note,@deviceName,id,@reason,@actorId,@actorName
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
        actorId: user.id, actorName, details: JSON.stringify({ reason: input.reason, parent_shift_id: parent.id, request: input.request }),
        oldValue: JSON.stringify(parentStored), newValue: JSON.stringify(childSnapshot), deviceName: input.deviceName } },
    ])
  } catch (error) {
    if (await readChild(db, parent.id)) return { changed: false, conflict: true }
    throw error
  }
  if (batchChanges(results[0]) !== 1) return { changed: false, conflict: true }
  return { changed: true, conflict: false, shift: await readShiftByCode(db, child.shiftCode) }
}
/**
 * The drawer breakdown for one shift, from the ONE shared definition
 * (lib/shiftReconciliation.ts) the Telegram report also calls. Returned with
 * the close and with the reads so the close dialog, the shift summary and the
 * bot message cannot print three different expected drawers.
 *
 * A failure here returns null rather than throwing: the close has already
 * committed by the time this runs, and losing the receipt-side arithmetic
 * must not turn a successful close into a 500 the cashier will retry.
 */
async function reconciliationFor(env: Env, user: SessionUser, shift: ShiftRow): Promise<ShiftReconciliation | null> {
  // Registered counts remain operational records; derived business comparisons
  // belong to the same admin reviewer as figures, including replay responses.
  if (!canManageShifts(user)) return null
  try { return await loadShiftReconciliation(env, shift, Date.now()) } catch { return null }
}
/**
 * The shift REPORT figures -- sales, COGS, profit, delivery and the expense
 * split, from lib/shiftReconciliation.ts.
 *
 * ADMIN ONLY, like the derived drawer comparison above. Registered opening,
 * additional and closing counts remain visible on authorized operational rows.
 * COGS/profit and the comparison use the same existing reviewer identity as
 * cancel and cross-cashier reads (canManageShifts).
 *
 * Absent from the LIST read and from /current on purpose: each call runs the
 * sales kernel over the window, and neither a page of shifts nor a polled
 * banner is a report. It is attached where a report is actually opened -- the
 * per-shift history read -- and to the close response that renders the same
 * summary.
 *
 * Null on failure, for the same reason as the reconciliation: the close has
 * already committed, and losing the report half must never fail the request.
 */
async function figuresFor(env: Env, user: SessionUser, shift: ShiftRow): Promise<ShiftFigures | null> {
  if (!canManageShifts(user)) return null
  try { return await loadShiftFigures(env, shift, Date.now()) } catch { return null }
}
type ReconciledShift = ShiftResponseRow & {
  reconciliation: ShiftReconciliation | null
  figures?: ShiftFigures | null
}
async function reconciledShift(env: Env, user: SessionUser, row: ShiftDbRow): Promise<ReconciledShift> {
  const shift = responseShift(user, row)
  const [reconciliation, figures] = await Promise.all([
    reconciliationFor(env, user, shift),
    figuresFor(env, user, shift),
  ])
  return { ...shift, reconciliation, figures }
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
  // The carry-over is a BANNER, not a report: no reconciliation and no figures
  // on it, for the same reason /current carries none (see figuresFor).
  //
  // Read for the exempt administrator too (see readPreviousOpen): `shift`,
  // needs_registration and everything else currentResponse answers are
  // unchanged for them -- none of that reads the carry-over -- but the one
  // account that may close a foreign shop-wide stale row can now see it.
  const carryOver = await readPreviousOpen(db, policy, user.id, requestedBranchId)
  // The CLOSE BOUND for that row, from the very query the close is validated
  // against: intervalError refuses a closing time later than the opening of
  // the next segment, and readAdjacentShift(..., 'next') is how it finds that
  // segment. The client used to guess the bound from today's opening, which is
  // wrong whenever another stale day sits in between -- the guess came back
  // 409. Null means nothing opened after this row, so any time up to now is
  // accepted. Reusing the one helper is what keeps the two from disagreeing.
  const closeBefore = carryOver ? await readAdjacentShift(db, carryOver, carryOver.opened_at, 'next') : null
  const body = currentResponse(user, shift, policy, exempt)
  // Admin comparison may include an open shift. Staff retain only registered
  // counts; no report calculation is needed to enter or close their drawer.
  const presented = body.shift ? { ...body.shift, reconciliation: await reconciliationFor(c.env, user, body.shift) } : null
  return c.json({ ...body, shift: presented,
    previous_open_shift: carryOver ? responseShift(user, carryOver) : null,
    previous_open_close_before: closeBefore?.opened_at ?? null })
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
  const from = c.req.query('from') || null
  const to = c.req.query('to') || null
  const validDate = (value: string | null) => {
    if (value == null) return true
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const date = new Date(`${value}T00:00:00.000Z`)
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  }
  if (!validDate(from) || !validDate(to) || (from != null && to != null && from > to)) {
    return c.json({ error: 'Invalid shift business date range.' }, 400)
  }
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50))
  const paged = c.req.query('page') != null || c.req.query('page_size') != null
  const page = Number(c.req.query('page') ?? 1)
  const pageSize = Number(c.req.query('page_size') ?? 20)
  if (paged && (!/^\d+$/.test(c.req.query('page') ?? '1') || !/^\d+$/.test(c.req.query('page_size') ?? '20') || !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 200 || !Number.isSafeInteger((page - 1) * pageSize))) {
    return c.json({ error: 'Invalid shift pagination.' }, 400)
  }
  const visibility = shiftVisibility(user, await readShiftPolicy(db))
  // ---- ONE ROW PER SHIFT RECORD (owner ruling, Sep 14 2026) --------------
  //
  // "each shift have record shown one row last row of each record". Reopening
  // a shift, and replacing a cancelled one, writes a CONTINUATION row
  // (migration 0123) rather than mutating the segment it continues, so the
  // same working shift used to list two, three or four times -- once per
  // segment -- with the older rows carrying superseded figures.
  //
  // A segment that has been continued is therefore not listed: the row that
  // remains is the LAST one of the lineage, which carries the current values,
  // and `parent_shift_id` on it leads to the rest of the chain (the detail
  // read returns every segment, and the float prints them in order).
  //
  // Filtered in SQL rather than after the read so `LIMIT` still counts rows
  // the caller will actually see; an open shift can never have a continuation
  // (only a closed or cancelled one can be continued), so the same clause is
  // safe on both halves.
  const filters = `${visibility.clause}
      AND NOT EXISTS (SELECT 1 FROM shift_sessions later WHERE later.parent_shift_id = shift_sessions.id)
      AND (@requestedUserId IS NULL OR user_id = @requestedUserId)
      AND (@branchId IS NULL OR branch_id = @branchId)
      AND (branch_id IS NULL OR EXISTS (SELECT 1 FROM branches b WHERE b.id=shift_sessions.branch_id AND b.is_active=1))
      AND (@from IS NULL OR business_date >= @from) AND (@to IS NULL OR business_date <= @to)`
  const params = { ...visibility.params, requestedUserId, branchId, from, to, limit }
  if (paged) {
    // One statement gives count, clamping and page rows the same SQLite read
    // snapshot. The LEFT JOIN retains metadata even for an empty match set.
    const rows = await db.prepare(`WITH matched AS (
      SELECT id, business_date, opened_at,
        CASE WHEN closed_at IS NULL AND cancelled_at IS NULL THEN 0 ELSE 1 END AS open_order
      FROM shift_sessions WHERE ${filters}
    ), metadata AS (
      SELECT COUNT(*) AS total, MIN(@page, MAX(1, CAST((COUNT(*) + @pageSize - 1) / @pageSize AS INTEGER))) AS effective_page FROM matched
    ), page_ids AS (
      SELECT id FROM matched ORDER BY open_order, business_date DESC, opened_at DESC, id DESC
      LIMIT @pageSize OFFSET (SELECT (effective_page - 1) * @pageSize FROM metadata)
    ), page_rows AS (
      SELECT ${SHIFT_COLUMNS} FROM shift_sessions WHERE id IN (SELECT id FROM page_ids)
    )
    SELECT page_rows.*, metadata.total AS pagination_total, metadata.effective_page AS pagination_page
      FROM metadata LEFT JOIN page_rows ON 1 = 1
      ORDER BY CASE WHEN page_rows.closed_at IS NULL AND page_rows.cancelled_at IS NULL THEN 0 ELSE 1 END,
        page_rows.business_date DESC, page_rows.opened_at DESC, page_rows.id DESC
    `).all<ShiftDbRow & { pagination_total: number; pagination_page: number }>({ ...params, page, pageSize })
    const total = Number(rows[0].pagination_total)
    const effectivePage = Number(rows[0].pagination_page)
    const shifts = rows.filter((row) => row.id != null).map(({ pagination_total: _total, pagination_page: _page, ...shift }) => responseShift(user, shift))
    return c.json({ shifts, scope: visibility.scope,
      page: effectivePage, page_size: pageSize, total, has_more: effectivePage * pageSize < total })
  }
  const [openShifts, closedShifts] = await Promise.all([
    db.prepare(`SELECT ${SHIFT_COLUMNS} FROM shift_sessions WHERE ${filters} AND closed_at IS NULL AND cancelled_at IS NULL
      ORDER BY business_date DESC, opened_at DESC, id DESC`).all<ShiftDbRow>(params),
    db.prepare(`SELECT ${SHIFT_COLUMNS} FROM shift_sessions WHERE ${filters} AND (closed_at IS NOT NULL OR cancelled_at IS NOT NULL)
      ORDER BY business_date DESC, opened_at DESC, id DESC LIMIT @limit`).all<ShiftDbRow>(params),
  ])
  return c.json({ shifts: [...openShifts, ...closedShifts].map((shift) => responseShift(user, shift)), scope: visibility.scope })
})

app.get('/:id/history', async (c) => {
  const user = c.get('user'); const denied = shiftPermissionError(c, user); if (denied) return denied
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid shift id.' }, 400)
  const db = getDb(c.env); const shift = await readShiftById(db, id)
  if (!shift) return c.json({ error: 'Shift not found.' }, 404)
  if (shift.branch_id != null && !(await resolveBranch(db, shift.branch_id))) return c.json({ error: 'Shift not found.' }, 404)
  // 404, not 403: a caller who may not see this shift must not learn that it
  // exists, which id probing would otherwise reveal one status code at a time.
  if (!canSeeShift(user, await readShiftPolicy(db), shift)) return c.json({ error: 'Shift not found.' }, 404)
  // The whole RECORD, not the one segment. The list shows a reopened shift as
  // a single row, so its detail has to carry what that row stands for: every
  // segment oldest first, and every amendment of every segment on one
  // timeline. Each amendment names its own `shift_session_id`, so the float
  // can print them against the segment they corrected.
  const segments = await readLineage(db, shift)
  const ids = segments.map((segment) => segment.id)
  // sql-bound-params: bounded by construction -- readLineage returns at most
  // MAX_SHIFT_SEGMENTS (20) rows, so this placeholder list can never approach
  // D1's 100-parameter limit and needs no chunking.
  const idParams = Object.fromEntries(ids.map((value, index) => [`id${index}`, value]))
  const amendments = await db.prepare(`SELECT id, shift_session_id, actor_user_id, actor_name, reason,
    before_json, after_json, created_at FROM shift_session_amendments
    WHERE shift_session_id IN (${ids.map((_value, index) => `@id${index}`).join(',')})
    ORDER BY created_at ASC, id ASC`).all(idParams)
  return c.json({
    shift: await reconciledShift(c.env, user, shift),
    segments: segments.map((segment) => responseShift(user, segment)),
    amendments,
  })
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
  const floatUsdParsed = countedMoney(body.opening_float_usd); const floatKhrParsed = countedMoney(body.opening_float_khr)
  if (!floatUsdParsed.ok || !floatKhrParsed.ok) return c.json({ error: 'Opening cash counts must be finite, non-negative numbers or blank.' }, 400)
  const floatUsd = floatUsdParsed.value; const floatKhr = floatKhrParsed.value
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
    floatUsd, floatKhr, storedFloatUsd: floatUsd ?? 0, storedFloatKhr: floatKhr ?? 0,
    floatUsdRegistered: floatUsd == null ? 0 : 1, floatKhrRegistered: floatKhr == null ? 0 : 1,
    note: optionalText(body.opening_note), deviceName: c.req.header('X-Device-Name') || null }
  try {
    const results = await db.batch([
      { sql: `INSERT INTO shift_sessions (shift_code, scope_mode, user_id, user_name, branch_id,
      branch_name, business_date, opened_at, opening_float_usd, opening_float_khr,
      opening_float_usd_registered, opening_float_khr_registered, opening_note, opened_device_name)
      VALUES (@shiftCode,@scopeMode,@userId,@userName,@branchId,@branchName,date(@openedAt,'${BUSINESS_TZ_FORWARD}'),
      @openedAt,@storedFloatUsd,@storedFloatKhr,@floatUsdRegistered,@floatKhrRegistered,@note,@deviceName)`, params: row },
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
  closedAt: string; recordedAt: string; countedUsd: number | null; countedKhr: number | null
  additionalUsd: number; additionalKhr: number
  note: string | null; deviceName: string | null; reason: string
  request?: ReturnType<typeof mutationRequest>
}): Promise<{ changed: boolean; shift: ShiftDbRow | undefined }> {
  const shift = storedShift(row)
  const after = { ...shift, closed_at: input.closedAt, closing_counted_usd: input.countedUsd,
    closing_counted_khr: input.countedKhr, additional_cash_usd: input.additionalUsd, additional_cash_khr: input.additionalKhr,
    closing_note: input.note, closed_by_user_id: user.id,
    closed_by_user_name: displayName(user), revision: shift.revision + 1 }
  const actorName = displayName(user)
  const results = await db.batch([
    { sql: `UPDATE shift_sessions SET closed_at=@closedAt, closing_counted_usd=@countedUsd,
        closing_counted_khr=@countedKhr, additional_cash_usd=@additionalUsd, additional_cash_khr=@additionalKhr,
        closing_note=@note, closed_device_name=@deviceName,
        closed_by_user_id=@closerId, closed_by_user_name=@closerName, revision=revision+1, updated_at=@recordedAt
        WHERE id=@id AND revision=@revision AND closed_at IS NULL`,
      params: { id: shift.id, revision: shift.revision, closedAt: input.closedAt, countedUsd: input.countedUsd,
        countedKhr: input.countedKhr, additionalUsd: input.additionalUsd, additionalKhr: input.additionalKhr,
        note: input.note, deviceName: input.deviceName,
        closerId: user.id, closerName: actorName, recordedAt: input.recordedAt } },
    { sql: `INSERT INTO shift_session_amendments (shift_session_id,actor_user_id,actor_name,reason,before_json,after_json,created_at)
        SELECT @id,@actorId,@actorName,@reason,@beforeJson,@afterJson,@createdAt FROM shift_sessions
        WHERE changes()=1 AND id=@id AND revision=@newRevision`,
      params: { id: shift.id, actorId: user.id, actorName, reason: input.reason, beforeJson: JSON.stringify(shift),
        afterJson: JSON.stringify(after), createdAt: input.recordedAt, newRevision: after.revision } },
    { sql: transitionAuditSql(), params: { actorId: user.id, actorName, action: 'shift.close', shiftId: shift.id,
        details: JSON.stringify({ reason: input.reason, revision: after.revision, request: input.request }), oldValue: JSON.stringify(shift),
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
  const shift = await readShiftById(db, Number(body.shift_id))
  if (!shift) return c.json({ error: 'Shift not found.' }, 404)
  if (body.branch_id != null && shift.branch_id !== branchId) return c.json({ error: 'Shift branch does not match the requested branch.' }, 400)
  if (shift.cancelled_at) return c.json({ error: 'This shift was cancelled. Register a replacement opening first.' }, 409)
  if (!canMutateShift(user, shift)) return c.json({ error: 'Only the shift owner or an administrator can close this shift.' }, 403)
  if (shift.revision !== Number(body.expected_revision) || shift.closed_at) return c.json({ error: 'Shift changed concurrently. Reload and try again.' }, 409)
  // Blank is "not counted", not a refusal -- see countedMoney.
  const countedUsd = countedMoney(body.closing_counted_usd); const countedKhr = countedMoney(body.closing_counted_khr)
  if (!countedUsd.ok || !countedKhr.ok) return c.json({ error: 'Closing counts must be 0 or more, or left blank.' }, 400)
  const additionalUsd = additionalMoney(body.additional_cash_usd); const additionalKhr = additionalMoney(body.additional_cash_khr)
  if (!additionalUsd.ok || !additionalKhr.ok) return c.json({ error: 'Additional change used must be 0 or more, or left blank.' }, 400)
  const closedAt = new Date().toISOString()
  const overlap = await intervalError(db, storedShift(shift), shift.opened_at, closedAt)
  if (overlap) return c.json({ error: overlap }, 409)
  const result = await writeClose(db, user, shift, { closedAt, recordedAt: closedAt,
    countedUsd: countedUsd.value, countedKhr: countedKhr.value,
    additionalUsd: additionalUsd.value, additionalKhr: additionalKhr.value,
    note: optionalText(body.closing_note), deviceName: c.req.header('X-Device-Name') || null, reason: 'Manual shift close', request: mutationRequest(body, shift.id) })
  if (result.changed) {
    const report = sendTelegramShiftReport(c.env, shift.id)
    try { c.executionCtx.waitUntil(report) } catch { void report }
    return c.json({ shift: result.shift ? await reconciledShift(c.env, user, result.shift) : null, already_closed: false, is_open: false }, 200)
  }
  return c.json({ error: 'Shift changed concurrently. Reload and try again.' }, 409)
})

app.post('/:id/close', async (c) => {
  const user = c.get('user'); const denied = shiftPermissionError(c, user); if (denied) return denied
  const id = Number(c.req.param('id')); if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid shift id.' }, 400)
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const expectedRevision = Number(body.expected_revision)
  if (body.expected_revision == null || !Number.isInteger(expectedRevision) || expectedRevision < 0) return c.json({ error: 'A valid expected revision is required.' }, 400)
  const now = Date.now()
  // Absent closed_at is the live POS close: the server stamps the moment.
  const parsedClosedAt = body.closed_at == null || body.closed_at === '' ? new Date(now)
    : typeof body.closed_at === 'string' ? new Date(body.closed_at) : new Date(Number.NaN)
  if (Number.isNaN(parsedClosedAt.getTime())) return c.json({ error: 'A valid closing time is required.' }, 400)
  const closedAtMs = withinServerClock(parsedClosedAt.getTime(), now)
  if (closedAtMs == null) return c.json({ error: 'Closing time cannot be in the future.' }, 400)
  const closedAt = new Date(closedAtMs).toISOString()
  const countedUsd = countedMoney(body.closing_counted_usd); const countedKhr = countedMoney(body.closing_counted_khr)
  if (!countedUsd.ok || !countedKhr.ok) return c.json({ error: 'Closing counts must be 0 or more, or left blank.' }, 400)
  const additionalUsd = additionalMoney(body.additional_cash_usd); const additionalKhr = additionalMoney(body.additional_cash_khr)
  if (!additionalUsd.ok || !additionalKhr.ok) return c.json({ error: 'Additional change used must be 0 or more, or left blank.' }, 400)
  const db = getDb(c.env); const shift = await readShiftById(db, id)
  if (!shift) return c.json({ error: 'Shift not found.' }, 404)
  if (shift.branch_id != null && !(await resolveBranch(db, shift.branch_id))) return c.json({ error: 'Shift not found.' }, 404)
  if (!canMutateShift(user, shift)) return c.json({ error: 'Only the shift owner or an administrator can close this shift.' }, 403)
  if (shift.cancelled_at) return c.json({ error: 'A cancelled shift cannot be closed.' }, 409)
  if (shift.closed_at) return c.json({ error: 'Shift is already closed.' }, 409)
  if (expectedRevision !== shift.revision) return c.json({ error: 'Shift changed concurrently. Reload and try again.' }, 409)
  if (closedAtMs < utcMs(shift.opened_at)) return c.json({ error: 'Closing time cannot be before opening time.' }, 400)
  const overlap = await intervalError(db, storedShift(shift), shift.opened_at, closedAt)
  if (overlap) return c.json({ error: overlap }, 409)
  const result = await writeClose(db, user, shift, { closedAt, recordedAt: new Date().toISOString(),
    countedUsd: countedUsd.value, countedKhr: countedKhr.value,
    additionalUsd: additionalUsd.value, additionalKhr: additionalKhr.value,
    note: optionalText(body.closing_note), deviceName: c.req.header('X-Device-Name') || null, reason: 'Historic manual close', request: mutationRequest(body, id) })
  if (!result.changed || !result.shift) return c.json({ error: 'Shift changed concurrently. Reload and try again.' }, 409)
  const report = sendTelegramShiftReport(c.env, shift.id)
  try { c.executionCtx.waitUntil(report) } catch { void report }
  return c.json({ shift: await reconciledShift(c.env, user, result.shift), already_closed: false, is_open: false }, 200)
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
      details: JSON.stringify({ reason, revision: after.revision, request: mutationRequest(body, id) }), oldValue: JSON.stringify(beforeStored),
      newValue: JSON.stringify(after), deviceName: c.req.header('X-Device-Name') || null } },
  ])
  if (batchChanges(results[0]) !== 1) return c.json({ error: 'Shift changed concurrently. Reload and try again.' }, 409)
  const cancelled = await readShiftById(db, id)
  if (!cancelled) return c.json({ error: 'Cancelled shift could not be read back.' }, 500)
  const report = sendTelegramShiftReport(c.env, cancelled.id)
  try { c.executionCtx.waitUntil(report) } catch { void report }
  return c.json({ shift: responseShift(user, cancelled), cancelled: true }, 200)
})

app.post('/:id/reopen', async (c) => {
  const user = c.get('user'); const denied = shiftPermissionError(c, user); if (denied) return denied
  const id = Number(c.req.param('id')); if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid shift id.' }, 400)
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const expectedRevision = Number(body.expected_revision); const reason = requiredReason(body.reason)
  if (body.expected_revision == null || !Number.isInteger(expectedRevision) || expectedRevision < 0) return c.json({ error: 'A valid expected revision is required.' }, 400)
  if (!reason) return c.json({ error: 'A reopen reason is required.' }, 400)
  const floatUsdParsed = countedMoney(body.opening_float_usd); const floatKhrParsed = countedMoney(body.opening_float_khr)
  if (!floatUsdParsed.ok || !floatKhrParsed.ok) return c.json({ error: 'Opening cash counts must be finite, non-negative numbers or blank.' }, 400)
  const floatUsd = floatUsdParsed.value; const floatKhr = floatKhrParsed.value
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
    afterCancellation: false, auditAction: 'shift.reopen', request: mutationRequest(body, id) })
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
  const expectedRevision = Number(body.expected_revision)
  if (body.expected_revision == null || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return c.json({ error: 'A valid expected revision is required.' }, 400)
  }
  if (!reason) return c.json({ error: 'A reason is required.' }, 400)
  const db = getDb(c.env); const before = await readShiftById(db, id)
  if (!before) return c.json({ error: 'Shift not found.' }, 404)
  if (before.branch_id != null && !(await resolveBranch(db, before.branch_id))) return c.json({ error: 'Shift not found.' }, 404)
  if (before.cancelled_at) return c.json({ error: 'A cancelled shift cannot be amended.' }, 409)
  if (!canAmendShift(user, before)) return c.json({ error: 'Shift permission is required to amend this shift.' }, 403)
  if (before.revision !== expectedRevision) return c.json({ error: 'Shift changed concurrently. Reload and try again.' }, 409)
  const iso = (key: string, fallback: string | null) => {
    if (!(key in body)) return fallback
    if (body[key] == null || body[key] === '') return null
    const parsed = new Date(String(body[key])); return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
  }
  const requestedOpenedAt = iso('opened_at', before.opened_at); const requestedClosedAt = iso('closed_at', before.closed_at)
  if (!requestedOpenedAt || requestedClosedAt === undefined) return c.json({ error: 'Invalid shift timestamp.' }, 400)
  const now = Date.now()
  const openedMs = withinServerClock(utcMs(requestedOpenedAt), now)
  const closedMs = requestedClosedAt ? withinServerClock(utcMs(requestedClosedAt), now) : null
  if (openedMs == null || (requestedClosedAt && closedMs == null)) return c.json({ error: 'Shift time cannot be in the future.' }, 400)
  // Only a time the caller actually sent is re-stamped. An untouched
  // timestamp passes through verbatim: rewriting it would register a change
  // the operator never made, and readAdjacentShift compares the stored text.
  const openedAt = 'opened_at' in body ? new Date(openedMs).toISOString() : requestedOpenedAt
  const closedAt = closedMs == null ? null : 'closed_at' in body ? new Date(closedMs).toISOString() : requestedClosedAt
  if (businessDateFor(openedAt) !== before.business_date) return c.json({ error: 'Opening time must remain within the shift business date.' }, 400)
  if (before.closed_at && !closedAt) return c.json({ error: 'Closed shifts cannot be reopened.' }, 400)
  if (!before.closed_at && closedAt) return c.json({ error: 'Open shifts must be closed through the close action.' }, 400)
  if (closedAt && utcMs(closedAt) < utcMs(openedAt)) return c.json({ error: 'Closing time cannot be before opening time.' }, 400)
  const openingUsdParsed = 'opening_float_usd' in body
    ? countedMoney(body.opening_float_usd) : { ok: true as const, value: before.opening_float_usd }
  const openingKhrParsed = 'opening_float_khr' in body
    ? countedMoney(body.opening_float_khr) : { ok: true as const, value: before.opening_float_khr }
  const additionalUsdParsed = 'additional_cash_usd' in body
    ? additionalMoney(body.additional_cash_usd) : { ok: true as const, value: before.additional_cash_usd ?? 0 }
  const additionalKhrParsed = 'additional_cash_khr' in body
    ? additionalMoney(body.additional_cash_khr) : { ok: true as const, value: before.additional_cash_khr ?? 0 }
  // The counted drawer stays OPTIONAL after the close, exactly as it is at the
  // close itself: a shift that was ended without a count must still be
  // amendable (opening time, notes, the closing timestamp), and requiring the
  // count here would have made every such row permanently unamendable.
  const closingUsdParsed = closedAt && 'closing_counted_usd' in body
    ? countedMoney(body.closing_counted_usd) : { ok: true as const, value: before.closing_counted_usd }
  const closingKhrParsed = closedAt && 'closing_counted_khr' in body
    ? countedMoney(body.closing_counted_khr) : { ok: true as const, value: before.closing_counted_khr }
  if (!openingUsdParsed.ok || !openingKhrParsed.ok || !additionalUsdParsed.ok || !additionalKhrParsed.ok || !closingUsdParsed.ok || !closingKhrParsed.ok) {
    return c.json({ error: 'Shift cash counts must be finite, non-negative numbers.' }, 400)
  }
  const openingUsd = openingUsdParsed.value; const openingKhr = openingKhrParsed.value
  const additionalUsd = additionalUsdParsed.value; const additionalKhr = additionalKhrParsed.value
  const closingUsd = closingUsdParsed.value; const closingKhr = closingKhrParsed.value
  const beforeStored = storedShift(before)
  const after = { ...beforeStored, opened_at: openedAt,
    opening_float_usd: openingUsd, opening_float_khr: openingKhr,
    additional_cash_usd: additionalUsd, additional_cash_khr: additionalKhr,
    opening_note: 'opening_note' in body ? optionalText(body.opening_note) : before.opening_note,
    closed_at: closedAt,
    closing_counted_usd: closedAt ? closingUsd : null,
    closing_counted_khr: closedAt ? closingKhr : null,
    closing_note: closedAt ? ('closing_note' in body ? optionalText(body.closing_note) : before.closing_note) : null,
    revision: before.revision + 1 }
  if (before.parent_shift_id != null) {
    const parent = await readShiftById(db, before.parent_shift_id)
    const parentTerminatedAt = parent?.cancelled_at ?? parent?.closed_at
    if (!parentTerminatedAt || utcMs(openedAt) < utcMs(parentTerminatedAt)) {
      return c.json({ error: 'Opening time cannot be before the parent shift ended.' }, 400)
    }
  }
  if (before.has_reopened_child) {
    const child = await readChild(db, before.id)
    if (!closedAt || (child && utcMs(closedAt) > utcMs(child.opened_at))) {
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
    { sql: `UPDATE shift_sessions SET opened_at=@openedAt,
        opening_float_usd=@storedOpeningUsd, opening_float_khr=@storedOpeningKhr,
        opening_float_usd_registered=@openingUsdRegistered, opening_float_khr_registered=@openingKhrRegistered,
        opening_note=@openingNote, additional_cash_usd=@additionalUsd, additional_cash_khr=@additionalKhr,
        closed_at=@closedAt, closing_counted_usd=@closingUsd, closing_counted_khr=@closingKhr,
        closing_note=@closingNote, revision=revision+1, updated_at=@updatedAt WHERE id=@id AND revision=@revision`,
      params: { id, revision: expectedRevision, openedAt: after.opened_at,
        storedOpeningUsd: after.opening_float_usd ?? 0, storedOpeningKhr: after.opening_float_khr ?? 0,
        openingUsdRegistered: after.opening_float_usd == null ? 0 : 1,
        openingKhrRegistered: after.opening_float_khr == null ? 0 : 1,
        openingNote: after.opening_note, additionalUsd: after.additional_cash_usd, additionalKhr: after.additional_cash_khr,
        closedAt: after.closed_at,
        closingUsd: after.closing_counted_usd, closingKhr: after.closing_counted_khr, closingNote: after.closing_note, updatedAt: nowIso } },
    { sql: `INSERT INTO shift_session_amendments (shift_session_id, actor_user_id, actor_name, reason, before_json, after_json, created_at)
        SELECT @id,@actorId,@actorName,@reason,@beforeJson,@afterJson,@createdAt FROM shift_sessions
        WHERE changes()=1 AND id=@id AND revision=@newRevision`,
      params: { id, actorId: user.id, actorName, reason, beforeJson: JSON.stringify(beforeStored),
        afterJson: JSON.stringify(after), createdAt: nowIso, newRevision: after.revision } },
    { sql: transitionAuditSql(), params: { actorId: user.id, actorName, action: 'shift.amend', shiftId: id,
        details: JSON.stringify({ reason, revision: after.revision, request: mutationRequest(body, id) }), oldValue: JSON.stringify(beforeStored),
        newValue: JSON.stringify(after), deviceName: c.req.header('X-Device-Name') || null } },
  ])
  const changed = batchChanges(results[0])
  if (changed !== 1) return c.json({ error: 'Shift changed concurrently. Reload and try again.' }, 409)
  const saved = await readShiftById(db, id)
  if (!saved || saved.revision !== after.revision) return c.json({ error: 'Shift changed concurrently. Reload and try again.' }, 409)
  const report = sendTelegramShiftReport(c.env, saved.id)
  try { c.executionCtx.waitUntil(report) } catch { void report }
  return c.json({ shift: responseShift(user, saved) }, 200)
})

export default app
