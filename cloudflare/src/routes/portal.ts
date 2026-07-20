import { Hono } from 'hono'
import { getDb } from '../lib/db'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env }>()

// Ported following the same pattern as ../routes/products.ts. The full
// version (signals, asset galleries, initials/brand/category facets) is
// documented in cloudflare/MIGRATION.md rather than duplicated here --
// same technique, more branches.
app.get('/catalog/products/search', async (c) => {
  const db = getDb(c.env)
  const page = Math.max(1, Number.parseInt(c.req.query('page') || '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(c.req.query('pageSize') || '20', 10) || 20))
  const offset = (page - 1) * pageSize

  const totalRow = await db.prepare(`
    SELECT COUNT(*) AS count FROM products p
    WHERE p.is_active = 1 AND COALESCE(p.stock_quantity, 0) > COALESCE(p.out_of_stock_threshold, 0)
  `).get<{ count: number }>()
  const total = totalRow?.count || 0

  const items = await db.prepare(`
    SELECT p.id, p.name, p.category, p.brand, p.selling_price_usd, p.selling_price_khr, p.image_path
    FROM products p
    WHERE p.is_active = 1 AND COALESCE(p.stock_quantity, 0) > COALESCE(p.out_of_stock_threshold, 0)
    ORDER BY lower(p.name) ASC, p.id ASC
    LIMIT @pageSize OFFSET @offset
  `).all({ pageSize, offset })

  return c.json({ items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) })
})

export default app
