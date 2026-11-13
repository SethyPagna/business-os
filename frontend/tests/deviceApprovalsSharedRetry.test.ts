// Mounted DeviceApprovals: when another account is on a device, approving or marking it asks the administrator once and then
// SENDS the confirmed request. The earlier panel opened both dialogs and never sent the second request (review H-1): the retry ran
// inside the first action's error handler under the same action key, so the in-flight guard dropped it. This test drives the real panel
// (click, type, confirm) and reads what the transport received; a source-text match cannot see that.
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHarness, accessibleText, type MountedSurface } from './mountedComponentHarness.ts'
import type { TrustedDeviceRecord } from '../src/api/deviceAdminTransport.ts'

type Other = NonNullable<TrustedDeviceRecord['shared_with']>
type Write = [kind: string, id: number, confirmShared: boolean]
type Layout = { listed: TrustedDeviceRecord[]; fresh?: TrustedDeviceRecord[]; serverShared: boolean; atCap?: boolean }

const DARA: Other = [{ user_id: 12, name: 'Dara', status: 'approved' }]
function row(id: number, userId: number, status: TrustedDeviceRecord['status'], extra: Partial<TrustedDeviceRecord> = {}): TrustedDeviceRecord {
  return { id, user_id: userId, device_id: 'till-device', device_name: `Device ${id}`, user_agent: 'Synthetic browser', first_ip: null, last_ip: null, status, requested_at: '2026-11-13T01:00:00Z', decided_at: null, decided_by_name: null, last_seen_at: '2026-11-13T01:00:00Z', username: `user${userId}`, user_name: `User ${userId}`, cookie_bound_at: status === 'approved' ? '2026-11-13T01:00:00Z' : null, ...extra }
}
const refusal = (code: string) => Object.assign(new Error(code), { code })

const harness = await createHarness()
const here = fileURLToPath(new URL('.', import.meta.url))
const sourcePath = `${here}../src/components/users/DeviceApprovals.tsx`
const mutantName = 'DeviceApprovals.nestedRetryMutant.tsx'
const mutantPath = `${here}../src/components/users/${mutantName}`

async function mountPanel(component: string, layout: Layout) {
  const writes: Write[] = []
  const notices: Array<[string, string | undefined]> = []
  let pendingReads = 0
  const t = (_key: string) => ''
  const approvedOf = (rows: TrustedDeviceRecord[]) => rows.filter((device) => device.status !== 'pending')
  const rowsAt = (call: number) => (call > 1 && layout.fresh ? layout.fresh : layout.listed)
  let allReads = 0
  const surface = await harness.mount({
    component, props: { t, notify: (message: string, tone?: string) => { notices.push([message, tone]) } },
    app: { user: { id: 1, username: 'synthetic-admin', role_code: 'admin', organization_id: 1 }, syncUrl: 'https://synthetic.invalid', t },
    doubles: { 'api/deviceAdminTransport.ts': {
      getPendingDevices: () => { pendingReads += 1; return Promise.resolve({ devices: rowsAt(pendingReads).filter((device) => device.status === 'pending'), limit: 2 }) },
      getAllDevices: () => { allReads += 1; return Promise.resolve({ devices: approvedOf(rowsAt(allReads)), limit: 2 }) },
      getLiveSessions: () => Promise.resolve({ sessions: [] }),
      getShopDevices: () => Promise.resolve({ shopDevices: [] }),
      approveDevice: (id: number, confirmShared?: boolean) => {
        writes.push(['approve', id, confirmShared === true])
        if (layout.serverShared && !confirmShared) return Promise.reject(refusal('device_shared_confirm'))
        if (layout.atCap) return Promise.reject(refusal('device_limit_reached'))
        return Promise.resolve({ success: true })
      },
      approveDeviceReplacing: (id: number, _revokeId: number, confirmShared?: boolean) => {
        writes.push(['replace', id, confirmShared === true])
        if (layout.serverShared && !confirmShared) return Promise.reject(refusal('device_shared_confirm'))
        return Promise.resolve({ success: true })
      },
      markShopDevice: (id: number, _label: string, confirmShared?: boolean) => {
        writes.push(['mark', id, confirmShared === true])
        if (layout.serverShared && !confirmShared) return Promise.reject(refusal('device_shared_confirm'))
        return Promise.resolve({ success: true })
      },
    } },
  })
  return { surface, writes, notices }
}

const buttons = (surface: MountedSurface, label: RegExp) => surface.findAll((node) => node.tagName === 'BUTTON' && label.test(accessibleText(node)))
const lastButton = (surface: MountedSurface, label: RegExp) => {
  const found = buttons(surface, label)
  if (!found.length) throw new Error(`no button ${String(label)}; the panel reads: ${surface.text().replace(/\s+/g, ' ').slice(0, 500)}`)
  return found[found.length - 1]
}
const dialogOpen = (surface: MountedSurface) => surface.text().includes('Several accounts on this device')

// Name the device and submit the form; returns which question the panel asked first (the generic mark question, or the shared-device one).
async function startMark(surface: MountedSurface) {
  await surface.click(buttons(surface, /Mark as shop device/)[0])
  await surface.type(surface.find((node) => node.tagName === 'INPUT' && node.getAttribute('placeholder') !== null, 'shop device name field'), 'Till 1')
  await surface.call(surface.find((node) => node.tagName === 'FORM', 'shop device form'), 'onSubmit', [{ preventDefault() {} }])
  const text = surface.text()
  return { shared: text.includes('Several accounts on this device'), generic: text.includes('Mark as a shop device?') }
}

type Outcome = { writes: Write[]; notices: Array<[string, string | undefined]>; namesInDialog: boolean; dialogsAfter: boolean; firstDialog?: { shared: boolean; generic: boolean } }
async function runScenarios(component: string) {
  const out: Record<string, Outcome> = {}
  const finish = async (name: string, panel: Awaited<ReturnType<typeof mountPanel>>, namesInDialog: boolean) => {
    await panel.surface.settle()
    out[name] = { writes: panel.writes, notices: panel.notices, namesInDialog, dialogsAfter: dialogOpen(panel.surface) }
    await panel.surface.unmount()
  }

  // The card already lists the other account: ask before the first call, send once with the confirmation.
  {
    const panel = await mountPanel(component, { listed: [row(7, 10, 'pending', { shared_with: DARA })], serverShared: true })
    await panel.surface.click(panel.surface.button('Approve'))
    const named = dialogOpen(panel.surface) && panel.surface.text().includes('Dara')
    await panel.surface.click(lastButton(panel.surface, /^Approve$/))
    await finish('approve-known', panel, named)
  }
  // The page's list is stale: the first call is refused, the dialog still names the other account, the confirmed call is sent.
  {
    const panel = await mountPanel(component, { listed: [row(7, 10, 'pending')], fresh: [row(7, 10, 'pending', { shared_with: DARA })], serverShared: true })
    await panel.surface.click(panel.surface.button('Approve'))
    const named = dialogOpen(panel.surface) && panel.surface.text().includes('Dara')
    await panel.surface.click(lastButton(panel.surface, /^Approve$/))
    await finish('approve-stale', panel, named)
  }
  // Declining the dialog sends nothing more and shows no message.
  {
    const panel = await mountPanel(component, { listed: [row(7, 10, 'pending')], fresh: [row(7, 10, 'pending', { shared_with: DARA })], serverShared: true })
    await panel.surface.click(panel.surface.button('Approve'))
    const named = dialogOpen(panel.surface)
    await panel.surface.click(lastButton(panel.surface, /^Cancel$/))
    await finish('approve-declined', panel, named)
  }
  // Mark a device two accounts use (card lists the other one).
  {
    const panel = await mountPanel(component, { listed: [row(8, 10, 'approved', { shared_with: DARA })], serverShared: true })
    const first = await startMark(panel.surface)
    const named = dialogOpen(panel.surface) && panel.surface.text().includes('Dara')
    await panel.surface.click(lastButton(panel.surface, /^Mark as shop device$/))
    await finish('mark-known', panel, named)
    out['mark-known'].firstDialog = first
  }
  // Mark on a stale list (an approved card without the other account).
  {
    const panel = await mountPanel(component, { listed: [row(8, 10, 'approved')], fresh: [row(8, 10, 'approved', { shared_with: DARA })], serverShared: true })
    const first = await startMark(panel.surface)
    // The list knew nothing: the generic question comes first and the Worker's refusal then raises the shared one.
    await panel.surface.click(lastButton(panel.surface, /^Mark as shop device$/))
    await panel.surface.settle()
    const named = dialogOpen(panel.surface) && panel.surface.text().includes('Dara')
    await panel.surface.click(lastButton(panel.surface, /^Mark as shop device$/))
    await finish('mark-stale', panel, named)
    out['mark-stale'].firstDialog = first
  }
  return out
}

async function runCapScenario(component: string) {
  const own = [row(21, 10, 'approved', { device_id: 'other-a' })]
  const panel = await mountPanel(component, { listed: [row(7, 10, 'pending'), ...own], fresh: [row(7, 10, 'pending', { shared_with: DARA }), ...own, row(22, 10, 'approved', { device_id: 'other-b' })], serverShared: true, atCap: true })
  await panel.surface.click(panel.surface.button('Approve'))
  const named = dialogOpen(panel.surface) && panel.surface.text().includes('Dara')
  await panel.surface.click(lastButton(panel.surface, /^Approve$/))
  const chooser = panel.surface.text().includes('Replace a device')
  if (chooser) await panel.surface.click(lastButton(panel.surface, /Replace and approve/))
  await panel.surface.settle()
  const result = { writes: panel.writes, notices: panel.notices, named, chooser, dialogAfter: dialogOpen(panel.surface) }
  await panel.surface.unmount()
  return result
}

const sentTrue = (name: string, kind: string) => (outcome: Outcome) => assert.ok(outcome.writes.some(([k, , confirmed]) => k === kind && confirmed), `${name}: the confirmed ${kind} request was never sent (writes: ${JSON.stringify(outcome.writes)})`)

try {
  const real = await runScenarios('components/users/DeviceApprovals.tsx')
  const expectations: Array<[string, string, Write[], string]> = [
    ['approve-known', 'approve', [['approve', 7, true]], 'Device approved.'],
    ['approve-stale', 'approve', [['approve', 7, false], ['approve', 7, true]], 'Device approved.'],
    ['mark-known', 'mark', [['mark', 8, true]], 'Marked as a shop device.'],
    ['mark-stale', 'mark', [['mark', 8, false], ['mark', 8, true]], 'Marked as a shop device.'],
  ]
  for (const [name, kind, writes, notice] of expectations) {
    const outcome = real[name]
    assert.deepEqual(outcome.writes, writes, `${name}: the panel sends the request, is refused where the list was stale, and sends it again with the confirmation`)
    sentTrue(name, kind)(outcome)
    assert.ok(outcome.namesInDialog, `${name}: the dialog names the other account`)
    assert.deepEqual(outcome.notices, [[notice, 'success']], `${name}: one success message`)
    assert.equal(outcome.dialogsAfter, false, `${name}: no dialog stays open`)
  }
  // B8 L-g: a card that already lists the other account asks ONE question, the shared-device one, before the single confirmed send.
  assert.deepEqual(real['mark-known'].firstDialog, { shared: true, generic: false }, 'mark-known: the first and only dialog is the shared-device one')
  assert.deepEqual(real['mark-stale'].firstDialog, { shared: false, generic: true }, 'mark-stale: a list that knew nothing asks the generic question first')
  assert.deepEqual(real['approve-declined'].writes, [['approve', 7, false]], 'declining the dialog sends nothing more')
  assert.deepEqual(real['approve-declined'].notices, [], 'declining the dialog is quiet')
  assert.equal(real['approve-declined'].namesInDialog, true)
  assert.equal(real['approve-declined'].dialogsAfter, false, 'declining closes the dialog')

  const cap = await runCapScenario('components/users/DeviceApprovals.tsx')
  assert.ok(cap.named, 'cap: the confirm names the other account before the chooser')
  assert.ok(cap.chooser, 'cap: the stale list ends in the replace chooser, not a bare refusal')
  assert.deepEqual(cap.writes, [['approve', 7, false], ['approve', 7, true], ['replace', 7, true]], 'cap: one question, then the replacement carries the confirmation')
  assert.deepEqual(cap.notices, [['Device replaced and approved.', 'success']])
  assert.equal(cap.dialogAfter, false, 'cap: the chooser does not ask the shared question again')

  // Negative check: the old shape (the retry started as a second action with the same key while the first still holds it) is dropped.
  const source = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n')
  const kept = "return (await ask(await freshSharedNames(device))) ? send(true) : SHARED_DECLINED"
  assert.equal(source.split(kept).length - 1, 1, 'the mutant needs the retry line, which moved')
  const nested = "if (await ask(await freshSharedNames(device))) void runOnlineAction('device', device.id, () => send(true), () => 'sent')\n      return SHARED_DECLINED"
  writeFileSync(mutantPath, source.replace(kept, nested))
  try {
    const mutant = await runScenarios(`components/users/${mutantName}`)
    assert.ok(!mutant['approve-stale'].writes.some(([, , confirmed]) => confirmed), 'mutant: the nested retry must be dropped for a stale approve, which is the defect this test pins')
    assert.ok(!mutant['mark-stale'].writes.some(([, , confirmed]) => confirmed), 'mutant: the nested retry must be dropped for a stale mark')
    assert.ok(mutant['approve-known'].writes.some(([, , confirmed]) => confirmed), 'mutant control: the path that asks first still sends')
  } finally {
    rmSync(mutantPath, { force: true })
  }
  console.log('PASS mounted DeviceApprovals shared-device confirm: asked once, confirmed request sent, declined is quiet, cap ends in the chooser; nested retry mutant fails')
} finally {
  rmSync(mutantPath, { force: true })
  await harness.close()
}
