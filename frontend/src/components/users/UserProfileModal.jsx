import { useEffect, useMemo, useRef, useState } from 'react'
import { Chrome, Facebook, Link2, Mail, ShieldCheck } from 'lucide-react'
import Modal from '../shared/Modal'
import OtpModal from '../utils-settings/OtpModal'
import FilePickerModal from '../files/FilePickerModal'
import { STORAGE_KEYS } from '../../constants'
import { useApp } from '../../AppContext'

/**
 * 1. User Profile Modal
 * 1.1 Purpose
 * - Self-service account updates for all users.
 * - Admin override mode for privileged accounts.
 * - Email verification and OTP security controls.
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
  const { user, notify, hasPermission, t } = useApp()
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
  const [emailCode, setEmailCode] = useState('')
  const [sendingEmailCode, setSendingEmailCode] = useState(false)
  const [verifyingEmailCode, setVerifyingEmailCode] = useState(false)
  const [oauthConnecting, setOauthConnecting] = useState('')
  const [verificationCaps, setVerificationCaps] = useState({
    email: true,
    googleOauth: false,
    facebookOauth: false,
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
  const title = tr('my_profile', 'My Profile')

  /**
   * 3. Data Hydration
   * 3.1 Load profile, OTP status, and verification provider capabilities.
   */
  const loadProfile = async () => {
    if (!user?.id) return
    setLoading(true)
    try {
      const [profileResult, otpResult, capsResult, authMethodsResult] = await Promise.all([
        window.api.getUserProfile(user.id),
        window.api.otpStatus(user.id),
        window.api.getVerificationCapabilities?.().catch(() => null),
        window.api.getUserAuthMethods?.(user.id).catch(() => null),
      ])
      if (profileResult?.success === false) throw new Error(profileResult.error || 'Failed to load profile')
      const { success: _success, ...profileData } = profileResult || {}
      setProfile(profileData)
      setOtpEnabled(!!otpResult?.otpEnabled)
      if (capsResult && capsResult.success !== false) {
        setVerificationCaps({
          email: capsResult.email !== false,
          googleOauth: capsResult.google_oauth === true,
          facebookOauth: capsResult.facebook_oauth === true,
          supabaseAuth: capsResult.supabase_auth === true,
          supabaseEmailAuth: capsResult.supabase_email_auth === true,
        })
      }
      if (authMethodsResult && authMethodsResult.success !== false) {
        const { success: _authSuccess, ...authData } = authMethodsResult || {}
        setAuthMethods(authData)
      }
    } catch (error) {
      notify(error?.message || 'Failed to load profile', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadProfile() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const verificationHelp = useMemo(() => {
    return canAdminOverride
      ? tr('admin_profile_override_hint', 'Admins can overwrite account fields directly and still send verification codes when needed.')
      : tr('self_service_profile_hint', 'Self-service changes require your current password. You can verify your email with a one-time check.')
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
      const previousVerified = Number(profile.email_verified || 0) === 1
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
      const nextVerified = Number(nextUser?.email_verified || 0) === 1
      const emailChanged = previousEmail !== nextEmail
      if (emailChanged && nextEmail && previousVerified && !nextVerified) {
        notify(tr('profile_updated_email_reverify', 'Profile updated. Your new email replaced the previous one and now needs verification.'), 'success')
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
    try {
      localStorage.setItem(STORAGE_KEYS.SESSION_DURATION, sessionDuration)
      notify(tr('login_duration_saved', 'Login duration preference saved. It will be used on the next login.'), 'success')
    } catch (error) {
      notify(error?.message || 'Failed to save login duration preference', 'error')
    }
  }

  const refreshOtpState = async () => {
    setOtpMode(null)
    await loadProfile()
    notify(tr('security_settings_updated', 'Security settings updated'), 'success')
  }

  const requestContactCode = async () => {
    if (!verificationCaps.email && !verificationCaps.supabaseEmailAuth) {
      notify(tr('email_sender_setup_needed', 'Email code sending is not configured yet. Ask admin to configure an email sender provider.'), 'error')
      return
    }
    const value = profile?.email
    if (!String(value || '').trim()) {
      notify(tr('add_email_first', 'Add an email first.'), 'error')
      return
    }
    setSendingEmailCode(true)

    try {
      const result = await window.api.requestUserContactVerification(user.id, {
        channel: 'email',
        value,
        redirectTo: `${window.location.origin}${window.location.pathname}`,
        userId: user.id,
      })
      if (result?.success === false) {
        notify(result.error || 'Failed to send verification code', 'error')
        return
      }
      notify(
        result?.mode === 'supabase_email_link'
          ? (result?.alreadyConfirmed
            ? tr('email_already_verified', 'Email is already verified.')
            : tr('verification_email_sent_to', 'Verification email sent to {destination}. Open it and click the confirmation link, then refresh status here.').replace('{destination}', profile?.email || 'your inbox'))
          : result?.destination
            ? tr('verification_code_sent_to', 'Verification code sent to {destination}').replace('{destination}', result.destination)
            : tr('verification_code_sent', 'Verification code sent.'),
        'success',
      )
    } catch (error) {
      notify(error?.message || 'Failed to send verification code', 'error')
    } finally {
      setSendingEmailCode(false)
    }
  }

  const confirmContactCode = async () => {
    const code = emailCode
    const value = profile?.email
    if (!String(code || '').trim()) {
      notify(tr('enter_verification_code_first', 'Enter the verification code first.'), 'error')
      return
    }
    if (!String(value || '').trim()) {
      notify(tr('email_missing', 'Email is missing.'), 'error')
      return
    }
    setVerifyingEmailCode(true)

    try {
      const result = await window.api.confirmUserContactVerification(user.id, {
        channel: 'email',
        value,
        code: String(code).trim(),
        userId: user.id,
      })
      if (result?.success === false) {
        notify(result.error || 'Invalid verification code', 'error')
        return
      }
      const { success: _success, ...nextUser } = result || {}
      if (nextUser) {
        setProfile(nextUser)
        window.dispatchEvent(new CustomEvent('user:updated', { detail: nextUser }))
      }
      const authResult = await window.api.getUserAuthMethods?.(user.id).catch(() => null)
      if (authResult && authResult.success !== false) {
        const { success: _authSuccess, ...authData } = authResult || {}
        setAuthMethods(authData)
      }
      setEmailCode('')
      notify(tr('email_verified_success', 'Email verified.'), 'success')
    } catch (error) {
      notify(error?.message || 'Verification failed', 'error')
    } finally {
      setVerifyingEmailCode(false)
    }
  }

  const refreshEmailVerification = async () => {
    setVerifyingEmailCode(true)
    try {
      const authMethodsResult = await window.api.getUserAuthMethods?.(user.id).catch(() => null)
      const profileResult = await window.api.getUserProfile(user.id)
      if (profileResult?.success === false) {
        notify(profileResult.error || tr('verification_refresh_failed', 'Failed to refresh verification status.'), 'error')
        return
      }
      const { success: _success, ...nextUser } = profileResult || {}
      if (nextUser) {
        setProfile(nextUser)
        window.dispatchEvent(new CustomEvent('user:updated', { detail: nextUser }))
      }
      if (authMethodsResult && authMethodsResult.success !== false) {
        const { success: _authSuccess, ...authData } = authMethodsResult || {}
        setAuthMethods(authData)
      }
      notify(
        nextUser?.email_verified
          ? tr('email_verified_success', 'Email verified.')
          : tr('verification_status_refreshed', 'Verification status refreshed. If you just clicked the email link, wait a moment and try again.'),
        'success',
      )
    } catch (error) {
      notify(error?.message || tr('verification_refresh_failed', 'Failed to refresh verification status.'), 'error')
    } finally {
      setVerifyingEmailCode(false)
    }
  }

  const handleAvatarPick = () => avatarFileInputRef.current?.click()

  const handleStartOauthLink = async (provider) => {
    const normalizedProvider = String(provider || '').trim().toLowerCase()
    if (!normalizedProvider) return
    if (!verificationCaps.supabaseAuth) {
      notify(tr('supabase_auth_not_ready', 'Supabase auth is not ready yet.'), 'error')
      return
    }
    if (!String(profile?.email || '').trim()) {
      notify(tr('add_email_for_social_link', 'Add and save your account email first, then connect this sign-in method.'), 'error')
      return
    }

    setOauthConnecting(normalizedProvider)
    try {
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
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <label htmlFor="profile-email" className="text-sm font-medium text-gray-700 dark:text-gray-300">{tr('email', 'Email')}</label>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${profile.email_verified ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                          {profile.email_verified ? tr('verified', 'Verified') : tr('not_verified', 'Not verified')}
                        </span>
                      </div>
                      <input
                        id="profile-email"
                        name="email"
                        type="email"
                        className="input"
                        value={profile.email || ''}
                        onChange={(e) => setProfile((prev) => ({ ...prev, email: e.target.value }))}
                      />
                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        {tr('profile_email_note', 'Used for email login, password reset, and matching Google or Facebook sign-in to this account.')}
                      </p>
                    </div>
                    <div>
                      {verificationCaps.supabaseEmailAuth ? (
                        <>
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{tr('email_verification', 'Email verification')}</div>
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-300">
                              {tr('supabase_smtp_ready', 'Supabase ready')}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={requestContactCode} disabled={sendingEmailCode}>
                              {sendingEmailCode ? tr('sending', 'Sending...') : tr('send_verification_email', 'Send verification email')}
                            </button>
                            <button type="button" className="btn-primary px-3 py-1 text-xs" onClick={refreshEmailVerification} disabled={verifyingEmailCode}>
                              {verifyingEmailCode ? tr('refreshing', 'Refreshing...') : tr('refresh_status', 'Refresh status')}
                            </button>
                          </div>
                          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            {tr('supabase_verification_email_note', 'Supabase sends the confirmation email through your configured SMTP. Open the email, confirm the address, then refresh status here.')}
                          </p>
                        </>
                      ) : verificationCaps.email ? (
                        <>
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{tr('email_code_sender', '6-digit email code sender')}</div>
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-300">
                              {tr('email_sender_ready', 'Sender ready')}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={requestContactCode} disabled={sendingEmailCode}>
                              {sendingEmailCode ? tr('sending', 'Sending...') : tr('send_code', 'Send code')}
                            </button>
                            <input
                              id="profile-email-code"
                              name="email_code"
                              className="input min-w-[120px] flex-1 text-sm"
                              inputMode="numeric"
                              maxLength={6}
                              placeholder={tr('six_digit_code', '6-digit code')}
                              value={emailCode}
                              onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                            />
                            <button type="button" className="btn-primary px-3 py-1 text-xs" onClick={confirmContactCode} disabled={verifyingEmailCode}>
                              {verifyingEmailCode ? tr('verifying', 'Verifying...') : tr('verify', 'Verify')}
                            </button>
                          </div>
                          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            {tr('email_sender_ready_note', 'Use this only if you want local 6-digit verification codes in addition to Supabase sign-in.')}
                          </p>
                        </>
                      ) : (
                        <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-3 text-xs text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-200">
                          {tr('email_sender_only_note', 'Email verification and reset codes need a configured mail sender.')}
                        </div>
                      )}
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
              {!canAdminOverride ? (
                <div>
                  <label htmlFor="profile-current-password" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('current_password', 'Current password')}</label>
                  <input id="profile-current-password" name="current_password" type="password" autoComplete="current-password" className="input" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
                </div>
              ) : null}
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
                  {tr('sign_in_methods_desc', 'Keep your local admin-created account and add matching email, Google, or Facebook sign-in when ready.')}
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
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
                      : profile.email_verified
                        ? tr('email_login_ready_note', 'Email sign-in is ready. Verified email also helps recovery and provider matching.')
                        : tr('verify_email_first_note', 'Email sign-in works with your saved email. Verify it to make recovery and provider matching more reliable.')}
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
                        : tr('email_needed', 'Email needed')}
                  </div>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {verificationCaps.googleOauth
                      ? (authMethods?.google_ready
                        ? tr('google_login_ready_note', 'Save your email, then connect Google once so this account keeps the provider linked and easier to recognize later.')
                        : tr('google_email_required_note', 'Save an email on this profile first. Google sign-in matches accounts by email.'))
                      : tr('google_provider_disabled_note', 'Google sign-in is not enabled in Supabase yet.')}
                  </p>
                  {verificationCaps.googleOauth && authMethods?.google_ready && !authMethods?.google_linked ? (
                    <button type="button" className="btn-secondary mt-3 px-3 py-1 text-xs" disabled={oauthConnecting === 'google'} onClick={() => handleStartOauthLink('google')}>
                      {oauthConnecting === 'google' ? tr('connecting', 'Connecting...') : tr('connect_google', 'Connect Google')}
                    </button>
                  ) : null}
                </div>

                <div className="rounded-xl border border-gray-200 p-3 dark:border-zinc-700">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-200">
                    <Facebook className="h-4 w-4 text-gray-400" />
                    <span>{tr('facebook_signin', 'Facebook')}</span>
                  </div>
                  <div className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${authMethods?.facebook_linked ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : authMethods?.facebook_ready ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-gray-100 text-gray-600 dark:bg-zinc-700 dark:text-gray-300'}`}>
                    {authMethods?.facebook_linked
                      ? tr('connected', 'Connected')
                      : authMethods?.facebook_ready
                        ? tr('ready_on_login', 'Ready on login')
                        : tr('email_needed', 'Email needed')}
                  </div>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {verificationCaps.facebookOauth
                      ? (authMethods?.facebook_ready
                        ? tr('facebook_login_ready_note', 'Save your email, then connect Facebook once so this account keeps the provider linked and easier to recognize later.')
                        : tr('facebook_email_required_note', 'Save an email on this profile first. Facebook sign-in matches accounts by email.'))
                      : tr('facebook_provider_disabled_note', 'Facebook sign-in is not enabled in Supabase yet.')}
                  </p>
                  {verificationCaps.facebookOauth && authMethods?.facebook_ready && !authMethods?.facebook_linked ? (
                    <button type="button" className="btn-secondary mt-3 px-3 py-1 text-xs" disabled={oauthConnecting === 'facebook'} onClick={() => handleStartOauthLink('facebook')}>
                      {oauthConnecting === 'facebook' ? tr('connecting', 'Connecting...') : tr('connect_facebook', 'Connect Facebook')}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-500 dark:bg-zinc-800/70 dark:text-gray-400">
                {tr('provider_email_match_note', 'Google and Facebook connect to the local account when the provider email matches your account email. Disabled or deleted local users still cannot access the app.')}
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
                  <span className={`rounded-full px-2 py-0.5 ${profile.email_verified ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                    {tr('email_login', 'Email login')} {profile.email_verified ? tr('enabled', 'enabled') : tr('verify_to_enable', 'verify to enable')}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 ${otpEnabled ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-gray-100 text-gray-600 dark:bg-zinc-700 dark:text-gray-300'}`}>
                    OTP 2FA {otpEnabled ? tr('on', 'on') : tr('off', 'off')}
                  </span>
                </div>
              </div>
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
                    <option value="7d">7 days</option>
                    <option value="30d">30 days</option>
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
