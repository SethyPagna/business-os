import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Chrome,
  Facebook,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  ScanLine,
  ShieldCheck,
} from 'lucide-react'
import { useApp } from '../../AppContext'
import { STORAGE_KEYS } from '../../constants'
import { getClientDeviceInfo } from '../../utils/deviceInfo.js'

const SESSION_SYNC_TOKEN_KEY = 'businessos_sync_token_session'

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
  const { login, persistAuthenticatedUser, t } = useApp()
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

  const [showReset, setShowReset] = useState(false)
  const [showCodeLogin, setShowCodeLogin] = useState(false)
  const [resetIdentifier, setResetIdentifier] = useState('')
  const [resetMethod, setResetMethod] = useState('auto')
  const [resetSent, setResetSent] = useState(false)
  const [resetCode, setResetCode] = useState('')
  const [resetNewPassword, setResetNewPassword] = useState('')
  const [resetConfirmPassword, setResetConfirmPassword] = useState('')
  const [resetInfo, setResetInfo] = useState('')
  const [verificationCaps, setVerificationCaps] = useState({
    email: false,
    sms: false,
    supabaseAuth: false,
    googleOauth: false,
    facebookOauth: false,
  })
  const [syncToken, setSyncToken] = useState(() => {
    try {
      return window.api?.getSyncToken?.() || sessionStorage.getItem(SESSION_SYNC_TOKEN_KEY) || ''
    } catch (_) {
      return ''
    }
  })
  const [accessConfig, setAccessConfig] = useState({
    requiresToken: false,
    hasConfiguredToken: false,
    accessMode: 'local',
  })

  const [codeLoginIdentifier, setCodeLoginIdentifier] = useState('')
  const [codeLoginMethod, setCodeLoginMethod] = useState('auto')
  const [codeLoginSent, setCodeLoginSent] = useState(false)
  const [codeLoginValue, setCodeLoginValue] = useState('')
  const [codeLoginInfo, setCodeLoginInfo] = useState('')

  const usernameRef = useRef()
  const otpRef = useRef()

  useEffect(() => {
    const timer = setTimeout(() => {
      if (otpRequired) otpRef.current?.focus()
      else usernameRef.current?.focus()
    }, 150)
    return () => clearTimeout(timer)
  }, [otpRequired, showReset, showCodeLogin])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SESSION_DURATION, sessionDuration)
    } catch (_) {}
  }, [sessionDuration])

  useEffect(() => {
    try {
      if (syncToken) sessionStorage.setItem(SESSION_SYNC_TOKEN_KEY, syncToken)
      else sessionStorage.removeItem(SESSION_SYNC_TOKEN_KEY)
    } catch (_) {}
  }, [syncToken])

  useEffect(() => {
    let active = true
    const loadCapabilities = async () => {
      try {
        const result = await window.api.getVerificationCapabilities?.()
        if (!active || !result || result.success === false) return
        setVerificationCaps({
          email: result.email !== false,
          sms: result.sms === true,
          supabaseAuth: result.supabase_auth === true,
          googleOauth: result.google_oauth === true,
          facebookOauth: result.facebook_oauth === true,
        })
      } catch (_) {}
    }
    loadCapabilities()
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    const loadAccessConfig = async () => {
      try {
        const response = await fetch(`${window.location.origin}/api/system/config`, {
          headers: { 'bypass-tunnel-reminder': 'true' },
        })
        if (!response.ok) return
        const config = await response.json().catch(() => ({}))
        if (!active) return
        setAccessConfig({
          requiresToken: config?.requiresToken === true,
          hasConfiguredToken: config?.hasConfiguredToken === true,
          accessMode: String(config?.accessMode || 'local'),
        })
      } catch (_) {}
    }
    loadAccessConfig()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const url = new URL(window.location.href)
    const mode = String(url.searchParams.get('auth_mode') || '').trim().toLowerCase()
    if (mode !== 'login') return undefined

    const hash = new URLSearchParams((window.location.hash || '').replace(/^#/, ''))
    const accessToken = hash.get('access_token') || ''
    const provider = String(url.searchParams.get('auth_provider') || '').trim().toLowerCase()
    const errorDescription = hash.get('error_description') || url.searchParams.get('error_description') || ''
    if (!accessToken && !errorDescription) return undefined

    let cancelled = false
    const clearCallbackUrl = () => {
      const cleanUrl = `${url.origin}${url.pathname}`
      window.history.replaceState({}, document.title, cleanUrl)
    }

    const run = async () => {
      if (errorDescription) {
        clearCallbackUrl()
        if (!cancelled) setError(errorDescription)
        return
      }

      setLoading(true)
      setError('')
      try {
        if (syncToken) window.api.useSessionSyncToken?.(syncToken)
        const device = getClientDeviceInfo()
        const result = await window.api.completeSupabaseOauth({
          accessToken,
          provider,
          mode: 'login',
          clientTime: new Date().toISOString(),
          deviceTz: device.deviceTz,
          deviceName: device.deviceName,
        })
        clearCallbackUrl()
        if (cancelled) return

        if (result?.otpRequired) {
          setOtpRequired(true)
          setPendingUserId(result.userId)
          return
        }
        if (result?.success && result?.user) {
          await persistAuthenticatedUser(result.user, sessionDuration)
          return
        }
        setError(result?.error || tr('oauth_signin_failed', 'Sign-in with provider failed.'))
      } catch (oauthError) {
        clearCallbackUrl()
        if (!cancelled) {
          setError(oauthError?.message || tr('oauth_signin_failed', 'Sign-in with provider failed.'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    return () => { cancelled = true }
  }, [persistAuthenticatedUser, sessionDuration, t])

  const resetMethods = useMemo(() => ([
    { value: 'auto', label: tr('verification_method_auto', 'Auto (verified email)'), enabled: true },
    { value: 'email', label: tr('verification_method_email', 'Verified Email'), enabled: verificationCaps.email },
  ]), [t, verificationCaps.email])

  const getDeviceContext = () => getClientDeviceInfo()

  const applySyncTokenIfNeeded = () => {
    const token = String(syncToken || '').trim()
    if (accessConfig.requiresToken && !accessConfig.hasConfiguredToken) {
      setError('Public access is locked until a sync token is configured locally in Server settings.')
      return false
    }
    if (accessConfig.requiresToken && !token) {
      setError('Enter the sync token to use this public or remote connection.')
      return false
    }
    if (token) {
      window.api.useSessionSyncToken?.(token)
    }
    return true
  }

  const resetResetForm = () => {
    setResetSent(false)
    setResetCode('')
    setResetNewPassword('')
    setResetConfirmPassword('')
    setResetInfo('')
  }

  const resetCodeLoginForm = () => {
    setCodeLoginSent(false)
    setCodeLoginValue('')
    setCodeLoginInfo('')
  }

  const handleLogin = async (event) => {
    event.preventDefault()
    if (!applySyncTokenIfNeeded()) return
    setError('')
    setLoading(true)
    const result = await login(username, password, sessionDuration)
    if (result?.otpRequired) {
      setOtpRequired(true)
      setPendingUserId(result.userId)
      setLoading(false)
      return
    }
    if (!result.success) setError(result.error || 'Login failed')
    setLoading(false)
  }

  const handleOtp = async (event) => {
    event.preventDefault()
    if (!otp.trim()) {
      setError(tr('enter_6_digit_code', 'Please enter the 6-digit code'))
      return
    }
    setError('')
    setLoading(true)
    try {
      const device = getClientDeviceInfo()
      const verifyResult = await window.api.otpVerify({
        userId: pendingUserId,
        token: otp.trim(),
        clientTime: new Date().toISOString(),
        deviceTz: device.deviceTz,
        deviceName: device.deviceName,
      })

      if (verifyResult?.success && verifyResult?.user) {
        await persistAuthenticatedUser(verifyResult.user, sessionDuration)
      } else {
        setError(verifyResult?.error || tr('invalid_otp_code', 'Invalid OTP code'))
      }
    } catch (otpError) {
      setError(otpError?.message || tr('otp_verification_failed', 'OTP verification failed'))
    }
    setLoading(false)
  }

  const handleOtpInput = (value) => {
    const clean = value.replace(/\D/g, '').slice(0, 6)
    setOtp(clean)
  }

  const handleSendResetCode = async () => {
    if (!applySyncTokenIfNeeded()) return
    if (!resetIdentifier.trim()) {
      setError(tr('enter_username_email_first', 'Enter your username or email first.'))
      return
    }
    if (resetMethod === 'email' && !verificationCaps.email) {
      setError(tr('email_sender_setup_needed', 'Email code sending is not configured yet. Ask admin to configure an email sender provider.'))
      return
    }
    if (resetMethod === 'auto' && !verificationCaps.email) {
      setError(tr('email_sender_missing', 'No email code sender is configured yet. Please ask admin to configure email sending for verification codes.'))
      return
    }
    setError('')
    setLoading(true)
    try {
      const result = await window.api.requestPasswordResetCode({
        identifier: resetIdentifier.trim(),
        method: resetMethod,
      })
      if (result?.success === false) {
        setError(result.error || 'Failed to send verification code')
        return
      }
      setResetSent(true)
      setResetInfo(
        result?.destination
          ? tr('verification_code_sent_to', 'Verification code sent to {destination}').replace('{destination}', result.destination)
          : tr('verification_code_sent_if_exists', 'If the account exists, a verification code has been sent.')
      )
    } catch (requestError) {
      setError(requestError?.message || 'Failed to send verification code')
    } finally {
      setLoading(false)
    }
  }

  const handleCompleteReset = async () => {
    if (!applySyncTokenIfNeeded()) return
    if (!resetCode.trim()) return setError(tr('enter_verification_code', 'Enter the verification code.'))
    if (resetNewPassword.length < 4) return setError(tr('password_min_4', 'Use at least 4 characters for the new password.'))
    if (resetNewPassword !== resetConfirmPassword) return setError(tr('password_confirm_mismatch', 'Password confirmation does not match.'))

    setError('')
    setLoading(true)
    try {
      const result = await window.api.completePasswordReset({
        identifier: resetIdentifier.trim(),
        method: resetMethod,
        code: resetCode.trim(),
        newPassword: resetNewPassword,
      })
      if (result?.success === false) {
        setError(result.error || 'Failed to reset password')
        return
      }
      setShowReset(false)
      resetResetForm()
      setPassword('')
      setOtp('')
      setOtpRequired(false)
      setPendingUserId(null)
      setError(tr('password_reset_done', 'Password reset complete. You can now sign in with the new password.'))
    } catch (completeError) {
      setError(completeError?.message || 'Failed to reset password')
    } finally {
      setLoading(false)
    }
  }

  const handleSendLoginCode = async () => {
    if (!applySyncTokenIfNeeded()) return
    if (!codeLoginIdentifier.trim()) {
      setError(tr('enter_username_email_first', 'Enter your username or email first.'))
      return
    }
    if (codeLoginMethod === 'email' && !verificationCaps.email) {
      setError(tr('email_sender_setup_needed', 'Email code sending is not configured yet. Ask admin to configure an email sender provider.'))
      return
    }
    if (codeLoginMethod === 'auto' && !verificationCaps.email) {
      setError(tr('email_sender_missing', 'No email code sender is configured yet. Please ask admin to configure email sending for verification codes.'))
      return
    }

    setError('')
    setLoading(true)
    try {
      const result = await window.api.requestLoginCode({
        identifier: codeLoginIdentifier.trim(),
        method: codeLoginMethod,
      })
      if (result?.success === false) {
        setError(result.error || 'Failed to send verification code')
        return
      }
      setCodeLoginSent(true)
      setCodeLoginInfo(
        result?.destination
          ? tr('verification_code_sent_to', 'Verification code sent to {destination}').replace('{destination}', result.destination)
          : tr('verification_code_sent_if_exists', 'If the account exists, a verification code has been sent.')
      )
    } catch (requestError) {
      setError(requestError?.message || 'Failed to send verification code')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyLoginCode = async () => {
    if (!applySyncTokenIfNeeded()) return
    if (!codeLoginIdentifier.trim()) return setError(tr('enter_username_email_first', 'Enter your username or email first.'))
    if (!codeLoginValue.trim()) return setError(tr('enter_verification_code', 'Enter the verification code.'))

    setError('')
    setLoading(true)
    try {
      const result = await window.api.verifyLoginCode({
        identifier: codeLoginIdentifier.trim(),
        method: codeLoginMethod,
        code: codeLoginValue.trim(),
        ...getDeviceContext(),
      })
      if (result?.success && result?.user) {
        await persistAuthenticatedUser(result.user, sessionDuration)
        return
      }
      setError(result?.error || 'Invalid verification code')
    } catch (verifyError) {
      setError(verifyError?.message || 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  const handleStartOauth = async (provider) => {
    if (!applySyncTokenIfNeeded()) return
    setError('')
    setOauthLoading(provider)
    try {
      const redirectTo = `${window.location.origin}${window.location.pathname}?auth_mode=login&auth_provider=${encodeURIComponent(provider)}`
      const result = await window.api.startSupabaseOauth({
        provider,
        mode: 'login',
        redirectTo,
      })
      if (result?.success === false || !result?.url) {
        setError(result?.error || tr('oauth_start_failed', 'Unable to start sign-in with provider.'))
        return
      }
      window.location.assign(result.url)
    } catch (oauthError) {
      setError(oauthError?.message || tr('oauth_start_failed', 'Unable to start sign-in with provider.'))
    } finally {
      setOauthLoading('')
    }
  }

  const closeAuxMode = () => {
    setShowReset(false)
    setShowCodeLogin(false)
    setError('')
    resetResetForm()
    resetCodeLoginForm()
  }

  const showSyncTokenField = accessConfig.requiresToken || !!syncToken
  const accessHint = accessConfig.accessMode === 'tailscale-public' || accessConfig.accessMode === 'remote'
    ? 'Public or remote access requires the sync token before sign-in.'
    : accessConfig.accessMode === 'tailscale-private'
      ? 'Private Tailscale access is trusted through Tailscale identity headers.'
      : 'Local access does not require a sync token.'
  const syncTokenField = showSyncTokenField ? (
    <div className="mb-4">
      <label htmlFor="login-sync-token" className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
        <KeyRound className="h-4 w-4 text-gray-400" />
        <span>{tr('sync_token', 'Sync Token')}</span>
      </label>
      <input
        id="login-sync-token"
        name="sync-token"
        className="input"
        type="password"
        value={syncToken}
        onChange={(event) => setSyncToken(event.target.value)}
        placeholder={tr('sync_token_hint', 'Leave blank if no SYNC_TOKEN was set')}
        autoComplete="off"
      />
      <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{accessHint}</p>
    </div>
  ) : null

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/95 p-6 shadow-2xl backdrop-blur dark:bg-slate-900/95">
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
        </div>

        {syncTokenField}

        {!otpRequired && !showReset && !showCodeLogin ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="login-username" className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <Mail className="h-4 w-4 text-gray-400" />
                <span>{tr('username_or_email', 'Username or email')}</span>
              </label>
              <input
                id="login-username"
                name="username"
                ref={usernameRef}
                className="input"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="admin or name@email.com"
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
              <select id="session-duration" name="session-duration" value={sessionDuration} onChange={(event) => setSessionDuration(event.target.value)} className="input">
                <option value="session">{tr('until_close_browser', 'Until I close the browser')}</option>
                <option value="7d">{tr('for_7_days', 'For 7 days')}</option>
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

            {(verificationCaps.googleOauth || verificationCaps.facebookOauth) ? (
              <div className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                <div className="text-center text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {tr('or_continue_with', 'Or continue with')}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <OauthButton
                    icon={Chrome}
                    label={tr('continue_with_google', 'Google')}
                    disabled={!verificationCaps.googleOauth || !!oauthLoading || loading}
                    loading={oauthLoading === 'google'}
                    onClick={() => handleStartOauth('google')}
                  />
                  <OauthButton
                    icon={Facebook}
                    label={tr('continue_with_facebook', 'Facebook')}
                    disabled={!verificationCaps.facebookOauth || !!oauthLoading || loading}
                    loading={oauthLoading === 'facebook'}
                    onClick={() => handleStartOauth('facebook')}
                  />
                </div>
                <p className="text-center text-[11px] text-gray-500 dark:text-gray-400">
                  {tr('oauth_matching_email_hint', 'Social sign-in works after admin creates your local account and the provider email matches your account email.')}
                </p>
              </div>
            ) : null}

            <button
              type="button"
              className="w-full text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
              onClick={() => {
                setShowReset(true)
                setShowCodeLogin(false)
                setError('')
                resetResetForm()
                setResetIdentifier(username || '')
              }}
            >
              {tr('forgot_password', 'Forgot password?')}
            </button>

            <button
              type="button"
              className="w-full text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
              onClick={() => {
                setShowCodeLogin(true)
                setShowReset(false)
                setError('')
                resetCodeLoginForm()
                setCodeLoginIdentifier(username || '')
              }}
            >
              {tr('sign_in_with_code', 'Sign in with verification code')}
            </button>

            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-3 text-xs text-gray-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-gray-300">
              <div className="mb-2 flex items-center gap-2 font-semibold">
                <ScanLine className="h-4 w-4 text-gray-400" />
                <span>{tr('signin_methods', 'Sign-in methods')}</span>
              </div>
              <div>{tr('signin_method_password', 'Password login')}</div>
              <div>{tr('signin_method_otp', 'OTP (required for users who enabled 2FA)')}</div>
              <div>{tr('signin_method_code', 'Verification code sign-in')}</div>
              {verificationCaps.googleOauth ? <div>{tr('signin_method_google', 'Google sign-in')}</div> : null}
              {verificationCaps.facebookOauth ? <div>{tr('signin_method_facebook', 'Facebook sign-in')}</div> : null}
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                <span className={`rounded-full px-2 py-0.5 ${verificationCaps.email ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                  {tr('email', 'Email')}: {verificationCaps.email ? tr('provider_ready_short', 'ready') : tr('provider_not_configured_short', 'not configured')}
                </span>
                <span className={`rounded-full px-2 py-0.5 ${verificationCaps.supabaseAuth ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300'}`}>
                  {tr('supabase_auth', 'Supabase Auth')}: {verificationCaps.supabaseAuth ? tr('provider_ready_short', 'ready') : tr('provider_not_configured_short', 'not configured')}
                </span>
              </div>
            </div>
          </form>
        ) : null}

        {!otpRequired && showReset ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
              {tr('use_verified_email_notice', 'Use a verified email address to receive a one-time verification code.')}
            </div>
            <div>
              <label htmlFor="reset-identifier" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {tr('username_or_verified_email', 'Username or verified email')}
              </label>
              <input id="reset-identifier" name="reset_identifier" className="input" value={resetIdentifier} onChange={(event) => setResetIdentifier(event.target.value)} placeholder="username / email" />
            </div>
            <div>
              <label htmlFor="reset-method" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {tr('verification_method', 'Verification method')}
              </label>
              <select id="reset-method" name="reset_method" className="input" value={resetMethod} onChange={(event) => setResetMethod(event.target.value)}>
                {resetMethods.map((item) => (
                  <option key={item.value} value={item.value} disabled={!item.enabled}>{item.label}</option>
                ))}
              </select>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                <span className={`rounded-full px-2 py-0.5 ${verificationCaps.email ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                  {tr('email', 'Email')} {verificationCaps.email ? tr('provider_ready_short', 'ready') : tr('provider_not_configured_short', 'not configured')}
                </span>
              </div>
            </div>

            {!resetSent ? (
              <button className="btn-primary w-full py-3 text-base" type="button" disabled={loading} onClick={handleSendResetCode}>
                {loading ? tr('sending_code', 'Sending code...') : tr('send_verification_code', 'Send verification code')}
              </button>
            ) : (
              <>
                {resetInfo ? <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">{resetInfo}</div> : null}
                <div>
                  <label htmlFor="reset-code" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {tr('verification_code', 'Verification code')}
                  </label>
                  <input id="reset-code" name="reset_code" autoComplete="one-time-code" className="input" value={resetCode} onChange={(event) => setResetCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" />
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
                <button className="btn-primary w-full py-3 text-base" type="button" disabled={loading} onClick={handleCompleteReset}>
                  {loading ? tr('updating_password', 'Updating password...') : tr('reset_password', 'Reset password')}
                </button>
              </>
            )}

            {error ? <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</div> : null}
            <ModeBackButton label={tr('back_to_login', 'Back to login')} onClick={closeAuxMode} />
          </div>
        ) : null}

        {!otpRequired && showCodeLogin ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
              {tr('code_signin_notice', 'Sign in securely using a one-time code sent to your verified email.')}
            </div>
            <div>
              <label htmlFor="code-login-identifier" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {tr('username_or_verified_email', 'Username or verified email')}
              </label>
              <input id="code-login-identifier" name="code_login_identifier" autoComplete="username" className="input" value={codeLoginIdentifier} onChange={(event) => setCodeLoginIdentifier(event.target.value)} placeholder="username / email" />
            </div>
            <div>
              <label htmlFor="code-login-method" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {tr('verification_method', 'Verification method')}
              </label>
              <select id="code-login-method" name="code_login_method" className="input" value={codeLoginMethod} onChange={(event) => setCodeLoginMethod(event.target.value)}>
                {resetMethods.map((item) => (
                  <option key={item.value} value={item.value} disabled={!item.enabled}>{item.label}</option>
                ))}
              </select>
            </div>
            {!codeLoginSent ? (
              <button className="btn-primary w-full py-3 text-base" type="button" disabled={loading} onClick={handleSendLoginCode}>
                {loading ? tr('sending_code', 'Sending code...') : tr('send_verification_code', 'Send verification code')}
              </button>
            ) : (
              <>
                {codeLoginInfo ? <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">{codeLoginInfo}</div> : null}
                <div>
                  <label htmlFor="code-login-value" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {tr('verification_code', 'Verification code')}
                  </label>
                  <input id="code-login-value" name="code_login_value" autoComplete="one-time-code" className="input" value={codeLoginValue} onChange={(event) => setCodeLoginValue(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" />
                </div>
                <button className="btn-primary w-full py-3 text-base" type="button" disabled={loading} onClick={handleVerifyLoginCode}>
                  {loading ? tr('verifying', 'Verifying...') : tr('sign_in', 'Sign in')}
                </button>
              </>
            )}
            {error ? <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</div> : null}
            <ModeBackButton label={tr('back_to_login', 'Back to login')} onClick={closeAuxMode} />
          </div>
        ) : null}

        {otpRequired ? (
          <form onSubmit={handleOtp} className="space-y-4">
            <div className="rounded-2xl bg-blue-50 p-4 text-center dark:bg-blue-900/20">
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <p className="text-sm font-medium text-blue-700 dark:text-blue-300">{tr('open_authenticator_app', 'Open your authenticator app')}</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{tr('enter_authenticator_code', 'Enter the 6-digit code shown in your app.')}</p>
            </div>
            <div>
              <label htmlFor="otp-code" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {tr('authentication_code', 'Authentication code')}
              </label>
              <input
                id="otp-code"
                name="otp"
                ref={otpRef}
                className="input text-center text-2xl tracking-widest font-mono"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(event) => handleOtpInput(event.target.value)}
                placeholder="000000"
                required
                autoComplete="one-time-code"
              />
            </div>
            {error ? <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</div> : null}
            <button className="btn-primary w-full py-3 text-base" type="submit" disabled={loading || otp.length !== 6}>
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{tr('verifying', 'Verifying...')}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  <span>{tr('verify_code', 'Verify code')}</span>
                </span>
              )}
            </button>
            <ModeBackButton
              label={tr('back_to_login', 'Back to login')}
              onClick={() => {
                setOtpRequired(false)
                setPendingUserId(null)
                setOtp('')
                setError('')
              }}
            />
          </form>
        ) : null}

        {!otpRequired && !showReset && !showCodeLogin ? (
          <p className="mt-6 text-center text-xs text-gray-400">
            {tr('default_login_hint', 'Default: admin / admin')}
          </p>
        ) : null}
      </div>
    </div>
  )
}
