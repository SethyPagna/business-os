// TZ-1: date stamps and batch dates read the business day (Asia/Phnom_Penh),
// never the device zone or the raw UTC date. Runs on a device that believes it
// is in Los Angeles, at an instant where the three disagree:
//   2026-09-24T18:30:00Z  =  25/09 01:30 Phnom Penh  =  24/09 UTC  =  24/09 11:30 LA
// so every assertion below fails on the old toISOString()/getDate() code.
process.env.TZ = 'America/Los_Angeles'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { todayStr } from '../src/utils/dateHelpers.ts'
import { formatBatchReceivedDate } from '../src/utils/batchLabel.ts'
import { formatBatchDate } from '../src/components/returns/helpers/returnOptions.ts'
import { downloadPortalBucketFile } from '../src/components/catalog/portalBucket.ts'

const INSTANT = '2026-09-24T18:30:00Z'
const FIXED = Date.parse(INSTANT)
const RealDate = Date

// Negative control: the device really is behind -- the old stamps said the 24th.
assert.equal(new RealDate(FIXED).getDate(), 24, 'control: device-local day is the 24th')
assert.equal(new RealDate(FIXED).toISOString().slice(0, 10), '2026-09-24', 'control: UTC day is the 24th')

class FixedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(FIXED)
    else super(...(args as [string | number]))
  }
  static now() { return FIXED }
}
;(globalThis as { Date: DateConstructor }).Date = FixedDate as unknown as DateConstructor

try {
  assert.equal(todayStr(), '2026-09-25', 'export stamp is the Phnom Penh day')

  // Batch received_at from D1 is UTC without an offset.
  assert.equal(formatBatchReceivedDate('2026-09-24 18:30:00'), '25/09/2026', 'batch received timestamp reads the Phnom Penh day')
  assert.equal(formatBatchReceivedDate('2026-09-24'), '24/09/2026', 'a date-only received_at stays literal')

  assert.equal(formatBatchDate('Thu, 24 Sep 2026 18:30:00 GMT'), '25/09/2026', 'parseable non-ISO batch date reads the Phnom Penh day')
  assert.equal(formatBatchDate('2026-09-24'), '24/09/2026', 'ISO date stays literal')

  // Portal list download filename.
  let downloadName = ''
  const g = globalThis as Record<string, unknown>
  g.document = {
    createElement: () => ({ set href(_v: string) {}, set download(v: string) { downloadName = v }, click() {} }),
    body: { appendChild() {}, removeChild() {} },
  }
  const RealURL = URL
  g.URL = Object.assign(function () {}, { createObjectURL: () => 'blob:x', revokeObjectURL() {} })
  try {
    downloadPortalBucketFile('x', 'My Shop')
  } finally {
    g.URL = RealURL
    delete g.document
  }
  assert.equal(downloadName, 'my-shop-list-2026-09-25.txt', 'portal list filename is stamped with the Phnom Penh day')
} finally {
  ;(globalThis as { Date: DateConstructor }).Date = RealDate
}

// Dashboard's export stamp lives inside the component; pin that it uses the
// same helper the assertions above exercise.
const dashboard = readFileSync(new URL('../src/components/dashboard/Dashboard.tsx', import.meta.url), 'utf8')
assert.match(dashboard, /const exportStamp = useMemo\(\(\) => todayStr\(\), \[\]\)/, 'Dashboard export stamp uses todayStr')
assert.doesNotMatch(dashboard, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/, 'Dashboard has no raw UTC day stamp')

console.log('PASS business-zone stamps under TZ=America/Los_Angeles (todayStr, batch labels, return batch dates, portal list file, Dashboard export)')
