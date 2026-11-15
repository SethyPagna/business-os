import InventoryCheckListRows, { type InventoryCheckListRowsProps, type ListSection } from './InventoryCheckListRows.tsx'
import DayGroupHeader from '../shared/DayGroupHeader.tsx'
import { collapseId, UNSAVED_ROW_CLASS, type Grouping } from './inventoryCheckGroups.ts'
import { buildSections, groupLabel, unsavedCount } from './inventoryCheckGroupSections.ts'

export type InventoryCheckGroupedListProps = Omit<InventoryCheckListRowsProps, 'sections'> & {
  grouping: Grouping
  collapsed: ReadonlySet<string>
  onToggle: (id: string) => void
}

/** A collapsed group holds counts that are typed but not saved: a small blue dot and how many, in the unsaved row's blue. */
function UnsavedCue({ count, text }: { count: number; text: string }) {
  return <span data-inventory-check-unsaved-cue={String(count)} title={text} aria-label={text} role="img" className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium normal-case leading-normal tracking-normal text-sky-700 dark:text-sky-300 ${UNSAVED_ROW_CLASS}`}>
    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-sky-500/70 dark:bg-sky-400/70" />{count}
  </span>
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
    const unsaved = isCollapsed ? unsavedCount(products, props.drafts, props.selecting) : 0
    const cueText = !unsaved ? '' : unsaved === 1 ? word('inventory_check_group_unsaved_one', '1 unsaved count in this group') : word('inventory_check_group_unsaved_many', '{count} unsaved counts in this group').replace('{count}', String(unsaved))
    return {
      key,
      header: <DayGroupHeader label={group.continued_before ? `${label} · ${word('inventory_check_group_continued', 'continued')}` : label} count={group.products} collapsed={isCollapsed} onToggle={() => onToggle(id)} extra={unsaved ? <UnsavedCue count={unsaved} text={cueText} /> : undefined} t={key => t(key) || key} />,
      products: isCollapsed ? [] : products,
      footer: group.continues_after && !isCollapsed ? word('inventory_check_group_continues', 'Continues on the next page') : undefined,
    }
  })
  return <InventoryCheckListRows {...props} sections={sections} />
}
