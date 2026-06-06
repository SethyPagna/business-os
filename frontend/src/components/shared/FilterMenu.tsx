import Filter from 'lucide-react/dist/esm/icons/filter.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import type { ReactNode } from 'react'
import LazyPortalMenu from './LazyPortalMenu'

type CloseMenu = () => void

type FilterOption = {
  id: string | number
  label: ReactNode
  title?: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
}

type FilterSection = {
  id: string | number
  label: ReactNode
  description?: ReactNode
  options?: Array<FilterOption | null | undefined | false>
  render?: (helpers: { closeMenu: CloseMenu }) => ReactNode
}

type FilterMenuProps = {
  label?: string
  activeCount?: number
  sections?: Array<FilterSection | null | undefined | false>
  onClear?: (() => void) | null
  compact?: boolean
  mobileIconOnly?: boolean
  onOpenChange?: ((open: boolean) => void) | null
}

const SECTION_LABEL_FALLBACKS: Record<string, string> = {
  action: 'Action',
  brand: 'Brand',
  branch: 'Branch',
  category: 'Category',
  group: 'Groups',
  month: 'Month',
  sort: 'Sort',
  stock: 'Stock',
  supplier: 'Supplier',
  user: 'User',
  year: 'Year',
}

function sectionButtonClass(active: boolean): string {
  return active
    ? 'bg-blue-600 text-white border-blue-700 shadow-sm'
    : 'bg-white/95 text-slate-700 border-slate-200 shadow-sm hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50 dark:bg-slate-800/90 dark:text-slate-200 dark:border-slate-600 dark:hover:border-blue-500 dark:hover:text-blue-300 dark:hover:bg-slate-700/80'
}

function getSectionFallbackLabel(sectionId: string | number): string {
  const normalizedId = String(sectionId || '').trim().toLowerCase()
  return SECTION_LABEL_FALLBACKS[normalizedId] || ''
}

function resolveSectionLabel(section: FilterSection): ReactNode {
  if (typeof section.label !== 'string') return section.label
  const label = section.label.trim()
  const fallback = getSectionFallbackLabel(section.id)
  if (!label) return fallback || section.label
  if (fallback && label.toLowerCase() === 'back') return fallback
  return section.label
}

export default function FilterMenu({
  label = 'Filters',
  activeCount = 0,
  sections = [],
  onClear = null,
  compact = false,
  mobileIconOnly = false,
  onOpenChange = null,
}: FilterMenuProps) {
  const hasActions = typeof onClear === 'function'
  const triggerLabel = activeCount > 0 ? `${label} (${activeCount})` : label

  return (
    <LazyPortalMenu
      align="right"
      menuClassName="w-[min(22rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] overflow-hidden rounded-[1.35rem] border border-slate-200 bg-white p-0 shadow-xl shadow-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/30"
      onOpenChange={onOpenChange}
      trigger={(
        <button
          type="button"
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors sm:text-sm ${
            activeCount > 0
              ? 'border-blue-700 bg-blue-600 text-white shadow-sm'
              : 'border-slate-300 bg-white text-slate-700 shadow-sm hover:border-blue-400 hover:text-blue-700 hover:bg-blue-50/60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-blue-500 dark:hover:text-blue-300 dark:hover:bg-slate-700/80'
          } ${compact ? 'max-w-[9.5rem] px-2 py-1.5 sm:max-w-none sm:px-2.5' : ''}`}
          aria-label={label}
          title={triggerLabel}
        >
          <Filter className="h-4 w-4 shrink-0" />
          <span className={`truncate whitespace-nowrap ${mobileIconOnly ? 'hidden sm:inline' : ''}`}>{triggerLabel}</span>
          {mobileIconOnly && activeCount > 0 ? (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-white/20 px-1 text-[10px] font-bold sm:hidden">
              {activeCount}
            </span>
          ) : null}
        </button>
      )}
      content={({ closeMenu }) => (
        <div className="max-h-[min(32rem,70vh)] overflow-auto rounded-[1.35rem] p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">{label}</div>
            <div className="flex items-center gap-2">
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
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white"
                onClick={closeMenu}
                aria-label={`Close ${label}`}
                title={`Close ${label}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {(sections.filter(Boolean) as FilterSection[]).map((section) => (
              <div
                key={section.id}
                className="rounded-2xl bg-slate-50/70 p-1.5 dark:bg-slate-800/40"
                data-filter-menu-section={String(section.id)}
              >
                <div className="grid grid-cols-[4.85rem_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[5.25rem_minmax(0,1fr)]">
                  <div className="min-w-0 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                    <span className="block truncate" data-filter-menu-section-label={String(section.id)}>{resolveSectionLabel(section)}</span>
                  </div>
                  <div className="min-w-0">
                    {section.description ? (
                      <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">{section.description}</p>
                    ) : null}

                    {typeof section.render === 'function' ? (
                      section.render({ closeMenu })
                    ) : (
                      <div className="flex min-w-0 flex-wrap gap-1.5">
                        {((section.options || []).filter(Boolean) as FilterOption[]).map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            disabled={option.disabled}
                            onClick={() => option.onClick?.()}
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${sectionButtonClass(!!option.active)}`}
                            title={option.title || (typeof option.label === 'string' ? option.label : undefined)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    />
  )
}
