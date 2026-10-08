import assert from 'node:assert/strict'
import { defaultLotChoice, sessionLotChoices } from '../src/utils/stockSessionDraft.ts'

const supplier = { supplierId: null, supplierName: '' }
const lots = [
  { id: 1, quantity: 5, received_at: '2025-01-02' },
  { id: 2, quantity: 0, received_at: '2026-10-07' },
  { id: 3, quantity: 4, received_at: '2026-02-03' },
]
for (const mode of ['add', 'remove', 'set'] as const) {
  const choices = sessionLotChoices(mode, lots, supplier)
  assert.deepEqual(choices.map(lot => lot.id), mode === 'remove' ? [3, 1] : [2, 3, 1], `${mode}: all eligible years newest first`)
  if (mode === 'remove') assert.equal(defaultLotChoice({ mode, choices }), 1, 'Remove preserves oldest default')
  if (mode === 'set') assert.equal(defaultLotChoice({ mode, choices }), 2, 'Set preserves newest default including empty lots')
  assert.equal(defaultLotChoice({ mode, choices, sheetBatchId: 3 }), 3, 'explicit selection wins')
  if (mode !== 'add') assert.equal(defaultLotChoice({ mode, choices, sharedDate: '2025-01-02' }), 1, 'shared date wins')
}
assert.equal(defaultLotChoice({ mode: 'remove', choices: [...lots].reverse() }), 1, 'default is independent of display order')
assert.equal(defaultLotChoice({ mode: 'set', choices: lots }), 2, 'newest is independent of input order')
console.log('PASS mixed-year received dates, eligibility, explicit selection and independent defaults')
