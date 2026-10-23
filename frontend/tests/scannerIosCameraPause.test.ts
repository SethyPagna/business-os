// 6.0.968: on iPhone and iPad the scanner's camera is PAUSED when the sheet
// closes, not stopped, so the next tap reuses the stream and the browser's
// camera grant instead of asking again (WebKit forgets a grant ~10 minutes
// after the last capture stops).
//
// Mounts the real hook with a fake camera whose tracks record stop() and
// `enabled`. Discriminating: a close on iOS must leave stopCount 0 and
// enabled=false (the old behaviour stopped), the reopen must make NO second
// getUserMedia call, and every release path must still stop the tracks.
import assert from 'node:assert/strict'
import {
  FakeWorker,
  act,
  fire,
  installCamera,
  mountComponent,
  setVisibility,
  stage,
  startStage,
  stopStage,
  waitFor,
  type CameraProbe,
} from './scannerCameraHarness.ts'
import type { useBarcodeCamera } from '../src/components/products/scanning/useBarcodeCamera.ts'
import {
  IOS_CAMERA_PAUSE_ENABLED,
  PARKED_CAMERA_IDLE_MS,
  isIosWebKit,
} from '../src/components/products/scanning/cameraKeepAlive.ts'

type Camera = ReturnType<typeof useBarcodeCamera>
type PausableTrack = CameraProbe['tracks'][number] & { enabled?: boolean; addEventListener?: (type: string, fn: () => void) => void }

let failed = 0
async function runTest(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  } finally {
    stage.liveVideoFrames = false
    stage.videoFrameCallbacks = false
  }
}

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'

function setNavigatorIdentity(userAgent: string, platform = '', maxTouchPoints = 0): void {
  const current = (globalThis as unknown as { navigator: object }).navigator
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { ...current, userAgent, platform, maxTouchPoints } })
}

async function open(userAgent: string, platform = '', maxTouchPoints = 0) {
  stage.liveVideoFrames = true
  const probe = installCamera('granted')
  setNavigatorIdentity(userAgent, platform, maxTouchPoints)
  let camera: Camera | null = null
  const mounted = await mountComponent('/tests/scannerHookProbe.ts', {
    open: true,
    onDetected: () => {},
    onClose: () => {},
    onCamera: (next: Camera) => { camera = next },
  })
  await waitFor(() => probe.tracks.length > 0 && /^scanning\|/.test(mounted.container.textContent))
  return { probe, mounted, camera: () => camera as unknown as Camera, track: () => probe.tracks[0] as PausableTrack }
}

await startStage()
try {
  await runTest('iOS detection: iPhone, iPad, iPadOS desktop UA with touch; not Mac, Android or desktop', async () => {
    assert.equal(isIosWebKit({ userAgent: IPHONE_UA, platform: 'iPhone', maxTouchPoints: 5 }), true)
    assert.equal(isIosWebKit({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', platform: 'iPad', maxTouchPoints: 5 }), true)
    assert.equal(isIosWebKit({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 }), true, 'iPadOS asking for the desktop site')
    assert.equal(isIosWebKit({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 0 }), false, 'a real Mac')
    assert.equal(isIosWebKit({ userAgent: ANDROID_UA, platform: 'Linux armv8l', maxTouchPoints: 5 }), false)
    assert.equal(isIosWebKit(undefined), false)
    assert.equal(IOS_CAMERA_PAUSE_ENABLED, true, 'the pause switch is on (flip it off if the device test shows the camera dot stays)')
  })

  await runTest('iOS: closing pauses the stream, reopening reuses it with no second getUserMedia', async () => {
    const run = await open(IPHONE_UA, 'iPhone', 5)
    await act(async () => { run.camera().closeScanner() })
    assert.equal(run.track().stopCount, 0, 'the track is not stopped')
    assert.equal(run.track().readyState, 'live')
    assert.equal(run.track().enabled, false, 'it is paused')
    await act(async () => { await run.camera().startCamera() })
    await waitFor(() => /^scanning\|/.test(run.mounted.container.textContent))
    assert.equal(run.probe.getUserMediaCalls, 1, 'no second getUserMedia')
    assert.equal(run.track().enabled, true, 'frames flow again')
    assert.equal(run.track().stopCount, 0)
    await run.mounted.unmount()
    assert.equal(run.track().stopCount, 0, 'unmounting the sheet pauses again')
    assert.equal(run.track().enabled, false)
    fire('window', 'pagehide')
    assert.equal(run.track().stopCount, 1, 'and pagehide lets go')
  })

  await runTest('Android and desktop: closing still stops the tracks, reopening asks again', async () => {
    const run = await open(ANDROID_UA, 'Linux armv8l', 5)
    await act(async () => { run.camera().closeScanner() })
    assert.equal(run.track().stopCount, 1)
    assert.equal(run.track().readyState, 'ended')
    assert.notEqual(run.track().enabled, false, 'never paused')
    await act(async () => { await run.camera().startCamera() })
    await waitFor(() => run.probe.getUserMediaCalls === 2)
    await run.mounted.unmount()
  })

  await runTest('iOS: pagehide, a hidden page, and the idle timeout each stop the paused tracks', async () => {
    for (const how of ['pagehide', 'hidden', 'idle'] as const) {
      const realSetTimeout = globalThis.setTimeout
      const idle: Array<() => void> = []
      if (how === 'idle') {
        globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
          if (ms === PARKED_CAMERA_IDLE_MS) { idle.push(fn); return 0 as unknown as ReturnType<typeof setTimeout> }
          return realSetTimeout(fn, ms, ...rest)
        }) as typeof setTimeout
      }
      try {
        const run = await open(IPHONE_UA, 'iPhone', 5)
        await act(async () => { run.camera().closeScanner() })
        assert.equal(run.track().stopCount, 0, `${how}: paused first`)
        if (how === 'pagehide') fire('window', 'pagehide')
        if (how === 'hidden') {
          setVisibility('hidden')
          fire('document', 'visibilitychange')
          setVisibility('visible')
        }
        if (how === 'idle') {
          assert.equal(idle.length, 1, 'one idle timer of PARKED_CAMERA_IDLE_MS was set')
          idle[0]()
        }
        assert.equal(run.track().stopCount, 1, `${how}: stopped`)
        await act(async () => { await run.camera().startCamera() })
        await waitFor(() => run.probe.getUserMediaCalls === 2)
        assert.equal(run.probe.getUserMediaCalls, 2, `${how}: the next open is a fresh start`)
        await run.mounted.unmount()
        fire('window', 'pagehide')
      } finally {
        globalThis.setTimeout = realSetTimeout
      }
    }
  })

  await runTest('iOS: an ended track (event, or found dead on reopen) falls back to a fresh getUserMedia', async () => {
    // Found dead on reopen, no event delivered.
    const quiet = await open(IPHONE_UA, 'iPhone', 5)
    await act(async () => { quiet.camera().closeScanner() })
    quiet.track().readyState = 'ended'
    await act(async () => { await quiet.camera().startCamera() })
    await waitFor(() => quiet.probe.getUserMediaCalls === 2)
    assert.equal(quiet.probe.getUserMediaCalls, 2)
    await quiet.mounted.unmount()
    fire('window', 'pagehide')

    // The 'ended' event while paused releases the other tracks too.
    const loud = await open(IPHONE_UA, 'iPhone', 5)
    const ended: Array<() => void> = []
    loud.track().addEventListener = (type, fn) => { if (type === 'ended') ended.push(fn) }
    await act(async () => { loud.camera().closeScanner() })
    assert.equal(ended.length, 1, 'the keeper listens for the track ending')
    loud.track().readyState = 'ended'
    ended[0]()
    assert.equal(loud.track().stopCount, 0, 'an already-ended track is not stopped twice')
    await act(async () => { await loud.camera().startCamera() })
    await waitFor(() => loud.probe.getUserMediaCalls === 2)
    assert.equal(loud.probe.getUserMediaCalls, 2)
    await loud.mounted.unmount()
    fire('window', 'pagehide')
  })
} finally {
  await stopStage()
}

void FakeWorker
if (failed > 0) process.exitCode = 1
