// A received time without an offset is UTC, so a lot sorts, is labelled and starts a Stock Session line the same on every device.
import assert from 'node:assert/strict'
import { formatBatchReceivedDate } from '../src/utils/batchLabel.ts'
import { batchReceivedInstant, sortLotsForDisplay } from '../src/utils/lotDisplayOrder.ts'
import { defaultLotChoice, sessionLotChoices } from '../src/utils/stockSessionDraft.ts'

const supplier = { supplierId: null, supplierName: '' }
// Same day in Phnom Penh (17:00 and 19:00), written two ways: with a T and with a space.
const earlier = { id: 1, quantity: 5, received_at: '2026-10-10T10:00:00' }
const later = { id: 2, quantity: 5, received_at: '2026-10-10 12:00:00' }

const original = process.env.TZ
for (const zone of ['America/Los_Angeles', 'Pacific/Honolulu', 'Asia/Phnom_Penh', 'Pacific/Auckland', 'UTC']) {
  process.env.TZ = zone
  assert.equal(batchReceivedInstant(earlier), Date.UTC(2026, 9, 10, 10), `${zone}: a T timestamp with no offset is read as UTC`)
  assert.equal(batchReceivedInstant(earlier), batchReceivedInstant({ received_at: '2026-10-10 10:00:00' }), `${zone}: the T and space forms are one instant`)
  assert.equal(batchReceivedInstant({ received_at: null, lot_code: '10102026' }), Date.UTC(2026, 9, 10), `${zone}: a date-coded lot is midnight UTC`)
  assert.equal(formatBatchReceivedDate(earlier.received_at), '10/10/2026', `${zone}: the label names the Phnom Penh day`)
  assert.deepEqual(sortLotsForDisplay([earlier, later]).map((lot) => lot.id), [2, 1], `${zone}: newest received first`)
  for (const arrival of [[earlier, later], [later, earlier]]) {
    const remove = defaultLotChoice({ mode: 'remove', choices: sessionLotChoices('remove', arrival, supplier) })
    const set = defaultLotChoice({ mode: 'set', choices: sessionLotChoices('set', arrival, supplier) })
    assert.deepEqual([remove, set], [1, 2], `${zone}: Remove starts on the oldest lot and Set on the newest`)
  }
}
if (original === undefined) delete process.env.TZ
else process.env.TZ = original

console.log('PASS received times without an offset sort, label and default the same in five device time zones')
