import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { hasPermission } from '../lib/permissions'
import { bumpVersion } from '../lib/cache'
import { normalizePromotionRule, isRuleActive } from '../lib/promotionRules'
import { normalizeToIsoDate } from '../lib/batchCode'
import { broadcast } from '../durable-objects/broadcastHub'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)
// Two features share this mount, gated separately (G1, Part 391):
//  - the ANNOUNCEMENT STRIP (the original endpoints below) keeps its
//    legacy `products` gate on every route;
//  - the promotion RULE engine (/rules*) manages under the new
//    `promotions` page permission, EXCEPT /rules/active, which any
//    authenticated user may read: POS cashiers price carts with these
//    rules without holding the manage permission. The blanket `products`
//    wildcard gate is gone; each route now names its own gate.
const requireKey = (key: string): MiddlewareHandler<{ Bindings: Env; Variables: { user: SessionUser } }> => async (c, next) => {
  if (!hasPermission(c.get('user'), key)) return c.json({ error: 'You do not have permission to perform this action' }, 403)
  return next()
}

// ---------------------------------------------------------------------------
// G1 promotion RULES (/rules*) -- registered BEFORE the legacy strip routes
// so /rules/:id never falls into the strip's own /:id patterns.

const RULE_TYPES = new Set(['quantity_save', 'percent_off', 'fixed_off'])
const RULE_SCOPES = new Set(['products', 'category', 'brand'])

type RuleInput = Record<string, unknown>

function normalizeRuleWrite(body: RuleInput = {}) {
  const ruleType = RULE_TYPES.has(String(body.rule_type)) ? String(body.rule_type) : 'percent_off'
  const scopeType = RULE_SCOPES.has(String(body.scope_type)) ? String(body.scope_type) : 'products'
  const ids = Array.isArray(body.product_ids) ? body.product_ids : []
  const productIds = Array.from(new Set(ids.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0))).slice(0, 200)
  const money = (v: unknown) => Math.max(0, Math.round((Number(v) || 0) * 100) / 100)
  const dateOnly = (v: unknown) => {
    const raw = String(v || '').trim()
    if (!raw) return null
    return normalizeToIsoDate(raw)
  }
  return {
    title: String(body.title || '').trim().slice(0, 120),
    show_title: body.show_title === false || body.show_title === 0 ? 0 : 1,
    rule_type: ruleType,
    min_quantity: ruleType === 'quantity_save' ? Math.max(0, Number(body.min_quantity) || 0) : 0,
    save_usd: ruleType === 'percent_off' ? 0 : money(body.save_usd),
    save_khr: ruleType === 'percent_off' ? 0 : Math.max(0, Math.round(Number(body.save_khr) || 0)),
    percent_off: ruleType === 'percent_off' ? Math.min(100, Math.max(0, Number(body.percent_off) || 0)) : 0,
    scope_type: scopeType,
    product_ids: JSON.stringify(scopeType === 'products' ? productIds : []),
    category: scopeType === 'category' ? String(body.category || '').trim().slice(0, 200) : null,
    brand: scopeType === 'brand' ? String(body.brand || '').trim().slice(0, 200) : null,
    badge_color: normalizeColor(body.badge_color) || '#e11d48',
    starts_at: dateOnly(body.starts_at),
    ends_at: dateOnly(body.ends_at),
    is_active: body.is_active === false || body.is_active === 0 ? 0 : 1,
  }
}

function ruleWriteError(input: ReturnType<typeof normalizeRuleWrite>, body: RuleInput): string | null {
  if (!RULE_TYPES.has(input.rule_type)) return 'Unknown rule type'
  if (input.rule_type === 'percent_off' && input.percent_off <= 0) return 'Enter a percent greater than 0'
  if (input.rule_type !== 'percent_off' && input.save_usd <= 0 && input.save_khr <= 0) return 'Enter a save amount in USD or KHR'
  if (input.rule_type === 'quantity_save' && input.min_quantity < 1) return 'Enter the minimum quantity to buy (at least 1)'
  if (input.scope_type === 'products' && JSON.parse(input.product_ids).length === 0) return 'Choose at least one product'
  if (input.scope_type === 'category' && !input.category) return 'Choose a category'
  if (input.scope_type === 'brand' && !input.brand) return 'Choose a brand'
  // A window the operator TYPED but the parser could not read must fail
  // loudly, not silently store an open-ended rule (Golden Rule: no silent
  // partial writes).
  if (String(body.starts_at || '').trim() && !input.starts_at) return 'Start date is not a real date (use mm/dd/yyyy)'
  if (String(body.ends_at || '').trim() && !input.ends_at) return 'End date is not a real date (use mm/dd/yyyy)'
  return null
}

// Any authenticated user (POS included) may READ the active rule set --
// pricing a cart is not managing promotions. Normalized through the shared
// kernel so every consumer sees the same parsed shape.
app.get('/rules/active', async (c) => {
  const db = getDb(c.env)
  const rows = await db.prepare('SELECT * FROM promotion_rules WHERE is_active = 1 ORDER BY id ASC').all<Record<string, unknown>>()
  const now = new Date()
  const rules = (Array.isArray(rows) ? rows : [])
    .map((row) => normalizePromotionRule(row))
    .filter((rule) => rule && isRuleActive(rule, now))
  return c.json({ rules, now: now.toISOString() })
})

app.get('/rules', requireKey('promotions'), async (c) => {
  const db = getDb(c.env)
  const rows = await db.prepare('SELECT * FROM promotion_rules ORDER BY is_active DESC, id DESC').all<Record<string, unknown>>()
  const now = new Date()
  return c.json((Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    normalized: normalizePromotionRule(row),
    currently_active: (() => { const r = normalizePromotionRule(row); return Boolean(r && isRuleActive(r, now)) })(),
  })))
})

app.post('/rules', requireKey('promotions'), async (c) => {
  const user = c.get('user')
  const body = await c.req.json<RuleInput>()
  const input = normalizeRuleWrite(body)
  const error = ruleWriteError(input, body)
  if (error) return c.json({ error }, 400)
  const db = getDb(c.env)
  const insert = await db.prepare(`
    INSERT INTO promotion_rules (
      title, show_title, rule_type, min_quantity, save_usd, save_khr, percent_off,
      scope_type, product_ids, category, brand, badge_color, starts_at, ends_at, is_active, updated_at
    ) VALUES (@title, @show_title, @rule_type, @min_quantity, @save_usd, @save_khr, @percent_off,
      @scope_type, @product_ids, @category, @brand, @badge_color, @starts_at, @ends_at, @is_active, CURRENT_TIMESTAMP)
  `).run(input)
  await audit(c.env, user?.id ?? null, user?.username ?? null, 'create', 'promotion_rule', insert.lastInsertRowid, { title: input.title, rule_type: input.rule_type, scope_type: input.scope_type })
  // Promoted-first ordering lives inside the cached /api/products/search
  // responses -- a rule write reorders them, so it bumps the same version.
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'promotions', { action: 'rule-create', id: insert.lastInsertRowid }))
  const created = await db.prepare('SELECT * FROM promotion_rules WHERE id = ?').get([insert.lastInsertRowid])
  return c.json(created)
})

app.put('/rules/:id', requireKey('promotions'), async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const db = getDb(c.env)
  const current = await db.prepare('SELECT * FROM promotion_rules WHERE id = ?').get([id])
  if (!current) return c.json({ error: 'Promotion rule not found' }, 404)
  const body = await c.req.json<RuleInput>()
  const input = normalizeRuleWrite(body)
  const error = ruleWriteError(input, body)
  if (error) return c.json({ error }, 400)
  await db.prepare(`
    UPDATE promotion_rules SET
      title=@title, show_title=@show_title, rule_type=@rule_type, min_quantity=@min_quantity,
      save_usd=@save_usd, save_khr=@save_khr, percent_off=@percent_off, scope_type=@scope_type,
      product_ids=@product_ids, category=@category, brand=@brand, badge_color=@badge_color,
      starts_at=@starts_at, ends_at=@ends_at, is_active=@is_active, updated_at=CURRENT_TIMESTAMP
    WHERE id=@id
  `).run({ ...input, id })
  await audit(c.env, user?.id ?? null, user?.username ?? null, 'update', 'promotion_rule', id, { title: input.title, rule_type: input.rule_type, scope_type: input.scope_type })
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'promotions', { action: 'rule-update', id }))
  const updated = await db.prepare('SELECT * FROM promotion_rules WHERE id = ?').get([id])
  return c.json(updated)
})

app.delete('/rules/:id', requireKey('promotions'), async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const db = getDb(c.env)
  const current = await db.prepare('SELECT * FROM promotion_rules WHERE id = ?').get<{ title: string }>([id])
  if (!current) return c.json({ error: 'Promotion rule not found' }, 404)
  await db.prepare('DELETE FROM promotion_rules WHERE id = ?').run([id])
  await audit(c.env, user?.id ?? null, user?.username ?? null, 'delete', 'promotion_rule', id, { title: current.title })
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'promotions', { action: 'rule-delete', id }))
  return c.json({ deleted: true })
})

// ---------------------------------------------------------------------------
// Legacy announcement-strip endpoints (each keeps the products gate).

const LINK_TYPES = new Set(['none', 'product', 'url'])

function normalizeText(value: unknown, maxLen = 500): string {
  return String(value || '').trim().slice(0, maxLen)
}

function normalizeColor(value: unknown): string | null {
  const raw = String(value || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : null
}

type PromotionInput = {
  title?: unknown
  subtitle?: unknown
  image_path?: unknown
  link_type?: unknown
  link_product_id?: unknown
  link_url?: unknown
  badge_text?: unknown
  badge_color?: unknown
  is_active?: unknown
  sort_order?: unknown
  starts_at?: unknown
  ends_at?: unknown
}

function normalizePromotionInput(body: PromotionInput = {}) {
  const linkType = LINK_TYPES.has(body.link_type as string) ? (body.link_type as string) : 'none'
  return {
    title: normalizeText(body.title, 120),
    subtitle: normalizeText(body.subtitle, 240) || null,
    image_path: normalizeText(body.image_path, 500) || null,
    link_type: linkType,
    link_product_id: linkType === 'product' ? (Number(body.link_product_id) || null) : null,
    link_url: linkType === 'url' ? (normalizeText(body.link_url, 500) || null) : null,
    badge_text: normalizeText(body.badge_text, 40) || null,
    badge_color: normalizeColor(body.badge_color),
    is_active: body.is_active === false || body.is_active === 0 ? 0 : 1,
    sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
    starts_at: body.starts_at ? String(body.starts_at) : null,
    ends_at: body.ends_at ? String(body.ends_at) : null,
  }
}

// Admin: list every promotion (active or not), for the editor.
app.get('/', requireKey('products'), async (c) => {
  const db = getDb(c.env)
  const rows = await db.prepare('SELECT * FROM promotions ORDER BY sort_order ASC, id ASC').all()
  return c.json(rows)
})

app.post('/', requireKey('products'), async (c) => {
  const user = c.get('user')
  const body = await c.req.json<PromotionInput>()
  const input = normalizePromotionInput(body)
  if (!input.title) return c.json({ error: 'Title required' }, 400)
  if (input.link_type === 'product' && !input.link_product_id) return c.json({ error: 'Choose a product to link to' }, 400)
  if (input.link_type === 'url' && !input.link_url) return c.json({ error: 'Enter a link URL' }, 400)

  const db = getDb(c.env)
  if (input.link_type === 'product') {
    const productExists = await db.prepare('SELECT id FROM products WHERE id = ?').get([input.link_product_id])
    if (!productExists) return c.json({ error: 'Linked product not found' }, 400)
  }

  const insert = await db.prepare(`
    INSERT INTO promotions (
      title, subtitle, image_path, link_type, link_product_id, link_url,
      badge_text, badge_color, is_active, sort_order, starts_at, ends_at, updated_at
    ) VALUES (@title, @subtitle, @image_path, @link_type, @link_product_id, @link_url,
      @badge_text, @badge_color, @is_active, @sort_order, @starts_at, @ends_at, CURRENT_TIMESTAMP)
  `).run(input)

  await audit(c.env, user?.id ?? null, user?.name ?? null, 'create', 'promotion', insert.lastInsertRowid, { title: input.title })
  c.executionCtx.waitUntil(broadcast(c.env, 'promotions', { action: 'create', id: insert.lastInsertRowid }))
  const created = await db.prepare('SELECT * FROM promotions WHERE id = ?').get([insert.lastInsertRowid])
  return c.json(created)
})

app.put('/:id', requireKey('products'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const db = getDb(c.env)

  const current = await db.prepare('SELECT * FROM promotions WHERE id = ?').get([id])
  if (!current) return c.json({ error: 'Promotion not found' }, 404)

  const body = await c.req.json<PromotionInput>()
  const input = normalizePromotionInput(body)
  if (!input.title) return c.json({ error: 'Title required' }, 400)
  if (input.link_type === 'product' && !input.link_product_id) return c.json({ error: 'Choose a product to link to' }, 400)
  if (input.link_type === 'url' && !input.link_url) return c.json({ error: 'Enter a link URL' }, 400)
  if (input.link_type === 'product') {
    const productExists = await db.prepare('SELECT id FROM products WHERE id = ?').get([input.link_product_id])
    if (!productExists) return c.json({ error: 'Linked product not found' }, 400)
  }

  await db.prepare(`
    UPDATE promotions SET
      title=@title, subtitle=@subtitle, image_path=@image_path, link_type=@link_type,
      link_product_id=@link_product_id, link_url=@link_url, badge_text=@badge_text,
      badge_color=@badge_color, is_active=@is_active, sort_order=@sort_order,
      starts_at=@starts_at, ends_at=@ends_at, updated_at=CURRENT_TIMESTAMP
    WHERE id=@id
  `).run({ ...input, id })

  await audit(c.env, user?.id ?? null, user?.name ?? null, 'update', 'promotion', id, { title: input.title })
  c.executionCtx.waitUntil(broadcast(c.env, 'promotions', { action: 'update', id }))
  const updated = await db.prepare('SELECT * FROM promotions WHERE id = ?').get([id])
  return c.json(updated)
})

// Bulk reorder, for a drag-and-drop editor: body = { order: [id, id, id, ...] }
app.put('/reorder/all', requireKey('products'), async (c) => {
  const user = c.get('user')
  const body = await c.req.json<{ order?: unknown[] }>()
  const order = Array.isArray(body.order) ? body.order : []
  if (!order.length) return c.json({ error: 'order array required' }, 400)

  const db = getDb(c.env)
  await db.batch(order.map((id, index) => ({
    sql: 'UPDATE promotions SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    params: [index, Number(id)],
  })))

  await audit(c.env, user?.id ?? null, user?.name ?? null, 'reorder', 'promotion', null, { order })
  c.executionCtx.waitUntil(broadcast(c.env, 'promotions', { action: 'reorder' }))
  const rows = await db.prepare('SELECT * FROM promotions ORDER BY sort_order ASC, id ASC').all()
  return c.json(rows)
})

app.delete('/:id', requireKey('products'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const db = getDb(c.env)

  const current = await db.prepare('SELECT * FROM promotions WHERE id = ?').get<{ title: string }>([id])
  if (!current) return c.json({ error: 'Promotion not found' }, 404)

  await db.prepare('DELETE FROM promotions WHERE id = ?').run([id])
  await audit(c.env, user?.id ?? null, user?.name ?? null, 'delete', 'promotion', id, { title: current.title })
  c.executionCtx.waitUntil(broadcast(c.env, 'promotions', { action: 'delete', id }))
  return c.json({ deleted: true })
})

export default app
