import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// K5 / 9.2 (Part 421): the auto-merged facet -- wiring pins that keep the
// flag/filter/record visible end to end. The section builder is JSX
// (.tsx), which plain node cannot import -- same reason
// productMenuHelpers.ts stays JSX-free -- so its contract is pinned from
// source like CreatedDateFilterOptions' is.

let failed = 0

type TestCallback = () => void

function runTest(name: string, fn: TestCallback): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const sectionSource = readFileSync(new URL('../src/components/products/AutoMergedFilterOptions.tsx', import.meta.url), 'utf8')

runTest('9.2: the section is a real two-state facet whose chip clears back to all', () => {
  assert.match(sectionSource, /id: 'auto_merged',/)
  assert.match(sectionSource, /const active = mergedFilter === 'auto'/)
  // the chip clears back to 'all' -- never to an empty string the server
  // would read differently. The section renders both options through the one
  // setter (clicking 'all' clears); Products' clear-all also calls
  // setMergedFilter('all') (asserted below), so 'all' is the only reset value.
  assert.match(sectionSource, /onClick=\{\(\) => setMergedFilter\(value\)\}/)
  // both options render through the one setter
  assert.match(sectionSource, /\['all', T\('all', 'All'\)\],\s+\['auto', activeLabel\],/)
})

const helpersSource = readFileSync(new URL('../src/components/products/helpers/productMenuHelpers.ts', import.meta.url), 'utf8')
const productsSource = readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')

runTest('9.2: the menu splices the section and Products sends the server-side param', () => {
  assert.match(helpersSource, /mergedSection\?: FilterSection \| null/)
  assert.match(helpersSource, /mergedSection \? mergedSection : null,/)
  // server-side facet param, same contract as promo (holds across pages)
  assert.match(productsSource, /merged: mergedFilter === 'all' \? '' : mergedFilter,/)
  assert.match(productsSource, /mergedSection: buildAutoMergedFilterSection\(\{/)
  // the loader re-runs when the facet changes, and clear-all resets it
  assert.match(productsSource, /issueFilter, mergedFilter, notify/)
  assert.match(productsSource, /setPromoFilter\('all'\)\s+setMergedFilter\('all'\)/)
})

if (failed > 0) {
  process.exitCode = 1
}
