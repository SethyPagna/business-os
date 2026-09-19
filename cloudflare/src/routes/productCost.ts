import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { isAdminControlUser } from '../lib/permissions'
import { getCatalogCostBreakdown } from '../lib/catalogCostRecompute'
import type { Env } from '../index'

// P10-6: a separate file (not routes/products.ts) so this one new GET route
// does not conflict with the sibling lane owning products.ts's create/edit
// handlers. Mounted at the same '/api/products' base as productsRoute --
// see index.ts.
const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()

app.use('*', requireAuth)

// Only administrators may read acquisition costs, including the calculation.
function canReadCost(user: SessionUser): boolean {
  return isAdminControlUser(user)
}

app.get('/:id/cost-breakdown', async (c) => {
  const user = c.get('user')
  if (!canReadCost(user)) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const productId = Number(c.req.param('id')) || 0
  if (!productId) return c.json({ error: 'Product not found' }, 404)

  const db = getDb(c.env)
  const breakdown = await getCatalogCostBreakdown(db, productId)
  if (!breakdown) return c.json({ error: 'Product not found' }, 404)

  return c.json(breakdown)
})

export default app
