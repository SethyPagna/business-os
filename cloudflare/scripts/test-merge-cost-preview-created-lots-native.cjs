'use strict'
// M1 (deploy 4 compose review), Resolve path: the cost preview of a merge whose duplicate holds TWO or more lots on a received date the keeper lacks.
// The fold creates ONE lot on the keeper for that date (the first of the duplicate's lots) and folds the others into it, writing the quantity-weighted cost
// to it. The preview used to apply that cost only to a lot already on the keeper, so it skipped the lot the fold writes (a duplicate's lot) and showed an
// unfolded cost. Same function serves the merge-preview and the Resolve cost-preview routes; both must show what the merge stores.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const file = path.join(__dirname, 'test-product-resolve-keep-merge-native.cjs')
const source = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n')
const boundary = source.indexOf('\nasync function main() {')
const runner = new Module(file, module); runner.filename = file; runner.paths = module.paths
runner._compile(source.slice(0, boundary) + '\nmodule.exports={fresh,one,rows,state,request,merge,preview,fixtureWrite}', file)
const { fresh, one, rows, state, request, merge, preview, fixtureWrite } = runner.exports

const round4 = (value) => Math.round((value + Number.EPSILON) * 1e4) / 1e4
let count = 0
async function check(name, fn) { fresh(); try { await fn(); count += 1; console.log('PASS ' + name) } finally { state.native.db.close() } }

let lotId = 900
// Keeper 20 holds lot 900 on 2026-09-01 (3 @ 4); the duplicate 21 holds `dupLots`.
function seedLots(dupLots) {
  fixtureWrite(() => state.native.db.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd,received_at) VALUES(900,20,'keeper',1,4,'2026-09-01')"))
  fixtureWrite(() => state.native.db.exec('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(900,1,3);INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(20,1,3);UPDATE products SET stock_quantity=3 WHERE id=20'))
  let total = 0
  for (const lot of dupLots) {
    lotId += 1
    total += lot.qty
    fixtureWrite(() => state.native.db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd,received_at) VALUES(?,21,?,1,?,?)').run(lotId, 'dup-' + lotId, lot.cost, lot.date))
    fixtureWrite(() => state.native.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,?)').run(lotId, lot.qty))
  }
  fixtureWrite(() => state.native.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(21,1,?)').run(total))
  fixtureWrite(() => state.native.db.prepare('UPDATE products SET stock_quantity=? WHERE id=21').run(total))
}

async function shape(label, dupLots) {
  await check(label, async () => {
    lotId = 900
    seedLots(dupLots)
    const before = rows('SELECT * FROM products ORDER BY id')
    const seen = await preview(20, 21, '&groupIds=20,21')
    assert.equal(seen.status, 200, JSON.stringify(seen.body))
    const quoted = await request('POST', '/api/products/resolve/cost-preview', { keepId: 20, reviewedDigest: seen.body.reviewedDigest, steps: [{ mergeId: 21, stock: 'merge' }] })
    assert.equal(quoted.status, 200, JSON.stringify(quoted.body))
    assert.deepEqual(rows('SELECT * FROM products ORDER BY id'), before, 'a preview writes nothing')
    const shownResolve = quoted.body.costAuthority.cost_price_usd
    const done = await merge({ keepId: 20, mergeId: 21, keep: true, stock: 'merge' })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    const stored = one('SELECT cost_price_usd c FROM products WHERE id=20').c
    const lots = rows(`SELECT pb.id, pb.variant_product_id v, pb.is_active a, pb.unit_cost_usd c, pb.received_at d,
      COALESCE((SELECT SUM(quantity) FROM branch_batch_stock WHERE batch_id = pb.id), 0) q FROM product_batches pb ORDER BY pb.id`)
    const active = lots.filter((lot) => lot.a === 1 && lot.q > 0)
    const weighted = round4(active.reduce((sum, lot) => sum + lot.c * lot.q, 0) / active.reduce((sum, lot) => sum + lot.q, 0))
    assert.equal(quoted.body.costAuthority.source, 'received_lot')
    assert.equal(shownResolve, stored, `the Resolve cost preview (${shownResolve}) is the stored keeper cost (${stored})`)
    if (seen.body.costAuthority) assert.equal(seen.body.costAuthority.cost_price_usd, stored, 'the merge-preview shows the stored keeper cost too')
    assert.equal(stored, weighted, `and the weighted mean of the stored active lots (${weighted})`)
    return lots
  })
}
async function stored(label, dupLots, expectations) {
  await check(label + ' (stored lots)', async () => {
    lotId = 900
    seedLots(dupLots)
    const done = await merge({ keepId: 20, mergeId: 21, keep: true, stock: 'merge' })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    for (const [id, cost, qty, owner] of expectations) {
      const lot = one('SELECT variant_product_id v, unit_cost_usd c, (SELECT SUM(quantity) FROM branch_batch_stock WHERE batch_id = product_batches.id) q FROM product_batches WHERE id = ?', id)
      assert.deepEqual([lot.c, lot.q, lot.v], [cost, qty, owner], `lot ${id}`)
    }
  })
}

async function main() {
  const D = '2026-09-02'
  // The reviewer's shape: two duplicate lots on a date the keeper lacks, 2 @ 4 and 4 @ 4.75: one created lot carries (2*4 + 4*4.75)/6 = 4.5.
  await shape('two duplicate lots on a date the keeper lacks', [{ date: D, qty: 2, cost: 4 }, { date: D, qty: 4, cost: 4.75 }])
  await stored('two duplicate lots on a date the keeper lacks', [{ date: D, qty: 2, cost: 4 }, { date: D, qty: 4, cost: 4.75 }], [[901, 4.5, 6, 20], [902, 4.75, null, 21], [900, 4, 3, 20]])
  await shape('three duplicate lots on a date the keeper lacks', [{ date: D, qty: 2, cost: 4 }, { date: D, qty: 4, cost: 4.75 }, { date: D, qty: 1, cost: 9 }])
  await shape('mixed dates: two on a new date, one on the keeper date, one on another new date',
    [{ date: D, qty: 2, cost: 4 }, { date: D, qty: 4, cost: 4.75 }, { date: '2026-09-01', qty: 1, cost: 10 }, { date: '2026-09-03', qty: 2, cost: 6 }])
  await shape('control: one duplicate lot on a new date', [{ date: D, qty: 2, cost: 8 }])
  await shape('control: two duplicate lots on the keeper date', [{ date: '2026-09-01', qty: 2, cost: 8 }, { date: '2026-09-01', qty: 4, cost: 5 }])
  console.log(`merge cost preview, created lots (Resolve path): ${count} checks passed`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
