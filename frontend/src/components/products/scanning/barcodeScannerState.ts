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
  stateKind: ScannerStateKind
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
    stateKind,
  }
}
