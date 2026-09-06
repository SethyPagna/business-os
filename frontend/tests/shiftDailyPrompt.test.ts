// The daily shift prompt (owner rule, 2026-09-06): "for shift, I want it to
// always prompt in each new day... this is automated... don't remove it."
//
// The Worker decides WHEN (cloudflare/scripts/test-shift-daily-prompt-pure.cjs
// pins the business-date predicate); this file pins HOW the POS reacts: the
// register step is driven by needs_registration and cannot be dismissed, so
// a new business day always stops at the prompt until the shift is opened.
//
// Run: node tests/shiftDailyPrompt.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'

const gate = fs.readFileSync(new URL('../src/components/pos/ShiftGate.tsx', import.meta.url), 'utf8')
const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'))
const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8'))

assert.match(gate, /const needsRegistration = state\?\.needs_registration === true/, 'the register step follows the server\'s needs_registration verdict, not a local memory of having registered before')
assert.match(gate, /\{needsRegistration && \(\s*<Modal/, 'needs_registration renders the register modal')
assert.match(gate, /onClose=\{\(\) => \{ \/\* intentionally not dismissible/, 'the register modal cannot be dismissed -- the prompt holds until the shift is opened')
assert.doesNotMatch(gate, /needsRegistration && !dismissed|needsRegistration && !snoozed|localStorage[^\n]*shift_register/, 'no dismiss / snooze / remembered flag short-circuits the daily prompt')
assert.match(gate, /t\('shift_register_hint'\)/, 'the register modal explains itself')
for (const key of ['shift_register_title', 'shift_register_hint']) {
  assert.ok(typeof en[key] === 'string' && en[key].trim(), `en.json has ${key}`)
  assert.ok(typeof km[key] === 'string' && km[key].trim(), `km.json has ${key}`)
}

console.log('PASS the POS shift prompt is server-driven and not dismissible')
