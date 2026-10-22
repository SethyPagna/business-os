type ScannerStatus = 'idle' | 'starting' | 'scanning' | 'blocked' | 'dismissed' | 'manual' | string
type ScannerPermissionState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'blocked' | 'unsupported' | string
type ScannerStateKind = 'scanning' | 'starting' | 'blocked' | 'dismissed' | 'manual'

interface ScannerPresentationLabels {
  scanReady?: string
  requestingCamera?: string
  cameraPaused?: string
  cameraPermissionBlocked?: string
  startCamera?: string
  tryCameraAgain?: string
  error?: string
}

interface ScannerPresentationInput {
  status?: ScannerStatus
  permissionState?: ScannerPermissionState
  labels?: ScannerPresentationLabels
  promptDismissedMessage?: string
}

interface ScannerPresentation {
  showCameraAction: boolean
  requestCameraLabel?: string
  statusMessage?: string
  emptyStateMessage?: string
  stateKind: ScannerStateKind
}

export type CameraResetPlatform = 'ios' | 'android' | 'desktop'

/** Which steps put a denied camera back to Allow: Settings on an iPhone or iPad, the lock icon beside the address on
 * Android, and the same lock icon in a desktop browser. iPadOS 13+ reports itself as a Mac, told apart by its touch screen. */
export function cameraResetPlatform(userAgent: string, maxTouchPoints = 0): CameraResetPlatform {
  if (/iPhone|iPod|iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'ios'
  return /Android/.test(userAgent) ? 'android' : 'desktop'
}

// The sheet asks for nothing before the camera has been tried: opening it starts
// the camera, and a camera that ran and was released (idle pause, photo picker)
// is "paused", whatever the permissions API says. The app's own ask -- a Try
// camera again button, with the reason above it -- exists only after a start
// failed: dismissed, denied, or any other error.
export function deriveScannerPresentation({
  status = 'idle',
  permissionState = 'unknown',
  labels = {},
  promptDismissedMessage = '',
}: ScannerPresentationInput = {}): ScannerPresentation {
  const blocked = permissionState === 'denied' || permissionState === 'blocked' || status === 'blocked'
  const startFailed = blocked || status === 'dismissed' || Boolean(labels.error)
  const requestCameraLabel = startFailed ? labels.tryCameraAgain : labels.startCamera

  // The words a screen reader gives the live view; the other states are told by emptyStateMessage.
  const statusMessage = status === 'scanning' ? labels.scanReady : labels.requestingCamera

  const emptyStateMessage = labels.error || (
    blocked
      ? labels.cameraPermissionBlocked
      : status === 'dismissed'
        ? promptDismissedMessage
        : labels.cameraPaused
  )

  const stateKind = status === 'scanning'
    ? 'scanning'
    : status === 'starting'
      ? 'starting'
      : blocked
        ? 'blocked'
        : status === 'dismissed'
          ? 'dismissed'
          : 'manual'

  return {
    showCameraAction: permissionState !== 'unsupported' && permissionState !== 'blocked' && status !== 'scanning',
    requestCameraLabel,
    statusMessage,
    emptyStateMessage,
    stateKind,
  }
}
