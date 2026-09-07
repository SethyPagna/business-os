import type { ReactNode } from 'react'
import { useApp } from '../../AppContext.tsx'
import type { ShiftCountBlocker } from '../../api/shiftTransport.ts'

/**
 * The two-currency drawer count, as ONE shared control.
 *
 * Every shift form counts the same drawer the same way: dollars and riel,
 * side by side, never converted. Until 2026-09-06 each surface (POS register,
 * POS close, the Shifts popup's amend / close / reopen) drew its own pair and
 * its own `disabled` rule, and the POS pair silently refused to proceed until
 * BOTH fields were typed -- the owner: "i had to enter the usd as well as
 * khmer riel to enter." One component means one behaviour:
 *
 *   - "0" is the placeholder and the hint under the pair says a blank field
 *     is recorded as 0 (the shared rule is shiftCountOrZero in the transport).
 *   - The currency sits INSIDE the field as a suffix, so the label above can
 *     be one short phrase for the pair ("Opening cash") instead of two.
 *   - Side by side from 640px up, stacked below it (a 375px till still fits
 *     the whole form on one screen).
 *
 * `dense` is the POS look (32px controls, 13px text -- the admin density);
 * the Shifts popup keeps the shared `.input` so its pair matches the
 * date-time fields beside it. Both stay >=16px under 768px via the same
 * breakpoint classes, which is what keeps iOS Safari from zooming the page.
 */
type ShiftGateContext = { t: (key: string) => string }

type PairProps = {
  label: string
  usd: string
  khr: string
  onUsd: (value: string) => void
  onKhr: (value: string) => void
  usdLabel: string
  khrLabel: string
  disabled?: boolean
  autoFocus?: boolean
  dense?: boolean
  className?: string
}

const DENSE_INPUT = 'h-10 text-base sm:h-8 sm:text-[13px] w-full rounded-lg border border-gray-300 bg-white pl-2.5 pr-12 text-zinc-900 tabular-nums placeholder:text-gray-400 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100'
const FORM_INPUT = 'input pr-12 tabular-nums'

export default function ShiftCountPair({ label, usd, khr, onUsd, onKhr, usdLabel, khrLabel, disabled = false, autoFocus = false, dense = false, className = '' }: PairProps) {
  const { t } = useApp() as ShiftGateContext
  const inputClass = dense ? DENSE_INPUT : FORM_INPUT
  const suffixClass = 'pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] font-semibold tracking-wide text-[color:var(--ui-accent,#9c7a3c)]'
  return (
    <div className={`min-w-0 ${className}`}>
      <span className="block text-xs font-medium leading-relaxed text-zinc-700 dark:text-zinc-200">{label}</span>
      <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <span className="relative block min-w-0">
          <input
            type="number" inputMode="decimal" min="0" step="0.01" placeholder="0"
            aria-label={usdLabel} title={usdLabel}
            className={inputClass} disabled={disabled} autoFocus={autoFocus}
            value={usd} onChange={(event) => onUsd(event.target.value)}
          />
          <span className={suffixClass} aria-hidden="true">USD</span>
        </span>
        <span className="relative block min-w-0">
          <input
            type="number" inputMode="numeric" min="0" step="100" placeholder="0"
            aria-label={khrLabel} title={khrLabel}
            className={inputClass} disabled={disabled}
            value={khr} onChange={(event) => onKhr(event.target.value)}
          />
          <span className={suffixClass} aria-hidden="true">KHR</span>
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{t('shift_blank_count_hint')}</p>
    </div>
  )
}

/** The pack key that names a blocker, for the row under the pair. */
export function shiftCountBlockerKey(blocker: ShiftCountBlocker): string {
  return blocker === 'both_blank' ? 'shift_count_needed' : 'shift_count_invalid'
}

type SubmitRowProps = {
  /** Already-translated reason the action cannot proceed, or null when it can. */
  reason: string | null
  busy: boolean
  label: string
  onClick: () => void
  buttonClassName?: string
  /** A secondary control (the Shifts popup's Cancel) that shares the row. */
  secondary?: ReactNode
  className?: string
}

/**
 * The footer of a shift form: the reason (if any) and the button, ON ONE ROW.
 *
 * A primary action is never disabled silently. When it cannot proceed, the
 * `reason` is printed beside it in plain words, so the operator knows what to
 * type next instead of pressing a dead button. The button IS disabled while
 * a reason is shown -- but the reason is the message, not the greyed state.
 */
export function ShiftSubmitRow({ reason, busy, label, onClick, buttonClassName = 'btn-primary', secondary = null, className = '' }: SubmitRowProps) {
  const { t } = useApp() as ShiftGateContext
  return (
    <div className={`flex flex-wrap items-center justify-end gap-2 pt-1 ${className}`}>
      {reason && (
        <span role="status" className="mr-auto min-w-0 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{reason}</span>
      )}
      {secondary}
      <button
        type="button" disabled={busy || reason != null} onClick={onClick}
        className={`${buttonClassName} disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {busy ? t('saving_label') : label}
      </button>
    </div>
  )
}
