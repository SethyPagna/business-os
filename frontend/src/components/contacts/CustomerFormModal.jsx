import { useState } from 'react'
import Modal from '../shared/Modal'
import {
  CONTACT_OPTION_LIMIT,
  createContactOption,
  parseStoredContactOptions,
  serializeContactOptions,
} from './contactOptionUtils'
import { generateCustomerMembershipNumber } from './customerMembershipNumber'

function tr(t, key, fallback) {
  const value = typeof t === 'function' ? t(key) : null
  return value && value !== key ? value : fallback
}

function parseContactOptions(raw) {
  return parseStoredContactOptions(raw, { legacyField: 'address' })
}

function OptionEditor({ option, index, total, onChange, onRemove }) {
  const setField = (key, value) => onChange({ ...option, [key]: value })
  const fieldId = (suffix) => `customer-option-${index}-${suffix}`

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2 dark:border-zinc-600 dark:bg-zinc-800/60">
      <div className="flex items-center gap-2">
        <span className="w-5 flex-shrink-0 text-xs font-bold text-gray-400">#{index + 1}</span>
        <input
          id={fieldId('label')}
          name={fieldId('label')}
          autoComplete="off"
          className="input flex-1 text-xs py-1"
          placeholder="Option label"
          value={option.label}
          onChange={(event) => setField('label', event.target.value)}
        />
        {total > 1 ? (
          <button type="button" onClick={onRemove} className="rounded px-1.5 py-1 text-xs text-red-500 hover:text-red-700">
            Remove
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor={fieldId('name')} className="mb-0.5 block text-xs text-gray-400">Name</label>
          <input id={fieldId('name')} name={fieldId('name')} autoComplete="name" className="input text-xs py-1" placeholder="Contact name" value={option.name} onChange={(event) => setField('name', event.target.value)} />
        </div>
        <div>
          <label htmlFor={fieldId('phone')} className="mb-0.5 block text-xs text-gray-400">Phone</label>
          <input id={fieldId('phone')} name={fieldId('phone')} autoComplete="tel" className="input text-xs py-1" placeholder="Phone number" value={option.phone} onChange={(event) => setField('phone', event.target.value)} />
        </div>
      </div>
      <div>
        <label htmlFor={fieldId('email')} className="mb-0.5 block text-xs text-gray-400">Email</label>
        <input id={fieldId('email')} name={fieldId('email')} autoComplete="email" className="input text-xs py-1" type="email" placeholder="Email address" value={option.email} onChange={(event) => setField('email', event.target.value)} />
      </div>
      <div>
        <label htmlFor={fieldId('address')} className="mb-0.5 block text-xs text-gray-400">Address</label>
        <input id={fieldId('address')} name={fieldId('address')} autoComplete="street-address" className="input text-xs py-1" placeholder="Delivery or billing address" value={option.address} onChange={(event) => setField('address', event.target.value)} />
      </div>
    </div>
  )
}

export default function CustomerFormModal({ customer, onSave, onClose, t }) {
  const initial = customer
    ? { ...customer }
    : { name: '', membership_number: generateCustomerMembershipNumber(), phone: '', email: '', company: '', notes: '' }
  const [form, setForm] = useState(initial)
  const [options, setOptions] = useState(() => {
    const parsed = parseContactOptions(initial.address)
    return parsed.length ? parsed : [createContactOption()]
  })
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState('')

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const addOption = () => setOptions((current) => {
    if (current.length >= CONTACT_OPTION_LIMIT) return current
    return [...current, createContactOption()]
  })
  const removeOption = (index) => setOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))
  const updateOption = (index, nextOption) => setOptions((current) => current.map((item, itemIndex) => (itemIndex === index ? nextOption : item)))
  const handleSubmit = async () => {
    if (saving) return
    const name = String(form.name || '').trim()
    const membershipNumber = String(form.membership_number || '').trim()
    if (!name) {
      setLocalError(tr(t, 'name_required', 'Name is required'))
      return
    }
    if (!membershipNumber) {
      setLocalError(tr(t, 'membership_number_required', 'Membership number is required'))
      return
    }
    setLocalError('')
    setSaving(true)
    try {
      await Promise.resolve(onSave({
        ...form,
        name,
        membership_number: membershipNumber.toUpperCase(),
        address: serializeContactOptions(options),
      }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={customer ? `${tr(t, 'edit_customer', 'Edit Customer')}` : tr(t, 'add_customer', 'Add Customer')} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label htmlFor="customer-form-name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr(t, 'name', 'Name')} *</label>
          <input id="customer-form-name" name="customer_name" autoComplete="name" className="input" value={form.name} onChange={(event) => setField('name', event.target.value)} autoFocus />
        </div>

        <div>
          <label htmlFor="customer-form-membership" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {tr(t, 'membership_number', 'Membership number')} *
          </label>
          <div className="flex gap-2">
            <input
              id="customer-form-membership"
              name="customer_membership_number"
              autoComplete="off"
              className="input min-w-0 flex-1"
              value={form.membership_number || ''}
              onChange={(event) => setField('membership_number', event.target.value.toUpperCase())}
              placeholder="LCMN-00000000"
            />
            <button
              type="button"
              className="btn-secondary shrink-0 px-3 text-xs"
              onClick={() => setField('membership_number', generateCustomerMembershipNumber(form.name))}
            >
              {tr(t, 'regenerate', 'Regenerate')}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="customer-form-phone" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr(t, 'phone', 'Phone')}</label>
            <input id="customer-form-phone" name="customer_phone" autoComplete="tel" className="input" value={form.phone || ''} onChange={(event) => setField('phone', event.target.value)} />
          </div>
          <div>
            <label htmlFor="customer-form-email" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr(t, 'email', 'Email')}</label>
            <input id="customer-form-email" name="customer_email" autoComplete="email" className="input" type="email" value={form.email || ''} onChange={(event) => setField('email', event.target.value)} />
          </div>
        </div>

        <div>
          <label htmlFor="customer-form-company" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr(t, 'company', 'Company')}</label>
          <input id="customer-form-company" name="customer_company" autoComplete="organization" className="input" value={form.company || ''} onChange={(event) => setField('company', event.target.value)} />
        </div>

        <div>
          <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Contact Options
              <span className="ml-1.5 text-xs font-normal text-gray-400">Up to {CONTACT_OPTION_LIMIT} names, phones, emails, or addresses</span>
            </label>
            <button type="button" onClick={addOption} disabled={options.length >= CONTACT_OPTION_LIMIT} className="rounded-lg px-2 py-1 text-xs font-medium text-blue-500 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-blue-900/20">
              + Add Option
            </button>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-0.5">
            {options.map((option, index) => (
              <OptionEditor
                key={index}
                option={option}
                index={index}
                total={options.length}
                onChange={(nextOption) => updateOption(index, nextOption)}
                onRemove={() => removeOption(index)}
              />
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="customer-form-notes" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr(t, 'notes', 'Notes')}</label>
          <textarea id="customer-form-notes" name="customer_notes" autoComplete="off" className="input resize-none" rows={2} value={form.notes || ''} onChange={(event) => setField('notes', event.target.value)} />
        </div>

        {localError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
            {localError}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 pt-1 sm:flex-row">
          <button className="btn-primary flex-1" onClick={handleSubmit} disabled={saving}>{saving ? (t('saving') || 'Saving...') : tr(t, 'save', 'Save')}</button>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>{tr(t, 'cancel', 'Cancel')}</button>
        </div>
      </div>
    </Modal>
  )
}
