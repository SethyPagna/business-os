// Per-request client metadata. The persistent device id and its IndexedDB copy live in deviceIdentity.ts: http.ts imports this file, so everything here loads
// with the public storefront, and the sign-in identity code is only needed after the login screen (the catalog-products budget in performanceBudgets.test.ts).
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

// Browser APIs deliberately do not expose a reliable desktop hardware model.
// Keep the stable browser/OS label, but include the model family where the
// user agent genuinely provides one (mainly phones/tablets). This is display
// metadata for an administrator's approval decision, never a device key.
function getDeviceModelLabel(userAgent: string): string | null {
  const android = userAgent.match(/Android[^;]*;[^;]*;\s*([^;)]+?)(?:\s+Build\/|[;)])/i)
  if (android?.[1]) return android[1].trim()
  if (/iPad/i.test(userAgent)) return 'iPad'
  if (/iPhone/i.test(userAgent)) return 'iPhone'
  return null
}

export function getClientDeviceInfo(): ClientDeviceInfo {
  const ua = globalThis.navigator?.userAgent || ''
  const os = getOperatingSystemName(ua)
  const browser = getBrowserName(ua)
  const model = getDeviceModelLabel(ua)

  return {
    clientTime: new Date().toISOString(),
    deviceTz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    deviceName: `${browser} on ${os}${model ? ` (${model})` : ''}`,
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
