'use strict'
// Owner ruling, 6 Oct 2026: low and out-of-stock alerts fire only when a sale CROSSES the threshold, once per
// crossing (lib/stockCrossingAlert.ts, migration 0272).
//
// Runs the REAL lib/stockCrossingAlert.ts, lib/lowStockSettings.ts and lib/telegramLang.ts against an in-memory
// SQLite database with every migration applied, so the claim's unique keys are the real ones. The ONLY seam is the
// Telegram transport: ./telegram is replaced by a recorder, so no message can ever leave this process (no bot token
// is read, no network is touched). What would have been sent is then composed through the real language layer and
// asserted as text, Khmer line included.
//
//   rule        above -> above is silent; crossing low raises LOW; crossing out raises OUT; a jump straight to
//               out raises OUT only; a product already low does not alert again on the next sale
//   once        a retry, a stale-read race and an undo then redo of the same sale send exactly one message
//   again       a restock followed by another crossing sends a second message
//   switches    low alert off silences LOW but not OUT; Telegram switch off still records the crossing
//   failure     a transport that throws is recorded, never thrown to the sale, and never retried
//   deploy      without table 0272 nothing is recorded or sent and nothing throws
//   wiring      the sale route hands the availability read to the recorder; the category, topic and Settings
//               toggle exist; both language packs carry the new strings; no id is hard-coded
//
// Run (from cloudflare/scripts): node test-stock-crossing-alert-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const SRC = path.join(__dirname, '..', 'src')
const raw = openDb(loadAll())
const db = {
  prepare(sql) {
    const stmt = raw.prepare(sql)
    return {
      all: async (params) => stmt.all(params) ?? [],
      get: async (params) => stmt.get(params) ?? null,
      run: async (params) => { const info = stmt.run(params); return { changes: info.meta?.changes ?? 0, lastInsertRowid: Number(info.meta?.last_row_id ?? 0) } },
    }
  },
}

// ---- the transport seam: records instead of sending ----------------------------------------------------
const sent = []
let transport = async (event) => { sent.push(event); return true }
const bumps = []
const overrides = {
  './db': { getDb: () => db },
  './cache': { bumpVersion: async (_env, namespace) => { bumps.push(namespace) } },
  './telegram': { sendTelegramEvent: async (_env, event) => transport(event) },
}
const modules = new Map()
function load(rel) {
  if (modules.has(rel)) return modules.get(rel).exports
  const output = ts.transpileModule(fs.readFileSync(path.join(SRC, rel), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: path.join(SRC, rel),
  }).outputText
  const mod = { exports: {} }
  modules.set(rel, mod)
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}
const alert = load('lib/stockCrossingAlert.ts')
const lang = load('lib/telegramLang.ts')
const lowStock = load('lib/lowStockSettings.ts')
const env = { DB: raw }
const KHMER = /[ក-៿]/

// ---- fixtures -----------------------------------------------------------------------------------------
function productRow(name, stock, low = 10, out = 0) {
  return seedStockFixture(raw.db, () => {
    const id = Number(raw.db.prepare('INSERT INTO products (name, stock_quantity, low_stock_threshold, out_of_stock_threshold, is_active) VALUES (?, ?, ?, ?, 1)').run(name, stock, low, out).lastInsertRowid)
    raw.db.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, 1, ?)').run(id, stock)
    return id
  })
}
// What a restock leaves behind: a positive movement (the epoch) and the branch quantity.
function restock(productId, quantity) {
  seedStockFixture(raw.db, () => {
    raw.db.prepare("INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity) VALUES (?, 'x', 1, 'add', ?)").run(productId, quantity)
    raw.db.prepare('UPDATE branch_stock SET quantity = quantity + ? WHERE product_id = ? AND branch_id = 1').run(quantity, productId)
  })
}
const line = (productId, quantity, before, extra = {}) => ({ productId, branchId: 1, quantity, before, name: extra.name || `P${productId}`, lowThreshold: extra.low ?? 10, outThreshold: extra.out ?? 0 })
const sale = (saleId, lines) => alert.recordStockCrossings(env, { saleId, branchName: 'LC Store', lines })
const rows = () => raw.db.prepare('SELECT product_id, tier, sale_id, quantity_before, quantity_after, telegram_status FROM stock_crossing_alerts ORDER BY id').all()
const setting = (key, value) => seedStockFixture(raw.db, () => raw.db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value)))
const reset = () => { sent.length = 0; bumps.length = 0; transport = async (event) => { sent.push(event); return true } }
const compose = (event, language = 'both') => {
  lang.setTelegramLanguage(language)
  return [lang.localizeTelegramHeading(event.heading), ...event.lines.filter(Boolean).map((l) => lang.localizeTelegramLine(l))].join('\n')
}

let passed = 0
async function check(name, fn) {
  reset()
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  const config = lowStock.DEFAULT_LOW_STOCK_CONFIG

  // ---- the rule, as a table (no database) ---------------------------------------------------------------
  await check('rule: classifyCrossing on every boundary', () => {
    const c = alert.classifyCrossing
    assert.equal(c(12, 9, 10, 0), 'low', 'above -> at or below low')
    assert.equal(c(11, 10, 10, 0), 'low', 'landing exactly on the threshold is a crossing')
    assert.equal(c(12, 11, 10, 0), null, 'above -> still above')
    assert.equal(c(10, 9, 10, 0), null, 'already low -> lower is NOT a new crossing')
    assert.equal(c(5, 0, 10, 0), 'out', 'low -> out')
    assert.equal(c(1, 0, 10, 0), 'out', 'landing exactly on the out threshold')
    assert.equal(c(15, 0, 10, 0), 'out', 'a jump straight to out raises out only')
    assert.equal(c(0, 0, 10, 0), null, 'already out')
    assert.equal(c(12, 9, -1, 0), null, 'low alert off (-1): no low crossing')
    assert.equal(c(3, 0, -1, 0), 'out', 'low alert off: out still fires')
    assert.equal(c(8, 2, 10, 2), 'out', 'a raised per-product out threshold is honoured')
    assert.equal(c(2.5, 0.5, 10, 0), null, 'fractions: already low')
    assert.equal(c(10.5, 9.5, 10, 0), 'low', 'fractions: crossing')
    assert.equal(c(5, 7, 10, 0), null, 'a quantity going UP is never a crossing')
  })

  await check('detect: repeated lines of one product are one crossing; other products and zero-quantity lines are ignored', () => {
    const crossings = alert.detectCrossings([
      line(1, 2, 12), line(1, 2, 12), // 12 -> 8 in two lines: one low crossing
      line(2, 1, 30), // 30 -> 29: nothing
      line(3, 0, 5), // nothing taken
    ], config)
    assert.deepEqual(crossings.map((x) => [x.productId, x.tier, x.before, x.after]), [[1, 'low', 12, 8]])
    // Two lines that are each above the line alone but cross together.
    assert.equal(alert.detectCrossings([line(9, 3, 12), line(9, 3, 12)], config).length, 1)
    assert.equal(alert.detectCrossings([line(9, 3, 12)], config).length, 1)
    assert.equal(alert.detectCrossings([line(9, 1, 12)], config).length, 0)
  })

  // ---- exactly once, against the real claim keys -----------------------------------------------------------
  const a = productRow('Glow Serum', 12)
  await check('a crossing alerts exactly once (and is recorded for the bell)', async () => {
    const result = await sale(101, [line(a, 3, 12, { name: 'Glow Serum' })])
    assert.deepEqual(result, { crossings: 1, claimed: 1, sent: 1 })
    assert.equal(sent.length, 1)
    assert.equal(sent[0].type, 'stock_alert')
    assert.equal(sent[0].heading, '⚠️ Low stock')
    assert.deepEqual(rows().map((r) => [r.product_id, r.tier, r.sale_id, r.quantity_before, r.quantity_after, r.telegram_status]), [[a, 'low', 101, 12, 9, 'sent']])
    assert.deepEqual(bumps, ['stock'], "the bell's cached section is turned over after the claim exists")
  })

  await check('the text is concise and bilingual: heading, product, branch, quantity left, each with its Khmer', () => {
    const text = compose({ heading: '⚠️ Low stock', lines: ['Product: Glow Serum', 'Branch: LC Store', 'On hand: 9'] })
    console.log(text.split('\n').map((l) => '    | ' + l).join('\n'))
    const textLines = text.split('\n')
    assert.equal(textLines.length, 4, 'a heading and three rows')
    assert.ok(textLines[0].includes('Low stock') && textLines[0].includes('ស្តុកទាប'), textLines[0])
    assert.ok(text.includes('Glow Serum') && text.includes('LC Store') && text.includes('9'))
    for (const row of textLines.slice(1)) assert.ok(KHMER.test(row), `row has Khmer: ${row}`)
    const out = compose({ heading: '🛑 Out of stock', lines: ['Product: Glow Serum', 'Branch: LC Store', 'On hand: 0'] })
    assert.ok(out.split('\n')[0].includes('Out of stock') && out.split('\n')[0].includes('អស់ស្តុក'), out)
    const km = compose({ heading: '⚠️ Low stock', lines: ['Product: Glow Serum', 'Branch: LC Store', 'On hand: 9'] }, 'km')
    assert.ok(!/Low stock/.test(km) && KHMER.test(km), 'Khmer-only mode drops the English words')
    lang.setTelegramLanguage('en')
    assert.ok(!KHMER.test(compose({ heading: '⚠️ Low stock', lines: ['Product: Glow Serum', 'Branch: LC Store', 'On hand: 9'] }, 'en')), 'English-only mode stays English')
    lang.setTelegramLanguage('both')
  })

  await check('the message the lib really composes reads as the text above (event shape)', async () => {
    await sale(102, [line(productRow('Rose Toner', 11), 2, 11, { name: 'Rose Toner' })])
    assert.deepEqual(sent[0].lines, ['Product: Rose Toner', 'Branch: LC Store', 'On hand: 9'])
    const out = await sale(103, [line(productRow('Last One', 1), 1, 1, { name: 'Last One' })])
    assert.equal(out.sent, 1)
    assert.equal(sent[1].heading, '🛑 Out of stock')
    assert.deepEqual(sent[1].lines, ['Product: Last One', 'Branch: LC Store', 'On hand: 0'], 'out of stock: the same three rows, quantity 0')
  })

  await check('no alert when the sale stays above the threshold', async () => {
    const before = rows().length
    const b = productRow('Plenty', 50)
    const result = await sale(104, [line(b, 5, 50)])
    assert.deepEqual(result, { crossings: 0, claimed: 0, sent: 0 })
    assert.equal(sent.length, 0)
    assert.equal(rows().length, before)
    assert.deepEqual(bumps, [], 'and nothing is invalidated')
  })

  await check('a product that is ALREADY low does not alert on its next sale', async () => {
    const before = rows().length
    const result = await sale(105, [line(a, 2, 9, { name: 'Glow Serum' })])
    assert.equal(result.crossings, 0)
    assert.equal(sent.length, 0)
    assert.equal(rows().length, before)
  })

  await check('a retry of the same sale sends nothing more', async () => {
    const again = await sale(101, [line(a, 3, 12, { name: 'Glow Serum' })])
    assert.deepEqual(again, { crossings: 1, claimed: 0, sent: 0 })
    assert.equal(sent.length, 0)
    assert.equal(rows().filter((r) => r.product_id === a).length, 1)
  })

  await check('two tills racing over the same threshold (both read the stale 12) send one message', async () => {
    const c = productRow('Race Cream', 12)
    const first = await sale(201, [line(c, 3, 12, { name: 'Race Cream' })])
    const second = await sale(202, [line(c, 4, 12, { name: 'Race Cream' })])
    assert.equal(first.sent, 1)
    assert.deepEqual(second, { crossings: 1, claimed: 0, sent: 0 }, 'same restock epoch: the second request loses the claim')
    assert.equal(sent.length, 1)
  })

  const d = productRow('Mist', 12)
  await check('a restock followed by another crossing alerts again (a new crossing)', async () => {
    assert.equal((await sale(301, [line(d, 3, 12, { name: 'Mist' })])).sent, 1)
    assert.equal(sent.length, 1)
    restock(d, 40) // 9 -> 49
    reset()
    const none = await sale(302, [line(d, 5, 49, { name: 'Mist' })])
    assert.equal(none.crossings, 0, 'back above: silent')
    const again = await sale(303, [line(d, 42, 49, { name: 'Mist' })]) // 49 -> 7
    assert.deepEqual(again, { crossings: 1, claimed: 1, sent: 1 })
    assert.equal(sent.length, 1)
    assert.equal(rows().filter((r) => r.product_id === d).length, 2, 'two crossings on record')
  })

  await check('undo then redo of a sale does not repeat the alert', async () => {
    const e = productRow('Cleanser', 12)
    assert.equal((await sale(401, [line(e, 3, 12, { name: 'Cleanser' })])).sent, 1)
    restock(e, 3) // the undo: the units come back (a positive movement moves the epoch)
    reset()
    // The redo takes the same units for the same sale again; its availability read now shows the restored 12.
    const redo = await sale(401, [line(e, 3, 12, { name: 'Cleanser' })])
    assert.deepEqual(redo, { crossings: 1, claimed: 0, sent: 0 })
    assert.equal(sent.length, 0)
    assert.equal(rows().filter((r) => r.product_id === e).length, 1)
    // Control: the SAME restock + a DIFFERENT sale is a legitimate new crossing, so the dedupe is not simply "once per product".
    const other = await sale(402, [line(e, 3, 12, { name: 'Cleanser' })])
    assert.equal(other.sent, 1)
  })

  await check('out of stock: crossing the out threshold sends the out alert, once, and a jump from healthy skips the low alert', async () => {
    const f = productRow('Sunscreen', 3)
    assert.equal((await sale(501, [line(f, 3, 3, { name: 'Sunscreen' })])).sent, 1)
    assert.equal(sent[0].heading, '🛑 Out of stock')
    assert.equal((await sale(501, [line(f, 3, 3, { name: 'Sunscreen' })])).claimed, 0, 'retry: nothing')
    const g = productRow('Jumper', 30)
    reset()
    const jump = await sale(502, [line(g, 30, 30, { name: 'Jumper' })])
    assert.deepEqual(jump, { crossings: 1, claimed: 1, sent: 1 }, 'one alert, not a low one and an out one')
    assert.equal(sent[0].heading, '🛑 Out of stock')
    assert.deepEqual(rows().filter((r) => r.product_id === g).map((r) => r.tier), ['out'])
    // A product whose own out threshold is raised.
    const h = productRow('Raised', 9, 10, 4)
    reset()
    assert.equal((await sale(503, [line(h, 5, 9, { name: 'Raised', out: 4 })])).sent, 1)
    assert.equal(sent[0].heading, '🛑 Out of stock')
  })

  await check('switches: low alert OFF silences low but not out; the global threshold mode is honoured', async () => {
    setting('low_stock_alert_enabled', 'false')
    const i = productRow('Switch A', 12)
    assert.equal((await sale(601, [line(i, 3, 12)])).crossings, 0, 'low crossing is not a crossing while the alert is off')
    assert.equal((await sale(602, [line(productRow('Switch B', 2), 2, 2)])).sent, 1, 'out of stock still fires')
    setting('low_stock_alert_enabled', 'true')
    setting('low_stock_threshold_mode', 'global')
    setting('low_stock_threshold_default', '20')
    reset()
    const j = productRow('Global', 25, 10, 0) // its own threshold 10 is ignored in global mode
    assert.equal((await sale(603, [line(j, 6, 25, { low: 10 })])).sent, 1, '25 -> 19 crosses the GLOBAL 20')
    setting('low_stock_threshold_mode', 'product')
  })

  await check('Telegram switched off: the crossing is still recorded (the bell), nothing is sent, the row says skipped', async () => {
    transport = async () => false // what sendTelegramEvent answers when the category / automation / chat id is off
    const k = productRow('Quiet', 12)
    const result = await sale(701, [line(k, 3, 12)])
    assert.deepEqual(result, { crossings: 1, claimed: 1, sent: 0 })
    assert.equal(rows().find((r) => r.product_id === k).telegram_status, 'skipped')
  })

  await check('a failing transport never reaches the sale and is never retried', async () => {
    const l = productRow('Flaky', 12)
    let calls = 0
    transport = async () => { calls += 1; throw new Error('telegram_rejected') }
    const result = await sale(801, [line(l, 3, 12)])
    assert.deepEqual(result, { crossings: 1, claimed: 1, sent: 0 })
    assert.equal(rows().find((r) => r.product_id === l).telegram_status, 'failed')
    const again = await sale(801, [line(l, 3, 12)])
    assert.equal(again.claimed, 0)
    assert.equal(calls, 1, 'at most once')
  })

  await check('rows are scoped by branch: the same product crossing at another branch is its own crossing', async () => {
    const m = productRow('Two Branch', 12)
    seedStockFixture(raw.db, () => raw.db.prepare("INSERT OR IGNORE INTO branches (id, name, is_active) VALUES (2, 'Other', 1)").run())
    assert.equal((await sale(901, [line(m, 3, 12)])).sent, 1)
    assert.equal((await sale(902, [{ ...line(m, 3, 12), branchId: 2 }])).sent, 1)
    assert.equal(rows().filter((r) => r.product_id === m).length, 2)
  })

  await check('deploy order: without table 0272 nothing is recorded or sent and nothing throws', async () => {
    seedStockFixture(raw.db, () => raw.db.exec('ALTER TABLE stock_crossing_alerts RENAME TO stock_crossing_alerts_parked'))
    alert.__resetStockCrossingProbeForTests()
    const result = await sale(1001, [line(a, 12, 12)])
    assert.deepEqual(result, { crossings: 1, claimed: 0, sent: 0 })
    assert.equal(sent.length, 0)
    seedStockFixture(raw.db, () => raw.db.exec('ALTER TABLE stock_crossing_alerts_parked RENAME TO stock_crossing_alerts'))
    alert.__resetStockCrossingProbeForTests()
  })

  await check('the sale can never fail because of an alert: a broken database is swallowed', async () => {
    const brokenEnv = { DB: raw }
    overrides['./db'].getDb = () => { throw new Error('d1 down') }
    const result = await alert.recordStockCrossings(brokenEnv, { saleId: 1, lines: [line(a, 12, 12)] })
    overrides['./db'].getDb = () => db
    assert.deepEqual(result, { crossings: 0, claimed: 0, sent: 0 })
  })

  // ---- wiring: read from the source (the real transport is never loaded) -----------------------------------
  const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r/g, '')
  await check('wiring: the sale route hands the availability read to the recorder after the sale commits', () => {
    const sales = read('routes/sales.ts')
    assert.ok(sales.includes("import { recordStockCrossings } from '../lib/stockCrossingAlert'"))
    const call = sales.indexOf('recordStockCrossings(c.env')
    assert.ok(call > sales.indexOf('if (recoveredCommittedCreate) {'), 'after the replay early return, so a replayed create never re-announces')
    const body = sales.slice(call, call + 900)
    assert.ok(body.includes('stockCheckItems.map') && body.includes('stockByBranch.get(') && body.includes('low_stock_threshold') && body.includes('out_of_stock_threshold'))
  })

  await check('wiring: category, topic, switch default and Settings toggle', () => {
    const telegram = read('lib/telegram.ts')
    assert.ok(telegram.includes("'reviews' | 'stock_alert'"))
    assert.ok(telegram.includes("'telegram_stock_alert_enabled'") && telegram.includes('stock_alert: isEnabled(values.telegram_stock_alert_enabled, true)'), 'unset means on')
    assert.ok(telegram.includes("stock_alert: 'telegram_topic_alerts'"), 'goes to the configured Alerts topic')
    const settings = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'utils-settings', 'Settings.tsx'), 'utf8')
    assert.ok(settings.includes("'telegram_stock_alert_enabled', t('telegram_cat_stock_alert')"))
    for (const lng of ['en', 'km']) {
      const pack = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'lang', `${lng}.json`), 'utf8'))
      for (const key of ['telegram_cat_stock_alert', 'telegram_cat_stock_alert_desc']) {
        assert.ok(pack[key], `${lng} has ${key}`)
        assert.equal(KHMER.test(pack[key]), lng === 'km', `${lng}.${key} is in its own language`)
      }
    }
    for (const heading of ['⚠️ Low stock', '🛑 Out of stock']) assert.ok(KHMER.test(lang.TELEGRAM_HEADINGS[heading]), heading)
  })

  await check('wiring: no chat, topic or token id is hard-coded in the alert module', () => {
    const source = read('lib/stockCrossingAlert.ts')
    assert.ok(!/-?\d{6,}/.test(source.replace(/\/\/.*$/gm, '')), 'no long numeric id')
    assert.ok(!/chat_id|chatId|message_thread_id|BOT_TOKEN/i.test(source.replace(/\/\/.*$/gm, '')), 'chat and topic come from the per-organisation settings inside sendTelegramEvent')
  })

  await check('migration 0272: schema only, LF only, PRE/POST present, unique keys exist', () => {
    const file = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0272_stock_crossing_alerts.sql'), 'utf8')
    assert.ok(!file.includes('\r'))
    assert.ok(file.includes('stock_crossing_alerts_0272_pre') && file.includes('stock_crossing_alerts_0272_post'))
    assert.ok(!/^\s*(INSERT|UPDATE|DELETE)\b/im.test(file.replace(/--.*$/gm, '')), 'no data statement')
    const unique = raw.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='stock_crossing_alerts' AND sql LIKE 'CREATE UNIQUE%'").all().map((r) => r.name)
    assert.deepEqual(unique, ['idx_stock_crossing_alerts_sale'])
  })

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
