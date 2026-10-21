'use strict'
// What POST /api/sales does with a client created_at, on workerd + D1 with an
// Employee holding only pos+sales.
// The server clock is the sale's created_at for every sale (offline selling is
// cancelled and no queued sale exists): a claim inside the window, ahead of it
// or unparseable is stored at the server clock and the creation audit row
// records what was claimed. A claim older than 10 minutes is refused with 409
// sale_created_at_too_old: no sale, line, stock movement or stock change, and
// one 'sale_refused' audit row naming the actor, the claim, the receive time
// and the request id. A repeat of an already-recorded sale returns the original sale. The owner fence and the
// money-precision check answer before the refusal. A claim that matches a
// closed shift segment's last second, or runs ahead of the open segment's
// close, must still land in the segment the sale was rung in, so the segment's
// reconciliation and the report reader agree. Claims are written with an
// explicit Z or offset, or as zone-less UTC, so no result depends on the zone
// of the machine running the test.
//
// Run (from cloudflare/): node scripts/run-native-suite.cjs sale-created-at-window
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE
const storedMs = value => Date.parse(`${String(value).replace(' ', 'T')}Z`)
const storedShape = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
const TOO_OLD_ERROR = 'This sale was saved on this device at an earlier time and is kept there. Nothing was recorded.'

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
    r.check(`a claim five minutes ago is NOT stored: the sale takes the server clock and the audit row records the claim (got ${recent.status}, stored ${recentRow && recentRow.created_at}, claimed ${storedShape(claimedMs)})`, () => {
      assert.equal(recent.status, 200, JSON.stringify(recent.body).slice(0, 200))
      serverClock(recentRow, '5 minutes ago')
      assert.notEqual(recentRow.created_at, storedShape(claimedMs))
      assert.equal(recentRow.audit.created_at_adjusted, true)
      assert.equal(recentRow.audit.claimed_created_at, storedShape(claimedMs))
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

    const beforeOutbox = await counts()
    const outbox = await asEmployee.call('POST', '/api/sync/outbox', { operations: [] }, 'retired outbox route')
    const afterOutbox = await counts()
    r.check('/api/sync/outbox is retired: a sales.create replay route no longer exists, so no old claim can reach a sale through it', () => {
      assert.equal(outbox.status, 404)
      assert.deepEqual(afterOutbox, beforeOutbox)
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
    r.check(`a claim without a zone is read as UTC whatever the machine's zone: UTC wall time five minutes ago is audited as claimed and the sale takes the server clock (got ${utcWall.status}, stored ${utcWallRow && utcWallRow.created_at}, claimed ${storedShape(utcWallMs)}), a 30-day-old one is refused (${zonelessOld.status} ${zonelessOld.body.code}), a Phnom Penh wall clock reads seven hours ahead and gets server time (${phnomPenhWall.status}, stored ${phnomPenhRow && phnomPenhRow.created_at})`, () => {
      assert.equal(utcWall.status, 200, JSON.stringify(utcWall.body).slice(0, 200))
      serverClock(utcWallRow, 'zone-less UTC')
      assert.equal(utcWallRow.audit.claimed_created_at, storedShape(utcWallMs))
      refusedAsTooOld(zonelessOld, 'zone-less 30 days ago')
      assert.equal(phnomPenhWall.status, 200, JSON.stringify(phnomPenhWall.body).slice(0, 200))
      serverClock(phnomPenhRow, 'Phnom Penh wall clock')
      assert.equal(phnomPenhRow.audit.created_at_adjusted, true)
    })
    r.check(`a claim with an explicit +07:00 offset is converted to UTC for the audit row and the sale takes the server clock (got ${offsetClaim.status}, stored ${offsetRow && offsetRow.created_at}, claimed ${storedShape(offsetMs)})`, () => {
      assert.equal(offsetClaim.status, 200, JSON.stringify(offsetClaim.body).slice(0, 200))
      serverClock(offsetRow, '+07:00 offset')
      assert.equal(offsetRow.audit.claimed_created_at, storedShape(offsetMs))
    })
    const refusals = await refusalTotal()
    r.check(`every refusal wrote exactly one audit row and nothing else did (three refusals: two direct, one zone-less; got ${refusals})`, () => {
      assert.equal(refusals, 3)
    })

    const secondCookie = await h.addEmployee(951, 'window_cashier_two', { pos: true, sales: true })
    const secondOwner = { ...h.owner, actor_id: 951 }
    const secondEmployee = { ...h, call: (method, url, body, label, options = {}) => h.call(method, url, body, label, { cookie: secondCookie, ...options }) }
    const refuseAsSecond = (key, createdAt) => H.createSale(secondEmployee, { key, createdAt, lines: [{ productId: 12, quantity: 1 }],
      paymentDetails: [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }], extra: { offline_owner: secondOwner }, label: 'second cashier old claim' })
    const refusalRowsFor = (userId, key) => h.all("SELECT id, user_id, details, new_value FROM audit_logs WHERE action='sale_refused' AND user_id=? AND json_extract(details,'$.client_request_id') IS ? ORDER BY id", userId, key)
    const beforeLoop = await counts()
    const totalBeforeLoop = await refusalTotal()
    const stalePast = new Date(Date.now() - 20 * DAY).toISOString()
    const loopStatuses = []
    for (let attempt = 0; attempt < 5; attempt += 1) loopStatuses.push((await sell('window-loop-0001', stalePast)).status)
    const loopRows = await refusalRowsFor(950, 'window-loop-0001')
    const otherId = await sell('window-loop-0002', stalePast)
    const otherUser = await refuseAsSecond('window-loop-0001', stalePast)
    const noId = [await sell(undefined, stalePast), await sell(undefined, stalePast)]
    const noIdRows = await refusalRowsFor(950, null)
    const otherIdRows = await refusalRowsFor(950, 'window-loop-0002')
    const otherUserRows = await refusalRowsFor(951, 'window-loop-0001')
    const afterLoop = await counts()
    const totalAfterLoop = await refusalTotal()
    r.check(`N1: five identical refusals for one account and request id write ONE audit row with a count and last-seen time updated in place (rows ${loopRows.length}, details ${loopRows[0] && loopRows[0].details})`, () => {
      assert.deepEqual(loopStatuses, [409, 409, 409, 409, 409])
      assert.equal(loopRows.length, 1)
      const details = JSON.parse(loopRows[0].details)
      assert.equal(details.count, 5)
      assert.equal(details.kind, 'sale.creation_refused')
      assert.equal(details.reason, 'sale_created_at_too_old')
      assert.equal(details.claimed_created_at, storedShape(Date.parse(stalePast)))
      assert.ok(Date.parse(details.last_received_at) >= Date.parse(details.received_at))
      assert.equal(loopRows[0].new_value, loopRows[0].details, 'the diff column follows the details')
    })
    r.check(`N1: a different request id, a different account with the same request id, and requests without an id each keep their own row (other id ${otherId.status}, other account ${otherUser.status}, no-id rows ${noIdRows.length}; total refusal rows ${totalBeforeLoop} -> ${totalAfterLoop})`, () => {
      assert.equal(otherId.status, 409)
      assert.equal(otherUser.status, 409)
      assert.deepEqual(noId.map(result => result.status), [409, 409])
      assert.equal(otherIdRows.length, 1)
      assert.equal(otherUserRows.length, 1)
      assert.equal(noIdRows.length, 1)
      assert.equal(JSON.parse(noIdRows[0].details).count, 2)
      assert.equal(totalAfterLoop - totalBeforeLoop, 4, 'five loop attempts, one other id, one other account, two without an id are four rows')
      assert.deepEqual(afterLoop, beforeLoop, 'no sale, line, stock movement or stock change')
    })

    const beforeShapes = await counts()
    const refusalsBeforeShapes = await refusalTotal()
    const badIds = [{ toString: null }, { a: 1 }, ['a', 'b'], [], 12345, true, false]
    const shapeResults = []
    for (const [index, value] of badIds.entries()) {
      shapeResults.push(await H.createSale(asEmployee, { key: 'ignored-shape-' + index, createdAt: stalePast, lines: [{ productId: 12, quantity: 1 }],
        paymentDetails: [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }], extra: { offline_owner: owner, client_request_id: value }, label: 'non-string client_request_id ' + JSON.stringify(value) }))
    }
    const afterShapes = await counts()
    const refusalsAfterShapes = await refusalTotal()
    r.check(`N2: a client_request_id that is not text (object, {"toString":null}, array, number, boolean) is a 400 with a code, never a 500, and writes nothing (statuses ${shapeResults.map(result => result.status).join(',')})`, () => {
      shapeResults.forEach((result, index) => {
        assert.equal(result.status, 400, `${JSON.stringify(badIds[index])}: ${JSON.stringify(result.body).slice(0, 200)}`)
        assert.equal(result.body.code, 'invalid_client_request_id')
      })
      assert.deepEqual(afterShapes, beforeShapes)
      assert.equal(refusalsAfterShapes, refusalsBeforeShapes, 'a malformed identity is not a refused stale sale')
    })
    const nullId = await H.createSale(asEmployee, { key: 'ignored-null-id', lines: [{ productId: 12, quantity: 1 }],
      paymentDetails: [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }], extra: { offline_owner: owner, client_request_id: null }, label: 'null client_request_id' })
    r.check(`N2 control: a null client_request_id is still a normal sale (got ${nullId.status})`, () => {
      assert.equal(nullId.status, 200, JSON.stringify(nullId.body).slice(0, 200))
    })

    const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
    const shiftWindow = id => h.one('SELECT id, opened_at, closed_at, revision FROM shift_sessions WHERE id=?', id)
    const shiftFigures = async id => {
      const row = await h.one('SELECT figures_json FROM shift_close_figures WHERE shift_session_id=?', id)
      const figures = JSON.parse(row.figures_json)
      return figures.reconciliation || figures
    }
    const openSegment = async tag => {
      const opened = await asEmployee.call('POST', '/api/shifts/open', { branch_id: 1, opening_float_usd: 0, opening_float_khr: 0 }, `open ${tag}`)
      assert.equal(opened.status, 201, `open ${tag}: ${JSON.stringify(opened.body).slice(0, 200)}`)
      return (opened.body.shift || opened.body).id
    }
    const closeSegment = async (id, tag, counted) => {
      const window = await shiftWindow(id)
      const closed = await asEmployee.call('POST', '/api/shifts/close', { shift_id: id, expected_revision: window.revision, branch_id: 1,
        client_request_id: `window-${tag.replace(/ /g, "-")}-close-0001`, closing_counted_usd: counted, closing_counted_khr: 0 }, `close ${tag}`)
      assert.equal(closed.status, 200, `close ${tag}: ${JSON.stringify(closed.body).slice(0, 200)}`)
    }
    const reopenSegment = async (id, tag) => {
      const window = await shiftWindow(id)
      const reopened = await asEmployee.call('POST', `/api/shifts/${id}/reopen`, { expected_revision: window.revision, reason: `window ${tag}`, opening_float_usd: 0, opening_float_khr: 0 }, `reopen ${tag}`)
      assert.equal(reopened.status, 201, `reopen ${tag}: ${JSON.stringify(reopened.body).slice(0, 200)}`)
      return reopened.body.shift.id
    }
    const cashFigures = f => ({ cash_sales: f.cash_sales.usd, expected: f.expected.usd, counted: f.counted.usd, difference: f.difference.usd, needs_review: f.needs_review })
    const reportRevenue = async window => {
      const report = await h.call('GET', `/api/reports/overview?createdFrom=${encodeURIComponent(window.opened_at)}&createdTo=${encodeURIComponent(window.closed_at)}`, undefined, 'report over a shift window')
      assert.equal(report.status, 200, JSON.stringify(report.body).slice(0, 200))
      const totals = report.body.sales.totals
      return { orders: totals.tx_count ?? totals.orders ?? totals.count, revenue: totals.revenue_usd ?? totals.total_usd }
    }

    await pause(1100)
    const seg1 = await openSegment('segment 1')
    const seg1Sale = await sell('window-seg1-sale-0001', undefined)
    await pause(1100)
    await closeSegment(seg1, 'segment 1', 5)
    const seg1Window = await shiftWindow(seg1)
    const seg1Before = await shiftFigures(seg1)
    await pause(1100)
    const seg2 = await reopenSegment(seg1, 'segment 2')
    const backClaim = new Date(Date.parse(seg1Window.closed_at) - 1000).toISOString()
    const back = await sell('window-seg2-back-claim-0001', backClaim)
    const backRow = await read('window-seg2-back-claim-0001')
    await pause(1100)
    await closeSegment(seg2, 'segment 2', 10)
    const seg2Window = await shiftWindow(seg2)
    const seg2Figures = await shiftFigures(seg2)
    const seg1After = await shiftFigures(seg1)
    const seg1Report = await reportRevenue(seg1Window)
    const seg2Report = await reportRevenue(seg2Window)
    r.check(`S1: a $5 cash sale rung in the open segment that claims the previous closed segment's close minus one second lands in the open segment: segment 2 cash sales 5, difference 0, segment 1 untouched, report agrees (sale ${back.status}, stored ${backRow && backRow.created_at}, seg 1 closed ${seg1Window.closed_at}, seg 2 opened ${seg2Window.opened_at}, seg 2 ${JSON.stringify(cashFigures(seg2Figures))})`, () => {
      assert.equal(seg1Sale.status, 200, JSON.stringify(seg1Sale.body).slice(0, 200))
      assert.equal(back.status, 200, JSON.stringify(back.body).slice(0, 200))
      serverClock(backRow, 'back-dated into the closed segment')
      assert.ok(storedMs(backRow.created_at) >= Math.floor(Date.parse(seg2Window.opened_at) / 1000) * 1000, 'stored inside the open segment')
      assert.ok(storedMs(backRow.created_at) >= Math.floor(Date.parse(seg1Window.closed_at) / 1000) * 1000, 'not inside the closed segment')
      assert.deepEqual(cashFigures(seg2Figures), { cash_sales: 5, expected: 10, counted: 10, difference: 0, needs_review: false })
      assert.deepEqual(seg1After, seg1Before, 'the closed segment keeps its stored figures')
      assert.deepEqual(cashFigures(seg1After), { cash_sales: 5, expected: 5, counted: 5, difference: 0, needs_review: false })
      assert.equal(backRow.audit.claimed_created_at, storedShape(Date.parse(backClaim)))
      assert.equal(seg1Report.orders, 1, JSON.stringify(seg1Report))
      assert.equal(seg2Report.orders, 1, JSON.stringify(seg2Report))
      assert.equal(seg1Report.revenue, 5)
      assert.equal(seg2Report.revenue, 5)
    })

    await pause(1100)
    const seg3 = await reopenSegment(seg2, 'segment 3')
    await pause(1100)
    const fwdClaim = new Date(Date.now() + 110 * 1000).toISOString()
    const fwd = await sell('window-seg3-forward-claim-0001', fwdClaim)
    const fwdRow = await read('window-seg3-forward-claim-0001')
    await pause(1100)
    await closeSegment(seg3, 'segment 3', 15)
    const seg3Window = await shiftWindow(seg3)
    const seg3Figures = await shiftFigures(seg3)
    await pause(1100)
    const seg4 = await reopenSegment(seg3, 'segment 4')
    await pause(1100)
    await closeSegment(seg4, 'segment 4', 15)
    const seg4Window = await shiftWindow(seg4)
    const seg4Figures = await shiftFigures(seg4)
    const seg3Report = await reportRevenue(seg3Window)
    const seg4Report = await reportRevenue(seg4Window)
    r.check(`S1: a $5 cash sale that claims 110 seconds ahead stays in the segment it was rung in, never after its close: segment 3 cash sales 5, difference 0, segment 4 empty, report agrees (sale ${fwd.status}, stored ${fwdRow && fwdRow.created_at}, seg 3 closed ${seg3Window.closed_at}, seg 3 ${JSON.stringify(cashFigures(seg3Figures))}, seg 4 ${JSON.stringify(cashFigures(seg4Figures))})`, () => {
      assert.equal(fwd.status, 200, JSON.stringify(fwd.body).slice(0, 200))
      serverClock(fwdRow, 'forward claim')
      assert.ok(storedMs(fwdRow.created_at) <= Date.parse(seg3Window.closed_at), 'not after the close of the segment it was rung in')
      assert.deepEqual(cashFigures(seg3Figures), { cash_sales: 5, expected: 15, counted: 15, difference: 0, needs_review: false })
      assert.deepEqual(cashFigures(seg4Figures), { cash_sales: 0, expected: 15, counted: 15, difference: 0, needs_review: false })
      assert.equal(seg3Report.orders, 1, JSON.stringify(seg3Report))
      assert.equal(seg3Report.revenue, 5)
      assert.equal(seg4Report.orders, 0, JSON.stringify(seg4Report))
      assert.equal(fwdRow.audit.created_at_adjusted, true)
    })
  } finally {
    await h.mf.dispose()
  }
  const failed = r.results.filter(result => !result.ok)
  console.log(`${failed.length ? 'RED' : 'GREEN'} SALE-TIME created_at window: ${r.results.length - failed.length}/${r.results.length} checks hold`)
  if (failed.length) process.exitCode = 1
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
