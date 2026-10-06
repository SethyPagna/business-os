// R-telegram E7a (27 Sep 2026): the Telegram webhook is PUBLIC -- Telegram
// cannot present a Business OS session -- so the X-Telegram-Bot-Api-Secret-Token
// header is the only thing between the internet and the bot's command handler
// (which answers with the day's revenue in an approved chat, and writes topic
// settings). Until now no test failed when that check was switched off.
//
// Drives the REAL routes/telegram.ts through Hono with the REAL lib/telegram.ts
// behind it, over a SQLite settings table and a fetch stub that only RECORDS
// (nothing is sent to any chat; the token below is made up):
//   1. The secret Telegram is given at setWebhook ("Connect commands") is the
//      one the route accepts, and it is sha256-hex of the bot token -- changing
//      that derivation strands every connected webhook until the owner presses
//      Connect commands again, so it is pinned.
//   2. Refused with 401, before the body is read: no header, a wrong secret of
//      the right length, the right secret with a character added or removed,
//      the raw token, another token's secret. A refused request touches
//      neither the database nor Telegram.
//   3. No token on the Worker: nothing opens the door, not even the sha256 of
//      an empty token.
//   4. The right secret: 200, the command runs, the reply goes to the chat.
//
// Run (from cloudflare/): node scripts/test-telegram-webhook-secret-pure.cjs
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'))
const { Hono } = require(path.join(root, 'node_modules', 'hono'))

function load(file, overrides = {}) {
  const filePath = path.join(root, 'src', file)
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const m = { exports: {} }
  new Function('require', 'module', 'exports', output)((name) => {
    if (name in overrides) return overrides[name]
    if (name.startsWith('.')) throw new Error(`${file} requires ${name}, which this test did not wire`)
    return require(name)
  }, m, m.exports)
  return m.exports
}

let checks = 0
const pass = (label) => { checks += 1; console.log(`PASS ${label}`) }
const KHMER = /[ក-៿]/

// ---- modules: the real Telegram lib, the real route ---------------------------
let prepares = 0
const dbHolder = { db: null }
const dbModule = { getDb: () => { prepares += 1; return dbHolder.db } }
const businessDateWindow = load('lib/businessDateWindow.ts')
const moneyPrecision = load('lib/moneyPrecision.ts')
const reportMoneyPrecision = load('lib/reportMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const promotionRules = load('lib/promotionRules.ts', { './moneyPrecision': moneyPrecision })
const saleItemPricing = load('lib/saleItemPricing.ts', { './moneyPrecision': moneyPrecision, './promotionRules': promotionRules })
const saleMoneyPrecision = load('lib/saleMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
// salesAnalytics reads a credit sale's balance due through the one owed helper.
const saleStatusResolutionForAnalytics = load('lib/saleStatusResolution.ts', { './financialPrecision': load('lib/financialPrecision.ts') })
const refundMoneyPrecision = load('lib/refundMoneyPrecision.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const customerReturnEntitlement = load('lib/customerReturnEntitlement.ts', { './moneyPrecision': moneyPrecision, './refundMoneyPrecision': refundMoneyPrecision, './saleItemPricing': saleItemPricing, './saleMoneyPrecision': saleMoneyPrecision })
const analyticsPrecision = { './saleStatusResolution': saleStatusResolutionForAnalytics, './saleMoneyPrecision': saleMoneyPrecision, './reportMoneyPrecision': reportMoneyPrecision, './customerReturnEntitlement': customerReturnEntitlement, './refundMoneyPrecision': refundMoneyPrecision }
const saleTotals = load('lib/saleTotals.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const financialPrecision = load('lib/financialPrecision.ts')
const nativeSaleChange = load('lib/nativeSaleChange.ts', { './financialPrecision': financialPrecision, './saleTotals': saleTotals })
const analytics = load('lib/salesAnalytics.ts', { './db': dbModule, './removalLosses': load('lib/removalLosses.ts'), './schemaProbe': load('lib/schemaProbe.ts'), './businessDateWindow': businessDateWindow, ...analyticsPrecision })
const reconciliation = load('lib/shiftReconciliation.ts', { './db': dbModule, './salesAnalytics': analytics, './nativeSaleChange': nativeSaleChange, './paymentMethodRegistry': load('lib/paymentMethodRegistry.ts') })
const lang = load('lib/telegramLang.ts')
const lowStockRule = load('lib/lowStockSettings.ts', { './db': dbModule })
const telegram = load('lib/telegram.ts', {
  './db': dbModule, './lowStockSettings': { ...lowStockRule, loadLowStockConfig: async () => lowStockRule.DEFAULT_LOW_STOCK_CONFIG },
  './saleTotals': saleTotals, './businessDateWindow': businessDateWindow, './telegramLang': lang,
  './salesAnalytics': analytics, './shiftReconciliation': reconciliation, './nativeSaleChange': nativeSaleChange,
})
let authCalls = 0
const saves = []
const route = load('routes/telegram.ts', {
  hono: { Hono },
  // The webhook must answer WITHOUT a session; anything reaching this means
  // the public route fell through to the signed-in ones.
  '../lib/auth': { requireAuth: async (c) => { authCalls += 1; return c.json({ error: 'session required' }, 401) } },
  '../lib/audit': { audit: async () => { throw new Error('the webhook writes no audit row of its own') } },
  '../lib/permissions': { hasPermission: () => false },
  '../lib/telegram': telegram,
  '../lib/telegramTopicSetting': { saveTelegramTopicSetting: async (_env, save) => { saves.push(save) } },
  '../lib/telegramCommandMenu': { connectTelegramCommands: async () => { throw new Error('the webhook never connects commands') }, registerTelegramCommandMenu: async () => { throw new Error('the webhook never sets the menu') } },
  '../lib/actorSnapshot': { actorSnapshot: () => ({}) },
}).default
// Mounted exactly as src/index.ts mounts it (pinned below), so the path the
// requests take is the one setWebhook hands Telegram.
const app = new Hono()
app.route('/api/telegram', route)
const WEBHOOK_PATH = '/api/telegram/webhook'

// ---- a real settings table ------------------------------------------------------
const ALERTS_CHAT = '-1001111111111' // a made-up group id, not the shop's
function makeDb(settings) {
  const sql = new Database(':memory:')
  sql.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)')
  const put = sql.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
  for (const [key, value] of Object.entries(settings)) put.run(key, value)
  const bind = (query, params) => {
    if (Array.isArray(params)) return { stmt: sql.prepare(query), values: params }
    const values = []
    const text = query.replace(/@(\w+)/g, (_, key) => { values.push((params || {})[key] ?? null); return '?' })
    return { stmt: sql.prepare(text), values }
  }
  return {
    prepare(query) {
      return {
        async get(params) { const b = bind(query, params); return b.stmt.get(...b.values) },
        async all(params) { const b = bind(query, params); return b.stmt.all(...b.values) },
        async run(params) { const b = bind(query, params); return b.stmt.run(...b.values) },
      }
    },
  }
}
const SETTINGS = { telegram_chat_id: ALERTS_CHAT, telegram_language: 'both' }
const TOKEN = 'test-token-not-a-real-one'
const env = { TELEGRAM_BOT_TOKEN: TOKEN, BUSINESS_OS_ADMIN_URL: 'https://admin.example.test' }
const sha256hex = (text) => crypto.createHash('sha256').update(text).digest('hex')

// A fetch stub: records every Telegram call by method, answers ok.
let calls = []
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  assert.match(String(url), /^https:\/\/api\.telegram\.org\/bot/, 'only the Telegram API is ever called')
  calls.push({ method: String(url).split('/').pop(), body: JSON.parse(init.body) })
  return { ok: true, status: 200, text: async () => '', json: async () => ({ ok: true, result: {} }) }
}

// A /help from the approved chat: if it reaches the handler, it is answered.
const HELP = JSON.stringify({ update_id: 1, message: { message_id: 9, text: '/help', chat: { id: Number(ALERTS_CHAT), type: 'supergroup' }, from: { id: 42, username: 'owner' } } })
async function post(headers, runEnv = env, body = HELP) {
  dbHolder.db = makeDb(SETTINGS); calls = []; prepares = 0; authCalls = 0; saves.length = 0
  const response = await app.request(WEBHOOK_PATH, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }, runEnv, { waitUntil() {}, passThroughOnException() {} })
  return { status: response.status, json: await response.json().catch(() => null) }
}
const SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token'

;(async () => {
  try {
    // ---- 1. the secret Telegram is given --------------------------------------
    dbHolder.db = makeDb(SETTINGS); calls = []
    await telegram.configureTelegramWebhook(env)
    assert.equal(calls.length, 1); assert.equal(calls[0].method, 'setWebhook')
    const secret = calls[0].body.secret_token
    assert.equal(calls[0].body.url, `https://admin.example.test${WEBHOOK_PATH}`)
    assert.match(fs.readFileSync(path.join(root, 'src', 'index.ts'), 'utf8'), /app\.route\('\/api\/telegram', telegramRoute\)/, 'the route is mounted where setWebhook points')
    assert.equal(secret, sha256hex(TOKEN), 'the secret is sha256-hex of the bot token; changing it strands every connected webhook')
    assert.match(secret, /^[0-9a-f]{64}$/, "Telegram's allowed secret characters")
    pass(`setWebhook is given sha256-hex(token) as secret_token, for ${WEBHOOK_PATH}, where the route is mounted`)

    // ---- 2. refusals -----------------------------------------------------------
    const flip = (text) => text.slice(0, -1) + (text.endsWith('0') ? '1' : '0')
    const refused = [
      ['no header', {}],
      ['an empty header', { [SECRET_HEADER]: '' }],
      ['a wrong secret of the right length', { [SECRET_HEADER]: flip(secret) }],
      ['the right secret with a character added', { [SECRET_HEADER]: `${secret}0` }],
      ['the right secret with its last character removed', { [SECRET_HEADER]: secret.slice(0, -1) }],
      ['the bot token itself', { [SECRET_HEADER]: TOKEN }],
      ["another token's secret", { [SECRET_HEADER]: sha256hex('another-made-up-token') }],
      ['the right secret in upper case', { [SECRET_HEADER]: secret.toUpperCase() }],
    ]
    for (const [why, headers] of refused) {
      const out = await post(headers)
      assert.equal(out.status, 401, `${why}: must be refused, got ${out.status} ${JSON.stringify(out.json)}`)
      assert.deepEqual(out.json, { error: 'Unauthorized' }, why)
      assert.equal(calls.length, 0, `${why}: nothing may be sent (${JSON.stringify(calls)})`)
      assert.equal(prepares, 0, `${why}: the database is not touched before the secret is checked`)
      assert.equal(authCalls, 0, `${why}: refused by the webhook's own check, not by the session guard`)
    }
    pass(`refused with 401 before anything runs: ${refused.map(([why]) => why).join('; ')}`)

    // ---- 3. no token on the Worker ------------------------------------------
    const noToken = { BUSINESS_OS_ADMIN_URL: env.BUSINESS_OS_ADMIN_URL }
    for (const [why, headers] of [
      ['sha256 of an empty token', { [SECRET_HEADER]: sha256hex('') }],
      ['an empty header', { [SECRET_HEADER]: '' }],
      ['no header', {}],
    ]) {
      const out = await post(headers, noToken)
      assert.equal(out.status, 401, `no token configured, ${why}: must be refused, got ${out.status}`)
      assert.equal(calls.length + prepares, 0, `no token configured, ${why}: nothing runs`)
    }
    pass('no token on the Worker: nothing opens the webhook, not even sha256("")')

    // ---- 4. the right secret -------------------------------------------------
    let out = await post({ [SECRET_HEADER]: secret })
    assert.equal(out.status, 200); assert.deepEqual(out.json, { ok: true })
    assert.equal(authCalls, 0, 'the webhook needs no session')
    assert.equal(calls.length, 1, `one reply: ${JSON.stringify(calls)}`)
    assert.equal(calls[0].method, 'sendMessage'); assert.equal(calls[0].body.chat_id, ALERTS_CHAT)
    const reply = calls[0].body.text
    assert.ok(reply.includes('📌 /topics: Where each type is sent') && reply.includes('ប្រភេទនីមួយៗផ្ញើទៅណា'), reply)
    assert.ok(KHMER.test(reply) && reply.includes('🔒 Only this shop chat receives data.'), reply)
    out = await post({ [SECRET_HEADER]: secret }, env, '{not json')
    assert.equal(out.status, 200, 'a body Telegram would never send is acknowledged, not retried forever')
    assert.equal(calls.length, 0, 'and answered with nothing')
    pass('the right secret: 200, no session needed, /help answered once in the approved chat, bilingually; a malformed body is acknowledged silently')

    console.log(`test-telegram-webhook-secret-pure: ${checks} checks ok (fetch stubbed; nothing sent)`)
  } finally {
    globalThis.fetch = realFetch
  }
})().catch((error) => { console.error(error); process.exit(1) })
