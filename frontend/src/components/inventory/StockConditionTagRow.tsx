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
// english even in khmer" -- so the <option> labels below render the raw
// constant. Only the two segment labels go through the packs.

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
}

const SEGMENT_BASE = 'h-9 min-w-0 flex-1 truncate rounded-lg border-2 px-2 text-xs font-medium transition-colors'
const SEGMENT_ON = 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
const SEGMENT_OFF = 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-400'

export default function StockConditionTagRow({ mode, value, onChange, tr, disabled = false, id }: StockConditionTagRowProps) {
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

  return (
    <div className="flex w-full min-w-0 items-center gap-1.5" data-stock-condition-row={mode}>
      <button
        type="button"
        disabled={disabled}
        className={`${SEGMENT_BASE} ${tagged ? SEGMENT_OFF : SEGMENT_ON}`}
        onClick={() => onChange('')}
      >
        {plainLabel}
      </button>
      <button
        type="button"
        disabled={disabled}
        className={`${SEGMENT_BASE} ${tagged ? SEGMENT_ON : SEGMENT_OFF}`}
        onClick={() => onChange(selectedTag)}
      >
        {taggedLabel}
      </button>
      <select
        id={id}
        className="input h-9 w-[7.5rem] shrink-0 px-2 text-xs"
        disabled={disabled || !tagged}
        value={selectedTag}
        aria-label={taggedLabel}
        onChange={(event) => onChange(event.target.value)}
      >
        {STOCK_CONDITION_TAGS.map((tag) => (
          // Raw constant, not tr(tag) -- see the file header.
          <option key={tag} value={tag}>{tag}</option>
        ))}
      </select>
    </div>
  )
}
