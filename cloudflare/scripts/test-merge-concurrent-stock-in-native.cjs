// MERGE-UNBLOCK follow-up (1 Oct 2026, R-MERGE-UNBLOCK F3 + F6a).
//
// F3: a stock-in that lands on the DISCARDED product between a merge's read and
// its write batch stranded units on the deactivated product (the fold deleted
// the shelf row it had not read and left the new lot behind). The fold now
// asserts, in the same D1 batch, that the discarded product's shelf, lots and
// movement count still equal what it read; on mismatch the whole batch aborts
// (closed-session statements included) and the route answers 409
// merge_conflict_retry, after which the same request succeeds.
//
// F6a: the lot repoint used one statement per lot, so a product with about 75
// lots crossed the 100-statement bound and answered 500 (which the Resolve
// dialog treats as retryable, so Continue looped). Repoints are now chunked and
// an overflow that remains is a coded 409, never a 500.
//
// Real routes/products.ts, real fold, real stock-session commit and the full
// migration chain in SQLite. All data is synthetic.
//
// Run (from cloudflare/): node scripts/test-merge-concurrent-stock-in-native.cjs
'use strict'
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

const MARKER = 'undo_closed:products_merged'
const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) {
    failed += 1
    console.log(`FAIL ${name}\n${error && error.stack ? error.stack : error}`)
  }
}

function fixture(products) {
  const h = createProductsRouteHarness({ user: ADMIN })
  h.setUser(ADMIN)
  h.raw.db.exec(`INSERT INTO branches(id, name, is_default, is_active) VALUES(1, 'Shop', 1, 1), (2, 'Warehouse', 0, 1);`)
  for (const p of products) {
    h.raw.prepare('INSERT INTO products(id, name, barcode, cost_price_usd, selling_price_usd, stock_quantity, is_active) VALUES(?,?,?,?,?,0,1)')
      .run([p.id, p.name, p.barcode, 2, 5])
  }
  const sessions = h.load('lib/stockSession.ts')
  const env = { DB: h.raw }
  let counter = 0
  const receive = async (productId, quantity, { branchId = 1, day = null } = {}) => sessions.commitStockSession(env, ADMIN, {
    client_request_id: `req-concurrent-${String(counter += 1).padStart(5, '0')}`,
    mode: 'stock_in',
    defaults: { branch_id: branchId, received_date: day || `2026-09-${String(10 + (counter % 18)).padStart(2, '0')}`, supplier_name: 'Synthetic Supplier' },
    items: [{ line_id: `l${counter}`, kind: 'receive', product_id: productId, quantity, unit_cost_usd: 3 }],
  })
  return { h, receive }
}

const TWINS = [
  { id: 1, name: 'Gloss One', barcode: '8850000000011' },
  { id: 2, name: 'Gloss One', barcode: '8850000000011' },
]

const one = (f, sql, ...params) => f.h.raw.prepare(sql).get(params)
const history = (f, id) => one(f, 'SELECT status, reversible, last_error FROM action_history WHERE id = ?', id)
const shelf = (f) => one(f, 'SELECT COALESCE(SUM(quantity), 0) AS n FROM branch_stock').n
const lots = (f) => one(f, 'SELECT COALESCE(SUM(quantity), 0) AS n FROM branch_batch_stock').n
const strandedOnInactive = (f) => one(f, `SELECT COALESCE(SUM(bbs.quantity), 0) AS n FROM branch_batch_stock bbs
  JOIN product_batches pb ON pb.id = bbs.batch_id JOIN products p ON p.id = pb.variant_product_id WHERE p.is_active = 0`).n

function digest(f) {
  const tables = ['products', 'branch_stock', 'product_batches', 'branch_batch_stock', 'inventory_movements', 'action_history', 'audit_logs', 'undo_snapshots', 'stock_session_members']
  return JSON.stringify(tables.map((table) => [table, f.h.raw.prepare(`SELECT * FROM ${table} ORDER BY 1`).all([])]))
}

// Runs `late(discardedProductId)` exactly once, between the fold's reads and its
// write batch, and records the database as it stood at that instant.
function interleave(f, late) {
  const real = f.h.raw.batch.bind(f.h.raw)
  const state = { fired: false, digestAtWrite: null }
  f.h.raw.batch = async (items) => {
    const foldBatch = items.find((item) => /merge_source_guard/.test(item.sql))
    if (!state.fired && foldBatch) {
      state.fired = true
      await late(Number(foldBatch.params.id))
      state.digestAtWrite = digest(f)
    }
    return real(items)
  }
  return { state, restore: () => { f.h.raw.batch = real } }
}

async function main() {
  const modes = [
    { name: 'pair merge', lateBranch: 1, send: (f) => f.h.request('POST', '/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge' }) },
    { name: 'pair merge, late receipt in another branch', lateBranch: 2, send: (f) => f.h.request('POST', '/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge' }) },
    { name: 'keep merge without a review plan', lateBranch: 1, send: (f) => f.h.request('POST', '/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge', keep: true }) },
    { name: 'whole-catalog merge', lateBranch: 1, send: (f) => f.h.request('POST', '/merge-duplicates', {}) },
  ]
  for (const mode of modes) {
    await check(`DISCRIMINATING: ${mode.name}: a stock-in landing between read and write aborts with merge_conflict_retry, strands nothing, and the retry succeeds`, async () => {
      const f = fixture(TWINS)
      const early = await f.receive(2, 4)
      const hook = interleave(f, async (discardedId) => { f.lateReceipt = await f.receive(discardedId, 6, { branchId: mode.lateBranch }) })
      const res = await mode.send(f)
      hook.restore()
      assert.ok(hook.state.fired, 'the interleaving point was reached')
      if (mode.name === 'whole-catalog merge') {
        assert.equal(res.status, 200, JSON.stringify(res.json))
        const refusal = (res.json.refusals || []).find((item) => item.code === 'merge_conflict_retry')
        assert.ok(refusal, `the case is refused with merge_conflict_retry: ${JSON.stringify(res.json)}`)
        assert.equal(res.json.mergedProducts ?? res.json.merged ?? 0, 0, 'nothing merged')
      } else {
        assert.equal(res.status, 409, JSON.stringify(res.json))
        assert.equal(res.json.code, 'merge_conflict_retry')
      }
      assert.match(String(res.json.error || res.json.refusals?.[0]?.error), /stock|try again|changed/i, 'the answer says what to do')

      assert.equal(digest(f), hook.state.digestAtWrite, 'nothing the merge would have written survived the abort')
      assert.equal(one(f, 'SELECT COUNT(*) AS n FROM products WHERE is_active = 1').n, 2, 'both products are still active')
      assert.equal(strandedOnInactive(f), 0)
      assert.equal(shelf(f), 10)
      assert.equal(lots(f), 10)
      assert.equal(history(f, early.actionHistoryId).status, 'undoable', 'an aborted merge closes no session')
      assert.equal(history(f, f.lateReceipt.actionHistoryId).status, 'undoable')
      assert.equal(one(f, "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'stock_session_undo_closed'").n, 0)

      const retry = await mode.send(f)
      assert.equal(retry.status, 200, JSON.stringify(retry.json))
      assert.equal(one(f, 'SELECT COUNT(*) AS n FROM products WHERE is_active = 1').n, 1, 'one product remains')
      assert.equal(one(f, 'SELECT COALESCE(SUM(bs.quantity), 0) AS n FROM branch_stock bs JOIN products p ON p.id = bs.product_id WHERE p.is_active = 1').n, 10, 'all ten units are on the survivor')
      assert.equal(shelf(f), lots(f))
      assert.equal(strandedOnInactive(f), 0)
      assert.equal(history(f, f.lateReceipt.actionHistoryId).last_error, MARKER, 'after the retry the late session is closed too')
    })
  }

  await check('DISCRIMINATING: the product-edit fold (PUT /:id renaming onto a twin) aborts the same way and its retry succeeds', async () => {
    const f = fixture([{ id: 1, name: 'Gloss One', barcode: '8850000000011' }, { id: 2, name: 'Gloss Two', barcode: '8850000000022' }])
    await f.receive(2, 4)
    const hook = interleave(f, async (discardedId) => { f.lateReceipt = await f.receive(discardedId, 6) })
    const res = await f.h.request('PUT', '/2', { name: 'Gloss One', barcode: '8850000000011' })
    hook.restore()
    assert.ok(hook.state.fired)
    assert.equal(res.status, 409, JSON.stringify(res.json))
    assert.equal(res.json.code, 'merge_conflict_retry')
    assert.deepEqual({ ...one(f, 'SELECT name, barcode FROM products WHERE id = 2') }, { name: 'Gloss Two', barcode: '8850000000022' }, 'the refused edit leaves the row as it was, not half renamed')
    assert.equal(strandedOnInactive(f), 0)
    assert.equal(shelf(f), 10)
    assert.equal(history(f, f.lateReceipt.actionHistoryId).status, 'undoable')
    const retry = await f.h.request('PUT', '/2', { name: 'Gloss One', barcode: '8850000000011' })
    assert.equal(retry.status, 200, JSON.stringify(retry.json))
    assert.equal(one(f, 'SELECT COALESCE(SUM(quantity), 0) AS n FROM branch_stock WHERE product_id = 1').n, 10)
    assert.equal(strandedOnInactive(f), 0)
    assert.equal(shelf(f), lots(f))
  })

  await check('the Resolve path keeps its own stricter answer (merge_state_conflict), untouched by the new guard', async () => {
    const f = fixture(TWINS)
    await f.receive(2, 4)
    const preview = await f.h.request('GET', '/possible-duplicates/merge-preview?keepId=1&mergeId=2&keep=1')
    const hook = interleave(f, async (discardedId) => { f.lateReceipt = await f.receive(discardedId, 6) })
    const res = await f.h.request('POST', '/possible-duplicates/merge', {
      keepId: 1, mergeId: 2, stock: 'merge', keep: true,
      resolve: { requestId: 'resolve-race-0001', reviewedDigest: preview.json.reviewedDigest, steps: [{ mergeId: 2, stock: 'merge' }] },
    })
    hook.restore()
    assert.equal(res.status, 409, JSON.stringify(res.json))
    assert.equal(res.json.code, 'merge_state_conflict')
    assert.equal(strandedOnInactive(f), 0)
    assert.equal(shelf(f), 10)
  })

  await check('DISCRIMINATING: a merge REDO that meets a late receipt is a 409 merge_conflict_retry from History (not a 500), strands nothing, and the retry succeeds', async () => {
    const f = fixture(TWINS)
    await f.receive(2, 4)
    assert.equal((await f.h.request('POST', '/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge' })).status, 200)
    const mergeHistoryId = one(f, "SELECT id FROM action_history WHERE undo_payload LIKE '%product.merge%' ORDER BY id DESC LIMIT 1").id
    const history = async (direction) => {
      const res = await f.h.load('routes/actionHistory.ts').default.request(`http://local/${mergeHistoryId}/${direction}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ require_applied: true }),
      }, { DB: f.h.raw }, { waitUntil() {}, passThroughOnException() {} })
      return { status: res.status, json: await res.json().catch(() => null) }
    }
    const undone = await history('undo')
    assert.equal(undone.status, 200, JSON.stringify(undone.json))
    const hook = interleave(f, async (discardedId) => { f.lateReceipt = await f.receive(discardedId, 6) })
    const refused = await history('redo')
    hook.restore()
    assert.ok(hook.state.fired)
    assert.equal(refused.status, 409, JSON.stringify(refused.json))
    assert.equal(refused.json.code, 'merge_conflict_retry')
    assert.equal(strandedOnInactive(f), 0)
    assert.equal(one(f, 'SELECT COUNT(*) AS n FROM products WHERE is_active = 1').n, 2, 'the products stay unmerged')
    const retried = await history('redo')
    assert.equal(retried.status, 200, JSON.stringify(retried.json))
    assert.equal(strandedOnInactive(f), 0)
    assert.equal(shelf(f), 10)
    assert.equal(shelf(f), lots(f))
  })

  await check('CONTROL: with nothing landing in between, the same merge commits (the guard is not a blanket refusal)', async () => {
    const f = fixture(TWINS)
    await f.receive(2, 4)
    const res = await f.h.request('POST', '/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge' })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.equal(shelf(f), 4)
    assert.equal(shelf(f), lots(f))
  })

  await check('CONTROL: a sale-side change to the discarded product between read and write is caught too (shelf moved, not only receipts)', async () => {
    const f = fixture(TWINS)
    await f.receive(2, 4)
    const hook = interleave(f, async (discardedId) => {
      f.h.raw.prepare('UPDATE branch_stock SET quantity = quantity - 1 WHERE product_id = ?').run([discardedId])
      f.h.raw.prepare("INSERT INTO inventory_movements(product_id, product_name, branch_id, movement_type, quantity, reason) VALUES(?, 'Gloss One', 1, 'sale', -1, 'synthetic sale')").run([discardedId])
    })
    const res = await f.h.request('POST', '/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge' })
    hook.restore()
    assert.equal(res.status, 409, JSON.stringify(res.json))
    assert.equal(res.json.code, 'merge_conflict_retry')
    assert.equal(one(f, 'SELECT is_active FROM products WHERE id = 2').is_active, 1)
  })

  // F6a. One fixture builder: a discarded product with `count` separate lots.
  async function lotsFixture(count) {
    const f = fixture(TWINS)
    // Written directly: one real stock-in session per lot would take minutes.
    f.h.raw.db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${count})
      INSERT INTO product_batches(variant_product_id, batch_key, batch_number, is_active, received_quantity)
      SELECT 2, 'lot-' || i, i, 1, 1 FROM n;
      INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) SELECT id, 1, 1 FROM product_batches WHERE variant_product_id = 2;
      INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES(2, 1, ${count});
      UPDATE products SET stock_quantity = ${count} WHERE id = 2;`)
    return f
  }
  const maxStatements = (f) => {
    const real = f.h.raw.batch.bind(f.h.raw)
    const seen = { max: 0 }
    f.h.raw.batch = async (items) => { seen.max = Math.max(seen.max, items.length); return real(items) }
    return { seen, restore: () => { f.h.raw.batch = real } }
  }
  for (const count of [77, 78, 120]) {
    await check(`DISCRIMINATING: a discarded product with ${count} lots merges cleanly (never a 500) and every unit arrives`, async () => {
      const f = await lotsFixture(count)
      const probe = maxStatements(f)
      const res = await f.h.request('POST', '/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge' })
      probe.restore()
      assert.ok(res.status === 200 || (res.status >= 400 && res.status < 500 && typeof res.json.code === 'string'), `clean outcome, got ${res.status} ${JSON.stringify(res.json)}`)
      if (res.status === 200) {
        assert.ok(probe.seen.max <= 100, `the write batch stays within the 100-statement bound (saw ${probe.seen.max})`)
        assert.equal(one(f, 'SELECT COUNT(*) AS n FROM product_batches WHERE variant_product_id = 1').n, count, 'every lot moved')
        assert.equal(one(f, 'SELECT COALESCE(SUM(quantity), 0) AS n FROM branch_stock WHERE product_id = 1').n, count)
        assert.equal(shelf(f), lots(f))
        assert.equal(strandedOnInactive(f), 0)

        const mergeHistory = f.h.raw.prepare("SELECT * FROM action_history WHERE undo_payload LIKE '%product.merge%' ORDER BY id DESC LIMIT 1").get()
        const payload = JSON.parse(mergeHistory.undo_payload)
        await f.h.load('lib/undoAppliers.ts').resolveUndoApplier(payload).run(payload, {
          env: { DB: f.h.raw }, user: ADMIN, direction: 'undo', historyId: mergeHistory.id, generation: payload.generation,
        })
        assert.equal(one(f, 'SELECT COUNT(*) AS n FROM product_batches WHERE variant_product_id = 2').n, count, 'undo gives every lot back')
        assert.equal(one(f, 'SELECT COUNT(DISTINCT batch_number) AS n FROM product_batches WHERE variant_product_id = 2').n, count, 'with its own number')
        assert.equal(shelf(f), lots(f))
      } else {
        assert.equal(one(f, 'SELECT is_active FROM products WHERE id = 2').is_active, 1, 'a refusal changes nothing')
      }
    })
  }

  await check('DISCRIMINATING: a case too large for one atomic batch (many lots that fold into the keeper\'s) is a coded 409 that changes nothing, not a 500', async () => {
    const f = fixture(TWINS)
    f.h.raw.db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 30)
      INSERT INTO product_batches(variant_product_id, batch_key, batch_number, is_active, received_quantity)
      SELECT 1, 'shared-' || i, i, 1, 1 FROM n UNION ALL SELECT 2, 'shared-' || i, i, 1, 1 FROM n;
      INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) SELECT id, 1, 1 FROM product_batches;
      INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES(1, 1, 30), (2, 1, 30);
      UPDATE products SET stock_quantity = 30;`)
    const before = digest(f)
    const res = await f.h.request('POST', '/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge' })
    assert.equal(res.status, 409, JSON.stringify(res.json))
    assert.equal(res.json.code, 'merge_case_exceeds_safe_limit')
    assert.equal(digest(f), before, 'a refusal changes nothing')
  })

  await check('the lot-repoint chunking keeps batch numbers unique and increasing on the survivor', async () => {
    const f = await lotsFixture(30)
    f.h.raw.prepare("INSERT INTO product_batches(variant_product_id, batch_key, batch_number, is_active) VALUES(1, 'keeper-own', 5, 1)").run([])
    const res = await f.h.request('POST', '/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge' })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    const numbers = f.h.raw.prepare('SELECT batch_number FROM product_batches WHERE variant_product_id = 1 ORDER BY batch_number').all([]).map((r) => Number(r.batch_number))
    assert.equal(new Set(numbers).size, numbers.length, 'no two lots share a number')
    assert.equal(numbers.length, 31)
    assert.equal(numbers[numbers.length - 1], 35, 'numbers continue after the keeper max (5) in lot order')
  })

  console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed')
  if (failed) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
