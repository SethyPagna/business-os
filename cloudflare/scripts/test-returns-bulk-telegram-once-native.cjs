// A grouped Returns status change is announced to Telegram exactly ONCE per
// write, even when a retry with the same client_request_id overtakes a slow
// original (R-telegram E1, 27 Sep 2026).
//
// The app's own retry does exactly this: Returns.tsx keeps the pending bulk
// request and re-sends the SAME client_request_id after a 15 s client timeout
// or a dropped connection, while the first request may still be running.
// Before the fix the route decided "replayed?" with its own read BEFORE the
// write, and the kernel handed an overtaken original the winner's stored
// receipt (early replay, or the catch path after its batch lost) with its
// changedIds and no replay marker -- one write, two "Return cancelled"
// messages in the shop's group.
//
// Real routes/returns.ts + lib/returnBulkAction.ts + lib/telegram.ts over the
// fully migrated schema in Miniflare's in-memory D1. Only auth and broadcast
// are stubbed. fetch to api.telegram.org is intercepted INSIDE the worker and
// recorded; nothing leaves the machine, and the chat id is made up.
//
// Forced interleaving: the kernel's own replay read (SELECT request_json,
// receipt_json FROM return_bulk_operations) is delayed for request ids with a
// test prefix, the FIRST time per id only, in two ways:
//   slowread-: read now, stall 1500 ms, return what was read -> the original
//              saw "no previous", builds, and its batch loses to the retry's
//              committed write (the kernel's catch path);
//   slowwait-: stall 1500 ms, then read -> the original finds the retry's
//              stored receipt (the kernel's early-replay path).
// Each mode has a lone-request positive control (a delay alone still sends
// exactly one message), so a fix that simply stopped announcing is red too.
//
// Run (from cloudflare/): node scripts/test-returns-bulk-telegram-once-native.cjs
const path = require('node:path')
const fs = require('node:fs')
const assert = require('node:assert/strict')
const root = path.join(__dirname, '..')
const { build } = require(path.join(root, 'node_modules', 'esbuild'))
const { Miniflare, Log, LogLevel } = require(path.join(root, 'node_modules', 'miniflare'))
const { unstable_splitSqlQuery: split } = require(path.join(root, 'node_modules', 'wrangler'))

const slash = (value) => String(value).split(String.fromCharCode(92)).join('/')

async function pricingKernel() {
  const bundle = await build({ stdin: { contents: "export * from './src/lib/saleItemPricing'", resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' })
  const mod = { exports: {} }
  new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports)
  return mod.exports
}

const ENTRY = [
  "import { Hono } from 'hono'; import returns from './src/routes/returns';",
  'const calls = [];',
  'globalThis.fetch = async (input, init) => {',
  "  const url = String(typeof input === 'string' ? input : input.url);",
  "  if (url.startsWith('https://api.telegram.org/')) {",
  "    let body = null; try { body = JSON.parse((init && init.body) || 'null') } catch (e) {}",
  "    calls.push({ method: url.split('/').pop(), body });",
  "    return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length } }), { status: 200, headers: { 'content-type': 'application/json' } });",
  '  }',
  "  return new Response('blocked by test', { status: 599 });",
  '};',
  "const app = new Hono(); app.route('/api/returns', returns);",
  "app.get('/test/calls', c => c.json(calls));",
  "app.post('/test/calls/reset', c => { calls.length = 0; return c.json({ ok: true }) });",
  'export default app;',
].join('\n')

const SRC_DB = JSON.stringify(slash(path.join(root, 'src', 'lib', 'db.ts')))
const FIXTURES = {
  auth: "export const requireAuth=async(c,next)=>{const raw=c.req.header('x-test-permissions');if(!raw)return c.json({error:'Unauthorized'},401);if(!c.get('user'))c.set('user',{id:7,username:'fixture',name:'Fixture',role_code:'admin',permissions:raw});return next()}",
  broadcastHub: 'export const broadcast=async()=>{}',
  // lib/returnBulkAction.ts's own getDb, with its replay read delayed (see the
  // header). Every other statement is the real adapter, untouched.
  slowdb: [
    `export * from ${SRC_DB};`,
    `import { getDb as realGetDb } from ${SRC_DB};`,
    'const seen = new Set();',
    'const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));',
    'const wrapStmt = (s) => new Proxy(s, { get(t, p) {',
    '  if (p !== "get") { const v = t[p]; return typeof v === "function" ? v.bind(t) : v }',
    '  return async (params) => {',
    '    const key = String((params && params.request) || "");',
    '    const first = !seen.has(key); seen.add(key);',
    '    if (first && key.startsWith("slowwait-")) { await sleep(1500); return t.get(params) }',
    '    const row = await t.get(params);',
    '    if (first && key.startsWith("slowread-")) await sleep(1500);',
    '    return row } } });',
    'export function getDb(env) { const db = realGetDb(env); return new Proxy(db, { get(t, p) {',
    '  if (p !== "prepare") { const v = t[p]; return typeof v === "function" ? v.bind(t) : v }',
    '  return (sql) => { const s = t.prepare(sql); return /SELECT request_json,receipt_json FROM return_bulk_operations/.test(String(sql)) ? wrapStmt(s) : s } } }) }',
  ].join('\n'),
}

async function workerBundle() {
  return build({ stdin: { contents: ENTRY, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    plugins: [{ name: 'returns-telegram-once-fixtures', setup(b) {
      b.onResolve({ filter: /^\.\/db$/ }, (args) => (slash(args.importer).endsWith('src/lib/returnBulkAction.ts') ? { path: 'slowdb', namespace: 'test-fixture' } : undefined))
      b.onResolve({ filter: /(?:lib\/auth|durable-objects\/broadcastHub)$/ }, (args) => ({ path: args.path.split('/').pop(), namespace: 'test-fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'test-fixture' }, (args) => ({ contents: FIXTURES[args.path], loader: 'ts', resolveDir: root }))
    } }],
  })
}

async function migrate(db) {
  const dir = path.join(root, 'migrations')
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()) {
    for (const statement of split(fs.readFileSync(path.join(dir, name), 'utf8'))) {
      if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
      try { await db.prepare(statement).run() } catch (error) { error.message = `${name}: ${error.message}`; throw error }
    }
  }
}

async function main() {
  const [kernel, bundle] = await Promise.all([pricingKernel(), workerBundle()])
  // The fixture must actually be wired, or every delay below is a no-op and
  // the test would pass while observing nothing.
  assert.match(bundle.outputFiles[0].text, /slowread-/, 'the delayed replay read is bundled into the kernel')
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'], kvNamespaces: ['CACHE'],
    bindings: { TELEGRAM_BOT_TOKEN: 'test-token-not-real' }, compatibilityDate: '2026-08-01', log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    await migrate(db)
    await db.batch([
      db.prepare("INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)"),
      db.prepare("INSERT INTO products(id,name,is_active,stock_quantity) VALUES(1,'Probe A',1,0)"),
      db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,0)'),
    ])
    for (const [key, value] of Object.entries({ telegram_chat_id: '-1001111111111', telegram_language: 'both', telegram_topic_returns: '42' })) {
      await db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)').bind(key, value).run()
    }

    // One completed sale with one line of 3, priced through the real kernel.
    const unitPrice = 5
    const amount = unitPrice * 3
    const lineKey = 'sale-1-line-1'
    const pool = { version: 1, pool_key: 'once-pool-1', evaluation_time: '2026-09-13T00:00:00.000Z', exchange_rate: 4000, rules: [],
      lines: [{ line_key: lineKey, source: 'selling', product: { id: 1, selling_price_usd: unitPrice, selling_price_khr: unitPrice * 4000,
        wholesale_price_usd: null, discount_enabled: false, discount_amount_usd: 0, discount_amount_khr: 0, discount_percent: 0 },
      selling_price_input_usd: null, manual: { type: 'none', value: 0 } }] }
    const allocation = { version: 1, lines: [{ line_key: lineKey, amount }], discount_usd: 0, membership_discount_usd: 0, tax_usd: 0 }
    const row = kernel.materializeCapturedPricingRow({ id: 1, product_id: 1 }, pool, { [lineKey]: 3 }, lineKey, allocation)
    await db.batch([
      db.prepare("INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,discount_usd,membership_discount_usd,tax_usd,calculated_total_usd,rounding_adjustment_usd,total_usd,money_precision_version,sale_status,customer_name) VALUES(1,'ONCE-SALE-1',1,'Shop',4000,?,0,0,0,?,0,?,1,'completed','Dara')").bind(amount, amount, amount),
      db.prepare('INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,total_usd,total_khr,base_price_usd,base_price_khr,applied_price_usd,applied_price_khr,product_discount_usd,product_discount_khr,product_discount_type,product_discount_label,manual_discount_usd,manual_discount_khr,manual_discount_type,manual_discount_value,price_mode,pricing_snapshot_json) VALUES(1,1,1,?,3,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(
        'Line 1', row.total_usd, row.total_khr, row.base_price_usd, row.base_price_khr, row.applied_price_usd, row.applied_price_khr,
        row.product_discount_usd, row.product_discount_khr, row.product_discount_type, row.product_discount_label,
        row.manual_discount_usd, row.manual_discount_khr, row.manual_discount_type, row.manual_discount_value, row.price_mode, row.pricing_snapshot_json),
    ])

    const headers = { 'content-type': 'application/json', 'x-test-permissions': JSON.stringify({ all: true }) }
    const call = async (url, body, method = 'POST') => {
      const response = await mf.dispatchFetch(`http://local${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
      const text = await response.text()
      let parsed; try { parsed = JSON.parse(text) } catch { parsed = { raw: text } }
      return { status: response.status, body: parsed }
    }
    // waitUntil work finishes after the response; wait until the recorded
    // call count stops moving before counting.
    const settle = async () => {
      let last = -1
      for (let i = 0; i < 40; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 150))
        const n = (await call('/test/calls', undefined, 'GET')).body.length
        if (n === last && i > 3) break
        last = n
      }
    }
    const sends = async () => { await settle(); return (await call('/test/calls', undefined, 'GET')).body.filter((entry) => entry.method === 'sendMessage') }
    const reset = () => call('/test/calls/reset', {})
    const heads = (list) => list.map((entry) => `${entry.body.message_thread_id ?? 'GENERAL'} ${String(entry.body.text).split('\n')[0]}`)
    const statusOf = async (id) => (await db.prepare('SELECT status FROM returns WHERE id=?').bind(id).first()).status
    const opsFor = async (key) => (await db.prepare('SELECT COUNT(1) AS n FROM return_bulk_operations WHERE request_id=?').bind(key).first()).n
    const bulkBody = async (key, id, source, target) => {
      const current = await db.prepare('SELECT id,status,return_type,updated_at FROM returns WHERE id=?').bind(id).first()
      return { client_request_id: key, field: 'status', source, target,
        items: [{ id, expected_status: String(current.status || 'completed'), expected_method: String(current.return_type || 'restock'), expected_updated_at: current.updated_at ?? null }] }
    }

    // A customer return to cancel and restore.
    const quoted = await call('/api/returns/quote', { sale_id: 1, items: [{ sale_item_id: 1, quantity: 1 }] })
    assert.equal(quoted.status, 200, JSON.stringify(quoted.body))
    const { customer_return_create_version: _c, customer_return_edit_version: _e, ...expectedQuote } = quoted.body
    const created = await call('/api/returns', { client_request_id: 'once-create-1', money_precision_version: 1, sale_id: 1, reason: 'Once',
      expected_quote: expectedQuote, items: [{ sale_item_id: 1, product_id: 1, quantity: 1, stock_action: 'none', branch_id: 1 }] })
    assert.equal(created.status, 200, JSON.stringify(created.body))
    const id = Number(created.body.id)
    let checks = 0
    const HEAD = { cancelled: '42 🚫 Return cancelled/បានបោះបង់ការប្រគល់មកវិញ', completed: '42 ♻️ Return restored/បានស្ដារការប្រគល់មកវិញ' }

    for (const mode of ['slowread', 'slowwait']) {
      // Positive control: the delay alone, no duplicate -> one write, one message.
      await reset()
      const loneFrom = await statusOf(id)
      const loneTo = loneFrom === 'completed' ? 'cancelled' : 'completed'
      const lone = await call('/api/returns/bulk', await bulkBody(`${mode}-alone`, id, loneFrom, loneTo))
      assert.equal(lone.status, 200, JSON.stringify(lone.body))
      assert.deepEqual(lone.body.changedIds, [id])
      assert.deepEqual(heads(await sends()), [HEAD[loneTo]], `${mode} control: a slow request on its own is announced once`)
      checks += 1
      console.log(`PASS ${mode} control: one slow request alone -> 1 write, 1 message (${HEAD[loneTo]})`)

      // The overtake: the original stalls at the kernel's replay read; the
      // app's retry (same body, same client_request_id) arrives 300 ms later
      // and commits first.
      await reset()
      const from = await statusOf(id)
      const to = from === 'completed' ? 'cancelled' : 'completed'
      const key = `${mode}-dup`
      const body = await bulkBody(key, id, from, to)
      const first = call('/api/returns/bulk', body)
      await new Promise((resolve) => setTimeout(resolve, 300))
      const retry = await call('/api/returns/bulk', body)
      const original = await first
      assert.equal(retry.status, 200, JSON.stringify(retry.body))
      assert.equal(original.status, 200, `the overtaken original still answers with the stored receipt: ${JSON.stringify(original.body)}`)
      assert.deepEqual(original.body.changedIds, [id], 'the original gets the same receipt as the retry')
      assert.equal(original.body.operationId, retry.body.operationId, 'one operation, one receipt')
      assert.equal(await opsFor(key), 1, 'one write')
      assert.equal(await statusOf(id), to)
      const announced = heads(await sends())
      assert.deepEqual(announced, [HEAD[to]], `${mode}: one write must be announced exactly once, got ${announced.length}:\n${announced.join('\n')}`)
      checks += 1
      console.log(`PASS ${mode} overtake: original + overtaking retry -> 1 write, 1 message (${HEAD[to]})`)

      // A later sequential retry of the same id replays and announces nothing.
      await reset()
      const again = await call('/api/returns/bulk', body)
      assert.equal(again.status, 200, JSON.stringify(again.body))
      assert.equal(again.body.operationId, retry.body.operationId)
      assert.deepEqual(await sends(), [], `${mode}: a sequential retry replays silently`)
      checks += 1
      console.log(`PASS ${mode} sequential retry: replayed receipt, 0 messages`)
    }
    console.log(`test-returns-bulk-telegram-once-native: ${checks} checks ok (Telegram intercepted in the worker; nothing sent)`)
  } finally {
    await mf.dispose()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
