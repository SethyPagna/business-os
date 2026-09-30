import { useEffect, useState } from 'react'
import Modal from '../shared/Modal.tsx'
import CustomerFormModal from './CustomerFormModal'
import { readContactDuplicateDecisionError, type ContactDuplicateMatch } from './contactDuplicates'
import { getCustomerIdentityById, invalidateCustomerReadCache } from '../../api/contactReadTransport.ts'
import { createCustomer, updateCustomer } from '../../api/contactWriteTransport.ts'
import { buildCustomerSourcePayload, customerSourceRestorePayload, type CustomerSource } from './customerSource.ts'

type TranslateFn = (key: string) => string | undefined
type CustomerRow = Record<string, unknown> & { id?: number | string; name?: string; updated_at?: string }

export type CustomerSourceSaved = { before: CustomerRow | null; record: CustomerRow }
export type CustomerSourceHistoryAction = { label: string; undo: () => Promise<void>; redo: () => Promise<void> }

function firstRow(data: unknown, id: number | string): CustomerRow | null {
  const rows = Array.isArray(data) ? data : Array.isArray((data as { items?: unknown } | null)?.items) ? (data as { items: unknown[] }).items : []
  return (rows.find((row) => String((row as CustomerRow)?.id) === String(id)) as CustomerRow | undefined) || null
}

function tr(t: TranslateFn, key: string, fallback: string): string {
  const value = t(key)
  return value && value !== key ? value : fallback
}

// One customer sheet for the POS and the sales flow (owner, 30 Sep 2026). It is the
// same form as Contacts; the Worker narrows what a request with a `source` may
// change (name, phone, email, address, notes, gender) and records it in the audit
// log and, from a sale, on the sale's records.
export default function CustomerSourceModal({ customerId = null, source, t, notify, pushAction, onSaved, onUseExisting, onClose }: {
  customerId?: number | string | null
  source: CustomerSource
  t: TranslateFn
  notify: (message: string, type?: string) => void
  pushAction?: (action: CustomerSourceHistoryAction) => void
  onSaved: (saved: CustomerSourceSaved) => void | Promise<void>
  onUseExisting?: (match: ContactDuplicateMatch) => void | Promise<void>
  onClose: () => void
}) {
  const [loaded, setLoaded] = useState<CustomerRow | null>(null)
  const [loadError, setLoadError] = useState('')
  const editing = customerId != null

  useEffect(() => {
    if (!editing) return undefined
    let cancelled = false
    invalidateCustomerReadCache()
    getCustomerIdentityById(customerId)
      .then((data) => {
        if (cancelled) return
        const row = firstRow(data, customerId)
        if (row) setLoaded(row)
        else setLoadError(tr(t, 'customer_edit_not_found', 'This customer could not be loaded.'))
      })
      .catch((error) => { if (!cancelled) setLoadError(error instanceof Error ? error.message : tr(t, 'customer_edit_not_found', 'This customer could not be loaded.')) })
    return () => { cancelled = true }
  }, [customerId, editing]) // t only words the error, so a new translator must not refetch

  if (editing && !loaded) {
    return (
      <Modal title={tr(t, 'edit_customer', 'Edit Customer')} onClose={onClose} unsavedChanges="read-only" size="sm">
        {loadError
          ? <div role="alert" className="text-sm text-red-600">{loadError}</div>
          : <p role="status" className="text-sm text-gray-500">{tr(t, 'loading', 'Loading...')}</p>}
      </Modal>
    )
  }

  const save = async (form: Record<string, unknown>) => {
    try {
      const payload = buildCustomerSourcePayload(form, loaded, source)
      const record = (editing
        ? await updateCustomer(customerId, payload)
        : await createCustomer(payload)) as CustomerRow | null
      if (!record || (record as { success?: boolean }).success === false) {
        notify(String((record as { error?: unknown } | null)?.error || tr(t, 'update_failed', 'Failed')), 'error')
        return { success: false }
      }
      invalidateCustomerReadCache()
      if (editing && loaded && pushAction) {
        const before = loaded
        const after = { ...before, ...record }
        pushAction({
          label: `${tr(t, 'edit_customer', 'Edit Customer')} ${String(before.name || '')}`.trim(),
          undo: async () => { await updateCustomer(before.id as number | string, customerSourceRestorePayload(before, source)); invalidateCustomerReadCache() },
          redo: async () => { await updateCustomer(after.id as number | string, customerSourceRestorePayload(after, source)); invalidateCustomerReadCache() },
        })
      }
      notify(editing ? tr(t, 'customer_updated', 'Customer updated') : tr(t, 'customer_added', 'Customer added'))
      await onSaved({ before: loaded, record })
      onClose()
      return { success: true }
    } catch (error) {
      const duplicateDecisionRequired = readContactDuplicateDecisionError(error)
      if (duplicateDecisionRequired) return { duplicateDecisionRequired }
      notify(error instanceof Error ? error.message : tr(t, 'update_failed', 'Failed'), 'error')
      return { success: false }
    }
  }

  return (
    <CustomerFormModal
      customer={loaded}
      onSave={save}
      onUseExisting={async (match) => { await onUseExisting?.(match) }}
      onClose={onClose}
      t={t}
    />
  )
}
