import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js'
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js'
import History from 'lucide-react/dist/esm/icons/history.js'
import Lock from 'lucide-react/dist/esm/icons/lock.js'
import Play from 'lucide-react/dist/esm/icons/play.js'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import Unlock from 'lucide-react/dist/esm/icons/unlock.js'
import Users from 'lucide-react/dist/esm/icons/users.js'
import { useApp, type AppContextCoreValue } from '../../app/AppContextCore.tsx'
import { captureActorReadScope, captureActorWriteIdentity, isActorReadScopeCurrent, isActorWriteIdentityCurrent } from '../../api/actorReadScope.ts'
import { captureInventoryCheckWriteScope, changeInventoryCheckSession, createInventoryCheckSession, readInventoryCheckHistory, readInventoryCheckProducts, readInventoryCheckSession, readInventoryCheckSessions, saveInventoryCheckObservation, type InventoryCheckSession, type InventoryCheckSessionItem } from '../../api/inventoryChecksTransport.ts'
import type { QueryParams } from '../../api/query.ts'
import { createClientRequestId } from '../../api/requestIds.ts'
import { getInventoryCheckAccess, type InventoryCheckAccess } from '../../utils/inventoryCheckAccess.ts'
import { isAdminControlUser } from '../../utils/permissions.ts'
import { continuousRangeParams } from '../../utils/continuousRangeParams.ts'
import { fmtDateOnly, fmtDateTime24 } from '../../utils/formatters.ts'
import type { InventoryCheckObservation, InventoryCheckPatch, InventoryCheckProduct } from '../../types/inventoryChecks.ts'
import InventoryCheckControls, { countActiveFilters, type InventoryCheckFilters } from './InventoryCheckControls.tsx'
import InventoryCheckRows from './InventoryCheckRows.tsx'
import InventoryCheckHistoryFloat, { type InventoryCheckHistoryResult } from './InventoryCheckHistoryFloat.tsx'
import InventoryCheckSessionsList, { InventoryCheckSessionFilterMenu, SessionCounts, SessionStatusChip, initialSessionFilters, sessionDisplayName, type SessionListFilters } from './InventoryCheckSessionsList.tsx'
import HubSectionNav from '../shared/HubSectionNav.tsx'
import { useHubSection } from '../shared/hubNavigation.ts'
import InfoHint from '../shared/InfoHint.tsx'
import StatsRangeRow from '../shared/StatsRangeRow.tsx'
import StatsStrip, { type StatCardDef } from '../shared/StatsStrip.tsx'
import PaginationControls from '../shared/PaginationControls.tsx'
import Modal from '../shared/Modal.tsx'
import { useConfirmDialog } from '../shared/useConfirmDialog.tsx'
import { toolbarIconButtonClassName } from '../shared/toolbarButtonStyles.ts'
import { statsPresetRange, type DateTimeRange } from '../shared/statsStripPresets.ts'

type ProductsResult = {
  items: InventoryCheckProduct[]; total: number; page: number; pageSize: number; totalPages?: number
  branches: Array<{ id: number; name: string }>
  stats?: Record<string, number | null | undefined>
  facets?: { brands?: string[]; categories?: string[]; reasons: string[] }
  facetsLimited?: { brands: boolean; categories: boolean; reasons: boolean }
  rankings?: { products?: Array<{ family_key: string; name: string; qty_sold: number }>; customers?: Array<{ customer_id: number; name: string; sale_count: number }> }
  issues?: Array<{ product_id: number; branch_id: number; session_id: string; session_title: string; created_by: number; reason: string | null; revision: number; state: 'issue'; counted_quantity?: number | null }>
}
/** creatorName rides along from the Sessions list: the single-session read does not send it. */
type Selection = { branchId: string; sessionId: string; creatorName?: string | null; bootstrapIntent?: ControlIntent }
type Section = 'products' | 'sessions' | 'issues'
type ControlIntent = { range: DateTimeRange; query: string; filters: InventoryCheckFilters; pagination: { section: Section; page: number }; pageSize: number; showCustomerRanking: boolean }
type Attempt = { productId: number; patch: InventoryCheckPatch; revision: number; sessionRevision: number; requestId: string }
// Definite server refusals (the request was answered and nothing was written). Each gets its own concise message;
// unlike an unknown outcome, the frozen attempt is dropped so the operator can correct and send a fresh request.
const REFUSAL_MESSAGES: Record<string, { key: string; fallback: string }> = {
  inventory_check_count_requires_issue: { key: 'inventory_check_error_count_requires_issue', fallback: 'Counted quantity differs from stock. Report it as an issue.' },
  inventory_check_baseline_changed: { key: 'inventory_check_error_baseline_changed', fallback: 'Stock or products changed. Reload and try again.' },
  inventory_check_owner_required: { key: 'inventory_check_error_owner_required', fallback: 'Only the session creator or an administrator can change this check.' },
  inventory_check_product_not_eligible: { key: 'inventory_check_error_product_not_eligible', fallback: 'A product on this page cannot be checked. Reload and try again.' },
}
function knownRefusal(cause: unknown) {
  const code = (cause as { code?: unknown } | null)?.code
  return typeof code === 'string' && Object.hasOwn(REFUSAL_MESSAGES, code) ? REFUSAL_MESSAGES[code] : undefined
}
const initialFilters: InventoryCheckFilters = { branchId: '', stockState: '', state: '', reason: '', brand: '', category: '', sortBy: 'name', sortDirection: 'asc' }

function projectProduct(product: InventoryCheckProduct, fields: InventoryCheckAccess['fields']): InventoryCheckProduct {
  const visible = { ...product }
  if (!fields.stock) { delete visible.quantity; delete visible.damaged_quantity }
  if (!fields.price) delete visible.selling_price_usd
  if (!fields.cost) { delete visible.cost_price_usd; delete visible.cost_needs_review }
  if (!fields.sales) delete visible.qty_sold
  if (!fields.customers) delete visible.customer_count
  if (!fields.brand) delete visible.brand
  if (!fields.category) delete visible.category
  if (!fields.barcode) { delete visible.barcode; delete visible.sku }
  return visible
}

/** What a new count session will be taken from, in words: search, dates and every chosen filter. */
function describeCountScope(t: (key: string) => string, args: { query: string; range: DateTimeRange; filters: InventoryCheckFilters; stateApplies: boolean }): string {
  const { query, range, filters } = args
  const stateText: Record<string, string> = { unstarted: t('inventory_check_unstarted'), done: t('done'), issue: t('issues') }
  const stockText: Record<string, string> = { in_stock: t('in_stock'), low_stock: t('low_stock'), out_of_stock: t('out_of_stock') }
  const parts = [
    query.trim() && `${t('search')}: ${query.trim()}`,
    (range.startDate || range.endDate) && [range.startDate, range.endDate].map(day => day ? fmtDateOnly(day) : '…').join(' → '),
    args.stateApplies && filters.state && `${t('inventory_check_state')}: ${stateText[filters.state] ?? filters.state}`,
    filters.reason && `${t('reason')}: ${filters.reason}`,
    filters.stockState && `${t('stock_status')}: ${stockText[filters.stockState] ?? filters.stockState}`,
    filters.brand && `${t('brand')}: ${filters.brand}`,
    filters.category && `${t('category')}: ${filters.category}`,
  ]
  return parts.filter(Boolean).join(' · ')
}

export default function InventoryChecksPage() {
  const app = useApp() as AppContextCoreValue
  const access = getInventoryCheckAccess(app.user)
  const scope = captureActorReadScope('inventoryChecks')
  const identity = captureActorWriteIdentity()
  const active = app.page === 'inventory' && app.authReady && access.canView
  const boundary = JSON.stringify([userIdentity(app.user), scope.authority, identity.owner, identity.epoch, access, active])
  const authorityFence = useRef(boundary)
  authorityFence.current = boundary
  if (!active) return access.canView ? null : <app.AccessDenied />
  return <InventorySelection key={boundary} access={access} isCurrent={() => authorityFence.current === boundary} />
}

function userIdentity(user: { id?: unknown } | null) { return String(user?.id ?? '') }

function InventorySelection({ access, isCurrent }: { access: InventoryCheckAccess; isCurrent: () => boolean }) {
  const [selection, setSelection] = useState<Selection>({ branchId: '', sessionId: '' })
  const selected = useRef(selection)
  selected.current = selection
  const changeSelection = (value: Selection) => {
    if (selected.current.branchId === value.branchId && selected.current.sessionId === value.sessionId) return
    selected.current = value; setSelection(value)
  }
  return <InventoryWorkspace key={`${selection.branchId}:${selection.sessionId}`} access={access} selection={selection} onSelect={changeSelection} isCurrent={() => isCurrent() && selected.current === selection} />
}

/** One icon-only action: the translated name is both its tooltip and its accessible name. */
function IconAction({ label, onClick, disabled = false, pressed, children }: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; children: ReactNode }) {
  return <button type="button" className={`${toolbarIconButtonClassName} disabled:opacity-50 ${pressed ? '!bg-slate-800 !text-white dark:!bg-slate-200 dark:!text-slate-900' : ''}`} aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>{children}</button>
}

/** A small amber row badge whose explanation lives behind its own InfoHint. */
function RowBadge({ text, hint }: { text: string; hint: string }) {
  return <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 text-[10px] font-semibold leading-relaxed text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{text}<InfoHint text={hint} label={hint} triggerClassName="inline-flex h-4 w-4 items-center justify-center rounded-full text-amber-700 dark:text-amber-300" /></span>
}

function ListSkeleton({ loadingText }: { loadingText: string }) {
  return <ul className="min-w-0 divide-y" aria-busy="true" data-inventory-check-skeleton>
    <li className="sr-only" role="status" data-inventory-check-loading>{loadingText}</li>
    {[0, 1, 2, 3, 4].map(row => <li key={row} className="flex items-start gap-2 py-2" aria-hidden="true">
      <div className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-gray-200 dark:bg-zinc-700" />
      <div className="min-w-0 flex-1 space-y-1.5"><div className="h-3 w-2/3 animate-pulse rounded bg-gray-200 dark:bg-zinc-700" /><div className="h-3 w-1/2 animate-pulse rounded bg-gray-100 dark:bg-zinc-800" /></div>
    </li>)}
  </ul>
}

function InventoryWorkspace({ access, selection, onSelect, isCurrent }: { access: InventoryCheckAccess; selection: Selection; onSelect: (selection: Selection) => void; isCurrent: () => boolean }) {
  const { t, user, canWriteToServer, navigateTo } = useApp() as AppContextCoreValue
  const { branchId, sessionId } = selection
  const bootstrapIntent = selection.bootstrapIntent
  const tr = (key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }
  const [section, setSection] = useHubSection<Section>('inventory', () => 'products', ['products', 'sessions', 'issues'], navigateTo)
  const [range, setRange] = useState<DateTimeRange>(() => bootstrapIntent?.range ?? statsPresetRange('all'))
  const [sessionRange, setSessionRange] = useState<DateTimeRange>(() => statsPresetRange('all'))
  const [sessionFilters, setSessionFilters] = useState<SessionListFilters>(initialSessionFilters)
  const [query, setQuery] = useState(bootstrapIntent?.query ?? '')
  const [showCustomerRanking, setShowCustomerRanking] = useState(bootstrapIntent?.showCustomerRanking ?? false)
  const [filters, setFilters] = useState<InventoryCheckFilters>({ ...(bootstrapIntent?.filters ?? initialFilters), branchId })
  const [pagination, setPagination] = useState<{ section: Section; page: number }>(bootstrapIntent?.pagination ?? { section, page: 1 })
  const page = pagination.section === section ? pagination.page : 1
  const setPage = (value: number) => setPagination({ section, page: value })
  const [pageSize, setPageSize] = useState(bootstrapIntent?.pageSize ?? 20)
  const [refresh, setRefresh] = useState(0)
  const [data, setData] = useState<ProductsResult | null>(null)
  const [session, setSession] = useState<InventoryCheckSession | null>(null)
  const [items, setItems] = useState<InventoryCheckSessionItem[]>([])
  const [sessions, setSessions] = useState<{ items: InventoryCheckSession[]; total: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [writeError, setWriteError] = useState('')
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [editingRows, setEditingRows] = useState<Record<string, boolean>>({})
  const onEditingChange = useCallback((productId: number | string, editing: boolean) => {
    const id = String(productId)
    setEditingRows(previous => {
      if ((previous[id] === true) === editing) return previous
      if (editing) return { ...previous, [id]: true }
      const next = { ...previous }; delete next[id]; return next
    })
  }, [])
  const [detail, setDetail] = useState<InventoryCheckProduct | null>(null)
  const [historyPage, setHistoryPage] = useState<number | null>(null)
  const [historyReload, setHistoryReload] = useState(0)
  const [history, setHistory] = useState<InventoryCheckHistoryResult | null>(null)
  const [historyError, setHistoryError] = useState('')
  const mounted = useRef(true)
  const inFlight = useRef(false)
  const attempts = useRef(new Map<number, Attempt>())
  const createAttempt = useRef<{ title: string; productIds: number[]; scope: QueryParams; requestId: string } | null>(null)
  const lifecycleAttempt = useRef<{ action: 'close' | 'resume'; revision: number; requestId: string } | null>(null)
  const [writeScope] = useState(() => captureInventoryCheckWriteScope({ branchId, sessionId, epoch: 0 }, () => mounted.current && isCurrent()))
  const current = () => mounted.current && isCurrent() && isActorReadScopeCurrent(writeScope.readScope, false) && isActorWriteIdentityCurrent(writeScope.writeIdentity)
  const { askToConfirm, confirmDialog } = useConfirmDialog(t)
  const params: QueryParams = { ...filters, ...continuousRangeParams(range), query, page, pageSize, sessionId, state: section === 'issues' ? 'issue' : filters.state, ...(showCustomerRanking && access.canViewCustomerDetails ? { customerRanking: '1' } : {}) }
  const sessionParams: QueryParams = { branchId, page, pageSize, ...(sessionFilters.status ? { status: sessionFilters.status } : {}), ...(sessionFilters.mine ? { mine: 1 } : {}), ...(sessionRange.startDate ? { startDate: sessionRange.startDate } : {}), ...(sessionRange.endDate ? { endDate: sessionRange.endDate } : {}) }
  // scopeKey identifies WHAT is listed (filters, page, section); requestKey also changes on every refresh bump.
  // Rows stay fresh for as long as the listed scope is the loaded one, so a refresh of the same scope (after a save,
  // Close/Resume or the Refresh button) reloads in the background while the existing rows stay mounted.
  const scopeKey = JSON.stringify([section === 'sessions' ? sessionParams : params, section])
  const requestKey = JSON.stringify([section === 'sessions' ? sessionParams : params, section, refresh])
  const queryFence = useRef(requestKey)
  queryFence.current = requestKey
  const [loadedKey, setLoadedKey] = useState('')
  const fresh = loadedKey === scopeKey
  // The server's own verdict (can_edit) can only narrow what this account's role and ownership allow here.
  const canEdit = access.canCheck && !!session && session.can_edit !== false && (isAdminControlUser(user) || Number(session.created_by) === Number(user?.id))
  const canViewCounts = access.fields.stock || (!!session && Number(session.created_by) === Number(user?.id))

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (historyPage === null || !sessionId) return
    const abort = new AbortController()
    let live = true
    setHistory(null); setHistoryError('')
    void readInventoryCheckHistory<InventoryCheckHistoryResult>(sessionId, { page: historyPage, pageSize: 20 }, abort.signal).then(result => {
      if (live && current()) setHistory(result)
    }).catch(() => { if (live && current()) setHistoryError(tr('inventory_check_load_failed', 'Inventory checks are unavailable. Reload to try again.')) })
    return () => { live = false; abort.abort() }
  }, [historyPage, sessionId, historyReload])
  useEffect(() => {
    const abort = new AbortController()
    let live = true
    const publish = () => live && !abort.signal.aborted && current() && queryFence.current === requestKey
    const backgroundReload = loadedKey === scopeKey
    if (!backgroundReload) { setLoading(true); setDetail(null) }
    setError('')
    async function load() {
      try {
        if (section === 'sessions') {
          const result = await readInventoryCheckSessions(sessionParams, abort.signal)
          if (publish()) { setSessions(result); setLoadedKey(scopeKey) }
        } else {
          const [products, selected] = await Promise.all([
            readInventoryCheckProducts<ProductsResult>(params, abort.signal),
            sessionId ? readInventoryCheckSession(sessionId, abort.signal) : Promise.resolve(null),
          ])
          if (publish()) {
            if (!branchId && !sessionId && products.branches?.length === 1) {
              onSelect({ branchId: String(products.branches[0].id), sessionId: '', bootstrapIntent: { range: { ...range }, query, filters: { ...filters }, pagination: { ...pagination }, pageSize, showCustomerRanking } })
              return
            }
            setData(showCustomerRanking && access.canViewCustomerDetails ? products : { ...products, rankings: { products: products.rankings?.products } })
            setSession(selected?.item ?? null)
            setItems(selected?.items ?? [])
            setLoadedKey(scopeKey)
          }
        }
      } catch {
        if (publish()) setError(tr('inventory_check_load_failed', 'Inventory checks are unavailable. Reload to try again.'))
      } finally { if (publish()) setLoading(false) }
    }
    void load()
    return () => { live = false; abort.abort() }
  }, [requestKey])

  function changeFilters(patch: Partial<InventoryCheckFilters>) {
    if (controlsLocked) return
    if (patch.branchId !== undefined && patch.branchId !== branchId) { onSelect({ branchId: patch.branchId, sessionId: '' }); return }
    setFilters(previous => ({ ...previous, ...patch })); setPage(1)
  }
  function changeSessionFilters(patch: Partial<SessionListFilters>) {
    if (controlsLocked) return
    setSessionFilters(previous => ({ ...previous, ...patch })); setPage(1)
  }
  // Clears search, dates and every Filters-menu choice. A chosen branch is a selection, so clearing it re-selects "all branches".
  function clearFilters() {
    if (controlsLocked) return
    if (branchId && branches.length > 1) { onSelect({ branchId: '', sessionId: '' }); return }
    if (section === 'sessions') { setSessionFilters(initialSessionFilters); setSessionRange(statsPresetRange('all')) } else {
      setFilters(previous => ({ ...initialFilters, branchId: previous.branchId, sortBy: previous.sortBy, sortDirection: previous.sortDirection }))
      setQuery(''); setRange(statsPresetRange('all'))
    }
    setPage(1)
  }

  async function save(productId: number | string, patch: InventoryCheckPatch, revision: number) {
    if (!current() || queryFence.current !== requestKey || !fresh || !canEdit || session?.status !== 'open' || !canWriteToServer || inFlight.current || lifecycleAttempt.current) throw new Error('Check cannot be saved in this context.')
    const id = Number(productId)
    if (items.find(item => Number(item.product_id) === id)?.current_product_available === false) throw new Error('This original session product is unavailable.')
    let attempt = attempts.current.get(id)
    if (attempt && (JSON.stringify(attempt.patch) !== JSON.stringify(patch) || attempt.revision !== revision)) throw new Error('Resolve the previous save before changing this check.')
    if (!attempt) {
      attempt = { productId: id, patch: { ...patch }, revision, sessionRevision: session.revision, requestId: createClientRequestId('inventory_check') }
      attempts.current.set(id, attempt)
    }
    inFlight.current = true; setBusy(true); setSavingId(id); setRowErrors(previous => ({ ...previous, [id]: '' }))
    try {
      const result = await saveInventoryCheckObservation(writeScope, id, attempt.patch, attempt.revision, attempt.sessionRevision, attempt.requestId)
      if (current()) {
        attempts.current.delete(id)
        setSession(result.session)
        setItems(previous => previous.map(item => Number(item.product_id) === id ? result.item : item))
        setRefresh(value => value + 1)
      }
    } catch (cause) {
      const refusal = (cause as { outcome?: string })?.outcome === 'unknown' ? undefined : knownRefusal(cause)
      if (refusal) attempts.current.delete(id)
      if (current()) setRowErrors(previous => ({ ...previous, [id]: refusal ? tr(refusal.key, refusal.fallback) : tr((cause as { outcome?: string })?.outcome === 'unknown' ? 'inventory_check_save_unknown' : 'inventory_check_save_failed', (cause as { outcome?: string })?.outcome === 'unknown' ? 'Save not confirmed. Retry the same check to recover its receipt.' : 'Check not saved. Retry the same check or reload this session.') }))
      throw cause
    } finally { inFlight.current = false; if (current()) { setBusy(false); setSavingId(null) } }
  }

  // The products a new session would hold: the checkable rows of the page on screen (unchanged membership rule).
  const countableIds = fresh && data ? [...new Set(data.items.filter(product => !product.is_group && (product as InventoryCheckProduct & { checkable?: boolean }).checkable !== false).map(product => Number(product.id)))].filter(id => Number.isSafeInteger(id) && id > 0) : []
  const branches = data?.branches ?? []
  const branchName = branches.find(branch => String(branch.id) === (session ? String(session.branch_id) : branchId))?.name ?? null

  async function start() {
    if (!current() || !fresh || !access.canCheck || !canWriteToServer || !branchId || sessionId || !data || inFlight.current || rowEditing) return
    if (!createAttempt.current) {
      const productIds = countableIds
      if (!productIds.length || productIds.length > 500) return
      // The review shows exactly the ids that will be created; a retry after an unknown outcome reuses the frozen request below.
      const scopeText = describeCountScope(t, { query, range, filters, stateApplies: section !== 'issues' })
      const confirmed = await askToConfirm({
        title: tr('inventory_check_count_review_title', 'Start a count session?'),
        items: [{ label: t('products'), value: productIds.length }, { label: t('branch'), value: branchName ?? '—' }, { label: t('filters'), value: scopeText || t('none') }],
        confirmLabel: tr('inventory_check_start_page', 'Count'),
      })
      if (!confirmed || !current() || inFlight.current) return
      createAttempt.current = { title: tr('inventory_check_page_session', 'Visible page check'), productIds, scope: { ...params, customerRanking: undefined, membership: 'visible_page' }, requestId: createClientRequestId('inventory_check') }
    }
    inFlight.current = true; setBusy(true); setWriteError('')
    try {
      const result = await createInventoryCheckSession(writeScope, createAttempt.current)
      if (current()) onSelect({ branchId, sessionId: result.item.id })
    } catch (cause) {
      const refusal = (cause as { outcome?: string })?.outcome === 'unknown' ? undefined : knownRefusal(cause)
      if (refusal) createAttempt.current = null
      if (current()) setWriteError(refusal ? tr(refusal.key, refusal.fallback) : tr((cause as { outcome?: string })?.outcome === 'unknown' ? 'inventory_check_save_unknown' : 'inventory_check_save_failed', 'Save not confirmed. Retry the same operation or reload.'))
    } finally { inFlight.current = false; if (current()) setBusy(false) }
  }

  async function lifecycle() {
    if (!current() || !canEdit || !canWriteToServer || !session || inFlight.current || rowEditing) return
    if (!lifecycleAttempt.current) {
      if (session.status === 'open') {
        const counts = progress
        const confirmed = await askToConfirm({
          title: tr('inventory_check_close_review_title', 'Close this count session?'),
          message: sessionDisplayName(session, branchName),
          items: [
            { label: t('products'), value: counts.total }, { label: tr('inventory_check_done', 'Done'), value: counts.done },
            { label: tr('inventory_check_issue', 'Issue'), value: counts.issue }, { label: tr('inventory_check_unstarted', 'Not started'), value: counts.unstarted },
          ],
          confirmLabel: tr('inventory_check_close_session', 'Close session'),
        })
        if (!confirmed || !current() || inFlight.current) return
      }
      lifecycleAttempt.current = { action: session.status === 'open' ? 'close' : 'resume', revision: session.revision, requestId: createClientRequestId('inventory_check') }
    }
    const attempt = lifecycleAttempt.current
    inFlight.current = true; setBusy(true); setWriteError('')
    try {
      const result = await changeInventoryCheckSession(writeScope, attempt.action, attempt.revision, attempt.requestId)
      if (current()) { lifecycleAttempt.current = null; setSession(result.item); setRefresh(value => value + 1) }
    } catch (cause) {
      const refusal = (cause as { outcome?: string })?.outcome === 'unknown' ? undefined : knownRefusal(cause)
      if (refusal) lifecycleAttempt.current = null
      if (current()) setWriteError(refusal ? tr(refusal.key, refusal.fallback) : tr((cause as { outcome?: string })?.outcome === 'unknown' ? 'inventory_check_save_unknown' : 'inventory_check_save_failed', 'Save not confirmed. Retry the same operation or reload.'))
    } finally { inFlight.current = false; if (current()) setBusy(false) }
  }

  const unavailableMembers = fresh && sessionId ? items.filter(item => item.current_product_available === false) : []
  const unavailableIds = new Set(unavailableMembers.map(item => String(item.product_id)))
  const renamedMembers = new Map(fresh && sessionId ? items.filter(item => item.current_product_available === true && item.current_product_name && item.current_product_name !== item.product_snapshot.name).map(item => [String(item.product_id), item]) : [])
  const visibleProducts = fresh ? (data?.items ?? []).filter(product => !unavailableIds.has(String(product.id))).map(product => projectProduct(product, access.fields)) : []
  const unavailableProducts = unavailableMembers.map(item => ({ ...projectProduct(item.product_snapshot, access.fields), id: item.product_id, quantity: null, damaged_quantity: null, qty_sold: null, customer_count: null, selling_price_usd: null, cost_price_usd: null, checkable: false }))
  const observations: Record<string, InventoryCheckObservation> = {}
  if (fresh) for (const item of items) observations[String(item.product_id)] = { product_id: item.product_id, state: item.state, counted_quantity: canViewCounts ? item.counted_quantity : null, reason: item.reason, revision: item.revision, ...(access.fields.stock ? { baseline_quantity: item.baseline_quantity, current_quantity: item.current_quantity, stock_changed: item.stock_changed } : {}) }
  // Row badges: renamed originals keep their current row (the starting name is behind the hint); unavailable originals sit read-only below.
  const adornments: Record<string, ReactNode> = {}
  for (const [id, item] of renamedMembers) adornments[id] = <RowBadge text={tr('inventory_check_renamed_badge', 'Renamed')} hint={`${tr('inventory_check_original_name', 'Starting name')}: ${item.product_snapshot.name} · ${tr('inventory_check_current_name', 'Current name')}: ${item.current_product_name}`} />
  const unavailableAdornments = Object.fromEntries(unavailableMembers.map(item => [String(item.product_id), <RowBadge key="unavailable" text={tr('inventory_check_unavailable_badge', 'Unavailable')} hint={tr('inventory_check_unavailable_member_hint', 'This original product is unavailable. Its saved check remains read-only.')} />]))
  const frozen = Object.fromEntries([...attempts.current.values()].map(attempt => [String(attempt.productId), { patch: attempt.patch, revision: attempt.revision }]))
  const cards: StatCardDef[] = []
  const stat = (key: string, label: string, allowed = true) => {
    const value = fresh ? data?.stats?.[key] : undefined
    if (allowed) cards.push({ key, label, value: value == null ? '—' : value })
  }
  stat('total_products', t('products'))
  stat('stock_quantity', tr('inventory_check_current_stock', 'Current stock'), access.fields.stock)
  stat('low_stock', t('low_stock'), access.fields.stock)
  stat('out_of_stock', t('out_of_stock'), access.fields.stock)
  stat('qty_sold', tr('inventory_check_period_sales', 'Period sales'), access.fields.sales)
  stat('unique_customer_count', tr('inventory_check_period_customers', 'Period customers'), access.fields.customers)
  const productRanking = fresh && access.fields.sales ? data?.rankings?.products ?? [] : []
  if (access.fields.sales) cards.push({ key: 'top_products', label: t('top_products'), value: <span className="block truncate text-xs">{productRanking[0]?.name || '—'}</span>, hint: tr('inventory_check_cohort_hint', 'Received dates select products; sales and customers use the same period. Stock is current.'), details: productRanking.map(product => ({ label: product.name, value: product.qty_sold })) })
  const customerRanking = fresh && showCustomerRanking && access.canViewCustomerDetails ? data?.rankings?.customers ?? [] : []
  if (showCustomerRanking && access.canViewCustomerDetails) cards.push({ key: 'top_customers', label: t('top_customers'), value: <span className="block truncate text-xs">{customerRanking[0]?.name || '—'}</span>, hint: tr('inventory_check_cohort_hint', 'Received dates select products; sales and customers use the same period. Stock is current.'), details: customerRanking.map(customer => ({ label: customer.name, value: customer.sale_count })) })
  const rowEditing = Object.values(editingRows).some(Boolean)
  const controlsLocked = busy || !!createAttempt.current || rowEditing

  // Session bar facts. The single-session read sends no creator name or branch name: the list's creator rides in the
  // selection, the viewer's own username covers their own sessions, and the branch comes from the branch list.
  const progress = session?.progress ?? { total: items.length, done: items.filter(item => item.state === 'done').length, issue: items.filter(item => item.state === 'issue').length, unstarted: items.filter(item => item.state === 'unstarted').length }
  const ownSession = !!session && Number(session.created_by) === Number(user?.id)
  const creatorName = session?.creator_name ?? selection.creatorName ?? (ownSession ? String(user?.username || '') : '')

  // Count: why it is unavailable is the answer to "why can't I press it".
  const countBlocked = busy || rowEditing ? tr('inventory_check_count_blocked_busy', 'Finish or cancel the open check first.')
    : !fresh ? tr('inventory_check_count_blocked_loading', 'Wait for the list to finish loading.')
    : !canWriteToServer ? tr('inventory_check_count_blocked_offline', 'Saving is unavailable while offline.')
    : !branchId ? tr('inventory_check_count_blocked_branch', 'Choose a branch first.')
    : !countableIds.length ? tr('inventory_check_count_blocked_empty', 'No products on this page to count.') : ''
  const countLabel = createAttempt.current ? t('retry') : tr('inventory_check_start_page', 'Count')
  const filtersActive = countActiveFilters(filters, { branch: branches.length > 1, state: section !== 'issues' }) > 0 || !!query.trim() || !!(range.startDate || range.endDate)
  const sessionFiltersActive = !!(sessionFilters.status || sessionFilters.mine || sessionRange.startDate || sessionRange.endDate || (branches.length > 1 && !!branchId))
  const loadedNothing = !loading && fresh && !unavailableProducts.length && !(section === 'sessions' ? sessions?.items.length : section === 'issues' && !sessionId ? data?.issues?.length : visibleProducts.length)

  const rangeNotes = <span className="flex shrink-0 items-center">
    <InfoHint text={tr('inventory_check_cohort_hint', 'Received dates select products; sales and customers use the same period. Stock is current.')} label={tr('inventory_check_cohort_hint', 'Received dates select products; sales and customers use the same period. Stock is current.')} />
    {access.fields.received ? null : <InfoHint text={tr('inventory_check_date_hidden_hint', 'Received dates are hidden for your role.')} label={tr('inventory_check_date_hidden_hint', 'Received dates are hidden for your role.')} />}
  </span>
  const customerToggle = access.canViewCustomerDetails ? <button type="button" className={`${toolbarIconButtonClassName} shrink-0 border border-slate-200 disabled:opacity-50 dark:border-slate-700 ${showCustomerRanking ? '!bg-slate-800 !text-white dark:!bg-slate-200 dark:!text-slate-900' : ''}`} aria-pressed={showCustomerRanking} aria-label={t('top_customers')} title={t('top_customers')} disabled={controlsLocked} onClick={() => {
    setShowCustomerRanking(value => !value)
    setData(previous => previous ? { ...previous, rankings: { products: previous.rankings?.products } } : previous)
  }}><Users className="h-4 w-4" aria-hidden="true" /></button> : null
  const facetsLimited = fresh && Object.values(data?.facetsLimited ?? {}).some(Boolean)

  const issueRows = section === 'issues' && !sessionId && fresh ? (data?.issues ?? []).map(issue => {
    const product = visibleProducts.find(candidate => Number(candidate.id) === issue.product_id) ?? { id: issue.product_id, name: `#${issue.product_id}` }
    const showCount = (access.fields.stock || Number(issue.created_by) === Number(user?.id)) && typeof issue.counted_quantity === 'number' && Number.isFinite(issue.counted_quantity)
    const issueBranch = branches.find(branch => branch.id === issue.branch_id)?.name
    const open = tr('inventory_check_open_session', 'Open session')
    return { key: `${issue.session_id}:${issue.product_id}`, product, observation: { product_id: issue.product_id, state: 'issue' as const, counted_quantity: showCount ? issue.counted_quantity ?? null : null, reason: issue.reason, revision: issue.revision },
      chip: <button type="button" className="inline-flex min-h-6 max-w-full items-center gap-1 rounded-full bg-slate-100 px-2 text-[11px] font-semibold leading-relaxed text-slate-700 dark:bg-zinc-800 dark:text-slate-200" aria-label={issueBranch ? `${open}: ${issueBranch}` : open} title={open} onClick={() => onSelect({ branchId: String(issue.branch_id), sessionId: issue.session_id })}><ClipboardList className="h-3 w-3 shrink-0" aria-hidden="true" />{issueBranch ? <span className="min-w-0 break-words">{issueBranch}</span> : null}</button> }
  }) : []
  const rowProps = { canViewStock: access.fields.stock, canViewCounts, canViewPrice: access.fields.price, canViewCost: access.fields.cost, t, onOpenProduct: setDetail } as const

  return <div className="page-scroll min-w-0 space-y-2 p-3" data-inventory-check-page>
    <HubSectionNav pageId="inventory" active={section} sections={[
      { id: 'products', label: t('products') }, { id: 'sessions', label: t('inventory_check_sessions') }, { id: 'issues', label: t('issues') },
    ]} onChange={id => { if (!busy && !createAttempt.current) setSection(id as Section) }} />
    {/* Pinned: dates (with the Stats chip), then search / scan / Filters, then the sort row. Open stat cards scroll inside the cap. */}
    <div className="sticky top-0 z-30 -mx-3 max-h-[calc(70*var(--app-vh))] min-w-0 space-y-1 overflow-y-auto bg-gray-50 px-3 pb-1 dark:bg-gray-900" data-inventory-check-pinned>
      {section === 'sessions'
        ? <StatsRangeRow layout="scroll" compactRange range={sessionRange} disabled={controlsLocked} t={t} onRangeChange={value => { if (!controlsLocked) { setSessionRange(value); setPage(1) } }} />
        : <StatsStrip layout="scroll" compactRange cards={cards} t={t} loading={loading} range={range} rangeDisabled={!access.fields.received || controlsLocked} rangeActions={rangeNotes}
          onRangeChange={value => { if (!controlsLocked) { setRange(value); setPage(1) } }} />}
      <fieldset disabled={controlsLocked} className="min-w-0" data-inventory-check-query-lock>
        {section === 'sessions'
          ? <InventoryCheckSessionFilterMenu value={sessionFilters} onChange={changeSessionFilters} branches={branches} branchId={branchId} onBranchChange={id => changeFilters({ branchId: id })} onClear={clearFilters} t={t} />
          : <InventoryCheckControls query={query} onQueryChange={value => { if (!controlsLocked) { setQuery(value); setPage(1) } }} filters={filters} onFiltersChange={changeFilters} onClear={clearFilters} fields={access.fields}
            showSessionStates={!!sessionId} showStateFilter={section !== 'issues'} optionsLimited={facetsLimited} trailing={customerToggle}
            branches={branches} brands={data?.facets?.brands} categories={data?.facets?.categories} reasons={data?.facets?.reasons} t={t} />}
      </fieldset>
    </div>
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-inventory-check-actions>
      {sessionId ? <>
        <IconAction label={tr('inventory_check_leave_session', 'Leave session')} disabled={controlsLocked} onClick={() => onSelect({ branchId, sessionId: '' })}><ArrowLeft className="h-5 w-5" aria-hidden="true" /></IconAction>
        {session && fresh ? <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1" data-inventory-check-session-bar>
          <span className="font-semibold">{fmtDateTime24(session.started_at)}</span>
          {branchName ? <span className="detail-scroll-text min-w-0 leading-relaxed">{branchName}</span> : null}
          {creatorName ? <span className="text-gray-500" title={tr('inventory_check_created_by', 'Created by')}>@{creatorName}</span> : null}
          <SessionStatusChip status={session.status} t={t} />
          {!canEdit ? <span className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 px-2 text-[11px] font-semibold leading-relaxed text-gray-600 dark:bg-zinc-800 dark:text-gray-300">{t('view_only')}<InfoHint text={tr('inventory_check_read_only_hint', 'You can view this session. Only its creator or an administrator can change it.')} label={tr('inventory_check_read_only_hint', 'You can view this session. Only its creator or an administrator can change it.')} /></span> : null}
          <SessionCounts progress={progress} t={t} />
        </div> : <span className="h-4 w-40 flex-1 animate-pulse rounded bg-gray-200 dark:bg-zinc-700" aria-hidden="true" />}
        <IconAction label={t('history')} onClick={() => setHistoryPage(1)}><History className="h-5 w-5" aria-hidden="true" /></IconAction>
        {canEdit && fresh ? <IconAction label={lifecycleAttempt.current ? t('retry') : session?.status === 'open' ? tr('inventory_check_close_session', 'Close session') : tr('inventory_check_resume_session', 'Resume session')}
          disabled={controlsLocked || !canWriteToServer || attempts.current.size > 0} onClick={() => { void lifecycle() }}>
          {lifecycleAttempt.current ? <RotateCcw className="h-5 w-5" aria-hidden="true" /> : session?.status === 'open' ? <Lock className="h-5 w-5" aria-hidden="true" /> : <Unlock className="h-5 w-5" aria-hidden="true" />}
        </IconAction> : null}
      </> : section !== 'sessions' && access.canCheck ? <>
        <button type="button" className="btn-primary inline-flex min-h-10 items-center gap-1 px-3 text-xs aria-disabled:cursor-not-allowed aria-disabled:opacity-60" aria-disabled={countBlocked ? true : undefined} title={countBlocked || tr('inventory_check_count_tooltip', 'Count the products listed on this page')}
          onClick={() => { if (!countBlocked) void start() }}><Play className="h-4 w-4" aria-hidden="true" />{countLabel}</button>
        {countBlocked ? <InfoHint text={countBlocked} label={countBlocked} /> : null}
      </> : null}
      <span className="ml-auto flex items-center"><IconAction label={t('refresh')} disabled={controlsLocked} onClick={() => setRefresh(value => value + 1)}><RefreshCw className="h-5 w-5" aria-hidden="true" /></IconAction></span>
    </div>
    {writeError ? <p role="alert" className="text-xs leading-relaxed text-red-700">{writeError}</p> : null}
    {error ? <div role="alert" className="flex items-center justify-between gap-2 text-xs leading-relaxed text-red-700">
      <span className="min-w-0 break-words">{error}</span>
      <IconAction label={t('retry')} onClick={() => setRefresh(value => value + 1)}><RotateCcw className="h-4 w-4" aria-hidden="true" /></IconAction>
    </div> : null}
    {loading && !fresh && !error ? <ListSkeleton loadingText={t('loading')} /> : null}
    {section === 'sessions' ? (fresh && sessions?.items.length ? <InventoryCheckSessionsList items={sessions.items} t={t} onOpen={item => { setSection('products'); onSelect({ branchId: String(item.branch_id), sessionId: item.id, creatorName: item.creator_name ?? null }) }} /> : null)
      : section === 'issues' && !sessionId ? <div className="min-w-0 divide-y" aria-label={t('issues')}>
        {issueRows.map(row => <InventoryCheckRows key={row.key} products={[row.product]} observations={{ [String(row.product.id)]: row.observation }} adornments={{ [String(row.product.id)]: row.chip }} canCheck={false} {...rowProps} onSave={() => { throw new Error('Open the session to change this check.') }} />)}
      </div>
        : <InventoryCheckRows key={scopeKey} products={visibleProducts} observations={observations} errors={rowErrors} adornments={adornments} frozen={frozen} pending={Object.fromEntries(visibleProducts.map(product => [String(product.id), savingId === Number(product.id)]))} locked={busy} canCheck={fresh && canEdit && session?.status === 'open' && canWriteToServer && !lifecycleAttempt.current} {...rowProps} onEditingChange={onEditingChange} onSave={save} />}
    {section !== 'sessions' && unavailableProducts.length ? <InventoryCheckRows products={unavailableProducts} observations={observations} adornments={unavailableAdornments} canCheck={false} {...rowProps} canViewPrice={false} canViewCost={false} onSave={() => { throw new Error('This original session product is unavailable.') }} /> : null}
    {loadedNothing ? <div className="flex min-w-0 flex-col items-center gap-2 py-6 text-center text-xs text-gray-500" data-inventory-check-empty={section}>
      <p className="break-words leading-relaxed">{section === 'sessions' ? (sessionFiltersActive ? tr('inventory_check_sessions_no_match', 'No count sessions match these filters.') : tr('inventory_check_sessions_empty', 'No count sessions yet.'))
        : section === 'issues' ? tr('inventory_check_issues_empty', 'No issues found.') : tr('inventory_check_empty', 'No matching products.')}</p>
      {(section === 'sessions' ? sessionFiltersActive : filtersActive) ? <button type="button" className="btn-secondary min-h-10 px-3 text-xs" disabled={controlsLocked} onClick={clearFilters}>{t('clear_filters')}</button>
        : section === 'sessions' && access.canCheck ? <button type="button" className="btn-primary inline-flex min-h-10 items-center gap-1 px-3 text-xs" title={tr('inventory_check_count_tooltip', 'Count the products listed on this page')} onClick={() => setSection('products')}><Play className="h-4 w-4" aria-hidden="true" />{tr('inventory_check_start_page', 'Count')}</button> : null}
    </div> : null}
    {fresh ? <fieldset disabled={controlsLocked} className="min-w-0" data-inventory-check-pager-lock><PaginationControls page={page} pageSize={pageSize} totalItems={(section === 'sessions' ? sessions?.total : data?.total) ?? 0} onPageChange={value => { if (!controlsLocked) setPage(value) }} onPageSizeChange={value => { if (!controlsLocked) { setPageSize(value); setPage(1) } }} t={t} compact /></fieldset> : null}
    {detail && fresh ? <Modal title={detail.name} onClose={() => setDetail(null)} keyboard size="sm" unsavedChanges="read-only"><dl className="grid grid-cols-2 gap-2 text-xs">
      {unavailableIds.has(String(detail.id)) ? <p className="col-span-2 text-amber-800 dark:text-amber-200">{t('inventory_check_unavailable_member_hint')}</p> : null}
      {access.fields.barcode ? <><dt>{t('barcode')}</dt><dd className="break-all">{detail.barcode || detail.sku || '—'}</dd></> : null}
      {access.fields.stock ? <><dt>{tr('inventory_check_current_stock', 'Current stock')}</dt><dd>{detail.quantity ?? '—'}</dd><dt>{tr('inventory_check_starting_stock', 'Starting stock')}</dt><dd>{items.find(item => String(item.product_id) === String(detail.id))?.baseline_quantity ?? '—'}</dd></> : null}
      {access.fields.brand ? <><dt>{t('brand')}</dt><dd>{detail.brand || '—'}</dd></> : null}
      {access.fields.category ? <><dt>{t('category')}</dt><dd>{detail.category || '—'}</dd></> : null}
      {access.fields.stock && items.find(item => String(item.product_id) === String(detail.id))?.stock_changed ? <p className="col-span-2 text-amber-700">{tr('inventory_check_stock_changed', 'Stock changed since this session started.')}</p> : null}
    </dl></Modal> : null}
    {historyPage !== null ? <InventoryCheckHistoryFloat page={historyPage} history={history} error={historyError} onPage={setHistoryPage} onRetry={() => setHistoryReload(value => value + 1)} onClose={() => setHistoryPage(null)} t={t} /> : null}
    {confirmDialog}
  </div>
}
