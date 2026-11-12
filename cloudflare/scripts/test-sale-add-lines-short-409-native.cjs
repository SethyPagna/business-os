#!/usr/bin/env node
// REVIEW d1-money #1, M2: drive one over-asked POST /api/sales/:id/items (a line asking for more than the branch shelf holds) through the real Worker and pin the 409.
// The add-lines stock pre-read is the statement 6.0.1655 changed (`+branch_id = CAST(? AS INTEGER)`); this test proves the request REACHES it (the statement is in the trace)
// and that the refusal body is exactly the one recorded from base (3e30a5e36) -- the same script, run there, printed the same text. Nothing is written.
// Run (from cloudflare/): node scripts/test-sale-add-lines-short-409-native.cjs        (set SHORT_409_PRINT=1 to print the body for a base-vs-head diff)
'use strict'
const assert = require('node:assert/strict')
const { bootWorld } = require('./read-budget/world.cjs')
const { writeShapes } = require('./read-budget/writes.cjs')

;(async () => {
  const world = await bootWorld({ tier: 'free', switches: { call_counting: 'on' } })
  try {
    const shape = writeShapes(world.ctx).find((s) => s.id === 'w-sale-cancel-3-lines')
    const saleId = await shape.prepare(world)
    const line = (await world.all('SELECT si.product_id AS pid, si.batch_id AS batch, p.name AS name FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ? ORDER BY si.id LIMIT 1', saleId))[0]
    const shelf = Number((await world.all('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = 1', line.pid))[0].quantity)
    const ask = shelf + 1
    const key = 'short-409-' + 'a'.repeat(12)
    const request = { money_precision_version: 1, expected_exchange_rate: 4000, client_request_id: key,
      items: [{ product_id: line.pid, quantity: ask, branch_id: 1, client_line_key: key + '-l1', pricing_source: 'selling', pricing_quote: { gross_usd: 0, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 0, total_khr: 0 } }] }
    await world.restart()
    let r = await world.send('POST', `/api/sales/${saleId}/items`, request)
    for (let i = 0; i < 3 && r.status === 409 && r.json && /quote_conflict/.test(String(r.json.code)); i++) {
      if (r.json.code === 'sale_pricing_quote_conflict') {
        const q = new Map(r.json.pricing_quotes.map((x) => [x.client_line_key, x]))[0] || r.json.pricing_quotes.find((x) => x.client_line_key === request.items[0].client_line_key)
        request.items[0].pricing_quote = Object.fromEntries(['gross_usd', 'product_discount_usd', 'manual_discount_usd', 'total_usd', 'total_khr'].map((n) => [n, q[n]]))
      } else request.expected_header_quote = r.json.header_quote
      r = await world.send('POST', `/api/sales/${saleId}/items`, request)
    }
    const stmts = ((await world.last()).stmts || []).map((s) => s.raw.replace(/\s+/g, ' '))
    const reached = stmts.some((s) => /FROM branch_stock WHERE (\+branch_id = CAST\(\? AS INTEGER\)|branch_id = \?) AND product_id IN/.test(s))
    const body = JSON.stringify(r.json).replace(String(line.name), '<NAME>')
    if (process.env.SHORT_409_PRINT) console.log('RESULT ' + JSON.stringify({ status: r.status, body: r.json, reached, shelf, ask }))
    assert.equal(r.status, 409, r.text.slice(0, 300))
    assert.ok(reached, 'the over-asked request reached the branch_stock pre-read')
    assert.equal(r.json.error, `Insufficient stock for ${line.name}: requested ${ask}, available ${shelf}`)
    assert.equal(Object.keys(r.json).join(','), 'error', 'the 409 body carries the message only')
    const after = Number((await world.all('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = 1', line.pid))[0].quantity)
    assert.equal(after, shelf, 'nothing was written')
    console.log('PASS over-asked add-lines line: 409 "' + r.json.error + '", the branch_stock pre-read ran, stock untouched')
  } finally { await world.dispose() }
})().catch((e) => { console.error(e); process.exit(1) })
