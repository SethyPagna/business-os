// The live POS close does not carry the device's clock.
//
// Production shift 20 (2026-09-21) could not be ended from POS: closeShift
// stamped `closed_at: new Date().toISOString()` from the phone, and the Worker
// refused any instant even a second ahead of its own clock. The operator had
// to pick an earlier minute in the Shifts popup. Both halves of the fix are
// pinned here as wiring facts (the behaviour itself is proved against real
// SQL in cloudflare/scripts/test-shift-close-clock-skew-pure.cjs):
//
//   1. The POS transport sends NO closed_at unless the caller chose one, so the
//      server stamps the moment with the only clock that counts.
//   2. The historic close (Shifts popup) still sends the chosen time as typed
//      and still refuses a clearly future one client-side.
//   3. Parity: the Worker close and amend routes run the requested time
//      through the same clock-skew clamp, and a missing closed_at on the
//      close route means "now".
//
// Run: node tests/shiftCloseServerTime.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (p: string) => fs.readFileSync(path.join(here, '..', p), 'utf8')

const transport = read('src/api/shiftTransport.ts')
const worker = read('../cloudflare/src/routes/shifts.ts')

const section = (source: string, start: RegExp, end: RegExp) => {
  const from = source.search(start)
  assert.ok(from >= 0, `found ${start}`)
  const rest = source.slice(from)
  const to = rest.search(end)
  return to < 0 ? rest : rest.slice(0, to)
}

// 1. POS close: closed_at only when the caller chose one.
const posClose = section(transport, /export async function closeShift\(/, /export async function fetchShiftPolicy/)
assert.ok(!/closed_at: input\.closedAt \|\| new Date\(\)/.test(posClose), 'the POS close no longer fabricates a closing time from the device clock')
assert.match(posClose, /\.\.\.\(input\.closedAt \? \{ closed_at: input\.closedAt \} : \{\}\)/, 'an explicitly chosen closedAt is still forwarded')
assert.ok(!/new Date\(\)\.toISOString\(\)/.test(posClose), 'no device timestamp of any kind is sent on the live close')

// 2. Historic close keeps the chosen time and its client-side future guard.
const historic = section(transport, /export async function closeShiftById\(/, /export type ReopenShiftInput/)
assert.match(historic, /closed_at: input\.closedAt,/, 'the Shifts popup still sends the exact chosen time')
assert.match(historic, /shiftTimestampIsFuture\(input\.closedAt\)/, 'a clearly future chosen time is still refused before the network')

// 3. Worker parity: one clamp, applied on close and amend.
assert.match(worker, /const CLOCK_SKEW_TOLERANCE_MS = 5 \* 60_000/, 'tolerance is explicit')
assert.match(worker, /function withinServerClock\(requestedMs: number, now: number\): number \| null/, 'one helper decides skew versus future')
const closeRoute = section(worker, /app\.post\('\/:id\/close'/, /app\.post\('\/:id\/cancel'/)
assert.match(closeRoute, /body\.closed_at == null \|\| body\.closed_at === '' \? new Date\(now\)/, 'a missing closed_at means the server now')
assert.match(closeRoute, /withinServerClock\(parsedClosedAt\.getTime\(\), now\)/, 'the close route clamps the requested time')
assert.ok(!/parsedClosedAt\.getTime\(\) > now\)/.test(closeRoute), 'the zero-tolerance future check is gone from the close route')
const amendRoute = section(worker, /app\.patch\('\/:id'/, /export default app/)
assert.match(amendRoute, /withinServerClock\(utcMs\(requestedOpenedAt\), now\)/, 'amend clamps the opening time')
assert.match(amendRoute, /withinServerClock\(utcMs\(requestedClosedAt\), now\)/, 'amend clamps the closing time')

console.log('PASS shift close server time: POS sends no device clock, historic close keeps the chosen time, Worker clamps skew on close and amend')
