import { useEffect, useRef, useState, type ComponentType, type ReactNode, type SVGProps } from 'react'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import { useApp as useAppCore } from '../../app/AppContextCore.tsx'
import { APP_NAVIGATION_EVENT } from '../../app/appShellUtils.ts'
import { useIsCompactViewport } from '../../utils/useViewport.ts'
import { readMobileSectionNavMode } from '../../utils/sectionNavPreference.ts'

// ONE shared section switcher for the "hub" pages (Branches, Sales,
// Settings, Contacts, Promotions) that each used to hand-roll their own
// near-identical chip row (Gate 1 audit, Area 5). It renders three
// different things depending on viewport + the user's mobile-navigation
// preference (Settings -> Appearance -> "Mobile navigation"):
//
//   - desktop/tablet (>=768px), always: today's chip row, with a clearer
//     "Sections" caption + divider so new users recognise it.
//   - compact (<768px) + preference "sections": the same chip row (today's
//     mobile look, unchanged).
//   - compact + preference "pages" (the default): the mobile three-layer
//     nav. Layer 2 is a list of option cards (one per visible section);
//     tapping one enters layer 3, the chosen section full-screen with a
//     back chevron + section title and NO chip row.
//
// `children` is the ALREADY-BUILT body for the current `active` section
// (each host page still owns its own per-section JSX/Suspense exactly as
// before -- this component only owns the switcher chrome around it). In
// layer 2, `children` is simply not included in the returned tree, so the
// lazy section chunk behind it never starts loading until the user actually
// enters that section.
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
  /** Identifies this hub instance for the "re-entering this same page
   *  collapses back to layer 2" rule -- must match the id App.tsx's
   *  navigateTo()/APP_NAVIGATION_EVENT uses for this page (e.g. 'branches'). */
  pageId?: string
  /** Optional hub title shown above the "Sections" caption in layer 2 (most
   *  hub pages show no page title on mobile otherwise -- see Gate 1 audit,
   *  the mobile top header carries no page name). */
  title?: string
  /** Start already in layer 3 for the current `active` section -- set this
   *  from the SAME condition the host's own initial-section logic used to
   *  decide a deep link was in play (e.g. a URL segment or a Dashboard
   *  hand-off), so that behaviour survives the move to HubSectionNav. */
  initialEntered?: boolean
  /** Bump (increment) this to force layer 3 open for the CURRENT `active`
   *  value from a host effect that fires after mount (e.g. a Dashboard
   *  hand-off arriving while this hub was already mounted in the
   *  background). Ignored on first render, and a no-op if already entered. */
  enterSignal?: number
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

const HUB_HISTORY_MARKER = 'bosHubLayer3'

export default function HubSectionNav({
  sections,
  active,
  onChange,
  storageKey,
  pageId,
  title,
  initialEntered = false,
  enterSignal = 0,
  children,
}: HubSectionNavProps) {
  const { t, settings } = useAppCore() as { t: (key: string) => string; settings?: Record<string, unknown> }
  const trh = (key: string, fallback: string): string => { const value = t(key); return value && value !== key ? value : fallback }
  const isCompact = useIsCompactViewport()
  const mode = readMobileSectionNavMode(settings?.ui_mobile_section_nav)
  const layered = isCompact && mode === 'pages'

  const [entered, setEntered] = useState(initialEntered && layered)
  const enterSignalRef = useRef(enterSignal)
  const hasMountedRef = useRef(false)
  // Tracks whether a matching, not-yet-consumed history entry is currently
  // sitting on the stack for the CURRENT `entered` state -- every path that
  // sets entered=true (via pushLayer3State) sets this; every path that
  // consumes it (a real popstate, or our own defensive cleanup below) clears
  // it. goBack() and the same-hub re-nav handler both consult it so they
  // never call history.back() with nothing real to pop, and never leave an
  // orphaned same-URL entry behind either.
  const pushedRef = useRef(false)

  const visible = sections.filter((section) => !section.hidden)

  useEffect(() => {
    writeStoredActive(storageKey, active)
  }, [storageKey, active])

  // Entering layer 3 (from a card tap, or programmatically below) pushes a
  // history entry with no URL change, so the browser/OS back gesture pops
  // it and lands back on layer 2 -- one hardware-back press per layer, same
  // as any native app's back stack. The main app's own popstate handler
  // (AppContext.tsx) only reacts when the PATH changes, so this extra,
  // same-URL entry is invisible to it.
  const pushLayer3State = (): void => {
    if (typeof window === 'undefined') return
    try {
      window.history.pushState({ ...(window.history.state || {}), [HUB_HISTORY_MARKER]: true }, '', window.location.href)
      pushedRef.current = true
    } catch {
      // history.pushState can throw under some embedded/webview policies;
      // layer 3 still renders, back just falls through to page-level nav.
      pushedRef.current = false
    }
  }

  // initialEntered (a deep link resolved at construction time) starts
  // `entered` true with no history entry behind it yet -- push one on
  // mount so the back gesture has something real to pop.
  useEffect(() => {
    if (hasMountedRef.current) return
    hasMountedRef.current = true
    if (layered && entered) pushLayer3State()
    // Mount-only: initialEntered is only ever meant to apply once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!layered) return
    if (enterSignal === enterSignalRef.current) return
    enterSignalRef.current = enterSignal
    if (!entered) {
      setEntered(true)
      pushLayer3State()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enterSignal, layered])

  // Browser/OS back while in layer 3 pops OUR marker state first (no path
  // change) and collapses to layer 2; a second back then reaches a real
  // history entry and the app's own popstate handler takes the page back to
  // layer 1. If entered is already false this is a no-op.
  useEffect(() => {
    if (!layered) return undefined
    const onPopState = (): void => {
      pushedRef.current = false
      setEntered(false)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [layered])

  // Re-choosing this same hub from the main menu (sidebar link, bottom bar
  // icon, "More" sheet) always lands on layer 2 -- even if this hub instance
  // was already mounted and sitting deep in layer 3 in the background.
  // APP_NAVIGATION_EVENT fires on every navigateTo() call, including a
  // repeat click on the page you're already viewing (a plain page/path
  // change alone would miss that repeat-click case). Collapse the UI right
  // away, and if a layer-3 history entry is still outstanding, quietly pop
  // it too so a later hardware-back from layer 2 doesn't waste a press on
  // a stale, same-URL entry.
  useEffect(() => {
    if (!layered || !pageId || typeof window === 'undefined') return undefined
    const onNavigate = (event: Event): void => {
      const detail = (event as CustomEvent<{ page?: string }>).detail
      if (detail?.page !== pageId) return
      setEntered(false)
      if (pushedRef.current) {
        pushedRef.current = false
        window.history.back()
      }
    }
    window.addEventListener(APP_NAVIGATION_EVENT, onNavigate)
    return () => window.removeEventListener(APP_NAVIGATION_EVENT, onNavigate)
  }, [layered, pageId])

  const enter = (id: string): void => {
    onChange(id)
    if (!layered) return
    setEntered(true)
    pushLayer3State()
  }

  const goBack = (): void => {
    if (typeof window !== 'undefined' && pushedRef.current) {
      window.history.back()
      return
    }
    // No corresponding pushState (a push failed, or this instance somehow
    // lost track of it) -- collapse locally rather than risk history.back()
    // leaving the app on a page it never actually pushed.
    setEntered(false)
  }

  if (visible.length <= 1) return <>{children}</>


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

  if (!entered) {
    // Layer 2: compact rectangular tiles, two per row -- a bigger icon
    // with the name under it, rather than the full-width list rows this
    // started as. Two per row means the whole hub is visible without
    // scrolling on a 375-wide phone without adding large empty square areas.
    // The whole card is the target, so a chevron would only add noise. No
    // "Sections" caption here either, for the same reason as the chip row
    // above. The active section's body is intentionally NOT rendered here
    // (see the doc comment at the top of this file).
    return (
      <div className="page-scroll flex-1 space-y-3 p-3 sm:p-4">
        {title ? <h1 className="px-0.5 text-lg font-semibold text-gray-900 dark:text-white">{title}</h1> : null}
        <div className="hub-section-grid grid grid-cols-2 gap-2.5">
          {visible.map((section) => {
            const Icon = section.icon
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => enter(section.id)}
                className="hub-section-tile relative flex min-h-[6.5rem] w-full min-w-0 flex-col items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-center shadow-sm transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 active:scale-[0.98] dark:border-gray-700 dark:bg-gray-900"
              >
                {section.badge ? <span className="absolute right-2 top-2">{section.badge}</span> : null}
                {Icon ? (
                  <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800 ${section.tone || 'text-primary-600 dark:text-primary-400'}`}>
                    <Icon className="h-7 w-7" />
                  </span>
                ) : null}
                <span className="min-w-0 max-w-full">
                  {/* The label wraps rather than truncating: a two-word Khmer
                      section name is wider than its English counterpart and
                      would lose its second half to an ellipsis on a tile this
                      narrow. */}
                  <span className="hub-section-label block break-words text-sm font-semibold leading-snug text-gray-900 dark:text-white">{section.label}</span>
                  {section.description ? <span className="hub-section-description mt-1 block break-words text-[10px] leading-snug text-gray-500 dark:text-gray-400">{section.description}</span> : null}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // Layer 3: the chosen section full-screen. This header is a plain
  // shrink-0 flex sibling ABOVE the section's own scroll container, not
  // position:sticky inside it -- so it is the only top bar that can ever
  // stick, and the section's own internal sticky search/date rows (which
  // stick relative to THEIR OWN nearest scrolling ancestor, unchanged)
  // never have to share a stacking context with it.
  const activeSection = visible.find((section) => section.id === active) || visible[0]
  return (
    <>
      <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 bg-white px-2 py-2 dark:border-gray-700 dark:bg-gray-900">
        <button
          type="button"
          onClick={goBack}
          aria-label={trh('back', 'Back')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1 break-words py-1 text-base font-semibold leading-snug text-gray-900 dark:text-white">{activeSection?.label}</div>
      </div>
      {children}
    </>
  )
}
