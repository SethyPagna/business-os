import { useMemo, type ReactNode } from 'react'
import MessageSquare from 'lucide-react/dist/esm/icons/message-square.js'
import Settings2 from 'lucide-react/dist/esm/icons/settings-2.js'
import SuggestionTextInput from './SuggestionTextInput.tsx'
import type { SavedStockReason } from '../../utils/useSavedStockReasons.ts'

// The one reason control for stock writes: the saved-reason chips from
// settings.inventory_saved_reasons (GET /api/inventory/reasons) above a free
// text box. Tapping a chip fills the box; the box is what gets stored, as
// typed. InventoryStockModals' adjust form and FastStockInModal's line entry
// both render this -- the fast flow used to write a hardcoded label per line
// (N27) and the owner asked for the reasons back on every add / remove / set.
// The chip list itself is loaded by utils/useSavedStockReasons, which owns
// the catalog shape; re-exported here so a call site needs one import.
export type { SavedStockReason }

type StockReasonFieldProps = {
  id?: string
  name?: string
  label: ReactNode
  value: string
  onChange: (next: string) => void
  savedReasons: SavedStockReason[]
  placeholder?: string
  // Rendered only where the surface owns the reason manager modal.
  onManage?: () => void
  manageLabel?: string
  // Enter queues the line on surfaces that queue (fast stock-in); the adjust
  // form submits from its own footer and passes nothing.
  onEnter?: () => void
  className?: string
  labelClassName?: string
  inputClassName?: string
  /**
   * 'compact' (Stock Session, S4): ONE row -- a searchable reason box whose
   * list is the saved reasons, the manage icon, then the host's action.
   */
  variant?: 'default' | 'compact'
  /** Compact only: the name of the box for screen readers and the tooltip. */
  ariaLabel?: string
  /** Compact only: rendered at the end of the row (the Add button). */
  trailing?: ReactNode
}

// Deliberately 500 while every reason wire accepts 512 (lib/stockReason.ts):
// the headroom lets undo/redo prepend 'Undo: ' to a maximum-length reason.
const REASON_MAX_LENGTH = 500

export default function StockReasonField({
  id, name, label, value, onChange, savedReasons, placeholder, onManage, manageLabel, onEnter,
  className = '', labelClassName = 'block text-xs font-medium text-gray-600 dark:text-gray-400', inputClassName = 'text-sm',
  variant = 'default', ariaLabel, trailing,
}: StockReasonFieldProps) {
  const reasonOptions = useMemo(() => savedReasons.map((entry) => ({ value: entry.label, key: entry.id, selected: entry.label === value })), [savedReasons, value])
  if (variant === 'compact') {
    const boxLabel = ariaLabel || placeholder || ''
    return (
      <div
        className={`flex min-w-0 items-center gap-1.5 ${className}`.trim()}
        onKeyDown={onEnter ? (event) => {
          // Only the box's own Enter queues; a picked suggestion has already handled it.
          if (event.key !== 'Enter' || event.defaultPrevented || (event.target as HTMLElement).tagName !== 'INPUT') return
          event.preventDefault()
          onEnter()
        } : undefined}
      >
        <div className="relative min-w-0 flex-1" title={value.trim() ? `${boxLabel}: ${value.trim()}` : boxLabel}>
          <MessageSquare className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <SuggestionTextInput
            id={id || 'stock-reason'}
            name={name}
            value={value}
            options={reasonOptions}
            limit={50}
            ariaLabel={boxLabel}
            placeholder={placeholder}
            inputClassName={`input h-10 w-full min-w-0 pl-8 ${inputClassName}`}
            onChange={(next) => onChange(next.slice(0, REASON_MAX_LENGTH))}
          />
        </div>
        {onManage ? (
          <button
            type="button"
            onClick={onManage}
            aria-label={manageLabel}
            title={manageLabel}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <Settings2 className="h-4 w-4" />
          </button>
        ) : null}
        {trailing}
      </div>
    )
  }
  return (
    <div className={className}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className={labelClassName}>{label}</label>
        {onManage ? (
          <button type="button" className="text-[11px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300" onClick={onManage}>
            {manageLabel}
          </button>
        ) : null}
      </div>
      {savedReasons.length ? (
        <div className="mb-2 flex flex-wrap gap-1">
          {savedReasons.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={value === entry.label}
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${value === entry.label ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}
              onClick={() => onChange(entry.label)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      ) : null}
      <input
        id={id}
        name={name}
        // Deliberately 500 while every reason wire accepts 512
        // (cloudflare/src/lib/stockReason.ts). The box stops before the
        // server limit instead of letting a long paste be refused after the
        // operator has finished the rest of the line, and the 12 characters of
        // headroom are what lets undo/redo prepend 'Undo: ' to a maximum-length
        // reason and still be accepted by the wire that stored it.
        maxLength={REASON_MAX_LENGTH}
        className={`input w-full ${inputClassName}`}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onEnter ? (event) => { if (event.key === 'Enter') { event.preventDefault(); onEnter() } } : undefined}
      />
    </div>
  )
}
