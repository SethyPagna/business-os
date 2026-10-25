// 6.0.978: the pause below is switched OFF (IOS_CAMERA_PAUSE_ENABLED = false). WebKit's source shows
// track.enabled = false never reaches the capture source, so the camera and its green indicator stay on
// (Records/Consolidation/2026-10-25/RESEARCH-IOS-CAMERA-INDICATOR.md). Closing now stops the tracks at once on
// every platform; the tests that need the pause itself run only when the switch is on, and the parking code is
// covered directly (flag-independent) in the "dormant parking code" test. This file also pins the 6.0.978 rules:
// getUserMedia inside the tap, and the iOS auto-resume cut-off.
//
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
  IOS_AUTO_RESUME_MAX_HIDDEN_MS,
  PARKED_CAMERA_IDLE_MS,
  allowCameraParking,
  iosPermissionTip,
  isIosWebKit,
  parkCameraStream,
  releaseAllParkedCamera,
  releaseParkedCamera,
  shouldAutoResume,
  shouldPauseOnClose,
  takeParkedCameraStream,
} from '../src/components/products/scanning/cameraKeepAlive.ts'

type Camera = ReturnType<typeof useBarcodeCamera>
type PausableTrack = CameraProbe['tracks'][number] & { enabled?: boolean; muted?: boolean; addEventListener?: (type: string, fn: () => void) => void }

let failed = 0
// A test that exercises the pause (the switch is off since 6.0.978) says SKIP, never PASS, when it has nothing to run.
class Skip extends Error {}
const skipUnlessPauseOn = (): void => { if (!IOS_CAMERA_PAUSE_ENABLED) throw new Skip('IOS_CAMERA_PAUSE_ENABLED is false') }
async function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    if (error instanceof Skip) {
      console.log(`SKIP ${name} (${error.message})`)
      return
    }
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
    skipUnlessPauseOn()
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
    skipUnlessPauseOn()
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
    skipUnlessPauseOn()
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
    skipUnlessPauseOn()
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
    skipUnlessPauseOn()
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
    assert.match(hook, /const request = openCamera\(startToken/, 'and startCamera goes through openCamera')
    assert.equal((hook.match(/cleanup\(true\)/g) || []).length, 3, 'only completeDetection, closeScanner and the unmount of an open scanner park; a hide or a resume never does')
    assert.match(hook, /const parkCamera = useCallback\(\(\): void => \{\n\s*cleanup\(\)\n/, 'the hide path stops the camera')
    assert.match(hook, /const handlePageHide = \(\) => \{[\s\S]*?\n\s*cleanup\(\)\n\s*\}/, 'pagehide stops the camera')
  })

  await runTest('iOS, scanner CLOSED when the page hides: the parked stream is released and nothing resumes', async () => {
    skipUnlessPauseOn()
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
  // ---- 6.0.978 ---------------------------------------------------------------------------------------

  await runTest('the pause is OFF: WebKit never stops the camera for a disabled track, so closing stops every track (also on an iPhone)', async () => {
    assert.equal(IOS_CAMERA_PAUSE_ENABLED, false, 'track.enabled = false leaves the camera and the green indicator on (RESEARCH-IOS-CAMERA-INDICATOR.md)')
    const iphone = { userAgent: IPHONE_UA, platform: 'iPhone', maxTouchPoints: 5 }
    assert.equal(shouldPauseOnClose(undefined, iphone), false, 'with the shipped switch an iPhone does not pause')
    const run = await open(IPHONE_UA, 'iPhone', 5)
    await act(async () => { run.camera().closeScanner() })
    assert.equal(run.track().stopCount, 1, 'stopped on close, the indicator goes off')
    assert.equal(run.track().readyState, 'ended')
    await run.mounted.unmount()
  })

  await runTest('dormant parking code (behind the switch): park disables, take re-enables the same stream, every release path stops it', async () => {
    const fakeStream = () => {
      const listeners: Record<string, Array<() => void>> = {}
      const track = {
        readyState: 'live', muted: false, enabled: true, stopCount: 0,
        stop() { this.stopCount += 1; this.readyState = 'ended' },
        addEventListener(type: string, fn: () => void) { (listeners[type] ||= []).push(fn) },
        removeEventListener() {},
      }
      return { track, listeners, stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream }
    }
    allowCameraParking()
    const a = fakeStream()
    assert.equal(parkCameraStream(a.stream), true)
    assert.equal(a.track.enabled, false)
    assert.equal(a.track.stopCount, 0)
    assert.equal(takeParkedCameraStream(), a.stream, 'the same stream comes back')
    assert.equal(a.track.enabled, true)
    const b = fakeStream()
    parkCameraStream(b.stream)
    fire('window', 'pagehide')
    assert.equal(b.track.stopCount, 1, 'pagehide stops a parked stream')
    const c = fakeStream()
    parkCameraStream(c.stream)
    setVisibility('hidden')
    fire('document', 'visibilitychange')
    setVisibility('visible')
    assert.equal(c.track.stopCount, 1, 'a hidden page stops a parked stream')
    const d = fakeStream()
    parkCameraStream(d.stream)
    d.track.readyState = 'ended'
    d.listeners.ended?.[0]?.()
    assert.equal(takeParkedCameraStream(), null, 'an ended track is not reused')
    const e = fakeStream()
    parkCameraStream(e.stream)
    releaseParkedCamera()
    assert.equal(e.track.stopCount, 1)
    assert.ok(PARKED_CAMERA_IDLE_MS > 0)
  })

  await runTest('getUserMedia is called inside the tap: even with the permission read still pending, a (re)start has asked for the camera before it returns', async () => {
    const run = await open(IPHONE_UA, 'iPhone', 5)
    await act(async () => { run.camera().closeScanner() })
    const nav = (globalThis as unknown as { navigator: { permissions: { query: () => Promise<unknown> } } }).navigator
    const realQuery = nav.permissions.query
    nav.permissions.query = () => new Promise(() => {}) // never answers: anything awaited behind it would never reach the camera
    try {
      let callsRightAway = -1
      await act(async () => {
        void run.camera().startCamera()
        callsRightAway = run.probe.getUserMediaCalls
      })
      assert.equal(callsRightAway, 2, 'the retry / reopen path reaches getUserMedia synchronously, not after an await')
    } finally {
      nav.permissions.query = realQuery
    }
    await run.mounted.unmount()
  })

  // The page returns after being hidden `ms` long (Date.now is moved, not waited).
  const hiddenFor = async (ms: number, how: 'visibility' | 'bfcache' = 'visibility') => {
    const realNow = Date.now
    let offset = 0
    Date.now = () => realNow() + offset
    try {
      await act(async () => { setVisibility('hidden'); fire('document', 'visibilitychange'); if (how === 'bfcache') fire('window', 'pagehide') })
      offset = ms
      await act(async () => { setVisibility('visible'); fire('document', 'visibilitychange'); if (how === 'bfcache') fire('window', 'pageshow') })
    } finally {
      Date.now = realNow
    }
  }

  await runTest('auto-resume cut-off on iOS WebKit: the policy is 50 s (named), iOS only', () => {
    assert.equal(IOS_AUTO_RESUME_MAX_HIDDEN_MS, 50_000)
    const iphone = { userAgent: IPHONE_UA, platform: 'iPhone', maxTouchPoints: 5 }
    const android = { userAgent: ANDROID_UA, platform: 'Linux armv8l', maxTouchPoints: 5 }
    assert.equal(shouldAutoResume(30_000, iphone), true)
    assert.equal(shouldAutoResume(IOS_AUTO_RESUME_MAX_HIDDEN_MS - 1, iphone), true)
    assert.equal(shouldAutoResume(IOS_AUTO_RESUME_MAX_HIDDEN_MS, iphone), false)
    assert.equal(shouldAutoResume(70_000, iphone), false)
    assert.equal(shouldAutoResume(70_000, android), true, 'Android and desktop are unchanged')
    assert.equal(shouldAutoResume(10 * 60_000, { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', platform: 'Win32', maxTouchPoints: 0 }), true)
  })

  await runTest('iPhone hidden 30 s: the camera comes back by itself', async () => {
    const run = await open(IPHONE_UA, 'iPhone', 5)
    await hiddenFor(30_000)
    await waitFor(() => run.probe.getUserMediaCalls === 2 && /^scanning\|/.test(run.mounted.container.textContent))
    assert.equal(run.probe.getUserMediaCalls, 2)
    await run.mounted.unmount()
    fire('window', 'pagehide')
  })

  await runTest('iPhone hidden 70 s: the paused panel shows with no request, and a tap starts the camera', async () => {
    const run = await open(IPHONE_UA, 'iPhone', 5)
    await hiddenFor(70_000)
    await settle(80)
    assert.equal(run.probe.getUserMediaCalls, 1, 'no request without a tap after more than the grant window')
    assert.match(run.mounted.container.textContent, /^manual\|/, 'the existing paused state')
    assert.ok(run.probe.tracks.every((track) => track.readyState === 'ended'), 'no camera left on while paused')
    await act(async () => { await run.camera().startCamera() }) // the Start camera button is this call
    await waitFor(() => run.probe.getUserMediaCalls === 2 && /^scanning\|/.test(run.mounted.container.textContent))
    assert.equal(run.probe.getUserMediaCalls, 2, 'the tap starts it')
    await run.mounted.unmount()
    fire('window', 'pagehide')
  })

  await runTest('iPhone restored from the back-forward cache after 70 s: paused too, not asked by itself', async () => {
    const run = await open(IPHONE_UA, 'iPhone', 5)
    await hiddenFor(70_000, 'bfcache')
    await settle(80)
    assert.equal(run.probe.getUserMediaCalls, 1)
    assert.match(run.mounted.container.textContent, /^manual\|/)
    await run.mounted.unmount()
    fire('window', 'pagehide')
  })

  await runTest('Android hidden 70 s: the camera still comes back by itself, as before', async () => {
    const run = await open(ANDROID_UA, 'Linux armv8l', 5)
    await hiddenFor(70_000)
    await waitFor(() => run.probe.getUserMediaCalls === 2 && /^scanning\|/.test(run.mounted.container.textContent))
    assert.equal(run.probe.getUserMediaCalls, 2)
    await run.mounted.unmount()
    fire('window', 'pagehide')
  })

  await runTest('permission tip: iOS Safari only, only for a dismissed prompt; Safari tab versus Home Screen app', () => {
    const iphone = { userAgent: IPHONE_UA, platform: 'iPhone', maxTouchPoints: 5 }
    const standalone = { ...iphone, standalone: true }
    const android = { userAgent: ANDROID_UA, platform: 'Linux armv8l', maxTouchPoints: 5 }
    assert.equal(iosPermissionTip('dismissed', iphone), 'safari')
    assert.equal(iosPermissionTip('dismissed', standalone), 'homescreen')
    assert.equal(iosPermissionTip('blocked', iphone), null, 'a block keeps its one red Settings line, in a Safari tab')
    assert.equal(iosPermissionTip('blocked', standalone), null, 'and in the Home Screen app: never the "asks once" line')
    assert.equal(iosPermissionTip('dismissed', android), null, 'not on Android')
    for (const browser of ['CriOS/130.0', 'FxiOS/130.0', 'EdgiOS/130.0', 'OPiOS/16.0']) {
      assert.equal(iosPermissionTip('dismissed', { ...iphone, userAgent: `${IPHONE_UA} ${browser}` }), null, `${browser} has no Safari page menu`)
    }
    for (const status of ['idle', 'starting', 'scanning', 'manual']) assert.equal(iosPermissionTip(status, iphone), null, `${status}: no tip on a success path or a non-permission failure`)
  })

  // ---- review fixes: nothing starts after the scanner is closed; the discard when the video never appears ----

  await runTest('P3-1 a start that arrives after the close does not turn the camera on', async () => {
    const run = await open(IPHONE_UA, 'iPhone', 5)
    const startLate = run.camera().startCamera
    await act(async () => { run.camera().closeScanner() })
    await run.mounted.unmount()
    void startLate()
    await settle(1500)
    assert.equal(run.probe.getUserMediaCalls, 1, 'no request after the close')
    assert.ok(run.probe.tracks.every((track) => track.readyState === 'ended'), 'and no camera left on')
  })

  await runTest('P3-1 the real path: switch camera tapped, X tapped, THEN the camera list comes back', async () => {
    stage.liveVideoFrames = true
    const probe = installCamera('granted')
    setNavigatorIdentity(ANDROID_UA, 'Linux armv8l', 5)
    const media = (globalThis as unknown as { navigator: { mediaDevices: { enumerateDevices?: () => Promise<unknown[]> } } }).navigator.mediaDevices
    let release: (devices: unknown[]) => void = () => {}
    media.enumerateDevices = () => new Promise((resolve) => { release = resolve })
    let camera: Camera | null = null
    const mounted = await mountComponent('/tests/scannerHookProbe.ts', { open: true, onDetected: () => {}, onClose: () => {}, onCamera: (next: Camera) => { camera = next } })
    await waitFor(() => probe.tracks.length > 0 && /^scanning\|/.test(mounted.container.textContent))
    const switching = (camera as unknown as Camera).switchCamera()
    await act(async () => { (camera as unknown as Camera).closeScanner() })
    await mounted.unmount()
    release([{ kind: 'videoinput', deviceId: 'a' }, { kind: 'videoinput', deviceId: 'b' }])
    await switching
    await settle(1500)
    assert.equal(probe.getUserMediaCalls, 1, 'the list resolving after the close starts nothing')
    assert.ok(probe.tracks.every((track) => track.readyState === 'ended'), 'no camera left on')
  })

  await runTest('P3-3 the <video> never appears: the request already made is discarded and its stream stopped', async () => {
    stage.liveVideoFrames = true
    const probe = installCamera('granted')
    setNavigatorIdentity(IPHONE_UA, 'iPhone', 5)
    const mounted = await mountComponent('/tests/scannerHookNoVideoProbe.ts', { open: true, onCamera: () => {} })
    await waitFor(() => probe.getUserMediaCalls === 1 && probe.tracks.length === 1)
    await waitFor(() => probe.tracks.every((track) => track.readyState === 'ended'), 120, 25)
    assert.equal(probe.tracks[0].stopCount, 1, 'stopped exactly once, not left on behind a missing video')
    await mounted.unmount()
  })
} finally {
  await stopStage()
}

void FakeWorker
if (failed > 0) process.exitCode = 1
