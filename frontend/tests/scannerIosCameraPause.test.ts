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
import { readFileSync } from 'node:fs'
import {
  FakeWorker,
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
  type CameraProbe,
} from './scannerCameraHarness.ts'
import type { useBarcodeCamera } from '../src/components/products/scanning/useBarcodeCamera.ts'
import {
  IOS_CAMERA_PAUSE_ENABLED,
  PARKED_CAMERA_IDLE_MS,
  allowCameraParking,
  isIosWebKit,
  parkCameraStream,
  releaseAllParkedCamera,
  shouldPauseOnClose,
  takeParkedCameraStream,
} from '../src/components/products/scanning/cameraKeepAlive.ts'

type Camera = ReturnType<typeof useBarcodeCamera>
type PausableTrack = CameraProbe['tracks'][number] & { enabled?: boolean; muted?: boolean; addEventListener?: (type: string, fn: () => void) => void }

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
    const iphone = { userAgent: IPHONE_UA, platform: 'iPhone', maxTouchPoints: 5 }
    assert.equal(shouldPauseOnClose(true, iphone), true)
    assert.equal(shouldPauseOnClose(false, iphone), false, 'the switch off means no pausing even on an iPhone')
    assert.equal(shouldPauseOnClose(true, { userAgent: ANDROID_UA, platform: 'Linux armv8l', maxTouchPoints: 5 }), false)
  })

  await runTest('iOS: closing pauses the stream and reopening reuses it (or, with the switch off, stops and asks again)', async () => {
    const run = await open(IPHONE_UA, 'iPhone', 5)
    await act(async () => { run.camera().closeScanner() })
    if (IOS_CAMERA_PAUSE_ENABLED) {
      assert.equal(run.track().stopCount, 0, 'the track is not stopped')
      assert.equal(run.track().readyState, 'live')
      assert.equal(run.track().enabled, false, 'it is paused')
    } else {
      assert.equal(run.track().stopCount, 1, 'switch off: stopped as on Android')
      assert.notEqual(run.track().enabled, false)
    }
    await act(async () => { await run.camera().startCamera() })
    await waitFor(() => /^scanning|/.test(run.mounted.container.textContent))
    if (IOS_CAMERA_PAUSE_ENABLED) {
      assert.equal(run.probe.getUserMediaCalls, 1, 'no second getUserMedia')
      assert.equal(run.track().enabled, true, 'frames flow again')
      assert.equal(run.track().stopCount, 0)
    } else {
      assert.equal(run.probe.getUserMediaCalls, 2, 'switch off: a fresh start')
    }
    await run.mounted.unmount()
    fire('window', 'pagehide')
    assert.ok(run.probe.tracks.every((track) => track.stopCount === 1), 'pagehide lets go of whatever was kept')
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
  await runTest('iOS: a saved denial releases the paused stream', async () => {
    if (!IOS_CAMERA_PAUSE_ENABLED) return
    const run = await open(IPHONE_UA, 'iPhone', 5)
    await act(async () => { run.camera().closeScanner() })
    assert.equal(run.track().stopCount, 0)
    run.probe.permission.state = 'denied'
    await act(async () => { await run.camera().startCamera() })
    assert.equal(run.track().stopCount, 1, 'the paused camera is stopped, not left on under a block screen')
    assert.equal(run.probe.getUserMediaCalls, 1)
    await run.mounted.unmount()
  })

  await runTest('iOS: the torch is switched off when the camera is parked', async () => {
    if (!IOS_CAMERA_PAUSE_ENABLED) return
    const run = await open(IPHONE_UA, 'iPhone', 5)
    const applied: unknown[] = []
    run.track().applyConstraints = async (next: unknown) => { applied.push(next) }
    await act(async () => { run.camera().closeScanner() })
    assert.ok(applied.some((next) => JSON.stringify(next).includes('"torch":false')), 'torch:false was requested')
    assert.equal(run.track().enabled, false)
    await run.mounted.unmount()
    fire('window', 'pagehide')
  })

  await runTest('iOS: a muted (interrupted) parked track is not reused', async () => {
    if (!IOS_CAMERA_PAUSE_ENABLED) return
    const run = await open(IPHONE_UA, 'iPhone', 5)
    await act(async () => { run.camera().closeScanner() })
    run.track().muted = true
    await act(async () => { await run.camera().startCamera() })
    await waitFor(() => run.probe.getUserMediaCalls === 2)
    assert.equal(run.probe.getUserMediaCalls, 2, 'a fresh start')
    assert.equal(run.track().stopCount, 1, 'the interrupted track was stopped')
    await run.mounted.unmount()
    fire('window', 'pagehide')
  })

  await runTest('sign-out and shell unmount release at once and refuse a later park until the scanner opens again', async () => {
    const fakeStream = () => {
      const track = { readyState: 'live', muted: false, enabled: true, stopCount: 0, stop() { this.stopCount += 1; this.readyState = 'ended' } }
      return { track, stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream }
    }
    const first = fakeStream()
    allowCameraParking()
    assert.equal(parkCameraStream(first.stream), true)
    releaseAllParkedCamera()
    assert.equal(first.track.stopCount, 1, 'the parked stream is stopped by the release')
    // The child's unmount cleanup runs AFTER the parent's release: it must not park a new stream.
    const second = fakeStream()
    assert.equal(parkCameraStream(second.stream), false, 'parking is refused after a release-all')
    assert.equal(second.track.enabled, true, 'the refused stream was left alone for the caller to stop')
    assert.equal(takeParkedCameraStream(), null)
    allowCameraParking()
    assert.equal(parkCameraStream(second.stream), true, 'opening the scanner again allows parking')
    releaseAllParkedCamera()
    allowCameraParking()
    // The wiring: the shell releases on unmount and on sign-out; opening the scanner allows parking again.
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
    assert.match(app, /useEffect\(\(\) => releaseAllParkedCamera, \[\]\)/)
    assert.match(app, /if \(!user\) releaseAllParkedCamera\(\)/)
    const hook = readFileSync(new URL('../src/components/products/scanning/useBarcodeCamera.ts', import.meta.url), 'utf8')
    assert.match(hook, /resumeAfterRequestRef\.current = false\s+allowCameraParking\(\)\s+setReadOk\(false\)/, '6.0.966 and 6.0.968 both reset on open')
  })

  // 6.0.966 (come back by itself) meets 6.0.968 (park on close): the three ways a hide can meet the scanner.
  const hideThenShow = async (between: () => Promise<void> | void = () => {}) => {
    await act(async () => { setVisibility('hidden'); fire('document', 'visibilitychange') })
    await between()
    await act(async () => { setVisibility('visible'); fire('document', 'visibilitychange') })
  }

  await runTest('iOS, scanner OPEN when the page hides: the camera is let go at once and comes back by itself with one fresh request', async () => {
    const run = await open(IPHONE_UA, 'iPhone', 5)
    await hideThenShow(async () => {
      assert.equal(run.track().stopCount, 1, 'a hidden page never holds a running or parked camera')
    })
    await waitFor(() => run.probe.getUserMediaCalls === 2 && /^scanning\|/.test(run.mounted.container.textContent))
    assert.equal(run.probe.getUserMediaCalls, 2, 'nothing was parked, so the return starts fresh, once')
    await run.mounted.unmount()
    fire('window', 'pagehide')
  })

  await runTest('the auto-resume is an ordinary start: a parked stream is taken before any request is made, and a resume never parks', async () => {
    // The harness loads the hook in its own module graph, so a stream parked from here is invisible to it; the reuse
    // itself is proved above (reopening makes no second getUserMedia). What is pinned here is the wiring: the resume
    // reaches openCamera through startCamera, whose first act is to take the parked stream.
    const hook = readFileSync(new URL('../src/components/products/scanning/useBarcodeCamera.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    assert.match(hook, /async function openCamera\([^)]*\)[^{]*\{\n(?:\s*\/\/[^\n]*\n)*\s*const paused = takeParkedCameraStream\(\)\n\s*if \(paused\) return paused\n\s*try \{\n\s*return await navigator\.mediaDevices\.getUserMedia/, 'a parked stream is taken before getUserMedia')
    assert.match(hook, /nextStartIsResumeRef\.current = true\n\s*void startCameraRef\.current\(\)/, 'the resume goes through startCamera')
    assert.match(hook, /const stream = await openCamera\(startToken/, 'and startCamera goes through openCamera')
    assert.equal((hook.match(/cleanup\(true\)/g) || []).length, 3, 'only completeDetection, closeScanner and the unmount of an open scanner park; a hide or a resume never does')
    assert.match(hook, /const parkCamera = useCallback\(\(\): void => \{\n\s*cleanup\(\)\n/, 'the hide path stops the camera')
    assert.match(hook, /const handlePageHide = \(\) => \{[\s\S]*?\n\s*cleanup\(\)\n\s*\}/, 'pagehide stops the camera')
  })

  await runTest('iOS, scanner CLOSED when the page hides: the parked stream is released and nothing resumes', async () => {
    const run = await open(IPHONE_UA, 'iPhone', 5)
    await act(async () => { run.camera().closeScanner() })
    await run.mounted.unmount()
    assert.equal(run.track().stopCount, 0, 'closed: paused, not stopped')
    await hideThenShow(async () => {
      assert.equal(run.track().stopCount, 1, 'the hidden page released the parked stream')
    })
    await settle(60)
    assert.equal(run.probe.getUserMediaCalls, 1, 'a closed scanner is never reopened by a return')
    await act(async () => { fire('window', 'pageshow') })
    await settle(30)
    assert.equal(run.probe.getUserMediaCalls, 1, 'nor by a back-forward-cache restore')
  })

  await runTest('iOS, hidden while open and closed before the return: the return never reopens the camera', async () => {
    const run = await open(IPHONE_UA, 'iPhone', 5)
    await act(async () => { setVisibility('hidden'); fire('document', 'visibilitychange') })
    await act(async () => { run.camera().closeScanner() })
    await run.mounted.unmount()
    await act(async () => { setVisibility('visible'); fire('document', 'visibilitychange'); fire('window', 'pageshow') })
    await settle(60)
    assert.equal(run.probe.getUserMediaCalls, 1, 'closed while away: no request on return')
    assert.ok(run.probe.tracks.every((track) => track.stopCount === 1 || track.readyState === 'ended'), 'and no camera left on')
    fire('window', 'pagehide')
  })
} finally {
  await stopStage()
}

void FakeWorker
if (failed > 0) process.exitCode = 1
