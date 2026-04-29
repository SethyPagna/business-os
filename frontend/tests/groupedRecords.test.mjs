import assert from 'node:assert/strict'
import { buildTimeActionSections, getTimeGroupingMode } from '../src/utils/groupedRecords.mjs'

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
  assert.deepEqual(sections[0].ids, [1, 2])
  assert.equal(sections[0].groups.length, 2)
  assert.equal(sections[0].groups[0].label, 'closed')
})

if (failed > 0) {
  process.exitCode = 1
}
