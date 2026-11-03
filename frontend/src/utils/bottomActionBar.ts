import { useEffect, useSyncExternalStore } from 'react'

/**
 * A page whose primary action is pinned to the bottom of the screen (the till's Complete Sale) declares it while it is
 * the page in use. Floating things then keep off it: the install band is not offered at all (`declared`), and the
 * scroll buttons step aside while the bar can actually be seen (`visible`: false on the phone's Products tab).
 */
let declaredBars = 0
let visibleBars = 0
const listeners = new Set<() => void>()
const changed = () => { for (const listener of listeners) listener() }

export function subscribeBottomActionBar(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export const hasBottomActionBar = (): boolean => declaredBars > 0

export function useBottomActionBar({ active, visible }: { active: boolean; visible: boolean }): void {
  useEffect(() => {
    if (!active) return undefined
    declaredBars += 1
    changed()
    return () => { declaredBars -= 1; changed() }
  }, [active])
  const showing = active && visible
  useEffect(() => {
    if (!showing) return undefined
    visibleBars += 1
    changed()
    return () => { visibleBars -= 1; changed() }
  }, [showing])
}

/** True while a declared bottom bar is on screen. */
export function useBottomActionBarVisible(): boolean {
  return useSyncExternalStore(subscribeBottomActionBar, () => visibleBars > 0, () => false)
}
