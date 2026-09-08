import { useState } from 'react'
import Modal from '../shared/Modal.tsx'

type TranslateFn = (key: string, fallback: string) => string

export type SaleCustomerProfileEdit = {
  name: string
  membershipNumber: string
}

export default function SaleCustomerNameModal({
  currentName,
  currentPhone,
  currentMembershipNumber,
  canAssignMembership,
  translate,
  onSave,
  onClose,
}: {
  currentName: string
  currentPhone?: string | null
  currentMembershipNumber?: string | null
  canAssignMembership: boolean
  translate: TranslateFn
  onSave: (edit: SaleCustomerProfileEdit) => Promise<boolean>
  onClose: () => void
}) {
  const originalMembership = String(currentMembershipNumber || '').trim()
  const [name, setName] = useState(currentName)
  const [membershipNumber, setMembershipNumber] = useState(originalMembership)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const membershipCanChange = canAssignMembership && !originalMembership
  const dirty = name.trim() !== currentName.trim()
    || (membershipCanChange && membershipNumber.trim().toUpperCase() !== originalMembership.toUpperCase())

  const submit = async () => {
    if (saving) return
    if (!name.trim()) {
      setError(translate('name_required', 'Name is required'))
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave({ name, membershipNumber })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : translate('sale_customer_profile_update_failed', 'Unable to update the customer.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={translate('sale_customer_edit_title', 'Edit customer')}
      onClose={onClose}
      closeDisabled={saving}
      unsavedChanges={{ dirty }}
      size="sm"
      layer="nested"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {translate('sale_customer_profile_scope', 'This edits the linked customer profile. Name changes use the linked-record choice; phone, addresses, notes, and unrelated sale links stay unchanged.')}
        </p>
        <div>
          <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{translate('phone_number', 'Phone number')}</span>
          <div className="rounded-lg bg-gray-50 px-3 py-2 font-mono text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-200">{currentPhone || translate('sale_customer_no_phone', 'No phone')}</div>
          <p className="mt-1 text-xs text-gray-500">{translate('sale_customer_phone_identity_locked', 'Phone is this customer’s primary identity and is changed only in Contacts.')}</p>
        </div>
        <div>
          <label htmlFor="sale-customer-name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{translate('name', 'Name')}</label>
          <input id="sale-customer-name" name="sale_customer_name" autoComplete="name" className="input w-full" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          <p className="mt-1 text-xs text-gray-500">{translate('sale_customer_name_secondary_hint', 'Name is the secondary display identity.')}</p>
        </div>
        <div>
          <label htmlFor="sale-customer-membership" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{translate('membership_number', 'Membership number')}</label>
          <input
            id="sale-customer-membership"
            name="sale_customer_membership"
            className={`input w-full font-mono ${membershipCanChange ? '' : 'cursor-default bg-gray-50 text-gray-600 dark:bg-zinc-800 dark:text-gray-300'}`}
            value={membershipNumber}
            onChange={(event) => setMembershipNumber(event.target.value.toUpperCase())}
            readOnly={!membershipCanChange}
            aria-readonly={!membershipCanChange}
            placeholder={translate('membership_number', 'Membership number')}
          />
          <p className="mt-1 text-xs text-gray-500">
            {originalMembership
              ? translate('sale_customer_membership_locked', 'An existing membership number is preserved and cannot be changed here.')
              : canAssignMembership
                ? translate('sale_customer_membership_assign_hint', 'A customer without membership can be assigned an unused membership number.')
                : translate('sale_customer_membership_permission', 'Assigning membership needs Full Contacts permission.')}
          </p>
        </div>
        {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">{error}</div> : null}
        <div className="flex flex-col gap-2 border-t pt-3 dark:border-gray-700 sm:flex-row">
          <button type="button" className="btn-primary flex-1" disabled={saving || !dirty} onClick={() => { void submit() }}>{saving ? translate('saving', 'Saving...') : translate('save', 'Save')}</button>
          <button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>{translate('cancel', 'Cancel')}</button>
        </div>
      </div>
    </Modal>
  )
}
