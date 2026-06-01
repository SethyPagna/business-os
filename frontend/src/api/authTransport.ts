import { getClientDeviceInfo } from '../utils/deviceInfo.ts'
import { apiFetch } from './http.ts'

type AuthPayload = Record<string, unknown>

export type LoginPayload = AuthPayload & {
  username?: string
  password?: string
  organization?: string
  sessionDuration?: string | number
  clientTime?: string
  deviceTz?: string
  deviceName?: string
}

export function login({
  username,
  password,
  organization,
  sessionDuration,
  clientTime,
  deviceTz,
  deviceName,
}: LoginPayload): Promise<unknown> {
  const device = getClientDeviceInfo()
  return apiFetch('POST', '/api/auth/login', {
    username,
    password,
    organization,
    sessionDuration,
    clientTime: clientTime || device.clientTime || '',
    deviceTz: deviceTz || device.deviceTz || '',
    deviceName: deviceName || device.deviceName || '',
  })
}

export function logout(): Promise<unknown> {
  return apiFetch('POST', '/api/auth/logout', {})
}

export function resetPasswordWithOtp(payload: AuthPayload = {}): Promise<unknown> {
  return apiFetch('POST', '/api/auth/password-reset/otp', payload || {})
}

export function requestPasswordResetEmail(payload: AuthPayload = {}): Promise<unknown> {
  return apiFetch('POST', '/api/auth/password-reset/email', payload || {})
}

export function completePasswordReset(payload: AuthPayload = {}): Promise<unknown> {
  return apiFetch('POST', '/api/auth/password-reset/complete', payload || {})
}

export function updateSessionDuration(payload: AuthPayload = {}): Promise<unknown> {
  return apiFetch('POST', '/api/auth/session-duration', { ...getClientDeviceInfo(), ...(payload || {}) })
}

export function getVerificationCapabilities(): Promise<unknown> {
  return apiFetch('GET', '/api/auth/verification-capabilities')
}

export function startGoogleOauth(payload: AuthPayload = {}): Promise<unknown> {
  return apiFetch('POST', '/api/auth/oauth/start', payload || {})
}

export function completeGoogleOauth(payload: AuthPayload = {}): Promise<unknown> {
  return apiFetch('POST', '/api/auth/oauth/complete', payload || {})
}

export function unlinkGoogleOauth(payload: AuthPayload = {}): Promise<unknown> {
  return apiFetch('POST', '/api/auth/oauth/unlink', payload || {})
}

export function getOrganizationBootstrap(): Promise<unknown> {
  return apiFetch('GET', '/api/organizations/bootstrap')
}

export function searchOrganizations(query: string): Promise<unknown> {
  const q = encodeURIComponent(String(query || '').trim())
  return apiFetch('GET', `/api/organizations/search${q ? `?q=${q}` : ''}`)
}

export function getCurrentOrganization(): Promise<unknown> {
  return apiFetch('GET', '/api/organizations/current')
}
