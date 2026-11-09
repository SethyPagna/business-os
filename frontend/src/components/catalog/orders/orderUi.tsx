import Minus from 'lucide-react/dist/esm/icons/minus.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import { useId, type ReactNode } from 'react'
import { getKhmerTextProps } from '../../../utils/scriptTypography.ts'

// The few building blocks the checkout sheet and the order page share, in the storefront's own look (the account drawer's fields and buttons).

export type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

// The ring is painted here, not left to a stylesheet: the checkout sheet and the order page sit outside the catalogue surface (same reason as CatalogAccountSection).
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#0369a1] dark:focus-visible:outline-[#fcd34d]'
export const inputClass = `w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:bg-white ${FOCUS_RING} dark:border-white/10 dark:bg-white/5 dark:text-white`
export const primaryButtonClass = `inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60 ${FOCUS_RING}`
export const secondaryButtonClass = `inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-white/15 dark:bg-white/5 dark:text-neutral-100 dark:hover:bg-white/10 ${FOCUS_RING}`
export const iconButtonClass = `inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-60 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-neutral-100 ${FOCUS_RING}`
export const cardClass = 'rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-neutral-900'

/** A labelled field: an explicit for/id pair so the label (and the hint, through aria-describedby) names the control for a screen reader. */
export function Field({ label, hint, id, children }: {
  label: string
  hint?: string
  /** A fixed id when something else (a focus call after a refusal) must find the control; otherwise one is made. */
  id?: string
  children: (fieldId: string, describedBy: string | undefined) => ReactNode
}) {
  const generated = useId()
  const fieldId = id ?? generated
  const describedBy = hint ? `${fieldId}-hint` : undefined
  return (
    <div className="block">
      <label htmlFor={fieldId} className="mb-1 block text-xs font-semibold leading-6 text-slate-600 dark:text-neutral-300">{label}</label>
      {children(fieldId, describedBy)}
      {hint ? <div id={`${fieldId}-hint`} className="mt-1 text-xs leading-6 text-slate-500 dark:text-neutral-400">{hint}</div> : null}
    </div>
  )
}

const NOTICE_TONES = {
  error: 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200',
  info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-400/25 dark:bg-sky-400/10 dark:text-sky-100',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-100',
  warn: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100',
} as const

/** A short message box. An error is announced at once (role=alert); everything else politely. */
export function Notice({ tone, children, icon }: { tone: keyof typeof NOTICE_TONES; children: ReactNode; icon?: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm leading-relaxed ${NOTICE_TONES[tone]}`}
    >
      {icon ? <span className="mt-0.5 shrink-0" aria-hidden="true">{icon}</span> : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** A product name is never cut with an ellipsis on this project: it scrolls sideways, and Khmer gets its own line height (the drawer's rule). */
export function ProductName({ name }: { name: string }) {
  return <div {...getKhmerTextProps(name, 'detail-scroll-text notranslate text-sm font-medium text-slate-900 dark:text-neutral-100')} translate="no">{name}</div>
}

const STEP_BUTTON = `flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition hover:bg-slate-200 disabled:opacity-40 dark:bg-white/10 dark:text-neutral-100 dark:hover:bg-white/20 ${FOCUS_RING}`

/** A whole-number stepper with real buttons (the drawer's minus and plus at a touch-sized 40px), named for a screen reader by the item it changes. */
export function QuantityStepper({ copy, itemName, value, min, max, onChange }: {
  copy: CopyFn
  itemName: string
  value: number
  min: number
  max: number
  onChange: (next: number) => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        className={STEP_BUTTON}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        aria-label={`${copy('decreaseQty', 'Decrease quantity', 'បន្ថយចំនួន')}: ${itemName}`}
      >
        <Minus className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="w-7 text-center text-sm font-semibold text-slate-900 dark:text-neutral-100" translate="no">{value}</span>
      <button
        type="button"
        className={STEP_BUTTON}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        aria-label={`${copy('increaseQty', 'Increase quantity', 'បង្កើនចំនួន')}: ${itemName}`}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}
