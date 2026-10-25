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
//   * Never a request after the sheet is gone: not the fallback to the default camera, and not a restart from a page return
//     while the first request is still waiting for an answer (6.0.961, release review c2f27dce6, P3-1 and P3-2).
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
  /** iOS Home Screen app (navigator.standalone). */
  standalone?: boolean
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
  if (options.standalone) navigatorOf().standalone = true
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
function assertPanel(sheet: Sheet, expected: { line: string; action: string; red: boolean; tip?: string }, label: string): void {
  // `tip` is the iOS-only neutral line under a permission failure (6.0.978).
  assert.equal(sheet.text(), `${expected.line}${expected.tip ?? ''}${expected.action}`, `${label}: exactly one line and one action, nothing else`)
  assert.deepEqual(textButtons(sheet.container), [expected.action], `${label}: one action`)
  assert.equal(redThings(sheet.container).length, expected.red ? 1 : 0, `${label}: ${expected.red ? 'the icon is red' : 'nothing is red'}`)
  if (expected.red) assert.match(classOf(panelIcon(sheet.container)), /text-red-400/, `${label}: and the red is the panel icon`)
  assert.deepEqual(warmThings(sheet.container).map(classOf), [], `${label}: no warning colour`)
}

/** 6.0.978: the camera is requested inside the tap, before the saved-denial read comes back, so a saved denial is
 * answered by the browser at once (no prompt) and whatever it hands back is stopped: nothing is left running. */
function assertDeniedLeavesNoCamera(sheet: Sheet, label: string, priorRequests = 0): void {
  assert.ok(sheet.probe.getUserMediaCalls <= priorRequests + 1, `${label}: at most the one request made inside the tap, no retry loop`)
  assert.ok(sheet.probe.tracks.every((track) => track.readyState === 'ended'), `${label}: no camera left on`)
}

/** getUserMedia whose answers the test gives, one request at a time, so a close, a hide or a newer start can land while a request is still pending. */
function holdRequests() {
  const media = navigatorOf().mediaDevices as { getUserMedia: (constraints: unknown) => Promise<unknown> }
  const answerNow = media.getUserMedia
  const requests: Array<{ constraints: unknown; grant: () => void; fail: (name: string) => void }> = []
  media.getUserMedia = (constraints: unknown) => new Promise((resolve, reject) => {
    requests.push({
      constraints,
      grant: () => resolve(answerNow(constraints)),
      fail: (name) => { const error = new Error(name); error.name = name; reject(error) },
    })
  })
  return requests
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
        assertDeniedLeavesNoCamera(sheet, 'a saved denial is never asked again in a loop')
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

  // 6.0.978: after a start that FAILED on the permission, on iOS only, one short neutral line says how to stop the asking.
  await runTest('iPhone, prompt dismissed: the failure panel adds the Safari tip, neutral; the Home Screen app gets its own line instead', async () => {
    await withSheet('prompt', { userAgent: IPHONE, rejectCamera: 'NotAllowedError', t: enT }, (sheet) => {
      assertPanel(sheet, { line: en.scan_prompt_dismissed, action: en.try_camera_again, red: false, tip: en.camera_ios_allow_tip }, 'Safari tab')
      assert.equal(en.camera_ios_allow_tip, 'Stop camera prompts: page menu (aA or ⋯) › Website Settings › Camera › Allow')
    })
    await withSheet('prompt', { userAgent: IPHONE, rejectCamera: 'NotAllowedError', t: enT, standalone: true }, (sheet) => {
      assertPanel(sheet, { line: en.scan_prompt_dismissed, action: en.try_camera_again, red: false, tip: en.camera_ios_homescreen_tip }, 'Home Screen app')
      assert.equal(en.camera_ios_homescreen_tip, 'The Home Screen app asks once each time it opens.')
    })
  })

  await runTest('a BLOCKED camera on iPhone shows its one red Settings line and no tip, in a Safari tab or the Home Screen app', async () => {
    for (const standalone of [false, true]) {
      await withSheet('denied', { userAgent: IPHONE, standalone, t: enT }, (sheet) => {
        assertPanel(sheet, { line: en.camera_permission_reset_hint_ios, action: en.try_camera_again, red: true }, `blocked, standalone=${standalone}`)
      })
    }
  })

  await runTest('Chrome / Firefox / Edge on iPhone have no Safari page menu: no tip', async () => {
    for (const browser of ['CriOS/130.0 Mobile/15E148 Safari/604.1', 'FxiOS/130.0 Mobile/15E148 Safari/605.1.15', 'EdgiOS/130.0 Mobile/15E148 Safari/605.1.15']) {
      await withSheet('prompt', { userAgent: `${IPHONE} ${browser}`, rejectCamera: 'NotAllowedError', t: enT }, (sheet) => {
        assertPanel(sheet, { line: en.scan_prompt_dismissed, action: en.try_camera_again, red: false }, browser.slice(0, 6))
      })
    }
  })

  await runTest('the tip is in Khmer too, and is not red', async () => {
    await withSheet('prompt', { userAgent: IPHONE, rejectCamera: 'NotAllowedError', t: kmT }, (sheet) => {
      assertPanel(sheet, { line: km.scan_prompt_dismissed, action: km.try_camera_again, red: false, tip: km.camera_ios_allow_tip }, 'Safari tab (Khmer)')
    })
    assert.notEqual(km.camera_ios_allow_tip, en.camera_ios_allow_tip)
    assert.notEqual(km.camera_ios_homescreen_tip, en.camera_ios_homescreen_tip)
    assert.match(km.camera_ios_homescreen_tip, /[ក-៿]/)
  })

  await runTest('no tip on Android or desktop, on a busy camera or a failed start, on success, or in an in-app view', async () => {
    for (const userAgent of [ANDROID, DESKTOP]) {
      await withSheet('prompt', { userAgent, rejectCamera: 'NotAllowedError', t: enT }, (sheet) => {
        assertPanel(sheet, { line: en.scan_prompt_dismissed, action: en.try_camera_again, red: false }, `dismissed on ${userAgent.slice(13, 25)}`)
      })
    }
    await withSheet('prompt', { userAgent: IPHONE, rejectCamera: 'NotReadableError', t: enT }, (sheet) => {
      assertPanel(sheet, { line: en.scan_camera_busy, action: en.try_camera_again, red: false }, 'busy camera on iPhone')
    })
    await withSheet('prompt', { userAgent: FACEBOOK_IPHONE, rejectCamera: 'NotAllowedError', t: enT }, (sheet) => {
      assert.ok(!sheet.text().includes(en.camera_ios_allow_tip) && !sheet.text().includes(en.camera_ios_homescreen_tip), 'an in-app view: the setting is not the fix')
    })
    stage.liveVideoFrames = true
    await withSheet('granted', { userAgent: IPHONE }, (sheet) => {
      assertQuietLiveSheet(sheet, 'success on iPhone adds no text')
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

  // The fallback to the default camera is a second getUserMedia call, so it is held to the same rule as the first: nothing is requested for a start
  // that is over. Red before 6.0.961: the sheet closed while the remembered camera's request was pending, the request failed, and the camera came on anyway.
  await runTest('a remembered camera that fails AFTER the sheet closed: the default camera is not requested late, and the saved choice is left alone', async () => {
    stage.liveVideoFrames = true
    const storage = memoryStorage({ 'business-os-scanner-camera-v1': 'cam-unplugged' })
    windowOf().localStorage = storage
    try {
      const probe = installCamera('granted', {})
      const requests = holdRequests()
      const mounted = await mountComponent(MODAL, { open: true, title: 'Scan barcode', onClose() {}, onDetected() {}, t: (key: string) => key })
      assert.equal(requests.length, 1, 'the open made its one request, and it is still pending')
      await mounted.unmount()
      await act(async () => { requests[0].fail('OverconstrainedError'); await settle(40) })
      assert.equal(requests.length, 1, 'no request after the sheet closed')
      assert.equal(probe.tracks.length, 0, 'and no camera ever came on')
      assert.equal(storage.data.get('business-os-scanner-camera-v1'), 'cam-unplugged', 'a start that is over does not rewrite the saved choice either')
    } finally {
      delete windowOf().localStorage
    }
  })

  await runTest('a remembered camera that fails after a NEWER start began: only the newer start asks, once', async () => {
    stage.liveVideoFrames = true
    const storage = memoryStorage({ 'business-os-scanner-camera-v1': 'cam-unplugged' })
    windowOf().localStorage = storage
    const probe = installCamera('granted', {})
    const requests = holdRequests()
    const state = { camera: null as ReturnType<typeof useBarcodeCamera> | null }
    const mounted = await mountComponent(PROBE, { open: true, onDetected() {}, onClose() {}, onCamera: (camera: ReturnType<typeof useBarcodeCamera>) => { state.camera = camera } })
    try {
      assert.equal(requests.length, 1)
      await act(async () => { void state.camera!.startCamera(); await settle(30) })
      assert.equal(requests.length, 2, 'the newer start made its own request')
      await act(async () => { requests[0].fail('OverconstrainedError'); await settle(40) })
      assert.equal(requests.length, 2, 'the replaced start did not fall back to a third request')
      assert.equal(storage.data.get('business-os-scanner-camera-v1'), 'cam-unplugged', 'and did not clear a choice the newer start may be using')
      await act(async () => { requests[1].grant(); await settle(60) })
      await waitFor(() => /^scanning\|/.test(mounted.container.textContent))
      assert.deepEqual(probe.tracks.map((track) => track.readyState), ['live'], 'the newer start is the one camera that is on')
    } finally {
      await mounted.unmount()
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
      assertDeniedLeavesNoCamera(sheet, 'a saved denial is never asked again', 1)
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

  // Only a camera that was ACTUALLY running comes back by itself. Red before 6.0.961: the page hidden while the first request was still pending
  // counted as "running", so every return asked again (one request became four over three cycles), stacking a prompt on the one still waiting.
  const pausedPanel = `${en.camera_paused_resume}${en.start_camera}`
  await runTest('the page hidden and shown while the first request is still pending: one request in all, and the stream that arrives late is stopped', async () => {
    stage.liveVideoFrames = true
    const probe = installCamera('prompt', {})
    const requests = holdRequests()
    const mounted = await mountComponent(MODAL, { open: true, title: 'Scan barcode', onClose() {}, onDetected() {}, t: enT })
    try {
      assert.equal(requests.length, 1, 'the open made its one request; the browser is still asking')
      for (let cycle = 0; cycle < 3; cycle += 1) {
        await hide()
        await show()
        assert.equal(requests.length, 1, `cycle ${cycle + 1}: coming back asks nothing more`)
      }
      await act(async () => { requests[0].grant(); await settle(100) })
      assert.deepEqual(trackStates(probe), [[1, 'ended']], 'the stream that arrives after the page was hidden is stopped on arrival')
      assert.equal(requests.length, 1, 'and its arrival starts nothing')
      assert.equal(mounted.container.textContent.trim(), pausedPanel, 'the sheet shows the neutral paused panel, one tap from a camera that is allowed by now')
      assert.deepEqual(redThings(mounted.container), [])
      // That tap is a new request, answered at once, and then the camera is simply running.
      const button = findAll(mounted.container, (node) => node.tagName === 'BUTTON' && node.textContent.trim() === en.start_camera)[0]
      await act(async () => { propsOf(button).onClick() })
      await settle(30)
      assert.equal(requests.length, 2, 'the tap asked')
      await act(async () => { requests[1].grant(); await settle(60) })
      assert.deepEqual(trackStates(probe), [[1, 'ended'], [0, 'live']])
      assert.equal(mounted.container.textContent.trim(), '', 'running, quiet')
    } finally {
      await mounted.unmount()
    }
  })

  await runTest('a request answered while the page is hidden brings a stream that is stopped at once, and coming back does not ask again', async () => {
    stage.liveVideoFrames = true
    const probe = installCamera('granted', {})
    const requests = holdRequests()
    const mounted = await mountComponent(MODAL, { open: true, title: 'Scan barcode', onClose() {}, onDetected() {}, t: enT })
    try {
      await hide()
      await act(async () => { requests[0].grant(); await settle(100) })
      assert.deepEqual(trackStates(probe), [[1, 'ended']], 'the camera that arrives while the page is hidden is not left on')
      await show()
      assert.equal(requests.length, 1, 'returning does not ask again for a request that never produced a camera')
      assert.equal(mounted.container.textContent.trim(), pausedPanel)
      assert.deepEqual(trackStates(probe), [[1, 'ended']], 'stopped exactly once')
    } finally {
      await mounted.unmount()
    }
  })

  await runTest('a camera that was running still comes back by itself, however often the page goes away (the pending-request rule does not touch it)', async () => {
    const running = await openProbe('granted')
    try {
      for (let cycle = 0; cycle < 2; cycle += 1) {
        await hide()
        await show()
        await waitFor(() => /^scanning\|/.test(running.mounted.container.textContent))
      }
      assert.equal(running.probe.getUserMediaCalls, 3, 'one request to open, one per return')
      assert.deepEqual(trackStates(running.probe), [[1, 'ended'], [1, 'ended'], [0, 'live']])
    } finally {
      await running.mounted.unmount()
    }
  })

  // 6.0.966 (review db2440bb9 P3-C): a camera that WAS running comes back by itself in every event order, with the 6.0.961 guarantees kept:
  // never a second request while one is unanswered, no stream left on after a close, no loop on a refusal.
  const live = (probe: ReturnType<typeof installCamera>) => probe.tracks.filter((track) => track.readyState === 'live').length

  await runTest('running, hidden, shown (the resume request is still pending), hidden, shown: still one open request, and the camera comes back when it is answered', async () => {
    stage.liveVideoFrames = true
    const probe = installCamera('granted', {})
    const mounted = await mountComponent(MODAL, { open: true, title: 'Scan barcode', onClose() {}, onDetected() {}, t: enT })
    try {
      await settle(60)
      const requests = holdRequests()
      await hide()
      await show()
      assert.equal(requests.length, 1, 'the first return asked once')
      await hide()
      await show()
      assert.equal(requests.length, 1, 'the second return does not stack a second request on the unanswered one')
      await act(async () => { requests[0].grant(); await settle(10) })
      await waitFor(() => requests.length === 2, 80, 25)
      assert.equal(requests.length, 2, 'the answer arrived for a start that was over: its stream is stopped and ONE new request is made')
      await act(async () => { requests[1].grant(); await settle(10) })
      await waitFor(() => live(probe) === 1, 80, 25)
      await settle(30)
      assert.equal(live(probe), 1, 'a camera that was running is running again, with no tap')
      assert.equal(mounted.container.textContent.trim(), '', 'quiet, not the paused panel')
      assert.deepEqual(trackStates(probe).map((state) => (state as unknown[])[1]), ['ended', 'ended', 'live'])
    } finally {
      await mounted.unmount()
    }
    assert.equal(live(probe), 0, 'closing leaves nothing on')
  })

  await runTest('the same, closed while the resume waits for the unanswered request: nothing is asked or left on', async () => {
    stage.liveVideoFrames = true
    const probe = installCamera('granted', {})
    const mounted = await mountComponent(MODAL, { open: true, title: 'Scan barcode', onClose() {}, onDetected() {}, t: enT })
    await settle(60)
    const requests = holdRequests()
    await hide()
    await show()
    await hide()
    await show()
    await mounted.unmount()
    await act(async () => { requests[0].grant(); await settle(100) })
    assert.equal(requests.length, 1, 'no request after the sheet closed')
    assert.equal(live(probe), 0, 'and no stream left on')
  })

  await runTest('the same, but the unanswered request is refused: no further request (no loop on denial)', async () => {
    stage.liveVideoFrames = true
    const probe = installCamera('granted', {})
    const mounted = await mountComponent(MODAL, { open: true, title: 'Scan barcode', onClose() {}, onDetected() {}, t: enT })
    try {
      await settle(60)
      const requests = holdRequests()
      await hide()
      await show()
      await hide()
      await show()
      await act(async () => { requests[0].fail('NotAllowedError'); await settle(40) })
      assert.equal(requests.length, 1, 'a refusal is not asked again')
      await hide()
      await show()
      assert.equal(requests.length, 1, 'and coming back later does not either')
      assert.equal(live(probe), 0)
    } finally {
      await mounted.unmount()
    }
  })

  await runTest('running, pagehide, hidden, shown: the camera comes back by itself', async () => {
    const running = await openProbe('granted')
    try {
      await act(async () => { fire('window', 'pagehide') })
      await settle(20)
      assert.equal(live(running.probe), 0, 'pagehide lets the camera go at once')
      await hide()
      await show()
      await waitFor(() => /^scanning\|/.test(running.mounted.container.textContent))
      assert.equal(running.probe.getUserMediaCalls, 2)
      assert.equal(live(running.probe), 1)
    } finally {
      await running.mounted.unmount()
    }
  })

  await runTest('running, pagehide, then the page is restored (pageshow) with no visibility change: the camera comes back; a page that was not running does not', async () => {
    const running = await openProbe('granted')
    try {
      await act(async () => { fire('window', 'pagehide') })
      await act(async () => { fire('window', 'pageshow') })
      await waitFor(() => /^scanning\|/.test(running.mounted.container.textContent))
      assert.equal(running.probe.getUserMediaCalls, 2)
      await act(async () => { fire('window', 'pageshow') })
      await settle(30)
      assert.equal(running.probe.getUserMediaCalls, 2, 'a pageshow with nothing to resume asks nothing')
    } finally {
      await running.mounted.unmount()
    }
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
