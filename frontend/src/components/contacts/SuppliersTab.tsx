import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentProps } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import { useApp as useAppHook, useSync as useSyncHook } from '../../AppContext.tsx'
import type { QueryParams } from '../../api/query.ts'
import { fmtDate } from '../../utils/formatters'
import Modal from '../shared/Modal'
import FilterMenu from '../shared/FilterMenu'
import ActionHistoryBar from '../shared/ActionHistoryBar'
import { ThreeDotMenu, DetailModal, ContactTable, buildSelectedSnapshots, countActiveFlags, useContactSelection } from './shared'
import { withLoaderTimeout } from '../../utils/loaders.ts'
import { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent } from '../../utils/loaders.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { buildAlphabetActionSections, buildTimeActionSections, getAvailableYears, getTimeGroupingMode } from '../../utils/groupedRecords.ts'
import { useActionHistory } from '../../utils/actionHistory.ts'
import { cloneHistorySnapshot, extractHistoryResultId } from '../../utils/historyHelpers.ts'
import { runConcurrentTasks } from '../../utils/bulkOps.ts'
import {
  CONTACT_OPTION_LIMIT,
  buildContactOptionSummary,
  createContactOption,
  getPrimaryContactOption,
  parseStoredContactOptions,
  serializeContactOptions,
} from './contactOptionUtils'
import type { ContactOption } from './contactOptionUtils'

const ContactImportModal = lazy(() => import('./ContactImportModal'))
const SUPPLIER_MUTATION_TIMEOUT_MS = 12000

type TranslateFn = (key: string) => string | undefined
type NotifyFn = (message: string, tone?: string) => void
type ContactModal = 'form' | 'import' | 'detail' | null
type SortDirection = 'asc' | 'desc'
type SupplierGroupMode = 'time' | 'alphabet'

interface AppUser {
  id?: string | number | null
  name?: string | null
}

interface AppContextValue {
  user?: AppUser | null
}

interface SyncContextValue {
  syncChannel?: {
    channel?: string | null
    ts?: string | number | null
  } | null
}

interface SuppliersTabProps {
  t: TranslateFn
  notify: NotifyFn
  active?: boolean
}

interface SupplierRow extends Record<string, unknown> {
  id: number | string
  name?: string | null
  phone?: string | null
  email?: string | null
  company?: string | null
  contact_person?: string | null
  address?: string | null
  notes?: string | null
  created_at?: string | null
}

interface SupplierPayload {
  name?: string | null
  phone?: string | null
  email?: string | null
  company?: string | null
  contact_person?: string | null
  address?: string | null
  notes?: string | null
  userId?: string | number | null
  userName?: string | null
}

interface SupplierMutationResult {
  success?: boolean
  error?: string
  id?: unknown
  data?: { id?: unknown } | null
}

interface SectionRow extends Record<string, unknown> {
  __kind: 'section'
  section: {
    id: string
    label: string
    ids: Array<number | string>
    items: SupplierRow[]
  }
  collapsed: boolean
}

type SupplierDisplayRow = SupplierRow | SectionRow

interface SupplierApi {
  getSuppliers: (query?: QueryParams) => Promise<unknown>
  createSupplier: (payload: SupplierPayload) => Promise<SupplierMutationResult | unknown>
  updateSupplier: (id: number | string, payload: SupplierPayload) => Promise<SupplierMutationResult | unknown>
  deleteSupplier: (id: number | string) => Promise<SupplierMutationResult | unknown>
}

type ActionHistoryBarHistory = ComponentProps<typeof ActionHistoryBar>['history']

const useApp = useAppHook as () => AppContextValue
const useSync = useSyncHook as () => SyncContextValue

type ContactReadTransportModule = typeof import('../../api/contactReadTransport.ts')
type ContactWriteTransportModule = typeof import('../../api/contactWriteTransport.ts')
type CsvUtilsModule = typeof import('../../utils/csv')

let contactReadTransportModulePromise: Promise<ContactReadTransportModule> | null = null
let contactWriteTransportModulePromise: Promise<ContactWriteTransportModule> | null = null
let csvUtilsModulePromise: Promise<CsvUtilsModule> | null = null

function loadContactReadTransportModule(): Promise<ContactReadTransportModule> {
  if (!contactReadTransportModulePromise) contactReadTransportModulePromise = import('../../api/contactReadTransport.ts')
  return contactReadTransportModulePromise
}

function loadContactWriteTransportModule(): Promise<ContactWriteTransportModule> {
  if (!contactWriteTransportModulePromise) contactWriteTransportModulePromise = import('../../api/contactWriteTransport.ts')
  return contactWriteTransportModulePromise
}

function loadCsvUtilsModule(): Promise<CsvUtilsModule> {
  if (!csvUtilsModulePromise) csvUtilsModulePromise = import('../../utils/csv')
  return csvUtilsModulePromise
}

function getSupplierApi(): SupplierApi {
  return {
    getSuppliers: async (query = {}) => (await loadContactReadTransportModule()).getSuppliers(query),
    createSupplier: async (payload) => (await loadContactWriteTransportModule()).createSupplier(payload as Record<string, unknown>),
    updateSupplier: async (id, payload) => (await loadContactWriteTransportModule()).updateSupplier(id, payload as Record<string, unknown>),
    deleteSupplier: async (id) => (await loadContactWriteTransportModule()).deleteSupplier(id),
  }
}

function normalizeSupplierRows(value: unknown): SupplierRow[] {
  if (Array.isArray(value)) return value as SupplierRow[]
  if (value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: SupplierRow[] }).items
  }
  return []
}

function isSectionRow(row: SupplierDisplayRow | null | undefined): row is SectionRow {
  return row?.__kind === 'section'
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

interface SupplierFormProps {
  supplier?: SupplierRow | null
  onSave: (payload: SupplierPayload) => Promise<unknown> | unknown
  onClose: () => void
  t: TranslateFn
}

function SupplierForm({ supplier, onSave, onClose, t }: SupplierFormProps) {
  const init: SupplierPayload = supplier
    ? { ...supplier }
    : { name: '', phone: '', email: '', company: '', contact_person: '', address: '', notes: '' }
  const [form, setForm] = useState<SupplierPayload>(init)
  const [options, setOptions] = useState<ContactOption[]>(() => {
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
  const set = (key: keyof SupplierPayload, value: string) => setForm((current) => ({ ...current, [key]: value }))
  const addOption = () => setOptions((current) => {
    if (current.length >= CONTACT_OPTION_LIMIT) return current
    return [...current, createContactOption()]
  })
  const updateOption = (index: number, nextOption: ContactOption) => setOptions((current) => current.map((option, itemIndex) => (itemIndex === index ? nextOption : option)))
  const removeOption = (index: number) => setOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))
  const handleSubmit = async () => {
    if (saving) return
    setSaving(true)
    try {
      const primaryOption = getPrimaryContactOption(options)
      await Promise.resolve(onSave({
        ...form,
        phone: primaryOption.phone || form.phone || '',
        email: primaryOption.email || form.email || '',
        address: serializeContactOptions(options) || '',
        contact_person: primaryOption.name || form.contact_person || '',
      }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={supplier ? (t('edit_supplier') || 'Edit Supplier') : (t('add_supplier') || 'Add Supplier')} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label htmlFor="supplier-form-name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('name')} *</label>
          <input id="supplier-form-name" name="supplier_name" autoComplete="organization" className="input" value={form.name || ''} onChange={(event) => set('name', event.target.value)} autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="supplier-form-company" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('company')}</label>
            <input id="supplier-form-company" name="supplier_company" autoComplete="organization" className="input" value={form.company || ''} onChange={(event) => set('company', event.target.value)} />
          </div>
          <div>
            <label htmlFor="supplier-form-contact-person" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('contact_person') || 'Contact Person'}</label>
            <input id="supplier-form-contact-person" name="supplier_contact_person" autoComplete="name" className="input" value={form.contact_person || ''} onChange={(event) => set('contact_person', event.target.value)} />
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
                {(() => {
                  const fieldId = (suffix: string) => `supplier-option-${index}-${suffix}`
                  return (
                    <>
                <div className="flex items-center gap-2">
                  <span className="w-5 flex-shrink-0 text-xs font-bold text-gray-400">#{index + 1}</span>
                  <input id={fieldId('label')} name={fieldId('label')} className="input flex-1 text-xs py-1" autoComplete="off" placeholder="Option label" value={option.label || ''} onChange={(event) => updateOption(index, { ...option, label: event.target.value })} />
                  {options.length > 1 ? <button type="button" onClick={() => removeOption(index)} className="rounded px-1.5 py-1 text-xs text-red-500 hover:text-red-700">Remove</button> : null}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label htmlFor={fieldId('name')} className="mb-0.5 block text-xs text-gray-400">Name</label>
                    <input id={fieldId('name')} name={fieldId('name')} className="input text-xs py-1" autoComplete="name" placeholder="Contact name" value={option.name || ''} onChange={(event) => updateOption(index, { ...option, name: event.target.value })} />
                  </div>
                  <div>
                    <label htmlFor={fieldId('phone')} className="mb-0.5 block text-xs text-gray-400">Phone</label>
                    <input id={fieldId('phone')} name={fieldId('phone')} className="input text-xs py-1" autoComplete="tel" placeholder="Phone number" value={option.phone || ''} onChange={(event) => updateOption(index, { ...option, phone: event.target.value })} />
                  </div>
                </div>
                <div>
                  <label htmlFor={fieldId('email')} className="mb-0.5 block text-xs text-gray-400">Email</label>
                  <input id={fieldId('email')} name={fieldId('email')} className="input text-xs py-1" autoComplete="email" type="email" placeholder="Email address" value={option.email || ''} onChange={(event) => updateOption(index, { ...option, email: event.target.value })} />
                </div>
                <div>
                  <label htmlFor={fieldId('address')} className="mb-0.5 block text-xs text-gray-400">Address</label>
                  <input id={fieldId('address')} name={fieldId('address')} className="input text-xs py-1" autoComplete="street-address" placeholder="Office or pickup address" value={option.address || ''} onChange={(event) => updateOption(index, { ...option, address: event.target.value })} />
                </div>
                    </>
                  )
                })()}
              </div>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="supplier-form-notes" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('notes') || 'Notes'}</label>
          <textarea id="supplier-form-notes" name="supplier_notes" autoComplete="off" className="input resize-none" rows={2} value={form.notes || ''} onChange={(event) => set('notes', event.target.value)} />
        </div>
        <div className="flex gap-3 pt-1">
          <button className="btn-primary flex-1" onClick={handleSubmit} disabled={saving}>{saving ? (t('saving') || 'Saving...') : t('save')}</button>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  )
}

function SuppliersTab({ t, notify, active = true }: SuppliersTabProps) {
  const { user } = useApp()
  const { syncChannel } = useSync()
  const loadRequestRef = useRef(0)
  const loadedOnceRef = useRef(false)
  const loadWatchdogRef = useRef<number | null>(null)
  const loadPromiseRef = useRef<Promise<void> | null>(null)
  const saveInFlightRef = useRef(false)
  const deleteInFlightRef = useRef(false)
  const bulkDeleteInFlightRef = useRef(false)
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const tr = useCallback((key: string, fallbackEn: string, fallbackKm = fallbackEn): string => {
    const value = typeof t === 'function' ? t(key) : null
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }, [isKhmer, t])
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<ContactModal>(null)
  const [selected, setSelected] = useState<SupplierRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [bulkActionBusy, setBulkActionBusy] = useState(false)
  const [yearFilter, setYearFilter] = useState('all')
  const [monthFilter, setMonthFilter] = useState('all')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [groupMode, setGroupMode] = useState<SupplierGroupMode>('time')
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set())
  const [historyReady, setHistoryReady] = useState(false)
  const deferredSearch = useDeferredValue(search)
  const syncChannelName = String(syncChannel?.channel || '')
  const syncChannelTs = Number(syncChannel?.ts || 0)
  const actionHistory = useActionHistory({ limit: 3, notify, enabled: historyReady, user })
  const supplierQuery = useMemo(() => ({
    search: deferredSearch.trim() || undefined,
    year: yearFilter !== 'all' ? yearFilter : undefined,
    month: yearFilter !== 'all' && monthFilter !== 'all' ? monthFilter : undefined,
  }), [deferredSearch, monthFilter, yearFilter])

  const filteredBySearch = useMemo(() => suppliers.filter((supplier) => {
    const query = deferredSearch.toLowerCase().trim()
    if (!query) return true
    return (
      String(supplier.name || '').toLowerCase().includes(query)
      || String(supplier.phone || '').includes(query)
      || String(supplier.email || '').toLowerCase().includes(query)
      || String(supplier.company || '').toLowerCase().includes(query)
      || String(supplier.contact_person || '').toLowerCase().includes(query)
    )
  }), [deferredSearch, suppliers])

  const timeMode = useMemo(() => getTimeGroupingMode(yearFilter, monthFilter), [monthFilter, yearFilter])
  const availableYears = useMemo(
    () => getAvailableYears(filteredBySearch, (supplier) => supplier?.created_at),
    [filteredBySearch],
  )
  const filteredSections = useMemo(() => (
    groupMode === 'alphabet'
      ? buildAlphabetActionSections(filteredBySearch, {
        getName: (supplier) => supplier?.name,
        getItemId: (supplier) => Number(supplier?.id),
        sortDirection: 'asc',
      })
      : buildTimeActionSections(filteredBySearch, {
        getDate: (supplier) => supplier?.created_at,
        getItemId: (supplier) => Number(supplier?.id),
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

  const visibleSuppliers = useMemo(
    () => filteredSections.flatMap((section) => section.items),
    [filteredSections],
  )
  const displayRows = useMemo<SupplierDisplayRow[]>(
    () => filteredSections.flatMap((section) => {
      const collapsed = collapsedSections.has(section.id)
      return [
        { __kind: 'section', section, collapsed },
        ...(!collapsed ? section.items : []),
      ] as SupplierDisplayRow[]
    }),
    [collapsedSections, filteredSections],
  )

  const { selectedIds, setSelectedIds, toggleOne, selectAllProp } = useContactSelection(visibleSuppliers)
  const supplierColumns = [t('name') || 'Name', t('phone') || 'Phone', t('email') || 'Email', t('company') || 'Company', t('contact_person') || 'Contact']
  const contactFilterSections = useMemo(() => ([
    {
      id: 'sort',
      label: tr('sort', 'Sort'),
      options: [
        { id: 'sort-desc', label: tr('newest_first', 'Newest first'), active: sortDirection === 'desc', onClick: () => setSortDirection('desc') },
        { id: 'sort-asc', label: tr('oldest_first', 'Oldest first'), active: sortDirection === 'asc', onClick: () => setSortDirection('asc') },
      ],
    },
    {
      id: 'group',
      label: tr('group_by', 'Group by'),
      options: [
        { id: 'group-time', label: tr('date', 'Date'), active: groupMode === 'time', onClick: () => setGroupMode('time') },
        { id: 'group-alphabet', label: 'A-Z / ខ្មែរ', active: groupMode === 'alphabet', onClick: () => setGroupMode('alphabet') },
      ],
    },
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

  ]), [availableYears, groupMode, monthFilter, sortDirection, tr, yearFilter])
  const activeFilterCount = countActiveFlags([yearFilter !== 'all', monthFilter !== 'all', sortDirection !== 'desc', groupMode !== 'time'])
  const toggleSectionCollapsed = (sectionId: string) => setCollapsedSections((current) => {
    const next = new Set(current)
    if (next.has(sectionId)) next.delete(sectionId)
    else next.add(sectionId)
    return next
  })
  const isSectionFullySelected = (ids: Array<number | string> = []) => ids.length > 0 && ids.every((id) => selectedIds.has(Number(id)))
  const isSectionPartiallySelected = (ids: Array<number | string> = []) => ids.some((id) => selectedIds.has(Number(id))) && !isSectionFullySelected(ids)
  const toggleSectionSelection = (ids: Array<number | string>, checked: boolean) => {
    ids.forEach((id) => {
      const numericId = Number(id)
      const isSelected = selectedIds.has(numericId)
      if ((checked && !isSelected) || (!checked && isSelected)) toggleOne(numericId)
    })
  }

  const buildSupplierPayload = useCallback((supplier: Partial<SupplierRow> = {}): SupplierPayload => ({
    name: supplier.name || '',
    phone: supplier.phone || '',
    email: supplier.email || '',
    company: supplier.company || '',
    contact_person: supplier.contact_person || '',
    address: supplier.address || '',
    notes: supplier.notes || '',
    userId: user?.id,
    userName: user?.name,
  }), [user?.id, user?.name])

  const runSupplierMutation = useCallback(async (loader: () => unknown | Promise<unknown>, label: string): Promise<SupplierMutationResult> => (
    await withLoaderTimeout(loader, label, SUPPLIER_MUTATION_TIMEOUT_MS) as SupplierMutationResult
  ), [])

  const clearLoadWatchdog = useCallback(() => {
    if (loadWatchdogRef.current != null) {
      window.clearTimeout(loadWatchdogRef.current)
      loadWatchdogRef.current = null
    }
  }, [])

  const load = useCallback(async ({ silent = false, label = 'Suppliers' }: { silent?: boolean, label?: string } = {}): Promise<void> => {
    if (loadPromiseRef.current) return loadPromiseRef.current
    const requestId = beginTrackedRequest(loadRequestRef)
    const promise = (async () => {
      clearLoadWatchdog()
      if (!silent || !loadedOnceRef.current) {
        setLoading(true)
        setLoadError('')
        loadWatchdogRef.current = window.setTimeout(() => {
          if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
          setLoading(false)
          setLoadError(tr('suppliers_load_slow', 'Suppliers are taking longer than expected. Tap Retry or revisit the page in a moment.'))
        }, 15000)
      }
      try {
        const data = await withLoaderTimeout(() => getSupplierApi().getSuppliers(supplierQuery), label, 20000)
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        setSuppliers(normalizeSupplierRows(data))
        loadedOnceRef.current = true
        setLoadError('')
      } catch (error: unknown) {
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        const message = getErrorMessage(error, 'Failed to load suppliers')
        if (!loadedOnceRef.current) {
          setLoadError(message)
          notify(message, 'error')
        } else {
          const refreshMessage = tr('suppliers_refresh_failed', 'Unable to refresh suppliers right now. Showing the latest loaded data.')
          setLoadError((current) => current || refreshMessage)
          notify(refreshMessage, 'warning')
        }
      } finally {
        clearLoadWatchdog()
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
  }, [clearLoadWatchdog, notify, supplierQuery, tr])

  useEffect(() => {
    if (!active) {
      setHistoryReady(false)
      clearLoadWatchdog()
      invalidateTrackedRequest(loadRequestRef)
      loadPromiseRef.current = null
      setLoading(false)
      return undefined
    }
    load({ silent: loadedOnceRef.current })
    return () => {
      clearLoadWatchdog()
      invalidateTrackedRequest(loadRequestRef)
      loadPromiseRef.current = null
    }
  }, [active, clearLoadWatchdog, load])
  useEffect(() => {
    if (!active) {
      setHistoryReady(false)
      return undefined
    }
    if (!loadedOnceRef.current || loading) return undefined
    setHistoryReady(true)
    return undefined
  }, [active, loading])
  useEffect(() => {
    if (!active || syncChannelName !== 'suppliers') return
    load({ silent: true, label: 'Suppliers refresh' })
  }, [active, load, syncChannelName, syncChannelTs])

  const handleSave = async (form: SupplierPayload) => {
    if (!beginSingleAction(saveInFlightRef)) return
    if (!String(form.name || '').trim()) {
      finishSingleAction(saveInFlightRef)
      return notify(t('name_required') || 'Name required', 'error')
    }
    try {
      const existingSnapshot = selected ? cloneHistorySnapshot(selected) : null
      const payload = { ...form, userId: user?.id, userName: user?.name }
      const result = selected
        ? await runSupplierMutation(() => getSupplierApi().updateSupplier(selected.id, payload), 'Update supplier')
        : await runSupplierMutation(() => getSupplierApi().createSupplier(payload), 'Create supplier')
      if (result?.success === false) {
        notify(result.error || 'Failed', 'error')
        return
      }
      if (selected && existingSnapshot) {
        const nextSnapshot = cloneHistorySnapshot({ ...existingSnapshot, ...payload, id: selected.id })
        actionHistory.pushAction({
          label: `Edit supplier ${existingSnapshot.name || nextSnapshot.name || ''}`.trim(),
          undo: async () => {
            const restoreResult = await runSupplierMutation(
              () => getSupplierApi().updateSupplier(existingSnapshot.id, buildSupplierPayload(existingSnapshot)),
              'Undo supplier edit',
            )
            if (restoreResult?.success === false) throw new Error(restoreResult.error || 'Failed to restore supplier')
            await load({ silent: true, label: 'Suppliers undo edit' })
          },
          redo: async () => {
            const redoResult = await runSupplierMutation(
              () => getSupplierApi().updateSupplier(nextSnapshot.id, buildSupplierPayload(nextSnapshot)),
              'Redo supplier edit',
            )
            if (redoResult?.success === false) throw new Error(redoResult.error || 'Failed to reapply supplier changes')
            await load({ silent: true, label: 'Suppliers redo edit' })
          },
        })
      } else {
        let createdSupplierId = extractHistoryResultId(result)
        const createdSnapshot = cloneHistorySnapshot({ ...payload, id: createdSupplierId })
        if (createdSupplierId > 0) {
          actionHistory.pushAction({
            label: `Add supplier ${createdSnapshot.name || ''}`.trim(),
            undo: async () => {
              await runSupplierMutation(() => getSupplierApi().deleteSupplier(createdSupplierId), 'Undo supplier create')
              await load({ silent: true, label: 'Suppliers undo create' })
            },
            redo: async () => {
              const recreateResult = await runSupplierMutation(
                () => getSupplierApi().createSupplier(buildSupplierPayload(createdSnapshot)),
                'Redo supplier create',
              )
              if (recreateResult?.success === false) throw new Error(recreateResult.error || 'Failed to recreate supplier')
              createdSupplierId = extractHistoryResultId(recreateResult)
              await load({ silent: true, label: 'Suppliers redo create' })
            },
          })
        }
      }
      notify(selected ? (t('supplier_updated') || 'Updated') : (t('supplier_added') || 'Added'))
      setModal(null)
      setSelected(null)
      await load({ silent: true, label: 'Suppliers after save' })
    } catch (error: unknown) {
      notify(getErrorMessage(error, 'Failed'), 'error')
    } finally {
      finishSingleAction(saveInFlightRef)
    }
  }

  const handleDelete = async (supplier: SupplierRow) => {
    if (!beginSingleAction(deleteInFlightRef)) return
    if (!confirm(`Delete supplier "${supplier.name}"?`)) {
      finishSingleAction(deleteInFlightRef)
      return
    }
    try {
      const snapshot = cloneHistorySnapshot(supplier)
      await runSupplierMutation(() => getSupplierApi().deleteSupplier(supplier.id), 'Delete supplier')
      let restoredSupplierId = 0
      actionHistory.pushAction({
        label: `Delete supplier ${snapshot.name || ''}`.trim(),
        undo: async () => {
          const restoreResult = await runSupplierMutation(
            () => getSupplierApi().createSupplier(buildSupplierPayload(snapshot)),
            'Undo supplier delete',
          )
          if (restoreResult?.success === false) throw new Error(restoreResult.error || 'Failed to restore supplier')
          restoredSupplierId = extractHistoryResultId(restoreResult)
          await load({ silent: true, label: 'Suppliers undo delete' })
        },
        redo: async () => {
          const targetId = restoredSupplierId || Number(snapshot.id || 0)
          if (!targetId) return
          await runSupplierMutation(() => getSupplierApi().deleteSupplier(targetId), 'Redo supplier delete')
          await load({ silent: true, label: 'Suppliers redo delete' })
        },
      })
      notify(t('supplier_deleted') || 'Deleted')
      setModal(null)
      setSelected(null)
      await load({ silent: true, label: 'Suppliers after delete' })
    } catch (error: unknown) {
      notify(getErrorMessage(error, 'Failed'), 'error')
    } finally {
      finishSingleAction(deleteInFlightRef)
    }
  }

  const handleBulkDelete = async () => {
    if (!selectedIds.size || !beginSingleAction(bulkDeleteInFlightRef, { blocked: bulkActionBusy })) return
    if (!confirm(`Delete ${selectedIds.size} supplier(s)?`)) {
      finishSingleAction(bulkDeleteInFlightRef)
      return
    }
    const ids = [...selectedIds]
    const snapshots = buildSelectedSnapshots(suppliers, ids)
    const failedIds: number[] = []
    setBulkActionBusy(true)
    try {
      const deleteRun = await runConcurrentTasks(ids, async (id: number) => {
        await runSupplierMutation(() => getSupplierApi().deleteSupplier(id), 'Bulk delete suppliers')
        return Number(id)
      })
      const deletedCount = deleteRun.successes.length
      failedIds.push(...deleteRun.failures.map((entry) => Number(entry.item)).filter((id) => Number.isFinite(id)))
      setSelectedIds(new Set(failedIds))
      await load({ silent: true, label: 'Suppliers refresh after delete' })
      const failedIdSet = new Set(failedIds)
      const deletedSnapshots = snapshots.filter((snapshot) => !failedIdSet.has(Number(snapshot?.id || 0)))
      if (deletedCount > 0 && deletedSnapshots.length) {
        let restoredEntries: Array<{ restoredId: number }> = []
        actionHistory.pushAction({
          label: `Delete ${deletedCount} supplier${deletedCount === 1 ? '' : 's'}`,
          undo: async () => {
            const restoreRun = await runConcurrentTasks(deletedSnapshots, async (snapshot: SupplierRow) => {
              const result = await runSupplierMutation(() => getSupplierApi().createSupplier({
                name: snapshot.name || '',
                phone: snapshot.phone || '',
                email: snapshot.email || '',
                company: snapshot.company || '',
                contact_person: snapshot.contact_person || '',
                address: snapshot.address || '',
                notes: snapshot.notes || '',
                userId: user?.id,
                userName: user?.name,
              }), 'Restore deleted suppliers')
              return { restoredId: Number(result?.id || result?.data?.id || 0) }
            })
            if (restoreRun.failures.length) throw (restoreRun.failures[0]?.error || new Error('Failed to restore supplier'))
            restoredEntries = restoreRun.successes.map((entry) => entry.value as { restoredId: number })
            await load({ silent: true, label: 'Suppliers restore deleted' })
          },
          redo: async () => {
            const idsToDelete = restoredEntries.map((entry) => Number(entry.restoredId || 0)).filter((id) => id > 0)
            const redoRun = await runConcurrentTasks(idsToDelete, async (id: number) => (
              runSupplierMutation(() => getSupplierApi().deleteSupplier(id), 'Redo bulk supplier delete')
            ))
            if (redoRun.failures.length) throw (redoRun.failures[0]?.error || new Error('Failed to re-delete supplier'))
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
      finishSingleAction(bulkDeleteInFlightRef)
      setBulkActionBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ActionHistoryBar history={actionHistory as unknown as ActionHistoryBarHistory} />
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex flex-1 min-w-0 items-center gap-2">
          <input
            id="supplier-search"
            name="supplier_search"
            autoComplete="off"
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
              setGroupMode('time')
            }}
            compact
          />
          <button className="btn-secondary inline-flex items-center gap-1.5 whitespace-nowrap text-sm" onClick={() => setModal('import')} title={tr('import_contacts', 'Import', 'នាំចូល')}>
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">{tr('import_contacts', 'Import', 'នាំចូល')}</span>
          </button>
          <button
            className="btn-secondary inline-flex items-center gap-1.5 whitespace-nowrap text-sm"
            onClick={async () => {
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
              const { downloadCSV } = await loadCsvUtilsModule()
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
        totalCount={visibleSuppliers.length}
        onRetry={() => load({ silent: false, label: 'Suppliers retry' })}
        loadingLabel={tr('loading_suppliers', 'Loading suppliers...')}
        loadingDetails={tr('contacts_loading_details', 'Fetching suppliers, filters, and grouped sections.')}
        t={t}
        renderRow={(row) => {
          if (isSectionRow(row)) {
            const section = row.section
            return (
            <tr key={section.id} className="bg-slate-100/90 dark:bg-slate-800/80">
              <td colSpan={supplierColumns.length + 2} className="px-4 py-2">
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
                      {row.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      {row.collapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                    </button>
                  </div>
                </div>
              </td>
            </tr>
            )
          }
          const supplier = row as SupplierRow
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
          <tr key={supplier.id} className={`table-row cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 ${selectedIds.has(Number(supplier.id)) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
            <td className="w-10 px-3 py-2" onClick={(event) => event.stopPropagation()}>
              <label htmlFor={`supplier-select-${supplier.id}`} className="sr-only">{`Select ${supplier.name}`}</label>
              <input id={`supplier-select-${supplier.id}`} name={`supplier_select_${supplier.id}`} type="checkbox" className="h-4 w-4 cursor-pointer rounded" checked={selectedIds.has(Number(supplier.id))} onChange={() => toggleOne(supplier.id)} />
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
        }}
        renderCard={(row) => {
          if (isSectionRow(row)) {
            const section = row.section
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
                    {row.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
            )
          }
          const supplier = row as SupplierRow
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
          <div key={supplier.id} className={`card flex items-center gap-3 p-3 ${selectedIds.has(Number(supplier.id)) ? 'bg-blue-50 ring-2 ring-blue-400 dark:bg-blue-900/20' : ''}`}>
            <div className="flex-shrink-0" onClick={(event) => { event.stopPropagation(); toggleOne(supplier.id) }}>
              <label htmlFor={`supplier-card-select-${supplier.id}`} className="sr-only">{`Select ${supplier.name}`}</label>
              <input id={`supplier-card-select-${supplier.id}`} name={`supplier_card_select_${supplier.id}`} type="checkbox" className="h-5 w-5 cursor-pointer rounded" checked={selectedIds.has(Number(supplier.id))} onChange={() => toggleOne(supplier.id)} />
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
        }}
      />

      {modal === 'form' ? <SupplierForm supplier={selected} onSave={handleSave} onClose={() => { setModal(null); setSelected(null) }} t={t} /> : null}
      {modal === 'import' ? (
        <Suspense fallback={null}>
          <ContactImportModal type="supplier" onClose={() => setModal(null)} onDone={() => load({ silent: true, label: 'Suppliers after import' })} />
        </Suspense>
      ) : null}
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
