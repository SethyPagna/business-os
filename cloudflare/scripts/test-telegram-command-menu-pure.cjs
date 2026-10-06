// The Telegram command menu, the commands status, coded errors, the admin gate and a webhook that never
// 5xxs (TELEGRAM-FINAL 4.1, 4.2). Real lib/telegram.ts, lib/telegramCommandMenu.ts, lib/telegramTopicSetting.ts
// and routes/telegram.ts over the real migration chain; the fetch stub only records, and every id is made up.
//
// Run (from cloudflare/): node scripts/test-telegram-command-menu-pure.cjs
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')
const { Hono } = require(path.join(root, 'node_modules', 'hono'))

function load(file, overrides = {}) {
  const filePath = path.join(root, 'src', file)
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
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
let finished = false
process.on('exit', () => {
  if (!finished) { process.stderr.write(`test-telegram-command-menu-pure: stopped after ${checks} checks with work still pending\n`); process.exitCode = 1 }
})

const MIGRATED = (() => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = OFF;')
  for (const sql of loadAll()) db.exec(sql)
  return db
})()
function d1(sqlite) {
  const bind = (query, params) => {
    if (Array.isArray(params)) return { stmt: sqlite.prepare(query), values: params }
    const values = []
    const text = query.replace(/@(\w+)/g, (_, key) => { values.push((params || {})[key] ?? null); return '?' })
    return { stmt: sqlite.prepare(text), values }
  }
  return {
    prepare(query) {
      return {
        async get(params) { const b = bind(query, params); return b.stmt.get(...b.values) },
        async all(params) { const b = bind(query, params); return b.stmt.all(...b.values) },
        async run(params) { const b = bind(query, params); return b.stmt.run(...b.values) },
      }
    },
    async batch(statements) { return statements.map(({ sql, params }) => { const b = bind(sql, params); return b.stmt.run(...b.values) }) },
  }
}
const dbHolder = { db: null }
const dbModule = { getDb: () => dbHolder.db }
const ALERTS_CHAT = '-1001111111111'
const OTHER_CHAT = '-1002222222222'
const DM_CHAT = '424242'
function useSettings(settings) {
  MIGRATED.exec("DELETE FROM settings WHERE key LIKE 'telegram%'")
  MIGRATED.exec('DELETE FROM audit_logs')
  const put = MIGRATED.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
  for (const [key, value] of Object.entries(settings)) put.run(key, value)
  dbHolder.db = d1(MIGRATED)
}
const setting = (key) => MIGRATED.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value

const businessDateWindow = load('lib/businessDateWindow.ts')
const moneyPrecision = load('lib/moneyPrecision.ts')
const reportMoneyPrecision = load('lib/reportMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const promotionRules = load('lib/promotionRules.ts', { './moneyPrecision': moneyPrecision })
const saleItemPricing = load('lib/saleItemPricing.ts', { './moneyPrecision': moneyPrecision, './promotionRules': promotionRules })
const saleMoneyPrecision = load('lib/saleMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
// salesAnalytics reads a credit sale's balance due through the one owed helper.
const saleStatusResolutionForAnalytics = load('lib/saleStatusResolution.ts', { './financialPrecision': load('lib/financialPrecision.ts') })
const refundTenderForAnalytics = load('lib/refundTender.ts')
const refundMoneyPrecision = load('lib/refundMoneyPrecision.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const customerReturnEntitlement = load('lib/customerReturnEntitlement.ts', { './moneyPrecision': moneyPrecision, './refundMoneyPrecision': refundMoneyPrecision, './saleItemPricing': saleItemPricing, './saleMoneyPrecision': saleMoneyPrecision })
const analyticsPrecision = { './saleStatusResolution': saleStatusResolutionForAnalytics, './refundTender': refundTenderForAnalytics, './saleMoneyPrecision': saleMoneyPrecision, './reportMoneyPrecision': reportMoneyPrecision, './customerReturnEntitlement': customerReturnEntitlement, './refundMoneyPrecision': refundMoneyPrecision }
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
const menu = load('lib/telegramCommandMenu.ts', { './telegram': telegram, './telegramLang': lang })

const bumps = []
let broadcastImpl = async () => {}
const topicSetting = load('lib/telegramTopicSetting.ts', {
  './db': dbModule,
  './audit': load('lib/audit.ts', { './db': dbModule }),
  './cache': { bumpVersion: async (_env, namespace) => { bumps.push(namespace) } },
  '../durable-objects/broadcastHub': { broadcast: (_env, channel, payload) => broadcastImpl(channel, payload) },
  './telegram': telegram,
})
const permissions = load('lib/permissions.ts')
const ADMIN = { id: 1, username: 'owner', role_code: 'admin', permissions: '{}', role_permissions: '{}' }
const MANAGER = { id: 2, username: 'manager', role_code: 'manager', permissions: JSON.stringify({ settings: true }), role_permissions: '{}' }
let sessionUser = ADMIN
const routeAudits = []
const route = load('routes/telegram.ts', {
  hono: { Hono },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', sessionUser); return next() } },
  '../lib/audit': { audit: async (...args) => { routeAudits.push(args) } },
  '../lib/permissions': permissions,
  '../lib/telegram': telegram,
  '../lib/telegramCommandMenu': menu,
  '../lib/telegramTopicSetting': topicSetting,
  '../lib/actorSnapshot': { actorSnapshot: (user) => user.username },
}).default
const app = new Hono()
app.route('/api/telegram', route)

const TOKEN = 'test-token-not-a-real-one'
const ADMIN_URL = 'https://admin.example.test'
const WEBHOOK_URL = `${ADMIN_URL}/api/telegram/webhook`
const env = { TELEGRAM_BOT_TOKEN: TOKEN, BUSINESS_OS_ADMIN_URL: ADMIN_URL }
const BASE = { telegram_chat_id: `${ALERTS_CHAT},${OTHER_CHAT}`, telegram_language: 'both' }

let calls = []
const defaultAnswer = (method) => {
  if (method === 'getChatMember') return { status: 200, json: { ok: true, result: { status: 'administrator' } } }
  if (method === 'getWebhookInfo') return { status: 200, json: { ok: true, result: { url: WEBHOOK_URL, pending_update_count: 7, last_error_message: 'Wrong response from the webhook: 500' } } }
  return { status: 200, json: { ok: true, result: true } }
}
let respond = (method) => defaultAnswer(method)
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init = {}) => {
  assert.match(String(url), /^https:\/\/api\.telegram\.org\/bot/, 'only the Telegram API is ever called')
  const method = String(url).split('/').pop()
  const body = init.body ? JSON.parse(init.body) : {}
  calls.push({ method, body, signal: init.signal })
  const answer = await respond(method, body, init)
  const text = JSON.stringify(answer.json ?? {})
  return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, text: async () => text, json: async () => answer.json ?? {} }
}
const methods = () => calls.map((call) => call.method)
const MENU_METHODS = new Set(['setMyCommands', 'deleteMyCommands', 'getWebhookInfo'])
function reset(settings = BASE) { useSettings(settings); calls = []; respond = (method) => defaultAnswer(method); routeAudits.length = 0 }
function executionCtx() { const pending = []; return { pending, waitUntil(p) { pending.push(p) }, passThroughOnException() {} } }
async function request(method, url, { body, headers = {}, runEnv = env, ctx = executionCtx() } = {}) {
  const res = await app.request(url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }, runEnv, ctx)
  return { status: res.status, json: await res.json().catch(() => null), ctx }
}
const SECRET = crypto.createHash('sha256').update(TOKEN).digest('hex')
const webhook = (message, ctx) => request('POST', '/api/telegram/webhook', { body: { update_id: 1, message }, headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET }, ctx })
const inTopic = (text, thread = 9002) => ({ text, chat: { id: Number(ALERTS_CHAT), type: 'supergroup' }, from: { id: 42, username: 'owner' }, message_thread_id: thread, is_topic_message: true })
function captureConsole() {
  const lines = []
  const saved = { warn: console.warn, error: console.error, log: console.log }
  console.warn = (...args) => lines.push(args.join(' '))
  console.error = (...args) => lines.push(args.join(' '))
  console.log = (...args) => { lines.push(args.join(' ')); saved.log(...args) }
  return { lines, restore() { Object.assign(console, saved) } }
}

const NAMES = lang.TELEGRAM_COMMANDS.map((doc) => doc.command.replace(/^\//, ''))
const MEMBER_ALERTS = NAMES.filter((name) => name !== 'settopic')
const OTHER_CHATS = NAMES.filter((name) => name !== 'settopic' && name !== 'topics')
const namesOf = (call) => call.body.commands.map((entry) => entry.command)
const scopeOf = (call) => call.body.scope

;(async () => {
  const log = captureConsole()
  try {
    const describe = (doc) => `${doc.en}|${doc.km}`
    const group = menu.commandMenuPlan({ alertsChatId: ALERTS_CHAT, chatIds: [ALERTS_CHAT, OTHER_CHAT], describe })
    assert.deepEqual(group.map((call) => [call.role, call.method, scopeOf(call)]), [
      ['alerts', 'setMyCommands', { type: 'chat', chat_id: ALERTS_CHAT }],
      ['alerts_admins', 'setMyCommands', { type: 'chat_administrators', chat_id: ALERTS_CHAT }],
      ['other_chat', 'setMyCommands', { type: 'chat', chat_id: OTHER_CHAT }],
      ['cleanup', 'deleteMyCommands', { type: 'default' }],
      ['cleanup', 'deleteMyCommands', { type: 'all_private_chats' }],
      ['cleanup', 'deleteMyCommands', { type: 'all_group_chats' }],
      ['cleanup', 'deleteMyCommands', { type: 'all_chat_administrators' }],
    ])
    assert.equal(NAMES.length, 9)
    assert.deepEqual(namesOf(group[0]), MEMBER_ALERTS, 'members of the alerts group: every command but /settopic')
    assert.deepEqual(namesOf(group[1]), NAMES, 'its admins: all nine, since a scope replaces the list below it rather than adding to it')
    assert.deepEqual(namesOf(group[2]), OTHER_CHATS, 'another approved chat: no /settopic, no /topics (both answer only in the alerts chat)')
    assert.ok(group.slice(3).every((call) => !('commands' in call.body)))
    for (const call of group.filter((c) => c.body.commands)) {
      for (const entry of call.body.commands) {
        assert.match(entry.command, /^[a-z0-9_]{1,32}$/, `Bot API command name: ${entry.command}`)
        const doc = lang.TELEGRAM_COMMANDS.find((d) => d.command === `/${entry.command}`)
        assert.equal(entry.description, describe(doc), 'the description is describe(doc) for that command')
      }
    }
    const dm = menu.commandMenuPlan({ alertsChatId: DM_CHAT, chatIds: [DM_CHAT], describe })
    assert.deepEqual(dm.map((call) => [call.role, scopeOf(call).type]), [['alerts', 'chat'], ['cleanup', 'default'], ['cleanup', 'all_private_chats'], ['cleanup', 'all_group_chats'], ['cleanup', 'all_chat_administrators']],
      'a private alerts chat: one chat scope, no administrators scope (group-only)')
    assert.deepEqual(namesOf(dm[0]), MEMBER_ALERTS, 'and no /settopic: it can never save in a private chat')
    const many = Array.from({ length: 14 }, (_, i) => `-10030000000${String(i).padStart(2, '0')}`)
    const crowded = menu.commandMenuPlan({ alertsChatId: ALERTS_CHAT, chatIds: [ALERTS_CHAT, many[0], many[0], ALERTS_CHAT, ...many], describe })
    const others = crowded.filter((call) => call.role === 'other_chat').map((call) => scopeOf(call).chat_id)
    assert.deepEqual(others, many.slice(0, 10), 'other approved chats: deduplicated, never the alerts chat, at most ten, in settings order')
    const planIds = new Set(crowded.flatMap((call) => (scopeOf(call).chat_id ? [scopeOf(call).chat_id] : [])))
    assert.ok([...planIds].every((id) => id === ALERTS_CHAT || many.includes(id)), 'every chat id in the plan comes from the settings')
    assert.equal(menu.commandMenuPlan.length, 1, 'one settings-derived argument; no request reaches the plan')
    for (const language of ['en', 'km', 'both']) {
      reset({ ...BASE, telegram_language: language })
      const settings = await telegram.telegramMenuSettings(env)
      assert.deepEqual([settings.alertsChatId, settings.chatIds], [ALERTS_CHAT, [ALERTS_CHAT, OTHER_CHAT]])
      const plan = menu.commandMenuPlan(settings)
      for (const call of plan.filter((c) => c.body.commands)) {
        for (const entry of call.body.commands) {
          const doc = lang.TELEGRAM_COMMANDS.find((d) => d.command === `/${entry.command}`)
          assert.ok(entry.description.length >= 1 && entry.description.length <= 256, `${language} /${entry.command}: 1-256 characters`)
          if (language === 'en') assert.equal(entry.description, doc.en, `en /${entry.command} follows telegram_language`)
          else if (language === 'km') assert.equal(entry.description, doc.km, `km /${entry.command} follows telegram_language`)
          else assert.ok(entry.description.includes(doc.en) && entry.description.includes(doc.km), `both /${entry.command}`)
        }
      }
    }
    pass('plan: group = members, admins (all 9), each other chat (no /settopic, /topics), then four cleanup deletes; DM = one chat scope; ids only from settings; names are bare; descriptions follow the language')

    const plan = menu.commandMenuPlan({ alertsChatId: ALERTS_CHAT, chatIds: [ALERTS_CHAT, OTHER_CHAT], describe })
    const failWhen = (test, answer = { status: 400, json: { ok: false, description: 'Bad Request: chat not found' } }) => (method, body) => (test(method, body) ? answer : defaultAnswer(method))
    const isScope = (type, chat) => (method, body) => method === 'setMyCommands' && body.scope.type === type && (!chat || body.scope.chat_id === chat)
    reset()
    assert.deepEqual(await menu.runCommandMenu(TOKEN, plan), { menu: 'ok', failed: [] })
    assert.deepEqual(methods(), plan.map((call) => call.method))
    assert.ok(calls.every((call) => call.signal instanceof AbortSignal), 'every call can time out')
    reset(); respond = failWhen(isScope('chat', ALERTS_CHAT))
    assert.deepEqual(await menu.runCommandMenu(TOKEN, plan), { menu: 'failed', failed: ['alerts'] })
    assert.deepEqual(methods(), ['setMyCommands', 'setMyCommands', 'setMyCommands'], 'the alerts scope failed: every scope was tried, and the old menus are left as they were')
    reset(); respond = failWhen(isScope('chat_administrators'), { status: 200, json: { ok: false, description: 'Bad Request: not enough rights' } })
    assert.deepEqual(await menu.runCommandMenu(TOKEN, plan), { menu: 'failed', failed: ['alerts_admins'] }, 'ok:false in a 200 is a failure too')
    assert.ok(!methods().includes('deleteMyCommands'))
    reset(); respond = failWhen(isScope('chat', OTHER_CHAT))
    assert.deepEqual(await menu.runCommandMenu(TOKEN, plan), { menu: 'partial', failed: ['other_chat'] }, 'a stale second chat does not sink the menu')
    assert.equal(methods().filter((m) => m === 'deleteMyCommands').length, 4, 'and the cleanup still runs')
    reset(); respond = (method) => { if (method === 'deleteMyCommands') throw new Error('socket hang up'); return defaultAnswer(method) }
    assert.deepEqual(await menu.runCommandMenu(TOKEN, plan), { menu: 'partial', failed: ['cleanup'] }, 'a thrown fetch is a failed call, not a crash')
    pass('runner: one fetch per planned call with a timeout signal; alerts or admins failing = failed and no cleanup; another chat or cleanup failing = partial')

    for (const message of [{ text: '/help', chat: { id: Number(ALERTS_CHAT) }, from: { id: 42 } }, { text: '/report', chat: { id: Number(ALERTS_CHAT) }, from: { id: 42 } }, inTopic('/settopic sales')]) {
      reset()
      const out = await webhook(message)
      assert.equal(out.status, 200)
      assert.ok(methods().includes('sendMessage'), `${message.text} was answered`)
      assert.deepEqual(methods().filter((m) => MENU_METHODS.has(m) || m === 'setWebhook'), [], `${message.text}: the webhook never touches the menu, the status or the webhook`)
    }
    reset()
    let out = await request('POST', '/api/telegram/test')
    assert.deepEqual([out.status, out.json], [200, { success: true, menu: 'ok' }])
    assert.deepEqual(methods(), ['sendMessage', 'setWebhook', ...plan.map((call) => call.method)], 'Send test: the message, the webhook, then the menu')
    assert.deepEqual(routeAudits.map((a) => [a[3], a[4], a[6]]), [['test', 'telegram', { target: 'configured_chat', menu: 'ok' }]])
    reset()
    out = await request('POST', '/api/telegram/connect-commands')
    assert.deepEqual([out.status, out.json], [200, { success: true, menu: 'ok' }])
    assert.deepEqual(methods(), ['setWebhook', ...plan.map((call) => call.method)], 'connect-commands: the webhook, then the menu')
    reset(); respond = failWhen(isScope('chat', ALERTS_CHAT))
    out = await request('POST', '/api/telegram/connect-commands')
    assert.equal(out.status, 400); assert.equal(out.json.code, 'telegram_menu_failed')
    reset(); respond = failWhen(isScope('chat', ALERTS_CHAT))
    out = await request('POST', '/api/telegram/test')
    assert.deepEqual([out.status, out.json], [200, { success: true, menu: 'failed' }], 'a sent test message is not turned into an error by the menu')
    reset(); respond = failWhen(isScope('chat', OTHER_CHAT))
    out = await request('POST', '/api/telegram/connect-commands')
    assert.deepEqual([out.status, out.json], [200, { success: true, menu: 'partial' }])
    assert.ok(!JSON.stringify(routeAudits).includes(OTHER_CHAT), 'the audit row names roles, never a chat id')
    pass('entry points: the webhook makes no menu call; Send test = sendMessage, setWebhook, menu; connect-commands = setWebhook, menu; a failed alerts scope is 400 telegram_menu_failed there and a warning on Send test')

    const status = async (answer, runEnv = env, settings = BASE) => {
      reset(settings)
      if (answer) respond = (method, body, init) => (method === 'getWebhookInfo' ? answer(init) : defaultAnswer(method))
      const res = await request('GET', '/api/telegram/status', { runEnv })
      assert.equal(res.status, 200)
      return res.json
    }
    assert.deepEqual(await status(), { configured: true, connected: true, enabled: true, commands: 'connected' })
    const statusJson = JSON.stringify(await status())
    for (const hidden of ['admin.example.test', 'pending', '7', 'Wrong response', TOKEN]) assert.ok(!statusJson.includes(hidden), `status must not carry ${hidden}`)
    assert.equal((await status(() => ({ status: 200, json: { ok: true, result: { url: '' } } }))).commands, 'not_connected')
    assert.equal((await status(() => ({ status: 200, json: { ok: true, result: { url: 'https://elsewhere.example.test/api/telegram/webhook' } } }))).commands, 'not_connected')
    assert.equal((await status(() => ({ status: 502, json: {} }))).commands, 'unknown')
    assert.equal((await status(() => ({ status: 200, json: { ok: false } }))).commands, 'unknown')
    const started = Date.now()
    // AbortSignal.timeout's timer does not keep Node alive; this one does, until the abort arrives.
    const hung = await status((init) => new Promise((resolve, reject) => {
      const keepAlive = setTimeout(() => reject(new Error('the status call was never aborted')), 10000)
      init.signal?.addEventListener('abort', () => { clearTimeout(keepAlive); reject(init.signal.reason) })
    }))
    assert.ok(calls.find((call) => call.method === 'getWebhookInfo').signal instanceof AbortSignal, 'getWebhookInfo carries a timeout signal')
    assert.equal(hung.commands, 'unknown')
    assert.ok(Date.now() - started < 6000, 'a hung getWebhookInfo gives up after about three seconds')
    const tokenless = await status(null, { BUSINESS_OS_ADMIN_URL: ADMIN_URL })
    assert.deepEqual([tokenless.configured, tokenless.commands], [false, 'unknown'])
    assert.ok(!methods().includes('getWebhookInfo'), 'no token: Telegram is not asked')
    pass('status: commands is connected / not_connected (empty or another url) / unknown (HTTP error, ok:false, a 3 s timeout, no token); nothing of WebhookInfo is returned')

    log.lines.length = 0
    reset(); respond = (method) => (method === 'sendMessage' ? { status: 429, json: { ok: false, description: 'Too Many Requests: retry after 5' } } : defaultAnswer(method))
    out = await webhook({ text: '/help', chat: { id: Number(ALERTS_CHAT) }, from: { id: 42 } })
    assert.deepEqual([out.status, out.json], [200, { ok: true }], 'a failed reply is acknowledged, so Telegram does not re-run the command')
    reset(); respond = (method) => (method === 'sendMessage' ? { status: 429, json: { ok: false } } : defaultAnswer(method))
    const ctx = executionCtx()
    out = await webhook(inTopic('/settopic sales', 9002), ctx)
    await Promise.all(ctx.pending)
    assert.deepEqual([out.status, out.json], [200, { ok: true }])
    assert.equal(setting('telegram_topic_sales'), '9002', 'the save happened')
    assert.equal(MIGRATED.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity = 'settings'").get().n, 1, 'once, with one audit row')
    const warned = log.lines.filter((line) => line.includes('[telegram] webhook update failed'))
    assert.deepEqual(warned.map((line) => line.replace(/^.*webhook update failed:?\s*/, '')), ['telegram_rejected', 'telegram_rejected'], 'the log names the code only')
    assert.ok(!log.lines.join('\n').includes(TOKEN) && !warned.join('\n').includes(ALERTS_CHAT), 'no token or chat id in the log')
    pass('webhook: a reply Telegram refuses (429) still answers 200 {ok:true}; a /settopic whose reply failed is saved once with one audit row; the log carries the code only')

    let release
    broadcastImpl = () => new Promise((resolve) => { release = resolve })
    reset()
    const handed = []
    await topicSetting.saveTelegramTopicSetting(env, { keys: ['telegram_topic_returns'], threadId: 9004, actor: 'telegram:@owner', telegramUserId: '42', chatId: ALERTS_CHAT }, (p) => handed.push(p))
    assert.equal(setting('telegram_topic_returns'), '9004', 'saved before the call returns')
    assert.equal(MIGRATED.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity = 'settings'").get().n, 1, 'audited before the call returns')
    assert.equal(handed.length, 1, 'the cache bump and broadcast went to waitUntil')
    let settled = false
    handed[0].then(() => { settled = true })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(settled, false, 'the save did not wait for the broadcast')
    release(); await handed[0]
    reset()
    let done = false
    const awaited = topicSetting.saveTelegramTopicSetting(env, { keys: ['telegram_topic_returns'], threadId: 9004, actor: 'x', telegramUserId: '', chatId: ALERTS_CHAT }).then(() => { done = true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(done, false, 'without a waitUntil (tests, other callers) the refresh is awaited as before')
    release(); await awaited
    reset()
    const routeCtx = executionCtx()
    const routed = webhook(inTopic('/settopic stock', 9006), routeCtx)
    await new Promise((resolve) => setTimeout(resolve, 20))
    release()
    out = await routed
    assert.equal(out.status, 200)
    assert.equal(routeCtx.pending.length, 1, 'the webhook route hands the request its waitUntil')
    await Promise.all(routeCtx.pending)
    broadcastImpl = async () => {}
    pass('waitUntil: the topic save and audit resolve before the broadcast; without one the refresh is awaited; the webhook passes the request\'s waitUntil')

    assert.equal(permissions.hasPermission(MANAGER, 'settings'), true, 'the manager holds the full settings grant')
    assert.equal(permissions.isAdminControlUser(MANAGER), false)
    sessionUser = MANAGER
    for (const [method, url] of [['GET', '/api/telegram/status'], ['POST', '/api/telegram/test'], ['POST', '/api/telegram/today-summary'], ['POST', '/api/telegram/connect-commands']]) {
      reset()
      const res = await request(method, url)
      assert.equal(res.status, 403, `${method} ${url} for a settings-only manager`)
      assert.deepEqual(calls, [], `${url}: nothing sent`)
    }
    sessionUser = ADMIN
    reset()
    assert.equal((await request('GET', '/api/telegram/status')).status, 200)
    pass('gate: a manager with the full settings grant gets 403 on status, test, today-summary and connect-commands; an administrator passes (the Settings screen shows Telegram to administrators only)')

    assert.deepEqual([...telegram.TELEGRAM_ERROR_CODES].sort(), ['telegram_admin_url_invalid', 'telegram_chat_missing', 'telegram_menu_failed', 'telegram_rejected', 'telegram_token_missing', 'telegram_webhook_failed'])
    const failure = async (url, { settings = BASE, runEnv = env, answer } = {}) => {
      reset(settings)
      if (answer) respond = answer
      return request('POST', url, { runEnv })
    }
    let res = await failure('/api/telegram/test', { runEnv: { BUSINESS_OS_ADMIN_URL: ADMIN_URL } })
    assert.deepEqual([res.status, res.json], [400, { error: 'Telegram bot token is not configured on this Worker.', code: 'telegram_token_missing' }])
    res = await failure('/api/telegram/test', { settings: { telegram_language: 'both' } })
    assert.deepEqual([res.status, res.json], [400, { error: 'Enter the Telegram alerts chat ID in Settings.', code: 'telegram_chat_missing' }])
    res = await failure('/api/telegram/connect-commands', { runEnv: { TELEGRAM_BOT_TOKEN: TOKEN, BUSINESS_OS_ADMIN_URL: 'http://admin.example.test' } })
    assert.deepEqual([res.status, res.json.code], [400, 'telegram_admin_url_invalid'])
    assert.equal(res.json.error, 'A public HTTPS Business OS admin URL is required for Telegram commands.')
    res = await failure('/api/telegram/connect-commands', { answer: (method) => (method === 'setWebhook' ? { status: 500, json: {} } : defaultAnswer(method)) })
    assert.deepEqual([res.status, res.json], [400, { error: 'Telegram could not connect the command webhook (500).', code: 'telegram_webhook_failed' }])
    assert.deepEqual(methods(), ['setWebhook'], 'no menu after a failed webhook')
    res = await failure('/api/telegram/connect-commands', { answer: (method) => (method === 'setWebhook' ? { status: 200, json: { ok: false, description: 'Bad webhook: bad port' } } : defaultAnswer(method)) })
    assert.deepEqual([res.status, res.json.code], [400, 'telegram_webhook_failed'])
    res = await failure('/api/telegram/test', { answer: (method) => (method === 'sendMessage' ? { status: 400, json: { ok: false, description: 'Bad Request: chat not found' } } : defaultAnswer(method)) })
    assert.equal(res.status, 400); assert.equal(res.json.code, 'telegram_rejected')
    assert.match(res.json.error, /^Telegram rejected the message \(400\)/)
    res = await failure('/api/telegram/today-summary', { answer: (method) => (method === 'sendMessage' ? { status: 403, json: { ok: false } } : defaultAnswer(method)) })
    assert.deepEqual([res.status, res.json.code], [400, 'telegram_rejected'])
    pass('codes: token missing, chat missing, admin url invalid, webhook failed (HTTP and ok:false), rejected (test and today-summary) and menu failed, each with the message it always had')
    const settingsTranslatesCodes = /"telegram_error_/.test(fs.readFileSync(path.join(root, '..', 'frontend', 'src', 'lang', 'en.json'), 'utf8'))
    const telegramSource = fs.readFileSync(path.join(root, 'src', 'lib', 'telegram.ts'), 'utf8')
    assert.ok(settingsTranslatesCodes || !/Settings[^.\n]*translat|translat[^.\n]*Settings/.test(telegramSource), 'lib/telegram.ts must not say the Settings screen translates the codes: it shows the message and has no telegram_error_ keys')
    pass('codes: the Worker claims no translation the Settings screen does not do')

    for (const rel of ['lib/telegram.ts', 'lib/telegramLang.ts']) assert.ok(!/evening push/.test(fs.readFileSync(path.join(root, 'src', rel), 'utf8')), `${rel}: no evening push exists`)
    reset({ ...BASE, telegram_topic_alerts: '9008' })
    let first = true
    respond = (method) => {
      if (method === 'sendMessage' && first) { first = false; return { status: 400, json: { ok: false, description: 'Bad Request: message thread not found' } } }
      return defaultAnswer(method)
    }
    log.lines.length = 0
    await telegram.sendTelegramTest(env)
    assert.equal(calls[0].body.message_thread_id, 9008)
    assert.ok(log.lines.some((line) => line.includes('telegram_topic_alerts')), `a deleted alerts topic is named by its setting: ${log.lines.join(' | ')}`)
    pass('housekeeping: no "evening push" comment is left; the test message names telegram_topic_alerts when its topic is gone')

    finished = true
    console.log(`test-telegram-command-menu-pure: ${checks} checks ok (fetch stubbed; nothing sent)`)
  } finally {
    log.restore()
    globalThis.fetch = realFetch
  }
})().catch((error) => { console.error(error); process.exit(1) })
