import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js'
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js'
import Eye from 'lucide-react/dist/esm/icons/eye.js'
import History from 'lucide-react/dist/esm/icons/history.js'
import Lock from 'lucide-react/dist/esm/icons/lock.js'
import Play from 'lucide-react/dist/esm/icons/play.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import Unlock from 'lucide-react/dist/esm/icons/unlock.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { useApp, type AppContextCoreValue } from '../../app/AppContextCore.tsx'
import { captureActorReadScope, captureActorWriteIdentity, isActorReadScopeCurrent, isActorWriteIdentityCurrent } from '../../api/actorReadScope.ts'
import { captureInventoryCheckWriteScope, changeInventoryCheckSession, createInventoryCheckSession, decideInventoryCheckApproval, readInventoryCheckHistory, readInventoryCheckProducts, readInventoryCheckSession, readInventoryCheckSessions, saveInventoryCheckObservation, submitInventoryCheckCounts, type InventoryCheckApproval, type InventoryCheckSession, type InventoryCheckSessionItem } from '../../api/inventoryChecksTransport.ts'
import type { QueryParams } from '../../api/query.ts'
import { createClientRequestId } from '../../api/requestIds.ts'
import { getInventoryCheckAccess, type InventoryCheckAccess } from '../../utils/inventoryCheckAccess.ts'
import { effectivePermissions, isAdminControlUser } from '../../utils/permissions.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { readWorkDraft, scopedWorkDraftKey } from '../../utils/workDrafts.ts'
import { getDirtyWork, registerDirtyWork } from '../../utils/dirtyWork.ts'
import { fmtDateTime24 } from '../../utils/formatters.ts'
import { isExactBarcodeHit } from '../../utils/scanExactHit.ts'
import { foldNativeDigits } from '../../utils/searchMatch.ts'
import { useSavedStockReasons } from '../../utils/useSavedStockReasons.ts'
import { useIsCompactViewport } from '../../utils/useViewport.ts'
import type { InventoryCheckListStatus, InventoryCheckObservation, InventoryCheckPatch, InventoryCheckProduct } from '../../types/inventoryChecks.ts'
import InventoryCheckControls, { countActiveFilters, type InventoryCheckFilters } from './InventoryCheckControls.tsx'
import InventoryCheckRows, { InventoryCheckSheetHeader, type InventoryCheckFocusRequest } from './InventoryCheckRows.tsx'
import InventoryCheckListRows, { InventoryCheckListHeader, InventoryCheckSelectionBar, type ListDraft } from './InventoryCheckListRows.tsx'
import { finiteQuantity, parseCount } from './InventoryCheckCountEditor.tsx'
import InventoryCheckDetailFloat from './InventoryCheckDetailFloat.tsx'
import { fixStockOpening, type FixStockOpening } from './inventoryCheckFixStock.ts'
import { oldListDropsStatus, productsServerOf, productsWireParams, type ProductsServer } from './inventoryCheckProductsRequest.ts'
import InventoryCheckApprovalPanel from './InventoryCheckApprovalPanel.tsx'
import { runApprovalFlow } from './inventoryCheckApprovalFlow.ts'
import { productSalesFocus, queueReportsFocus } from '../sales/reports/reportsFocus.ts'
import InventoryCheckHistoryFloat, { type InventoryCheckHistoryResult } from './InventoryCheckHistoryFloat.tsx'
import InventoryCheckSessionsList, { InventoryCheckSessionFilterMenu, ProgressRing, SessionCounts, SessionStatusChip, initialSessionFilters, sessionDisplayName, type SessionListFilters } from './InventoryCheckSessionsList.tsx'
import HubSectionNav from '../shared/HubSectionNav.tsx'
import { hubAnchor, useHubSection } from '../shared/hubNavigation.ts'
import InfoHint from '../shared/InfoHint.tsx'
import SoleBranchLabel from '../shared/SoleBranchLabel.tsx'
import StatsRangeRow from '../shared/StatsRangeRow.tsx'
import StatsStrip, { type StatCardDef } from '../shared/StatsStrip.tsx'
import PaginationControls from '../shared/PaginationControls.tsx'
import { useScannerWedge, type ScanOrigin } from '../shared/useScannerWedge.ts'
import { useConfirmDialog } from '../shared/useConfirmDialog.tsx'
import { toolbarIconButtonClassName } from '../shared/toolbarButtonStyles.ts'
import { statsPresetRange, type DateTimeRange } from '../shared/statsStripPresets.ts'

const FastStockInModal = lazyRetry(() => import('./FastStockInModal.tsx'), 'inventory-check-fix-stock')

type CheckSummary = Record<InventoryCheckListStatus, number> & { total: number }
type ProductsResult = {
  items: InventoryCheckProduct[]; total: number; page: number; pageSize: number; totalPages?: number
  branches: Array<{ id: number; name: string }>
  /** Set when the server speaks the check-status contract (ic_simple): rows carry their check facts and the status filter exists. */
  simple?: boolean
  /** Check counts and filter options come with page 1 and with a filter change, never with a page step (the page keeps the last ones). */
  summary?: CheckSummary
  facets?: { brands?: string[]; categories?: string[] }
  facetsLimited?: { brands: boolean; categories: boolean }
  /** What the server switches on for this answer (ic_fix_stock): Fix stock and the Sales link in the detail float. */
  capabilities?: { fixStock?: boolean; approveCounts?: boolean }
  /** The older list (ic_simple off) answers the all-sessions Issues view with the issues themselves: one per product and session, with the reason, the counted figure and the session. */
  issues?: Array<{ product_id: number; branch_id: number; session_id: string; created_by: number; reason: string | null; revision: number; counted_quantity?: number | null }>
}
/** creatorName rides along from the Sessions list: the single-session read does not send it. */
type Selection = { branchId: string; sessionId: string; creatorName?: string | null; bootstrapIntent?: ControlIntent }
type Section = 'products' | 'sessions' | 'issues'
type ControlIntent = { query: string; filters: InventoryCheckFilters; pagination: { section: Section; page: number }; pageSize: number }
type Attempt = { productId: number; patch: InventoryCheckPatch; revision: number; sessionRevision: number; requestId: string }
/** A search that came from Enter, the camera or a scanner gun. Nothing is ever saved by it: it narrows the list and points at the one exact row. */
type Scan = { token: number; query: string; target: InventoryCheckFocusRequest['target'] }
// Definite server refusals (the request was answered and nothing was written). Each gets its own concise message;
// unlike an unknown outcome, the frozen attempt is dropped so the operator can correct and send a fresh request.
const REFUSAL_MESSAGES: Record<string, { key: string; fallback: string }> = {
  inventory_check_count_requires_issue: { key: 'inventory_check_error_count_requires_issue', fallback: 'Counted quantity differs from stock. Report it as an issue.' },
  inventory_check_baseline_changed: { key: 'inventory_check_error_baseline_changed', fallback: 'Stock or products changed. Reload and try again.' },
  inventory_check_owner_required: { key: 'inventory_check_error_owner_required', fallback: 'Only the session creator or an administrator can change this check.' },
  inventory_check_product_not_eligible: { key: 'inventory_check_error_product_not_eligible', fallback: 'A product on this page cannot be checked. Reload and try again.' },
  inventory_check_stock_changed: { key: 'inventory_check_error_stock_changed', fallback: 'Stock changed after you counted. The list was reloaded: count those products again.' },
  inventory_check_invalid_note: { key: 'inventory_check_error_invalid_note', fallback: 'A note is too long. Shorten it and submit again.' },
  inventory_check_stock_inconsistent: { key: 'inventory_check_error_stock_inconsistent', fallback: 'A product\'s stock records do not add up. Correct them before approving.' },
  inventory_check_product_retired: { key: 'inventory_check_error_product_retired', fallback: 'A product in this count was merged or removed. Reject this count and count the product that replaced it.' },
  inventory_check_count_in_progress: { key: 'inventory_check_error_count_in_progress', fallback: 'An earlier count of a product here is being applied right now, so it cannot be counted again yet. Try again when it is finished.' },
  inventory_check_count_superseded: { key: 'inventory_check_error_count_superseded', fallback: 'Another count already covered a product in this one. Reject this count and recount.' },
  inventory_check_stock_adjusted: { key: 'inventory_check_error_stock_adjusted', fallback: 'Stock was changed by hand after this count. Reject this count and recount.' },
  inventory_check_target_not_whole: { key: 'inventory_check_error_target_not_whole', fallback: 'A counted number is not a whole number. Reject this count and recount.' },
  inventory_check_count_below_damaged: { key: 'inventory_check_error_count_below_damaged', fallback: 'A counted number is less than the product\'s damaged units. Reject this count and recount.' },
  inventory_check_baseline_missing: { key: 'inventory_check_error_baseline_missing', fallback: 'A product in this count has no recorded starting stock. Reject this count and recount.' },
  inventory_check_approval_in_progress: { key: 'inventory_check_error_approval_in_progress', fallback: 'Another approver is applying this count. If they cannot continue, close the remaining lines.' },
  inventory_check_claim_lost: { key: 'inventory_check_error_claim_lost', fallback: 'Another approver took over or closed this count, so nothing was written for this line. The page was reloaded.' },
  inventory_check_no_lot: { key: 'inventory_check_error_no_lot', fallback: 'A product has no received date to add stock to. Receive it first.' },
  inventory_check_stock_write_refused: { key: 'inventory_check_error_write_refused', fallback: 'Stock could not be updated for some products. Try again.' },
  inventory_check_approve_required: { key: 'inventory_check_error_approve_required', fallback: 'You do not have permission to approve counts.' },
  inventory_check_adjust_required: { key: 'inventory_check_error_adjust_required', fallback: 'Approving also needs permission to adjust stock.' },
  inventory_check_self_approval: { key: 'inventory_check_error_self_approval', fallback: 'You submitted this count, so another approver must approve it.' },
  inventory_check_approval_decided: { key: 'inventory_check_error_approval_decided', fallback: 'This count was already decided. The page was reloaded.' },
  inventory_check_approval_partly_applied: { key: 'inventory_check_error_partly_applied', fallback: 'Part of this count was already applied, so it cannot be rejected. Approve it to finish.' },
}
function knownRefusal(cause: unknown) {
  const code = (cause as { code?: unknown } | null)?.code
  return typeof code === 'string' && Object.hasOwn(REFUSAL_MESSAGES, code) ? REFUSAL_MESSAGES[code] : undefined
}
function isStaleConflict(cause: unknown) {
  const { status, code } = (cause ?? {}) as { status?: unknown; code?: unknown }
  return status === 409 && code !== 'inventory_check_owner_required'
}
/** What the list holds for one picked or counted product until Submit: the row's own fields plus the name and the stock the person saw. */
type DraftEntry = ListDraft & { name: string; seen: number | null }
const COUNTS_WORK_KEY = 'inventory-check:counts'
const MAX_SUBMISSION = 500
const initialFilters: InventoryCheckFilters = { branchId: '', stockState: '', checkState: '', brand: '', category: '', sortBy: 'name', sortDirection: 'asc' }
/** Typing waits for a pause this long before the list is read; Enter, the camera and the scanner gun read at once. */
const SEARCH_PAUSE_MS = 300

const atLeast = (width: number) => typeof window.matchMedia === 'function' && window.matchMedia(`(min-width: ${width}px)`).matches
/** Where a scan puts the keyboard: a desktop lands in the row's Count box, a tablet on its tick, a phone only highlights (no keyboard pop-up). */
function scanFocusTarget(canCount: boolean): Scan['target'] {
  return atLeast(1024) ? canCount ? 'count' : 'action' : atLeast(768) ? 'action' : 'none'
}
/** A lone token with a digit in it (Latin or Khmer) is the shape of a barcode or SKU: only such a search is judged as a scan. A name typed and sent with Enter just narrows the list. */
const looksLikeCode = (query: string) => /^\S{4,}$/.test(query.trim()) && /\d/.test(foldNativeDigits(query))
/** The one checkable row a scanned code names, or null. A viewer who cannot see barcodes gets the only row the exact-code search left. */
function scanHitOf(products: readonly InventoryCheckProduct[], query: string, barcodeVisible: boolean): InventoryCheckProduct | null {
  const rows = products.filter(product => !product.is_group && product.checkable !== false)
  const hits = barcodeVisible ? rows.filter(row => isExactBarcodeHit({ barcode: row.barcode }, query) || isExactBarcodeHit({ barcode: row.sku }, query)) : rows
  return hits.length === 1 ? hits[0] : null
}

/** The product as the Set session lists it: ordinary stock in the counted branch (a count includes damaged units, Set does not). */
function fixStockCandidate(opening: FixStockOpening, branchName: string | null) {
  const { product } = opening
  const ordinary = Math.max(0, (Number(product.quantity) || 0) - (Number(product.damaged_quantity) || 0))
  return { id: product.id, name: product.name, barcode: product.barcode ?? null, brand: product.brand ?? null, unit: product.unit ?? null, image_path: product.image_path ?? null,
    stock_quantity: ordinary, branch_stock: [{ branch_id: opening.branchId, branch_name: branchName, quantity: ordinary }] }
}

function projectProduct(product: InventoryCheckProduct, fields: InventoryCheckAccess['fields']): InventoryCheckProduct {
  const visible = { ...product }
  if (!fields.stock) { delete visible.quantity; delete visible.damaged_quantity }
  if (!fields.brand) delete visible.brand
  if (!fields.category) delete visible.category
  if (!fields.barcode) { delete visible.barcode; delete visible.sku }
  return visible
}

/** What a new count session will be taken from, in words: search and every chosen filter. */
function describeCountScope(t: (key: string) => string, args: { query: string; filters: InventoryCheckFilters; stateApplies: boolean }): string {
  const { query, filters } = args
  const stateText: Record<string, string> = { not_checked: t('inventory_check_status_not_checked'), in_check: t('inventory_check_status_in_check'), ok: t('inventory_check_status_ok'), issue: t('issues') }
  const stockText: Record<string, string> = { in_stock: t('in_stock'), low_stock: t('low_stock'), out_of_stock: t('out_of_stock') }
  const parts = [
    query.trim() && `${t('search')}: ${query.trim()}`,
    args.stateApplies && filters.checkState && `${t('inventory_check_state')}: ${stateText[filters.checkState] ?? filters.checkState}`,
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
  const { t, user, canWriteToServer, navigateTo, notify } = useApp() as AppContextCoreValue
  const { branchId, sessionId } = selection
  const bootstrapIntent = selection.bootstrapIntent
  const tr = (key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }
  const compact = useIsCompactViewport()
  const [section, setSection] = useHubSection<Section>('inventory', () => 'products', ['products', 'sessions', 'issues'], navigateTo)
  const [sessionRange, setSessionRange] = useState<DateTimeRange>(() => statsPresetRange('all'))
  const [sessionFilters, setSessionFilters] = useState<SessionListFilters>(initialSessionFilters)
  // `query` is what the box shows; `appliedQuery` is what the server was asked. Typing moves the first and the list follows after a pause.
  const [query, setQuery] = useState(bootstrapIntent?.query ?? '')
  const [appliedQuery, setAppliedQuery] = useState(bootstrapIntent?.query ?? '')
  const [scan, setScan] = useState<Scan | null>(null)
  const scanSeq = useRef(0)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [searchFocus, setSearchFocus] = useState(0)
  const [gunScan, setGunScan] = useState<{ code: string; token: number; origin: ScanOrigin } | null>(null)
  const [filters, setFilters] = useState<InventoryCheckFilters>({ ...(bootstrapIntent?.filters ?? initialFilters), branchId })
  const [pagination, setPagination] = useState<{ section: Section; page: number }>(bootstrapIntent?.pagination ?? { section, page: 1 })
  const page = pagination.section === section ? pagination.page : 1
  const setPage = (value: number) => setPagination({ section, page: value })
  const [pageSize, setPageSize] = useState(bootstrapIntent?.pageSize ?? 20)
  const [refresh, setRefresh] = useState(0)
  const [sessionReload, setSessionReload] = useState(0)
  const [data, setData] = useState<ProductsResult | null>(null)
  // The scope (everything but the page) whose check counts and filter options `data` holds: a page step inside it asks the server to skip them -- but only a server
  // whose last answer was the check-status list (ic_simple), which is also what `productsServer` records: the older list has no counts to skip and refuses the key.
  const summaryScope = useRef('')
  const productsServer = useRef<ProductsServer>('unknown')
  const [session, setSession] = useState<InventoryCheckSession | null>(null)
  const [items, setItems] = useState<InventoryCheckSessionItem[]>([])
  const [approval, setApproval] = useState<InventoryCheckApproval | null>(null)
  const [sessions, setSessions] = useState<{ items: InventoryCheckSession[]; total: number; approvals?: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sessionError, setSessionError] = useState('')
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
  const [fixStock, setFixStock] = useState<FixStockOpening | null>(null)
  const [historyPage, setHistoryPage] = useState<number | null>(null)
  const [historyReload, setHistoryReload] = useState(0)
  const [history, setHistory] = useState<InventoryCheckHistoryResult | null>(null)
  const [historyError, setHistoryError] = useState('')
  const mounted = useRef(true)
  const inFlight = useRef(false)
  const attempts = useRef(new Map<number, Attempt>())
  const createAttempt = useRef<{ title: string; productIds: number[]; scope: QueryParams; requestId: string } | null>(null)
  const lifecycleAttempt = useRef<{ action: 'close' | 'resume'; revision: number; requestId: string } | null>(null)
  // One request id for the whole of one approval, however many requests it takes: it is what makes every repeat safe.
  const decideAttempt = useRef<{ decision: 'approve' | 'reject' | 'close'; requestId: string } | null>(null)
  const [refusedLines, setRefusedLines] = useState<Record<string, string>>({})
  // The owner's way to count: what has been picked and typed on the list, held here (in memory only) until it is submitted. Keyed by product id,
  // so it survives paging and filtering; the snapshot (name, stock seen) is what the review and the server's "marked checked" test read.
  const [drafts, setDrafts] = useState<Record<string, DraftEntry>>({})
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts
  const submitAttempt = useRef<{ requestId: string; lines: Array<{ productId: number; countedQuantity: number; seenQuantity: number | null; checked: boolean; note?: string }> } | null>(null)
  const [writeScope] = useState(() => captureInventoryCheckWriteScope({ branchId, sessionId, epoch: 0 }, () => mounted.current && isCurrent()))
  const current = () => mounted.current && isCurrent() && isActorReadScopeCurrent(writeScope.readScope, false) && isActorWriteIdentityCurrent(writeScope.writeIdentity)
  const { askToConfirm, confirmDialog } = useConfirmDialog(t)
  const params: QueryParams = { ...filters, query: appliedQuery, page, pageSize, sessionId, checkState: section === 'issues' ? 'issue' : filters.checkState }
  const sessionParams: QueryParams = { branchId, page, pageSize, ...(sessionFilters.status ? { status: sessionFilters.status } : {}), ...(sessionFilters.mine ? { mine: 1 } : {}), ...(sessionFilters.waiting && sessions?.approvals ? { approval: 'pending' as const } : {}), ...(sessionRange.startDate ? { startDate: sessionRange.startDate } : {}), ...(sessionRange.endDate ? { endDate: sessionRange.endDate } : {}) }
  // scopeKey identifies WHAT is listed (filters, page, section); requestKey also changes on every refresh bump.
  // Rows stay fresh for as long as the listed scope is the loaded one, so a refresh of the same scope (the Refresh button,
  // Close/Resume or a conflict) reloads in the background while the existing rows stay mounted. A saved tick reloads nothing.
  const scopeKey = JSON.stringify([section === 'sessions' ? sessionParams : params, section])
  const requestKey = JSON.stringify([section === 'sessions' ? sessionParams : params, section, refresh])
  const queryFence = useRef(requestKey)
  queryFence.current = requestKey
  const [loadedKey, setLoadedKey] = useState('')
  // The session loads on its own clock: only when it is chosen or reloaded, never because the search or a filter changed.
  const [sessionLoadedFor, setSessionLoadedFor] = useState('')
  const fresh = loadedKey === scopeKey && (section === 'sessions' || !sessionId || sessionLoadedFor === sessionId)
  const reloadAll = () => { setRefresh(value => value + 1); setSessionReload(value => value + 1) }
  // The server's own verdict (can_edit) can only narrow what this account's role and ownership allow here.
  const canEdit = access.canCheck && !!session && session.can_edit !== false && (isAdminControlUser(user) || Number(session.created_by) === Number(user?.id))
  const canViewCounts = access.fields.stock || (!!session && Number(session.created_by) === Number(user?.id))
  const savedReasons = useSavedStockReasons('adjust')

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const hasDrafts = Object.keys(drafts).length > 0
  useEffect(() => {
    if (!hasDrafts) return
    return registerDirtyWork({ key: COUNTS_WORK_KEY, pageId: 'inventory', label: tr('inventory_check_counts_in_progress', 'Counts not submitted'),
      isDirty: () => Object.keys(draftsRef.current).length > 0,
      discard: () => { submitAttempt.current = null; setDrafts({}) } })
  }, [hasDrafts])
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
          const stepScope = JSON.stringify([{ ...params, page: undefined }, section, refresh])
          // The switch can move under an open tab (ic_simple turned on or off), and then the key this tab holds (a status filter, Issues, a skipped summary) belongs to the other list.
          // Two outcomes, both answered in the same load by asking once in the other list's words (never a third time; a second refusal is a real error):
          //  - the other list REFUSES the key (400 inventory_check_invalid_query): ask in the other list's words;
          //  - the check-status list ANSWERS a request written in the older words, which dropped a status choice the tab holds: its rows are not the filtered ones, so ask again with the status.
          let wording: ProductsServer = productsServer.current
          let products = await readInventoryCheckProducts<ProductsResult>(productsWireParams(params, wording, summaryScope.current === stepScope), abort.signal)
            .catch(cause => {
              if ((cause as { code?: unknown } | null)?.code !== 'inventory_check_invalid_query' || abort.signal.aborted) throw cause
              summaryScope.current = ''
              wording = wording === 'old' ? 'simple' : 'old'
              return readInventoryCheckProducts<ProductsResult>(productsWireParams(params, wording, false), abort.signal)
            })
          if (products.simple === true && wording === 'old' && oldListDropsStatus(params) && !abort.signal.aborted) {
            summaryScope.current = ''
            products = await readInventoryCheckProducts<ProductsResult>(productsWireParams(params, 'simple', false), abort.signal)
          }
          if (publish()) {
            if (!branchId && !sessionId && products.branches?.length === 1) {
              onSelect({ branchId: String(products.branches[0].id), sessionId: '', bootstrapIntent: { query, filters: { ...filters }, pagination: { ...pagination }, pageSize } })
              return
            }
            productsServer.current = productsServerOf(products)
            if (products.simple !== true) summaryScope.current = ''
            else if (products.facets) summaryScope.current = stepScope
            setData(previous => products.simple && !products.facets && previous ? { ...products, summary: previous.summary, facets: previous.facets, facetsLimited: previous.facetsLimited } : products)
            setLoadedKey(scopeKey)
          }
        }
      } catch (cause) {
        // Refused in both lists' words: forget which list this is, so Retry starts from the words both understand.
        if (publish() && (cause as { code?: unknown } | null)?.code === 'inventory_check_invalid_query') { productsServer.current = 'unknown'; summaryScope.current = '' }
        if (publish()) setError(tr('inventory_check_load_failed', 'Inventory checks are unavailable. Reload to try again.'))
      } finally { if (publish()) setLoading(false) }
    }
    void load()
    return () => { live = false; abort.abort() }
  }, [requestKey])
  useEffect(() => {
    if (!sessionId) return
    const abort = new AbortController()
    let live = true
    const publish = () => live && !abort.signal.aborted && current()
    setSessionError('')
    void readInventoryCheckSession(sessionId, abort.signal).then(selected => {
      if (publish()) { setSession(selected.item); setItems(selected.items); setApproval(selected.approval ?? null); setSessionLoadedFor(sessionId) }
    }).catch(() => { if (publish()) setSessionError(tr('inventory_check_load_failed', 'Inventory checks are unavailable. Reload to try again.')) })
    return () => { live = false; abort.abort() }
  }, [sessionId, sessionReload])

  function applyQuery(value: string, scanning: boolean) {
    setQuery(value)
    if (value !== appliedQuery) { setAppliedQuery(value); setPage(1) }
    setScan(scanning && looksLikeCode(value) ? { token: ++scanSeq.current, query: value, target: scanFocusTarget(access.fields.stock) } : null)
  }
  function typeQuery(value: string) {
    if (controlsLocked) return
    if (value === '') applyQuery('', false)
    else { setQuery(value); setScan(null) }
  }
  function submitQuery(value: string) {
    if (controlsLocked) return
    setWriteError('')
    applyQuery(value, true)
  }
  const applyQueryRef = useRef(applyQuery)
  applyQueryRef.current = applyQuery

  // A scanner gun: the hook has already cancelled the Enter and put a quantity box back as it was. The scan then does what typing the
  // code and pressing Enter does -- but only once the row's own restore has rendered, so a row left unchanged does not count as unsaved work.
  // A burst typed into a count box (origin 'field') says where the code went, as every other surface does -- once the scan is accepted:
  // a blocked scan moved nothing, and the blocked message already says so.
  useScannerWedge({ enabled: section !== 'sessions', searchRef, onScan: (code, origin) => setGunScan({ code, token: ++scanSeq.current, origin }) })
  useEffect(() => {
    if (!gunScan) return
    setGunScan(null)
    if (busy || createAttempt.current || getDirtyWork().some(work => work.pageId === 'inventory' && work.key !== COUNTS_WORK_KEY)) { setWriteError(tr('inventory_check_count_blocked_busy', 'Finish or cancel the open check first.')); return }
    setWriteError('')
    applyQuery(gunScan.code, true)
    if (gunScan.origin === 'field') notify(tr('scan_moved_to_search', 'Barcode moved to search'), 'info')
  }, [gunScan])

  // Another branch remounts the list and drops the picked products and typed counts: ask first, with the shared review.
  async function selectOrAsk(next: Selection) {
    if (Object.keys(draftsRef.current).length > 0) {
      const confirmed = await askToConfirm({ title: tr('inventory_check_discard_counts_title', 'Discard counts not submitted?'),
        message: tr('inventory_check_discard_counts_message', 'The products you picked and the counts you typed will be cleared.'), confirmLabel: t('discard'), danger: true })
      if (!confirmed || !current()) return
    }
    onSelect(next)
  }
  function changeFilters(patch: Partial<InventoryCheckFilters>) {
    if (controlsLocked) return
    if (patch.branchId !== undefined && patch.branchId !== branchId) { void selectOrAsk({ branchId: patch.branchId, sessionId: '' }); return }
    setFilters(previous => ({ ...previous, ...patch })); setPage(1); setScan(null)
  }
  function changeSessionFilters(patch: Partial<SessionListFilters>) {
    if (controlsLocked) return
    setSessionFilters(previous => ({ ...previous, ...patch })); setPage(1)
  }
  // Clears search, dates and every Filters-menu choice (Sort included). A chosen branch is a selection, so clearing it re-selects "all branches".
  function clearFilters() {
    if (controlsLocked) return
    if (branchId && branches.length > 1) { void selectOrAsk({ branchId: '', sessionId: '' }); return }
    if (section === 'sessions') { setSessionFilters(initialSessionFilters); setSessionRange(statsPresetRange('all')) } else {
      setFilters(previous => ({ ...initialFilters, branchId: previous.branchId }))
      setQuery(''); setAppliedQuery(''); setScan(null)
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
        // The PATCH already answered with the saved item and session, and the rows stay where they are even under a state
        // or reason filter (no row slides away under the thumb): a tick reads neither the products nor the session again.
      }
    } catch (cause) {
      const refusal = (cause as { outcome?: string })?.outcome === 'unknown' ? undefined : knownRefusal(cause)
      if (refusal) attempts.current.delete(id)
      // A definite conflict means the page is behind the server (revision, baseline or stock moved): reload it.
      if (current() && isStaleConflict(cause)) reloadAll()
      if (current()) setRowErrors(previous => ({ ...previous, [id]: refusal ? tr(refusal.key, refusal.fallback) : tr((cause as { outcome?: string })?.outcome === 'unknown' ? 'inventory_check_save_unknown' : 'inventory_check_save_failed', (cause as { outcome?: string })?.outcome === 'unknown' ? 'Save not confirmed. Retry the same check to recover its receipt.' : 'Check not saved. Retry the same check or reload this session.') }))
      throw cause
    } finally { inFlight.current = false; if (current()) { setBusy(false); setSavingId(null) } }
  }

  // The products a new session would hold: the checkable rows of the page on screen (unchanged membership rule).
  const countableIds = fresh && data ? [...new Set(data.items.filter(product => !product.is_group && (product as InventoryCheckProduct & { checkable?: boolean }).checkable !== false).map(product => Number(product.id)))].filter(id => Number.isSafeInteger(id) && id > 0) : []
  const branches = data?.branches ?? []
  const soleBranch = branches.length === 1 ? branches[0] : null
  const branchName = branches.find(branch => String(branch.id) === (session ? String(session.branch_id) : branchId))?.name ?? null

  async function start() {
    if (!current() || !fresh || !access.canCheck || !canWriteToServer || !branchId || sessionId || !data || inFlight.current || rowEditing) return
    if (!createAttempt.current) {
      const productIds = countableIds
      if (!productIds.length || productIds.length > 500) return
      // The review shows exactly the ids that will be created; a retry after an unknown outcome reuses the frozen request below.
      const scopeText = describeCountScope(t, { query: appliedQuery, filters, stateApplies: section !== 'issues' })
      const confirmed = await askToConfirm({
        title: tr('inventory_check_count_review_title', 'Start a count session?'),
        items: [{ label: t('products'), value: productIds.length }, { label: t('branch'), value: branchName ?? '—' }, { label: t('filters'), value: scopeText || t('none') }],
        confirmLabel: tr('inventory_check_start_page', 'Count'),
      })
      if (!confirmed || !current() || inFlight.current) return
      createAttempt.current = { title: tr('inventory_check_page_session', 'Visible page check'), productIds, scope: { ...Object.fromEntries(Object.entries(params).filter(([, value]) => value !== '' && value != null)), membership: 'visible_page' }, requestId: createClientRequestId('inventory_check') }
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
      if (current()) { lifecycleAttempt.current = null; setSession(result.item); reloadAll() }
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
  const unavailableProducts = unavailableMembers.map(item => ({ ...projectProduct(item.product_snapshot, access.fields), id: item.product_id, quantity: null, damaged_quantity: null, checkable: false }))
  const observations: Record<string, InventoryCheckObservation> = {}
  if (fresh) for (const item of items) observations[String(item.product_id)] = { product_id: item.product_id, state: item.state, counted_quantity: canViewCounts ? item.counted_quantity : null, reason: item.reason, revision: item.revision, ...(access.fields.stock ? { baseline_quantity: item.baseline_quantity, current_quantity: item.current_quantity, stock_changed: item.stock_changed } : {}) }
  // Row badges: renamed originals keep their current row (the starting name is behind the hint); unavailable originals sit read-only below.
  const adornments: Record<string, ReactNode> = {}
  for (const [id, item] of renamedMembers) adornments[id] = <RowBadge text={tr('inventory_check_renamed_badge', 'Renamed')} hint={`${tr('inventory_check_original_name', 'Starting name')}: ${item.product_snapshot.name} · ${tr('inventory_check_current_name', 'Current name')}: ${item.current_product_name}`} />
  const unavailableAdornments = Object.fromEntries(unavailableMembers.map(item => [String(item.product_id), <RowBadge key="unavailable" text={tr('inventory_check_unavailable_badge', 'Unavailable')} hint={tr('inventory_check_unavailable_member_hint', 'This original product is unavailable. Its saved check remains read-only.')} />]))
  const frozen = Object.fromEntries([...attempts.current.values()].map(attempt => [String(attempt.productId), { patch: attempt.patch, revision: attempt.revision }]))

  // ---- The list counts by itself: pick products, type a count in each row, Submit once ----
  const listMode = fresh && !sessionId && section !== 'sessions' && !!data?.simple
  const selecting = listMode && access.canCheck
  const selectedIds = Object.keys(drafts).filter(id => drafts[id].selected)
  const selectable = listMode ? visibleProducts.filter(product => !product.is_group && product.checkable !== false) : []
  const selectedOnPage = selectable.filter(product => drafts[String(product.id)]?.selected).length
  const pageState: 'all' | 'some' | 'none' = selectedOnPage === 0 ? 'none' : selectedOnPage === selectable.length ? 'all' : 'some'
  function patchDraft(product: InventoryCheckProduct, change: (current: DraftEntry) => Partial<ListDraft>) {
    if (submitAttempt.current) return
    setDrafts(previous => {
      const id = String(product.id)
      const seen = finiteQuantity(product.quantity) ? product.quantity : null
      const current = previous[id] ?? { selected: false, count: '', checked: false, note: '', name: product.name, seen }
      const next = { ...current, ...change(current), name: product.name, seen }
      if (!next.selected && next.count === '' && next.note === '') { const rest = { ...previous }; delete rest[id]; return rest }
      return { ...previous, [id]: next }
    })
  }
  const draftHandlers = {
    onToggle: (product: InventoryCheckProduct, selected: boolean) => patchDraft(product, () => ({ selected })),
    onCount: (product: InventoryCheckProduct, value: string) => patchDraft(product, current => ({ count: value, checked: false, selected: value.trim() !== '' ? true : current.selected })),
    onChecked: (product: InventoryCheckProduct) => { if (finiteQuantity(product.quantity)) patchDraft(product, () => ({ count: String(product.quantity), checked: true, selected: true })) },
    onNote: (product: InventoryCheckProduct, value: string) => patchDraft(product, () => ({ note: value })),
  }
  function togglePage() {
    if (submitAttempt.current) return
    const next = pageState !== 'all'
    setDrafts(previous => {
      const result = { ...previous }
      for (const product of selectable) {
        const id = String(product.id)
        const seen = finiteQuantity(product.quantity) ? product.quantity : null
        const entry = result[id] ?? { selected: false, count: '', checked: false, note: '', name: product.name, seen }
        const updated = { ...entry, selected: next, seen }
        if (!updated.selected && updated.count === '' && updated.note === '') delete result[id]
        else result[id] = updated
      }
      return result
    })
  }
  // "Mark checked" fills the stock figure the person looked at into every picked row that has no count yet.
  function markSelectedChecked() {
    if (submitAttempt.current) return
    setDrafts(previous => Object.fromEntries(Object.entries(previous).map(([id, entry]) => [id,
      entry.selected && entry.count.trim() === '' && entry.seen !== null ? { ...entry, count: String(entry.seen), checked: true } : entry])))
  }
  function clearSelection() {
    if (submitAttempt.current) return
    setDrafts({})
  }
  const submitBlocked = !selecting ? '' : !canWriteToServer ? tr('inventory_check_count_blocked_offline', 'Saving is unavailable while offline.')
    : !branchId ? tr('inventory_check_count_blocked_branch', 'Choose a branch first.')
    : selectedIds.length > MAX_SUBMISSION ? tr('inventory_check_submit_too_many', 'Submit at most 500 products at a time.')
    : selectedIds.some(id => parseCount(drafts[id].count).kind !== 'valid') ? tr('inventory_check_submit_need_counts', 'Enter a count for every selected product.') : ''

  async function submit() {
    if (!current() || !selecting || submitBlocked || inFlight.current || selectedIds.length === 0) return
    if (!submitAttempt.current) {
      const lines = selectedIds.map(Number).sort((a, b) => a - b).map(productId => {
        const entry = drafts[String(productId)], count = parseCount(entry.count), note = entry.note.trim()
        const countedQuantity = count.kind === 'valid' ? count.value : 0
        const differs = access.fields.stock && entry.seen !== null && countedQuantity !== entry.seen
        return { productId, countedQuantity, seenQuantity: entry.seen, checked: access.fields.stock && entry.checked && !differs, ...(differs && note ? { note } : {}) }
      })
      const differing = lines.filter(line => access.fields.stock && line.seenQuantity !== null && line.countedQuantity !== line.seenQuantity).length
      const confirmed = await askToConfirm({
        title: tr('inventory_check_submit_review_title', 'Submit these counts?'),
        items: [{ label: t('products'), value: lines.length }, { label: t('branch'), value: branchName ?? '—' }, ...access.fields.stock ? [{ label: tr('inventory_check_differences', 'Differences'), value: differing }] : []],
        confirmLabel: tr('inventory_check_submit', 'Submit'),
      })
      if (!confirmed || !current() || inFlight.current) return
      submitAttempt.current = { requestId: createClientRequestId('inventory_check'), lines }
    }
    const attempt = submitAttempt.current
    inFlight.current = true; setBusy(true); setWriteError('')
    try {
      await submitInventoryCheckCounts(writeScope, { branchId: Number(branchId), requestId: attempt.requestId, lines: attempt.lines })
      if (current()) {
        const sent = new Set(attempt.lines.map(line => String(line.productId)))
        submitAttempt.current = null
        setDrafts(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => !sent.has(id))))
        notify(tr('inventory_check_submitted', 'Counts submitted'), 'success')
        reloadAll()
      }
    } catch (cause) {
      const unknown = (cause as { outcome?: string })?.outcome === 'unknown'
      const refusal = unknown ? undefined : knownRefusal(cause)
      if (!unknown) submitAttempt.current = null
      if (current() && (cause as { code?: unknown })?.code === 'inventory_check_stock_changed') {
        // The products the server names were counted against stock that has moved since: their counts are withdrawn (the person counts again against the stock now shown), and so is every checked mark.
        const named = new Set(Array.isArray((cause as { productIds?: unknown }).productIds) ? ((cause as { productIds: unknown[] }).productIds).map(Number) : [])
        setDrafts(previous => Object.fromEntries(Object.entries(previous).map(([id, entry]) => [id, entry.checked || named.has(Number(id)) ? { ...entry, count: '', checked: false } : entry])))
      }
      if (current() && !unknown && isStaleConflict(cause)) reloadAll()
      // The server names the products whose earlier count is being applied (the refusal is the same whatever figure was typed): the person is told which, and the counts are kept.
      const busy = (cause as { code?: unknown })?.code === 'inventory_check_count_in_progress' && Array.isArray((cause as { productIds?: unknown }).productIds)
        ? ((cause as { productIds: unknown[] }).productIds).map(id => draftsRef.current[String(id)]?.name).filter((name): name is string => typeof name === 'string' && name !== '') : []
      if (current()) setWriteError(refusal ? `${tr(refusal.key, refusal.fallback)}${busy.length ? ` ${t('products')}: ${busy.join(', ')}` : ''}` : tr(unknown ? 'inventory_check_save_unknown' : 'inventory_check_save_failed', unknown ? 'Save not confirmed. Retry the same operation or reload.' : 'Check not saved. Try again.'))
    } finally { inFlight.current = false; if (current()) setBusy(false) }
  }
  // Counts approval (ic_fix_stock): approving changes stock, so the person must hold the extra, may adjust stock and be online.
  const canDecide = fresh && !!approval && approval.can_approve && data?.capabilities?.approveCounts === true && canWriteToServer
  // Closing moves no stock, so it needs the extra but not the right to adjust stock.
  const canClose = fresh && !!approval && approval.can_approve && canWriteToServer
  // A refusal for a count that cannot be rejected any more (stock may have moved) points at Close.
  const withCloseHint = (text: string) => approval && (approval.applying || approval.applied > 0) ? `${text} ${tr('inventory_check_close_hint', 'Part of it was already applied, so close the remaining lines instead.')}` : text
  const refusedMap = (list: unknown): Record<string, string> => Object.fromEntries((Array.isArray(list) ? list as Array<{ productId?: unknown; code?: unknown }> : []).filter(entry => entry && typeof entry.code === 'string').map(entry => [String(entry.productId), String(entry.code)]))
  async function decideApproval(decision: 'approve' | 'reject' | 'close') {
    if (!current() || !sessionId || !approval || approval.status !== 'pending' || inFlight.current) return
    if (!decideAttempt.current || decideAttempt.current.decision !== decision) {
      const confirmed = await askToConfirm({
        title: decision === 'approve' ? tr('inventory_check_approve_title', 'Approve these counts?') : decision === 'close' ? tr('inventory_check_close_title', 'Close the remaining lines?') : tr('inventory_check_reject_title', 'Reject these counts?'),
        message: decision === 'approve' ? tr('inventory_check_approve_message', 'Stock changes by what each count found. Sales since the count are kept.')
          : decision === 'close' ? tr('inventory_check_close_message', 'Stock does not change. Lines already applied stay applied; the rest are recorded as not applied.') : tr('inventory_check_reject_message', 'Stock stays as it is.'),
        items: [{ label: tr('inventory_check_differences', 'Differences'), value: approval.lines - approval.applied - Object.keys(approval.superseded ?? {}).length }],
        confirmLabel: decision === 'approve' ? tr('inventory_check_approve', 'Approve') : decision === 'close' ? tr('inventory_check_close', 'Close') : tr('inventory_check_reject', 'Reject'),
        danger: decision !== 'approve',
      })
      if (!confirmed || !current() || inFlight.current) return
      // An approval that already started under a request id (this approver's own earlier attempt) continues under it: that id is what the stock writers replay.
      decideAttempt.current = { decision, requestId: decision === 'approve' && approval.applying_request_id ? approval.applying_request_id : createClientRequestId('inventory_check_approval') }
    }
    const attempt = decideAttempt.current
    inFlight.current = true; setBusy(true); setWriteError(''); setRefusedLines({})
    try {
      const flow = await runApprovalFlow({
        send: () => decideInventoryCheckApproval(writeScope, { decision, requestId: attempt.requestId }),
        onProgress: result => { if (current()) { setApproval(result.approval); setRefusedLines(refusedMap(result.refused)) } },
        isCurrent: current,
      })
      if (!current()) return
      if (flow.outcome === 'done') {
        decideAttempt.current = null
        notify(decision === 'approve' ? tr('inventory_check_approved_done', 'Counts approved. Stock updated.') : decision === 'close' ? tr('inventory_check_closed_done', 'Count closed. Closing did not change stock.') : tr('inventory_check_rejected_done', 'Counts rejected. Stock unchanged.'), 'success')
      } else if (flow.outcome === 'refused') {
        // Some lines were applied; the rest cannot be: said once, with each line's reason on its row. The same Approve repeats once the cause is fixed.
        setWriteError(withCloseHint(tr('inventory_check_lines_refused', 'Some lines cannot be applied. Fix the cause and approve again, or close the remaining lines.')))
      } else if (flow.outcome === 'stalled') {
        setWriteError(tr('inventory_check_error_write_refused', 'Stock could not be updated for some products. Try again.'))
      } else decideAttempt.current = null // declined: the next Approve is a fresh decision with its own review
      reloadAll()
    } catch (cause) {
      const unknown = (cause as { outcome?: string })?.outcome === 'unknown'
      const refusal = unknown ? undefined : knownRefusal(cause)
      if (!unknown) decideAttempt.current = null
      if (current()) {
        setRefusedLines(refusedMap((cause as { refused?: unknown }).refused))
        setWriteError(refusal ? withCloseHint(tr(refusal.key, refusal.fallback)) : tr(unknown ? 'inventory_check_save_unknown' : 'inventory_check_save_failed', unknown ? 'Save not confirmed. Retry the same operation or reload.' : 'Check not saved. Try again.'))
        reloadAll()
      }
    } finally { inFlight.current = false; if (current()) setBusy(false) }
  }
  // The owner's summary: check counts only. A session shows its own counts in the session bar, and the old contract sends none.
  const checkInfo = !sessionId && !!data?.simple
  const summary = fresh && checkInfo ? data?.summary : undefined
  const cards: StatCardDef[] = summary ? (['not_checked', 'in_check', 'ok', 'issue'] as const).map(key => ({
    key, label: tr(key === 'issue' ? 'issues' : `inventory_check_status_${key}`, key === 'not_checked' ? 'Not checked' : key === 'in_check' ? 'In check' : key === 'ok' ? 'Checked OK' : 'Issues'), value: summary[key],
  })) : []
  const rowEditing = Object.values(editingRows).some(Boolean)
  const controlsLocked = busy || !!createAttempt.current || rowEditing
  // Typing is read after a pause. A row being edited holds the list still (the controls are disabled), so the pause restarts once it is done.
  useEffect(() => {
    if (query === appliedQuery || controlsLocked) return
    const timer = window.setTimeout(() => { setAppliedQuery(query); setPage(1) }, SEARCH_PAUSE_MS)
    return () => window.clearTimeout(timer)
  }, [query, appliedQuery, controlsLocked, section])

  // Session bar facts. The single-session read sends no creator name or branch name: the list's creator rides in the
  // selection, the viewer's own username covers their own sessions, and the branch comes from the branch list.
  const progress = session?.progress ?? { total: items.length, done: items.filter(item => item.state === 'done').length, issue: items.filter(item => item.state === 'issue').length, unstarted: items.filter(item => item.state === 'unstarted').length }
  const ownSession = !!session && Number(session.created_by) === Number(user?.id)
  const creatorName = session?.creator_name ?? selection.creatorName ?? (ownSession ? String(user?.username || '') : '')
  const sessionDetails = session ? [fmtDateTime24(session.started_at), branchName, creatorName && `@${creatorName}`].filter(Boolean).join(' · ') : ''

  // Count: why it is unavailable is the answer to "why can't I press it". A search still waiting for its pause is not the list on screen yet.
  const countBlocked = busy || rowEditing ? tr('inventory_check_count_blocked_busy', 'Finish or cancel the open check first.')
    : !fresh || query !== appliedQuery ? tr('inventory_check_count_blocked_loading', 'Wait for the list to finish loading.')
    : !canWriteToServer ? tr('inventory_check_count_blocked_offline', 'Saving is unavailable while offline.')
    : !branchId ? tr('inventory_check_count_blocked_branch', 'Choose a branch first.')
    : !countableIds.length ? tr('inventory_check_count_blocked_empty', 'No products on this page to count.') : ''
  const countLabel = createAttempt.current ? t('retry') : tr('inventory_check_start_page', 'Count')
  // The status choice exists once an answer has shown which list this is: the check-status list (ic_simple) has it everywhere; the older list has it only inside a session
  // (its unstarted | done | issue), and the Issues tab elsewhere -- so no choice is drawn for it on the Products list, and none before the first answer.
  const statusFilter = section !== 'issues' && !!data && (data.simple === true || !!sessionId)
  const filtersActive = countActiveFilters(filters, { branch: branches.length > 1, state: statusFilter }) > 0 || !!query.trim()
  const sessionFiltersActive = !!(sessionFilters.status || sessionFilters.mine || sessionFilters.waiting || sessionRange.startDate || sessionRange.endDate || (branches.length > 1 && !!branchId))
  // The older list (ic_simple off) draws the all-sessions Issues view from the answer's `issues` (reason, counted figure, the session), not from product rows.
  const oldIssues = section === 'issues' && !sessionId && !!data && data.simple !== true
  const loadedNothing = !loading && fresh && !unavailableProducts.length && !(section === 'sessions' ? sessions?.items.length : oldIssues ? data?.issues?.length : visibleProducts.length)

  // A scan points at the one exact row of the list on screen (product rows only: the all-sessions Issues list has none).
  const showsProductRows = section !== 'sessions' && !oldIssues
  const scanHit = scan && fresh && showsProductRows ? scanHitOf(visibleProducts, scan.query, access.fields.barcode) : null
  const focusRequest: InventoryCheckFocusRequest | undefined = scan && scanHit ? { id: scanHit.id, token: scan.token, target: scan.target } : undefined
  const scanMissed = !!scan && loadedNothing && showsProductRows
  const scanRef = useRef(scan)
  scanRef.current = scan
  const scanHitId = useRef<string | null>(null)
  scanHitId.current = scanHit ? String(scanHit.id) : null
  // After the scanned row is saved the next scan starts clean: on a desktop or tablet the search is emptied and focused, on a phone the list stays.
  const onCommitted = useCallback((id: number | string): boolean => {
    if (!scanRef.current || scanHitId.current !== String(id)) return false
    setScan(null)
    if (!atLeast(768)) return false
    applyQueryRef.current('', false)
    setSearchFocus(value => value + 1)
    return true
  }, [])
  useEffect(() => {
    if (searchFocus && !controlsLocked) { searchRef.current?.focus(); setSearchFocus(0) }
  }, [searchFocus, controlsLocked])
  // A miss leaves the code selected in Search so the next one replaces it; only a desktop-sized screen takes focus (no phone keyboard).
  useEffect(() => {
    if (!scanMissed) return
    if (!compact) searchRef.current?.focus()
    searchRef.current?.select()
  }, [scanMissed, scan?.token])

  const facetsLimited = fresh ? data?.facetsLimited : undefined

  // Issues is the same list with the status preset to Issue; each row can open the session that recorded it.
  const open = tr('inventory_check_open_session', 'Open session')
  const issueChips = section === 'issues' && !sessionId && fresh ? Object.fromEntries(visibleProducts.filter(product => product.check_session_id && product.check_branch_id != null).map(product => {
    const issueBranch = branches.find(branch => branch.id === product.check_branch_id)?.name
    return [String(product.id), <button key="open" type="button" className="inline-flex min-h-6 max-w-full items-center gap-1 rounded-full bg-slate-100 px-2 text-[11px] font-semibold leading-relaxed text-slate-700 dark:bg-zinc-800 dark:text-slate-200" aria-label={issueBranch ? `${open}: ${issueBranch}` : open} title={open} onClick={() => onSelect({ branchId: String(product.check_branch_id), sessionId: String(product.check_session_id) })}><ClipboardList className="h-3 w-3 shrink-0" aria-hidden="true" />{issueBranch ? <span className="min-w-0 break-words">{issueBranch}</span> : null}</button>]
  })) : {}
  const issueRows = oldIssues && fresh ? (data?.issues ?? []).map(issue => {
    const product = visibleProducts.find(candidate => Number(candidate.id) === issue.product_id) ?? { id: issue.product_id, name: `#${issue.product_id}` }
    const showCount = (access.fields.stock || Number(issue.created_by) === Number(user?.id)) && typeof issue.counted_quantity === 'number' && Number.isFinite(issue.counted_quantity)
    const issueBranch = branches.find(branch => branch.id === issue.branch_id)?.name
    return { key: `${issue.session_id}:${issue.product_id}`, product, observation: { product_id: issue.product_id, state: 'issue' as const, counted_quantity: showCount ? issue.counted_quantity ?? null : null, reason: issue.reason, revision: issue.revision },
      chip: <button type="button" className="inline-flex min-h-6 max-w-full items-center gap-1 rounded-full bg-slate-100 px-2 text-[11px] font-semibold leading-relaxed text-slate-700 dark:bg-zinc-800 dark:text-slate-200" aria-label={issueBranch ? `${open}: ${issueBranch}` : open} title={open} onClick={() => onSelect({ branchId: String(issue.branch_id), sessionId: issue.session_id })}><ClipboardList className="h-3 w-3 shrink-0" aria-hidden="true" />{issueBranch ? <span className="min-w-0 break-words">{issueBranch}</span> : null}</button> }
  }) : []
  const rowProps = { canViewStock: access.fields.stock, canViewCounts, t, onOpenProduct: setDetail } as const
  const canCheckRows = fresh && canEdit && session?.status === 'open' && canWriteToServer && !lifecycleAttempt.current
  // One column header for the whole list, pinned with the controls: the rows below line up under it from 1024px.
  const sheetHeader = fresh && visibleProducts.length && section !== 'sessions' && !oldIssues
    ? listMode ? <InventoryCheckListHeader selecting={selecting} canViewStock={access.fields.stock} canViewCounts={canViewCounts} t={t} />
      : <InventoryCheckSheetHeader canCheck={canCheckRows} inSession={!!sessionId} canViewStock={access.fields.stock} canViewCounts={canViewCounts} t={t} /> : null

  // Fix stock and the Sales link (ic_fix_stock) sit in the product's detail: Fix stock for someone who may adjust stock, the link for someone who may read sales.
  const rights = effectivePermissions(user)
  const offered = fresh && !!detail && data?.capabilities?.fixStock === true
  const fixOpening = offered && detail && canWriteToServer && rights.can('inventory', 'adjust')
    ? fixStockOpening(detail, { session: sessionId && session ? { id: sessionId, branchId: Number(session.branch_id) } : null, observation: observations[String(detail.id)], listBranchId: filters.branchId,
      pending: detail.check_pending === true || (!!sessionId && approval?.status === 'pending'),
      canViewStock: access.fields.stock, label: tr('inventory_check_fix_stock_reason', 'Inventory check') })
    : null
  function openFixStock(opening: FixStockOpening) {
    // The Set session resumes an unfinished stock session of this person instead of opening a new one: say so rather than open something else.
    const unfinished = readWorkDraft<{ lines?: unknown }>(scopedWorkDraftKey('fast_stockin'))?.data?.lines
    if (Array.isArray(unfinished) && unfinished.length) { notify(tr('inventory_check_fix_stock_open_draft', 'Finish or discard your open stock session first.'), 'warning'); return }
    setDetail(null)
    setFixStock(opening)
  }
  const countAction = section !== 'sessions' && access.canCheck && !data?.simple ? <>
    {countBlocked ? <InfoHint text={countBlocked} label={countBlocked} /> : null}
    <button type="button" className="btn-primary inline-flex min-h-10 shrink-0 items-center gap-1 px-3 text-xs aria-disabled:cursor-not-allowed aria-disabled:opacity-60" aria-disabled={countBlocked ? true : undefined}
      aria-label={countableIds.length ? `${countLabel} (${countableIds.length})` : countLabel} title={countBlocked || tr('inventory_check_count_tooltip', 'Count the products listed on this page')}
      onClick={() => { if (!countBlocked) void start() }}><Play className="h-4 w-4" aria-hidden="true" />{countLabel}
      {countableIds.length ? <span data-count-pill className="rounded-full bg-white/25 px-1.5 text-[10px] font-semibold leading-relaxed tabular-nums">{countableIds.length}</span> : null}</button>
  </> : null
  const viewOnly = <span className="inline-flex shrink-0 items-center">
    <span role="img" aria-label={t('view_only')} title={t('view_only')} className="inline-flex"><Eye className="h-4 w-4 text-gray-500 dark:text-gray-300" aria-hidden="true" /></span>
    <InfoHint text={tr('inventory_check_read_only_hint', 'You can view this session. Only its creator or an administrator can change it.')} label={tr('inventory_check_read_only_hint', 'You can view this session. Only its creator or an administrator can change it.')} />
  </span>
  // One line, never wrapped: leave, the ring and counts (the middle scrolls sideways if a name is long), then History / Close / Refresh.
  const sessionBar = <div className="flex min-w-0 flex-1 items-center gap-1" data-inventory-check-actions>
    <IconAction label={tr('inventory_check_leave_session', 'Leave session')} disabled={controlsLocked} onClick={() => onSelect({ branchId, sessionId: '' })}><ArrowLeft className="h-5 w-5" aria-hidden="true" /></IconAction>
    {session && fresh ? <div className="scroll-x-clean min-w-0 flex-1" data-inventory-check-session-bar>
      <div className="inline-flex items-center gap-2 align-middle text-xs">
        <ProgressRing progress={progress} t={t} />
        <SessionCounts progress={progress} t={t} />
        <span className="hidden shrink-0 text-gray-600 sm:inline dark:text-gray-300" data-session-details>{sessionDetails}</span>
        <span className="inline-flex shrink-0 sm:hidden"><InfoHint text={sessionDetails} label={tr('inventory_check_session_details', 'Session details')} /></span>
        {session.status === 'closed' ? <SessionStatusChip status="closed" t={t} /> : null}
        {!canEdit ? viewOnly : null}
      </div>
    </div> : <span className="h-4 min-w-0 flex-1 animate-pulse rounded bg-gray-200 dark:bg-zinc-700" aria-hidden="true" />}
    <IconAction label={t('history')} onClick={() => setHistoryPage(1)}><History className="h-5 w-5" aria-hidden="true" /></IconAction>
    {canEdit && fresh && session?.scope?.membership !== 'submission' ? <IconAction label={lifecycleAttempt.current ? t('retry') : session?.status === 'open' ? tr('inventory_check_close_session', 'Close session') : tr('inventory_check_resume_session', 'Resume session')}
      disabled={controlsLocked || !canWriteToServer || attempts.current.size > 0} onClick={() => { void lifecycle() }}>
      {lifecycleAttempt.current ? <RotateCcw className="h-5 w-5" aria-hidden="true" /> : session?.status === 'open' ? <Lock className="h-5 w-5" aria-hidden="true" /> : <Unlock className="h-5 w-5" aria-hidden="true" />}
    </IconAction> : null}
  </div>
  // The context bar: where the person is (the one branch, or the open session) and what they can do from here.
  const contextBar = <div className="flex min-w-0 flex-1 items-center gap-1" data-inventory-check-context>
    {sessionId ? sessionBar : <>
      {soleBranch ? <SoleBranchLabel name={soleBranch.name} label={t('branch')} className="min-w-0 flex-1 text-xs" /> : <span className="flex-1" />}
      {countAction}
    </>}
  </div>

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <HubSectionNav pageId="inventory" active={section} sections={[
      { id: 'products', label: t('products') }, { id: 'sessions', label: t('inventory_check_sessions') }, { id: 'issues', label: t('issues') },
    ]} onChange={id => { if (!busy && !createAttempt.current) { setSection(id as Section); setScan(null) } }}>
      <div className="page-scroll min-w-0 space-y-2 px-3 pb-3" data-inventory-check-page>
        {/* Pinned: dates (with the Stats chip), then search / scan / Filters beside the context bar, then the column header. Open stat cards scroll inside the cap. */}
        <div className="sticky top-0 z-30 -mx-3 max-h-[calc(70*var(--app-vh))] min-w-0 space-y-1 overflow-y-auto bg-gray-50 px-3 pb-1 pt-2 dark:bg-gray-900" data-inventory-check-pinned>
          {section === 'sessions'
            ? <StatsRangeRow layout="scroll" compactRange range={sessionRange} disabled={controlsLocked} t={t} onRangeChange={value => { if (!controlsLocked) { setSessionRange(value); setPage(1) } }}
              leading={<fieldset disabled={controlsLocked} className="min-w-0 shrink-0" data-inventory-check-query-lock>
                <InventoryCheckSessionFilterMenu value={sessionFilters} onChange={changeSessionFilters} approvals={sessions?.approvals === true} branches={branches} branchId={branchId} onBranchChange={id => changeFilters({ branchId: id })} onClear={clearFilters} t={t} />
              </fieldset>} />
            : <>
              {checkInfo ? <StatsStrip layout="scroll" cards={cards} t={t} loading={loading || !fresh} /> : null}
              <div className="flex min-w-0 flex-col gap-1 lg:flex-row lg:items-center lg:gap-2">
                <fieldset disabled={controlsLocked} className="min-w-0 lg:w-[26rem] lg:shrink-0" data-inventory-check-query-lock>
                  <InventoryCheckControls query={query} onQueryChange={typeQuery} onQuerySubmit={submitQuery} searchRef={searchRef} scanLabelled={compact && !!sessionId && canCheckRows}
                    filters={filters} onFiltersChange={changeFilters} onClear={clearFilters} fields={access.fields}
                    inSession={!!sessionId} showStateFilter={statusFilter} limited={facetsLimited}
                    branches={branches} brands={data?.facets?.brands} categories={data?.facets?.categories} t={t} />
                </fieldset>
                {contextBar}
              </div>
              {selecting ? <InventoryCheckSelectionBar pageState={pageState} selectedCount={selectedIds.length} blocked={submitBlocked} busy={busy} canMarkChecked={access.fields.stock}
                submitLabel={submitAttempt.current ? t('retry') : undefined} onTogglePage={togglePage} onMarkChecked={markSelectedChecked} onClear={clearSelection} onSubmit={() => { void submit() }} t={t} /> : null}
              {sheetHeader}
            </>}
        </div>
        {writeError ? <p role="alert" className="text-xs leading-relaxed text-red-700">{writeError}</p> : null}
        {error || sessionError ? <div role="alert" className="flex items-center justify-between gap-2 text-xs leading-relaxed text-red-700">
          <span className="min-w-0 break-words">{error || sessionError}</span>
          <IconAction label={t('retry')} onClick={reloadAll}><RotateCcw className="h-4 w-4" aria-hidden="true" /></IconAction>
        </div> : null}
        {sessionId && fresh && approval && session?.scope?.membership === 'submission'
          ? <InventoryCheckApprovalPanel approval={approval} items={items} canDecide={canDecide} canClose={canClose} busy={busy} refused={refusedLines} t={t} onApprove={() => { void decideApproval('approve') }} onReject={() => { void decideApproval('reject') }} onClose={() => { void decideApproval('close') }} /> : null}
        {!fresh && !error && !sessionError ? <ListSkeleton loadingText={t('loading')} /> : null}
        {section === 'sessions' ? (fresh && sessions?.items.length ? <InventoryCheckSessionsList items={sessions.items} t={t} onOpen={item => { setSection('products'); onSelect({ branchId: String(item.branch_id), sessionId: item.id, creatorName: item.creator_name ?? null }) }} /> : null)
          : oldIssues ? <div className="min-w-0 divide-y" aria-label={t('issues')} data-inventory-check-old-issues>
            {issueRows.map(row => <InventoryCheckRows key={row.key} products={[row.product]} observations={{ [String(row.product.id)]: row.observation }} adornments={{ [String(row.product.id)]: row.chip }} canCheck={false} {...rowProps} onSave={() => { throw new Error('Open the session to change this check.') }} />)}
          </div>
          : listMode ? <InventoryCheckListRows products={visibleProducts} drafts={drafts} selecting={selecting} locked={busy || !!submitAttempt.current} canViewStock={access.fields.stock} canViewCounts={canViewCounts}
            adornments={issueChips} focusRequest={focusRequest} onCountEntered={onCommitted} t={t} onOpenProduct={setDetail} {...draftHandlers} />
          : <InventoryCheckRows key={scopeKey} products={visibleProducts} observations={observations} errors={rowErrors} adornments={{ ...adornments, ...issueChips }} frozen={frozen} pending={Object.fromEntries(visibleProducts.map(product => [String(product.id), savingId === Number(product.id)]))} locked={busy}
            canCheck={canCheckRows} inSession={!!sessionId} sheetHeader="external" reasonSuggestions={savedReasons.map(reason => reason.label)} focusRequest={focusRequest} onCommitted={onCommitted}
            {...rowProps} onEditingChange={onEditingChange} onSave={save} />}
        {section !== 'sessions' && unavailableProducts.length ? <InventoryCheckRows products={unavailableProducts} observations={observations} adornments={unavailableAdornments} canCheck={false} inSession={!!sessionId} {...rowProps} onSave={() => { throw new Error('This original session product is unavailable.') }} /> : null}
        {loadedNothing ? <div className="flex min-w-0 flex-col items-center gap-2 py-6 text-center text-xs text-gray-500" data-inventory-check-empty={section}>
          <p className="break-words leading-relaxed">{section === 'sessions' ? (sessionFiltersActive ? tr('inventory_check_sessions_no_match', 'No count sessions match these filters.') : tr('inventory_check_sessions_empty', 'No count sessions yet.'))
            : section === 'issues' && !filtersActive ? tr('inventory_check_issues_empty', 'No issues found.')
              : scanMissed ? (sessionId ? tr('inventory_check_scan_not_in_session', 'Not in this session.') : tr('inventory_check_scan_no_match', 'No product with this code.'))
                : tr('inventory_check_empty', 'No matching products.')}</p>
          {(section === 'sessions' ? sessionFiltersActive : filtersActive) ? <button type="button" className="btn-secondary inline-flex min-h-10 items-center gap-1 px-3 text-xs" disabled={controlsLocked} onClick={clearFilters}><X className="h-4 w-4" aria-hidden="true" />{t('clear')}</button>
            : section === 'sessions' && access.canCheck ? <button type="button" className="btn-primary inline-flex min-h-10 items-center gap-1 px-3 text-xs" title={tr('inventory_check_count_tooltip', 'Count the products listed on this page')} onClick={() => setSection('products')}><Play className="h-4 w-4" aria-hidden="true" />{tr('inventory_check_start_page', 'Count')}</button> : null}
        </div> : null}
        {fresh ? <fieldset disabled={controlsLocked} className="min-w-0" data-inventory-check-pager-lock><PaginationControls page={page} pageSize={pageSize} totalItems={(section === 'sessions' ? sessions?.total : data?.total) ?? 0} onPageChange={value => { if (!controlsLocked) { setPage(value); setScan(null) } }} onPageSizeChange={value => { if (!controlsLocked) { setPageSize(value); setPage(1); setScan(null) } }} t={t} compact /></fieldset> : null}
        {detail && fresh ? <InventoryCheckDetailFloat product={detail} observation={observations[String(detail.id)]} unavailable={unavailableIds.has(String(detail.id))} fields={access.fields} t={t} onClose={() => setDetail(null)}
          onFixStock={fixOpening ? () => openFixStock(fixOpening) : undefined}
          onSales={offered && rights.can('sales', 'view') ? () => { queueReportsFocus(productSalesFocus(detail.name)); navigateTo('sales', hubAnchor('sales', 'reports')) } : undefined} /> : null}
        {historyPage !== null ? <InventoryCheckHistoryFloat page={historyPage} history={history} error={historyError} onPage={setHistoryPage} onRetry={() => setHistoryReload(value => value + 1)} onClose={() => setHistoryPage(null)} t={t} /> : null}
        {fixStock ? <Suspense fallback={null}><FastStockInModal
          branchOptions={branches.map(branch => ({ value: String(branch.id), label: branch.name }))} defaultBranchId={fixStock.branchId} initialMode="set" initialHeader={{ branchId: String(fixStock.branchId) }}
          initialLines={[{ mode: 'set', quantity: fixStock.quantity, reason: fixStock.reason, ...fixStock.requestId ? { requestId: fixStock.requestId } : {}, product: fixStockCandidate(fixStock, branches.find(branch => branch.id === fixStock.branchId)?.name ?? null) }]}
          tr={(key: string, fallback?: string) => tr(key, fallback ?? key)} notify={notify} onClose={() => setFixStock(null)} onDone={reloadAll} /></Suspense> : null}
        {confirmDialog}
      </div>
    </HubSectionNav>
  </div>
}
