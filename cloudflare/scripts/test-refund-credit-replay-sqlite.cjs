// Undo and redo of payment changes recorded BEFORE the exchange refund credit was protected (a settle, a payment correction or a bulk relabel
// whose saved after-state already dropped the credit's flag or relabelled it). Their redo would re-apply that damage, so the appliers refuse it
// with a clear error and write nothing. Undo of such a record stays allowed: it restores the original, which is how the damage is repaired.
// Runs the real appliers (lib/saleSettlementAction.ts, lib/saleBulkUpdate.ts) on the full in-memory schema; no native lock.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const db = openDb(loadAll())
const cache = new Map()
const stubs = {
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  './cache': { bumpVersion: async () => {}, bumpVersions: async () => {} },
  './db': { getDb: (env) => env.DB },
}
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const sourcePath = path.join(__dirname, '..', 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: sourcePath }).outputText
  const mod = { exports: {} }
  cache.set(rel, mod)
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}
const settlement = load('lib/saleSettlementAction.ts')
const bulk = load('lib/saleBulkUpdate.ts')
const { REFUND_CREDIT_REPLAY_REFUSED_MESSAGE: REFUSED, refundCreditReplayRefused } = load('lib/paymentSettlement.ts')
const env = { DB: db }
const user = { id: 1, username: 'owner', name: 'Owner', role: 'admin', permissions: JSON.stringify({ sales: true }) }

const credit = { method: 'Cash', amount_usd: 10, amount_khr: 0, refund_credit: true }
const customer = { method: 'Cash', amount_usd: 3, amount_khr: 0 }
const results = []
async function check(name, fn) {
  try { await fn(); results.push(`PASS ${name}`) } catch (e) { results.push(`FAIL ${name}: ${String(e && e.message).replace(/\n/g, ' ').slice(0, 300)}`) }
}
async function refusedWith(fn) {
  try { await fn() } catch (e) { return String(e && e.message) }
  return null
}

const run = (sql, params = []) => db.prepare(sql).run(params)
const one = (sql, params = []) => db.prepare(sql).get(params)

;(async () => {
  // ---- The pure rule
  await check('rule: a flagged credit that reappears unchanged is fine; a dropped, flag-lost, relabelled or re-amounted one is refused', () => {
    assert.equal(refundCreditReplayRefused([credit, customer], [customer, credit]), false)
    assert.equal(refundCreditReplayRefused([credit, customer], [customer]), true)
    assert.equal(refundCreditReplayRefused([credit, customer], [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }, customer]), true)
    assert.equal(refundCreditReplayRefused([credit, customer], [{ ...credit, method: 'ABA' }, customer]), true)
    assert.equal(refundCreditReplayRefused([credit, customer], [{ ...credit, amount_usd: 9 }, customer]), true)
    assert.equal(refundCreditReplayRefused([customer], [{ method: 'ABA', amount_usd: 3 }]), false, 'a sale with no credit is never refused')
    assert.equal(refundCreditReplayRefused(null, '[]'), false)
    assert.equal(refundCreditReplayRefused(JSON.stringify([credit]), JSON.stringify([{ ...credit, method: 'ABA' }]), true), false, 'reversing a relabel may restore the method')
    assert.equal(refundCreditReplayRefused(JSON.stringify([credit]), JSON.stringify([]), true), true, 'but never drops the credit')
  })

  // ---- Settlement record
  const seedSettlement = (id, beforeDetails, afterDetails) => {
    run("INSERT INTO action_history(id,label,undo_label,redo_label,status,undo_payload,redo_payload) VALUES(?,?,?,?,?,?,?)", [id, 'settle', 'u', 'r', 'redoable', '{"generation":1}', '{"generation":1}'])
    const state = (details) => JSON.stringify({ payment_method: 'Cash', payment_details: JSON.stringify(details), amount_paid_usd: 0, lines: [] })
    run(`INSERT INTO sale_mutation_receipts(id,actor_id,sale_id,mutation_kind,request_id,request_digest,request_json,before_json,after_json,response_json,history_id,generation,sale_revision)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, [`op-${id}`, 1, 900 + id, 'settlement', `req-${id}`, 'd', '{}', state(beforeDetails), state(afterDetails), '{}', id, 1, 0])
  }
  seedSettlement(1, [credit, customer], [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }, { method: 'Cash', amount_usd: 3, amount_khr: 0 }])
  await check('settlement: redo of a pre-fix settle whose after-state lost the credit flag is refused with the clear message', async () => {
    const message = await refusedWith(() => settlement.replaySaleSettlementAction(env, user, 'redo', 1, 1, { operation_id: 'op-1' }))
    assert.equal(message, REFUSED)
    assert.equal(one('SELECT status FROM action_history WHERE id=1').status, 'redoable', 'history untouched')
    assert.equal(one('SELECT COUNT(*) n FROM sale_record_events').n, 0)
  })
  await check('settlement: undo of the same record is not refused for the credit (it only restores the flagged original)', async () => {
    const message = await refusedWith(() => settlement.replaySaleSettlementAction(env, user, 'undo', 1, 1, { operation_id: 'op-1' }))
    assert.notEqual(message, REFUSED)
  })
  seedSettlement(2, [credit, customer], [credit, { ...customer, amount_usd: 5 }])
  await check('settlement: redo of a settle that kept the credit is not refused for it', async () => {
    const message = await refusedWith(() => settlement.replaySaleSettlementAction(env, user, 'redo', 2, 1, { operation_id: 'op-2' }))
    assert.notEqual(message, REFUSED)
  })
  seedSettlement(3, [credit, customer], [{ ...credit, method: 'ABA' }, customer])
  await check('settlement: redo that relabels the credit is refused', async () => {
    assert.equal(await refusedWith(() => settlement.replaySaleSettlementAction(env, user, 'redo', 3, 1, { operation_id: 'op-3' })), REFUSED)
    assert.notEqual(await refusedWith(() => settlement.replaySaleSettlementAction(env, user, 'undo', 3, 1, { operation_id: 'op-3' })), REFUSED)
  })

  // ---- Bulk relabel record
  const action = { kind: 'payment_method', source: 'Cash', target: 'ABA' }
  const member = (id, before, after) => ({
    id, receipt: `R-${id}`, changed: true, reason: 'changed',
    before: { payment_method: 'Cash', payment_details: JSON.stringify(before), search_normalized: 'x' },
    after: { payment_method: 'ABA', payment_details: JSON.stringify(after), search_normalized: 'x' },
    returnsBefore: [], returnsAfter: [],
  })
  const seedBulk = (n, members) => {
    const snapshot = { version: 1, operationId: `bulk-${n}`, action, members }
    run("INSERT INTO undo_snapshots(id,kind,status,payload_json) VALUES(?,?,?,?)", [n, 'sale.fields.bulk', 'reversed', JSON.stringify(snapshot)])
    run("INSERT INTO action_history(id,label,undo_label,redo_label,status,undo_payload,redo_payload) VALUES(?,?,?,?,?,?,?)", [100 + n, 'relabel', 'u', 'r', 'redoable', '{"generation":1}', '{"generation":1}'])
    run("INSERT INTO sale_bulk_operations(id,actor_id,request_id,request_json,snapshot_id,history_id,generation,receipt_json) VALUES(?,?,?,?,?,?,?,?)", [`bulk-${n}`, 1, `req-${n}`, '{}', n, 100 + n, 1, '{}'])
    return { operation_id: `bulk-${n}`, snapshot_id: n, applier: 'sale.fields.bulk' }
  }
  const payload1 = seedBulk(1, [member(1, [credit, customer], [{ ...credit, method: 'ABA' }, { ...customer, method: 'ABA' }])])
  await check('bulk: redo of a pre-fix relabel whose after-state relabelled the credit is refused with the clear message', async () => {
    const message = await refusedWith(() => bulk.replaySaleBulkUpdate(env, user, 'redo', 101, 1, payload1))
    assert.equal(message, REFUSED)
    assert.equal(one('SELECT status FROM action_history WHERE id=101').status, 'redoable')
  })
  await check('bulk: undo of the same record is allowed to restore the credit method (not refused for it)', async () => {
    const message = await refusedWith(() => bulk.replaySaleBulkUpdate(env, user, 'undo', 101, 1, payload1))
    assert.notEqual(message, REFUSED)
  })
  const payload2 = seedBulk(2, [member(2, [credit, customer], [credit, { ...customer, method: 'ABA' }])])
  await check('bulk: redo of a post-fix relabel (credit untouched) is not refused for the credit', async () => {
    const message = await refusedWith(() => bulk.replaySaleBulkUpdate(env, user, 'redo', 102, 1, payload2))
    assert.notEqual(message, REFUSED)
  })

  for (const line of results) console.log(line)
  const failed = results.filter((l) => l.startsWith('FAIL'))
  console.log(`${results.length - failed.length}/${results.length} passed`)
  if (failed.length) process.exitCode = 1
})().catch((e) => { console.error(e); process.exitCode = 1 })
