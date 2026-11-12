// Mounted DeviceApprovals: the reason a shop button is grey is visible text on the card (a touch screen shows no tooltip), and it names the
// right order for the card's state: an old waiting request is never bound by signing in, so it is approved first, then signed in, then marked.
import assert from 'node:assert/strict'
import { createHarness } from './mountedComponentHarness.ts'
import type { TrustedDeviceRecord, ShopDeviceRecord } from '../src/api/deviceAdminTransport.ts'

function row(id: number, status: TrustedDeviceRecord['status'], extra: Partial<TrustedDeviceRecord> = {}): TrustedDeviceRecord {
  return { id, user_id: 10 + id, device_id: `device-${id}`, device_name: `Device ${id}`, user_agent: 'Synthetic browser', first_ip: null, last_ip: null, status, requested_at: '2026-11-13T01:00:00Z', decided_at: null, decided_by_name: null, last_seen_at: '2026-11-13T01:00:00Z', username: `user${id}`, user_name: `User ${id}`, cookie_bound_at: null, ...extra }
}
const PENDING_HINT = 'approve the request, sign in on the device once, then mark it'
const APPROVED_HINT = 'Sign in on this device once, then mark it as a shop device.'
const harness = await createHarness()
async function textOf(devices: TrustedDeviceRecord[], shop: ShopDeviceRecord[] = []) {
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
  const text = surface.text()
  await surface.unmount()
  return text
}
const count = (text: string, needle: string) => text.split(needle).length - 1
try {
  const pendingOld = await textOf([row(1, 'pending')])
  assert.equal(count(pendingOld, PENDING_HINT), 1, 'an unbound waiting request says approve, sign in, then mark')
  assert.equal(count(pendingOld, APPROVED_HINT), 0)

  const approvedUnbound = await textOf([row(2, 'approved')])
  assert.equal(count(approvedUnbound, APPROVED_HINT), 1, 'an unbound approved device says sign in once, then mark')
  assert.equal(count(approvedUnbound, PENDING_HINT), 0, 'an approved device is not told to approve again')

  const bound = await textOf([row(3, 'pending', { cookie_bound_at: '2026-11-13T01:00:00Z' }), row(4, 'approved', { cookie_bound_at: '2026-11-13T01:00:00Z' })])
  assert.equal(count(bound, PENDING_HINT) + count(bound, APPROVED_HINT), 0, 'a device that can be marked shows no hint')

  const claimed = await textOf([row(5, 'pending', { claimed_approval_ref: 9, claimed_device_name: 'Other' })])
  assert.equal(count(claimed, PENDING_HINT) + count(claimed, APPROVED_HINT), 0, 'a request that cannot be marked at all shows no hint')

  const alreadyShop = await textOf([row(6, 'approved')], [{ id: 1, device_id: 'device-6', label: 'Till 1', marked_by_name: 'Admin', marked_at: '2026-11-13T01:00:00Z', device_name: 'Device 6' }])
  assert.equal(count(alreadyShop, APPROVED_HINT), 0, 'a shop device needs no hint')
  console.log('PASS mounted DeviceApprovals mark hint: visible text, right order per card state')
} finally { await harness.close() }
