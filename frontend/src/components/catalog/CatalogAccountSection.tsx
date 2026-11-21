import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import LogOut from 'lucide-react/dist/esm/icons/log-out.js'
import Eye from 'lucide-react/dist/esm/icons/eye.js'
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js'
import SignupConsentField, { AGE_CONFIRMATION_REQUIRED_CODE, consentRequiredMessage, signupConsentFields } from './legal/SignupConsentField.tsx'
import { PortalContactRows } from './PortalSocialRow.tsx'
import { PORTAL_PRIMARY_BUTTON } from './portalButtons.ts'
import { PORTAL_SHEET_CORNER_PAD } from './PortalSheet.tsx'
import type { PortalContactEntry } from './portalSocialLinks.ts'
import type { PortalAccountProfile } from './portalAccount.ts'

// The storefront Account sheet (§2). Guests can use everything; an account only adds "permanent memory" for the cart + wishlist. Sign-up needs a
// name + a unique phone (+ an optional membership ID that auto-generates) + a password of the customer's own choosing; sign-in needs (name OR
// membership ID) + phone + password. The sheet (PortalSheet) supplies the close button; this renders labels and fields, not sentences.

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

const PORTAL_MIN_PASSWORD_LENGTH = 10

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
  signupEnabled = false,
  errorCode = '',
  contactEntries = [],
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
  /**
   * Owner switch customer_portal_signup_enabled. Sign-up is OFF unless the
   * server said exactly true (owner ruling 6 Oct), so a missing answer (first
   * paint, a failed bootstrap) shows the paused state, never a dead Sign up tab.
   */
  signupEnabled?: boolean
  /** The Worker's refusal code for `error` (usePortalAccount errorCode). */
  errorCode?: string
  /** The chat entries (Phone, Messenger, Telegram, WhatsApp) shown under the "Forgot password?" line. None: the line alone tells the shopper to ask the shop. */
  contactEntries?: readonly PortalContactEntry[]
}) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  // The server is the authority: a sign-up it refused as paused is paused for the rest of the visit, whatever the config said.
  const signupOpen = signupEnabled && errorCode !== 'portal_signup_paused'
  const showSignupForm = mode === 'signup' && signupOpen
  const errorText = errorCode === 'portal_signup_paused' ? '' : errorCode === AGE_CONFIRMATION_REQUIRED_CODE ? consentRequiredMessage(copy, 'signup') : error
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
      setConsentError(consentRequiredMessage(copy, 'signin'))
      return
    }
    setConsentError('')
    await signIn({ identifier, phone: signinPhone, password: signinPassword, ...signupConsentFields(consent, consentLocale) })
  }

  const onSignUp = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!consent) {
      setConsentError(consentRequiredMessage(copy, 'signup'))
      return
    }
    setConsentError('')
    const ok = await signUp({ name, phone: signupPhone, membershipId, password: signupPassword, ...signupConsentFields(consent, consentLocale) })
    if (ok) {
      setName(''); setSignupPhone(''); setMembershipId(''); setSignupPassword(''); setConsent(false)
    }
  }

  if (!ready) {
    return (
      <p className={`${PORTAL_SHEET_CORNER_PAD} flex items-center text-sm text-stone-600 dark:text-neutral-300`}>
        {copy('accountLoading', 'Checking your account…')}
      </p>
    )
  }

  if (account) {
    return (
      <div className="space-y-4">
        <dl data-portal-account-summary="true" className="divide-y divide-stone-200 text-sm dark:divide-neutral-700">
          <SummaryRow first label={copy('accountNameLabel', 'Name', 'ឈ្មោះ')} value={<span translate="no" className="notranslate">{account.name}</span>} />
          <SummaryRow label={copy('membershipId', 'Membership ID')} value={<span translate="no" className="notranslate">{account.membershipId}</span>} />
          {/* Owner, 30 Sep 2026: points are coming soon, so this row never takes a number. */}
          <SummaryRow
            label={copy('membershipPoints', 'Points', 'ពិន្ទុ')}
            rowAttribute="data-portal-points-row"
            value={<span data-portal-points-value="true">{copy('membershipPointsComingSoon', 'Coming soon', 'នឹងមកដល់ឆាប់ៗនេះ')}</span>}
          />
          <SummaryRow label={copy('inList', 'In list', 'ក្នុងបញ្ជី')} value={cartCount} />
          <SummaryRow label={copy('saved', 'Saved')} value={wishlistCount} />
        </dl>
        <button
          type="button"
          onClick={signOut}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 text-sm font-semibold text-[#23201b] transition hover:bg-stone-100 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          <LogOut className="h-4 w-4" />
          {copy('signOut', 'Sign out')}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* The first thing in the sheet: the Sign in / Sign up switch. With sign-up off there is no Sign up side at all: one muted line takes its place. */}
      <div className={`${PORTAL_SHEET_CORNER_PAD} flex items-center`}>
        {signupOpen ? (
          <div role="group" className="inline-flex rounded-xl bg-stone-100 p-1 text-sm dark:bg-neutral-800">
            {(['signin', 'signup'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => switchMode(value)}
                aria-pressed={mode === value}
                className={`min-h-9 rounded-lg px-4 font-semibold transition ${mode === value ? 'bg-white text-[#23201b] shadow-sm dark:bg-neutral-700 dark:text-white' : 'text-stone-600 dark:text-neutral-300'}`}
              >
                {value === 'signin' ? copy('signIn', 'Sign in') : copy('signUp', 'Sign up')}
              </button>
            ))}
          </div>
        ) : (
          <p data-portal-signup-paused="true" role={errorCode === 'portal_signup_paused' ? 'alert' : undefined} className="text-sm text-stone-600 dark:text-neutral-300">
            {copy('signupPausedLine', 'Sign-up is paused.', 'ការចុះឈ្មោះត្រូវបានផ្អាក។')}
          </p>
        )}
      </div>

      {errorText ? (
        // A sign-in failure used to be colour only: the box appeared with no announcement, so a screen-reader user pressed Sign in, heard
        // nothing, and had no idea the attempt had failed.
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200"
        >
          {errorText}
        </div>
      ) : null}

      {!showSignupForm ? (
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
          {/* Forgot password: one short line and, when the shop has chat channels, the rows themselves (no button to open first). */}
          <div data-portal-forgot-password="" className="space-y-2">
            <p data-portal-forgot-password-hint="" className="text-sm text-stone-600 dark:text-neutral-300">
              {copy('forgotPasswordAskShop', 'Forgot your password? Ask the shop to reset it.', 'ភ្លេចពាក្យសម្ងាត់? សូមសុំហាងកំណត់ថ្មី។')}
            </p>
            <PortalContactRows inline entries={contactEntries} copy={copy} className="space-y-2" />
          </div>
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
          <Field label={copy('membershipIdOptional', 'Membership ID (optional)')} hint={copy('signupMemberAsk', 'Bought from us before? Ask us for your membership ID.', 'ធ្លាប់ទិញពីយើងហើយឬ? សូមសុំលេខសមាជិកពីយើង។')}>
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
            hint={copy('signupPasswordHint', '10 characters or more.', '១០ តួអក្សរឡើងទៅ។')}
            value={signupPassword}
            onChange={setSignupPassword}
          />
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
  )
}

function SummaryRow({ label, value, first = false, rowAttribute }: { label: string; value: ReactNode; first?: boolean; rowAttribute?: string }) {
  const marker = rowAttribute ? { [rowAttribute]: 'true' } : {}
  return (
    <div {...marker} className={`flex items-baseline justify-between gap-4 py-2.5 ${first ? PORTAL_SHEET_CORNER_PAD : ''}`}>
      <dt className="shrink-0 text-stone-600 dark:text-neutral-300">{label}</dt>
      <dd className="detail-scroll-text min-w-0 text-right font-medium text-[#23201b] dark:text-neutral-100">{value}</dd>
    </div>
  )
}

// A field is the spec section 1 recipe: white, a stone-500 line (stone-400 is only 2.5:1 on white; portalContrast.ts PORTAL_FIELD_LINE_LIGHT),
// ink text. `outline-none` with a border swap alone is not a focus indicator, and the sheet is portalled outside any root the stylesheet's
// :focus-visible rule names, so the input paints its own 3px ring (sky-700 / amber-300, the same as the stylesheet).
const inputClass = 'w-full rounded-xl border border-stone-500 bg-white px-4 py-2.5 text-sm text-[#23201b] placeholder:text-stone-500 outline-none transition focus-visible:border-[#7a5c22] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#0369a1] dark:border-neutral-500 dark:bg-neutral-900 dark:text-neutral-100 dark:focus-visible:outline-[#fcd34d]'
const submitClass = `${PORTAL_PRIMARY_BUTTON} w-full rounded-xl py-2.5 disabled:opacity-60`

// A wrapping <label> names its input, but it cannot name anything else: a hint sat outside the accessible name and outside any description, so a
// reader announced the field with no mention of it. An explicit for/id pair plus an aria-describedby hint fixes both, and gives every field a
// stable id an error message can point at.
function Field({ label, hint, children }: {
  label: string
  hint?: string
  children: (fieldId: string, describedBy: string | undefined) => React.ReactNode
}) {
  const fieldId = useId()
  const describedBy = hint ? `${fieldId}-hint` : undefined
  return (
    <div className="block">
      <label htmlFor={fieldId} className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-600 dark:text-neutral-300">{label}</label>
      {children(fieldId, describedBy)}
      {hint ? <div id={`${fieldId}-hint`} className="mt-1 text-xs text-stone-600 dark:text-neutral-300">{hint}</div> : null}
    </div>
  )
}

// One password field for both forms, with the reveal control the storefront never had. Typing a password blind on a phone keypad is a common
// reason a sign-up is abandoned, and a reader has to be told whether the characters are currently showing -- hence aria-pressed rather than a
// label that silently swaps underneath.
function PasswordField({ copy, label, autoComplete, value, onChange, minLength, hint }: {
  copy: CopyFn
  label: string
  autoComplete: string
  value: string
  onChange: (next: string) => void
  minLength?: number
  hint?: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <Field label={label} hint={hint}>
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
            title={visible
              ? copy('portal_a11y_hide_password', 'Hide password', 'លាក់ពាក្យសម្ងាត់')
              : copy('portal_a11y_show_password', 'Show password', 'បង្ហាញពាក្យសម្ងាត់')}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-stone-600 transition hover:text-[#23201b] dark:text-neutral-300 dark:hover:text-neutral-100"
          >
            {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      )}
    </Field>
  )
}
