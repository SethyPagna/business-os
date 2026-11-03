const productStockGuard = require('./harness/product_stock_guard.cjs')
// Owner (25 Sep 2026): each Telegram message family can be routed to its own
// forum topic via message_thread_id. Settings keys are plain rows in the
// existing generic `settings` table -- no migration. This pins:
//   1. parseTelegramTopicId: integer string -> number; empty/blank -> undefined;
//      non-digit, negative, zero, decimal -> undefined (rejected, not coerced).
//   2. getTelegramConfig reads all eight topic keys into config.topics.
//   3. postTelegram includes message_thread_id in the POST body only when a
//      topic is configured; it is entirely ABSENT from the body otherwise
//      (not just falsy -- Telegram rejects a null/0 thread id on non-forum
//      chats, so the key must not be sent at all).
//   4. sendTelegramEvent routes each event type to its own configured topic:
//      sales -> telegram_topic_sales, status -> telegram_topic_status,
//      fees -> telegram_topic_expenses, stock_in/stock_out -> telegram_topic_stock.
//   5. sendTelegramTest -> telegram_topic_alerts, sendTelegramTodaySummary ->
//      telegram_topic_reports, sendTelegramShiftReport -> telegram_topic_shift,
//      deliverTelegramShiftOverview -> telegram_topic_reports, else
//      telegram_topic_shift (owner, 29 Sep 2026).
//   6. handleTelegramWebhook replies echo the INCOMING message_thread_id
//      (a direct reply in the same thread the command was typed from), not a
//      configured push topic.
//   7. Nothing is sent to a real chat: every fetch in this file is a local
//      stub that only records the request.
//
// Run (from cloudflare/): node scripts/test-telegram-topics-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const Database = require('better-sqlite3')

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './productStockGuard') return productStockGuard
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))
  } finally { Module._load = originalLoad }
  return moduleObj.exports
}

const businessDateWindow = loadReal('lib/businessDateWindow.ts')
const telegramLang = loadReal('lib/telegramLang.ts')
const moneyPrecision = loadReal('lib/moneyPrecision.ts')
const reportMoneyPrecision = loadReal('lib/reportMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const promotionRules = loadReal('lib/promotionRules.ts', { './moneyPrecision': moneyPrecision })
const saleItemPricing = loadReal('lib/saleItemPricing.ts', { './moneyPrecision': moneyPrecision, './promotionRules': promotionRules })
const saleMoneyPrecision = loadReal('lib/saleMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const refundMoneyPrecision = loadReal('lib/refundMoneyPrecision.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const customerReturnEntitlement = loadReal('lib/customerReturnEntitlement.ts', { './moneyPrecision': moneyPrecision, './refundMoneyPrecision': refundMoneyPrecision, './saleItemPricing': saleItemPricing, './saleMoneyPrecision': saleMoneyPrecision })
const analyticsPrecision = { './saleMoneyPrecision': saleMoneyPrecision, './reportMoneyPrecision': reportMoneyPrecision, './customerReturnEntitlement': customerReturnEntitlement, './refundMoneyPrecision': refundMoneyPrecision }
const saleTotals = loadReal('lib/saleTotals.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const financialPrecision = loadReal('lib/financialPrecision.ts')
const nativeSaleChange = loadReal('lib/nativeSaleChange.ts', { './financialPrecision': financialPrecision, './saleTotals': saleTotals })
const schemaProbeReal = loadReal('lib/schemaProbe.ts')
// A single mutable holder: every module below that reads `./db` delegates to
// it, so one wireTelegram() call can point salesAnalytics, shiftReconciliation
// AND telegram.ts's own settings reads at the SAME per-test database.
const dbHolder = { current: { getDb: () => { throw new Error('no DB in this test') } } }
const dbProxy = { getDb: (env) => dbHolder.current.getDb(env) }
const salesAnalytics = loadReal('lib/salesAnalytics.ts', { './schemaProbe': schemaProbeReal, './db': dbProxy, './removalLosses': loadReal('lib/removalLosses.ts'), './businessDateWindow': businessDateWindow, ...analyticsPrecision })
const lowStockRule = loadReal('lib/lowStockSettings.ts', { './db': dbProxy })
const lowStockStub = { ...lowStockRule, loadLowStockConfig: async () => lowStockRule.DEFAULT_LOW_STOCK_CONFIG }
const shiftReconciliation = loadReal('lib/shiftReconciliation.ts', { './db': dbProxy, './salesAnalytics': salesAnalytics, './nativeSaleChange': nativeSaleChange, './paymentMethodRegistry': loadReal('lib/paymentMethodRegistry.ts') })

// A minimal real SQLite db: empty sales/fees/inventory tables so dayStats and
// getSalesTotals run their real SQL (COALESCE handles the zero rows) plus a
// settings table seeded per-test, exactly like the shipped `settings` table.
function makeDb(settingsRows) {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE sales (id INTEGER PRIMARY KEY, created_at TEXT, sale_status TEXT, receipt_number TEXT,
      subtotal_usd REAL, discount_usd REAL, membership_discount_usd REAL, tax_usd REAL, total_usd REAL, total_khr REAL,
      delivery_fee_usd REAL, delivery_fee_paid_by TEXT, is_delivery INTEGER, delivery_actual_cost_usd REAL, delivery_actual_cost_khr REAL,
      delivery_contact_id INTEGER, delivery_contact_name TEXT, branch_id INTEGER, branch_name TEXT,
      customer_id INTEGER, customer_name TEXT, customer_phone TEXT, cashier_id INTEGER, cashier_name TEXT,
      payment_method TEXT, amount_paid_usd REAL, source_return_id INTEGER);
    CREATE TABLE sale_items (id INTEGER PRIMARY KEY, sale_id INTEGER, quantity REAL, cost_price_usd REAL,
      total_usd REAL, branch_id INTEGER, product_id INTEGER, product_name TEXT, applied_price_usd REAL, applied_price_khr REAL,
      product_discount_usd REAL DEFAULT 0, manual_discount_usd REAL DEFAULT 0);
    CREATE TABLE returns (id INTEGER PRIMARY KEY, sale_id INTEGER, total_refund_usd REAL, total_refund_khr REAL,
      status TEXT, return_scope TEXT, created_at TEXT, branch_id INTEGER, supplier_compensation_usd REAL, supplier_loss_usd REAL, reason TEXT);
    CREATE TABLE return_items (id INTEGER PRIMARY KEY, return_id INTEGER, quantity REAL, cost_price_usd REAL, return_to_stock INTEGER, stock_action TEXT);
    CREATE TABLE fees (id INTEGER PRIMARY KEY, fee_type TEXT, label TEXT, amount_usd REAL, amount_khr REAL,
      fee_date TEXT, sale_id INTEGER, branch_id INTEGER, delivery_contact_id INTEGER, created_by INTEGER, created_at TEXT);
    CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY, movement_type TEXT, quantity REAL, reference_id TEXT, created_at TEXT);
    CREATE TABLE delivery_contacts (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, phone TEXT, gender TEXT, is_anonymous INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, barcode TEXT, category TEXT, stock_quantity REAL,
      is_active INTEGER NOT NULL DEFAULT 1, low_stock_threshold REAL, out_of_stock_threshold REAL DEFAULT 0);
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE branch_stock (id INTEGER PRIMARY KEY, product_id INTEGER, branch_id INTEGER, quantity REAL);
  `)
  const insertSetting = sqlite.prepare('INSERT INTO settings (key, value) VALUES (@key, @value)')
  for (const row of settingsRows) insertSetting.run(row)
  const translate = (sql, params = {}) => {
    const values = []
    return { sql: sql.replace(/@(\w+)/g, (_m, key) => { values.push(params[key] ?? null); return '?' }), values }
  }
  return {
    prepare(sql) {
      return {
        async get(params) { const q = translate(sql, params); return sqlite.prepare(q.sql).get(...q.values) },
        async all(params) {
          if (Array.isArray(params)) return sqlite.prepare(sql).all(...params)
          const q = translate(sql, params); return sqlite.prepare(q.sql).all(...q.values)
        },
        async run(params) { const q = translate(sql, params); return sqlite.prepare(q.sql).run(...q.values) },
      }
    },
  }
}

function wireTelegram(settingsRows) {
  const singleDb = makeDb(settingsRows) // one instance: every getDb() call in this test shares it
  dbHolder.current = { getDb: () => singleDb }
  return loadReal('lib/telegram.ts', { './lowStockSettings': lowStockStub, './db': dbProxy, './businessDateWindow': businessDateWindow, './telegramLang': telegramLang, './salesAnalytics': salesAnalytics, './saleTotals': saleTotals, './nativeSaleChange': nativeSaleChange, './shiftReconciliation': shiftReconciliation })
}

const baseSettings = [
  { key: 'telegram_chat_id', value: '-100999' },
  { key: 'telegram_language', value: 'both' },
  { key: 'telegram_topic_shift', value: '11' },
  { key: 'telegram_topic_sales', value: '22' },
  { key: 'telegram_topic_status', value: '33' },
  { key: 'telegram_topic_expenses', value: '44' },
  { key: 'telegram_topic_stock', value: '55' },
  { key: 'telegram_topic_reports', value: '66' },
  { key: 'telegram_topic_alerts', value: '77' },
]

;(async () => {
  // ---- 1. parseTelegramTopicId is a defensive integer-or-empty parse -------
  const bare = loadReal('lib/telegram.ts', { './lowStockSettings': lowStockStub, './db': { getDb: () => { throw new Error('no DB in this test') } }, './businessDateWindow': businessDateWindow, './telegramLang': telegramLang, './salesAnalytics': salesAnalytics, './saleTotals': saleTotals, './nativeSaleChange': nativeSaleChange, './shiftReconciliation': shiftReconciliation })
  assert.equal(bare.parseTelegramTopicId('42'), 42)
  assert.equal(bare.parseTelegramTopicId(' 7 '), 7)
  assert.equal(bare.parseTelegramTopicId(''), undefined)
  assert.equal(bare.parseTelegramTopicId(undefined), undefined)
  assert.equal(bare.parseTelegramTopicId(null), undefined)
  assert.equal(bare.parseTelegramTopicId('0'), undefined, 'zero is not a real topic id')
  assert.equal(bare.parseTelegramTopicId('-5'), undefined, 'negative is rejected, not coerced')
  assert.equal(bare.parseTelegramTopicId('3.5'), undefined, 'decimal is rejected')
  assert.equal(bare.parseTelegramTopicId('abc'), undefined, 'non-numeric is rejected')
  console.log('PASS parseTelegramTopicId: integer-or-empty, defensively')

  // ---- 2. TELEGRAM_TOPIC_KEYS names all eight settings the UI/backend share -
  // (returns joined 27 Sep 2026: customer returns got their own family)
  assert.deepEqual([...bare.TELEGRAM_TOPIC_KEYS].sort(), [
    'telegram_topic_alerts', 'telegram_topic_expenses', 'telegram_topic_reports', 'telegram_topic_returns',
    'telegram_topic_sales', 'telegram_topic_shift', 'telegram_topic_stock', 'telegram_topic_status',
  ].sort())
  console.log('PASS TELEGRAM_TOPIC_KEYS: the eight settings keys the UI, backend validation, and config reader all share')

  // ---- 3-5. every outbound send path carries the right topic, or none -----
  const realFetch = globalThis.fetch
  const posts = []
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /^https:\/\/api\.telegram\.org\/bot/, 'the send path must be the Telegram API and nothing else')
    const body = JSON.parse(init.body)
    if (!/\/setWebhook$/.test(String(url))) posts.push(body)
    return { ok: true, status: 200, text: async () => '', json: async () => ({ ok: true }) }
  }
  try {
    const env = { TELEGRAM_BOT_TOKEN: 'test-token-not-a-real-one', BUSINESS_OS_ADMIN_URL: 'https://admin.example.com' }
    const wired = wireTelegram(baseSettings)

    posts.length = 0
    await wired.sendTelegramEvent(env, { type: 'sales', lines: ['x'] })
    assert.equal(posts[0].message_thread_id, 22, 'sales event routes to telegram_topic_sales')

    posts.length = 0
    await wired.sendTelegramEvent(env, { type: 'status', lines: ['x'] })
    assert.equal(posts[0].message_thread_id, 33, 'status event routes to telegram_topic_status')

    posts.length = 0
    await wired.sendTelegramEvent(env, { type: 'fees', lines: ['x'] })
    assert.equal(posts[0].message_thread_id, 44, 'fees event routes to telegram_topic_expenses')

    posts.length = 0
    await wired.sendTelegramEvent(env, { type: 'stock_in', lines: ['x'] })
    assert.equal(posts[0].message_thread_id, 55, 'stock_in event routes to telegram_topic_stock')

    posts.length = 0
    await wired.sendTelegramEvent(env, { type: 'stock_out', lines: ['x'] })
    assert.equal(posts[0].message_thread_id, 55, 'stock_out event routes to telegram_topic_stock, same as stock_in')

    posts.length = 0
    await wired.sendTelegramTest(env)
    assert.equal(posts[0].message_thread_id, 77, 'test message routes to telegram_topic_alerts')

    posts.length = 0
    await wired.sendTelegramTodaySummary(env)
    assert.equal(posts[0].message_thread_id, 66, "day summary routes to telegram_topic_reports")

    console.log('PASS sendTelegramEvent/sendTelegramTest/sendTelegramTodaySummary: each carries its own configured topic')

    // ---- when nothing is configured, message_thread_id is ABSENT, not 0/null
    const unrouted = wireTelegram([{ key: 'telegram_chat_id', value: '-100999' }])
    posts.length = 0
    await unrouted.sendTelegramEvent(env, { type: 'sales', lines: ['x'] })
    assert.ok(!('message_thread_id' in posts[0]), `message_thread_id must be entirely absent, not sent as null/0: ${JSON.stringify(posts[0])}`)
    console.log('PASS empty topic setting: message_thread_id key is absent from the request body')

    // ---- 6. webhook command replies echo the INCOMING thread, not a setting
    const wiredWebhook = wireTelegram(baseSettings)
    posts.length = 0
    const update = {
      message: {
        chat: { id: -100999 },
        from: { id: 555 },
        text: '/help',
        message_thread_id: 999,
      },
    }
    // Owner authorization: telegram_chat_id must match to be treated as an
    // owner/manager chat; this harness's chat id already matches baseSettings.
    await wiredWebhook.handleTelegramWebhook(env, update)
    const reply = posts.find((p) => String(p.chat_id) === '-100999')
    assert.ok(reply, `expected a reply to be posted: ${JSON.stringify(posts)}`)
    assert.equal(reply.message_thread_id, 999, 'a command reply echoes the incoming message_thread_id, not a configured push topic')
    console.log('PASS handleTelegramWebhook: replies echo the incoming message_thread_id')
  } finally {
    globalThis.fetch = realFetch
  }

  // ---- deleted/closed forum topic: retry once into General, no other 400 ---
  // Refuter, 25 Sep 2026: a topic the owner deleted or closed answers every
  // send into it with HTTP 400 forever, silently dropping that whole message
  // family. postTelegram must retry ONCE with message_thread_id dropped, and
  // warn naming the setting key -- but any OTHER 400 (unrelated to a missing
  // topic) must keep today's behaviour: throw, no retry.
  try {
    const env = { TELEGRAM_BOT_TOKEN: 'test-token-not-a-real-one', BUSINESS_OS_ADMIN_URL: 'https://admin.example.com' }
    const deletedTopicWired = wireTelegram(baseSettings)
    const attempts = []
    const warnings = []
    const realWarn = console.warn
    console.warn = (...args) => warnings.push(args.join(' '))
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body)
      attempts.push(body)
      if (attempts.length === 1) {
        return { ok: false, status: 400, text: async () => '{"ok":false,"error_code":400,"description":"Bad Request: message thread not found"}' }
      }
      return { ok: true, status: 200, text: async () => '', json: async () => ({ ok: true }) }
    }
    try {
      const sent = await deletedTopicWired.sendTelegramEvent(env, { type: 'sales', lines: ['x'] })
      assert.equal(sent, true, 'sendTelegramEvent must still report success once the retry lands')
      assert.equal(attempts.length, 2, `expected exactly one retry, got ${attempts.length} attempts:\n${JSON.stringify(attempts)}`)
      assert.equal(attempts[0].message_thread_id, 22, 'the first attempt still carries the configured topic')
      assert.ok(!('message_thread_id' in attempts[1]), `the retry must drop message_thread_id entirely, not send it as null/0: ${JSON.stringify(attempts[1])}`)
      assert.ok(warnings.some((w) => w.includes('telegram_topic_sales')), `the warning must name the topic setting key so the owner can fix it:\n${warnings.join('\n')}`)
    } finally { console.warn = realWarn }
    console.log('PASS deleted/closed topic (message thread not found): exactly one retry without message_thread_id, warning names telegram_topic_sales')

    // Case-insensitive, and the two other Telegram phrasings for the same
    // condition (TOPIC_DELETED, "topic closed") get the same treatment.
    for (const description of ['bad request: TOPIC_DELETED', 'Topic closed', 'MESSAGE THREAD NOT FOUND']) {
      const wired = wireTelegram(baseSettings)
      const tries = []
      globalThis.fetch = async (url, init) => {
        tries.push(JSON.parse(init.body))
        if (tries.length === 1) return { ok: false, status: 400, text: async () => JSON.stringify({ ok: false, description }) }
        return { ok: true, status: 200, text: async () => '', json: async () => ({ ok: true }) }
      }
      await wired.sendTelegramEvent(env, { type: 'sales', lines: ['x'] })
      assert.equal(tries.length, 2, `"${description}" must trigger exactly one retry`)
      assert.ok(!('message_thread_id' in tries[1]), `"${description}": the retry must drop message_thread_id`)
    }
    console.log('PASS deleted/closed topic wording: TOPIC_DELETED and "topic closed" are matched case-insensitively too')

    // An UNRELATED 400 (a malformed request, say) must NOT retry -- retrying a
    // real error would silently double-send once the underlying cause is
    // fixed, or mask the actual problem from the caller entirely.
    const unrelatedWired = wireTelegram(baseSettings)
    const unrelatedAttempts = []
    globalThis.fetch = async (url, init) => {
      unrelatedAttempts.push(JSON.parse(init.body))
      return { ok: false, status: 400, text: async () => '{"ok":false,"error_code":400,"description":"Bad Request: chat not found"}' }
    }
    await assert.rejects(
      () => unrelatedWired.sendTelegramEvent(env, { type: 'sales', lines: ['x'] }),
      /Telegram rejected the message \(400\)/,
      'an unrelated 400 must still throw',
    )
    assert.equal(unrelatedAttempts.length, 1, `an unrelated 400 must not retry: ${JSON.stringify(unrelatedAttempts)}`)
    console.log('PASS unrelated 400 (chat not found): no retry, error still thrown')
  } finally {
    globalThis.fetch = realFetch
  }

  // ---- review alerts ------
  // A `reviews` event goes to telegram_topic_alerts, follows the topic setting it finds (never a number of its own),
  // is on when its switch is unset, and is the only kind of send that may retry -- once, on a 429 or a 5xx only.
  const reviewEnv = { TELEGRAM_BOT_TOKEN: 'test-token-not-a-real-one', BUSINESS_OS_ADMIN_URL: 'https://admin.example.com' }
  const reviewEvent = { type: 'reviews', heading: '🕒 Review requested', lines: ['Request: Edit branch · Main', 'Requested by: sokha'] }
  const okAnswer = { ok: true, status: 200, text: async () => '', json: async () => ({ ok: true }) }
  const answer = (status, body = '') => ({ ok: false, status, text: async () => body, json: async () => (body ? JSON.parse(body) : {}) })
  const realSetTimeout = globalThis.setTimeout
  try {
    const attempts = []
    let script = []
    globalThis.fetch = async (url, init) => {
      assert.match(String(url), /^https:\/\/api\.telegram\.org\/bot/, 'a review alert goes to the Telegram API and nothing else')
      attempts.push({ body: JSON.parse(init.body), hasSignal: Boolean(init.signal) })
      const next = script[attempts.length - 1]
      if (next instanceof Error) throw next
      return next || okAnswer
    }
    const waits = []
    globalThis.setTimeout = (fn, ms) => { waits.push(ms); fn(); return 0 }
    const run = async (settings, options, answers = []) => {
      attempts.length = 0; waits.length = 0; script = answers
      return wireTelegram(settings).sendTelegramEvent(reviewEnv, reviewEvent, options)
    }

    // -- the topic: the Alerts setting this deployment holds, whatever it is ------
    assert.equal(await run(baseSettings), true)
    assert.equal(attempts.length, 1)
    assert.equal(attempts[0].body.message_thread_id, 77, 'reviews routes to telegram_topic_alerts')
    assert.equal(attempts[0].body.chat_id, '-100999')
    const moved = baseSettings.map((row) => (row.key === 'telegram_topic_alerts' ? { ...row, value: '4242' } : row.key === 'telegram_chat_id' ? { ...row, value: '-100888' } : row))
    await run(moved)
    assert.equal(attempts[0].body.message_thread_id, 4242, 'the topic follows the setting: no id of its own')
    assert.equal(attempts[0].body.chat_id, '-100888', 'and so does the chat')
    await run(baseSettings.filter((row) => row.key !== 'telegram_topic_alerts'))
    assert.ok(!('message_thread_id' in attempts[0]), 'no Alerts topic configured: General, no thread key at all')
    assert.ok(!attempts[0].hasSignal, 'a plain send carries no timeout signal')

    // -- the switch: on when unset, off only when set to false -----------------------
    for (const [value, expected] of [[undefined, true], ['true', true], ['', true], ['false', false], ['FALSE', false], [' false ', false]]) {
      const settings = value === undefined ? baseSettings : [...baseSettings, { key: 'telegram_reviews_enabled', value }]
      assert.equal(await run(settings), expected, `telegram_reviews_enabled=${JSON.stringify(value)}`)
      assert.equal(attempts.length, expected ? 1 : 0, `telegram_reviews_enabled=${JSON.stringify(value)} sends ${expected ? 'one message' : 'nothing'}`)
    }
    assert.equal(await run([...baseSettings, { key: 'telegram_automation_enabled', value: 'false' }]), false, 'automation off: nothing')
    assert.equal(attempts.length, 0)
    assert.equal(await run(baseSettings.filter((row) => row.key !== 'telegram_chat_id')), false, 'no chat id: nothing')
    assert.equal(attempts.length, 0)
    // The review switch is its own: the product-edit switch and the sales switch do not govern it, and it governs neither.
    assert.equal(await run([...baseSettings, { key: 'telegram_products_enabled', value: 'false' }, { key: 'telegram_sales_enabled', value: 'false' }]), true)
    assert.equal(await run([...baseSettings, { key: 'telegram_reviews_enabled', value: 'false' }]), false)
    assert.equal(await wireTelegram([...baseSettings, { key: 'telegram_reviews_enabled', value: 'false' }]).sendTelegramEvent(reviewEnv, { type: 'sales', lines: ['x'] }), true, 'turning reviews off leaves sales on')

    // -- the lazy form: nothing is composed (nothing read) while the alerts are off ------
    let composed = 0
    const compose = async () => { composed += 1; return { heading: reviewEvent.heading, lines: reviewEvent.lines } }
    for (const settings of [
      [...baseSettings, { key: 'telegram_reviews_enabled', value: 'false' }],
      [...baseSettings, { key: 'telegram_automation_enabled', value: 'false' }],
      baseSettings.filter((row) => row.key !== 'telegram_chat_id'),
    ]) {
      attempts.length = 0; composed = 0
      assert.equal(await wireTelegram(settings).sendTelegramEventWhenOn(reviewEnv, 'reviews', compose), false)
      assert.equal(composed, 0, 'compose (the record-name read) must not run while the alerts are off')
      assert.equal(attempts.length, 0)
    }
    attempts.length = 0; composed = 0
    assert.equal(await wireTelegram(baseSettings).sendTelegramEventWhenOn(reviewEnv, 'reviews', compose), true)
    assert.equal(composed, 1, 'compose runs once while the alerts are on')
    assert.equal(attempts.length, 1)
    assert.equal(attempts[0].body.message_thread_id, 77)
    attempts.length = 0
    assert.equal(await wireTelegram(baseSettings).sendTelegramEventWhenOn(reviewEnv, 'reviews', async () => null), false, 'compose may decline')
    assert.equal(attempts.length, 0)
    console.log('PASS review alerts: reviews routes to telegram_topic_alerts as configured, on when unset, off only on false, and the lazy form composes nothing while off')

    // -- one retry on 429 / 5xx, never on a thrown error --------------------------
    const retry = { retryOnce: true }
    assert.equal(await run(baseSettings, retry, [answer(429, '{"ok":false,"error_code":429,"parameters":{"retry_after":0}}')]), true)
    assert.equal(attempts.length, 2, 'a 429 is retried once')
    assert.ok(attempts.every((attempt) => attempt.hasSignal), 'a retrying send carries a timeout signal on every attempt')
    assert.deepEqual(attempts[1].body, attempts[0].body, 'the retry is the same message')
    assert.equal(await run(baseSettings, retry, [answer(500)]), true)
    assert.equal(attempts.length, 2, 'a 500 is retried once')
    assert.equal(await run(baseSettings, retry, [answer(502)]), true)
    assert.equal(attempts.length, 2, 'a 502 is retried once')
    await assert.rejects(() => run(baseSettings, retry, [answer(503), answer(503)]), /Telegram rejected the message \(503\)/)
    assert.equal(attempts.length, 2, 'only ONE retry: a second 503 is final')
    await assert.rejects(() => run(baseSettings, retry, [answer(429, '{"parameters":{"retry_after":0}}'), answer(429, '{"parameters":{"retry_after":0}}')]), /\(429\)/)
    assert.equal(attempts.length, 2, 'only ONE retry: a second 429 is final')
    assert.equal(await run(baseSettings, retry, [answer(429, '{"ok":false,"parameters":{"retry_after":2}}')]), true)
    assert.deepEqual(waits, [2000], 'the wait is Telegram\'s retry_after')
    await run(baseSettings, retry, [answer(429, '{"ok":false,"parameters":{"retry_after":9}}')])
    assert.deepEqual(waits, [3000], 'the wait is capped at 3 s')
    await run(baseSettings, retry, [answer(429, 'not json')])
    assert.equal(waits.length, 1, 'an unreadable 429 still waits and retries once')
    assert.ok(waits[0] <= 3000)
    // An AMBIGUOUS failure -- Telegram may already have taken the message -- is never retried.
    await assert.rejects(() => run(baseSettings, retry, [new TypeError('Network connection lost')]), /Network connection lost/)
    assert.equal(attempts.length, 1, 'a network error is not retried')
    await assert.rejects(() => run(baseSettings, retry, [Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })]), /timeout/)
    assert.equal(attempts.length, 1, 'a timeout is not retried')
    await assert.rejects(() => run(baseSettings, retry, [answer(400, '{"description":"Bad Request: chat not found"}')]), /\(400\)/)
    assert.equal(attempts.length, 1, 'a 400 is not retried')
    // The default is unchanged: no flag, no retry, no signal.
    await assert.rejects(() => run(baseSettings, {}, [answer(429, '{"parameters":{"retry_after":0}}')]), /\(429\)/)
    assert.equal(attempts.length, 1, 'without retryOnce a 429 is final, as before')
    await assert.rejects(() => run(baseSettings, undefined, [answer(500)]), /\(500\)/)
    assert.equal(attempts.length, 1, 'without retryOnce a 500 is final, as before')
    assert.ok(!attempts[0].hasSignal)
    // The deleted-topic fallback still works for a retrying send, and a retry is not spent on it.
    assert.equal(await run(baseSettings, retry, [answer(400, '{"description":"Bad Request: message thread not found"}')]), true)
    assert.equal(attempts.length, 2)
    assert.ok(!('message_thread_id' in attempts[1].body), 'the fallback drops the topic')
    // ONE retry per message in total, the General fallback included: 503, then a deleted topic, then 503 again is final.
    await assert.rejects(() => run(baseSettings, retry, [answer(503), answer(400, '{"description":"Bad Request: message thread not found"}'), answer(503), okAnswer]), /\(503\)/)
    assert.equal(attempts.length, 3, 'the fallback send is not retried once the one retry has been spent')
    console.log('PASS retry: one retry on 429 (retry_after, capped at 3 s) and on 5xx, none on a network error, a timeout or a 400, none by default')
  } finally {
    globalThis.fetch = realFetch
    globalThis.setTimeout = realSetTimeout
  }

  // ---- shift report and shift overview: source-pinned, since a full close/
  // reopen fixture is already exercised end-to-end by
  // test-telegram-shift-report-pure.cjs and test-telegram-shift-overview-pure.cjs.
  // The overview's own routing (Summary topic, else Shift) is driven end to end there.
  const telegramSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'telegram.ts'), 'utf8')
  // `options` is what an event adds to the send (who amended, reopened or closed); the topic is what this pins.
  assert.match(telegramSource, /shiftReportFor\(env, shift, nowMs, config\.language(?:, options)?\), config\.chatId, config\.topics\.telegram_topic_shift, 'telegram_topic_shift'\)/, 'sendTelegramShiftReport must pass telegram_topic_shift')
  assert.match(telegramSource, /return config\.topics\.telegram_topic_reports \? 'telegram_topic_reports' : 'telegram_topic_shift'/, 'the overview goes to the Summary topic, else the Shift topic')
  console.log('PASS sendTelegramShiftReport stays on telegram_topic_shift; the overview prefers telegram_topic_reports')

  // ---- backend validation: routes/settings.ts rejects a non-integer, non-
  // empty topic id with the invalid_telegram_topic_id code, for EVERY one of
  // the eight keys (not just one hardcoded key that could silently drift from
  // TELEGRAM_TOPIC_KEYS if a new topic slot were ever added).
  const settingsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'settings.ts'), 'utf8')
  assert.match(settingsSource, /import \{[^}]*\bTELEGRAM_TOPIC_KEYS\b[^}]*\} from '\.\.\/lib\/telegram'/, 'routes/settings.ts must import the shared topic key list, not its own copy')
  assert.match(settingsSource, /for \(const key of TELEGRAM_TOPIC_KEYS\)/, 'validation must loop over every topic key, not one hardcoded key')
  assert.match(settingsSource, /code: 'invalid_telegram_topic_id'/)
  // The same integer-or-empty rule the parser above enforces, checked
  // byte-for-byte so the two cannot silently diverge (one loosened, the
  // other not): a non-empty non-digit string is rejected.
  // Since 27 Sep 2026 the rule is ONE exported function, shared with the
  // Telegram /settopic save (lib/telegramTopicSetting.ts), pinned by value.
  assert.match(settingsSource, /if \(!isTelegramTopicSettingValue\(raw\)\)/, 'validation must use the shared topic value rule')
  for (const good of ['', '7', '9001']) assert.equal(bare.isTelegramTopicSettingValue(good), true, `${JSON.stringify(good)} is a valid topic value`)
  for (const bad of ['-5', '3.5', 'abc', ' 7x']) assert.equal(bare.isTelegramTopicSettingValue(bad), false, `${JSON.stringify(bad)} must be rejected`)
  console.log('PASS routes/settings.ts: every TELEGRAM_TOPIC_KEYS entry is validated integer-or-empty, rejected with invalid_telegram_topic_id')

  // ---- same role gate and audit treatment as the existing telegram_chat_id -
  // telegram_chat_id has no dedicated bucket permission today (no
  // BUSINESS_IDENTITY_KEYS/SALES_POLICY_KEYS/etc. entry), which means saving
  // it requires only the plain 'settings' permission -- the same gate every
  // unbucketed key gets. A new topic key must NOT be quietly added to one of
  // those bucket sets (that would require a NARROWER permission than the
  // chat-id setting it is routed alongside), and it must not be swept into
  // the sensitive/secret redaction path (it is a small forum topic number,
  // not a credential) -- both would silently change from telegram_chat_id's
  // own behaviour.
  const bucketSetNames = ['BUSINESS_IDENTITY_KEYS', 'SALES_POLICY_KEYS', 'RECEIPT_SETTINGS_KEYS', 'PORTAL_POSTS_KEYS', 'PORTAL_FAQ_KEYS', 'PORTAL_ABOUT_KEYS']
  for (const setName of bucketSetNames) {
    const block = settingsSource.match(new RegExp(`const ${setName} = new Set\\(\\[[\\s\\S]*?\\]\\)`))
    assert.ok(block, `expected to find ${setName} in routes/settings.ts`)
    for (const topicKey of bare.TELEGRAM_TOPIC_KEYS) {
      assert.ok(!block[0].includes(`'${topicKey}'`), `${topicKey} must not be added to ${setName} -- that would require a permission NARROWER than telegram_chat_id's plain 'settings' gate`)
    }
  }
  const bucketFnBody = settingsSource.match(/function settingsBucketPermissionFor\(key: string\): string \| null \{[\s\S]*?\n\}/)
  assert.ok(bucketFnBody, 'expected to find settingsBucketPermissionFor in routes/settings.ts')
  assert.ok(!/telegram_topic_/.test(bucketFnBody[0]), 'a topic key must not be special-cased inside settingsBucketPermissionFor either')
  const settingsSensitiveSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'settingsSensitive.ts'), 'utf8')
  const { isSensitiveSettingKey } = loadReal('lib/settingsSensitive.ts')
  const { isSecretShapedAuditKey } = loadReal('lib/audit.ts', { './db': { getDb: () => { throw new Error('no DB in this test') } } })
  for (const topicKey of bare.TELEGRAM_TOPIC_KEYS) {
    assert.ok(!isSensitiveSettingKey(topicKey), `${topicKey} must be audited with its plain before/after value, like telegram_chat_id -- not redacted`)
    assert.ok(!isSecretShapedAuditKey(topicKey), `${topicKey} must not match the secret-shaped audit filter`)
    assert.ok(!settingsSensitiveSource.includes(`'${topicKey}'`), `${topicKey} must not be enumerated in settingsSensitive.ts`)
  }
  console.log('PASS permission + audit parity: every topic key gets the exact same "settings" permission gate and un-redacted audit row as telegram_chat_id')

  console.log('test-telegram-topics-pure: ok')
})().catch((error) => { console.error(error); process.exit(1) })
