const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')

const root = path.join(__dirname, '..')
const user = { id: 1, name: 'Admin', username: 'admin', role_code: 'admin', permissions: { all: true } }
const cache = new Map()
const actual = new Set([
  'db','permissions','saleBulkStatus','saleBulkUpdate','saleTransitions','saleTotals','sqlBinding',
  'productBatches','batchCode','salesStatus','conflictControl','searchMatch','financialPrecision',
  'paymentMethodRegistry','paymentSettlement','saleSettlementAction','saleLineAddition','saleAmendments',
])
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const mod = { exports: {} }; cache.set(rel, mod)
  const sourcePath = path.join(root, 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: sourcePath,
  }).outputText
  const req = (name) => {
    if (name === 'hono') return require(name)
    if (name.endsWith('/auth')) return { requireAuth: async (c, next) => { c.set('user', user); return next() } }
    if (name.endsWith('/cache')) return { bumpVersion: async () => {}, getVersionWithFallback: async () => 0, cachedJsonResponse: async (_e,_k,_t,fn) => fn() }
    if (name.endsWith('/broadcastHub')) return { broadcast: async () => {} }
    if (name.endsWith('/audit')) return { audit: async () => {} }
    if (name.endsWith('/telegram')) return { formatSaleTelegramLines: () => [], sendTelegramEvent: async () => {}, telegramMoney: () => '' }
    if (name.endsWith('/undoAppliers')) return { recordSaleAddItemsUndoSnapshot: async () => null }
    if (name.startsWith('.')) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), name)) + '.ts'
      if (actual.has(path.posix.basename(name))) return load(target)
      return {}
    }
    return require(name)
  }
  new Function('require','module','exports',output)(req,mod,mod.exports)
  return mod.exports
}

const sales = load('routes/sales.ts').default
const settlementAction = load('lib/saleSettlementAction.ts')

function fixture() {
  const sql = new Database(':memory:')
  sql.pragma('foreign_keys = OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    sql.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  }
  let beforeBatch = null
  const env = { DB: {
    prepare(text) { return { bind(...params) { return { text, params,
      async first() { return sql.prepare(text).get(...params) || null },
      async all() { return { results: sql.prepare(text).all(...params) } },
      async run() { const r = sql.prepare(text).run(...params); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } } },
    } } } },
    async batch(statements) {
      if (beforeBatch) { const fn = beforeBatch; beforeBatch = null; fn() }
      return sql.transaction(() => statements.map((statement) => {
        const r = sql.prepare(statement.text).run(...statement.params)
        return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }
      }))()
    },
  } }
  const executionCtx = { waitUntil() {}, passThroughOnException() {} }
  const call = async (url, body) => {
    const response = await sales.request(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, env, executionCtx)
    return { status: response.status, body: await response.json() }
  }
  return { sql, env, call, barrier(fn) { beforeBatch = fn } }
}

function seed(f) {
  f.sql.exec(`
    INSERT INTO settings(key,value,updated_at) VALUES
      ('exchange_rate','4200','s1'),('change_exchange_rate','4000','s1'),
      ('pos_payment_methods','["ABA Bank"]','s1');
    INSERT INTO branches(id,name) VALUES(1,'Shop');
    INSERT INTO products(id,name,stock_quantity) VALUES(1,'Serum',10);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,8);
    INSERT INTO sales(
      id,receipt_number,cashier_name,branch_id,branch_name,customer_name,payment_method,payment_details,
      payment_currency,exchange_rate,subtotal_usd,subtotal_khr,discount_usd,discount_khr,tax_usd,tax_khr,
      total_usd,total_khr,amount_paid_usd,amount_paid_khr,change_usd,change_khr,sale_status,search_normalized,updated_at
    ) VALUES(
      1,'S-1','Mia',1,'Shop','Customer','Legacy Cash','[{"method":"Legacy Cash","amount_usd":1.2346,"amount_khr":0}]',
      'USD',4100,5,20500,0,NULL,0,0,5,20500,1.2346,0,0,0,'awaiting_payment','old search','sale-v1'
    );
    INSERT INTO sale_items(
      id,sale_id,product_id,product_name,quantity,applied_price_usd,applied_price_khr,total_usd,total_khr,
      product_discount_usd,product_discount_khr,base_price_usd,base_price_khr,manual_discount_usd,manual_discount_khr,branch_id
    ) VALUES(1,1,1,'Serum',1,5,20500,5,20500,0,NULL,5,NULL,0,NULL,1);
  `)
}

function request(key = 'settle-request-1') {
  return {
    sale_status: 'completed',
    expected_updated_at: 'sale-v1',
    client_request_id: key,
    expected_exchange_rate: 4200,
    payment_details: [
      { method: 'Legacy Cash', amount_usd: 1.2346, amount_khr: 0 },
      { method: 'aba bank', amount_usd: 1, amount_khr: 0 },
      { method: 'ABA BANK', amount_usd: 0, amount_khr: 12600 },
    ],
  }
}

async function run() {
  const f = fixture(); seed(f)
  const stockBefore = f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity
  const applied = await f.call('/1/status', request())
  assert.equal(applied.status, 200, JSON.stringify(applied))
  assert.equal(applied.body.exchange_rate, 4200)
  assert.equal(applied.body.payment_method, 'Legacy Cash + ABA Bank')
  assert.deepEqual(JSON.parse(applied.body.payment_details), [
    { method: 'Legacy Cash', amount_usd: 1.2346, amount_khr: 0 },
    { method: 'ABA Bank', amount_usd: 1, amount_khr: 0 },
    { method: 'ABA Bank', amount_usd: 0, amount_khr: 12600 },
  ])
  assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity, stockBefore)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n, 0)
  const sale = f.sql.prepare('SELECT * FROM sales WHERE id=1').get()
  const line = f.sql.prepare('SELECT * FROM sale_items WHERE id=1').get()
  assert.deepEqual([sale.subtotal_khr,sale.total_khr,line.applied_price_khr,line.total_khr],[21000,21000,21000,21000])
  assert.equal(sale.discount_khr, 0)
  assert.equal(line.base_price_khr, 21000)
  assert.equal(line.manual_discount_khr, 0)
  assert.match(sale.search_normalized, /aba bank/)
  assert.ok(applied.body.actionHistoryId > 0)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM sale_mutation_receipts').get().n, 1)
  console.log('PASS settlement canonicalizes active methods, preserves inactive legacy tender, uses latest rate once, and moves no stock')

  f.sql.prepare("UPDATE settings SET value='4300' WHERE key='exchange_rate'").run()
  const retry = await f.call('/1/status', request())
  assert.deepEqual(retry, applied)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM sale_mutation_receipts').get().n, 1)
  assert.equal((await f.call('/1/status', { ...request(), payment_details: [...request().payment_details, { method: 'ABA Bank', amount_usd: 1 }] })).status, 409)
  const rateChanged = fixture(); seed(rateChanged)
  rateChanged.sql.prepare("UPDATE settings SET value='4300' WHERE key='exchange_rate'").run()
  const staleRate = await rateChanged.call('/1/status', request('settle-request-2'))
  assert.equal(staleRate.status, 409)
  assert.equal(staleRate.body.code, 'exchange_rate_changed')
  assert.equal(staleRate.body.current.exchange_rate, 4300)
  console.log('PASS exact retry returns first 4200 outcome; altered request and stale reviewed rate are rejected')

  const receipt = f.sql.prepare('SELECT * FROM sale_mutation_receipts').get()
  await settlementAction.replaySaleSettlementAction(f.env, user, 'undo', applied.body.actionHistoryId, 0, { operation_id: receipt.id })
  const undoneSale = f.sql.prepare('SELECT * FROM sales WHERE id=1').get()
  const undoneLine = f.sql.prepare('SELECT * FROM sale_items WHERE id=1').get()
  assert.deepEqual([undoneSale.sale_status,undoneSale.exchange_rate,undoneSale.payment_method,undoneSale.amount_paid_usd],['awaiting_payment',4100,'Legacy Cash',1.2346])
  assert.equal(undoneSale.discount_khr, null)
  assert.equal(undoneLine.base_price_khr, null)
  assert.equal(undoneLine.manual_discount_khr, null)
  await settlementAction.replaySaleSettlementAction(f.env, user, 'redo', applied.body.actionHistoryId, 1, { operation_id: receipt.id })
  assert.equal(f.sql.prepare('SELECT exchange_rate FROM sales WHERE id=1').get().exchange_rate, 4200)
  assert.equal(f.sql.prepare('SELECT value FROM settings WHERE key=\'exchange_rate\'').get().value, '4300')
  console.log('PASS undo restores exact nullable 4100 snapshot and redo restores captured 4200 without current settings recomputation')

  const raced = fixture(); seed(raced)
  raced.barrier(() => raced.sql.prepare("UPDATE sales SET notes='concurrent' WHERE id=1").run())
  const conflict = await raced.call('/1/status', request('settle-race'))
  assert.equal(conflict.status, 409, JSON.stringify(conflict))
  assert.equal(raced.sql.prepare('SELECT sale_status FROM sales WHERE id=1').get().sale_status, 'awaiting_payment')
  assert.equal(raced.sql.prepare('SELECT COUNT(*) n FROM sale_mutation_receipts').get().n, 0)
  console.log('PASS stale matched sale/settings conflict is all-or-none')
}

run().catch((error) => { console.error(error); process.exitCode = 1 })
