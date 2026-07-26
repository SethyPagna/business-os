import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)

type SaleItemInput = {
  product_id?: number
  id?: number
  product_name?: string
  name?: string
  quantity: number
  applied_price_usd?: number
  applied_price_khr?: number
  branch_id?: number
}

type NormalizedItem = Omit<SaleItemInput, 'branch_id'> & { product_id: number; quantity: number; branch_id: number | null }

// Same rounding convention as the original: currency math stays in plain
// floats (this schema stores REAL, not fixed-point), rounded to cents/riel
// only at display time -- ported as-is rather than "improved", since
// changing money-rounding behavior silently is exactly the kind of change
// that should be a deliberate, separately-reviewed decision, not a side
// effect of a platform migration.
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

app.post('/', async (c) => {
  const db = getDb(c.env)
  const body = await c.req.json<{
    items: SaleItemInput[]
    branch_id?: number
    cashier_id?: number
    cashier_name?: string
    customer_name?: string
    customer_phone?: string
    payment_method?: string
    payment_currency?: string
    exchange_rate?: number
    discount_usd?: number
    tax_usd?: number
    amount_paid_usd?: number
    receipt_number?: string
  }>()

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ error: 'Sale items required' }, 400)
  }

  // ---- 1. Normalize + validate input shape (no DB access yet) ----
  const normalized: NormalizedItem[] = []
  for (let index = 0; index < body.items.length; index += 1) {
    const item = body.items[index]
    const productId = Number(item.product_id || item.id)
    if (!Number.isFinite(productId) || productId <= 0) {
      return c.json({ error: `Sale item #${index + 1} is missing a product` }, 400)
    }
    const quantity = Number(item.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return c.json({ error: `Sale item #${index + 1} has an invalid quantity` }, 400)
    }
    normalized.push({
      ...item,
      product_id: productId,
      quantity,
      branch_id: Number(item.branch_id || body.branch_id) || null,
    })
  }

  // ---- 2. Read current prices + stock (plain reads, before any writes) ----
  const productIds = [...new Set(normalized.map((i) => i.product_id))]
  const placeholders = productIds.map(() => '?').join(',')
  const products = await db
    .prepare(`SELECT id, name, selling_price_usd, selling_price_khr, cost_price_usd, cost_price_khr FROM products WHERE id IN (${placeholders})`)
    .all<{ id: number; name: string; selling_price_usd: number; selling_price_khr: number; cost_price_usd: number; cost_price_khr: number }>(productIds)
  const productMap = new Map(products.map((p) => [p.id, p]))

  // D1's batch() is atomic but cannot branch mid-batch (see lib/db.ts) --
  // validate stock as a plain read first, exactly like the original
  // backend/src/routes/sales.ts's assertSaleStockAvailable does, *before*
  // building the atomic write batch below.
  for (const item of normalized) {
    if (!item.branch_id) continue
    const stockRow = await db
      .prepare('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = ?')
      .get<{ quantity: number }>([item.product_id, item.branch_id])
    const available = stockRow?.quantity || 0
    if (item.quantity > available) {
      const name = productMap.get(item.product_id)?.name || `product #${item.product_id}`
      return c.json({ error: `Insufficient stock for ${name}: requested ${item.quantity}, available ${available}` }, 409)
    }
  }

  // ---- 3. Calculate totals (pure computation, no I/O) ----
  const exchangeRate = Number(body.exchange_rate) || 4100
  let subtotalUsd = 0
  const priced = normalized.map((item) => {
    const product = productMap.get(item.product_id)
    const unitPriceUsd = Number(item.applied_price_usd ?? product?.selling_price_usd ?? 0)
    const lineTotalUsd = round2(unitPriceUsd * item.quantity)
    subtotalUsd += lineTotalUsd
    return {
      ...item,
      product_name: item.product_name || item.name || product?.name || `product #${item.product_id}`,
      unitPriceUsd,
      lineTotalUsd,
      costPriceUsd: Number(product?.cost_price_usd || 0),
      costPriceKhr: Number(product?.cost_price_khr || 0),
    }
  })
  const discountUsd = round2(Number(body.discount_usd) || 0)
  const taxUsd = round2(Number(body.tax_usd) || 0)
  const totalUsd = round2(subtotalUsd - discountUsd + taxUsd)
  const totalKhr = Math.round(totalUsd * exchangeRate)
  const amountPaidUsd = Number(body.amount_paid_usd) || totalUsd
  const changeUsd = round2(amountPaidUsd - totalUsd)
  const receiptNumber = body.receipt_number?.trim() || `RCP-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`

  // ---- 4. Insert the sale header (single statement -- see lib/db.ts's
  // batch() docs for why this can't be the same atomic unit as step 5) ----
  const saleInsert = await db
    .prepare(`
      INSERT INTO sales (
        receipt_number, cashier_id, cashier_name, branch_id, customer_name, customer_phone,
        payment_method, payment_currency, exchange_rate,
        subtotal_usd, subtotal_khr, discount_usd, tax_usd, total_usd, total_khr,
        amount_paid_usd, change_usd, sale_status, created_at, updated_at
      ) VALUES (@receipt_number, @cashier_id, @cashier_name, @branch_id, @customer_name, @customer_phone,
        @payment_method, @payment_currency, @exchange_rate,
        @subtotal_usd, @subtotal_khr, @discount_usd, @tax_usd, @total_usd, @total_khr,
        @amount_paid_usd, @change_usd, 'completed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `)
    .run({
      receipt_number: receiptNumber,
      cashier_id: body.cashier_id || null,
      cashier_name: body.cashier_name || null,
      branch_id: body.branch_id || null,
      customer_name: body.customer_name || null,
      customer_phone: body.customer_phone || null,
      payment_method: body.payment_method || 'Cash',
      payment_currency: body.payment_currency || 'USD',
      exchange_rate: exchangeRate,
      subtotal_usd: round2(subtotalUsd),
      subtotal_khr: Math.round(subtotalUsd * exchangeRate),
      discount_usd: discountUsd,
      tax_usd: taxUsd,
      total_usd: totalUsd,
      total_khr: totalKhr,
      amount_paid_usd: amountPaidUsd,
      change_usd: changeUsd,
    })
  const saleId = saleInsert.lastInsertRowid

  // ---- 5. Atomically write items + stock deduction + movement log.
  // If ANY of this fails, none of it is applied (D1 batch() semantics) --
  // and we then delete the orphaned sale header from step 4, so the caller
  // never sees a "sale" with no items. ----
  try {
    const statements: Array<{ sql: string; params: Record<string, unknown> }> = []
    for (const item of priced) {
      statements.push({
        sql: `INSERT INTO sale_items (sale_id, product_id, product_name, quantity, applied_price_usd, applied_price_khr, cost_price_usd, cost_price_khr, total_usd, total_khr, branch_id)
              VALUES (@sale_id, @product_id, @product_name, @quantity, @applied_price_usd, @applied_price_khr, @cost_price_usd, @cost_price_khr, @total_usd, @total_khr, @branch_id)`,
        params: {
          sale_id: saleId,
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: item.quantity,
          applied_price_usd: item.unitPriceUsd,
          applied_price_khr: Math.round(item.unitPriceUsd * exchangeRate),
          cost_price_usd: item.costPriceUsd,
          cost_price_khr: item.costPriceKhr,
          total_usd: item.lineTotalUsd,
          total_khr: Math.round(item.lineTotalUsd * exchangeRate),
          branch_id: item.branch_id,
        },
      })
      if (item.branch_id) {
        // SQLite's MAX() takes multiple scalar args (largest of them),
        // unlike Postgres where that's GREATEST() and MAX() is
        // aggregate-only. The original backend/src/routes/sales.ts uses
        // GREATEST(0, ...) here -- Postgres-only syntax that would fail on
        // D1/SQLite as a plain syntax error, not a subtle bug.
        statements.push({
          sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@product_id, @branch_id, 0)
                ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = MAX(0, branch_stock.quantity - @quantity)`,
          params: { product_id: item.product_id, branch_id: item.branch_id, quantity: item.quantity },
        })
        statements.push({
          sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reference_id, user_id, user_name)
                VALUES (@product_id, @product_name, @branch_id, 'sale', @quantity, @unit_cost_usd, @unit_cost_khr, @reference_id, @user_id, @user_name)`,
          params: {
            product_id: item.product_id,
            product_name: item.product_name,
            branch_id: item.branch_id,
            quantity: -item.quantity,
            unit_cost_usd: item.costPriceUsd,
            unit_cost_khr: item.costPriceKhr,
            reference_id: saleId,
            user_id: body.cashier_id || null,
            user_name: body.cashier_name || null,
          },
        })
      }
    }
    await db.batch(statements)
  } catch (error) {
    await db.prepare('DELETE FROM sales WHERE id = ?').run([saleId])
    return c.json({ error: `Failed to record sale items: ${(error as Error).message}` }, 500)
  }

  return c.json({
    id: saleId,
    receiptNumber,
    subtotalUsd: round2(subtotalUsd),
    discountUsd,
    taxUsd,
    totalUsd,
    totalKhr,
    changeUsd,
    itemCount: priced.length,
  })
})

type SaleRow = {
  id: number
  branch_id: number | null
  customer_id: number | null
  cashier_id: number | null
  cashier_name: string | null
  customer_name: string | null
  customer_phone: string | null
  branch_name: string | null
  payment_method: string | null
  notes: string | null
  sale_status: string | null
  created_at: string
  discount_usd: number | null
  discount_khr: number | null
  membership_discount_usd: number | null
  membership_discount_khr: number | null
  total_usd: number | null
  total_khr: number | null
  [key: string]: unknown
}

// GET /api/sales -- the real list/history/receipt-lookup endpoint (there is
// no separate GET /api/sales/:id in the actual app; a receipt is one row
// out of this same list, matched by search). The original does this with a
// single Postgres query using STRING_AGG / json_agg / json_build_object /
// a ::json cast -- none of which exist in SQLite. Ported as: one filtered
// query for the matching sales, then two follow-up queries (sale_items,
// a refund rollup from returns) grouped in JS, matching the app-side-join
// style already used throughout this migration.
app.get('/', async (c) => {
  const query = c.req.query()
  const user = c.get('user')
  const db = getDb(c.env)

  const where: string[] = ['1=1']
  const params: Record<string, unknown> = {}

  if (query.startDate) { where.push('date(s.created_at) >= @startDate'); params.startDate = query.startDate }
  if (query.endDate) { where.push('date(s.created_at) <= @endDate'); params.endDate = query.endDate }
  if (query.cashier) { where.push('s.cashier_name LIKE @cashier'); params.cashier = `%${query.cashier}%` }
  if (query.userId) {
    // Matches the original's isAdminControlUser check -- simplified to
    // username==='admin' or an explicit permissions.all flag, since role
    // management (role_code lookups against the roles table) isn't ported
    // yet. Disclosed simplification, not a silent behavior change: see
    // MIGRATION.md.
    const permissions = (() => { try { return JSON.parse(user?.permissions || '{}') } catch { return {} } })()
    const isAdmin = user?.username === 'admin' || permissions?.all === true
    if (!isAdmin) return c.json({ error: 'Administrator access required for cashier user filters.' }, 403)
    where.push('s.cashier_id = @userId')
    params.userId = Number(query.userId) || query.userId
  }
  if (query.branchId) {
    where.push('(s.branch_id = @branchId OR EXISTS (SELECT 1 FROM sale_items sif WHERE sif.sale_id = s.id AND sif.branch_id = @branchId))')
    params.branchId = query.branchId
  }
  if (query.status) { where.push('s.sale_status = @status'); params.status = query.status }

  const search = String(query.search || query.q || '').trim().toLowerCase()
  const searchTerms = search.split(/\s+/).filter(Boolean)
  searchTerms.forEach((term, index) => {
    const key = `search${index}`
    params[key] = `%${term}%`
    where.push(`(
      lower(COALESCE(s.receipt_number, '')) LIKE @${key}
      OR lower(COALESCE(s.cashier_name, '')) LIKE @${key}
      OR lower(COALESCE(s.customer_name, '')) LIKE @${key}
      OR lower(COALESCE(s.customer_phone, '')) LIKE @${key}
      OR lower(COALESCE(c.membership_number, '')) LIKE @${key}
      OR lower(COALESCE(s.branch_name, '')) LIKE @${key}
      OR lower(COALESCE(s.payment_method, '')) LIKE @${key}
      OR lower(COALESCE(s.notes, '')) LIKE @${key}
      OR EXISTS (SELECT 1 FROM sale_items sis WHERE sis.sale_id = s.id AND lower(COALESCE(sis.product_name, '')) LIKE @${key})
    )`)
  })

  const limit = Math.min(Number.parseInt(String(query.limit || '100'), 10) || 100, 500)
  params.limit = limit

  const sales = await db.prepare(`
    SELECT s.*, c.membership_number AS customer_membership_number
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    WHERE ${where.join(' AND ')}
    ORDER BY s.created_at DESC
    LIMIT @limit
  `).all<SaleRow>(params)

  if (sales.length === 0) return c.json([])

  const saleIds = sales.map((s) => s.id)
  const placeholders = saleIds.map(() => '?').join(',')

  const itemRows = await db.prepare(`
    SELECT si.*, b.name AS branch_name
    FROM sale_items si
    LEFT JOIN branches b ON b.id = si.branch_id
    WHERE si.sale_id IN (${placeholders})
    ORDER BY si.id ASC
  `).all<{ sale_id: number; [key: string]: unknown }>(saleIds)
  const itemsBySale = new Map<number, unknown[]>()
  for (const row of itemRows) {
    if (!itemsBySale.has(row.sale_id)) itemsBySale.set(row.sale_id, [])
    itemsBySale.get(row.sale_id)!.push(row)
  }

  const refundRows = await db.prepare(`
    SELECT sale_id, COUNT(*) AS return_count, COALESCE(SUM(total_refund_usd), 0) AS refund_usd, COALESCE(SUM(total_refund_khr), 0) AS refund_khr
    FROM returns
    WHERE sale_id IN (${placeholders}) AND COALESCE(status, 'completed') != 'cancelled' AND COALESCE(return_scope, 'customer') = 'customer'
    GROUP BY sale_id
  `).all<{ sale_id: number; return_count: number; refund_usd: number; refund_khr: number }>(saleIds)
  const refundsBySale = new Map(refundRows.map((r) => [r.sale_id, r]))

  const payload = sales.map((sale) => {
    const refund = refundsBySale.get(sale.id)
    const refundUsd = refund?.refund_usd || 0
    const refundKhr = refund?.refund_khr || 0
    return {
      ...sale,
      items: itemsBySale.get(sale.id) || [],
      refund_usd: refundUsd,
      refund_khr: refundKhr,
      return_count: refund?.return_count || 0,
      total_discount_usd: (sale.discount_usd || 0) + (sale.membership_discount_usd || 0),
      total_discount_khr: (sale.discount_khr || 0) + (sale.membership_discount_khr || 0),
      net_total_usd: (sale.total_usd || 0) - refundUsd,
      net_total_khr: (sale.total_khr || 0) - refundKhr,
    }
  })

  return c.json(payload)
})

export default app
