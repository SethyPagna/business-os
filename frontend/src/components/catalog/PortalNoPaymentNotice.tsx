import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.js'
import { LegalInlineLink } from './legal/LegalPages.tsx'
import { LEGAL_PAGE_TITLE_KEY, legalText } from './legal/legalContent.ts'

// The standing "we don't take online payments, contact us — for your safety"
// notice (§2). The user gave one canonical sentence and said various versions
// with the same meaning are fine, so this renders the full line by default and
// a shorter variant where space is tight (the cart drawer header, a card
// footer). Copy comes through the storefront's i18n `copy()` so both languages
// stay in sync.
//
// The sentence ends on a privacy promise, so it carries a link to the
// privacy policy that backs the promise up -- an assurance with nothing
// behind it is the claim a consumer-protection complaint is made of.

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

const FULL = "WE, Leang Cosmetics/Leang Beauty don't take online payments — contact us to purchase. YOUR PRIVACY IS OUR PRIORITY."
const SHORT = 'No online payments — please contact us to purchase. For your safety.'
// With online ordering on (the `onlineOrdersEnabled` switch), the standing notice says what is true instead: the shop does take KHQR payments
// through ABA, and it still never sees or keeps bank details. It keeps the privacy promise and the link that backs it.
const ONLINE_FULL = 'You can pay online with ABA KHQR, or contact us to buy. We never see or keep your bank details. YOUR PRIVACY IS OUR PRIORITY.'
const ONLINE_SHORT = 'Pay online with ABA KHQR, or contact us to buy. We never keep your bank details.'

export default function PortalNoPaymentNotice({
  copy,
  variant = 'full',
  online = false,
  className = '',
}: {
  copy: CopyFn
  variant?: 'full' | 'short'
  /** Online ordering is on: say that the shop takes KHQR payments, not that it takes none. */
  online?: boolean
  className?: string
}) {
  const text = online
    ? (variant === 'short'
      ? copy('order_notice_online_short', ONLINE_SHORT, 'ទូទាត់តាមអនឡាញដោយ ABA KHQR ឬទាក់ទងយើងដើម្បីទិញ។ យើងមិនរក្សាទុកព័ត៌មានធនាគាររបស់អ្នកទេ។')
      : copy('order_notice_online', ONLINE_FULL, 'អ្នកអាចទូទាត់តាមអនឡាញដោយ ABA KHQR ឬទាក់ទងយើងដើម្បីទិញ។ យើងមិនឃើញ ឬរក្សាទុកព័ត៌មានធនាគាររបស់អ្នកទេ។ ឯកជនភាពរបស់អ្នកគឺជាអាទិភាពរបស់យើង។'))
    : variant === 'short'
      ? copy('noPaymentNoticeShort', SHORT)
      : copy('noPaymentNotice', FULL)
  const privacyKey = LEGAL_PAGE_TITLE_KEY.privacy
  const privacyLabel = copy(privacyKey, legalText('en', privacyKey), legalText('km', privacyKey))
  return (
    <div
      role="note"
      className={`flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] font-medium leading-relaxed text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-200 ${className}`}
    >
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        {text}{' '}
        <LegalInlineLink page="privacy" label={privacyLabel} />
      </span>
    </div>
  )
}
