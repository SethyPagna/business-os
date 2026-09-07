// N21 -- sales.customer_address holds the DISPLAY address, never the Contact
// Options JSON that customers.address stores.
//
// The owner saw "[]" where a sale's address should be. customers.address holds
// the array lib/contactOptions.ts serializes, and the sale writers copied that
// column raw, so the sale detail, the receipt and the CSV export printed the
// JSON.
//
// Two writers are exercised here against the real schema and the real routes,
// rather than against a source-shape regex:
//   1. PATCH /sales/:id/customer -- links a customer to an existing sale and
//      snapshots their address. This is the writer that produced the rows the
//      owner was looking at.
//   2. POST /sales -- stores whatever the client sent. The POS now sends the
//      display address, but an out-of-date shell (or an offline sale queued by
//      one and replayed later) still sends the raw JSON, so the server
//      normalizes rather than trusting the caller. That is the same class of
//      defect as N18: a stale client writing data the server accepted.
//
// Both cases are discriminating: with the previous `?? null` raw copy they
// store the JSON string and fail here.
//
// Run: node scripts/test-sale-customer-address-snapshot-pure.cjs
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')

const root = path.join(__dirname, '..')
const user = { id: 1, name: 'Admin', username: 'admin', role_code: 'admin', permissions: { all: true } }
const cache = new Map()
// contactOptions is on this list deliberately: the loader stubs any relative
// import it does not name, and a stubbed kernel would make every address here
// resolve to undefined -- a test that agrees with itself and proves nothing.
const actual = new Set([
  'actorSnapshot', 'movementBranchName', 'db', 'permissions', 'saleBulkStatus', 'saleBulkUpdate',
  'saleTransitions', 'saleTotals', 'sqlBinding', 'productBatches', 'batchCode', 'salesStatus',
  'conflictControl', 'searchMatch', 'financialPrecision', 'paymentMethodRegistry',
  'paymentSettlement', 'saleSettlementAction', 'saleLineAddition', 'saleAmendments',
  'nativeSaleChange', 'receiptNumber', 'clientTimestamp', 'branchRoleGuards', 'branchRoles',
  'contactOptions',
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
    if (name.endsWith('/cache')) return { bumpVersion: async () => {}, getVersionWithFallback: async () => 0, cachedJsonResponse: async (_e, _k, _t, fn) => fn() }
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
  new Function('require', 'module', 'exports', output)(req, mod, mod.exports)
  return mod.exports
}

const sales = load('routes/sales.ts').default
const { contactDisplayAddress } = load('lib/contactOptions.ts')

// The exact shape customers.address holds for a contact with one address
// option -- produced by serializeContactOptions, not hand-written here.
const OPTIONS_JSON = JSON.stringify([
  { label: 'Default', name: null, phone: '012345678', email: null, address: 'St 271, Phnom Penh', area: null },
])
assert.equal(contactDisplayAddress(OPTIONS_JSON), 'St 271, Phnom Penh', 'sanity: the kernel is the real one, not a stub')

function fixture() {
  const sql = new Database(':memory:')
  sql.pragma('foreign_keys = OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    sql.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  }
  const env = { DB: {
    prepare(text) {
      return { bind(...params) {
        return { text, params,
          async first() { return sql.prepare(text).get(...params) || null },
          async all() { return { results: sql.prepare(text).all(...params) } },
          async run() { const r = sql.prepare(text).run(...params); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } } },
        }
      } }
    },
    async batch(statements) {
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
  sql.exec(`
    INSERT INTO settings(key,value,updated_at) VALUES
      ('exchange_rate','4200','s1'),('pos_payment_methods','["Cash"]','s1');
    INSERT INTO branches(id,name) VALUES(1,'Shop');
    INSERT INTO products(id,name,stock_quantity) VALUES(1,'Serum',10);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,8);
    INSERT INTO sales(
      id,receipt_number,cashier_name,branch_id,branch_name,payment_method,payment_details,
      payment_currency,exchange_rate,subtotal_usd,total_usd,amount_paid_usd,sale_status,updated_at
    ) VALUES(1,'S-1','admin',1,'Shop','Cash','[{"method":"Cash","amount_usd":5,"amount_khr":0}]','USD',4200,5,5,5,'completed','sale-v1');
  `)
  // Bound, not inlined: the options JSON carries double quotes.
  sql.prepare('INSERT INTO customers(id,name,phone,address) VALUES(1,?,?,?)').run('Sok Dara', '012345678', OPTIONS_JSON)
  return { sql, call }
}

async function run() {
  // 1. PATCH /sales/:id/customer -- the writer that produced the owner's rows.
  const f = fixture()
  const linked = await f.call('/1/customer', { customerId: 1, expected_updated_at: 'sale-v1' })
  assert.equal(linked.status, 200, JSON.stringify(linked))
  const stored = f.sql.prepare('SELECT customer_id,customer_name,customer_address FROM sales WHERE id=1').get()
  assert.equal(stored.customer_id, 1)
  assert.equal(stored.customer_name, 'Sok Dara')
  assert.equal(
    stored.customer_address,
    'St 271, Phnom Penh',
    'linking a customer must snapshot the display address, not the options JSON',
  )
  // The customer row itself is untouched: the Customers page still edits the
  // full options set, and the route's reference guard compares that raw column.
  assert.equal(f.sql.prepare('SELECT address FROM customers WHERE id=1').get().address, OPTIONS_JSON)
  console.log('PASS linking a customer snapshots the display address')

  // 2. POST /sales -- an out-of-date client sending the raw column.
  const g = fixture()
  const created = await g.call('/', {
    items: [{ product_id: 1, quantity: 1, applied_price_usd: 5, branch_id: 1 }],
    branch_id: 1,
    customer_id: 1,
    customer_name: 'Sok Dara',
    customer_phone: '012345678',
    // What a shell built before this change sends -- and what a sale queued
    // offline by one still replays after it.
    customer_address: OPTIONS_JSON,
    payment_details: [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }],
    payment_currency: 'USD',
    amount_paid_usd: 5,
    amount_paid_khr: 0,
    exchange_rate: 4200,
    client_request_id: 'address-create-1',
  }, 'POST')
  assert.equal(created.status, 200, JSON.stringify(created))
  assert.equal(
    g.sql.prepare('SELECT customer_address FROM sales WHERE id=?').get(created.body.id).customer_address,
    'St 271, Phnom Penh',
    'the server must not store the options JSON a stale client sent',
  )

  // A plainly typed address is untouched -- the normalization must not eat
  // ordinary input, including a numeric house number that parses as JSON.
  for (const [sent, expected] of [['Phnom Penh, Cambodia', 'Phnom Penh, Cambodia'], ['271', '271'], ['[]', null]]) {
    const h = fixture()
    const sale = await h.call('/', {
      items: [{ product_id: 1, quantity: 1, applied_price_usd: 5, branch_id: 1 }],
      branch_id: 1,
      customer_address: sent,
      payment_details: [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }],
      payment_currency: 'USD', amount_paid_usd: 5, amount_paid_khr: 0, exchange_rate: 4200,
      client_request_id: `address-create-${sent || 'blank'}`,
    }, 'POST')
    assert.equal(sale.status, 200, JSON.stringify(sale))
    assert.equal(
      h.sql.prepare('SELECT customer_address FROM sales WHERE id=?').get(sale.body.id).customer_address,
      expected,
      `a sale created with ${JSON.stringify(sent)} must store ${JSON.stringify(expected)}`,
    )
  }
  console.log('PASS a sale created by a stale client stores the display address')
}

run().then(() => console.log('test-sale-customer-address-snapshot-pure OK')).catch((error) => {
  console.error(error)
  process.exit(1)
})
