const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const file = path.join(__dirname, 'test-sale-create-atomic-pure.cjs'), source = fs.readFileSync(file, 'utf8'), boundary = source.indexOf(';(async () => {')
assert.ok(boundary > 0)
const harness = new Module(file, module); harness.filename = file; harness.paths = module.paths
harness._compile(source.slice(0, boundary).replace('const overrides = {', "const overrides = { './db': { getDb: env => env.DB },") + '\nmodule.exports={fixture,load,executionCtx,USER,setUser(value){currentUser=value}};', file)
const h = harness.exports, app = h.load('routes/compat.ts').default
const previousNow = Date.now
Date.now = () => Date.parse('2026-10-01T05:00:00Z')
const f = h.fixture()
const get = async url => { const response = await app.request(url, {}, { DB: f.route }, h.executionCtx); return { status: response.status, body: await response.json() } }
const dates = 'startDate=2026-09-05&endDate=2026-09-05', legacyDates = 'from=2026-09-05&to=2026-09-05'
const narrow = 'createdFrom=2026-09-05%2002:00:00&createdTo=2026-09-05T04:01:00Z'
async function main() {
  try {
    h.setUser({ ...h.USER, permissions: '{"all":true}' })
    const stamps = ['2026-09-04T16:59:59Z', '2026-09-04 17:00:00', '2026-09-05 02:00:00', '2026-09-05T03:00:00Z', '2026-09-05 04:00:59', '2026-09-05 04:01:00', '2026-09-05 16:59:59', '2026-09-05T17:00:00Z']
    for (const [index, stamp] of stamps.entries()) {
      f.raw.prepare("INSERT INTO audit_logs(user_id,user_name,action,entity,created_at) VALUES(?,?,'update','product',?)").run([index === 3 ? 72 : 71, `Account${index === 3 ? 72 : 71}`, stamp])
      f.raw.prepare('INSERT INTO legacy_deleted_sale_items(event_key,source_product_name,cashier_name,deleted_at,quantity,unit_price_usd,total_usd,source_file,source_row) VALUES(?,?,?,?,1,2,2,?,?)').run([`hour-${index}`, 'Powder', 'Cashier', stamp, 'synthetic-hours', index])
    }
    f.raw.prepare("INSERT INTO legacy_deleted_sale_items(event_key,source_product_name,quantity,total_usd,source_file,source_row) VALUES('undated','Undated',1,2,'synthetic-hours',99)").run()
    const selected = await get(`/system/audit-logs?${dates}&${narrow}&counts=users&pageSize=2`)
    assert.equal(selected.status, 200); assert.equal(selected.body.items.length, 2); assert.equal(selected.body.hasMore, true)
    assert.equal(selected.body.counts.users.reduce((sum, row) => sum + row.count, 0), 3, 'rows and roster must share exact endpoint cohort')
    const next = await get(`/system/audit-logs?${dates}&${narrow}&counts=users&pageSize=2&cursor=${selected.body.nextCursor}`)
    assert.equal(next.body.items.length, 1); assert.equal(next.body.counts, undefined); assert.equal(new Set([...selected.body.items, ...next.body.items].map(row => row.id)).size, 3)
    const removed = await get(`/system/legacy-deleted-sales?${legacyDates}&${narrow}&page_size=2`)
    assert.equal(removed.status, 200); assert.equal(removed.body.total_lines, 3); assert.deepEqual(removed.body.totals, { events: 3, lines: 3, units: 3, value_usd: 6 }); assert.equal(removed.body.items.length, 2)
    const removedNext = await get(`/system/legacy-deleted-sales?${legacyDates}&${narrow}&page_size=2&page=2`)
    assert.equal(removedNext.body.items.length, 1); assert.equal(removedNext.body.total_lines, 3)
    for (const [url, dayParams] of [['/system/audit-logs', dates], ['/system/legacy-deleted-sales', legacyDates]]) {
      const full = await get(`${url}?${dayParams}`), timed = await get(`${url}?${dayParams}&createdFrom=2026-09-04%2017:00:00&createdTo=2026-09-05%2017:00:00`)
      assert.deepEqual(timed.body.items, full.body.items, 'Cambodia full day unchanged')
      const offset = await get(`${url}?${dayParams}&createdFrom=2026-09-05T09:00:00%2B07:00&createdTo=2026-09-05T11:01:00%2B07:00`)
      assert.equal(offset.body.items.length, 3)
      for (const invalid of ['createdFrom=2026-09-05%2002:00:00', 'createdTo=2026-09-05%2004:01:00', 'createdFrom=2026-09-05%2004:01:00&createdTo=2026-09-05%2002:00:00', 'createdFrom=2026-02-30%2002:00:00&createdTo=2026-03-01%2002:00:00', `${narrow}&startTime=09:00&endTime=11:00`]) assert.equal((await get(`${url}?${dayParams}&${invalid}`)).status, 400, `${url} ${invalid}`)
    }
    assert.equal((await get('/system/legacy-deleted-sales')).body.total_lines, 9, 'undated evidence remains accessible with no range')
    h.setUser({ ...h.USER, permissions: '{"audit_log":"view"}' })
    const own = await get(`/system/audit-logs?${dates}&${narrow}&counts=users&userId=72`)
    assert.equal(own.status, 200); assert.equal(own.body.items.length, 2); assert.ok(own.body.items.every(row => row.user_id === 71)); assert.deepEqual(own.body.counts.users.map(row => row.id), [71])
    assert.equal((await get(`/system/legacy-deleted-sales?${legacyDates}&${narrow}`)).status, 403)
    h.setUser({ ...h.USER, permissions: '{}' }); assert.equal((await get(`/system/audit-logs?${dates}&${narrow}`)).status, 403)
    h.setUser({ ...h.USER, permissions: '{"all":true}' })
    f.raw.prepare("INSERT INTO audit_logs(user_id,action,entity,created_at) VALUES(71,'update','product','2026-05-01 03:00:00')").run()
    const capped = await get('/system/audit-logs?startDate=2026-05-01&endDate=2026-10-01&createdFrom=2026-04-30%2017:00:00&createdTo=2026-10-01%2017:00:00')
    assert.equal(capped.body.window.startDate, '2026-07-02'); assert.ok(capped.body.items.every(row => row.created_at > '2026-07-01'))
    assert.equal((await get('/system/audit-logs?cursor=invalid')).status, 400)
    console.log('PASS actual Hono depth100: Audit and deleted-ledger exact mixed timestamps, end-minute, full-day, counts/page/cursor, own-role gates, invalid400, 92day cap and undated evidence')
  } finally { Date.now = previousNow; f.raw.db.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
