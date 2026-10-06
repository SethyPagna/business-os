// CUTOVER-LR: shifts and transfers addressed to a disabled branch (scripts/harness/cutover_lr_world.cjs).
//
//   POST /api/shifts/open at Old Shop: branch_redirect_required until the operator confirms; then the shift opens at
//     the confirmed branch (its audit row keeps the addressed branch). Before the cutover: byte-identical to eb5dd0ba3.
//   Close / cancel / reopen / amend of a shift row at Old Shop: the cutover is only admitted with no open shift
//     (lib/branchCutoverParent.ts), so no OPEN Old Shop shift can exist; every write on a closed one is refused by
//     resolveBranch (404, nothing written) -- a reopen or an amendment is never redirected to another drawer.
//   Transfers naming Old Shop: refused with a code by the canonical branch configuration, nothing written (a
//     transfer needs two active branches and cannot be redirected).
//
// Run (from cloudflare/): node scripts/test-cutover-lr-shifts-transfer-pure.cjs
const assert = require('node:assert/strict')
const W = require('./harness/cutover_lr_world.cjs')

const CASHIER = { id: 72, username: 'cashier', name: 'Cashier', role: 'staff', permissions: JSON.stringify({ pos: true, sales: true }) }
const fresh = W.makeWorld(null, { user: CASHIER })
const oracle = W.makeWorld(W.ORACLE, { user: CASHIER })
const owner = W.makeWorld(null)
const shifts = (world) => world.load('routes/shifts.ts').default

function shiftDb(state) {
  const db = W.build(state)
  db.prepare("INSERT INTO settings(key,value) VALUES('shift_admin_exempt','false') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
  return db
}
const openBody = (branchId) => ({ branch_id: branchId, opening_float_usd: 10, opening_float_khr: 0 })
const shiftRows = (db) => W.plain(db.prepare('SELECT branch_id, branch_name, closed_at IS NULL AS open FROM shift_sessions ORDER BY id').all())

async function main() {
  await W.check('before: opening a shift at Shop writes byte-identical statements to the eb5dd0ba3 oracle', async () => {
    const dbNew = shiftDb('before'); const dbOld = shiftDb('before')
    const capNew = []; const capOld = []
    const a = await W.call(shifts(fresh), dbNew, 'POST', '/open', openBody(2), { capture: capNew, redirect: 1 })
    const b = await W.call(shifts(oracle), dbOld, 'POST', '/open', openBody(2), { capture: capOld })
    assert.equal(a.status, 201, JSON.stringify(a.body))
    assert.equal(W.normalised(a), W.normalised(b))
    assert.equal(W.normalised(capNew).replace(/SH-[\w-]+/g, '<code>'), W.normalised(capOld).replace(/SH-[\w-]+/g, '<code>'))
    assert.deepEqual(shiftRows(dbNew), [{ branch_id: 2, branch_name: 'Shop', open: 1 }])
  })

  await W.check('after: opening a shift at Old Shop asks, refuses invalid targets, writes nothing; confirmed it opens at LC Store', async () => {
    const db = shiftDb('after')
    const before = W.ledger(db)
    const asked = await W.call(shifts(fresh), db, 'POST', '/open', openBody(2))
    assert.deepEqual([asked.status, asked.body.code], [409, 'branch_redirect_required'])
    assert.deepEqual(asked.body.redirect, W.REDIRECT(null))
    for (const target of [2, 99]) assert.equal((await W.call(shifts(fresh), db, 'POST', '/open', openBody(2), { redirect: target })).body.code, 'branch_redirect_target_invalid')
    assert.equal(W.ledger(db), before)
    const ok = await W.call(shifts(fresh), db, 'POST', '/open', openBody(2), { redirect: 1 })
    assert.equal(ok.status, 201, JSON.stringify(ok.body))
    assert.deepEqual(shiftRows(db), [{ branch_id: 1, branch_name: 'LC Store', open: 1 }])
    const details = JSON.parse(db.prepare("SELECT details FROM audit_logs WHERE action='shift.open'").get().details)
    assert.deepEqual([details.branch_id, details.addressed_branch_id, details.addressed_branch_name], [1, 2, 'Old Shop'])
    const again = await W.call(shifts(fresh), db, 'POST', '/open', openBody(2), { redirect: 1 })
    assert.equal(again.body.already_registered, true, 'the open shift at the confirmed branch is answered, not duplicated')
  })

  await W.check('after: race -- the target disabled before the open batch commits aborts it, nothing written', async () => {
    const db = shiftDb('after')
    db.prepare("INSERT INTO branches(id,name,role,is_default,is_active) VALUES(3,'Annex','shop',0,1)").run()
    const before = W.ledger(db)
    const res = await W.callWith(shifts(fresh), W.raceBinding(db, () => db.exec('UPDATE branches SET is_active=0 WHERE id=1')), 'POST', '/open', openBody(2), 1)
    db.exec('UPDATE branches SET is_active=1 WHERE id=1')
    assert.deepEqual([res.status, res.body.code], [409, 'branch_redirect_target_invalid'], JSON.stringify(res.body))
    assert.equal(W.ledger(db), before)
  })

  await W.check('after: reopen, amend, cancel and close of a closed Old Shop shift are refused and write nothing', async () => {
    const db = shiftDb('after')
    db.prepare(`INSERT INTO shift_sessions(id,shift_code,scope_mode,user_id,user_name,branch_id,branch_name,business_date,opened_at,closed_at,revision)
      VALUES(9,'SH-OLD','per_account',72,'Cashier',2,'Shop','2026-10-04','2026-10-04T01:00:00.000Z','2026-10-04T10:00:00.000Z',1)`).run()
    const before = W.ledger(db)
    const audits = db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n
    for (const [method, url, body] of [
      ['POST', '/9/reopen', { reason: 'counted wrong', expected_revision: 1 }],
      ['PATCH', '/9', { expected_revision: 1, closing_note: 'x', reason: 'fix' }],
      ['POST', '/9/cancel', { expected_revision: 1, reason: 'x' }],
      ['POST', '/9/close', { expected_revision: 1 }],
    ]) {
      const res = await W.call(shifts(fresh), db, method, url, body, { redirect: 1 })
      assert.ok(res.status >= 400, `${method} ${url} must refuse: ${JSON.stringify(res.body)}`)
    }
    assert.equal(W.ledger(db), before)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n, audits)
  })

  await W.check('transfers naming Old Shop are refused with a code and write nothing (no redirect for a transfer)', async () => {
    const db = W.build('after')
    // Units stranded at Old Shop (the 0109 residue shape) make the out-of-Old-Shop direction a real transfer attempt.
    db.exec('UPDATE branch_stock SET quantity=3 WHERE branch_id=2 AND product_id=10; UPDATE branch_batch_stock SET quantity=3 WHERE branch_id=2 AND batch_id=500')
    const before = W.ledger(db)
    const inventory = owner.load('routes/inventory.ts').default
    const branches = owner.load('routes/branches.ts').default
    const one = { transfer_provenance_version: 1, productId: 10, fromBranchId: 1, toBranchId: 2, quantity: 1, reason: 'move', client_request_id: 'transfer-cutover-lr-0001' }
    const answers = [
      await W.call(inventory, db, 'POST', '/transfer', one, { redirect: 1 }),
      await W.call(inventory, db, 'POST', '/transfer', { ...one, fromBranchId: 2, toBranchId: 1, client_request_id: 'transfer-cutover-lr-0002' }, { redirect: 1 }),
      await W.call(branches, db, 'POST', '/transfer', { ...one, client_request_id: 'transfer-cutover-lr-0003' }, { redirect: 1 }),
      await W.call(branches, db, 'POST', '/transfer-bulk', { transfer_provenance_version: 1, fromBranchId: 1, toBranchId: 2, reason: 'move', client_request_id: 'transfer-cutover-lr-0004', items: [{ productId: 10, quantity: 1 }] }, { redirect: 1 }),
    ]
    for (const answer of answers) {
      assert.deepEqual([answer.status, answer.body.code], [409, 'canonical_branch_configuration_invalid'], JSON.stringify(answer))
    }
    assert.equal(W.ledger(db), before)
  })

  W.done()
}

main().catch((error) => { console.error(error); process.exit(1) })
