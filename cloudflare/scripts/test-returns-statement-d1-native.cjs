const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { Miniflare } = require('miniflare')
const esbuild = require('esbuild')
const root = path.resolve(__dirname, '..')
;(async () => {
  const bundle = await esbuild.build({ stdin: { contents: "import app from './src/routes/returns.ts'; export default app;", resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'browser', plugins: [{ name: 'auth-only-fixture', setup(build) {
    build.onResolve({ filter: /lib\/auth$/ }, () => ({ path: 'auth', namespace: 'fixture' }))
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "export const requireAuth=async(c,next)=>{c.set('user',{id:1,username:'admin',organization_id:1,role_code:'admin'});return next()}", loader: 'ts' }))
  } }] })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'] })
  try {
    const db = await mf.getD1Database('DB')
    const statements = [
      "CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT)",
      "CREATE TABLE returns(id INTEGER PRIMARY KEY,created_at TEXT,return_scope TEXT,status TEXT,branch_id INTEGER,sale_id INTEGER,customer_id INTEGER,replacement_sale_id INTEGER,return_number TEXT,receipt_number TEXT,cashier_name TEXT,customer_name TEXT,supplier_name TEXT,reason TEXT,notes TEXT,return_type TEXT,supplier_settlement TEXT,search_normalized TEXT,total_refund_usd REAL,total_refund_khr REAL,supplier_compensation_usd REAL,supplier_compensation_khr REAL,supplier_loss_usd REAL,supplier_loss_khr REAL)",
      "CREATE TABLE customers(id INTEGER PRIMARY KEY,is_anonymous INTEGER)",
      "CREATE TABLE sales(id INTEGER PRIMARY KEY,receipt_number TEXT)",
      "CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,product_id INTEGER,product_name TEXT,stock_action TEXT)",
      "CREATE TABLE products(id INTEGER PRIMARY KEY,sku TEXT,barcode TEXT,brand TEXT,name_normalized TEXT,brand_compact TEXT)",
      "INSERT INTO system_flags VALUES('business_dataset_generation','{\"generation\":\"12345678-1234-1234-1234-123456789012\"}'),('returns_export_revision','{\"revision\":1}')",
      "INSERT INTO returns(id,created_at,return_scope,return_number,total_refund_usd,supplier_compensation_usd) VALUES(1,'2026-09-19 17:00:00','customer','one',1.234567,2.345678)",
    ]
    await db.batch(statements.map(sql => db.prepare(sql)))
    const base = { startDate: '2026-09-20', endDate: '2026-09-20' }
    const get = async query => { const response = await mf.dispatchFetch('https://fixture/export?' + new URLSearchParams({ ...base, ...query })); return { status: response.status, body: await response.json() } }
    const page = await get({})
    assert.equal(page.status, 200, JSON.stringify(page)); assert.equal(page.body.rows[0].total_refund_usd, 1.234567); assert.equal(page.body.rows[0].supplier_compensation_usd, 2.345678)
    assert.equal((await get({ verify: '1', snapshotToken: page.body.snapshotToken })).status, 200)
    const words = Array(6).fill('wordaa wordbb wordcc worddd wordee wordff wordgg wordhh').join(',')
    assert.equal((await get({ scope: 'all', search: words })).status, 200, 'exact100 expandedbindings work on nativeD1')
    const over = await get({ search: words }); assert.equal(over.status, 400, JSON.stringify(over)); assert.match(over.body.error, /query budget/)
    assert.equal((await get({ search: words, type: Array.from({ length: 20 }, (_, i) => 'type' + i).join(',') })).status, 400)
    assert.equal((await get({ search: 'wordaa', type: Array.from({ length: 20 }, (_, i) => 'type' + i).join(',') })).status, 200, 'type list uses oneJSONbinding')
    const valid = n => db.prepare('SELECT 1 n WHERE 1 IN (' + Array(n).fill('?').join(',') + ')').bind(...Array(n).fill(1)).first()
    assert.equal((await valid(100)).n, 1)
    await assert.rejects(valid(101), /too many SQL variables/i, 'negative control proves nativeD1 ceiling')
    const source = fs.readFileSync(path.join(root, 'src/lib/returnsStatementExport.ts'), 'utf8')
    assert.match(source, /fields\.slice\(i, i \+ 12\)/, 'projection objects use at most24args, below published32argcontract')
    console.log('PASS actual Returns export workerd/D1: cost projection, final verify,100binding positive/101native negative, budget400 and JSONtypefilter')
  } finally { await mf.dispose() }
})().catch(error => { console.error(error); process.exitCode = 1 })
