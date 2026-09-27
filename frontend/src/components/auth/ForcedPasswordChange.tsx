import type { FormEvent } from 'react'
import { useState } from 'react'
import LockKeyhole from 'lucide-react/dist/esm/icons/lock-keyhole.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { changeUserPassword } from '../../api/userAdminTransport.ts'
import { withLoaderTimeout } from '../../utils/loaders.ts'
import { currentPasswordRateLimitMessage } from '../users/currentPasswordErrors.ts'

// S-auth4b: shown instead of the app while the signed-in account is marked
// must_change_password -- it signed in with a password that is publicly known
// (it sits in this project's public git history). The Worker refuses every
// other request with 403 password_change_required until the password is
// changed (cloudflare/src/lib/auth.ts requireAuth), so this screen is the
// only thing that can work: change the password here, or sign out.
//
// The server is the authority on what is allowed; the checks below only save
// a round trip (length 6 = cloudflare/src/lib/passwordPolicy.ts
// MIN_PASSWORD_LENGTH, the same literal My Profile uses).

type ForcedPasswordUser = { id?: number | string; username?: string; name?: string } | null
type ForcedPasswordAppContext = {
  user: ForcedPasswordUser
  t: (key: string) => string
  logout: () => Promise<void>
}
const useApp = useAppHook as () => ForcedPasswordAppContext

export const PASSWORD_KNOWN_LEAKED_CODE = 'password_known_leaked'

function resultCode(value: unknown): string {
  return value && typeof value === 'object' ? String((value as { code?: unknown }).code || '') : ''
}

function resultMessage(value: unknown): string {
  if (value instanceof Error) return value.message
  if (value && typeof value === 'object') return String((value as { error?: unknown; message?: unknown }).error || (value as { message?: unknown }).message || '')
  return ''
}

export default function ForcedPasswordChange() {
  const { user, t, logout } = useApp()
  const tr = (key: string, fallback: string) => {
    const value = typeof t === 'function' ? t(key) : null
    return value && value !== key ? value : fallback
  }
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const explain = (value: unknown, fallback: string): string => {
    if (resultCode(value) === PASSWORD_KNOWN_LEAKED_CODE) {
      return tr('password_known_leaked', 'This password is publicly known. Choose a different password.')
    }
    return currentPasswordRateLimitMessage(value, tr) || resultMessage(value) || fallback
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    setError('')
    if (!currentPassword) return setError(tr('current_password_required_change', 'Current password is required to change password'))
    if (newPassword.length < 6) return setError(tr('password_min_6', 'Use at least 6 characters for the new password.'))
    if (newPassword !== confirmPassword) return setError(tr('new_password_confirm_mismatch', 'New password confirmation does not match'))
    if (newPassword === currentPassword) return setError(tr('password_known_leaked', 'This password is publicly known. Choose a different password.'))
    const userId = user?.id
    if (userId === undefined || userId === null || userId === '') return
    setSaving(true)
    try {
      const result = await withLoaderTimeout(
        () => changeUserPassword(userId, { currentPassword, newPassword }),
        'Change password',
      )
      if (result && typeof result === 'object' && (result as { success?: unknown }).success === false) {
        setError(explain(result, tr('forced_password_change_failed', 'Could not change the password. Try again.')))
        return
      }
      // The Worker cleared must_change_password with the change; tell the app
      // so it leaves this screen (AppContext merges user:updated into user).
      window.dispatchEvent(new CustomEvent('user:updated', { detail: { ...(user || {}), must_change_password: 0 } }))
    } catch (changeError) {
      setError(explain(changeError, tr('forced_password_change_failed', 'Could not change the password. Try again.')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-gray-900">
      <form
        className="w-full max-w-sm space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800"
        onSubmit={(event) => { void handleSubmit(event) }}
      >
        <div className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
          <LockKeyhole className="h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300" aria-hidden="true" />
          <h1 className="min-w-0 truncate">{tr('forced_password_change_title', 'Change your password')}</h1>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {tr('forced_password_change_body', 'The password you signed in with is publicly known. Choose a new one to keep using the app.')}
        </p>
        {user?.username ? <p className="truncate text-xs text-gray-500 dark:text-gray-400">{user.username}</p> : null}
        <input type="text" name="username" autoComplete="username" value={String(user?.username || '')} readOnly hidden />
        <div>
          <label htmlFor="forced-current-password" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">{tr('current_password', 'Current password')}</label>
          <input id="forced-current-password" type="password" className="input h-10" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        </div>
        <div>
          <label htmlFor="forced-new-password" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">{tr('new_password', 'New Password')}</label>
          <input id="forced-new-password" type="password" className="input h-10" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        </div>
        <div>
          <label htmlFor="forced-confirm-password" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">{tr('confirm_new_password', 'Confirm new password')}</label>
          <input id="forced-confirm-password" type="password" className="input h-10" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        </div>
        {error ? <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</div> : null}
        <button type="submit" className="btn-primary h-10 w-full text-sm" disabled={saving}>
          {saving ? tr('saving', 'Saving...') : tr('change_password', 'Change password')}
        </button>
        <button type="button" className="w-full text-sm text-gray-600 hover:text-gray-800 dark:text-gray-300" onClick={() => { void logout() }}>
          {tr('logout', 'Logout')}
        </button>
      </form>
    </div>
  )
}
