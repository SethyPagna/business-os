import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { requireAuth, type SessionUser } from '../lib/auth'
import { getDb } from '../lib/db'
import { loadLowStockConfig } from '../lib/lowStockSettings'
import { InventoryCheckQueryError, validateInventoryCheckQuery, getInventoryCheckAccess } from '../lib/inventoryCheckAccess'
import { readInventoryCheckProducts, InventoryCheckProductsLimitError } from '../lib/inventoryCheckProducts'
import { currentInventoryCheckActor, getInventoryCheckSession, inventoryCheckDigest, InventoryCheckSessionError } from '../lib/inventoryCheckSessions'
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
    ...(rawRanking === '1' ? { customerRanking: 'sale_count' as const } : {}),
    observationFilter: { organizationId: actor.organization_id ?? null, viewerId: actor.id, sessionId,
      state: state as 'unstarted' | 'done' | 'issue' | undefined, reason } })
  const current = await currentInventoryCheckActor(db, principal)
  if (JSON.stringify(current) !== JSON.stringify(actor)) throw new InventoryCheckSessionError(403, 'inventory_check_authority_changed')
  return c.json(result)
})
export default app
