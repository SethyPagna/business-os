import type { ReactNode } from 'react'
import { useState } from 'react'
import Copy from 'lucide-react/dist/esm/icons/copy.js'
import Eye from 'lucide-react/dist/esm/icons/eye.js'
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js'
import Wand from 'lucide-react/dist/esm/icons/wand.js'
import { copyPasswordToClipboard } from '../../../utils/passwordManager.ts'
import { passwordStrength, suggestPassword, type PasswordIdentity, type PasswordStrength } from '../../../utils/passwordSuggest.ts'

type Translate = (key: string, fallback: string) => string

// 'self': the signed-in person's own new password, so password managers offer
// to save it. 'other-user': an administrator setting someone else's password,
// which must never land in the administrator's own vault.
export type NewPasswordFieldsMode = 'self' | 'other-user'

type NewPasswordFieldsProps = {
  tr: Translate
  idPrefix: string
  password: string
  confirm: string
  onPasswordChange: (value: string) => void
  onConfirmChange: (value: string) => void
  mode?: NewPasswordFieldsMode
  identity?: PasswordIdentity
  disabled?: boolean
  inputClassName?: string
  // 'columns': new and confirm side by side from the sm breakpoint.
  layout?: 'stack' | 'columns'
}

// Guides Safari's own generator; the app's rule is utils/passwordRules.ts.
const SAFARI_PASSWORD_RULES: Record<string, string> = {
  passwordrules: 'minlength: 12; maxlength: 64; required: lower; required: upper; required: digit;',
}
const OWN_PASSWORD_INPUT: Record<string, string> = { autoComplete: 'new-password', ...SAFARI_PASSWORD_RULES }
// Chrome offers to save, or to UPDATE the administrator's own login, for any
// type=password field whatever its autocomplete or ignore attributes.
const OTHER_USER_INPUT: Record<string, string | boolean> = {
  autoComplete: 'off',
  autoCapitalize: 'off',
  autoCorrect: 'off',
  spellCheck: false,
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
  'data-bwignore': 'true',
}
const MASKED_TEXT_CLASS = '[-webkit-text-security:disc]'

const STRENGTH_STEPS: Record<PasswordStrength, number> = { weak: 1, fair: 2, strong: 3 }
const STRENGTH_COLOR: Record<PasswordStrength, string> = {
  weak: 'bg-red-500',
  fair: 'bg-amber-500',
  strong: 'bg-emerald-500',
}

function IconButton({ label, onClick, disabled, pressed, children }: {
  label: string
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-slate-700 dark:hover:text-gray-100"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export default function NewPasswordFields({
  tr,
  idPrefix,
  password,
  confirm,
  onPasswordChange,
  onConfirmChange,
  mode = 'self',
  identity,
  disabled = false,
  inputClassName = 'input h-10 text-sm',
  layout = 'stack',
}: NewPasswordFieldsProps) {
  const [revealed, setRevealed] = useState(false)
  const [copyNotice, setCopyNotice] = useState('')
  const otherUser = mode === 'other-user'
  const inputAttributes = otherUser ? OTHER_USER_INPUT : OWN_PASSWORD_INPUT
  const inputType = otherUser ? 'text' : 'password'
  const inputClass = otherUser ? `${inputClassName} ${MASKED_TEXT_CLASS}` : inputClassName
  const strength = password ? passwordStrength(password, identity) : null
  const strengthLabel: Record<PasswordStrength, string> = {
    weak: tr('password_strength_weak', 'Weak'),
    fair: tr('password_strength_fair', 'Fair'),
    strong: tr('password_strength_strong', 'Strong'),
  }
  const columns = layout === 'columns'
  const revealLabel = revealed ? tr('hide_password', 'Hide password') : tr('show_password', 'Show password')

  const suggest = () => {
    const suggestion = suggestPassword()
    onPasswordChange(suggestion)
    onConfirmChange(suggestion)
    setRevealed(true)
    setCopyNotice('')
  }

  const copy = async () => {
    const copied = await copyPasswordToClipboard(password)
    setCopyNotice(copied
      ? tr('new_password_copied', 'New password copied to clipboard.')
      : tr('new_password_copy_failed', 'Could not copy automatically. Select the new password field and copy it before leaving.'))
  }

  return (
    <div className={columns ? 'grid gap-2 sm:grid-cols-2' : 'space-y-2'}>
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <label htmlFor={`${idPrefix}-new`} className="min-w-0 truncate text-xs font-medium text-gray-700 dark:text-gray-300">
            {tr('new_password', 'New password')}
          </label>
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton label={tr('password_suggest', 'Suggest a strong password')} onClick={suggest} disabled={disabled}>
              <Wand className="h-4 w-4" aria-hidden="true" />
            </IconButton>
            <IconButton label={revealLabel} onClick={() => setRevealed((value) => !value)} pressed={revealed}>
              {revealed ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </IconButton>
            <IconButton label={tr('copy_new_password', 'Copy new password')} onClick={() => { void copy() }} disabled={!password}>
              <Copy className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </div>
        </div>
        <input
          id={`${idPrefix}-new`}
          name="new_password"
          type={inputType}
          className={inputClass}
          value={password}
          onChange={(event) => { onPasswordChange(event.target.value); setCopyNotice('') }}
          disabled={disabled}
          {...inputAttributes}
        />
        {revealed && password ? (
          <div className="mt-1 select-all break-all rounded-md bg-gray-50 px-2 py-1 font-mono text-xs text-gray-800 dark:bg-slate-900 dark:text-gray-100">
            {password}
          </div>
        ) : null}
        <div className="mt-1 flex items-center gap-2" aria-live="polite">
          <div className="grid flex-1 grid-cols-3 gap-1" aria-hidden="true">
            {[1, 2, 3].map((step) => (
              <span
                key={step}
                className={`h-1 rounded-full ${strength && STRENGTH_STEPS[strength] >= step ? STRENGTH_COLOR[strength] : 'bg-gray-200 dark:bg-slate-700'}`}
              />
            ))}
          </div>
          <span className="shrink-0 text-[11px] text-gray-500 dark:text-gray-400">
            {tr('password_strength_label', 'Strength')}: {strength ? strengthLabel[strength] : '-'}
          </span>
        </div>
      </div>
      <div>
        {/* In columns the confirm label is as tall as the icon row, so both inputs line up. */}
        <label htmlFor={`${idPrefix}-confirm`} className={`mb-1 block truncate text-xs font-medium text-gray-700 dark:text-gray-300${columns ? ' sm:h-7 sm:leading-7' : ''}`}>
          {tr('confirm_new_password', 'Confirm new password')}
        </label>
        <input
          id={`${idPrefix}-confirm`}
          name="confirm_password"
          type={inputType}
          className={inputClass}
          value={confirm}
          onChange={(event) => onConfirmChange(event.target.value)}
          disabled={disabled}
          {...inputAttributes}
        />
      </div>
      {copyNotice ? <p className={`text-xs text-gray-600 dark:text-gray-300${columns ? ' sm:col-span-2' : ''}`} role="status">{copyNotice}</p> : null}
    </div>
  )
}
