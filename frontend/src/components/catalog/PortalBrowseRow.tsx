import type { LucideIcon } from 'lucide-react'

export type BrowseOption<T extends string> = { value: T; icon: LucideIcon; label: string; tip: string }

// One labelled row of single-choice chips, shaped like the stock-status row in
// the same menu. Tapping the chosen chip again deselects it back to the default
// ("select/deselect", owner 5 Oct) -- the default itself stays chosen, so a row
// can never be left with nothing selected.
export default function PortalBrowseRow<T extends string>({ label, options, value, defaultValue, onChange }: {
  label: string
  options: BrowseOption<T>[]
  value: T
  defaultValue: T
  onChange: (value: T) => void
}) {
  return (
    <div className="rounded-[1.1rem] bg-slate-50 p-2 ring-1 ring-slate-100 dark:bg-neutral-800 dark:ring-neutral-700">
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-2 sm:grid-cols-[5.6rem_minmax(0,1fr)] lg:grid-cols-1 lg:gap-1">
        <div className="min-w-0 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-neutral-400 lg:pt-0">
          <span className="block truncate">{label}</span>
        </div>
        <div role="group" aria-label={label} className="flex min-w-0 flex-wrap gap-1.5">
          {options.map((option) => {
            const active = option.value === value
            const Icon = option.icon
            return (
              <button
                key={option.value}
                type="button"
                data-browse-option={option.value}
                aria-pressed={active}
                title={option.tip}
                onClick={() => onChange(active ? defaultValue : option.value)}
                className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold leading-5 transition-colors ${
                  active
                    ? 'border-blue-700 bg-blue-600 text-white shadow-sm dark:border-amber-400 dark:bg-amber-400 dark:text-neutral-950'
                    : 'border-slate-200 bg-white/95 text-slate-700 shadow-sm hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-neutral-700 dark:bg-neutral-800/90 dark:text-neutral-200 dark:hover:border-amber-500/50 dark:hover:bg-neutral-700/80 dark:hover:text-amber-300'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{option.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
