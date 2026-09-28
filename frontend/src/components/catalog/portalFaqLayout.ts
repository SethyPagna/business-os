// The storefront FAQ's layout and open/closed identity (owner, 2026-09-25:
// "only the clicked item expands; neighbours don't stretch").
//
// Identity: open state used to be the item's `id`. Neither the storefront's
// normalizeFaqItems (PublicCatalogPage.tsx) nor the Worker's
// normalizePortalFaqItems de-duplicates ids -- only the editor's copy does --
// so two saved items sharing an id (a pasted/duplicated entry, or a real
// "faq-2" meeting the Worker's `faq-${index + 1}` fallback) opened and closed
// together. The key here includes the item's position, so it is unique by
// construction whatever the ids are.
//
// Layout: a two-column CSS grid shares one height per row, so opening a card
// moved every card below it in the OTHER column too. Two independent column
// stacks do not: a card only pushes the cards under it in its own column.
// The split is first half / second half (left column gets the extra one), so
// the DOM order is 1..n both when the stacks sit side by side and when they
// stack on a phone -- no duplicate markup, no reordering for screen readers.
export type FaqEntry<T> = { item: T; index: number; key: string }

export function faqItemKey(item: { id?: unknown } | null | undefined, index: number): string {
  return `${index}:${String(item?.id ?? '')}`
}

export function splitFaqColumns<T extends { id?: unknown }>(items: readonly T[]): [FaqEntry<T>[], FaqEntry<T>[]] {
  const entries = items.map((item, index) => ({ item, index, key: faqItemKey(item, index) }))
  const leftCount = Math.ceil(entries.length / 2)
  return [entries.slice(0, leftCount), entries.slice(leftCount)]
}

/** Toggle: the clicked item opens (closing any other); clicking it again closes it. */
export function nextOpenFaqKey(current: unknown, clicked: string): string | null {
  return current === clicked ? null : clicked
}
