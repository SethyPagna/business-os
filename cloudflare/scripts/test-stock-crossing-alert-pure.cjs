'use strict'
// Owner ruling, 6 Oct 2026: low and out-of-stock alerts fire only when a sale CROSSES the threshold, once per
// crossing (lib/stockCrossingAlert.ts, migration 0272).
//
// Runs the REAL lib/stockCrossingAlert.ts, lib/lowStockSettings.ts, lib/stockLedgerQuery.ts and lib/telegramLang.ts
// against an in-memory SQLite database with every migration applied, so the claim's unique keys are the real ones.
// The ONLY seam is the Telegram transport: ./telegram is replaced by a recorder, so no message can ever leave this
// process (no bot token is read, no network is touched). What would have been sent is then composed through the real
// language layer and asserted as text, Khmer line included. The route itself is driven in
// test-stock-crossing-sale-route-pure.cjs.
//
//   rule        above -> above is silent; crossing low raises LOW; crossing out raises OUT; a jump straight to
//               out raises OUT only; a product already low does not alert again on the next sale
//   real stock  the quantities are read AFTER the commit: tills racing 13 -> 11 -> 9 send one message saying 9
//   once        a retry and an undo then redo of the same sale send exactly one message; an outflow stored as a
//               positive amount (transfer_out) does not start a new crossing, a real inflow does
//   one message one message per branch and tier lists every product that crossed, capped
//   switches    low alert off silences LOW but not OUT; Telegram switch off still records the crossing
//   failure     a transport that throws is recorded, never thrown to the sale, and never retried
//   deploy      without table 0272 nothing is recorded or sent and nothing throws
//   wiring      every path that deducts sale stock calls the recorder; category, topic, Settings toggle, packs
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
const overrides = {
  './db': { getDb: () => db },
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
const ledger = load('lib/stockLedgerQuery.ts')
const env = { DB: raw }
const KHMER = /[ក-៿]/

// ---- fixtures -----------------------------------------------------------------------------------------
seedStockFixture(raw.db, () => raw.db.prepare("INSERT OR IGNORE INTO branches (id, name, is_default, is_active) VALUES (1, 'LC Store', 1, 1)").run())
function productRow(name, stock, low = 10, out = 0) {
  return seedStockFixture(raw.db, () => {
    const id = Number(raw.db.prepare('INSERT INTO products (name, stock_quantity, low_stock_threshold, out_of_stock_threshold, is_active) VALUES (?, ?, ?, ?, 1)').run(name, stock, low, out).lastInsertRowid)
    raw.db.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, 1, ?)').run(id, stock)
    return id
  })
}
// A movement row, as the ledger stores it: positive magnitudes for outflows too (transfer_out), exactly the trap.
function movement(productId, type, quantity, branchId = 1) {
  seedStockFixture(raw.db, () => raw.db.prepare('INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity) VALUES (?, ?, ?, ?, ?)').run(productId, 'x', branchId, type, quantity))
}
// What a restock leaves behind: an 'add' movement and the branch quantity.
function restock(productId, quantity) {
  movement(productId, 'add', quantity)
  seedStockFixture(raw.db, () => raw.db.prepare('UPDATE branch_stock SET quantity = quantity + ? WHERE product_id = ? AND branch_id = 1').run(quantity, productId))
}
// The deduction a sale commits (the recorder runs AFTER it, so tests apply it first, as the route does).
function take(productId, quantity, branchId = 1) {
  seedStockFixture(raw.db, () => raw.db.prepare('UPDATE branch_stock SET quantity = quantity - ? WHERE product_id = ? AND branch_id = ?').run(quantity, productId, branchId))
  movement(productId, 'sale', -quantity, branchId)
}
const line = (productId, quantity, branchId = 1, after) => ({ productId, branchId, quantity, ...(after === undefined ? {} : { after }) })
const hook = (saleId, lines) => alert.recordStockCrossings(env, { saleId, lines })
const sell = (saleId, productId, quantity) => { take(productId, quantity); return hook(saleId, [line(productId, quantity)]) }
const rows = () => raw.db.prepare('SELECT product_id, tier, sale_id, quantity_before, quantity_after, telegram_status FROM stock_crossing_alerts ORDER BY id').all()
const setting = (key, value) => seedStockFixture(raw.db, () => raw.db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value)))
const reset = () => { sent.length = 0; transport = async (event) => { sent.push(event); return true } }
const compose = (event, language = 'both') => {
  lang.setTelegramLanguage(language)
  const text = [lang.localizeTelegramHeading(event.heading), ...event.lines.filter(Boolean).map((l) => lang.localizeTelegramLine(l))].join('\n')
  lang.setTelegramLanguage('both')
  return text
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
    assert.equal(c(10.5, 9.5, 10, 0), 'low', 'fractions: crossing')
    assert.equal(c(5, 7, 10, 0), null, 'a quantity going UP is never a crossing')
  })

  await check('detect: before is derived from the REAL quantity now (after + units taken); repeated lines are one line', () => {
    const state = (productId, quantity, after) => ({ productId, branchId: 1, quantity, after, name: `P${productId}`, lowThreshold: 10, outThreshold: 0 })
    assert.deepEqual(alert.detectCrossings([state(1, 4, 8)], config).map((x) => [x.tier, x.before, x.after]), [['low', 12, 8]])
    assert.deepEqual(alert.detectCrossings([state(1, 2, 12)], config), [], '14 -> 12: still above')
    // 13 -> 11 -> 9 where BOTH sales are already committed: the first sale's own before is 11, and it crosses.
    assert.deepEqual(alert.detectCrossings([state(1, 2, 9)], config).map((x) => [x.tier, x.before, x.after]), [['low', 11, 9]])
    assert.deepEqual(alert.mergeSaleLines([line(1, 2), line(1, 3), line(2, 1), line(3, 0), line(4, -1)]), [line(1, 5), line(2, 1)])
  })

  // ---- exactly once, against the real claim keys -----------------------------------------------------------
  const a = productRow('Glow Serum', 12)
  await check('a crossing alerts exactly once (and is recorded)', async () => {
    const result = await sell(101, a, 3) // 12 -> 9
    assert.deepEqual(result, { crossings: 1, claimed: 1, sent: 1 })
    assert.equal(sent.length, 1)
    assert.equal(sent[0].type, 'stock_alert')
    assert.equal(sent[0].heading, '⚠️ Low stock')
    assert.deepEqual(rows().map((r) => [r.product_id, r.tier, r.sale_id, r.quantity_before, r.quantity_after, r.telegram_status]), [[a, 'low', 101, 12, 9, 'sent']])
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
    assert.ok(!KHMER.test(compose({ heading: '⚠️ Low stock', lines: ['Product: Glow Serum', 'Branch: LC Store', 'On hand: 9'] }, 'en')), 'English-only mode stays English')
  })

  await check('out of stock: the same three rows, quantity 0', async () => {
    const out = await sell(103, productRow('Last One', 1), 1)
    assert.equal(out.sent, 1)
    assert.equal(sent[0].heading, '🛑 Out of stock')
    assert.deepEqual(sent[0].lines, ['Product: Last One', 'Branch: LC Store', 'On hand: 0'])
  })

  await check('no alert when the sale stays above the threshold, or the product was already low', async () => {
    const before = rows().length
    const b = productRow('Plenty', 50)
    assert.deepEqual(await sell(104, b, 5), { crossings: 0, claimed: 0, sent: 0 })
    assert.deepEqual(await sell(105, a, 2), { crossings: 0, claimed: 0, sent: 0 }, '9 -> 7 is not a new crossing')
    assert.equal(sent.length, 0)
    assert.equal(rows().length, before)
  })

  await check('a retry of the same hook (committed sale, the hook ran twice) sends nothing more', async () => {
    const again = await hook(101, [line(a, 3)])
    assert.equal(again.sent, 0)
    assert.equal(sent.length, 0)
    assert.equal(rows().filter((r) => r.product_id === a).length, 1)
  })

  // ---- the race (review P2-2) -------------------------------------------------------------------------------
  await check('tills racing 13 -> 11 -> 9: both committed before either hook reads, exactly one message, On hand is the real 9', async () => {
    const c = productRow('Race Cream', 13)
    take(c, 2); take(c, 2) // both sales committed
    const first = await hook(201, [line(c, 2)])
    const second = await hook(202, [line(c, 2)])
    assert.equal(first.sent + second.sent, 1, JSON.stringify([first, second]))
    assert.equal(sent.length, 1)
    assert.equal(sent[0].lines[2], 'On hand: 9', 'the real value, not the stale 11')
    assert.equal(rows().filter((r) => r.product_id === c).length, 1)
  })

  await check('residual race closed: the quantity each deduction LEFT (RETURNING) makes 13 -> 10 -> 7 alert once even with both hooks after both commits', async () => {
    const c = productRow('Race Lotion', 13)
    take(c, 3); take(c, 3) // 13 -> 10 -> 7, both committed
    // Each sale's own batch told it what it left: 10 and 7. The first one crossed low (13 -> 10), whatever the shelf says now.
    const first = await hook(221, [line(c, 3, 1, 10)])
    const second = await hook(222, [line(c, 3, 1, 7)])
    assert.equal(first.sent + second.sent, 1, JSON.stringify([first, second]))
    assert.equal(sent.length, 1)
    assert.equal(sent[0].lines[2], 'On hand: 10', "the quantity that sale left, not today's 7")
    // The fallback (no RETURNING, e.g. a recovered create) reads the shelf after the commit and cannot see this one: it is the
    // documented limit of the fallback, pinned so nobody mistakes it for the exact path.
    const d = productRow('Race Fallback', 13)
    take(d, 3); take(d, 3)
    reset()
    const lost = (await hook(231, [line(d, 3)])).sent + (await hook(232, [line(d, 3)])).sent
    assert.equal(lost, 0)
  })

  await check('an `after` on the last of several lines of one product wins; a mixed call still reads the shelf for lines without one', async () => {
    assert.deepEqual(alert.mergeSaleLines([line(1, 2, 1, 11), line(1, 3, 1, 8), line(2, 1)]), [{ productId: 1, branchId: 1, quantity: 5, after: 8 }, line(2, 1)])
    const e = productRow('Two Line', 13)
    const f = productRow('Shelf Read', 12)
    take(e, 5); take(f, 3)
    const result = await hook(241, [line(e, 2, 1, 11), line(e, 3, 1, 8), line(f, 3)])
    assert.deepEqual(result, { crossings: 2, claimed: 2, sent: 1 })
    assert.deepEqual(sent[0].lines.filter((l) => l.startsWith('•')).sort(), ['• Shelf Read · 9', '• Two Line · 8'])
  })

  await check('the multi-product count row is bilingual with its own short Khmer word', () => {
    const text = compose({ heading: '⚠️ Low stock', lines: ['Branch: LC Store', 'Product count: 2', '• A · 9', '• B · 8'] })
    assert.ok(text.includes('Product count') && text.includes('ចំនួនផលិតផល'), text)
    assert.ok(!text.includes('Products /'), 'not the plain "Products" label, which names the thing and not the count')
    assert.equal(lang.TELEGRAM_LABELS.activeProducts.km, 'ចំនួនផលិតផល')
  })

  await check('tills racing the other way (the first hook runs before the second sale commits): still exactly one', async () => {
    const c = productRow('Race Balm', 13)
    take(c, 2)
    const first = await hook(211, [line(c, 2)]) // sees 11: no crossing yet
    assert.equal(first.crossings, 0)
    take(c, 2)
    const second = await hook(212, [line(c, 2)]) // sees 9: crossing
    assert.equal(second.sent, 1)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].lines[2], 'On hand: 9')
  })

  // ---- the restock marker (review P3-1) -----------------------------------------------------------------------
  await check('the restock marker counts only real inflows: transfer_out stored as a positive amount does not start a new crossing', async () => {
    const d = productRow('Outflow Mist', 12)
    assert.equal((await sell(301, d, 3)).sent, 1)
    movement(d, 'transfer_out', 4) // a positive magnitude, an outflow
    movement(d, 'remove', 1)
    movement(d, 'move_out', 1)
    reset()
    const again = await sell(302, d, 1) // a different sale, same crossing episode (no real restock in between): the claim holds
    assert.equal(again.crossings, 0, 'already low')
    const repeat = await hook(301, [line(d, 3)])
    assert.equal(repeat.sent, 0)
    // A racing sale of the same episode lands after the outflows: same epoch, so it collapses with the first.
    const racing = await hook(303, [line(d, 3)])
    assert.deepEqual(racing, { crossings: 1, claimed: 0, sent: 0 }, 'an outflow did not move the epoch')
    assert.equal(sent.length, 0)
    for (const type of ledger.LEDGER_OUT_TYPES) assert.ok(alert.RESTOCK_EPOCH_SQL.includes(`'${type}'`), `${type} is excluded from the marker`)
    for (const type of ['add', 'stock_in', 'transfer_in', 'move_in', 'return', 'adjustment', 'damage_reversal']) assert.ok(!ledger.LEDGER_OUT_TYPES.includes(type), `${type} is an inflow`)
  })

  await check('a restock followed by another crossing alerts again (a new crossing)', async () => {
    const e = productRow('Mist', 12)
    assert.equal((await sell(401, e, 3)).sent, 1)
    restock(e, 40) // 9 -> 49
    reset()
    assert.equal((await sell(402, e, 5)).crossings, 0, 'back above: silent')
    const again = await sell(403, e, 42) // 44 -> 2
    assert.deepEqual(again, { crossings: 1, claimed: 1, sent: 1 })
    assert.equal(rows().filter((r) => r.product_id === e).length, 2, 'two crossings on record')
    movement(e, 'transfer_in', 5) // every real inflow type moves the epoch
    movement(e, 'return', 1)
    movement(e, 'adjustment', 1)
  })

  await check('every real inflow type starts a new episode', async () => {
    for (const type of ['add', 'stock_in', 'transfer_in', 'move_in', 'return', 'adjustment']) {
      const f = productRow(`Inflow ${type}`, 12)
      assert.equal((await sell(500, f, 3)).sent, 1)
      seedStockFixture(raw.db, () => raw.db.prepare('UPDATE branch_stock SET quantity = 30 WHERE product_id = ?').run(f))
      movement(f, type, 21)
      reset()
      assert.equal((await sell(501, f, 25)).sent, 1, `${type} then a crossing alerts again`)
    }
  })

  await check('undo then redo of a sale does not repeat the alert', async () => {
    const g = productRow('Cleanser', 12)
    assert.equal((await sell(601, g, 3)).sent, 1)
    restock(g, 3) // the undo: the units come back
    reset()
    take(g, 3) // the redo takes the same units for the same sale again
    const redo = await hook(601, [line(g, 3)])
    assert.deepEqual(redo, { crossings: 1, claimed: 0, sent: 0 })
    assert.equal(sent.length, 0)
    assert.equal(rows().filter((r) => r.product_id === g).length, 1)
    restock(g, 3)
    const other = await sell(602, g, 3) // a DIFFERENT sale after the same restock is a legitimate new crossing
    assert.equal(other.sent, 1)
  })

  await check('out of stock: a jump from healthy raises the out alert only; a raised per-product threshold is honoured', async () => {
    const h = productRow('Jumper', 30)
    const jump = await sell(701, h, 30)
    assert.deepEqual(jump, { crossings: 1, claimed: 1, sent: 1 })
    assert.equal(sent[0].heading, '🛑 Out of stock')
    assert.deepEqual(rows().filter((r) => r.product_id === h).map((r) => r.tier), ['out'])
    const raised = productRow('Raised', 9, 10, 4)
    reset()
    assert.equal((await sell(702, raised, 5)).sent, 1)
    assert.equal(sent[0].heading, '🛑 Out of stock')
  })

  // ---- one message per branch and tier (review P3-7) ------------------------------------------------------------
  await check('several products in one sale: ONE message lists them all, with the real quantities', async () => {
    const ids = [productRow('Multi A', 12), productRow('Multi B', 11), productRow('Multi C', 40)]
    ids.forEach((id) => take(id, id === ids[2] ? 1 : 3))
    const result = await hook(800, ids.map((id, i) => line(id, i === 2 ? 1 : 3)))
    assert.equal(result.claimed, 2, 'C stayed above')
    assert.equal(sent.length, 1)
    assert.deepEqual(sent[0].lines, ['Branch: LC Store', 'Product count: 2', '• Multi A · 9', '• Multi B · 8'])
    const text = compose(sent[0])
    console.log(text.split('\n').map((l) => '    | ' + l).join('\n'))
    assert.ok(text.includes('Low stock') && text.includes('ស្តុកទាប') && KHMER.test(text.split('\n')[1]) && KHMER.test(text.split('\n')[2]), text)
  })

  await check('mixed tiers are two messages (out of stock first), and a large sale is capped with "+ N more item(s)"', async () => {
    const low = productRow('Mixed Low', 12)
    const out = productRow('Mixed Out', 2)
    take(low, 3); take(out, 2)
    const result = await hook(810, [line(low, 3), line(out, 2)])
    assert.equal(result.sent, 2)
    assert.deepEqual(sent.map((event) => event.heading), ['🛑 Out of stock', '⚠️ Low stock'])
    reset()
    const many = Array.from({ length: 23 }, (_, i) => productRow(`Bulk ${String(i).padStart(2, '0')}`, 12))
    many.forEach((id) => take(id, 3))
    const bulk = await hook(811, many.map((id) => line(id, 3)))
    assert.equal(bulk.claimed, 23)
    assert.equal(sent.length, 1, 'one message for 23 products, not 23')
    const rowsShown = sent[0].lines.filter((l) => l.startsWith('• '))
    assert.equal(rowsShown.length, alert.CROSSING_MESSAGE_PRODUCT_CAP)
    assert.equal(sent[0].lines[sent[0].lines.length - 1], '+ 3 more item(s)')
    assert.equal(sent[0].lines[1], 'Product count: 23')
    assert.ok(/\+ 3 .*[ក-៿]/.test(lang.localizeTelegramLine('+ 3 more item(s)')), 'the continuation row is bilingual')
    assert.equal(rows().filter((r) => r.sale_id === 811).length, 23, 'every crossing is still recorded')
  })

  await check('a duplicate hook over a multi-product sale claims nothing and sends nothing', async () => {
    const x = productRow('Dup A', 12)
    const y = productRow('Dup B', 12)
    take(x, 3); take(y, 3)
    assert.equal((await hook(820, [line(x, 3), line(y, 3)])).sent, 1)
    reset()
    assert.deepEqual(await hook(820, [line(x, 3), line(y, 3)]), { crossings: 2, claimed: 0, sent: 0 })
  })

  await check('switches: low alert OFF silences low but not out; the global threshold mode is honoured', async () => {
    setting('low_stock_alert_enabled', 'false')
    const i = productRow('Switch A', 12)
    assert.equal((await sell(901, i, 3)).crossings, 0, 'low crossing is not a crossing while the alert is off')
    assert.equal((await sell(902, productRow('Switch B', 2), 2)).sent, 1, 'out of stock still fires')
    setting('low_stock_alert_enabled', 'true')
    setting('low_stock_threshold_mode', 'global')
    setting('low_stock_threshold_default', '20')
    reset()
    const j = productRow('Global', 25, 10, 0) // its own threshold 10 is ignored in global mode
    assert.equal((await sell(903, j, 6)).sent, 1, '25 -> 19 crosses the GLOBAL 20')
    setting('low_stock_threshold_mode', 'product')
  })

  await check('Telegram switched off: the crossing is still recorded, nothing is sent, the row says skipped', async () => {
    transport = async () => false // what sendTelegramEvent answers when the category / automation / chat id is off
    const k = productRow('Quiet', 12)
    assert.deepEqual(await sell(1001, k, 3), { crossings: 1, claimed: 1, sent: 0 })
    assert.equal(rows().find((r) => r.product_id === k).telegram_status, 'skipped')
  })

  await check('a failing transport never reaches the sale and is never retried', async () => {
    const l = productRow('Flaky', 12)
    let calls = 0
    transport = async () => { calls += 1; throw new Error('telegram_rejected') }
    assert.deepEqual(await sell(1101, l, 3), { crossings: 1, claimed: 1, sent: 0 })
    assert.equal(rows().find((r) => r.product_id === l).telegram_status, 'failed')
    assert.equal((await hook(1101, [line(l, 3)])).claimed, 0)
    assert.equal(calls, 1, 'at most once')
  })

  await check('rows are scoped by branch: the same product crossing at another branch is its own crossing', async () => {
    const m = productRow('Two Branch', 12)
    seedStockFixture(raw.db, () => {
      raw.db.prepare("INSERT OR IGNORE INTO branches (id, name, is_active) VALUES (2, 'Other', 1)").run()
      raw.db.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, 2, 12)').run(m)
    })
    take(m, 3)
    assert.equal((await hook(1201, [line(m, 3)])).sent, 1)
    take(m, 3, 2)
    assert.equal((await hook(1202, [line(m, 3, 2)])).sent, 1)
    assert.equal(rows().filter((r) => r.product_id === m).length, 2)
  })

  await check('deploy order: without table 0272 nothing is recorded or sent and nothing throws', async () => {
    seedStockFixture(raw.db, () => raw.db.exec('ALTER TABLE stock_crossing_alerts RENAME TO stock_crossing_alerts_parked'))
    const n = productRow('No Table', 12)
    const errors = []; const realError = console.error; console.error = (...a) => { errors.push(a) }
    try { assert.deepEqual(await sell(1301, n, 3), { crossings: 0, claimed: 0, sent: 0 }) } finally { console.error = realError }
    assert.equal(errors.length, 0, 'a missing table is silent')
    assert.equal(sent.length, 0)
    // cold isolate: no probe memo exists any more, and a repeat call is just as safe
    assert.deepEqual(await sell(1302, productRow('No Table 2', 12), 3), { crossings: 0, claimed: 0, sent: 0 })
    seedStockFixture(raw.db, () => raw.db.exec('ALTER TABLE stock_crossing_alerts_parked RENAME TO stock_crossing_alerts'))
  })

  await check('the sale can never fail because of an alert: a broken database is swallowed', async () => {
    const errors = []; const realError = console.error; console.error = (...a) => { errors.push(a) }
    overrides['./db'].getDb = () => { throw new Error('d1 down') }
    const result = await alert.recordStockCrossings(env, { saleId: 1, lines: [line(a, 3)] })
    overrides['./db'].getDb = () => db
    console.error = realError
    assert.equal(errors.length, 1, 'any other failure is still logged (only the missing table is silent)')
    assert.deepEqual(result, { crossings: 0, claimed: 0, sent: 0 })
  })

  // ---- wiring: read from the source (the real transport is never loaded) -----------------------------------
  const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r/g, '')
  await check('wiring: the create hook runs before the replay return and passes the quantity the batch left (every other path is pinned by test-stock-deduction-paths-pure.cjs)', () => {
    const sales = read('routes/sales.ts')
    assert.ok(sales.includes("import { recordStockCrossings, type StockSaleLine } from '../lib/stockCrossingAlert'"))
    const create = sales.indexOf('recordStockCrossings(c.env, {\n    saleId,')
    assert.ok(create > 0 && create < sales.indexOf('if (recoveredCommittedCreate) {\n    return c.json({ id: saleId'), 'the create hook runs BEFORE the replay early return, so a lost response still alerts')
    assert.ok(/saleId,\n\s+lines: stockCheckItems\.map/.test(sales) && !/before:/.test(sales.slice(create, create + 900)), 'no pre-commit quantity is passed')
    assert.ok(sales.slice(create, create + 900).includes('createResults['), 'the quantity comes from the batch results')
    assert.ok(!read('lib/stockActionCommit.ts').includes('recordStockCrossings'), 'the stock-import sale is a historical load and deliberately does not alert')
  })

  await check('wiring: category, topic, switch default, Settings toggle, packs; a restore clears the log', () => {
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
    assert.ok(read('lib/backup.ts').includes('DELETE FROM ${qid(STOCK_CROSSING_ALERTS_TABLE)}'), 'restore clears the log (behaviour pinned in test-backup-legacy-restore-pure)')
  })

  await check('wiring: no chat, topic or token id is hard-coded in the alert module', () => {
    const source = read('lib/stockCrossingAlert.ts').replace(/\/\/.*$/gm, '')
    assert.ok(!/-?\d{6,}/.test(source), 'no long numeric id')
    assert.ok(!/chat_id|chatId|message_thread_id|BOT_TOKEN/i.test(source), 'chat and topic come from the per-organisation settings inside sendTelegramEvent')
  })

  await check('migration 0272: schema only, PRE/POST present, unique keys exist, header states the inflow rule', () => {
    const file = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0272_stock_crossing_alerts.sql'), 'utf8')
    assert.ok(file.includes('stock_crossing_alerts_0272_pre') && file.includes('stock_crossing_alerts_0272_post'))
    assert.ok(!/^\s*(INSERT|UPDATE|DELETE)\b/im.test(file.replace(/--.*$/gm, '')), 'no data statement')
    assert.ok(/INFLOW/.test(file) && /LEDGER_OUT_TYPES/.test(file) && !/quantity > 0 for that product and branch, i\.e\./.test(file))
    const unique = raw.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='stock_crossing_alerts' AND sql LIKE 'CREATE UNIQUE%'").all().map((r) => r.name)
    assert.deepEqual(unique, ['idx_stock_crossing_alerts_sale'])
  })

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
