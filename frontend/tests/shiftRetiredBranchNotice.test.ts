// N7 follow-up (SEC-SHIFT-MISC-VERIFY exception 1): a till still pointed at a
// retired branch must never go silent. GET /current used to answer 400, which
// useSharedShift swallowed -- no prompt, no End Shift, no reason. The Worker now
// answers `branch_inactive`; the gate turns every such answer into one notice:
// end your open shift there first, switch to the successor, or reload.
//
// Run: node tests/shiftRetiredBranchNotice.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { retiredBranchNotice } from '../src/components/shifts/retiredBranchNotice.ts'
import type { ShiftState } from '../src/api/shiftTransport.ts'

const retired = { branch_id: 1, branch_name: 'Old Shop', successor_branch_id: 2, successor_branch_name: 'LC Store' }
const state = (patch: Partial<ShiftState>): Pick<ShiftState, 'branch_inactive' | 'is_open' | 'shift'> =>
  ({ branch_inactive: retired, is_open: false, shift: null, ...patch } as Pick<ShiftState, 'branch_inactive' | 'is_open' | 'shift'>)
const openShift = { id: 77 } as ShiftState['shift']

let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

test('an active branch (or an older Worker) shows nothing', () => {
  assert.equal(retiredBranchNotice(state({ branch_inactive: null }), { canSwitch: true }), null)
  assert.equal(retiredBranchNotice(state({ branch_inactive: undefined }), { canSwitch: true }), null)
  assert.equal(retiredBranchNotice(null, { canSwitch: true }), null)
})

test('every retired-branch answer produces a notice: switch, reload, or end the open shift first', () => {
  assert.deepEqual(retiredBranchNotice(state({}), { canSwitch: true }),
    { key: '1:none', mode: 'switch', branch: 'Old Shop', successor: 'LC Store', successorId: 2 })
  assert.equal(retiredBranchNotice(state({}), { canSwitch: false })?.mode, 'reload', 'no way to switch -> reload')
  assert.equal(retiredBranchNotice(state({ branch_inactive: { ...retired, successor_branch_id: null, successor_branch_name: null } }), { canSwitch: true })?.mode, 'reload')
  const open = retiredBranchNotice(state({ is_open: true, shift: openShift }), { canSwitch: true })
  assert.deepEqual([open?.mode, open?.key], ['open_shift', '1:77'])
})

test('only the open-shift notice can be set aside, and only for that drawer', () => {
  assert.equal(retiredBranchNotice(state({ is_open: true, shift: openShift }), { canSwitch: true, dismissedKey: '1:77' }), null,
    'set aside so End Shift is reachable')
  assert.equal(retiredBranchNotice(state({}), { canSwitch: true, dismissedKey: '1:77' })?.mode, 'switch',
    'once the shift is closed the switch notice comes back')
  assert.equal(retiredBranchNotice(state({}), { canSwitch: true, dismissedKey: '1:none' })?.mode, 'switch',
    'the switch/reload notice cannot be dismissed: the till cannot sell there')
})

test('the gate renders the notice and POS wires the switch to the persisted till branch', () => {
  const gate = readFileSync(new URL('../src/components/pos/ShiftGate.tsx', import.meta.url), 'utf8')
  assert.match(gate, /const retired = retiredBranchNotice\(state, \{ canSwitch: !!onSwitchBranch, dismissedKey: retiredDismissed \}\)/)
  assert.match(gate, /\{retired && \(\s*<Modal/, 'rendered whenever there is a notice')
  assert.match(gate, /closeAffordance=\{retired\.mode === 'open_shift' \? 'visible' : 'omitted'\}/)
  assert.match(gate, /onSwitchBranch\?\.\(retired\.successorId as number\)/)
  assert.match(gate, /window\.location\.reload\(\)/)
  const pos = readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')
  assert.match(pos, /onSwitchBranch=\{\(id\) => \{ const next = String\(id\); writePosStorage\('session', 'pos_branch', next\); setBranchFilter\(next\); window\.dispatchEvent\(new Event\(SHIFT_BRANCH_CHANGED_EVENT\)\) \}\}/)
})

test('both packs carry the notice, with the placeholders filled at render', () => {
  for (const file of ['en', 'km']) {
    const pack = JSON.parse(readFileSync(new URL(`../src/lang/${file}.json`, import.meta.url), 'utf8')) as Record<string, string>
    for (const key of ['shift_branch_closed_title', 'shift_branch_closed_switch_hint', 'shift_branch_closed_reload_hint', 'shift_branch_closed_open_shift', 'shift_branch_switch', 'shift_branch_reload']) {
      assert.ok(pack[key], `${file}.${key}`)
    }
    assert.ok(pack.shift_branch_closed_switch_hint.includes('{branch}') && pack.shift_branch_closed_switch_hint.includes('{successor}'), `${file} switch hint names both`)
    assert.ok(pack.shift_branch_switch.includes('{successor}'))
  }
})

if (failed) { console.error(`${failed} failed`); process.exit(1) }
console.log('OK retired-branch notice: the till is never silent about a closed branch')
