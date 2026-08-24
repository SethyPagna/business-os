import { useEffect, useRef, useState } from 'react'
import {
  canStartPull,
  computeIndicatorDistance,
  isAtScrollTop,
  shouldTriggerRefresh,
} from '../../utils/pullToRefresh.ts'

// How long the indicator stays in its "refreshing" (spinning) state after
// a trigger, independent of how long the actual refresh call takes --
// `onRefresh` here is typically a fire-and-forget broadcast (see
// utils/appRefresh.ts's refreshAppData) or a background refetch, neither
// of which resolves in a way that maps to "done spinning" on its own, so
// a fixed minimum spin gives the person visible confirmation that
// something happened rather than an instant flash.
const REFRESH_SPIN_MS = 700

export interface PullToRefreshResult {
  // Current damped indicator distance in px -- 0 when idle/not touching.
  pullDistance: number
  // True while the fixed post-trigger spin (see REFRESH_SPIN_MS) is
  // still playing, regardless of whether the finger has already lifted.
  refreshing: boolean
}

// Attaches the gesture's touchstart/touchmove/touchend listeners to
// `nodeRef`'s element specifically (not `window`) so an unrelated touch
// drag elsewhere in the app -- the Notes widget's own drag handle, a
// lightbox pinch/pan, a modal's own scroll area -- never has to
// coordinate with this listener; touch events bubble normally (unlike
// `scroll`, which doesn't), so `nodeRef` only needs to be an ancestor of
// wherever the finger actually touches down, not the scrollable element
// itself. `getScrollTop` reports the CURRENT scroll offset of whichever
// element is actually scrolling on this page -- for a page whose
// scrollable area is `nodeRef` itself this can just read
// `nodeRef.current.scrollTop`, but for a shell like App.tsx where the
// real scrollable node is a `.page-scroll` div mounted deep inside
// `nodeRef` (or a plain-window-scrolled page like the public catalog),
// the caller supplies whatever lookup is correct for its own layout --
// see globalScroll.ts's getScrollTarget(), already used for this same
// purpose by App.tsx's header-hide effect. `enabled` lets a caller
// suspend the gesture entirely (e.g. while a modal is open over the
// page) without unmounting/remounting the hook.
export function usePullToRefresh(
  nodeRef: { current: HTMLElement | null },
  getScrollTop: () => number,
  onRefresh: () => void,
  enabled = true,
): PullToRefreshResult {
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startYRef = useRef(0)
  const pullingRef = useRef(false)
  const triggeredRef = useRef(false)
  // Kept in a ref (not a dependency) so a caller that passes a fresh
  // `onRefresh` closure every render doesn't force the listeners below to
  // detach/reattach on every render -- only `enabled` toggling should do
  // that.
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh
  const getScrollTopRef = useRef(getScrollTop)
  getScrollTopRef.current = getScrollTop

  useEffect(() => {
    const node = nodeRef.current
    if (!enabled || !node || typeof window === 'undefined') return undefined

    const reset = () => {
      pullingRef.current = false
      triggeredRef.current = false
      setPullDistance(0)
    }

    const handleTouchStart = (event: TouchEvent) => {
      if (refreshing) return
      const touch = event.touches[0]
      if (!touch) return
      // Only a gesture starting from the very top of the page's actual
      // scroll position can be a pull -- an already-scrolled-down page
      // should let the touch behave as an ordinary scroll.
      if (!isAtScrollTop(getScrollTopRef.current())) return
      startYRef.current = touch.clientY
      pullingRef.current = true
      triggeredRef.current = false
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (!pullingRef.current) return
      const touch = event.touches[0]
      if (!touch) return
      const rawDelta = touch.clientY - startYRef.current
      if (!canStartPull(getScrollTopRef.current(), rawDelta)) {
        // The finger reversed upward, or the node scrolled out from under
        // the gesture (e.g. content loaded above it) -- stop tracking
        // rather than let the indicator get stuck mid-travel.
        reset()
        return
      }
      // Prevent the native scroll/bounce only once an actual pull is in
      // progress -- this is exactly why these listeners are attached
      // natively with {passive:false} rather than as JSX onTouch* props,
      // which React may register as passive and silently ignore
      // preventDefault() on.
      event.preventDefault()
      const distance = computeIndicatorDistance(rawDelta)
      setPullDistance(distance)
      triggeredRef.current = shouldTriggerRefresh(distance)
    }

    const handleTouchEnd = () => {
      if (!pullingRef.current) return
      const wasTriggered = triggeredRef.current
      pullingRef.current = false
      triggeredRef.current = false
      if (wasTriggered) {
        setRefreshing(true)
        setPullDistance(0)
        onRefreshRef.current()
        window.setTimeout(() => setRefreshing(false), REFRESH_SPIN_MS)
      } else {
        setPullDistance(0)
      }
    }

    node.addEventListener('touchstart', handleTouchStart, { passive: true })
    node.addEventListener('touchmove', handleTouchMove, { passive: false })
    node.addEventListener('touchend', handleTouchEnd, { passive: true })
    node.addEventListener('touchcancel', reset, { passive: true })
    return () => {
      node.removeEventListener('touchstart', handleTouchStart)
      node.removeEventListener('touchmove', handleTouchMove)
      node.removeEventListener('touchend', handleTouchEnd)
      node.removeEventListener('touchcancel', reset)
    }
  }, [nodeRef, enabled, refreshing])

  return { pullDistance, refreshing }
}
