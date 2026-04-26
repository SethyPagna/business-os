import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Building2,
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

  const [showOtpReset, setShowOtpReset] = useState(false)
  const [resetIdentifier, setResetIdentifier] = useState('')
  const [resetOtp, setResetOtp] = useState('')
  const [resetNewPassword, setResetNewPassword] = useState('')
  const [resetConfirmPassword, setResetConfirmPassword] = useState('')
  const [resetInfo, setResetInfo] = useState('')
  const [verificationCaps, setVerificationCaps] = useState({
    googleOauth: false,
    facebookOauth: false,
    supabaseAuth: false,
    supabaseEmailAuth: false,
  })
  const [organizationSearch, setOrganizationSearch] = useState('')
  const [organizationId, setOrganizationId] = useState('')
  const [organizationMatches, setOrganizationMatches] = useState([])
  const [organizationLoading, setOrganizationLoading] = useState(false)
  const [organizationLocked, setOrganizationLocked] = useState(false)

  const usernameRef = useRef()
  const otpRef = useRef()

  useEffect(() => {
    const timer = setTimeout(() => {
      if (otpRequired) otpRef.current?.focus()
      else usernameRef.current?.focus()
    }, 150)
    return () => clearTimeout(timer)
  }, [otpRequired, showOtpReset])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SESSION_DURATION, sessionDuration)
    } catch (_) {}
  }, [sessionDuration])

  useEffect(() => {
    let active = true
    const loadCapabilities = async () => {
      try {
        const result = await window.api.getVerificationCapabilities?.()
        if (!active || !result || result.success === false) return
        setVerificationCaps({
          googleOauth: result.google_oauth === true,
          facebookOauth: result.facebook_oauth === true,
          supabaseAuth: result.supabase_auth === true,
          supabaseEmailAuth: result.supabase_email_auth === true,
        })
      } catch (_) {}
    }
    loadCapabilities()
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    const bootstrap = async () => {
      try {
        const remembered = JSON.parse(localStorage.getItem(STORAGE_KEYS.ORGANIZATION) || 'null')
        const boot = await window.api.getOrganizationBootstrap?.()
        if (!active) return
        const fallbackOrg = remembered || boot?.organization || null
        if (fallbackOrg) {
          setOrganizationSearch(fallbackOrg.name || fallbackOrg.slug || '')
          setOrganizationId(fallbackOrg.public_id || '')
          setOrganizationMatches(fallbackOrg ? [fallbackOrg] : [])
          if (boot?.organization && !boot.organizationCreationEnabled) {
            setOrganizationLocked(true)
          }
        }
      } catch (_) {}
    }
    bootstrap()
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    const query = String(organizationSearch || '').trim()
    if (!query) {
      setOrganizationMatches([])
      return () => { active = false }
    }
    const timer = setTimeout(async () => {
      setOrganizationLoading(true)
      try {
        const result = await window.api.searchOrganizations?.(query)
        if (!active) return
        setOrganizationMatches(Array.isArray(result?.items) ? result.items : [])
      } catch (_) {
        if (active) setOrganizationMatches([])
      } finally {
        if (active) setOrganizationLoading(false)
      }
    }, 180)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [organizationSearch])

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
        const device = getClientDeviceInfo()
        const rememberedOrg = (() => {
          try {
            const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.ORGANIZATION) || 'null')
            return stored?.public_id || stored?.slug || ''
          } catch (_) {
            return ''
          }
        })()
        const result = await window.api.completeSupabaseOauth({
          accessToken,
          provider,
          mode: 'login',
          organization: rememberedOrg,
          sessionDuration,
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
          await persistAuthenticatedUser(result.user, sessionDuration, result.authToken || '')
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

  const getDeviceContext = () => getClientDeviceInfo()

  const handleLogin = async (event) => {
    event.preventDefault()
    const resolvedOrganization = String(organizationId || organizationSearch || '').trim()
    if (!resolvedOrganization) {
      setError(tr('enter_organization_first', 'Please choose your organization first.'))
      return
    }
    setError('')
    setLoading(true)
    const result = await login(username, password, sessionDuration, resolvedOrganization)
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
        sessionDuration,
        clientTime: new Date().toISOString(),
        deviceTz: device.deviceTz,
        deviceName: device.deviceName,
      })

      if (verifyResult?.success && verifyResult?.user) {
        await persistAuthenticatedUser(verifyResult.user, sessionDuration, verifyResult.authToken || '')
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

  const handleResetWithOtp = async () => {
    const resolvedOrganization = String(organizationId || organizationSearch || '').trim()
    if (!resolvedOrganization) return setError(tr('enter_organization_first', 'Please choose your organization first.'))
    if (!resetIdentifier.trim()) return setError(tr('enter_username_email_first', 'Enter your username or email first.'))
    if (!resetOtp.trim()) return setError(tr('enter_otp_first', 'Enter the OTP code from your authenticator app.'))
    if (resetNewPassword.length < 4) return setError(tr('password_min_4', 'Use at least 4 characters for the new password.'))
    if (resetNewPassword !== resetConfirmPassword) return setError(tr('password_confirm_mismatch', 'Password confirmation does not match.'))

    setError('')
    setLoading(true)
    try {
      const result = await window.api.resetPasswordWithOtp({
        identifier: resetIdentifier.trim(),
        organization: resolvedOrganization,
        otp: resetOtp.trim(),
        newPassword: resetNewPassword,
      })
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
      setLoading(false)
    }
  }

  const handleStartOauth = async (provider) => {
    const resolvedOrganization = String(organizationId || organizationSearch || '').trim()
    if (!resolvedOrganization) {
      setError(tr('enter_organization_first', 'Please choose your organization first.'))
      return
    }
    setError('')
    setOauthLoading(provider)
    try {
      const redirectTo = `${window.location.origin}${window.location.pathname}?auth_mode=login&auth_provider=${encodeURIComponent(provider)}`
      try {
        localStorage.setItem(STORAGE_KEYS.ORGANIZATION, JSON.stringify({
          name: organizationSearch,
          public_id: organizationId,
          slug: organizationSearch,
        }))
      } catch (_) {}
      const result = await window.api.startSupabaseOauth({
        provider,
        mode: 'login',
        organization: resolvedOrganization,
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
    setShowOtpReset(false)
    setError('')
    setResetInfo('')
    setResetOtp('')
    setResetNewPassword('')
    setResetConfirmPassword('')
  }

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

        {!otpRequired && !showOtpReset ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2 rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                <Building2 className="h-4 w-4 text-gray-400" />
                <span>{tr('organization', 'Organization')}</span>
              </div>
              <input
                id="organization-search"
                name="organization_search"
                className="input"
                type="text"
                value={organizationSearch}
                onChange={(event) => setOrganizationSearch(event.target.value)}
                placeholder="LeangCosmetics"
                autoComplete="organization"
              />
              <input
                id="organization-id"
                name="organization_id"
                className="input"
                type="text"
                value={organizationId}
                onChange={(event) => setOrganizationId(event.target.value)}
                placeholder="org_xxxxxxxxxxxxxxxx"
                autoComplete="off"
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
                      }}
                    >
                      {item.name} · {item.public_id}
                    </button>
                  ))}
                </div>
              ) : null}
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {organizationLocked
                  ? tr('organization_join_locked', 'Organization creation is currently disabled. This server is prepared for LeangCosmetics and future organization-ready expansion.')
                  : tr('organization_join_hint', 'Search the organization name, then use the organization ID to sign in.')}
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
                  {tr('oauth_local_account_hint', 'An admin still needs to create your local Business OS account first. Once linked, Google and Facebook keep working on later sign-ins.')}
                </p>
              </div>
            ) : null}

            <button
              type="button"
              className="w-full text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
              onClick={() => {
                setShowOtpReset(true)
                setError('')
                setResetInfo('')
                setResetIdentifier(username || '')
              }}
            >
              {tr('reset_password_with_otp', 'Reset password with OTP')}
            </button>

            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-3 text-xs text-gray-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-gray-300">
              <div className="mb-2 flex items-center gap-2 font-semibold">
                <ScanLine className="h-4 w-4 text-gray-400" />
                <span>{tr('signin_methods', 'Sign-in methods')}</span>
              </div>
              <div>{tr('signin_method_org', 'Organization remembered on this device')}</div>
              <div>{tr('signin_method_password', 'Password login')}</div>
              <div>{tr('signin_method_otp', 'OTP (required for users who enabled 2FA)')}</div>
              {verificationCaps.googleOauth ? <div>{tr('signin_method_google', 'Google sign-in')}</div> : null}
              {verificationCaps.facebookOauth ? <div>{tr('signin_method_facebook', 'Facebook sign-in')}</div> : null}
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                <span className={`rounded-full px-2 py-0.5 ${verificationCaps.supabaseEmailAuth ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300'}`}>
                  {tr('email_login', 'Email login')}: {verificationCaps.supabaseEmailAuth ? tr('provider_ready_short', 'ready') : tr('provider_not_configured_short', 'not configured')}
                </span>
                <span className={`rounded-full px-2 py-0.5 ${verificationCaps.supabaseAuth ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300'}`}>
                  {tr('supabase_auth', 'Supabase Auth')}: {verificationCaps.supabaseAuth ? tr('provider_ready_short', 'ready') : tr('provider_not_configured_short', 'not configured')}
                </span>
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  {tr('otp_recovery', 'OTP recovery')}
                </span>
              </div>
            </div>
          </form>
        ) : null}

        {!otpRequired && showOtpReset ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
              {tr('otp_reset_notice', 'Use the OTP code from your authenticator app to set a new password. If OTP is not enabled on your account, use Google/Facebook sign-in or ask an admin to reset the password.')}
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

            {resetInfo ? <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">{resetInfo}</div> : null}
            {error ? <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</div> : null}

            <button className="btn-primary w-full py-3 text-base" type="button" disabled={loading} onClick={handleResetWithOtp}>
              {loading ? tr('updating_password', 'Updating password...') : tr('reset_password', 'Reset password')}
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
  )
}
