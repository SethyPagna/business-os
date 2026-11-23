import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  LATE_CLOSE_PERMISSION, LATE_REASON_MAX, holdsLateClosePermission, isLateClose, lateCloseBounds, lateCloseIsoForTime, lateCloseTimeOnDay,
  lateReason, offersLateClose,
} from '../src/components/shifts/shiftLateClose.ts'

const fixturePath = path.join(import.meta.dirname, '..', '..', 'cloudflare', 'scripts', 'fixtures', 'shift-late-close-cases.json')
const cases = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))

assert.equal(LATE_REASON_MAX, 500)
assert.equal(LATE_CLOSE_PERMISSION, 'shift_close_forgotten')

for (const row of cases.isLateClose) assert.equal(isLateClose(row.businessDate, row.today), row.late, JSON.stringify(row))

for (const row of cases.bounds) {
  const got = lateCloseBounds(row.businessDate, cases.offsetMinutes)
  if (row.start === null) { assert.equal(got, null, JSON.stringify(row)); continue }
  assert.equal(new Date(got!.startMs).toISOString(), row.start)
  assert.equal(new Date(got!.lastSecondMs).toISOString(), row.lastSecond)
  assert.equal(new Date(got!.endExclusiveMs).toISOString(), row.endExclusive)
}

for (const row of cases.reason) {
  if (row.repeat) assert.equal(lateReason(row.repeat.repeat(row.times)) !== null, row.valid, `${row.times} characters`)
  else assert.equal(lateReason(row.input), row.reason, JSON.stringify(row))
}

for (const row of cases.permission) assert.equal(holdsLateClosePermission(row.merged, row.admin), row.allowed, JSON.stringify(row))

// The day-bounded picker: the shift's own Cambodia day, 23:59:59 at the latest, the same edge the Worker refuses past.
const day = lateCloseBounds('2026-11-22', cases.offsetMinutes)!
assert.equal(lateCloseTimeOnDay('2026-11-22', day.startMs), true, 'the first instant of the day')
assert.equal(lateCloseTimeOnDay('2026-11-22', day.lastSecondMs), true, '23:59:59 is the last accepted second')
assert.equal(lateCloseTimeOnDay('2026-11-22', day.endExclusiveMs), false, 'the next midnight is the next day')
assert.equal(lateCloseTimeOnDay('2026-11-22', day.startMs - 1000), false, 'the day before is outside')
assert.equal(lateCloseIsoForTime('2026-11-22', '23:59'), '2026-11-22T16:59:00.000Z')
assert.equal(lateCloseIsoForTime('2026-11-22', '00:00'), '2026-11-21T17:00:00.000Z')
assert.equal(lateCloseIsoForTime('2026-11-22', '24:00'), null, 'there is no 24:00 on the shift day')
assert.equal(lateCloseIsoForTime('22/11/2026', '10:00'), null)

// Who is offered the form: the opener, an administrator or a holder; nobody else.
const none = {}
assert.equal(offersLateClose({ isOwner: true, isAdministrator: false, merged: none }), true)
assert.equal(offersLateClose({ isOwner: false, isAdministrator: true, merged: none }), true)
assert.equal(offersLateClose({ isOwner: false, isAdministrator: false, merged: { shift_close_forgotten: true } }), true)
assert.equal(offersLateClose({ isOwner: false, isAdministrator: false, merged: { shift_close_forgotten: 'true' } }), false)
assert.equal(offersLateClose({ isOwner: false, isAdministrator: false, merged: none }), false)

console.log('shiftLateCloseParity: all checks passed')
