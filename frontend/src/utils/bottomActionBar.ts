import { useEffect, useSyncExternalStore, type RefObject } from 'react'

/** Read by floats that dock at the bottom edge: how much of the screen bottom the page's pinned primary action (and what sits under it) covers. */
export const BOTTOM_ACTION_BAR_CLEARANCE_VAR = '--bottom-action-bar-clearance'

/**
 * Pages whose primary action is pinned to the bottom of the screen (the till's Complete Sale). Listed by page id
 * because on a cold open the page's own chunk is not loaded yet: the shell can already keep the install band off the
 * first paint, which a declaration made by the page itself could not.
 */
const PAGES_WITH_BOTTOM_ACTION_BAR: readonly string[] = ['pos']

export const pageHasBottomActionBar = (page: string | undefined): boolean => page !== undefined && PAGES_WITH_BOTTOM_ACTION_BAR.includes(page)

let visibleBars = 0
const listeners = new Set<() => void>()
const changed = () => { for (const listener of listeners) listener() }
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * The page calls this with its pinned primary action. While `visible` (it can actually be seen: not on a phone's other
 * tab) the scroll buttons step aside and the clearance variable says where the action starts, so docked floats sit above it.
 */
export function useBottomActionBar({ visible, actionRef }: { visible: boolean; actionRef: RefObject<HTMLElement | null> }): void {
  useEffect(() => {
    const action = actionRef.current
    if (!visible || !action) return undefined
    const root = document.documentElement
    const publish = () => root.style.setProperty(BOTTOM_ACTION_BAR_CLEARANCE_VAR, `${Math.max(0, Math.ceil(window.innerHeight - action.getBoundingClientRect().top))}px`)
    publish()
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(publish) : null
    resizeObserver?.observe(action)
    if (action.parentElement) resizeObserver?.observe(action.parentElement)
    window.addEventListener('resize', publish)
    visibleBars += 1
    changed()
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', publish)
      root.style.removeProperty(BOTTOM_ACTION_BAR_CLEARANCE_VAR)
      visibleBars -= 1
      changed()
    }
  }, [visible, actionRef])
}

/** True while a page's pinned bottom action is on screen. */
export function useBottomActionBarVisible(): boolean {
  return useSyncExternalStore(subscribe, () => visibleBars > 0, () => false)
}
