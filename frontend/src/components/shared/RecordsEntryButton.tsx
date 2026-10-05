import History from 'lucide-react/dist/esm/icons/history.js'
import type { ButtonHTMLAttributes } from 'react'

type RecordsEntryButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'title' | 'aria-label'> & {
  /** Translated name; it is both the tooltip and the accessible name. */
  label: string
  /** Total records, or null while it is still unknown -- a placeholder, never a zero. */
  count: number | null
}

/** The entry to a record's history: a History icon with the total on a badge, for a detail header. */
export default function RecordsEntryButton({ label, count, type = 'button', ...rest }: RecordsEntryButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-blue-700 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-blue-300"
      {...rest}
    >
      <History className="h-4 w-4" aria-hidden="true" />
      <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-gray-200 px-1 text-center text-[10px] font-semibold leading-4 tabular-nums text-gray-700 dark:bg-gray-600 dark:text-gray-100">{count ?? '—'}</span>
    </button>
  )
}
