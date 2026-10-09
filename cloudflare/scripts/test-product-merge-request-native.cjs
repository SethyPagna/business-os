const assert = require('node:assert/strict')
const { ready, identity, state } = require('./test-product-merge-forward-stock-native.cjs')
const { capture, load } = require('./test-product-merge-origin-plan-native.cjs')
function requestModule() {
  const mutant = process.argv.find(arg => arg.startsWith('--mutant='))?.slice(9)
  if (!mutant) return load('lib/productMergeRequest.ts')
  const fs = require('node:fs'), path = require('node:path'), ts = require('typescript')
  let source = fs.readFileSync(path.resolve(__dirname, '../src/lib/productMergeRequest.ts'), 'utf8')
  const replacements = { 'skip-receipt': ['const previous = await readProductMergeReceipt(db, user, request)', 'const previous = null'],
    'retry-policy': ["executeStockTransaction(db, statements, 'once')", "executeStockTransaction(db, statements, 'retry')"] }
  const replacement = replacements[mutant]
  assert.ok(replacement && source.includes(replacement[0]), 'mutant must replace the exact production implementation')
  source = source.replace(replacement[0], replacement[1])
  const module = { exports: {} }
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', code)(name => name.startsWith('.') ? load('lib/' + name.slice(2) + '.ts') : require(name), module, module.exports)
  return module.exports
}
const { executeProductMergeRequest, readProductMergeReceipt } = requestModule()
const user = { id: 7, username: 'operator', name: 'Operator', is_active: 1, organization_id: null,
  role_id: null, role_code: null, role_permissions: null, permissions: '{"all":true}', must_change_password: 0 }
const request = { keeperId: 1, loserId: 2, requestId: identity.requestId, requestDigest: 'a'.repeat(64) }
async function setup(options = {}) {
  const d1 = await ready()
  d1.db.exec(`INSERT INTO users(id,username,name,password,permissions,is_active) VALUES(7,'operator','Operator','synthetic','{"all":true}',1),(8,'other','Other','synthetic','{"all":true}',1)`)
  let queries = 0, dispatches = 0, preparations = 0
  const db = {
    prepare(sql) {
      const get = async params => { queries++; if (options.readFailure && dispatches) throw new Error('read transport lost'); const row = d1.prepare(sql).get(params); return options.readRow ? options.readRow(row, dispatches) : row }
      return { getOnce: get, get, all: async params => { queries++; return d1.prepare(sql).all(params) } }
    },
    batch: async rows => { queries += rows.length; return d1.batch(rows) },
    batchOnce: async rows => {
      dispatches++; queries += rows.length
      if (options.beforeDispatch) await options.beforeDispatch(d1, rows)
      if (options.throwBefore) throw new Error('network timeout before dispatch')
      const result = await d1.batch(rows)
      if (options.lostAck) throw new Error('network timeout after commit')
      if (options.shortAck) return []
      return result
    },
  }
  const budget = { limit: options.limit ?? 50, tailReserve: options.tailReserve ?? 6, used: () => queries + (options.priorQueries ?? 0) }
  const prepare = async () => {
    preparations++
    if (options.onPrepare) await options.onPrepare(d1)
    const snapshot = await capture(d1)
    queries++
    return { snapshot, identity, guards: options.guards ?? [] }
  }
  return { d1, db, budget, prepare, metrics: () => ({ queries, dispatches, preparations }),
    apply: () => executeProductMergeRequest(db, user, request, budget, prepare) }
}
const fullState = d1 => ({ tables: state(d1), sequences: d1.db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all().map(row => ({ ...row })) })
async function main() {
  for (const limit of [50, 1000]) for (const mode of ['normal', 'lostAck', 'shortAck']) {
    const w = await setup({ limit, [mode]: true })
    try {
      const result = await w.apply(), after = fullState(w.d1)
      assert.equal(result.replayed, mode !== 'normal')
      assert.equal(result.receipt.quantityMoved, 2)
      assert.equal(result.receipt.actionHistoryId, 1000)
      const retry = await w.apply()
      assert.equal(retry.replayed, true)
      assert.deepEqual(retry.receipt, result.receipt)
      assert.deepEqual(fullState(w.d1), after)
      assert.deepEqual({ ...w.metrics(), queries: 0 }, { queries: 0, dispatches: 1, preparations: 1 }, 'retry must recover before reading the inactive loser')
      assert.ok(w.metrics().queries + w.budget.tailReserve <= limit)
      console.log(`PASS ${limit} ${mode}: ${w.metrics().queries} observed local statements; one dispatch and preparation through same-key retry`)
    } finally { w.d1.db.close() }
  }
  for (const change of ['digest', 'keeper', 'actor', 'revoked', 'head', 'oversize']) {
    const options = {}
    const w = await setup(options)
    try {
      await w.apply()
      const candidate = { ...request }, actor = { ...user }
      if (change === 'digest') candidate.requestDigest = 'b'.repeat(64)
      if (change === 'keeper') candidate.keeperId = 3
      if (change === 'actor') { actor.id = 8; actor.username = 'other'; actor.name = 'Other' }
      if (change === 'revoked') w.d1.db.exec("UPDATE users SET permissions='{}' WHERE id=7")
      if (change === 'head') options.readRow = row => ({ ...row, head_valid: 0 })
      if (change === 'oversize') options.readRow = row => ({ ...row, plan_json: null })
      const before = fullState(w.d1), beforeMetrics = w.metrics()
      if (change === 'actor') assert.equal(await readProductMergeReceipt(w.db, actor, candidate), null, 'other actor cannot recover original owner receipt')
      else await assert.rejects(executeProductMergeRequest(w.db, actor, candidate, w.budget, async () => { throw new Error('must not prepare') }), /merge_request_/)
      assert.deepEqual(fullState(w.d1), before)
      assert.equal(w.metrics().dispatches, beforeMetrics.dispatches)
      console.log('PASS receipt refuses ' + change + ' without a physical dispatch')
    } finally { w.d1.db.close() }
  }
  for (const fault of ['source', 'authority', 'reservation', 'late', 'noAck', 'recoveryRead']) {
    let rivalState
    const options = { beforeDispatch: async (d1, rows) => {
      if (fault === 'source') d1.db.exec("UPDATE products SET description='Rival description' WHERE id=2")
      if (fault === 'authority') d1.db.exec("UPDATE users SET permissions='{}' WHERE id=7")
      if (fault === 'reservation') d1.db.exec("INSERT INTO undo_snapshots(id,kind,status,payload_json) VALUES(1000,'unrelated','recorded','{}')")
      if (fault === 'late') rows.splice(rows.length - 1, 0, { sql: "SELECT json_extract('[1]','$[merge_late_refusal]')" })
      rivalState = fullState(d1)
    } }
    if (fault === 'noAck') options.throwBefore = true
    if (fault === 'recoveryRead') { options.lostAck = true; options.readFailure = true }
    const w = await setup(options)
    try {
      await assert.rejects(w.apply())
      assert.equal(w.metrics().dispatches, 1, 'unknown result must never retry the physical batch')
      if (fault !== 'recoveryRead') assert.deepEqual(fullState(w.d1), rivalState)
      else assert.equal(w.d1.db.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity, 3, 'lost ACK remains committed even when recovery read fails')
      console.log('PASS once-only failure: ' + fault)
    } finally { w.d1.db.close() }
  }
  const reference = await setup()
  let required
  try { await reference.apply(); required = reference.metrics().queries + reference.budget.tailReserve + 1 }
  finally { reference.d1.db.close() }
  for (const gap of [0, 1]) {
    const w = await setup({ priorQueries: 50 - required + gap })
    try {
      const before = fullState(w.d1)
      if (gap) { await assert.rejects(w.apply(), /merge_request_budget/); assert.deepEqual(fullState(w.d1), before); assert.equal(w.metrics().dispatches, 0) }
      else { await w.apply(); assert.equal(w.metrics().queries + w.budget.tailReserve + 1 + 50 - required, 50) }
      console.log('PASS full budget ' + (gap ? 'one-over refusal before writes' : 'exact-limit admission including recovery and tail'))
    } finally { w.d1.db.close() }
  }
  console.log('LOCAL REQUEST KERNEL ONLY: actual HTTP/session binding, caller guards and provider Free/Paid resource certification remain open')
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { setup, main }
