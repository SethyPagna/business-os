import assert from 'node:assert/strict'
import { closeShift, openShift, shiftClosingCounts, shiftCountPairBlocker, shiftOpeningCounts } from '../src/api/shiftTransport.ts'
import {
  __resetApiHealthForTests,
  __resetApiWriteDedupeForTests,
  getSyncServerUrl,
  setSyncServerUrl,
} from '../src/api/http.ts'

let checks = 0
const equal = (actual: unknown, expected: unknown, message: string) => {
  assert.deepEqual(actual, expected, message)
  checks += 1
}

equal(shiftClosingCounts('', ''), { usd: null, khr: null }, 'two blank currencies are both unmeasured')
equal(shiftClosingCounts('12.50', ''), { usd: 12.5, khr: null }, 'a blank KHR field stays unmeasured')
equal(shiftClosingCounts('  ', '120000'), { usd: null, khr: 120_000 }, 'whitespace USD stays unmeasured')
equal(shiftClosingCounts(null, undefined), { usd: null, khr: null }, 'absent currencies stay unmeasured')
equal(shiftClosingCounts('0', 0), { usd: 0, khr: 0 }, 'explicit zeros remain measured zeros')
equal(shiftOpeningCounts('', '0'), { usd: null, khr: 0 }, 'opening blank stays unknown while explicit zero stays measured')
equal(shiftOpeningCounts('12.50', ''), { usd: 12.5, khr: null }, 'opening currencies are independently optional')
equal(shiftCountPairBlocker('', '120000', { blankMeansUncounted: true }), null,
  'one measured currency is enough to close')
equal(shiftCountPairBlocker('', '', { blankMeansUncounted: true }), null,
  'an entirely uncounted drawer never blocks close')
equal(shiftCountPairBlocker('', 'bad', { blankMeansUncounted: true }), 'invalid',
  'invalid text remains a blocker')

const originalFetch = globalThis.fetch
const originalServerUrl = getSyncServerUrl()
const postedBodies: Array<Record<string, unknown>> = []
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  postedBodies.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>)
  return new Response(JSON.stringify({
    shift: null,
    policy: { scope_mode: 'per_account', admin_exempt: true },
    exempt: false,
    needs_registration: false,
    is_open: false,
    can_end: false,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}) as typeof fetch

try {
  __resetApiHealthForTests()
  __resetApiWriteDedupeForTests()
  setSyncServerUrl('https://sync.example.test')
  const counts = shiftClosingCounts('', '120000')
  await closeShift({
    branchId: 2,
    closingCountedUsd: counts.usd,
    closingCountedKhr: counts.khr,
  })
  const posted = postedBodies.at(-1)
  equal(posted?.closing_counted_usd, null, 'transport posts blank USD as null')
  equal(posted?.closing_counted_khr, 120_000, 'transport posts measured KHR unchanged')
  const opening = shiftOpeningCounts('', '0')
  await openShift({ openingFloatUsd: opening.usd, openingFloatKhr: opening.khr })
  const opened = postedBodies.at(-1)
  equal(opened?.opening_float_usd, null, 'transport posts blank opening USD as null')
  equal(opened?.opening_float_khr, 0, 'transport posts explicit opening KHR zero as zero')
} finally {
  globalThis.fetch = originalFetch
  setSyncServerUrl(originalServerUrl)
  __resetApiHealthForTests()
  __resetApiWriteDedupeForTests()
}

console.log(`shift closing counts: ${checks} checks passed`)
