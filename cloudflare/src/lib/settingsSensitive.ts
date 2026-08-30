// Secret-bearing settings keys never leave the Worker (Part-77 HIGH, auth
// audit): GET /api/settings and GET /auth/bootstrap both hand the WHOLE
// settings table to any authenticated account, and the Google Drive OAuth
// flow (compat.ts /system/drive-sync/*) stores its refresh + access tokens
// as ordinary settings rows -- so every logged-in user could read a token
// granting the connected Google account's Drive. No frontend surface reads
// these keys (connection status is computed server-side in
// lib/googleDrive.ts and returned as curated fields), so they are stripped
// for EVERYONE, admins included: the tokens are consumed only inside the
// Worker.
//
// Suffix-matched rather than only enumerated so the NEXT integration that
// stores a credential in settings is covered the day it lands. If a future
// customer-facing setting legitimately ends in one of these suffixes,
// exempt it explicitly here -- with a comment saying why it is safe.

const SENSITIVE_KEY_SUFFIXES = ['_refresh_token', '_access_token', '_secret', '_api_key', '_password']

// Not secret itself, but it only exists to describe a stripped token and is
// pure fingerprinting surface for everyone else.
const SENSITIVE_KEYS = new Set(['drive_sync_access_token_expires_at'])

export function isSensitiveSettingKey(key: string): boolean {
  const normalized = String(key || '').toLowerCase()
  if (SENSITIVE_KEYS.has(normalized)) return true
  return SENSITIVE_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
}

export function stripSensitiveSettings<T>(map: Record<string, T>): Record<string, T> {
  const safe: Record<string, T> = {}
  for (const [key, value] of Object.entries(map)) {
    if (!isSensitiveSettingKey(key)) safe[key] = value
  }
  return safe
}
