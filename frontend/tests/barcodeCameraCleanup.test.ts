// Scanner S1b (6.0.935): every way a scan ends lets go of the camera AND the
// decode worker, and the loop does what the spec says while it runs.
//
// The camera lifecycle moved out of the modal into useBarcodeCamera, and the
// decoder moved into a Worker. Both are things a scanner left running keeps
// alive, so this mounts the hook as it runs (React, a fake camera whose tracks
// are counted, a stand-in Worker running the real frame handler) and ends the
// scan every way it can end:
//   detection (native and worker) - close - photo picker - page hidden -
//   page hide - permission revoked - unmount - restart - start error - idle pause.
// Each must leave every track stopped exactly once and every worker terminated
// exactly once, with no frame callback still scheduled.
import assert from 'node:assert/strict'
import {
  FakeWorker,
  act,
  events,
  fire,
  installCamera,
  listenerCount,
  mountComponent,
  queueZxingReads,
  setFrameBudget,
  setVisibility,
  settle,
  stage,
  startStage,
  stopStage,
  waitFor,
  type CameraOptions,
  type CameraProbe,
  type Mounted,
} from './scannerCameraHarness.ts'
import type { useBarcodeCamera } from '../src/components/products/scanning/useBarcodeCamera.ts'

type Camera = ReturnType<typeof useBarcodeCamera>

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
    setFrameBudget(120)
  }
}

const PROBE = '/tests/scannerHookProbe.ts'
const IN_GUIDE = { x: 20, y: 15, width: 20, height: 10 }

/** A native detector that never reads anything but counts how often it was asked. */
function watchingDetector() {
  const log = { calls: [] as number[] }
  class Detector {
    static async getSupportedFormats(): Promise<string[]> { return ['ean_13'] }
    async detect(): Promise<unknown[]> { log.calls.push(Date.now()); return [] }
  }
  return { Detector, log }
}

function readingDetector(code: string) {
  return class {
    static async getSupportedFormats(): Promise<string[]> { return ['ean_13'] }
    async detect(): Promise<unknown[]> { return [{ rawValue: code, format: 'ean_13', boundingBox: IN_GUIDE }] }
  }
}

interface Running {
  probe: CameraProbe
  mounted: Mounted
  camera: () => Camera
  detected: string[]
  closed: () => number
  view: () => string
}

interface WorkerSetup {
  mode?: 'ready' | 'never' | 'fails'
  replyDelayMs?: number
}

async function mountProbe(permission: 'granted' | 'prompt' | 'denied', options: CameraOptions = {}, worker: WorkerSetup = {}): Promise<Running> {
  const probe = installCamera(permission, options)
  if (worker.mode) FakeWorker.mode = worker.mode
  if (worker.replyDelayMs !== undefined) FakeWorker.replyDelayMs = worker.replyDelayMs
  const detected: string[] = []
  const state = { closed: 0, camera: null as Camera | null }
  const mounted = await mountComponent(PROBE, {
    open: true,
    onDetected: (value: string) => detected.push(value),
    onClose: () => { state.closed += 1 },
    onCamera: (camera: Camera) => { state.camera = camera },
  })
  return {
    probe,
    mounted,
    camera: () => state.camera as Camera,
    detected,
    closed: () => state.closed,
    view: () => mounted.container.textContent,
  }
}

const isScanning = (running: Running) => /^scanning\|/.test(running.view())

function assertReleased(running: Running, workers = 1, label = 'the scan'): void {
  assert.ok(running.probe.tracks.length > 0, `${label}: a camera was opened`)
  assert.deepEqual(
    running.probe.tracks.map((track) => [track.stopCount, track.readyState]),
    running.probe.tracks.map(() => [1, 'ended']),
    `${label}: every camera track is stopped exactly once`,
  )
  assert.equal(FakeWorker.instances.length, workers, `${label}: ${workers} decode worker(s) were started`)
  assert.deepEqual(FakeWorker.instances.map((worker) => worker.terminateCalls), FakeWorker.instances.map(() => 1), `${label}: every decode worker is terminated exactly once`)
}

/** After a scan ended nothing may keep working: no more frames are read or sent. */
async function assertQuiet(running: Running, detector?: { calls: number[] }): Promise<void> {
  const frames = events.filter((event) => event === 'frame-from-video').length
  const requests = FakeWorker.instances.reduce((sum, worker) => sum + worker.received.length, 0)
  const asked = detector?.calls.length ?? 0
  await settle(120)
  assert.equal(events.filter((event) => event === 'frame-from-video').length, frames, 'no frame is grabbed after the scan ended')
  assert.equal(FakeWorker.instances.reduce((sum, worker) => sum + worker.received.length, 0), requests, 'no frame is sent after the scan ended')
  assert.equal(detector?.calls.length ?? 0, asked, 'the native detector is not asked again')
  assert.equal(running.probe.getUserMediaCalls, running.probe.tracks.length, 'nothing reopened the camera')
}

/** Silences the scanner's own console.error while a test provokes it, and returns what was said. */
async function captureErrors<T>(run: () => Promise<T>): Promise<{ result: T; logged: string[] }> {
  const logged: string[] = []
  const original = console.error
  console.error = (...args: unknown[]) => { logged.push(String(args[0])) }
  try {
    return { result: await run(), logged }
  } finally {
    console.error = original
  }
}

await startStage()
try {
  await runTest('a native read ends the scan: published once, closed once, camera and worker released, loop quiet', async () => {
    stage.liveVideoFrames = true
    const running = await mountProbe('granted', { detector: readingDetector('3348901729222') })
    await waitFor(() => running.detected.length > 0)
    await settle(30)
    assert.deepEqual(running.detected, ['3348901729222'])
    assert.equal(running.closed(), 1)
    assertReleased(running, 1, 'native read')
    assert.equal(FakeWorker.instances[0].received.length, 0, 'a healthy native read never needed the worker')
    await assertQuiet(running)
    await running.mounted.unmount()
    assertReleased(running, 1, 'native read, then unmount')
  })

  await runTest('a worker read ends the scan the same way', async () => {
    stage.liveVideoFrames = true
    queueZxingReads(['3348901729222', '3348901729222'])
    const running = await mountProbe('granted', { native: false })
    await waitFor(() => running.detected.length > 0)
    await settle(30)
    assert.deepEqual(running.detected, ['3348901729222'])
    assert.equal(running.closed(), 1)
    assertReleased(running, 1, 'worker read')
    await assertQuiet(running)
    await running.mounted.unmount()
    assertReleased(running, 1, 'worker read, then unmount')
  })

  await runTest('closing the scanner releases everything and publishes nothing', async () => {
    stage.liveVideoFrames = true
    const { Detector, log } = watchingDetector()
    const running = await mountProbe('granted', { detector: Detector })
    await waitFor(() => isScanning(running))
    await act(async () => { running.camera().closeScanner() })
    assert.equal(running.closed(), 1)
    assert.deepEqual(running.detected, [])
    assertReleased(running, 1, 'close')
    await assertQuiet(running, log)
    await running.mounted.unmount()
    assertReleased(running, 1, 'close, then unmount')
  })

  await runTest('the photo picker releases the camera and parks on "Camera paused" (no stale message), without restarting it', async () => {
    stage.liveVideoFrames = true
    // The fallback path sets a "compatibility mode" message while scanning; parking must not leave it behind.
    const running = await mountProbe('granted', { native: false })
    await waitFor(() => isScanning(running))
    assert.match(running.view(), /\|fallback$/, 'the fallback path does set a message while scanning')
    await act(async () => { running.camera().parkCamera() })
    assertReleased(running, 1, 'photo picker')
    assert.equal(running.view(), 'manual|', 'parked, with no message left over from the run')
    await settle(60)
    assert.equal(running.probe.getUserMediaCalls, 1, 'nothing restarts the camera behind the picker')
    await running.mounted.unmount()
  })

  await runTest('the page being hidden releases the camera, and coming back does not restart it', async () => {
    stage.liveVideoFrames = true
    const { Detector, log } = watchingDetector()
    const running = await mountProbe('granted', { detector: Detector })
    await waitFor(() => isScanning(running))
    setVisibility('hidden')
    await act(async () => { fire('document', 'visibilitychange') })
    assertReleased(running, 1, 'page hidden')
    assert.equal(running.view(), 'manual|')
    await assertQuiet(running, log)
    setVisibility('visible')
    await act(async () => { fire('document', 'visibilitychange') })
    await settle(60)
    assert.equal(running.probe.getUserMediaCalls, 1, 'foregrounding a PWA is not a user gesture: no automatic restart')
    assert.equal(running.view(), 'manual|', 'it waits on the Start camera button')
    await running.mounted.unmount()
  })

  await runTest('pagehide releases the camera and the worker', async () => {
    stage.liveVideoFrames = true
    const running = await mountProbe('granted', { native: false })
    await waitFor(() => isScanning(running))
    await act(async () => { fire('window', 'pagehide') })
    assertReleased(running, 1, 'pagehide')
    await running.mounted.unmount()
  })

  await runTest('revoking the camera permission mid-scan releases everything and shows the blocked state', async () => {
    stage.liveVideoFrames = true
    const { Detector, log } = watchingDetector()
    const running = await mountProbe('granted', { detector: Detector })
    await waitFor(() => isScanning(running))
    assert.ok(running.probe.permission.listeners.length > 0, 'the page watches the permission')
    running.probe.permission.state = 'denied'
    await act(async () => { for (const listener of running.probe.permission.listeners) listener() })
    assertReleased(running, 1, 'permission revoked')
    assert.equal(running.view(), 'blocked|blocked')
    await assertQuiet(running, log)
    await running.mounted.unmount()
  })

  await runTest('unmounting releases everything and removes the page listeners it added', async () => {
    stage.liveVideoFrames = true
    const before = [listenerCount('document', 'visibilitychange'), listenerCount('window', 'pagehide')]
    const running = await mountProbe('granted', { native: false })
    await waitFor(() => isScanning(running))
    assert.deepEqual([listenerCount('document', 'visibilitychange'), listenerCount('window', 'pagehide')], [before[0] + 1, before[1] + 1])
    await running.mounted.unmount()
    assertReleased(running, 1, 'unmount')
    assert.deepEqual([listenerCount('document', 'visibilitychange'), listenerCount('window', 'pagehide')], before, 'no listener outlives the scanner')
  })

  await runTest('restarting stops the first stream and worker before the second starts, and closing then stops the second', async () => {
    stage.liveVideoFrames = true
    const running = await mountProbe('granted', { native: false })
    await waitFor(() => isScanning(running))
    await act(async () => { void running.camera().startCamera() })
    await waitFor(() => isScanning(running) && running.probe.tracks.length === 2)
    assert.equal(running.probe.getUserMediaCalls, 2)
    assert.deepEqual(running.probe.tracks.map((track) => track.stopCount), [1, 0], 'the first stream is stopped, the second is live')
    assert.deepEqual(FakeWorker.instances.map((worker) => worker.terminateCalls), [1, 0], 'and so are the workers')
    await running.mounted.unmount()
    assertReleased(running, 2, 'restart, then unmount')
  })

  await runTest('a decoder that cannot start (no native detector) fails the start but never leaves the camera on', async () => {
    stage.liveVideoFrames = true
    const running = await mountProbe('granted', { native: false }, { mode: 'fails' })
    assert.equal(running.probe.getUserMediaCalls, 1, 'the camera was requested')
    assert.equal(running.view(), 'manual|failed', 'the failure is shown, not a frozen preview')
    assertReleased(running, 1, 'decoder failed to start')
    await running.mounted.unmount()
  })

  await runTest('a camera the user refuses still stops the worker that was started beside the request', async () => {
    const running = await mountProbe('prompt', { native: false, rejectCamera: 'NotAllowedError' })
    assert.equal(running.probe.getUserMediaCalls, 1)
    assert.equal(running.probe.tracks.length, 0, 'no stream was ever opened')
    assert.equal(running.view(), 'dismissed|dismissed')
    assert.equal(FakeWorker.instances.length, 1)
    assert.equal(FakeWorker.instances[0].terminateCalls, 1, 'the worker is not left running behind a refused camera')
    await running.mounted.unmount()
  })

  await runTest('a scan left idle runs at full speed for 15 s, then twice a second, and at 60 s the camera is released into "Camera paused"', async () => {
    // The policy's 15 s and 60 s are run at 1/100 scale; its exact edges are proved by scanIdlePolicy.test.ts.
    const realSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = ((callback: () => void, delay?: number, ...args: unknown[]) => (
      realSetTimeout(callback, delay === 15_000 || delay === 60_000 ? delay / 100 : delay, ...args)
    )) as typeof setTimeout
    try {
      setFrameBudget(100_000)
      stage.liveVideoFrames = true
      const { Detector, log } = watchingDetector()
      const running = await mountProbe('granted', { detector: Detector })
      await waitFor(() => isScanning(running), 40, 5)
      const startedAt = Date.now()
      await waitFor(() => !isScanning(running), 100, 20)
      assert.equal(running.view(), 'manual|', 'paused, as when the page is backgrounded')
      assertReleased(running, 1, 'idle pause')
      // Scaled 1/100: full speed to 150 ms, slow from there, paused at 600 ms. Without the policy the slow
      // window (about 400 ms at a 120 ms cadence) would hold three or four calls.
      const early = log.calls.filter((at) => at - startedAt < 140)
      const slow = log.calls.filter((at) => at - startedAt >= 190)
      assert.ok(early.length >= 1, 'the detector is asked while the scan is fresh')
      assert.ok(slow.length <= 1, `after the pace drops the detector is asked at most every 500 ms, got ${slow.length} calls in the next 400 ms`)
      await assertQuiet(running, log)
      await running.mounted.unmount()
    } finally {
      globalThis.setTimeout = realSetTimeout
    }
  })

  await runTest('the idle clock restarts with the camera: Start camera after a pause is a fresh full-speed run', async () => {
    const realSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = ((callback: () => void, delay?: number, ...args: unknown[]) => (
      realSetTimeout(callback, delay === 15_000 || delay === 60_000 ? delay / 100 : delay, ...args)
    )) as typeof setTimeout
    try {
      setFrameBudget(100_000)
      stage.liveVideoFrames = true
      const { Detector } = watchingDetector()
      const running = await mountProbe('granted', { detector: Detector })
      await waitFor(() => !isScanning(running), 100, 20)
      assert.equal(running.view(), 'manual|')
      await act(async () => { void running.camera().startCamera() })
      await waitFor(() => isScanning(running), 40, 5)
      assert.equal(running.probe.getUserMediaCalls, 2)
      assert.equal(isScanning(running), true, 'scanning again straight after the pause')
      await waitFor(() => !isScanning(running), 100, 20)
      assert.equal(running.probe.tracks.length, 2)
      assert.deepEqual(running.probe.tracks.map((track) => track.stopCount), [1, 1], 'the second run is paused by its own clock, and both streams are stopped once')
      await running.mounted.unmount()
    } finally {
      globalThis.setTimeout = realSetTimeout
    }
  })

  await runTest('a worker that dies mid-scan with no native detector ends the scan with an error and releases the camera', async () => {
    stage.liveVideoFrames = true
    const { logged } = await captureErrors(async () => {
      const running = await mountProbe('granted', { native: false })
      await waitFor(() => isScanning(running))
      await act(async () => { FakeWorker.instances[0].crash('worker crashed') })
      await waitFor(() => !isScanning(running))
      assert.equal(running.view(), 'manual|failed')
      assertReleased(running, 1, 'worker died')
      await running.mounted.unmount()
    })
    assert.ok(logged.some((line) => /ZXing decoder stopped/.test(line)), `the stop is reported, got ${JSON.stringify(logged)}`)
  })

  await runTest('a worker that dies while a native detector is healthy only costs the fallback: native reading carries on', async () => {
    stage.liveVideoFrames = true
    setFrameBudget(100_000)
    const { Detector, log } = watchingDetector()
    const { logged } = await captureErrors(async () => {
      const running = await mountProbe('granted', { detector: Detector })
      await waitFor(() => isScanning(running))
      await act(async () => { FakeWorker.instances[0].crash('worker crashed') })
      await settle(1_150)
      assert.ok(isScanning(running), 'still scanning with the native detector')
      assert.equal(running.probe.tracks[0].stopCount, 0, 'the camera is still on')
      const before = log.calls.length
      await settle(300)
      assert.ok(log.calls.length > before, 'the native detector keeps being asked')
      await running.mounted.unmount()
      assertReleased(running, 1, 'native only after a worker crash')
    })
    assert.ok(logged.some((line) => /ZXing decoder stopped/.test(line)), `the stop is reported once the fallback is wanted, got ${JSON.stringify(logged)}`)
  })

  await runTest('a worker that cannot start while native is healthy is reported and the scan goes on natively', async () => {
    stage.liveVideoFrames = true
    const { Detector, log } = watchingDetector()
    const { logged } = await captureErrors(async () => {
      const running = await mountProbe('granted', { detector: Detector }, { mode: 'fails' })
      assert.ok(isScanning(running))
      assert.ok(log.calls.length > 0)
      await running.mounted.unmount()
    })
    assert.ok(logged.some((line) => /ZXing fallback failed to load; native detection continues/.test(line)))
  })

  await runTest('with the browser\'s video frame callback the loop follows camera frames, and teardown cancels the pending one', async () => {
    stage.liveVideoFrames = true
    stage.videoFrameCallbacks = true
    const { Detector, log } = watchingDetector()
    const running = await mountProbe('granted', { detector: Detector })
    await waitFor(() => log.calls.length > 1)
    assert.ok(stage.videoFrameCallbackCalls > 0, 'frames were requested through requestVideoFrameCallback')
    await running.mounted.unmount()
    assert.ok(stage.videoFrameCallbackCancels >= 1, 'the callback still pending at teardown is cancelled')
    await assertQuiet(running, log)
  })

  await runTest('the worker gets the guide area every frame and the whole picture every third, one frame at a time', async () => {
    stage.liveVideoFrames = true
    setFrameBudget(100_000)
    const running = await mountProbe('granted', { native: false }, { replyDelayMs: 15 })
    await waitFor(() => (FakeWorker.instances[0]?.received.length ?? 0) >= 8, 80, 25)
    const worker = FakeWorker.instances[0]
    const requests = worker.received.slice(0, 8)
    assert.ok(requests.length >= 7, `enough frames were sent, got ${requests.length}`)
    requests.forEach((request, index) => {
      assert.deepEqual([request.centre.width, request.centre.height], [56, 34], `frame ${index}: the guide area (86% x 70% of the 64x48 test video)`)
      if (index % 3 === 0) assert.deepEqual([request.full?.width, request.full?.height], [64, 48], `frame ${index}: every third frame carries the whole picture`)
      else assert.equal(request.full, undefined, `frame ${index}: the others do not`)
      assert.equal(request.tryHarder, false)
    })
    assert.equal(worker.maxOutstanding, 1, 'a frame is never sent while the last is still being decoded')
    const grabs = stage.draws.slice(0, 11)
    assert.ok(grabs.some((draw) => draw.sw === 64 && draw.sh === 48), 'the whole picture was drawn')
    assert.ok(grabs.some((draw) => draw.sw === 56 && draw.sh === 34), 'and the guide area')
    await running.mounted.unmount()
  })
} finally {
  await stopStage()
}

if (failed > 0) process.exitCode = 1
