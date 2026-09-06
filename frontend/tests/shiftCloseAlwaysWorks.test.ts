// a2 shift2 / N37 -- the close form never refuses to end a shift.
//
// Owner, Sep 6 2026: "closing shift is only a breakdown for admins in reports
// and so on for you to know ... so it is not calculated in the internal
// system, it is calculated only for shift report ... only show expenses like
// delivery and other expenses just for visual without making it a necessity to
// match the expected".
//
// So on the CLOSE forms (POS End Shift, the Shifts popup's close, and the
// closing half of an amendment) an untouched count pair is not an error: it
// means the drawer was not counted, which is stored as NULL and printed as
// "—". Registering an OPENING float keeps the old rule, because that number is
// the registration itself.
//
// Discriminating against 01f0c93c:
//   * shiftCountPairBlocker('', '', { blankMeansUncounted: true }) was
//     'both_blank' there (the option did not exist), so the End button was
//     disabled with "Enter at least one count."
//   * shiftClosingCounts did not exist; the close posted 0/0 for an untouched
//     pair, recording a drawer count nobody made.
//   * closeShift/closeShiftById/amendShift typed the counts as `number` and
//     ran requiredShiftCount, which THROWS on null.
//
// Run: node tests/shiftCloseAlwaysWorks.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  amendShift,
  closeShift,
  closeShiftById,
  shiftClosingCounts,
  shiftCountPairBlocker,
} from '../src/api/shiftTransport.ts'
import {
  __resetApiHealthForTests,
  __resetApiWriteDedupeForTests,
  getSyncServerUrl,
  setSyncServerUrl,
} from '../src/api/http.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (p: string) => fs.readFileSync(path.join(here, '..', p), 'utf8')
const gate = read('src/components/pos/ShiftGate.tsx')
const modal = read('src/components/shifts/ShiftHistoryModal.tsx')

let checks = 0
const ok = (cond: unknown, label: string) => {
  assert.ok(cond, label)
  checks += 1
  console.log(`  ok - ${label}`)
}

// ---- 1. The close pair has no "both blank" blocker ------------------------
assert.equal(shiftCountPairBlocker('', '', { blankMeansUncounted: true }), null,
  'an untouched close pair does not block the close')
assert.equal(shiftCountPairBlocker('   ', '  ', { blankMeansUncounted: true }), null)
assert.equal(shiftCountPairBlocker('5', '', { blankMeansUncounted: true }), null)
// The invalid rule survives -- the positive control for this section: if the
// option simply disabled the blocker, this would be null too.
assert.equal(shiftCountPairBlocker('-1', '', { blankMeansUncounted: true }), 'invalid')
assert.equal(shiftCountPairBlocker('', 'abc', { blankMeansUncounted: true }), 'invalid')
// And the OPENING float is unchanged: registration still needs a number.
assert.equal(shiftCountPairBlocker('', ''), 'both_blank')
checks += 6
console.log('  ok - blank closes, invalid still blocks, the opening float still requires a count')

// ---- 2. Blank pair -> null, not a fabricated 0 ----------------------------
assert.deepEqual(shiftClosingCounts('', ''), { usd: null, khr: null })
assert.deepEqual(shiftClosingCounts('  ', ''), { usd: null, khr: null })
// One side typed still means 0 in the other currency: a drawer holding only
// riel is an ordinary drawer (the shiftCountOrZero rule, unchanged).
assert.deepEqual(shiftClosingCounts('', '120000'), { usd: 0, khr: 120_000 })
assert.deepEqual(shiftClosingCounts('12.5', ''), { usd: 12.5, khr: 0 })
assert.deepEqual(shiftClosingCounts('0', ''), { usd: 0, khr: 0 })
assert.deepEqual(shiftClosingCounts('-1', ''), { usd: null, khr: 0 })
checks += 6
console.log('  ok - an untouched pair is "not counted" (null), a half-typed pair is still 0 in the other currency')

// ---- 3. Executed: the three write paths accept null and post null ---------
const originalFetch = globalThis.fetch
const originalServerUrl = getSyncServerUrl()
const posted: Array<{ url: string; body: Record<string, unknown> }> = []
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  posted.push({ url: String(input), body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown> })
  return new Response(JSON.stringify({
    shift: {
      id: 4, revision: 2, closed_at: '2026-09-06T12:00:00.000Z',
      closing_counted_usd: null, closing_counted_khr: null,
    },
    policy: { scope_mode: 'per_account', admin_exempt: false },
    exempt: false, needs_registration: false, is_open: false, can_end: false,
    already_closed: false,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}) as typeof fetch
const lastBody = () => posted[posted.length - 1].body
try {
  __resetApiHealthForTests()
  __resetApiWriteDedupeForTests()
  setSyncServerUrl('https://sync.example.test')

  const counts = shiftClosingCounts('', '')
  await closeShift({ branchId: 2, closingCountedUsd: counts.usd, closingCountedKhr: counts.khr })
  assert.equal(lastBody().closing_counted_usd, null, 'POS close posts a null USD count, not 0')
  assert.equal(lastBody().closing_counted_khr, null, 'POS close posts a null KHR count, not 0')

  await closeShiftById(4, {
    expectedRevision: 2, closedAt: '2026-09-06T12:00:00.000Z',
    closingCountedUsd: counts.usd, closingCountedKhr: counts.khr,
  })
  assert.equal(lastBody().closing_counted_usd, null, 'the historic close posts a null count')

  await amendShift(4, {
    expectedRevision: 2, reason: 'Fixing the opening note',
    openedAt: '2026-09-06T01:00:00.000Z', openingFloatUsd: 10, openingFloatKhr: 10_000,
    closedAt: '2026-09-06T12:00:00.000Z', closingCountedUsd: null, closingCountedKhr: null,
  })
  assert.equal(lastBody().closing_counted_usd, null, 'amending an uncounted closed shift keeps it uncounted')
  assert.equal(lastBody().opening_float_usd, 10, 'the opening float still travels as a number')
  checks += 5
  console.log('  ok - close, historic close and amend all carry a null count to the Worker')
} finally {
  globalThis.fetch = originalFetch
  setSyncServerUrl(originalServerUrl)
  __resetApiHealthForTests()
  __resetApiWriteDedupeForTests()
}

// ---- 4. The surfaces use the shared rule ---------------------------------
const closeBody = gate.slice(gate.indexOf('const submitClose'), gate.indexOf('const dismiss'))
ok(/shiftClosingCounts\(countedUsd, countedKhr\)/.test(closeBody),
  'POS End Shift submits through the shared closing-count rule')
ok(/shiftCountPairBlocker\(countedUsd, countedKhr, \{ blankMeansUncounted: true \}\)/.test(gate),
  'the POS End button is not blocked by an untouched count pair')
ok(/shiftClosingCounts\(close\.closingUsd, close\.closingKhr\)/.test(modal),
  "the Shifts popup's close submits through the same rule")
ok(/shiftCountPairBlocker\(close\.closingUsd, close\.closingKhr, \{ blankMeansUncounted: true \}\)/.test(modal),
  "the Shifts popup's close button is not blocked by an untouched pair")
ok(/shiftClosingCounts\(edit\.closingUsd, edit\.closingKhr\)/.test(modal),
  'the amendment form keeps an uncounted drawer uncounted')

// ---- 5. No mismatch confirmation anywhere on the close path --------------
for (const [name, source] of [['ShiftGate', gate], ['ShiftHistoryModal', modal]] as const) {
  ok(!/confirm\s*\(/.test(source), `${name} raises no native confirm on the close`)
  ok(!/(variance|mismatch)/i.test(source), `${name} carries no variance/mismatch gate`)
}
// The difference is still SHOWN -- removing the gate must not remove the
// information, which is the whole point of the shift report.
ok(/ShiftCashBreakdown/.test(gate), 'the POS close still renders the drawer breakdown it is reconciling against')

// ---- 6. The daily prompt is untouched ------------------------------------
ok(/const needsRegistration = state\?\.needs_registration === true/.test(gate),
  "the register step is still driven by the server's needs_registration")
ok(/onClose=\{\(\) => \{ \/\* intentionally not dismissible/.test(gate),
  'the register modal still cannot be dismissed')
ok(/shiftCountPairBlocker\(floatUsd, floatKhr\)/.test(gate),
  'registering an opening float still requires at least one count')

console.log(`\nshiftCloseAlwaysWorks: all ${checks} checks passed`)
