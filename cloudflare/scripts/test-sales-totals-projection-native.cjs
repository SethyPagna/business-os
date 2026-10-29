'use strict'
// Native SQLite results are the payload oracle; adapter metrics do not certify D1 rows read or Worker CPU.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const { transformSync } = require('esbuild')
const cache = new Map()
function load(relative, overrides = {}) {
  const file = path.resolve(root, relative)
  if (cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} }
  cache.set(file, mod)
  const source = transformSync(mutateSource(file, fs.readFileSync(file, 'utf8')), { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  new Function('require', 'module', 'exports', source)((id) => {
    if (Object.hasOwn(overrides, id)) return overrides[id]
    if (id.startsWith('.')) {
      const resolved = path.resolve(path.dirname(file), id)
      return load(path.relative(root, path.extname(resolved) ? resolved : resolved + '.ts'), overrides)
    }
    return require(id)
  }, mod, mod.exports)
  return mod.exports
}
const analytics = load('src/lib/salesAnalytics.ts', {
  './db': { getDb() { throw new Error('No fixture requested in export-only stage') } },
})
assert.equal(typeof analytics.readSalesReportTotals, 'function', 'MISSING_HELPER: readSalesReportTotals must be exported by the actual salesAnalytics.ts module')
console.log('PASS actual readSalesReportTotals export; running native fixture/reducer checks')

const Database = require('better-sqlite3')
const opened = new Set()
const filters = { startDate: '2026-09-01', endDate: '2026-09-30', branchId: 2 }
const headerKept = ['id','sale_status','status_before_return','subtotal_usd','discount_usd','membership_discount_usd','tax_usd','total_usd','delivery_fee_usd','delivery_fee_paid_by','delivery_actual_cost_usd','is_delivery','source_return_id','amount_paid_usd','amount_paid_khr','exchange_rate','delivery_has_linked_fee']
const precisionKeys = ['money_precision_version','calculated_total_usd','rounding_adjustment_usd']
const headerOmitted = ['created_at','branch_id','branch_name','cashier_id','cashier_name','customer_id','customer_name','customer_phone','receipt_number','payment_method','customer_is_anonymous','delivery_contact_id','delivery_contact_name']
const itemKept = ['id','sale_id','quantity','total_usd','cost_price_usd','product_discount_usd','manual_discount_usd']
function schema(precise = true) {
  const sql = new Database(':memory:'); opened.add(sql)
  sql.exec(`
    CREATE TABLE customers(id INTEGER PRIMARY KEY,is_anonymous INTEGER DEFAULT 0);
    CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE fees(id INTEGER PRIMARY KEY,sale_id INTEGER,fee_type TEXT${precise ? ',delivery_contact_id INTEGER,delivery_contact_name TEXT,amount_usd REAL,amount_khr REAL,created_at TEXT,fee_date TEXT,branch_id INTEGER' : ''});
    CREATE TABLE sales(id INTEGER PRIMARY KEY,created_at TEXT,sale_status TEXT,branch_id INTEGER,branch_name TEXT,
      cashier_id INTEGER,cashier_name TEXT,customer_id INTEGER,customer_name TEXT,customer_phone TEXT,receipt_number TEXT,payment_method TEXT,
      subtotal_usd REAL,discount_usd REAL DEFAULT 0,membership_discount_usd REAL DEFAULT 0,tax_usd REAL DEFAULT 0,total_usd REAL,
      delivery_fee_usd REAL DEFAULT 0,delivery_fee_paid_by TEXT DEFAULT 'customer',delivery_actual_cost_usd REAL,is_delivery INTEGER DEFAULT 0,
      source_return_id INTEGER,amount_paid_usd REAL${precise ? ',status_before_return TEXT,amount_paid_khr REAL DEFAULT 0,exchange_rate REAL DEFAULT 4000,delivery_contact_id INTEGER,delivery_contact_name TEXT,money_precision_version INTEGER NOT NULL DEFAULT 0,calculated_total_usd REAL,rounding_adjustment_usd REAL NOT NULL DEFAULT 0' : ''});
    CREATE TABLE sale_items(id INTEGER PRIMARY KEY,sale_id INTEGER,product_id INTEGER,product_name TEXT,quantity REAL,total_usd REAL,
      cost_price_usd REAL,product_discount_usd REAL DEFAULT 0,manual_discount_usd REAL DEFAULT 0,pricing_snapshot_json TEXT);
    CREATE TABLE returns(id INTEGER PRIMARY KEY,sale_id INTEGER,status TEXT DEFAULT 'completed',return_scope TEXT DEFAULT 'customer',total_refund_usd REAL${precise ? ',owed_reduction_usd REAL DEFAULT 0,refund_currency TEXT,money_precision_version INTEGER NOT NULL DEFAULT 0,calculated_refund_usd REAL,rounding_adjustment_usd REAL NOT NULL DEFAULT 0' : ''});
    CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,cost_price_usd REAL,quantity REAL,stock_action TEXT,return_to_stock INTEGER${precise ? ',sale_item_id INTEGER,total_usd REAL,refund_snapshot_json TEXT' : ''});
    ${precise ? 'CREATE TABLE delivery_contacts(id INTEGER PRIMARY KEY,name TEXT);' : ''}
  `)
  return sql
}
function seedPrecise(sql) {
  sql.exec(`
    INSERT INTO customers(id,is_anonymous) VALUES(1,0),(2,1);
    INSERT INTO sales(id,created_at,sale_status,branch_id,receipt_number,subtotal_usd,total_usd,money_precision_version,calculated_total_usd,rounding_adjustment_usd,amount_paid_usd,customer_id)
    VALUES(1,'2026-09-01 01:00:00','completed',2,'Fixture-A',10.004,10.01,1,10.0055,.0045,10.01,1),
          (2,'2026-09-02 01:00:00','awaiting_payment',2,'Fixture-B',5.004,5,1,5.004,-.004,0,2),
          (3,'2026-09-03 01:00:00','cancelled',2,'Fixture-C',7,7,1,7,0,7,1),
          (4,'2026-09-04 01:00:00','completed',3,'Other-branch',20,20,1,20,0,20,1);
    INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,total_usd,cost_price_usd)
    VALUES(11,1,101,'Fictional powder',1,10.004,2),(22,2,102,'Fictional serum',1,5.004,NULL),
          (33,3,103,'Cancelled fixture',1,7,1),(44,4,104,'Other branch fixture',1,20,3);
    INSERT INTO delivery_contacts(id,name) VALUES(9,'Fictional courier');
    INSERT INTO fees(id,sale_id,fee_type,delivery_contact_id,delivery_contact_name,amount_usd,amount_khr,created_at,fee_date,branch_id)
    VALUES(1,1,'delivery',9,'Fictional courier',1.25,0,'2026-09-01 01:00:00','2026-09-01',2),
          (2,NULL,'delivery',9,'Fictional courier',.5,0,'2026-09-02 01:00:00','2026-09-02',2);
  `)
}
function queryKind(query, rows) {
  if (!rows.length || !Object.hasOwn(rows[0], 'id')) return 'other'
  if (/\bFROM\s+return_items\s+ri\b/i.test(query)) return 'returnItems'
  if (/\bFROM\s+returns\s+r\b/i.test(query)) return 'returns'
  if (/\bFROM\s+sale_items\s+si\b/i.test(query)) return 'items'
  if (/\bFROM\s+fees\s+f\b/i.test(query)) return 'deliveryFees'
  if (/\bFROM\s+sales\s+s\s+WHERE\b/i.test(query)) return Object.hasOwn(rows[0], 'subtotal_usd') ? 'sales' : 'voidSales'
  return 'other'
}
function fixtureParams(params = {}) {
  const value = item => item instanceof ArrayBuffer ? Buffer.from(item) : ArrayBuffer.isView(item) ? Buffer.from(item.buffer, item.byteOffset, item.byteLength) : item
  return Array.isArray(params) ? params.map(value) : Object.fromEntries(Object.entries(params).map(([key, item]) => [key, value(item)]))
}
function kernel(sql, hooks = {}) {
  cache.clear()
  const metrics = { calls: 0, statements: 0, batches: 0, atomicBatches: 0, rowsReturned: 0, resultBytes: 0, scalarRowsReturned: 0, groups: { sales: [], voidSales: [], items: [], returns: [], returnItems: [], deliveryFees: [] } }
  function record(query, result, one) {
    const rows = one ? (result ? [result] : []) : result
    const kind = queryKind(query, rows)
    metrics.rowsReturned += rows.length
    metrics.resultBytes += Buffer.byteLength(JSON.stringify(result ?? null), 'utf8')
    if (kind !== 'other') { metrics.groups[kind].push(...rows); metrics.scalarRowsReturned += rows.length }
    return { rows, kind }
  }
  function read(query, params, one) {
    hooks.before?.({ query, params, sql })
    const statement = sql.prepare(query), bound = fixtureParams(params)
    assert.equal(statement.readonly, true, 'Report fixture reads must be read-only')
    metrics.calls++; metrics.statements++
    const args = Array.isArray(bound) ? bound : [bound]
    const result = one ? statement.get(...args) : statement.all(...args)
    const { rows, kind } = record(query, result, one)
    hooks.after?.({ query, params, sql, rows, kind })
    return result
  }
  const db = {
    prepare(query) { return { all(params = {}) { return read(query, params, false) }, get(params = {}) { return read(query, params, true) } } },
    async batch(statements) {
      assert.ok(Array.isArray(statements) && statements.length > 0)
      metrics.calls++; metrics.batches++; metrics.statements += statements.length
      if (statements.some(item => item.sql.includes('report_restore_state_changed'))) metrics.atomicBatches++
      hooks.beforeBatch?.({ statements, sql })
      const results = sql.transaction(() => statements.map(item => {
        const statement = sql.prepare(item.sql), bound = fixtureParams(item.params)
        assert.equal(statement.reader, true, 'Batch must return actual SELECT rows')
        assert.equal(statement.readonly, true, 'Read batch must not mutate the fixture')
        return { success: true, results: statement.all(...(Array.isArray(bound) ? bound : [bound])), meta: { changes: 0 } }
      }))()
      results.forEach((result, index) => record(statements[index].sql, result.results, false))
      hooks.afterBatch?.({ statements, sql, results })
      return results
    },
  }
  const lib = load('src/lib/salesAnalytics.ts', { './db': { getDb: () => db } })
  return { lib, metrics, db }
}
function cohortRows(rows) {
  const seen = new Map()
  for (const row of rows) {
    if (seen.has(row.id)) assert.deepEqual(row, seen.get(row.id), 'Repeated stable passes must contain the same operands')
    else seen.set(row.id, row)
  }
  return [...seen.values()]
}

async function oracle(sql, f = filters, includeFees = false, scope, options = {}, hooks) {
  const { lib, metrics } = kernel(sql, hooks)
  const snapshot = await lib.readSalesReportSnapshot({}, f, includeFees, scope, options)
  const totals = lib.salesTotalsFromSnapshot(snapshot)
  return { result: { totals, sale_count: snapshot.sales.length, cancelled_count: snapshot.voidSales.length, precision_mode: snapshot.precision_mode, row_count: snapshot.row_count }, diagnostic: lib.reportMoneyDiagnostic(totals), snapshot, metrics }
}
async function projection(sql, f = filters, includeFees = false, scope, options = {}, hooks) {
  const { lib, metrics } = kernel(sql, hooks)
  const result = await lib.readSalesReportTotals({}, f, includeFees, scope, options)
  return { result, diagnostic: lib.reportMoneyDiagnostic(result.totals), metrics }
}
function sameResult(full, reduced) {
  assert.deepEqual(Object.keys(reduced.result).sort(), ['totals','sale_count','cancelled_count','precision_mode','row_count'].sort(), 'do not expose reduced row arrays as a general snapshot')
  assert.deepEqual(reduced.result, full.result, 'new helper must use the existing full snapshot/reducer semantics')
  assert.deepEqual(reduced.diagnostic, full.diagnostic, 'non-enumerable money diagnostic must survive, including unknown-cost completeness')
  assert.equal(full.metrics.scalarRowsReturned, 2 * full.result.row_count, 'Full reader retains two scalar passes')
  assert.equal(reduced.metrics.scalarRowsReturned, (reduced.metrics.atomicBatches ? 1 : 2) * reduced.result.row_count, 'Actual atomic image or two-pass fallback must contain the complete cohort')
  for (const group of Object.keys(full.metrics.groups)) assert.deepEqual(cohortRows(reduced.metrics.groups[group]).map(row => row.id), cohortRows(full.metrics.groups[group]).map(row => row.id), 'Exact cohort membership ' + group)
  assert.ok(reduced.metrics.calls <= full.metrics.calls, 'projection must not add native adapter reads')
}
function sameRowsWithoutMetadata(full, reduced, precise) {
  assert.ok(full.metrics.groups.sales.length > 0 && reduced.metrics.groups.sales.length > 0, 'positive native sale rows required')
  const keys = [...headerKept, ...(precise ? precisionKeys : [])].sort()
  for (const row of reduced.metrics.groups.sales) {
    assert.deepEqual(Object.keys(row).sort(), keys, 'actual returned totals sale row has only retained operands')
    for (const name of headerOmitted) assert.equal(Object.hasOwn(row, name), false, `native sale result must omit ${name}`)
  }
  for (const row of reduced.metrics.groups.items) assert.deepEqual(Object.keys(row).sort(), [...itemKept].sort(), 'actual item rows omit product display identity')
  for (const row of reduced.metrics.groups.voidSales) assert.deepEqual(Object.keys(row), ['id'], 'void row keeps only keyset/count identity')
  for (const group of ['returns','returnItems','deliveryFees']) assert.deepEqual(cohortRows(reduced.metrics.groups[group]), cohortRows(full.metrics.groups[group]), `${group} proof/fee operands remain intact`)
}
const failures = []
let passed = 0
async function check(name, run) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY, 'i').test(name)) return
  try { await run(); passed++; console.log(`PASS ${name}`) }
  catch (error) { failures.push({ name, code: error?.code, message: error?.stack || String(error) }); console.error(`FAIL ${name}\n${error?.stack || error}`) }
}


function mutateSource(file, text) {
  if (path.resolve(file) !== path.resolve(root, 'src/lib/salesAnalytics.ts') || !process.env.MUTANT) return text
  if (process.env.MUTANT === 'force-full') {
    const from = "purpose === 'full' || totalsFields.has(key)"
    assert.equal(text.split(from).length, 2, 'MUTANT_SEAM_MISSING: actual shared projection selector must be unique')
    return text.replace(from, 'true')
  }
  if (process.env.MUTANT === 'omit-item-total') {
    const pattern = /const REPORT_TOTALS_ITEM_FIELDS = new Set\(\[([\s\S]*?)\]\)/
    const found = text.match(pattern)
    assert.ok(found && found[1].includes("'total_usd',"), 'MUTANT_SEAM_MISSING: retained item total')
    return text.replace(pattern, found[0].replace("'total_usd',", ''))
  }
  if (process.env.MUTANT === 'wrong-cohort') {
    const start = text.indexOf('export async function readSalesReportTotals(')
    const end = text.indexOf('\nconst REPORT_EXACT_KEYS', start)
    assert.ok(start >= 0 && end > start, 'MUTANT_SEAM_MISSING: actual totals wrapper')
    const body = text.slice(start, end), from = 'const capturedScope = captureSalesReportScalarScope(scalarScope)'
    assert.equal(body.split(from).length, 2, 'MUTANT_SEAM_MISSING: actual captured cohort')
    return text.slice(0, start) + body.replace(from, 'const capturedScope = (captureSalesReportScalarScope(scalarScope), null)') + text.slice(end)
  }
  throw new Error('Unknown MUTANT; use force-full, omit-item-total or wrong-cohort')
}
function seedRefund(sql) {
  const entitlement = load('src/lib/customerReturnEntitlement.ts')
  const allocation = { discount_usd: 2, membership_discount_usd: 0, tax_usd: 1, net_entitlement_usd: 9 }
  const proof = (quantity, before) => {
    const after = before + quantity
    const beforeMoney = entitlement.prorateCustomerReturnMoney4(9, before, 1)
    const afterMoney = entitlement.prorateCustomerReturnMoney4(9, after, 1)
    const calculated = Number((afterMoney - beforeMoney).toFixed(4))
    return JSON.stringify({ version: 1, sale_id: 1, sale_item_id: 11, line_key: 'line-11', pool_key: 'pool-11',
      source_sale_revision: 1, source_pricing_snapshot_digest: 'a'.repeat(64), sold_quantity: 1, return_quantity: quantity,
      returned_quantity_before: before, returned_quantity_after: after, receipt_allocation: allocation, net_entitlement_usd: 9,
      calculated_refund_before_usd: beforeMoney, calculated_refund_after_usd: afterMoney,
      calculated_refund_usd: calculated, calculated_refund_khr: calculated * 4000, exchange_rate: 4000,
      sale_product_entitlement_usd: 9, sale_product_payout_cap_usd: 9 })
  }
  sql.exec(`
    INSERT INTO sales(id,created_at,sale_status,branch_id,subtotal_usd,discount_usd,tax_usd,total_usd,money_precision_version,calculated_total_usd,rounding_adjustment_usd)
    VALUES(1,'2026-09-03 01:00:00','completed',2,10,2,1,9,1,9,0),(2,'2026-09-04 01:00:00','completed',2,10,2,1,9,0,NULL,0);
    INSERT INTO sale_items(id,sale_id,quantity,total_usd,cost_price_usd) VALUES(11,1,1,10,1),(22,2,1,10,1);
    INSERT INTO returns(id,sale_id,status,return_scope,total_refund_usd,money_precision_version,calculated_refund_usd,rounding_adjustment_usd)
    VALUES(101,1,'completed','customer',3.01,1,3.0141,-.0041),(102,1,'completed','customer',5.99,1,5.9859,.0041),(201,2,'completed','customer',5,0,NULL,0);
    INSERT INTO return_items(id,return_id,cost_price_usd,quantity,stock_action,return_to_stock) VALUES(2001,201,1,1,'restock',1);
  `)
  const insert = sql.prepare(`INSERT INTO return_items(id,return_id,cost_price_usd,quantity,stock_action,return_to_stock,sale_item_id,total_usd,refund_snapshot_json)
    VALUES(@id,@returnId,1,@quantity,'restock',1,11,@total,@snapshot)`)
  insert.run({ id: 1001, returnId: 101, quantity: .3349, total: 3.0141, snapshot: proof(.3349, 0) })
  insert.run({ id: 1002, returnId: 102, quantity: .6651, total: 5.9859, snapshot: proof(.6651, .3349) })
}
async function errorResult(run) {
  try { await run(); return { succeeded: true } }
  catch (error) { return { code: error?.code ?? null, name: error?.name } }
}
async function matchingError(sql, expectedCode) {
  const full = await errorResult(() => oracle(sql))
  assert.equal(full.code, expectedCode, 'positive control: unchanged full reducer must reject the fixture for the intended reason')
  const reduced = await errorResult(() => projection(sql))
  assert.deepEqual(reduced, full, 'MALFORMED_ERROR_PARITY: projection must preserve the full reader/reducer error')
}

;(async () => {
  await check('canonical totals, unknown cost diagnostic, and actual projected native columns', async () => {
    const sql = schema(); seedPrecise(sql)
    const full = await oracle(sql), reduced = await projection(sql)
    sameResult(full, reduced); sameRowsWithoutMetadata(full, reduced, true)
    assert.equal(reduced.result.precision_mode, 'canonical_v1')
    assert.equal(reduced.diagnostic.complete, false)
    assert.equal(reduced.diagnostic.unknown_cost_lines, 1)
    assert.equal(reduced.metrics.scalarRowsReturned, 2 * reduced.result.row_count, 'stable snapshot must read two complete scalar passes')
    assert.ok(full.metrics.groups.voidSales.length > 0 && reduced.metrics.groups.voidSales.length > 0, 'cancelled count is a positive control')
    for (const name of headerOmitted) assert.ok(Object.hasOwn(full.metrics.groups.sales[0], name), `full reader still returns ${name}`)
    const fullAtomic = await oracle(sql, {}), atomic = await projection(sql, {})
    sameResult(fullAtomic, atomic); sameRowsWithoutMetadata(fullAtomic, atomic, true)
    assert.equal(atomic.metrics.atomicBatches, 1); assert.equal(atomic.metrics.batches, 3)
    assert.ok(atomic.metrics.statements > atomic.metrics.calls, 'Batch statements and physical adapter calls stay separate')
    const { db, metrics } = kernel(sql)
    const binary = await db.batch([{ sql: 'SELECT CAST(@bytes AS BLOB) AS b', params: { bytes: new Uint8Array([0, 255]).buffer } }, { sql: 'SELECT 2 AS n' }])
    assert.deepEqual(Array.from(binary[0].results[0].b), [0, 255]); assert.equal(binary[1].results[0].n, 2)
    assert.equal(metrics.calls, 1); assert.equal(metrics.statements, 2); assert.equal(metrics.scalarRowsReturned, 0, 'Control SELECTs are not item rows')
    await assert.rejects(() => db.batch([{ sql: 'DELETE FROM sale_items RETURNING id' }]), /read-only|read only|Read batch/)
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sale_items').get().n, 4, 'Read adapter rejected the write before mutation')

  })
  await check('explicit delivery fees retain full rows and contributing-row semantics', async () => {
    const sql = schema(); seedPrecise(sql)
    const full = await oracle(sql, filters, true), reduced = await projection(sql, filters, true)
    sameResult(full, reduced); sameRowsWithoutMetadata(full, reduced, true)
    assert.equal(full.snapshot.deliveryFees.length, 2)
    const without = await projection(sql)
    assert.equal(reduced.result.row_count, without.result.row_count + 2)
  })
  await check('cancelled, exact captured scalar scope, and empty filters preserve membership', async () => {
    const sql = schema(); seedPrecise(sql)
    const cancelled = { ...filters, status: 'cancelled' }
    sameResult(await oracle(sql, cancelled), await projection(sql, cancelled))
    let fullCalls = 0, reducedCalls = 0
    const capture = counter => alias => {
      counter(); assert.equal(alias, 's')
      return { sql: 's.id=@reportScope_saleId', params: { reportScope_saleId: 1 } }
    }
    const full = await oracle(sql, filters, false, capture(() => fullCalls++))
    const reduced = await projection(sql, filters, false, capture(() => reducedCalls++))
    sameResult(full, reduced)
    assert.equal(fullCalls, 1); assert.equal(reducedCalls, 1, 'cohort callback is captured once for every pass')
    assert.equal(reduced.result.sale_count, 1)
    const empty = { ...filters, startDate: '2020-01-01', endDate: '2020-01-02' }
    const zero = await projection(sql, empty); sameResult(await oracle(sql, empty), zero)
    assert.equal(zero.result.sale_count, 0); assert.equal(zero.result.cancelled_count, 0); assert.equal(zero.result.row_count, 0)
  })
  await check('long Khmer metadata proves actual native result UTF8 payload reduction', async () => {
    const sql = schema(); seedPrecise(sql)
    const sale = sql.prepare(`INSERT INTO sales(id,created_at,sale_status,branch_id,subtotal_usd,total_usd,money_precision_version,calculated_total_usd,rounding_adjustment_usd)
      VALUES(?,'2026-09-05 01:00:00','completed',2,1.2345,1.23,1,1.2345,-.0045)`)
    const item = sql.prepare('INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,total_usd,cost_price_usd) VALUES(?,?,1,?,1,1.2345,.3333)')
    const metadata = 'ហាងសាកល្បង🙂"\\'.repeat(96)
    assert.ok(Buffer.byteLength(metadata, 'utf8') > metadata.length * 2, 'fixture must distinguish UTF8 bytes from JS string length')
    for (let id = 100; id < 180; id++) { sale.run(id); item.run(id * 10, id, metadata) }
    sql.prepare(`UPDATE sales SET branch_name=@text,cashier_name=@text,customer_name=@text,customer_phone=@text,
      receipt_number=@text||id,payment_method=@text,delivery_contact_name=@text`).run({ text: metadata })
    sql.prepare('UPDATE sale_items SET product_name=?,pricing_snapshot_json=?').run(metadata, JSON.stringify({ unused_by_both_readers: metadata }))
    const full = await oracle(sql), reduced = await projection(sql)
    sameResult(full, reduced)
    assert.ok(full.metrics.resultBytes > 100_000, 'positive control: full native results must really contain bulky metadata')
    assert.ok(reduced.metrics.resultBytes < full.metrics.resultBytes * .4, 'ACTUAL_NATIVE_PAYLOAD_REDUCTION: totals must omit display values in SQLite results, not just its returned wrapper')
    sameRowsWithoutMetadata(full, reduced, true)
    console.log(JSON.stringify({ measurement: 'long-khmer-metadata', tier: 'native-sqlite-proxy',
      full: { result_utf8_bytes: full.metrics.resultBytes, returned_rows: full.metrics.rowsReturned, scalar_returned_rows: full.metrics.scalarRowsReturned, issued_adapter_read_calls: full.metrics.calls },
      totals: { result_utf8_bytes: reduced.metrics.resultBytes, returned_rows: reduced.metrics.rowsReturned, scalar_returned_rows: reduced.metrics.scalarRowsReturned, issued_adapter_read_calls: reduced.metrics.calls },
      row_count: reduced.result.row_count, caveat: 'Returned rows and adapter all/get calls; not D1 meta.rows_read, enforced Worker Free budget, or Worker CPU.' }))
  })
  await check('legacy schema truly omits absent precision properties and retains recorded decimal cost', async () => {
    const sql = schema(false)
    sql.exec("INSERT INTO sales(id,created_at,sale_status,branch_id,subtotal_usd,total_usd) VALUES(1,'2026-09-01 01:00:00','completed',2,100,100)")
    const add = sql.prepare('INSERT INTO sale_items(id,sale_id,quantity,total_usd,cost_price_usd) VALUES(?,1,.33335,1,1.23456)')
    for (let id = 1; id <= 100; id++) add.run(id)
    const full = await oracle(sql), reduced = await projection(sql)
    sameResult(full, reduced); sameRowsWithoutMetadata(full, reduced, false)
    assert.equal(reduced.result.precision_mode, 'exact_recorded')
    assert.equal(reduced.result.totals.cost_usd, 41.15, 'existing native-reader legacy boundary control')
    for (const row of reduced.metrics.groups.sales) for (const key of precisionKeys) assert.equal(Object.hasOwn(row, key), false, 'legacy omission must not be synthesized as NULL')
  })
  await check('immutable v1 refund proofs and mixed v0/v1 totals remain unchanged', async () => {
    const sql = schema(); seedRefund(sql)
    const full = await oracle(sql), reduced = await projection(sql)
    sameResult(full, reduced); sameRowsWithoutMetadata(full, reduced, true)
    assert.ok(reduced.metrics.groups.returnItems.some(row => typeof row.refund_snapshot_json === 'string' && row.refund_snapshot_json.length > 200), 'real refund proof must reach the actual native result')
  })
  for (const [name, setup, mutate, expected] of [
    ['malformed header saved money', seedPrecise, sql => sql.exec('UPDATE sales SET subtotal_usd=1.00001 WHERE id=1'), 'invalid_saved_money4'],
    ['malformed item saved money', seedPrecise, sql => sql.exec('UPDATE sale_items SET total_usd=1.00001 WHERE id=11'), 'invalid_saved_money4'],
    ['malformed missing refund proof', seedRefund, sql => sql.exec('UPDATE return_items SET refund_snapshot_json=NULL WHERE id=1001'), 'unsupported_row'],
    ['malformed refund proof object', seedRefund, sql => sql.exec("UPDATE return_items SET refund_snapshot_json='{}' WHERE id=1001"), 'unsupported_row'],
    ['malformed refund header equation', seedRefund, sql => sql.exec('UPDATE returns SET rounding_adjustment_usd=0 WHERE id=101'), 'unsupported_row'],
  ]) await check(name, async () => { const sql = schema(); setup(sql); mutate(sql); await matchingError(sql, expected) })
  function coherenceFixture() {
    const sql = schema()
    sql.exec(`INSERT INTO sales(id,created_at,sale_status,branch_id,subtotal_usd,total_usd,money_precision_version,calculated_total_usd,rounding_adjustment_usd)
      VALUES(1,'2026-09-01 01:00:00','completed',2,3,3,1,3,0);
      INSERT INTO sale_items(id,sale_id,quantity,total_usd,cost_price_usd) VALUES(11,1,1,1,1),(12,1,1,2,2)`)
    return sql
  }
  await check('two-pass retained values refuse swaps even when final aggregate costs stay equal', async () => {
    for (const read of [oracle, projection]) {
      const sql = coherenceFixture(); let changes = 0
      const error = await errorResult(() => read(sql, filters, false, undefined, {}, { after({ kind, rows }) {
        if (kind === 'items' && rows.length) { changes++; sql.exec('UPDATE sale_items SET cost_price_usd=CASE WHEN cost_price_usd=1 THEN 2 ELSE 1 END WHERE id IN(11,12)') }
      } }))
      assert.equal(error.code, 'snapshot_changed', 'comparing aggregate totals alone would miss a retained-value swap')
      assert.ok(changes >= 4, 'two complete read attempts must be made before refusing')
    }
  })
  await check('two-pass retry discards the first changed cohort before exposing coherent totals', async () => {
    const outputs = []
    for (const read of [oracle, projection]) {
      const sql = coherenceFixture(); let reads = 0
      const output = await read(sql, filters, false, undefined, {}, { after({ kind, rows }) {
        if (kind === 'items' && rows.length && ++reads === 1) sql.exec('UPDATE sale_items SET cost_price_usd=2 WHERE id=11')
      } })
      assert.equal(reads, 4, 'changed first pair must be discarded, then two stable passes agree')
      assert.equal(output.result.totals.cost_usd, 4)
      outputs.push({ result: output.result, diagnostic: output.diagnostic })
    }
    assert.deepEqual(outputs[1], outputs[0])
  })
  await check('restore entering between passes refuses both readers without partial output', async () => {
    for (const read of [oracle, projection]) {
      const sql = coherenceFixture(); let changed = false
      const error = await errorResult(() => read(sql, filters, false, undefined, {}, { after({ kind, rows }) {
        if (!changed && kind === 'items' && rows.length) { changed = true; sql.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").run(JSON.stringify({ mode: 'restore' })) }
      } }))
      assert.equal(changed, true); assert.equal(error.code, 'maintenance_restore')
    }
  })
  await check('receipt ceiling preserves the existing export-too-large error contract', async () => {
    const sql = schema(); seedPrecise(sql)
    const full = await errorResult(() => oracle(sql, filters, false, undefined, { maxReceipts: 1 }))
    const reduced = await errorResult(() => projection(sql, filters, false, undefined, { maxReceipts: 1 }))
    assert.equal(full.name, 'SalesReportExportTooLargeError'); assert.deepEqual(reduced, full)
  })
})().catch(error => { failures.push({ name: 'runner', message: error?.stack || String(error) }); console.error(error) })
  .finally(() => {
    for (const sql of opened) sql.close()
    if (!passed && !failures.length) failures.push({ name: 'selection', message: 'ONLY matched no checks' })
    console.log(JSON.stringify({ status: failures.length ? 'FAIL' : 'PASS', passed, failed: failures.map(row => row.name), mutant: process.env.MUTANT || null,
      evidence_scope: 'Actual native SQLite query results and existing reducer; no D1 rows_read/CPU/public-route certificate.' }))
    if (failures.length) process.exitCode = 1
  })

