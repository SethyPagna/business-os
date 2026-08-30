// The unified list-sort method (utils/listSort.ts + shared/SortChip.tsx):
// every list page declares typed sort fields, one visible chip control drives
// them, and this util does the ordering. These tests pin the contract the
// pages rely on: kind-aware comparison, stable ordering, blanks always last,
// direction defaults per kind, flip-on-reselect, and persistence hygiene.
import assert from 'node:assert/strict'
import { defaultDirectionFor, nextSortSpec, sortRecords, type SortField } from '../src/utils/listSort.ts'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

type Row = { id: number; name?: string | null; total?: number | null; at?: string | null }
const FIELDS: SortField<Row>[] = [
  { id: 'date', label: 'Date', kind: 'date', get: (row) => row.at },
  { id: 'total', label: 'Total', kind: 'number', get: (row) => row.total },
  { id: 'name', label: 'Name', kind: 'text', get: (row) => row.name },
]

runTest('number sort orders numerically, desc, blanks last', () => {
  const rows: Row[] = [
    { id: 1, total: 9 }, { id: 2, total: 100 }, { id: 3, total: null }, { id: 4, total: 20 },
  ]
  const out = sortRecords(rows, { field: 'total', direction: 'desc' }, FIELDS)
  assert.deepEqual(out.map((row) => row.id), [2, 4, 1, 3], 'desc by value with the blank row sinking to the end')
  const asc = sortRecords(rows, { field: 'total', direction: 'asc' }, FIELDS)
  assert.deepEqual(asc.map((row) => row.id), [1, 4, 2, 3], 'asc still sinks the blank row last')
})

runTest('text sort is case-insensitive and stable for ties', () => {
  const rows: Row[] = [
    { id: 1, name: 'banana' }, { id: 2, name: 'Apple' }, { id: 3, name: 'apple' }, { id: 4, name: '' },
  ]
  const out = sortRecords(rows, { field: 'name', direction: 'asc' }, FIELDS)
  assert.deepEqual(out.map((row) => row.id), [2, 3, 1, 4], 'Apple/apple tie keeps input order (stable); empty name sinks last')
})

runTest('date sort parses timestamps', () => {
  const rows: Row[] = [
    { id: 1, at: '2026-08-27 10:00' }, { id: 2, at: '2026-08-29 08:00' }, { id: 3, at: 'not-a-date' },
  ]
  const out = sortRecords(rows, { field: 'date', direction: 'desc' }, FIELDS)
  assert.deepEqual(out.map((row) => row.id), [2, 1, 3], 'newest first; unparseable date treated as blank, last')
})

runTest('an unknown field id returns the input order untouched', () => {
  const rows: Row[] = [{ id: 2 }, { id: 1 }]
  const out = sortRecords(rows, { field: 'removed_field', direction: 'asc' }, FIELDS)
  assert.deepEqual(out.map((row) => row.id), [2, 1], 'a persisted spec from a removed field must not throw or reorder')
})

runTest('direction defaults: dates/numbers start desc, text starts asc', () => {
  assert.equal(defaultDirectionFor('date'), 'desc')
  assert.equal(defaultDirectionFor('number'), 'desc')
  assert.equal(defaultDirectionFor('text'), 'asc')
})

runTest('nextSortSpec: new field takes its kind default; reselecting flips', () => {
  const start = { field: 'date', direction: 'desc' as const }
  const toName = nextSortSpec(start, 'name', FIELDS)
  assert.deepEqual(toName, { field: 'name', direction: 'asc' }, 'text field starts A->Z')
  const flipped = nextSortSpec(toName, 'name', FIELDS)
  assert.deepEqual(flipped, { field: 'name', direction: 'desc' }, 'tapping the active field flips direction')
  const toTotal = nextSortSpec(flipped, 'total', FIELDS)
  assert.deepEqual(toTotal, { field: 'total', direction: 'desc' }, 'number field starts biggest-first')
})

if (failed > 0) {
  process.exitCode = 1
  console.error(`\n${failed} listSort test(s) failed`)
} else {
  console.log('\nAll listSort tests passed')
}
