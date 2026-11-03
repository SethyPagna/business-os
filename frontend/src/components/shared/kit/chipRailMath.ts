// Pure geometry of ChipRail, kept free of React and the DOM so a plain node test can pin it.

export const EDGE_SLACK_PX = 2

// Only a RailChip can be the open choice: a pressed button that is not a chip (the Stats toggle beside the date presets)
// must never steal the scroll-into-view from the selected preset.
export const RAIL_SELECTED_SELECTOR = '.chip-rail-item[aria-pressed="true"], .chip-rail-item[aria-selected="true"]'

export type RailEdges = { start: boolean; end: boolean }

/** Which edges still hide content: a fade is drawn only on a side the row can scroll toward. */
export function railEdges(scrollLeft: number, scrollWidth: number, clientWidth: number): RailEdges {
  return { start: scrollLeft > EDGE_SLACK_PX, end: scrollLeft < scrollWidth - clientWidth - EDGE_SLACK_PX }
}

/** The scrollLeft that brings a chip fully into view, clear of the fade; unchanged when it already is. */
export function railRevealTarget(scrollLeft: number, clientWidth: number, chipLeft: number, chipWidth: number, fade: number): number {
  const chipRight = chipLeft + chipWidth
  if (chipLeft < scrollLeft + fade) return Math.max(0, chipLeft - fade)
  if (chipRight > scrollLeft + clientWidth - fade) return chipRight - clientWidth + fade
  return scrollLeft
}
