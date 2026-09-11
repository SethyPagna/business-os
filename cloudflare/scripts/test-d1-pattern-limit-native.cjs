// Native D1 enforces a 50-byte LIKE/GLOB pattern limit that better-sqlite3
// does not. Keep this a workerd test: the production defect is invisible in
// the existing SQLite route suites.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const { Miniflare } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const migrations = path.join(__dirname, '../migrations')
const migrationName = '0156_d1_pattern_limit_guards.sql'
const tables = ['sale_record_events', 'return_mutation_receipts', 'return_create_receipts', 'return_create_guards', 'fee_operation_receipts']

function oldSchema() {
  const db = new Database(':memory:')
  for (const file of fs.readdirSync(migrations).filter(f => f.endsWith('.sql') && f < migrationName).sort()) db.exec(fs.readFileSync(path.join(migrations, file), 'utf8'))
  return db
}

// Split only literal GLOB patterns with fixed-width tokens. Each character
// class or literal consumes exactly one input character, so conjunction of
// substring matches preserves the original language, including UUID version
// and variant positions. No wildcard pattern is rewritten.
function boundedPatterns(sql) {
  return sql.replace(/\b(\w+) GLOB '([^']+)'/g, (original, column, pattern) => {
    if (Buffer.byteLength(pattern) <= 50) return original
    const tokens = pattern.match(/\[[^\]]+\]|./g)
    assert.ok(tokens.every(t => t !== '*' && t !== '?'))
    const groups = []; let group = [], bytes = 0, start = 1
    for (const token of tokens) {
      if (bytes + Buffer.byteLength(token) > 50) {
        groups.push(`substr(${column},${start},${group.length}) GLOB '${group.join('')}'`)
        start += group.length; group = []; bytes = 0
      }
      group.push(token); bytes += Buffer.byteLength(token)
    }
    groups.push(`substr(${column},${start},${group.length}) GLOB '${group.join('')}'`)
    return `(${groups.join('\n      AND ')})`
  })
}

function migrationText() {
  const db = oldSchema()
  const objects = db.prepare("SELECT name,tbl_name,type,sql FROM sqlite_master WHERE sql IS NOT NULL").all()
  const affected = objects.filter(o => /\b(?:LIKE|GLOB)\s+'[^']{51,}'/i.test(o.sql))
  assert.deepEqual(affected.map(o => o.name).sort(), [...tables].sort(), 'audit every active table/trigger/index, not historical migration text')
  let sql = `-- 0156: retain exact UUID/timestamp validation within native D1's 50-byte\n-- LIKE/GLOB pattern limit. The old 251-byte UUID CHECK aborts sale events,\n-- rolling back settlement/status transactions. Historical migrations remain immutable.\n--\n-- Run through D1 migrations apply (one atomic transaction including the ledger).\n-- No foreign key points INTO these five tables. Their outward references,\n-- all rows/IDs, indexes, CHECKs and immutable triggers are preserved.\n-- PRE/POST: compare each table's complete rows and sales/returns/fees/stock\n-- counters. The EXCEPT assertions below compare every copied column in both\n-- directions before dropping any original table. A failure rolls everything back.\n-- Recovery: retain this corrected schema when rolling application code back;\n-- never delete replay receipts. Use the pre-migration D1 bookmark only under\n-- coordinated maintenance if transaction/ledger postflight is inconsistent.\n\nCREATE TABLE _pattern_guard_0156(value INTEGER NOT NULL CHECK(value=1));\n`
  for (const name of tables) {
    const definition = objects.find(o => o.type === 'table' && o.name === name).sql
    sql += '\n' + boundedPatterns(definition).replace(`CREATE TABLE ${name}`, `CREATE TABLE ${name}_0156`) + ';\n'
    sql += `INSERT INTO ${name}_0156 SELECT * FROM ${name};\n`
    sql += `INSERT INTO _pattern_guard_0156 SELECT CASE WHEN\n  NOT EXISTS(SELECT * FROM ${name} EXCEPT SELECT * FROM ${name}_0156)\n  AND NOT EXISTS(SELECT * FROM ${name}_0156 EXCEPT SELECT * FROM ${name})\n  THEN 1 ELSE 0 END;\n`
    for (const obj of objects.filter(o => o.tbl_name === name && o.type === 'trigger')) sql += `DROP TRIGGER ${obj.name};\n`
    sql += `DROP TABLE ${name};\nALTER TABLE ${name}_0156 RENAME TO ${name};\n`
    for (const obj of objects.filter(o => o.tbl_name === name && o.type !== 'table')) sql += obj.sql + ';\n'
  }
  sql += '\nDROP TABLE _pattern_guard_0156;\n'
  db.close()
  return sql
}

if (process.argv.includes('--print-migration-patch')) {
  console.log('*** Begin Patch\n*** Add File: ' + path.join(migrations, migrationName).replaceAll('\\', '/') + '\n' + migrationText().split('\n').map(l => '+' + l).join('\n') + '\n*** End Patch')
} else if (require.main === module) {
  const run = process.argv.includes('--routes-only')
    ? verifyRealSettlementRoute(fs.readFileSync(path.join(migrations,migrationName),'utf8'))
    : main()
  run.catch(e => { console.error(e); process.exitCode = 1 })
}

async function main() {
  const migration = fs.readFileSync(path.join(migrations, migrationName), 'utf8')
  assert.equal(migration.trimEnd(), migrationText().trimEnd())
  assert.ok(!migration.includes('\r'), 'trigger SQL must be LF-only')
  const original = oldSchema()
  const objects = original.prepare("SELECT name,tbl_name,type,sql FROM sqlite_master WHERE sql IS NOT NULL").all()
  const mf = new Miniflare({ modules: true, script: '', d1Databases: ['DB'] })
  try {
    const db = await mf.getD1Database('DB')
    await db.batch([
      db.prepare('CREATE TABLE sales(id INTEGER PRIMARY KEY,sale_status TEXT)'),
      db.prepare('CREATE TABLE returns(id INTEGER PRIMARY KEY)'),
      db.prepare('CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT)'),
      ...objects.filter(o => tables.includes(o.tbl_name)).sort((a,b) => (a.type === 'table' ? 0 : 1) - (b.type === 'table' ? 0 : 1)).map(o => db.prepare(o.sql)),
      db.prepare("INSERT INTO sales VALUES(17000,'awaiting_payment')"),
      db.prepare('INSERT INTO returns VALUES(1)'),
    ])
    const uuid = '12345678-1234-4234-8234-123456789abc'
    const event = () => db.prepare("INSERT INTO sale_record_events(id,sale_id,source_kind,source_id,generation,kind,via,occurred_at,changes_json) VALUES(?,17000,'sale_settlement','test',0,'payment_settled','apply','2026-09-11T10:00:00.000Z','[{}]')").bind(uuid)
    await assert.rejects(db.batch([db.prepare("UPDATE sales SET sale_status='completed' WHERE id=17000"),event()]), /LIKE or GLOB pattern too complex/)
    assert.equal((await db.prepare('SELECT sale_status FROM sales').first()).sale_status, 'awaiting_payment')
    console.log('PASS original native D1 event CHECK aborts settlement and atomically rolls back sale status')
    // This fixture-only pragma lets old, valid historical rows be present in
    // the broken schema; the migration itself NEVER disables any CHECK.
    await db.batch([db.prepare('PRAGMA ignore_check_constraints=ON'), event(),
      db.prepare("INSERT INTO return_mutation_receipts VALUES(?,1,1,17000,'edit','request',?, '{}','{\"id\":1,\"updated_at\":\"stamp\"}','stamp')").bind(uuid,'a'.repeat(64)),
      db.prepare("INSERT INTO return_create_receipts VALUES(?,1,1,17000,'request',?, '{\"sale_id\":17000}','{\"id\":1,\"returnNumber\":\"R1\",\"replacementSaleId\":null,\"replacementReceiptNumber\":null}','2026-09-11T10:00:00.000Z')").bind(uuid,'a'.repeat(64)),
      db.prepare("INSERT INTO return_create_guards VALUES(?,'precondition',1)").bind(uuid),
      db.prepare("INSERT INTO fee_operation_receipts VALUES(?,1,1,'request-1',?,'{}','{\"fee\":{\"id\":1}}','2026-09-11T10:00:00.000Z')").bind(uuid,'a'.repeat(64)),
      db.prepare('PRAGMA ignore_check_constraints=OFF'),
    ])
    const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async t => [t,(await db.prepare(`SELECT * FROM ${t}`).all()).results])))
    const before = await snapshot()
    const statements = split(migration).map(sql => db.prepare(sql))
    // Inject a final failure to prove DDL, copies, triggers and rows roll back.
    await assert.rejects(db.batch([...statements,db.prepare('SELECT * FROM absent_postcondition_0156')]), /no such table/)
    assert.deepEqual(await snapshot(), before)
    assert.match((await db.prepare("SELECT sql FROM sqlite_master WHERE name='sale_record_events'").first()).sql, /id GLOB/)
    await db.batch(statements)
    assert.deepEqual(await snapshot(), before)
    const currentObjects = (await db.prepare("SELECT name,tbl_name,type,sql FROM sqlite_master WHERE sql IS NOT NULL").all()).results
    for (const obj of objects.filter(o => tables.includes(o.tbl_name) && o.type !== 'table')) assert.equal(currentObjects.find(o => o.name === obj.name)?.sql.replace(/\s+/g,' '), obj.sql.replace(/\s+/g,' '))
    assert.ok(currentObjects.every(o => !/\b(?:LIKE|GLOB)\s+'[^']{51,}'/i.test(o.sql)))
    for (const t of tables.filter(t => t !== 'return_create_guards')) {
      await assert.rejects(db.prepare(`UPDATE ${t} SET id=id`).run(), /immutable/)
      await assert.rejects(db.prepare(`DELETE FROM ${t}`).run(), /immutable/)
    }
    console.log('PASS populated migration preserves every column, index and trigger; failure restores original schema/data')
    await db.batch([db.prepare("UPDATE sales SET sale_status='completed' WHERE id=17000"), db.prepare("INSERT INTO sale_record_events SELECT '22345678-1234-4234-8234-123456789abc',sale_id,source_kind,'after',generation,kind,via,subject,actor_id,actor_username,occurred_at,changes_json,request_digest,response_json FROM sale_record_events WHERE id=?").bind(uuid)])
    assert.equal((await db.prepare('SELECT sale_status FROM sales').first()).sale_status,'completed')
    for (const invalid of [uuid.toUpperCase(),uuid.replace('-4','-3'),uuid.replace('-8','-7'),uuid.slice(1),uuid.replace('a','g')]) {
      await assert.rejects(db.prepare("INSERT INTO return_create_guards VALUES(?,'postcondition',1)").bind(invalid).run(),/CHECK constraint/)
    }
    for (const stamp of ['2026-09-11T10:00:00X000Z','2026-09-11 10:00:00.000Z','2026-09-11T1A:00:00.000Z']) {
      await assert.rejects(db.prepare("INSERT INTO fee_operation_receipts VALUES('32345678-1234-4234-8234-123456789abc',1,2,'request-2',?,'{}','{\"fee\":{\"id\":2}}',?)").bind('a'.repeat(64),stamp).run(),/CHECK constraint/)
    }
    console.log('PASS corrected event commits status; invalid UUID version/variant/hex/case/length and timestamp shapes reject')
  } finally { original.close(); await mf.dispose() }
  await verifyRealSettlementRoute(migration)
  await verifyWranglerMigration(migration)
}

async function verifyWranglerMigration(migration) {
  const os = require('node:os')
  const { spawnSync } = require('node:child_process')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'bos-pattern-migration-'))
  const persist = path.join(dir,'persist')
  const config = path.join(dir,'wrangler.json')
  const migrationFile = path.join(dir,'migrations',migrationName)
  const id = '00000000-0000-0000-0000-000000000156'
  fs.mkdirSync(path.dirname(migrationFile))
  fs.writeFileSync(config,JSON.stringify({name:'pattern-migration-test',compatibility_date:'2026-09-01',d1_databases:[{binding:'DB',database_name:'pattern-migration-test',database_id:id}]}))
  const wrangler = path.join(path.dirname(require.resolve('wrangler/package.json')),'bin/wrangler.js')
  const env = {...process.env,WRANGLER_SEND_METRICS:'false',CI:'true'}
  for (const key of Object.keys(env)) if (/^(CLOUDFLARE_|CF_)/.test(key)) delete env[key]
  const apply = () => {
    const result = spawnSync(process.execPath,[wrangler,'d1','migrations','apply','pattern-migration-test','--local','--config',config,'--persist-to',persist],{cwd:dir,env,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024})
    if (result.error) throw result.error
    return {status:result.status,output:result.stdout+result.stderr}
  }
  const local = () => new Miniflare({modules:true,script:'',d1Databases:{DB:id},d1Persist:path.join(persist,'v3/d1')})
  const original = oldSchema()
  const objects = original.prepare("SELECT type,sql FROM sqlite_master WHERE sql IS NOT NULL AND tbl_name IN ('sale_record_events','return_mutation_receipts','return_create_receipts','return_create_guards','fee_operation_receipts') ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END").all()
  let mf = local()
  let before
  const snapshot = async db => Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await db.prepare(`SELECT * FROM ${t}`).all()).results])))
  try {
    const db = await mf.getD1Database('DB')
    await db.batch([db.prepare('CREATE TABLE sales(id INTEGER PRIMARY KEY)'),db.prepare('CREATE TABLE returns(id INTEGER PRIMARY KEY)'),db.prepare('CREATE TABLE system_flags(key TEXT,value TEXT)'),...objects.map(o=>db.prepare(o.sql)),db.prepare('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)'),db.prepare('INSERT INTO sales VALUES(17000)'),db.prepare('INSERT INTO returns VALUES(1)')])
    const uuid = '12345678-1234-4234-8234-123456789abc'
    await db.batch([db.prepare('PRAGMA ignore_check_constraints=ON'),
      db.prepare("INSERT INTO sale_record_events(id,sale_id,source_kind,source_id,generation,kind,via,occurred_at,changes_json) VALUES(?,17000,'sale_settlement','test',0,'payment_settled','apply','2026-09-11T10:00:00.000Z','[{}]')").bind(uuid),
      db.prepare("INSERT INTO return_mutation_receipts VALUES(?,1,1,17000,'edit','request',?,'{}','{\"id\":1,\"updated_at\":\"stamp\"}','stamp')").bind(uuid,'a'.repeat(64)),
      db.prepare("INSERT INTO return_create_receipts VALUES(?,1,1,17000,'request',?,'{\"sale_id\":17000}','{\"id\":1,\"returnNumber\":\"R1\",\"replacementSaleId\":null,\"replacementReceiptNumber\":null}','2026-09-11T10:00:00.000Z')").bind(uuid,'a'.repeat(64)),
      db.prepare("INSERT INTO return_create_guards VALUES(?,'precondition',1)").bind(uuid),
      db.prepare("INSERT INTO fee_operation_receipts VALUES(?,1,1,'request-1',?,'{}','{\"fee\":{\"id\":1}}','2026-09-11T10:00:00.000Z')").bind(uuid,'a'.repeat(64)),db.prepare('PRAGMA ignore_check_constraints=OFF')])
    before = await snapshot(db)
  } finally { await mf.dispose();original.close() }
  // Only the wrapper's final ledger INSERT fails, after all migration SQL.
  fs.writeFileSync(migrationFile,migration+`\nINSERT INTO d1_migrations(name) VALUES('${migrationName}');\n`)
  const failed = apply()
  assert.notEqual(failed.status,0,failed.output)
  assert.match(failed.output,/UNIQUE constraint failed.*d1_migrations.name/s)
  mf = local()
  try {
    const db = await mf.getD1Database('DB')
    assert.deepEqual(await snapshot(db),before)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM d1_migrations').first()).n,0)
    assert.match((await db.prepare("SELECT sql FROM sqlite_master WHERE name='sale_record_events'").first()).sql,/id GLOB/)
  } finally { await mf.dispose() }
  fs.writeFileSync(migrationFile,migration)
  const success = apply()
  assert.equal(success.status,0,success.output)
  mf = local()
  try {
    const db = await mf.getD1Database('DB')
    assert.deepEqual(await snapshot(db),before)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM d1_migrations WHERE name=?').bind(migrationName).first()).n,1)
    assert.doesNotMatch((await db.prepare("SELECT sql FROM sqlite_master WHERE name='sale_record_events'").first()).sql,/id GLOB/)
    assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length,0)
  } finally { await mf.dispose() }
  console.log('PASS actual Wrangler local migration preserves all five populated tables; last-ledger conflict rolls back schema/data/ledger, exact migration applies once')
}

async function verifyRealSettlementRoute(migration) {
  // Reuse only the existing real-Hono route loader and seed, replacing its
  // instantaneous SQLite D1 adapter with native workerd for every DB call.
  const source = fs.readFileSync(path.join(__dirname, 'test-payment-fx-pure.cjs'), 'utf8').split('async function run() {')[0]
    .replace('if (actual.has(path.posix.basename(name))) return load(target)', 'return load(target)')
    .replace('sendTelegramEvent: async () => {}', 'sendTelegramEvent: async () => {}, sendReturnTelegramEvent: async () => {}')
  const { sales, fixture, seed, request, load, settlementAction } = new Function('require','__dirname', source + '\nreturn { sales, fixture, seed, request, load, settlementAction };')(require,__dirname)
  const fees = load('routes/fees.ts').default
  const returns = load('routes/returns.ts').default
  const f = fixture(); seed(f)
  // Historical migration0098 seeds 4,240 unrelated fees. This isolated route
  // fixture starts with no expenses so one request has an exact cardinality.
  f.sql.exec('DELETE FROM fees')
  f.sql.exec("INSERT INTO users(id,username,name,password) VALUES(1,'admin','Admin','test')")
  const original = oldSchema()
  const required = new Set([...tables,'sales','sale_items','users','returns','return_items','settings','sale_item_batch_allocations','sale_write_revisions','sale_mutation_receipts','sale_mutation_guards','sale_bulk_guards','action_history','audit_logs','system_flags','products','branches','branch_stock','inventory_movements','fees','delivery_contacts','return_write_revisions','return_bulk_guards','return_item_batch_allocations','return_replacement_items','damaged_stock_lots','product_batches','branch_batch_stock','transfer_operation_receipts'])
  required.add('customers')
  // Preserve all transitive foreign-key targets instead of turning FK checks off.
  for (const name of required) for (const fk of original.prepare(`PRAGMA foreign_key_list(${name})`).all()) required.add(fk.table)
  const objects = original.prepare("SELECT name,tbl_name,type,sql FROM sqlite_master WHERE sql IS NOT NULL").all().filter(o => required.has(o.tbl_name))
  const mf = new Miniflare({ modules: true, script: '', d1Databases: ['DB'] })
  try {
    const db = await mf.getD1Database('DB')
    await db.batch(objects.filter(o => o.type === 'table').map(o => db.prepare(o.sql)))
    const inserts = []
    for (const name of required) for (const row of f.sql.prepare(`SELECT * FROM ${name}`).all()) {
      const columns = Object.keys(row)
      inserts.push(db.prepare(`INSERT INTO ${name}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).bind(...Object.values(row)))
    }
    await db.batch([db.prepare('PRAGMA defer_foreign_keys=ON'),...inserts])
    // Product search/activation triggers belong to other surfaces and reference
    // their own tables; this route never writes products. Keep every trigger
    // on settlement-mutated tables, including the real revision guards.
    await db.batch(objects.filter(o => o.type === 'index' || (o.type === 'trigger' && ([...tables,'sales','sale_items','returns','return_items','return_item_batch_allocations'].includes(o.tbl_name) || o.name==='transfer_receipts_require_provenance_insert'))).map(o => db.prepare(o.sql)))
    const context = { waitUntil() {}, passThroughOnException() {} }
    const call = async body => {
      const response = await sales.request('/1/status',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)},{DB:db},context)
      return {status:response.status,body:await response.json()}
    }
    // The real route sees the exact same old CHECK failure as production.
    // Hono's generic 500 body is text, so inspect this raw response directly.
    const broken = await sales.request('/1/status',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(request('native-before'))},{DB:db},context)
    assert.equal(broken.status,500)
    assert.equal((await db.prepare('SELECT sale_status FROM sales WHERE id=1').first()).sale_status,'awaiting_payment')
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM sale_mutation_receipts').first()).n,0)
    await db.batch(split(migration).map(sql=>db.prepare(sql)))
    const body = request('native-after')
    const applied = await call(body)
    assert.equal(applied.status,200,JSON.stringify(applied))
    assert.equal(applied.body.sale_status,'completed')
    assert.equal(applied.body.payment_method,'Legacy Cash + ABA Bank')
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM sale_record_events').first()).n,1)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM sale_mutation_receipts').first()).n,1)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM inventory_movements').first()).n,0)
    const replay = await call(body)
    assert.equal(replay.status,200)
    assert.equal(replay.body.operationId,applied.body.operationId)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM sale_record_events').first()).n,1)
    console.log('PASS real Hono settlement on native D1 fails before repair, commits exact payment/receipt/event after repair, and retries without duplicate stock or event')
    await db.batch([
      db.prepare("UPDATE sales SET sale_status='awaiting_payment',amount_paid_usd=0,amount_paid_khr=0,payment_method=NULL,payment_details='[]',subtotal_usd=54,total_usd=54 WHERE id=1"),
      db.prepare('UPDATE sale_items SET quantity=2,applied_price_usd=27,total_usd=54,base_price_usd=30,manual_discount_usd=3 WHERE sale_id=1'),
    ])
    const screenshot = await call({client_request_id:'native-screenshot-54',sale_status:'completed',expected_updated_at:applied.body.updated_at,expected_exchange_rate:4200,payment_details:[{method:'ABA Bank',amount_usd:54,amount_khr:0}]})
    assert.equal(screenshot.status,200,JSON.stringify(screenshot))
    assert.equal(screenshot.body.amount_paid_usd,54)
    assert.deepEqual(await db.prepare('SELECT quantity,applied_price_usd,total_usd,base_price_usd,manual_discount_usd FROM sale_items WHERE sale_id=1').first(),{quantity:2,applied_price_usd:27,total_usd:54,base_price_usd:30,manual_discount_usd:3})
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM inventory_movements').first()).n,0)
    console.log('PASS native $54 unpaid discounted-line settlement records ABA payment without changing quantities, unit discounts, USD totals or stock')
    const actor = {id:1,username:'admin',name:'Admin',role_code:'admin',permissions:{all:true}}
    await settlementAction.replaySaleSettlementAction({DB:db},actor,'undo',screenshot.body.actionHistoryId,0,{operation_id:screenshot.body.operationId})
    assert.equal((await db.prepare('SELECT sale_status FROM sales WHERE id=1').first()).sale_status,'awaiting_payment')
    await settlementAction.replaySaleSettlementAction({DB:db},actor,'redo',screenshot.body.actionHistoryId,1,{operation_id:screenshot.body.operationId})
    assert.equal((await db.prepare('SELECT amount_paid_usd FROM sales WHERE id=1').first()).amount_paid_usd,54)
    const reopen = await call({client_request_id:'native-reopen-payment',sale_status:'awaiting_payment'})
    assert.equal(reopen.status,200,JSON.stringify(reopen))
    const corrected = await call({client_request_id:'native-correct-payment',sale_status:'completed',replace_existing_payment:true,expected_exchange_rate:4200,payment_details:[{method:'ABA Bank',amount_usd:20,amount_khr:142800}]})
    assert.equal(corrected.status,200,JSON.stringify(corrected))
    assert.equal(corrected.body.paymentCorrection,true)
    assert.equal(corrected.body.amount_paid_usd,20)
    assert.equal(corrected.body.amount_paid_khr,142800)
    console.log('PASS native settlement undo/redo, plain status reopen, mixed USD/KHR correction and immutable replay events')
    const invoke = async (route,url,method,body) => {
      let batchError
      const observedDb={prepare:sql=>db.prepare(sql),batch:async statements=>{try{return await db.batch(statements)}catch(error){batchError=error.message;throw error}}}
      const response=await route.request(url,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)},{DB:observedDb},context)
      const text=await response.text();let result;try{result=JSON.parse(text)}catch{result={error:text}}
      return {status:response.status,body:result,...(batchError?{batchError}:{})}
    }
    const feeBody={client_request_id:'native-fee-create',fee_type:'expense',label:'Packing tape',amount_usd:2.5,amount_khr:0,fee_date:'2026-09-11',branch_id:1,delivery_contact_id:null}
    const fee=await invoke(fees,'/','POST',feeBody)
    assert.equal(fee.status,201,JSON.stringify(fee))
    const feeRetry=await invoke(fees,'/','POST',feeBody)
    assert.equal(feeRetry.status,200,JSON.stringify(feeRetry))
    assert.equal(feeRetry.body.fee.id,fee.body.fee.id)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM fee_operation_receipts').first()).n,1)
    assert.equal((await invoke(fees,'/','POST',{...feeBody,amount_usd:3})).status,409)
    console.log('PASS native actual fee create, exact retry and changed-request conflict preserve one fee/receipt')
    const returnBody={client_request_id:'native-return-create',sale_id:1,reason:'Wrong size',branch_id:1,items:[{sale_item_id:1,product_id:1,quantity:1,applied_price_usd:27,stock_action:'none',branch_id:1}]}
    const returned=await invoke(returns,'/','POST',returnBody)
    assert.equal(returned.status,200,JSON.stringify(returned))
    const returnRetry=await invoke(returns,'/','POST',returnBody)
    assert.equal(returnRetry.status,200,JSON.stringify(returnRetry))
    assert.equal(returnRetry.body.id,returned.body.id)
    const row=await db.prepare('SELECT * FROM returns WHERE id=?').bind(returned.body.id).first()
    const editBody={client_request_id:'native-return-edit',expected_updated_at:row.updated_at,reason:'Customer changed mind'}
    const edited=await invoke(returns,'/'+row.id,'PATCH',editBody)
    assert.equal(edited.status,200,JSON.stringify(edited))
    const editRetry=await invoke(returns,'/'+row.id,'PATCH',editBody)
    assert.equal(editRetry.status,200,JSON.stringify(editRetry))
    assert.deepEqual(editRetry.body,edited.body)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM return_create_receipts').first()).n,1)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM return_mutation_receipts').first()).n,1)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM inventory_movements').first()).n,0)
    console.log('PASS native actual linked return create/edit, exact retries and immutable receipts with no stock action')
  } finally { f.sql.close(); original.close(); await mf.dispose() }
}

module.exports = { oldSchema, boundedPatterns, migrationText, tables }
