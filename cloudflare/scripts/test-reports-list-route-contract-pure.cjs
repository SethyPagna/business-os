const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
const root = path.join(__dirname, '..')
const sql = new Database(':memory:')
sql.exec(`
CREATE TABLE sales(id INTEGER PRIMARY KEY, created_at TEXT, sale_status TEXT, branch_id INTEGER, branch_name TEXT,
 cashier_name TEXT, cashier_id INTEGER, customer_name TEXT, customer_phone TEXT, receipt_number TEXT, payment_method TEXT,
 subtotal_usd REAL, discount_usd REAL DEFAULT 0, membership_discount_usd REAL DEFAULT 0, tax_usd REAL DEFAULT 0,
 total_usd REAL, delivery_fee_usd REAL DEFAULT 0, delivery_fee_paid_by TEXT DEFAULT 'customer', delivery_actual_cost_usd REAL,
 is_delivery INTEGER DEFAULT 0, source_return_id INTEGER, amount_paid_usd REAL);
CREATE TABLE sale_items(id INTEGER PRIMARY KEY, sale_id INTEGER, cost_price_usd REAL, quantity REAL);
CREATE TABLE returns(id INTEGER PRIMARY KEY, sale_id INTEGER, created_at TEXT, branch_id INTEGER, return_number TEXT,
 receipt_number TEXT, customer_name TEXT, return_scope TEXT DEFAULT 'customer', return_type TEXT, reason TEXT,
 status TEXT DEFAULT 'completed', total_refund_usd REAL DEFAULT 0, total_refund_khr REAL DEFAULT 0);
CREATE TABLE return_items(id INTEGER PRIMARY KEY, return_id INTEGER, cost_price_usd REAL, quantity REAL, stock_action TEXT, return_to_stock INTEGER);
CREATE TABLE fees(id INTEGER PRIMARY KEY, created_at TEXT, fee_date TEXT, branch_id INTEGER, sale_id INTEGER, fee_type TEXT,
 label TEXT, notes TEXT, amount_usd REAL DEFAULT 0, amount_khr REAL DEFAULT 0);
CREATE TABLE branches(id INTEGER PRIMARY KEY, name TEXT);
INSERT INTO branches VALUES(2,'Shop'),(3,'Warehouse');
INSERT INTO sales(id,created_at,sale_status,branch_id,branch_name,cashier_name,cashier_id,customer_name,customer_phone,receipt_number,payment_method,subtotal_usd,tax_usd,total_usd,delivery_fee_usd,delivery_actual_cost_usd,is_delivery)
 VALUES(1,'2026-09-04 02:00:00','completed',2,'Shop','Za',7,'Alice','0123','R1','Cash',100,5,115,10,2,1),
 (2,'2026-09-04T03:00:00.000Z','awaiting_payment',2,'Shop','Za',7,'Bob','0456','R2','Cash',200,0,205,5,1,1),
 (3,'2026-09-04 04:00:00','cancelled',2,'Shop','Za',7,'Void','','R3','Cash',900,0,900,0,NULL,0),
 (4,'2026-09-04 03:00:00','completed',3,'Warehouse','Other',8,'Other','','R4','ABA',500,0,500,0,NULL,0);
INSERT INTO sale_items VALUES(1,1,60,1),(2,2,120,1),(3,3,800,1);
INSERT INTO returns(id,sale_id,created_at,branch_id,return_number,receipt_number,customer_name,total_refund_usd) VALUES(1,1,'2026-09-04 05:00:00',2,'RET1','R1','Alice',23);
INSERT INTO returns(id,sale_id,created_at,branch_id,return_number,receipt_number,customer_name,total_refund_usd) VALUES
 (2,NULL,'2026-09-04T03:00:00.000Z',2,'RET2','R1','Alice',7),
 (3,NULL,'2026-09-04 04:00:00',2,'RET3','R1','Alice',11);
INSERT INTO return_items VALUES(1,1,10,1,'restock',1);
INSERT INTO fees VALUES(1,'2026-09-04 03:00:00','2026-09-04',2,NULL,'expense','Limes','',0,30000),
 (2,'2026-09-04T03:00:00.000Z','2026-09-04',2,NULL,'delivery','Grab','',0,14000),
 (3,'2026-09-04 03:00:00','2026-09-03',2,NULL,'expense','Older expense entered now','',0,100),
 (4,'2026-09-04 04:00:00','2026-09-03',2,NULL,'expense','At exclusive end','',0,400),
 (5,'2026-09-04 01:59:59','2026-09-03',2,NULL,'expense','Before start','',0,500),
 (6,'2026-09-03T03:00:00.000Z','2020-01-01',2,NULL,'expense','Previous system entry','',0,900);
`)
const db = { prepare(query) {
 const bind = (params = {}) => { const values=[]; const text=query.replace(/@(\w+)/g, (_,key) => { values.push(params[key] ?? null); return '?' }); return { stmt:sql.prepare(text), values } }
 return { get(params){ const b=bind(params); return b.stmt.get(...b.values) }, all(params){const b=bind(params);return b.stmt.all(...b.values)} }
} }
function load(file, overrides={}) {
 const filePath=path.join(root,'src',file)
 const output=ts.transpileModule(fs.readFileSync(filePath,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
 const m={exports:{}}
 new Function('require','module','exports',output)((name)=>name in overrides?overrides[name]:require(name),m,m.exports)
 return m.exports
}
const dates=load('lib/businessDateWindow.ts')
const saleTotals=load('lib/saleTotals.ts')
const financialPrecision=load('lib/financialPrecision.ts')
const nativeSaleChange=load('lib/nativeSaleChange.ts',{'./financialPrecision':financialPrecision,'./saleTotals':saleTotals})
const analytics=load('lib/salesAnalytics.ts',{'./db':{getDb:()=>db},'./businessDateWindow':dates})
const app=load('routes/reports.ts',{
 '../lib/db':{getDb:()=>db},'../lib/businessDateWindow':dates,'../lib/salesAnalytics':analytics,
 '../lib/saleTotals':load('lib/saleTotals.ts'),
 '../lib/auth':{requireAuth:async(c,next)=>{c.set('user',{scope:c.req.header('scope')||'all'});await next()}},
 '../lib/permissions':{getPermissionTier:(u,area)=>u.scope==='all'||u.scope===area?'read':'none',isAdminControlUser:u=>u.scope==='all'},
}).default
const base='http://local/business-summary/'
async function get(kind,query='',scope='all'){const res=await app.request(base+kind+'?startDate=2026-09-04&endDate=2026-09-04&branchId=2&'+query,{headers:{scope}},{});return {status:res.status,body:await res.json()}}
async function overview(query='',scope='all'){const res=await app.request('http://local/overview?startDate=2026-09-04&endDate=2026-09-04&branchId=2&'+query,{headers:{scope}},{});return {status:res.status,body:await res.json()}}
;(async()=>{
 const sales=await get('sales','order=asc')
 // Minimal fixture columns required by the actual canonical totals query.
 sql.exec('ALTER TABLE sale_items ADD COLUMN product_discount_usd REAL DEFAULT 0; ALTER TABLE sale_items ADD COLUMN manual_discount_usd REAL DEFAULT 0')
 async function assertCanonical(query='', extra={}) {
   const rows=(await get('sales',query)).body.rows
   const canonical=await analytics.getSalesTotals({}, {startDate:'2026-09-04',endDate:'2026-09-04',branchId:2,...extra})
   const sum=k=>rows.reduce((n,r)=>n+Number(r[k]||0),0)
   const cost=Math.max(0,sum('cost_before_floor_usd'))
   const profit=sum('gross_profit_usd')+sum('cost_usd')-cost
   for(const [actual,key] of [[cost,'cost_usd'],[profit,'profit_usd'],[sum('net_revenue_usd'),'revenue_usd'],[sum('tax_usd'),'tax_usd'],[sum('delivery_usd'),'delivery_usd']])
     assert.ok(Math.abs(actual-canonical[key])<0.001, `${key}: list ${actual}, canonical ${canonical[key]}`)
 }
 await assertCanonical()
 sql.exec('UPDATE sale_items SET cost_price_usd=NULL WHERE id=1')
 await assertCanonical()
 sql.exec('UPDATE sale_items SET cost_price_usd=60 WHERE id=1; UPDATE sales SET tax_usd=9,delivery_fee_usd=4 WHERE id=3')
 await assertCanonical('status=cancelled',{status:'cancelled'})
 assert.equal(sales.status,200);assert.deepEqual(sales.body.rows.map(r=>r.id),[1,2])
 const [paid,credit]=sales.body.rows
 assert.equal(paid.net_revenue_usd,77);assert.equal(paid.refund_usd,23);assert.equal(paid.cost_usd,50);assert.equal(paid.gross_profit_usd,35);assert.equal(paid.collected_total_usd,92)
 assert.equal(credit.net_revenue_usd,200);assert.equal(credit.pending_revenue_usd,200);assert.equal(credit.collected_total_usd,0);assert.equal(credit.gross_profit_usd,84)
 const nonadmin=await get('sales','','sales');assert.ok(!('cost_usd' in nonadmin.body.rows[0]));assert.ok(!('cost_before_floor_usd' in nonadmin.body.rows[0]));assert.ok(!('gross_profit_usd' in nonadmin.body.rows[0]))
 assert.equal((await get('sales','','fees')).status,403);assert.equal((await get('returns','','sales')).status,403);assert.equal((await get('expenses','','sales')).status,403)
 assert.deepEqual((await get('sales','q=Alice')).body.rows.map(r=>r.id),[1])
 assert.deepEqual((await get('sales','status=awaiting_payment&paymentMethod=Cash&startTime=09:30&endTime=10:30')).body.rows.map(r=>r.id),[2])
 assert.equal((await get('sales','status=cancelled')).body.rows[0].net_revenue_usd,0)
 const first=await get('sales','order=desc&pageSize=1');assert.equal(first.body.has_more,true);assert.equal(first.body.rows[0].id,2)
 sql.exec("INSERT INTO sales(id,created_at,sale_status,branch_id) VALUES(99,'2026-09-04 01:00:00','completed',2)")
 const cursor=first.body.next_cursor
 const second=await get('sales',`order=desc&pageSize=1&snapshotMaxId=${first.body.snapshot_max_id}&afterCreatedAt=${encodeURIComponent(cursor.created_at)}&afterId=${cursor.id}`)
 assert.deepEqual(second.body.rows.map(r=>r.id),[1]);assert.equal(second.body.has_more,false)
 const returns=await get('returns');assert.equal(returns.status,200);assert.deepEqual(returns.body.rows.map(r=>r.id),[2,3,1])
 const fees=await get('expenses','order=desc&pageSize=1');assert.equal(fees.body.rows[0].id,2)
 const next=await get('expenses',`order=desc&pageSize=1&snapshotMaxId=2&afterCreatedAt=${encodeURIComponent(fees.body.next_cursor.created_at)}&afterId=2`)
 assert.deepEqual(next.body.rows.map(r=>r.id),[1]);assert.equal(next.body.rows[0].amount_khr,30000)
 assert.equal((await get('sales','snapshotMaxId=0')).body.rows.length,0)
 // Endpoint date-times are one continuous half-open UTC range. The end minute
 // selected in the UI was 10:59 Cambodia, hence createdTo 04:00 UTC.
 const exact='createdFrom='+encodeURIComponent('2026-09-04 02:30:00')+'&createdTo='+encodeURIComponent('2026-09-04 04:00:00')
 assert.deepEqual((await get('sales',exact)).body.rows.map(r=>r.id),[2],'sales use the exact interval across ISO timestamps')
 const exactReturns=await get('returns',exact)
 assert.deepEqual(exactReturns.body.rows.map(r=>r.id),[2],'returns use system-entry created_at and exclude the exact upper bound')
 const exactFees=await get('expenses',exact)
 assert.deepEqual(exactFees.body.rows.map(r=>r.id),[1,2,3],'timed expenses use created_at, including an older fee_date, across both timestamp shapes')
 const expenseOverview=await overview(exact+'&compare=1','fees')
 assert.equal(expenseOverview.status,200)
 assert.deepEqual(expenseOverview.body.expenses.totals,{count:3,amount_usd:0,amount_khr:44100},'overview and detail use the same timed expense cohort')
 assert.deepEqual(expenseOverview.body.expenses.previous,{count:1,amount_usd:0,amount_khr:900},'previous comparison shifts the exact interval by one Cambodia calendar day')
 assert.equal(expenseOverview.body.previous_range.createdFrom,'2026-09-03 02:30:00')
 assert.equal(expenseOverview.body.previous_range.createdTo,'2026-09-03 04:00:00')
 const returnOverview=await overview(exact,'returns')
 assert.deepEqual(returnOverview.body.returns.totals,{count:1,refund_usd:7,refund_khr:0},'returns overview matches the exact detail cohort')
 assert.equal((await get('expenses','createdFrom='+encodeURIComponent('2026-09-04 02:30:00'))).status,400,'one-sided exact ranges reject')
 assert.equal((await get('sales','createdFrom='+encodeURIComponent('2026-09-04 04:00:00')+'&createdTo='+encodeURIComponent('2026-09-04 02:30:00'))).status,400,'reversed exact ranges reject')
 // Exercise the real bounded grouped shift-expense query, not a D1 stub.
 // Both SQLite and ISO timestamps belong to the same half-open shift.
 sql.exec('ALTER TABLE fees ADD COLUMN created_by INTEGER; UPDATE fees SET created_by=7')
 const telegram=load('lib/telegram.ts',{'./db':{getDb:()=>db},'./businessDateWindow':dates,
   './salesAnalytics':analytics,'./saleTotals':saleTotals,'./nativeSaleChange':nativeSaleChange,'./telegramLang':load('lib/telegramLang.ts')})
 const shift={user_id:7,branch_id:2,scope_mode:'per_account',opened_at:'2026-09-04T02:00:00.000Z',closed_at:'2026-09-04T04:00:00.000Z'}
 const initial=await telegram.shiftExpenses({},shift,0)
 assert.equal(initial.khr,44100,'created_at, not fee_date, assigns shift expenses')
 for(let i=0;i<12;i++) sql.prepare('INSERT INTO fees(id,created_at,fee_date,branch_id,label,amount_usd,amount_khr,created_by) VALUES(?,?,?,?,?,?,?,?)')
   .run(10+i,'2026-09-04 03:00:00','2026-09-04',2,`Group ${i}`,i+1,(i+1)*100,7)
 sql.exec(`INSERT INTO fees(id,created_at,branch_id,label,amount_usd,created_by) VALUES
   (40,'2026-09-04 03:00:00',3,'Wrong branch',900,7),
   (41,'2026-09-04T04:00:00Z',2,'At closing',900,7),
   (42,'2026-09-04 01:59:59',2,'Before opening',900,7),
   (43,'2026-09-04T03:00:00Z',2,'Other employee',5,8)`)
 const grouped=await telegram.shiftExpenses({},shift,0)
 assert.equal(grouped.usd,78);assert.equal(grouped.khr,51900);assert.equal(grouped.details.length,9)
 assert.equal(grouped.details.reduce((n,r)=>n+r.usd,0),78)
 assert.equal(grouped.details.reduce((n,r)=>n+r.khr,0),51900)
 assert.match(grouped.details[8].label,/Other expenses/)
 assert.equal((await telegram.shiftExpenses({},{...shift,scope_mode:'shop_wide'},0)).usd,83)
 assert.equal((await telegram.shiftExpenses({},{...shift,user_id:99},0)).khr,0)
 // ---- The zero-subtotal receipt: the receipt list and the Overview must be
 // measuring ONE population. The Sep 2-3 import wrote 22 receipts whose header
 // value was never recorded (ids 16842-16863). valuedSaleExpr holds them out of
 // the kernel's COGS -- they recognise no revenue, so charging their goods
 // against income would drive a day's profit negative with nothing on screen to
 // explain it -- but the per-receipt columns here were gated on recognizedExpr
 // alone, so the receipt list still billed the full cost against a $0 receipt
 // and its rows stopped summing to the Overview above them. The return line
 // exercises the reversal on the same row.
 sql.exec(`INSERT INTO sales(id,created_at,sale_status,branch_id,branch_name,cashier_name,cashier_id,customer_name,receipt_number,payment_method,subtotal_usd,tax_usd,total_usd)
   VALUES(5,'2026-09-04 02:10:00','completed',2,'Shop','Za',7,'Import','R5','Cash',0,0,0);
  INSERT INTO sale_items(id,sale_id,cost_price_usd,quantity) VALUES(5,5,45,1);
  INSERT INTO returns(id,sale_id,created_at,branch_id,return_number,receipt_number,customer_name,total_refund_usd) VALUES(5,5,'2026-09-04 02:20:00',2,'RET5','R5','Import',12);
  INSERT INTO return_items(id,return_id,cost_price_usd,quantity,stock_action,return_to_stock) VALUES(5,5,10,1,'restock',1)`)
 const unvalued=(await get('sales','q=Import')).body.rows[0]
 assert.equal(unvalued.net_revenue_usd,0,'a receipt with no recorded header value recognises no revenue')
 assert.equal(unvalued.refund_usd,0,'and a refund cannot take back more than it recognised')
 assert.equal(unvalued.cost_usd,0,'so its COGS is held out too -- profit stays a difference over one population')
 assert.equal(unvalued.cost_before_floor_usd,0)
 assert.equal(unvalued.cost_missing_snapshot_lines,0)
 assert.equal(unvalued.gross_profit_usd,0,'the row that earns nothing does not lose 45 either')
 const canonical=await analytics.getSalesTotals({},{startDate:'2026-09-04',endDate:'2026-09-04',branchId:2})
 const listRows=(await get('sales','')).body.rows
 const listCost=listRows.reduce((n,r)=>n+Number(r.cost_usd||0),0)
 assert.equal(listCost,canonical.cost_usd,`per-receipt cost sums to the Overview COGS (list ${listCost}, canonical ${canonical.cost_usd})`)
 assert.equal(canonical.unvalued_tx_count,2,'the held-out receipts are counted rather than hidden -- R5 and the header-less id 99 inserted above')
 assert.equal(canonical.unvalued_cost_usd,45)
 await assertCanonical()
 console.log('PASS report routes: real Hono/SQLite, all three readers, permissions, canonical refund/profit/credit, search/filter, mixed-time cursor and frozen insertion bound')
 console.log('PASS shift expenses: real grouped SQL, complete overflow totals, branch/employee policy, mixed timestamps and exclusive closing bound')
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>sql.close())
