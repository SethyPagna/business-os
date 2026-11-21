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

await check('truth table: allowed only with a real session answer, signed out, the sheet closed and no marker (24 rows)', () => {
  const markers = ['absent', 'present', 'unreadable'] as const
  let allowedRows = 0
  for (const sessionReady of [false, true]) for (const signedIn of [false, true]) for (const accountOpen of [false, true]) for (const marker of markers) {
    const expected = sessionReady && !signedIn && !accountOpen && marker === 'absent'
    if (expected) allowedRows += 1
    assert.equal(options.portalTranslateAllowed({ sessionReady, signedIn, accountOpen, marker }), expected, JSON.stringify({ sessionReady, signedIn, accountOpen, marker }))
  }
  assert.equal(allowedRows, 1, 'exactly one row lets Google run')
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

// 21 Nov 2026 (second translate defect): React ran the account-sheet state initializer twice before the first commit, and the old plain
// read-and-delete answered true to the render that was thrown away and false to the one that reached the screen, so the sheet never came back
// after the reload. The contract now: the flag is deleted from storage at the first read, and the page (the document) keeps that one answer
// until settlePortalReopenAccount. Each installFakeBrowser call installs a NEW fake document, which is a new page load.
await check('the reopen flag: deleted at the first read, the same answer on this page until settled, gone on any later page', () => {
  const store = new Map<string, string>()

  // a. nothing flagged
  installFakeBrowser({ sessionStore: store })
  assert.equal(options.consumePortalReopenAccount(), false, 'a: nothing flagged yet')

  // b. a new page loaded after the flag was written
  options.markPortalReopenAccount()
  assert.equal(store.get(options.PORTAL_REOPEN_ACCOUNT_KEY), '1', 'the flag is written')
  installFakeBrowser({ sessionStore: store })
  assert.equal(options.consumePortalReopenAccount(), true, 'b: the first read on the new page is true')
  assert.equal(store.has(options.PORTAL_REOPEN_ACCOUNT_KEY), false, 'b: the first read deleted the flag from storage')

  // c. the defect: a second call on the same page before it settles used to be false
  assert.equal(options.consumePortalReopenAccount(), true, 'c: a second read on the same page, before settle, is also true')
  assert.equal(options.consumePortalReopenAccount(), true, 'c: and a third')

  // d. once the page is on screen
  options.settlePortalReopenAccount()
  assert.equal(options.consumePortalReopenAccount(), false, 'd: after settle the same page answers false')

  // e. the flag was deleted at the first read, so a later reload does not reopen the sheet
  installFakeBrowser({ sessionStore: store })
  assert.equal(options.consumePortalReopenAccount(), false, 'e: another new page after that is false')

  // f. a clean removal clears a flag that no reload will read
  options.markPortalReopenAccount()
  options.clearPortalReopenAccount()
  installFakeBrowser({ sessionStore: store })
  assert.equal(options.consumePortalReopenAccount(), false, 'f: mark then clear then a new page is false')
})

await check('storage that throws or is missing never breaks the page', () => {
  installFakeBrowser()
  assert.equal(options.consumePortalReopenAccount(), false, 'g: no storage at all')
  assert.doesNotThrow(() => options.markPortalReopenAccount())
  assert.doesNotThrow(() => options.clearPortalReopenAccount())
  assert.doesNotThrow(() => options.settlePortalReopenAccount())
  installFakeBrowser()
  const win = globals.window as { sessionStorage: unknown }
  win.sessionStorage = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
  assert.equal(options.consumePortalReopenAccount(), false, 'g: storage that throws')
  assert.doesNotThrow(() => options.markPortalReopenAccount())
  assert.doesNotThrow(() => options.clearPortalReopenAccount())
  assert.doesNotThrow(() => options.settlePortalReopenAccount())
})

globals.window = savedWindow
globals.document = savedDocument

const page = read('src/components/catalog/PublicCatalogPage.tsx')

await check('the page rule takes its inputs from the real session answer, the account or a live renewal prompt, the sheet and the marker', () => {
  assert.match(page, /const sessionReady = portalAccount\.sessionKnown/)
  assert.match(page, /const signedIn = !!portalAccount\.account \|\| portalAccount\.consentRenewal/)
  assert.match(page, /const signInMarker = portalAccount\.marker/)
  assert.match(page, /portalTranslateAllowed\(\{ sessionReady, signedIn, accountOpen, marker: signInMarker \}\)/)
})

await check('the translate effect applies only when the rule allows, and lists all three inputs', () => {
  const effect = /useEffect\(\(\) => \{\n(?:    \/\/ [^\n]*\n)*    const pickedGoogle = isGoogleLanguageChoice\(pageChoice\)\n    if \(!pickedGoogle && !portalGoogleWasAsked\(\)\) return undefined\n    let cancelled = false[\s\S]*?\n  \}, \[pageChoice, translateAllowed, sessionChecked, sessionReady, signedIn, signInMarker, accountOpen\]\)/.exec(page)?.[0] || ''
  assert.ok(effect, 'the effect and its dependency list')
  const blockedAt = effect.indexOf('if (!translateAllowed)')
  const applyAt = effect.indexOf('applyPortalGoogleTranslateOrFallBack(')
  assert.ok(blockedAt > 0 && applyAt > blockedAt, 'the blocked branch returns before the apply call')
  const blocked = effect.slice(blockedAt, applyAt)
  assert.match(blocked, /return \(\) => \{ cancelled = true; if \(accountOpen && !removalStarted\) clearPortalReopenAccount\(\) \}\n    \}/, 'the blocked branch ends in a return')
  assert.doesNotMatch(blocked, /applyPortalGoogleTranslate/, 'the blocked branch never applies')
  assert.match(blocked, /controller\.removePortalGoogleTranslate\(\{ reload: !reloadSpent \}\)/)
  assert.match(blocked, /if \(removal === 'clean'\)/)
  assert.match(blocked, /if \(!sessionChecked && !accountOpen && signInMarker === 'absent'\) return undefined/, 'only a guest with nothing against Google waits: a marker or an open sheet removes Google even before the check ends')
  assert.doesNotMatch(blocked, /visibilityState|document\.hidden/, 'a hidden background tab removes Google too')
  assert.match(effect, /cancelled \? false : controller\.applyPortalGoogleTranslateOrFallBack/, 'a cancelled attempt never loads Google')
})

await check('S1: a late Google script after the timeout fallback is taken off too: the blocked branch runs for any pick once the controller was asked to apply', () => {
  const effect = /useEffect\(\(\) => \{\n(?:    \/\/ [^\n]*\n)*    const pickedGoogle[\s\S]*?\n  \}, \[pageChoice, translateAllowed/.exec(page)?.[0] || ''
  assert.ok(effect, 'the effect')
  const blockedAt = effect.indexOf('if (!translateAllowed)')
  const applyGuardAt = effect.indexOf('if (!pickedGoogle) return undefined')
  assert.ok(blockedAt > 0 && applyGuardAt > blockedAt, 'a non-Google pick is turned away only AFTER the blocked branch, which therefore runs for it')
  assert.ok(effect.indexOf('markPortalGoogleAsked()') > applyGuardAt, 'the flag is set only on the apply path: a visitor who never picked Google never loads the controller')
  assert.match(effect, /if \(!pickedGoogle\) return\n\s+if \(signedIn/, 'no notice is shown for a pick that is not Google')
  assert.equal((page.match(/markPortalGoogleAsked\(\)/g) || []).length, 1, 'set in one place')
})

await check('every import of the controller sits behind the rule or is a removal', () => {
  const imports = page.split("import('./portalTranslateController.ts')").length - 1
  assert.equal(imports, 4, 'blocked removal, allowed apply, leave-Google removal, open-the-sheet removal')
  const loaders = page.match(/applyPortalGoogleTranslate\w*\(/g) || []
  assert.deepEqual(loaders, ['applyPortalGoogleTranslateOrFallBack('], 'one place can load Google')
})

await check('the account sheet starts open from the reopen flag, read through the one-shot helper', () => {
  assert.match(page, /isStorefrontSignInPath\(window\.location\?\.pathname\) \|\| consumePortalReopenAccount\(\)/)
  assert.match(page, /if \(accountOpen && !reloadSpent\) markPortalReopenAccount\(\)/)
  assert.match(page, /clearPortalReopenAccount\(\)/)
})

await check('the paused line says "use your account" in English and real Khmer, through copy()', () => {
  assert.match(page, /copy\('translatePaused', 'Translation is paused while you use your account\.', 'ការបកប្រែផ្អាក ពេលអ្នកប្រើគណនី។'\)/)
  assert.doesNotMatch(page, /pauses while you are signed in/)
})

await check('a guest whose marker is unreadable or whose first check failed sees the existing "not available" line instead of silence', () => {
  const blocked = /if \(!translateAllowed\) \{[\s\S]*?return \(\) => \{ cancelled = true/.exec(page)?.[0] || ''
  assert.match(blocked, /if \(signedIn \|\| accountOpen \|\| signInMarker === 'present'\) say\(copy\('translatePaused'/)
  assert.match(blocked, /else say\(copy\('translateUnavailable', 'Translation is not available right now\.', '[ក-៿ ។]+'\)\)/)
})

await check('a flag whose removal never ran is cleared in the cleanup, so a later reload cannot reopen the sheet', () => {
  assert.match(page, /let removalStarted = false/)
  assert.match(page, /removalStarted = true\n\s+const removal = controller\.removePortalGoogleTranslate\(\{ reload: !reloadSpent \}\)/, 'set just before the removal runs')
  assert.match(page, /return \(\) => \{ cancelled = true; if \(accountOpen && !removalStarted\) clearPortalReopenAccount\(\) \}/)
})

await check('opening the sheet over Google writes the flag and reloads WITHOUT showing the sheet; every opener goes through it', () => {
  const open = /const openAccount = \(\) => \{[\s\S]*?\n  \}\n/.exec(page)?.[0] || ''
  assert.ok(open, 'openAccount found')
  assert.match(open, /if \(accountOpen \|\| !\(isGoogleLanguageChoice\(pageChoice\) \|\| portalGoogleWasAsked\(\)\)\) \{ setAccountOpen\(true\); return \}/, 'no Google pick and no Google requested in this document: opens at once')
  assert.ok(open.indexOf('markPortalReopenAccount()') < open.indexOf('removePortalGoogleTranslate()'), 'flag first, then the removal')
  assert.match(open, /removePortalGoogleTranslate\(\) === 'clean'\) show\(\)/, 'the sheet opens only when nothing had to reload')
  assert.doesNotMatch(open, /removePortalGoogleTranslate\(\{/, 'the first reload of an opening is untouched: no argument, so a reload is allowed')
  assert.equal((page.match(/setAccountOpen\(true\)/g) || []).length, 2, 'only the wrapper opens the sheet')
  assert.match(page, /onOpenAccount=\{openAccount\}/)
})

await check('the Website Editor preview never meets the rule', () => {
  const editor = read('src/components/catalog/CatalogPage.tsx')
  assert.doesNotMatch(editor, /portalTranslate|portalTranslateAllowed|PortalReopenAccount/)
})

await check('the account sheet starts from the kept answer and settles it from an effect that runs once, on mount', () => {
  assert.match(page, /const \[accountOpen, setAccountOpen\] = useState\(\(\) => [^\n]*consumePortalReopenAccount\(\)\)\)/, 'h: the initializer still reads consumePortalReopenAccount')
  assert.match(page, /useEffect\(\(\) => \{\s*settlePortalReopenAccount\(\)\s*\}, \[\]\)/, 'h: an effect with an empty dependency list settles it')
})

// At most one guard reload per opening of the sheet (breaker, 21 Nov 2026). The page cannot be rendered here, so its wiring is pinned as text;
// the behaviour of the two stand-in loops is driven through the real controller in portalTranslateRealWidget.test.ts.
await check('breaker: the spent flag comes from the one-shot answer, is reset when the sheet closes, and bounds the guard to one reload', () => {
  assert.match(page, /const guardReloadSpentRef = useRef<boolean \| null>\(null\)\n\s+if \(guardReloadSpentRef\.current === null\) guardReloadSpentRef\.current = typeof window !== 'undefined' && consumePortalReopenAccount\(\)/, 'the ref starts from consumePortalReopenAccount()')
  assert.match(page, /useEffect\(\(\) => \{ if \(!accountOpen\) guardReloadSpentRef\.current = false \}, \[accountOpen\]\)/, 'closing the sheet resets it')
  assert.match(page, /const reloadSpent = accountOpen && guardReloadSpentRef\.current === true\n\s+if \(accountOpen && !reloadSpent\) markPortalReopenAccount\(\)/, 'the reopen flag is written only for a reload that is still left')
  assert.match(page, /const removal = controller\.removePortalGoogleTranslate\(\{ reload: !reloadSpent \}\)/, 'the removal is told whether a reload is left')
  assert.match(page, /if \(removal === 'present'\) \{ setAccountOpen\(false\); return \}\n\s+if \(removal === 'clean'\)/, 'present closes the sheet and returns before the clean branch')
})

assert.deepEqual(failures, [], `translate guard:\n  ${failures.join('\n  ')}`)
console.log('PASS translate guard: rule truth table, blocked state, no reload loop, reopen flag, page wiring')
