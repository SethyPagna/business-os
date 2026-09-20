// iOS PWA storage resilience.
//
// Owner rule (Sep 14 2026): "for iOS PWA, I just want to make it more
// foolproof as iOS seems to be very bad for PWA", plus the standing rule that
// every blank-page / white-screen error class gets a permanent test FILE that
// the owner can run at any time -- not a one-off check in a session log.
//
// The error class this locks: on iOS Safari with "Block All Cookies" (and in
// older private mode) merely TOUCHING window.localStorage or
// window.sessionStorage throws SecurityError. The getter itself throws, so it
// is not enough to wrap getItem -- the property access has to be inside the
// guard. One such throw inside a render, a useState initializer or a provider
// took the whole app to a blank white page, because nothing above the page
// boundary caught it.
//
// What this file checks, in order:
//   1. every storage access under frontend/src is inside a try block, with an
//      explicit baseline for the pre-existing debt this lane did not own;
//   2. the guarded helper families still actually guard (positive control);
//   3. the storage KEY NAMES and missing-value defaults did not change, so a
//      device with old data behaves exactly as before;
//   4. both roots mount RootErrorBoundary;
//   5. RootErrorBoundary really renders an error panel and a Reload button,
//      reports the crash, and touches neither storage nor the service worker;
//   6. isStandaloneDisplayMode answers correctly in every shape;
//   7. the OAuth owner marker is mirrored into localStorage, is read back from
//      the mirror after a fresh-context redirect, and cannot be reused by
//      another account on the same shared device.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.join(here, '..', 'src')
const read = (relative: string): string => fs.readFileSync(path.join(srcRoot, relative), 'utf8')

// ---------------------------------------------------------------------------
// 1. The sweep
// ---------------------------------------------------------------------------

/** Replace every comment and string/template body with spaces, keeping the
 *  length so offsets still map to line numbers. Braces and identifiers inside
 *  a comment or a string must not influence the brace walk below -- the word
 *  "sessionStorage" inside this very comment is why. */
function blankNonCode(source: string): string {
  const out = source.split('')
  let index = 0
  let mode: 'code' | 'line' | 'block' | 'string' = 'code'
  let quote = ''
  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]
    if (mode === 'code') {
      if (char === '/' && next === '/') { mode = 'line'; out[index] = ' '; out[index + 1] = ' '; index += 2; continue }
      if (char === '/' && next === '*') { mode = 'block'; out[index] = ' '; out[index + 1] = ' '; index += 2; continue }
      if (char === '"' || char === "'" || char === '`') { mode = 'string'; quote = char; out[index] = ' '; index += 1; continue }
      index += 1
      continue
    }
    if (mode === 'line') {
      if (char === '\n') { mode = 'code'; index += 1; continue }
      out[index] = ' '; index += 1; continue
    }
    if (mode === 'block') {
      if (char === '*' && next === '/') { mode = 'code'; out[index] = ' '; out[index + 1] = ' '; index += 2; continue }
      if (char !== '\n') out[index] = ' '
      index += 1
      continue
    }
    // string / template literal, taken whole: dropping the entire literal
    // keeps the brace count balanced even for `${...}` interpolations.
    if (char === '\\') { out[index] = ' '; if (index + 1 < source.length && source[index + 1] !== '\n') out[index + 1] = ' '; index += 2; continue }
    if (char === quote) { mode = 'code'; out[index] = ' '; index += 1; continue }
    if (char !== '\n') out[index] = ' '
    index += 1
  }
  return out.join('')
}

const STORAGE_ACCESS = /(?:window\s*\.\s*)?\b(?:localStorage|sessionStorage)\b/g

interface StorageAccess { file: string; line: number; text: string; guarded: boolean }

/** Every localStorage/sessionStorage access in one file, each marked with
 *  whether the brace walk found it inside a `try { ... }` block. A catch or
 *  finally body counts as UNGUARDED on purpose: those run after the try has
 *  closed, which is exactly where two of this lane's bugs lived. */
function scanStorageAccesses(file: string, source: string): StorageAccess[] {
  const code = blankNonCode(source)
  const tryRanges: Array<[number, number]> = []
  const open: number[] = []
  let pendingTry = false
  for (let i = 0; i < code.length; i += 1) {
    if (code.startsWith('try', i) && !/[A-Za-z0-9_$]/.test(code[i - 1] || '') && !/[A-Za-z0-9_$]/.test(code[i + 3] || '')) pendingTry = true
    if (code[i] === '{') { open.push(pendingTry ? i : -1); pendingTry = false }
    else if (code[i] === '}') { const start = open.pop(); if (start !== undefined && start >= 0) tryRanges.push([start, i]) }
  }
  const lines = source.split('\n')
  const found: StorageAccess[] = []
  STORAGE_ACCESS.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = STORAGE_ACCESS.exec(code))) {
    const line = source.slice(0, match.index).split('\n').length
    found.push({
      file,
      line,
      text: (lines[line - 1] || '').trim(),
      guarded: tryRanges.some(([start, end]) => match!.index > start && match!.index < end),
    })
  }
  return found
}

function walkSources(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkSources(full, files)
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full)
  }
  return files
}

// Positive control for the instrument itself: a sweep that reports every case
// the same way is indistinguishable from a broken sweep, so prove on every run
// that the scanner both catches a bare access and accepts a guarded one.
const control = `
function bare() { return window.localStorage.getItem('x') }
function guardedFn() { try { return sessionStorage.getItem('y') } catch { return null } }
const decoy = 'localStorage.getItem is only a string here'
// and sessionStorage.setItem in a comment is not an access either
`
const controlHits = scanStorageAccesses('control.ts', control)
assert.equal(controlHits.length, 2, 'the scanner sees exactly the two real accesses, not the string or the comment')
assert.equal(controlHits.filter((hit) => !hit.guarded).length, 1, 'the bare access is reported unguarded')
assert.equal(controlHits.filter((hit) => hit.guarded).length, 1, 'the try-wrapped access is accepted')
assert.ok(controlHits.some((hit) => hit.text.includes('window.localStorage.getItem')), 'the unguarded line is named')

// Pre-existing unguarded accesses in files this lane does not own. Every entry
// is real debt of the same iOS class, kept visible rather than hidden: a new
// unguarded access ANYWHERE fails this test because it will not be listed
// here. Entries that disappear are reported as resolved, never as a failure,
// so the lane that finally fixes one is not punished by this file.
const KNOWN_UNGUARDED: Record<string, string[]> = {
  "api/branchTransport.ts": [
    "return window.sessionStorage",
  ],
  "api/inventoryWriteTransport.ts": [
    "function inventoryTransferStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.sessionStorage) {",
  ],
  "app/publicErrorRecovery.ts": [
    "return typeof window !== 'undefined' ? window.sessionStorage : null",
  ],
  "components/sales/ReportsHub.tsx": [
    "const storage = typeof window !== 'undefined' ? window.localStorage : null",
  ],
  "platform/runtime/clientRuntime.ts": [
    "...snapshotStorage(window.localStorage, localPreserveKeys).filter(([key]) => key !== 'businessos_read_session' && key !== 'businessos_auth_cookie_pending' && key !== 'businessos_unresolved_signout_v1'),",
    "...(options.preserveUiDrafts === true ? snapshotStoragePrefixes(window.localStorage, ['businessos_draft_']) : []),",
    "const keptSession = canUseBrowserStorage() ? snapshotStorage(window.sessionStorage, sessionPreserveKeys) : []",
    "clearStorage(canUseBrowserStorage() ? window.localStorage : null, localPreserveKeys)",
    "clearStorage(canUseBrowserStorage() ? window.sessionStorage : null, sessionPreserveKeys)",
    "restoreStorage(canUseBrowserStorage() ? window.localStorage : null, keptLocal)",
    "restoreStorage(canUseBrowserStorage() ? window.sessionStorage : null, keptSession)",
  ],
  "utils/actionHistory.ts": [
    "if (typeof window === 'undefined' || !window.sessionStorage) return []",
    "if (typeof window === 'undefined' || !window.sessionStorage) return",
  ],
}

const sweep = walkSources(srcRoot).flatMap((file) => {
  const source = fs.readFileSync(file, 'utf8')
  if (!/localStorage|sessionStorage/.test(source)) return []
  return scanStorageAccesses(path.relative(srcRoot, file).replace(/\\/g, '/'), source)
})
assert.ok(sweep.length > 150, `the sweep must actually reach the app sources (saw ${sweep.length} accesses)`)

const unguarded = sweep.filter((hit) => !hit.guarded)
const unexpected = unguarded.filter((hit) => !(KNOWN_UNGUARDED[hit.file] || []).includes(hit.text))
assert.deepEqual(
  unexpected.map((hit) => `${hit.file}:${hit.line}  ${hit.text}`),
  [],
  'every localStorage/sessionStorage access under frontend/src must sit inside a try block: touching the property itself throws on iOS with site data blocked',
)
const resolved = Object.entries(KNOWN_UNGUARDED).flatMap(([file, texts]) => texts
  .filter((text) => !unguarded.some((hit) => hit.file === file && hit.text === text))
  .map((text) => `${file}  ${text}`))
if (resolved.length) console.log(`NOTE ${resolved.length} baseline entries are now guarded and can be pruned:\n  ${resolved.join('\n  ')}`)
console.log(`PASS storage sweep: ${sweep.length} accesses, ${sweep.length - unguarded.length} guarded, ${unguarded.length} known-baseline, 0 unexpected`)

// ---------------------------------------------------------------------------
// 2. The guarded helper families still guard (the allowlisted definitions)
// ---------------------------------------------------------------------------

// These are the only functions allowed to touch a Storage object directly.
// Each one is checked to still exist AND to still hold its access inside a
// try, so a later edit cannot quietly remove the guard while every call site
// keeps looking correct.
const GUARDED_HELPERS: Array<{ file: string; fn: string }> = [
  { file: 'components/pos/POS.tsx', fn: 'posStorage' },
  { file: 'components/pos/POS.tsx', fn: 'readPosStorage' },
  { file: 'components/pos/POS.tsx', fn: 'writePosStorage' },
  { file: 'components/pos/POS.tsx', fn: 'removePosStorage' },
  { file: 'api/actorReadScope.ts', fn: 'scopeStorage' },
  { file: 'api/actorReadScope.ts', fn: 'readScopeStorage' },
  { file: 'api/actorReadScope.ts', fn: 'writeScopeStorage' },
  { file: 'api/actorReadScope.ts', fn: 'removeScopeStorage' },
  { file: 'api/shiftTransport.ts', fn: 'shiftRequestStore' },
  { file: 'api/shiftTransport.ts', fn: 'readShiftRequest' },
  { file: 'api/shiftTransport.ts', fn: 'writeShiftRequest' },
  { file: 'api/shiftTransport.ts', fn: 'clearShiftRequest' },
  { file: 'components/branches/BranchesHubPage.tsx', fn: 'clearDashboardInventoryFocus' },
]
for (const helper of GUARDED_HELPERS) {
  const source = read(helper.file)
  const start = source.indexOf(`function ${helper.fn}(`)
  assert.ok(start >= 0, `${helper.file} must still define ${helper.fn}()`)
  const body = source.slice(start, source.indexOf('\n}', start))
  assert.match(body, /\btry\b/, `${helper.file}: ${helper.fn}() must keep its try guard`)
}
// One family per file, not two: POS's pre-existing draft helpers delegate to
// the primitives rather than keeping a second copy of the guard.
const posSource = read('components/pos/POS.tsx')
assert.match(posSource, /const readPosDraft = [\s\S]{0,200}readPosStorage\('local', key\)/, 'readPosDraft delegates to the shared primitive')
assert.match(posSource, /const writePosDraft = [\s\S]{0,200}writePosStorage\('local', key, value\)/, 'writePosDraft delegates to the shared primitive')
console.log(`PASS ${GUARDED_HELPERS.length} guarded helper definitions still hold their try, and POS keeps ONE helper family`)

// ---------------------------------------------------------------------------
// 3. Same device, old data: keys and defaults are unchanged
// ---------------------------------------------------------------------------

// Guarding must be invisible when storage works. A renamed key would silently
// abandon a cashier's saved filters and cart draft, and a changed fallback
// would change behaviour for a missing value.
for (const [key, fallback] of [
  ['pos_search', "|| ''"],
  ['pos_cat', "|| 'all'"],
  ['pos_brand', "|| 'all'"],
  ['pos_branch', "|| 'all'"],
  ['pos_stock', "|| 'all'"],
  ['pos_group', "|| 'all'"],
  ['pos_supplier', "|| 'all'"],
  ['pos_initial', "|| 'all'"],
] as const) {
  const line = posSource.split('\n').find((candidate) => candidate.includes(`readPosStorage('session', '${key}')`) && candidate.includes('useState'))
  assert.ok(line, `POS still restores ${key} from session storage under its original key`)
  assert.ok(line!.includes(fallback), `${key} keeps its original missing-value default ${fallback}`)
}
for (const key of ['pos_cart_view', 'pos_cart_width_px', 'pos_cart_details_pct', 'businessos_pos_orders_', 'businessos_pos_active_', 'businessos_pos_counter_']) {
  assert.ok(posSource.includes(key), `POS keeps the storage key ${key}`)
}
assert.ok(read('api/shiftTransport.ts').includes('businessos_shift_request_v1:'), 'the shift retry key is unchanged')
assert.ok(read('components/contacts/Contacts.tsx').includes("'bos:contacts:focus'"), 'the contacts focus key is unchanged')
assert.ok(read('components/products/Products.tsx').includes("'bos:dashboard:products-focus'"), 'the products focus key is unchanged')
assert.ok(read('components/branches/BranchesHubPage.tsx').includes("'bos:dashboard:inventory-focus'"), 'the inventory focus key is unchanged')
const scopeSource = read('api/actorReadScope.ts')
for (const key of ['businessos_read_session', 'businessos_auth_cookie_pending', 'businessos_oauth_cookie_owner', 'businessos_oauth_callback_result']) {
  assert.ok(scopeSource.includes(`'${key}'`), `actorReadScope keeps the storage key ${key}`)
}
console.log('PASS storage key names and missing-value defaults are unchanged (old data on a shared device behaves exactly as before)')

// ---------------------------------------------------------------------------
// 4. Both roots mount the boundary
// ---------------------------------------------------------------------------

for (const [file, surface] of [['AdminRoot.tsx', 'admin-root'], ['PublicCatalogRoot.tsx', 'public-catalog-root']] as const) {
  const source = read(file)
  assert.match(source, /import RootErrorBoundary from '[^']*RootErrorBoundary\.tsx'/, `${file} imports the root boundary`)
  assert.ok(source.includes(`<RootErrorBoundary surface="${surface}">`), `${file} mounts <RootErrorBoundary surface="${surface}">`)
  // Above the providers, or a throw inside a provider's own first render --
  // the storefront's blocked-storage incident -- escapes it again.
  const boundaryAt = source.indexOf('<RootErrorBoundary')
  const providerAt = source.search(/<(AppProvider|PublicCatalogAppProvider)\b/)
  assert.ok(boundaryAt >= 0 && providerAt > boundaryAt, `${file} mounts the boundary ABOVE its provider`)
}
console.log('PASS AdminRoot and PublicCatalogRoot both mount RootErrorBoundary above their providers')

// ---------------------------------------------------------------------------
// 5. RootErrorBoundary at runtime
// ---------------------------------------------------------------------------

const require_ = createRequire(import.meta.url)
const React = require_('react') as typeof import('react')
const boundarySource = read('components/shared/RootErrorBoundary.tsx')
// That file's own comments legitimately DISCUSS storage and reloads, so the two
// checks below read it with comments and strings blanked out.
const boundaryCode = blankNonCode(boundarySource)
assert.doesNotMatch(boundaryCode, /localStorage|sessionStorage|serviceWorker|caches\./,
  'the last-resort boundary must not clear storage or unregister the service worker: queued offline sales live there')
assert.doesNotMatch(boundaryCode, /componentDidCatch[\s\S]{0,400}location\.reload/,
  'the boundary never reloads by itself -- chunk recovery in App.tsx owns automatic reloads and its loop guard')

const compiled = transformSync(boundarySource, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
const reported: Array<[string, string]> = []
const boundaryModule = { exports: {} as { default?: any } }
const loadBoundaryDep = (id: string) => {
  if (id === 'react') return React
  if (id === 'react/jsx-runtime') return require_(id)
  if (id.includes('clientCrashReport')) return { reportClientCrash: async (error: Error, page: string) => { reported.push([error.message, page]) } }
  throw new Error(`Unexpected dependency ${id}`)
}
new Function('require', 'module', 'exports', compiled)(loadBoundaryDep, boundaryModule, boundaryModule.exports)
const RootErrorBoundary = boundaryModule.exports.default

const child = React.createElement('div', null, 'real app')
const instance = new RootErrorBoundary({ surface: 'admin-root', children: child })
assert.equal(instance.render(), child, 'with no error the boundary is invisible: children render untouched')

const blockedStorageError = new TypeError("null is not an object (evaluating 'window.localStorage')")
instance.state = RootErrorBoundary.getDerivedStateFromError(blockedStorageError)
const logged: string[] = []
const originalConsoleError = console.error
console.error = (...args: unknown[]) => { logged.push(args.join(' ')) }
let reloads = 0
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
Object.defineProperty(globalThis, 'window', { value: { location: { reload: () => { reloads += 1 } } }, configurable: true })
try {
  instance.componentDidCatch(blockedStorageError, { componentStack: '\n  at AppProvider' })
} finally {
  console.error = originalConsoleError
}
assert.equal(logged.length, 1, 'the crash leaves a console breadcrumb')
assert.match(logged[0], /RootErrorBoundary.*admin-root/, 'the breadcrumb names the failing surface')
assert.deepEqual(reported, [["null is not an object (evaluating 'window.localStorage')", 'admin-root']], 'and is reported to the Worker, never swallowed')

const flattened: any[] = []
;(function walkTree(node: any) {
  if (node === null || node === undefined || node === false) return
  if (Array.isArray(node)) { node.forEach(walkTree); return }
  if (typeof node === 'object' && node.props) { flattened.push(node); walkTree(node.props.children); return }
  flattened.push(node)
})(instance.render())
const panelText = flattened.filter((node) => typeof node === 'string').join(' ')
assert.match(panelText, /The app could not start/, 'the panel says what happened in English')
assert.match(panelText, /កម្មវិធីមិនអាចចាប់ផ្តើមបានទេ/, 'and in Khmer -- the packs may not have loaded, so the copy is hard-coded')
assert.match(panelText, /TypeError/, 'the error name is shown')
assert.match(panelText, /window\.localStorage/, 'and its message, so a blank-page report carries evidence')
const reloadButton = flattened.find((node) => node && node.type === 'button')
assert.ok(reloadButton, 'a Reload button is offered')
assert.match(String(reloadButton.props.children), /Reload \/ ផ្ទុកឡើងវិញ/, 'labelled in both languages')
reloadButton.props.onClick()
assert.equal(reloads, 1, 'pressing it reloads exactly once')
if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
else Reflect.deleteProperty(globalThis, 'window')
// Khmer stacks diacritics above and below the base glyph; a Latin-sized line
// box clips them, so every text line in the panel carries explicit room.
const lineHeights = [...boundarySource.matchAll(/lineHeight: ([\d.]+)/g)].map((match) => Number(match[1]))
assert.ok(lineHeights.length >= 5, 'every text style in the panel declares its own line-height')
assert.ok(lineHeights.every((value) => value >= 1.7), 'no line box in the panel is left at a Latin default')
assert.ok(lineHeights.filter((value) => value >= 1.9).length >= 4,
  'the four line boxes that carry Khmer (title, Khmer title, body, button) get the full 1.9')
console.log('PASS RootErrorBoundary renders children, then a bilingual error panel with a working Reload, and reports the crash')

// ---------------------------------------------------------------------------
// 6. isStandaloneDisplayMode
// ---------------------------------------------------------------------------

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
async function standaloneIn(win: unknown, nav: unknown, label: string): Promise<boolean> {
  if (win === null) Reflect.deleteProperty(globalThis, 'window')
  else Object.defineProperty(globalThis, 'window', { value: win, configurable: true })
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true })
  const loaded = await import(`../src/utils/standaloneDisplay.ts?${label}`)
  return loaded.isStandaloneDisplayMode()
}
assert.equal(await standaloneIn(null, {}, 'no-window'), false, 'no window at all is not standalone')
assert.equal(await standaloneIn({ matchMedia: () => ({ matches: false }) }, {}, 'browser-tab'), false, 'a browser tab is not standalone')
assert.equal(await standaloneIn({ matchMedia: () => ({ matches: false }) }, { standalone: true }, 'ios-home-screen'), true, 'iOS reports only navigator.standalone')
assert.equal(await standaloneIn({ matchMedia: () => ({ matches: true }) }, {}, 'installed-pwa'), true, 'every other engine reports the display-mode query')
assert.equal(await standaloneIn({}, {}, 'no-match-media'), false, 'a missing matchMedia answers false instead of throwing')
assert.equal(await standaloneIn({ matchMedia: () => { throw new Error('blocked') } }, {}, 'throwing'), false, 'a throwing matchMedia answers false instead of throwing')
if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
Reflect.deleteProperty(globalThis, 'window')
// The Drive consent page must not be opened as a popup in a standalone PWA:
// window.open returns a truthy proxy there while Safari opens it elsewhere, so
// the popup branch "succeeds" and the postMessage handshake never arrives.
const backupSource = read('components/utils-settings/Backup.tsx')
// Blanked, because the explanatory comment inside that function names
// window.open() before the code reaches the standalone check.
const backupCode = blankNonCode(backupSource)
const setupStart = backupCode.indexOf('const openGoogleDriveSetup')
assert.ok(setupStart >= 0, 'Backup.tsx still has openGoogleDriveSetup')
const setupBody = backupCode.slice(setupStart, backupCode.indexOf('\n  }', setupStart))
const standaloneAt = setupBody.indexOf('isStandaloneDisplayMode()')
const openAt = setupBody.indexOf('window.open(')
assert.ok(standaloneAt >= 0 && openAt > standaloneAt,
  'Backup.tsx takes the same-tab path in standalone BEFORE it ever tries window.open')
assert.ok(setupBody.slice(standaloneAt, openAt).includes('window.location.assign(pendingAuthUrl)'),
  'and the standalone branch is the same-tab redirect, not a no-op')
assert.match(backupSource, /searchParams\.get\('drive_sync'\)/, 'and the same-tab return leg (?drive_sync=) is actually consumed')
console.log('PASS isStandaloneDisplayMode over six shapes, and Drive OAuth avoids the iOS popup dead end')

// ---------------------------------------------------------------------------
// 7. The OAuth owner marker: mirror, fresh context, shared device
// ---------------------------------------------------------------------------

assert.match(scopeSource, /readScopeStorage\('session', OAUTH_COOKIE_OWNER\) \|\| readScopeStorage\('local', OAUTH_COOKIE_OWNER\)/,
  'the return leg reads sessionStorage first and then the localStorage mirror')
assert.match(scopeSource, /writeScopeStorage\('local', OAUTH_COOKIE_OWNER, marker\)/, 'and the mirror is written before the redirect')

const OWNER_KEY = 'businessos_oauth_cookie_owner'
const local = new Map<string, string>()
let session = new Map<string, string>()
const mapStorage = (get: () => Map<string, string>) => ({
  getItem: (key: string) => get().get(key) ?? null,
  setItem: (key: string, value: string) => { get().set(key, value) },
  removeItem: (key: string) => { get().delete(key) },
})
const events = new EventTarget()
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  location: { origin: 'https://ios.test' },
  localStorage: mapStorage(() => local),
  sessionStorage: mapStorage(() => session),
  navigator: { locks: { request: (_name: string, _options: unknown, action: () => unknown) => Promise.resolve().then(action) } },
  addEventListener: events.addEventListener.bind(events),
  removeEventListener: events.removeEventListener.bind(events),
  dispatchEvent: events.dispatchEvent.bind(events),
} })
const scope = await import('../src/api/actorReadScope.ts')
// A fresh module instance per scenario, so nothing carries over in module
// scope. The specifier is built at runtime: a literal '...ts?query' is not a
// resolvable module path for tsc, only for the ESM loader.
const reimportScope = (label: string): Promise<typeof scope> => import(`../src/api/actorReadScope.ts?${label}`)

// (A) the iOS standalone PWA comes back in a FRESH browsing context.
const marker = await scope.beginActorCookieMutation()
const redirect = scope.prepareActorOauthCookieRedirect(marker, 'https://ios.test/?settings=integrations')
const returnedMarker = new URL(redirect).searchParams.get('auth_session_intent')
assert.equal(returnedMarker, marker, 'the marker travels in the server-signed return URL')
assert.equal(session.get(OWNER_KEY), marker, 'sessionStorage holds the marker for a normal tab')
assert.equal(local.get(OWNER_KEY), marker, 'and localStorage mirrors it for a context swap')
session = new Map()
const afterRedirect = await reimportScope('fresh-browsing-context')
assert.equal(afterRedirect.finishActorOauthCookieRedirect('auth-pending:someone-elses-marker'), false,
  'a value that does not match the signed marker is never accepted')
assert.equal(local.get(OWNER_KEY), marker,
  'and a stray mismatched callback cannot erase the live owner and lock the person out of their own sign-in')
assert.equal(afterRedirect.finishActorOauthCookieRedirect(returnedMarker), true,
  'the localStorage mirror completes a sign-in that used to hang forever on iOS')
assert.equal(local.has(OWNER_KEY), false, 'the mirror is consumed on the first success')
assert.equal(session.has(OWNER_KEY), false, 'and so is the session copy')
assert.equal(afterRedirect.isActorCookieMutationPending(), false, 'the cookie phase is settled')
assert.equal(afterRedirect.finishActorOauthCookieRedirect(returnedMarker), false, 'a consumed marker cannot be replayed')

// (B) a shop phone shared by several staff accounts.
local.set(OWNER_KEY, 'auth-pending:another-accounts-abandoned-attempt')
const sharedDevice = await reimportScope('shared-device')
assert.equal(sharedDevice.finishActorOauthCookieRedirect('auth-pending:another-accounts-abandoned-attempt'), false,
  'a stale marker is rejected even when the returned value matches it: it no longer owns the pending cookie phase')
assert.equal(local.has(OWNER_KEY), false, 'and it is deleted, not left in localStorage for a later redirect to meet')

// (C) the marker lives only for the duration of one redirect.
scope.completeActorSessionReconciliation(scope.actorSessionReconciliationMarker())
local.set(OWNER_KEY, 'auth-pending:older-attempt')
const nextMarker = await scope.beginActorCookieMutation()
assert.equal(local.has(OWNER_KEY), false, 'starting a new cookie phase clears any earlier marker')
scope.prepareActorOauthCookieRedirect(nextMarker, 'https://ios.test/?settings=integrations')
assert.equal(local.get(OWNER_KEY), nextMarker)
assert.equal(scope.finishActorCookieMutation(nextMarker), true)
assert.equal(local.has(OWNER_KEY), false, 'and settling any cookie phase -- the shape every logout takes -- deletes both copies')
assert.equal(session.has(OWNER_KEY), false)
console.log('PASS OAuth marker: mirrored for the redirect, read back after a fresh iOS context, consumed once, never reusable by another account')

console.log('PASS iOS storage resilience')
