import { Fragment, useEffect, type ComponentType, type ReactNode, type SVGProps } from 'react'
import { useApp as useAppCore } from '../../app/AppContextCore.tsx'
import { useLayeredSectionNav } from '../../utils/sectionNavPreference.ts'
import { sealRootHubSection } from './hubNavigation.ts'
// The chip row below is chrome, and wears the same design language as the
// compact top bar / pages layer -- one stylesheet, so a hub can never drift
// away from the navigation it belongs to. Sidebar imports it too; Vite emits
// it once.
import '../navigation/nav-chrome.css'

// Mobile pages mode renders the selected body directly. Its section menu and
// back/title live in Sidebar; desktop and the sections preference keep these pills.
export type HubSectionDef = {
  id: string
  label: string
  icon?: ComponentType<SVGProps<SVGSVGElement>>
  description?: string
  badge?: ReactNode
  hidden?: boolean
  /* No per-section `tone`. It used to colour the ACTIVE chip's ink only, and
     each hub picked its own (sky / emerald / violet / rose / indigo / amber),
     so "which chip is the open one" was announced by a different hue on every
     page -- while the resting chips stayed the same grey everywhere. The
     active state is now one accent, declared once in nav-chrome.css. */
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
  /* No `desktopNavigation` escape hatch. It let a host hand in its own chip
     row and be returned it verbatim at md+, BEFORE the shared row was ever
     rendered -- so Review kept a bg-gray-100 well, a bg-white active chip and
     a per-hue active ink on every large screen, i.e. exactly the reported
     picture, on the one hub that opted out. A hub gets the shared row or it
     gets nothing; a row-wide modifier belongs on the shared row. */
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
  children,
}: HubSectionNavProps) {
  const { settings, page } = useAppCore() as { settings?: Record<string, unknown>; page: string }
  const layered = useLayeredSectionNav(settings?.ui_mobile_section_nav)
  const visible = sections.filter((section) => !section.hidden)
  useEffect(() => { writeStoredActive(storageKey, active) }, [storageKey, active])
  useEffect(() => {
    if (pageId && visible.some((section) => section.id === active)) sealRootHubSection(pageId, active, page)
  }, [pageId, page, active, visible.map((section) => section.id).join('|')])

  // Inserting desktop chrome must not move an unkeyed report/form from index
  // 0 to 1 and remount it. Keep its React identity without a new DOM wrapper.
  const content = <Fragment key="hub-content">{children}</Fragment>
  if (layered || visible.length <= 1) return <>{content}</>

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
          {/* `bos-nav-chrome` is what declares the --nav-* tokens on this
              element, so the row carries the design language without any
              colour utility left on it to fight the stylesheet for
              specificity -- the same arrangement Sidebar's chrome uses. */}
          <div className="bos-nav-chrome hub-section-pills flex max-w-full flex-wrap gap-1 rounded-xl p-1 md:inline-flex">
            {visible.map((section) => {
              const Icon = section.icon
              const isActive = active === section.id
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => onChange(section.id)}
                  aria-pressed={isActive}
                  className="hub-section-pill inline-flex min-h-11 min-w-0 flex-1 basis-[calc(50%_-_0.25rem)] items-center justify-center gap-1.5 break-words rounded-lg px-2.5 py-2 text-center text-[13px] font-semibold leading-snug transition-colors md:h-8 md:min-h-0 md:flex-none md:basis-auto md:whitespace-nowrap md:py-0"
                >
                  {Icon ? <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : null} {section.label}
                  {section.badge}
                </button>
              )
            })}
          </div>
          <div className="bos-nav-chrome hub-section-rule mt-2 hidden md:block" aria-hidden="true" />
        </div>
        {content}
      </>
    )
  }

  return <>{content}</>
}
