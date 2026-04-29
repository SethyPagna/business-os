import { useEffect, useMemo, useRef, useState } from 'react'
import { MoreHorizontal, X } from 'lucide-react'
import Modal from '../shared/Modal'
import FilePickerModal from '../files/FilePickerModal'
import PortalMenu from '../shared/PortalMenu'
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
      const validIds = new Set(rowIds)
      const nextIds = [...previous].filter((id) => validIds.has(Number(id)))
      if (nextIds.length === previous.size && nextIds.every((id) => previous.has(id))) return previous
      return new Set(nextIds)
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
    setSelectedIds,
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
  const items = [
    onDetails && { label: 'Details', onClick: onDetails },
    onEdit && { label: 'Edit', onClick: onEdit, color: 'blue' },
    onDelete && 'divider',
    onDelete && { label: 'Delete', onClick: onDelete, color: 'red' },
  ].filter(Boolean)

  const menuContent = ({ closeMenu }) => (
    <>
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-700">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Actions</div>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          onClick={closeMenu}
          aria-label="Close actions menu"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="py-1">
        {items.map((item, index) => (
          item === 'divider'
            ? <div key={`divider-${index}`} className="my-1 border-t border-gray-100 dark:border-gray-700" />
            : (
              <button
                key={`action-${index}`}
                type="button"
                className={`w-full px-4 py-2.5 text-left text-sm font-medium transition-colors ${
                  item.color === 'red'
                    ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20'
                    : item.color === 'blue'
                      ? 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20'
                      : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700'
                }`}
                onClick={() => {
                  closeMenu()
                  item.onClick?.()
                }}
              >
                {item.label}
              </button>
            )
        ))}
      </div>
    </>
  )

  return (
    <PortalMenu
      trigger={(
        <button
          type="button"
          aria-label="Open actions"
          name="contact_row_actions"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:border-zinc-700 dark:text-gray-400 dark:hover:bg-zinc-800 dark:hover:text-gray-200"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      )}
      content={menuContent}
      menuClassName="min-w-[190px] p-0"
    />
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

  if (loading && !rows.length) {
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
      {loading ? (
        <div className="mb-2 rounded-xl border border-blue-100 bg-blue-50/80 px-3 py-2 text-xs text-blue-600 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300">
          Refreshing...
        </div>
      ) : null}
      <div className="hidden overflow-x-auto rounded-xl border border-gray-200 dark:border-zinc-700 md:block">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-zinc-800 dark:text-gray-400">
            <tr>
              <th className="w-10 px-3 py-2">
                <label htmlFor="contacts-select-all" className="sr-only">Select all contacts</label>
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
function parseCsvText(text) {
  const lines = String(text || '').trim().split('\n').filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((header) => header.trim().replace(/"/g, '').toLowerCase())
  return lines.slice(1).map((line, index) => {
    const values = line.match(/(\".*?\"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) || line.split(',')
    const row = {}
    headers.forEach((header, headerIndex) => {
      row[header] = String(values[headerIndex] || '').trim().replace(/^\"|\"$/g, '')
    })
    return { row, rowNumber: index + 2 }
  }).filter((entry) => String(entry.row?.name || '').trim())
}

const CONTACT_IMPORT_CONFIG = {
  customer: {
    label: 'Customers',
    importer: () => window.api.bulkImportCustomers,
    loader: () => window.api.getCustomers,
    fields: ['name', 'membership_number', 'contact_options', 'phone', 'email', 'address', 'company', 'notes'],
    match(existingRows, incoming) {
      const incomingMembership = String(incoming.membership_number || '').trim().toLowerCase()
      const incomingPhone = String(incoming.phone || '').trim()
      const incomingName = String(incoming.name || '').trim().toLowerCase()
      return existingRows.find((row) => (
        (incomingMembership && String(row.membership_number || '').trim().toLowerCase() === incomingMembership)
        || (incomingPhone && String(row.phone || '').trim() === incomingPhone)
        || (incomingName && String(row.name || '').trim().toLowerCase() === incomingName)
      )) || null
    },
  },
  supplier: {
    label: 'Suppliers',
    importer: () => window.api.bulkImportSuppliers,
    loader: () => window.api.getSuppliers,
    fields: ['name', 'contact_options', 'phone', 'email', 'address', 'company', 'contact_person', 'notes'],
    match(existingRows, incoming) {
      const incomingName = String(incoming.name || '').trim().toLowerCase()
      const incomingPhone = String(incoming.phone || '').trim()
      return existingRows.find((row) => (
        (incomingName && String(row.name || '').trim().toLowerCase() === incomingName)
        || (incomingPhone && String(row.phone || '').trim() === incomingPhone)
      )) || null
    },
  },
  deliveryContact: {
    label: 'Delivery',
    importer: () => window.api.bulkImportDeliveryContacts,
    loader: () => window.api.getDeliveryContacts,
    fields: ['name', 'contact_options', 'phone', 'area', 'address', 'notes'],
    match(existingRows, incoming) {
      const incomingName = String(incoming.name || '').trim().toLowerCase()
      const incomingPhone = String(incoming.phone || '').trim()
      return existingRows.find((row) => (
        (incomingName && String(row.name || '').trim().toLowerCase() === incomingName)
        || (incomingPhone && String(row.phone || '').trim() === incomingPhone)
      )) || null
    },
  },
}

export function ImportModal({ type, onClose, onDone }) {
  const { user, notify, t } = useApp()
  const config = CONTACT_IMPORT_CONFIG[type]
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState('')
  const [conflictMode, setConflictMode] = useState('merge')
  const [fieldRules, setFieldRules] = useState({})
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [filesOpen, setFilesOpen] = useState(false)
  const [previewRows, setPreviewRows] = useState([])
  const [selectedConflictIds, setSelectedConflictIds] = useState(() => new Set())
  const [rowModes, setRowModes] = useState({})

  const typeLabel = config?.label || 'Contacts'
  const importer = config?.importer?.()
  const loadExisting = config?.loader?.()
  const fieldList = config?.fields || []
  const conflictRows = useMemo(() => previewRows.filter((entry) => !!entry.existing), [previewRows])

  const analyzeCsv = async (text, name) => {
    if (!config) return
    const parsedRows = parseCsvText(text)
    setCsvText(String(text || ''))
    setFileName(String(name || 'contacts.csv'))
    setResult(null)
    setPreviewRows([])
    setSelectedConflictIds(new Set())
    setRowModes({})

    if (!parsedRows.length) {
      notify('Choose a CSV with at least one data row.', 'error')
      return
    }

    setLoading(true)
    try {
      const existingRows = await loadExisting()
      const safeExistingRows = Array.isArray(existingRows) ? existingRows : []
      const nextPreview = parsedRows.map((entry, index) => {
        const existing = config.match(safeExistingRows, entry.row)
        return {
          id: index,
          rowNumber: entry.rowNumber,
          row: entry.row,
          existing,
        }
      })
      const nextRowModes = {}
      nextPreview.forEach((entry) => {
        nextRowModes[entry.id] = entry.existing ? conflictMode : 'new'
      })
      setPreviewRows(nextPreview)
      setRowModes(nextRowModes)
      setSelectedConflictIds(new Set(nextPreview.filter((entry) => entry.existing).map((entry) => entry.id)))
    } catch (error) {
      notify(error?.message || 'Failed to analyze import file', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handlePickFile = async () => {
    const picked = await window.api.openCSVDialog?.()
    if (!picked?.content) return
    await analyzeCsv(picked.content, picked.name || 'contacts.csv')
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
      const authToken = window.api.getAuthSessionToken?.()
      if (authToken) headers['x-auth-session'] = authToken
      const response = await fetch(`${baseUrl}${path}`, { headers })
      if (!response.ok) throw new Error(`Could not read ${asset?.original_name || path}`)
      await analyzeCsv(await response.text(), asset?.original_name || path.split('/').pop() || 'contacts.csv')
    } catch (error) {
      notify(error?.message || 'Failed to load CSV from Files', 'error')
    }
  }

  const handleDownloadTemplate = () => {
    window.api.downloadImportTemplate(type)
  }

  const toggleConflictSelection = (rowId) => {
    setSelectedConflictIds((previous) => {
      const next = new Set(previous)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })
  }

  const applyModeToSelected = (mode) => {
    setRowModes((previous) => {
      const next = { ...previous }
      previewRows.forEach((entry) => {
        if (entry.existing && selectedConflictIds.has(entry.id)) next[entry.id] = mode
      })
      return next
    })
  }

  const toggleSelectAllConflicts = (checked) => {
    if (!checked) {
      setSelectedConflictIds(new Set())
      return
    }
    setSelectedConflictIds(new Set(conflictRows.map((entry) => entry.id)))
  }

  const handleImport = async () => {
    if (!importer) {
      notify('Unsupported import type', 'error')
      return
    }
    if (!previewRows.length) {
      notify('Choose a CSV file first.', 'error')
      return
    }

    setLoading(true)
    try {
      const response = await importer({
        rows: previewRows.map((entry) => ({
          ...entry.row,
          _rowNumber: entry.rowNumber,
          _conflict_mode: rowModes[entry.id] || (entry.existing ? conflictMode : 'merge'),
          _field_rules: entry.existing ? fieldRules : {},
        })),
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

  const selectedConflictCount = selectedConflictIds.size
  const unresolvedConflicts = conflictRows.filter((entry) => !rowModes[entry.id] || rowModes[entry.id] === 'ask').length

  return (
    <Modal title={`Import ${typeLabel}`} onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Review matched rows, select the conflicts you want to change together, then apply row actions and field rules before importing.
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

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor="contacts-conflict-mode" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Default conflict action
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
          <div className="grid grid-cols-2 gap-2">
            {fieldList.filter((field) => field !== 'name').slice(0, 6).map((field) => (
              <div key={field}>
                <label htmlFor={`contacts-field-rule-${field}`} className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {field === 'contact_options' ? 'contact options' : field.replaceAll('_', ' ')}
                </label>
                <select
                  id={`contacts-field-rule-${field}`}
                  className="input text-sm"
                  value={fieldRules[field] || 'merge_blank_only'}
                  onChange={(event) => setFieldRules((current) => ({ ...current, [field]: event.target.value }))}
                >
                  <option value="merge_blank_only">Fill blanks only</option>
                  <option value="use_imported">Use imported value</option>
                  <option value="keep_existing">Keep existing value</option>
                  <option value="clear_value">Clear value</option>
                </select>
              </div>
            ))}
          </div>
        </div>

        {previewRows.length ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-slate-50 p-2 dark:bg-zinc-800/70">
                <div className="text-lg font-bold text-slate-700 dark:text-slate-200">{previewRows.length}</div>
                <div className="text-slate-500 dark:text-slate-400">Rows</div>
              </div>
              <div className="rounded-lg bg-yellow-50 p-2 dark:bg-yellow-900/20">
                <div className="text-lg font-bold text-yellow-700 dark:text-yellow-300">{conflictRows.length}</div>
                <div className="text-yellow-600 dark:text-yellow-400">Matches</div>
              </div>
              <div className="rounded-lg bg-blue-50 p-2 dark:bg-blue-900/20">
                <div className="text-lg font-bold text-blue-700 dark:text-blue-300">{selectedConflictCount}</div>
                <div className="text-blue-600 dark:text-blue-400">Selected conflicts</div>
              </div>
            </div>

            {conflictRows.length ? (
              <div className="rounded-xl border border-gray-200 p-3 dark:border-zinc-700">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={selectedConflictCount > 0 && selectedConflictCount === conflictRows.length}
                      onChange={(event) => toggleSelectAllConflicts(event.target.checked)}
                    />
                    All matches
                  </label>
                  <button type="button" className="btn-secondary text-xs" onClick={() => applyModeToSelected('skip')}>Skip selected</button>
                  <button type="button" className="btn-secondary text-xs" onClick={() => applyModeToSelected('merge')}>Merge selected</button>
                  <button type="button" className="btn-secondary text-xs" onClick={() => applyModeToSelected('overwrite')}>Overwrite selected</button>
                </div>
              </div>
            ) : null}

            <div className="max-h-[46vh] overflow-auto rounded-xl border border-gray-200 dark:border-zinc-700">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-zinc-800 dark:text-gray-400">
                  <tr>
                    <th className="w-10 px-3 py-2" />
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Match</th>
                    <th className="px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                  {previewRows.map((entry) => (
                    <tr key={entry.id} className="align-top">
                      <td className="px-3 py-2">
                        {entry.existing ? (
                          <input
                            type="checkbox"
                            checked={selectedConflictIds.has(entry.id)}
                            onChange={() => toggleConflictSelection(entry.id)}
                            aria-label={`Select conflict row ${entry.rowNumber}`}
                          />
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">{entry.rowNumber}</td>
                      <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                        <div>{entry.row.name}</div>
                        {type === 'customer' && entry.row.membership_number ? (
                          <div className="font-mono text-[11px] text-gray-400">{entry.row.membership_number}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                        {entry.existing ? (
                          <div>
                            <div>{entry.existing.name || '-'}</div>
                            {type === 'customer' && entry.existing.membership_number ? (
                              <div className="font-mono text-[11px]">{entry.existing.membership_number}</div>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-emerald-600 dark:text-emerald-400">New</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {entry.existing ? (
                          <select
                            className="input text-sm"
                            value={rowModes[entry.id] || conflictMode}
                            onChange={(event) => setRowModes((current) => ({ ...current, [entry.id]: event.target.value }))}
                          >
                            <option value="skip">Skip</option>
                            <option value="merge">Merge</option>
                            <option value="overwrite">Overwrite</option>
                          </select>
                        ) : (
                          <span className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                            Create
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {unresolvedConflicts > 0 ? (
              <div className="rounded-lg bg-yellow-50 p-2 text-xs text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300">
                {unresolvedConflicts} conflict row(s) still need an action.
              </div>
            ) : null}
          </div>
        ) : null}

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
          <button type="button" className="btn-primary flex-1" disabled={loading || unresolvedConflicts > 0 || !previewRows.length} onClick={handleImport}>
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
