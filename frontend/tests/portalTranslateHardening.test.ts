// S2-F1 hardening: the rule must hold when the session changes in another tab, when the page comes back from the back/forward cache,
// and when the reload is slow. The pieces that can be proved without a browser:
//   - the controller takes the script tag, the widget host and the googtrans cookie away BEFORE it reloads;
//   - the session re-check fires only when it should (pure rule), and the hook wires it to visibility, focus and pageshow(persisted);
//   - a failed re-check changes nothing.
//
// Run: node tests/portalTranslateHardening.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontend = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative: string) => fs.readFileSync(path.join(frontend, relative), 'utf8').replace(/\r\n/g, '\n')
const failures: string[] = []
const check = async (name: string, run: () => void | Promise<void>) => {
  try { await run() } catch (error) { failures.push(`${name}: ${(error as Error).message.split('\n')[0]}`) }
}

const globals = globalThis as unknown as { window?: unknown; document?: unknown }
const savedWindow = globals.window
const savedDocument = globals.document
type FakeNode = Record<string, unknown> & { tag: string; id: string; remove: () => void }

function installFakeBrowser() {
  const byId = new Map<string, FakeNode>()
  const cookies: string[] = []
  const events: string[] = []
  const snapshots: Array<{ script: boolean; host: boolean; callback: unknown; cleared: boolean }> = []
  const make = (tag: string): FakeNode => {
    const node: FakeNode = { tag, id: '', style: {}, setAttribute() {}, dataset: {}, remove() { events.push(`remove:${node.id}`); if (node.id && byId.get(node.id) === node) byId.delete(node.id) } }
    return node
  }
  const add = (node: FakeNode) => { if (node.id) byId.set(node.id, node) }
  const win: Record<string, unknown> = {
    location: {
      hostname: 'leangbeauty.com',
      pathname: '/',
      reload() {
        events.push('reload')
        snapshots.push({
          script: byId.has('business-os-portal-translate-script'),
          host: byId.has('business-os-portal-translate-widget-host'),
          callback: win.businessOsPortalTranslateInit,
          cleared: cookies.some((value) => value.startsWith('googtrans=;') && /expires=Thu, 01 Jan 1970/.test(value)),
        })
      },
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
  }
  globals.window = win
  globals.document = {
    documentElement: { className: '' },
    get cookie() { return cookies.join('; ') },
    set cookie(value: string) { cookies.push(value) },
    getElementById: (id: string) => byId.get(id) ?? null,
    querySelector: () => null,
    createElement: make,
    head: { appendChild: add },
    body: { className: '', appendChild: add },
  }
  return { events, snapshots, byId }
}

const controller = await import('../src/components/catalog/portalTranslateController.ts')

await check('with the script on the page, the script tag, widget host and cookie are gone before the single reload', async () => {
  const { events, snapshots, byId } = installFakeBrowser()
  const pending = controller.applyPortalGoogleTranslate('es')
  await Promise.resolve()
  assert.ok(byId.has('business-os-portal-translate-script'), 'the script was on the page')
  assert.ok(byId.has('business-os-portal-translate-widget-host'), 'the widget host was on the page')
  assert.ok((globals.window as Record<string, unknown>).businessOsPortalTranslateInit, 'Google would call this callback')
  assert.equal(controller.removePortalGoogleTranslate(), 'reloading')
  assert.equal(snapshots.length, 1, 'one reload')
  assert.deepEqual(snapshots[0], { script: false, host: false, callback: undefined, cleared: true }, 'everything removable was removed before the reload')
  assert.ok(events.indexOf('remove:business-os-portal-translate-script') < events.indexOf('reload'), 'the script tag went first')
  assert.ok(events.indexOf('remove:business-os-portal-translate-widget-host') < events.indexOf('reload'), 'the widget host went first')
  void pending
})

await check('a delayed navigation finds no script tag on a second look, and a second call reloads nothing more', async () => {
  const { snapshots, byId } = installFakeBrowser()
  const pending = controller.applyPortalGoogleTranslate('fr')
  await Promise.resolve()
  controller.removePortalGoogleTranslate()
  assert.equal(byId.has('business-os-portal-translate-script'), false)
  assert.equal(controller.removePortalGoogleTranslate(), 'clean', 'the page holds nothing of Google any more')
  assert.equal(snapshots.length, 1, 'still the one reload')
  void pending
})

await check('a translated marker alone still reloads once, after clearing', () => {
  const { snapshots } = installFakeBrowser()
  ;(globals.document as { documentElement: { className: string } }).documentElement.className = 'translated-ltr'
  assert.equal(controller.removePortalGoogleTranslate(), 'reloading')
  assert.equal(snapshots.length, 1)
  assert.equal(snapshots[0].cleared, true)
})

globals.window = savedWindow
globals.document = savedDocument

const account = await import('../src/components/catalog/portalAccount.ts')

await check('the session re-check rule: only when ready, idle, not mid sign-in, and not within the minimum gap unless forced', () => {
  const base = { ready: true, checking: false, busy: false, force: false, now: 100000, last: 0 }
  const min = account.PORTAL_SESSION_RECHECK_MIN_MS
  assert.equal(account.shouldRecheckPortalSession(base), true)
  assert.equal(account.shouldRecheckPortalSession({ ...base, ready: false }), false, 'the first check has not finished')
  assert.equal(account.shouldRecheckPortalSession({ ...base, checking: true }), false, 'one in flight')
  assert.equal(account.shouldRecheckPortalSession({ ...base, busy: true }), false, 'a sign-in or sign-out is running here')
  assert.equal(account.shouldRecheckPortalSession({ ...base, last: base.now - (min - 1) }), false, 'too soon')
  assert.equal(account.shouldRecheckPortalSession({ ...base, last: base.now - min }), true)
  assert.equal(account.shouldRecheckPortalSession({ ...base, last: base.now - 1, force: true }), true, 'a page restored from the cache is always checked')
  assert.equal(account.shouldRecheckPortalSession({ ...base, ready: false, force: true }), false, 'forced, but the first check is still out')
})

await check('the same profile is not a change; null against a profile is', () => {
  const a = { membershipId: 'M1', name: 'A', email: null }
  assert.equal(account.samePortalProfile(null, null), true)
  assert.equal(account.samePortalProfile(a, { ...a }), true)
  assert.equal(account.samePortalProfile(a, null), false)
  assert.equal(account.samePortalProfile(null, a), false)
  assert.equal(account.samePortalProfile(a, { ...a, membershipId: 'M2' }), false)
})

const hook = read('src/components/catalog/portalAccount.ts')

await check('the hook re-checks on visible, focus and a persisted pageshow, and removes the listeners', () => {
  assert.match(hook, /document\.addEventListener\('visibilitychange', onVisible\)/)
  assert.match(hook, /document\.visibilityState === 'visible'/)
  assert.match(hook, /window\.addEventListener\('focus', onFocus\)/)
  assert.match(hook, /window\.addEventListener\('pageshow', onPageShow\)/)
  assert.match(hook, /if \(event\.persisted\) void recheck\(true\)/)
  for (const name of ['visibilitychange', 'focus', 'pageshow']) assert.match(hook, new RegExp(`removeEventListener\\('${name}'`))
})

await check('a failed re-check keeps the last known state, and the answer of a sign-in running here wins', () => {
  const body = /const recheck = useCallback[\s\S]*?\n  \}, \[\]\)/.exec(hook)?.[0] || ''
  assert.ok(body, 'recheck found')
  const catchBlock = /\} catch \{([\s\S]*?)\} finally/.exec(body)?.[1] || ''
  assert.doesNotMatch(catchBlock, /setAccount|setReady|hydratedRef/, 'the catch changes nothing')
  assert.match(body, /if \(busyRef\.current\) return/)
  assert.match(body, /setAccount\(profile\)/)
})

await check('no storage event or BroadcastChannel carries a session change today (the cookie is HttpOnly): re-check is the only signal', () => {
  assert.doesNotMatch(hook, /BroadcastChannel|addEventListener\('storage'/)
})

await check('the Website Editor preview does not use the hook or the controller', () => {
  assert.doesNotMatch(read('src/components/catalog/CatalogPage.tsx'), /usePortalAccount|portalTranslateController/)
})

assert.deepEqual(failures, [], `translate hardening:\n  ${failures.join('\n  ')}`)
console.log('PASS translate hardening: removal before reload, session re-check on return and on cache restore')
