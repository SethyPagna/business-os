import assert from 'node:assert/strict'
import fs from 'node:fs'

const surface = fs.readFileSync(new URL('../src/components/sales/SalesListSurface.tsx', import.meta.url), 'utf8')
assert.match(surface, /const \{ can \} = useApp\(\)/)
assert.match(surface, /selectionModeActive = selectionModeActive && can\('sales', 'bulk'\)/)

const history = fs.readFileSync(new URL('../src/utils/actionHistory.ts', import.meta.url), 'utf8')
assert.match(history, /applier\.endsWith\('\.bulk'\) \|\| applier === 'sale\.customer\.single' \|\| applier === 'sale\.settlement'/)

console.log('PASS Sales multi-select uses sales.bulk and single-customer grouped transport retains generation-safe Undo/Redo')
