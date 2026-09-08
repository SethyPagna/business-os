import assert from 'node:assert/strict'
import fs from 'node:fs'

const surface = fs.readFileSync(new URL('../src/components/sales/SalesListSurface.tsx', import.meta.url), 'utf8')
assert.match(surface, /const \{ can \} = useApp\(\)/)
assert.match(surface, /selectionModeActive = selectionModeActive && can\('sales', 'bulk'\)/)

const sales = fs.readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')
assert.match(sales, /const canBulkSales = can\('sales', 'bulk'\)/)
assert.match(sales, /const selectionModeActive = canBulkSales && selectedIds\.size > 0/)
assert.match(sales, /const toggleSelected = \([^)]*\) => \{\s*if \(!canBulkSales\) return/)
assert.match(sales, /const toggleSelectionScope = useCallback\([^]*?if \(!canBulkSales\) return[^]*?\}, \[canBulkSales\]\)/)
assert.match(sales, /if \(canBulkSales\) return[^]*?setSelectedIds\(new Set<number>\(\)\)[^]*?current\?\.mode === 'bulk'/)
assert.match(sales, /\{canBulkSales && pendingBulkRequest \? \(/)
assert.match(sales, /\{canBulkSales && pendingBulkFieldRequest \? \(/)
assert.match(sales, /\{canBulkSales && selectedSales\.length > 0 \? \(/)
assert.match(sales, /\{canBulkSales && bulkChangePrompt \? \(/)
assert.equal((sales.match(/await getSalesCustomerPicker\(/g) || []).length, 2, 'initial and searched customer choices use the narrow picker')
assert.doesNotMatch(sales, /await getCustomers\(/)
assert.ok((sales.match(/if \(!canBulkSales\) return/g) || []).length >= 5, 'selection and every bulk request entry point fail closed')

const history = fs.readFileSync(new URL('../src/utils/actionHistory.ts', import.meta.url), 'utf8')
assert.match(history, /applier\.endsWith\('\.bulk'\) \|\| applier === 'sale\.customer\.single' \|\| applier === 'sale\.settlement'/)

console.log('PASS Sales multi-select uses sales.bulk and single-customer grouped transport retains generation-safe Undo/Redo')
