// Supplier AP ledger Branch filter (readiness G-M follow-up): options follow the
// branch rows, the API value stays the legacy literal the Worker accepts, and
// the mapping goes through canonical_key, never through a branch name.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { apInvoiceBranchOptions, apInvoiceRecordedBranchLabel } from '../src/utils/apInvoiceBranches.ts'

let failed = 0
function runTest(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}
const labels = { shop: 'Shop', warehouse: 'Warehouse', inactive: 'Inactive' }
const km = { shop: 'ហាង', warehouse: 'ឃ្លាំង', inactive: 'អសកម្ម' }
const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')

const TODAY = [
  { name: 'Shop', canonical_key: 'shop', is_active: 1 },
  { name: 'Warehouse', canonical_key: 'warehouse', is_active: 1 },
]
// the end state: the Warehouse row is renamed, the Shop row retired and renamed
const AFTER = [
  { name: 'Old Shop', canonical_key: 'shop', is_active: 0 },
  { name: 'LC Store', canonical_key: 'warehouse', is_active: 1 },
]

runTest('today: both legacy literals, the pack words, order unchanged (warehouse then shop)', () => {
  assert.deepEqual(apInvoiceBranchOptions(TODAY, labels), [{ value: 'warehouse', label: 'Warehouse' }, { value: 'shop', label: 'Shop' }])
  assert.deepEqual(apInvoiceBranchOptions(TODAY, km).map((o) => o.label), ['ឃ្លាំង', 'ហាង'], 'default names read in the pack language, as before')
})

runTest('after the cutover: names come from the rows, values stay the literals the Worker filters on, the retired one is tagged', () => {
  assert.deepEqual(apInvoiceBranchOptions(AFTER, labels), [{ value: 'warehouse', label: 'LC Store' }, { value: 'shop', label: 'Old Shop (Inactive)' }])
  assert.equal(apInvoiceBranchOptions(AFTER, km)[1].label, 'Old Shop (អសកម្ម)')
})

runTest('the value comes from canonical_key, never from the name: a misleading name cannot swap the literals', () => {
  const swappedNames = [{ name: 'Shop', canonical_key: 'warehouse', is_active: 1 }, { name: 'Warehouse', canonical_key: 'shop', is_active: 0 }]
  assert.deepEqual(apInvoiceBranchOptions(swappedNames, labels), [
    { value: 'warehouse', label: 'Shop' }, { value: 'shop', label: 'Warehouse (Inactive)' },
  ])
})

runTest('rows without a canonical_key (identity backfill not applied) and not-loaded rows give today\'s legacy filter', () => {
  const legacy = [{ name: 'Shop', canonical_key: null, is_active: 1 }, { name: 'Warehouse', canonical_key: null, is_active: 1 }]
  for (const rows of [legacy, null, undefined, [], [{ name: 'Depot', canonical_key: null }]]) {
    assert.deepEqual(apInvoiceBranchOptions(rows, labels), [{ value: 'warehouse', label: 'Warehouse' }, { value: 'shop', label: 'Shop' }])
  }
})

runTest('a branch with no canonical identity is never invented into an option; a lone canonical row gives one option', () => {
  const rows = [{ name: 'Kiosk', canonical_key: null, is_active: 1 }, { name: 'LC Store', canonical_key: 'warehouse', is_active: 1 }]
  assert.deepEqual(apInvoiceBranchOptions(rows, labels), [{ value: 'warehouse', label: 'LC Store' }])
})

runTest('an invoice keeps the origin it was recorded with: never relabelled to the current branch name', () => {
  assert.equal(apInvoiceRecordedBranchLabel('warehouse', labels), 'Warehouse')
  assert.equal(apInvoiceRecordedBranchLabel('shop', labels), 'Shop')
})

runTest('the Worker still accepts only the legacy literals (if this changes, the mapping must be revisited)', () => {
  const worker = read('../../cloudflare/src/routes/contacts.ts')
  assert.match(worker, /if \(branch === 'warehouse' \|\| branch === 'shop'\) \{\s*conditions\.push\('si\.source_branch = @branch'\)/)
  assert.match(read('../../cloudflare/migrations/0223_branch_lifecycle_identity.sql'), /canonical_key TEXT CHECK \(canonical_key IS NULL OR canonical_key IN \('shop', 'warehouse'\)\)/, 'canonical_key is constrained to the same two literals')
})

runTest('the section builds its filter from the helper, with no literal Shop/Warehouse options left', () => {
  const section = read('../src/components/contacts/ApInvoicesSection.tsx')
  assert.match(section, /const branchFilterOptions = apInvoiceBranchOptions\(branchRows, apBranchLabels\)/)
  assert.match(section, /\.\.\.branchFilterOptions,/)
  assert.doesNotMatch(section, /\{ value: 'warehouse', label:/)
  assert.doesNotMatch(section, /\{ value: 'shop', label:/)
  assert.match(section, /const branchLabel = \(value: string\): string => apInvoiceRecordedBranchLabel\(value, apBranchLabels\)/)
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
