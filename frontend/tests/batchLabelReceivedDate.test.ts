import assert from 'node:assert/strict'
import { batchDisplayLabel, formatBatchReceivedDate } from '../src/utils/batchLabel.ts'

assert.equal(
  batchDisplayLabel({ id: 1, lot_code: 'ADJ09/02/2026', received_at: '2026-09-02' }),
  '02/09/2026',
  'authoritative received_at must not be hidden by a synthetic adjustment code',
)
assert.equal(
  batchDisplayLabel({ id: 2, lot_code: 'CUSTOM-LOT', received_at: '2026-09-03' }),
  '03/09/2026',
  'a genuine code is fallback-only when a valid received date exists',
)
assert.equal(batchDisplayLabel({ id: 3, lot_code: 'CUSTOM-LOT', received_at: null }), 'CUSTOM-LOT')

const originalTz = process.env.TZ
for (const zone of ['Pacific/Honolulu', 'Asia/Phnom_Penh', 'UTC']) {
  process.env.TZ = zone
  assert.equal(formatBatchReceivedDate('2026-09-02'), '02/09/2026', `date-only received_at remains stable in ${zone}`)
}
if (originalTz === undefined) delete process.env.TZ
else process.env.TZ = originalTz

assert.equal(formatBatchReceivedDate('2026-02-30'), null, 'invalid calendar dates are rejected')
assert.equal(formatBatchReceivedDate('2024-02-29'), '29/02/2024', 'valid leap days remain accepted')

console.log('PASS received-date label precedence and timezone stability')
