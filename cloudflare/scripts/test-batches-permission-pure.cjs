// Who may READ batch data, and who may WRITE it.
//
// The whole /api/batches router sat behind `inventory`. A cashier holding
// only 'pos' therefore got 403 on:
//
//   GET /api/batches/tracked-product-ids   (which products need a lot picker)
//   GET /api/batches?productId=&branchId=  (that product's lots)
//
// The POS frontend treats a failed tracked-ids fetch as "no product is
// batch-tracked" -- a deliberate non-blocking fallback so one bad request
// cannot wedge the till. Combined with the 403 that turned into something
// worse than an error: the lot picker never appeared, and the cashier sold
// batch-tracked stock WITHOUT choosing a lot. Silently bypassing
// FIFO/expiry selection, with nothing on screen to indicate it.
//
// Reading which lots exist is strictly less sensitive than the product and
// price data 'pos' already grants. Receiving or correcting batch stock is a
// stock adjustment and stays with 'inventory'.
//
// Run: node scripts/test-batches-permission-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

// Mirrors the router's gate.
function allows(method, perms) {
  const has = (key) => perms[key] === true
  const isRead = method === 'GET'
  return isRead
    ? (has('inventory') || has('pos') || has('sales'))
    : has('inventory')
}

const CASHIER = { pos: true, sales: true }
const STOCK_KEEPER = { inventory: true }
const SALES_ONLY = { sales: true }
const NOBODY = {}
const ADMIN = { inventory: true, pos: true, sales: true }

// --- the bug ------------------------------------------------------------

check('a cashier (pos only) CAN read tracked-product-ids and a lot list', () => {
  assert.equal(allows('GET', CASHIER), true)
  assert.equal(allows('GET', { pos: true }), true)
})

check('a cashier still CANNOT receive or correct batch stock', () => {
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    assert.equal(allows(method, CASHIER), false, `${method} must stay behind inventory`)
  }
})

// --- everyone else unchanged -------------------------------------------

check('inventory keeps full read AND write access', () => {
  assert.equal(allows('GET', STOCK_KEEPER), true)
  assert.equal(allows('POST', STOCK_KEEPER), true)
  assert.equal(allows('DELETE', STOCK_KEEPER), true)
})

check('sales-only can read (the Sales page shows lots on a receipt) but not write', () => {
  assert.equal(allows('GET', SALES_ONLY), true)
  assert.equal(allows('POST', SALES_ONLY), false)
})

check('a user with none of the three is refused entirely', () => {
  assert.equal(allows('GET', NOBODY), false)
  assert.equal(allows('POST', NOBODY), false)
})

check('an admin-equivalent grant is unaffected', () => {
  assert.equal(allows('GET', ADMIN), true)
  assert.equal(allows('POST', ADMIN), true)
})

// --- source guard -------------------------------------------------------

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'batches.ts'), 'utf8')

check('the router really does split read from write', () => {
  assert.match(src, /c\.req\.method === 'GET'/, 'the gate must distinguish reads')
  assert.match(src, /hasPermission\(user, 'pos'\)/, "reads must accept 'pos'")
  // The write branch must not have been widened along with the read branch.
  const writeBranch = src.slice(src.indexOf(': hasPermission(user'), src.indexOf(': hasPermission(user') + 60)
  assert.match(writeBranch, /'inventory'/, 'writes must still require inventory')
})

console.log(`\n${passed} batches-permission checks passed`)
