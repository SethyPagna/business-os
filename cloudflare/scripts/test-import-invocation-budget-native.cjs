// A historical sales import must keep every queue invocation inside the per-invocation D1 call budget (1000 on Paid,
// 50 on Free), and a job cut into many invocations must leave exactly the data an uncut run leaves.
//
// The real Worker (src/index.ts, bundled with esbuild) runs under Miniflare with the production queue topology: an
// IMPORT_QUEUE producer, the business-os-import consumer (max_batch_size 1, max_retries 5) and the separate IMPORT_DB
// staging database. A wrapper in front of the Worker records, for every fetch() and every queue() invocation, how many
// Cloudflare-service calls it made: one per D1 first/all/run/raw, ONE per db.batch() (the binding sends one fetch per
// batch), plus KV, R2, queue-send and Durable Object calls. Those are the numbers the platform limits.
//
// Before the fix a 600-receipt Paid job applied in ONE invocation of ~4,400 calls and a Free job in one of ~1,000. The
// mutant world rewrites the engine in memory so the sales loop is not budgeted; it is both the discriminating control
// (the per-invocation assertion must go red there) and the uncut reference the cut runs are compared with.
//
// Heavy: several Miniflare worlds and ~1,500 receipts. Run alone, serially:
//   NATIVE_TEST_TIMEOUT_MS=1500000 node scripts/test-import-invocation-budget-native.cjs
//   BUDGET_FULL=0 skips the 600-receipt cases (300 at most).
//   BUDGET_CASES=sameday runs only the same-moment receipt numbering case ('sameday,budget' is the default).
//   BUDGET_MUTANT=none runs the "uncut" world on the unmodified engine: against an engine without the budget the test
//   goes red at the first budgeted assertion, which is how the pre-fix tree is checked.
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const root = path.resolve(__dirname, '..')
const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const FULL = process.env.BUDGET_FULL !== '0'
const LIMIT = { paid: 1000, free: 50 }
const CASES = new Set((process.env.BUDGET_CASES || 'sameday,budget').split(','))
const UNCUT_MUTANT = process.env.BUDGET_MUTANT === 'none' ? null : 'no-sales-budget'

const MUTANTS = {
  'no-sales-budget': {
    find: "Object.assign(callBudget, { unit: 'call', enabled: true, reserve: SALES_APPLY_TAIL_RESERVE })",
    replace: "Object.assign(callBudget, { unit: 'call', enabled: false, reserve: 0 })",
  },
}

const WRAPPER = `
import worker from './src/index'
export { SyncUploadSession, BroadcastHub } from './src/index'

const control = { invocations: [], fault: null }
function blank() { return { calls: 0, statements: 0, batches: 0, maxBatch: 0 } }
function newCounter() { return { db: blank(), idb: blank(), kv: 0, r2: 0, qsend: 0, dobj: 0 } }

function wrapDb(db, c) {
  const statement = (inner, sql) => ({
    sql, inner,
    bind: (...args) => statement(inner.bind(...args), sql),
    first: async (...a) => { c.calls++; c.statements++; return inner.first(...a) },
    all: async (...a) => { c.calls++; c.statements++; return inner.all(...a) },
    run: async (...a) => { c.calls++; c.statements++; return inner.run(...a) },
    raw: async (...a) => { c.calls++; c.statements++; return inner.raw(...a) },
  })
  return {
    prepare: (sql) => statement(db.prepare(sql), sql),
    batch: async (statements) => {
      c.calls++; c.batches++; c.statements += statements.length
      c.maxBatch = Math.max(c.maxBatch, statements.length)
      const results = await db.batch(statements.map(s => s.inner))
      const fault = control.fault
      if (fault && statements.some(s => /INSERT INTO sales \\(/.test(s.sql))) {
        fault.seen++
        if (fault.seen === fault.at) { fault.fired++; throw new Error('Network connection lost') }
      }
      return results
    },
    exec: (q) => { c.calls++; return db.exec(q) },
  }
}
function wrapMethods(target, names, bump) {
  if (!target) return target
  const out = Object.create(target)
  for (const name of names) if (typeof target[name] === 'function') out[name] = (...a) => { bump(); return target[name](...a) }
  return out
}
function wrapDoNamespace(ns, counter) {
  if (!ns) return ns
  const out = Object.create(ns)
  for (const k of ['idFromName', 'idFromString', 'newUniqueId']) if (typeof ns[k] === 'function') out[k] = (...a) => ns[k](...a)
  out.get = (...a) => {
    const stub = ns.get(...a)
    return new Proxy(stub, { get(t, p) { const v = Reflect.get(t, p, t); if (typeof v !== 'function') return v; return (...args) => { counter.dobj++; return v.apply(t, args) } } })
  }
  return out
}
function instrument(rawEnv, ctx, counter) {
  const pending = []
  const env = { ...rawEnv }
  env.DB = wrapDb(rawEnv.DB, counter.db)
  if (rawEnv.IMPORT_DB) env.IMPORT_DB = wrapDb(rawEnv.IMPORT_DB, counter.idb)
  env.CACHE = wrapMethods(rawEnv.CACHE, ['get', 'getWithMetadata', 'put', 'delete', 'list'], () => counter.kv++)
  env.ASSETS = wrapMethods(rawEnv.ASSETS, ['get', 'put', 'head', 'delete', 'list', 'createMultipartUpload', 'resumeMultipartUpload'], () => counter.r2++)
  if (rawEnv.IMPORT_QUEUE) env.IMPORT_QUEUE = wrapMethods(rawEnv.IMPORT_QUEUE, ['send', 'sendBatch'], () => counter.qsend++)
  env.BROADCAST_HUB = wrapDoNamespace(rawEnv.BROADCAST_HUB, counter)
  const ctx2 = { waitUntil(p) { pending.push(Promise.resolve(p).catch(() => {})); try { ctx.waitUntil(p) } catch (e) {} }, passThroughOnException() {} }
  return { env, ctx2, pending }
}
async function drain(pending) {
  for (let i = 0; i < 20; i++) { const before = pending.length; await Promise.allSettled(pending.slice()); if (pending.length === before) break }
}
function record(entry) { control.invocations.push(entry); if (control.invocations.length > 20000) control.invocations.shift() }

async function handle(request, rawEnv, ctx) {
  const url = new URL(request.url)
  if (url.pathname === '/__al/invocations') { const out = control.invocations; if (url.searchParams.get('clear')) control.invocations = []; return Response.json(out) }
  if (url.pathname === '/__al/fault') {
    const at = Number(url.searchParams.get('at'))
    control.fault = at ? { at, seen: 0, fired: 0 } : null
    return Response.json({ armed: control.fault })
  }
  if (url.pathname === '/__al/fault-state') return Response.json(control.fault)
  const counter = newCounter()
  const { env, ctx2, pending } = instrument(rawEnv, ctx, counter)
  let status = 0
  try {
    const response = await worker.fetch(request, env, ctx2)
    status = response.status
    if (response.webSocket) return response
    await drain(pending)
    return response
  } finally {
    if (!url.pathname.endsWith('/ws')) record({ type: 'fetch', method: request.method, path: url.pathname, status, ...counter })
  }
}

export default {
  fetch: (request, env, ctx) => handle(request, env, ctx),
  async queue(batch, rawEnv, ctx) {
    const counter = newCounter()
    const { env, ctx2, pending } = instrument(rawEnv, ctx, counter)
    let error = null
    try { return await worker.queue(batch, env, ctx2) } catch (e) { error = String(e && e.message || e); throw e } finally {
      await drain(pending)
      record({ type: 'queue', messages: batch.messages.map(m => ({ kind: m.body.kind, attempts: m.attempts })), error, ...counter })
    }
  },
}
`

async function bundle(mutant) {
  const { build } = require('esbuild')
  const plugins = []
  if (mutant) {
    const { find, replace } = MUTANTS[mutant]
    plugins.push({
      name: 'mutant', setup(b) {
        b.onLoad({ filter: /[\\/]importEngine\.ts$/ }, (args) => {
          const text = fs.readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n')
          assert.equal(text.split(find).length - 1, 1, `mutant ${mutant} must match exactly once -- the engine changed, update the mutant`)
          return { contents: text.replace(find, replace), loader: 'ts' }
        })
      },
    })
  }
  const result = await build({
    stdin: { contents: WRAPPER, resolveDir: root, loader: 'ts', sourcefile: 'budget-wrapper.ts' },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], logLevel: 'error', plugins,
  })
  return result.outputFiles[0].text
}

async function migrate(db, dirName) {
  const { unstable_splitSqlQuery: split } = require('wrangler')
  const dir = path.join(root, dirName)
  const statements = []
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    for (const statement of split(fs.readFileSync(path.join(dir, name), 'utf8')).filter((s) => s.trim())) {
      // Miniflare's test D1 caps compound SELECT terms lower than the deployed runner; this seed is a no-op here.
      if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
      statements.push({ name, statement })
    }
  }
  for (let i = 0; i < statements.length; i += 100) {
    const chunk = statements.slice(i, i + 100)
    try { await db.batch(chunk.map((x) => db.prepare(x.statement))) } catch (error) { error.message = `${chunk[0].name}+: ${error.message}`; throw error }
  }
}

const LC = 1
const SHOP = 2

async function world({ plan, mutant }) {
  const { Miniflare, Log, LogLevel } = require('miniflare')
  const mf = new Miniflare({
    modules: true, script: await bundle(mutant), compatibilityDate: '2026-07-01', compatibilityFlags: ['nodejs_compat', 'no_handle_cross_request_promise_resolution'],
    d1Databases: ['DB', 'IMPORT_DB'], kvNamespaces: ['CACHE'], r2Buckets: ['ASSETS'],
    queueProducers: { IMPORT_QUEUE: { queueName: 'business-os-import' } },
    queueConsumers: { 'business-os-import': { maxBatchSize: 1, maxBatchTimeout: 0, maxRetries: 5, retryDelay: 0 } },
    durableObjects: { BROADCAST_HUB: 'BroadcastHub', SYNC_UPLOADS: 'SyncUploadSession' },
    bindings: {
      PLAN_TIER: plan, BUSINESS_OS_PUBLIC_URL: 'https://leangbeauty.com', BUSINESS_OS_ADMIN_URL: 'https://admin.leangbeauty.com',
      BUSINESS_OS_ADMIN_PASSWORD: 'budget-test-admin-password-1', BUSINESS_OS_ORGANIZATION_SLUG: 'leangbeauty',
    },
    log: new Log(LogLevel.ERROR),
  })
  const db = await mf.getD1Database('DB')
  const idb = await mf.getD1Database('IMPORT_DB')
  await migrate(db, 'migrations')
  await migrate(idb, 'migrations-import')
  await mf.dispatchFetch('http://localhost/api/settings')
  await db.prepare("UPDATE branches SET name='Shop',role='shop',canonical_key='shop',is_active=1,is_default=1,successor_branch_id=NULL WHERE id=?").bind(SHOP).run()
  await db.prepare("UPDATE branches SET name='LC Store',role='warehouse',canonical_key='warehouse',is_default=0,is_active=1 WHERE id=?").bind(LC).run()
  const token = `tok-admin-${sha256('admin').slice(0, 8)}`
  await db.prepare(`INSERT INTO user_sessions(user_id,token_hash,device_name,device_tz,expires_at,last_seen_at)
    VALUES(1,?,?,?,'2099-01-01T00:00:00.000Z',datetime('now','-1 seconds'))`).bind(sha256(token), 'Owner Laptop', 'Asia/Phnom_Penh').run()

  const H = { mf, db, idb, plan, nextProduct: 10000 }
  H.api = async (method, route, body) => {
    const response = await mf.dispatchFetch(`http://localhost${route}`, {
      method, headers: { 'content-type': 'application/json', cookie: `bos_session=${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    let json
    try { json = JSON.parse(text) } catch { json = text }
    return { status: response.status, body: json }
  }
  H.upload = async (route, name, content) => {
    const form = new FormData()
    form.set('file', new File([content], name, { type: 'text/csv' }))
    const encoded = new Request('http://encode.local/', { method: 'POST', body: form })
    const response = await mf.dispatchFetch(`http://localhost${route}`, {
      method: 'POST', headers: { cookie: `bos_session=${token}`, 'content-type': encoded.headers.get('content-type') },
      body: Buffer.from(await encoded.arrayBuffer()),
    })
    return { status: response.status, body: await response.json().catch(() => null) }
  }
  H.invocations = async (clear) => (await mf.dispatchFetch(`http://localhost/__al/invocations${clear ? '?clear=1' : ''}`)).json()
  H.fault = async (at) => (await mf.dispatchFetch(`http://localhost/__al/fault?at=${at}`)).json()
  H.faultState = async () => (await mf.dispatchFetch('http://localhost/__al/fault-state')).json()
  H.q = async (sql, ...bind) => (await db.prepare(sql).bind(...bind).all()).results
  H.q1 = async (sql, ...bind) => db.prepare(sql).bind(...bind).first()
  H.dispose = () => mf.dispose()
  return H
}

// n products at LC Store, each with two received-date lots (bulk insert, not through the Worker).
async function seedProducts(H, n, { lots = 2, perLot = 50, cost = 2 } = {}) {
  const out = []
  const stmts = []
  for (let i = 0; i < n; i++) {
    const p = ++H.nextProduct
    const name = `Budget Probe ${p}`
    const barcode = `8870${String(p).padStart(9, '0')}`
    const total = lots * perLot
    stmts.push(H.db.prepare('INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,stock_quantity,is_active) VALUES(?,?,?,?,0,10,40000,?,1)').bind(p, name, barcode, cost, total))
    stmts.push(H.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').bind(p, LC, total))
    for (let l = 0; l < lots; l++) {
      const key = `BL${p}-${l + 1}`
      stmts.push(H.db.prepare('INSERT INTO product_batches(variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) VALUES(?,?,?,?,?,?,1)')
        .bind(p, key, key, `2026-08-${String(l + 1).padStart(2, '0')}`, l + 1, cost))
      stmts.push(H.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) SELECT id,?,? FROM product_batches WHERE variant_product_id=? AND batch_key=?').bind(LC, perLot, p, key))
    }
    out.push({ p, name, barcode })
  }
  for (let i = 0; i < stmts.length; i += 500) await H.db.batch(stmts.slice(i, i + 500))
  return out
}

const csvOf = (header, rows) => `${header.join(',')}\n${rows.map((r) => r.join(',')).join('\n')}\n`
const clock = (i, day) => `2026-07-${String(day).padStart(2, '0')} ${String(8 + Math.floor(i / 3600)).padStart(2, '0')}:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`

// One line per receipt, a distinct second each; every fifth receipt is a whole-line return, so the stock a run leaves
// behind (a return restocks) is part of what two runs must agree on. Each scenario of a world gets its own day, so a
// later job never collides with the receipt numbers of an earlier one; two worlds running the same scenarios in the
// same order get the same days.
async function receiptsScenario(H, n) {
  const ps = await seedProducts(H, n)
  const day = (H.day = (H.day || 0) + 1)
  return {
    type: 'sales', policy: { source: 'budget' }, products: ps,
    csv: csvOf(['receipt_number', 'sale_date', 'branch', 'barcode', 'name', 'quantity', 'unit_price_usd', 'payment_method', 'sale_status'],
      ps.map((p, i) => [`BUD-${i}`, clock(i, day), 'Shop', p.barcode, p.name, '1', '10', 'cash', i % 5 === 4 ? 'returned' : 'completed'])),
  }
}

// One receipt with 100 lines (the writer's safety limit).
async function bigReceiptScenario(H) {
  const ps = await seedProducts(H, 100)
  return {
    type: 'sales', policy: { source: 'budget' }, products: ps,
    csv: csvOf(['receipt_number', 'sale_date', 'branch', 'barcode', 'name', 'quantity', 'unit_price_usd', 'payment_method'],
      ps.map((p) => ['BUD-BIG', '2026-09-01 09:00:00', 'Shop', p.barcode, p.name, '1', '10', 'cash'])),
  }
}

// Every receipt carries a date-only sale date, so all of them mint their number from the same second (00:00:00).
async function sameMomentScenario(H, n) {
  const ps = await seedProducts(H, n)
  const day = (H.day = (H.day || 0) + 1)
  return {
    type: 'sales', policy: { source: 'budget' }, products: ps, stamp: `202607${String(day).padStart(2, '0')}-000000`,
    csv: csvOf(['receipt_number', 'sale_date', 'branch', 'barcode', 'name', 'quantity', 'unit_price_usd', 'payment_method'],
      ps.map((p, i) => [`SAME-${i}`, `2026-07-${String(day).padStart(2, '0')}`, 'Shop', p.barcode, p.name, '1', '10', 'cash'])),
  }
}

async function stockAddScenario(H, n) {
  const ps = await seedProducts(H, n)
  return {
    type: 'inventory', policy: { source: 'budget', inventory_action: 'add' }, products: ps,
    csv: csvOf(['date', 'branch', 'name', 'sku', 'barcode', 'quantity', 'reason', 'unit_cost_usd'], ps.map((p) => ['', 'LC Store', p.name, '', p.barcode, '2', 'Budget add', '3'])),
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(H, id, wanted, timeoutMs) {
  const t0 = Date.now()
  let job
  while (Date.now() - t0 < timeoutMs) {
    job = (await H.api('GET', `/api/import-jobs/${id}`)).body?.job
    if (job && wanted.includes(job.status)) return job
    // A transient error marks the job failed until the queue redelivers the message (retryDelay 0) and resumes it:
    // only a status that is still failed after the redelivery had time to start is final.
    if (job && ['failed', 'cancelled'].includes(job.status)) {
      await sleep(3000)
      const again = (await H.api('GET', `/api/import-jobs/${id}`)).body?.job
      if (again && again.status === job.status) return again
      continue
    }
    await sleep(150)
  }
  return job
}

const sub = (inv) => inv.db.calls + inv.idb.calls + inv.kv + inv.r2 + inv.qsend + inv.dobj
async function runJob(H, spec, label) {
  await H.invocations(true)
  const created = await H.api('POST', '/api/import-jobs', { type: spec.type, policy: spec.policy })
  assert.equal(created.status, 200, `${label}: create job ${JSON.stringify(created.body).slice(0, 300)}`)
  const id = created.body.job.id
  const up = await H.upload(`/api/import-jobs/${id}/csv`, `${label}.csv`, spec.csv)
  assert.ok(up.status < 300, `${label}: upload ${up.status}`)
  assert.ok((await H.api('POST', `/api/import-jobs/${id}/start`)).status < 300, `${label}: start`)
  let job = await waitFor(H, id, ['awaiting_review'], 900000)
  assert.equal(job.status, 'awaiting_review', `${label}: analyze ended ${job.status}: ${job.last_error}`)
  const analyze = (await H.invocations(true)).filter((inv) => inv.type === 'queue')
  const approved = await H.api('POST', `/api/import-jobs/${id}/approve`, {})
  assert.ok(approved.status < 300, `${label}: approve ${approved.status} ${JSON.stringify(approved.body).slice(0, 300)}`)
  job = await waitFor(H, id, ['completed', 'completed_with_errors', 'partially_completed'], 1500000)
  await sleep(300)
  const applyAll = await H.invocations(true)
  const apply = applyAll.filter((inv) => inv.type === 'queue' && inv.messages.some((m) => m.kind === 'apply'))
  const approve = applyAll.find((inv) => inv.type === 'fetch' && /\/approve$/.test(inv.path))
  return { id, label, job, analyze, apply, approve, maxSub: Math.max(0, ...apply.map(sub)), maxAnalyzeSub: Math.max(0, ...analyze.map(sub)) }
}

// Everything a sales job leaves behind, with the job id taken out so two worlds can be compared.
async function snapshot(H, run, products) {
  const prefix = `sales-import:${run.id}:`
  const sales = await H.q(`SELECT CAST(substr(client_request_id, ?) AS INTEGER) AS row, receipt_number, sale_status, total_usd, created_at, branch_id,
      stock_skipped, (SELECT COUNT(*) FROM sale_items WHERE sale_id=s.id) AS items FROM sales s
    WHERE instr(client_request_id, ?) = 1 ORDER BY row`, prefix.length + 1, prefix)
  const seals = await H.q('SELECT status, COUNT(*) AS n FROM import_sales_commits WHERE job_id=? GROUP BY status', run.id)
  const ids = products.map((p) => p.p)
  const stock = await H.q(`SELECT p.id AS product_id, p.stock_quantity, COALESCE(bs.quantity, 0) AS branch_quantity
    FROM products p LEFT JOIN branch_stock bs ON bs.product_id=p.id AND bs.branch_id=? WHERE p.id BETWEEN ? AND ? ORDER BY p.id`, LC, Math.min(...ids), Math.max(...ids))
  const shopStock = await H.q('SELECT product_id, quantity FROM branch_stock WHERE branch_id=? AND product_id BETWEEN ? AND ? ORDER BY product_id', SHOP, Math.min(...ids), Math.max(...ids))
  const movements = await H.q("SELECT movement_type, COUNT(*) AS n, SUM(quantity) AS q FROM inventory_movements WHERE product_id BETWEEN ? AND ? GROUP BY movement_type ORDER BY movement_type", Math.min(...ids), Math.max(...ids))
  return { sales, seals, stock, shopStock, movements }
}

function assertWithin(run, plan, what) {
  const limit = LIMIT[plan]
  const over = run.apply.filter((inv) => sub(inv) > limit)
  assert.equal(over.length, 0, `${what}: ${over.length} of ${run.apply.length} apply invocation(s) over ${limit} calls (worst ${run.maxSub})`)
}

function assertCompleted(run, receipts) {
  assert.equal(run.job.status, 'completed', `${run.label}: ${run.job.status} -- ${run.job.last_error}`)
  assert.equal(Number(run.job.processed_rows), receipts, `${run.label}: processed_rows`)
}

async function assertExactlyOnce(H, run, receipts) {
  const row = await H.q1("SELECT COUNT(*) AS sales, COUNT(DISTINCT client_request_id) AS requests, COUNT(DISTINCT receipt_number) AS numbers FROM sales WHERE instr(client_request_id, ?) = 1", `sales-import:${run.id}:`)
  assert.deepEqual({ ...row }, { sales: receipts, requests: receipts, numbers: receipts }, `${run.label}: one sale per receipt, each with its own number`)
  const seals = await H.q("SELECT status, COUNT(*) AS n FROM import_sales_commits WHERE job_id=? GROUP BY status", run.id)
  assert.deepEqual(seals.map((s) => ({ ...s })), [{ status: 'applied', n: receipts }], `${run.label}: every receipt sealed applied`)
}

async function main() {
  const report = []
  const note = (line) => { report.push(line); console.log(line) }
  const worlds = []
  const open = async (options) => { const H = await world(options); worlds.push(H); return H }
  try {
    if (CASES.has('sameday')) {
      // 30 receipts of one moment commit 12 at a time. Probing for "the first free number" gave all twelve the same answer
      // and the job failed with "Sale on row N lost its receipt number ... to another sale saved at the same moment".
      const sameDay = await open({ plan: 'paid' })
      const SAME = 30
      const spec = await sameMomentScenario(sameDay, SAME)
      const run = await runJob(sameDay, spec, 'paid-same-moment-30')
      assertCompleted(run, SAME)
      await assertExactlyOnce(sameDay, run, SAME)
      const numbers = (await snapshot(sameDay, run, spec.products)).sales.map((sale) => sale.receipt_number)
      assert.deepEqual(numbers, Array.from({ length: SAME }, (_, i) => (i === 0 ? spec.stamp : `${spec.stamp}-${i + 1}`)), 'receipts of one moment are numbered in file order, bare then -2, -3, ...')
      note(`Paid ${SAME} receipts of one moment: ${run.apply.length} apply invocation(s), numbered ${numbers[0]} .. ${numbers.at(-1)} in file order`)
      await sameDay.dispose()
      worlds.splice(worlds.indexOf(sameDay), 1)
    }
    if (!CASES.has('budget')) {
      console.log('PASS receipts of one sale moment are numbered distinctly and in file order')
      return
    }

    const SMALL = 150
    const MID = 300
    const BIG = FULL ? 600 : MID

    // ---- The mutant: no budget. The control that must go red, and the uncut reference. ----------------------------
    const mutantWorld = await open({ plan: 'paid', mutant: UNCUT_MUTANT })
    const uncutSmallSpec = await receiptsScenario(mutantWorld, SMALL)
    const uncutSmall = await runJob(mutantWorld, uncutSmallSpec, 'uncut-paid-150')
    assertCompleted(uncutSmall, SMALL)
    await assertExactlyOnce(mutantWorld, uncutSmall, SMALL)
    const uncutSmallData = await snapshot(mutantWorld, uncutSmall, uncutSmallSpec.products)
    const uncutMidSpec = await receiptsScenario(mutantWorld, MID)
    const uncutMid = await runJob(mutantWorld, uncutMidSpec, 'uncut-paid-300')
    assertCompleted(uncutMid, MID)
    await assertExactlyOnce(mutantWorld, uncutMid, MID)
    const uncutMidData = await snapshot(mutantWorld, uncutMid, uncutMidSpec.products)
    assert.equal(uncutMid.apply.length, 1, 'without the budget the whole window is applied in one invocation')
    assert.ok(uncutMid.maxSub > LIMIT.paid, `control: the unbudgeted ${MID}-receipt invocation must exceed ${LIMIT.paid} calls (made ${uncutMid.maxSub})`)
    note(`control (mutant, no budget): ${SMALL} receipts in 1 invocation of ${uncutSmall.maxSub} calls, ${MID} receipts in 1 invocation of ${uncutMid.maxSub} -- over the ${LIMIT.paid} limit, as the test requires`)
    await mutantWorld.dispose()
    worlds.splice(worlds.indexOf(mutantWorld), 1)

    // ---- Paid ------------------------------------------------------------------------------------------------------
    const paid = await open({ plan: 'paid' })
    const paidSmallSpec = await receiptsScenario(paid, SMALL)
    const paidSmall = await runJob(paid, paidSmallSpec, 'paid-150')
    assertCompleted(paidSmall, SMALL)
    assertWithin(paidSmall, 'paid', `Paid ${SMALL} receipts`)
    await assertExactlyOnce(paid, paidSmall, SMALL)
    assert.deepEqual(await snapshot(paid, paidSmall, paidSmallSpec.products), uncutSmallData)
    note(`Paid ${SMALL} receipts: ${paidSmall.apply.length} apply invocation(s), worst ${paidSmall.maxSub} of ${LIMIT.paid} calls`)

    const paidMidSpec = await receiptsScenario(paid, MID)
    const paidMid = await runJob(paid, paidMidSpec, 'paid-300')
    assertCompleted(paidMid, MID)
    assertWithin(paidMid, 'paid', `Paid ${MID} receipts`)
    assert.ok(paidMid.apply.length > 1, `${MID} receipts no longer fit one invocation`)
    await assertExactlyOnce(paid, paidMid, MID)
    assert.deepEqual(await snapshot(paid, paidMid, paidMidSpec.products), uncutMidData, 'a job cut into invocations leaves exactly the data of the uncut run (sales, seals, stock, movements)')
    assert.ok(paidMid.approve && sub(paidMid.approve) <= 20, 'approve only enqueues')
    note(`Paid ${MID} receipts: ${paidMid.apply.length} apply invocations, worst ${paidMid.maxSub} of ${LIMIT.paid} calls; data identical to the uncut run`)

    // Replay: one receipt's batch commits, then the acknowledgement is lost and the queue redelivers the message.
    const faultSpec = await receiptsScenario(paid, MID)
    await paid.fault(137)
    const faulted = await runJob(paid, faultSpec, 'paid-300-ack-loss')
    const fired = (await paid.faultState()).fired
    await paid.fault(0)
    assert.equal(fired, 1, 'the ack-loss fault fired exactly once')
    assertCompleted(faulted, MID)
    assert.ok(faulted.apply.some((inv) => inv.messages.some((m) => m.attempts >= 2)), 'the message was redelivered')
    assertWithin(faulted, 'paid', `Paid ${MID} receipts with an ack loss and redelivery`)
    await assertExactlyOnce(paid, faulted, MID)
    const faultData = await snapshot(paid, faulted, faultSpec.products)
    const withoutDay = (data) => data.sales.map((s) => [s.row - data.sales[0].row, s.receipt_number.replace(/^\d{8}/, ''), s.total_usd, s.items, s.sale_status])
    assert.deepEqual(withoutDay(faultData), withoutDay(uncutMidData))
    assert.deepEqual(faultData.movements, uncutMidData.movements, 'the replay did not restock a return twice')
    assert.deepEqual(faultData.stock.map((s) => [s.stock_quantity, s.branch_quantity]), uncutMidData.stock.map((s) => [s.stock_quantity, s.branch_quantity]), 'no double stock effect after the redelivery')
    assert.deepEqual(faultData.shopStock.map((s) => s.quantity), uncutMidData.shopStock.map((s) => s.quantity))
    note(`Paid ${MID} receipts, ack lost after receipt 137 and redelivered: ${faulted.apply.length} apply invocations, worst ${faulted.maxSub}; one sale per receipt, stock identical`)

    if (FULL) {
      const bigSpec = await receiptsScenario(paid, BIG)
      const paidBig = await runJob(paid, bigSpec, 'paid-600')
      assertCompleted(paidBig, BIG)
      assertWithin(paidBig, 'paid', `Paid ${BIG} receipts`)
      await assertExactlyOnce(paid, paidBig, BIG)
      note(`Paid ${BIG} receipts: ${paidBig.apply.length} apply invocations, worst ${paidBig.maxSub} of ${LIMIT.paid} calls`)
    }

    const big = await runJob(paid, await bigReceiptScenario(paid), 'paid-100-line-receipt')
    assertCompleted(big, 1)
    assertWithin(big, 'paid', 'one 100-line receipt')
    assert.equal(Number((await paid.q1('SELECT COUNT(*) AS n FROM sale_items WHERE sale_id=(SELECT id FROM sales WHERE instr(client_request_id, ?) = 1)', `sales-import:${big.id}:`)).n), 100)
    note(`Paid one 100-line receipt: ${big.apply.length} apply invocation of ${big.maxSub} calls`)

    // Plateau pin: a stock Add writes in 300-statement batches, so its calls stay far below the limit at any size.
    const stock = await runJob(paid, await stockAddScenario(paid, SMALL), 'paid-stock-add-150')
    assert.equal(stock.job.status, 'completed', stock.job.last_error)
    assert.ok(stock.maxSub <= 100, `a ${SMALL}-row stock Add made ${stock.maxSub} calls in one invocation (batching regressed?)`)
    note(`Paid ${SMALL}-row stock Add: ${stock.apply.length} apply invocation(s), worst ${stock.maxSub} calls (pin <= 100)`)
    await paid.dispose()
    worlds.splice(worlds.indexOf(paid), 1)

    // ---- Free ------------------------------------------------------------------------------------------------------
    const free = await open({ plan: 'free' })
    const freeSpec = await receiptsScenario(free, SMALL)
    const free150 = await runJob(free, freeSpec, 'free-150')
    assertCompleted(free150, SMALL)
    assertWithin(free150, 'free', `Free ${SMALL} receipts`)
    await assertExactlyOnce(free, free150, SMALL)
    assert.deepEqual(await snapshot(free, free150, freeSpec.products), uncutSmallData, 'the Free run (many tiny invocations) leaves the data of the uncut run')
    note(`Free ${SMALL} receipts: ${free150.apply.length} apply invocations, worst ${free150.maxSub} of ${LIMIT.free} calls; data identical to the uncut run`)
    if (FULL) {
      const freeBigSpec = await receiptsScenario(free, BIG)
      const freeBig = await runJob(free, freeBigSpec, 'free-600')
      assertCompleted(freeBig, BIG)
      assertWithin(freeBig, 'free', `Free ${BIG} receipts`)
      await assertExactlyOnce(free, freeBig, BIG)
      note(`Free ${BIG} receipts: ${freeBig.apply.length} apply invocations, worst ${freeBig.maxSub} of ${LIMIT.free} calls`)
    }
    console.log('PASS sales imports number same-moment receipts, stay inside the per-invocation call budget on Paid and Free, resume exactly, and the unbudgeted control is red')
  } finally {
    for (const H of worlds) await H.dispose().catch(() => {})
  }
}

main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1) })
