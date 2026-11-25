import { Fragment, type ReactNode } from 'react'
import { useApp } from '../../AppContext.tsx'
import { fmtClock24, fmtDate, fmtDateOnly } from '../../utils/formatters.ts'
import type { Shift } from '../../api/shiftTransport.ts'

/** A clock time, with its date only when that date is not the shift's own day (a late close lands on another one). */
export function shiftCellTime(raw: string | null | undefined, businessDate: string | null | undefined): string {
  if (!raw) return '—'
  const clock = fmtClock24(raw)
  const date = fmtDate(raw)
  return date !== '—' && date !== fmtDateOnly(businessDate) ? `${date} ${clock}` : clock
}

/** A shift ID that may wrap only after a hyphen, never inside a segment, and is never cut short. */
export function ShiftCodeBreaks({ code }: { code: string }) {
  const parts = code.split('-')
  return <>{parts.map((part, index) => <Fragment key={index}>{part}{index < parts.length - 1 ? <>-<wbr /></> : null}</Fragment>)}</>
}

type Props = {
  shift: Pick<Shift, 'business_date' | 'shift_code' | 'user_name' | 'branch_name' | 'branch_active'>
  /** The tags and the status pill, at the right edge of the first line. */
  children?: ReactNode
  /** Inline elements only (spans), for a place that allows phrasing content, such as a picker option's button. Same row, same classes. */
  inline?: boolean
}

/** One compact row: date · ID · cashier · branch (then the retired-branch tag), pills at the right. */
export default function ShiftHeaderRow({ shift, children, inline = false }: Props) {
  // A span lays out exactly like the div here (every wrapper is a flex or block box by its classes), and is valid inside a button.
  const Box = inline ? 'span' : 'div'
  const { t } = useApp() as { t: (key: string) => string }
  const tr = (key: string, fallback: string) => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }
  return (
    <Box className="flex min-w-0 items-start justify-between gap-3">
      <Box className="-my-1 block min-w-0 flex-1 overflow-hidden py-1">
      <Box className="-ml-3 flex min-w-0 flex-wrap items-baseline gap-y-0.5">
        <span className="shift-hdr-item text-sm font-semibold text-gray-900 dark:text-white">{fmtDateOnly(shift.business_date)}</span>
        {shift.shift_code ? <span className="shift-hdr-item dense-id break-all text-[10px] text-gray-400 dark:text-gray-500">{shift.shift_code}</span> : null}
        <span title={t('shift_opened_by')} className="shift-hdr-item break-words text-xs text-gray-500 dark:text-gray-400">{shift.user_name || tr('shift_staff', 'Staff')}</span>
        <span className="shift-hdr-item break-words text-xs text-gray-500 dark:text-gray-400">{shift.branch_name || tr('all_branches', 'All branches')}</span>
        {shift.branch_active === false ? (
          <span className="shift-hdr-item inline-flex">
            <span
              className="inline-flex rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-zinc-800 dark:text-gray-300"
              title={tr('shift_branch_inactive_hint', 'This branch no longer trades. The shift stays here as a read-only record; a shift still open there can only be closed.')}
            >
              {tr('shift_branch_inactive', 'Branch inactive')}
            </span>
          </span>
        ) : null}
      </Box>
      </Box>
      {children ? <Box className="flex shrink-0 items-center gap-1.5">{children}</Box> : null}
    </Box>
  )
}
