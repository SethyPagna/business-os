// The camera sheet (lane 6.0.937): what the person sees and feels, mounted for real.
//
//   * compact sheet: close over the video, torch / switch camera / scan-from-photo on its right
//   * no text while the camera is live; a screen reader hears "Barcode read"
//   * one accepted read per open: vibrate once, flash, close ~150 ms later (never by hand-delayed X)
//   * no manual-entry panel: the search box behind the sheet is the manual fallback
//   * blocked / unsupported / dismissed are ONE panel: icon, a sentence, one button, a reset hint per platform
//   * the front camera is mirrored; the camera choice is remembered per device
//   * the photo path shows translated errors, not the scanner's English
//
// Run: node tests/scannerSheet.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  act,
  installCamera,
  mountComponent,
  queueZxingReads,
  settle,
  stage,
  startStage,
  stopStage,
  waitFor,
  type CameraOptions,
  type CameraProbe,
  type MemoryNode,
} from './scannerCameraHarness.ts'
import { SCAN_CLOSE_DELAY_MS } from '../src/components/products/scanning/scanFeedback.ts'

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MODAL = '/src/components/products/scanning/BarcodeScannerModal.tsx'

type Tree = Record<string, unknown>
function flatten(input: Tree, target: Record<string, string> = {}): Record<string, string> {
  for (const [key, value] of Object.entries(input)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value as Tree, target)
    else if (value != null) target[key] = String(value)
  }
  return target
}
const readPack = (name: string) => JSON.parse(fs.readFileSync(path.join(frontend, 'src', 'lang', `${name}.json`), 'utf8')) as Tree
const en = flatten(readPack('en'))
const km = flatten(readPack('km'))
const kmT = (key: string): string => km[key] ?? key

// ---- tree helpers over the harness's in-memory DOM -------------------------

function findAll(node: MemoryNode, test: (node: MemoryNode) => boolean, found: MemoryNode[] = []): MemoryNode[] {
  if (test(node)) found.push(node)
  for (const child of node.childNodes) findAll(child, test, found)
  return found
}
const byLabel = (root: MemoryNode, label: string) => findAll(root, (node) => node.getAttribute?.('aria-label') === label)
const buttons = (root: MemoryNode) => findAll(root, (node) => node.tagName === 'BUTTON')
const textButtons = (root: MemoryNode) => buttons(root).filter((button) => button.textContent.trim() !== '')
const shellOf = (root: MemoryNode) => findAll(root, (node) => (node.getAttribute?.('class') ?? '').includes('scanner-video-shell'))[0]
const videoOf = (root: MemoryNode) => findAll(root, (node) => node.tagName === 'VIDEO')[0]

function propsOf(node: MemoryNode): Record<string, (...args: unknown[]) => unknown> {
  const key = Object.keys(node).find((name) => name.startsWith('__reactProps$')) as keyof MemoryNode
  return node[key] as unknown as Record<string, (...args: unknown[]) => unknown>
}
async function press(node: MemoryNode): Promise<void> {
  await act(async () => {
    propsOf(node).onClick()
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
}

// ---- the stage around one mounted sheet ------------------------------------

interface Sheet {
  probe: CameraProbe
  container: MemoryNode
  detected: string[]
  closed: () => number
  vibrations: number[]
  unmount: () => Promise<void>
}

const navigatorOf = () => navigator as unknown as Record<string, unknown> & { mediaDevices: Record<string, unknown> }

interface SheetOptions extends CameraOptions {
  userAgent?: string
  t?: (key: string) => string
  cameras?: Array<{ deviceId: string; facingMode: string }>
  /** A browser with no camera API at all. */
  unsupported?: boolean
  /** An in-app view whose document policy forbids the camera. */
  documentBlocked?: boolean
}

async function mountSheet(permission: 'granted' | 'prompt' | 'denied', options: SheetOptions = {}): Promise<Sheet> {
  const probe = installCamera(permission, options)
  const vibrations: number[] = []
  navigatorOf().vibrate = (ms: number) => { vibrations.push(ms); return true }
  if (options.userAgent) navigatorOf().userAgent = options.userAgent
  if (options.cameras) withCameras(options.cameras)
  if (options.unsupported) delete navigatorOf().mediaDevices.getUserMedia
  if (options.documentBlocked) (document as unknown as { permissionsPolicy?: unknown }).permissionsPolicy = { allowsFeature: () => false }
  const detected: string[] = []
  const state = { closed: 0 }
  const mounted = await mountComponent(MODAL, {
    open: true,
    title: 'Scan barcode',
    onClose() { state.closed += 1 },
    onDetected: (value: string) => detected.push(value),
    t: options.t ?? ((key: string) => key),
  })
  return {
    probe,
    container: mounted.container,
    detected,
    closed: () => state.closed,
    vibrations,
    unmount: async () => {
      delete (document as unknown as { permissionsPolicy?: unknown }).permissionsPolicy
      await mounted.unmount()
    },
  }
}

/** A device with several cameras: lists them, and reports which one the stream really is. */
function withCameras(cameras: Array<{ deviceId: string; facingMode: string }>): void {
  const media = navigatorOf().mediaDevices as { getUserMedia: (constraints: unknown) => Promise<{ getVideoTracks: () => Array<Record<string, unknown>> }>; enumerateDevices?: unknown }
  const open = media.getUserMedia
  media.enumerateDevices = async () => [
    ...cameras.map((camera) => ({ kind: 'videoinput', deviceId: camera.deviceId })),
    { kind: 'audioinput', deviceId: 'microphone' },
  ]
  media.getUserMedia = async (constraints: unknown) => {
    const stream = await open(constraints)
    const wanted = (constraints as { video?: { deviceId?: { ideal?: string } } }).video?.deviceId?.ideal
    const chosen = cameras.find((camera) => camera.deviceId === wanted) ?? cameras[0]
    stream.getVideoTracks()[0].getSettings = () => ({ deviceId: chosen.deviceId, facingMode: chosen.facingMode })
    return stream
  }
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
  }
}
const windowOf = () => window as unknown as { localStorage?: unknown }

class ReadingDetector {
  static async getSupportedFormats(): Promise<string[]> { return ['ean_13'] }
  async detect(): Promise<unknown[]> {
    // The fake video is 64x48 with no layout: the guide is the middle 86% x 70% of it.
    return [{ rawValue: '3348901729222', format: 'ean_13', boundingBox: { x: 20, y: 15, width: 20, height: 10 } }]
  }
}

// The reset hints are shown for a saved denial; one user agent per platform.
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36'
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'

const TWO_CAMERAS = [{ deviceId: 'cam-a', facingMode: 'environment' }, { deviceId: 'cam-b', facingMode: 'user' }]
const classOf = (node: MemoryNode | undefined) => node?.getAttribute('class') ?? ''

await startStage()
try {
  // ---- the live view -------------------------------------------------------

  await runTest('live: close over the video, scan-from-photo always there, no text, no manual-entry field', async () => {
    stage.liveVideoFrames = true
    const sheet = await mountSheet('granted')
    try {
      assert.equal(byLabel(sheet.container, 'Close').length, 1, 'one close button, over the video')
      assert.equal(byLabel(sheet.container, 'Scan from photo').length, 1, 'scan-from-photo is in the live view, not only after a failure')
      assert.equal(sheet.container.textContent.trim(), '', 'no visible text while the camera is live')
      assert.equal(byLabel(sheet.container, 'Point the camera at a barcode.').length, 1, 'the video is named for a screen reader')
      const inputs = findAll(sheet.container, (node) => node.tagName === 'INPUT')
      assert.deepEqual(inputs.map((input) => input.getAttribute('type')), ['file'], 'the only input is the hidden photo picker: no manual-entry field')
      assert.equal(findAll(sheet.container, (node) => classOf(node).includes('scanner-scan-line')).length, 1, 'the CSS scan line is drawn')
      assert.equal(byLabel(sheet.container, 'Turn on flashlight').length, 0, 'no torch button for a camera without a torch')
      assert.equal(byLabel(sheet.container, 'Switch camera').length, 0, 'no switch button with one camera')
    } finally {
      stage.liveVideoFrames = false
      await sheet.unmount()
    }
  })

  await runTest('live: the torch shows only for a torch track, and switch-camera only when the device has more than one camera', async () => {
    stage.liveVideoFrames = true
    const one = await mountSheet('granted', { capabilities: { torch: true } })
    try {
      assert.equal(byLabel(one.container, 'Turn on flashlight').length, 1)
      assert.equal(byLabel(one.container, 'Switch camera').length, 0, 'one camera, nothing to switch to')
    } finally {
      await one.unmount()
    }
    const two = await mountSheet('granted', { cameras: TWO_CAMERAS })
    try {
      const switchButtons = byLabel(two.container, 'Switch camera')
      assert.equal(switchButtons.length, 1, 'two cameras: the switch is there, icon-only')
      assert.equal(switchButtons[0].getAttribute('title'), 'Switch camera', 'with a tooltip')
      assert.equal(byLabel(two.container, 'Turn on flashlight').length, 0, 'and still no torch without one')
    } finally {
      stage.liveVideoFrames = false
      await two.unmount()
    }
  })

  await runTest('switching camera reopens on the next one, mirrors the front camera, and the choice is remembered on this device', async () => {
    stage.liveVideoFrames = true
    const storage = memoryStorage()
    windowOf().localStorage = storage
    try {
      const first = await mountSheet('granted', { cameras: TWO_CAMERAS })
      try {
        assert.ok(!classOf(videoOf(first.container)).includes('-scale-x-100'), 'the back camera is not mirrored')
        assert.notEqual((first.probe.requested[0] as { video: { facingMode?: unknown } }).video.facingMode, undefined, 'with nothing remembered the back camera is asked for')

        await press(byLabel(first.container, 'Switch camera')[0])
        await waitFor(() => first.probe.getUserMediaCalls === 2)
        assert.equal(first.probe.getUserMediaCalls, 2, 'the camera is reopened')
        assert.deepEqual(first.probe.tracks.map((track) => track.stopCount), [1, 0], 'the first camera is released before the second runs')
        const second = (first.probe.requested[1] as { video: Record<string, unknown> }).video
        assert.deepEqual(second.deviceId, { ideal: 'cam-b' }, 'the next camera is asked for, as a preference that cannot fail the scan')
        assert.equal(second.facingMode, undefined, 'and not "the back camera" as well')
        assert.equal(storage.data.get('business-os-scanner-camera-v1'), 'cam-b', 'the choice is stored')
        assert.ok(classOf(videoOf(first.container)).includes('-scale-x-100'), 'the front camera is shown mirrored')
      } finally {
        await first.unmount()
      }

      const again = await mountSheet('granted', { cameras: TWO_CAMERAS })
      try {
        assert.deepEqual((again.probe.requested[0] as { video: Record<string, unknown> }).video.deviceId, { ideal: 'cam-b' }, 'a later scan opens the remembered camera first')
        await press(byLabel(again.container, 'Switch camera')[0])
        await waitFor(() => again.probe.getUserMediaCalls === 2)
        assert.deepEqual((again.probe.requested[1] as { video: Record<string, unknown> }).video.deviceId, { ideal: 'cam-a' }, 'the list wraps round to the first camera')
        assert.equal(storage.data.get('business-os-scanner-camera-v1'), 'cam-a')
      } finally {
        await again.unmount()
      }
    } finally {
      delete windowOf().localStorage
      stage.liveVideoFrames = false
    }
  })

  await runTest('storage that throws never stops the camera opening or the switch working', async () => {
    stage.liveVideoFrames = true
    windowOf().localStorage = { getItem: () => { throw new Error('storage blocked') }, setItem: () => { throw new Error('quota') } }
    const sheet = await mountSheet('granted', { cameras: TWO_CAMERAS })
    try {
      assert.equal(sheet.probe.getUserMediaCalls, 1, 'the camera opened with the default choice')
      await press(byLabel(sheet.container, 'Switch camera')[0])
      await waitFor(() => sheet.probe.getUserMediaCalls === 2)
      assert.equal(sheet.probe.getUserMediaCalls, 2, 'the switch still reopened the camera; it is only not remembered')
    } finally {
      delete windowOf().localStorage
      stage.liveVideoFrames = false
      await sheet.unmount()
    }
  })

  // ---- one accepted read: vibrate, flash, close after the flash ---------------

  await runTest('a read vibrates once, flashes the view, tells a screen reader, and closes ~150 ms later, not before', async () => {
    stage.liveVideoFrames = true
    const sheet = await mountSheet('granted', { detector: ReadingDetector })
    try {
      await waitFor(() => sheet.detected.length > 0)
      assert.deepEqual(sheet.detected, ['3348901729222'], 'the code is handed on exactly as read')
      assert.deepEqual(sheet.vibrations, [40], 'one vibration of 40 ms')
      assert.ok(classOf(shellOf(sheet.container)).includes('scanner-read-flash'), 'the view carries the flash class')
      assert.match(sheet.container.textContent, /Barcode read/, 'an aria-live region says the barcode was read')
      assert.equal(sheet.closed(), 0, 'the sheet is still up while the flash shows')
      assert.deepEqual(sheet.probe.tracks.map((track) => [track.stopCount, track.readyState]), [[1, 'ended']], 'the camera itself is already off')
      await settle(SCAN_CLOSE_DELAY_MS + 120)
      assert.equal(sheet.closed(), 1, 'then it closes, once')
      assert.deepEqual(sheet.vibrations, [40], 'and did not buzz again')
      assert.deepEqual(sheet.detected, ['3348901729222'], 'one accepted read per open')
    } finally {
      stage.liveVideoFrames = false
      await sheet.unmount()
    }
  })

  await runTest('the status line is live from first paint so the announcement is heard', async () => {
    stage.liveVideoFrames = true
    const sheet = await mountSheet('granted')
    try {
      const status = findAll(sheet.container, (node) => node.getAttribute?.('role') === 'status')[0]
      assert.ok(status, 'the live region exists before anything is read, or it would not be announced')
      assert.equal(status.getAttribute('aria-live'), 'polite')
      assert.equal(status.textContent, '', 'and is empty until a read')
    } finally {
      stage.liveVideoFrames = false
      await sheet.unmount()
    }
  })

  await runTest('X is never delayed, and pressing it inside the flash window closes once, not twice', async () => {
    stage.liveVideoFrames = true
    const sheet = await mountSheet('granted', { detector: ReadingDetector })
    try {
      await waitFor(() => sheet.detected.length > 0)
      assert.equal(sheet.closed(), 0)
      await press(byLabel(sheet.container, 'Close')[0])
      assert.equal(sheet.closed(), 1, 'closed at once by hand')
      await settle(SCAN_CLOSE_DELAY_MS + 120)
      assert.equal(sheet.closed(), 1, 'the pending timer was cancelled')
    } finally {
      stage.liveVideoFrames = false
      await sheet.unmount()
    }

    stage.liveVideoFrames = true
    const idle = await mountSheet('granted')
    try {
      await press(byLabel(idle.container, 'Close')[0])
      assert.equal(idle.closed(), 1, 'X on a live camera closes immediately')
      assert.deepEqual(idle.detected, [], 'and publishes nothing')
      assert.deepEqual(idle.vibrations, [], 'and does not buzz')
    } finally {
      stage.liveVideoFrames = false
      await idle.unmount()
    }
  })

  await runTest('a sheet closed from outside inside the flash window never closes the next one with the first scan\'s timer', async () => {
    stage.liveVideoFrames = true
    const first = await mountSheet('granted', { detector: ReadingDetector })
    await waitFor(() => first.detected.length > 0)
    await first.unmount()
    const second = await mountSheet('granted')
    try {
      await settle(SCAN_CLOSE_DELAY_MS + 120)
      assert.equal(first.closed(), 0, 'an unmounted sheet never calls its close')
      assert.equal(second.closed(), 0, 'and the new sheet is untouched')
    } finally {
      stage.liveVideoFrames = false
      await second.unmount()
    }
  })

  // ---- one panel for blocked / unsupported / dismissed -------------------------

  async function assertPanel(sheet: Sheet, expectation: { sentence: RegExp; button: string }): Promise<void> {
    const text = sheet.container.textContent
    assert.match(text, expectation.sentence)
    assert.doesNotMatch(text, /manual entry|below|Detected value|Use value/i, 'no pointer to a manual-entry panel that no longer exists')
    assert.deepEqual(textButtons(sheet.container).map((button) => button.textContent.trim()), [expectation.button], 'one button with words, not two')
    assert.equal(findAll(sheet.container, (node) => node.tagName === 'INPUT' && node.getAttribute('type') !== 'file').length, 0, 'no text field')
  }

  await runTest('blocked: one sentence, one button, and the reset hint for the platform the person is on, only', async () => {
    const hints = { iphone: /Settings › Safari › Camera › Allow/, android: /Tap the lock icon by the address/, desktop: /Use the lock icon in the browser address bar/ }
    for (const [platform, userAgent] of [['iphone', IPHONE], ['android', ANDROID], ['desktop', DESKTOP]] as const) {
      const sheet = await mountSheet('denied', { userAgent })
      try {
        await assertPanel(sheet, { sentence: /Camera access is blocked\. Allow it in your browser settings, or type the barcode instead\./, button: 'Try camera again' })
        for (const [hintFor, hint] of Object.entries(hints)) {
          if (hintFor === platform) assert.match(sheet.container.textContent, hint, `${platform} sees its own hint`)
          else assert.doesNotMatch(sheet.container.textContent, hint, `${platform} does not see the ${hintFor} hint`)
        }
        assert.equal(byLabel(sheet.container, 'Scan from photo').length, 1, 'the photo is still one tap away, as the corner icon')
        assert.equal(sheet.probe.getUserMediaCalls, 0, 'a saved denial never asks the camera again')
      } finally {
        await sheet.unmount()
      }
    }
  })

  await runTest('unsupported: one sentence and the photo as the one button (there is no camera to retry)', async () => {
    const sheet = await mountSheet('granted', { unsupported: true })
    try {
      await assertPanel(sheet, { sentence: /This browser cannot scan with the camera\. Type the barcode instead\./, button: 'Scan from photo' })
      assert.equal(byLabel(sheet.container, 'Scan from photo').length, 0, 'the corner icon is not drawn beside the one button')
      assert.doesNotMatch(sheet.container.textContent, /Settings|lock icon/, 'a missing camera is not a permission problem: no reset hint')
    } finally {
      await sheet.unmount()
    }
  })

  await runTest('blocked by the view (in-app browser): the photo is the one button', async () => {
    const sheet = await mountSheet('granted', { documentBlocked: true })
    try {
      await assertPanel(sheet, { sentence: /does not allow camera access\. Open this page in your regular browser to scan, or type the barcode instead\./, button: 'Scan from photo' })
      assert.equal(sheet.probe.getUserMediaCalls, 0)
    } finally {
      await sheet.unmount()
    }
  })

  await runTest('dismissed prompt: one sentence, one button to try again', async () => {
    const sheet = await mountSheet('prompt', { rejectCamera: 'NotAllowedError' })
    try {
      await assertPanel(sheet, { sentence: /The camera prompt was dismissed\. Try again, or type the barcode instead\./, button: 'Try camera again' })
      assert.doesNotMatch(sheet.container.textContent, /Settings|lock icon/, 'a dismissed prompt is not a blocked camera: no reset hint')
    } finally {
      await sheet.unmount()
    }
  })

  // ---- the photo path -----------------------------------------------------------

  const globals = globalThis as unknown as Record<string, unknown>
  async function choosePhoto(sheet: Sheet, file: unknown, label = 'Scan from photo'): Promise<void> {
    await press(byLabel(sheet.container, label)[0])
    const picker = findAll(sheet.container, (node) => node.tagName === 'INPUT' && node.getAttribute('type') === 'file')[0]
    await act(async () => {
      await propsOf(picker).onChange({ target: { files: [file], value: 'photo.png' } })
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
  }
  const photo = () => new Blob(['not a real image'])
  const decodedPhoto = async () => ({ nodeName: 'IMG', width: 64, height: 48, close() {} })

  await runTest('a photo that cannot be opened shows the translated sentence, not the scanner\'s English', async () => {
    const original = { createImageBitmap: globals.createImageBitmap, Image: globals.Image }
    globals.createImageBitmap = async () => { throw new Error('this browser cannot decode the photo') }
    globals.Image = class { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(_value: string) { setTimeout(() => this.onerror?.(), 0) } }
    stage.liveVideoFrames = true
    const sheet = await mountSheet('granted', { t: kmT })
    try {
      await choosePhoto(sheet, photo(), km.scan_from_photo)
      const text = sheet.container.textContent
      assert.ok(text.includes(km.scan_photo_unreadable), `Khmer text expected, got: ${text}`)
      assert.doesNotMatch(text, /Unable to open the selected image/, 'the developer message is never shown')
    } finally {
      stage.liveVideoFrames = false
      Object.assign(globals, original)
      await sheet.unmount()
    }
  })

  await runTest('a photo with no barcode in it shows the translated sentence, in Khmer and English', async () => {
    const original = { createImageBitmap: globals.createImageBitmap }
    globals.createImageBitmap = decodedPhoto
    try {
      for (const [t, expected] of [[kmT, km.scan_photo_failed], [(key: string) => key, 'We could not read a barcode from that photo. Try another photo or type the barcode instead.']] as const) {
        stage.liveVideoFrames = true
        const sheet = await mountSheet('granted', { t })
        try {
          await choosePhoto(sheet, photo(), t === kmT ? km.scan_from_photo : 'Scan from photo')
          assert.ok(sheet.container.textContent.includes(expected), `expected ${expected}, got: ${sheet.container.textContent}`)
          assert.doesNotMatch(sheet.container.textContent, /could not find a barcode in that photo/, 'the developer message is never shown')
          assert.equal(sheet.detected.length, 0, 'nothing is published')
        } finally {
          stage.liveVideoFrames = false
          await sheet.unmount()
        }
      }
    } finally {
      Object.assign(globals, original)
    }
  })

  await runTest('a photo that reads gets the same feedback and the same single close as the camera', async () => {
    const original = { createImageBitmap: globals.createImageBitmap }
    globals.createImageBitmap = decodedPhoto
    queueZxingReads(['3348901729222', '3348901729222', '3348901729222', '3348901729222'])
    const sheet = await mountSheet('granted')
    try {
      await choosePhoto(sheet, photo())
      assert.deepEqual(sheet.detected, ['3348901729222'])
      assert.deepEqual(sheet.vibrations, [40])
      assert.ok(classOf(shellOf(sheet.container)).includes('scanner-read-flash'), 'the panel flashes too')
      assert.equal(sheet.closed(), 0)
      await settle(SCAN_CLOSE_DELAY_MS + 120)
      assert.equal(sheet.closed(), 1)
    } finally {
      Object.assign(globals, original)
      await sheet.unmount()
    }
  })

  // ---- copy and packs ---------------------------------------------------------------

  const OWNED_KEYS = [
    'scan_ready', 'scan_unsupported', 'scan_prompt_dismissed', 'camera_permission_blocked',
    'camera_document_blocked', 'scan_photo_failed', 'scan_photo_unreadable', 'scanner_read_ok', 'scanner_switch_camera',
    'camera_permission_reset_hint_ios', 'camera_permission_reset_hint_android',
  ]

  // Kept in the packs for the owner's unused-key list: the camera hook's last error branch could never choose it
  // (a denied start is always 'blocked' or 'dismissed' first), so the sheet no longer reads it.
  const UNREACHABLE_KEYS = ['scan_permission_denied']

  await runTest('Khmer: every string this lane owns is Khmer, with no English left over and barcode spelled បាកូដ', () => {
    for (const key of [...OWNED_KEYS, ...UNREACHABLE_KEYS, 'camera_permission_reset_hint', 'scan_no_match', 'scan_create_with_barcode', 'scan_hidden_by_filters']) {
      assert.ok(en[key], `en has ${key}`)
      assert.match(km[key] ?? '', /[ក-៿]/, `km ${key} is Khmer`)
      assert.notEqual(km[key], en[key], `km ${key} is not the English text`)
      assert.doesNotMatch(km[key], /បារកូដ/, `km ${key} spells barcode បាកូដ`)
    }
    assert.match(en.scan_no_match, /\{code\}/)
    assert.match(km.scan_no_match, /\{code\}/, 'the placeholder survives in Khmer')
  })

  await runTest('the English and Khmer fallbacks in the sheet equal the packs for every key this lane owns', () => {
    const source = fs.readFileSync(path.join(frontend, 'src/components/products/scanning/BarcodeScannerModal.tsx'), 'utf8')
    const calls = [...source.matchAll(/tr\('([a-z_]+)', '((?:[^'\\]|\\.)*)'(?:, '((?:[^'\\]|\\.)*)')?\)/g)]
    const seen = new Set<string>()
    for (const [, key, english, khmer] of calls) {
      if (!OWNED_KEYS.includes(key)) continue
      seen.add(key)
      assert.equal(english, en[key], `the English fallback for ${key} matches en.json`)
      assert.equal(khmer, km[key], `the Khmer fallback for ${key} matches km.json`)
    }
    assert.deepEqual(OWNED_KEYS.filter((key) => !seen.has(key)), [], 'every owned key is used by the sheet')
  })

  await runTest('retired keys are gone from both packs (the nested copy of manual_entry stays), and nothing on the owner\'s unused list was deleted', () => {
    for (const pack of ['en', 'km']) {
      const top = readPack(pack)
      for (const key of ['scan_fallback_active', 'detected_value', 'use_value', 'scanner_state_manual', 'camera_permission_blocked_no_manual', 'camera_document_blocked_no_manual', 'scanner_live_hint', 'manual_entry', 'scanner_sound']) {
        assert.equal(top[key], undefined, `${pack}.json no longer has top-level ${key}`)
      }
      assert.ok((top.common as Tree).manual_entry, `${pack}.json keeps the nested common.manual_entry`)
      for (const key of ['scanner_manual_subtitle', 'scanner_ready_title', 'scan_sku', 'manual_entry_hint', 'scan_product_for_adjustment']) {
        assert.ok(top[key], `${pack}.json keeps ${key} (the owner decides on the unused list)`)
      }
      assert.ok((top.common as Tree).scan_code, `${pack}.json keeps common.scan_code`)
    }
  })

  await runTest('scan_ready no longer mentions SKU, and no scanner file spells barcode បារកូដ', () => {
    for (const pack of [en, km]) assert.doesNotMatch(pack.scan_ready, /SKU/i, 'a barcode scanner does not read SKU labels')
    const scanningDir = path.join(frontend, 'src/components/products/scanning')
    const files = [
      ...fs.readdirSync(scanningDir).filter((name) => /\.tsx?$/.test(name)).map((name) => path.join(scanningDir, name)),
      path.join(frontend, 'src/components/shared/ScanSearchButton.tsx'),
      path.join(frontend, 'src/components/shared/useScannerWedge.ts'),
    ]
    assert.ok(files.length > 10, 'the scanner files were found')
    for (const file of files) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /បារកូដ/, `${path.basename(file)} must spell barcode បាកូដ`)
  })

  await runTest('the manual-entry panel and its prop are gone from the whole app', () => {
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        if (!/\.(ts|tsx|css)$/.test(entry.name)) continue
        if (/hideManualEntry|scanner-manual-value|scanner_manual_value|setManualValue|manualValue/.test(fs.readFileSync(full, 'utf8'))) offenders.push(path.relative(frontend, full))
      }
    }
    walk(path.join(frontend, 'src'))
    assert.deepEqual(offenders, [])
    const modal = fs.readFileSync(path.join(frontend, 'src/components/products/scanning/BarcodeScannerModal.tsx'), 'utf8')
    assert.doesNotMatch(modal, /manual_entry|detected_value|use_value|scanner_live_hint|scanner_state_manual|_no_manual|scan_fallback_active/, 'the sheet reads none of the retired keys')
    assert.doesNotMatch(modal, /manual entry|enter the code manually|use manual/i, 'and none of the retired wording')
  })
} finally {
  await stopStage()
}

if (failed > 0) process.exitCode = 1
