import { useCallback, useEffect, useRef, useState } from 'react'
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

// The session is an HttpOnly cookie, so nothing in storage tells this tab that another tab signed in or out: the only signal is to ask the
// Worker again when the visitor comes back to the tab (visible, focused) or the page is restored from the back/forward cache.
export const PORTAL_SESSION_RECHECK_MIN_MS = 10000

export function shouldRecheckPortalSession(state: { ready: boolean; checking: boolean; busy: boolean; force: boolean; now: number; last: number }): boolean {
  if (!state.ready || state.checking || state.busy) return false
  return state.force || state.now - state.last >= PORTAL_SESSION_RECHECK_MIN_MS
}

export function samePortalProfile(a: PortalAccountProfile | null, b: PortalAccountProfile | null): boolean {
  if (!a || !b) return a === b
  return a.membershipId === b.membershipId && a.name === b.name && a.email === b.email
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

  // Initial "am I signed in?" check.
  useEffect(() => {
    let cancelled = false
    const a = api()
    if (!a.getPortalAccountMe) { setReady(true); return }
    a.getPortalAccountMe()
      .then(async (result) => {
        if (cancelled) return
        const profile = readProfile(result)
        setAccount(profile)
        if (profile) await hydrate()
      })
      .catch((err) => {
        if (cancelled) return
        setAccount(null)
        setConsentRenewal(readPortalErrorCode(err) === CONSENT_RENEWAL_CODE)
      })
      .finally(() => { if (!cancelled) setReady(true) })
    return () => { cancelled = true }
    // hydrate is stable enough; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ask again when the visitor returns to the tab or the page comes back from the back/forward cache, so a sign-in or sign-out made in
  // another tab is seen here. A failed check changes nothing: the last known state stands.
  const readyRef = useRef(false)
  const busyRef = useRef(false)
  const accountRef = useRef<PortalAccountProfile | null>(null)
  const checkingRef = useRef(false)
  const lastCheckRef = useRef(Date.now())
  const hydrateRef = useRef(hydrate)
  hydrateRef.current = hydrate
  readyRef.current = ready
  busyRef.current = busy
  accountRef.current = account
  const recheck = useCallback(async (force: boolean) => {
    const a = api()
    if (!a.getPortalAccountMe) return
    if (!shouldRecheckPortalSession({ ready: readyRef.current, checking: checkingRef.current, busy: busyRef.current, force, now: Date.now(), last: lastCheckRef.current })) return
    checkingRef.current = true
    lastCheckRef.current = Date.now()
    try {
      const profile = readProfile(await a.getPortalAccountMe())
      // A sign-in or sign-out in this tab started while the check was out: that answer is newer.
      if (busyRef.current) return
      const had = accountRef.current
      if (samePortalProfile(had, profile)) return
      setAccount(profile)
      if (profile) {
        setConsentRenewal(false)
        await hydrateRef.current()
      } else {
        hydratedRef.current = false
      }
    } catch {
      // keep the last known state
    } finally {
      checkingRef.current = false
    }
  }, [])
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined
    const onVisible = () => { if (document.visibilityState === 'visible') void recheck(false) }
    const onFocus = () => { void recheck(false) }
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) void recheck(true) }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [recheck])

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
    try {
      const result = await fn(payload)
      const profile = readProfile(result)
      if (!profile) throw new Error(accountMessage(copyRef.current, 'incomplete'))
      setAccount(profile)
      setConsentRenewal(false)
      await hydrate()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : accountMessage(copyRef.current, 'generic'))
      setErrorCode(readPortalErrorCode(err))
      return false
    } finally {
      setBusy(false)
    }
  }, [hydrate])

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
      setConsentRenewal(false)
      await hydrate()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : accountMessage(copyRef.current, 'generic'))
      setErrorCode(readPortalErrorCode(err))
      return false
    } finally {
      setBusy(false)
    }
  }, [hydrate])

  // Keep browsing as a guest: nothing is signed out, the prompt just stops asking until the next visit.
  const dismissConsentRenewal = useCallback(() => { setConsentRenewal(false); setError(''); setErrorCode('') }, [])

  const signIn = useCallback((payload: Record<string, unknown>) => authenticate('signinPortalAccount', payload), [authenticate])
  const signUp = useCallback((payload: Record<string, unknown>) => authenticate('signupPortalAccount', payload), [authenticate])

  const signOut = useCallback(async () => {
    const a = api()
    hydratedRef.current = false
    try { await a.signoutPortalAccount?.() } catch { /* ignore */ }
    setAccount(null)
    setConsentRenewal(false)
    // The local list stays as the guest's list — it is not cleared on sign-out.
  }, [])

  const clearError = useCallback(() => { setError(''); setErrorCode('') }, [])

  return { account, ready, busy, error, errorCode, consentRenewal, renewConsent, dismissConsentRenewal, signIn, signUp, signOut, clearError }
}
