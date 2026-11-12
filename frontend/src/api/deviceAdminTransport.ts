import { apiFetch } from './http.ts'

// Admin device-approval endpoints (cloudflare/src/routes/devices.ts,
// mounted at /api/auth/devices). Always online/admin-only: every call goes
// straight to apiFetch, so a stale approval can never be replayed later.

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

// `limit` is the per-account approved-device cap the Worker enforces; the panel shows it instead of a number of its own.
export type DeviceListResponse = { devices: TrustedDeviceRecord[]; limit?: number }

export function getPendingDevices(): Promise<DeviceListResponse> {
  return apiFetch('GET', '/api/auth/devices/pending') as Promise<DeviceListResponse>
}

export function getAllDevices(userId?: string | number): Promise<DeviceListResponse> {
  const query = userId != null ? `?userId=${encodeURIComponent(String(userId))}` : ''
  return apiFetch('GET', `/api/auth/devices${query}`) as Promise<DeviceListResponse>
}

export function approveDevice(id: number | string): Promise<unknown> {
  return apiFetch('POST', `/api/auth/devices/${encodeURIComponent(String(id))}/approve`, {})
}

// At the cap: approve this pending device and revoke one approved device of the same account in one atomic step.
export function approveDeviceReplacing(id: number | string, revokeId: number | string): Promise<{ success?: boolean; revokedSessions?: number }> {
  return apiFetch('POST', `/api/auth/devices/${encodeURIComponent(String(id))}/approve-replacing`, { revokeId: Number(revokeId) }) as Promise<{ success?: boolean; revokedSessions?: number }>
}

export function rejectDevice(id: number | string): Promise<unknown> {
  return apiFetch('POST', `/api/auth/devices/${encodeURIComponent(String(id))}/reject`, {})
}

export function revokeDevice(id: number | string): Promise<unknown> {
  return apiFetch('POST', `/api/auth/devices/${encodeURIComponent(String(id))}/revoke`, {})
}

// Shop devices: a till an administrator marks once, so any active employee signs in there without a separate approval.
export type ShopDeviceRecord = {
  id: number
  device_id: string
  label: string
  marked_by_name: string | null
  marked_at: string
  device_name: string | null
}

export function getShopDevices(): Promise<{ shopDevices: ShopDeviceRecord[] }> {
  return apiFetch('GET', '/api/auth/devices/shop') as Promise<{ shopDevices: ShopDeviceRecord[] }>
}

// :id is the approved device row; the Worker refuses anything else.
export function markShopDevice(id: number | string, label: string): Promise<{ success?: boolean }> {
  return apiFetch('POST', `/api/auth/devices/${encodeURIComponent(String(id))}/mark-shop`, { label }) as Promise<{ success?: boolean }>
}

// Ends the marking and signs out the sessions that came in through it.
export function unmarkShopDevice(shopId: number | string): Promise<{ success?: boolean; revokedSessions?: number }> {
  return apiFetch('POST', `/api/auth/devices/shop/${encodeURIComponent(String(shopId))}/unmark`, {}) as Promise<{ success?: boolean; revokedSessions?: number }>
}

// Reset only removes a rejected trust request. The next authenticated login
// with the same persistent device id starts a new pending approval request.
export function resetDeviceForReapproval(id: number | string): Promise<{ success?: boolean; revokedSessions?: number; nextLoginDeviceStatus?: 'pending' }> {
  return apiFetch('POST', `/api/auth/devices/${encodeURIComponent(String(id))}/reset`, {}) as Promise<{ success?: boolean; revokedSessions?: number; nextLoginDeviceStatus?: 'pending' }>
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
