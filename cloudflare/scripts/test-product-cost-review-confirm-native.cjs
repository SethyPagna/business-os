const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const database = openDb(loadAll(path.resolve(__dirname, '../migrations')))
const raw = database.db
let beforeBatch = null, beforeRead = null, afterBatch = null
let lastBatchError = null
const DB = { prepare(sql) {
  let values = []
  const statement = { sql, bind(...args) { values = args; return statement },
    async all() { if(beforeRead)beforeRead(sql); return { results: raw.prepare(sql).all(...values) } },
    async first() { return raw.prepare(sql).get(...values) ?? null },
    async run() { const prepared = raw.prepare(sql); if (prepared.columns().length) return { success: true, results: prepared.all(...values), meta: { changes: 0 } }; const result = prepared.run(...values); return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } } }
  }; return statement
}, async batch(statements) { if (beforeBatch) { const hook = beforeBatch; beforeBatch = null; hook() }; let results=[]; raw.exec('BEGIN IMMEDIATE'); try { for (const statement of statements) results.push(await statement.run()); raw.exec('COMMIT') } catch (error) { lastBatchError = error; raw.exec('ROLLBACK'); throw error }; if(afterBatch){const hook=afterBatch;afterBatch=null;hook()};return results } }
const root = path.resolve(__dirname, '../src'), cache = new Map()
const services = { auth: { requireAuth: async (c, next) => { c.set('user', c.env.TEST_USER); await next() } }, cache: { bumpVersion: async () => {} }, broadcastHub: { broadcast: async () => {} } }
function load(filename) {
  filename = path.resolve(filename)
  if (cache.has(filename)) return cache.get(filename).exports
  const mod = { exports: {} }; cache.set(filename, mod)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: filename }).outputText
  new Function('require', 'module', 'exports', output)(request => {
    const name = request.split('/').pop()
    if (services[name]) return services[name]
    if (!request.startsWith('.')) return require(request)
    return load(path.resolve(path.dirname(filename), request.endsWith('.ts') ? request : `${request}.ts`))
  }, mod, mod.exports)
  return mod.exports
}
const helper = load(path.join(root, 'lib/productCostReview.ts'))
const migratedGuard = raw.prepare("SELECT sql FROM sqlite_master WHERE name='product_cost_review_update_guard_0255'").get().sql
assert.equal(migratedGuard.trim(), helper.productCostReviewConfirmationGuardSql().trim().replace(/;$/, ''))
assert.equal(fs.readFileSync(path.resolve(__dirname,'../migrations/0257_product_cost_review_confirmation.sql'),'utf8').includes('\r'),false)
const app = load(path.join(root, 'routes/productCost.ts')).default
const admin = { id: 1, username: 'admin', name: 'Admin', role_code: 'admin' }
const context = { waitUntil: () => {}, passThroughOnException: () => {} }
async function request(method, url, body, user = admin) { const response = await app.request(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, { DB, TEST_USER: user }, context); return { status: response.status, body: await response.json() } }
function setup(run) {
  raw.exec('BEGIN IMMEDIATE')
  try {
    raw.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
    const value = run()
    raw.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
    raw.exec('COMMIT')
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
    return value
  } catch (error) { raw.exec('ROLLBACK'); throw error }
}
function seed(usd) { return setup(() => {
  const id = Number(raw.prepare('INSERT INTO products(name,cost_price_usd,purchase_price_usd,cost_price_khr,purchase_price_khr) VALUES(?,?,?,?,?)').run('Review fixture', usd, usd, 5.124456789, 5.124456789).lastInsertRowid)
  raw.exec('DROP TRIGGER product_cost_review_update_guard_0255')
  raw.prepare('UPDATE products SET cost_review_key=? WHERE id=?').run('a'.repeat(32), id)
  raw.exec(process.env.CONFIRM_BASELINE === '1' ? helper.productCostReviewUpdateGuardSql() : migratedGuard)
  return id
}) }
const snapshot = () => JSON.stringify(['products','audit_logs','product_cost_entries'].map(table => raw.prepare(`SELECT * FROM ${table} ORDER BY id`).all()))
;(async () => {
  const id = seed(7.123456789012345)
  const read = await request('GET', `/${id}/cost-breakdown`)
  assert.equal(read.status, 200)
  assert.equal(read.body.costConfirmation.usd, 7.123456789012345)
  const body = { client_request_id: 'confirm-known-abcdefgh', reviewed_digest: read.body.costConfirmation.reviewed_digest, value: read.body.costConfirmation.usd }
  const before = snapshot()
  const confirmed = await request('POST', `/${id}/cost-review/confirm`, body)
  assert.equal(confirmed.status, 200, JSON.stringify({confirmed,batchError:lastBatchError?.message}))
  assert.equal(raw.prepare('SELECT cost_review_key FROM products WHERE id=?').get(id).cost_review_key, null)
  const row = raw.prepare('SELECT cost_price_usd,cost_price_khr FROM products WHERE id=?').get(id)
  assert.equal(row.cost_price_usd, body.value)
  assert.equal(row.cost_price_khr, 5.124456789)
  const after = snapshot()
  assert.equal((await request('POST', `/${id}/cost-review/confirm`, body)).body.replayed, true)
  assert.equal(snapshot(), after)
  assert.equal((await request('POST', `/${id}/cost-review/confirm`, { ...body, value: 8 })).status, 409)
  assert.notEqual(before, after)
  console.log('PASS actual route known raw USD, independent KHR, immutable receipt retry/conflict')
  const zeroId = seed(0), zero = await request('GET', `/${zeroId}/cost-breakdown`)
  assert.equal(zero.body.costConfirmation.usd, 0)
  assert.equal((await request('POST', `/${zeroId}/cost-review/confirm`, { client_request_id: 'confirm-zero-abcdefgh', reviewed_digest: zero.body.costConfirmation.reviewed_digest, value: 0 })).status, 200)
  console.log('PASS genuine zero confirmation')
  const unknownId = seed(null), unknown = await request('GET', `/${unknownId}/cost-breakdown`)
  assert.equal(unknown.body.costConfirmation, undefined)
  assert.equal((await request('POST', `/${unknownId}/cost-review/confirm`, { client_request_id: 'confirm-null-abcdefgh', reviewed_digest: 'a'.repeat(64), value: 0 })).status, 409)
  console.log('PASS unknown cannot become zero')

  const denied = { id: 2, role_code: 'employee', permissions: { products: true, product_cost_view: true, product_cost_edit: false } }
  const deniedBefore = snapshot()
  assert.equal((await request('POST', `/${unknownId}/cost-review/confirm`, body, denied)).status,403)
  assert.equal(snapshot(),deniedBefore)
  const deniedRead = await request('GET', `/${id}/cost-breakdown`, undefined, { ...denied, permissions: { products: true } })
  assert.equal(deniedRead.status,403)
  console.log('PASS current view/edit denial without mutation or quote')
  const raceId=seed(7), raceRead=await request('GET', `/${raceId}/cost-breakdown`)
  let racedSnapshot
  beforeBatch=()=>{raw.prepare('UPDATE products SET selling_price_usd=9 WHERE id=?').run(raceId);racedSnapshot=snapshot()}
  const raced=await request('POST',`/${raceId}/cost-review/confirm`,{client_request_id:'confirm-race-abcdefgh',reviewed_digest:raceRead.body.costConfirmation.reviewed_digest,value:7})
  assert.equal(raced.status,409,JSON.stringify({raced,lastBatchError:lastBatchError?.message}))
  assert.equal(snapshot(),racedSnapshot)
  console.log('PASS same-batch full money/revision race refuses with no confirmation writes')
  const noOpId=seed(0)
  assert.throws(()=>raw.prepare('UPDATE products SET cost_review_key=NULL WHERE id=?').run(noOpId),/product_cost_review_write_refused/)
  console.log('PASS unaudited marker clear refused')

  const splitId=seed(7);let stateReads=0
  beforeRead=sql=>{if(sql.startsWith('SELECT id,cost_review_key')&&++stateReads===2){beforeRead=null;setup(()=>raw.prepare('UPDATE products SET cost_price_usd=9,purchase_price_usd=9 WHERE id=?').run(splitId))}}
  const split=await request('GET',`/${splitId}/cost-breakdown`)
  beforeRead=null
  assert.equal(split.status,409,JSON.stringify(split))
  assert.equal(split.body.costConfirmation,undefined)
  assert.equal(split.body.result_usd,undefined)
  console.log('PASS split read refuses inconsistent displayed amount and confirmation quote')
  const legacyId=seed(7)
  raw.prepare("INSERT INTO audit_logs(user_id,action,entity,entity_id,details) VALUES(1,'cost_override','product',?,'not-json')").run(String(legacyId))
  const legacy=await request('GET',`/${legacyId}/cost-breakdown`)
  const legacyBody={client_request_id:'confirm-legacy-abcdefgh',reviewed_digest:legacy.body.costConfirmation.reviewed_digest,value:7}
  afterBatch=()=>{throw Error('synthetic lost acknowledgement after actual commit')}
  const acknowledged=await request('POST',`/${legacyId}/cost-review/confirm`,legacyBody)
  assert.equal(acknowledged.status,200,JSON.stringify(acknowledged))
  assert.equal(acknowledged.body.replayed,true)
  const settled=snapshot()
  assert.equal((await request('POST',`/${legacyId}/cost-review/confirm`,legacyBody)).status,200)
  assert.equal(snapshot(),settled)
  console.log('PASS malformed historical details safe and lost acknowledgement resolved by immutable receipt')
  const auditRows=raw.prepare("SELECT * FROM audit_logs WHERE entity='product' AND entity_id=? AND json_extract(CASE WHEN json_valid(details) THEN details ELSE '{}' END,'$.kind')='product.cost-review-confirm'").all(String(id))
  assert.equal(auditRows.length,1)
  const redacted=load(path.join(root,'lib/acquisitionCostAccess.ts')).projectAcquisitionCosts(load(path.join(root,'lib/courierCostAccess.ts')).redactAuditRows(auditRows,{id:2,role_code:'employee',permissions:{audit_log:true}}),{id:2,role_code:'employee',permissions:{audit_log:true}})
  const deniedJson=JSON.stringify(redacted)
  assert.equal(deniedJson.includes('7.123456789012345'),false)
  assert.equal(deniedJson.includes('cost_request'),false)
  assert.equal(deniedJson.includes('cost_review'),false)
  assert.equal(JSON.stringify(auditRows).includes('7.123456789012345'),true)
  console.log('PASS actual courier then acquisition audit projectors redact financial receipt for denied actor')

  const writes=load(path.join(root,'lib/productWrites.ts'))
  async function edit(productId, body) {
    await writes.prepareProductMoneyWrite({DB},body,productId)
    return writes.updateRow({DB},'products',productId,body,{id:admin.id,name:admin.name})
  }
  for(const [beforeUsd,nextUsd] of [[7,9],[7,0],[null,0]]) {
    const editId=seed(beforeUsd)
    const oldEntries=raw.prepare('SELECT COUNT(*) n FROM product_cost_entries WHERE product_id=?').get(editId).n
    await edit(editId,{cost_price_usd:nextUsd})
    const changed=raw.prepare('SELECT * FROM products WHERE id=?').get(editId)
    assert.equal(changed.cost_price_usd,nextUsd)
    assert.equal(changed.cost_review_key,null)
    assert.equal(changed.cost_price_khr,5.124456789)
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM product_cost_entries WHERE product_id=?').get(editId).n,oldEntries+1)
    const proof=raw.prepare("SELECT details FROM audit_logs WHERE entity_id=? AND json_extract(CASE WHEN json_valid(details) THEN details ELSE '{}' END,'$.source')='explicit-cost-edit'").all(String(editId))
    assert.equal(proof.length,1)
    assert.equal(JSON.parse(proof[0].details).cost_review.after_usd,nextUsd)
  }
  console.log('PASS changed known USD including genuine zero clears with current audit in the same write')
  for(const body of [{cost_price_usd:7,selling_price_usd:9},{cost_price_khr:9},{cost_price_usd:null}]) {
    const editId=seed(7)
    await edit(editId,body)
    assert.equal(raw.prepare('SELECT cost_review_key FROM products WHERE id=?').get(editId).cost_review_key,'a'.repeat(32))
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_id=? AND json_extract(CASE WHEN json_valid(details) THEN details ELSE '{}' END,'$.source')='explicit-cost-edit'").get(String(editId)).n,0)
  }
  console.log('PASS whole-form USD echo, KHR-only change and cleared USD do not confirm the fallback')
  const rollbackId=seed(7), rollbackBefore=snapshot()
  raw.exec(`CREATE TRIGGER fixture_fail_cost_confirmation BEFORE INSERT ON audit_logs
    WHEN json_extract(CASE WHEN json_valid(NEW.details) THEN NEW.details ELSE '{}' END,'$.source')='explicit-cost-edit'
    BEGIN SELECT RAISE(ABORT,'fixture confirmation failure'); END;`)
  await assert.rejects(edit(rollbackId,{cost_price_usd:9}),/fixture confirmation failure/)
  raw.exec('DROP TRIGGER fixture_fail_cost_confirmation')
  assert.equal(snapshot(),rollbackBefore)
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n,0)
  console.log('PASS confirmation failure rolls back amount, manual entry, audit and marker together')


  function legacyEdit(productId, body, before) {
    before ??= raw.prepare('SELECT cost_price_usd,cost_price_khr,updated_at FROM products WHERE id=?').get(productId)
    return writes.updateRow({DB},'products',productId,body,undefined,{before,actor:{id:admin.id,name:admin.name}})
  }
  for(const [beforeUsd,usd] of [[7,9.123456789],[7,0],[null,0]]) {
    const productId=seed(beforeUsd)
    await legacyEdit(productId,{cost_price_usd:usd})
    const row=raw.prepare('SELECT cost_price_usd,cost_review_key FROM products WHERE id=?').get(productId)
    assert.equal(row.cost_price_usd,usd)
    assert.equal(row.cost_review_key,null)
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM product_cost_entries WHERE product_id=?').get(productId).n,1)
  }
  console.log('PASS legacy queued known-cost edits retain precision and atomically confirm including zero')
  for(const body of [{cost_price_usd:7,selling_price_usd:4},{cost_price_khr:9},{cost_price_usd:null}]) {
    const productId=seed(7)
    await legacyEdit(productId,body)
    assert.equal(raw.prepare('SELECT cost_review_key FROM products WHERE id=?').get(productId).cost_review_key,'a'.repeat(32))
  }
  const staleId=seed(7)
  const staleBefore=raw.prepare('SELECT cost_price_usd,cost_price_khr,updated_at FROM products WHERE id=?').get(staleId)
  setup(()=>raw.prepare('UPDATE products SET cost_price_usd=11 WHERE id=?').run(staleId))
  const staleSnapshot=snapshot()
  await assert.rejects(legacyEdit(staleId,{cost_price_usd:9},staleBefore),/product changed/)
  assert.equal(snapshot(),staleSnapshot)
  console.log('PASS legacy echoes, KHR-only and NULL retain review; stale preimage refuses unchanged')
  const legacyRollbackId=seed(7),legacyRollbackSnapshot=snapshot()
  raw.exec(`CREATE TRIGGER fixture_fail_legacy_cost BEFORE INSERT ON product_cost_entries BEGIN SELECT RAISE(ABORT,'fixture legacy evidence failure'); END;`)
  await assert.rejects(legacyEdit(legacyRollbackId,{cost_price_usd:9}),/fixture legacy evidence failure/)
  raw.exec('DROP TRIGGER fixture_fail_legacy_cost')
  assert.equal(snapshot(),legacyRollbackSnapshot)
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n,0)
  console.log('PASS legacy evidence failure rolls back original money update and leaves no permit')
  const transaction=load(path.join(root,'lib/stockTransaction.ts'))
  const compat=load(path.join(root,'lib/db.ts')).getDb({DB})
  async function setCost(productId, usd, options={}) {
    const plan=helper.explicitCostReviewWritePlan({whereSql:'id=@selectedId',nextUsdSql:'@selectedUsd',params:{selectedId:productId,selectedUsd:usd},actor:{id:1,name:'Admin'}})
    const update={sql:'UPDATE products SET cost_price_usd=@usd WHERE id=@id',params:{id:productId,usd}}
    return transaction.executeStockTransaction(compat,[...plan.before,...(options.between||[]),update,...plan.after],'once')
  }
  for(const [beforeUsd,usd] of [[7,9.123456789012345],[7,0],[null,0]]) {
    const productId=seed(beforeUsd)
    await setCost(productId,usd)
    assert.equal(raw.prepare('SELECT cost_review_key FROM products WHERE id=?').get(productId).cost_review_key,null)
    assert.equal(raw.prepare('SELECT cost_price_usd FROM products WHERE id=?').get(productId).cost_price_usd,usd)
  }
  for(const usd of [7,null]) {
    const productId=seed(7)
    await setCost(productId,usd)
    assert.equal(raw.prepare('SELECT cost_review_key FROM products WHERE id=?').get(productId).cost_review_key,'a'.repeat(32))
  }
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM system_flags WHERE key LIKE 'cost-review-edit:%'").get().n,0)
  console.log('PASS captured explicit SQL edits confirm exact raw precision and zero; echoes and NULL retain review')
  const capturedId=seed(7),capturedBefore=snapshot()
  raw.exec(`CREATE TRIGGER fixture_fail_captured_cost BEFORE INSERT ON audit_logs WHEN json_extract(CASE WHEN json_valid(NEW.details) THEN NEW.details ELSE '{}' END,'$.source')='explicit-cost-edit' BEGIN SELECT RAISE(ABORT,'fixture captured failure'); END;`)
  await assert.rejects(setCost(capturedId,9),/fixture captured failure/)
  raw.exec('DROP TRIGGER fixture_fail_captured_cost')
  assert.equal(snapshot(),capturedBefore)
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM system_flags WHERE key LIKE 'cost-review-edit:%' OR key='stock_transaction_permit'").get().n,0)
  console.log('PASS captured confirmation failure rolls back cost, review, audit and ephemeral capture together')
  const importSource=fs.readFileSync(path.join(root,'lib/importEngine.ts'),'utf8')
  const composerStart=importSource.indexOf('        const pushImportedCostEntry =')
  const composerEnd=importSource.indexOf('        let rowWriteGroupFinished',composerStart)
  assert.ok(composerStart>0 && composerEnd>composerStart)
  const composer=ts.transpileModule(`(function(productId,next,originalUsd,hasReceipt){
    const d={__costPriceUsdProvided:originalUsd===null?0:1,__costPriceKhrProvided:0},r={}
    const receiptUnitCostUsd=originalUsd,importCostActor={id:1,name:'Admin'}
    const lastReceiptRowIndex=new Map(hasReceipt?[[productId,0]]:[]),importRowIndex=new Map([[r,0]])
    let rowWriteGroup=[],costConfirmation=null
    ${importSource.slice(composerStart,composerEnd)}
    pushImportedCostEntry(productId,{usd:next})
    return [...rowWriteGroup,{sql:'UPDATE products SET cost_price_usd=@next WHERE id=@id',params:{next,id:productId}},...(costConfirmation?.after||[])]
  })`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
  const compose=new Function('explicitCostReviewWritePlan','typedCostEntryBeforeWriteStatement',`return ${composer}`)(helper.explicitCostReviewWritePlan,load(path.join(root,'lib/catalogCostRecompute.ts')).typedCostEntryBeforeWriteStatement)
  for(const separate of [false,true]) {
    const productId=seed(7),first=compose(productId,9,9,false),second=compose(productId,null,null,false)
    if(separate) { await transaction.executeStockTransaction(compat,first,'once');await transaction.executeStockTransaction(compat,second,'once') }
    else await transaction.executeStockTransaction(compat,[...first,...second],'once')
    const row=raw.prepare('SELECT cost_review_key,cost_price_usd FROM products WHERE id=?').get(productId)
    assert.equal(row.cost_review_key,null)
    assert.equal(row.cost_price_usd,null)
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_id=? AND json_extract(CASE WHEN json_valid(details) THEN details ELSE '{}' END,'$.source')='explicit-cost-edit'").get(String(productId)).n,1)
  }
  const meanId=seed(5)
  await transaction.executeStockTransaction(compat,compose(meanId,7,9,false),'once')
  assert.equal(raw.prepare('SELECT cost_review_key FROM products WHERE id=?').get(meanId).cost_review_key,'a'.repeat(32))
  const receiptId=seed(7)
  await transaction.executeStockTransaction(compat,compose(receiptId,9,9,true),'once')
  assert.equal(raw.prepare('SELECT cost_review_key FROM products WHERE id=?').get(receiptId).cost_review_key,null)
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM product_cost_entries WHERE product_id=?').get(receiptId).n,0)
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM system_flags WHERE key LIKE 'cost-review-edit:%' OR key='stock_transaction_permit'").get().n,0)
  console.log('PASS actual import cost composer confirms per row across chunks; computed mean stays tagged and receipt suppression does not erase explicit intent')
})().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => raw.close())
