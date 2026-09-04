import { useEffect, type ComponentType, type ReactNode, type SVGProps } from 'react'
import { useApp as useAppCore } from '../../app/AppContextCore.tsx'
import { useIsCompactViewport } from '../../utils/useViewport.ts'
import { useMobileSectionNavMode } from '../../utils/sectionNavPreference.ts'
import { sealRootHubSection } from './hubNavigation.ts'

// Mobile pages mode renders the selected body directly. Its section menu and
// back/title live in Sidebar; desktop and the sections preference keep these pills.
export type HubSectionDef = {
  id: string
  label: string
  icon?: ComponentType<SVGProps<SVGSVGElement>>
  description?: string
  badge?: ReactNode
  hidden?: boolean
  tone?: string
}

type HubSectionNavProps = {
  sections: HubSectionDef[]
  active: string
  onChange: (id: string) => void
  /** Full localStorage key (e.g. "bos:hub:branches:active") this hub's last
   *  chosen section is written to. Read-back is the host page's own choice
   *  (see readStoredHubSection) so deep-link/initial-section logic keeps
   *  first say -- this component only ever WRITES here. */
  storageKey?: string
  pageId?: string
  /** Preserve a host's established desktop chrome when adopting mobile navigation. */
  desktopNavigation?: ReactNode
  children?: ReactNode
}

function readStoredActive(storageKey: string | undefined): string | null {
  if (!storageKey || typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(storageKey)
  } catch {
    return null
  }
}

function writeStoredActive(storageKey: string | undefined, value: string): void {
  if (!storageKey || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey, value)
  } catch {
    // Private mode / storage disabled: the switcher still works in memory.
  }
}

/** Host pages call this from their own initial-section logic, AFTER their
 *  own deep-link checks and BEFORE falling back to a hardcoded default, so
 *  precedence stays deep-link > last-remembered > default. */
export function readStoredHubSection(storageKey: string, validIds: string[]): string | null {
  const stored = readStoredActive(storageKey)
  return stored && validIds.includes(stored) ? stored : null
}

export default function HubSectionNav({
  sections,
  active,
  onChange,
  storageKey,
  pageId,
  desktopNavigation,
  children,
}: HubSectionNavProps) {
  const { settings, page } = useAppCore() as { settings?: Record<string, unknown>; page: string }
  const isCompact = useIsCompactViewport()
  const mode = useMobileSectionNavMode(settings?.ui_mobile_section_nav)
  const layered = isCompact && mode === 'pages'
  const visible = sections.filter((section) => !section.hidden)
  useEffect(() => { writeStoredActive(storageKey, active) }, [storageKey, active])
  useEffect(() => {
    if (pageId && visible.some((section) => section.id === active)) sealRootHubSection(pageId, active, page)
  }, [pageId, page, active, visible.map((section) => section.id).join('|')])

  if (layered || visible.length <= 1) return <>{children}</>
  if (!isCompact && desktopNavigation) return <>{desktopNavigation}{children}</>

  if (!layered) {
    // Desktop/tablet always, and compact + "sections" preference: the chip
    // row, with a clearer treatment (caption + stronger divider) at md+.
    return (
      <>
        {/* No "Sections" caption above the chip row (user, Sep 3 2026): the
            chips already read as a section switcher, and the word was one
            more line of chrome above every hub page. The md+ divider below
            stays -- that is what separates the switcher from the body. The
            `sections` lang key is still live as the Settings toggle's option
            label. */}
        <div className="min-w-0 shrink-0 px-3 pt-3 sm:px-4 sm:pt-4">
          <div className="hub-section-pills flex max-w-full flex-wrap gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800 md:inline-flex md:border md:border-gray-200 md:dark:border-gray-700">
            {visible.map((section) => {
              const Icon = section.icon
              const isActive = active === section.id
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => onChange(section.id)}
                  aria-pressed={isActive}
                  className={`hub-section-pill inline-flex min-h-11 min-w-0 flex-1 basis-[calc(50%_-_0.25rem)] items-center justify-center gap-1.5 break-words rounded-lg px-2.5 py-2 text-center text-xs font-semibold leading-snug sm:text-sm md:h-8 md:min-h-0 md:flex-none md:basis-auto md:whitespace-nowrap md:py-0 ${isActive ? `bg-white shadow dark:bg-gray-900 ${section.tone || 'text-primary-600 dark:text-primary-400'} md:ring-1 md:ring-inset md:ring-black/5 md:dark:ring-white/10` : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                >
                  {Icon ? <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : null} {section.label}
                  {section.badge}
                </button>
              )
            })}
          </div>
          <div className="mt-2 hidden border-b-2 border-gray-200 dark:border-gray-700 md:block" aria-hidden="true" />
        </div>
        {children}
      </>
    )
  }

  return <>{children}</>
}
