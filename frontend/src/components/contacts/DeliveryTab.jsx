// ?? DeliveryTab ???????????????????????????????????????????????????????????????
import { useState, useEffect, useCallback, useMemo } from 'react'
import { ChevronDown, ChevronRight, Download, Plus, Upload } from 'lucide-react'
import { useRef } from 'react'
import { useApp, useSync } from '../../AppContext'
import { downloadCSV } from '../../utils/csv'
import { fmtDate } from '../../utils/formatters'
import Modal from '../shared/Modal'
import FilterMenu from '../shared/FilterMenu'
import { ThreeDotMenu, DetailModal, ImportModal, ContactTable, useContactSelection } from './shared'
import { withLoaderTimeout } from '../../utils/loaders.mjs'
import { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent } from '../../utils/loaders.mjs'
import { buildTimeActionSections, getAvailableYears, getTimeGroupingMode } from '../../utils/groupedRecords.mjs'
import {
  CONTACT_OPTION_LIMIT,
  buildContactOptionSummary,
  createContactOption,
  getPrimaryContactOption,
  parseStoredContactOptions,
  serializeContactOptions,
} from './contactOptionUtils'

// ?? Options helpers ????????????????????????????????????????????????????????????
// Options stored as JSON array in the 'address' TEXT column.
// Each option: { label, name, phone, area }
// Backward-compatible: old plain strings migrated to a single option.

export function parseDeliveryOptions(raw) {
  return parseStoredContactOptions(raw, { legacyField: 'area' })
}

export function serializeDeliveryOptions(opts) {
  return serializeContactOptions(opts)
}

const BLANK_OPTION = () => createContactOption({ label: '', name: '', phone: '', area: '' })

// ?? OptionEditor ???????????????????????????????????????????????????????????????
function OptionEditor({ option, index, total, onChange, onRemove }) {
  const set = (k, v) => onChange({ ...option, [k]: v })
  const fieldId = (field) => `delivery-option-${index}-${field}`
  return (
    <div className="border border-gray-200 dark:border-zinc-600 rounded-xl p-3 space-y-2 bg-gray-50 dark:bg-zinc-800/60">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-gray-400 w-5 flex-shrink-0">#{index + 1}</span>
        <label htmlFor={fieldId('label')} className="sr-only">Delivery option label</label>
        <input
          id={fieldId('label')}
          name={fieldId('label')}
          className="input text-xs py-1 flex-1"
          placeholder="Label (e.g. Morning Shift, Zone A)"
          value={option.label}
          onChange={e => set('label', e.target.value)}
        />
        {total > 1 && (
          <button type="button" onClick={onRemove} className="text-red-400 hover:text-red-600 text-xs px-1.5 py-1 rounded flex-shrink-0">x</button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={fieldId('name')} className="block text-xs text-gray-400 mb-0.5">Name</label>
          <input id={fieldId('name')} name={fieldId('name')} className="input text-xs py-1" placeholder="Driver / rider name" value={option.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div>
          <label htmlFor={fieldId('phone')} className="block text-xs text-gray-400 mb-0.5">Phone</label>
          <input id={fieldId('phone')} name={fieldId('phone')} className="input text-xs py-1" placeholder="Phone number" value={option.phone} onChange={e => set('phone', e.target.value)} />
        </div>
      </div>
      <div>
        <label htmlFor={fieldId('area')} className="block text-xs text-gray-400 mb-0.5">Area / Zone</label>
        <input id={fieldId('area')} name={fieldId('area')} className="input text-xs py-1" placeholder="Coverage area or zone" value={option.area} onChange={e => set('area', e.target.value)} />
      </div>
    </div>
  )
}

// ?? DeliveryForm ???????????????????????????????????????????????????????????????
function DeliveryForm({ contact, onSave, onClose, t }) {
  const init = contact ? { ...contact } : { name: '', phone: '', area: '', notes: '' }
  const [form, setForm] = useState(init)
  const [options, setOptions] = useState(() => {
    const parsed = parseDeliveryOptions(init.address)
    if (parsed.length) return parsed
    return [BLANK_OPTION()]
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const addOption = () => setOptions((current) => {
    if (current.length >= CONTACT_OPTION_LIMIT) return current
    return [...current, BLANK_OPTION()]
  })
  const updateOption = (index, nextOption) => setOptions((current) => current.map((option, itemIndex) => (itemIndex === index ? nextOption : option)))
  const removeOption = (index) => setOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))
  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      const primaryOption = getPrimaryContactOption(options, {
        fallback: { name: form.name || '', phone: form.phone || '', area: form.area || '' },
      })
      await Promise.resolve(onSave({
        ...form,
        name: primaryOption.name || form.name || '',
        phone: primaryOption.phone || form.phone || '',
        area: primaryOption.area || form.area || '',
        address: serializeDeliveryOptions(options),
      }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={contact ? `Edit Delivery Contact` : `Add Delivery Contact`}
      onClose={onClose}
    >
      <div className="space-y-3">
        <div>
          <label htmlFor="delivery-form-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('name')} <span className="text-xs font-normal text-gray-400">(driver / rider)</span>
          </label>
          <input id="delivery-form-name" name="delivery_name" className="input" value={form.name} onChange={e => set('name', e.target.value)} autoFocus placeholder="Driver name" />
        </div>
        <div>
          <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Contact Options
              <span className="ml-1.5 text-xs font-normal text-gray-400">Up to {CONTACT_OPTION_LIMIT} riders or zones</span>
            </label>
            <button type="button" onClick={addOption} disabled={options.length >= CONTACT_OPTION_LIMIT} className="rounded-lg px-2 py-1 text-xs font-medium text-blue-500 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-blue-900/20">
              + Add Option
            </button>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-0.5">
            {options.map((option, index) => (
              <OptionEditor
                key={`delivery-option-${index}`}
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
          <label htmlFor="delivery-form-notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('notes')||'Notes'}</label>
          <textarea id="delivery-form-notes" name="delivery_notes" className="input resize-none" rows={2} value={form.notes||''} onChange={e => set('notes', e.target.value)} />
        </div>
        <p className="text-xs text-gray-400">Provide driver name or phone number.</p>

        <div className="flex gap-3 pt-1">
          <button type="button" className="btn-primary flex-1" onClick={handleSave} disabled={saving}>{saving ? (t('saving') || 'Saving...') : t('save')}</button>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  )
}

// ?? OptionsDisplay (detail view) ???????????????????????????????????????????????
function OptionsDisplay({ raw }) {
  const opts = parseDeliveryOptions(raw)
  if (!opts.length) return <span className="text-gray-400">-</span>
  return (
    <div className="space-y-1.5">
      {opts.map((o, i) => (
        <div key={i} className="text-xs bg-gray-50 dark:bg-zinc-800 rounded-lg p-2 space-y-0.5">
          {o.label && <div className="font-semibold text-gray-700 dark:text-gray-200">{o.label}</div>}
          {o.name  && <div className="text-gray-600 dark:text-gray-300">Name: {o.name}</div>}
          {o.phone && <div className="text-gray-500">Phone: {o.phone}</div>}
          {o.area  && <div className="text-gray-500">Zone: {o.area}</div>}
        </div>
      ))}
    </div>
  )
}

function OptionsBadge({ raw }) {
  const count = parseDeliveryOptions(raw).length
  if (!count) return null
  return (
    <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
      {count}
    </span>
  )
}

// ?? DeliveryTab ????????????????????????????????????????????????????????????????
function DeliveryTab({ t, notify }) {
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
  const [contacts, setContacts] = useState([])
  const [search,   setSearch]   = useState('')
  const [modal,    setModal]    = useState(null)
  const [selected, setSelected] = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [loadError, setLoadError] = useState('')
  const [bulkActionBusy, setBulkActionBusy] = useState(false)
  const [yearFilter, setYearFilter] = useState('all')
  const [monthFilter, setMonthFilter] = useState('all')
  const [sortDirection, setSortDirection] = useState('desc')
  const [collapsedSections, setCollapsedSections] = useState(() => new Set())
  const syncChannelName = String(syncChannel?.channel || '')
  const syncChannelTs = Number(syncChannel?.ts || 0)

  const filteredBySearch = contacts.filter(c => {
    const q = search.toLowerCase()
    return !q || c.name.toLowerCase().includes(q) || (c.phone||'').includes(q) || (c.area||'').toLowerCase().includes(q)
  })

  const timeMode = useMemo(() => getTimeGroupingMode(yearFilter, monthFilter), [monthFilter, yearFilter])
  const availableYears = useMemo(() => getAvailableYears(filteredBySearch, (contact) => contact?.created_at), [filteredBySearch])
  const filteredSections = useMemo(() => buildTimeActionSections(filteredBySearch, {
    getDate: (contact) => contact?.created_at,
    getItemId: (contact) => Number(contact?.id),
    year: yearFilter,
    month: monthFilter,
    timeMode,
    groupMode: 'time',
    sortDirection,
  }), [filteredBySearch, monthFilter, sortDirection, timeMode, yearFilter])
  useEffect(() => {
    setCollapsedSections((current) => new Set([...current].filter((id) => filteredSections.some((section) => section.id === id))))
  }, [filteredSections])
  const visibleContacts = useMemo(
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

  const { selectedIds, setSelectedIds, toggleOne, selectAllProp } = useContactSelection(visibleContacts)
  const deliveryColumns = [t('name'), t('phone'), t('area_zone')||'Area / Zone']
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

  const load = useCallback(async ({ silent = false, label = 'Delivery contacts' } = {}) => {
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
          setLoadError(tr('delivery_contacts_load_slow', 'Delivery contacts are taking longer than expected. Tap Retry or revisit the page in a moment.'))
        }, 10000)
      }
      try {
        const data = await withLoaderTimeout(() => window.api.getDeliveryContacts(), label, 8000)
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        setContacts(Array.isArray(data) ? data : [])
        loadedOnceRef.current = true
        setLoadError('')
      } catch (error) {
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        const message = error?.message || 'Failed to load delivery contacts'
        if (!loadedOnceRef.current) {
          setContacts([])
          setLoadError(message)
          notify(message, 'error')
          loadedOnceRef.current = true
        } else {
          const refreshMessage = tr('delivery_contacts_refresh_failed', 'Unable to refresh delivery contacts right now. Showing the latest loaded data.')
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
    if (syncChannelName === 'deliveryContacts') load({ silent: true, label: 'Delivery contacts refresh' })
  }, [load, syncChannelName, syncChannelTs])

  const handleSave = async (form) => {
    if (!String(form.name || '').trim() && !String(form.phone || '').trim()) {
      return notify('Driver name or phone is required', 'error')
    }
    try {
      const payload = { ...form, userId: user?.id, userName: user?.name }
      const res = selected
        ? await window.api.updateDeliveryContact(selected.id, payload)
        : await window.api.createDeliveryContact(payload)
      if (res?.success === false) { notify(res.error||'Failed', 'error'); return }
      notify(selected ? (t('delivery_contact_updated')||'Updated') : (t('delivery_contact_added')||'Added'))
      setModal(null); setSelected(null); load()
    } catch (e) { notify(e.message||'Failed', 'error') }
  }

  const handleDelete = async (c) => {
    if (!confirm(`Delete "${c.name}"?`)) return
    try { await window.api.deleteDeliveryContact(c.id); notify(t('delivery_contact_deleted')||'Deleted'); setModal(null); setSelected(null); load() }
    catch (e) { notify(e.message||'Failed', 'error') }
  }

  const handleBulkDelete = async () => {
    if (!selectedIds.size || bulkActionBusy) return
    if (!confirm(`Delete ${selectedIds.size} delivery contact(s)?`)) return
    const ids = [...selectedIds]
    const failedIds = []
    let deletedCount = 0
    setBulkActionBusy(true)
    try {
      for (const id of ids) {
        try {
          await window.api.deleteDeliveryContact(id)
          deletedCount += 1
        } catch (_) {
          failedIds.push(Number(id))
        }
      }
      setSelectedIds(new Set(failedIds))
      await load({ silent: true, label: 'Delivery contacts refresh after delete' })
      if (failedIds.length) {
        notify(`Deleted ${deletedCount} delivery contact(s), ${failedIds.length} failed`, 'warning')
      } else {
        notify(`${deletedCount} ${t('deleted') || 'deleted'}`)
      }
    } finally {
      setBulkActionBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex gap-2 items-center flex-1 min-w-0">
          <label htmlFor="delivery-search" className="sr-only">{t('search_delivery_placeholder')||'Search delivery contacts'}</label>
          <input id="delivery-search" name="delivery_search" className="input flex-1 min-w-0 max-w-xs"
            placeholder={t('search_delivery_placeholder')||`Search...`}
            value={search} onChange={e => setSearch(e.target.value)} />
          <span className="text-sm text-gray-400 whitespace-nowrap">{visibleContacts.length}</span>
        </div>
        <div className="flex gap-1.5 items-center overflow-x-auto flex-nowrap flex-shrink-0">
          {loadError ? (
            <button
              type="button"
              className="btn-secondary whitespace-nowrap text-sm text-amber-700 dark:text-amber-300"
              onClick={() => load({ silent: false, label: 'Delivery contacts retry' })}
            >
              {tr('retry', 'Retry')}
            </button>
          ) : null}
          {selectedIds.size > 0 && (
            <button
              className="btn-secondary text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleBulkDelete}
              disabled={bulkActionBusy}
            >
              Delete {selectedIds.size}
            </button>
          )}
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
          <button className="btn-secondary inline-flex items-center gap-1.5 text-sm whitespace-nowrap" onClick={() => setModal('import')} title={tr('import_contacts', 'Import', 'នាំចូល')}>
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">{tr('import_contacts', 'Import', 'នាំចូល')}</span>
          </button>
          <button className="btn-secondary inline-flex items-center gap-1.5 text-sm whitespace-nowrap" onClick={() => {
            const rows = visibleContacts.map(c => {
              const options = parseDeliveryOptions(c.address)
              const primaryOption = getPrimaryContactOption(options, {
                fallback: { name: c.name || '', phone: c.phone || '', area: c.area || '' },
              })
              return {
                Name: c.name || '',
                Phone: primaryOption.phone || c.phone || '',
                Area: primaryOption.area || c.area || '',
                ContactOptions: buildContactOptionSummary(options, { mode: 'area' }),
                Notes: c.notes || '',
                Created: c.created_at || '',
              }
            })
            downloadCSV(`delivery-contacts-${new Date().toISOString().slice(0,10)}.csv`, rows)
          }} title={tr('export', 'Export', 'នាំចេញ')}>
            <Upload className="h-4 w-4" />
            <span className="hidden sm:inline">{tr('export', 'Export', 'នាំចេញ')}</span>
          </button>
          <button className="btn-primary inline-flex items-center gap-1.5 text-sm whitespace-nowrap" onClick={() => { setSelected(null); setModal('form') }} title={tr('add_delivery_contact', 'Add Delivery', 'បន្ថែមអ្នកដឹកជញ្ជូន')}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{tr('add_delivery_contact', 'Add Delivery', 'បន្ថែមអ្នកដឹកជញ្ជូន')}</span>
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
        emptyLabel={t('no_delivery_contacts')||'No delivery contacts'}
        columns={deliveryColumns}
        selectAll={selectAllProp}
        selectedCount={selectedIds.size}
        totalCount={visibleContacts.length}
        t={t}
        renderRow={c => (
          c?.__kind === 'section' ? (
            <tr key={c.section.id} className="bg-slate-100/90 dark:bg-slate-800/80">
              <td colSpan={deliveryColumns.length + 2} className="px-4 py-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="inline-flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded"
                      checked={isSectionFullySelected(c.section.ids)}
                      ref={(node) => {
                        if (node) node.indeterminate = isSectionPartiallySelected(c.section.ids)
                      }}
                      onChange={(event) => toggleSectionSelection(c.section.ids, event.target.checked)}
                      aria-label={`Select ${c.section.label}`}
                    />
                    <span>{c.section.label}</span>
                    <span className="normal-case tracking-normal text-slate-400">{c.section.items.length}</span>
                  </label>
                  <div className="flex items-center gap-1">
                    <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white" onClick={() => toggleSectionCollapsed(c.section.id)}>
                      {c.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      {c.collapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                    </button>
                  </div>
                </div>
              </td>
            </tr>
          ) : (
          (() => {
            const options = parseDeliveryOptions(c.address)
            const primaryOption = getPrimaryContactOption(options, {
              fallback: { name: c.name || '', phone: c.phone || '', area: c.area || '' },
            })
            return (
          <tr key={c.id} className={`table-row cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 ${selectedIds.has(c.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
            <td className="px-3 py-2 w-10" onClick={e => e.stopPropagation()}>
              <label htmlFor={`delivery-select-${c.id}`} className="sr-only">{`Select ${c.name}`}</label>
              <input id={`delivery-select-${c.id}`} name={`delivery_select_${c.id}`} type="checkbox" className="w-4 h-4 cursor-pointer rounded" checked={selectedIds.has(c.id)} onChange={() => toggleOne(c.id)} />
            </td>
            <td className="px-4 py-2 font-medium text-gray-900 dark:text-white cursor-pointer" onClick={() => { setSelected(c); setModal('detail') }}>{c.name}</td>
            <td className="px-4 py-2 text-gray-500 cursor-pointer" onClick={() => { setSelected(c); setModal('detail') }}>{primaryOption.phone || c.phone || '-'}</td>
            <td className="px-4 py-2 text-gray-500 cursor-pointer" onClick={() => { setSelected(c); setModal('detail') }}>{primaryOption.area || c.area || '-'}</td>
            <td className="px-2 py-2 text-right" onClick={e => e.stopPropagation()}>
              <ThreeDotMenu onDetails={() => { setSelected(c); setModal('detail') }} onEdit={() => { setSelected(c); setModal('form') }} onDelete={() => handleDelete(c)} />
            </td>
          </tr>
            )
          })()
        ))}
        renderCard={c => (
          c?.__kind === 'section' ? (
            <div key={c.section.id} className="rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800/70">
              <div className="flex items-center justify-between gap-3">
                <label className="inline-flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded"
                    checked={isSectionFullySelected(c.section.ids)}
                    ref={(node) => {
                      if (node) node.indeterminate = isSectionPartiallySelected(c.section.ids)
                    }}
                    onChange={(event) => toggleSectionSelection(c.section.ids, event.target.checked)}
                    aria-label={`Select ${c.section.label}`}
                  />
                  <span>{c.section.label}</span>
                  <span className="normal-case tracking-normal text-slate-400">{c.section.items.length}</span>
                </label>
                <div className="flex items-center gap-1">
                  <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white" onClick={() => toggleSectionCollapsed(c.section.id)}>
                    {c.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          ) : (
          (() => {
            const options = parseDeliveryOptions(c.address)
            const primaryOption = getPrimaryContactOption(options, {
              fallback: { name: c.name || '', phone: c.phone || '', area: c.area || '' },
            })
            return (
          <div key={c.id} className={`card p-3 flex items-center gap-3 ${selectedIds.has(c.id) ? 'ring-2 ring-blue-400 bg-blue-50 dark:bg-blue-900/20' : ''}`}>
            <div className="flex-shrink-0" onClick={e => { e.stopPropagation(); toggleOne(c.id) }}>
              <label htmlFor={`delivery-card-select-${c.id}`} className="sr-only">{`Select ${c.name}`}</label>
              <input id={`delivery-card-select-${c.id}`} name={`delivery_card_select_${c.id}`} type="checkbox" className="w-5 h-5 cursor-pointer rounded" checked={selectedIds.has(c.id)} onChange={() => toggleOne(c.id)} />
            </div>
            <div className="w-9 h-9 bg-green-100 dark:bg-green-900/40 rounded-full flex items-center justify-center text-green-600 font-bold text-sm flex-shrink-0">
              {c.name?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { setSelected(c); setModal('detail') }}>
              <div className="font-semibold text-gray-900 dark:text-white text-sm truncate flex items-center gap-1">
                {c.name}
              </div>
              {primaryOption.phone || c.phone ? <div className="text-xs text-gray-500">{primaryOption.phone || c.phone}</div> : null}
              {primaryOption.area || c.area ? <div className="text-xs text-gray-400 truncate">{primaryOption.area || c.area}</div> : null}
              {options.length ? <div className="mt-0.5 text-xs text-blue-500">{options.length} contact option{options.length !== 1 ? 's' : ''}</div> : null}
            </div>
            <div onClick={e => e.stopPropagation()}>
              <ThreeDotMenu onDetails={() => { setSelected(c); setModal('detail') }} onEdit={() => { setSelected(c); setModal('form') }} onDelete={() => handleDelete(c)} />
            </div>
          </div>
            )
          })()
        ))}
      />

      {modal === 'form'   && <DeliveryForm contact={selected} onSave={handleSave} onClose={() => { setModal(null); setSelected(null) }} t={t} />}
      {modal === 'import' && <ImportModal type="deliveryContact" onClose={() => setModal(null)} onDone={load} />}
      {modal === 'detail' && selected && (
        <DetailModal item={selected}
          fields={(() => {
            const options = parseDeliveryOptions(selected.address)
            const primaryOption = getPrimaryContactOption(options, {
              fallback: { name: selected.name || '', phone: selected.phone || '', area: selected.area || '' },
            })
            return [
              [t('name'), selected.name],
              [t('phone'), primaryOption.phone || selected.phone],
              [t('area_zone')||'Area / Zone', primaryOption.area || selected.area],
              ['Contact Options', buildContactOptionSummary(options, { mode: 'area' })],
              [t('notes'), selected.notes],
              [t('col_added')||'Added', selected.created_at || fmtDate(selected.created_at)],
            ]
          })()}
          onEdit={() => setModal('form')} onDelete={() => handleDelete(selected)} onClose={() => { setModal(null); setSelected(null) }} t={t} />
      )}
    </div>
  )
}

export { DeliveryForm, DeliveryTab }

