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
import { claimSyncProblemPresentation } from '../../utils/syncProblemLifecycle.ts'
import { captureActorReadScope, captureActorWriteIdentity, isActorReadScopeCurrent, isActorWriteIdentityCurrent } from '../../api/actorReadScope.ts'
import { captureInventoryCheckWriteScope, changeInventoryCheckSession, createInventoryCheckSession, readInventoryCheckHistory, readInventoryCheckList, readInventoryCheckLots, readInventoryCheckOverlay, readInventoryCheckProducts, readInventoryCheckSession, readInventoryCheckSessions, saveInventoryCheckObservation, submitInventoryCheckCounts, type InventoryCheckApproval, type InventoryCheckSession, type InventoryCheckSessionItem, type InventoryCheckTask } from '../../api/inventoryChecksTransport.ts'
import type { QueryParams } from '../../api/query.ts'
import { currentDataEpoch } from '../../api/dataEpoch.ts'
import { peekProductSearch, primeProductSearch, getProductFilters } from '../../api/productReadTransport.ts'
import { searchProductIndex } from '../../api/productSearchIndex.ts'
import { createClientRequestId } from '../../api/requestIds.ts'
import { getInventoryCheckAccess, type InventoryCheckAccess } from '../../utils/inventoryCheckAccess.ts'
import { effectivePermissions, isAdminControlUser } from '../../utils/permissions.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { clearWorkDraft, flushPendingWorkDraft, readWorkDraft, scheduleWorkDraftWrite, scopedWorkDraftKey, writeWorkDraft } from '../../utils/workDrafts.ts'
import { isDraftAuthorityCurrent } from '../../utils/draftAuthority.ts'
import { useFrozenDraftAuthority } from '../../utils/useFrozenDraftAuthority.ts'
import { getDirtyWork, registerDirtyWork } from '../../utils/dirtyWork.ts'
import { fmtDateOnly, fmtDateTime24 } from '../../utils/formatters.ts'
import { isExactBarcodeHit } from '../../utils/scanExactHit.ts'
import { foldNativeDigits } from '../../utils/searchMatch.ts'
import { useSavedStockReasons } from '../../utils/useSavedStockReasons.ts'
import { useIsCompactViewport } from '../../utils/useViewport.ts'
import type { InventoryCheckListStatus, InventoryCheckLotRow, InventoryCheckObservation, InventoryCheckPatch, InventoryCheckProduct } from '../../types/inventoryChecks.ts'
import InventoryCheckControls, { countActiveFilters, type InventoryCheckFilters } from './InventoryCheckControls.tsx'
import InventoryCheckRows, { InventoryCheckSheetHeader, type InventoryCheckFocusRequest } from './InventoryCheckRows.tsx'
import InventoryCheckListRows, { InventoryCheckIssueBar, InventoryCheckListHeader, InventoryCheckSelectionBar, type ListDraft } from './InventoryCheckListRows.tsx'
import InventoryCheckTasksList, { TaskActions, TasksHeader, TasksReadError } from './InventoryCheckTasksList.tsx'
import { inventoryCheckTasksOff, useInventoryCheckTasks } from './useInventoryCheckTasks.ts'
import { filterScopeText, pickerText, progressOrAllText, taskRefusalSentence, taskReview, taskScopeOf } from './inventoryCheckTaskText.ts'
import { countDraftBaseKey, judgeRestored, parseCountDraft, serializeCountDraft, type CountDraftEntry } from './inventoryCheckCountDrafts.ts'
import { checkDaysOf, dayChipsOf, type CheckDay } from './inventoryCheckDays.ts'
import { finiteQuantity, parseCount } from './InventoryCheckCountEditor.tsx'
import { fixStockOpening, fixStockRequestId, type FixStockOpening } from './inventoryCheckFixStock.ts'
import { countTextFromLots, incompleteLotAnswers, lotSubmissionLine, lotTotals, rowSetPlan, splitSubmission, staleLotFigures, stockedDatesOf, uncountedDates, type SubmissionLotLine } from './inventoryCheckLots.ts'
import { adjustStock } from '../../api/inventoryWriteTransport.ts'
import { stockConflictFigures, type StockWriteAnswer } from './stockAnswerPatch.ts'
import ChipRail, { RailChip } from '../shared/kit/ChipRail.tsx'
import { oldListDropsStatus, productsServerOf, productsWireParams, sessionScopeParams, type ProductsServer } from './inventoryCheckProductsRequest.ts'
import { groupedParams, groupToAsk, inOpenGroups, type Grouping } from './inventoryCheckGroups.ts'
import { groupedListLoaded, loadGroupedList } from './inventoryCheckGroupChunk.ts'
import { activeBranchRows, soleActiveBranch } from '../../utils/branchCollapse.ts'
import { projectProduct } from './inventoryCheckProject.ts'
import type { PromotionRule } from '../../utils/promotionRules.ts'
import { loadWired, mergeWiredRows, NotWired, patchWiredLots, patchWiredRaw, readWiredRows, rememberWiredMode, wiredMode, wiredResult, type Branch, type WiredAccess, type WiredDeps, type WiredExtras, type WiredList, type WiredRaw } from './inventoryWired.ts'
import { withAppliedStock } from './inventoryCheckApprovalLines.ts'
import { withAppliedRowStock } from './inventoryCheckAppliedRows.ts'
import { useInventoryCheckApproval } from './useInventoryCheckApproval.ts'
import { productSalesFocus, queueReportsFocus } from '../sales/reports/reportsFocus.ts'
import type { InventoryCheckHistoryResult } from './InventoryCheckHistoryFloat.tsx'
import InventoryCheckSessionsList, { InventoryCheckSessionFilterMenu, ProgressRing, SessionCounts, SessionStatusChip, initialSessionFilters, sessionDisplayName, type SessionListFilters } from './InventoryCheckSessionsList.tsx'
import HubSectionNav from '../shared/HubSectionNav.tsx'
import { hubAnchor, useHubSection } from '../shared/hubNavigation.ts'
import InfoHint from '../shared/InfoHint.tsx'
import SoleBranchLabel from '../shared/SoleBranchLabel.tsx'
import StatsRangeRow from '../shared/StatsRangeRow.tsx'
import StatsStrip, { type StatCardDef } from '../shared/StatsStrip.tsx'
import PaginationControls, { TopPager } from '../shared/PaginationControls.tsx'
import { useScannerWedge, type ScanOrigin } from '../shared/useScannerWedge.ts'
import { useConfirmDialog } from '../shared/useConfirmDialog.tsx'
import { toolbarIconButtonClassName } from '../shared/toolbarButtonStyles.ts'
import { statsPresetRange, type DateTimeRange } from '../shared/statsStripPresets.ts'

// The approval panel is only drawn on a submitted count's session: it loads when one is opened, not with the list.
const InventoryCheckApprovalPanel = lazyRetry(() => import('./InventoryCheckApprovalPanel.tsx'), 'inventory-check-approval')
const InventoryCheckGroupedList = lazyRetry(loadGroupedList, 'inventory-check-groups')
// The product detail and the session history are floats opened by a tap, never part of the first paint: their code loads as their own chunks, and starts loading once the list is on screen (below),
// so the first tap finds it already there.
const loadDetailFloat = () => import('./InventoryCheckDetail.tsx')
const loadHistoryFloat = () => import('./InventoryCheckHistoryFloat.tsx')
const InventoryCheckDetail = lazyRetry(loadDetailFloat, 'inventory-check-detail')
const InventoryCheckHistoryFloat = lazyRetry(loadHistoryFloat, 'inventory-check-history')
const FastStockInModal = lazyRetry(() => import('./FastStockInModal.tsx'), 'inventory-check-fix-stock')
// The calculated-cost float (a tap on the red cost value of a row, for a viewer who may see cost): its own chunk, read on demand only.
const CostCalculationFloat = lazyRetry(() => import('../shared/CostCalculationFloat.tsx'), 'inventory-check-cost-float')

type CheckSummary = Record<InventoryCheckListStatus, number> & { total: number }
type ProductsResult = {
  items: InventoryCheckProduct[]; total: number; page: number; pageSize: number; totalPages?: number
  branches: Array<{ id: number; name: string }>
  /** Set when the server speaks the check-status contract (ic_simple): rows carry their check facts and the status filter exists. */
  simple?: boolean
  /** The rows came from the wired list (ic_wired): the Products rows plus the overlay, sorted by created or name. */
  wired?: boolean
  /** Check counts and filter options come with page 1 and with a filter change, never with a page step (the page keeps the last ones). */
  summary?: (CheckSummary & { pending?: number; /** The dates of the last counts (wired list only), newest first. */ days?: CheckDay[]; tooLarge?: undefined }) | { /** Too many checked products to count: no counts, no dates, and the status and date filters are refused. */ tooLarge: true }
  facets?: { brands?: string[]; categories?: string[] }
  facetsLimited?: { brands: boolean; categories: boolean }
  /** The rules behind the rows' promotion prices (wired answers to a viewer with the price grant). */
  promotionRules?: PromotionRule[]
  /** What the server switches on for this answer (ic_fix_stock): Fix stock and the Sales link in the detail float. */
  /** Grouped read (the server advertised capabilities.groupings and the request asked for one). */
  grouping?: Grouping
  capabilities?: { groupings?: Array<'checked' | 'category'>; fixStock?: boolean; approveCounts?: boolean; lotCounts?: boolean; directSet?: boolean; lotLinesPerSubmission?: number; productsPerSubmission?: number }
}
/** creatorName rides along from the Sessions list: the single-session read does not send it. */
type Selection = { branchId: string; sessionId: string; /** The count task being counted (the Tasks section's task view); '' or absent: the board. */ taskId?: string; /** The branch list the Tasks board read before choosing the sole branch: the remount takes it along instead of reading it again. */ knownBranches?: Branch[]; creatorName?: string | null; bootstrapIntent?: ControlIntent }
/** What the remount after the sole branch was found carries: the open request's answer, so the remount sends no second list request. */
type WiredSeed = { list: WiredList; branches: Branch[]; extras: WiredExtras }
type Section = 'products' | 'sessions' | 'tasks'
type ControlIntent = { query: string; filters: InventoryCheckFilters; pagination: { section: Section; page: number }; pageSize: number; wired?: WiredSeed }
type Attempt = { productId: number; patch: InventoryCheckPatch; revision: number; sessionRevision: number; requestId: string }
/** A search that came from Enter, the camera or a scanner gun. Nothing is ever saved by it: it narrows the list and points at the one exact row. */
type Scan = { token: number; query: string; target: InventoryCheckFocusRequest['target'] }
// Definite server refusals (the request was answered and nothing was written). Each gets its own concise message;
// unlike an unknown outcome, the frozen attempt is dropped so the operator can correct and send a fresh request.
/** The sentence for a definite server refusal (the request was answered, nothing was written), or undefined for any other failure. The table loads on first use. */
async function knownRefusal(cause: unknown) {
  const code = (cause as { code?: unknown } | null)?.code
  if (typeof code !== 'string') return undefined
  const { REFUSAL_MESSAGES } = await import('./inventoryCheckRefusals.ts')
  return Object.hasOwn(REFUSAL_MESSAGES, code) ? REFUSAL_MESSAGES[code] : undefined
}
function isStaleConflict(cause: unknown) {
  const { status, code } = (cause ?? {}) as { status?: unknown; code?: unknown }
  return status === 409 && code !== 'inventory_check_owner_required'
}
/** What the list holds for one picked or counted product until Submit: the row's own fields plus the name and the stock the person saw. */
type SubmissionLine = { productId: number; countedQuantity: number; seenQuantity: number | null; checked: boolean; note?: string } | SubmissionLotLine
type DraftEntry = CountDraftEntry
const COUNTS_WORK_KEY = 'inventory-check:counts'
const MAX_SUBMISSION = 500
/** Choosing a grouping puts the sort back at the name order. */
const NAME_ORDER = { sortBy: 'name', sortDirection: 'asc' as const }
const initialFilters: InventoryCheckFilters = { branchId: '', stockState: '', checkState: '', checkedOn: '', brand: '', category: '', sortBy: 'name', sortDirection: 'asc', group: '' }
/** The groupings this server offered (null: it answered without any; undefined: it has not answered), kept for the tab: a branch change remounts the page. */
let knownGroupings: readonly string[] | null | undefined
/** Typing waits for a pause this long before the list is read; Enter, the camera and the scanner gun read at once. */
/** How long the sync echo of a Set made in this tab is ignored. */
const OWN_SET_ECHO_MS = 10_000
const SEARCH_PAUSE_MS = 300

/** The device search index's ranked ids for typed text, or null while the index cannot answer (the server's text search then does). */
function rankText(text: string) {
  const result = searchProductIndex(text)
  return result ? { ids: result.hits.map(hit => Number(hit.id)), total: result.hits.length } : null
}
const wiredDeps: WiredDeps = {
  readList: (params, signal) => readInventoryCheckList<WiredList>(params, signal), readOverlay: (params, signal) => readInventoryCheckOverlay(params, signal),
  peek: peekProductSearch, prime: primeProductSearch, rank: rankText,
}

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
  return <InventorySelection key={boundary} boundary={boundary} access={access} isCurrent={() => authorityFence.current === boundary} />
}

function userIdentity(user: { id?: unknown } | null) { return String(user?.id ?? '') }

/** The one active branch, read from the branch list (a few rows) -- or null when there are several, none, or this account may not read the list (then the page asks as before). */
async function readSoleBranch(): Promise<Branch | null> {
  try {
    const { getBranches } = await import('../../api/branchTransport.ts')
    const sole = soleActiveBranch(await getBranches() as Array<{ id?: unknown; name?: unknown; is_active?: unknown }>)
    const id = Number(sole?.id)
    return sole && Number.isSafeInteger(id) && id > 0 ? { id, name: String(sole.name ?? '') } : null
  } catch { return null }
}

/** The active branches, read once for the Tasks board (which makes no list read, so it holds no branch list of its own); [] when this account may not read them. */
async function readActiveBranches(): Promise<Branch[]> {
  try {
    const { getBranches } = await import('../../api/branchTransport.ts')
    const list = activeBranchRows(await getBranches() as Array<{ id?: unknown; name?: unknown; is_active?: unknown }>).flatMap(row => {
      const id = Number(row.id)
      return Number.isSafeInteger(id) && id > 0 ? [{ id, name: String(row.name ?? '') }] : []
    })
    return list
  } catch { return [] }
}

function InventorySelection({ boundary, access, isCurrent }: { boundary: string; access: InventoryCheckAccess; isCurrent: () => boolean }) {
  const [selection, setSelection] = useState<Selection>({ branchId: '', sessionId: '' })
  const selected = useRef(selection)
  selected.current = selection
  const changeSelection = (next: Selection) => {
    // The branch list the Tasks board found travels with the selection: Back, a task and a branch choice never read it again.
    const value = next.knownBranches || !selected.current.knownBranches ? next : { ...next, knownBranches: selected.current.knownBranches }
    if (selected.current.branchId === value.branchId && selected.current.sessionId === value.sessionId && (selected.current.taskId ?? '') === (value.taskId ?? '')) return
    selected.current = value; setSelection(value)
  }
  return <InventoryWorkspace key={`${selection.branchId}:${selection.sessionId}:${selection.taskId ?? ''}`} boundary={boundary} access={access} selection={selection} onSelect={changeSelection} isCurrent={() => isCurrent() && selected.current === selection} />
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

function InventoryWorkspace({ boundary, access, selection, onSelect, isCurrent }: { boundary: string; access: InventoryCheckAccess; selection: Selection; onSelect: (selection: Selection) => void; isCurrent: () => boolean }) {
  const { t, user, canWriteToServer, navigateTo, notify } = useApp() as AppContextCoreValue
  const { formatPrice, exchangeRate, fmtUSD, fmtKHR } = useApp() as AppContextCoreValue
  const { branchId, sessionId } = selection
  const taskId = selection.taskId ?? ''
  const bootstrapIntent = selection.bootstrapIntent
  const tr = (key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }
  // The text key for an answer with outcome 'unknown'. A write that committed but whose cache version could not be advanced says so (saved, retry or refresh). This page then owns that
  // message, so it claims the problem's presentation: the app-wide "Write result is unknown" banner would contradict it. Claims end when the page closes.
  const savedRefreshClaims = useRef<Array<() => void>>([])
  useEffect(() => () => { savedRefreshClaims.current.forEach(release => release()); savedRefreshClaims.current = [] }, [])
  const unknownSaveKey = (cause: unknown): string => {
    const problem = (cause ?? {}) as { code?: unknown; syncErrorId?: unknown; syncErrorChannel?: unknown }
    if (problem.code !== 'inventory_check_saved_refresh') return 'inventory_check_save_unknown'
    if (typeof problem.syncErrorId === 'string' && typeof problem.syncErrorChannel === 'string') {
      savedRefreshClaims.current.push(claimSyncProblemPresentation({ actorId: userIdentity(user), requestId: problem.syncErrorId, problem: { errorId: problem.syncErrorId, channel: problem.syncErrorChannel, code: problem.code } }))
    }
    return 'inventory_check_saved_refresh'
  }
  const compact = useIsCompactViewport()
  // Tasks: for someone who may pick them up or issue them, and until this tab learned the list switch is off (GET /tasks answered 404).
  const tasksAllowed = (access.canWorkTasks || access.canIssueTasks) && !inventoryCheckTasksOff(boundary)
  const [section, setSection] = useHubSection<Section>('inventory', () => 'products', ['products', 'sessions', ...(tasksAllowed ? ['tasks'] : [])], navigateTo)
  const taskBoard = section === 'tasks' && !taskId
  const taskView = section === 'tasks' && !!taskId
  // Leaving the Tasks section by a section chip or by the hardware Back button leaves the task: while it stayed selected this screen kept the task's saved-counts key (fixed when it mounted), so counts typed on the
  // plain list were read from and written under the task. Only a move away from Tasks while mounted counts: a task opened from Count sessions mounts with the section still arriving.
  const lastSection = useRef(section)
  useEffect(() => {
    const was = lastSection.current
    lastSection.current = section
    if (was === 'tasks' && section !== 'tasks' && taskId) onSelect({ branchId, sessionId: '', taskId: '' })
  }, [section])
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
  // Collapsed groups (`by:key`): kept across page steps, cleared when a filter, the branch or the grouping changes. Collapsing reads nothing.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  // The scope (everything but the page) whose check counts and filter options `data` holds: a page step inside it asks the server to skip them -- but only a server
  // whose last answer was the check-status list (ic_simple), which is also what `productsServer` records: the older list has no counts to skip and refuses the key.
  const summaryScope = useRef('')
  const productsServer = useRef<ProductsServer>('unknown')
  // ic_wired: the raw answers behind `data` (rebuilt into rows after a by-id refresh), what the screen already learned, the open answer handed through a remount, and the visible ids another device changed.
  const wiredRaw = useRef<WiredRaw | null>(null)
  const wiredKnown = useRef<{ branches?: Branch[]; extras?: WiredExtras } | null>(bootstrapIntent?.wired ? { branches: bootstrapIntent.wired.branches, extras: bootstrapIntent.wired.extras } : null)
  const wiredSeed = useRef<WiredSeed | null>(bootstrapIntent?.wired ?? null)
  // The branches are known once an answer (or the branch list) has said them: a page step or a tab change never asks for them again.
  const branchesKnown = useRef(!!bootstrapIntent)
  const [changedIds, setChangedIds] = useState<number[]>([])
  // Rows whose received dates were read (GET /lots) after the last change elsewhere: those are current, so they are not read again. A new change event takes the row out.
  const lotsReadSince = useRef(new Set<number>())
  const [session, setSession] = useState<InventoryCheckSession | null>(null)
  const [items, setItems] = useState<InventoryCheckSessionItem[]>([])
  const [approval, setApproval] = useState<InventoryCheckApproval | null>(null)
  const [sessions, setSessions] = useState<{ items: InventoryCheckSession[]; total: number; approvals?: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sessionError, setSessionError] = useState('')
  const [writeError, setWriteError] = useState('')
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  // The claim lasts only while this page still shows its saved-refresh message (a retry that succeeds, a new write or a dismissal clears it): after that a later unknown-outcome write is the app-wide banner's again.
  useEffect(() => {
    if (!savedRefreshClaims.current.length) return
    const message = tr('inventory_check_saved_refresh', 'Saved. Retry to finish, or refresh the page.')
    if (writeError === message || Object.values(rowErrors).includes(message)) return
    savedRefreshClaims.current.forEach(release => release()); savedRefreshClaims.current = []
  }, [writeError, rowErrors])
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
  const [costFor, setCostFor] = useState<InventoryCheckProduct | null>(null)
  const [historyPage, setHistoryPage] = useState<number | null>(null)
  const [historyReload, setHistoryReload] = useState(0)
  const [history, setHistory] = useState<InventoryCheckHistoryResult | null>(null)
  const [historyError, setHistoryError] = useState('')
  const mounted = useRef(true)
  const inFlight = useRef(false)
  const ownSets = useRef(new Map<number, number>())
  const checkStateRetried = useRef(false)
  const checkedOnRetried = useRef(false)
  const attempts = useRef(new Map<number, Attempt>())
  const createAttempt = useRef<{ title: string; productIds: number[]; scope: QueryParams; requestId: string } | null>(null)
  const lifecycleAttempt = useRef<{ action: 'close' | 'resume'; revision: number; requestId: string } | null>(null)
  // Products whose count by received date left a stocked date out, found by Submit before any request was sent (the rows say which dates).
  const [uncounted, setUncounted] = useState<ReadonlySet<string>>(() => new Set())
  // The owner's way to count: what has been picked and typed on the list, held here (in memory only) until it is submitted. Keyed by product id,
  // so it survives paging and filtering; the snapshot (name, stock seen) is what the review and the server's "marked checked" test read.
  // The counts typed are also kept on this device: one key per user, branch and task (or the plain list), frozen for this mount (an account or server switch leaves a draft with its owner).
  // With no branch chosen nothing can be counted, so nothing is kept. A viewer who may not count here (or work tasks, in a task view) neither restores nor writes.
  const { authority: draftAuthority } = useFrozenDraftAuthority(branchId && access.canCheck && (!taskId || access.canWorkTasks) ? countDraftBaseKey(branchId, taskId) : null)
  const [restored] = useState(() => {
    if (!draftAuthority || !isDraftAuthorityCurrent(draftAuthority)) return null
    const stored = readWorkDraft<unknown>(draftAuthority.draftKey)
    return stored ? parseCountDraft(stored.data) : null
  })
  const [drafts, setDrafts] = useState<Record<string, DraftEntry>>(() => restored?.entries ?? {})
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts
  // `left`: how many products the cap kept back for the next Submit (they stay on the page as drafts). `taskId`: the task the count is for, part of the request's identity.
  const submitAttempt = useRef<{ requestId: string; lines: SubmissionLine[]; left: number; taskId?: string } | null>(restored?.pending ? { requestId: restored.pending.requestId, lines: restored.pending.lines as SubmissionLine[], left: restored.pending.left, ...(restored.pending.taskId ? { taskId: restored.pending.taskId } : {}) } : null)
  const [draftTick, setDraftTick] = useState(0)
  // Issue mode (picking products for a count task): the picks are in memory only (a pick is not typed work).
  const [issuing, setIssuing] = useState(false)
  const [picks, setPicks] = useState<ReadonlySet<number>>(() => new Set())
  const issueIntent = useRef(false)
  const [taskBranches, setTaskBranches] = useState<Branch[] | null>(() => selection.knownBranches ?? null)
  const taskClosedBySelf = useRef(false)
  const [writeScope] = useState(() => captureInventoryCheckWriteScope({ branchId, sessionId, epoch: 0 }, () => mounted.current && isCurrent()))
  const current = () => mounted.current && isCurrent() && isActorReadScopeCurrent(writeScope.readScope, false) && isActorWriteIdentityCurrent(writeScope.writeIdentity)
  const { askToConfirm, confirmDialog } = useConfirmDialog(t)
  const tasks = useInventoryCheckTasks({ boundary, branchId, enabled: section === 'tasks', taskId, writeScope, current, t, tr, askToConfirm, unknownSaveKey, canWriteToServer })
  const { group: groupChoice, ...listFilters } = filters
  // The date chips filter the product list only: inside a session and inside a task the date is not part of the question.
  const params: QueryParams = { ...listFilters, query: appliedQuery, page, pageSize, sessionId, checkState: filters.checkState, checkedOn: !sessionId && section === 'products' ? filters.checkedOn : '', ...(taskView ? { taskId } : {}) }
  // While a search is typed (or a code is scanned into the box) no grouping is asked for, on both servers: the answer is the flat list, from the device search index and the Products store on the wired path
  // (no extra read), and a family's date or header count can never be computed over fewer rows than the page shows. The grouping returns, with the same collapse rules, once the search is cleared.
  const groupWire = !sessionId && section !== 'sessions' && !appliedQuery.trim() ? groupToAsk(groupChoice, knownGroupings) : null
  const sessionParams: QueryParams = { branchId, page, pageSize, ...(sessionFilters.status ? { status: sessionFilters.status } : {}), ...(sessionFilters.mine ? { mine: 1 } : {}), ...(sessionFilters.waiting && sessions?.approvals ? { approval: 'pending' as const } : {}), ...(sessionRange.startDate ? { startDate: sessionRange.startDate } : {}), ...(sessionRange.endDate ? { endDate: sessionRange.endDate } : {}) }
  // scopeKey identifies WHAT is listed (filters, page, section); requestKey also changes on every refresh bump.
  // Rows stay fresh for as long as the listed scope is the loaded one, so a refresh of the same scope (the Refresh button,
  // Close/Resume or a conflict) reloads in the background while the existing rows stay mounted. A saved tick reloads nothing.
  const scopeKey = JSON.stringify([section === 'sessions' ? sessionParams : params, section, groupWire])
  const requestKey = JSON.stringify([section === 'sessions' ? sessionParams : params, section, refresh, groupWire])
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
  const priceText = typeof formatPrice === 'function' ? formatPrice : (usd: unknown) => `$${(Math.round(Number(usd || 0) * 100) / 100).toFixed(2)}`
  const wiredAccess: WiredAccess = { stock: access.fields.stock, barcode: access.fields.barcode, received: access.fields.received }

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  // Once the list is on screen the two float chunks are fetched in the background (idle), so the first tap on a product or on History finds its code already loaded.
  useEffect(() => {
    if (!fresh) return
    const idle = (globalThis as { requestIdleCallback?: (run: () => void) => number; cancelIdleCallback?: (id: number) => void })
    const start = () => { void loadDetailFloat().catch(() => null); void loadHistoryFloat().catch(() => null) }
    if (idle.requestIdleCallback) { const id = idle.requestIdleCallback(start); return () => idle.cancelIdleCallback?.(id) }
    const timer = setTimeout(start, 1500)
    return () => clearTimeout(timer)
  }, [fresh])
  const groupScope = JSON.stringify([filters, appliedQuery])
  useEffect(() => { setCollapsed(previous => previous.size ? new Set() : previous) }, [groupScope])
  const toggleGroup = useCallback((id: string) => setCollapsed(previous => { const next = new Set(previous); if (!next.delete(id)) next.add(id); return next }), [])
  const hasDrafts = Object.keys(drafts).length > 0
  const draftsRevision = useRef(0)
  const savedRevision = useRef(0)
  // Autosave: the typed counts (and a frozen Submit awaiting its answer) go to this device after a pause, on hiding the app and on leaving this view. Nothing is sent to the server.
  useEffect(() => {
    draftsRevision.current += 1
    if (!draftAuthority || !isDraftAuthorityCurrent(draftAuthority)) return
    const data = serializeCountDraft(drafts, submitAttempt.current)
    if (data) scheduleWorkDraftWrite(draftAuthority.draftKey, data)
    else clearWorkDraft(draftAuthority.draftKey)
  }, [drafts, draftTick])
  useEffect(() => () => { if (draftAuthority) flushPendingWorkDraft(draftAuthority.draftKey) }, [])
  useEffect(() => {
    if (!hasDrafts) return
    return registerDirtyWork({ key: COUNTS_WORK_KEY, pageId: 'inventory', label: tr('inventory_check_counts_in_progress', 'Counts not submitted'),
      isDirty: () => Object.keys(draftsRef.current).length > 0 && savedRevision.current !== draftsRevision.current,
      // Save & Leave: the device copy is written now (synchronously), so the guard sees nothing left dirty and navigation goes on.
      save: () => {
        const data = draftAuthority && isDraftAuthorityCurrent(draftAuthority) ? serializeCountDraft(draftsRef.current, submitAttempt.current) : null
        if (!draftAuthority || !data) return false
        writeWorkDraft(draftAuthority.draftKey, data)
        savedRevision.current = draftsRevision.current
        notify(tr('inventory_check_draft_saved', 'Draft saved on this device'), 'success')
        return true
      },
      discard: () => { submitAttempt.current = null; setDrafts({}); if (draftAuthority) clearWorkDraft(draftAuthority.draftKey) } })
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
    // A grouping is asked for until an answer has said the server has none; it defines the order, so no sort goes with it.
    const asked = groupWire && knownGroupings !== null ? groupedParams(params, groupWire) : params
    // The grouped list's chunk is fetched while the first grouped answer is on its way, and the answer is published only once both are in: the first paint is grouped, never flat and then regrouped.
    // A chunk that cannot be fetched does not hold the answer back (the list then draws through its Suspense fallback and lazyRetry's own recovery).
    const groupChunk: Promise<unknown> | null = asked.groupBy && !groupedListLoaded() ? loadGroupedList().catch(() => null) : null
    const chunkIn = async (grouped: unknown) => { if (grouped && groupChunk) await groupChunk }
    async function load() {
      try {
        // The Tasks board is its own read (useInventoryCheckTasks), never the product list.
        if (taskBoard) return
        if (section === 'sessions') {
          const result = await readInventoryCheckSessions(sessionParams, abort.signal)
          if (publish()) { setSessions(result); setLoadedKey(scopeKey) }
        } else {
          const stepScope = JSON.stringify([{ ...params, page: undefined }, section, refresh])
          // ic_wired: the Products rows plus the overlay. Only the products list of one branch or all branches: a session's own list and the all-branches Issues view keep today's path.
          if (!sessionId && wiredMode() !== 'old' && ((!params.checkState && !params.checkedOn) || branchId)) {
            const epoch = currentDataEpoch()
            const seed = wiredSeed.current
            wiredSeed.current = null
            try {
              const result = await loadWired({ params: { ...asked, branchId }, known: wiredKnown.current, seed: seed?.list ?? null, skipSummary: taskView || summaryScope.current === stepScope, bypassStore: refresh > 0, access: wiredAccess, deps: wiredDeps, signal: abort.signal })
              await chunkIn(result.raw.list.grouping)
              if (!publish()) return
              // The data epoch moved while this was in flight: the answer belongs to the old epoch, so it is dropped and the screen reads again.
              if (currentDataEpoch() !== epoch) { setRefresh(value => value + 1); return }
              rememberWiredMode('wired')
              checkStateRetried.current = false; checkedOnRetried.current = false
              const { raw } = result
              knownGroupings = raw.extras.capabilities?.groupings?.length ? raw.extras.capabilities.groupings : null
              wiredRaw.current = raw
              wiredKnown.current = { branches: raw.branches, extras: raw.extras }
              if (!branchId && raw.branches.length === 1) {
                onSelect({ branchId: String(raw.branches[0].id), sessionId: '', bootstrapIntent: { query, filters: { ...filters }, pagination: { ...pagination }, pageSize, wired: { list: raw.list, branches: raw.branches, extras: raw.extras } } })
                return
              }
              if (raw.extras.summary) summaryScope.current = stepScope
              setChangedIds([]); lotsReadSince.current.clear()
              setData(previous => wiredResult(raw, previous))
              setLoadedKey(scopeKey)
              return
            } catch (cause) {
              if (!(cause instanceof NotWired)) throw cause
              // The switch is off (or the server is older): this tab keeps today's list, from here on without asking /list again.
              if (!publish()) return
              rememberWiredMode('old')
            }
          }
          // A task is counted from the wired list only: the older list has no tasks, and must never be sent a taskId.
          if (taskView) throw new Error('A task is counted from the wired list.')
          // The sole-branch chip rule: with one active branch the branch is chosen BEFORE the first list read, so an open is ONE read (it used to read every branch, then read again with the sole one).
          // This covers the older list, and the all-branches Issues view that the wired list cannot answer without a branch; a list that cannot say it (no branch access) is asked as before.
          if (!branchId && !sessionId && !branchesKnown.current && !wiredKnown.current?.branches) {
            branchesKnown.current = true
            const sole = await readSoleBranch()
            if (!publish()) return
            if (sole) { onSelect({ branchId: String(sole.id), sessionId: '', bootstrapIntent: { query, filters: { ...filters }, pagination: { ...pagination }, pageSize } }); return }
          }
          // The switch can move under an open tab (ic_simple turned on or off), and then the key this tab holds (a status filter, Issues, a skipped summary) belongs to the other list.
          // Two outcomes, both answered in the same load by asking once in the other list's words (never a third time; a second refusal is a real error):
          //  - the other list REFUSES the key (400 inventory_check_invalid_query): ask in the other list's words;
          //  - the check-status list ANSWERS a request written in the older words, which dropped a status choice the tab holds: its rows are not the filtered ones, so ask again with the status.
          let wording: ProductsServer = productsServer.current
          let products = await readInventoryCheckProducts<ProductsResult>(productsWireParams(asked, wording, summaryScope.current === stepScope), abort.signal)
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
          await chunkIn(products.grouping)
          if (publish()) {
            // The sole branch is chosen by a remount: it remembers what the server offered. A count session's answer advertises no groupings (the server leaves them out of a
            // session's list), so only a list answer may update the learned value; otherwise Leave session would read the first list ungrouped.
            if (!sessionId) knownGroupings = products.simple === true && products.capabilities?.groupings?.length ? products.capabilities.groupings : null
            if (!branchId && !sessionId && products.branches?.length === 1) {
              onSelect({ branchId: String(products.branches[0].id), sessionId: '', bootstrapIntent: { query, filters: { ...filters }, pagination: { ...pagination }, pageSize } })
              return
            }
            productsServer.current = productsServerOf(products)
            if (products.simple !== true) summaryScope.current = ''
            else if (products.facets) summaryScope.current = stepScope
            setData(previous => products.simple && !products.facets && previous ? { ...products, summary: previous.summary, facets: previous.facets, facetsLimited: previous.facetsLimited } : products)
            setLoadedKey(scopeKey)
            checkStateRetried.current = false; checkedOnRetried.current = false
          }
        }
      } catch (cause) {
        // Refused in both lists' words: forget which list this is, so Retry starts from the words both understand.
        if (publish() && (cause as { code?: unknown } | null)?.code === 'inventory_check_invalid_query') { productsServer.current = 'unknown'; summaryScope.current = '' }
        // A stored Category choice the grant no longer allows: back to the last checked date, once (the choice cannot return to Category without a tap).
        if (publish() && groupWire === 'category' && (cause as { code?: unknown } | null)?.code === 'inventory_check_field_hidden') {
          setFilters(previous => ({ ...previous, group: '' })); return
        }
        const refusal = cause as { code?: unknown; parameter?: unknown } | null
        // A date the server will not filter by (it refuses checkedOn with a 400 that names it, or, with too many checked products to list their dates, a 503 filter_too_large) is dropped once and the list read again,
        // exactly as a refused status is: the person lands on the list of every date, never on "unavailable" with the filter still set.
        if (publish() && filters.checkedOn && !checkedOnRetried.current
          && ((refusal?.code === 'inventory_check_invalid_query' && refusal.parameter === 'checkedOn') || refusal?.code === 'inventory_check_filter_too_large')) {
          checkedOnRetried.current = true
          setFilters(previous => ({ ...previous, checkedOn: '' })); setPage(1)
          return
        }
        // A status the server no longer offers (a switch moved under this tab, or too many checked products to filter by status) is dropped once and the list read again; a second refusal shows the load error.
        if (publish() && filters.checkState && !checkStateRetried.current
          && ((refusal?.code === 'inventory_check_invalid_query' && refusal.parameter !== 'checkedOn') || refusal?.code === 'inventory_check_filter_too_large')) {
          checkStateRetried.current = true
          setFilters(previous => ({ ...previous, checkState: '' })); setPage(1)
          return
        }
        // A task view says what the server said about the task (it no longer exists, or this account may not work tasks), in that refusal's own sentence; any other failure is the generic line.
        const taskSentence = publish() && taskView && typeof refusal?.code === 'string' && refusal.code.startsWith('inventory_check_task') ? await knownRefusal(cause) : undefined
        if (publish()) setError(taskSentence ? tr(taskSentence.key, taskSentence.fallback) : tr('inventory_check_load_failed', 'Inventory checks are unavailable. Reload to try again.'))
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

  // The wired answer carries no filter options (Inventory uses Products' own, one shared read): fetched once the rows are drawn, never in front of them.
  const [wiredFacets, setWiredFacets] = useState<{ brands?: string[]; categories?: string[] } | null>(null)
  const wiredNow = data?.wired === true
  useEffect(() => {
    if (!wiredNow || wiredFacets || (!access.fields.brand && !access.fields.category)) return
    let live = true
    void getProductFilters({}).then(payload => {
      const meta = payload as { brands?: unknown[]; categories?: unknown[] } | null
      const names = (list: unknown[] | undefined) => (Array.isArray(list) ? list.map(value => String(value || '').trim()).filter(Boolean) : [])
      if (live && current()) setWiredFacets({ brands: names(meta?.brands), categories: names(meta?.categories) })
    }).catch(() => {})
    return () => { live = false }
  }, [wiredNow])
  // A sync event naming a row on screen is not read: the screen says a row changed elsewhere and a tap reads it (by id).
  const wiredVisibleKey = wiredNow ? (data?.items ?? []).map(product => product.id).join(',') : ''
  useEffect(() => {
    if (!wiredVisibleKey) return
    const visible = new Set(wiredVisibleKey.split(',').map(Number))
    const onSync = (event: Event) => {
      const detail = ((event as CustomEvent).detail || {}) as { channel?: unknown; reason?: unknown; payload?: { id?: unknown } | null }
      const channel = String(detail.channel || '').split(':')[0]
      const id = Number(detail.payload?.id)
      if (detail.reason === 'cache-refresh' || (channel !== 'products' && channel !== 'inventory') || !visible.has(id)) return
      // The echo of this tab's own Set is not "changed on another device": the row already shows the writer's figures.
      const ownAt = ownSets.current.get(id)
      if (ownAt !== undefined && Date.now() - ownAt < OWN_SET_ECHO_MS) return
      lotsReadSince.current.delete(id)
      setChangedIds(previous => previous.includes(id) ? previous : [...previous, id])
    }
    window.addEventListener('sync:update', onSync)
    return () => window.removeEventListener('sync:update', onSync)
  }, [wiredVisibleKey])
  // The by-id read behind the hint and behind a Set from the row: the rows and their overlay for those ids only. A late answer (another scope, authority or data epoch) is dropped.
  async function refreshChanged(rowIds: number[]) {
    const raw = wiredRaw.current
    if (!raw || !rowIds.length || !current()) return
    const epoch = currentDataEpoch(), key = requestKey
    try {
      const fresh = await readWiredRows(rowIds, raw.branchId, wiredDeps, wiredAccess)
      const latest = wiredRaw.current
      if (!latest || !current() || queryFence.current !== key || currentDataEpoch() !== epoch) return
      const next = mergeWiredRows(latest, fresh)
      wiredRaw.current = next
      setData(previous => wiredResult(next, previous))
      setChangedIds(previous => previous.filter(id => !rowIds.includes(id)))
      for (const id of rowIds) lotsReadSince.current.delete(id)
    } catch { if (current()) setWriteError(tr('inventory_check_load_failed', 'Could not load Inventory. Try again.')) }
  }

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

  // Another branch remounts the list; the typed counts are kept on this device per branch (and per task), so nothing is lost and nothing is asked.
  function changeFilters(patch: Partial<InventoryCheckFilters>) {
    if (controlsLocked) return
    if (patch.branchId !== undefined && patch.branchId !== branchId) { onSelect({ branchId: patch.branchId, sessionId: '' }); return }
    setFilters(previous => ({ ...previous, ...patch, ...(patch.group && patch.group !== 'none' ? NAME_ORDER : {}) })); setPage(1); setScan(null)
  }
  function changeSessionFilters(patch: Partial<SessionListFilters>) {
    if (controlsLocked) return
    setSessionFilters(previous => ({ ...previous, ...patch })); setPage(1)
  }
  // Clears search, dates and every Filters-menu choice (Sort included). A chosen branch is a selection, so clearing it re-selects "all branches".
  function clearFilters() {
    if (controlsLocked) return
    if (branchId && branches.length > 1) { onSelect({ branchId: '', sessionId: '' }); return }
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
      const refusal = (cause as { outcome?: string })?.outcome === 'unknown' ? undefined : await knownRefusal(cause)
      if (refusal) attempts.current.delete(id)
      // A definite conflict means the page is behind the server (revision, baseline or stock moved): reload it.
      if (current() && isStaleConflict(cause)) reloadAll()
      if (current()) setRowErrors(previous => ({ ...previous, [id]: refusal ? tr(refusal.key, refusal.fallback) : tr((cause as { outcome?: string })?.outcome === 'unknown' ? unknownSaveKey(cause) : 'inventory_check_save_failed', (cause as { outcome?: string })?.outcome === 'unknown' ? 'Save not confirmed. Retry the same check to recover its receipt.' : 'Check not saved. Retry the same check or reload this session.') }))
      throw cause
    } finally { inFlight.current = false; if (current()) { setBusy(false); setSavingId(null) } }
  }

  // The products a new session would hold: the checkable rows of the page on screen (unchanged membership rule).
  const countableIds = fresh && data ? [...new Set(data.items.filter(product => !product.is_group && (product as InventoryCheckProduct & { checkable?: boolean }).checkable !== false).map(product => Number(product.id)))].filter(id => Number.isSafeInteger(id) && id > 0) : []
  const branches = data?.branches?.length ? data.branches : taskBranches ?? []
  const soleBranch = branches.length === 1 ? branches[0] : null
  const branchName = branches.find(branch => String(branch.id) === (session ? String(session.branch_id) : branchId))?.name ?? null

  async function start() {
    if (!current() || !fresh || !access.canCheck || !canWriteToServer || !branchId || sessionId || !data || inFlight.current || rowEditing) return
    if (!createAttempt.current) {
      const productIds = countableIds
      if (!productIds.length || productIds.length > 500) return
      // The review shows exactly the ids that will be created; a retry after an unknown outcome reuses the frozen request below.
      const scopeText = (await import('./inventoryCheckScopeText.ts')).describeCountScope(t, { query: appliedQuery, filters, stateApplies: true })
      const confirmed = await askToConfirm({
        title: tr('inventory_check_count_review_title', 'Start a count session?'),
        items: [{ label: t('products'), value: productIds.length }, { label: t('branch'), value: branchName ?? '—' }, { label: t('filters'), value: scopeText || t('none') }],
        confirmLabel: tr('inventory_check_start_page', 'Count'),
      })
      if (!confirmed || !current() || inFlight.current) return
      createAttempt.current = { title: tr('inventory_check_page_session', 'Visible page check'), productIds, scope: { ...sessionScopeParams(params), membership: 'visible_page' }, requestId: createClientRequestId('inventory_check') }
    }
    inFlight.current = true; setBusy(true); setWriteError('')
    try {
      const result = await createInventoryCheckSession(writeScope, createAttempt.current)
      if (current()) onSelect({ branchId, sessionId: result.item.id })
    } catch (cause) {
      const refusal = (cause as { outcome?: string })?.outcome === 'unknown' ? undefined : await knownRefusal(cause)
      if (refusal) createAttempt.current = null
      if (current()) setWriteError(refusal ? tr(refusal.key, refusal.fallback) : tr((cause as { outcome?: string })?.outcome === 'unknown' ? unknownSaveKey(cause) : 'inventory_check_save_failed', 'Save not confirmed. Retry the same operation or reload.'))
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
            { label: tr('inventory_check_issue', 'Differs'), value: counts.issue }, { label: tr('inventory_check_unstarted', 'Not started'), value: counts.unstarted },
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
      const refusal = (cause as { outcome?: string })?.outcome === 'unknown' ? undefined : await knownRefusal(cause)
      if (refusal) lifecycleAttempt.current = null
      if (current()) setWriteError(refusal ? tr(refusal.key, refusal.fallback) : tr((cause as { outcome?: string })?.outcome === 'unknown' ? unknownSaveKey(cause) : 'inventory_check_save_failed', 'Save not confirmed. Retry the same operation or reload.'))
    } finally { inFlight.current = false; if (current()) setBusy(false) }
  }

  const unavailableMembers = fresh && sessionId ? items.filter(item => item.current_product_available === false) : []
  const unavailableIds = new Set(unavailableMembers.map(item => String(item.product_id)))
  const renamedMembers = new Map(fresh && sessionId ? items.filter(item => item.current_product_available === true && item.current_product_name && item.current_product_name !== item.product_snapshot.name).map(item => [String(item.product_id), item]) : [])
  const visibleProducts = fresh ? (data?.items ?? []).filter(product => !unavailableIds.has(String(product.id))).map(product => ({ ...projectProduct(product, access.fields), ...(changedIds.includes(Number(product.id)) && !lotsReadSince.current.has(Number(product.id)) ? { lots_stale: true } : {}) })) : []
  const unavailableProducts = unavailableMembers.map(item => ({ ...projectProduct(item.product_snapshot, access.fields), id: item.product_id, quantity: null, damaged_quantity: null, checkable: false }))
  const observations: Record<string, InventoryCheckObservation> = {}
  if (fresh) for (const item of items) observations[String(item.product_id)] = { product_id: item.product_id, state: item.state, counted_quantity: canViewCounts ? item.counted_quantity : null, reason: item.reason, revision: item.revision, ...(access.fields.stock ? { baseline_quantity: item.baseline_quantity, current_quantity: item.current_quantity, stock_changed: item.stock_changed } : {}), ...(item.lot_lines?.length ? { lot_lines: item.lot_lines } : {}) }
  // Row badges: renamed originals keep their current row (the starting name is behind the hint); unavailable originals sit read-only below.
  const adornments: Record<string, ReactNode> = {}
  for (const [id, item] of renamedMembers) adornments[id] = <RowBadge text={tr('inventory_check_renamed_badge', 'Renamed')} hint={`${tr('inventory_check_original_name', 'Starting name')}: ${item.product_snapshot.name} · ${tr('inventory_check_current_name', 'Current name')}: ${item.current_product_name}`} />
  const unavailableAdornments = Object.fromEntries(unavailableMembers.map(item => [String(item.product_id), <RowBadge key="unavailable" text={tr('inventory_check_unavailable_badge', 'Unavailable')} hint={tr('inventory_check_unavailable_member_hint', 'This original product is unavailable. Its saved check remains read-only.')} />]))
  const frozen = Object.fromEntries([...attempts.current.values()].map(attempt => [String(attempt.productId), { patch: attempt.patch, revision: attempt.revision }]))

  // ---- The list counts by itself: pick products, type a count in each row, Submit once ----
  const listMode = fresh && !sessionId && section !== 'sessions' && !taskBoard && !!data?.simple
  // Issue mode needs the wired list at one branch and the right to issue.
  const issuingNow = issuing && listMode && access.canIssueTasks && !!branchId && data?.wired === true
  const grouping = listMode ? data?.grouping : undefined
  // Counting a task is open to anyone the server lets count it (picked up or not); the plain list needs only the count grant. Issue mode hides the count controls (typed counts are kept).
  const selecting = listMode && access.canCheck && !issuingNow && (!taskView || access.canWorkTasks)
  const selectedIds = Object.keys(drafts).filter(id => drafts[id].selected)
  // The page-wide "matches stock" acts only on the rows the person can see: a collapsed group is left alone.
  const selectable = listMode ? inOpenGroups(visibleProducts.filter(product => !product.is_group && product.checkable !== false), grouping, collapsed) : []
  function patchDraft(product: InventoryCheckProduct, change: (current: DraftEntry) => Partial<ListDraft>) {
    if (submitAttempt.current) return
    setDrafts(previous => {
      const id = String(product.id)
      const seen = finiteQuantity(product.quantity) ? product.quantity : null
      const current = previous[id] ?? { selected: false, count: '', checked: false, note: '', name: product.name, seen }
      const next = { ...current, ...change(current), name: product.name, seen, checkAt: product.check_at ?? null }
      if (!next.selected && next.count === '' && next.note === '' && !Object.keys(next.lots ?? {}).length) { const rest = { ...previous }; delete rest[id]; return rest }
      return { ...previous, [id]: next }
    })
  }
  const draftHandlers = {
    onCount: (product: InventoryCheckProduct, value: string) => patchDraft(product, current => ({ count: value, checked: false, selected: value.trim() !== '' ? true : current.selected })),
    // "Matches stock" from the popover: every batch shown is filled with the stock it showed (a product with no batch, its total).
    onMatches: (product: InventoryCheckProduct, rows?: InventoryCheckLotRow[]) => {
      if (rows?.length) patchDraft(product, () => {
        const lots = Object.fromEntries(rows.map(row => [String(row.batchId), { count: String(row.quantity), seen: row.quantity }]))
        return { lots, count: countTextFromLots(lots), checked: false, selected: true, stocked: stockedDatesOf(product) }
      })
      else if (finiteQuantity(product.quantity)) patchDraft(product, () => ({ count: String(product.quantity), checked: true, selected: true, lots: undefined }))
    },
    // "Does not match": the entries are emptied and the row waits, picked, for the count the person found.
    onDiffers: (product: InventoryCheckProduct) => patchDraft(product, () => ({ count: '', checked: false, selected: true, lots: undefined })),
    onClear: (product: InventoryCheckProduct) => patchDraft(product, () => ({ count: '', checked: false, selected: false, note: '', lots: undefined })),
    onNote: (product: InventoryCheckProduct, value: string) => patchDraft(product, () => ({ note: value })),
    // A count typed on one received date (ic_lot_counts): the row's count is the sum of its dates.
    onLotCount: (product: InventoryCheckProduct, row: InventoryCheckLotRow, value: string) => patchDraft(product, current => {
      const lots = { ...(current.lots ?? {}) }
      if (value.trim() === '') delete lots[String(row.batchId)]
      else lots[String(row.batchId)] = { count: value, seen: row.quantity }
      return { lots, count: countTextFromLots(lots), checked: false, selected: Object.keys(lots).length > 0 ? true : current.selected, stocked: stockedDatesOf(product) ?? current.stocked }
    }),
  }
  // One tap for the whole page: every countable row without a count is answered "matches stock". Nothing is written until Submit.
  // Counting per received date (ic_lot_counts): a product whose row carries its stocked batches gets one line per stocked batch (each with the figure it showed; empty dates never), exactly what the popover's
  // tick writes; submit splits those lines within capabilities.lotLinesPerSubmission. A product whose dates the row could not carry in full (lots_more) is left for its own popover: a partial answer would
  // read as a count of only some of its dates. A product with no stocked date is answered on its total.
  async function markPageChecked() {
    if (submitAttempt.current) return
    const perBatch = lotCountsOn && !!branchId
    // A row another device changed after the list was read may carry out-of-date dates: those are read once (GET /lots) first, and a row whose read failed is left for its own popover.
    const refreshed = perBatch ? await freshenStaleRows(selectable) : new Map<number, InventoryCheckProduct>()
    if (!current() || submitAttempt.current) return
    setDrafts(previous => {
      const result = { ...previous }
      for (const listed of selectable) {
        if (perBatch && listed.lots_stale === true && !refreshed.has(Number(listed.id))) continue
        const product = refreshed.get(Number(listed.id)) ?? listed
        const id = String(product.id), seen = finiteQuantity(product.quantity) ? product.quantity : null
        const entry = result[id]
        // A row the counter already answered is never overwritten: a chosen status ("Does not match" waits for its count with an empty box), any date typed (valid or not: one typo blanks the row total), or a count.
        if (seen === null || (entry && (entry.selected || entry.count.trim() !== '' || Object.keys(entry.lots ?? {}).length > 0))) continue
        const dates = perBatch ? product.lot_rows ?? [] : []
        if (perBatch && product.lots_more === true) continue
        if (dates.length > 0) {
          const lots = Object.fromEntries(dates.map(row => [String(row.batchId), { count: String(row.quantity), seen: row.quantity }]))
          result[id] = { ...(entry ?? { note: '', name: product.name }), selected: true, count: countTextFromLots(lots), checked: false, seen, lots, stocked: stockedDatesOf(product), checkAt: product.check_at ?? null }
        } else result[id] = { ...(entry ?? { note: '', name: product.name }), selected: true, count: String(seen), checked: true, seen, lots: undefined, checkAt: product.check_at ?? null }
      }
      return result
    })
  }
  function clearSelection() {
    if (submitAttempt.current) return
    setDrafts({})
  }
  const submitBlocked = !selecting ? '' : !canWriteToServer ? tr('inventory_check_count_blocked_offline', 'Saving is unavailable while offline.')
    : !branchId ? tr('inventory_check_count_blocked_branch', 'Choose a branch first.')
    : selectedIds.length > MAX_SUBMISSION && typeof data?.capabilities?.productsPerSubmission !== 'number' ? tr('inventory_check_submit_too_many', 'Submit at most 500 products at a time.')
    : selectedIds.some(id => parseCount(drafts[id].count).kind !== 'valid') ? tr('inventory_check_submit_need_counts', 'Enter a count for every selected product.') : ''

  // ic_lot_counts: counts typed per received date, and (Full stock adjust) a Set straight from the row. Both come from the answer's capabilities; with them absent nothing here exists.
  const lotCountsOn = fresh && data?.capabilities?.lotCounts === true
  // The switch went OFF under an open tab: counts typed per date cannot be sent, and their sum is not the product's count (a partly dated product would read as a shortage), so they are dropped and asked for again.
  const datesOrphaned = !!data && !lotCountsOn && Object.values(drafts).some(entry => Object.keys(entry.lots ?? {}).length > 0)
  useEffect(() => {
    if (datesOrphaned) setDrafts(previous => Object.fromEntries(Object.entries(previous).map(([id, entry]) => [id, Object.keys(entry.lots ?? {}).length ? { ...entry, lots: undefined, count: '', checked: false } : entry])))
  }, [datesOrphaned])
  const directSetOn = lotCountsOn && data?.capabilities?.directSet === true && canWriteToServer && !!branchId
  // Set one received date to the figure typed on it. The person confirms the figure before and after; the row (and nothing else) takes the writer's answer, so no page is read.
  async function setLotFromRow(product: InventoryCheckProduct, row: InventoryCheckLotRow, text: string): Promise<number | null> {
    const plan = rowSetPlan(row, text)
    const raw = wiredRaw.current
    if (!plan || !raw || !current() || !directSetOn || inFlight.current || submitAttempt.current) return null
    const id = Number(product.id)
    const confirmed = await askToConfirm({
      title: tr('inventory_check_set_title', 'Set stock to this count?'),
      items: [{ label: product.name, value: row.receivedAt ? fmtDateOnly(row.receivedAt) : '—' }, { label: t('branch'), value: branchName ?? '—' },
        { label: tr('inventory_check_set_before_after', 'Stock now → after'), value: `${plan.before} → ${plan.after}` }],
      confirmLabel: tr('inventory_check_set', 'Set'),
    })
    if (!confirmed || !current() || inFlight.current) return null
    inFlight.current = true; setBusy(true); setWriteError('')
    let result: number | null = null
    try {
      const answer = await adjustStock({ type: 'set', setScope: 'lot', productId: id, branchId: Number(branchId), batchId: plan.batchId, quantity: plan.after, expectedLotQuantity: plan.before,
        reason: tr('inventory_check_fix_stock_reason', 'Inventory check'), client_request_id: fixStockRequestId(product.check_session_id, id) ?? createClientRequestId('inventory_set') }) as Partial<StockWriteAnswer> | null
      if (!current() || !wiredRaw.current) return null
      result = answer?.after?.lotQuantity ?? plan.after
      const next = patchWiredRaw(wiredRaw.current, { productId: id, branchId: Number(branchId), batchId: plan.batchId, after: answer?.after ?? { lotQuantity: plan.after, branchQuantity: Math.max(0, (product.quantity ?? 0) + plan.after - plan.before) } })
      wiredRaw.current = next
      setData(previous => wiredResult(next, previous))
      ownSets.current.set(id, Date.now())
      patchDraft(product, current => { const lots = { ...(current.lots ?? {}) }; delete lots[String(plan.batchId)]; return { lots, count: countTextFromLots(lots) } })
      notify(tr('inventory_check_set_done', 'Stock set'), 'success')
      // The writer closes the Issue itself when every recorded line matches after the Set and no approval waits, and says so (issue_closed): the row is patched from that flag, nothing is sent or read.
      if ((answer as { issue_closed?: unknown } | null)?.issue_closed === true) markIssueClosed(product, answer?.after?.branchQuantity ?? Math.max(0, (product.quantity ?? 0) + plan.after - plan.before))
    } catch (cause) {
      // A stale figure: the writer says what the stock is now. The row shows it and the person decides again; nothing was written.
      const figures = stockConflictFigures(cause)
      if (current() && figures && wiredRaw.current && (cause as { status?: unknown })?.status === 409) {
        const next = patchWiredRaw(wiredRaw.current, { productId: id, branchId: Number(branchId), batchId: plan.batchId, current: figures })
        wiredRaw.current = next
        setData(previous => wiredResult(next, previous))
        setWriteError(`${tr('inventory_check_set_changed', 'Stock changed. Now:')} ${figures.lotQuantity}. ${tr('inventory_check_set_changed_hint', 'Check it and press Set again.')}`)
        result = figures.lotQuantity
      } else if (current()) {
        // Each refusal says what it is (a waiting count, a disabled branch, maintenance); only an unknown failure is "not saved".
        const refusal = await knownRefusal(cause)
        setWriteError(tr(refusal?.key ?? 'inventory_check_save_failed', refusal?.fallback ?? 'Check not saved. Try again.'))
      }
    } finally { inFlight.current = false; if (current()) setBusy(false) }
    return result
  }
  function markIssueClosed(product: InventoryCheckProduct, quantity: number) {
    if (!current() || !wiredRaw.current) return
    const raw = wiredRaw.current
    const before = raw.overlay.get(Number(product.id))
    if (!before?.check || before.check.state !== 'issue') return
    const overlay = new Map(raw.overlay)
    overlay.set(Number(product.id), { ...before, check: { ...before.check, state: 'ok', counted_quantity: quantity, seen_quantity: quantity, note: null } })
    const next = { ...raw, overlay }
    wiredRaw.current = next
    setData(previous => {
      const moved = wiredResult(next, previous)
      return moved.summary && previous?.summary && moved.summary.tooLarge !== true && previous.summary.tooLarge !== true ? { ...moved, summary: { ...moved.summary, issue: Math.max(0, previous.summary.issue - 1), ok: previous.summary.ok + 1 } } : moved
    })
  }
  // The popover of a row reads that one product's received dates (batches) at this branch when it opens: one request, never the page. A branch that is not chosen has no batches to read.
  // A fresh word on a product's received dates (GET /lots, or the dates a refused incomplete count answers) goes into the rows in place: no list is read, nothing typed is touched.
  function takeLots(answers: ReadonlyArray<{ productId: number; lots: InventoryCheckLotRow[]; more?: boolean }>) {
    const raw = wiredRaw.current
    if (!raw || !current() || !answers.length) return
    let next = raw
    for (const answer of answers) { next = patchWiredLots(next, answer.productId, answer); lotsReadSince.current.add(answer.productId) }
    wiredRaw.current = next
    setData(previous => wiredResult(next, previous))
  }
  const loadLots = useCallback(async (product: InventoryCheckProduct, signal: AbortSignal) => {
    const answer = await readInventoryCheckLots({ productId: product.id, branchId }, signal)
    if (!current()) throw new Error('stale')
    if (access.fields.stock && access.fields.received) takeLots([{ productId: Number(product.id), lots: answer.lots ?? [], more: answer.more === true }])
    return answer
  }, [branchId])
  // Rows changed on another device carry dates that may be out of date (a stock-in there adds one): each is read once, in one parallel round, before the page mark uses its dates. Answers the rows by id,
  // already patched; a row whose read failed is absent.
  async function freshenStaleRows(rows: readonly InventoryCheckProduct[]): Promise<Map<number, InventoryCheckProduct>> {
    const stale = rows.filter(row => row.lots_stale === true)
    if (!stale.length || !branchId) return new Map()
    const answers = await Promise.all(stale.map(row => readInventoryCheckLots({ productId: row.id, branchId }).then(answer => ({ productId: Number(row.id), lots: answer.lots ?? [], more: answer.more === true })).catch(() => null)))
    const read = answers.filter((answer): answer is NonNullable<typeof answer> => answer !== null)
    takeLots(read)
    const raw = wiredRaw.current
    if (!raw || !current()) return new Map()
    const ids = new Set(read.map(answer => answer.productId))
    return new Map(wiredResult(raw).items.filter(item => ids.has(Number(item.id))).map(item => [Number(item.id), projectProduct(item, access.fields)]))
  }

  // The stocked received dates of a draft's product: what its row lists now (nothing when the row cannot say: its dates are stale or too many, so the server decides), else, for a product on
  // another page, what its row listed when a date was last typed on it.
  function stockedFor(id: string, entry: DraftEntry) {
    const product = visibleProducts.find(candidate => String(candidate.id) === id)
    return product ? stockedDatesOf(product) : entry.stocked
  }
  async function submit() {
    if (!current() || !selecting || submitBlocked || inFlight.current || selectedIds.length === 0) return
    if (!submitAttempt.current) {
      // A count by received date must name every stocked date of the product (the server refuses it otherwise, 409). The rows already carry the dates, so the gap is found here: no request is spent, the row says
      // which dates, and every typed count stays. The server's refusal remains the backstop for a date it knows and this screen does not (a stock-in on another device).
      if (lotCountsOn) {
        const open = selectedIds.filter(id => lotTotals(drafts[id].lots).dates > 0 && uncountedDates(stockedFor(id, drafts[id]), drafts[id].lots).length > 0)
        setUncounted(new Set(open))
        if (open.length) {
          setWriteError(`${tr('inventory_check_lots_uncounted', 'Nothing was submitted. Count every received date of each marked product, or use Matches stock.')} ${t('products')}: ${open.map(id => drafts[id].name).join(', ')}`)
          return
        }
      }
      const allLines: SubmissionLine[] = selectedIds.map(Number).sort((a, b) => a - b).map(productId => {
        const entry = drafts[String(productId)], count = parseCount(entry.count), note = entry.note.trim()
        const totals = lotTotals(entry.lots)
        if (lotCountsOn && totals.dates > 0) {
          const dated = totals.counted !== totals.seen
          const line = lotSubmissionLine(productId, entry.lots ?? {}, { checked: false, ...(dated && note ? { note } : {}) })
          if (line) return line
        }
        const countedQuantity = count.kind === 'valid' ? count.value : 0
        const differs = access.fields.stock && entry.seen !== null && countedQuantity !== entry.seen
        return { productId, countedQuantity, seenQuantity: entry.seen, checked: access.fields.stock && entry.checked && !differs, ...(differs && note ? { note } : {}) }
      })
      // One submission carries at most the plan's line cap (sent in capabilities): the lines that fit go now, the rest stay as drafts for the next Submit. Nothing is refused for being long.
      // The caps are present whenever the server enforces them (ic_lot_counts, or the wired page whose plain lines go through the same writer): the split follows the caps, not the lot switch.
      const { send, left } = splitSubmission(allLines, data?.capabilities?.lotLinesPerSubmission, data?.capabilities?.productsPerSubmission)
      if (send.length === 0) { setWriteError(tr('inventory_check_error_too_many_lines', 'This count is larger than one submission can carry. Submit part of it, then the rest.')); return }
      const lines = send
      const differing = lines.filter(line => access.fields.stock && ('lots' in line ? line.lots.some(entry => entry.seen !== null && entry.counted !== entry.seen) : line.seenQuantity !== null && line.countedQuantity !== line.seenQuantity)).length
      const confirmed = await askToConfirm({
        title: tr('inventory_check_submit_review_title', 'Submit these counts?'),
        items: [{ label: t('products'), value: lines.length }, ...left.length ? [{ label: tr('inventory_check_submit_left', 'Left for the next submit'), value: left.length }] : [], { label: t('branch'), value: branchName ?? '—' }, ...access.fields.stock ? [{ label: tr('inventory_check_differences', 'Differences'), value: differing }] : []],
        confirmLabel: tr('inventory_check_submit', 'Submit'),
      })
      if (!confirmed || !current() || inFlight.current) return
      submitAttempt.current = { requestId: createClientRequestId('inventory_check'), lines, left: left.length, ...(taskView ? { taskId } : {}) }
      setDraftTick(value => value + 1)
    }
    const attempt = submitAttempt.current
    inFlight.current = true; setBusy(true); setWriteError('')
    try {
      const answer = await submitInventoryCheckCounts(writeScope, { branchId: Number(branchId), requestId: attempt.requestId, lines: attempt.lines, ...(attempt.taskId ? { taskId: attempt.taskId } : {}) })
      if (current()) {
        const sent = new Set(attempt.lines.map(line => String(line.productId)))
        submitAttempt.current = null
        const rest = Object.fromEntries(Object.entries(draftsRef.current).filter(([id]) => !sent.has(id)))
        setDrafts(rest)
        // This count may have been the task's last: the answer says so. The device copy follows at once (a view that is about to leave would never run its autosave).
        const closedTask = answer?.task?.closed === true
        notify(closedTask ? tr('inventory_check_task_done_closed', 'All counted. The task is closed.') : attempt.left > 0 ? tr('inventory_check_submitted_part', '{sent} products submitted. {left} more are still on the page: press Submit again.').replace('{sent}', String(sent.size)).replace('{left}', String(attempt.left)) : tr('inventory_check_submitted', 'Counts submitted'), 'success')
        if (draftAuthority && isDraftAuthorityCurrent(draftAuthority)) {
          const data = serializeCountDraft(rest, null)
          if (data) writeWorkDraft(draftAuthority.draftKey, data); else clearWorkDraft(draftAuthority.draftKey)
        }
        // A close that leaves for the board does not read it here: the board reads itself when it opens (one board read, not two).
        const toBoard = closedTask && Object.keys(rest).length === 0
        if (attempt.taskId) { if (closedTask) taskClosedBySelf.current = true; if (!toBoard) void tasks.refresh() }
        if (toBoard) { onSelect({ branchId, sessionId: '', taskId: '' }); return }
        reloadAll()
      }
    } catch (cause) {
      const unknown = (cause as { outcome?: string })?.outcome === 'unknown'
      const refusal = unknown ? undefined : await knownRefusal(cause)
      if (!unknown) { submitAttempt.current = null; setDraftTick(value => value + 1) }
      if (current() && (cause as { code?: unknown })?.code === 'inventory_check_stock_changed') {
        // The products the server names were counted against stock that has moved since: their counts are withdrawn (the person counts again against the stock now shown), and so is every checked mark.
        const named = new Set(Array.isArray((cause as { productIds?: unknown }).productIds) ? ((cause as { productIds: unknown[] }).productIds).map(Number) : [])
        setDrafts(previous => Object.fromEntries(Object.entries(previous).map(([id, entry]) => [id, entry.checked || named.has(Number(id)) ? { ...entry, count: '', checked: false } : entry])))
      }
      const stale = current() && wiredRaw.current ? staleLotFigures(cause, visibleProducts, Number(branchId)) : null
      const incomplete = current() && wiredRaw.current && (cause as { code?: unknown })?.code === 'inventory_check_lots_incomplete' ? incompleteLotAnswers(cause) : null
      if (stale && wiredRaw.current) {
        // The answer names the figures the server found: the rows take them (no page is read) and the person counts again against what is shown now.
        let raw = wiredRaw.current
        for (const conflict of stale.conflicts) raw = patchWiredRaw(raw, conflict)
        wiredRaw.current = raw
        setData(previous => wiredResult(raw, previous))
      } else if (incomplete) {
        // A date was left out: the rows take the dates as they are now and every typed count stays; the person counts the missing date and submits again.
        takeLots(incomplete)
      } else if (current() && !unknown && isStaleConflict(cause)) reloadAll()
      // The server names the products whose earlier count is being applied, or that left a date out (the refusal is the same whatever figure was typed): the person is told which, and the counts are kept.
      const busy = ((cause as { code?: unknown })?.code === 'inventory_check_count_in_progress' || (cause as { code?: unknown })?.code === 'inventory_check_lots_incomplete') && Array.isArray((cause as { productIds?: unknown }).productIds)
        ? ((cause as { productIds: unknown[] }).productIds).map(id => draftsRef.current[String(id)]?.name).filter((name): name is string => typeof name === 'string' && name !== '') : []
      if (current()) setWriteError(refusal ? `${tr(refusal.key, refusal.fallback)}${busy.length ? ` ${t('products')}: ${busy.join(', ')}` : ''}${stale ? ` ${stale.changed.map(item => `${item.name}${item.receivedAt ? ` (${fmtDateOnly(item.receivedAt)})` : ''}: ${item.was ?? '—'} → ${item.now}`).join('; ')}` : ''}` : tr(unknown ? unknownSaveKey(cause) : 'inventory_check_save_failed', unknown ? 'Save not confirmed. Retry the same operation or reload.' : 'Check not saved. Try again.'))
    } finally { inFlight.current = false; if (current()) setBusy(false) }
  }
  // Counts approval (ic_fix_stock): approving changes stock, so the person must hold the extra, may adjust stock and be online.
  const canDecide = fresh && !!approval && approval.can_approve && data?.capabilities?.approveCounts === true && canWriteToServer
  // Closing moves no stock, so it needs the extra but not the right to adjust stock.
  const canClose = fresh && !!approval && approval.can_approve && canWriteToServer
  // Lines the approval applied: the panel's items and the session's product rows take the stock the answer says (no read), as Fix stock does for its row.
  function takeAppliedStock(stock: Record<string, number>) {
    setItems(previous => withAppliedStock(previous, stock))
    setData(previous => previous ? { ...previous, items: withAppliedRowStock(previous.items ?? [], stock, items) } : previous)
  }
  const { refusedLines, lineErrors, decideApproval, decideLine } = useInventoryCheckApproval({ sessionId, approval, items, capabilities: data?.capabilities, writeScope, inFlight, current, setBusy, setApproval, setWriteError,
    askToConfirm, tr, notify, knownRefusal, unknownSaveKey, reload: reloadAll, setApplied: takeAppliedStock })
  // The owner's summary: check counts only. A session shows its own counts in the session bar, and the old contract sends none.
  const checkInfo = !sessionId && !!data?.simple
  const summary = fresh && checkInfo ? data?.summary : undefined
  // Too many checked products to count: the server sends no counts and no dates and refuses the status and date filters, so none of those controls is drawn (a chip would only lead to a refusal).
  const tooLarge = summary?.tooLarge === true
  const counts = summary && summary.tooLarge !== true ? summary : undefined
  // The wired page has no "In check" (nothing is in a session there) and, with a branch chosen, its one status choice is the chip rail: the numbers ride on its chips.
  const cards: StatCardDef[] = counts ? (['not_checked', 'in_check', 'ok', 'issue'] as const).filter(key => !(data?.wired === true && key === 'in_check')).map(key => ({
    key, label: tr(key === 'issue' ? 'inventory_check_status_differs' : `inventory_check_status_${key}`, key === 'not_checked' ? 'Not checked' : key === 'in_check' ? 'In check' : key === 'ok' ? 'Checked OK' : 'Differs'), value: counts[key],
  })) : []
  // The status choice, in one row that scrolls sideways (the shared chip rail): every status the viewer can see, with how many products are in it.
  const statusChips: Array<{ value: string; label: string; count?: number }> = [{ value: '', label: t('all') },
    { value: 'not_checked', label: tr('inventory_check_status_not_checked', 'Not checked'), count: counts?.not_checked },
    { value: 'ok', label: tr('inventory_check_status_ok', 'Checked OK'), count: counts?.ok },
    { value: 'issue', label: tr('inventory_check_status_differs', 'Differs'), count: counts?.issue },
    ...(data?.capabilities?.fixStock && counts?.pending !== undefined ? [{ value: 'pending', label: tr('inventory_check_approval_pending', 'Waiting for approval'), count: counts.pending }] : [])]
  const rowEditing = Object.values(editingRows).some(Boolean)
  const controlsLocked = busy || !!createAttempt.current || rowEditing
  // The date chips (the wired list at one branch only: counts are per branch, and the server sends no days for too many products). The chosen day stays on the rail even if the summary stops listing it, so "All" is always one tap away.
  const dayChips = wiredNow && !sessionId && section === 'products' && branchId && !tooLarge ? dayChipsOf(checkDaysOf(data?.summary), filters.checkedOn ?? '') : []
  // The row stays on screen while a read is under way (the chips wait, the counting buttons are disabled): it never flickers away with the list.
  const barShown = checkInfo && section !== 'sessions' && (access.canCheck || dayChips.length > 0)
  // "Not checked" products have no date, so a date beside it would always be an empty list: choosing a date leaves that status.
  function chooseDay(day: string) { changeFilters({ checkedOn: day, ...(day && filters.checkState === 'not_checked' ? { checkState: '' } : {}) }) }
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
  // (its unstarted | done | issue) -- so no choice is drawn for it on the Products list, and none before the first answer.
  const statusFilter = !!data && (data.simple === true || !!sessionId)
  const filtersActive = countActiveFilters(filters, { branch: branches.length > 1, state: statusFilter, group: !!grouping }) > 0 || !!query.trim() || !!filters.checkedOn
  const sessionFiltersActive = !!(sessionFilters.status || sessionFilters.mine || sessionFilters.waiting || sessionRange.startDate || sessionRange.endDate || (branches.length > 1 && !!branchId))
  const loadedNothing = !taskBoard && !loading && fresh && !unavailableProducts.length && !(section === 'sessions' ? sessions?.items.length : visibleProducts.length)

  // A scan points at the one exact row of the list on screen (product rows only: Count sessions and the Tasks board have none).
  const showsProductRows = section !== 'sessions' && !taskBoard
  const scanHit = scan && fresh && showsProductRows ? scanHitOf(visibleProducts, scan.query, access.fields.barcode) : null
  const focusRequest: InventoryCheckFocusRequest | undefined = scan && scanHit ? { id: scanHit.id, token: scan.token, target: scan.target } : undefined
  const scanMissed = !!scan && loadedNothing && showsProductRows
  // A scanned code is a typed search, which is answered flat: no groups, so nothing is collapsed around the hit.
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

  const rowProps = { canViewStock: access.fields.stock, canViewCounts, t, onOpenProduct: setDetail } as const
  const rowRefusals: Record<string, string> = {}
  for (const id of uncounted) {
    const entry = drafts[id]
    const missing = entry && lotTotals(entry.lots).dates > 0 ? uncountedDates(stockedFor(id, entry), entry.lots) : []
    if (missing.length) rowRefusals[id] = tr('inventory_check_lots_uncounted_row', 'Not counted: {dates}').replace('{dates}', missing.map(date => date.receivedAt ? fmtDateOnly(date.receivedAt) : '—').join(', '))
  }
  // Fetched already (the usual case: it came with the answer): drawn directly, so no Suspense turn and no flat frame. Otherwise the lazy wrapper, as before.
  const GroupedList = groupedListLoaded()?.default ?? InventoryCheckGroupedList
  const listRowProps = { products: visibleProducts, drafts, selecting, rowRefusals, locked: busy || !!submitAttempt.current, ...(issuingNow ? { picks, onPick: togglePick } : {}), canViewStock: access.fields.stock, canViewCounts,
    ...(access.fields.price ? { priceText, promotionRules: data?.promotionRules, exchangeRate } : {}),
    // Cost only for a viewer canViewAcquisitionCosts allows (fields.cost); the Worker sends the cost keys to nobody else either.
    ...(access.fields.cost ? { costText: priceText, onOpenCost: setCostFor } : {}), focusRequest, onCountEntered: onCommitted, t, onOpenProduct: setDetail, ...draftHandlers,
    ...(lotCountsOn && branchId ? { lotCounts: true, loadLots, onLotSet: directSetOn ? setLotFromRow : undefined } : {}) }
  const canCheckRows = fresh && canEdit && session?.status === 'open' && canWriteToServer && !lifecycleAttempt.current
  // One column header for the whole list, pinned with the controls: the rows below line up under it from 1024px.
  const sheetHeader = fresh && visibleProducts.length && section !== 'sessions' && !taskBoard
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
  // The session that holds the waiting request: the overlay names it. The product's latest count may be a newer session (an observation made after the submission), which has no approval.
  const pendingSessionOf = (product: InventoryCheckProduct): string | null => product.pending_session_id ?? product.check_session_id ?? null
  // A product waiting for approval opens that session: the panel with Approve all and the per-line decisions.
  function openRequest(branch: string, session: string) {
    setDetail(null); setSection('products'); onSelect({ branchId: branch, sessionId: session })
  }
  function openFixStock(opening: FixStockOpening) {
    // The Set session resumes an unfinished stock session of this person instead of opening a new one: say so rather than open something else.
    const unfinished = readWorkDraft<{ lines?: unknown }>(scopedWorkDraftKey('fast_stockin'))?.data?.lines
    if (Array.isArray(unfinished) && unfinished.length) { notify(tr('inventory_check_fix_stock_open_draft', 'Finish or discard your open stock session first.'), 'warning'); return }
    setDetail(null)
    setFixStock(opening)
  }
  // ---- Count tasks: the board, issuing, picking up, handing back, closing ----
  const taskRow: InventoryCheckTask | null = taskView ? tasks.board?.items.find(item => item.id === taskId) ?? null : null
  // A task the board no longer lists (an old one): its bar says what the list answered about it (closed or open, how many products) instead of pulsing for a progress that will never come.
  const boardSettled = !!tasks.board || tasks.failed || !!tasks.refusal
  const listTask = taskView && fresh ? wiredRaw.current?.list.task : undefined
  const hasWiredBranchList = !!data?.branches?.length
  useEffect(() => {
    if (!taskBoard || hasWiredBranchList || taskBranches) return
    let live = true
    void readActiveBranches().then(list => { if (live && current()) setTaskBranches(list) })
    return () => { live = false }
  }, [taskBoard, hasWiredBranchList])
  // The board makes no list read, so the one active branch is chosen here (as a list open chooses it).
  useEffect(() => {
    if (taskBoard && !branchId && branches.length === 1) onSelect({ branchId: String(branches[0].id), sessionId: '', knownBranches: branches })
  }, [taskBoard, branchId, branches.length])
  // Leaving Inventory ends Issue mode; the Tasks board's Issue button asks for it, and it opens once the Inventory section shows.
  useEffect(() => {
    if (section !== 'products') { setIssuing(false); setPicks(new Set()); return }
    if (issueIntent.current) { issueIntent.current = false; setIssuing(true) }
  }, [section])
  function togglePick(product: InventoryCheckProduct) {
    const id = Number(product.id)
    setPicks(previous => { const next = new Set(previous); if (!next.delete(id)) next.add(id); return next })
  }
  const issueScope = taskScopeOf(picks, { query: appliedQuery, filters })
  const maxProducts = tasks.board?.capabilities.maxProducts
  // A frozen attempt (after an unknown outcome) is resent as it was, whatever the page shows now.
  const issueBlocked = tasks.retrying === 'issue' ? ''
    : !issueScope ? tr('inventory_check_task_scope_needed', 'Select products or set a filter first.')
      : typeof maxProducts === 'number' && picks.size > maxProducts ? taskRefusalSentence(t, { code: 'inventory_check_task_too_many', total: picks.size, limit: maxProducts }) ?? '' : ''
  async function issueTask() {
    if (!current() || !issuingNow || issueBlocked || tasks.busy) return
    const scope = issueScope
    if (!scope) return
    const review = {
      title: tr('inventory_check_task_issue_review_title', 'Issue a count task?'),
      items: [...'productIds' in scope ? [{ label: t('products'), value: scope.productIds.length }] : [{ label: t('filters'), value: filterScopeText(t, scope.filters.query ?? '', scope.filters) }], { label: t('branch'), value: branchName ?? '—' }],
      confirmLabel: tr('inventory_check_task_issue', 'Issue'),
    }
    setWriteError('')
    const outcome = await tasks.issue(Number(branchId), scope, review)
    if (!current()) return
    if (outcome.kind === 'done') {
      const item = (outcome.result as { item?: InventoryCheckSession } | null)?.item
      notify(tr('inventory_check_task_issued', 'Task issued · {count} products').replace('{count}', String(item?.progress?.total ?? '')), 'success')
      setIssuing(false); setPicks(new Set())
    } else if (outcome.kind === 'refused') {
      setWriteError(outcome.message)
      if (outcome.code === 'inventory_check_issue_required') setIssuing(false)
    } else if (outcome.kind === 'unknown') setWriteError(outcome.message)
  }
  const draftKeyOfTask = (id: string) => scopedWorkDraftKey(countDraftBaseKey(branchId, id))
  // How many counts this device holds, typed and not submitted, for a task (the open view's own, or the device copy of another).
  function draftCountOfTask(task: InventoryCheckTask): number {
    if (taskView && task.id === taskId) return Object.keys(draftsRef.current).length
    const stored = readWorkDraft<unknown>(draftKeyOfTask(task.id))
    return stored ? Object.keys(parseCountDraft(stored.data)?.entries ?? {}).length : 0
  }
  function toastOrError(outcome: { kind: 'refused'; message: string; tone: 'warning' | 'error' } | { kind: 'unknown'; message: string }) {
    if (outcome.kind === 'refused' && outcome.tone === 'warning') notify(outcome.message, 'warning')
    else setWriteError(outcome.message)
  }
  async function pickupTask(task: InventoryCheckTask) {
    if (!current()) return
    setWriteError('')
    const outcome = await tasks.pickup(task, taskReview(t, 'pickup', task, branchName), { leaving: !taskView })
    if (!current()) return
    if (outcome.kind === 'done') { if (!taskView) onSelect({ branchId, sessionId: '', taskId: task.id }) }
    else if (outcome.kind === 'refused' || outcome.kind === 'unknown') toastOrError(outcome)
  }
  // Handing back gives the task up: the counts typed for it on this device go (the review says how many).
  async function releaseTask(task: InventoryCheckTask) {
    if (!current()) return
    setWriteError('')
    const count = draftCountOfTask(task)
    const outcome = await tasks.release(task, taskReview(t, 'release', task, branchName, count), { leaving: taskView })
    if (!current()) return
    if (outcome.kind === 'done') {
      if (count > 0) {
        clearWorkDraft(draftKeyOfTask(task.id))
        if (taskView && task.id === taskId) { submitAttempt.current = null; setDrafts({}) }
      }
      if (taskView) onSelect({ branchId, sessionId: '', taskId: '' })
    } else if (outcome.kind === 'refused' || outcome.kind === 'unknown') toastOrError(outcome)
  }
  async function closeTask(task: InventoryCheckTask) {
    if (!current()) return
    setWriteError('')
    const outcome = await tasks.close(task, taskReview(t, 'close', task, branchName))
    if (current() && (outcome.kind === 'refused' || outcome.kind === 'unknown')) toastOrError(outcome)
  }
  const openTasks = tasks.board?.items.filter(item => item.status === 'open').length ?? 0
  const headerIssueBlocked = tasks.board && openTasks >= tasks.board.capabilities.maxOpenTasks ? tr('inventory_check_error_task_limit', 'This branch already has the most open tasks it can hold. Close one first.') : ''
  // Restore: the counts this device held for this view are judged once, against what the server knows now. A product counted after the draft was typed shows a different last-count time
  // (compared server to server, never with this device's clock): its draft is dropped. Off-page products are judged by one overlay read per page of ids.
  const judged = useRef(false)
  useEffect(() => {
    if (judged.current || !restored || !fresh || !listMode || !wiredRaw.current) return
    judged.current = true
    const entries = restored.entries
    const ids = Object.keys(entries).map(Number)
    if (!ids.length) return
    const latest = new Map<number, string | null | undefined>()
    const onPage = new Set<number>()
    for (const product of data?.items ?? []) { onPage.add(Number(product.id)); latest.set(Number(product.id), product.check_at ?? null) }
    const missing = ids.filter(id => !onPage.has(id))
    const chunk = Number.isSafeInteger(wiredRaw.current.list.overlay_ids) && (wiredRaw.current.list.overlay_ids as number) > 0 ? wiredRaw.current.list.overlay_ids as number : 100
    void (async () => {
      try {
        for (let start = 0; start < missing.length; start += chunk) {
          const answer = await readInventoryCheckOverlay<{ items?: Array<{ product_id: number; check?: { at?: string | null } | null }> }>({ branchId, ids: missing.slice(start, start + chunk), summary: false })
          for (const item of answer.items ?? []) latest.set(Number(item.product_id), item.check?.at ?? null)
        }
      } catch { /* a read that fails judges nothing: the counts stay, and Submit's own refusals decide */ }
      if (!current()) return
      const { dropped } = judgeRestored(entries, latest)
      // Only an entry still exactly as it was restored is dropped: a count typed meanwhile is never touched.
      if (dropped.length) setDrafts(previous => { const next = { ...previous }; for (const id of dropped) if (next[id] === entries[id]) delete next[id]; return next })
      if (ids.length > dropped.length) notify(tr('inventory_check_draft_restored', 'Counts restored from this device.'), 'info')
      if (dropped.length) notify(tr('inventory_check_draft_dropped', '{count} counts removed: counted elsewhere after you typed them.').replace('{count}', String(dropped.length)), 'info')
    })()
  }, [fresh, listMode])
  const issueEntry = section === 'products' && listMode && !!branchId && data?.wired === true && access.canIssueTasks
    ? <IconAction label={tr('inventory_check_task_issue', 'Issue')} disabled={controlsLocked} onClick={() => setIssuing(true)}><ClipboardList className="h-5 w-5" aria-hidden="true" /></IconAction> : null
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
  // The task view's bar: back to the board, the task's progress and picker (from the board read), and its actions. Submit stays the view's one labelled action.
  const taskBar = <div className="flex min-w-0 flex-1 items-center gap-1" data-inventory-check-actions data-inventory-check-task-bar>
    <IconAction label={t('back')} disabled={controlsLocked || tasks.busy} onClick={() => onSelect({ branchId, sessionId: '', taskId: '' })}><ArrowLeft className="h-5 w-5" aria-hidden="true" /></IconAction>
    {taskRow ? <div className="scroll-x-clean min-w-0 flex-1">
      <div className="inline-flex items-center gap-2 align-middle text-xs">
        <ProgressRing progress={{ total: taskRow.total, done: taskRow.done, issue: 0, unstarted: Math.max(0, taskRow.total - taskRow.done) }} t={t} />
        <span className="shrink-0 tabular-nums" data-task-progress-text>{progressOrAllText(t, taskRow)}</span>
        {taskRow.picked_up_by ? <span className={`shrink-0 ${taskRow.mine ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'text-gray-600 dark:text-gray-300'}`} data-task-picker>{pickerText(t, taskRow.picked_up_by)}</span> : null}
        {taskRow.status === 'closed' ? <SessionStatusChip status="closed" t={t} /> : null}
      </div>
    </div> : boardSettled ? (listTask ? <div className="scroll-x-clean min-w-0 flex-1" data-task-off-board>
      <div className="inline-flex items-center gap-2 align-middle text-xs">
        {listTask.status === 'closed' ? <SessionStatusChip status="closed" t={t} /> : null}
        <span className="shrink-0 tabular-nums">{t('products')}: {listTask.total}</span>
      </div>
    </div> : <span className="min-w-0 flex-1" />) : <span className="h-4 min-w-0 flex-1 animate-pulse rounded bg-gray-200 dark:bg-zinc-700" aria-hidden="true" />}
    {taskRow ? <TaskActions size="bar" task={taskRow} t={t} busy={tasks.busy || controlsLocked} canWork={access.canWorkTasks} onPickup={() => { void pickupTask(taskRow) }} onRelease={() => { void releaseTask(taskRow) }} onClose={() => { void closeTask(taskRow) }} /> : null}
  </div>
  // The page controls, drawn above the list and below it from the SAME state: one request per page step, the true total, no second fetch. Count sessions page exactly like products.
  const pager = fresh && !taskBoard ? <fieldset disabled={controlsLocked} className="min-w-0" data-inventory-check-pager-lock><PaginationControls page={page} pageSize={pageSize} totalItems={(section === 'sessions' ? sessions?.total : data?.total) ?? 0} onPageChange={value => { if (!controlsLocked) { setPage(value); setScan(null) } }} onPageSizeChange={value => { if (!controlsLocked) { setPageSize(value); setPage(1); setScan(null) } }} t={t} compact /></fieldset> : null
  const pagerNode = (position: 'top' | 'bottom') => pager ? <div data-inventory-check-pager={position} className="min-w-0">{position === 'top' ? <TopPager>{pager}</TopPager> : <>{pager}</>}</div> : null
  // The context bar: where the person is (the one branch, or the open session) and what they can do from here.
  const contextBar = <div className="flex min-w-0 flex-1 items-center gap-1" data-inventory-check-context>
    {sessionId ? sessionBar : taskView ? taskBar : <>
      {soleBranch ? <SoleBranchLabel name={soleBranch.name} label={t('branch')} className="min-w-0 flex-1 text-xs" /> : <span className="flex-1" />}
      {countAction}
      {issueEntry}
    </>}
  </div>

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <HubSectionNav pageId="inventory" active={section} sections={[
      { id: 'products', label: t('inventory') }, { id: 'sessions', label: t('inventory_check_sessions') }, ...(tasksAllowed ? [{ id: 'tasks', label: t('inventory_check_tasks') }] : []),
    ]} onChange={id => { if (!busy && !createAttempt.current) { setSection(id as Section); setScan(null) } }}>
      <div className="page-scroll min-w-0 space-y-2 px-3 pb-3" data-inventory-check-page>
        {/* Pinned: dates (with the Stats chip), then search / scan / Filters beside the context bar, then the column header. Open stat cards scroll inside the cap. */}
        <div className="sticky top-0 z-30 -mx-3 max-h-[calc(70*var(--app-vh))] min-w-0 space-y-1 overflow-y-auto bg-gray-50 px-3 pb-1 pt-2 dark:bg-gray-900" data-inventory-check-pinned>
          {taskBoard
            ? <TasksHeader t={t} branches={branches} branchId={branchId} onBranch={id => onSelect({ branchId: id, sessionId: '', ...(branches.length ? { knownBranches: branches } : {}) })} issue={access.canIssueTasks} issueBlocked={headerIssueBlocked} busy={tasks.busy}
              onIssue={() => { issueIntent.current = true; setSection('products') }} />
            : section === 'sessions'
            ? <StatsRangeRow layout="scroll" compactRange range={sessionRange} disabled={controlsLocked} t={t} onRangeChange={value => { if (!controlsLocked) { setSessionRange(value); setPage(1) } }}
              leading={<fieldset disabled={controlsLocked} className="min-w-0 shrink-0" data-inventory-check-query-lock>
                <InventoryCheckSessionFilterMenu value={sessionFilters} onChange={changeSessionFilters} approvals={sessions?.approvals === true} branches={branches} branchId={branchId} onBranchChange={id => changeFilters({ branchId: id })} onClear={clearFilters} t={t} />
              </fieldset>} />
            : <>
              {checkInfo && !tooLarge && !(wiredNow && statusFilter && branchId) ? <StatsStrip layout="scroll" cards={cards} t={t} loading={loading || !fresh} /> : null}
              {checkInfo && !tooLarge && statusFilter && branchId ? <ChipRail label={t('inventory_check_state')} data-inventory-check-status-rail>
                {statusChips.map(chip => <RailChip key={chip.value || 'all'} selected={filters.checkState === chip.value} disabled={controlsLocked} onClick={() => changeFilters({ checkState: chip.value, ...(chip.value === 'not_checked' ? { checkedOn: '' } : {}) })}
                  badge={chip.count === undefined ? undefined : <span className="tabular-nums opacity-70">{chip.count}</span>}>{chip.label}</RailChip>)}
              </ChipRail> : null}
              <div className="flex min-w-0 flex-col gap-1 lg:flex-row lg:items-center lg:gap-2">
                <fieldset disabled={controlsLocked} className="min-w-0 lg:w-[26rem] lg:shrink-0" data-inventory-check-query-lock>
                  <InventoryCheckControls query={query} onQueryChange={typeQuery} onQuerySubmit={submitQuery} searchRef={searchRef} scanLabelled={compact && !!sessionId && canCheckRows}
                    filters={filters} onFiltersChange={changeFilters} onClear={clearFilters} fields={access.fields}
                    inSession={!!sessionId} showStateFilter={statusFilter} limited={facetsLimited} wired={wiredNow} groupings={!sessionId && fresh ? data?.capabilities?.groupings : undefined}
                    branches={branches} brands={data?.facets?.brands ?? wiredFacets?.brands} categories={data?.facets?.categories ?? wiredFacets?.categories} t={t} />
                </fieldset>
                {contextBar}
              </div>
              {issuingNow ? <InventoryCheckIssueBar pickedCount={picks.size} blocked={issueBlocked} busy={tasks.busy || busy} issueLabel={tasks.retrying === 'issue' ? t('retry') : undefined}
                onExit={() => { setIssuing(false); setPicks(new Set()) }} onClear={() => setPicks(new Set())} onIssue={() => { void issueTask() }} t={t} />
              : barShown && !(taskView && !access.canWorkTasks) ? <InventoryCheckSelectionBar selectedCount={selectedIds.length} blocked={submitBlocked} busy={busy || !listMode} canMarkChecked={access.fields.stock} openGroupsOnly={collapsed.size > 0}
                counting={access.canCheck} days={dayChips} checkedOn={filters.checkedOn ?? ''} onCheckedOn={chooseDay} daysDisabled={controlsLocked || !fresh}
                submitLabel={submitAttempt.current ? t('retry') : undefined} onMarkChecked={markPageChecked} onClear={clearSelection} onSubmit={() => { void submit() }} t={t} /> : null}
              {sheetHeader}
            </>}
        </div>
        {pagerNode('top')}
        {writeError ? <p role="alert" className="text-xs leading-relaxed text-red-700">{writeError}</p> : null}
        {taskView && taskRow?.status === 'closed' && !taskClosedBySelf.current ? <p role="status" className="text-xs leading-relaxed text-amber-800 dark:text-amber-200" data-task-status-line="closed">{tr('inventory_check_error_task_closed', 'This task is already closed.')}</p> : null}
        {taskView && tasks.handedBack && taskRow?.status === 'open' ? <p role="status" className="text-xs leading-relaxed text-amber-800 dark:text-amber-200" data-task-status-line="handed-back">{tr('inventory_check_task_handed_back', 'This task was handed back. Your counts are kept.')}</p> : null}
        {section === 'tasks' && tasks.refusal ? <p role="alert" className="text-xs leading-relaxed text-red-700" data-tasks-refusal>{tasks.refusal}</p> : null}
        {section === 'tasks' && tasks.failed ? <TasksReadError text={tr('inventory_check_load_failed', 'Could not load Inventory. Try again.')} retry={t('retry')} onRetry={() => { void tasks.refresh() }} /> : null}
        {wiredNow && fresh && changedIds.length ? <div role="status" className="flex items-center justify-between gap-2 text-xs leading-relaxed text-amber-800 dark:text-amber-200" data-inventory-check-changed-elsewhere>
          <span className="min-w-0 break-words">{tr('inventory_check_changed_elsewhere', 'Changed on another device. Tap to refresh.')} ({changedIds.length})</span>
          <button type="button" className="btn-secondary inline-flex min-h-8 shrink-0 items-center gap-1 px-2 text-xs" disabled={controlsLocked} onClick={() => { void refreshChanged(changedIds) }}><RotateCcw className="h-4 w-4" aria-hidden="true" />{t('refresh')}</button>
        </div> : null}
        {error || sessionError ? <div role="alert" className="flex items-center justify-between gap-2 text-xs leading-relaxed text-red-700">
          <span className="min-w-0 break-words">{error || sessionError}</span>
          <IconAction label={t('retry')} onClick={reloadAll}><RotateCcw className="h-4 w-4" aria-hidden="true" /></IconAction>
        </div> : null}
        {sessionId && fresh && approval && session?.scope?.membership === 'submission'
          ? <Suspense fallback={null}><InventoryCheckApprovalPanel approval={approval} items={items} canDecide={canDecide} canClose={canClose} busy={busy} refused={refusedLines} lineErrors={lineErrors} t={t}
            onApprove={() => { void decideApproval('approve') }} onReject={() => { void decideApproval('reject') }} onClose={() => { void decideApproval('close') }}
            onAccept={productId => { void decideApproval('approve', [productId]) }} onModify={(productId, figures) => decideLine({ productId, action: 'modify', ...figures })}
            onRejectLine={productId => { void decideLine({ productId, action: 'reject' }) }} onReopen={productId => { void decideLine({ productId, action: 'reopen' }) }} /></Suspense> : null}
        {!taskBoard && !fresh && !error && !sessionError ? <ListSkeleton loadingText={t('loading')} /> : null}
        {taskBoard ? (!branchId ? <div className="min-w-0 space-y-2" data-tasks-choose-branch>
          <p role="status" className="text-xs leading-relaxed text-gray-600 dark:text-gray-300">{tr('inventory_check_count_blocked_branch', 'Choose a branch first.')}</p>
          {branches.length > 1 ? <ChipRail label={t('branch')}>{branches.map(branch => <RailChip key={branch.id} selected={false} onClick={() => onSelect({ branchId: String(branch.id), sessionId: '', knownBranches: branches })}>{branch.name}</RailChip>)}</ChipRail> : null}
        </div>
          : tasks.board ? <InventoryCheckTasksList board={tasks.board} t={t} canWork={access.canWorkTasks} busy={tasks.busy}
            onOpen={task => onSelect({ branchId, sessionId: '', taskId: task.id })} onPickup={task => { void pickupTask(task) }} onRelease={task => { void releaseTask(task) }} onClose={task => { void closeTask(task) }} />
            : tasks.failed || tasks.off || tasks.refusal ? null : <ListSkeleton loadingText={t('loading')} />)
          : section === 'sessions' ? (fresh && sessions?.items.length ? <InventoryCheckSessionsList items={sessions.items} t={t} onOpen={item => {
            // A pickup holds no items: its row opens the task it is for, never a session sheet.
            if (item.scope?.membership === 'pickup') { setSection('tasks'); onSelect({ branchId: String(item.branch_id), sessionId: '', taskId: item.task?.id ?? String(item.scope.task) }); return }
            setSection('products'); onSelect({ branchId: String(item.branch_id), sessionId: item.id, creatorName: item.creator_name ?? null })
          }} /> : null)
          : listMode ? (grouping
            ? <Suspense fallback={<InventoryCheckListRows {...listRowProps} />}><GroupedList {...listRowProps} grouping={grouping} collapsed={collapsed} onToggle={toggleGroup} /></Suspense>
            : <InventoryCheckListRows {...listRowProps} />)
          : <InventoryCheckRows key={scopeKey} products={visibleProducts} observations={observations} errors={rowErrors} adornments={adornments} frozen={frozen} pending={Object.fromEntries(visibleProducts.map(product => [String(product.id), savingId === Number(product.id)]))} locked={busy}
            canCheck={canCheckRows} inSession={!!sessionId} sheetHeader="external" reasonSuggestions={savedReasons.map(reason => reason.label)} focusRequest={focusRequest} onCommitted={onCommitted}
            {...rowProps} onEditingChange={onEditingChange} onSave={save} />}
        {section !== 'sessions' && unavailableProducts.length ? <InventoryCheckRows products={unavailableProducts} observations={observations} adornments={unavailableAdornments} canCheck={false} inSession={!!sessionId} {...rowProps} onSave={() => { throw new Error('This original session product is unavailable.') }} /> : null}
        {loadedNothing ? <div className="flex min-w-0 flex-col items-center gap-2 py-6 text-center text-xs text-gray-500" data-inventory-check-empty={section}>
          <p className="break-words leading-relaxed">{section === 'sessions' ? (sessionFiltersActive ? tr('inventory_check_sessions_no_match', 'No count sessions match these filters.') : tr('inventory_check_sessions_empty', 'No count sessions yet.'))
            : scanMissed ? (sessionId ? tr('inventory_check_scan_not_in_session', 'Not in this session.') : tr('inventory_check_scan_no_match', 'No product with this code.'))
                : tr('inventory_check_empty', 'No matching products.')}</p>
          {(section === 'sessions' ? sessionFiltersActive : filtersActive) ? <button type="button" className="btn-secondary inline-flex min-h-10 items-center gap-1 px-3 text-xs" disabled={controlsLocked} onClick={clearFilters}><X className="h-4 w-4" aria-hidden="true" />{t('clear')}</button>
            : section === 'sessions' && access.canCheck ? <button type="button" className="btn-primary inline-flex min-h-10 items-center gap-1 px-3 text-xs" title={tr('inventory_check_count_tooltip', 'Count the products listed on this page')} onClick={() => setSection('products')}><Play className="h-4 w-4" aria-hidden="true" />{tr('inventory_check_start_page', 'Count')}</button> : null}
        </div> : null}
        {pagerNode('bottom')}
        {detail && fresh ? <Suspense fallback={null}><InventoryCheckDetail product={detail} observation={observations[String(detail.id)]} unavailable={unavailableIds.has(String(detail.id))} fields={access.fields} priceText={access.fields.price ? priceText : undefined} promotionRules={data?.promotionRules} exchangeRate={exchangeRate} fmtUSD={fmtUSD} fmtKHR={fmtKHR} navigateTo={navigateTo} t={t} onClose={() => setDetail(null)}
          onFixStock={fixOpening ? () => openFixStock(fixOpening) : undefined}
          onOpenRequest={offered && detail.check_pending === true && pendingSessionOf(detail) && detail.check_branch_id != null ? () => openRequest(String(detail.check_branch_id), String(pendingSessionOf(detail))) : undefined}
          onSales={offered && rights.can('sales', 'view') ? () => { queueReportsFocus(productSalesFocus(detail.name)); navigateTo('sales', hubAnchor('sales', 'reports')) } : undefined} /></Suspense> : null}
        {costFor && access.fields.cost ? <Suspense fallback={null}><CostCalculationFloat productId={costFor.id} productName={costFor.name} onClose={() => setCostFor(null)} fmtUSD={value => fmtUSD(value)} fmtKHR={value => fmtKHR(value)} t={(key, fallback) => tr(key, fallback)} /></Suspense> : null}
        {historyPage !== null ? <Suspense fallback={null}><InventoryCheckHistoryFloat page={historyPage} history={history} error={historyError} onPage={setHistoryPage} onRetry={() => setHistoryReload(value => value + 1)} onClose={() => setHistoryPage(null)} t={t} /></Suspense> : null}
        {fixStock ? <Suspense fallback={null}><FastStockInModal
          branchOptions={branches.map(branch => ({ value: String(branch.id), label: branch.name }))} defaultBranchId={fixStock.branchId} initialMode="set" lockMode="set" initialHeader={{ branchId: String(fixStock.branchId) }}
          initialLines={[{ mode: 'set', quantity: fixStock.quantity, reason: fixStock.reason, ...fixStock.requestId ? { requestId: fixStock.requestId } : {}, product: fixStockCandidate(fixStock, branches.find(branch => branch.id === fixStock.branchId)?.name ?? null) }]}
          tr={(key: string, fallback?: string) => tr(key, fallback ?? key)} notify={notify} onClose={() => setFixStock(null)} onDone={() => { const id = Number(fixStock.product.id); if (wiredRaw.current && wiredNow && Number.isSafeInteger(id)) void refreshChanged([id]); else reloadAll() }} /></Suspense> : null}
        {confirmDialog}
      </div>
    </HubSectionNav>
  </div>
}
