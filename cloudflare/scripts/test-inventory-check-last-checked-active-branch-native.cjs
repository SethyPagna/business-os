'use strict'
// Owner rule (20 Nov 2026): "Last checked" comes only from the active branch. When the grouped Inventory Check list is asked with no branch named and EXACTLY ONE branch is active, the server answers with the
// branch-scoped statement for that branch (lib/inventoryCheckGrouping.ts lastCheckedSql, the one place the rule lives), so a disabled branch's old history (Old Shop) sets neither the date nor the order.
// With zero, or two or more, active branches nothing changes: production's all-branch statement.
//   L1 the SQL: one active branch ignores an inactive branch's newer counts; two active, none active and three active return production's answer; a named branch is read as named
//   L2 the route (GET /api/inventory-checks/list?groupBy=checked, no branchId): one active branch follows the rule; two active branches give production's keys
//   L3 reads (D1 meta rows_read, local workerd): with ONE active branch the no-branch statement returns what the branch-scoped one returns, on a world where inactive branches hold the newest counts, and reads no more
//      than it plus a small allowance and no more than production's no-branch statement; with two active branches it is production's answer
// Mutants planted in the Worker source must each be caught.
// Run: node scripts/test-inventory-check-last-checked-active-branch-native.cjs
const assert = require('node:assert/strict')
const { buildWorld } = require('./harness/count-tasks-world.cjs')
const { openWorld } = require('./harness/read-cost-world.cjs')

const failures = []
let passed = 0
async function check(name, run) { try { await run(); passed++; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n     ${String(error && error.stack || error).split('\n').slice(0, 6).join('\n     ')}`) } }

const OLD = '2026-10-01T03:00:00.000Z', MID = '2026-10-10T03:00:00.000Z', NEW = '2026-11-02T03:00:00.000Z', NEWEST = '2026-11-15T03:00:00.000Z'

function world(sourceEdits = {}) {
  const w = buildWorld(sourceEdits)
  const raw = w.raw.db
  raw.exec('PRAGMA foreign_keys=OFF')
  // 105: counted at branch 1 (older) and branch 3 (newest). 106: branches 2 (newer) and 3 (newest). 107: branches 1, 2 and 3. 108: never counted.
  const session = raw.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) VALUES(?,NULL,?,8,'','closed',0,'{}',?,?,?)")
  const item = raw.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at) VALUES(?,?,?,'{}',10,'{}','done',10,NULL,1,8,?)")
  raw.exec("INSERT INTO branches(id,name,is_default,is_active) VALUES(3,'Third',0,0)")
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
  setActive(w, 1, 0)
  assert.deepEqual(dateOf(w, null), { 105: MID, 106: null, 107: OLD, 108: null }, 'one active branch: the inactive branches newer counts set nothing')
  assert.deepEqual(dateOf(w, 2), { 105: null, 106: NEW, 107: NEW, 108: null }, 'a named branch is read as named, active or not')
  assert.deepEqual(dateOf(w, 1), { 105: MID, 106: null, 107: OLD, 108: null })
  // A branch whose is_active is NULL is inactive, as in the count list's own branch statements (is_active = 1): one branch at 1 and branch 3 (the newest counts) at NULL is still ONE active branch.
  setActive(w, 1, 0, 'NULL')
  assert.deepEqual(dateOf(w, null), dateOf(w, 1), 'a NULL is_active is inactive: the no-branch answer equals the branch-scoped answer for the branch at 1')
  assert.deepEqual(dateOf(w, null), { 105: MID, 106: null, 107: OLD, 108: null })
  setActive(w, 0, 1)
  assert.deepEqual(dateOf(w, null), { 105: null, 106: NEW, 107: NEW, 108: null }, 'the other branch alone active: its counts only')
  setActive(w, 1, 1)
  assert.deepEqual(dateOf(w, null), { 105: NEWEST, 106: NEWEST, 107: NEWEST, 108: null }, 'two active branches: production, the newest over every branch')
  setActive(w, 1, 1, 1)
  assert.deepEqual(dateOf(w, null), { 105: NEWEST, 106: NEWEST, 107: NEWEST, 108: null }, 'three active branches: production')
  setActive(w, 0, 0)
  assert.deepEqual(dateOf(w, null), { 105: NEWEST, 106: NEWEST, 107: NEWEST, 108: null }, 'no active branch: production')
}

const L2 = async (edits) => {
  const w = world(edits)
  const list = async () => {
    const r = await w.call('admin', 'GET', '/api/inventory-checks/list?groupBy=checked&pageSize=100&summary=0&query=')
    assert.equal(r.status, 200, JSON.stringify(r.json))
    return r.json.items.filter((row) => [105, 106, 107, 108].includes(row.id)).map((row) => `${row.id}:${row.group_key}`)
  }
  setActive(w, 1, 0); await w.bumpProducts()
  assert.deepEqual(await list(), ['105:d:2026-10-10', '107:d:2026-10-01', '106:never', '108:never'], 'one active branch: 105 leads on its branch-1 day, 106 (counted only at disabled branches) is never checked')
  setActive(w, 1, 1); await w.bumpProducts()
  const two = await list()
  assert.deepEqual(two.filter((key) => !key.endsWith('never')).map((key) => key.split(':').slice(1).join(':')), ['d:2026-11-15', 'd:2026-11-15', 'd:2026-11-15'], 'two active branches: production, every branch counts')
  assert.deepEqual(two.filter((key) => key.endsWith('never')), ['108:never'])
}

// L3: rows read on D1 itself. 300 products, each counted twice at branch 1 (the active one), twice at branch 2 and once at branch 3 (both switched off, newer).
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
// Production's no-branch statement, spelled here as the baseline the new one is measured against.
const productionNoBranch = (productId) => `(SELECT MAX(i.updated_at) FROM inventory_check_items i INDEXED BY inventory_check_items_product_latest
    CROSS JOIN inventory_check_sessions s ON s.id=i.session_id
    WHERE i.product_id=${productId} AND i.state IN ('done','issue')
      AND s.organization_id IS @checkOrg AND s.branch_id=i.branch_id)`
const L3 = async (edits) => {
  const grouping = world(edits).app.load('lib/inventoryCheckGrouping.ts')
  const d1 = await openWorld(L3_FIXTURE)
  try {
    const read = async (inner, binds) => {
      const r = await d1.db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<${PRODUCTS}) SELECT x AS id, ${bindD1(inner)} AS k FROM n ORDER BY x`).bind(...binds).all()
      return { rows: r.meta.rows_read, answer: JSON.stringify(r.results) }
    }
    const setOn = (one, two, three) => d1.db.exec(`UPDATE branches SET is_active=${one} WHERE id=1;UPDATE branches SET is_active=${two} WHERE id=2;UPDATE branches SET is_active=${three} WHERE id=3`)
    const mine = () => read(grouping.lastCheckedSql('n.x', false), [null])
    await setOn(1, 0, 0)
    const scoped = await read(grouping.lastCheckedSql('n.x', true), [null, 1]), open = await mine(), production = await read(productionNoBranch('n.x'), [null])
    assert.equal(open.answer, scoped.answer, 'one active branch: the no-branch request returns what the branch-scoped request returns')
    assert.ok(JSON.parse(open.answer).every((row) => row.k === '2026-10-10T03:00:00.000Z'), 'the inactive branches newer counts set nothing')
    assert.ok(open.rows <= scoped.rows + ALLOWANCE, `rows read: no branch ${open.rows} against scoped ${scoped.rows} (allowance ${ALLOWANCE})`)
    assert.ok(open.rows <= production.rows, `rows read: no branch ${open.rows} against production's no-branch statement ${production.rows}`)
    console.log(`     ROWS one active branch, no branch named: now ${open.rows}, scoped ${scoped.rows}, production ${production.rows}`)
    await setOn(1, 1, 0)
    const two = await mine(), twoProduction = await read(productionNoBranch('n.x'), [null])
    assert.equal(two.answer, twoProduction.answer, 'two active branches: production answer')
    assert.ok(JSON.parse(two.answer).every((row) => row.k === '2026-11-15T03:00:00.000Z'))
    assert.ok(two.rows <= twoProduction.rows + ALLOWANCE, `two active branches: ${two.rows} against production ${twoProduction.rows}`)
    console.log(`     ROWS two active branches, no branch named: now ${two.rows}, production ${twoProduction.rows}`)
    await setOn(1, 1, 1)
    assert.ok(JSON.parse((await mine()).answer).every((row) => row.k === '2026-11-15T03:00:00.000Z'), 'three active branches: production')
    await setOn(0, 0, 0)
    assert.ok(JSON.parse((await mine()).answer).every((row) => row.k === '2026-11-15T03:00:00.000Z'), 'none active: production')
  } finally { await d1.dispose() }
}

const GROUP = 'lib/inventoryCheckGrouping.ts'
const PLANTS = [
  ['M1 always the scoped path (the count test dropped: two or no active branches take one branch)', { [GROUP]: [['CASE WHEN COUNT(*) = 1 THEN MAX(id) END', 'MAX(id)']] }, ['L1', 'L2']],
  ['M3 the rule spelled COALESCE(is_active,1) = 1 (a NULL branch counts as active)', { [GROUP]: [["FROM branches WHERE is_active = 1)'", "FROM branches WHERE COALESCE(is_active,1) = 1)'"]] }, ['L1']],
  ['M2 never the scoped path (production: every branch counts, so a disabled branch sets the date)', { [GROUP]: [['CASE WHEN ${sole} IS NOT NULL THEN', 'CASE WHEN 0 THEN']] }, ['L1', 'L2', 'L3']],
]
const SCENARIOS = { L1, L2, L3 }

async function main() {
  await check('L1 the date: one active branch counts that branch only; two, three or none are production; a named branch is itself', () => L1({}))
  await check('L2 the grouped list with no branchId follows the rule and is production with two active branches', () => L2({}))
  await check('L3 one active branch: the no-branch request equals the branch-scoped one and reads no more than it plus a small allowance, nor more than production; two, three and none unchanged', () => L3({}))
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
