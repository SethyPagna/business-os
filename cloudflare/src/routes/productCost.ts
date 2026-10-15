import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { canViewAcquisitionCosts } from '../lib/acquisitionCostAccess'
import { getCatalogCostBreakdown } from '../lib/catalogCostRecompute'
import { parseReceivingCostPreview, previewReceivingCosts, ReceivingCostPreviewInputError } from '../lib/receivingCostPreview'
import { admitRequestBody, SMALL_BODY_BYTES } from '../lib/requestBodyGuard'
import type { Env } from '../index'

// P10-6: a separate file (not routes/products.ts) so this one new GET route
// does not conflict with the sibling lane owning products.ts's create/edit
// handlers. Mounted at the same '/api/products' base as productsRoute --
// see index.ts.
const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()

app.use('*', requireAuth)

// The explicit cost-view capability governs the complete calculation too.
function canReadCost(user: SessionUser): boolean {
  return canViewAcquisitionCosts(user)
}

app.post('/receiving-cost-preview', async (c) => {
  c.header('Cache-Control', 'no-store')
  if (!canReadCost(c.get('user'))) return c.json({ error: 'You do not have permission to perform this action' }, 403)
  const refused = await admitRequestBody(c, SMALL_BODY_BYTES)
  if (refused) return refused
  try {
    const raw = await c.req.json().catch(() => null)
    const lines = parseReceivingCostPreview(raw)
    const results = await previewReceivingCosts(getDb(c.env), lines)
    return c.json({ advisory: true, results })
  } catch (error) {
    if (error instanceof ReceivingCostPreviewInputError) return c.json({ error: error.message, code: 'invalid_receiving_preview' }, 400)
    throw error
  }
})

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
