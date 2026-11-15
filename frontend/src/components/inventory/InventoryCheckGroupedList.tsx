import InventoryCheckListRows, { type InventoryCheckListRowsProps, type ListSection } from './InventoryCheckListRows.tsx'
import DayGroupHeader from '../shared/DayGroupHeader.tsx'
import { collapseId, type Grouping } from './inventoryCheckGroups.ts'
import { buildSections, groupLabel } from './inventoryCheckGroupSections.ts'

export type InventoryCheckGroupedListProps = Omit<InventoryCheckListRowsProps, 'sections'> & {
  grouping: Grouping
  collapsed: ReadonlySet<string>
  onToggle: (id: string) => void
}

/** Rows under collapsible headers. Collapsing is local: nothing is read, the pager and every total stay as they are. */
export default function InventoryCheckGroupedList({ grouping, collapsed, onToggle, ...props }: InventoryCheckGroupedListProps) {
  const t = props.t
  const word = (key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }
  const built = buildSections(props.products, grouping)
  const sections: ListSection[] | undefined = built?.map(({ key, products, group }) => {
    const id = collapseId(grouping.by, key)
    const isCollapsed = collapsed.has(id)
    const label = groupLabel(key, group.label, t)
    return {
      key,
      header: <DayGroupHeader label={group.continued_before ? `${label} · ${word('inventory_check_group_continued', 'continued')}` : label} count={group.products} collapsed={isCollapsed} onToggle={() => onToggle(id)} t={key => t(key) || key} />,
      products: isCollapsed ? [] : products,
      footer: group.continues_after && !isCollapsed ? word('inventory_check_group_continues', 'Continues on the next page') : undefined,
    }
  })
  return <InventoryCheckListRows {...props} sections={sections} />
}
