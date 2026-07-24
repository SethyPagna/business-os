import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { sanitizeMediaList } from '../lib/media'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env }>()

app.get('/meta', async (c) => {
  const db = getDb(c.env)
  const categories = await db.prepare('SELECT id, name FROM categories ORDER BY lower(name) ASC').all()
  const branches = await db.prepare("SELECT id, name, is_default FROM branches WHERE is_active = 1 ORDER BY is_default DESC, lower(name) ASC").all()
  return c.json({ categories, branches })
})

type ProductRow = {
  id: number
  name: string
  category: string | null
  unit: string | null
  description: string | null
  selling_price_usd: number | null
  selling_price_khr: number | null
  stock_quantity: number | null
  low_stock_threshold: number | null
  out_of_stock_threshold: number | null
  image_path: string | null
}

app.get('/products', async (c) => {
  const db = getDb(c.env)

  const products = await db.prepare(`
    SELECT id, name, category, unit, description, selling_price_usd, selling_price_khr,
           stock_quantity, low_stock_threshold, out_of_stock_threshold, image_path
    FROM products
    WHERE is_active = 1
    ORDER BY lower(name) ASC
  `).all<ProductRow>()

  if (products.length === 0) {
    return c.json([])
  }

  const productIds = products.map((p) => p.id)
  const placeholders = productIds.map(() => '?').join(',')

  // The original does this per-product-per-branch join with a Postgres-only
  // json_agg(json_build_object(...)) FILTER (WHERE ...) aggregate in one
  // query. That exact syntax has no SQLite equivalent (json_build_object
  // doesn't exist in SQLite at all) -- confirmed the closest native
  // approximation, json_group_array(json_object(...)) FILTER (WHERE ...),
  // does work in real D1, but built this as two plain queries + an
  // app-side group instead, for consistency with the rest of this
  // migration's style (products.ts, sales.ts, portal.ts all do the same).
  const branches = await db.prepare('SELECT id, name FROM branches WHERE is_active = 1 ORDER BY is_default DESC, lower(name) ASC').all<{ id: number; name: string }>()
  const stockRows = await db.prepare(`SELECT product_id, branch_id, quantity FROM branch_stock WHERE product_id IN (${placeholders})`).all<{ product_id: number; branch_id: number; quantity: number }>(productIds)
  const stockByProduct = new Map<number, Map<number, number>>()
  for (const row of stockRows) {
    if (!stockByProduct.has(row.product_id)) stockByProduct.set(row.product_id, new Map())
    stockByProduct.get(row.product_id)!.set(row.branch_id, row.quantity)
  }

  const imageRows = await db.prepare(`SELECT product_id, image_path FROM product_images WHERE product_id IN (${placeholders}) ORDER BY sort_order ASC, id ASC`).all<{ product_id: number; image_path: string }>(productIds)
  const imagesByProduct = new Map<number, string[]>()
  for (const row of imageRows) {
    if (!imagesByProduct.has(row.product_id)) imagesByProduct.set(row.product_id, [])
    imagesByProduct.get(row.product_id)!.push(row.image_path)
  }

  const payload = products.map((product) => {
    const branchStock = branches.map((branch) => ({
      branch_id: branch.id,
      branch_name: branch.name,
      quantity: stockByProduct.get(product.id)?.get(branch.id) ?? 0,
    }))
    const gallery = sanitizeMediaList(imagesByProduct.get(product.id) || []).slice(0, 5)
    const fallbackImage = sanitizeMediaList([product.image_path])[0] || null
    if (!gallery.length && fallbackImage) gallery.push(fallbackImage)

    return {
      ...product,
      image_path: gallery[0] || null,
      image_gallery: gallery,
      branch_stock: branchStock,
    }
  })

  return c.json(payload)
})

export default app
