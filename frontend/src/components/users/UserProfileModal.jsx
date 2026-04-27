import { useEffect, useMemo, useRef, useState } from 'react'
import { Chrome, Link2, Mail, ShieldCheck } from 'lucide-react'
import Modal from '../shared/Modal'
import OtpModal from '../utils-settings/OtpModal'
import FilePickerModal from '../files/FilePickerModal'
import { STORAGE_KEYS } from '../../constants'
import { useApp } from '../../AppContext'
import { getFirstLoaderError, settleLoaderMap } from '../../utils/loaders.mjs'

const OAUTH_LINK_PENDING_KEY = 'business_os_oauth_link_pending'

/**
 * 1. User Profile Modal
 * 1.1 Purpose
 * - Self-service account updates for all users.
 * - Admin override mode for privileged accounts.
 * - OTP and linked-provider account controls.
 */

function AvatarPreview({ name, avatarPath }) {
  if (avatarPath) {
    return (
      <img
        src={avatarPath}
        alt={name || 'Avatar'}
        className="h-16 w-16 rounded-2xl object-cover ring-2 ring-blue-100 dark:ring-blue-900/40"
      />
    )
  }

  return (
    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100 text-xl font-bold text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
      {name?.[0]?.toUpperCase() || 'U'}
    </div>
  )
}

export default function UserProfileModal({ onClose }) {
  const { user, notify, hasPermission, saveSettings, settings, t } = useApp()
  const tr = (key, fallback) => {
    const value = typeof t === 'function' ? t(key) : null
    return value && value !== key ? value : fallback
  }
  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [profile, setProfile] = useState(null)
  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const [otpEnabled, setOtpEnabled] = useState(false)
  const [otpMode, setOtpMode] = useState(null)
  const [oauthConnecting, setOauthConnecting] = useState('')
  const [disconnectingProvider, setDisconnectingProvider] = useState('')
  const [verificationCaps, setVerificationCaps] = useState({
    googleOauth: false,
    supabaseAuth: false,
    supabaseEmailAuth: false,
  })
  const [authMethods, setAuthMethods] = useState(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [sessionDuration, setSessionDuration] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.SESSION_DURATION) || 'session'
    } catch (_) {
      return 'session'
    }
  })
  const avatarFileInputRef = useRef(null)

  /**
   * 2. Derived State
   * 2.1 Admins can bypass current-password checks for profile/password writes.
   */
  const canAdminOverride = hasPermission('all')
  const needsSensitivePassword = !canAdminOverride || !!authMethods?.google_linked
  const title = tr('my_profile', 'My Profile')

  /**
   * 3. Data Hydration
   * 3.1 Load profile, OTP status, and provider capabilities.
   */
  const loadProfile = async () => {
    if (!user?.id) return
    setLoading(true)
    try {
      const result = await settleLoaderMap({
        profile: () => window.api.getUserProfile(user.id),
        otp: () => window.api.otpStatus(user.id),
        caps: () => window.api.getVerificationCapabilities?.().catch(() => null),
        authMethods: () => window.api.getUserAuthMethods?.(user.id).catch(() => null),
      })
      const profileResult = result.values.profile
      const otpResult = result.values.otp
      const capsResult = result.values.caps
      const authMethodsResult = result.values.authMethods

      if (!result.hasAnySuccess || !profileResult) {
        throw new Error(getFirstLoaderError(result.errors, 'Failed to load profile'))
      }
      if (profileResult?.success === false) throw new Error(profileResult.error || 'Failed to load profile')
      const { success: _success, ...profileData } = profileResult || {}
      setProfile(profileData)
      setOtpEnabled(!!otpResult?.otpEnabled)
      if (capsResult && capsResult.success !== false) {
        setVerificationCaps({
          googleOauth: capsResult.google_oauth === true,
          supabaseAuth: capsResult.supabase_auth === true,
          supabaseEmailAuth: capsResult.supabase_email_auth === true,
        })
      }
      if (authMethodsResult && authMethodsResult.success !== false) {
        const { success: _authSuccess, ...authData } = authMethodsResult || {}
        setAuthMethods(authData)
      }
      if (result.hasErrors) {
        notify(tr('profile_partial_load', 'Some sign-in details are still catching up. The main profile is ready.'), 'warning')
      }
    } catch (error) {
      notify(error?.message || 'Failed to load profile', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadProfile() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const preferred = String(settings?.login_session_duration || '').trim()
    if (!preferred) return
    setSessionDuration(preferred)
  }, [settings?.login_session_duration])

  const verificationHelp = useMemo(() => {
    return canAdminOverride
      ? tr('admin_profile_override_hint', 'Admins can overwrite account fields directly while still keeping sign-in methods attached to the same account.')
      : tr('self_service_profile_hint', 'Self-service changes require your current password. OTP and linked providers remain the main recovery paths here.')
  }, [canAdminOverride, t])

  /**
   * 4. Profile + Security Mutations
   * 4.1 Profile update.
   * 4.2 Password update.
   * 4.3 Session-duration preference update.
   */
  const handleProfileSave = async () => {
    if (!profile?.name?.trim() || !profile?.username?.trim()) {
      notify(tr('name_username_required', 'Name and username are required'), 'error')
      return
    }
    if (!canAdminOverride && !currentPassword.trim()) {
      notify(tr('current_password_required_save', 'Current password is required to save account changes'), 'error')
      return
    }

    setSavingProfile(true)
    try {
      const previousEmail = String(profile.email || '').trim().toLowerCase()
      const result = await window.api.updateUserProfile(user.id, {
        name: profile.name,
        username: profile.username,
        phone: profile.phone,
        email: profile.email,
        avatar_path: profile.avatar_path,
        currentPassword: canAdminOverride ? undefined : currentPassword,
        adminOverride: canAdminOverride,
        userId: user.id,
        userName: user.name,
      })
      if (result?.success === false) {
        notify(result.error || 'Failed to save profile', 'error')
        return
      }
      const { success: _success, ...nextUser } = result || {}
      if (nextUser) {
        window.dispatchEvent(new CustomEvent('user:updated', { detail: nextUser }))
        setProfile(nextUser)
      }
      const authResult = await window.api.getUserAuthMethods?.(user.id).catch(() => null)
      if (authResult && authResult.success !== false) {
        const { success: _authSuccess, ...authData } = authResult || {}
        setAuthMethods(authData)
      }
      setCurrentPassword('')
      const nextEmail = String(nextUser?.email || '').trim().toLowerCase()
      const emailChanged = previousEmail !== nextEmail
      if (emailChanged && nextEmail) {
        notify(tr('profile_updated_email_changed', 'Profile updated. The new email is now attached to this account.'), 'success')
      } else {
        notify(tr('profile_updated', 'Profile updated'), 'success')
      }
    } catch (error) {
      notify(error?.message || 'Failed to save profile', 'error')
    } finally {
      setSavingProfile(false)
    }
  }

  const handlePasswordSave = async () => {
    if (newPassword.length < 4) return notify(tr('new_password_min_length', 'Use at least 4 characters for the new password'), 'error')
    if (newPassword !== confirmPassword) return notify(tr('new_password_confirm_mismatch', 'New password confirmation does not match'), 'error')
    if (!canAdminOverride && !currentPassword.trim()) return notify(tr('current_password_required_change', 'Current password is required to change password'), 'error')

    setSavingPassword(true)
    try {
      const result = await window.api.changeUserPassword(user.id, {
        currentPassword: canAdminOverride ? undefined : currentPassword,
        newPassword,
        adminOverride: canAdminOverride,
        userId: user.id,
        userName: user.name,
      })
      if (result?.success === false) {
        notify(result.error || 'Failed to change password', 'error')
        return
      }
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      notify(tr('password_updated', 'Password updated'), 'success')
    } catch (error) {
      notify(error?.message || 'Failed to change password', 'error')
    } finally {
      setSavingPassword(false)
    }
  }

  const handleSessionSave = () => {
    Promise.resolve(saveSettings?.({ login_session_duration: sessionDuration }))
      .catch((error) => {
        notify(error?.message || 'Failed to save login duration preference', 'error')
      })
  }

  const refreshOtpState = async () => {
    setOtpMode(null)
    await loadProfile()
    notify(tr('security_settings_updated', 'Security settings updated'), 'success')
  }

  const handleAvatarPick = () => avatarFileInputRef.current?.click()

  const handleStartOauthLink = async (provider) => {
    const normalizedProvider = String(provider || '').trim().toLowerCase()
    if (!normalizedProvider) return
    if (!verificationCaps.supabaseAuth) {
      notify(tr('supabase_auth_not_ready', 'Supabase auth is not ready yet.'), 'error')
      return
    }

    setOauthConnecting(normalizedProvider)
    try {
      try {
        localStorage.setItem(OAUTH_LINK_PENDING_KEY, JSON.stringify({
          userId: user?.id || null,
          provider: normalizedProvider,
          email: String(profile?.email || '').trim().toLowerCase(),
          startedAt: Date.now(),
        }))
      } catch (_) {}
      const redirectTo = `${window.location.origin}${window.location.pathname}?auth_mode=link&auth_provider=${encodeURIComponent(normalizedProvider)}`
      const result = await window.api.startSupabaseOauth({
        provider: normalizedProvider,
        mode: 'link',
        redirectTo,
      })
      if (result?.success === false || !result?.url) {
        notify(result?.error || tr('oauth_start_failed', 'Unable to start sign-in with provider.'), 'error')
        return
      }
      window.location.assign(result.url)
    } catch (error) {
      notify(error?.message || tr('oauth_start_failed', 'Unable to start sign-in with provider.'), 'error')
    } finally {
      setOauthConnecting('')
    }
  }

  const handleDisconnectOauthProvider = async (provider) => {
    const normalizedProvider = String(provider || '').trim().toLowerCase()
    if (!normalizedProvider) return
    if (!currentPassword.trim()) {
      notify(tr('current_password_required_disconnect', 'Current password is required to disconnect a sign-in provider.'), 'error')
      return
    }

    setDisconnectingProvider(normalizedProvider)
    try {
      const result = await window.api.disconnectUserAuthProvider(user.id, {
        provider: normalizedProvider,
        currentPassword,
      })
      if (result?.success === false) {
        notify(result.error || tr('identity_unlink_failed', 'Failed to disconnect sign-in method.'), 'error')
        return
      }
      if (result?.methods) {
        setAuthMethods(result.methods)
      } else {
        const authResult = await window.api.getUserAuthMethods?.(user.id).catch(() => null)
        if (authResult && authResult.success !== false) {
          const { success: _authSuccess, ...authData } = authResult || {}
          setAuthMethods(authData)
        }
      }
      setCurrentPassword('')
      notify(tr('identity_unlinked_success', 'Sign-in method disconnected.'), 'success')
    } catch (error) {
      notify(error?.message || tr('identity_unlink_failed', 'Failed to disconnect sign-in method.'), 'error')
    } finally {
      setDisconnectingProvider('')
    }
  }

  /**
   * 6. Avatar Upload
   * 6.1 Read image as data URL.
   * 6.2 Upload through backend media endpoint.
   */
  const handleAvatarSelected = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      notify(tr('choose_image_file', 'Please choose an image file'), 'error')
      return
    }
    setUploadingAvatar(true)
    try {
      const uploadResult = await window.api.uploadUserAvatar({ file })
      if (!uploadResult?.path) throw new Error(tr('upload_no_image_path', 'Upload did not return an image path'))
      setProfile((current) => ({ ...current, avatar_path: uploadResult.path }))
      notify(tr('avatar_uploaded', 'Avatar uploaded'), 'success')
    } catch (error) {
      notify(error?.message || 'Avatar upload failed', 'error')
    } finally {
      setUploadingAvatar(false)
    }
  }

  return (
    <>
      <Modal title={title} onClose={onClose} wide>
        {loading || !profile ? (
          <div className="py-10 text-center text-sm text-gray-400">{tr('loading_account', 'Loading account...')}</div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col gap-4 rounded-2xl bg-gray-50 p-4 dark:bg-zinc-800/70 sm:flex-row sm:items-center">
              <AvatarPreview name={profile.name} avatarPath={profile.avatar_path} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-lg font-semibold text-gray-900 dark:text-white">{profile.name}</div>
                <div className="truncate text-sm text-gray-500 dark:text-gray-400">@{profile.username}</div>
                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  {profile.role_name || (t('no_role') || 'No role')} {' | '} {otpEnabled ? tr('otp_enabled', 'OTP enabled') : tr('otp_not_enabled', 'OTP not enabled')}
                </div>
              </div>
            </div>

            <section className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{tr('account_details', 'Account details')}</h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{verificationHelp}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="profile-name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('full_name', 'Full name')}</label>
                  <input id="profile-name" name="name" className="input" value={profile.name || ''} onChange={(e) => setProfile((prev) => ({ ...prev, name: e.target.value }))} />
                </div>
                <div>
                  <label htmlFor="profile-username" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('username', 'Username')}</label>
                  <input id="profile-username" name="username" className="input" value={profile.username || ''} onChange={(e) => setProfile((prev) => ({ ...prev, username: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-3">
                <div className="rounded-xl border border-gray-200 p-3 dark:border-zinc-700">
                  <label htmlFor="profile-phone" className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('phone', 'Phone')}</label>
                  <input
                    id="profile-phone"
                    name="phone"
                    className="input"
                    value={profile.phone || ''}
                    onChange={(e) => setProfile((prev) => ({ ...prev, phone: e.target.value }))}
                    placeholder="+85512345678"
                  />
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {tr('phone_contact_only_hint', 'Phone number is stored as a contact field only. Verification is paused for now.')}
                  </p>
                </div>

                <div className="rounded-xl border border-gray-200 p-3 dark:border-zinc-700">
                  <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
                    <div>
                      <label htmlFor="profile-email" className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('email', 'Email')}</label>
                      <input
                        id="profile-email"
                        name="email"
                        type="email"
                        className="input"
                        value={profile.email || ''}
                        onChange={(e) => setProfile((prev) => ({ ...prev, email: e.target.value }))}
                      />
                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        {tr('profile_email_note', 'Used for email login, password changes, account notices, and matching existing provider records when helpful. Google can still be linked independently.')}
                      </p>
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{tr('account_email_usage', 'Account email')}</div>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${profile.email?.trim() ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                          {profile.email?.trim() ? tr('saved', 'Saved') : tr('optional', 'Optional')}
                        </span>
                      </div>
                      <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-3 text-xs text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-200">
                        {tr('email_login_simple_note', 'No separate email verification step is required here. Save your email once, then use OTP, Google, or your password for account access and recovery flows.')}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label htmlFor="profile-avatar" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('avatar_image', 'Avatar image')}</label>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={handleAvatarPick} disabled={uploadingAvatar}>
                      {uploadingAvatar ? tr('uploading', 'Uploading...') : tr('upload_image', 'Upload image')}
                    </button>
                    <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => setFilePickerOpen(true)}>
                      Files
                    </button>
                  </div>
                </div>
                <input
                  id="profile-avatar"
                  name="profile_avatar"
                  ref={avatarFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarSelected}
                />
                <div className="mt-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-gray-400">
                  {profile.avatar_path || tr('no_avatar_uploaded', 'No avatar uploaded yet.')}
                </div>
              </div>
              <div className="flex justify-end">
                <button className="btn-primary" onClick={handleProfileSave} disabled={savingProfile}>
                  {savingProfile ? tr('saving', 'Saving...') : tr('save_profile', 'Save profile')}
                </button>
              </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-gray-200 p-4 dark:border-zinc-700">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                  <Link2 className="h-4 w-4 text-gray-400" />
                  <span>{tr('sign_in_methods', 'Sign-in methods')}</span>
                </h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {tr('sign_in_methods_desc', 'Keep your local admin-created account and add email or Google sign-in methods whenever you want them.' )}
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-gray-200 p-3 dark:border-zinc-700">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-200">
                    <Mail className="h-4 w-4 text-gray-400" />
                    <span>{tr('email_login', 'Email login')}</span>
                  </div>
                  <div className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${authMethods?.email_login_enabled ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                    {authMethods?.email_login_enabled ? tr('enabled', 'enabled') : tr('setup_needed', 'setup needed')}
                  </div>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {!profile.email?.trim()
                      ? tr('add_email_for_login_note', 'Add your account email first to use email sign-in on the login screen.')
                      : tr('email_login_ready_note_simple', 'Email sign-in is ready once this email is saved on your account.')}
                  </p>
                </div>

                <div className="rounded-xl border border-gray-200 p-3 dark:border-zinc-700">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-200">
                    <Chrome className="h-4 w-4 text-gray-400" />
                    <span>{tr('google_signin', 'Google')}</span>
                  </div>
                  <div className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${authMethods?.google_linked ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : authMethods?.google_ready ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-gray-100 text-gray-600 dark:bg-zinc-700 dark:text-gray-300'}`}>
                    {authMethods?.google_linked
                      ? tr('connected', 'Connected')
                      : authMethods?.google_ready
                        ? tr('ready_on_login', 'Ready on login')
                        : tr('setup_needed', 'setup needed')}
                  </div>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {verificationCaps.googleOauth
                      ? (authMethods?.google_ready
                        ? tr('google_login_ready_note', 'Connect Google once here, then you can keep signing in with that Google account.')
                        : tr('google_provider_disabled_note', 'Google sign-in is not enabled in Supabase yet.'))
                      : tr('google_provider_disabled_note', 'Google sign-in is not enabled in Supabase yet.')}
                  </p>
                  {authMethods?.google_linked && needsSensitivePassword ? (
                    <div className="mt-3 space-y-2">
                      <label htmlFor="disconnect-google-password" className="block text-xs font-medium text-gray-600 dark:text-gray-300">
                        {tr('current_password', 'Current password')}
                      </label>
                      <input
                        id="disconnect-google-password"
                        name="disconnect_google_password"
                        type="password"
                        autoComplete="current-password"
                        className="input text-sm"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                      />
                      <p className="text-[11px] text-gray-400 dark:text-gray-500">
                        {tr('disconnect_google_password_hint', 'Use your current password before disconnecting Google from this account.')}
                      </p>
                    </div>
                  ) : null}
                  {verificationCaps.googleOauth && authMethods?.google_ready ? (
                    authMethods?.google_linked ? (
                      <button type="button" className="btn-secondary mt-3 px-3 py-1 text-xs" disabled={disconnectingProvider === 'google'} onClick={() => handleDisconnectOauthProvider('google')}>
                        {disconnectingProvider === 'google' ? tr('disconnecting', 'Disconnecting...') : tr('disconnect_google', 'Disconnect Google')}
                      </button>
                    ) : (
                      <button type="button" className="btn-secondary mt-3 px-3 py-1 text-xs" disabled={oauthConnecting === 'google'} onClick={() => handleStartOauthLink('google')}>
                        {oauthConnecting === 'google' ? tr('connecting', 'Connecting...') : tr('connect_google', 'Connect Google')}
                      </button>
                    )
                  ) : null}
                </div>

              </div>

              <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-500 dark:bg-zinc-800/70 dark:text-gray-400">
                <div>{tr('provider_email_match_note', 'Google stays linked to this local account once connected here. Disabled or deleted local users still cannot access the app.')}</div>
                <div className="mt-2">{tr('provider_change_note', 'To switch to another Google account, disconnect the current one first and then connect the new provider.')}</div>
              </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-gray-200 p-4 dark:border-zinc-700">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                  <ShieldCheck className="h-4 w-4 text-gray-400" />
                  <span>{tr('security', 'Security')}</span>
                </h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{tr('profile_security_desc', 'Manage password, OTP login protection, and your default login duration.')}</p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600 dark:bg-zinc-700 dark:text-gray-300">{tr('username_login', 'Username login')}</span>
                  <span className={`rounded-full px-2 py-0.5 ${profile.email?.trim() ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                    {tr('email_login', 'Email login')} {profile.email?.trim() ? tr('enabled', 'enabled') : tr('setup_needed', 'setup needed')}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 ${otpEnabled ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-gray-100 text-gray-600 dark:bg-zinc-700 dark:text-gray-300'}`}>
                    OTP 2FA {otpEnabled ? tr('on', 'on') : tr('off', 'off')}
                  </span>
                </div>
              </div>
              {needsSensitivePassword ? (
                <div>
                  <label htmlFor="security-current-password" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {tr('current_password', 'Current password')}
                  </label>
                  <input
                    id="security-current-password"
                    name="current_password"
                    type="password"
                    autoComplete="current-password"
                    className="input"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {tr('current_password_sensitive_note', 'Needed before changing your password or disconnecting Google from this account.')}
                  </p>
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="new-password" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('new_password', 'New password')}</label>
                  <input id="new-password" name="new_password" type="password" autoComplete="new-password" className="input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="confirm-password" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('confirm_new_password', 'Confirm new password')}</label>
                  <input id="confirm-password" name="confirm_password" type="password" autoComplete="new-password" className="input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <button className="btn-primary" onClick={handlePasswordSave} disabled={savingPassword}>
                  {savingPassword ? tr('updating', 'Updating...') : tr('change_password', 'Change password')}
                </button>
                <button className="btn-secondary" onClick={() => setOtpMode(otpEnabled ? 'disable' : 'setup')}>
                  {otpEnabled ? tr('disable_otp_login', 'Disable OTP login') : tr('enable_otp_login', 'Enable OTP login')}
                </button>
              </div>

              <div className="grid gap-3 rounded-xl bg-gray-50 p-4 dark:bg-zinc-800/70 sm:grid-cols-[1fr_auto] sm:items-end">
                <div>
                  <label htmlFor="session-duration-profile" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('session_duration', 'Default login duration')}</label>
                  <select id="session-duration-profile" name="session_duration" className="input" value={sessionDuration} onChange={(e) => setSessionDuration(e.target.value)}>
                    <option value="session">{tr('until_browser_closes', 'Until browser closes')}</option>
                    <option value="1d">{tr('for_1_day', 'For 1 day')}</option>
                    <option value="3d">{tr('for_3_days', 'For 3 days')}</option>
                    <option value="7d">{tr('for_7_days', 'For 7 days')}</option>
                    <option value="14d">{tr('for_14_days', 'For 14 days')}</option>
                    <option value="30d">{tr('for_30_days', 'For 30 days')}</option>
                  </select>
                </div>
                <button className="btn-secondary" onClick={handleSessionSave}>{tr('save_login_duration', 'Save login duration')}</button>
              </div>
            </section>
          </div>
        )}
      </Modal>

      {otpMode ? (
        <OtpModal
          mode={otpMode}
          userId={user?.id}
          onClose={() => setOtpMode(null)}
          onDone={refreshOtpState}
          t={t}
        />
      ) : null}
      <FilePickerModal
        open={filePickerOpen}
        mediaType="image"
        title={tr('avatar_image', 'Avatar image')}
        onClose={() => setFilePickerOpen(false)}
        onSelect={(publicPath) => setProfile((current) => ({ ...current, avatar_path: publicPath }))}
      />
    </>
  )
}
