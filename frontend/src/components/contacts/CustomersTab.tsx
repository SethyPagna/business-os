import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { consumeLongPressClick, createLongPressHandlers } from '../../utils/longPress.ts'
import { columnsFromRows } from '../../utils/exportOptions.ts'
import type { ComponentProps, ReactNode } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Settings2 from 'lucide-react/dist/esm/icons/settings-2.js'
import Phone from 'lucide-react/dist/esm/icons/phone.js'
import LazyPortalMenu from '../shared/LazyPortalMenu'
import { DEFAULT_PAGE_SIZE } from '../shared/PaginationControls'
import type { PortalMenuItem } from '../shared/PortalMenu'
import { isBrokenLocalizedString as isBrokenLocalizedStringHook, useApp as useAppHook, useSync as useSyncHook } from '../../AppContext.tsx'
import type { QueryParams } from '../../api/query.ts'
import { fmtDateTime24 } from '../../utils/formatters'
import FilterMenu from '../shared/FilterMenu'
import SearchInput from '../shared/SearchInput'
import SortChip from '../shared/SortChip'
import { loadSortSpec, saveSortSpec, type SortField, type SortSpec } from '../../utils/listSort'
import ActionHistoryBar from '../shared/ActionHistoryBar'
import { ThreeDotMenu, DetailModal, ContactTable, buildSelectedSnapshots, countActiveFlags, useContactSelection } from './shared'
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
  serializeContactOptions as serializeStoredContactOptions,
} from './contactOptionUtils'
import type { ContactOption } from './contactOptionUtils'
import { generateCustomerMembershipNumber } from './customerMembershipNumber'

type TranslateFn = (key: string) => string | undefined
type NotifyFn = (message: string, tone?: string) => void
type ContactModal = 'form' | 'import' | 'detail' | 'purchases' | null
type SortDirection = 'asc' | 'desc'
type CustomerGroupMode = 'time' | 'alphabet'
type CustomerPayload = Omit<CustomerRow, 'id' | 'points_balance' | 'points_earned' | 'points_redeemed' | 'points_rewarded' | 'points_deducted' | 'created_at'> & {
  userId?: string | number | null
  userName?: string | null
  // Only buildCustomerPayload (undo/redo replay + delete-restore) ever
  // sets this -- it needs to carry a deleted/edited customer's original
  // join date back through create/update so an undo doesn't reset it to
  // "now". The manual add/edit form's own payload is a separate plain
  // object literal in handleSave (`{ ...form, userId, userName }`) that
  // never has this key, since the form has no created_at input -- see
  // contacts.ts's CUSTOMERS.columns comment for the full reasoning.
  created_at?: string | null
}

interface CustomerMutationResult {
  success?: boolean
  error?: string
  id?: unknown
  data?: { id?: unknown } | null
}

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

interface CustomersTabProps {
  t: TranslateFn
  notify: NotifyFn
  active?: boolean
  // Set by Contacts.tsx when the operator clicks "Resolve" on a cluster in
  // the Possible Duplicates tab -- seeds this tab's own search box with
  // the contact's name so the two/more records land side by side in the
  // existing list, ready to edit/merge by hand with the tools already
  // here. Only seeds `search` once per value change (see the effect
  // below), so typing something else afterwards isn't repeatedly
  // stomped on.
  initialSearch?: string
}

interface CustomerRow extends Record<string, unknown> {
  id: number | string
  name?: string | null
  membership_number?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  notes?: string | null
  gender?: string | null
  created_at?: string | null
  points_balance?: number | string | null
  points_earned?: number | string | null
  points_redeemed?: number | string | null
  points_rewarded?: number | string | null
  points_deducted?: number | string | null
}

// SortChip vocabulary. This list is SERVER-paged, so both fields are sorted
// by the API (contacts.ts allowlist: created_at / lower(name)) -- a client
// sort would only reorder the loaded page. Points deliberately absent: the
// balance is computed after the page slice, so it can't be honestly
// server-sorted yet. Grouping follows the field: date -> time sections,
// name -> A-Z/Khmer alphabet sections.
const CUSTOMER_SORT_FIELD_DEFS = [
  { id: 'date', kind: 'date' as const, get: (customer: CustomerRow) => customer?.created_at },
  { id: 'name', kind: 'text' as const, get: (customer: CustomerRow) => customer?.name },
]

interface SectionRow extends Record<string, unknown> {
  __kind: 'section'
  section: {
    id: string
    label: string
    ids: Array<number | string>
    items: CustomerRow[]
  }
  collapsed: boolean
}

type CustomerDisplayRow = CustomerRow | SectionRow

interface CustomerApi {
  getCustomers: (query: QueryParams) => Promise<unknown>
  createCustomer: (payload: CustomerPayload) => Promise<unknown>
  updateCustomer: (id: number | string, payload: CustomerPayload | CustomerRow) => Promise<unknown>
  deleteCustomer: (id: number | string) => Promise<unknown>
}

interface ApiListResponse {
  items?: unknown
  total?: unknown
  page?: unknown
  pageSize?: unknown
}

type ActionHistoryBarHistory = ComponentProps<typeof ActionHistoryBar>['history']

const useApp = useAppHook as () => AppContextValue
const useSync = useSyncHook as () => SyncContextValue
const isBrokenLocalizedString = isBrokenLocalizedStringHook as (value: unknown) => boolean

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

function getCustomerApi(): CustomerApi {
  return {
    getCustomers: async (query) => (await loadContactReadTransportModule()).getCustomers(query),
    createCustomer: async (payload) => (await loadContactWriteTransportModule()).createCustomer(payload),
    updateCustomer: async (id, payload) => (await loadContactWriteTransportModule()).updateCustomer(id, payload),
    deleteCustomer: async (id) => (await loadContactWriteTransportModule()).deleteCustomer(id),
  }
}

function isSectionRow(row: CustomerDisplayRow | null | undefined): row is SectionRow {
  return row?.__kind === 'section'
}

function normalizeCustomerRows(value: unknown): CustomerRow[] {
  if (Array.isArray(value)) return value as CustomerRow[]
  const payload = value as ApiListResponse | null | undefined
  if (Array.isArray(payload?.items)) return payload.items as CustomerRow[]
  return []
}

function getApiListPayload(value: unknown): ApiListResponse | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ApiListResponse : null
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function formatPoints(value: number | string | null | undefined): string {
  return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function parseContactOptions(raw: unknown): ContactOption[] {
  return parseStoredContactOptions(raw, { legacyField: 'address' })
}

export function serializeContactOptions(options: ContactOption[]): string {
  return serializeStoredContactOptions(options) || ''
}

function tr(t: TranslateFn, key: string, fallback: string): string {
  const value = typeof t === 'function' ? t(key) : null
  return value && value !== key ? value : fallback
}

const ContactImportModal = lazyRetry(() => import('./ContactImportModal'), 'customers-contact-import')
const CustomerFormModal = lazyRetry(() => import('./CustomerFormModal'), 'customers-form-modal')
const CustomerPurchasesReportModal = lazyRetry(() => import('./CustomerPurchasesReportModal'), 'customers-purchases-report')
const ExportOptionsDialog = lazyRetry(() => import('../shared/ExportOptionsDialog'), 'customers-export-options')
const CUSTOMER_MUTATION_TIMEOUT_MS = 12000

function CustomersTab({ t, notify, active = true, initialSearch }: CustomersTabProps) {
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
  const deleteInFlightRef = useRef(false)
  const bulkDeleteInFlightRef = useRef(false)
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [search, setSearch] = useState('')
  const appliedInitialSearchRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!initialSearch || initialSearch === appliedInitialSearchRef.current) return
    appliedInitialSearchRef.current = initialSearch
    setSearch(initialSearch)
  }, [initialSearch])
  const [modal, setModal] = useState<ContactModal>(null)
  const [selected, setSelected] = useState<CustomerRow | null>(null)
  const [loading, setLoading] = useState(true)
  // Y1: true while ANY load is in flight, including the silent search
  // refetches -- so an empty re-filtered list can say "Searching..."
  // instead of the false "No matching customers" while the server query
  // for the current term is still running.
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [bulkActionBusy, setBulkActionBusy] = useState(false)
  const [customerPage, setCustomerPage] = useState(1)
  const [customerPageSize, setCustomerPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [customerTotal, setCustomerTotal] = useState(0)
  const [yearFilter, setYearFilter] = useState('all')
  const [monthFilter, setMonthFilter] = useState('all')
  const [genderFilter, setGenderFilter] = useState('all')
  // Unified sort (listSort.ts + SortChip). The spec drives BOTH the server
  // query's ORDER BY and the grouping style (date -> time sections, name ->
  // alphabet sections), replacing the old separate direction + group-mode
  // states.
  const [customerSortSpec, setCustomerSortSpec] = useState<SortSpec>(() => loadSortSpec(
    'customers:sort',
    { field: 'date', direction: 'desc' },
    CUSTOMER_SORT_FIELD_DEFS as unknown as ReadonlyArray<SortField<unknown>>,
  ))
  useEffect(() => { saveSortSpec('customers:sort', customerSortSpec) }, [customerSortSpec])
  const sortDirection: SortDirection = customerSortSpec.direction
  const groupMode: CustomerGroupMode = customerSortSpec.field === 'name' ? 'alphabet' : 'time'
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set())
  const [historyReady, setHistoryReady] = useState(false)
  // Y1: the other list pages (Products/POS/Inventory/Sales) debounce
  // search at the shared canonical 180ms; this tab used only
  // useDeferredValue, so every keystroke could fire its own server query.
  const deferredSearch = useDebouncedValue(search, 180)
  const syncChannelName = String(syncChannel?.channel || '')
  const syncChannelTs = Number(syncChannel?.ts || 0)
  const actionHistory = useActionHistory({ limit: 3, notify, enabled: historyReady, user })
  const customerFilters = useMemo(() => ({
    search: deferredSearch.trim() || undefined,
    year: yearFilter !== 'all' ? yearFilter : undefined,
    month: yearFilter !== 'all' && monthFilter !== 'all' ? monthFilter : undefined,
    // Server-side ORDER BY (see CUSTOMER_SORT_FIELD_DEFS' comment).
    sort: customerSortSpec.field === 'date' ? 'created' : 'name',
    dir: customerSortSpec.direction,
  }), [customerSortSpec, deferredSearch, monthFilter, yearFilter])
  // A sort change re-orders the whole result set -- start back at page 1.
  useEffect(() => { setCustomerPage(1) }, [customerSortSpec])
  const customerQuery = useMemo(() => ({
    ...customerFilters,
    page: customerPage,
    pageSize: customerPageSize,
  }), [customerFilters, customerPage, customerPageSize])
  const customerTotalPages = Math.max(1, Math.ceil(Math.max(0, Number(customerTotal || 0)) / Math.max(1, Number(customerPageSize || 1))))

  // Same class of bug as Products.tsx/Inventory.tsx (see their comments):
  // cloudflare/src/routes/contacts.ts clamps `page` to [1, 100000], not to
  // the query's actual totalPages, and echoes the requested page straight
  // back (customerPage is reset from `payload.page` below, which is just
  // the same out-of-range value handed back). Deleting the last customer(s)
  // on a later page leaves customerPage stuck past the new last page, and
  // the fetched `customers` array comes back empty while customerTotal
  // still updates -- the pagination footer looks clamped, the table isn't.
  // Self-heal it client-side, same fix as the other two pages.
  useEffect(() => {
    if (customerPage > customerTotalPages) {
      setCustomerPage(customerTotalPages)
    }
  }, [customerPage, customerTotalPages])


  // Was a literal `.toLowerCase().includes(query)` check per field -- real,
  // confirmed gap: routes/contacts.ts's own customer search (part 108) now
  // runs through customers_fts (typo/joiner/diacritic-tolerant, same FTS5
  // machinery products.ts uses), so the server can return a customer this
  // literal substring check then silently dropped from the visible list on
  // this client-side re-filter pass -- e.g. a typo'd query the server's FTS5
  // matched via its own tolerance, or "sokha dara" matching a customer named
  // "Dara Sokha" (word order), neither of which a plain `.includes()` can
  // ever satisfy. Same class of bug the Products/POS/Sales/Returns re-filter
  // comments already document (this pass must stay at least as permissive as
  // the server's own match set, never stricter) -- those pages were already
  // fixed; this one and Suppliers/Delivery below were not. Switched to the
  // shared `fuzzyTextMatches` (searchMatch.ts) over a single joined
  // haystack, matching the fields customers_fts indexes.
  const filteredBySearch = useMemo(() => customers.filter((customer) => (
    fuzzyTextMatches(
      [customer.name, customer.phone, customer.email, customer.membership_number, customer.address].join(' '),
      deferredSearch,
    )
  )), [customers, deferredSearch])

  // Client-side gender filter -- there's no server-side gender query param
  // (contacts.ts's GET /customers doesn't filter by it), so this narrows
  // the already-paginated page's worth of rows the same way the search
  // re-filter above does. Good enough for a same-page toggle; a person
  // filtering by gender across the *whole* customer list, not just the
  // current page, still needs to page through -- a real limitation worth
  // a server-side `gender` query param in a future session if this comes
  // up as more than a same-page narrowing tool.
  const filteredByGender = useMemo(
    () => (genderFilter === 'all' ? filteredBySearch : filteredBySearch.filter((customer) => (
      genderFilter === 'unspecified' ? !customer.gender : customer.gender === genderFilter
    ))),
    [filteredBySearch, genderFilter],
  )

  const timeMode = useMemo(() => getTimeGroupingMode(yearFilter, monthFilter), [monthFilter, yearFilter])
  const availableYears = useMemo(
    () => getAvailableYears(filteredByGender, (customer) => customer?.created_at),
    [filteredByGender],
  )
  const filteredSections = useMemo(() => (
    groupMode === 'alphabet'
      ? buildAlphabetActionSections(filteredByGender, {
        getName: (customer) => customer?.name,
        getItemId: (customer) => Number(customer?.id),
        sortDirection,
      })
      : buildTimeActionSections(filteredByGender, {
        getDate: (customer) => customer?.created_at,
        getItemId: (customer) => Number(customer?.id),
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

  const visibleCustomers = useMemo(
    () => filteredSections.flatMap((section) => section.items),
    [filteredSections],
  )
  const displayRows = useMemo<CustomerDisplayRow[]>(
    () => filteredSections.flatMap((section) => {
      const collapsed = collapsedSections.has(section.id)
      return [
        { __kind: 'section', section, collapsed },
        ...(!collapsed ? section.items : []),
      ] as CustomerDisplayRow[]
    }),
    [collapsedSections, filteredSections],
  )

  const { selectedIds, setSelectedIds, toggleOne, selectAllProp, selectionModeActive, getRowLongPressState } = useContactSelection(visibleCustomers)
  // H1+X5 (Part 402): exports go through the shared options dialog.
  const [exportDialog, setExportDialog] = useState<{ rows: Array<Record<string, unknown>>; baseName: string } | null>(null)
  // 11.1/11.2 (B6): in select mode a cell click toggles the row; out of it
  // the cell keeps opening the detail panel (long-press enters the mode).
  const handleContactCellClick = (customer: CustomerRow) => {
    if (selectionModeActive) {
      toggleOne(customer.id)
      return
    }
    setSelected(customer)
    setModal('detail')
  }
  // Gender/Created were already surfaced in the detail panel and XLSX
  // export (see the customer detail rows / export map below) but never
  // made it into this table's own column list -- added here so they're
  // visible without opening each row's detail panel.
  // 'Company' removed entirely (chat, Aug 25 2026) -- CustomerFormModal
  // never actually exposed an input for it, so it was a dead field a
  // customer could never set through the UI; dropped from the table
  // column set, search, form payload, and XLSX export. Suppliers keep
  // their own Company field (SuppliersTab.tsx) -- that form does expose
  // it and a business identity genuinely applies there.
  const customerColumns = [tr(t, 'name', 'Name'), 'Membership', tr(t, 'loyalty_points', 'Points'), tr(t, 'phone', 'Phone'), tr(t, 'email', 'Email'), tr(t, 'gender', 'Gender'), tr(t, 'col_added', 'Added'), 'Options']
  const customerSortFields = useMemo<SortField<CustomerRow>[]>(() => {
    const labels: Record<string, string> = {
      date: tr(t, 'sort_by_joined', 'Joined'),
      name: tr(t, 'name', 'Name'),
    }
    return CUSTOMER_SORT_FIELD_DEFS.map((field) => ({ ...field, label: labels[field.id] || field.id }))
  }, [t])

  const contactFilterSections = useMemo(() => ([
    // Sorting (and the A-Z grouping that follows it) moved onto the visible
    // SortChip; this section keeps the period narrowing it always bundled.
    {
      id: 'period',
      label: tr(t, 'period', 'Period'),
      searchable: true,
      options: buildPeriodFilterOptions({
        yearFilter, setYearFilter, monthFilter, setMonthFilter, availableYears,
        allTimeLabel: tr(t, 'all_time', 'All time'),
      }),
    },
    {
      id: 'gender',
      label: tr(t, 'gender', 'Gender'),
      options: [
        { id: 'gender-all', label: tr(t, 'all', 'All'), active: genderFilter === 'all', onClick: () => setGenderFilter('all') },
        { id: 'gender-male', label: tr(t, 'male', 'Male'), active: genderFilter === 'male', onClick: () => setGenderFilter('male') },
        { id: 'gender-female', label: tr(t, 'female', 'Female'), active: genderFilter === 'female', onClick: () => setGenderFilter('female') },
        { id: 'gender-other', label: tr(t, 'other', 'Other'), active: genderFilter === 'other', onClick: () => setGenderFilter('other') },
        { id: 'gender-unspecified', label: tr(t, 'unspecified', 'Unspecified'), active: genderFilter === 'unspecified', onClick: () => setGenderFilter('unspecified') },
      ],
    },

  ]), [availableYears, genderFilter, monthFilter, t, yearFilter])
  const displayContactFilterSections = useMemo(() => (
    contactFilterSections.map((section) => {
      if (section.id !== 'group') return section
      return {
        ...section,
        options: section.options.map((option) => (
          option.id === 'group-alphabet' && isBrokenLocalizedString(option.label)
            ? { ...option, label: tr(t, 'alphabetical', 'A-Z / Khmer') }
            : option
        )),
      }
    })
  ), [contactFilterSections, t])
  const activeFilterCount = countActiveFlags([yearFilter !== 'all', monthFilter !== 'all', genderFilter !== 'all'])
  const hasActiveCustomerSearchOrFilters = deferredSearch.trim().length > 0 || activeFilterCount > 0
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

  const buildCustomerPayload = useCallback((customer: Partial<CustomerRow> = {}): CustomerPayload => ({
    name: String(customer.name || '').trim(),
    membership_number: String(customer.membership_number || '').trim().toUpperCase(),
    phone: customer.phone || '',
    email: customer.email || '',
    address: customer.address || '',
    notes: customer.notes || '',
    gender: customer.gender || '',
    // Carried through so a restored/redone customer keeps its original
    // join date -- contacts.ts's CUSTOMERS.columns allowlist accepts this
    // key specifically for this caller (see its own comment); left
    // undefined rather than '' when the snapshot has none, so pickColumns
    // skips the key entirely instead of writing an empty string over
    // whatever CURRENT_TIMESTAMP would have set.
    created_at: customer.created_at || undefined,
    userId: user?.id,
    userName: user?.name,
  }), [user?.id, user?.name])

  const runCustomerMutation = useCallback(async (loader: () => unknown | Promise<unknown>, label: string): Promise<CustomerMutationResult> => (
    await withLoaderTimeout(loader, label, CUSTOMER_MUTATION_TIMEOUT_MS) as CustomerMutationResult
  ), [])

  const clearLoadWatchdog = useCallback(() => {
    if (loadWatchdogRef.current != null) {
      window.clearTimeout(loadWatchdogRef.current)
      loadWatchdogRef.current = null
    }
  }, [])

  const load = useCallback(async ({ silent = false, label = 'Customers' }: { silent?: boolean, label?: string } = {}): Promise<void> => {
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
          setLoadError(tr(t, 'customers_load_slow', 'Customers are taking longer than expected. Tap Retry or revisit the page in a moment.'))
        }, 15000)
      }
      try {
        const baseQuery = { ...customerQuery, includePoints: '1' }
        const data = await withLoaderTimeout(() => getCustomerApi().getCustomers(baseQuery), label, 12000)
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        const items = normalizeCustomerRows(data)
        setCustomers(items)
        const payload = getApiListPayload(data)
        setCustomerTotal(Number(payload?.total || items.length || 0))
        if (payload) {
          setCustomerPage(Number(payload.page || customerPage) || 1)
          setCustomerPageSize(Number(payload.pageSize || customerPageSize) || customerPageSize)
        }
        loadedOnceRef.current = true
        setLoadError('')
      } catch (error: unknown) {
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        const message = getErrorMessage(error, 'Failed to load customers')
        if (!loadedOnceRef.current) {
          setLoadError(message)
          notify(message, 'error')
        } else {
          const refreshMessage = tr(t, 'customers_refresh_failed', 'Unable to refresh customers right now. Showing the latest loaded data.')
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
  }, [clearLoadWatchdog, customerPage, customerPageSize, customerQuery, notify, t])

  useEffect(() => {
    setCustomerPage(1)
  }, [customerFilters])

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
    if (!active || syncChannelName !== 'customers') return
    load({ silent: true, label: 'Customers refresh' })
  }, [active, load, syncChannelName, syncChannelTs])

  const handleSave = async (form: Partial<CustomerRow>) => {
    if (!beginSingleAction(saveInFlightRef)) return
    if (!String(form.name || '').trim()) {
      finishSingleAction(saveInFlightRef)
      notify(tr(t, 'name_required', 'Name required'), 'error')
      return
    }
    if (!String(form.membership_number || '').trim()) {
      finishSingleAction(saveInFlightRef)
      notify(tr(t, 'membership_number_required', 'Membership number is required'), 'error')
      return
    }

    try {
      const existingSnapshot = selected ? cloneHistorySnapshot(selected) : null
      const payload = { ...form, userId: user?.id, userName: user?.name }
      const result = selected
        ? await runCustomerMutation(() => getCustomerApi().updateCustomer(selected.id, payload), 'Update customer')
        : await runCustomerMutation(() => getCustomerApi().createCustomer(payload), 'Create customer')
      if (result?.success === false) {
        notify(result.error || 'Failed', 'error')
        return
      }
      if (selected && existingSnapshot) {
        const nextSnapshot = cloneHistorySnapshot({ ...existingSnapshot, ...payload, id: selected.id })
        actionHistory.pushAction({
          label: `Edit customer ${existingSnapshot.name || nextSnapshot.name || ''}`.trim(),
          undo: async () => {
            const restoreResult = await runCustomerMutation(
              () => getCustomerApi().updateCustomer(existingSnapshot.id, buildCustomerPayload(existingSnapshot)),
              'Undo customer edit',
            )
            if (restoreResult?.success === false) throw new Error(restoreResult.error || 'Failed to restore customer')
            await load({ silent: true, label: 'Customers undo edit' })
          },
          redo: async () => {
            const redoResult = await runCustomerMutation(
              () => getCustomerApi().updateCustomer(nextSnapshot.id, buildCustomerPayload(nextSnapshot)),
              'Redo customer edit',
            )
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
              await runCustomerMutation(() => getCustomerApi().deleteCustomer(createdCustomerId), 'Undo customer create')
              await load({ silent: true, label: 'Customers undo create' })
            },
            redo: async () => {
              const recreateResult = await runCustomerMutation(
                () => getCustomerApi().createCustomer(buildCustomerPayload(createdSnapshot)),
                'Redo customer create',
              )
              if (recreateResult?.success === false) throw new Error(recreateResult.error || 'Failed to recreate customer')
              createdCustomerId = extractHistoryResultId(recreateResult)
              await load({ silent: true, label: 'Customers redo create' })
            },
          })
        }
      }
      // Part 157: a Review Required edit now comes back with `partial:
      // true` when the server silently dropped every field except name
      // (see routes/contacts.ts's PUT handler) -- surface that instead of
      // the generic "Updated" toast so the user isn't left thinking their
      // full set of changes actually saved.
      if (selected && (result as { partial?: boolean } | null)?.partial) {
        notify(tr(t, 'contact_partial_update_notice', 'Only the name was saved -- your other changes need Full Access to Contacts.'), 'warning')
      } else {
        notify(selected ? tr(t, 'customer_updated', 'Updated') : tr(t, 'customer_added', 'Added'))
      }
      setModal(null)
      setSelected(null)
      await load({ silent: true, label: 'Customers after save' })
    } catch (error: unknown) {
      notify(getErrorMessage(error, 'Failed'), 'error')
    } finally {
      finishSingleAction(saveInFlightRef)
    }
  }

  const handleDelete = async (customer: CustomerRow) => {
    if (!beginSingleAction(deleteInFlightRef)) return
    if (!confirm(`Delete customer "${customer.name}"?`)) {
      finishSingleAction(deleteInFlightRef)
      return
    }
    try {
      const snapshot = cloneHistorySnapshot(customer)
      await runCustomerMutation(() => getCustomerApi().deleteCustomer(customer.id), 'Delete customer')
      let restoredCustomerId = 0
      actionHistory.pushAction({
        label: `Delete customer ${snapshot.name || ''}`.trim(),
        undo: async () => {
          const restoreResult = await runCustomerMutation(
            () => getCustomerApi().createCustomer(buildCustomerPayload(snapshot)),
            'Undo customer delete',
          )
          if (restoreResult?.success === false) throw new Error(restoreResult.error || 'Failed to restore customer')
          restoredCustomerId = extractHistoryResultId(restoreResult)
          await load({ silent: true, label: 'Customers undo delete' })
        },
        redo: async () => {
          const targetId = restoredCustomerId || Number(snapshot.id || 0)
          if (!targetId) return
          await runCustomerMutation(() => getCustomerApi().deleteCustomer(targetId), 'Redo customer delete')
          await load({ silent: true, label: 'Customers redo delete' })
        },
      })
      notify(tr(t, 'customer_deleted', 'Deleted'))
      setModal(null)
      setSelected(null)
      await load({ silent: true, label: 'Customers after delete' })
    } catch (error: unknown) {
      notify(getErrorMessage(error, 'Failed'), 'error')
    } finally {
      finishSingleAction(deleteInFlightRef)
    }
  }

  const handleBulkDelete = async () => {
    if (!selectedIds.size || !beginSingleAction(bulkDeleteInFlightRef, { blocked: bulkActionBusy })) return
    if (!confirm(`Delete ${selectedIds.size} customer(s)?`)) {
      finishSingleAction(bulkDeleteInFlightRef)
      return
    }
    const ids = [...selectedIds]
    const snapshots = buildSelectedSnapshots(customers, ids)
    const failedIds = []
    setBulkActionBusy(true)
    try {
      const deleteRun = await runConcurrentTasks(ids, async (id: number) => {
        await runCustomerMutation(() => getCustomerApi().deleteCustomer(id), 'Bulk delete customers')
        return Number(id)
      })
      const deletedCount = deleteRun.successes.length
      failedIds.push(...deleteRun.failures.map((entry) => Number(entry.item)).filter((id) => Number.isFinite(id)))
      setSelectedIds(new Set(failedIds))
      await load({ silent: true, label: 'Customers refresh after delete' })
      const failedIdSet = new Set(failedIds)
      const deletedSnapshots = snapshots.filter((snapshot) => !failedIdSet.has(Number(snapshot?.id || 0)))
      if (deletedCount > 0 && deletedSnapshots.length) {
        let restoredEntries: Array<{ restoredId: number }> = []
        actionHistory.pushAction({
          label: `Delete ${deletedCount} customer${deletedCount === 1 ? '' : 's'}`,
          undo: async () => {
            const restoreRun = await runConcurrentTasks(deletedSnapshots, async (snapshot: CustomerRow) => {
              const result = await runCustomerMutation(() => getCustomerApi().createCustomer({
                name: snapshot.name || '',
                membership_number: snapshot.membership_number || '',
                phone: snapshot.phone || '',
                email: snapshot.email || '',
                address: snapshot.address || '',
                notes: snapshot.notes || '',
                userId: user?.id,
                userName: user?.name,
              }), 'Restore deleted customers')
              return { restoredId: Number(result?.id || result?.data?.id || 0) }
            })
            if (restoreRun.failures.length) throw (restoreRun.failures[0]?.error || new Error('Failed to restore customer'))
            restoredEntries = restoreRun.successes.map((entry) => entry.value as { restoredId: number })
            await load({ silent: true, label: 'Customers restore deleted' })
          },
          redo: async () => {
            const idsToDelete = restoredEntries.map((entry) => Number(entry.restoredId || 0)).filter((id) => id > 0)
            const redoRun = await runConcurrentTasks(idsToDelete, async (id: number) => (
              runCustomerMutation(() => getCustomerApi().deleteCustomer(id), 'Redo bulk customer delete')
            ))
            if (redoRun.failures.length) throw (redoRun.failures[0]?.error || new Error('Failed to re-delete customer'))
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
      finishSingleAction(bulkDeleteInFlightRef)
      setBulkActionBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Manage (Import + Export folded into one dropdown, same pattern
          Products.tsx uses) / History / Add Customer -- History before
          Manage per the ordering used on Products. Used to be four equal-
          width buttons (Import, Export, Add, History); folding Import/
          Export into one Manage menu leaves more room for each remaining
          button's label at narrow widths. */}
      <div className="flex min-w-0 items-stretch gap-1.5 overflow-x-auto pb-1">
        <ActionHistoryBar history={actionHistory as unknown as ActionHistoryBarHistory} summaryMode="compact" t={t} className="min-w-0 flex-1" showLabel />
        <LazyPortalMenu
          align="auto"
          triggerWrapperClassName="min-w-0 flex-1"
          trigger={(
            <button
              type="button"
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-blue-400 hover:bg-blue-50/60 hover:text-blue-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-blue-500 dark:hover:bg-slate-700/80 dark:hover:text-blue-300 sm:text-sm"
              aria-haspopup="true"
              aria-label={tr(t, 'manage', 'Manage')}
              title={tr(t, 'manage', 'Manage')}
            >
              <Settings2 className="h-4 w-4 shrink-0" />
              <span className="truncate">{tr(t, 'manage', 'Manage')}</span>
            </button>
          )}
          items={([
            { label: tr(t, 'import_contacts', 'Import'), onClick: () => setModal('import'), color: 'blue', icon: <Download className="h-4 w-4 shrink-0" /> },
            {
              label: tr(t, 'export', 'Export'),
              color: 'green',
              icon: <Upload className="h-4 w-4 shrink-0" />,
              // H1+X5 (Part 402): opens the shared options dialog (column
              // chooser + CSV/Excel/PDF) with the same readable rows the
              // old direct xlsx download built.
              onClick: () => {
                const rows = visibleCustomers.map((customer) => {
                  const options = parseContactOptions(customer.address)
                  return {
                    Name: customer.name || '',
                    Membership_Number: customer.membership_number || '',
                    Phone: customer.phone || '',
                    Email: customer.email || '',
                    Gender: customer.gender || '',
                    Options: options.map((option) => `[${option.label || 'Option'}] ${[option.name, option.phone, option.email, option.address].filter(Boolean).join(' | ')}`).join(' || '),
                    Notes: customer.notes || '',
                    Created: customer.created_at || '',
                  }
                })
                setExportDialog({ rows, baseName: 'customers' })
              },
            },
          ] as PortalMenuItem[])}
        />
        <button
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-blue-700 bg-blue-600 px-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 hover:border-blue-800 sm:text-sm"
          onClick={() => { setSelected(null); setModal('form') }}
          title={tr(t, 'add_customer', 'Add Customer')}
          aria-label={tr(t, 'add_customer', 'Add Customer')}
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span className="truncate">{tr(t, 'add_customer', 'Add Customer')}</span>
        </button>
      </div>

      {/* Search + filter pin to the top of the page's scroll container while
          scrolling -- same `sticky top-2` treatment as Products/Inventory/
          Sales/Returns/Branches (Aug 11 2026 UI-polish request). This tab
          renders under Contacts.tsx's own Customers/Suppliers/Delivery tab
          bar, which is NOT sticky and scrolls away like the rest of that
          page's chrome -- only this row (the thing actually reached for
          while scrolling a long list) pins. No separate select-all row to
          include here: ContactTable renders its own selectAll control
          inside the table header via the `selectAll` prop below. */}
      <div className="sticky top-2 z-30 -mx-1 flex min-w-0 items-center gap-2 bg-gray-50/95 pb-2 pt-1 backdrop-blur dark:bg-gray-900/95 sm:mx-0">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <SearchInput
            id="customer-search"
            name="customer_search"
            value={search}
            onChange={setSearch}
            placeholder={tr(t, 'search_customers_placeholder', `${tr(t, 'search', 'Search')} customers`)}
            className="min-w-0 max-w-xs flex-1"
          />
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
          {selectedIds.size > 0 && canBulkDeleteContacts ? (
            <button
              className="btn-secondary whitespace-nowrap text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleBulkDelete}
              disabled={bulkActionBusy}
            >
              {tr(t, 'delete_selected_count', 'Delete {count}').replace('{count}', String(selectedIds.size))}
            </button>
          ) : null}
          <SortChip
            spec={customerSortSpec}
            fields={customerSortFields}
            onChange={setCustomerSortSpec}
            label={tr(t, 'sort', 'Sort')}
          />
          <FilterMenu
            label={tr(t, 'filters', 'Filters')}
            activeCount={activeFilterCount}
      sections={displayContactFilterSections}
            onClear={() => {
              setYearFilter('all')
              setMonthFilter('all')
              setCustomerSortSpec({ field: 'date', direction: 'desc' })
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

      <ContactTable
        loading={loading}
        rows={displayRows}
        emptyLabel={
          refreshing
            ? tr(t, 'searching', 'Searching...')
            : hasActiveCustomerSearchOrFilters
              ? tr(t, 'no_matching_customers', 'No matching customers')
              : tr(t, 'no_customers', 'No customers')
        }
        compactEmptyState={hasActiveCustomerSearchOrFilters}
        columns={customerColumns}
        selectAll={selectAllProp}
        selectionModeActive={selectionModeActive}
        totalCount={customerTotal || visibleCustomers.length}
        page={customerPage}
        pageSize={customerPageSize}
        onPageChange={setCustomerPage}
        onPageSizeChange={setCustomerPageSize}
        onRetry={() => load({ silent: false, label: 'Customers retry' })}
        loadingLabel={tr(t, 'loading_customers', 'Loading customers...')}
        loadingDetails={tr(t, 'contacts_loading_details', 'Fetching customers, filters, and grouped sections.')}
        t={t}
        renderRow={(customer) => {
          if (isSectionRow(customer)) {
            const section = customer.section
            return (
              <tr key={section.id} className="bg-slate-100/90 dark:bg-slate-800/80">
                <td colSpan={customerColumns.length + 2} className="px-4 py-2">
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
                        {customer.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        {customer.collapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            )
          }
          const customerRow = customer as CustomerRow
          const options = parseContactOptions(customerRow.address)
          const primaryOption = getPrimaryContactOption(options, {
            fallback: {
              name: customerRow.name || '',
              phone: customerRow.phone || '',
              email: customerRow.email || '',
              address: '',
            },
          })
          const rowLongPressState = getRowLongPressState(Number(customerRow.id))
          const rowLongPress = createLongPressHandlers(rowLongPressState, {
            disabled: selectionModeActive,
            onLongPress: () => {
              if (!selectedIds.has(Number(customerRow.id))) toggleOne(customerRow.id)
            },
            // No onClick: plain taps keep hitting the cells' own handlers.
          })
          return (
            <tr
              key={customerRow.id}
              className={`table-row cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-700/30 ${selectedIds.has(Number(customerRow.id)) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
              {...(selectionModeActive ? {} : rowLongPress)}
              onClickCapture={(event) => {
                // Swallow the ghost click that follows a fired long-press so
                // entering select mode doesn't also open the detail panel.
                if (consumeLongPressClick(rowLongPressState)) {
                  event.preventDefault()
                  event.stopPropagation()
                }
              }}
            >
              <td className={selectionModeActive ? 'w-10 px-3 py-2' : 'w-0 px-0 py-2'} onClick={(event) => event.stopPropagation()}>
                {selectionModeActive ? (
                <>
                <label htmlFor={`customer-select-${customerRow.id}`} className="sr-only">{`Select ${customerRow.name}`}</label>
                <input id={`customer-select-${customerRow.id}`} name={`customer_select_${customerRow.id}`} type="checkbox" className="h-4 w-4 cursor-pointer rounded" checked={selectedIds.has(Number(customerRow.id))} onChange={() => toggleOne(customerRow.id)} />
                </>
                ) : null}
              </td>
              <td className="px-4 py-2 font-medium text-gray-900 cursor-pointer dark:text-white" onClick={() => handleContactCellClick(customerRow)}>{customerRow.name}</td>
              <td className="px-4 py-2 font-mono text-xs text-gray-500 cursor-pointer" onClick={() => handleContactCellClick(customerRow)}>{customerRow.membership_number || '--'}</td>
              <td className="px-4 py-2 font-semibold text-blue-600 cursor-pointer dark:text-blue-300" onClick={() => handleContactCellClick(customerRow)}>
                {formatPoints(customerRow.points_balance)}
              </td>
              <td className="px-4 py-2 text-gray-500 cursor-pointer" onClick={() => handleContactCellClick(customerRow)}>{primaryOption.phone || customerRow.phone || '-'}</td>
              <td className="px-4 py-2 text-xs text-gray-500 cursor-pointer" onClick={() => handleContactCellClick(customerRow)}>{primaryOption.email || customerRow.email || '-'}</td>
              <td className="px-4 py-2 text-gray-500 cursor-pointer" onClick={() => handleContactCellClick(customerRow)}>{customerRow.gender ? tr(t, customerRow.gender, customerRow.gender) : tr(t, 'unspecified', 'Unspecified')}</td>
              <td className="px-4 py-2 text-xs text-gray-500 cursor-pointer" onClick={() => handleContactCellClick(customerRow)}>{fmtDateTime24(customerRow.created_at)}</td>
              <td className="px-4 py-2 cursor-pointer" onClick={() => handleContactCellClick(customerRow)}>
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
                <ThreeDotMenu onDetails={() => { setSelected(customerRow); setModal('detail') }} onEdit={() => { setSelected(customerRow); setModal('form') }} onDelete={canDeleteContact ? () => handleDelete(customerRow) : undefined} />
              </td>
            </tr>
          )
        }}
        renderCard={(customer) => {
          if (isSectionRow(customer)) {
            const section = customer.section
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
                      {customer.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            )
          }
          const customerRow = customer as CustomerRow
          const options = parseContactOptions(customerRow.address)
          const primaryOption = getPrimaryContactOption(options, {
            fallback: {
              name: customerRow.name || '',
              phone: customerRow.phone || '',
              email: customerRow.email || '',
              address: '',
            },
          })
          const cardLongPressState = getRowLongPressState(Number(customerRow.id))
          const cardLongPress = createLongPressHandlers(cardLongPressState, {
            disabled: selectionModeActive,
            onLongPress: () => {
              if (!selectedIds.has(Number(customerRow.id))) toggleOne(customerRow.id)
            },
          })
          // Contact-method count shown next to the name: the default
          // phone/email counts as 1 (customers store extra options in the
          // `address` JSON separately from the phone/email columns), so a
          // customer with only a default reads "1" and each extra option
          // bumps it -- one default + one option = 2.
          const contactCount = options.length + ((customerRow.phone || customerRow.email) ? 1 : 0)
          const cardPhone = primaryOption.phone || customerRow.phone || ''
          return (
            <div
              key={customerRow.id}
              className={`card flex cursor-pointer select-none items-center gap-3 p-3 ${selectedIds.has(Number(customerRow.id)) ? 'bg-blue-50 ring-2 ring-blue-400 dark:bg-blue-900/20' : ''}`}
              onClick={() => handleContactCellClick(customerRow)}
              {...(selectionModeActive ? {} : cardLongPress)}
              onClickCapture={(event) => {
                if (consumeLongPressClick(cardLongPressState)) {
                  event.preventDefault()
                  event.stopPropagation()
                }
              }}
            >
              {selectionModeActive ? (
              <div className="flex-shrink-0" onClick={(event) => { event.stopPropagation(); toggleOne(customerRow.id) }}>
                <label htmlFor={`customer-card-select-${customerRow.id}`} className="sr-only">{`Select ${customerRow.name}`}</label>
                <input id={`customer-card-select-${customerRow.id}`} name={`customer_card_select_${customerRow.id}`} type="checkbox" className="h-5 w-5 cursor-pointer rounded" checked={selectedIds.has(Number(customerRow.id))} onChange={() => toggleOne(customerRow.id)} />
              </div>
              ) : null}
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-600 dark:bg-blue-900/40">{customerRow.name?.[0]?.toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">{customerRow.name}</span>
                  {contactCount > 0 ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600 dark:bg-blue-900/40 dark:text-blue-300" title={`${contactCount} ${tr(t, 'contact_options', 'contact options')}`}>
                      <Phone className="h-2.5 w-2.5" />{contactCount}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-gray-500">
                  {customerRow.membership_number ? <span className="font-mono text-blue-500">{customerRow.membership_number}</span> : null}
                  {customerRow.membership_number ? <span className="mx-1 text-gray-300 dark:text-gray-600">·</span> : null}
                  <span className="font-semibold text-blue-600 dark:text-blue-300">{formatPoints(customerRow.points_balance)} {tr(t, 'points_short', 'pts')}</span>
                </div>
                {cardPhone ? <div className="truncate text-[11px] text-gray-500">{cardPhone}</div> : null}
              </div>
            </div>
          )
        }}
      />

      {modal === 'form' ? (
        <Suspense fallback={null}>
          <CustomerFormModal customer={selected} onSave={handleSave} onClose={() => { setModal(null); setSelected(null) }} t={t} />
        </Suspense>
      ) : null}
      {modal === 'import' ? (
        <Suspense fallback={null}>
          <ContactImportModal type="customer" onClose={() => setModal(null)} onDone={() => load({ silent: true, label: 'Customers after import' })} />
        </Suspense>
      ) : null}
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
            [tr(t, 'gender', 'Gender'), selected.gender ? tr(t, selected.gender, selected.gender) : tr(t, 'unspecified', 'Unspecified')],
            ['Contact Options', buildContactOptionSummary(parseContactOptions(selected.address))],
            [tr(t, 'notes', 'Notes'), selected.notes],
            [tr(t, 'col_added', 'Added'), fmtDateTime24(selected.created_at)],
          ]}
          onEdit={() => setModal('form')}
          onDelete={canDeleteContact ? () => handleDelete(selected) : undefined}
          onClose={() => { setModal(null); setSelected(null) }}
          t={t}
          extraButtons={[{ label: tr(t, 'customer_purchases', 'Purchases'), onClick: () => setModal('purchases') }]}
        />
      ) : null}
      {exportDialog ? (
        <Suspense fallback={null}>
          <ExportOptionsDialog
            title={t('export_options_title') || 'Export options'}
            fileBaseName={exportDialog.baseName}
            columns={columnsFromRows(exportDialog.rows)}
            rows={exportDialog.rows}
            rememberKey="contacts-customers"
            t={t}
            notify={notify}
            onClose={() => setExportDialog(null)}
          />
        </Suspense>
      ) : null}
      {/* X4: per-customer purchase totals -- the customer leg of the
          per-contact drills (suppliers: D5; couriers: X3). */}
      {modal === 'purchases' && selected ? (
        <Suspense fallback={null}>
          <CustomerPurchasesReportModal
            customerId={selected.id as number}
            customerName={String(selected.name || '')}
            t={t}
            onClose={() => setModal('detail')}
          />
        </Suspense>
      ) : null}
    </div>
  )
}

export { CustomersTab }

