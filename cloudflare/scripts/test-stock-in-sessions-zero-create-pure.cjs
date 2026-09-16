// N29 (2026-09-06): "i see that the create products did not show in stock in".
//
// The Stock-in Sessions list was built from inventory_movements alone. The
// Products page's Add-products session (POST /api/inventory/sessions,
// lib/stockSession.ts) records a stock_session_operations row and one
// stock_session_members row per line from the header step onward, but a line
// created at quantity 0 posts NO movement (there is no receipt to post), so a
// session whose items were all created at zero had a session record and no
// movement -- and a list that only knew movements could not see it.
//
// The fix teaches the list (and the receipt it opens) the second half of the
// same session model: zero-quantity member rows are lines too. This test
// drives the real query kernel against an in-memory D1 shim built from every
// migration file (0128 included) and pins the three outcomes that must hold:
//   (a) a zero-quantity create session is listed and opens to its lines;
//   (b) a create session with quantities is listed ONCE, with its zero line
//       inside the same receipt, never as a second row;
//   (c) fast stock-in sessions (per-line POST /batches or /adjust carrying a
//       sessionId, no operations row) are unchanged.
//
// RECORD CORRECTION (2026-09-06). Commit ea29b009 on the a2 integration
// branch removed this UNION from lib/stockInSessionsQuery.ts and its message
// says it did so to 'preserve the indexed session query'. That reason is not
// true: the query a7ff72f7 had just cherry-picked was already indexed -- the
// list's own test asserts the revert lookup keeps the reference_id index
// (test-stock-in-sessions-pure.cjs: doesNotMatch /CAST\(rx\.reference_id AS
// TEXT\)/), and that assertion was green on both sides of ea29b009. What
// ea29b009 actually reverted was a smuggled copy of this lane's commit
// 2bf8dd10, i.e. the zero-quantity session-line feature itself.
//
// Reverting it was the right call, for a reason the message does not give:
// the feature had arrived without its tests. It belongs to this lane and
// arrives with them -- this file and frontend/tests/stockInSessionZeroLines
// .test.ts. A reconciler reading the commit message alone would reject the
// UNION a second time for a performance concern that does not exist.
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-in-sessions-zero-'))
fs.copyFileSync(path.join(root, 'src', 'lib', 'stockInSessionsQuery.ts'), path.join(tmp, 'stockInSessionsQuery.ts'))
fs.copyFileSync(path.join(root, 'src', 'lib', 'movementActorName.ts'), path.join(tmp, 'movementActorName.ts'))
const version = execSync('npx tsc --version', { cwd: root, encoding: 'utf8' }).trim()
const ignore = /^Version\s+(?:[6-9]|\d{2,})\./.test(version) ? ' --ignoreConfig' : ''
execSync(`npx tsc "${path.join(tmp, 'stockInSessionsQuery.ts')}" --outDir "${tmp}" --module commonjs --target es2022 --strict --skipLibCheck${ignore}`, { cwd: root })
const kernel = require(path.join(tmp, 'stockInSessionsQuery.js'))
const migrations = loadAll()
assert.ok(migrations.some((sql) => /0128|idx_stock_session_members_movement/.test(sql)), 'the schema under test must include prepared migration 0128')
const db = openDb(migrations)

db.exec(`
  INSERT INTO branches (id,name,is_active) VALUES (1,'Shop',1), (2,'Warehouse',1);
  INSERT INTO users (id,username,name,password) VALUES (7,'za','Za Sokha','x'), (8,'dara','Dara','x');
  INSERT INTO suppliers (id,name) VALUES (1,'Bong Long'), (2,'Sok Trading');
  INSERT INTO products (id,name,barcode,unit,brand,category,image_path,selling_price_usd,purchase_price_usd,is_active) VALUES
    (1,'Lip Oil A','1001','pcs','Colourpop','Lip','/uploads/lip-a.webp',14,9,1),
    (2,'Lip Oil B','1002','pcs','Colourpop','Lip','/uploads/lip-b.webp',13,8,1),
    (3,'Hydrating Serum With A Deliberately Long Product Name 30ml','3003','pcs','Glow','Skin',NULL,25,12,1),
    (4,'Night Cream','4004','pcs','Glow','Skin',NULL,30,15,1),
    (5,'Toner','5005','pcs','Glow','Skin',NULL,10,4,1);
`)

// ---------------------------------------------------------------------------
// (a) a create-products session whose two items were both created at zero.
//     No batch, no movement -- only the operation and its member rows.
// ---------------------------------------------------------------------------
const zeroRequest = JSON.stringify({
  client_request_id: 'stockin_zero', mode: 'stock_in', items: [
    { line_id: 'create_1', kind: 'create_receive', product_id: null, product: { name: 'Hydrating Serum With A Deliberately Long Product Name 30ml' }, batch_id: null, branch_id: 2, quantity: 0, supplier_id: 2, supplier_name: 'Sok Trading', received_date: '2026-09-05', expiry_date: null, notes: null, unit_cost_usd: 12, free_goods: false, payment_status: null, credit_due_date: null },
    { line_id: 'create_2', kind: 'create_receive', product_id: null, product: { name: 'Night Cream' }, batch_id: null, branch_id: 2, quantity: 0, supplier_id: 2, supplier_name: 'Sok Trading', received_date: '2026-09-05', expiry_date: null, notes: null, unit_cost_usd: 15, free_goods: false, payment_status: null, credit_due_date: null },
  ],
})
db.prepare(`INSERT INTO stock_session_operations (id,actor_id,request_id,mode,request_json,created_at) VALUES ('op-zero',8,'stockin_zero','stock_in',@json,'2026-09-05 08:30:00')`).run({ json: zeroRequest })
db.exec(`
  INSERT INTO stock_session_members (operation_id,line_id,command_kind,product_id,product_created,branch_id,batch_id,movement_id,quantity,unit_cost_usd) VALUES
    ('op-zero','create_1','create_receive',3,1,2,NULL,NULL,0,12),
    ('op-zero','create_2','create_receive',4,1,2,NULL,NULL,0,15);
`)
const zeroRowid = db.prepare(`SELECT rowid AS rowid FROM stock_session_operations WHERE id='op-zero'`).get().rowid

// ---------------------------------------------------------------------------
// (b) a create-products session with ONE received line and ONE zero line.
// ---------------------------------------------------------------------------
db.exec(`
  INSERT INTO product_batches (id,variant_product_id,batch_key,lot_code,received_at,is_active,supplier_id,supplier_name,payment_status,unit_cost_usd,received_cost_usd,updated_at) VALUES
    (10,1,'09042026','09042026','2026-09-04',1,1,'Bong Long','paid',9,45,'2026-09-04 09:00:00');
`)
const mixedRequest = JSON.stringify({
  client_request_id: 'stockin_mixed', mode: 'stock_in', items: [
    { line_id: 'create_5', kind: 'create_receive', product_id: null, product: { name: 'Toner' }, batch_id: null, branch_id: 1, quantity: 0, supplier_id: 1, supplier_name: 'Bong Long', received_date: '2026-09-04', expiry_date: null, notes: null, unit_cost_usd: 4, free_goods: false, payment_status: null, credit_due_date: null },
    { line_id: 'receive_1', kind: 'receive', product_id: 1, product: null, batch_id: null, branch_id: 1, quantity: 5, supplier_id: 1, supplier_name: 'Bong Long', received_date: '2026-09-04', expiry_date: null, notes: null, unit_cost_usd: 9, free_goods: false, payment_status: 'paid', credit_due_date: null },
  ],
})
db.prepare(`INSERT INTO stock_session_operations (id,actor_id,request_id,mode,request_json,created_at) VALUES ('op-mixed',7,'stockin_mixed','stock_in',@json,'2026-09-04 09:00:00')`).run({ json: mixedRequest })
const mixedRowid = db.prepare(`SELECT rowid AS rowid FROM stock_session_operations WHERE id='op-mixed'`).get().rowid
db.prepare(`INSERT INTO inventory_movements (id,product_id,product_name,branch_id,branch_name,movement_type,quantity,unit_cost_usd,total_cost_usd,reference_id,user_id,user_name,created_at,batch_id) VALUES
  (100,1,'Lip Oil A',1,'Shop','add',5,9,45,@ref,7,'Za','2026-09-04 09:00:01',10)`).run({ ref: mixedRowid })
db.exec(`
  INSERT INTO stock_session_members (operation_id,line_id,command_kind,product_id,product_created,branch_id,batch_id,movement_id,quantity,unit_cost_usd) VALUES
    ('op-mixed','create_5','create_receive',5,1,1,NULL,NULL,0,4),
    ('op-mixed','receive_1','receive',1,0,1,10,100,5,9);
`)

// ---------------------------------------------------------------------------
// (c) a fast stock-in session: two POST /batches receipts sharing a
//     sessionId (Date.now()) as reference_id; no operations row at all.
// ---------------------------------------------------------------------------
db.exec(`
  INSERT INTO product_batches (id,variant_product_id,batch_key,lot_code,received_at,is_active,supplier_id,supplier_name,payment_status,credit_due_date,unit_cost_usd,received_cost_usd,updated_at) VALUES
    (11,1,'09032026','09032026','2026-09-03',1,1,'Bong Long','credit','2026-09-20',9,27,'2026-09-03 10:00:00'),
    (12,2,'09032026','09032026','2026-09-03',1,1,'Bong Long','credit','2026-09-20',8,16,'2026-09-03 10:00:00');
  INSERT INTO inventory_movements (id,product_id,product_name,branch_id,branch_name,movement_type,quantity,unit_cost_usd,total_cost_usd,reference_id,user_id,user_name,created_at,batch_id) VALUES
    (200,1,'Lip Oil A',1,'Shop','add',3,9,27,1757000000000,7,'Za','2026-09-03 10:00:00',11),
    (201,2,'Lip Oil B',1,'Shop','add',2,8,16,1757000000000,7,'Za','2026-09-03 10:00:01',12);
`)

const list = kernel.buildStockInSessionListQuery('')
const groups = db.prepare(`${list.groupedSql} ORDER BY created_at DESC`).bind(list.params).all()
const keys = groups.map((row) => row.session_key)

// (a) listed, with the header the operator entered once.
const zero = groups.find((row) => row.session_key === `session:${zeroRowid}`)
assert.ok(zero, `a create-products session whose items were all created at zero must be listed; got ${JSON.stringify(keys)}`)
assert.equal(zero.line_count, 2, 'item count is the number of products the session created')
assert.equal(Number(zero.quantity), 0, '0 units')
assert.equal(Number(zero.movement_cost_usd), 0, '$0 cost')
assert.equal(Number(zero.lines_without_movement_cost), 0, 'a zero-quantity line has no cost to be missing -- it must not raise the "no receipt-level cost" warning')
assert.equal(zero.branch_id, 2)
assert.equal(zero.branch_name, 'Warehouse')
assert.equal(zero.user_name, 'dara', 'the actor is the account username resolved from the operation')
assert.equal(zero.supplier_name, 'Sok Trading', 'the supplier entered on the header step is shown')
assert.equal(zero.supplier_id, 2)
assert.equal(zero.received_at, '2026-09-05')
assert.equal(zero.created_at, '2026-09-05 08:30:00', 'the session is grouped by the business day it was recorded on')
assert.equal(Number(zero.supplier_state_count), 1)
assert.equal(Number(zero.branch_state_count), 1)
assert.equal(Number(zero.user_state_count), 1)
assert.equal(Number(zero.payment_state_count), 0, 'no lot means no payment state, not a "Not recorded" state that would read as mixed beside a paid line')

// (a) opens to its lines with quantity 0 and the New marker.
const zeroLocator = kernel.parseStockInSessionKey(`session:${zeroRowid}`)
const zeroLines = db.prepare(kernel.stockInSessionLinesSql(zeroLocator)).bind(kernel.stockInSessionLineParams(zeroLocator)).all()
assert.equal(zeroLines.length, 2, 'opening the session shows both created products')
for (const line of zeroLines) {
  assert.equal(Number(line.quantity), 0)
  assert.equal(line.id, null, 'a zero line has no movement id -- nothing to revert')
  assert.equal(line.created_product, 1, 'the line created its product')
  assert.equal(line.session_command_kind, 'create_receive')
  assert.equal(line.batch_id, null)
  assert.equal(line.branch_name, 'Warehouse')
  assert.equal(line.user_name, 'dara')
}
assert.equal(zeroLines[0].product_name, 'Hydrating Serum With A Deliberately Long Product Name 30ml', 'the FULL product name travels with the line')
assert.equal(zeroLines[0].barcode, '3003')
assert.equal(zeroLines[0].session_line_id, 'create_1')
assert.equal(zeroLines[0].batch_supplier_name, 'Sok Trading', 'the supplier the header named is on the line too')

// (b) listed once; the zero line is inside the same receipt.
const mixedRows = groups.filter((row) => row.session_key === `session:${mixedRowid}`)
assert.equal(mixedRows.length, 1, 'a create session with quantities appears exactly once')
const mixed = mixedRows[0]
assert.equal(mixed.line_count, 2, 'the zero-quantity create is a line of the same session')
assert.equal(Number(mixed.quantity), 5)
assert.equal(Number(mixed.movement_cost_usd), 45)
assert.equal(Number(mixed.lines_without_movement_cost), 0)
assert.equal(Number(mixed.supplier_state_count), 1, 'header supplier == lot supplier: one state, not "Multiple suppliers"')
assert.equal(Number(mixed.branch_state_count), 1)
assert.equal(Number(mixed.user_state_count), 1, 'movement snapshot and operation actor are the same account: one state')
assert.equal(Number(mixed.payment_state_count), 1)
assert.equal(mixed.payment_status, 'paid')
assert.equal(mixed.supplier_name, 'Bong Long')
assert.equal(mixed.created_at, '2026-09-04 09:00:00')
const mixedLocator = kernel.parseStockInSessionKey(`session:${mixedRowid}`)
const mixedLines = db.prepare(kernel.stockInSessionLinesSql(mixedLocator)).bind(kernel.stockInSessionLineParams(mixedLocator)).all()
assert.equal(mixedLines.length, 2)
const receivedLine = mixedLines.find((row) => row.id === 100)
const zeroLine = mixedLines.find((row) => row.id === null)
assert.ok(receivedLine && zeroLine, 'the receipt holds the received line and the zero line together')
assert.equal(Number(receivedLine.quantity), 5)
assert.equal(receivedLine.created_product, 0)
assert.equal(receivedLine.batch_lot_code, '09042026')
assert.equal(Number(zeroLine.quantity), 0)
assert.equal(zeroLine.product_name, 'Toner')
assert.equal(zeroLine.created_product, 1)
// Line order is by time then id; the zero line carries the operation's stamp,
// so a receipt reads in the order the session was recorded.
assert.deepEqual(mixedLines.map((row) => row.session_line_id), ['create_5', 'receive_1'])

// (c) the fast stock-in session is unchanged: one row, two lines, no member
//     rows and therefore no New/Existing marker.
const fast = groups.filter((row) => row.session_key === 'session:1757000000000')
assert.equal(fast.length, 1)
assert.equal(fast[0].line_count, 2)
assert.equal(Number(fast[0].quantity), 5)
assert.equal(Number(fast[0].movement_cost_usd), 43)
assert.equal(fast[0].payment_status, 'credit')
assert.equal(fast[0].credit_due_date, '2026-09-20')
assert.equal(fast[0].user_name, 'za')
const fastLocator = kernel.parseStockInSessionKey('session:1757000000000')
const fastLines = db.prepare(kernel.stockInSessionLinesSql(fastLocator)).bind(kernel.stockInSessionLineParams(fastLocator)).all()
assert.equal(fastLines.length, 2)
assert.ok(fastLines.every((row) => row.created_product === null), 'a receipt with no member row still reports "not recorded"')
assert.ok(fastLines.every((row) => Number.isInteger(row.id)), 'fast-flow lines keep their movement ids (revertable)')

// Exactly the three sessions above, in created_at order, nothing doubled.
assert.deepEqual(keys, [`session:${zeroRowid}`, `session:${mixedRowid}`, 'session:1757000000000'])

// Search reaches a zero session by product name, barcode and supplier.
for (const term of ['serum', '4004', 'sok trading', 'dara']) {
  const search = kernel.buildStockInSessionListQuery(term)
  const found = db.prepare(search.groupedSql).bind(search.params).all()
  assert.ok(found.some((row) => row.session_key === `session:${zeroRowid}`), `search "${term}" must find the zero session`)
}

// A zero member whose operation LATER received stock through a retry (the
// member gets a movement) must not be listed twice: the movement side owns it.
db.exec(`
  INSERT INTO product_batches (id,variant_product_id,batch_key,lot_code,received_at,is_active,supplier_id,supplier_name,payment_status,unit_cost_usd,received_cost_usd,updated_at) VALUES
    (13,5,'09042026','09042026','2026-09-04',1,1,'Bong Long','paid',4,8,'2026-09-04 09:05:00');
`)
db.prepare(`INSERT INTO inventory_movements (id,product_id,product_name,branch_id,branch_name,movement_type,quantity,unit_cost_usd,total_cost_usd,reference_id,user_id,user_name,created_at,batch_id) VALUES
  (101,5,'Toner',1,'Shop','add',2,4,8,@ref,7,'Za','2026-09-04 09:05:00',13)`).run({ ref: mixedRowid })
db.exec(`UPDATE stock_session_members SET movement_id=101, batch_id=13, quantity=2 WHERE operation_id='op-mixed' AND line_id='create_5'`)
const afterList = db.prepare(`${list.groupedSql} ORDER BY created_at DESC`).bind(list.params).all()
const afterMixed = afterList.filter((row) => row.session_key === `session:${mixedRowid}`)
assert.equal(afterMixed.length, 1)
assert.equal(afterMixed[0].line_count, 2, 'a member that gained a movement is counted once, from the movement side')
assert.equal(Number(afterMixed[0].quantity), 7)

console.log('PASS zero-quantity create sessions are listed and open, mixed sessions are listed once, fast stock-in sessions are unchanged')
