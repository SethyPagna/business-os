// NOTIF-V2 (owner ruling, 6 Oct 2026): Telegram low / out-of-stock alerts follow the bell's rule.
//
//   - ONE short message to the Alerts topic when a SALE carries a product into low or out of stock, once per
//     crossing, from the stock_alert_events rows the sale batch wrote (never a standing list);
//   - sent AFTER the sale commits, from a waitUntil, never inside the sale batch and never able to fail it;
//   - per-organization: the chat and topic come from each deployment's own settings, none is written in code.
//
// Pure: the REAL lib/telegram.ts over node:sqlite carrying the REAL migration chain (so migration 0239's
// telegram_sent_at column and its partial index are exercised). The Telegram API is a local function; every id
// below is synthetic.
//
// Run (from cloudflare/): node scripts/test-telegram-stock-alert-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { DatabaseSync } = require('node:sqlite')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')

function loadReal(relPath, overrides = {}) {
  const sourcePath = path.join(root, 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const original = Module._load
  Module._load = function (request, parent, main) { return request in overrides ? overrides[request] : original.call(this, request, parent, main) }
  const mod = { exports: {} }
  try { new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, require, mod, sourcePath, path.dirname(sourcePath)) }
  finally { Module._load = original }
  return mod.exports
}

const MIGRATIONS = loadAll()
function openShop() {
  const raw = new DatabaseSync(':memory:')
  raw.exec('PRAGMA foreign_keys = OFF;')
  for (const sql of MIGRATIONS) raw.exec(sql)
  const names = (sql) => [...new Set([...sql.matchAll(/@(\w+)/g)].map((match) => match[1]))]
  const bind = (sql, params) => (Array.isArray(params) ? params : [Object.fromEntries(names(sql).map((name) => [name, params?.[name] ?? null]))])
  return {
    raw,
    prepare(sql) {
      const statement = raw.prepare(sql)
      return {
        async get(params) { return statement.get(...bind(sql, params)) },
        async all(params) { return statement.all(...bind(sql, params)) },
        async run(params) { const info = statement.run(...bind(sql, params)); return { changes: Number(info.changes), lastInsertRowid: Number(info.lastInsertRowid) } },
      }
    },
  }
}
const setting = (db, key, value) => db.raw.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
const dbModule = { getDb: (env) => env.DB }
const lowStockSettings = loadReal('lib/lowStockSettings.ts', { './db': dbModule })
const telegramLang = loadReal('lib/telegramLang.ts')
// The alert path reads settings and one table; the report builders this module also carries are not exercised.
const telegram = loadReal('lib/telegram.ts', {
  './lowStockSettings': lowStockSettings, './db': dbModule, './telegramLang': telegramLang,
  './businessDateWindow': loadReal('lib/businessDateWindow.ts'), './salesAnalytics': {}, './saleTotals': {}, './nativeSaleChange': {}, './shiftReconciliation': {},
})

const CHAT_A = '-1009990001'
const CHAT_B = '-1009990002'
const ALERTS_A = 7001
const ALERTS_B = 7101
const ADMIN_URL = 'https://admin.example.com'

const posts = []
let failNext = false
globalThis.fetch = async (url, init) => {
  assert.ok(String(url).startsWith('https://api.telegram.org/botSYNTHETIC-TOKEN/sendMessage'), `unexpected fetch ${url}`)
  if (failNext) { failNext = false; return { ok: false, status: 500, text: async () => 'boom' } }
  posts.push(JSON.parse(init.body))
  return { ok: true, status: 200, text: async () => '' }
}

let passed = 0
const check = (name, cond, detail) => { assert.ok(cond, detail ? `${name}\n${detail}` : name); passed += 1; console.log(`PASS ${name}`) }

function shop(chat, topic, extra = {}) {
  const db = openShop()
  for (const [key, value] of Object.entries({ telegram_chat_id: chat, telegram_language: 'en', telegram_topic_alerts: String(topic), ...extra })) setting(db, key, value)
  return { DB: db, TELEGRAM_BOT_TOKEN: 'SYNTHETIC-TOKEN', BUSINESS_OS_ADMIN_URL: ADMIN_URL }
}
let nextProduct = 100
const event = (env, state, name, quantity, extra = {}) => {
  nextProduct += 1
  return Number(env.DB.raw.prepare(`INSERT INTO stock_alert_events (family_root_id, product_id, product_name, branch_id, alert_state, quantity_after, sale_id, created_at, telegram_sent_at)
    VALUES (?, ?, ?, 1, ?, ?, ?, ${extra.createdAt ? '?' : "CURRENT_TIMESTAMP"}, ?)`)
    .run(...[`key-${nextProduct}`, nextProduct, name, state, quantity, 900 + nextProduct, ...(extra.createdAt ? [extra.createdAt] : []), extra.sentAt ?? null]).lastInsertRowid)
}
const unsent = (env) => env.DB.raw.prepare('SELECT COUNT(*) AS n FROM stock_alert_events WHERE telegram_sent_at IS NULL').get().n

async function main() {
  // --- one message, once per crossing, only the recent unannounced rows ------------------------------------
  const a = shop(CHAT_A, ALERTS_A)
  event(a, 'low', 'Lip Tint', 3)
  event(a, 'out', 'Rose Serum', 0)
  event(a, 'out', 'Face Wash', 0)
  event(a, 'low', 'Ancient Soap', 2, { createdAt: '2020-01-01 00:00:00' })
  event(a, 'low', 'Already Told', 1, { sentAt: '2026-10-06 01:00:00' })
  const announced = await telegram.sendPendingStockAlerts(a)
  check('three fresh crossings are announced in ONE message', announced === 3 && posts.length === 1, JSON.stringify(posts))
  const first = posts[0]
  check('it goes to this deployment\'s own chat and Alerts topic', first.chat_id === CHAT_A && first.message_thread_id === ALERTS_A, JSON.stringify(first))
  check('OUT rows come before LOW rows, each with the name and the quantity left',
    first.text.split('\n').filter((line) => /^· (OUT|LOW)/.test(line)).join('|') === '· OUT: Rose Serum: 0|· OUT: Face Wash: 0|· LOW: Lip Tint: 3', first.text)
  check('a crossing from the past or one already announced is not repeated', !first.text.includes('Ancient Soap') && !first.text.includes('Already Told'), first.text)
  check('the message links to the Dashboard cards: Out of stock and Low stock',
    first.text.includes(`${ADMIN_URL}/#out-of-stock`) && first.text.includes(`${ADMIN_URL}/#low-stock`), first.text)
  check('the message is short: a title, one row per crossing, the links', first.text.split('\n').length === 1 + 3 + 2, first.text)
  check('the rows are claimed (telegram_sent_at set); only the stale row stays unannounced', unsent(a) === 1)

  const again = await telegram.sendPendingStockAlerts(a)
  check('a second drain announces nothing: once per crossing', again === 0 && posts.length === 1)

  // --- overlapping sales never double-send -------------------------------------------------------------------
  event(a, 'out', 'Clay Mask', 0)
  const raced = await Promise.all([telegram.sendPendingStockAlerts(a), telegram.sendPendingStockAlerts(a), telegram.sendPendingStockAlerts(a)])
  check('three overlapping drains send the one crossing exactly once', raced.reduce((sum, n) => sum + n, 0) === 1 && posts.length === 2, JSON.stringify(raced))
  check('a lone OUT row links only the Out of stock card', posts[1].text.includes('#out-of-stock') && !posts[1].text.includes('#low-stock'), posts[1].text)

  // --- a failed send never loses the crossing and never reaches the sale ------------------------------------
  event(a, 'low', 'Toner', 4)
  failNext = true
  let thrown = null
  try { await telegram.sendPendingStockAlerts(a) } catch (error) { thrown = error }
  check('a Telegram refusal surfaces to the caller (the route\'s waitUntil logs and drops it)', thrown && /rejected/i.test(String(thrown.message)), String(thrown))
  check('and the claim is cleared so the crossing is not lost', unsent(a) === 2, String(unsent(a)))
  const retried = await telegram.sendPendingStockAlerts(a)
  check('the next drain announces it once', retried === 1 && posts.length === 3 && posts[2].text.includes('Toner'), JSON.stringify(posts[2]))

  // --- switches ----------------------------------------------------------------------------------------------
  const before = posts.length
  event(a, 'out', 'Switched Off', 0)
  setting(a.DB, 'telegram_stock_alert_enabled', 'false')
  check('the stock-alert switch off sends nothing and keeps the row for later', await telegram.sendPendingStockAlerts(a) === 0 && posts.length === before && unsent(a) >= 1)
  setting(a.DB, 'telegram_stock_alert_enabled', 'true')
  setting(a.DB, 'telegram_automation_enabled', 'false')
  check('Telegram automation off sends nothing', await telegram.sendPendingStockAlerts(a) === 0 && posts.length === before)
  setting(a.DB, 'telegram_automation_enabled', 'true')
  const noChat = shop('', ALERTS_A)
  event(noChat, 'out', 'No Chat', 0)
  check('no chat configured sends nothing', await telegram.sendPendingStockAlerts(noChat) === 0 && posts.length === before)
  check('switched back on, the held crossing is announced', await telegram.sendPendingStockAlerts(a) === 1 && posts.length === before + 1 && posts[before].text.includes('Switched Off'))

  // --- a big sale: capped, bilingual, per-organization -------------------------------------------------------
  const b = shop(CHAT_B, ALERTS_B, { telegram_language: 'both' })
  for (let n = 1; n <= 12; n += 1) event(b, n === 1 ? 'out' : 'low', `Shop B Balm ${String(n).padStart(2, '0')}`, n)
  const mark = posts.length
  await telegram.sendPendingStockAlerts(b)
  const big = posts[mark]
  const rows = big.text.split('\n').filter((line) => /^· /.test(line))
  check('twelve crossings show ten rows and count the rest', rows.length === 11 && /^· \+ 2 /.test(rows[10]), big.text)
  check('shop B\'s message goes to shop B\'s chat and topic, and carries nothing of shop A',
    big.chat_id === CHAT_B && big.message_thread_id === ALERTS_B && !/Rose Serum|Lip Tint|Toner/.test(big.text), JSON.stringify(big))
  check('both-language mode prints Khmer beside English', /OUT\/អស់ស្តុក/.test(big.text) && /LOW\/ស្តុកទាប/.test(big.text) && /Stock alert\/ជូនដំណឹងស្តុក/.test(big.text), big.text)
  const km = telegram.formatStockAlertTelegramMessage([{ id: 1, product_name: 'Rose Serum', alert_state: 'out', quantity_after: 0 }], 'km', ADMIN_URL)
  check('Khmer mode is Khmer only', /ជូនដំណឹងស្តុក/.test(km) && /អស់ស្តុក/.test(km) && !/Stock alert|OUT/.test(km), km)
  check('no admin URL configured: the message simply has no link line', !/https?:/.test(telegram.formatStockAlertTelegramMessage([{ id: 1, product_name: 'X', alert_state: 'low', quantity_after: 1 }], 'en', '')))

  // --- structure: after the commit, never in the batch, nothing hard-coded ----------------------------------
  const sales = fs.readFileSync(path.join(root, 'src/routes/sales.ts'), 'utf8')
  const calls = [...sales.matchAll(/announceStockAlerts\(c\.env\)/g)]
  check('sales.ts announces from five post-commit sites (create, status, add items, amendment, bulk status)', calls.length === 5, String(calls.length))
  const everyCallDeferred = calls.every((call) => {
    const before = sales.slice(Math.max(0, call.index - 3000), call.index)
    return before.lastIndexOf('waitUntil(') >= 0 && before.lastIndexOf('waitUntil(') > before.lastIndexOf('db.batch(')
  })
  check('each announce call sits inside a waitUntil that follows the write batch, never inside it', everyCallDeferred)
  const history = fs.readFileSync(path.join(root, 'src/routes/actionHistory.ts'), 'utf8')
  check('a redo / undo of a grouped status change announces its crossings too (after the replay committed)',
    /BULK_STATUS_KIND\s*\?\s*Promise\.all\(\[notifyBulkStatus\(c\.env\), announceStockAlerts\(c\.env\)\]\)/.test(history) && /async function announceStockAlerts[\s\S]*?catch/.test(history))
  const batchLib = fs.readFileSync(path.join(root, 'src/lib/saleStockAlerts.ts'), 'utf8')
  const bulkLib = fs.readFileSync(path.join(root, 'src/lib/saleBulkStatus.ts'), 'utf8')
  check('the in-batch planner and the bulk applier never import Telegram', !/telegram/i.test(batchLib.replace(/\/\/.*$/gm, '')) && !/from '\.\/telegram'/.test(bulkLib))
  const tgSource = fs.readFileSync(path.join(root, 'src/lib/telegram.ts'), 'utf8')
  check('the standing low / out list is retired from the pushed summaries', !/lowStockMovedOnDay|lowStockSectionRows|section\('lowStock'/.test(tgSource))
  check('no chat or topic id is written into the Worker module', !/-100\d{6,}/.test(tgSource) && !/telegram_topic_alerts'\s*:\s*\d/.test(tgSource))
  const migration = fs.readFileSync(path.join(root, 'migrations/0239_stock_alert_events.sql'), 'utf8')
  check('migration 0239 carries the claim column and a partial index for it', /telegram_sent_at TEXT/.test(migration) && /idx_stock_alert_events_unsent[\s\S]*WHERE telegram_sent_at IS NULL/.test(migration))
  const plan = a.DB.raw.prepare("EXPLAIN QUERY PLAN SELECT id FROM stock_alert_events WHERE telegram_sent_at IS NULL AND created_at >= datetime('now', '-2 hours')").all().map((row) => row.detail).join(' | ')
  check('the drain\'s read uses the partial index, not a table scan', /idx_stock_alert_events_unsent/.test(plan), plan)

  // --- the Settings switch and its copy ----------------------------------------------------------------------
  const settingsUi = fs.readFileSync(path.join(root, '../frontend/src/components/utils-settings/Settings.tsx'), 'utf8')
  const en = JSON.parse(fs.readFileSync(path.join(root, '../frontend/src/lang/en.json'), 'utf8'))
  const kmPack = JSON.parse(fs.readFileSync(path.join(root, '../frontend/src/lang/km.json'), 'utf8'))
  check('Settings > Telegram lists the switch, labelled from both packs',
    /'telegram_stock_alert_enabled'/.test(settingsUi) && ['telegram_cat_stock_alert', 'telegram_cat_stock_alert_desc'].every((key) => en[key] && kmPack[key] && /[ក-៿]/.test(kmPack[key])))

  console.log(`\n${passed} checks passed; ${posts.length} messages composed for the local Telegram stand-in (none sent anywhere).`)
}

main().catch((error) => { console.error(error); process.exit(1) })
