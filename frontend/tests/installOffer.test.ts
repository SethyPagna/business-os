import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import { STORAGE_KEYS } from '../src/constants.ts'

// Install offer. Owner brief of 2 Nov 2026: a closed band returns after 14 days; the staff app also
// offers it on desktops and, in a browser that cannot install, says where to install from; shoppers
// keep phones only (28 Sep default). Every check runs the real module against window, navigator and
// storage doubles; each case loads a fresh module instance, the way a reload does.

const read = (rel: string): string => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const readPack = (name: 'en' | 'km'): Record<string, unknown> => JSON.parse(read(`src/lang/${name}.json`)) as Record<string, unknown>
const stripComments = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('//'))
  .join('\n')

let failed = 0
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const USER_AGENTS = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.46 Mobile/15E148 Safari/604.1',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15',
  iphoneEdge: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/129.0.2792.84 Version/18.0 Mobile/15E148 Safari/604.1',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36',
  androidFacebook: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0.0.38.108;]',
  desktopFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  desktopEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  desktopMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  iphoneChromeOld: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.46 Mobile/15E148 Safari/604.1',
  iphoneOpera: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) OPiOS/16.0.15.124050 Mobile/15E148 Safari/9537.53',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22A3354 Instagram 350.0.0.10.100',
  desktopChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
}

function memoryStorage(entries: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(entries))
  return {
    get length() { return values.size },
    clear() { values.clear() },
    getItem(key) { return values.get(key) ?? null },
    key(index) { return [...values.keys()][index] ?? null },
    removeItem(key) { values.delete(key) },
    setItem(key, value) { values.set(key, String(value)) },
  }
}

function blockedStorage(): Storage {
  const refuse = () => { throw new Error('storage blocked') }
  return { length: 0, clear: refuse, getItem: refuse, key: refuse, removeItem: refuse, setItem: refuse }
}

type Device = {
  userAgent: string
  maxTouchPoints?: number
  iosStandalone?: boolean
  displayModeStandalone?: boolean
  hostname?: string
  storage?: Storage
}

function useDevice(device: Device): { window: EventTarget; storage: Storage } {
  const storage = device.storage ?? memoryStorage()
  const hostname = device.hostname ?? 'admin.leangbeauty.com'
  const win = Object.assign(new EventTarget(), {
    localStorage: storage,
    sessionStorage: memoryStorage(),
    location: { hostname, href: `https://${hostname}/`, origin: `https://${hostname}` },
    matchMedia: (query: string) => ({ matches: query === '(display-mode: standalone)' && device.displayModeStandalone === true }),
  })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: device.userAgent, maxTouchPoints: device.maxTouchPoints ?? 0, standalone: device.iosStandalone === true },
  })
  return { window: win, storage }
}

type InstallModule = typeof import('../src/utils/standaloneNavigation.ts')
let moduleInstance = 0
async function freshInstallModule(): Promise<InstallModule> {
  moduleInstance += 1
  const loaded = await import(`../src/utils/standaloneNavigation.ts?instance=${moduleInstance}`) as InstallModule
  loaded.installBeforeInstallPromptCapture()
  return loaded
}

function installPromptEvent(outcome: 'accepted' | 'dismissed' = 'accepted'): Event & { prompted: number } {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompted: number
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
  }
  event.prompted = 0
  event.prompt = async () => { event.prompted += 1 }
  event.userChoice = Promise.resolve({ outcome })
  return event
}

const DISMISSED_KEY = `${STORAGE_KEYS.DEVICE_SETTINGS}:install-offer-dismissed-at-v2`
const INSTALLED_KEY = `${STORAGE_KEYS.DEVICE_SETTINGS}:app-installed-at-v1`
const LEGACY_IOS_DISMISSED_KEY = `${STORAGE_KEYS.DEVICE_SETTINGS}:ios-install-hint-dismissed-at-v1`
const DAY_MS = 24 * 60 * 60 * 1000

async function withClockAdvancedBy(ms: number, fn: () => Promise<void>): Promise<void> {
  const realNow = Date.now
  const shifted = realNow() + ms
  Date.now = () => shifted
  try { await fn() } finally { Date.now = realNow }
}

await check('the installed app never gets the band or the menu entry', async () => {
  useDevice({ userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: 5, iosStandalone: true })
  const ios = await freshInstallModule()
  assert.equal(ios.installBandRoute(), null, 'iOS home-screen app: no band')
  assert.equal(ios.installMenuRoute(), null, 'iOS home-screen app: no menu entry')

  const android = useDevice({ userAgent: USER_AGENTS.androidChrome, maxTouchPoints: 5, displayModeStandalone: true })
  const installed = await freshInstallModule()
  android.window.dispatchEvent(installPromptEvent())
  assert.equal(installed.installBandRoute(), null, 'display-mode standalone: no band even with a captured prompt')
  assert.equal(installed.installMenuRoute(), null, 'display-mode standalone: no menu entry')
})

await check('iOS Safari, and Chrome/Firefox/Edge on iOS 16.4+, get the Share route; Opera, old iOS and in-app browsers get the hint instead', async () => {
  for (const userAgent of [USER_AGENTS.iphoneSafari, USER_AGENTS.iphoneChrome, USER_AGENTS.iphoneFirefox, USER_AGENTS.iphoneEdge]) {
    useDevice({ userAgent, maxTouchPoints: 5 })
    const install = await freshInstallModule()
    assert.equal(install.installBandRoute(), 'ios-share', userAgent)
    assert.equal(install.installBandRoute(true), 'ios-share', userAgent)
    assert.equal(install.installMenuRoute(), 'ios-share', userAgent)
  }
  for (const userAgent of [USER_AGENTS.iphoneChromeOld, USER_AGENTS.iphoneOpera, USER_AGENTS.iphoneInstagram]) {
    useDevice({ userAgent, maxTouchPoints: 5 })
    const other = await freshInstallModule()
    assert.equal(other.installBandRoute(), null, `${userAgent}: the shop band never tells a shopper to switch browser`)
    assert.equal(other.installBandRoute(true), 'open-elsewhere', `${userAgent} cannot Add to Home Screen: the staff band says where to install from`)
    assert.equal(other.installMenuRoute(), null, 'the menu entry would have nothing to run, so it stays hidden')
  }
})

await check('a beforeinstallprompt fired before capture is lost; captured at entry it is kept once', async () => {
  const device = useDevice({ userAgent: USER_AGENTS.androidChrome, maxTouchPoints: 5 })
  moduleInstance += 1
  const late = await import(`../src/utils/standaloneNavigation.ts?instance=${moduleInstance}`) as InstallModule
  const lost = installPromptEvent()
  device.window.dispatchEvent(lost)
  late.installBeforeInstallPromptCapture()
  assert.equal(lost.defaultPrevented, false, 'nothing was listening, so the browser keeps its own infobar and the event is gone')
  assert.equal(late.installBandRoute(), null, 'a late capture has nothing to offer')

  const kept = installPromptEvent()
  device.window.dispatchEvent(kept)
  assert.equal(kept.defaultPrevented, true)
  assert.equal(late.installBandRoute(), 'native-prompt')
  const stop = late.installBeforeInstallPromptCapture()
  stop()
  assert.equal(late.installBandRoute(), 'native-prompt', 'a second call is idempotent and its teardown never reaches the first capture')
  assert.equal(await late.promptAppInstall(), true)
  assert.equal(kept.prompted, 1, 'replayed exactly once')
})

await check('index.tsx arms the capture before React mounts; no component tears it down', () => {
  const entry = read('src/index.tsx')
  const capture = entry.indexOf('installBeforeInstallPromptCapture()')
  assert.ok(capture > 0, 'index.tsx calls the capture')
  assert.ok(capture < entry.indexOf('ReactDOM.createRoot'), 'the capture is armed before createRoot')
  for (const rel of ['src/App.tsx', 'src/components/catalog/PublicCatalogPage.tsx']) {
    assert.doesNotMatch(read(rel), /installBeforeInstallPromptCapture/, `${rel} must not own (or tear down) the capture`)
  }
})

await check('Android shows the native route only after beforeinstallprompt, and tells subscribers', async () => {
  const device = useDevice({ userAgent: USER_AGENTS.androidChrome, maxTouchPoints: 5 })
  const install = await freshInstallModule()
  assert.equal(install.installBandRoute(), null, 'nothing to offer before Chrome says the page is installable')
  let notified = 0
  const unsubscribe = install.subscribeInstallOffer(() => { notified += 1 })
  const event = installPromptEvent()
  device.window.dispatchEvent(event)
  assert.equal(event.defaultPrevented, true, "the browser's own mini-infobar is suppressed")
  assert.equal(install.installBandRoute(), 'native-prompt')
  assert.equal(install.installMenuRoute(), 'native-prompt')
  assert.ok(notified > 0, 'a mounted band must hear that the prompt arrived')
  unsubscribe()
})

await check('a desktop with a captured prompt gets the menu entry everywhere and the band in the staff app only', async () => {
  const device = useDevice({ userAgent: USER_AGENTS.desktopChrome })
  const install = await freshInstallModule()
  device.window.dispatchEvent(installPromptEvent())
  assert.equal(install.installBandRoute(), null, 'shoppers keep the 28 Sep default: a desktop shop shows no card over its header')
  assert.equal(install.installBandRoute(true), 'native-prompt', 'owner brief 2 Nov: desktop Chrome or Edge gets one Install button in the staff app')
  assert.equal(install.installMenuRoute(), 'native-prompt', 'owner default: desktops get the menu button')
})

await check('appinstalled hides a visible band without a reload, and a later prompt clears it', async () => {
  const device = useDevice({ userAgent: USER_AGENTS.androidChrome, maxTouchPoints: 5 })
  const install = await freshInstallModule()
  device.window.dispatchEvent(installPromptEvent())
  assert.equal(install.installBandRoute(), 'native-prompt')
  let notified = 0
  install.subscribeInstallOffer(() => { notified += 1 })
  device.window.dispatchEvent(new Event('appinstalled'))
  assert.ok(notified > 0, 'the visible band must be told, or it keeps offering an installed app')
  assert.equal(install.installBandRoute(), null)
  assert.equal(install.installMenuRoute(), null)
  assert.ok(Number(device.storage.getItem(INSTALLED_KEY)) > 0, 'the install is remembered for this device')

  const reloaded = await freshInstallModule()
  assert.equal(reloaded.installMenuRoute(), null, 'after a reload the installed flag still hides the menu entry')
  device.window.dispatchEvent(installPromptEvent())
  assert.equal(device.storage.getItem(INSTALLED_KEY), null, 'a new beforeinstallprompt proves the app is not installed any more')
  assert.equal(reloaded.installBandRoute(), 'native-prompt')
})

await check('an accepted native prompt records the install; a declined one only spends the prompt', async () => {
  const accepted = useDevice({ userAgent: USER_AGENTS.androidChrome, maxTouchPoints: 5 })
  const acceptInstall = await freshInstallModule()
  const acceptEvent = installPromptEvent('accepted')
  accepted.window.dispatchEvent(acceptEvent)
  assert.equal(await acceptInstall.promptAppInstall(), true)
  assert.equal(acceptEvent.prompted, 1)
  assert.ok(Number(accepted.storage.getItem(INSTALLED_KEY)) > 0)
  assert.equal(acceptInstall.installMenuRoute(), null)

  const declined = useDevice({ userAgent: USER_AGENTS.androidChrome, maxTouchPoints: 5 })
  const declineInstall = await freshInstallModule()
  declined.window.dispatchEvent(installPromptEvent('dismissed'))
  assert.equal(await declineInstall.promptAppInstall(), false)
  assert.equal(declined.storage.getItem(INSTALLED_KEY), null)
  assert.equal(declineInstall.installBandRoute(), null, 'the prompt is single-use, so nothing is left to offer')
  assert.equal(await declineInstall.promptAppInstall(), false, 'a second click must not replay a spent prompt')
  const retry = installPromptEvent('accepted')
  declined.window.dispatchEvent(retry)
  assert.equal(declineInstall.installBandRoute(), 'native-prompt', 'the browser offering again brings the offer back')
  assert.equal(await declineInstall.promptAppInstall(), true)
  assert.equal(retry.prompted, 1)
})

await check('a closed band stays closed for 14 days, then the offer returns; the menu entry never goes', async () => {
  const ios = useDevice({ userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: 5 })
  const first = await freshInstallModule()
  let notified = 0
  first.subscribeInstallOffer(() => { notified += 1 })
  first.dismissInstallBand()
  assert.ok(notified > 0)
  assert.equal(first.installBandRoute(), null)
  assert.equal(first.installMenuRoute(), 'ios-share', 'closing the bar keeps the pull entry')
  assert.ok(ios.storage.getItem(DISMISSED_KEY), 'the choice is stored for the device')
  assert.equal(first.INSTALL_BAND_REOFFER_MS, 14 * DAY_MS, 'owner brief 2 Nov: remembered for 14 days')
  await withClockAdvancedBy(13 * DAY_MS, async () => {
    assert.equal((await freshInstallModule()).installBandRoute(), null, 'day 13: still closed')
  })
  await withClockAdvancedBy(15 * DAY_MS, async () => {
    const reloaded = await freshInstallModule()
    assert.equal(reloaded.installBandRoute(), 'ios-share', 'day 15: the band is offered again')
    reloaded.dismissInstallBand()
    assert.equal(reloaded.installBandRoute(), null, 'closing it again closes it again')
  })

  const android = useDevice({ userAgent: USER_AGENTS.androidChrome, maxTouchPoints: 5 })
  const beforeClose = await freshInstallModule()
  android.window.dispatchEvent(installPromptEvent())
  beforeClose.dismissInstallBand()
  const afterReload = await freshInstallModule()
  android.window.dispatchEvent(installPromptEvent())
  assert.equal(afterReload.installBandRoute(), null, 'closed on Android too')
  assert.equal(afterReload.installMenuRoute(), 'native-prompt')
  await withClockAdvancedBy(15 * DAY_MS, async () => {
    assert.equal(afterReload.installBandRoute(), 'native-prompt', 'and it returns after 14 days')
  })
})

await check('the old iOS hint dismissal alone keeps the band closed', async () => {
  useDevice({
    userAgent: USER_AGENTS.iphoneSafari,
    maxTouchPoints: 5,
    storage: memoryStorage({ [LEGACY_IOS_DISMISSED_KEY]: String(Date.now() - 10 * DAY_MS) }),
  })
  const install = await freshInstallModule()
  assert.equal(install.installBandRoute(), null)
  assert.equal(install.installMenuRoute(), 'ios-share')
  await withClockAdvancedBy(5 * DAY_MS, async () => {
    assert.equal(install.installBandRoute(), 'ios-share', 'the legacy dismissal also lapses after 14 days')
  })
})

await check('blocked storage still closes the band for this page, without throwing', async () => {
  useDevice({ userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: 5, storage: blockedStorage() })
  const install = await freshInstallModule()
  assert.equal(install.installBandRoute(), 'ios-share')
  install.dismissInstallBand()
  assert.equal(install.installBandRoute(), null)
})

type Route = 'native-prompt' | 'ios-share' | 'open-elsewhere' | null
const PHONE = 5
const closedNow = () => memoryStorage({ [DISMISSED_KEY]: String(Date.now()) })
const installedBefore = () => memoryStorage({ [INSTALLED_KEY]: String(Date.now()) })

// Every platform branch, as [staff band, shop band, account menu] for one device.
const PLATFORM_MATRIX: Array<{ name: string; device: Device; prompt?: true; expected: [Route, Route, Route] }> = [
  { name: 'iPhone Safari', device: { userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: PHONE }, expected: ['ios-share', 'ios-share', 'ios-share'] },
  { name: 'iPad (reports as a Mac, has touch)', device: { userAgent: USER_AGENTS.desktopMac, maxTouchPoints: PHONE }, expected: ['ios-share', 'ios-share', 'ios-share'] },
  { name: 'a real Mac (no touch)', device: { userAgent: USER_AGENTS.desktopMac }, expected: [null, null, null] },
  { name: 'iPhone home-screen app', device: { userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: PHONE, iosStandalone: true }, expected: [null, null, null] },
  { name: 'iPhone in-app browser inside the home-screen app', device: { userAgent: USER_AGENTS.iphoneInstagram, maxTouchPoints: PHONE, iosStandalone: true }, expected: [null, null, null] },
  { name: 'iPhone Safari, band closed', device: { userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: PHONE, storage: closedNow() }, expected: [null, null, 'ios-share'] },
  { name: 'iPhone in-app browser', device: { userAgent: USER_AGENTS.iphoneInstagram, maxTouchPoints: PHONE }, expected: ['open-elsewhere', null, null] },
  { name: 'iPhone in-app browser, hint closed', device: { userAgent: USER_AGENTS.iphoneInstagram, maxTouchPoints: PHONE, storage: closedNow() }, expected: [null, null, null] },
  { name: 'Android Chrome before beforeinstallprompt', device: { userAgent: USER_AGENTS.androidChrome, maxTouchPoints: PHONE }, expected: [null, null, null] },
  { name: 'Android Chrome with the prompt', device: { userAgent: USER_AGENTS.androidChrome, maxTouchPoints: PHONE }, prompt: true, expected: ['native-prompt', 'native-prompt', 'native-prompt'] },
  { name: 'Android Chrome with the prompt, band closed', device: { userAgent: USER_AGENTS.androidChrome, maxTouchPoints: PHONE, storage: closedNow() }, prompt: true, expected: [null, null, 'native-prompt'] },
  { name: 'Android installed app with a prompt', device: { userAgent: USER_AGENTS.androidChrome, maxTouchPoints: PHONE, displayModeStandalone: true }, prompt: true, expected: [null, null, null] },
  { name: 'Android with an install already recorded', device: { userAgent: USER_AGENTS.androidChrome, maxTouchPoints: PHONE, storage: installedBefore() }, expected: [null, null, null] },
  { name: 'Android WebView', device: { userAgent: USER_AGENTS.androidWebView, maxTouchPoints: PHONE }, expected: ['open-elsewhere', null, null] },
  { name: 'Android Facebook in-app browser', device: { userAgent: USER_AGENTS.androidFacebook, maxTouchPoints: PHONE }, expected: ['open-elsewhere', null, null] },
  { name: 'Android WebView that does fire the prompt', device: { userAgent: USER_AGENTS.androidWebView, maxTouchPoints: PHONE }, prompt: true, expected: ['native-prompt', 'native-prompt', 'native-prompt'] },
  { name: 'desktop Chrome with the prompt', device: { userAgent: USER_AGENTS.desktopChrome }, prompt: true, expected: ['native-prompt', null, 'native-prompt'] },
  { name: 'desktop Edge with the prompt', device: { userAgent: USER_AGENTS.desktopEdge }, prompt: true, expected: ['native-prompt', null, 'native-prompt'] },
  { name: 'desktop Chrome with the prompt, band closed', device: { userAgent: USER_AGENTS.desktopChrome, storage: closedNow() }, prompt: true, expected: [null, null, 'native-prompt'] },
  { name: 'desktop Chrome without a prompt (installed, or not installable)', device: { userAgent: USER_AGENTS.desktopChrome }, expected: [null, null, null] },
  { name: 'installed desktop app', device: { userAgent: USER_AGENTS.desktopChrome, displayModeStandalone: true }, prompt: true, expected: [null, null, null] },
  { name: 'desktop Firefox', device: { userAgent: USER_AGENTS.desktopFirefox }, expected: [null, null, null] },
]

await check('band and menu routes for every platform branch, staff app and shop', async () => {
  for (const { name, device, prompt, expected } of PLATFORM_MATRIX) {
    const { window: win } = useDevice(device)
    const install = await freshInstallModule()
    if (prompt) win.dispatchEvent(installPromptEvent())
    assert.deepEqual(
      [install.installBandRoute(true), install.installBandRoute(false), install.installMenuRoute()],
      expected,
      `${name}: [staff band, shop band, menu]`,
    )
  }
})

await check('the platform matrix separates every route from every wrong one', () => {
  const seen = new Set(PLATFORM_MATRIX.flatMap(({ expected }) => expected))
  for (const route of ['native-prompt', 'ios-share', 'open-elsewhere', null] as const) assert.ok(seen.has(route), `a case expects ${route}`)
  assert.ok(PLATFORM_MATRIX.some(({ expected }) => expected[0] === 'native-prompt' && expected[1] === null), 'a case where only the staff app shows the band')
  assert.ok(PLATFORM_MATRIX.some(({ expected }) => expected[0] === 'open-elsewhere' && expected[2] === null), 'a case where only the staff band shows the hint')
})

type RuntimeModule = { resetClientRuntimeState(options: Record<string, unknown>): Promise<void> }
function loadClientRuntime(): RuntimeModule {
  const source = read('src/platform/runtime/clientRuntime.ts')
    .replaceAll("import('../../api/localDb.ts')", "Promise.resolve(require('../../api/localDb.ts'))")
  const compiled = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  const localDb = { async resetLocalMirrorDbPreservingOfflineWork() {}, async resetLocalMirrorDb() {}, async clearLocalMirrorTables() {} }
  const runtime = { exports: {} as RuntimeModule }
  new Function('require', 'module', 'exports', compiled)((request: string) => {
    if (request === '../../constants.ts') return { STORAGE_KEYS }
    if (request === '../../api/localDb.ts') return localDb
    throw new Error(`Unexpected production dependency: ${request}`)
  }, runtime, runtime.exports)
  return runtime.exports
}

await check('sign-out keeps every install-offer device key and clears the account', async () => {
  const { INSTALL_OFFER_DEVICE_KEYS } = await freshInstallModule()
  assert.deepEqual([...INSTALL_OFFER_DEVICE_KEYS].sort(), [DISMISSED_KEY, INSTALLED_KEY, LEGACY_IOS_DISMISSED_KEY].sort())
  const { resetClientRuntimeState } = loadClientRuntime()
  for (const options of [{ clearAuth: true }, { clearAuth: true, preserveDeviceSettings: false }]) {
    const seeded = Object.fromEntries(INSTALL_OFFER_DEVICE_KEYS.map((key) => [key, String(Date.now())]))
    const { storage } = useDevice({
      userAgent: USER_AGENTS.iphoneSafari,
      storage: memoryStorage({ ...seeded, [STORAGE_KEYS.USER]: '{"id":7}' }),
    })
    await resetClientRuntimeState({ ...options, preserveServiceWorker: true })
    for (const key of INSTALL_OFFER_DEVICE_KEYS) {
      assert.equal(storage.getItem(key), seeded[key], `${key} must survive ${JSON.stringify(options)}, or the next cashier is asked again`)
    }
    assert.equal(storage.getItem(STORAGE_KEYS.USER), null, 'the signed-in account itself is still cleared')
  }
})

const require = createRequire(import.meta.url)
const React = require('react') as typeof import('react')
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server')

// Server rendering always takes getServerSnapshot; the band only exists in a browser, so
// the harness reads the client snapshot the way the first browser render does.
const clientSnapshotReact = {
  ...React,
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}
const iconStub = (request: string) => (props: { className?: string }) =>
  React.createElement('svg', { 'data-icon': request.split('/').pop()?.replace('.js', ''), className: props.className })

type ComponentModule = { default: import('react').FunctionComponent<Record<string, unknown>> } & Record<string, unknown>
function compileComponent(rel: string, deps: Record<string, unknown>): ComponentModule {
  const compiled = transformSync(read(rel), { loader: 'tsx', format: 'cjs', jsx: 'automatic', target: 'es2022' }).code
  const mod = { exports: {} as ComponentModule }
  new Function('require', 'module', 'exports', compiled)((request: string) => {
    if (request in deps) return deps[request]
    if (request === 'react') return clientSnapshotReact
    if (request === 'react/jsx-runtime') return require('react/jsx-runtime')
    if (request === 'react-dom') return { createPortal: (node: unknown) => node }
    if (request.startsWith('lucide-react/')) return iconStub(request)
    throw new Error(`Unexpected dependency ${request} in ${rel}`)
  }, mod, mod.exports)
  return mod.exports
}

type Language = 'en' | 'km'
const inlineCopy = (language: Language) => (_key: string, fallback: string, fallbackKm: string) => (language === 'km' ? fallbackKm : fallback)

const pathRouting = await import('../src/app/pathRouting.ts')
const compileBand = (install: InstallModule): ComponentModule => compileComponent('src/components/shared/InstallPromptBand.tsx', {
  '../../utils/standaloneNavigation.ts': install,
  '../../app/pathRouting.ts': pathRouting,
  '../../utils/lazyImport.ts': { lazyRetry: () => () => null },
  '../../utils/useInstallBandClearance.ts': { useInstallBandClearance: () => {} },
})

async function renderBand(device: Device, language: Language, afterLoad?: (win: EventTarget, install: InstallModule) => void): Promise<string> {
  const { window: win } = useDevice(device)
  const install = await freshInstallModule()
  afterLoad?.(win, install)
  return renderToStaticMarkup(React.createElement(compileBand(install).default, { translate: inlineCopy(language) }))
}

const visibleText = (html: string): string => html.replace(/<[^>]+>/g, '').trim()
const buttons = (html: string): Array<{ attributes: string; inner: string }> =>
  [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attributes, inner]) => ({ attributes, inner }))
const attribute = (attributes: string, name: string): string | undefined => new RegExp(`${name}="([^"]*)"`).exec(attributes)?.[1]

function assertIconOnlyButtonsNamedByTooltip(html: string, expectedLabel: string): void {
  const iconOnly = buttons(html).filter(({ inner }) => visibleText(inner) === '')
  assert.ok(iconOnly.length > 0, 'expected an icon-only close button')
  for (const { attributes, inner } of iconOnly) {
    assert.match(inner, /<svg/, 'an icon-only button shows its icon')
    assert.equal(attribute(attributes, 'aria-label'), expectedLabel)
    assert.equal(attribute(attributes, 'title'), expectedLabel, 'the tooltip is the same translated text as the aria-label')
  }
}

const OFFLINE_OR_STAFF_NAMES = /offline|Business OS|admin\.|ក្រៅបណ្ដាញ/i

await check('the iOS band is one Download + Install button that opens the drawn steps, with an icon-only close', async () => {
  for (const [language, install, close] of [['en', 'Install', 'Dismiss notification'], ['km', 'ដំឡើង', 'បិទការជូនដំណឹង']] as const) {
    const html = await renderBand({ userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: 5 }, language)
    const text = visibleText(html)
    assert.ok(text.includes(String(readPack(language).ios_install_hint)), `${language}: the band says what the sheet will show`)
    assert.doesNotMatch(text, /Share|ចែករំលែក|•••/, `${language}: the long Share/••• sentence moved into the sheet, where it is drawn`)
    assert.doesNotMatch(text, OFFLINE_OR_STAFF_NAMES, `${language}: no offline promise (owner cancelled offline mode)`)
    const labelled = buttons(html).filter(({ inner }) => visibleText(inner) !== '')
    assert.equal(labelled.length, 1, `${language}: exactly one labelled button`)
    assert.match(labelled[0].inner, /data-icon="download"/, 'the main action carries the Download icon')
    assert.equal(visibleText(labelled[0].inner), install, 'the main action is one word')
    assertIconOnlyButtonsNamedByTooltip(html, close)
    assert.doesNotMatch(html, /data-info-hint/, 'the info icon is gone: the one line it hid is now visible')
  }
})

await check('a browser that cannot install gets a one-line hint and no Install button, in the staff app only', async () => {
  for (const userAgent of [USER_AGENTS.iphoneInstagram, USER_AGENTS.iphoneOpera, USER_AGENTS.androidWebView]) {
    for (const [language, close] of [['en', 'Dismiss notification'], ['km', 'បិទការជូនដំណឹង']] as const) {
      const html = await renderBand({ userAgent, maxTouchPoints: 5 }, language)
      const hint = String(readPack(language).install_open_elsewhere_hint)
      assert.ok(visibleText(html).includes(hint), `${language}: ${userAgent} reads the hint`)
      assert.equal(buttons(html).filter(({ inner }) => visibleText(inner) !== '').length, 0, 'nothing to press: the only button is the icon-only close')
      assertIconOnlyButtonsNamedByTooltip(html, close)
    }
    assert.equal(await renderBand({ userAgent, maxTouchPoints: 5, hostname: 'leangbeauty.com' }, 'en'), '', `${userAgent}: shoppers are never told to switch browser`)
  }
})

await check('the Android band offers Download + one word, and closes with an icon', async () => {
  for (const [language, install, close] of [['en', 'Install', 'Dismiss notification'], ['km', 'ដំឡើង', 'បិទការជូនដំណឹង']] as const) {
    const html = await renderBand({ userAgent: USER_AGENTS.androidChrome, maxTouchPoints: 5 }, language, (win) => {
      win.dispatchEvent(installPromptEvent())
    })
    const main = buttons(html).find(({ inner }) => visibleText(inner) !== '')
    assert.ok(main, `${language}: the band has its Install button`)
    assert.match(main.inner, /data-icon="download"/, 'the main action carries the Download icon')
    assert.equal(visibleText(main.inner), install, 'the main action is one word')
    assert.doesNotMatch(visibleText(html), OFFLINE_OR_STAFF_NAMES)
    assertIconOnlyButtonsNamedByTooltip(html, close)
  }
})

await check('the band renders nothing on a desktop shop, in the installed app, or once closed', async () => {
  const fire = (win: EventTarget) => { win.dispatchEvent(installPromptEvent()) }
  assert.equal(await renderBand({ userAgent: USER_AGENTS.desktopChrome, hostname: 'leangbeauty.com' }, 'en', fire), '', 'a desktop shop shows no card over its header')
  assert.equal(await renderBand({ userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: 5, iosStandalone: true }, 'en'), '')
  assert.equal(await renderBand({ userAgent: USER_AGENTS.desktopChrome, displayModeStandalone: true }, 'en', fire), '', 'the installed desktop app never offers itself')
  assert.equal(await renderBand({ userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: 5 }, 'en', (_win, install) => { install.dismissInstallBand() }), '')
  assert.notEqual(await renderBand({ userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: 5 }, 'en'), '', 'positive control: the same iPhone before closing')
  assert.notEqual(await renderBand({ userAgent: USER_AGENTS.desktopChrome }, 'en', fire), '', 'positive control: the staff app on the same desktop')
})

await check('the staff app offers one Install button on desktop Chrome and Edge, and nothing on a browser with no install', async () => {
  for (const userAgent of [USER_AGENTS.desktopChrome, USER_AGENTS.desktopEdge]) {
    for (const [language, install, close] of [['en', 'Install', 'Dismiss notification'], ['km', 'ដំឡើង', 'បិទការជូនដំណឹង']] as const) {
      const html = await renderBand({ userAgent }, language, (win) => { win.dispatchEvent(installPromptEvent()) })
      const labelled = buttons(html).filter(({ inner }) => visibleText(inner) !== '')
      assert.equal(labelled.length, 1, `${userAgent} ${language}: one labelled button`)
      assert.match(labelled[0].inner, /data-icon="download"/)
      assert.equal(visibleText(labelled[0].inner), install)
      assertIconOnlyButtonsNamedByTooltip(html, close)
    }
  }
  assert.equal(await renderBand({ userAgent: USER_AGENTS.desktopChrome }, 'en'), '', 'no prompt captured yet (or already installed): nothing to offer')
  assert.equal(await renderBand({ userAgent: USER_AGENTS.desktopFirefox }, 'en'), '', 'Firefox on a desktop is not told to switch browser')
  assert.equal(await renderBand({ userAgent: USER_AGENTS.desktopMac }, 'en'), '', 'a real Mac is never an iOS device')
})

const INSTALL_PACK_KEYS = [
  'install_app',
  'install_app_short',
  'install_offer_detail',
  'ios_install_hint',
  'install_open_elsewhere_hint',
  'ios_install_steps_title',
  'ios_install_step_menu',
  'ios_install_step_add',
  'ios_install_chip_add',
  'ios_install_step_web_app',
  'install_shop_band',
]
const RETIRED_INSTALL_KEYS = ['install_shop_ios_hint', 'install_shop_detail']

await check('both packs carry the install keys once, side by side, with real Khmer', () => {
  const en = readPack('en')
  const km = readPack('km')
  for (const [name, pack] of [['en', en], ['km', km]] as const) {
    const raw = read(`src/lang/${name}.json`)
    const order = Object.keys(pack)
    const start = order.indexOf(INSTALL_PACK_KEYS[0])
    assert.deepEqual(order.slice(start, start + INSTALL_PACK_KEYS.length), INSTALL_PACK_KEYS, `${name}.json keeps the install keys next to each other`)
    for (const key of INSTALL_PACK_KEYS) {
      assert.equal((raw.match(new RegExp(`"${key}":`, 'g')) || []).length, 1, `${name}.json defines ${key} exactly once`)
      assert.ok(String(pack[key] ?? '').trim(), `${name}.json has a value for ${key}`)
      assert.doesNotMatch(String(pack[key]), OFFLINE_OR_STAFF_NAMES, `${name}.json ${key} makes no offline promise and names no staff app`)
    }
  }
  for (const key of INSTALL_PACK_KEYS) {
    assert.match(String(km[key]), /[ក-៿]/, `km.json ${key} is Khmer`)
    assert.notEqual(km[key], en[key], `km.json ${key} is not the English text`)
  }
  assert.ok(String(en.ios_install_step_menu).includes('•••') && String(km.ios_install_step_menu).includes('•••'), 'the first step names ••• in both languages: iOS 26 Safari can keep Share behind it')
})

await check('retired install keys are gone from both packs', () => {
  // ios_install_hint_detail promised the app keeps working offline; the two shop-only variants
  // became the one shared line now that the title alone says which app this is.
  for (const key of ['ios_install_hint_detail', ...RETIRED_INSTALL_KEYS]) {
    assert.equal(readPack('en')[key], undefined, `en.json no longer carries ${key}`)
    assert.equal(readPack('km')[key], undefined, `km.json no longer carries ${key}`)
    assert.doesNotMatch(read('src/components/shared/InstallPromptBand.tsx'), new RegExp(key))
  }
})

const KHMER_FALLBACK_CALL = /translate\(\s*'([^']+)',\s*'[^']*',\s*'([^']*)'/g
function assertEveryTranslateCallHasKhmer(rel: string, minimumCalls: number): void {
  const source = read(rel)
  const calls = [...source.matchAll(KHMER_FALLBACK_CALL)]
  assert.equal(calls.length, (source.match(/translate\(/g) || []).length, `${rel}: every translate() call passes English and Khmer fallbacks`)
  assert.ok(calls.length >= minimumCalls, `${rel}: expected at least ${minimumCalls} translate() calls`)
  for (const [, key, khmer] of calls) assert.match(khmer, /[ក-៿]/, `${rel}: translate('${key}') has a real Khmer fallback`)
  assert.doesNotMatch(stripComments(source), OFFLINE_OR_STAFF_NAMES, `${rel}: no offline promise and no staff-app name in code`)
}

await check('every install band text carries its own Khmer and no offline promise', () => {
  assertEveryTranslateCallHasKhmer('src/components/shared/InstallPromptBand.tsx', 5)
})

const packText = (language: Language) => {
  const packs = { en: readPack('en'), km: readPack('km') }
  return (key: string): string => String(packs[language][key] ?? packs.en[key] ?? key)
}

async function renderStaffBand(hostname: string, language: Language): Promise<string> {
  useDevice({ userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: 5, hostname })
  const install = await freshInstallModule()
  const hint = compileComponent('src/components/shared/IosInstallHint.tsx', {
    '../../AppContext.tsx': { useApp: () => ({ t: packText(language), language }) },
    '../../app/pathRouting.ts': pathRouting,
    './InstallPromptBand.tsx': compileBand(install),
  })
  return renderToStaticMarkup(React.createElement(hint.default, {}))
}

await check('the staff band shows the pack text on the admin host and nothing on the shop host', async () => {
  for (const language of ['en', 'km'] as const) {
    const html = await renderStaffBand('admin.leangbeauty.com', language)
    assert.ok(visibleText(html).includes(String(readPack(language).ios_install_hint)), `${language}: the admin host shows the band in the UI language`)
  }
  assert.equal(await renderStaffBand('leangbeauty.com', 'en'), '', 'staff signing in on the shop host must not install a shop-named app')
})

await check('translateFromPack falls back to the Khmer text when the pack has no value', async () => {
  useDevice({ userAgent: USER_AGENTS.desktopChrome })
  const { translateFromPack } = compileBand(await freshInstallModule()) as unknown as {
    translateFromPack: (t: (key: string) => string, language: string) => (key: string, fallback: string, fallbackKm: string) => string
  }
  const missingKey = (key: string) => key
  assert.equal(translateFromPack(missingKey, 'km')('not_in_pack', 'English', 'ខ្មែរ'), 'ខ្មែរ')
  assert.equal(translateFromPack(missingKey, 'en')('not_in_pack', 'English', 'ខ្មែរ'), 'English')
  assert.equal(translateFromPack(() => 'ពីកញ្ចប់', 'km')('in_pack', 'English', 'ខ្មែរ'), 'ពីកញ្ចប់', 'a pack value wins')
})

const appSource = read('src/App.tsx').replace(/\r\n/g, '\n')
function appBranch(opening: string): string {
  const at = appSource.indexOf(opening)
  assert.ok(at > 0, `App.tsx branch moved: ${opening}`)
  return appSource.slice(at, appSource.indexOf('\n  }\n', at))
}

await check('the staff sign-in screen carries the band; the spinner and the forced password change never do', () => {
  assert.match(
    appBranch('  if (!user) {'),
    /<Login \/>[\s\S]*<div className=\{bottomStackClass\(BOTTOM_STACK_CLEARS_SAFE_AREA_CLASS\)\}>\s*<IosInstallHint \/>/,
    'the sign-in screen mounts the band in a bottom stack below the form',
  )
  assert.doesNotMatch(appBranch('if ((!authReady && !user) || storedAuthSessionPending) {'), /IosInstallHint/, 'no band on the pre-auth spinner')
  const forced = appBranch('must_change_password || 0) === 1) {')
  assert.match(forced, /<ForcedPasswordChange \/>/)
  assert.doesNotMatch(forced, /IosInstallHint/, 'no band over the forced password change')
})

await check('the sign-in screen keeps the form clear of the band on phones, and lets desktops be', async () => {
  const { INSTALL_BAND_CLEARANCE_VAR } = await import('../src/utils/useInstallBandClearance.ts')
  const login = read('src/components/auth/Login.tsx')
  const shell = /className="(auth-shell [^"]*)"/.exec(login)?.[1] ?? ''
  const centred = /className="(mx-auto flex min-h-[^"]*items-center justify-center[^"]*)"/.exec(login)?.[1] ?? ''
  const reserve = `var(${INSTALL_BAND_CLEARANCE_VAR},0px)`
  assert.ok(shell.includes(`pb-[calc(1.5rem+${reserve})]`), 'the shell pads its bottom by the band height')
  assert.ok(shell.includes('pt-[4.75rem]'), 'phones reserve the theme and language row, so the form can never rise under it')
  assert.ok(shell.includes('md:py-6'), 'from md the band is a corner card, so both paddings go back')
  assert.ok(centred.includes(`min-h-[calc(100*var(--app-vh)_-_6.25rem_-_${reserve})]`), 'the centred form fits between the toggles row and the band (4.75rem + 1.5rem), so the page is one screen tall when it fits')
  assert.ok(centred.includes('md:min-h-[calc(100*var(--app-vh)_-_3rem)]'), 'desktops keep the full-height centring')
  assert.match(read('src/components/shared/InstallPromptBand.tsx'), /useInstallBandClearance\(bandRef, route !== null\)/, 'the band publishes its height only while it is shown')
})

await check('the staff loading screens say Leang Cosmetics Admin', () => {
  const titles = [...appSource.matchAll(/<h1 className="business-os-initial-title">([^<]*)<\/h1>/g)].map(([, title]) => title)
  assert.deepEqual(titles, ['Leang Cosmetics Admin', 'Leang Cosmetics Admin'])
})

await check('the staff account menu offers Install next to Update, on the admin host, whenever an install is possible', () => {
  const sidebar = read('src/components/navigation/Sidebar.tsx')
  assert.match(sidebar, /const installRoute = useSyncExternalStore\(subscribeInstallOffer, installMenuRoute,/, 'the row reads the menu route, which allows desktops (owner default)')
  const install = sidebar.indexOf("{ id: 'install', label: t('install_app') || 'Install app', icon: Download, onClick: installApp }")
  assert.ok(install > 0, 'the account panel has an Install row with the Download icon')
  assert.match(sidebar.slice(install - 60, install), /\.\.\.\(installRoute && isAdminHostname\(\) \? \[$/, 'the row exists only when an install is possible, and only on the admin host')
  const update = sidebar.indexOf("{ id: 'update'")
  assert.ok(update > install && !sidebar.slice(install + 1, update).includes('{ id: '), 'the Install row sits right before Update')
  assert.match(sidebar, /if \(installRoute === 'ios-share'\) setIosInstallStepsOpen\(true\)\s*else void promptAppInstall\(\)/, 'iOS opens the steps; Chromium replays the native prompt')
  assert.match(sidebar, /language: uiLanguage,/, 'the sheet falls back in the UI language the admin t() uses')
  assert.match(sidebar, /<IosInstallSteps translate=\{translateFromPack\(t, uiLanguage\)\} onClose=\{\(\) => setIosInstallStepsOpen\(false\)\} \/>/)
})

await check('the iOS steps sheet shows its three steps from first paint, in both languages', async () => {
  assert.ok(!fs.existsSync(new URL('../src/components/shared/IosInstallSteps.tsx', import.meta.url)), 'new install UI stays out of the app-shared chunk')
  useDevice({ userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: 5 })
  const { translateFromPack } = compileBand(await freshInstallModule()) as unknown as {
    translateFromPack: (t: (key: string) => string, language: string) => (key: string, fallback: string, fallbackKm: string) => string
  }
  const modalProps: Array<Record<string, unknown>> = []
  const ModalStub = ({ title, children, ...rest }: { title: string; children: unknown }) => {
    modalProps.push(rest)
    return React.createElement('div', { role: 'dialog' }, React.createElement('h2', null, title), children as never)
  }
  const steps = compileComponent('src/components/install/IosInstallSteps.tsx', { '../shared/Modal.tsx': ModalStub })
  for (const language of ['en', 'km'] as const) {
    const pack = readPack(language)
    const html = renderToStaticMarkup(React.createElement(steps.default, { translate: translateFromPack(packText(language), language), onClose: () => {} }))
    assert.equal(modalProps.at(-1)?.unsavedChanges, 'read-only', 'the shared Modal gives the sheet its close, Escape and focus handling; nothing typed can be lost')
    const text = visibleText(html)
    let at = text.indexOf(String(pack.ios_install_steps_title))
    assert.ok(at >= 0, `${language}: the title renders`)
    for (const key of ['ios_install_step_menu', 'ios_install_step_add', 'ios_install_step_web_app']) {
      const next = text.indexOf(String(pack[key]), at)
      assert.ok(next > at, `${language}: ${key} renders, in order`)
      at = next
    }
    assert.ok(text.includes('•••'), `${language}: the first step names the ••• menu`)
    const glyphs = html.match(/<svg\b[^>]*aria-hidden="true"/g) || []
    assert.equal(glyphs.length, 3, `${language}: Share and ••• for step 1 and Add to Home Screen for step 2 are drawn`)
    assert.ok(!/data-icon=/.test(html), `${language}: the glyphs are inline SVG drawn after iOS, not library icons`)
    assert.deepEqual([...html.matchAll(/rounded-full[^>]*>(\d)<\/span>/g)].map(([, n]) => n), ['1', '2', '3'], `${language}: numbered 1, 2, 3`)
    assert.ok(html.includes(`>${String(pack.ios_install_chip_add)}</span>`), `${language}: step 3 draws the Add button in the UI language`)
  }
  assert.doesNotMatch(stripComments(read('src/components/install/IosInstallSteps.tsx')), /collapsed|minimi[sz]ed|expanded/i, 'no stub that expands later')
})

await check('install sheet texts carry their own Khmer, and every inline fallback matches the packs', () => {
  assertEveryTranslateCallHasKhmer('src/components/install/IosInstallSteps.tsx', 4)
  const en = readPack('en')
  const km = readPack('km')
  for (const rel of ['src/components/shared/InstallPromptBand.tsx', 'src/components/install/IosInstallSteps.tsx']) {
    for (const [, key, english, khmer] of read(rel).matchAll(/translate\(\s*'([^']+)',\s*'([^']*)',\s*'([^']*)'/g)) {
      assert.equal(english, en[key], `${rel}: the English fallback for ${key} is the en.json text, so the shop and the till read the same words`)
      assert.equal(khmer, km[key], `${rel}: the Khmer fallback for ${key} is the km.json text`)
    }
  }
})

const SHOP_HOST = 'leangbeauty.com'
const SHOP_NAMES_NO_STAFF = /admin|staff|Business OS|បុគ្គលិក|អ្នកគ្រប់គ្រង/i
const SHOP_BUTTON_CLASS = 'shop-drawer-icon-button'

type ElementNode = { type: unknown; props: Record<string, unknown> & { children?: unknown } }
const isElement = (node: unknown): node is ElementNode => typeof node === 'object' && node !== null && 'props' in node
function findElement(node: unknown, matches: (element: ElementNode) => boolean): ElementNode | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, matches)
      if (found) return found
    }
    return undefined
  }
  if (!isElement(node)) return undefined
  return matches(node) ? node : findElement(node.props.children, matches)
}

function compileIosSteps(): ComponentModule {
  const ModalStub = ({ title, children }: { title: string; children: unknown }) =>
    React.createElement('div', { role: 'dialog' }, React.createElement('h2', null, title), children as never)
  return compileComponent('src/components/install/IosInstallSteps.tsx', { '../shared/Modal.tsx': ModalStub })
}

type ShopButton = { markup: string; click: () => void; openedSteps: unknown[] }
function renderShopButton(install: InstallModule, language: Language, stepsOpen = false): ShopButton {
  const openedSteps: unknown[] = []
  const iosSteps = compileIosSteps()
  const buttonReact = {
    ...clientSnapshotReact,
    useState: (initial: unknown) => [stepsOpen || initial, (next: unknown) => { openedSteps.push(next) }],
  }
  const lazyImport = { lazyRetry: () => iosSteps.default }
  const button = compileComponent('src/components/install/InstallAppButton.tsx', {
    react: buttonReact,
    '../../utils/lazyImport.ts': lazyImport,
    '../../utils/standaloneNavigation.ts': install,
  })
  const props = { translate: inlineCopy(language), className: SHOP_BUTTON_CLASS }
  const markup = renderToStaticMarkup(React.createElement(button.default, props))
  const tree = button.default(props)
  const click = () => {
    const found = findElement(tree, (element) => element.type === 'button')
    assert.ok(found, 'expected the install button')
    ;(found.props.onClick as () => void)()
  }
  return { markup, click, openedSteps }
}

async function shopDevice(device: Device): Promise<{ win: EventTarget; install: InstallModule }> {
  const { window: win } = useDevice({ hostname: SHOP_HOST, ...device })
  return { win, install: await freshInstallModule() }
}

await check('the shop account button is one icon named by its tooltip, in both languages', async () => {
  for (const [language, label] of [['en', 'Install app'], ['km', 'ដំឡើងកម្មវិធី']] as const) {
    const { install } = await shopDevice({ userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: 5 })
    const { markup } = renderShopButton(install, language)
    const [only, ...others] = buttons(markup)
    assert.ok(only, `${language}: the drawer shows the install button when an install is possible`)
    assert.equal(others.length, 0)
    assert.equal(visibleText(only.inner), '', 'icon-only: the Account header has no room for words')
    assert.match(only.inner, /data-icon="download"/)
    assert.equal(attribute(only.attributes, 'aria-label'), label)
    assert.equal(attribute(only.attributes, 'title'), label, 'the tooltip is the translated aria-label')
    assert.equal(attribute(only.attributes, 'class'), SHOP_BUTTON_CLASS, 'the drawer styles it like its Close button')
    assert.equal(label, String(readPack(language).install_app), 'the tooltip reads the same words as the staff menu row')
  }
})

await check('the shop account button exists only when an install is possible, never in the installed app', async () => {
  const cases: Array<[string, Device, ((win: EventTarget) => void)?]> = [
    ['iOS home-screen app', { userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: 5, iosStandalone: true }],
    ['display-mode standalone with a captured prompt', { userAgent: USER_AGENTS.androidChrome, maxTouchPoints: 5, displayModeStandalone: true }, (win) => { win.dispatchEvent(installPromptEvent()) }],
    ['Android before Chrome says the page is installable', { userAgent: USER_AGENTS.androidChrome, maxTouchPoints: 5 }],
    ['an in-app browser on iPhone, which cannot Add to Home Screen', { userAgent: USER_AGENTS.iphoneInstagram, maxTouchPoints: 5 }],
    ['an install already recorded on this device', { userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: 5, storage: memoryStorage({ [INSTALLED_KEY]: String(Date.now()) }) }],
  ]
  for (const [name, device, afterLoad] of cases) {
    const { win, install } = await shopDevice(device)
    afterLoad?.(win)
    assert.equal(renderShopButton(install, 'en').markup, '', `${name}: no install button`)
  }

  const android = await shopDevice({ userAgent: USER_AGENTS.androidChrome, maxTouchPoints: 5 })
  android.win.dispatchEvent(installPromptEvent())
  assert.notEqual(renderShopButton(android.install, 'en').markup, '', 'positive control: Android once the prompt is captured')
  android.win.dispatchEvent(new Event('appinstalled'))
  assert.equal(renderShopButton(android.install, 'en').markup, '', 'gone once the app is installed')

  const desktop = await shopDevice({ userAgent: USER_AGENTS.desktopChrome })
  desktop.win.dispatchEvent(installPromptEvent())
  assert.notEqual(renderShopButton(desktop.install, 'en').markup, '', 'owner default: laptops get the Account button, never the band')
})

await check('closing the shop band keeps the install icon in the Account drawer', async () => {
  const { install } = await shopDevice({ userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: 5 })
  install.dismissInstallBand()
  const reloaded = await freshInstallModule()
  assert.equal(reloaded.installBandRoute(), null, 'the band stays closed after a reload')
  assert.notEqual(renderShopButton(reloaded, 'en').markup, '', 'the Account button still offers the install')
})

await check('on iPhone the shop button opens the three steps; on Android it replays the native prompt', async () => {
  const iphone = await shopDevice({ userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: 5 })
  const closed = renderShopButton(iphone.install, 'km')
  closed.click()
  assert.deepEqual(closed.openedSteps, [true], 'the tap opens the steps sheet')
  const open = visibleText(renderShopButton(iphone.install, 'km', true).markup)
  const km = readPack('km')
  let at = open.indexOf(String(km.ios_install_steps_title))
  assert.ok(at >= 0, 'the sheet renders with its Khmer title')
  for (const key of ['ios_install_step_menu', 'ios_install_step_add', 'ios_install_step_web_app']) {
    const next = open.indexOf(String(km[key]), at)
    assert.ok(next > at, `${key} renders in the shop language, in order`)
    at = next
  }

  const android = await shopDevice({ userAgent: USER_AGENTS.androidChrome, maxTouchPoints: 5 })
  const event = installPromptEvent()
  android.win.dispatchEvent(event)
  const button = renderShopButton(android.install, 'en')
  button.click()
  await Promise.resolve()
  assert.equal(event.prompted, 1, 'the captured prompt is replayed')
  assert.deepEqual(button.openedSteps, [], 'no iOS sheet on Android')
})

await check('the shop band, button and steps never name admin, staff or Business OS, and link nowhere', async () => {
  for (const language of ['en', 'km'] as const) {
    const markups = [
      await renderBand({ userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: 5, hostname: SHOP_HOST }, language),
      await renderBand({ userAgent: USER_AGENTS.androidChrome, maxTouchPoints: 5, hostname: SHOP_HOST }, language, (win) => { win.dispatchEvent(installPromptEvent()) }),
    ]
    const iphone = await shopDevice({ userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: 5 })
    markups.push(renderShopButton(iphone.install, language).markup, renderShopButton(iphone.install, language, true).markup)
    for (const markup of markups) {
      assert.notEqual(markup, '', `${language}: every shop install surface rendered`)
      assert.doesNotMatch(markup, SHOP_NAMES_NO_STAFF, `${language}: the shop never names the staff app`)
      assert.doesNotMatch(markup, /<a\b|href=/, `${language}: the shop install offer links nowhere`)
    }
  }
})

await check('install button texts carry their own Khmer, matching the packs', () => {
  assertEveryTranslateCallHasKhmer('src/components/install/InstallAppButton.tsx', 1)
  for (const [, key, english, khmer] of read('src/components/install/InstallAppButton.tsx').matchAll(/translate\(\s*'([^']+)',\s*'([^']*)',\s*'([^']*)'/g)) {
    assert.equal(english, readPack('en')[key])
    assert.equal(khmer, readPack('km')[key])
  }
  assert.ok(!fs.existsSync(new URL('../src/components/shared/InstallAppButton.tsx', import.meta.url)), 'new install UI stays out of the app-shared chunk')
})

await check('the band and button gate reads the host: admin hosts are refused, shop hosts are not', () => {
  for (const [hostname, admin] of [
    ['admin.leangbeauty.com', true],
    ['localhost', true],
    ['127.0.0.1', true],
    ['[::1]', true],
    [SHOP_HOST, false],
    ['www.leangbeauty.com', false],
  ] as const) {
    useDevice({ userAgent: USER_AGENTS.iphoneSafari, hostname })
    assert.equal(pathRouting.isAdminHostname(), admin, `${hostname}: isAdminHostname`)
  }
})

if (failed > 0) {
  console.error(`installOffer.test.ts: ${failed} failing check(s)`)
  process.exit(1)
}
console.log('installOffer.test.ts OK')
