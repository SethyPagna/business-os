// Owner rule (offline mode cancelled, 26 Sep 2026): with no connection the app shows a banner and BLOCKS saving. The POS
// checkout and the quick-add saves were gated in 6.0.250; this pins the three saves that were missed, each mounted for real:
//   - the POS / Sales Edit customer save (CustomerSourceModal),
//   - the shift open prompt (ShiftGate),
//   - End Shift (EndShiftButton).
// Each one: the button is disabled beside the translated reason, the handler refuses on its own (a disabled button is not the
// only guard), nothing reaches the transport, and with a connection the same control sends.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, propsOf, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const packs = { en: JSON.parse(read('../src/lang/en.json')), km: JSON.parse(read('../src/lang/km.json')) } as Record<'en' | 'km', Record<string, string>>

let failed = 0
const mounted: MountedSurface[] = []
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) } finally {
    for (const page of mounted.splice(0)) await page.unmount()
  }
}

const USER = { id: 7, organization_id: 1, name: 'Cashier', role_code: 'admin' }
const harness = await createHarness({ localStorage: { businessos_user: JSON.stringify(USER) } })

const capabilities = { can_edit: true, can_close: true, can_reopen: false, can_cancel: false }
const openShiftRow = {
  id: 31, shift_code: 'SH-31', scope_mode: 'per_account', user_id: 7, user_name: 'cashier', branch_id: 1, branch_name: 'LC Store', business_date: '2026-10-14',
  opened_at: '2026-10-14T01:00:00.000Z', opening_float_usd: 20, opening_float_khr: 0, opening_note: null, closed_at: null, closing_counted_usd: null,
  closing_counted_khr: null, closing_note: null, closed_by_user_id: null, closed_by_user_name: null, revision: 1, capabilities, cancelled_at: null,
  cancelled_by_user_id: null, cancelled_by_user_name: null, cancel_reason: null, parent_shift_id: null,
}
const policy = { scope_mode: 'per_account', branch_scope: 'per_branch' }
const needsRegistration = { shift: null, policy, exempt: false, needs_registration: true, is_open: false, can_end: false, previous_open_shift: null }
const openState = { shift: openShiftRow, policy, exempt: false, needs_registration: false, is_open: true, can_end: true, previous_open_shift: null }

interface Run { page: MountedSurface; notes: Array<{ type: string; message: string }>; calls: string[] }

function appFor(language: 'en' | 'km', notes: Run['notes'], over: Record<string, unknown>): Record<string, unknown> {
  const pack = packs[language]
  return {
    t: (key: string) => pack[key] ?? key, notify: (message: unknown, type: unknown) => { notes.push({ type: String(type), message: String(message) }) },
    user: { ...USER, role_permissions: { all: true } }, settings: {}, language, fmtUSD: (value: number) => `$${value}`, fmtKHR: (value: number) => `${value}`,
    usdSymbol: '$', khrSymbol: 'R', canWriteToServer: true, ...over,
  }
}

async function mountShift(component: 'ShiftGate' | 'EndShiftButton', state: unknown, language: 'en' | 'km', over: Record<string, unknown> = {}): Promise<Run> {
  const notes: Run['notes'] = []
  const calls: string[] = []
  const written = { shift: openShiftRow, policy, exempt: false, needs_registration: false, is_open: true, can_end: true }
  const page = await harness.mount({
    component: 'components/pos/ShiftGate.tsx',
    ...(component === 'EndShiftButton' ? { exportName: 'EndShiftButton' } : {}),
    app: appFor(language, notes, over),
    doubles: {
      'api/shiftTransport.ts': {
        fetchCurrentShift: async () => state,
        openShift: async () => { calls.push('openShift'); return written },
        closeShift: async () => { calls.push('closeShift'); return { ...written, shift: { ...openShiftRow, closed_at: '2026-10-14T05:00:00.000Z' }, is_open: false } },
        closeShiftById: async () => { calls.push('closeShiftById'); return { ...written, shift: openShiftRow } },
      },
    },
  })
  mounted.push(page)
  return { page, notes, calls }
}

const endButtons = (page: MountedSurface): MemoryNode[] => page.findAll((node) => node.tagName === 'BUTTON' && node.textContent.trim() === packs.en.shift_end)
const reasonNodes = (page: MountedSurface, text: string): MemoryNode[] => page.findAll((node) => node.getAttribute('role') === 'status' && node.textContent === text)

try {
  await check('Start shift offline: disabled beside the reason, the handler refuses on its own and nothing is opened; online it opens', async () => {
    const blocked = await mountShift('ShiftGate', needsRegistration, 'en', { canWriteToServer: false })
    await blocked.page.settle()
    const start = blocked.page.button(packs.en.shift_start)
    assert.equal(propsOf(start).disabled, true, 'Start shift is disabled')
    assert.equal(reasonNodes(blocked.page, packs.en.pos_saving_needs_connection).length, 1, 'the reason is printed beside it')
    await blocked.page.call(start, 'onClick', [])
    assert.deepEqual(blocked.calls, [], 'openShift was never called')
    assert.ok(blocked.notes.some((note) => note.type === 'error' && note.message === packs.en.pos_saving_needs_connection), 'the handler said why')

    await blocked.page.unmount()
    mounted.length = 0
    const live = await mountShift('ShiftGate', needsRegistration, 'en')
    await live.page.settle()
    await live.page.type(live.page.find((node) => node.tagName === 'INPUT' && node.getAttribute('aria-label') === packs.en.shift_float_usd, 'the opening USD field'), '20')
    const liveStart = live.page.button(packs.en.shift_start)
    assert.ok(!propsOf(liveStart).disabled, 'control: Start shift is live online')
    assert.equal(reasonNodes(live.page, packs.en.pos_saving_needs_connection).length, 0)
    await live.page.click(liveStart)
    assert.deepEqual(live.calls, ['openShift'], 'control: online it opens the shift')
  })

  await check('End shift offline: the Close control is disabled beside the reason and sends nothing; online it closes', async () => {
    const blocked = await mountShift('EndShiftButton', openState, 'en', { canWriteToServer: false })
    await blocked.page.settle()
    await blocked.page.click(blocked.page.button(packs.en.shift_end))
    const submit = endButtons(blocked.page).at(-1)!
    assert.equal(propsOf(submit).disabled, true, 'the close control is disabled')
    assert.equal(reasonNodes(blocked.page, packs.en.pos_saving_needs_connection).length, 1)
    await blocked.page.call(submit, 'onClick', [])
    assert.deepEqual(blocked.calls, [], 'closeShift was never called')
    assert.ok(blocked.notes.some((note) => note.type === 'error' && note.message === packs.en.pos_saving_needs_connection))

    await blocked.page.unmount()
    mounted.length = 0
    const live = await mountShift('EndShiftButton', openState, 'en')
    await live.page.settle()
    await live.page.click(live.page.button(packs.en.shift_end))
    const liveSubmit = endButtons(live.page).at(-1)!
    assert.ok(!propsOf(liveSubmit).disabled, 'control: live online')
    await live.page.click(liveSubmit)
    assert.deepEqual(live.calls, ['closeShift'], 'control: online it closes')
  })

  await check('Khmer: the shift reason is the Khmer pack sentence', async () => {
    const run = await mountShift('ShiftGate', needsRegistration, 'km', { canWriteToServer: false })
    await run.page.settle()
    assert.equal(reasonNodes(run.page, packs.km.pos_saving_needs_connection).length, 1)
    assert.ok(/[ក-៿]/.test(packs.km.pos_saving_needs_connection))
  })
  await check('Edit customer offline: Save is disabled beside the reason and updateCustomer is never reached; online the same Save opens the review', async () => {
    const customer = { id: 5, name: 'Sok Dara', membership_number: 'LC-0005', phone: '', email: '', notes: '', gender: '', address: '' }
    for (const blockedNow of [true, false]) {
      const notes: Run['notes'] = []
      const updates: Array<Record<string, unknown>> = []
      const page = await harness.mount({
        component: 'components/contacts/CustomerSourceModal.tsx',
        props: { customerId: 5, source: { kind: 'pos' }, t: (key: string) => packs.en[key] ?? key, notify: (message: unknown, type: unknown) => { notes.push({ type: String(type), message: String(message) }) }, onSaved: async () => {}, onUseExisting: async () => {}, onClose: () => {} },
        app: appFor('en', notes, { canWriteToServer: !blockedNow }),
        doubles: {
          'api/contactReadTransport.ts': { getCustomerIdentityById: async () => [customer], invalidateCustomerReadCache: () => {} },
          'api/contactWriteTransport.ts': { updateCustomer: async (_id: unknown, payload: Record<string, unknown>) => { updates.push(payload); return { success: true, ...customer, ...payload } }, createCustomer: async () => ({ success: true }) },
        },
      })
      mounted.push(page)
      await page.settle()
      const save = page.button(packs.en.save)
      if (blockedNow) {
        assert.equal(propsOf(save).disabled, true, 'Save is disabled')
        assert.equal(reasonNodes(page, packs.en.pos_saving_needs_connection).length, 1, 'the reason is on the sheet')
        await page.call(save, 'onClick', [])
        assert.ok(!page.text().includes('LC-0005'), 'no review opened')
        assert.deepEqual(updates, [], 'updateCustomer was never reached')
      } else {
        assert.ok(!propsOf(save).disabled, 'control: Save is live online')
        assert.equal(reasonNodes(page, packs.en.pos_saving_needs_connection).length, 0)
        await page.click(save)
        assert.ok(page.text().includes('LC-0005'), 'control: online the review opens')
      }
      await page.unmount()
      mounted.length = 0
    }
  })
} finally {
  await harness.close()
}

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nmissedSavesOfflineGate: all checks passed')
