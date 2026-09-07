// Drives the real GET /sales/export route against the full migrated SQLite
// schema. The preview's headline, status rows, and product rows must use the
// same canonical recognized-revenue basis: net invoice discounts and
// customer refunds, including Not Paid sales and excluding voided sales.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const moduleCache = new Map()
const USER = {
  id: 91,
  username: 'export_accountant',
  name: 'Export Accountant',
  permissions: JSON.stringify({ sales: true }),
}

const dbOverride = { getDb: (env) => env.DB }
const overrides = {
  '../lib/db': dbOverride,
  './db': dbOverride,
  '../lib/auth': {
    requireAuth: async (c, next) => {
      c.set('user', USER)
      return next()
    },
  },
  '../lib/audit': { audit: async () => {} },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': {
    bumpVersion: async () => {},
    getVersionWithFallback: async () => 0,
    cachedJsonResponse: async (_request, _context, _key, _ttl, loader) => loader(),
  },
  '../lib/telegram': {
    formatSaleTelegramLines: () => [],
    sendTelegramEvent: async () => {},
    telegramMoney: (value) => String(value ?? ''),
  },
}

function load(rel) {
  if (moduleCache.has(rel)) return moduleCache.get(rel).exports
  const sourcePath = path.join(__dirname, '..', 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  moduleCache.set(rel, mod)
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

const app = load('routes/sales.ts').default
const executionCtx = { waitUntil(promise) { promise?.catch?.(() => {}) }, passThroughOnException() {} }
const db = openDb(loadAll())
const run = (sql, params = {}) => db.prepare(sql).run(params)

run(`INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)`)

function addSale({ id, status, subtotal, discount = 0, membershipDiscount = 0, total }) {
  run(`INSERT INTO sales(
      id,receipt_number,cashier_id,cashier_name,branch_id,branch_name,
      payment_method,payment_currency,exchange_rate,subtotal_usd,subtotal_khr,
      discount_usd,discount_khr,membership_discount_usd,membership_discount_khr,
      tax_usd,tax_khr,total_usd,total_khr,amount_paid_usd,amount_paid_khr,
      change_usd,change_khr,is_delivery,delivery_fee_usd,delivery_fee_khr,
      delivery_fee_paid_by,sale_status,items,created_at,updated_at,stock_skipped
    ) VALUES(
      @id,@receipt,91,'export_accountant',1,'Shop',
      'Cash','USD',4000,@subtotal,@subtotalKhr,
      @discount,@discountKhr,@membershipDiscount,@membershipDiscountKhr,
      0,0,@total,@totalKhr,@total,0,
      0,0,0,0,0,
      'customer',@status,'[]','2026-09-08 01:00:00','2026-09-08 01:00:00',0
    )`, {
    id,
    receipt: `SALE-${id}`,
    subtotal,
    subtotalKhr: subtotal * 4000,
    discount,
    discountKhr: discount * 4000,
    membershipDiscount,
    membershipDiscountKhr: membershipDiscount * 4000,
    total,
    totalKhr: total * 4000,
    status,
  })
}

function addItem({ id, saleId, productId, name, total, quantity = 1 }) {
  run(`INSERT INTO sale_items(
      id,sale_id,product_id,product_name,sku,quantity,unit,
      applied_price_usd,applied_price_khr,cost_price_usd,cost_price_khr,
      total_usd,total_khr,branch_id,product_discount_usd,product_discount_khr,
      manual_discount_usd,manual_discount_khr
    ) VALUES(
      @id,@saleId,@productId,@name,@sku,@quantity,'each',
      @total,@totalKhr,0,0,@total,@totalKhr,1,0,0,0,0
    )`, { id, saleId, productId, name, sku: `SKU-${productId}`, quantity, total, totalKhr: total * 4000 })
}

// $100 of lines, a $5 store discount, then a charged-basis refund whose
// canonical net-sales share is exactly $25: 100 - 5 - 25 = $70 revenue.
addSale({ id: 101, status: 'completed', subtotal: 100, discount: 5, total: 95 })
addItem({ id: 201, saleId: 101, productId: 301, name: 'Alpha', total: 60 })
addItem({ id: 202, saleId: 101, productId: 302, name: 'Beta', total: 40 })
run(`INSERT INTO returns(
    id,return_number,sale_id,receipt_number,cashier_id,cashier_name,
    branch_id,branch_name,total_refund_usd,total_refund_khr,exchange_rate,
    status,return_scope,created_at,updated_at
  ) VALUES(
    401,'RET-401',101,'SALE-101',91,'export_accountant',
    1,'Shop',@refund,@refundKhr,4000,'completed','customer',
    '2026-09-09 01:00:00','2026-09-09 01:00:00'
  )`, { refund: 25 / 0.95, refundKhr: (25 / 0.95) * 4000 })

// Not Paid is recognized now. It is part of revenue, not a deferred cohort.
addSale({ id: 102, status: 'awaiting_payment', subtotal: 20, total: 20 })
addItem({ id: 203, saleId: 102, productId: 301, name: 'Alpha', total: 20 })

// Voided sales keep their count/status row but contribute no money or product
// quantity to the recognized breakdown.
addSale({ id: 103, status: 'cancelled', subtotal: 50, total: 50 })
addItem({ id: 204, saleId: 103, productId: 303, name: 'Cancelled product', total: 50 })

// Three line shares exercise the response's cents allocation: independently
// rounding .3332/.3234/.3234 would lose one cent against the $0.98 headline.
addSale({ id: 104, status: '', subtotal: 1, discount: 0.02, total: 0.98 })
addItem({ id: 205, saleId: 104, productId: 304, name: 'Cent A', total: 0.34 })
addItem({ id: 206, saleId: 104, productId: 305, name: 'Cent B', total: 0.33 })
addItem({ id: 207, saleId: 104, productId: 306, name: 'Cent C', total: 0.33 })

// A legacy header with no item rows must remain explicit rather than vanish
// from by_product while still contributing to the summary.
addSale({ id: 105, status: 'completed', subtotal: 2.5, total: 2.5 })

const sum = (rows, key) => Math.round(rows.reduce((total, row) => total + Number(row[key] || 0), 0) * 100) / 100

;(async () => {
  const response = await app.request(
    'http://local/export?startDate=2026-09-08&endDate=2026-09-08&pageSize=50',
    {},
    { DB: db, TEST_USER: USER },
    executionCtx,
  )
  const body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body))

  assert.equal(body.summary.revenue_usd, 118.48, 'pre-refund net sales are shown once')
  assert.equal(body.summary.total_refunds_usd, 25, 'refund is on the same canonical basis')
  assert.equal(body.summary.net_revenue_usd, 93.48, 'canonical net revenue includes Not Paid and excludes cancelled')

  const byStatus = Object.fromEntries(body.by_status.map((row) => [row.status, row]))
  assert.deepEqual(byStatus.completed, { status: 'completed', count: 3, revenue: 73.48 })
  assert.deepEqual(byStatus.awaiting_payment, { status: 'awaiting_payment', count: 1, revenue: 20 })
  assert.deepEqual(byStatus.cancelled, { status: 'cancelled', count: 1, revenue: 0 })
  assert.equal(sum(body.by_status, 'revenue'), body.summary.net_revenue_usd, 'status money reconciles to headline')

  const byProduct = Object.fromEntries(body.by_product.map((row) => [row.product_name, row]))
  assert.equal(byProduct.Alpha.revenue_usd, 62, 'receipt discounts/refund are proportionally allocated once')
  assert.equal(byProduct.Beta.revenue_usd, 28)
  assert.equal(byProduct.Alpha.qty_sold, 2, 'Not Paid quantity remains recognized')
  assert.equal(byProduct['Cancelled product'], undefined, 'cancelled product contributes no recognized quantity or revenue')
  assert.equal(byProduct['Unallocated sales'].revenue_usd, 2.5, 'unallocated legacy header remains visible')
  assert.equal(sum(body.by_product, 'revenue_usd'), body.summary.net_revenue_usd, 'product money reconciles to headline after cents allocation')
  assert.equal(sum(body.by_product.filter((row) => row.product_name?.startsWith('Cent ')), 'revenue_usd'), 0.98,
    'fractional line shares neither lose nor duplicate a cent')

  console.log('PASS sales export preview: canonical headline/status/product revenue reconciles at $93.48')
  console.log('test-sales-export-preview-revenue-pure: ok')
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
