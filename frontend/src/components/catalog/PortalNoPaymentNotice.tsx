import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.js'

// The standing "we don't take online payments, contact us — for your safety"
// notice (§2). The user gave one canonical sentence and said various versions
// with the same meaning are fine, so this renders the full line by default and
// a shorter variant where space is tight (the cart drawer header, a card
// footer). Copy comes through the storefront's i18n `copy()` so both languages
// stay in sync.

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

const FULL = "WE, Leang Cosmetics/Leang Beauty don't take online payments — contact us to purchase. YOUR PRIVACY IS OUR PRIORITY."
const SHORT = 'No online payments — please contact us to purchase. For your safety.'

export default function PortalNoPaymentNotice({
  copy,
  variant = 'full',
  className = '',
}: {
  copy: CopyFn
  variant?: 'full' | 'short'
  className?: string
}) {
  const text = variant === 'short'
    ? copy('noPaymentNoticeShort', SHORT)
    : copy('noPaymentNotice', FULL)
  return (
    <div
      role="note"
      className={`flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] font-medium leading-relaxed text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-200 ${className}`}
    >
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{text}</span>
    </div>
  )
}
