'use strict'
// ic_simple (lane 6.0.1044): the owner's Inventory Check list. Runs the REAL model (readInventoryCheckProductsSimple, the closed validator,
// the membership builder) against the real migration chain on node:sqlite, and compares it with the old reader (readInventoryCheckProducts)
// on every field the owner kept. Fixtures are synthetic.
//
// Run: node scripts/test-inventory-check-simple-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { buildSync } = require('esbuild')
const { loadAll } = require('./harness/load_migrations.cjs')

const bundle = file => {
  const code = buildSync({ entryPoints: [path.join(__dirname, '../src/lib', file)], bundle: true, platform: 'node', format: 'cjs', write: false, target: 'es2022', external: ['cloudflare:*'] }).outputFiles[0].text
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', code)(require, loaded, loaded.exports)
  return loaded.exports
}
const api = bundle('inventoryCheckProducts.ts')
const lowStock = { enabled: true, mode: 'product', threshold: 10 }
const admin = { id: 1, role_code: 'admin', role_permissions: { all: true } }
const viewer = (id, permissions) => ({ id, role_code: 'staff', role_permissions: JSON.stringify({ inventory_checks: true, ...permissions }) })
const FIELDS = { inventory_check_show_stock: true, inventory_check_show_barcode: true, inventory_check_show_brand: true, inventory_check_show_category: true, inventory_check_show_received: true }
const stockViewer = viewer(2, { ...FIELDS, inventory_check_show_sales: true, inventory_check_show_customers: true, inventory_check_show_price: true })
const blindViewer = viewer(3, { inventory_check_show_brand: true })
const noGrantViewer = { id: 4, role_code: 'staff', role_permissions: JSON.stringify({ inventory_checks: false }) }

let passed = 0
const check = async (name, run) => { await run(); passed++; console.log(`PASS ${name}`) }

function fixture() {
  const db = new DatabaseSync(':memory:')
  for (const sql of loadAll({ through: 242 })) db.exec(sql)
  for (const file of ['0259_inventory_check_sessions.sql', '0285_inventory_check_items_latest.sql']) db.exec(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'))
  db.exec(`INSERT OR IGNORE INTO branches(id,name,is_active) VALUES(1,'Synthetic one',1),(2,'Synthetic two',1),(3,'Synthetic closed',0);
    INSERT INTO users(id,username,name,password,organization_id) VALUES(1,'admin-one','Admin One','unused',1),(2,'counter-two','Counter Two','unused',1),
      (3,'counter-three','Counter Three','unused',1),(5,'counter-five','Counter Five','unused',1),(9,'foreign-nine','Foreign Nine','unused',2)`)
  const add = (id, name, qty, extra = {}) => {
    db.prepare('INSERT INTO products(id,name,stock_quantity,parent_id,is_group,brand,brands,category,barcode,sku,unit) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, name, qty, extra.parent_id ?? null, extra.is_group ?? 0, extra.brand ?? 'Brand A', extra.brands ?? extra.brand ?? 'Brand A', extra.category ?? 'Skin', extra.barcode ?? null, extra.sku ?? null, 'pcs')
    if (extra.is_group) return
    db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,?)').run(id, qty)
    db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,expiry_date) VALUES(?,?,?,?,?)').run(id, id, `fx-${id}`, extra.received ?? '2026-10-01', extra.expiry ?? null)
    db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,?)').run(id, qty)
  }
  add(100, 'Alpha Serum', 50, { barcode: '8850000000011', sku: 'SKU-A', expiry: '2027-01-31' })
  add(101, 'Alpha Cream', 0, { barcode: '8850000000028' })
  add(102, 'Beta Toner', 3, { brand: 'Brand B', category: 'Hair', barcode: '8850000000035' })
  add(103, 'Beta Mist', 40, { brand: 'Brand B', brands: 'Brand B||Shared', category: 'Hair' })
  add(104, 'Delta Soap', 20, { category: 'Body' })
  add(110, 'Gamma', 0, { is_group: 1 })
  add(111, 'Gamma Red', 12, { parent_id: 110, brand: 'Brand G', category: 'Body' })
  add(112, 'Gamma Blue', 2, { parent_id: 110, brand: 'Brand G', category: 'Body' })
  for (let n = 1; n <= 30; n++) add(200 + n, `Filler ${String(n).padStart(2, '0')}`, 25, { category: 'Filler' })
  db.prepare('INSERT INTO damaged_stock_lots(product_id,branch_id,quantity_remaining) VALUES(100,1,2)').run()
  return db
}
const session = (db, id, org, branch, creator, status, updated = '2026-10-20T01:00:00.000Z', scope = '{}') =>
  db.prepare('INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) VALUES(?,?,?,?,?,?,0,?,?,?,?)')
    .run(id, org, branch, creator, `Count ${id}`, status, scope, '2026-10-19T01:00:00.000Z', updated, status === 'closed' ? updated : null)
const item = (db, sessionId, product, branch, state, count, reason, at, by) =>
  db.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,updated_by,updated_at) VALUES(?,?,?,'{}',5,'{}',?,?,?,?,?)")
    .run(sessionId, product, branch, state, count, reason, by ?? null, at ?? null)
// Every check situation the status rule has to separate (organization 1, branch 1 unless said otherwise).
function seedChecks(db) {
  session(db, 's-open', 1, 1, 2, 'open'); session(db, 's-old', 1, 1, 3, 'closed'); session(db, 's-foreign', 2, 1, 9, 'open'); session(db, 's-branch2', 1, 2, 2, 'open')
  session(db, 'a-session', 1, 1, 2, 'closed'); session(db, 'b-session', 1, 1, 2, 'closed')
  item(db, 's-old', 100, 1, 'issue', 41, 'Older shortage', '2026-10-10T01:00:00.000Z', 3)        // 100: an older issue ...
  item(db, 's-open', 100, 1, 'done', 50, null, '2026-10-20T01:00:00.000Z', 2)                      // ... then a newer ok -> ok
  item(db, 's-open', 101, 1, 'issue', 3, 'Counted three', '2026-10-20T02:00:00.000Z', 3)          // 101: issue
  item(db, 's-open', 102, 1, 'unstarted', null, null, null, null)                                  // 102: unstarted in an OPEN session -> in_check
  item(db, 's-old', 103, 1, 'unstarted', null, null, null, null)                                   // 103: unstarted in a CLOSED session -> not_checked
  item(db, 's-foreign', 104, 1, 'issue', 9, 'Foreign issue', '2026-10-21T01:00:00.000Z', 9)       // 104: only another organization checked it -> not_checked
  item(db, 's-branch2', 100, 2, 'issue', 7, 'Branch two issue', '2026-10-22T01:00:00.000Z', 2)    // newest of 100, but branch 2
  item(db, 'a-session', 111, 1, 'done', 12, null, '2026-10-23T01:00:00.000Z', 5)                  // 111: same instant in two sessions ...
  item(db, 'b-session', 111, 1, 'issue', 11, 'Tie break', '2026-10-23T01:00:00.000Z', 5)         // ... the higher session id wins -> issue
}
function adapter(db) {
  return { calls: 0, statements: 0, sql: [], async batch(statements) {
    this.calls++; this.statements += statements.length; this.sql.push(...statements.map(statement => statement.sql))
    db.exec('PRAGMA query_only=ON'); db.exec('BEGIN')
    try {
      const results = statements.map(({ sql, params = {} }) => { const prepared = db.prepare(sql); prepared.setAllowUnknownNamedParameters(true); return { success: true, results: prepared.all(params) } })
      db.exec('COMMIT'); return results
    } catch (error) { db.exec('ROLLBACK'); throw error } finally { db.exec('PRAGMA query_only=OFF') }
  } }
}
const staff = (user, id = user.id) => accountId => user.role_code === 'admin' || accountId === id
const simpleRead = async (db, query = {}, user = admin, check = {}, extra = {}) => {
  const proxy = adapter(db)
  const before = db.prepare('SELECT total_changes() AS n').get().n
  const result = await api.readInventoryCheckProductsSimple(proxy, user, query, { lowStock, check: { organizationId: 1, viewerId: user.id, canSeeStaffIdentity: staff(user), ...check }, ...extra })
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, before, 'the read performs no writes')
  assert.equal(proxy.calls, 1, 'one snapshot batch')
  return { result, proxy }
}
const oldRead = async (db, query = {}, user = admin) => api.readInventoryCheckProducts(adapter(db), user, query, { lowStock })
const rows = result => result.items.filter(row => row.checkable)
const statusById = result => Object.fromEntries(rows(result).map(row => [row.id, row.check_status]))
const FINANCIAL = ['qty_sold', 'net_sold_qty', 'customer_count', 'unique_customer_count', 'selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr',
  'cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr', 'cost_needs_review', 'stock_value_usd', 'stock_value_khr', 'stock_value_unknown']
const refused = async (run, status, code, parameter) => {
  await assert.rejects(run, error => { assert.equal(error.status, status); assert.equal(error.code, code); if (parameter) assert.equal(error.parameter, parameter); return true })
}

async function main() {
  await check('kept fields equal the old reader for every owner query and role (stock, damaged, expiry, barcode, brand, category, order, total, branches)', async () => {
    const db = fixture(); seedChecks(db)
    const KEPT = ['id', 'name', 'image_path', 'unit', 'parent_id', 'is_group', 'is_grouped_cached', 'checkable', 'matches_filters', 'barcode', 'sku', 'brand', 'brands', 'category', 'categories',
      'quantity', 'display_quantity', 'damaged_quantity', 'stock_consistent', 'stock_diagnostics', 'next_expiry_date', 'latest_received_at']
    const queries = [{}, { query: 'alpha' }, { query: '8850000000011' }, { query: 'beta', brand: 'Brand B' }, { category: 'Hair,Body' }, { stockState: 'in_stock' }, { stockState: 'low_stock' },
      { stockState: 'out_of_stock' }, { sortBy: 'stock', sortDirection: 'desc' }, { sortBy: 'stock', sortDirection: 'asc', pageSize: '7' }, { page: '2', pageSize: '7' }, { branchId: '1' }, { branchId: '2' },
      { sortBy: 'name', sortDirection: 'desc' }, { brand: 'Brand G', stockState: 'low_stock' }]
    let compared = 0, refusals = 0
    for (const user of [admin, stockViewer, blindViewer]) for (const query of queries) {
      let stale
      try { stale = await oldRead(db, query, user) } catch (error) {
        // A query the viewer's grants refuse is refused identically by both readers (the 403 oracle rule).
        await refused(() => simpleRead(db, query, user), error.status, error.code, error.parameter); refusals++; continue
      }
      const fresh = (await simpleRead(db, query, user)).result
      assert.deepEqual(fresh.items.map(row => row.id), stale.items.map(row => row.id), `same rows in the same order for ${JSON.stringify(query)}`)
      for (const [index, row] of fresh.items.entries()) for (const key of KEPT) if (Object.hasOwn(row, key) || Object.hasOwn(stale.items[index], key)) {
        assert.deepEqual(row[key], stale.items[index][key], `${key} of ${row.id} for ${JSON.stringify(query)} user ${user.id}`); compared++
      }
      assert.equal(fresh.total, stale.total); assert.equal(fresh.totalPages, stale.totalPages); assert.equal(fresh.page, stale.page)
      assert.deepEqual(fresh.branches, stale.branches)
      assert.deepEqual(fresh.facets.brands, stale.facets.brands); assert.deepEqual(fresh.facets.categories, stale.facets.categories)
      assert.deepEqual(fresh.stockDiagnostics, stale.stockDiagnostics)
    }
    assert.ok(compared > 1000 && refusals >= 3, `${compared} field comparisons, ${refusals} identical refusals`)
    // Positive controls: the fixture really has damaged stock, an expiry date, a group header and a low-stock family.
    const control = (await simpleRead(db, { query: 'alpha serum' })).result.items[0]
    assert.equal(control.damaged_quantity, 2); assert.equal(control.quantity, 52); assert.equal(control.next_expiry_date, '2027-01-31')
    assert.ok((await simpleRead(db, { query: 'gamma' })).result.items.some(row => row.checkable === false && row.id === 110))
  })

  await check('no sales, customer, ranking, price, cost or stock-value key for any role or parameter', async () => {
    const db = fixture(); seedChecks(db)
    const everything = viewer(6, { ...FIELDS, inventory_check_show_sales: true, inventory_check_show_customers: true, inventory_check_show_price: true, inventory_check_show_cost: true, product_cost_view: true, contacts: true })
    for (const user of [admin, stockViewer, blindViewer, everything]) for (const query of [{}, { query: 'alpha' }, { sortBy: 'stock' }, { stockState: 'low_stock' }, { checkState: 'issue' }]) {
      let result
      try { result = (await simpleRead(db, query, user)).result } catch (error) { assert.equal(error.status, 403, 'only a hidden-field refusal is skipped'); continue }
      for (const key of ['stats', 'rankings']) assert.equal(Object.hasOwn(result, key), false, `${key} is not part of the answer`)
      for (const row of result.items) for (const key of FINANCIAL) assert.equal(Object.hasOwn(row, key), false, `${key} leaked to user ${user.id}`)
    }
    const old = await oldRead(db, {}, admin)
    assert.ok(old.items.some(row => Object.hasOwn(row, 'qty_sold')) && Object.hasOwn(old, 'stats'), 'positive control: the old reader does carry them')
  })

  await check('removed and unknown parameters are 400, hidden-field filters and sorts stay 403, and the old validator is untouched', async () => {
    const db = fixture()
    const removed = [{ startDate: '2026-10-01' }, { endDate: '2026-10-02' }, { start_date: '2026-10-01' }, { createdFrom: '2026-10-01 00:00:00' }, { createdTo: '2026-10-02 00:00:00' }, { sortBy: 'qty_sold' },
      { sortBy: 'customer_count' }, { sortBy: 'received_date' }, { sortBy: 'price' }, { sortBy: 'cost' }, { searchFields: 'name' }, { barcode: '8850000000011' }, { groupState: 'group' }, { initial: 'A' },
      { state: 'issue' }, { reason: 'x' }, { customerRanking: '1' }, { sessionId: 'abc' }, { rankingLimit: '5' }, { constructor: 'x' }]
    for (const query of removed) await refused(() => simpleRead(db, query), 400, 'inventory_check_invalid_query', Object.keys(query)[0])
    for (const query of [{ checkState: 'bogus' }, { checkState: 'Issue' }, { summary: '2' }, { sortBy: 'stock;drop' }, { pageSize: '101' }, { page: '0' }, { branchId: '99' }, { branchId: '3' }, { sortDirection: 'up' }])
      await assert.rejects(() => simpleRead(db, query), error => error.status === 400, JSON.stringify(query))
    await refused(() => simpleRead(db, { stockState: 'in_stock' }, blindViewer), 403, 'inventory_check_field_hidden', 'stockState')
    await refused(() => simpleRead(db, { sortBy: 'stock' }, blindViewer), 403, 'inventory_check_field_hidden', 'sortBy')
    await refused(() => simpleRead(db, { brand: 'Brand A' }, viewer(8, { ...FIELDS, inventory_check_show_brand: false })), 403, 'inventory_check_field_hidden', 'brand')
    await refused(() => simpleRead(db, { category: 'Skin' }, viewer(8, { ...FIELDS, inventory_check_show_category: false })), 403, 'inventory_check_field_hidden', 'category')
    await refused(() => simpleRead(db, {}, noGrantViewer), 403, 'inventory_check_view_required')
    await assert.rejects(() => simpleRead(db, { checkState: 'issue' }, admin, { organizationId: 'x' }), error => error.status === 400)
    // Both parameters stay valid for the old path (switch off = the old query contract).
    const base = await oldRead(db, { startDate: '2026-10-01', sortBy: 'qty_sold' }, admin)
    assert.ok(base.items.length > 0)
  })

  await check('check status: open-session unstarted beats history; newest done/issue wins; branch, organization and tie-break are honoured', async () => {
    const db = fixture(); seedChecks(db)
    const branch1 = statusById((await simpleRead(db, { branchId: '1', pageSize: '100' })).result)
    assert.equal(branch1[100], 'ok', 'newer done beats the older issue, and the newer branch-2 issue is another scope')
    assert.equal(branch1[101], 'issue'); assert.equal(branch1[102], 'in_check', 'unstarted in an OPEN session')
    assert.equal(branch1[103], 'not_checked', 'unstarted in a CLOSED session is not an open check')
    assert.equal(branch1[104], 'not_checked', 'another organization\'s check is invisible')
    assert.equal(branch1[111], 'issue', 'same updated_at: the higher session id wins')
    assert.equal(branch1[112], 'not_checked'); assert.equal(branch1[201], 'not_checked')
    const branch2 = statusById((await simpleRead(db, { branchId: '2', pageSize: '100' })).result)
    assert.equal(branch2[100], 'issue'); assert.equal(branch2[101], 'not_checked', 'a branch-1 check does not count in branch 2')
    const all = statusById((await simpleRead(db, { pageSize: '100' })).result)
    assert.equal(all[100], 'issue', 'all branches: the newest observation of any branch')
    // Mutants of the rule must be told apart by these exact fixtures.
    assert.notEqual(branch1[100], 'issue', 'a rule ignoring updated_at order would say issue')
    assert.notEqual(branch1[104], 'issue', 'a rule ignoring the organization would say issue')
  })

  await check('row facts: note, count, who and when, with the count and name gates', async () => {
    const db = fixture(); seedChecks(db)
    const byId = async (user, check) => Object.fromEntries(rows((await simpleRead(db, { branchId: '1', pageSize: '100' }, user, check)).result).map(row => [row.id, row]))
    const asAdmin = await byId(admin)
    assert.equal(asAdmin[101].check_note, 'Counted three'); assert.equal(asAdmin[101].check_counted_quantity, 3)
    assert.equal(asAdmin[101].check_by, 'counter-three'); assert.equal(asAdmin[101].check_at, '2026-10-20T02:00:00.000Z')
    assert.equal(asAdmin[101].check_session_id, 's-open'); assert.equal(asAdmin[101].check_branch_id, 1)
    assert.equal(asAdmin[100].check_note, null); assert.equal(asAdmin[100].check_counted_quantity, 50)
    assert.equal(asAdmin[201].check_status, 'not_checked'); assert.equal(asAdmin[201].check_by, undefined)
    // Without the stock field the count is shown only for a session the viewer created (s-open belongs to user 2, user 3 created s-old).
    const blindOwn = await byId(viewer(2, { inventory_check_show_brand: true }), { viewerId: 2 })
    assert.equal(blindOwn[101].check_counted_quantity, 3, 'the creator of s-open sees its counts')
    const blindOther = await byId(blindViewer, { viewerId: 3 })
    assert.equal(Object.hasOwn(blindOther[101], 'check_counted_quantity'), false, 'a viewer without the stock field and not the creator gets no count')
    assert.equal(blindOther[101].check_note, 'Counted three', 'the note is shown to every viewer')
    assert.equal(blindOther[101].check_at, '2026-10-20T02:00:00.000Z', 'the time is always shown')
    // The name follows the staff-identity rule: counter-three sees its own name and nobody else's.
    assert.equal(blindOther[101].check_by, 'counter-three'); assert.equal(Object.hasOwn(blindOther[100], 'check_by'), false, 'counter-two\'s name is hidden from counter-three')
    const strangers = await byId(stockViewer, { viewerId: 2, canSeeStaffIdentity: id => id === 2 })
    assert.equal(strangers[100].check_by, 'counter-two'); assert.equal(Object.hasOwn(strangers[101], 'check_by'), false)
    assert.equal(strangers[101].check_counted_quantity, 3, 'the stock field shows counts regardless of the creator')
  })

  await check('the status filter equals the status shown; the summary equals a full count of the same cohort', async () => {
    const db = fixture(); seedChecks(db)
    for (const user of [admin, stockViewer]) for (const branchId of ['1', '2', undefined]) {
      const base = branchId ? { branchId } : {}
      const full = (await simpleRead(db, { ...base, pageSize: '100' }, user)).result
      const shown = statusById(full)
      const counts = { not_checked: 0, in_check: 0, ok: 0, issue: 0 }
      for (const state of Object.values(shown)) counts[state]++
      assert.deepEqual({ in_check: full.summary.in_check, ok: full.summary.ok, issue: full.summary.issue, not_checked: full.summary.not_checked }, counts, `summary for ${JSON.stringify(base)}`)
      assert.equal(full.summary.total, Object.keys(shown).length)
      for (const state of Object.keys(counts)) {
        const filtered = (await simpleRead(db, { ...base, pageSize: '100', checkState: state }, user)).result
        assert.deepEqual(rows(filtered).map(row => row.id).sort((a, b) => a - b), Object.keys(shown).filter(id => shown[id] === state).map(Number).sort((a, b) => a - b), `checkState=${state} ${JSON.stringify(base)}`)
        assert.ok(rows(filtered).every(row => row.check_status === state))
        assert.equal(filtered.summary.total, counts[state], 'the summary follows the filtered cohort')
      }
    }
    const withBrand = (await simpleRead(db, { brand: 'Brand G', branchId: '1' })).result
    assert.equal(withBrand.summary.total, 2); assert.equal(withBrand.summary.issue, 1, 'the summary follows the other filters')
  })

  await check('summary=0 (a page step) omits the counts and facets and runs one statement less; the pager still reports the true total', async () => {
    const db = fixture(); seedChecks(db)
    const first = await simpleRead(db, { branchId: '1', pageSize: '10' })
    const step = await simpleRead(db, { branchId: '1', pageSize: '10', page: '2', summary: '0' })
    assert.ok(first.result.summary && first.result.facets)
    assert.equal(Object.hasOwn(step.result, 'summary'), false); assert.equal(Object.hasOwn(step.result, 'facets'), false)
    assert.equal(first.proxy.statements - step.proxy.statements, 1)
    assert.equal(step.result.total, first.result.total); assert.equal(step.result.totalPages, first.result.totalPages); assert.equal(step.result.page, 2)
    assert.ok(first.result.totalPages >= 3 && step.result.items.length > 0)
    const summaryStatements = step.proxy.sql.filter(sql => sql.includes('open_check') && sql.includes('obs AS'))
    assert.equal(summaryStatements.length, 0, 'no check-count statement on a page step')
    assert.ok(step.result.items.every(row => row.id === 110 || row.check_status), 'rows still carry their status on a page step')
  })

  await check('a session view restricts the cohort to that session, maps the status filter to the items, and carries no per-row check facts', async () => {
    const db = fixture(); seedChecks(db)
    const view = (await simpleRead(db, { branchId: '1', pageSize: '100' }, admin, { sessionId: 's-open' })).result
    assert.deepEqual(rows(view).map(row => row.id).sort((a, b) => a - b), [100, 101, 102])
    assert.ok(view.items.every(row => !Object.hasOwn(row, 'check_status')))
    assert.equal(Object.hasOwn(view, 'summary'), false, 'the session bar already carries the counts')
    assert.ok(view.facets, 'the filter menu still gets its brand and category options')
    for (const [state, expected] of [['ok', [100]], ['issue', [101]], ['in_check', [102]]]) {
      const filtered = (await simpleRead(db, { branchId: '1', checkState: state }, admin, { sessionId: 's-open' })).result
      assert.deepEqual(rows(filtered).map(row => row.id), expected, `session item state for ${state}`)
    }
    await refused(() => simpleRead(db, { branchId: '1', checkState: 'not_checked' }, admin, { sessionId: 's-open' }), 400, 'inventory_check_invalid_query', 'checkState')
    await refused(() => simpleRead(db, { branchId: '1' }, admin, { sessionId: 'bad id!' }), 400, 'inventory_check_invalid_query', 'sessionId')
  })

  await check('the membership replay (session create) uses the same cohort, including the status filter', async () => {
    const db = fixture(); seedChecks(db)
    const ids = [100, 101, 102, 103, 104, 111, 112, 201]
    const run = (query, simple) => {
      const membership = api.buildInventoryCheckProductMembershipQuery(query, ids, api.getInventoryCheckProductsAccess(admin), lowStock, simple)
      const statement = db.prepare(membership.rowsSql); statement.setAllowUnknownNamedParameters(true)
      return statement.all(membership.params).map(row => row.id)
    }
    assert.deepEqual(run({ branchId: '1', checkState: 'issue' }, { organizationId: 1 }), [101, 111])
    assert.deepEqual(run({ branchId: '1', checkState: 'in_check' }, { organizationId: 1 }), [102])
    assert.deepEqual(run({ branchId: '1', checkState: 'issue' }, { organizationId: 2 }), [104], 'a foreign organization sees only its own checks')
    assert.deepEqual(run({ branchId: '1' }, { organizationId: 1 }), ids.slice().sort((a, b) => a - b).filter(id => id !== 110))
    assert.throws(() => run({ branchId: '1', checkState: 'issue' }), error => error.status === 400, 'the old membership refuses the new parameter')
    assert.throws(() => run({ branchId: '1', startDate: '2026-10-01' }, { organizationId: 1 }), error => error.status === 400)
  })

  await check('read cost: no statement of the simple reader names sales, customers or ledger tables, and a page step reads no check counts', async () => {
    const db = fixture(); seedChecks(db)
    const { proxy } = await simpleRead(db, { branchId: '1' })
    const text = proxy.sql.join('\n')
    for (const word of ['sale_items', 'sales s', 'FROM sales', 'customers', 'returns', 'ledger AS', 'buyers', 'qty_sold', 'selling_price', 'cost_price']) assert.equal(text.includes(word), false, `${word} is not read`)
    assert.ok((await simpleRead(db, { branchId: '1' }, admin, {}, {})).proxy.sql.join('\n').includes('inventory_check_items'))
  })

  console.log(`${passed} groups passed`)
}
main().catch(error => { console.error(error); process.exit(1) })
