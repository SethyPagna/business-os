import { STORAGE_KEYS } from '../constants.ts'

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

// Persisted, random device identifier used by the admin device-approval
// security feature (see cloudflare/src/lib/deviceTrust.ts). Generated
// once per browser and stored in localStorage -- deliberately NOT tied to
// anything derivable from the user agent, IP, or other fingerprintable
// signal, since those can collide across different physical devices
// (same browser/OS combo) or change on the same device (IP roaming),
// either of which would make the approval feature meaningless. A cleared
// browser/incognito/other-browser simply becomes a new "device" requiring
// its own approval -- the safe failure mode for a security feature like
// this (never falsely trusting an unrecognized session), not a bug.
//
// This key is deliberately always preserved across logout (see
// platform/runtime/clientRuntime.ts's resetClientRuntimeState, which now
// keeps STORAGE_KEYS.DEVICE_ID unconditionally) -- an approved *device*
// approval is a property of the physical browser/device, not of any one
// login session, so signing out and back in on the same device must not
// forget it.
const DEVICE_ID_STORAGE_KEY = STORAGE_KEYS.DEVICE_ID

function randomDeviceId(): string {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  } catch (_) {
    // fall through to the manual fallback below
  }
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function getOrCreatePersistentDeviceId(): string {
  try {
    const existing = globalThis.localStorage?.getItem(DEVICE_ID_STORAGE_KEY)
    if (existing) return existing
    const created = randomDeviceId()
    globalThis.localStorage?.setItem(DEVICE_ID_STORAGE_KEY, created)
    return created
  } catch (_) {
    // localStorage unavailable (private mode edge cases, SSR, etc.) --
    // fall back to a per-call id rather than throwing. Login will simply
    // need approval again next time, same as any other new device.
    return randomDeviceId()
  }
}
