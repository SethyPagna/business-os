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
  /** Mini "section within a section": a lighter, smaller, indented variant
   *  for sub-sections nested inside a parent SectionCard's body (user, Aug 29:
   *  "sections, mini sections in the sections"). Same color-by-kind accent and
   *  fold behaviour, just quieter chrome so the hierarchy reads at a glance. */
  nested?: boolean
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
  nested = false,
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

  // Two visual weights from one component: a full page-level section, and a
  // mini sub-section (`nested`) meant to sit inside another section's body.
  // The mini variant keeps the same color-by-kind accent and fold behaviour
  // but drops to a lighter surface, thinner accent and smaller type so the
  // parent/child hierarchy is obvious.
  const s = nested
    ? {
        section: 'overflow-hidden rounded-lg border border-gray-200/80 bg-gray-50/60 dark:border-gray-700/60 dark:bg-gray-900/30',
        accent: '2px',
        header: 'flex min-w-0 items-center gap-2 px-2.5 py-1.5',
        backBtn: 'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100',
        backIcon: 'h-3.5 w-3.5',
        dot: 'h-2 w-2 flex-shrink-0 rounded-sm',
        title: 'block truncate text-xs font-semibold text-gray-800 dark:text-gray-100',
        subtitle: 'block truncate text-[10px] text-gray-400',
        chevron: 'h-3.5 w-3.5 flex-shrink-0 text-gray-400 transition-transform',
        body: 'border-t border-gray-100/70 dark:border-gray-700/40',
      }
    : {
        section: 'overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
        accent: '3px',
        header: 'flex min-w-0 items-center gap-2 px-3 py-2',
        backBtn: 'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100',
        backIcon: 'h-4 w-4',
        dot: 'h-2.5 w-2.5 flex-shrink-0 rounded-sm',
        title: 'block truncate text-sm font-semibold text-gray-900 dark:text-white',
        subtitle: 'block truncate text-[11px] text-gray-400',
        chevron: 'h-4 w-4 flex-shrink-0 text-gray-400 transition-transform',
        body: 'border-t border-gray-100 dark:border-gray-700/60',
      }

  return (
    <section
      className={`${s.section} ${className}`}
      style={{ borderLeft: `${s.accent} solid ${color}` }}
    >
      <div className={s.header}>
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label={backLabel || 'Back'}
            className={s.backBtn}
          >
            <ArrowLeft className={s.backIcon} />
          </button>
        ) : (
          <span className={s.dot} style={{ backgroundColor: color }} aria-hidden="true" />
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
            <span className={s.title}>{title}</span>
            {subtitle ? <span className={s.subtitle}>{subtitle}</span> : null}
          </span>
          {collapsible ? (
            <ChevronDown className={`${s.chevron} ${open ? '' : '-rotate-90'}`} />
          ) : null}
        </button>
        {actions ? <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1">{actions}</div> : null}
      </div>
      {open ? <div className={s.body}>{children}</div> : null}
    </section>
  )
}
