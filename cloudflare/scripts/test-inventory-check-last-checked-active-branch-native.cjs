'use strict'
// Owner rule (20 Nov 2026): "Last checked" counts only the active branch. The grouped Inventory Check list leaves out branchId when the shop has one branch, and its date used to be the newest count at ANY
// branch, so a disabled branch's old history (Old Shop) set the date and the order. Now, with exactly ONE active branch and no branchId, the date is the newest count at that branch only. With two or more active
// branches (or none) nothing changes: the newest over the branches, as before. A named branch is a seek on that branch whatever its state.
//   L1 the SQL (lib/inventoryCheckGrouping.ts lastCheckedSql): one active branch ignores an inactive branch's newer counts, two active branches take both, none active takes all, a named branch takes itself
//   L3 reads (D1 meta rows_read, local workerd): with ONE active branch the no-branch statement returns what the branch-scoped one returns, on a world where an inactive branch holds the newest count, and reads no more than it plus a small allowance; with two and three active branches the no-branch answer is the newest over those branches
//   L2 the route (GET /api/inventory-checks/list?groupBy=checked, no branchId): the order and each row's group_key follow the same rule, and flip back when the disabled branch is switched on
// Mutants planted in the Worker source must each be caught.
// Run: node scripts/test-inventory-check-last-checked-active-branch-native.cjs
const assert = require('node:assert/strict')
const { buildWorld } = require('./harness/count-tasks-world.cjs')
const { openWorld } = require('./harness/read-cost-world.cjs')

const failures = []
let passed = 0
async function check(name, run) { try { await run(); passed++; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n     ${String(error && error.stack || error).split('\n').slice(0, 6).join('\n     ')}`) } }

const OLD = '2026-10-01T03:00:00.000Z', MID = '2026-10-10T03:00:00.000Z', NEW = '2026-11-02T03:00:00.000Z'
const NONE_ACTIVE = " OR NOT EXISTS (SELECT 1 FROM branches WHERE is_active = 1)"
const ACTIVE_ONLY = "WHERE br.is_active = 1" + NONE_ACTIVE
const NEWEST = '2026-11-15T03:00:00.000Z'

function world(sourceEdits = {}) {
  const w = buildWorld(sourceEdits)
  const raw = w.raw.db
  raw.exec('PRAGMA foreign_keys=OFF')
  // 105: counted at the active branch only (older). 106: counted at branch 2 only (newer, branch 2 is the one switched off). 107: both (branch 1 older, branch 2 newer). 108: never counted.
  const session = raw.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) VALUES(?,NULL,?,8,'','closed',0,'{}',?,?,?)")
  const item = raw.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at) VALUES(?,?,?,'{}',10,'{}','done',10,NULL,1,8,?)")
  raw.exec("INSERT INTO branches(id,name,is_default,is_active) VALUES(3,'Third',0,0)")
  // 3: a branch that is never active in these cases and holds the NEWEST count of 105, 106 and 107.
  for (const [id, branch, at, product] of [['c1', 1, MID, 105], ['c2', 1, OLD, 107], ['c3', 2, NEW, 106], ['c4', 2, NEW, 107], ['c5', 3, NEWEST, 105], ['c6', 3, NEWEST, 106], ['c7', 3, NEWEST, 107]]) {
    session.run(id, branch, at, at, at)
    item.run(id, product, branch, at)
  }
  raw.exec('PRAGMA foreign_keys=ON')
  return w
}
const setActive = (w, one, two, three = 0) => w.raw.db.exec(`UPDATE branches SET is_active=${one} WHERE id=1; UPDATE branches SET is_active=${two} WHERE id=2; UPDATE branches SET is_active=${three} WHERE id=3`)
const dateOf = (w, branch, ids = [105, 106, 107, 108]) => {
  const grouping = w.app.load('lib/inventoryCheckGrouping.ts')
  const sql = `SELECT p.id AS id, ${grouping.lastCheckedSql('p.id', branch !== null)} AS k FROM products p WHERE p.id IN (${ids.join(',')}) ORDER BY p.id`
  const statement = w.raw.db.prepare(sql); statement.setAllowUnknownNamedParameters(true)
  return Object.fromEntries(statement.all({ checkOrg: null, branchId: branch ?? 0 }).map((row) => [row.id, row.k]))
}

const L1 = async (edits) => {
  const w = world(edits)
  // Branch 3 is inactive in the first three cases and holds the newest count of 105, 106 and 107; branch 2 is inactive in the first and holds NEW.
  setActive(w, 1, 0)
  assert.deepEqual(dateOf(w, null), { 105: MID, 106: null, 107: OLD, 108: null }, 'one active branch: the inactive branches newer counts set nothing')
  assert.deepEqual(dateOf(w, 2), { 105: null, 106: NEW, 107: NEW, 108: null }, 'a named branch is read as named, active or not')
  assert.deepEqual(dateOf(w, 3), { 105: NEWEST, 106: NEWEST, 107: NEWEST, 108: null })
  assert.deepEqual(dateOf(w, 1), { 105: MID, 106: null, 107: OLD, 108: null })
  setActive(w, 1, 1)
  assert.deepEqual(dateOf(w, null), { 105: MID, 106: NEW, 107: NEW, 108: null }, 'two active branches: the newest over those two; the inactive branch 3 (newest of all) sets nothing')
  setActive(w, 0, 1)
  assert.deepEqual(dateOf(w, null), { 105: null, 106: NEW, 107: NEW, 108: null }, 'the other branch alone active: its counts only')
  setActive(w, 1, 1, 1)
  assert.deepEqual(dateOf(w, null), { 105: NEWEST, 106: NEWEST, 107: NEWEST, 108: null }, 'three active branches: the newest over all three')
  setActive(w, 0, 0)
  assert.deepEqual(dateOf(w, null), { 105: NEWEST, 106: NEWEST, 107: NEWEST, 108: null }, 'no active branch: every branch counts, as before')
}

const L2 = async (edits) => {
  const w = world(edits)
  const list = async () => {
    const r = await w.call('admin', 'GET', '/api/inventory-checks/list?groupBy=checked&pageSize=100&summary=0&query=')
    assert.equal(r.status, 200, JSON.stringify(r.json))
    const rows = r.json.items.filter((row) => [105, 106, 107, 108].includes(row.id))
    return rows.map((row) => `${row.id}:${row.group_key}`)
  }
  setActive(w, 1, 0); await w.bumpProducts()
  const one = await list()
  assert.deepEqual(one, ['105:d:2026-10-10', '107:d:2026-10-01', '106:never', '108:never'], 'one active branch: 105 (counted newest at the active branch) leads, 107 follows with its branch-1 day, 106 (counted only at the disabled branch) is never checked')
  setActive(w, 1, 1); await w.bumpProducts()
  const two = await list()
  assert.deepEqual(two, ['106:d:2026-11-02', '107:d:2026-11-02', '105:d:2026-10-10', '108:never'], 'two active branches: the disabled branch is switched back on and its newer counts lead again')
}


// L3: rows read on D1 itself. 300 products, each counted twice at branch 1 (the active one) and twice at branch 2 and once at branch 3 (both switched off, newer). The sole-branch path reads what the scoped statement reads
// (one seek per product); the allowance covers the branches table and the subquery (a handful of rows), far below the extra seek per product (300) the loop over branches costs.
const PRODUCTS = 300, ALLOWANCE = 25
const L3_FIXTURE = [
  'PRAGMA foreign_keys=OFF',
  "INSERT OR IGNORE INTO branches(id,name,is_default,is_active) VALUES(1,'One',1,1)",
  "INSERT OR IGNORE INTO branches(id,name,is_default,is_active) VALUES(2,'Two',0,0)",
  "INSERT OR IGNORE INTO branches(id,name,is_default,is_active) VALUES(3,'Three',0,0)",
  ...[['s1a', 1, '2026-10-01T03:00:00.000Z'], ['s1b', 1, '2026-10-10T03:00:00.000Z'], ['s2a', 2, '2026-11-01T03:00:00.000Z'], ['s2b', 2, '2026-11-02T03:00:00.000Z'], ['s3a', 3, '2026-11-15T03:00:00.000Z']].flatMap(([id, branch, at]) => [
    `INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) VALUES('${id}',NULL,${branch},8,'','closed',0,'{}','${at}','${at}','${at}')`,
    `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<${PRODUCTS}) INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at) SELECT '${id}',x,${branch},'{}',10,'{}','done',10,NULL,1,8,'${at}' FROM n`,
  ]),
]
const bindD1 = (sql) => sql.replace(/@checkOrg/g, '?1').replace(/@branchId/g, '?2')
const L3 = async (edits) => {
  const grouping = world(edits).app.load('lib/inventoryCheckGrouping.ts')
  const d1 = await openWorld(L3_FIXTURE)
  try {
    const read = async (branchScoped, binds) => {
      const r = await d1.db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<${PRODUCTS}) SELECT x AS id, ${bindD1(grouping.lastCheckedSql('n.x', branchScoped))} AS k FROM n ORDER BY x`).bind(...binds).all()
      return { rows: r.meta.rows_read, answer: JSON.stringify(r.results) }
    }
    const setOn = (one, two, three) => d1.db.exec(`UPDATE branches SET is_active=${one} WHERE id=1;UPDATE branches SET is_active=${two} WHERE id=2;UPDATE branches SET is_active=${three} WHERE id=3`)
    await setOn(1, 0, 0)
    const scoped = await read(true, [null, 1]), open = await read(false, [null])
    assert.equal(open.answer, scoped.answer, 'one active branch: the no-branch request returns what the branch-scoped request returns')
    assert.ok(JSON.parse(open.answer).every((row) => row.k === '2026-10-10T03:00:00.000Z'), 'the inactive branches newer counts set nothing')
    assert.ok(open.rows <= scoped.rows + ALLOWANCE, `rows read: no branch ${open.rows} against scoped ${scoped.rows} (allowance ${ALLOWANCE})`)
    await setOn(1, 1, 0)
    assert.ok(JSON.parse((await read(false, [null])).answer).every((row) => row.k === '2026-11-02T03:00:00.000Z'), 'two active branches: the newest over those two')
    await setOn(1, 1, 1)
    assert.ok(JSON.parse((await read(false, [null])).answer).every((row) => row.k === '2026-11-15T03:00:00.000Z'), 'three active branches: the newest over all three')
    await setOn(0, 0, 0)
    assert.ok(JSON.parse((await read(false, [null])).answer).every((row) => row.k === '2026-11-15T03:00:00.000Z'), 'none active: every branch counts')
  } finally { await d1.dispose() }
}

const GROUP = 'lib/inventoryCheckGrouping.ts'
const PLANTS = [
  ['P1 the date takes every branch, active or not (the old rule: the active filter dropped)', { [GROUP]: [[ACTIVE_ONLY, '']] }, ['L1', 'L2']],
  ['P2 active branches only even when none is active (the none-active fallback dropped)', { [GROUP]: [[NONE_ACTIVE, '']] }, ['L1']],
  ['P3 the earlier one-active-branch-only form (two active branches count every branch again)', { [GROUP]: [[NONE_ACTIVE, ' OR (SELECT COUNT(*) FROM branches WHERE is_active = 1) <> 1']] }, ['L1', 'L2']],
  ['P4 always the sole-branch path, also with two active branches (the count test dropped)', { [GROUP]: [['CASE WHEN COUNT(*) = 1 THEN MAX(id) END', 'MAX(id)']] }, ['L1']],
  ['P5 never the sole-branch path (the loop over branches always runs: twice the seeks)', { [GROUP]: [['CASE WHEN ${sole} IS NOT NULL THEN', 'CASE WHEN 0 THEN']] }, ['L3']],
]
const SCENARIOS = { L1, L2, L3 }

async function main() {
  await check('L1 the date: one active branch counts that branch only; two or none keep every branch; a named branch is itself', () => L1({}))
  await check('L2 the grouped list with no branchId follows the rule and flips back when the disabled branch is switched on', () => L2({}))
  await check('L3 one active branch: the no-branch request equals the branch-scoped one and reads no more than it plus a small allowance; two, three and no active branches unchanged', () => L3({}))
  for (const [name, edits, scenarios] of PLANTS) {
    await check(`mutant killed: ${name}`, async () => {
      for (const scenario of scenarios) {
        let caught = false
        try { await SCENARIOS[scenario](edits) } catch (error) { if (/must match once/.test(String(error && error.message))) throw error; caught = true }
        assert.equal(caught, true, `${scenario} did not catch the plant`)
      }
    })
  }
  if (failures.length) { console.error(`FAILED ${failures.length}: ${failures.join('; ')}`); process.exit(1) }
  console.log(`PASS test-inventory-check-last-checked-active-branch-native (${passed})`)
}
main().catch((error) => { console.error(error); process.exit(1) })
