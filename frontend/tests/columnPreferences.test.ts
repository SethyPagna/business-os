import assert from 'node:assert/strict'
import {
  countVisible,
  defaultVisibleColumns,
  parseStoredColumns,
  toggleColumn,
  type TableColumnDef,
} from '../src/components/shared/columnPreferences.ts'

const columns: TableColumnDef[] = [
  { key: 'status', label: 'Status' },                    // default shown
  { key: 'cashier', label: 'Cashier', defaultVisible: false },
  { key: 'branch', label: 'Branch', defaultVisible: false },
]

// defaults: everything except explicitly-hidden columns
assert.deepEqual([...defaultVisibleColumns(columns)].sort(), ['status'])

// nothing stored -> null (so the hook falls back to defaults)
assert.equal(parseStoredColumns(null, columns), null)
assert.equal(parseStoredColumns('not json', columns), null)
assert.equal(parseStoredColumns('{"a":1}', columns), null)

// a stored EMPTY array is honored (hide every optional column), not treated as "unset"
const empty = parseStoredColumns('[]', columns)
assert.ok(empty instanceof Set && empty.size === 0)

// stored set is intersected against known columns (a renamed/removed key is dropped)
assert.deepEqual([...parseStoredColumns('["status","branch","gone"]', columns)!].sort(), ['branch', 'status'])

// toggling adds then removes, without mutating the input
const base = new Set(['status'])
const added = toggleColumn(base, 'cashier')
assert.deepEqual([...added].sort(), ['cashier', 'status'])
assert.deepEqual([...base], ['status'], 'toggleColumn must not mutate its input')
assert.deepEqual([...toggleColumn(added, 'status')].sort(), ['cashier'])

// countVisible only counts declared columns that are on
assert.equal(countVisible(columns, new Set(['status', 'cashier', 'ghost'])), 2)

console.log('PASS column-preference helpers: defaults, storage parse, toggle immutability, count')
