// categoryGrouping.ts
//
// Turns a flat list of category names into a two-level "Main - Sub" tree
// for the filter UI. Categories are plain strings everywhere in this app
// (see lookups.ts / ManageCategoriesModal) -- there is no separate parent/
// child column, and this deliberately doesn't add one. Instead it treats
// " - " (space-flexible on both sides) as the naming convention that marks
// a subcategory: "Haircare - Shampoo" belongs under a "Haircare" group;
// "Haircare" on its own (no " - ") is a plain, ungrouped category and
// renders as a single flat row exactly as it always has.
//
// This module only builds the tree and lists which real category values a
// group represents -- it never decides what's "selected" or writes to any
// filter state. Each page (Products/Inventory/POS/public portal) keeps its
// own filter-state shape (a Set, a CSV string, etc.) and wires this tree
// into its own FilterMenu section via buildHierarchicalCategoryFilterOptions
// in components/shared/CategoryFilterOptions.tsx.

export interface CategoryGroupChild {
  /** The full, real category name used for filtering/matching, e.g. "Haircare - Shampoo". */
  value: string
  /** Just the sub part, for display, e.g. "Shampoo". */
  label: string
}

export interface CategoryGroup {
  /** Normalized grouping key (lowercased, trimmed main label). */
  key: string
  /** Display label for the parent/main row, e.g. "Haircare". */
  mainLabel: string
  /**
   * Set when "Haircare" is ALSO a real category value on its own (some
   * products filed directly under the bare main category, not any
   * subcategory) -- selectable in addition to being the group's parent.
   * `null` when every product under this main label has a subcategory.
   */
  ownValue: string | null
  /** Subcategories under this main label, sorted alphabetically by their sub label. */
  children: CategoryGroupChild[]
}

// Splits "Haircare - Shampoo" into { main: "Haircare", sub: "Shampoo" }.
// Requires a real "Main - Sub" shape (both sides non-empty) so a category
// that merely contains a hyphen mid-word ("Eco-Friendly") isn't
// misinterpreted as a group -- that only happens with the space-padded
// " - " separator, matching how these compound category names are
// actually authored in Manage Categories.
function splitCategoryName(name: string): { main: string; sub: string | null } {
  const trimmed = String(name || '').trim()
  const match = trimmed.match(/^(.+?)\s+-\s+(.+)$/)
  if (!match) return { main: trimmed, sub: null }
  const main = match[1].trim()
  const sub = match[2].trim()
  if (!main || !sub) return { main: trimmed, sub: null }
  return { main, sub }
}

/**
 * Groups a flat list of category names into main/sub clusters. Categories
 * with no " - " become their own single-item group (children: []) so
 * callers can render them as an unchanged flat row; categories that share
 * a "Main - " prefix collapse into one group with that main label as the
 * parent and each distinct suffix as a child.
 */
export function buildCategoryGroups(categoryNames: readonly string[]): CategoryGroup[] {
  const groups = new Map<string, CategoryGroup>()
  const order: string[] = []

  for (const raw of categoryNames || []) {
    const name = String(raw || '').trim()
    if (!name) continue
    const { main, sub } = splitCategoryName(name)
    const key = main.toLowerCase()
    let group = groups.get(key)
    if (!group) {
      group = { key, mainLabel: main, ownValue: null, children: [] }
      groups.set(key, group)
      order.push(key)
    }
    if (sub === null) {
      // A bare "Haircare" row -- keep it as this group's own selectable
      // value. If it's the first thing seen for this key, its casing also
      // becomes the group's display label (subcategory rows below may
      // arrive with slightly different casing on their shared prefix;
      // the bare row's casing wins since it's the one a person actually
      // picked when naming the parent category).
      group.ownValue = name
      if (!group.children.length) group.mainLabel = name
    } else {
      // Avoid duplicate children if the same "Main - Sub" value appears
      // twice in the source list (categories list + productFilterMeta
      // fallback can briefly overlap during a page's first render) or
      // with incidental extra whitespace around the separator -- compare
      // by the already-trimmed sub label, not the raw full-name string,
      // so "Haircare -  Shampoo" (double space) still dedupes against
      // "Haircare - Shampoo".
      if (!group.children.some((child) => child.label.toLowerCase() === sub.toLowerCase())) {
        group.children.push({ value: name, label: sub })
      }
    }
  }

  for (const group of groups.values()) {
    group.children.sort((a, b) => a.label.localeCompare(b.label))
  }

  return order
    .map((key) => groups.get(key)!)
    .sort((a, b) => a.mainLabel.localeCompare(b.mainLabel))
}

/**
 * Every real category value a group represents -- its own bare value (if
 * it has one) plus every subcategory's full value. This is exactly the
 * list that should be written into a filter's selected-values state when a
 * person toggles the parent row, and it's plain category-name strings, so
 * it flows straight through the existing CSV `category` query param
 * (routes/products.ts, routes/inventory.ts) with no backend changes.
 */
export function categoryGroupValues(group: CategoryGroup): string[] {
  return group.ownValue ? [group.ownValue, ...group.children.map((child) => child.value)] : group.children.map((child) => child.value)
}
