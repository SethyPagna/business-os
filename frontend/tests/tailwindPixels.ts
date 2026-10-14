// Reads sizes from the Tailwind classes a component renders (the in-memory DOM has no layout). Only plain spacing utilities
// are understood (w-11, -m-1.5, gap-2, p-3); anything else answers null. One step of the default scale is 4 px.

export const classesOf = (className: string): string[] => className.split(/\s+/).filter(Boolean)

export function pixels(token: string): number | null {
  const match = /^(-?)(?:min-)?(?:(?:[hwmp][xytrbl]?|gap(?:-[xy])?))-(px|\d+(?:\.\d+)?)$/.exec(token)
  if (!match) return null
  const size = match[2] === 'px' ? 1 : Number(match[2]) * 4
  return match[1] ? -size : size
}

/** The largest width or height the classes ask for on one axis (w-11 is 44). */
export function dimension(classes: string[], axis: 'w' | 'h'): number {
  const sizes = classes.filter((name) => new RegExp(`^(?:min-)?${axis}-`).test(name)).map(pixels).filter((value): value is number => value !== null)
  return Math.max(0, ...sizes)
}

/** How many px a negative margin pulls the box in on this axis, both sides together. */
export function bleed(classes: string[], axis: 'x' | 'y'): number {
  let total = 0
  for (const name of classes) {
    const px = pixels(name)
    const side = /^-m([xytrbl]?)-/.exec(name)?.[1]
    if (px === null || px >= 0 || side === undefined) continue
    if (side === '') total += 2 * -px
    else if (axis === 'x' && 'xlr'.includes(side)) total += side === 'x' ? 2 * -px : -px
    else if (axis === 'y' && 'ytb'.includes(side)) total += side === 'y' ? 2 * -px : -px
  }
  return total
}

/** How far a negative margin pulls the box out on ONE side, in px (0 when it has none there). */
export function bleedOnSide(classes: string[], side: 'l' | 'r' | 't' | 'b'): number {
  let total = 0
  for (const name of classes) {
    const px = pixels(name)
    const group = /^-m([xytrbl]?)-/.exec(name)?.[1]
    if (px === null || px >= 0 || group === undefined) continue
    const sides = group === '' ? 'lrtb' : group === 'x' ? 'lr' : group === 'y' ? 'tb' : group
    if (sides.includes(side)) total += -px
  }
  return total
}

/** The `gap-*` (or `gap-x-*`) the classes set, in px. */
export function gapPx(classes: string[]): number {
  return Math.max(0, ...classes.filter((name) => /^gap(?:-x)?-/.test(name)).map(pixels).filter((value): value is number => value !== null))
}

/** How many columns `grid-cols-N`, `sm:grid-cols-N` and `min-[Wpx]:grid-cols-N` give at this viewport width. */
export function gridColumns(classes: string[], viewport: number): number {
  let columns = 1
  let from = -1
  for (const name of classes) {
    const match = /^(?:(sm|min-\[(\d+)px\]):)?grid-cols-(\d+)$/.exec(name)
    if (!match) continue
    const minWidth = match[1] === undefined ? 0 : match[1] === 'sm' ? 640 : Number(match[2])
    if (viewport >= minWidth && minWidth >= from) { columns = Number(match[3]); from = minWidth }
  }
  return columns
}

/** Horizontal padding on both sides together, from p-N, px-N, pl-N and pr-N. */
export function horizontalPadding(classes: string[]): number {
  let left = 0
  let right = 0
  for (const name of classes) {
    const px = pixels(name)
    const group = /^p([xylr]?)-/.exec(name)?.[1]
    if (px === null || group === undefined || group === 'y') continue
    if (group === '' || group === 'x') { left = px; right = px }
    else if (group === 'l') left = px
    else if (group === 'r') right = px
  }
  return left + right
}
