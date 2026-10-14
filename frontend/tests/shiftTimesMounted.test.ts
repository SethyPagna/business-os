import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { accessibleText, createHarness, propsOf, type MemoryNode } from './mountedComponentHarness.ts'

// Owner, 14 Oct 2026: an employee never picks a shift's opening or closing time; they close now. An
// administrator may. The Shifts popup, mounted for real with the Worker transport doubled:
//   - the Close form: an employee is offered no time and posts none (the Worker stamps now); an administrator picks one;
//   - the Edit form: both time fields are disabled for an employee, with the translated hint, and an amend
//     sends no opened_at/closed_at; an administrator's fields are enabled and a changed time is sent, an
//     untouched one is not re-stamped.

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>

let failed = 0
async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const EMPLOYEE = { id: 7, username: 'sokha', name: 'Sokha', role_code: 'cashier', permissions: { pos: true, sales: true } }
const ADMIN = { id: 1, username: 'owner', name: 'Owner', role_code: 'admin', permissions: { all: true } }
const capabilities = { can_edit: true, can_close: true, can_reopen: false, can_cancel: false }

type FixtureShift = Record<string, unknown> & { shift_code: string; closed_at: string | null }
const closedShift: FixtureShift = {
  id: 41, shift_code: 'S-20261014-0937-sokha', scope_mode: 'per_account', user_id: 7, user_name: 'sokha', branch_id: 1, branch_name: 'Shop',
  business_date: '2026-10-14', opened_at: '2026-10-14T01:57:13.776Z', opening_float_usd: 50, opening_float_khr: 0, opening_note: null,
  closed_at: '2026-10-14T05:10:00.000Z', closing_counted_usd: 60, closing_counted_khr: 0, closing_note: null,
  closed_by_user_id: 7, closed_by_user_name: 'sokha', revision: 2, capabilities, cancelled_at: null, cancelled_by_user_id: null,
  cancelled_by_user_name: null, cancel_reason: null, parent_shift_id: null, close_before: null, reopen_reason: null,
  reopened_by_user_id: null, reopened_by_user_name: null, additional_cash_usd: 0, additional_cash_khr: 0, branch_active: true,
}
const openShift = { ...closedShift, id: 42, shift_code: 'S-20261014-1100-sokha', closed_at: null, closing_counted_usd: null, closing_counted_khr: null, revision: 0 }

const harness = await createHarness({ localStorage: { businessos_user: JSON.stringify(ADMIN), businessos_read_session: 'read-session-of-owner' } })

type Calls = { amend: Array<Record<string, unknown>>; close: Array<Record<string, unknown>> }
async function mountPopup(user: typeof EMPLOYEE | typeof ADMIN, shift: FixtureShift, answers: { amend?: () => unknown; close?: () => unknown } = {}, language: 'en' | 'km' = 'en') {
  const calls: Calls = { amend: [], close: [] }
  const notices: Array<{ message: string; tone?: string }> = []
  const pack = language === 'km' ? km : en
  const app = {
    page: 'reports', language, t: (key: string) => pack[key] ?? key, user, settings: {}, notify: () => {},
    fmtUSD: (value: unknown) => `${Number(value || 0).toFixed(2)}`, fmtKHR: (value: unknown) => `${Number(value || 0)}៛`,
    hasPermission: () => true, can: () => true, canAccessPage: () => true, getPermissions: () => ({}),
  }
  const page = await harness.mount({
    component: 'components/shifts/ShiftHistoryModal.tsx',
    props: { branchId: 1, notify: (message: string, tone?: string) => { notices.push({ message: String(message), tone }) } },
    app,
    doubles: {
      'api/shiftTransport.ts': {
        listShifts: async () => ({ shifts: [shift], scope: 'all', page: 1, total: 1 }),
        fetchShiftHistory: async () => ({ shift, amendments: [], segments: [shift] }),
        amendShift: async (...args: unknown[]) => { calls.amend.push(args[1] as Record<string, unknown>); return answers.amend ? answers.amend() : { shift } },
        closeShiftById: async (...args: unknown[]) => { calls.close.push(args[1] as Record<string, unknown>); return answers.close ? answers.close() : { shift: { ...shift, closed_at: '2026-10-14T06:00:00.000Z' } } },
      },
    },
  })
  const pack2 = pack
  await page.click(page.button(pack2.shift_history))
  await page.click(page.find((node) => node.tagName === 'BUTTON' && accessibleText(node).includes(shift.shift_code), 'the shift row'))
  const input = (label: string, part: string): MemoryNode =>
    page.find((node) => node.tagName === 'INPUT' && (node.getAttribute('aria-label') ?? '') === `${label} · ${part}`, `${label} ${part} input`)
  const isDisabled = (node: MemoryNode): boolean => propsOf(node).disabled === true || node.hasAttribute('disabled')
  return { page, calls, notices, input, isDisabled, pack: pack2 }
}

await runTest('the Edit form: an employee cannot touch either time, sees why, and an amend sends neither', async () => {
  const popup = await mountPopup(EMPLOYEE, closedShift)
  try {
    await popup.page.click(popup.page.button(en.shift_action_edit))
    for (const part of [en.date, en.time]) {
      assert.equal(popup.isDisabled(popup.input(en.shift_opened_at, part)), true, `Opened at ${part} is disabled for an employee`)
      assert.equal(popup.isDisabled(popup.input(en.shift_closed_at, part)), true, `Closed at ${part} is disabled for an employee`)
    }
    assert.ok(popup.page.text().includes(en.shift_time_admin_only), 'the translated hint says only an administrator changes a time')
    const note = popup.page.find((node) => node.tagName === 'INPUT' && node.parentNode?.tagName === 'LABEL' && node.parentNode.textContent.startsWith(en.shift_opening_note), 'the opening note field')
    await popup.page.type(note, 'Counted twice')
    await popup.page.type(popup.page.find((node) => node.tagName === 'TEXTAREA', 'the reason box'), 'Typo in the note')
    await popup.page.click(popup.page.button(en.shift_save_amendment))
    assert.equal(popup.calls.amend.length, 1, 'one amend request')
    const sent = popup.calls.amend[0]
    assert.equal('openedAt' in sent, false, 'no opening time is sent')
    assert.equal(sent.closedAtUnchanged, true, 'the closing time is marked unchanged, so it is not sent')
  } finally {
    await popup.page.unmount()
  }
})

await runTest('the Edit form: an administrator can change a time, and an untouched time is not re-stamped', async () => {
  const popup = await mountPopup(ADMIN, closedShift)
  try {
    await popup.page.click(popup.page.button(en.shift_action_edit))
    for (const part of [en.date, en.time]) {
      assert.equal(popup.isDisabled(popup.input(en.shift_opened_at, part)), false, `Opened at ${part} is enabled for an administrator`)
      assert.equal(popup.isDisabled(popup.input(en.shift_closed_at, part)), false, `Closed at ${part} is enabled for an administrator`)
    }
    assert.equal(popup.page.text().includes(en.shift_time_admin_only), false, 'no hint for an administrator')
    await popup.page.type(popup.page.find((node) => node.tagName === 'TEXTAREA', 'the reason box'), 'Moved by a minute')
    const closeTime = popup.input(en.shift_closed_at, en.time)
    await popup.page.type(closeTime, '1311')
    await popup.page.call(closeTime, 'onBlur', [{ target: closeTime }])
    await popup.page.click(popup.page.button(en.shift_save_amendment))
    assert.equal(popup.calls.amend.length, 1)
    const sent = popup.calls.amend[0]
    assert.equal('openedAt' in sent, false, 'the untouched opening time is not sent')
    assert.equal(typeof sent.closedAt, 'string', 'the changed closing time is sent')
    assert.notEqual(sent.closedAtUnchanged, true)
  } finally {
    await popup.page.unmount()
  }
})

const closeButtons = (popup: Awaited<ReturnType<typeof mountPopup>>): MemoryNode[] =>
  popup.page.findAll((node) => node.tagName === 'BUTTON' && accessibleText(node).includes(popup.pack.shift_action_close))

await runTest('the Close form: an employee has no time to pick, is told the shift closes now, and the request carries no closed_at', async () => {
  const popup = await mountPopup(EMPLOYEE, openShift)
  try {
    await popup.page.click(closeButtons(popup)[0])
    assert.equal(popup.page.findAll((node) => node.tagName === 'INPUT' && (node.getAttribute('aria-label') ?? '').startsWith(en.shift_close_time_required)).length, 0,
      'no closing-time field is offered to an employee')
    assert.ok(popup.page.text().includes(en.shift_close_time_admin_only), 'the translated line says the shift closes now')
    const buttons = closeButtons(popup)
    await popup.page.click(buttons[buttons.length - 1])
    assert.equal(popup.calls.close.length, 1, 'one close request')
    assert.equal(popup.calls.close[0].closedAt, undefined, 'the stale, minute-floored draft time is not posted: the Worker stamps now')
    assert.equal(popup.calls.close[0].expectedRevision, 0)
  } finally {
    await popup.page.unmount()
  }
})

await runTest('the Close form: an administrator picks the time and the request carries it', async () => {
  const popup = await mountPopup(ADMIN, openShift)
  try {
    await popup.page.click(closeButtons(popup)[0])
    for (const part of [en.date, en.time]) {
      assert.equal(popup.isDisabled(popup.input(en.shift_close_time_required, part)), false, `Closing ${part} is enabled for an administrator`)
    }
    const buttons = closeButtons(popup)
    await popup.page.click(buttons[buttons.length - 1])
    assert.equal(popup.calls.close.length, 1)
    assert.match(String(popup.calls.close[0].closedAt), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'the chosen time is sent as an instant')
  } finally {
    await popup.page.unmount()
  }
})

await harness.close()
if (failed) {
  console.error(`${failed} shift time check(s) failed`)
  process.exit(1)
}
console.log('PASS the Shifts popup lets only an administrator change a shift time')
