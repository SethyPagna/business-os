// Owner rule: the Dashboard's busy-hour labels use the 24-hour clock ("17:00"),
// never "5 PM". Evaluates the real helper out of Dashboard.tsx.
// Run (from frontend/): node tests/dashboardHourLabel24h.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

const source = fs.readFileSync(new URL('../src/components/dashboard/Dashboard.tsx', import.meta.url), 'utf8')
const match = source.match(/function formatDashboardHourLabel\([\s\S]*?\r?\n\}/)
assert.ok(match, 'formatDashboardHourLabel exists')
const format = new Function(`${stripTypeScriptTypes(match[0])}; return formatDashboardHourLabel`)() as (hour: unknown) => string

assert.deepEqual([0, 5, 12, 17, 23].map(format), ['00:00', '05:00', '12:00', '17:00', '23:00'])
assert.equal(format(24), '00:00')
assert.equal(format(-1), '23:00')
assert.equal(format('9'), '09:00')
assert.doesNotMatch([...Array(24).keys()].map(format).join(' '), /AM|PM/)
console.log('PASS Dashboard hour labels are 24-hour')
