// Re-consent prompt (owner, 20 Oct 2026): an account created before the age-16
// wording asks once for the same combined tick the sign-up form uses.
//
// "No trapping forced flows": the prompt always has a way through (Agree), a
// way out (Sign out) and a way to keep browsing as a guest (Close). Browsing
// never waits on it; only the account features do.
import { useState } from 'react'
import Check from 'lucide-react/dist/esm/icons/check.js'
import LogOut from 'lucide-react/dist/esm/icons/log-out.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import SignupConsentField, { signupConsentFields } from './SignupConsentField.tsx'

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

export default function ConsentRenewalPrompt({
  copy,
  busy,
  error,
  consentLocale,
  onAgree,
  onSignOut,
  onClose,
}: {
  copy: CopyFn
  busy: boolean
  error: string
  consentLocale: string
  onAgree: (payload: Record<string, unknown>) => Promise<boolean>
  onSignOut: () => void
  onClose: () => void
}) {
  const [checked, setChecked] = useState(false)
  const [missing, setMissing] = useState('')

  const agree = async () => {
    if (!checked) {
      setMissing(copy('portal_legal_renew_required', 'Please tick the box to continue.', 'សូមធីកប្រអប់ដើម្បីបន្ត។'))
      return
    }
    setMissing('')
    await onAgree(signupConsentFields(true, consentLocale))
  }

  const iconButton = 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-100'
  const title = copy('portal_legal_renew_title', 'Confirm to keep using your account', 'បញ្ជាក់ដើម្បីបន្តប្រើគណនីរបស់អ្នក')
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 backdrop-blur-sm sm:items-center">
      <div
        className="w-full max-w-md overflow-hidden rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl dark:bg-neutral-900 sm:rounded-3xl sm:pb-0"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-portal-consent-renewal="true"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-neutral-800">
          <div className="text-sm font-semibold leading-6 text-slate-900 dark:text-neutral-100">{title}</div>
          <div className="flex items-center gap-1">
            <button type="button" className={iconButton} onClick={onSignOut} aria-label={copy('signOut', 'Sign out')} title={copy('signOut', 'Sign out')}>
              <LogOut className="h-5 w-5" />
            </button>
            <button type="button" className={iconButton} onClick={onClose} aria-label={copy('close', 'Close')} title={copy('close', 'Close')}>
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className="text-xs leading-6 text-slate-600 dark:text-neutral-300">
            {copy('portal_legal_renew_body', 'Our terms now set a minimum age of 16. Please confirm to keep using your account.', 'លក្ខខណ្ឌរបស់យើងកំណត់អាយុអប្បបរមា ១៦ ឆ្នាំ។ សូមបញ្ជាក់ដើម្បីបន្តប្រើគណនីរបស់អ្នក។')}
          </p>
          <SignupConsentField copy={copy} checked={checked} onChange={(next) => { setChecked(next); if (next) setMissing('') }} error={missing || error} id="portal-consent-renewal" />
          <button
            type="button"
            onClick={agree}
            disabled={busy}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-slate-900"
          >
            <Check className="h-4 w-4" />
            {copy('portal_legal_renew_agree', 'Agree', 'យល់ព្រម')}
          </button>
        </div>
      </div>
    </div>
  )
}
