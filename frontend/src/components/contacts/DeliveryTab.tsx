// ?€?€ DeliveryTab ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentProps } from 'react'
import { ChevronDown, ChevronRight, Download, Plus, Upload } from 'lucide-react'
import { useApp as useAppHook, useSync as useSyncHook } from '../../AppContext.jsx'
import { downloadCSV } from '../../utils/csv'
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
const DELIVERY_CONTACT_MUTATION_TIMEOUT_MS = 12000

type TranslateFn = (key: string) => string | undefined
type NotifyFn = (message: string, tone?: string) => void
type DeliveryModal = 'form' | 'import' | 'detail' | null
type SortDirection = 'asc' | 'desc'
type DeliveryGroupMode = 'time' | 'alphabet'

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

interface DeliveryTabProps {
  t: TranslateFn
  notify: NotifyFn
  active?: boolean
}

interface DeliveryContact extends Record<string, unknown> {
  id: number | string
  name?: string | null
  phone?: string | null
  area?: string | null
  address?: string | null
  notes?: string | null
  created_at?: string | null
}

interface DeliveryPayload {
  name?: string | null
  phone?: string | null
  area?: string | null
  address?: string | null
  notes?: string | null
  userId?: string | number | null
  userName?: string | null
}

interface DeliveryMutationResult {
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
    items: DeliveryContact[]
  }
  collapsed: boolean
}

type DeliveryDisplayRow = DeliveryContact | SectionRow

interface DeliveryApi {
  getDeliveryContacts: (query?: Record<string, unknown>) => Promise<unknown>
  createDeliveryContact: (payload: DeliveryPayload) => Promise<DeliveryMutationResult | unknown>
  updateDeliveryContact: (id: number | string, payload: DeliveryPayload) => Promise<DeliveryMutationResult | unknown>
  deleteDeliveryContact: (id: number | string) => Promise<DeliveryMutationResult | unknown>
}

type ActionHistoryBarHistory = ComponentProps<typeof ActionHistoryBar>['history']

const useApp = useAppHook as () => AppContextValue
const useSync = useSyncHook as () => SyncContextValue

function getDeliveryApi(): DeliveryApi {
  if (typeof window === 'undefined' || !window.api) throw new Error('Delivery contact API is not available.')
  return window.api as DeliveryApi
}

function normalizeDeliveryRows(value: unknown): DeliveryContact[] {
  if (Array.isArray(value)) return value as DeliveryContact[]
  if (value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: DeliveryContact[] }).items
  }
  return []
}

function isSectionRow(row: DeliveryDisplayRow | null | undefined): row is SectionRow {
  return row?.__kind === 'section'
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

// ?€?€ Options helpers ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
// Options stored as JSON array in the 'address' TEXT column.
// Each option: { label, name, phone, area }
// Backward-compatible: old plain strings migrated to a single option.

export function parseDeliveryOptions(raw: unknown): ContactOption[] {
  return parseStoredContactOptions(raw, { legacyField: 'area' })
}

export function serializeDeliveryOptions(opts: ContactOption[]): string {
  return serializeContactOptions(opts) || ''
}

const BLANK_OPTION = () => createContactOption({ label: '', name: '', phone: '', area: '' })

// ?€?€ OptionEditor ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
interface OptionEditorProps {
  option: ContactOption
  index: number
  total: number
  onChange: (option: ContactOption) => void
  onRemove: () => void
}

function OptionEditor({ option, index, total, onChange, onRemove }: OptionEditorProps) {
  const set = (key: keyof ContactOption, value: string) => onChange({ ...option, [key]: value })
  const fieldId = (field: string) => `delivery-option-${index}-${field}`
  return (
    <div className="border border-gray-200 dark:border-zinc-600 rounded-xl p-3 space-y-2 bg-gray-50 dark:bg-zinc-800/60">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-gray-400 w-5 flex-shrink-0">#{index + 1}</span>
        <label htmlFor={fieldId('label')} className="sr-only">Delivery option label</label>
        <input
          id={fieldId('label')}
          name={fieldId('label')}
          autoComplete="off"
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
          <input id={fieldId('name')} name={fieldId('name')} autoComplete="name" className="input text-xs py-1" placeholder="Driver / rider name" value={option.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div>
          <label htmlFor={fieldId('phone')} className="block text-xs text-gray-400 mb-0.5">Phone</label>
          <input id={fieldId('phone')} name={fieldId('phone')} autoComplete="tel" className="input text-xs py-1" placeholder="Phone number" value={option.phone} onChange={e => set('phone', e.target.value)} />
        </div>
      </div>
      <div>
        <label htmlFor={fieldId('area')} className="block text-xs text-gray-400 mb-0.5">Area / Zone</label>
        <input id={fieldId('area')} name={fieldId('area')} autoComplete="off" className="input text-xs py-1" placeholder="Coverage area or zone" value={option.area} onChange={e => set('area', e.target.value)} />
      </div>
    </div>
  )
}

// ?€?€ DeliveryForm ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
interface DeliveryFormProps {
  contact?: DeliveryContact | null
  onSave: (payload: DeliveryPayload) => Promise<unknown> | unknown
  onClose: () => void
  t: TranslateFn
}

function DeliveryForm({ contact, onSave, onClose, t }: DeliveryFormProps) {
  const init: DeliveryPayload = contact ? { ...contact } : { name: '', phone: '', area: '', address: '', notes: '' }
  const [form, setForm] = useState<DeliveryPayload>(init)
  const [options, setOptions] = useState(() => {
    const parsed = parseDeliveryOptions(init.address)
    if (parsed.length) return parsed
    return [BLANK_OPTION()]
  })
  const [saving, setSaving] = useState(false)
  const set = (key: keyof DeliveryPayload, value: string) => setForm((current) => ({ ...current, [key]: value }))
  const addOption = () => setOptions((current) => {
    if (current.length >= CONTACT_OPTION_LIMIT) return current
    return [...current, BLANK_OPTION()]
  })
  const updateOption = (index: number, nextOption: ContactOption) => setOptions((current) => current.map((option, itemIndex) => (itemIndex === index ? nextOption : option)))
  const removeOption = (index: number) => setOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))
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
          <input id="delivery-form-name" name="delivery_name" autoComplete="name" className="input" value={form.name || ''} onChange={e => set('name', e.target.value)} autoFocus placeholder="Driver name" />
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
          <textarea id="delivery-form-notes" name="delivery_notes" autoComplete="off" className="input resize-none" rows={2} value={form.notes||''} onChange={e => set('notes', e.target.value)} />
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

// ?€?€ OptionsDisplay (detail view) ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
function OptionsDisplay({ raw }: { raw: unknown }) {
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

function OptionsBadge({ raw }: { raw: unknown }) {
  const count = parseDeliveryOptions(raw).length
  if (!count) return null
  return (
    <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
      {count}
    </span>
  )
}

// ?€?€ DeliveryTab ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
function DeliveryTab({ t, notify, active = true }: DeliveryTabProps) {
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
  const [contacts, setContacts] = useState<DeliveryContact[]>([])
  const [search,   setSearch]   = useState('')
  const [modal,    setModal]    = useState<DeliveryModal>(null)
  const [selected, setSelected] = useState<DeliveryContact | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [loadError, setLoadError] = useState('')
  const [bulkActionBusy, setBulkActionBusy] = useState(false)
  const [yearFilter, setYearFilter] = useState('all')
  const [monthFilter, setMonthFilter] = useState('all')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [groupMode, setGroupMode] = useState<DeliveryGroupMode>('time')
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set())
  const deferredSearch = useDeferredValue(search)
  const syncChannelName = String(syncChannel?.channel || '')
  const syncChannelTs = Number(syncChannel?.ts || 0)
  const actionHistory = useActionHistory({ limit: 3, notify })
  const deliveryQuery = useMemo(() => ({
    search: deferredSearch.trim() || undefined,
    year: yearFilter !== 'all' ? yearFilter : undefined,
    month: yearFilter !== 'all' && monthFilter !== 'all' ? monthFilter : undefined,
  }), [deferredSearch, monthFilter, yearFilter])

  const filteredBySearch = useMemo(() => contacts.filter((contact) => {
    const query = deferredSearch.toLowerCase().trim()
    if (!query) return true
    return (
      String(contact.name || '').toLowerCase().includes(query) ||
      String(contact.phone || '').includes(query) ||
      String(contact.area || '').toLowerCase().includes(query)
    )
  }), [contacts, deferredSearch])

  const timeMode = useMemo(() => getTimeGroupingMode(yearFilter, monthFilter), [monthFilter, yearFilter])
  const availableYears = useMemo(() => getAvailableYears(filteredBySearch, (contact) => contact?.created_at), [filteredBySearch])
  const filteredSections = useMemo(() => (
    groupMode === 'alphabet'
      ? buildAlphabetActionSections(filteredBySearch, {
        getName: (contact) => contact?.name,
        getItemId: (contact) => Number(contact?.id),
        sortDirection: 'asc',
      })
      : buildTimeActionSections(filteredBySearch, {
        getDate: (contact) => contact?.created_at,
        getItemId: (contact) => Number(contact?.id),
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
  const visibleContacts = useMemo(
    () => filteredSections.flatMap((section) => section.items),
    [filteredSections],
  )
  const displayRows = useMemo<DeliveryDisplayRow[]>(
    () => filteredSections.flatMap((section) => {
      const collapsed = collapsedSections.has(section.id)
      return [
        { __kind: 'section', section, collapsed },
        ...(!collapsed ? section.items : []),
      ] as DeliveryDisplayRow[]
    }),
    [collapsedSections, filteredSections],
  )

  const { selectedIds, setSelectedIds, toggleOne, selectAllProp } = useContactSelection(visibleContacts)
  const deliveryColumns = [t('name') || 'Name', t('phone') || 'Phone', t('area_zone')||'Area / Zone']
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

  const buildDeliveryPayload = useCallback((contact: Partial<DeliveryContact> = {}): DeliveryPayload => ({
    name: contact.name || '',
    phone: contact.phone || '',
    area: contact.area || '',
    address: contact.address || '',
    notes: contact.notes || '',
    userId: user?.id,
    userName: user?.name,
  }), [user?.id, user?.name])

  const runDeliveryMutation = useCallback(async (loader: () => unknown | Promise<unknown>, label: string): Promise<DeliveryMutationResult> => (
    await withLoaderTimeout(loader, label, DELIVERY_CONTACT_MUTATION_TIMEOUT_MS) as DeliveryMutationResult
  ), [])

  const clearLoadWatchdog = useCallback(() => {
    if (loadWatchdogRef.current != null) {
      window.clearTimeout(loadWatchdogRef.current)
      loadWatchdogRef.current = null
    }
  }, [])

  const load = useCallback(async ({ silent = false, label = 'Delivery contacts' }: { silent?: boolean, label?: string } = {}): Promise<void> => {
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
          setLoadError(tr('delivery_contacts_load_slow', 'Delivery contacts are taking longer than expected. Tap Retry or revisit the page in a moment.'))
        }, 15000)
      }
      try {
        const data = await withLoaderTimeout(() => getDeliveryApi().getDeliveryContacts(deliveryQuery), label, 20000)
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        setContacts(normalizeDeliveryRows(data))
        loadedOnceRef.current = true
        setLoadError('')
      } catch (error: unknown) {
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        const message = getErrorMessage(error, 'Failed to load delivery contacts')
        if (!loadedOnceRef.current) {
          setLoadError(message)
          notify(message, 'error')
        } else {
          const refreshMessage = tr('delivery_contacts_refresh_failed', 'Unable to refresh delivery contacts right now. Showing the latest loaded data.')
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
  }, [clearLoadWatchdog, deliveryQuery, notify, tr])
  useEffect(() => {
    if (!active) {
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
    if (!active || syncChannelName !== 'deliveryContacts') return
    load({ silent: true, label: 'Delivery contacts refresh' })
  }, [active, load, syncChannelName, syncChannelTs])

  const handleSave = async (form: DeliveryPayload) => {
    if (!beginSingleAction(saveInFlightRef)) return
    if (!String(form.name || '').trim() && !String(form.phone || '').trim()) {
      finishSingleAction(saveInFlightRef)
      return notify('Driver name or phone is required', 'error')
    }
    try {
      const existingSnapshot = selected ? cloneHistorySnapshot(selected) : null
      const payload = { ...form, userId: user?.id, userName: user?.name }
      const res = selected
        ? await runDeliveryMutation(() => getDeliveryApi().updateDeliveryContact(selected.id, payload), 'Update delivery contact')
        : await runDeliveryMutation(() => getDeliveryApi().createDeliveryContact(payload), 'Create delivery contact')
      if (res?.success === false) { notify(res.error||'Failed', 'error'); return }
      if (selected && existingSnapshot) {
        const nextSnapshot = cloneHistorySnapshot({ ...existingSnapshot, ...payload, id: selected.id })
        actionHistory.pushAction({
          label: `Edit delivery contact ${existingSnapshot.name || nextSnapshot.name || ''}`.trim(),
          undo: async () => {
            const restoreResult = await runDeliveryMutation(
              () => getDeliveryApi().updateDeliveryContact(existingSnapshot.id, buildDeliveryPayload(existingSnapshot)),
              'Undo delivery contact edit',
            )
            if (restoreResult?.success === false) throw new Error(restoreResult.error || 'Failed to restore delivery contact')
            await load({ silent: true, label: 'Delivery contacts undo edit' })
          },
          redo: async () => {
            const redoResult = await runDeliveryMutation(
              () => getDeliveryApi().updateDeliveryContact(nextSnapshot.id, buildDeliveryPayload(nextSnapshot)),
              'Redo delivery contact edit',
            )
            if (redoResult?.success === false) throw new Error(redoResult.error || 'Failed to reapply delivery contact changes')
            await load({ silent: true, label: 'Delivery contacts redo edit' })
          },
        })
      } else {
        let createdContactId = extractHistoryResultId(res)
        const createdSnapshot = cloneHistorySnapshot({ ...payload, id: createdContactId })
        if (createdContactId > 0) {
          actionHistory.pushAction({
            label: `Add delivery contact ${createdSnapshot.name || ''}`.trim(),
            undo: async () => {
              await runDeliveryMutation(() => getDeliveryApi().deleteDeliveryContact(createdContactId), 'Undo delivery contact create')
              await load({ silent: true, label: 'Delivery contacts undo create' })
            },
            redo: async () => {
              const recreateResult = await runDeliveryMutation(
                () => getDeliveryApi().createDeliveryContact(buildDeliveryPayload(createdSnapshot)),
                'Redo delivery contact create',
              )
              if (recreateResult?.success === false) throw new Error(recreateResult.error || 'Failed to recreate delivery contact')
              createdContactId = extractHistoryResultId(recreateResult)
              await load({ silent: true, label: 'Delivery contacts redo create' })
            },
          })
        }
      }
      notify(selected ? (t('delivery_contact_updated')||'Updated') : (t('delivery_contact_added')||'Added'))
      setModal(null); setSelected(null); await load({ silent: true, label: 'Delivery contacts after save' })
    } catch (error: unknown) { notify(getErrorMessage(error, 'Failed'), 'error') }
    finally { finishSingleAction(saveInFlightRef) }
  }

  const handleDelete = async (c: DeliveryContact) => {
    if (!beginSingleAction(deleteInFlightRef)) return
    if (!confirm(`Delete "${c.name}"?`)) {
      finishSingleAction(deleteInFlightRef)
      return
    }
    try {
      const snapshot = cloneHistorySnapshot(c)
      await runDeliveryMutation(() => getDeliveryApi().deleteDeliveryContact(c.id), 'Delete delivery contact')
      let restoredContactId = 0
      actionHistory.pushAction({
        label: `Delete delivery contact ${snapshot.name || ''}`.trim(),
        undo: async () => {
          const restoreResult = await runDeliveryMutation(
            () => getDeliveryApi().createDeliveryContact(buildDeliveryPayload(snapshot)),
            'Undo delivery contact delete',
          )
          if (restoreResult?.success === false) throw new Error(restoreResult.error || 'Failed to restore delivery contact')
          restoredContactId = extractHistoryResultId(restoreResult)
          await load({ silent: true, label: 'Delivery contacts undo delete' })
        },
        redo: async () => {
          const targetId = restoredContactId || Number(snapshot.id || 0)
          if (!targetId) return
          await runDeliveryMutation(() => getDeliveryApi().deleteDeliveryContact(targetId), 'Redo delivery contact delete')
          await load({ silent: true, label: 'Delivery contacts redo delete' })
        },
      })
      notify(t('delivery_contact_deleted')||'Deleted')
      setModal(null)
      setSelected(null)
      await load({ silent: true, label: 'Delivery contacts after delete' })
    }
    catch (error: unknown) { notify(getErrorMessage(error, 'Failed'), 'error') }
    finally { finishSingleAction(deleteInFlightRef) }
  }

  const handleBulkDelete = async () => {
    if (!selectedIds.size || !beginSingleAction(bulkDeleteInFlightRef, { blocked: bulkActionBusy })) return
    if (!confirm(`Delete ${selectedIds.size} delivery contact(s)?`)) {
      finishSingleAction(bulkDeleteInFlightRef)
      return
    }
    const ids = [...selectedIds]
    const snapshots = buildSelectedSnapshots(contacts, ids)
    const failedIds: number[] = []
    setBulkActionBusy(true)
    try {
      const deleteRun = await runConcurrentTasks(ids, async (id: number) => {
        await runDeliveryMutation(() => getDeliveryApi().deleteDeliveryContact(id), 'Bulk delete delivery contacts')
        return Number(id)
      })
      const deletedCount = deleteRun.successes.length
      failedIds.push(...deleteRun.failures.map((entry) => Number(entry.item)).filter((id) => Number.isFinite(id)))
      setSelectedIds(new Set(failedIds))
      await load({ silent: true, label: 'Delivery contacts refresh after delete' })
      const failedIdSet = new Set(failedIds)
      const deletedSnapshots = snapshots.filter((snapshot) => !failedIdSet.has(Number(snapshot?.id || 0)))
      if (deletedCount > 0 && deletedSnapshots.length) {
        let restoredEntries: Array<{ restoredId: number }> = []
        actionHistory.pushAction({
          label: `Delete ${deletedCount} delivery contact${deletedCount === 1 ? '' : 's'}`,
          undo: async () => {
            const restoreRun = await runConcurrentTasks(deletedSnapshots, async (snapshot: DeliveryContact) => {
              const result = await runDeliveryMutation(() => getDeliveryApi().createDeliveryContact({
                name: snapshot.name || '',
                phone: snapshot.phone || '',
                area: snapshot.area || '',
                address: snapshot.address || '',
                notes: snapshot.notes || '',
                userId: user?.id,
                userName: user?.name,
              }), 'Restore deleted delivery contacts')
              return { restoredId: Number(result?.id || result?.data?.id || 0) }
            })
            if (restoreRun.failures.length) throw (restoreRun.failures[0]?.error || new Error('Failed to restore delivery contact'))
            restoredEntries = restoreRun.successes.map((entry) => entry.value as { restoredId: number })
            await load({ silent: true, label: 'Delivery contacts restore deleted' })
          },
          redo: async () => {
            const idsToDelete = restoredEntries.map((entry) => Number(entry.restoredId || 0)).filter((id) => id > 0)
            const redoRun = await runConcurrentTasks(idsToDelete, async (id: number) => (
              runDeliveryMutation(() => getDeliveryApi().deleteDeliveryContact(id), 'Redo bulk delivery contact delete')
            ))
            if (redoRun.failures.length) throw (redoRun.failures[0]?.error || new Error('Failed to re-delete delivery contact'))
            await load({ silent: true, label: 'Delivery contacts redo delete' })
          },
        })
      }
      if (failedIds.length) {
        notify(`Deleted ${deletedCount} delivery contact(s), ${failedIds.length} failed`, 'warning')
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
        <div className="flex gap-2 items-center flex-1 min-w-0">
          <label htmlFor="delivery-search" className="sr-only">{t('search_delivery_placeholder')||'Search delivery contacts'}</label>
          <input id="delivery-search" name="delivery_search" autoComplete="off" className="input flex-1 min-w-0 max-w-xs"
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
              setGroupMode('time')
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
        totalCount={visibleContacts.length}
        onRetry={() => load({ silent: false, label: 'Delivery contacts retry' })}
        loadingLabel={tr('loading_delivery_contacts', 'Loading delivery contacts...')}
        loadingDetails={tr('contacts_loading_details', 'Fetching delivery contacts, filters, and grouped sections.')}
        t={t}
        renderRow={(row) => {
          if (isSectionRow(row)) {
            const section = row.section
            return (
            <tr key={section.id} className="bg-slate-100/90 dark:bg-slate-800/80">
              <td colSpan={deliveryColumns.length + 2} className="px-4 py-2">
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
          const contact = row as DeliveryContact
          const options = parseDeliveryOptions(contact.address)
          const primaryOption = getPrimaryContactOption(options, {
            fallback: { name: contact.name || '', phone: contact.phone || '', area: contact.area || '' },
          })
          return (
          <tr key={contact.id} className={`table-row cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 ${selectedIds.has(Number(contact.id)) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
            <td className="px-3 py-2 w-10" onClick={e => e.stopPropagation()}>
              <label htmlFor={`delivery-select-${contact.id}`} className="sr-only">{`Select ${contact.name}`}</label>
              <input id={`delivery-select-${contact.id}`} name={`delivery_select_${contact.id}`} type="checkbox" className="w-4 h-4 cursor-pointer rounded" checked={selectedIds.has(Number(contact.id))} onChange={() => toggleOne(contact.id)} />
            </td>
            <td className="px-4 py-2 font-medium text-gray-900 dark:text-white cursor-pointer" onClick={() => { setSelected(contact); setModal('detail') }}>{contact.name}</td>
            <td className="px-4 py-2 text-gray-500 cursor-pointer" onClick={() => { setSelected(contact); setModal('detail') }}>{primaryOption.phone || contact.phone || '-'}</td>
            <td className="px-4 py-2 text-gray-500 cursor-pointer" onClick={() => { setSelected(contact); setModal('detail') }}>{primaryOption.area || contact.area || '-'}</td>
            <td className="px-2 py-2 text-right" onClick={e => e.stopPropagation()}>
              <ThreeDotMenu onDetails={() => { setSelected(contact); setModal('detail') }} onEdit={() => { setSelected(contact); setModal('form') }} onDelete={() => handleDelete(contact)} />
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
          const contact = row as DeliveryContact
          const options = parseDeliveryOptions(contact.address)
          const primaryOption = getPrimaryContactOption(options, {
            fallback: { name: contact.name || '', phone: contact.phone || '', area: contact.area || '' },
          })
          return (
          <div key={contact.id} className={`card p-3 flex items-center gap-3 ${selectedIds.has(Number(contact.id)) ? 'ring-2 ring-blue-400 bg-blue-50 dark:bg-blue-900/20' : ''}`}>
            <div className="flex-shrink-0" onClick={e => { e.stopPropagation(); toggleOne(contact.id) }}>
              <label htmlFor={`delivery-card-select-${contact.id}`} className="sr-only">{`Select ${contact.name}`}</label>
              <input id={`delivery-card-select-${contact.id}`} name={`delivery_card_select_${contact.id}`} type="checkbox" className="w-5 h-5 cursor-pointer rounded" checked={selectedIds.has(Number(contact.id))} onChange={() => toggleOne(contact.id)} />
            </div>
            <div className="w-9 h-9 bg-green-100 dark:bg-green-900/40 rounded-full flex items-center justify-center text-green-600 font-bold text-sm flex-shrink-0">
              {contact.name?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { setSelected(contact); setModal('detail') }}>
              <div className="font-semibold text-gray-900 dark:text-white text-sm truncate flex items-center gap-1">
                {contact.name}
              </div>
              {primaryOption.phone || contact.phone ? <div className="text-xs text-gray-500">{primaryOption.phone || contact.phone}</div> : null}
              {primaryOption.area || contact.area ? <div className="text-xs text-gray-400 truncate">{primaryOption.area || contact.area}</div> : null}
              {options.length ? <div className="mt-0.5 text-xs text-blue-500">{options.length} contact option{options.length !== 1 ? 's' : ''}</div> : null}
            </div>
            <div onClick={e => e.stopPropagation()}>
              <ThreeDotMenu onDetails={() => { setSelected(contact); setModal('detail') }} onEdit={() => { setSelected(contact); setModal('form') }} onDelete={() => handleDelete(contact)} />
            </div>
          </div>
          )
        }}
      />

      {modal === 'form'   && <DeliveryForm contact={selected} onSave={handleSave} onClose={() => { setModal(null); setSelected(null) }} t={t} />}
      {modal === 'import' ? (
        <Suspense fallback={null}>
          <ContactImportModal type="deliveryContact" onClose={() => setModal(null)} onDone={() => load({ silent: true, label: 'Delivery contacts after import' })} />
        </Suspense>
      ) : null}
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
