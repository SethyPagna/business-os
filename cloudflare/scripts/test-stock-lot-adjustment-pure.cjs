// Scoped "Set quantity" (owner, 17 Sep; confirmed 24 Sep: "Set Quantity:
// offer selected received-date lot or branch total; selected lot is the
// default") -- the companion for cloudflare/migrations/0193_stock_lot_
// adjustment_operations.sql and lib/stockLotAdjustment.ts, the ONE lot-level
// Set writer behind POST /api/inventory/adjust {setScope} and PATCH
// /api/batches/:id/branches/:branchId.
//
// Ported from codex/existing-stock-lot-corrections-20260912's
// test-stock-lot-adjustment-native.cjs onto today's code, on the real-SQLite
// harness (every migration applied, the REAL route and lib files transpiled,
// mounted in Hono and driven over HTTP), because today's writer sits inside
// runAdjustActionKernel behind the 0192 receipt wrapper and the maintenance
// guard, which the branch's Miniflare fixture did not load.
//
// Every stock number is asserted at each step. Loss classification uses the
// real lib/removalLosses.ts SQL and reducer.
//
// STOCK_LOT_TEST_ROOT=<dir containing src/> runs the same file against
// another tree (used to prove these checks red on the pre-change source).
//
// Run (from cloudflare/): node scripts/test-stock-lot-adjustment-pure.cjs
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { Hono } = require('hono')
const { fixture, user } = require('./test-stock-session-atomic.cjs')

const root = process.env.STOCK_LOT_TEST_ROOT || path.join(__dirname, '..')
const migrations = path.join(__dirname, '..', 'migrations')

function loadModules() {
  const cache = new Map()
  const load = (relativeFile) => {
    const normalized = relativeFile.replaceAll('\\', '/')
    if (cache.has(normalized)) return cache.get(normalized).exports
    const file = path.join(root, 'src', normalized)
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
    }).outputText
    const mod = { exports: {} }
    cache.set(normalized, mod)
    const req = (name) => {
      if (name === '../lib/auth' || name === './auth') return {
        requireAuth: async (c, next) => { c.set('user', c.req.header('x-test-user') ? JSON.parse(c.req.header('x-test-user')) : user); await next() },
      }
      if (name === './cache' || name === '../lib/cache') return { bumpVersion: async () => {}, getVersion: async () => 0, cacheKey: (...a) => a.join(':'), cachedJson: async (c, k, t, fn) => c.json(await fn()) }
      if (name === '../durable-objects/broadcastHub') return { broadcast: async () => {} }
      if (name === './telegram' || name === '../lib/telegram') return { sendTelegramEvent: async () => {}, formatStockChangeTelegramLines: () => [], formatTransferTelegramLines: () => [] }
      if (name.startsWith('./')) return load(path.posix.join(path.posix.dirname(normalized), `${name.slice(2)}.ts`))
      if (name.startsWith('../')) return load(path.posix.join(path.posix.dirname(normalized), `${name}.ts`))
      return require(name)
    }
    new Function('require', 'module', 'exports', output)(req, mod, mod.exports)
    return mod.exports
  }
  return load
}

const load = loadModules()
const app = new Hono()
app.route('/api/inventory', load('routes/inventory.ts').default)
app.route('/api/batches', load('routes/batches.ts').default)
app.route('/api/action-history', load('routes/actionHistory.ts').default)
const losses = load('lib/removalLosses.ts')
const ledger = load('lib/stockLedgerQuery.ts')
const backup = load('lib/backup.ts')

// Both schema probes memoise only a positive answer per isolate; a test that
// drops a table in a fresh database must forget the earlier positive answer.
function resetProbes() {
  load('lib/stockMutationReceipt.ts').resetStockMutationReceiptSchemaProbe()
  try { load('lib/stockLotAdjustment.ts').resetStockLotSetSchemaProbe() } catch { /* absent on the pre-change tree */ }
}

function seeded() {
  resetProbes()
  const f = fixture()
  f.sql.exec(`
    INSERT INTO branches(id, name, is_default, is_active) VALUES(2, 'Warehouse', 0, 1);
    INSERT INTO product_batches(id, variant_product_id, batch_key, lot_code, received_at, batch_number, unit_cost_usd, is_active)
      VALUES(10, 1, 'OLD', 'OLD', '2026-09-02', 1, 3, 1), (11, 1, 'NEW', 'NEW', '2026-09-09', 2, 5, 1);
    INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) VALUES(10, 1, 3), (11, 1, 7);
    UPDATE branch_stock SET quantity=10 WHERE product_id=1 AND branch_id=1;
    UPDATE products SET stock_quantity=10 WHERE id=1;
  `)
  return f
}

function call(f, method, url, body, headers = {}) {
  return app.request(url, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, f.env, { waitUntil(promise) { Promise.resolve(promise).catch(() => {}) } })
}
async function send(f, method, url, body, headers) {
  const res = await call(f, method, url, body, headers)
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
const setLot = (id, quantity, extra = {}) => ({ type: 'set', setScope: 'lot', productId: 1, branchId: 1, batchId: 10, quantity, reason: 'Physical count', client_request_id: id, ...extra })

function stock(f) {
  const q = (sql, ...a) => Number(f.sql.prepare(sql).get(...a)?.q ?? 0)
  return {
    lot10: q('SELECT quantity q FROM branch_batch_stock WHERE batch_id=10 AND branch_id=1'),
    lot11: q('SELECT quantity q FROM branch_batch_stock WHERE batch_id=11 AND branch_id=1'),
    branch: q('SELECT quantity q FROM branch_stock WHERE product_id=1 AND branch_id=1'),
    product: q('SELECT stock_quantity q FROM products WHERE id=1'),
    held: q('SELECT COALESCE(SUM(quantity_remaining),0) q FROM damaged_stock_lots WHERE product_id=1'),
  }
}
const movements = f => f.sql.prepare('SELECT id,movement_type,quantity,unit_cost_usd,total_cost_usd,reference_id,batch_id FROM inventory_movements ORDER BY id').all()
function loss(f) {
  const rows = f.sql.prepare(`SELECT ${losses.REMOVAL_LOSS_SELECT} ${losses.REMOVAL_LOSS_FROM} WHERE ${losses.removalLossMovementWhere('m')}`).all()
  return losses.summarizeRemovalLosses(rows)
}
const history = (f, id) => f.sql.prepare('SELECT status, undo_payload FROM action_history WHERE id=?').get(id)
const undo = (f, id, generation) => send(f, 'POST', `/api/action-history/${id}/undo`, { expected_generation: generation, require_applied: true })
const redo = (f, id, generation) => send(f, 'POST', `/api/action-history/${id}/redo`, { expected_generation: generation, require_applied: true })

const failures = []
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.error(`FAIL ${name}\n`, error) }
}

async function main() {
  await check('0193 is schema-only: applying it to a populated database changes no business row', async () => {
    const f = seeded()
    f.sql.exec('DROP TABLE stock_lot_adjustment_operations')
    const snapshot = () => JSON.stringify(['products', 'product_batches', 'branch_stock', 'branch_batch_stock', 'inventory_movements', 'audit_logs', 'action_history']
      .map(t => f.sql.prepare(`SELECT * FROM ${t}`).all()))
    const before = snapshot()
    f.sql.exec(fs.readFileSync(path.join(migrations, '0193_stock_lot_adjustment_operations.sql'), 'utf8'))
    assert.equal(snapshot(), before)
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='stock_lot_adjustment_operations'").get().n, 1)
    assert.ok(!fs.readFileSync(path.join(migrations, '0193_stock_lot_adjustment_operations.sql'), 'utf8').includes('\r'), 'LF-only')
  })

  await check('lot-scope Set moves only the selected lot; up is an adjustment at the lot cost with exact history', async () => {
    const f = seeded()
    const res = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-set-up-0001', 5))
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(stock(f), { lot10: 5, lot11: 7, branch: 12, product: 12, held: 0 })
    const [m] = movements(f)
    assert.equal(m.movement_type, 'adjustment'); assert.equal(m.quantity, 2); assert.equal(m.unit_cost_usd, 3); assert.equal(m.total_cost_usd, 6); assert.equal(m.batch_id, 10)
    assert.equal(m.reference_id, `stock-set:${res.json.operation_id}:0`)
    assert.equal(history(f, res.json.action_history_id).status, 'undoable')
    assert.equal(loss(f).removal_loss_usd, 0, 'an upward Set is not a loss')
  })

  await check('the same scoped Set twice is applied once (0192 receipt) and once without 0192 (0193 identity)', async () => {
    for (const drop0192 of [false, true]) {
      const f = seeded()
      if (drop0192) f.sql.exec('DROP TABLE stock_mutation_receipts')
      const first = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-set-twice-01', 6))
      const second = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-set-twice-01', 6))
      assert.equal(first.status, 200); assert.equal(second.status, 200)
      assert.equal(second.json.replayed, true)
      assert.equal(second.json.operation_id, first.json.operation_id)
      assert.deepEqual(stock(f), { lot10: 6, lot11: 7, branch: 13, product: 13, held: 0 })
      assert.equal(movements(f).length, 1, 'double-apply: one movement only')
      assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM stock_lot_adjustment_operations').get().n, 1)
      const other = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-set-twice-01', 1))
      assert.equal(other.status, 409, 'same id, different data')
      assert.deepEqual(stock(f), { lot10: 6, lot11: 7, branch: 13, product: 13, held: 0 })
    }
  })

  await check('undo -> undo -> redo restores and re-applies exact stock; generations advance once', async () => {
    const f = seeded()
    const set = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-undo-cycle-1', 1))
    assert.deepEqual(stock(f), { lot10: 1, lot11: 7, branch: 8, product: 8, held: 0 })
    assert.equal(set.json.movementType, 'remove')
    assert.equal(loss(f).removal_loss_usd, 6, 'untagged down-Set is a loss at the lot cost (2 x 3)')
    const id = set.json.action_history_id
    const u1 = await undo(f, id, 0)
    assert.equal(u1.status, 200, JSON.stringify(u1.json))
    assert.deepEqual(stock(f), { lot10: 3, lot11: 7, branch: 10, product: 10, held: 0 })
    assert.equal(loss(f).removal_loss_usd, 0, 'an undone loss is no longer counted')
    const counter = movements(f).at(-1)
    assert.equal(counter.movement_type, 'adjustment'); assert.equal(counter.reference_id, `revert:${movements(f)[0].id}`)
    const u2 = await undo(f, id, 0)
    assert.equal(u2.status, 200, 'a repeated undo of the same generation is idempotent')
    const u3 = await undo(f, id, 1)
    assert.equal(u3.status, 409, 'undo of an already reversed generation is refused')
    assert.deepEqual(stock(f), { lot10: 3, lot11: 7, branch: 10, product: 10, held: 0 }, 'second undo moves nothing')
    assert.equal(movements(f).length, 2)
    const r = await redo(f, id, 1)
    assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.deepEqual(stock(f), { lot10: 1, lot11: 7, branch: 8, product: 8, held: 0 })
    assert.equal(movements(f).at(-1).reference_id, `stock-set:${set.json.operation_id}:2`)
    assert.equal(loss(f).removal_loss_usd, 6, 'the redone removal is a loss again, once')
    assert.equal(JSON.parse(history(f, id).undo_payload).generation, 2)
  })

  await check('undo is refused after an intervening sale and changes nothing', async () => {
    const f = seeded()
    const set = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-undo-sale-01', 5))
    f.sql.exec(`UPDATE branch_batch_stock SET quantity=quantity-1 WHERE batch_id=10 AND branch_id=1;
      UPDATE branch_stock SET quantity=quantity-1 WHERE product_id=1 AND branch_id=1;
      UPDATE products SET stock_quantity=stock_quantity-1 WHERE id=1;
      INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,batch_id) VALUES(1,1,'sale',1,10);`)
    const before = stock(f)
    const res = await undo(f, set.json.action_history_id, 0)
    assert.equal(res.status, 409, JSON.stringify(res.json))
    assert.deepEqual(stock(f), before)
    assert.equal(history(f, set.json.action_history_id).status, 'undoable')
  })

  await check('refused during maintenance: Set and undo change nothing', async () => {
    const f = seeded()
    const set = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-maint-set-01', 5))
    f.sql.exec(`INSERT OR REPLACE INTO system_flags(key,value) VALUES('maintenance','{"mode":"restore"}')`)
    const before = stock(f)
    const blocked = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-maint-set-02', 0))
    assert.equal(blocked.status, 503, JSON.stringify(blocked.json))
    const blockedUndo = await undo(f, set.json.action_history_id, 0)
    assert.equal(blockedUndo.status, 503, JSON.stringify(blockedUndo.json))
    assert.deepEqual(stock(f), before)
    assert.equal(movements(f).length, 1)
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM stock_lot_adjustment_operations').get().n, 1)
  })

  await check('loss rule: untagged down counted, tagged down held and not counted, up not counted; tagged undo empties the held row', async () => {
    const f = seeded()
    const down = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-loss-down-01', 4, { batchId: 11 }))
    assert.equal(down.json.movementType, 'remove')
    assert.deepEqual(stock(f), { lot10: 3, lot11: 4, branch: 7, product: 7, held: 0 })
    assert.equal(loss(f).removal_loss_usd, 15, '3 units at lot 11 cost 5')
    const tagged = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-loss-tag-001', 2, { batchId: 11, conditionTag: 'damaged' }))
    assert.equal(tagged.status, 200, JSON.stringify(tagged.json))
    assert.equal(tagged.json.movementType, 'damage_out')
    assert.deepEqual(stock(f), { lot10: 3, lot11: 2, branch: 5, product: 5, held: 2 })
    const hold = movements(f).at(-1)
    assert.equal(hold.movement_type, 'damage_out'); assert.equal(hold.unit_cost_usd, 5); assert.equal(hold.batch_id, 11)
    const heldRow = f.sql.prepare('SELECT condition_tag,source,batch_id,unit_cost_usd FROM damaged_stock_lots').get()
    assert.deepEqual(heldRow, { condition_tag: 'damaged', source: 'remove', batch_id: 11, unit_cost_usd: 5 }, 'same row the tagged Remove path writes')
    assert.equal(loss(f).removal_loss_usd, 15, 'a tagged down-Set is not a loss')
    const up = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-loss-up-0001', 6, { batchId: 11 }))
    assert.equal(up.json.movementType, 'adjustment')
    assert.equal(loss(f).removal_loss_usd, 15, 'an up-Set is not a loss')
    assert.equal((await send(f, 'POST', '/api/inventory/adjust', setLot('lot-loss-uptag-1', 9, { batchId: 11, conditionTag: 'damaged' }))).status, 400)
    assert.equal((await undo(f, up.json.action_history_id, 0)).status, 200)
    const tu = await undo(f, tagged.json.action_history_id, 0)
    assert.equal(tu.status, 200, JSON.stringify(tu.json))
    assert.deepEqual(stock(f), { lot10: 3, lot11: 4, branch: 7, product: 7, held: 0 })
    assert.equal((await undo(f, down.json.action_history_id, 0)).status, 200)
    assert.deepEqual(stock(f), { lot10: 3, lot11: 7, branch: 10, product: 10, held: 0 })
    assert.equal(loss(f).removal_loss_usd, 0)
  })

  await check('tagged undo is refused once the held row was disposed of', async () => {
    const f = seeded()
    const tagged = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-tag-dispose1', 1, { conditionTag: 'broken' }))
    f.sql.exec('UPDATE damaged_stock_lots SET quantity_remaining=0')
    const before = stock(f)
    assert.equal((await undo(f, tagged.json.action_history_id, 0)).status, 409)
    assert.deepEqual(stock(f), before)
  })

  await check('branch-total scope adjusts the selected lot by the branch difference and refuses a shortage', async () => {
    const f = seeded()
    const res = await send(f, 'POST', '/api/inventory/adjust', setLot('branch-scope-001', 12, { setScope: 'branch' }))
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(stock(f), { lot10: 5, lot11: 7, branch: 12, product: 12, held: 0 })
    const short = await send(f, 'POST', '/api/inventory/adjust', setLot('branch-scope-002', 1, { setScope: 'branch' }))
    assert.equal(short.status, 409, 'lot 10 holds 5 and cannot give up 11')
    assert.deepEqual(stock(f), { lot10: 5, lot11: 7, branch: 12, product: 12, held: 0 })
    const stale = await send(f, 'POST', '/api/inventory/adjust', setLot('branch-scope-003', 4, { expectedLotQuantity: 9 }))
    assert.equal(stale.status, 409, 'a stale preview is refused')
  })

  await check('PATCH /batches/:id/branches/:branchId is the same writer (lot scope, loss rule, undo)', async () => {
    const f = seeded()
    const res = await send(f, 'PATCH', '/api/batches/10/branches/1', { quantity: 0 })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(stock(f), { lot10: 0, lot11: 7, branch: 7, product: 7, held: 0 })
    assert.equal(movements(f)[0].movement_type, 'remove')
    assert.equal(loss(f).removal_loss_usd, 9)
    assert.equal((await undo(f, res.json.action_history_id, 0)).status, 200)
    assert.deepEqual(stock(f), { lot10: 3, lot11: 7, branch: 10, product: 10, held: 0 })
    // Part-77 floor kept: a drifted aggregate floors at zero, undo restores it exactly.
    f.sql.exec('UPDATE branch_stock SET quantity=2 WHERE product_id=1 AND branch_id=1')
    const floored = await send(f, 'PATCH', '/api/batches/11/branches/1', { quantity: 0 })
    assert.equal(floored.status, 200)
    assert.equal(stock(f).branch, 0)
    assert.equal((await undo(f, floored.json.action_history_id, 0)).status, 200)
    assert.equal(stock(f).branch, 2)
    assert.equal(stock(f).lot11, 7)
    // The editor's figure is a guard, and its request id makes a retry replay.
    assert.equal((await send(f, 'PATCH', '/api/batches/10/branches/1', { quantity: 1, expectedLotQuantity: 9 })).status, 409)
    const before = movements(f).length
    const once = await send(f, 'PATCH', '/api/batches/10/branches/1', { quantity: 1, expectedLotQuantity: 3, client_request_id: 'patch-lot-once-01' })
    const again = await send(f, 'PATCH', '/api/batches/10/branches/1', { quantity: 1, expectedLotQuantity: 3, client_request_id: 'patch-lot-once-01' })
    assert.equal(once.status, 200); assert.equal(again.json.replayed, true)
    assert.equal(stock(f).lot10, 1)
    assert.equal(movements(f).length, before + 1, 'the retried PATCH is applied once')
  })

  await check('the stock ledger refuses to revert a scoped Set or its undo counter', async () => {
    const f = seeded()
    const set = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-revert-deny1', 5))
    const forward = movements(f)[0]
    assert.equal((await send(f, 'POST', `/api/inventory/movements/${forward.id}/revert`)).status, 409)
    await undo(f, set.json.action_history_id, 0)
    const counter = movements(f).at(-1)
    const before = stock(f)
    assert.equal((await send(f, 'POST', `/api/inventory/movements/${counter.id}/revert`)).status, 409)
    assert.deepEqual(stock(f), before)
  })

  await check('without 0193 the ledger read works and a Set still applies (no undo recorded)', async () => {
    const f = seeded()
    f.sql.exec('DROP TABLE stock_lot_adjustment_operations')
    const res = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-no-0193-001', 5))
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.equal(res.json.server_recorded, false)
    assert.deepEqual(stock(f), { lot10: 5, lot11: 7, branch: 12, product: 12, held: 0 })
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM action_history').get().n, 0)
    const query = ledger.buildStockLedgerQuery({ productId: 1 })
    const rows = f.sql.prepare(query.rowsSql.replace(/@(\w+)/g, ':$1')).all({ ...query.params, limit: 50, offset: 0 })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].movement_type, 'adjustment')
  })

  await check('backup round-trip keeps the operation row and its undo still replays after restore', async () => {
    const f = seeded()
    assert.ok(backup.BACKUP_TABLES.indexOf('stock_lot_adjustment_operations') > backup.BACKUP_TABLES.indexOf('action_history'))
    assert.ok(backup.SALE_REPLAY_RESTORE_BUNDLE.includes('stock_lot_adjustment_operations'))
    const set = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-backup-00001', 5))
    const doc = JSON.stringify({ format: 'business-os-cloudflare-backup', formatVersion: 1, tables: Object.fromEntries(backup.BACKUP_TABLES
      .filter(t => f.sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t))
      .map(t => [t, { columns: f.sql.pragma(`table_info(${t})`).map(c => c.name), rows: f.sql.prepare(`SELECT * FROM ${t}`).all() }])),
      r2: { assets: [], copiedKeys: [] }, summary: { schemaMigration: '0193_stock_lot_adjustment_operations.sql' } })
    const saved = f.sql.prepare('SELECT * FROM stock_lot_adjustment_operations').all()
    await send(f, 'POST', '/api/inventory/adjust', setLot('lot-backup-00002', 7, { batchId: 11 }))
    const etag = require('node:crypto').createHash('sha256').update(doc).digest('hex')
    const env = { ...f.env, ASSETS: { async get(key, options) {
      if (!key.endsWith('fixture.json')) return null
      const metadata = { key, etag, version: 'fixture-upload', size: Buffer.byteLength(doc) }
      if (options?.onlyIf?.etagMatches && options.onlyIf.etagMatches !== etag) return metadata
      return { ...metadata, body: new Blob([doc]).stream(), customMetadata: { format: 'business-os-cloudflare-backup' } }
    } } }
    f.sql.exec(`INSERT OR REPLACE INTO system_flags(key,value) VALUES('maintenance','{"mode":"restore"}')`)
    await backup.restoreCloudflareBackup(env, 'fixture.json')
    f.sql.exec("DELETE FROM system_flags WHERE key='maintenance'")
    assert.deepEqual(f.sql.prepare('SELECT * FROM stock_lot_adjustment_operations').all(), saved)
    assert.deepEqual(stock(f), { lot10: 5, lot11: 7, branch: 12, product: 12, held: 0 })
    assert.equal((await undo(f, set.json.action_history_id, 0)).status, 200)
    assert.deepEqual(stock(f), { lot10: 3, lot11: 7, branch: 10, product: 10, held: 0 })
  })

  await check('transfer with a selected received date draws only that lot and refuses a shortage', async () => {
    const f = seeded()
    const body = { productId: 1, fromBranchId: 1, toBranchId: 2, quantity: 2, batchId: 11, reason: 'Selected lot', client_request_id: 'transfer-lot-0001', transfer_provenance_version: 1 }
    const moved = await send(f, 'POST', '/api/inventory/transfer', body)
    assert.equal(moved.status, 200, JSON.stringify(moved.json))
    assert.equal(stock(f).lot10, 3, 'the older lot is not drawn FIFO')
    assert.equal(stock(f).lot11, 5)
    const replay = await send(f, 'POST', '/api/inventory/transfer', body)
    assert.equal(replay.json.replayed, true)
    assert.equal(stock(f).lot11, 5)
    const short = await send(f, 'POST', '/api/inventory/transfer', { ...body, batchId: 10, quantity: 4, client_request_id: 'transfer-lot-0002' })
    assert.equal(short.status, 409, JSON.stringify(short.json))
    assert.equal(stock(f).lot10, 3)
  })

  if (failures.length) throw new Error(`${failures.length} scoped Set check(s) failed: ${failures.join('; ')}`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
