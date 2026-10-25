// Scanner contract: ONE TAP opens the camera.
//
// Owner rule, 2026-09-14: "for camera I have to click allow and open button
// after clicking the scanner button. instead of clicking button = opening the
// scanner directly."
//
// Why the old two-step flow existed (Part 605, Sep 7 2026, session log): the
// owner had asked that scanning "ask for permission only when needed ... and
// not keep re-prompting", and the wave found that the browser/OS owns the
// "Always allow" choice -- the app cannot grant it. The lane's answer was to
// make every getUserMedia call come from a visible Start/Request camera
// button, so no prompt could ever appear from a mount, a foreground event or a
// re-render. That protected against re-prompting, but it charged every scan a
// second tap even when permission was already granted.
//
// One tap is safe now because the protections moved rather than disappeared:
// the modal is mounted only by a deliberate tap on a scanner button (that tap
// IS the gesture), `open` is the only effect input so a re-render cannot
// restart a stream, and a saved denial still short-circuits before getUserMedia.
//
// Owner, 22 Oct 2026: "make sure that barcode scanner don't ask for allow ... if it
// doesn't load then it asks". That retires the last two asks the Part 605 design
// kept: foregrounding a backgrounded PWA used to park on a Start/Request camera
// button (the camera now starts again by itself, see scannerCameraScenarios), and
// a camera that is merely paused or whose permission the browser cannot report no
// longer shows "We need camera access ... allow". The app's own ask is the Try
// camera again button, and it exists only after a start failed.
//
// The render test at the bottom is the discriminating one: on the pre-change
// source it fails with 0 getUserMedia calls, because the open effect only ran
// prepareScanner.
//
// Since 6.0.935 the camera lifecycle lives in useBarcodeCamera.ts and ZXing runs
// in a worker; the source-shape checks below read the file each piece lives in.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { deriveScannerPresentation } from '../src/components/products/scanning/barcodeScannerState.ts'
import {
  FakeWorker,
  act,
  events,
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

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const labels = {
  scanReady: 'Scan ready',
  requestingCamera: 'Requesting camera',
  cameraPaused: 'Camera paused',
  cameraPermissionBlocked: 'Blocked',
  startCamera: 'Start camera',
  tryCameraAgain: 'Try again',
  error: '',
}

await runTest('deriveScannerPresentation distinguishes scanning and blocked states', () => {
  const scanning = deriveScannerPresentation({ status: 'scanning', permissionState: 'granted', labels, promptDismissedMessage: 'Dismissed' })
  assert.equal(scanning.stateKind, 'scanning')
  assert.equal(scanning.showCameraAction, false)
  assert.equal(scanning.statusMessage, 'Scan ready')

  const blocked = deriveScannerPresentation({ status: 'blocked', permissionState: 'denied', labels, promptDismissedMessage: 'Dismissed' })
  assert.equal(blocked.stateKind, 'blocked')
  assert.equal(blocked.showCameraAction, true)
  assert.equal(blocked.requestCameraLabel, 'Try again')
  assert.equal(blocked.emptyStateMessage, 'Blocked')
})

await runTest('deriveScannerPresentation hides retry when the document itself blocks camera access', () => {
  const blockedByDocument = deriveScannerPresentation({ status: 'blocked', permissionState: 'blocked', labels, promptDismissedMessage: 'Dismissed' })
  assert.equal(blockedByDocument.stateKind, 'blocked')
  assert.equal(blockedByDocument.showCameraAction, false)
  assert.equal(blockedByDocument.emptyStateMessage, 'Blocked')
})

await runTest('deriveScannerPresentation keeps dismissed prompts distinct from hard-denied permissions', () => {
  const dismissed = deriveScannerPresentation({ status: 'dismissed', permissionState: 'prompt', labels, promptDismissedMessage: 'Dismissed' })
  assert.equal(dismissed.stateKind, 'dismissed')
  assert.equal(dismissed.emptyStateMessage, 'Dismissed')
  assert.equal(dismissed.requestCameraLabel, 'Try again')

  // Not scanning and nothing failed can only mean a camera that ran and was released (photo
  // picker, idle pause): "paused", whatever the permissions API says or cannot say. The panel
  // never asks for permission it has not been refused.
  for (const permissionState of ['unknown', 'prompt', 'granted']) {
    const paused = deriveScannerPresentation({ status: 'manual', permissionState, labels, promptDismissedMessage: 'Dismissed' })
    assert.equal(paused.stateKind, 'manual', permissionState)
    assert.equal(paused.emptyStateMessage, 'Camera paused', `${permissionState}: paused, not "we need camera access"`)
    assert.equal(paused.requestCameraLabel, 'Start camera', permissionState)
  }
})

await runTest('a start that failed is the only thing that asks: one line, "Try camera again"', () => {
  for (const permissionState of ['unknown', 'prompt', 'granted']) {
    const failedStart = deriveScannerPresentation({ status: 'manual', permissionState, labels: { ...labels, error: 'Could not start' }, promptDismissedMessage: 'Dismissed' })
    assert.equal(failedStart.emptyStateMessage, 'Could not start', permissionState)
    assert.equal(failedStart.requestCameraLabel, 'Try again', `${permissionState}: never "Start" or "Request access" after a failure`)
    assert.equal(failedStart.stateKind, 'manual', 'a failure that is not a block is neutral')
  }
  const starting = deriveScannerPresentation({ status: 'starting', permissionState: 'unknown', labels, promptDismissedMessage: 'Dismissed' })
  assert.equal(starting.stateKind, 'starting')
  assert.equal(starting.statusMessage, 'Requesting camera', 'a camera that is starting is named for a screen reader and shows nothing else')
  const source = fs.readFileSync(new URL('../src/components/products/scanning/barcodeScannerState.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /cameraPermissionNeeded|requestCameraAccess/, 'the "we need camera access" ask is retired')
})

await runTest('opening the scanner starts the camera itself, and the button survives only for the states that cannot', () => {
  const source = fs.readFileSync(new URL('../src/components/products/scanning/BarcodeScannerModal.tsx', import.meta.url), 'utf8')
  const hook = fs.readFileSync(new URL('../src/components/products/scanning/useBarcodeCamera.ts', import.meta.url), 'utf8')
  const modalSource = fs.readFileSync(new URL('../src/components/shared/Modal.tsx', import.meta.url), 'utf8')
  const searchButtonSource = fs.readFileSync(new URL('../src/components/shared/ScanSearchButton.tsx', import.meta.url), 'utf8')
  assert.match(hook, /const video = await waitForVideoElement\(startToken\)/, 'camera startup must wait for React to commit the video element')
  assert.match(hook, /const regions = grabFrame\(video, video\.videoWidth, video\.videoHeight\)[\s\S]*?client\.decode\(frames, false\)/, 'the compatibility decoder must read frames from the mounted video element we already own and decode them in the worker, never open a camera of its own')

  // WebKit has no BarcodeDetector, so iOS always takes the ZXing branch. The
  // camera request must never wait on the decoder: the worker boots beside it
  // (starting it is not awaited), and only after the camera is open does the
  // fallback wait for the worker to be ready.
  const startBlock = hook.slice(hook.indexOf('const startCamera'), hook.indexOf('const switchCamera'))
  const acquisitions = startBlock.match(/openCamera\(startToken/g) || []
  assert.equal(acquisitions.length, 1, 'both decoders must share ONE camera request')
  const requestBlock = hook.slice(hook.indexOf('async function openCamera'), hook.indexOf('function stopStream'))
  assert.equal((requestBlock.match(/navigator\.mediaDevices\.getUserMedia\(/g) || []).length, 2, 'the request, and its one fallback for a remembered camera that is gone')
  // 6.0.961 (release review c2f27dce6, P3-1): the fallback is a request like any other, so it is made only for a start that is still current
  // (the behaviour is in scannerCameraScenarios.test.ts); the token the start was given is what openCamera is handed.
  assert.match(startBlock, /openCamera\(startToken, \(\) => startTokenRef\.current\)/, 'openCamera is handed the start token and a way to read the current one')
  // 6.0.978: getUserMedia is reached inside the tap. Between the top of startCamera and its first await there is
  // only synchronous work, and the request is in it (the permission read and the <video> wait run beside it).
  const startFn = startBlock.slice(startBlock.indexOf('const startCamera = useCallback'))
  const beforeFirstAwait = startFn.slice(0, startFn.indexOf('await '))
  assert.match(beforeFirstAwait, /openCamera\(startToken/, 'the camera is requested before startCamera awaits anything')
  assert.match(requestBlock, /if \(currentToken\(\) !== startToken\) throw error\s+clearCameraChoice\(\)\s+return navigator\.mediaDevices\.getUserMedia\(CAMERA_CONSTRAINTS\)/, 'the fallback request is skipped, and the saved choice left alone, once the start is over')
  assert.equal((hook.match(/navigator\.mediaDevices\.getUserMedia\(/g) || []).length, 2, 'and no other part of the scanner opens a camera')
  const acquireAt = startBlock.indexOf('openCamera(startToken')
  const chooseDecoderAt = startBlock.indexOf('const NativeBarcodeDetector = getNativeBarcodeDetector()')
  const startWorkerAt = startBlock.indexOf('clientRef.current = openDecodeClient()')
  const waitForWorkerAt = startBlock.indexOf('await client.ready')
  assert.ok(acquireAt > 0 && chooseDecoderAt > acquireAt, 'the camera must be acquired BEFORE the native/fallback decision, not inside one branch')
  assert.ok(startWorkerAt > acquireAt, 'the camera request is made first (inside the tap); the decoder worker boots beside it, after')
  assert.doesNotMatch(startBlock.slice(startWorkerAt - 8, startWorkerAt + 40), /await/, 'starting the worker is never awaited')
  assert.ok(waitForWorkerAt > acquireAt, 'the fallback waits for the worker only after the camera is already open')
  assert.doesNotMatch(source + hook, /decodeFromConstraints\(/, 'decodeFromConstraints hides getUserMedia behind the decoder import; it must not be called again')
  assert.match(hook, /const CAMERA_CONSTRAINTS: MediaStreamConstraints/, 'the shared constraints belong in one hoisted object')
  assert.match(hook, /if \(track\.readyState !== 'ended'\) track\.stop\(\)/, 'cleanup must not stop an ended track again')

  const openEffect = hook.slice(hook.indexOf('const startCameraRef'), hook.indexOf('// iOS can keep a PWA page mounted'))
  const visibilityBlock = hook.slice(hook.indexOf('// iOS can keep a PWA page mounted'), hook.indexOf('void watchCameraPermission'))
  const permissionBlock = hook.slice(hook.indexOf('void watchCameraPermission'), hook.indexOf('return {', hook.indexOf('void watchCameraPermission')))

  // 1. one tap: the open effect is the start trigger
  assert.match(openEffect, /if \(!open\) return undefined[\s\S]*?void startCameraRef\.current\(\)/, 'opening the scanner must start the camera without a second tap')
  assert.match(openEffect, /\}, \[cleanup, open\]\)/, '`open` must be the only input that can start a camera -- a re-render must never restart one')
  assert.match(hook, /useState<ScannerStatus>\(open \? 'starting' : 'idle'\)/, 'the first paint must be the camera shell, not a frame of the old request-access empty state')

  // 2. coming back to the page restarts a camera that was running (no tap, no ask) and nothing else
  assert.doesNotMatch(hook, /prepareScanner/, 'the resume path that parked on a Start camera button is gone')
  // 6.0.961 (release review c2f27dce6, P3-2): "running" means a stream was actually held -- a start whose request is still pending has nothing to resume,
  // and asking again from every return would stack a new request on the one still waiting (the behaviour is in scannerCameraScenarios.test.ts).
  assert.match(visibilityBlock, /const running = statusRef\.current === 'starting' \|\| statusRef\.current === 'scanning'[\s\S]*?resumeOnReturnRef\.current = !detectionHandledRef\.current && \(streamRef\.current !== null \|\| resumeOnReturnRef\.current \|\| resumeStillPending\)/, 'only a camera that was running (a stream held, one a pagehide already released, or a resume still pending) and not already read is remembered')
  assert.match(visibilityBlock, /\} else \{\s*returned\(\)\s*\}/, 'coming back goes through returned(), which restarts it once -- or, on iOS after too long away, leaves the paused panel (6.0.978)')
  assert.match(visibilityBlock, /const returned = \(\) => \{[\s\S]*?if \(!resumeOnReturnRef\.current\) return\s+if \(shouldAutoResume\(hiddenMs\)\) \{\s*resumeOnReturn\(\)\s*return\s*\}\s*resumeOnReturnRef\.current = false\s*parkCamera\(\)/, 'the restart is gated by shouldAutoResume; refusing it parks on the paused panel')
  assert.match(visibilityBlock, /function resumeOnReturn\(\) \{\s*resumeOnReturnRef\.current = false[\s\S]*?if \(requestsInFlightRef\.current > 0\) \{\s*resumeAfterRequestRef\.current = true\s*return\s*\}[\s\S]*?void startCameraRef\.current\(\)/, 'through the guarded start, and never on top of a request that is still unanswered (6.0.966)')
  assert.match(visibilityBlock, /const handlePageHide = \(\) => \{[\s\S]*?resumeOnReturnRef\.current = true[\s\S]*?cleanup\(\)/, 'a pagehide remembers that the camera was running before it lets it go (6.0.966)')
  assert.match(openEffect, /resumeOnReturnRef\.current = false/, 'a newly opened scanner starts with nothing to resume')
  assert.doesNotMatch(permissionBlock, /startCamera\(/, 'permission changes must not auto-start the camera')

  // 3. the explicit button remains for retry/blocked/denied/failed only
  assert.match(source, /\{showCameraAction \? \([\s\S]*?onClick=\{\(\) => startCamera\(\)\}/, 'the retry button stays for the states a mount cannot resolve')
  assert.doesNotMatch(source + hook, /camera_permission_ready/, 'the two-step "start the camera when you are ready" copy is retired')

  assert.match(hook, /const closeScanner[\s\S]*?cleanup\(true\)[\s\S]*?onClose\(\)/, 'closing the scanner must stop (iPhone: pause, see cameraKeepAlive) tracks before dismissing the modal')
  assert.match(hook, /const completeDetection = useCallback\([\s\S]*?detectionHandledRef\.current[\s\S]*?onDetected\(nextValue\)[\s\S]*?finally[\s\S]*?setTimeout\(onClose, closeDelayMs\)/, 'every successful detection must publish once and then close the scanner, after the flash window')
  assert.match(hook, /expectedStartToken\?\: number[\s\S]*?startTokenRef\.current !== expectedStartToken/, 'a stale decoder result must not publish after a new camera start or close')
  assert.match(hook, /const scanToken = startTokenRef\.current[\s\S]*?detector\.detect\(video\)[\s\S]*?startTokenRef\.current !== scanToken/, 'native detection must reject a result from an obsolete camera session')
  assert.match(hook, /client\.decode\(frames, false\)\.then\(\s*\(read\) => \{\s*if \(detectionHandledRef\.current \|\| startTokenRef\.current !== scanToken\) return/, 'a worker result must be dropped when the camera session it came from is over')
  assert.match(source, /handlePhotoSelection[\s\S]*?completeDetection\(nextValue\)/, 'photo barcode results must use the same terminal completion path')
  assert.match(hook, /nextPermissionState === 'denied'[\s\S]*?setStatus\('blocked'\)[\s\S]*?return/, 'a saved browser denial must not trigger another getUserMedia request loop')
  assert.match(hook, /detectionHandledRef\.current = false/, 'a newly opened scanner must be able to complete one fresh result')
  assert.match(hook, /catch \(scanError\) \{[\s\S]*?cleanup\(\)[\s\S]*?setPermissionState\(view\.permission/, 'failed starts must stop partially-open camera tracks before they report')
  assert.match(source, /<Modal[^>]*layer="nested"/, 'the camera dialog must sit above the workflow modal that opened it')
  assert.match(modalSource, /layer === 'nested' \? 'z-\[1070\]' : 'z-\[1050\]'/, 'nested tools must use a higher dialog layer')
  const searchHandler = searchButtonSource.slice(searchButtonSource.indexOf('const handleDetected'), searchButtonSource.indexOf('}, [onDetected])'))
  assert.doesNotMatch(searchHandler, /setOpen\(false\)/, 'the search wrapper must not issue a second close after the modal owns completion')
  // A scan still only FILLS the query -- it never adds or picks anything.
  assert.match(searchHandler, /const trimmed = String\(value \|\| ''\)\.trim\(\)\s*\n\s*if \(trimmed\) onDetected\(trimmed\)/, 'a scan hands the value to the caller\'s search setter and nothing else')
})

await runTest('both scanner entry points warm the modal chunk before the click that needs it', () => {
  const lazyImportSource = fs.readFileSync(new URL('../src/utils/lazyImport.ts', import.meta.url), 'utf8')
  assert.match(lazyImportSource, /export function preloadLazy<T>\(importer: LazyImporter<T>\): \(\) => void/, 'the shared preload helper lives beside lazyRetry')
  assert.match(lazyImportSource, /let started: Promise<unknown> \| null = null[\s\S]*?if \(started\) return/, 'preloading must be idempotent -- four handlers fire per press')

  // The modal calls getUserMedia on mount, so a chunk still downloading after
  // the click spends the gesture's transient-activation window on the network.
  const entryPoints = [
    { name: 'ScanSearchButton', path: '../src/components/shared/ScanSearchButton.tsx' },
    { name: 'ProductForm barcode field', path: '../src/components/products/forms/ProductForm.tsx' },
  ]
  for (const entry of entryPoints) {
    const source = fs.readFileSync(new URL(entry.path, import.meta.url), 'utf8')
    assert.match(source, /import \{ lazyRetry, preloadLazy \}/, `${entry.name} must import the preload helper`)
    assert.match(source, /const importBarcodeScannerModal = \(\) => import\('[^']*scanning\/BarcodeScannerModal'\)/, `${entry.name} must share one importer between lazyRetry and the preload`)
    assert.match(source, /const preloadBarcodeScannerModal = preloadLazy\(importBarcodeScannerModal\)/, `${entry.name} must build its preload from that importer`)
    for (const handler of ['onPointerDown', 'onTouchStart', 'onMouseEnter', 'onFocus']) {
      // pointerdown also starts the engine warm-up (scannerWarmup.ts); the other three only preload the chunk.
      const expected = handler === 'onPointerDown'
        ? 'onPointerDown={() => { preloadBarcodeScannerModal(); warmScanner() }}'
        : `${handler}={preloadBarcodeScannerModal}`
      assert.ok(
        source.includes(expected),
        `${entry.name}'s scanner trigger must warm the chunk on ${handler}, which fires before click`,
      )
    }
  }
})

// --- the discriminating ones: mount it and watch getUserMedia ---------------

// A fake native BarcodeDetector keeps the run on the native path (the harness
// installs one), so the assertion is about getUserMedia and not about ZXing.
const MODAL = '/src/components/products/scanning/BarcodeScannerModal.tsx'

async function mountScanner(
  probePermission: 'granted' | 'prompt' | 'denied',
  options: CameraOptions = {},
  onDetected: (value: string) => void = () => {},
): Promise<{ probe: CameraProbe; text: string; events: string[]; container: MemoryNode; unmount: () => Promise<void> }> {
  const probe = installCamera(probePermission, options)
  const mounted = await mountComponent(MODAL, {
    open: true,
    title: 'Scan barcode',
    onClose() {},
    onDetected,
    t: (key: string) => key,
  })
  return { probe, text: mounted.text, events, container: mounted.container, unmount: mounted.unmount }
}

await startStage()
try {
  await runTest('opening the modal with camera permission available reaches getUserMedia with no second click', async () => {
    const mounted = await mountScanner('granted')
    try {
      assert.equal(mounted.probe.getUserMediaCalls, 1, 'mounting the scanner must request the camera exactly once, with no Start/Request tap')
      assert.ok(findByLabel(mounted.container, 'Point the camera at a barcode.'), 'a granted camera must land on the live scanning view, named for screen readers')
      assert.equal(mounted.text.trim(), '', 'the live view carries no visible text')
      assert.doesNotMatch(mounted.text, /Request camera access|Start camera/, 'a working camera must never be shown a start button first')
    } finally {
      await mounted.unmount()
    }
  })

  await runTest('opening the modal at a prompt permission still reaches getUserMedia once', async () => {
    const mounted = await mountScanner('prompt')
    try {
      assert.equal(mounted.probe.getUserMediaCalls, 1, 'an unanswered permission must be asked from the tap that opened the scanner')
    } finally {
      await mounted.unmount()
    }
  })

  // The iOS path: no BarcodeDetector, so ZXing is unavoidable. What must NOT
  // happen is the camera request waiting behind it.
  await runTest('without a native detector the camera is requested without waiting for the decoder worker, and every track is stopped once', async () => {
    const mounted = await mountScanner('granted', { native: false })
    try {
      assert.equal(mounted.probe.getUserMediaCalls, 1, 'the fallback path must open the camera itself, exactly once')
      const trace = mounted.events.join(' -> ')
      assert.ok(mounted.events.indexOf('worker-created') >= 0 && mounted.events.indexOf('getUserMedia') >= 0 && mounted.events.indexOf('getUserMedia') < mounted.events.indexOf('worker-created'), `the camera is requested first and the worker boots beside it, got: ${trace}`)
      assert.equal(FakeWorker.instances.length, 1, 'one decode worker for the session')

      await mounted.unmount()
      // Closing stops the one stream exactly once; the decoder owns no camera.
      assert.deepEqual(
        mounted.probe.tracks.map((track) => track.stopCount),
        [1],
        `each camera track must be stopped exactly once, got ${JSON.stringify(mounted.probe.tracks.map((track) => track.stopCount))}`,
      )
      assert.equal(FakeWorker.instances[0].terminateCalls, 1, 'the worker ends with the scan')
    } finally {
      await mounted.unmount()
    }
  })

  await runTest('a decoder worker that never answers does not hold the camera back: the stream is open and the view is the camera shell', async () => {
    const probe = installCamera('granted', { native: false })
    FakeWorker.mode = 'never'
    const mounted = await mountComponent(MODAL, { open: true, title: 'Scan barcode', onClose() {}, onDetected() {}, t: (key: string) => key })
    try {
      assert.equal(probe.getUserMediaCalls, 1, 'the camera request must not wait on the decoder')
      assert.equal(probe.tracks.length, 1)
      assert.equal(probe.tracks[0].readyState, 'live', 'the camera is on while the decoder is still starting')
    } finally {
      await mounted.unmount()
    }
    assert.equal(probe.tracks[0].stopCount, 1, 'closing still releases the camera')
  })

  await runTest('opening the modal with a saved denial shows the retry state, leaves no camera on and does not loop', async () => {
    const mounted = await mountScanner('denied')
    try {
      // 6.0.978: the request is made inside the tap, ahead of the denial read; a saved denial is answered at once
      // without a prompt and whatever comes back is stopped.
      assert.ok(mounted.probe.getUserMediaCalls <= 1, 'a saved browser denial is never asked again in a loop')
      assert.ok(mounted.probe.tracks.every((track) => track.readyState === 'ended'), 'and no camera is left on under the block screen')
      assert.equal(FakeWorker.instances.length, 0, 'and must not start a decoder worker it cannot use')
      assert.match(mounted.text, /lock icon in the address bar/, 'a blocked camera must explain itself (one line of steps) instead of showing a blank video')
      assert.match(mounted.text, /Try camera again/, 'the explicit retry button survives exactly for this state')
    } finally {
      await mounted.unmount()
    }
  })

  function findByLabel(node: MemoryNode, label: string): MemoryNode | null {
    if (node.getAttribute?.('aria-label') === label) return node
    for (const child of node.childNodes) {
      const found = findByLabel(child, label)
      if (found) return found
    }
    return null
  }

  async function press(node: MemoryNode): Promise<void> {
    const propsKey = Object.keys(node).find((key) => key.startsWith('__reactProps$')) as keyof MemoryNode
    const props = node[propsKey] as unknown as { onClick: () => void }
    await act(async () => {
      props.onClick()
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }

  await runTest('the camera asks for 1080p and turns on continuous focus when the track offers it', async () => {
    const mounted = await mountScanner('granted', { capabilities: { focusMode: ['manual', 'continuous'] } })
    try {
      const video = (mounted.probe.requested[0] as { video: { width: { ideal: number }; height: { ideal: number } } }).video
      assert.equal(video.width.ideal, 1920, 'thin bars need a 1080p frame where the camera has one')
      assert.equal(video.height.ideal, 1080)
      assert.deepEqual(mounted.probe.applied, [{ advanced: [{ focusMode: 'continuous' }] }])
      assert.equal(findByLabel(mounted.container, 'Turn on flashlight'), null, 'no torch button for a track without a torch')
    } finally {
      await mounted.unmount()
    }
  })

  await runTest('the flashlight toggle appears only for a torch track and reflects what the camera accepted', async () => {
    const mounted = await mountScanner('granted', { capabilities: { torch: true } })
    try {
      const button = findByLabel(mounted.container, 'Turn on flashlight')
      assert.ok(button, 'a torch-capable track gets the icon toggle')
      assert.equal(button.getAttribute('title'), 'Turn on flashlight', 'icon-only buttons carry a tooltip')
      assert.equal(button.getAttribute('aria-pressed'), 'false')
      await press(button)
      assert.deepEqual(mounted.probe.applied, [{ advanced: [{ torch: true }] }])
      const lit = findByLabel(mounted.container, 'Turn off flashlight')
      assert.ok(lit, 'once the camera accepts, the toggle offers to turn it off')
      assert.equal(lit.getAttribute('aria-pressed'), 'true')
    } finally {
      await mounted.unmount()
    }

    const refused = await mountScanner('granted', { capabilities: { torch: true }, rejectTorch: true })
    try {
      const button = findByLabel(refused.container, 'Turn on flashlight')
      assert.ok(button)
      await press(button)
      assert.equal(button.getAttribute('aria-pressed'), 'false', 'a refused torch must not show as on')
      assert.match(refused.container.textContent, /The flashlight could not be switched\./, 'a refused torch says so')
    } finally {
      await refused.unmount()
    }
  })

  await runTest('ZXing reads frames from our video in the worker and needs two agreeing, checksum-valid reads', async () => {
    stage.liveVideoFrames = true
    queueZxingReads(['3348901729223', '4006381333931', '3348901729222', '3348901729222'])
    const detected: string[] = []
    const mounted = await mountScanner('granted', { native: false }, (value) => detected.push(value))
    try {
      await waitFor(() => detected.length > 0)
      const trace = mounted.events.join(' -> ')
      assert.deepEqual(detected, ['3348901729222'], `a bad check digit and a lone read must both lose to two agreeing reads, got ${JSON.stringify(detected)}: ${trace}`)
      assert.ok(mounted.events.includes('frame-from-video'), `frames must come from the scanner's own video element, got: ${trace}`)
      assert.equal(mounted.probe.getUserMediaCalls, 1)
      const worker = FakeWorker.instances[0]
      assert.ok(worker.received.length >= 3, `every frame was decoded by the worker, got ${worker.received.length}`)
      assert.ok(worker.received.every((request, index) => request.id === index + 1 && request.tryHarder === false), 'one request per frame, in order, never TRY_HARDER on the live loop')
      assert.equal(worker.terminateCalls, 1, 'the worker is stopped by the detection that ends the scan')
    } finally {
      stage.liveVideoFrames = false
      await mounted.unmount()
    }
  })

  // --- S1a (6.0.922): which engine runs, which native result wins ------------

  await runTest('a native detector that reads none of our formats is never built: ZXing starts at once and reads', async () => {
    stage.liveVideoFrames = true
    queueZxingReads(['3348901729222', '3348901729222'])
    let constructed = 0
    let detectCalls = 0
    class QrOnlyDetector {
      static async getSupportedFormats(): Promise<string[]> { return ['qr_code'] }
      constructor() { constructed += 1 }
      async detect(): Promise<unknown[]> { detectCalls += 1; return [] }
    }
    const detected: string[] = []
    const mounted = await mountScanner('granted', { detector: QrOnlyDetector }, (value) => detected.push(value))
    try {
      await waitFor(() => detected.length > 0)
      assert.deepEqual(detected, ['3348901729222'], `ZXing must read straight away, got ${JSON.stringify(detected)}: ${mounted.events.join(' -> ')}`)
      assert.equal(constructed, 0, 'a detector with no retail format must not be built with the retail list anyway')
      assert.equal(detectCalls, 0, 'and must never be asked to detect')
    } finally {
      stage.liveVideoFrames = false
      await mounted.unmount()
    }
  })

  await runTest('a native detector that lists retail formats gets only those, and the worker gets no frame while it is healthy', async () => {
    stage.liveVideoFrames = true
    let requestedFormats: string[] = []
    let detectCalls = 0
    class RetailDetector {
      static async getSupportedFormats(): Promise<string[]> { return ['qr_code', 'ean_13', 'data_matrix'] }
      constructor(options: { formats: string[] }) { requestedFormats = options.formats }
      async detect(): Promise<unknown[]> { detectCalls += 1; return [] }
    }
    const mounted = await mountScanner('granted', { detector: RetailDetector })
    try {
      await waitFor(() => detectCalls > 0)
      await settle(150)
      assert.deepEqual(requestedFormats, ['ean_13'])
      assert.ok(detectCalls > 0, 'the native detector is the first engine')
      assert.equal(FakeWorker.instances[0]?.received.length ?? 0, 0, `ZXing must wait out its head start, got: ${mounted.events.join(' -> ')}`)
    } finally {
      stage.liveVideoFrames = false
      await mounted.unmount()
    }
  })

  await runTest('the code inside the guide wins over the first code the detector lists, and is emitted as read', async () => {
    stage.liveVideoFrames = true
    performance.clearMarks()
    class TwoCodeDetector {
      static async getSupportedFormats(): Promise<string[]> { return ['ean_13', 'upc_a'] }
      async detect(): Promise<unknown[]> {
        // The fake video is 64x48 and has no layout, so the guide is 86% x 70% of the frame: x 4..60, y 7..41.
        return [
          { rawValue: '4006381333931', format: 'ean_13', boundingBox: { x: 0, y: 0, width: 2, height: 2 } },
          { rawValue: '036000291452', format: 'upc_a', boundingBox: { x: 20, y: 15, width: 20, height: 10 } },
        ]
      }
    }
    const detected: string[] = []
    const mounted = await mountScanner('granted', { detector: TwoCodeDetector }, (value) => detected.push(value))
    try {
      await waitFor(() => detected.length > 0)
      assert.deepEqual(detected, ['036000291452'], 'the second code sits in the guide and is the one the person aimed at; UPC-A is not padded to EAN-13')
      const startOf = (step: string) => performance.getEntriesByName(`scanner:${step}`)[0]?.startTime
      assert.ok(startOf('stream') !== undefined && startOf('decoder-ready') !== undefined && startOf('read') !== undefined, 'stream, decoder-ready and read are all marked')
      assert.ok(startOf('stream') <= startOf('decoder-ready') && startOf('decoder-ready') <= startOf('read'), 'in that order')
    } finally {
      stage.liveVideoFrames = false
      await mounted.unmount()
    }
  })

  await runTest('the camera is asked for 30 fps alongside the 1080p request', async () => {
    const mounted = await mountScanner('granted')
    try {
      const video = (mounted.probe.requested[0] as { video: { frameRate: unknown } }).video
      assert.deepEqual(video.frameRate, { ideal: 30 }, '30 fps is a preference, never a hard limit that can stop the camera opening')
    } finally {
      await mounted.unmount()
    }
  })
} finally {
  await stopStage()
}

await runTest('branch transfer exposes the shared icon scanner in single and multi-product searches', () => {
  const source = fs.readFileSync(new URL('../src/components/branches/TransferModal.tsx', import.meta.url), 'utf8')
  const mainCss = fs.readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
  assert.match(source, /import ScanSearchButton from ['"]\.\.\/shared\/ScanSearchButton\.tsx['"]/)
  assert.match(
    source,
    /const handleTransferProductScan = useCallback\([\s\S]*?setShowSelectedOnly\(false\)[\s\S]*?setShowAllProducts\(false\)[\s\S]*?setSearch\(barcode\)/,
    'a scan must become the transfer picker query and reset filters that could hide it',
  )
  const scannerUses = source.match(/<ScanSearchButton\b[\s\S]*?onDetected=\{handleTransferProductScan\}[\s\S]*?\/>/g) || []
  assert.equal(scannerUses.length, 2, 'single and multi transfer searches must both keep scanner access')
  const focusedProductSearches = source.match(/placeholder=\{t\('search_products_placeholder'\)[\s\S]*?autoFocus[\s\S]*?autoComplete="off"/g) || []
  assert.equal(focusedProductSearches.length, 2, 'both transfer product searches must take scanner-keyboard focus')
  assert.doesNotMatch(source, /<ScanSearchButton\s+onDetected=\{setSearch\}/, 'transfer scans must not use an unscoped generic search setter')
  assert.match(source, /items-end justify-center[^\"]*sm:items-center/, 'small screens should use a bottom sheet while larger screens center the dialog')
  assert.match(source, /modal-viewport-safe/, 'transfer dialog should use the shared safe-area viewport layer')
  assert.match(mainCss, /\.modal-viewport-safe[\s\S]*safe-area-inset-bottom/, 'the shared transfer layer should stay above the mobile safe area')
})

await runTest('stock workflow scanners stay inside their active product picker', () => {
  // Add, Remove and Set are one Stock Session since UI-STOCK-3 (the separate
  // Change-stock form is retired); its line entry owns the scanner.
  const stockInSource = fs.readFileSync(new URL('../src/components/inventory/FastStockInModal.tsx', import.meta.url), 'utf8')
  const lineEntrySource = fs.readFileSync(new URL('../src/components/stock-session/StockSessionLineEntry.tsx', import.meta.url), 'utf8')
  const ledgerSource = fs.readFileSync(new URL('../src/components/products/StockChangeSection.tsx', import.meta.url), 'utf8')

  assert.match(lineEntrySource, /<ScanSearchButton onDetected=\{onScan\}/, 'the session line entry owns its scanner')
  assert.match(
    stockInSource,
    /onScan=\{\(value\) => \{[\s\S]*?setQuery\(barcode\)[\s\S]*?setScannedBarcode\(barcode\)/,
    'every mode keeps barcode lookup in the session query and exact-scan state',
  )

  assert.match(ledgerSource, /const stockWorkflowOpen = fastStockInOpen/)
  assert.match(ledgerSource, /const blurLedgerSearch = useCallback\([\s\S]*?activeElement\.blur\(\)/)
  assert.match(ledgerSource, /const openFastStockIn = useCallback\(\(nextMode: StockMode = 'add'\) => \{\s*blurLedgerSearch\(\)/)
  assert.match(ledgerSource, /<SearchInput id="stock-ledger-search"[^>]*disabled=\{stockWorkflowOpen\}/)
  assert.match(
    ledgerSource,
    /\{!stockWorkflowOpen \? <ScanSearchButton onDetected=\{setSearch\}/,
    'Stock Change History scanner must be unavailable while a stock workflow owns scanning',
  )
})

await runTest('remaining product search surfaces expose controlled icon-only scanners', () => {
  const surfaces = [
    {
      name: 'branch stock',
      path: '../src/components/branches/Branches.tsx',
      importPath: '../shared/ScanSearchButton.tsx',
      // The per-branch search is its own component since 6.0.934 (a scanner-gun hook cannot run inside the
      // map): the camera hands the code to the component's onChange, which the page binds to the typed handler.
      wiring: /<ScanSearchButton onDetected=\{onChange\}[\s\S]*<BranchStockSearch[\s\S]*?onChange=\{\(value\) => handleBranchStockSearchChange\(branch\.id, value\)\}/,
    },
    {
      name: 'supplier return product picker',
      path: '../src/components/returns/NewSupplierReturnModal.tsx',
      importPath: '../shared/ScanSearchButton.tsx',
      wiring: /onDetected=\{setSearch\}/,
    },
    {
      name: 'product duplicates filter',
      path: '../src/components/products/ProductDuplicatesTab.tsx',
      importPath: '../shared/ScanSearchButton.tsx',
      wiring: /onDetected=\{setSearch\}/,
    },
    {
      name: 'promotion per-product picker',
      path: '../src/components/promotions/PromotionsPage.tsx',
      importPath: '../shared/ScanSearchButton.tsx',
      wiring: /onDetected=\{setProductQuery\}/,
    },
    {
      name: 'promotion rule product picker',
      path: '../src/components/promotions/PromotionsPage.tsx',
      importPath: '../shared/ScanSearchButton.tsx',
      wiring: /onDetected=\{setPickerQuery\}/,
    },
    {
      name: 'product import conflict search',
      path: '../src/components/products/import/ProductImportConflictsModal.tsx',
      importPath: '../../shared/ScanSearchButton.tsx',
      wiring: /onDetected=\{\(value\) => \{ setQuery\(value\); setPage\(1\) \}\}/,
    },
  ]

  const sourceByPath = new Map<string, string>()
  for (const surface of surfaces) {
    const source = sourceByPath.get(surface.path)
      || fs.readFileSync(new URL(surface.path, import.meta.url), 'utf8')
    sourceByPath.set(surface.path, source)
    assert.ok(
      source.includes(`import ScanSearchButton from '${surface.importPath}'`),
      `${surface.name} must import the shared scanner button`,
    )
    assert.match(source, surface.wiring, `${surface.name} must write the scan into its controlled query`)
  }

  for (const [path, source] of sourceByPath) {
    const scannerUses = source.match(/<ScanSearchButton\b[\s\S]*?\/>/g) || []
    assert.ok(scannerUses.length > 0, `${path} must render at least one scanner button`)
    for (const use of scannerUses) {
      assert.doesNotMatch(use, /\bshowLabel\b/, `${path} product search scanners must remain icon-only`)
    }
  }
})

if (failed > 0) {
  process.exitCode = 1
}
