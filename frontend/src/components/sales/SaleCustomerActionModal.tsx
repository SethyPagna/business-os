import { useMemo, useState } from 'react'
import Modal from '../shared/Modal.tsx'

export type SaleCustomerChoice = { id: number; name: string; phone?: string | null }

export default function SaleCustomerActionModal({
  saleLabel, currentName, choices, saving, onClose, onSearch, onReplace, onRemove, onCreate, onEdit,
}: {
  saleLabel: string
  currentName?: string | null
  choices: SaleCustomerChoice[]
  saving: boolean
  onClose: () => void
  onSearch: (query: string) => void
  onReplace: (customer: SaleCustomerChoice) => void
  onRemove: () => void
  onCreate: () => void
  onEdit: () => void
}) {
  const [query, setQuery] = useState('')
  const visible = useMemo(() => choices.filter((choice) => choice.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [choices, query])
  const changeQuery = (value: string) => { setQuery(value); onSearch(value) }
  return (
    <Modal title={`Customer — ${saleLabel}`} onClose={onClose} closeDisabled={saving} unsavedChanges="read-only" size="sm">
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-300">This changes only this sale and returns linked to it. Customer profiles and other transactions stay unchanged.</p>
        <div className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800"><span className="text-gray-500">Current: </span>{currentName || 'No customer linked'}</div>
        <input className="input w-full" value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="Find customer" autoFocus />
        <div className="max-h-52 space-y-1 overflow-auto">
          {visible.map((customer) => <button key={customer.id} type="button" className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-blue-50 dark:hover:bg-blue-950/30" disabled={saving} onClick={() => onReplace(customer)}><span>{customer.name}</span><span className="text-xs text-gray-500">{customer.phone || ''}</span></button>)}
          {!visible.length ? <p className="px-2 py-3 text-sm text-gray-500">No matching customers.</p> : null}
        </div>
        <div className="flex flex-wrap gap-2 border-t pt-3 dark:border-gray-700">
          <button type="button" className="btn-primary" disabled={saving} onClick={onCreate}>Create customer</button>
          {currentName ? <button type="button" className="btn-secondary" disabled={saving} onClick={onEdit}>Edit current</button> : null}
          {currentName ? <button type="button" className="btn-secondary text-red-600" disabled={saving} onClick={onRemove}>Remove link</button> : null}
        </div>
      </div>
    </Modal>
  )
}
