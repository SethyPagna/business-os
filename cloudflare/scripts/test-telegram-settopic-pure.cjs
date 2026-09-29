// Owner, 27 Sep 2026: set Telegram forum topics from INSIDE Telegram, and give
// customer returns their own family and topic.
//
// Pins, over a real SQLite settings table and a fetch stub that only RECORDS
// (nothing is sent to any chat, no real token exists here):
//   1. The family list: eight families, each named with the Settings screen's
//      own words from BOTH lang packs (telegram_topic_<family>_label), so the
//      bot and the app cannot drift; English and Khmer aliases resolve;
//      `general` is the reset word, not a family.
//   2. Composed replies, asserted as text in 'both', 'en' and 'km'.
//   3. /settopic's gate: saves only in THIS deployment's configured alerts
//      chat, only inside a forum topic (or a reset), only for a group admin
//      (or an anonymous admin); a second approved chat, a plain member, a
//      failed admin check, General, and a reply-thread in a non-forum group all
//      save nothing. Replies go back into the topic they were typed in.
//   4. The writer: the shared digits-or-empty rule, the same upsert, an audit
//      row naming the Telegram sender, the settings cache bump and broadcast;
//      a reset stores '' (General), exactly what clearing the field does.
//   5. Returns: a customer return goes to the returns topic ONLY (not also to
//      sales); its switch defaults to the Sales switch; cancel/restore alerts
//      are bilingual and routed the same way; supplier returns stay stock-out.
//   6. The routes call the senders (source pins) and no topic id is
//      hard-coded in the Telegram modules.
//
// Run (from cloudflare/): node scripts/test-telegram-settopic-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'))

function load(file, overrides = {}) {
  const filePath = path.join(root, 'src', file)
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
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

// ---- modules ---------------------------------------------------------------
const dbHolder = { db: null }
const dbModule = { getDb: () => dbHolder.db }
const businessDateWindow = load('lib/businessDateWindow.ts')
const moneyPrecision = load('lib/moneyPrecision.ts')
const reportMoneyPrecision = load('lib/reportMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const promotionRules = load('lib/promotionRules.ts', { './moneyPrecision': moneyPrecision })
const saleItemPricing = load('lib/saleItemPricing.ts', { './moneyPrecision': moneyPrecision, './promotionRules': promotionRules })
const saleMoneyPrecision = load('lib/saleMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const refundMoneyPrecision = load('lib/refundMoneyPrecision.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const customerReturnEntitlement = load('lib/customerReturnEntitlement.ts', { './moneyPrecision': moneyPrecision, './refundMoneyPrecision': refundMoneyPrecision, './saleItemPricing': saleItemPricing, './saleMoneyPrecision': saleMoneyPrecision })
const analyticsPrecision = { './saleMoneyPrecision': saleMoneyPrecision, './reportMoneyPrecision': reportMoneyPrecision, './customerReturnEntitlement': customerReturnEntitlement, './refundMoneyPrecision': refundMoneyPrecision }
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
const audits = []
const bumps = []
const broadcasts = []
const topicSetting = load('lib/telegramTopicSetting.ts', {
  './db': dbModule,
  './audit': { audit: async (...args) => { audits.push(args) }, changedFields: load('lib/audit.ts', { './db': dbModule }).changedFields },
  './cache': { bumpVersion: async (_env, namespace) => { bumps.push(namespace) } },
  '../durable-objects/broadcastHub': { broadcast: async (_env, channel, payload) => { broadcasts.push({ channel, payload }) } },
  './telegram': telegram,
})

const packs = {
  en: JSON.parse(fs.readFileSync(path.join(root, '..', 'frontend', 'src', 'lang', 'en.json'), 'utf8')),
  km: JSON.parse(fs.readFileSync(path.join(root, '..', 'frontend', 'src', 'lang', 'km.json'), 'utf8')),
}

// ---- a real settings table + the tables the return alerts read -------------
const ALERTS_CHAT = '-1001111111111' // a made-up forum group id, not the shop's
const OTHER_APPROVED_CHAT = '-1002222222222'
// Made-up topic ids, a different one per family, so an assertion that tells two
// families apart cannot pass by coincidence.
const TOPIC = { shift: 9001, sales: 9002, status: 9003, returns: 9004, expenses: 9005, stock: 9006, reports: 9007, alerts: 9008 }
function makeDb(settings) {
  const sql = new Database(':memory:')
  sql.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE branches (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE returns (id INTEGER PRIMARY KEY, return_number TEXT, status TEXT, return_scope TEXT, receipt_number TEXT,
      customer_name TEXT, supplier_name TEXT, branch_id INTEGER, total_refund_usd REAL, total_refund_khr REAL);
    CREATE TABLE return_items (id INTEGER PRIMARY KEY, return_id INTEGER, product_id INTEGER, branch_id INTEGER, batch_id INTEGER,
      product_name TEXT, quantity REAL, total_usd REAL, stock_action TEXT);
    CREATE TABLE product_batches (id INTEGER PRIMARY KEY, lot_code TEXT, received_at TEXT);
    CREATE TABLE branch_stock (id INTEGER PRIMARY KEY, product_id INTEGER, branch_id INTEGER, quantity REAL);
    CREATE TABLE products (id INTEGER PRIMARY KEY, stock_quantity REAL);
    CREATE TABLE return_replacement_items (id INTEGER PRIMARY KEY, return_id INTEGER, product_name TEXT, quantity REAL);
    INSERT INTO branches VALUES (1, 'Store');
    INSERT INTO returns VALUES (5, 'RET-0005', 'cancelled', 'customer', '20260927-101500', 'Dara', NULL, 1, 12.5, 0);
    INSERT INTO returns VALUES (6, 'RET-0006', 'completed', 'customer', '20260927-111500', 'Sokha', NULL, 1, 4, 0);
    INSERT INTO returns VALUES (7, 'SRET-0007', 'cancelled', 'supplier', NULL, NULL, 'Acme', 1, 0, 0);
    INSERT INTO products VALUES (1, 9);
    INSERT INTO branch_stock VALUES (1, 1, 1, 9);
    INSERT INTO return_items VALUES (1, 6, 1, 1, NULL, 'Face cream', 1, 4, 'restock');
  `)
  const put = sql.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
  for (const [key, value] of Object.entries(settings)) put.run(key, value)
  const bind = (query, params) => {
    if (Array.isArray(params)) return { stmt: sql.prepare(query), values: params }
    const values = []
    const text = query.replace(/@(\w+)/g, (_, key) => { values.push((params || {})[key] ?? null); return '?' })
    return { stmt: sql.prepare(text), values }
  }
  return {
    sql,
    prepare(query) {
      return {
        async get(params) { const b = bind(query, params); return b.stmt.get(...b.values) },
        async all(params) { const b = bind(query, params); return b.stmt.all(...b.values) },
        async run(params) { const b = bind(query, params); return b.stmt.run(...b.values) },
      }
    },
    async batch(statements) {
      return sql.transaction(() => statements.map(({ sql: q, params }) => { const b = bind(q, params); return b.stmt.run(...b.values) }))()
    },
  }
}
const BASE = { telegram_chat_id: `${ALERTS_CHAT},${OTHER_APPROVED_CHAT}`, telegram_language: 'both' }
const env = { TELEGRAM_BOT_TOKEN: 'test-token-not-a-real-one' }

// A fetch stub. sendMessage is recorded; getChatMember answers `memberStatus`.
let sent = []
let memberCalls = []
let memberStatus = 'administrator'
let memberOk = true
// getMe answers this bot's own @name (E4); Telegram's case, compared without it.
let meCalls = 0
let meOk = true
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  assert.match(String(url), /^https:\/\/api\.telegram\.org\/bot/, 'only the Telegram API is ever called')
  const body = JSON.parse(init.body)
  if (/\/getMe$/.test(url)) {
    meCalls += 1
    if (!meOk) return { ok: false, status: 502, text: async () => '', json: async () => ({ ok: false }) }
    return { ok: true, status: 200, text: async () => '', json: async () => ({ ok: true, result: { id: 7001, is_bot: true, username: 'Shop_Bot' } }) }
  }
  if (/\/getChatMember$/.test(url)) {
    memberCalls.push(body)
    if (!memberOk) return { ok: false, status: 500, text: async () => '', json: async () => ({ ok: false }) }
    return { ok: true, status: 200, text: async () => '', json: async () => ({ ok: true, result: { status: memberStatus } }) }
  }
  sent.push(body)
  return { ok: true, status: 200, text: async () => '', json: async () => ({ ok: true }) }
}

;(async () => {
  try {
    // ---- 1. families ----------------------------------------------------------
    const families = lang.TELEGRAM_TOPIC_FAMILIES
    assert.deepEqual(families.map((entry) => entry.family), ['shift', 'sales', 'status', 'returns', 'expenses', 'stock', 'reports', 'alerts'])
    assert.deepEqual([...families.map((entry) => entry.key)].sort(), [...telegram.TELEGRAM_TOPIC_KEYS].sort(), 'one family per settings key')
    assert.deepEqual(Object.keys(TOPIC), families.map((entry) => entry.family), 'the fixture names every family')
    assert.equal(new Set(Object.values(TOPIC)).size, families.length, 'every family has its own fixture topic id')
    for (const entry of families) {
      const packKey = `${entry.key}_label`
      assert.equal(entry.en, packs.en[packKey], `${entry.family}: English must be en.json ${packKey}`)
      assert.equal(entry.km, packs.km[packKey], `${entry.family}: Khmer must be km.json ${packKey}`)
      assert.ok(KHMER.test(entry.km) && !KHMER.test(entry.en), `${entry.family}: scripts`)
    }
    const r = (text) => { const out = lang.resolveTopicFamilies(text); return { f: out.families.map((e) => e.family), u: out.unknown, reset: out.reset } }
    assert.deepEqual(r('sales'), { f: ['sales'], u: [], reset: false })
    assert.deepEqual(r('SALES@x'), { f: [], u: ['SALES@x'], reset: false }, 'an unknown word is reported, never guessed')
    assert.deepEqual(r('លក់'), { f: ['sales'], u: [], reset: false }, 'Khmer alias')
    assert.deepEqual(r('​ប្រគល់'), { f: ['returns'], u: [], reset: false }, 'a Khmer keyboard zero-width space is ignored')
    assert.deepEqual(r('stock, expenses stock'), { f: ['stock', 'expenses'], u: [], reset: false }, 'several at once, no duplicates')
    assert.deepEqual(r('summary'), { f: ['reports'], u: [], reset: false }, "the owner's 'Summary' topic name is the reports family")
    assert.deepEqual(r('sales general'), { f: ['sales'], u: [], reset: true })
    assert.deepEqual(r('telegram_topic_shift'), { f: ['shift'], u: [], reset: false }, 'the settings key itself is accepted')
    pass('families: eight, named with both packs\' Settings labels; English + Khmer aliases; "general" resets')

    // ---- 2. composed text -----------------------------------------------------
    lang.setTelegramLanguage('both')
    const overview = telegram.formatTopicsOverview({ telegram_topic_sales: TOPIC.sales, telegram_topic_returns: TOPIC.returns })
    assert.equal(overview, [
      '📌 Forum topics/ប្រធានបទក្នុងវេទិកា',
      '· Shift reports/របាយការណ៍វេន: Group (General)/ក្រុម (General)',
      `· Sale invoices/វិក្កយបត្រលក់: ${TOPIC.sales}`,
      '· Status updates/ការផ្លាស់ប្ដូរស្ថានភាព: Group (General)/ក្រុម (General)',
      `· Returns/ការប្រគល់មកវិញ: ${TOPIC.returns}`,
      '· Expenses & fees/ចំណាយ និងថ្លៃសេវា: Group (General)/ក្រុម (General)',
      '· Stock in/out/ស្តុកចូល/ចេញ: Group (General)/ក្រុម (General)',
      "· Day's summary/សេចក្តីសង្ខេបប្រចាំថ្ងៃ: Group (General)/ក្រុម (General)",
      '· Test & alerts/សាកល្បង និងការជូនដំណឹង: Group (General)/ក្រុម (General)',
      '',
      'Change it inside the topic/ប្ដូរនៅក្នុងប្រធានបទនោះ: /settopic sales',
      'Back to the group/ត្រឡប់ទៅក្រុមវិញ: /settopic sales general',
    ].join('\n'))
    const salesFamily = families.find((entry) => entry.family === 'sales')
    assert.equal(telegram.formatTopicSaved([salesFamily], TOPIC.sales), [
      '✅ This topic will now receive/ប្រធានបទនេះនឹងទទួល:',
      '· Sale invoices/វិក្កយបត្រលក់',
      `· Topic ID/លេខសម្គាល់ប្រធានបទ: ${TOPIC.sales}`,
    ].join('\n'))
    assert.equal(telegram.formatTopicSaved([salesFamily], null), [
      '✅ These now go to the group/ទាំងនេះនឹងផ្ញើទៅក្រុមវិញ:',
      '· Sale invoices/វិក្កយបត្រលក់',
      '· Sent to/ផ្ញើទៅ: Group (General)/ក្រុម (General)',
    ].join('\n'))
    lang.setTelegramLanguage('km')
    assert.equal(telegram.formatTopicSaved([salesFamily], TOPIC.sales), `✅ ប្រធានបទនេះនឹងទទួល:\n· វិក្កយបត្រលក់\n· លេខសម្គាល់ប្រធានបទ: ${TOPIC.sales}`)
    lang.setTelegramLanguage('en')
    assert.equal(telegram.formatTopicSaved([salesFamily], TOPIC.sales), `✅ This topic will now receive:\n· Sale invoices\n· Topic ID: ${TOPIC.sales}`)
    assert.ok(!KHMER.test(telegram.formatTopicsOverview({})), 'English-only overview carries no Khmer')
    lang.setTelegramLanguage('both')
    const usage = telegram.formatSetTopicUsage(TOPIC.sales)
    assert.ok(usage.startsWith(`🧵 Topic ID/លេខសម្គាល់ប្រធានបទ: ${TOPIC.sales}`), usage)
    for (const entry of families) assert.ok(usage.includes(`· /settopic ${entry.family}: ${entry.en}/${entry.km}`), `usage lists ${entry.family}`)
    assert.ok(usage.includes('/settopic sales general'), 'usage shows the reset')
    const reference = lang.telegramCommandReference()
    assert.ok(reference.includes('🧵 /settopic [type]: Send a type to this topic') && reference.includes('ផ្ញើប្រភេទមួយមកប្រធានបទនេះ'), reference)
    assert.ok(reference.includes('📌 /topics: Where each type is sent') && reference.includes('ប្រភេទនីមួយៗផ្ញើទៅណា'), reference)
    assert.ok(!/[*_[\]`]/.test(overview + usage), 'plain text: nothing a parse mode would eat')
    pass('replies: /topics shows "Group (General)" for unset families; saved/reset confirmations in both, en and km; help lists both commands')

    // ---- 3. the gate, end to end through handleTelegramWebhook ------------------
    const saves = []
    const deps = { saveTopics: async (_env, save) => { saves.push(save) } }
    const run = async (message, settings = BASE, runEnv = env) => {
      dbHolder.db = makeDb(settings); sent = []; memberCalls = []; saves.length = 0
      await telegram.handleTelegramWebhook(runEnv, { message }, deps)
      return sent
    }
    const inTopic = (text, extra = {}) => ({ text, chat: { id: Number(ALERTS_CHAT) }, from: { id: 42, username: 'owner' }, message_thread_id: TOPIC.sales, is_topic_message: true, ...extra })

    let out = await run(inTopic('/settopic sales'))
    assert.deepEqual(saves, [{ keys: ['telegram_topic_sales'], threadId: TOPIC.sales, actor: 'telegram:@owner', telegramUserId: '42', chatId: ALERTS_CHAT }])
    assert.deepEqual(memberCalls, [{ chat_id: ALERTS_CHAT, user_id: 42 }], 'admin rights were checked with Telegram for this chat and sender')
    assert.equal(out.length, 1); assert.equal(out[0].message_thread_id, TOPIC.sales, 'the confirmation lands in the topic it was typed in')
    assert.equal(out[0].chat_id, ALERTS_CHAT)
    assert.ok(out[0].text.startsWith('✅ This topic will now receive/ប្រធានបទនេះនឹងទទួល:\n· Sale invoices/វិក្កយបត្រលក់'), out[0].text)
    pass(`/settopic sales in topic ${TOPIC.sales} by an admin: saves telegram_topic_sales=${TOPIC.sales}, confirms bilingually in topic ${TOPIC.sales}`)

    out = await run(inTopic('/settopic@shop_bot returns', { message_thread_id: TOPIC.returns }))
    assert.deepEqual(saves.map((s) => [s.keys, s.threadId]), [[['telegram_topic_returns'], TOPIC.returns]], 'a command addressed to THIS bot runs')

    // E4 (R-telegram, 27 Sep 2026): with privacy mode off every bot in the
    // group receives "/settopic@other_bot"; the name says whose it is. Our own
    // name is getMe's, compared without case.
    out = await run(inTopic('/settopic@other_bot returns'))
    assert.equal(saves.length, 0, '/settopic@other_bot must not save anything')
    assert.equal(out.length, 0, `and must not answer: ${JSON.stringify(out)}`)
    assert.equal(memberCalls.length, 0, 'nor ask Telegram about the sender')
    out = await run(inTopic('/topics@other_bot'))
    assert.equal(out.length, 0, 'a read command addressed to another bot is not answered either')
    out = await run(inTopic('/settopic@SHOP_BOT returns'))
    assert.equal(saves.length, 1, 'the name is compared without case')
    assert.ok(meCalls >= 1, 'the bot learned its own name from getMe')
    const callsOnceKnown = meCalls
    await run(inTopic('/settopic@shop_bot returns'))
    assert.equal(meCalls, callsOnceKnown, 'and asks once per isolate, not on every command')
    // getMe fails (a fresh token, so nothing is cached): an addressed WRITE is
    // refused silently -- it cannot be shown to be ours -- while a read and an
    // unaddressed command behave as they always did.
    meOk = false
    const envFresh = { TELEGRAM_BOT_TOKEN: 'second-test-token-not-a-real-one' }
    out = await run(inTopic('/settopic@shop_bot returns'), BASE, envFresh)
    assert.equal(saves.length, 0, 'own name unknown: an addressed /settopic saves nothing')
    assert.equal(out.length, 0, 'and answers nothing')
    out = await run(inTopic('/topics@shop_bot'), BASE, envFresh)
    assert.equal(out.length, 1, 'own name unknown: an addressed read still answers')
    out = await run(inTopic('/settopic returns'), BASE, envFresh)
    assert.equal(saves.length, 1, 'an unaddressed /settopic never needs the name')
    meOk = true
    pass('E4: /settopic@other_bot and /topics@other_bot are ignored; @SHOP_BOT matches; name unknown -> addressed write refused, reads unchanged')

    memberStatus = 'member'
    out = await run(inTopic('/settopic sales'))
    assert.equal(saves.length, 0, 'a plain member saves nothing')
    assert.ok(out[0].text.includes('Only a group admin can change where reports go.'), out[0].text)
    memberStatus = 'creator'
    await run(inTopic('/settopic sales'))
    assert.equal(saves.length, 1, 'the group creator may')
    memberOk = false
    out = await run(inTopic('/settopic sales'))
    assert.equal(saves.length, 0, 'an admin check that failed saves nothing')
    assert.ok(out[0].text.includes('Could not check your admin rights. Try again.'), out[0].text)
    memberOk = true; memberStatus = 'administrator'
    await run(inTopic('/settopic sales', { from: { id: 1087968824 }, sender_chat: { id: Number(ALERTS_CHAT) } }))
    assert.deepEqual(saves.map((s) => s.actor), ['telegram:anonymous group admin'], 'an anonymous admin posts as the group, and only an admin can')
    assert.equal(memberCalls.length, 0)
    // E7 (R-telegram): that pass is for a post made AS THIS GROUP. Any member
    // can post as a channel they own, and a linked channel's posts arrive with
    // its own sender_chat; neither is an admin act. The sender is then checked
    // like anyone else (Telegram's Channel_Bot user, a plain member here). The
    // second case uses the OTHER approved chat, so "any approved chat counts"
    // fails here as well as "any sender_chat counts".
    memberStatus = 'member'
    for (const senderChat of [-1003333333333, Number(OTHER_APPROVED_CHAT)]) {
      out = await run(inTopic('/settopic sales', { from: { id: 136817688 }, sender_chat: { id: senderChat } }))
      assert.equal(saves.length, 0, `a post made as chat ${senderChat} must not save`)
      assert.deepEqual(memberCalls, [{ chat_id: ALERTS_CHAT, user_id: 136817688 }], 'its sender is checked with Telegram like anyone else')
      assert.equal(out.length, 1)
      assert.ok(out[0].text.includes('Only a group admin can change where reports go.'), out[0].text)
    }
    memberStatus = 'administrator'
    pass('admin gate: member refused, creator and anonymous admin allowed, a post made as another chat refused, a failed check refuses with "try again"')

    out = await run(inTopic('/settopic sales', { chat: { id: Number(OTHER_APPROVED_CHAT) } }))
    assert.equal(saves.length, 0); assert.equal(memberCalls.length, 0)
    assert.equal(out[0].chat_id, OTHER_APPROVED_CHAT)
    assert.ok(out[0].text.includes("Topics can only be set in the shop's alerts group."), out[0].text)
    out = await run(inTopic('/topics', { chat: { id: Number(OTHER_APPROVED_CHAT) } }))
    assert.ok(!out[0].text.includes('Forum topics'), 'a second approved chat is not told where this shop\'s messages go')
    out = await run(inTopic('/settopic sales', { chat: { id: -1009999 } }))
    assert.equal(saves.length, 0)
    assert.ok(out[0].text.includes('This chat is not approved'), 'an unapproved chat gets the standard refusal')
    pass('chat gate: only this deployment\'s configured alerts chat can set or list topics; another approved chat and an unapproved one are refused')

    out = await run({ text: '/settopic sales', chat: { id: Number(ALERTS_CHAT) }, from: { id: 42 } })
    assert.equal(saves.length, 0, 'General has no topic to store')
    assert.ok(!('message_thread_id' in out[0]))
    assert.ok(out[0].text.includes('This is the group (General). Open the topic you want, then type /settopic sales there.'), out[0].text)
    assert.ok(out[0].text.includes('/settopic sales general'))
    // A reply thread in a NON-forum group carries message_thread_id too; it is
    // not a topic, so it must not be stored as one.
    await run({ text: '/settopic sales', chat: { id: Number(ALERTS_CHAT) }, from: { id: 42 }, message_thread_id: 55, is_topic_message: false })
    assert.equal(saves.length, 0, 'a reply thread is not a forum topic')
    pass('General: /settopic sales is refused with a usable instruction; a non-forum reply thread is not mistaken for a topic')

    out = await run({ text: '/settopic sales general', chat: { id: Number(ALERTS_CHAT) }, from: { id: 42, first_name: 'Sethy' } })
    assert.deepEqual(saves.map((s) => [s.keys, s.threadId, s.actor]), [[['telegram_topic_sales'], null, 'telegram:Sethy']])
    assert.ok(out[0].text.includes('These now go to the group') && out[0].text.includes('Group (General)/ក្រុម (General)'), out[0].text)
    pass('/settopic sales general: resets the family to the group, from General or any topic, and says so')

    out = await run(inTopic('/settopic'))
    assert.equal(saves.length, 0); assert.equal(memberCalls.length, 0, 'reading needs no admin check')
    assert.ok(out[0].text.startsWith(`🧵 Topic ID/លេខសម្គាល់ប្រធានបទ: ${TOPIC.sales}`), out[0].text)
    out = await run(inTopic('/settopic salez'))
    assert.equal(saves.length, 0)
    assert.ok(out[0].text.startsWith('🤔 I do not know the type "salez"./មិនស្គាល់ប្រភេទ "salez" ទេ។'), out[0].text)
    out = await run(inTopic('/topics'), { ...BASE, telegram_topic_shift: String(TOPIC.shift), telegram_topic_sales: String(TOPIC.sales) })
    assert.ok(out[0].text.includes(`· Shift reports/របាយការណ៍វេន: ${TOPIC.shift}`) && out[0].text.includes(`· Sale invoices/វិក្កយបត្រលក់: ${TOPIC.sales}`) && out[0].text.includes('· Status updates/ការផ្លាស់ប្ដូរស្ថានភាព: Group (General)/ក្រុម (General)'), out[0].text)
    out = await run(inTopic('/settopic sales'), { ...BASE, telegram_language: 'km' })
    assert.equal(out[0].text, `✅ ប្រធានបទនេះនឹងទទួល:\n· វិក្កយបត្រលក់\n· លេខសម្គាល់ប្រធានបទ: ${TOPIC.sales}`, 'the reply follows the shop\'s language setting')
    pass('/settopic with no type shows this topic\'s id; an unknown type lists the choices; /topics reads stored ids; replies follow the language setting')

    // ---- 4. the writer ----------------------------------------------------------
    dbHolder.db = makeDb({ ...BASE, telegram_topic_sales: '12' })
    audits.length = 0; bumps.length = 0; broadcasts.length = 0
    await topicSetting.saveTelegramTopicSetting(env, { keys: ['telegram_topic_sales', 'telegram_topic_returns'], threadId: TOPIC.sales, actor: 'telegram:@owner', telegramUserId: '42', chatId: ALERTS_CHAT })
    const stored = Object.fromEntries(dbHolder.db.sql.prepare("SELECT key, value FROM settings WHERE key LIKE 'telegram_topic_%'").all().map((row) => [row.key, row.value]))
    assert.deepEqual(stored, { telegram_topic_sales: String(TOPIC.sales), telegram_topic_returns: String(TOPIC.sales) })
    assert.equal(audits.length, 1)
    const [, userId, actor, action, entity, entityId, details, change] = audits[0]
    assert.deepEqual([userId, actor, action, entity, entityId], [null, 'telegram:@owner', 'update', 'settings', null])
    assert.deepEqual(details, { keys: ['telegram_topic_sales', 'telegram_topic_returns'], source: 'telegram', command: '/settopic', telegram_user_id: '42', chat_id: ALERTS_CHAT, thread_id: TOPIC.sales })
    assert.equal(change.before.telegram_topic_sales, '12'); assert.equal(change.after.telegram_topic_sales, String(TOPIC.sales))
    assert.deepEqual(bumps, ['settings'], 'the settings cache version is bumped, as the settings route does')
    assert.deepEqual(broadcasts, [{ channel: 'settings', payload: { action: 'update', keys: ['telegram_topic_sales', 'telegram_topic_returns'] } }])
    await topicSetting.saveTelegramTopicSetting(env, { keys: ['telegram_topic_sales'], threadId: null, actor: 'telegram:@owner', telegramUserId: '42', chatId: ALERTS_CHAT })
    assert.equal(dbHolder.db.sql.prepare("SELECT value FROM settings WHERE key='telegram_topic_sales'").get().value, '', 'a reset stores empty = General')
    await assert.rejects(topicSetting.saveTelegramTopicSetting(env, { keys: ['telegram_topic_sales'], threadId: -5, actor: 'x', telegramUserId: '', chatId: ALERTS_CHAT }), /whole number/)
    await assert.rejects(topicSetting.saveTelegramTopicSetting(env, { keys: ['telegram_chat_id'], threadId: 5, actor: 'x', telegramUserId: '', chatId: ALERTS_CHAT }), /No Telegram topic setting/, 'only topic keys can be written, never the chat id')
    assert.equal(dbHolder.db.sql.prepare("SELECT value FROM settings WHERE key='telegram_chat_id'").get().value, BASE.telegram_chat_id)
    pass('writer: same digits-or-empty rule, upsert, audit row naming the Telegram sender with before/after, settings bump + broadcast; reset stores ""; cannot touch telegram_chat_id')

    // ---- 5. returns ---------------------------------------------------------------
    const routed = { ...BASE, telegram_topic_sales: String(TOPIC.sales), telegram_topic_status: String(TOPIC.status), telegram_topic_returns: String(TOPIC.returns), telegram_topic_stock: String(TOPIC.stock) }
    dbHolder.db = makeDb(routed); sent = []
    await telegram.sendReturnTelegramEvent(env, 6, { kind: 'customer', returnNumber: 'RET-0006', receiptNumber: '20260927-111500', party: 'Sokha', branch: 'Store', reason: 'Wrong shade', returnType: 'refund', refundUsd: 4, refundKhr: 0, by: 'za' })
    assert.equal(sent.length, 1, 'one message, not one in Returns AND one in Sales')
    assert.equal(sent[0].message_thread_id, TOPIC.returns, 'a customer return goes to the returns topic')
    assert.ok(sent[0].text.startsWith('↩️ Return recorded/បានកត់ត្រាការប្រគល់មកវិញ'), sent[0].text)
    dbHolder.db = makeDb(routed); sent = []
    await telegram.sendReturnTelegramEvent(env, 7, { kind: 'supplier', returnNumber: 'SRET-0007', party: 'Acme', by: 'za' })
    assert.equal(sent[0].message_thread_id, TOPIC.stock, 'a supplier return stays a stock-out')

    // Default: unset returns switch follows Sales.
    for (const [settings, expected, why] of [
      [routed, 1, 'both unset: on'],
      [{ ...routed, telegram_sales_enabled: 'false' }, 0, 'Sales off, returns unset: off, as before the split'],
      [{ ...routed, telegram_sales_enabled: 'false', telegram_returns_enabled: 'true' }, 1, 'returns switched on explicitly'],
      [{ ...routed, telegram_returns_enabled: 'false' }, 0, 'returns switched off explicitly'],
    ]) {
      dbHolder.db = makeDb(settings); sent = []
      await telegram.sendReturnTelegramEvent(env, 6, { kind: 'customer', returnNumber: 'RET-0006', by: 'za' })
      assert.equal(sent.length, expected, why)
    }
    pass(`returns: one message, in the returns topic (${TOPIC.returns}) only; supplier returns stay stock; unset switch follows Sales`)

    lang.setTelegramLanguage('both')
    assert.deepEqual(telegram.formatReturnStatusTelegramLines({ kind: 'customer', returns: [{ returnNumber: 'RET-0005', receiptNumber: '20260927-101500', party: 'Dara', branch: 'Store', refundUsd: 12.5, refundKhr: 0 }], by: 'za', nowMs: Date.parse('2026-09-27T03:00:00Z') }), [
      'Date: 27/09/2026 10:00', 'RET: RET-0005', 'INV: 20260927-101500', 'Customer: Dara', 'Branch: Store', 'Refund: $12.50', 'By: za',
    ])
    dbHolder.db = makeDb(routed); sent = []
    await telegram.sendReturnStatusTelegramEvents(env, [5, 6, 7, 5], 'za')
    assert.equal(sent.length, 3, 'one message per (kind, status) group; a duplicated id counts once')
    const cancelled = sent.find((m) => m.text.startsWith('🚫 Return cancelled'))
    const restored = sent.find((m) => m.text.startsWith('♻️ Return restored'))
    const supplier = sent.find((m) => m.text.startsWith('🚫 Supplier return cancelled'))
    assert.ok(cancelled && restored && supplier, sent.map((m) => m.text).join('\n---\n'))
    assert.equal(cancelled.message_thread_id, TOPIC.returns); assert.equal(restored.message_thread_id, TOPIC.returns); assert.equal(supplier.message_thread_id, TOPIC.stock)
    const cancelledLines = cancelled.text.split('\n')
    assert.equal(cancelledLines[0], '🚫 Return cancelled/បានបោះបង់ការប្រគល់មកវិញ')
    assert.ok(KHMER.test(cancelledLines.slice(1).join('\n')), `the rows are bilingual too:\n${cancelled.text}`)
    assert.ok(cancelled.text.includes('RET-0005') && cancelled.text.includes('Dara') && cancelled.text.includes('$12.50') && cancelled.text.includes('za'), cancelled.text)
    assert.equal(restored.text.split('\n')[0], '♻️ Return restored/បានស្ដារការប្រគល់មកវិញ')
    dbHolder.db = makeDb({ ...routed, telegram_language: 'km' }); sent = []
    await telegram.sendReturnStatusTelegramEvents(env, [5], 'za')
    assert.equal(sent[0].text.split('\n')[0], '🚫 បានបោះបង់ការប្រគល់មកវិញ')
    pass(`return cancel/restore: bilingual headings, returns topic ${TOPIC.returns} for customer, stock for supplier; sample:\n${cancelled.text}`)

    // ---- 6. wiring ------------------------------------------------------------------
    const read = (rel) => fs.readFileSync(path.join(root, 'src', rel), 'utf8')
    const returnsRoute = read('routes/returns.ts')
    // Source pin only. The BEHAVIOUR -- one write is one message, even when the
    // app's retry overtakes a slow original -- is pinned by
    // test-returns-bulk-telegram-once-native.cjs (R-telegram E1).
    assert.match(returnsRoute, /wrote && body\.field === 'status' && changedIds\.length\) \{\s*c\.executionCtx\.waitUntil\(sendReturnStatusTelegramEvents\(c\.env, changedIds, actorSnapshot\(user\)\)/, 'bulk status change announces only the changed ids, and only from the call whose batch wrote them')
    const historyRoute = read('routes/actionHistory.ts')
    assert.match(historyRoute, /applier\.name === RETURN_BULK_ACTION_KIND && payload\.field === 'status'[\s\S]{0,400}sendReturnStatusTelegramEvents/, 'undo/redo of a return status change is announced')
    assert.match(read('routes/telegram.ts'), /handleTelegramWebhook\(c\.env, update, \{ saveTopics: saveTelegramTopicSetting, waitUntil: \(work\) => c\.executionCtx\.waitUntil\(work\) \}\)/)
    for (const rel of ['lib/telegram.ts', 'lib/telegramLang.ts', 'lib/telegramTopicSetting.ts', 'routes/telegram.ts']) {
      const source = read(rel)
      assert.ok(!/(message_thread_id|messageThreadId|threadId|telegram_topic_[a-z]+)['"]?\s*[:=]\s*['"]?\d/.test(source), `${rel} must take every topic id from settings, never a literal`)
      for (const id of Object.values(TOPIC)) assert.ok(!new RegExp(`\\b${id}\\b`).test(source), `${rel} must not carry this test's topic id ${id}`)
    }
    const settingsUi = fs.readFileSync(path.join(root, '..', 'frontend', 'src', 'components', 'utils-settings', 'Settings.tsx'), 'utf8')
    for (const key of telegram.TELEGRAM_TOPIC_KEYS) assert.ok(settingsUi.includes(`['${key}', t('${key}_label')`), `Settings has a field for ${key}`)
    assert.ok(settingsUi.includes("['telegram_returns_enabled', t('telegram_cat_returns')"), 'Settings has the returns switch')
    for (const key of ['telegram_cat_returns', 'telegram_cat_returns_desc', 'telegram_topic_returns_label', 'telegram_topics_command_help']) {
      assert.ok(packs.en[key] && packs.km[key] && KHMER.test(packs.km[key]) && packs.en[key] !== packs.km[key], `${key} in both packs, Khmer in km`)
    }
    assert.ok(packs.en.telegram_topic_placeholder.includes('Group (General)') && packs.km.telegram_topic_placeholder.includes('ក្រុម'), 'the empty choice is named in the field')
    assert.ok(packs.en.telegram_topics_command_help.includes('/settopic') && packs.km.telegram_topics_command_help.includes('/settopic'))
    pass('wiring: bulk + undo/redo announce status changes, the webhook gets the writer, no topic id is hard-coded, Settings and both packs carry the returns family and /settopic')

    console.log(`test-telegram-settopic-pure: ${checks} checks ok (fetch stubbed; nothing sent)`)
  } finally {
    globalThis.fetch = realFetch
  }
})().catch((error) => { console.error(error); process.exit(1) })
