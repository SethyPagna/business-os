// Shared row-selection helpers for pages with a select-all / bulk-action
// checkbox column (Contacts, Inventory, Returns, Sales -- see each page's
// `useEffect` that calls pruneSelectionToVisibleIds whenever its visible
// row/section id list changes). One implementation so every page prunes
// stale selection the same way, instead of each page re-implementing it
// slightly differently.

/**
 * Removes ids from a selection Set that are no longer in the current
 * visible/valid id list. A selection (a Set of ids kept in React state)
 * goes stale whenever the underlying row list changes -- a filter
 * narrows the results, a page reloads, a bulk action removes rows -- and
 * without pruning, a previously-selected id that's no longer visible
 * would stay selected: invisible to the user, but still included the
 * next time a bulk action runs. Pruning after every row-list change is
 * what keeps "select all" and bulk actions scoped to what's actually on
 * screen.
 *
 * Works for both numeric ids (products, contacts) and string ids
 * (collapsed-section keys), since callers use both.
 */
export function pruneSelectionToVisibleIds<T>(
  current: Iterable<T> | null | undefined,
  validIds: Iterable<T> | null | undefined,
): Set<T> {
  const valid = validIds instanceof Set ? validIds : new Set(validIds || [])
  const next = new Set<T>()
  for (const id of current || []) {
    if (valid.has(id)) next.add(id)
  }
  return next
}
