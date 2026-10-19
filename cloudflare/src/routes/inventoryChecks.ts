import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { requireAuth, type SessionUser } from '../lib/auth'
import { getDb } from '../lib/db'
import { loadLowStockConfig } from '../lib/lowStockSettings'
import type { Env } from '../index'
import { createInventoryCheckSession, getInventoryCheckSession, inventoryCheckDigest, inventoryCheckSessionHistory,
  InventoryCheckSessionError, listInventoryCheckSessions, patchInventoryCheckObservation, patchInventoryCheckSession } from '../lib/inventoryCheckSessions'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)
app.use('*', async (c, next) => { c.header('Cache-Control','private, no-store'); await next() })
app.onError((error,c) => {
  const status = error instanceof InventoryCheckSessionError ? error.status : 'status' in error && typeof error.status === 'number' && [400,403,409,503].includes(error.status) ? error.status as 400|403|409|503 : 503
  const code = 'code' in error && typeof error.code === 'string' ? error.code : 'inventory_check_unavailable'
  return c.json({ error: code, code }, status)
})
async function principal(c: Context<{ Bindings: Env; Variables: { user: SessionUser } }>) {
  const token = getCookie(c, 'bos_session')
  if (!token) throw new InventoryCheckSessionError(401,'invalid_session')
  return { id: c.get('user').id, tokenHash: await inventoryCheckDigest(token) }
}
app.get('/sessions', async c => c.json(await listInventoryCheckSessions(getDb(c.env), await principal(c), c.req.query())))
app.post('/sessions', async c => {
  const result = await createInventoryCheckSession(getDb(c.env), await principal(c), await c.req.json().catch(()=>null), await loadLowStockConfig(c.env))
  return c.json(result, result.created ? 201 : 200)
})
app.get('/sessions/:id', async c => c.json(await getInventoryCheckSession(getDb(c.env), await principal(c), c.req.param('id'))))
app.get('/sessions/:id/history', async c => c.json(await inventoryCheckSessionHistory(getDb(c.env), await principal(c), c.req.param('id'), c.req.query())))
app.patch('/sessions/:id/items/:productId', async c => {
  const productId = Number(c.req.param('productId'))
  if (!Number.isSafeInteger(productId) || productId<=0) throw new InventoryCheckSessionError(400,'inventory_check_invalid_id')
  return c.json(await patchInventoryCheckObservation(getDb(c.env), await principal(c), c.req.param('id'), productId, await c.req.json().catch(()=>null)))
})
app.patch('/sessions/:id', async c => c.json(await patchInventoryCheckSession(getDb(c.env), await principal(c), c.req.param('id'), await c.req.json().catch(()=>null))))
export default app
