import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { accessibleText, createHarness, propsOf, type MemoryNode } from './mountedComponentHarness.ts'

// Owner, 14 Oct 2026: an employee presses End Shift while an earlier day's drawer is still open behind today's.
// The Worker refuses that close, and neither the employee nor the till can mend it (they pick no time and may not
// close the earlier drawer), so the till says whose move it is -- in the operator's language -- instead of the
// overlap text, and "Open today's shift instead" / selling on stay the way through. The real End Shift panel,
// mounted with the Worker transport doubled:
//   - the earlier drawer is already known: the panel states that an administrator must close it first and offers an
//     End that cannot fail only for an administrator;
//   - it is learned only from the refusal (the drawer appeared after the till loaded): the refusal is shown as the
//     pack's sentence, in Khmer too, never the Worker's English.

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>

let failed = 0
async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const EMPLOYEE = { id: 7, username: 'sokha', name: 'Sokha', role_code: 'cashier', permissions: { pos: true, sales: true } }
const ADMIN = { id: 1, username: 'owner', name: 'Owner', role_code: 'admin', permissions: { all: true } }
const capabilities = { can_edit: true, can_close: true, can_reopen: false, can_cancel: false }
const shiftRow = (id: number, code: string, businessDate: string, openedAt: string) => ({
  id, shift_code: code, scope_mode: 'per_account', user_id: 7, user_name: 'sokha', branch_id: 1, branch_name: 'Shop',
  business_date: businessDate, opened_at: openedAt, opening_float_usd: 20, opening_float_khr: 0, opening_note: null,
  closed_at: null, closing_counted_usd: null, closing_counted_khr: null, closing_note: null, closed_by_user_id: null, closed_by_user_name: null,
  revision: 0, capabilities, cancelled_at: null, cancelled_by_user_id: null, cancelled_by_user_name: null, cancel_reason: null,
  parent_shift_id: null, close_before: null, reopen_reason: null, reopened_by_user_id: null, reopened_by_user_name: null,
  additional_cash_usd: 0, additional_cash_khr: 0, branch_active: true, reconciliation: null, figures: null,
})
const today = shiftRow(52, 'S-20261014-0800-sokha', '2026-10-14', '2026-10-14T01:00:00.000Z')
const earlier = shiftRow(51, 'S-20261013-0800-sokha', '2026-10-13', '2026-10-13T01:00:00.000Z')
const stateWith = (withEarlier: boolean) => ({
  shift: today, policy: { scope_mode: 'per_account', admin_exempt: true }, exempt: false, needs_registration: false, is_open: true, can_end: true,
  previous_open_shift: withEarlier ? earlier : null, previous_open_close_before: withEarlier ? today.opened_at : null,
})

const harness = await createHarness({ localStorage: { businessos_user: JSON.stringify(EMPLOYEE), businessos_read_session: 'read-session-of-sokha' } })

async function mountEnd(options: { user?: typeof EMPLOYEE | typeof ADMIN; earlierOpen: boolean; refuse?: { code: string; message: string }; language?: 'en' | 'km' }) {
  const closes: Array<Record<string, unknown>> = []
  const notices: Array<{ message: string; tone?: string }> = []
  const language = options.language ?? 'en'
  const pack = language === 'km' ? km : en
  const user = options.user ?? EMPLOYEE
  const page = await harness.mount({
    component: 'components/pos/ShiftGate.tsx',
    exportName: 'EndShiftButton',
    props: { branchId: 1 },
    app: {
      page: 'pos', language, t: (key: string) => pack[key] ?? key, user, settings: {},
      notify: (message: string, tone?: string) => { notices.push({ message: String(message), tone }) },
      fmtUSD: (value: unknown) => `${Number(value || 0).toFixed(2)}`, fmtKHR: (value: unknown) => `${Number(value || 0)}៛`,
      hasPermission: () => true, can: () => true, canAccessPage: () => true, getPermissions: () => ({}),
    },
    doubles: {
      'api/shiftTransport.ts': {
        fetchCurrentShift: async () => stateWith(options.earlierOpen),
        pendingShiftMutation: () => null,
        closeShift: async (...args: unknown[]) => {
          closes.push(args[0] as Record<string, unknown>)
          if (options.refuse) throw Object.assign(new Error(options.refuse.message), { code: options.refuse.code, status: 409 })
          return { shift: { ...today, closed_at: '2026-10-14T08:00:00.000Z' }, already_closed: false, is_open: false }
        },
      },
    },
  })
  await page.waitFor(() => page.findAll((node) => node.tagName === 'BUTTON' && accessibleText(node).includes(pack.shift_end)).length > 0, 'the End shift button')
  const endButtons = (): MemoryNode[] => page.findAll((node) => node.tagName === 'BUTTON' && node.textContent.trim() === pack.shift_end)
  await page.click(endButtons()[0])
  const submit = (): MemoryNode => endButtons()[endButtons().length - 1]
  return { page, closes, notices, submit, pack }
}

await runTest('an employee with an earlier drawer open: the panel says an administrator must close it first, and End is off', async () => {
  const end = await mountEnd({ earlierOpen: true })
  try {
    assert.ok(end.page.text().includes(en.shift_earlier_admin_must_close_first), 'the translated sentence is on the panel')
    assert.equal(en.shift_earlier_admin_must_close_first, 'An administrator must close the earlier shift first.')
    assert.equal(propsOf(end.submit()).disabled, true, 'End cannot only fail')
    assert.deepEqual(end.closes, [], 'nothing was sent')
  } finally {
    await end.page.unmount()
  }
})

await runTest('an administrator is not blocked by the earlier drawer on the panel', async () => {
  const end = await mountEnd({ user: ADMIN, earlierOpen: true })
  try {
    assert.equal(end.page.text().includes(en.shift_earlier_admin_must_close_first), false)
    assert.notEqual(propsOf(end.submit()).disabled, true)
  } finally {
    await end.page.unmount()
  }
})

for (const [code, english] of [
  ['shift_earlier_admin_must_close_first', 'An administrator must close the earlier shift first.'],
  ['shift_overlaps_previous_segment', 'Opening time overlaps the previous shift segment.'],
] as const) {
  for (const language of ['en', 'km'] as const) {
    await runTest(`a ${code} refusal on End shift is shown as the ${language} sentence, not the Worker's English`, async () => {
      const end = await mountEnd({ earlierOpen: false, refuse: { code, message: english }, language })
      try {
        await end.page.click(end.submit())
        assert.equal(end.closes.length, 1, 'the close was sent and refused')
        const shown = end.notices.map((notice) => notice.message)
        assert.deepEqual(shown, [(language === 'km' ? km : en)[code]], 'exactly the pack sentence is shown')
        if (language === 'km') {
          assert.match(shown[0], /[ក-៿]/, 'Khmer')
          assert.notEqual(shown[0], english)
        }
      } finally {
        await end.page.unmount()
      }
    })
  }
}

await runTest('the new sentence exists in both packs and differs', () => {
  assert.match(km.shift_earlier_admin_must_close_first, /[ក-៿]/)
  assert.notEqual(km.shift_earlier_admin_must_close_first, en.shift_earlier_admin_must_close_first)
})

await harness.close()
if (failed) {
  console.error(`${failed} End shift check(s) failed`)
  process.exit(1)
}
console.log('PASS End shift tells an employee an administrator must close the earlier shift first, in the operator language')
