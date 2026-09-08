// ReportOptionsFold -- THE filter menu for the Reports surface (user, Part
// 586: "make sure the search is shown, the various options into filtermenu").
//
// It used to be only the "calculation options" (Part 581), sitting beside a
// SEPARATE Filters fold, a separate style toggle and a separate overflow
// menu -- four controls competing with the search box for the one row, which
// is why the search kept getting squeezed. Everything except search, the date
// range and the view picker now lives in here, in one menu, in this order:
//
//   Filters          branch / status / payment selects (the caller's nodes)
//   Display settings Excel vs Receipt style
//   Basis · Profit · Compare · Currency   the calculation options
//
// Each option is a single-select chip group; the canonical definition is
// always the default and labelled as such, so a person can never lose the
// app-wide revenue definition by accident. Choices persist (localStorage
// bos:reports:options) through ReportsHub. One Reset clears the whole menu.
import type { ReactNode, RefObject } from 'react'
import Receipt from 'lucide-react/dist/esm/icons/receipt.js'
import Table2 from 'lucide-react/dist/esm/icons/table-2.js'
import { Button, Chip, Fold } from '../../shared/kit'
import { DEFAULT_REPORT_OPTIONS, type ReportCurrency, type ReportOptions, type ReportStyle } from './reportModel.ts'
import type { Tr } from './reportTypes.ts'

export interface ReportOptionsFoldProps {
  open: boolean
  onClose: () => void
  anchorRef: RefObject<HTMLElement | null>
  options: ReportOptions
  onChange: (patch: Partial<ReportOptions>) => void
  onReset: () => void
  tr: Tr
  /** The permission-filtered report picker, rendered as an opaque slot. */
  viewControl: ReactNode
  /** The branch / status / payment selects, rendered as an opaque slot. */
  filterControls?: ReactNode
  /** Excel vs Receipt -- the former standalone toggle, now a chip group. */
  style: ReportStyle
  onStyleChange: (next: ReportStyle) => void
  /** True when BOTH the filters and the options are at their defaults. */
  resetDisabled?: boolean
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="reports-filter-group space-y-1">
      <div className="text-[length:var(--ui-size-meta)] font-medium text-[var(--ui-ink-2)]">{title}</div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  )
}

export default function ReportOptionsFold({ open, onClose, anchorRef, options, onChange, onReset, tr, viewControl, filterControls, style, onStyleChange, resetDisabled }: ReportOptionsFoldProps) {
  const currencies: Array<{ id: ReportCurrency; label: string }> = [
    { id: 'usd', label: 'USD' },
    { id: 'khr', label: 'KHR' },
    { id: 'both', label: tr('rpt_currency_both', 'Both') },
  ]
  const optionsAreDefault = options.currency === DEFAULT_REPORT_OPTIONS.currency
  const isDefault = resetDisabled ?? optionsAreDefault
  return (
    <Fold
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      className="reports-fold-panel reports-filter-fold"
      title={tr('filters', 'Filters')}
      actions={
        <Button size="sm" variant="ghost" onClick={onReset} disabled={isDefault}>
          {tr('reset', 'Reset')}
        </Button>
      }
    >
      <div className="reports-filter-grid" data-reports-fold="" data-reports-filter="">
        <Group title={tr('view', 'View')}>
          <div className="w-full min-w-0">{viewControl}</div>
        </Group>
        {filterControls ? (
          <Group title={tr('filters', 'Filters')}>
            <div className="flex w-full flex-col gap-1.5">{filterControls}</div>
          </Group>
        ) : null}
        {/* No InfoHint here on purpose: a hint would need a new rpt_* key in
            both language packs, and the two labelled+iconed chips already say
            what they do. The lang packs are the fleet's hottest merge file. */}
        <Group title={tr('display', 'Display settings')}>
          <Chip selected={style === 'excel'} onClick={() => onStyleChange('excel')}>
            <span className="inline-flex items-center gap-1"><Table2 className="h-3 w-3" />{tr('rpt_style_excel', 'Excel style')}</span>
          </Chip>
          <Chip selected={style === 'receipt'} onClick={() => onStyleChange('receipt')}>
            <span className="inline-flex items-center gap-1"><Receipt className="h-3 w-3" />{tr('rpt_style_receipt', 'Receipt style')}</span>
          </Chip>
        </Group>
        <Group title={tr('rpt_currency', 'Currency')}>
          {currencies.map((c) => (
            <Chip key={c.id} selected={options.currency === c.id} onClick={() => onChange({ currency: c.id })}>
              {c.label}
            </Chip>
          ))}
        </Group>
      </div>
    </Fold>
  )
}
