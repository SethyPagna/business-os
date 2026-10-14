import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { accessibleText, createHarness, propsOf, type MemoryNode } from './mountedComponentHarness.ts'
import { shiftCloseTimeRefusalText } from '../src/components/shifts/shiftCloseTimeError.ts'

// A reopened segment is the same physical drawer, so it opens with the cash counted when the parent closed.
// The Shifts popup, mounted for real with the Worker transport doubled: the reopen form shows that count
// read-only (a fresh count typed here would already hold the cash of every sale rung since the close), posts it,
// and when the parent was never counted says so and offers nothing that could only fail.

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>

let failed = 0
async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const EMPLOYEE = { id: 7, username: 'sokha', name: 'Sokha', role_code: 'cashier', permissions: { pos: true, sales: true } }
const ADMIN = { id: 1, username: 'owner', name: 'Owner', role_code: 'admin', permissions: { all: true } }
const capabilities = { can_edit: true, can_close: true, can_reopen: true, can_cancel: false }

type FixtureShift = Record<string, unknown> & { shift_code: string; closed_at: string | null }
const countedShift: FixtureShift = {
  id: 41, shift_code: 'S-20261014-0937-sokha', scope_mode: 'per_account', user_id: 7, user_name: 'sokha', branch_id: 1, branch_name: 'Shop',
  business_date: '2026-10-14', opened_at: '2026-10-14T01:57:13.776Z', opening_float_usd: 50, opening_float_khr: 20000, opening_note: null,
  closed_at: '2026-10-14T05:10:00.000Z', closing_counted_usd: 55, closing_counted_khr: 20000, closing_note: null,
  closed_by_user_id: 7, closed_by_user_name: 'sokha', revision: 2, capabilities, cancelled_at: null, cancelled_by_user_id: null,
  cancelled_by_user_name: null, cancel_reason: null, parent_shift_id: null, close_before: null, reopen_reason: null,
  reopened_by_user_id: null, reopened_by_user_name: null, additional_cash_usd: 0, additional_cash_khr: 0, branch_active: true,
}
const uncountedShift: FixtureShift = { ...countedShift, id: 42, shift_code: 'S-20261014-1100-sokha', closing_counted_usd: null, closing_counted_khr: null }
const usdOnlyShift: FixtureShift = { ...countedShift, id: 43, shift_code: 'S-20261014-1200-sokha', closing_counted_khr: null }

const harness = await createHarness({ localStorage: { businessos_user: JSON.stringify(ADMIN), businessos_read_session: 'read-session-of-owner' } })

async function mountPopup(user: typeof EMPLOYEE | typeof ADMIN, shift: FixtureShift, language: 'en' | 'km' = 'en') {
  const reopens: Array<Record<string, unknown>> = []
  const pack = language === 'km' ? km : en
  const app = {
    page: 'reports', language, t: (key: string) => pack[key] ?? key, user, settings: {}, notify: () => {},
    fmtUSD: (value: unknown) => `${Number(value || 0).toFixed(2)}`, fmtKHR: (value: unknown) => `${Number(value || 0)}៛`,
    hasPermission: () => true, can: () => true, canAccessPage: () => true, getPermissions: () => ({}),
  }
  const page = await harness.mount({
    component: 'components/shifts/ShiftHistoryModal.tsx',
    props: { branchId: 1, notify: () => {} },
    app,
    doubles: {
      'api/shiftTransport.ts': {
        listShifts: async () => ({ shifts: [shift], scope: 'all', page: 1, total: 1 }),
        fetchShiftHistory: async () => ({ shift, amendments: [], segments: [shift] }),
        reopenShift: async (...args: unknown[]) => {
          reopens.push(args[1] as Record<string, unknown>)
          return { shift: { ...shift, id: 99, closed_at: null, parent_shift_id: shift.id }, reopened_from_shift_id: shift.id }
        },
      },
    },
  })
  await page.click(page.button(pack.shift_history))
  await page.click(page.find((node) => node.tagName === 'BUTTON' && accessibleText(node).includes(shift.shift_code), 'the shift row'))
  await page.click(page.findAll((node) => node.tagName === 'BUTTON' && accessibleText(node).includes(pack.shift_action_reopen))[0])
  const floatInput = (label: string): MemoryNode => page.find((node) => node.tagName === 'INPUT' && (node.getAttribute('aria-label') ?? '') === label, `the ${label} input`)
  const submit = (): MemoryNode => {
    const buttons = page.findAll((node) => node.tagName === 'BUTTON' && accessibleText(node).includes(pack.shift_action_reopen))
    return buttons[buttons.length - 1]
  }
  const reason = async (text: string) => page.type(page.find((node) => node.tagName === 'TEXTAREA', 'the reason box'), text)
  return { page, reopens, floatInput, submit, reason, pack }
}

await runTest('the reopen form shows the parent count read-only, and the request posts that count', async () => {
  const popup = await mountPopup(EMPLOYEE, countedShift)
  try {
    const usd = popup.floatInput(en.shift_float_usd)
    const khr = popup.floatInput(en.shift_float_khr)
    assert.equal(propsOf(usd).value, '55', 'the dollar opening is the parent counted close')
    assert.equal(propsOf(khr).value, '20000', 'the riel opening is the parent counted close')
    assert.equal(propsOf(usd).disabled, true, 'it cannot be retyped')
    assert.equal(propsOf(khr).disabled, true)
    assert.ok(popup.page.text().includes(en.shift_reopen_float_hint), 'the form says the drawer continues')
    await popup.reason('A sale after the close')
    await popup.page.click(popup.submit())
    assert.equal(popup.reopens.length, 1, 'one reopen request')
    assert.equal(popup.reopens[0].openingFloatUsd, 55)
    assert.equal(popup.reopens[0].openingFloatKhr, 20000)
    assert.equal(popup.reopens[0].expectedRevision, 2)
  } finally {
    await popup.page.unmount()
  }
})

await runTest('a parent counted in dollars only posts a blank riel opening, not a measured zero', async () => {
  const popup = await mountPopup(EMPLOYEE, usdOnlyShift)
  try {
    assert.equal(propsOf(popup.floatInput(en.shift_float_khr)).value, '')
    await popup.reason('A sale after the close')
    await popup.page.click(popup.submit())
    assert.equal(popup.reopens[0].openingFloatUsd, 55)
    assert.equal(popup.reopens[0].openingFloatKhr, null)
  } finally {
    await popup.page.unmount()
  }
})

for (const [language, pack] of [['en', en], ['km', km]] as const) {
  await runTest(`a parent closed without a count says so (${language}) and the reopen button is off`, async () => {
    const popup = await mountPopup(ADMIN, uncountedShift, language)
    try {
      await popup.reason('A sale after the close')
      assert.ok(popup.page.text().includes(pack.shift_reopen_needs_count), 'the translated reason is shown')
      assert.equal(propsOf(popup.submit()).disabled, true, 'the submit is off: the Worker would refuse it')
      assert.deepEqual(popup.reopens, [])
    } finally {
      await popup.page.unmount()
    }
  })
}

await runTest('the new reopen sentences exist in both packs and differ', () => {
  for (const key of ['shift_reopen_float_hint', 'shift_reopen_needs_count', 'shift_count_locked_by_reopen', 'shift_opening_float_locked_by_reopen']) {
    assert.ok(en[key] && km[key], `${key} is in both packs`)
    assert.match(km[key], /[ក-៿]/, `${key} is Khmer`)
    assert.notEqual(en[key], km[key])
  }
})

await runTest('the Worker refusals that lock a reopened pair are shown as the translated sentence, never the English fallback', () => {
  for (const code of ['shift_count_locked_by_reopen', 'shift_opening_float_locked_by_reopen']) {
    assert.equal(shiftCloseTimeRefusalText({ code, message: 'English fallback' }, (key) => `T:${key}`), `T:${code}`)
  }
})

await harness.close()
if (failed) {
  console.error(`${failed} reopen float check(s) failed`)
  process.exit(1)
}
console.log('PASS the Shifts popup reopens a shift with the parent counted close')
