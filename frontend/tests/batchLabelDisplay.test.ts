// Z1a: a batch must read as its received DATE (mm/dd/yyyy) everywhere -- the
// date-derived MMDDYYYY lot code ("08242026") must NOT be shown verbatim where
// a date belongs (the user saw "Products page shows 08/28/2026 but batch
// details show 08242026"). A GENUINE custom lot code still renders as a code.
// Rule: dates render mm/dd/yyyy, lot codes render as codes, never interchanged.
//
// Run: node tests/batchLabelDisplay.test.ts

import assert from 'node:assert/strict'
import { batchDisplayLabel, lotCodeAsDate } from '../src/utils/batchLabel.ts'

let failed = 0
function check(name: string, fn: () => void): void {
  try { fn(); console.log('PASS', name) } catch (e) { failed += 1; console.error('FAIL', name); console.error(e) }
}

check('lotCodeAsDate decodes a valid MMDDYYYY code to mm/dd/yyyy', () => {
  assert.equal(lotCodeAsDate('08242026'), '08/24/2026')
  assert.equal(lotCodeAsDate('12032026'), '12/03/2026')
  assert.equal(lotCodeAsDate('01012025'), '01/01/2025')
})

check('lotCodeAsDate rejects non-date / malformed codes (they stay codes)', () => {
  assert.equal(lotCodeAsDate('LOT-A123'), null, 'a real custom code is not a date')
  assert.equal(lotCodeAsDate('13012026'), null, 'month 13 is not a date')
  assert.equal(lotCodeAsDate('02302026'), null, 'Feb 30 is not a date')
  assert.equal(lotCodeAsDate('1234567'), null, 'seven digits is not MMDDYYYY')
  assert.equal(lotCodeAsDate('123456789'), null, 'nine digits is not MMDDYYYY')
  assert.equal(lotCodeAsDate(''), null)
  assert.equal(lotCodeAsDate(null), null)
})

check('a date-derived lot code renders as its mm/dd/yyyy date, not the raw code', () => {
  // The exact production case: lot_code 08242026, received_at present.
  assert.equal(batchDisplayLabel({ id: 1, lot_code: '08242026', received_at: '2026-08-24 10:00:00' }), '08/24/2026')
  // No received_at: the code itself is decoded to the date.
  assert.equal(batchDisplayLabel({ id: 2, lot_code: '08242026', received_at: null }), '08/24/2026')
  // received_at wins over the code when they disagree (received_at is
  // authoritative -- e.g. a later correction).
  assert.equal(batchDisplayLabel({ id: 3, lot_code: '08242026', received_at: '2026-08-28 09:00:00' }), '08/28/2026')
})

check('a genuine custom lot code still renders AS a code', () => {
  assert.equal(batchDisplayLabel({ id: 4, lot_code: 'LOT-A123', received_at: '2026-08-24 10:00:00' }), 'LOT-A123')
})

check('no lot code falls back to the received date, then Batch n, then id', () => {
  assert.equal(batchDisplayLabel({ id: 5, lot_code: null, received_at: '2026-08-24 10:00:00' }), '08/24/2026')
  assert.equal(batchDisplayLabel({ id: 6, lot_code: null, batch_number: 3, received_at: null }), 'Batch 3')
  assert.equal(batchDisplayLabel({ id: 7, lot_code: null, batch_number: null, received_at: null }), 'Batch #7')
})

if (failed > 0) process.exitCode = 1
else console.log('\nAll batch-label display tests passed')
