type ScannerStatus = 'idle' | 'starting' | 'scanning' | 'blocked' | 'dismissed' | 'manual' | string
type ScannerPermissionState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'blocked' | 'unsupported' | string
type ScannerStateKind = 'scanning' | 'starting' | 'blocked' | 'dismissed' | 'manual'

interface ScannerPresentationLabels {
  scanReady?: string
  requestingCamera?: string
  scanUnsupported?: string
  cameraPermissionNeeded?: string
  cameraPaused?: string
  cameraPermissionBlocked?: string
  startCamera?: string
  requestCameraAccess?: string
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
  showResetHint: boolean
  stateKind: ScannerStateKind
}

export type CameraResetPlatform = 'ios' | 'android' | 'desktop'

/** Which steps put a denied camera back to Allow: Settings on an iPhone or iPad, the lock icon beside the address on
 * Android, and the same lock icon in a desktop browser. iPadOS 13+ reports itself as a Mac, told apart by its touch screen. */
export function cameraResetPlatform(userAgent: string, maxTouchPoints = 0): CameraResetPlatform {
  if (/iPhone|iPod|iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'ios'
  return /Android/.test(userAgent) ? 'android' : 'desktop'
}

export function deriveScannerPresentation({
  status = 'idle',
  permissionState = 'unknown',
  labels = {},
  promptDismissedMessage = '',
}: ScannerPresentationInput = {}): ScannerPresentation {
  const requestCameraLabel = permissionState === 'granted'
    ? labels.startCamera
    : permissionState === 'denied' || status === 'dismissed'
      ? labels.tryCameraAgain
      : labels.requestCameraAccess

  const statusMessage = status === 'scanning'
    ? labels.scanReady
    : status === 'starting'
      ? labels.requestingCamera
      : (
          labels.error
          || (
            permissionState === 'unsupported'
              ? labels.scanUnsupported
              : permissionState === 'granted'
                ? labels.requestingCamera
                : labels.cameraPermissionNeeded
          )
        )

  const emptyStateMessage = labels.error || (
    permissionState === 'denied' || permissionState === 'blocked' || status === 'blocked'
      ? labels.cameraPermissionBlocked
      : status === 'dismissed'
        ? promptDismissedMessage
        // Granted + not scanning can only mean a stream that already ran and
        // was released (backgrounded page, photo picker). Opening the scanner
        // goes straight to 'starting', so this is never a first-paint state.
        : permissionState === 'granted'
          ? labels.cameraPaused
          : labels.cameraPermissionNeeded
  )

  const stateKind = status === 'scanning'
    ? 'scanning'
    : status === 'starting'
      ? 'starting'
      : permissionState === 'denied' || permissionState === 'blocked' || status === 'blocked'
        ? 'blocked'
        : status === 'dismissed'
          ? 'dismissed'
          : 'manual'

  return {
    showCameraAction: permissionState !== 'unsupported' && permissionState !== 'blocked' && status !== 'scanning',
    requestCameraLabel,
    statusMessage,
    emptyStateMessage,
    showResetHint: permissionState === 'denied',
    stateKind,
  }
}
