import { useRef, useState } from 'react'
import Modal from '../shared/Modal.tsx'

type TranslateFn = (key: string, fallback: string) => string

export default function SaleCustomerNameModal({ currentName, currentPhone, pendingName, pendingOutcome = false, saving = false, translate, onSave, onClose, onRetryPending, onDiscardPending }: {
  currentName: string
  currentPhone?: string | null
  pendingName?: string
  pendingOutcome?: boolean
  saving?: boolean
  translate: TranslateFn
  onSave: (edit: { name: string }) => Promise<boolean>
  onClose: () => void
  onRetryPending?: () => void
  onDiscardPending?: () => void
}) {
  const [name, setName] = useState(pendingName ?? currentName)
  const [submitting, setSubmitting] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState('')
  const busy = saving || submitting
  const dirty = name.trim() !== currentName.trim()
  const submit = async () => {
    if (inFlight.current || busy || pendingOutcome) return
    if (!name.trim()) { setError(translate('name_required', 'Name is required')); return }
    inFlight.current = true
    setSubmitting(true)
    setError('')
    try { await onSave({ name: name.trim() }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : translate('update_failed', 'Unable to update the sale.')) }
    finally { inFlight.current = false; setSubmitting(false) }
  }
  return (
    <Modal title={translate('sale_customer_edit_title', 'Edit customer')} onClose={onClose} closeDisabled={busy} unsavedChanges={{ dirty }} size="sm" layer="nested">
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">{translate('sale_customer_name_only_scope', 'Only the customer name saved on this sale changes. The linked customer, phone, membership, customer profile and other transactions stay unchanged.')}</p>
        <div className="rounded-lg bg-gray-50 px-3 py-2 font-mono text-sm dark:bg-gray-800">{currentPhone || translate('sale_customer_no_phone', 'No phone')}</div>
        <div>
          <label htmlFor="sale-customer-name" className="mb-1 block text-sm font-medium">{translate('name', 'Name')}</label>
          <input id="sale-customer-name" name="sale_customer_name" autoComplete="name" className="input w-full" value={name} onChange={(event) => setName(event.target.value)} disabled={busy || pendingOutcome} autoFocus />
        </div>
        {pendingOutcome ? <div role="status" className="space-y-2 rounded-lg border border-amber-300 p-3 text-sm">
          <p>{translate('sale_bulk_pending', 'A previous request has an unknown outcome. Retry the original request or discard it before starting another.')}</p>
          {onRetryPending ? <button type="button" className="btn-secondary" disabled={busy} onClick={onRetryPending}>{translate('sale_bulk_retry', 'Retry original request')}</button> : null}
          {onDiscardPending ? <button type="button" className="btn-secondary" disabled={busy} onClick={onDiscardPending}>{translate('sale_bulk_discard', 'Discard retry')}</button> : null}
        </div> : null}
        {error ? <div role="alert" className="text-sm text-red-600">{error}</div> : null}
        <div className="flex gap-2 border-t pt-3 dark:border-gray-700">
          <button type="button" className="btn-primary flex-1" disabled={busy || pendingOutcome || !dirty} onClick={() => { void submit() }}>{busy ? translate('saving', 'Saving...') : translate('save', 'Save')}</button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>{translate('cancel', 'Cancel')}</button>
        </div>
      </div>
    </Modal>
  )
}
