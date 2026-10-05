import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'

type DayGroupSelection = {
  checked: boolean
  indeterminate: boolean
  onChange: (checked: boolean) => void
  ariaLabel: string
}

type DayGroupHeaderProps = {
  label: string
  count: number
  collapsed: boolean
  onToggle: () => void
  /** Present only in select mode. */
  selection?: DayGroupSelection
  t: (key: string) => string
}

/**
 * The one day-group header for the Sales and Returns lists, desktop row and
 * phone card alike: day label, the money-counting count, and an icon-only
 * chevron that names its action (Expand / Collapse) for touch and screen readers.
 */
export default function DayGroupHeader({ label, count, collapsed, onToggle, selection, t }: DayGroupHeaderProps) {
  const toggleLabel = collapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')
  const text = (
    <>
      <span className="min-w-0">{label}</span>
      <span className="font-normal normal-case tracking-normal text-slate-400">{count}</span>
    </>
  )
  return (
    <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
      {selection ? (
        <label className="inline-flex min-w-0 items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded"
            checked={selection.checked}
            ref={(node) => { if (node) node.indeterminate = selection.indeterminate }}
            onChange={(event) => selection.onChange(event.target.checked)}
            aria-label={selection.ariaLabel}
          />
          {text}
        </label>
      ) : (
        <div className="inline-flex min-w-0 items-center gap-2">{text}</div>
      )}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={toggleLabel}
        title={toggleLabel}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  )
}
