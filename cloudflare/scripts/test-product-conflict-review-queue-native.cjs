'use strict'
// Review-tier Conflicts decisions (lane 6.0.988, owner ruling 27 Oct 2026): a staff member with Review access who confirms a product's
// $0 cost or "no barcode" as correct does not apply it and is not refused -- the request goes to the review queue, an admin approves it,
// and the approval writes the same mark as the Full tier, as the reviewer, with an audit row and an undo record.
//
// REAL routes/products.ts (POST /data-gaps/marks), REAL lib/reviewGate.ts + lib/pendingActions.ts, REAL lib/reviewApply.ts applier
// (applyApprovedPendingAction) and REAL lib/reviewApprovalPermission.ts over a fully migrated SQLite. Pinned:
//   - Review tier: 202 { pending, pendingActionId }, an open pending_actions row, the "created" Telegram alert hook called, and NOTHING
//     applied (no mark, no history, no audit row). A second tap returns the same request (the retry key), not a second row.
//   - A $0 confirmation still needs the requester's cost grants, and a role with no Products access is refused (403) and queues nothing.
//   - Approval applies the mark as the reviewer and names the requester; the audit row says via=review.
//   - Approval refuses (409 ReviewCodedRefusal confirmed_value_changed, nothing written, request stays open) when the cost / barcode is
//     no longer the value the requester confirmed -- including a change that leaves the product still listed.
//   - Full tier applies directly and queues nothing.
// Each rule has a mutant in the lane report: skip the queue, drop the value check, queue the Full tier, drop the dedupe.
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const role = grants => ({ id: 31, username: 'staff', name: 'Staff', role_code: 'staff', role_permissions: JSON.stringify(grants), permissions: '{}' })
const admin = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
const COST = { product_cost_view: true, product_cost_edit: true }
const MERGE = { 'products:merge_duplicates': true }
const reviewer = role({ products: 'review', ...MERGE, ...COST })
const reviewerNoCost = role({ products: 'review', ...MERGE })
const full = role({ products: true, ...MERGE, ...COST })
const noProducts = role({ pos: true })

let gate = null
const queueOverride = { maybeQueueForReview: (...args) => gate.maybeQueueForReview(...args) }
const h = createProductsRouteHarness({ user: admin, overrides: { '../lib/reviewGate': queueOverride, './cache': { bumpVersion: async () => {}, bumpVersions: async () => {} } } })
const real = h.load('lib/permissions.ts')
h.setActionTier((...args) => real.getActionTier(...args))
gate = h.load('lib/reviewGate.ts')
const applyLib = h.load('lib/reviewApply.ts')
const approvalPermission = h.load('lib/reviewApprovalPermission.ts')
const db = h.raw.db
const env = { DB: h.raw }

// The alert hook is a global the gate looks up; capture what it is asked to announce.
const announced = []
globalThis[Symbol.for('business-os.review-alert.v1')] = { announce: async (_env, event) => { announced.push(event) }, nameBeforeChange: async () => null }

seedStockFixture(db, () => {
  const add = db.prepare('INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,is_active,is_group,stock_quantity,selling_price_usd) VALUES(?,?,?,?,?,1,0,0,1)')
  add.run(1, 'Old zero A', 'B1', 0, 0)
  add.run(2, 'Old zero B', 'B2', 0, 0)
  add.run(3, 'Old zero C', 'B3', 0, 0)
  add.run(4, 'No barcode A', null, 2, 0)
  add.run(5, 'No barcode B', null, 2, 0)
  add.run(6, 'No barcode C', null, 2, 0)
  add.run(7, 'Old zero D', 'B7', 0, 0)
  db.prepare("UPDATE system_flags SET value = '20' WHERE key = 'cost_zero_watermark'").run()
  db.exec("INSERT INTO roles(id,name,code,permissions) VALUES (31,'Staff','staff','{}')")
  db.exec("INSERT INTO users(id,username,name,password,role_id,permissions,is_active) VALUES (31,'staff','Staff','x',31,'{}',1)")
})
// The requester the applier re-reads must hold the grants; the role row carries them.
const setRequesterGrants = grants => db.prepare('UPDATE roles SET permissions = ? WHERE id = 31').run(JSON.stringify(grants))
setRequesterGrants({ products: 'review', ...MERGE, ...COST })

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log('PASS ' + name) } catch (error) { failed++; console.error('FAIL ' + name, error.stack || error.message) }
}
const post = async (body, user) => { h.setUser(user); return h.request('POST', '/data-gaps/marks', body) }
const count = sql => db.prepare(sql).get().n
const marks = () => count('SELECT COUNT(*) n FROM product_conflict_marks')
const history = () => count("SELECT COUNT(*) n FROM action_history WHERE scope = 'products'")
const markAudits = () => count("SELECT COUNT(*) n FROM audit_logs WHERE action IN ('conflict_mark','conflict_unmark')")
const openRows = () => db.prepare("SELECT * FROM pending_actions WHERE status = 'open' AND action_type = 'conflict_mark' ORDER BY id").all()
const approve = async row => applyLib.applyApprovedPendingAction(env, row, { id: 7, name: 'admin' }, admin)

async function main() {
  await check('Review tier: Confirm $0 and no-barcode are queued (202), applied to nothing, and announced', async () => {
    const before = { marks: marks(), history: history(), audits: markAudits() }
    const zero = await post({ product_id: 1, mark: 'zero_cost_confirmed', set: true }, reviewer)
    assert.equal(zero.status, 202, JSON.stringify(zero.json))
    assert.equal(zero.json.pending, true)
    assert.ok(zero.json.pendingActionId > 0)
    const barcode = await post({ product_id: 4, mark: 'no_barcode', set: true }, reviewer)
    assert.equal(barcode.status, 202, JSON.stringify(barcode.json))
    assert.equal(barcode.json.pending, true)
    assert.deepEqual({ marks: marks(), history: history(), audits: markAudits() }, before, 'nothing was applied: no mark, no undo record, no audit row')
    const rows = openRows()
    assert.equal(rows.length, 2)
    assert.deepEqual(rows.map(row => [row.section, row.entity_type, row.entity_id, row.requested_by]), [['products', 'product', 1, 31], ['products', 'product', 4, 31]])
    assert.deepEqual(JSON.parse(rows[0].payload_json), { product_id: 1, mark: 'zero_cost_confirmed', set: true, expected: { cost_price_usd: 0, cost_price_khr: 0 } })
    assert.deepEqual(JSON.parse(rows[1].payload_json), { product_id: 4, mark: 'no_barcode', set: true, expected: { barcode: null } })
    assert.deepEqual(announced.map(event => [event.kind, event.row.section, event.row.action_type, event.row.entity_id]), [['created', 'products', 'conflict_mark', 1], ['created', 'products', 'conflict_mark', 4]],
      'the "created" Telegram alert hook is called once per queued request')
  })

  await check('the retry key: the same request again returns the open one and queues no second row or alert', async () => {
    const again = await post({ product_id: 1, mark: 'zero_cost_confirmed', set: true }, reviewer)
    assert.equal(again.status, 202)
    assert.equal(again.json.pendingActionId, openRows()[0].id)
    assert.equal(again.json.reused, true)
    assert.equal(openRows().length, 2)
    assert.equal(announced.length, 2, 'a reused request announces nothing new')
    const taking = await post({ product_id: 1, mark: 'zero_cost_confirmed', set: false }, reviewer)
    assert.equal(taking.status, 200, 'a request to take back a mark that is not there is a no-op, not a queued row')
    assert.equal(taking.json.changed, false)
    assert.equal(openRows().length, 2)
  })

  await check('refusals: no Products access is 403; a $0 confirmation without the cost grants is 403; a gap that is gone is 409; neither queues', async () => {
    const queued = openRows().length
    assert.equal((await post({ product_id: 5, mark: 'no_barcode', set: true }, noProducts)).status, 403)
    assert.equal((await post({ product_id: 2, mark: 'zero_cost_confirmed', set: true }, reviewerNoCost)).status, 403)
    const gone = await post({ product_id: 1, mark: 'no_barcode', set: true }, reviewer)
    assert.equal(gone.status, 409, 'product 1 has a barcode, so "no barcode" could never apply')
    assert.equal(gone.json.code, 'barcode_present')
    assert.equal(openRows().length, queued)
  })

  await check('approval applies the mark as the reviewer, names the requester, and leaves one audit row and one undo record', async () => {
    const [zeroRow, barcodeRow] = openRows()
    const before = { history: history(), audits: markAudits() }
    await approve(zeroRow)
    await approve(barcodeRow)
    assert.deepEqual(JSON.parse(JSON.stringify(db.prepare('SELECT product_id, mark, marked_by_id, marked_by_name FROM product_conflict_marks ORDER BY product_id').all())), [
      { product_id: 1, mark: 'zero_cost_confirmed', marked_by_id: 7, marked_by_name: 'admin' },
      { product_id: 4, mark: 'no_barcode', marked_by_id: 7, marked_by_name: 'admin' },
    ])
    assert.equal(history(), before.history + 2)
    assert.equal(markAudits(), before.audits + 2)
    const audit = JSON.parse(db.prepare("SELECT details FROM audit_logs WHERE action = 'conflict_mark' AND entity_id = '1'").get().details)
    assert.deepEqual(audit, { via: 'review', mark: 'zero_cost_confirmed', requested_by_id: 31, requested_by_name: 'staff' })
  })

  await check('approval refuses when the cost is no longer the value that was confirmed, even though the product is still listed', async () => {
    const queued = await post({ product_id: 2, mark: 'zero_cost_confirmed', set: true }, reviewer)
    assert.equal(queued.status, 202)
    // The KHR cost changes: the product still holds an unconfirmed $0 USD cost, so only the recorded value can catch it.
    seedStockFixture(db, () => db.prepare('UPDATE products SET cost_price_khr = 4000 WHERE id = 2').run())
    const row = openRows().find(entry => entry.entity_id === 2)
    const before = marks()
    await assert.rejects(approve(row), error => error.name === 'ReviewCodedRefusal' && error.code === 'confirmed_value_changed' && error.status === 409 && /cost changed/.test(error.message))
    assert.equal(marks(), before, 'nothing was written')
    assert.equal(db.prepare('SELECT status FROM pending_actions WHERE id = ?').get(row.id).status, 'open', 'the request stays open for the reviewer to reject')
  })

  await check('approval refuses when the barcode is no longer the value that was confirmed (null became a blank string: still listed)', async () => {
    const queued = await post({ product_id: 5, mark: 'no_barcode', set: true }, reviewer)
    assert.equal(queued.status, 202)
    seedStockFixture(db, () => db.prepare("UPDATE products SET barcode = '' WHERE id = 5").run())
    const row = openRows().find(entry => entry.entity_id === 5)
    const before = marks()
    await assert.rejects(approve(row), error => error.name === 'ReviewCodedRefusal' && error.code === 'confirmed_value_changed' && /barcode changed/.test(error.message))
    assert.equal(marks(), before)
  })

  await check('approval refuses a request whose recorded value is missing, and one whose requester lost the cost grants', async () => {
    const queued = await post({ product_id: 3, mark: 'zero_cost_confirmed', set: true }, reviewer)
    const row = db.prepare('SELECT * FROM pending_actions WHERE id = ?').get(queued.json.pendingActionId)
    const before = marks()
    const stripped = { ...row, payload_json: JSON.stringify({ product_id: 3, mark: 'zero_cost_confirmed', set: true }) }
    await assert.rejects(approve(stripped), error => error.name === 'ReviewCodedRefusal' && error.code === 'review_payload_unreadable')
    setRequesterGrants({ products: 'review', ...MERGE })
    await assert.rejects(approve(row), error => error.code === 'request_permission_revoked')
    setRequesterGrants({ products: 'review', ...MERGE, ...COST })
    assert.equal(marks(), before)
  })

  await check('the reviewer needs cost grants to approve a $0 confirmation, not a barcode mark', async () => {
    const zeroRow = db.prepare("SELECT * FROM pending_actions WHERE action_type = 'conflict_mark' AND entity_id = 3").get()
    const barcodeRow = db.prepare("SELECT * FROM pending_actions WHERE action_type = 'conflict_mark' AND entity_id = 5").get()
    const fullNoCost = role({ products: true, ...MERGE })
    assert.equal((await approvalPermission.reviewApprovalPermissionError(env, fullNoCost, zeroRow)).body.code, 'review_action_full_required')
    assert.equal(await approvalPermission.reviewApprovalPermissionError(env, fullNoCost, barcodeRow), null)
    assert.equal(await approvalPermission.reviewApprovalPermissionError(env, role({ products: true, ...MERGE, ...COST }), zeroRow), null)
    assert.equal((await approvalPermission.reviewApprovalPermissionError(env, reviewer, zeroRow)).body.code, 'review_action_full_required', 'a review-tier account cannot approve')
  })

  await check('Full tier applies directly and queues nothing', async () => {
    const queued = openRows().length
    const announcedBefore = announced.length
    const done = await post({ product_id: 7, mark: 'zero_cost_confirmed', set: true }, full)
    assert.equal(done.status, 200, JSON.stringify(done.json))
    assert.equal(done.json.changed, true)
    assert.equal(done.json.pending, undefined)
    assert.equal(count("SELECT COUNT(*) n FROM product_conflict_marks WHERE product_id = 7"), 1)
    assert.equal(openRows().length, queued)
    assert.equal(announced.length, announcedBefore)
    const audit = JSON.parse(db.prepare("SELECT details FROM audit_logs WHERE action = 'conflict_mark' AND entity_id = '7'").get().details)
    assert.deepEqual(audit, { via: 'conflicts', mark: 'zero_cost_confirmed' })
  })

  // ---- the queue must not tell a reader without product_cost_view that a product costs $0 ----
  const queueApp = h.load('routes/reviewQueue.ts').default
  const queueGet = async (path, user) => {
    h.setUser(user)
    const res = await queueApp.request(`http://local${path}`, { method: 'GET' }, env, { waitUntil: () => {}, passThroughOnException: () => {} })
    return { status: res.status, text: await res.text() }
  }
  const noCostReader = role({ review: true, products: true, ...MERGE })
  const costReader = role({ review: true, products: true, ...MERGE, ...COST })
  const costWords = /\$\s?0|zero_cost|cost_price|"cost|0\.00/i

  await check('summary is neutral: no money in the stored text of a Confirm $0 request', async () => {
    const summaries = db.prepare("SELECT summary FROM pending_actions WHERE action_type = 'conflict_mark'").all().map(row => row.summary)
    assert.ok(summaries.length >= 4)
    for (const summary of summaries) assert.match(summary, /^Confirm conflict for product #\d+$/)
  })

  await check('a reader without cost view sees no cost and no Confirm $0 request anywhere in /api/review (list, targets, detail, mine)', async () => {
    const zeroIds = db.prepare("SELECT id FROM pending_actions WHERE action_type = 'conflict_mark' AND json_extract(payload_json, '$.mark') = 'zero_cost_confirmed'").all().map(row => row.id)
    const barcodeIds = db.prepare("SELECT id FROM pending_actions WHERE action_type = 'conflict_mark' AND json_extract(payload_json, '$.mark') = 'no_barcode'").all().map(row => row.id)
    assert.ok(zeroIds.length >= 2 && barcodeIds.length >= 2, 'fixture: both kinds are queued')
    for (const path of ['/?status=all', '/?status=all&fields=targets', '/?status=open&section=products']) {
      const res = await queueGet(path, noCostReader)
      assert.equal(res.status, 200, path)
      const ids = JSON.parse(res.text).data.map(row => row.id)
      for (const id of zeroIds) assert.ok(!ids.includes(id), `${path}: the $0 request #${id} is hidden`)
      for (const id of barcodeIds) assert.ok(ids.includes(id), `${path}: the barcode request #${id} is still listed`)
      assert.ok(!costWords.test(res.text), `${path}: nothing in the payload mentions a cost: ${res.text.match(costWords)}`)
    }
    for (const id of zeroIds) assert.equal((await queueGet(`/${id}`, noCostReader)).status, 404, 'the detail view is hidden')
    assert.equal((await queueGet(`/${barcodeIds[0]}`, noCostReader)).status, 200)
    // The requester's own list: the same rule once their cost grants are gone.
    setRequesterGrants({ products: 'review', ...MERGE })
    const mine = await queueGet('/mine?status=all', role({ products: 'review', ...MERGE }))
    assert.equal(mine.status, 200)
    for (const id of zeroIds) assert.ok(!JSON.parse(mine.text).data.some(row => row.id === id))
    assert.ok(!costWords.test(mine.text), 'mine: no cost')
    setRequesterGrants({ products: 'review', ...MERGE, ...COST })
    // Positive control: a reader WITH cost view sees the request, so the filter is what hid it.
    const seen = await queueGet('/?status=all', costReader)
    const seenIds = JSON.parse(seen.text).data.map(row => row.id)
    for (const id of zeroIds) assert.ok(seenIds.includes(id), 'control: cost reader sees the $0 request')
    assert.equal((await queueGet(`/${zeroIds[0]}`, costReader)).status, 200)
  })

  await check('a reader without cost view cannot reject or approve a Confirm $0 request, and the request stays open', async () => {
    const zero = db.prepare("SELECT id FROM pending_actions WHERE status = 'open' AND json_extract(payload_json, '$.mark') = 'zero_cost_confirmed' ORDER BY id").get()
    h.setUser(role({ review: true, products: true, ...MERGE }))
    for (const action of ['reject', 'approve']) {
      const res = await queueApp.request(`http://local/${zero.id}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'x' }) }, env, { waitUntil: () => {}, passThroughOnException: () => {} })
      assert.equal(res.status, 404, action)
    }
    assert.equal(db.prepare('SELECT status FROM pending_actions WHERE id = ?').get(zero.id).status, 'open')
  })

  if (failed) { console.error(`${failed} check(s) FAILED`); process.exit(1) }
  console.log('all checks passed')
}

main().catch(error => { console.error(error); process.exit(1) })
