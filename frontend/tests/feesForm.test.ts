import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.resolve(here, relative), 'utf8')
const formSource = read('../src/components/fees/FeeForm.tsx')
const pageSource = read('../src/components/fees/FeesPage.tsx')

assert.match(formSource, /mod\.getSales\(\{ search: query, limit: 8 \}\)/, 'linked sales use the existing searchable sales endpoint')
assert.match(formSource, /receipt, customer, phone, product, SKU or barcode/, 'the picker tells staff which real sale fields are searchable')
assert.match(formSource, /rows\.filter\(\(sale\) => sale\.branch_id != null && branchCanSell\(sale\.branch_name\)\)/, 'only real Shop sales appear as link candidates')
assert.match(formSource, /set\('sale_id', String\(sale\.id\)\)[\s\S]*set\('branch_id', String\(sale\.branch_id\)\)/, 'choosing a sale carries its exact id and branch together')
assert.match(formSource, /Sale ID #\{selectedSale\.id\}/, 'the selected sale keeps its database id visible')
assert.match(formSource, /role="listbox"[\s\S]*role="option"/, 'the search results expose listbox semantics')
assert.doesNotMatch(formSource, /id="fee-sale-id"/, 'staff are not asked to type an unverified numeric sale id')
assert.match(formSource, /filter\(\(row\) => row\.is_active !== false && branchCanSell\(row\.name\)\)/, 'manual expenses offer only active exact Shop branches')
assert.match(formSource, /return \[\{ value: '', label: t\('select_branch'\) \|\| 'Select Shop' \}, \.\.\.options\]/, 'manual expenses cannot save an unassigned branch from the picker')
assert.match(formSource, /if \(amountsInvalid \|\| dateInvalid \|\| !form\.branch_id\.trim\(\)\) return/, 'the form refuses a manual expense until its Shop is selected')

assert.equal((pageSource.match(/Sale ID #\$\{fee\.sale_id\}/g) || []).length, 4, 'desktop and mobile expense rows display a linked sale id in both receipt and id-only cases')

console.log('PASS fee sale-link picker and Shop-only expense UI contract')
