import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronRight, Download, Plus, Upload } from 'lucide-react'
import { useDeferredValue } from 'react'
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
import { buildAlphabetActionSections, buildTimeActionSections, getAvailableYears, getTimeGroupingMode } from '../../utils/groupedRecords.mjs'
import { useActionHistory } from '../../utils/actionHistory.mjs'
import { cloneHistorySnapshot, extractHistoryResultId } from '../../utils/historyHelpers.mjs'
import {
  CONTACT_OPTION_LIMIT,
  buildContactOptionSummary,
  createContactOption,
  getPrimaryContactOption,
  parseStoredContactOptions,
  serializeContactOptions as serializeStoredContactOptions,
} from './contactOptionUtils'

export function parseContactOptions(raw) {
  return parseStoredContactOptions(raw, { legacyField: 'address' })
}

export function serializeContactOptions(options) {
  return serializeStoredContactOptions(options)
}

function tr(t, key, fallback) {
  const value = typeof t === 'function' ? t(key) : null
  return value && value !== key ? value : fallback
}

export function generateCustomerMembershipNumber(seed = '') {
  const prefix = String(seed || 'customer')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .slice(0, 4)
    .toUpperCase() || 'CUS'
  const entropy = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
  return `${prefix}-${entropy.slice(-8).padStart(8, '0')}`
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

function CustomerForm({ customer, onSave, onClose, t }) {
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
              placeholder="MEM-00000000-ABCD"
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

function CustomersTab({ t, notify, active = true }) {
  const { user } = useApp()
  const { syncChannel } = useSync()
  const loadRequestRef = useRef(0)
  const loadedOnceRef = useRef(false)
  const loadWatchdogRef = useRef(null)
  const loadPromiseRef = useRef(null)
  const [customers, setCustomers] = useState([])
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [bulkActionBusy, setBulkActionBusy] = useState(false)
  const [yearFilter, setYearFilter] = useState('all')
  const [monthFilter, setMonthFilter] = useState('all')
  const [sortDirection, setSortDirection] = useState('desc')
  const [groupMode, setGroupMode] = useState('time')
  const [collapsedSections, setCollapsedSections] = useState(() => new Set())
  const deferredSearch = useDeferredValue(search)
  const syncChannelName = String(syncChannel?.channel || '')
  const syncChannelTs = Number(syncChannel?.ts || 0)
  const actionHistory = useActionHistory({ limit: 3, notify })

  const filteredBySearch = useMemo(() => customers.filter((customer) => {
    const query = deferredSearch.toLowerCase().trim()
    if (!query) return true
    return (
      String(customer.name || '').toLowerCase().includes(query) ||
      String(customer.membership_number || '').toLowerCase().includes(query) ||
      String(customer.phone || '').includes(query) ||
      String(customer.email || '').toLowerCase().includes(query)
    )
  }), [customers, deferredSearch])

  const timeMode = useMemo(() => getTimeGroupingMode(yearFilter, monthFilter), [monthFilter, yearFilter])
  const availableYears = useMemo(
    () => getAvailableYears(filteredBySearch, (customer) => customer?.created_at),
    [filteredBySearch],
  )
  const filteredSections = useMemo(() => (
    groupMode === 'alphabet'
      ? buildAlphabetActionSections(filteredBySearch, {
        getName: (customer) => customer?.name,
        getItemId: (customer) => Number(customer?.id),
        sortDirection: 'asc',
      })
      : buildTimeActionSections(filteredBySearch, {
        getDate: (customer) => customer?.created_at,
        getItemId: (customer) => Number(customer?.id),
        year: yearFilter,
        month: monthFilter,
        timeMode,
        groupMode: 'time',
        sortDirection,
      })
  ), [filteredBySearch, groupMode, monthFilter, sortDirection, timeMode, yearFilter])

  useEffect(() => {
    setCollapsedSections((current) => new Set([...current].filter((id) => filteredSections.some((section) => section.id === id))))
  }, [filteredSections])

  const visibleCustomers = useMemo(
    () => filteredSections.flatMap((section) => section.items),
    [filteredSections],
  )
  const displayRows = useMemo(
    () => filteredSections.flatMap((section) => {
      const collapsed = collapsedSections.has(section.id)
      return [
        { __kind: 'section', section, collapsed },
        ...(!collapsed ? section.items : []),
      ]
    }),
    [collapsedSections, filteredSections],
  )

  const { selectedIds, setSelectedIds, toggleOne, selectAllProp } = useContactSelection(visibleCustomers)
  const customerColumns = [tr(t, 'name', 'Name'), 'Membership', tr(t, 'loyalty_points', 'Points'), tr(t, 'phone', 'Phone'), tr(t, 'email', 'Email'), tr(t, 'company', 'Company'), 'Options']
  const contactFilterSections = useMemo(() => ([
    {
      id: 'group',
      label: tr(t, 'group_by', 'Group by'),
      options: [
        { id: 'group-time', label: tr(t, 'date', 'Date'), active: groupMode === 'time', onClick: () => setGroupMode('time') },
        { id: 'group-alphabet', label: 'A-Z / ខ្មែរ', active: groupMode === 'alphabet', onClick: () => setGroupMode('alphabet') },
      ],
    },
    {
      id: 'year',
      label: tr(t, 'year', 'Year'),
      options: [
        { id: 'all-years', label: tr(t, 'all_years', 'All years'), active: yearFilter === 'all', onClick: () => { setYearFilter('all'); setMonthFilter('all') } },
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
      label: tr(t, 'month', 'Month'),
      options: [
        { id: 'all-months', label: tr(t, 'all_months', 'All months'), active: monthFilter === 'all', onClick: () => setMonthFilter('all') },
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
      label: tr(t, 'sort', 'Sort'),
      options: [
        { id: 'sort-desc', label: tr(t, 'newest_first', 'Newest first'), active: sortDirection === 'desc', onClick: () => setSortDirection('desc') },
        { id: 'sort-asc', label: tr(t, 'oldest_first', 'Oldest first'), active: sortDirection === 'asc', onClick: () => setSortDirection('asc') },
      ],
    },
  ]), [availableYears, groupMode, monthFilter, sortDirection, t, yearFilter])
  const activeFilterCount = [yearFilter !== 'all', monthFilter !== 'all', sortDirection !== 'desc', groupMode !== 'time'].filter(Boolean).length
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

  const buildCustomerPayload = useCallback((customer = {}) => ({
    name: String(customer.name || '').trim(),
    membership_number: String(customer.membership_number || '').trim().toUpperCase(),
    phone: customer.phone || '',
    email: customer.email || '',
    address: customer.address || '',
    company: customer.company || '',
    notes: customer.notes || '',
    userId: user?.id,
    userName: user?.name,
  }), [user?.id, user?.name])

  const load = useCallback(async ({ silent = false, label = 'Customers' } = {}) => {
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
          setLoadError(tr(t, 'customers_load_slow', 'Customers are taking longer than expected. Tap Retry or revisit the page in a moment.'))
        }, 10000)
      }
      try {
        const data = await withLoaderTimeout(() => window.api.getCustomers(), label, 8000)
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        setCustomers(Array.isArray(data) ? data : [])
        loadedOnceRef.current = true
        setLoadError('')
      } catch (error) {
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        const message = error?.message || 'Failed to load customers'
        if (!loadedOnceRef.current) {
          setCustomers([])
          setLoadError(message)
          notify(message, 'error')
          loadedOnceRef.current = true
        } else {
          const refreshMessage = tr(t, 'customers_refresh_failed', 'Unable to refresh customers right now. Showing the latest loaded data.')
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
  }, [notify, t])

  useEffect(() => {
    if (!active) {
      window.clearTimeout(loadWatchdogRef.current)
      invalidateTrackedRequest(loadRequestRef)
      loadPromiseRef.current = null
      setLoading(false)
      return undefined
    }
    load({ silent: loadedOnceRef.current })
    return () => {
      window.clearTimeout(loadWatchdogRef.current)
      invalidateTrackedRequest(loadRequestRef)
      loadPromiseRef.current = null
    }
  }, [active, load])
  useEffect(() => {
    if (!active || syncChannelName !== 'customers') return
    load({ silent: true, label: 'Customers refresh' })
  }, [active, load, syncChannelName, syncChannelTs])

  const handleSave = async (form) => {
    if (!String(form.name || '').trim()) {
      notify(tr(t, 'name_required', 'Name required'), 'error')
      return
    }
    if (!String(form.membership_number || '').trim()) {
      notify(tr(t, 'membership_number_required', 'Membership number is required'), 'error')
      return
    }

    try {
      const existingSnapshot = selected ? cloneHistorySnapshot(selected) : null
      const payload = { ...form, userId: user?.id, userName: user?.name }
      const result = selected
        ? await window.api.updateCustomer(selected.id, payload)
        : await window.api.createCustomer(payload)
      if (result?.success === false) {
        notify(result.error || 'Failed', 'error')
        return
      }
      if (selected && existingSnapshot) {
        const nextSnapshot = cloneHistorySnapshot({ ...existingSnapshot, ...payload, id: selected.id })
        actionHistory.pushAction({
          label: `Edit customer ${existingSnapshot.name || nextSnapshot.name || ''}`.trim(),
          undo: async () => {
            const restoreResult = await window.api.updateCustomer(existingSnapshot.id, buildCustomerPayload(existingSnapshot))
            if (restoreResult?.success === false) throw new Error(restoreResult.error || 'Failed to restore customer')
            await load({ silent: true, label: 'Customers undo edit' })
          },
          redo: async () => {
            const redoResult = await window.api.updateCustomer(nextSnapshot.id, buildCustomerPayload(nextSnapshot))
            if (redoResult?.success === false) throw new Error(redoResult.error || 'Failed to reapply customer changes')
            await load({ silent: true, label: 'Customers redo edit' })
          },
        })
      } else {
        let createdCustomerId = extractHistoryResultId(result)
        const createdSnapshot = cloneHistorySnapshot({ ...payload, id: createdCustomerId })
        if (createdCustomerId > 0) {
          actionHistory.pushAction({
            label: `Add customer ${createdSnapshot.name || ''}`.trim(),
            undo: async () => {
              await window.api.deleteCustomer(createdCustomerId)
              await load({ silent: true, label: 'Customers undo create' })
            },
            redo: async () => {
              const recreateResult = await window.api.createCustomer(buildCustomerPayload(createdSnapshot))
              if (recreateResult?.success === false) throw new Error(recreateResult.error || 'Failed to recreate customer')
              createdCustomerId = extractHistoryResultId(recreateResult)
              await load({ silent: true, label: 'Customers redo create' })
            },
          })
        }
      }
      notify(selected ? tr(t, 'customer_updated', 'Updated') : tr(t, 'customer_added', 'Added'))
      setModal(null)
      setSelected(null)
      await load({ silent: true, label: 'Customers after save' })
    } catch (error) {
      notify(error.message || 'Failed', 'error')
    }
  }

  const handleDelete = async (customer) => {
    if (!confirm(`Delete customer "${customer.name}"?`)) return
    try {
      const snapshot = cloneHistorySnapshot(customer)
      await window.api.deleteCustomer(customer.id)
      let restoredCustomerId = 0
      actionHistory.pushAction({
        label: `Delete customer ${snapshot.name || ''}`.trim(),
        undo: async () => {
          const restoreResult = await window.api.createCustomer(buildCustomerPayload(snapshot))
          if (restoreResult?.success === false) throw new Error(restoreResult.error || 'Failed to restore customer')
          restoredCustomerId = extractHistoryResultId(restoreResult)
          await load({ silent: true, label: 'Customers undo delete' })
        },
        redo: async () => {
          const targetId = restoredCustomerId || Number(snapshot.id || 0)
          if (!targetId) return
          await window.api.deleteCustomer(targetId)
          await load({ silent: true, label: 'Customers redo delete' })
        },
      })
      notify(tr(t, 'customer_deleted', 'Deleted'))
      setModal(null)
      setSelected(null)
      await load({ silent: true, label: 'Customers after delete' })
    } catch (error) {
      notify(error.message || 'Failed', 'error')
    }
  }

  const handleBulkDelete = async () => {
    if (!selectedIds.size || bulkActionBusy) return
    if (!confirm(`Delete ${selectedIds.size} customer(s)?`)) return
    const ids = [...selectedIds]
    const snapshots = customers.filter((customer) => ids.includes(Number(customer?.id || 0))).map((customer) => JSON.parse(JSON.stringify(customer)))
    const failedIds = []
    let deletedCount = 0
    setBulkActionBusy(true)
    try {
      for (const id of ids) {
        try {
          await window.api.deleteCustomer(id)
          deletedCount += 1
        } catch (_) {
          failedIds.push(Number(id))
        }
      }
      setSelectedIds(new Set(failedIds))
      await load({ silent: true, label: 'Customers refresh after delete' })
      const deletedSnapshots = snapshots.filter((snapshot) => !failedIds.includes(Number(snapshot?.id || 0)))
      if (deletedCount > 0 && deletedSnapshots.length) {
        let restoredEntries = []
        actionHistory.pushAction({
          label: `Delete ${deletedCount} customer${deletedCount === 1 ? '' : 's'}`,
          undo: async () => {
            restoredEntries = []
            for (const snapshot of deletedSnapshots) {
              const result = await window.api.createCustomer({
                name: snapshot.name || '',
                membership_number: snapshot.membership_number || '',
                phone: snapshot.phone || '',
                email: snapshot.email || '',
                address: snapshot.address || '',
                company: snapshot.company || '',
                notes: snapshot.notes || '',
                userId: user?.id,
                userName: user?.name,
              })
              restoredEntries.push({ restoredId: Number(result?.id || result?.data?.id || 0) })
            }
            await load({ silent: true, label: 'Customers restore deleted' })
          },
          redo: async () => {
            const idsToDelete = restoredEntries.map((entry) => Number(entry.restoredId || 0)).filter((id) => id > 0)
            for (const id of idsToDelete) {
              await window.api.deleteCustomer(id)
            }
            await load({ silent: true, label: 'Customers redo delete' })
          },
        })
      }
      if (failedIds.length) {
        notify(`Deleted ${deletedCount} customer(s), ${failedIds.length} failed`, 'warning')
      } else {
        notify(`${deletedCount} ${tr(t, 'deleted', 'deleted')}`)
      }
    } finally {
      setBulkActionBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ActionHistoryBar history={actionHistory} />
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <label htmlFor="customer-search" className="sr-only">{tr(t, 'search_customers_placeholder', 'Search customers')}</label>
          <input
            id="customer-search"
            name="customer_search"
            autoComplete="off"
            className="input max-w-xs min-w-0 flex-1"
            placeholder={tr(t, 'search_customers_placeholder', `${tr(t, 'search', 'Search')} customers`)}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <span className="whitespace-nowrap text-sm text-gray-400">{visibleCustomers.length}</span>
        </div>

        <div className="flex flex-shrink-0 flex-nowrap items-center gap-1.5 overflow-x-auto">
          {loadError ? (
            <button
              type="button"
              className="btn-secondary whitespace-nowrap text-sm text-amber-700 dark:text-amber-300"
              onClick={() => load({ silent: false, label: 'Customers retry' })}
            >
              {tr(t, 'retry', 'Retry')}
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
            label={tr(t, 'filters', 'Filters')}
            activeCount={activeFilterCount}
            sections={contactFilterSections}
            onClear={() => {
              setYearFilter('all')
              setMonthFilter('all')
              setSortDirection('desc')
              setGroupMode('time')
            }}
            compact
            mobileIconOnly
          />
          <button className="btn-secondary inline-flex items-center gap-1.5 whitespace-nowrap text-sm" onClick={() => setModal('import')} title={tr(t, 'import_contacts', 'Import')}>
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">{tr(t, 'import_contacts', 'Import')}</span>
          </button>
          <button
            className="btn-secondary inline-flex items-center gap-1.5 whitespace-nowrap text-sm"
            onClick={() => {
              const rows = visibleCustomers.map((customer) => {
                const options = parseContactOptions(customer.address)
                return {
                  Name: customer.name || '',
                  Membership_Number: customer.membership_number || '',
                  Phone: customer.phone || '',
                  Email: customer.email || '',
                  Company: customer.company || '',
                  Options: options.map((option) => `[${option.label || 'Option'}] ${[option.name, option.phone, option.email, option.address].filter(Boolean).join(' | ')}`).join(' || '),
                  Notes: customer.notes || '',
                  Created: customer.created_at || '',
                }
              })
              downloadCSV(`customers-${new Date().toISOString().slice(0, 10)}.csv`, rows)
            }}
          >
            <Upload className="h-4 w-4" />
            <span className="hidden sm:inline">{tr(t, 'export', 'Export')}</span>
          </button>
          <button className="btn-primary inline-flex items-center gap-1.5 whitespace-nowrap text-sm" onClick={() => { setSelected(null); setModal('form') }} title={tr(t, 'add_customer', 'Add Customer')}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{tr(t, 'add_customer', 'Add Customer')}</span>
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
        emptyLabel={tr(t, 'no_customers', 'No customers')}
        columns={customerColumns}
        selectAll={selectAllProp}
        selectedCount={selectedIds.size}
        totalCount={visibleCustomers.length}
        onRetry={() => load({ silent: false, label: 'Customers retry' })}
        loadingLabel={tr(t, 'loading_customers', 'Loading customers...')}
        loadingDetails={tr(t, 'contacts_loading_details', 'Fetching customers, filters, and grouped sections.')}
        t={t}
        renderRow={(customer) => {
          if (customer?.__kind === 'section') {
            const section = customer.section
            return (
              <tr key={section.id} className="bg-slate-100/90 dark:bg-slate-800/80">
                <td colSpan={customerColumns.length + 2} className="px-4 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="inline-flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded"
                        checked={isSectionFullySelected(section.ids)}
                        ref={(node) => {
                          if (node) node.indeterminate = isSectionPartiallySelected(section.ids)
                        }}
                        onChange={(event) => toggleSectionSelection(section.ids, event.target.checked)}
                        aria-label={`Select ${section.label}`}
                      />
                      <span>{section.label}</span>
                      <span className="normal-case tracking-normal text-slate-400">{section.items.length}</span>
                    </label>
                    <div className="flex items-center gap-1">
                      <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white" onClick={() => toggleSectionCollapsed(section.id)}>
                        {customer.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        {customer.collapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            )
          }
          const options = parseContactOptions(customer.address)
          const primaryOption = getPrimaryContactOption(options, {
            fallback: {
              name: customer.name || '',
              phone: customer.phone || '',
              email: customer.email || '',
              address: '',
            },
          })
          return (
            <tr key={customer.id} className={`table-row cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 ${selectedIds.has(customer.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
              <td className="w-10 px-3 py-2" onClick={(event) => event.stopPropagation()}>
                <label htmlFor={`customer-select-${customer.id}`} className="sr-only">{`Select ${customer.name}`}</label>
                <input id={`customer-select-${customer.id}`} name={`customer_select_${customer.id}`} type="checkbox" className="h-4 w-4 cursor-pointer rounded" checked={selectedIds.has(customer.id)} onChange={() => toggleOne(customer.id)} />
              </td>
              <td className="px-4 py-2 font-medium text-gray-900 cursor-pointer dark:text-white" onClick={() => { setSelected(customer); setModal('detail') }}>{customer.name}</td>
              <td className="px-4 py-2 font-mono text-xs text-gray-500 cursor-pointer" onClick={() => { setSelected(customer); setModal('detail') }}>{customer.membership_number || '--'}</td>
              <td className="px-4 py-2 font-semibold text-blue-600 cursor-pointer dark:text-blue-300" onClick={() => { setSelected(customer); setModal('detail') }}>
                {Number(customer.points_balance || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </td>
              <td className="px-4 py-2 text-gray-500 cursor-pointer" onClick={() => { setSelected(customer); setModal('detail') }}>{primaryOption.phone || customer.phone || '-'}</td>
              <td className="px-4 py-2 text-xs text-gray-500 cursor-pointer" onClick={() => { setSelected(customer); setModal('detail') }}>{primaryOption.email || customer.email || '-'}</td>
              <td className="px-4 py-2 text-gray-500 cursor-pointer" onClick={() => { setSelected(customer); setModal('detail') }}>{customer.company || '-'}</td>
              <td className="px-4 py-2 cursor-pointer" onClick={() => { setSelected(customer); setModal('detail') }}>
                {options.length === 0 ? (
                  <span className="text-xs text-gray-400">-</span>
                ) : (
                  <div className="flex flex-wrap items-center gap-1">
                    {options.slice(0, 2).map((option, index) => (
                      <span key={index} className="badge-blue max-w-[90px] truncate text-xs">{option.label || `Opt ${index + 1}`}</span>
                    ))}
                    {options.length > 2 ? <span className="text-xs text-gray-400">+{options.length - 2}</span> : null}
                  </div>
                )}
              </td>
              <td className="px-2 py-2 text-right" onClick={(event) => event.stopPropagation()}>
                <ThreeDotMenu onDetails={() => { setSelected(customer); setModal('detail') }} onEdit={() => { setSelected(customer); setModal('form') }} onDelete={() => handleDelete(customer)} />
              </td>
            </tr>
          )
        }}
        renderCard={(customer) => {
          if (customer?.__kind === 'section') {
            const section = customer.section
            return (
              <div key={section.id} className="rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800/70">
                <div className="flex items-center justify-between gap-3">
                  <label className="inline-flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded"
                      checked={isSectionFullySelected(section.ids)}
                      ref={(node) => {
                        if (node) node.indeterminate = isSectionPartiallySelected(section.ids)
                      }}
                      onChange={(event) => toggleSectionSelection(section.ids, event.target.checked)}
                      aria-label={`Select ${section.label}`}
                    />
                    <span>{section.label}</span>
                    <span className="normal-case tracking-normal text-slate-400">{section.items.length}</span>
                  </label>
                  <div className="flex items-center gap-1">
                    <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white" onClick={() => toggleSectionCollapsed(section.id)}>
                      {customer.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            )
          }
          const options = parseContactOptions(customer.address)
          const primaryOption = getPrimaryContactOption(options, {
            fallback: {
              name: customer.name || '',
              phone: customer.phone || '',
              email: customer.email || '',
              address: '',
            },
          })
          return (
            <div key={customer.id} className={`card flex items-center gap-3 p-3 ${selectedIds.has(customer.id) ? 'bg-blue-50 ring-2 ring-blue-400 dark:bg-blue-900/20' : ''}`}>
              <div className="flex-shrink-0" onClick={(event) => { event.stopPropagation(); toggleOne(customer.id) }}>
                <label htmlFor={`customer-card-select-${customer.id}`} className="sr-only">{`Select ${customer.name}`}</label>
                <input id={`customer-card-select-${customer.id}`} name={`customer_card_select_${customer.id}`} type="checkbox" className="h-5 w-5 cursor-pointer rounded" checked={selectedIds.has(customer.id)} onChange={() => toggleOne(customer.id)} />
              </div>
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-600 dark:bg-blue-900/40">{customer.name?.[0]?.toUpperCase()}</div>
              <div className="min-w-0 flex-1 cursor-pointer" onClick={() => { setSelected(customer); setModal('detail') }}>
                <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{customer.name}</div>
                {customer.membership_number ? <div className="font-mono text-[11px] text-blue-500">{customer.membership_number}</div> : null}
                <div className="text-xs font-semibold text-blue-600 dark:text-blue-300">{tr(t, 'loyalty_points', 'Points')}: {Number(customer.points_balance || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
                {primaryOption.phone || customer.phone ? <div className="text-xs text-gray-500">{primaryOption.phone || customer.phone}</div> : null}
                {customer.company ? <div className="truncate text-xs text-gray-400">{customer.company}</div> : null}
                {options.length ? <div className="mt-0.5 text-xs text-blue-500">{options.length} contact option{options.length !== 1 ? 's' : ''}</div> : null}
              </div>
              <div onClick={(event) => event.stopPropagation()}>
                <ThreeDotMenu onDetails={() => { setSelected(customer); setModal('detail') }} onEdit={() => { setSelected(customer); setModal('form') }} onDelete={() => handleDelete(customer)} />
              </div>
            </div>
          )
        }}
      />

      {modal === 'form' ? <CustomerForm customer={selected} onSave={handleSave} onClose={() => { setModal(null); setSelected(null) }} t={t} /> : null}
      {modal === 'import' ? <ImportModal type="customer" onClose={() => setModal(null)} onDone={load} /> : null}
      {modal === 'detail' && selected ? (
        <DetailModal
          item={selected}
          fields={[
            [tr(t, 'name', 'Name'), selected.name],
            ['Membership', selected.membership_number],
            [tr(t, 'loyalty_points', 'Points'), Number(selected.points_balance || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })],
            ['Points earned', Number(selected.points_earned || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })],
            ['Points redeemed', Number(selected.points_redeemed || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })],
            ['Reward points', Number(selected.points_rewarded || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })],
            ['Points deducted', Number(selected.points_deducted || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })],
            [tr(t, 'phone', 'Phone'), selected.phone],
            [tr(t, 'email', 'Email'), selected.email],
            [tr(t, 'company', 'Company'), selected.company],
            ['Contact Options', buildContactOptionSummary(parseContactOptions(selected.address))],
            [tr(t, 'notes', 'Notes'), selected.notes],
            [tr(t, 'col_added', 'Added'), selected.created_at || fmtDate(selected.created_at)],
          ]}
          onEdit={() => setModal('form')}
          onDelete={() => handleDelete(selected)}
          onClose={() => { setModal(null); setSelected(null) }}
          t={t}
        />
      ) : null}
    </div>
  )
}

export { CustomerForm, CustomersTab }

