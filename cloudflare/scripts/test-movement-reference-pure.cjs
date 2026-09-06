// N13 -- the RECEIPT and the ACTOR on a movement row.
//
// Two read-time resolutions, both discriminating by construction:
//
//  1. reference_label / reference_kind (lib/movementReference.ts). The
//     fixture below builds the collision the naive implementation cannot
//     survive: returns.id 7 and sales.id 7 BOTH exist, and two 'return'
//     movements carry reference_id 7 -- one written by the returns route
//     (its product is in return_items 7) and one written by the sale-cancel
//     path (its product is in sale_items 7). "Look it up in returns first"
//     prints return 7's number on the cancelled sale's restock row; product
//     membership gets both right. A third row pins that the label never comes
//     from the legacy "004419@2026-09-01" reason text.
//
//  2. user_name (lib/movementActorName.ts). Row 9602 stores the FULL NAME
//     'ung sethy pagna' with user_id 2, whose username is 'james' -- on the
//     pre-fix tree the ledger selected m.user_name and returned the full
//     name (verified: reading m.user_name over this same fixture returns
//     'ung sethy pagna'). Rows with no user_id, and rows whose account has
//     been deleted, keep their snapshot.
//
// Run: node scripts/test-movement-reference-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const tscVersion = execSync('npx tsc --version', { cwd: cloudflareRoot, encoding: 'utf8' }).trim()
const ignoreConfigFlag = /^Version\s+(?:[6-9]|\d{2,})\./.test(tscVersion) ? ' --ignoreConfig' : ''

let checks = 0
function ok(cond, label) {
  assert.ok(cond, label)
  checks += 1
  console.log('PASS ' + label)
}

// ---- compile the real modules ---------------------------------------------
const MODULES = [
  'stockLedgerQuery.ts', 'businessDateWindow.ts', 'movementBranchName.ts',
  'movementActorName.ts', 'movementReference.ts',
]
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-reference-'))
for (const file of MODULES) {
  fs.copyFileSync(path.join(cloudflareRoot, 'src', 'lib', file), path.join(tmpDir, file))
}
execSync(
  'npx tsc ' + MODULES.map((f) => '"' + path.join(tmpDir, f) + '"').join(' ') +
  ' --outDir "' + tmpDir + '" --module commonjs --target es2022 --strict --skipLibCheck' + ignoreConfigFlag,
  { cwd: cloudflareRoot, stdio: 'pipe' },
)
const ledger = require(path.join(tmpDir, 'stockLedgerQuery.js'))
const referenceLib = require(path.join(tmpDir, 'movementReference.js'))
const actorLib = require(path.join(tmpDir, 'movementActorName.js'))
ok(typeof referenceLib.movementReferenceSelectSql === 'function', 'movementReference kernel compiled')
ok(typeof actorLib.movementActorNameSql === 'function', 'movementActorName kernel compiled')

// ---- real DB: full migration chain -----------------------------------------
const db = openDb(loadAll())
ok(true, 'full migration chain applied')

db.prepare('INSERT INTO branches (id, name) VALUES (@id, @name)').bind({ id: 1, name: 'Shop' }).run()
// The two accounts from the owner report: id 2 is "james" but every older
// movement row snapshotted his full name; id 1 is "admin" snapshotted "Admin".
db.prepare('INSERT INTO users (id, username, name, password) VALUES (@id, @username, @name, @password)')
  .bind({ id: 1, username: 'admin', name: 'Admin', password: 'x' }).run()
db.prepare('INSERT INTO users (id, username, name, password) VALUES (@id, @username, @name, @password)')
  .bind({ id: 2, username: 'james', name: 'ung sethy pagna', password: 'x' }).run()

function insertProduct(id, name, barcode, stock) {
  db.prepare('INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (@id, @name, @barcode, @unit, @stock, 1)')
    .bind({ id, name, barcode, unit: 'pcs', stock }).run()
}
insertProduct(9601, 'Reference Ledger Cream', '8800000000611', 6)
insertProduct(9602, 'Collision Test Serum', '8800000000612', 6)

// sales.id 7 and returns.id 7 BOTH exist -- two autoincrement sequences that
// collide freely in production, which is the whole point of this fixture.
db.prepare('INSERT INTO sales (id, receipt_number, created_at) VALUES (@id, @receipt, @created_at)')
  .bind({ id: 7, receipt: '20260901-193100', created_at: '2026-09-01 19:31:00' }).run()
db.prepare('INSERT INTO sales (id, receipt_number, created_at) VALUES (@id, @receipt, @created_at)')
  .bind({ id: 11, receipt: '20260901-142200', created_at: '2026-09-01 14:22:00' }).run()
db.prepare('INSERT INTO returns (id, return_number, sale_id, created_at) VALUES (@id, @number, @sale_id, @created_at)')
  .bind({ id: 7, number: 'RET-20260902-0007', sale_id: 11, created_at: '2026-09-02 09:00:00' }).run()

// Membership: sale 7 sold the SERUM; return 7 took back the CREAM.
db.prepare('INSERT INTO sale_items (sale_id, product_id, product_name, quantity) VALUES (@sale_id, @product_id, @name, 1)')
  .bind({ sale_id: 7, product_id: 9602, name: 'Collision Test Serum' }).run()
db.prepare('INSERT INTO sale_items (sale_id, product_id, product_name, quantity) VALUES (@sale_id, @product_id, @name, 1)')
  .bind({ sale_id: 11, product_id: 9601, name: 'Reference Ledger Cream' }).run()
db.prepare('INSERT INTO return_items (return_id, product_id, product_name, quantity) VALUES (@return_id, @product_id, @name, 1)')
  .bind({ return_id: 7, product_id: 9601, name: 'Reference Ledger Cream' }).run()

function insertMovement(row) {
  db.prepare(
    'INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, reference_id, user_id, user_name, created_at)' +
    ' VALUES (@id, @product_id, @product_name, @branch_id, @branch_name, @movement_type, @quantity, @reason, @reference_id, @user_id, @user_name, @created_at)',
  ).bind({
    branch_id: 1, branch_name: 'Shop', reason: null, reference_id: null,
    user_id: null, user_name: null, ...row,
  }).run()
}

// --- product 9601 -----------------------------------------------------------
// 9611: an IMPORTED legacy sale. Its reason carries the old system's
// "<receipt>@<date>" text; the label must come from the sales row instead.
insertMovement({
  id: 9611, product_id: 9601, product_name: 'Reference Ledger Cream', movement_type: 'sale', quantity: 2,
  reason: 'Old-system sale 004419@2026-09-01', reference_id: 11,
  user_id: null, user_name: 'Old system', created_at: '2026-09-01 14:22:00',
})
// 9612: the RETURNS-route restock of that sale -- reference_id 7 is a returns.id,
// and return 7 does hold this product.
insertMovement({
  id: 9612, product_id: 9601, product_name: 'Reference Ledger Cream', movement_type: 'return', quantity: 1,
  reason: 'Return: damaged box', reference_id: 7,
  user_id: 2, user_name: 'ung sethy pagna', created_at: '2026-09-02 09:00:00',
})
// 9613: a plain stock addition. Its reference_id is a stock-in session token,
// not a receipt; it must never be looked up.
insertMovement({
  id: 9613, product_id: 9601, product_name: 'Reference Ledger Cream', movement_type: 'add', quantity: 7,
  reason: 'Shipment', reference_id: 'stockin-2026-09-03-a',
  user_id: 1, user_name: 'Admin', created_at: '2026-09-03 08:00:00',
})

// --- product 9602 -----------------------------------------------------------
// 9621: the POS sale itself.
insertMovement({
  id: 9621, product_id: 9602, product_name: 'Collision Test Serum', movement_type: 'sale', quantity: 3,
  reason: '', reference_id: 7, user_id: 2, user_name: 'ung sethy pagna', created_at: '2026-09-01 19:31:00',
})
// 9622: the sale-CANCEL restock. Same movement_type and same reference_id 7 as
// 9612 -- but this 7 is a sales.id. This is the row a returns-first lookup
// mislabels 'RET-20260902-0007'.
insertMovement({
  id: 9622, product_id: 9602, product_name: 'Collision Test Serum', movement_type: 'return', quantity: 3,
  reason: 'Sale cancelled', reference_id: 7, user_id: 2, user_name: 'ung sethy pagna', created_at: '2026-09-01 20:00:00',
})
// 9623: negative control -- a sale-family row whose reference_id names nothing
// at all. It must stay unlabelled rather than borrow a neighbour's receipt.
insertMovement({
  id: 9623, product_id: 9602, product_name: 'Collision Test Serum', movement_type: 'return', quantity: 1,
  reason: 'Orphaned reference', reference_id: 4242,
  user_id: 4242, user_name: 'deleted account', created_at: '2026-09-01 21:00:00',
})

function ledgerRows(productId) {
  const query = ledger.buildStockLedgerQuery({ productId })
  const rows = db.prepare(query.rowsSql).all({ ...query.params, limit: 50, offset: 0 })
  return new Map(rows.map((row) => [Number(row.id), row]))
}
const first = ledgerRows(9601)
const second = ledgerRows(9602)
assert.equal(first.size + second.size, 6, 'the resolutions must not multiply or drop rows')
ok(true, 'ledger returns exactly the six fixture rows (no fan-out)')

// ---- the receipt --------------------------------------------------------
assert.equal(first.get(9611).reference_label, '20260901-142200', 'an imported sale row must name its receipt')
assert.equal(first.get(9611).reference_kind, 'sale', 'an imported sale row is a sale reference')
ok(true, "imported sale row names sales.receipt_number ('20260901-142200')")
assert.notEqual(first.get(9611).reference_label, '004419@2026-09-01', 'the legacy @date text is not a receipt number')
assert.ok(!String(first.get(9611).reference_label).includes('@'), 'no receipt label may carry the legacy @date suffix')
assert.equal(first.get(9611).reason, 'Old-system sale 004419@2026-09-01', 'the legacy text stays in the reason line')
ok(true, 'the legacy "<receipt>@<date>" text stays in the reason and never becomes the label')

assert.equal(second.get(9621).reference_label, '20260901-193100', 'a POS sale row must name its receipt')
assert.equal(second.get(9621).reference_kind, 'sale', 'a POS sale row is a sale reference')
ok(true, 'POS sale row names its receipt even though its reason is blank')

// THE collision, both directions.
assert.equal(first.get(9612).reference_kind, 'return', 'a returns-route restock is a return reference')
assert.equal(first.get(9612).reference_label, 'RET-20260902-0007', 'a returns-route restock must name the return')
ok(true, "returns-route 'return' row (reference_id 7 = returns.id) names RET-20260902-0007")
assert.equal(second.get(9622).reference_kind, 'sale', 'a sale-cancel restock is a SALE reference')
assert.equal(second.get(9622).reference_label, '20260901-193100', 'a sale-cancel restock must name the sale it restored')
ok(true, "sale-cancel 'return' row (reference_id 7 = sales.id) names the sale, not return 7")

// Negative controls: nothing is invented.
assert.equal(first.get(9613).reference_kind, null, 'a stock-in add has no receipt kind')
assert.equal(first.get(9613).reference_label, null, 'a stock-in session token is never resolved as a receipt')
ok(true, 'negative control: an add row with a session token stays unlabelled')
assert.equal(second.get(9623).reference_kind, null, 'an orphaned reference names no record')
assert.equal(second.get(9623).reference_label, null, 'an orphaned reference must not borrow a label')
ok(true, 'negative control: a reference_id matching no record stays unlabelled')

// ---- the actor -----------------------------------------------------------
assert.equal(first.get(9612).user_name, 'james', "user_id 2's full-name snapshot must render as the username")
ok(true, "row snapshotted 'ung sethy pagna' with user_id 2 renders 'james'")
assert.equal(first.get(9613).user_name, 'admin', "user_id 1's 'Admin' snapshot must render as 'admin'")
ok(true, "row snapshotted 'Admin' with user_id 1 renders 'admin'")
assert.equal(first.get(9611).user_name, 'Old system', 'a row with no user_id keeps its snapshot')
ok(true, 'negative control: NULL-user row keeps its snapshot (Old system)')
assert.equal(second.get(9623).user_name, 'deleted account', 'a row whose account is gone keeps its snapshot')
ok(true, 'negative control: deleted-account row keeps its snapshot')

// ---- the /movements drill: the same expressions on a bare table -----------
const drillRows = db.prepare(
  'SELECT *, ' + actorLib.movementActorNameSql('inventory_movements') + ' AS ' + actorLib.RESOLVED_ACTOR_NAME_COLUMN + ', ' +
  referenceLib.movementReferenceSelectSql('inventory_movements') +
  ' FROM inventory_movements ORDER BY id',
).all({})
const folded = drillRows.map(actorLib.withResolvedActorName)
assert.deepEqual(
  folded.map((row) => [Number(row.id), row.user_name, row.reference_kind, row.reference_label]),
  [
    [9611, 'Old system', 'sale', '20260901-142200'],
    [9612, 'james', 'return', 'RET-20260902-0007'],
    [9613, 'admin', null, null],
    [9621, 'james', 'sale', '20260901-193100'],
    [9622, 'james', 'sale', '20260901-193100'],
    [9623, 'deleted account', null, null],
  ],
  'the movement drill resolves the same actor and receipt as the ledger, row for row',
)
ok(true, 'the /movements drill and the Stock Change ledger agree row for row')
assert.ok(!(actorLib.RESOLVED_ACTOR_NAME_COLUMN in folded[0]), 'the helper column is dropped before the row leaves the Worker')
ok(true, 'the actor helper column never reaches the client -- consumers see one user_name field')

// The routes must actually use both halves; a query that resolves and a
// response that drops the value would pass every assertion above.
const routeSrc = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'inventory.ts'), 'utf8')
assert.ok(/movementActorNameSql\('inventory_movements'\)/.test(routeSrc), 'the /movements query does not resolve the actor')
assert.ok(/movementReferenceSelectSql\('inventory_movements'\)/.test(routeSrc), 'the /movements query does not resolve the receipt')
assert.ok(/\.map\(\(row\) => withResolvedActorName\(withResolvedBranchName\(row\)\)\)/.test(routeSrc), 'the /movements response does not fold the resolved actor back onto user_name')
ok(true, 'GET /api/inventory/movements resolves and folds the actor, and resolves the receipt')

// The stock-in session surfaces read the same movement rows and must name the
// actor the same way -- one rule, one implementation.
const sessionSrc = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'stockInSessionsQuery.ts'), 'utf8')
assert.ok(/movementActorNameSql\('m'\)\} AS user_name/.test(sessionSrc), 'the stock-in session lines still select the raw snapshot')
assert.ok(!/MAX\(m\.user_name\) AS user_name/.test(sessionSrc), 'the stock-in session list still groups on the raw snapshot')
ok(true, 'the stock-in session list and detail resolve the actor through the shared expression')

console.log('\nOK ' + checks + ' checks')
