import { useEffect, useMemo, useRef, useState } from 'react'
import Modal from '../shared/Modal'
import FilePickerModal from '../files/FilePickerModal'
import { useApp } from '../../AppContext'

/**
 * 1. useContactSelection
 * 1.1 Centralizes table/card multi-select behavior for all contacts tabs.
 * 1.2 Drops stale selections when a filtered dataset removes rows from view.
 */
export function useContactSelection(rows = []) {
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const rowIds = useMemo(
    () => rows.map((row) => Number(row?.id)).filter((id) => Number.isFinite(id)),
    [rows],
  )

  useEffect(() => {
    setSelectedIds((previous) => {
      const next = new Set([...previous].filter((id) => rowIds.includes(Number(id))))
      return next
    })
  }, [rowIds])

  const toggleOne = (id) => {
    const numericId = Number(id)
    if (!Number.isFinite(numericId)) return
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(numericId)) next.delete(numericId)
      else next.add(numericId)
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  const selectAllProp = {
    checked: rowIds.length > 0 && selectedIds.size === rowIds.length,
    indeterminate: selectedIds.size > 0 && selectedIds.size < rowIds.length,
    onChange: (checked) => {
      if (!checked) {
        clearSelection()
        return
      }
      setSelectedIds(new Set(rowIds))
    },
  }

  return {
    selectedIds,
    toggleOne,
    clearSelection,
    selectAllProp,
  }
}

/**
 * 2. ThreeDotMenu
 * 2.1 Reusable row-action popup for customer/supplier/delivery lists.
 */
export function ThreeDotMenu({ onDetails, onEdit, onDelete }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Open actions"
        name="contact_row_actions"
        className="rounded-md border border-gray-200 px-2 py-1 text-gray-500 hover:bg-gray-50 hover:text-gray-700 dark:border-zinc-700 dark:text-gray-400 dark:hover:bg-zinc-800 dark:hover:text-gray-200"
        onClick={() => setOpen((value) => !value)}
      >
        ...
      </button>
      {open ? (
        <div
          className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          onMouseLeave={() => setOpen(false)}
        >
          <button
            type="button"
            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-zinc-800"
            onClick={() => {
              setOpen(false)
              onDetails?.()
            }}
          >
            Details
          </button>
          <button
            type="button"
            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-zinc-800"
            onClick={() => {
              setOpen(false)
              onEdit?.()
            }}
          >
            Edit
          </button>
          <button
            type="button"
            className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
            onClick={() => {
              setOpen(false)
              onDelete?.()
            }}
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * 3. DetailModal
 * 3.1 Generic key-value detail viewer for all contacts entity types.
 */
export function DetailModal({ item, fields = [], onEdit, onDelete, onClose, t }) {
  const title = item?.name || (typeof t === 'function' ? (t('details') || 'Details') : 'Details')

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
        <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-gray-200 dark:border-zinc-700">
          {fields.map(([label, value], index) => (
            <div
              key={`${String(label)}-${index}`}
              className="grid grid-cols-[140px,1fr] gap-3 border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 dark:border-zinc-800"
            >
              <div className="font-medium text-gray-500 dark:text-gray-400">{label || '-'}</div>
              <div className="whitespace-pre-line text-gray-800 dark:text-gray-200">{value || '-'}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={onEdit}>Edit</button>
          <button type="button" className="btn-secondary flex-1 border-red-300 text-red-600 dark:border-red-500/40 dark:text-red-400" onClick={onDelete}>Delete</button>
          <button type="button" className="btn-primary flex-1" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * 4. ContactTable
 * 4.1 Shared desktop table shell + mobile card container for contacts tabs.
 */
export function ContactTable({
  loading,
  rows = [],
  emptyLabel = 'No records',
  columns = [],
  selectAll,
  renderRow,
  renderCard,
}) {
  const selectAllRef = useRef(null)

  useEffect(() => {
    if (!selectAllRef.current) return
    selectAllRef.current.indeterminate = !!selectAll?.indeterminate
  }, [selectAll?.indeterminate])

  if (loading) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500 dark:border-zinc-700 dark:text-gray-400">
        Loading...
      </div>
    )
  }

  if (!rows.length) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500 dark:border-zinc-700 dark:text-gray-400">
        {emptyLabel}
      </div>
    )
  }

  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-gray-200 dark:border-zinc-700 md:block">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-zinc-800 dark:text-gray-400">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  ref={selectAllRef}
                  id="contacts-select-all"
                  name="contacts_select_all"
                  aria-label="Select all contacts"
                  type="checkbox"
                  className="h-4 w-4 rounded"
                  checked={!!selectAll?.checked}
                  onChange={(event) => selectAll?.onChange?.(event.target.checked)}
                />
              </th>
              {columns.map((column) => (
                <th key={String(column)} className="px-4 py-2">{column}</th>
              ))}
              <th className="w-12 px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
            {rows.map((row) => renderRow?.(row))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 md:hidden">
        {rows.map((row) => renderCard?.(row))}
      </div>
    </>
  )
}

/**
 * 5. ImportModal
 * 5.1 Shared CSV import surface for customers/suppliers/delivery contacts.
 * 5.2 Enforces explicit conflict mode before submit.
 */
export function ImportModal({ type, onClose, onDone }) {
  const { user, notify, t } = useApp()
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState('')
  const [conflictMode, setConflictMode] = useState('merge')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [filesOpen, setFilesOpen] = useState(false)

  const typeLabel = type === 'customer'
    ? (t('customers') || 'Customers')
    : type === 'supplier'
      ? (t('suppliers') || 'Suppliers')
      : (t('pos_delivery') || 'Delivery')

  const importer = {
    customer: window.api.bulkImportCustomers,
    supplier: window.api.bulkImportSuppliers,
    deliveryContact: window.api.bulkImportDeliveryContacts,
  }[type]

  const handlePickFile = async () => {
    const picked = await window.api.openCSVDialog?.()
    if (!picked?.content) return
    setCsvText(String(picked.content))
    setFileName(String(picked.name || 'contacts.csv'))
    setResult(null)
  }

  const handleChooseExistingFile = async (publicPath, asset) => {
    const path = String(publicPath || '').trim()
    if (!path) return
    if (!/\.csv($|\?)/i.test(path) && asset?.mime_type !== 'text/csv') {
      notify('Choose a CSV file from Files.', 'error')
      return
    }
    try {
      const baseUrl = String(window.api.getSyncServerUrl?.() || '').replace(/\/$/, '')
      const headers = { 'bypass-tunnel-reminder': 'true' }
      const syncToken = window.api.getSyncToken?.()
      if (syncToken) headers['x-sync-token'] = syncToken
      const response = await fetch(`${baseUrl}${path}`, { headers })
      if (!response.ok) throw new Error(`Could not read ${asset?.original_name || path}`)
      setCsvText(await response.text())
      setFileName(asset?.original_name || path.split('/').pop() || 'contacts.csv')
      setResult(null)
    } catch (error) {
      notify(error?.message || 'Failed to load CSV from Files', 'error')
    }
  }

  const handleDownloadTemplate = () => {
    window.api.downloadImportTemplate(type)
  }

  const handleImport = async () => {
    if (!importer) {
      notify('Unsupported import type', 'error')
      return
    }
    if (!String(csvText || '').trim()) {
      notify('Choose a CSV file first.', 'error')
      return
    }

    setLoading(true)
    try {
      const response = await importer({
        csvText,
        conflictMode,
        userId: user?.id,
        userName: user?.name,
      })
      setResult(response || null)
      if (response?.success !== false) {
        notify('Import finished', 'success')
        onDone?.()
      }
    } catch (error) {
      notify(error?.message || 'Import failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title={`Import ${typeLabel}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Upload a CSV file and choose how conflicts should be handled.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={handleDownloadTemplate}>
            Download template
          </button>
          <button type="button" className="btn-secondary text-sm" onClick={handlePickFile}>
            Choose CSV
          </button>
          <button type="button" className="btn-secondary text-sm" onClick={() => setFilesOpen(true)}>
            Files
          </button>
          <div className="min-w-0 flex-1 truncate rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-400">
            {fileName || 'No file selected'}
          </div>
        </div>
        <div>
          <label htmlFor="contacts-conflict-mode" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Conflict handling
          </label>
          <select
            id="contacts-conflict-mode"
            name="contacts_conflict_mode"
            className="input"
            value={conflictMode}
            onChange={(event) => setConflictMode(event.target.value)}
          >
            <option value="skip">Skip existing records</option>
            <option value="merge">Merge into empty fields</option>
            <option value="overwrite">Overwrite existing records</option>
          </select>
        </div>
        {result ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-800/70">
            <div>Imported: {Number(result?.imported || 0)}</div>
            {Array.isArray(result?.errors) && result.errors.length ? (
              <div className="mt-2 max-h-32 overflow-y-auto rounded border border-red-200 bg-red-50 p-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-300">
                {result.errors.map((message, index) => <div key={`${message}-${index}`}>{message}</div>)}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex gap-2">
          <button type="button" className="btn-primary flex-1" disabled={loading} onClick={handleImport}>
            {loading ? 'Importing...' : 'Import'}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
      <FilePickerModal
        open={filesOpen}
        title="Choose CSV from Files"
        mediaType="document"
        onClose={() => setFilesOpen(false)}
        onSelect={handleChooseExistingFile}
      />
    </Modal>
  )
}
