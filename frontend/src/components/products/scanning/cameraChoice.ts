// Which camera this device scans with. A phone or a till tablet on a stand is
// switched once and stays switched: the choice lives in this browser's
// localStorage under a key logout does not clear (it is the device's, not the
// cashier's). Storage can be blocked or full, so every access is wrapped and a
// failure just means the default camera.

const CAMERA_CHOICE_KEY = 'business-os-scanner-camera-v1'

export function readCameraChoice(): string | null {
  try {
    return window.localStorage.getItem(CAMERA_CHOICE_KEY) || null
  } catch (_) {
    return null
  }
}

export function saveCameraChoice(deviceId: string): void {
  try {
    window.localStorage.setItem(CAMERA_CHOICE_KEY, deviceId)
  } catch (_) {
    // The switch still applies to this scan; it is only not remembered.
  }
}

/** Forgets the remembered camera, for when it can no longer be opened. */
export function clearCameraChoice(): void {
  try {
    window.localStorage.removeItem(CAMERA_CHOICE_KEY)
  } catch (_) {
    // Nothing was stored that could be cleared.
  }
}

/** The constraints with the remembered camera asked for instead of "the back one".
 * `ideal`, not `exact`: a camera that was unplugged since falls back to the default instead of failing the scan. */
export function withRememberedCamera(constraints: MediaStreamConstraints): MediaStreamConstraints {
  const deviceId = readCameraChoice()
  if (!deviceId || typeof constraints.video !== 'object') return constraints
  const { facingMode: _backCamera, ...video } = constraints.video
  return { ...constraints, video: { ...video, deviceId: { ideal: deviceId } } }
}

/** The video inputs this device has; empty when the browser cannot list them. */
export async function listCameras(): Promise<MediaDeviceInfo[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((device) => device.kind === 'videoinput')
  } catch (_) {
    return []
  }
}

/** The camera after `currentId` in the list, wrapping round; the first one when the current one is not listed. */
export function nextCameraId(cameraIds: readonly string[], currentId: string | undefined): string | null {
  if (!cameraIds.length) return null
  return cameraIds[(cameraIds.indexOf(currentId ?? '') + 1) % cameraIds.length]
}
