// SCAN2 U1 + U8 (lane N3 BULK-STATUS), on the real routes and the fully
// migrated schema:
//   U1  a grouped cancel dates its lost-fee expense with the Cambodia business
//       day, as the single cancel does since M7 (00:30 local is the next UTC+7
//       day, not the UTC day), and undo/redo keep that date.
//   U8  a grouped status change, and every undo/redo of one or of a
//       settlement, is announced on Telegram exactly as the single status
//       change announces the same move: one message per action, only from the
//       call whose batch wrote it, in the direction the replay moved the sale,
//       and nothing for a refused replay.
// Only auth, cache bumps and the broadcast hub are stubbed. fetch to
// api.telegram.org is recorded, never sent; the bot token and chat id are
// made up.
//
// Run (from cloudflare/): node scripts/test-bulk-status-fee-date-telegram-pure.cjs
'use strict'
process.env.TZ = 'UTC'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transformSync } = require('esbuild')
const Database = require('better-sqlite3')

const root = path.join(__dirname, '..')
const CHAT_ID = '-1000000000042'
const USER = { id: 1, name: 'Admin', username: 'admin', role_code: 'admin', permissions: { all: true } }
const STUBS = {
  auth: { requireAuth: async (c, next) => { c.set('user', USER); return next() } },
  cache: { bumpVersion: async () => {}, bumpVersions: async () => {}, getVersionWithFallback: async () => 0, cachedJsonResponse: async (_env, _key, _ttl, build) => build() },
  broadcastHub: { broadcast: async () => {} },
}

const loaded = new Map()
function load(file) {
  if (loaded.has(file)) return loaded.get(file).exports
  const mod = { exports: {} }
  loaded.set(file, mod)
  const code = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022', sourcefile: file }).code
  const localRequire = (request) => {
    const stub = STUBS[path.posix.basename(request)]
    if (request.startsWith('.') && stub) return stub
    if (request.startsWith('.')) return load(path.resolve(path.dirname(file), `${request}.ts`))
    return require(request)
  }
  new Function('require', 'module', 'exports', code)(localRequire, mod, mod.exports)
  return mod.exports
}
const sales = load(path.join(root, 'src', 'routes', 'sales.ts')).default
const history = load(path.join(root, 'src', 'routes', 'actionHistory.ts')).default
const detection = fs.readFileSync(path.join(root, '..', 'ops', 'queries', 'forensics-m7-cancel-fee-business-date.sql'), 'utf8')

const sent = []
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === 'string' ? input : input.url)
  if (!url.startsWith('https://api.telegram.org/')) throw new Error(`test blocks fetch to ${url}`)
  sent.push(JSON.parse(init.body))
  return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }), { status: 200, headers: { 'content-type': 'application/json' } })
}
const telegramFailures = []
const realConsoleError = console.error
console.error = (...args) => {
  if (String(args[0]).includes('[telegram]')) telegramFailures.push(args.map(String).join(' '))
  realConsoleError(...args)
}

const RealDate = Date
function freeze(iso) {
  const ms = RealDate.parse(iso)
  globalThis.Date = class FrozenDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(ms); else super(...args) }
    static now() { return ms }
  }
}
function thaw() { globalThis.Date = RealDate }

function fixture() {
  const sql = new Database(':memory:')
  sql.pragma('foreign_keys = OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    sql.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  }
  sql.exec(`
    INSERT INTO branches(id,name) VALUES(1,'Shop'),(2,'Warehouse');
    INSERT INTO products(id,name,stock_quantity) VALUES(1,'Serum',500);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,500);
    INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES
      ('telegram_chat_id','${CHAT_ID}','s1'),('telegram_language','en','s1'),
      ('exchange_rate','4100','s1'),('change_exchange_rate','4000','s1'),('pos_payment_methods','["ABA Bank"]','s1');
  `)
  const statement = (text, params) => ({
    text, params,
    async first() { return sql.prepare(text).get(...params) || null },
    async all() { return { results: sql.prepare(text).all(...params) } },
    async run() { const r = sql.prepare(text).run(...params); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } } },
  })
  const env = {
    TELEGRAM_BOT_TOKEN: 'test-token-not-a-bot',
    DB: {
      prepare(text) { return { ...statement(text, []), bind: (...params) => statement(text, params) } },
      async batch(statements) {
        return sql.transaction(() => statements.map((s) => {
          const r = sql.prepare(s.text).run(...s.params)
          return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }
        }))()
      },
    },
  }
  const pending = []
  const ctx = { waitUntil(work) { pending.push(work) }, passThroughOnException() {} }
  const call = async (app, url, body, method = 'POST') => {
    const response = await app.request(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, env, ctx)
    const text = await response.text()
    await Promise.allSettled(pending.splice(0))
    let parsed
    try { parsed = JSON.parse(text) } catch { parsed = { error: text } }
    return { status: response.status, body: parsed }
  }
  return { sql, env, call }
}

function seedSale(f, id, receipt, status = 'completed') {
  f.sql.prepare("INSERT INTO sales(id,receipt_number,sale_status,branch_id,customer_name,updated_at) VALUES(?,?,?,1,'Dara','v1')").run(id, receipt, status)
  f.sql.prepare("INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id) VALUES(?,?,1,'Serum',2,1)").run(id, id)
}
function member(f, id, extra = {}) {
  const sale = f.sql.prepare('SELECT sale_status,updated_at FROM sales WHERE id=?').get(id)
  return { id, expected_status: sale.sale_status, expected_updated_at: sale.updated_at, ...extra }
}
const cancelWithFee = { reason: 'buyer_refused', fee_usd: 1.5, fee_khr: 2000 }
function bulkCancel(f, key, ids) {
  return f.call(sales, '/bulk-status', { client_request_id: key, target_status: 'cancelled', items: ids.map((id) => member(f, id, { cancel: cancelWithFee })) })
}
function replay(f, historyId, direction, generation) {
  return f.call(history, `/${historyId}/${direction}`, { require_applied: true, expected_generation: generation })
}
function linkedFee(f, saleId) {
  return f.sql.prepare('SELECT f.* FROM sales s JOIN fees f ON f.id=s.cancel_fee_id WHERE s.id=?').get(saleId)
}
function messagesSince(mark) {
  return sent.slice(mark)
}
function swapStatuses(text) {
  return text.replace(/^(.*Status updated: )(.+) → (.+)$/m, (_line, label, from, to) => `${label}${to} → ${from}`)
}
function statusLine(text) {
  return text.split('\n').find((line) => line.includes('Status updated: '))
}

let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failed += 1; console.log(`FAIL ${name}\n      ${error && error.stack}`) }
}

;(async () => {
  const f = fixture()

  await check('U1: a grouped cancel at 00:30 Cambodia books its lost fee on that business day, and undo/redo keep it', async () => {
    seedSale(f, 1, 'R-U1-A'); seedSale(f, 2, 'R-U1-B')
    freeze('2031-01-15T17:30:00.000Z')
    let applied
    try { applied = await bulkCancel(f, 'u1-after-midnight', [1, 2]) } finally { thaw() }
    assert.equal(applied.status, 200, JSON.stringify(applied.body))
    for (const saleId of [1, 2]) {
      const fee = linkedFee(f, saleId)
      assert.ok(fee, `sale ${saleId} has no linked lost-fee expense`)
      assert.equal(fee.fee_date, '2031-01-16', 'fee_date must be the Cambodia business day (UTC+7), not the UTC day')
    }
    freeze('2031-01-16T02:00:00.000Z')
    try {
      assert.equal((await replay(f, applied.body.actionHistoryId, 'undo', 0)).status, 200)
      assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM fees WHERE sale_id IN (1,2)').get().n, 0, 'undo removes the lost fees')
      assert.equal((await replay(f, applied.body.actionHistoryId, 'redo', 1)).status, 200)
    } finally { thaw() }
    assert.deepEqual([linkedFee(f, 1).fee_date, linkedFee(f, 2).fee_date], ['2031-01-16', '2031-01-16'], 'redo restores the fee on its business day')
  })

  await check('U1 control: a daytime grouped cancel lands on the same day either way', async () => {
    seedSale(f, 3, 'R-U1-C')
    freeze('2031-01-16T03:00:00.000Z')
    let applied
    try { applied = await bulkCancel(f, 'u1-daytime', [3]) } finally { thaw() }
    assert.equal(applied.status, 200, JSON.stringify(applied.body))
    assert.equal(linkedFee(f, 3).fee_date, '2031-01-16')
  })

  await check('U1 detection: the M7 query passes the grouped writer\'s fees and flags a UTC-dated grouped fee', () => {
    f.sql.prepare("INSERT INTO sales(id,receipt_number,branch_id,sale_status,cancelled_at,cancel_fee_id) VALUES(9101,'R-U1-OLD',1,'cancelled','2031-02-02T22:00:00.000Z',-9101)").run()
    f.sql.prepare("INSERT INTO fees(id,fee_type,label,amount_usd,amount_khr,fee_date,sale_id,branch_id) VALUES(-9101,'expense','old grouped lost fee',1,0,'2031-02-02',9101,1)").run()
    const flagged = f.sql.prepare(detection).all()
    assert.deepEqual(flagged.map((row) => row.fee_id), [-9101], 'only the UTC-dated grouped fee is flagged')
    assert.equal(flagged[0].writer, 'grouped')
    assert.equal(flagged[0].business_date, '2031-02-03')
  })

  await check('U8: a grouped cancel is announced once, exactly as the single cancel announces the same change', async () => {
    seedSale(f, 11, 'R-SINGLE'); seedSale(f, 12, 'R-GROUP')
    let mark = sent.length
    assert.equal((await f.call(sales, '/11/status', { sale_status: 'cancelled', expected_updated_at: 'v1', client_request_id: 'u8-single-cancel', cancel_reason: 'buyer_refused', cancel_fee_usd: 1.5, cancel_fee_khr: 2000 }, 'PATCH')).status, 200)
    const [singleMessage] = messagesSince(mark)
    assert.ok(singleMessage && /Lost fee/.test(singleMessage.text), 'fixture: the single cancel announces its lost fee')
    const groupRequest = { client_request_id: 'u8-group-cancel', target_status: 'cancelled', items: [member(f, 12, { cancel: cancelWithFee })] }
    mark = sent.length
    const grouped = await f.call(sales, '/bulk-status', groupRequest)
    assert.equal(grouped.status, 200, JSON.stringify(grouped.body))
    const messages = messagesSince(mark)
    assert.equal(messages.length, 1, 'one grouped action is one Telegram message')
    assert.equal(messages[0].message_thread_id, singleMessage.message_thread_id, 'same topic as the single status change')
    assert.equal(messages[0].text, singleMessage.text.replace('R-SINGLE', 'R-GROUP'))
    mark = sent.length
    const retried = await f.call(sales, '/bulk-status', groupRequest)
    assert.equal(retried.status, 200, JSON.stringify(retried.body))
    assert.equal(retried.body.operationId, grouped.body.operationId, 'fixture: the retry is answered from the stored receipt')
    assert.equal(messagesSince(mark).length, 0, 'a replayed request id announces nothing')
  })

  await check('U8: a grouped move announces only the members it changed, and a skipped-stock cancel says so', async () => {
    seedSale(f, 24, 'R-APPLY-1', 'awaiting_delivery'); seedSale(f, 25, 'R-APPLY-2', 'awaiting_delivery'); seedSale(f, 26, 'R-APPLY-STAYS', 'completed')
    let mark = sent.length
    const moved = await f.call(sales, '/bulk-status', { client_request_id: 'u8-apply-mixed', target_status: 'completed', items: [24, 25, 26].map((id) => member(f, id)) })
    assert.equal(moved.status, 200, JSON.stringify(moved.body))
    const movedMessages = messagesSince(mark)
    assert.equal(movedMessages.length, 1, 'one grouped action is one Telegram message')
    const [movedMessage] = movedMessages
    assert.deepEqual(movedMessage.text.split('\n').filter((line) => line.includes('Status updated: ')).map((line) => line.split('Status updated: ')[1]),
      ['Awaiting Delivery → Completed', 'Awaiting Delivery → Completed'], movedMessage.text)
    assert.ok(!movedMessage.text.includes('R-APPLY-STAYS'), 'an unchanged member is not announced')
    seedSale(f, 43, 'R-SKIP-SINGLE-2'); seedSale(f, 44, 'R-SKIP-GROUP-2')
    mark = sent.length
    assert.equal((await f.call(sales, '/43/status', { sale_status: 'cancelled', expected_updated_at: 'v1', client_request_id: 'u8-apply-skip-single', cancel_reason: 'mistake', skip_stock: true }, 'PATCH')).status, 200)
    const [singleSkip] = messagesSince(mark)
    mark = sent.length
    assert.equal((await f.call(sales, '/bulk-status', { client_request_id: 'u8-apply-skip-group', target_status: 'cancelled', cancel_reason: 'mistake', skip_stock: true, items: [member(f, 44)] })).status, 200)
    assert.deepEqual(messagesSince(mark).map((message) => message.text), [singleSkip.text.replace('R-SKIP-SINGLE-2', 'R-SKIP-GROUP-2')])
  })

  await check('U8: two copies of one grouped request racing are announced once, by the copy whose batch wrote', async () => {
    seedSale(f, 27, 'R-RACE', 'awaiting_delivery')
    const request = { client_request_id: 'u8-race-copies', target_status: 'completed', items: [member(f, 27)] }
    const realBatch = f.env.DB.batch
    let winner
    f.env.DB.batch = async (statements) => {
      f.env.DB.batch = realBatch
      winner = await f.call(sales, '/bulk-status', request)
      return realBatch(statements)
    }
    const mark = sent.length
    let loser
    try { loser = await f.call(sales, '/bulk-status', request) } finally { f.env.DB.batch = realBatch }
    assert.equal(loser.status, 200, JSON.stringify(loser.body))
    assert.equal(winner?.status, 200, 'fixture: the winning copy wrote while the other copy was about to')
    assert.equal(loser.body.operationId, winner.body.operationId, 'fixture: the losing copy is answered with the winner\'s stored receipt')
    const messages = messagesSince(mark)
    assert.equal(messages.length, 1, messages.map((message) => message.text).join('\n---\n'))
    assert.ok(messages[0].text.includes('R-RACE'))
  })

  await check('U8: undoing a group announces only the members it moved, one block each, in one message', async () => {
    seedSale(f, 21, 'R-MOVE-1', 'awaiting_delivery'); seedSale(f, 22, 'R-MOVE-2', 'awaiting_delivery'); seedSale(f, 23, 'R-STAYS', 'completed')
    const applied = await f.call(sales, '/bulk-status', { client_request_id: 'u8-mixed', target_status: 'completed', items: [21, 22, 23].map((id) => member(f, id)) })
    assert.equal(applied.status, 200, JSON.stringify(applied.body))
    assert.deepEqual(applied.body.changedIds, [21, 22])
    const mark = sent.length
    assert.equal((await replay(f, applied.body.actionHistoryId, 'undo', 0)).status, 200)
    const messages = messagesSince(mark)
    assert.equal(messages.length, 1, 'one grouped action is one Telegram message')
    assert.equal(messages[0].chat_id, CHAT_ID)
    const text = messages[0].text
    assert.ok(text.includes('R-MOVE-1') && text.includes('R-MOVE-2'), text)
    assert.ok(!text.includes('R-STAYS'), 'an unchanged member is not announced')
    assert.deepEqual(text.split('\n').filter((line) => line.includes('Status updated: ')).map((line) => line.split('Status updated: ')[1]),
      ['Completed → Awaiting Delivery', 'Completed → Awaiting Delivery'], text)
    assert.ok(!/Lost fee|Reason/.test(text), 'no cancellation facts on a non-cancel move')
  })

  await check('U8: undo and redo of a grouped cancel are announced like the single un-cancel and cancel', async () => {
    seedSale(f, 31, 'R-REPLAY'); seedSale(f, 32, 'R-SINGLE-2')
    let mark = sent.length
    assert.equal((await f.call(sales, '/32/status', { sale_status: 'cancelled', expected_updated_at: 'v1', client_request_id: 'u8-single-cancel-2', cancel_reason: 'buyer_refused', cancel_fee_usd: 1.5, cancel_fee_khr: 2000 }, 'PATCH')).status, 200)
    assert.equal((await f.call(sales, '/32/status', { sale_status: 'completed', expected_updated_at: member(f, 32).expected_updated_at, client_request_id: 'u8-single-uncancel-2' }, 'PATCH')).status, 200)
    const [singleCancel, singleUncancel] = messagesSince(mark).map((message) => message.text.replace('R-SINGLE-2', 'R-REPLAY'))
    assert.ok(singleUncancel && !/Lost fee|Reason/.test(singleUncancel), 'fixture: the single un-cancel names no lost fee or reason')
    const applied = await bulkCancel(f, 'u8-replay', [31])
    assert.equal(applied.status, 200, JSON.stringify(applied.body))
    mark = sent.length
    assert.equal((await replay(f, applied.body.actionHistoryId, 'undo', 0)).status, 200)
    const undone = messagesSince(mark)
    assert.equal(undone.length, 1, 'undo is announced once')
    assert.equal(undone[0].text, singleUncancel, 'undo moved the sale back from Cancelled; its lost fee was removed, not recorded')
    assert.equal(statusLine(undone[0].text), statusLine(swapStatuses(singleCancel)))
    mark = sent.length
    const stale = await replay(f, applied.body.actionHistoryId, 'redo', 0)
    assert.notEqual(stale.status, 200, 'fixture: a stale-generation redo is refused')
    assert.equal(messagesSince(mark).length, 0, 'a refused replay announces nothing')
    assert.equal((await replay(f, applied.body.actionHistoryId, 'redo', 1)).status, 200)
    const redone = messagesSince(mark)
    assert.equal(redone.length, 1, 'redo is announced once')
    assert.equal(redone[0].text, singleCancel, 'redo cancels again, lost fee and reason included')
  })

  await check('U8: undoing a grouped un-cancel restores and announces the sale\'s own lost fee, like its cancel', async () => {
    seedSale(f, 33, 'R-UNCANCEL')
    let mark = sent.length
    assert.equal((await f.call(sales, '/33/status', { sale_status: 'cancelled', expected_updated_at: 'v1', client_request_id: 'u8-uncancel-setup', cancel_reason: 'buyer_refused', cancel_fee_usd: 1.5, cancel_fee_khr: 2000 }, 'PATCH')).status, 200)
    const [singleCancel] = messagesSince(mark).map((message) => message.text)
    const reopened = await f.call(sales, '/bulk-status', { client_request_id: 'u8-group-uncancel', target_status: 'completed', items: [member(f, 33)] })
    assert.equal(reopened.status, 200, JSON.stringify(reopened.body))
    assert.equal(linkedFee(f, 33), undefined, 'fixture: the grouped un-cancel removed the lost fee')
    mark = sent.length
    assert.equal((await replay(f, reopened.body.actionHistoryId, 'undo', 0)).status, 200)
    assert.ok(linkedFee(f, 33), 'fixture: undo restored the lost fee')
    const undone = messagesSince(mark)
    assert.equal(undone.length, 1)
    assert.equal(undone[0].text, singleCancel)
  })

  await check('U8: undo and redo of a grouped cancel that skipped stock say so, like the single un-cancel and cancel', async () => {
    seedSale(f, 41, 'R-SKIP-SINGLE'); seedSale(f, 42, 'R-SKIP-GROUP')
    let mark = sent.length
    assert.equal((await f.call(sales, '/41/status', { sale_status: 'cancelled', expected_updated_at: 'v1', client_request_id: 'u8-skip-single', cancel_reason: 'mistake', skip_stock: true }, 'PATCH')).status, 200)
    assert.equal((await f.call(sales, '/41/status', { sale_status: 'completed', expected_updated_at: member(f, 41).expected_updated_at, client_request_id: 'u8-skip-single-uncancel' }, 'PATCH')).status, 200)
    const [singleCancel, singleUncancel] = messagesSince(mark).map((message) => message.text.replace('R-SKIP-SINGLE', 'R-SKIP-GROUP'))
    assert.ok(/Stock skipped: 2/.test(singleCancel) && /Stock skipped: 2/.test(singleUncancel), 'fixture: the single path names the skipped units both ways')
    const grouped = await f.call(sales, '/bulk-status', { client_request_id: 'u8-skip-group', target_status: 'cancelled', cancel_reason: 'mistake', skip_stock: true, items: [member(f, 42)] })
    assert.equal(grouped.status, 200, JSON.stringify(grouped.body))
    mark = sent.length
    assert.equal((await replay(f, grouped.body.actionHistoryId, 'undo', 0)).status, 200)
    const undone = messagesSince(mark)
    assert.equal(undone.length, 1)
    assert.equal(undone[0].text, singleUncancel)
    mark = sent.length
    assert.equal((await replay(f, grouped.body.actionHistoryId, 'redo', 1)).status, 200)
    assert.deepEqual(messagesSince(mark).map((message) => message.text), [singleCancel])
  })

  await check('U8: undo and redo of a settlement are announced like the settlement itself', async () => {
    f.sql.exec(`
      INSERT INTO sales(id,receipt_number,cashier_name,branch_id,branch_name,customer_name,payment_currency,exchange_rate,
        subtotal_usd,subtotal_khr,discount_usd,tax_usd,total_usd,total_khr,amount_paid_usd,amount_paid_khr,change_usd,change_khr,sale_status,updated_at)
      VALUES(51,'R-SETTLE','Mia',1,'Shop','Dara','USD',4100,5,20500,0,0,5,20500,0,0,0,0,'awaiting_payment','settle-v1');
      INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,applied_price_usd,applied_price_khr,total_usd,total_khr,base_price_usd,branch_id)
      VALUES(51,51,1,'Serum',1,5,20500,5,20500,5,1);
    `)
    let mark = sent.length
    const settled = await f.call(sales, '/51/status', { sale_status: 'completed', expected_updated_at: 'settle-v1', client_request_id: 'u8-settle', expected_exchange_rate: 4100, payment_details: [{ method: 'ABA Bank', amount_usd: 5, amount_khr: 0 }] }, 'PATCH')
    assert.equal(settled.status, 200, JSON.stringify(settled.body))
    const [settleMessage] = messagesSince(mark)
    assert.ok(settleMessage && settleMessage.text.includes('R-SETTLE'), 'fixture: the settlement itself is announced')
    mark = sent.length
    const undone = await replay(f, settled.body.actionHistoryId, 'undo', 0)
    assert.equal(undone.status, 200, JSON.stringify(undone.body))
    assert.equal(f.sql.prepare('SELECT sale_status FROM sales WHERE id=51').get().sale_status, 'awaiting_payment')
    const undoMessages = messagesSince(mark)
    assert.equal(undoMessages.length, 1, 'undoing a settlement is announced once')
    assert.equal(undoMessages[0].text, swapStatuses(settleMessage.text))
    mark = sent.length
    assert.equal((await replay(f, settled.body.actionHistoryId, 'redo', 1)).status, 200)
    const redoMessages = messagesSince(mark)
    assert.equal(redoMessages.length, 1, 'redoing a settlement is announced once')
    assert.equal(redoMessages[0].text, settleMessage.text)
  })

  await check('no Telegram announcement failed along the way', () => {
    assert.deepEqual(telegramFailures, [])
    assert.ok(sent.every((message) => message.chat_id === CHAT_ID), 'every message goes to the synthetic chat only')
  })

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
})().catch((error) => { console.error(error); process.exit(1) })
