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

export type SyncProblemPresentationOwner = {
  actorId: string
  requestId: string
  problem: SyncProblemReference
}

const presentationOwners = new Map<symbol, SyncProblemPresentationOwner>()
const presentationListeners = new Set<() => void>()

export function subscribeSyncProblemPresentation(listener: () => void): () => void {
  presentationListeners.add(listener)
  return () => { presentationListeners.delete(listener) }
}

/** A mounted recovery surface owns presentation only; the error is not cleared. */
export function claimSyncProblemPresentation(owner: SyncProblemPresentationOwner): () => void {
  const actorId = String(owner.actorId || '').trim()
  const requestId = String(owner.requestId || '').trim()
  const problem = normalizedReference(owner.problem)
  if (!actorId || !requestId || !problem) return () => {}
  const token = Symbol('sync-problem-presentation')
  presentationOwners.set(token, { actorId, requestId, problem })
  presentationListeners.forEach(listener => listener())
  return () => {
    if (!presentationOwners.delete(token)) return
    presentationListeners.forEach(listener => listener())
  }
}

export function hasLocalSyncProblemPresentation(problem: SyncProblemReference | null | undefined, actorId: unknown): boolean {
  const actor = String(actorId || '').trim()
  if (!actor) return false
  return [...presentationOwners.values()].some(owner => owner.actorId === actor && shouldClearResolvedSyncError(problem, owner.problem))
}
