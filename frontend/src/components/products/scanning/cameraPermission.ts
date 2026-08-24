export type CameraPermissionState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'blocked' | 'unsupported'

type PermissionStatusLike = {
  state?: unknown
  addEventListener?: (type: 'change', listener: () => void) => void
  removeEventListener?: (type: 'change', listener: () => void) => void
}

function normalizeCameraPermissionState(state: unknown): CameraPermissionState {
  const value = String(state || 'unknown')
  return value === 'prompt' || value === 'granted' || value === 'denied'
    ? value
    : 'unknown'
}

async function queryCameraPermission(): Promise<PermissionStatusLike | null> {
  try {
    if (!globalThis.navigator?.permissions?.query) return null
    return await globalThis.navigator.permissions.query({ name: 'camera' as PermissionName }) as PermissionStatusLike
  } catch (_) {
    return null
  }
}

export async function readCameraPermissionState(): Promise<CameraPermissionState> {
  const result = await queryCameraPermission()
  return normalizeCameraPermissionState(result?.state)
}

export async function watchCameraPermission(
  onChange: (state: CameraPermissionState) => void,
): Promise<() => void> {
  const result = await queryCameraPermission()
  if (!result) return () => {}
  const handleChange = () => onChange(normalizeCameraPermissionState(result.state))
  handleChange()
  result.addEventListener?.('change', handleChange)
  return () => result.removeEventListener?.('change', handleChange)
}
