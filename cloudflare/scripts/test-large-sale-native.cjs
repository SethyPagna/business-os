#!/usr/bin/env node
// LS1: a sale of any size up to MAX_PRICING_LINES works with REAL-size pricing snapshots.
//
// Each line's pricing_snapshot_json embeds the whole basket pool, so a sale's snapshots are O(n^2): 62 lines 2.6 MB (the Not Paid sale
// that was stuck in production), 86 lines 4.9 MB, 200 lines about 24 MB, against D1's 2,000,000-byte cap on any one value. The real Worker
// runs under Miniflare (workerd's D1 refuses a value over the cap, a control below proves it), every sale is created through the API
// with the real serializeSaleItemPricing over a real pool, and the same flows run on a 10-line sale as the parity baseline.
//
//   create    10 / 62 (Not Paid) / 86 / 200 lines                                  status 200, every line stored, stock and movements exact
//   read      list, create-receipt, duplicate create, and the TILL's own check (frontend canonicalSaleReceipt) on each response
//   flow      add items, amend, replay of both, line-receipt, undo, redo, settle (Not Paid), cancel       on 10 and 62 lines (parity)
//   big       amend + cancel on 86 and 200 lines; a customer return on 86 lines (quote + create), stock restocked
//   controls  a response missing a line, a truncated snapshot, a swapped snapshot, a stock error: the checker must turn red on each
//
// Every step also bounds the STORED copies (response_json, before_json/after_json, the undo payload): each stays far below the cap.
// LS1_ONLY=create,read,flow,big runs a subset; LS1_NAME=<text> keeps the steps whose name contains it. Exit 1 lists every broken step.
'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const { buildSync } = require('esbuild')
const { bootWorld, ORIGIN } = require('./read-budget/world.cjs')

const ONLY = process.env.LS1_ONLY ? new Set(process.env.LS1_ONLY.split(',')) : null
const CAP = 2_000_000
const QUOTE_KEYS = ['gross_usd', 'product_discount_usd', 'manual_discount_usd', 'total_usd', 'total_khr']
const ZERO_QUOTE = { gross_usd: 0, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 0, total_khr: 0 }
const SEND = { deadlineMs: 1_800_000 }
const READ = { ...SEND, miss: true }
const money4 = (n) => Math.round(Number(n) * 1e4)

const problems = []
const log = (...a) => console.log(...a)
async function step(group, name, fn) {
  if (ONLY && !ONLY.has(group)) return
  if (process.env.LS1_NAME && !name.includes(process.env.LS1_NAME)) return
  const t0 = Date.now()
  try { await fn(); log(`ok    ${group}: ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`) } catch (e) {
    problems.push(`${group}: ${name}: ${String(e && e.message || e).split('\n')[0].slice(0, 400)}`)
    log(`RED   ${group}: ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)\n      ${String(e && e.message || e).split('\n').slice(0, 4).join('\n      ').slice(0, 900)}`)
  }
}

// ---- the till's own check: the frontend money kernel, bundled, run over every response a till would print from ----
function loadTill() {
  const entry = path.resolve(__dirname, '../../frontend/src/utils/saleMoneyV1.ts')
  const code = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'error' }).outputFiles[0].text
  const module = { exports: {} }
  new Function('module', 'exports', code)(module, module.exports)
  return module.exports
}

// ---- the real pack condition (lib/saleItemPricing.ts), bundled ----
function loadPricing() {
  const entry = path.resolve(__dirname, '../src/lib/saleItemPricing.ts')
  const code = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'error' }).outputFiles[0].text
  const module = { exports: {} }
  new Function('module', 'exports', 'require', code)(module, module.exports, require)
  return module.exports
}

// ---- the real return-create guard builder, bundled ----
function loadReturnCreateAction() {
  const entry = path.resolve(__dirname, '../src/lib/returnCreateAction.ts')
  const code = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'error' }).outputFiles[0].text
  const module = { exports: {} }
  new Function('module', 'exports', 'require', code)(module, module.exports, require)
  return module.exports
}

// ---- fixtures ----
let seq = 0
const rnd = () => Math.random().toString(36).slice(2, 7)
async function lots(world, n, offset) {
  const rows = await world.all(`SELECT b.variant_product_id AS pid, b.id AS batch FROM branch_batch_stock s JOIN product_batches b ON b.id = s.batch_id
    JOIN products p ON p.id = b.variant_product_id AND p.is_active = 1 AND (p.id - 1000) % 8 NOT IN (1, 2) WHERE s.branch_id = 1 AND s.quantity >= 5 ORDER BY b.id LIMIT ? OFFSET ?`, n, offset)
  if (rows.length < n) throw new Error(`seed has only ${rows.length} stocked lots at offset ${offset}, need ${n}`)
  return rows
}
// Production's catalogue text per pool line is about 676 bytes (sale 17612: 41,925 / 62), the seed's is 509: the sales that must match
// production get catalogue text with quotes, a backslash, Khmer and an emoji, which also proves the packed copies keep every byte.
async function heavyCatalogue(world, rows) {
  const text = 'ក្រែមថែរក្សាស្បែក "premium" \\ 100% / 😀 ' + 'ស'.repeat(30)
  await world.db.prepare("UPDATE products SET category = ? WHERE id IN (SELECT value FROM json_each(?))").bind(text, JSON.stringify(rows.map((r) => r.pid))).run()
}
function lineKey(label, r, i, pos) { return pos ? `${r.pid}:selling:1:${r.batch}:D0:${Date.now()}:${rnd()}` : `${label}-l${i}` }

/** Creates a sale through the API (quote probe, header probe, final send). A 500 after the commit (the defect) still leaves the sale. */
async function createSale(world, label, rows, { paid = true, pos = true } = {}) {
  const k = `ls1-${label}-${++seq}`
  const body = { branch_id: 1, money_precision_version: 1, sale_status: paid ? 'completed' : 'awaiting_payment', exchange_rate: 4000, payment_currency: 'USD', client_request_id: k,
    offline_owner: { version: 1, actor_id: 901, organization_id: world.orgId, authority: ORIGIN, runtime: 'cloudflare-workers' }, amount_paid_usd: 0, amount_paid_khr: 0,
    items: rows.map((r, i) => ({ product_id: r.pid, quantity: 1, branch_id: 1, batch_id: r.batch, client_line_key: lineKey(k, r, i, pos), pricing_source: 'selling', pricing_quote: { ...ZERO_QUOTE } })) }
  let r = await world.send('POST', '/api/sales', body, SEND)
  if (r.status !== 409 || r.json?.code !== 'sale_pricing_quote_conflict') throw new Error(`${label}: quote probe answered ${r.status} ${r.text.slice(0, 200)}`)
  const quotes = new Map(r.json.pricing_quotes.map((x) => [x.client_line_key, x]))
  for (const item of body.items) item.pricing_quote = Object.fromEntries(QUOTE_KEYS.map((q) => [q, quotes.get(item.client_line_key)[q]]))
  const total = body.items.reduce((s, it) => s + Number(it.pricing_quote.total_usd || 0), 0)
  if (paid) Object.assign(body, { payment_details: [{ method: 'Cash', amount_usd: Math.ceil(total), amount_khr: 0 }], payment_method: 'Cash', amount_paid_usd: Math.ceil(total), amount_paid_khr: 0 })
  const t0 = Date.now()
  r = await world.send('POST', '/api/sales', body, SEND)
  if (r.status === 409 && r.json?.code === 'sale_header_quote_conflict') { body.expected_header_quote = r.json.header_quote; r = await world.send('POST', '/api/sales', body, SEND) }
  const row = (await world.all("SELECT id, receipt_number FROM sales WHERE client_request_id = ?", k))[0]
  return { body, response: r, saleId: row ? row.id : null, receipt: row ? row.receipt_number : null, ms: Date.now() - t0, requestId: k }
}

/** Mutation with the quote probes this API uses: a 409 that writes nothing names the quote, the next names the exact header total. */
async function mutate(world, method, url, body, fix) {
  let r
  for (let attempt = 0; attempt < 4; attempt++) {
    r = await world.send(method, url, body, SEND)
    if (process.env.LS1_TIME) log(`      [timing] ${method} ${url.replace(/[0-9]+/g, "#")} attempt ${attempt + 1}: ${r.status} ${r.json?.code || ""} in ${r.ms} ms, ${r.calls} D1 calls, ${r.statements} statements`)
    if (r.status !== 409) return r
    if (r.json?.code === 'sale_pricing_quote_conflict') fix.quote(body, r.json)
    else if (r.json?.code === 'sale_header_quote_conflict') body.expected_header_quote = r.json.header_quote
    else return r
  }
  return r
}
// The recalculated pool answers every line's quote; the amendment carries the quote of the line it changes.
const amendFixFor = (line) => ({ quote: (body, json) => {
  const key = JSON.parse(line.pricing_snapshot_json).line_key
  const q = json.pricing_quote || json.pricing_quotes.find((x) => x.client_line_key === key)
  body.pricing_quote = Object.fromEntries(QUOTE_KEYS.map((k) => [k, q[k]]))
} })
const addFix = { quote: (body, json) => { const q = new Map(json.pricing_quotes.map((x) => [x.client_line_key, x])); for (const item of body.items) item.pricing_quote = Object.fromEntries(QUOTE_KEYS.map((k) => [k, q.get(item.client_line_key)[k]])) } }

// ---- the state a sale leaves in the database ----
const ids = (list) => JSON.stringify([...new Set(list)])
async function stockMaps(world, pids, bids) {
  const bs = await world.all('SELECT product_id p, quantity q FROM branch_stock WHERE branch_id = 1 AND product_id IN (SELECT value FROM json_each(?))', ids(pids))
  const ls = await world.all('SELECT batch_id b, quantity q FROM branch_batch_stock WHERE branch_id = 1 AND batch_id IN (SELECT value FROM json_each(?))', ids(bids))
  return { product: new Map(bs.map((r) => [r.p, r.q])), lot: new Map(ls.map((r) => [r.b, r.q])) }
}
async function state(world, saleId) {
  const sale = (await world.all('SELECT sale_status, subtotal_usd, total_usd, amount_paid_usd, calculated_total_usd, delivery_fee_usd, tax_usd, discount_usd FROM sales WHERE id = ?', saleId))[0]
  const lines = await world.all('SELECT id, product_id, batch_id, quantity, total_usd, returned_quantity, pricing_snapshot_json FROM sale_items WHERE sale_id = ? ORDER BY id', saleId)
  const moves = await world.all('SELECT movement_type t, COUNT(*) n, SUM(quantity) q FROM inventory_movements WHERE reference_id = ? GROUP BY movement_type ORDER BY movement_type', saleId)
  return { sale, lines, moves }
}
const holding = (status) => ['completed', 'awaiting_payment', 'awaiting_delivery'].includes(status)

/** The invariants every sale keeps at every size: lines sum to the header, stock and lots are held exactly while the status holds them,
 * the movements net to the units held, and the amount owed is what is not paid. */
async function assertInvariants(world, saleId, base, label) {
  const st = await state(world, saleId)
  const sum = st.lines.reduce((s, l) => s + money4(l.total_usd), 0)
  assert.equal(sum, money4(st.sale.subtotal_usd), `${label}: lines sum ${sum} != subtotal ${st.sale.subtotal_usd}`)
  const now = await stockMaps(world, [...base.product.keys()], [...base.lot.keys()])
  const held = new Map(), heldLot = new Map()
  for (const l of st.lines) {
    held.set(l.product_id, (held.get(l.product_id) || 0) + Number(l.quantity))
    if (l.batch_id) heldLot.set(l.batch_id, (heldLot.get(l.batch_id) || 0) + Number(l.quantity))
  }
  const on = holding(st.sale.sale_status)
  for (const [p, q] of base.product) assert.equal(q - now.product.get(p), on ? held.get(p) || 0 : 0, `${label}: branch_stock of product ${p} (${st.sale.sale_status})`)
  for (const [b, q] of base.lot) assert.equal(q - now.lot.get(b), on ? heldLot.get(b) || 0 : 0, `${label}: lot ${b} stock (${st.sale.sale_status})`)
  const netMoved = st.moves.reduce((s, m) => s + Number(m.q), 0)
  assert.equal(netMoved, on ? -[...held.values()].reduce((a, b) => a + b, 0) : 0, `${label}: movements net ${netMoved} (${st.sale.sale_status})`)
  return st
}

/** The response must carry every stored line, with the stored snapshot text byte for byte, and pass the till's own validation. */
function assertResponseMatchesStore(till, sale, st, label) {
  assert.ok(sale && Array.isArray(sale.items), `${label}: response has no items`)
  assert.equal(sale.items.length, st.lines.length, `${label}: response carries ${sale.items.length} lines, the store has ${st.lines.length}`)
  sale.items.forEach((item, i) => {
    assert.equal(item.id, st.lines[i].id, `${label}: line ${i} id`)
    assert.equal(item.pricing_snapshot_json, st.lines[i].pricing_snapshot_json, `${label}: line ${i} snapshot differs from the stored text`)
  })
  till.canonicalSaleReceipt({ sale })
}

async function sizes(world, saleId, requestIds) {
  const r = (await world.all('SELECT COUNT(*) n, SUM(length(pricing_snapshot_json)) total, MAX(length(pricing_snapshot_json)) mx FROM sale_items WHERE sale_id = ?', saleId))[0]
  const receipts = await world.all("SELECT mutation_kind k, length(response_json) resp, length(before_json) bef, length(after_json) aft, instr(response_json, '\"pricing_packs\"') > 0 packed, instr(after_json, '\"pricing_packs\"') > 0 packedImage FROM sale_mutation_receipts WHERE sale_id = ?", saleId)
  const undo = await world.all("SELECT length(payload_json) n, instr(payload_json, '\"pricing_packs\"') > 0 packed FROM undo_snapshots WHERE kind = 'sale.add_items' ORDER BY id DESC LIMIT 3")
  return { lines: r.n, total: r.total, max: r.mx, receipts, undo }
}

async function main() {
  const till = loadTill()
  const world = await bootWorld({ tier: 'paid' })
  const F = {} // fixtures
  let offset = 0
  const take = async (n) => { const rows = await lots(world, n, offset); offset += n + 3; return rows }
  try {
    // ------------------------------------------------------------------ controls: the instrument is the D1 rule
    await step('controls', 'workerd refuses a value above the cap, SQL-built or bound', async () => {
      // hex(zeroblob(1000001)) is 2,000,002 characters of '0'; replace() turns each into 'ab', so the string built here is 4,000,004 bytes.
      await assert.rejects(world.db.prepare("SELECT length(replace(hex(zeroblob(1000001)),'0','ab')) AS v").all(), /too big|TOOBIG/i, 'a 4,000,004-byte SQL-built string must be refused')
      // workerd is LOOSER than D1's documented 2,000,000-byte value cap (the real limit is applied well above the line it names), so a local pass
      // proves nothing about a value between 2.0 and about 2.2 MB. Every stored-row assertion below therefore uses 1,900,000.
      const probe = await world.db.prepare('SELECT length(hex(zeroblob(1050000))) AS v').all().then((r) => `accepted (${r.results[0].v} bytes)`, (e) => `refused (${String(e.message).slice(0, 60)})`)
      log(`      workerd, a 2,100,000-byte SQL-built string: ${probe}`)
      await assert.rejects(world.db.prepare('SELECT length(?) AS v').bind('x'.repeat(CAP + 1_000_000)).all(), /too big|TOOBIG/i, 'a 3 MB bound value must be refused')
      await world.db.prepare('CREATE TABLE IF NOT EXISTS ls1_cap(v TEXT)').run()
      await assert.rejects(world.db.prepare('INSERT INTO ls1_cap(v) VALUES(?)').bind('x'.repeat(CAP + 1_000_000)).run(), /too big|TOOBIG/i, 'a 3 MB row must be refused')
      await world.db.prepare('DROP TABLE ls1_cap').run()
    })

    // ------------------------------------------------------------------ create
    const spec = [['s10', 10, false, true], ['s62', 62, false, true], ['s86', 86, true, true], ['s200', 200, true, false]]
    for (const [key, n, paid, pos] of spec) {
      await step('create', `${n} lines${paid ? '' : ' (Not Paid)'}`, async () => {
        const rows = await take(n)
        if (n === 62 || n === 86) await heavyCatalogue(world, rows)
        const base = await stockMaps(world, rows.map((r) => r.pid), rows.map((r) => r.batch))
        const made = await createSale(world, key, rows, { paid, pos })
        F[key] = { ...made, n, base, rows, paid }
        assert.ok(made.saleId, `${n} lines: no sale was recorded (${made.response.status} ${made.response.text.slice(0, 200)})`)
        const sz = await sizes(world, made.saleId)
        F[key].sz = sz
        log(`      ${n} lines: stored snapshots ${sz.total} bytes (largest ${sz.max}); answer ${made.response.status} in ${made.ms} ms`)
        assert.ok(sz.max < 128_000, 'a snapshot is capped at 128,000 bytes by the app')
        if (n >= 62) assert.ok(sz.total > CAP, `a ${n}-line sale must exceed D1's cap in total (${sz.total}) or this test proves nothing`)
        assert.equal(made.response.status, 200, `create answered ${made.response.status} ${made.response.json?.code || ''} ${made.response.text.slice(0, 160)} (the sale IS stored: ${sz.lines} lines)`)
        const st = await assertInvariants(world, made.saleId, base, `${n} lines after create`)
        assert.equal(st.lines.length, n)
        assertResponseMatchesStore(till, made.response.json.sale, st, `${n} lines create response`)
        assert.equal(st.moves.find((m) => m.t === 'sale').n, n, 'one sale movement per line')
        if (!paid) assert.equal(money4(st.sale.amount_paid_usd), 0, 'a Not Paid sale owes its whole total')
      })
    }

    // ------------------------------------------------------------------ read
    for (const key of ['s10', 's62', 's86', 's200']) {
      const f = F[key]
      await step('read', `${f ? f.n : key} lines: list, create-receipt, duplicate create, till check`, async () => {
        assert.ok(f && f.saleId, 'fixture missing')
        const st = await state(world, f.saleId)
        const list = await world.send('GET', `/api/sales?id=${f.saleId}`, undefined, READ)
        assert.equal(list.status, 200, `GET /api/sales answered ${list.status} ${list.text.slice(0, 160)}`)
        log(`      ${f.n} lines: list read ${list.ms} ms, ${(list.text.length / 1e6).toFixed(1)} MB`)
        assert.equal(list.json.length, 1)
        assertResponseMatchesStore(till, list.json[0], st, `${f.n} lines list`)
        const rec = await world.send('GET', `/api/sales/create-receipt?client_request_id=${encodeURIComponent(f.requestId)}`, undefined, READ)
        assert.equal(rec.status, 200, `create-receipt answered ${rec.status} ${rec.text.slice(0, 160)}`)
        assert.equal(rec.json.committed, true)
        assertResponseMatchesStore(till, rec.json.response.sale, st, `${f.n} lines create-receipt`)
        const again = await world.send('POST', '/api/sales', f.body, SEND)
        assert.equal(again.status, 200, `duplicate create answered ${again.status} ${again.text.slice(0, 160)}`)
        assert.equal(again.json.duplicate, true)
        assertResponseMatchesStore(till, again.json.sale, st, `${f.n} lines duplicate create`)
      })
    }

    // ------------------------------------------------------------------ flow: the same steps on 10 and 62 lines (parity)
    // Each step is its own check, so the base run lists every one that breaks. The baseline is the stock BEFORE the sale (F.base) plus the
    // extra lots, which no sale has touched yet.
    const prepare = async (f, extraOffset) => {
      if (f.baseAll || !f.saleId) return
      f.extra = await lots(world, 2, extraOffset)
      const extraBase = await stockMaps(world, f.extra.map((r) => r.pid), f.extra.map((r) => r.batch))
      f.baseAll = { product: new Map([...f.base.product, ...extraBase.product]), lot: new Map([...f.base.lot, ...extraBase.lot]) }
    }
    const addBodyFor = (f) => ({ client_request_id: `${f.requestId}-add`, money_precision_version: 1, expected_exchange_rate: 4000,
      items: [{ product_id: f.extra[0].pid, quantity: 1, branch_id: 1, batch_id: f.extra[0].batch, client_line_key: `${f.requestId}-extra`, pricing_source: 'selling', pricing_quote: { ...ZERO_QUOTE } }] })
    for (const [key, extraOffset] of [['s10', 700], ['s62', 710]]) {
      const f = F[key]
      const label = f ? `${f.n} lines` : key
      await step('flow', `${label}: add items, replay, line-receipt, bounded stored copies`, async () => {
        assert.ok(f && f.saleId, 'fixture missing')
        await prepare(f, extraOffset)
        const id = f.saleId, addBody = addBodyFor(f)
        await assertInvariants(world, id, f.baseAll, `${label} before add items`)
        const add = await mutate(world, 'POST', `/api/sales/${id}/items`, addBody, addFix)
        assert.equal(add.status, 200, `add items answered ${add.status} ${add.json?.code || ''} ${add.text.slice(0, 220)}`)
        const cur = await assertInvariants(world, id, f.baseAll, `${label} after add items`)
        assert.equal(cur.lines.length, f.n + 1)
        assertResponseMatchesStore(till, add.json.sale, cur, `${label} add items response`)
        const replay = await world.send('POST', `/api/sales/${id}/items`, addBody, SEND)
        assert.equal(replay.status, 200, `add items replay answered ${replay.status} ${replay.text.slice(0, 160)}`)
        assert.deepEqual(replay.json, add.json, `${label}: the replay of add items answers differently from the first answer`)
        assert.equal((await state(world, id)).lines.length, f.n + 1, 'a replay writes nothing')
        const lr = await world.send('POST', `/api/sales/${id}/line-receipt/add_items`, addBody, SEND)
        assert.equal(lr.status, 200, `line-receipt answered ${lr.status} ${lr.text.slice(0, 160)}`)
        assert.equal(lr.json.committed, true)
        assert.deepEqual(lr.json.response, add.json, `${label}: the line-receipt answers differently from the first answer`)
        const sz = await sizes(world, id)
        for (const r of sz.receipts) for (const v of [r.resp, r.bef, r.aft]) assert.ok(v < 1_000_000, `${label}: a stored receipt copy is ${v} bytes (${r.k})`)
        for (const row of sz.undo) assert.ok(row.n < 1_500_000, `${label}: the undo payload is ${row.n} bytes`)
        log(`      ${label}: stored copies ${JSON.stringify(sz.receipts)} undo payloads ${JSON.stringify(sz.undo)}`)
        // A small basket is stored exactly as it always was (legacy form, readable by the previous Worker); a large one is packed.
        const wantPacked = f.n >= 62
        for (const r of sz.receipts) { assert.equal(Boolean(r.packed), wantPacked, `${label}: the stored response is ${r.packed ? 'packed' : 'in the legacy form'}`); assert.equal(Boolean(r.packedImage), wantPacked, `${label}: the stored image is ${r.packedImage ? 'packed' : 'in the legacy form'}`) }
        assert.equal(Boolean(sz.undo[0].packed), wantPacked, `${label}: the undo payload is ${sz.undo[0].packed ? 'packed' : 'in the legacy form'}`)
      })
      await step('flow', `${label}: amend one line, replay`, async () => {
        assert.ok(f && f.saleId, 'fixture missing')
        await prepare(f, extraOffset)
        const id = f.saleId, cur0 = await state(world, id), line0 = cur0.lines[0]
        const amendBody = { kind: 'line_quantity_increased', sale_item_id: line0.id, quantity: Number(line0.quantity) + 1, client_request_id: `${f.requestId}-amend`, money_precision_version: 1, expected_exchange_rate: 4000 }
        const amend = await mutate(world, 'POST', `/api/sales/${id}/amendments`, amendBody, amendFixFor(line0))
        assert.equal(amend.status, 200, `amend answered ${amend.status} ${amend.json?.code || ''} ${amend.text.slice(0, 220)}`)
        const cur = await assertInvariants(world, id, f.baseAll, `${label} after amend`)
        assertResponseMatchesStore(till, amend.json.sale, cur, `${label} amend response`)
        const replay = await world.send('POST', `/api/sales/${id}/amendments`, amendBody, SEND)
        assert.equal(replay.status, 200, `amend replay answered ${replay.status} ${replay.text.slice(0, 160)}`)
        assert.deepEqual(replay.json, amend.json, `${label}: the replay of the amendment answers differently`)
      })
      await step('flow', `${label}: settle the Not Paid sale`, async () => {
        assert.ok(f && f.saleId, 'fixture missing')
        await prepare(f, extraOffset)
        const id = f.saleId, cur0 = await state(world, id)
        assert.equal(cur0.sale.sale_status, 'awaiting_payment')
        assert.equal(money4(cur0.sale.amount_paid_usd), 0)
        const pay = await world.send('PATCH', `/api/sales/${id}/status`, { sale_status: 'completed', client_request_id: `${f.requestId}-pay`, expected_exchange_rate: 4000,
          payment_details: [{ method: 'Cash', amount_usd: Math.ceil(Number(cur0.sale.total_usd)) + 1, amount_khr: 0 }] }, SEND)
        assert.equal(pay.status, 200, `settle answered ${pay.status} ${pay.json?.code || ''} ${pay.text.slice(0, 220)}`)
        const cur = await assertInvariants(world, id, f.baseAll, `${label} after settle`)
        assert.equal(cur.sale.sale_status, 'completed')
        assert.ok(money4(cur.sale.amount_paid_usd) >= money4(cur.sale.total_usd), 'the payment covers the total')
        assert.equal(cur.moves.find((m) => m.t === 'sale').n, cur0.moves.find((m) => m.t === 'sale').n, 'settling moves no stock')
      })
      await step('flow', `${label}: cancel`, async () => {
        assert.ok(f && f.saleId, 'fixture missing')
        await prepare(f, extraOffset)
        const id = f.saleId
        const cancel = await world.send('PATCH', `/api/sales/${id}/status`, { sale_status: 'cancelled', client_request_id: `${f.requestId}-cancel`, cancel_reason: 'mistake', cancel_note: 'ls1' }, SEND)
        assert.equal(cancel.status, 200, `cancel answered ${cancel.status} ${cancel.json?.code || ''} ${cancel.text.slice(0, 220)}`)
        const cur = await assertInvariants(world, id, f.baseAll, `${label} after cancel`)
        assert.equal(cur.sale.sale_status, 'cancelled')
      })
    }

    // The thresholds (lib/saleItemPricing.ts): a small basket keeps the stored form it always had in every copy; a large one is packed in every copy. Both must replay
    // to the same answer, and the larger one must still pass the till's own check.
    await step('flow', '20 and 44 lines: the stored copies are packed exactly when the basket is large, and a return records in both forms', async () => {
      for (const [n, wantPacked] of [[20, false], [44, true]]) {
        const rows = await take(n)
        await heavyCatalogue(world, rows)
        const made = await createSale(world, `t${n}`, rows, { paid: true, pos: true })
        assert.ok(made.saleId, `${n} lines: no sale was recorded`)
        const extra = await take(2)
        const addBody = { client_request_id: `${made.requestId}-add`, money_precision_version: 1, expected_exchange_rate: 4000,
          items: [{ product_id: extra[0].pid, quantity: 1, branch_id: 1, batch_id: extra[0].batch, client_line_key: `${made.requestId}-extra`, pricing_source: 'selling', pricing_quote: { ...ZERO_QUOTE } }] }
        const add = await mutate(world, 'POST', `/api/sales/${made.saleId}/items`, addBody, addFix)
        assert.equal(add.status, 200, `${n} lines: add items answered ${add.status} ${add.json?.code || ''} ${add.text.slice(0, 200)}`)
        const st = await state(world, made.saleId)
        assertResponseMatchesStore(till, add.json.sale, st, `${n} lines add items response`)
        const replay = await world.send('POST', `/api/sales/${made.saleId}/items`, addBody, SEND)
        assert.equal(replay.status, 200)
        assert.deepEqual(replay.json, add.json, `${n} lines: the replay answers differently from the first answer`)
        const sz = await sizes(world, made.saleId)
        assert.equal(wantPacked ? sz.total > 1_000_000 : sz.total < 450_000, true, `${n} lines: the snapshots total ${sz.total} bytes, the fixture no longer sits clear of the packing thresholds`)
        for (const r of sz.receipts) { assert.equal(Boolean(r.packed), wantPacked, `${n} lines: stored response packed=${Boolean(r.packed)}`); assert.equal(Boolean(r.packedImage), wantPacked, `${n} lines: stored image packed=${Boolean(r.packedImage)}`) }
        assert.equal(Boolean(sz.undo[0].packed), wantPacked, `${n} lines: undo payload packed=${Boolean(sz.undo[0].packed)}`)
        log(`      ${n} lines: snapshots ${sz.total} bytes, stored copies packed=${wantPacked}`)
        // A customer return on the same sale: the 20-line sale proves its snapshots inside the one authority parameter (as always), the 44-line one
        // in groups of their own. Both must record, for exactly the quoted refund.
        const first = (await world.all('SELECT id, product_id FROM sale_items WHERE sale_id = ? ORDER BY id LIMIT 1', made.saleId))[0]
        const quote = await world.send('POST', '/api/returns/quote', { sale_id: made.saleId, items: [{ sale_item_id: first.id, quantity: 1 }] }, SEND)
        assert.equal(quote.status, 200, `${n} lines: return quote answered ${quote.status} ${quote.json?.code || ''}`)
        const { customer_return_create_version: _c, customer_return_edit_version: _e, ...expected } = quote.json
        const ret = await world.send('POST', '/api/returns', { client_request_id: `${made.requestId}-return`, money_precision_version: 1, sale_id: made.saleId, reason: 'ls1', expected_quote: expected,
          items: [{ sale_item_id: first.id, product_id: first.product_id, quantity: 1, stock_action: 'restock', branch_id: 1 }] }, SEND)
        assert.equal(ret.status, 200, `${n} lines: return create answered ${ret.status} ${ret.json?.code || ''} ${ret.text.slice(0, 200)}`)
        const refunded = await world.all('SELECT total_refund_usd t FROM returns WHERE sale_id = ?', made.saleId)
        assert.equal(refunded.length, 1)
        assert.equal(money4(refunded[0].t), money4(expected.total_refund_usd), `${n} lines: the refund is the quoted refund`)
      }
    })

    // Sale 17612 as production holds it (ops run 41570262329): 62 lines, every one in the canonical serializeSaleItemPricing form, ONE allocation context,
    // Not Paid, 2.6 MB of snapshots and NO sale_mutation_receipts row. The canonical check of the pack condition must accept it (so that it is packed, not
    // refused), and it must open, settle and then take an edit after the change.
    await step('flow', 'the shape of sale 17612: 62 canonical lines, one context, Not Paid, no receipt: opens, settles, edits', async () => {
      const { packedItemsCondition } = loadPricing()
      const rows = await take(62)
      await heavyCatalogue(world, rows)
      const base = await stockMaps(world, rows.map((r) => r.pid), rows.map((r) => r.batch))
      const made = await createSale(world, 'p17612', rows, { paid: false, pos: true })
      assert.ok(made.saleId, 'no sale was recorded')
      const id = made.saleId
      const st0 = await assertInvariants(world, id, base, 'p17612 after create')
      assert.equal(st0.lines.length, 62)
      assert.equal(st0.sale.sale_status, 'awaiting_payment')
      const contexts = new Set()
      for (const line of st0.lines) {
        const p = JSON.parse(line.pricing_snapshot_json)
        const rebuilt = JSON.stringify({ version: 1, line_key: p.line_key, pool: p.pool, quantities: p.quantities, amounts: p.amounts, allocation_context: p.allocation_context, receipt_allocation: p.receipt_allocation })
        assert.equal(rebuilt, line.pricing_snapshot_json, 'every line is exactly the text serializeSaleItemPricing writes')
        contexts.add(JSON.stringify(p.allocation_context))
      }
      assert.equal(contexts.size, 1, 'one allocation context')
      const total = st0.lines.reduce((sum, l) => sum + l.pricing_snapshot_json.length, 0)
      assert.ok(total > 2_000_000, `the fixture must be over D1's cap in total (${total})`)
      assert.equal(Number((await world.all('SELECT COUNT(*) n FROM sale_mutation_receipts WHERE sale_id = ?', id))[0].n), 0, 'no receipt row, as in production')
      assert.equal(Number((await world.all(`SELECT (${packedItemsCondition()}) AS p FROM sales s WHERE s.id = ?`, id))[0].p), 1, 'the canonical check must ACCEPT the 17612 shape')
      // open
      const list = await world.send('GET', `/api/sales?id=${id}`, undefined, READ)
      assert.equal(list.status, 200, `open answered ${list.status} ${list.text.slice(0, 160)}`)
      assertResponseMatchesStore(till, list.json[0], st0, 'p17612 open')
      // settle
      const pay = await world.send('PATCH', `/api/sales/${id}/status`, { sale_status: 'completed', client_request_id: `${made.requestId}-pay`, expected_exchange_rate: 4000,
        payment_details: [{ method: 'Cash', amount_usd: Math.ceil(Number(st0.sale.total_usd)) + 1, amount_khr: 0 }] }, SEND)
      assert.equal(pay.status, 200, `settle answered ${pay.status} ${pay.json?.code || ''} ${pay.text.slice(0, 220)}`)
      const st1 = await assertInvariants(world, id, base, 'p17612 after settle')
      assert.equal(st1.sale.sale_status, 'completed')
      assert.deepEqual(st1.lines.map((l) => l.pricing_snapshot_json), st0.lines.map((l) => l.pricing_snapshot_json), 'settling leaves every snapshot as it was')
      // open again, then edit
      const list1 = await world.send('GET', `/api/sales?id=${id}`, undefined, READ)
      assert.equal(list1.status, 200)
      assertResponseMatchesStore(till, list1.json[0], st1, 'p17612 open after settle')
      const line0 = st1.lines[0]
      const amendBody = { kind: 'line_quantity_increased', sale_item_id: line0.id, quantity: Number(line0.quantity) + 1, client_request_id: `${made.requestId}-amend`, money_precision_version: 1, expected_exchange_rate: 4000 }
      const amend = await mutate(world, 'POST', `/api/sales/${id}/amendments`, amendBody, amendFixFor(line0))
      assert.equal(amend.status, 200, `edit answered ${amend.status} ${amend.json?.code || ''} ${amend.text.slice(0, 220)}`)
      const st2 = await state(world, id)
      assert.equal(st2.lines.length, 62)
      assertResponseMatchesStore(till, amend.json.sale, st2, 'p17612 edit response')
      const replay = await world.send('POST', `/api/sales/${id}/amendments`, amendBody, SEND)
      assert.equal(replay.status, 200)
      assert.deepEqual(replay.json, amend.json, 'the replay of the edit answers the same')
      const receipt = (await world.all("SELECT length(CAST(response_json AS BLOB)) r, instr(response_json, '\"pricing_packs\"') > 0 packed FROM sale_mutation_receipts WHERE sale_id = ? AND mutation_kind = 'amendment'", id))[0]
      assert.equal(Boolean(receipt.packed), true, 'the 62-line canonical basket is stored packed')
      assert.ok(receipt.r < 1_000_000, `the stored response is ${receipt.r} bytes`)
    })

    // E1: a mutation receipt is ONE row (request + before + after + response). D1 documents 2,000,000 bytes per row; workerd accepts about 2.2 MB, so
    // the bound asserted here is 1,900,000. Before the fix each image was packed on its own above 1,000,000 bytes, so a basket whose two images were
    // each just under that (33 lines at the time of the review: 2,013,933 bytes with the response) made a row over the cap. The images are now packed
    // TOGETHER once they pass 1,100,000 bytes (an image holds the snapshots as JSON strings, so about 1.2 times their size). In this harness 24 lines
    // (snapshots 431 KB, two images about 1.03 MB, response about 0.5 MB, a row of about 1.55 MB) is the last that keeps the old text; 25 lines
    // (470 KB) and 33 lines are packed.
    await step('flow', '22, 24, 25 and 33 lines: an amend and an add-items leave every receipt row under 1.9 MB', async () => {
      for (const n of [22, 24, 25, 33]) {
        const rows = await take(n)
        await heavyCatalogue(world, rows)
        const made = await createSale(world, `e${n}`, rows, { paid: true, pos: true })
        assert.ok(made.saleId, `${n} lines: no sale was recorded`)
        const extra = await take(2)
        const cur0 = await state(world, made.saleId), line0 = cur0.lines[0]
        const amendBody = { kind: 'line_quantity_increased', sale_item_id: line0.id, quantity: Number(line0.quantity) + 1, client_request_id: `${made.requestId}-amend`, money_precision_version: 1, expected_exchange_rate: 4000 }
        const amend = await mutate(world, 'POST', `/api/sales/${made.saleId}/amendments`, amendBody, amendFixFor(line0))
        assert.equal(amend.status, 200, `${n} lines: amend answered ${amend.status} ${amend.json?.code || ''} ${amend.text.slice(0, 200)}`)
        const addBody = { client_request_id: `${made.requestId}-add`, money_precision_version: 1, expected_exchange_rate: 4000,
          items: [{ product_id: extra[0].pid, quantity: 1, branch_id: 1, batch_id: extra[0].batch, client_line_key: `${made.requestId}-extra`, pricing_source: 'selling', pricing_quote: { ...ZERO_QUOTE } }] }
        const add = await mutate(world, 'POST', `/api/sales/${made.saleId}/items`, addBody, addFix)
        assert.equal(add.status, 200, `${n} lines: add items answered ${add.status} ${add.json?.code || ''} ${add.text.slice(0, 200)}`)
        const st = await state(world, made.saleId)
        assertResponseMatchesStore(till, add.json.sale, st, `${n} lines add items response`)
        const stored = await world.all("SELECT mutation_kind k, COALESCE(length(CAST(request_json AS BLOB)),0) + COALESCE(length(CAST(before_json AS BLOB)),0) + COALESCE(length(CAST(after_json AS BLOB)),0) + COALESCE(length(CAST(response_json AS BLOB)),0) bytes, instr(after_json, '\"pricing_packs\"') > 0 packedImage FROM sale_mutation_receipts WHERE sale_id = ? ORDER BY created_at", made.saleId)
        const sz = await sizes(world, made.saleId)
        log(`      ${n} lines: snapshots ${sz.total} bytes, receipt rows ${JSON.stringify(stored)}`)
        assert.equal(stored.length, 2, `${n} lines: expected the amendment and the add-items receipt`)
        for (const row of stored) assert.ok(row.bytes <= 1_900_000, `${n} lines: the ${row.k} receipt row is ${row.bytes} bytes (limit 1,900,000)`)
        for (const row of sz.undo.slice(0, 1)) assert.ok(row.n <= 1_900_000, `${n} lines: the undo payload is ${row.n} bytes`)
        if (n === 22) assert.ok(stored.every((r) => !r.packedImage), '22 lines: both images keep the text they always had')
        if (n === 33) assert.ok(stored.every((r) => r.packedImage), '33 lines: both images are packed')
      }
    })

    // E2: the SQL pack condition must see a line that is not the canonical text (an extra key, whitespace, another version, reordered keys) and
    // refuse to pack it, because the expansion would rewrite it. The canonical sale of the same size is the control: it IS packable.
    await step('flow', '36 lines: the pack condition accepts the canonical lines and refuses a rewritten one', async () => {
      const { packedItemsCondition } = loadPricing()
      const rows = await take(36)
      await heavyCatalogue(world, rows)
      const made = await createSale(world, 'e2', rows, { paid: true, pos: true })
      assert.ok(made.saleId, 'no sale was recorded')
      const packable = async () => Number((await world.all(`SELECT (${packedItemsCondition()}) AS p FROM sales s WHERE s.id = ?`, made.saleId))[0].p)
      assert.equal(await packable(), 1, 'the canonical 36-line basket (over the 600,000-byte gate) must be packable')
      const lines = await world.all('SELECT id, pricing_snapshot_json s FROM sale_items WHERE sale_id = ? ORDER BY id', made.saleId)
      const target = lines[17]
      const parsed = JSON.parse(target.s)
      const variants = {
        'trailing space': target.s + ' ',
        'whitespace after a colon': target.s.replace('"version":1', '"version": 1'),
        'an extra key': target.s.slice(0, -1) + ',"note":"x"}',
        'another version': target.s.replace('"version":1', '"version":2'),
        'reordered keys': JSON.stringify({ version: 1, line_key: parsed.line_key, amounts: parsed.amounts, pool: parsed.pool, quantities: parsed.quantities,
          allocation_context: parsed.allocation_context, receipt_allocation: parsed.receipt_allocation }),
      }
      for (const [name, text] of Object.entries(variants)) {
        assert.notEqual(text, target.s, `${name}: the variant did not change the text`)
        JSON.parse(text)
        await world.db.prepare('UPDATE sale_items SET pricing_snapshot_json = ? WHERE id = ?').bind(text, target.id).run()
        try { assert.equal(await packable(), 0, `${name}: a line that is not the canonical text was reported packable`) }
        finally { await world.db.prepare('UPDATE sale_items SET pricing_snapshot_json = ? WHERE id = ?').bind(target.s, target.id).run() }
      }
      assert.equal(await packable(), 1, 'restored: the canonical basket is packable again')
      // below the size gate nothing is packed whatever the lines are
      const small = await take(5)
      const tiny = await createSale(world, 'e2s', small, { paid: true, pos: true })
      assert.ok(tiny.saleId)
      assert.equal(Number((await world.all(`SELECT (${packedItemsCondition()}) AS p FROM sales s WHERE s.id = ?`, tiny.saleId))[0].p), 0, 'a 5-line basket is under the size gate')
    })

    // undo / redo of added items, on its own sale: both directions must restore every snapshot byte for byte
    for (const [key, n] of [['u10', 10], ['u62', 62]]) {
      await step('flow', `${n} lines: undo and redo of added items restore every snapshot`, async () => {
        const rows = await take(n), extra = await lots(world, 1, 900 + n)
        if (n === 62) await heavyCatalogue(world, rows)
        const baseAll = await stockMaps(world, [...rows, ...extra].map((r) => r.pid), [...rows, ...extra].map((r) => r.batch))
        const made = await createSale(world, key, rows, { paid: true, pos: true })
        assert.ok(made.saleId, 'no sale was recorded')
        const id = made.saleId
        const before = await state(world, id)
        const addBody = { client_request_id: `${made.requestId}-add`, money_precision_version: 1, expected_exchange_rate: 4000,
          items: [{ product_id: extra[0].pid, quantity: 1, branch_id: 1, batch_id: extra[0].batch, client_line_key: `${made.requestId}-extra`, pricing_source: 'selling', pricing_quote: { ...ZERO_QUOTE } }] }
        const add = await mutate(world, 'POST', `/api/sales/${id}/items`, addBody, addFix)
        assert.equal(add.status, 200, `add items answered ${add.status} ${add.json?.code || ''} ${add.text.slice(0, 220)}`)
        const added = await assertInvariants(world, id, baseAll, `${n} lines after add`)
        const undo = await world.send('POST', `/api/action-history/${add.json.undoActionId}/undo`, { require_applied: true, expected_generation: 0 }, SEND)
        assert.equal(undo.status, 200, `undo answered ${undo.status} ${undo.json?.code || ''} ${undo.text.slice(0, 220)}`)
        const undone = await assertInvariants(world, id, baseAll, `${n} lines after undo`)
        assert.equal(undone.lines.length, n)
        assert.deepEqual(undone.lines.map((l) => l.pricing_snapshot_json), before.lines.map((l) => l.pricing_snapshot_json), 'undo restores every snapshot byte for byte')
        assert.equal(money4(undone.sale.total_usd), money4(before.sale.total_usd))
        const redo = await world.send('POST', `/api/action-history/${add.json.undoActionId}/redo`, { require_applied: true, expected_generation: 1 }, SEND)
        assert.equal(redo.status, 200, `redo answered ${redo.status} ${redo.json?.code || ''} ${redo.text.slice(0, 220)}`)
        const redone = await assertInvariants(world, id, baseAll, `${n} lines after redo`)
        assert.equal(redone.lines.length, n + 1)
        assert.equal(redone.lines.filter((l, i) => added.lines[i] && l.pricing_snapshot_json === added.lines[i].pricing_snapshot_json).length, n + 1, 'redo restores every snapshot as the add left it')
        assert.equal(money4(redone.sale.total_usd), money4(added.sale.total_usd))
      })
    }

    // ------------------------------------------------------------------ big: amend + cancel on 86 and 200, a return on 86
    for (const key of ['s86', 's200']) {
      const f = F[key]
      const label = f ? `${f.n} lines` : key
      await step('big', `${label}: amend, replay`, async () => {
        assert.ok(f && f.saleId, 'fixture missing')
        const id = f.saleId, cur0 = await state(world, id), line0 = cur0.lines[0]
        const amendBody = { kind: 'line_quantity_increased', sale_item_id: line0.id, quantity: Number(line0.quantity) + 1, client_request_id: `${f.requestId}-amend`, money_precision_version: 1, expected_exchange_rate: 4000 }
        const amend = await mutate(world, 'POST', `/api/sales/${id}/amendments`, amendBody, amendFixFor(line0))
        assert.equal(amend.status, 200, `amend answered ${amend.status} ${amend.json?.code || ''} ${amend.text.slice(0, 220)}`)
        const cur = await assertInvariants(world, id, f.base, `${label} after amend`)
        assertResponseMatchesStore(till, amend.json.sale, cur, `${label} amend response`)
        const replay = await world.send('POST', `/api/sales/${id}/amendments`, amendBody, SEND)
        assert.deepEqual(replay.json, amend.json, 'the replay of the amendment answers the same')
      })
      await step('big', `${label}: cancel`, async () => {
        assert.ok(f && f.saleId, 'fixture missing')
        const id = f.saleId
        const cancel = await world.send('PATCH', `/api/sales/${id}/status`, { sale_status: 'cancelled', client_request_id: `${f.requestId}-cancel`, cancel_reason: 'mistake', cancel_note: 'ls1' }, SEND)
        assert.equal(cancel.status, 200, `cancel answered ${cancel.status} ${cancel.json?.code || ''} ${cancel.text.slice(0, 220)}`)
        const cur = await assertInvariants(world, id, f.base, `${label} after cancel`)
        assert.equal(cur.sale.sale_status, 'cancelled')
      })
    }
    await step('big', '86 lines: customer return quote and create on a large sale', async () => {
      const rows = await take(86)
      await heavyCatalogue(world, rows)
      const baseAll = await stockMaps(world, rows.map((r) => r.pid), rows.map((r) => r.batch))
      const made = await createSale(world, 'ret86', rows, { paid: true, pos: true })
      assert.ok(made.saleId, 'no sale was recorded')
      const lines = (await world.all('SELECT id, product_id FROM sale_items WHERE sale_id = ? ORDER BY id LIMIT 2', made.saleId))
      const quote = await world.send('POST', '/api/returns/quote', { sale_id: made.saleId, items: lines.map((l) => ({ sale_item_id: l.id, quantity: 1 })) }, SEND)
      assert.equal(quote.status, 200, `return quote answered ${quote.status} ${quote.json?.code || ''} ${quote.text.slice(0, 220)}`)
      const { customer_return_create_version: _c, customer_return_edit_version: _e, ...expected } = quote.json
      const body = { client_request_id: `${made.requestId}-return`, money_precision_version: 1, sale_id: made.saleId, reason: 'ls1', expected_quote: expected,
        items: lines.map((l) => ({ sale_item_id: l.id, product_id: l.product_id, quantity: 1, stock_action: 'restock', branch_id: 1 })) }
      const ret = await world.send('POST', '/api/returns', body, SEND)
      assert.equal(ret.status, 200, `return create answered ${ret.status} ${ret.json?.code || ''} ${ret.text.slice(0, 220)}`)
      const now = await stockMaps(world, rows.map((r) => r.pid), rows.map((r) => r.batch))
      const restocked = rows.reduce((sum, r) => sum + (now.product.get(r.pid) - (baseAll.product.get(r.pid) - 1)), 0)
      assert.equal(restocked, 2, 'exactly the two returned units are back on the shelf')
      const refunded = await world.all('SELECT total_refund_usd t FROM returns WHERE sale_id = ?', made.saleId)
      assert.equal(refunded.length, 1)
      assert.equal(money4(refunded[0].t), money4(expected.total_refund_usd), 'the refund is the quoted refund')
    })

    // The snapshots are no longer inside the authority parameter of a return, they are proven in groups of their own, in the return's batch.
    // That guard is the protection against a snapshot that changes between the Worker's read and its commit, which the outside cannot interleave,
    // so the real statements (bundled from returnCreateAction.ts) are run against the 86-line sale in a batch of their own.
    await step('big', '86 lines: the chunked snapshot guard passes on the stored snapshots and refuses a changed one in any group', async () => {
      const rows = await take(86)
      await heavyCatalogue(world, rows)
      const made = await createSale(world, 'rg86', rows, { paid: true, pos: true })
      assert.ok(made.saleId, 'no sale was recorded')
      const { customerReturnSnapshotGuardStatements } = loadReturnCreateAction()
      const lines = await world.all('SELECT id, pricing_snapshot_json FROM sale_items WHERE sale_id = ? ORDER BY id', made.saleId)
      assert.equal(lines.length, 86)
      const toD1 = (st) => { const names = []; const sql = st.sql.replace(/@(\w+)/g, (_m, n) => { names.push(n); return '?' }); return world.db.prepare(sql).bind(...names.map((n) => st.params[n])) }
      const run = (statements) => world.db.batch(statements.map(toD1))
      const guards = async () => (await world.all('SELECT count(*) n FROM return_create_guards'))[0].n
      const statements = customerReturnSnapshotGuardStatements(require('node:crypto').randomUUID(), made.saleId, lines.map((l) => ({ id: l.id, pricing_snapshot_json: l.pricing_snapshot_json })))
      const groups = statements.length / 2
      assert.ok(groups >= 4, `86 lines of snapshots should need several groups, got ${groups}`)
      await run(statements)
      assert.equal(await guards(), 0, 'a passing guard leaves no row behind')
      const mutate = async (id, text) => { await world.db.prepare('UPDATE sale_items SET pricing_snapshot_json = ? WHERE id = ?').bind(text, id).run() }
      for (const index of [0, 40, 85]) {
        const line = lines[index]
        await mutate(line.id, line.pricing_snapshot_json + ' ')
        try {
          await assert.rejects(run(statements), undefined, `a changed snapshot of line ${index} was not refused`)
          assert.equal(await guards(), 0, 'a refused guard left a row behind')
          // the planted-wrong guard: only the first group is checked. It must NOT see a change in a later group, which proves the groups are what covers the sale.
          if (index === 85) await assert.doesNotReject(run(statements.slice(0, 2)), 'the first group alone must not see a change in the last line')
        } finally { await mutate(line.id, line.pricing_snapshot_json) }
      }
      await run(statements)
    })

    await step('big', '86 lines: exchange (one line back, one replacement out) on a large sale', async () => {
      const rows = await take(86)
      await heavyCatalogue(world, rows)
      const made = await createSale(world, 'ex86', rows, { paid: true, pos: true })
      assert.ok(made.saleId, 'no sale was recorded')
      const before = await world.all('SELECT id, pricing_snapshot_json FROM sale_items WHERE sale_id = ? ORDER BY id', made.saleId)
      assert.equal(before.length, 86)
      const [out] = await take(1)
      const back = before[0]
      const backProduct = (await world.all('SELECT product_id FROM sale_items WHERE id = ?', back.id))[0].product_id
      const items = [{ sale_item_id: back.id, quantity: 1 }]
      const replacement = [{ branch_id: 1, product_id: out.pid, quantity: 1 }]
      const quote = await world.send('POST', '/api/returns/quote', { sale_id: made.saleId, items, replacement_items: replacement }, SEND)
      assert.equal(quote.status, 200, `exchange quote answered ${quote.status} ${quote.json?.code || ''} ${quote.text.slice(0, 220)}`)
      const { customer_return_create_version: _c, customer_return_edit_version: _e, exchange: quoted, ...expected } = quote.json
      const net = Number(quoted.net_usd)
      const payment = net > 0 ? { details: [{ method: 'Cash', amount_usd: net, amount_khr: 0 }], change_currency: 'USD' } : { details: [], change_currency: 'USD' }
      const body = { client_request_id: `${made.requestId}-exchange`, money_precision_version: 1, sale_id: made.saleId, reason: 'ls1', expected_quote: expected, expected_exchange: quoted,
        exchange_payment: payment, items: items.map((i) => ({ ...i, stock_action: 'restock', branch_id: 1 })), replacement_items: replacement }
      const created = await world.send('POST', '/api/returns', body, SEND)
      assert.equal(created.status, 200, `exchange create answered ${created.status} ${created.json?.code || ''} ${created.text.slice(0, 220)}`)
      const after = await world.all('SELECT id, pricing_snapshot_json FROM sale_items WHERE sale_id = ? ORDER BY id', made.saleId)
      assert.equal(after.length, 86, 'the original sale keeps its 86 lines')
      assert.ok(after.every((l, i) => l.pricing_snapshot_json === before[i].pricing_snapshot_json), 'the original sale keeps every snapshot byte for byte')
      const ret = (await world.all('SELECT id, replacement_sale_id FROM returns WHERE sale_id = ?', made.saleId))
      assert.equal(ret.length, 1, 'one return was recorded')
      assert.ok(ret[0].replacement_sale_id, 'the replacement sale is linked')
      const repl = await world.all('SELECT product_id, quantity FROM sale_items WHERE sale_id = ?', ret[0].replacement_sale_id)
      assert.deepEqual(repl.map((l) => [l.product_id, Number(l.quantity)]), [[out.pid, 1]], 'the replacement sale holds the one replacement unit')
      assert.ok(backProduct != null)
    })

    // ------------------------------------------------------------------ controls: the checker must turn red on the plausible wrong fixes
    await step('controls', 'the checker is red on a dropped line, a truncated snapshot, a swapped snapshot and a stock error', async () => {
      const f = F.s10
      assert.ok(f && f.saleId, 'fixture missing')
      const st = await state(world, f.saleId)
      const list = await world.send('GET', `/api/sales?id=${f.saleId}`, undefined, READ)
      const good = list.json[0]
      assertResponseMatchesStore(till, good, st, 'control: the true response')
      const red = (label, make) => assert.throws(() => assertResponseMatchesStore(till, make(JSON.parse(JSON.stringify(good))), st, label), undefined, `the checker did not catch: ${label}`)
      red('a dropped line', (s) => { s.items.pop(); return s })
      red('a truncated snapshot', (s) => { s.items[1].pricing_snapshot_json = s.items[1].pricing_snapshot_json.slice(0, -40); return s })
      red('a swapped snapshot', (s) => { const a = s.items[0].pricing_snapshot_json; s.items[0].pricing_snapshot_json = s.items[1].pricing_snapshot_json; s.items[1].pricing_snapshot_json = a; return s })
      red('a pool truncated inside the snapshot', (s) => { const v = JSON.parse(s.items[2].pricing_snapshot_json); v.pool.lines.pop(); s.items[2].pricing_snapshot_json = JSON.stringify(v); return s })
      // a stock error: the invariant checker must flag one unit missing from the shelf
      const g = F.s10
      const rows = g.rows
      const shift = async (delta) => {
        await world.db.prepare("INSERT OR REPLACE INTO system_flags(key, value) VALUES('stock_transaction_permit', 'legacy-separate-pool-v1')").run()
        await world.db.batch([world.db.prepare('UPDATE branch_stock SET quantity = quantity + ? WHERE branch_id = 1 AND product_id = ?').bind(delta, rows[0].pid)])
        await world.db.prepare("DELETE FROM system_flags WHERE key = 'stock_transaction_permit'").run()
      }
      await shift(-1)
      try { await assert.rejects(assertInvariants(world, g.saleId, g.base, 'control stock'), /branch_stock/, 'a unit missing from the shelf was not caught') } finally { await shift(1) }
    })
  } finally {
    await world.dispose()
  }
  if (problems.length) {
    console.error(`\ntest-large-sale-native: ${problems.length} broken step(s)`)
    for (const p of problems) console.error(' - ' + p)
    process.exitCode = 1
  } else console.log('\ntest-large-sale-native: all steps passed')
}
main().catch((e) => { console.error('test-large-sale-native crashed:', e && e.stack || e); process.exitCode = 1 })
