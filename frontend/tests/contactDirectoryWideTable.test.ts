// Owner (Sep 17 2026): "supplier page/section still not using excel style for
// the suppliers in large screens. these are part of previous sessions fixes."
//
// The wide table was never missing. `ContactTable` in contacts/shared.tsx has
// always rendered a `hidden ... md:block` spreadsheet beside a `md:hidden` card
// list, and Customers and Delivery both got it. SuppliersTab passed one opt-out
// prop, `cardsAtAllWidths`, which replaced that table's className with a bare
// 'hidden' -- so the directory the owner actually opens rendered cards at every
// width while the ledger recorded the rule as shipped. The earlier "supplier
// display" work had fixed the supplier INVOICE sections, which are different
// surfaces with the same word in their name.
//
// This test exists so that cannot happen quietly again. It pins the rule, the
// absence of any way to opt out of it, and -- the discriminating half -- that
// the card list is still there for phones, because "always show the table"
// would be just as wrong as "never show it".
//
// Run: node --experimental-strip-types frontend/tests/contactDirectoryWideTable.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

// Windows checkout, core.autocrlf=true: a pattern spanning two lines would
// otherwise fail on a pristine tree for a reason unrelated to the code.
const read = (file: string): string =>
  fs.readFileSync(new URL(`../src/components/contacts/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const shared = read('shared.tsx')

runTest('the shared contact table keeps a large-screen spreadsheet and a phone card list', () => {
  const tables = shared.match(/className="hidden overflow-x-auto rounded-xl border[^"]*\bmd:block"/g) || []
  assert.equal(tables.length, 2, 'both the skeleton and the real list render a md:block table')
  const cards = shared.match(/className="space-y-[23] md:hidden"/g) || []
  assert.equal(cards.length, 2, 'and each one still has its md:hidden card mirror for phones')
})

runTest('no call site can opt a directory out of the house layout', () => {
  // The prop is gone, not merely unused: a dead switch that turns off the
  // owner's rule is an invitation to turn it off again.
  assert.doesNotMatch(shared, /cardsAtAllWidths/, 'the cards-at-all-widths opt-out must not exist in the shared table')
  assert.doesNotMatch(shared, /cardGridClassName/, 'nor the grid class that only that opt-out used')
  for (const file of ['SuppliersTab.tsx', 'CustomersTab.tsx', 'DeliveryTab.tsx']) {
    assert.doesNotMatch(read(file), /cardsAtAllWidths/, `${file} must not switch itself off the wide table`)
  }
})

runTest('every contact directory renders through that one table, suppliers included', () => {
  for (const file of ['SuppliersTab.tsx', 'CustomersTab.tsx', 'DeliveryTab.tsx']) {
    const source = read(file)
    assert.match(source, /<ContactTable/, `${file}: the directory uses the shared table`)
    // Columns are what make it a spreadsheet rather than an empty grid, so a
    // surface that passes none would satisfy the line above and still be wrong.
    assert.match(source, /columns=\{/, `${file}: and hands it real columns`)
  }
  assert.match(
    read('SuppliersTab.tsx'),
    /const supplierColumns = \[[^\]]*'Name'[^\]]*'Phone'[^\]]*\]/,
    'the supplier columns were already defined -- only the opt-out was hiding them',
  )
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('All contactDirectoryWideTable tests passed')
}
