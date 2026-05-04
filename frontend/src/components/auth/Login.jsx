import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Building2,
  ChevronDown,
  ChevronUp,
  Chrome,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from 'lucide-react'
import { useApp } from '../../AppContext'
import QuickPreferenceToggles from '../shared/QuickPreferenceToggles'
import { STORAGE_KEYS } from '../../constants'
import { getClientDeviceInfo } from '../../utils/deviceInfo.js'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.mjs'

const OAUTH_PENDING_TTL_MS = 30 * 60 * 1000

function readPendingOauthLogin() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.OAUTH_LOGIN_PENDING) || ''
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const startedAt = Number(parsed.startedAt || 0)
    if (!startedAt || (Date.now() - startedAt) > OAUTH_PENDING_TTL_MS) return null
    return parsed
  } catch (_) {
    return null
  }
}

function clearPendingOauthLogin() {
  try {
    localStorage.removeItem(STORAGE_KEYS.OAUTH_LOGIN_PENDING)
  } catch (_) {}
}

function OauthButton({ icon: Icon, label, onClick, disabled, loading }) {
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

function ModeBackButton({ label, onClick }) {
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
  const { login, persistAuthenticatedUser, settings, t, language } = useApp()
  const tr = (key, fallback) => {
    const value = typeof t === 'function' ? t(key) : null
    return value && value !== key ? value : fallback
  }

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [otpRequired, setOtpRequired] = useState(false)
  const [pendingUserId, setPendingUserId] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState('')
  const [sessionDuration, setSessionDuration] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.SESSION_DURATION) || 'session'
    } catch (_) {
      return 'session'
    }
  })
  const sessionDurationTouchedRef = useRef(false)
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
  const [organizationMatches, setOrganizationMatches] = useState([])
  const [organizationLoading, setOrganizationLoading] = useState(false)
  const [organizationLocked, setOrganizationLocked] = useState(false)
  const [organizationExpanded, setOrganizationExpanded] = useState(() => {
    try {
      const remembered = JSON.parse(localStorage.getItem(STORAGE_KEYS.ORGANIZATION) || 'null')
      return !(remembered?.name || remembered?.slug || remembered?.public_id)
    } catch (_) {
      return true
    }
  })

  const usernameRef = useRef()
  const otpRef = useRef()
  const organizationDisplayName = organizationSearch || tr('organization_not_selected', 'Choose organization')
  const loginShellDescription = tr(
    'auth_welcome_body',
    'Sign in to manage sales, stock, customer accounts, and daily operations from one secure workspace.',
  )
  const loginFeatureFast = tr('auth_feature_fast', 'Fast daily workflow')
  const loginFeatureSecure = tr('auth_feature_secure', 'Protected business access')
  const loginFeatureSynced = tr('auth_feature_synced', 'Live server-backed data')
  const loginFeatureTrusted = tr('auth_feature_trusted', 'Built for shared teams')

  const rememberOrganization = (item) => {
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

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SESSION_DURATION, sessionDuration)
    } catch (_) {}
  }, [sessionDuration])

  useEffect(() => {
    if (sessionDurationTouchedRef.current) return
    const preferredDuration = String(settings?.login_session_duration || '').trim()
    if (!preferredDuration) return
    setSessionDuration(preferredDuration)
    try {
      localStorage.setItem(STORAGE_KEYS.SESSION_DURATION, preferredDuration)
    } catch (_) {}
  }, [settings?.login_session_duration])

  useEffect(() => {
    const loadCapabilities = async () => {
      const requestId = beginTrackedRequest(capabilityRequestRef)
      try {
        const result = await withLoaderTimeout(
          () => window.api.getVerificationCapabilities?.(),
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
        const remembered = JSON.parse(localStorage.getItem(STORAGE_KEYS.ORGANIZATION) || 'null')
        const boot = await withLoaderTimeout(
          () => window.api.getOrganizationBootstrap?.(),
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
      } catch (_) {}
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
          () => window.api.searchOrganizations?.(query),
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
  }, [organizationSearch])

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
    if (!accessToken && !errorDescription) return undefined

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
        clearCallbackUrl()
        return
      }

      if (errorDescription) {
        clearPendingOauthLogin()
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
            const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.ORGANIZATION) || 'null')
            return stored?.public_id || stored?.slug || ''
          } catch (_) {
            return ''
          }
        })()
        const result = await withLoaderTimeout(() => window.api.completeGoogleOauth({
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
        if (!isTrackedRequestCurrent(oauthCallbackRequestRef, requestId)) return

        if (result?.otpRequired) {
          setOtpRequired(true)
          setPendingUserId(result.userId)
          return
        }
        if (result?.success && result?.user) {
          await persistAuthenticatedUser(result.user, sessionDuration, result.authToken || '', result.sessionExpiresAt || '')
          return
        }
        setError(result?.error || tr('oauth_signin_failed', 'Sign-in with provider failed.'))
      } catch (oauthError) {
        clearCallbackUrl()
        clearPendingOauthLogin()
        if (isTrackedRequestCurrent(oauthCallbackRequestRef, requestId)) {
          setError(oauthError?.message || tr('oauth_signin_failed', 'Sign-in with provider failed.'))
        }
      } finally {
        if (isTrackedRequestCurrent(oauthCallbackRequestRef, requestId)) setLoading(false)
      }
    }

    run()
    return () => { invalidateTrackedRequest(oauthCallbackRequestRef) }
  }, [persistAuthenticatedUser, sessionDuration, t])

  const getDeviceContext = () => getClientDeviceInfo()

  const handleLogin = async (event) => {
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
      if (result?.otpRequired) {
        setOtpRequired(true)
        setPendingUserId(result.userId)
        return
      }
      if (!result?.success) setError(result?.error || 'Login failed')
    } catch (loginError) {
      setError(loginError?.message || tr('login_failed_try_again', 'Login failed. Please try again.'))
    } finally {
      loginSubmitInFlightRef.current = false
      setLoading(false)
    }
  }

  const handleOtp = async (event) => {
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
      const verifyResult = await withLoaderTimeout(() => window.api.otpVerify({
        userId: pendingUserId,
        token: otp.trim(),
        sessionDuration,
        clientTime: new Date().toISOString(),
        deviceTz: device.deviceTz,
        deviceName: device.deviceName,
      }), 'OTP verification')

      if (verifyResult?.success && verifyResult?.user) {
        await persistAuthenticatedUser(verifyResult.user, sessionDuration, verifyResult.authToken || '', verifyResult.sessionExpiresAt || '')
      } else {
        setError(verifyResult?.error || tr('invalid_otp_code', 'Invalid OTP code'))
      }
    } catch (otpError) {
      setError(otpError?.message || tr('otp_verification_failed', 'OTP verification failed'))
    } finally {
      otpVerifyInFlightRef.current = false
      setLoading(false)
    }
  }

  const handleOtpInput = (value) => {
    const clean = value.replace(/\D/g, '').slice(0, 6)
    setOtp(clean)
  }

  const handleResetWithOtp = async () => {
    if (passwordResetActionRef.current) return
    const resolvedOrganization = String(organizationId || organizationSearch || '').trim()
    if (!resolvedOrganization) return setError(tr('enter_organization_first', 'Please choose your organization first.'))
    if (!resetIdentifier.trim()) return setError(tr('enter_username_email_first', 'Enter your username or email first.'))
    if (!resetOtp.trim()) return setError(tr('enter_otp_first', 'Enter the OTP code from your authenticator app.'))
    if (resetNewPassword.length < 4) return setError(tr('password_min_4', 'Use at least 4 characters for the new password.'))
    if (resetNewPassword !== resetConfirmPassword) return setError(tr('password_confirm_mismatch', 'Password confirmation does not match.'))

    setError('')
    passwordResetActionRef.current = true
    setLoading(true)
    try {
      const result = await withLoaderTimeout(() => window.api.resetPasswordWithOtp({
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
      setError(resetError?.message || tr('otp_reset_failed', 'Failed to reset password with OTP.'))
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
      const result = await withLoaderTimeout(() => window.api.requestPasswordResetEmail({
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
      setError(resetError?.message || tr('email_reset_failed', 'Failed to send password reset email.'))
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
      const result = await withLoaderTimeout(() => window.api.completePasswordReset({
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
      setError(resetError?.message || tr('email_reset_complete_failed', 'Failed to update password from recovery email.'))
    } finally {
      passwordResetActionRef.current = false
      setLoading(false)
    }
  }

  const handleStartOauth = async (provider) => {
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
      const result = await withLoaderTimeout(() => window.api.startGoogleOauth({
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
      setError(oauthError?.message || tr('oauth_start_failed', 'Unable to start sign-in with provider.'))
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
            <div className="space-y-10">
              <div className="space-y-5">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold tracking-[0.14em] text-white/80">
                  <Building2 className="h-4 w-4" />
                  <span>Business OS</span>
                </div>
                <div className="space-y-4">
                  <h1 className="max-w-md text-4xl font-semibold leading-tight text-white">
                    {tr('secure_signin_workspace', 'Secure sign-in for your business workspace')}
                  </h1>
                  <p className="max-w-lg text-sm leading-7 text-slate-100/95">
                    {loginShellDescription}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/12 bg-white/10 px-4 py-4">
                  <div className="text-sm font-semibold text-white">{loginFeatureFast}</div>
                  <div className="mt-1 text-xs leading-6 text-slate-200/80">
                    {tr('auth_feature_fast_desc', 'Compact tools for sales, stock, and customer work every day.')}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/12 bg-white/10 px-4 py-4">
                  <div className="text-sm font-semibold text-white">{loginFeatureSecure}</div>
                  <div className="mt-1 text-xs leading-6 text-slate-200/80">
                    {tr('auth_feature_secure_desc', 'Protected sign-in methods, session control, and account recovery.')}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/12 bg-white/10 px-4 py-4">
                  <div className="text-sm font-semibold text-white">{loginFeatureSynced}</div>
                  <div className="mt-1 text-xs leading-6 text-slate-200/80">
                    {tr('auth_feature_synced_desc', 'Your workspace stays connected to the live server and current data.')}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/12 bg-white/10 px-4 py-4">
                  <div className="text-sm font-semibold text-white">{loginFeatureTrusted}</div>
                  <div className="mt-1 text-xs leading-6 text-slate-200/80">
                    {tr('auth_feature_trusted_desc', 'Made for teams sharing branches, devices, and daily business tasks.')}
                  </div>
                </div>
              </div>
            </div>
          </aside>
          <div className="auth-card p-5 sm:p-7 lg:p-8">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/25">
            {otpRequired ? <ShieldCheck className="h-8 w-8" /> : <Building2 className="h-8 w-8" />}
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Business OS</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {otpRequired
              ? tr('two_factor_authentication', 'Two-Factor Authentication')
              : tr('secure_signin_workspace', 'Secure sign-in for your business workspace')}
          </p>
          <div className="mt-3 flex items-center justify-center gap-2 text-[11px] font-medium text-gray-500 dark:text-slate-400">
            <span className="rounded-full bg-gray-100 px-2.5 py-1 dark:bg-slate-800">
              {language === 'km' ? tr('khmerLabel', 'Khmer') : tr('englishLabel', 'English')}
            </span>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700 dark:bg-blue-900/25 dark:text-blue-300">
              {tr('auth_session_label', 'Secure session')}
            </span>
          </div>
        </div>

        {!otpRequired && !showOtpReset && !showEmailReset && !recoveryAccessToken ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2 rounded-2xl border border-gray-200 bg-gray-50/85 p-3 dark:border-slate-700 dark:bg-slate-900/60">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                  <Building2 className="h-4 w-4 text-gray-400" />
                  <span>{tr('organization', 'Organization')}</span>
                </div>
                {(organizationSearch || organizationId) ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:border-blue-300 hover:text-blue-700 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-200"
                    onClick={() => setOrganizationExpanded((current) => !current)}
                  >
                    <span>{organizationExpanded ? tr('hide', 'Hide') : tr('change', 'Change')}</span>
                    {organizationExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                ) : null}
              </div>
              {!organizationExpanded && (organizationSearch || organizationId) ? (
                  <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 shadow-sm dark:border-slate-600 dark:bg-slate-950/70 dark:text-gray-300">
                  <div className="font-medium text-gray-800 dark:text-gray-100">{organizationDisplayName}</div>
                  <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                    {tr('organization_hidden_hint', 'Organization details stay hidden until you expand this section.')}
                  </div>
                </div>
              ) : (
                <>
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
                    placeholder="LeangCosmetics"
                    autoComplete="organization"
                  />
                  {organizationLoading ? (
                    <div className="text-xs text-gray-500 dark:text-gray-400">{tr('finding_organization', 'Finding organization...')}</div>
                  ) : null}
                  {!organizationLocked && organizationMatches.length ? (
                    <div className="flex flex-wrap gap-2">
                      {organizationMatches.map((item) => (
                        <button
                          key={item.public_id || item.slug || item.id}
                          type="button"
                          className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:border-blue-300 hover:text-blue-700 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-200"
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
                </>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {organizationLocked
                  ? tr('organization_join_locked', 'Organization creation is currently disabled. This server is prepared for LeangCosmetics and future organization-ready expansion.')
                  : tr('organization_join_hint', 'Search the organization name and select it before signing in.')}
              </p>
            </div>

            <div>
              <label htmlFor="login-username" className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <Mail className="h-4 w-4 text-gray-400" />
                <span>{tr('username_name_email_phone', 'Username, name, email, or phone')}</span>
              </label>
              <input
                id="login-username"
                name="username"
                ref={usernameRef}
                className="input"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="admin / your name / +85512345678 / name@email.com"
                required
                autoComplete="username"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <LockKeyhole className="h-4 w-4 text-gray-400" />
                <span>{t('password')}</span>
              </label>
              <input
                id="login-password"
                name="password"
                className="input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={tr('password', 'Password')}
                required
                autoComplete="current-password"
              />
            </div>

            <div>
              <label htmlFor="session-duration" className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <KeyRound className="h-4 w-4 text-gray-400" />
                <span>{tr('keep_me_logged_in', 'Keep me logged in')}</span>
              </label>
              <select id="session-duration" name="session-duration" value={sessionDuration} onChange={(event) => {
                  sessionDurationTouchedRef.current = true
                  setSessionDuration(event.target.value)
                }} className="input">
                <option value="session">{tr('until_close_browser', 'Until I close the browser')}</option>
                <option value="1d">{tr('for_1_day', 'For 1 day')}</option>
                <option value="3d">{tr('for_3_days', 'For 3 days')}</option>
                <option value="7d">{tr('for_7_days', 'For 7 days')}</option>
                <option value="14d">{tr('for_14_days', 'For 14 days')}</option>
                <option value="30d">{tr('for_30_days', 'For 30 days')}</option>
              </select>
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                {tr('shared_device_security_note', 'On shared devices, choose "Until I close the browser" for better security.')}
              </p>
            </div>

            {error ? <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</div> : null}

            <button className="btn-primary w-full py-3 text-base" type="submit" disabled={loading}>
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
              <div className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                <div className="text-center text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {tr('login_with', 'Login with')}
                </div>
                <div className="grid gap-2">
                  <OauthButton
                    icon={Chrome}
                    label={tr('login_with_google', 'Google')}
                    disabled={!verificationCaps.googleOauth || !!oauthLoading || loading}
                    loading={oauthLoading === 'google'}
                    onClick={() => handleStartOauth('google')}
                  />
                </div>
                <p className="text-center text-[11px] text-gray-500 dark:text-gray-400">
                  {tr('oauth_local_account_hint', 'An admin still needs to create your local Business OS account first. Once linked, Google keeps working on later sign-ins.')}
                </p>
              </div>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                className="w-full text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
                onClick={() => {
                  setShowEmailReset(true)
                  setShowOtpReset(false)
                  setRecoveryAccessToken('')
                  setError('')
                  setResetInfo('')
                  setResetIdentifier(username || '')
                }}
              >
                {tr('reset_password_with_email', 'Reset password with email')}
              </button>
              <button
                type="button"
                className="w-full text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
                onClick={() => {
                  setShowOtpReset(true)
                  setShowEmailReset(false)
                  setRecoveryAccessToken('')
                  setError('')
                  setResetInfo('')
                  setResetIdentifier(username || '')
                }}
              >
                {tr('reset_password_with_otp', 'Reset password with OTP')}
              </button>
            </div>

          </form>
        ) : null}

        {!otpRequired && showEmailReset && !recoveryAccessToken ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-blue-100 bg-blue-50/90 p-3 text-sm text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300">
              {tr('email_reset_notice', 'Enter your username, name, email, or phone. If this account has a saved email, Business OS will send a password reset link there.')}
            </div>
            <div>
              <label htmlFor="email-reset-identifier" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {tr('username_name_email_phone', 'Username, name, email, or phone')}
              </label>
              <input id="email-reset-identifier" name="email_reset_identifier" className="input" value={resetIdentifier} onChange={(event) => setResetIdentifier(event.target.value)} placeholder="username / name / phone / email" />
            </div>

            {resetInfo ? <div className="rounded-lg border border-green-100 bg-green-50/90 p-3 text-sm text-green-700 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-300">{resetInfo}</div> : null}
            {error ? <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</div> : null}

            <button className="btn-primary w-full py-3 text-base" type="button" disabled={loading} onClick={handleResetWithEmail}>
              {loading ? tr('sending_reset_email', 'Sending reset email...') : tr('send_reset_email', 'Send reset email')}
            </button>

            <ModeBackButton label={tr('back_to_login', 'Back to login')} onClick={closeAuxMode} />
          </div>
        ) : null}

        {!otpRequired && showOtpReset ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-blue-100 bg-blue-50/90 p-3 text-sm text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300">
              {tr('otp_reset_notice', 'Use the OTP code from your authenticator app to set a new password. If OTP is not enabled on your account, use Google sign-in, email recovery, or ask an admin to reset the password.')}
            </div>
            <div>
              <label htmlFor="reset-identifier" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {tr('username_name_email_phone', 'Username, name, email, or phone')}
              </label>
              <input id="reset-identifier" name="reset_identifier" className="input" value={resetIdentifier} onChange={(event) => setResetIdentifier(event.target.value)} placeholder="username / name / phone / email" />
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

        {!otpRequired && recoveryAccessToken ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-blue-100 bg-blue-50/90 p-3 text-sm text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300">
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

        {otpRequired ? (
          <form onSubmit={handleOtp} className="space-y-5">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
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
                setOtp('')
                setError('')
              }}
            >
              {tr('back', 'Back')}
            </button>
          </form>
        ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

