'use strict'
// H1 (deploy 4 compose review): undoing a Conflicts GROUP merge in which two or more duplicates fold into ONE kept lot (same received date)
// stopped half-way once more than a second passed between the requests. The kept lot's updated_at is part of the full-lot fingerprint (it is how
// later activity is detected), and the undo of the later member wrote the kept lot back with updated_at = CURRENT_TIMESTAMP, so the earlier
// member's fingerprint no longer matched: step 1 committed, step 2 was refused (undo_record_changed), and Redo was refused too.
// Rule: undo writes the kept lot back to its EXACT before-image, updated_at included; a snapshot written before that field existed still undoes.
// Real routes and real undo applier; a wall-clock gap of more than a second (CURRENT_TIMESTAMP resolution) before every request.
const assert = require('node:assert/strict')
const w = require('./harness/merge-group-world.cjs')

const GAP = 1150
const SAME = ['2026-09-05', '2026-09-05', '2026-09-05']
const DISTINCT = ['2026-09-01', '2026-09-02', '2026-09-03']

async function world(label, dates, { members = 3 } = {}) {
  const spec = [{ qty: 1, cost: 1, date: dates[0] }, { qty: 2, cost: 2, date: dates[1] }, { qty: 3, cost: 3, date: dates[2] }].slice(0, members)
  const { d1, ids } = w.seedWorld({ lots: spec })
  const f = { d1, ...w.loadRoute(d1, true) }
  return { label, d1, f, ids }
}
const complete = (steps) => steps.length > 0 && steps.every((s) => s.ok) && steps.at(-1).complete === true
const show = (steps) => JSON.stringify(steps.map((s) => s.ok ? s.complete : `${s.code}: ${s.message}`))
const merged = (d1) => w.rows(d1.db, "SELECT status FROM product_conflict_action_group_members WHERE role='merged' ORDER BY product_id").map((r) => r.status)

async function cycle(label, dates, opts) {
  const { d1, f, ids } = await world(label, dates, opts)
  const before = w.businessState(d1.db)
  const keptBefore = w.lotStamp(d1.db, 99001)
  await w.sleep(GAP)
  await w.applyGroup(d1, f, ids, label)
  const afterMerge = w.businessState(d1.db)
  assert.notEqual(afterMerge, before, `${label}: the merge changed the world`)

  const undo1 = await w.groupAll(f, d1, 'undo', GAP)
  assert.ok(complete(undo1), `${label}: undo completes, every request ok ${show(undo1)}; members ${merged(d1)}`)
  assert.equal(w.businessState(d1.db), before, `${label}: undo gives stock, lots, costs, is_active, merge marker and catalog costs back exactly`)
  assert.equal(w.lotStamp(d1.db, 99001), keptBefore, `${label}: the kept lot's own updated_at is back to its before-image`)

  const redo = await w.groupAll(f, d1, 'redo', GAP)
  assert.ok(complete(redo), `${label}: redo completes ${show(redo)}; members ${merged(d1)}`)
  assert.equal(w.businessState(d1.db), afterMerge, `${label}: redo reproduces the merged state`)

  const undo2 = await w.groupAll(f, d1, 'undo', GAP)
  assert.ok(complete(undo2), `${label}: the undo after a redo completes ${show(undo2)}; members ${merged(d1)}`)
  assert.equal(w.businessState(d1.db), before, `${label}: and gives everything back exactly again`)
  assert.equal(w.lotStamp(d1.db, 99001), keptBefore, `${label}: the kept lot's updated_at again`)
  return { d1, f }
}

async function main() {
  // The reviewer's repro: keeper 1 @ $1, A 2 @ $2, B 3 @ $3, one received date, so A and B both fold into the keeper's lot.
  await cycle('3 members, one received date', SAME)
  // Control: distinct dates (every duplicate lot is created on the keeper; the kept lot is written by no fold).
  await cycle('control: 3 members, distinct dates', DISTINCT)
  // Mixed: A on the keeper's date, B on another date.
  await cycle('3 members, A same date, B other date', ['2026-09-05', '2026-09-05', '2026-09-06'])

  // A receipt written before keeperLotBefore carried updated_at (a two-member group, one fold): the undo still completes, restores cost, expiry and
  // activity, and does not write NULL into the stamp (nothing in the old before-image says when the lot was written, so it is stamped now, as before).
  {
    const { d1, f, ids } = await world('legacy before-image', SAME, { members: 2 })
    await w.applyGroup(d1, f, ids, 'legacy before-image')
    let stripped = 0
    for (const snap of w.rows(d1.db, "SELECT id, payload_json FROM undo_snapshots WHERE payload_json LIKE '%keeperLotBefore%'")) {
      const payload = JSON.parse(snap.payload_json)
      for (const fold of payload.foldedBatches || []) if (fold.keeperLotBefore && Object.hasOwn(fold.keeperLotBefore, 'updated_at')) { delete fold.keeperLotBefore.updated_at; stripped += 1 }
      d1.db.prepare('UPDATE undo_snapshots SET payload_json=? WHERE id=?').run(JSON.stringify(payload), snap.id)
    }
    assert.ok(stripped >= 1, `the world holds ${stripped} kept-lot before-image(s) with a stamp to strip`)
    const before = w.businessState(d1.db)
    const steps = await w.groupAll(f, d1, 'undo', 0)
    assert.ok(complete(steps), `legacy: undo completes ${show(steps)}`)
    const lot = w.rows(d1.db, 'SELECT unit_cost_usd, expiry_date, is_active, updated_at FROM product_batches WHERE id=99001')[0]
    assert.equal(lot.unit_cost_usd, 1, 'legacy: the kept lot cost is back')
    assert.equal(lot.expiry_date, '2027-01-01', 'legacy: the kept lot expiry is back')
    assert.equal(lot.is_active, 1)
    assert.ok(lot.updated_at != null, 'legacy: the stamp is not NULLed by an old before-image')
    assert.notEqual(w.businessState(d1.db), before, 'legacy: the undo did change the world')
  }

  // Later activity on the kept lot is STILL detected (the fingerprint was not weakened): an edit after the merge refuses the undo, coded, nothing written.
  {
    const { d1, f, ids } = await world('later activity', SAME)
    await w.applyGroup(d1, f, ids, 'later activity')
    w.seedStockFixture(d1.db, () => d1.db.exec("UPDATE product_batches SET notes='edited later', updated_at=datetime('now','+1 hour') WHERE id=99001"))
    const dump = w.businessState(d1.db)
    const steps = await w.groupAll(f, d1, 'undo', 0)
    assert.equal(steps[0].ok, false, 'a later edit of the kept lot refuses the undo')
    assert.equal(steps[0].code, 'undo_record_changed')
    assert.equal(steps[0].status, 409)
    assert.equal(w.businessState(d1.db), dump, 'a refused undo writes nothing')
  }
  console.log('product group undo, same kept lot, clock advancing between requests: all worlds undo, redo and undo again exactly')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
