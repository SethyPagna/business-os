import type { ComponentType, ReactNode } from 'react'
import Award from 'lucide-react/dist/esm/icons/award.js'
import Store from 'lucide-react/dist/esm/icons/store.js'
import CalendarDays from 'lucide-react/dist/esm/icons/calendar-days.js'
import AppSelect from '../shared/AppSelect.tsx'
import DateEntryInput from '../shared/DateEntryInput.tsx'
import SuggestionTextInput from '../shared/SuggestionTextInput.tsx'
import SupplierPickerField, { type SupplierChoice } from '../shared/SupplierPickerField.tsx'

type Translate = (key: string, fallbackEn?: string, fallbackKm?: string) => string
type IconType = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>

export const INVALID_RING = 'ring-2 ring-red-400 dark:ring-red-500'

/** A control whose name is its 16px leading icon (labels live inside the control, S9). */
export function IconField({ icon: Icon, title, children, className = '' }: { icon: IconType; title: string; children: ReactNode; className?: string }) {
  return (
    <div className={`relative min-w-0 ${className}`.trim()} title={title}>
      <Icon className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
      {children}
    </div>
  )
}

/**
 * A number box with its name inset at the top-left, so the name stays readable
 * once the box holds a value (a placeholder would vanish).
 */
export function InsetNumberField({ label, value, onChange, disabled = false, invalid = false, step = '1', min = '0', onEnter, onBlur, id, placeholder, title }: {
  label: string
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  invalid?: boolean
  step?: string
  min?: string
  onEnter?: () => void
  onBlur?: () => void
  id?: string
  placeholder?: string
  title?: string
}) {
  return (
    <label className="relative block min-w-0" title={title || label}>
      <span className="pointer-events-none absolute left-2 top-1 z-10 max-w-[calc(100%-0.75rem)] truncate text-[9px] font-medium leading-none text-gray-400 dark:text-gray-500">{label}</span>
      <input
        id={id}
        type="number"
        inputMode={step === '1' ? 'numeric' : 'decimal'}
        min={min}
        step={step}
        aria-label={label}
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        onKeyDown={onEnter ? (event) => { if (event.key === 'Enter') { event.preventDefault(); onEnter() } } : undefined}
        className={`input h-10 w-full min-w-0 px-2 pb-0.5 pt-3 text-right text-sm tabular-nums disabled:cursor-not-allowed disabled:opacity-60 ${invalid ? INVALID_RING : ''}`}
      />
    </label>
  )
}

type SharedDetailsProps = {
  tr: Translate
  packLookup: (key: string) => string | undefined
  brand: string
  onBrand: (next: string) => void
  brandOptions: readonly string[]
  onRequestBrands?: () => void
  supplier: SupplierChoice
  onSupplier: (next: SupplierChoice) => void
  supplierInvalid?: boolean
  branchId: string
  onBranch: (next: string) => void
  branchOptions: Array<{ value: string; label: string }>
  receivedDate: string
  onReceivedDate: (iso: string) => void
  disabled?: boolean
}

/**
 * "Applies to every line" (S5, S9, S11): the same two rows in every mode --
 * Brand | Supplier, Branch | Received date -- so the float never changes shape.
 */
export default function StockSessionSharedDetails({
  tr, packLookup, brand, onBrand, brandOptions, onRequestBrands, supplier, onSupplier, supplierInvalid = false,
  branchId, onBranch, branchOptions, receivedDate, onReceivedDate, disabled = false,
}: SharedDetailsProps) {
  const brandLabel = tr('brand', 'Brand')
  const branchLabel = tr('branch', 'Branch')
  const dateLabel = tr('received_date', 'Received date')
  return (
    <fieldset className="min-w-0 rounded-xl border border-gray-200 px-2 pb-2 dark:border-gray-700" data-stock-session-shared>
      <legend className="px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{tr('applies_to_every_line', 'Applies to every line')}</legend>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <IconField icon={Award} title={brand.trim() ? `${brandLabel}: ${brand.trim()}` : brandLabel}>
          <SuggestionTextInput
            id="stock-session-brand"
            value={brand}
            options={brandOptions}
            limit={50}
            disabled={disabled}
            onRequestOptions={onRequestBrands}
            ariaLabel={brandLabel}
            placeholder={brandLabel}
            inputClassName="input h-10 w-full min-w-0 pl-8 text-sm"
            onChange={(next) => onBrand(next)}
          />
        </IconField>
        <SupplierPickerField
          variant="compact"
          value={supplier}
          onChange={onSupplier}
          tr={tr}
          idPrefix="stock-session"
          disabled={disabled}
          invalid={supplierInvalid}
        />
        <IconField icon={Store} title={branchLabel}>
          <AppSelect
            value={branchId}
            onChange={onBranch}
            ariaLabel={branchLabel}
            disabled={disabled}
            className="w-full"
            buttonClassName="h-10 w-full pl-8 pr-2 text-sm"
            optionClassName="text-sm"
            options={branchOptions}
          />
        </IconField>
        <IconField icon={CalendarDays} title={dateLabel}>
          <DateEntryInput
            className="h-10 w-full pl-8 text-sm"
            t={packLookup}
            ariaLabel={dateLabel}
            placeholder={dateLabel}
            disabled={disabled}
            value={receivedDate}
            onChange={onReceivedDate}
          />
        </IconField>
      </div>
    </fieldset>
  )
}
