// R40: the till's pre-check for "cash needs an open shift" (owner, 26 + 27 Nov 2026). The Worker is the judge; this answers
// pass, block or ask_worker from the shift the till already read, so the cashier sees the reason before Complete.
// Mutants killed (each turns one assertion red):
//   uses needs_registration only (a closed shift slips through)  -> "a closed shift blocks cash"
//   blocks a non-cash tender                                       -> "a bank row passes"
//   blocks an exempt user                                          -> "an exempt administrator passes"
//   blocks a $0 cash row / a Not Paid sale with nothing paid       -> "no money passes"
//   a null read blocks instead of deferring                        -> "an unread shift defers to the Worker"
//   a branch the till cannot prove blocks instead of deferring     -> "the All filter defers"
//   an open All shift ignored                                      -> "an open All shift covers a branch"
//   the opener-or-admin rule dropped                               -> "who may reopen"
//   the gate stays after the shift opens                           -> "opening the shift lifts the block"
//   the refusal text drops who to ask                              -> "cashShiftNoteText"
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { posCashShiftGate, cashShiftNoteText, type PosShiftFacts } from '../src/components/pos/posCashShiftGate.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
let failed = 0
function runTest(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const cash = [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }]
const bank = [{ method: 'ABA', amount_usd: 5, amount_khr: 0 }]
const zero = [{ method: 'Cash', amount_usd: 0, amount_khr: 0 }]
const shift = (over: Record<string, unknown> = {}) => ({ id: 9, branch_id: 1, user_name: 'Dara', closed_at: null, cancelled_at: null, capabilities: { can_reopen: false }, ...over })
const facts = (over: Partial<PosShiftFacts> = {}): PosShiftFacts => ({ exempt: false, is_open: true, needs_registration: false, shift: shift(), ...over } as PosShiftFacts)
const closed = (canReopen: boolean) => facts({ is_open: false, shift: shift({ closed_at: '2026-11-27 09:00:00', capabilities: { can_reopen: canReopen } }) })
const none = facts({ is_open: false, needs_registration: true, shift: null })

runTest('an open shift on the sale branch passes cash', () => {
  assert.deepEqual(posCashShiftGate(facts(), 1, 1, cash, {}), { kind: 'pass' })
})
runTest('a closed shift blocks cash, and the answer says who may reopen (Q2: the opener or an administrator)', () => {
  assert.deepEqual(posCashShiftGate(closed(true), 1, 1, cash, {}), { kind: 'block', shiftState: 'closed', action: 'reopen', openerName: 'Dara' })
  assert.deepEqual(posCashShiftGate(closed(false), 1, 1, cash, {}), { kind: 'block', shiftState: 'closed', action: 'ask_reopen', openerName: 'Dara' })
})
runTest('no shift today, or a cancelled one, blocks cash and the way through is opening cash', () => {
  assert.deepEqual(posCashShiftGate(none, 1, 1, cash, {}), { kind: 'block', shiftState: 'none', action: 'open', openerName: null })
  const cancelled = facts({ is_open: false, needs_registration: true, shift: shift({ cancelled_at: '2026-11-27 09:00:00' }) })
  assert.equal((posCashShiftGate(cancelled, 1, 1, cash, {}) as { shiftState: string }).shiftState, 'cancelled')
})
runTest('a bank row passes with no shift', () => {
  assert.deepEqual(posCashShiftGate(none, 1, 1, bank, {}), { kind: 'pass' })
  assert.deepEqual(posCashShiftGate(closed(false), 1, 1, bank, {}), { kind: 'pass' })
})
runTest('no money passes: Not Paid with nothing paid, and a $0 Cash row', () => {
  assert.deepEqual(posCashShiftGate(none, 1, 1, [], {}), { kind: 'pass' })
  assert.deepEqual(posCashShiftGate(none, 1, 1, zero, {}), { kind: 'pass' })
})
runTest('a renamed cash method pinned by kind is cash; a method named Cash pinned digital is not', () => {
  assert.equal(posCashShiftGate(none, 1, 1, [{ method: 'Till', amount_usd: 5, amount_khr: 0 }], { till: 'cash' }).kind, 'block')
  assert.equal(posCashShiftGate(none, 1, 1, cash, { cash: 'digital' }).kind, 'pass')
})
runTest('an exempt administrator passes', () => {
  assert.deepEqual(posCashShiftGate(facts({ exempt: true, is_open: false, needs_registration: true, shift: null }), 1, 1, cash, {}), { kind: 'pass' })
})
runTest('an unread shift defers to the Worker', () => {
  assert.deepEqual(posCashShiftGate(null, 1, 1, cash, {}), { kind: 'ask_worker' })
})
runTest('the All filter and a mixed-branch cart defer; an open All shift covers a branch', () => {
  assert.deepEqual(posCashShiftGate(none, null, 1, cash, {}), { kind: 'ask_worker' })
  assert.deepEqual(posCashShiftGate(none, 1, null, cash, {}), { kind: 'ask_worker' })
  assert.deepEqual(posCashShiftGate(none, 1, 2, cash, {}), { kind: 'ask_worker' })
  assert.deepEqual(posCashShiftGate(facts({ shift: shift({ branch_id: null }) }), 1, 1, cash, {}), { kind: 'pass' })
  assert.deepEqual(posCashShiftGate(facts({ shift: shift({ branch_id: 2 }) }), 2, 1, cash, {}), { kind: 'ask_worker' })
})
runTest('a retired branch defers to the Worker (its successor answers)', () => {
  assert.deepEqual(posCashShiftGate(facts({ is_open: false, needs_registration: false, shift: null, branch_inactive: { branch_id: 1 } } as never), 1, 1, cash, {}), { kind: 'ask_worker' })
})
runTest('opening the shift lifts the block (no loop)', () => {
  assert.equal(posCashShiftGate(none, 1, 1, cash, {}).kind, 'block')
  assert.equal(posCashShiftGate(facts(), 1, 1, cash, {}).kind, 'pass')
  assert.equal(posCashShiftGate(closed(true), 1, 1, cash, {}).kind, 'block')
  assert.equal(posCashShiftGate(facts({ shift: shift({ parent_shift_id: 9 }) }), 1, 1, cash, {}).kind, 'pass')
})
runTest('cashShiftNoteText names what is missing, then who to ask', () => {
  const dict: Record<string, string> = {
    shift_required_for_cash: 'Open a shift to take cash.', shift_required_for_refund: 'Open a shift to give cash back.',
    shift_closed_for_cash: "Today's shift is closed. Reopen it to take cash.", shift_closed_plain: "Today's shift is closed.", shift_reopen_ask: 'Ask {name} or an administrator to reopen it.',
    shift_reopen_ask_admin: 'Ask an administrator to reopen it.',
  }
  const t = (key: string) => dict[key] ?? key
  assert.equal(cashShiftNoteText({ kind: 'block', shiftState: 'none', action: 'open', openerName: null }, 'in', t), 'Open a shift to take cash.')
  assert.equal(cashShiftNoteText({ kind: 'block', shiftState: 'none', action: 'open', openerName: null }, 'out', t), 'Open a shift to give cash back.')
  assert.equal(cashShiftNoteText({ kind: 'block', shiftState: 'closed', action: 'reopen', openerName: 'Dara' }, 'in', t), "Today's shift is closed. Reopen it to take cash.")
  assert.equal(cashShiftNoteText({ kind: 'block', shiftState: 'closed', action: 'ask_reopen', openerName: 'Dara' }, 'in', t), "Today's shift is closed. Ask Dara or an administrator to reopen it.")
  assert.equal(cashShiftNoteText({ kind: 'block', shiftState: 'closed', action: 'ask_reopen', openerName: null }, 'in', t), "Today's shift is closed. Ask an administrator to reopen it.")
})

runTest('POS wiring: the gate greys the picker, stops Complete before a request id exists, and never blocks a frozen retry', () => {
  const pos = readFileSync(path.join(here, '..', 'src', 'components', 'pos', 'POS.tsx'), 'utf8').replace(/\r\n/g, '\n')
  assert.match(pos, /const posCashGate = active\.checkoutRequestId \? \{ kind: 'pass' as const \} : posCashShiftGate\(posShift\.state, primaryBranchFilterId/, 'a frozen checkout passes (it may have committed)')
  const option = pos.slice(pos.indexOf('data-pos-status-option={status}') - 400, pos.indexOf('data-pos-status-option={status}'))
  assert.match(option, /onClick=\{\(\) => \{ if \(posCashGate\.kind === 'block'\) return notify\(cashShiftNoteText\(posCashGate, 'in', t\), 'error'\); closeStatusPicker\(\); void handleCheckout\(status\) \}\}/, 'the one Complete path stops before handleCheckout mints a request id')
  assert.ok(!pos.slice(pos.indexOf('const handleCheckout = async'), pos.indexOf('const handleCheckout = async') + 400).includes('posCashGate'), 'handleCheckout itself stays free of the till pre-check')
  assert.match(pos, /const unavailable = paidInFull \|\| shiftBlocked \|\|/, 'the picker greys every option the cash cannot take')
  assert.equal(pos.split('<CashShiftNote gate={posCashGate}').length - 1, 2, 'the note sits above Complete and in the picker')
  assert.equal(pos.split('canOpenHere={false}').length - 1, 2, 'the POS opening-cash prompt is the only way through when no shift exists: never a second prompt')
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
