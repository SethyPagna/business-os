'use strict'
// "Last checked" is one rule written in several places. This test runs the new generator (lib/inventoryCheckGrouping.ts lastCheckedSql) and every other copy
// of the rule on the same random worlds and requires them to agree, against an independent JS oracle:
//   1. LATEST_STATE_SQL   (ic_simple checkState filter: ok / issue / not_checked sets)        -> readInventoryCheckProductsSimple
//   2. PAGE_CHECK_CTES    (ic_simple page rows: check_at, check_status)                         -> readInventoryCheckProductsSimple
//   3. the summary obs/latest CTEs (ic_simple counts)                                           -> readInventoryCheckProductsSimple
//   4. LATEST_ITEMS_SQL   (ic_wired state sets)                                                 -> lib/inventoryCheckList.ts
//   5. COUNT_ENTRIES_SQL  (ic_wired overlay)                                                    -> lib/inventoryCheckOverlay.ts
//   6. LATEST             (Set closes an Issue)                                                 -> lib/stockSetClosesIssue.ts
// Worlds: organizations 1, 2 and NULL, two branches, open and closed sessions, items whose branch differs from their session's, ties, the UTC+7 day boundary, one space-separated time.
//
// Run: node scripts/test-inventory-check-latest-rule-parity-native.cjs
const assert = require('node:assert/strict')
const { bundle, buildWorld, adapter } = require('./harness/ic-grouped-world.cjs')

const products = bundle('inventoryCheckProducts.ts')
const grouping = bundle('inventoryCheckGrouping.ts')
const list = bundle('inventoryCheckList.ts')
const overlay = bundle('inventoryCheckOverlay.ts')
const setCloses = bundle('stockSetClosesIssue.ts')
const lowStock = { enabled: true, mode: 'product', threshold: 10 }
const admin = { id: 1, role_code: 'admin', role_permissions: { all: true } }
let passed = 0
const check = async (name, run) => { await run(); passed++; console.log(`PASS ${name}`) }

// Independent oracle: the newest done/issue item of a product in the scope, by (updated_at, session id) text order.
function winners(db, org, branch) {
  const sessions = new Map(db.prepare('SELECT id, organization_id AS org, branch_id AS branch, status FROM inventory_check_sessions').all().map(s => [s.id, s]))
  const out = new Map(), openCheck = new Set()
  for (const item of db.prepare('SELECT session_id, product_id, branch_id, state, updated_at FROM inventory_check_items').all()) {
    const s = sessions.get(item.session_id)
    if (s.org !== org || s.branch !== item.branch_id || (branch !== null && item.branch_id !== branch)) continue
    if (item.state === 'unstarted' && s.status === 'open') openCheck.add(item.product_id)
    if (item.state !== 'done' && item.state !== 'issue') continue
    const best = out.get(item.product_id)
    if (!best || item.updated_at > best.updated_at || (item.updated_at === best.updated_at && item.session_id > best.session_id)) out.set(item.product_id, item)
  }
  return { winner: out, openCheck }
}
const dateOf = (db, sql, org, branch) => {
  const statement = db.prepare(`SELECT p.id AS id, ${sql} AS k FROM products p`); statement.setAllowUnknownNamedParameters(true)
  return new Map(statement.all({ checkOrg: org, ...(branch === null ? {} : { branchId: branch }) }).map(r => [r.id, r.k]))
}

async function main() {
  await check('the generator agrees with every copy of the rule (12 worlds x 3 organizations x 3 branch scopes)', async () => {
    let compared = 0, dated = 0
    for (let seed = 1; seed <= 12; seed++) {
      const { db, leaves } = buildWorld(seed)
      for (const org of [1, 2, null]) for (const branch of [1, 2, null]) {
        const { winner, openCheck } = winners(db, org, branch)
        const gen = dateOf(db, grouping.lastCheckedSql('p.id', branch !== null), org, branch)
        for (const id of leaves) { assert.equal(gen.get(id), winner.get(id)?.updated_at ?? null, `generator, seed ${seed} org ${org} branch ${branch} product ${id}`); compared++; if (winner.has(id)) dated++ }
        // 1-3: the ic_simple reader.
        const read = async query => products.readInventoryCheckProductsSimple(adapter(db), admin, { pageSize: '100', summary: '1', ...query, ...(branch === null ? {} : { branchId: String(branch) }) },
          { lowStock, check: { organizationId: org, viewerId: 1, canSeeStaffIdentity: () => true } })
        const all = await read({})
        const rows = all.items.filter(item => item.checkable)
        assert.equal(all.totalPages, 1)
        for (const row of rows) {
          assert.equal(row.check_at, gen.get(row.id), `PAGE_CHECK_CTES check_at, seed ${seed} org ${org} branch ${branch} product ${row.id}`)
          const status = openCheck.has(row.id) ? 'in_check' : winner.has(row.id) ? (winner.get(row.id).state === 'done' ? 'ok' : 'issue') : 'not_checked'
          assert.equal(row.check_status, status, `check_status, product ${row.id}`); compared++
        }
        for (const state of ['ok', 'issue', 'not_checked']) {
          const filtered = (await read({ checkState: state })).items.filter(item => item.checkable).map(item => item.id).sort((a, b) => a - b)
          const want = rows.filter(row => row.check_status === state).map(row => row.id).sort((a, b) => a - b)
          assert.deepEqual(filtered, want, `LATEST_STATE_SQL ${state}, seed ${seed} org ${org} branch ${branch}`)
          compared += filtered.length
        }
        const counts = all.summary
        assert.equal(counts.ok + counts.issue + counts.in_check + counts.not_checked, counts.total)
        assert.equal(counts.ok, rows.filter(r => r.check_status === 'ok').length, 'summary ok'); assert.equal(counts.issue, rows.filter(r => r.check_status === 'issue').length, 'summary issue')
        // 4-6 are single-branch readers.
        if (branch === null) continue
        const latest = db.prepare(list.LATEST_ITEMS_SQL).all({ organization: org, branchId: branch, limit: 1000 })
        assert.deepEqual(latest.map(r => r.product_id), [...winner.keys()].sort((a, b) => (winner.get(b).updated_at > winner.get(a).updated_at ? 1 : winner.get(b).updated_at < winner.get(a).updated_at ? -1 : 0) || a - b),
          `LATEST_ITEMS_SQL order and set, seed ${seed} org ${org} branch ${branch}`)
        for (const row of latest) { assert.equal(row.state, winner.get(row.product_id).state); assert.equal(gen.get(row.product_id), winner.get(row.product_id).updated_at); compared++ }
        const entries = new Map(db.prepare(overlay.COUNT_ENTRIES_SQL).all({ ids: JSON.stringify(leaves), branchId: branch, organization: org }).map(r => [r.product_id, r]))
        for (const id of leaves) {
          assert.equal(entries.get(id)?.updated_at ?? null, gen.get(id), `COUNT_ENTRIES_SQL, seed ${seed} org ${org} branch ${branch} product ${id}`)
          const one = db.prepare(setCloses.LATEST).get({ organization: org, branch, product: id })
          assert.equal(one?.session_id ?? null, winner.get(id)?.session_id ?? null, `stockSetClosesIssue LATEST, product ${id}`); compared++
        }
      }
    }
    assert.ok(compared > 8000 && dated > 900, `${compared} comparisons, ${dated} dated products`)
  })

  await check('discrimination: three planted defects in the generator disagree with the copies', async () => {
    const mutants = {
      'oldest instead of newest': text => text.replace('ORDER BY i.updated_at DESC', 'ORDER BY i.updated_at ASC'),
      'organization term dropped': text => text.replace('s.organization_id IS @checkOrg AND ', ''),
      'item branch may differ from its session': text => text.replace(' AND s.branch_id=i.branch_id', ''),
      'unstarted counts': text => text.replace("i.state IN ('done','issue')", "i.state IN ('done','issue','unstarted')"),
    }
    for (const [name, mutate] of Object.entries(mutants)) {
      let diverged = false
      for (let seed = 1; seed <= 12 && !diverged; seed++) {
        const { db } = buildWorld(seed)
        for (const org of [1, 2, null]) for (const branch of [1, 2, null]) {
          const { winner } = winners(db, org, branch)
          const gen = dateOf(db, mutate(grouping.lastCheckedSql('p.id', branch !== null)), org, branch)
          for (const [id, value] of gen) if (value !== (winner.get(id)?.updated_at ?? null)) diverged = true
        }
      }
      assert.ok(diverged, `${name} must disagree with the oracle`)
    }
  })
  console.log(`${passed} passed`)
}
main().catch(error => { console.error(error); process.exit(1) })
