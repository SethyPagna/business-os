import { getClientDeviceInfo } from '../utils/deviceInfo.ts'
import { getSyncServerUrl, requireLiveServerWrite } from './http.ts'
import { buildMultipartHeaders, type MultipartHeaders } from './multipartHeaders.ts'

export type ImportPayload = Record<string, unknown>

export { buildMultipartHeaders, type MultipartHeaders }

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
