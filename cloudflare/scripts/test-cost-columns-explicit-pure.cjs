// Drift guard for the unknown-cost rule (owner, 14 Oct 2026): "if cost is 0$ then it is 0 for loss.
// if it is none, it should also be unknown."
//
// inventory_movements keeps four cost columns and products keeps two, every one DEFAULT 0 in
// 0001_init.sql. An INSERT that does not name a column stores 0 there, and 0 now means "free",
// not "nobody recorded it". So every INSERT must list its cost columns and say NULL when the cost
// is unknown; this test reads the Worker source and fails when one does not.
//
//   - inventory_movements: unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr
//   - products:            cost_price_usd, cost_price_khr
//
// Files outside the sale/return writer slice (S6) still have omissions. Each is allowlisted at its
// CURRENT count; a later slice that fixes its files must LOWER its entry (a lower real count than
// the allowlist fails too, so a stale entry cannot hide a regression). S6's own files are at 0.
//
// Run: node scripts/test-cost-columns-explicit-pure.cjs
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

const root = path.join(process.env.COST_S6_SRC_ROOT || path.join(__dirname, '..'), 'src')

const REQUIRED = {
  inventory_movements: ['unit_cost_usd', 'unit_cost_khr', 'total_cost_usd', 'total_cost_khr'],
  products: ['cost_price_usd', 'cost_price_khr'],
}

// Remaining omissions per file, by the slice that owns the file. Delete an entry when it reaches 0.
const ALLOWED_OMISSIONS = {
  // S5 (stock side): every movement INSERT is explicit now. The one products entry is the sibling-row insert in
  // routes/inventory.ts, whose column list is built from Object.keys(insertPayload) at run time; the scanner cannot
  // read it, but the payload spreads mirrorCostFields (cost_price_usd, cost_price_khr), so it is not a real omission.
  'routes/inventory.ts': { products: 1 },
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

// The column list of every `INSERT INTO <table> (...)`, skipping `${...}` template expressions so
// a conditional column like `${x ? ', branch_name' : ''}` is read as text, not as a closing paren.
function insertColumnLists(text, table) {
  const lists = []
  const marker = new RegExp(`INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+${table}\\b`, 'gi')
  let match
  while ((match = marker.exec(text))) {
    let at = marker.lastIndex
    while (/\s/.test(text[at])) at++
    if (text[at] !== '(') continue
    let depth = 0
    let list = ''
    for (; at < text.length; at++) {
      const ch = text[at]
      if (ch === '$' && text[at + 1] === '{') {
        let braces = 0
        for (; at < text.length; at++) {
          list += text[at]
          if (text[at] === '{') braces++
          if (text[at] === '}' && --braces === 0) break
        }
        continue
      }
      if (ch === '(') { depth++; if (depth === 1) continue }
      if (ch === ')') { depth--; if (depth === 0) break }
      list += ch
    }
    lists.push(list.replace(/\s+/g, ' ').trim())
  }
  return lists
}

function omissions(text, table) {
  return insertColumnLists(text, table).filter((list) => REQUIRED[table].some((column) => !new RegExp(`\\b${column}\\b`).test(list)))
}

const found = {}
for (const file of walk(root)) {
  const rel = path.relative(root, file).split(path.sep).join('/')
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  for (const table of Object.keys(REQUIRED)) {
    const bad = omissions(text, table)
    if (bad.length) (found[rel] ||= {})[table] = bad
  }
}

let checks = 0
const ok = (label) => { checks++; console.log(`PASS ${label}`) }

{
  // Controls first: the matcher flags an omission and accepts a full list, so a count of 0 is not vacuous.
  assert.equal(omissions('INSERT INTO inventory_movements(product_id,quantity,reason) VALUES (1,2,3)', 'inventory_movements').length, 1)
  assert.equal(omissions('INSERT INTO inventory_movements (product_id, unit_cost_usd, unit_cost_khr) VALUES (1,2,3)', 'inventory_movements').length, 1, 'a total column missing is still an omission')
  assert.equal(omissions('INSERT INTO inventory_movements (product_id, unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr) VALUES (1,2,3,4,5)', 'inventory_movements').length, 0)
  assert.equal(omissions("INSERT INTO inventory_movements (product_id${x ? ', branch_name' : ''}, quantity) VALUES (1,2)", 'inventory_movements').length, 1, 'a ${...} template inside the column list is read through')
  assert.equal(omissions("INSERT INTO inventory_movements (product_id${x ? ', branch_name' : ''}, unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr) VALUES (1)", 'inventory_movements').length, 0)
  assert.equal(omissions('INSERT INTO products (name, cost_price_usd, cost_price_khr) VALUES (1,2,3)', 'products').length, 0)
  assert.equal(omissions('INSERT INTO products (name, selling_price_usd) VALUES (1,2)', 'products').length, 1)
  assert.equal(omissions('INSERT INTO product_batches (variant_product_id) VALUES (1)', 'products').length, 0, 'a table whose name merely starts with products is not products')
  ok('the scanner flags an omitted cost column and reads through template expressions')
}

{
  const unexpected = []
  for (const [rel, byTable] of Object.entries(found)) {
    for (const [table, bad] of Object.entries(byTable)) {
      const allowed = (ALLOWED_OMISSIONS[rel] || {})[table] || 0
      if (bad.length > allowed) unexpected.push(`${rel} ${table}: ${bad.length} INSERT(s) omit a cost column (allowed ${allowed}): ${JSON.stringify(bad)}`)
    }
  }
  assert.deepEqual(unexpected, [], `every INSERT must list its cost columns (NULL when unknown):\n${unexpected.join('\n')}`)
  ok('no INSERT INTO inventory_movements / products omits a cost column beyond the allowlist')
}

{
  const stale = []
  for (const [rel, byTable] of Object.entries(ALLOWED_OMISSIONS)) {
    for (const [table, allowed] of Object.entries(byTable)) {
      const real = ((found[rel] || {})[table] || []).length
      if (real < allowed) stale.push(`${rel} ${table}: allowlisted ${allowed} but only ${real} omit now -- lower the entry`)
      if (real > 0 && allowed === 0) stale.push(`${rel} ${table}: allowlist says 0 but ${real} omit`)
    }
  }
  assert.deepEqual(stale, [], `the allowlist may only shrink, and must follow the source down:\n${stale.join('\n')}`)
  ok('the allowlist is exact (a fixed file cannot keep a stale budget)')
}

{
  const sliceSix = [
    'lib/saleTransitions.ts', 'lib/saleAmendments.ts', 'lib/saleBulkStatus.ts', 'lib/returnBulkAction.ts', 'lib/returnsStock.ts',
    'lib/saleLineAddition.ts', 'lib/productDelete.ts', 'lib/datedStockCountApply.ts', 'lib/stockInLineEdit.ts', 'lib/stockSession.ts',
    'lib/saleNotPaidStockRecovery.ts', 'routes/returns.ts', 'routes/batches.ts',
  ]
  for (const rel of sliceSix) {
    assert.ok(fs.existsSync(path.join(root, rel)), `${rel} exists`)
    assert.equal(ALLOWED_OMISSIONS[rel], undefined, `${rel} (sale/return writer slice) carries no allowlist entry`)
    assert.equal(found[rel], undefined, `${rel} lists every cost column on every INSERT`)
  }
  const writers = sliceSix.filter((rel) => insertColumnLists(fs.readFileSync(path.join(root, rel), 'utf8'), 'inventory_movements').length > 0)
  assert.ok(writers.length >= 11, `the slice files really contain movement writers (${writers.length})`)
  ok(`the ${writers.length} sale/return/stock writer files named by the slice are at zero omissions`)
}

console.log(`\nOK - ${checks} checks passed`)
