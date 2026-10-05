export type PermissionRefreshEvent = {
  channel?: string | null
  reason?: string | null
  source?: string | null
  payload?: { id?: string | number | null } | null
}

export type PermissionRefreshSubject = {
  userId?: string | number | null
  roleId?: string | number | null
}

export type PermissionRefreshAccumulator = {
  pending: boolean
  running: boolean
  // True while every queued intent only asks to verify (read bootstrap and
  // compare); one full-refresh intent clears it for the whole burst.
  verifyOnly: boolean
  // What the refresh that beginPermissionRefresh just started must do.
  activeVerifyOnly: boolean
}

export type PermissionRefreshIntent = 'none' | 'verify' | 'refresh'

// web-api.ts tags its own tab-resume refresh with these reasons. The socket
// either stayed open while the tab was hidden (every users/roles push was
// delivered, so nothing to check) or dropped (a push may be missing, so the
// session is verified against one bootstrap read).
export const FOREGROUND_RESUME_REASON = 'foreground-resume'
export const FOREGROUND_RESUME_GAP_REASON = 'foreground-resume-gap'

export function isForegroundResumeReason(reason: unknown): boolean {
  return reason === FOREGROUND_RESUME_REASON || reason === FOREGROUND_RESUME_GAP_REASON
}

export function createPermissionRefreshAccumulator(): PermissionRefreshAccumulator {
  return { pending: false, running: false, verifyOnly: false, activeVerifyOnly: false }
}

export function permissionRefreshIntent(
  detail: PermissionRefreshEvent,
  subject: PermissionRefreshSubject,
): PermissionRefreshIntent {
  const channel = String(detail?.channel || '')
  if (channel === 'runtime') return 'refresh'
  if (channel !== 'users' && channel !== 'roles') return 'none'

  const payloadId = detail?.payload?.id
  if (payloadId == null) {
    // A cache revalidation only says the users/roles list cache changed.
    if (detail.reason === 'cache-refresh') return 'none'
    if (detail.reason === FOREGROUND_RESUME_REASON) return 'none'
    if (detail.reason === FOREGROUND_RESUME_GAP_REASON) return 'verify'
    // Any other id-less users/roles event (reconnect after an outage, an
    // explicit whole-app refresh) cannot prove this session is unaffected:
    // refresh once for the burst.
    return 'refresh'
  }

  const currentId = channel === 'users' ? subject.userId : subject.roleId
  return currentId != null && String(payloadId) === String(currentId) ? 'refresh' : 'none'
}

export function eventNeedsPermissionRefresh(
  detail: PermissionRefreshEvent,
  subject: PermissionRefreshSubject,
): boolean {
  return permissionRefreshIntent(detail, subject) !== 'none'
}

export function notePermissionRefreshIntent(
  accumulator: PermissionRefreshAccumulator,
  detail: PermissionRefreshEvent,
  subject: PermissionRefreshSubject,
): boolean {
  const intent = permissionRefreshIntent(detail, subject)
  if (intent === 'none') return false
  if (intent === 'refresh') {
    accumulator.verifyOnly = false
  } else if (!accumulator.pending) {
    accumulator.verifyOnly = true
  }
  accumulator.pending = true
  return true
}

// Queues a full refresh after a verification read found a different session.
export function escalatePermissionRefresh(accumulator: PermissionRefreshAccumulator): void {
  accumulator.pending = true
  accumulator.verifyOnly = false
}

export function beginPermissionRefresh(accumulator: PermissionRefreshAccumulator): boolean {
  if (accumulator.running || !accumulator.pending) return false
  accumulator.activeVerifyOnly = accumulator.verifyOnly
  accumulator.pending = false
  accumulator.verifyOnly = false
  accumulator.running = true
  return true
}

export function finishPermissionRefresh(accumulator: PermissionRefreshAccumulator): boolean {
  accumulator.running = false
  accumulator.activeVerifyOnly = false
  return accumulator.pending
}

const PERMISSION_SNAPSHOT_FIELDS = [
  'id',
  'organization_id',
  'role_id',
  'role_code',
  'role_name',
  'permissions',
  'role_permissions',
  'is_active',
  'must_change_password',
] as const

// The authority-bearing part of a session user, as GET /api/auth/bootstrap
// returns it. Two users with the same key grant the same access.
export function permissionSnapshotKey(user: unknown): string {
  const record = (user && typeof user === 'object' ? user : {}) as Record<string, unknown>
  return JSON.stringify(PERMISSION_SNAPSHOT_FIELDS.map((field) => {
    const value = record[field]
    if (value == null) return null
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  }))
}
