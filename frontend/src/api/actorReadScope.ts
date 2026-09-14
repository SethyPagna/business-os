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
const AUTH_PENDING_PREFIX = 'auth-pending:'
const AUTH_PENDING_OWNER = 'businessos_auth_cookie_pending'
const AUTH_ADMISSION_LOCK = 'businessos-auth-cookie-admission'
let expectedPending: string | null = null
const OAUTH_COOKIE_OWNER = 'businessos_oauth_cookie_owner'
const cookieUsers = new WeakMap<object, string>()

// Touching window.localStorage / window.sessionStorage THROWS
// (SecurityError) wherever site data is blocked -- iOS Safari's "Block All
// Cookies", private mode -- so every access in this file goes through these
// helpers. Reads degrade to null, exactly like sessionMarker() below already
// did. Writes deliberately do NOT degrade silently: every write here records
// an auth fence, and a fence the caller believes exists but that never
// persisted would let a cookie-changing request dispatch unfenced. So the
// write helper reports success or failure and each caller decides, the same
// fail-closed stance pendingCookieOwner() takes for an unreadable store.
type ScopeStore = 'local' | 'session'

function scopeStorage(kind: ScopeStore): Storage | null {
  try {
    return (kind === 'local' ? window.localStorage : window.sessionStorage) || null
  } catch {
    return null
  }
}

function readScopeStorage(kind: ScopeStore, key: string): string | null {
  try {
    return scopeStorage(kind)?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** True only when the value is readable back: a store that accepts setItem
 *  and silently keeps nothing (iOS under pressure) is not a durable fence. */
function writeScopeStorage(kind: ScopeStore, key: string, value: string): boolean {
  try {
    const store = scopeStorage(kind)
    if (!store) return false
    store.setItem(key, value)
    return store.getItem(key) === value
  } catch {
    return false
  }
}

function removeScopeStorage(kind: ScopeStore, key: string): void {
  try {
    scopeStorage(kind)?.removeItem(key)
  } catch {
    // Nothing to clear if the store was never usable.
  }
}

function actorStorageUnavailableError(): Error {
  return Object.assign(new Error('Sign-in needs this site\'s data to be allowed. Enable cookies and site data for this site, then try again. / ការចូលគណនីត្រូវការទិន្នន័យគេហទំព័រ។ សូមអនុញ្ញាតខូឃី និងទិន្នន័យគេហទំព័រ រួចព្យាយាមម្ដងទៀត។'), {
    code: 'auth_storage_unavailable', status: 409, outcome: 'not_dispatched',
  })
}

export function isActorCookieMutationPending(): boolean {
  return !!pendingCookieOwner()
}

function pendingCookieOwner(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(AUTH_PENDING_OWNER)
      || (String(sessionMarker() || '').startsWith(AUTH_PENDING_PREFIX) ? sessionMarker() : null)
  } catch {
    // Unreadable coordination storage is not proof that no other tab owns
    // the cookie phase. Keep dispatch/recovery closed until it is readable.
    return AUTH_PENDING_PREFIX + 'storage-unavailable'
  }
}

/** Call immediately before the browser request that can change the shared
 * HttpOnly cookie. No elapsed-time lease may release an unfinished request. */
export async function beginActorCookieMutation(): Promise<string> {
  const beforeAdmission = captureActorReadScope()
  if (typeof window === 'undefined') return AUTH_PENDING_PREFIX + runtimeId
  const locks = window.navigator?.locks
  if (!locks?.request) throw Object.assign(new Error('Secure cross-tab sign-in is unavailable in this browser. Use a supported browser. / ការចូលគណនីដោយសុវត្ថិភាពរវាងផ្ទាំងមិនអាចប្រើបានទេ។ សូមប្រើកម្មវិធីរុករកដែលគាំទ្រ។'), { code: 'auth_lock_unavailable', status: 409, outcome: 'not_dispatched' })
  return locks.request(AUTH_ADMISSION_LOCK, { mode: 'exclusive' }, () => {
    assertActorSessionDispatchAllowed(beforeAdmission)
    const marker = AUTH_PENDING_PREFIX + (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`)
    // Independent of generic generation resets: they cannot erase this
    // durable owner while fetch or a full-page OAuth redirect is pending.
    // Both writes must be PROVEN before the caller is allowed to send the
    // cookie-changing request: on a device with site data blocked they throw,
    // and swallowing that would dispatch a sign-in with no owner recorded
    // anywhere -- the exact state pendingCookieOwner() refuses to assume.
    const pendingWritten = writeScopeStorage('local', AUTH_PENDING_OWNER, marker)
    if (!pendingWritten || !writeScopeStorage('local', SESSION_MARKER, marker)) {
      // Roll back a half-written fence; left behind it would name a pending
      // owner that no request will ever settle, locking this device out.
      if (pendingWritten) removeScopeStorage('local', AUTH_PENDING_OWNER)
      throw actorStorageUnavailableError()
    }
    expectedPending = marker
    expectedMarker = marker
    localSession++
    return marker
  })
}

/** Only the owner of the current pending marker may settle it. Called from
 * the actual fetch lifecycle, never a UI deadline that leaves fetch running. */
export function finishActorCookieMutation(marker: string, ownerReconciliation = false, user?: object): boolean {
  if (typeof window === 'undefined') return true
  if (pendingCookieOwner() !== marker || !marker.startsWith(AUTH_PENDING_PREFIX)) return false
  const settled = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
  // If the settled marker cannot be stored the phase is NOT settled: returning
  // true here would release the fence in memory while storage still names the
  // pending owner, and the next tab to read it would disagree with this one.
  if (!writeScopeStorage('local', SESSION_MARKER, settled)) return false
  expectedMarker = settled
  expectedPending = null
  removeScopeStorage('local', AUTH_PENDING_OWNER)
  localSession++
  if (ownerReconciliation) {
    if (user) cookieUsers.set(user, settled)
    quarantined = true
    quarantineStatus = 'checking'
    quarantineListeners.forEach((listener) => listener())
  }
  return true
}

/** Only the exact user object returned by this runtime's completed login may
 * authorize the normal explicit sign-in handoff. A late, unconsumed result
 * leaves old UI quarantined; no timer assumes the caller applied it. */
export function acknowledgeActorCookieUser(user: unknown): boolean {
  if (!user || typeof user !== 'object' || cookieUsers.get(user) !== sessionMarker() || isActorCookieMutationPending()) return false
  cookieUsers.delete(user)
  quarantined = false
  quarantineStatus = 'ready'
  localSession++
  quarantineListeners.forEach((listener) => listener())
  return true
}

/** The opaque owner marker travels through the server-signed return URL;
 * sessionStorage retains ownership across this tab's full-page redirect, with
 * a localStorage mirror for the contexts where sessionStorage does not. */
export function prepareActorOauthCookieRedirect(marker: string, redirectTo: string): string {
  const url = new URL(redirectTo)
  url.searchParams.set('auth_mode', 'login')
  url.searchParams.set('auth_provider', 'google')
  url.searchParams.set('auth_session_intent', marker)
  // An iOS standalone PWA can come back from a full-page OAuth redirect in a
  // FRESH browsing context: sessionStorage is empty, this marker is gone, and
  // finishActorOauthCookieRedirect() below then returns false forever -- the
  // Google sign-in silently never completes and the person is dropped back on
  // the login screen with no error to act on. The localStorage mirror makes
  // the marker outlive that context swap.
  //
  // Why the mirror does not weaken the check: the stored value IS the
  // server-signed marker, and the test is still "the marker returned in
  // auth_session_intent must equal the one we stored" -- a wrong marker fails
  // exactly as before. The fence it settles (AUTH_PENDING_OWNER) already lives
  // in localStorage, so no new tab gains the ability to settle it, and both
  // copies are cleared the moment the phase completes.
  const ownedInSession = writeScopeStorage('session', OAUTH_COOKIE_OWNER, marker)
  const ownedInMirror = writeScopeStorage('local', OAUTH_COOKIE_OWNER, marker)
  if (!ownedInSession && !ownedInMirror) {
    // Neither store retained it, so the return leg could never prove
    // ownership. Fail before redirecting instead of sending the person to
    // Google and back into a dead end.
    throw actorStorageUnavailableError()
  }
  removeScopeStorage('local', 'businessos_oauth_callback_result')
  return url.toString()
}

export function finishActorOauthCookieRedirect(returnedMarker: string | null): boolean {
  const owned = readScopeStorage('session', OAUTH_COOKIE_OWNER) || readScopeStorage('local', OAUTH_COOKIE_OWNER)
  if (!owned || owned !== returnedMarker || !finishActorCookieMutation(owned)) return false
  removeScopeStorage('session', OAUTH_COOKIE_OWNER)
  removeScopeStorage('local', OAUTH_COOKIE_OWNER)
  quarantined = false
  quarantineStatus = 'ready'
  quarantineListeners.forEach((listener) => listener())
  return true
}

function sessionMarker(): string | null {
  try { return window.localStorage.getItem(SESSION_MARKER) } catch { return null }
}

function observeSessionMarker(): void {
  const marker = sessionMarker()
  const pending = pendingCookieOwner()
  if (expectedMarker === undefined) { expectedMarker = marker; return }
  if (marker === expectedMarker && pending === expectedPending) return
  expectedMarker = marker
  expectedPending = pending
  localSession++
  quarantined = true
  quarantineStatus = 'checking'
  quarantineListeners.forEach((listener) => listener())
}

if (typeof window !== 'undefined') {
  expectedMarker = sessionMarker()
  expectedPending = pendingCookieOwner()
  if (isActorCookieMutationPending()) quarantined = true
  window.addEventListener('storage', (event) => {
    if (event.key === SESSION_MARKER || event.key === AUTH_PENDING_OWNER || event.key === null) observeSessionMarker()
  })
}

export function subscribeActorSessionQuarantine(listener: () => void): () => void {
  quarantineListeners.add(listener)
  return () => { quarantineListeners.delete(listener) }
}

export function isActorSessionQuarantined(): boolean { observeSessionMarker(); return quarantined }
export function assertActorSessionDispatchAllowed(scope?: ActorReadScope): void {
  if (isActorSessionQuarantined() || isActorCookieMutationPending() || (scope && !isActorReadScopeCurrent(scope, false))) {
    throw Object.assign(new Error('The sign-in changed. Resolve the locked session before retrying this action.'), {
      code: 'actor_session_quarantined', status: 409, outcome: 'not_dispatched',
    })
  }
}
export function actorSessionQuarantineStatus(): string { return quarantineStatus }
export function actorSessionReconciliationMarker(): string | null { observeSessionMarker(); return pendingCookieOwner() || expectedMarker || null }
export function setActorSessionQuarantineStatus(status: string): void {
  quarantineStatus = status
  quarantineListeners.forEach((listener) => listener())
}
export function completeActorSessionReconciliation(marker: string | null): boolean {
  observeSessionMarker()
  if (marker !== expectedMarker || isActorCookieMutationPending()) return false
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
  // A generic cache/logout/bootstrap reset must not erase the fence belonging
  // to a cookie-changing request that is still running in any tab.
  if (isActorCookieMutationPending()) return
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
