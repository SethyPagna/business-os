import { compareInitialKeys } from './initials.ts'

// The pure kernel behind AlphaIndexRail -- the vertical A-Z rail used by
// admin Products/POS and (since the storefront's "Jump to brand" grid was
// replaced) by the public catalog.
//
// It lives outside the component because every decision the rail makes is a
// data decision: which keys it renders and in what order, which key a Y
// coordinate lands on, which key a scrub falls back to, where the keyboard's
// single tab stop sits, and -- for the storefront -- which brand-initial
// filter a letter click produces. The component keeps only React state and
// DOM measurement.

/** The catch-all bucket produced by getInitialKey() for anything that isn't a
 * letter/digit/Khmer character. It sorts after everything else. */
export const RAIL_SPECIAL_KEY = '#'

/** The "no brand initial selected" filter value shared with the server's
 * `initial` query param (see cloudflare/src/routes/portal.ts). */
export const RAIL_ALL_KEY = 'all'

export type RailFocusMove = 'up' | 'down' | 'first' | 'last'

/** The keys the rail actually renders: de-duplicated, ordered the way every
 * other initials surface in the app orders them, with `#` pinned last. A
 * non-array or junk payload degrades to an empty rail rather than throwing --
 * the facet counts come from the server. */
export function sortRailKeys(letters: unknown): string[] {
  if (!Array.isArray(letters)) return []
  const unique = new Set<string>()
  for (const letter of letters) {
    if (typeof letter !== 'string') continue
    const trimmed = letter.trim()
    if (trimmed) unique.add(trimmed)
  }
  const rest = [...unique].filter((letter) => letter !== RAIL_SPECIAL_KEY).sort(compareInitialKeys)
  return unique.has(RAIL_SPECIAL_KEY) ? [...rest, RAIL_SPECIAL_KEY] : rest
}

/** A scrub can land between two rendered keys (the rail only draws keys that
 * have data). Fall back to the closest one that does, preferring the earlier
 * key on a tie so the result reads in list order. */
export function nearestRailKey(items: readonly string[], letter: string | null | undefined): string | null {
  if (!Array.isArray(items) || items.length === 0) return null
  if (typeof letter !== 'string' || !letter) return null
  if (items.includes(letter)) return letter
  let insertAt = items.length
  for (let index = 0; index < items.length; index++) {
    if (compareInitialKeys(items[index], letter) > 0) {
      insertAt = index
      break
    }
  }
  return items[insertAt - 1] ?? items[insertAt] ?? null
}

/** Which rendered key a pointer at `offsetY` (relative to the rail's own
 * border-box top) is over, as an index. Returns -1 when there is nothing to
 * hit or the rail has not been measured yet. Clamps, so a drag that runs off
 * either end holds the first/last key instead of losing the gesture.
 *
 * The mapping is onto the LETTER COLUMN, not onto the rail's box. Those are
 * not the same rectangle: the rail is capped (`max-h-[60vh]` on the
 * storefront, `max-h-[70vh]` beside the admin sidebar) while its entries are
 * fixed-height and shrink-0, so a long enough alphabet makes the column
 * taller than the box -- and once the box scrolls, the column also slides
 * under it. Dividing the box height into `itemCount` slices in either case
 * hands back a key several rows from the finger (at 28 entries in a 400px
 * box, pressing the 6th selects the 4th).
 *
 * `contentTop` is the first entry's top and `contentHeight` the distance from
 * that to the last entry's bottom, both measured from the same origin as
 * `offsetY`, so scroll position, padding and the pill's border are already
 * inside them. They default to the box, which is what the geometry collapses
 * to before the entries have ever been laid out. */
export function railIndexAtOffset(
  itemCount: number,
  offsetY: number,
  height: number,
  contentTop = 0,
  contentHeight = height,
): number {
  if (!Number.isFinite(itemCount) || itemCount <= 0) return -1
  if (!Number.isFinite(height) || height <= 0) return -1
  const span = Number.isFinite(contentHeight) && contentHeight > 0 ? contentHeight : height
  const top = Number.isFinite(contentTop) ? contentTop : 0
  const clampedOffset = Math.min(Math.max((Number(offsetY) || 0) - top, 0), span - 1)
  const index = Math.floor((clampedOffset / span) * itemCount)
  return Math.min(Math.max(index, 0), itemCount - 1)
}

/** The storefront's letter -> brand-initial-filter mapping.
 *
 * This is the contract the rail inherited verbatim from the two button lists
 * it replaced (`effectiveInitialFilter === item.key ? 'all' : item.key`):
 * a letter selects that brand group, the same letter again clears back to
 * All, and the rail's own All entry always clears. A missed hit-test (no
 * key) must leave the current filter alone rather than clearing it. */
export function resolveBrandJump(currentFilter: string, letter: string): string {
  if (typeof letter !== 'string' || !letter) return currentFilter
  if (letter === RAIL_ALL_KEY) return RAIL_ALL_KEY
  return letter === currentFilter ? RAIL_ALL_KEY : letter
}

/** Where the rail's single tab stop sits: on the selected key when it is
 * still rendered, otherwise on the first key. A stale selection (the letter
 * dropped off the facet after a search) must not strand the tab stop. */
export function railFocusKey(items: readonly string[], activeKey: string | null | undefined): string | null {
  if (!Array.isArray(items) || items.length === 0) return null
  if (typeof activeKey === 'string' && items.includes(activeKey)) return activeKey
  return items[0] ?? null
}

/** Arrow/Home/End movement inside the rail. Clamps at both ends rather than
 * wrapping: a rail is a spatial control, and wrapping from Z back to A reads
 * as the list having jumped. */
export function nextRailFocusKey(
  items: readonly string[],
  currentKey: string | null | undefined,
  move: RailFocusMove,
): string | null {
  if (!Array.isArray(items) || items.length === 0) return null
  if (move === 'first') return items[0] ?? null
  if (move === 'last') return items[items.length - 1] ?? null
  const index = typeof currentKey === 'string' ? items.indexOf(currentKey) : -1
  if (index === -1) return move === 'down' ? items[0] ?? null : items[items.length - 1] ?? null
  const next = move === 'down' ? index + 1 : index - 1
  return items[Math.min(Math.max(next, 0), items.length - 1)] ?? null
}
