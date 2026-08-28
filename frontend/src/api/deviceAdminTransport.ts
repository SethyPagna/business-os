import { apiFetch } from './http.ts'

// Admin device-approval endpoints (cloudflare/src/routes/devices.ts,
// mounted at /api/auth/devices). Always online/admin-only -- unlike most
// of api/*, this deliberately does NOT go through route()'s
// offline-outbox dispatcher: approving a device from a phone with no
// connectivity isn't a meaningful offline action, and queuing it would
// just let a stale approval silently replay later.

export type TrustedDeviceRecord = {
  id: number
  user_id: number
  device_id: string
  device_name: string | null
  user_agent: string | null
  first_ip: string | null
  last_ip: string | null
  status: 'pending' | 'approved' | 'rejected'
  requested_at: string
  decided_at: string | null
  decided_by_name: string | null
  last_seen_at: string
  username: string
  user_name: string
}

export function getPendingDevices(): Promise<{ devices: TrustedDeviceRecord[] }> {
  return apiFetch('GET', '/api/auth/devices/pending') as Promise<{ devices: TrustedDeviceRecord[] }>
}

export function getAllDevices(userId?: string | number): Promise<{ devices: TrustedDeviceRecord[] }> {
  const query = userId != null ? `?userId=${encodeURIComponent(String(userId))}` : ''
  return apiFetch('GET', `/api/auth/devices${query}`) as Promise<{ devices: TrustedDeviceRecord[] }>
}

export function approveDevice(id: number | string): Promise<unknown> {
  return apiFetch('POST', `/api/auth/devices/${encodeURIComponent(String(id))}/approve`, {})
}

export function rejectDevice(id: number | string): Promise<unknown> {
  return apiFetch('POST', `/api/auth/devices/${encodeURIComponent(String(id))}/reject`, {})
}

export function revokeDevice(id: number | string): Promise<unknown> {
  return apiFetch('POST', `/api/auth/devices/${encodeURIComponent(String(id))}/revoke`, {})
}

// ---- Live sessions (J3) ----------------------------------------------------
// A device row answers "may a future login from this device pass?"; a live
// session row is a login that already happened and is still valid. Same
// admin-only, online-only reasoning as the device calls above.

export type LiveSessionRecord = {
  id: number
  user_id: number
  device_id: string | null
  device_name: string | null
  device_tz: string | null
  user_agent: string | null
  last_ip: string | null
  created_at: string
  last_seen_at: string | null
  expires_at: string
  username: string
  user_name: string
}

export function getLiveSessions(userId?: string | number): Promise<{ sessions: LiveSessionRecord[] }> {
  const query = userId != null ? `?userId=${encodeURIComponent(String(userId))}` : ''
  return apiFetch('GET', `/api/auth/devices/sessions${query}`) as Promise<{ sessions: LiveSessionRecord[] }>
}

export function revokeLiveSession(id: number | string): Promise<unknown> {
  return apiFetch('POST', `/api/auth/devices/sessions/${encodeURIComponent(String(id))}/revoke`, {})
}

export function revokeAllUserSessions(userId: number | string): Promise<{ success?: boolean; revoked?: number }> {
  return apiFetch('POST', '/api/auth/devices/sessions/revoke-user', { userId }) as Promise<{ success?: boolean; revoked?: number }>
}
