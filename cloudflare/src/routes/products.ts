import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { getOrSetJson, versionedKey } from '../lib/cache'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env }>()

function splitSearchTerms(raw: string): string[] {
  return String(raw || '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8)
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

// Builds the same WHERE/params shape as backend/src/routes/products.ts's
// appendProductSearchFilters -- identical SQL, just @param -> our D1 adapter
// (which itself translates @param to positional ? before binding).
function buildSearchFilters(query: Record<string, string>) {
  const where: string[] = ['p.is_active = 1']
  const params: Record<string, unknown> = {}

  const searchTerms = splitSearchTerms(query.query || query.q || '')
  if (searchTerms.length) {
    const searchMode = String(query.searchMode || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'
    const termClauses: string[] = []
    searchTerms.forEach((term, index) => {
      const key = `search${index}`
      params[key] = `%${term}%`
      termClauses.push(`(
        lower(COALESCE(p.name, '')) LIKE @${key}
        OR lower(COALESCE(p.sku, '')) LIKE @${key}
        OR lower(COALESCE(p.barcode, '')) LIKE @${key}
        OR lower(COALESCE(p.brand, '')) LIKE @${key}
        OR lower(COALESCE(p.category, '')) LIKE @${key}
        OR lower(COALESCE(p.supplier, '')) LIKE @${key}
      )`)
    })
    where.push(`(${termClauses.join(searchMode === 'OR' ? ' OR ' : ' AND ')})`)
  }

  for (const field of ['brand', 'category', 'unit', 'supplier']) {
    const raw = String(query[field] || '').trim()
    if (raw && raw.toLowerCase() !== 'all') {
      params[field] = raw.toLowerCase()
      where.push(`lower(trim(COALESCE(p.${field}, ''))) = @${field}`)
    }
  }

  return { where, params }
}

app.get('/search', async (c) => {
  const query = c.req.query()
  const page = clampInt(query.page, 1, 1, 100000)
  const pageSize = clampInt(query.pageSize, 20, 1, 100)
  const offset = (page - 1) * pageSize
  const sort = String(query.sort || 'name_asc').toLowerCase()
  const orderSql =
    sort === 'created_desc' ? 'p.created_at DESC, p.id DESC'
    : sort === 'created_asc' ? 'p.created_at ASC, p.id ASC'
    : 'lower(p.name) ASC, p.id ASC' // D1/SQLite: lower(p.name) instead of COLLATE NOCASE -- same effect, and works whether or not the column has a NOCASE collation

  const cacheKey = await versionedKey(c.env.CACHE, 'products', `search:${JSON.stringify(query)}`)
  const payload = await getOrSetJson(c.env.CACHE, cacheKey, 20, async () => {
    const db = getDb(c.env)
    const { where, params } = buildSearchFilters(query)
    const whereSql = `WHERE ${where.join(' AND ')}`

    const totalRow = await db.prepare(`SELECT COUNT(*) AS count FROM products p ${whereSql}`).get<{ count: number }>(params)
    const total = totalRow?.count || 0

    const items = await db.prepare(`
      SELECT p.id, p.name, p.sku, p.barcode, p.category, p.brand, p.unit, p.description,
             p.selling_price_usd, p.selling_price_khr, p.stock_quantity, p.low_stock_threshold,
             p.out_of_stock_threshold, p.image_path, p.created_at
      FROM products p
      ${whereSql}
      ORDER BY ${orderSql}
      LIMIT @pageSize OFFSET @offset
    `).all({ ...params, pageSize, offset })

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    }
  })

  return c.json(payload)
})

export default app
