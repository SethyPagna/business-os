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

function readItems(result: unknown): unknown[] {
  const items = (result as { items?: unknown })?.items
  return Array.isArray(items) ? items : []
}

type BucketLike = { items: PortalBucketItem[]; setAll: (items: PortalBucketItem[]) => void }
type WishlistLike = { items: PortalWishlistItem[]; setAll: (items: PortalWishlistItem[]) => void }

export function usePortalAccount(bucket: BucketLike, wishlist: WishlistLike) {
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
    if (!fn) { setError('Accounts are unavailable right now.'); setErrorCode(''); return false }
    setBusy(true)
    setError('')
    setErrorCode('')
    try {
      const result = await fn(payload)
      const profile = readProfile(result)
      if (!profile) throw new Error('The account response was incomplete. Please try again.')
      setAccount(profile)
      setConsentRenewal(false)
      await hydrate()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
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
    if (!fn) { setError('Accounts are unavailable right now.'); setErrorCode(''); return false }
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
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
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
