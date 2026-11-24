import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness } from './mountedComponentHarness.ts'

// Owner, 24 Nov 2026: the POS opening-cash prompt (and the retired-branch notice) stayed over every other page after
// POS was left, because POS stays mounted in a hidden slot and Modal portals into document.body. ShiftGate now shows
// both only while POS is the active page. POS shows the prompt every time it is shown, and the till still cannot be
// used while unregistered (the prompt has no way out and covers the till whenever the till is on screen).

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const gateSource = readFileSync(new URL('../src/components/pos/ShiftGate.tsx', import.meta.url), 'utf8')
const posSource = readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')

let failed = 0
async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const EMPLOYEE = { id: 7, username: 'sokha', name: 'Sokha', role_code: 'cashier', permissions: { pos: true, sales: true } }
const policy = { scope_mode: 'per_account', admin_exempt: true }
const unregistered = { shift: null, policy, exempt: false, needs_registration: true, is_open: false, can_end: false, previous_open_shift: null, previous_open_close_before: null }
const retiredState = {
  shift: null, policy, exempt: false, needs_registration: false, is_open: false, can_end: false, previous_open_shift: null, previous_open_close_before: null,
  branch_inactive: { branch_id: 1, branch_name: 'Old Shop', successor_branch_id: 2, successor_branch_name: 'LC Store' },
}
const TITLES = [en.shift_register_title, en.shift_branch_closed_title]

const harness = await createHarness({ localStorage: { businessos_user: JSON.stringify(EMPLOYEE), businessos_read_session: 'read-session-of-sokha' } })

async function mountGate(state: unknown, props: Record<string, unknown>, mutateSource?: (key: string, code: string) => string) {
  const local = mutateSource ? await createHarness({ localStorage: { businessos_user: JSON.stringify(EMPLOYEE), businessos_read_session: 'read-session-of-sokha' }, mutateSource }) : harness
  const page = await local.mount({
    component: 'components/pos/ShiftGate.tsx',
    props: { branchId: 1, branchName: 'Shop', onSwitchBranch: () => {}, ...props },
    app: {
      page: 'pos', language: 'en', t: (key: string) => en[key] ?? key, user: EMPLOYEE, settings: {}, notify: () => {},
      fmtUSD: (value: unknown) => `${Number(value || 0).toFixed(2)}`, fmtKHR: (value: unknown) => `${Number(value || 0)}៛`,
      hasPermission: () => true, can: () => true, canAccessPage: () => true, getPermissions: () => ({}),
    },
    doubles: { 'api/shiftTransport.ts': { fetchCurrentShift: async () => state, pendingShiftMutation: () => null } },
  })
  await page.settle()
  return { page, local }
}

await runTest('registration prompt: shown while POS is active, gone when POS is left, back when POS is shown again', async () => {
  const { page } = await mountGate(unregistered, { active: true })
  try {
    await page.waitFor(() => page.text().includes(en.shift_register_title), 'the prompt while POS is active')
    await page.render({ branchId: 1, branchName: 'Shop', active: false })
    await page.settle()
    assert.equal(page.text().includes(en.shift_register_title), false, 'the prompt is not over another page')
    await page.render({ branchId: 1, branchName: 'Shop', active: true })
    await page.waitFor(() => page.text().includes(en.shift_register_title), 'the prompt again')
  } finally { await page.unmount() }
})

await runTest('registration prompt: a gate that mounts while POS is hidden shows nothing until POS is shown', async () => {
  const { page } = await mountGate(unregistered, { active: false })
  try {
    assert.equal(page.text().includes(en.shift_register_title), false)
    await page.render({ branchId: 1, branchName: 'Shop', active: true })
    await page.waitFor(() => page.text().includes(en.shift_register_title), 'the prompt when POS is shown')
  } finally { await page.unmount() }
})

await runTest('retired-branch notice follows the same rule', async () => {
  const { page } = await mountGate(retiredState, { active: true })
  try {
    await page.waitFor(() => page.text().includes(en.shift_branch_closed_title), 'the notice while POS is active')
    await page.render({ branchId: 1, branchName: 'Shop', onSwitchBranch: () => {}, active: false })
    await page.settle()
    assert.equal(TITLES.some((title) => page.text().includes(title)), false, 'no notice over another page')
  } finally { await page.unmount() }
})

await runTest('no active prop keeps the prompt (the gate is only ever hidden by its owner)', async () => {
  const { page } = await mountGate(unregistered, {})
  try {
    await page.waitFor(() => page.text().includes(en.shift_register_title), 'the prompt')
  } finally { await page.unmount() }
})

await runTest('POS hands its page activity to the gate', () => {
  assert.match(posSource, /<ShiftGate[^>]*\bactive=\{isActive\}/, 'POS passes active={isActive}')
  assert.match(gateSource, /\{children\}\s*\{active \? \(\s*<>\s*\{retired && \(\s*<Modal/, 'the retired notice sits inside the active gate')
  assert.match(gateSource, /\{needsRegistration && \(\s*<Modal[\s\S]*<\/>\s*\) : null\}/, 'and so does the registration prompt')
})

await runTest('the till is never usable unregistered: the prompt is the only gate, and the scanner and sale button are off while POS is hidden', () => {
  assert.match(posSource, /useScannerWedge\(\{\s*enabled: isActive && !posOverlayOpen/)
  assert.match(posSource, /useBottomActionBar\(\{ visible: isActive &&/)
  assert.match(gateSource, /closeAffordance="omitted"/)
})

await runTest('mutant: dropping the active condition on the registration prompt is caught', async () => {
  const { page, local } = await mountGate(unregistered, { active: false }, (key, code) => key.endsWith('ShiftGate.tsx') ? code.replace('{active ? (', '{true ? (') : code)
  try {
    assert.equal(page.text().includes(en.shift_register_title), true, 'the mutant leaks the prompt, which the real test above rejects')
  } finally { await page.unmount(); await local.close() }
})

await runTest('mutant: POS no longer passing active is caught by the source check', () => {
  assert.doesNotMatch(posSource.replace(' active={isActive}', ''), /<ShiftGate[^>]*\bactive=\{isActive\}/)
})

await runTest('mutant: dropping the active condition on the retired notice is caught', async () => {
  const { page, local } = await mountGate(retiredState, { active: false }, (key, code) => key.endsWith('ShiftGate.tsx') ? code.replace('{active ? (', '{true ? (') : code)
  try {
    assert.equal(page.text().includes(en.shift_branch_closed_title), true)
  } finally { await page.unmount(); await local.close() }
})

await harness.close()
if (failed > 0) { console.error(`${failed} failed`); process.exit(1) }
console.log('shiftPromptActivePageOnly: all passed')
