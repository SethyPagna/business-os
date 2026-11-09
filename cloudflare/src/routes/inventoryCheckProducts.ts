import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { requireAuth, type SessionUser } from '../lib/auth'
import { getDb } from '../lib/db'
import { loadLowStockConfig } from '../lib/lowStockSettings'
import { InventoryCheckQueryError, validateInventoryCheckQuery, getInventoryCheckAccess, canApproveInventoryCounts } from '../lib/inventoryCheckAccess'
import { getActionTier } from '../lib/permissions'
import { readInventoryCheckProducts, readInventoryCheckProductsSimple, InventoryCheckProductsLimitError } from '../lib/inventoryCheckProducts'
import { canSeeStaffIdentity, currentInventoryCheckActor, getInventoryCheckSession, getInventoryCheckSessionBranch, inventoryCheckDigest, InventoryCheckSessionError, approvalsAvailable, pendingApprovalLines } from '../lib/inventoryCheckSessions'
import { readSwitch } from '../lib/readSwitches'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next() })
app.use('*', requireAuth)
app.onError((error, c) => {
  const known = error instanceof InventoryCheckQueryError || error instanceof InventoryCheckSessionError || error instanceof InventoryCheckProductsLimitError
  return c.json({ error: known ? error.code : 'inventory_check_unavailable', code: known ? error.code : 'inventory_check_unavailable',
    ...(error instanceof InventoryCheckQueryError ? { parameter: error.parameter } : {}) }, known ? error.status : 503)
})
app.get('/', async c => {
  const db = getDb(c.env), token = getCookie(c, 'bos_session')
  if (!token) throw new InventoryCheckSessionError(401, 'invalid_session')
  const principal = { id: c.get('user').id, tokenHash: await inventoryCheckDigest(token) }
  const actor = await currentInventoryCheckActor(db, principal), raw = c.req.queries()
  for (const [key, values] of Object.entries(raw)) if (values.length !== 1) throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', key)
  if (await readSwitch(c.env, 'ic_simple')) {
    // The owner's list (ic_simple): a closed query (state, reason, customerRanking, dates and sales sorts are refused as 400 by the validator), no sales stats.
    const { sessionId: rawSimpleSession, ...simpleQuery } = c.req.query()
    const simpleSession = rawSimpleSession?.trim() || undefined
    validateInventoryCheckQuery(simpleQuery, getInventoryCheckAccess(actor), true)
    if (simpleSession) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(simpleSession)) throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', 'sessionId')
      const detail = await getInventoryCheckSessionBranch(db, principal, simpleSession)
      for (const value of [simpleQuery.branchId, simpleQuery.branch_id]) if (value && value !== String(detail.branch_id)) throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', 'branchId')
      simpleQuery.branchId = String(detail.branch_id)
    }
    const simple = await readInventoryCheckProductsSimple(db, actor, simpleQuery, { lowStock: await loadLowStockConfig(c.env),
      check: { organizationId: actor.organization_id ?? null, viewerId: actor.id, sessionId: simpleSession, canSeeStaffIdentity: accountId => canSeeStaffIdentity(actor, accountId) } })
    // ic_fix_stock: counts waiting for approval are tagged, and the page learns which actions this viewer has. Only a viewer who may see stock learns either.
    let answer: Record<string, unknown> = simple
    // The switch counts as on only once migration 0286 is applied (otherwise this answers exactly as OFF).
    if (getInventoryCheckAccess(actor).fields.stock && await readSwitch(c.env, 'ic_fix_stock') && await approvalsAvailable(db)) {
      const pending = await pendingApprovalLines(db, actor, simpleSession ? [] : simple.items.filter(item => typeof item.check_session_id === 'string').map(item => Number(item.id)))
      const adjust = getActionTier(actor, 'inventory', 'adjust') === 'full'
      answer = { ...simple, items: simple.items.map(item => pending.has(`${item.check_session_id}:${item.id}`) ? { ...item, check_pending: true } : item),
        capabilities: { fixStock: true, approveCounts: adjust && canApproveInventoryCounts(actor) } }
    }
    const after = await currentInventoryCheckActor(db, principal)
    if (JSON.stringify(after) !== JSON.stringify(actor)) throw new InventoryCheckSessionError(403, 'inventory_check_authority_changed')
    return c.json(answer)
  }
  const { sessionId: rawSession, state: rawState, reason: rawReason, customerRanking: rawRanking, checkState: rawCheckState, summary: rawSummary, ...query } = c.req.query()
  // The ic_simple page speaks two words this old list never had, and reaches it whenever the switch is off (the default): `summary=0` on a page step (there are no check
  // counts to skip, so it is ignored) and `checkState=issue` for the Issues view (which is the old state=issue). Any other checkState has no meaning here and stays a 400.
  if (rawSummary !== undefined && rawSummary.trim() !== '' && !['0', '1'].includes(rawSummary.trim())) throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', 'summary')
  const checkState = rawCheckState?.trim() || undefined, stateWord = rawState?.trim() || undefined
  if (checkState !== undefined && (checkState !== 'issue' || stateWord !== undefined && stateWord !== 'issue')) throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', 'checkState')
  const sessionId = rawSession?.trim() || undefined, state = checkState ? 'issue' : stateWord === 'all' ? undefined : stateWord
  const reason = rawReason?.trim() || undefined
  if (state && !['unstarted', 'done', 'issue'].includes(state)) throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', 'state')
  if (['unstarted', 'done'].includes(state || '') && !sessionId) throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', 'sessionId')
  if (rawRanking !== undefined && !['0', '1'].includes(rawRanking)) throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', 'customerRanking')
  const access = getInventoryCheckAccess(actor)
  validateInventoryCheckQuery(query, access)
  if (sessionId) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', 'sessionId')
    const detail = await getInventoryCheckSession(db, principal, sessionId)
    for (const value of [query.branchId, query.branch_id]) if (value && value !== String(detail.item.branch_id)) throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', 'branchId')
    query.branchId = String(detail.item.branch_id)
  }
  const result = await readInventoryCheckProducts(db, actor, query, { lowStock: await loadLowStockConfig(c.env), rankingLimit: 10,
    costReviewKeyAvailable: actor.product_cost_review_key_available === 1,
    ...(rawRanking === '1' ? { customerRanking: 'sale_count' as const } : {}),
    observationFilter: { organizationId: actor.organization_id ?? null, viewerId: actor.id, sessionId,
      state: state as 'unstarted' | 'done' | 'issue' | undefined, reason } })
  const current = await currentInventoryCheckActor(db, principal)
  if (JSON.stringify(current) !== JSON.stringify(actor)) throw new InventoryCheckSessionError(403, 'inventory_check_authority_changed')
  return c.json(result)
})
export default app
