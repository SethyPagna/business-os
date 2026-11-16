'use strict'
// The ic_simple list's check summary and page facts, rewritten so their cost grows with the number of check ITEMS, not sessions x products (lane ic-summary-reads), against the text they replaced.
// REFERENCE is the shipped-before library: the real source with the old SQL put back (obs over `product_id IN (SELECT id FROM cohort)`, the plain-JOIN checkState filter and page CTEs with
// `@branchId IS NULL OR ...`). Both builds read the same random worlds (node:sqlite, every migration replayed; organizations 1, 2 and NULL, branches 1 and 2, open and closed sessions,
// items whose branch differs from their session's, ties, one unstarted line with a NULL time) and the WHOLE response must be deep-equal: summary counts, facets, page rows, check_status/at/note/count, totals, grouping.
// Matrix: every checkState, stockState, search, category and brand filter, all branches and each branch, both groupings, page 1 (summary) and a later page, three users.
// Mutants N1-N10 are planted in the NEW source; each must make the comparison fail.
//
// Run: node scripts/test-inventory-check-summary-differential-native.cjs
const assert = require('node:assert/strict')
const { bundle, bundleMutated, buildWorld, adapter } = require('./harness/ic-grouped-world.cjs')

const BT = '`'
const t = text => text.split('@BT').join(BT)
const lowStock = { enabled: true, mode: 'product', threshold: 10 }
const FIELDS = { inventory_check_show_stock: true, inventory_check_show_barcode: true, inventory_check_show_brand: true, inventory_check_show_category: true, inventory_check_show_received: true }
const admin = { id: 1, role_code: 'admin', role_permissions: { all: true } }
const counter = { id: 2, role_code: 'staff', role_permissions: JSON.stringify({ inventory_checks: true, ...FIELDS }) }
const noStock = { id: 3, role_code: 'staff', role_permissions: JSON.stringify({ inventory_checks: true, inventory_check_show_brand: true }) }

// NEW text -> OLD text, one pair per edit; each NEW text must occur exactly once in the current source.
const revert = [
  [t("const CHECK_ITEMS_SQL = 'inventory_check_items i INDEXED BY inventory_check_items_product_latest CROSS JOIN inventory_check_sessions s ON s.id=i.session_id'"),
    t("const CHECK_ITEMS_SQL = 'inventory_check_items i JOIN inventory_check_sessions s ON s.id=i.session_id'")],
  [t("const checkScopeSql = (branchScoped: boolean) => @BTs.organization_id IS @checkOrg AND i.branch_id=s.branch_id${branchScoped ? ' AND i.branch_id=@branchId' : ''}@BT"),
    t("const checkScopeSql = (_branchScoped: boolean) => @BTs.organization_id IS @checkOrg AND i.branch_id=s.branch_id AND (@branchId IS NULL OR i.branch_id=@branchId)@BT")],
  // The three per-product subqueries read the product through the SET form in the old text.
  [t("    obs AS MATERIALIZED (SELECT i.product_id,i.state,i.updated_at,i.session_id,s.status AS session_status FROM (SELECT DISTINCT id FROM cohort) c CROSS JOIN ${CHECK_ITEMS_SQL}\n      WHERE i.product_id=c.id AND ${checkScopeSql(plan.branchId !== undefined)}),"),
    t("    obs AS MATERIALIZED (SELECT i.product_id,i.state,i.updated_at,i.session_id,s.status AS session_status FROM ${CHECK_ITEMS_SQL}\n      WHERE i.product_id IN (SELECT id FROM cohort) AND ${checkScopeSql(false)}),")],
  [t("    FROM (SELECT DISTINCT id FROM __page) pg CROSS JOIN ${CHECK_ITEMS_SQL} LEFT JOIN users u ON u.id=i.updated_by\n    WHERE i.product_id=pg.id AND i.state IN ('done','issue') AND ${checkScopeSql(branchScoped)}) WHERE rn=1),"),
    t("    FROM ${CHECK_ITEMS_SQL} LEFT JOIN users u ON u.id=i.updated_by\n    WHERE i.state IN ('done','issue') AND i.product_id IN (SELECT id FROM __page) AND ${checkScopeSql(false)}) WHERE rn=1),")],
  [t("  open_check AS (SELECT DISTINCT i.product_id FROM (SELECT DISTINCT id FROM __page) pg CROSS JOIN ${CHECK_ITEMS_SQL}\n    WHERE i.product_id=pg.id AND i.state='unstarted' AND s.status='open' AND ${checkScopeSql(branchScoped)})"),
    t("  open_check AS (SELECT DISTINCT i.product_id FROM ${CHECK_ITEMS_SQL}\n    WHERE i.state='unstarted' AND s.status='open' AND i.product_id IN (SELECT id FROM __page) AND ${checkScopeSql(false)})")],
]

const SHAPES = []
for (const [user, org] of [[admin, 1], [counter, 2], [admin, null], [noStock, 1]]) {
  for (const branch of [null, 1, 2]) {
    const base = branch === null ? {} : { branchId: String(branch) }
    const queries = [{}, { checkState: 'in_check' }, { checkState: 'ok' }, { checkState: 'issue' }, { checkState: 'not_checked' }, { query: 'serum' }, { category: 'Skin' }, { brand: 'B' },
      { groupBy: 'checked' }, { groupBy: 'category' }, { groupBy: 'checked', checkState: 'issue' }, { pageSize: '4', page: '2' }, { pageSize: '4', page: '2', summary: '0' }, { summary: '0' }]
    if (user !== noStock) queries.push({ stockState: 'in_stock' }, { stockState: 'low_stock' }, { stockState: 'out_of_stock' }, { stockState: 'in_stock', checkState: 'ok' }, { query: 'serum', checkState: 'not_checked' })
    for (const query of queries) SHAPES.push({ user, org, query: { ...base, ...query } })
  }
}
const SEEDS = [1, 2, 3, 4, 5, 6, 7]
const worlds = new Map()
const world = seed => { if (!worlds.has(seed)) worlds.set(seed, buildWorld(seed)); return worlds.get(seed) }
const read = (api, db, shape) => api.readInventoryCheckProductsSimple(adapter(db), shape.user, { ...shape.query },
  { lowStock, check: { organizationId: shape.org, viewerId: shape.user.id, canSeeStaffIdentity: () => true } })
const settle = promise => promise.then(value => ({ value }), error => ({ error: { status: error.status, code: error.code, message: String(error.message) } }))

async function firstDifference(api, reference, seeds) {
  let compared = 0
  for (const seed of seeds) {
    const { db } = world(seed)
    for (const shape of SHAPES) {
      const [want, got] = [await settle(read(reference, db, shape)), await settle(read(api, db, shape))]
      try { assert.deepEqual(got, want) } catch (error) { return `seed ${seed} ${JSON.stringify({ org: shape.org, user: shape.user.id, ...shape.query })}\n${String(error.message).split('\n').slice(0, 12).join('\n')}` }
      compared++
    }
  }
  return compared
}

async function main() {
  let passed = 0
  const check = async (name, run) => { await run(); passed++; console.log(`PASS ${name}`) }
  const real = bundle('inventoryCheckProducts.ts')
  const reference = await bundleMutated('inventoryCheckProducts.ts', { 'inventoryCheckProducts.ts': revert })

  await check('the shipped-before text really is the old shape (the reference is not the new code)', async () => {
    const { db } = world(1)
    const sqlOf = async api => { const seen = []; const a = adapter(db); const batch = a.batch.bind(a); a.batch = statements => { seen.push(...statements.map(s => s.sql)); return batch(statements) }
      await api.readInventoryCheckProductsSimple(a, admin, { branchId: '1' }, { lowStock, check: { organizationId: 1, viewerId: 1, canSeeStaffIdentity: () => true } }); return seen.join('\n') }
    const [oldSql, newSql] = [await sqlOf(reference), await sqlOf(real)]
    assert.ok(oldSql.includes('i.product_id IN (SELECT id FROM cohort)') && !oldSql.includes('INDEXED BY'), 'reference keeps the set form without the pin')
    assert.ok(newSql.includes('INDEXED BY inventory_check_items_product_latest') && newSql.includes('CROSS JOIN') && !newSql.includes('@branchId IS NULL OR i.branch_id'), 'new text is pinned with one branch text')
    assert.ok(oldSql.includes('(?1 IS NULL OR i.branch_id=?1)') || oldSql.includes('@branchId IS NULL OR i.branch_id=@branchId'), 'reference keeps the OR text')
  })

  await check('the new summary, page facts and checkState filters equal the old on every world and filter', async () => {
    const result = await firstDifference(real, reference, SEEDS)
    assert.equal(typeof result, 'number', `first difference: ${result}`)
    assert.ok(result > 1400, `${result} comparisons`)
    console.log(`  ${result} full responses compared`)
  })

  await check('the matrix sees real data: counts differ across shapes and every status is present', async () => {
    const seen = { in_check: 0, ok: 0, issue: 0, not_checked: 0 }, statuses = new Set()
    for (const seed of SEEDS) for (const [org, branch] of [[1, null], [1, 1], [2, 2], [null, 1]]) {
      const r = await read(real, world(seed).db, { user: admin, org, query: { ...(branch ? { branchId: String(branch) } : {}), pageSize: '100' } })
      for (const k of Object.keys(seen)) seen[k] += r.summary[k]
      for (const item of r.items) if (item.checkable) statuses.add(item.check_status)
    }
    for (const [k, n] of Object.entries(seen)) assert.ok(n > 0, `${k} is never counted`)
    assert.deepEqual([...statuses].sort(), ['in_check', 'issue', 'not_checked', 'ok'])
  })

  const MUTANTS = {
    N1: ["s.organization_id IS @checkOrg AND i.branch_id=s.branch_id${branchScoped", 'i.branch_id=s.branch_id${branchScoped'],
    N2: ["AND i.branch_id=s.branch_id${branchScoped", "${branchScoped"],
    N3: ["${branchScoped ? ' AND i.branch_id=@branchId' : ''}", "${''}"],
    N4: ['AND ${checkScopeSql(plan.branchId !== undefined)}),', 'AND ${checkScopeSql(false)}),'],
    N5: ["PARTITION BY product_id ORDER BY updated_at DESC,session_id DESC) AS rn", 'PARTITION BY product_id ORDER BY updated_at ASC,session_id DESC) AS rn'],
    N6: ["WHERE state='unstarted' AND session_status='open')", "WHERE state='unstarted')"],
    N7: ["WHERE i.product_id=pg.id AND i.state='unstarted' AND s.status='open'", "WHERE i.product_id=pg.id AND i.state='unstarted'"],
    N8: ["WHERE i.product_id=pg.id AND i.state IN ('done','issue')", "WHERE i.product_id=pg.id AND i.state IN ('done','issue','unstarted')"],
    N9: ["const scoped = params.branchId !== null && params.branchId !== undefined", 'const scoped = false'],
    N10: ["WHERE i.product_id=${id} AND i.state IN ('done','issue') AND ${checkScopeSql(branchScoped)} ORDER BY i.updated_at DESC,i.session_id DESC LIMIT 1", "WHERE i.product_id=${id} AND i.state IN ('done','issue') AND ${checkScopeSql(branchScoped)} ORDER BY i.updated_at DESC,i.session_id ASC LIMIT 1"],
    N11: ["FROM (SELECT DISTINCT id FROM cohort) c CROSS JOIN", "FROM (SELECT DISTINCT id FROM cohort WHERE id % 5 <> 0) c CROSS JOIN"],
  }
  await check('mutants N1-N11 are each caught', async () => {
    const survived = []
    for (const [id, pair] of Object.entries(MUTANTS)) {
      const api = await bundleMutated('inventoryCheckProducts.ts', { 'inventoryCheckProducts.ts': [pair] })
      const result = await firstDifference(api, reference, SEEDS)
      if (typeof result === 'number') survived.push(id)
    }
    assert.deepEqual(survived, [], `mutants that survived: ${survived.join(', ')}`)
  })
  console.log(`${passed} passed`)
}
main().catch(error => { console.error(error); process.exit(1) })
