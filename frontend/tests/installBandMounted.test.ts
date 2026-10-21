import assert from 'node:assert/strict'
import { act } from 'react'
import { createHarness, installSteppedClock, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'
import { STORAGE_KEYS } from '../src/constants.ts'

// The real InstallPromptBand, mounted (React DOM + the real standaloneNavigation module + the real
// iOS steps modal), on a phone-shaped window. installOffer.test.ts drives the pure module and
// static markup; this file proves what a shopper actually sees and taps.

const SHOP_HOST = 'leangbeauty.com'
const ADMIN_HOST = 'admin.leangbeauty.com'
const DAY_MS = 24 * 60 * 60 * 1000
const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.46 Mobile/15E148 Safari/604.1',
}
const DISMISSED_KEY = `${STORAGE_KEYS.DEVICE_SETTINGS}:install-offer-dismissed-at-v2`
const INSTALLED_KEY = `${STORAGE_KEYS.DEVICE_SETTINGS}:app-installed-at-v1`

type Language = 'en' | 'km'
const translateIn = (language: Language) => (_key: string, fallback: string, fallbackKm: string) => (language === 'km' ? fallbackKm : fallback)

type Device = { userAgent: string; hostname?: string; iosStandalone?: boolean; displayModeStandalone?: boolean; sameBrowser?: boolean }
type PromptEvent = Event & { prompted: number }

function promptEvent(outcome: 'accepted' | 'dismissed'): PromptEvent {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as PromptEvent & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: string }>
  }
  event.prompted = 0
  event.prompt = async () => { event.prompted += 1 }
  event.userChoice = Promise.resolve({ outcome })
  return event
}

// The harness window ignores listeners; give it a real event target so the app's own
// window.addEventListener('beforeinstallprompt') receives what a browser would send.
function configureWindow(device: Device): EventTarget {
  const win = globalThis.window as unknown as Record<string, unknown>
  const target = new EventTarget()
  win.addEventListener = target.addEventListener.bind(target)
  win.removeEventListener = target.removeEventListener.bind(target)
  win.dispatchEvent = target.dispatchEvent.bind(target)
  Object.assign(globalThis.navigator, { userAgent: device.userAgent, maxTouchPoints: 5, standalone: device.iosStandalone === true })
  const location = win.location as Record<string, unknown>
  location.hostname = device.hostname ?? SHOP_HOST
  win.matchMedia = (query: string) => ({ matches: query === '(display-mode: standalone)' && device.displayModeStandalone === true, media: query, addEventListener() {}, removeEventListener() {} })
  if (!device.sameBrowser) globalThis.localStorage.clear()
  return target
}

type Scenario = { win: EventTarget; mountBand(language?: Language): Promise<MountedSurface>; arm(): Promise<void> }

async function scenario(device: Device, run: (s: Scenario) => Promise<void>): Promise<void> {
  const harness = await createHarness()
  const win = configureWindow(device)
  const surfaces: MountedSurface[] = []
  try {
    await run({
      win,
      // index.tsx's job: arm the capture before anything mounts. Mounting the exported function is the
      // only way to run the harness's own module instance of it; it renders nothing.
      async arm() {
        const quiet = console.error
        console.error = () => {}
        try {
          surfaces.push(await harness.mount({ component: 'utils/standaloneNavigation.ts', exportName: 'installBeforeInstallPromptCapture', app: {}, doubles: {} }))
        } finally { console.error = quiet }
      },
      async mountBand(language = 'en') {
        const surface = await harness.mount({
          component: 'components/shared/InstallPromptBand.tsx',
          props: { translate: translateIn(language) },
          app: { t: (key: string) => key, language },
          doubles: {},
        })
        surfaces.push(surface)
        return surface
      },
    })
  } finally {
    for (const surface of surfaces) await surface.unmount()
    await harness.close()
  }
}

const dispatch = async (win: EventTarget, event: Event) => { await act(async () => { win.dispatchEvent(event) }) }
const buttonWithText = (surface: MountedSurface, text: string): MemoryNode =>
  surface.find((node) => node.tagName === 'BUTTON' && node.textContent.replace(/\s+/g, ' ').trim() === text, `"${text}" button`)
const hasButtonWithText = (surface: MountedSurface, text: string): boolean =>
  surface.findAll((node) => node.tagName === 'BUTTON' && node.textContent.replace(/\s+/g, ' ').trim() === text).length > 0
const closeButton = (surface: MountedSurface): MemoryNode =>
  surface.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'Dismiss notification', 'close button')

let failed = 0
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await check('nothing shows until the browser fires beforeinstallprompt', async () => {
  await scenario({ userAgent: UA.android }, async (s) => {
    await s.arm()
    const band = await s.mountBand()
    assert.equal(band.text(), '')
    await dispatch(s.win, promptEvent('accepted'))
    await band.settle()
    assert.match(band.text(), /Install Leang Cosmetics/)
    assert.ok(hasButtonWithText(band, 'Install'))
  })
})

await check('an event fired before React mounted is still offered, in both languages with the shop name', async () => {
  for (const [language, label, install] of [['en', 'Install Leang Cosmetics', 'Install'], ['km', 'ដំឡើង Leang Cosmetics', 'ដំឡើង']] as const) {
    await scenario({ userAgent: UA.android }, async (s) => {
      await s.arm()
      const event = promptEvent('accepted')
      await dispatch(s.win, event)
      assert.equal(event.defaultPrevented, true, 'the capture kept it from the browser')
      const band = await s.mountBand(language)
      assert.ok(band.text().includes(label), `${language}: the band names the shop (${band.text()})`)
      assert.ok(hasButtonWithText(band, install), `${language}: the main action is one word`)
    })
  }
})

await check('without capture at entry the same early event is lost', async () => {
  await scenario({ userAgent: UA.android }, async (s) => {
    const event = promptEvent('accepted')
    await dispatch(s.win, event)
    await s.arm()
    const band = await s.mountBand()
    assert.equal(event.defaultPrevented, false)
    assert.equal(band.text(), '', 'nothing to offer: this is the defect the entry-level capture removes')
  })
})

await check('accepted: the prompt is replayed once, the band goes, the install is remembered', async () => {
  await scenario({ userAgent: UA.android }, async (s) => {
    await s.arm()
    const event = promptEvent('accepted')
    await dispatch(s.win, event)
    const band = await s.mountBand()
    await band.click(buttonWithText(band, 'Install'))
    assert.equal(event.prompted, 1)
    assert.equal(band.text(), '')
    assert.ok(Number(globalThis.localStorage.getItem(INSTALLED_KEY)) > 0)
  })
})

await check('dismissed: nothing is recorded as installed, and a later browser offer brings the band back', async () => {
  await scenario({ userAgent: UA.android }, async (s) => {
    await s.arm()
    const first = promptEvent('dismissed')
    await dispatch(s.win, first)
    const band = await s.mountBand()
    await band.click(buttonWithText(band, 'Install'))
    assert.equal(first.prompted, 1)
    assert.equal(globalThis.localStorage.getItem(INSTALLED_KEY), null, 'cancelling the sheet is not an install')
    assert.equal(band.text(), '', 'the spent prompt has nothing to replay')
    const second = promptEvent('accepted')
    await dispatch(s.win, second)
    await band.settle()
    assert.ok(hasButtonWithText(band, 'Install'), 'the browser offering again re-opens the offer')
    await band.click(buttonWithText(band, 'Install'))
    assert.equal(second.prompted, 1)
    assert.equal(first.prompted, 1, 'the spent event is never replayed')
  })
})

await check('the X keeps the band closed across a remount and a reload, and brings it back after 30 days', async () => {
  const clock = installSteppedClock()
  const phone = { userAgent: UA.android }
  const reloaded = { userAgent: UA.android, sameBrowser: true }
  try {
    await scenario(phone, async (s) => {
      await s.arm()
      await dispatch(s.win, promptEvent('accepted'))
      const band = await s.mountBand()
      await band.click(closeButton(band))
      assert.equal(band.text(), '')
      assert.ok(globalThis.localStorage.getItem(DISMISSED_KEY))
      await band.unmount()
      assert.equal((await s.mountBand()).text(), '', 'remounted: still closed')
    })
    for (const [days, offered] of [[1, false], [29, false], [31, true]] as const) {
      clock.advance((days === 1 ? 1 : days === 29 ? 28 : 2) * DAY_MS)
      await scenario(reloaded, async (s) => {
        await s.arm()
        await dispatch(s.win, promptEvent('accepted'))
        const text = (await s.mountBand()).text()
        if (offered) assert.match(text, /Install Leang Cosmetics/, `day ${days}: offered again`)
        else assert.equal(text, '', `day ${days}: still closed after a reload`)
      })
    }
  } finally { clock.restore() }
})

await check('iOS Safari and iOS Chrome show the steps instruction with no Install button, and tapping it opens the steps', async () => {
  for (const [name, userAgent] of [['Safari', UA.iosSafari], ['Chrome', UA.iosChrome]] as const) {
    await scenario({ userAgent }, async (s) => {
      await s.arm()
      const band = await s.mountBand()
      assert.match(band.text(), /Install Leang Cosmetics: tap/, `${name}: names the shop`)
      assert.equal(hasButtonWithText(band, 'Install'), false, `${name}: no native Install button on iOS`)
      await band.click(band.button(/Add to Home Screen/))
      assert.match(band.text(), /Install on iPhone or iPad/, `${name}: the steps modal opened from the band text`)
      assert.match(band.text(), /Keep Open as Web App on/)
    })
  }
})

await check('the iOS band text and steps are Khmer in Khmer', async () => {
  await scenario({ userAgent: UA.iosSafari }, async (s) => {
    await s.arm()
    const band = await s.mountBand('km')
    assert.ok(band.text().includes('ដំឡើង Leang Cosmetics'))
    await band.click(band.button(/ចែករំលែក/))
    assert.ok(band.text().includes('ដំឡើងនៅលើ iPhone ឬ iPad'))
  })
})

await check('the installed app (display-mode and navigator.standalone) shows nothing, event or not', async () => {
  await scenario({ userAgent: UA.android, displayModeStandalone: true }, async (s) => {
    await s.arm()
    await dispatch(s.win, promptEvent('accepted'))
    assert.equal((await s.mountBand()).text(), '')
  })
  await scenario({ userAgent: UA.iosSafari, iosStandalone: true }, async (s) => {
    await s.arm()
    assert.equal((await s.mountBand()).text(), '')
  })
})

await check('appinstalled hides a visible band', async () => {
  await scenario({ userAgent: UA.android }, async (s) => {
    await s.arm()
    await dispatch(s.win, promptEvent('accepted'))
    const band = await s.mountBand()
    assert.match(band.text(), /Install Leang Cosmetics/)
    await dispatch(s.win, new Event('appinstalled'))
    await band.settle()
    assert.equal(band.text(), '')
  })
})

await check('the staff host keeps its own wording and never names the shop app', async () => {
  await scenario({ userAgent: UA.iosSafari, hostname: ADMIN_HOST }, async (s) => {
    await s.arm()
    const band = await s.mountBand()
    assert.match(band.text(), /Install: tap/)
    assert.doesNotMatch(band.text(), /Leang Cosmetics/)
  })
})

if (failed > 0) {
  console.error(`installBandMounted.test.ts: ${failed} failing check(s)`)
  process.exit(1)
}
console.log('installBandMounted.test.ts OK')
process.exit(0)
