import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { accessibleText, createHarness, type MemoryNode } from './mountedComponentHarness.ts'

// The Shifts popup, mounted for real with the Worker transport doubled:
//   - a holder of "Close forgotten shifts" (or an administrator) sees "Left open from earlier days" with another
//     cashier's open earlier-day shift; an employee without the grant never asks for it and sees nothing;
//   - the section is absent (no empty box) when the Worker lists nothing;
//   - tapping a row opens the late-close form; another cashier's row offers no Edit;
//   - the popup's late-close form asks reason, then cash used, then the count; its time is bounded to the shift's own
//     day; the count is hidden while today's shift is open for that drawer.

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>

let failed = 0
async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const EMPLOYEE = { id: 7, username: 'sokha', name: 'Sokha', role_code: 'cashier', permissions: { pos: true, sales: true } }
const HOLDER = { id: 8, username: 'manager', name: 'Manager', role_code: 'cashier', permissions: { pos: true, sales: true, shift_close_forgotten: true } }
const capabilities = { can_edit: true, can_close: true, can_reopen: false, can_cancel: false }

const forgottenRow = (id: number, code: string, userId: number, userName: string, closeBefore: string | null = null) => ({
  id, shift_code: code, scope_mode: 'per_account', user_id: userId, user_name: userName, branch_id: 1, branch_name: 'Shop',
  business_date: '2026-10-10', opened_at: '2026-10-10T01:00:00.000Z', opening_float_usd: 20, opening_float_khr: 0, opening_note: null,
  closed_at: null, closing_counted_usd: null, closing_counted_khr: null, closing_note: null, closed_by_user_id: null, closed_by_user_name: null,
  revision: 0, capabilities, cancelled_at: null, cancelled_by_user_id: null, cancelled_by_user_name: null, cancel_reason: null,
  parent_shift_id: null, close_before: closeBefore, reopen_reason: null, reopened_by_user_id: null, reopened_by_user_name: null,
  additional_cash_usd: 0, additional_cash_khr: 0, branch_active: true, reconciliation: null, figures: null,
})
const others = forgottenRow(61, 'S-20261010-0800-dara', 9, 'dara')
const own = forgottenRow(62, 'S-20261010-0900-manager', 8, 'manager')

const harness = await createHarness({ localStorage: { businessos_user: JSON.stringify(HOLDER), businessos_read_session: 'read-session-of-manager' } })

async function mountPopup(user: typeof EMPLOYEE | typeof HOLDER, options: { forgotten?: unknown[]; list?: unknown[]; history?: unknown } = {}) {
  const forgottenCalls: Array<Record<string, unknown>> = []
  const closes: Array<Record<string, unknown>> = []
  const forgotten = options.forgotten ?? []
  const page = await harness.mount({
    component: 'components/shifts/ShiftHistoryModal.tsx',
    props: { branchId: 1, notify: () => {} },
    app: {
      page: 'reports', language: 'en', t: (key: string) => en[key] ?? key, user, settings: {}, notify: () => {},
      fmtUSD: (value: unknown) => `${Number(value || 0).toFixed(2)}`, fmtKHR: (value: unknown) => `${Number(value || 0)}៛`,
      hasPermission: () => true, can: () => true, canAccessPage: () => true, getPermissions: () => ({}),
    },
    doubles: {
      'api/shiftTransport.ts': {
        listShifts: async () => ({ shifts: options.list ?? [], scope: 'all', page: 1, total: (options.list ?? []).length }),
        listForgottenShifts: async (filters: Record<string, unknown>) => { forgottenCalls.push(filters); return { shifts: forgotten, scope: 'forgotten' } },
        fetchShiftHistory: async (id: number) => {
          const row = ([...forgotten, ...(options.list ?? [])] as Array<{ id: number }>).find((item) => item.id === id) ?? options.history
          return { shift: row, amendments: [], segments: [row] }
        },
        closeShiftById: async (id: number, body: Record<string, unknown>) => {
          closes.push(body)
          const row = ([...forgotten, ...(options.list ?? [])] as Array<{ id: number }>).find((item) => item.id === id)
          return { shift: { ...row, closed_at: '2026-10-10T16:59:00.000Z' } }
        },
      },
    },
  })
  await page.click(page.button(en.shift_history))
  return { page, forgottenCalls, closes }
}

const buttonsLabelled = (page: Awaited<ReturnType<typeof mountPopup>>['page'], label: string): MemoryNode[] =>
  page.findAll((node) => node.tagName === 'BUTTON' && accessibleText(node).includes(label))
const sectionBoxes = (page: Awaited<ReturnType<typeof mountPopup>>['page']): MemoryNode[] =>
  page.findAll((node) => node.tagName === 'SECTION' && (node.getAttribute('aria-label') ?? '') === en.shift_left_open_title)

await runTest('a holder sees "Left open from earlier days" with another cashier\'s forgotten shift', async () => {
  const popup = await mountPopup(HOLDER, { forgotten: [others] })
  try {
    assert.equal(popup.forgottenCalls.length, 1, 'the list is asked for once when the popup opens')
    assert.equal(sectionBoxes(popup.page).length, 1, 'one section')
    assert.ok(popup.page.text().includes(en.shift_left_open_title))
    assert.ok(popup.page.text().includes(others.shift_code), 'the row is the one-line header with the shift ID')
    assert.ok(popup.page.text().includes('dara'), 'and the cashier')
  } finally { await popup.page.unmount() }
})

await runTest('an employee without the grant never asks for the list and sees no section', async () => {
  const popup = await mountPopup(EMPLOYEE, { forgotten: [others] })
  try {
    assert.equal(popup.forgottenCalls.length, 0, 'no ?forgotten=1 request')
    assert.equal(sectionBoxes(popup.page).length, 0)
    assert.equal(popup.page.text().includes(en.shift_left_open_title), false)
  } finally { await popup.page.unmount() }
})

await runTest('with nothing left open the section is not drawn at all', async () => {
  const popup = await mountPopup(HOLDER, { forgotten: [] })
  try {
    assert.equal(popup.forgottenCalls.length, 1, 'a holder still asks once')
    assert.equal(sectionBoxes(popup.page).length, 0, 'no empty box')
    assert.equal(popup.page.text().includes(en.shift_left_open_title), false, 'no title over nothing')
  } finally { await popup.page.unmount() }
})

await runTest('tapping a forgotten row opens the late-close form', async () => {
  const popup = await mountPopup(HOLDER, { forgotten: [others] })
  try {
    await popup.page.click(buttonsLabelled(popup.page, others.shift_code)[0])
    assert.ok(popup.page.text().includes(en.shift_late_reason), 'the reason question is on screen')
    assert.ok(popup.page.text().includes(en.shift_late_count_now), 'with the count asked (no later segment)')
  } finally { await popup.page.unmount() }
})

await runTest('another cashier\'s forgotten row offers no Edit; the holder\'s own row keeps it', async () => {
  const popup = await mountPopup(HOLDER, { forgotten: [others, own] })
  try {
    await popup.page.click(buttonsLabelled(popup.page, others.shift_code)[0])
    assert.ok(popup.page.text().includes(en.shift_late_reason), 'the form did open')
    assert.equal(buttonsLabelled(popup.page, en.shift_action_edit).length, 0, 'no Edit on another cashier\'s shift')
  } finally { await popup.page.unmount() }
  const ownPopup = await mountPopup(HOLDER, { forgotten: [own] })
  try {
    await ownPopup.page.click(buttonsLabelled(ownPopup.page, own.shift_code)[0])
    assert.equal(buttonsLabelled(ownPopup.page, en.shift_action_edit).length, 1, 'Edit stays on their own row')
  } finally { await ownPopup.page.unmount() }
})

await runTest('a closed forgotten row leaves the section', async () => {
  const popup = await mountPopup(HOLDER, { forgotten: [others] })
  try {
    await popup.page.click(buttonsLabelled(popup.page, others.shift_code)[0])
    await popup.page.type(popup.page.find((node) => node.tagName === 'INPUT' && (node.getAttribute('aria-label') ?? '') === en.shift_late_reason, 'the reason box'), 'Forgot')
    const buttons = buttonsLabelled(popup.page, en.shift_action_close)
    await popup.page.click(buttons[buttons.length - 1])
    assert.equal(popup.closes.length, 1, 'one close request')
    await popup.page.click(popup.page.button(en.back))
    assert.equal(sectionBoxes(popup.page).length, 0, 'the row is gone from the section')
  } finally { await popup.page.unmount() }
})

const lateText = (page: Awaited<ReturnType<typeof mountPopup>>['page']) => page.text()

await runTest('the popup\'s late form asks reason, then cash used, then the count; the picker is bounded to the day', async () => {
  const row = forgottenRow(63, 'S-20261010-1000-sokha', 7, 'sokha')
  const popup = await mountPopup(HOLDER, { list: [row] })
  try {
    await popup.page.click(buttonsLabelled(popup.page, row.shift_code)[0])
    await popup.page.click(buttonsLabelled(popup.page, en.shift_action_close)[0])
    const text = lateText(popup.page)
    const reason = text.indexOf(en.shift_late_reason)
    const cash = text.indexOf(en.shift_additional_cash, reason)
    const count = text.indexOf(en.shift_late_count_now)
    assert.ok(reason >= 0 && cash > reason && count > cash, `order reason(${reason}) < cash used(${cash}) < count(${count})`)
    const timeLabel = en.shift_late_time.replace('{date}', '10/10/2026')
    const picker = popup.page.findAll((node) => node.tagName === 'INPUT' && (node.getAttribute('aria-label') ?? '') === timeLabel)
    assert.equal(picker.length, 1, 'a time picker labelled with the shift\'s own day')
    assert.equal(popup.page.findAll((node) => node.tagName === 'INPUT' && (node.getAttribute('aria-label') ?? '').includes(`· ${en.date}`)).length, 0, 'no date to move off that day')
    assert.ok(text.includes(en.shift_late_time_hint))
  } finally { await popup.page.unmount() }
})

await runTest('the count is hidden while today\'s shift is open for that drawer, and the close sends none', async () => {
  const row = forgottenRow(64, 'S-20261010-1100-sokha', 7, 'sokha', '2026-11-24T01:00:00.000Z')
  const popup = await mountPopup(HOLDER, { list: [row] })
  try {
    await popup.page.click(buttonsLabelled(popup.page, row.shift_code)[0])
    await popup.page.click(buttonsLabelled(popup.page, en.shift_action_close)[0])
    const text = lateText(popup.page)
    assert.equal(text.includes(en.shift_late_count_now), false, 'no count asked')
    assert.ok(text.includes(en.shift_late_not_counted), 'the form says it is not counted')
    await popup.page.type(popup.page.find((node) => node.tagName === 'INPUT' && (node.getAttribute('aria-label') ?? '') === en.shift_late_reason, 'the reason box'), 'Forgot')
    const buttons = buttonsLabelled(popup.page, en.shift_action_close)
    await popup.page.click(buttons[buttons.length - 1])
    assert.equal(popup.closes.length, 1)
    assert.equal(popup.closes[0].closingCountedUsd, null, 'no USD count sent')
    assert.equal(popup.closes[0].closingCountedKhr, null, 'no riel count sent')
  } finally { await popup.page.unmount() }
})

if (failed) {
  console.error(`${failed} forgotten-list check(s) failed`)
  process.exit(1)
}
