import type { ComponentType, FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js'
import Building2 from 'lucide-react/dist/esm/icons/building-2.js'
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up.js'
import Chrome from 'lucide-react/dist/esm/icons/chrome.js'
import Eye from 'lucide-react/dist/esm/icons/eye.js'
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import LockKeyhole from 'lucide-react/dist/esm/icons/lock-keyhole.js'
import Mail from 'lucide-react/dist/esm/icons/mail.js'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import QuickPreferenceToggles from '../shared/QuickPreferenceToggles'
import { STORAGE_KEYS } from '../../constants'
import { getClientDeviceInfo } from '../../utils/deviceInfo.ts'
import { getPortalConfig } from '../../api/portalPublicTransport.ts'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'

const OAUTH_PENDING_TTL_MS = 30 * 60 * 1000

// Admin sign-in is Business OS branding; the storefront is Leang Beauty.
//
// This REVERSES an earlier decision recorded here, at explicit request
// (Aug 25 2026): "business-os logo for admin page, default... leang
// cosmetics logo, wire to everything business logo, public website logo,
// favicon and the pwa logo for public website". The previous version
// defaulted this page to the storefront icon on the reasoning that a
// single-tenant deployment should look like the merchant everywhere. The
// two brands are now deliberately split by AUDIENCE instead: staff signing
// into the admin app see the product they are signing into, customers see
// the shop. It also removes a visible inconsistency -- this page already
// rendered the heading "Business OS" above the pink storefront icon.
//
// Only the DEFAULT changes. A merchant logo configured in settings still
// wins, via the brandLogo/brandName state below.
//
// The storefront's own defaults are untouched and must stay Leang
// Beauty: PublicCatalogPage.tsx's DEFAULT_PUBLIC_PORTAL_ICON (the live
// customer site, its favicon and its PWA icon) and CatalogPage.tsx's
// DEFAULT_PORTAL_ICON_SRC (the admin-side preview OF that customer site).
// tests/brandIcons.test.ts pins the whole split.
const DEFAULT_LOGIN_LOGO_SRC = '/icon-512.png'
const DEFAULT_LOGIN_BRAND_NAME = 'Business OS'

type IdValue = string | number
type TranslateFunction = (key: string) => string | undefined
type TranslationLookup = (key: string, fallback: string) => string
type OAuthProvider = 'google' | string

interface AuthUser {
  id?: IdValue
  name?: string
  username?: string
  organization_id?: IdValue | null
  organization_name?: string
  organization_slug?: string
  organization_public_id?: string
}

interface AppSettings {
  login_session_duration?: string | null
}

interface LoginResult {
  success?: boolean
  error?: string
  message?: string
  otpRequired?: boolean
  // Minted by the first factor (password / Google identity) and required by
  // /otp/verify -- the server refuses a code that arrives without it.
  otpChallenge?: string
  userId?: IdValue
  user?: AuthUser
  sessionExpiresAt?: string
  deviceApprovalRequired?: boolean
  deviceStatus?: 'pending' | 'rejected'
}

interface AppContextValue {
  login: (username: string, password: string, sessionDuration?: string, organization?: string) => Promise<LoginResult>
  persistAuthenticatedUser: (user: AuthUser, sessionDuration?: string, sessionExpiresAt?: string) => Promise<void>
  settings?: AppSettings | null
  t: TranslateFunction
  language?: string
}

interface OrganizationMatch {
  id?: IdValue | null
  name?: string | null
  slug?: string | null
  public_id?: string | null
}

interface PendingOauthLogin {
  mode?: string
  provider?: OAuthProvider
  organization?: OrganizationMatch | null
  startedAt?: number
}

interface OauthCallbackResult extends LoginResult {
  mode?: string
  provider?: OAuthProvider
  status?: string
}

interface VerificationCapabilities {
  success?: boolean
  google_oauth?: boolean
  google_email_auth?: boolean
  google_login?: {
    enabled?: boolean
  } | null
}

interface OrganizationBootstrap {
  organization?: OrganizationMatch | null
  organizationCreationEnabled?: boolean
}

interface OrganizationSearchResult {
  items?: OrganizationMatch[]
}

interface PasswordResetResult {
  success?: boolean
  error?: string
  message?: string
}

interface StartOauthResult extends PasswordResetResult {
  url?: string
}

interface DeviceContext {
  deviceTz?: string | null
  deviceName?: string | null
}

interface AuthApi {
  getVerificationCapabilities?: () => Promise<VerificationCapabilities>
  getOrganizationBootstrap?: () => Promise<OrganizationBootstrap>
  searchOrganizations?: (query: string) => Promise<OrganizationSearchResult>
  completeGoogleOauth: (payload: {
    accessToken: string
    provider: OAuthProvider
    mode: 'login'
    organization: string
    sessionDuration: string
    clientTime: string
    deviceTz?: string | null
    deviceName?: string | null
  }) => Promise<LoginResult>
  otpVerify: (payload: {
    userId: IdValue | null
    token: string
    otpChallenge?: string
    sessionDuration: string
    clientTime: string
    deviceTz?: string | null
    deviceName?: string | null
  }) => Promise<LoginResult>
  resetPasswordWithOtp: (payload: {
    identifier: string
    organization: string
    otp: string
    newPassword: string
  }) => Promise<PasswordResetResult>
  requestPasswordResetEmail: (payload: {
    identifier: string
    organization: string
    redirectTo: string
  }) => Promise<PasswordResetResult>
  completePasswordReset: (payload: {
    accessToken: string
    newPassword: string
  }) => Promise<PasswordResetResult>
  startGoogleOauth: (payload: {
    provider: OAuthProvider
    mode: 'login'
    organization: string
    redirectTo: string
  }) => Promise<StartOauthResult>
}

interface OauthButtonProps {
  icon: ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  disabled: boolean
  loading: boolean
}

interface ModeBackButtonProps {
  label: string
  onClick: () => void
}

const useApp = useAppHook as () => AppContextValue

function getAuthApi(): AuthApi {
  if (typeof window === 'undefined' || !window.api) throw new Error('Auth API is not available.')
  return window.api as AuthApi
}

function getErrorMessage(error: unknown, fallback: string): string {
  return String((error as { message?: unknown })?.message || fallback)
}

function readPendingOauthLogin(): PendingOauthLogin | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.OAUTH_LOGIN_PENDING) || ''
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingOauthLogin | null
    if (!parsed || typeof parsed !== 'object') return null
    const startedAt = Number(parsed.startedAt || 0)
    if (!startedAt || (Date.now() - startedAt) > OAUTH_PENDING_TTL_MS) return null
    return parsed
  } catch (_) {
    return null
  }
}

function clearPendingOauthLogin(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.OAUTH_LOGIN_PENDING)
  } catch (_) {}
}

function readOauthCallbackResult(): OauthCallbackResult | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.OAUTH_CALLBACK_RESULT) || ''
    if (!raw) return null
    const parsed = JSON.parse(raw) as OauthCallbackResult | null
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch (_) {
    return null
  }
}

function clearOauthCallbackResult(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.OAUTH_CALLBACK_RESULT)
  } catch (_) {}
}

function OauthButton({ icon: Icon, label, onClick, disabled, loading }: OauthButtonProps) {
  return (
    <button
      type="button"
      className="btn-secondary flex w-full items-center justify-center gap-2 py-2.5"
      onClick={onClick}
      disabled={disabled}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      <span>{label}</span>
    </button>
  )
}

function ModeBackButton({ label, onClick }: ModeBackButtonProps) {
  return (
    <button
      type="button"
      className="inline-flex w-full items-center justify-center gap-2 py-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
      onClick={onClick}
    >
      <ArrowLeft className="h-4 w-4" />
      <span>{label}</span>
    </button>
  )
}

export default function Login() {
  const { login, persistAuthenticatedUser, settings, t } = useApp()
  const authApi = getAuthApi()
  const tr: TranslationLookup = (key, fallback) => {
    const value = typeof t === 'function' ? t(key) : null
    return value && value !== key ? value : fallback
  }

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [otpRequired, setOtpRequired] = useState(false)
  const [pendingUserId, setPendingUserId] = useState<IdValue | null>(null)
  const [pendingOtpChallenge, setPendingOtpChallenge] = useState<string>('')
  const [deviceApprovalPending, setDeviceApprovalPending] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | ''>('')
  const capabilityRequestRef = useRef(0)
  const organizationBootstrapRequestRef = useRef(0)
  const organizationSearchRequestRef = useRef(0)
  const oauthCallbackRequestRef = useRef(0)
  const passwordResetActionRef = useRef(false)
  const oauthStartInFlightRef = useRef(false)
  const loginSubmitInFlightRef = useRef(false)
  const otpVerifyInFlightRef = useRef(false)

  const [showOtpReset, setShowOtpReset] = useState(false)
  const [showEmailReset, setShowEmailReset] = useState(false)
  const [recoveryAccessToken, setRecoveryAccessToken] = useState('')
  const [resetIdentifier, setResetIdentifier] = useState('')
  const [resetOtp, setResetOtp] = useState('')
  const [resetNewPassword, setResetNewPassword] = useState('')
  const [resetConfirmPassword, setResetConfirmPassword] = useState('')
  const [resetInfo, setResetInfo] = useState('')
  const [verificationCaps, setVerificationCaps] = useState({
    googleOauth: false,
    googleLoginAuth: false,
    googleLoginEmailAuth: false,
  })
  const [organizationSearch, setOrganizationSearch] = useState('')
  const [organizationId, setOrganizationId] = useState('')
  const [organizationMatches, setOrganizationMatches] = useState<OrganizationMatch[]>([])
  const [organizationLoading, setOrganizationLoading] = useState(false)
  const [organizationLocked, setOrganizationLocked] = useState(false)
  // User-reported ask: "Lock the organization field to LeangCosmetics by
  // default... Do not remove the ability to unlock/edit -- allow unpinning
  // specifically when switching to a different organization." The locked
  // render below used to be a hard `null` with no way back -- correct for
  // "don't make me retype it every time" but left no path at all for the
  // rare real case (switching to a different org on a shared device).
  // This is a separate, user-driven override on top of organizationLocked
  // (which stays server-driven/unchanged) -- starts false so the default,
  // common case is still zero extra taps; only set once someone explicitly
  // asks to switch, via the small unlock control in the locked row below.
  const [organizationManuallyUnlocked, setOrganizationManuallyUnlocked] = useState(false)
  const organizationEffectivelyLocked = organizationLocked && !organizationManuallyUnlocked
  // True once the organization-bootstrap fetch below has actually resolved
  // (success or failure) -- lets the picker UI hide itself only once we
  // *know* this deployment is locked to a single org, instead of hiding on
  // first paint (before organizationLocked has a real value) and then
  // flashing back in. See the organizationLocked-gated render below.
  const [organizationBootstrapped, setOrganizationBootstrapped] = useState(false)
  const [organizationExpanded, setOrganizationExpanded] = useState(() => {
    try {
      const remembered = JSON.parse(localStorage.getItem(STORAGE_KEYS.ORGANIZATION) || 'null') as OrganizationMatch | null
      return !(remembered?.name || remembered?.slug || remembered?.public_id)
    } catch (_) {
      return true
    }
  })
  // The merchant's own logo/business name, not "Business OS" -- fetched
  // from the same curated, unauthenticated endpoint the public customer
  // portal uses (routes/portal.ts's GET /config, whitelists only
  // customer-facing branding fields off the settings table). Needed here
  // because /api/settings itself requires auth (by design -- see that
  // route's own comment) and can't be reached before someone has logged
  // in. Login previously always showed the generic Building2 icon and the
  // literal string "Business OS" regardless of which business this
  // deployment actually belongs to (user-reported: "old logo icon still
  // shows in login page"). Falls back to the generic icon/name below if
  // this fetch fails, is still loading, or the merchant has no logo
  // uploaded/has logo display turned off (showLogo) -- never a broken
  // image or blank title.
  // User-reported: "the busines-os logo in login page the icon hasn't been
  // removed" -- this app has always been a single-tenant Leang Beauty
  // deployment, so defaulting to the generic Building2 icon/"Business OS"
  // string (only overridden once the config fetch below resolves) meant
  // every fresh page load flashed the wrong branding first. Default to the
  // same bundled Leang Beauty icon/name the public catalog side already
  // falls back to (PublicCatalogPage.tsx's DEFAULT_PUBLIC_PORTAL_ICON,
  // portalManifest.ts's DEFAULT_PORTAL_MANIFEST_NAME) so first paint is
  // already correct; still overridden by the live config fetch below the
  // instant a real uploaded logo/name is configured in Settings.
  const [brandLogo, setBrandLogo] = useState(DEFAULT_LOGIN_LOGO_SRC)
  const [brandName, setBrandName] = useState(DEFAULT_LOGIN_BRAND_NAME)

  useEffect(() => {
    let cancelled = false
    getPortalConfig()
      .then((config) => {
        if (cancelled) return
        const cfg = (config || {}) as { businessLogo?: string; businessName?: string; showLogo?: boolean }
        if (cfg.showLogo !== false && cfg.businessLogo) setBrandLogo(cfg.businessLogo)
        if (cfg.businessName) setBrandName(cfg.businessName)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const usernameRef = useRef<HTMLInputElement | null>(null)
  const otpRef = useRef<HTMLInputElement | null>(null)
  const organizationDisplayName = organizationSearch || tr('organization_not_selected', 'Choose organization')
  const loginFeatureFast = tr('auth_feature_fast', 'Fast daily workflow')
  const loginFeatureSecure = tr('auth_feature_secure', 'Protected business access')
  const loginFeatureSynced = tr('auth_feature_synced', 'Live server-backed data')
  const loginFeatureTrusted = tr('auth_feature_trusted', 'Built for shared teams')

  const rememberOrganization = (item: OrganizationMatch) => {
    try {
      localStorage.setItem(STORAGE_KEYS.ORGANIZATION, JSON.stringify({
        id: item?.id || null,
        name: item?.name || organizationSearch || '',
        slug: item?.slug || '',
        public_id: item?.public_id || organizationId || '',
      }))
    } catch (_) {}
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      if (otpRequired) otpRef.current?.focus()
      else usernameRef.current?.focus()
    }, 150)
    return () => clearTimeout(timer)
  }, [otpRequired, showOtpReset, showEmailReset, recoveryAccessToken])

  // Session duration is not user-selectable on this page (the removed
  // "keep me logged in" control). It's derived from the account's saved
  // preference (Settings > Profile > Default login duration).
  //
  // The fallback is 'always', matching the server's DEFAULT_SESSION_MS
  // intent (lib/auth.ts). It used to be 'session', which the server maps
  // to 24 HOURS -- so any account without a saved preference was silently
  // signed out every day, which the user reported as "logged out after a
  // few hours". The security model here is device approval, not short
  // sessions: a device begins pending until an admin approves it, and an
  // admin revoke kills the device's LIVE sessions immediately
  // (revokeSessionsForDevice) -- so an approved device staying signed in
  // until revoked is the intended behavior, per the Aug 28 request.
  const sessionDuration = String(settings?.login_session_duration || '').trim() || 'always'

  useEffect(() => {
    const loadCapabilities = async () => {
      const requestId = beginTrackedRequest(capabilityRequestRef)
      try {
        const result = await withLoaderTimeout(
          () => authApi.getVerificationCapabilities?.(),
          'Verification capabilities',
        )
        if (!isTrackedRequestCurrent(capabilityRequestRef, requestId) || !result || result.success === false) return
        setVerificationCaps({
          googleOauth: result.google_oauth === true,
          googleLoginAuth: result.google_oauth === true || result.google_login?.enabled === true,
          googleLoginEmailAuth: result.google_email_auth === true,
        })
      } catch (_) {}
    }
    loadCapabilities()
    return () => { invalidateTrackedRequest(capabilityRequestRef) }
  }, [])

  useEffect(() => {
    const bootstrap = async () => {
      const requestId = beginTrackedRequest(organizationBootstrapRequestRef)
      try {
        const remembered = JSON.parse(localStorage.getItem(STORAGE_KEYS.ORGANIZATION) || 'null') as OrganizationMatch | null
        const boot = await withLoaderTimeout(
          () => authApi.getOrganizationBootstrap?.(),
          'Organization bootstrap',
        )
        if (!isTrackedRequestCurrent(organizationBootstrapRequestRef, requestId)) return
        const serverOrg = boot?.organization || null
        const rememberedUsable = remembered && (remembered.public_id || remembered.slug || remembered.id)
          ? remembered
          : null
        const fallbackOrg = serverOrg && !boot?.organizationCreationEnabled
          ? serverOrg
          : (rememberedUsable || serverOrg || null)
        if (fallbackOrg) {
          setOrganizationSearch(fallbackOrg.name || fallbackOrg.slug || '')
          setOrganizationId(fallbackOrg.public_id || fallbackOrg.slug || '')
          setOrganizationMatches(fallbackOrg ? [fallbackOrg] : [])
          setOrganizationExpanded(false)
          rememberOrganization(fallbackOrg)
          if (boot?.organization && !boot.organizationCreationEnabled) {
            setOrganizationLocked(true)
          }
        }
      } catch (_) {
      } finally {
        if (isTrackedRequestCurrent(organizationBootstrapRequestRef, requestId)) setOrganizationBootstrapped(true)
      }
    }
    bootstrap()
    return () => { invalidateTrackedRequest(organizationBootstrapRequestRef) }
  }, [])

  useEffect(() => {
    const query = String(organizationSearch || '').trim()
    if (!query) {
      invalidateTrackedRequest(organizationSearchRequestRef)
      setOrganizationMatches([])
      setOrganizationLoading(false)
      return undefined
    }
    const timer = setTimeout(async () => {
      const requestId = beginTrackedRequest(organizationSearchRequestRef)
      setOrganizationLoading(true)
      try {
        const result = await withLoaderTimeout(
          () => authApi.searchOrganizations?.(query),
          'Organization search',
        )
        if (!isTrackedRequestCurrent(organizationSearchRequestRef, requestId)) return
        setOrganizationMatches(Array.isArray(result?.items) ? result.items : [])
      } catch (_) {
        if (isTrackedRequestCurrent(organizationSearchRequestRef, requestId)) setOrganizationMatches([])
      } finally {
        if (isTrackedRequestCurrent(organizationSearchRequestRef, requestId)) setOrganizationLoading(false)
      }
    }, 180)
    return () => {
      invalidateTrackedRequest(organizationSearchRequestRef)
      clearTimeout(timer)
    }
  }, [authApi, organizationSearch])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const requestId = beginTrackedRequest(oauthCallbackRequestRef)
    const url = new URL(window.location.href)
    const mode = String(url.searchParams.get('auth_mode') || '').trim().toLowerCase()

    const hash = new URLSearchParams((window.location.hash || '').replace(/^#/, ''))
    const accessToken = hash.get('access_token') || ''
    const tokenType = String(hash.get('type') || url.searchParams.get('type') || '').trim().toLowerCase()
    const provider = String(url.searchParams.get('auth_provider') || '').trim().toLowerCase()
    const errorDescription = hash.get('error_description') || url.searchParams.get('error_description') || ''
    const callbackResult = readOauthCallbackResult()
    const matchingStoredCallback = callbackResult
      && String(callbackResult.mode || '').trim().toLowerCase() === mode
      && (!provider || String(callbackResult.provider || '').trim().toLowerCase() === provider)
    if (!accessToken && !errorDescription && !matchingStoredCallback) return undefined

    const clearCallbackUrl = () => {
      const cleanUrl = `${url.origin}${url.pathname}`
      window.history.replaceState({}, document.title, cleanUrl)
    }

    const run = async () => {
      if (tokenType === 'recovery' && accessToken) {
        clearPendingOauthLogin()
        clearCallbackUrl()
        if (!isTrackedRequestCurrent(oauthCallbackRequestRef, requestId)) return
        setRecoveryAccessToken(accessToken)
        setShowEmailReset(false)
        setShowOtpReset(false)
        setError('')
        setResetInfo(tr('set_new_password_from_email', 'Set your new password below to finish email recovery.'))
        return
      }

      if (mode !== 'login') {
        clearPendingOauthLogin()
        clearOauthCallbackResult()
        clearCallbackUrl()
        return
      }

      if (matchingStoredCallback) {
        clearPendingOauthLogin()
        clearOauthCallbackResult()
        clearCallbackUrl()
        if (!isTrackedRequestCurrent(oauthCallbackRequestRef, requestId)) return
        if (callbackResult.status !== 'success') {
          setError(callbackResult.error || tr('oauth_signin_failed', 'Sign-in with provider failed.'))
          return
        }
        if (callbackResult.deviceApprovalRequired) {
          setDeviceApprovalPending(true)
          setError(callbackResult.deviceStatus === 'rejected'
            ? tr('device_rejected', callbackResult.error || 'This device was denied access by an administrator.')
            : '')
          return
        }
        if (callbackResult.otpRequired) {
          setOtpRequired(true)
          setPendingUserId(callbackResult.userId ?? null)
          setPendingOtpChallenge(callbackResult.otpChallenge || '')
          return
        }
        if (callbackResult.user) {
          await persistAuthenticatedUser(callbackResult.user, sessionDuration, callbackResult.sessionExpiresAt || '')
          return
        }
        setError(callbackResult.error || tr('oauth_signin_failed', 'Sign-in with provider failed.'))
        return
      }

      if (errorDescription) {
        clearPendingOauthLogin()
        clearOauthCallbackResult()
        clearCallbackUrl()
        if (isTrackedRequestCurrent(oauthCallbackRequestRef, requestId)) setError(errorDescription)
        return
      }

      setLoading(true)
      setError('')
      try {
        const device = getClientDeviceInfo()
        const pendingOauth = readPendingOauthLogin()
        const rememberedOrg = (() => {
          if (pendingOauth?.organization?.public_id || pendingOauth?.organization?.slug) {
            return pendingOauth.organization.public_id || pendingOauth.organization.slug || ''
          }
          try {
            const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.ORGANIZATION) || 'null') as OrganizationMatch | null
            return stored?.public_id || stored?.slug || ''
          } catch (_) {
            return ''
          }
        })()
        const result = await withLoaderTimeout(() => authApi.completeGoogleOauth({
          accessToken,
          provider: pendingOauth?.provider || provider,
          mode: 'login',
          organization: rememberedOrg,
          sessionDuration,
          clientTime: new Date().toISOString(),
          deviceTz: device.deviceTz,
          deviceName: device.deviceName,
        }), 'OAuth sign-in completion')
        clearCallbackUrl()
        clearPendingOauthLogin()
        clearOauthCallbackResult()
        if (!isTrackedRequestCurrent(oauthCallbackRequestRef, requestId)) return

        if (result?.deviceApprovalRequired) {
          setDeviceApprovalPending(true)
          setError(result.deviceStatus === 'rejected'
            ? tr('device_rejected', result.error || 'This device was denied access by an administrator.')
            : '')
          return
        }
        if (result?.otpRequired) {
          setOtpRequired(true)
          setPendingUserId(result.userId ?? null)
          setPendingOtpChallenge(result.otpChallenge || '')
          return
        }
        if (result?.success && result?.user) {
          await persistAuthenticatedUser(result.user, sessionDuration, result.sessionExpiresAt || '')
          return
        }
        setError(result?.error || tr('oauth_signin_failed', 'Sign-in with provider failed.'))
      } catch (oauthError) {
        clearCallbackUrl()
        clearPendingOauthLogin()
        clearOauthCallbackResult()
        if (isTrackedRequestCurrent(oauthCallbackRequestRef, requestId)) {
          setError(getErrorMessage(oauthError, tr('oauth_signin_failed', 'Sign-in with provider failed.')))
        }
      } finally {
        if (isTrackedRequestCurrent(oauthCallbackRequestRef, requestId)) setLoading(false)
      }
    }

    run()
    return () => { invalidateTrackedRequest(oauthCallbackRequestRef) }
  }, [authApi, persistAuthenticatedUser, sessionDuration, t])

  const getDeviceContext = (): DeviceContext => getClientDeviceInfo()

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (loginSubmitInFlightRef.current) return
    const resolvedOrganization = String(organizationId || organizationSearch || '').trim()
    if (!resolvedOrganization) {
      setError(tr('enter_organization_first', 'Please choose your organization first.'))
      return
    }
    setError('')
    loginSubmitInFlightRef.current = true
    setLoading(true)
    try {
      const result = await withLoaderTimeout(
        () => Promise.resolve(login(username, password, sessionDuration, resolvedOrganization)),
        'Login',
      )
      if (result?.deviceApprovalRequired) {
        setDeviceApprovalPending(true)
        setError(result.deviceStatus === 'rejected'
          ? tr('device_rejected', result.error || 'This device was denied access by an administrator.')
          : '')
        return
      }
      if (result?.otpRequired) {
        setOtpRequired(true)
        setPendingUserId(result.userId ?? null)
        setPendingOtpChallenge(result.otpChallenge || '')
        return
      }
      if (!result?.success) setError(result?.error || 'Login failed')
    } catch (loginError) {
      setError(getErrorMessage(loginError, tr('login_failed_try_again', 'Login failed. Please try again.')))
    } finally {
      loginSubmitInFlightRef.current = false
      setLoading(false)
    }
  }

  const handleOtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (otpVerifyInFlightRef.current) return
    if (!otp.trim()) {
      setError(tr('enter_6_digit_code', 'Please enter the 6-digit code'))
      return
    }
    setError('')
    otpVerifyInFlightRef.current = true
    setLoading(true)
    try {
      const device = getClientDeviceInfo()
      const verifyResult = await withLoaderTimeout(() => authApi.otpVerify({
        userId: pendingUserId,
        token: otp.trim(),
        // Binds this code to the password/Google step that minted it -- the
        // server refuses a bare userId+code without a live challenge.
        otpChallenge: pendingOtpChallenge,
        sessionDuration,
        clientTime: new Date().toISOString(),
        deviceTz: device.deviceTz,
        deviceName: device.deviceName,
      }), 'OTP verification')

      if (verifyResult?.deviceApprovalRequired) {
        // The server re-runs the device gate at the OTP step now -- same
        // pending-approval screen as the password step's answer.
        setDeviceApprovalPending(true)
        setError(verifyResult.deviceStatus === 'rejected'
          ? tr('device_rejected', verifyResult.error || 'This device was denied access by an administrator.')
          : '')
      } else if (verifyResult?.success && verifyResult?.user) {
        await persistAuthenticatedUser(verifyResult.user, sessionDuration, verifyResult.sessionExpiresAt || '')
      } else {
        setError(verifyResult?.error || tr('invalid_otp_code', 'Invalid OTP code'))
      }
    } catch (otpError) {
      setError(getErrorMessage(otpError, tr('otp_verification_failed', 'OTP verification failed')))
    } finally {
      otpVerifyInFlightRef.current = false
      setLoading(false)
    }
  }

  const handleOtpInput = (value: string) => {
    const clean = value.replace(/\D/g, '').slice(0, 6)
    setOtp(clean)
  }

  const handleResetWithOtp = async () => {
    if (passwordResetActionRef.current) return
    const resolvedOrganization = String(organizationId || organizationSearch || '').trim()
    if (!resolvedOrganization) return setError(tr('enter_organization_first', 'Please choose your organization first.'))
    if (!resetIdentifier.trim()) return setError(tr('enter_username_email_first', 'Enter your username or email first.'))
    if (!resetOtp.trim()) return setError(tr('enter_otp_first', 'Enter the OTP code from your authenticator app.'))
    if (resetNewPassword.length < 6) return setError(tr('password_min_6', 'Use at least 6 characters for the new password.'))
    if (resetNewPassword !== resetConfirmPassword) return setError(tr('password_confirm_mismatch', 'Password confirmation does not match.'))

    setError('')
    passwordResetActionRef.current = true
    setLoading(true)
    try {
      const result = await withLoaderTimeout(() => authApi.resetPasswordWithOtp({
        identifier: resetIdentifier.trim(),
        organization: resolvedOrganization,
        otp: resetOtp.trim(),
        newPassword: resetNewPassword,
      }), 'OTP password reset')
      if (result?.success === false) {
        setError(result.error || tr('otp_reset_failed', 'Failed to reset password with OTP.'))
        return
      }
      setResetInfo(tr('otp_password_reset_done', 'Password reset complete. You can now sign in with the new password.'))
      setPassword('')
      setOtp('')
      setResetOtp('')
      setResetNewPassword('')
      setResetConfirmPassword('')
    } catch (resetError) {
      setError(getErrorMessage(resetError, tr('otp_reset_failed', 'Failed to reset password with OTP.')))
    } finally {
      passwordResetActionRef.current = false
      setLoading(false)
    }
  }

  const handleResetWithEmail = async () => {
    if (passwordResetActionRef.current) return
    const resolvedOrganization = String(organizationId || organizationSearch || '').trim()
    if (!resolvedOrganization) return setError(tr('enter_organization_first', 'Please choose your organization first.'))
    if (!resetIdentifier.trim()) return setError(tr('enter_username_email_first', 'Enter your username, name, email, or phone first.'))

    setError('')
    passwordResetActionRef.current = true
    setLoading(true)
    try {
      const redirectTo = `${window.location.origin}${window.location.pathname}`
      const result = await withLoaderTimeout(() => authApi.requestPasswordResetEmail({
        identifier: resetIdentifier.trim(),
        organization: resolvedOrganization,
        redirectTo,
      }), 'Email password reset')
      if (result?.success === false) {
        setError(result.error || tr('email_reset_failed', 'Failed to send password reset email.'))
        return
      }
      setResetInfo(result?.message || tr('email_reset_sent', 'If this account can receive recovery email, reset instructions have been sent.'))
    } catch (resetError) {
      setError(getErrorMessage(resetError, tr('email_reset_failed', 'Failed to send password reset email.')))
    } finally {
      passwordResetActionRef.current = false
      setLoading(false)
    }
  }

  const handleCompleteEmailReset = async () => {
    if (passwordResetActionRef.current) return
    if (!recoveryAccessToken) {
      setError(tr('recovery_link_missing', 'Recovery link is missing or expired. Please request a new email reset link.'))
      return
    }
    if (resetNewPassword.length < 6) return setError(tr('password_min_6', 'Use at least 6 characters for the new password.'))
    if (resetNewPassword !== resetConfirmPassword) return setError(tr('password_confirm_mismatch', 'Password confirmation does not match.'))

    setError('')
    passwordResetActionRef.current = true
    setLoading(true)
    try {
      const result = await withLoaderTimeout(() => authApi.completePasswordReset({
        accessToken: recoveryAccessToken,
        newPassword: resetNewPassword,
      }), 'Complete email password reset')
      if (result?.success === false) {
        setError(result.error || tr('email_reset_complete_failed', 'Failed to update password from recovery email.'))
        return
      }
      setRecoveryAccessToken('')
      setResetNewPassword('')
      setResetConfirmPassword('')
      setResetInfo(tr('email_reset_complete_done', 'Password reset complete. You can now log in with your email and new password.'))
    } catch (resetError) {
      setError(getErrorMessage(resetError, tr('email_reset_complete_failed', 'Failed to update password from recovery email.')))
    } finally {
      passwordResetActionRef.current = false
      setLoading(false)
    }
  }

  const handleStartOauth = async (provider: OAuthProvider) => {
    if (oauthStartInFlightRef.current) return
    const resolvedOrganization = String(organizationId || organizationSearch || '').trim()
    if (!resolvedOrganization) {
      setError(tr('enter_organization_first', 'Please choose your organization first.'))
      return
    }
    setError('')
    oauthStartInFlightRef.current = true
    setOauthLoading(provider)
    try {
      const redirectTo = `${window.location.origin}${window.location.pathname}?auth_mode=login&auth_provider=${encodeURIComponent(provider)}`
      const rememberedMatch = organizationMatches.find((item) => String(item.public_id || '') === String(organizationId || ''))
      rememberOrganization(rememberedMatch || { name: organizationSearch, public_id: organizationId })
      try {
        localStorage.setItem(STORAGE_KEYS.OAUTH_LOGIN_PENDING, JSON.stringify({
          mode: 'login',
          provider,
          organization: {
            id: rememberedMatch?.id || null,
            name: rememberedMatch?.name || organizationSearch || '',
            slug: rememberedMatch?.slug || '',
            public_id: rememberedMatch?.public_id || organizationId || '',
          },
          startedAt: Date.now(),
        }))
      } catch (_) {}
      const result = await withLoaderTimeout(() => authApi.startGoogleOauth({
        provider,
        mode: 'login',
        organization: resolvedOrganization,
        redirectTo,
      }), 'Start OAuth sign-in')
      if (result?.success === false || !result?.url) {
        clearPendingOauthLogin()
        setError(result?.error || tr('oauth_start_failed', 'Unable to start sign-in with provider.'))
        return
      }
      window.location.assign(result.url)
    } catch (oauthError) {
      clearPendingOauthLogin()
      setError(getErrorMessage(oauthError, tr('oauth_start_failed', 'Unable to start sign-in with provider.')))
    } finally {
      oauthStartInFlightRef.current = false
      setOauthLoading('')
    }
  }

  const closeAuxMode = () => {
    setShowOtpReset(false)
    setShowEmailReset(false)
    setRecoveryAccessToken('')
    setError('')
    setResetInfo('')
    setResetOtp('')
    setResetNewPassword('')
    setResetConfirmPassword('')
  }

  return (
    <div className="auth-shell relative min-h-screen overflow-hidden px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl items-center justify-center">
        <div className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6 lg:right-8 lg:top-8">
          <div className="rounded-2xl border border-white/70 bg-white/85 p-1.5 shadow-sm backdrop-blur dark:border-slate-700/80 dark:bg-slate-950/75">
            <QuickPreferenceToggles />
          </div>
        </div>
        <div className="auth-frame grid w-full max-w-5xl overflow-hidden rounded-[2rem] border xl:grid-cols-[1.05fr_0.95fr]">
          <aside className="auth-aside hidden xl:flex">
            <div className="flex h-full flex-col justify-between">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold tracking-[0.14em] text-white/80">
                  <img src={brandLogo} alt="" className="h-4 w-4 shrink-0 rounded-full object-cover" loading="eager" decoding="async" />
                  <span>{brandName}</span>
                </div>
                <h1 className="max-w-md text-4xl font-semibold leading-tight text-white">
                  {tr('secure_signin_workspace', 'Secure sign-in for your business workspace')}
                </h1>
              </div>

              <div className="space-y-5">
                {[
                  { icon: ShieldCheck, title: loginFeatureFast, desc: tr('auth_feature_fast_desc', 'Compact tools for sales, stock, and customer work every day.') },
                  { icon: LockKeyhole, title: loginFeatureSecure, desc: tr('auth_feature_secure_desc', 'Protected sign-in methods, session control, and account recovery.') },
                  { icon: Building2, title: loginFeatureSynced, desc: tr('auth_feature_synced_desc', 'Your workspace stays connected to the live server and current data.') },
                  { icon: Mail, title: loginFeatureTrusted, desc: tr('auth_feature_trusted_desc', 'Made for teams sharing branches, devices, and daily business tasks.') },
                ].map(({ icon: FeatureIcon, title, desc }) => (
                  <div key={title} className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/12 bg-white/10">
                      <FeatureIcon className="h-4 w-4 text-white/70" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white">{title}</div>
                      <div className="mt-0.5 text-xs leading-relaxed text-white/55">{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>
          <div className="auth-card p-5 sm:p-7 lg:p-8">
        {/* Logo and wordmark sit on ONE row rather than stacked, which
            reclaims the vertical space the stacked version spent on a
            14x14 block above a heading. "Sign in to continue" is gone with
            it: on a page whose only content is a sign-in form it restated
            the obvious, and the two remaining subtitles are the ones that
            carry real information (2FA, or which device state you are in).

            The device-approval subtitle is deliberately NOT repeated here
            -- that flow renders its own heading below, and showing the same
            sentence twice on one short screen was the reported redundancy. */}
        <div className="mb-7">
          <div className="flex items-center justify-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg overflow-hidden" style={{ backgroundColor: 'var(--ui-accent, #9c7a3c)', boxShadow: '0 10px 24px rgba(156,122,60,0.28)' }}>
              {otpRequired ? (
                <ShieldCheck className="h-6 w-6" />
              ) : (
                <img src={brandLogo} alt="" className="h-full w-full object-cover" loading="eager" decoding="async" />
              )}
            </div>
            <h1 className="text-2xl font-bold leading-tight text-gray-900 dark:text-white">{brandName}</h1>
          </div>
          {otpRequired ? (
            <p className="mt-2 text-center text-sm text-gray-500 dark:text-gray-400">
              {tr('two_factor_authentication', 'Two-Factor Authentication')}
            </p>
          ) : null}
        </div>

        {!otpRequired && !deviceApprovalPending && !showOtpReset && !showEmailReset && !recoveryAccessToken ? (
          <form onSubmit={handleLogin} className="space-y-4">
            {/* Organization picker -- hidden once we've confirmed (via the
                bootstrap fetch above) that this deployment is locked to a
                single organization, i.e. every real single-tenant
                deployment (org creation is hardcoded disabled server-side,
                see routes/organizations.ts). Showing a "choose your
                organization" box with exactly one always-selected,
                un-editable option was confusing UI for something that was
                never actually a choice here -- this only ever mattered for
                the legacy multi-tenant version this was ported from. The
                underlying organization/session plumbing (AppContext,
                offline-storage partitioning by organizationPublicId) is
                untouched -- this is a display-only change, not a removal
                of the concept, since that plumbing is load-bearing and
                wasn't safe to guess at removing from this sandbox (see
                progress.md's "Organization concept removal" item). Gated
                on organizationBootstrapped so this never flashes the box
                in on first paint and then hides it a moment later --
                nothing renders differently from before until the fetch
                has actually resolved locked. A locked deployment still gets
                a tiny, deliberately low-key unlock control (a bare lock
                icon, no label) rather than the full editable row -- tapping
                it reveals the same search box the unlocked path already
                has, for the rare real case of actually switching
                organizations, without adding a second real UI to maintain. */}
            {organizationEffectivelyLocked && organizationBootstrapped ? (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-gray-50/70 px-3 py-2 dark:bg-slate-900/50">
                <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300">
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  <span className="truncate">{organizationDisplayName}</span>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-full p-1 text-gray-400 hover:text-primary-700 dark:text-gray-500 dark:hover:text-primary-300"
                  onClick={() => {
                    setOrganizationManuallyUnlocked(true)
                    setOrganizationExpanded(true)
                  }}
                  title={tr('switch_organization', 'Switch organization')}
                  aria-label={tr('switch_organization', 'Switch organization')}
                >
                  <LockKeyhole className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : !organizationExpanded && (organizationSearch || organizationId) ? (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-gray-50/70 px-3 py-2 dark:bg-slate-900/50">
                <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300">
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  <span className="truncate">{organizationDisplayName}</span>
                </div>
                {!organizationEffectivelyLocked ? (
                  <button
                    type="button"
                    className="shrink-0 text-[11px] font-semibold text-primary-700 hover:text-primary-800 dark:text-primary-300"
                    onClick={() => setOrganizationExpanded(true)}
                  >
                    {tr('change', 'Change')}
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2 rounded-2xl border border-gray-200 bg-gray-50/85 p-3 dark:border-slate-700 dark:bg-slate-900/60">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                    <Building2 className="h-4 w-4 text-gray-400" />
                    <span>{tr('organization', 'Organization')}</span>
                  </div>
                  {(organizationSearch || organizationId) ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:border-primary-300 hover:text-primary-700 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-200"
                      onClick={() => setOrganizationExpanded(false)}
                    >
                      <span>{tr('hide', 'Hide')}</span>
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
                <label htmlFor="organization-search" className="sr-only">{tr('organization_search', 'Search organization')}</label>
                <input
                  id="organization-search"
                  name="organization_search"
                  className="input"
                  type="text"
                  value={organizationSearch}
                  onChange={(event) => {
                    setOrganizationSearch(event.target.value)
                    setOrganizationId('')
                  }}
                  placeholder="LeangBeauty"
                  autoComplete="organization"
                />
                {organizationLoading ? (
                  <div className="text-xs text-gray-500 dark:text-gray-400">{tr('finding_organization', 'Finding organization...')}</div>
                ) : null}
                {!organizationEffectivelyLocked && organizationMatches.length ? (
                  <div className="flex flex-wrap gap-2">
                    {organizationMatches.map((item) => (
                      <button
                        key={item.public_id || item.slug || item.id}
                        type="button"
                        className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:border-primary-300 hover:text-primary-700 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-200"
                        onClick={() => {
                          setOrganizationSearch(item.name || item.slug || '')
                          setOrganizationId(item.public_id || '')
                          setOrganizationExpanded(false)
                          rememberOrganization(item)
                        }}
                      >
                        {item.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )}

            <div>
              <label htmlFor="login-username" className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <Mail className="h-4 w-4 text-gray-400" />
                <span>{tr('username_name_email_phone', 'Username or email')}</span>
              </label>
              <input
                id="login-username"
                name="username"
                ref={usernameRef}
                className="input h-11"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder={tr('username_placeholder', 'Username, email, or phone')}
                required
                autoComplete="username"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <LockKeyhole className="h-4 w-4 text-gray-400" />
                <span>{t('password')}</span>
              </label>
              {/* pr-11 keeps the typed value clear of the reveal button --
                  without it a long password runs underneath the icon. */}
              <div className="relative">
                <input
                  id="login-password"
                  name="password"
                  className="input h-11 pr-11"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={tr('password', 'Password')}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200"
                  aria-label={showPassword ? tr('hide_password', 'Hide password') : tr('show_password', 'Show password')}
                  title={showPassword ? tr('hide_password', 'Hide password') : tr('show_password', 'Show password')}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error ? <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</div> : null}

            <button className="btn-primary h-11 w-full" type="submit" disabled={loading}>
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{t('loading')}...</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  <span>{t('login')}</span>
                </span>
              )}
            </button>

            {verificationCaps.googleOauth ? (
              <div className="space-y-3 pt-1">
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-gray-200 dark:bg-slate-700" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                    {tr('login_with', 'Login with')}
                  </span>
                  <div className="h-px flex-1 bg-gray-200 dark:bg-slate-700" />
                </div>
                <OauthButton
                  icon={Chrome}
                  label={tr('login_with_google', 'Google')}
                  disabled={!verificationCaps.googleOauth || !!oauthLoading || loading}
                  loading={oauthLoading === 'google'}
                  onClick={() => handleStartOauth('google')}
                />
              </div>
            ) : null}

            {/* One recovery entry point, not two side by side. "Reset with
                OTP" is a METHOD of recovering a password, not a separate
                thing to want, so it now lives inside the Forgot password
                screen alongside the email route and the contact-an-admin
                route -- see the reset panel below. Two peer buttons made
                the person choose a mechanism before they had said what
                they wanted.

                The "Needs an account created by your admin." line under the
                Google button is gone too: it read as a warning about the
                sign-in method rather than the useful statement it was
                trying to be, and the same information is now presented
                where it is actionable, in the recovery screen. */}
            <button
              type="button"
              className="w-full text-sm text-primary-700 hover:text-primary-800 dark:text-primary-300"
              onClick={() => {
                setShowEmailReset(true)
                setShowOtpReset(false)
                setRecoveryAccessToken('')
                setError('')
                setResetInfo('')
                setResetIdentifier(username || '')
              }}
            >
              {tr('reset_password_with_email', 'Forgot password?')}
            </button>

          </form>
        ) : null}

        {!otpRequired && !deviceApprovalPending && showEmailReset && !recoveryAccessToken ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-primary-200 bg-primary-50/90 p-3 text-sm text-primary-800 dark:border-primary-800/40 dark:bg-primary-900/20 dark:text-primary-300">
              {tr('email_reset_notice', "We'll email a reset link if this account has one saved.")}
            </div>
            <div>
              <label htmlFor="email-reset-identifier" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {tr('username_name_email_phone', 'Username, name, email, or phone')}
              </label>
              <input id="email-reset-identifier" name="email_reset_identifier" autoComplete="username" className="input" value={resetIdentifier} onChange={(event) => setResetIdentifier(event.target.value)} placeholder="username / name / phone / email" />
            </div>

            {resetInfo ? <div className="rounded-lg border border-green-100 bg-green-50/90 p-3 text-sm text-green-700 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-300">{resetInfo}</div> : null}
            {error ? <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</div> : null}

            <button className="btn-primary w-full py-3 text-base" type="button" disabled={loading} onClick={handleResetWithEmail}>
              {loading ? tr('sending_reset_email', 'Sending reset email...') : tr('send_reset_email', 'Send reset email')}
            </button>

            {/* The other two ways out, offered here rather than as peer
                buttons on the sign-in form: this is the point at which the
                person has said "I can't get in", so it is the point at
                which the choice of method is meaningful. Email above is the
                default because it needs nothing but the account; OTP only
                works if an authenticator was already set up; and asking an
                admin is the honest fallback when neither applies (this is
                also where the old "needs an account created by your admin"
                line belonged). */}
            <div className="space-y-2 border-t border-gray-200 pt-4 dark:border-slate-700">
              <p className="text-center text-xs text-gray-500 dark:text-gray-400">
                {tr('reset_other_ways', 'Other ways to get back in')}
              </p>
              <button
                type="button"
                className="w-full text-sm text-primary-700 hover:text-primary-800 dark:text-primary-300"
                onClick={() => {
                  setShowOtpReset(true)
                  setShowEmailReset(false)
                  setRecoveryAccessToken('')
                  setError('')
                  setResetInfo('')
                }}
              >
                {tr('reset_password_with_otp', 'Reset with OTP')}
              </button>
              <p className="text-center text-xs text-gray-400 dark:text-gray-500">
                {tr('reset_ask_admin_hint', 'No email or authenticator? Ask your admin to reset it for you.')}
              </p>
            </div>

            <ModeBackButton label={tr('back_to_login', 'Back to login')} onClick={closeAuxMode} />
          </div>
        ) : null}

        {!otpRequired && !deviceApprovalPending && showOtpReset ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-primary-200 bg-primary-50/90 p-3 text-sm text-primary-800 dark:border-primary-800/40 dark:bg-primary-900/20 dark:text-primary-300">
              {tr('otp_reset_notice', 'Enter the code from your authenticator app to set a new password.')}
            </div>
            <div>
              <label htmlFor="reset-identifier" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {tr('username_name_email_phone', 'Username, name, email, or phone')}
              </label>
              <input id="reset-identifier" name="reset_identifier" autoComplete="username" className="input" value={resetIdentifier} onChange={(event) => setResetIdentifier(event.target.value)} placeholder="username / name / phone / email" />
            </div>
            <div>
              <label htmlFor="reset-otp" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {tr('otp_code', 'OTP code')}
              </label>
              <input
                id="reset-otp"
                name="reset_otp"
                autoComplete="one-time-code"
                inputMode="numeric"
                className="input"
                value={resetOtp}
                onChange={(event) => setResetOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6-digit code"
              />
            </div>
            <div>
              <label htmlFor="reset-password-new" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {tr('new_password', 'New password')}
              </label>
              <input id="reset-password-new" name="reset_password_new" type="password" className="input" value={resetNewPassword} onChange={(event) => setResetNewPassword(event.target.value)} autoComplete="new-password" />
            </div>
            <div>
              <label htmlFor="reset-password-confirm" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {tr('confirm_new_password', 'Confirm new password')}
              </label>
              <input id="reset-password-confirm" name="reset_password_confirm" type="password" className="input" value={resetConfirmPassword} onChange={(event) => setResetConfirmPassword(event.target.value)} autoComplete="new-password" />
            </div>

            {resetInfo ? <div className="rounded-lg border border-green-100 bg-green-50/90 p-3 text-sm text-green-700 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-300">{resetInfo}</div> : null}
            {error ? <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</div> : null}

            <button className="btn-primary w-full py-3 text-base" type="button" disabled={loading} onClick={handleResetWithOtp}>
              {loading ? tr('updating_password', 'Updating password...') : tr('reset_password', 'Reset password')}
            </button>

            <ModeBackButton label={tr('back_to_login', 'Back to login')} onClick={closeAuxMode} />
          </div>
        ) : null}

        {!otpRequired && !deviceApprovalPending && recoveryAccessToken ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-primary-200 bg-primary-50/90 p-3 text-sm text-primary-800 dark:border-primary-800/40 dark:bg-primary-900/20 dark:text-primary-300">
              {resetInfo || tr('set_new_password_from_email', 'Set your new password below to finish email recovery.')}
            </div>
            <div>
              <label htmlFor="recovery-password-new" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {tr('new_password', 'New password')}
              </label>
              <input id="recovery-password-new" name="recovery_password_new" type="password" className="input" value={resetNewPassword} onChange={(event) => setResetNewPassword(event.target.value)} autoComplete="new-password" />
            </div>
            <div>
              <label htmlFor="recovery-password-confirm" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {tr('confirm_new_password', 'Confirm new password')}
              </label>
              <input id="recovery-password-confirm" name="recovery_password_confirm" type="password" className="input" value={resetConfirmPassword} onChange={(event) => setResetConfirmPassword(event.target.value)} autoComplete="new-password" />
            </div>

            {error ? <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</div> : null}

            <button className="btn-primary w-full py-3 text-base" type="button" disabled={loading} onClick={handleCompleteEmailReset}>
              {loading ? tr('updating_password', 'Updating password...') : tr('save_new_password', 'Save new password')}
            </button>

            <ModeBackButton label={tr('back_to_login', 'Back to login')} onClick={closeAuxMode} />
          </div>
        ) : null}

        {otpRequired && !deviceApprovalPending ? (
          <form onSubmit={handleOtp} className="space-y-5">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300">
                <ShieldCheck className="h-7 w-7" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{tr('enter_authenticator_code', 'Enter authenticator code')}</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {tr('otp_login_hint', 'Open your authenticator app and enter the current 6-digit OTP code.')}
              </p>
            </div>

            <div>
              <label htmlFor="otp-code" className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <ShieldCheck className="h-4 w-4 text-gray-400" />
                <span>{tr('otp_code', 'OTP code')}</span>
              </label>
              <input
                id="otp-code"
                name="otp_code"
                ref={otpRef}
                className="input text-center text-lg tracking-[0.35em]"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                onChange={(event) => handleOtpInput(event.target.value)}
                placeholder="000000"
              />
            </div>

            {error ? <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</div> : null}

            <button className="btn-primary w-full py-3 text-base" type="submit" disabled={loading}>
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{tr('verifying', 'Verifying...')}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  <span>{tr('verify_and_continue', 'Verify & continue')}</span>
                </span>
              )}
            </button>

            <button
              type="button"
              className="w-full text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
              onClick={() => {
                setOtpRequired(false)
                setPendingUserId(null)
                setPendingOtpChallenge('')
                setOtp('')
                setError('')
              }}
            >
              {tr('back', 'Back')}
            </button>
          </form>
        ) : null}

        {deviceApprovalPending ? (
          <div className="space-y-5">
            {/* One shield, one heading. The card header above used to render
                its own ShieldCheck and repeat this exact title, so this
                screen showed the same icon twice and the same sentence
                twice -- both reported. The header now stays on the brand
                logo for this flow and leaves the state to this block. */}
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400">
                <ShieldCheck className="h-7 w-7" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {tr('device_approval_pending_title', 'Waiting for device approval')}
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {tr(
                  'device_approval_pending_desc',
                  'An admin needs to approve this new device first.',
                )}
              </p>
            </div>

            {error ? <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</div> : null}

            <button
              className="btn-primary w-full py-3 text-base"
              type="button"
              disabled={loading}
              onClick={() => handleLogin({ preventDefault: () => {} } as FormEvent<HTMLFormElement>)}
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{tr('checking_approval_status', 'Checking approval status...')}</span>
                </span>
              ) : (
                tr('check_again', 'Check again')
              )}
            </button>

            <button
              type="button"
              className="w-full text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
              onClick={() => {
                setDeviceApprovalPending(false)
                setError('')
              }}
            >
              {tr('back', 'Back')}
            </button>
          </div>
        ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

