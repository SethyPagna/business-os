export const SYNC_ERROR_RESOLVED_EVENT = 'sync:error-resolved'

export type SyncProblemReference = {
  errorId?: string | null
  channel?: string | null
  code?: string | null
}

let fallbackErrorSequence = 0

export function createSyncErrorId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  fallbackErrorSequence += 1
  return `sync-error-${Date.now()}-${fallbackErrorSequence}`
}

function normalizedReference(value: SyncProblemReference | null | undefined): Required<SyncProblemReference> | null {
  const errorId = String(value?.errorId || '').trim()
  const channel = String(value?.channel || '').trim()
  const code = String(value?.code || '').trim()
  return errorId && channel && code ? { errorId, channel, code } : null
}

export function shouldClearResolvedSyncError(
  current: SyncProblemReference | null | undefined,
  resolved: SyncProblemReference | null | undefined,
): boolean {
  const currentRef = normalizedReference(current)
  const resolvedRef = normalizedReference(resolved)
  return !!currentRef && !!resolvedRef
    && currentRef.errorId === resolvedRef.errorId
    && currentRef.channel === resolvedRef.channel
    && currentRef.code === resolvedRef.code
}

export function dispatchResolvedSyncError(problem: SyncProblemReference | null | undefined): boolean {
  const detail = normalizedReference(problem)
  if (!detail || typeof window === 'undefined') return false
  window.dispatchEvent(new CustomEvent(SYNC_ERROR_RESOLVED_EVENT, { detail }))
  return true
}
