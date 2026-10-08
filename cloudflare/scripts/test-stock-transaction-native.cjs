const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Miniflare, Log, LogLevel } = require('miniflare')

function load(relative) {
  const file = path.join(__dirname, '../src/lib', relative)
  const source = fs.readFileSync(file, 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file }).outputText
  const m = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => name === './importMaintenanceFence' ? {} : require(name), m, m.exports)
  return m.exports
}

const api = load('stockTransaction.ts')
const { D1Compat } = load('db.ts')
const key = Symbol.for('business-os.request-metrics.v1')

;(async () => {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', compatibilityDate: '2026-07-01', d1Databases: ['DB'], log: new Log(LogLevel.ERROR) })
  const priorHook = globalThis[key]
  try {
    const raw = await mf.getD1Database('DB')
    await raw.exec('CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT); CREATE TABLE stock(id INTEGER PRIMARY KEY,quantity INTEGER NOT NULL CHECK(quantity>=0)); CREATE TABLE receipts(id TEXT PRIMARY KEY,quantity INTEGER NOT NULL); INSERT INTO stock VALUES(1,7);')
    await raw.prepare('INSERT INTO system_flags(key,value) VALUES(?,?)').bind('stock_schema_epoch', api.STOCK_SCHEMA_EPOCH).run()
    await raw.exec(`CREATE TRIGGER stock_update BEFORE UPDATE ON stock BEGIN SELECT CASE WHEN EXISTS(SELECT 1 FROM system_flags p JOIN system_flags e ON e.key='stock_schema_epoch' AND p.value=e.value WHERE p.key='stock_transaction_permit') THEN 1 ELSE RAISE(ABORT,'stock_transaction_required') END; END;`)
    assert.throws(() => api.executeRawRestoreStockTransaction(raw, [], undefined), error => error.code === 'stock_schema_unavailable')
    for (const snapshot of ['{', '{}', JSON.stringify({mode:'branch-cutover',token:'old',backupKey:'source'}), JSON.stringify({mode:'restore',token:'old',backupKey:'source',phase:'assets',startedBy:'admin',startedAt:'bad',updatedAt:'bad'})]) {
      assert.throws(() => api.executeRawRestoreStockTransaction(raw, [], {token:'old',backupKey:'source',snapshot}), error => error.code === 'stock_schema_unavailable')
    }
    const state = async () => ({ quantity: await raw.prepare('SELECT quantity FROM stock').first('quantity'), permits: await raw.prepare("SELECT COUNT(*) AS n FROM system_flags WHERE key='stock_transaction_permit'").first('n'), receipts: await raw.prepare('SELECT COUNT(*) AS n FROM receipts').first('n') })
    const update = quantity => ({ sql: 'UPDATE stock SET quantity=quantity+@quantity WHERE id=1 RETURNING quantity', params: { quantity } })
    let attempts = 0, calls = 0
    globalThis[key] = { d1Start(n) { attempts += n }, rawD1Start(n) { attempts += n }, d1Call() {} }
    const counted = new Proxy(raw, { get(target, name) { if (name === 'batch') return statements => { calls++; return target.batch(statements) }; const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value } })
    const db = new D1Compat(counted)
    const out = await api.executeStockTransaction(db, [update(3), { sql: "INSERT INTO receipts(id,quantity) VALUES('first',3) RETURNING id" }], 'once')
    assert.equal(out.length, 2); assert.equal(out[0].results[0].quantity, 10); assert.equal(out[1].results[0].id, 'first')
    assert.deepEqual(await state(), { quantity: 10, permits: 0, receipts: 1 }); assert.equal(attempts, 4); assert.equal(calls, 1)
    const rawOut = await api.executeRawStockTransaction(counted, [raw.prepare('UPDATE stock SET quantity=quantity-1 WHERE id=1 RETURNING quantity')])
    assert.equal(rawOut[0].results[0].quantity, 9); assert.equal(attempts, 7); assert.equal(calls, 2)
    await assert.rejects(raw.prepare('UPDATE stock SET quantity=quantity+100 WHERE id=1').run(), /stock_transaction_required/)
    assert.deepEqual(await state(), { quantity: 9, permits: 0, receipts: 1 })
    for (const epoch of [null, 'counted-tag-v2', 'malformed']) {
      if (epoch === null) await raw.prepare("DELETE FROM system_flags WHERE key='stock_schema_epoch'").run()
      else await raw.prepare("INSERT INTO system_flags(key,value) VALUES('stock_schema_epoch',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(epoch).run()
      await assert.rejects(api.executeStockTransaction(db, [update(100)], 'once'), error => error.code === 'stock_schema_unavailable')
      assert.deepEqual(await state(), { quantity: 9, permits: 0, receipts: 1 })
    }
    await raw.prepare("UPDATE system_flags SET value=? WHERE key='stock_schema_epoch'").bind(api.STOCK_SCHEMA_EPOCH).run()
    await raw.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance','{}')").run()
    await assert.rejects(api.executeStockTransaction(db, [], 'once'), error => error.code === 'stock_schema_unavailable')
    await raw.prepare("DELETE FROM system_flags WHERE key='maintenance'").run()
    await assert.rejects(api.executeStockTransaction(db, [update(2), { sql: "INSERT INTO receipts(id,quantity) VALUES('first',1)" }], 'once'), /UNIQUE constraint/)
    assert.deepEqual(await state(), { quantity: 9, permits: 0, receipts: 1 })
    await raw.prepare("INSERT INTO system_flags(key,value) VALUES('stock_transaction_permit',?)").bind(api.STOCK_SCHEMA_EPOCH).run()
    await assert.rejects(api.executeStockTransaction(db, [update(100)], 'once'), /UNIQUE constraint/)
    assert.deepEqual(await state(), { quantity: 9, permits: 1, receipts: 1 })
    await raw.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'").run()
    let lostCalls = 0
    const lost = new Proxy(raw, { get(target, name) { if (name === 'batch') return async statements => { lostCalls++; await target.batch(statements); throw Error('D1_ERROR: network lost acknowledgement') }; const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value } })
    await assert.rejects(api.executeStockTransaction(new D1Compat(lost), [update(1)], 'once'), /lost acknowledgement/)
    assert.equal(lostCalls, 1); assert.deepEqual(await state(), { quantity: 10, permits: 0, receipts: 1 })
    const truncated = new Proxy(raw, { get(target, name) { if (name === 'batch') return async statements => { await target.batch(statements); return [] }; const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value } })
    await assert.rejects(api.executeRawStockTransaction(truncated, [raw.prepare('UPDATE stock SET quantity=quantity+1 WHERE id=1')]), error => error.code === 'stock_transaction_outcome_unknown')
    assert.deepEqual(await state(), { quantity: 11, permits: 0, receipts: 1 })
    let retryCalls = 0
    const retry = new Proxy(raw, { get(target, name) { if (name === 'batch') return async statements => { if (++retryCalls === 1) throw Error('D1_ERROR: network before dispatch'); return target.batch(statements) }; const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value } })
    const before = attempts
    await api.executeStockTransaction(new D1Compat(retry), [update(1)], 'retry')
    assert.equal(retryCalls, 2); assert.equal(attempts - before, 6)
    assert.deepEqual(await state(), { quantity: 12, permits: 0, receipts: 1 })
    assert.equal(Object.values(api).filter(value => typeof value === 'string').length, 1, 'only compiled epoch is exported; admission SQL remains private')
    console.log('PASS native D1 whole-transaction permit: result indices, raw/compat counts, old writer refusal, epoch/maintenance controls, rollback, leaked permit refusal, lost ACK once, unknown result and explicit retry')
  } finally {
    if (priorHook === undefined) delete globalThis[key]; else globalThis[key] = priorHook
    await mf.dispose()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
