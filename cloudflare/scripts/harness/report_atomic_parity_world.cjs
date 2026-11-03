'use strict'
// Shared by the two report-switch parity tests: test-report-atomic-parity-native.cjs (report_atomic: Dashboard and Sales stats totals) and
// test-report-atomic-long-parity-native.cjs (report_atomic_long: the full report family). It builds the probe Worker from the working tree
// (optionally with one text mutant applied to salesAnalytics.ts), opens it in Miniflare on a migrated database seeded with a synthetic
// history (business-day boundary rows, returns of every kind, Not Paid, riel refunds, store-paid delivery, two canonical v1 money sales),
// and offers the switch row, the date ranges the UI offers and the writes injected between two D1 calls.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createHash } = require('node:crypto'), { createRequire } = require('node:module')
const cf = path.resolve(__dirname, '..', '..')
const local = createRequire(path.join(cf, 'package.json'))
const { build, transformSync } = local('esbuild'), { Miniflare, Log, LogLevel } = local('miniflare'), { unstable_splitSqlQuery: splitSql } = local('wrangler')
const sha = value => createHash('sha256').update(value).digest('hex')
const lf = value => value.replace(/\r\n/g, '\n')
const workerSource = lf(fs.readFileSync(path.join(__dirname, 'report-atomic-parity-worker.ts'), 'utf8'))

const ALIASES = { 'current:analytics': 'src/lib/salesAnalytics', 'current:money': 'src/lib/reportMoneyPrecision', 'current:switches': 'src/lib/readSwitches',
  'current:router': 'src/lib/reportAtomicSwitch', 'current:schema': 'src/lib/schemaProbe', 'current:window': 'src/lib/businessDateWindow', 'current:plan': 'src/lib/planTier' }
const ANALYTICS = 'cloudflare/src/lib/salesAnalytics.ts'
const once = (text, before, after) => { assert.equal(text.split(before).length, 2, 'MUTANT_SEAM_MISSING: ' + before.slice(0, 80)); return text.replace(before, () => after) }

// Bundles the probe Worker from the working tree; a mutant is a text edit of salesAnalytics.ts applied while bundling.
function makeBundler(MUTANTS) {
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
  return bundleWorker
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
// The filter a UI range sends, the stats scope of the same range, an undated filter with extra keys, and the month range most cases use.
const filterOf = (range, branch) => ({ startDate: range.startDate, endDate: range.endDate, createdFrom: range.createdFrom, createdTo: range.createdTo, branchId: branch })
const statsOf = (range, branch) => ({ startDate: range.startDate, endDate: range.endDate, branchId: branch })
const undated = (extra = {}) => ({ kind: 'raw', value: { startDate: null, endDate: null, branchId: null, status: null, paymentMethod: null, startTime: null, endTime: null, tzOffsetMinutes: 0, ...extra } })
const monthRange = RANGES.find(r => r.id === 'month')

// `switchName` is the one switch the test flips; the other stays absent (OFF), so each test proves its own switch moves only its own readers.
async function startParityWorld({ switchName, mutants }) {
  const bundleWorker = makeBundler(mutants)
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
  const main = await bundleWorker(null)
  const state = { world: await open(main.script) }
  // The database persists on disk across worlds (one per bundle), so every helper goes through the current instance.
  const raw = { prepare: sql => state.world.raw.prepare(sql), batch: items => state.world.raw.batch(items) }
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
  // One token for the test's switch, or a complete stored row when it starts with '{'.
  const setSwitch = async value => exec([{ sql: "INSERT OR REPLACE INTO system_flags(key,value) VALUES('read_switches',?)", values: [typeof value === 'string' && value.startsWith('{') ? value : JSON.stringify({ epoch: 1, switches: { [switchName]: value } })] }])
  const run = async (states, cases, extra = {}) => {
    const results = {}
    for (const value of states) {
      await setSwitch(value)
      const out = []
      for (const c of cases) out.push(await state.world.invoke({ ...c, ...extra }))
      results[value] = out
    }
    return results
  }
  const swap = async script => { for (const instance of instances.splice(0)) await instance.dispose(); state.world = await open(script) }
  const dispose = async () => {
    for (const instance of instances.splice(0)) { try { await instance.dispose() } catch {} }
    if (!keep) fs.rmSync(persist, { recursive: true, force: true })
  }
  return { cf, TODAY, RANGES, BRANCHES, WRITES, UNDO, presets, stable, outcome, same, filterOf, statsOf, undated, monthRange, raw, exec, counts, setSwitch, run, swap, dispose,
    check, checks, t0, bundleWorker, mainScript: main.script, get world() { return state.world } }
}

module.exports = { startParityWorld, once, sha, lf, TODAY, RANGES }
