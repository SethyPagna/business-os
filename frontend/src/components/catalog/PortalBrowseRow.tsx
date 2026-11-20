import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { microLabelProps } from './catalogUi'
import { PRODUCT_ACTIVE_CLASS, PRODUCT_CHIP_CLASS } from './portalProductSurfaces.ts'

export type BrowseOption<T extends string> = { value: T; icon: LucideIcon; label: string; tip: string }

// One labelled row of a filter menu: the label, then its control. A flat row, not a tile inside the
// menu's own panel (no nested rounded containers); rows are told apart by the line between them.
export function PortalFilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-stone-300 pt-2 first:border-t-0 first:pt-0 dark:border-neutral-700 lg:border-t-0 lg:pt-0">
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-2 sm:grid-cols-[5.6rem_minmax(0,1fr)] lg:grid-cols-1 lg:gap-1">
        <div {...microLabelProps(label, 'min-w-0 pt-1.5 font-bold text-stone-600 dark:text-neutral-300 lg:pt-0')}>
          <span className="block break-words">{label}</span>
        </div>
        {children}
      </div>
    </div>
  )
}

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
    <PortalFilterRow label={label}>
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
              className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold leading-5 transition-colors ${active ? PRODUCT_ACTIVE_CLASS : PRODUCT_CHIP_CLASS}`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{option.label}</span>
            </button>
          )
        })}
      </div>
    </PortalFilterRow>
  )
}
