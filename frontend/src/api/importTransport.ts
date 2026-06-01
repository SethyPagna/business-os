import { getClientDeviceInfo } from '../utils/deviceInfo.ts'
import { getSyncServerUrl, requireLiveServerWrite } from './http.ts'

export type ImportPayload = Record<string, unknown>

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

export function withImportDeviceInfo<TPayload extends ImportPayload | null | undefined>(
  payload: TPayload = {} as TPayload,
): ImportPayload {
  return { ...(payload || {}), ...getClientDeviceInfo() }
}

export async function apiFormPost(
  path: string,
  form: FormData,
  channel = 'importJobs:upload',
): Promise<unknown> {
  requireLiveServerWrite(channel, {
    offlineMessage: 'Server is offline. Imports need the live server so large files can be processed safely.',
    notConfiguredMessage: 'Server is not connected. Imports need a live server.',
  })
  const base = getSyncServerUrl().replace(/\/$/, '')
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: buildMultipartHeaders(),
    credentials: 'include',
    body: form,
  })
  const text = await res.text()
  let json: { data?: unknown; error?: string } | null = null
  try { json = text ? JSON.parse(text) : null } catch (_) {}
  if (!res.ok) throw new Error(json?.error || text || `HTTP ${res.status}`)
  return json?.data || json
}
