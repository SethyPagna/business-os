// Receipt-number race on POST /api/sales, against the real Hono route and the
// complete migrated schema.
//
// sales.receipt_number carries no UNIQUE index (migration 0107, and
// lib/receiptNumber.ts). The route used to rely on a probe
// (`SELECT 1 FROM sales WHERE receipt_number = ?`) that runs BEFORE the write
// batch, so a second till committing the same number between that probe and
// the batch produced two sales with one receipt number. The fix asserts
// uniqueness inside the batch and re-mints a bounded number of times.
//
// The race is reproduced deterministically: the harness `beforeBatch` hook
// commits a peer sale holding the exact receipt number the route is about to
// write -- the moment after the probe and before the batch. Every scenario
// asserts on stored rows, not only on the response.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const moduleCache = new Map()
const USER = {
  id: 71,
  username: 'sale_cashier',
  name: 'Sale Cashier',
  permissions: JSON.stringify({ pos: true }),
}

const overrides = {
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', USER); return next() } },
  '../lib/audit': { audit: async () => {} },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': {
    bumpVersion: async () => {},
    getVersionWithFallback: async () => 0,
    cachedJsonResponse: async (_request, _context, _key, _ttl, loader) => loader(),
  },
  '../lib/telegram': {
    formatSaleTelegramLines: () => [], formatSaleStatusTelegramLines: () => [],
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
const executionCtx = {
  waitUntil(promise) { promise?.catch?.(() => {}) },
  passThroughOnException() {},
}

const SALE_INSERT_RE = /INSERT\s+INTO\s+sales\s*\(/i

function routeDb(db, hooks = {}) {
  const api = {
    prepare(sql) {
      const statement = db.prepare(sql)
      return {
        all: (params) => statement.all(params),
        get: (params) => statement.get(params),
        run: async (params) => statement.run(params),
      }
    },
    batch: async (statements) => {
      if (hooks.beforeBatch) await hooks.beforeBatch(db, statements)
      const results = await db.batch(statements)
      if (hooks.afterBatchThrow) throw new Error('simulated lost D1 batch response')
      return results
    },
    exec: (sql) => db.exec(sql),
  }
  api.staging = api
  return api
}

function fixture(hooks = {}) {
  const db = openDb(loadAll())
  db.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)").run()
  db.prepare(`INSERT INTO products(id,name,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active)
              VALUES(10,'Powder','POWDER',10,9.5,38000,4,16000,1)`).run()
  db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,1,10)').run()
  db.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,batch_number)
              VALUES(500,10,'powder-lot','POWDER-LOT','2027-06-01','2026-09-01',1,1)`).run()
  db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(500,1,10)').run()
  // N2 (SEC-SALES): a sale is rung inside the cashier's open shift for today.
  db.prepare(`INSERT INTO shift_sessions(shift_code,scope_mode,user_id,user_name,branch_id,branch_name,business_date,opened_at) VALUES('FIXTURE-SHIFT','per_account',${USER.id},'cashier',1,'Shop',date('now','+7 hours'),datetime('now','-1 hour'))`).run()
  return { raw: db, route: routeDb(db, hooks) }
}

function request(clientRequestId, extra = {}) {
  return {
    branch_id: 1,
    money_precision_version: 1,
    items: [{
      product_id: 10,
      quantity: 1,
      branch_id: 1,
      batch_id: 500,
      applied_price_usd: 9.5,
      client_line_key: 'race-line',
      pricing_source: 'selling',
      pricing_quote: { gross_usd: 9.5, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 9.5, total_khr: 38000 },
    }],
    exchange_rate: 4000,
    payment_method: 'Cash',
    payment_currency: 'USD',
    amount_paid_usd: 9.5,
    client_request_id: clientRequestId,
    offline_owner: {
      version: 1, actor_id: USER.id, organization_id: null,
      authority: 'http://localhost', runtime: 'cloudflare-workers',
    },
    ...extra,
  }
}

async function postSale(db, body) {
  const response = await app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, { DB: db }, executionCtx)
  return { status: response.status, body: await response.json() }
}

// The receipt number the route is about to write, read off the batch itself.
function pendingReceipt(statements) {
  const insert = statements.find(({ sql }) => SALE_INSERT_RE.test(sql))
  return insert ? String(insert.params.receipt_number) : null
}

let peerSeq = 0
// A peer till's sale, committed outside this request's batch.
function commitPeerSale(db, receiptNumber) {
  peerSeq += 1
  db.prepare(`INSERT INTO sales(receipt_number,client_request_id,branch_id,branch_name,cashier_name,payment_method,total_usd,sale_status,cashier_id)
              VALUES(@receipt,@key,1,'Shop','Peer Till','Cash',1,'completed',99)`)
    .run({ receipt: receiptNumber, key: `peer-till-${peerSeq}` })
}

function duplicateReceiptGroups(db) {
  return db.prepare(`SELECT receipt_number, COUNT(*) AS n FROM sales
                     GROUP BY receipt_number HAVING COUNT(*) > 1`).all()
}

function stock(db) {
  return {
    branch: Number(db.prepare('SELECT quantity AS n FROM branch_stock WHERE product_id=10 AND branch_id=1').get().n),
    batch: Number(db.prepare('SELECT quantity AS n FROM branch_batch_stock WHERE batch_id=500 AND branch_id=1').get().n),
  }
}

;(async () => {
  const failures = []
  async function scenario(id, run) {
    try { await run() } catch (error) {
      failures.push(id)
      console.log(`FAIL scenario ${id}: ${String(error && error.message).split('\n')[0]}`)
    }
  }

  // 1. The race: a peer commits the same number between probe and batch.
  const raced = fixture({
    beforeBatch(db, statements) {
      if (raced.injected) return
      const receipt = pendingReceipt(statements)
      if (!receipt) return
      raced.injected = receipt
      commitPeerSale(db, receipt)
    },
  })
  await scenario(1, async () => {
    const created = await postSale(raced.route, request('race-till-a'))
    assert.ok(raced.injected, 'the peer sale must be committed at the batch boundary')
    assert.equal(created.status, 200, JSON.stringify(created.body))
    assert.deepEqual(duplicateReceiptGroups(raced.raw), [], 'two sales must never share one receipt number')
    const own = raced.raw.prepare(`SELECT id, receipt_number, search_normalized, creation_snapshot_json
                                   FROM sales WHERE client_request_id='race-till-a'`).get()
    assert.ok(own, 'the racing sale still commits')
    assert.notEqual(own.receipt_number, raced.injected)
    assert.equal(own.receipt_number, `${raced.injected}-2`, 'the retry takes the next same-second suffix')
    assert.equal(created.body.receiptNumber, own.receipt_number, 'the response names the stored receipt')
    assert.equal(JSON.parse(own.creation_snapshot_json).receipt_number, own.receipt_number, 'creation snapshot follows the retried number')
    // normalizeSearchText folds '-' to a space.
    assert.ok(String(own.search_normalized).startsWith(`${own.receipt_number.replace(/-/g, ' ')} `),
      `search text follows the retried number: ${own.search_normalized}`)
    const audit = JSON.parse(raced.raw.prepare("SELECT details FROM audit_logs WHERE entity='sale_creation' AND entity_id=?").get([String(own.id)]).details)
    assert.equal(audit.receiptNumber, own.receipt_number, 'creation audit follows the retried number')
    assert.equal(Number(raced.raw.prepare("SELECT COUNT(*) AS n FROM sale_items WHERE sale_id=?").get([own.id]).n), 1)
    assert.deepEqual(stock(raced.raw), { branch: 9, batch: 9 }, 'stock moves exactly once across the retry')
    console.log('PASS a peer committing the same receipt number between probe and batch forces a distinct retried number')
  })

  // 2. Replay of the retried sale's client_request_id returns the same sale.
  await scenario(2, async () => {
    const replay = await postSale(raced.route, request('race-till-a'))
    assert.equal(replay.status, 200, JSON.stringify(replay.body))
    assert.equal(replay.body.duplicate, true)
    const own = raced.raw.prepare("SELECT id, receipt_number FROM sales WHERE client_request_id='race-till-a'").get()
    assert.equal(replay.body.id, Number(own.id))
    assert.equal(replay.body.receiptNumber, own.receipt_number)
    assert.equal(Number(raced.raw.prepare("SELECT COUNT(*) AS n FROM sales WHERE client_request_id='race-till-a'").get().n), 1)
    assert.deepEqual(stock(raced.raw), { branch: 9, batch: 9 }, 'a replay moves no stock')
    console.log('PASS a client_request_id replay after a retried receipt returns the same sale and number')
  })

  // 3. An offline-queued number that another sale already holds is re-minted,
  //    not duplicated and not refused (a 409 would strand the queued sale).
  await scenario(3, async () => {
    const f = fixture()
    commitPeerSale(f.raw, '20260927-101500')
    const created = await postSale(f.route, request('offline-collide', { receipt_number: '20260927-101500' }))
    assert.equal(created.status, 200, JSON.stringify(created.body))
    assert.deepEqual(duplicateReceiptGroups(f.raw), [])
    const own = f.raw.prepare("SELECT receipt_number FROM sales WHERE client_request_id='offline-collide'").get()
    assert.notEqual(own.receipt_number, '20260927-101500')
    assert.match(own.receipt_number, /^\d{8}-\d{6}(?:-[0-9A-Z]{1,4})?$/)
    assert.equal(created.body.receiptNumber, own.receipt_number)
    console.log('PASS a client-supplied receipt number already held by another sale is re-minted, not duplicated')
  })

  // 4. A lost batch response for a client-numbered sale is a replay, not a
  //    receipt collision with itself: no retry, no second sale.
  await scenario(4, async () => {
    const f = fixture({ afterBatchThrow: true })
    const uncertain = await postSale(f.route, request('lost-numbered', { receipt_number: '20260927-102000' }))
    assert.equal(uncertain.status, 200, JSON.stringify(uncertain.body))
    assert.equal(uncertain.body.duplicate, true)
    assert.equal(uncertain.body.receiptNumber, '20260927-102000')
    assert.equal(Number(f.raw.prepare('SELECT COUNT(*) AS n FROM sales').get().n), 1)
    assert.deepEqual(stock(f.raw), { branch: 9, batch: 9 })
    console.log('PASS a committed sale whose response was lost is recovered as itself, never re-numbered')
  })

  // 5. Bounded: a peer that wins every attempt ends in a typed 409 with no
  //    effects -- and never as stock_conflict.
  await scenario(5, async () => {
    let attempts = 0
    const f = fixture({
      beforeBatch(db, statements) {
        const receipt = pendingReceipt(statements)
        if (!receipt) return
        attempts += 1
        commitPeerSale(db, receipt)
      },
    })
    const refused = await postSale(f.route, request('always-loses'))
    assert.equal(refused.status, 409, `status ${refused.status} code ${refused.body.code} receipt ${refused.body.receiptNumber}`)
    assert.equal(refused.body.code, 'receipt_number_conflict')
    assert.ok(attempts >= 2 && attempts <= 5, `retries are bounded (saw ${attempts} batch attempts)`)
    assert.equal(Number(f.raw.prepare("SELECT COUNT(*) AS n FROM sales WHERE client_request_id='always-loses'").get().n), 0)
    assert.equal(Number(f.raw.prepare('SELECT COUNT(*) AS n FROM sale_items').get().n), 0)
    assert.deepEqual(stock(f.raw), { branch: 10, batch: 10 })
    assert.deepEqual(duplicateReceiptGroups(f.raw), [])
    console.log(`PASS a receipt race lost on every one of ${attempts} attempts returns receipt_number_conflict with nothing written`)
  })

  // 6. A real unique-constraint failure on the receipt column is reported as
  //    what it is, not as a stock shortage.
  await scenario(6, async () => {
    const f = fixture()
    f.raw.exec("CREATE TRIGGER force_receipt_unique BEFORE INSERT ON sales BEGIN SELECT RAISE(ABORT,'UNIQUE constraint failed: sales.receipt_number'); END")
    const failed = await postSale(f.route, request('unique-mapped'))
    assert.equal(failed.status, 409, `status ${failed.status} code ${failed.body.code}`)
    assert.equal(failed.body.code, 'receipt_number_conflict', `reported as ${failed.body.code}`)
    assert.deepEqual(stock(f.raw), { branch: 10, batch: 10 })
    console.log('PASS a UNIQUE failure on sales.receipt_number maps to receipt_number_conflict, not stock_conflict')
  })

  // 7. Control: a genuine stock race still reports stock_conflict.
  await scenario(7, async () => {
    const f = fixture({
      beforeBatch(db) { db.prepare('UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=500').run() },
    })
    const short = await postSale(f.route, request('stock-control'))
    assert.equal(short.status, 409, JSON.stringify(short.body))
    assert.notEqual(short.body.code, 'receipt_number_conflict', 'a stock race is not a receipt race')
    assert.equal(Number(f.raw.prepare('SELECT COUNT(*) AS n FROM sales').get().n), 0)
    console.log(`PASS control: a stock race is still reported as ${short.body.code}`)
  })
  if (failures.length) {
    console.error(`RED: scenario(s) ${failures.join(", ")} failed`)
    process.exit(1)
  }
})().catch((error) => { console.error(error); process.exit(1) })
