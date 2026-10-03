const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const file = path.join(__dirname, 'test-invoice-hours-native.cjs')
const source = fs.readFileSync(file, 'utf8')
const fixture = new Module(file, module)
fixture.filename = file
fixture.paths = module.paths
fixture._compile(source.slice(0, source.lastIndexOf(';(async () => {')) + '\nmodule.exports={h,f,get,admin};', file)
const { h, f, get, admin } = fixture.exports
async function main() {
  try {
    h.setUser(admin)
    const stamps = ['2026-09-01', '2026-09-01 03:00:00', '2026-09-02', '2026-09-02T03:00:00Z', '2026-09-02T10:00:00+07:00']
    for (const [index, stamp] of stamps.entries()) {
      f.raw.prepare("INSERT INTO supplier_invoices(id,source_branch,legacy_id,supplier_name,invoice_no,invoice_date,total_amount_usd,amount_paid_usd,outstanding_balance_usd,status,source_file,source_row) VALUES(?,'shop',?,'Scope','X',?,3,1,2,'Not Yet Paid','scope',?)").run([index+1,index+1,stamp,index+1])
      f.raw.prepare("INSERT INTO customer_receivables(id,legacy_id,customer_name,invoice_no,invoice_date,total_amount_usd,amount_paid_usd,outstanding_balance_usd,status,source_file,source_row) VALUES(?,?,'Scope','X',?,3,1,2,'Not Yet Paid','scope',?)").run([index+1,index+1,stamp,index+1])
    }
    for (const route of ['/suppliers/reports/ap-invoices', '/customers/reports/ar-invoices']) {
      for (const bounds of [
        {createdFrom:'2026-09-02 02:00:00',createdTo:'2026-09-02 04:00:00'},
        {createdFrom:'2026-09-01 02:00:00',createdTo:'2026-09-02 04:00:00'},
      ]) {
        const query = {from:'2026-09-01',to:'2026-09-01',page_size:'1',...bounds}
        const expected = bounds.createdFrom.startsWith('2026-09-02') ? [1] : [1,2]
        const first = await get(route,query)
        assert.equal(first.status,200)
        assert.equal(first.body.total_invoices,expected.length,'timestamp bounds must intersect explicit calendar scope')
        assert.deepEqual(first.body.totals,{invoices:expected.length,total_usd:expected.length*3,paid_usd:expected.length,outstanding_usd:expected.length*2,outstanding_count:expected.length})
        const rows = [...first.body.invoices]
        if (expected.length>1) rows.push(...(await get(route,{...query,page:'2'})).body.invoices)
        assert.deepEqual(rows.map(row=>row.id).sort(),expected)
      }
      const unrestricted = await get(route)
      assert.equal(unrestricted.body.total_invoices,5,'All-time retains imported evidence')
      const normal = await get(route,{from:'2026-09-02',to:'2026-09-02',createdFrom:'2026-09-02 02:00:00',createdTo:'2026-09-02 04:00:00',page_size:'100'})
      assert.deepEqual(normal.body.invoices.map(row=>row.id).sort(),[3,4,5],'unknown clocks and normal space/ISO/offset records retain policy')
    }
    console.log('PASS actual AP/AR depth100: calendar/exact intersection, contradictory and overlapping bounds, unknown-time preservation, offset clocks, money/count/pages and All-time')
  } finally { f.raw.db.close() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
