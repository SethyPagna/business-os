'use strict'
// Side finding M (AL-MONEY-REPRO.md): the return-create postcondition counts
// only the movements its own batch wrote.
//
// inventory_movements.reference_id has no reference kind. Sale N's
// cancellation writes movement_type 'return' with reference_id N, so a
// postcondition that counts "movements with reference_id = this return" saw
// one row too many whenever the new return's id equalled such a sale's id,
// refused the batch, and -- because a refused insert does not consume the
// AUTOINCREMENT id -- refused every later customer return the same way.
//
// returnCreateOwnMovementCountSql counts rows above the MAX(id) read before
// the batch. This file runs that exact SQL against the real schema (every
// migration) and pins both halves of the contract:
//   - a pre-existing sale-keyed row on the same id and product is NOT counted
//     (the bug), whatever its reason text says;
//   - the postcondition keeps its strength: one row more or one row fewer
//     than the batch planned is still a mismatch.
// The native end-to-end proof is test-al-money-m-native.cjs.
//
// Run (from cloudflare/): node scripts/test-return-create-own-movements-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildSync } = require('esbuild')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src/lib/returnCreateAction.ts'), 'utf8')
const output = buildSync({ stdin: { contents: source, resolveDir: path.join(root, 'src/lib'), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' }).outputFiles[0].text
const moduleObj = { exports: {} }
new Function('exports', 'require', 'module', output)(moduleObj.exports, require, moduleObj)
const subject = moduleObj.exports

const TYPES = ['return', 'damage_in', 'replacement_out', 'write_off']
const results = []
function check(name, fn) {
  try { fn(); results.push(true); console.log(`PASS ${name}`) }
  catch (error) { results.push(false); console.log(`FAIL ${name}\n     ${String(error.message).split('\n').join('\n     ')}`) }
}

function world() {
  const db = new Database(':memory:')
  for (const sql of loadAll()) db.exec(sql)
  const move = (referenceId, type, productId = 7, reason = 'x') => db.prepare(`INSERT INTO inventory_movements
    (product_id,product_name,branch_id,movement_type,quantity,reason,reference_id) VALUES(?,?,1,?,1,?,?)`)
    .run(productId, `P${productId}`, type, reason, referenceId).lastInsertRowid
  const floor = () => db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM inventory_movements').get().id
  // The new return is id 3; returnCreateIdSql resolves it by client_request_id.
  db.prepare("INSERT INTO returns(id,client_request_id,return_scope,status) VALUES(3,'req-3','customer','completed')").run()
  const own = (movementIdFloor) => db.prepare(`SELECT ${subject.returnCreateOwnMovementCountSql(subject.returnCreateIdSql(), TYPES)} AS n`)
    .get({ movementIdFloor, returnClientRequestId: 'req-3' }).n
  return { db, move, floor, own }
}

check('a cancelled sale with the same id AND product, written before the batch, is not this return\'s movement', () => {
  const w = world()
  w.move(3, 'return', 7, 'Return: customer changed mind') // sale 3's cancellation restock, reason looks like a return's
  w.move(3, 'damage_in', 7)                              // sale-keyed damaged tag, same id
  const movementIdFloor = w.floor()
  w.move(3, 'return', 7, 'Return: wrong size')          // the batch's own restock
  assert.equal(w.own(movementIdFloor), 1)
  // The pre-fix predicate (reference_id alone) counts all three.
  assert.equal(w.db.prepare(`SELECT COUNT(*) n FROM inventory_movements WHERE reference_id=3 AND movement_type IN ('return','damage_in','replacement_out','write_off')`).get().n, 3,
    'fixture: the unscoped count is the M defect')
})
check('control: the batch writing one movement more than planned is still a mismatch', () => {
  const w = world()
  w.move(3, 'return')
  const movementIdFloor = w.floor()
  w.move(3, 'return'); w.move(3, 'return')
  assert.equal(w.own(movementIdFloor), 2, 'two own rows are counted as two, so expected 1 refuses')
})
check('control: a planned movement that was never written is still a mismatch', () => {
  const w = world()
  w.move(3, 'return')
  assert.equal(w.own(w.floor()), 0)
})
check('only the return-create movement types count; other rows keyed to the same id do not', () => {
  const w = world()
  const movementIdFloor = w.floor()
  w.move(3, 'sale'); w.move(3, 'add'); w.move(3, 'replacement_out'); w.move(3, 'write_off')
  assert.equal(w.own(movementIdFloor), 2)
})
check('a same-id row committed between the floor read and the batch is counted (fails closed, retryable)', () => {
  const w = world()
  const movementIdFloor = w.floor()
  w.move(3, 'return', 7, 'Sale cancelled') // a racing cancellation of sale 3
  w.move(3, 'return', 7, 'Return: x')      // the batch's own row
  assert.equal(w.own(movementIdFloor), 2, 'the postcondition sees 2 for an expected 1 and refuses; nothing is written')
})
check('the empty ledger floor is 0', () => {
  const w = world()
  assert.equal(w.floor(), 0)
  w.move(3, 'return')
  assert.equal(w.own(0), 1)
})

const failed = results.filter(ok => !ok).length
console.log(`${failed ? 'RED' : 'GREEN'} return-create postcondition counts only its own movements: ${results.length - failed}/${results.length}`)
if (failed) process.exitCode = 1
