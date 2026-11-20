import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PORTAL_SIGNED_IN_KEY,
  clearPortalSignedIn,
  markPortalSignedIn,
  readPortalSignedIn,
  readPortalSignedInValue,
} from './portalLanguageOptions.ts'
import {
  mergeBucketItems,
  mergeWishlistItems,
  type PortalBucketItem,
  type PortalWishlistItem,
} from './portalBucket.ts'

// Storefront account state + the cart/wishlist server-sync orchestration (§2).
// Kept in its own hook so the very large PublicCatalogPage only has to call it
// and render, and so the sync rules live in one testable place.
//
// Guests use everything with the list in localStorage (the bucket/wishlist
// hooks). Signing in adds "permanent memory": on sign-in the guest list is
// MERGED with whatever the account already has on the server (union; cart
// quantity takes the larger), then every later change is mirrored back so the
// list follows the customer across devices.

export type PortalAccountProfile = { membershipId: string; name: string; email: string | null }

type PortalApi = {
  getPortalAccountMe?: () => Promise<unknown>
  renewPortalConsent?: (payload: Record<string, unknown>) => Promise<unknown>
  signinPortalAccount?: (payload: Record<string, unknown>) => Promise<unknown>
  signupPortalAccount?: (payload: Record<string, unknown>) => Promise<unknown>
  signoutPortalAccount?: () => Promise<unknown>
  getPortalCart?: () => Promise<unknown>
  savePortalCart?: (items: unknown[]) => Promise<unknown>
  getPortalWishlist?: () => Promise<unknown>
  savePortalWishlist?: (items: unknown[]) => Promise<unknown>
}

function api(): PortalApi {
  return (typeof window !== 'undefined' ? (window as Window & { api?: PortalApi }).api : undefined) || {}
}

function readProfile(result: unknown): PortalAccountProfile | null {
  const account = (result as { account?: unknown })?.account as Record<string, unknown> | null | undefined
  if (!account || typeof account !== 'object') return null
  const membershipId = String(account.membershipId ?? '').trim()
  const name = String(account.name ?? '').trim()
  if (!membershipId && !name) return null
  return { membershipId, name, email: account.email == null ? null : String(account.email) }
}

// The Worker's refusal code (portalPublicTransport sets error.code from the
// JSON body), so the drawer can say a known refusal in the visitor's language
// instead of showing the server's English sentence.
// The Worker answers 428 portal_consent_required to a session whose account has
// not agreed to the current wording yet (owner, 20 Oct 2026).
export const CONSENT_RENEWAL_CODE = 'portal_consent_required'

export function readPortalErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : ''
}

// A definite refusal from the Worker (4xx): no session was created. A network error, timeout or 5xx proves nothing.
function isDefiniteRefusal(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' && status >= 400 && status < 500
}

function readItems(result: unknown): unknown[] {
  const items = (result as { items?: unknown })?.items
  return Array.isArray(items) ? items : []
}

type BucketLike = { items: PortalBucketItem[]; setAll: (items: PortalBucketItem[]) => void }
type WishlistLike = { items: PortalWishlistItem[]; setAll: (items: PortalWishlistItem[]) => void }

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

// The three messages the hook itself words (everything else is the Worker's own text). They go through the storefront's copy().
function accountMessage(copy: CopyFn, which: 'unavailable' | 'incomplete' | 'generic'): string {
  if (which === 'unavailable') return copy('portalAccountUnavailable', 'Accounts are unavailable right now.', 'គណនីមិនអាចប្រើបានពេលនេះទេ។')
  if (which === 'incomplete') return copy('portalAccountIncomplete', 'The account response was incomplete. Please try again.', 'ចម្លើយគណនីមិនពេញលេញ។ សូមព្យាយាមម្ដងទៀត។')
  return copy('portalAccountGenericError', 'Something went wrong. Please try again.', 'មានបញ្ហា។ សូមព្យាយាមម្ដងទៀត។')
}

export function usePortalAccount(bucket: BucketLike, wishlist: WishlistLike, copy: CopyFn) {
  // The latest copy(), read when an error is worded, so the callbacks below stay stable across a language change.
  const copyRef = useRef(copy)
  copyRef.current = copy
  const [account, setAccount] = useState<PortalAccountProfile | null>(null)
  const [ready, setReady] = useState(false)
  const [sessionKnown, setSessionKnown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState('')
  // True while a live session waits for the renewal prompt; Close/sign-out/Agree/sign-in all clear it.
  const [consentRenewal, setConsentRenewal] = useState(false)

  // Live refs so the debounced saver always reads the latest lists/account
  // without re-subscribing the effect on every keystroke.
  const bucketItemsRef = useRef(bucket.items)
  const wishlistItemsRef = useRef(wishlist.items)
  bucketItemsRef.current = bucket.items
  wishlistItemsRef.current = wishlist.items
  const hydratedRef = useRef(false)
  const cartTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wishTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Pull the account's server-stored lists and union them with the guest's
  // local lists, then mark hydrated so the save effect starts mirroring.
  const hydrate = useCallback(async () => {
    hydratedRef.current = false
    const a = api()
    try {
      const [serverCart, serverWishlist] = await Promise.all([
        a.getPortalCart ? a.getPortalCart().then(readItems).catch(() => []) : Promise.resolve([]),
        a.getPortalWishlist ? a.getPortalWishlist().then(readItems).catch(() => []) : Promise.resolve([]),
      ])
      const mergedCart = mergeBucketItems(bucketItemsRef.current, serverCart as PortalBucketItem[])
      const mergedWishlist = mergeWishlistItems(wishlistItemsRef.current, serverWishlist as PortalWishlistItem[])
      bucket.setAll(mergedCart)
      wishlist.setAll(mergedWishlist)
      // Push the merged union straight back so a second device sees a guest's
      // just-merged items immediately, not only after the next local edit.
      await Promise.all([
        a.savePortalCart ? a.savePortalCart(mergedCart).catch(() => {}) : Promise.resolve(),
        a.savePortalWishlist ? a.savePortalWishlist(mergedWishlist).catch(() => {}) : Promise.resolve(),
      ])
    } finally {
      // Even if the server reads failed, start mirroring so local edits persist.
      hydratedRef.current = true
    }
  }, [bucket, wishlist])

  // The sign-in marker (portalLanguageOptions.ts) is what other tabs can see. This tab gets no `storage` event for its own writes, so every
  // write and clear here also refreshes `marker`. The value this tab last wrote is kept so a failure only undoes its own write.
  const [marker, setMarker] = useState(readPortalSignedIn)
  const accountRef = useRef<PortalAccountProfile | null>(null)
  accountRef.current = account
  const markSignedIn = useCallback((): string => {
    const written = markPortalSignedIn()
    setMarker(readPortalSignedIn())
    return written
  }, [])
  const clearSignedIn = useCallback((onlyIfValue?: string) => {
    clearPortalSignedIn(onlyIfValue)
    setMarker(readPortalSignedIn())
  }, [])

  // Initial "am I signed in?" check. `sessionKnown` is true only after a real answer (signed in, signed out, or a live session waiting
  // for the consent renewal): a failed check leaves it false, so translation stays off for that page view. No retry.
  useEffect(() => {
    let cancelled = false
    const a = api()
    if (!a.getPortalAccountMe) { setReady(true); return }
    const markerBefore = readPortalSignedInValue()
    a.getPortalAccountMe()
      .then(async (result) => {
        if (cancelled) return
        const profile = readProfile(result)
        setAccount(profile)
        setSessionKnown(true)
        if (profile) markSignedIn()
        else if (markerBefore !== null) clearSignedIn(markerBefore)
        if (profile) await hydrate()
      })
      .catch((err) => {
        if (cancelled) return
        setAccount(null)
        const renewal = readPortalErrorCode(err) === CONSENT_RENEWAL_CODE
        setConsentRenewal(renewal)
        if (renewal) {
          setSessionKnown(true)
          markSignedIn()
        }
      })
      .finally(() => { if (!cancelled) setReady(true) })
    return () => { cancelled = true }
    // hydrate is stable enough; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Other tabs and a restored or woken page only ever re-read the marker: nothing here may reach the network.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined
    const refresh = () => setMarker(readPortalSignedIn())
    const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === PORTAL_SIGNED_IN_KEY) refresh() }
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('storage', onStorage)
    window.addEventListener('pageshow', refresh)
    document.addEventListener('visibilitychange', onVisible)
    document.addEventListener('resume', refresh)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('pageshow', refresh)
      document.removeEventListener('visibilitychange', onVisible)
      document.removeEventListener('resume', refresh)
    }
  }, [])

  // Mirror local list changes to the server while signed in and hydrated.
  useEffect(() => {
    if (!account || !hydratedRef.current) return
    const a = api()
    if (a.savePortalCart) {
      if (cartTimer.current) clearTimeout(cartTimer.current)
      cartTimer.current = setTimeout(() => { a.savePortalCart?.(bucket.items).catch(() => {}) }, 600)
    }
    return () => { if (cartTimer.current) clearTimeout(cartTimer.current) }
  }, [bucket.items, account])

  useEffect(() => {
    if (!account || !hydratedRef.current) return
    const a = api()
    if (a.savePortalWishlist) {
      if (wishTimer.current) clearTimeout(wishTimer.current)
      wishTimer.current = setTimeout(() => { a.savePortalWishlist?.(wishlist.items).catch(() => {}) }, 600)
    }
    return () => { if (wishTimer.current) clearTimeout(wishTimer.current) }
  }, [wishlist.items, account])

  const authenticate = useCallback(async (
    method: 'signinPortalAccount' | 'signupPortalAccount',
    payload: Record<string, unknown>,
  ): Promise<boolean> => {
    const a = api()
    const fn = a[method]
    if (!fn) { setError(accountMessage(copyRef.current, 'unavailable')); setErrorCode(''); return false }
    setBusy(true)
    setError('')
    setErrorCode('')
    // Set before the request, so other tabs take Google off before the session cookie exists. A failure undoes only this write.
    const absentBefore = readPortalSignedIn() === 'absent'
    const written = markSignedIn()
    try {
      const result = await fn(payload)
      const profile = readProfile(result)
      if (!profile) throw new Error(accountMessage(copyRef.current, 'incomplete'))
      setAccount(profile)
      setSessionKnown(true)
      setConsentRenewal(false)
      markSignedIn()
      await hydrate()
      return true
    } catch (err) {
      const code = readPortalErrorCode(err)
      if (absentBefore && !accountRef.current && isDefiniteRefusal(err) && code !== CONSENT_RENEWAL_CODE) clearSignedIn(written)
      setError(err instanceof Error ? err.message : accountMessage(copyRef.current, 'generic'))
      setErrorCode(code)
      return false
    } finally {
      setBusy(false)
    }
  }, [hydrate, markSignedIn, clearSignedIn])

  // Agree on the renewal prompt. The profile comes back in the answer itself, so
  // success never depends on a second /auth/me round trip (no loop if it differs).
  const renewConsent = useCallback(async (payload: Record<string, unknown>): Promise<boolean> => {
    const fn = api().renewPortalConsent
    if (!fn) { setError(accountMessage(copyRef.current, 'unavailable')); setErrorCode(''); return false }
    setBusy(true)
    setError('')
    setErrorCode('')
    try {
      const profile = readProfile(await fn(payload))
      if (!profile) throw new Error('The account response was incomplete. Please try again.')
      setAccount(profile)
      setSessionKnown(true)
      setConsentRenewal(false)
      markSignedIn()
      await hydrate()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : accountMessage(copyRef.current, 'generic'))
      setErrorCode(readPortalErrorCode(err))
      return false
    } finally {
      setBusy(false)
    }
  }, [hydrate, markSignedIn])

  // Keep browsing as a guest: nothing is signed out, the prompt just stops asking until the next visit.
  const dismissConsentRenewal = useCallback(() => { setConsentRenewal(false); setError(''); setErrorCode('') }, [])

  const signIn = useCallback((payload: Record<string, unknown>) => authenticate('signinPortalAccount', payload), [authenticate])
  const signUp = useCallback((payload: Record<string, unknown>) => authenticate('signupPortalAccount', payload), [authenticate])

  const signOut = useCallback(async () => {
    const a = api()
    hydratedRef.current = false
    // The marker goes only when the Worker confirms: a failed sign-out may have left the session alive.
    try { await a.signoutPortalAccount?.(); clearSignedIn() } catch { /* ignore */ }
    setAccount(null)
    setConsentRenewal(false)
    // The local list stays as the guest's list — it is not cleared on sign-out.
  }, [clearSignedIn])

  const clearError = useCallback(() => { setError(''); setErrorCode('') }, [])

  return { account, ready, sessionKnown, marker, busy, error, errorCode, consentRenewal, renewConsent, dismissConsentRenewal, signIn, signUp, signOut, clearError }
}
