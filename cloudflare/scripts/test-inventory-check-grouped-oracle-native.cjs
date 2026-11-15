'use strict'
// Grouped Inventory Check list (ic_simple, groupBy=checked|category) against an independent JS oracle on random worlds (node:sqlite, real migrations through 0285).
//   G1 same rows as the name-ordered read (nothing missing, nothing doubled)     G2 group totals add up to total (families) and summary.total (products)
//   G3 totals do not depend on page or pageSize                                  G4 every row's group_key equals the key computed here from raw items
//   G6 the read writes nothing
// The oracle rebuilds the cohort from the name-ordered reader's rows, then applies the rules from the raw tables: a family's date is the MAX over its rows of the
// newest done/issue item (organization, session branch and chosen branch honoured), the day is UTC+7, "never" and "no category" last, ties by lowercased name then family key.
// Mutants M1-M12 are planted in the library source and must each be caught.
//
// Run: node scripts/test-inventory-check-grouped-oracle-native.cjs
const assert = require('node:assert/strict')
const { bundle, bundleMutated, buildWorld, adapter } = require('./harness/ic-grouped-world.cjs')

const lowStock = { enabled: true, mode: 'product', threshold: 10 }
const FIELDS = { inventory_check_show_stock: true, inventory_check_show_barcode: true, inventory_check_show_brand: true, inventory_check_show_category: true, inventory_check_show_received: true }
const admin = { id: 1, role_code: 'admin', role_permissions: { all: true } }
const noCategory = { id: 3, role_code: 'staff', role_permissions: JSON.stringify({ inventory_checks: true, inventory_check_show_stock: true, inventory_check_show_brand: true }) }
const counter = { id: 2, role_code: 'staff', role_permissions: JSON.stringify({ inventory_checks: true, ...FIELDS }) }

const asciiLower = text => text.replace(/[A-Z]/g, c => c.toLowerCase())
const trimSpaces = text => text.replace(/^ +| +$/g, '')
const bytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))
const dayOf = at => new Date(Date.parse(at.includes('T') ? at : at.replace(' ', 'T') + 'Z') + 7 * 3600000).toISOString().slice(0, 10)

function newestChecks(db, org, branch) {
  const sessions = new Map(db.prepare('SELECT id, organization_id AS org, branch_id AS branch FROM inventory_check_sessions').all().map(s => [s.id, s]))
  const best = new Map()
  for (const item of db.prepare('SELECT session_id, product_id, branch_id, state, updated_at FROM inventory_check_items').all()) {
    const s = sessions.get(item.session_id)
    if (s.org !== org || s.branch !== item.branch_id || (branch !== null && item.branch_id !== branch)) continue
    if (item.state !== 'done' && item.state !== 'issue') continue
    if (!best.has(item.product_id) || item.updated_at > best.get(item.product_id)) best.set(item.product_id, item.updated_at)
  }
  return best
}

// The expected grouped read for one world, scope and pager, from the name-ordered rows.
function expectedRead(db, nameRows, by, org, branch, page, pageSize) {
  const dates = newestChecks(db, org, branch)
  const info = new Map(db.prepare(`SELECT p.id AS id, p.parent_id AS parent_id, p.category AS category,
      COALESCE(NULLIF(COALESCE(parent.name_key,p.name_key),''),'id:'||COALESCE(parent.id,p.id)) AS k, lower(trim(COALESCE(parent.name,p.name))) AS n
    FROM products p LEFT JOIN products parent ON parent.id=p.parent_id`).all().map(r => [r.id, r]))
  const leaves = nameRows.filter(row => row.checkable).map(row => row.id)
  const families = new Map()
  for (const id of leaves) {
    const row = info.get(id), f = families.get(row.k) || { k: row.k, n: row.n, ids: [], date: null, cat: null, firstCat: new Map() }
    f.ids.push(id)
    const at = dates.get(id) ?? null
    if (at !== null && (f.date === null || at > f.date)) f.date = at
    const norm = row.category === null ? null : (trimSpaces(asciiLower(String(row.category))) || null)
    if (norm !== null && (f.cat === null || bytes(norm, f.cat) < 0)) f.cat = norm
    if (norm !== null && !f.firstCat.has(norm)) f.firstCat.set(norm, trimSpaces(String(row.category)))
    families.set(row.k, f)
  }
  const keyOf = f => by === 'checked' ? (f.date === null ? 'never' : `d:${dayOf(f.date)}`) : (f.cat === null ? 'none' : `c:${f.cat}`)
  const sortKey = f => by === 'checked' ? f.date : f.cat
  const ordered = [...families.values()].sort((a, b) => {
    const ka = sortKey(a), kb = sortKey(b)
    if ((ka === null) !== (kb === null)) return ka === null ? 1 : -1
    if (ka !== null && ka !== kb) return by === 'checked' ? (ka < kb ? 1 : -1) : bytes(ka, kb)
    return bytes(a.n, b.n) || bytes(a.k, b.k)
  })
  const totals = new Map()
  ordered.forEach((f, index) => { const key = keyOf(f), g = totals.get(key) || { key, families: 0, products: 0, first: index + 1, last: index + 1 }; g.families++; g.products += f.ids.length; g.last = index + 1; totals.set(key, g) })
  const slice = ordered.slice((page - 1) * pageSize, page * pageSize), items = [], seenHeader = new Set()
  for (const f of slice) for (const id of f.ids.sort((a, b) => a - b)) {
    const parent = info.get(id).parent_id
    if (parent && !seenHeader.has(parent)) { seenHeader.add(parent); items.push({ id: parent, group_key: keyOf(f) }) }
    items.push({ id, group_key: keyOf(f) })
  }
  const present = [...new Set(slice.map(keyOf))]
  const offset = (page - 1) * pageSize
  const groups = present.map(key => {
    const g = totals.get(key), first = slice.find(f => keyOf(f) === key)
    const label = by === 'category' && key !== 'none' ? [...families.values()].filter(f => keyOf(f) === key && slice.includes(f)).map(f => f.firstCat.get(f.cat)).find(Boolean) ?? null : null
    return { key, label, families: g.families, products: g.products, continued_before: g.first < offset + 1, continues_after: g.last > offset + pageSize, _first: first }
  }).map(({ _first, ...g }) => g)
  return { items, groups, total: ordered.length, products: leaves.length, totals }
}

async function main() {
  const real = bundle('inventoryCheckProducts.ts')
  let passed = 0
  const check = async (name, run) => { await run(); passed++; console.log(`PASS ${name}`) }

  const readAll = async (api, db, user, query, org) => {
    const items = [], first = await api.readInventoryCheckProductsSimple(adapter(db), user, { ...query }, { lowStock, check: { organizationId: org, viewerId: user.id, canSeeStaffIdentity: () => true } })
    return { first, items }
  }

  // The matrix. Every shape is run on every world; a mutant needs only one of them to diverge.
  const SHAPES = [
    { user: admin, org: 1, branch: null, query: {} }, { user: admin, org: 1, branch: 1, query: {} }, { user: admin, org: 1, branch: 2, query: {} },
    { user: counter, org: 1, branch: 1, query: { query: 'serum' } }, { user: admin, org: 1, branch: null, query: { category: 'Skin' } },
    { user: admin, org: 1, branch: 1, query: { stockState: 'in_stock' } }, { user: admin, org: 1, branch: null, query: { checkState: 'issue' } },
    { user: admin, org: 1, branch: 2, query: { checkState: 'not_checked' } }, { user: counter, org: 2, branch: null, query: {} }, { user: admin, org: null, branch: 1, query: {} },
  ]
  async function runWorld(api, seed, { stopAtFirstDiff = false } = {}) {
    const { db } = buildWorld(seed)
    let compared = 0
    for (const shape of SHAPES) {
      const base = { ...shape.query, ...(shape.branch === null ? {} : { branchId: String(shape.branch) }) }
      // The name-ordered read (the pre-existing path, never mutated) is the cohort.
      const nameRows = []
      for (let page = 1; ; page++) {
        const r = await real.readInventoryCheckProductsSimple(adapter(db), shape.user, { ...base, pageSize: '100', page: String(page), summary: '0' }, { lowStock, check: { organizationId: shape.org, viewerId: shape.user.id, canSeeStaffIdentity: () => true } })
        nameRows.push(...r.items); if (page >= r.totalPages) break
      }
      for (const by of ['checked', 'category']) for (const pageSize of shape === SHAPES[0] ? [1, 4, 100] : [4, 100]) { // one family per page makes every tie decide which family is on which page
        const probe = expectedRead(db, nameRows, by, shape.org, shape.branch, 1, pageSize)
        const pages = Math.max(1, Math.ceil(probe.total / pageSize)) + 1 // one past the end
        const everyItem = []
        for (let page = 1; page <= pages; page++) {
          const before = db.prepare('SELECT total_changes() AS n').get().n
          const got = await api.readInventoryCheckProductsSimple(adapter(db), shape.user, { ...base, groupBy: by, pageSize: String(pageSize), page: String(page), summary: page === 1 ? '1' : '0' },
            { lowStock, check: { organizationId: shape.org, viewerId: shape.user.id, canSeeStaffIdentity: () => true } })
          assert.equal(db.prepare('SELECT total_changes() AS n').get().n, before, 'G6 the read writes nothing')
          const want = expectedRead(db, nameRows, by, shape.org, shape.branch, page, pageSize)
          const ctx = `seed ${seed} ${JSON.stringify({ ...base, by, pageSize, page })} org ${shape.org}`
          assert.deepEqual(got.items.map(item => ({ id: item.id, group_key: item.group_key })), want.items, `rows, group_key and order (G4) ${ctx}`)
          assert.equal(got.total, want.total, `total ${ctx}`)
          assert.deepEqual(got.grouping, { by, unit: 'family', groups: want.groups }, `groups ${ctx}`)
          if (page === 1) assert.equal(got.summary?.total ?? want.products, want.products, `summary.total ${ctx}`)
          everyItem.push(...got.items.filter(item => item.checkable).map(item => item.id))
          compared += got.items.length
        }
        assert.deepEqual([...everyItem].sort((a, b) => a - b), nameRows.filter(r => r.checkable).map(r => r.id).sort((a, b) => a - b), `G1 same rows as the name order, seed ${seed} ${by}`)
        // G2 over the whole scope, G3 the totals are the same at both page sizes (checked above against the same oracle totals).
        assert.equal([...probe.totals.values()].reduce((n, g) => n + g.families, 0), probe.total); assert.equal([...probe.totals.values()].reduce((n, g) => n + g.products, 0), probe.products)
      }
    }
    return compared
  }

  const only = process.env.ONLY_MUTANTS ? process.env.ONLY_MUTANTS.split(',') : null
  if (!only) await check('real code: grouped pages equal the oracle on every world, scope and pager (G1-G4, G6)', async () => {
    let compared = 0
    for (let seed = 1; seed <= 5; seed++) compared += await runWorld(real, seed)
    assert.ok(compared > 1500, `${compared} rows compared`)
  })

  if (!only) await check('refusals: sort beside groupBy, a session, a bad value, and category without the grant', async () => {
    const { db } = buildWorld(3)
    const run = (user, query, check = {}) => real.readInventoryCheckProductsSimple(adapter(db), user, query, { lowStock, check: { organizationId: 1, viewerId: user.id, canSeeStaffIdentity: () => true, ...check } })
    const refused = async (promise, status, code, parameter) => assert.rejects(promise, e => { assert.equal(e.status, status); assert.equal(e.code, code); assert.equal(e.parameter, parameter); return true })
    await refused(run(admin, { groupBy: 'checked', sortBy: 'name' }), 400, 'inventory_check_invalid_query', 'sortBy')
    await refused(run(admin, { groupBy: 'checked', sortDirection: 'desc' }), 400, 'inventory_check_invalid_query', 'sortDirection')
    await refused(run(admin, { groupBy: 'brand' }), 400, 'inventory_check_invalid_query', 'groupBy')
    await refused(run(admin, { groupBy: 'checked' }, { sessionId: 's00' }), 400, 'inventory_check_invalid_query', 'groupBy')
    await refused(run(noCategory, { groupBy: 'category' }), 403, 'inventory_check_field_hidden', 'groupBy')
    assert.ok((await run(noCategory, { groupBy: 'checked' })).grouping, 'the checked grouping needs no category grant')
  })

  const MUTANTS = {
    M1: ['inventoryCheckGrouping.ts', ['MAX(i.updated_at)', 'MIN(i.updated_at)']],
    M2: ['inventoryCheckGrouping.ts', ['AND s.organization_id IS @checkOrg', 'AND 1=1']],
    M3: ['inventoryCheckGrouping.ts', [' AND s.branch_id=i.branch_id)`', ')`']],
    M4: ['inventoryCheckGrouping.ts', ["i.state IN ('done','issue')", "i.state IN ('done','issue','unstarted')"]],
    M5: ['inventoryCheckGrouping.ts', ["export const BUSINESS_DAY_SHIFT = '+7 hours'", "export const BUSINESS_DAY_SHIFT = '+0 hours'"]],
    M6: ['inventoryCheckGrouping.ts', ["rankingOrder: '(family_num_sort IS NULL) ASC,family_num_sort DESC", "rankingOrder: '(family_num_sort IS NULL) DESC,family_num_sort DESC"]],
    M7: ['familyPagination.ts', ['FROM families)` : `SELECT family_root_id, ROW_NUMBER()', 'FROM families) WHERE family_rank > @__familyOffset AND family_rank <= @__familyOffsetEnd` : `SELECT family_root_id, ROW_NUMBER()']],
    M8: ['inventoryCheckProducts.ts', ['checkable: true, matches_filters: true, ...by ? { group_key: row.group_key } : {} })', "checkable: true, matches_filters: true, ...by ? { group_key: row.check_at ? 'd:' + dayOfRow(row.check_at) : 'never' } : {} })"]],
    M9: ['familyPagination.ts', ['FROM (SELECT *, ROW_NUMBER() OVER (ORDER BY ${familyOrderSql}, family_root_id ASC) AS family_rank FROM families)` : `SELECT', 'FROM (SELECT *, ROW_NUMBER() OVER (ORDER BY ${familyOrderSql}) AS family_rank FROM families)` : `SELECT']],
    M10: ['inventoryCheckGrouping.ts', ["rankingOrder: '(family_num_sort IS NULL) ASC,family_num_sort DESC,family_name ASC'", "rankingOrder: 'family_name ASC,(family_num_sort IS NULL) ASC,family_num_sort DESC'"]],
    M11: ['inventoryCheckGrouping.ts', ["\"NULLIF(lower(trim(COALESCE(c.category,''))),'')\"", "\"NULLIF(COALESCE(c.category,''),'')\""]],
    M12: ['inventoryCheckAccess.ts', ["    if (result.groupBy === 'category') requireField('category', 'groupBy')\n", '']],
  }
  const files = { 'inventoryCheckGrouping.ts': 'inventoryCheckProducts.ts', 'familyPagination.ts': 'inventoryCheckProducts.ts', 'inventoryCheckProducts.ts': 'inventoryCheckProducts.ts', 'inventoryCheckAccess.ts': 'inventoryCheckProducts.ts' }
  await check('mutants M1-M12 are each caught by the oracle', async () => {
    const caught = {}
    for (const [id, [file, pair]] of Object.entries(MUTANTS)) {
      if (only && !only.includes(id)) continue
      const edits = { [file]: [pair] }
      // M9 drops the family-key tie-break from the ranking AND from the page order (the ranking alone is hidden by GROUP BY's own key order).
      const wrapperTail = String.fromCharCode(10) + '      const result = await schemaBatch(db, [statements[0], { ...statements[1], sql: wrappedPageSql }, { sql: branchesSql'
      if (id === 'M9') edits['inventoryCheckProducts.ts'] = [['__page.__family_root_id ASC,__page.id ASC`' + wrapperTail, '__page.id ASC`' + wrapperTail]]
      if (id === 'M8') edits[file] = [[...pair], ["const invalid = (parameter: string)", "const dayOfRow = (at: unknown) => String(at).slice(0, 10)\nconst invalid = (parameter: string)"]]
      const api = await bundleMutated(files[file], edits)
      let failure = null
      try {
        for (let seed = 1; seed <= 5 && !failure; seed++) await runWorld(api, seed)
        // M12 is the 403 rule: the read must refuse category without the grant.
        if (id === 'M12') await api.readInventoryCheckProductsSimple(adapter(buildWorld(3).db), noCategory, { groupBy: 'category' }, { lowStock, check: { organizationId: 1, viewerId: 3, canSeeStaffIdentity: () => true } }).then(() => assert.fail('category read without the grant'), e => assert.equal(e.status, 403, `M12 answered ${e.status} ${e.code}`))
      } catch (error) { failure = error }
      caught[id] = !!failure
    }
    const survived = Object.entries(caught).filter(([, hit]) => !hit).map(([id]) => id)
    assert.deepEqual(survived, [], `mutants that survived: ${survived.join(', ')}`)
  })
  console.log(`${passed} passed`)
}
main().catch(error => { console.error(error); process.exit(1) })
