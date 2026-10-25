// iPhone and iPad only, and OFF (6.0.978): the scanner's camera stream outlives the sheet, paused.
//
// WebKit caches a camera grant in memory per page and drops it after the last capture
// STOPS. The idea (6.0.968) was to keep the stream with its tracks disabled so the next
// tap reuses the grant. The WebKit source study (Records/Consolidation/2026-10-25/
// RESEARCH-IOS-CAMERA-INDICATOR.md) shows it cannot work: track.enabled = false only
// flips a flag and never reaches the capture source, so the camera keeps capturing and
// the green in-use indicator stays on. That breaks the owner's hard rule (never leave the
// camera on when the scanner is not showing), and the owner has no iPhone to catch it.
//
// So IOS_CAMERA_PAUSE_ENABLED is false: closing the scanner stops every track at once on
// every platform. The grant survives anyway: 24 h while capture is active, then 10 minutes
// after it stops for a getUserMedia made from a tap (1 minute on iPhone without a tap), so
// a reopen within 10 minutes does not ask. The parking code below stays behind the flag.
//
// A parked stream (flag on) is let go of (tracks stopped) when the page is hidden or
// leaves, after PARKED_CAMERA_IDLE_MS, when any track ends, and when the app
// shell unmounts or signs out (releaseParkedCamera).

export const IOS_CAMERA_PAUSE_ENABLED = false
export const PARKED_CAMERA_IDLE_MS = 5 * 60 * 1000

/** iPhone WebKit refuses the cached grant to a getUserMedia made WITHOUT a tap once capture stopped more than a
 * minute ago (it prompts instead). The page coming back from hidden restarts the camera with no tap, so on iOS it
 * does that only when the page was hidden for less than this (a margin under the 60 s); otherwise the paused panel
 * shows and the person's tap restarts it, with the 10-minute grant window. */
export const IOS_AUTO_RESUME_MAX_HIDDEN_MS = 50 * 1000

/** Whether the camera may restart by itself after the page was hidden for `hiddenMs`. Only iOS WebKit is limited. */
export function shouldAutoResume(hiddenMs: number, nav: Parameters<typeof isIosWebKit>[0] = globalThis.navigator): boolean {
  return !isIosWebKit(nav) || hiddenMs < IOS_AUTO_RESUME_MAX_HIDDEN_MS
}

/** Which one-line permission tip fits a failed start, or null. iOS Safari only (Chrome, Firefox, Edge and Opera on
 * iPhone have no such page menu), and only when the PROMPT WAS DISMISSED: a blocked camera already shows its own
 * red instruction (the Settings line), and a second route beside it would contradict it. A Home Screen app has no
 * per-site setting, so it gets the other line. */
export function iosPermissionTip(
  status: string,
  nav: (Parameters<typeof isIosWebKit>[0] & { standalone?: boolean }) | undefined = globalThis.navigator,
): 'safari' | 'homescreen' | null {
  if (!isIosWebKit(nav)) return null
  if (/CriOS|FxiOS|EdgiOS|OPiOS/i.test(nav?.userAgent || '')) return null
  if (status !== 'dismissed') return null
  return nav?.standalone === true ? 'homescreen' : 'safari'
}

/** iPhone, iPad and iPod WebKit, including iPadOS asking for the desktop site (a Mac UA with a touch screen). */
export function isIosWebKit(nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> | undefined = globalThis.navigator): boolean {
  if (!nav) return false
  if (/iPhone|iPad|iPod/i.test(nav.userAgent || '')) return true
  return nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1
}

/** `enabled` is injectable so both settings of the switch are testable. */
export function shouldPauseOnClose(enabled = IOS_CAMERA_PAUSE_ENABLED, nav: Parameters<typeof isIosWebKit>[0] = globalThis.navigator): boolean {
  return enabled && isIosWebKit(nav)
}

let parked: MediaStream | null = null
// Set by releaseAllParkedCamera (shell unmount, sign-out): React runs a parent's unmount effect before its
// children's, so the scanner under a vanishing shell would otherwise park a stream just after the release.
// Parking stays refused until the scanner is opened again (allowCameraParking).
let parkingRefused = false
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

// A muted track is one the system interrupted: it would show a frozen picture, so it is not reused.
function isLive(stream: MediaStream): boolean {
  const tracks = stream.getVideoTracks?.() || []
  return tracks.length > 0 && tracks.every((track) => track.readyState === 'live' && !track.muted)
}

/** The shell is going away or the person signed out: release now and refuse to park until the next open. */
export function releaseAllParkedCamera(): void {
  parkingRefused = true
  releaseParkedCamera()
}

/** The scanner is being opened by a person: parking is allowed again. */
export function allowCameraParking(): void {
  parkingRefused = false
}

/** Pauses `stream` (tracks disabled, not stopped) for the next open. Returns false,
 * having stopped nothing, when it cannot be kept; the caller then stops it. */
export function parkCameraStream(stream: MediaStream): boolean {
  releaseParkedCamera()
  if (parkingRefused || !isLive(stream)) return false
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
