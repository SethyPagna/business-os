import { useId, useState } from 'react'
import UserIcon from 'lucide-react/dist/esm/icons/user.js'
import LogOut from 'lucide-react/dist/esm/icons/log-out.js'
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag.js'
import Heart from 'lucide-react/dist/esm/icons/heart.js'
import Eye from 'lucide-react/dist/esm/icons/eye.js'
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js'
import PortalNoPaymentNotice from './PortalNoPaymentNotice.tsx'
import SignupConsentField, { CONSENT_REQUIRED_EN, CONSENT_REQUIRED_KM } from './legal/SignupConsentField.tsx'
import type { PortalAccountProfile } from './portalAccount.ts'

// The storefront Account area (§2). Replaces the old anonymous membership
// lookup: guests can still use everything, and an account only adds "permanent
// memory" for the cart + wishlist. Sign-up needs a name + a unique phone (+ an
// optional membership ID that auto-generates) + a password of the customer's
// own choosing; sign-in needs (name OR membership ID) + phone + password.

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

const PORTAL_MIN_PASSWORD_LENGTH = 6
const PASSWORD_HINT_EN = 'At least 6 characters. Use a password you do not reuse elsewhere.'
const PASSWORD_HINT_KM = 'យ៉ាងតិច ៦ តួអក្សរ។ ប្រើពាក្យសម្ងាត់ដែលអ្នកមិនប្រើឡើងវិញនៅកន្លែងផ្សេង។'
const REMINDER = 'If you have previously bought from Leang Cosmetics/Leang Beauty, please contact us for your membership ID — your phone number must match. Just a reminder.'

export default function CatalogAccountSection({
  copy,
  account,
  ready,
  busy,
  error,
  signIn,
  signUp,
  signOut,
  clearError,
  consentLocale = 'en',
  cartCount,
  wishlistCount,
}: {
  copy: CopyFn
  account: PortalAccountProfile | null
  ready: boolean
  busy: boolean
  error: string
  signIn: (payload: Record<string, unknown>) => Promise<boolean>
  signUp: (payload: Record<string, unknown>) => Promise<boolean>
  signOut: () => void
  clearError: () => void
  consentLocale?: string
  cartCount: number
  wishlistCount: number
}) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  // Sign-in fields
  const [identifier, setIdentifier] = useState('')
  const [signinPhone, setSigninPhone] = useState('')
  const [signinPassword, setSigninPassword] = useState('')
  // Sign-up fields
  const [name, setName] = useState('')
  const [signupPhone, setSignupPhone] = useState('')
  const [membershipId, setMembershipId] = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  const [consent, setConsent] = useState(false)
  const [consentError, setConsentError] = useState('')

  const switchMode = (next: 'signin' | 'signup') => {
    setMode(next)
    clearError()
  }

  const onSignIn = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!consent) {
      setConsentError(copy('portal_legal_consent_required', CONSENT_REQUIRED_EN, CONSENT_REQUIRED_KM))
      return
    }
    setConsentError('')
    await signIn({ identifier, phone: signinPhone, password: signinPassword, consent, consentLocale })
  }

  const onSignUp = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!consent) {
      setConsentError(copy('portal_legal_consent_required', CONSENT_REQUIRED_EN, CONSENT_REQUIRED_KM))
      return
    }
    setConsentError('')
    // The membership-id-empty reminder: existing customers should use their ID
    // (their phone must match), not create a fresh account.
    if (!membershipId.trim()) {
      const proceed = typeof window === 'undefined'
        ? true
        : window.confirm(copy('signupReminder', REMINDER))
      if (!proceed) return
    }
    const ok = await signUp({ name, phone: signupPhone, membershipId, password: signupPassword, consent, consentLocale })
    if (ok) {
      setName(''); setSignupPhone(''); setMembershipId(''); setSignupPassword(''); setConsent(false)
    }
  }

  return (
    // Drawer-native body: the top-bar Account drawer supplies the header/close
    // chrome, so this renders as a plain scrollable stack rather than a full
    // page SectionShell.
    <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-neutral-400">
        {copy('accountSubtitle', 'Optional — browse and build your list as a guest, or sign in to keep it across devices.', 'ជាជម្រើស — រុករក និងបង្កើតបញ្ជីជាភ្ញៀវ ឬចូលគណនីដើម្បីរក្សាទុកឆ្លងកាត់ឧបករណ៍។')}
      </p>
      <div className="space-y-4">
        {!ready ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
            {copy('accountLoading', 'Checking your account…')}
          </div>
        ) : account ? (
          <div className="rounded-[24px] border border-emerald-200 bg-white p-5 shadow-sm dark:border-emerald-400/25 dark:bg-neutral-900">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200">
                <UserIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                  {copy('signedInAs', 'Signed in as')} {account.name}
                </div>
                <div className="truncate text-xs text-slate-500 dark:text-neutral-400">
                  {copy('membershipId', 'Membership ID')}: {account.membershipId}
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-white/5 dark:text-neutral-200">
                <ShoppingBag className="h-4 w-4 text-slate-400" aria-hidden="true" />
                <span>{cartCount} {copy('inYourList', 'in your list')}</span>
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-white/5 dark:text-neutral-200">
                <Heart className="h-4 w-4 text-rose-400" />
                <span>{wishlistCount} {copy('saved', 'saved')}</span>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500 dark:text-neutral-400">
              {copy('accountMemoryHint', 'Your list and saved items are kept with your account, so they follow you across devices.')}
            </p>
            <button
              type="button"
              onClick={signOut}
              className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-white/5"
            >
              <LogOut className="h-4 w-4" />
              {copy('signOut', 'Sign out')}
            </button>
          </div>
        ) : (
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
            <div className="mb-4 inline-flex rounded-2xl bg-slate-100 p-1 text-sm dark:bg-white/5">
              <button
                type="button"
                onClick={() => switchMode('signin')}
                aria-pressed={mode === 'signin'}
                className={`rounded-xl px-4 py-1.5 font-semibold transition ${mode === 'signin' ? 'bg-white text-slate-900 shadow-sm dark:bg-neutral-800 dark:text-white' : 'text-slate-500 dark:text-neutral-400'}`}
              >
                {copy('signIn', 'Sign in')}
              </button>
              <button
                type="button"
                onClick={() => switchMode('signup')}
                aria-pressed={mode === 'signup'}
                className={`rounded-xl px-4 py-1.5 font-semibold transition ${mode === 'signup' ? 'bg-white text-slate-900 shadow-sm dark:bg-neutral-800 dark:text-white' : 'text-slate-500 dark:text-neutral-400'}`}
              >
                {copy('signUp', 'Sign up')}
              </button>
            </div>

            {error ? (
              // A sign-in failure used to be colour only: the box appeared below
              // the tabs with no announcement, so a screen-reader user pressed
              // Sign in, heard nothing, and had no idea the attempt had failed.
              <div
                role="alert"
                aria-live="assertive"
                className="mb-4 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200"
              >
                {error}
              </div>
            ) : null}

            {mode === 'signin' ? (
              <form onSubmit={onSignIn} className="space-y-3" autoComplete="on">
                <Field label={copy('nameOrMembershipId', 'Name or Membership ID')}>
                  {(fieldId, describedBy) => (
                    <input
                      id={fieldId} aria-describedby={describedBy}
                      name="username" autoComplete="username" value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      className={inputClass} required
                    />
                  )}
                </Field>
                <Field label={copy('phoneNumber', 'Phone number')}>
                  {(fieldId, describedBy) => (
                    <input
                      id={fieldId} aria-describedby={describedBy}
                      name="tel" type="tel" inputMode="tel" autoComplete="tel" value={signinPhone}
                      onChange={(e) => setSigninPhone(e.target.value)}
                      className={inputClass} required
                    />
                  )}
                </Field>
                <PasswordField
                  copy={copy}
                  label={copy('password', 'Password')}
                  autoComplete="current-password"
                  value={signinPassword}
                  onChange={setSigninPassword}
                />
                <SignupConsentField
                  copy={copy}
                  checked={consent}
                  onChange={(next) => { setConsent(next); if (next) setConsentError('') }}
                  error={consentError}
                />
                <button type="submit" disabled={busy} className={submitClass}>
                  {busy ? copy('signingIn', 'Signing in…') : copy('signIn', 'Sign in')}
                </button>
                <p className="text-xs text-slate-500 dark:text-neutral-400">
                  {copy('forgotPasswordHint', 'Forgot your password? Please contact us to reset it.')}
                </p>
              </form>
            ) : (
              <form onSubmit={onSignUp} className="space-y-3" autoComplete="on">
                <Field label={copy('yourName', 'Your name')}>
                  {(fieldId, describedBy) => (
                    <input
                      id={fieldId} aria-describedby={describedBy}
                      name="name" autoComplete="name" value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={inputClass} required
                    />
                  )}
                </Field>
                <Field label={copy('phoneNumber', 'Phone number')}>
                  {(fieldId, describedBy) => (
                    <input
                      id={fieldId} aria-describedby={describedBy}
                      name="tel" type="tel" inputMode="tel" autoComplete="tel" value={signupPhone}
                      onChange={(e) => setSignupPhone(e.target.value)}
                      className={inputClass} required
                    />
                  )}
                </Field>
                <Field label={copy('membershipIdOptional', 'Membership ID (optional)')} hint={copy('membershipIdHint', 'Leave blank and we will create one for you.')}>
                  {(fieldId, describedBy) => (
                    <input
                      id={fieldId} aria-describedby={describedBy}
                      name="membership_id" autoComplete="off" value={membershipId}
                      onChange={(e) => setMembershipId(e.target.value)}
                      className={inputClass}
                    />
                  )}
                </Field>
                <PasswordField
                  copy={copy}
                  label={copy('createPassword', 'Create a password')}
                  autoComplete="new-password"
                  minLength={PORTAL_MIN_PASSWORD_LENGTH}
                  value={signupPassword}
                  onChange={setSignupPassword}
                />
                <p className="text-xs leading-relaxed text-slate-500 dark:text-neutral-400">
                  {copy('signupPasswordHint', PASSWORD_HINT_EN, PASSWORD_HINT_KM)}
                </p>
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:bg-amber-400/10 dark:text-amber-200">
                  {copy('signupReminder', REMINDER)}
                </p>
                <SignupConsentField
                  copy={copy}
                  checked={consent}
                  onChange={(next) => { setConsent(next); if (next) setConsentError('') }}
                  error={consentError}
                />
                <button type="submit" disabled={busy} className={submitClass}>
                  {busy ? copy('creatingAccount', 'Creating account…') : copy('createAccount', 'Create account')}
                </button>
              </form>
            )}
          </div>
        )}

        <PortalNoPaymentNotice copy={copy} variant="short" />
      </div>
    </div>
  )
}

// `outline-none` with `focus:border-emerald-400` as its only replacement is
// not a focus indicator: emerald-400 on the slate-50 field is 1.75:1, well
// under the 3:1 WCAG 1.4.11 floor, and a keyboard shopper filling this form
// cannot see where they are. The portal stylesheet's :focus-visible ring
// cannot rescue it either -- the account drawer renders as a SIBLING of
// <CatalogPreviewSurface> inside PublicCatalogPage, so it depends on the
// live-route root being in that rule's selector list, which is a coupling the
// storefront's only real form should not have. It paints its own ring, with
// the same 3px sky-700 / amber-300 as the stylesheet.
const inputClass = 'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#0369a1] dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus-visible:outline-[#fcd34d]'
const submitClass = 'inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60'

// A wrapping <label> names its input, but it cannot name anything else: the
// membership-ID hint sat outside the accessible name and outside any
// description, so a reader announced the field with no mention of "leave it
// blank and we will create one". An explicit for/id pair plus an
// aria-describedby hint fixes both, and gives every field a stable id an
// error message can point at.
function Field({ label, hint, children }: {
  label: string
  hint?: string
  children: (fieldId: string, describedBy: string | undefined) => React.ReactNode
}) {
  const fieldId = useId()
  const describedBy = hint ? `${fieldId}-hint` : undefined
  return (
    <div className="block">
      <label htmlFor={fieldId} className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-neutral-400">{label}</label>
      {children(fieldId, describedBy)}
      {hint ? <div id={`${fieldId}-hint`} className="mt-1 text-[11px] text-slate-500 dark:text-neutral-400">{hint}</div> : null}
    </div>
  )
}

// One password field for both forms, with the reveal control the storefront
// never had. Typing a password blind on a phone keypad is a common reason a
// sign-up is abandoned, and a reader has to be told whether the characters
// are currently showing -- hence aria-pressed rather than a label that
// silently swaps underneath.
function PasswordField({ copy, label, autoComplete, value, onChange, minLength }: {
  copy: CopyFn
  label: string
  autoComplete: string
  value: string
  onChange: (next: string) => void
  minLength?: number
}) {
  const [visible, setVisible] = useState(false)
  return (
    <Field label={label}>
      {(fieldId, describedBy) => (
        <div className="relative">
          <input
            id={fieldId} aria-describedby={describedBy}
            type={visible ? 'text' : 'password'}
            autoComplete={autoComplete} value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`${inputClass} pr-12`} required minLength={minLength}
          />
          <button
            type="button"
            onClick={() => setVisible((previous) => !previous)}
            aria-pressed={visible}
            aria-controls={fieldId}
            aria-label={visible
              ? copy('portal_a11y_hide_password', 'Hide password', 'លាក់ពាក្យសម្ងាត់')
              : copy('portal_a11y_show_password', 'Show password', 'បង្ហាញពាក្យសម្ងាត់')}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-2xl text-slate-500 transition hover:text-slate-800 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      )}
    </Field>
  )
}
