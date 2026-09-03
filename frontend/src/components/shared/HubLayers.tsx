import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'

// Layered hub navigation (Sep 3 2026, lane fx/reports-redesign).
//
// A hub that stacks many sections into one long scroll is unusable on a
// phone. In LAYERED mode a hub shows one layer at a time:
//
//   layer 1  the hub, listing its sections
//   layer 2  the chosen section's own list of sub-sections (if it has any)
//   layer 3  one full-screen sub-section with a back header
//
// and the device back gesture collapses exactly ONE layer instead of leaving
// the page. The mode is a user preference (Settings -> Appearance ->
// ui_section_layout) and applies only below `maxWidth`, so a desktop keeps
// the stacked layout it has always had. Default is 'stacked': nobody's
// current experience changes until they ask for it.
//
// BACK HANDLING. Opening a layer pushes a history entry whose PATHNAME IS
// UNCHANGED -- only the hash moves (#reports/customer). That matters: the
// app's own popstate listener (AppContext) resolves the page from the
// pathname, so an unchanged pathname makes a layer pop a no-op for page
// routing, and this hook is free to interpret it as "close one layer".
// The hash is the record of which layers are open, so the back button, the
// Android gesture and the on-screen chevron all take exactly one step, and
// a forward gesture re-enters the layer it just left.
//
// The hub keeps owning its state. This component never touches the date
// range or filters -- it only decides which layer is on screen -- so
// collapsing a layer cannot lose a range the user set two layers up.

export type SectionLayout = 'stacked' | 'layered'

const HISTORY_KEY = '__bosHubLayer'

export function normalizeSectionLayout(raw: unknown): SectionLayout {
  return String(raw || '').trim().toLowerCase() === 'layered' ? 'layered' : 'stacked'
}

/**
 * True when layered presentation should apply right now: the user asked for
 * it AND the viewport is narrow enough to need it. Re-evaluates on resize
 * and on rotation, so turning a phone does not strand the user in a layer.
 */
export function useLayeredSections(layout: SectionLayout, maxWidth = 768): boolean {
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia(`(max-width: ${maxWidth - 1}px)`).matches
  })
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mq = window.matchMedia(`(max-width: ${maxWidth - 1}px)`)
    const onChange = () => setNarrow(mq.matches)
    onChange()
    // addEventListener is not on MediaQueryList in older WebKit; both paths
    // are kept so an old iPad does not silently stop updating.
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    }
    mq.addListener(onChange)
    return () => mq.removeListener(onChange)
  }, [maxWidth])
  return layout === 'layered' && narrow
}

/**
 * The layers the URL says are open. The hash is the record -- pushing a
 * layer writes `#reports/overview` -- so back, FORWARD and a reload all
 * resolve to the same stack. Reading the depth out of history.state instead
 * only ever let the stack shrink, which desynchronised the address bar from
 * the screen after a single forward gesture.
 */
function stackFromLocation(baseHash: string): string[] {
  if (typeof window === 'undefined') return []
  const raw = window.location.hash.replace(/^#/, '')
  if (!raw) return []
  const parts = raw.split('/').filter(Boolean)
  if (!baseHash) return parts
  return parts[0] === baseHash ? parts.slice(1) : []
}

/**
 * A layer stack whose depth the browser's back gesture pops one step at a
 * time. `open(id)` pushes a layer, `back()` pops one, and a real popstate
 * (button or gesture) is resolved from the URL hash, so back and forward
 * both land where the user expects.
 */
export function useLayerStack(active: boolean, baseHash = ''): {
  stack: string[]
  open: (id: string) => void
  back: () => void
  reset: () => void
} {
  const [stack, setStack] = useState<string[]>([])
  const stackRef = useRef<string[]>([])
  stackRef.current = stack

  // Leaving layered mode (preference off, or the window widened) must not
  // strand the user inside a layer that is no longer rendered.
  useEffect(() => { if (!active) setStack([]) }, [active])

  useEffect(() => {
    if (!active || typeof window === 'undefined') return undefined
    const onPop = () => {
      // Whatever the URL now says is open, is open. Back collapses one
      // layer, forward re-enters the one it left, and neither can leave the
      // address bar describing a screen the user is not looking at.
      setStack(stackFromLocation(baseHash))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [active, baseHash])

  const open = useCallback((id: string) => {
    setStack((current) => {
      const next = [...current, id]
      if (typeof window !== 'undefined') {
        const state = { ...(window.history.state || {}), [HISTORY_KEY]: next.length }
        // Hash only -- the pathname must not change, or the app's page
        // router would treat a layer as a page navigation.
        const hash = `#${[baseHash, ...next].filter(Boolean).join('/')}`
        window.history.pushState(state, '', `${window.location.pathname}${window.location.search}${hash}`)
      }
      return next
    })
  }, [baseHash])

  const back = useCallback(() => {
    if (stackRef.current.length === 0) return
    // Delegate to the browser so the on-screen back button and the device
    // gesture produce the SAME history movement; popstate then re-reads
    // the hash and renders whatever it now names.
    if (typeof window !== 'undefined') window.history.back()
    else setStack((c) => c.slice(0, -1))
  }, [])

  const reset = useCallback(() => { setStack([]) }, [])

  return { stack, open, back, reset }
}

export interface LayerListItem {
  id: string
  label: string
  hint?: string
  icon?: ReactNode
}

/** The section list a layer shows: big tap targets, one per row. */
export function LayerList({ items, onOpen }: { items: LayerListItem[]; onOpen: (id: string) => void }) {
  return (
    <ul className="min-w-0 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onOpen(item.id)}
            className="flex w-full min-w-0 items-center gap-2.5 px-3 py-3 text-left transition hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-slate-800 dark:active:bg-slate-700"
          >
            {item.icon ? <span className="shrink-0 text-slate-500 dark:text-slate-400">{item.icon}</span> : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">{item.label}</span>
              {item.hint ? <span className="block truncate text-xs text-slate-400 dark:text-slate-500">{item.hint}</span> : null}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** The header a full-screen layer shows: back affordance + the layer title. */
export function LayerHeader({ title, onBack, backLabel, children }: {
  title: ReactNode
  onBack: () => void
  backLabel: string
  children?: ReactNode
}) {
  return (
    <div className="sticky top-0 z-20 -mx-1 flex min-w-0 items-center gap-1.5 border-b border-slate-200 bg-gray-50/95 px-1 py-1.5 backdrop-blur dark:border-slate-800 dark:bg-gray-900/95">
      <button
        type="button"
        onClick={onBack}
        aria-label={backLabel}
        className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <ChevronLeft className="h-4 w-4" />
        <span className="hidden sm:inline">{backLabel}</span>
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</div>
      {children}
    </div>
  )
}
