#!/usr/bin/env node
// The w-shift-close read-budget fixture must not depend on the hour it runs in. It opens and closes the shift at a pinned instant, and the close's last-activity look
// (shiftLastActivityMs) holds its window open to that instant + 1 day, so any row an EARLIER shape stamped with the real clock (one writes 4,240 NULL-branch fees)
// is read when the pinned instant is behind the real clock: from 16:00 to 17:00 UTC the old fixed 16:00 UTC instant is exactly that, and the close read 6,209 rows
// against a budget of 2,566 (gate runs 43902480865 and 43909325562). Production is not affected: a real close at time T can hold no row stamped after T.
'use strict'
const fs = require('fs')
const path = require('path')
const { seedContext } = require('./read-budget/seed.cjs')
const writes = require('./read-budget/writes.cjs')

let failures = 0
const check = (ok, message) => { if (!ok) { failures += 1; console.error('FAIL ' + message) } }

// The rule the fixture had on 1ae9f2041: the anchor date's 16:00 UTC, whatever the real clock says.
const baseInstant = (anchorDate) => Date.parse(anchorDate + 'T16:00:00Z')
const businessDate = (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10)

const clocks = ['15:00:00', '15:55:00', '16:00:01', '16:05:00', '16:30:00', '16:59:50', '17:05:00', '23:00:00', '00:30:00']
let baseBad = 0
for (const day of ['2026-11-16', '2026-11-17']) {
  for (const time of clocks) {
    const now = Date.parse(`${day}T${time}Z`)
    const anchorDate = seedContext(new Date(now)).anchorDate
    const pinned = writes.shiftCloseInstant(anchorDate, now)
    const label = `${day}T${time}Z`
    check(pinned >= now + 2000, `${label}: the pinned instant ${new Date(pinned).toISOString()} is not after the real clock, so a row stamped with the real time falls in the close window`)
    check(businessDate(pinned) === businessDate(now), `${label}: the pinned instant leaves the real business date (readCurrent would not find the shift)`)
    const hour = new Date(now).getUTCHours()
    if (hour < 16 || hour >= 17) check(pinned === baseInstant(anchorDate), `${label}: outside 16:00-17:00 UTC the instant must stay the anchor's 16:00 UTC, so the seed rows in the window do not change`)
    // Positive control: the old rule is behind the clock in exactly the 16:00-17:00 UTC band and nowhere else.
    const behind = baseInstant(anchorDate) < now + 2000
    if (behind) baseBad += 1
    check(behind === (hour === 16), `${label}: the old rule should be behind the real clock exactly in the 16:00 UTC hour (positive control), behind=${behind}`)
  }
}
check(baseBad === 8, `the positive control should find the old rule behind the clock at the 4 in-band clocks on each of 2 days (8), got ${baseBad}`)

const source = fs.readFileSync(path.join(__dirname, 'read-budget', 'writes.cjs'), 'utf8')
check(/world\.clockMs = shiftCloseInstant\(world\.ctx\.anchorDate, Date\.now\(\)\)/.test(source), 'the w-shift-close fixture must pin its clock with shiftCloseInstant(anchorDate, Date.now())')
check(!/world\.clockMs = Date\.parse\(world\.ctx\.anchorDate/.test(source), 'the fixed anchor-date instant must not come back')

if (failures) { console.error(`test-read-budget-shift-clock-pure: ${failures} failure(s)`); process.exitCode = 1 } else console.log('test-read-budget-shift-clock-pure: ok')
