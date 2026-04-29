import { Filter } from 'lucide-react'
import PortalMenu from './PortalMenu'

function sectionButtonClass(active) {
  return active
    ? 'bg-blue-600 text-white border-blue-600'
    : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-700 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:border-blue-500 dark:hover:text-blue-300'
}

export default function FilterMenu({
  label = 'Filters',
  activeCount = 0,
  sections = [],
  onClear = null,
  compact = false,
}) {
  const hasActions = typeof onClear === 'function'

  return (
    <PortalMenu
      align="right"
      menuClassName="w-[min(22rem,calc(100vw-1rem))] p-0"
      trigger={(
        <button
          type="button"
          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium sm:text-sm ${
            activeCount > 0
              ? 'border-blue-600 bg-blue-600 text-white'
              : 'border-gray-300 bg-white text-gray-600 hover:border-blue-400 hover:text-blue-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-blue-500 dark:hover:text-blue-300'
          } ${compact ? 'px-2.5 py-1.5' : ''}`}
          aria-label={label}
        >
          <Filter className="h-4 w-4" />
          <span className="whitespace-nowrap">{activeCount > 0 ? `${label} (${activeCount})` : label}</span>
        </button>
      )}
      content={({ closeMenu }) => (
        <div className="max-h-[min(32rem,70vh)] overflow-auto p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">{label}</div>
            {hasActions ? (
              <button
                type="button"
                className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-200"
                onClick={() => {
                  onClear?.()
                  closeMenu()
                }}
              >
                Clear
              </button>
            ) : null}
          </div>

          <div className="space-y-3">
            {sections.filter(Boolean).map((section) => (
              <div key={section.id} className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  {section.label}
                </div>

                {section.description ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400">{section.description}</p>
                ) : null}

                {typeof section.render === 'function' ? (
                  section.render({ closeMenu })
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {(section.options || []).filter(Boolean).map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        disabled={option.disabled}
                        onClick={() => option.onClick?.()}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${sectionButtonClass(!!option.active)}`}
                        title={option.title || option.label}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    />
  )
}
