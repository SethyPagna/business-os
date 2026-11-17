// Date chips on the wired Inventory Check list (owner redesign, 17 Nov 2026), over the real routes and migrations:
//   summary.days   one chip per Cambodia business day (UTC+7) on which some product had its LATEST count at the branch, newest first, from the SAME cached sets as the status counts
//   checkedOn      GET /list?branchId=1&checkedOn=YYYY-MM-DD keeps the products whose latest count was that day; strict date, one branch, combines with the status filters
//   statements     the chips cost no D1 statement and no row of their own: the same one latest-items read and one pending read as before, with or without a day
// Mutants (a planted source edit in the loaded module) must be caught by the same assertions: a UTC day instead of the Cambodia day, an extra statement, the latest rule dropped.
// Run: node scripts/test-inventory-check-date-chips-native.cjs
const assert = require('node:assert/strict')
const { createInvApp } = require('./harness/inv-app.cjs')

let checks = 0
function check(label, cond, detail) { if (!cond && detail) console.log(typeof detail === 'function' ? detail() : detail); assert.ok(cond, `FAIL: ${label}`); checks++; console.log(`  ok  ${label}`) }

const MOUNT = { '/api/products': 'routes/products.ts', '/api/inventory-checks/products': 'routes/inventoryCheckProducts.ts', '/api/inventory-checks': 'routes/inventoryChecks.ts' }
function seed(raw, seedStockFixture) {
  seedStockFixture(raw.db, () => {
    for (let id = 100; id <= 105; id++) {
      raw.prepare(`INSERT INTO products(id,name,sku,barcode,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,brand,category,is_active,created_at,updated_at)
        VALUES(?,?,?,?,?,9.5,38000,4,16000,'Brand','Cat',1,?,'2026-09-01 00:00:00')`).run([id, `Product ${id}`, `SKU${id}`, `88500000${id}`, 10, `2026-09-${String(id - 90).padStart(2, '0')} 00:00:00`])
      raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,10)').run([id])
    }
    const session = (id, branch, at) => raw.prepare(`INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,scope_json,started_at,updated_at)
      VALUES(?,NULL,?,72,?,'closed','{}',?,?)`).run([id, branch, `Count ${id}`, at, at])
    const item = (sid, product, branch, state, at) => raw.prepare(`INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at)
      VALUES(?,?,?,?,10,'{}',?,?,?,1,72,?)`).run([sid, product, branch, JSON.stringify({ id: product, name: `P${product}` }), state, state === 'issue' ? 8 : 10, state === 'issue' ? 'Two missing' : null, at])
    // Product 100 was counted on 9 Nov and again on 10 Nov: only its latest count (10 Nov) makes a chip. 23:59:59 UTC+7 on 10 Nov is 16:59:59Z; 17:00:00Z is already 11 Nov in Cambodia.
    session('s0', 1, '2026-11-09T02:00:00.000Z'); item('s0', 100, 1, 'done', '2026-11-09T02:00:00.000Z')
    session('s1', 1, '2026-11-10T16:59:59.000Z'); item('s1', 100, 1, 'done', '2026-11-10T16:59:59.000Z')
    session('s2', 1, '2026-11-10T17:00:00.000Z'); item('s2', 101, 1, 'done', '2026-11-10T17:00:00.000Z')
    // 23:30 UTC on 10 Nov is 06:30 on 11 Nov in Cambodia: the next business day (a UTC day would file it under 10 Nov).
    session('s3', 1, '2026-11-10T23:30:00.000Z'); item('s3', 102, 1, 'issue', '2026-11-10T23:30:00.000Z')
    session('s4', 1, '2026-11-12T01:00:00.000Z'); item('s4', 103, 1, 'done', '2026-11-12T01:00:00.000Z')
    session('s5', 2, '2026-11-12T01:00:00.000Z'); item('s5', 104, 2, 'done', '2026-11-12T01:00:00.000Z')
  })
}
const EXPECTED_DAYS = [{ day: '2026-11-12', count: 1 }, { day: '2026-11-11', count: 2 }, { day: '2026-11-10', count: 1 }]
const itemsOf = (r) => (r.json && r.json.items) || []
const ids = (r) => itemsOf(r).map((x) => x.id).sort((a, b) => a - b).join(',')
// A submitted count approved days later (its item was flipped to Done on 17 Nov and its updated_at rewritten) and a Set that closed the Issue of product 102 on 13 Nov.
function seedApproved(raw, seedStockFixture) {
  seed(raw, seedStockFixture)
  seedStockFixture(raw.db, () => {
    raw.prepare(`INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,scope_json,started_at,updated_at) VALUES('s6',NULL,1,72,'Count s6','closed','{"membership":"submission"}','2026-11-12T03:00:00.000Z','2026-11-17T03:00:00.000Z')`).run()
    raw.prepare(`INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at) VALUES('s6',105,1,'{}',10,'{}','done',8,NULL,2,72,'2026-11-17T03:00:00.000Z')`).run()
    raw.prepare(`INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,scope_json,started_at,updated_at) VALUES('s7',NULL,1,72,'Set from Inventory','closed','{"membership":"stock_set","operation":"op1"}','2026-11-13T02:00:00.000Z','2026-11-13T02:00:00.000Z')`).run()
    raw.prepare(`INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at) VALUES('s7',102,1,'{}',8,'{}','done',8,NULL,1,72,'2026-11-13T02:00:00.000Z')`).run()
  })
}
const make = (sourceEdits = {}, seedWith = seed) => {
  const app = createInvApp({ mount: MOUNT, seed: seedWith, sourceEdits })
  app.setSwitch('ic_wired', 'on'); app.setSwitch('ic_fix_stock', 'on')
  return app
}
const STATEMENT = /inventory_check_(items|sessions|approvals)/

;(async () => {
  const app = make(), U = app.users
  app.setUser(U.checker); app.clearCaches()
  const whole = await app.get('/api/inventory-checks/list?branchId=1')
  check('/list answers 200 with summary.days, newest day first, each product under the Cambodia day of its LATEST count', whole.status === 200 && JSON.stringify(whole.json.summary.days) === JSON.stringify(EXPECTED_DAYS), () => JSON.stringify(whole.json.summary))
  check('the status counts beside it are unchanged (3 counted, 1 issue)', whole.json.summary.ok === 3 && whole.json.summary.issue === 1)
  const overlay = await app.get('/api/inventory-checks/overlay?branchId=1&ids=100,101')
  check('/overlay carries the same days under the same rule', overlay.status === 200 && JSON.stringify(overlay.json.summary.days) === JSON.stringify(EXPECTED_DAYS))
  const noSummary = await app.get('/api/inventory-checks/list?branchId=1&summary=0'), noOverlay = await app.get('/api/inventory-checks/overlay?branchId=1&ids=100&summary=0')
  check('summary=0 leaves the days out of both answers', !('summary' in noSummary.json) && !('summary' in noOverlay.json))
  const noBranch = await app.get('/api/inventory-checks/list')
  check('all branches: no chips (the counts are per branch)', !('summary' in noBranch.json) || !('days' in (noBranch.json.summary || {})))
  const other = await app.get('/api/inventory-checks/list?branchId=2')
  check('another branch has its own days', JSON.stringify(other.json.summary.days) === JSON.stringify([{ day: '2026-11-12', count: 1 }]))

  // ---- the filter -------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const day = (d, extra = '') => app.get(`/api/inventory-checks/list?branchId=1&checkedOn=${d}${extra}`)
  check('checkedOn keeps the products whose latest count was that day (11 Nov: 101 and 102)', ids(await day('2026-11-11')) === '101,102')
  check('a count at 23:30 UTC belongs to the next Cambodia day: 102 is under 11 Nov, not 10 Nov', ids(await day('2026-11-10')) === '100')
  check('only the LATEST count counts: product 100 counted on 9 Nov and again on 10 Nov is not under 9 Nov', ids(await day('2026-11-09')) === '')
  check('the first Cambodia minute of a day: 17:00:00Z is 11 Nov, 16:59:59Z is 10 Nov', ids(await day('2026-11-11')).includes('101') && ids(await day('2026-11-10')) === '100')
  check('it combines with a check state: issues on 11 Nov (102), counted on 11 Nov (101), not checked on a day is nothing', ids(await day('2026-11-11', '&checkState=issue')) === '102' && ids(await day('2026-11-11', '&checkState=ok')) === '101' && ids(await day('2026-11-11', '&checkState=not_checked')) === '')
  const total = await day('2026-11-11')
  check('the page total is the day\'s own, and the page says it is filtered (no Not checked figure)', total.json.total === 2 && !('not_checked' in total.json.summary))
  check('it combines with a search', ids(await day('2026-11-11', '&query=Product%20101')) === '101')
  check('a day with no count is an empty page, not an error', (await day('2026-12-31')).status === 200 && ids(await day('2026-12-31')) === '')
  // A cached page of one day never serves another.
  check('two days do not share a cached page', ids(await day('2026-11-12')) === '103' && ids(await day('2026-11-11')) === '101,102' && ids(await day('2026-11-12')) === '103')

  // ---- strict validation ------------------------------------------------------------------------------------------------------------------------------------------------------------------
  for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-11-31', '2026-1-1', '20261111', '2026-11-11T00:00:00Z', 'today', '%20', '0000-01-01', '2026-11-1a', '2026/11/11']) {
    const r = await app.get(`/api/inventory-checks/list?branchId=1&checkedOn=${bad}`)
    if (bad === '%20') { check('a blank day is no filter (like any blank key)', r.status === 200); continue }
    check(`${bad}: 400 inventory_check_invalid_query naming checkedOn`, r.status === 400 && r.json.code === 'inventory_check_invalid_query' && r.json.parameter === 'checkedOn', () => JSON.stringify([r.status, r.json]))
  }
  check('surrounding spaces are trimmed like every other key (the date itself stays strict)', ids(await day('2026-11-11%20')) === '101,102')
  check('a leap day is a day (2028-02-29) and 2026-02-29 is not', (await day('2028-02-29')).status === 200 && (await day('2026-02-29')).status === 400)
  const needsBranch = await app.get('/api/inventory-checks/list?checkedOn=2026-11-11'), withIds = await day('2026-11-11', '&ids=100')
  check('a day needs one branch (400 naming branchId) and cannot be combined with ids', needsBranch.status === 400 && needsBranch.json.parameter === 'branchId' && withIds.status === 400 && withIds.json.parameter === 'ids')
  check('a repeated key is refused', (await app.get('/api/inventory-checks/list?branchId=1&checkedOn=2026-11-11&checkedOn=2026-11-12')).status === 400)

  // ---- no new statement -------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const cold = async (url, a = app) => { a.clearCaches(); const mark = a.mark(); const r = await a.get(url); return { r, n: a.since(mark).filter((sql) => STATEMENT.test(sql)).length } }
  const base = await cold('/api/inventory-checks/list?branchId=1')
  const withDay = await cold('/api/inventory-checks/list?branchId=1&checkedOn=2026-11-11')
  const withState = await cold('/api/inventory-checks/list?branchId=1&checkState=ok')
  const ov = await cold('/api/inventory-checks/overlay?branchId=1&ids=100,101')
  check(`/list reads the check-state sets with exactly 2 Inventory Check statements (latest items, pending lines): ${base.n}`, base.n === 2, String(base.n))
  check('a day filter adds none, and neither does the status filter', withDay.n === base.n && withState.n === base.n, `${withDay.n} ${withState.n}`)
  check('/overlay runs its own batch of count entries, pending lines and the sets: no more than before the chips (count entries, pending lines, latest items, pending lines)', ov.n === 4, String(ov.n))
  // the second read of the same version is a hit (the sets are cached by the inventory_checks version): no Inventory Check set statement at all
  const mark = app.mark(); await app.get('/api/inventory-checks/list?branchId=1&checkedOn=2026-11-10')
  check('the sets are cached by version: another day of the same branch reads no check-state statement', app.since(mark).filter((sql) => /ROW_NUMBER\(\) OVER \(PARTITION BY i\.product_id/.test(sql)).length === 0)

  // ---- the day is the day the product was COUNTED, never the day an approval rewrote the item ----------------------------------------------------------------------------------------------
  const EXPECTED_APPROVED = [{ day: '2026-11-13', count: 1 }, { day: '2026-11-12', count: 2 }, { day: '2026-11-11', count: 1 }, { day: '2026-11-10', count: 1 }]
  const countDay = async (a) => { a.setUser(a.users.checker); a.clearCaches(); return a.get('/api/inventory-checks/list?branchId=1') }
  const approved = make({}, seedApproved)
  const approvedList = await countDay(approved)
  check('a count made on 12 Nov and approved on 17 Nov is under 12 Nov, not 17 Nov (the approval rewrote the item time)', JSON.stringify(approvedList.json.summary.days) === JSON.stringify(EXPECTED_APPROVED), () => JSON.stringify(approvedList.json.summary))
  check('a Set that closed an Issue is its own time (13 Nov), as an observation is', approvedList.json.summary.days[0].day === '2026-11-13')
  const onCountDay = await approved.get('/api/inventory-checks/list?branchId=1&checkedOn=2026-11-12'), onApprovalDay = await approved.get('/api/inventory-checks/list?branchId=1&checkedOn=2026-11-17')
  check('checkedOn is the count day too: 12 Nov keeps 103 and 105, the approval day 17 Nov keeps nothing', ids(onCountDay) === '103,105' && ids(onApprovalDay) === '')
  const approvedOverlay = await approved.get('/api/inventory-checks/overlay?branchId=1&ids=105,102')
  const at = Object.fromEntries(approvedOverlay.json.items.map((e) => [e.product_id, e.check && e.check.at]))
  check('the overlay\'s checked-at time is the count time (12 Nov for the submitted count, 13 Nov for the Set), and its days agree with the list', at[105] === '2026-11-12T03:00:00.000Z' && at[102] === '2026-11-13T02:00:00.000Z' && JSON.stringify(approvedOverlay.json.summary.days) === JSON.stringify(EXPECTED_APPROVED), () => JSON.stringify([at, approvedOverlay.json.summary]))
  const coldApproved = await cold('/api/inventory-checks/list?branchId=1', approved)
  check('the count day costs no statement: the same 2 Inventory Check statements', coldApproved.n === 2, String(coldApproved.n))

  // ---- checkedOn belongs to the wired list only ------------------------------------------------------------------------------------------------------------------------------------------------
  const refusesDay = async (a) => {
    a.setUser(a.users.checker); a.setSwitch('ic_simple', 'on')
    const scoped = await a.send('POST', '/api/inventory-checks/sessions', { branchId: 1, requestId: 'scope-day-00001', productIds: [100], scope: { checkedOn: '2026-11-12' } })
    const older = await a.get('/api/inventory-checks/products?branchId=1&checkedOn=2026-11-12')
    return { scoped, older }
  }
  const refused = await refusesDay(approved)
  check('a session created from a scope that names a check day is refused (400 naming checkedOn), never accepted and ignored', refused.scoped.status === 400 && refused.scoped.json.code === 'inventory_check_invalid_query' && refused.scoped.json.parameter === 'checkedOn', () => JSON.stringify([refused.scoped.status, refused.scoped.json]))
  check('so is the older products list', refused.older.status === 400 && refused.older.json.parameter === 'checkedOn', () => JSON.stringify([refused.older.status, refused.older.json]))
  const stillList = await approved.get('/api/inventory-checks/list?branchId=1&checkedOn=2026-11-12')
  check('while the wired list keeps the filter', stillList.status === 200 && ids(stillList) === '103,105')

  // ---- mutants: the same assertions go red ------------------------------------------------------------------------------------------------------------------------------------------------
  const run = async (name, edits, probe, seedWith = seed) => {
    const mutant = make(edits, seedWith)
    let caught = false
    try { caught = await probe(mutant) } catch { caught = true }
    check(`mutant "${name}" is caught`, caught === true)
  }
  const LIST = 'lib/inventoryCheckList.ts'
  const DAY = "${localDateExpr(`CASE WHEN json_extract(scope_json, '$.membership') = 'submission' THEN started_at ELSE updated_at END`)}"
  await run('a UTC day instead of the Cambodia day', { [LIST]: [[DAY, "substr(CASE WHEN json_extract(scope_json, '$.membership') = 'submission' THEN started_at ELSE updated_at END, 1, 10)"]] }, async (m) => {
    m.setUser(m.users.checker); const r = await m.get('/api/inventory-checks/list?branchId=1'); return JSON.stringify(r.json.summary.days) !== JSON.stringify(EXPECTED_DAYS)
  })
  await run('an extra statement for the chips', { [LIST]: [["const pending = withPending ?", "await db.prepare('SELECT COUNT(*) AS n FROM inventory_check_items').all(); const pending = withPending ?"]] }, async (m) => {
    m.setUser(m.users.checker); const r = await cold('/api/inventory-checks/list?branchId=1', m); return r.n !== 2
  })
  await run('every count of a product, not its latest', { [LIST]: [['WHERE rn = 1 ORDER BY updated_at DESC', 'ORDER BY updated_at DESC']] }, async (m) => {
    m.setUser(m.users.checker); const r = await m.get('/api/inventory-checks/list?branchId=1&checkedOn=2026-11-09'); return ids(r) !== ''
  })
  await run('the approval day instead of the count day (the item time for every session)', { [LIST]: [["CASE WHEN json_extract(scope_json, '$.membership') = 'submission' THEN started_at ELSE updated_at END", 'updated_at']] }, async (m) => {
    const r = await countDay(m); return JSON.stringify(r.json.summary.days) !== JSON.stringify(EXPECTED_APPROVED)
  }, seedApproved)
  await run('the overlay shows the approval time as the checked-at time', { 'lib/inventoryCheckOverlay.ts': [["CASE WHEN json_extract(s.scope_json, '$.membership') = 'submission' THEN s.started_at ELSE i.updated_at END AS updated_at", 'i.updated_at AS updated_at']] }, async (m) => {
    m.setUser(m.users.checker); const r = await m.get('/api/inventory-checks/overlay?branchId=1&ids=105'); return r.json.items[0].check.at !== '2026-11-12T03:00:00.000Z'
  }, seedApproved)
  await run('checkedOn accepted again by the ic_simple callers (and ignored)', { 'lib/inventoryCheckAccess.ts': [["'checkState', 'page',", "'checkState', 'checkedOn', 'page',"]] }, async (m) => {
    const r = await refusesDay(m); return r.scoped.status !== 400 || r.older.status !== 400
  }, seedApproved)
  console.log(`PASS test-inventory-check-date-chips-native (${checks} checks)`)
  process.exit(0)
})().catch((error) => { console.error(error); process.exit(1) })
