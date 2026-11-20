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
  isSectionComplete,
  mergeAlertMemory,
  parseAlertMemory,
  popUpAlerts,
  SECTION_CUT_OFF_ITEMS,
  sectionsSwitchedOff,
  summaryCameFromWorker,
  type AlertMemory,
} from '../src/components/shared/notificationAlerts.ts'
import { getNotificationSummaryFallback } from '../src/api/cooldownFallbacks.ts'
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
const memoryStore = (backing: { times: AlertMemory } = { times: {} }) => ({
  backing,
  read: () => JSON.parse(JSON.stringify(backing.times)) as AlertMemory,
  write: (times: AlertMemory) => { backing.times = JSON.parse(JSON.stringify(times)) },
})
const QUIET = 10 * 60_000
type Row = { id: string; tone?: string }
// One summary load: the items sit in one section (default 'inv'), listed in full unless the test says otherwise.
const announce = (args: { items: Row[]; sectionId?: string; sections?: Array<{ id: string; complete: boolean }>; blocked?: boolean; seenTimes?: Record<string, number>; skipIds?: Set<string>; now: number; store: any; quietMs?: number; omittedAreEmpty?: boolean; switchedOff?: Set<string> }) =>
  announceFreshAlerts({
    rows: args.items.map((item) => ({ item, sectionId: args.sectionId || 'inv' })),
    sections: args.sections ?? [{ id: args.sectionId || 'inv', complete: true }],
    omittedAreEmpty: args.omittedAreEmpty,
    switchedOff: args.switchedOff,
    blocked: !!args.blocked,
    seenTimes: args.seenTimes ?? {},
    skipIds: args.skipIds,
    now: args.now,
    quietMs: args.quietMs ?? QUIET,
    store: args.store,
  }) as any
const ids = (plan: any) => plan.items.map((i: any) => i.id)
const items = [
  { id: 'out-1', tone: 'danger' }, { id: 'pay-2', tone: 'warning' }, { id: 'delivery-3', tone: 'info' },
  { id: 'loyalty-4', tone: 'success' }, { id: 'out-1', tone: 'danger' },
]
const loadAt = (store: ReturnType<typeof memoryStore>, at: number, extra: Partial<Parameters<typeof announce>[0]> = {}) =>
  announce({ items, now: at, store, ...extra })
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
  const a = (id: string, at: number) => announce({ items: [{ id, tone: 'danger' }], now: at, store: browserAlertStore('u1'), sections: [] })
  assert.equal(a('one', 100).kind, 'each')
  disk.set(key, JSON.stringify({ ...JSON.parse(disk.get(key) as string), two: 200 }))
  assert.equal(a('three', 300).kind, 'each')
  assert.deepEqual(JSON.parse(disk.get(key) as string), { one: { at: 100, section: 'inv' }, two: { at: 200 }, three: { at: 300, section: 'inv' } }, "another tab's entry survives this write (a bare-number entry of an older build is read as one)")
  assert.equal(a('two', 400).kind, 'none', "another tab's item does not pop again here")
  assert.equal(announce({ items: [{ id: 'one', tone: 'danger' }], now: 500, store: browserAlertStore('u2') }).kind, 'each', 'a second account on the device gets its own memory')
  assert.deepEqual(mergeAlertMemory({ a: { at: 1 }, b: { at: 9 } }, { a: { at: 5 }, c: { at: 2 } }), { a: { at: 5 }, b: { at: 9 }, c: { at: 2 } })
  // Storage that refuses writes still pops an item once per page life.
  ;(globalThis as any).window.localStorage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  const denied = (id: string) => announce({ items: [{ id, tone: 'danger' }], now: 1, store: browserAlertStore('u3') }).kind
  assert.equal(denied('z'), 'each')
  assert.equal(denied('z'), 'none')
}

// A: "pin until resolved". An alert that left a fully listed section and stayed away for the quiet period is a new alert
// when it comes back; one that only flickered is not; an incomplete, truncated, missing or failed summary forgets nothing.
{
  const T0 = 1_000_000
  const low = [{ id: 'low-1', tone: 'warning' }]
  const out = (store: any, at: number, over: any = {}) => announce({ items: [], now: at, store, ...over })
  // Resolved, then it returns after the quiet period: it pops again, once.
  {
    const store = memoryStore()
    assert.deepEqual(ids(announce({ items: low, now: T0, store })), ['low-1'])
    assert.equal(announce({ items: low, now: T0 + 1000, store }).kind, 'none')
    assert.equal(out(store, T0 + 60_000).kind, 'none')
    assert.equal(store.backing.times['low-1'].absentSince, T0 + 60_000, 'the first load that finds it gone is recorded in its own entry')
    assert.equal(store.backing.times['low-1'].resolved, undefined, 'not resolved yet')
    out(store, T0 + 60_000 + QUIET - 1)
    assert.equal(store.backing.times['low-1'].resolved, undefined, 'one millisecond short of the quiet period')
    out(store, T0 + 60_000 + QUIET)
    assert.equal(store.backing.times['low-1'].resolved, true, 'gone for the whole quiet period: resolved')
    assert.deepEqual(ids(announce({ items: low, now: T0 + 2 * QUIET, store })), ['low-1'], 'it comes back: a new alert, it pops')
    assert.equal(announce({ items: low, now: T0 + 2 * QUIET + 1000, store }).kind, 'none', 'and only once')
    assert.deepEqual(store.backing.times['low-1'], { at: T0 + 2 * QUIET, section: 'inv' })
  }
  // Back inside the quiet period: it never counted as resolved, so it does not pop, and the absence clock starts over.
  {
    const store = memoryStore()
    announce({ items: low, now: T0, store })
    out(store, T0 + 1000)
    assert.equal(announce({ items: low, now: T0 + 1000 + QUIET - 1, store }).kind, 'none', 'flickered out and in: no pop')
    assert.equal(store.backing.times['low-1'].absentSince, undefined)
    out(store, T0 + 3 * QUIET)
    out(store, T0 + 3 * QUIET + QUIET - 1)
    assert.equal(store.backing.times['low-1'].resolved, undefined, 'the earlier flicker does not shorten the next quiet period')
  }
  // A truncated or unlisted section never forgets; a failed or blocked summary never forgets.
  {
    const store = memoryStore()
    announce({ items: low, now: T0, store })
    const before = JSON.stringify(store.backing.times)
    out(store, T0 + 5 * QUIET, { sections: [{ id: 'inv', complete: false }] })
    out(store, T0 + 9 * QUIET, { sections: [{ id: 'inv', complete: false }] })
    out(store, T0 + 9 * QUIET, { sections: [] })
    out(store, T0 + 9 * QUIET, { sections: [{ id: 'other', complete: true }] })
    out(store, T0 + 9 * QUIET, { blocked: true })
    assert.equal(JSON.stringify(store.backing.times), before, 'nothing was recorded, removed or marked')
    assert.equal(announce({ items: low, now: T0 + 10 * QUIET, store }).kind, 'none', 'still the same alert, no second pop')
  }
  // Only the section the alert belongs to counts: a complete other section does not resolve it.
  {
    const store = memoryStore()
    announce({ items: low, now: T0, store })
    out(store, T0 + QUIET, { sectionId: 'expiry' })
    out(store, T0 + 3 * QUIET, { sectionId: 'expiry' })
    assert.equal(store.backing.times['low-1'].absentSince, undefined)
    assert.equal(store.backing.times['low-1'].resolved, undefined)
  }
  // Info and success never pop, before or after a resolution.
  {
    const store = memoryStore()
    const calm = [{ id: 'i-1', tone: 'info' }, { id: 's-1', tone: 'success' }]
    assert.equal(announce({ items: calm, now: T0, store }).kind, 'none')
    assert.deepEqual(store.backing.times, {})
  }
  // A bell "seen" older than the resolution no longer hides the returning alert; one from after the return does.
  {
    const store = memoryStore()
    announce({ items: low, now: T0, store })
    out(store, T0 + 1000)
    out(store, T0 + 1000 + QUIET)
    assert.deepEqual(ids(announce({ items: low, now: T0 + 2 * QUIET, store, seenTimes: { 'low-1': T0 + 500 } })), ['low-1'], 'seen before it was resolved: pops')
    const again = memoryStore()
    announce({ items: low, now: T0, store: again })
    out(again, T0 + 1000)
    out(again, T0 + 1000 + QUIET)
    assert.equal(announce({ items: low, now: T0 + 2 * QUIET, store: again, seenTimes: { 'low-1': T0 + 2 * QUIET - 1 } }).kind, 'none', 'opened in the bell after it came back: seen, no pop')
    assert.equal(announce({ items: low, now: T0 + 2 * QUIET + 1, store: again, seenTimes: { 'low-1': T0 + 2 * QUIET - 1 } }).kind, 'none')
  }
  // The quiet period is the Settings repeat interval; off or zero means ten minutes.
  {
    const store = memoryStore()
    announce({ items: low, now: T0, store })
    out(store, T0 + 1000, { quietMs: 30 * 60_000 })
    out(store, T0 + 1000 + 29 * 60_000, { quietMs: 30 * 60_000 })
    assert.equal(store.backing.times['low-1'].resolved, undefined)
    out(store, T0 + 1000 + 30 * 60_000, { quietMs: 30 * 60_000 })
    assert.equal(store.backing.times['low-1'].resolved, true)
    const zero = memoryStore()
    announce({ items: low, now: T0, store: zero, quietMs: 0 })
    out(zero, T0 + 1000, { quietMs: 0 })
    out(zero, T0 + 1000 + 10 * 60_000 - 1, { quietMs: 0 })
    assert.equal(zero.backing.times['low-1'].resolved, undefined)
    out(zero, T0 + 1000 + 10 * 60_000, { quietMs: 0 })
    assert.equal(zero.backing.times['low-1'].resolved, true)
  }
  // What counts as a complete section, and the bell wiring.
  assert.equal(isSectionComplete({ items: [{}, {}] }), true)
  assert.equal(isSectionComplete({ items: [{}], truncated: true, itemsTotal: 50 }), false)
  assert.equal(isSectionComplete({ items: [{}], itemsTotal: 50 }), false, 'a preview is incomplete even without the flag')
  assert.equal(isSectionComplete({ items: [{}, {}], itemsTotal: 2 }), true)
  assert.equal(isSectionComplete(undefined), false)
  assert.ok(centerSource.includes('complete: isSectionComplete(section)'))
  assert.ok(centerSource.includes('quietMs: realertMinutes * 60000'))
  // Merge: per user, latest time per item; another tab's newer entry is not lost when this tab resolves or marks something.
  assert.deepEqual(mergeAlertMemory({ a: { at: 5, resolved: true } }, { a: { at: 9, section: 'inv' } }), { a: { at: 9, section: 'inv' } })
  assert.deepEqual(mergeAlertMemory({ a: { at: 9, absentSince: 3 } }, { a: { at: 9, resolved: true, absentSince: 3 } }).a.resolved, true)
  assert.deepEqual(parseAlertMemory(JSON.stringify({ n: 7, o: { at: 8, section: 'inv', absentSince: 6, resolved: true, junk: 1 }, bad: { at: 'x' }, worse: null })), { n: { at: 7 }, o: { at: 8, section: 'inv', absentSince: 6, resolved: true } })
  {
    const disk = new Map<string, string>()
    ;(globalThis as any).window.localStorage = { getItem: (k: string) => disk.get(k) ?? null, setItem: (k: string, v: string) => { disk.set(k, v) } }
    const k = alertStoreKey('merge-user')
    const mine = () => browserAlertStore('merge-user')
    const rows = [{ id: 'm1', tone: 'warning' }]
    announce({ items: rows, now: T0, store: mine() })
    announce({ items: [], now: T0 + 1000, store: mine() })
    announce({ items: [], now: T0 + 1000 + QUIET, store: mine() })
    assert.equal(JSON.parse(disk.get(k) as string).m1.resolved, true, 'this tab resolved m1')
    // Another tab meanwhile saw m1 come back (a newer entry) and recorded a different alert.
    const other = JSON.parse(disk.get(k) as string)
    other.m1 = { at: T0 + 3 * QUIET, section: 'inv' }
    other.m2 = { at: T0 + 3 * QUIET, section: 'expiry' }
    disk.set(k, JSON.stringify(other))
    announce({ items: [], now: T0 + 4 * QUIET, store: mine(), sections: [{ id: 'inv', complete: true }] })
    const kept = JSON.parse(disk.get(k) as string)
    assert.equal(kept.m1.at, T0 + 3 * QUIET, "the other tab's newer entry is not replaced by this tab's older resolution")
    assert.equal(kept.m1.resolved, undefined, 'and it is not resolved: it came back after this tab resolved it')
    assert.deepEqual(kept.m2, { at: T0 + 3 * QUIET, section: 'expiry' }, "the other tab's entry in a section this load did not list is untouched")
  }
  // N3-2: when the memory is full, resolved entries go first (oldest first), then unresolved ones oldest first.
  {
    const store = memoryStore()
    const seed: AlertMemory = {}
    // 990 unresolved, oldest of all at 'old-live' (at 1); 15 resolved markers that are newer than it.
    seed['old-live'] = { at: 1, section: 'inv' }
    for (let n = 0; n < 989; n++) seed['live' + n] = { at: 100 + n, section: 'inv' }
    for (let n = 0; n < 15; n++) seed['gone' + n] = { at: 2000 + n, section: 'inv', absentSince: 1500 + n, resolved: true }
    store.backing.times = seed
    const fresh = Array.from({ length: 3 }, (_, n) => ({ id: 'new' + n, tone: 'warning' }))
    assert.equal(announce({ items: fresh, now: T0, store, sections: [{ id: 'inv', complete: false }] }).kind, 'each')
    const kept = Object.keys(store.backing.times)
    assert.equal(kept.length, 1000)
    assert.ok(kept.includes('old-live'), 'the oldest unresolved entry outlives newer resolved markers')
    assert.equal(kept.filter((id) => id.startsWith('gone')).length, 7, 'the 7 newest resolved markers fill what is left; the 8 oldest are evicted first')
    for (let n = 0; n < 8; n++) assert.ok(!kept.includes('gone' + n), 'gone' + n + ' (oldest resolved) is evicted')
    for (const id of ['new0', 'new1', 'new2']) assert.ok(kept.includes(id))
    // With no resolved markers left to give up, the oldest unresolved goes.
    const plain = memoryStore()
    const live = Array.from({ length: 1005 }, (_, n) => ({ id: 'c' + n, tone: 'warning' }))
    assert.equal(announce({ items: live, now: T0, store: plain }).kind, 'many')
    assert.equal(Object.keys(plain.backing.times).length, 1000)
    const second = memoryStore({ times: { ...Object.fromEntries(Array.from({ length: 1000 }, (_, n) => ['u' + n, { at: 10 + n, section: 'inv' }])) } })
    announce({ items: [{ id: 'fresh', tone: 'warning' }], now: T0, store: second, sections: [{ id: 'inv', complete: false }] })
    assert.ok(!('u0' in second.backing.times) && 'u1' in second.backing.times && 'fresh' in second.backing.times, 'oldest unresolved is evicted, newest kept')
  }

  // S1: a section that may have been cut off never marks an alert as resolved.
  {
    const listed = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 'pay-' + i, tone: 'warning' }))
    assert.equal(SECTION_CUT_OFF_ITEMS, 20)
    assert.equal(isSectionComplete({ items: listed(50) }), false, 'a 50-item section (the Worker stops sales at 50) may be cut off')
    assert.equal(isSectionComplete({ items: listed(20) }), false)
    assert.equal(isSectionComplete({ items: listed(19) }), true)
    assert.equal(isSectionComplete({ items: listed(20), count: 30 }), false)
    assert.equal(isSectionComplete({ items: listed(5), count: 5 }), true)
    assert.equal(isSectionComplete({ items: listed(5), count: 9 }), false)
    assert.equal(isSectionComplete({ items: listed(2), truncated: true }), false)
    // The real driver: the 51st remembered item falls off a 50-item section and is NOT counted absent.
    const store = memoryStore()
    const full = listed(50)
    const wide = (items: any[], at: number, extra: any = {}) =>
      announce({ items, now: at, store, sections: [{ id: 'inv', complete: isSectionComplete({ items }) }], ...extra })
    wide([...full, { id: 'pay-old', tone: 'warning' }].slice(0, 50), T0)
    store.backing.times['pay-old'] = { at: T0, section: 'inv' }
    wide(full, T0 + 1000)
    wide(full, T0 + 1000 + 5 * QUIET)
    assert.equal(store.backing.times['pay-old'].absentSince, undefined, 'no absent mark from a 50-item section')
    assert.equal(store.backing.times['pay-old'].resolved, undefined)
    // count 30 with 20 items never forgets; a 5-item section with a matching count does, after the quiet period.
    const cut = memoryStore()
    announce({ items: [{ id: 'x1', tone: 'warning' }], now: T0, store: cut })
    const cutLoad = (at: number, n: number, count: number) => announce({
      items: listed(n), now: at, store: cut,
      sections: [{ id: 'inv', complete: isSectionComplete({ items: listed(n), count }) }],
    })
    cutLoad(T0 + 1000, 20, 30)
    cutLoad(T0 + 1000 + 5 * QUIET, 20, 30)
    assert.equal(cut.backing.times['x1'].absentSince, undefined, 'count 30 with 20 items: cut off, never forgets')
    cutLoad(T0 + 6 * QUIET, 5, 5)
    assert.ok(cut.backing.times['x1'].absentSince, 'a 5-item section with a matching count marks it absent')
    cutLoad(T0 + 7 * QUIET, 5, 5)
    assert.equal(cut.backing.times['x1'].resolved, true, 'and resolves it after the quiet period')
  }

  // S2: a section the Worker leaves out (it has no items) is complete and empty after a successful load.
  {
    const store = memoryStore()
    const low = [{ id: 'low-7', tone: 'warning' }]
    assert.deepEqual(ids(announce({ items: low, now: T0, store })), ['low-7'])
    // The next successful summary has no stock section at all.
    const gone = (at: number, extra: any = {}) => announce({ items: [], sections: [], omittedAreEmpty: true, now: at, store, ...extra })
    gone(T0 + 1000)
    assert.equal(store.backing.times['low-7'].absentSince, T0 + 1000, 'an omitted section marks it absent')
    // A failed or blocked load in between changes nothing.
    const before = JSON.stringify(store.backing.times)
    gone(T0 + 1000 + QUIET + 1, { blocked: true })
    announce({ items: [], sections: [], omittedAreEmpty: false, now: T0 + 2 * QUIET, store })
    assert.equal(JSON.stringify(store.backing.times), before, 'blocked, or not a real load: nothing changes')
    gone(T0 + 1000 + QUIET)
    assert.equal(store.backing.times['low-7'].resolved, true, 'forgotten after the quiet period')
    assert.deepEqual(ids(announce({ items: low, now: T0 + 3 * QUIET, store })), ['low-7'], 'the section returns with the item: it pops once')
    assert.equal(announce({ items: low, now: T0 + 3 * QUIET + 1000, store }).kind, 'none')
    // A section switched off in Settings is not an empty section.
    const off = memoryStore()
    announce({ items: low, now: T0, store: off })
    for (const at of [T0 + 1000, T0 + 1000 + QUIET, T0 + 9 * QUIET]) announce({ items: [], sections: [], omittedAreEmpty: true, switchedOff: new Set(['inv']), now: at, store: off })
    assert.deepEqual(off.backing.times['low-7'], { at: T0, section: 'inv' }, 'switched off: nothing is marked')
    assert.deepEqual([...sectionsSwitchedOff({ inventoryEnabled: false, salesEnabled: true, expiryEnabled: 'false' })].sort(), ['expiry', 'inventory'])
    assert.equal(sectionsSwitchedOff(undefined).size, 0)
    // The bell passes a real load only, and the switches.
    assert.ok(centerSource.includes('omittedAreEmpty: !!summary.loaded'))
    assert.ok(centerSource.includes('switchedOff: sectionsSwitchedOff(summary.preferences)'))
    // A failed bell read is NOT a real load. The API layer answers a failed read (a 500, a dropped connection, the browser offline) with a
    // stand-in that has no sections; only 502/503/504 mark it unavailable. Read as a real, empty answer, two failed reads a quiet period
    // apart made every unresolved alert count as resolved, and all of them popped again when the connection came back (review 4, S4).
    const standIn = getNotificationSummaryFallback()
    assert.deepEqual(standIn.sections, [], 'the stand-in looks exactly like "every section is empty"')
    assert.equal(summaryCameFromWorker(standIn), false, 'the stand-in is not a load')
    assert.equal(summaryCameFromWorker(getNotificationSummaryFallback({ unavailable: true })), false)
    assert.equal(summaryCameFromWorker({ generatedAt: '2026-11-21T01:00:00.000Z', unavailable: true }), false, 'an unavailable answer is not a load either')
    assert.equal(summaryCameFromWorker({ generatedAt: '' }), false)
    assert.equal(summaryCameFromWorker(null), false)
    assert.equal(summaryCameFromWorker(undefined), false)
    assert.equal(summaryCameFromWorker({ generatedAt: '2026-11-21T01:00:00.000Z', sections: [] }), true, 'the Worker always sends generatedAt, also when nothing needs attention')
    assert.ok(centerSource.includes('loaded: summaryCameFromWorker(result),'), 'the bell marks a summary loaded only through that rule')
    assert.ok(!centerSource.includes('loaded: true'), 'never unconditionally')
    // The whole S4 sequence through the memory: two alerts, two failed reads a quiet period apart, then the connection is back.
    const flaky = memoryStore()
    const two: Row[] = [{ id: 'out-1', tone: 'danger' }, { id: 'pay-2', tone: 'warning' }]
    assert.deepEqual(ids(announce({ items: two, now: T0, store: flaky })).sort(), ['out-1', 'pay-2'], 'both pop the first time')
    const remembered = JSON.stringify(flaky.backing.times)
    assert.ok(remembered.includes('out-1') && remembered.includes('pay-2'), 'and both are remembered')
    // Control: with the stand-in read as a real load (the defect), the same sequence forgets both and they pop again.
    const broken = memoryStore()
    announce({ items: two, now: T0, store: broken })
    for (const at of [T0 + 60_000, T0 + 60_000 + QUIET + 1, T0 + 60_000 + 3 * QUIET]) announce({ items: [], sections: [], omittedAreEmpty: true, now: at, store: broken })
    assert.deepEqual(ids(announce({ items: two, now: T0 + 4 * QUIET, store: broken })).sort(), ['out-1', 'pay-2'], 'control: the defect is reproducible in this harness')
    for (const at of [T0 + 60_000, T0 + 60_000 + QUIET + 1, T0 + 60_000 + 3 * QUIET]) {
      announce({ items: [], sections: [], omittedAreEmpty: summaryCameFromWorker(standIn), now: at, store: flaky })
    }
    assert.equal(JSON.stringify(flaky.backing.times), remembered, 'failed reads change nothing in the memory')
    assert.equal(announce({ items: two, now: T0 + 4 * QUIET, store: flaky }).kind, 'none', 'and nothing pops again when the connection is back')
  }
}

// S3: one user's pop-ups never reach the next user.
{
  reset()
  const s = new Screen()
  s.emit('Not Paid R-0123: $45.00', 'warning')
  s.emit('Device waiting', 'error')
  assert.equal(s.shown.length, 2)
  assert.equal(channel.userChangeClearsToasts('u1', 'u2'), true, 'another account')
  assert.equal(channel.userChangeClearsToasts('u1', null), true, 'sign-out')
  assert.equal(channel.userChangeClearsToasts('u1', 'u1'), false)
  assert.equal(channel.userChangeClearsToasts(null, 'u1'), false, 'a sign-in keeps what the sign-in screen showed')
  assert.equal(channel.userChangeClearsToasts(undefined, undefined), false)
  channel.clearToasts()
  s.settle()
  assert.deepEqual(s.shown, [], 'the list is empty')
  assert.equal(timers.size, 0, 'no clock is left to fire later')
  s.advance(20000)
  assert.deepEqual(s.shown, [])
  // A message raised right after the clear shows for its full lifetime.
  s.emit('Signed out', 'warning')
  s.advance(9999)
  assert.deepEqual(s.shown, ['Signed out'])
  s.advance(1)
  assert.deepEqual(s.shown, [])
  // A held (paused) pop-up is dropped too, and its clock cannot come back.
  s.emit('held', 'error')
  channel.pauseToast(channel.getToastStack()[0].key)
  channel.clearToasts()
  s.settle()
  assert.deepEqual(s.shown, [])
  s.advance(60000)
  assert.deepEqual(s.shown, [])
  s.unmount()
  // Wired once, beside the user id, in the provider.
  assert.equal(contextSource.split('clearToasts()').length - 1, 1)
  assert.ok(contextSource.includes('if (userChangeClearsToasts(previousId, user?.id)) clearToasts()'))
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
function loadNotification(opts: { visible: Entry[]; slot?: Entry | null; dialogOpen?: boolean; narrow?: boolean; lang?: string; dismissed?: string[]; refs?: any[]; doc?: any; effects?: Array<{ run: () => unknown; deps: unknown[] }>; resumed?: string[] }) {
  const win = { requestAnimationFrame: (fn: () => void) => { fn(); return 1 } }
  const factory = new Function('React', 'useEffect', 'releaseHeldToasts', 'useRef', 'useApp', 'useToastStack', 'useDialogOpen', 'useNarrowViewport', 'limitForDialog', 'toastStackTop', 'getNotificationColor', 'getNotificationKind', 'createPortal', 'document', 'window', `${component}\nreturn Notification`)
  return factory(
    React,
    (run: () => unknown, deps: unknown[]) => { opts.effects?.push({ run, deps }) },
    hookExports.releaseHeldToasts,
    (initial: unknown) => { const ref = { current: initial }; opts.refs?.push(ref); return ref },
    () => ({ t: (k: string) => packs[opts.lang || 'en'][k] ?? k }),
    () => ({ visible: opts.visible, slot: opts.slot ?? null, dismiss: (k: string) => opts.dismissed?.push(k), pause() {}, resume: (k: string) => opts.resumed?.push(k) }),
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
  // Persistent regions carry aria-live and no role: an always-present empty role="alert" would tell every query an alert exists.
  assert.ok(empty.includes('<div class="sr-only" aria-live="polite" aria-atomic="false">'))
  assert.ok(empty.includes('<div class="sr-only" aria-live="assertive" aria-atomic="false">'))
  assert.ok(!/role="(alert|status)"/.test(empty), 'no role on the persistent live regions')
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

// N3-1: a pop-up held by keyboard focus is released when it stops being drawn and when the component unmounts.
{
  const render1 = (visible: Entry[], extra: { dialogOpen?: boolean; narrow?: boolean } = {}, shared?: { refs: any[] }) => {
    const effects: Array<{ run: () => unknown; deps: unknown[] }> = []
    const resumed: string[] = []
    const refs = shared?.refs ?? []
    const node = loadNotification({ visible, refs, effects, resumed, ...extra })({ notification: null, appUpdateVisible: false, headerPresent: true })
    return { node, effects, resumed, refs }
  }
  const focusDismiss = (node: any, key: string) => {
    const button = find(node, (el) => el.props['data-toast-dismiss'] !== undefined)[key === 'a' ? 0 : 1]
    button.props.onFocus({ relatedTarget: null, currentTarget: { matches: () => true } })
  }
  // Phone, a dialog opens: only the newest is drawn, so the focused older pop-up must resume.
  {
    const both = render1([toast('a', 'newest'), toast('b', 'older')])
    focusDismiss(both.node, 'b')
    assert.deepEqual([...both.refs[2].current], ['b|dismiss'], 'focus on the older pop-up holds its clock')
    // The dialog opens: the same component now draws only 'a'; its drawn-keys effect releases 'b'.
    const hidden = render1([toast('a', 'newest'), toast('b', 'older')], { dialogOpen: true, narrow: true })
    hidden.refs[2].current.add('b|dismiss')
    hidden.effects[0].run()
    assert.deepEqual(hidden.resumed, ['b'], 'the pop-up that stopped being drawn is resumed')
    assert.equal(hidden.refs[2].current.size, 0)
    // Still drawn: nothing is released.
    const drawn = render1([toast('a', 'newest'), toast('b', 'older')])
    drawn.refs[2].current.add('b|dismiss')
    drawn.effects[0].run()
    assert.deepEqual(drawn.resumed, [])
  }
  // Unmount: the cleanup of the last effect releases every held pop-up.
  {
    const held = render1([toast('a', 'one'), toast('b', 'two')])
    const set = held.refs[2].current as Set<string>
    focusDismiss(held.node, 'a')
    focusDismiss(held.node, 'b')
    assert.deepEqual([...set].sort(), ['a|dismiss', 'b|dismiss'])
    const cleanup = held.effects[held.effects.length - 1].run() as () => void
    assert.equal(typeof cleanup, 'function')
    cleanup()
    assert.deepEqual(held.resumed.sort(), ['a', 'b'], 'unmounting resumes every held clock')
    assert.equal(set.size, 0)
  }
  // The pure rule: still-drawn keys stay held.
  {
    const held = new Set(['a|view', 'b|dismiss'])
    const resumed: string[] = []
    hookExports.releaseHeldToasts(held, ['a'], (k: string) => resumed.push(k))
    assert.deepEqual([...held], ['a|view'])
    assert.deepEqual(resumed, ['b'])
  }
  // End to end on the real channel: a held pop-up that loses its screen finishes its remaining time.
  {
    reset()
    const s = new Screen()
    s.emit('held', 'warning')
    const key = channel.getToastStack()[0].key
    s.advance(3000)
    channel.pauseToast(key)
    s.advance(20000)
    assert.deepEqual(s.shown, ['held'], 'paused: it stays')
    hookExports.releaseHeldToasts(new Set([`${key}|dismiss`]), [], channel.resumeToast)
    s.advance(6999)
    assert.deepEqual(s.shown, ['held'])
    s.advance(1)
    assert.deepEqual(s.shown, [], 'released: its remaining 7 s run out')
    s.unmount()
  }
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
