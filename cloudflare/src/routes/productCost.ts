import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { canViewAcquisitionCosts, canEditAcquisitionCosts } from '../lib/acquisitionCostAccess'
import { getActionTier } from '../lib/permissions'
import { COST_REVIEW_MONEY_FIELDS, costReviewConfirmationQuote, costReviewConfirmationStatements, type CostReviewState } from '../lib/productCostReview'
import { prepareProductMoneyWrite, readProductMoneyPlan } from '../lib/productWrites'
import { bumpVersion } from '../lib/cache'
import { broadcast } from '../durable-objects/broadcastHub'
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

async function readReviewState(db: ReturnType<typeof getDb>, id: number): Promise<CostReviewState | undefined> {
  return db.prepare(`SELECT id,cost_review_key,${COST_REVIEW_MONEY_FIELDS.join(',')},COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='product' AND entity_key=CAST(products.id AS TEXT)),0) AS revision FROM products WHERE id=@id AND is_active=1`).get<CostReviewState>({ id })
}

app.post('/:id/cost-review/confirm', async (c) => {
  c.header('Cache-Control', 'no-store')
  const user = c.get('user')
  if (!canReadCost(user) || !canEditAcquisitionCosts(user) || getActionTier(user, 'products', 'edit') !== 'full') return c.json({ error: 'You do not have permission to perform this action' }, 403)
  const refused = await admitRequestBody(c, SMALL_BODY_BYTES)
  if (refused) return refused
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null
  if (!Number.isSafeInteger(id) || id <= 0 || !body || Object.keys(body).some(key => !['client_request_id', 'reviewed_digest', 'value'].includes(key))
    || typeof body.client_request_id !== 'string' || !/^[A-Za-z0-9_-]{8,120}$/.test(body.client_request_id)
    || typeof body.reviewed_digest !== 'string' || !/^[a-f0-9]{64}$/.test(body.reviewed_digest)
    || typeof body.value !== 'number' || !Number.isFinite(body.value) || body.value < 0) return c.json({ error: 'A current known USD cost confirmation is required.', code: 'invalid_cost_review_confirmation' }, 400)
  const db = getDb(c.env)
  const request = JSON.stringify({ productId: id, reviewed_digest: body.reviewed_digest, value: body.value })
  const receipt = () => db.prepare(`SELECT details FROM audit_logs WHERE action='cost_override' AND entity='product' AND entity_id=@entityId AND user_id=@actorId AND json_extract(CASE WHEN json_valid(details) THEN details ELSE '{}' END,'$.client_request_id')=@requestId ORDER BY id LIMIT 1`).get<{ details: string }>({ entityId: String(id), actorId: user.id, requestId: body.client_request_id })
  const respond = async (details: string, replayed: boolean) => {
    const saved = JSON.parse(details)
    if (saved.kind !== 'product.cost-review-confirm' || saved.request !== request) return c.json({ error: 'This request was already used for a different confirmation.', code: 'idempotency_conflict' }, 409)
    const current = await readReviewState(db, id)
    return c.json({ success: true, replayed, product_id: id, cost_needs_review: Boolean(current?.cost_review_key) })
  }
  const prior = await receipt()
  if (prior) return respond(prior.details, true)
  const state = await readReviewState(db, id)
  const quote = state ? await costReviewConfirmationQuote(state) : null
  if (!state || !quote || quote.reviewed_digest !== body.reviewed_digest || quote.usd !== body.value) return c.json({ error: 'The product changed. Review its cost again.', code: 'product_cost_review_state_conflict' }, 409)
  const money: Record<string, unknown> = { cost_price_usd: state.cost_price_usd }
  await prepareProductMoneyWrite(c.env, money, id)
  const plan = readProductMoneyPlan(money)
  if (!plan?.before || COST_REVIEW_MONEY_FIELDS.some(field => plan.before![field] !== state[field])) return c.json({ error: 'The product changed. Review its cost again.', code: 'product_cost_review_state_conflict' }, 409)
  const nonce = crypto.randomUUID()
  let uncertain = false
  try { await db.batchOnce(costReviewConfirmationStatements(state, { actorId: user.id, actorName: user.name ?? null, requestId: body.client_request_id, request, nonce })) } catch { uncertain = true }
  const saved = await receipt()
  if (!saved) {
    const current = await readReviewState(db, id)
    if (!current || current.revision !== state.revision || current.cost_review_key !== state.cost_review_key || COST_REVIEW_MONEY_FIELDS.some(field => current[field] !== state[field])) return c.json({ error: 'The product changed. Review its cost again.', code: 'product_cost_review_state_conflict' }, 409)
  }
  if (!saved) return c.json({ error: 'The confirmation is not confirmed. Retry the original request.', code: 'cost_review_outcome_unknown' }, 503)
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'cost-review-confirm' }))
  return respond(saved.details, uncertain || JSON.parse(saved.details).claim_nonce !== nonce)
})

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

  const state = canEditAcquisitionCosts(user) && getActionTier(user, 'products', 'edit') === 'full' ? await readReviewState(db, productId) : undefined
  const confirmation = state ? await costReviewConfirmationQuote(state) : null
  c.header('Cache-Control', 'no-store')
  return c.json({ ...breakdown, ...(state?.cost_review_key ? { cost_needs_review: true } : {}), ...(confirmation ? { costConfirmation: confirmation } : {}) })
})

export default app
