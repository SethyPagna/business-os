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
  // Lot 2 is the newest but empty: the start skips it while a stocked lot exists (stockSessionDefaultLot.test.ts has the full table).
  if (mode === 'set') assert.equal(defaultLotChoice({ mode, choices }), 3, 'Set starts on the newest lot that holds stock, not the empty newest one')
  assert.equal(defaultLotChoice({ mode, choices, sheetBatchId: 3 }), 3, 'explicit selection wins')
  if (mode !== 'add') assert.equal(defaultLotChoice({ mode, choices, sharedDate: '2025-01-02' }), 1, 'shared date wins')
}
assert.equal(defaultLotChoice({ mode: 'remove', choices: [...lots].reverse() }), 1, 'default is independent of display order')
assert.equal(defaultLotChoice({ mode: 'set', choices: lots }), 3, 'newest stocked lot is independent of input order')
const undatedLots = [lots[0], { id: 4, quantity: 2 }, lots[2], { id: 5, quantity: 3, received_at: '' }, lots[1]]
for (const mode of ['add', 'remove', 'set'] as const) {
  assert.deepEqual(sessionLotChoices(mode, undatedLots, supplier).map(lot => lot.id),
    mode === 'remove' ? [3, 1, 4, 5] : [2, 3, 1, 4, 5], `${mode}: undated lots follow all dates in stable order`)
}
console.log('PASS mixed-year received dates, eligibility, explicit selection and independent defaults')

// Two lots received on the SAME business day, hours apart (02:00Z and 10:00Z are 09:00 and 17:00 in Cambodia). The list is
// newest received first by the full timestamp, not by the day alone, whichever order the Worker sends them in.
const morning = { id: 6, quantity: 3, received_at: '2026-09-01 02:00:00' }
const evening = { id: 7, quantity: 3, received_at: '2026-09-01 10:00:00' }
const earlierDay = { id: 8, quantity: 3, received_at: '2026-08-31 23:00:00' }
for (const incoming of [[morning, evening, earlierDay], [earlierDay, evening, morning], [evening, earlierDay, morning]]) {
  for (const mode of ['add', 'remove', 'set'] as const) {
    assert.deepEqual(sessionLotChoices(mode, incoming, supplier).map(lot => lot.id), [7, 6, 8], `${mode}: same-day lots are newest received first, ${incoming.map(lot => lot.id).join(',')}`)
  }
  // The starting lot is not a function of the new display order: Remove still starts on the oldest, Set on the newest.
  assert.equal(defaultLotChoice({ mode: 'remove', choices: sessionLotChoices('remove', incoming, supplier) }), 8, 'Remove starts on the oldest lot')
  assert.equal(defaultLotChoice({ mode: 'set', choices: sessionLotChoices('set', incoming, supplier) }), 7, 'Set starts on the newest lot')
}
// Same day only: the oldest of the day is Remove's start, the latest of the day is Set's, whatever the arrival order.
for (const sameDay of [[morning, evening], [evening, morning]]) {
  const removeChoices = sessionLotChoices('remove', sameDay, supplier)
  const setChoices = sessionLotChoices('set', sameDay, supplier)
  assert.equal(defaultLotChoice({ mode: 'remove', choices: removeChoices }), 6, 'Remove starts on the earlier lot of the day, not the first listed')
  assert.equal(defaultLotChoice({ mode: 'set', choices: setChoices }), 7, 'Set starts on the later lot of the day')
}
console.log('PASS same-day lots are newest received first and the starting lot does not follow the display order')
