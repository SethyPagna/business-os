// Pure gesture-math helpers for the swipe-down-to-refresh interaction (see
// components/shared/usePullToRefresh.ts, the hook that wires these into
// real touch listeners, and App.tsx, the one caller). Kept dependency-free
// and side-effect-free on purpose so they're trivially testable without a
// DOM or fake touch events -- the hook itself is the only place that
// actually touches `document`/`window`.

// A gesture can only be considered "at the top" (and therefore eligible to
// start a pull) within this many px of true 0 -- not a strict === 0 check,
// since some scroll containers report a sub-pixel resting value (e.g.
// 0.4px) after momentum scrolling settles, which would otherwise wrongly
// block every pull that follows a native bounce/rubber-band scroll.
const AT_TOP_THRESHOLD_PX = 2

// Raw finger-travel distance (px) required before the gesture is considered
// a deliberate pull rather than an accidental brush -- avoids the indicator
// flickering in on tiny incidental touches.
const PULL_START_THRESHOLD_PX = 4

// Rubber-band damping factor: raw finger distance is scaled down before
// becoming the indicator's on-screen travel, so a long drag doesn't send
// the indicator flying off past where a refresh spinner would ever sit.
// 0.5 means the indicator moves half as far as the finger for every
// additional px past the start threshold -- a simple linear damping,
// deliberately not an eased/exponential curve, since this value only
// needs to feel "resistant", not physically exact.
const PULL_DAMPING_FACTOR = 0.5

// How far the indicator has to travel (already-damped px, not raw finger
// px) before lifting the finger counts as a trigger rather than a cancel.
const REFRESH_TRIGGER_DISTANCE_PX = 64

// The indicator never travels further than this regardless of how far the
// finger keeps dragging, so the gesture has a firm, predictable ceiling.
const MAX_INDICATOR_DISTANCE_PX = 96

// True when the page's current scroll offset is close enough to the top
// that a downward drag from here should be interpreted as "pull to
// refresh" rather than "just scrolling".
export function isAtScrollTop(scrollTop: number): boolean {
  return Number(scrollTop || 0) <= AT_TOP_THRESHOLD_PX
}

// Whether an in-progress touch (already confirmed to have started at the
// top) should keep being tracked as a pull. `rawDelta` is
// touch.clientY - startY -- positive means the finger has moved down the
// screen. A pull is only "live" while the page is still at the top AND the
// finger is still net-downward past the noise threshold; either condition
// failing (scrolled away, or the finger reversed back up past the start
// point) means the caller should abandon the gesture rather than let the
// indicator get stuck mid-travel.
export function canStartPull(scrollTop: number, rawDelta: number): boolean {
  if (!isAtScrollTop(scrollTop)) return false
  return rawDelta > -PULL_START_THRESHOLD_PX
}

// Whether the gesture has actually become a downward pull -- i.e. whether the
// hook is now entitled to call preventDefault() and take the scroll away from
// the browser.
//
// Deliberately NOT canStartPull. Reported as "the public storefront cannot be
// scrolled on my phone": the hook used to suppress native scrolling on the
// FIRST touchmove of anything canStartPull accepted, and canStartPull accepts
// the whole jitter band (-4px..0) precisely so a wobbling finger doesn't
// abandon a pull already under way. A browser cancels native scrolling for the
// remainder of a touch sequence as soon as one cancelable touchmove is
// prevented, and WebKit dispatches 1-3px moves at the start of a swipe -- so
// an ordinary upward swipe from the top of the page had its scroll eaten
// before any pull existed, and the page looked frozen at the top.
//
// Tracking ("keep following this gesture") and suppression ("the finger has
// pulled down past the noise threshold") are separate decisions, and
// suppression is the strictly narrower one. It starts exactly where
// computeIndicatorDistance starts producing a visible pull, so the scroll is
// only ever taken once there is something on screen to justify it.
export function shouldBlockNativeScroll(rawDelta: number): boolean {
  return Number(rawDelta || 0) > PULL_START_THRESHOLD_PX
}

// Maps raw finger-travel distance to the damped on-screen indicator
// distance, clamped to MAX_INDICATOR_DISTANCE_PX. Negative or
// below-threshold raw deltas produce 0 (no visible indicator yet).
export function computeIndicatorDistance(rawDelta: number): number {
  const usable = Math.max(0, Number(rawDelta || 0) - PULL_START_THRESHOLD_PX)
  const damped = usable * PULL_DAMPING_FACTOR
  return Math.min(MAX_INDICATOR_DISTANCE_PX, damped)
}

// Whether the current (already-damped) indicator distance is far enough
// that releasing the finger right now should fire a refresh.
export function shouldTriggerRefresh(distance: number): boolean {
  return Number(distance || 0) >= REFRESH_TRIGGER_DISTANCE_PX
}

export const PULL_TO_REFRESH_CONSTANTS = {
  AT_TOP_THRESHOLD_PX,
  PULL_START_THRESHOLD_PX,
  PULL_DAMPING_FACTOR,
  REFRESH_TRIGGER_DISTANCE_PX,
  MAX_INDICATOR_DISTANCE_PX,
}
