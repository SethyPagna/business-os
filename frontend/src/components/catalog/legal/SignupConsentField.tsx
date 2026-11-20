// The consent line (N45): one checkbox, one line, the two policy names as links.
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
import type { ReactNode } from 'react'
import { LegalInlineLink } from './LegalPages.tsx'
import { LEGAL_PAGE_TITLE_KEY, legalText } from './legalContent.ts'

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

// The line the visitor reads. {terms} and {privacy} become the two links, so the Khmer order of the words is the Khmer line's own.
export const CONSENT_LINE_EN = 'I am 16 or older and accept the {terms} and {privacy}.'
export const CONSENT_LINE_KM = 'ខ្ញុំមានអាយុ ១៦ ឆ្នាំឡើងទៅ ហើយទទួលយក{terms} និង{privacy}។'
// Mirrors of the portal_legal_* keys in legalContent.ts, so a refusal still reads correctly before the portal language pack has loaded.
export const CONSENT_REQUIRED_EN = 'Please confirm you are 16 or older and agree to the Terms & Conditions and Privacy Policy to create an account.'
export const CONSENT_REQUIRED_KM = 'សូមបញ្ជាក់ថាអ្នកមានអាយុ ១៦ ឆ្នាំឡើងទៅ ហើយយល់ព្រមនឹងលក្ខខណ្ឌប្រើប្រាស់ និងគោលការណ៍ឯកជនភាព ដើម្បីបង្កើតគណនី។'
export const CONSENT_REQUIRED_SIGNIN_EN = 'Please confirm you are 16 or older and agree to the Terms & Conditions and Privacy Policy to sign in.'
export const CONSENT_REQUIRED_SIGNIN_KM = 'សូមបញ្ជាក់ថាអ្នកមានអាយុ ១៦ ឆ្នាំឡើងទៅ ហើយយល់ព្រមនឹងលក្ខខណ្ឌប្រើប្រាស់ និងគោលការណ៍ឯកជនភាព ដើម្បីចូលគណនី។'

/** The refusal shown when the box is unticked: it names the action being attempted. */
export function consentRequiredMessage(copy: CopyFn, mode: 'signin' | 'signup'): string {
  return mode === 'signin'
    ? copy('portal_legal_consent_required_signin', CONSENT_REQUIRED_SIGNIN_EN, CONSENT_REQUIRED_SIGNIN_KM)
    : copy('portal_legal_consent_required', CONSENT_REQUIRED_EN, CONSENT_REQUIRED_KM)
}

/** The Worker's refusal when a sign-up arrives without the age confirmation. */
export const AGE_CONFIRMATION_REQUIRED_CODE = 'age_confirmation_required'

/** The sign-up fields the combined tick answers; the Worker requires ageConfirmed === true. */
export function signupConsentFields(consent: boolean, consentLocale: string): { consent: boolean; consentLocale: string; ageConfirmed?: true } {
  return consent ? { consent, consentLocale, ageConfirmed: true } : { consent, consentLocale }
}

/** The line with {terms} and {privacy} replaced by the given nodes, in whatever order the language puts them. */
export function fillConsentLine(line: string, nodes: { terms: ReactNode; privacy: ReactNode }): ReactNode[] {
  return line.split(/(\{terms\}|\{privacy\})/).filter(Boolean).map((part, index) => {
    if (part === '{terms}') return <span key={index}>{nodes.terms}</span>
    if (part === '{privacy}') return <span key={index}>{nodes.privacy}</span>
    return part
  })
}

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
  const titleOf = (page: 'terms' | 'privacy') => {
    const key = LEGAL_PAGE_TITLE_KEY[page]
    return copy(key, legalText('en', key), legalText('km', key))
  }
  return (
    <div>
      <div className="flex items-start gap-2.5 text-xs leading-relaxed text-stone-600 dark:text-neutral-300">
        <input
          id={id}
          type="checkbox"
          name="consent"
          required
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-emerald-700"
        />
        <label htmlFor={id} className="cursor-pointer">
          {fillConsentLine(copy('portalConsentLine', CONSENT_LINE_EN, CONSENT_LINE_KM), {
            terms: <LegalInlineLink page="terms" label={titleOf('terms')} />,
            privacy: <LegalInlineLink page="privacy" label={titleOf('privacy')} />,
          })}
        </label>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-rose-700 dark:text-rose-300">{error}</p>
      ) : null}
    </div>
  )
}
