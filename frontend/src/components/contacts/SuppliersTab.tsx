import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import RenameCascadeModal, { type RenameCascadeChoice, type RenameCascadeRequest } from '../shared/RenameCascadeModal.tsx'
import { getRenameImpact } from '../../api/renameCascadeTransport.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { consumeLongPressClick, createLongPressHandlers } from '../../utils/longPress.ts'
import { columnsFromRows } from '../../utils/exportOptions.ts'
import type { ComponentProps } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Settings2 from 'lucide-react/dist/esm/icons/settings-2.js'
import Phone from 'lucide-react/dist/esm/icons/phone.js'
import { useApp as useAppHook, useSync as useSyncHook } from '../../AppContext.tsx'
import type { QueryParams } from '../../api/query.ts'
import { fmtDateTime24 } from '../../utils/formatters'
import Modal from '../shared/Modal'
import AppSelect from '../shared/AppSelect.tsx'
import FilterMenu from '../shared/FilterMenu'
import SearchInput from '../shared/SearchInput'
import ActionHistoryBar from '../shared/ActionHistoryBar'
import LazyPortalMenu from '../shared/LazyPortalMenu'
import type { PortalMenuItem } from '../shared/PortalMenu'
import SectionCard from '../shared/SectionCard'
import { ThreeDotMenu, DetailModal, ContactTable, buildSelectedSnapshots, countActiveFlags, useContactSelection } from './shared'
import { useContactDuplicateFlag } from './useContactDuplicateFlag'
import DuplicateFlagBanner from './DuplicateFlagBanner'
import { withLoaderTimeout } from '../../utils/loaders.ts'
import { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent } from '../../utils/loaders.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { buildAlphabetActionSections, buildTimeActionSections, getAvailableYears, getTimeGroupingMode } from '../../utils/groupedRecords.ts'
import { buildPeriodFilterOptions } from '../../utils/periodFilterOptions.ts'
import { useActionHistory } from '../../utils/actionHistory.ts'
import { cloneHistorySnapshot, extractHistoryResultId } from '../../utils/historyHelpers.ts'
import { runConcurrentTasks } from '../../utils/bulkOps.ts'
import { fuzzyTextMatches } from '../../utils/searchMatch.ts'
import { useDebouncedValue } from '../../utils/useDebouncedValue.ts'
import {
  CONTACT_OPTION_LIMIT,
  buildContactOptionSummary,
  createContactOption,
  getPrimaryContactOption,
  parseStoredContactOptions,
  serializeContactOptions,
} from './contactOptionUtils'
import type { ContactOption } from './contactOptionUtils'

const ContactImportModal = lazyRetry(() => import('./ContactImportModal'), 'suppliers-contact-import')
const SupplierPurchasesModal = lazyRetry(() => import('./SupplierPurchasesModal'), 'suppliers-purchases-modal')
const StockInInvoicesSection = lazyRetry(() => import('./StockInInvoicesSection'), 'suppliers-stock-in-report')
const ExportOptionsDialog = lazyRetry(() => import('../shared/ExportOptionsDialog'), 'suppliers-export-options')
const SUPPLIER_MUTATION_TIMEOUT_MS = 12000

type TranslateFn = (key: string) => string | undefined
type NotifyFn = (message: string, tone?: string) => void
type ContactModal = 'form' | 'import' | 'detail' | 'purchases' | null
type SortDirection = 'asc' | 'desc'
type SupplierGroupMode = 'time' | 'alphabet'

interface AppUser {
  id?: string | number | null
  name?: string | null
}

interface AppContextValue {
  // Per-action gate (utils/permissionActions.ts) -- the same table the
  // admin permission editor renders, so a control's visibility here always
  // matches what an admin was shown when granting the tier.
  can: (permissionKey: string, actionKey: string) => boolean
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
  // See CustomersTab.tsx's identical prop for why this exists.
  initialSearch?: string
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
  gender?: string | null
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
  gender?: string | null
  userId?: string | number | null
  userName?: string | null
  confirmDuplicate?: boolean
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

let contactReadTransportModulePromise: Promise<ContactReadTransportModule> | null = null
let contactWriteTransportModulePromise: Promise<ContactWriteTransportModule> | null = null

function loadContactReadTransportModule(): Promise<ContactReadTransportModule> {
  if (!contactReadTransportModulePromise) contactReadTransportModulePromise = import('../../api/contactReadTransport.ts')
  return contactReadTransportModulePromise
}

function loadContactWriteTransportModule(): Promise<ContactWriteTransportModule> {
  if (!contactWriteTransportModulePromise) contactWriteTransportModulePromise = import('../../api/contactWriteTransport.ts')
  return contactWriteTransportModulePromise
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
    : { name: '', phone: '', email: '', company: '', contact_person: '', address: '', notes: '', gender: '' }
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
  const [localError, setLocalError] = useState('')
  const primaryOptionPhone = getPrimaryContactOption(options).phone || form.phone || ''
  const duplicateMatches = useContactDuplicateFlag('suppliers', form.name || '', primaryOptionPhone, supplier?.id)
  const set = (key: keyof SupplierPayload, value: string) => setForm((current) => ({ ...current, [key]: value }))
  const addOption = () => setOptions((current) => {
    if (current.length >= CONTACT_OPTION_LIMIT) return current
    return [...current, createContactOption()]
  })
  const updateOption = (index: number, nextOption: ContactOption) => setOptions((current) => current.map((option, itemIndex) => (itemIndex === index ? nextOption : option)))
  const removeOption = (index: number) => setOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))
  const handleSubmit = async () => {
    if (saving) return
    const phoneConflict = duplicateMatches.find((match) => match.severity === 'phone_conflict')
    if (phoneConflict) {
      setLocalError(`This phone number already belongs to "${phoneConflict.name}". Each phone number can only be used by one supplier.`)
      return
    }
    const exactMatch = duplicateMatches.find((match) => match.severity === 'exact_match')
    if (exactMatch && !window.confirm(`"${exactMatch.name}" already has this exact name and phone number. Create a separate supplier record anyway?`)) {
      return
    }
    setLocalError('')
    setSaving(true)
    try {
      const primaryOption = getPrimaryContactOption(options)
      await Promise.resolve(onSave({
        ...form,
        phone: primaryOption.phone || form.phone || '',
        email: primaryOption.email || form.email || '',
        address: serializeContactOptions(options) || '',
        contact_person: primaryOption.name || form.contact_person || '',
        gender: form.gender || '',
        confirmDuplicate: !!exactMatch,
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
        {/* This slot used to edit contact_person, but the label promised one
            thing and the first information a supplier needs is the phone
            (user, Aug 28) -- so the default/first field is the PRIMARY
            option's phone number. The contact person's NAME stays editable
            in the option rows below and is still derived on save. */}
        <div>
          <label htmlFor="supplier-form-phone" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('phone_number') || 'Phone Number'}</label>
          <input
            id="supplier-form-phone"
            name="supplier_phone"
            autoComplete="tel"
            className="input sm:w-1/2"
            value={options[0]?.phone || ''}
            onChange={(event) => setOptions((current) => current.map((option, itemIndex) => (itemIndex === 0 ? { ...option, phone: event.target.value } : option)))}
          />
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
          <label htmlFor="supplier-form-gender" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('gender') || 'Gender'}</label>
          <AppSelect
            id="supplier-form-gender"
            name="supplier_gender"
            value={form.gender || ''}
            onChange={(nextValue) => set('gender', nextValue)}
            ariaLabel={t('gender') || 'Gender'}
            className="w-full max-w-xs"
            buttonClassName="h-10 w-full"
            menuClassName="min-w-[10rem]"
            options={[
              { value: '', label: t('unspecified') || 'Unspecified' },
              { value: 'male', label: t('male') || 'Male' },
              { value: 'female', label: t('female') || 'Female' },
              { value: 'other', label: t('other') || 'Other' },
            ]}
          />
        </div>
        <div>
          <label htmlFor="supplier-form-notes" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('notes') || 'Notes'}</label>
          <textarea id="supplier-form-notes" name="supplier_notes" autoComplete="off" className="input resize-none" rows={2} value={form.notes || ''} onChange={(event) => set('notes', event.target.value)} />
        </div>

        {localError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
            {localError}
          </div>
        ) : null}

        <DuplicateFlagBanner matches={duplicateMatches} entityLabel="supplier" />

        {/* Sticky footer, same pattern as ProductForm.tsx/FeeForm.tsx/
            CustomerFormModal.tsx's own fix. */}
        <div className="sticky bottom-0 -mx-5 -mb-5 flex gap-3 border-t border-gray-200 bg-white px-5 pb-5 pt-4 dark:border-gray-700 dark:bg-gray-800">
          <button className="btn-primary flex-1" onClick={handleSubmit} disabled={saving}>{saving ? (t('saving') || 'Saving...') : t('save')}</button>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  )
}

function SuppliersTab({ t, notify, active = true, initialSearch }: SuppliersTabProps) {
  const { can, user } = useApp()
  // routes/contacts.ts 403s DELETE and POST /bulk-delete-jobs outright for
  // the Review Required tier rather than queueing them, so those controls
  // are withheld instead of rendered and then failing on click. Add stays
  // available (that tier may create directly) and edit stays available but
  // is narrowed server-side to the name column only -- see
  // utils/permissionActions.ts, where edit is 'limited' rather than
  // 'block'.
  const canDeleteContact = can('contacts', 'delete')
  const canBulkDeleteContacts = can('contacts', 'bulk_delete')

  const { syncChannel } = useSync()
  const loadRequestRef = useRef(0)
  const loadedOnceRef = useRef(false)
  const loadWatchdogRef = useRef<number | null>(null)
  const loadPromiseRef = useRef<Promise<void> | null>(null)
  const saveInFlightRef = useRef(false)

  // D6 rename gate: a promise the save flow awaits while the shared
  // before->after dialog asks what happens to attached rows.
  const [renameRequest, setRenameRequest] = useState<RenameCascadeRequest | null>(null)
  const renameResolveRef = useRef<((choice: RenameCascadeChoice) => void) | null>(null)
  const askRenameChoice = (request: RenameCascadeRequest) => new Promise<RenameCascadeChoice>((resolve) => {
    renameResolveRef.current = resolve
    setRenameRequest(request)
  })
  const handleRenameChoice = (choice: RenameCascadeChoice) => {
    setRenameRequest(null)
    const resolve = renameResolveRef.current
    renameResolveRef.current = null
    resolve?.(choice)
  }
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
  const appliedInitialSearchRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!initialSearch || initialSearch === appliedInitialSearchRef.current) return
    appliedInitialSearchRef.current = initialSearch
    setSearch(initialSearch)
  }, [initialSearch])
  const [modal, setModal] = useState<ContactModal>(null)
  const [selected, setSelected] = useState<SupplierRow | null>(null)
  const [loading, setLoading] = useState(true)
  // Y1: true while ANY load is in flight (incl. silent search refetches)
  // so an empty list can say Searching... instead of a false empty state.
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [bulkActionBusy, setBulkActionBusy] = useState(false)
  const [yearFilter, setYearFilter] = useState('all')
  const [monthFilter, setMonthFilter] = useState('all')
  const [genderFilter, setGenderFilter] = useState('all')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [groupMode, setGroupMode] = useState<SupplierGroupMode>('time')
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set())
  const [historyReady, setHistoryReady] = useState(false)
  // Y1: same shared 180ms debounce as the other list pages (was only
  // useDeferredValue -- every keystroke could fire its own server query).
  const deferredSearch = useDebouncedValue(search, 180)
  const syncChannelName = String(syncChannel?.channel || '')
  const syncChannelTs = Number(syncChannel?.ts || 0)
  const actionHistory = useActionHistory({ limit: 3, notify, enabled: historyReady, user })
  const supplierQuery = useMemo(() => ({
    search: deferredSearch.trim() || undefined,
    year: yearFilter !== 'all' ? yearFilter : undefined,
    month: yearFilter !== 'all' && monthFilter !== 'all' ? monthFilter : undefined,
  }), [deferredSearch, monthFilter, yearFilter])

  // Same fix as CustomersTab.tsx's own filteredBySearch (see its comment):
  // the server's suppliers_fts search (part 108) is typo/joiner/order-
  // tolerant, this literal `.includes()` chain was not, so it could hide a
  // supplier the server correctly matched. Switched to the shared
  // `fuzzyTextMatches` over a joined haystack matching suppliers_fts's own
  // column set (name, phone, email, company, contact_person).
  const filteredBySearch = useMemo(() => suppliers.filter((supplier) => (
    fuzzyTextMatches(
      [supplier.name, supplier.phone, supplier.email, supplier.company, supplier.contact_person].join(' '),
      deferredSearch,
    )
  )), [deferredSearch, suppliers])

  // Same same-page gender narrowing as CustomersTab.tsx (see its comment
  // -- no server-side gender query param on GET /suppliers).
  const filteredByGender = useMemo(
    () => (genderFilter === 'all' ? filteredBySearch : filteredBySearch.filter((supplier) => (
      genderFilter === 'unspecified' ? !supplier.gender : supplier.gender === genderFilter
    ))),
    [filteredBySearch, genderFilter],
  )

  const timeMode = useMemo(() => getTimeGroupingMode(yearFilter, monthFilter), [monthFilter, yearFilter])
  const availableYears = useMemo(
    () => getAvailableYears(filteredByGender, (supplier) => supplier?.created_at),
    [filteredByGender],
  )
  const filteredSections = useMemo(() => (
    groupMode === 'alphabet'
      ? buildAlphabetActionSections(filteredByGender, {
        getName: (supplier) => supplier?.name,
        getItemId: (supplier) => Number(supplier?.id),
        sortDirection: 'asc',
      })
      : buildTimeActionSections(filteredByGender, {
        getDate: (supplier) => supplier?.created_at,
        getItemId: (supplier) => Number(supplier?.id),
        year: yearFilter,
        month: monthFilter,
        timeMode,
        groupMode: 'time',
        sortDirection,
      })
  ), [filteredByGender, groupMode, monthFilter, sortDirection, timeMode, yearFilter])

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

  const { selectedIds, setSelectedIds, toggleOne, selectAllProp, selectionModeActive, getRowLongPressState } = useContactSelection(visibleSuppliers)
  // H1+X5 (Part 402): exports go through the shared options dialog.
  const [exportDialog, setExportDialog] = useState<{ rows: Array<Record<string, unknown>>; baseName: string } | null>(null)
  // 11.1/11.2 (B6): in select mode a cell click toggles the row; out of it
  // the cell keeps opening the detail panel (long-press enters the mode).
  const handleContactCellClick = (supplier: SupplierRow) => {
    if (selectionModeActive) {
      toggleOne(supplier.id)
      return
    }
    setSelected(supplier)
    setModal('detail')
  }
  // 'Company' dropped from the table column set per explicit user
  // direction -- still stored/editable on the record (form, detail panel,
  // XLSX export) and still searchable via the filter box, just no longer
  // its own always-visible column.
  const supplierColumns = [t('name') || 'Name', t('phone') || 'Phone', t('email') || 'Email', t('contact_person') || 'Contact', t('gender') || 'Gender', t('col_added') || 'Added']
  const contactFilterSections = useMemo(() => ([
    {
      id: 'sort',
      label: tr('sort', 'Sort'),
      searchable: true,
      options: [
        { id: 'sort-desc', label: tr('newest_first', 'Newest first'), active: sortDirection === 'desc', onClick: () => setSortDirection('desc') },
        { id: 'sort-asc', label: tr('oldest_first', 'Oldest first'), active: sortDirection === 'asc', onClick: () => setSortDirection('asc') },
        ...buildPeriodFilterOptions({
          yearFilter, setYearFilter, monthFilter, setMonthFilter, availableYears,
          allTimeLabel: tr('all_time', 'All time'),
        }),
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
      id: 'gender',
      label: tr('gender', 'Gender'),
      options: [
        { id: 'gender-all', label: tr('all', 'All'), active: genderFilter === 'all', onClick: () => setGenderFilter('all') },
        { id: 'gender-male', label: tr('male', 'Male'), active: genderFilter === 'male', onClick: () => setGenderFilter('male') },
        { id: 'gender-female', label: tr('female', 'Female'), active: genderFilter === 'female', onClick: () => setGenderFilter('female') },
        { id: 'gender-other', label: tr('other', 'Other'), active: genderFilter === 'other', onClick: () => setGenderFilter('other') },
        { id: 'gender-unspecified', label: tr('unspecified', 'Unspecified'), active: genderFilter === 'unspecified', onClick: () => setGenderFilter('unspecified') },
      ],
    },

  ]), [availableYears, genderFilter, groupMode, monthFilter, sortDirection, tr, yearFilter])
  const activeFilterCount = countActiveFlags([yearFilter !== 'all', monthFilter !== 'all', sortDirection !== 'desc', groupMode !== 'time', genderFilter !== 'all'])
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
    gender: supplier.gender || '',
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
      setRefreshing(true)
      if (!silent || !loadedOnceRef.current) {
        setLoading(true)
        setLoadError('')
        loadWatchdogRef.current = window.setTimeout(() => {
          if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
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
        setRefreshing(false)
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
      const payload: Record<string, unknown> = { ...form, userId: user?.id, userName: user?.name }
      // D6: renaming a supplier previews the products/batches carrying the
      // old free-text name and asks -- carry them to the new name, keep a
      // copy (a fresh supplier, the old keeps its rows), or cancel.
      let renameCopy = false
      const oldSupplierName = selected ? String(selected.name || '').trim() : ''
      const newSupplierName = String(form.name || '').trim()
      if (selected && oldSupplierName && oldSupplierName.toLowerCase() !== newSupplierName.toLowerCase()) {
        try {
          const impact = await getRenameImpact('supplier', oldSupplierName, newSupplierName)
          const choice = await askRenameChoice({ kind: 'supplier', from: oldSupplierName, to: newSupplierName, impact, choices: ['carry', 'copy'] })
          if (choice === 'cancel') { finishSingleAction(saveInFlightRef); return }
          if (choice === 'carry') payload.__rename_cascade = 'carry'
          if (choice === 'copy') renameCopy = true
        } catch { /* preview unavailable -- plain rename, no cascade (old behavior) */ }
      }
      const useUpdate = Boolean(selected) && !renameCopy
      const result = useUpdate
        ? await runSupplierMutation(() => getSupplierApi().updateSupplier((selected as { id: number | string }).id, payload), 'Update supplier')
        : await runSupplierMutation(() => getSupplierApi().createSupplier(payload), 'Create supplier')
      if (result?.success === false) {
        notify(result.error || 'Failed', 'error')
        return
      }
      if (useUpdate && existingSnapshot) {
        const nextSnapshot = cloneHistorySnapshot({ ...existingSnapshot, ...payload, id: (selected as { id: number | string }).id })
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
        const createdSnapshot = cloneHistorySnapshot({ ...(payload as Partial<SupplierRow>), id: createdSupplierId })
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
      // Part 157: same partial-save signal CustomersTab handles -- see
      // routes/contacts.ts's PUT handler.
      if (selected && (result as { partial?: boolean } | null)?.partial) {
        notify(t('contact_partial_update_notice') || 'Only the name was saved -- your other changes need Full Access to Contacts.', 'warning')
      } else {
        notify(selected ? (t('supplier_updated') || 'Updated') : (t('supplier_added') || 'Added'))
      }
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
      {/* Manage (Import + Export folded into one dropdown, same pattern
          Products/Delivery/Customers use) / History / Add Supplier --
          History before Manage per the ordering used on those tabs. */}
      <div className="flex min-w-0 items-stretch gap-1.5 overflow-x-auto pb-1">
        <ActionHistoryBar history={actionHistory as unknown as ActionHistoryBarHistory} t={t} className="min-w-0 flex-1" showLabel />
        <LazyPortalMenu
          align="auto"
          triggerWrapperClassName="min-w-0 flex-1"
          trigger={(
            <button
              type="button"
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-blue-400 hover:bg-blue-50/60 hover:text-blue-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-blue-500 dark:hover:bg-slate-700/80 dark:hover:text-blue-300 sm:text-sm"
              aria-haspopup="true"
              aria-label={tr('manage', 'Manage', 'គ្រប់គ្រង')}
              title={tr('manage', 'Manage', 'គ្រប់គ្រង')}
            >
              <Settings2 className="h-4 w-4 shrink-0" />
              <span className="truncate">{tr('manage', 'Manage', 'គ្រប់គ្រង')}</span>
            </button>
          )}
          items={([
            { label: tr('import_contacts', 'Import', 'នាំចូល'), onClick: () => setModal('import'), color: 'blue', icon: <Download className="h-4 w-4 shrink-0" /> },
            {
              label: tr('export', 'Export', 'នាំចេញ'),
              color: 'green',
              icon: <Upload className="h-4 w-4 shrink-0" />,
              onClick: async () => {
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
                  Gender: supplier.gender || '',
                  Notes: supplier.notes || '',
                  Created: supplier.created_at || '',
                    }
                  })(),
                }))
                // H1+X5 (Part 402): shared options dialog instead of a
                // fixed xlsx download.
                setExportDialog({ rows, baseName: 'suppliers' })
              },
            },
          ] as PortalMenuItem[])}
        />
        <button
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-blue-700 bg-blue-600 px-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 hover:border-blue-800 sm:text-sm"
          onClick={() => { setSelected(null); setModal('form') }}
          title={tr('add_supplier', 'Add Supplier', 'បន្ថែមអ្នកផ្គត់ផ្គង់')}
          aria-label={tr('add_supplier', 'Add Supplier', 'បន្ថែមអ្នកផ្គត់ផ្គង់')}
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span className="truncate">{tr('add_supplier', 'Add Supplier', 'បន្ថែមអ្នកផ្គត់ផ្គង់')}</span>
        </button>
      </div>

      {/* Search + filter pin to the top of the page's scroll container while
          scrolling -- same `sticky top-2` treatment as Products/Inventory/
          Sales/Returns/Branches/CustomersTab (Aug 11 2026 UI-polish
          request). This tab renders under Contacts.tsx's own Customers/
          Suppliers/Delivery tab bar, which is NOT sticky and scrolls away
          like the rest of that page's chrome -- only this row pins. No
          separate select-all row here: ContactTable renders its own
          selectAll control inside the table header via the `selectAll`
          prop below. */}
      <div className="sticky top-2 z-30 -mx-1 flex min-w-0 items-center gap-2 bg-gray-50/95 pb-2 pt-1 backdrop-blur dark:bg-gray-900/95 sm:mx-0">
        <div className="flex flex-1 min-w-0 items-center gap-2">
          <SearchInput
            id="supplier-search"
            name="supplier_search"
            value={search}
            onChange={setSearch}
            placeholder={t('search_suppliers_placeholder') || `${t('search') || 'Search'} suppliers`}
            className="min-w-0 max-w-xs flex-1"
          />
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
          {selectedIds.size > 0 && canBulkDeleteContacts ? (
            <button
              className="btn-secondary whitespace-nowrap text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleBulkDelete}
              disabled={bulkActionBusy}
            >
              {tr('delete_selected_count', 'Delete {count}').replace('{count}', String(selectedIds.size))}
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
              setGenderFilter('all')
            }}
            compact
            mobileIconOnly
          />
        </div>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">
          {loadError}
        </div>
      ) : null}

      {/* D1b: the Stock-In Invoice report -- purchases grouped supplier →
          received date → product lines, the old system's report rebuilt on
          batch data (supplier 0062, cost 0065, received totals 0067,
          receiving branch 0070). Lives on this tab because per-lot costs
          and supplier spend are exactly what the contacts_suppliers gate
          already scopes -- both report endpoints sit under /suppliers/* on
          the server. Folded by default; the report (its own lazy chunk)
          only loads when opened. */}
      <SectionCard
        kind="reports"
        nested
        title={tr('stock_in_invoices', 'Stock-In Invoices', 'វិក្កយបត្រស្តុកចូល')}
        subtitle={tr('stock_in_invoices_hint', 'Every lot received into stock, grouped by supplier and received date', 'គ្រប់ឡុតដែលទទួលចូលស្តុក ដាក់ជាក្រុមតាមអ្នកផ្គត់ផ្គង់ និងថ្ងៃទទួល')}
        storageKey="suppliers_stock_in_invoices"
        defaultOpen={false}
      >
        <Suspense fallback={<div className="py-6 text-center text-sm text-gray-400">{tr('loading', 'Loading...', 'កំពុងផ្ទុក...')}</div>}>
          <StockInInvoicesSection t={t} />
        </Suspense>
      </SectionCard>

      <ContactTable
        loading={loading}
        rows={displayRows}
        emptyLabel={refreshing ? (t('searching') || 'Searching...') : (t('no_suppliers') || 'No suppliers')}
        columns={supplierColumns}
        selectAll={selectAllProp}
        selectionModeActive={selectionModeActive}
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
                    {selectionModeActive ? (
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
                    ) : null}
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
          const rowLongPressState = getRowLongPressState(Number(supplier.id))
          const rowLongPress = createLongPressHandlers(rowLongPressState, {
            disabled: selectionModeActive,
            onLongPress: () => {
              if (!selectedIds.has(Number(supplier.id))) toggleOne(supplier.id)
            },
            // No onClick: plain taps keep hitting the cells' own handlers.
          })
          return (
          <tr
            key={supplier.id}
            className={`table-row cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-700/30 ${selectedIds.has(Number(supplier.id)) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
            {...(selectionModeActive ? {} : rowLongPress)}
            onClickCapture={(event) => {
              // Swallow the ghost click that follows a fired long-press.
              if (consumeLongPressClick(rowLongPressState)) {
                event.preventDefault()
                event.stopPropagation()
              }
            }}
          >
            <td className={selectionModeActive ? 'w-10 px-3 py-2' : 'w-0 px-0 py-2'} onClick={(event) => event.stopPropagation()}>
              {selectionModeActive ? (
              <>
              <label htmlFor={`supplier-select-${supplier.id}`} className="sr-only">{`Select ${supplier.name}`}</label>
              <input id={`supplier-select-${supplier.id}`} name={`supplier_select_${supplier.id}`} type="checkbox" className="h-4 w-4 cursor-pointer rounded" checked={selectedIds.has(Number(supplier.id))} onChange={() => toggleOne(supplier.id)} />
              </>
              ) : null}
            </td>
            <td className="cursor-pointer px-4 py-2 font-medium text-gray-900 dark:text-white" onClick={() => handleContactCellClick(supplier)}>{supplier.name}</td>
            <td className="cursor-pointer px-4 py-2 text-gray-500" onClick={() => handleContactCellClick(supplier)}>{primaryOption.phone || supplier.phone || '--'}</td>
            <td className="cursor-pointer px-4 py-2 text-xs text-gray-500" onClick={() => handleContactCellClick(supplier)}>{primaryOption.email || supplier.email || '--'}</td>
            <td className="cursor-pointer px-4 py-2 text-gray-500" onClick={() => handleContactCellClick(supplier)}>{primaryOption.name || supplier.contact_person || '--'}</td>
            <td className="cursor-pointer px-4 py-2 text-gray-500" onClick={() => handleContactCellClick(supplier)}>{supplier.gender ? tr(supplier.gender, supplier.gender) : tr('unspecified', 'Unspecified')}</td>
            <td className="cursor-pointer px-4 py-2 text-xs text-gray-500" onClick={() => handleContactCellClick(supplier)}>{fmtDateTime24(supplier.created_at)}</td>
            <td className="px-2 py-2 text-right" onClick={(event) => event.stopPropagation()}>
              <ThreeDotMenu onDetails={() => { setSelected(supplier); setModal('detail') }} onEdit={() => { setSelected(supplier); setModal('form') }} onDelete={canDeleteContact ? () => handleDelete(supplier) : undefined} />
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
                  {selectionModeActive ? (
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
                  ) : null}
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
          const cardLongPressState = getRowLongPressState(Number(supplier.id))
          const cardLongPress = createLongPressHandlers(cardLongPressState, {
            disabled: selectionModeActive,
            onLongPress: () => {
              if (!selectedIds.has(Number(supplier.id))) toggleOne(supplier.id)
            },
          })
          // Suppliers store their default contact as option[0] (the phone
          // column mirrors it), so the option count already includes the
          // default; fall back to the phone column for legacy rows with no
          // options JSON.
          const contactCount = options.length || ((supplier.phone || supplier.email) ? 1 : 0)
          const cardPhone = primaryOption.phone || supplier.phone || ''
          const cardEmail = primaryOption.email || supplier.email || ''
          const cardContactPerson = primaryOption.name || supplier.contact_person || ''
          const cardCompany = supplier.company || ''
          const cardMetaPrimary = [cardPhone, cardEmail].filter(Boolean).join(' · ')
          const cardMetaSecondary = [cardContactPerson, cardCompany].filter(Boolean).join(' · ')
          return (
          <div
            key={supplier.id}
            className={`card flex cursor-pointer select-none items-center gap-3 p-3 ${selectedIds.has(Number(supplier.id)) ? 'bg-blue-50 ring-2 ring-blue-400 dark:bg-blue-900/20' : ''}`}
            onClick={() => handleContactCellClick(supplier)}
            {...(selectionModeActive ? {} : cardLongPress)}
            onClickCapture={(event) => {
              if (consumeLongPressClick(cardLongPressState)) {
                event.preventDefault()
                event.stopPropagation()
              }
            }}
          >
            {selectionModeActive ? (
            <div className="flex-shrink-0" onClick={(event) => { event.stopPropagation(); toggleOne(supplier.id) }}>
              <label htmlFor={`supplier-card-select-${supplier.id}`} className="sr-only">{`Select ${supplier.name}`}</label>
              <input id={`supplier-card-select-${supplier.id}`} name={`supplier_card_select_${supplier.id}`} type="checkbox" className="h-5 w-5 cursor-pointer rounded" checked={selectedIds.has(Number(supplier.id))} onChange={() => toggleOne(supplier.id)} />
            </div>
            ) : null}
            <div className="h-9 w-9 flex-shrink-0 rounded-full bg-orange-100 text-center text-sm font-bold leading-9 text-orange-600 dark:bg-orange-900/40">
              {supplier.name?.[0]?.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">{supplier.name}</span>
                {contactCount > 0 ? (
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-600 dark:bg-orange-900/40 dark:text-orange-300" title={`${contactCount} ${tr('contact_options', 'contact options')}`}>
                    <Phone className="h-2.5 w-2.5" />{contactCount}
                  </span>
                ) : null}
              </div>
              {cardMetaPrimary ? <div className="mt-0.5 truncate text-[11px] text-gray-500">{cardMetaPrimary}</div> : null}
              {cardMetaSecondary ? <div className="truncate text-[11px] text-gray-400">{cardMetaSecondary}</div> : null}
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
              [t('contact_person') || 'Contact', primaryOption.name || selected.contact_person],
              [t('gender') || 'Gender', selected.gender ? (tr(selected.gender, selected.gender)) : (tr('unspecified', 'Unspecified'))],
              [t('address'), primaryOption.address],
              ['Contact Options', buildContactOptionSummary(options)],
              [t('notes'), selected.notes],
              [t('col_added') || t('added_on') || 'Added', fmtDateTime24(selected.created_at)],
            ]
          })()}
          onEdit={() => setModal('form')}
          onDelete={canDeleteContact ? () => handleDelete(selected) : undefined}
          onClose={() => { setModal(null); setSelected(null) }}
          t={t}
          extraButtons={[{ label: tr('supplier_purchases', 'Purchases'), onClick: () => setModal('purchases') }]}
        />
      ) : null}

      {exportDialog ? (
        <Suspense fallback={null}>
          <ExportOptionsDialog
            title={t('export_options_title') || 'Export options'}
            fileBaseName={exportDialog.baseName}
            columns={columnsFromRows(exportDialog.rows)}
            rows={exportDialog.rows}
            rememberKey="contacts-suppliers"
            t={t}
            notify={notify}
            onClose={() => setExportDialog(null)}
          />
        </Suspense>
      ) : null}
      {modal === 'purchases' && selected ? (
        <Suspense fallback={null}>
          <SupplierPurchasesModal
            supplierId={selected.id as number}
            supplierName={String(selected.name || '')}
            fetchPurchases={async (id) => (await loadContactReadTransportModule()).getSupplierPurchases(id)}
            onClose={() => setModal('detail')}
            t={t}
          />
        </Suspense>
      ) : null}
      <RenameCascadeModal request={renameRequest} busy={false} t={(key, fallback) => t(key) || fallback || key} onChoose={handleRenameChoice} />
    </div>
  )
}

export { SupplierForm, SuppliersTab }
