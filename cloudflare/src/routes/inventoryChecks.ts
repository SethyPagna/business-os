import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { requireAuth, type SessionUser } from '../lib/auth'
import { actorSnapshot } from '../lib/actorSnapshot'
import { getDb } from '../lib/db'
import { loadLowStockConfig, resolveLowStockConfig } from '../lib/lowStockSettings'
import { readSwitch, readSwitchMemoMs } from '../lib/readSwitches'
import type { Env } from '../index'
import { decideInventoryCheckApproval, decideInventoryCheckLine, type ApprovalDecided } from '../lib/inventoryCheckApprovals'
import { getPlanLimits } from '../lib/planTier'
import { getInventoryCheckTaskLimits } from '../lib/inventoryCheckTaskLimits'
import type { ReviewAlertEvent, ReviewAlertHook } from '../lib/reviewAlert'
import type { InventoryContext } from './inventory'
import type { StockInCommitLine } from './stockInCommit'
import { bumpVersions, cacheIdentity, cachedJsonResponse, getVersionWithFallback, getVersionsWithFallback } from '../lib/cache'
import { stockVisibleProductSql } from '../lib/productStockGuard'
import { canApproveInventoryCounts, canIssueInventoryCountTasks, canWorkInventoryCountTasks, getInventoryCheckAccess, InventoryCheckQueryError } from '../lib/inventoryCheckAccess'
import { icTasksNamespace, readTaskProducts, readTaskRows, type TaskRow } from '../lib/inventoryCheckTasks'
import { canonicalProductsRequest, checkStateRestriction, inventoryChecksVersion, LIST_MAX_PAGE_SIZE, planInventoryList, projectInventoryList, readCheckStateSets, readCheckSummary, type CheckStateSets } from '../lib/inventoryCheckList'
import { parseOverlayIds, readInventoryOverlay } from '../lib/inventoryCheckOverlay'
import { availableGroupings, buildGroupingBlock, type GroupingBlock } from '../lib/inventoryCheckGrouping'
import type { FamilyGroupTotals } from '../lib/familyPagination'
import { readInventoryCheckLots } from '../lib/inventoryCheckLots'
import { getActionTier } from '../lib/permissions'
import { broadcast } from '../durable-objects/broadcastHub'
import { cacheKeyRequest } from '../lib/cacheKey'
import { MARKS_FORMAT, fnv1a32, readChanges, readPendingPage, readSnapshotPage, readTopAndAt, type Mark } from '../lib/inventoryCheckMarks'
import { attachLotRows, readProductSearchList } from './products'
import { approvalsAvailable, createInventoryCheckLotSubmission, createInventoryCheckSession, createInventoryCheckSubmission, lotLinesAvailable, getInventoryCheckSession, inventoryCheckDigest, inventoryCheckSessionHistory,
  canSeeStaffIdentity, InventoryCheckSessionError, listInventoryCheckSessions, patchInventoryCheckObservation, patchInventoryCheckSession, pickupInventoryCheckTask, releaseInventoryCheckTask, REPLACED_NOTE,
  type InventoryCheckPickupTask } from '../lib/inventoryCheckSessions'

// A global hook, not an import: the alert module is installed by index.ts, many tests load this route alone, and an absent hook is a no-op
// (the same contract as lib/reviewGate.ts). The Telegram alert is sent after the write it announces committed, never on a replay or a refusal.
const reviewAlertHook = (): ReviewAlertHook | undefined =>
  (globalThis as unknown as Record<symbol, ReviewAlertHook | undefined>)[Symbol.for('business-os.review-alert.v1')]
// `system`: no person decided (an approval every line of which a newer count replaced), so no "By" row is sent.
// `by`: the person who decided, when it is not the caller (an approval ended by a submission after the approver's own rejected lines: it is that approver's decision, not the submitter's).
const announceCount = (env: Env, user: SessionUser, event: Pick<ReviewAlertEvent, 'kind' | 'reason' | 'summary'> & { sessionId: string; system?: true; by?: string }): Promise<void> =>
  Promise.resolve(reviewAlertHook()?.announce(env, {
    kind: event.kind, by: event.kind === 'created' || event.system ? undefined : event.by ?? actorSnapshot(user), reason: event.reason ?? null, ...(event.summary ? { summary: event.summary } : {}),
    row: { section: 'inventory_checks', action_type: 'approve', entity_type: 'count', entity_id: event.sessionId, payload_json: '{}', requested_by_name: event.kind === 'created' ? actorSnapshot(user) : null },
  }))

// The write committed but the cache version that keeps the check-state sets honest could not be advanced. The answer says so (the page shows 'saved, refresh'), and keeps outcome 'unknown'
// so the page keeps its frozen request: a retry replays the stored receipt and tries the bump again.
const SAVED_REFRESH_CODE = 'inventory_check_saved_refresh'
// icBoard: this writer can change a figure of the task board (see the table at the board's reader); icBranch: the branch whose board it moved, read from the writer's own answer. Both are set by the handler, read by the bump below.
type IcVariables = { user: SessionUser; icBoard?: true; icBranch?: number }
const app = new Hono<{ Bindings: Env; Variables: IcVariables }>()
app.use('*', requireAuth)
app.use('*', async (c, next) => { c.header('Cache-Control','private, no-store'); await next() })
app.onError((error,c) => {
  const status = error instanceof InventoryCheckSessionError ? error.status : 'status' in error && typeof error.status === 'number' && [400,403,409,503].includes(error.status) ? error.status as 400|403|409|503 : 503
  const code = 'code' in error && typeof error.code === 'string' ? error.code : 'inventory_check_unavailable'
  const details = error instanceof InventoryCheckSessionError && error.details ? error.details : error instanceof InventoryCheckQueryError ? { parameter: error.parameter } : {}
  return c.json({ ...details, error: code, code, ...(code === 'inventory_check_outcome_unknown' || code === SAVED_REFRESH_CODE ? { outcome: 'unknown' } : {}) }, status)
})
/**
 * THE WRITERS OF THE TASK BOARD (P2.3/P2.4). The board (GET /tasks and the pickup rows of GET /sessions) is cached on ic_tasks:<branch> and the products version. A writer that calls boardWrites/boardBranch moves the namespace of the branch its answer
 * names, in the one awaited bump of the middleware above. They are exactly the writers that can change a figure or a row of the board: a count made final (a submission, the close of a count session), a count taken back (the
 * resume of one), a task issued, picked up, released or closed. NOT marked: an observation (an open session's count is not final), an approval decision and its line decisions (they flip issue to done without touching the time, and
 * both count), a new open session. The Sets that close a difference and their Undo, Redo and Revert are in routes/inventory.ts, routes/batches.ts and lib/stockLotAdjustment.ts. Pinned by test-inventory-check-tasks-board-version-pure.cjs.
 */
type BoardContext = Context<{ Bindings: Env; Variables: IcVariables }>
/** Before the writer runs: it can change the board (so a 5xx answer, whose branch is unknown, still moves the board's key). */
const boardWrites = (c: BoardContext): void => { c.set('icBoard', true) }
/** After it answered: the branch of the session its answer names, whose board it moved. */
function boardBranch<T extends { item?: { branch_id?: number } }>(c: BoardContext, result: T): T {
  const branch = Number(result.item?.branch_id)
  if (Number.isSafeInteger(branch) && branch > 0) c.set('icBranch', branch)
  return result
}
/**
 * The alert an approval's end sends, once and only when it ends (never per line). A close that applied nothing reads as a rejection (the reason is its note or "Closed"); one that applied something reads as
 * an approval. When the approver rejected lines, the alert says how many lines were applied and how many were rejected.
 */
const approvalAnnouncer = (c: Context<{ Bindings: Env; Variables: IcVariables }>): ApprovalDecided => ({ decision, sessionId, note, applied, rejectedLines }) => {
  if (decision === 'replaced') return announceCount(c.env, c.get('user'), { kind: 'rejected', sessionId, reason: REPLACED_NOTE, system: true })
  const rejected = decision === 'reject' || (decision === 'close' && !applied)
  return announceCount(c.env, c.get('user'), { kind: rejected ? 'rejected' : 'approved', sessionId, reason: rejected ? note ?? (decision === 'close' ? 'Closed' : null) : null,
    ...(rejectedLines ? { summary: { applied: applied ?? 0, rejected: rejectedLines } } : {}) })
}
/** ic_fix_stock counts as ON only once migration 0286 is applied: with the switch on and the table missing every count would fail, so it answers exactly as OFF. */
const fixStockOn = async (c: Context<{ Bindings: Env; Variables: IcVariables }>): Promise<boolean> => await readSwitch(c.env, 'ic_fix_stock') && await approvalsAvailable(getDb(c.env))
/** ic_lot_counts counts as ON only once migration 0294 is applied: with the switch on and the table missing every lot count would fail, so it answers exactly as OFF. */
const lotCountsOn = async (c: Context<{ Bindings: Env; Variables: IcVariables }>): Promise<boolean> => await readSwitch(c.env, 'ic_lot_counts') && await lotLinesAvailable(getDb(c.env), readSwitchMemoMs(c.env))
async function principal(c: Context<{ Bindings: Env; Variables: IcVariables }>) {
  const token = getCookie(c, 'bos_session')
  if (!token) throw new InventoryCheckSessionError(401,'invalid_session')
  return { id: c.get('user').id, tokenHash: await inventoryCheckDigest(token) }
}
// Every Inventory Check writer moves the inventory_checks version, AWAITED before the answer leaves (the check-state sets and every restricted list key on it). Only a
// request that wrote or may have written: a refusal before the write (4xx) moves nothing. The bump does NOT depend on ic_wired: a write made while the switch is OFF must still move
// the version, because the sets and the restricted rankings cached while it was ON live productListCacheSeconds (an hour on Free) and a flip back ON would otherwise serve them
// stale (test-read-switches-bump-outside-pure: a bump inside a switched block is a violation). The bump is a cache-version write, not a D1 statement: the write's statements are what they were.
app.use('*', async (c, next) => {
  await next()
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return
  const status = c.res.status
  if (status >= 400 && status < 500) return
  // Best effort and whatever the switch says (a broadcast is not a read): the devices that watch the count marks ask for their changes.
  try { c.executionCtx.waitUntil(broadcast(c.env, 'inventory_checks', { branchId: c.get('icBranch') ?? null })) } catch { /* no execution context */ }
  // ON, a bump that did not land fails the write's answer (its outcome is unknown to the caller, and a stale set must never be served as fresh). OFF, nothing is being served from these
  // versions right now, so an unreachable cache store must not turn a committed Inventory Check write into an error: the failure is logged and the next flip ON starts from a bumped version
  // anyway (the version is also moved by every later writer).
  const wired = await readSwitch(c.env, 'ic_wired')
  // P2.3/P2.4: a writer that can change a figure of the task board also moves the board's own version for ITS branch, in this same awaited call (a KV write, no D1 statement). A writer that answered 5xx may have
  // written and its branch is not known (its answer carries none): it moves 'products', which the board also keys on, so the board is never served stale, and a replay of the request moves the branch's own.
  const board = c.get('icBoard') ? [c.get('icBranch') ? icTasksNamespace(c.get('icBranch') as number) : 'products'] : []
  try { await bumpVersions(c.env, ['inventory_checks', ...board]) } catch (error) {
    // Only an answer that said the write was made (below 400) becomes 'saved, refresh'. A writer that itself answered 5xx may not have committed anything: it keeps its own answer
    // (a D1 failure, outcome unknown) and the bump failure is only logged, so 'Saved' is never claimed over a failed write.
    if (wired && status < 400) throw new InventoryCheckSessionError(503, SAVED_REFRESH_CODE)
    console.error(`[inventory_checks] version not advanced (ic_wired ${wired ? 'ON' : 'OFF'}, writer answered ${status})`, error)
  }
})

// ---- ic_wired: the Inventory Check list and overlay over the shared Products reader (INV-A S4a) ----------------------------------------------------------
// Both answer 404 while the switch is OFF (the page keeps its old path). /list is GET /api/products/search for the scope plus the viewer's grants; /overlay is the
// only other read Inventory makes, scoped to a window of ids. See lib/inventoryCheckList.ts and lib/inventoryCheckOverlay.ts.
type IcContext = Context<{ Bindings: Env; Variables: IcVariables }>
const notWired = (c: IcContext) => c.json({ error: 'not_found', code: 'not_found' }, 404)
const singleValued = (c: IcContext): void => {
  for (const [key, values] of Object.entries(c.req.queries())) if (values.length !== 1) throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', key)
}
// The two answers a page needs beside its rows, built once for /list and /overlay: the same grants decide them in both. The counts are the check-state sets (Inventory Check tables only, cached by the
// inventory_checks version), never a stock read.
const fixStockCapabilities = (user: SessionUser) => ({ fixStock: true, approveCounts: getActionTier(user, 'inventory', 'adjust') === 'full' && canApproveInventoryCounts(user) })
// ic_lot_counts: counts are typed per received date; a holder of Full stock-adjust who sees stock may also Set a received date or the branch total straight from the row.
// lotLinesPerSubmission: the most received-date lines one submission may carry (the plan's number); the page sends what fits and keeps the rest, so a normal page is never refused.
// The submission caps are sent whenever the server will enforce them: ic_lot_counts ON, or the wired page (ic_wired) whose every submission, plain lines included, goes through the lot writer and its caps (POST /submissions).
// productsPerSubmission is the JavaScript budget of one request (Free: 10 ms), lotLinesPerSubmission the written rows. The page splits a submission by both.
// groupings: the groupBy values the list can answer (category only with the category field); a client sends groupBy only for a name listed here.
const capabilitiesOf = (user: SessionUser, fixStock: boolean, lotCounts: boolean, stockField: boolean, caps: { lines: number; products: number } | null, groupings: string[]) => {
  return { ...(fixStock ? fixStockCapabilities(user) : {}), ...(lotCounts ? { lotCounts: true as const, ...(stockField && getActionTier(user, 'inventory', 'adjust') === 'full' ? { directSet: true as const } : {}) } : {}),
    ...(caps ? { lotLinesPerSubmission: caps.lines, productsPerSubmission: caps.products } : {}), groupings }
}
const submissionCaps = async (c: Context<{ Bindings: Env; Variables: IcVariables }>, lotCounts: boolean) => {
  if (!lotCounts && !await lotLinesAvailable(getDb(c.env), readSwitchMemoMs(c.env))) return null
  const limits = getPlanLimits(c.env)
  return { lines: limits.inventoryCheckLotLinesPerSubmission, products: limits.inventoryCheckProductsPerSubmission }
}
// The summary (lib/inventoryCheckList.ts readCheckSummary) is ONE object, the same from /list (when the request names a branch) and /overlay (always): counts of product rows, total, not_checked, the date chips and,
// with Fix stock, pending. tooLarge: more checked products than inventoryCheckFilterMaxIds, so there are no counts and no days to give: it says `{ tooLarge: true }` instead of vanishing, and a page that holds
// chips from an earlier answer clears them. The check-state filters are refused (503) while it holds.
// The countable products of one task (count tasks): its identity and product ids, read once per inventory_checks version and products version (a task's items never change; the version moves whenever the task closes or is counted, and a deactivation, merge or header moves the products version).
type TaskProducts = { branchId: number; status: 'open' | 'closed'; startedAt: string; productIds: number[] }
async function readTaskCached(c: IcContext, taskId: string): Promise<TaskProducts | null> {
  const [version, productsVersion] = await Promise.all([inventoryChecksVersion(c.env), getVersionWithFallback(c.env, 'products')])
  return cachedJsonResponse(new Request(`https://ic.invalid/__bos/ic-task?id=${encodeURIComponent(taskId)}&order=1`, { method: 'GET' }), c.executionCtx, `ict:${version}:${productsVersion}`, getPlanLimits(c.env).productListCacheSeconds,
    () => readTaskProducts(getDb(c.env), { organization: c.get('user').organization_id ?? null, taskId }), cacheIdentity(c))
}
// idsOnly: the caller wants the ids of the rows (the filter of a task being issued), not the rows: no received dates, no tagged lots and no summary are read for them.
type ListExtra = { task?: TaskProducts & { id: string }; idsOnly?: boolean }
type ListPageAnswer = Record<string, unknown> & { items?: Array<{ id: number; is_group?: number | boolean }>; total?: number }
async function readListPage(c: IcContext, rawQuery: Record<string, string>, extra: ListExtra = {}): Promise<ListPageAnswer> {
  const user = c.get('user'), db = getDb(c.env)
  const access = getInventoryCheckAccess(user)
  // Counts waiting for approval are known only to a viewer who may see stock, and only while ic_fix_stock is on (migration 0286 applied): the same rule as the old list.
  const fixStock = access.fields.stock && await fixStockOn(c)
  const plan = planInventoryList(user, rawQuery, { pendingAvailable: fixStock, maxIds: getPlanLimits(c.env).inventoryOverlayMaxRows })
  const productsQuery = { ...plan.productsQuery }
  let codeHit: number | null = null
  if (plan.codeLookup) {
    // A viewer without the barcode field finds a product by its WHOLE code only: an exact hit is read by id, anything else is searched by name.
    // Only a product the list itself may show (active, or still holding stock): a retired product that happens to share the code must not capture the search.
    const hit = await db.prepare(`SELECT p.id FROM products p WHERE (p.barcode = @code OR p.sku = @code) AND ${stockVisibleProductSql('p', false)} LIMIT 2`).all<{ id: number }>({ code: plan.codeLookup })
    if (hit.length === 1) { delete productsQuery.query; delete productsQuery.searchFields; productsQuery.ids = String(hit[0].id); productsQuery.page = '1'; productsQuery.pageSize = '1'; codeHit = Number(hit[0].id) }
  }
  let sets: CheckStateSets | null = null
  let setsVersion = ''
  if (plan.branchId !== null && (plan.checkState || plan.checkedOn)) ({ sets, version: setsVersion } = await readCheckStateSets(c, plan.branchId, fixStock))
  let restriction: { restrictIdsJson?: string; excludeIdsJson?: string } = (plan.checkState || plan.checkedOn) && sets ? checkStateRestriction(plan.checkState, sets, plan.checkedOn) : {}
  // taskId: the list is restricted to the task's products, built like the check-state restriction (and intersected with it when both are asked: a task's Differs, a task's Not checked).
  if (extra.task) {
    let ids = new Set(extra.task.productIds)
    if (restriction.restrictIdsJson !== undefined) { const keep = new Set(JSON.parse(restriction.restrictIdsJson) as number[]); ids = new Set([...ids].filter((id) => keep.has(id))) }
    if (restriction.excludeIdsJson !== undefined) { const drop = new Set(JSON.parse(restriction.excludeIdsJson) as number[]); ids = new Set([...ids].filter((id) => !drop.has(id))) }
    restriction = { restrictIdsJson: JSON.stringify([...ids]) }
  }
  // idsOnly with no restriction of its own (a filter being issued): read leaf-only. An exclusion of no ids is the check lists' own restriction and leaves family headers out of the rows; the reader's leafOnly option lets a
  // family still qualify through its header under a typed search (the plain list shows that family), so the children a search finds through their header are issued, and a page holds only families with a product in them
  // (the page bound counts products). The key carries `leaf`, so the page never shares an entry with the plain list.
  const leafOnly = Boolean(extra.idsOnly) && restriction.restrictIdsJson === undefined && restriction.excludeIdsJson === undefined
  if (leafOnly) restriction = { excludeIdsJson: '[]' }
  // The shared cache key is the canonical request. A grouped read never takes a by-id read (its ranking needs the keyed page read): an exact code hit becomes a restriction to that id, and the key keeps the id.
  const keyRequest = canonicalProductsRequest(productsQuery)
  if (plan.grouping && codeHit !== null) {
    delete productsQuery.ids
    const kept: number[] = restriction.restrictIdsJson === undefined ? [codeHit] : (JSON.parse(restriction.restrictIdsJson) as number[]).filter((id) => Number(id) === codeHit)
    restriction = { ...restriction, restrictIdsJson: JSON.stringify(kept) }
  }
  const grouping = plan.grouping ? { by: plan.grouping, checkOrg: user.organization_id ?? null } : undefined
  const include = new Set<string>(extra.idsOnly ? [] : [...access.fields.stock ? ['tagged_lots'] : [], ...access.fields.received ? ['lots'] : []])
  // A grouped list keys on the inventory_checks version even with no check state: the checked grouping orders by the checks themselves.
  // A task's list does NOT key on it (P2.6): its restricted id set is the task's items (immutable) filtered by countability, which moves only with the products version the reader's base key already holds, and its page is keyed by
  // ic_set=task:<id>. The count-dependent parts keep their own version: the check state and the day (setsVersion) and the grouping by count. The task's status beside the page is read live (readTaskCached), outside the cached payload.
  const groupedVersion = grouping && !setsVersion ? await inventoryChecksVersion(c.env) : setsVersion
  // The cached page is keyed by the restriction's own name: the state (Pending without the right to see it is an empty set of its own: it must not share a cached page with the admin's real Pending set)
  // and the day, so a page of one day never serves another.
  const setKey = [plan.checkState ? (plan.checkState === 'pending' && !fixStock ? 'pending_unavailable' : plan.checkState) : '', plan.checkedOn ? `day:${plan.checkedOn}` : '', extra.task ? `task:${extra.task.id}` : '', leafOnly ? 'leaf' : ''].filter(Boolean).join('|')
  const { groups, ...payload } = await readProductSearchList(c, productsQuery, { include, keyRequest, ...restriction, ...(leafOnly ? { leafOnly: true } : {}), ...(extra.idsOnly ? { idsOnly: true } : {}), ...(grouping ? { grouping } : {}),
    ...(setKey ? { setKey } : codeHit !== null && grouping ? { setKey: 'code' } : {}),
    ...(plan.checkState || plan.checkedOn || grouping ? { setVersion: groupedVersion } : {}), lotsAdmitted: access.fields.received && !extra.idsOnly, taggedLotsAdmitted: access.fields.stock && !extra.idsOnly }) as Awaited<ReturnType<typeof readProductSearchList>> & { groups?: FamilyGroupTotals[] }
  // idsOnly (a filter being issued, resolveTaskFilters) reads the ids, whether a row is a family header and the total, nothing else (P2.7): the answer is the reader's page as it is, with none of the capability reads, the
  // projection, the grouping block or the summary a screen needs. Each is JavaScript and calls an issue by filter cannot afford on Free (10 ms, 50 calls).
  if (extra.idsOnly) return { items: ((payload as { items?: unknown }).items ?? []) as ListPageAnswer['items'], total: Number((payload as { total?: unknown }).total ?? 0) }
  const lotCounts = await lotCountsOn(c)
  const capabilities = { ...capabilitiesOf(user, fixStock, lotCounts, access.fields.stock, await submissionCaps(c, lotCounts), availableGroupings(access.fields)), ...await marksCapability(c) }
  const productsPage = getActionTier(user, 'products', 'view') !== 'none'
  const projection = projectInventoryList(payload as Record<string, unknown>, user, access, productsPage)
  const { body } = projection
  // Grouped rows carry group_key and come in the grouping order: they are never the Products page's own rows.
  const projected = plan.grouping ? true : projection.projected
  const groupingBlock: GroupingBlock | undefined = plan.grouping
    ? buildGroupingBlock(plan.grouping, groups ?? [], body.items as Array<Record<string, unknown>>, (Number(productsQuery.page) - 1) * Number(productsQuery.pageSize), Number(productsQuery.pageSize)) : undefined
  // The counts are the branch-wide figures of the unfiltered list, whatever this page is filtered to; a request that names no branch has none.
  const summary = plan.branchId !== null && plan.wantSummary ? await readCheckSummary(c, plan.branchId, fixStock, sets ? { sets, version: setsVersion } : undefined) : null
  // window_pages: how many pages (this one and the ones ahead) the page may read in one window; the ranking behind them is shared (catalog_ranked_scope), so a window costs rows, not rankings.
  return { ...body, wired: true, projected, window_pages: getPlanLimits(c.env).catalogListWindowPages, overlay_ids: getPlanLimits(c.env).inventoryOverlayMaxRows, ...(groupingBlock ? { grouping: groupingBlock } : {}), ...(summary ? { summary } : {}),
    ...(extra.task ? { task: { id: extra.task.id, status: extra.task.status, total: extra.task.productIds.length } } : {}), capabilities }
}
app.get('/list', async c => {
  if (!await readSwitch(c.env, 'ic_wired')) return notWired(c)
  singleValued(c)
  const { taskId, ...query } = c.req.query()
  if (taskId === undefined) return c.json(await readListPage(c, query))
  // A task's list: only for a viewer who may see tasks, at the task's own branch, and not beside an id list.
  const user = c.get('user')
  if (!canWorkInventoryCountTasks(user) && !canIssueInventoryCountTasks(user)) throw new InventoryCheckQueryError(403, 'inventory_check_tasks_required', 'taskId')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(taskId) || query.ids !== undefined) throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', query.ids !== undefined ? 'ids' : 'taskId')
  const task = await readTaskCached(c, taskId)
  if (!task) throw new InventoryCheckSessionError(404, 'inventory_check_task_not_found')
  if (query.branchId !== String(task.branchId)) throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', 'branchId')
  return c.json(await readListPage(c, query, { task: { ...task, id: taskId } }))
})
app.get('/overlay', async c => {
  if (!await readSwitch(c.env, 'ic_wired')) return notWired(c)
  singleValued(c)
  const user = c.get('user')
  const access = getInventoryCheckAccess(user)
  if (!access.canView) throw new InventoryCheckQueryError(403, 'inventory_check_view_required', '')
  const branchWord = c.req.query('branchId')?.trim() ?? ''
  if (!/^\d+$/.test(branchWord) || !Number.isSafeInteger(Number(branchWord)) || Number(branchWord) <= 0) throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', 'branchId')
  const branchId = Number(branchWord)
  const ids = parseOverlayIds(c.req.query('ids'), c.env)
  // A page whose rows come from Products' store has no /list answer, so the overlay carries the strip's counts and the Fix stock capability, computed as /list computes them (summary=0 leaves the counts out, as on /list).
  const fixStock = access.fields.stock && await fixStockOn(c)
  const wantSummary = c.req.query('summary') !== '0'
  const lotCounts = await lotCountsOn(c)
  const wantLots = c.req.query('lots') === '1' && access.fields.received
  const populationToken: { token?: string | null } = {}
  const [items, withLots] = await Promise.all([
    readInventoryOverlay(c.env, user, { branchId, ids, pendingAvailable: fixStock, lotLines: lotCounts, ...(wantSummary ? { populationToken } : {}) }),
    // Received dates for the same ids, for a screen whose shared store does not hold them: the same reader as the list (a first read, not a second).
    wantLots ? attachLotRows(c.env, user, new Set(['lots']), { items: ids.map((id) => ({ id })) }, true) : Promise.resolve(null),
  ])
  const lots = withLots ? (withLots.items as Array<{ id: number; lots?: Array<Record<string, unknown>>; lots_more?: true }>).map((row) => ({ product_id: row.id,
    lots: (row.lots ?? []).map((lot) => access.fields.stock ? lot : { ...lot, branches: (lot.branches as Array<Record<string, unknown>>).map(({ quantity: _quantity, ...entry }) => entry) }),
    ...(row.lots_more ? { lots_more: true } : {}) })) : undefined
  const summary = wantSummary ? await readCheckSummary(c, branchId, fixStock, undefined, populationToken.token) : null
  const capabilities = { ...capabilitiesOf(user, fixStock, lotCounts, access.fields.stock, await submissionCaps(c, lotCounts), availableGroupings(access.fields)), ...await marksCapability(c) }
  return c.json({ wired: true, branchId, version: await inventoryChecksVersion(c.env), items, ...(lots ? { lots } : {}),
    ...(summary ? { summary } : {}), capabilities })
})
// ic_lot_counts: the received dates ("batches") one product holds at one branch, read ON DEMAND when a person opens the count popover of a row (one request, one product; the page never
// lists batches for its rows). Answers 404 while the switch is OFF (the page then counts one total per product, exactly as before). No cost, supplier or price is ever selected.
const positiveWord = (word: string | undefined, parameter: string): number => {
  if (!word || !/^[0-9]+$/.test(word.trim()) || !Number.isSafeInteger(Number(word)) || Number(word) <= 0) throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', parameter)
  return Number(word)
}
app.get('/lots', async c => {
  if (!await lotCountsOn(c)) return notWired(c)
  singleValued(c)
  const user = c.get('user')
  if (!getInventoryCheckAccess(user).canView) throw new InventoryCheckQueryError(403, 'inventory_check_view_required', '')
  const productId = positiveWord(c.req.query('productId'), 'productId'), branchId = positiveWord(c.req.query('branchId'), 'branchId')
  return c.json(await readInventoryCheckLots(getDb(c.env), user, { productId, branchId, limit: getPlanLimits(c.env).inventoryCheckLotLinesPerProduct }))
})
// ---- ic_marks: the count marks a device holds (lib/inventoryCheckMarks.ts, contract docs/contracts/inventory-check-marks-20261121.md) ----------------------------------------------------
// Three GET routes; all answer 404 while ic_marks is OFF. The marks are the LATEST count of each product at the branch (state, time); no quantity, stock or person is in them.
const marksCapability = async (c: IcContext): Promise<{ marks?: { pollSeconds: number; catchUpMaxEvents: number; pageIds: number } }> => {
  if (!await readSwitch(c.env, 'ic_marks')) return {}
  const limits = getPlanLimits(c.env)
  return { marks: { pollSeconds: limits.inventoryMarksPollSeconds, catchUpMaxEvents: limits.inventoryMarksCatchUpMaxEvents, pageIds: limits.inventoryMarksPageIds } }
}
const nonNegative = (word: string | undefined, parameter: string): number => {
  if (word === undefined || !/^[0-9]{1,15}$/.test(word) || !Number.isSafeInteger(Number(word))) throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', parameter)
  return Number(word)
}
// The shared start of the three routes. A viewer may see Waiting only with the stock field and Fix stock (the /overlay rule).
async function marksStart(c: IcContext): Promise<{ scope: { organization: number | null; branchId: number }; permitted: boolean; limits: ReturnType<typeof getPlanLimits> } | null> {
  if (!await readSwitch(c.env, 'ic_marks')) return null
  singleValued(c)
  const user = c.get('user'), access = getInventoryCheckAccess(user)
  if (!access.canView) throw new InventoryCheckQueryError(403, 'inventory_check_view_required', '')
  const branchId = positiveWord(c.req.query('branchId'), 'branchId')
  return { scope: { organization: user.organization_id ?? null, branchId }, permitted: access.fields.stock && await fixStockOn(c), limits: getPlanLimits(c.env) }
}
type MarksPage = { page: number; buckets: number[]; cursor: number; tag: string; hash: string; rows: Mark[] }
app.get('/marks', async c => {
  const start = await marksStart(c)
  if (!start) return notWired(c)
  const { scope, limits } = start
  const page = nonNegative(c.req.query('page'), 'page'), have = c.req.query('have') ?? ''
  const db = getDb(c.env)
  const key = await cacheKeyRequest(`https://ic.invalid/__bos/ic-marks?org=${scope.organization ?? ''}&branch=${scope.branchId}&page=${page}&f=${MARKS_FORMAT}`, 'marks', cacheIdentity(c))
  let served: MarksPage | null = null, top = 0
  // Every request validates the cached page against the log (one call): it is served only while its cursor is not past the newest event, its cursor event still has its tag and it is not further behind than half the catch-up threshold.
  const cached = key ? await caches.default.match(key).then((hit) => hit ? hit.json<MarksPage>() : null).catch(() => null) : null
  if (cached) {
    const check = await readTopAndAt(db, cached.cursor)
    top = check.top
    if (cached.cursor <= check.top && (cached.cursor === 0 || check.atTag === cached.tag) && check.top - cached.cursor <= limits.inventoryMarksCatchUpMaxEvents / 2) served = cached
  }
  if (!served) {
    const built = await readSnapshotPage(db, scope, page, limits.inventoryMarksPageIds)
    top = built.cursor
    served = { page, buckets: built.buckets, cursor: built.cursor, tag: built.tag, hash: fnv1a32(`${MARKS_FORMAT}:${page}:${built.cursor}:${built.tag}:${JSON.stringify(built.rows)}`), rows: built.rows }
    if (key) c.executionCtx.waitUntil(caches.default.put(key, new Response(JSON.stringify(served), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${limits.inventoryMarksSnapshotCacheSeconds}` } })))
  }
  const head = { format: MARKS_FORMAT, page: served.page, buckets: served.buckets, cursor: served.cursor, tag: served.tag, top, hash: served.hash }
  return c.json(have !== '' && have === served.hash ? { ...head, unchanged: true } : { ...head, rows: served.rows })
})
app.get('/marks/changes', async c => {
  const start = await marksStart(c)
  if (!start) return notWired(c)
  const since = nonNegative(c.req.query('since'), 'since'), tag = c.req.query('tag') ?? ''
  if (!/^([0-9a-f]{8})?$/.test(tag) || (since > 0 && tag === '')) throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', 'tag')
  return c.json(await readChanges(getDb(c.env), start.scope, since, tag, { pageEvents: start.limits.inventoryMarksChangesPageEvents, touchedMax: start.limits.inventoryMarksTouchedMax }, start.permitted))
})
app.get('/marks/pending', async c => {
  const start = await marksStart(c)
  if (!start) return notWired(c)
  if (!start.permitted) throw new InventoryCheckQueryError(403, 'inventory_check_fix_stock_required', '')
  const afterAt = c.req.query('afterAt'), afterId = c.req.query('afterId')
  if ((afterAt === undefined) !== (afterId === undefined) || (afterAt !== undefined && (afterAt.length > 40 || afterId!.length > 128))) throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', 'afterAt')
  return c.json(await readPendingPage(getDb(c.env), start.scope, afterAt === undefined ? null : { afterAt, afterId: afterId! }, start.limits.inventoryMarksPendingPageApprovals))
})
app.get('/sessions', async c => c.json(await listInventoryCheckSessions(getDb(c.env), await principal(c), c.req.query(), { approvals: await fixStockOn(c),
  tasks: async (branchId) => new Map((await readTaskBoard(c, branchId)).rows.map((row): [string, InventoryCheckPickupTask] => [row.id, { id: row.id, title: row.title, status: row.status, total: row.total, done: row.done, ...(row.atClose ? { at_close: true as const } : {}) }])) })))
app.post('/sessions', async c => {
  const result = await createInventoryCheckSession(getDb(c.env), await principal(c), await c.req.json().catch(()=>null), await loadLowStockConfig(c.env), { simple: await readSwitch(c.env, 'ic_simple') })
  return c.json(result, result.created ? 201 : 200)
})
// ---- count tasks (owner, 18 Nov 2026; lib/inventoryCheckTasks.ts, contract docs/contracts/inventory-check-tasks-20261119.md) ----------------------------------------------------------
// An admin issues products to count; an employee picks a task up and counts it on the wired list (/list?taskId=), submitting with taskId. The done rule and the auto-close are in the Worker.
// The board (a branch's open and recent tasks with their done counts) is cached on the inventory_checks version: every writer that can change a task or a count moves it, so an unchanged open reads nothing.
// Keyed on the BRANCH's board version (ic_tasks:<branch>, moved only by the writers marked with boardWrites and the Set paths) and on the products version (a deactivation, a merge or a header changes `total`, `done` and `removed`).
// Both are read ONCE per open, in one call (a single D1 read for the ones KV does not hold), and the version the key holds is the one the answer carries (P2.5).
async function readTaskBoard(c: IcContext, branchId: number): Promise<{ rows: TaskRow[]; version: string }> {
  const [version, productsVersion] = await getVersionsWithFallback(c.env, [icTasksNamespace(branchId), 'products'])
  const limits = getPlanLimits(c.env), taskLimits = getInventoryCheckTaskLimits(c.env)
  const rows = await cachedJsonResponse(new Request(`https://ic.invalid/__bos/ic-tasks?branchId=${branchId}&order=3`, { method: 'GET' }), c.executionCtx, `ict:${version}:${productsVersion}`, limits.productListCacheSeconds,
    () => readTaskRows(getDb(c.env), { organization: c.get('user').organization_id ?? null, branchId, closedShown: taskLimits.tasksClosedShown }), cacheIdentity(c))
  return { rows, version }
}
/** What a viewer is told of a task: names (never account ids) of who issued and who picked it up, and what they may do with it. */
const taskView = (row: TaskRow, user: SessionUser) => {
  const mine = row.pickup_id !== null && row.picked_by === user.id, open = row.status === 'open'
  const access = getInventoryCheckAccess(user)
  // The filters an admin issued from are shown only as far as the viewer may use them (the same rule as a session's detail).
  const selection = row.selection && typeof row.selection === 'object' && (row.selection as { filters?: Record<string, unknown> }).filters
    ? { ...row.selection as object, filters: Object.fromEntries(Object.entries((row.selection as { filters: Record<string, unknown> }).filters).filter(([key]) => !(key === 'brand' && !access.fields.brand) && !(key === 'category' && !access.fields.category) && !(key === 'stockState' && !access.fields.stock))) }
    : row.selection
  return { id: row.id, branch_id: row.branch_id, title: row.title, status: row.status, revision: row.revision, issued_at: row.started_at, ...(canSeeStaffIdentity(user, row.created_by) ? { issued_by: row.issuer } : {}), closed_at: row.closed_at, total: row.total, done: row.done, removed: row.removed, ...(row.atClose ? { at_close: true } : {}), selection,
    picked_up_by: row.pickup_id ? row.picker : null, picked_up_at: row.pickup_id ? row.picked_at : null, mine, ...(mine ? { pickup_session_id: row.pickup_id } : {}),
    can_pickup: open && row.pickup_id === null && canWorkInventoryCountTasks(user), can_release: open && row.pickup_id !== null && (mine || canIssueInventoryCountTasks(user)), can_close: open && canIssueInventoryCountTasks(user),
    // A task whose count was taken back (owner, 19 Nov): the reason and when; who took it back only for a viewer who may see staff identity, as issued_by.
    ...(open && row.reopened ? { reopened: { at: row.reopened.at, reason: row.reopened.cause === 'set_undone' ? 'set_undone' : 'count_reopened', ...(row.reopened.by !== null && row.reopened.name !== null && canSeeStaffIdentity(user, row.reopened.by) ? { by: row.reopened.name } : {}) } } : {}) }
}
app.get('/tasks', async c => {
  if (!await readSwitch(c.env, 'ic_wired')) return notWired(c)
  singleValued(c)
  const user = c.get('user')
  if (!canWorkInventoryCountTasks(user) && !canIssueInventoryCountTasks(user)) throw new InventoryCheckQueryError(403, 'inventory_check_tasks_required', '')
  const branchId = positiveWord(c.req.query('branchId'), 'branchId')
  const { rows, version } = await readTaskBoard(c, branchId)
  return c.json({ branchId, version, items: rows.map((row) => taskView(row, user)),
    capabilities: { issue: canIssueInventoryCountTasks(user), work: canWorkInventoryCountTasks(user), maxProducts: getInventoryCheckTaskLimits(c.env).maxProducts, maxOpenTasks: getInventoryCheckTaskLimits(c.env).maxOpenTasks } })
})
// The filter keys a task may be issued from: the list's own (a closed set; the list's search code validates them for this viewer, as it does for /list).
const TASK_FILTER_KEYS = ['query', 'brand', 'category', 'stockState', 'checkState', 'checkedOn'] as const
async function resolveTaskFilters(c: IcContext, branchId: number, raw: unknown, limit: number): Promise<{ filters: Record<string, string>; ids: number[]; total: number; atLeast: boolean }> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new InventoryCheckSessionError(400, 'inventory_check_invalid_request')
  const filters: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(TASK_FILTER_KEYS as readonly string[]).includes(key) || typeof value !== 'string') throw new InventoryCheckSessionError(400, 'inventory_check_invalid_request')
    if (value.trim() !== '') filters[key] = value.trim()
  }
  // The list's own reader, read leaf-only (readListPage idsOnly: no family header is a row), page after page (a page holds at most 100 FAMILIES, each with all its countable children, so `total` counts families and a page
  // holds at least that many rows) until the reader has no more pages or the cap is passed. The cap and the answer's `total` count COUNTABLE ROWS, never families; stopped early over the cap, `total` is what was counted so
  // far and `atLeast` says so. Every family on a page holds a product, so a filter of `limit` products or fewer ends within ceil(limit / page size) pages and never meets the page bound. The bound (the pages the cap could
  // need, plus one) only keeps a request under Free's D1 calls if the reader ever returned pages that add no ids again.
  const ids = new Set<number>(), maxPages = Math.ceil(limit / LIST_MAX_PAGE_SIZE) + 1
  let atLeast = false, readAtLeast = 0
  for (let page = 1; ; page++) {
    const answer = await readListPage(c, { ...filters, branchId: String(branchId), summary: '0', pageSize: String(LIST_MAX_PAGE_SIZE), page: String(page) }, { idsOnly: true }) as { items?: Array<{ id: number; is_group?: number | boolean }>; total?: number }
    const rows = answer.items ?? []
    for (const row of rows) if (!row.is_group) ids.add(Number(row.id))
    // More families than the cap means more products than the cap (each family holds one): refuse after this page, with the least the reader knows, never ranking or reading the rest of the scope.
    readAtLeast = Math.max(readAtLeast, Number(answer.total ?? 0))
    if (readAtLeast > limit) { atLeast = true; break }
    if (!rows.length || page * LIST_MAX_PAGE_SIZE >= Number(answer.total ?? 0)) break
    if (ids.size > limit) { atLeast = true; break }
    if (page >= maxPages) throw new InventoryCheckSessionError(400, 'inventory_check_task_too_many', { total: ids.size, limit, atLeast: true })
  }
  // A filter that finds nothing countable is the contract's `inventory_check_product_not_eligible` (what the task screens show as "the filter matched nothing"), not a missing id list.
  if (!ids.size) throw new InventoryCheckSessionError(400, 'inventory_check_product_not_eligible')
  return { filters, ids: [...ids], total: atLeast ? Math.max(ids.size, readAtLeast) : ids.size, atLeast }
}
app.post('/tasks', async c => {
  if (!await readSwitch(c.env, 'ic_wired')) return notWired(c)
  const user = c.get('user')
  // The permission is checked before anything is read; the writer checks it again against the database.
  if (!canIssueInventoryCountTasks(user)) throw new InventoryCheckSessionError(403, 'inventory_check_issue_required')
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InventoryCheckSessionError(400, 'inventory_check_invalid_request')
  const limit = getInventoryCheckTaskLimits(c.env).maxProducts
  if ((body.productIds === undefined) === (body.filters === undefined)) throw new InventoryCheckSessionError(400, 'inventory_check_invalid_request')
  let productIds = body.productIds, selection: unknown = { kind: 'ids' }, dropIneligible = false
  if (body.filters !== undefined) {
    const branchWord = typeof body.branchId === 'number' ? String(body.branchId) : ''
    if (!/^[1-9][0-9]*$/.test(branchWord)) throw new InventoryCheckSessionError(400, 'inventory_check_invalid_id')
    const resolved = await resolveTaskFilters(c, Number(branchWord), body.filters, limit)
    // Over the cap the answer carries the total, so the admin can narrow the filter.
    if (resolved.total > limit) throw new InventoryCheckSessionError(400, 'inventory_check_task_too_many', { total: resolved.total, limit, ...(resolved.atLeast ? { atLeast: true } : {}) })
    productIds = resolved.ids; selection = { kind: 'filters', filters: resolved.filters }; dropIneligible = true
  }
  const { filters: _filters, ...rest } = body
  boardWrites(c)
  const result = boardBranch(c, await createInventoryCheckSession(getDb(c.env), await principal(c), { ...rest, productIds }, resolveLowStockConfig({}), { task: { selection, maxProducts: limit, maxOpenTasks: getInventoryCheckTaskLimits(c.env).maxOpenTasks, dropIneligible } }))
  return c.json(result, result.created ? 201 : 200)
})
// Picking a task up (one person per task) and handing it back; see lib/inventoryCheckSessions.ts.
app.post('/tasks/:id/pickup', async c => {
  if (!await readSwitch(c.env, 'ic_wired')) return notWired(c)
  boardWrites(c)
  const result = boardBranch(c, await pickupInventoryCheckTask(getDb(c.env), await principal(c), c.req.param('id'), await c.req.json().catch(() => null)))
  return c.json(result, result.created ? 201 : 200)
})
app.post('/tasks/:id/release', async c => {
  if (!await readSwitch(c.env, 'ic_wired')) return notWired(c)
  boardWrites(c)
  return c.json(boardBranch(c, await releaseInventoryCheckTask(getDb(c.env), await principal(c), c.req.param('id'), await c.req.json().catch(() => null))))
})
// The owner's way to count (ic_simple): pick products, type counts in the rows, submit once. With the switch off the route does not exist.
app.post('/submissions', async c => {
  if (!await readSwitch(c.env, 'ic_simple')) throw new InventoryCheckSessionError(404, 'inventory_check_not_available')
  const input = await c.req.json().catch(()=>null)
  // A submission whose lines carry received dates (`lots`) is the ic_lot_counts writer's; with the switch off the older writer refuses the key exactly as it always did.
  const withLots = Array.isArray((input as { lines?: unknown } | null)?.lines) && ((input as { lines: unknown[] }).lines).some(line => !!line && typeof line === 'object' && Object.hasOwn(line, 'lots'))
  // While the page is wired (ic_wired) its rows show and send branch_stock, i.e. sellable units: every submission is then judged by the writer that measures exactly that, plain lines included. The older writer's baseline adds held units and would turn a held product into a false shortage or a 409 loop.
  const lotCounts = withLots ? await lotCountsOn(c) : await readSwitch(c.env, 'ic_wired') && await lotLinesAvailable(getDb(c.env), readSwitchMemoMs(c.env))
  // A tab that still holds the switch ON after it went OFF sends dates: a plain 409 with its own code, so the page re-reads its capabilities once instead of repeating a 400.
  if (withLots && !lotCounts) throw new InventoryCheckSessionError(409, 'inventory_check_lot_counts_off')
  const writer = lotCounts ? (db: ReturnType<typeof getDb>, who: Awaited<ReturnType<typeof principal>>, body: unknown, _low: Awaited<ReturnType<typeof loadLowStockConfig>>, options: Parameters<typeof createInventoryCheckSubmission>[4]) =>
    createInventoryCheckLotSubmission(db, who, body, { ...options, maxLines: getPlanLimits(c.env).inventoryCheckLotLinesPerSubmission, maxProducts: getPlanLimits(c.env).inventoryCheckProductsPerSubmission, maxLinesPerProduct: getPlanLimits(c.env).inventoryCheckLotLinesPerProduct }) : createInventoryCheckSubmission
  boardWrites(c)
  const result = boardBranch(c, await writer(getDb(c.env), await principal(c), input, await loadLowStockConfig(c.env),
    { approvals: await fixStockOn(c), onApprovalCreated: ({ sessionId }) => announceCount(c.env, c.get('user'), { kind: 'created', sessionId }),
      // Each approval the submission replaced was rejected by the system: a review decided, so it is told like one (a rejection with its reason, and no person to name).
      onApprovalsReplaced: async ({ sessionIds, byPerson }) => {
        for (const sessionId of sessionIds) await announceCount(c.env, c.get('user'), { kind: 'rejected', sessionId, reason: REPLACED_NOTE, system: true })
        // An approval the approver's own rejected lines ended (the rest was replaced): the approver's rejection, with the lines they rejected, never "replaced".
        for (const ended of byPerson ?? []) await announceCount(c.env, c.get('user'), { kind: 'rejected', sessionId: ended.sessionId, reason: null, by: ended.by, summary: { applied: 0, rejected: ended.rejectedLines } })
      } }))
  return c.json(result, result.created ? 201 : 200)
})
app.get('/sessions/:id', async c => c.json(await getInventoryCheckSession(getDb(c.env), await principal(c), c.req.param('id'), { approvals: await fixStockOn(c), lotLines: await lotCountsOn(c) })))
// Approve, reject or close a submitted count (ic_fix_stock). Approving repeats with the same requestId until it answers done: true (one request applies the plan's lines per request).
// Closing ends an approval that cannot be finished: no stock moves, the lines applied stay applied, the rest are recorded as not applied.
app.post('/sessions/:id/approval', async c => {
  if (!await fixStockOn(c)) throw new InventoryCheckSessionError(404, 'inventory_check_not_available')
  // The stock writer is the Set sessions' own commit; it is loaded only when a decision reaches stock, so every refusal and a rejection never touch it.
  const writeStock = async (lines: StockInCommitLine[]) => (await import('./stockInCommit')).runStockInCommit(c as unknown as InventoryContext, lines)
  const onDecided = approvalAnnouncer(c)
  const limits = { takeoverSeconds: getPlanLimits(c.env).inventoryCheckApprovalTakeoverSeconds }
  return c.json(await decideInventoryCheckApproval(getDb(c.env), await principal(c), c.req.param('id'), await c.req.json().catch(()=>null), writeStock, limits, onDecided))
})
// One decision on one line of a waiting count (migration 0316): reject, modify or reopen it. It moves no stock; the alert is sent once, when the approval ends (see approvalAnnouncer).
app.post('/sessions/:id/approval/lines', async c => {
  if (!await fixStockOn(c)) throw new InventoryCheckSessionError(404, 'inventory_check_not_available')
  return c.json(await decideInventoryCheckLine(getDb(c.env), await principal(c), c.req.param('id'), await c.req.json().catch(()=>null), approvalAnnouncer(c)))
})
app.get('/sessions/:id/history', async c => c.json(await inventoryCheckSessionHistory(getDb(c.env), await principal(c), c.req.param('id'), c.req.query())))
app.patch('/sessions/:id/items/:productId', async c => {
  const productId = Number(c.req.param('productId'))
  if (!Number.isSafeInteger(productId) || productId<=0) throw new InventoryCheckSessionError(400,'inventory_check_invalid_id')
  return c.json(await patchInventoryCheckObservation(getDb(c.env), await principal(c), c.req.param('id'), productId, await c.req.json().catch(()=>null)))
})
app.patch('/sessions/:id', async c => { boardWrites(c); return c.json(boardBranch(c, await patchInventoryCheckSession(getDb(c.env), await principal(c), c.req.param('id'), await c.req.json().catch(()=>null)))) })
export default app
