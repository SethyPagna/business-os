'use strict'
// Which client created_at POST /api/sales honors, on workerd + D1 with an
// Employee holding only pos+sales.
// A claim inside [server now - 10 min, server now + 2 min] is kept (the positive
// control, so a refusal cannot come from a harness that never honors a claim).
// An older claim is refused with 409 sale_created_at_too_old: no sale, line,
// stock movement or stock change, and one 'sale_refused' audit row naming the
// actor, the claim, the receive time and the request id. The same holds for a
// sales.create replayed through /api/sync/outbox, whose result carries the
// server's code. A future or unparseable claim is stored at the server clock
// and the creation audit row records what was claimed. A repeat of an
// already-recorded sale returns the original sale. The owner fence and the
// money-precision check answer before the refusal. Claims are written with an
// explicit Z or offset, or as zone-less UTC, so no result depends on the zone
// of the machine running the test.
//
// Run (from cloudflare/): node scripts/run-native-suite.cjs sale-created-at-window
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const H = require('./harness/al_money_native.cjs')

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE
const storedMs = value => Date.parse(`${String(value).replace(' ', 'T')}Z`)
const storedShape = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
const QUOTE_FIELDS = ['gross_usd', 'product_discount_usd', 'manual_discount_usd', 'total_usd', 'total_khr']
const TOO_OLD_ERROR = 'This sale was saved on this device at an earlier time and is kept there. Nothing was recorded.'

const stableStringify = value => {
  if (value == null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

async function main() {
  const h = await H.startWorker()
  const r = H.recorder('SALE-TIME')
  try {
    await H.seedProduct(h, 12, 'Window Lipstick', 5, 50, 2)
    const cookie = await h.addEmployee(950, 'window_cashier', { pos: true, sales: true })
    const owner = { ...h.owner, actor_id: 950 }
    const asEmployee = { ...h, call: (method, url, body, label, options = {}) => h.call(method, url, body, label, { cookie, ...options }) }
    const sell = (key, createdAt, extra = {}) => H.createSale(asEmployee, { key, createdAt, lines: [{ productId: 12, quantity: 1 }],
      paymentDetails: [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }], extra: { offline_owner: owner, ...extra }, label: `sale claiming ${createdAt}` })
    const read = async key => {
      const row = await h.one("SELECT id, created_at, creation_snapshot_json, CURRENT_TIMESTAMP AS server_now FROM sales WHERE client_request_id=?", key)
      if (!row) return null
      const audit = await h.one("SELECT details FROM audit_logs WHERE entity='sale_creation' AND entity_id=?", String(row.id))
      return { ...row, creation: JSON.parse(row.creation_snapshot_json), audit: JSON.parse(audit.details) }
    }
    const counts = async () => ({
      sales: (await h.one('SELECT COUNT(*) AS n FROM sales')).n,
      items: (await h.one('SELECT COUNT(*) AS n FROM sale_items')).n,
      movements: (await h.one('SELECT COUNT(*) AS n FROM inventory_movements')).n,
      stock: (await h.one('SELECT stock_quantity AS n FROM products WHERE id=12')).n,
      branchStock: (await h.one('SELECT quantity AS n FROM branch_stock WHERE product_id=12 AND branch_id=1')).n,
    })
    const serverClock = (row, label) => {
      const gap = Math.abs(storedMs(row.created_at) - storedMs(row.server_now))
      assert.ok(gap < MINUTE, `${label}: stored ${row.created_at}, server clock ${row.server_now}`)
      assert.equal(row.creation.origin, 'pos')
      assert.equal(row.creation.sale_at, null)
    }
    const refusedAsTooOld = (result, label) => {
      assert.equal(result.status, 409, `${label}: ${JSON.stringify(result.body).slice(0, 200)}`)
      assert.equal(result.body.code, 'sale_created_at_too_old')
      assert.equal(result.body.error, TOO_OLD_ERROR)
    }

    const refusalRows = async key => h.all("SELECT user_id, user_name, entity_id, details FROM audit_logs WHERE action='sale_refused' AND entity='sale_creation' AND json_extract(details,'$.client_request_id')=?", key)
    const refusalTotal = async () => (await h.one("SELECT COUNT(*) AS n FROM audit_logs WHERE action='sale_refused'")).n
    const beforeOld = await counts()
    const thirtyDays = new Date(Date.now() - 30 * DAY)
    const month = await sell('window-30-days-0001', thirtyDays.toISOString())
    const monthRow = await read('window-30-days-0001')
    const afterMonth = await counts()
    const monthRefusals = await refusalRows('window-30-days-0001')
    r.check(`an Employee claiming created_at 30 days ago is refused with 409 sale_created_at_too_old, nothing is written and one audit row records the attempt (got ${month.status} ${month.body.code}, row ${monthRow ? monthRow.created_at : 'none'}, ${monthRefusals.length} audit row(s))`, () => {
      refusedAsTooOld(month, '30 days ago')
      assert.equal(month.body.claimed_created_at, storedShape(thirtyDays.getTime()))
      assert.equal(monthRow, null, 'no sale row')
      assert.deepEqual(afterMonth, beforeOld, 'no sale, line, stock movement or stock change')
      assert.equal(monthRefusals.length, 1)
      const [row] = monthRefusals
      const details = JSON.parse(row.details)
      assert.equal(row.user_id, 950)
      assert.match(row.user_name, /window_cashier/)
      assert.equal(row.entity_id, null)
      assert.equal(details.kind, 'sale.creation_refused')
      assert.equal(details.reason, 'sale_created_at_too_old')
      assert.equal(details.claimed_created_at, storedShape(thirtyDays.getTime()))
      assert.ok(Math.abs(Date.parse(details.received_at) - Date.now()) < 2 * MINUTE, `received_at ${details.received_at}`)
    })

    const jan = await sell('window-9-months-0001', '2026-01-02T03:00:00.000Z')
    const auditRow = await read('window-9-months-0001')
    const afterJan = await counts()
    const janRefusals = await refusalRows('window-9-months-0001')
    const oldDay = await h.one("SELECT COUNT(*) AS n FROM sales WHERE date(created_at,'+7 hours')='2026-01-02'")
    r.check(`the audit's probe (created_at 2026-01-02) is refused and leaves nothing on the closed day (got ${jan.status} ${jan.body.code}, ${oldDay.n} sale(s) on 2026-01-02)`, () => {
      refusedAsTooOld(jan, '2026-01-02')
      assert.equal(jan.body.claimed_created_at, '2026-01-02 03:00:00')
      assert.equal(auditRow, null)
      assert.equal(oldDay.n, 0)
      assert.deepEqual(afterJan, afterMonth)
      assert.equal(janRefusals.length, 1)
      assert.equal(JSON.parse(janRefusals[0].details).claimed_created_at, '2026-01-02 03:00:00')
    })

    const ahead = await sell('window-1-hour-ahead-0001', new Date(Date.now() + 60 * MINUTE).toISOString())
    const aheadRow = await read('window-1-hour-ahead-0001')
    r.check(`a claim one hour ahead is stored at the server clock and the audit row records the claim (got ${ahead.status}, stored ${aheadRow && aheadRow.created_at})`, () => {
      assert.equal(ahead.status, 200, JSON.stringify(ahead.body).slice(0, 200))
      serverClock(aheadRow, '1 hour ahead')
      assert.equal(aheadRow.audit.created_at_adjusted, true)
      assert.match(aheadRow.audit.claimed_created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
      assert.ok(storedMs(aheadRow.audit.claimed_created_at) - storedMs(aheadRow.server_now) > 50 * MINUTE, `claimed ${aheadRow.audit.claimed_created_at}`)
      assert.ok(Math.abs(Date.parse(aheadRow.audit.received_at) - storedMs(aheadRow.server_now)) < MINUTE, `received ${aheadRow.audit.received_at}`)
      assert.equal(aheadRow.audit.origin, 'pos')
    })

    const garbage = await sell('window-garbage-0001', 'not-a-date')
    const garbageRow = await read('window-garbage-0001')
    r.check(`an unparseable claim is stored at the server clock, not refused, and the audit row says it was adjusted (got ${garbage.status}, stored ${garbageRow && garbageRow.created_at})`, () => {
      assert.equal(garbage.status, 200, JSON.stringify(garbage.body).slice(0, 200))
      serverClock(garbageRow, 'garbage')
      assert.equal(garbageRow.audit.created_at_adjusted, true)
      assert.equal(garbageRow.audit.claimed_created_at, null)
    })

    const claimedMs = Date.now() - 5 * MINUTE
    const recent = await sell('window-5-minutes-0001', new Date(claimedMs).toISOString())
    const recentRow = await read('window-5-minutes-0001')
    r.check(`control: a claim five minutes ago is kept and is not marked adjusted (got ${recent.status}, stored ${recentRow && recentRow.created_at}, claimed ${storedShape(claimedMs)})`, () => {
      assert.equal(recent.status, 200, JSON.stringify(recent.body).slice(0, 200))
      assert.equal(recentRow.created_at, storedShape(claimedMs))
      assert.equal(recentRow.creation.origin, 'offline_replay')
      assert.equal(recentRow.creation.sale_at, storedShape(claimedMs))
      assert.equal(recentRow.audit.created_at_adjusted, undefined)
    })

    const normal = await sell('window-repeat-0001', undefined)
    const normalRow = await read('window-repeat-0001')
    const repeat = await sell('window-repeat-0001', new Date(Date.now() - 30 * DAY).toISOString())
    const sameKey = await h.one("SELECT COUNT(*) AS n FROM sales WHERE client_request_id='window-repeat-0001'")
    const repeatRefusals = await refusalRows('window-repeat-0001')
    r.check(`a repeat of an already-recorded sale that now claims an old time returns the original sale, not 409 (first ${normal.status}, repeat ${repeat.status} duplicate=${repeat.body.duplicate} id ${repeat.body.id} vs ${normalRow && normalRow.id})`, () => {
      assert.equal(normal.status, 200, JSON.stringify(normal.body).slice(0, 200))
      assert.equal(repeat.status, 200, JSON.stringify(repeat.body).slice(0, 200))
      assert.equal(repeat.body.duplicate, true)
      assert.equal(repeat.body.id, normalRow.id)
      assert.equal(sameKey.n, 1)
      assert.equal(repeatRefusals.length, 0, 'a recorded sale replayed with an old claim is acknowledged, not refused')
    })

    const beforeOrder = await counts()
    const stale = new Date(Date.now() - 30 * DAY).toISOString()
    const ownerless = await H.createSale(asEmployee, { key: 'window-ownerless-0001', createdAt: stale, lines: [{ productId: 12, quantity: 1 }],
      paymentDetails: [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }], extra: { offline_owner: undefined }, label: 'ownerless old claim' })
    const legacyMoney = await H.createSale(asEmployee, { key: 'window-legacy-money-0001', createdAt: stale, lines: [{ productId: 12, quantity: 1 }],
      paymentDetails: [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }], extra: { offline_owner: owner, money_precision_version: 0 }, label: 'v0 money old claim' })
    const afterOrder = await counts()
    const orderRefusals = [...await refusalRows('window-ownerless-0001'), ...await refusalRows('window-legacy-money-0001')]
    const ownerlessRow = await read('window-ownerless-0001')
    const legacyRow = await read('window-legacy-money-0001')
    r.check(`order: the owner fence and the precision check answer before the old-claim refusal (ownerless ${ownerless.body.code}, v0 money ${legacyMoney.body.code})`, () => {
      assert.equal(ownerless.status, 409)
      assert.equal(ownerless.body.code, 'offline_owner_required')
      assert.equal(legacyMoney.status, 409)
      assert.equal(legacyMoney.body.code, 'money_precision_review_needed')
      assert.equal(ownerlessRow, null)
      assert.equal(legacyRow, null)
      assert.equal(orderRefusals.length, 0, 'those answers are not the old-claim refusal and leave no refusal row')
      assert.deepEqual(afterOrder, beforeOrder, 'neither refusal wrote anything')
    })

    const quoteProbe = await asEmployee.call('POST', '/api/sales', { branch_id: 1, money_precision_version: 1, sale_status: 'completed', exchange_rate: 4000, payment_currency: 'USD',
      client_request_id: 'window-quote-probe-0001', offline_owner: owner, payment_details: [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }], payment_method: 'Cash', amount_paid_usd: 5, amount_paid_khr: 0,
      items: [{ product_id: 12, quantity: 1, branch_id: 1, batch_id: 5012, client_line_key: 'quote-probe-line', pricing_source: 'selling',
        pricing_quote: { gross_usd: 0, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 0, total_khr: 0 } }] }, 'quote probe')
    const quote = Object.fromEntries(QUOTE_FIELDS.map(name => [name, quoteProbe.body.pricing_quotes && quoteProbe.body.pricing_quotes[0][name]]))
    const outbox = async (key, createdAt) => {
      const payload = { branch_id: 1, money_precision_version: 1, sale_status: 'completed', exchange_rate: 4000, payment_currency: 'USD', offline_owner: owner,
        created_at: createdAt, payment_details: [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }], payment_method: 'Cash', amount_paid_usd: 5, amount_paid_khr: 0,
        items: [{ product_id: 12, quantity: 1, branch_id: 1, batch_id: 5012, client_line_key: `${key}-line-1`, pricing_source: 'selling', pricing_quote: quote }] }
      const operation = { operation_id: 'sales.create', client_request_id: key, schema_version: 1, base_updated_at: '2026-09-15T00:00:00.000Z',
        payload_digest: createHash('sha256').update(stableStringify(payload)).digest('hex'), payload }
      return asEmployee.call('POST', '/api/sync/outbox', { operations: [operation] }, `outbox sales.create claiming ${createdAt}`)
    }
    const beforeOutbox = await counts()
    const oldViaOutbox = await outbox('window-outbox-old-0001', stale)
    const afterOldOutbox = await counts()
    const oldOutboxRow = await read('window-outbox-old-0001')
    const oldOutboxRefusals = await refusalRows('window-outbox-old-0001')
    const recentMs = Date.now() - 2 * MINUTE
    const recentViaOutbox = await outbox('window-outbox-recent-0001', new Date(recentMs).toISOString())
    const recentOutboxRow = await read('window-outbox-recent-0001')
    r.check(`/api/sync/outbox replay of sales.create with an old claim is rejected with the server's code and message and nothing is written (result ${JSON.stringify(oldViaOutbox.body.results && oldViaOutbox.body.results[0]).slice(0, 260)})`, () => {
      assert.ok(quoteProbe.body.pricing_quotes, `quote probe: ${JSON.stringify(quoteProbe.body).slice(0, 200)}`)
      const result = oldViaOutbox.body.results[0]
      assert.equal(result.status, 'rejected')
      assert.equal(result.code, 'sale_created_at_too_old')
      assert.equal(result.error, TOO_OLD_ERROR)
      assert.equal(oldViaOutbox.body.success, false)
      assert.equal(oldOutboxRow, null)
      assert.deepEqual(afterOldOutbox, beforeOutbox)
      assert.equal(oldOutboxRefusals.length, 1)
    })
    r.check(`/api/sync/outbox control: the same replay with a claim two minutes ago is applied and kept (result ${JSON.stringify(recentViaOutbox.body.results && recentViaOutbox.body.results[0]).slice(0, 220)})`, () => {
      const result = recentViaOutbox.body.results[0]
      assert.equal(result.status, 'applied', JSON.stringify(result).slice(0, 300))
      assert.equal(recentOutboxRow.created_at, storedShape(recentMs))
    })

    const utcWallMs = Date.now() - 5 * MINUTE
    const utcWall = await sell('window-zoneless-0001', new Date(utcWallMs).toISOString().slice(0, 19).replace('T', ' '))
    const utcWallRow = await read('window-zoneless-0001')
    const offsetMs = Date.now() - 4 * MINUTE
    const offsetClaim = await sell('window-offset-0001', new Date(offsetMs + 7 * 60 * MINUTE).toISOString().slice(0, 19) + '+07:00')
    const offsetRow = await read('window-offset-0001')
    const zonelessOld = await sell('window-zoneless-old-0001', new Date(Date.now() - 30 * DAY).toISOString().slice(0, 19).replace('T', ' '))
    const phnomPenhWall = await sell('window-zoneless-pp-0001', new Date(Date.now() + 7 * 60 * MINUTE).toISOString().slice(0, 19).replace('T', ' '))
    const phnomPenhRow = await read('window-zoneless-pp-0001')
    r.check(`a claim without a zone is read as UTC whatever the machine's zone: UTC wall time five minutes ago is kept (got ${utcWall.status}, stored ${utcWallRow && utcWallRow.created_at}, expected ${storedShape(utcWallMs)}), a 30-day-old one is refused (${zonelessOld.status} ${zonelessOld.body.code}), a Phnom Penh wall clock reads seven hours ahead and gets server time (${phnomPenhWall.status}, stored ${phnomPenhRow && phnomPenhRow.created_at})`, () => {
      assert.equal(utcWall.status, 200, JSON.stringify(utcWall.body).slice(0, 200))
      assert.equal(utcWallRow.created_at, storedShape(utcWallMs))
      assert.equal(utcWallRow.creation.origin, 'offline_replay')
      refusedAsTooOld(zonelessOld, 'zone-less 30 days ago')
      assert.equal(phnomPenhWall.status, 200, JSON.stringify(phnomPenhWall.body).slice(0, 200))
      serverClock(phnomPenhRow, 'Phnom Penh wall clock')
      assert.equal(phnomPenhRow.audit.created_at_adjusted, true)
    })
    r.check(`a claim with an explicit +07:00 offset is converted to UTC and kept (got ${offsetClaim.status}, stored ${offsetRow && offsetRow.created_at}, expected ${storedShape(offsetMs)})`, () => {
      assert.equal(offsetClaim.status, 200, JSON.stringify(offsetClaim.body).slice(0, 200))
      assert.equal(offsetRow.created_at, storedShape(offsetMs))
    })
    const refusals = await refusalTotal()
    r.check(`every refusal wrote exactly one audit row and nothing else did (four refusals: two direct, one zone-less, one outbox; got ${refusals})`, () => {
      assert.equal(refusals, 4)
    })
  } finally {
    await h.mf.dispose()
  }
  const failed = r.results.filter(result => !result.ok)
  console.log(`${failed.length ? 'RED' : 'GREEN'} SALE-TIME created_at window: ${r.results.length - failed.length}/${r.results.length} checks hold`)
  if (failed.length) process.exitCode = 1
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
