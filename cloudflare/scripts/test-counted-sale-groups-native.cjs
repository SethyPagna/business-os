const assert = require('node:assert/strict')
const h = require('./test-counted-quantity-exact-native.cjs')
const single = require('./test-counted-sale-status-exact-native.cjs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const quantities = f => ({ physical: f.state().physical, cache: f.state().cache,
  receipts: f.state().lots, tags: f.state().tags })
const state = f => ({ ...single.state(f), bulk: f.sql.prepare('SELECT * FROM sale_bulk_operations ORDER BY id').all(),
  members: f.sql.prepare('SELECT * FROM sale_bulk_members ORDER BY operation_id,sale_id').all(),
  snapshots: f.sql.prepare('SELECT * FROM undo_snapshots ORDER BY id').all() })
const request = (f, ids, key = 'group-cancel', target = 'cancelled') => ({ client_request_id: key,
  items: ids.map(id => f.sql.prepare('SELECT id,sale_status expected_status,updated_at expected_updated_at FROM sales WHERE id=?').get(id)),
  target_status: target, ...(target === 'cancelled' ? { cancel_reason: 'mistake' } : {}) })

async function legacyWorker() {
  const root = path.resolve(__dirname, '..')
  const source = execFileSync('git', ['show', 'b3ca97ba3e48acd45df7efe34bdf7bcc1b8b6fd7:cloudflare/src/lib/saleBulkStatus.ts'], { cwd: root, encoding: 'utf8' })
  const build = await require('esbuild').build({ stdin: { resolveDir: root, loader: 'ts', contents:
    "import worker from './src/index.ts';export {ensureCoreDataInvariants} from './src/lib/coreDataInvariants.ts';export default worker;" },
    bundle: true, write: false, format: 'cjs', platform: 'node', target: 'es2022', packages: 'external',
    define: { __WORKER_BUILD_REVISION__: JSON.stringify('legacy-grouped-proof'), __WORKER_BUILD_HASH__: JSON.stringify('legacy-grouped'), __WORKER_BUILT_AT__: JSON.stringify('2026-10-09T00:00:00Z') },
    plugins: [{ name: 'original-grouped-writer', setup(b) {
      b.onLoad({ filter: /saleBulkStatus\.ts$/ }, () => ({ contents: source, loader: 'ts', resolveDir: path.join(root, 'src/lib') }))
      b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'worker-runtime', namespace: 'transport' }))
      b.onLoad({ filter: /.*/, namespace: 'transport' }, () => ({ contents: 'export class DurableObject {}', loader: 'js' }))
    } }],
  })
  return () => { const m = { exports: {} }; new Function('require', 'module', 'exports', build.outputFiles[0].text)(require, m, m.exports); return m.exports }
}

async function legacy(makeWorker) {
  const oldWorker = await legacyWorker()
  for (const tier of ['paid', 'free']) for (const shape of ['receipt-partial', 'NULL-partial', 'receipt-full', 'NULL-full', 'different-cost', 'aggregated']) {
    let current, next
    const factory = () => {
      current = oldWorker(); next = makeWorker()
      return { ensureCoreDataInvariants: current.ensureCoreDataInvariants, default: { fetch: (...args) => current.default.fetch(...args) } }
    }
    const receipt = !shape.startsWith('NULL'), partial = !shape.endsWith('full')
    const { f, saleId, stock, db } = await single.scenario(factory, tier, receipt, partial)
    try {
      if (shape === 'different-cost') await stock.executeStockTransaction(db, [
        { sql: "INSERT INTO sale_items(id,sale_id,product_id,product_name,branch_id,damaged_lot_id,quantity,applied_price_usd,total_usd,cost_price_usd,cost_price_khr)VALUES(90,@sale,1,'Serum',1,1,0.1,2,0.2,3,0)", params: { sale: saleId } },
        { sql: 'UPDATE damaged_stock_lots SET quantity_remaining=0.2 WHERE id=1' },
        { sql: 'UPDATE branch_stock SET quantity=0.3 WHERE product_id=1 AND branch_id=1' },
        { sql: 'UPDATE products SET stock_quantity=0.3 WHERE id=1' },
        { sql: 'UPDATE branch_batch_stock SET quantity=0.3 WHERE batch_id=1 AND branch_id=1' },
      ], 'once')
      if (shape === 'aggregated') await stock.executeStockTransaction(db, [{ sql:
        'INSERT INTO return_items(return_id,sale_item_id,product_id,product_name,quantity,branch_id,return_to_stock,stock_condition) SELECT return_id,sale_item_id,product_id,product_name,0.05,branch_id,return_to_stock,stock_condition FROM return_items' }], 'once')
      const initial = quantities(f), result = await f.call('/sales/bulk-status', request(f, [saleId], 'legacy-generated'))
      assert.equal(result.status, 200, JSON.stringify(result.json))
      const historyId = result.json.actionHistoryId, snapshot = f.sql.prepare("SELECT id,payload_json FROM undo_snapshots WHERE kind='sale.status.bulk'").get()
      const oldMovements = f.sql.prepare('SELECT * FROM inventory_movements ORDER BY id').all()
      const physical = shape === 'aggregated' ? 0.7 : partial ? 0.8 : 1
      await stock.executeStockTransaction(db, [
        { sql: 'UPDATE branch_stock SET quantity=@q WHERE product_id=1 AND branch_id=1', params: { q: physical } },
        { sql: 'UPDATE products SET stock_quantity=@q WHERE id=1', params: { q: physical } },
        ...(receipt ? [{ sql: 'UPDATE branch_batch_stock SET quantity=@q WHERE batch_id=1 AND branch_id=1', params: { q: physical } }] : []),
        ...(shape === 'aggregated' ? [{ sql: 'UPDATE damaged_stock_lots SET quantity_remaining=0.45 WHERE id=1' }] : []),
      ], 'once')
      current = next
      for (let generation = 0; generation < 4; generation++) {
        const direction = generation % 2 ? 'redo' : 'undo'
        const replay = await f.call('/action-history/' + historyId + '/' + direction, { expected_generation: generation })
        assert.equal(replay.status, 200, JSON.stringify(replay.json))
        assert.equal(f.state().cache, direction === 'undo' ? initial.cache : physical)
        assert.equal(f.sql.prepare('SELECT payload_json FROM undo_snapshots WHERE id=?').get(snapshot.id).payload_json, snapshot.payload_json)
        assert.deepEqual(f.sql.prepare('SELECT * FROM inventory_movements WHERE id<=? ORDER BY id').all(oldMovements.at(-1).id), oldMovements)
      }
      const tagged = f.sql.prepare("SELECT quantity,unit_cost_usd FROM inventory_movements WHERE id>? AND movement_type='damage_out' ORDER BY id").all(oldMovements.at(-1).id)
      if (shape === 'different-cost') assert.deepEqual(tagged.map(row => row.unit_cost_usd), [2, 3, 2, 3])
      console.log('PASS original legacy snapshot exact ephemeral replay/immutable bytes ' + JSON.stringify({ tier, shape }))
    } finally { f.sql.close() }
  }
}

async function ownership(makeWorker) {
  for (const tier of ['paid', 'free']) for (const mode of ['conflict', 'race', 'null', 'retired', 'successor', 'retired-null', 'unconfirmed']) {
    const redirected = ['retired', 'successor', 'retired-null', 'unconfirmed'].includes(mode)
    const factory = () => {
      const worker = makeWorker(), fetch = worker.default.fetch
      return { ...worker, default: { ...worker.default, fetch: (req, ...args) => {
        if (redirected && mode !== 'unconfirmed') { req = new Request(req); req.headers.set('X-Branch-Redirect', '2') }
        return fetch(req, ...args)
      } } }
    }
    const { f, saleId, stock, db } = await single.scenario(factory, tier, true, true)
    try {
      await stock.executeStockTransaction(db, [{ sql: "INSERT INTO branches(id,name,is_active,role)VALUES(2,'Successor',1,'shop')" }], 'once')
      if (redirected) await stock.executeStockTransaction(db, [
        { sql: "UPDATE branches SET is_active=0,is_default=0,successor_branch_id=2 WHERE id=1" },
        { sql: 'UPDATE branches SET is_default=1 WHERE id=2' },
        { sql: 'INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(1,2,0.4)' },
        { sql: 'UPDATE branch_stock SET quantity=0 WHERE product_id=1 AND branch_id=1' },
        { sql: 'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(1,2,0.4)' },
        { sql: 'UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=1 AND branch_id=1' },
        { sql: 'UPDATE damaged_stock_lots SET branch_id=2 WHERE id=1' },
      ], 'once')
      const allocationBranch = ['conflict', 'successor'].includes(mode) ? '2' : ['null', 'retired-null'].includes(mode) ? 'NULL' : '1'
      await stock.executeStockTransaction(db, [{ sql: 'UPDATE sale_item_batch_allocations SET branch_id=' + allocationBranch }], 'once')
      let before = state(f)
      if (mode === 'race') f.beforeCommit(async () => {
        await stock.executeStockTransaction(db, [{ sql: 'UPDATE sale_item_batch_allocations SET branch_id=2' }], 'once')
        before = state(f)
      })
      const result = await f.call('/sales/bulk-status', request(f, [saleId]))
      if (['conflict', 'race', 'unconfirmed'].includes(mode)) {
        assert.equal(result.status, 409, JSON.stringify(result.json)); assert.deepEqual(state(f), before)
      } else {
        assert.equal(result.status, 200, JSON.stringify(result.json)); assert.equal(f.state().cache, 0.8)
        assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=?').get(redirected ? 2 : 1).quantity, 0.8)
        if (redirected) assert.equal(f.state().physical, 0)
        assert.deepEqual(state(f).conditions, before.conditions, 'original tagged sale source stays immutable')
        assert.equal(f.sql.prepare('SELECT branch_id FROM sale_item_batch_allocations ORDER BY id LIMIT 1').get().branch_id,
          allocationBranch === 'NULL' ? null : Number(allocationBranch), 'original allocation branch is not repointed')
        const historyId = result.json.actionHistoryId
        assert.equal((await f.call('/action-history/' + historyId + '/undo', { expected_generation: 0 })).status, 200)
        assert.equal(f.state().cache, 0.4)
        assert.equal((await f.call('/action-history/' + historyId + '/redo', { expected_generation: 1 })).status, 200)
        assert.equal(f.state().cache, 0.8)
      }
      console.log('PASS grouped original allocation ownership/confirmed successor ' + JSON.stringify({ tier, mode }))
    } finally { f.sql.close() }
  }
}

async function positive(makeWorker, tier, receipt, partial) {
  const { f, saleId } = await single.scenario(makeWorker, tier, receipt, partial)
  try {
    const initial = quantities(f)
    const row = f.sql.prepare('SELECT id,sale_status expected_status,updated_at expected_updated_at FROM sales WHERE id=?').get(saleId)
    const body = { client_request_id: 'group-cancel', items: [row], target_status: 'cancelled', cancel_reason: 'mistake' }
    const result = await f.call('/sales/bulk-status', body)
    assert.equal(result.status, 200, JSON.stringify(result.json))
    assert.equal(f.state().physical, partial ? 0.8 : 1, 'group cancellation restores ordinary and tagged physical exactly once')
    assert.equal(f.state().cache, partial ? 0.8 : 1)
    assert.equal(f.state().tags[0].quantity_remaining, partial ? 0.5 : 0.6)
    if (receipt) assert.equal(f.state().lots[0].quantity, partial ? 0.8 : 1)
    const committed = state(f)
    assert.equal((await f.call('/sales/bulk-status', body)).status, 200)
    assert.deepEqual(state(f), committed, 'same operation replay writes no new business/history rows')
    const historyId = result.json.actionHistoryId
    const undone = await f.call('/action-history/' + historyId + '/undo', { expected_generation: 0 })
    assert.equal(undone.status, 200, JSON.stringify(undone.json))
    assert.deepEqual(quantities(f), initial, 'compensating undo restores exact prior quantities and identities')
    const redone = await f.call('/action-history/' + historyId + '/redo', { expected_generation: 1 })
    assert.equal(redone.status, 200, JSON.stringify(redone.json))
    assert.equal(f.state().physical, partial ? 0.8 : 1)
    assert.equal(f.state().tags[0].quantity_remaining, partial ? 0.5 : 0.6)
    console.log('PASS grouped cancel/replay/undo/redo ' + JSON.stringify({ tier, receipt, partial }))
  } finally { f.sql.close() }
}

async function transition(makeWorker, tier, direction) {
  const w = await single.scenario(makeWorker, tier, true, true), { f, saleId } = w
  const body = request(f, [saleId], 'group-race')
  if (direction === 'apply') return { ...w, call: () => f.call('/sales/bulk-status', body) }
  const applied = await f.call('/sales/bulk-status', body)
  assert.equal(applied.status, 200, JSON.stringify(applied.json))
  const historyId = applied.json.actionHistoryId
  if (direction === 'redo') assert.equal((await f.call('/action-history/' + historyId + '/undo', { expected_generation: 0 })).status, 200)
  return { ...w, call: () => f.call('/action-history/' + historyId + '/' + direction, { expected_generation: direction === 'undo' ? 0 : 1 }) }
}

async function races(makeWorker) {
  const faults = {
    cache: 'UPDATE products SET stock_quantity=0.7 WHERE id=1',
    membership: "INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)VALUES(90,1,1,1,0.1,0,'opened','remove')",
    condition: "UPDATE damaged_stock_lots SET condition_tag='opened' WHERE id=1",
    allocation: 'UPDATE sale_item_batch_allocations SET branch_id=2',
    return: 'UPDATE return_items SET quantity=0.2 WHERE id=1',
    receipt: 'UPDATE product_batches SET unit_cost_usd=3,received_at=\'2026-10-01\' WHERE id=1',
    branch: 'UPDATE branches SET is_active=0 WHERE id=1',
    authority: 'UPDATE users SET is_active=0 WHERE id=7',
  }
  for (const tier of ['paid', 'free']) for (const direction of ['apply', 'undo', 'redo']) {
    for (const [fault, sql] of Object.entries(faults)) {
      const { f, stock, db, call } = await transition(makeWorker, tier, direction)
      try {
        if (fault === 'allocation') await stock.executeStockTransaction(db, [{ sql: "INSERT INTO branches(id,name,is_active)VALUES(2,'Other',1)" }], 'once')
        let rival
        f.beforeCommit(async () => { await stock.executeStockTransaction(db, [{ sql }], 'once'); rival = state(f) })
        const result = await call()
        assert.equal(result.status, 409, JSON.stringify({ tier, direction, fault, result }))
        assert.ok(rival, 'the rival actually ran at the batch boundary')
        assert.deepEqual(state(f), rival, 'exact rival survives with no own writes')
        console.log('PASS grouped source/authority race ' + JSON.stringify({ tier, direction, fault }))
      } finally { f.sql.close() }
    }
    const { f, call } = await transition(makeWorker, tier, direction)
    try {
      const before = state(f)
      f.sql.exec("CREATE TEMP TABLE group_unrelated(guard_value_unrelated INTEGER CHECK(guard_value_unrelated=1)); CREATE TEMP TRIGGER group_late_failure BEFORE INSERT ON sale_record_events WHEN NEW.source_kind='sale_bulk_status' BEGIN INSERT INTO group_unrelated VALUES(0); END")
      assert.equal((await call()).status, 500, 'unrelated CHECK is not a known stock conflict')
      assert.deepEqual(state(f), before, 'late constraint rolls back full business/history action')
      f.sql.exec('DROP TRIGGER group_late_failure')
      f.loseNextCommitAcknowledgement()
      assert.equal((await call()).status, 200, 'committed operation/generation receipt recovers lost acknowledgement')
      const committed = state(f)
      assert.equal((await call()).status, direction === 'apply' ? 200 : 409, 'repeated history generation remains stale, never replays twice')
      assert.deepEqual(state(f), committed)
      console.log('PASS grouped late CHECK rollback/ACK/current generation ' + JSON.stringify({ tier, direction }))
    } finally { f.sql.close() }
  }
}

async function tails(makeWorker, fragments) {
  for (const tier of ['paid', 'free']) for (const direction of ['apply', 'undo', 'redo']) {
    const w = await single.scenario(makeWorker, tier, true, false), { f, saleId, stock, db } = w
    try {
      const sub = h.loadStockSession('lib/countedDamagedStock.ts').subtractCountedQuantity
      await stock.executeStockTransaction(db, [{ sql: 'DELETE FROM sale_item_batch_allocations WHERE sale_item_id=1' },
        ...Array.from({ length: fragments }, (_, i) => ({ sql: 'INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity)VALUES(1,1,1,@q,0)',
          params: { q: i === fragments - 1 ? sub(0.3, Array(fragments - 1).fill(0.001)) : 0.001 } }))], 'once')
      const body = request(f, [saleId], 'group-tail')
      let historyId
      if (direction !== 'apply') {
        const setup = await f.call('/sales/bulk-status', body)
        if (setup.status === 409) { assert.equal(tier, 'free'); assert.equal(setup.json.code, 'sale_bulk_over_plan_budget'); continue }
        assert.equal(setup.status, 200, JSON.stringify(setup.json)); historyId = setup.json.actionHistoryId
        if (direction === 'redo') {
          const setupUndo = await f.call('/action-history/' + historyId + '/undo', { expected_generation: 0 })
          if (setupUndo.status === 409) { assert.equal(tier, 'free'); continue }
          assert.equal(setupUndo.status, 200, JSON.stringify(setupUndo.json))
        }
      }
      const before = state(f), raw = f.env.DB, attempts = new Map(), failed = new Set()
      let attempted = 0, committed = false
      f.env.CACHE = { get: async () => null, put: async () => { throw new Error('Synthetic unavailable KV') }, delete: async () => {} }
      f.sql.exec("DELETE FROM cache_versions WHERE namespace IN('stock','sales')")
      const retry = (sql, params) => {
        if (!committed) return false
        const kind = /INSERT INTO audit_logs/.test(sql) ? 'audit' : /SELECT namespace, version FROM cache_versions/.test(sql) ? 'versions'
          : /INSERT INTO quota_usage/.test(sql) ? 'quota' : /INSERT INTO cache_versions/.test(sql) ? 'handoff'
            : /SELECT \* FROM action_history WHERE id/.test(sql) ? 'history' : null
        if (!kind) return false
        const key = kind + ':' + JSON.stringify(params)
        attempts.set(key, (attempts.get(key) || 0) + 1)
        if (failed.has(key)) return false
        failed.add(key); return true
      }
      const wrap = (statement, sql) => new Proxy(statement, { get(target, key) {
        if (key === 'bind') return (...args) => wrap(target.bind(...args), sql)
        if (['all', 'first', 'run'].includes(key)) return (...args) => {
          attempted++
          return retry(sql, target.params) ? Promise.reject(new Error('D1_ERROR: network reset before grouped tail')) : target[key](...args)
        }
        return target[key]
      } })
      f.env.DB = new Proxy(raw, { get(target, key) {
        if (key === 'prepare') return sql => wrap(target.prepare(sql), sql)
        if (key === 'batch') return async statements => {
          attempted += statements.length
          if (statements.some(statement => retry(statement.text, statement.params))) throw new Error('D1_ERROR: network reset before grouped tail')
          try { return await target.batch(statements) } finally {
            if (statements.some(statement => /INSERT INTO sale_record_events/.test(statement.text))) {
              const generation = f.sql.prepare('SELECT generation FROM sale_bulk_operations WHERE request_id=?').get('group-tail')?.generation
              committed = generation === (direction === 'apply' ? 0 : direction === 'undo' ? 1 : 2)
            }
          }
        }
        return target[key]
      } })
      f.loseNextCommitAcknowledgement()
      const result = direction === 'apply' ? await f.call('/sales/bulk-status', body)
        : await f.call('/action-history/' + historyId + '/' + direction, { expected_generation: direction === 'undo' ? 0 : 1 })
      console.log('GROUP_FULL_TAIL ' + JSON.stringify({ tier, direction, fragments, status: result.status, code: result.json.code, attempted, attempts: Object.fromEntries(attempts) }))
      assert.ok(attempted <= (tier === 'free' ? 50 : 1000))
      if (result.status === 409) {
        assert.equal(tier, 'free'); assert.deepEqual(state(f), before); assert.equal(committed, false)
      } else {
        assert.equal(result.status, 200, JSON.stringify(result.json)); assert.equal(f.state().cache, direction === 'undo' ? 0.4 : 1)
        const kinds = [...new Set([...failed].map(key => key.split(':')[0]))]
        for (const expected of ['versions', 'handoff', ...(tier === 'free' ? ['quota'] : []), ...(direction === 'apply' ? [] : ['history'])])
          assert.ok(kinds.includes(expected), 'actual tail exercised ' + expected)
      }
    } finally { f.sql.close() }
  }
}

async function main() {
  const makeWorker = await h.bundle.exports.bundleWorker()
  if (process.argv.includes('--base')) return positive(makeWorker, 'paid', true, true)
  if (process.argv.includes('--ownership-only')) return ownership(makeWorker)
  if (process.argv.includes('--legacy-only')) return legacy(makeWorker)
  if (process.argv.includes('--races-only')) return races(makeWorker)
  if (process.argv.includes('--tails-only')) return tails(makeWorker, Number(process.env.GROUP_FRAGMENTS || 1))
  for (const tier of ['paid', 'free']) for (const receipt of [true, false]) for (const partial of [true, false]) {
    await positive(makeWorker, tier, receipt, partial)
  }
  await ownership(makeWorker)
  await legacy(makeWorker)
  await races(makeWorker)
  await tails(makeWorker, 1)
  await tails(makeWorker, 20)
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { positive, state, quantities }
