import { getDb } from './db'
import { audit } from './audit'
import { actorSnapshot } from './actorSnapshot'

// The two checks a route that wipes, rolls back or releases data asks for after
// its own permission gate: the built-in default admin account, and the caller's
// current password. Both leave a step_up_refused audit row when they refuse.
//   - denyUnlessDefaultAdmin: routes/system.ts (resets, finalize, orphan
//     cleanup, factory reset) and routes/backups.ts (restore).
//   - denyUnlessCurrentPassword: those two, plus routes/system.ts (integrity
//     repair), routes/backups.ts (forced maintenance clear),
//     routes/compat.ts (audit-log purge) and routes/settings.ts (audit-log
//     retention).
//   - denyUnlessRepairPermission: routes/system.ts (integrity repair), which
//     rewrites stock and sale statuses and so needs the Restore permission; the
//     route passes whether the caller holds it, so this refusal is audited and
//     coded like the others.

export async function denyUnlessDefaultAdmin(c: any, action: 'reset' | 'restore' = 'reset') {
  const actorId = Number(c.get('user')?.id)
  const account = Number.isSafeInteger(actorId) && actorId > 0
    ? await getDb(c.env).prepare(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = @id AND lower(trim(u.username)) = 'admin' AND u.is_active = 1
          AND u.deleted_at IS NULL AND r.code = 'admin' AND r.is_system = 1`)
      .get<{ id: number }>({ id: actorId })
    : null
  if (account) return null
  if (action === 'restore') {
    return refuse(c, 403, 'restore_builtin_admin_only', 'Only the active built-in default admin account can restore a backup. No data was changed.')
  }
  return refuse(c, 403, 'reset_builtin_admin_only', 'Only the active built-in default admin account can reset data.')
}

// The English is the language pack's, word for word (pinned by frontend tests/branchRefusalLanguage.test.ts); the code is the pack key.
export const REPAIR_INTEGRITY_PERMISSION_CODE = 'repair_integrity_restore_permission_required'
export const REPAIR_INTEGRITY_PERMISSION_ERROR = 'Repairing data needs the Backup restore and reset permission. No data was changed.'

export async function denyUnlessRepairPermission(c: any, allowed: boolean) {
  if (allowed) return null
  return refuse(c, 403, REPAIR_INTEGRITY_PERMISSION_CODE, REPAIR_INTEGRITY_PERMISSION_ERROR)
}

async function refuse(c: any, status: number, code: string, error: string, extra: Record<string, unknown> = {}) {
  const user = c.get('user')
  await audit(c.env, Number(user?.id) || null, actorSnapshot(user), 'step_up_refused', 'system', c.req.path, { route: c.req.path, reason: code })
  return c.json({ success: false, error, code, ...extra }, status)
}

// The caller's current password, checked through the shared rate-limited guard
// that profile saves and Google unlink use, so an unattended or hijacked
// session cannot wipe data on its own. Runs after the cheap validation and
// before any backup or delete, so a refusal changes nothing; every refusal
// leaves an audit row naming the actor, the route and the reason, never the
// password. factory-reset answers a refusal with 400 (its pinned contract) and
// the other routes with 403; never 401, which the client reads as a dead session.
export async function denyUnlessCurrentPassword(c: any, body: { currentPassword?: unknown }, refusalStatus: 400 | 403) {
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
  if (!currentPassword) {
    return refuse(c, refusalStatus, 'current_password_required', 'Enter your current password to confirm. No data was changed.')
  }
  const actorId = Number(c.get('user')?.id || 0)
  const account = actorId
    ? await getDb(c.env).prepare('SELECT password FROM users WHERE id = @id AND deleted_at IS NULL').get<{ password: string | null }>({ id: actorId })
    : null
  if (!account) return c.json({ error: 'Please sign in again to continue.' }, 403)
  const guard = await import('./currentPasswordGuard')
  const verdict = await guard.verifyCurrentPassword(c, { actorId, targetId: actorId }, currentPassword, String(account.password || ''))
  if (!verdict.ok && verdict.rateLimited) {
    return refuse(c, 429, 'current_password_rate_limited', guard.CURRENT_PASSWORD_RATE_LIMITED_ERROR, { retryAfterSeconds: verdict.retryAfterSeconds })
  }
  if (!verdict.ok) return refuse(c, refusalStatus, 'incorrect_password', 'Current password is incorrect. No data was changed.')
  return null
}
