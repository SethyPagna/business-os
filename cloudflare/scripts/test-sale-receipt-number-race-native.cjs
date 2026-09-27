// Native D1 proof of the POS receipt-number race (lane U-receipt).
//
// Two tills that check out in the same second both probe
// `SELECT 1 FROM sales WHERE receipt_number = ?`, both find the bare
// timestamp id free, and both used to write it: sales.receipt_number carries
// no UNIQUE index (migration 0107, lib/receiptNumber.ts). The fix re-asserts
// the number inside the create batch and re-mints a bounded number of times.
// test-sale-receipt-number-race-pure.cjs pins the retry's edge branches
// (replay, client-supplied number, lost response, bounded give-up) on
// node:sqlite; this file runs the race itself on workerd's D1 engine.
//
// Real: the Hono POST /api/sales handler, lib/db.ts (D1Compat and
// withD1Retry), the minting in lib/receiptNumber.ts, every migration in
// order, and native D1, which runs each db.batch() as one serialized SQLite
// transaction -- the property the in-batch guard depends on. The racing
// requests are concurrent invocations of the route, not a row injected by a
// hook, and a lost race is observed as the rejection native D1 actually
// raises.
// Fixture: authentication, audit, cache versions, broadcast and Telegram, as
// in test-sale-create-atomic-pure.cjs; the CLOCK the mint reads, pinned per
// scenario so every till mints inside one second (unpinned, the race only
// reproduces when the requests happen to share a wall-clock second, and the
// red-on-parent check would be a coin toss); and a barrier that holds each
// request's FIRST db.batch() until every till in the scenario has reached its
// own, i.e. until every till has already probed and minted. Nothing picks a
// receipt number for the route.
//
// Red on the parent commit (read-only `git show`; no checkout, no write):
//   RECEIPT_RACE_BASELINE=c5b28762 node test-sale-receipt-number-race-native.cjs
// Miniflare binds a random loopback port (never 8787) and keeps D1 in memory
// (never the shared .wrangler/state).

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { AsyncLocalStorage } = require('node:async_hooks')
const ts = require('typescript')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')
const BASELINE = process.env.RECEIPT_RACE_BASELINE || ''
assert.ok(!BASELINE || /^[0-9a-f]{7,40}$/i.test(BASELINE), 'RECEIPT_RACE_BASELINE must be a commit sha')

const USER = {
  id: 71,
  username: 'sale_cashier',
  name: 'Sale Cashier',
  permissions: JSON.stringify({ pos: true }),
}

// The instant the route's mint reads. Every other clock stays real.
let mintMoment = null

const moduleCache = new Map()
const overrides = {
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', USER); return next() } },
  '../lib/audit': { audit: async () => {} },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': {
    bumpVersion: async () => {},
    bumpVersions: async () => {},
    getVersionWithFallback: async () => 0,
    cachedJsonResponse: async (_request, _context, _key, _ttl, loader) => loader(),
  },
  '../lib/telegram': {
    formatSaleTelegramLines: () => [], formatSaleStatusTelegramLines: () => [],
    sendTelegramEvent: async () => {},
    telegramMoney: (value) => String(value ?? ''),
  },
}

function source(rel) {
  if (BASELINE && rel === 'routes/sales.ts') {
    return execFileSync('git', ['show', `${BASELINE}:cloudflare/src/${rel}`],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  }
  return fs.readFileSync(path.join(root, 'src', rel), 'utf8')
}

function load(rel) {
  if (moduleCache.has(rel)) return moduleCache.get(rel).exports
  const sourcePath = path.join(root, 'src', rel)
  const output = ts.transpileModule(source(rel), {
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

const realReceipts = load('lib/receiptNumber.ts')
overrides['../lib/receiptNumber'] = {
  ...realReceipts,
  // Only the clock is pinned: probing, the same-second suffixes and the
  // route's in-batch guard all stay real.
  uniqueBusinessDateTimeNumber: (prefix, exists, moment) =>
    realReceipts.uniqueBusinessDateTimeNumber(prefix, exists, moment ?? mintMoment ?? undefined),
}
const app = load('routes/sales.ts').default

const background = []
const executionCtx = {
  waitUntil(promise) { background.push(Promise.resolve(promise).catch(() => {})) },
  passThroughOnException() {},
}

const SALE_INSERT_RE = /INSERT\s+INTO\s+sales\s*\(/i

// Wraps the native binding. While a party is open, each member request's
// FIRST batch waits until every member has reached its own; later batches
// (the route's retry, withD1Retry's re-send, waitUntil work) pass straight
// through. Every native batch rejection is recorded with its request.
function gate(native) {
  const requestContext = new AsyncLocalStorage()
  const failures = []
  const firstBatchSql = new Map()
  let prepared = []
  let party = null
  const releaseIfFull = () => {
    if (party && party.waiting.length && party.waiting.length >= party.size) {
      for (const release of party.waiting.splice(0)) release()
    }
  }
  return {
    failures,
    firstBatchSql,
    open(size) { party = { size, waiting: [], arrived: new Set() } },
    close() { party = null },
    run(id, fn) {
      return requestContext.run(id, fn).finally(() => {
        // A member that ends without writing must not hold the others.
        if (party && !party.arrived.has(id)) { party.size -= 1; releaseIfFull() }
      })
    },
    binding: {
      prepare(sql) {
        prepared.push(sql)
        return native.prepare(sql)
      },
      async batch(statements) {
        const id = requestContext.getStore()
        // D1Compat prepares a batch's statements synchronously right before
        // this call, so they are the last `statements.length` prepared.
        const sql = prepared.slice(-statements.length)
        prepared = []
        if (party && id && !party.arrived.has(id)) {
          party.arrived.add(id)
          firstBatchSql.set(id, sql)
          await new Promise((resolve) => { party.waiting.push(resolve); releaseIfFull() })
        }
        try {
          return await native.batch(statements)
        } catch (error) {
          failures.push({ id, message: String(error && error.message || error) })
          throw error
        }
      },
      exec: (sql) => native.exec(sql),
    },
  }
}

// Each product has one lot: product 10 -> lot 500, 11 -> 501, 12 -> 502.
const PRODUCTS = [10, 11, 12]
const lotOf = (productId) => productId + 490

function request(clientRequestId, productId) {
  return {
    branch_id: 1,
    money_precision_version: 1,
    items: [{
      product_id: productId,
      quantity: 1,
      branch_id: 1,
      batch_id: lotOf(productId),
      applied_price_usd: 9.5,
      client_line_key: 'native-race-line',
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
  }
}

async function migrate(db) {
  const dir = path.join(root, 'migrations')
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()) {
    // As in test-cost-receipt-identity-native.cjs: 0098's alias seed is a
    // no-op on an empty users table, and exceeds Miniflare's compound-SELECT
    // cap, so only that statement is omitted.
    const statements = split(fs.readFileSync(path.join(dir, name), 'utf8'))
      .filter((sql) => !(name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())))
    for (let i = 0; i < statements.length; i += 50) {
      try {
        await db.batch(statements.slice(i, i + 50).map((sql) => db.prepare(sql)))
      } catch (error) {
        error.message = `${name}: ${error.message}`
        throw error
      }
    }
  }
}

;(async () => {
  const results = []
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    port: 0,
    log: new Log(LogLevel.ERROR),
  })
  try {
    const native = await mf.getD1Database('DB')
    await migrate(native)
    await native.batch([
      native.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)"),
      ...PRODUCTS.flatMap((id) => [
        native.prepare(`INSERT INTO products(id,name,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active)
                        VALUES(?,?,?,10,9.5,38000,4,16000,1)`).bind(id, `Powder ${id}`, `POWDER-${id}`),
        native.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,10)').bind(id),
        native.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,batch_number)
                        VALUES(?,?,?,?,'2027-06-01','2026-09-01',1,1)`).bind(lotOf(id), id, `powder-lot-${id}`, `POWDER-LOT-${id}`),
        native.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,10)').bind(lotOf(id)),
      ]),
    ])

    const tills = gate(native)
    const count = async (sql, ...binds) => Number((await native.prepare(sql).bind(...binds).first()).n)
    const state = async () => {
      const snapshot = {
        sales: await count('SELECT COUNT(*) AS n FROM sales'),
        items: await count('SELECT COUNT(*) AS n FROM sale_items'),
        allocations: await count('SELECT COUNT(*) AS n FROM sale_item_batch_allocations'),
        movements: await count('SELECT COUNT(*) AS n FROM inventory_movements'),
      }
      for (const id of PRODUCTS) {
        snapshot[`product_${id}`] = await count('SELECT stock_quantity AS n FROM products WHERE id=?', id)
        snapshot[`branch_${id}`] = await count('SELECT quantity AS n FROM branch_stock WHERE product_id=? AND branch_id=1', id)
        snapshot[`batch_${id}`] = await count('SELECT quantity AS n FROM branch_batch_stock WHERE batch_id=? AND branch_id=1', lotOf(id))
      }
      return snapshot
    }
    const moved = (before, after) => Object.fromEntries(Object.keys(before).map((key) => [key, after[key] - before[key]]))
    // One unit per saved sale, off that sale's own product and lot.
    const expectedMove = (soldProducts) => {
      const n = soldProducts.length
      const move = { sales: n, items: n, allocations: n, movements: n }
      for (const id of PRODUCTS) {
        const units = 0 - soldProducts.filter((sold) => sold === id).length // 0 - 0 is +0, not -0
        Object.assign(move, { [`product_${id}`]: units, [`branch_${id}`]: units, [`batch_${id}`]: units })
      }
      return move
    }
    const duplicateGroups = async () => (await native.prepare(
      'SELECT receipt_number, COUNT(*) AS n FROM sales GROUP BY receipt_number HAVING COUNT(*) > 1').all()).results
    const stored = async (ids) => Object.fromEntries((await native.prepare(
      `SELECT client_request_id, receipt_number FROM sales WHERE client_request_id IN (${ids.map(() => '?').join(',')})`)
      .bind(...ids).all()).results.map((row) => [row.client_request_id, row.receipt_number]))
    const checkout = (id, productId) => tills.run(id, async () => {
      const response = await app.request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request(id, productId)),
      }, { DB: tills.binding }, executionCtx)
      return { id, productId, status: response.status, body: await response.json() }
    })
    async function concurrently(entries) {
      tills.open(entries.length)
      try { return await Promise.all(entries.map(([id, productId]) => checkout(id, productId))) } finally {
        tills.close()
        await Promise.all(background.splice(0))
      }
    }

    // Tills racing inside one second, each selling a different product (so no
    // stock or pricing guard can turn one back): every till must get its own
    // number, every sale must be written once, and each losing attempt must
    // have been rejected inside its batch and retried with the next suffix.
    async function race(label, instant, stamp, entries) {
      mintMoment = new Date(instant)
      const ids = entries.map(([id]) => id)
      const before = await state()
      const failuresBefore = tills.failures.length
      const created = await concurrently(entries)
      for (const result of created) assert.equal(result.status, 200, `${label}: ${result.id}: ${JSON.stringify(result.body)}`)
      const receipts = created.map((result) => result.body.receiptNumber)
      assert.equal(new Set(receipts).size, receipts.length,
        `${label}: concurrent tills were given one receipt number: ${receipts.join(', ')}`)
      assert.deepEqual([...receipts].sort(), entries.map((_entry, index) => (index ? `${stamp}-${index + 1}` : stamp)),
        `${label}: the tills that lost take the next same-second suffixes`)
      assert.deepEqual(await stored(ids), Object.fromEntries(created.map((result) => [result.id, result.body.receiptNumber])),
        `${label}: each stored sale carries the number its till was given`)
      assert.deepEqual(await duplicateGroups(), [], `${label}: no receipt number is shared by two sales`)
      assert.deepEqual(moved(before, await state()), expectedMove(entries.map(([, productId]) => productId)),
        `${label}: every sale is written once and a rejected attempt leaves nothing behind`)
      for (const id of ids) {
        assert.ok((tills.firstBatchSql.get(id) || []).some((sql) => SALE_INSERT_RE.test(sql)),
          `${label}: the barrier held ${id}'s sale-create batch`)
      }
      const rejected = tills.failures.slice(failuresBefore)
      assert.ok(rejected.length >= entries.length - 1,
        `${label}: every till but one was rejected by native D1 at least once (${rejected.length} rejection(s))`)
      for (const failure of rejected) {
        // json_extract on a non-JSON literal: the in-batch guard idiom.
        assert.match(failure.message, /malformed JSON/, `${label}: ${failure.id} was rejected by: ${failure.message}`)
      }
      const winner = created.find((result) => result.body.receiptNumber === stamp)
      assert.ok(!rejected.some((failure) => failure.id === winner.id), `${label}: the till that kept ${stamp} was never rejected`)
      return `${[...receipts].sort().join(' / ')}; ${rejected.length} native in-batch rejection(s): `
        + [...new Set(rejected.map((failure) => failure.message))].join(' | ')
    }

    async function scenario(label, run) {
      try {
        const detail = await run()
        results.push({ label, ok: true })
        console.log(`PASS ${label}${detail ? ` -- ${detail}` : ''}`)
      } catch (error) {
        results.push({ label, ok: false })
        console.log(`FAIL ${label}: ${String(error && error.message).split('\n').slice(0, 40).join('\n')}`)
      }
    }

    // 1. Two tills, one second. Phnom Penh 12:30:00 = 05:30:00Z.
    await scenario('two tills in one second get distinct receipt numbers', () =>
      race('two tills', '2026-09-27T05:30:00.000Z', '20260927-123000', [['till-a', 10], ['till-b', 11]]))

    // 2. Three tills, one second: the two that lose can collide again on -2;
    // the bounded retry still gives every till its own number.
    await scenario('three tills in one second get distinct receipt numbers', () =>
      race('three tills', '2026-09-27T05:31:00.000Z', '20260927-123100', [['till-c', 10], ['till-d', 11], ['till-e', 12]]))

    // 3. Two tills, one second, the SAME product. The receipt invariant must
    // hold whichever guard turns a till back. Today the later till is refused
    // by the pricing CAS before its receipt guard is reached:
    // pricingSourceGuard compares the whole `SELECT * FROM products` row,
    // stock_quantity included, so the first sale's own deduction reads as a
    // price change (sale_pricing_quote_conflict). Only the invariant is
    // pinned here, so narrowing that CAS later does not turn this red.
    await scenario('same product in one second: no shared number, a refused till records nothing', async () => {
      mintMoment = new Date('2026-09-27T05:32:00.000Z')
      const before = await state()
      const created = await concurrently([['till-f', 12], ['till-g', 12]])
      const saved = created.filter((result) => result.status === 200)
      assert.ok(saved.length >= 1, JSON.stringify(created.map((result) => result.body)))
      for (const refused of created.filter((result) => result.status !== 200)) {
        assert.equal(refused.status, 409, JSON.stringify(refused.body))
        assert.equal(Object.hasOwn(refused.body, 'receiptNumber'), false)
      }
      const receipts = saved.map((result) => result.body.receiptNumber)
      assert.equal(new Set(receipts).size, receipts.length, `one receipt number twice: ${receipts.join(', ')}`)
      assert.deepEqual(await stored(created.map((result) => result.id)),
        Object.fromEntries(saved.map((result) => [result.id, result.body.receiptNumber])))
      assert.deepEqual(await duplicateGroups(), [])
      assert.deepEqual(moved(before, await state()), expectedMove(saved.map((result) => result.productId)))
      return created.map((result) => `${result.id} ${result.status} ${result.body.receiptNumber || result.body.code}`).join('; ')
    })

    // 4. Control: the same second without a race. The probe alone picks -2
    // and nothing is rejected -- the retry path is reserved for real races.
    await scenario('sequential same-second checkouts use the probe and are never rejected', async () => {
      mintMoment = new Date('2026-09-27T05:33:00.000Z')
      const failuresBefore = tills.failures.length
      const first = await checkout('till-h', 10)
      const second = await checkout('till-i', 11)
      await Promise.all(background.splice(0))
      assert.equal(first.status, 200, JSON.stringify(first.body))
      assert.equal(second.status, 200, JSON.stringify(second.body))
      assert.equal(first.body.receiptNumber, '20260927-123300')
      assert.equal(second.body.receiptNumber, '20260927-123300-2')
      assert.equal(tills.failures.length, failuresBefore, 'no batch was rejected without a race')
      return `${first.body.receiptNumber} / ${second.body.receiptNumber}`
    })

    await scenario('the whole run: every sale has its own number, line, lot row and movement', async () => {
      assert.deepEqual(await duplicateGroups(), [])
      const final = await state()
      assert.equal(final.items, final.sales)
      assert.equal(final.allocations, final.sales)
      assert.equal(final.movements, final.sales)
      for (const key of ['product', 'branch', 'batch']) {
        assert.equal(PRODUCTS.reduce((units, id) => units + 10 - final[`${key}_${id}`], 0), final.sales, `${key} stock moved once per sale`)
      }
      return `${final.sales} sales`
    })
  } catch (error) {
    results.push({ label: 'native fixture', ok: false })
    console.error(error)
  } finally {
    await Promise.all(background.splice(0))
    await mf.dispose()
  }
  const passed = results.filter((result) => result.ok).length
  console.log(`${passed}/${results.length} native receipt-race checks passed${BASELINE ? ` (routes/sales.ts from ${BASELINE})` : ''}`)
  if (passed !== results.length || results.length === 0) process.exitCode = 1
})()
