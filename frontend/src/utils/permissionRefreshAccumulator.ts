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
}

export function createPermissionRefreshAccumulator(): PermissionRefreshAccumulator {
  return { pending: false, running: false }
}

export function eventNeedsPermissionRefresh(
  detail: PermissionRefreshEvent,
  subject: PermissionRefreshSubject,
): boolean {
  const channel = String(detail?.channel || '')
  if (channel === 'runtime') return true
  if (channel !== 'users' && channel !== 'roles') return false

  const payloadId = detail?.payload?.id
  // Foreground and explicit whole-app refreshes intentionally omit a row id.
  // With no id there is no safe way to prove the current user is unaffected,
  // so refresh the session once for the whole burst. A cache revalidation is
  // different: it only says the users/roles list cache changed and carries no
  // evidence that permissions changed.
  if (payloadId == null) return detail.reason !== 'cache-refresh'

  const currentId = channel === 'users' ? subject.userId : subject.roleId
  return currentId != null && String(payloadId) === String(currentId)
}

export function notePermissionRefreshIntent(
  accumulator: PermissionRefreshAccumulator,
  detail: PermissionRefreshEvent,
  subject: PermissionRefreshSubject,
): boolean {
  const needed = eventNeedsPermissionRefresh(detail, subject)
  if (needed) accumulator.pending = true
  return needed
}

export function beginPermissionRefresh(accumulator: PermissionRefreshAccumulator): boolean {
  if (accumulator.running || !accumulator.pending) return false
  accumulator.pending = false
  accumulator.running = true
  return true
}

export function finishPermissionRefresh(accumulator: PermissionRefreshAccumulator): boolean {
  accumulator.running = false
  return accumulator.pending
}

export function resetPermissionRefreshAccumulator(accumulator: PermissionRefreshAccumulator): void {
  accumulator.pending = false
  accumulator.running = false
}
