'use strict'
// P1.4 (6.0.1050): the report_atomic switch. OFF runs today's reader (the legacy copy of the base code), ON runs the bounded
// atomic batch, SHADOW serves OFF and checks it against ON on a sampled request. This test runs the public readers inside a
// real Worker (Miniflare, every migration, a seeded synthetic history with the business-day boundary rows) and proves:
//   1. OFF and ON return identical results for every date range the UI offers x branch x reader, and the instrument can tell
//      them apart (three mutants of the atomic path are each caught);
//   2. a write landing between any two of a request's D1 calls never produces a mixed snapshot, on either path;
//   3. the shadow compares, serves OFF, tells a concurrent write from a mismatch, and costs nothing when unsampled or on Free;
//   4. crafted filters (inherited/accessor/null-prototype objects, injection strings, reversed and malformed dates) take the
//      same outcome on both paths and never widen the scope; an unreadable or malformed switch row is OFF.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createHash } = require('node:crypto'), { createRequire } = require('node:module')
const cf = path.resolve(__dirname, '..')
const local = createRequire(path.join(cf, 'package.json'))
const { build, transformSync } = local('esbuild'), { Miniflare, Log, LogLevel } = local('miniflare'), { unstable_splitSqlQuery: splitSql } = local('wrangler')
const sha = value => createHash('sha256').update(value).digest('hex')
const lf = value => value.replace(/\r\n/g, '\n')
const workerSource = lf(fs.readFileSync(path.join(__dirname, 'harness/report-atomic-parity-worker.ts'), 'utf8'))

const ALIASES = { 'current:analytics': 'src/lib/salesAnalytics', 'current:money': 'src/lib/reportMoneyPrecision', 'current:switches': 'src/lib/readSwitches',
  'current:router': 'src/lib/reportAtomicSwitch', 'current:schema': 'src/lib/schemaProbe', 'current:window': 'src/lib/businessDateWindow', 'current:plan': 'src/lib/planTier' }
const ANALYTICS = 'cloudflare/src/lib/salesAnalytics.ts'
const once = (text, before, after) => { assert.equal(text.split(before).length, 2, 'MUTANT_SEAM_MISSING: ' + before.slice(0, 80)); return text.replace(before, () => after) }
// Each mutant breaks one thing in the ATOMIC path only; the legacy copy has different text at these seams.
const MUTANTS = {
  'omit-item-cost': text => once(text, "'id', 'sale_id', 'quantity', 'total_usd', 'cost_price_usd', 'product_discount_usd', 'manual_discount_usd',", "'id', 'sale_id', 'quantity', 'total_usd', 'product_discount_usd', 'manual_discount_usd',"),
  'returns-unscoped': text => once(text, "AND (${primary.sql})`, idExpr: 'r.id'", "AND (1=1)`, idExpr: 'r.id'"),
  'drop-void-group': text => once(text, "if (options.maxReceipts === undefined) groups.push({ kind: 'voidSales'", "if (false) groups.push({ kind: 'voidSales'"),
}

async function bundleWorker(mutant) {
  const sources = new Map()
  const shown = relative => {
    const file = path.resolve(path.dirname(cf), relative)
    if (!file.startsWith(cf + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null
    let text = lf(fs.readFileSync(file, 'utf8'))
    if (mutant && relative === ANALYTICS) text = MUTANTS[mutant](text)
    sources.set(relative, text)
    return text
  }
  const plugin = { name: 'checkout-graph', setup(b) {
    b.onResolve({ filter: /^current:/ }, args => ({ path: ALIASES[args.path], namespace: 'checkout' }))
    b.onResolve({ filter: /^\.\.?\//, namespace: 'checkout' }, args => ({ path: path.posix.normalize(path.posix.join(path.posix.dirname(args.importer), args.path)), namespace: 'checkout' }))
    b.onLoad({ filter: /.*/, namespace: 'checkout' }, args => {
      for (const suffix of ['.ts', '/index.ts', '.json', '']) {
        const text = shown('cloudflare/' + args.path + suffix)
        if (text !== null) return { contents: text, loader: (args.path + suffix).endsWith('.json') ? 'json' : 'ts', resolveDir: cf }
      }
      throw new Error('Missing source ' + args.path)
    })
  } }
  const out = await build({ stdin: { contents: workerSource, resolveDir: cf, loader: 'ts', sourcefile: 'report-atomic-parity-worker.ts' }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], plugins: [plugin], logLevel: 'error' })
  return { script: out.outputFiles[0].text, files: sources.size }
}

// ---- the synthetic history -------------------------------------------------------------------------------------------------
const TODAY = '2026-09-13'
const NOW_LOCAL = new Date(2026, 8, 13, 12, 0, 0)
const q = value => "'" + String(value).replace(/'/g, "''") + "'"
const lit = value => value === null || value === undefined ? 'NULL' : typeof value === 'number' ? String(value) : q(value)
const prng = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 }
const money2 = n => Math.round(n * 100) / 100
const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10)
const pad = n => String(n).padStart(2, '0')
const utc = (date, h, m = 0, s = 0) => `${date} ${pad(h)}:${pad(m)}:${pad(s)}`

function insertSql(table, columns, rows) {
  const out = []
  for (let i = 0; i < rows.length; i += 60) out.push(`INSERT INTO ${table}(${columns.join(',')}) VALUES ${rows.slice(i, i + 60).map(row => '(' + columns.map(c => lit(row[c])).join(',') + ')').join(',')}`)
  return out
}
const SALE_COLUMNS = ['id', 'receipt_number', 'created_at', 'updated_at', 'sale_status', 'branch_id', 'branch_name', 'cashier_id', 'cashier_name', 'customer_id', 'customer_name', 'payment_method', 'exchange_rate', 'subtotal_usd', 'discount_usd',
  'membership_discount_usd', 'tax_usd', 'total_usd', 'delivery_fee_usd', 'delivery_fee_paid_by', 'delivery_actual_cost_usd', 'is_delivery', 'amount_paid_usd', 'money_precision_version', 'calculated_total_usd', 'rounding_adjustment_usd',
  'status_before_cancel', 'cancelled_at', 'cancel_reason', 'status_before_return']
const ITEM_COLUMNS = ['id', 'sale_id', 'product_id', 'product_name', 'quantity', 'applied_price_usd', 'total_usd', 'cost_price_usd', 'product_discount_usd', 'manual_discount_usd', 'branch_id']
const RETURN_COLUMNS = ['id', 'return_number', 'sale_id', 'created_at', 'updated_at', 'status', 'return_scope', 'total_refund_usd', 'total_refund_khr', 'exchange_rate', 'refund_currency', 'owed_reduction_usd', 'money_precision_version', 'branch_id', 'branch_name']
const RETURN_ITEM_COLUMNS = ['id', 'return_id', 'sale_item_id', 'product_id', 'product_name', 'quantity', 'applied_price_usd', 'total_usd', 'cost_price_usd', 'return_to_stock', 'stock_action', 'branch_id']

function buildHistory() {
  const rand = prng(20261102)
  const sales = [], items = [], returns = [], returnItems = [], fees = [], payments = []
  let itemId = 1, returnId = 1, returnItemId = 1
  const baseSale = (id, extra) => ({ id, receipt_number: 'R' + String(id).padStart(7, '0'), created_at: null, updated_at: null, sale_status: 'completed', branch_id: 1, branch_name: 'Main', cashier_id: 1, cashier_name: 'Cashier',
    customer_id: null, customer_name: 'Walk-in', payment_method: 'Cash', exchange_rate: 4000, subtotal_usd: 0, discount_usd: 0, membership_discount_usd: 0, tax_usd: 0, total_usd: 0, delivery_fee_usd: 0, delivery_fee_paid_by: 'customer',
    delivery_actual_cost_usd: null, is_delivery: 0, amount_paid_usd: 0, money_precision_version: 0, calculated_total_usd: null, rounding_adjustment_usd: 0, status_before_cancel: null, cancelled_at: null, cancel_reason: null, status_before_return: null, ...extra })
  const addItems = (sale, lines) => {
    let subtotal = 0
    const made = []
    for (const line of lines) {
      const quantity = line.quantity ?? 1, price = line.price ?? 10, total = money2(quantity * price - (line.discount ?? 0))
      const item = { id: itemId++, sale_id: sale.id, product_id: 1000 + (line.product ?? 1), product_name: line.name ?? 'Item ' + (line.product ?? 1), quantity, applied_price_usd: price, total_usd: total,
        cost_price_usd: line.cost === undefined ? money2(price * 0.45) : line.cost, product_discount_usd: line.discount ?? 0, manual_discount_usd: 0, branch_id: sale.branch_id }
      items.push(item); made.push(item); subtotal += total
    }
    sale.subtotal_usd = money2(subtotal)
    const customerPaidDelivery = sale.is_delivery && sale.delivery_fee_paid_by === 'customer' ? sale.delivery_fee_usd : 0
    sale.total_usd = money2(sale.subtotal_usd - sale.discount_usd - sale.membership_discount_usd + sale.tax_usd + customerPaidDelivery)
    if (sale.sale_status === 'awaiting_payment') sale.amount_paid_usd = sale.amount_paid_usd || 0
    else if (sale.sale_status !== 'cancelled' || sale.status_before_cancel) sale.amount_paid_usd = sale.total_usd
    return made
  }
  const addReturn = (sale, made, fields) => {
    const line = made[0], quantity = fields.quantity ?? 1
    const refund = fields.refund ?? money2(line.applied_price_usd * quantity)
    returns.push({ id: returnId, return_number: 'RT' + String(returnId).padStart(6, '0'), sale_id: sale.id, created_at: fields.created_at, updated_at: fields.created_at, status: fields.status ?? 'completed', return_scope: fields.scope ?? 'customer',
      total_refund_usd: refund, total_refund_khr: fields.khr ?? 0, exchange_rate: 4000, refund_currency: fields.currency ?? null, owed_reduction_usd: fields.owed ?? 0, money_precision_version: 0, branch_id: sale.branch_id, branch_name: sale.branch_name })
    returnItems.push({ id: returnItemId++, return_id: returnId, sale_item_id: line.id, product_id: line.product_id, product_name: line.product_name, quantity, applied_price_usd: line.applied_price_usd, total_usd: refund,
      cost_price_usd: line.cost_price_usd, return_to_stock: fields.restock === false ? 0 : 1, stock_action: fields.restock === false ? 'damaged' : 'restock', branch_id: sale.branch_id })
    returnId += 1
  }
  // ~420 days of ordinary trading: mixed statuses, branches, discounts, unknown costs, delivery, returns of every kind.
  let id = 1
  const names = ['Khmer ក្មែរ', 'Quote "Q" \\ slash', 'Plain', "O'Brien", 'Emoji 🙂']
  for (let back = 420; back >= 0; back--) {
    const date = addDays(TODAY, -back)
    const count = back === 0 ? 4 : rand() < 0.15 ? 0 : 1 + Math.floor(rand() * 2)
    for (let k = 0; k < count; k++) {
      const roll = rand()
      const sale = baseSale(id++, { created_at: utc(date, 1 + Math.floor(rand() * 12), Math.floor(rand() * 60), Math.floor(rand() * 60)), branch_id: rand() < 0.2 ? 2 : 1,
        customer_id: rand() < 0.5 ? 1 + Math.floor(rand() * 20) : null, payment_method: rand() < 0.3 ? 'ABA' : 'Cash' })
      sale.branch_name = sale.branch_id === 1 ? 'Main' : 'Second'
      sale.customer_name = sale.customer_id ? names[sale.customer_id % names.length] + ' ' + sale.customer_id : 'Walk-in'
      sale.updated_at = sale.created_at
      if (roll < 0.07) sale.sale_status = 'cancelled'
      else if (roll < 0.15) sale.sale_status = 'awaiting_payment'
      if (rand() < 0.07) sale.discount_usd = money2(1 + rand() * 3)
      if (rand() < 0.04) sale.membership_discount_usd = money2(rand() * 2)
      if (rand() < 0.07) { sale.is_delivery = 1; sale.delivery_fee_usd = 1.5; sale.delivery_fee_paid_by = rand() < 0.5 ? 'store' : 'customer'; sale.delivery_actual_cost_usd = 1.25 }
      const lines = Array.from({ length: 1 + Math.floor(rand() * 4) }, (_, i) => ({ product: 1 + Math.floor(rand() * 40), name: 'Product ' + names[i % names.length], quantity: 1 + Math.floor(rand() * 3), price: money2(2 + rand() * 20),
        cost: rand() < 0.1 ? null : undefined, discount: rand() < 0.05 ? 0.5 : 0 }))
      const made = addItems(sale, lines)
      if (sale.sale_status === 'cancelled') { sale.status_before_cancel = 'completed'; sale.cancelled_at = utc(date, 14); sale.cancel_reason = 'synthetic' }
      if (sale.sale_status === 'awaiting_payment' && rand() < 0.3) sale.amount_paid_usd = money2(sale.total_usd / 3)
      sales.push(sale)
      if (sale.sale_status !== 'cancelled' && rand() < 0.07) {
        const later = Math.min(back, Math.floor(rand() * 45))
        const when = utc(addDays(TODAY, -(back - later)), 3 + Math.floor(rand() * 8))
        const kind = rand()
        if (kind < 0.2) addReturn(sale, made, { created_at: when, currency: 'KHR', khr: 8000, refund: 2 })
        else if (kind < 0.3) addReturn(sale, made, { created_at: when, status: 'cancelled' })
        else if (kind < 0.38) addReturn(sale, made, { created_at: when, scope: 'supplier' })
        else if (sale.sale_status === 'awaiting_payment') addReturn(sale, made, { created_at: when, owed: money2(made[0].applied_price_usd), refund: money2(made[0].applied_price_usd) })
        else addReturn(sale, made, { created_at: when, quantity: 1, restock: rand() < 0.6 })
      }
    }
  }
  // The business-day boundary rows (UTC+7): 16:59:59 and 17:00:00 UTC either side of the local midnight, a return today on a
  // 40-day-old sale, an old sale cancelled today, a late payment on a month-old Not Paid sale, a Not Paid return today, a riel
  // refund today, a store-paid delivery with its linked fee, and two canonical (v1) money sales.
  const yesterday = addDays(TODAY, -1)
  const boundary = []
  const b1 = baseSale(800001, { created_at: utc(yesterday, 16, 59, 59), updated_at: utc(yesterday, 16, 59, 59) }); addItems(b1, [{ product: 1, price: 10, cost: 4 }]); boundary.push(b1)
  const b2 = baseSale(800002, { created_at: utc(yesterday, 17, 0, 0), updated_at: utc(yesterday, 17, 0, 0) }); addItems(b2, [{ product: 2, price: 10, cost: 4 }]); boundary.push(b2)
  const b3 = baseSale(800003, { created_at: utc(addDays(TODAY, -40), 5), updated_at: utc(addDays(TODAY, -40), 5) }); const b3items = addItems(b3, [{ product: 3, price: 12, cost: 5 }, { product: 4, price: 8, cost: 3 }]); boundary.push(b3)
  addReturn(b3, b3items, { created_at: utc(TODAY, 4), quantity: 1 })
  const b4 = baseSale(800004, { created_at: utc(addDays(TODAY, -20), 5), updated_at: utc(TODAY, 3), sale_status: 'cancelled', status_before_cancel: 'completed', cancelled_at: utc(TODAY, 3), cancel_reason: 'synthetic' }); addItems(b4, [{ product: 5, price: 15, cost: 6 }]); b4.amount_paid_usd = 15; boundary.push(b4)
  const b5 = baseSale(800005, { created_at: utc(addDays(TODAY, -30), 5), updated_at: utc(TODAY, 2), sale_status: 'awaiting_payment', amount_paid_usd: 5 }); addItems(b5, [{ product: 6, price: 30, cost: 12 }]); b5.amount_paid_usd = 5; boundary.push(b5)
  payments.push({ event_id: 'ev-late-1', sale_id: 800005, direction: 'in', origin: 'late_record', payment_method: 'Cash', payment_details: '[]', amount_paid_usd: 5, exchange_rate: 4000, received_at: utc(TODAY, 2), branch_id: 1, created_at: utc(TODAY, 2) })
  const b6 = baseSale(800006, { created_at: utc(TODAY, 3), updated_at: utc(TODAY, 3), sale_status: 'awaiting_payment' }); const b6items = addItems(b6, [{ product: 7, price: 20, cost: 8 }]); b6.amount_paid_usd = 0; boundary.push(b6)
  addReturn(b6, b6items, { created_at: utc(TODAY, 5), owed: 20, refund: 20 })
  const b7 = baseSale(800007, { created_at: utc(TODAY, 4), updated_at: utc(TODAY, 4), customer_id: 3, customer_name: 'Riel refund customer' }); const b7items = addItems(b7, [{ product: 8, price: 10, quantity: 2, cost: 4 }]); boundary.push(b7)
  addReturn(b7, b7items, { created_at: utc(TODAY, 6), currency: 'KHR', khr: 20000, refund: 5, quantity: 1 })
  const b8 = baseSale(800008, { created_at: utc(TODAY, 2), updated_at: utc(TODAY, 2), is_delivery: 1, delivery_fee_usd: 2, delivery_fee_paid_by: 'store', delivery_actual_cost_usd: 1.5 }); addItems(b8, [{ product: 9, price: 25, cost: 10 }]); boundary.push(b8)
  fees.push({ fee_type: 'delivery', label: 'Delivery', amount_usd: 1.5, amount_khr: 0, fee_date: TODAY, sale_id: 800008, branch_id: 1, created_at: utc(TODAY, 2) })
  const b9 = baseSale(800009, { created_at: utc(TODAY, 1), updated_at: utc(TODAY, 1), money_precision_version: 1, subtotal_usd: 10.004, total_usd: 10, calculated_total_usd: 10.004, rounding_adjustment_usd: -0.004, amount_paid_usd: 10 })
  items.push({ id: itemId++, sale_id: 800009, product_id: 1101, product_name: 'Canonical A', quantity: 1, applied_price_usd: 10.004, total_usd: 10.004, cost_price_usd: 2, product_discount_usd: 0, manual_discount_usd: 0, branch_id: 1 }); boundary.push(b9)
  const b10 = baseSale(800010, { created_at: utc(addDays(TODAY, -1), 8), updated_at: utc(addDays(TODAY, -1), 8), sale_status: 'awaiting_payment', money_precision_version: 1, subtotal_usd: 5.004, total_usd: 5, calculated_total_usd: 5.004, rounding_adjustment_usd: -0.004, amount_paid_usd: 0 })
  items.push({ id: itemId++, sale_id: 800010, product_id: 1102, product_name: 'Canonical B', quantity: 1, applied_price_usd: 5.004, total_usd: 5.004, cost_price_usd: null, product_discount_usd: 0, manual_discount_usd: 0, branch_id: 1 }); boundary.push(b10)
  sales.push(...boundary)
  const customers = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: 'Customer ' + (i + 1), is_anonymous: 0 }))
  return { sales, items, returns, returnItems, fees, payments, customers }
}

// The writes injected between two D1 calls: each changes what the report reads in the Sep 13 window.
const WRITES = {
  sale: [
    { sql: `INSERT INTO sales(id,receipt_number,created_at,updated_at,sale_status,branch_id,branch_name,cashier_id,cashier_name,payment_method,exchange_rate,subtotal_usd,total_usd,amount_paid_usd,money_precision_version) VALUES(900001,'RW0900001','${TODAY} 03:00:00','${TODAY} 03:00:00','completed',1,'Main',1,'Cashier','Cash',4000,70,70,70,0)` },
    { sql: `INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,applied_price_usd,total_usd,cost_price_usd,product_discount_usd,manual_discount_usd,branch_id) VALUES(900001,900001,1001,'Injected',7,10,70,30,0,0,1)` },
  ],
  cancel: [{ sql: `UPDATE sales SET sale_status='cancelled',status_before_cancel='completed',cancelled_at='${TODAY} 05:00:00' WHERE id=800007` }],
  ret: [
    { sql: `INSERT INTO returns(id,return_number,sale_id,created_at,updated_at,status,return_scope,total_refund_usd,total_refund_khr,exchange_rate,money_precision_version,branch_id,branch_name) VALUES(900001,'RTW900001',800008,'${TODAY} 06:00:00','${TODAY} 06:00:00','completed','customer',25,0,4000,0,1,'Main')` },
    { sql: `INSERT INTO return_items(id,return_id,sale_item_id,product_id,product_name,quantity,applied_price_usd,total_usd,cost_price_usd,return_to_stock,stock_action,branch_id) SELECT 900001,900001,id,product_id,product_name,1,25,25,10,1,'restock',1 FROM sale_items WHERE sale_id=800008 LIMIT 1` },
  ],
}
const UNDO = {
  sale: [{ sql: 'DELETE FROM sale_items WHERE id=900001' }, { sql: 'DELETE FROM sales WHERE id=900001' }],
  cancel: [{ sql: "UPDATE sales SET sale_status='completed',status_before_cancel=NULL,cancelled_at=NULL WHERE id=800007" }],
  ret: [{ sql: 'DELETE FROM return_items WHERE id=900001' }, { sql: 'DELETE FROM returns WHERE id=900001' }],
}

// ---- ranges: every preset the date picker offers, plus partial-day and boundary windows ------------------------------------------
const presets = (() => {
  const out = transformSync(fs.readFileSync(path.join(cf, '..', 'frontend/src/components/shared/statsStripPresets.ts'), 'utf8'), { loader: 'ts', format: 'cjs' }).code
  const mod = { exports: {} }; new Function('module', 'exports', out)(mod, mod.exports)
  return mod.exports
})()
const RANGES = presets.STATS_PRESETS.map(preset => ({ id: preset.id, ...(({ startDate, endDate }) => ({ startDate, endDate }))(presets.statsPresetRange(preset.id, NOW_LOCAL)) }))
RANGES.push({ id: 'partial-day', startDate: TODAY, endDate: TODAY, createdFrom: `${TODAY} 02:00:00`, createdTo: `${TODAY} 05:00:00` })
RANGES.push({ id: 'boundary-2s', startDate: addDays(TODAY, -1), endDate: TODAY, createdFrom: utc(addDays(TODAY, -1), 16, 59, 59), createdTo: utc(addDays(TODAY, -1), 17, 0, 1) })
RANGES.push({ id: 'boundary-yesterday', startDate: addDays(TODAY, -1), endDate: addDays(TODAY, -1) })
const BRANCHES = [null, '1', '2']

const stable = value => JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v))
const outcome = r => r.kind === 'value' ? { kind: 'value', value: r.value, diagnostic: r.diagnostic ?? null } : { kind: 'error', name: r.error.name, code: r.error.code, status: r.error.status }
const same = (a, b, label) => assert.equal(stable(outcome(b)), stable(outcome(a)), label)

async function main() {
  const t0 = Date.now()
  // PARITY_PERSIST=<dir> keeps the migrated, seeded database between runs (debugging only; the default is a fresh temporary one).
  const keep = process.env.PARITY_PERSIST ? path.resolve(process.env.PARITY_PERSIST) : null
  const persist = keep || fs.mkdtempSync(path.join(os.tmpdir(), 'report-atomic-parity-'))
  if (keep) fs.mkdirSync(keep, { recursive: true })
  const instances = []
  const open = async (script) => {
    const mf = new Miniflare({ modules: true, script, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'], host: '127.0.0.1', port: 0, d1Databases: ['DB'], d1Persist: path.join(persist, 'd1'), cachePersist: false,
      outboundService: () => new Response('No external network', { status: 503 }), log: new Log(LogLevel.ERROR) })
    await mf.ready
    instances.push(mf)
    const raw = await mf.getD1Database('DB')
    let n = 0
    const invoke = async input => {
      const response = await mf.dispatchFetch('http://parity.test/probe', { method: 'POST', body: JSON.stringify(input) }), text = await response.text()
      assert.equal(response.status, 200, text)
      const value = JSON.parse(text); assert.equal(value.ok, true, text); n += 1
      return value
    }
    return { mf, raw, invoke, count: () => n }
  }
  const checks = []
  const check = (name) => { checks.push(name); console.log('PASS ' + name) }
  try {
    const main = await bundleWorker(null)
    let world = await open(main.script)
    // The database persists on disk across worlds (one per bundle), so every helper goes through the current instance.
    const raw = { prepare: sql => world.raw.prepare(sql), batch: items => world.raw.batch(items) }
    const exec = async statements => { const result = await raw.batch(statements.map(item => raw.prepare(item.sql).bind(...(item.values || [])))); assert.ok(result.every(row => row.success === true)); return result }

    // schema + history
    let loaded = false
    try { loaded = (await raw.prepare('SELECT COUNT(*) n FROM sales').all()).results[0].n > 400 } catch {}
    const migrations = []
    for (const name of fs.readdirSync(path.join(cf, 'migrations')).filter(n => n.endsWith('.sql')).sort()) for (const sql of splitSql(fs.readFileSync(path.join(cf, 'migrations', name), 'utf8')).filter(s => s.trim())) {
      if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())) continue
      migrations.push(sql)
    }
    if (!loaded) for (let i = 0; i < migrations.length; i += 100) await exec(migrations.slice(i, i + 100).map(sql => ({ sql })))
    const history = buildHistory()
    if (!loaded) {
    await exec([{ sql: "INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Main',1,1),(2,'Second',0,1)" }])
    await exec(insertSql('customers', ['id', 'name', 'is_anonymous'], history.customers).map(sql => ({ sql })))
    for (const [table, columns, rows] of [['sales', SALE_COLUMNS, history.sales], ['sale_items', ITEM_COLUMNS, history.items], ['returns', RETURN_COLUMNS, history.returns], ['return_items', RETURN_ITEM_COLUMNS, history.returnItems]]) {
      for (const sql of insertSql(table, columns, rows)) await exec([{ sql }])
    }
    await exec(history.fees.map(f => ({ sql: 'INSERT INTO fees(fee_type,label,amount_usd,amount_khr,fee_date,sale_id,branch_id,created_at) VALUES(?,?,?,?,?,?,?,?)', values: [f.fee_type, f.label, f.amount_usd, f.amount_khr, f.fee_date, f.sale_id, f.branch_id, f.created_at] })))
    await exec(history.payments.map(p => ({ sql: 'INSERT INTO sale_payment_events(event_id,sale_id,direction,origin,payment_method,payment_details,amount_paid_usd,exchange_rate,received_at,branch_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', values: [p.event_id, p.sale_id, p.direction, p.origin, p.payment_method, p.payment_details, p.amount_paid_usd, p.exchange_rate, p.received_at, p.branch_id, p.created_at] })))
    }
    const counts = (await raw.prepare('SELECT (SELECT COUNT(*) FROM sales) s,(SELECT COUNT(*) FROM sale_items) i,(SELECT COUNT(*) FROM returns) r,(SELECT COUNT(*) FROM return_items) ri').all()).results[0]
    assert.ok(counts.s > 400 && counts.i > 800 && counts.r > 10, JSON.stringify(counts))
    console.log(`history: ${counts.s} sales, ${counts.i} lines, ${counts.r} returns; ${migrations.length} migration statements; ready in ${Math.round((Date.now() - t0) / 1000)}s`)

    const setSwitch = async state => exec([{ sql: "INSERT OR REPLACE INTO system_flags(key,value) VALUES('read_switches',?)", values: [typeof state === 'string' && state.startsWith('{') ? state : JSON.stringify({ epoch: 1, switches: { report_atomic: state } })] }])
    const filterOf = (range, branch) => ({ startDate: range.startDate, endDate: range.endDate, createdFrom: range.createdFrom, createdTo: range.createdTo, branchId: branch })
    const statsOf = (range, branch) => ({ startDate: range.startDate, endDate: range.endDate, branchId: branch })
    const matrix = []
    for (const range of RANGES) for (const branch of BRANCHES) {
      const filter = filterOf(range, branch)
      matrix.push({ label: `${range.id}/b${branch ?? '*'}/combined`, mode: 'combined', filter, granularity: 'day' })
      if (range.startDate) matrix.push({ label: `${range.id}/b${branch ?? '*'}/previous`, mode: 'previous', filter })
      matrix.push({ label: `${range.id}/b${branch ?? '*'}/stats`, mode: 'totals', filter: { startDate: range.startDate || null, endDate: range.endDate || null, startTime: null, endTime: null }, stats: statsOf(range, branch) })
    }
    for (const range of RANGES.filter(r => ['year', 'last_year', 'all'].includes(r.id))) matrix.push({ label: `${range.id}/b*/combined-month`, mode: 'combined', filter: filterOf(range, null), granularity: 'month' })
    matrix.push({ label: 'stats-search', mode: 'totals', filter: { startDate: null, endDate: null }, stats: { search: 'Customer 1' } })
    matrix.push({ label: 'all/snapshot-full', mode: 'snapshot', filter: filterOf(RANGES.find(r => r.id === 'all'), null) })
    matrix.push({ label: 'month/snapshot-full', mode: 'snapshot', filter: filterOf(RANGES.find(r => r.id === 'month'), '1') })
    const run = async (states, cases, extra = {}) => {
      const results = {}
      for (const state of states) {
        await setSwitch(state)
        results[state] = await Promise.all([]).then(async () => { const out = []; for (const c of cases) out.push(await world.invoke({ ...c, ...extra })); return out })
      }
      return results
    }

    // ---- 1. OFF versus ON over the whole matrix ----------------------------------------------------------------------------------
    const parity = await run(['off', 'on'], matrix)
    let atomicSeen = 0, fewerCalls = 0, positive = { sales: 0, notPaid: 0, cancelled: 0, refund: 0 }
    matrix.forEach((c, i) => {
      const off = parity.off[i], on = parity.on[i]
      assert.equal(off.kind, 'value', `${c.label}: OFF must succeed: ${JSON.stringify(off.error)}`)
      same(off, on, `${c.label}: OFF and ON differ`)
      assert.ok(!off.calls.some(call => call.atomic), `${c.label}: OFF must never batch atomically`)
      if (on.calls.some(call => call.atomic)) { atomicSeen += 1; if (on.calls.length < off.calls.length) fewerCalls += 1 }
      const totals = c.mode === 'combined' ? off.value.totals : c.mode === 'previous' ? off.value : c.mode === 'totals' ? off.value.totals : off.value.totals
      positive.sales += totals.tx_count > 0 ? 1 : 0; positive.notPaid += totals.pending_revenue_usd > 0 ? 1 : 0; positive.cancelled += totals.cancelled_tx_count > 0 ? 1 : 0; positive.refund += totals.refund_usd > 0 ? 1 : 0
    })
    assert.ok(positive.sales > matrix.length * 0.6 && positive.notPaid > 10 && positive.cancelled > 10 && positive.refund > 10, 'fixture must exercise sales, Not Paid, cancelled and refunded windows: ' + JSON.stringify(positive))
    const notAtomic = matrix.filter((c, i) => !parity.on[i].calls.some(call => call.atomic)).map(c => c.label)
    // By design (the Codex chain): the full-family reader and the Sales stats route with a date window keep the two-pass compare;
    // every other report read (dashboard and analytics totals, previous period, the undated stats) runs the one atomic batch.
    const twoPass = matrix.filter(c => c.mode === 'snapshot' || (c.mode === 'totals' && c.filter.startDate)).map(c => c.label)
    assert.deepEqual([...notAtomic].sort(), [...twoPass].sort(), 'exactly the full-family and dated-stats cases may skip the atomic batch')
    assert.ok(atomicSeen >= RANGES.length, `ON must reach the atomic batch (${atomicSeen} of ${matrix.length})`)
    assert.ok(fewerCalls >= RANGES.length, `ON must take fewer D1 calls than OFF (${fewerCalls})`)
    check(`OFF == ON over ${matrix.length} cases: ${RANGES.length} ranges (${presets.STATS_PRESETS.length} picker presets, partial-day, 2-second boundary) x branch all/1/2 x combined/previous/stats (atomic reached ${atomicSeen}x, fewer calls ${fewerCalls}x; sales ${positive.sales}, Not Paid ${positive.notPaid}, cancelled ${positive.cancelled}, refunds ${positive.refund})`)

    // absolute checks on the business-day boundary and the four S11 cases, so parity cannot hide a shared mistake
    const idsOf = async (range, branch) => { await setSwitch('on'); const r = await world.invoke({ mode: 'snapshot', filter: filterOf(range, branch) }); return r.value }
    const today = await idsOf(RANGES.find(r => r.id === 'today'), null)
    const rowsToday = (await raw.prepare("SELECT id FROM sales WHERE id IN (800001,800002) AND date(datetime(created_at,'+7 hours'))=?").bind(TODAY).all()).results.map(r => r.id)
    assert.deepEqual(rowsToday, [800002], 'fixture: the 17:00:00 UTC sale is on the business day, the 16:59:59 one is not')
    const boundary = await idsOf(RANGES.find(r => r.id === 'boundary-2s'), null)
    assert.equal(boundary.counts.sales, 2, 'the 2-second window around local midnight holds both boundary sales')
    assert.ok(today.counts.sales >= 8, 'today holds the boundary sale and the day-of rows')
    const hist = JSON.parse(JSON.stringify(today)); assert.ok(hist.totals.tx_count >= 8)
    check('boundary absolute: 16:59:59 UTC is yesterday, 17:00:00 UTC is today; the 2-second window holds both')

    // ---- 2. the routes of the mutants: each must break parity -------------------------------------------------------------------
    const caughtBy = {}, valueCaughtBy = {}
    const killers = matrix.filter(c => /^(today|month|all|7d)\//.test(c.label) || c.label === 'stats-search')
    for (const mutant of Object.keys(MUTANTS)) {
      const mutated = await bundleWorker(mutant)
      for (const instance of instances.splice(0)) await instance.dispose()
      world = await open(mutated.script)
      const result = await run(['off', 'on'], killers)
      const caught = killers.filter((c, i) => stable(outcome(result.off[i])) !== stable(outcome(result.on[i]))).map(c => c.label)
      caughtBy[mutant] = caught
      valueCaughtBy[mutant] = killers.filter((c, i) => stable(result.off[i].value) !== stable(result.on[i].value)).map(c => c.label)
      assert.ok(caught.length > 0, `MUTANT ${mutant} survived: OFF and ON still agree on every case`)
      check(`mutant ${mutant} is caught (${caught.length} of ${killers.length} cases differ, e.g. ${caught[0]})`)
    }
    for (const instance of instances.splice(0)) await instance.dispose()
    world = await open(main.script)
    check('mutants restored: the unmutated bundle is back')
    // The mutant's shadow run: the shadow must report the difference, serve OFF, and say which field names differ.
    {
      // Only a mutant that changes the served VALUE can be a shadow mismatch (returns-unscoped moves the row count in the diagnostic, not a field).
      const mutated = await bundleWorker('drop-void-group')
      for (const instance of instances.splice(0)) await instance.dispose()
      world = await open(mutated.script)
      const shadowLabel = valueCaughtBy['drop-void-group'].find(label => label.endsWith('/combined'))
      assert.ok(shadowLabel, 'drop-void-group must change a combined report value')
      const shadowCase = matrix.find(c => c.label === shadowLabel)
      const offBase = await run(['off'], [shadowCase])
      await setSwitch('shadow:0.1')
      const shadow = await world.invoke({ ...shadowCase, sample: 0 })
      same(offBase.off[0], shadow, 'a mismatching shadow must still serve the OFF result')
      const points = shadow.ae.filter(p => p.indexes[0] === 'report_atomic_shadow')
      assert.equal(points.length, 1); assert.equal(points[0].blobs[0], 'totals_and_series'); assert.equal(points[0].blobs[1], 'mismatch', shadowCase.label + ': ' + JSON.stringify(points[0]))
      assert.ok(points[0].blobs.slice(2).some(name => /^totals\./.test(name)), 'the datapoint names the differing field paths, not values: ' + points[0].blobs.join('|'))
      assert.ok(!JSON.stringify(points[0]).match(/\d{2,}\.\d{2}/), 'no money value in the datapoint')
      for (const instance of instances.splice(0)) await instance.dispose()
      world = await open(main.script)
      check('shadow over a broken atomic path records a mismatch with field names only and serves OFF')
    }

    // ---- 3. a write between any two calls never produces a mixed snapshot ---------------------------------------------------------
    const todayCase = { mode: 'combined', filter: filterOf(RANGES.find(r => r.id === 'today'), null), granularity: 'day' }
    const monthCase = { mode: 'combined', filter: filterOf(RANGES.find(r => r.id === 'month'), '1'), granularity: 'day' }
    const stateOf = r => stable(outcome(r))
    const sweep = {}
    for (const state of ['off', 'on']) {
      await setSwitch(state)
      for (const [name, base] of [['today', todayCase], ['month', monthCase]]) for (const write of Object.keys(WRITES)) {
        const pre = await world.invoke({ ...base })
        await exec(WRITES[write]); const post = await world.invoke({ ...base }); await exec(UNDO[write])
        assert.notEqual(stateOf(pre), stateOf(post), `${state}/${name}/${write}: the injected write must change the report, or the sweep proves nothing`)
        const calls = pre.calls.length
        const seen = { pre: 0, post: 0, refused: 0 }
        for (let n = 0; n <= calls + 1; n++) {
          const during = await world.invoke({ ...base, write: WRITES[write], writeAfter: n })
          await exec(UNDO[write])
          if (during.kind === 'error') { assert.equal(during.error.code, 'snapshot_changed', `${state}/${name}/${write}@${n}: ${JSON.stringify(during.error)}`); seen.refused += 1; continue }
          if (stateOf(during) === stateOf(pre)) seen.pre += 1
          else if (stateOf(during) === stateOf(post)) seen.post += 1
          else assert.fail(`${state}/${name}/${write}@${n}: a MIXED snapshot (neither the state before nor after the write)`)
        }
        sweep[`${state}/${name}/${write}`] = { ...seen, calls }
      }
    }
    const onSweeps = Object.entries(sweep).filter(([key]) => key.startsWith('on/'))
    assert.ok(onSweeps.every(([, v]) => v.pre > 0 && v.post > 0), 'the sweep must see the write land both before and after the atomic batch')
    check('write between any two calls: never a mixed snapshot, OFF refuses or is whole, ON is whole -- ' + Object.entries(sweep).map(([k, v]) => `${k}: calls ${v.calls}, pre ${v.pre}/post ${v.post}/refused ${v.refused}`).join('; '))

    // ---- 4. the switch itself ---------------------------------------------------------------------------------------------------
    const probe = { mode: 'combined', filter: filterOf(RANGES.find(r => r.id === 'month'), null), granularity: 'day' }
    await setSwitch('off'); const offProbe = await world.invoke(probe)
    assert.equal(offProbe.calls.filter(c => c.sw).length, 1, 'the OFF reader pays the switch read once')
    await setSwitch('on'); const onProbe = await world.invoke(probe)
    assert.equal(onProbe.calls.filter(c => c.sw).length, 1, 'the ON reader pays the switch read once, however many readers ask')
    for (const [label, raw] of [['absent row', null], ['not json', 'not json'], ['array', '[]'], ['ON spelled in capitals', JSON.stringify({ switches: { report_atomic: 'ON' } })], ['true', JSON.stringify({ switches: { report_atomic: true } })], ['unknown name', JSON.stringify({ switches: { report_atomic_long: 'on' } })],
      ['shadow:0', JSON.stringify({ switches: { report_atomic: 'shadow:0' } })], ['shadow garbage', JSON.stringify({ switches: { report_atomic: 'shadow:x' } })], ['proto key', '{"switches":{"__proto__":{"report_atomic":"on"}}}']]) {
      await exec([{ sql: "DELETE FROM system_flags WHERE key='read_switches'" }])
      if (raw !== null) await exec([{ sql: 'INSERT INTO system_flags(key,value) VALUES(?,?)', values: ['read_switches', raw] }])
      const r = await world.invoke({ ...probe, sample: 0 })
      same(offProbe, r, `${label}: must be OFF`)
      assert.ok(!r.calls.some(c => c.atomic), `${label}: must not reach the atomic batch`)
      assert.equal(r.ae.filter(p => p.indexes[0] === 'report_atomic_shadow').length, 0)
    }
    check('malformed, unknown or oversized switch rows are OFF: exact legacy statements, no shadow datapoint')
    await setSwitch('on')
    const unreadable = await world.invoke({ ...probe, failSwitchRead: true })
    same(offProbe, unreadable, 'an unreadable switch row must be OFF')
    assert.ok(!unreadable.calls.some(c => c.atomic)); assert.deepEqual(unreadable.ae.map(p => [p.indexes[0], p.blobs[0]]), [['switch_read', 'fallback']])
    check('an unreadable switch row (D1 error) is OFF and writes one switch_read/fallback datapoint')

    // shadow: sampled, unsampled, Free, a refusal, a concurrent write
    await setSwitch('shadow:0.1')
    const sampled = await world.invoke({ ...probe, sample: 0 })
    same(offProbe, sampled, 'a sampled shadow serves OFF'); assert.ok(sampled.calls.some(c => c.atomic), 'a sampled shadow also runs the atomic batch')
    assert.deepEqual(sampled.ae.filter(p => p.indexes[0] === 'report_atomic_shadow').map(p => p.blobs), [['totals_and_series', 'match']])
    const unsampled = await world.invoke({ ...probe, sample: 0.5 })
    same(offProbe, unsampled, 'an unsampled shadow serves OFF'); assert.ok(!unsampled.calls.some(c => c.atomic)); assert.equal(unsampled.calls.length, offProbe.calls.length); assert.equal(unsampled.ae.length, 0)
    const free = await world.invoke({ ...probe, sample: 0, tier: 'free' })
    same(offProbe, free, 'a shadow on Free serves OFF'); assert.ok(!free.calls.some(c => c.atomic)); assert.equal(free.calls.length, offProbe.calls.length); assert.equal(free.ae.length, 0)
    await setSwitch(JSON.stringify({ epoch: 1, switches: { report_atomic: 'shadow:5' } }))
    const clampedYes = await world.invoke({ ...probe, sample: 0.09 }), clampedNo = await world.invoke({ ...probe, sample: 0.5 })
    assert.ok(clampedYes.calls.some(c => c.atomic) && !clampedNo.calls.some(c => c.atomic), 'shadow:5 is clamped to 0.1')
    await setSwitch('shadow:0.1')
    const writeInside = await world.invoke({ ...probe, sample: 0, write: WRITES.sale, writeAfter: offProbe.calls.length + 1 }); await exec(UNDO.sale)
    assert.deepEqual(writeInside.ae.filter(p => p.indexes[0] === 'report_atomic_shadow').map(p => p.blobs[1]), ['write_between'])
    check('shadow: sampled serves OFF and matches; unsampled and Free cost nothing; shadow:5 clamps to 0.1; a concurrent write is write_between, not a mismatch')
    await exec([{ sql: "INSERT OR REPLACE INTO system_flags(key,value) VALUES('maintenance_mode',?)", values: [JSON.stringify({ mode: 'restore' })] }])
    for (const state of ['off', 'on', 'shadow:0.1']) {
      await setSwitch(state)
      const refused = await world.invoke({ ...probe, sample: 0 })
      assert.equal(refused.kind, 'error'); assert.equal(refused.error.code, 'maintenance_restore'); assert.equal(refused.error.status, 409)
      assert.equal(refused.ae.filter(p => p.indexes[0] === 'report_atomic_shadow').length, 0, 'a refusal by the served reader is not a shadow outcome')
    }
    await exec([{ sql: "DELETE FROM system_flags WHERE key='maintenance_mode'" }])
    check('maintenance_restore refuses identically on OFF, ON and SHADOW (409), with no shadow datapoint')

    // ---- 5. crafted filters ---------------------------------------------------------------------------------------------------------
    const month = RANGES.find(r => r.id === 'month')
    const crafted = [
      ['branchId injection', { ...filterOf(month, "1 OR 1=1") }], ['branchId statement', { ...filterOf(month, "1; DROP TABLE sales") }], ['branchId unknown', { ...filterOf(month, '999') }], ['branchId integer', { ...filterOf(month, 1) }],
      ['branchId object', { ...filterOf(month, { toString: 'x' }) }], ['branchId array', { ...filterOf(month, ['1', '2']) }], ['branchId empty', { ...filterOf(month, '') }],
      ['reversed dates', { startDate: month.endDate, endDate: month.startDate, branchId: null }], ['non-ISO dates', { startDate: '2026-9-1', endDate: '2026-9-30', branchId: null }], ['impossible date', { startDate: '2026-02-30', endDate: '2026-03-01', branchId: null }],
      ['date with time', { startDate: '2026-09-01 00:00:00', endDate: '2026-09-13', branchId: null }], ['injection date', { startDate: "2026-09-01' OR '1'='1", endDate: '2026-09-13', branchId: null }], ['unicode digits', { startDate: '٢٠٢٦-09-01', endDate: '2026-09-13', branchId: null }],
      ['only startDate', { startDate: month.startDate, endDate: '', branchId: null }], ['reversed instants', { startDate: month.startDate, endDate: month.endDate, createdFrom: `${TODAY} 05:00:00`, createdTo: `${TODAY} 02:00:00`, branchId: null }],
      ['ISO instants with Z', { startDate: TODAY, endDate: TODAY, createdFrom: `${TODAY}T02:00:00Z`, createdTo: `${TODAY}T05:00:00Z`, branchId: null }], ['numeric dates', { startDate: 20260901, endDate: 20260913, branchId: null }],
      ['inherited properties', { kind: 'inherited', startDate: month.startDate, endDate: month.endDate, branchId: null }], ['null prototype', { kind: 'null-proto', ...filterOf(month, '1') }], ['accessor that changes on read', { kind: 'getter', ...filterOf(month, null), startDate: month.startDate, endDate: TODAY }],
      ['symbol key', { kind: 'symbol', ...filterOf(month, null) }], ['extra status key', { kind: 'extra-key', ...filterOf(month, null) }], ['all-time with a branch', { startDate: '', endDate: '', branchId: '2' }], ['all-time empty', { startDate: '', endDate: '', branchId: null }],
    ]
    const craftedCases = crafted.flatMap(([label, filter]) => [{ label: label + '/combined', mode: 'combined', filter, granularity: 'day' }, { label: label + '/previous', mode: 'previous', filter, rawPrevious: true }, { label: label + '/stats', mode: 'totals', filter: { startDate: filter.startDate ?? null, endDate: filter.endDate ?? null }, stats: { startDate: filter.startDate, endDate: filter.endDate, branchId: filter.branchId } }])
    const craftedResults = await run(['off', 'on'], craftedCases)
    let refusals = 0
    craftedCases.forEach((c, i) => {
      same(craftedResults.off[i], craftedResults.on[i], `crafted ${c.label}: OFF and ON must take the same outcome`)
      if (craftedResults.off[i].kind === 'error') refusals += 1
    })
    const isEmpty = r => r.kind === 'value' && (r.value.totals ?? r.value).tx_count === 0
    const idx = label => craftedCases.findIndex(c => c.label === label)
    for (const label of ['branchId injection/combined', 'branchId statement/combined', 'branchId unknown/combined']) assert.ok(isEmpty(craftedResults.on[idx(label)]), `${label}: an injected or unknown branch must select nothing (the value is bound, never interpolated)`)
    assert.equal((await raw.prepare('SELECT COUNT(*) n FROM sales').all()).results[0].n, counts.s, 'no crafted filter touched the data')
    check(`${craftedCases.length} crafted filter cases take the same outcome on OFF and ON (${refusals} refusals, the rest results); injection and unknown branches select nothing`)
    console.log(`done: ${world.count()} requests in the last world, ${Math.round((Date.now() - t0) / 1000)}s`)
    console.log(JSON.stringify({ status: 'PASS', checks: checks.length, matrix: matrix.length, crafted: craftedCases.length, sweep, source_sha256: sha(lf(fs.readFileSync(path.join(cf, 'src/lib/salesAnalytics.ts'), 'utf8'))), scope: 'Real Worker (Miniflare, 219 migrations, synthetic history); public report readers; no CPU, quota or production claim.' }))
  } finally {
    for (const instance of instances.splice(0)) { try { await instance.dispose() } catch {} }
    if (!keep) fs.rmSync(persist, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
