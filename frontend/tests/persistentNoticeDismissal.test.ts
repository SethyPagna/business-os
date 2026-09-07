import assert from 'node:assert/strict'
import {
  persistentNoticeFingerprint,
  shouldRenderPersistentNotice,
} from '../src/utils/persistentNoticeDismissal.ts'

const updateA = persistentNoticeFingerprint('app-update', {
  version: 'business-os-app-shell-a', message: 'New version ready',
})
assert.equal(updateA, persistentNoticeFingerprint('app-update', {
  version: 'business-os-app-shell-a', message: 'A repeated worker announcement', ts: 99,
} as { version: string; message: string; ts: number }), 'a repeated event timestamp/message must not resurrect the same version')
assert.notEqual(updateA, persistentNoticeFingerprint('app-update', {
  version: 'business-os-app-shell-b', message: 'New version ready',
}), 'a genuinely new build must reappear')

const outage = persistentNoticeFingerprint('offline-outage', {
  reason: 'server_unreachable', status: 503, message: 'Server unavailable',
}, 4)
assert.equal(shouldRenderPersistentNotice(outage, ''), true)
assert.equal(shouldRenderPersistentNotice(outage, outage), false, 'the unchanged outage stays dismissed')
assert.equal(shouldRenderPersistentNotice(outage, outage, true), true,
  'a failed save or review conflict is never suppressed by dismissing the outage')
assert.notEqual(outage, persistentNoticeFingerprint('offline-outage', {
  reason: 'server_unreachable', status: 503, message: 'Server unavailable',
}, 5), 'the same failure after a recovered interval is a new outage')
assert.notEqual(outage, persistentNoticeFingerprint('offline-outage', {
  reason: 'server_unreachable', status: 504, message: 'Server unavailable',
}, 4), 'a materially changed active outage reappears')

console.log('persistentNoticeDismissal.test.ts OK')
