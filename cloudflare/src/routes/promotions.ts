import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { hasPermission } from '../lib/permissions'
import { broadcast } from '../durable-objects/broadcastHub'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)
// Legacy gates every promotions endpoint (including reads) behind the
// `products` permission -- this Worker only checked requireAuth (any
// logged-in user), which is a real gap since promotions are customer-
// facing storefront content any staff account could otherwise rewrite.
app.use('*', async (c, next) => {
  const user = c.get('user')
  if (!hasPermission(user, 'products')) return c.json({ error: 'You do not have permission to perform this action' }, 403)
  return next()
})

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
app.get('/', async (c) => {
  const db = getDb(c.env)
  const rows = await db.prepare('SELECT * FROM promotions ORDER BY sort_order ASC, id ASC').all()
  return c.json(rows)
})

app.post('/', async (c) => {
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

app.put('/:id', async (c) => {
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
app.put('/reorder/all', async (c) => {
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

app.delete('/:id', async (c) => {
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
