// Compact ("pages" mode) home navigation: a 2-column grid of section TILES
// where a tapped tile unfolds its own sections as a 2-column sub-grid placed
// under the ROW that tile sits in -- the accordion shape of the owner's
// reference images #1/#2 (docs/fleet/2026-09-05-report-reference-designs.md
// lines 34-35), layout only.
//
// The placement rule is the whole reason this lives in its own module: the
// sub-grid must open under the tile's ROW, not immediately after the tile.
// Inserting it right after the tile is the obvious implementation and it is
// wrong for every tile in column 0 -- it would cut that row in half and push
// the tile's own row partner down below the sub-grid. Because that difference
// is invisible in a source-shape check, the placement is a pure function with
// behavioural tests (tests/mobileHomeTiles.test.ts).
//
// The tile grid renders 2 columns (Sidebar.tsx uses the static Tailwind
// `grid-cols-2` / `col-span-2` classes that pair with this default).

export const MOBILE_HOME_TILE_COLUMNS = 2

export type HomeTileItem = { id: string }

export type HomeTileEntry<Item extends HomeTileItem, Section> =
  | { kind: 'tile'; key: string; item: Item; expanded: boolean; hasSections: boolean }
  | { kind: 'sections'; key: string; ownerId: string; sections: Section[] }

/** The DOM id of an unfolded tile's sub-grid. One authority so the tile's
 *  `aria-controls` and the panel's `id` can never drift apart. */
export function mobileHomeSectionsPanelId(ownerId: string): string {
  return `mobile-sections-${ownerId}`
}

/**
 * Flatten the tile list into the exact render order of the home grid.
 *
 * - Tiles keep the order they were given (the account's own nav order).
 * - At most ONE tile is unfolded (`openId`); an id that is not in `items`, or
 *   whose tile has no sections, unfolds nothing.
 * - The unfolded tile's sections are emitted as a single full-width entry
 *   directly after the last tile of the row that holds it, so the tiles below
 *   move down together and the open tile's row stays intact.
 */
export function buildMobileHomeLayout<Item extends HomeTileItem, Section>(
  items: readonly Item[],
  openId: string | null | undefined,
  sectionsOf: (id: string) => Section[],
  columns: number = MOBILE_HOME_TILE_COLUMNS,
): Array<HomeTileEntry<Item, Section>> {
  const perRow = Math.max(1, Math.floor(columns) || 1)
  const openIndex = openId ? items.findIndex((item) => item.id === openId) : -1
  const openSections = openIndex >= 0 ? sectionsOf(items[openIndex].id) : []
  // A tile with no sections is a plain destination: it navigates, it never
  // unfolds (mobileGroupAction in hubNavigation.ts makes the same call for
  // the tap itself).
  const unfoldedIndex = openSections.length > 0 ? openIndex : -1
  const panelAfter = unfoldedIndex >= 0
    ? Math.min(items.length, (Math.floor(unfoldedIndex / perRow) + 1) * perRow)
    : -1

  const entries: Array<HomeTileEntry<Item, Section>> = []
  items.forEach((item, index) => {
    entries.push({
      kind: 'tile',
      key: item.id,
      item,
      expanded: index === unfoldedIndex,
      hasSections: index === unfoldedIndex ? true : sectionsOf(item.id).length > 0,
    })
    if (panelAfter >= 0 && index + 1 === panelAfter) {
      entries.push({
        kind: 'sections',
        key: mobileHomeSectionsPanelId(items[unfoldedIndex].id),
        ownerId: items[unfoldedIndex].id,
        sections: openSections,
      })
    }
  })
  return entries
}
