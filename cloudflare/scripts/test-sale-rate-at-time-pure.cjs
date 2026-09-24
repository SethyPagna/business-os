// Rate-at-time regression for the Worker's money writers.
//
// Owner rule (24 Sep 2026): "a change to the exchange rate applies only from
// the date and time it was changed onwards; every older sale (and other dated
// money record) keeps the rate it was made with." Returns are never blocked.
//
// Every older sale here was booked at 4000 KHR/USD while the live setting says
// 4200, so a writer that reads the setting instead of the record stores
// different numbers from one that reads the record. The REAL routes/sales.ts
// and routes/returns.ts run through Hono's app.request() over an in-memory
// node:sqlite database with every migration applied, behind the real
// lib/db.ts; only auth, audit, cache, broadcast and Telegram are stubbed.
//
// Run (from cloudflare/): node scripts/test-sale-rate-at-time-pure.cjs

const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')

const root = path.join(__dirname, '..')
const user = { id: 1, name: 'Admin', username: 'admin', role_code: 'admin', permissions: { all: true } }
const stubs = {
  auth: { requireAuth: async (c, next) => { c.set('user', user); return next() } },
  audit: { audit: async () => {}, changedFields: () => null, auditChangeColumns: () => ({ old_value: null, new_value: null }), isSecretShapedAuditKey: () => false },
  cache: { bumpVersion: async () => {}, bumpVersions: async () => {}, getVersionWithFallback: async () => 0, cachedJsonResponse: async (_env, _key, _ttl, fn) => fn() },
  broadcastHub: { broadcast: async () => {} },
  telegram: { formatSaleTelegramLines: () => [], formatSaleStatusTelegramLines: () => [], sendTelegramEvent: async () => false, sendReturnTelegramEvent: async () => false },
  undoAppliers: { recordSaleAddItemsUndoSnapshot: async () => null },
}
const modules = new Map()
function load(rel) {
  if (modules.has(rel)) return modules.get(rel).exports
  const mod = { exports: {} }
  modules.set(rel, mod)
  const sourcePath = path.join(root, 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: sourcePath,
  }).outputText
  const req = (name) => {
    if (!name.startsWith('.')) return require(name)
    return stubs[path.posix.basename(name)] || load(`${path.posix.join(path.posix.dirname(rel), name)}.ts`)
  }
  new Function('require', 'module', 'exports', output)(req, mod, mod.exports)
  return mod.exports
}

const salesApp = load('routes/sales.ts').default
const returnsApp = load('routes/returns.ts').default
const owner = load('lib/offlineSaleOwnership.ts').canonicalOfflineSaleOwner(user, 'http://localhost/')
const migrations = fs.readdirSync(path.join(root, 'migrations')).filter((name) => name.endsWith('.sql')).sort()
  .map((name) => fs.readFileSync(path.join(root, 'migrations', name), 'utf8'))

// A raw D1 binding: lib/db.ts turns @names into ? and calls
// prepare(sql).bind(...values).first/all/run, and batch(prepared) as one
// transaction.
function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys = OFF;')
  for (const text of migrations) sql.exec(text)
  const meta = (result) => ({ meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } })
  const statement = (text, values = []) => ({
    text, values,
    bind: (...next) => statement(text, next.map((value) => value === undefined ? null : typeof value === 'boolean' ? Number(value) : value)),
    first: async () => sql.prepare(text).get(...values) ?? null,
    all: async () => ({ results: sql.prepare(text).all(...values) }),
    run: async () => meta(sql.prepare(text).run(...values)),
  })
  const DB = {
    prepare: (text) => statement(text),
    async batch(statements) {
      sql.exec('BEGIN IMMEDIATE')
      try {
        const results = statements.map(({ text, values }) => /^\s*(SELECT|WITH)\b/i.test(text)
          ? { results: sql.prepare(text).all(...values), meta: { changes: 0 } }
          : meta(sql.prepare(text).run(...values)))
        sql.exec('COMMIT')
        return results
      } catch (error) {
        sql.exec('ROLLBACK')
        throw error
      }
    },
  }
  const ctx = { waitUntil: (promise) => { promise?.catch?.(() => {}) }, passThroughOnException() {} }
  const call = (app) => async (method, url, body) => {
    const response = await app.request(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, { DB }, ctx)
    return { status: response.status, body: await response.json() }
  }
  sql.exec(`
    INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES
      ('exchange_rate','4200','s1'),('change_exchange_rate','4200','s1'),('pos_payment_methods','["ABA Bank","Cash"]','s1');
    INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1);
    INSERT INTO products(id,name,is_active,stock_quantity,selling_price_usd) VALUES(1,'Serum',1,10,NULL),(2,'Toner',1,10,10);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,10),(2,1,10);
  `)
  return { sql, sales: call(salesApp), returns: call(returnsApp) }
}

// A legacy (precision v0) sale booked before the rate moved: 5 USD, KHR at 4000.
function seedLegacySale(sql, rate, status) {
  sql.prepare(`INSERT INTO sales(id,receipt_number,cashier_name,branch_id,branch_name,customer_name,payment_method,payment_details,
      payment_currency,exchange_rate,subtotal_usd,subtotal_khr,discount_usd,discount_khr,tax_usd,tax_khr,total_usd,total_khr,
      amount_paid_usd,amount_paid_khr,change_usd,change_khr,sale_status,search_normalized,updated_at)
    VALUES(1,'S-1','Mia',1,'Shop','Dara',NULL,NULL,'USD',?,5,20000,0,0,0,0,5,20000,0,0,0,0,?,'s-1','sale-v1')`).run(rate, status)
  sql.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,applied_price_usd,applied_price_khr,total_usd,total_khr,
      product_discount_usd,product_discount_khr,base_price_usd,base_price_khr,manual_discount_usd,manual_discount_khr,branch_id)
    VALUES(1,1,1,'Serum',1,5,20000,5,20000,0,0,5,20000,0,0,1)`).run()
}
const row = (sql, text, ...values) => ({ ...sql.prepare(text).get(...values) })
const saleMoney = (sql) => row(sql, 'SELECT sale_status,exchange_rate,subtotal_khr,total_khr,amount_paid_khr FROM sales WHERE id=1')
const settle = (expectedRate, amountKhr) => ({
  sale_status: 'completed', expected_updated_at: 'sale-v1', client_request_id: `settle-${expectedRate}-${amountKhr}`,
  expected_exchange_rate: expectedRate, payment_details: [{ method: 'Cash', amount_usd: 0, amount_khr: amountKhr }],
})
let requestSeq = 0
const legacyReturn = () => ({
  client_request_id: `rate-return-${++requestSeq}`, sale_id: 1, reason: 'Wrong shade', exchange_rate: 4200,
  items: [{ sale_item_id: 1, product_id: 1, quantity: 1, return_to_stock: true }],
  replacement_items: [{ product_id: 2, quantity: 1, branch_id: 1, applied_price_usd: 10 }],
})
const returnRates = (sql, body) => ({
  return_rate: row(sql, 'SELECT exchange_rate FROM returns WHERE id=?', body.id).exchange_rate,
  ...row(sql, 'SELECT exchange_rate AS replacement_rate,total_khr AS replacement_total_khr FROM sales WHERE id=?', body.replacementSaleId),
})
const newSale = (exchangeRate, quotedKhr) => ({
  offline_owner: owner, money_precision_version: 1, branch_id: 1, payment_currency: 'USD',
  ...(exchangeRate === undefined ? {} : { exchange_rate: exchangeRate }),
  items: [{ product_id: 1, quantity: 1, applied_price_usd: 5, branch_id: 1, client_line_key: `rate-line-${++requestSeq}`,
    pricing_source: 'manual', selling_price_input_usd: 5,
    pricing_quote: { gross_usd: 5, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 5, total_khr: quotedKhr } }],
  payment_details: [{ method: 'ABA Bank', amount_usd: 5, amount_khr: 0 }], amount_paid_usd: 5, amount_paid_khr: 0,
  change_is_actual: true, change_usd: 0, change_khr: 0, client_request_id: `rate-new-sale-${requestSeq}`,
})

let failures = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL ${name}\n  ${String(error.message).split('\n').join('\n  ')}`)
  }
}

async function run() {
  await check('settling a legacy sale keeps its own 4000 rate: after-state, KHR columns and response', async () => {
    const f = fixture()
    seedLegacySale(f.sql, 4000, 'awaiting_payment')
    // 20,000 riel is exactly 5 USD at the booked 4000; at 4200 it would be short.
    const res = await f.sales('PATCH', '/1/status', settle(4000, 20000))
    assert.equal(res.status, 200, `settle echoing the sale's own rate: ${JSON.stringify(res.body)}`)
    assert.equal(res.body.exchange_rate, 4000, 'response rate')
    assert.deepEqual(saleMoney(f.sql), { sale_status: 'completed', exchange_rate: 4000, subtotal_khr: 20000, total_khr: 20000, amount_paid_khr: 20000 })
    assert.deepEqual(row(f.sql, 'SELECT applied_price_khr,total_khr,base_price_khr FROM sale_items WHERE id=1'),
      { applied_price_khr: 20000, total_khr: 20000, base_price_khr: 20000 })
  })

  await check('the settlement guard refuses the live 4200 with current_exchange_rate 4000 and writes nothing', async () => {
    const f = fixture()
    seedLegacySale(f.sql, 4000, 'awaiting_payment')
    const before = saleMoney(f.sql)
    const res = await f.sales('PATCH', '/1/status', settle(4200, 21000))
    assert.deepEqual(saleMoney(f.sql), before, `a reviewed rate that is not the sale's own must not re-rate it (HTTP ${res.status})`)
    assert.equal(res.status, 409)
    assert.equal(res.body.code, 'exchange_rate_changed')
    assert.equal(res.body.current_exchange_rate, 4000)
    assert.equal(res.body.current?.exchange_rate, 4000)
  })

  for (const rate of [0, null]) {
    await check(`settling a sale whose own rate is ${rate} is refused with money_precision_invalid_rate`, async () => {
      const f = fixture()
      seedLegacySale(f.sql, rate, 'awaiting_payment')
      const before = saleMoney(f.sql)
      const res = await f.sales('PATCH', '/1/status', settle(4200, 21000))
      assert.deepEqual(saleMoney(f.sql), before, `no substitute rate may be written (HTTP ${res.status} ${JSON.stringify(res.body)})`)
      assert.equal(res.status, 409)
      assert.deepEqual(res.body, { error: 'money_precision_invalid_rate', code: 'money_precision_invalid_rate' })
    })
  }

  await check('a legacy return on a 4000 sale books 4000 on the return and its replacement sale, whatever the body says', async () => {
    const f = fixture()
    seedLegacySale(f.sql, 4000, 'completed')
    const res = await f.returns('POST', '/', legacyReturn())
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(returnRates(f.sql, res.body), { return_rate: 4000, replacement_rate: 4000, replacement_total_khr: 40000 })
  })

  for (const rate of [null, 0]) {
    await check(`a return whose sale rate is ${rate} books the 4100 schema default, not the 4200 body or setting, and is not refused`, async () => {
      const f = fixture()
      seedLegacySale(f.sql, rate, 'completed')
      const res = await f.returns('POST', '/', legacyReturn())
      assert.equal(res.status, 200, JSON.stringify(res.body))
      assert.deepEqual(returnRates(f.sql, res.body), { return_rate: 4100, replacement_rate: 4100, replacement_total_khr: 41000 })
    })
  }

  await check('a supplier return books a valid body rate, else the live setting, else the 4100 schema default', async () => {
    const f = fixture()
    const post = async (extra) => {
      const res = await f.returns('POST', '/supplier', {
        client_request_id: `rate-supplier-${++requestSeq}`, reason: 'Expired', branch_id: 1, supplier_name: 'Acme', settlement: 'refund',
        items: [{ product_id: 1, quantity: 1, branch_id: 1, cost_price_usd: 2, cost_price_khr: 8000 }], ...extra,
      })
      assert.equal(res.status, 200, JSON.stringify(res.body))
      return row(f.sql, 'SELECT exchange_rate FROM returns WHERE id=?', res.body.id).exchange_rate
    }
    assert.equal(await post({}), 4200, 'no body rate: the live setting at the time of the return')
    assert.equal(await post({ exchange_rate: 4300 }), 4300, 'a valid body rate is the rate this new event was made with')
    f.sql.exec("DELETE FROM settings WHERE key='exchange_rate'")
    assert.equal(await post({}), 4100, 'no body rate and no setting: the schema default')
  })

  await check('a new sale books the till rate when sent, else the live setting', async () => {
    const f = fixture()
    const live = await f.sales('POST', '/', newSale(undefined, 21000))
    assert.equal(live.status, 200, `no client rate, quote reviewed at the live 4200: ${JSON.stringify(live.body)}`)
    assert.equal(row(f.sql, 'SELECT exchange_rate FROM sales WHERE id=?', live.body.id).exchange_rate, 4200)
    const till = await f.sales('POST', '/', newSale(4000, 20000))
    assert.equal(till.status, 200, JSON.stringify(till.body))
    assert.equal(row(f.sql, 'SELECT exchange_rate FROM sales WHERE id=?', till.body.id).exchange_rate, 4000)
  })

  if (failures) {
    console.log(`${failures} check(s) failed`)
    process.exit(1)
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
