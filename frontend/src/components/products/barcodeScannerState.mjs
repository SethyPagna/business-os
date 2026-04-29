export function deriveScannerPresentation({
  status = 'idle',
  permissionState = 'unknown',
  labels = {},
  promptDismissedMessage = '',
} = {}) {
  const requestCameraLabel = permissionState === 'denied' || status === 'dismissed'
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
    permissionState === 'denied' || status === 'blocked'
      ? labels.cameraPermissionBlocked
      : status === 'dismissed'
        ? promptDismissedMessage
        : labels.cameraPermissionNeeded
  )

  const stateKind = status === 'scanning'
    ? 'scanning'
    : status === 'starting'
      ? 'starting'
      : permissionState === 'denied' || status === 'blocked'
        ? 'blocked'
        : status === 'dismissed'
          ? 'dismissed'
          : 'manual'

  return {
    showCameraAction: permissionState !== 'unsupported' && status !== 'scanning',
    requestCameraLabel,
    statusMessage,
    emptyStateMessage,
    stateKind,
  }
}
