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

if (failed > 0) {
  process.exitCode = 1
}
