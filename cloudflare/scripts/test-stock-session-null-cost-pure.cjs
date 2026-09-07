// One meaning of NULL on every writer of inventory_movements.
//
// A NULL unit cost means "nobody recorded what this cost". Zero means "this
// was free". routes/inventory.ts and lib/importEngine.ts both write a missing
// cost straight through as NULL, and since the stock-in sessions list started
// reading `total_cost_usd IS NOT NULL` as "recorded" (lib/stockInSessionsQuery
// .ts), a writer that COALESCEs a missing member cost to 0 reports an unpriced
// line as a $0.00 free-goods receipt nobody declared.
//
// lib/stockSession.ts's two movement writers -- the commit path and the
// undo/redo replay -- were the last two that did. This runs their SQL, as it
// ships in the source, against real SQLite with a member row whose cost was
// never recorded, and with a second whose cost is a declared 0. The two must
// come out different.
//
// Why the SQL is extracted rather than driven through commitStockSession():
// the N14-D receipt gate in parseRequest refuses a positive-quantity line with
// no cost ('cost_required'), and the replay path's snapshot guard rejects a
// members row edited behind its back -- both asserted in
// test-stock-session-atomic.cjs. Rows written BEFORE that gate landed still
// hold NULL in production and still replay through the second writer, so the
// SQL must be right even though today's API cannot mint a new one.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')

const root = path.join(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src', 'lib', 'stockSession.ts'), 'utf8').replace(/\r\n/g, '\n')

/** Every `INSERT INTO inventory_movements ... SELECT ...` template the module ships. */
function movementWriters() {
  const writers = []
  const marker = 'INSERT INTO inventory_movements('
  let at = source.indexOf(marker)
  while (at !== -1) {
    const end = source.indexOf('`', at)
    writers.push(source.slice(at, end).trim())
    at = source.indexOf(marker, end)
  }
  return writers
}

function fixture() {
  const sql = new Database(':memory:')
  sql.pragma('foreign_keys = OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter(n => n.endsWith('.sql')).sort()) {
    sql.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  }
  sql.exec(`
    INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1);
    INSERT INTO products(id,name,barcode,cost_price_usd,stock_quantity,is_active) VALUES(1,'Serum','SER-1',2,0,1);
    INSERT INTO stock_session_operations(id,actor_id,request_id,mode,request_json,generation)
      VALUES('op-1',7,'req-1','stock_in','{}',0);
    INSERT INTO stock_session_members(operation_id,line_id,command_kind,product_id,product_created,branch_id,quantity,unit_cost_usd)
      VALUES('op-1','never-recorded','receive',1,0,1,3,NULL),
             ('op-1','declared-free','receive',1,0,1,2,0);
  `)
  return sql
}

/** better-sqlite3 speaks @name too, so only the runtime's own params need supplying. */
function run(sql, template, params) {
  sql.prepare(template).run(params)
}

let failed = 0
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const writers = movementWriters()

check('lib/stockSession.ts still has exactly its two movement writers', () => {
  assert.equal(writers.length, 2, `found ${writers.length} INSERT INTO inventory_movements templates`)
})

check('the commit writer keeps an unrecorded cost unrecorded and a declared zero at zero', () => {
  const sql = fixture()
  run(sql, writers[0], { reason: 'Stock-in session op-1', actor: 7, actorName: 'Stock User', operationId: 'op-1', lineId: 'never-recorded' })
  run(sql, writers[0], { reason: 'Stock-in session op-1', actor: 7, actorName: 'Stock User', operationId: 'op-1', lineId: 'declared-free' })
  assert.deepEqual(sql.prepare('SELECT unit_cost_usd,total_cost_usd FROM inventory_movements ORDER BY id').all(), [
    { unit_cost_usd: null, total_cost_usd: null },
    { unit_cost_usd: 0, total_cost_usd: 0 },
  ])
})

check('the undo/redo writer keeps the same distinction, in both directions', () => {
  for (const [direction, movement, sign] of [['undo', 'remove', -1], ['redo', 'add', 1]]) {
    const sql = fixture()
    run(sql, writers[1], { id: 'op-1', movement, sign, reason: `Stock session op-1 ${direction} generation 1`, actor: 7, name: 'Stock User' })
    // Both members land in one statement, so order by the quantity that names them.
    assert.deepEqual(sql.prepare('SELECT movement_type,quantity,unit_cost_usd,total_cost_usd FROM inventory_movements ORDER BY abs(quantity) DESC').all(), [
      { movement_type: movement, quantity: 3 * sign, unit_cost_usd: null, total_cost_usd: null },
      { movement_type: movement, quantity: 2 * sign, unit_cost_usd: 0, total_cost_usd: 0 },
    ], direction)
  }
})

check('neither writer COALESCEs a missing member cost into a recorded number', () => {
  for (const template of writers) {
    assert.doesNotMatch(template, /COALESCE\(m\.unit_cost_usd,\s*0\)/, template)
  }
})

if (failed > 0) {
  console.error(`${failed} stock-session NULL-cost regression(s) failed`)
  process.exitCode = 1
}
