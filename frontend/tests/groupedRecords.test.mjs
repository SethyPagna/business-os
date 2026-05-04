import assert from 'node:assert/strict'
import { buildAlphabetActionSections, buildTimeActionSections, getAlphabetInitialSection, getTimeGroupingMode } from '../src/utils/groupedRecords.mjs'

let failed = 0

async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('getTimeGroupingMode escalates from year to month to day based on filters', () => {
  assert.equal(getTimeGroupingMode('all', 'all'), 'year')
  assert.equal(getTimeGroupingMode('2026', 'all'), 'month')
  assert.equal(getTimeGroupingMode('2026', '4'), 'day')
})

await runTest('buildTimeActionSections builds day sections with subgroup ids', () => {
  const rows = [
    { id: 1, created_at: '2026-04-29T01:00:00Z', status: 'open' },
    { id: 2, created_at: '2026-04-29T10:00:00Z', status: 'closed' },
    { id: 3, created_at: '2026-04-28T08:00:00Z', status: 'open' },
  ]

  const sections = buildTimeActionSections(rows, {
    getDate: (row) => row.created_at,
    getItemId: (row) => row.id,
    getActionKey: (row) => row.status,
    getActionLabel: (row) => row.status,
    year: '2026',
    month: '4',
    timeMode: 'day',
  })

  assert.equal(sections.length, 2)
  assert.deepEqual(sections[0].ids, [2, 1])
  assert.equal(sections[0].groups.length, 2)
  assert.equal(sections[0].groups[0].label, 'closed')
  assert.deepEqual(sections[0].groups[0].ids, [2])
  assert.deepEqual(sections[0].groups[1].ids, [1])
})

await runTest('buildTimeActionSections accepts database timestamps with spaces', () => {
  const sections = buildTimeActionSections([
    { id: 1, created_at: '2026-05-04 22:15:57', status: 'purchase' },
  ], {
    getDate: (row) => row.created_at,
    getItemId: (row) => row.id,
    getActionKey: (row) => row.status,
    getActionLabel: (row) => row.status,
    timeMode: 'year',
  })

  assert.equal(sections.length, 1)
  assert.equal(sections[0].label, '2026')
  assert.notEqual(sections[0].label, 'Unknown year')
})

await runTest('buildTimeActionSections keeps malformed movement dates in unknown bucket', () => {
  const sections = buildTimeActionSections([
    { id: 1, created_at: 'not-a-date', status: 'purchase' },
  ], {
    getDate: (row) => row.created_at,
    getItemId: (row) => row.id,
    getActionKey: (row) => row.status,
    getActionLabel: (row) => row.status,
    timeMode: 'year',
  })

  assert.equal(sections.length, 1)
  assert.equal(sections[0].label, 'Unknown year')
})

await runTest('buildAlphabetActionSections supports Latin and Khmer contact initials', () => {
  const rows = [
    { id: 1, name: 'Sokha' },
    { id: 2, name: 'ក្រុមហ៊ុន ខ្មែរ' },
    { id: 3, name: 'Alpha' },
    { id: 4, name: 'សុភា' },
  ]
  const sections = buildAlphabetActionSections(rows, {
    getName: (row) => row.name,
    getItemId: (row) => row.id,
  })

  assert.equal(getAlphabetInitialSection('ក្រុមហ៊ុន ខ្មែរ'), 'ក')
  assert.deepEqual(sections.map((section) => section.label), ['A', 'S', 'ក', 'ស'])
  assert.deepEqual(sections[0].ids, [3])
})

if (failed > 0) {
  process.exitCode = 1
}
