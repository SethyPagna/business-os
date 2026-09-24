import assert from 'node:assert/strict'
import { buildAuditFieldDiff, formatAuditFieldLabel } from '../src/utils/auditLogFieldDiff.ts'

let failed = 0
type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('formatAuditFieldLabel turns snake_case and camelCase into Title Case', () => {
  assert.equal(formatAuditFieldLabel('selling_price_usd'), 'Selling Price Usd')
  assert.equal(formatAuditFieldLabel('membershipNumber'), 'Membership Number')
})

await runTest('buildAuditFieldDiff only returns fields that actually changed', () => {
  const before = JSON.stringify({ name: 'Widget', price: 10, notes: 'old note' })
  const after = JSON.stringify({ name: 'Widget', price: 12, notes: 'old note' })
  const rows = buildAuditFieldDiff(before, after)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].key, 'price')
  assert.equal(rows[0].before, '10')
  assert.equal(rows[0].after, '12')
  assert.equal(rows[0].changeType, 'changed')
})

// Sep 23 2026: this used to assert 'added' for every field. A row with no
// old side has nothing to have been added TO -- and the same shape is what a
// legacy details-only row has, where "added" was an outright false claim
// (the owner's E4 report: a rename showing From/Rows/To as three additions).
// Both read as context now; see the delete case below, which still reports
// 'removed', for why this is not a blanket retreat from the vocabulary.
await runTest('buildAuditFieldDiff reports a one-sided payload (a create, a legacy details row) as context', () => {
  const rows = buildAuditFieldDiff(null, JSON.stringify({ name: 'New Customer', gender: 'female' }))
  assert.equal(rows.length, 2)
  assert.ok(rows.every((row) => row.changeType === 'context'))
  assert.ok(rows.every((row) => row.before === null))
  assert.deepEqual(rows.map((row) => row.key).sort(), ['gender', 'name'])
})

await runTest('buildAuditFieldDiff still reports a key added on the new side of a real pair', () => {
  const rows = buildAuditFieldDiff(JSON.stringify({ name: 'A' }), JSON.stringify({ name: 'A', notes: 'later' }))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].changeType, 'added')
})

await runTest('buildAuditFieldDiff marks a delete (no after) as all-removed fields', () => {
  const rows = buildAuditFieldDiff(JSON.stringify({ name: 'Old Supplier', phone: '012345' }), null)
  assert.equal(rows.length, 2)
  assert.ok(rows.every((row) => row.changeType === 'removed'))
})

await runTest('buildAuditFieldDiff ignores bookkeeping columns', () => {
  const before = JSON.stringify({ id: 1, created_at: '2026-01-01', name: 'A' })
  const after = JSON.stringify({ id: 1, created_at: '2026-01-02', updated_at: '2026-01-02', name: 'B' })
  const rows = buildAuditFieldDiff(before, after)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].key, 'name')
})

await runTest('buildAuditFieldDiff flattens ARRAYS into one readable line', () => {
  const before = JSON.stringify({ items: [{ name: 'Item A', qty: 1 }] })
  const after = JSON.stringify({ items: [{ name: 'Item A', qty: 2 }] })
  const rows = buildAuditFieldDiff(before, after)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].after, 'Name: Item A, Qty: 2')
  assert.equal(rows[0].depth, 0)
})

// An OBJECT is a set of fields, so it becomes rows; the depth/label contract
// and the cap are pinned in auditDetailContext.test.ts beside the renderer.
await runTest('buildAuditFieldDiff expands a nested object into its own rows', () => {
  const rows = buildAuditFieldDiff(
    JSON.stringify({ address: { city: 'Phnom Penh', street: 'St 271' } }),
    JSON.stringify({ address: { city: 'Siem Reap', street: 'St 271' } }),
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].label, 'Address - City')
  assert.equal(rows[0].depth, 1)
})

await runTest('buildAuditFieldDiff formats booleans as Yes/No', () => {
  const rows = buildAuditFieldDiff(JSON.stringify({ is_active: false }), JSON.stringify({ is_active: true }))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].before, 'No')
  assert.equal(rows[0].after, 'Yes')
})

await runTest('buildAuditFieldDiff returns empty when neither side is parseable JSON', () => {
  assert.deepEqual(buildAuditFieldDiff('not json', 'also not json'), [])
  assert.deepEqual(buildAuditFieldDiff(null, undefined), [])
})

console.log(failed === 0 ? 'auditLogFieldDiff tests passed' : `auditLogFieldDiff tests: ${failed} failed`)
if (failed > 0) process.exit(1)
