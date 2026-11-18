'use strict'
// "Latest" is the most recent COUNT of a product by the time it was counted, everywhere (review of 17 Nov 2026, Medium 2): the list's state and chip day, the overlay's counted / at / by,
// and the Set that closes an Issue. An approval of an OLDER count must never make that count the newer one. The approval flip used to rewrite the item's updated_at (and updated_by) with the
// approval's time, and every "latest" read orders by that column, so a count of 12 Nov approved on the 17th hid an open-session Issue of 13 Nov, and the chip filed it under the older day.
// The flip now leaves the count time and the counter alone (state, reason and revision change; who approved and when is the approval's own record).
//
//   1. the review's scenario, on the real routes over the real migrations (in-memory SQLite);
//   2. a property test: random interleavings of submissions, open-session observations, approvals (in any order) and Sets over 2 products on 3 days, every read compared after every step with an
//      oracle that keeps its own ledger of counts and their times (it never reads updated_at to decide which count is the latest);
//   3. the 0316 backfill: an item an earlier Worker's flip already rewrote is restored to its count time and counter;
//   4. the plans of the three "latest" reads (index 0285, no sort, no scan).
// Each scenario is replayed against the planted old flip and must fail there.
// Run: node scripts/test-inventory-check-latest-count-time-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createLotSetWorld } = require('./harness/lot_set_world.cjs')

const ON = { ic_simple: 'on', ic_fix_stock: 'on', ic_lot_counts: 'on', ic_wired: 'on' }
const failures = []
async function check(name, run) { try { await run(); console.log('PASS ' + name) } catch (error) { failures.push(name); console.error('FAIL ' + name, error) } }

// The flip of the base (round 2): it rewrote the item's time and its updated_by with the approval's.
const OLD_FLIP = { 'lib/inventoryCheckApprovals.ts': [[
  "UPDATE inventory_check_items SET state='done',reason=NULL,revision=revision+1\n      WHERE session_id=@id",
  "UPDATE inventory_check_items SET state='done',reason=NULL,revision=revision+1,updated_by=@actorId,updated_at=@now\n      WHERE session_id=@id"]] }

function kit(sourceEdits) {
  const w = createLotSetWorld({ admin: true, ...(sourceEdits ? { sourceEdits } : {}) })
  const planTier = w.load('lib/planTier.ts'), list = w.load('lib/inventoryCheckList.ts'), overlay = w.load('lib/inventoryCheckOverlay.ts'), closes = w.load('lib/stockSetClosesIssue.ts')
  const world = () => {
    const f = w.world({ switches: ON })
    w.seed(f, "UPDATE branch_batch_stock SET quantity=5 WHERE batch_id=10; UPDATE branch_batch_stock SET quantity=4 WHERE batch_id=11; UPDATE branch_stock SET quantity=9 WHERE product_id=1; UPDATE products SET stock_quantity=9 WHERE id=1;" +
      "INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active) VALUES(2,'Toner','TON',1,0,6,1);" +
      "INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,6);" +
      "INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) VALUES(20,2,'T1','T1','2026-09-03',1,1,1);" +
      "INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(20,1,6);")
    f.raw.exec('UPDATE users SET is_active=0 WHERE id=8') // the sole approver may decide the count he submitted
    return f
  }
  const reset = () => planTier.__resetPlanTierCacheForTests()
  const submit = (f, requestId, lines) => { reset(); return w.call(f, 'POST', '/api/inventory-checks/submissions', { branchId: 1, requestId, lines }) }
  const decide = (f, id, body) => { reset(); return w.call(f, 'POST', `/api/inventory-checks/sessions/${id}/approval`, body) }
  const approvals = f => f.raw.prepare('SELECT * FROM inventory_check_approvals ORDER BY submitted_at, rowid').all()
  const latestRows = f => f.raw.prepare(list.LATEST_ITEMS_SQL).all({ organization: null, branchId: 1, limit: 100 })
  const entries = (f, ids) => f.raw.prepare(overlay.COUNT_ENTRIES_SQL).all({ organization: null, branchId: 1, ids: JSON.stringify(ids) })
  const setLatest = (f, product) => f.raw.prepare(closes.LATEST).get({ organization: null, branch: 1, product })
  return { w, world, submit, decide, approvals, latestRows, entries, setLatest, list, overlay, closes }
}
const khDay = iso => new Date(Date.parse(iso) + 7 * 3600e3).toISOString().slice(0, 10)
/** A count made at `at` (the fixture lifts the trigger that forbids changing a session's started_at, as it should in production: it is the count time). */
function backdateSession(f, id, at, by) {
  try { f.raw.exec('DROP TRIGGER inventory_check_sessions_identity') } catch { /* already lifted */ }
  f.raw.prepare('UPDATE inventory_check_sessions SET started_at=?, updated_at=?, closed_at=CASE WHEN closed_at IS NULL THEN NULL ELSE ? END WHERE id=?').run(at, at, at, id)
  f.raw.prepare('UPDATE inventory_check_items SET updated_at=?' + (by ? ',updated_by=?' : '') + ' WHERE session_id=?').run(...(by ? [at, by, id] : [at, id]))
}

/** The review's scenario: S1 (12 Nov) waits, an open-session observation S2 (13 Nov) says Issue, then S1 is approved: the 13 Nov count stays the latest. */
async function review(k) {
  const f = k.world()
  await k.submit(f, 'lct-o-submit-0001', [{ productId: 2, countedQuantity: 5, seenQuantity: 6 }])
  const s1 = k.approvals(f)[0].session_id
  backdateSession(f, s1, '2026-11-12T03:00:00.000Z', 8)
  reset(k)
  const created = await k.w.call(f, 'POST', '/api/inventory-checks/sessions', { branchId: 1, requestId: 'lct-o-session-001', productIds: [2], title: 'open', scope: {} })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const s2 = created.body.item.id
  const obs = await k.w.call(f, 'PATCH', `/api/inventory-checks/sessions/${s2}/items/2`, { state: 'issue', counted_quantity: 4, reason: 'two missing', expectedRevision: 0, expectedSessionRevision: 0, requestId: 'lct-o-observe-001' })
  assert.equal(obs.status, 200, JSON.stringify(obs.body))
  backdateSession(f, s2, '2026-11-13T03:00:00.000Z')
  const row = () => k.latestRows(f).find(r => r.product_id === 2)
  assert.deepEqual({ state: row().state, day: row().day }, { state: 'issue', day: '2026-11-13' }, 'O1 before the approval')
  const done = await k.decide(f, s1, { decision: 'approve', requestId: 'lct-o-approve-001' })
  assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.approval.status, 'approved')
  assert.deepEqual({ state: row().state, day: row().day }, { state: 'issue', day: '2026-11-13' }, 'O2 after approving the OLDER count the 13 Nov Issue is still the latest and filed under its day')
  const entry = k.entries(f, [2])[0]
  assert.deepEqual({ session: entry.session_id, counted: entry.counted_quantity, at: entry.updated_at }, { session: s2, counted: 4, at: '2026-11-13T03:00:00.000Z' }, 'O3 the overlay shows the 13 Nov count')
  assert.equal(k.setLatest(f, 2).session_id, s2, 'the Set that closes an Issue reads the same latest count')
  // The approved count itself keeps its own time and its counter: only its state changed.
  const flipped = f.raw.prepare('SELECT state,updated_at,updated_by,revision FROM inventory_check_items WHERE session_id=? AND product_id=2').get(s1)
  assert.deepEqual({ state: flipped.state, updated_at: flipped.updated_at, updated_by: flipped.updated_by, revision: flipped.revision }, { state: 'done', updated_at: '2026-11-12T03:00:00.000Z', updated_by: 8, revision: 2 })
}
function reset(k) { k.w.load('lib/planTier.ts').__resetPlanTierCacheForTests() }

/** After an approval the overlay's "by" is still the counter, consistent with "at" being the count time. */
async function counter(k) {
  const f = k.world()
  await k.submit(f, 'lct-c-submit-0001', [{ productId: 2, countedQuantity: 5, seenQuantity: 6 }])
  const id = k.approvals(f)[0].session_id
  backdateSession(f, id, '2026-11-12T03:00:00.000Z', 8)
  assert.equal(k.entries(f, [2])[0].by_name, 'counter-user')
  const done = await k.decide(f, id, { decision: 'approve', requestId: 'lct-c-approve-001' })
  assert.equal(done.status, 200, JSON.stringify(done.body))
  const entry = k.entries(f, [2])[0]
  assert.deepEqual({ by: entry.by_name, at: entry.updated_at }, { by: 'counter-user', at: '2026-11-12T03:00:00.000Z' }, 'the counter and the count time, not the approver and the approval time')
  assert.equal(f.raw.prepare('SELECT decided_by FROM inventory_check_approvals WHERE session_id=?').get(id).decided_by, 7, 'the approver is the approval\'s own record')
}

// ---- the property test ------------------------------------------------------------------------------------------------------------------------------------------------------------
const rng = seed => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 } }
const timeOf = step => new Date(Date.UTC(2026, 10, 12, 1, 0, 0) + step * 7 * 3600e3).toISOString() // 12 Nov 08:00 KH ... 7 hours apart: three Cambodia days in ten steps
const stockOf = (f, product) => Number(f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=1').get(product).quantity)
const lotOf = (f, batch) => Number(f.raw.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=? AND branch_id=1').get(batch).quantity)
const byName = { 7: 'stock-user', 8: 'counter-user' }

async function sequence(k, seed, steps, stats) {
  const f = k.world(), rnd = rng(seed), pick = list => list[Math.floor(rnd() * list.length)]
  const ledger = new Map() // `${session}|${product}` -> { session, product, at, by }: the oracle's own record of every count and when it was made
  const known = new Set()
  const open = new Map() // product -> { id }
  const log = []
  const adopt = (at, by, { only } = {}) => {
    for (const { id } of f.raw.prepare('SELECT id FROM inventory_check_sessions').all()) {
      if (known.has(id)) continue
      known.add(id)
      if (only && !only(id)) continue
      backdateSession(f, id, at, by)
      for (const item of f.raw.prepare("SELECT product_id,state FROM inventory_check_items WHERE session_id=?").all(id)) {
        if (item.state === 'done' || item.state === 'issue') ledger.set(`${id}|${item.product_id}`, { session: id, product: item.product_id, at, by: by ?? 7 })
      }
    }
  }
  const expected = product => [...ledger.values()].filter(entry => entry.product === product
    && ['done', 'issue'].includes(f.raw.prepare('SELECT state FROM inventory_check_items WHERE session_id=? AND product_id=?').get(entry.session, product)?.state))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))[0]
  const verify = (label) => {
    const rows = k.latestRows(f), entries = k.entries(f, [1, 2])
    for (const product of [1, 2]) {
      const want = expected(product), row = rows.find(r => r.product_id === product), entry = entries.find(r => r.product_id === product), set = k.setLatest(f, product)
      const where = `${label} (seed ${seed}) product ${product}: ${log.join(' ')}`
      if (!want) { assert.equal(row, undefined, `${where}: no count, no list row`); assert.equal(entry, undefined, where); assert.equal(set, undefined, where); continue }
      const state = f.raw.prepare('SELECT state FROM inventory_check_items WHERE session_id=? AND product_id=?').get(want.session, product).state
      assert.deepEqual({ state: row?.state, day: row?.day }, { state, day: khDay(want.at) }, `${where}: list state and chip day`)
      assert.deepEqual({ session: entry?.session_id, at: entry?.updated_at, by: entry?.by_name }, { session: want.session, at: want.at, by: byName[want.by] }, `${where}: overlay session, checked-at and by`)
      assert.equal(set?.session_id, want.session, `${where}: the Set's latest count`)
    }
  }
  for (let step = 0; step < steps; step++) {
    const at = timeOf(step), product = pick([1, 2]), op = pick(['submit', 'submit', 'observe', 'approve', 'approve', 'set'])
    if (op === 'submit') {
      const delta = () => pick([-1, 0, 1, 1])
      const lines = product === 1
        ? [{ productId: 1, lots: [10, 11].map(batch => { const seen = lotOf(f, batch); return { batchId: batch, scope: 'lot', counted: Math.max(0, seen + delta()), seen } }) }]
        : [{ productId: 2, countedQuantity: Math.max(0, stockOf(f, 2) + delta()), seenQuantity: stockOf(f, 2) }]
      const made = await k.submit(f, `lct-${seed}-${step}-submit`, lines)
      log.push(`S${product}${made.status === 201 ? '' : '!' + made.status}`)
      if (made.status === 201) adopt(at, 8)
    } else if (op === 'observe') {
      let target = open.get(product)
      if (!target || rnd() < 0.4) {
        reset(k)
        const created = await k.w.call(f, 'POST', '/api/inventory-checks/sessions', { branchId: 1, requestId: `lct-${seed}-${step}-open`, productIds: [product], title: 'open', scope: {} })
        if (created.status !== 201) { log.push(`O${product}!${created.status}`); continue }
        target = { id: created.body.item.id }; open.set(product, target); adopt(at, 7, { only: id => id === target.id })
      }
      const revisions = f.raw.prepare('SELECT i.revision AS item, s.revision AS session FROM inventory_check_items i JOIN inventory_check_sessions s ON s.id=i.session_id WHERE i.session_id=? AND i.product_id=?').get(target.id, product)
      reset(k)
      const observed = await k.w.call(f, 'PATCH', `/api/inventory-checks/sessions/${target.id}/items/${product}`,
        { state: 'issue', counted_quantity: stockOf(f, product) + 1, reason: 'miscount', expectedRevision: revisions.item, expectedSessionRevision: revisions.session, requestId: `lct-${seed}-${step}-observe` })
      log.push(`O${product}${observed.status === 200 ? '' : '!' + observed.status}`)
      if (observed.status === 200) {
        f.raw.prepare('UPDATE inventory_check_items SET updated_at=? WHERE session_id=? AND product_id=?').run(at, target.id, product)
        f.raw.prepare('UPDATE inventory_check_sessions SET updated_at=? WHERE id=?').run(at, target.id)
        ledger.set(`${target.id}|${product}`, { session: target.id, product, at, by: 7 })
      }
    } else if (op === 'approve') {
      const pending = k.approvals(f).filter(row => row.status === 'pending')
      if (!pending.length) { log.push('A-'); continue }
      const row = pick(pending)
      const older = [...ledger.values()].filter(entry => entry.session === row.session_id).some(entry => [...ledger.values()].some(other => other.product === entry.product && other.session !== entry.session && other.at > entry.at))
      const done = await k.decide(f, row.session_id, { decision: 'approve', requestId: `lct-${seed}-${step}-approve` })
      log.push(`A${done.status === 200 ? '' : '!' + done.status}${older ? '(older)' : ''}`)
      if (done.status === 200 && older) stats.olderApproved++
    } else {
      const latest = expected(2), current = stockOf(f, 2)
      const issue = latest && f.raw.prepare('SELECT state,counted_quantity FROM inventory_check_items WHERE session_id=? AND product_id=2').get(latest.session)
      const quantity = issue && issue.state === 'issue' && Number(issue.counted_quantity) !== current ? Number(issue.counted_quantity) : current + 2
      reset(k)
      const done = await k.w.call(f, 'POST', '/api/inventory/adjust', { type: 'set', setScope: 'branch', productId: 2, branchId: 1, batchId: 20, quantity, expectedBranchQuantity: current, reason: 'Physical count', client_request_id: `inventory_set_${seed}_${step}` })
      log.push(`T${done.status === 200 ? (done.body.issue_closed ? '+' : '') : '!' + done.status}`)
      if (done.status === 200) { adopt(at, 7); if (done.body.issue_closed) stats.setClosed++ }
    }
    verify(`after step ${step} (${op})`)
  }
  verify('at the end')
}

async function property(k) {
  const stats = { olderApproved: 0, setClosed: 0 }
  for (let seed = 1; seed <= 14; seed++) await sequence(k, seed, 10, stats)
  // A property that never reaches the interesting case proves nothing.
  assert.ok(stats.olderApproved >= 3, `the interleavings approved an older count after a newer one ${stats.olderApproved} times`)
  console.log(`    (older count approved after a newer one: ${stats.olderApproved}, Issues closed by a Set: ${stats.setClosed})`)
}

/** 0316 restores the count time and counter of an item an earlier Worker's flip already rewrote, and touches nothing else. */
async function backfill(k) {
  const root = path.resolve(__dirname, '..')
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=OFF')
  const files = fs.readdirSync(path.join(root, 'migrations')).filter(name => name.endsWith('.sql')).sort()
  for (const file of files) { if (file.startsWith('0316_')) break; db.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8')) }
  const session = (id, scope, at, by) => db.prepare(`INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) VALUES(?,NULL,1,?,'','closed',0,?,?,?,?)`).run(id, by, scope, at, at, at)
  const item = (id, product, state, at, by) => db.prepare(`INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at) VALUES(?,?,1,'{}',5,'{}',?,4,?,1,?,?)`).run(id, product, state, state === 'issue' ? 'miscount' : null, by, at)
  const approval = (id, status) => db.prepare(`INSERT INTO inventory_check_approvals(session_id,organization_id,branch_id,status,lines,submitted_by,submitted_at,baselines_json${status === 'pending' ? '' : ',decided_by,decided_at,decision_request_id'}) VALUES(?,NULL,1,?,1,8,'2026-11-12T03:00:00.000Z','{}'${status === 'pending' ? '' : ",7,'2026-11-17T03:00:00.000Z','req-0001'"})`).run(id, status)
  const T = '2026-11-12T03:00:00.000Z', LATER = '2026-11-17T04:00:00.000Z'
  session('flipped', '{"membership":"submission"}', T, 8); item('flipped', 1, 'done', LATER, 7); item('flipped', 2, 'done', T, 8); approval('flipped', 'approved')
  session('pending-flipped', '{"membership":"submission"}', T, 8); item('pending-flipped', 1, 'done', LATER, 7); item('pending-flipped', 2, 'issue', T, 8); approval('pending-flipped', 'pending')
  session('open-obs', '{}', T, 8); item('open-obs', 1, 'done', LATER, 7) // an open-session observation made later: its own time and observer, no approval
  session('unflipped', '{"membership":"submission"}', T, 8); item('unflipped', 1, 'issue', T, 8); approval('unflipped', 'pending')
  const before = db.prepare('SELECT session_id,product_id,state,updated_at,updated_by,revision FROM inventory_check_items ORDER BY session_id,product_id').all()
  db.exec(fs.readFileSync(path.join(root, 'migrations', files.find(name => name.startsWith('0316_'))), 'utf8'))
  const after = db.prepare('SELECT session_id,product_id,state,updated_at,updated_by,revision FROM inventory_check_items ORDER BY session_id,product_id').all()
  const key = row => `${row.session_id}|${row.product_id}`, was = new Map(before.map(row => [key(row), row]))
  for (const row of after) {
    const old = was.get(key(row))
    if ((row.session_id === 'flipped' || row.session_id === 'pending-flipped') && row.product_id === 1) assert.deepEqual({ at: row.updated_at, by: row.updated_by, state: row.state, revision: row.revision }, { at: T, by: 8, state: 'done', revision: 1 }, `${key(row)} restored to its count time and counter`)
    else assert.deepEqual(row, old, `${key(row)} untouched`)
  }
  db.close()
}

/** The plans of the three reads: the product's items by index 0285 in count-time order, no scan of the table and no sort. */
async function plans(k) {
  const f = k.world()
  const explain = (sql, params) => f.raw.prepare('EXPLAIN QUERY PLAN ' + sql).all(params).map(row => row.detail)
  const shown = {
    list: explain(k.list.LATEST_ITEMS_SQL, { organization: null, branchId: 1, limit: 100 }),
    overlay: explain(k.overlay.COUNT_ENTRIES_SQL, { organization: null, branchId: 1, ids: '[1,2]' }),
    set: explain(k.closes.LATEST, { organization: null, branch: 1, product: 1 }),
  }
  if (process.env.SHOW_PLANS) for (const [name, plan] of Object.entries(shown)) console.log(name + ':\n  ' + plan.join('\n  '))
  for (const name of ['overlay', 'set']) {
    const text = shown[name].join('\n')
    assert.match(text, /inventory_check_items_product_latest \(product_id=\? AND branch_id=\?\)/, `${name}: the product's items by index 0285`)
    assert.doesNotMatch(text, /SCAN (?!wanted)/, `${name}: no scan (the only driver is the json_each of the ids)`)
    assert.doesNotMatch(text.replace('USE TEMP B-TREE FOR LAST TERM OF ORDER BY', ''), /TEMP B-TREE/, `${name}: the time order is the index's; only the session id tie-break is sorted`)
  }
  // The list reads the branch's checked items by the items-state index from the sessions of the organization (as before: one statement, bounded by inventoryCheckFilterMaxIds). The flip no longer
  // touching updated_at changes no plan: the day and the order read the same column.
  assert.doesNotMatch(shown.list.join('\n'), /SCAN inventory_check_items/)
  assert.match(shown.list.join('\n'), /SEARCH i USING INDEX inventory_check_items_state/)
}

const SCENARIOS = {
  review: { run: review, title: 'Medium 2 (O1-O3): approving an older count leaves the newer open-session Issue the latest (list state, chip day, overlay, Set read) and keeps the approved count\'s time and counter' },
  counter: { run: counter, title: 'the overlay\'s "by" after an approval is the counter, consistent with "at" being the count time' },
  property: { run: property, title: 'property: 14 random interleavings of submissions, observations, approvals in any order and Sets over 2 products on 3 days agree with the oracle after every step' },
}
// Which scenarios the planted old flip must be caught by.
const CAUGHT = ['review', 'counter', 'property']

async function main() {
  for (const { title, run } of Object.values(SCENARIOS)) await check(title, () => run(kit()))
  await check('0316 restores the count time and counter of an item the earlier flip rewrote, and touches nothing else', () => backfill(kit()))
  await check('the three "latest" reads stay index-backed: index 0285, no sort, no scan', () => plans(kit()))
  for (const name of CAUGHT) {
    const mutated = kit(OLD_FLIP) // built outside the try: an edit that no longer matches the source is an error, never a catch
    let caught = false
    try { await SCENARIOS[name].run(mutated) } catch { caught = true }
    await check(`mutant "the flip rewrites the item time and counter" is caught by ${name}`, () => assert.ok(caught, 'the scenario passed against the old flip'))
  }
  if (failures.length) { console.error(`FAILED ${failures.length}: ${failures.join(' | ')}`); process.exit(1) }
  console.log('PASS test-inventory-check-latest-count-time-native')
}
main().catch(error => { console.error(error); process.exit(1) })
