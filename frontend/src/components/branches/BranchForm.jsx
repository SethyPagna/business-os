import { useState } from 'react'
import { useApp } from '../../AppContext'

/**
 * 1. Branch Form Component
 * 1.1 Purpose
 * - Create/update a branch profile.
 * - Validate required branch name before save.
 * - Toggle default branch and active state flags.
 */
export default function BranchForm({ branch, onSave, onClose }) {
  const { t, settings } = useApp()

  /**
   * 2. Local Form State
   * 2.1 Hydrates from `branch` when editing.
   */
  const [form, setForm] = useState({
    name: branch?.name || '',
    location: branch?.location || '',
    phone: branch?.phone || '',
    manager: branch?.manager || '',
    notes: branch?.notes || '',
    is_default: branch?.is_default || 0,
    is_active: branch?.is_active ?? 1,
  })
  const [saving, setSaving] = useState(false)
  const [nameTouched, setNameTouched] = useState(false)

  /**
   * 2.1.1 Generic field mutator.
   */
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  const branchDefaultHint = settings?.language === 'km'
    ? 'ការលក់ថ្មី និងការកែសម្រួលស្តុក នឹងយកសាខានេះជាលំនាំដើម។'
    : 'New sales and stock adjustments default to this branch.'

  const nameInvalid = !form.name.trim()

  /**
   * 3. Save Action
   * 3.1 Block save until required fields are valid.
   */
  const handleSave = async () => {
    setNameTouched(true)
    if (nameInvalid) return
    setSaving(true)
    await onSave(form)
    setSaving(false)
    onClose()
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        handleSave()
      }}
    >
      <div>
        <label htmlFor="branch-name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('branch_name') || 'Branch Name'} *
        </label>
        <input
          id="branch-name"
          name="branch_name"
          className="input"
          value={form.name}
          onBlur={() => setNameTouched(true)}
          onChange={(event) => set('name', event.target.value)}
          placeholder={t('branch_name_placeholder') || 'e.g. Main Store, Warehouse A'}
          autoFocus
          required
          autoComplete="organization"
          aria-invalid={nameTouched && nameInvalid ? 'true' : 'false'}
        />
        {nameTouched && nameInvalid ? (
          <p className="mt-1 text-xs text-red-500">{t('branch_required') || 'Branch is required'}</p>
        ) : null}
      </div>

      <div>
        <label htmlFor="branch-location" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('location') || 'Location'} / {t('address') || 'Address'}
        </label>
        <input
          id="branch-location"
          name="branch_location"
          className="input"
          value={form.location}
          onChange={(event) => set('location', event.target.value)}
          placeholder={t('location_placeholder') || 'e.g. 123 Main St, Phnom Penh'}
          autoComplete="street-address"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="branch-phone" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('phone') || 'Phone'}
          </label>
          <input
            id="branch-phone"
            name="branch_phone"
            className="input"
            value={form.phone}
            onChange={(event) => set('phone', event.target.value)}
            placeholder={t('branch_phone_placeholder') || '012 345 678'}
            autoComplete="tel"
          />
        </div>

        <div>
          <label htmlFor="branch-manager" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('manager') || 'Manager'}
          </label>
          <input
            id="branch-manager"
            name="branch_manager"
            className="input"
            value={form.manager}
            onChange={(event) => set('manager', event.target.value)}
            placeholder={t('manager_placeholder') || 'Manager name'}
            autoComplete="name"
          />
        </div>
      </div>

      <div>
        <label htmlFor="branch-notes" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('notes') || 'Notes'}
        </label>
        <textarea
          id="branch-notes"
          name="branch_notes"
          className="input resize-none"
          rows={2}
          value={form.notes}
          onChange={(event) => set('notes', event.target.value)}
          placeholder={t('notes_placeholder') || 'Any notes...'}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-700 dark:bg-blue-900/20">
          <input
            id="branch-default"
            name="branch_default"
            aria-label="Set branch as default"
            type="checkbox"
            checked={!!form.is_default}
            onChange={(event) => set('is_default', event.target.checked ? 1 : 0)}
            className="h-4 w-4"
          />
          <div>
            <div className="text-sm font-medium text-blue-700 dark:text-blue-300">{t('set_default')}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{branchDefaultHint}</div>
          </div>
        </label>

        {branch ? (
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-gray-200 p-3 dark:border-gray-600">
            <input
              id="branch-active"
              name="branch_active"
              aria-label="Set branch active"
              type="checkbox"
              checked={!!form.is_active}
              onChange={(event) => set('is_active', event.target.checked ? 1 : 0)}
              className="h-4 w-4"
            />
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('active')}</div>
          </label>
        ) : null}
      </div>

      <div className="flex gap-3 pt-2">
        <button className="btn-primary flex-1" type="submit" disabled={saving || nameInvalid}>
          {saving ? t('saving') : (t('save_branch') || 'Save Branch')}
        </button>
        <button className="btn-secondary" type="button" onClick={onClose}>
          {t('cancel')}
        </button>
      </div>
    </form>
  )
}
