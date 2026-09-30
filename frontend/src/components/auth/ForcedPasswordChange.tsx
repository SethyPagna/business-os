import type { FormEvent } from 'react'
import { useState } from 'react'
import LockKeyhole from 'lucide-react/dist/esm/icons/lock-keyhole.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { changeUserPassword } from '../../api/userAdminTransport.ts'
import { withLoaderTimeout } from '../../utils/loaders.ts'
import { requestPasswordSave } from '../../utils/passwordManager.ts'
import { newPasswordProblem, passwordProblemMessage } from '../../utils/passwordRules.ts'
import NewPasswordFields from './password/NewPasswordFields.tsx'
import { passwordChangeFailureMessage } from './password/ownPasswordChange.ts'
import { requestPasswordRecoveryAfterSignOut } from './passwordRecoveryHandoff.ts'

// S-auth4b: shown instead of the app while the signed-in account is marked
// must_change_password -- it signed in with a password that is publicly known
// (it sits in this project's public git history). The Worker refuses every
// other request with 403 password_change_required until the password is
// changed (cloudflare/src/lib/auth.ts requireAuth), so this screen is the
// only thing that can work.
//
// Owner requirement (27 Sep 2026): never a closed loop. Old -> new is the
// main way; a wrong current password is an error here, never a sign-out; and
// there are two ways out: the reset-method chooser (signs out, then the
// sign-in screen opens the chooser for this account) and a plain Sign out
// (the Worker lets the sign-out probe through for exactly this).
//
// The server is the authority on what is allowed, including which passwords
// are publicly known; the check below only saves a round trip with the shared
// new-password rule (utils/passwordRules.ts). No password rule of its own.
//
// On success the browser is asked to UPDATE the saved password before the app
// leaves this screen: the one it holds is the publicly known one.

type ForcedPasswordUser = { id?: number | string; username?: string; name?: string } | null
type ForcedPasswordAppContext = {
  user: ForcedPasswordUser
  t: (key: string) => string
  logout: () => Promise<void>
}
const useApp = useAppHook as () => ForcedPasswordAppContext

type Translate = (key: string, fallback: string) => string
type ForcedPasswordChangeInput = {
  user: ForcedPasswordUser
  currentPassword: string
  newPassword: string
  confirmPassword: string
  tr: Translate
}

function inputError({ currentPassword, newPassword, confirmPassword, tr }: ForcedPasswordChangeInput): string {
  if (!currentPassword) return tr('current_password_required_change', 'Current password is required to change password')
  const problem = newPasswordProblem(newPassword)
  if (problem) return passwordProblemMessage(problem, tr)
  if (newPassword !== confirmPassword) return tr('new_password_confirm_mismatch', 'New password confirmation does not match')
  return ''
}

// Resolves to the error to show, or '' once the password is changed and the
// app has been told to leave this screen.
export async function changeForcedPassword(input: ForcedPasswordChangeInput): Promise<string> {
  const refused = inputError(input)
  if (refused) return refused
  const { user, currentPassword, newPassword, tr } = input
  const userId = user?.id
  if (userId === undefined || userId === null || userId === '') return ''
  try {
    const result = await withLoaderTimeout(
      () => changeUserPassword(userId, { currentPassword, newPassword }),
      'Change password',
    )
    if (result && typeof result === 'object' && (result as { success?: unknown }).success === false) return passwordChangeFailureMessage(result, tr)
  } catch (changeError) {
    return passwordChangeFailureMessage(changeError, tr)
  }
  await requestPasswordSave({ username: String(user?.username || ''), password: newPassword, displayName: user?.name })
  // The Worker cleared must_change_password with the change; tell the app
  // so it leaves this screen (AppContext merges user:updated into user).
  window.dispatchEvent(new CustomEvent('user:updated', { detail: { ...(user || {}), must_change_password: 0 } }))
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

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    setError('')
    setSaving(true)
    try {
      setError(await changeForcedPassword({ user, currentPassword, newPassword, confirmPassword, tr }))
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
        <input type="text" name="username" autoComplete="username" value={String(user?.username || '')} readOnly className="sr-only" tabIndex={-1} aria-hidden="true" />
        <div>
          <label htmlFor="forced-current-password" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">{tr('current_password', 'Current password')}</label>
          <input id="forced-current-password" name="current_password" type="password" className="input h-10" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        </div>
        <NewPasswordFields
          tr={tr}
          idPrefix="forced-password"
          password={newPassword}
          confirm={confirmPassword}
          onPasswordChange={setNewPassword}
          onConfirmChange={setConfirmPassword}
          identity={{ username: user?.username, name: user?.name }}
          disabled={saving}
        />
        {error ? <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</div> : null}
        <button type="submit" className="btn-primary h-10 w-full text-sm" disabled={saving}>
          {saving ? tr('saving', 'Saving...') : tr('change_password', 'Change password')}
        </button>
        <button
          type="button"
          className="w-full text-sm font-medium text-primary-700 hover:text-primary-800 dark:text-primary-300"
          onClick={() => {
            requestPasswordRecoveryAfterSignOut(String(user?.username || ''))
            void logout()
          }}
        >
          {tr('forced_password_change_forgot', 'Forgot your current password? Reset it another way')}
        </button>
        <button type="button" className="w-full text-sm text-gray-600 hover:text-gray-800 dark:text-gray-300" onClick={() => { void logout() }}>
          {tr('forced_password_change_sign_out', 'Sign out')}
        </button>
      </form>
    </div>
  )
}
