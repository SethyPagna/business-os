// a2 shiftux -- the shift register/close forms never block silently.
//
// Owner, 2026-09-06: "it seems the shift is not working, it did not allow to
// continue, i can enter numbers but it did not allow to continue when save"
// -> "I found the reason. i had to enter the usd as well as khmer riel".
//
// The Start/End button was `disabled` until BOTH currency counts parsed, and
// nothing on screen said so. A drawer that holds only dollars, or only riel,
// is a normal drawer. So:
//
//   1. A blank count field means 0 and is SENT as 0 (the Worker's
//      requiredMoney already accepts 0 -- that rule is not touched).
//   2. The primary action is enabled once EITHER field has a value. When it
//      cannot proceed (both blank, an invalid number) the reason is printed
//      next to the button, never hidden inside a disabled state.
//   3. Both packs carry the "0" placeholder hint and the two reasons.
//   4. Every sibling with the same two-currency count pattern (the Shifts
//      popup's amend / close / reopen forms) uses the same shared fields.
//   5. None of this touches the daily prompt: the register modal is still
//      driven by needs_registration and still cannot be dismissed.
//
// Run: node tests/shiftGateUx.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeShift, openShift, shiftCountOrZero, shiftCountPairBlocker } from '../src/api/shiftTransport.ts'
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
const fields = read('src/components/shifts/ShiftCountFields.tsx')
const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>

let checks = 0
const ok = (cond: unknown, label: string) => {
  assert.ok(cond, label)
  checks += 1
  console.log(`  ok - ${label}`)
}

// ---- 1. Blank means 0; invalid is still rejected ---------------------------
// Executed, not pattern-matched: the old parseShiftCount('') is null, the new
// rule is 0. On '' the two implementations disagree, so this is red on the
// pre-fix tree by construction.
assert.equal(shiftCountOrZero(''), 0)
assert.equal(shiftCountOrZero('   '), 0)
assert.equal(shiftCountOrZero('0'), 0)
assert.equal(shiftCountOrZero('12.50'), 12.5)
assert.equal(shiftCountOrZero('4000'), 4000)
assert.equal(shiftCountOrZero('-1'), null)
assert.equal(shiftCountOrZero('abc'), null)
assert.equal(shiftCountOrZero('Infinity'), null)
checks += 8
console.log('  ok - a blank count is 0; negative, NaN and infinite counts are still rejected')

// ---- 2. The blocker names the reason, and there is none once EITHER field has a value
assert.equal(shiftCountPairBlocker('', ''), 'both_blank')
assert.equal(shiftCountPairBlocker('  ', ''), 'both_blank')
assert.equal(shiftCountPairBlocker('5', ''), null, 'USD alone is enough')
assert.equal(shiftCountPairBlocker('', '20000'), null, 'KHR alone is enough')
assert.equal(shiftCountPairBlocker('0', ''), null, 'an explicit 0 is a value')
assert.equal(shiftCountPairBlocker('5', '20000'), null)
assert.equal(shiftCountPairBlocker('-1', ''), 'invalid')
assert.equal(shiftCountPairBlocker('5', 'abc'), 'invalid')
assert.equal(shiftCountPairBlocker('', '-100'), 'invalid')
checks += 9
console.log('  ok - the pair blocker is null once either field holds a valid count, and names both_blank / invalid otherwise')

// ---- 3. No primary action is disabled on "both counts non-null" -------------
const bothNullDisabled = /disabled=\{[^}\n]*parseShiftCount\([^)]*\) == null[^}\n]*\|\|[^}\n]*parseShiftCount\([^)]*\) == null/
ok(!bothNullDisabled.test(gate), 'ShiftGate has no button disabled on both counts being non-null')
ok(!bothNullDisabled.test(modal), 'ShiftHistoryModal has no button disabled on both counts being non-null')
ok(!/parseShiftCount\(/.test(gate), 'ShiftGate no longer treats a blank count as unparseable')
ok(!/parseShiftCount\(/.test(modal), 'ShiftHistoryModal no longer treats a blank count as unparseable')

// ---- 4. Blank maps to 0 AT SUBMIT, on every surface ------------------------
const registerBody = gate.slice(gate.indexOf('const submitOpen'), gate.indexOf('const needsRegistration'))
ok(/shiftCountOrZero\(floatUsd\)/.test(registerBody) && /shiftCountOrZero\(floatKhr\)/.test(registerBody),
  'the register step submits each blank float as 0')
const closeBody = gate.slice(gate.indexOf('const submitClose'), gate.indexOf('const dismiss'))
ok(/shiftCountOrZero\(countedUsd\)/.test(closeBody) && /shiftCountOrZero\(countedKhr\)/.test(closeBody),
  'the POS close step submits each blank count as 0')
for (const draft of ['edit.openingUsd', 'edit.openingKhr', 'edit.closingUsd', 'edit.closingKhr', 'close.closingUsd', 'close.closingKhr', 'reopen.openingUsd', 'reopen.openingKhr']) {
  ok(modal.includes(`shiftCountOrZero(${draft})`), `the Shifts popup submits a blank ${draft} as 0`)
}
ok(!/Number\((?:float|counted|edit|close|reopen)[^)]+\) \|\| 0/.test(gate + modal),
  'no surface coerces an INVALID count to 0 -- only a blank one becomes 0, through the shared helper')

// Executed: a 0 actually travels through the transport as 0, not null.
const originalFetch = globalThis.fetch
const originalServerUrl = getSyncServerUrl()
const posted: Array<{ url: string; body: Record<string, unknown> }> = []
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  posted.push({ url: String(input), body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown> })
  return new Response(JSON.stringify({
    shift: null, policy: { scope_mode: 'per_account', admin_exempt: true },
    exempt: false, needs_registration: false, is_open: true, can_end: true,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}) as typeof fetch
try {
  __resetApiHealthForTests()
  __resetApiWriteDedupeForTests()
  setSyncServerUrl('https://sync.example.test')
  await openShift({ branchId: 2, branchName: 'shop', openingFloatUsd: shiftCountOrZero('50') as number, openingFloatKhr: shiftCountOrZero('') as number })
  assert.equal(posted[posted.length - 1].body.opening_float_usd, 50)
  assert.equal(posted[posted.length - 1].body.opening_float_khr, 0)
  await closeShift({ branchId: 2, closingCountedUsd: shiftCountOrZero('') as number, closingCountedKhr: shiftCountOrZero('120000') as number })
  assert.equal(posted[posted.length - 1].body.closing_counted_usd, 0)
  assert.equal(posted[posted.length - 1].body.closing_counted_khr, 120_000)
  checks += 4
  console.log('  ok - open and close post the blank side as 0 and the typed side untouched')
} finally {
  globalThis.fetch = originalFetch
  setSyncServerUrl(originalServerUrl)
  __resetApiHealthForTests()
  __resetApiWriteDedupeForTests()
}

// ---- 5. One shared pair of count fields, with the "0" placeholder and hint --
ok(/export default function ShiftCountPair\(/.test(fields) || /export function ShiftCountPair\(/.test(fields),
  'the two-currency count pair is one shared component')
ok((fields.match(/placeholder="0"/g) || []).length >= 2, 'both count inputs show 0 as the placeholder')
ok(/t\('shift_blank_count_hint'\)/.test(fields), 'the shared pair carries the one-line blank-is-0 hint')
ok(/export function ShiftSubmitRow\(/.test(fields), 'the reason-next-to-button footer is shared too')
const submitRow = fields.slice(fields.indexOf('export function ShiftSubmitRow('))
ok(/shift_count_needed/.test(fields) && /shift_count_invalid/.test(fields), 'the two blockers are translated through the pack')
ok(/reason[\s\S]{0,600}<button/.test(submitRow), 'the reason is rendered in the same row as the button, before it')
ok(/<ShiftCountPair\b/.test(gate) && (gate.match(/<ShiftCountPair\b/g) || []).length >= 2,
  'ShiftGate renders the shared pair on both the register and the close step')
ok((modal.match(/<ShiftCountPair\b/g) || []).length >= 4,
  'the Shifts popup renders the shared pair for amend (opening + closing), close and reopen')
ok((gate.match(/<ShiftSubmitRow\b/g) || []).length >= 2, 'both POS steps use the shared submit row')
ok((modal.match(/<ShiftSubmitRow\b/g) || []).length >= 3, 'amend, close and reopen use the shared submit row')

// ---- 6. Both packs ----------------------------------------------------------
for (const key of ['shift_blank_count_hint', 'shift_count_needed', 'shift_count_invalid', 'shift_drawer_total_typed', 'shift_add_note']) {
  ok(typeof en[key] === 'string' && en[key].trim().length > 0, `en.json has ${key}`)
  ok(typeof km[key] === 'string' && km[key].trim().length > 0 && /[ក-៿]/.test(km[key]), `km.json has ${key} in Khmer script`)
}
ok(/\b0\b/.test(en.shift_blank_count_hint) && /0/.test(km.shift_blank_count_hint), 'the hint literally names 0 in both packs')

// ---- 7. The daily prompt is untouched -------------------------------------
ok(/const needsRegistration = state\?\.needs_registration === true/.test(gate),
  'the register step is still driven by the server\'s needs_registration')
ok(/\{needsRegistration && \(\s*<Modal/.test(gate), 'needs_registration still renders the register modal')
ok(/onClose=\{\(\) => \{ \/\* intentionally not dismissible/.test(gate), 'the register modal still cannot be dismissed')
ok(/t\('shift_register_hint'\)/.test(gate), 'the register modal still explains itself')
ok(!/needsRegistration && !dismissed|needsRegistration && !snoozed|localStorage[^\n]*shift_register/.test(gate),
  'no dismiss / snooze / remembered flag was introduced')

console.log(`\nshiftGateUx: all ${checks} checks passed`)
