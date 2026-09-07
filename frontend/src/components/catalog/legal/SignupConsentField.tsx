// The consent line (N45): one checkbox, one message, two policy links.
//
// It lives here rather than inside the sign-up form because it is the legal
// surface, not an account surface -- and because a second form will need the
// identical line (the customer submission form, once it is rendered again).
// One rule, one implementation.
//
// The box is NEVER pre-ticked and is `required`, so the browser blocks a
// submit on its own; the caller still re-checks, and the Worker re-checks
// again, because /api/portal/auth/signup is public and a checkbox is only a
// prompt.
import { LegalInlineLink } from './LegalPages.tsx'

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

// Mirrors of the portal_legal_* keys in legalContent.ts, so the line still
// reads correctly before the portal language pack has loaded.
export const CONSENT_LABEL_EN = 'I agree to the Terms & Conditions and the Privacy Policy.'
export const CONSENT_LABEL_KM = 'ខ្ញុំយល់ព្រមនឹងលក្ខខណ្ឌប្រើប្រាស់ និងគោលការណ៍ឯកជនភាព។'
export const CONSENT_REQUIRED_EN = 'Please agree to the Terms & Conditions and Privacy Policy to create an account.'
export const CONSENT_REQUIRED_KM = 'សូមយល់ព្រមនឹងលក្ខខណ្ឌប្រើប្រាស់ និងគោលការណ៍ឯកជនភាព ដើម្បីបង្កើតគណនី។'

export default function SignupConsentField({
  copy,
  checked,
  onChange,
  error,
  id = 'portal-consent',
}: {
  copy: CopyFn
  checked: boolean
  onChange: (next: boolean) => void
  error?: string
  id?: string
}) {
  const errorId = `${id}-error`
  return (
    <div>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-slate-600 dark:text-neutral-300">
        <input
          id={id}
          type="checkbox"
          name="consent"
          required
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-emerald-500"
        />
        <span>
          {copy('portal_legal_consent_label', CONSENT_LABEL_EN, CONSENT_LABEL_KM)}{' '}
          <LegalInlineLink page="terms" label={copy('portal_legal_consent_read_terms', 'Read the Terms & Conditions', 'អានលក្ខខណ្ឌប្រើប្រាស់')} />
          {' · '}
          <LegalInlineLink page="privacy" label={copy('portal_legal_consent_read_privacy', 'Read the Privacy Policy', 'អានគោលការណ៍ឯកជនភាព')} />
        </span>
      </label>
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-300">{error}</p>
      ) : null}
    </div>
  )
}
