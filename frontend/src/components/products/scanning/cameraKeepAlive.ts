// iPhone and iPad only: the scanner's camera stream outlives the sheet, paused.
//
// WebKit caches a camera grant in memory per page and drops it about ten minutes
// after the last capture STOPS (Records/Consolidation/2026-10-23/
// RESEARCH-IOS-CAMERA-REPROMPT.md). Stopping every track when the sheet closes
// starts that clock, so a tap a few minutes later asked again. Here the tracks
// are only disabled (no frames) and the stream is kept, so the next tap reuses
// the grant and the camera without a second getUserMedia.
//
// Unverified on a device: whether iOS hides the camera-in-use dot while tracks
// are disabled but not stopped. If it does not, set IOS_CAMERA_PAUSE_ENABLED to
// false; every close then stops the tracks as on Android and desktop.
//
// A parked stream is let go of (tracks stopped) when the page is hidden or
// leaves, after PARKED_CAMERA_IDLE_MS, when any track ends, and when the app
// shell unmounts or signs out (releaseParkedCamera).

export const IOS_CAMERA_PAUSE_ENABLED = true
export const PARKED_CAMERA_IDLE_MS = 5 * 60 * 1000

/** iPhone, iPad and iPod WebKit, including iPadOS asking for the desktop site (a Mac UA with a touch screen). */
export function isIosWebKit(nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> | undefined = globalThis.navigator): boolean {
  if (!nav) return false
  if (/iPhone|iPad|iPod/i.test(nav.userAgent || '')) return true
  return nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1
}

export function shouldPauseOnClose(): boolean {
  return IOS_CAMERA_PAUSE_ENABLED && isIosWebKit()
}

let parked: MediaStream | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let detach: () => void = () => {}

function stopAll(stream: MediaStream): void {
  try {
    stream.getTracks?.().forEach((track) => { if (track.readyState !== 'ended') track.stop() })
  } catch (_) {}
}

/** Stops a parked stream, if any, and forgets it. */
export function releaseParkedCamera(): void {
  const stream = parked
  parked = null
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  detach()
  detach = () => {}
  if (stream) stopAll(stream)
}

function isLive(stream: MediaStream): boolean {
  const tracks = stream.getVideoTracks?.() || []
  return tracks.length > 0 && tracks.every((track) => track.readyState === 'live')
}

/** Pauses `stream` (tracks disabled, not stopped) for the next open. Returns false,
 * having stopped nothing, when it cannot be kept; the caller then stops it. */
export function parkCameraStream(stream: MediaStream): boolean {
  releaseParkedCamera()
  if (!isLive(stream)) return false
  stream.getTracks().forEach((track) => {
    // A torch left lit would stay lit under a paused camera.
    try { void track.applyConstraints?.({ advanced: [{ torch: false } as MediaTrackConstraintSet] })?.catch?.(() => {}) } catch (_) {}
    track.enabled = false
  })
  parked = stream
  idleTimer = setTimeout(releaseParkedCamera, PARKED_CAMERA_IDLE_MS)
  ;(idleTimer as { unref?: () => void }).unref?.()
  const onHidden = () => { if (document.visibilityState === 'hidden') releaseParkedCamera() }
  const tracks = stream.getTracks()
  document.addEventListener?.('visibilitychange', onHidden)
  window.addEventListener?.('pagehide', releaseParkedCamera)
  tracks.forEach((track) => track.addEventListener?.('ended', releaseParkedCamera))
  detach = () => {
    document.removeEventListener?.('visibilitychange', onHidden)
    window.removeEventListener?.('pagehide', releaseParkedCamera)
    tracks.forEach((track) => track.removeEventListener?.('ended', releaseParkedCamera))
  }
  return true
}

/** The paused stream, enabled again, or null when there is none or it died (then
 * it is released and the caller asks for a fresh camera). */
export function takeParkedCameraStream(): MediaStream | null {
  const stream = parked
  if (!stream) return null
  if (!isLive(stream)) {
    releaseParkedCamera()
    return null
  }
  parked = null
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  detach()
  detach = () => {}
  stream.getTracks().forEach((track) => { track.enabled = true })
  return stream
}
