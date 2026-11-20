// No imports on purpose: this module is pinned to the 'catalog-account-core' chunk (build/chunkBoundaries.ts), which is inside the storefront's
// products closure. Importing anything that lives with the language packs would make every shopper download them up front.

// Not a secret and no personal data: a timestamp that says "someone signed in on this browser", so every tab can keep Google off without
// asking the Worker. The session cookie is HttpOnly, so this is the only signal another tab can read.
export const PORTAL_SIGNED_IN_KEY = 'business-os:portal-signed-in'
export type PortalSignedInMarker = 'present' | 'absent' | 'unreadable'

/** A load-time "signed out" answer clears only a marker older than this: a younger one may belong to a sign-in another tab has not finished. */
export const PORTAL_SIGNED_IN_FRESH_MS = 120_000

/**
 * How old a marker value is (its timestamp, possibly with trailing dots). A value that is not a timestamp, or one dated further ahead than the
 * fresh window (a device clock that was set back), reads as old: the next "signed out" page load clears it, so no guest is left with translation off.
 */
export function portalSignedInMarkerAgeMs(value: string | null, now: number): number {
  const match = /^(\d{1,16})\.*$/.exec(String(value ?? ''))
  if (!match) return Infinity
  const age = now - Number(match[1])
  return age < -PORTAL_SIGNED_IN_FRESH_MS ? Infinity : Math.max(0, age)
}

function localStore(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage ?? null : null
  } catch {
    return null
  }
}

/** The raw marker value, or null when absent or unreadable. */
export function readPortalSignedInValue(): string | null {
  try { return localStore()?.getItem(PORTAL_SIGNED_IN_KEY) ?? null } catch { return null }
}

export function readPortalSignedIn(): PortalSignedInMarker {
  try {
    const store = localStore()
    if (!store) return 'unreadable'
    return store.getItem(PORTAL_SIGNED_IN_KEY) === null ? 'absent' : 'present'
  } catch {
    return 'unreadable'
  }
}

/** Writes a new timestamp (every write changes the value, so other tabs always get a storage event). Returns it, or '' when storage refused. */
export function markPortalSignedIn(): string {
  const value = String(Date.now())
  try {
    const store = localStore()
    if (!store) return ''
    const before = store.getItem(PORTAL_SIGNED_IN_KEY)
    store.setItem(PORTAL_SIGNED_IN_KEY, before === value ? `${value}.` : value)
    return store.getItem(PORTAL_SIGNED_IN_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Removes the marker; with `onlyIfValue` only when it still holds exactly that value (a newer write by another tab stays). */
export function clearPortalSignedIn(onlyIfValue?: string): void {
  try {
    const store = localStore()
    if (!store) return
    if (onlyIfValue !== undefined && store.getItem(PORTAL_SIGNED_IN_KEY) !== onlyIfValue) return
    store.removeItem(PORTAL_SIGNED_IN_KEY)
  } catch {}
}
