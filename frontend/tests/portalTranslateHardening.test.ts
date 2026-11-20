// S2-F1 hardening: the rule must hold when the session changes in another tab, when the page comes back from the back/forward cache,
// and when the reload is slow. The pieces that can be proved without a browser:
//   - the controller takes the script tag, the widget host and the googtrans cookie away BEFORE it reloads;
//   - the hook never goes to the Worker when another tab, a restored page or a woken tab changes the sign-in marker (portalSignedInMarker runs it).
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

const hook = read('src/components/catalog/portalAccount.ts')

// A listener body may only re-read the marker and set state: pinned by structure, with a positive control for the scanner.
const listenerNames = (source: string): string[] =>
  [...source.matchAll(/(?:window|document)\.addEventListener\('(?:storage|pageshow|visibilitychange|resume|focus)', (\w+)\)/g)].map((match) => match[1])
const SAFE_BODY = /^(?:\{ )?(?:if \(.*\) )?(?:refresh\(\)|setMarker\(readPortalSignedIn\(\)\))(?: \})?$/
const bodyOf = (source: string, name: string): string => new RegExp(`const ${name} = (?:\\([^)]*\\)|\\w+) => ([^\\n]*)`).exec(source)?.[1] ?? ''

await check('the hook listens for storage, pageshow, visibilitychange and resume, and removes each listener', () => {
  assert.match(hook, /window\.addEventListener\('storage', onStorage\)/)
  assert.match(hook, /event\.key === null \|\| event\.key === PORTAL_SIGNED_IN_KEY/, 'localStorage.clear() has key null')
  assert.match(hook, /window\.addEventListener\('pageshow', refresh\)/)
  assert.match(hook, /document\.addEventListener\('visibilitychange', onVisible\)/)
  assert.match(hook, /document\.addEventListener\('resume', refresh\)/)
  for (const name of ['storage', 'pageshow', 'visibilitychange', 'resume']) assert.match(hook, new RegExp(`removeEventListener\\('${name}'`))
  assert.doesNotMatch(hook, /BroadcastChannel/)
  assert.doesNotMatch(hook, /addEventListener\('focus'/, 'focus asks nothing and reads nothing here')
  assert.doesNotMatch(hook, /event\.persisted/, 'no read depends on persisted: any pageshow re-reads the marker')
})

await check('every listener body only re-reads the marker and sets state: no API call, no fetch', () => {
  const names = listenerNames(hook)
  assert.equal(names.length, 4, 'storage, pageshow, visibilitychange, resume')
  for (const name of names) {
    const body = bodyOf(hook, name)
    assert.match(body, SAFE_BODY, `${name}: ${body}`)
  }
  assert.equal(bodyOf(hook, 'refresh'), 'setMarker(readPortalSignedIn())')
  const block = /const refresh = [\s\S]*?document\.removeEventListener\('resume', refresh\)/.exec(hook)?.[0] || ''
  assert.ok(block, 'listener block found')
  assert.doesNotMatch(block, /api\(\)|getPortal|fetch\(|hydrate|await /, 'nothing in the listener block reaches the network')
  // Positive control: a listener that does reach the API is not accepted.
  const bad = "const refresh = () => { void api().getPortalAccountMe?.() }\nwindow.addEventListener('pageshow', refresh)"
  assert.doesNotMatch(bodyOf(bad, listenerNames(bad)[0]), SAFE_BODY, 'a listener that reaches the API is flagged')
})

await check('the network re-check of round 1 is gone', () => {
  assert.doesNotMatch(hook, /recheck|shouldRecheckPortalSession|PORTAL_SESSION_RECHECK_MIN_MS|samePortalProfile/i)
})

await check('the Website Editor preview does not use the hook or the controller', () => {
  assert.doesNotMatch(read('src/components/catalog/CatalogPage.tsx'), /usePortalAccount|portalTranslateController/)
})

assert.deepEqual(failures, [], `translate hardening:\n  ${failures.join('\n  ')}`)
console.log('PASS translate hardening: removal before reload, marker listeners reach no network')
