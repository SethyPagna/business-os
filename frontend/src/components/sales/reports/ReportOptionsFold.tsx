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
import InfoHint from '../../shared/InfoHint.tsx'
import { Button, Chip, Fold } from '../../shared/kit'
import { DEFAULT_REPORT_OPTIONS, type ReportBasis, type ReportCurrency, type ReportOptions, type ReportProfitMode, type ReportStyle } from './reportModel.ts'
import type { Tr } from './reportTypes.ts'

export interface ReportOptionsFoldProps {
  open: boolean
  onClose: () => void
  anchorRef: RefObject<HTMLElement | null>
  options: ReportOptions
  onChange: (patch: Partial<ReportOptions>) => void
  onReset: () => void
  tr: Tr
  /** Cost/profit are admin-only; without them the profit-mode group is inert. */
  showProfit: boolean
  /** "Net after expenses" needs the Expenses permission. */
  showExpenses: boolean
  /** The branch / status / payment selects, rendered as an opaque slot. */
  filterControls?: ReactNode
  /** Excel vs Receipt -- the former standalone toggle, now a chip group. */
  style: ReportStyle
  onStyleChange: (next: ReportStyle) => void
  /** True when BOTH the filters and the options are at their defaults. */
  resetDisabled?: boolean
}

function Group({ title, hint, hintLabel, children }: { title: string; hint?: string; hintLabel?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 text-[length:var(--ui-size-meta)] font-medium text-[var(--ui-ink-2)]">
        {title}
        {hint ? <InfoHint text={hint} label={hintLabel || title} /> : null}
      </div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  )
}

export default function ReportOptionsFold({ open, onClose, anchorRef, options, onChange, onReset, tr, showProfit, showExpenses, filterControls, style, onStyleChange, resetDisabled }: ReportOptionsFoldProps) {
  const bases: Array<{ id: ReportBasis; label: string }> = [
    { id: 'revenue', label: `${tr('revenue', 'Revenue')} (${tr('rpt_default', 'default')})` },
    { id: 'gross', label: tr('gross_sales', 'Gross sales') },
    { id: 'collected', label: tr('collected_total', 'Collected total') },
  ]
  const profitModes: Array<{ id: ReportProfitMode; label: string; disabled?: boolean }> = [
    { id: 'gross', label: tr('rpt_gross_profit', 'Gross profit') },
    { id: 'net', label: tr('rpt_profit_net', 'Net after expenses'), disabled: !showExpenses },
  ]
  const currencies: Array<{ id: ReportCurrency; label: string }> = [
    { id: 'setting', label: tr('rpt_currency_setting', 'App setting') },
    { id: 'usd', label: 'USD' },
    { id: 'khr', label: 'KHR' },
    { id: 'both', label: tr('rpt_currency_both', 'Both') },
  ]
  const optionsAreDefault = JSON.stringify(options) === JSON.stringify({ ...DEFAULT_REPORT_OPTIONS, granularity: options.granularity })
  const isDefault = resetDisabled ?? optionsAreDefault
  return (
    <Fold
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      title={tr('filters', 'Filters')}
      actions={
        <Button size="sm" variant="ghost" onClick={onReset} disabled={isDefault}>
          {tr('reset', 'Reset')}
        </Button>
      }
    >
      <div className="space-y-2.5 p-2.5" data-reports-fold="">
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
        <Group
          title={tr('rpt_basis', 'Basis')}
          hint={tr('rpt_basis_hint', 'The figure that leads the summary line and divides the margin. Revenue is the app-wide definition: net sales of recognized sales minus refunds, tax and delivery excluded.')}
        >
          {bases.map((b) => (
            <Chip key={b.id} selected={options.basis === b.id} onClick={() => onChange({ basis: b.id })}>
              {b.label}
            </Chip>
          ))}
        </Group>
        <Group
          title={tr('profit', 'Profit')}
          hint={showProfit
            ? tr('rpt_profit_hint', 'Gross profit = revenue − cost of goods − store-paid delivery. Net after expenses also subtracts recorded expenses (Overview only).')
            : tr('rpt_cost_hidden_hint', 'Cost and profit figures are visible to admins only.')}
        >
          {profitModes.map((m) => (
            <Chip key={m.id} selected={options.profitMode === m.id} disabled={!showProfit || m.disabled} onClick={() => onChange({ profitMode: m.id })}>
              {m.label}
            </Chip>
          ))}
        </Group>
        <Group title={tr('rpt_compare', 'Compare')} hint={tr('rpt_compare_hint', 'Overview: also load the previous period of equal length and show the change.')}>
          <Chip selected={options.compare} onClick={() => onChange({ compare: !options.compare })}>
            {tr('rpt_compare_prev', 'Previous period')}
          </Chip>
        </Group>
        <Group title={tr('rpt_currency', 'Currency')} hint={tr('rpt_currency_hint', 'Display only. Stored amounts never change; single-currency views convert at the main exchange rate.')}>
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
