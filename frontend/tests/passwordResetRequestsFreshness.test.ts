import assert from 'node:assert/strict'
import { createHarness, propsOf } from './mountedComponentHarness.ts'
import type { PasswordResetRequestRecord } from '../src/api/userAdminTransport.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const harness = await createHarness()
async function fixture(role = 'admin') {
  const reads: Array<ReturnType<typeof deferred<unknown>>> = []
  const writes: number[] = [], resets: number[] = [], notices: string[] = []
  let mutation: ReturnType<typeof deferred<unknown>> | undefined
  let refreshKey = 0
  const app = { user: { id: 1, username: 'synthetic-admin', role_code: role, organization_id: 1 }, syncUrl: 'https://synthetic.invalid' }
  const t = (_key: string) => ''
  const notify = (message: string) => { notices.push(message) }
  const onReset = (id: number) => { resets.push(id) }
  const props = () => ({ t, notify, onReset, refreshKey })
  const surface = await harness.mount({ component: 'components/users/PasswordResetRequests.tsx', props: props(), app,
    doubles: { 'api/userAdminTransport.ts': {
      getPasswordResetRequests: () => { const read = deferred<unknown>(); reads.push(read); return read.promise },
      dismissPasswordResetRequest: (id: number) => { writes.push(id); return mutation?.promise ?? Promise.resolve({ success: true }) },
    } },
  })
  const resolve = async (index: number, name: string) => {
    const request: PasswordResetRequestRecord = { id: 7, user_id: 3, requested_at: '2026-10-09T01:00:00Z', name, username: 'synthetic-user' }
    reads[index].resolve({ success: true, requests: [request] }); await surface.settle()
  }
  return { surface, app, reads, writes, resets, notices, resolve,
    render: async (refresh = false) => { if (refresh) refreshKey++; await surface.render(props()) },
    hold: () => { mutation = deferred<unknown>(); return mutation },
  }
}
try {
  const fresh = await fixture()
  await fresh.render(true)
  await fresh.resolve(1, 'Newest request')
  await fresh.resolve(0, 'Older request')
  assert.ok(fresh.surface.text().includes('Newest request'), 'older completed read cannot replace current reset requests')
  assert.ok(!fresh.surface.text().includes('Older request'))
  await fresh.surface.unmount()

  const failed = await fixture()
  await failed.resolve(0, 'Last good request')
  await failed.render(true)
  failed.reads[1].reject(new Error('Synthetic refresh failure'))
  await failed.surface.settle()
  assert.ok(failed.surface.text().includes('Last good request'), 'refresh failure retains the known current-owner requests')
  assert.ok(failed.surface.text().includes('Synthetic refresh failure'))
  await failed.surface.click(failed.surface.button('Retry'))
  assert.equal(failed.reads.length, 3)
  await failed.resolve(2, 'Retry succeeded')
  assert.ok(!failed.surface.text().includes('Synthetic refresh failure'))
  await failed.surface.unmount()

  for (const response of [{ success: false, error: 'Authoritative read refusal' }, { success: true }, null]) {
    const f = await fixture()
    await f.resolve(0, 'Known before invalid response')
    await f.render(true)
    f.reads[1].resolve(response); await f.surface.settle()
    assert.ok(f.surface.text().includes('Known before invalid response'))
    assert.ok(f.surface.button('Retry'))
    await f.surface.unmount()
  }
  const olderFailure = await fixture()
  await olderFailure.render(true)
  await olderFailure.resolve(1, 'Current after old failure')
  olderFailure.reads[0].reject(new Error('Older failed read'))
  await olderFailure.surface.settle()
  assert.ok(olderFailure.surface.text().includes('Current after old failure'))
  assert.ok(!olderFailure.surface.text().includes('Older failed read'))
  await olderFailure.surface.unmount()

  const crossRead = await fixture()
  crossRead.app.user = { ...crossRead.app.user, id: 2 }
  await crossRead.render()
  await crossRead.resolve(1, 'Second account request')
  await crossRead.resolve(0, 'First account private request')
  assert.ok(crossRead.surface.text().includes('Second account request'))
  assert.ok(!crossRead.surface.text().includes('First account private request'))
  await crossRead.surface.unmount()

  for (const action of ['Dismiss', 'Reset password']) {
    const f = await fixture()
    await f.resolve(0, 'Rendered account request')
    const captured = propsOf(f.surface.button(action)).onClick as () => void
    const previous = window.localStorage.getItem('businessos_user')
    try {
      window.localStorage.setItem('businessos_user', JSON.stringify({ id: 99, username: 'new-http-owner' }))
      await captured(); await f.surface.settle()
      assert.deepEqual(f.writes, [], `${action}: old rendered target cannot adopt new HTTP authority`)
      assert.deepEqual(f.resets, [])
      await f.render()
      await f.resolve(1, 'Reconciled account request')
      await f.surface.click(f.surface.button(action))
      assert.equal(f.writes.length + f.resets.length, 1, `${action}: reconciled authority remains usable`)
    } finally {
      await f.surface.unmount()
      if (previous === null) window.localStorage.removeItem('businessos_user')
      else window.localStorage.setItem('businessos_user', previous)
    }
  }

  for (const boundary of ['account', 'server', 'permission']) {
    const f = await fixture()
    await f.resolve(0, 'Old request')
    const captured = propsOf(f.surface.button('Dismiss')).onClick as () => void
    if (boundary === 'account') f.app.user = { ...f.app.user, id: 2 }
    if (boundary === 'server') f.app.syncUrl = 'https://next.invalid'
    if (boundary === 'permission') f.app.user = { ...f.app.user, role_code: 'cashier' }
    await f.render()
    assert.ok(!f.surface.text().includes('Old request'))
    await captured(); await f.surface.settle()
    assert.deepEqual(f.writes, [], `${boundary}: old callback cannot write`)
    if (boundary !== 'permission') await f.resolve(1, 'New request')
    else assert.equal(f.reads.length, 1, 'unauthorized panel never reads')
    await f.surface.unmount()
  }

  const held = await fixture()
  await held.resolve(0, 'Held request')
  const mutation = held.hold()
  const click = propsOf(held.surface.button('Dismiss')).onClick as () => void
  await click(); await click(); await held.surface.settle()
  assert.deepEqual(held.writes, [7], 'synchronous duplicate suppression precedes React state updates')
  held.app.user = { ...held.app.user, id: 2 }
  await held.render(); await held.resolve(1, 'New account request')
  const readCount = held.reads.length
  mutation.reject(new Error('Old owner refusal'))
  await held.surface.settle()
  assert.deepEqual(held.notices, [])
  assert.equal(held.reads.length, readCount)
  assert.ok(held.surface.text().includes('New account request'))
  await held.surface.unmount()

  const obsolete = await fixture()
  await obsolete.resolve(0, 'Resolved request')
  const oldReset = propsOf(obsolete.surface.button('Reset password')).onClick as () => void
  await obsolete.render(true)
  obsolete.reads[1].resolve({ success: true, requests: [] }); await obsolete.surface.settle()
  await oldReset(); await obsolete.surface.settle()
  assert.deepEqual(obsolete.resets, [], 'request removed from current snapshot cannot open its old reset form')
  await obsolete.surface.unmount()

  const refusal = await fixture()
  await refusal.resolve(0, 'Known before dismiss refusal')
  const rejected = refusal.hold()
  await refusal.surface.click(refusal.surface.button('Dismiss'))
  rejected.resolve({ success: false, error: 'Authoritative dismiss refusal' }); await refusal.surface.settle()
  assert.deepEqual(refusal.notices, ['Authoritative dismiss refusal'])
  assert.equal(refusal.reads.length, 1, 'refused dismiss does not clear or reload the list')
  assert.ok(refusal.surface.text().includes('Known before dismiss refusal'))
  await refusal.surface.unmount()

  const gone = await fixture()
  await gone.surface.unmount()
  await gone.resolve(0, 'Unmounted request')
  assert.equal(gone.surface.text(), '')
  const denied = await fixture('cashier')
  assert.equal(denied.reads.length, 0)
  await denied.surface.unmount()
  console.log('PASS actual mounted password-reset request freshness, failure/retry, authority, current actions, duplicate/late settlement and unmount')
} finally { await harness.close() }
