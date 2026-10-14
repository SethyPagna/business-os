import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { accessibleText, createHarness, propsOf, type MemoryNode } from './mountedComponentHarness.ts'

// Owner, 14 Oct 2026: an employee closes now and never picks a time; a blocking screen needs a way through and a
// way out. The till's registration prompt, mounted for real as an employee who left yesterday's drawer open:
//   - a drawer another segment follows cannot be closed by an employee (closing now would overlap it): no time
//     field and no Close button that can only fail, the translated line says an administrator must close it, and
//     "Open today's shift instead" is the way through;
//   - a lone stale drawer (nothing follows it) is closed by the employee with no time at all: the Worker stamps now.

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>

let failed = 0
async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const EMPLOYEE = { id: 7, username: 'sokha', name: 'Sokha', role_code: 'cashier', permissions: { pos: true, sales: true } }
const capabilities = { can_edit: true, can_close: true, can_reopen: false, can_cancel: false }
const stale = {
  id: 51, shift_code: 'S-20261013-0800-sokha', scope_mode: 'per_account', user_id: 7, user_name: 'sokha', branch_id: 1, branch_name: 'Shop',
  business_date: '2026-10-13', opened_at: '2026-10-13T01:00:00.000Z', opening_float_usd: 20, opening_float_khr: 0, opening_note: null,
  closed_at: null, closing_counted_usd: null, closing_counted_khr: null, closing_note: null, closed_by_user_id: null, closed_by_user_name: null,
  revision: 0, capabilities, cancelled_at: null, cancelled_by_user_id: null, cancelled_by_user_name: null, cancel_reason: null,
  parent_shift_id: null, close_before: null, reopen_reason: null, reopened_by_user_id: null, reopened_by_user_name: null,
  additional_cash_usd: 0, additional_cash_khr: 0, branch_active: true,
}
const stateWith = (closeBefore: string | null) => ({
  shift: null, policy: { scope_mode: 'per_account', admin_exempt: true }, exempt: false, needs_registration: true, is_open: false, can_end: false,
  previous_open_shift: stale, previous_open_close_before: closeBefore,
})

const harness = await createHarness({ localStorage: { businessos_user: JSON.stringify(EMPLOYEE), businessos_read_session: 'read-session-of-sokha' } })

async function mountGate(closeBefore: string | null, language: 'en' | 'km' = 'en') {
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
        fetchCurrentShift: async () => stateWith(closeBefore),
        pendingShiftMutation: () => null,
        closeShiftById: async (...args: unknown[]) => { closes.push(args[1] as Record<string, unknown>); return { shift: { ...stale, closed_at: '2026-10-14T03:00:00.000Z' }, already_closed: false, is_open: false } },
      },
    },
  })
  await page.waitFor(() => page.text().includes(pack.shift_previous_open_title), 'the carry-over step')
  const timeInputs = (): MemoryNode[] => page.findAll((node) => node.tagName === 'INPUT' && (node.getAttribute('aria-label') ?? '').startsWith(pack.shift_close_time_required))
  const closeButton = (): MemoryNode | undefined => page.findAll((node) => node.tagName === 'BUTTON' && accessibleText(node).trim() === pack.shift_action_close)[0]
  return { page, closes, timeInputs, closeButton, pack }
}

await runTest('a drawer another segment follows: an employee gets no time field and no Close, is told an administrator must, and can open today instead', async () => {
  const gate = await mountGate('2026-10-14T01:00:00.000Z')
  try {
    assert.equal(gate.timeInputs().length, 0, 'no closing-time field')
    assert.equal(gate.closeButton(), undefined, 'no Close button that can only fail')
    assert.ok(gate.page.text().includes(en.shift_stale_admin_must_close), 'the translated line says an administrator must close this shift')
    const instead = gate.page.button(en.shift_open_today_instead)
    assert.equal(propsOf(instead).disabled === true, false, 'the way through is open')
    await gate.page.click(instead)
    assert.ok(gate.page.text().includes(en.shift_register_hint), 'it leads on to registering today')
    assert.deepEqual(gate.closes, [], 'nothing was closed')
  } finally {
    await gate.page.unmount()
  }
})

await runTest('the same line in Khmer', async () => {
  const gate = await mountGate('2026-10-14T01:00:00.000Z', 'km')
  try {
    assert.ok(gate.page.text().includes(km.shift_stale_admin_must_close))
    assert.notEqual(km.shift_stale_admin_must_close, en.shift_stale_admin_must_close)
    assert.match(km.shift_stale_admin_must_close, /[ក-៿]/)
  } finally {
    await gate.page.unmount()
  }
})

await runTest('a lone stale drawer: an employee closes it with no time at all (the Worker stamps now)', async () => {
  const gate = await mountGate(null)
  try {
    assert.equal(gate.timeInputs().length, 0, 'no closing-time field for an employee')
    assert.ok(gate.page.text().includes(en.shift_close_time_admin_only), 'the line says the shift closes now')
    assert.equal(gate.page.text().includes(en.shift_stale_admin_must_close), false, 'nothing blocks it')
    const close = gate.closeButton()
    assert.ok(close, 'a Close button is offered')
    await gate.page.click(close as MemoryNode)
    assert.equal(gate.closes.length, 1, 'one close request')
    assert.equal(gate.closes[0].closedAt, undefined, 'it carries no closing time')
    assert.equal(gate.closes[0].expectedRevision, 0)
  } finally {
    await gate.page.unmount()
  }
})

await harness.close()
if (failed) {
  console.error(`${failed} stale-drawer check(s) failed`)
  process.exit(1)
}
console.log('PASS an employee is never offered a time, and a drawer behind another segment points to an administrator')
