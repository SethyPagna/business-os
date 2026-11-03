import { useMemo } from 'react'
import Tag from 'lucide-react/dist/esm/icons/tag.js'
import AppSelect from '../shared/AppSelect'
import ChipRail, { RailChip } from '../shared/kit/ChipRail.tsx'
import { STOCK_CONDITION_TAGS } from '../../utils/stockCondition.ts'

// P3-L6. The owner's control, in ONE row on every screen size: "Make it option
// chooseable to keep in group with tag or remove entiriely, "Restock with
// "tag"" ... make sure the options are made compact see if can be merged
// anywhere in one row. for small and large screens."
//
// One component, two hosts (InventoryStockModals' adjust form -- which the
// Products page's StockAdjustModal reuses verbatim -- and FastStockInModal's
// queued lines), so the layout, the wire value and the English-only tag rule
// exist once. The row is a two-segment control plus the tag dropdown INSIDE
// the same row; the dropdown is inert until the tagged segment is chosen, so
// the row never grows a second line and never reflows when the choice changes.
//
// The tag text is NEVER translated -- the owner's rule is "the tag remains
// english even in khmer" -- so each option's label below IS the raw constant.
// Only the two segment labels go through the packs.

type Translate = (key: string, fallbackEn?: string, fallbackKm?: string) => string

export type StockConditionTagRowProps = {
  /** 'remove' = keep-or-destroy; 'add' = sellable-or-tagged restock. */
  mode: 'remove' | 'add'
  /** '' means the untagged default (remove entirely / receive as sellable). */
  value: string
  onChange: (next: string) => void
  tr: Translate
  disabled?: boolean
  id?: string
  /** 'select': ONE dropdown whose first option is the untagged default (Stock Session, S4). */
  variant?: 'row' | 'select'
}

export default function StockConditionTagRow({ mode, value, onChange, tr, disabled = false, id, variant = 'row' }: StockConditionTagRowProps) {
  const tagged = Boolean(value)
  const plainLabel = mode === 'remove'
    ? tr('stock_remove_entirely', 'Remove entirely', 'ដកចេញទាំងស្រុង')
    : tr('stock_restock_sellable', 'Restock as sellable', 'បញ្ចូលជាទំនិញលក់')
  const taggedLabel = mode === 'remove'
    ? tr('stock_keep_in_group_as', 'Keep in group as', 'រក្សាក្នុងក្រុមជា')
    : tr('stock_restock_with_tag', 'Restock with', 'បញ្ចូលជាមួយ')
  // Choosing the tagged segment with nothing picked yet lands on the first
  // constant rather than an empty select the person has to notice and fill.
  const selectedTag = tagged ? value : STOCK_CONDITION_TAGS[0]
  // The label IS the constant -- no tr(), in any language.
  const tagOptions = useMemo(() => STOCK_CONDITION_TAGS.map((tag) => ({ value: tag, label: tag })), [])
  const plainValueLabel = mode === 'remove'
    ? plainLabel
    : tr('stock_tag_sellable', 'Sellable', 'លក់បាន')
  const selectOptions = useMemo(() => [{ value: '', label: plainValueLabel }, ...tagOptions], [plainValueLabel, tagOptions])

  if (variant === 'select') {
    return (
      <div className="relative min-w-0" title={taggedLabel} data-stock-condition-select={mode}>
        <Tag className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
        <AppSelect
          id={id}
          value={value}
          options={selectOptions}
          disabled={disabled}
          ariaLabel={taggedLabel}
          onChange={onChange}
          className="w-full"
          buttonClassName="h-10 w-full pl-8 pr-2 text-sm"
          optionClassName="text-sm"
        />
      </div>
    )
  }

  return (
    <ChipRail label={tr('stock_condition_label', 'Condition', 'ស្ថានភាព')} stretch data-stock-condition-row={mode}>
      <RailChip selected={!tagged} disabled={disabled} onClick={() => onChange('')}>
        {plainLabel}
      </RailChip>
      <RailChip selected={tagged} disabled={disabled} onClick={() => onChange(selectedTag)}>
        {taggedLabel}
      </RailChip>
      <AppSelect
        id={id}
        value={selectedTag}
        options={tagOptions}
        disabled={disabled || !tagged}
        ariaLabel={taggedLabel}
        onChange={onChange}
        className="w-[7.5rem] shrink-0"
        buttonClassName="h-9 px-2 text-xs"
        optionClassName="text-xs"
      />
    </ChipRail>
  )
}
