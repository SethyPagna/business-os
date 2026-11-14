'use strict'
// The owner alert of the stored daily sales totals (lib/telegram.ts sendTelegramSalesDailyMismatchAlert): bilingual, concise, names days and no figure,
// goes to the Alerts topic, and cannot be muted by a category switch (a mismatch never heals silently; owner, 14 Nov 2026).
// NO network and no real chat: fetch is replaced before anything loads, the bot token is a placeholder, and the settings are a migrated in-memory chain.
// Run (from cloudflare/): node scripts/test-sales-daily-alert-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')

const SRC = path.join(__dirname, '..', 'src')
const ROOT = path.join(__dirname, '..')
const sent = []
globalThis.fetch = async (url, init) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response('{"ok":true}', { status: 200 }) }

const rawDb = openDb(fs.readdirSync(path.join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort().map((f) => fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8').replace(/\r\n/g, '\n')))
const dbShim = {
  prepare(sql) {
    const stmt = rawDb.prepare(sql)
    return { get: async (p) => stmt.get(p), all: async (p) => stmt.all(p) || [], run: async (p) => { const r = stmt.run(p); return { changes: r.meta?.changes ?? 0 } } }
  },
  batch: (items) => rawDb.batch(items),
}
const cache = new Map()
const overrides = new Map([[path.normalize(path.join(SRC, 'lib/db.ts')), { getDb: () => dbShim }]])
const resolveTs = (base) => { for (const c of [base, `${base}.ts`, path.join(base, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; return base }
function load(file) {
  const key = path.normalize(file)
  if (overrides.has(key)) return overrides.get(key)
  if (cache.has(key)) return cache.get(key)
  const { outputText } = ts.transpileModule(fs.readFileSync(key, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: key })
  const mod = { exports: {} }
  cache.set(key, mod.exports)
  const req = Module.createRequire(key)
  new Function('exports', 'require', 'module', outputText)(mod.exports, (r) => (r.startsWith('.') ? load(resolveTs(path.resolve(path.dirname(key), r))) : req(r)), mod)
  cache.set(key, mod.exports)
  return mod.exports
}
const telegram = load(path.join(SRC, 'lib/telegram.ts'))
const KHMER = /[ក-៿]/
const setSetting = (key, value) => rawDb.exec(`INSERT INTO settings(key,value) VALUES('${key}','${value}') ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
const ENV = { DB: {}, TELEGRAM_BOT_TOKEN: 'PLACEHOLDER-TOKEN-NOT-A-REAL-BOT' }
let passed = 0
const check = async (name, run) => { sent.length = 0; await run(); passed += 1; console.log(`PASS ${name}`) }

async function main() {
  await check('the message is English and Khmer, names the days as dd/mm/yyyy, carries no figure, and is short', () => {
    const text = telegram.formatSalesDailyMismatchAlert('Leang Cosmetics', ['2026-11-10', '2026-11-12'])
    assert.ok(KHMER.test(text) && /Stored daily sales totals stopped/.test(text))
    assert.ok(text.includes('10/11/2026') && text.includes('12/11/2026'))
    assert.ok(!/\$|usd|riel/i.test(text), 'no money in the alert')
    assert.ok(text.length < 600, `concise: ${text.length}`)
    assert.ok(text.includes('Leang Cosmetics'))
  })

  await check('it is sent to the chat and the Alerts topic', async () => {
    setSetting('telegram_chat_id', '555000111'); setSetting('telegram_topic_alerts', '42')
    assert.equal(await telegram.sendTelegramSalesDailyMismatchAlert(ENV, ['2026-11-10']), true)
    assert.equal(sent.length, 1)
    assert.ok(sent[0].url.startsWith('https://api.telegram.org/bot'))
    assert.deepEqual([sent[0].body.chat_id, sent[0].body.message_thread_id], ['555000111', 42])
    assert.ok(sent[0].body.text.includes('10/11/2026'))
  })

  await check('no category switch can mute it (every event category off still sends); only Telegram being off, or unconfigured, stays quiet', async () => {
    for (const key of ['sales', 'status', 'returns', 'fees', 'stock_in', 'stock_out', 'products', 'reviews', 'stock_alert']) setSetting(`telegram_${key}_enabled`, 'false')
    assert.equal(await telegram.sendTelegramSalesDailyMismatchAlert(ENV, ['2026-11-10']), true)
    assert.equal(sent.length, 1)
    sent.length = 0
    setSetting('telegram_automation_enabled', 'false')
    assert.equal(await telegram.sendTelegramSalesDailyMismatchAlert(ENV, ['2026-11-10']), false)
    setSetting('telegram_automation_enabled', 'true')
    assert.equal(await telegram.sendTelegramSalesDailyMismatchAlert({ DB: {}, TELEGRAM_BOT_TOKEN: '' }, ['2026-11-10']), false, 'no token')
    assert.equal(sent.length, 0)
  })

  await check('a send that fails answers false and never throws into the cron', async () => {
    const real = globalThis.fetch
    globalThis.fetch = async () => { throw new Error('offline') }
    try { assert.equal(await telegram.sendTelegramSalesDailyMismatchAlert(ENV, ['2026-11-10']), false) } finally { globalThis.fetch = real }
  })
  console.log(`\n${passed} checks passed`)
}
main().catch((error) => { console.error(error); process.exit(1) })
