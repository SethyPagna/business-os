import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  countVisible,
  defaultVisibleColumns,
  parseStoredColumns,
  RENAMED_COLUMN_KEYS,
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

// RET-A verify R3: the reports' "Not Paid" column key was renamed
// pending_revenue_usd -> pending_owed_usd. A user who had turned it on keeps it.
const reportColumns: TableColumnDef[] = [
  { key: 'revenue_usd', label: 'Revenue' },
  { key: 'pending_owed_usd', label: 'Not Paid', defaultVisible: false },
]
assert.deepEqual([...parseStoredColumns('["revenue_usd","pending_revenue_usd"]', reportColumns)!].sort(), ['pending_owed_usd', 'revenue_usd'],
  'a remembered old key turns the renamed column on')
assert.deepEqual([...parseStoredColumns('["revenue_usd","pending_revenue_usd"]', reportColumns, {})!], ['revenue_usd'],
  'CONTROL: without the rename map the choice is silently dropped (the bug)')
assert.deepEqual([...parseStoredColumns('["pending_revenue_usd"]', [{ key: 'pending_revenue_usd', label: 'old' }, { key: 'pending_owed_usd', label: 'new' }])!],
  ['pending_revenue_usd'], 'a surface that still has the old key keeps it as it is')
assert.deepEqual([...parseStoredColumns('["pending_revenue_usd"]', columns)!], [], 'a surface with neither key drops it')
assert.deepEqual([...parseStoredColumns('["constructor","toString"]', reportColumns)!], [], 'only own rename entries count')
// Every report surface that shows the renamed column really uses the new key.
for (const file of ['GroupedReport', 'OverviewReport', 'PeriodReport', 'SalesListReport']) {
  const source = readFileSync(new URL(`../src/components/sales/reports/${file}.tsx`, import.meta.url), 'utf8')
  assert.ok(source.includes(`key: '${RENAMED_COLUMN_KEYS.pending_revenue_usd}'`) && !source.includes("key: 'pending_revenue_usd'"), `${file} uses the renamed key`)
}
console.log('PASS a renamed column key carries a remembered choice to the new key')
