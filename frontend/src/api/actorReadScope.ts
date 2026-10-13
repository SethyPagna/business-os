import { getSyncServerUrl } from './httpState.ts'
import { SIGNOUT_INTENT_EVENT, SIGNOUT_INTENT_KEY, assertSignoutIntentCurrent, isSignoutBlocked, releaseConfirmedSignoutForAuthentication, signoutStatus } from './unresolvedSignout.ts'

const SESSION_MARKER = 'businessos_read_session'
const runtimeId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
let localSession = 0
let observedIdentity = ''
let authorityId = 0
let lastWriteOwner = ''
let writeOwnerEpoch = 0
let parsedUserRaw: string | null = null
let parsedUser: Record<string, unknown> = {}
let lastSignedInUser: Record<string, unknown> | null = null
let accountForgotten = false
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

/** The OAuth owner marker exists only for the duration of one redirect.
 *  Shop phones are shared by several staff accounts, so a copy left behind by
 *  an abandoned attempt must never be able to finish somebody else's sign-in:
 *  it is deleted when a new cookie phase starts, when any cookie phase settles
 *  (which includes every logout, since logout is itself a cookie mutation),
 *  and the moment it is found to be stale on return. */
function clearActorOauthCookieOwner(): void {
  removeScopeStorage('session', OAUTH_COOKIE_OWNER)
  removeScopeStorage('local', OAUTH_COOKIE_OWNER)
}

export function isActorCookieMutationPending(): boolean {
  return !!pendingCookieOwner()
}

/** Presentation only: an unreadable fence is still pending for every safety check. */
export function actorCookieMutationPendingStatus(): 'storage-unavailable' | 'authentication-pending' {
  return pendingCookieOwner() === AUTH_PENDING_PREFIX + 'storage-unavailable'
    ? 'storage-unavailable'
    : 'authentication-pending'
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
export async function beginActorCookieMutation(signoutToken?: string): Promise<string> {
  const beforeAdmission = captureActorReadScope()
  if (typeof window === 'undefined') return AUTH_PENDING_PREFIX + runtimeId
  const locks = window.navigator?.locks
  if (!locks?.request) throw Object.assign(new Error('Secure cross-tab sign-in is unavailable in this browser. Use a supported browser. / ការចូលគណនីដោយសុវត្ថិភាពរវាងផ្ទាំងមិនអាចប្រើបានទេ។ សូមប្រើកម្មវិធីរុករកដែលគាំទ្រ។'), { code: 'auth_lock_unavailable', status: 409, outcome: 'not_dispatched' })
  return locks.request(AUTH_ADMISSION_LOCK, { mode: 'exclusive' }, () => {
    if (signoutToken) {
      assertSignoutIntentCurrent(signoutToken)
      if (isActorCookieMutationPending()) throw new Error('Another authentication request is still running.')
    } else assertActorSessionDispatchAllowed(beforeAdmission)
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
    // A new cookie phase begins: whatever redirect marker an earlier attempt
    // left behind can never complete now, so it does not get to outlive this
    // moment. prepareActorOauthCookieRedirect() writes the new one after this.
    clearActorOauthCookieOwner()
    forgetActorWriteAccount()
    expectedPending = marker
    expectedMarker = marker
    localSession++
    try {
      if (!signoutToken) releaseConfirmedSignoutForAuthentication()
    } catch (error) {
      // Admission never dispatched: settle only this owned cookie marker.
      finishActorCookieMutation(marker)
      throw error
    }
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
  // The redirect marker belonged to the phase that just settled -- login,
  // logout, OTP or session-duration -- so it is spent in every one of those
  // paths, not only in the OAuth one below.
  clearActorOauthCookieOwner()
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
  if (isSignoutBlocked()) return false
  if (!user || typeof user !== 'object' || cookieUsers.get(user) !== sessionMarker() || isActorCookieMutationPending()) return false
  cookieUsers.delete(user)
  accountForgotten = false
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
  if (isSignoutBlocked()) return false
  const owned = readScopeStorage('session', OAUTH_COOKIE_OWNER) || readScopeStorage('local', OAUTH_COOKIE_OWNER)
  if (!owned) return false
  // Two independent conditions, both of which predate the localStorage mirror:
  // the stored marker must EQUAL the server-signed value returned in
  // auth_session_intent, and it must still be THE pending cookie owner
  // (enforced inside finishActorCookieMutation). A marker that is no longer
  // the pending owner is spent or belongs to another account's abandoned
  // attempt on this shared device -- it is deleted here rather than left in
  // localStorage for a later redirect to meet.
  //
  // A merely MISMATCHED value while this device's own phase is still pending
  // is rejected but NOT deleted: deleting then would let any stray callback
  // erase the live owner and lock the person out of finishing their own
  // sign-in. Staleness, not disagreement, is what makes a marker unsafe.
  if (pendingCookieOwner() !== owned) {
    clearActorOauthCookieOwner()
    return false
  }
  if (owned !== returnedMarker || !finishActorCookieMutation(owned)) return false
  // finishActorCookieMutation already consumed both copies; nothing to clear.
  accountForgotten = false
  quarantined = false
  quarantineStatus = 'ready'
  quarantineListeners.forEach((listener) => listener())
  return true
}

function sessionMarker(): string | null {
  return readScopeStorage('local', SESSION_MARKER)
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
  if (isActorCookieMutationPending() || isSignoutBlocked()) quarantined = true
  window.addEventListener('storage', (event) => {
    if (event.key === SIGNOUT_INTENT_KEY || event.key === null) {
      if (isSignoutBlocked()) quarantined = true
      quarantineListeners.forEach((listener) => listener())
    }
    if (event.key === SESSION_MARKER || event.key === AUTH_PENDING_OWNER || event.key === null) observeSessionMarker()
    if (event.key === STORED_USER || event.key === null) observeWriteOwner()
  })
  window.addEventListener(SIGNOUT_INTENT_EVENT, () => {
    if (isSignoutBlocked()) quarantined = true
    quarantineListeners.forEach((listener) => listener())
  })
}

export function subscribeActorSessionQuarantine(listener: () => void): () => void {
  quarantineListeners.add(listener)
  return () => { quarantineListeners.delete(listener) }
}

export function isActorSessionQuarantined(): boolean { observeSessionMarker(); return quarantined || isSignoutBlocked() }
export const ACTOR_SESSION_QUARANTINED_MESSAGE = 'The sign-in changed. Resolve the locked session before retrying this action.'
export const STALE_READ_SCOPE_MESSAGE = 'Read belongs to an earlier account or refresh. Please try again.'
export const ACTOR_OWNER_CHANGED_MESSAGE = 'The signed-in account changed, so nothing was sent. Sign back in as the original account to continue.'
export function assertActorSessionDispatchAllowed(scope?: ActorReadScope): void {
  if (isActorSessionQuarantined() || isActorCookieMutationPending() || (scope && !isActorReadScopeCurrent(scope, false))) {
    throw Object.assign(new Error(ACTOR_SESSION_QUARANTINED_MESSAGE), {
      code: 'actor_session_quarantined', status: 409, outcome: 'not_dispatched',
    })
  }
}
export function actorSessionQuarantineStatus(): string { return isSignoutBlocked() ? signoutStatus() : quarantineStatus }
export function actorSessionReconciliationMarker(): string | null { observeSessionMarker(); return pendingCookieOwner() || expectedMarker || null }
export function setActorSessionQuarantineStatus(status: string): void {
  quarantineStatus = status
  quarantineListeners.forEach((listener) => listener())
}
export function completeActorSessionReconciliation(marker: string | null): boolean {
  if (isSignoutBlocked()) return false
  observeSessionMarker()
  if (marker !== expectedMarker || isActorCookieMutationPending()) return false
  // The account confirmed here is the stored one; a confirmed sign-out has none.
  if (storedUserId()) accountForgotten = false
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
  if (identity !== observedIdentity) { observedIdentity = identity; authorityId++; observeWriteOwner() }
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
  return (allowQuarantine || (!quarantined && !isSignoutBlocked())) && current.authority === scope.authority && (!includeInvalidation || current.revision === scope.revision)
}

export function assertActorReadScope(scope: ActorReadScope, includeInvalidation = true, allowQuarantine = false): void {
  if (!isActorReadScopeCurrent(scope, includeInvalidation, allowQuarantine)) {
    throw Object.assign(new Error(STALE_READ_SCOPE_MESSAGE), { name: 'AbortError', code: 'stale_read_scope' })
  }
}

// Who a write belongs to: the server, the origin, and the signed-in user id and
// organization -- the identity that also scopes work drafts. Unlike the read
// authority above it does not move on same-user churn (a session reset, a
// permission, profile or expiry rewrite, a reconnect); the Worker checks
// permissions on every write. A change to another signed-in owner bumps an
// epoch that only increases, so A -> B -> A never passes as unchanged.
//
// The epoch is the device's owner generation, kept in WRITE_OWNER as
// "generation:digest" so records that outlive a tab (the receiving product
// attempts) can be bound to it. A tab raises it when it sees another owner
// itself -- a sign-in here, or a reload whose stored owner is not the one
// recorded -- and continues the generation the device recorded for the owner
// it now sees. A change only another tab saw leaves this tab's owner alone:
// the session marker locked this tab meanwhile, so nothing it sent crossed
// owners. The digest is a 64-bit hash of the owner; staff ids are small, so it
// does not hide which account last signed in from someone reading the storage.
//
// No stored user is not another account. A same-user refresh, or a bootstrap
// still on its way, can leave none stored for a moment: unless the session is
// locked or a sign-in is pending, that is the last account seen. A cookie phase
// (sign-in, sign-out), session expiry and a confirmed sign-out forget it until
// the next confirmed sign-in.
export type ActorWriteIdentity = { owner: string; epoch: number }

const STORED_USER = 'businessos_user'
const WRITE_OWNER = 'businessos_write_owner_v1'
let lastWriteDigest = ''

function ownerDigest(owner: string): string {
  let high = 0x811c9dc5, low = 0x01000193
  for (let index = 0; index < owner.length; index++) {
    const unit = owner.charCodeAt(index)
    high = Math.imul(high ^ unit, 0x01000193) >>> 0
    low = Math.imul(low ^ unit, 0x5bd1e995) >>> 0
  }
  return high.toString(16).padStart(8, '0') + low.toString(16).padStart(8, '0')
}

function recordedWriteOwner(): { generation: number; digest: string } | null {
  const match = /^(\d{1,15}):([0-9a-f]{16})$/.exec(readScopeStorage('local', WRITE_OWNER) || '')
  return match ? { generation: Number(match[1]), digest: match[2] } : null
}

function storedUserId(): string {
  const raw = readScopeStorage('session', STORED_USER) || readScopeStorage('local', STORED_USER)
  if (raw !== parsedUserRaw) {
    parsedUserRaw = raw
    try {
      const value: unknown = raw ? JSON.parse(raw) : null
      parsedUser = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    } catch { parsedUser = {} }
  }
  return parsedUser.id == null ? '' : String(parsedUser.id)
}

function storedAccount(): Record<string, unknown> | null {
  if (storedUserId()) {
    // A forgotten account stays forgotten until a sign-in is confirmed: an old
    // user still stored while its sign-out runs is not remembered again.
    if (!accountForgotten) lastSignedInUser = parsedUser
    return parsedUser
  }
  return lastSignedInUser && !isActorSessionQuarantined() && !isActorCookieMutationPending() ? lastSignedInUser : null
}

function storedWriteOwner(): { owner: string; signedIn: boolean } {
  const user = storedAccount() || {}
  let origin = ''
  try { origin = String(window.location?.origin || '') } catch { origin = '' }
  const id = user.id == null ? '' : String(user.id)
  const organization = String(user.organization_id || user.organization_slug || '')
  return { owner: JSON.stringify([getSyncServerUrl(), origin, id, organization]), signedIn: id !== '' }
}

/** A cookie phase, session expiry or a confirmed sign-out: from now until a
 *  sign-in is confirmed, a missing stored user reads as signed out. */
export function forgetActorWriteAccount(): void { lastSignedInUser = null; accountForgotten = true }

/** The account writes are signed for: the stored user, or the last one seen
 *  while none is stored (see above); null when signed out. */
export function actorWriteAccount(): Record<string, unknown> | null {
  observeWriteOwner()
  return storedAccount()
}

function observeWriteOwner(): string {
  const { owner, signedIn } = storedWriteOwner()
  if (!signedIn) return owner
  const recorded = recordedWriteOwner()
  if (owner !== lastWriteOwner) {
    const digest = ownerDigest(owner)
    // The device already recorded this owner at a generation this tab has not
    // passed (a reload, or another tab got there first): continue it. Anything
    // else is a new owner for this device.
    if (recorded && recorded.digest === digest && (!lastWriteOwner || recorded.generation > writeOwnerEpoch)) writeOwnerEpoch = recorded.generation
    else writeOwnerEpoch = Math.max(writeOwnerEpoch, recorded?.generation ?? 0) + 1
    lastWriteOwner = owner
    lastWriteDigest = digest
  } else if (recorded && recorded.generation >= writeOwnerEpoch) return owner
  writeScopeStorage('local', WRITE_OWNER, `${writeOwnerEpoch}:${lastWriteDigest}`)
  return owner
}

export function captureActorWriteIdentity(): ActorWriteIdentity {
  const owner = observeWriteOwner()
  return { owner, epoch: writeOwnerEpoch }
}

/** False once another owner signed in after capture, or while the session is
 *  locked; allowQuarantine asks about the owner alone. */
export function isActorWriteIdentityCurrent(identity: ActorWriteIdentity, allowQuarantine = false): boolean {
  const owner = observeWriteOwner()
  return (allowQuarantine || !isActorSessionQuarantined()) && owner === identity.owner && writeOwnerEpoch === identity.epoch
}

export function assertActorWriteIdentity(identity: ActorWriteIdentity, outcome: 'not_dispatched' | 'unknown' = 'not_dispatched'): void {
  if (isActorSessionQuarantined() || isActorCookieMutationPending()) {
    throw Object.assign(new Error(ACTOR_SESSION_QUARANTINED_MESSAGE), { code: 'actor_session_quarantined', status: 409, outcome })
  }
  if (!isActorWriteIdentityCurrent(identity, true)) {
    throw Object.assign(new Error(ACTOR_OWNER_CHANGED_MESSAGE), { code: 'actor_owner_changed', status: 409, outcome })
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
