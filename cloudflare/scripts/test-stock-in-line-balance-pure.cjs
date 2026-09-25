// U-records (owner, 25 Sep 2026): opening a stock-in session line showed no
// before/after. GET /api/products/stock-in-session-lines returned the line's
// folded current figures and nothing about the stock it moved.
//
// This pins, against the REAL migration chain in node:sqlite:
//   1. movementStockBalancesSql + attachBeforeQty give a received line the
//      stock before -> after that the Stock Changes ledger shows for the SAME
//      movement (one expression, two surfaces) -- hand-computed too, so a
//      shared wrong answer cannot pass;
//   2. the session line carries its AS-RECEIVED quantity and cost beside the
//      edit-folded current ones, so an edited line reads "received -> now";
//   3. the route wires both, with a null fallback (never a guessed number);
//   4. the acquisition-cost projection strips the as-received costs for a
//      user without cost-view access and keeps the quantities.
//
// Run: node scripts/test-stock-in-line-balance-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const src = path.join(__dirname, '..', 'src')
const modules = new Map()
function load(filename) {
  if (modules.has(filename)) return modules.get(filename).exports
  const mod = { exports: {} }
  modules.set(filename, mod)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  }).outputText
  new Function('require', 'module', 'exports', output)(
    (name) => (name.startsWith('.') ? load(path.resolve(path.dirname(filename), `${name}.ts`)) : require(name)),
    mod, mod.exports,
  )
  return mod.exports
}

let checks = 0
function ok(cond, label) { assert.ok(cond, label); checks += 1; console.log(`PASS ${label}`) }

const ledger = load(path.join(src, 'lib', 'stockLedgerQuery.ts'))
const sessions = load(path.join(src, 'lib', 'stockInSessionsQuery.ts'))
const costs = load(path.join(src, 'lib', 'acquisitionCostAccess.ts'))

const db = openDb(loadAll())
// Product 1's history. Stock is set to what the rows imply (10-3+5-2+2 = 12),
// so every derived balance is exact:
//   #1 add 10   0 -> 10    (another receipt)
//   #2 sale 3  10 -> 7
//   #3 add 5    7 -> 12    <- the session line under test (session 300)
//   #4 sale 2  12 -> 10
//   #5 +2      10 -> 12    an N6 edit of #3 (5 -> 7 units, cost 4 -> 6)
// Product 2 has one receipt in the same session and no later movement.
db.exec(`
  INSERT INTO users (id,username,name,password) VALUES (7,'james','James','x');
  INSERT INTO branches (id,name,is_active) VALUES (1,'Shop',1);
  INSERT INTO products (id,name,barcode,unit,stock_quantity,is_active) VALUES
    (1,'Cream','1001','pcs',12,1),
    (2,'Serum','1002','pcs',4,1);
  INSERT INTO product_batches (id,variant_product_id,batch_key,lot_code,received_at,is_active,unit_cost_usd,received_cost_usd,updated_at) VALUES
    (1,1,'260903','260903','2026-09-03',1,6,42,'2026-09-05 03:00:00'),
    (2,2,'260903','260903','2026-09-03',1,3,12,'2026-09-03 03:00:00');
  INSERT INTO inventory_movements (id,product_id,product_name,branch_id,branch_name,movement_type,quantity,unit_cost_usd,total_cost_usd,reference_id,user_id,user_name,created_at,batch_id) VALUES
    (1,1,'Cream',1,'Shop','add',10,4,40,200,7,'James','2026-09-01 03:00:00',1),
    (2,1,'Cream',1,'Shop','sale',3,NULL,NULL,900,7,'James','2026-09-02 03:00:00',NULL),
    (3,1,'Cream',1,'Shop','add',5,4,20,300,7,'James','2026-09-03 03:00:00',1),
    (6,2,'Serum',1,'Shop','add',4,3,12,300,7,'James','2026-09-03 03:00:01',2),
    (4,1,'Cream',1,'Shop','sale',2,NULL,NULL,901,7,'James','2026-09-04 03:00:00',NULL),
    (5,1,'Cream',1,'Shop','add',2,6,22,'stock-in-edit:3:op1:1',7,'James','2026-09-05 03:00:00',1);
`)

// ---- 1. the balance, and parity with the ledger ----------------------------
function balances(ids) {
  const params = Object.fromEntries(ids.map((id, index) => [`movement${index}`, id]))
  const sql = ledger.movementStockBalancesSql(ids.map((_, index) => `@movement${index}`).join(', '))
  return new Map(ledger.attachBeforeQty(db.prepare(sql).bind(params).all()).map((row) => [row.id, row]))
}
const got = balances([3, 6])
ok(got.get(3).before_qty === 7 && got.get(3).after_qty === 12, 'the received line reads stock 7 -> 12 (hand-computed)')
ok(got.get(6).before_qty === 0 && got.get(6).after_qty === 4, 'the second line reads 0 -> 4')

const q = ledger.buildStockLedgerQuery({})
const ledgerRows = ledger.attachBeforeQty(db.prepare(q.rowsSql).bind({ ...q.params, limit: 50, offset: 0 }).all())
for (const id of [3, 6]) {
  const row = ledgerRows.find((candidate) => candidate.id === id)
  assert.deepEqual([got.get(id).before_qty, got.get(id).after_qty], [row.before_qty, row.after_qty], `movement ${id}: session line and ledger agree`)
}
ok(true, 'a session line and the Stock Changes ledger give the same movement the same before -> after')

// ---- 2. as received vs now -------------------------------------------------
const locator = sessions.parseStockInSessionKey('session:300')
const lines = db.prepare(sessions.stockInSessionLinesSql(locator)).bind(sessions.stockInSessionLineParams(locator)).all()
const cream = lines.find((row) => row.id === 3)
ok(cream && cream.received_quantity === 5 && cream.quantity === 7, 'the edited line carries received 5 beside current 7')
ok(cream.received_unit_cost_usd === 4 && cream.unit_cost_usd === 6, 'and its received unit cost 4 beside current 6')
ok(cream.received_total_cost_usd === 20 && cream.total_cost_usd === 42, 'and its received total 20 beside current 42')
const serum = lines.find((row) => row.id === 6)
ok(serum.received_quantity === serum.quantity && serum.received_unit_cost_usd === serum.unit_cost_usd, 'an unedited line reads the same in both')
ok(lines.length === 2, 'the edit row is folded into its root line, never listed as a line of its own')

// ---- 3. the route wires it -------------------------------------------------
const route = fs.readFileSync(path.join(src, 'routes', 'products.ts'), 'utf8')
const handler = route.slice(route.indexOf("app.get('/stock-in-session-lines'"), route.indexOf("app.get('/stock-ledger'"))
ok(/movementStockBalancesSql\(/.test(handler) && /attachBeforeQty\(/.test(handler), 'the session-lines handler computes balances through the shared ledger expression')
ok(/before_qty: balance \? balance\.before_qty : null/.test(handler) && /after_qty: balance \? balance\.after_qty : null/.test(handler), 'a line without a derivable balance gets null, not a number')
ok(/app\.use\('\*', acquisitionCostResponses\)/.test(route), 'products routes still project acquisition costs out of every response')

// ---- 4. cost visibility ----------------------------------------------------
const staff = { id: 8, username: 'staff', role_code: 'manager', permissions: JSON.stringify({ products: true, inventory: true }), role_permissions: '{}' }
const viewer = { ...staff, permissions: JSON.stringify({ products: true, inventory: true, product_cost_view: true }) }
const wire = { rows: [{ ...cream, before_qty: 7, after_qty: 12 }] }
const hidden = costs.projectAcquisitionCosts(wire, staff).rows[0]
ok(!('received_unit_cost_usd' in hidden) && !('received_total_cost_usd' in hidden) && !('unit_cost_usd' in hidden), 'without cost-view access the as-received costs are stripped')
ok(hidden.received_quantity === 5 && hidden.before_qty === 7 && hidden.after_qty === 12, 'the quantities and the stock balance stay visible')
const shown = costs.projectAcquisitionCosts(wire, viewer).rows[0]
ok(shown.received_unit_cost_usd === 4, 'a cost viewer still sees them')

console.log(`\n${checks} stock-in line balance checks passed`)
