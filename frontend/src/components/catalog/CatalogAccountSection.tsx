import { useState } from 'react'
import UserIcon from 'lucide-react/dist/esm/icons/user.js'
import LogOut from 'lucide-react/dist/esm/icons/log-out.js'
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag.js'
import Heart from 'lucide-react/dist/esm/icons/heart.js'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.js'
import { SectionShell } from './catalogUi'
import PortalNoPaymentNotice from './PortalNoPaymentNotice.tsx'
import type { PortalAccountProfile } from './portalAccount.ts'

// The storefront Account area (§2). Replaces the old anonymous membership
// lookup: guests can still use everything, and an account only adds "permanent
// memory" for the cart + wishlist. Sign-up needs a name + a unique phone (+ an
// optional membership ID that auto-generates) + a password of the customer's
// own choosing; sign-in needs (name OR membership ID) + phone + password.

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

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

  const switchMode = (next: 'signin' | 'signup') => {
    setMode(next)
    clearError()
  }

  const onSignIn = async (event: React.FormEvent) => {
    event.preventDefault()
    await signIn({ identifier, phone: signinPhone, password: signinPassword })
  }

  const onSignUp = async (event: React.FormEvent) => {
    event.preventDefault()
    // The membership-id-empty reminder: existing customers should use their ID
    // (their phone must match), not create a fresh account.
    if (!membershipId.trim()) {
      const proceed = typeof window === 'undefined'
        ? true
        : window.confirm(copy('signupReminder', REMINDER))
      if (!proceed) return
    }
    const ok = await signUp({ name, phone: signupPhone, membershipId, password: signupPassword })
    if (ok) {
      setName(''); setSignupPhone(''); setMembershipId(''); setSignupPassword('')
    }
  }

  return (
    <SectionShell
      title={copy('account', 'Account')}
      subtitle={copy('accountSubtitle', 'Optional — browse and build your list as a guest, or sign in to keep it across devices.')}
    >
      <div className="space-y-4">
        {/* Membership lookup is off — the privacy notice sits at the top so the
            reason the old lookup is gone is always visible here. */}
        <div className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] leading-relaxed text-slate-600 dark:border-neutral-700 dark:bg-white/5 dark:text-neutral-300">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500 dark:text-emerald-300" />
          <span>{copy('membershipDisabledMessage', 'This feature is not built into the account structure for privacy and security purposes.')}</span>
        </div>

        {!ready ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-500">
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
                <ShoppingBag className="h-4 w-4 text-slate-400" />
                <span>{cartCount} {copy('inYourList', 'in your list')}</span>
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-white/5 dark:text-neutral-200">
                <Heart className="h-4 w-4 text-rose-400" />
                <span>{wishlistCount} {copy('saved', 'saved')}</span>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-400 dark:text-neutral-500">
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
                className={`rounded-xl px-4 py-1.5 font-semibold transition ${mode === 'signin' ? 'bg-white text-slate-900 shadow-sm dark:bg-neutral-800 dark:text-white' : 'text-slate-500 dark:text-neutral-400'}`}
              >
                {copy('signIn', 'Sign in')}
              </button>
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className={`rounded-xl px-4 py-1.5 font-semibold transition ${mode === 'signup' ? 'bg-white text-slate-900 shadow-sm dark:bg-neutral-800 dark:text-white' : 'text-slate-500 dark:text-neutral-400'}`}
              >
                {copy('signUp', 'Sign up')}
              </button>
            </div>

            {error ? (
              <div className="mb-4 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200">
                {error}
              </div>
            ) : null}

            {mode === 'signin' ? (
              <form onSubmit={onSignIn} className="space-y-3" autoComplete="on">
                <Field label={copy('nameOrMembershipId', 'Name or Membership ID')}>
                  <input
                    name="username" autoComplete="username" value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className={inputClass} required
                  />
                </Field>
                <Field label={copy('phoneNumber', 'Phone number')}>
                  <input
                    name="tel" type="tel" autoComplete="tel" value={signinPhone}
                    onChange={(e) => setSigninPhone(e.target.value)}
                    className={inputClass} required
                  />
                </Field>
                <Field label={copy('password', 'Password')}>
                  <input
                    type="password" autoComplete="current-password" value={signinPassword}
                    onChange={(e) => setSigninPassword(e.target.value)}
                    className={inputClass} required
                  />
                </Field>
                <button type="submit" disabled={busy} className={submitClass}>
                  {busy ? copy('signingIn', 'Signing in…') : copy('signIn', 'Sign in')}
                </button>
                <p className="text-xs text-slate-400 dark:text-neutral-500">
                  {copy('forgotPasswordHint', 'Forgot your password? Please contact us to reset it.')}
                </p>
              </form>
            ) : (
              <form onSubmit={onSignUp} className="space-y-3" autoComplete="on">
                <Field label={copy('yourName', 'Your name')}>
                  <input
                    name="name" autoComplete="name" value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={inputClass} required
                  />
                </Field>
                <Field label={copy('phoneNumber', 'Phone number')}>
                  <input
                    name="tel" type="tel" autoComplete="tel" value={signupPhone}
                    onChange={(e) => setSignupPhone(e.target.value)}
                    className={inputClass} required
                  />
                </Field>
                <Field label={copy('membershipIdOptional', 'Membership ID (optional)')} hint={copy('membershipIdHint', 'Leave blank and we will create one for you.')}>
                  <input
                    name="membership_id" autoComplete="off" value={membershipId}
                    onChange={(e) => setMembershipId(e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label={copy('createPassword', 'Create a password')}>
                  <input
                    type="password" autoComplete="new-password" value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    className={inputClass} required minLength={6}
                  />
                </Field>
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:bg-amber-400/10 dark:text-amber-200">
                  {copy('signupReminder', REMINDER)}
                </p>
                <button type="submit" disabled={busy} className={submitClass}>
                  {busy ? copy('creatingAccount', 'Creating account…') : copy('createAccount', 'Create account')}
                </button>
              </form>
            )}
          </div>
        )}

        <PortalNoPaymentNotice copy={copy} variant="short" />
      </div>
    </SectionShell>
  )
}

const inputClass = 'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:bg-white dark:border-white/10 dark:bg-white/5 dark:text-white'
const submitClass = 'inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:opacity-60'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-neutral-400">{label}</div>
      {children}
      {hint ? <div className="mt-1 text-[11px] text-slate-400 dark:text-neutral-500">{hint}</div> : null}
    </label>
  )
}
