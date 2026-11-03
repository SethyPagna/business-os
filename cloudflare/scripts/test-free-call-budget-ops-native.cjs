'use strict'
// Lane P1.2 (S4): the 1008 operations on the Workers FREE plan, through the whole Worker. Boots the REAL Worker (src/index.ts,
// bundled in memory) under Miniflare with PLAN_TIER=free, counts every D1 call (a db.batch = one call, waitUntil work included)
// and refuses call 51 exactly as Cloudflare does, then drives the four operations that scaled their calls with their size:
//   1. POST /api/branches/transfer-bulk  (3 reads per line after the commit; every pre-read chunked per 100 ids)
//   2. PATCH /api/sales/:id/status Cancelled -> Completed  (1 branch_stock read per line)
//   3. GET/POST /api/settings/payment-methods/impact|replace  (1 call per 200 sales)
//   4. the customers bulk-delete queue job  (~6 calls a chunk, every chunk in ONE invocation)
// and proves they still do EXACTLY what they did:
//   - PARITY GOLDEN. scripts/harness/free_call_budget_golden.json holds the normalized outcome of the BASE commit (64c9e9166):
//     transfer receipts, members and allocations, stock_transfers, inventory_movements, branch_stock, branch_batch_stock for 1, 5
//     and 20 lines across two branches with split lots (and the undo), the refusals (status + body) of a lot from the wrong
//     branch, a negative quantity and 13 other bad requests, and the un-cancel of a 45- and an 86-line sale (ledgers, movements,
//     allocations). It was captured by running this very file against the base src tree with the limit lifted:
//        P12_SRC=<git archive 64c9e9166 cloudflare/src>/cloudflare/src P12_LIMIT=100000 P12_CAPTURE=1 node scripts/test-free-call-budget-ops-native.cjs
//     and a normal run (the new src, limit 50) must produce the same bytes.
//   - double-apply (replay, a second un-cancel) moves nothing; undo and cancel reverse every unit in both ledgers.
//   - MUTANTS. P12_MUTANT=<name> bundles a deliberately wrong src (list below); the run must go RED.
// BUDGET: calls are asserted as upper bounds AND as "does not grow with the line count".
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { createHash } = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const SRC = process.env.P12_SRC ? path.resolve(process.env.P12_SRC) : path.join(ROOT, 'src')
const GOLDEN_FILE = path.join(__dirname, 'harness', 'free_call_budget_golden.json')
const CAPTURE = !!process.env.P12_CAPTURE
const ORIGIN = 'http://127.0.0.1:4391'
const ADMIN_PASSWORD = 'budget-admin-password-1'

// The Free ceiling comes from planTier.ts itself, never a literal here.
const freeLimits = (() => {
  const file = path.join(ROOT, 'src', 'lib', 'planTier.ts')
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file }).outputText
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', out)(mod.exports, () => { throw new Error('planTier.ts must have no runtime imports') }, mod)
  return mod.exports.PLAN_LIMITS_BY_TIER.free
})()
const LIMIT = Number(process.env.P12_LIMIT) || freeLimits.d1QueriesPerInvocation

// ---- mutants: wrong implementations, applied to the bundle in memory (src on disk is never touched) ------------------------
const MUTANTS = {
  'onhand-from-to-swapped': { file: 'routes/branches.ts', from: 'AND branch_id = @from) AS from_on_hand', to: 'AND branch_id = @to) AS from_on_hand' },
  'stock-read-ignores-branch': { file: 'routes/branches.ts', from: 'SELECT product_id, quantity FROM branch_stock WHERE branch_id = @branchId AND product_id IN (SELECT value FROM json_each(@ids))', to: 'SELECT product_id, quantity FROM branch_stock WHERE product_id IN (SELECT value FROM json_each(@ids))' },
  'lot-stock-read-ignores-branch': { file: 'routes/branches.ts', from: 'SELECT batch_id, quantity FROM branch_batch_stock WHERE branch_id = @branchId AND batch_id IN (SELECT value FROM json_each(@ids))', to: 'SELECT batch_id, quantity FROM branch_batch_stock WHERE batch_id IN (SELECT value FROM json_each(@ids))' },
  'uncancel-pair-swapped': { file: 'routes/sales.ts', from: "bs.product_id = json_extract(j.value, '$[0]') AND bs.branch_id = json_extract(j.value, '$[1]')", to: "bs.product_id = json_extract(j.value, '$[1]') AND bs.branch_id = json_extract(j.value, '$[0]')" },
  'payment-scan-first-page-only': { file: 'routes/settings.ts', from: '    if (rows.length < pageSize) break', to: '    break' },
}
const MUTANT = process.env.P12_MUTANT
if (MUTANT) assert.ok(MUTANTS[MUTANT], `unknown mutant ${MUTANT}: ${Object.keys(MUTANTS).join(', ')}`)

const WRAPPER = `
import worker, { SyncUploadSession, BroadcastHub } from './index';
export { SyncUploadSession, BroadcastHub };
let current = null;
const queued = [];
function gate() {
  if (!current) return false;
  current.calls++;
  return current.calls > ${LIMIT};
}
const refuse = () => Promise.reject(new Error('D1_ERROR: Too many API requests by single Worker invocation.'));
function counting(real) {
  const statement = (inner) => new Proxy(inner, { get(target, key) {
    if (key === '__inner') return target;
    if (key === 'bind') return (...values) => statement(target.bind(...values));
    if (key === 'first' || key === 'all' || key === 'run' || key === 'raw') return (...args) => gate() ? refuse() : target[key](...args);
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value } });
  return new Proxy(real, { get(target, key) {
    if (key === 'prepare') return (sql) => statement(target.prepare(sql));
    if (key === 'batch') return (items) => gate() ? refuse() : target.batch(items.map((item) => item.__inner || item));
    if (key === 'exec') return (sql) => gate() ? refuse() : target.exec(sql);
    if (key === 'withSession') return (...a) => counting(target.withSession(...a));
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value } });
}
const queue = { async send(body) { queued.push(body) }, async sendBatch(messages) { for (const m of messages) queued.push(m.body) } };
let source = null, wrapped = null;
function wrap(env) {
  if (source !== env) { source = env; wrapped = { ...env, DB: counting(env.DB), IMPORT_DB: env.IMPORT_DB && counting(env.IMPORT_DB), IMPORT_QUEUE: queue } }
  return wrapped;
}
async function counted(fn) {
  const counter = { calls: 0 };
  const pending = [];
  const ctx = { waitUntil(p) { pending.push(Promise.resolve(p).catch((e) => { counter.bgError = String(e && e.message || e) })) }, passThroughOnException() {} };
  current = counter;
  let result, error;
  try { result = await fn(ctx) } catch (e) { error = e }
  for (let i = 0; i < pending.length; i++) await pending[i];
  current = null;
  return { counter, result, error };
}
export default { ...worker, async fetch(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/__t/queued') return Response.json(queued);
  if (url.pathname === '/__t/enqueue') { queued.push(await request.json()); return Response.json({ ok: true }) }
  if (url.pathname === '/__t/deliver' || url.pathname === '/__t/deliver-twice') {
    if (!queued.length) return Response.json({ empty: true });
    const body = queued.shift();
    // deliver-twice: at-least-once delivery handing the SAME message to two consumers at the same moment; both
    // start from the same job row, so only the in-batch cursor guard keeps the chunk from applying twice.
    const copies = url.pathname === '/__t/deliver-twice' ? 2 : 1;
    const outcomes = [];
    const { counter, error } = await counted(() => Promise.all(Array.from({ length: copies }, () => {
      const outcome = { acked: false, retried: false };
      outcomes.push(outcome);
      const message = { id: 'm', timestamp: new Date(), body, attempts: 1, ack() { outcome.acked = true }, retry() { outcome.retried = true } };
      return worker.queue({ queue: 'business-os-import', messages: [message], ackAll() { outcome.acked = true }, retryAll() { outcome.retried = true } }, wrap(env));
    })));
    if (outcomes.some((o) => o.retried)) queued.push(body);
    return Response.json({ calls: counter.calls, outcome: outcomes[0], outcomes, body, error: error ? String(error) : null });
  }
  const { counter, result, error } = await counted((ctx) => worker.fetch(request, wrap(env), ctx));
  if (error) return new Response(String(error && error.stack || error), { status: 599, headers: { 'x-calls': String(counter.calls) } });
  const headers = new Headers(result.headers);
  headers.set('x-calls', String(counter.calls));
  headers.set('x-bg-error', encodeURIComponent(counter.bgError || ''));
  return new Response(await result.arrayBuffer(), { status: result.status, headers });
} };
`

const telegram = []
async function migrateDir(db, dir) {
  const { unstable_splitSqlQuery: split } = require('wrangler')
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const sqls = split(fs.readFileSync(path.join(dir, name), 'utf8')).filter((s) => s.trim())
      .filter((sql) => !(name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())))
    try { await db.batch(sqls.map((sql) => db.prepare(sql))) } catch {
      for (const sql of sqls) { try { await db.prepare(sql).run() } catch (error) { throw new Error(`Migration ${name}: ${error.message}`) } }
    }
  }
}
async function boot() {
  const { build } = require('esbuild')
  const { Miniflare, Log, LogLevel } = require('miniflare')
  const mutation = MUTANT ? MUTANTS[MUTANT] : null
  const plugins = mutation ? [{ name: 'p12-mutant', setup: (b) => b.onLoad({ filter: /\.ts$/ }, (args) => {
    if (!args.path.replaceAll('\\', '/').endsWith(`/${mutation.file}`)) return undefined
    const text = fs.readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n')
    assert.equal(text.split(mutation.from).length - 1, 1, `mutant anchor must occur exactly once in ${mutation.file}: ${mutation.from.slice(0, 70)}`)
    return { contents: text.replace(mutation.from, () => mutation.to), loader: 'ts', resolveDir: path.dirname(args.path) }
  }) }] : []
  const out = await build({ stdin: { contents: WRAPPER, resolveDir: SRC, loader: 'ts' }, bundle: true, write: false, platform: 'browser', plugins,
    format: 'esm', target: 'es2022', conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'],
    nodePaths: [path.join(ROOT, 'node_modules')], logLevel: 'error',
    define: { __WORKER_BUILD_REVISION__: JSON.stringify('p12budget'), __WORKER_BUILD_HASH__: JSON.stringify('p12budgethash'), __WORKER_BUILT_AT__: JSON.stringify('2026-11-03T00:00:00Z') } })
  const mf = new Miniflare({ modules: true, script: out.outputFiles[0].text, compatibilityDate: '2026-07-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB', 'IMPORT_DB'], kvNamespaces: ['CACHE'], r2Buckets: ['ASSETS'],
    durableObjects: { BROADCAST_HUB: 'BroadcastHub', SYNC_UPLOADS: 'SyncUploadSession' },
    bindings: { PLAN_TIER: process.env.P12_TIER || 'free', BUSINESS_OS_LOCAL_DEV: '1', BUSINESS_OS_PUBLIC_URL: ORIGIN, BUSINESS_OS_ADMIN_URL: ORIGIN,
      BUSINESS_OS_ORGANIZATION_SLUG: 'leangbeauty', BUSINESS_OS_ADMIN_PASSWORD: ADMIN_PASSWORD, TELEGRAM_BOT_TOKEN: '123456:budget-token' },
    outboundService: async (request) => {
      const url = new URL(request.url)
      if (url.hostname !== 'api.telegram.org') return new Response('offline', { status: 503 })
      const body = await request.text()
      try { telegram.push(JSON.parse(body)) } catch { telegram.push({ text: body }) }
      return Response.json({ ok: true, result: { message_id: telegram.length, chat: { id: -100 } } })
    },
    log: new Log(LogLevel.NONE) })
  const db = await mf.getD1Database('DB')
  await migrateDir(db, path.join(ROOT, 'migrations'))
  await migrateDir(await mf.getD1Database('IMPORT_DB'), path.join(ROOT, 'migrations-import'))
  await mf.dispatchFetch(ORIGIN + '/api/settings')
  return { mf, db }
}

let world
const all = async (sql, ...bind) => (await world.db.prepare(sql).bind(...bind).all()).results
const one = async (sql, ...bind) => (await all(sql, ...bind))[0]
const run = (sql, ...bind) => world.db.prepare(sql).bind(...bind).run()
const permitted = async (fn) => {
  await run("INSERT INTO system_flags(key,value) VALUES('stock_transaction_permit','legacy-separate-pool-v1')")
  try { await fn() } finally { await run("DELETE FROM system_flags WHERE key='stock_transaction_permit'") }
}
let cookie = ''
async function api(method, route, body) {
  const response = await world.mf.dispatchFetch(ORIGIN + route, { method,
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin: ORIGIN, cookie },
    body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await response.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  return { status: response.status, calls: Number(response.headers.get('x-calls')), bgError: decodeURIComponent(response.headers.get('x-bg-error') || ''), json, text }
}
const t = async (route, init) => (await world.mf.dispatchFetch(ORIGIN + route, init)).json()

// ---- golden ----------------------------------------------------------------------------------------------------------------
const observed = {}
const golden = !CAPTURE && fs.existsSync(GOLDEN_FILE) ? JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8')) : null
const normalize = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'created_at' || key === 'updated_at' ? undefined : v)))
const parseJson = (text) => { try { return JSON.parse(text) } catch { return text } }
function matchGolden(key, value) {
  const normalized = normalize(value)
  observed[key] = normalized
  if (CAPTURE) return
  assert.ok(golden, `no golden at ${GOLDEN_FILE}: capture it from the base src tree (see the header)`)
  assert.ok(Object.prototype.hasOwnProperty.call(golden, key), `golden has no entry ${key}`)
  assert.deepEqual(normalized, golden[key], `${key} must be byte-for-byte what the base commit produced`)
}

let passed = 0
const failures = []
const FULL = !!process.env.P12_FULL
const measured = {}
async function check(name, fn) {
  if (process.env.P12_ONLY && !new RegExp(process.env.P12_ONLY).test(name)) return
  const started = Date.now()
  try { await fn(); passed++; console.log(`GREEN (${Math.round((Date.now() - started) / 1000)}s) ${name}`) } catch (error) { failures.push(name); console.log(`RED   ${name}\n      ${String(error && error.stack || error).split('\n').slice(0, FULL ? 70 : 5).join('\n      ')}`) }
}

// ---- fixture ---------------------------------------------------------------------------------------------------------------
// TP..: transfer parity, two lots in the source branch (A dated 09-01, B dated 09-15) plus untracked units on every 4th product;
//       branch 2 holds a lot C on even products and untracked units on odd ones, so the 2 -> 1 direction splits too.
// SP..: 100 products with one lot each and plenty of branch-1 stock, sold one unit a line.
// T60.: 60 products, one lot each. T200: 200 products with no lot at all.
const TP = 1000, SP = 1100, T60 = 1300, T200 = 1400
const seedOf = (j) => ({ a: 6 + (j % 4), b: 7 + (j % 3), u: j % 4 === 0 ? 3 : 0, c: j % 2 === 0 ? 5 + (j % 3) : 0, u2: j % 2 === 0 ? (j % 5 === 0 ? 2 : 0) : 4 })

async function ledgers(ids) {
  const list = ids.join(',')
  const key = (rows) => Object.fromEntries(rows.map((r) => [`${r.p}:${r.b}`, r.q]))
  return {
    bs: key(await all(`SELECT product_id p, branch_id b, quantity q FROM branch_stock WHERE product_id IN (${list})`)),
    lots: key(await all(`SELECT b.variant_product_id p, s.branch_id b, SUM(s.quantity) q FROM branch_batch_stock s JOIN product_batches b ON b.id=s.batch_id WHERE b.variant_product_id IN (${list}) GROUP BY 1,2 HAVING SUM(s.quantity) <> 0`)),
    // A zero row is the same as no row (an undo leaves the destination's lot row at 0), so zero rows are left out.
    lotRows: Object.fromEntries((await all(`SELECT s.batch_id l, s.branch_id b, s.quantity q FROM branch_batch_stock s JOIN product_batches b ON b.id=s.batch_id WHERE b.variant_product_id IN (${list}) AND s.quantity <> 0`)).map((r) => [`${r.l}:${r.b}`, r.q])),
    total: Object.fromEntries((await all(`SELECT id, stock_quantity q FROM products WHERE id IN (${list})`)).map((r) => [r.id, r.q])),
  }
}
const delta = (before, after, ledger, p, b) => (after[ledger][`${p}:${b}`] || 0) - (before[ledger][`${p}:${b}`] || 0)

async function transferState(ids) {
  const list = ids.join(',')
  return {
    branch_stock: await all(`SELECT product_id, branch_id, quantity FROM branch_stock WHERE product_id IN (${list}) ORDER BY product_id, branch_id`),
    branch_batch_stock: await all(`SELECT s.batch_id, s.branch_id, s.quantity, b.variant_product_id AS product_id FROM branch_batch_stock s JOIN product_batches b ON b.id=s.batch_id WHERE b.variant_product_id IN (${list}) ORDER BY s.batch_id, s.branch_id`),
    products: await all(`SELECT id, stock_quantity FROM products WHERE id IN (${list}) ORDER BY id`),
    stock_transfers: await all(`SELECT product_id, product_name, from_branch_id, to_branch_id, from_branch_name, to_branch_name, quantity, notes, user_id, user_name, member_ordinal, generation FROM stock_transfers WHERE product_id IN (${list}) ORDER BY id`),
    inventory_movements: await all(`SELECT product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_id, user_name, batch_id, unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr FROM inventory_movements WHERE product_id IN (${list}) AND movement_type LIKE 'transfer%' ORDER BY id`),
    members: (await all(`SELECT m.ordinal, m.source_product_id, m.destination_product_id, m.source_branch_id, m.destination_branch_id, m.quantity, m.untracked_quantity, m.source_snapshot, m.destination_snapshot, m.allocations_json FROM transfer_operation_members m WHERE m.source_product_id IN (${list}) ORDER BY m.receipt_id, m.ordinal`))
      .map((m) => ({ ...m, source_snapshot: parseJson(m.source_snapshot), destination_snapshot: parseJson(m.destination_snapshot), allocations_json: parseJson(m.allocations_json) })),
  }
}

async function seed(admin) {
  // The Worker seeds two branches without roles; the transfer routes need the canonical Shop and Warehouse (as the read-budget seed sets them).
  await run("UPDATE branches SET name='Shop',role='shop',canonical_key='shop',is_active=1,is_default=1 WHERE id=1")
  await run("UPDATE branches SET name='Warehouse',role='warehouse',canonical_key='warehouse',is_active=1,is_default=0 WHERE id=2")
  const branches = await all('SELECT id, name, role, is_active FROM branches ORDER BY id')
  assert.deepEqual(branches.slice(0, 2).map((b) => [b.id, b.name, b.role, b.is_active]), [[1, 'Shop', 'shop', 1], [2, 'Warehouse', 'warehouse', 1]])
  await run("INSERT INTO settings(key,value) VALUES('exchange_rate','4000'),('change_exchange_rate','4000'),('pos_payment_methods','[\"Cash\",\"ABA\"]'),('telegram_chat_id','-1001234'),('telegram_automation_enabled','true') ON CONFLICT(key) DO UPDATE SET value=excluded.value")
  await permitted(async () => {
    const product = (from, count, stock) => run(`WITH RECURSIVE n(j) AS (SELECT 0 UNION ALL SELECT j+1 FROM n WHERE j<${count - 1})
      INSERT INTO products(id,name,barcode,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active)
      SELECT ${from}+j,'Budget item '||(${from}+j),'885'||printf('%010d',${from}+j),'SKU-'||(${from}+j),${stock},5+j%7,(5+j%7)*4000,2,8000,1 FROM n`)
    await product(TP, 40, 0); await product(SP, 100, 0); await product(T60, 60, 0); await product(T200, 200, 0)
    // product_batches first, then branch_stock, then branch_batch_stock: the order the maintained fixtures use.
    const batches = [], stock = [], lotStock = []
    const lot = (id, product, key, received, qty, branch) => { batches.push([id, product, key, received]); lotStock.push([id, branch, qty]) }
    for (let j = 0; j < 40; j++) {
      const id = TP + j, s = seedOf(j)
      lot(id + 500000, id, `a-${id}`, '2026-09-01', s.a, 1); lot(id + 600000, id, `b-${id}`, '2026-09-15', s.b, 1)
      if (s.c) lot(id + 700000, id, `c-${id}`, '2026-08-20', s.c, 2)
      stock.push([id, s.a + s.b + s.u, s.c + s.u2])
    }
    for (let j = 0; j < 100; j++) { const id = SP + j; lot(id + 500000, id, `s-${id}`, '2026-09-01', 40 + j, 1); stock.push([id, 40 + j, 0]) }
    for (let j = 0; j < 60; j++) { const id = T60 + j; lot(id + 500000, id, `t-${id}`, '2026-09-01', 30 + (j % 7), 1); stock.push([id, 30 + (j % 7), 0]) }
    // Batched (80 statements a call): hundreds of awaited single inserts made the fixture slower than the checks.
    const insertAll = async (statements) => { for (let i = 0; i < statements.length; i += 80) await world.db.batch(statements.slice(i, i + 80)) }
    const prepared = (sql, ...bind) => world.db.prepare(sql).bind(...bind)
    await insertAll(batches.map(([id, product, key, received]) => prepared('INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,expiry_date,unit_cost_usd) VALUES(?,?,?,?,?,1,?,?,2)', id, product, key, key, received, 1, '2027-06-01')))
    await insertAll(stock.map(([id, q1, q2]) => prepared('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,?),(?,2,?)', id, q1, id, q2)))
    await run(`INSERT INTO branch_stock(product_id,branch_id,quantity) SELECT id,1,10 FROM products WHERE id>=${T200}`)
    await run(`INSERT INTO branch_stock(product_id,branch_id,quantity) SELECT id,2,0 FROM products WHERE id>=${T200}`)
    await insertAll(lotStock.map(([id, branch, qty]) => prepared('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)', id, branch, qty)))
    await run('UPDATE products SET stock_quantity=(SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id=products.id) WHERE id>=?', TP)
  })
  assert.ok(admin.id)
}

const transferBody = (from, to, key, items, reason = 'budget move') => ({ transfer_provenance_version: 1, fromBranchId: from, toBranchId: to, reason, client_request_id: key, items })

// Lines for products TP+offset ..: every shape of allocation (explicit lot, FIFO across lots, FIFO into the untracked part, one unit).
function parityLines(offset, count, direction) {
  return Array.from({ length: count }, (_, i) => {
    const j = offset + i, id = TP + j, s = seedOf(j)
    if (direction === 'shop-to-warehouse') {
      switch (i % 5) {
        case 0: return { productId: id, quantity: s.a + 2 }
        case 1: return { productId: id, quantity: 2, batchId: id + 600000 }
        case 2: return { productId: id, quantity: s.a, batchId: id + 500000 }
        case 3: return { productId: id, quantity: s.a + s.b + s.u }
        default: return { productId: id, quantity: 1 }
      }
    }
    return s.c ? { productId: id, quantity: i % 2 === 0 ? s.c : 1, ...(i % 2 === 0 ? { batchId: id + 700000 } : {}) } : { productId: id, quantity: 3 }
  })
}

async function main() {
  const bootStarted = Date.now()
  world = await boot()
  const admin = await one("SELECT id, organization_id FROM users WHERE username='admin'")
  const token = 'tok-budget-admin'
  await run("INSERT INTO user_sessions (user_id, token_hash, device_name, device_tz, expires_at, last_seen_at) VALUES (?, ?, 'Test', 'Asia/Phnom_Penh', '2099-01-01T00:00:00.000Z', datetime('now'))",
    admin.id, createHash('sha256').update(token).digest('hex'))
  cookie = `bos_session=${token}`
  await seed(admin)
  console.log(`boot+seed ${Math.round((Date.now() - bootStarted) / 1000)}s`)
  console.log(`world ready: tier=${process.env.P12_TIER || 'free'} call limit=${LIMIT} src=${path.relative(ROOT, SRC) || 'src'}${MUTANT ? ` MUTANT=${MUTANT}` : ''}${CAPTURE ? ' CAPTURE' : ''}`)

  // -- 1. transfer-bulk ------------------------------------------------------------------------------------------------------
  const scenarios = [
    { n: 1, offset: 0, from: 1, to: 2, direction: 'shop-to-warehouse' },
    { n: 5, offset: 10, from: 2, to: 1, direction: 'warehouse-to-shop' },
    { n: 20, offset: 20, from: 1, to: 2, direction: 'shop-to-warehouse' },
  ]
  const transferCalls = {}
  for (const sc of scenarios) {
    await check(`transfer-bulk ${sc.n} line(s) ${sc.from}->${sc.to} with split lots: same receipt, movements, lots and branch stock as the base commit; replay moves nothing; undo restores both ledgers`, async () => {
      const items = parityLines(sc.offset, sc.n, sc.direction)
      const ids = items.map((it) => it.productId)
      const before = await ledgers(ids)
      const key = `budget-parity-${sc.n}`
      const body = transferBody(sc.from, sc.to, key, items)
      telegram.length = 0
      const r = await api('POST', '/api/branches/transfer-bulk', body)
      assert.equal(r.status, 200, r.text.slice(0, 400))
      transferCalls[sc.n] = r.calls
      measured[`transfer-bulk ${sc.n}`] = r.calls
      assert.ok(r.calls <= LIMIT, `calls ${r.calls}`)
      assert.equal(r.bgError, '', 'background work must not fail')
      assert.equal(r.json.transferredCount, sc.n)
      assert.ok(r.json.action_history_id > 0 && r.json.replayed === false, JSON.stringify(r.json).slice(0, 200))
      const after = await ledgers(ids)
      // Independent arithmetic: both ledgers move by the requested quantity (lots only for the part a lot covers), the total is unchanged.
      items.forEach((it) => {
        assert.equal(delta(before, after, 'bs', it.productId, sc.from), -it.quantity, `branch_stock ${it.productId} source`)
        assert.equal(delta(before, after, 'bs', it.productId, sc.to), it.quantity, `branch_stock ${it.productId} destination`)
        assert.equal(after.total[it.productId], before.total[it.productId], `total ${it.productId}`)
        const lotMoved = delta(before, after, 'lots', it.productId, sc.to)
        assert.equal(delta(before, after, 'lots', it.productId, sc.from) + lotMoved, 0, `lots ${it.productId} move as a pair`)
        assert.ok(lotMoved >= 0 && lotMoved <= it.quantity, `lots ${it.productId}: ${lotMoved} of ${it.quantity}`)
      })
      // The Telegram notice carries each line's committed on-hand at both branches and in total (the first 20 lines are listed).
      const text = telegram.map((m) => String(m.text || '')).join('\n').replace(/\s+/g, ' ')
      assert.ok(/Stock transferred/.test(text), `Telegram transfer notice sent: ${text.slice(0, 200)}`)
      const name = (branch) => (branch === 1 ? 'Shop' : 'Warehouse')
      ids.slice(0, 20).forEach((id) => {
        const expect = `${name(sc.from)} ${after.bs[`${id}:${sc.from}`]} · ${name(sc.to)} ${after.bs[`${id}:${sc.to}`]} · all branches ${after.total[id]}`
        assert.ok(text.includes(expect), `on-hand for ${id}: ${expect}`)
      })
      const state = await transferState(ids)
      matchGolden(`transfer-${sc.n}`, { response: { ...r.json, operation_id: undefined, action_history_id: undefined }, state })
      // Double-apply: the same client_request_id replays the receipt and moves nothing.
      const replay = await api('POST', '/api/branches/transfer-bulk', body)
      assert.equal(replay.status, 200)
      assert.equal(replay.json.replayed, true)
      assert.deepEqual(await ledgers(ids), after)
      assert.deepEqual(await transferState(ids), state)
      // Reversal: undo replays the exact allocation back, both ledgers.
      const undo = await api('POST', `/api/action-history/${r.json.action_history_id}/undo`, { require_applied: true, expected_generation: 0 })
      assert.equal(undo.status, 200, undo.text.slice(0, 300))
      assert.ok(undo.calls <= LIMIT, `undo calls ${undo.calls}`)
      assert.deepEqual(await ledgers(ids), before)
      matchGolden(`transfer-${sc.n}-after-undo`, await transferState(ids))
    })
  }
  await check('transfer-bulk calls do not grow with the line count (1, 5 and 20 lines are within 2 calls of each other)', async () => {
    const counts = Object.values(transferCalls)
    assert.equal(counts.length, scenarios.length, 'every scenario ran')
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 2, `calls by line count: ${JSON.stringify(transferCalls)}`)
  })

  await check('transfer-bulk refusals are identical to the base commit: wrong-branch lot, negative quantity and 13 other bad requests change nothing', async () => {
    const id = (j) => TP + j
    const lotOnlyInWarehouse = id(30) + 700000   // lot C of product 30 holds stock in branch 2 only
    const cases = {
      'negative quantity': [{ productId: id(30), quantity: -1 }],
      'zero quantity': [{ productId: id(30), quantity: 0 }],
      'text quantity': [{ productId: id(30), quantity: 'abc' }],
      'lot held only in the other branch': [{ productId: id(30), quantity: 1, batchId: lotOnlyInWarehouse }],
      'lot of another product': [{ productId: id(30), quantity: 1, batchId: id(31) + 500000 }],
      'lot id that is not a number': [{ productId: id(30), quantity: 1, batchId: 'abc' }],
      'more than the lot holds': [{ productId: id(30), quantity: seedOf(30).b + 1, batchId: id(30) + 600000 }],
      'more than the branch holds': [{ productId: id(30), quantity: 9999 }],
      'unknown product': [{ productId: 999999, quantity: 1 }],
      'same product twice': [{ productId: id(30), quantity: 1 }, { productId: id(30), quantity: 1 }],
      'one good line and one short line': [{ productId: id(30), quantity: 1 }, { productId: id(31), quantity: 9999 }],
    }
    const ids = [id(30), id(31)]
    const before = await ledgers(ids)
    const refusals = {}
    let n = 0
    for (const [name, items] of Object.entries(cases)) {
      const r = await api('POST', '/api/branches/transfer-bulk', transferBody(1, 2, `budget-refuse-${++n}`, items))
      assert.ok(r.status >= 400 && r.status < 500, `${name}: expected a refusal, got ${r.status} ${r.text.slice(0, 200)}`)
      refusals[name] = { status: r.status, body: r.json }
    }
    const tooMany = await api('POST', '/api/branches/transfer-bulk', transferBody(1, 2, 'budget-refuse-many', Array.from({ length: 201 }, (_, i) => ({ productId: T200 + i, quantity: 1 }))))
    refusals['201 lines'] = { status: tooMany.status, body: tooMany.json }
    refusals['same branch'] = await (async () => { const r = await api('POST', '/api/branches/transfer-bulk', transferBody(1, 1, 'budget-refuse-same', [{ productId: id(30), quantity: 1 }])); return { status: r.status, body: r.json } })()
    refusals['no reason'] = await (async () => { const r = await api('POST', '/api/branches/transfer-bulk', transferBody(1, 2, 'budget-refuse-reason', [{ productId: id(30), quantity: 1 }], '')); return { status: r.status, body: r.json } })()
    refusals['unknown destination branch'] = await (async () => { const r = await api('POST', '/api/branches/transfer-bulk', transferBody(2, 99, 'budget-refuse-dir', [{ productId: id(30), quantity: 1 }])); return { status: r.status, body: r.json } })()
    assert.deepEqual(await ledgers(ids), before, 'a refused transfer moves nothing')
    assert.equal((await one("SELECT COUNT(*) n FROM transfer_operation_receipts WHERE request_id LIKE 'budget-refuse-%'")).n, 0, 'and writes no receipt')
    matchGolden('transfer-refusals', refusals)
  })

  await check('transfer-bulk 60 lines with lots and 200 lines without: inside the call limit, both ledgers move, undo restores', async () => {
    const lines60 = Array.from({ length: 60 }, (_, i) => ({ productId: T60 + i, quantity: 1 + (i % 3), batchId: T60 + i + 500000 }))
    const ids60 = lines60.map((l) => l.productId)
    const before60 = await ledgers(ids60)
    const r60 = await api('POST', '/api/branches/transfer-bulk', transferBody(1, 2, 'budget-transfer-60', lines60))
    assert.equal(r60.status, 200, r60.text.slice(0, 300))
    measured['transfer-bulk 60'] = r60.calls
    const after60 = await ledgers(ids60)
    lines60.forEach((l) => { for (const ledger of ['bs', 'lots']) { assert.equal(delta(before60, after60, ledger, l.productId, 1), -l.quantity); assert.equal(delta(before60, after60, ledger, l.productId, 2), l.quantity) } })
    const undo = await api('POST', `/api/action-history/${r60.json.action_history_id}/undo`, { require_applied: true, expected_generation: 0 })
    assert.equal(undo.status, 200, undo.text.slice(0, 300))
    assert.deepEqual(await ledgers(ids60), before60)
    const lines200 = Array.from({ length: 200 }, (_, i) => ({ productId: T200 + i, quantity: 1 }))
    const ids200 = lines200.map((l) => l.productId)
    const before200 = await ledgers(ids200)
    const r200 = await api('POST', '/api/branches/transfer-bulk', transferBody(1, 2, 'budget-transfer-200', lines200))
    assert.equal(r200.status, 200, r200.text.slice(0, 300))
    measured['transfer-bulk 200'] = r200.calls
    assert.ok(r200.calls - r60.calls <= 8, `200 lines cost ${r200.calls} calls, 60 lines ${r60.calls}`)
    const after200 = await ledgers(ids200)
    ids200.forEach((p) => { assert.equal(delta(before200, after200, 'bs', p, 1), -1); assert.equal(delta(before200, after200, 'bs', p, 2), 1) })
  })

  // -- 2. un-cancel ----------------------------------------------------------------------------------------------------------
  const ZERO_QUOTE = { gross_usd: 0, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 0, total_khr: 0 }
  const QUOTE_KEYS = Object.keys(ZERO_QUOTE)
  async function createSale(key, productIds) {
    const body = { branch_id: 1, money_precision_version: 1, sale_status: 'completed', exchange_rate: 4000, payment_currency: 'USD', client_request_id: key,
      offline_owner: { version: 1, actor_id: admin.id, organization_id: admin.organization_id ?? null, authority: ORIGIN, runtime: 'cloudflare-workers' },
      amount_paid_usd: 0, amount_paid_khr: 0,
      items: productIds.map((pid, i) => ({ product_id: pid, quantity: 1, branch_id: 1, batch_id: pid + 500000, client_line_key: `${key}-l${i}`, pricing_source: 'selling', pricing_quote: { ...ZERO_QUOTE } })) }
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await api('POST', '/api/sales', body)
      if (r.status < 300) return r.json.id || r.json.sale_id || r.json.sale.id
      if (r.status === 409 && r.json?.code === 'sale_pricing_quote_conflict') {
        const quotes = new Map(r.json.pricing_quotes.map((x) => [x.client_line_key, x]))
        for (const item of body.items) item.pricing_quote = Object.fromEntries(QUOTE_KEYS.map((q) => [q, quotes.get(item.client_line_key)[q]]))
        const total = body.items.reduce((s, it) => s + Number(it.pricing_quote.total_usd || 0), 0)
        Object.assign(body, { payment_details: [{ method: 'Cash', amount_usd: Math.ceil(total), amount_khr: 0 }], payment_method: 'Cash', amount_paid_usd: Math.ceil(total), amount_paid_khr: 0 })
      } else if (r.status === 409 && r.json?.code === 'sale_header_quote_conflict') body.expected_header_quote = r.json.header_quote
      else throw new Error(`createSale ${key}: ${r.status} ${r.text.slice(0, 300)}`)
    }
    throw new Error(`createSale ${key}: no accepted request after 5 attempts`)
  }
  const moveSeq = async () => (await one('SELECT COALESCE(MAX(id),0) m FROM inventory_movements')).m
  for (const lines of [45, 86]) {
    await check(`un-cancel a ${lines}-line sale: one stock read, the refusal names the short line, same ledgers/movements/allocations as the base commit, no double deduction, cancel reverses`, async () => {
      const ids = Array.from({ length: lines }, (_, i) => SP + i)
      const saleId = await createSale(`budget-sale-${lines}`, ids)
      const sold = await ledgers(ids)
      const mark = await moveSeq()
      const cancel = await api('PATCH', `/api/sales/${saleId}/status`, { sale_status: 'cancelled', client_request_id: `budget-cancel-${lines}-1`, cancel_reason: 'mistake', cancel_note: 'budget' })
      assert.equal(cancel.status, 200, cancel.text.slice(0, 300))
      measured[`cancel ${lines}`] = cancel.calls
      const cancelled = await ledgers(ids)
      for (const id of ids) assert.equal(delta(sold, cancelled, 'bs', id, 1), 1, `cancel restores ${id}`)
      // A line short of stock (not the first, not the last) must be the one the refusal names.
      const short = ids[Math.floor(lines / 2)]
      const shortName = (await one('SELECT name FROM products WHERE id=?', short)).name
      await permitted(async () => { await run('UPDATE branch_stock SET quantity=0 WHERE product_id=? AND branch_id=1', short) })
      const beforeRefusal = await ledgers(ids)
      const refused = await api('PATCH', `/api/sales/${saleId}/status`, { sale_status: 'completed', client_request_id: `budget-uncancel-${lines}-short`, expected_exchange_rate: 4000 })
      assert.equal(refused.status, 409, refused.text.slice(0, 300))
      assert.equal(refused.json.error, `Insufficient stock for ${shortName}: requested 1, available 0`)
      assert.deepEqual(await ledgers(ids), beforeRefusal, 'a refused un-cancel moves nothing')
      await permitted(async () => { await run('UPDATE branch_stock SET quantity=? WHERE product_id=? AND branch_id=1', cancelled.bs[`${short}:1`], short) })
      const restored = await api('PATCH', `/api/sales/${saleId}/status`, { sale_status: 'completed', client_request_id: `budget-uncancel-${lines}-1`, expected_exchange_rate: 4000 })
      assert.equal(restored.status, 200, restored.text.slice(0, 300))
      measured[`un-cancel ${lines}`] = restored.calls
      assert.ok(restored.calls <= LIMIT, `calls ${restored.calls}`)
      assert.equal(restored.bgError, '', 'background work must not fail')
      const completed = await ledgers(ids)
      for (const id of ids) for (const ledger of ['bs', 'lots']) assert.equal(delta(cancelled, completed, ledger, id, 1), -1, `un-cancel ${ledger} ${id}`)
      const outcome = {
        refusal: { status: refused.status, body: refused.json },
        sale: await one('SELECT sale_status, status_before_cancel, cancel_reason, cancel_note, cancel_fee_id FROM sales WHERE id=?', saleId),
        movements: await all(`SELECT product_id, branch_id, movement_type, quantity, reason, batch_id, unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reference_id FROM inventory_movements WHERE id>? AND reference_id=? ORDER BY id`, mark, String(saleId)),
        allocations: await all('SELECT a.sale_item_id, a.batch_id, a.quantity, a.released_quantity FROM sale_item_batch_allocations a JOIN sale_items i ON i.id=a.sale_item_id WHERE i.sale_id=? ORDER BY a.id', saleId),
        ledgers: completed,
      }
      assert.equal(outcome.movements.length, lines * 2, 'one movement per line for the cancel and one for the un-cancel')
      matchGolden(`uncancel-${lines}`, outcome)
      // Double-apply: the same request again, and a fresh request for the status it already has, deduct nothing more.
      await api('PATCH', `/api/sales/${saleId}/status`, { sale_status: 'completed', client_request_id: `budget-uncancel-${lines}-1`, expected_exchange_rate: 4000 })
      await api('PATCH', `/api/sales/${saleId}/status`, { sale_status: 'completed', client_request_id: `budget-uncancel-${lines}-2`, expected_exchange_rate: 4000 })
      assert.deepEqual(await ledgers(ids), completed)
      // Reversal: cancelling again gives every unit back.
      const again = await api('PATCH', `/api/sales/${saleId}/status`, { sale_status: 'cancelled', client_request_id: `budget-cancel-${lines}-2`, cancel_reason: 'mistake', cancel_note: 'budget' })
      assert.equal(again.status, 200, again.text.slice(0, 300))
      assert.deepEqual(await ledgers(ids), cancelled)
    })
  }
  await check('un-cancel calls do not grow with the line count (45 and 86 lines are within 3 calls)', async () => {
    assert.ok(measured['un-cancel 45'] && measured['un-cancel 86'], JSON.stringify(measured))
    assert.ok(Math.abs(measured['un-cancel 86'] - measured['un-cancel 45']) <= 3, `45 lines ${measured['un-cancel 45']}, 86 lines ${measured['un-cancel 86']}`)
  })

  // -- 3. payment-method impact and replace ------------------------------------------------------------------------------------
  await check('payment-method impact and linked replace over 12,000 sales inside the call limit, counts exact', async () => {
    // Ids straddle the 5,000-row page boundary; every third sale is ABA.
    await run(`WITH RECURSIVE n(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM n WHERE k<12000)
      INSERT INTO sales(id,receipt_number,cashier_id,cashier_name,branch_id,branch_name,payment_method,payment_details,exchange_rate,sale_status,created_at,updated_at,money_precision_version,total_usd,amount_paid_usd)
      SELECT 200000+k,'B'||k,${admin.id},'Admin',1,'Shop',CASE WHEN k%3=0 THEN 'ABA' ELSE 'Cash' END,
        json_array(json_object('method',CASE WHEN k%3=0 THEN 'ABA' ELSE 'Cash' END,'amount_usd',1,'amount_khr',0)),4000,'completed',datetime('now'),datetime('now'),0,1,1 FROM n`)
    const aba = (await one("SELECT COUNT(*) n FROM sales WHERE payment_method='ABA'")).n
    assert.ok(aba >= 4000)
    const impact = await api('GET', '/api/settings/payment-methods/impact?from=ABA&to=Wing')
    measured['payment-method impact'] = impact.calls
    assert.equal(impact.status, 200, impact.text.slice(0, 300))
    const replaced = await api('POST', '/api/settings/payment-methods/replace', { from: 'ABA', to: 'Wing', scope: 'linked', currentPassword: ADMIN_PASSWORD, expected_updated_at: impact.json?.settings_updated_at })
    measured['payment-method replace'] = replaced.calls
    assert.ok(impact.calls <= 15, `impact calls ${impact.calls}`)
    assert.equal(impact.json.live_snapshots.sales, aba)
    assert.equal(impact.json.live_snapshots.payment_detail_lines, aba)
    assert.equal(replaced.status, 200, replaced.text.slice(0, 300))
    assert.ok(replaced.calls <= 25, `replace calls ${replaced.calls}`)
    assert.equal(replaced.json.linkedSales, aba)
    assert.equal((await one("SELECT COUNT(*) n FROM sales WHERE payment_method='Wing'")).n, aba)
    assert.equal((await one("SELECT COUNT(*) n FROM sales WHERE payment_method='ABA' OR payment_details LIKE '%\"ABA\"%'")).n, 0)
    // Same sales, same result when the scan reads them in any order of pages: every Cash sale is untouched.
    assert.equal((await one("SELECT COUNT(*) n FROM sales WHERE id>200000 AND payment_method='Cash'")).n, 12000 - aba)
  })

  // -- 4. contacts bulk delete -------------------------------------------------------------------------------------------------
  const deliverAll = async (max = 40) => {
    const deliveries = []
    for (let i = 0; i < max; i++) {
      const d = await t('/__t/deliver')
      if (d.empty) break
      deliveries.push(d)
    }
    return deliveries
  }
  await run(`WITH RECURSIVE n(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM n WHERE k<1400)
    INSERT INTO customers(id,name,phone,phone_normalized) SELECT 10000+k,'Budget customer '||k,'0'||(20000000+k),'0'||(20000000+k) FROM n`)
  const customerAudits = async (lo, hi) => one(`SELECT COUNT(*) n, COUNT(DISTINCT entity_id) d FROM audit_logs WHERE entity='customer' AND action='delete' AND CAST(entity_id AS INTEGER) BETWEEN ${lo} AND ${hi}`)
  await check('customers bulk delete of 1,000: one bounded chunk per delivery, exact audit, a duplicate delivery applies the chunk once, redelivery is a no-op', async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => 10001 + i)
    const created = await api('POST', '/api/customers/bulk-delete-jobs', { reason: 'budget', ids })
    assert.equal(created.status, 202, created.text.slice(0, 300))
    const first = await t('/__t/queued')
    const raced = await t('/__t/deliver-twice')
    assert.deepEqual(raced.outcomes, [{ acked: true, retried: false }, { acked: true, retried: false }], JSON.stringify(raced).slice(0, 300))
    assert.equal((await one('SELECT processed_count FROM bulk_delete_jobs WHERE id=?', created.json.jobId)).processed_count, freeLimits.bulkDeleteChunkSize)
    assert.deepEqual(await customerAudits(10001, 11000), { n: freeLimits.bulkDeleteChunkSize, d: freeLimits.bulkDeleteChunkSize })
    const deliveries = await deliverAll()
    assert.ok(deliveries.length >= Math.ceil(1000 / freeLimits.bulkDeleteChunkSize) - 1, `deliveries ${deliveries.length}`)
    for (const d of deliveries) {
      assert.equal(d.outcome.acked, true, JSON.stringify(d).slice(0, 300))
      assert.ok(d.calls <= 10, `delivery calls ${d.calls}`)
    }
    measured['bulk delete delivery (max)'] = Math.max(...deliveries.map((d) => d.calls))
    assert.deepEqual(await one('SELECT status, processed_count, failed_count FROM bulk_delete_jobs WHERE id=?', created.json.jobId), { status: 'completed', processed_count: 1000, failed_count: 0 })
    assert.equal((await one('SELECT COUNT(*) n FROM customers WHERE id BETWEEN 10001 AND 11000')).n, 0)
    assert.deepEqual(await customerAudits(10001, 11000), { n: 1000, d: 1000 })
    await t('/__t/enqueue', { method: 'POST', body: JSON.stringify(first[0]) })
    await deliverAll()
    assert.deepEqual(await customerAudits(10001, 11000), { n: 1000, d: 1000 })
  })
  await check('customers bulk delete cancelled after one chunk keeps exactly that chunk and its audit', async () => {
    const ids = Array.from({ length: 400 }, (_, i) => 11001 + i)
    const created = await api('POST', '/api/customers/bulk-delete-jobs', { reason: 'budget cancel', ids })
    assert.equal(created.status, 202)
    const firstDelivery = await t('/__t/deliver')
    assert.equal(firstDelivery.outcome.acked, true)
    const progressed = await one('SELECT processed_count FROM bulk_delete_jobs WHERE id=?', created.json.jobId)
    assert.ok(progressed.processed_count > 0 && progressed.processed_count < 400, JSON.stringify(progressed))
    const cancel = await api('POST', `/api/customers/bulk-delete-jobs/${created.json.jobId}/cancel`)
    assert.equal(cancel.status, 200)
    await deliverAll()
    const job = await one('SELECT status, processed_count FROM bulk_delete_jobs WHERE id=?', created.json.jobId)
    assert.equal(job.status, 'cancelled')
    assert.equal(job.processed_count, progressed.processed_count)
    const deleted = 400 - (await one('SELECT COUNT(*) n FROM customers WHERE id BETWEEN 11001 AND 11400')).n
    assert.equal(deleted, progressed.processed_count)
    assert.deepEqual(await customerAudits(11001, 11400), { n: deleted, d: deleted })
  })

  await world.mf.dispose()
  console.log(`MEASURED ${JSON.stringify(measured)}`)
  if (CAPTURE) {
    fs.writeFileSync(GOLDEN_FILE, '{\n' + Object.entries(observed).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n}\n')
    console.log(`golden written: ${GOLDEN_FILE} (${Object.keys(observed).length} entries)`)
  }
  console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? ': ' + failures.join('; ') : ''}`)
  if (failures.length) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exit(1) })
