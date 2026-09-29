import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import { STORAGE_KEYS } from '../src/constants.ts'

// PWA-3a install offer (PWA-FINAL D7). Owner defaults of 28 Sep 2026: a closed
// install bar never returns on that device, and desktops get the account-menu
// entry only. Every check runs the real module against window, navigator and
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

await check('iOS Safari gets the Share route; other iOS browsers get nothing', async () => {
  useDevice({ userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: 5 })
  const safari = await freshInstallModule()
  assert.equal(safari.installBandRoute(), 'ios-share')
  assert.equal(safari.installMenuRoute(), 'ios-share')
  for (const userAgent of [USER_AGENTS.iphoneChrome, USER_AGENTS.iphoneFirefox, USER_AGENTS.iphoneEdge]) {
    useDevice({ userAgent, maxTouchPoints: 5 })
    const other = await freshInstallModule()
    assert.equal(other.installBandRoute(), null, `${userAgent} cannot Add to Home Screen the way the hint describes`)
    assert.equal(other.installMenuRoute(), null)
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

await check('a desktop with a captured prompt gets the menu entry, never the band', async () => {
  const device = useDevice({ userAgent: USER_AGENTS.desktopChrome })
  const install = await freshInstallModule()
  device.window.dispatchEvent(installPromptEvent())
  assert.equal(install.installBandRoute(), null, 'owner default: desktops and tills get no bar')
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
})

await check('a closed band never returns on that device, and the menu entry stays', async () => {
  const ios = useDevice({ userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: 5 })
  const first = await freshInstallModule()
  let notified = 0
  first.subscribeInstallOffer(() => { notified += 1 })
  first.dismissInstallBand()
  assert.ok(notified > 0)
  assert.equal(first.installBandRoute(), null)
  assert.equal(first.installMenuRoute(), 'ios-share', 'closing the bar keeps the pull entry')
  await withClockAdvancedBy(400 * DAY_MS, async () => {
    const reloaded = await freshInstallModule()
    assert.equal(reloaded.installBandRoute(), null, 'no snooze: the bar stays closed long after any snooze would end')
  })
  assert.ok(ios.storage.getItem(DISMISSED_KEY), 'the choice is stored for the device')

  const android = useDevice({ userAgent: USER_AGENTS.androidChrome, maxTouchPoints: 5 })
  const beforeClose = await freshInstallModule()
  android.window.dispatchEvent(installPromptEvent())
  beforeClose.dismissInstallBand()
  const afterReload = await freshInstallModule()
  android.window.dispatchEvent(installPromptEvent())
  assert.equal(afterReload.installBandRoute(), null, 'the Android half is closed for good too')
  assert.equal(afterReload.installMenuRoute(), 'native-prompt')
})

await check('the old iOS hint dismissal alone keeps the band closed', async () => {
  useDevice({
    userAgent: USER_AGENTS.iphoneSafari,
    maxTouchPoints: 5,
    storage: memoryStorage({ [LEGACY_IOS_DISMISSED_KEY]: String(Date.now() - 20 * DAY_MS) }),
  })
  const install = await freshInstallModule()
  assert.equal(install.installBandRoute(), null)
  assert.equal(install.installMenuRoute(), 'ios-share')
})

await check('blocked storage still closes the band for this page, without throwing', async () => {
  useDevice({ userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: 5, storage: blockedStorage() })
  const install = await freshInstallModule()
  assert.equal(install.installBandRoute(), 'ios-share')
  install.dismissInstallBand()
  assert.equal(install.installBandRoute(), null)
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
const InfoHintStub = ({ label, text }: { label: string; text: string }) => React.createElement('span', { 'data-info-hint': label }, text)

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

async function renderBand(device: Device, language: Language, afterLoad?: (win: EventTarget, install: InstallModule) => void): Promise<string> {
  const { window: win } = useDevice(device)
  const install = await freshInstallModule()
  afterLoad?.(win, install)
  const band = compileComponent('src/components/shared/InstallPromptBand.tsx', {
    '../../utils/standaloneNavigation.ts': install,
    './InfoHint.tsx': InfoHintStub,
  })
  return renderToStaticMarkup(React.createElement(band.default, { translate: inlineCopy(language) }))
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

await check('the iOS band names ••• and Share in both languages, with an icon-only close', async () => {
  for (const [language, share, close] of [['en', 'Share', 'Dismiss notification'], ['km', 'ចែករំលែក', 'បិទការជូនដំណឹង']] as const) {
    const html = await renderBand({ userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: 5 }, language)
    const text = visibleText(html)
    assert.ok(text.includes('•••'), `${language}: iOS 26 Safari keeps Share behind the ••• menu, so the band must name it`)
    assert.ok(text.includes(share), `${language}: the band names Share`)
    assert.doesNotMatch(text, OFFLINE_OR_STAFF_NAMES, `${language}: no offline promise (owner cancelled offline mode)`)
    assertIconOnlyButtonsNamedByTooltip(html, close)
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

await check('the band renders nothing on a desktop, in the installed app, or once closed', async () => {
  assert.equal(await renderBand({ userAgent: USER_AGENTS.desktopChrome }, 'en', (win) => { win.dispatchEvent(installPromptEvent()) }), '')
  assert.equal(await renderBand({ userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: 5, iosStandalone: true }, 'en'), '')
  assert.equal(await renderBand({ userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: 5 }, 'en', (_win, install) => { install.dismissInstallBand() }), '')
  assert.notEqual(await renderBand({ userAgent: USER_AGENTS.iphoneSafari, maxTouchPoints: 5 }, 'en'), '', 'positive control: the same iPhone before closing')
})

const INSTALL_PACK_KEYS = [
  'install_app',
  'install_app_short',
  'install_offer_detail',
  'ios_install_hint',
  'ios_install_steps_title',
  'ios_install_step_menu',
  'ios_install_step_add',
  'ios_install_step_web_app',
]

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
  assert.ok(String(en.ios_install_hint).includes('•••') && String(km.ios_install_hint).includes('•••'), 'the pack hint names ••• in both languages')
})

await check('ios_install_hint_detail is retired from both packs', () => {
  // Its only reader was the band, and it promised the app keeps working offline.
  assert.equal(readPack('en').ios_install_hint_detail, undefined)
  assert.equal(readPack('km').ios_install_hint_detail, undefined)
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

if (failed > 0) {
  console.error(`installOffer.test.ts: ${failed} failing check(s)`)
  process.exit(1)
}
console.log('installOffer.test.ts OK')
