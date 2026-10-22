// Lane 6.0.953 (owner, 22 Oct 2026): "click the barcode scanner to open directly, no need to ask
// allow ... make sure it doesn't always show red at top for camera ... consider all scenarios ...
// user friendly, not complex and many steps." On Android (Chrome and the installed app) and on
// iPhone (Safari and the home-screen app).
//
// The contract, tested here by mounting the real sheet and the real hook over a fake camera:
//   * One tap opens the camera. The only prompt is the browser's own: the sheet never asks first.
//   * While the camera starts, and whenever nothing has failed, the sheet shows no text and nothing red.
//   * A failure is one short line with one action, and red is for a true block only
//     (denied, or a view that forbids the camera). A dismissed prompt, a busy camera, a failed
//     start, a paused camera are neutral.
//   * The camera is released the moment the sheet closes, a code is read, or the page is hidden
//     (a camera left on shows the system's recording dot), and comes back by itself when the page does.
//
// One test per scenario row of the lane report (Records/Consolidation/2026-10-21/LANE-953.md).
//
// Run: node tests/scannerCameraScenarios.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  act,
  fire,
  installCamera,
  mountComponent,
  setVisibility,
  settle,
  stage,
  startStage,
  stopStage,
  waitFor,
  FakeWorker,
  type CameraOptions,
  type CameraProbe,
  type MemoryNode,
} from './scannerCameraHarness.ts'
import type { useBarcodeCamera } from '../src/components/products/scanning/useBarcodeCamera.ts'

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  } finally {
    stage.liveVideoFrames = false
  }
}

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MODAL = '/src/components/products/scanning/BarcodeScannerModal.tsx'
const PROBE = '/tests/scannerHookProbe.ts'

type Tree = Record<string, unknown>
function flatten(input: Tree, target: Record<string, string> = {}): Record<string, string> {
  for (const [key, value] of Object.entries(input)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value as Tree, target)
    else if (value != null) target[key] = String(value)
  }
  return target
}
const readPack = (name: string) => flatten(JSON.parse(fs.readFileSync(path.join(frontend, 'src', 'lang', `${name}.json`), 'utf8')) as Tree)
const en = readPack('en')
const km = readPack('km')
const enT = (key: string): string => en[key] ?? key
const kmT = (key: string): string => km[key] ?? key

// ---- tree helpers over the harness's in-memory DOM -------------------------

function findAll(node: MemoryNode, test: (node: MemoryNode) => boolean, found: MemoryNode[] = []): MemoryNode[] {
  if (test(node)) found.push(node)
  for (const child of node.childNodes) findAll(child, test, found)
  return found
}
const textButtons = (root: MemoryNode) => findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent.trim() !== '').map((button) => button.textContent.trim())
const classOf = (node: MemoryNode) => node.getAttribute?.('class') ?? ''
/** Everything on the sheet that carries a red (or rose) colour class: text, icon, background, border. */
const redThings = (root: MemoryNode) => findAll(root, (node) => /(^|[\s:])(text|bg|border)-(red|rose)-/.test(classOf(node)))
/** Every warning-coloured thing: amber is the sheet's one other warning colour (the flashlight message). */
const warmThings = (root: MemoryNode) => findAll(root, (node) => /(^|[\s:])(text|bg|border)-(amber|orange|yellow)-/.test(classOf(node)))
/** The big icon of the panel (not the icons inside buttons). */
const panelIcon = (root: MemoryNode) => findAll(root, (node) => node.tagName === 'svg' && node.parentNode?.tagName === 'DIV')[0]

function propsOf(node: MemoryNode): Record<string, (...args: unknown[]) => unknown> {
  const key = Object.keys(node).find((name) => name.startsWith('__reactProps$')) as keyof MemoryNode
  return node[key] as unknown as Record<string, (...args: unknown[]) => unknown>
}

const navigatorOf = () => navigator as unknown as Record<string, unknown> & { mediaDevices: Record<string, unknown> }
const windowOf = () => window as unknown as { localStorage?: unknown }

interface SheetOptions extends CameraOptions {
  userAgent?: string
  t?: (key: string) => string
  /** An in-app view whose document policy forbids the camera. */
  documentBlocked?: boolean
  /** A browser with no camera API at all. */
  unsupported?: boolean
}

interface Sheet {
  probe: CameraProbe
  container: MemoryNode
  text: () => string
  unmount: () => Promise<void>
}

async function openSheet(permission: 'granted' | 'prompt' | 'denied', options: SheetOptions = {}): Promise<Sheet> {
  const probe = installCamera(permission, options)
  if (options.userAgent) navigatorOf().userAgent = options.userAgent
  if (options.unsupported) delete navigatorOf().mediaDevices.getUserMedia
  if (options.documentBlocked) (document as unknown as { permissionsPolicy?: unknown }).permissionsPolicy = { allowsFeature: () => false }
  const mounted = await mountComponent(MODAL, { open: true, title: 'Scan barcode', onClose() {}, onDetected() {}, t: options.t ?? ((key: string) => key) })
  return {
    probe,
    container: mounted.container,
    text: () => mounted.container.textContent.trim(),
    unmount: async () => {
      delete (document as unknown as { permissionsPolicy?: unknown }).permissionsPolicy
      await mounted.unmount()
    },
  }
}

/** Runs `check` on a mounted sheet and always lets go of it. */
async function withSheet(permission: 'granted' | 'prompt' | 'denied', options: SheetOptions, check: (sheet: Sheet) => void | Promise<void>): Promise<void> {
  const sheet = await openSheet(permission, options)
  try {
    await check(sheet)
  } finally {
    await sheet.unmount()
  }
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36'
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'
const FACEBOOK_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS;FBAV/450.0;FBBV/1]'
const TELEGRAM_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36 Telegram-Android/10.14'

/** The sheet running: the video, no words, nothing red, nothing warm, and no button with text on it. */
function assertQuietLiveSheet(sheet: Sheet, label: string): void {
  assert.equal(findAll(sheet.container, (node) => node.tagName === 'VIDEO').length, 1, `${label}: the camera view is up`)
  assert.equal(sheet.text(), '', `${label}: no text while the camera starts or runs`)
  assert.deepEqual(redThings(sheet.container).map(classOf), [], `${label}: nothing red`)
  assert.deepEqual(warmThings(sheet.container).map(classOf), [], `${label}: no warning colour`)
  assert.deepEqual(textButtons(sheet.container), [], `${label}: no button to press before anything has failed`)
}

/** A failure panel: one line, one action, and red only when the camera is truly blocked. */
function assertPanel(sheet: Sheet, expected: { line: string; action: string; red: boolean }, label: string): void {
  assert.equal(sheet.text(), `${expected.line}${expected.action}`, `${label}: exactly one line and one action, nothing else`)
  assert.deepEqual(textButtons(sheet.container), [expected.action], `${label}: one action`)
  assert.equal(redThings(sheet.container).length, expected.red ? 1 : 0, `${label}: ${expected.red ? 'the icon is red' : 'nothing is red'}`)
  if (expected.red) assert.match(classOf(panelIcon(sheet.container)), /text-red-400/, `${label}: and the red is the panel icon`)
  assert.deepEqual(warmThings(sheet.container).map(classOf), [], `${label}: no warning colour`)
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
  }
}

await startStage()
try {
  // ---- one tap opens the camera: first use, granted, unknown, one-time ----------

  await runTest('first use (the browser has not asked yet): one request, the browser asks, the sheet adds nothing', async () => {
    stage.liveVideoFrames = true
    await withSheet('prompt', {}, (sheet) => {
      assert.equal(sheet.probe.getUserMediaCalls, 1, 'the tap that opened the sheet is the request')
      assertQuietLiveSheet(sheet, 'first use')
    })
  })

  await runTest('already allowed: the camera is simply running, no text, nothing red', async () => {
    stage.liveVideoFrames = true
    await withSheet('granted', {}, (sheet) => {
      assert.equal(sheet.probe.getUserMediaCalls, 1)
      assertQuietLiveSheet(sheet, 'granted')
    })
  })

  await runTest('a browser with no Permissions API (older WebKit, Firefox): it still just tries the camera, with no ask first', async () => {
    stage.liveVideoFrames = true
    await withSheet('prompt', { noPermissionsApi: true }, (sheet) => {
      assert.equal(sheet.probe.getUserMediaCalls, 1, 'unknown is "try", never "ask first"')
      assertQuietLiveSheet(sheet, 'unknown permission')
    })
  })

  await runTest('a one-time grant ("Allow this time") that the browser takes back mid-scan does not put anything on the sheet', async () => {
    stage.liveVideoFrames = true
    await withSheet('granted', {}, async (sheet) => {
      sheet.probe.permission.state = 'prompt'
      await act(async () => { for (const listener of sheet.probe.permission.listeners) listener() })
      assertQuietLiveSheet(sheet, 'one-time grant expired')
      assert.equal(sheet.probe.getUserMediaCalls, 1, 'and nothing asks again by itself')
    })
  })

  await runTest('slow decoder: the camera is up and the sheet says nothing while the decoder is still loading', async () => {
    stage.liveVideoFrames = true
    const probe = installCamera('granted', { native: false })
    FakeWorker.mode = 'never'
    const mounted = await mountComponent(MODAL, { open: true, title: 'Scan barcode', onClose() {}, onDetected() {}, t: (key: string) => key })
    try {
      assert.equal(probe.tracks[0].readyState, 'live')
      assert.equal(mounted.container.textContent.trim(), '', 'no message for a slow start')
      assert.deepEqual(redThings(mounted.container), [])
      assert.deepEqual(warmThings(mounted.container), [])
    } finally {
      await mounted.unmount()
    }
  })

  // ---- a real block: the only red ---------------------------------------------------

  await runTest('denied (saved in the browser): one line of steps for the phone in hand, one button, red icon, no request', async () => {
    for (const [userAgent, hint] of [[IPHONE, en.camera_permission_reset_hint_ios], [ANDROID, en.camera_permission_reset_hint_android], [DESKTOP, en.camera_permission_reset_hint]] as const) {
      await withSheet('denied', { userAgent, t: enT }, (sheet) => {
        assert.equal(sheet.probe.getUserMediaCalls, 0, 'a saved denial is never asked again in a loop')
        assertPanel(sheet, { line: hint, action: en.try_camera_again, red: true }, `denied on ${userAgent.slice(13, 25)}`)
      })
    }
  })

  await runTest('denied, in Khmer: the same one line and one action in Khmer', async () => {
    await withSheet('denied', { userAgent: ANDROID, t: kmT }, (sheet) => {
      assertPanel(sheet, { line: km.camera_permission_reset_hint_android, action: km.try_camera_again, red: true }, 'denied (Khmer)')
    })
  })

  await runTest('tapping Block on the browser prompt is told as a block at once, not as a dismissed prompt', async () => {
    await withSheet('prompt', { userAgent: IPHONE, rejectCamera: 'NotAllowedError', blockOnReject: true, t: enT }, (sheet) => {
      assert.equal(sheet.probe.getUserMediaCalls, 1, 'one request, no retry loop')
      assertPanel(sheet, { line: en.camera_permission_reset_hint_ios, action: en.try_camera_again, red: true }, 'Block tapped')
    })
  })

  await runTest('an in-app view that forbids the camera (Telegram, Facebook): the line says open it in your browser, the photo is the action', async () => {
    await withSheet('granted', { documentBlocked: true, t: enT }, (sheet) => {
      assert.equal(sheet.probe.getUserMediaCalls, 0)
      assertPanel(sheet, { line: en.camera_document_blocked, action: en.scan_from_photo, red: true }, 'view blocks the camera')
    })
  })

  await runTest('an in-app view that just answers "not allowed" (no policy to read) is treated the same, and is not offered a retry that cannot work', async () => {
    for (const userAgent of [FACEBOOK_IPHONE, TELEGRAM_ANDROID]) {
      await withSheet('prompt', { userAgent, rejectCamera: 'NotAllowedError', t: enT }, (sheet) => {
        assertPanel(sheet, { line: en.camera_document_blocked, action: en.scan_from_photo, red: true }, `in-app view ${userAgent.slice(13, 30)}`)
      })
    }
  })

  // ---- failures that are not a block: neutral -------------------------------------------

  await runTest('prompt dismissed: one neutral line and Try camera again', async () => {
    await withSheet('prompt', { userAgent: ANDROID, rejectCamera: 'NotAllowedError', t: enT }, (sheet) => {
      assertPanel(sheet, { line: en.scan_prompt_dismissed, action: en.try_camera_again, red: false }, 'dismissed')
    })
  })

  await runTest('Try camera again is a new request from a tap (a browser that wants a gesture gets one)', async () => {
    await withSheet('prompt', { failWith: (_constraints, call) => (call === 1 ? 'NotAllowedError' : undefined), t: enT }, async (sheet) => {
      assert.equal(sheet.probe.getUserMediaCalls, 1, 'the open was refused')
      stage.liveVideoFrames = true
      const button = findAll(sheet.container, (node) => node.tagName === 'BUTTON' && node.textContent.trim() === en.try_camera_again)[0]
      await act(async () => { propsOf(button).onClick() })
      await settle(80)
      assert.equal(sheet.probe.getUserMediaCalls, 2, 'the tap asked again')
      assertQuietLiveSheet(sheet, 'after the retry')
    })
  })

  await runTest('no camera on the device: one neutral line, and the photo (a retry cannot help)', async () => {
    for (const name of ['NotFoundError', 'DevicesNotFoundError']) {
      await withSheet('prompt', { rejectCamera: name, t: enT }, (sheet) => {
        assertPanel(sheet, { line: en.scan_unsupported, action: en.scan_from_photo, red: false }, name)
      })
    }
  })

  await runTest('no camera API at all (an old or locked-down browser): the same line and the photo', async () => {
    await withSheet('granted', { unsupported: true, t: enT }, (sheet) => {
      assertPanel(sheet, { line: en.scan_unsupported, action: en.scan_from_photo, red: false }, 'unsupported')
    })
  })

  await runTest('camera busy in another app (NotReadableError / TrackStartError): says so, neutral, Try camera again', async () => {
    for (const name of ['NotReadableError', 'TrackStartError']) {
      await withSheet('granted', { rejectCamera: name, t: enT }, (sheet) => {
        assertPanel(sheet, { line: en.scan_camera_busy, action: en.try_camera_again, red: false }, name)
      })
    }
    await withSheet('granted', { rejectCamera: 'NotReadableError', t: kmT }, (sheet) => {
      assertPanel(sheet, { line: km.scan_camera_busy, action: km.try_camera_again, red: false }, 'busy (Khmer)')
    })
  })

  await runTest('any other failed start is the generic neutral line, never a permission wording', async () => {
    await withSheet('prompt', { rejectCamera: 'SomethingElse', t: enT }, (sheet) => {
      assertPanel(sheet, { line: en.scan_failed, action: en.try_camera_again, red: false }, 'generic failure')
    })
  })

  await runTest('a remembered camera that is gone (OverconstrainedError): the default camera opens, nothing is said, the dead choice is forgotten', async () => {
    stage.liveVideoFrames = true
    const storage = memoryStorage({ 'business-os-scanner-camera-v1': 'cam-unplugged' })
    windowOf().localStorage = storage
    try {
      await withSheet('granted', {
        failWith: (constraints) => ((constraints as { video?: { deviceId?: unknown } }).video?.deviceId ? 'OverconstrainedError' : undefined),
      }, (sheet) => {
        assert.equal(sheet.probe.getUserMediaCalls, 2, 'the remembered camera was tried once, then the default')
        const second = (sheet.probe.requested[1] as { video: Record<string, unknown> }).video
        assert.equal(second.deviceId, undefined, 'the second request names no camera')
        assert.notEqual(second.facingMode, undefined, 'it asks for the back camera, as a first use does')
        assertQuietLiveSheet(sheet, 'fell back to the default camera')
        assert.equal(storage.data.get('business-os-scanner-camera-v1'), undefined, 'the dead choice is forgotten, so the next scan is a single request')
      })
    } finally {
      delete windowOf().localStorage
    }
  })

  // ---- the paused camera: neutral, and only after it ran ---------------------------------

  await runTest('the idle pause is the neutral "Camera paused" line with Start camera (the permissions API saying "prompt" changes nothing)', async () => {
    const realSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = ((callback: () => void, delay?: number, ...args: unknown[]) => (
      realSetTimeout(callback, delay === 15_000 || delay === 60_000 ? delay / 100 : delay, ...args)
    )) as typeof setTimeout
    try {
      stage.liveVideoFrames = true
      await withSheet('granted', { t: enT }, async (sheet) => {
        sheet.probe.permission.state = 'prompt'
        await act(async () => { for (const listener of sheet.probe.permission.listeners) listener() })
        await waitFor(() => sheet.text() !== '', 80, 20)
        assertPanel(sheet, { line: en.camera_paused_resume, action: en.start_camera, red: false }, 'idle pause')
      })
    } finally {
      globalThis.setTimeout = realSetTimeout
    }
  })

  // ---- leaving and coming back --------------------------------------------------------------

  async function hide(): Promise<void> {
    setVisibility('hidden')
    await act(async () => { fire('document', 'visibilitychange') })
  }
  async function show(): Promise<void> {
    setVisibility('visible')
    await act(async () => { fire('document', 'visibilitychange') })
    await settle(80)
  }

  await runTest('app backgrounded mid-scan and reopened: the camera is off while away and starts again by itself, with no tap, in every permission state', async () => {
    for (const [permission, options] of [['granted', {}], ['prompt', {}], ['prompt', { noPermissionsApi: true }]] as const) {
      stage.liveVideoFrames = true
      await withSheet(permission, options, async (sheet) => {
        await hide()
        assert.deepEqual(sheet.probe.tracks.map((track) => [track.stopCount, track.readyState]), [[1, 'ended']], `${permission}: every track is stopped the moment the page is hidden`)
        await show()
        assert.equal(sheet.probe.getUserMediaCalls, 2, `${permission}: the camera is requested again with no tap`)
        assertQuietLiveSheet(sheet, `${permission}: back on the page`)
        assert.deepEqual(sheet.probe.tracks.map((track) => track.readyState), ['ended', 'live'])
      })
      stage.liveVideoFrames = false
    }
  })

  await runTest('coming back after the permission was switched off in Settings: the red block line, and no request', async () => {
    stage.liveVideoFrames = true
    await withSheet('granted', { userAgent: IPHONE, t: enT }, async (sheet) => {
      await hide()
      sheet.probe.permission.state = 'denied'
      await show()
      assert.equal(sheet.probe.getUserMediaCalls, 1, 'a saved denial is never asked again')
      assertPanel(sheet, { line: en.camera_permission_reset_hint_ios, action: en.try_camera_again, red: true }, 'revoked while away')
    })
  })

  await runTest('leaving and coming back leaves a failure exactly as it was: a dismissed prompt is not asked again by itself', async () => {
    await withSheet('prompt', { rejectCamera: 'NotAllowedError', t: enT }, async (sheet) => {
      await hide()
      await show()
      assert.equal(sheet.probe.getUserMediaCalls, 1, 'no request without a tap')
      assertPanel(sheet, { line: en.scan_prompt_dismissed, action: en.try_camera_again, red: false }, 'dismissed, then away and back')
    })
  })

  await runTest('rotating the phone neither restarts nor stops the camera', async () => {
    stage.liveVideoFrames = true
    await withSheet('granted', {}, async (sheet) => {
      for (const event of ['resize', 'orientationchange']) await act(async () => { fire('window', event) })
      await settle(60)
      assert.equal(sheet.probe.getUserMediaCalls, 1)
      assert.deepEqual(sheet.probe.tracks.map((track) => track.readyState), ['live'])
      assertQuietLiveSheet(sheet, 'after rotation')
    })
  })

  // ---- the camera is off the moment the sheet is not on screen -------------------------------

  type Camera = ReturnType<typeof useBarcodeCamera>
  async function openProbe(permission: 'granted' | 'prompt', options: CameraOptions = {}) {
    stage.liveVideoFrames = true
    const probe = installCamera(permission, options)
    const state = { camera: null as Camera | null, detected: [] as string[], closed: 0 }
    const mounted = await mountComponent(PROBE, {
      open: true,
      onDetected: (value: string) => state.detected.push(value),
      onClose: () => { state.closed += 1 },
      onCamera: (camera: Camera) => { state.camera = camera },
    })
    await waitFor(() => /^scanning\|/.test(mounted.container.textContent))
    return { probe, mounted, camera: () => state.camera as Camera, state }
  }
  const trackStates = (probe: CameraProbe) => probe.tracks.map((track) => [track.stopCount, track.readyState])

  await runTest('closing the sheet stops every track in the same breath as the close, not later', async () => {
    const running = await openProbe('granted')
    assert.deepEqual(trackStates(running.probe), [[0, 'live']], 'running before the close')
    let atClose: unknown[] = []
    act(() => {
      running.camera().closeScanner()
      atClose = trackStates(running.probe)
    })
    assert.deepEqual(atClose, [[1, 'ended']], 'stopped synchronously by closeScanner, before control returns to the caller')
    assert.equal(running.state.closed, 1)
    await running.mounted.unmount()
    assert.deepEqual(trackStates(running.probe), [[1, 'ended']], 'and unmounting does not stop it a second time')
  })

  await runTest('a read stops every track at the moment of the read, not when the sheet closes 150 ms later', async () => {
    const running = await openProbe('granted')
    let atRead: unknown[] = []
    act(() => {
      running.camera().completeDetection('3348901729222')
      atRead = trackStates(running.probe)
    })
    assert.deepEqual(atRead, [[1, 'ended']])
    assert.equal(running.state.closed, 0, 'the sheet is still up for its flash')
    assert.deepEqual(running.state.detected, ['3348901729222'])
    await running.mounted.unmount()
  })

  await runTest('hiding the page stops every track synchronously inside the visibilitychange handler', async () => {
    const running = await openProbe('granted')
    let atHide: unknown[] = []
    setVisibility('hidden')
    act(() => {
      fire('document', 'visibilitychange')
      atHide = trackStates(running.probe)
    })
    assert.deepEqual(atHide, [[1, 'ended']])
    setVisibility('visible')
    await running.mounted.unmount()
  })

  await runTest('the page leaving (pagehide) and the sheet unmounting stop every track synchronously too', async () => {
    const left = await openProbe('granted')
    let atPageHide: unknown[] = []
    act(() => {
      fire('window', 'pagehide')
      atPageHide = trackStates(left.probe)
    })
    assert.deepEqual(atPageHide, [[1, 'ended']])
    await left.mounted.unmount()

    const gone = await openProbe('granted')
    let atUnmount: unknown[] = []
    await act(async () => {
      await gone.mounted.unmount()
      atUnmount = trackStates(gone.probe)
    })
    assert.deepEqual(atUnmount, [[1, 'ended']])
  })

  await runTest('a close while the browser prompt is still open never leaves the camera on when the answer arrives late', async () => {
    stage.liveVideoFrames = true
    const probe = installCamera('prompt', {})
    const media = navigatorOf().mediaDevices as { getUserMedia: (constraints: unknown) => Promise<unknown> }
    const open = media.getUserMedia
    let answer: () => void = () => {}
    media.getUserMedia = (constraints: unknown) => new Promise((resolve) => { answer = () => resolve(open(constraints)) })
    const mounted = await mountComponent(MODAL, { open: true, title: 'Scan barcode', onClose() {}, onDetected() {}, t: (key: string) => key })
    await mounted.unmount()
    await act(async () => { answer(); await new Promise((resolve) => setTimeout(resolve, 40)) })
    assert.deepEqual(trackStates(probe), [[1, 'ended']], 'the camera that arrives after the sheet is gone is stopped on arrival')
  })

  // ---- offline and the strings ------------------------------------------------------------------

  await runTest('offline: scanning has no network call of its own (the decoder is bundled; the camera is local)', () => {
    const dir = path.join(frontend, 'src/components/products/scanning')
    const files = fs.readdirSync(dir).filter((name) => /\.tsx?$/.test(name))
    assert.ok(files.length > 10)
    for (const file of files) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
      assert.doesNotMatch(source, /\bfetch\(|XMLHttpRequest|navigator\.onLine|sendBeacon/, `${file} must not need the network`)
    }
  })

  await runTest('the sheet has exactly one red thing in its source: the blocked icon', () => {
    const dir = path.join(frontend, 'src/components/products/scanning')
    const reds: string[] = []
    for (const file of fs.readdirSync(dir).filter((name) => /\.tsx$/.test(name))) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8')
      for (const match of source.matchAll(/(?:text|bg|border)-(?:red|rose)-\d+/g)) reds.push(`${file}: ${match[0]}`)
    }
    assert.deepEqual(reds, ['BarcodeScannerModal.tsx: text-red-400'])
  })

  await runTest('every line the sheet can show is short, in both languages', () => {
    const keys = ['scan_unsupported', 'camera_document_blocked', 'scan_prompt_dismissed', 'scan_camera_busy', 'scan_failed', 'camera_paused_resume',
      'camera_permission_reset_hint_ios', 'camera_permission_reset_hint_android', 'camera_permission_reset_hint']
    for (const key of keys) {
      assert.ok(en[key] && km[key], `${key} is in both packs`)
      assert.ok(en[key].length <= 80, `${key} (en) is one short line: ${en[key].length} characters`)
      assert.match(km[key], /[ក-៿]/, `${key} (km) is Khmer`)
      assert.notEqual(km[key], en[key])
      assert.doesNotMatch(km[key], /បារកូដ/, 'barcode is spelled បាកូដ')
    }
    for (const key of ['camera_permission_needed', 'request_camera_access', 'camera_permission_blocked']) {
      assert.equal(en[key], undefined, `${key} (en) is retired: the sheet no longer asks before a start has failed`)
      assert.equal(km[key], undefined, `${key} (km) is retired`)
    }
  })
} finally {
  await stopStage()
}

if (failed > 0) process.exitCode = 1
