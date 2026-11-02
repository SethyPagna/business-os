import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { requireAuth, type SessionUser } from '../lib/auth'
import { getDb } from '../lib/db'
import { loadLowStockConfig } from '../lib/lowStockSettings'
import { InventoryCheckQueryError, validateInventoryCheckQuery, getInventoryCheckAccess } from '../lib/inventoryCheckAccess'
import { readInventoryCheckProducts, readInventoryCheckProductsSimple, InventoryCheckProductsLimitError } from '../lib/inventoryCheckProducts'
import { canSeeStaffIdentity, currentInventoryCheckActor, getInventoryCheckSession, getInventoryCheckSessionBranch, inventoryCheckDigest, InventoryCheckSessionError } from '../lib/inventoryCheckSessions'
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
    const after = await currentInventoryCheckActor(db, principal)
    if (JSON.stringify(after) !== JSON.stringify(actor)) throw new InventoryCheckSessionError(403, 'inventory_check_authority_changed')
    return c.json(simple)
  }
  const { sessionId: rawSession, state: rawState, reason: rawReason, customerRanking: rawRanking, ...query } = c.req.query()
  const sessionId = rawSession?.trim() || undefined, state = rawState?.trim() === 'all' ? undefined : rawState?.trim() || undefined
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
