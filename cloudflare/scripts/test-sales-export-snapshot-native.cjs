// Mount the real reports route and canonical analytics over native SQLite.
// Reuse only the export-permission fixture setup; its assertions do not run.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
function fixture() {
  const file = path.join(__dirname, 'test-reports-export-permissions-pure.cjs')
  const source = fs.readFileSync(file, 'utf8')
  const boundary = source.indexOf('async function main()')
  assert.ok(boundary > 0)
  const harness = new Module(file, module)
  harness.filename = file; harness.paths = module.paths
  harness._compile(source.slice(0, boundary) + '\nmodule.exports={app,sql,db,load,staff,setUser(value){user=value},stats(){return {opens,reads}}};', file)
  const h = harness.exports
  h.setUser(h.staff({ all: true }))
  h.queries = []
  const prepare = h.db.prepare.bind(h.db)
  h.db.prepare = query => {
    const statement = prepare(query)
    return { ...statement, all(params) { h.queries.push({ query, params }); h.hook?.(query, params); return statement.all(params) } }
  }
  h.get = async (query = {}) => {
    const q = typeof query === 'string' ? query : new URLSearchParams({ intent: 'export', ...query }).toString()
    const response = await h.app.request(`http://local/business-summary/sales?${q}`, {}, {})
    return { status: response.status, body: await response.json() }
  }
  return h
}
const frozen = (body, extra = {}) => ({ snapshotMaxId: String(body.snapshot_max_id), exportToken: body.export_token, ...extra })
const continuation = body => frozen(body, { afterId: String(body.next_cursor.id), afterCreatedAt: body.next_cursor.created_at })
async function main() {
  let checks = 0
  const check = async (name, test) => { const h = fixture(); try { await test(h); console.log(`PASS ${name}`); checks++ } finally { h.sql.close() } }
  await check('all pages share a token and totals; timestamp ties use ID; final verify has no rows', async h => {
    h.sql.exec("UPDATE sales SET created_at='2026-09-04 03:00:00' WHERE id IN (1,2,4)")
    let page = (await h.get({ pageSize: '1' })).body
    const first = page, ids = []
    while (true) {
      ids.push(...page.rows.map(row => row.id))
      assert.equal(page.export_token, first.export_token); assert.equal(page.row_count, 3)
      assert.deepEqual(page.totals, first.totals)
      if (!page.has_more) break
      const next = await h.get({ pageSize: '1', ...continuation(page) }); assert.equal(next.status, 200); page = next.body
    }
    assert.deepEqual(ids, [4, 2, 1])
    const verified = await h.get(frozen(first, { verifyOnly: '1' }))
    assert.equal(verified.status, 200)
    assert.deepEqual(verified.body, { export_version: 1, export_token: first.export_token, snapshot_max_id: 4, row_count: 3, verified: true })
    assert.match(first.export_token, /^[a-f0-9]{64}$/)
    assert.equal((await h.get({ pageSize: '3' })).body.export_token, first.export_token, 'page size is not identity')
  })
  await check('search applies to complete cohort and exact totals, excluding unrelated voids and stock losses', async h => {
    const first = (await h.get({ q: '  ALICE  ', pageSize: '1' })).body
    assert.equal(first.row_count, 1); assert.equal(first.rows[0].id, 1)
    assert.equal(first.totals.revenue_usd, 77); assert.equal(first.totals.cost_usd, 50)
    assert.equal(first.totals.cancelled_tx_count, 0)
    assert.equal(Object.hasOwn(first.totals, 'removal_loss_usd'), false)
    assert.equal(first.totals.money_contributing_rows, 4, 'only sale/item/return/return-item count')
    assert.equal(first.rows[0].money_contributing_rows, 4, 'nonenumerable diagnostic survived cohort shaping')
    assert.equal((await h.get({ q: 'alice' })).body.export_token, first.export_token)
    for (const q of ['R1', '0123', 'Za', 'Shop', 'Cash']) assert.ok((await h.get({ q })).body.row_count > 0)
    h.sql.exec("UPDATE sales SET total_usd=999 WHERE id=4")
    assert.equal((await h.get(frozen(first, { q: 'alice', verifyOnly: '1' }))).status, 200)
  })
  await check('fractional money aggregates before rounding and receipt costs floor only at aggregate totals', async h => {
    h.sql.exec(`INSERT INTO sales(id,created_at,sale_status,customer_name,subtotal_usd,total_usd) VALUES
      (10,'2026-09-04 01:00:00','completed','fraction',.0044,.0044),
      (11,'2026-09-04 01:00:00','completed','fraction',.0044,.0044),
      (12,'2026-09-04 01:00:00','completed','floor',10,10),
      (13,'2026-09-04 01:00:00','completed','floor',10,10);
      INSERT INTO sale_items VALUES(10,10,.0044,1),(11,11,.0044,1),(12,12,1,1),(13,13,5,1);
      INSERT INTO returns(id,sale_id,total_refund_usd) VALUES(12,12,0);
      INSERT INTO return_items VALUES(12,12,3,1,'restock',1);`)
    const fraction = (await h.get({ q: 'fraction' })).body
    assert.equal(fraction.rows.reduce((sum, row) => sum + row.net_revenue_usd, 0), 0)
    assert.equal(fraction.totals.revenue_usd, .01); assert.equal(fraction.totals.cost_usd, .01)
    const floor = (await h.get({ q: 'floor' })).body
    assert.equal(floor.rows.reduce((sum, row) => sum + row.cost_usd, 0), 5)
    assert.equal(floor.totals.cost_usd, 3, 'one exact cohort cost floor, not sum of receipt floors')
  })
  for (const [name, mutation] of [
    ['receipt', "UPDATE sales SET receipt_number='changed' WHERE id=1"],
    ['search membership', "UPDATE sales SET customer_name='departed' WHERE id=1"],
    ['refund', 'UPDATE returns SET total_refund_usd=24 WHERE id=1'],
    ['totals', 'UPDATE sales SET subtotal_usd=101,total_usd=101 WHERE id=1'],
  ]) await check(`${name} edits reject both continuation and final verification`, async h => {
    const filters = name === 'search membership' ? { q: 'alice' } : {}
    const first = (await h.get({ ...filters, pageSize: '1' })).body
    h.sql.exec(mutation)
    for (const extra of [first.next_cursor ? continuation(first) : frozen(first), frozen(first, { verifyOnly: '1' })]) {
      const changed = await h.get({ ...filters, ...extra })
      assert.equal(changed.status, 409, JSON.stringify(changed.body)); assert.equal(changed.body.code, 'report_export_changed')
      assert.equal(Object.hasOwn(changed.body, 'rows'), false)
    }
  })
  await check('cost-only changes are invisible to employees but invalidate cost-authorized exports', async h => {
    const admin = (await h.get()).body
    h.setUser(h.staff({ sales: true }))
    const employee = (await h.get()).body
    assert.equal(Object.hasOwn(employee.rows[0], 'cost_usd'), false)
    assert.equal(Object.hasOwn(employee.totals, 'money_unknown_cost_lines'), false)
    h.sql.exec('UPDATE sale_items SET cost_price_usd=61 WHERE id=1')
    assert.equal((await h.get(frozen(employee, { verifyOnly: '1' }))).status, 200)
    h.setUser(h.staff({ all: true }))
    assert.equal((await h.get(frozen(admin, { verifyOnly: '1' }))).status, 409)
    h.setUser(h.staff({ sales: true, product_cost_view: true }))
    const viewer = (await h.get()).body
    assert.equal(Object.hasOwn(viewer.totals, 'cost_usd'), true)
    assert.equal(Object.hasOwn(viewer.totals, 'delivery_actual_cost_usd'), false)
    assert.equal(Object.hasOwn(viewer.totals, 'money_contributing_rows'), true)
    assert.equal(Object.hasOwn(viewer.rows[0], 'money_complete'), true)
  })
  await check('insert above frozen ceiling is excluded even when backdated; empty snapshot stays empty', async h => {
    const first = (await h.get()).body
    h.sql.exec("INSERT INTO sales(id,created_at,sale_status,subtotal_usd,total_usd) VALUES(100,'2026-09-01 00:00:00','completed',200,200)")
    assert.equal((await h.get(frozen(first, { verifyOnly: '1' }))).status, 200)
    const empty = (await h.get({ branchId: '99' })).body
    assert.equal(empty.row_count, 0); assert.equal(empty.snapshot_max_id, 0); assert.deepEqual(empty.rows, [])
    h.sql.exec('UPDATE sales SET branch_id=99 WHERE id=100')
    assert.equal((await h.get(frozen(empty, { branchId: '99', verifyOnly: '1' }))).status, 200)
  })
  await check('permissions deny before DB reads and authorization changes invalidate tokens', async h => {
    const first = (await h.get()).body
    for (const permissions of [{}, { sales: true, 'sales:export': false }, { sales: true, 'sales:view': false }]) {
      h.setUser(h.staff(permissions)); const before = h.stats().opens
      assert.equal((await h.get()).status, 403); assert.equal(h.stats().opens, before)
    }
    h.setUser(h.staff({ sales: true }))
    assert.equal((await h.get(frozen(first, { verifyOnly: '1' }))).status, 409)
  })
  await check('partial/malformed cursor or token is400; valid token cannot skip to an invented cursor', async h => {
    const first = (await h.get({ pageSize: '1' })).body
    for (const query of [
      { afterId: '1' }, { afterCreatedAt: '2026-09-04 03:00:00' }, { exportToken: first.export_token },
      { snapshotMaxId: '4' }, { verifyOnly: '1' }, { ...frozen(first), afterId: '1' },
      { ...frozen(first), afterId: '1', afterCreatedAt: 'nonsense' }, { ...frozen(first), exportToken: 'bad' },
      { ...frozen(first), snapshotMaxId: '-1' }, { ...continuation(first), verifyOnly: '1' },
      { ...frozen(first), afterId: '999', afterCreatedAt: '2026-09-04 03:00:00' },
    ]) assert.equal((await h.get(query)).status, 400, JSON.stringify(query))
    assert.equal((await h.get('intent=export&order=desc&order=asc')).status, 400)
  })
  await check('10000 receipts allowed;10001 refuses after one sentinel before reading children', async h => {
    h.sql.exec(`DELETE FROM sales; DELETE FROM sale_items; DELETE FROM returns; DELETE FROM return_items;
      WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000)
      INSERT INTO sales(id,created_at,sale_status,subtotal_usd,total_usd) SELECT x,'2026-09-04 01:00:00','completed',1,1 FROM n;`)
    const allowed = await h.get(); assert.equal(allowed.status, 200); assert.equal(allowed.body.row_count, 10000)
    h.sql.exec("INSERT INTO sales(id,created_at,sale_status,subtotal_usd,total_usd) VALUES(10001,'2026-09-04 01:00:00','completed',1,1)")
    h.queries.length = 0
    const refused = await h.get(); assert.equal(refused.status, 413); assert.equal(refused.body.code, 'report_export_too_large')
    assert.equal(h.queries.some(({ query }) => /FROM (sale_items|return_items|returns)\b/.test(query)), false)
    const rootReads = h.queries.filter(({ query }) => /FROM sales s WHERE/.test(query))
    assert.equal(rootReads.at(-1).params.reportPageSize, 1, 'only one overflow sentinel')
    assert.equal(rootReads.length, 6)
  })
  await check('ordinary paging envelope/default order and missing-token behavior remain unchanged', async h => {
    const ordinary = await h.get('pageSize=1')
    assert.equal(ordinary.status, 200)
    assert.deepEqual(Object.keys(ordinary.body).sort(), ['rows', 'snapshot_max_id', 'has_more', 'next_cursor', 'is_admin'].sort())
    assert.equal(ordinary.body.rows[0].id, 1, 'ordinary still defaults ascending')
    const page = await h.get('pageSize=1&snapshotMaxId=4&afterId=1&afterCreatedAt=2026-09-04%2002:00:00')
    assert.equal(page.status, 200); assert.equal(page.body.rows[0].id, 2)
  })
  await check('default500 walks1001 equal-timestamp receipts without omissions or duplicates', async h => {
    h.sql.exec(`WITH RECURSIVE n(x) AS (VALUES(100) UNION ALL SELECT x+1 FROM n WHERE x<1100)
      INSERT INTO sales(id,created_at,sale_status,customer_name,subtotal_usd,total_usd)
      SELECT x,'2026-09-04 01:00:00','completed','bulk',1,1 FROM n;`)
    let page = (await h.get({ q: 'bulk' })).body
    const first = page, ids = [], sizes = []
    while (true) {
      assert.equal(page.export_token, first.export_token); assert.equal(page.row_count, 1001)
      sizes.push(page.rows.length); ids.push(...page.rows.map(row => row.id))
      if (!page.has_more) break
      const next = await h.get({ q: 'bulk', ...continuation(page) }); assert.equal(next.status, 200); page = next.body
    }
    assert.deepEqual(sizes, [500, 500, 1]); assert.equal(new Set(ids).size, 1001)
    assert.deepEqual(ids, Array.from({ length: 1001 }, (_, index) => 1100 - index))
    assert.equal((await h.get(frozen(first, { q: 'bulk', verifyOnly: '1' }))).status, 200)
    assert.equal((await h.get(frozen(first, { q: 'bulk', order: 'asc', verifyOnly: '1' }))).status, 409)
  })
  await check('a newly matching receipt or continuously changing read rejects the frozen export', async h => {
    const first = (await h.get({ q: 'alice' })).body
    h.sql.exec("UPDATE sales SET customer_name='Alice' WHERE id=2")
    assert.equal((await h.get(frozen(first, { q: 'alice', verifyOnly: '1' }))).status, 409)
    let rootReads = 0
    h.hook = query => { if (/FROM sales s WHERE/.test(query)) h.sql.prepare('UPDATE returns SET total_refund_usd=? WHERE id=1').run(24 + rootReads++) }
    const changed = await h.get()
    assert.equal(changed.status, 409); assert.equal(changed.body.code, 'report_export_changed')
    assert.equal(Object.hasOwn(changed.body, 'rows'), false)
  })
  await check('export receipt option preserves the independent global scalar ceiling', async h => {
    h.sql.exec(`WITH RECURSIVE n(x) AS (VALUES(100) UNION ALL SELECT x+1 FROM n WHERE x<100100)
      INSERT INTO sale_items(id,sale_id,cost_price_usd,quantity) SELECT x,1,1,1 FROM n;`)
    const refused = await h.get()
    assert.equal(refused.status, 413); assert.equal(refused.body.code, 'report_export_too_large')
    assert.equal(Object.hasOwn(refused.body, 'rows'), false)
  })
  await check('a totals-only fractional edit changes token even when every rounded output row is identical', async h => {
    h.sql.exec(`INSERT INTO sales(id,created_at,sale_status,customer_name,subtotal_usd,total_usd) VALUES
      (10,'2026-09-04 01:00:00','completed','tiny',.0024,.0024),
      (11,'2026-09-04 01:00:00','completed','tiny',.0024,.0024);`)
    const first = (await h.get({ q: 'tiny' })).body
    assert.equal(first.totals.revenue_usd, 0)
    h.sql.exec('UPDATE sales SET subtotal_usd=.0027,total_usd=.0027 WHERE id=10')
    const next = (await h.get({ q: 'tiny' })).body
    assert.deepEqual(next.rows, first.rows)
    assert.equal(next.totals.revenue_usd, .01)
    assert.notEqual(next.export_token, first.export_token)
    assert.equal((await h.get(frozen(first, { q: 'tiny', verifyOnly: '1' }))).status, 409)
  })
  await check('explicit cancelled cohort counts selected cancelled receipts without unrelated void activity', async h => {
    const cancelled = (await h.get({ status: 'cancelled' })).body
    assert.equal(cancelled.row_count, 1); assert.equal(cancelled.rows[0].id, 3)
    assert.equal(cancelled.totals.cancelled_tx_count, 1); assert.equal(cancelled.totals.revenue_usd, 0)
    assert.equal((await h.get({ status: 'cancelled', q: 'Alice' })).body.totals.cancelled_tx_count, 0)
  })
  console.log(`${checks} native sales export groups passed`)
}
module.exports = { fixture }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
