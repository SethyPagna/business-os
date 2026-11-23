import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { accessibleText, createHarness, propsOf, type MemoryNode } from './mountedComponentHarness.ts'

// Owner A74-A76, 23 Nov 2026 (replaces the 14 Oct "an employee never picks a time" rule for earlier days): the till's
// registration prompt, mounted for real as a cashier who left an earlier day's drawer open. They close it in one screen:
//   - a required reason and a time limited to that day (a time field, never a date field), starting at 23:59;
//   - the count is "Cash in drawer now" with its hint while today's shift is not open, and "Not counted (closed late)"
//     with no count field while a later segment (today's shift) is open;
//   - someone who may not close the row (the Worker says so: can_close false) is offered no form at all;
//   - "Open today's shift instead" stays the way through.

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>

let failed = 0
async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const EMPLOYEE = { id: 7, username: 'sokha', name: 'Sokha', role_code: 'cashier', permissions: { pos: true, sales: true } }
const stale = (canClose: boolean) => ({
  id: 51, shift_code: 'S-20261013-0800-sokha', scope_mode: 'per_account', user_id: 7, user_name: 'sokha', branch_id: 1, branch_name: 'Shop',
  business_date: '2026-10-13', opened_at: '2026-10-13T01:00:00.000Z', opening_float_usd: 20, opening_float_khr: 0, opening_note: null,
  closed_at: null, closing_counted_usd: null, closing_counted_khr: null, closing_note: null, closed_by_user_id: null, closed_by_user_name: null,
  revision: 0, capabilities: { can_edit: true, can_close: canClose, can_reopen: false, can_cancel: false }, cancelled_at: null, cancelled_by_user_id: null,
  cancelled_by_user_name: null, cancel_reason: null, parent_shift_id: null, close_before: null, reopen_reason: null, reopened_by_user_id: null,
  reopened_by_user_name: null, additional_cash_usd: 0, additional_cash_khr: 0, branch_active: true, late_close: true,
})
const stateWith = (closeBefore: string | null, canClose: boolean) => ({
  shift: null, policy: { scope_mode: 'per_account', admin_exempt: true }, exempt: false, needs_registration: true, is_open: false, can_end: false,
  previous_open_shift: stale(canClose), previous_open_close_before: closeBefore,
})

const harness = await createHarness({ localStorage: { businessos_user: JSON.stringify(EMPLOYEE), businessos_read_session: 'read-session-of-sokha' } })

async function mountGate(closeBefore: string | null, canClose = true, language: 'en' | 'km' = 'en') {
  const closes: Array<Record<string, unknown>> = []
  const pack = language === 'km' ? km : en
  const page = await harness.mount({
    component: 'components/pos/ShiftGate.tsx',
    props: { branchId: 1, branchName: 'Shop' },
    app: {
      page: 'pos', language, t: (key: string) => pack[key] ?? key, user: EMPLOYEE, settings: {}, notify: () => {},
      fmtUSD: (value: unknown) => `${Number(value || 0).toFixed(2)}`, fmtKHR: (value: unknown) => `${Number(value || 0)}៛`,
      hasPermission: () => true, can: () => true, canAccessPage: () => true, getPermissions: () => ({}),
    },
    doubles: {
      'api/shiftTransport.ts': {
        fetchCurrentShift: async () => stateWith(closeBefore, canClose),
        pendingShiftMutation: () => null,
        closeShiftById: async (...args: unknown[]) => { closes.push(args[1] as Record<string, unknown>); return { shift: { ...stale(true), closed_at: '2026-10-13T16:59:59.000Z' }, already_closed: false, is_open: false } },
      },
    },
  })
  await page.waitFor(() => page.text().includes(pack.shift_previous_open_title), 'the carry-over step')
  const labelled = (label: string): MemoryNode[] => page.findAll((node) => node.tagName === 'INPUT' && (node.getAttribute('aria-label') ?? '').startsWith(label))
  const closeButton = (): MemoryNode | undefined => page.findAll((node) => node.tagName === 'BUTTON' && accessibleText(node).trim() === pack.shift_action_close)[0]
  return { page, closes, labelled, closeButton, pack }
}

await runTest('a closable earlier day with today not open: reason box, a time field for that day only, and the count asked as "Cash in drawer now"', async () => {
  const gate = await mountGate(null)
  try {
    assert.equal(gate.labelled(en.shift_late_reason).length, 1, 'the reason box')
    assert.equal(gate.labelled(en.shift_late_time).length, 1, 'one time field')
    assert.equal(gate.labelled(`${en.shift_late_time} · ${en.date}`).length, 0, 'and no date field: the day is the shift\'s own')
    assert.equal(gate.labelled(en.date).length, 0)
    assert.equal(propsOf(gate.labelled(en.shift_late_time)[0]).value, '23:59', 'it starts at 23:59')
    assert.ok(gate.page.text().includes(en.shift_late_count_now), 'the count is labelled Cash in drawer now')
    assert.ok(gate.page.text().includes(en.shift_late_count_hint), 'with its hint')
    assert.equal(gate.page.text().includes(en.shift_late_not_counted), false)
  } finally {
    await gate.page.unmount()
  }
})

await runTest('the Close button needs a reason; with one it sends the reason and no time (the Worker stamps 23:59:59)', async () => {
  const gate = await mountGate(null)
  try {
    const close = gate.closeButton()
    assert.ok(close, 'a Close button is offered')
    assert.equal(propsOf(close as MemoryNode).disabled, true, 'with no reason Close is disabled')
    assert.equal(gate.closes.length, 0, 'and nothing is sent')
    assert.ok(gate.page.text().includes(en.shift_late_reason_blank), 'the row says why')
    await gate.page.type(gate.labelled(en.shift_late_reason)[0], '  Forgot to close  ')
    await gate.page.click(gate.closeButton() as MemoryNode)
    assert.equal(gate.closes.length, 1, 'one close request')
    assert.equal(gate.closes[0].reason, 'Forgot to close')
    assert.equal(gate.closes[0].closedAt, undefined, 'the default time sends none')
    assert.equal(gate.closes[0].expectedRevision, 0)
  } finally {
    await gate.page.unmount()
  }
})

await runTest('today\'s shift open (a later segment follows): no count field, "Not counted (closed late)", and the close sends no count', async () => {
  const gate = await mountGate('2026-10-14T01:00:00.000Z')
  try {
    assert.ok(gate.page.text().includes(en.shift_late_not_counted))
    assert.equal(gate.page.text().includes(en.shift_late_count_now), false, 'no count is asked')
    assert.equal(gate.labelled(en.shift_counted_usd).length, 0, 'no count field')
    await gate.page.type(gate.labelled(en.shift_late_reason)[0], 'Forgot to close')
    await gate.page.click(gate.closeButton() as MemoryNode)
    assert.equal(gate.closes.length, 1)
    assert.equal(gate.closes[0].closingCountedUsd, null)
    assert.equal(gate.closes[0].closingCountedKhr, null)
  } finally {
    await gate.page.unmount()
  }
})

await runTest('someone the Worker does not let close the row is offered no form and no Close, only the way through', async () => {
  const gate = await mountGate(null, false)
  try {
    assert.equal(gate.labelled(en.shift_late_reason).length, 0, 'no reason box')
    assert.equal(gate.labelled(en.shift_late_time).length, 0, 'no time field')
    assert.equal(gate.closeButton(), undefined, 'no Close button that can only fail')
    assert.ok(gate.page.text().includes(en.shift_previous_open_locked))
    const instead = gate.page.button(en.shift_open_today_instead)
    assert.equal(propsOf(instead).disabled === true, false, 'the way through is open')
    await gate.page.click(instead)
    assert.ok(gate.page.text().includes(en.shift_register_hint), 'it leads on to registering today')
    assert.deepEqual(gate.closes, [], 'nothing was closed')
  } finally {
    await gate.page.unmount()
  }
})

await runTest('the late-close lines read in Khmer', async () => {
  const gate = await mountGate(null, true, 'km')
  try {
    for (const key of ['shift_late_reason', 'shift_late_time', 'shift_late_count_now', 'shift_late_count_hint']) {
      assert.ok(gate.page.text().includes(km[key]), key)
      assert.notEqual(km[key], en[key])
      assert.match(km[key], /[ក-៿]/)
    }
  } finally {
    await gate.page.unmount()
  }
})

await harness.close()
if (failed) {
  console.error(`${failed} stale-drawer check(s) failed`)
  process.exit(1)
}
console.log('PASS an earlier day closes with a reason and a time on its own day, and only for someone who may')
