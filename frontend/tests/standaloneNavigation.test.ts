import assert from 'node:assert/strict'

// Section 8b (PWA/iOS): behavior-tests the pure detection/gating logic in
// platform/runtime/standaloneNavigation.ts under node with minimal
// window/navigator/localStorage shims -- the DOM click-delegation guard
// itself (installStandaloneExternalLinkGuard) is exercised indirectly via
// its exported detection helpers rather than a full jsdom click simulation,
// consistent with this suite's other lightweight node-shim tests.

const memory = new Map<string, string>()
let uaOverride = ''
let maxTouchPointsOverride = 0
let matchMediaResult = false
let navigatorStandaloneOverride: boolean | undefined

;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => (memory.has(key) ? memory.get(key)! : null),
  setItem: (key: string, value: string) => { memory.set(key, value) },
  removeItem: (key: string) => { memory.delete(key) },
}

const eventListeners = new Map<string, Array<(...args: unknown[]) => void>>()
function currentNavigator() {
  return {
    userAgent: uaOverride,
    maxTouchPoints: maxTouchPointsOverride,
    standalone: navigatorStandaloneOverride,
  }
}
const windowShim: Record<string, unknown> = {
  localStorage: (globalThis as Record<string, unknown>).localStorage,
  matchMedia: (query: string) => ({ matches: query.includes('standalone') ? matchMediaResult : false }),
  addEventListener: (type: string, listener: (...args: unknown[]) => void) => {
    eventListeners.set(type, [...(eventListeners.get(type) || []), listener])
  },
  removeEventListener: () => {},
  dispatchEvent: (event: { type: string }) => {
    for (const listener of eventListeners.get(event.type) || []) listener(event)
  },
  location: { href: 'https://admin.leangbeauty.com/pos', origin: 'https://admin.leangbeauty.com' },
}
Object.defineProperty(windowShim, 'navigator', { configurable: true, get: currentNavigator })
;(globalThis as Record<string, unknown>).window = windowShim
Object.defineProperty(globalThis, 'navigator', { configurable: true, get: currentNavigator })
;(globalThis as Record<string, unknown>).document = {
  addEventListener: () => {},
}

const {
  isStandaloneDisplayMode,
  shouldOfferIosInstallHint,
  dismissIosInstallHint,
  installBeforeInstallPromptCapture,
  onInstallPromptAvailable,
  hasDeferredInstallPrompt,
  promptAppInstall,
} = await import('../src/platform/runtime/standaloneNavigation.ts')

let failed = 0
type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const IOS_SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const IOS_CHROME_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1'
const ANDROID_CHROME_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'
const IPADOS_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

function resetState() {
  memory.clear()
  uaOverride = ''
  maxTouchPointsOverride = 0
  matchMediaResult = false
  navigatorStandaloneOverride = undefined
}

await runTest('isStandaloneDisplayMode reads the display-mode media query first', () => {
  resetState()
  matchMediaResult = true
  assert.equal(isStandaloneDisplayMode(), true)
})

await runTest('isStandaloneDisplayMode falls back to navigator.standalone (legacy iOS Safari)', () => {
  resetState()
  matchMediaResult = false
  navigatorStandaloneOverride = true
  assert.equal(isStandaloneDisplayMode(), true)
})

await runTest('isStandaloneDisplayMode is false in an ordinary browser tab', () => {
  resetState()
  assert.equal(isStandaloneDisplayMode(), false)
})

await runTest('shouldOfferIosInstallHint offers the hint on iPhone Safari, not already-dismissed', () => {
  resetState()
  uaOverride = IOS_SAFARI_UA
  assert.equal(shouldOfferIosInstallHint(), true)
})

await runTest('shouldOfferIosInstallHint offers the hint on iPadOS 13+ (Macintosh UA + touch points)', () => {
  resetState()
  uaOverride = IPADOS_UA
  maxTouchPointsOverride = 5
  assert.equal(shouldOfferIosInstallHint(), true)
})

await runTest('shouldOfferIosInstallHint does NOT misclassify a real Mac (no touch points) as iPad', () => {
  resetState()
  uaOverride = IPADOS_UA
  maxTouchPointsOverride = 0
  assert.equal(shouldOfferIosInstallHint(), false)
})

await runTest('shouldOfferIosInstallHint excludes iOS Chrome (CriOS) -- it cannot install via Share the same way', () => {
  resetState()
  uaOverride = IOS_CHROME_UA
  assert.equal(shouldOfferIosInstallHint(), false)
})

await runTest('shouldOfferIosInstallHint excludes Android entirely', () => {
  resetState()
  uaOverride = ANDROID_CHROME_UA
  assert.equal(shouldOfferIosInstallHint(), false)
})

await runTest('shouldOfferIosInstallHint is false once already running standalone', () => {
  resetState()
  uaOverride = IOS_SAFARI_UA
  matchMediaResult = true
  assert.equal(shouldOfferIosInstallHint(), false)
})

await runTest('dismissIosInstallHint persists and shouldOfferIosInstallHint respects it after', () => {
  resetState()
  uaOverride = IOS_SAFARI_UA
  assert.equal(shouldOfferIosInstallHint(), true)
  dismissIosInstallHint()
  assert.equal(shouldOfferIosInstallHint(), false)
})

await runTest('beforeinstallprompt capture defers the native prompt and notifies listeners once available', async () => {
  resetState()
  assert.equal(hasDeferredInstallPrompt(), false)
  installBeforeInstallPromptCapture()

  let notified = false
  const unsubscribe = onInstallPromptAvailable(() => { notified = true })

  let defaultPrevented = false
  let promptCalls = 0
  const fakeEvent = {
    type: 'beforeinstallprompt',
    preventDefault: () => { defaultPrevented = true },
    prompt: async () => { promptCalls += 1 },
    userChoice: Promise.resolve({ outcome: 'accepted' as const }),
  }
  ;(globalThis.window as { dispatchEvent: (e: unknown) => void }).dispatchEvent(fakeEvent)

  assert.equal(defaultPrevented, true)
  assert.equal(notified, true)
  assert.equal(hasDeferredInstallPrompt(), true)

  const accepted = await promptAppInstall()
  assert.equal(accepted, true)
  assert.equal(promptCalls, 1)
  // Single-use: the reference is consumed once replayed.
  assert.equal(hasDeferredInstallPrompt(), false)
  assert.equal(await promptAppInstall(), false)

  unsubscribe()
})

// --- P2-9 findings 6 and 8 (additive) -------------------------------------
// Section 8b made the shell work offline; these keep it LOOKING right offline
// and keep the install nudge from turning into a paragraph.
const fsp = await import('node:fs')
const pathp = await import('node:path')
const urlp = await import('node:url')
const testDir = pathp.dirname(urlp.fileURLToPath(import.meta.url))
const frontendRoot = pathp.join(testDir, '..')
const swSource = fsp.readFileSync(pathp.join(frontendRoot, 'src', 'public-runtime', 'service-worker.ts'), 'utf8')

function listWoff2(dir: string, out: string[] = []): string[] {
  for (const entry of fsp.readdirSync(dir, { withFileTypes: true })) {
    const full = pathp.join(dir, entry.name)
    if (entry.isDirectory()) listWoff2(full, out)
    else if (entry.name.endsWith('.woff2')) out.push('/' + pathp.relative(pathp.join(frontendRoot, 'public'), full).replace(/\\/g, '/'))
  }
  return out
}

await runTest('every self-hosted font file is precached, declared, and used -- all three agree', () => {
  // P2-9 finding 6: the app self-hosts its faces (no Google Fonts request to
  // fail offline), but the service worker precached only the app shell and
  // the icons. A cold offline start therefore rendered the whole UI --
  // including Khmer -- in the OS fallback face. Three lists have to stay in
  // step, and a mismatch in any direction is a silent visual regression:
  //   files on disk  <->  FONT_URLS in the worker  <->  @font-face in CSS.
  const onDisk = listWoff2(pathp.join(frontendRoot, 'public', 'fonts')).sort()
  const declared = (swSource.match(/'\/fonts\/[^']+\.woff2'/g) || [])
    .map((quoted) => quoted.slice(1, -1))
    .sort()
  const fontsCss = fsp.readFileSync(pathp.join(frontendRoot, 'src', 'styles', 'fonts.css'), 'utf8')
  const referenced = [...new Set((fontsCss.match(/\/fonts\/[^')]+\.woff2/g) || []))].sort()

  assert.ok(onDisk.length >= 10, 'expected the self-hosted Latin and Khmer faces on disk, found ' + onDisk.length)
  assert.deepEqual(declared, onDisk, 'the service worker precache list and public/fonts have drifted apart')
  assert.deepEqual(referenced, onDisk, 'a @font-face points at a file that does not exist, or a shipped file is never used')
})

await runTest('fonts are runtime-cached as immutable assets, not just precached', () => {
  // Precaching alone would leave a face added between releases uncovered, and
  // a precache miss (quota, a flaky install) permanently uncovered. The
  // /fonts/ prefix rule is the safety net underneath the explicit list.
  assert.match(swSource, /function isCacheableStaticPath[\s\S]{0,400}?pathname\.startsWith\('\/fonts\/'\)/, 'font requests must be handled by the static route at all')
  assert.match(swSource, /function isHashedBuildAsset[\s\S]{0,200}?pathname\.startsWith\('\/fonts\/'\)/, 'font files are content-named, so they must be cache-first rather than network-first')
})

await runTest('an SPA-fallback HTML response is never cached as a font', () => {
  // A missing font under the SPA fallback answers 200 text/html. Caching that
  // as a .woff2 poisons the cache for the life of the build and renders every
  // glyph in the OS fallback face -- online as well as offline.
  assert.match(
    swSource, /pathname\.endsWith\('\.woff2'\)\s*\)?\s*return contentType\.includes\('font'\)/,
    'isValidStaticResponse must content-type-check woff2 before caching it',
  )
})

await runTest('the offline fallback document is part of the precached shell', () => {
  assert.ok(fsp.existsSync(pathp.join(frontendRoot, 'public', 'offline.html')), 'public/offline.html must ship')
  assert.match(swSource, /APP_SHELL_URLS = \[[^\]]*'\/offline\.html'/, 'offline.html must be precached, or the offline page is itself offline')
  assert.match(swSource, /cache\.match\('\/offline\.html'\)/, 'a navigation with nothing cached must fall back to it')
})

await runTest('the iOS install hint keeps its visible copy short and folds the rest away', () => {
  // P2-9 finding 8 / the project's density rule: the band sits across the
  // bottom of a phone screen, so the visible line names the two steps and
  // nothing else; the why-bother lives behind an InfoHint.
  const hint = fsp.readFileSync(pathp.join(frontendRoot, 'src', 'components', 'shared', 'IosInstallHint.tsx'), 'utf8')
  assert.match(hint, /import InfoHint from/, 'the detail must move behind the shared InfoHint, not into the band')
  assert.match(hint, /t\('ios_install_hint_detail'\)/, 'the InfoHint must carry the longer explanation')

  const en = JSON.parse(fsp.readFileSync(pathp.join(frontendRoot, 'src', 'lang', 'en.json'), 'utf8')) as Record<string, string>
  const km = JSON.parse(fsp.readFileSync(pathp.join(frontendRoot, 'src', 'lang', 'km.json'), 'utf8')) as Record<string, string>
  for (const key of ['ios_install_hint', 'ios_install_hint_detail', 'install_app']) {
    assert.ok(en[key] && en[key].trim(), 'en.json is missing ' + key)
    assert.ok(km[key] && km[key].trim(), 'km.json is missing ' + key)
    assert.match(km[key], /[ក-៿]/, 'km.json still holds the English string for ' + key)
  }
  // Roughly 34 characters fit per line at 14px on a 375px-wide band once the
  // icon, the info dot and the close button are subtracted; three lines is
  // the agreed ceiling, so the visible string stays under ~102 characters.
  assert.ok(
    en.ios_install_hint.length <= 102,
    'the visible hint is ' + en.ios_install_hint.length + ' characters, which wraps past three lines on a 375px screen -- move the detail into ios_install_hint_detail',
  )
})

await runTest('the install hint and the update toast cannot cover each other', () => {
  // Both are bottom-anchored and both can be on screen at once. The toast
  // stack sits above the bottom nav; the install band is the full-width
  // strip below it. If they ever shared an offset one would hide the other.
  const app = fsp.readFileSync(pathp.join(frontendRoot, 'src', 'App.tsx'), 'utf8')
  assert.match(app, /<IosInstallHint \/>/, 'App.tsx owns the install band')
  assert.match(app, /bottom-\[calc\(4rem\+env\(safe-area-inset-bottom\)\)\]/, 'the toast stack must clear the mobile bottom nav (h-14) and the home indicator')
})

if (failed > 0) {
  process.exitCode = 1
}
