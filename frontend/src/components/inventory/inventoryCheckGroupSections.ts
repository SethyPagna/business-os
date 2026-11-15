import { fmtDateOnly } from '../../utils/formatters.ts'
import type { Grouping } from './inventoryCheckGroups.ts'
import type { InventoryCheckProduct, InventoryCheckTranslator } from '../../types/inventoryChecks.ts'

/** The groups with no value sit after every real one, on every page. */
const LAST_KEYS: ReadonlySet<string> = new Set(['never', 'none'])

/** The header text of one group: a date as dd/mm/yyyy, the category as the server named it, or the "never" / "none" words. */
export function groupLabel(key: string, label: string | null, t: InventoryCheckTranslator): string {
  const word = (key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }
  if (key === 'never') return word('inventory_check_group_never', 'Never checked')
  if (key === 'none') return word('inventory_check_group_no_category', 'No category')
  if (key.startsWith('d:')) return fmtDateOnly(key.slice(2))
  return label?.trim() || key.slice(2)
}

/**
 * The page's rows cut into the server's groups, in the server's order (Never checked and No category last). The count on a header is the server's whole-scope `products`,
 * never the rows of this page: a group that spans pages says the same number on each. Null when a row names a group the answer did not describe (the page then reads as one list).
 */
export function buildSections(products: readonly InventoryCheckProduct[], grouping: Grouping): Array<{ key: string; products: InventoryCheckProduct[]; group: Grouping['groups'][number] }> | null {
  const byKey = new Map(grouping.groups.map(group => [group.key, group]))
  const sections = new Map<string, { key: string; products: InventoryCheckProduct[]; group: Grouping['groups'][number] }>()
  for (const product of products) {
    const key = product.group_key
    const group = key === undefined ? undefined : byKey.get(key)
    if (key === undefined || !group) return null
    const section = sections.get(key) ?? { key, products: [], group }
    section.products.push(product)
    sections.set(key, section)
  }
  return [...sections.values()].sort((a, b) => Number(LAST_KEYS.has(a.key)) - Number(LAST_KEYS.has(b.key)))
}
