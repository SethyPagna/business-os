import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth } from '../lib/auth'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env }>()
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

app.get('/:id', async (c) => {
  const db = getDb(c.env)
  const id = Number(c.req.param('id'))
  const sale = await db.prepare('SELECT * FROM sales WHERE id = ?').get([id])
  if (!sale) return c.json({ error: 'Sale not found' }, 404)
  const items = await db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all([id])
  return c.json({ ...sale, items })
})

export default app
