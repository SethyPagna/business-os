import { useState } from 'react'
import Modal from '../shared/Modal.tsx'

type TranslateFn = (key: string, fallback: string) => string

export default function SaleCustomerNameModal({
  currentName,
  translate,
  onSave,
  onClose,
}: {
  currentName: string
  translate: TranslateFn
  onSave: (name: string) => Promise<boolean>
  onClose: () => void
}) {
  const [name, setName] = useState(currentName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dirty = name.trim() !== currentName.trim()

  const submit = async () => {
    if (saving) return
    if (!name.trim()) {
      setError(translate('name_required', 'Name is required'))
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(name)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : translate('sale_customer_name_update_failed', 'Unable to update the customer name.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={translate('sale_customer_edit_name_title', 'Edit current customer name')}
      onClose={onClose}
      closeDisabled={saving}
      unsavedChanges={{ dirty }}
      size="sm"
      layer="nested"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {translate('sale_customer_edit_name_scope', 'This edits only the customer profile name. Phone, membership number, addresses, and notes stay unchanged. The next step asks whether linked records should follow the new name or keep their recorded name.')}
        </p>
        <div>
          <label htmlFor="sale-customer-name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{translate('name', 'Name')}</label>
          <input id="sale-customer-name" name="sale_customer_name" autoComplete="name" className="input w-full" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </div>
        {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">{error}</div> : null}
        <div className="flex flex-col gap-2 border-t pt-3 dark:border-gray-700 sm:flex-row">
          <button type="button" className="btn-primary flex-1" disabled={saving || !dirty} onClick={() => { void submit() }}>{saving ? translate('saving', 'Saving...') : translate('continue', 'Continue')}</button>
          <button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>{translate('cancel', 'Cancel')}</button>
        </div>
      </div>
    </Modal>
  )
}
