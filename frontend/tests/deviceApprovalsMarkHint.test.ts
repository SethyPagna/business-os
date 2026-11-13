// Mounted DeviceApprovals: the reason a shop button is grey is visible text on the card (a touch screen shows no tooltip), and it names the
// right order for the card's state: an old waiting request is never bound by signing in, so it is approved first, then signed in, then marked.
import assert from 'node:assert/strict'
import { createHarness, accessibleText, propsOf } from './mountedComponentHarness.ts'
import type { TrustedDeviceRecord, ShopDeviceRecord } from '../src/api/deviceAdminTransport.ts'

function row(id: number, status: TrustedDeviceRecord['status'], extra: Partial<TrustedDeviceRecord> = {}): TrustedDeviceRecord {
  return { id, user_id: 10 + id, device_id: `device-${id}`, device_name: `Device ${id}`, user_agent: 'Synthetic browser', first_ip: null, last_ip: null, status, requested_at: '2026-11-13T01:00:00Z', decided_at: null, decided_by_name: null, last_seen_at: '2026-11-13T01:00:00Z', username: `user${id}`, user_name: `User ${id}`, cookie_bound_at: null, ...extra }
}
const PENDING_HINT = 'approve the request, sign in on the device once, then mark it'
const APPROVED_HINT = 'Sign in on this device once, then mark it as a shop device.'
const HELD_HINT = 'Another account already has this device approved, so this request may be a copy.'
const harness = await createHarness()
async function inspect<T>(devices: TrustedDeviceRecord[], shop: ShopDeviceRecord[], read: (surface: Awaited<ReturnType<typeof harness.mount>>) => Promise<T> | T): Promise<T> {
  const t = (_key: string) => ''
  const surface = await harness.mount({
    component: 'components/users/DeviceApprovals.tsx', props: { t, notify: () => {} },
    app: { user: { id: 1, username: 'synthetic-admin', role_code: 'admin', organization_id: 1 }, syncUrl: 'https://synthetic.invalid', t },
    doubles: { 'api/deviceAdminTransport.ts': {
      getPendingDevices: () => Promise.resolve({ devices: devices.filter((d) => d.status === 'pending'), limit: 5 }),
      getAllDevices: () => Promise.resolve({ devices: devices.filter((d) => d.status !== 'pending'), limit: 5 }),
      getLiveSessions: () => Promise.resolve({ sessions: [] }),
      getShopDevices: () => Promise.resolve({ shopDevices: shop }),
    } },
  })
  const result = await read(surface)
  await surface.unmount()
  return result
}
const markButtons = (surface: Awaited<ReturnType<typeof harness.mount>>) => surface.findAll((node) => node.tagName === 'BUTTON' && /Mark as shop device/.test(accessibleText(node)))
// What the panel shows on first paint, and what it shows after the administrator presses the mark button of each card.
const textOf = (devices: TrustedDeviceRecord[], shop: ShopDeviceRecord[] = []) => inspect(devices, shop, (surface) => surface.text())
const textAfterPress = (devices: TrustedDeviceRecord[]) => inspect(devices, [], async (surface) => {
  for (const button of markButtons(surface)) await surface.click(button)
  return { text: surface.text(), dialog: surface.text().includes('Shop device name') }
})
const markButtonUnavailable = (devices: TrustedDeviceRecord[]) => inspect(devices, [], (surface) => propsOf(markButtons(surface)[0])['aria-disabled'] === true)
const count = (text: string, needle: string) => text.split(needle).length - 1
const HINTS = [PENDING_HINT, APPROVED_HINT, HELD_HINT]
const hintsIn = (text: string) => HINTS.reduce((sum, hint) => sum + count(text, hint), 0)
const BOUND = '2026-11-13T01:00:00Z'
const dara = (bound: boolean, status: 'approved' | 'pending' = 'approved') => ({ shared_with: [{ user_id: 99, name: 'Dara', status, bound }] })
try {
  // B8 L-b: first paint carries no hint on any card, so deploy day does not put a grey line on every phone that will never be a till.
  const everyKind = [row(1, 'pending'), row(2, 'approved'), row(7, 'approved', dara(false)), row(9, 'pending', dara(true))]
  assert.equal(hintsIn(await textOf(everyKind)), 0, 'no card explains the mark button until it is pressed')

  // Pressing the mark button of a card that cannot be marked yet explains the order, under that card, and opens nothing.
  const pendingOld = await textAfterPress([row(1, 'pending')])
  assert.equal(count(pendingOld.text, PENDING_HINT), 1, 'an unbound waiting request says approve, sign in, then mark')
  assert.equal(count(pendingOld.text, APPROVED_HINT), 0)
  assert.equal(pendingOld.dialog, false, 'and no naming dialog opens')

  const approvedUnbound = await textAfterPress([row(2, 'approved')])
  assert.equal(count(approvedUnbound.text, APPROVED_HINT), 1, 'an unbound approved device says sign in once, then mark')
  assert.equal(count(approvedUnbound.text, PENDING_HINT), 0, 'an approved device is not told to approve again')

  // Only the pressed card explains itself.
  const two = await inspect([row(1, 'pending'), row(2, 'approved')], [], async (surface) => {
    await surface.click(markButtons(surface)[0])
    return surface.text()
  })
  assert.equal(hintsIn(two), 1, 'one card pressed, one line shown')

  // A device that can be marked opens the naming dialog and shows no hint.
  const bound = await textAfterPress([row(4, 'approved', { cookie_bound_at: BOUND })])
  assert.equal(hintsIn(bound.text), 0, 'a device that can be marked shows no hint')
  assert.equal(bound.dialog, true, 'and its mark button opens the naming dialog')

  const claimed = await textAfterPress([row(5, 'pending', { claimed_approval_ref: 9, claimed_device_name: 'Other' })])
  assert.equal(hintsIn(claimed.text), 0, 'a request that cannot be marked at all shows no hint (it has no mark button)')

  const alreadyShop = await textOf([row(6, 'approved')], [{ id: 1, device_id: 'device-6', label: 'Till 1', marked_by_name: 'Admin', marked_at: BOUND, device_name: 'Device 6' }])
  assert.equal(hintsIn(alreadyShop), 0, 'a shop device needs no hint')

  // B8 L-a: another account has bound the id, so the Worker can mark the device from this unbound card: no hint loop, and the mark button works.
  const boundElsewhere = await textAfterPress([row(7, 'approved', dara(true))])
  assert.equal(hintsIn(boundElsewhere.text), 0, 'a card on an id another account has bound does not loop the sign-in hint')
  assert.equal(boundElsewhere.dialog, true, 'it opens the naming dialog (the confirm path)')
  assert.equal(await markButtonUnavailable([row(7, 'approved', dara(true))]), false, 'and its mark button is available')
  // Nobody bound: signing in once is still the way forward.
  const noneBound = await textAfterPress([row(8, 'approved', dara(false))])
  assert.equal(count(noneBound.text, APPROVED_HINT), 1, 'two unbound rows on one id still say sign in once')
  assert.equal(await markButtonUnavailable([row(8, 'approved', dara(false))]), true, 'and the button says it is not available yet')
  // A request on an id another account holds approved is refused by the Worker: say so, and open nothing.
  const held = await textAfterPress([row(9, 'pending', dara(true))])
  assert.equal(count(held.text, HELD_HINT), 1, 'a request held by another approval says it may be a copy')
  assert.equal(count(held.text, PENDING_HINT), 0, 'and is not told to approve first')
  assert.equal(held.dialog, false, 'and no dialog opens')
  // N-3: the dimmed button's title (desktop hover, accessible description) states the reason for THAT card's state, never another state's.
  const titleOf = (devices: TrustedDeviceRecord[]) => inspect(devices, [], (surface) => String(propsOf(markButtons(surface)[0]).title))
  assert.ok((await titleOf([row(9, 'pending', dara(true))])).startsWith(HELD_HINT), 'a held request titles itself with the held text')
  const pendingTitle = await titleOf([row(1, 'pending')])
  assert.ok(pendingTitle.includes(PENDING_HINT), 'an old waiting request titles itself approve first, then sign in once')
  assert.ok(!pendingTitle.includes(APPROVED_HINT), 'and not with the approved-device text')
  assert.equal(await titleOf([row(2, 'approved')]), APPROVED_HINT, 'an unbound approved device titles itself sign in once')
  assert.equal(await titleOf([row(4, 'approved', { cookie_bound_at: BOUND })]), 'Mark as shop device', 'a device that can be marked says what the button does')
  for (const word of ['cookie', 'masked', 'hidden']) for (const text of [HELD_HINT, PENDING_HINT, APPROVED_HINT]) assert.ok(!text.toLowerCase().includes(word), `no "${word}" wording`)

  // The line revealed on press is announced (a live region that is on the card from first paint) and linked to the button that was pressed.
  const live = await inspect([row(1, 'pending'), row(2, 'approved')], [], async (surface) => {
    const regions = () => surface.findAll((node) => propsOf(node)['aria-live'] === 'polite')
    const before = { regions: regions().length, described: markButtons(surface).map((b) => propsOf(b)['aria-describedby']) }
    await surface.click(markButtons(surface)[0])
    const after = markButtons(surface).map((b) => propsOf(b)['aria-describedby'])
    const target = regions().find((node) => propsOf(node).id === after[0])
    return { before, after, targetText: target ? accessibleText(target) : null, ids: regions().map((node) => propsOf(node).id) }
  })
  assert.equal(live.before.regions, 2, 'each card that cannot be marked carries its live region from first paint')
  assert.deepEqual(live.before.described, [undefined, undefined], 'nothing is described before a press')
  assert.ok(typeof live.after[0] === 'string' && live.after[0].length > 0, 'the pressed button points at its hint')
  assert.equal(live.after[1], undefined, 'the other button points at nothing')
  assert.ok(live.ids.includes(live.after[0]), 'and the hint element exists with that id')
  assert.ok(String(live.targetText).includes(PENDING_HINT), 'the described element holds the hint text')
  assert.equal(new Set(live.ids).size, live.ids.length, 'the ids are unique per card')
  // Keyboard reachable: aria-disabled, never the disabled attribute, so it takes focus and Enter/Space reveals the hint.
  assert.equal(await inspect([row(1, 'pending')], [], (surface) => propsOf(markButtons(surface)[0]).disabled), false, 'the dimmed button stays focusable')
  console.log('PASS mounted DeviceApprovals mark hint: nothing on first paint, the reason under the pressed card, right order per card state')
} finally { await harness.close() }
