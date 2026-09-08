// The warehouse holds stock and never sells. Stock transfers may move in
// either direction between the canonical Shop and Warehouse.
//
// Before this test the rule existed only in people's heads: every sale-side
// picker offered whatever branch it happened to have, POST /sales took any
// branch_id the client sent, a return's replacement line took the return's
// branch unchecked, and POST /transfer only ever refused a transfer whose
// source and destination were the same branch. So a sale could be rung
// against the warehouse -- deducting stock that was never on a shelf -- and
// transfers were originally limited to warehouse -> shop, which made a
// legitimate return-to-warehouse transfer and Inventory undo fail.
//
// What is exercised here:
//   1. The two canonical roles, off the only discriminator this lineage has
//      (the branch NAME), read back out of real SQLite rather than from a
//      literal, so the guard is proven against the shape branches actually
//      have -- including the whitespace/case a hand-typed branch name
//      carries.
//   2. The guards themselves: which branch on a write refuses a sale line,
//      and which transfer directions are refused.
//   3. That the two client-facing messages are the EXACT English of the pack
//      keys the UI shows. A rejection that reaches the client has to map
//      back to the same prompt in both languages; a server-only wording
//      would surface untranslated.
//   4. That the routes actually call the guards, on every path that writes a
//      sale line or moves stock between branches.
//
// Run: node scripts/test-selling-branch-guard-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

function transpile(relPath) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', relPath), 'utf8')
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  }).outputText
}

function loadModule(relPath, requireShim) {
  const module = { exports: {} }
  new Function('exports', 'require', 'module', transpile(relPath))(module.exports, requireShim || (() => ({})), module)
  return module.exports
}

const roles = loadModule('lib/branchRoles.ts')
const guards = loadModule('lib/branchRoleGuards.ts', (id) => {
  if (id.endsWith('branchRoles')) return roles
  throw new Error(`unexpected require(${id})`)
})

const read = (relPath) => fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8')
const readRepo = (relPath) => fs.readFileSync(path.join(__dirname, '..', '..', relPath), 'utf8')

let failures = 0
function runTest(name, fn) {
  try {
    fn()
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL  ${name}`)
    console.error(`      ${error && error.message}`)
  }
}

// ---------------------------------------------------------------------------
// 1. The roles, read out of a real branches table
// ---------------------------------------------------------------------------

const db = new Database(':memory:')
db.exec(`
  CREATE TABLE branches (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1
  );
  INSERT INTO branches (id, name, is_default) VALUES
    (1, 'Shop', 1),
    (2, '  WAREHOUSE ', 0),
    (3, 'Depot', 0);
`)
const branchRows = db.prepare('SELECT id, name FROM branches ORDER BY id').all()

runTest('the branch NAME is the discriminator, trimmed and case-folded', () => {
  assert.deepEqual(branchRows.map((row) => roles.branchRoleFromName(row.name)), ['shop', 'warehouse', 'other'])
  assert.equal(roles.branchRoleFromName(null), 'other')
  assert.equal(roles.branchRoleFromName(undefined), 'other')
  assert.equal(roles.branchRoleFromName(''), 'other')
  assert.equal(roles.branchRoleFromName('warehouse 2'), 'other')
})

runTest('is_default is NOT the discriminator', () => {
  // The shop happens to be the default here. A guard that keyed on
  // is_default would answer identically on this fixture and invert on the
  // deployment where the warehouse is the default one, so pin the
  // difference: flip the flag and nothing about the roles may move.
  db.prepare('UPDATE branches SET is_default = 1 WHERE id = 2').run()
  db.prepare('UPDATE branches SET is_default = 0 WHERE id = 1').run()
  const flipped = db.prepare('SELECT id, name FROM branches ORDER BY id').all()
  assert.deepEqual(flipped.map((row) => roles.branchRoleFromName(row.name)), ['shop', 'warehouse', 'other'])
  assert.equal(guards.firstUnsellableBranch(flipped)?.id, 2)
})

// ---------------------------------------------------------------------------
// 2. The guards
// ---------------------------------------------------------------------------

runTest('a sale line is accepted only at the exact Shop', () => {
  assert.equal(guards.firstUnsellableBranch([{ id: 1, name: 'Shop' }]), null)
  assert.equal(guards.firstUnsellableBranch([{ id: 3, name: 'Depot' }])?.id, 3)
  assert.equal(guards.firstUnsellableBranch([{ id: 1, name: 'Shop' }, { id: 3, name: 'Depot' }])?.id, 3)
  // A cart whose lines resolved to more than one branch is refused on the
  // warehouse line even when the sale's own branch is the shop -- this is
  // exactly the mixed case a per-line branch_id makes possible.
  assert.equal(guards.firstUnsellableBranch([{ id: 1, name: 'Shop' }, { id: 2, name: '  WAREHOUSE ' }])?.id, 2)
  assert.equal(guards.firstUnsellableBranch([])?.id, undefined)
  assert.equal(guards.firstUnsellableBranch([]), null)
  assert.equal(guards.firstUnsellableBranch([{ id: 9, name: null }])?.id, 9, 'an unnamed branch is never guessed to be the Shop')
})

runTest('transfers run both ways between opposite canonical roles only', () => {
  assert.equal(guards.transferDirectionError('Warehouse', 'Shop'), null)
  assert.equal(guards.transferDirectionError('  WAREHOUSE ', 'shop'), null)
  assert.equal(guards.transferDirectionError('Shop', 'Warehouse'), null)
  assert.equal(guards.transferDirectionError(' shop ', ' WAREHOUSE '), null)
  assert.equal(guards.transferDirectionError('Shop', 'Shop'), guards.TRANSFER_DIRECTION_ERROR)
  assert.equal(guards.transferDirectionError('Warehouse', 'Warehouse'), guards.TRANSFER_DIRECTION_ERROR)
  assert.equal(guards.transferDirectionError('Shop', 'Depot'), guards.TRANSFER_DIRECTION_ERROR)
  assert.equal(guards.transferDirectionError('Depot', 'Warehouse'), guards.TRANSFER_DIRECTION_ERROR)
  assert.equal(guards.transferDirectionError('Depot', 'Kiosk'), guards.TRANSFER_DIRECTION_ERROR)
  assert.equal(guards.transferDirectionError('Warehouse', 'Depot'), guards.TRANSFER_DIRECTION_ERROR)
  assert.equal(guards.transferDirectionError('Depot', 'Shop'), guards.TRANSFER_DIRECTION_ERROR)
})

// ---------------------------------------------------------------------------
// 3. The messages the client sees
// ---------------------------------------------------------------------------

const en = JSON.parse(readRepo('frontend/src/lang/en.json'))
const km = JSON.parse(readRepo('frontend/src/lang/km.json'))

runTest('both rejections carry the exact English of a translated pack key', () => {
  assert.equal(guards.WAREHOUSE_NOT_SELLABLE_ERROR, en.pos_warehouse_not_sellable)
  assert.equal(guards.TRANSFER_DIRECTION_ERROR, en.transfer_canonical_pair_only)
  assert.ok(km.pos_warehouse_not_sellable, 'the Khmer pack carries the refusal too')
  assert.ok(km.transfer_canonical_pair_only)
  assert.notEqual(km.pos_warehouse_not_sellable, en.pos_warehouse_not_sellable, 'the Khmer entry is a translation, not a copy')
  assert.notEqual(km.transfer_canonical_pair_only, en.transfer_canonical_pair_only)
})

// ---------------------------------------------------------------------------
// 4. The twin, and the routes that call it
// ---------------------------------------------------------------------------

runTest('the two branchRoles.ts copies are the same code', () => {
  const body = (source) => source.replace(/\r\n/g, '\n').split('export type BranchRole')[1]
  assert.equal(
    body(read('src/lib/branchRoles.ts')),
    body(readRepo('frontend/src/utils/branchRoles.ts')),
    'the Worker and the client must refuse the same branches',
  )
})

const salesSource = read('src/routes/sales.ts')
const returnsSource = read('src/routes/returns.ts')
const salesImportSource = read('src/lib/salesImportCommit.ts')
const branchesSource = read('src/routes/branches.ts')
const inventorySource = read('src/routes/inventory.ts')

runTest('every path that writes a sale line asks the guard first', () => {
  // Checkout, add-items-to-a-sale, and a replaced-in product: three writers,
  // three checks. Counting them is what catches a fourth writer being added
  // later without one.
  assert.equal((salesSource.match(/firstUnsellableBranch\(/g) || []).length, 3)
  assert.equal((returnsSource.match(/branchCanSell\(/g) || []).length, 1)
  assert.match(salesSource, /SHOP_ONLY_SALE_ERROR \}, 400\)/)
  assert.match(salesSource, /from '\.\.\/lib\/branchRoleGuards'/)
  assert.match(returnsSource, /WAREHOUSE_NOT_SELLABLE_ERROR \}, 400\)/)
  assert.match(returnsSource, /from '\.\.\/lib\/branchRoleGuards'/)
  assert.match(returnsSource, /!branchCanSell\(branch\.name\)/)
  assert.match(salesImportSource, /!branchCanSell\(saleBranch\.name\)/)
  assert.match(salesImportSource, /throw new Error\(WAREHOUSE_NOT_SELLABLE_ERROR\)/)
})

runTest('sale writers require one real active Shop header and identical line branches', () => {
  assert.match(salesSource, /saleBranchRows\.length !== saleBranchIds\.length/)
  assert.match(salesSource, /lineBranchId !== saleHeaderBranchId/)
  assert.match(salesSource, /addedBranchRows\.length !== addedBranchIds\.length/)
  assert.match(salesSource, /Number\(line\.branch_id\) !== saleHeaderBranchId/)
  assert.match(salesSource, /branchId !== saleHeaderBranchId/)
  assert.match(salesSource, /COALESCE\(is_active,1\)=1/)
  assert.match(salesSource, /firstUnsellableBranch\(\[amendmentBranch\]\)/)
  assert.match(salesSource, /branchCanSell\(cancellationBranch\.name\)/, 'automatic cancellation expenses inherit a verified Shop sale link')
  assert.match(returnsSource, /replacementInputs\.some\(\(line\) => Number\(line\.branch_id \|\| branchId\) !== branchId\)/)
  assert.match(returnsSource, /const lineBranchId = Number\(input\.branch_id \|\| branchId\)/)
  assert.match(salesImportSource, /branchId !== saleHeaderBranchId/)
  assert.match(salesImportSource, /branch_id: saleHeaderBranchId/)
})

runTest('the guard runs before the write, not after it', () => {
  // A guard that lands after the atomic batch has already been built is a
  // guard that rejects nothing.
  const guardAt = salesSource.indexOf('firstUnsellableBranch(')
  const firstBatchAt = salesSource.indexOf('db.batch(')
  assert.ok(guardAt > 0 && firstBatchAt > 0)
  assert.ok(guardAt < firstBatchAt, 'the selling-branch check must precede the first atomic write')
})

runTest('ALL THREE transfer routes check the direction', () => {
  // /branches/transfer, /branches/transfer-bulk and /inventory/transfer.
  // The third one is the route Inventory.tsx's own transfer button calls
  // (and its undo and its redo), so a rule enforced on the first two alone
  // left a shop -> warehouse move one button away from any operator.
  assert.equal((branchesSource.match(/transferDirectionError\(/g) || []).length, 2, 'the single and the bulk transfer route')
  assert.equal((inventorySource.match(/transferDirectionError\(/g) || []).length, 1, 'the inventory-surface transfer route')
  assert.match(branchesSource, /if \(directionError\) return c\.json\(\{ error: directionError \}, 400\)/)
  assert.match(branchesSource, /if \(bulkDirectionError\) return c\.json\(\{ error: bulkDirectionError \}, 400\)/)
  assert.match(inventorySource, /if \(directionError\) return c\.json\(\{ error: directionError \}, 400\)/)
  assert.match(inventorySource, /from '\.\.\/lib\/branchRoleGuards'/)
  assert.equal((branchesSource.match(/resolveCanonicalTransferPair\(/g) || []).length, 2, 'both branch transfer routes require an unambiguous active pair')
  assert.equal((inventorySource.match(/resolveCanonicalTransferPair\(/g) || []).length, 1, 'the inventory transfer requires an unambiguous active pair')
  assert.equal((branchesSource.match(/canonicalTransferAuthorityGuardStatement\(/g) || []).length, 6, 'both final transfer batches and four conditional lot-clone writes re-check authority atomically')
  assert.equal((inventorySource.match(/canonicalTransferAuthorityGuardStatement\(/g) || []).length, 1, 'the inventory transfer batch re-checks authority atomically')
  assert.match(branchesSource, /CANONICAL_BRANCH_CONFIGURATION_CODE \}, 409\)/)
  assert.match(inventorySource, /CANONICAL_BRANCH_CONFIGURATION_CODE \}, 409\)/)
})

runTest('the inventory transfer is refused before its atomic write', () => {
  // Same reasoning as the sales guard above: this route moves branch_stock
  // AND the lot rows in one db.batch, so a check that landed after it would
  // reject a transfer that had already happened.
  const routeAt = inventorySource.indexOf("app.post('/transfer'")
  assert.ok(routeAt > 0, 'the inventory transfer route must still exist')
  const guardAt = inventorySource.indexOf('transferDirectionError(', routeAt)
  const atomicGuardAt = inventorySource.indexOf('canonicalTransferAuthorityGuardStatement(', routeAt)
  const batchAt = inventorySource.indexOf('db.batch(', routeAt)
  assert.ok(guardAt > routeAt, 'the guard must live inside the transfer route')
  assert.ok(batchAt > routeAt)
  assert.ok(guardAt < batchAt, 'the direction check must precede the first atomic write')
  const stockUpdateAt = inventorySource.indexOf("UPDATE branch_stock SET quantity = quantity - @quantity", routeAt)
  assert.ok(atomicGuardAt > batchAt && atomicGuardAt < stockUpdateAt, 'the authoritative identity guard must be the first statement inside the atomic transfer batch')
})

if (failures) {
  console.error(`\n${failures} failing`)
  process.exit(1)
}
console.log('\nselling-branch guard: all green')
