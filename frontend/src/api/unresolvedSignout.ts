import { getSyncServerUrl } from './httpState.ts'
import { authenticatedOrganizationId } from './offlineQueueOwnership.ts'

export const SIGNOUT_INTENT_KEY = 'businessos_unresolved_signout_v1'
export const SIGNOUT_INTENT_EVENT = 'auth:signout-intent'
export const SIGNOUT_RETRY_EVENT = 'auth:signout-retry'
export type SignoutIntent = {
  version: 1; token: string; authority: string; actor_id: number
  organization_id: number | null; phase: 'pending' | 'confirmed'
}
let volatileIntent: SignoutIntent | null = null
let acknowledgedToken: string | null = null
let status = 'signout-unresolved'

function changed(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SIGNOUT_INTENT_EVENT))
}
function authority(): string {
  try { return new URL(getSyncServerUrl() || window.location.origin).origin } catch { return '' }
}
export function readSignoutIntent(): SignoutIntent | null {
  if (typeof window === 'undefined') return volatileIntent
  try {
    const raw = window.localStorage.getItem(SIGNOUT_INTENT_KEY)
    if (!raw) return volatileIntent
    const value = JSON.parse(raw)
    if (value?.version !== 1 || typeof value.token !== 'string' || !value.token
      || typeof value.authority !== 'string' || !Number.isSafeInteger(value.actor_id) || value.actor_id <= 0
      || !(value.organization_id === null || (Number.isSafeInteger(value.organization_id) && value.organization_id > 0))
      || !['pending', 'confirmed'].includes(value.phase)) throw Error('Invalid sign-out intent')
    return value
  } catch {
    // Corrupt/unreadable storage is not proof that a prior sign-out finished.
    return volatileIntent || { version: 1, token: 'unreadable', authority: '', actor_id: 0, organization_id: null, phase: 'pending' }
  }
}
export function isSignoutBlocked(): boolean {
  const intent = readSignoutIntent()
  return !!intent && (intent.authority !== authority() || intent.phase !== 'confirmed' || acknowledgedToken !== intent.token)
}
export function signoutError(): Error {
  return Object.assign(new Error('Sign-out is not yet confirmed. Reconnect and finish signing out before continuing.'), { code: 'signout_unresolved', status: 409, outcome: 'not_dispatched' })
}
export function assertNoUnresolvedSignout(): void { if (isSignoutBlocked()) throw signoutError() }
export function signoutStatus(): string {
  if (readSignoutIntent()?.token === 'unreadable') return 'signout-storage-unavailable'
  if (status === 'signout-storage-unavailable') return status
  return readSignoutIntent()?.phase === 'confirmed' ? 'signout-confirmed' : status
}
export function setSignoutStatus(value: string): void { status = value; changed() }

export function beginUnresolvedSignout(user: { id?: unknown; organization_id?: unknown; organizationId?: unknown }): SignoutIntent {
  const existing = readSignoutIntent()
  if (existing && existing.token !== 'unreadable') { if (existing.phase === 'pending') return existing; throw signoutError() }
  const actorId = Number(user?.id)
  const organizationId = authenticatedOrganizationId(user)
  const origin = authority()
  if (!Number.isSafeInteger(actorId) || actorId <= 0 || !origin
    || (organizationId !== null && (!Number.isSafeInteger(organizationId) || organizationId <= 0))) throw signoutError()
  const intent: SignoutIntent = { version: 1, token: crypto.randomUUID(), authority: origin, actor_id: actorId, organization_id: organizationId, phase: 'pending' }
  volatileIntent = intent
  status = 'signout-checking'
  try {
    window.localStorage.setItem(SIGNOUT_INTENT_KEY, JSON.stringify(intent))
    if (window.localStorage.getItem(SIGNOUT_INTENT_KEY) !== JSON.stringify(intent)) throw signoutError()
    volatileIntent = null
  } catch { status = 'signout-storage-unavailable'; changed(); throw signoutError() }
  changed()
  return intent
}
export function assertSignoutIntentCurrent(token: string): SignoutIntent {
  if (volatileIntent?.token === token) {
    // Storage may have been enabled after the initial attempt. Establish the
    // durable intent before permitting even a recovery request; never replace
    // another tab's marker.
    try {
      const raw = JSON.stringify(volatileIntent)
      const stored = window.localStorage.getItem(SIGNOUT_INTENT_KEY)
      if (stored && stored !== raw) throw signoutError()
      window.localStorage.setItem(SIGNOUT_INTENT_KEY, raw)
      if (window.localStorage.getItem(SIGNOUT_INTENT_KEY) !== raw) throw signoutError()
      volatileIntent = null
    } catch { throw signoutError() }
  }
  const intent = readSignoutIntent()
  if (!intent || intent.token !== token || intent.phase !== 'pending' || intent.authority !== authority() || volatileIntent) throw signoutError()
  return intent
}
/** Only called after an uncached server invalid_session response. Keep a
 * confirmed tombstone until React has hidden the old actor in every tab. */
export async function confirmSignoutIntent(token: string): Promise<void> {
  if (!window.navigator?.locks?.request) throw signoutError()
  await window.navigator.locks.request('businessos-auth-cookie-admission', { mode: 'exclusive' }, () => {
    const intent = assertSignoutIntentCurrent(token)
    try {
      if (window.localStorage.getItem('businessos_auth_cookie_pending')) throw signoutError()
      const confirmed = { ...intent, phase: 'confirmed' as const }
      window.localStorage.setItem(SIGNOUT_INTENT_KEY, JSON.stringify(confirmed))
      if (window.localStorage.getItem(SIGNOUT_INTENT_KEY) !== JSON.stringify(confirmed)) throw signoutError()
    } catch { throw signoutError() }
  })
  changed()
}
/** Serialize the signed-out account's cleanup with new login admission. The
 * callback runs (and is awaited) under the admission lock, only while THIS
 * confirmed tombstone is current and no login is pending, so it can never erase
 * a newer account's auth or data: a new sign-in must first take this lock and
 * consume the tombstone. */
export async function prepareConfirmedSignoutUi(token: string, clearAuth: () => void | Promise<void>): Promise<boolean> {
  if (!window.navigator?.locks?.request) return false
  return window.navigator.locks.request('businessos-auth-cookie-admission', { mode: 'exclusive' }, async () => {
    const intent = readSignoutIntent()
    if (intent?.token !== token || intent.phase !== 'confirmed' || intent.authority !== authority()) return false
    try {
      if (window.localStorage.getItem('businessos_auth_cookie_pending')) return false
    } catch {
      // Called by background reconciliation: remain locked without an unhandled
      // storage rejection. Notify only on transition, avoiding retry loops.
      if (status !== 'signout-storage-unavailable') {
        status = 'signout-storage-unavailable'
        changed()
      }
      return false
    }
    status = 'signout-confirmed'
    await clearAuth()
    return true
  })
}
/** Per-runtime acknowledgment follows the user=null React commit, not a timer. */
export function acknowledgeConfirmedSignout(token: string): boolean {
  const intent = readSignoutIntent()
  if (!intent || intent.phase !== 'confirmed' || intent.token !== token || intent.authority !== authority()) return false
  acknowledgedToken = token
  changed()
  return true
}
/** Called inside cookie admission, after its pending marker is durable. A new
 * explicit sign-in replaces the confirmed tombstone, never an unresolved one. */
export function releaseConfirmedSignoutForAuthentication(): void {
  const intent = readSignoutIntent()
  if (!intent) return
  if (intent.phase !== 'confirmed' || acknowledgedToken !== intent.token || intent.authority !== authority()) throw signoutError()
  try {
    window.localStorage.removeItem(SIGNOUT_INTENT_KEY)
    if (window.localStorage.getItem(SIGNOUT_INTENT_KEY)) throw signoutError()
  } catch { throw signoutError() }
  changed()
}
