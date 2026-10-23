// The scanner's camera: acquiring it, reading frames from it, and letting go of
// it on every way a scan can end. The modal only draws what this reports.
//
// Reading is split across threads. The browser's native BarcodeDetector is
// already off-thread, so it stays here and reads the <video> itself. ZXing runs
// in the decode worker: this hook grabs the area the on-screen guide outlines
// (and, every third frame, the whole picture), transfers the pixels, and keeps
// one frame in flight.

import { useCallback, useEffect, useRef, useState } from 'react'
import { isCameraBlockedByDocumentPolicy, isInAppBrowser } from './cameraPolicy.ts'
import { readCameraPermissionState, watchCameraPermission, type CameraPermissionState } from './cameraPermission.ts'
import { classifyCameraFailure, type CameraFailure } from './cameraFailure.ts'
import {
  NATIVE_TICK_INTERVAL_MS,
  SCAN_GUIDE_BOX,
  createFrameGrabber,
  createReadConfirmer,
  guideRectInFrame,
  pickNativeRead,
  planNativeFormats,
  viewOf,
  zxingHeadStartOver,
} from './barcodeFrameDecoder.ts'
import { clearCameraChoice, listCameras, nextCameraId, readCameraChoice, saveCameraChoice, withRememberedCamera } from './cameraChoice.ts'
import { acquireDecodeClient, type DecodeClient, type DecodeFrames } from './decodeWorkerClient.ts'
import { createScanIdlePolicy, scanIntervalMs } from './scanIdlePolicy.ts'
import {
  getNativeBarcodeDetector,
  markScanner,
  nativeSupportedFormats,
  type NativeBarcodeDetector,
} from './scannerWarmup.ts'

// One constraints object for both decoders. The native BarcodeDetector loop and
// the ZXing fallback open the SAME camera from the SAME single getUserMedia
// call, so hoisting this keeps that one acquisition obvious at a glance.
const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    // Thin bars on a small box need pixels; `ideal` lets a camera that cannot
    // do 1080p fall back to its best mode instead of failing.
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    // 30 fps is all either decoder can use; a camera left at 60 only heats up.
    // Ideal only: a hard max would make a camera that cannot go down to 30 fps refuse to open.
    frameRate: { ideal: 30 },
  },
}

// The worker gets the guide area on every frame and the whole picture on every
// third: the guide is where the person aims, the rest rescues a code that sits
// outside it.
const FULL_FRAME_EVERY = 3

export type ScannerStatus = 'idle' | 'starting' | 'scanning' | 'blocked' | 'dismissed' | 'manual'

/** The words the camera layer puts in `error`; the modal owns the translations. */
export interface CameraMessages {
  scanUnsupported: string
  cameraDocumentBlocked: string
  cameraPermissionBlocked: string
  cameraBusy: string
  scanFailed: string
  scanPromptDismissed: string
}

// What each kind of failed start leaves on the sheet: one line (from the
// modal's messages) and the state that decides the one action beside it. A
// block is the only red; a camera that cannot be retried (no camera, a view
// that forbids it) leaves the photo as the action.
const FAILURE_VIEW: Record<CameraFailure, { status: ScannerStatus; permission: CameraPermissionState | null; message: keyof CameraMessages }> = {
  'document-blocked': { status: 'blocked', permission: 'blocked', message: 'cameraDocumentBlocked' },
  blocked: { status: 'blocked', permission: 'denied', message: 'cameraPermissionBlocked' },
  dismissed: { status: 'dismissed', permission: null, message: 'scanPromptDismissed' },
  'no-camera': { status: 'manual', permission: 'unsupported', message: 'scanUnsupported' },
  busy: { status: 'manual', permission: null, message: 'cameraBusy' },
  failed: { status: 'manual', permission: null, message: 'scanFailed' },
}

interface UseBarcodeCameraOptions {
  open: boolean
  messages: CameraMessages
  onDetected: (value: string) => void
  onClose: () => void
  /** How long after an accepted read `onClose` waits, so the sheet's flash is seen. Closing by hand is never delayed. */
  closeDelayMs?: number
}

// Torch and focus are not in the DOM lib's track types yet.
type CameraTrackCapabilities = MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] }
type CameraConstraintSet = MediaTrackConstraintSet & { torch?: boolean; focusMode?: string }

function getScanErrorText(error: unknown): string {
  const source = error as { message?: unknown; name?: unknown } | null | undefined
  return `${String(source?.name || '')} ${String(source?.message || error || '')}`
}

/** The one camera request of a scan. A remembered camera is asked for as a
 * preference, which cannot fail; but older WebKit has rejected an unknown
 * deviceId anyway, so a camera that has gone is forgotten and the default one
 * opened, without the person ever hearing about it. The second request is a
 * request like any other: if the start it belongs to was closed or replaced
 * while the first one was pending (`startToken` is no longer the current one),
 * it is not made at all -- the camera would otherwise switch on, and on an
 * iPhone ask again, after the sheet is gone. The first error is rethrown and
 * the caller, seeing the stale token, says nothing. */
async function openCamera(startToken: number, currentToken: () => number): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(withRememberedCamera(CAMERA_CONSTRAINTS))
  } catch (error) {
    if (!readCameraChoice() || !/OverconstrainedError|ConstraintNotSatisfiedError/i.test(getScanErrorText(error))) throw error
    // A superseded start also leaves the saved choice alone: a newer start may already have chosen another camera.
    if (currentToken() !== startToken) throw error
    clearCameraChoice()
    return navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
  }
}

function stopStream(stream: MediaStream | null | undefined): void {
  try {
    // Skip tracks that already ended, so "each track is stopped exactly once"
    // is a property a test can assert instead of a hope.
    stream?.getTracks?.().forEach((track) => { if (track.readyState !== 'ended') track.stop() })
  } catch (_) {}
}

/** Calls `callback` for the next frame the video presents (one per camera frame
 * where the browser can say so, otherwise per screen refresh); returns the
 * function that cancels it. */
function onNextFrame(video: HTMLVideoElement, callback: () => void): () => void {
  if (typeof video.requestVideoFrameCallback === 'function') {
    const id = video.requestVideoFrameCallback(() => callback())
    return () => video.cancelVideoFrameCallback(id)
  }
  const id = requestAnimationFrame(() => callback())
  return () => cancelAnimationFrame(id)
}

function openDecodeClient(): DecodeClient | null {
  try {
    return acquireDecodeClient()
  } catch (error) {
    console.error('[scanner] The ZXing decoder is unavailable; relying on native detection.', error)
    return null
  }
}

export function useBarcodeCamera({ open, messages, onDetected, onClose, closeDelayMs = 0 }: UseBarcodeCameraOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const cancelFrameRef = useRef<(() => void) | null>(null)
  const detectorRef = useRef<NativeBarcodeDetector | null>(null)
  const clientRef = useRef<DecodeClient | null>(null)
  const idleRef = useRef<ReturnType<typeof createScanIdlePolicy> | null>(null)
  const framesSentRef = useRef(0)
  const nativeStartedAtRef = useRef(0)
  const confirmReadRef = useRef(createReadConfirmer())
  const [grabFrame] = useState(() => createFrameGrabber(SCAN_GUIDE_BOX))
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const permissionCleanupRef = useRef<() => void>(() => {})
  const startTokenRef = useRef(0)
  const startSequenceRef = useRef(0)
  const detectionHandledRef = useRef(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextScanAtRef = useRef(0)
  // The page was hidden while the camera ran: coming back starts it again by itself.
  const resumeOnReturnRef = useRef(false)
  // The start that came back from a hide (not a tap, not the open). While its request is pending the page may
  // be hidden again: that start was a camera that was running, so it still counts as one.
  const nextStartIsResumeRef = useRef(false)
  const resumeTokenRef = useRef(0)
  // Camera requests this hook has made and not yet seen answered, however stale their start became.
  const requestsInFlightRef = useRef(0)
  // The page came back while such a request was still unanswered: asking again would stack a second prompt, so
  // the resume waits for that answer (settleRequest) and asks once then.
  const resumeAfterRequestRef = useRef(false)
  const startCameraRef = useRef<() => Promise<void>>(async () => {})
  // Seeded from `open` rather than 'idle': the modal is only ever mounted by
  // the tap on a scanner button, and that tap already starts the camera (see
  // the open effect). An 'idle' first frame would flash the paused-camera
  // empty state for one paint before the effect flips it to 'starting' --
  // exactly the two-step screen the owner asked to remove.
  const [status, setStatus] = useState<ScannerStatus>(open ? 'starting' : 'idle')
  const statusRef = useRef<ScannerStatus>('idle')
  const [error, setError] = useState('')
  const [permissionState, setPermissionState] = useState<CameraPermissionState>('unknown')
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [torchFailed, setTorchFailed] = useState(false)
  const [readOk, setReadOk] = useState(false)
  const [cameraCount, setCameraCount] = useState(0)
  // The front camera is shown as a mirror, as a selfie view is. Only the picture on screen flips; the frames the
  // decoders read are the camera's own, so a printed code is never read back to front.
  const [mirrored, setMirrored] = useState(false)

  useEffect(() => { statusRef.current = status }, [status])

  const waitForVideoElement = useCallback(async (startToken: number): Promise<HTMLVideoElement | null> => {
    // `setStatus('starting')` causes React to mount the <video>. On iOS the
    // permission request can resolve before that render commits, so capturing
    // videoRef synchronously leaves ZXing with null and the native path with a
    // stream that is never attached. Wait for the committed element instead.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (startTokenRef.current !== startToken) return null
      if (videoRef.current) return videoRef.current
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
    return null
  }, [])

  const cleanup = useCallback((): void => {
    startTokenRef.current = 0
    cancelFrameRef.current?.()
    cancelFrameRef.current = null
    idleRef.current?.stop()
    idleRef.current = null
    clientRef.current?.terminate()
    clientRef.current = null
    stopStream(streamRef.current)
    streamRef.current = null
    trackRef.current = null
    detectorRef.current = null
    framesSentRef.current = 0
    nativeStartedAtRef.current = 0
    confirmReadRef.current = createReadConfirmer()
    setTorchAvailable(false)
    setTorchOn(false)
    setTorchFailed(false)
    const video = videoRef.current
    if (video) {
      try { video.pause() } catch (_) {}
      try { video.srcObject = null } catch (_) {}
    }
  }, [])

  // Releases the camera and parks on the Start camera button: the photo picker
  // took over, the scan sat idle too long, or the page was hidden (which starts
  // it again by itself on return). `error` is cleared so the panel says "Camera
  // paused", not whatever the last run left there.
  const parkCamera = useCallback((): void => {
    cleanup()
    setError('')
    setStatus('manual')
  }, [cleanup])

  // Native BarcodeDetector, ZXing, photo decode, and manual entry can finish
  // at different times. Make successful detection one guarded terminal path
  // so a stale callback cannot publish twice or survive a newer camera run.
  const completeDetection = useCallback((value: unknown, expectedStartToken?: number): void => {
    const nextValue = String(value || '').trim()
    if (!nextValue || detectionHandledRef.current) return
    if (expectedStartToken !== undefined && startTokenRef.current !== expectedStartToken) return
    detectionHandledRef.current = true
    markScanner('read')
    cleanup()
    setReadOk(true)
    try {
      onDetected(nextValue)
    } finally {
      closeTimerRef.current = setTimeout(onClose, closeDelayMs)
    }
  }, [cleanup, closeDelayMs, onClose, onDetected])

  // Sends one frame to the worker, unless the last one is still being decoded.
  // A ZXing read must agree twice in a row (createReadConfirmer) and EAN/UPC
  // must pass the check digit, so a smudged frame cannot pick the wrong product.
  const decodeInWorker = useCallback((video: HTMLVideoElement, scanToken: number): void => {
    const client = clientRef.current
    if (!client || !client.isReady || client.busy) return
    let frames: DecodeFrames
    try {
      const regions = grabFrame(video, video.videoWidth, video.videoHeight)
      frames = {
        centre: regions.centre(),
        full: framesSentRef.current % FULL_FRAME_EVERY === 0 ? regions.full() : undefined,
      }
    } catch (grabError) {
      console.error('[scanner] A camera frame could not be read.', grabError)
      return
    }
    framesSentRef.current += 1
    client.decode(frames, false).then(
      (read) => {
        if (detectionHandledRef.current || startTokenRef.current !== scanToken) return
        const accepted = confirmReadRef.current(read, 'zxing')
        if (accepted) completeDetection(accepted, scanToken)
      },
      (decodeError) => {
        if (startTokenRef.current !== scanToken) return
        if (!client.broken) {
          console.error('[scanner] ZXing frame decode failed.', decodeError)
          return
        }
        console.error('[scanner] The ZXing decoder stopped.', decodeError)
        if (clientRef.current === client) clientRef.current = null
        client.terminate()
        // Without a native detector there is nothing left to read with.
        if (!detectorRef.current) {
          cleanup()
          setStatus('manual')
          setError(messages.scanFailed)
        }
      },
    )
  }, [cleanup, completeDetection, grabFrame, messages.scanFailed])

  // One loop for both decoders. Native BarcodeDetector reads are trusted on
  // their own (the one inside the guide wins over another code on the box);
  // ZXing frames go to the worker. Both emit the code exactly as read: search
  // folds leading zeros and UPC-A/EAN-13, so folding here would fold twice.
  const scanFrame = useCallback(async (): Promise<void> => {
    const detector = detectorRef.current
    const video = videoRef.current
    const scanToken = startTokenRef.current
    if (!video || !scanToken || detectionHandledRef.current) return

    const now = Date.now()
    if (video.readyState >= 2 && video.videoWidth > 0 && now >= nextScanAtRef.current) {
      nextScanAtRef.current = now + scanIntervalMs(idleRef.current?.pace() ?? 'full', detector ? NATIVE_TICK_INTERVAL_MS : 0)
      let accepted: string | null = null
      if (detector) {
        try {
          const results = await detector.detect(video)
          if (detectionHandledRef.current || startTokenRef.current !== scanToken) return
          const guide = guideRectInFrame(video.videoWidth, video.videoHeight, viewOf(video), SCAN_GUIDE_BOX)
          accepted = confirmReadRef.current(pickNativeRead(results || [], guide), 'native')
        } catch (_) {
          // A frame the detector cannot read yet (still decoding, resized)
          // is a miss like any other; the next tick tries again.
        }
      }
      // Some Android BarcodeDetector builds never see a low-contrast foil
      // code; after a fixed head start the ZXing worker joins in.
      if (!accepted && (!detector || zxingHeadStartOver(nativeStartedAtRef.current, Date.now()))) {
        decodeInWorker(video, scanToken)
      }
      if (accepted) {
        completeDetection(accepted, scanToken)
        return
      }
    }

    if (detectionHandledRef.current || startTokenRef.current !== scanToken) return
    cancelFrameRef.current = onNextFrame(video, scanFrame)
  }, [completeDetection, decodeInWorker])

  const toggleTorch = useCallback(async (): Promise<void> => {
    const track = trackRef.current
    if (!track) return
    const next = !torchOn
    setTorchFailed(false)
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as CameraConstraintSet] })
      if (trackRef.current === track) setTorchOn(next)
    } catch (_) {
      if (trackRef.current === track) setTorchFailed(true)
    }
  }, [torchOn])

  const beginScanning = useCallback((video: HTMLVideoElement): void => {
    markScanner('decoder-ready')
    setStatus('scanning')
    idleRef.current = createScanIdlePolicy(parkCamera)
    idleRef.current.start()
    cancelFrameRef.current = onNextFrame(video, scanFrame)
  }, [parkCamera, scanFrame])

  // The answer to a request whose start was already over has arrived (its stream, if any, is stopped). If the page
  // came back meanwhile and a camera that was running is waiting for it, ask now: exactly one request is open.
  const settleRequest = useCallback((): void => {
    if (!resumeAfterRequestRef.current || requestsInFlightRef.current > 0 || startTokenRef.current !== 0) return
    resumeAfterRequestRef.current = false
    if (detectionHandledRef.current) return
    if (document.visibilityState === 'hidden') {
      // Gone again before the answer: the intent waits for the next return.
      resumeOnReturnRef.current = true
      return
    }
    nextStartIsResumeRef.current = true
    void startCameraRef.current()
  }, [])

  const startCamera = useCallback(async (): Promise<void> => {
    const startToken = ++startSequenceRef.current
    resumeAfterRequestRef.current = false
    resumeOnReturnRef.current = false
    if (nextStartIsResumeRef.current) resumeTokenRef.current = startToken
    nextStartIsResumeRef.current = false
    cleanup()
    startTokenRef.current = startToken
    setStatus('starting')
    setError('')
    nextScanAtRef.current = 0

    if (
      typeof window === 'undefined' ||
      !navigator?.mediaDevices?.getUserMedia
    ) {
      setPermissionState('unsupported')
      setStatus('manual')
      setError(messages.scanUnsupported)
      return
    }

    if (isCameraBlockedByDocumentPolicy()) {
      setPermissionState('blocked')
      setStatus('blocked')
      setError(messages.cameraDocumentBlocked)
      return
    }

    const nextPermissionState = await readCameraPermissionState()
    setPermissionState(nextPermissionState)

    // Re-requesting cannot repair a saved browser denial. Stay blocked until
    // the user changes the site setting, avoiding a getUserMedia retry loop.
    if (nextPermissionState === 'denied') {
      cleanup()
      setStatus('blocked')
      setError(messages.cameraPermissionBlocked)
      return
    }

    try {
      const video = await waitForVideoElement(startToken)
      if (!video || startTokenRef.current !== startToken) return
      video.setAttribute('playsinline', 'true')

      // The worker boots (its script, then ZXing) while the camera permission
      // and the first frame are still pending. Starting it is not awaited: the
      // camera never waits behind the decoder.
      clientRef.current = openDecodeClient()

      // The camera is acquired FIRST, before either decoder is chosen. WebKit
      // ships no BarcodeDetector, so on iOS this used to fall through to
      // decodeFromConstraints, which reaches getUserMedia only AFTER awaiting
      // the 446 KB ZXing chunk -- the prompt arrived a download later than the
      // tap that asked for it. One acquisition, immediately after the tap, on
      // every browser.
      requestsInFlightRef.current += 1
      let stream: MediaStream
      try {
        stream = await openCamera(startToken, () => startTokenRef.current)
      } finally {
        requestsInFlightRef.current -= 1
      }
      if (startTokenRef.current !== startToken) {
        stopStream(stream)
        settleRequest()
        return
      }
      markScanner('stream')
      // Owned from here on: every later bail-out is a token change, and a token
      // only changes through cleanup() (or a newer startCamera, which calls
      // cleanup() first), which stops this stream. A throw lands in the catch
      // below, which calls cleanup() before it does anything slow -- so a
      // decoder that fails to start can never leave the camera light on.
      streamRef.current = stream
      setPermissionState('granted')
      const [track] = stream.getVideoTracks?.() || []
      trackRef.current = track || null
      const capabilities = (track?.getCapabilities?.() || {}) as CameraTrackCapabilities
      setTorchAvailable(capabilities.torch === true)
      setMirrored(track?.getSettings?.().facingMode === 'user')
      // Cameras can only be listed with names once permission is granted, which it now is.
      void listCameras().then((cameras) => { if (startTokenRef.current === startToken) setCameraCount(cameras.length) })
      if (capabilities.focusMode?.includes('continuous')) {
        // Best effort: a camera that refuses keeps its default focus, which is
        // how every scan worked before this hint existed.
        track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as CameraConstraintSet] }).catch(() => {})
      }
      video.srcObject = stream
      await video.play()
      if (startTokenRef.current !== startToken) return

      // The warm-up the opening press started (scannerWarmup) has usually
      // settled this already; otherwise this is the first and only ask.
      const NativeBarcodeDetector = getNativeBarcodeDetector()
      const nativeFormats = NativeBarcodeDetector ? planNativeFormats(await nativeSupportedFormats()) : []
      if (startTokenRef.current !== startToken) return
      const client = clientRef.current
      if (NativeBarcodeDetector && nativeFormats.length) {
        detectorRef.current = new NativeBarcodeDetector({ formats: nativeFormats })
        nativeStartedAtRef.current = Date.now()
        // Only the fallback: a worker that fails to start must not stop native reads.
        client?.ready.catch((workerError) => {
          console.error('[scanner] ZXing fallback failed to load; native detection continues.', workerError)
        })
        beginScanning(video)
        return
      }

      // No native detector, or one that reads none of our formats: ZXing in
      // the worker reads frames this hook grabs from the video element, so
      // it never opens a camera of its own (that would put the permission
      // prompt behind the decoder).
      if (!client) throw new Error('The barcode decoder is unavailable.')
      await client.ready
      if (startTokenRef.current !== startToken) return
      beginScanning(video)
    } catch (scanError) {
      // A start that was closed or replaced has nothing left to report; this also keeps the AbortError
      // video.play() throws when its stream is released from being read as a busy camera.
      if (startTokenRef.current !== startToken) {
        // A resume that waited for this answer is dropped when the answer was a refusal: no loop on denial.
        const refused = classifyCameraFailure(getScanErrorText(scanError), { permissionDenied: false, inAppBrowser: false })
        if (refused === 'blocked' || refused === 'dismissed') resumeAfterRequestRef.current = false
        settleRequest()
        return
      }
      cleanup()
      // What the browser holds NOW: tapping Block on this very request is a saved denial from here on,
      // and the person should be told so at once, not after a second try.
      const permissionAfter = await readCameraPermissionState()
      if (startSequenceRef.current !== startToken) return
      const failure = classifyCameraFailure(getScanErrorText(scanError), {
        permissionDenied: permissionAfter === 'denied',
        inAppBrowser: isInAppBrowser(navigator.userAgent || ''),
      })
      const view = FAILURE_VIEW[failure]
      setPermissionState(view.permission ?? permissionAfter)
      setStatus(view.status)
      setError(messages[view.message])
    }
  }, [
    beginScanning,
    cleanup,
    // The lines FAILURE_VIEW can pick, listed one by one so a parent re-render with the same words keeps this callback's identity.
    messages.cameraBusy,
    messages.cameraDocumentBlocked,
    messages.cameraPermissionBlocked,
    messages.scanFailed,
    messages.scanPromptDismissed,
    messages.scanUnsupported,
    settleRequest,
    waitForVideoElement,
  ])

  // Moves on to the next camera the device lists and remembers it. The camera is reopened from scratch (the same
  // path as a retry), so every guard on a new start applies.
  const switchCamera = useCallback(async (): Promise<void> => {
    const cameras = await listCameras()
    const nextId = nextCameraId(cameras.map((camera) => camera.deviceId), trackRef.current?.getSettings?.().deviceId)
    if (!nextId || cameras.length < 2) return
    saveCameraChoice(nextId)
    await startCamera()
  }, [startCamera])

  const closeScanner = useCallback((): void => {
    detectionHandledRef.current = true
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    cleanup()
    onClose()
  }, [cleanup, onClose])

  /** A photo that could not be read: the camera stays released and the message shows. */
  const showManualError = useCallback((message: string): void => {
    setStatus('manual')
    setError(message)
  }, [])

  const clearError = useCallback((): void => setError(''), [])

  // `startCamera` takes a new identity whenever the parent re-renders, because
  // its messages close over the caller's `t`. Read it through a ref so `open` is
  // the ONLY thing that can trigger a start: a parent re-render must never
  // restart a live stream mid-scan, which with a one-tap start would read as a
  // camera that keeps re-prompting.
  useEffect(() => { startCameraRef.current = startCamera }, [startCamera])

  useEffect(() => {
    if (!open) return undefined
    detectionHandledRef.current = false
    resumeOnReturnRef.current = false
    resumeAfterRequestRef.current = false
    setReadOk(false)
    // Owner rules (2026-09-14, 2026-10-22): pressing the scanner button opens
    // the camera directly, and an allowed camera is never asked for again. The
    // request happens here instead of behind a "Start camera" tap; the guards
    // inside startCamera (unsupported, document policy, saved denial) still
    // decide whether getUserMedia is reached at all, and a browser that has to
    // ask shows its own prompt. Only a start that FAILED shows the app's own
    // ask (the Try camera again button).
    void startCameraRef.current()
    return () => {
      detectionHandledRef.current = true
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
      cleanup()
      setStatus('idle')
      setError('')
      setPermissionState('unknown')
    }
  }, [cleanup, open])

  // iOS can keep a PWA page mounted while it is backgrounded. Stop every
  // camera track the moment the page is hidden (the system's recording dot and
  // the lock-screen prompt both depend on it), and start the camera again when
  // the page comes back. That needs no tap: the Media Capture spec asks for no
  // user gesture, and a muted video with no audio track plays without one. If
  // the browser refuses anyway, startCamera lands on the Try camera again
  // button. Only a camera that was running comes back, so a failure, a block or
  // the idle pause stays exactly as it was. "Running" means a stream was actually
  // held: a start whose request is still pending (the browser's prompt is up, or
  // a system dialog hid the page) has nothing to resume, and asking again from
  // every return would stack a new prompt on the one still waiting. That request
  // is let go of here (parkCamera drops the start's token), so if it is answered
  // later the stream it brings is stopped on arrival and the sheet shows the
  // paused panel, one tap from a camera that is by then allowed.
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        const running = statusRef.current === 'starting' || statusRef.current === 'scanning'
        if (running) {
          // A camera that was running: a stream is held, or a pagehide already let it go (the status still says
          // running), or the start in flight is itself a resume. A first request that never produced a camera is none.
          const resumeStillPending = resumeTokenRef.current !== 0 && startTokenRef.current === resumeTokenRef.current
          resumeOnReturnRef.current = !detectionHandledRef.current && (streamRef.current !== null || resumeOnReturnRef.current || resumeStillPending)
          parkCamera()
        } else if (!resumeAfterRequestRef.current) {
          resumeOnReturnRef.current = false
        }
      } else if (resumeOnReturnRef.current) {
        resumeOnReturn()
      }
    }
    // The camera comes back by itself. A request still unanswered from before is waited for, never doubled.
    function resumeOnReturn() {
      resumeOnReturnRef.current = false
      if (detectionHandledRef.current) return
      if (requestsInFlightRef.current > 0) {
        resumeAfterRequestRef.current = true
        return
      }
      nextStartIsResumeRef.current = true
      void startCameraRef.current()
    }
    // The page leaving lets the camera go at once and remembers that it was running, so coming back (a visible page,
    // or a page restored from the back-forward cache) starts it again.
    const handlePageHide = () => {
      const running = statusRef.current === 'starting' || statusRef.current === 'scanning'
      if (running && streamRef.current !== null && !detectionHandledRef.current) resumeOnReturnRef.current = true
      cleanup()
    }
    const handlePageShow = () => {
      if (resumeOnReturnRef.current && document.visibilityState !== 'hidden') resumeOnReturn()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('pageshow', handlePageShow)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [cleanup, open, parkCamera])

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    void watchCameraPermission((nextState) => {
      if (cancelled) return
      if (isCameraBlockedByDocumentPolicy()) {
        cleanup()
        setPermissionState('blocked')
        setStatus('blocked')
        setError(messages.cameraDocumentBlocked)
        return
      }
      // A browser with no camera API still answers the permission query; that answer must not turn "this
      // browser cannot scan" back into a camera button that can never work.
      setPermissionState((current) => (current === 'unsupported' ? current : nextState))
      if (nextState === 'denied' && (statusRef.current === 'scanning' || statusRef.current === 'starting')) {
        cleanup()
        setStatus('blocked')
        setError(messages.cameraPermissionBlocked)
      }
    }).then((dispose: (() => void) | undefined) => {
      if (cancelled) {
        dispose?.()
        return
      }
      permissionCleanupRef.current = dispose || (() => {})
    })
    return () => {
      cancelled = true
      permissionCleanupRef.current?.()
      permissionCleanupRef.current = () => {}
    }
  }, [cleanup, messages.cameraDocumentBlocked, messages.cameraPermissionBlocked, open])

  return {
    videoRef,
    status,
    error,
    permissionState,
    torchAvailable,
    torchOn,
    torchFailed,
    readOk,
    cameraCount,
    mirrored,
    startCamera,
    switchCamera,
    toggleTorch,
    closeScanner,
    parkCamera,
    completeDetection,
    showManualError,
    clearError,
  }
}
