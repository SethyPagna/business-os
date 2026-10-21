// The storefront FAQ's open/closed identity and search (owner, 2026-09-25:
// "only the clicked item expands; neighbours don't stretch"; 2026-10-20: one
// readable column with search once the list is long).
//
// Identity: open state used to be the item's `id`. Neither the storefront's
// normalizeFaqItems (PublicCatalogPage.tsx) nor the Worker's
// normalizePortalFaqItems de-duplicates ids -- only the editor's copy does --
// so two saved items sharing an id (a pasted/duplicated entry, or a real
// "faq-2" meeting the Worker's `faq-${index + 1}` fallback) opened and closed
// together. The key here includes the item's position, so it is unique by
// construction whatever the ids are.
export type FaqEntry<T> = { item: T; index: number; key: string }

/** Search is offered once there are more questions than this. */
export const FAQ_SEARCH_AFTER = 6

export function faqItemKey(item: { id?: unknown } | null | undefined, index: number): string {
  return `${index}:${String(item?.id ?? '')}`
}

export function faqEntries<T extends { id?: unknown }>(items: readonly T[]): FaqEntry<T>[] {
  return items.map((item, index) => ({ item, index, key: faqItemKey(item, index) }))
}

export function faqSearchVisible(count: number): boolean {
  return count > FAQ_SEARCH_AFTER
}

/** Entries whose question or answer contains the query (case-insensitive); a blank query keeps all. */
export function filterFaqEntries<T extends { question?: unknown; answer?: unknown }>(
  entries: readonly FaqEntry<T>[],
  query: string,
): FaqEntry<T>[] {
  const needle = query.normalize('NFC').trim().toLowerCase()
  if (!needle) return [...entries]
  return entries.filter(({ item }) => `${String(item.question ?? '')}\n${String(item.answer ?? '')}`.normalize('NFC').toLowerCase().includes(needle))
}

/** Toggle: the clicked item opens (closing any other); clicking it again closes it. */
export function nextOpenFaqKey(current: unknown, clicked: string): string | null {
  return current === clicked ? null : clicked
}
