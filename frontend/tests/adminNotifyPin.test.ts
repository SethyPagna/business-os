import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as channel from '../src/components/shared/toastChannel.ts'
import {
  alertStoreKey,
  announceFreshAlerts,
  browserAlertStore,
  mergeAlertTimes,
  popUpAlerts,
  type AlertTimes,
} from '../src/components/shared/notificationAlerts.ts'
import { toastStackTop, mobileChromeViewportOffset, AUTH_TOGGLE_TOP_REM, AUTH_TOGGLE_HEIGHT_REM, AUTH_TOGGLE_GAP_REM, authToggleBandRem } from '../src/utils/mobileNavChrome.ts'

const require = createRequire(import.meta.url)
const ts = require('typescript') as typeof import('typescript')
const React = require('react') as typeof import('react')
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')
const transpile = (source: string, jsx = false) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: jsx ? ts.JsxEmit.React : ts.JsxEmit.Preserve },
}).outputText

const appSource = read('src/App.tsx')
const contextSource = read('src/AppContext.tsx')
const centerSource = read('src/components/shared/NotificationCenter.tsx')
const hookSource = read('src/app/useToastStack.ts')
const storefrontSource = read('src/app/PublicCatalogAppProvider.tsx')
const { NOTIFICATION_ALERT_MS, NOTIFICATION_MAX_VISIBLE, NOTIFICATION_SUCCESS_MS, emitToast, getNotificationDuration } = channel

// ---------------------------------------------------------------------------------------------------------
// Harness: the real useToastStack.ts on a virtual clock and a minimal React, no jsdom.
// ---------------------------------------------------------------------------------------------------------
let now = 0
let timerId = 0
const timers = new Map<number, { at: number; fn: () => void }>()
Date.now = () => now
;(globalThis as any).window = {
  setTimeout: (fn: () => void, ms: number) => { const id = ++timerId; timers.set(id, { at: now + (Number(ms) || 0), fn }); return id },
  clearTimeout: (id: number) => { timers.delete(id) },
}
let hooks: any[] = []
let hookIndex = 0
let pendingEffects: Array<() => void> = []
let dirty = false
const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
const FakeReact = {
  useState(init: unknown) {
    const i = hookIndex++
    if (!(i in hooks)) hooks[i] = { v: typeof init === 'function' ? (init as () => unknown)() : init }
    const h = hooks[i]
    return [h.v, (u: unknown) => { h.v = typeof u === 'function' ? (u as (v: unknown) => unknown)(h.v) : u; dirty = true }]
  },
  useRef(init: unknown) { const i = hookIndex++; if (!(i in hooks)) hooks[i] = { current: init }; return hooks[i] },
  useCallback(fn: unknown, deps: unknown[]) { const i = hookIndex++; const h = hooks[i]; if (h && same(h.deps, deps)) return h.fn; hooks[i] = { fn, deps }; return fn },
  useEffect(fn: () => unknown, deps: unknown[]) {
    const i = hookIndex++
    const h = hooks[i]
    if (h && deps && same(h.deps, deps)) return
    pendingEffects.push(() => { if (h?.cleanup) h.cleanup(); hooks[i] = { deps, cleanup: fn() } })
  },
}
const hookExports: any = {}
new Function('exports', 'require', transpile(hookSource))(hookExports, (name: string) => (name === 'react' ? FakeReact : channel))
const { useToastStack, limitForDialog, observeDialogOpen, slotToast } = hookExports

type Slot = { id?: number; message: string; type?: string } | null
class Screen {
  slot: Slot = null
  out: any
  constructor() { hooks = []; hookIndex = 0; pendingEffects = []; dirty = false; this.render(); this.settle() }
  render() { hookIndex = 0; dirty = false; this.out = useToastStack(this.slot); const effects = pendingEffects; pendingEffects = []; effects.forEach((run) => run()) }
  settle() { for (let guard = 0; dirty && guard < 50; guard++) this.render() }
  setSlot(slot: Slot) { this.slot = slot; this.render(); this.settle() }
  emit(message: string, type = 'error', duration?: number) {
    emitToast({ message, type, duration: getNotificationDuration(type, duration) })
    this.settle()
  }
  advance(ms: number) {
    const end = now + ms
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null
      for (const entry of timers) if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry
      if (!next) break
      timers.delete(next[0]); now = next[1].at; next[1].fn(); this.settle()
    }
    now = end
  }
  get shown(): string[] { return this.out.visible.map((t: any) => t.message) }
  unmount() { hooks.forEach((h) => h?.cleanup?.()) }
}
const reset = () => { channel.resetToastStack(); now = 0; timers.clear() }

// Durations: one constant for alerts, success and info keep today's time; an explicit duration is kept exactly.
assert.equal(NOTIFICATION_ALERT_MS, 10000)
assert.equal(NOTIFICATION_SUCCESS_MS, 3500)
assert.equal(NOTIFICATION_MAX_VISIBLE, 3)
assert.equal(getNotificationDuration('error'), 10000)
assert.equal(getNotificationDuration('warning'), 10000)
assert.equal(getNotificationDuration('success'), 3500)
assert.equal(getNotificationDuration('info'), 3500)
assert.equal(getNotificationDuration('warning', 6000), 6000)
assert.equal(getNotificationDuration('error', 3500), 3500)

// F2: the newest message is on screen at once. A fourth pushes the oldest off immediately; there is no waiting list.
{
  reset()
  const s = new Screen()
  for (const m of ['a', 'b', 'c']) s.emit(m)
  assert.deepEqual(s.shown, ['c', 'b', 'a'], 'newest on top')
  s.emit('d')
  assert.deepEqual(s.shown, ['d', 'c', 'b'], 'the fourth shows now and the oldest leaves now')
  for (const m of ['e', 'f']) s.emit(m)
  assert.deepEqual(s.shown, ['f', 'e', 'd'], 'a burst of six: the last three, immediately')
  assert.equal(timers.size, 3, 'an evicted pop-up leaves no timer behind')
  s.unmount()
  // Clocks start when a pop-up is shown: the fourth message gets its full ten seconds from its own arrival.
  reset()
  const t = new Screen()
  for (const m of ['a', 'b', 'c']) t.emit(m)
  t.advance(5000)
  t.emit('d')
  t.advance(5000)
  assert.deepEqual(t.shown, ['d'], 'a, b and c leave at 10 s; d (shown at 5 s) is still up')
  t.advance(4999)
  assert.deepEqual(t.shown, ['d'])
  t.advance(1)
  assert.deepEqual(t.shown, [], 'd leaves 10 s after it was shown')
  t.unmount()
}

// An identical message (same text and type) restarts that pop-up's clock instead of stacking a second one.
{
  reset()
  const s = new Screen()
  s.emit('same')
  s.advance(6000)
  s.emit('same')
  assert.deepEqual(s.shown, ['same'], 'one pop-up, not two')
  s.advance(5000)
  assert.deepEqual(s.shown, ['same'], 'the clock restarted at 6 s')
  s.advance(5000)
  assert.deepEqual(s.shown, [])
  s.emit('same', 'error')
  s.emit('same', 'warning')
  assert.equal(s.shown.length, 2, 'the same text with another type is a different message')
  s.unmount()
}

// Success keeps its short time; pause and resume arithmetic; unmount clears every timer.
{
  reset()
  const s = new Screen()
  s.emit('saved', 'success')
  s.advance(3499)
  assert.deepEqual(s.shown, ['saved'])
  s.advance(1)
  assert.deepEqual(s.shown, [])
  s.emit('read me')
  const key = s.out.visible[0].key
  s.advance(4000); s.out.pause(key); s.advance(60000)
  assert.deepEqual(s.shown, ['read me'], 'a paused pop-up stays')
  s.out.resume(key); s.advance(5999)
  assert.deepEqual(s.shown, ['read me'])
  s.advance(1)
  assert.deepEqual(s.shown, [])
  s.emit('u1'); s.emit('u2')
  assert.equal(timers.size, 2)
  s.unmount()
  assert.equal(timers.size, 2, 'unmounting a screen stops nothing: the clocks belong to the channel')
  const again = new Screen()
  again.advance(10000)
  assert.deepEqual(again.shown, [], 'the clocks still run out')
  assert.equal(timers.size, 0)
  again.unmount()
}

// F7: a message the context raises through its own slot is drawn above the stack at once, replaced by the next slot
// message, and never delayed or dropped by the stack.
{
  reset()
  const s = new Screen()
  for (const m of ['q1', 'q2', 'q3', 'q4']) s.emit(m, 'warning')
  s.setSlot({ id: 1, message: 'WRITE-CONFLICT', type: 'error' })
  assert.equal(s.out.slot.message, 'WRITE-CONFLICT', 'shown at once with a full stack')
  assert.equal(s.out.slot.fromSlot, true)
  assert.equal(s.shown.length, 3, 'the stack is untouched by the slot')
  s.setSlot({ id: 2, message: 'FORCED-SIGN-OUT', type: 'error' })
  assert.equal(s.out.slot.message, 'FORCED-SIGN-OUT', 'a later slot message replaces the earlier one')
  s.advance(20000)
  assert.equal(s.out.slot.message, 'FORCED-SIGN-OUT', 'the stack never times the slot; the context clears it')
  s.setSlot(null)
  assert.equal(s.out.slot, null)
  assert.equal(slotToast({ message: '' }), null)
  s.unmount()
}

// F10 / D: a notify raised while no screen is mounted (the instant a screen swaps) is kept for its own lifetime and
// shown by the next screen; it is not dropped.
{
  reset()
  emitToast({ message: 'signed out elsewhere', type: 'error', duration: getNotificationDuration('error') })
  emitToast({ message: 'too old', type: 'success', duration: getNotificationDuration('success') })
  now = 4000
  const login = new Screen()
  assert.deepEqual(login.shown, ['signed out elsewhere'], 'shown on the screen that mounts next; the expired one is not')
  login.unmount()
  // Four held at once keep the newest three.
  reset()
  for (const m of ['h1', 'h2', 'h3', 'h4']) emitToast({ message: m, type: 'error', duration: 10000 })
  const next = new Screen()
  assert.deepEqual(next.shown, ['h4', 'h3', 'h2'])
  next.unmount()
}
// N1: a pop-up survives a screen switch. App draws the stack from a different <Notification> on each screen; the
// list and its clocks live in the channel, so the next screen shows the same pop-up and expires it at its own time.
{
  reset()
  const boot = new Screen()
  boot.emit('eight seconds', 'warning', 8000)
  boot.advance(2000)
  boot.unmount()
  const shell = new Screen()
  assert.deepEqual(shell.shown, ['eight seconds'], 'the next screen draws it at once')
  shell.advance(5999)
  assert.deepEqual(shell.shown, ['eight seconds'], 'still up 7.999 s after it arrived')
  shell.advance(1)
  assert.deepEqual(shell.shown, [], 'gone 8 s after its original arrival, not earlier and not at 10 s')
  shell.unmount()
  // Screen after screen: three swaps, one clock.
  reset()
  const a = new Screen()
  a.emit('long read', 'error')
  a.advance(4000); a.unmount()
  const b = new Screen()
  b.advance(4000); b.unmount()
  const c = new Screen()
  assert.deepEqual(c.shown, ['long read'])
  c.advance(1999)
  assert.deepEqual(c.shown, ['long read'])
  c.advance(1)
  assert.deepEqual(c.shown, [])
  c.unmount()
  // A dismissal on one screen holds on the next; a mounted screen and a swapped-in one see the same list.
  reset()
  const d = new Screen()
  d.emit('one'); d.emit('two')
  d.out.dismiss(d.out.visible[0].key)
  d.unmount()
  const e = new Screen()
  assert.deepEqual(e.shown, ['one'])
  e.unmount()
}

// Hardening: a duration that is not a positive number must not make a pop-up vanish at once; it gets its type's own time.
{
  for (const bad of [Infinity, NaN, 0, -5]) {
    reset()
    const s = new Screen()
    emitToast({ message: 'warn', type: 'warning', duration: bad })
    emitToast({ message: 'ok', type: 'success', duration: bad })
    s.settle()
    assert.deepEqual(s.shown, ['ok', 'warn'], 'duration ' + bad + ' shows')
    s.advance(3500)
    assert.deepEqual(s.shown, ['warn'], 'success (' + bad + ') lasts its 3.5 s')
    s.advance(6499)
    assert.deepEqual(s.shown, ['warn'])
    s.advance(1)
    assert.deepEqual(s.shown, [], 'warning (' + bad + ') lasts its 10 s')
    s.unmount()
  }
}

// Hardening: an identical message arriving while keyboard focus holds that pop-up restarts its clock but keeps the hold.
{
  reset()
  const s = new Screen()
  s.emit('same')
  const key = s.out.visible[0].key
  s.advance(2000)
  s.out.pause(key)
  s.advance(1000)
  s.emit('same')
  assert.equal(s.shown.length, 1)
  s.advance(60000)
  assert.deepEqual(s.shown, ['same'], 'still held by focus after the identical message arrived')
  s.out.resume(key)
  s.advance(9999)
  assert.deepEqual(s.shown, ['same'], 'a full fresh 10 s once focus leaves')
  s.advance(1)
  assert.deepEqual(s.shown, [])
  s.unmount()
}

// The screens that carry no shell mount the stack: the boot shell, the sign-in screen and the forced password change.
{
  const branch = (from: string, to: string) => appSource.slice(appSource.indexOf(from), appSource.indexOf(to, appSource.indexOf(from)))
  assert.match(branch('<Login />', '</Suspense>') + appSource.slice(appSource.indexOf('<Login />') - 400, appSource.indexOf('<Login />')), /<Notification notification=\{notification\}/)
  assert.match(appSource.slice(appSource.indexOf('<ForcedPasswordChange />'), appSource.indexOf('<ForcedPasswordChange />') + 300), /<Notification notification=\{notification\}/)
  assert.match(appSource.slice(appSource.indexOf('Preparing secure sign-in') - 1400, appSource.indexOf('Preparing secure sign-in')), /<Notification notification=\{notification\}/)
}

// notify: a failed-action pop-up leaves nothing behind (no storage, no timer); a pop-up replaces the context slot as before.
{
  const notifyBody = contextSource.slice(contextSource.indexOf('const notify = useCallback'), contextSource.indexOf('const dismissNotification'))
  assert.match(notifyBody, /getNotificationDuration\(type, duration\)/)
  assert.doesNotMatch(notifyBody, /localStorage|sessionStorage|indexedDB|setTimeout|duration = 3500/)
  assert.match(notifyBody, /setNotification\(null\)/)
  assert.match(appSource, /notify\(message, 'warning', 6000\)/)
  assert.match(appSource, /'warning', 8000\)/)
  assert.equal((contextSource.match(/\}, 8000\)/g) || []).length, 2, 'the write-conflict notices keep their 8 s timers')
  assert.match(contextSource, /setNotification\(\(current\) => \(current\?\.id === noticeId \? null : current\)\)/)
  assert.match(storefrontSource, /notify: \(\) => \{\},/)
  assert.match(contextSource, /from '\.\/components\/shared\/toastChannel\.ts'/)
  assert.doesNotMatch(contextSource, /from '\.\/app\/appShellUtils\.ts'/)
}

// ---------------------------------------------------------------------------------------------------------
// Bell items: pop once per device, warning and danger only, ten seconds, memory merged and per user.
// ---------------------------------------------------------------------------------------------------------
const memoryStore = (backing: { times: AlertTimes } = { times: {} }) => ({
  backing,
  read: () => ({ ...backing.times }),
  write: (times: AlertTimes) => { backing.times = { ...times } },
})
const items = [
  { id: 'out-1', tone: 'danger' }, { id: 'pay-2', tone: 'warning' }, { id: 'delivery-3', tone: 'info' },
  { id: 'loyalty-4', tone: 'success' }, { id: 'out-1', tone: 'danger' },
]
const loadAt = (store: ReturnType<typeof memoryStore>, at: number, extra: Partial<Parameters<typeof announceFreshAlerts>[0]> = {}) =>
  announceFreshAlerts({ items, blocked: false, seenTimes: {}, now: at, store, ...extra } as any) as any
{
  const store = memoryStore()
  const first = loadAt(store, 1_000_000)
  assert.deepEqual(first.items.map((i: any) => i.id), ['out-1', 'pay-2'], 'a danger and a warning pop; info and success never do; one pop-up per id')
  assert.deepEqual(Object.keys(store.backing.times).sort(), ['out-1', 'pay-2'], 'marked as shown before anything is emitted')
  assert.equal(loadAt(store, 1_000_000 + 60_000).kind, 'none', 'not again on the next load')
  assert.equal(loadAt(store, 1_000_000 + 11 * 60_000).kind, 'none', 'nor after the old repeat interval: it stays quiet while unresolved')
  assert.equal(loadAt(store, 1_000_000 + 24 * 3600_000).kind, 'none', 'nor a day later')
  assert.deepEqual(loadAt(memoryStore(), 5, { items: [{ id: 'a', tone: 'info' }, { id: 'b', tone: 'success' }] }), { kind: 'none' })
  // An item the bell already showed (its seen memory) does not pop; the security skip list is honoured.
  assert.deepEqual(loadAt(memoryStore(), 5, { seenTimes: { 'out-1': 4 } }).items.map((i: any) => i.id), ['pay-2'])
  assert.deepEqual(loadAt(memoryStore(), 5, { skipIds: new Set(['pay-2']) }).items.map((i: any) => i.id), ['out-1'])
  // More than three new items in one load collapse into one pop-up; N is what popped in this load.
  const many = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, tone: 'warning' }))
  assert.deepEqual(loadAt(memoryStore(), 5, { items: many }), { kind: 'many', count: 5 })
  assert.equal(loadAt(memoryStore(), 5, { items: many.slice(0, 3) }).kind, 'each')
  // While the bell panel is open (or the bell is hidden or unavailable) nothing pops and nothing is marked shown;
  // the item pops when it can.
  const blocked = memoryStore()
  assert.deepEqual(loadAt(blocked, 7, { blocked: true }), { kind: 'none' })
  assert.deepEqual(blocked.backing.times, {})
  assert.equal(loadAt(blocked, 8).kind, 'each')
}
assert.match(centerSource, /const blocked = !visibilityActive \|\| open \|\| !!summary\.unavailable/, 'the bell passes its open, hidden and unavailable state in')
assert.match(centerSource, /store: browserAlertStore\(user\?\.id\)/)
assert.doesNotMatch(centerSource, /realertMinutes \* 60000, seenSecurityIds/, 'the Settings repeat interval no longer re-pops anything')
assert.doesNotMatch(read('src/components/shared/notificationAlerts.ts'), /realert/i)

// The popped alert's request: ten seconds, danger as an error and warning as a warning, View opens the bell on the item.
{
  reset()
  const opened: unknown[] = []
  popUpAlerts({ kind: 'each', items: [{ id: 'out-1', tone: 'danger' }, { id: 'pay-2', tone: 'warning' }] }, {
    itemMessage: (item) => `text of ${item.id}`,
    manyMessage: (count) => `${count} need attention`,
    open: (item) => opened.push(item?.id ?? null),
  })
  popUpAlerts({ kind: 'many', count: 7 }, { itemMessage: () => '', manyMessage: (count) => `${count} need attention`, open: (item) => opened.push(item?.id ?? null) })
  const seen: any[] = [...channel.getToastStack()]
  assert.deepEqual(seen.map((r) => [r.message, r.type, r.duration]), [
    ['text of out-1', 'error', 10000], ['text of pay-2', 'warning', 10000], ['7 need attention', 'warning', 10000],
  ])
  seen.forEach((r) => r.onActivate())
  assert.deepEqual(opened, ['out-1', 'pay-2', null])
  // A bell-item pop-up on the real stack lasts exactly ten seconds.
  reset()
  const s = new Screen()
  popUpAlerts({ kind: 'each', items: [{ id: 'x', tone: 'danger' }] }, { itemMessage: () => 'Out of stock', manyMessage: () => '', open: () => {} })
  s.settle()
  s.advance(9999)
  assert.deepEqual(s.shown, ['Out of stock'])
  s.advance(1)
  assert.deepEqual(s.shown, [])
  s.unmount()
}
// The pop-up text is the bell row's own text, from one shared function.
assert.match(centerSource, /const itemText = useCallback/)
assert.match(centerSource, /\.\.\.item, \.\.\.itemText\(item\)/)
assert.match(centerSource, /const \{ displayLabel, displayMeta \} = itemText\(item\)/)

// F4: the shown-memory is read fresh on every run and merged by latest time, so two tabs or the desktop and phone
// instances never erase each other or pop each other's items; each signed-in user has their own.
{
  const disk = new Map<string, string>()
  ;(globalThis as any).window.localStorage = { getItem: (k: string) => disk.get(k) ?? null, setItem: (k: string, v: string) => { disk.set(k, v) } }
  const key = alertStoreKey('u1')
  assert.notEqual(key, alertStoreKey('u2'))
  const a = (id: string, at: number) => announceFreshAlerts({ items: [{ id, tone: 'danger' }], blocked: false, seenTimes: {}, now: at, store: browserAlertStore('u1') })
  assert.equal(a('one', 100).kind, 'each')
  disk.set(key, JSON.stringify({ ...JSON.parse(disk.get(key) as string), two: 200 }))
  assert.equal(a('three', 300).kind, 'each')
  assert.deepEqual(JSON.parse(disk.get(key) as string), { one: 100, two: 200, three: 300 }, "another tab's entry survives this write")
  assert.equal(a('two', 400).kind, 'none', "another tab's item does not pop again here")
  assert.equal(announceFreshAlerts({ items: [{ id: 'one', tone: 'danger' }], blocked: false, seenTimes: {}, now: 500, store: browserAlertStore('u2') }).kind, 'each', 'a second account on the device gets its own memory')
  assert.deepEqual(mergeAlertTimes({ a: 1, b: 9 }, { a: 5, c: 2 }), { a: 5, b: 9, c: 2 })
  // Storage that refuses writes still pops an item once per page life.
  ;(globalThis as any).window.localStorage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  const denied = (id: string) => announceFreshAlerts({ items: [{ id, tone: 'danger' }], blocked: false, seenTimes: {}, now: 1, store: browserAlertStore('u3') }).kind
  assert.equal(denied('z'), 'each')
  assert.equal(denied('z'), 'none')
}

// ---------------------------------------------------------------------------------------------------------
// F1: where the stack sits, and what it does while a dialog is open.
// ---------------------------------------------------------------------------------------------------------
assert.equal(toastStackTop({ headerPresent: true, appUpdateVisible: false }).phone, 'calc(4.75rem + env(safe-area-inset-top))')
assert.equal(toastStackTop({ headerPresent: true, appUpdateVisible: true }).phone, 'calc(7.75rem + env(safe-area-inset-top))')
assert.equal(toastStackTop({ headerPresent: false, appUpdateVisible: false }).phone, 'calc(0.75rem + env(safe-area-inset-top))')
assert.equal(toastStackTop({ headerPresent: false, appUpdateVisible: true }).tablet, 'calc(4.25rem + env(safe-area-inset-top))')
assert.equal(toastStackTop({ headerPresent: true, appUpdateVisible: false }).tablet, '1.25rem')
// It starts below the very edge the top bar ends at (the same source of truth the bar and the page padding use).
for (const appUpdateVisible of [false, true]) {
  const edge = mobileChromeViewportOffset({ headerVisible: true, appUpdateVisible })
  const rem = (text: string) => Number(text.match(/calc\(([\d.]+)rem/)?.[1])
  assert.ok(rem(toastStackTop({ headerPresent: true, appUpdateVisible }).phone) > rem(edge), 'below the top bar')
  assert.match(toastStackTop({ headerPresent: true, appUpdateVisible }).phone, /env\(safe-area-inset-top\)/)
}
// N2: on the signed-out screens the stack starts under the sign-in toggles; the shell keeps its own offsets. Login and the
// stack read one shared constant, so the two cannot drift.
{
  const safe = (rem: number) => `calc(${rem}rem + env(safe-area-inset-top))`
  const auth = toastStackTop({ headerPresent: false, appUpdateVisible: false, authScreen: true })
  assert.equal(authToggleBandRem('phone'), AUTH_TOGGLE_TOP_REM.phone + AUTH_TOGGLE_HEIGHT_REM + AUTH_TOGGLE_GAP_REM)
  assert.equal(authToggleBandRem('phone'), 4.75, "Login's own phone clearance (--auth-top)")
  assert.equal(auth.phone, safe(authToggleBandRem('phone')))
  assert.equal(auth.sm, safe(authToggleBandRem('sm')))
  assert.equal(auth.tablet, safe(authToggleBandRem('sm')), 'md keeps the toggles at their sm place')
  assert.equal(auth.desktop, safe(authToggleBandRem('lg')))
  for (const step of ['phone', 'sm', 'lg'] as const) {
    assert.ok(authToggleBandRem(step) > AUTH_TOGGLE_TOP_REM[step] + AUTH_TOGGLE_HEIGHT_REM - 1e-9, 'the stack starts below the toggle row at ' + step)
  }
  assert.deepEqual(toastStackTop({ headerPresent: false, appUpdateVisible: true, authScreen: true }), auth, 'an update bar never moves the sign-in offset above the toggles')
  const shell = toastStackTop({ headerPresent: true, appUpdateVisible: false })
  assert.deepEqual(shell, { phone: safe(4.75), sm: safe(4.75), tablet: '1.25rem', desktop: '1.25rem' }, "the shell's offsets are unchanged")
  assert.notDeepEqual(shell, auth)
  // Login places its toggles from the same constants, with no second copy of the numbers.
  const loginSource = read('src/components/auth/Login.tsx')
  assert.ok(loginSource.includes("import { AUTH_TOGGLE_TOP_REM, authToggleBandRem } from '../../utils/mobileNavChrome.ts'"))
  assert.ok(loginSource.includes('absolute right-4 top-[var(--auth-toggle-top)]'))
  assert.ok(loginSource.includes('sm:top-[var(--auth-toggle-top-sm)]'))
  assert.ok(loginSource.includes('lg:top-[var(--auth-toggle-top-lg)]'))
  assert.ok(!loginSource.includes('absolute right-4 top-4'), 'no hard-coded toggle offset')
  assert.ok(!loginSource.includes('[--auth-top:4.75rem]'), 'no hard-coded phone band')
  // The sign-in and boot screens ask for the signed-out offset; the shell and the forced password change do not.
  assert.equal(appSource.split('appUpdateVisible={!!appUpdate} authScreen />').length - 1, 2)
  assert.ok(appSource.includes('toastStackTop({ headerPresent, appUpdateVisible, authScreen })'))
}
assert.deepEqual(limitForDialog(['a', 'b', 'c'], false, true), ['a', 'b', 'c'], 'no dialog: every pop-up')
assert.deepEqual(limitForDialog(['a', 'b', 'c'], true, false), ['a', 'b', 'c'], 'a dialog on a wide screen: the stack stays')
assert.deepEqual(limitForDialog(['a', 'b', 'c'], true, true), ['a'], 'a dialog below 768 px: one pop-up')

// The dialog watcher is event-driven: a MutationObserver, no timer.
{
  reset()
  let modal = false
  const drawn = { getClientRects: () => ({ length: 1 }) }
  const undrawn = { getClientRects: () => ({ length: 0 }) }
  // The session-quarantine host is always in the body with aria-modal and display:none: it must never count as an open dialog.
  const doc = { body: {}, querySelectorAll: (sel: string) => { assert.equal(sel, '[aria-modal="true"]'); return modal ? [undrawn, drawn] : [undrawn] } }
  let trigger: () => void = () => {}
  let disconnected = 0
  const Observer = class { constructor(cb: () => void) { trigger = cb } observe() {} disconnect() { disconnected++ } }
  const states: boolean[] = []
  const stop = observeDialogOpen(doc, Observer as any, (open: boolean) => states.push(open))
  modal = true; trigger()
  modal = false; trigger()
  assert.deepEqual(states, [false, true, false])
  assert.equal(timers.size, 0, 'no polling timer')
  stop()
  assert.equal(disconnected, 1)
  assert.match(hookSource, /MutationObserver/)
  assert.doesNotMatch(hookSource.slice(hookSource.indexOf('export function observeDialogOpen')), /setInterval|setTimeout/)
}

// The real Notification component, rendered with injected hooks: controls, live regions, focus, copy.
const component = (() => {
  const parsed = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const decl = parsed.statements.find((st) => ts.isFunctionDeclaration(st) && st.name?.text === 'Notification') as import('typescript').FunctionDeclaration
  const icon = parsed.statements.find((st) => ts.isFunctionDeclaration(st) && st.name?.text === 'ToastIcon') as import('typescript').FunctionDeclaration
  const paths = parsed.statements.find((st) => ts.isVariableStatement(st) && st.getText(parsed).startsWith('const TOAST_ICON_PATHS')) as import('typescript').VariableStatement
  return transpile(`${paths.getText(parsed)}\n${icon.getText(parsed)}\n${decl.getText(parsed)}`, true)
})()
const packs: Record<string, Record<string, string>> = Object.fromEntries(['en', 'km'].map((l) => [l, JSON.parse(read(`src/lang/${l}.json`))]))
type Entry = { key: string; message: string; type: string; duration: number; fromSlot?: boolean; onActivate?: () => void }
function loadNotification(opts: { visible: Entry[]; slot?: Entry | null; dialogOpen?: boolean; narrow?: boolean; lang?: string; dismissed?: string[]; refs?: any[]; doc?: any }) {
  const win = { requestAnimationFrame: (fn: () => void) => { fn(); return 1 } }
  const factory = new Function('React', 'useRef', 'useApp', 'useToastStack', 'useDialogOpen', 'useNarrowViewport', 'limitForDialog', 'toastStackTop', 'getNotificationColor', 'getNotificationKind', 'createPortal', 'document', 'window', `${component}\nreturn Notification`)
  return factory(
    React,
    (initial: unknown) => { const ref = { current: initial }; opts.refs?.push(ref); return ref },
    () => ({ t: (k: string) => packs[opts.lang || 'en'][k] ?? k }),
    () => ({ visible: opts.visible, slot: opts.slot ?? null, dismiss: (k: string) => opts.dismissed?.push(k), pause() {}, resume() {} }),
    () => !!opts.dialogOpen,
    () => !!opts.narrow,
    hookExports.limitForDialog,
    toastStackTop,
    () => 'bg-red-600',
    (type: string) => (type === 'success' || type === 'error' || type === 'warning' ? type : 'info'),
    (node: unknown) => node,
    opts.doc ?? { body: {}, activeElement: null },
    win,
  ) as (props: any) => any
}
const toast = (key: string, message: string, type = 'warning', extra: Partial<Entry> = {}): Entry => ({ key, message, type, duration: 10000, ...extra })
const render = (opts: Parameters<typeof loadNotification>[0], props: any = {}) => renderToStaticMarkup(loadNotification(opts)({ notification: null, appUpdateVisible: false, headerPresent: true, ...props }))
const find = (node: any, test: (el: any) => boolean, found: any[] = []): any[] => {
  if (!node || typeof node !== 'object') return found
  if (Array.isArray(node)) { node.forEach((n) => find(n, test, found)); return found }
  if (node.props && test(node)) found.push(node)
  if (node.props?.children) find(node.props.children, test, found)
  return found
}

{
  // No dialog: Dismiss and View take input, are 40 px, and the pop-ups themselves are not live regions.
  const html = render({ visible: [toast('t1', 'Out of stock: Rose serum', 'error', { onActivate: () => {} })] })
  assert.match(html, /pointer-events-auto[^"]*h-10 w-10/)
  assert.match(html, /pointer-events-auto[^"]*min-h-10/)
  assert.doesNotMatch(html.slice(html.indexOf('data-toast-type')), /role=|aria-live/, 'the visible pop-up carries no live-region attributes')
  assert.doesNotMatch(html, /truncate|line-clamp|text-ellipsis|overflow-hidden/, 'full text, never cut')
  assert.match(html, /w-\[min\(24rem,calc\(100vw-1\.5rem\)\)\]/)
  assert.match(html, /--toast-top:calc\(4\.75rem \+ env\(safe-area-inset-top\)\)/)
  // F1: a dialog is open, so every control is display-only and below 768 px only one pop-up shows.
  const open = render({ dialogOpen: true, narrow: true, visible: [toast('t1', 'newest', 'error', { onActivate: () => {} }), toast('t2', 'older'), toast('t3', 'oldest')] })
  assert.equal((open.match(/data-toast-type/g) || []).length, 1, 'one pop-up below 768 px while a dialog is open')
  assert.doesNotMatch(open, /pointer-events-auto/, 'no control takes pointer input while a dialog is open')
  assert.match(open, /pointer-events-none[^"]*h-10 w-10/)
  assert.match(open, /tabindex="-1"/)
  assert.match(open, /newest/)
  const wide = render({ dialogOpen: true, narrow: false, visible: [toast('t1', 'a'), toast('t2', 'b')] })
  assert.equal((wide.match(/data-toast-type/g) || []).length, 2)
  // The update bar and a phone top bar move the stack down.
  assert.match(render({ visible: [toast('t1', 'x')] }, { appUpdateVisible: true }), /--toast-top:calc\(7\.75rem \+ env\(safe-area-inset-top\)\)/)
  assert.match(render({ visible: [toast('t1', 'x')] }, { headerPresent: false }), /--toast-top:calc\(0\.75rem \+ env\(safe-area-inset-top\)\)/)
  // N2: the signed-out screens start the stack under the sign-in toggles, from the shared constant.
  const authHtml = render({ visible: [toast('t1', 'x')] }, { authScreen: true, headerPresent: false })
  assert.ok(authHtml.includes('--toast-top:calc(4.75rem + env(safe-area-inset-top))'))
  assert.ok(authHtml.includes('--toast-top-sm:calc(5.25rem + env(safe-area-inset-top))'))
  assert.ok(authHtml.includes('--toast-top-lg:calc(5.75rem + env(safe-area-inset-top))'))
  // The slot message sits above the stack and counts as one of the pop-ups under a dialog.
  const withSlot = render({ slot: toast('slot-1', 'WRITE CONFLICT', 'error', { fromSlot: true }), visible: [toast('t1', 'queued')] })
  const drawn = withSlot.slice(withSlot.indexOf('data-toast-type'))
  assert.ok(drawn.indexOf('WRITE CONFLICT') >= 0 && drawn.indexOf('WRITE CONFLICT') < drawn.indexOf('queued'))
  const slotUnderDialog = render({ dialogOpen: true, narrow: true, slot: toast('slot-1', 'WRITE CONFLICT', 'error', { fromSlot: true }), visible: [toast('t1', 'queued')] })
  assert.equal((slotUnderDialog.match(/data-toast-type/g) || []).length, 1)
}

// H: two live regions are always mounted, even with nothing to say; errors go to the assertive one only.
{
  const empty = render({ visible: [] })
  assert.match(empty, /role="status" aria-live="polite"/)
  assert.match(empty, /role="alert" aria-live="assertive"/)
  assert.doesNotMatch(empty, /data-toast-dismiss/)
  const html = render({ visible: [toast('t1', 'Saved failed', 'error'), toast('t2', 'Careful', 'warning')] })
  const polite = html.slice(html.indexOf('aria-live="polite"'), html.indexOf('aria-live="assertive"'))
  const assertive = html.slice(html.indexOf('aria-live="assertive"'), html.indexOf('data-toast-type'))
  assert.match(polite, /Careful/)
  assert.doesNotMatch(polite, /Saved failed/)
  assert.match(assertive, /Saved failed/)
  assert.doesNotMatch(assertive, /Careful/)
}

// H: after a keyboard dismiss, focus goes to the next pop-up's dismiss control, or back to where it was.
{
  const focusLog: string[] = []
  const control = (name: string) => ({ name, isConnected: true, focus: () => focusLog.push(name) })
  const first = control('first-x')
  const second = control('second-x')
  const dismissed: string[] = []
  const refs: any[] = []
  const doc = { body: {}, activeElement: first }
  const Notification = loadNotification({ visible: [toast('t1', 'one'), toast('t2', 'two')], dismissed, refs, doc })
  const node = Notification({ notification: null, appUpdateVisible: false, headerPresent: true })
  refs[0].current = { contains: () => false, querySelectorAll: () => [first, second] }
  const dismissButtons = find(node, (el) => el.props['data-toast-dismiss'] !== undefined)
  assert.equal(dismissButtons.length, 2)
  dismissButtons[0].props.onClick({ detail: 0, currentTarget: first })
  assert.deepEqual(dismissed, ['t1'])
  assert.deepEqual(focusLog, ['second-x'], 'keyboard dismiss moves focus to the next pop-up')
  // The last pop-up: focus returns to the control that had it before the pop-up took it.
  focusLog.length = 0
  const lastRefs: any[] = []
  const lastDoc = { body: {}, activeElement: second }
  const Last = loadNotification({ visible: [toast('t9', 'only')], dismissed: [], refs: lastRefs, doc: lastDoc })
  const lastNode = Last({ notification: null, appUpdateVisible: false, headerPresent: true })
  const origin = control('where-it-was')
  lastRefs[0].current = { contains: () => false, querySelectorAll: () => [second] }
  const only = find(lastNode, (el) => el.props['data-toast-dismiss'] !== undefined)[0]
  only.props.onFocus({ relatedTarget: origin, currentTarget: { matches: () => true } })
  only.props.onClick({ detail: 0, currentTarget: second })
  assert.deepEqual(focusLog, ['where-it-was'])
  // A mouse click (detail 1) never steals focus.
  focusLog.length = 0
  only.props.onClick({ detail: 1, currentTarget: second })
  assert.deepEqual(focusLog, [])
}

// I: a type icon replaces the English text prefixes; the type word for screen readers is translated.
{
  assert.doesNotMatch(read('src/app/appShellUtils.ts'), /'OK '|'ERR '|'WARN '|'INFO '/)
  assert.doesNotMatch(appSource, /getNotificationPrefix/)
  const html = render({ visible: [toast('t1', 'x', 'error'), toast('t2', 'y', 'success'), toast('t3', 'z', 'warning'), toast('t4', 'w', 'info')] })
  assert.doesNotMatch(html, />(OK|ERR|WARN|INFO) /)
  for (const kind of ['error', 'success', 'warning', 'info']) assert.match(html, new RegExp(`data-toast-type="${kind}"`))
  assert.ok((html.match(/<svg class="mt-0\.5 h-4 w-4 shrink-0"/g) || []).length === 4, 'one icon per pop-up')
  const km = render({ lang: 'km', visible: [toast('t1', 'x', 'error')] })
  assert.match(km, /កំហុស: x/)
  assert.match(render({ lang: 'en', visible: [toast('t1', 'x', 'error')] }), /Error: x/)
  for (const lang of ['en', 'km']) {
    for (const key of ['toast_type_success', 'toast_type_error', 'toast_type_warning', 'toast_type_info', 'notification_pinned_hint', 'notification_alerts_need_attention']) assert.ok(packs[lang][key], `${lang} ${key}`)
    assert.match(packs[lang].notification_alerts_need_attention, /\{count\}/)
  }
  assert.equal(packs.km.notification_alerts_need_attention, 'មានការជូនដំណឹង {count} ត្រូវដោះស្រាយ')
  for (const key of ['toast_type_success', 'toast_type_error', 'toast_type_warning', 'toast_type_info']) assert.match(packs.km[key], /[ក-៿]/)
}

// Pin mark: only warning and danger rows; the bell's section order is main's.
assert.match(centerSource, /\(item\.tone === 'danger' \|\| item\.tone === 'warning'\) && section\.id !== 'imports'/)
assert.match(centerSource, /data-notification-pin/)
assert.doesNotMatch(centerSource, /sectionRank/)
assert.match(centerSource, /\.sort\(\(a, b\) => \(a\.id === 'security' \? -1 : b\.id === 'security' \? 1 : 0\)\)/)

console.log('PASS admin notify pin')
