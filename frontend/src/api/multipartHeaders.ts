import { getClientDeviceInfo } from '../utils/deviceInfo.ts'

export interface MultipartHeaders extends Record<string, string> {
  'bypass-tunnel-reminder': string
  'x-client-time': string
  'x-device-tz': string
  'x-device-name': string
}

export function buildMultipartHeaders(): MultipartHeaders {
  const device = getClientDeviceInfo()
  return {
    'bypass-tunnel-reminder': 'true',
    'x-client-time': device.clientTime || '',
    'x-device-tz': device.deviceTz || '',
    'x-device-name': device.deviceName || '',
  }
}
