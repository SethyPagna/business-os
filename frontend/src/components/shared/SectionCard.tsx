import { useState, type ReactNode } from 'react'
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'

// N3: sections WITHIN a page read as distinct, color-coded, foldable blocks.
// The color identifies the section KIND, and the same kind uses the same
// color on every page — search is always blue wherever it appears, stock
// movements always orange — so color carries meaning instead of decoration.
//
// One source of truth for the palette. Change a kind's color here and every
// page follows; never restyle a single page's section locally.
export const SECTION_KIND_COLORS = {
  search: '#3b82f6', // blue — search & filters
  catalog: '#22c55e', // green — products / catalog
  stock: '#f97316', // orange — stock movements (in / out / adjustments)
  batches: '#f59e0b', // amber — batches / lots
  suppliers: '#a855f7', // purple — suppliers / contacts
  sales: '#ef4444', // red — sales / money
  reports: '#14b8a6', // teal — reports / logs
} as const

export type SectionKind = keyof typeof SECTION_KIND_COLORS

type SectionCardProps = {
  kind: SectionKind
  title: ReactNode
  subtitle?: ReactNode
  /** Compact controls rendered in the header row (right side). */
  actions?: ReactNode
  /** Renders a back arrow at the start of the header — every drill-down
   *  level deeper than its parent must offer one (user rule, Aug 28). */
  onBack?: () => void
  backLabel?: string
  /** Foldable by default. Pass false for a section that must always show. */
  collapsible?: boolean
  defaultOpen?: boolean
  /** Persist the fold state per user under this key (localStorage; safe to
   *  omit for ephemeral surfaces like modals). */
  storageKey?: string
  className?: string
  children: ReactNode
}

function readStoredOpen(storageKey: string | undefined, fallback: boolean): boolean {
  if (!storageKey) return fallback
  try {
    const raw = localStorage.getItem(`businessos_section_${storageKey}`)
    return raw == null ? fallback : raw === '1'
  } catch {
    return fallback
  }
}

function writeStoredOpen(storageKey: string | undefined, open: boolean): void {
  if (!storageKey) return
  try {
    localStorage.setItem(`businessos_section_${storageKey}`, open ? '1' : '0')
  } catch {
    /* storage unavailable — fold state just doesn't persist */
  }
}

export default function SectionCard({
  kind,
  title,
  subtitle,
  actions,
  onBack,
  backLabel,
  collapsible = true,
  defaultOpen = true,
  storageKey,
  className = '',
  children,
}: SectionCardProps) {
  const [open, setOpen] = useState(() => readStoredOpen(storageKey, defaultOpen))
  const color = SECTION_KIND_COLORS[kind]
  const toggle = () => {
    if (!collapsible) return
    setOpen((current) => {
      writeStoredOpen(storageKey, !current)
      return !current
    })
  }

  return (
    <section
      className={`overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 ${className}`}
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label={backLabel || 'Back'}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : (
          <span className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" />
        )}
        {/* The whole title area toggles the fold, but the header's action
            controls stay SEPARATE buttons — same rule as the stat cards
            (nested interactive controls silently break one another). */}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={collapsible ? open : undefined}
          disabled={!collapsible}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-gray-900 dark:text-white">{title}</span>
            {subtitle ? <span className="block truncate text-[11px] text-gray-400">{subtitle}</span> : null}
          </span>
          {collapsible ? (
            <ChevronDown className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${open ? '' : '-rotate-90'}`} />
          ) : null}
        </button>
        {actions ? <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1">{actions}</div> : null}
      </div>
      {open ? <div className="border-t border-gray-100 dark:border-gray-700/60">{children}</div> : null}
    </section>
  )
}
