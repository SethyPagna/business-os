#!/usr/bin/env node
// H2 Cut B (d1-money): the /stats header reads no sale lines. Two things that must stay true.
//
//  line independence   corrupt one stored sale_items.total_usd (5 decimals) on a v1 sale: /api/sales/stats still answers, with the numbers it
//                      gave before; the report on the same window still refuses (the corruption stays visible somewhere).
//  added later         a Not Paid v1 sale that took a part payment at creation gets a line added later, through the real routes: the header's revenue,
//                      pending and owed equal the old route's (full kernel, lines read) on the same operations, with report_atomic OFF and ON,
//                      and the owed figure is positive and rises with the added line (the check is not trivially equal).
//
// The old route is the same Worker patched back (see test-sales-stats-header-native.cjs). Exit 1 lists every broken step.
'use strict'
const assert = require('node:assert/strict')
const { bootWorld, ORIGIN } = require('./read-budget/world.cjs')
const { lots } = require('./read-budget/writes.cjs')

const SALES = 'src/routes/sales.ts'
const oldRoute = [
  { name: 'old-scope', file: SALES, from: 'const scope = where.length - 1 === windowClauseCount && !openEndedStart ? undefined : salesListFilterReportScope(where, params)', to: 'const scope = salesListFilterReportScope(where, params)' },
  { name: 'old-header', file: SALES, from: 'const totals = await readSalesHeaderTotals(c.env, windowFilter, scope)', to: 'const totals = await (async () => { const r = await readSalesReportTotals(c.env, windowFilter, false, scope); return { revenue_usd: r.totals.revenue_usd, pending_revenue_usd: r.totals.pending_revenue_usd, revenue_without_not_paid_usd: r.totals.revenue_without_not_paid_usd, not_paid_owed_usd: r.totals.not_paid_owed_usd, sale_count: r.sale_count, cancelled_count: r.cancelled_count } })()' },
  { name: 'old-import', file: SALES, from: 'readSalesReportSnapshot, readSalesHeaderTotals,', to: 'readSalesReportSnapshot, readSalesReportTotals,' },
]
const ATOMIC = { report_atomic: 'on', report_atomic_long: 'on' }
const ZERO = { gross_usd: 0, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 0, total_khr: 0 }
const QKEYS = Object.keys(ZERO)
let seq = 0
const key = (l) => `h2-${l}-${++seq}`

async function postWithQuotes(world, method, url, body, lineKeyPath) {
  let r
  for (let i = 0; i < 4; i += 1) {
    r = await world.send(method, url, body)
    if (r.status === 409 && r.json?.code === 'sale_pricing_quote_conflict') {
      const quotes = new Map(r.json.pricing_quotes.map((x) => [x.client_line_key, x]))
      for (const item of body.items) item.pricing_quote = Object.fromEntries(QKEYS.map((q) => [q, quotes.get(item.client_line_key)[q]]))
    } else if (r.status === 409 && r.json?.code === 'sale_header_quote_conflict') body.expected_header_quote = r.json.header_quote
    else break
  }
  return r
}
const items = (rows, k) => rows.map((r, i) => ({ product_id: r.pid, quantity: 1, branch_id: 1, batch_id: r.batch, client_line_key: `${k}-l${i}`, pricing_source: 'selling', pricing_quote: { ...ZERO } }))

async function createSale(world, rows, paid, partUsd = 0) {
  const k = key(paid ? 'paid' : 'unpaid')
  const body = { branch_id: 1, money_precision_version: 1, sale_status: paid ? 'completed' : 'awaiting_payment', exchange_rate: 4000, payment_currency: 'USD', client_request_id: k,
    offline_owner: { version: 1, actor_id: 901, organization_id: world.orgId, authority: ORIGIN, runtime: 'cloudflare-workers' }, amount_paid_usd: 0, amount_paid_khr: 0, items: items(rows, k) }
  let r = await world.send('POST', '/api/sales', body)
  if (r.status === 409 && r.json?.code === 'sale_pricing_quote_conflict') {
    const quotes = new Map(r.json.pricing_quotes.map((x) => [x.client_line_key, x]))
    for (const item of body.items) item.pricing_quote = Object.fromEntries(QKEYS.map((q) => [q, quotes.get(item.client_line_key)[q]]))
  }
  if (paid) {
    const total = body.items.reduce((s, it) => s + Number(it.pricing_quote.total_usd || 0), 0)
    Object.assign(body, { payment_details: [{ method: 'Cash', amount_usd: Math.ceil(total), amount_khr: 0 }], payment_method: 'Cash', amount_paid_usd: Math.ceil(total), amount_paid_khr: 0 })
  }
  if (!paid && partUsd) Object.assign(body, { payment_details: [{ method: 'Cash', amount_usd: partUsd, amount_khr: 0 }], payment_method: 'Cash', amount_paid_usd: partUsd, amount_paid_khr: 0 })
  r = await world.send('POST', '/api/sales', body)
  if (r.status === 409 && r.json?.code === 'sale_header_quote_conflict') { body.expected_header_quote = r.json.header_quote; body.client_request_id = key('retry'); body.items.forEach((it, i) => { it.client_line_key = `${body.client_request_id}-l${i}` }); r = await world.send('POST', '/api/sales', body) }
  if (r.status >= 300) throw new Error('sale create answered ' + r.status + ' ' + r.text.slice(0, 300))
  return r.json.id || r.json.sale_id || r.json.sale?.id
}

const stats = async (world, qs = '') => { const r = await world.send('GET', '/api/sales/stats' + qs, undefined, { miss: true }); return r.status + ' ' + r.text }

// Not Paid sale (part paid at creation) + a line added later; returns the stats bodies after each step.
async function addedLaterFlow(world) {
  const seen = {}
  const rows = await lots(world, 3, 400)
  const id = await createSale(world, rows.slice(0, 1), false, 1)
  seen.created = await stats(world)
  const add = { money_precision_version: 1, expected_exchange_rate: 4000, client_request_id: key('add'), items: items(rows.slice(1, 2), key('addline')) }
  let r = await postWithQuotes(world, 'POST', `/api/sales/${id}/items`, add)
  if (r.status >= 300) throw new Error('add line answered ' + r.status + ' ' + r.text.slice(0, 400))
  seen.added = await stats(world)
  seen.window = await stats(world, '?startDate=2026-11-11&endDate=2026-11-12')
  return seen
}

const problems = []
const log = (...a) => console.log(...a)
async function step(name, fn) {
  try { await fn(); log('ok    ' + name) } catch (e) {
    problems.push(name + ': ' + String(e.message).split('\n')[0])
    log('RED   ' + name + '\n      ' + String(e.message).split('\n').slice(0, 4).join('\n      '))
  }
}
const withWorld = async (opts, fn) => { const w = await bootWorld({ tier: 'free', ...opts }); try { return await fn(w) } finally { await w.dispose() } }

;(async () => {
  for (const [mode, switches] of [['OFF', undefined], ['ON', ATOMIC]]) {
    let oldSeen, newSeen
    await step(`added-later line + part payment (report_atomic ${mode}): the header equals the old full-kernel route at every step`, async () => {
      oldSeen = await withWorld({ patches: oldRoute, ...(switches ? { switches } : {}) }, addedLaterFlow)
      newSeen = await withWorld({ ...(switches ? { switches } : {}) }, addedLaterFlow)
      assert.deepEqual(newSeen, oldSeen)
      const owed = (s) => JSON.parse(s.slice(4)).not_paid_owed_usd
      assert.ok(owed(newSeen.created) > 0, 'the Not Paid sale must be owed')
      assert.ok(owed(newSeen.added) > owed(newSeen.created), 'the later line must raise what is owed')
          })
  }

  await step('line independence: a corrupt stored line does not stop /stats; the report on the same window still refuses', () => withWorld({}, async (world) => {
    const rows = await lots(world, 1, 430)
    const id = await createSale(world, rows, true)
    const before = await stats(world)
    assert.ok(before.startsWith('200 '), before)
    const line = (await world.all('SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id LIMIT 1', id))[0]
    await world.db.prepare('UPDATE sale_items SET total_usd = 1.23456 WHERE id = ?').bind(line.id).run()
    assert.equal(await stats(world), before, '/stats must answer with the numbers it gave before the corruption')
    const report = await world.send('GET', '/api/reports/overview?startDate=2026-11-11&endDate=2026-11-12', undefined, { miss: true })
    assert.ok(report.status >= 400 && /unsupported money|invalid_saved_money|unsupported_row/i.test(report.text), `the full report must still refuse the corrupt line (got ${report.status} ${report.text.slice(0, 160)})`)
    // review M4: the Dashboard reads the same lines through the full kernel, so it must refuse the corrupt line as well (never answer with stale-looking figures)
    for (const url of ['/api/dashboard/startup?startDate=2026-11-11&endDate=2026-11-12&granularity=day', '/api/analytics?startDate=2026-11-11&endDate=2026-11-12']) {
      const dash = await world.send('GET', url, undefined, { miss: true })
      assert.ok(dash.status >= 400 && /unsupported money|invalid_saved_money|unsupported_row/i.test(dash.text), `${url} must refuse the corrupt line (got ${dash.status} ${dash.text.slice(0, 160)})`)
    }
  }))

  if (problems.length) { console.error('\n' + problems.length + ' RED:\n  ' + problems.join('\n  ')); process.exit(1) }
  log('\nall green')
})().catch((e) => { console.error(e); process.exit(1) })
