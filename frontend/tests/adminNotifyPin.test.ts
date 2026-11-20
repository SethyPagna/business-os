import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  emitToast,
  getNotificationDuration,
  NOTIFICATION_ALERT_MS,
  NOTIFICATION_MAX_VISIBLE,
  NOTIFICATION_SUCCESS_MS,
  subscribeToasts,
  type ToastRequest,
} from '../src/components/shared/toastChannel.ts'
import { pickAlertsToAnnounce, planAlertPopups } from '../src/components/shared/notificationAlerts.ts'

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const appSource = read('../src/App.tsx')
const contextSource = read('../src/AppContext.tsx')
const centerSource = read('../src/components/shared/NotificationCenter.tsx')
const hookSource = read('../src/app/useToastStack.ts')
const storefrontSource = read('../src/app/PublicCatalogAppProvider.tsx')
const popup = appSource.slice(appSource.indexOf('function Notification('), appSource.indexOf('function AppUpdateBanner'))
const notifyBody = contextSource.slice(contextSource.indexOf('const notify = useCallback'), contextSource.indexOf('const dismissNotification'))

// Durations: one constant for alerts, success and info keep today's time.
assert.equal(NOTIFICATION_ALERT_MS, 10000)
assert.equal(NOTIFICATION_SUCCESS_MS, 3500)
assert.equal(NOTIFICATION_MAX_VISIBLE, 3)
assert.equal(getNotificationDuration('error'), 10000)
assert.equal(getNotificationDuration('warning'), 10000)
assert.equal(getNotificationDuration('success'), 3500)
assert.equal(getNotificationDuration('info'), 3500)
assert.match(notifyBody, /getNotificationDuration\(type, duration\)/)
assert.doesNotMatch(notifyBody, /duration = 3500/)

// A caller that passes its own duration keeps it exactly, whatever the type.
assert.equal(getNotificationDuration('warning', 6000), 6000)
assert.equal(getNotificationDuration('warning', 8000), 8000)
assert.equal(getNotificationDuration('error', 3500), 3500)
assert.equal(getNotificationDuration('success', 20000), 20000)
assert.match(appSource, /notify\(message, 'warning', 6000\)/)
assert.match(appSource, /'warning', 8000\)/)
// The write-conflict notices raised through the context's own slot keep their 8 s timers and clearing.
assert.equal((contextSource.match(/\}, 8000\)/g) || []).length, 2)
assert.match(contextSource, /setNotification\(\(current\) => \(current\?\.id === noticeId \? null : current\)\)/)

// Pop-up shows everything, stacks, announces politely (errors assertively).
assert.doesNotMatch(popup, /truncate|line-clamp|text-ellipsis|overflow-hidden/)
assert.match(popup, /w-\[min\(24rem,calc\(100vw-1\.5rem\)\)\]/)
assert.match(popup, /role=\{toast\.type === 'error' \? 'alert' : 'status'\}/)
// Nothing in the stack takes the pointer except its own controls: a click lands on what is underneath.
assert.match(popup, /z-\[1100\] pointer-events-none flex/)
assert.match(popup, /fade-in pointer-events-none flex items-start/)
const dismissAt = popup.indexOf("aria-label={t('dismiss_notification')}")
const dismissBtn = popup.slice(dismissAt)
assert.match(dismissBtn.slice(0, 300), /holdProps\(toast\.key, 'dismiss'\)/)
assert.match(dismissBtn, /className="pointer-events-auto /)
const actionBtn = popup.slice(popup.indexOf('{toast.onActivate ? ('), dismissAt)
assert.match(actionBtn, /holdProps\(toast\.key, 'view'\)/)
assert.match(actionBtn, /pointer-events-auto/)
assert.match(actionBtn, /t\('view'\)/)
// The body is text, not a button, and the pop-up element itself carries no hover or focus handler.
const wrapper = popup.slice(popup.indexOf('role={toast.type'), popup.indexOf('{text}'))
assert.doesNotMatch(wrapper, /onMouseEnter|onFocus|onClick/)
// The clock never waits on the pointer: no hover handler anywhere in the pop-up, only keyboard focus pauses it.
assert.doesNotMatch(popup, /onMouseEnter|onMouseLeave|onPointerEnter|onPointerLeave|onMouseOver|onPointerOver|onTouchStart/)
assert.match(popup, /onFocus: \(event: FocusEvent<HTMLElement>\) => {/)
assert.match(popup, /matches\('\:focus-visible'\)/)
assert.match(popup, /onBlur: \(\) => {/)
assert.match(hookSource, /items\.slice\(0, NOTIFICATION_MAX_VISIBLE\)\.reverse\(\)/)

// A failed-action pop-up leaves nothing behind: no list state, no storage, no timer in notify.
assert.doesNotMatch(notifyBody, /localStorage|sessionStorage|indexedDB|setNotification|setTimeout/)
const seen: ToastRequest[] = []
const stop = subscribeToasts((request) => seen.push(request))
const storageCalls: string[] = []
;(globalThis as any).localStorage = { setItem: () => storageCalls.push('set'), getItem: () => null }
emitToast({ message: 'one', type: 'error', duration: 10000 })
emitToast({ message: 'two', type: 'error', duration: 10000 })
stop()
emitToast({ message: 'three', type: 'error', duration: 10000 })
assert.deepEqual(seen.map((r) => r.message), ['one', 'two'], 'two messages in one batch both arrive; none after unsubscribe')
assert.deepEqual(storageCalls, [])

// The storefront provider stays silent.
assert.match(storefrontSource, /notify: \(\) => \{\},/)

// A bell item pops once; the repeat interval decides when it may pop again; success is not an alert.
const items = [{ id: 'a', tone: 'danger' }, { id: 'b', tone: 'warning' }, { id: 'c', tone: 'success' }, { id: 'a', tone: 'danger' }]
const realert = 10 * 60000
const first = pickAlertsToAnnounce(items, {}, {}, 1_000_000, realert)
assert.deepEqual(first.map((i) => i.id), ['a', 'b'])
const announced = { a: 1_000_000, b: 1_000_000 }
assert.equal(pickAlertsToAnnounce(items, {}, announced, 1_000_000 + 60000, realert).length, 0, 'announced item does not pop twice')
assert.equal(pickAlertsToAnnounce(items, { a: 1_000_000 + 1 }, {}, 1_000_000 + 60000, realert).map((i) => i.id).join(), 'b', 'an item the bell already showed does not pop')
assert.equal(pickAlertsToAnnounce(items, {}, announced, 1_000_000 + realert, realert).length, 2, 'after the repeat interval it may pop again')
assert.equal(pickAlertsToAnnounce(items, {}, {}, 1, realert, new Set(['a'])).map((i) => i.id).join(), 'b')

// More than three new items collapse into one pop-up.
assert.deepEqual(planAlertPopups([]), { kind: 'none' })
assert.equal(planAlertPopups([1, 2, 3]).kind, 'each')
assert.deepEqual(planAlertPopups([1, 2, 3, 4]), { kind: 'many', count: 4 })

// Bell wiring: pinned mark with tooltip, repeat interval and no new request.
assert.match(centerSource, /data-notification-pin/)
assert.match(centerSource, /notification_pinned_hint', 'Stays until fixed'/)
assert.match(centerSource, /realertMinutes \* 60000, seenSecurityIds/)
assert.match(centerSource, /sectionRank\(a\.id\) - sectionRank\(b\.id\)/)

// Both packs carry the new keys, with real Khmer.
for (const lang of ['en', 'km']) {
  const pack = JSON.parse(fs.readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8'))
  assert.ok(pack.notification_pinned_hint && pack.notification_alerts_need_attention, lang)
  assert.match(pack.notification_alerts_need_attention, /\{count\}/)
}
const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8'))
assert.match(km.notification_pinned_hint, /[\u1780-\u17FF]/)

// AppContext is shared with the public storefront: the pop-up channel it raises through must not live under src/app/
// (that folder is the app-shell chunk, and importing it would drag the whole chunk into the storefront closure).
assert.match(contextSource, /from '\.\/components\/shared\/toastChannel\.ts'/)
assert.doesNotMatch(contextSource, /from '\.\/app\/appShellUtils\.ts'/)
console.log('PASS admin notify pin')
