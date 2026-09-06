// N13 -- the BRANCH column on a movement row.
//
// Discriminating by construction: every fixture row below has a branch_id, and
// the fixture is built so that "read m.branch_name" and "resolve through
// branch_id" give DIFFERENT answers on four of the five rows. On the pre-fix
// tree the sale and return rows come back with branch_name null (verified: the
// same query against the same fixture printed a null branch_name for a row
// whose branch_id names 'Shop'), which is exactly the empty Branch column the
// owner reported.
//
// The precedence rule is pinned too: a row that DID store a snapshot keeps it,
// so renaming a branch never rewrites what the history says happened.
//
// Run: node scripts/test-movement-branch-pure.cjs
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
// stockLedgerQuery imports ./stockInSessionsQuery since the session lane (c438eee0), so the temp compile needs it too.
const MODULES = ['stockLedgerQuery.ts', 'businessDateWindow.ts', 'movementBranchName.ts', 'stockInSessionsQuery.ts']
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-branch-'))
for (const file of MODULES) {
  fs.copyFileSync(path.join(cloudflareRoot, 'src', 'lib', file), path.join(tmpDir, file))
}
execSync(
  'npx tsc ' + MODULES.map((f) => '"' + path.join(tmpDir, f) + '"').join(' ') +
  ' --outDir "' + tmpDir + '" --module commonjs --target es2022 --strict --skipLibCheck' + ignoreConfigFlag,
  { cwd: cloudflareRoot, stdio: 'pipe' },
)
const ledger = require(path.join(tmpDir, 'stockLedgerQuery.js'))
const branchLib = require(path.join(tmpDir, 'movementBranchName.js'))
ok(typeof branchLib.movementBranchNameSql === 'function', 'movementBranchName kernel compiled')

// ---- real DB: full migration chain -----------------------------------------
const db = openDb(loadAll())
ok(true, 'full migration chain applied')

db.prepare('INSERT INTO branches (id, name) VALUES (@id, @name)').bind({ id: 1, name: 'Shop' }).run()
db.prepare('INSERT INTO branches (id, name) VALUES (@id, @name)').bind({ id: 2, name: 'Warehouse' }).run()
db.prepare('INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (@id, @name, @barcode, @unit, @stock, 1)')
  .bind({ id: 9301, name: 'Branch Ledger Cream', barcode: '8800000000311', unit: 'pcs', stock: 4 }).run()

function insertMovement(row) {
  db.prepare(
    'INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_name, created_at)' +
    ' VALUES (@id, @product_id, @product_name, @branch_id, @branch_name, @movement_type, @quantity, @reason, @user_name, @created_at)',
  ).bind({ product_id: 9301, product_name: 'Branch Ledger Cream', reason: null, user_name: 'za', ...row }).run()
}

// The stock-side writers stamp both columns; the sale/return-family writers
// stamp only branch_id. Row 9404 stores a name that DISAGREES with the branch
// it points at -- that is the row that catches a "just read branches.name"
// implementation, which would silently rewrite it.
insertMovement({ id: 9401, branch_id: 2, branch_name: 'Warehouse', movement_type: 'add', quantity: 10, created_at: '2026-09-01 01:00:00' })
insertMovement({ id: 9402, branch_id: 1, branch_name: null, movement_type: 'sale', quantity: -3, created_at: '2026-09-01 02:00:00' })
insertMovement({ id: 9403, branch_id: 1, branch_name: '', movement_type: 'return_in', quantity: 1, created_at: '2026-09-01 03:00:00' })
insertMovement({ id: 9404, branch_id: 1, branch_name: 'Shop (old name)', movement_type: 'remove', quantity: -1, created_at: '2026-09-01 04:00:00' })
insertMovement({ id: 9405, branch_id: 4242, branch_name: null, movement_type: 'sale', quantity: -3, created_at: '2026-09-01 05:00:00' })

const query = ledger.buildStockLedgerQuery({ productId: 9301 })
const rows = db.prepare(query.rowsSql).all({ ...query.params, limit: 50, offset: 0 })
const byId = new Map(rows.map((row) => [Number(row.id), row]))
assert.equal(rows.length, 5, 'the branch resolution must not multiply or drop rows')
ok(true, 'ledger returns exactly the five fixture rows (no fan-out)')

// The defect, stated as behaviour.
assert.equal(byId.get(9402).branch_name, 'Shop', 'a SALE movement with only branch_id must name its branch')
ok(true, 'sale row with no branch_name snapshot resolves to Shop through branch_id')
assert.equal(byId.get(9403).branch_name, 'Shop', 'an EMPTY-STRING snapshot is treated as absent, not as a blank branch')
ok(true, 'return_in row with an empty snapshot resolves to Shop')

// Snapshot-first: history is not rewritten by what branches says today.
assert.equal(byId.get(9404).branch_name, 'Shop (old name)', 'a stored snapshot wins over the current branches row')
ok(true, 'a row that stored its own branch name keeps it (a rename cannot rewrite history)')
assert.equal(byId.get(9401).branch_name, 'Warehouse', 'stock-side rows are unchanged')
ok(true, 'stamped stock-side row is unchanged by the resolution')

// Negative control: without it, an implementation that fabricated a label
// (or joined wrongly) would pass everything above.
assert.equal(byId.get(9405).branch_name, null, 'a branch_id with no matching branch must stay null, never a fabricated label')
ok(true, 'negative control: unknown branch_id resolves to null, not an invented name')

// The count statement shares LEDGER_FROM and must be unaffected.
const count = db.prepare(query.countSql).get(query.params)
assert.equal(Number(Object.values(count)[0]), 5, 'count over the same scope stays 5')
ok(true, 'count statement is unaffected by the branch resolution')

// ---- the /movements drill: the same expression on a bare table -------------
// It cannot alias the value branch_name (SELECT * already emits that column),
// so it selects a helper column and folds it back in JS. Both halves pinned.
const drillRows = db.prepare(
  'SELECT *, ' + branchLib.movementBranchNameSql('inventory_movements') + ' AS ' + branchLib.RESOLVED_BRANCH_NAME_COLUMN +
  ' FROM inventory_movements ORDER BY id',
).all({})
const folded = drillRows.map(branchLib.withResolvedBranchName)
assert.deepEqual(
  folded.map((row) => [Number(row.id), row.branch_name]),
  [[9401, 'Warehouse'], [9402, 'Shop'], [9403, 'Shop'], [9404, 'Shop (old name)'], [9405, null]],
  'the movement drill resolves the same branch for every row as the ledger',
)
ok(true, 'the /movements drill and the Stock Change ledger agree row for row')
assert.ok(!(branchLib.RESOLVED_BRANCH_NAME_COLUMN in folded[0]), 'the helper column is dropped before the row leaves the Worker')
ok(true, 'the helper column never reaches the client -- consumers see one branch_name field')

// The route must actually use both halves; a query that resolves and a
// response that drops the value would pass every assertion above.
const routeSrc = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'inventory.ts'), 'utf8')
assert.ok(/movementBranchNameSql\('inventory_movements'\)/.test(routeSrc), 'the /movements query does not resolve the branch name')
assert.ok(/\.map\(withResolvedBranchName\)/.test(routeSrc), 'the /movements response does not fold the resolved branch back onto branch_name')
ok(true, 'GET /api/inventory/movements resolves and folds the branch name')

console.log('\nOK ' + checks + ' checks')
