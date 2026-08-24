import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import { PULL_TO_REFRESH_CONSTANTS } from '../../utils/pullToRefresh.ts'

interface PullToRefreshIndicatorProps {
  // Current damped indicator distance in px, from usePullToRefresh's own
  // return value -- 0 when idle. Drives both the vertical offset and the
  // icon's rotation, so the indicator visibly "arrives" as the finger gets
  // closer to the trigger threshold rather than just popping in at 100%.
  pullDistance: number
  // True while the fixed post-trigger spin is playing (see
  // usePullToRefresh's REFRESH_SPIN_MS) -- switches the icon to a
  // continuous spin instead of a drag-linked rotation.
  refreshing: boolean
}

const { REFRESH_TRIGGER_DISTANCE_PX, MAX_INDICATOR_DISTANCE_PX } = PULL_TO_REFRESH_CONSTANTS

// Purely presentational -- absolutely positioned inside App.tsx's <main>
// (which is given `relative` specifically so this can anchor to it), never
// affects layout/flow of the page content underneath it. Hidden entirely
// (not just visually empty) when there's nothing to show, so it can never
// intercept a click/tap on the content behind it.
function PullToRefreshIndicator({ pullDistance, refreshing }: PullToRefreshIndicatorProps) {
  if (!refreshing && pullDistance <= 0) return null

  const clampedDistance = Math.min(MAX_INDICATOR_DISTANCE_PX, Math.max(0, pullDistance))
  const progress = Math.min(1, clampedDistance / REFRESH_TRIGGER_DISTANCE_PX)
  const translateY = refreshing ? 12 : clampedDistance - 28
  const rotation = refreshing ? 0 : progress * 360

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center"
      style={{
        transform: `translateY(${translateY}px)`,
        opacity: refreshing ? 1 : progress,
        transition: refreshing ? 'transform 150ms ease-out' : 'none',
      }}
      aria-hidden="true"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-md ring-1 ring-black/5 dark:bg-gray-800">
        <RefreshCw
          className={`h-4 w-4 text-gray-500 dark:text-gray-300 ${refreshing ? 'animate-spin' : ''}`}
          style={refreshing ? undefined : { transform: `rotate(${rotation}deg)` }}
        />
      </div>
    </div>
  )
}

export default PullToRefreshIndicator
