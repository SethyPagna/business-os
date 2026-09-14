import type { ReactNode } from 'react'

// The one reason control for stock writes: the saved-reason chips from
// settings.inventory_saved_reasons (GET /api/inventory/reasons) above a free
// text box. Tapping a chip fills the box; the box is what gets stored, as
// typed. InventoryStockModals' adjust form and FastStockInModal's line entry
// both render this -- the fast flow used to write a hardcoded label per line
// (N27) and the owner asked for the reasons back on every add / remove / set.
export type SavedStockReason = { id: string; label: string }

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
}

export default function StockReasonField({
  id, name, label, value, onChange, savedReasons, placeholder, onManage, manageLabel, onEnter,
  className = '', labelClassName = 'block text-xs font-medium text-gray-600 dark:text-gray-400', inputClassName = 'text-sm',
}: StockReasonFieldProps) {
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
        className={`input w-full ${inputClassName}`}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onEnter ? (event) => { if (event.key === 'Enter') { event.preventDefault(); onEnter() } } : undefined}
      />
    </div>
  )
}
