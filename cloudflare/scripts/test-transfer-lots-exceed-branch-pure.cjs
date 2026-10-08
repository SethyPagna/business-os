// Real Hono transfer routes + action-history undo/redo on production
// migrations: lots that exceed branch stock no longer block a transfer, and
// every transfer refusal is a 4xx with a bilingual code/message (U-transfer2,
// 26 Sep 2026).
//
// The bug: transferEffectStatements' source guard evaluated
//   branch_stock - SUM(every lot row) < untracked
// for EVERY line. With lots 12 > branch 10 the left side is -2, so even a
// transfer the lots fully cover (untracked 0) tripped the NOT NULL sentinel
// ("NOT NULL constraint failed: branches.name" -- the planner's assertion
// idiom, nothing writes a branch) and, unmapped, reached the client as a 500.
//
// Transition table. S = source Warehouse (2), D = destination Shop (1),
// B = branch_stock, L = sum of lot rows, U = untracked part of q.
//   case                                   q    S.B     S.L     D.B    D.L    U
//   lot-less, L 12 > B 10                   5   10->5   12->7   0->5   0->5   0
//   chosen lot, L 12 > B 10                 5   10->5   12->7   0->5   0->5   0
//   q > branch (L 12 >= q)                 11   refused 400, zero effects
//   L 4 < B 10, lot-less                    7   10->3    4->0   0->7   0->4   3 (<= 10-4)
//   same, boundary                         10   10->0    4->0   0->10  0->4   6 (=  10-4)
//   bulk mix of the first, second, fourth  -   each row as above, one batch
//   lot-only +5 after planning, q 7         7   refused 409 transfer_stock_changed
//                                               (allowance max(10-9,0)=1 < 3)
//   lots 0.5 + 0.3 = B 0.8                0.8   0.8->0  0.8->0  0->0.8 0->0.8 0
//                                               (5.6e-17 of float noise was "untracked")
//   replay same key                         no second movement
//   undo                                    exact inverse; repeated undo moves nothing
//   redo                                    the forward row again
// Pre-existing divergence (L - B) is carried unchanged at S; D gets none.
// Positive stock under an inactive lot is impossible since migration 0154, so
// with q <= B the untracked allowance max(B - L, 0) >= q - (active lots)
// always holds; forward, the untracked check can only trip in a race.
//
// Run: node scripts/test-transfer-lots-exceed-branch-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const h = require('./test-transfer-operation-receipt-pure.cjs')
h.apps.history = h.load('routes/actionHistory.ts').default
h.apps.history.onError((error, c) => c.json({ error: error.message }, 500))

const S = 2
const D = 1
const ROUTES = [['branches', '/transfer'], ['branches', '/transfer-bulk'], ['inventory', '/transfer']]
const sql = () => h.getDb()
const branchQty = (product, branch) => sql().prepare('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=?').get(product, branch)?.quantity ?? 0
const lotsAt = (product, branch) => sql().prepare(`SELECT COALESCE(SUM(bs.quantity),0) AS n FROM branch_batch_stock bs
  JOIN product_batches b ON b.id=bs.batch_id WHERE b.variant_product_id=? AND bs.branch_id=?`).get(product, branch).n
const round = (value) => Math.round(value * 1e9) / 1e9
const ledger = (product) => ({ S: [round(branchQty(product, S)), round(lotsAt(product, S))], D: [round(branchQty(product, D)), round(lotsAt(product, D))] })
// Nonzero quantities only: a forward creates destination rows that undo
// leaves at 0, which is the same stock as no row.
function stockState() {
  return {
    branch: sql().prepare('SELECT product_id,branch_id,ROUND(quantity,9) q FROM branch_stock WHERE ABS(quantity)>0.000000001 ORDER BY product_id,branch_id').all(),
    lots: sql().prepare('SELECT batch_id,branch_id,ROUND(quantity,9) q FROM branch_batch_stock WHERE ABS(quantity)>0.000000001 ORDER BY batch_id,branch_id').all(),
    totals: sql().prepare('SELECT id,ROUND(stock_quantity,9) q FROM products ORDER BY id').all(),
  }
}
function snapshot() {
  return Object.fromEntries(['products', 'product_batches', 'branch_stock', 'branch_batch_stock', 'transfer_operation_receipts', 'transfer_operation_members',
    'stock_transfers', 'inventory_movements', 'action_history', 'audit_logs'].map((table) => [table, sql().prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
}
function body(route, key, lines) {
  const common = { transfer_provenance_version: 1, fromBranchId: S, toBranchId: D, reason: 'Restock', client_request_id: key }
  const line = ({ productId, quantity, batchId }) => (batchId ? { productId, quantity, batchId } : { productId, quantity })
  return route === '/transfer-bulk' ? { ...common, items: lines.map(line) } : { ...common, ...line(lines[0]) }
}
const reverse = (id, direction, generation) => h.request('history', `/${id}/${direction}`, { require_applied: true, expected_generation: generation })
const tag = (app, route) => `${app}${route.replace(/\W/g, '_')}`
const members = () => sql().prepare('SELECT source_product_id,quantity,untracked_quantity FROM transfer_operation_members ORDER BY ordinal').all()
const productTotalsMatchBranches = () => {
  for (const row of sql().prepare('SELECT id,stock_quantity FROM products').all()) {
    const sum = sql().prepare('SELECT COALESCE(SUM(quantity),0) n FROM branch_stock WHERE product_id=?').get(row.id).n
    assert.equal(round(row.stock_quantity), round(sum), `products.stock_quantity of #${row.id} must stay the branch sum`)
  }
}

// Forward, replay the same key, undo, repeat the undo, redo -- the whole
// double-apply/reversal cycle for one request. `after` is the expected
// ledger for every product the request moves.
async function cycle(app, route, request, after) {
  const start = stockState()
  const result = await h.request(app, route, request)
  assert.equal(result.status, 200, JSON.stringify(result.body))
  for (const [product, expected] of Object.entries(after)) assert.deepEqual(ledger(Number(product)), expected, `forward ledger of product ${product}`)
  productTotalsMatchBranches()
  const afterForward = snapshot()
  const replay = await h.request(app, route, request)
  assert.equal(replay.status, 200, JSON.stringify(replay.body))
  assert.equal(replay.body.replayed, true)
  assert.deepEqual(snapshot(), afterForward, 'the same request applied twice moves stock once')
  const historyId = result.body.action_history_id
  let reversal = await reverse(historyId, 'undo', 0)
  assert.equal(reversal.status, 200, JSON.stringify(reversal.body))
  assert.deepEqual(stockState(), start, 'undo restores both ledgers exactly')
  productTotalsMatchBranches()
  const afterUndo = snapshot()
  reversal = await reverse(historyId, 'undo', 0)
  assert.equal(reversal.status, 200, JSON.stringify(reversal.body))
  assert.deepEqual(snapshot(), afterUndo, 'a repeated undo of the same generation restores nothing twice')
  reversal = await reverse(historyId, 'redo', 1)
  assert.equal(reversal.status, 200, JSON.stringify(reversal.body))
  for (const [product, expected] of Object.entries(after)) assert.deepEqual(ledger(Number(product)), expected, `redo ledger of product ${product}`)
  productTotalsMatchBranches()
  return result
}

// `concurrent` is another writer landing between the route's checks and its
// batch; the refusal must leave exactly the state that writer produced.
async function refused(app, route, request, status, code, concurrent = null) {
  let before = snapshot()
  if (concurrent) h.beforeBatch(() => { concurrent(); before = snapshot() })
  const result = await h.request(app, route, request)
  assert.equal(result.status, status, JSON.stringify(result.body))
  if (code) assert.equal(result.body.code, code, JSON.stringify(result.body))
  assert.ok(typeof result.body.error === 'string' && result.body.error.length > 0, 'a refusal carries a readable message')
  assert.deepEqual(snapshot(), before, 'a refusal leaves every table untouched')
  return result
}

function loadFrontendModule(relative) {
  const file = path.join(__dirname, '..', '..', 'frontend', 'src', relative)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('exports', 'require', 'module', code)(module.exports, require, module)
  return module.exports
}

let checks = 0
const check = async (name, run) => { await run(); checks++; console.log(`PASS ${name}`) }

async function main() {
  const { TRANSFER_REFUSALS } = h.load('lib/transferOperation.ts')

  for (const [app, route] of ROUTES) for (const chosen of [false, true]) {
    await check(`${app}${route}: lots 12 > branch 10, ${chosen ? 'chosen lot' : 'lot-less'} q=5 moves 5 on both ledgers, once; undo/redo exact`, async () => {
      h.fresh(1, S)
      sql().exec(`UPDATE branch_batch_stock SET quantity=12 WHERE batch_id=1 AND branch_id=${S}`)
      await cycle(app, route, body(route, `exceed_${tag(app, route)}_${chosen ? 'lot' : 'fifo'}`, [{ productId: 1, quantity: 5, ...(chosen ? { batchId: 1 } : {}) }]),
        { 1: { S: [5, 7], D: [5, 5] } })
      assert.deepEqual(members().map((row) => row.untracked_quantity), [0])
      assert.equal(lotsAt(1, S) - branchQty(1, S), 2, 'the source keeps its pre-existing divergence, no more and no less')
      assert.equal(lotsAt(1, D) - branchQty(1, D), 0, 'the destination gets no divergence')
    })
  }

  for (const [app, route] of ROUTES) for (const chosen of [false, true]) {
    await check(`${app}${route}: q=11 over branch 10 is refused with zero effects even though ${chosen ? 'the chosen lot' : 'the lots'} hold 12`, async () => {
      h.fresh(1, S)
      sql().exec(`UPDATE branch_batch_stock SET quantity=12 WHERE batch_id=1 AND branch_id=${S}`)
      const result = await refused(app, route, body(route, `over_${tag(app, route)}_${chosen ? 'lot' : 'fifo'}`, [{ productId: 1, quantity: 11, ...(chosen ? { batchId: 1 } : {}) }]), 400)
      assert.match(result.body.error, /Insufficient stock/)
    })
  }

  for (const [app, route] of ROUTES) for (const [quantity, after, untracked] of [[7, { S: [3, 0], D: [7, 4] }, 3], [10, { S: [0, 0], D: [10, 4] }, 6]]) {
    await check(`${app}${route}: lots 4 < branch 10, lot-less q=${quantity} takes 4 from lots and ${untracked} untracked, as before; undo/redo exact`, async () => {
      h.fresh(1, S)
      sql().exec(`UPDATE branch_batch_stock SET quantity=4 WHERE batch_id=1 AND branch_id=${S}`)
      await cycle(app, route, body(route, `under_${tag(app, route)}_${quantity}`, [{ productId: 1, quantity }]), { 1: after })
      assert.deepEqual(members().map((row) => row.untracked_quantity), [untracked])
      const untrackedLegs = sql().prepare("SELECT movement_type,quantity FROM inventory_movements WHERE batch_id IS NULL AND reason='Restock' ORDER BY id").all()
      assert.deepEqual(untrackedLegs, [{ movement_type: 'transfer_out', quantity: untracked }, { movement_type: 'transfer_in', quantity: untracked }])
    })
  }

  await check('bulk: a lot-less row over-lotted, a chosen lot over-lotted and a lot-short row in ONE request move together; undo/redo exact', async () => {
    h.fresh(3, S)
    sql().exec(`UPDATE branch_batch_stock SET quantity=12 WHERE batch_id IN (1,2) AND branch_id=${S};
      UPDATE branch_batch_stock SET quantity=4 WHERE batch_id=3 AND branch_id=${S}`)
    await cycle('branches', '/transfer-bulk', body('/transfer-bulk', 'bulk_mix_0001', [
      { productId: 1, quantity: 5 }, { productId: 2, quantity: 5, batchId: 2 }, { productId: 3, quantity: 7 },
    ]), { 1: { S: [5, 7], D: [5, 5] }, 2: { S: [5, 7], D: [5, 5] }, 3: { S: [3, 0], D: [7, 4] } })
    assert.deepEqual(members().map((row) => [row.source_product_id, row.quantity, row.untracked_quantity]), [[1, 5, 0], [2, 5, 0], [3, 7, 3]])
  })

  // The untracked allowance is still max(branch - every lot, 0). A lot-only
  // write that lands after planning shrinks it below the planned untracked
  // part: the batch refuses, as a 409 the client can act on.
  for (const [app, route] of ROUTES) {
    await check(`${app}${route}: an untracked part over max(branch - lots, 0) at commit time is refused 409 transfer_stock_changed, zero effects`, async () => {
      h.fresh(1, S)
      sql().exec(`UPDATE branch_batch_stock SET quantity=4 WHERE batch_id=1 AND branch_id=${S}`)
      const result = await refused(app, route, body(route, `short_${tag(app, route)}`, [{ productId: 1, quantity: 7 }]), 409, 'transfer_stock_changed',
        () => sql().exec(`UPDATE branch_batch_stock SET quantity=9 WHERE batch_id=1 AND branch_id=${S}`))
      assert.equal(result.body.error, TRANSFER_REFUSALS.transfer_stock_changed)
    })
  }

  for (const [app, route] of ROUTES) {
    await check(`${app}${route}: float residue -- 0.8 from lots 0.5 + 0.3 with branch 0.8 moves, with no phantom untracked row; undo exact`, async () => {
      h.fresh(1, S)
      sql().exec(`UPDATE branch_stock SET quantity=0.8 WHERE product_id=1 AND branch_id=${S}; UPDATE products SET stock_quantity=0.8 WHERE id=1;
        UPDATE branch_batch_stock SET quantity=0.5 WHERE batch_id=1 AND branch_id=${S};
        INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active) VALUES (61,1,'newer','newer','2026-09-02',1);
        INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES (61,${S},0.3)`)
      await cycle(app, route, body(route, `float_${tag(app, route)}`, [{ productId: 1, quantity: 0.8 }]), { 1: { S: [0, 0], D: [0.8, 0.8] } })
      assert.deepEqual(members().map((row) => row.untracked_quantity), [0])
      assert.equal(sql().prepare('SELECT COUNT(*) n FROM inventory_movements WHERE batch_id IS NULL').get().n, 0, 'float noise is not an untracked movement')
    })
  }

  await check('undo edge: an untracked part cannot return from a destination whose lots now claim all its stock (409, zero effects)', async () => {
    h.fresh(1, S)
    sql().exec(`UPDATE branch_batch_stock SET quantity=4 WHERE batch_id=1 AND branch_id=${S}`)
    const result = await h.request('branches', '/transfer-bulk', body('/transfer-bulk', 'undo_edge_001', [{ productId: 1, quantity: 7 }]))
    assert.equal(result.status, 200, JSON.stringify(result.body))
    sql().exec(`UPDATE branch_batch_stock SET quantity=quantity+10 WHERE batch_id=1 AND branch_id=${D}`)
    const before = snapshot()
    const undo = await reverse(result.body.action_history_id, 'undo', 0)
    assert.equal(undo.status, 409, JSON.stringify(undo.body))
    assert.deepEqual(snapshot(), before, 'taking 3 untracked units there would widen its lots-over-branch gap')
  })

  for (const [app, route] of ROUTES) {
    await check(`${app}${route}: every refusal is a 4xx with a code -- race, planner, maintenance -- and a real failure stays 500`, async () => {
      // A concurrent sale drained the source between the route's check and the batch.
      h.fresh(1, S)
      let result = await refused(app, route, body(route, `race_${tag(app, route)}`, [{ productId: 1, quantity: 2 }]), 409, 'transfer_stock_changed',
        () => sql().exec(`UPDATE branch_stock SET quantity=0 WHERE product_id=1 AND branch_id=${S}`))
      assert.equal(result.body.error, TRANSFER_REFUSALS.transfer_stock_changed)
      // Recreate a historical removed-stock product before0242, then test the guarded planner.
      h.fresh(1, S, '0242')
      sql().exec('UPDATE products SET is_active=0 WHERE id=1')
      for (const migrationFile of fs.readdirSync(path.join(__dirname, '../migrations')).filter(file => file.endsWith('.sql') && file >= '0242').sort()) {
        sql().exec(fs.readFileSync(path.join(__dirname, '../migrations', migrationFile), 'utf8'))
      }
      result = await refused(app, route, body(route, `inactive_${tag(app, route)}`, [{ productId: 1, quantity: 2 }]), 409, 'transfer_stock_changed')
      assert.equal(result.body.error, TRANSFER_REFUSALS.transfer_stock_changed)
      // Maintenance arriving after admission: the house 503, never a 500.
      h.fresh(1, S)
      result = await refused(app, route, body(route, `maint_${tag(app, route)}`, [{ productId: 1, quantity: 2 }]), 503, 'maintenance_active',
        () => sql().prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").run(JSON.stringify({ mode: 'restore' })))
      assert.equal(result.body.error, TRANSFER_REFUSALS.transfer_maintenance_active)
      // Control: a genuine write failure is not dressed up as a refusal.
      h.fresh(1, S)
      h.failAt('INSERT INTO stock_transfers')
      await refused(app, route, body(route, `failure_${tag(app, route)}`, [{ productId: 1, quantity: 2 }]), 500)
    })
  }

  await check('inventory/transfer: a chosen lot short of q is the planner refusal 409 transfer_selected_lot_short', async () => {
    h.fresh(1, S)
    sql().exec(`UPDATE branch_batch_stock SET quantity=4 WHERE batch_id=1 AND branch_id=${S}`)
    const result = await refused('inventory', '/transfer', body('/transfer', 'lot_short_inventory', [{ productId: 1, quantity: 7, batchId: 1 }]), 409, 'transfer_selected_lot_short')
    assert.equal(result.body.error, TRANSFER_REFUSALS.transfer_selected_lot_short)
  })

  await check('every refusal sentence is the English of its pack key, translated in km, and localized by the frontend mapping', async () => {
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'lang', 'en.json'), 'utf8'))
    const km = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'lang', 'km.json'), 'utf8'))
    const rules = loadFrontendModule(path.join('api', 'branchRuleErrors.ts'))
    assert.ok(TRANSFER_REFUSALS && Object.keys(TRANSFER_REFUSALS).length === 4, 'lib/transferOperation.ts exports the four transfer refusals')
    for (const [key, english] of Object.entries(TRANSFER_REFUSALS)) {
      assert.equal(en[key], english, `en.json ${key} must be the sentence the Worker sends`)
      assert.ok(km[key] && km[key] !== english, `km.json ${key} must be translated`)
      assert.equal(rules.branchRuleMessageKey(english), key, `branchRuleErrors maps "${english}"`)
      assert.equal(rules.localizeBranchRuleError(`Error: ${english}`, (k) => km[k]), km[key], `a Khmer session reads ${key} in Khmer`)
    }
    for (const code of ['transfer_stock_changed', 'transfer_selected_lot_short', 'transfer_too_many_lots']) {
      assert.equal(rules.branchRuleErrorKey({ code, message: 'server wording' }), code, `the ${code} response code localizes too`)
    }
  })

  console.log(`${checks} lots-over-branch transfer checks passed`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
