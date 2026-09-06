const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')

const root = path.join(__dirname, '..')
const user = { id: 1, name: 'Admin', username: 'admin', role_code: 'admin', permissions: { all: true } }
const cache = new Map()
const actual = new Set(['actorSnapshot','movementBranchName',
  'db','permissions','saleBulkStatus','saleBulkUpdate','saleTransitions','saleTotals','sqlBinding',
  'productBatches','batchCode','salesStatus','conflictControl','searchMatch','financialPrecision',
  'paymentMethodRegistry','paymentSettlement','saleSettlementAction','saleLineAddition','saleAmendments',
  'nativeSaleChange',
  'receiptNumber','clientTimestamp',
  // The selling-branch guard and the two canonical branch roles it reads:
  // real modules, so POST /sales here rejects a warehouse line exactly as
  // the Worker does rather than silently resolving to an empty stub.
  'branchRoleGuards','branchRoles',
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
const lineAddition = load('lib/saleLineAddition.ts')
const amendments = load('lib/saleAmendments.ts')

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
  const call = async (url, body, method = 'PATCH') => {
    const response = await sales.request(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, env, executionCtx)
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
  const native = fixture(); seed(native)
  const nativeCreate = await native.call('/', {
    items: [{ product_id: 1, quantity: 1, applied_price_usd: 5, branch_id: 1 }],
    branch_id: 1,
    payment_details: [{ method: 'ABA Bank', amount_usd: 6, amount_khr: 0 }],
    payment_currency: 'USD',
    amount_paid_usd: 6,
    amount_paid_khr: 0,
    exchange_rate: 4200,
    change_is_actual: true,
    change_usd: 1,
    change_khr: 0,
    client_request_id: 'native-change-create-1',
  }, 'POST')
  assert.equal(nativeCreate.status, 200, JSON.stringify(nativeCreate))
  const nativeStored = native.sql.prepare('SELECT change_usd,change_khr,change_is_actual,change_exchange_rate FROM sales WHERE id=?').get(nativeCreate.body.id)
  assert.deepEqual(nativeStored, { change_usd: 1, change_khr: 0, change_is_actual: 1, change_exchange_rate: 4000 })
  const saleCountBeforeInvalid = native.sql.prepare('SELECT COUNT(*) n FROM sales').get().n
  const invalidNative = await native.call('/', {
    items: [{ product_id: 1, quantity: 1, applied_price_usd: 5, branch_id: 1 }],
    branch_id: 1, amount_paid_usd: 6, exchange_rate: 4200,
    change_is_actual: true, change_usd: 0, change_khr: 0,
    client_request_id: 'native-change-invalid-1',
  }, 'POST')
  assert.equal(invalidNative.status, 400, JSON.stringify(invalidNative))
  assert.equal(native.sql.prepare('SELECT COUNT(*) n FROM sales').get().n, saleCountBeforeInvalid)
  console.log('PASS create validates explicit native change before writes and persists its captured server change rate')

  const f = fixture(); seed(f)
  f.sql.prepare('UPDATE sales SET change_is_actual=1,change_exchange_rate=4000 WHERE id=1').run()
  assert.equal((await f.call('/1/status', { ...request('unsupported-aggregate'), amount_paid_usd: 99 })).body.code, 'unsupported_payment_aggregate')
  console.log('PASS client aggregate payment fields are rejected in favor of server-derived tender totals')
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
  assert.deepEqual([sale.change_is_actual,sale.change_exchange_rate],[0,null])
  const fractional = settlementAction.buildSaleSettlementAfterState(
    {},
    { subtotal_usd: 1.2345, discount_usd: 0.0001, tax_usd: 0.0002, total_usd: 1.2346,
      delivery_fee_usd: 0, membership_discount_usd: 0, receipt_number: 'S-FX' },
    [{ id: 1, applied_price_usd: 1.2345, total_usd: 1.2346, product_discount_usd: 0.0001,
      base_price_usd: 1.2345, manual_discount_usd: 0.0001 }],
    'completed', { ...request(), ...applied.body, exchangeRate: 4200, paymentMethod: 'ABA Bank',
      paymentDetailsJson: '[]', paymentCurrency: 'USD', amountPaidUsd: 2, amountPaidKhr: 0,
      changeUsd: 0, changeKhr: 0, changeExchangeRate: 4000 },
  )
  assert.deepEqual(
    [fractional.subtotal_khr,fractional.discount_khr,fractional.tax_khr,fractional.total_khr,
      fractional.lines[0].applied_price_khr,fractional.lines[0].total_khr],
    [5184.9,0.42,0.84,5185.32,5184.9,5185.32],
  )
  assert.equal(lineAddition.rebaseSaleLineKhrSnapshot([{ id: 1, total_usd: 1.2345 }], 4200)[0].total_khr, 5184.9)
  assert.equal(amendments.planDeliveryFeeChange({ saleId: 1, sale: { delivery_fee_usd: 1 }, newFeeUsd: 2.01, exchangeRate: 4200.1234 }).statements[0].params.fee_khr, 8442.248)
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
  assert.deepEqual([undoneSale.change_is_actual,undoneSale.change_exchange_rate],[1,4000])
  assert.equal(undoneLine.base_price_khr, null)
  assert.equal(undoneLine.manual_discount_khr, null)
  await settlementAction.replaySaleSettlementAction(f.env, user, 'redo', applied.body.actionHistoryId, 1, { operation_id: receipt.id })
  assert.equal(f.sql.prepare('SELECT exchange_rate FROM sales WHERE id=1').get().exchange_rate, 4200)
  assert.deepEqual(Object.values(f.sql.prepare('SELECT change_is_actual,change_exchange_rate FROM sales WHERE id=1').get()), [0,null])
  assert.equal(f.sql.prepare('SELECT value FROM settings WHERE key=\'exchange_rate\'').get().value, '4300')
  console.log('PASS undo restores exact nullable 4100 snapshot and redo restores captured 4200 without current settings recomputation')

  const raced = fixture(); seed(raced)
  raced.barrier(() => raced.sql.prepare("UPDATE sales SET notes='concurrent' WHERE id=1").run())
  const conflict = await raced.call('/1/status', request('settle-race'))
  assert.equal(conflict.status, 409, JSON.stringify(conflict))
  assert.equal(raced.sql.prepare('SELECT sale_status FROM sales WHERE id=1').get().sale_status, 'awaiting_payment')
  assert.equal(raced.sql.prepare('SELECT COUNT(*) n FROM sale_mutation_receipts').get().n, 0)
  console.log('PASS stale matched sale/settings conflict is all-or-none')

  const amended = fixture(); seed(amended)
  amended.sql.prepare(`UPDATE sales SET sale_status='completed',is_delivery=1,delivery_fee_usd=1,
    delivery_fee_khr=4100,total_usd=6,total_khr=24600,change_usd=1,change_khr=0,
    change_is_actual=1,change_exchange_rate=4000 WHERE id=1`).run()
  amended.sql.prepare("UPDATE sales SET updated_at='amend-v1' WHERE id=1").run()
  const amendmentRequest = {
    kind: 'delivery_fee_changed',
    delivery_fee_usd: 2,
    expected_updated_at: 'amend-v1',
    expected_exchange_rate: 4200,
    client_request_id: 'amend-fee-request-1',
  }
  const amendmentApplied = await amended.call('/1/amendments', amendmentRequest, 'POST')
  assert.equal(amendmentApplied.status, 200, JSON.stringify(amendmentApplied))
  assert.equal(amendmentApplied.body.exchangeRate, 4200)
  assert.equal(amendmentApplied.body.totalUsd, 7)
  assert.equal(amendmentApplied.body.totalKhr, 29400)
  const amendedSale = amended.sql.prepare('SELECT * FROM sales WHERE id=1').get()
  const amendedLine = amended.sql.prepare('SELECT * FROM sale_items WHERE id=1').get()
  assert.deepEqual([amendedSale.exchange_rate,amendedSale.delivery_fee_khr,amendedSale.total_khr,amendedLine.total_khr],[4200,8400,29400,21000])
  assert.deepEqual([amendedSale.change_usd,amendedSale.change_khr,amendedSale.change_is_actual,amendedSale.change_exchange_rate],[1,0,1,4000])
  assert.equal(amended.sql.prepare("SELECT COUNT(*) n FROM sale_mutation_receipts WHERE mutation_kind='amendment'").get().n, 1)
  amended.sql.prepare("UPDATE settings SET value='4300' WHERE key='exchange_rate'").run()
  assert.deepEqual(await amended.call('/1/amendments', amendmentRequest, 'POST'), amendmentApplied)
  assert.equal((await amended.call('/1/amendments', { ...amendmentRequest, delivery_fee_usd: 3 }, 'POST')).status, 409)
  console.log('PASS amendment applies one latest server rate to header and lines and exact retry preserves the first outcome')

  const amendmentRace = fixture(); seed(amendmentRace)
  amendmentRace.sql.prepare(`UPDATE sales SET sale_status='completed',is_delivery=1,delivery_fee_usd=1,
    delivery_fee_khr=4100,total_usd=6,total_khr=24600,updated_at='amend-v1' WHERE id=1`).run()
  amendmentRace.barrier(() => amendmentRace.sql.prepare("UPDATE settings SET value='4300' WHERE key='exchange_rate'").run())
  const amendmentConflict = await amendmentRace.call('/1/amendments', amendmentRequest, 'POST')
  assert.equal(amendmentConflict.status, 409, JSON.stringify(amendmentConflict))
  assert.equal(amendmentRace.sql.prepare('SELECT delivery_fee_usd FROM sales WHERE id=1').get().delivery_fee_usd, 1)
  assert.equal(amendmentRace.sql.prepare("SELECT COUNT(*) n FROM sale_mutation_receipts WHERE mutation_kind='amendment'").get().n, 0)
  console.log('PASS amendment settings race rolls back fee, rate rebase, ledger, and receipt together')

  const addition = fixture(); seed(addition)
  addition.sql.prepare('UPDATE sales SET change_usd=1,change_khr=0,change_is_actual=1,change_exchange_rate=4000 WHERE id=1').run()
  addition.sql.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_number,batch_key,is_active,received_at,lot_code)
    VALUES(501,1,1,'lot-501',1,'2026-01-01','LOT-501')`).run()
  addition.sql.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(501,1,8)').run()
  const additionRequest = {
    items: [{ product_id: 1, quantity: 1, applied_price_usd: 2 }],
    expected_updated_at: 'sale-v1',
    expected_exchange_rate: 4200,
    client_request_id: 'add-items-request-1',
  }
  const additionApplied = await addition.call('/1/items', additionRequest, 'POST')
  assert.equal(additionApplied.status, 200, JSON.stringify(additionApplied))
  assert.equal(additionApplied.body.exchangeRate, 4200)
  assert.ok(additionApplied.body.actionHistoryId > 0)
  assert.equal(additionApplied.body.undoActionId, additionApplied.body.actionHistoryId)
  const addedSale = addition.sql.prepare('SELECT * FROM sales WHERE id=1').get()
  assert.deepEqual([addedSale.exchange_rate,addedSale.subtotal_usd,addedSale.total_usd,addedSale.total_khr],[4200,7,7,29400])
  assert.deepEqual([addedSale.change_usd,addedSale.change_khr,addedSale.change_is_actual,addedSale.change_exchange_rate],[1,0,1,4000])
  assert.deepEqual(addition.sql.prepare('SELECT total_khr FROM sale_items WHERE sale_id=1 ORDER BY id').all().map((r) => r.total_khr), [21000,8400])
  assert.equal(addition.sql.prepare('SELECT COUNT(*) n FROM sale_item_batch_allocations').get().n, 1)
  assert.equal(addition.sql.prepare("SELECT COUNT(*) n FROM sale_mutation_members WHERE entity_kind='sale_item'").get().n, 1)
  assert.equal(addition.sql.prepare("SELECT COUNT(*) n FROM sale_mutation_receipts WHERE mutation_kind='add_items' AND history_id IS NOT NULL").get().n, 1)
  const storedSnapshot = JSON.parse(addition.sql.prepare("SELECT payload_json FROM undo_snapshots WHERE kind='sale.add_items'").get().payload_json)
  assert.ok(storedSnapshot.lines[0].saleItemId > 0)
  assert.ok(storedSnapshot.saleStateRevision > 0)
  assert.equal(storedSnapshot.moneyBefore.exchange_rate, 4100)
  assert.equal(storedSnapshot.moneyAfter.exchange_rate, 4200)
  addition.sql.prepare("UPDATE settings SET value='4300' WHERE key='exchange_rate'").run()
  assert.deepEqual(await addition.call('/1/items', additionRequest, 'POST'), additionApplied)
  assert.equal((await addition.call('/1/items', { ...additionRequest, items: [{ product_id: 1, quantity: 2 }] }, 'POST')).status, 409)
  console.log('PASS add-items atomically stores dynamic line/allocation/history ids, freezes latest rate, and retries exactly')

  const additionRace = fixture(); seed(additionRace)
  additionRace.barrier(() => additionRace.sql.prepare("UPDATE settings SET value='4300' WHERE key='exchange_rate'").run())
  const additionConflict = await additionRace.call('/1/items', { ...additionRequest, client_request_id: 'add-items-race-1' }, 'POST')
  assert.equal(additionConflict.status, 409, JSON.stringify(additionConflict))
  assert.equal(additionRace.sql.prepare('SELECT COUNT(*) n FROM sale_items WHERE sale_id=1').get().n, 1)
  assert.equal(additionRace.sql.prepare("SELECT COUNT(*) n FROM sale_mutation_receipts WHERE mutation_kind='add_items'").get().n, 0)
  assert.equal(additionRace.sql.prepare("SELECT COUNT(*) n FROM action_history WHERE entity='sale'").get().n, 0)
  console.log('PASS add-items settings race rejects core rows, history, allocations, and receipt together')
}

run().catch((error) => { console.error(error); process.exitCode = 1 })
