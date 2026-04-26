export function getClientDeviceInfo() {
  const ua = navigator?.userAgent || ''

  let os = 'Unknown'
  if (/Windows NT/i.test(ua)) os = 'Windows'
  else if (/Android/i.test(ua)) os = 'Android'
  else if (/iPhone|iPad/i.test(ua)) os = 'iOS'
  else if (/Mac OS X/i.test(ua)) os = 'macOS'
  else if (/Linux/i.test(ua)) os = 'Linux'

  let browser = 'Browser'
  if (/Edg\//i.test(ua)) browser = 'Edge'
  else if (/Chrome\//i.test(ua)) browser = 'Chrome'
  else if (/Firefox\//i.test(ua)) browser = 'Firefox'
  else if (/Safari\//i.test(ua)) browser = 'Safari'

  return {
    clientTime: new Date().toISOString(),
    deviceTz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    deviceName: `${browser} on ${os}`,
  }
}

export function getClientMetaHeaders() {
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
