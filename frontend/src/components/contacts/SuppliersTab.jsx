import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronRight, Download, Plus, Upload } from 'lucide-react'
import { useMemo } from 'react'
import { useRef } from 'react'
import { useApp, useSync } from '../../AppContext'
import { downloadCSV } from '../../utils/csv'
import { fmtDate } from '../../utils/formatters'
import Modal from '../shared/Modal'
import FilterMenu from '../shared/FilterMenu'
import ActionHistoryBar from '../shared/ActionHistoryBar.jsx'
import { ThreeDotMenu, DetailModal, ImportModal, ContactTable, useContactSelection } from './shared'
import { withLoaderTimeout } from '../../utils/loaders.mjs'
import { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent } from '../../utils/loaders.mjs'
import { buildTimeActionSections, getAvailableYears, getTimeGroupingMode } from '../../utils/groupedRecords.mjs'
import { useActionHistory } from '../../utils/actionHistory.mjs'
import {
  CONTACT_OPTION_LIMIT,
  buildContactOptionSummary,
  createContactOption,
  getPrimaryContactOption,
  parseContactOptionsFromImportRow,
  parseStoredContactOptions,
  serializeContactOptions,
} from './contactOptionUtils'

function SupplierForm({ supplier, onSave, onClose, t }) {
  const init = supplier
    ? { ...supplier }
    : { name: '', phone: '', email: '', company: '', contact_person: '', address: '', notes: '' }
  const [form, setForm] = useState(init)
  const [options, setOptions] = useState(() => {
    const parsed = parseStoredContactOptions(init.address, { legacyField: 'address' })
    if (parsed.length) return parsed
    return [createContactOption({
      name: init.contact_person || '',
      phone: init.phone || '',
      email: init.email || '',
      address: init.address || '',
    })]
  })
  const [saving, setSaving] = useState(false)
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const addOption = () => setOptions((current) => {
    if (current.length >= CONTACT_OPTION_LIMIT) return current
    return [...current, createContactOption()]
  })
  const updateOption = (index, nextOption) => setOptions((current) => current.map((option, itemIndex) => (itemIndex === index ? nextOption : option)))
  const removeOption = (index) => setOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))
  const handleSubmit = async () => {
    if (saving) return
    setSaving(true)
    try {
      const primaryOption = getPrimaryContactOption(options)
      await Promise.resolve(onSave({
        ...form,
        phone: primaryOption.phone || form.phone || '',
        email: primaryOption.email || form.email || '',
        address: serializeContactOptions(options),
        contact_person: primaryOption.name || form.contact_person || '',
      }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={supplier ? `✏️ ${t('edit_supplier') || 'Edit Supplier'}` : `➕ ${t('add_supplier') || 'Add Supplier'}`} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label htmlFor="supplier-form-name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('name')} *</label>
          <input id="supplier-form-name" name="supplier_name" className="input" value={form.name} onChange={(event) => set('name', event.target.value)} autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="supplier-form-company" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('company')}</label>
            <input id="supplier-form-company" name="supplier_company" className="input" value={form.company || ''} onChange={(event) => set('company', event.target.value)} />
          </div>
          <div>
            <label htmlFor="supplier-form-contact-person" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('contact_person') || 'Contact Person'}</label>
            <input id="supplier-form-contact-person" name="supplier_contact_person" className="input" value={form.contact_person || ''} onChange={(event) => set('contact_person', event.target.value)} />
          </div>
        </div>
        <div>
          <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Contact Options
              <span className="ml-1.5 text-xs font-normal text-gray-400">Up to {CONTACT_OPTION_LIMIT} supplier contacts</span>
            </label>
            <button type="button" onClick={addOption} disabled={options.length >= CONTACT_OPTION_LIMIT} className="rounded-lg px-2 py-1 text-xs font-medium text-blue-500 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-blue-900/20">
              + Add Option
            </button>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-0.5">
            {options.map((option, index) => (
              <div key={`supplier-option-${index}`} className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2 dark:border-zinc-600 dark:bg-zinc-800/60">
                <div className="flex items-center gap-2">
                  <span className="w-5 flex-shrink-0 text-xs font-bold text-gray-400">#{index + 1}</span>
                  <input className="input flex-1 text-xs py-1" placeholder="Option label" value={option.label || ''} onChange={(event) => updateOption(index, { ...option, label: event.target.value })} />
                  {options.length > 1 ? <button type="button" onClick={() => removeOption(index)} className="rounded px-1.5 py-1 text-xs text-red-500 hover:text-red-700">Remove</button> : null}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label className="mb-0.5 block text-xs text-gray-400">Name</label>
                    <input className="input text-xs py-1" placeholder="Contact name" value={option.name || ''} onChange={(event) => updateOption(index, { ...option, name: event.target.value })} />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-xs text-gray-400">Phone</label>
                    <input className="input text-xs py-1" placeholder="Phone number" value={option.phone || ''} onChange={(event) => updateOption(index, { ...option, phone: event.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-gray-400">Email</label>
                  <input className="input text-xs py-1" type="email" placeholder="Email address" value={option.email || ''} onChange={(event) => updateOption(index, { ...option, email: event.target.value })} />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-gray-400">Address</label>
                  <input className="input text-xs py-1" placeholder="Office or pickup address" value={option.address || ''} onChange={(event) => updateOption(index, { ...option, address: event.target.value })} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="supplier-form-notes" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('notes') || 'Notes'}</label>
          <textarea id="supplier-form-notes" name="supplier_notes" className="input resize-none" rows={2} value={form.notes || ''} onChange={(event) => set('notes', event.target.value)} />
        </div>
        <div className="flex gap-3 pt-1">
          <button className="btn-primary flex-1" onClick={handleSubmit} disabled={saving}>{saving ? (t('saving') || 'Saving...') : t('save')}</button>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  )
}

function SuppliersTab({ t, notify }) {
  const { user } = useApp()
  const { syncChannel } = useSync()
  const loadRequestRef = useRef(0)
  const loadedOnceRef = useRef(false)
  const loadWatchdogRef = useRef(null)
  const loadPromiseRef = useRef(null)
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const tr = useCallback((key, fallbackEn, fallbackKm = fallbackEn) => {
    const value = typeof t === 'function' ? t(key) : null
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }, [isKhmer, t])
  const [suppliers, setSuppliers] = useState([])
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [bulkActionBusy, setBulkActionBusy] = useState(false)
  const [yearFilter, setYearFilter] = useState('all')
  const [monthFilter, setMonthFilter] = useState('all')
  const [sortDirection, setSortDirection] = useState('desc')
  const [collapsedSections, setCollapsedSections] = useState(() => new Set())
  const syncChannelName = String(syncChannel?.channel || '')
  const syncChannelTs = Number(syncChannel?.ts || 0)
  const actionHistory = useActionHistory({ limit: 3, notify })

  const filteredBySearch = suppliers.filter((supplier) => {
    const query = search.toLowerCase().trim()
    if (!query) return true
    return (
      String(supplier.name || '').toLowerCase().includes(query)
      || String(supplier.phone || '').includes(query)
      || String(supplier.email || '').toLowerCase().includes(query)
      || String(supplier.company || '').toLowerCase().includes(query)
      || String(supplier.contact_person || '').toLowerCase().includes(query)
    )
  })

  const timeMode = useMemo(() => getTimeGroupingMode(yearFilter, monthFilter), [monthFilter, yearFilter])
  const availableYears = useMemo(
    () => getAvailableYears(filteredBySearch, (supplier) => supplier?.created_at),
    [filteredBySearch],
  )
  const filteredSections = useMemo(() => buildTimeActionSections(filteredBySearch, {
    getDate: (supplier) => supplier?.created_at,
    getItemId: (supplier) => Number(supplier?.id),
    year: yearFilter,
    month: monthFilter,
    timeMode,
    groupMode: 'time',
    sortDirection,
  }), [filteredBySearch, monthFilter, sortDirection, timeMode, yearFilter])

  useEffect(() => {
    setCollapsedSections((current) => new Set([...current].filter((id) => filteredSections.some((section) => section.id === id))))
  }, [filteredSections])

  const visibleSuppliers = useMemo(
    () => filteredSections.flatMap((section) => section.items),
    [filteredSections],
  )
  const displayRows = useMemo(
    () => filteredSections.flatMap((section) => {
      const collapsed = collapsedSections.has(section.id)
      return [{ __kind: 'section', section, collapsed }, ...(!collapsed ? section.items : [])]
    }),
    [collapsedSections, filteredSections],
  )

  const { selectedIds, setSelectedIds, toggleOne, selectAllProp } = useContactSelection(visibleSuppliers)
  const supplierColumns = [t('name'), t('phone'), t('email'), t('company'), t('contact_person') || 'Contact']
  const contactFilterSections = useMemo(() => ([
    {
      id: 'year',
      label: tr('year', 'Year'),
      options: [
        { id: 'all-years', label: tr('all_years', 'All years'), active: yearFilter === 'all', onClick: () => { setYearFilter('all'); setMonthFilter('all') } },
        ...availableYears.map((year) => ({
          id: `year-${year}`,
          label: year,
          active: yearFilter === year,
          onClick: () => {
            const next = yearFilter === year ? 'all' : year
            setYearFilter(next)
            if (next === 'all') setMonthFilter('all')
          },
        })),
      ],
    },
    {
      id: 'month',
      label: tr('month', 'Month'),
      options: [
        { id: 'all-months', label: tr('all_months', 'All months'), active: monthFilter === 'all', onClick: () => setMonthFilter('all') },
        ...Array.from({ length: 12 }, (_, index) => {
          const month = String(index + 1)
          return {
            id: `month-${month}`,
            label: new Date(2000, index, 1).toLocaleString(undefined, { month: 'long' }),
            active: monthFilter === month,
            onClick: () => setMonthFilter(monthFilter === month ? 'all' : month),
          }
        }),
      ],
    },
    {
      id: 'sort',
      label: tr('sort', 'Sort'),
      options: [
        { id: 'sort-desc', label: tr('newest_first', 'Newest first'), active: sortDirection === 'desc', onClick: () => setSortDirection('desc') },
        { id: 'sort-asc', label: tr('oldest_first', 'Oldest first'), active: sortDirection === 'asc', onClick: () => setSortDirection('asc') },
      ],
    },
  ]), [availableYears, monthFilter, sortDirection, tr, yearFilter])
  const activeFilterCount = [yearFilter !== 'all', monthFilter !== 'all', sortDirection !== 'desc'].filter(Boolean).length
  const toggleSectionCollapsed = (sectionId) => setCollapsedSections((current) => {
    const next = new Set(current)
    if (next.has(sectionId)) next.delete(sectionId)
    else next.add(sectionId)
    return next
  })
  const isSectionFullySelected = (ids = []) => ids.length > 0 && ids.every((id) => selectedIds.has(Number(id)))
  const isSectionPartiallySelected = (ids = []) => ids.some((id) => selectedIds.has(Number(id))) && !isSectionFullySelected(ids)
  const toggleSectionSelection = (ids, checked) => {
    ids.forEach((id) => {
      const numericId = Number(id)
      const isSelected = selectedIds.has(numericId)
      if ((checked && !isSelected) || (!checked && isSelected)) toggleOne(numericId)
    })
  }

  const load = useCallback(async ({ silent = false, label = 'Suppliers' } = {}) => {
    if (loadPromiseRef.current) return loadPromiseRef.current
    const requestId = beginTrackedRequest(loadRequestRef)
    const promise = (async () => {
      window.clearTimeout(loadWatchdogRef.current)
      if (!silent || !loadedOnceRef.current) {
        setLoading(true)
        setLoadError('')
        loadWatchdogRef.current = window.setTimeout(() => {
          if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
          setLoading(false)
          setLoadError(tr('suppliers_load_slow', 'Suppliers are taking longer than expected. Tap Retry or revisit the page in a moment.'))
        }, 10000)
      }
      try {
        const data = await withLoaderTimeout(() => window.api.getSuppliers(), label, 8000)
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        setSuppliers(Array.isArray(data) ? data : [])
        loadedOnceRef.current = true
        setLoadError('')
      } catch (error) {
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        const message = error?.message || 'Failed to load suppliers'
        if (!loadedOnceRef.current) {
          setSuppliers([])
          setLoadError(message)
          notify(message, 'error')
          loadedOnceRef.current = true
        } else {
          const refreshMessage = tr('suppliers_refresh_failed', 'Unable to refresh suppliers right now. Showing the latest loaded data.')
          setLoadError((current) => current || refreshMessage)
          notify(refreshMessage, 'warning')
        }
      } finally {
        window.clearTimeout(loadWatchdogRef.current)
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        setLoading(false)
      }
    })()
    const wrappedPromise = promise.finally(() => {
      if (loadPromiseRef.current === wrappedPromise) {
        loadPromiseRef.current = null
      }
    })
    loadPromiseRef.current = wrappedPromise
    return wrappedPromise
  }, [notify, t, tr])

  useEffect(() => {
    load({ silent: loadedOnceRef.current })
    return () => {
      window.clearTimeout(loadWatchdogRef.current)
      invalidateTrackedRequest(loadRequestRef)
      loadPromiseRef.current = null
    }
  }, [load])
  useEffect(() => {
    if (syncChannelName === 'suppliers') load({ silent: true, label: 'Suppliers refresh' })
  }, [load, syncChannelName, syncChannelTs])

  const handleSave = async (form) => {
    if (!String(form.name || '').trim()) return notify(t('name_required') || 'Name required', 'error')
    try {
      const payload = { ...form, userId: user?.id, userName: user?.name }
      const result = selected
        ? await window.api.updateSupplier(selected.id, payload)
        : await window.api.createSupplier(payload)
      if (result?.success === false) {
        notify(result.error || 'Failed', 'error')
        return
      }
      notify(selected ? (t('supplier_updated') || 'Updated') : (t('supplier_added') || 'Added'))
      setModal(null)
      setSelected(null)
      load()
    } catch (error) {
      notify(error?.message || 'Failed', 'error')
    }
  }

  const handleDelete = async (supplier) => {
    if (!confirm(`Delete supplier "${supplier.name}"?`)) return
    try {
      await window.api.deleteSupplier(supplier.id)
      notify(t('supplier_deleted') || 'Deleted')
      setModal(null)
      setSelected(null)
      load()
    } catch (error) {
      notify(error?.message || 'Failed', 'error')
    }
  }

  const handleBulkDelete = async () => {
    if (!selectedIds.size || bulkActionBusy) return
    if (!confirm(`Delete ${selectedIds.size} supplier(s)?`)) return
    const ids = [...selectedIds]
    const snapshots = suppliers.filter((supplier) => ids.includes(Number(supplier?.id || 0))).map((supplier) => JSON.parse(JSON.stringify(supplier)))
    const failedIds = []
    let deletedCount = 0
    setBulkActionBusy(true)
    try {
      for (const id of ids) {
        try {
          await window.api.deleteSupplier(id)
          deletedCount += 1
        } catch (_) {
          failedIds.push(Number(id))
        }
      }
      setSelectedIds(new Set(failedIds))
      await load({ silent: true, label: 'Suppliers refresh after delete' })
      const deletedSnapshots = snapshots.filter((snapshot) => !failedIds.includes(Number(snapshot?.id || 0)))
      if (deletedCount > 0 && deletedSnapshots.length) {
        let restoredEntries = []
        actionHistory.pushAction({
          label: `Delete ${deletedCount} supplier${deletedCount === 1 ? '' : 's'}`,
          undo: async () => {
            restoredEntries = []
            for (const snapshot of deletedSnapshots) {
              const result = await window.api.createSupplier({
                name: snapshot.name || '',
                phone: snapshot.phone || '',
                email: snapshot.email || '',
                company: snapshot.company || '',
                contact_person: snapshot.contact_person || '',
                address: snapshot.address || '',
                notes: snapshot.notes || '',
                userId: user?.id,
                userName: user?.name,
              })
              restoredEntries.push({ restoredId: Number(result?.id || result?.data?.id || 0) })
            }
            await load({ silent: true, label: 'Suppliers restore deleted' })
          },
          redo: async () => {
            const idsToDelete = restoredEntries.map((entry) => Number(entry.restoredId || 0)).filter((id) => id > 0)
            for (const id of idsToDelete) {
              await window.api.deleteSupplier(id)
            }
            await load({ silent: true, label: 'Suppliers redo delete' })
          },
        })
      }
      if (failedIds.length) {
        notify(`Deleted ${deletedCount} supplier(s), ${failedIds.length} failed`, 'warning')
      } else {
        notify(`${deletedCount} ${t('deleted') || 'deleted'}`)
      }
    } finally {
      setBulkActionBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ActionHistoryBar history={actionHistory} />
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex flex-1 min-w-0 items-center gap-2">
          <input
            id="supplier-search"
            name="supplier_search"
            className="input flex-1 min-w-0 max-w-xs"
            placeholder={t('search_suppliers_placeholder') || `${t('search') || 'Search'} suppliers`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <span className="whitespace-nowrap text-sm text-gray-400">{visibleSuppliers.length}</span>
        </div>
        <div className="flex flex-shrink-0 flex-nowrap items-center gap-1.5 overflow-x-auto">
          {loadError ? (
            <button
              type="button"
              className="btn-secondary whitespace-nowrap text-sm text-amber-700 dark:text-amber-300"
              onClick={() => load({ silent: false, label: 'Suppliers retry' })}
            >
              {tr('retry', 'Retry')}
            </button>
          ) : null}
          {selectedIds.size > 0 ? (
            <button
              className="btn-secondary whitespace-nowrap text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleBulkDelete}
              disabled={bulkActionBusy}
            >
              Delete {selectedIds.size}
            </button>
          ) : null}
          <FilterMenu
            label={tr('filters', 'Filters')}
            activeCount={activeFilterCount}
            sections={contactFilterSections}
            onClear={() => {
              setYearFilter('all')
              setMonthFilter('all')
              setSortDirection('desc')
            }}
            compact
          />
          <button className="btn-secondary inline-flex items-center gap-1.5 whitespace-nowrap text-sm" onClick={() => setModal('import')} title={tr('import_contacts', 'Import', 'នាំចូល')}>
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">{tr('import_contacts', 'Import', 'នាំចូល')}</span>
          </button>
          <button
            className="btn-secondary inline-flex items-center gap-1.5 whitespace-nowrap text-sm"
            onClick={() => {
              const rows = visibleSuppliers.map((supplier) => ({
                ...(() => {
                  const options = parseStoredContactOptions(supplier.address, { legacyField: 'address' })
                  const primaryOption = getPrimaryContactOption(options, {
                    fallback: {
                      name: supplier.contact_person || '',
                      phone: supplier.phone || '',
                      email: supplier.email || '',
                      address: '',
                    },
                  })
                  return {
                Name: supplier.name || '',
                Phone: primaryOption.phone || supplier.phone || '',
                Email: primaryOption.email || supplier.email || '',
                Company: supplier.company || '',
                ContactPerson: primaryOption.name || supplier.contact_person || '',
                Address: primaryOption.address || '',
                ContactOptions: buildContactOptionSummary(options),
                Notes: supplier.notes || '',
                Created: supplier.created_at || '',
                  }
                })(),
              }))
              downloadCSV(`suppliers-${new Date().toISOString().slice(0, 10)}.csv`, rows)
            }}
            title={tr('export', 'Export', 'នាំចេញ')}
          >
            <Upload className="h-4 w-4" />
            <span className="hidden sm:inline">{tr('export', 'Export', 'នាំចេញ')}</span>
          </button>
          <button className="btn-primary inline-flex items-center gap-1.5 whitespace-nowrap text-sm" onClick={() => { setSelected(null); setModal('form') }} title={tr('add_supplier', 'Add Supplier', 'បន្ថែមអ្នកផ្គត់ផ្គង់')}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{tr('add_supplier', 'Add Supplier', 'បន្ថែមអ្នកផ្គត់ផ្គង់')}</span>
          </button>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">
          {loadError}
        </div>
      ) : null}

      <ContactTable
        loading={loading}
        rows={displayRows}
        emptyLabel={t('no_suppliers') || 'No suppliers'}
        columns={supplierColumns}
        selectAll={selectAllProp}
        selectedCount={selectedIds.size}
        totalCount={visibleSuppliers.length}
        t={t}
        renderRow={(supplier) => (
          supplier?.__kind === 'section' ? (
            <tr key={supplier.section.id} className="bg-slate-100/90 dark:bg-slate-800/80">
              <td colSpan={supplierColumns.length + 2} className="px-4 py-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="inline-flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded"
                      checked={isSectionFullySelected(supplier.section.ids)}
                      ref={(node) => {
                        if (node) node.indeterminate = isSectionPartiallySelected(supplier.section.ids)
                      }}
                      onChange={(event) => toggleSectionSelection(supplier.section.ids, event.target.checked)}
                      aria-label={`Select ${supplier.section.label}`}
                    />
                    <span>{supplier.section.label}</span>
                    <span className="normal-case tracking-normal text-slate-400">{supplier.section.items.length}</span>
                  </label>
                  <div className="flex items-center gap-1">
                    <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white" onClick={() => toggleSectionCollapsed(supplier.section.id)}>
                      {supplier.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      {supplier.collapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                    </button>
                  </div>
                </div>
              </td>
            </tr>
          ) : (
          (() => {
            const options = parseStoredContactOptions(supplier.address, { legacyField: 'address' })
            const primaryOption = getPrimaryContactOption(options, {
              fallback: {
                name: supplier.contact_person || '',
                phone: supplier.phone || '',
                email: supplier.email || '',
                address: '',
              },
            })
            return (
          <tr key={supplier.id} className={`table-row cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 ${selectedIds.has(supplier.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
            <td className="w-10 px-3 py-2" onClick={(event) => event.stopPropagation()}>
              <label htmlFor={`supplier-select-${supplier.id}`} className="sr-only">{`Select ${supplier.name}`}</label>
              <input id={`supplier-select-${supplier.id}`} name={`supplier_select_${supplier.id}`} type="checkbox" className="h-4 w-4 cursor-pointer rounded" checked={selectedIds.has(supplier.id)} onChange={() => toggleOne(supplier.id)} />
            </td>
            <td className="cursor-pointer px-4 py-2 font-medium text-gray-900 dark:text-white" onClick={() => { setSelected(supplier); setModal('detail') }}>{supplier.name}</td>
            <td className="cursor-pointer px-4 py-2 text-gray-500" onClick={() => { setSelected(supplier); setModal('detail') }}>{primaryOption.phone || supplier.phone || '--'}</td>
            <td className="cursor-pointer px-4 py-2 text-xs text-gray-500" onClick={() => { setSelected(supplier); setModal('detail') }}>{primaryOption.email || supplier.email || '--'}</td>
            <td className="cursor-pointer px-4 py-2 text-gray-500" onClick={() => { setSelected(supplier); setModal('detail') }}>{supplier.company || '--'}</td>
            <td className="cursor-pointer px-4 py-2 text-gray-500" onClick={() => { setSelected(supplier); setModal('detail') }}>{primaryOption.name || supplier.contact_person || '--'}</td>
            <td className="px-2 py-2 text-right" onClick={(event) => event.stopPropagation()}>
              <ThreeDotMenu onDetails={() => { setSelected(supplier); setModal('detail') }} onEdit={() => { setSelected(supplier); setModal('form') }} onDelete={() => handleDelete(supplier)} />
            </td>
          </tr>
            )
          })()
        ))}
        renderCard={(supplier) => (
          supplier?.__kind === 'section' ? (
            <div key={supplier.section.id} className="rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800/70">
              <div className="flex items-center justify-between gap-3">
                <label className="inline-flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded"
                    checked={isSectionFullySelected(supplier.section.ids)}
                    ref={(node) => {
                      if (node) node.indeterminate = isSectionPartiallySelected(supplier.section.ids)
                    }}
                    onChange={(event) => toggleSectionSelection(supplier.section.ids, event.target.checked)}
                    aria-label={`Select ${supplier.section.label}`}
                  />
                  <span>{supplier.section.label}</span>
                  <span className="normal-case tracking-normal text-slate-400">{supplier.section.items.length}</span>
                </label>
                <div className="flex items-center gap-1">
                  <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white" onClick={() => toggleSectionCollapsed(supplier.section.id)}>
                    {supplier.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          ) : (
          (() => {
            const options = parseStoredContactOptions(supplier.address, { legacyField: 'address' })
            const primaryOption = getPrimaryContactOption(options, {
              fallback: {
                name: supplier.contact_person || '',
                phone: supplier.phone || '',
                email: supplier.email || '',
                address: '',
              },
            })
            return (
          <div key={supplier.id} className={`card flex items-center gap-3 p-3 ${selectedIds.has(supplier.id) ? 'bg-blue-50 ring-2 ring-blue-400 dark:bg-blue-900/20' : ''}`}>
            <div className="flex-shrink-0" onClick={(event) => { event.stopPropagation(); toggleOne(supplier.id) }}>
              <label htmlFor={`supplier-card-select-${supplier.id}`} className="sr-only">{`Select ${supplier.name}`}</label>
              <input id={`supplier-card-select-${supplier.id}`} name={`supplier_card_select_${supplier.id}`} type="checkbox" className="h-5 w-5 cursor-pointer rounded" checked={selectedIds.has(supplier.id)} onChange={() => toggleOne(supplier.id)} />
            </div>
            <div className="h-9 w-9 flex-shrink-0 rounded-full bg-orange-100 text-center text-sm font-bold leading-9 text-orange-600 dark:bg-orange-900/40">
              {supplier.name?.[0]?.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1 cursor-pointer" onClick={() => { setSelected(supplier); setModal('detail') }}>
              <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{supplier.name}</div>
              {primaryOption.phone || supplier.phone ? <div className="text-xs text-gray-500">{primaryOption.phone || supplier.phone}</div> : null}
              {supplier.company ? <div className="truncate text-xs text-gray-400">{supplier.company}</div> : null}
              {options.length ? <div className="mt-0.5 text-xs text-blue-500">{options.length} contact option{options.length !== 1 ? 's' : ''}</div> : null}
            </div>
            <div onClick={(event) => event.stopPropagation()}>
              <ThreeDotMenu onDetails={() => { setSelected(supplier); setModal('detail') }} onEdit={() => { setSelected(supplier); setModal('form') }} onDelete={() => handleDelete(supplier)} />
            </div>
          </div>
            )
          })()
        ))}
      />

      {modal === 'form' ? <SupplierForm supplier={selected} onSave={handleSave} onClose={() => { setModal(null); setSelected(null) }} t={t} /> : null}
      {modal === 'import' ? <ImportModal type="supplier" onClose={() => setModal(null)} onDone={load} /> : null}
      {modal === 'detail' && selected ? (
        <DetailModal
          item={selected}
          fields={(() => {
            const options = parseStoredContactOptions(selected.address, { legacyField: 'address' })
            const primaryOption = getPrimaryContactOption(options, {
              fallback: {
                name: selected.contact_person || '',
                phone: selected.phone || '',
                email: selected.email || '',
                address: '',
              },
            })
            return [
              [t('name'), selected.name],
              [t('phone'), primaryOption.phone || selected.phone],
              [t('email'), primaryOption.email || selected.email],
              [t('company'), selected.company],
              [t('contact_person') || 'Contact', primaryOption.name || selected.contact_person],
              [t('address'), primaryOption.address],
              ['Contact Options', buildContactOptionSummary(options)],
              [t('notes'), selected.notes],
              [t('col_added') || t('added_on') || 'Added', selected.created_at || fmtDate(selected.created_at)],
            ]
          })()}
          onEdit={() => setModal('form')}
          onDelete={() => handleDelete(selected)}
          onClose={() => { setModal(null); setSelected(null) }}
          t={t}
        />
      ) : null}
    </div>
  )
}

export { SupplierForm, SuppliersTab }
