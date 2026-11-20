// S2-F1: Google's translate script runs with full access to the page, so on the storefront it may run only when the shopper-session
// check has finished, nobody is signed in and the Account sheet is closed (portalTranslateAllowed). Anywhere else the script is not
// loaded, and one that is already on the page is taken off with one clean reload.
//
// Run: node tests/portalTranslateGuard.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as options from '../src/components/catalog/portalLanguageOptions.ts'

const frontend = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative: string) => fs.readFileSync(path.join(frontend, relative), 'utf8').replace(/\r\n/g, '\n')
const failures: string[] = []
const check = async (name: string, run: () => void | Promise<void>) => {
  try { await run() } catch (error) { failures.push(`${name}: ${(error as Error).message.split('\n')[0]}`) }
}

await check('truth table: allowed only when ready, signed out and the sheet is closed (8 rows)', () => {
  const rows: Array<[boolean, boolean, boolean, boolean]> = [
    // sessionReady, signedIn, accountOpen, allowed
    [false, false, false, false],
    [false, false, true, false],
    [false, true, false, false],
    [false, true, true, false],
    [true, false, false, true],
    [true, false, true, false],
    [true, true, false, false],
    [true, true, true, false],
  ]
  for (const [sessionReady, signedIn, accountOpen, expected] of rows) {
    assert.equal(options.portalTranslateAllowed({ sessionReady, signedIn, accountOpen }), expected, JSON.stringify({ sessionReady, signedIn, accountOpen }))
  }
})

type FakeNode = Record<string, unknown> & { tag: string; id: string; remove: () => void }
const globals = globalThis as unknown as { window?: unknown; document?: unknown }
const savedWindow = globals.window
const savedDocument = globals.document

function installFakeBrowser(options: { sessionStore?: Map<string, string>; scripts?: boolean } = {}) {
  const byId = new Map<string, FakeNode>()
  const appended: FakeNode[] = []
  const cookies: string[] = []
  const reloads: Array<{ scriptOnPage: boolean; hostOnPage: boolean }> = []
  const make = (tag: string): FakeNode => {
    const node: FakeNode = { tag, id: '', style: {}, setAttribute() {}, dataset: {}, remove() { if (node.id && byId.get(node.id) === node) byId.delete(node.id) } }
    return node
  }
  const add = (node: FakeNode) => { appended.push(node); if (node.id) byId.set(node.id, node) }
  const store = options.sessionStore
  globals.window = {
    location: {
      hostname: 'leangbeauty.com',
      pathname: '/',
      reload() { reloads.push({ scriptOnPage: byId.has('business-os-portal-translate-script'), hostOnPage: byId.has('business-os-portal-translate-widget-host') }) },
    },
    localStorage: { getItem: () => null, setItem() {} },
    sessionStorage: store ? { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) }, removeItem: (key: string) => { store.delete(key) } } : undefined,
    setTimeout: () => 1,
    clearTimeout: () => {},
  }
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
  return { appended, cookies, reloads, byId, make, add }
}
const scriptsIn = (appended: FakeNode[]) => appended.filter((node) => node.tag === 'script')
const googtransCleared = (cookies: string[]) => cookies.some((value) => value.startsWith('googtrans=;') && /expires=Thu, 01 Jan 1970/.test(value))

const controller = await import('../src/components/catalog/portalTranslateController.ts')

await check('blocked with nothing loaded: no script, no request, cookie cleared, no reload', () => {
  const { appended, cookies, reloads } = installFakeBrowser()
  assert.equal(controller.removePortalGoogleTranslate(), 'clean')
  assert.equal(scriptsIn(appended).length, 0, 'no script element')
  assert.equal(appended.length, 0, 'no preconnect hints, no host, nothing at all')
  assert.ok(googtransCleared(cookies), 'googtrans cleared')
  assert.equal(reloads.length, 0)
})

await check('blocked with the script present: exactly one reload; allowed again after a clean page loads the script once', async () => {
  const first = installFakeBrowser()
  const pending = controller.applyPortalGoogleTranslate('fr')
  await Promise.resolve()
  assert.equal(scriptsIn(first.appended).length, 1, 'the script was loaded while allowed')
  assert.equal(controller.removePortalGoogleTranslate(), 'reloading')
  assert.equal(first.reloads.length, 1, 'exactly one reload')
  void pending

  // The reload: a fresh page. Still blocked: nothing loads it back and nothing reloads (no loop).
  const second = installFakeBrowser()
  assert.equal(controller.removePortalGoogleTranslate(), 'clean')
  assert.equal(controller.removePortalGoogleTranslate(), 'clean')
  assert.equal(second.reloads.length, 0, 'no reload loop')
  assert.equal(scriptsIn(second.appended).length, 0)

  // Allowed again: the normal path loads it once.
  const third = installFakeBrowser()
  const again = controller.applyPortalGoogleTranslate('fr')
  await Promise.resolve()
  assert.equal(scriptsIn(third.appended).length, 1, 'the script loads once')
  void again
})

await check('the reopen flag is written, read once and gone after', () => {
  const store = new Map<string, string>()
  installFakeBrowser({ sessionStore: store })
  assert.equal(options.consumePortalReopenAccount(), false, 'nothing flagged yet')
  options.markPortalReopenAccount()
  assert.equal(store.get(options.PORTAL_REOPEN_ACCOUNT_KEY), '1')
  assert.equal(options.consumePortalReopenAccount(), true, 'read once')
  assert.equal(store.has(options.PORTAL_REOPEN_ACCOUNT_KEY), false, 'deleted by the read')
  assert.equal(options.consumePortalReopenAccount(), false, 'never twice')
  options.markPortalReopenAccount()
  options.clearPortalReopenAccount()
  assert.equal(options.consumePortalReopenAccount(), false, 'a clean removal clears a flag that no reload will read')
})

await check('storage that throws or is missing never breaks the page', () => {
  installFakeBrowser()
  assert.equal(options.consumePortalReopenAccount(), false)
  assert.doesNotThrow(() => options.markPortalReopenAccount())
  const win = globals.window as { sessionStorage: unknown }
  win.sessionStorage = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
  assert.equal(options.consumePortalReopenAccount(), false)
  assert.doesNotThrow(() => options.markPortalReopenAccount())
  assert.doesNotThrow(() => options.clearPortalReopenAccount())
})

globals.window = savedWindow
globals.document = savedDocument

const page = read('src/components/catalog/PublicCatalogPage.tsx')

await check('the page rule takes the three inputs from the session check, the account and the sheet', () => {
  assert.match(page, /const sessionReady = portalAccount\.ready/)
  assert.match(page, /const signedIn = !!portalAccount\.account/)
  assert.match(page, /portalTranslateAllowed\(\{ sessionReady, signedIn, accountOpen \}\)/)
})

await check('the translate effect applies only when the rule allows, and lists all three inputs', () => {
  const effect = /useEffect\(\(\) => \{\n    if \(!isGoogleLanguageChoice\(pageChoice\)\) return undefined\n    let cancelled = false[\s\S]*?\n  \}, \[pageChoice, translateAllowed, sessionReady, accountOpen\]\)/.exec(page)?.[0] || ''
  assert.ok(effect, 'the effect and its dependency list')
  const blockedAt = effect.indexOf('if (!translateAllowed)')
  const applyAt = effect.indexOf('applyPortalGoogleTranslateOrFallBack(')
  assert.ok(blockedAt > 0 && applyAt > blockedAt, 'the blocked branch returns before the apply call')
  const blocked = effect.slice(blockedAt, applyAt)
  assert.match(blocked, /return \(\) => \{ cancelled = true \}\n    \}/, 'the blocked branch ends in a return')
  assert.doesNotMatch(blocked, /applyPortalGoogleTranslate/, 'the blocked branch never applies')
  assert.match(blocked, /removePortalGoogleTranslate\(\) === 'clean'/)
  assert.match(blocked, /if \(!sessionReady && !accountOpen\) return undefined/, 'nothing loads or is said before the session check ends')
  assert.match(effect, /cancelled \? false : controller\.applyPortalGoogleTranslateOrFallBack/, 'a cancelled attempt never loads Google')
})

await check('every import of the controller sits behind the rule or is a removal', () => {
  const imports = page.split("import('./portalTranslateController.ts')").length - 1
  assert.equal(imports, 3, 'blocked removal, allowed apply, leave-Google removal')
  const loaders = page.match(/applyPortalGoogleTranslate\w*\(/g) || []
  assert.deepEqual(loaders, ['applyPortalGoogleTranslateOrFallBack('], 'one place can load Google')
})

await check('the account sheet starts open from the reopen flag, read through the one-shot helper', () => {
  assert.match(page, /isStorefrontSignInPath\(window\.location\?\.pathname\) \|\| consumePortalReopenAccount\(\)/)
  assert.match(page, /if \(accountOpen\) markPortalReopenAccount\(\)/)
  assert.match(page, /clearPortalReopenAccount\(\)/)
})

await check('the paused line is plain English and real Khmer, through copy()', () => {
  assert.match(page, /copy\('translatePaused', 'Translation pauses while you are signed in\.', '[ក-៿ ។]+'\)/)
})

await check('the Website Editor preview never meets the rule', () => {
  const editor = read('src/components/catalog/CatalogPage.tsx')
  assert.doesNotMatch(editor, /portalTranslate|portalTranslateAllowed|PortalReopenAccount/)
})

assert.deepEqual(failures, [], `translate guard:\n  ${failures.join('\n  ')}`)
console.log('PASS translate guard: rule truth table, blocked state, no reload loop, reopen flag, page wiring')
