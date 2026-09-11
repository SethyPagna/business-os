import { getSyncServerUrl } from './httpState.ts'

const SESSION_MARKER = 'businessos_read_session'
const runtimeId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
let localSession = 0
let observedIdentity = ''
let authorityId = 0
let allRevision = 0
const revisions = new Map<string, number>()
const resultScopes = new WeakMap<object, ActorReadScope>()
let expectedMarker: string | null | undefined
let quarantined = false
let quarantineStatus = 'checking'
const quarantineListeners = new Set<() => void>()
export const ACTOR_SESSION_RETRY_EVENT = 'auth:read-session-retry'

function sessionMarker(): string | null {
  try { return window.localStorage.getItem(SESSION_MARKER) } catch { return null }
}

function observeSessionMarker(): void {
  const marker = sessionMarker()
  if (expectedMarker === undefined) { expectedMarker = marker; return }
  if (marker === expectedMarker) return
  expectedMarker = marker
  localSession++
  quarantined = true
  quarantineStatus = 'checking'
  quarantineListeners.forEach((listener) => listener())
}

if (typeof window !== 'undefined') {
  expectedMarker = sessionMarker()
  window.addEventListener('storage', (event) => {
    if (event.key === SESSION_MARKER || event.key === null) observeSessionMarker()
  })
}

export function subscribeActorSessionQuarantine(listener: () => void): () => void {
  quarantineListeners.add(listener)
  return () => { quarantineListeners.delete(listener) }
}

export function isActorSessionQuarantined(): boolean { observeSessionMarker(); return quarantined }
export function assertActorSessionDispatchAllowed(scope?: ActorReadScope): void {
  if (isActorSessionQuarantined() || (scope && !isActorReadScopeCurrent(scope, false))) {
    throw Object.assign(new Error('The sign-in changed. Resolve the locked session before retrying this action.'), {
      code: 'actor_session_quarantined', status: 409, outcome: 'not_dispatched',
    })
  }
}
export function actorSessionQuarantineStatus(): string { return quarantineStatus }
export function actorSessionReconciliationMarker(): string | null { observeSessionMarker(); return expectedMarker ?? null }
export function setActorSessionQuarantineStatus(status: string): void {
  quarantineStatus = status
  quarantineListeners.forEach((listener) => listener())
}
export function completeActorSessionReconciliation(marker: string | null): boolean {
  observeSessionMarker()
  if (marker !== expectedMarker) return false
  quarantined = false
  quarantineStatus = 'ready'
  localSession++
  quarantineListeners.forEach((listener) => listener())
  return true
}

export type ActorReadScope = { authority: string; channel: string; revision: string }

function authority(): string {
  observeSessionMarker()
  let identity = getSyncServerUrl()
  try {
    if (typeof window !== 'undefined') {
      // Never serialize credentials into cache keys. A per-runtime opaque id
      // names this identity; local/session storage values are comparison only.
      identity += JSON.stringify([
        window.location?.origin,
        window.sessionStorage?.getItem('businessos_user') || window.localStorage?.getItem('businessos_user'),
        window.sessionStorage?.getItem('businessos_user_expiry') || window.localStorage?.getItem('businessos_user_expiry'),
        window.localStorage?.getItem(SESSION_MARKER),
      ])
    }
  } catch { identity += ':storage-unavailable' }
  if (identity !== observedIdentity) { observedIdentity = identity; authorityId++ }
  return `${runtimeId}:${localSession}:${authorityId}`
}

/** Call synchronously BEFORE awaiting logout/reset/bootstrap work. The marker
 * also fences other tabs sharing the same cookie-based authenticated session. */
export function resetActorReadSession(): void {
  localSession++
  const marker = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
  expectedMarker = marker
  try { window.localStorage.setItem(SESSION_MARKER, marker) } catch { expectedMarker = sessionMarker() }
}

export function invalidateActorReadChannel(prefix: string): void {
  if (!prefix) { allRevision++; revisions.clear(); return }
  const entity = prefix.split(':')[0]
  revisions.set(entity, (revisions.get(entity) || 0) + 1)
}

export function captureActorReadScope(channel = ''): ActorReadScope {
  return { authority: authority(), channel, revision: `${allRevision}:${revisions.get(channel.split(':')[0]) || 0}` }
}

export function isActorReadScopeCurrent(scope: ActorReadScope, includeInvalidation = true, allowQuarantine = false): boolean {
  const current = captureActorReadScope(scope.channel)
  return (allowQuarantine || !quarantined) && current.authority === scope.authority && (!includeInvalidation || current.revision === scope.revision)
}

export function assertActorReadScope(scope: ActorReadScope, includeInvalidation = true, allowQuarantine = false): void {
  if (!isActorReadScopeCurrent(scope, includeInvalidation, allowQuarantine)) {
    throw Object.assign(new Error('Read belongs to an earlier account or refresh. Please try again.'), { name: 'AbortError', code: 'stale_read_scope' })
  }
}

export function actorReadStorageKey(key: string, scope: ActorReadScope): string {
  return `read_cache:v2:${scope.authority}:${scope.revision}:${key.trim()}`
}

/** Preserve provenance through existing delayed mirror imports without adding
 * any fields to server payloads or persisting credentials. */
export function markActorReadResult<T>(result: T, scope: ActorReadScope): T {
  if (result && typeof result === 'object') {
    resultScopes.set(result, scope)
    for (const value of Object.values(result)) {
      if (Array.isArray(value)) resultScopes.set(value, scope)
    }
  }
  return result
}

export function actorReadResultScope(result: unknown, fallback: ActorReadScope): ActorReadScope {
  return result && typeof result === 'object' ? resultScopes.get(result) || fallback : fallback
}
