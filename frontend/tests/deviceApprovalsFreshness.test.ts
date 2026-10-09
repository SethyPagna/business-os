import assert from 'node:assert/strict'
import { createHarness, propsOf } from './mountedComponentHarness.ts'
import type { TrustedDeviceRecord, LiveSessionRecord } from '../src/api/deviceAdminTransport.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function device(name: string, status: TrustedDeviceRecord['status'] = 'approved'): TrustedDeviceRecord {
  return { id: 7, user_id: 3, device_id: name, device_name: name, user_agent: 'Synthetic browser', first_ip: null, last_ip: null, status, requested_at: '2026-10-09T01:00:00Z', decided_at: null, decided_by_name: null, last_seen_at: '2026-10-09T01:00:00Z', username: 'synthetic-account', user_name: 'Synthetic account' }
}
function session(name: string): LiveSessionRecord {
  return { id: 81, user_id: 3, device_id: name, device_name: name, device_tz: null, user_agent: 'Synthetic browser', last_ip: null, created_at: '2026-10-09T01:00:00Z', last_seen_at: null, expires_at: '2026-10-10T01:00:00Z', username: 'synthetic-account', user_name: 'Synthetic account' }
}
const harness = await createHarness()
async function fixture(role = 'admin') {
  const reads: Array<{ pending: ReturnType<typeof deferred<{ devices: TrustedDeviceRecord[] }>>; all: ReturnType<typeof deferred<{ devices: TrustedDeviceRecord[] }>>; sessions: ReturnType<typeof deferred<{ sessions: LiveSessionRecord[] }>> }> = []
  const writes: Array<[string, number]> = []
  const notices: Array<[string, string | undefined]> = []
  let mutation: ReturnType<typeof deferred<unknown>> | undefined
  const t = (_key: string) => ''
  const app = { user: { id: 1, username: 'synthetic-admin', role_code: role, organization_id: 1 }, syncUrl: 'https://synthetic.invalid', t }
  const notify = (message: string, tone?: string) => { notices.push([message, tone]) }
  const write = (kind: string, id: number) => { writes.push([kind, id]); return mutation?.promise ?? Promise.resolve({ revoked: 1 }) }
  const surface = await harness.mount({
    component: 'components/users/DeviceApprovals.tsx', props: { t, notify }, app,
    doubles: { 'api/deviceAdminTransport.ts': {
      getPendingDevices: () => { const batch = { pending: deferred<{ devices: TrustedDeviceRecord[] }>(), all: deferred<{ devices: TrustedDeviceRecord[] }>(), sessions: deferred<{ sessions: LiveSessionRecord[] }>() }; reads.push(batch); return batch.pending.promise },
      getAllDevices: () => reads.at(-1)!.all.promise,
      getLiveSessions: () => reads.at(-1)!.sessions.promise,
      approveDevice: (id: number) => write('approve', id), rejectDevice: (id: number) => write('reject', id), revokeDevice: (id: number) => write('revoke', id), resetDeviceForReapproval: (id: number) => write('reset', id), revokeLiveSession: (id: number) => write('session', id), revokeAllUserSessions: (id: number) => write('user', id),
    } },
  })
  async function resolve(index: number, name: string, status: TrustedDeviceRecord['status'] = 'approved') {
    const batch = reads[index]
    batch.pending.resolve({ devices: status === 'pending' ? [device(name, status)] : [] })
    batch.all.resolve({ devices: [device(name, status)] })
    batch.sessions.resolve({ sessions: status === 'approved' ? [session(`${name} session`)] : [] })
    await surface.settle()
  }
  const render = () => surface.render({ t: (_key: string) => '', notify })
  return { surface, app, reads, writes, notices, resolve, render, hold: () => { mutation = deferred<unknown>(); return mutation } }
}
try {
  const only = process.argv[2]
  if (!only || only === 'same-actor') {
    const f = await fixture()
    await f.render()
    assert.equal(f.reads.length, 2)
    await f.resolve(1, 'Fresh device')
    await f.resolve(0, 'Stale pending', 'pending')
    assert.ok(f.surface.text().includes('Fresh device session'), 'older same-actor read must not replace the newer session snapshot')
    assert.ok(!f.surface.text().includes('Stale pending'), 'older same-actor pending device must not reappear')
    await f.surface.unmount()
  }
  if (!only || only === 'old-account') {
    const f = await fixture()
    f.app.user = { ...f.app.user, id: 2, username: 'next-admin' }
    await f.render()
    await f.resolve(1, 'Next account device')
    await f.resolve(0, 'Old account secret')
    assert.ok(f.surface.text().includes('Next account device session'), 'old-account response must not replace the current account snapshot')
    assert.ok(!f.surface.text().includes('Old account secret'), 'old-account records must remain absent')
    await f.surface.unmount()
  }
  if (!only) {
    const olderFailure = await fixture()
    await olderFailure.render()
    olderFailure.reads[0].pending.reject(new Error('Old same-actor failure'))
    await olderFailure.surface.settle()
    assert.ok(!olderFailure.surface.text().includes('Old same-actor failure'))
    assert.ok(olderFailure.surface.text().includes('Loading'), 'older failure cannot clear the newest loading state')
    await olderFailure.resolve(1, 'Newest after failure')
    await olderFailure.surface.unmount()

    const f = await fixture()
    await f.resolve(0, 'Known pending', 'pending')
    await f.render()
    assert.ok(f.surface.text().includes('Known pending'), 'refresh keeps last-known rows visible')
    f.reads[1].pending.reject(new Error('Synthetic refresh failure'))
    await f.surface.settle()
    assert.ok(f.surface.text().includes('Known pending'))
    assert.ok(f.surface.text().includes('Synthetic refresh failure'))
    await f.render()
    await f.resolve(2, 'Known approved')
    await f.render()
    f.app.user = { ...f.app.user, id: 2 }
    await f.render()
    assert.ok(!f.surface.text().includes('Known approved'), 'previous owner snapshot is hidden before next owner reads finish')
    f.reads[3].pending.reject(new Error('Old owner error'))
    await f.surface.settle()
    assert.ok(!f.surface.text().includes('Old owner error'))
    await f.resolve(4, 'New approved')
    const staleRevoke = f.surface.button('Revoke')
    const capturedRevoke = propsOf(staleRevoke).onClick as () => Promise<unknown>
    const pendingWrite = f.hold()
    await f.surface.click(staleRevoke)
    await f.surface.call(staleRevoke, 'onClick', [])
    assert.deepEqual(f.writes, [['revoke', 7]], 'duplicate captured action dispatches only once')
    f.app.user = { ...f.app.user, id: 3 }
    await f.render()
    await f.resolve(5, 'Third account')
    const readsBefore = f.reads.length
    pendingWrite.resolve({ success: true })
    await f.surface.settle()
    assert.deepEqual(f.notices, [], 'old-account mutation completion cannot notify the next account')
    assert.equal(f.reads.length, readsBefore, 'old-account mutation completion cannot launch a current-account refresh')
    await capturedRevoke()
    await f.surface.settle()
    assert.equal(f.writes.length, 1, 'captured old-account action cannot dispatch again')
    f.app.user = { ...f.app.user, role_code: 'cashier' }
    await f.render()
    assert.equal(f.surface.text(), '', 'loss of administrator control hides the panel')
    await f.surface.unmount()

    for (const action of ['Approve', 'Reject', 'Revoke', 'End session', 'Sign out everywhere', 'Reset for re-approval']) {
      const c = await fixture()
      await c.resolve(0, 'Action device', action === 'Approve' || action === 'Reject' ? 'pending' : action === 'Reset for re-approval' ? 'rejected' : 'approved')
      const button = c.surface.button(action)
      await c.surface.click(button)
      if (action === 'Reset for re-approval') await c.surface.click(c.surface.button(/^Remove$/))
      assert.equal(c.writes.length, 1, `${action} still reaches its existing online transport`)
      assert.equal(c.notices[0][1], 'success')
      assert.equal(c.reads.length, 2)
      await c.resolve(1, 'Refreshed action device')
      await c.surface.unmount()
    }
    const held = await fixture()
    await held.resolve(0, 'Rejected request', 'rejected')
    await held.surface.click(held.surface.button('Reset for re-approval'))
    const confirm = held.surface.button(/^Remove$/)
    held.app.user = { ...held.app.user, id: 2 }
    await held.render()
    await held.surface.call(confirm, 'onClick', [])
    assert.deepEqual(held.writes, [], 'confirmation held across account change cannot reset a rejected request')
    await held.surface.unmount()

    const denied = await fixture()
    denied.app.user = { ...denied.app.user, role_code: 'cashier' }
    await denied.render()
    await denied.resolve(0, 'Late privileged data')
    assert.equal(denied.surface.text(), '')
    assert.equal(denied.reads.length, 1, 'non-admin render cannot start device reads')
    await denied.surface.unmount()

    const initialDenied = await fixture('cashier')
    assert.equal(initialDenied.reads.length, 0, 'initial non-admin mount never calls device transports')
    assert.equal(initialDenied.surface.text(), '')
    await initialDenied.surface.unmount()

    const runtime = await fixture()
    await runtime.resolve(0, 'Previous server device')
    runtime.app.syncUrl = 'https://next-synthetic.invalid'
    await runtime.render()
    assert.ok(!runtime.surface.text().includes('Previous server device'))
    await runtime.resolve(1, 'Next server device')
    await runtime.surface.unmount()

    const authority = await fixture()
    const previousUser = window.localStorage.getItem('businessos_user')
    window.localStorage.setItem('businessos_user', JSON.stringify({ id: 99, username: 'next-cookie-owner' }))
    await authority.resolve(0, 'Old HTTP authority data')
    assert.ok(!authority.surface.text().includes('Old HTTP authority data'), 'existing actor authority fence applies even before context rerenders')
    await authority.render()
    await authority.resolve(1, 'Reconciled authority device')
    assert.ok(authority.surface.text().includes('Reconciled authority device'))
    await authority.surface.unmount()
    if (previousUser === null) window.localStorage.removeItem('businessos_user')
    else window.localStorage.setItem('businessos_user', previousUser)

    const gone = await fixture()
    await gone.surface.unmount()
    await gone.resolve(0, 'Unmounted data')
    assert.equal(gone.surface.text(), '', 'unmounted deferred read cannot repopulate the panel')

    const refused = await fixture()
    await refused.resolve(0, 'Known before refusal', 'pending')
    const failedWrite = refused.hold()
    await refused.surface.click(refused.surface.button('Approve'))
    failedWrite.reject(new Error('Synthetic authoritative refusal'))
    await refused.surface.settle()
    assert.deepEqual(refused.notices, [['Synthetic authoritative refusal', 'error']])
    assert.equal(refused.reads.length, 1, 'refused mutation never claims success or refreshes')
    assert.ok(refused.surface.text().includes('Known before refusal'))
    await refused.surface.unmount()
  }
  console.log('PASS mounted DeviceApprovals latest response, account scope, refresh failure, held actions and online authority')
} finally { await harness.close() }

