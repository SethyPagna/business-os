import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { requireAuth, type SessionUser } from '../lib/auth'
import { actorSnapshot } from '../lib/actorSnapshot'
import { getDb } from '../lib/db'
import { loadLowStockConfig } from '../lib/lowStockSettings'
import { readSwitch } from '../lib/readSwitches'
import type { Env } from '../index'
import { decideInventoryCheckApproval, type ApprovalDecided } from '../lib/inventoryCheckApprovals'
import { getPlanLimits } from '../lib/planTier'
import type { ReviewAlertEvent, ReviewAlertHook } from '../lib/reviewAlert'
import type { InventoryContext } from './inventory'
import type { StockInCommitLine } from './stockInCommit'
import { bumpVersion } from '../lib/cache'
import { canApproveInventoryCounts, getInventoryCheckAccess, InventoryCheckQueryError } from '../lib/inventoryCheckAccess'
import { canonicalProductsRequest, checkStateRestriction, inventoryChecksVersion, planInventoryList, projectInventoryList, readCheckStateSets, type CheckStateSets } from '../lib/inventoryCheckList'
import { parseOverlayIds, readInventoryOverlay } from '../lib/inventoryCheckOverlay'
import { getActionTier } from '../lib/permissions'
import { attachLotRows, readProductSearchList } from './products'
import { approvalsAvailable, createInventoryCheckSession, createInventoryCheckSubmission, getInventoryCheckSession, inventoryCheckDigest, inventoryCheckSessionHistory,
  InventoryCheckSessionError, listInventoryCheckSessions, patchInventoryCheckObservation, patchInventoryCheckSession, REPLACED_NOTE } from '../lib/inventoryCheckSessions'

// A global hook, not an import: the alert module is installed by index.ts, many tests load this route alone, and an absent hook is a no-op
// (the same contract as lib/reviewGate.ts). The Telegram alert is sent after the write it announces committed, never on a replay or a refusal.
const reviewAlertHook = (): ReviewAlertHook | undefined =>
  (globalThis as unknown as Record<symbol, ReviewAlertHook | undefined>)[Symbol.for('business-os.review-alert.v1')]
// `system`: no person decided (an approval every line of which a newer count replaced), so no "By" row is sent.
const announceCount = (env: Env, user: SessionUser, event: Pick<ReviewAlertEvent, 'kind' | 'reason'> & { sessionId: string; system?: true }): Promise<void> =>
  Promise.resolve(reviewAlertHook()?.announce(env, {
    kind: event.kind, by: event.kind === 'created' || event.system ? undefined : actorSnapshot(user), reason: event.reason ?? null,
    row: { section: 'inventory_checks', action_type: 'approve', entity_type: 'count', entity_id: event.sessionId, payload_json: '{}', requested_by_name: event.kind === 'created' ? actorSnapshot(user) : null },
  }))

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)
app.use('*', async (c, next) => { c.header('Cache-Control','private, no-store'); await next() })
app.onError((error,c) => {
  const status = error instanceof InventoryCheckSessionError ? error.status : 'status' in error && typeof error.status === 'number' && [400,403,409,503].includes(error.status) ? error.status as 400|403|409|503 : 503
  const code = 'code' in error && typeof error.code === 'string' ? error.code : 'inventory_check_unavailable'
  const details = error instanceof InventoryCheckSessionError && error.details ? error.details : {}
  return c.json({ ...details, error: code, code, ...(code === 'inventory_check_outcome_unknown' ? { outcome: 'unknown' } : {}) }, status)
})
/** ic_fix_stock counts as ON only once migration 0286 is applied: with the switch on and the table missing every count would fail, so it answers exactly as OFF. */
const fixStockOn = async (c: Context<{ Bindings: Env; Variables: { user: SessionUser } }>): Promise<boolean> => await readSwitch(c.env, 'ic_fix_stock') && await approvalsAvailable(getDb(c.env))
async function principal(c: Context<{ Bindings: Env; Variables: { user: SessionUser } }>) {
  const token = getCookie(c, 'bos_session')
  if (!token) throw new InventoryCheckSessionError(401,'invalid_session')
  return { id: c.get('user').id, tokenHash: await inventoryCheckDigest(token) }
}
// Every Inventory Check writer moves the inventory_checks version, AWAITED before the answer leaves (the check-state sets and every restricted list key on it). Only a
// request that wrote or may have written: a refusal before the write (4xx) moves nothing. With ic_wired OFF nothing is cached from these tables, so nothing is bumped and the
// write's statements are exactly what they were; a cached copy lives at most the cache lifetime, so a flip back ON cannot serve one for long.
app.use('*', async (c, next) => {
  await next()
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return
  const status = c.res.status
  if (status >= 400 && status < 500) return
  if (await readSwitch(c.env, 'ic_wired')) await bumpVersion(c.env, 'inventory_checks')
})

// ---- ic_wired: the Inventory Check list and overlay over the shared Products reader (INV-A S4a) ----------------------------------------------------------
// Both answer 404 while the switch is OFF (the page keeps its old path). /list is GET /api/products/search for the scope plus the viewer's grants; /overlay is the
// only other read Inventory makes, scoped to a window of ids. See lib/inventoryCheckList.ts and lib/inventoryCheckOverlay.ts.
type IcContext = Context<{ Bindings: Env; Variables: { user: SessionUser } }>
const notWired = (c: IcContext) => c.json({ error: 'not_found', code: 'not_found' }, 404)
const singleValued = (c: IcContext): void => {
  for (const [key, values] of Object.entries(c.req.queries())) if (values.length !== 1) throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', key)
}
app.get('/list', async c => {
  if (!await readSwitch(c.env, 'ic_wired')) return notWired(c)
  singleValued(c)
  const user = c.get('user'), db = getDb(c.env)
  const access = getInventoryCheckAccess(user)
  // Counts waiting for approval are known only to a viewer who may see stock, and only while ic_fix_stock is on (migration 0286 applied): the same rule as the old list.
  const fixStock = access.fields.stock && await fixStockOn(c)
  const plan = planInventoryList(user, c.req.query(), { pendingAvailable: fixStock })
  const productsQuery = { ...plan.productsQuery }
  if (plan.codeLookup) {
    // A viewer without the barcode field finds a product by its WHOLE code only: an exact hit is read by id, anything else is searched by name.
    const hit = await db.prepare('SELECT id FROM products WHERE barcode = @code OR sku = @code LIMIT 2').all<{ id: number }>({ code: plan.codeLookup })
    if (hit.length === 1) { delete productsQuery.query; delete productsQuery.searchFields; productsQuery.ids = String(hit[0].id); productsQuery.page = '1'; productsQuery.pageSize = '1' }
  }
  let sets: CheckStateSets | null = null
  let setsVersion = ''
  if (plan.branchId !== null && (plan.checkState || plan.wantSummary)) ({ sets, version: setsVersion } = await readCheckStateSets(c, plan.branchId, fixStock))
  const restriction = plan.checkState && sets ? checkStateRestriction(plan.checkState, sets) : {}
  const include = new Set<string>([...access.fields.stock ? ['tagged_lots'] : [], ...access.fields.received ? ['lots'] : []])
  const payload = await readProductSearchList(c, productsQuery, { include, keyRequest: canonicalProductsRequest(productsQuery), ...restriction,
    ...(plan.checkState ? { setKey: plan.checkState, setVersion: setsVersion } : {}), lotsAdmitted: access.fields.received, taggedLotsAdmitted: access.fields.stock })
  const productsPage = getActionTier(user, 'products', 'view') !== 'none'
  const { body, projected } = projectInventoryList(payload as Record<string, unknown>, user, access, productsPage)
  const total = Number((payload as { total?: unknown }).total) || 0
  const summary = sets && plan.wantSummary && !sets.tooLarge ? { ok: sets.ok.length, issue: sets.issue.length, ...(fixStock ? { pending: sets.pending.length } : {}),
    // Not checked is the catalogue total minus what was checked; it is only known when this list is the whole catalogue (no search, filter or check state).
    ...(plan.filtered ? {} : { not_checked: Math.max(0, total - sets.ok.length - sets.issue.length), total }) } : null
  return c.json({ ...body, wired: true, projected, ...(summary ? { summary } : {}),
    ...(fixStock ? { capabilities: { fixStock: true, approveCounts: getActionTier(user, 'inventory', 'adjust') === 'full' && canApproveInventoryCounts(user) } } : {}) })
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
  const wantLots = c.req.query('lots') === '1' && access.fields.received
  const [items, withLots] = await Promise.all([
    readInventoryOverlay(c.env, user, { branchId, ids, pendingAvailable: access.fields.stock && await fixStockOn(c) }),
    // Received dates for the same ids, for a screen whose shared store does not hold them: the same reader as the list (a first read, not a second).
    wantLots ? attachLotRows(c.env, user, new Set(['lots']), { items: ids.map((id) => ({ id })) }, true) : Promise.resolve(null),
  ])
  const lots = withLots ? (withLots.items as Array<{ id: number; lots?: Array<Record<string, unknown>>; lots_more?: true }>).map((row) => ({ product_id: row.id,
    lots: (row.lots ?? []).map((lot) => access.fields.stock ? lot : { ...lot, branches: (lot.branches as Array<Record<string, unknown>>).map(({ quantity: _quantity, ...entry }) => entry) }),
    ...(row.lots_more ? { lots_more: true } : {}) })) : undefined
  return c.json({ wired: true, branchId, version: await inventoryChecksVersion(c.env), items, ...(lots ? { lots } : {}) })
})
app.get('/sessions', async c => c.json(await listInventoryCheckSessions(getDb(c.env), await principal(c), c.req.query(), { approvals: await fixStockOn(c) })))
app.post('/sessions', async c => {
  const result = await createInventoryCheckSession(getDb(c.env), await principal(c), await c.req.json().catch(()=>null), await loadLowStockConfig(c.env), { simple: await readSwitch(c.env, 'ic_simple') })
  return c.json(result, result.created ? 201 : 200)
})
// The owner's way to count (ic_simple): pick products, type counts in the rows, submit once. With the switch off the route does not exist.
app.post('/submissions', async c => {
  if (!await readSwitch(c.env, 'ic_simple')) throw new InventoryCheckSessionError(404, 'inventory_check_not_available')
  const result = await createInventoryCheckSubmission(getDb(c.env), await principal(c), await c.req.json().catch(()=>null), await loadLowStockConfig(c.env),
    { approvals: await fixStockOn(c), onApprovalCreated: ({ sessionId }) => announceCount(c.env, c.get('user'), { kind: 'created', sessionId }),
      // Each approval the submission replaced was rejected by the system: a review decided, so it is told like one (a rejection with its reason, and no person to name).
      onApprovalsReplaced: async ({ sessionIds }) => { for (const sessionId of sessionIds) await announceCount(c.env, c.get('user'), { kind: 'rejected', sessionId, reason: REPLACED_NOTE, system: true }) } })
  return c.json(result, result.created ? 201 : 200)
})
app.get('/sessions/:id', async c => c.json(await getInventoryCheckSession(getDb(c.env), await principal(c), c.req.param('id'), { approvals: await fixStockOn(c) })))
// Approve, reject or close a submitted count (ic_fix_stock). Approving repeats with the same requestId until it answers done: true (one request applies the plan's lines per request).
// Closing ends an approval that cannot be finished: no stock moves, the lines applied stay applied, the rest are recorded as not applied.
app.post('/sessions/:id/approval', async c => {
  if (!await fixStockOn(c)) throw new InventoryCheckSessionError(404, 'inventory_check_not_available')
  // The stock writer is the Set sessions' own commit; it is loaded only when a decision reaches stock, so every refusal and a rejection never touch it.
  const writeStock = async (lines: StockInCommitLine[]) => (await import('./stockInCommit')).runStockInCommit(c as unknown as InventoryContext, lines)
  // A close that applied nothing reads as a rejection (the reason is its note or "Closed"); one that applied something reads as an approval.
  const onDecided: ApprovalDecided = ({ decision, sessionId, note, applied }) => {
    if (decision === 'replaced') return announceCount(c.env, c.get('user'), { kind: 'rejected', sessionId, reason: REPLACED_NOTE, system: true })
    const rejected = decision === 'reject' || (decision === 'close' && !applied)
    return announceCount(c.env, c.get('user'), { kind: rejected ? 'rejected' : 'approved', sessionId, reason: rejected ? note ?? (decision === 'close' ? 'Closed' : null) : null })
  }
  const limits = { takeoverSeconds: getPlanLimits(c.env).inventoryCheckApprovalTakeoverSeconds }
  return c.json(await decideInventoryCheckApproval(getDb(c.env), await principal(c), c.req.param('id'), await c.req.json().catch(()=>null), writeStock, limits, onDecided))
})
app.get('/sessions/:id/history', async c => c.json(await inventoryCheckSessionHistory(getDb(c.env), await principal(c), c.req.param('id'), c.req.query())))
app.patch('/sessions/:id/items/:productId', async c => {
  const productId = Number(c.req.param('productId'))
  if (!Number.isSafeInteger(productId) || productId<=0) throw new InventoryCheckSessionError(400,'inventory_check_invalid_id')
  return c.json(await patchInventoryCheckObservation(getDb(c.env), await principal(c), c.req.param('id'), productId, await c.req.json().catch(()=>null)))
})
app.patch('/sessions/:id', async c => c.json(await patchInventoryCheckSession(getDb(c.env), await principal(c), c.req.param('id'), await c.req.json().catch(()=>null))))
export default app
