import { getClientDeviceInfo, getOrCreatePersistentDeviceId } from '../utils/deviceInfo.ts'
import { apiFetch, route } from './http.ts'

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
    // Only meaningful for admin-control accounts (see
    // cloudflare/src/lib/deviceTrust.ts) -- ignored server-side for
    // everyone else, but always sent so a first-time admin login from a
    // new browser isn't misread as "no device id" (which fails closed
    // into pending rather than skipping the check).
    deviceId: getOrCreatePersistentDeviceId(),
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
  return route(
    'auth:verification-capabilities',
    () => apiFetch('GET', '/api/auth/verification-capabilities'),
    null,
  )
}

export function otpSetup(payload: AuthPayload = {}): Promise<unknown> {
  return apiFetch('POST', '/api/auth/otp/setup', payload || {})
}

export function otpConfirm(payload: AuthPayload = {}): Promise<unknown> {
  return apiFetch('POST', '/api/auth/otp/confirm', payload || {})
}

export function otpDisable(payload: AuthPayload = {}): Promise<unknown> {
  return apiFetch('POST', '/api/auth/otp/disable', payload || {})
}

export function otpRecoveryReset(payload: AuthPayload = {}): Promise<unknown> {
  return apiFetch('POST', '/api/auth/otp/recover', payload || {})
}

export function otpVerify(payload: AuthPayload = {}): Promise<unknown> {
  // deviceId rides along like it does on /login: the server re-runs the
  // device-approval gate at the OTP step now, and the persistent id is what
  // lets an approved device stay approved across both steps.
  return apiFetch('POST', '/api/auth/otp/verify', { deviceId: getOrCreatePersistentDeviceId(), ...(payload || {}) })
}

export function otpStatus(userId: string | number): Promise<unknown> {
  return apiFetch('GET', `/api/auth/otp/status/${encodeURIComponent(String(userId))}`)
}

export function startGoogleOauth(payload: AuthPayload = {}): Promise<unknown> {
  const device = getClientDeviceInfo()
  return apiFetch('POST', '/api/auth/oauth/start', {
    ...(payload || {}),
    // Carried through the OAuth redirect (server signs it into `state`) so
    // the callback can run the same admin device-approval check POST
    // /login runs -- see cloudflare/src/lib/deviceTrust.ts. Only
    // meaningful for admin-control accounts; ignored for everyone else.
    deviceId: getOrCreatePersistentDeviceId(),
    deviceName: (payload && (payload as { deviceName?: string }).deviceName) || device.deviceName || '',
  })
}

export function completeGoogleOauth(payload: AuthPayload = {}): Promise<unknown> {
  return apiFetch('POST', '/api/auth/oauth/complete', payload || {})
}

export function unlinkGoogleOauth(payload: AuthPayload = {}): Promise<unknown> {
  return apiFetch('POST', '/api/auth/oauth/unlink', payload || {})
}

export function getOrganizationBootstrap(): Promise<unknown> {
  return route(
    'organizations:bootstrap',
    () => apiFetch('GET', '/api/organizations/bootstrap'),
    null,
  )
}

export function searchOrganizations(query: string): Promise<unknown> {
  const q = encodeURIComponent(String(query || '').trim())
  return apiFetch('GET', `/api/organizations/search${q ? `?q=${q}` : ''}`)
}

export function getCurrentOrganization(): Promise<unknown> {
  return apiFetch('GET', '/api/organizations/current')
}
