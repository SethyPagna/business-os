export interface ClientDeviceInfo {
  clientTime: string
  deviceTz: string | null
  deviceName: string
}

export type ClientMetaHeaders = Partial<{
  'x-client-time': string
  'x-device-tz': string
  'x-device-name': string
}>

function getBrowserName(userAgent: string): string {
  if (/Edg\//i.test(userAgent)) return 'Edge'
  if (/Chrome\//i.test(userAgent)) return 'Chrome'
  if (/Firefox\//i.test(userAgent)) return 'Firefox'
  if (/Safari\//i.test(userAgent)) return 'Safari'
  return 'Browser'
}

function getOperatingSystemName(userAgent: string): string {
  if (/Windows NT/i.test(userAgent)) return 'Windows'
  if (/Android/i.test(userAgent)) return 'Android'
  if (/iPhone|iPad/i.test(userAgent)) return 'iOS'
  if (/Mac OS X/i.test(userAgent)) return 'macOS'
  if (/Linux/i.test(userAgent)) return 'Linux'
  return 'Unknown'
}

export function getClientDeviceInfo(): ClientDeviceInfo {
  const ua = globalThis.navigator?.userAgent || ''
  const os = getOperatingSystemName(ua)
  const browser = getBrowserName(ua)

  return {
    clientTime: new Date().toISOString(),
    deviceTz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    deviceName: `${browser} on ${os}`,
  }
}

export function getClientMetaHeaders(): ClientMetaHeaders {
  try {
    const device = getClientDeviceInfo()
    return {
      'x-client-time': device.clientTime || '',
      'x-device-tz': device.deviceTz || '',
      'x-device-name': device.deviceName || '',
    }
  } catch (_) {
    return {}
  }
}
