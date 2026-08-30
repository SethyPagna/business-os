import ArrowDown from 'lucide-react/dist/esm/icons/arrow-down.js'
import ArrowUp from 'lucide-react/dist/esm/icons/arrow-up.js'
import ArrowUpDown from 'lucide-react/dist/esm/icons/arrow-up-down.js'
import Check from 'lucide-react/dist/esm/icons/check.js'
import PortalMenu from './PortalMenu'
import { nextSortSpec, type SortField, type SortSpec } from '../../utils/listSort'

// The visible face of the unified sort method (see utils/listSort.ts): a
// compact chip that always SHOWS the active sort ("↓ Date") instead of hiding
// it inside the Filters menu, and opens the page's declared sort fields.
// Tapping the active field again flips the direction. One control, one
// look, every list page.
export default function SortChip<T>({ spec, fields, onChange, label = 'Sort', className = '' }: {
  spec: SortSpec
  fields: ReadonlyArray<SortField<T>>
  onChange: (next: SortSpec) => void
  label?: string
  className?: string
}) {
  const active = fields.find((field) => field.id === spec.field)
  const DirIcon = active ? (spec.direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <PortalMenu
      compact
      triggerWrapperClassName={className}
      trigger={(
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 text-xs font-semibold text-gray-600 transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-blue-600 dark:hover:text-blue-400"
          aria-label={label}
          title={label}
        >
          <DirIcon className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="max-w-[7rem] truncate">{active ? active.label : label}</span>
        </button>
      )}
      items={fields.map((field) => ({
        label: (
          <span className="inline-flex w-full items-center justify-between gap-3">
            <span>{field.label}</span>
            {field.id === spec.field ? (
              <span className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400">
                {spec.direction === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                <Check className="h-3.5 w-3.5" />
              </span>
            ) : null}
          </span>
        ),
        onClick: () => onChange(nextSortSpec(spec, field.id, fields)),
      }))}
    />
  )
}
