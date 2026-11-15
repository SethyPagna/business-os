'use strict'
// Grouped Inventory Check list on the ic_wired path (GET /api/inventory-checks/list?groupBy=checked|category) against the independent JS oracle, over the real routes, the real migrations and
// the shared Products reader (harness/inv-app.cjs), on the same random worlds the ic_simple oracle uses (harness/ic-grouped-world.cjs populateWorld).
//   G1 the same rows as the name-ordered read (nothing missing, nothing doubled)   G2 the group totals add up to the pager's total and to the product count
//   G3 a group's totals do not depend on the page or the page size                 G4 every row's group_key equals the key computed here from the raw items (UTC+7 days)
//   G6 the read writes nothing (rows changed in the database, rows of every IC table)
// The pages are read through one app with the cache ON, so a ranking shared between groupings, scopes or check versions would show as a wrong page. Mutants are planted in the Worker source
// (harness/inv-app.cjs sourceEdits) and must each be caught. Plans are pinned with no statistics and after ANALYZE (scratch in-memory database only).
//
// Run: node scripts/test-inventory-check-grouped-wired-native.cjs
const assert = require('node:assert/strict')
const { createInvApp, person, IC_ALL_FIELDS } = require('./harness/inv-app.cjs')
const { populateWorld } = require('./harness/ic-grouped-world.cjs')
const { expectedRead } = require('./harness/ic-grouped-oracle.cjs')

const users = {
  org1: person(81, 'admin', { all: true }, 1), org2: person(82, 'admin', { all: true }, 2), orgNull: person(83, 'admin', { all: true }, null),
  counter: person(84, 'employee', { products: true, inventory: true, inventory_checks: true, inventory_checks_check: true, ...IC_ALL_FIELDS }, 1),
  // Counting and stock only: no category, no barcode, no Products page.
  noCategory: person(85, 'employee', { inventory_checks: true, inventory_checks_check: true, inventory_check_show_stock: true, inventory_check_show_brand: true }, 1),
}
const MOUNT = { '/api/inventory-checks': 'routes/inventoryChecks.ts' }
const makeApp = (seed, sourceEdits = {}) => {
  const app = createInvApp({ mount: MOUNT, users, sourceEdits, seed: raw => { populateWorld(raw.db, seed) } })
  app.setSwitch('ic_wired', 'on')
  return app
}

const SHAPES = [
  { user: 'org1', branch: null, query: {} }, { user: 'org1', branch: 1, query: {} }, { user: 'org1', branch: 2, query: {} },
  { user: 'counter', branch: 1, query: { stockState: 'low_stock' } }, { user: 'org1', branch: null, query: { category: 'Skin' } },
  { user: 'org1', branch: 1, query: { stockState: 'in_stock' } }, { user: 'org1', branch: 1, query: { checkState: 'issue' } }, { user: 'org1', branch: 2, query: { checkState: 'ok' } },
  { user: 'org1', branch: 2, query: { checkState: 'not_checked' } }, { user: 'org2', branch: null, query: {} }, { user: 'orgNull', branch: 1, query: {} },
]

const qs = params => new URLSearchParams(params).toString()
const list = async (app, user, params) => { app.setUser(users[user]); return app.get(`/api/inventory-checks/list?${qs(params)}`) }
const ORG = { org1: 1, org2: 2, orgNull: null, counter: 1, noCategory: 1 }
const changes = app => app.raw.db.prepare('SELECT total_changes() AS n').get().n
const icRows = app => ['inventory_check_sessions', 'inventory_check_items'].map(t => app.raw.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n).join(',')

async function nameRowsOf(app, shape, base) {
  const rows = []
  for (let page = 1; ; page++) {
    const r = await list(app, shape.user, { ...base, sortBy: 'name', pageSize: '100', page: String(page), summary: '0' })
    assert.equal(r.status, 200, `name read ${JSON.stringify(base)}: ${r.text.slice(0, 200)}`)
    rows.push(...r.json.items); if (page >= r.json.totalPages) break
  }
  return rows
}

// Every shape x grouping x page size x page (one past the end) of one app against the oracle.
async function runWorld(app, seed) {
  let compared = 0, headersSeen = 0
  for (const shape of SHAPES) {
    const base = { ...shape.query, ...(shape.branch === null ? {} : { branchId: String(shape.branch) }) }
    const org = ORG[shape.user]
    const nameRows = await nameRowsOf(app, shape, base)
    for (const by of ['checked', 'category']) for (const pageSize of shape === SHAPES[0] ? [1, 4, 100] : [4, 100]) {
      const probe = expectedRead(app.raw.db, nameRows, by, org, shape.branch, 1, pageSize, { wired: true })
      const pages = Math.max(1, Math.ceil(probe.total / pageSize)) + 1
      const seen = [], totals = new Map()
      for (let page = 1; page <= pages; page++) {
        const before = changes(app), rowsBefore = icRows(app)
        const got = await list(app, shape.user, { ...base, groupBy: by, pageSize: String(pageSize), page: String(page), summary: '0' })
        const ctx = `seed ${seed} ${JSON.stringify({ ...base, by, pageSize, page })} ${shape.user}`
        assert.equal(got.status, 200, `${ctx}: ${got.text.slice(0, 300)}`)
        assert.equal(changes(app), before, `G6 the read writes nothing ${ctx}`); assert.equal(icRows(app), rowsBefore, `G6 IC tables unchanged ${ctx}`)
        const want = expectedRead(app.raw.db, nameRows, by, org, shape.branch, page, pageSize, { wired: true })
        assert.deepEqual(got.json.items.map(item => ({ id: item.id, group_key: item.group_key })), want.items, `rows, group_key and order (G4) ${ctx}`)
        assert.equal(got.json.total, want.total, `total ${ctx}`); assert.equal(got.json.totalPages, Math.max(1, Math.ceil(want.total / pageSize)), `totalPages ${ctx}`)
        assert.deepEqual(got.json.grouping, { by, unit: 'family', groups: want.groups }, `groups ${ctx}`)
        assert.equal(got.json.projected, true, 'a grouped answer is never Products\' own page')
        for (const g of got.json.grouping.groups) { const prior = totals.get(g.key); if (prior) assert.deepEqual([prior.families, prior.products], [g.families, g.products], `G3 totals of ${g.key} change with the page ${ctx}`); totals.set(g.key, g) }
        seen.push(...got.json.items.map(item => item.id)); compared += got.json.items.length
      }
      assert.deepEqual([...seen].sort((a, b) => a - b), nameRows.map(r => r.id).sort((a, b) => a - b), `G1 same rows as the name order, seed ${seed} ${by} ${JSON.stringify(base)} ${pageSize}`)
      // G2: the groups seen across the pages add up to the pager's total and to the product count; G3 across page sizes is the oracle's own total (compared above).
      assert.equal([...totals.values()].reduce((n, g) => n + g.families, 0), probe.total, 'G2 families add up to the pager total')
      // A header row is a family's title, not a product: the groups count products only (as the ic_simple list does), so the sum is the rows that are not headers.
      const headerIds = new Set(app.raw.db.prepare('SELECT id FROM products WHERE COALESCE(is_group,0)=1').all().map(row => row.id))
      assert.equal([...totals.values()].reduce((n, g) => n + g.products, 0), nameRows.filter(row => !headerIds.has(row.id)).length, 'G2 products add up to the product count (headers are not products)')
      headersSeen += nameRows.filter(row => headerIds.has(row.id)).length
    }
  }
  // Freshness: a check written after the ranking was cached moves the inventory_checks version, and the next read must show it (the ranking is keyed on that version).
  const shape = SHAPES[1], base = { branchId: '1' }, nameRows = await nameRowsOf(app, shape, base)
  const dated = new Set(expectedRead(app.raw.db, nameRows, 'checked', 1, 1, 1, 1000, { wired: true }).items.filter(i => i.group_key !== 'never').map(i => i.id))
  const fresh = nameRows.find(r => !dated.has(r.id))
  if (fresh) {
    const session = app.raw.db.prepare('SELECT id FROM inventory_check_sessions WHERE organization_id = 1 AND branch_id = 1 LIMIT 1').get()
    if (session) {
      const had = app.raw.db.prepare('SELECT 1 AS x FROM inventory_check_items WHERE session_id = ? AND product_id = ? AND branch_id = 1').get(session.id, fresh.id)
      if (!had) {
        app.raw.db.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,updated_by,updated_at) VALUES(?,?,1,'{}',5,'{}','done',5,NULL,2,'2026-11-15T05:00:00.000Z')").run(session.id, fresh.id)
        await app.load('lib/cache.ts').bumpVersion(app.env, 'inventory_checks')
        const got = await list(app, 'org1', { ...base, groupBy: 'checked', pageSize: '100', summary: '0' })
        const want = expectedRead(app.raw.db, nameRows, 'checked', 1, 1, 1, 100, { wired: true })
        assert.deepEqual(got.json.items.map(item => ({ id: item.id, group_key: item.group_key })), want.items, `a check written after the ranking was cached shows on the next read, seed ${seed}`)
        assert.equal(want.items.find(i => i.id === fresh.id).group_key, 'd:2026-11-15', 'the oracle sees the new check')
        compared++
      }
    }
  }
  assert.ok(headersSeen > 0, `positive control: the world has header rows to leave out of the product counts (seed ${seed})`)
  return compared
}

// A typed search is answered FLAT (review finding 1): with a search the page shows every member of a family while a family's date and the header counts are computed over the matched rows, so a
// grouped answer could put a dated row under "Never checked". groupBy (and the old sortBy=checked spelling) beside a query is accepted and ignored: the body is byte-identical to the same request
// without it, with no grouping block and no group_key.
async function searchIsFlat(app) {
  // Header 5000 with two children: Rose checked 1 Nov, Lily checked 14 Nov. A second family whose matched child (Rose) was never checked while its sibling Lily was.
  app.seedStockFixture(app.raw.db, () => {
    app.raw.db.prepare("INSERT INTO products(id,name,stock_quantity,is_group,is_active) VALUES(5000,'Probe Hdr',0,1,1)").run()
    app.raw.db.prepare("INSERT INTO products(id,name,stock_quantity,is_group,is_active) VALUES(5010,'Probe2 Hdr',0,1,1)").run()
    for (const [id, name, barcode, parent] of [[5001, 'Probe Rose', 'PRB-ROSE-1', 5000], [5002, 'Probe Lily', 'PRB-LILY-2', 5000], [5011, 'Probe2 Rose', 'PRB2-R', 5010], [5012, 'Probe2 Lily', 'PRB2-L', 5010]]) {
      app.raw.db.prepare('INSERT INTO products(id,name,barcode,stock_quantity,parent_id,is_active) VALUES(?,?,?,5,?,1)').run(id, name, barcode, parent)
      app.raw.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,5)').run(id)
    }
  })
  app.raw.db.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at) VALUES('sTwin',1,1,1,'Twin','open',0,'{}','2026-10-19T01:00:00.000Z','2026-10-20T01:00:00.000Z')").run()
  const item = app.raw.db.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,updated_by,updated_at) VALUES('sTwin',?,1,'{}',5,'{}','done',5,NULL,2,?)")
  item.run(5001, '2026-11-01T05:00:00.000Z'); item.run(5002, '2026-11-14T05:00:00.000Z'); item.run(5012, '2026-11-13T05:00:00.000Z')
  await app.load('lib/cache.ts').bumpVersion(app.env, 'inventory_checks')
  let compared = 0
  for (const [user, query] of [['org1', 'rose'], ['org1', 'PRB-ROSE-1'], ['org1', 'probe2'], ['counter', 'rose'], ['org1', 'a']]) for (const extra of [{ groupBy: 'checked' }, { groupBy: 'category' }, { sortBy: 'checked' }, { sortBy: 'checked', sortDirection: 'asc' }, { sortBy: 'checked', groupBy: 'checked' }]) {
    const params = { query, branchId: '1', pageSize: '100' }
    const flat = await list(app, user, params), asked = await list(app, user, { ...params, ...extra })
    assert.equal(flat.status, 200, flat.text.slice(0, 200)); assert.equal(asked.status, 200, asked.text.slice(0, 200))
    assert.equal(asked.text, flat.text, `a typed search answers byte-identically with ${JSON.stringify(extra)}: ${query}`)
    assert.ok(!('grouping' in asked.json) && asked.json.items.every(row => !('group_key' in row)), 'flat: no grouping block, no group_key')
    assert.ok(Array.isArray(asked.json.capabilities.groupings) && asked.json.capabilities.groupings.length > 0, 'the Group by choice is still offered for when the search is cleared')
    compared++
  }
  // Positive control: the search shows the unmatched sibling beside the hit (the case the grouped answer got wrong).
  const rose = await list(app, 'org1', { query: 'rose', branchId: '1', groupBy: 'checked', pageSize: '100' })
  const ids = rose.json.items.map(row => row.id)
  assert.ok(ids.includes(5001) && ids.includes(5002), `the search shows the family beside its hit: ${JSON.stringify(ids)}`)
  // Cleared, the same page is grouped again and each family is dated by its newest check.
  const cleared = await list(app, 'org1', { branchId: '1', groupBy: 'checked', pageSize: '100', summary: '0' })
  const keyOf = id => cleared.json.items.find(row => row.id === id).group_key
  assert.equal(keyOf(5001), 'd:2026-11-14'); assert.equal(keyOf(5002), 'd:2026-11-14'); assert.equal(keyOf(5011), 'd:2026-11-13')
  // groupBy beside ids is still refused (the device index never asks for both), even with a query.
  app.setUser(users.org1)
  assert.equal((await app.get('/api/inventory-checks/list?groupBy=checked&ids=5001&query=rose&branchId=1')).status, 400)
  return compared
}

async function contract(app) {
  const get = (user, params, path = 'list') => { app.setUser(users[user]); return app.get(`/api/inventory-checks/${path}?${qs(params)}`) }
  const refused = async (user, params, status, parameter, code) => { const r = await get(user, params); assert.equal(r.status, status, `${JSON.stringify(params)} -> ${r.status} ${r.text.slice(0, 150)}`); if (parameter) assert.equal(r.json.parameter, parameter); if (code) assert.equal(r.json.code, code) }
  await refused('org1', { groupBy: 'checked', sortBy: 'name' }, 400, 'sortBy'); await refused('org1', { groupBy: 'checked', sortBy: 'created' }, 400, 'sortBy')
  await refused('org1', { groupBy: 'checked', sortDirection: 'desc' }, 400, 'sortDirection'); await refused('org1', { groupBy: 'brand' }, 400, 'groupBy')
  await refused('org1', { groupBy: 'checked', ids: '100' }, 400, 'groupBy'); await refused('org1', { sortBy: 'checked', groupBy: 'category' }, 400, 'sortBy')
  await refused('noCategory', { groupBy: 'category' }, 403, 'groupBy', 'inventory_check_field_hidden')
  assert.equal((await get('noCategory', { groupBy: 'checked' })).status, 200, 'the checked grouping needs no category grant')
  // Capability: advertised on /list and /overlay; category only with the grant.
  for (const [user, want] of [['org1', ['checked', 'category']], ['counter', ['checked', 'category']], ['noCategory', ['checked']]]) {
    assert.deepEqual((await get(user, { branchId: '1' })).json.capabilities.groupings, want, `list groupings ${user}`)
    assert.deepEqual((await get(user, { branchId: '1', ids: '100,101' }, 'overlay')).json.capabilities.groupings, want, `overlay groupings ${user}`)
  }
  // An ungrouped list is the answer it always was: no grouping block, no group_key.
  const plain = await get('org1', { branchId: '1', pageSize: '20' })
  assert.ok(!('grouping' in plain.json) && plain.json.items.every(item => !('group_key' in item)), 'no grouping block or key without groupBy')
  // sortBy=checked is an alias of groupBy=checked, its direction ignored; it needs no check state any more, and a search or filter beside it is answered.
  const grouped = await get('org1', { branchId: '1', groupBy: 'checked', pageSize: '30' })
  for (const extra of [{ sortBy: 'checked' }, { sortBy: 'checked', sortDirection: 'asc' }, { sortBy: 'checked', groupBy: 'checked' }]) {
    const alias = await get('org1', { branchId: '1', pageSize: '30', ...extra })
    assert.equal(alias.status, 200, JSON.stringify(extra)); assert.deepEqual(alias.json.items, grouped.json.items, `alias rows ${JSON.stringify(extra)}`)
    assert.deepEqual(alias.json.grouping, grouped.json.grouping); assert.equal(alias.json.total, grouped.json.total)
  }
  assert.equal((await get('org1', { branchId: '1', sortBy: 'checked', query: 'serum' })).status, 200, 'a search beside the date order is answered')
  // Switch off: the list does not exist.
  app.setSwitch('ic_wired', 'off'); assert.equal((await get('org1', { groupBy: 'checked' })).status, 404); app.setSwitch('ic_wired', 'on')
  // A viewer without the barcode field finds a product by its whole code: the exact hit is read by id and answered flat when groupBy comes beside the code (a typed or scanned code is a search).
  const code = '8851234567'
  app.seedStockFixture(app.raw.db, () => { app.raw.db.prepare('UPDATE products SET barcode = ? WHERE id = 100').run(code) })
  const hit = await get('noCategory', { query: code, groupBy: 'checked', branchId: '1', summary: '0' })
  assert.equal(hit.status, 200, hit.text.slice(0, 200)); assert.deepEqual(hit.json.items.map(i => i.id), [100]); assert.ok(!('group_key' in hit.json.items[0]) && !('grouping' in hit.json)); assert.equal(hit.json.total, 1)
  assert.equal(hit.text, (await get('noCategory', { query: code, branchId: '1', summary: '0' })).text, 'the code answer is the same without groupBy')
  const other = await get('noCategory', { query: code, groupBy: 'checked', branchId: '2', checkState: 'ok', summary: '0' })
  assert.equal(other.status, 200); assert.ok(other.json.items.every(i => i.id === 100))
}

// EXPLAIN QUERY PLAN of the statements a grouped wired read ran.
function plans(app, stats) {
  const plan = sql => { const statement = app.raw.db.prepare(`EXPLAIN QUERY PLAN ${sql}`); statement.setAllowUnknownNamedParameters(true); return statement.all({}).map(row => row.detail) }
  const icScans = lines => lines.filter(line => /^SCAN (i|s|inventory_check_items|inventory_check_sessions)( |$)/.test(line) && !/idx_(branch|damaged)/.test(line))
  return (async () => {
    for (const params of [{ groupBy: 'checked', branchId: '1' }, { groupBy: 'checked' }, { groupBy: 'checked', branchId: '1', checkState: 'ok' }, { groupBy: 'checked', stockState: 'in_stock', branchId: '2' }, { groupBy: 'category' }]) {
      app.clearCaches(); const mark = app.mark()
      const r = await list(app, 'org1', { ...params, pageSize: '10', summary: '0' })
      assert.equal(r.status, 200, r.text.slice(0, 200))
      const statements = app.since(mark)
      const ranking = statements.filter(sql => sql.includes('__group_key') && sql.includes('ORDER BY __family_rank ASC'))
      assert.equal(ranking.length, 1, `one ranking statement carries the group windows ${JSON.stringify(params)}`)
      for (const sql of statements) assert.deepEqual(icScans(plan(sql)), [], `no IC table is scanned (${stats ? 'after ANALYZE' : 'no statistics'}) ${JSON.stringify(params)}`)
      if (params.groupBy === 'checked' && !params.checkState) {
        const lines = plan(ranking[0])
        assert.ok(lines.some(line => /SEARCH i USING INDEX inventory_check_items_product_latest \(product_id=\?/.test(line)), `items by the 0285 index:\n${lines.join('\n')}`)
        assert.equal(lines.filter(line => /SEARCH i USING INDEX inventory_check_items_product_latest/.test(line)).length, 1, 'the lookup runs once per cohort row')
        if (params.branchId) assert.ok(lines.some(line => /branch_id=\?/.test(line)), 'the branch is an index term')
      } else if (params.groupBy === 'category') assert.ok(!plan(ranking[0]).some(line => /inventory_check_/.test(line)), 'the category ranking never reads a check table')
    }
  })()
}

const MUTANTS = {
  M1: ['lib/inventoryCheckGrouping.ts', ['SELECT MAX(i.updated_at)', 'SELECT MIN(i.updated_at)']],
  M2: ['lib/inventoryCheckGrouping.ts', ['AND s.organization_id IS @checkOrg', 'AND 1=1']],
  M3: ['lib/inventoryCheckGrouping.ts', [' AND s.branch_id=i.branch_id)`', ')`']],
  M4: ['lib/inventoryCheckGrouping.ts', ["i.state IN ('done','issue')", "i.state IN ('done','issue','unstarted')"]],
  M5: ['lib/inventoryCheckGrouping.ts', ["export const BUSINESS_DAY_SHIFT = '+7 hours'", "export const BUSINESS_DAY_SHIFT = '+0 hours'"]],
  M6: ['lib/inventoryCheckGrouping.ts', ["rankingOrder: '(family_num_sort IS NULL) ASC,family_num_sort DESC", "rankingOrder: '(family_num_sort IS NULL) DESC,family_num_sort DESC"]],
  M7: ['routes/products.ts', ['groups: groups.filter((group) => group.last >= offset + 1 && group.first <= offset + pageSize) }', 'groups: groups.filter((group) => group.last >= offset + 1 && group.first <= offset + pageSize).map((group) => ({ ...group, products: items.filter((item) => item.group_key === group.key).length })) }']],
  M8: ['routes/products.ts', ['const rank = rankOf.get(String(__family_root_id)) ?? 0', 'const rank = offset + rows.indexOf(row) + 1']],
  M9: ['lib/familyPagination.ts', ['family_root_id ASC) AS __family_rank FROM families)\n    ) ORDER BY __family_rank ASC', 'family_root_id DESC) AS __family_rank FROM families)\n    ) ORDER BY __family_rank ASC']],
  M10: ['lib/inventoryCheckGrouping.ts', ["rankingOrder: '(family_num_sort IS NULL) ASC,family_num_sort DESC,family_name ASC'", "rankingOrder: 'family_name ASC,(family_num_sort IS NULL) ASC,family_num_sort DESC'"]],
  M11: ['lib/inventoryCheckGrouping.ts', ["`NULLIF(lower(trim(COALESCE(${alias}.category,''))),'')`", "`NULLIF(COALESCE(${alias}.category,''),'')`"]],
  M12: ['lib/inventoryCheckAccess.ts', ["    if (result.groupBy === 'category') requireField('category', 'groupBy')\n", '']],
  // Wired only: the cache.
  M13: ['routes/products.ts', ["keyUrl.searchParams.set('ic_group', options.grouping.by)", 'void 0']],
  M14: ['routes/products.ts', ["versions = `${baseVersion}:icg:${options.setVersion ?? ''}`", 'versions = baseVersion']],
  // M15 (the name-sibling group_key inheritance in routes/products.ts) cannot be reached from this route now that a typed search is flat, so it is retired.
  // M17: a header row counted as a product in the group totals (finding 7: the two lists count products only).
  M17: ['lib/familyPagination.ts', ["', SUM(__member) AS __members'", "', COUNT(*) AS __members'"]],
  // M16: the typed-search rule removed (groupBy beside a query is honoured again).
  M16: ['lib/inventoryCheckList.ts', ['const grouping: InventoryCheckGrouping | null = validated.query ? null : requestedGrouping', 'const grouping: InventoryCheckGrouping | null = requestedGrouping']],
  // The tie-break removed outright is hidden by the GROUP BY that builds `families` (it already hands the rows over in key order): reported, not asserted.
  M9b: ['lib/familyPagination.ts', ['ORDER BY ${familyOrderSql}, family_root_id ASC) AS __family_rank FROM families)\n    ) ORDER BY __family_rank ASC', 'ORDER BY ${familyOrderSql}) AS __family_rank FROM families)\n    ) ORDER BY __family_rank ASC']],
}
const EXPECTED_SURVIVORS = ['M9b']

async function main() {
  let passed = 0
  const check = async (name, run) => { await run(); passed++; console.log(`PASS ${name}`) }
  const only = process.env.ONLY_MUTANTS ? process.env.ONLY_MUTANTS.split(',') : null
  const SEEDS = [1, 2, 3, 4, 5]

  if (!only) await check('real code: grouped pages equal the oracle on every world, scope and pager (G1-G4, G6, cache on)', async () => {
    let compared = 0
    for (const seed of SEEDS) { const app = makeApp(seed); compared += await runWorld(app, seed); if (seed === 2) await searchIsFlat(app) }
    assert.ok(compared > 1500, `${compared} rows compared`)
  })
  if (!only) await check('HTTP contract: refusals, capability, alias, switch off, code lookup, shape', async () => { await contract(makeApp(3)) })
  if (!only) await check('plans: no IC table scanned, the lookup is one index search per cohort row (no statistics, then after ANALYZE)', async () => {
    const app = makeApp(4)
    await plans(app, false); app.raw.db.exec('ANALYZE'); await plans(app, true)
  })

  if (!process.env.SKIP_MUTANTS) await check('mutants M1-M14, M16 and M17 are each caught', async () => {
    const survived = []
    for (const [id, [file, pair]] of Object.entries(MUTANTS)) {
      if (only && !only.includes(id)) continue
      let failure = null
      try {
        for (const seed of SEEDS) {
          if (failure) break
          const app = makeApp(seed, { [file]: [pair] })
          if (id === 'M12') { await contract(app); continue }
          if (id === 'M16') { await searchIsFlat(app); continue }
          await runWorld(app, seed)
        }
      } catch (error) { failure = error }
      if (!failure) survived.push(id)
      console.log(`  mutant ${id}: ${failure ? 'caught' : 'SURVIVED'}`)
    }
    assert.deepEqual(survived.filter(id => !EXPECTED_SURVIVORS.includes(id)), [], `mutants that survived: ${survived.join(', ')}`)
  })
  console.log(`${passed} passed`)
}
main().catch(error => { console.error(error); process.exit(1) })
