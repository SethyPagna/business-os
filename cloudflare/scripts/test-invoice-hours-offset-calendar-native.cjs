const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const root = path.resolve(__dirname, '..')
const file = path.join(root, 'scripts/test-sale-create-atomic-pure.cjs')
let head = fs.readFileSync(file, 'utf8').split(';(async () => {')[0]
head = head.replace("'../lib/db': { getDb: (env) => env.DB },", '')
const harness = new Module(file, module); harness.filename = file; harness.paths = Module._nodeModulePaths(path.dirname(file))
harness._compile(head + '\nmodule.exports={fixture,load,executionCtx,USER,setUser(value){currentUser=value}};', file)
const h = harness.exports, f = h.fixture(), app = h.load('routes/contacts.ts').default
assert.equal(f.raw.db.limits.exprDepth, 100)
const reads = [], admin = { ...h.USER, role_code: 'admin', permissions: '{"all":true}' }
const bridge = { prepare(sql) {
  assert.ok(/^\s*SELECT\b/i.test(sql), 'read-only route must not perform a D1 write')
  reads.push(sql)
  const stmt = f.raw.db.prepare(sql)
  return { bind(...values) {
    const execute = mode => {
      if (!values.length) return stmt[mode]()
      if (/\?\d/.test(sql)) {
        const numbered = {}
        for (const match of sql.matchAll(/\?(\d+)/g)) numbered['?' + match[1]] = values[Number(match[1]) - 1]
        return stmt[mode](numbered)
      }
      return stmt[mode](...values)
    }
    return { async first() { return execute('get') || null }, async all() { return { results: execute('all'), meta: {} } }, async run() { throw new Error('no writes authorized') } }
  } }
} }
async function get(route, query = {}) {
  const response = await app.request(route + '?' + new URLSearchParams(query), {}, { DB: bridge }, h.executionCtx)
  return { status: response.status, body: await response.json() }
}
const stamps = ['2026-12-31', '2026-12-30 16:59:59', '2026-12-30T17:00:00.001Z', '2026-12-30 17:01:00', '2026-12-31T16:59:59Z', '2027-01-01T00:00:00+07:00', '2027-01-01 00:00:00', '2027-01-01', '2026-12-30', 'legacy-unknown', '2026-12-31T23:59:59+07:00', '2027-01-02']
stamps.push('2027-01-01T00:00:00+14:00','2026-12-31T23:30:00-12:00','2027-03-01T00:10:00+14:00','2027-03-01T00:12:00+14:00','2027-03-31T23:30:00-12:00','2027-02-28','2027-04-01','2025-05-07')
const rows = stamps.map((stamp, index) => ({ id: index + 101, stamp, total: (index + 1) / 100 + 0.0049, paid: index % 3 ? 0.0051 : 0, outstanding: index % 3 ? 0.02 : 0 }))
const round = value => Math.round(value * 100) / 100
function expected(query) {
  return rows.filter(row => {
    if (!query.from && !query.to && !query.createdFrom) return true
    const bare = /^\d{4}-\d{2}-\d{2}$/.test(row.stamp)
    const parsed = bare ? null : Date.parse(row.stamp.replace(' ', 'T') + (/[zZ]|[+-]\d\d:\d\d$/.test(row.stamp) ? '' : 'Z'))
    const localDay = bare ? row.stamp : Number.isFinite(parsed) ? new Date(parsed + 7 * 3600000).toISOString().slice(0, 10) : null
    if (!localDay || (query.from && localDay < query.from) || (query.to && localDay > query.to)) return false
    if (bare || !query.createdFrom) return true
    const bound = value => Date.parse(value.replace(' ', 'T') + (/[zZ]|[+-]\d\d:\d\d$/.test(value) ? '' : 'Z'))
    return parsed >= bound(query.createdFrom) && parsed < bound(query.createdTo)
  })
}
async function check(route, query, label) {
  const wanted = expected(query), result = await get(route, { ...query, page_size: '1' })
  assert.equal(result.status, 200, JSON.stringify(result))
  assert.equal(result.body.total_invoices, wanted.length, label + ' count')
  const actual = [...result.body.invoices]
  for (let page = 2; page <= wanted.length; page++) actual.push(...(await get(route, { ...query, page_size: '1', page: String(page) })).body.invoices)
  assert.deepEqual(actual.map(row => row.id).sort((a,b) => a-b), wanted.map(row => row.id), label + ' paging')
  assert.deepEqual(result.body.totals, { invoices: wanted.length, total_usd: round(wanted.reduce((sum,row) => sum + row.total, 0)), paid_usd: round(wanted.reduce((sum,row) => sum + row.paid, 0)), outstanding_usd: round(wanted.reduce((sum,row) => sum + row.outstanding, 0)), outstanding_count: wanted.filter(row => row.outstanding > 0).length }, label + ' raw-cohort aggregate rounding')
  for (const row of actual) {
    const original = rows.find(value => value.id === row.id)
    assert.equal(row.total_amount_usd, round(original.total))
    assert.equal(row.amount_paid_usd, round(original.paid))
  }
  console.log('PASS', route, label, wanted.map(row => row.id))
}

async function main() {
  try {
    h.setUser(admin)
    for (const row of rows) {
      f.raw.prepare("INSERT INTO supplier_invoices(id,source_branch,legacy_id,supplier_name,invoice_no,invoice_date,total_amount_usd,amount_paid_usd,outstanding_balance_usd,status,source_file,source_row) VALUES(?,'warehouse',?,'Independent','IND',?,?,?,?,'Imported','review',?)").run([row.id,row.id,row.stamp,row.total,row.paid,row.outstanding,row.id])
      f.raw.prepare("INSERT INTO customer_receivables(id,legacy_id,customer_name,invoice_no,invoice_date,total_amount_usd,amount_paid_usd,outstanding_balance_usd,status,source_file,source_row) VALUES(?,?,'Independent','IND',?,?,?,?,'Imported','review',?)").run([row.id,row.id,row.stamp,row.total,row.paid,row.outstanding,row.id])
    }
    const dec = {from:'2026-12-31',to:'2026-12-31'}
    const cases = [
      ['positive-offset-year-crossing',{...dec,createdFrom:'2026-12-31 09:59:00',createdTo:'2026-12-31 10:01:00'}],
      ['negative-offset-year-crossing',{from:'2027-01-01',to:'2027-01-01',createdFrom:'2027-01-01 11:29:00',createdTo:'2027-01-01 11:31:00'}],
      ['positive-offset-month-crossing-half-open',{from:'2027-02-28',to:'2027-02-28',createdFrom:'2027-02-28 10:09:00',createdTo:'2027-02-28 10:12:00'}],
      ['negative-offset-month-crossing',{from:'2027-04-01',to:'2027-04-01',createdFrom:'2027-04-01 11:29:00',createdTo:'2027-04-01 11:31:00'}],
      ['contradictory-calendar-and-clock',{...dec,createdFrom:'2027-01-01 00:00:00',createdTo:'2027-01-01 00:01:00'}],
      ['Cambodia-midnight-half-open',{...dec,createdFrom:'2026-12-30 16:59:59',createdTo:'2026-12-30 17:01:00'}],
      ['last-local-minute',{...dec,createdFrom:'2026-12-31T23:59:00+07:00',createdTo:'2027-01-01T00:00:00+07:00'}],
      ['bare-date-without-hours',{from:'2025-05-07',to:'2025-05-07'}],
      ['All-time-keeps-complete-ledger',{}],
    ]
    for (const route of ['/suppliers/reports/ap-invoices','/customers/reports/ar-invoices']) {
      for (const [label,query] of cases) await check(route,query,label)
      for (const query of [{...dec,createdFrom:'2026-12-31 00:00:00'},{...dec,createdFrom:'2026-12-31 00:00:00',createdTo:'2026-12-31 00:00:00'},{...dec,createdFrom:'2026-12-31 00:00:00',createdTo:'2026-12-31 01:00:00',startTime:'00:00'}]) assert.equal((await get(route,query)).status,400)
    }
    h.setUser({...h.USER,permissions:'{}'})
    for (const route of ['/suppliers/reports/ap-invoices','/customers/reports/ar-invoices']) assert.equal((await get(route,dec)).status,403)
    assert.ok(reads.some(sql=>/\?1/.test(sql)),'production getDb binding path must be exercised')
    console.log('PASS AP/AR actual Hono + production getDb + native depth100 offset/calendar/hour intersection; cohort money/paging/permissions')
  } finally {f.raw.db.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
