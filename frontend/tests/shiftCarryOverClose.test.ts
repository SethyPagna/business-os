// Closing a shift that was left OPEN on an earlier business day, from POS.
//
// The defect: the non-dismissible registration modal covers POS on the new
// day, and GET /api/shifts/current only ever described TODAY -- so yesterday's
// drawer could not be closed from the till at all. The cashier's only options
// were to open a second shift on top of it, or to find an admin.
//
// The Worker now answers /current with one additive field,
// `previous_open_shift`, and this file pins the POS half of the contract:
//
//   1. `undefined` means "the server did not say" (an older Worker, or a
//      WRITE response, which never carries the field) and must render
//      nothing. Only `?? null` reads that way.
//   2. The carry-over close lives INSIDE the one non-dismissible registration
//      modal, as its first step -- not in a second overlay, and not behind a
//      control that would double as a way out of the daily prompt. Both of
//      its states (closable, and locked to another account) offer the step
//      switch, so neither traps the cashier on a shift they cannot close.
//   3. The carry-over close ALWAYS sends an explicit closed_at, because once
//      today's shift is open the Worker refuses a close stamped after that
//      opening ("Closing time overlaps the next shift segment.", 409). The
//      LIVE close still sends none -- that is the ae45e101 clock-skew fix, and
//      neither path may acquire the other's rule.
//   4. A write response cannot refill `previous_open_shift`, so every write
//      re-reads /current through SHIFT_STATE_CHANGED_EVENT.
//
// Source-shape assertions, like the rest of the shift gate suite -- but every
// positive pin is DISCRIMINATING: it is re-run against a mutated copy of the
// same source held in a temp string, and the run fails if the mutant passes.
// A pin that cannot fail proves nothing about the code it claims to hold.
//
// Run: node tests/shiftCarryOverClose.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (p: string) => fs.readFileSync(path.join(here, '..', p), 'utf8')

const gate = read('src/components/pos/ShiftGate.tsx')
const transport = read('src/api/shiftTransport.ts')
const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>

/** The source between two markers, or '' when either marker is absent. */
function between(source: string, from: string, to: string): string {
  const start = source.indexOf(from)
  if (start < 0) return ''
  const end = source.indexOf(to, start + from.length)
  return end < 0 ? '' : source.slice(start, end)
}

// The four regions the two rules live in. Recomputed from whatever source is
// passed, so a mutant is sliced the same way the real file is.
const carryOverSubmit = (g: string) => between(g, 'const submitCarryOverClose', 'const submitOpen')
const openSubmit = (g: string) => between(g, 'const submitOpen', 'const needsRegistration')
const closeSubmit = (g: string) => between(g, 'const submitClose', 'const dismiss')
const liveCloseCall = (g: string) => between(closeSubmit(g), ': await closeShift(', 'setPending(false)')
const carryOverCloseCall = (g: string) => between(closeSubmit(g), 'const next = carryOverMode', ': await closeShift(')
const carryOverStep = (g: string) => between(g, "registerStep === 'carry_over' && carryOver", "t('shift_register_hint')")

type Source = { gate: string; transport: string }
type Pin = {
  label: string
  holds: (source: Source) => boolean
  /** The smallest edit that breaks the rule. The pin MUST reject it. */
  mutate: (source: Source) => Source
}

/** Rewrite ONE region of the gate, failing loudly if the target text moved. */
function editRegion(source: Source, region: (g: string) => string, find: string, replace: string): Source {
  const slice = region(source.gate)
  assert.ok(slice.length > 100, 'the negative control could not locate its region in ShiftGate.tsx')
  assert.ok(slice.includes(find), `the negative control's target text is gone: ${find}`)
  return { ...source, gate: source.gate.replace(slice, slice.replace(find, replace)) }
}

/** Rewrite the first occurrence anywhere in the gate. */
function editGate(source: Source, find: string, replace: string): Source {
  assert.ok(source.gate.includes(find), `the negative control's target text is gone: ${find}`)
  return { ...source, gate: source.gate.replace(find, replace) }
}

const pins: Pin[] = [
  // ---- 1. the field, and how it is read ----------------------------------
  {
    label: 'ShiftState declares previous_open_shift as an OPTIONAL nullable shift',
    holds: ({ transport: t }) => /previous_open_shift\?: Shift \| null/.test(t),
    mutate: (source) => ({ ...source, transport: source.transport.replace('previous_open_shift?: Shift | null', 'previous_open_shift: Shift | null') }),
  },
  {
    label: 'both POS consumers read it as `state?.previous_open_shift ?? null`, so "not stated" renders nothing',
    holds: ({ gate: g }) => (g.match(/const carryOver = state\?\.previous_open_shift \?\? null/g) || []).length >= 2,
    mutate: (source) => editGate(source, 'const carryOver = state?.previous_open_shift ?? null', 'const carryOver = state?.previous_open_shift as Shift'),
  },

  // ---- 2. one modal, two steps -------------------------------------------
  {
    label: 'the carry-over step is rendered INSIDE the non-dismissible registration modal',
    holds: ({ gate: g }) => {
      const step = g.indexOf("registerStep === 'carry_over' && carryOver")
      const prompt = g.indexOf('needsRegistration && (')
      const endButton = g.indexOf('export function EndShiftButton')
      return prompt > 0 && step > prompt && step < endButton
    },
    mutate: (source) => editGate(source, "{registerStep === 'carry_over' && carryOver ? (", '{false ? ('),
  },
  {
    label: 'both carry-over states offer the step switch, and none of them closes the modal',
    holds: ({ gate: g }) => {
      const step = carryOverStep(g)
      return (step.match(/setRegisterStep\('open'\)/g) || []).length >= 2 && !/onClose=/.test(step)
    },
    // The LOCKED branch's switch (the one without `disabled={busy}`): remove
    // it and a cashier who cannot close the earlier shift can never register
    // today's.
    mutate: (source) => editGate(source,
      `<button type="button" onClick={() => setRegisterStep('open')} className={DENSE_STEP_BUTTON}>`,
      `<button type="button" className={DENSE_STEP_BUTTON}>`),
  },

  // ---- 3. the two closes keep their two different rules -------------------
  {
    label: 'both carry-over closes go through closeShiftById with an explicit closedAt',
    holds: ({ gate: g }) => (g.match(/closeShiftById\([\s\S]{0,400}?closedAt: shiftLocalDateTimeToIso\(/g) || []).length >= 2,
    mutate: (source) => editGate(source, 'closedAt: shiftLocalDateTimeToIso(carryClose.closedAt),', 'closedAt: new Date().toISOString(),'),
  },
  {
    label: 'and no carry-over path calls the live closeShift()',
    holds: ({ gate: g }) => {
      const fromGate = carryOverSubmit(g)
      const fromButton = carryOverCloseCall(g)
      return fromGate.length > 200 && fromButton.length > 200
        && !/\bcloseShift\(/.test(fromGate) && !/\bcloseShift\(/.test(fromButton)
    },
    mutate: (source) => editRegion(source, carryOverSubmit, 'await closeShiftById(carryOver.id, {', 'await closeShift({'),
  },
  {
    label: 'the live close still sends NO closing time -- the server stamps its own clock',
    holds: ({ gate: g }) => {
      const live = liveCloseCall(g)
      return /closeShift\(\{/.test(live) && !/closed_?[Aa]t/.test(live)
    },
    mutate: (source) => editRegion(source, liveCloseCall, 'shiftId: target.id,', 'shiftId: target.id, closedAt: shiftLocalDateTimeToIso(closedAt),'),
  },

  // ---- 4. the already-registered case ------------------------------------
  {
    label: 'the second control is gated on the server capability, never on the row merely existing',
    holds: ({ gate: g }) => /const canCloseCarryOver = carryOver\?\.capabilities\.can_close === true/.test(g),
    mutate: (source) => editGate(source,
      'const canCloseCarryOver = carryOver?.capabilities.can_close === true',
      'const canCloseCarryOver = carryOver != null'),
  },
  {
    label: 'and the early return clears it, so an already-registered day still offers the earlier close',
    holds: ({ gate: g }) => /if \(!canCloseCurrent && !canCloseCarryOver && !closed && !open\) return null/.test(g),
    mutate: (source) => editGate(source,
      'if (!canCloseCurrent && !canCloseCarryOver && !closed && !open) return null',
      'if (!canCloseCurrent && !closed && !open) return null'),
  },

  // ---- 5. every write re-reads /current ----------------------------------
  {
    label: 'a successful open re-reads /current, because the open response cannot carry previous_open_shift',
    holds: ({ gate: g }) => {
      const open = openSubmit(g)
      return /publish\(next\)/.test(open) && /window\.dispatchEvent\(new Event\(SHIFT_STATE_CHANGED_EVENT\)\)/.test(open)
    },
    mutate: (source) => editRegion(source, openSubmit, 'window.dispatchEvent(new Event(SHIFT_STATE_CHANGED_EVENT))', '/* no refresh */'),
  },
  {
    label: 'and so does a successful carry-over close, which then returns to the register step',
    holds: ({ gate: g }) => {
      const carry = carryOverSubmit(g)
      return /window\.dispatchEvent\(new Event\(SHIFT_STATE_CHANGED_EVENT\)\)/.test(carry) && /setRegisterStep\('open'\)/.test(carry)
    },
    mutate: (source) => editRegion(source, carryOverSubmit, 'window.dispatchEvent(new Event(SHIFT_STATE_CHANGED_EVENT))', '/* no refresh */'),
  },
]

let checks = 0
const real: Source = { gate, transport }

for (const pin of pins) {
  assert.ok(pin.holds(real), `ShiftGate/shiftTransport does not satisfy: ${pin.label}`)
  // The negative control: the same pin, on a copy of the source with the rule
  // broken. A pin that still passes here is measuring nothing.
  assert.equal(pin.holds(pin.mutate(real)), false,
    `NOT DISCRIMINATING -- the mutated source also passes: ${pin.label}`)
  checks += 2
  console.log(`  ok - ${pin.label}`)
}

// ---- 6. both packs, four keys, real Khmer ---------------------------------
for (const key of ['shift_previous_open_title', 'shift_previous_open_hint', 'shift_previous_open_locked', 'shift_open_today_instead']) {
  assert.ok(typeof en[key] === 'string' && en[key].trim().length > 0, `en.json is missing ${key}`)
  assert.ok(typeof km[key] === 'string' && km[key].trim().length > 0, `km.json is missing ${key}`)
  assert.notEqual(km[key], en[key], `km.json falls back to the English string for ${key}`)
  assert.match(km[key], /[ក-៿]/, `km.json carries no Khmer script for ${key}`)
  assert.match(gate, new RegExp(`t\\('${key}'\\)`), `${key} is in the packs but nothing renders it`)
  checks += 5
  console.log(`  ok - ${key} is written in both packs and rendered`)
}
// The hint has to say the one thing the cashier cannot guess: the closing time
// must precede today's opening, or the Worker rejects the close with a 409.
assert.match(en.shift_previous_open_hint, /earlier than that opening/)
checks += 1
console.log('  ok - the hint states the ordering rule the Worker enforces')

console.log(`\nshiftCarryOverClose: all ${checks} checks passed`)
