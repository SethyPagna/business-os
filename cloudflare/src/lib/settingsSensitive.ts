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
const SENSITIVE_KEYS = new Set([
  'drive_sync_access_token_expires_at',
  // This shared business list has a dedicated POS-permission endpoint. Keep
  // it out of the broad authenticated settings/bootstrap maps so an account
  // without POS access cannot bypass that endpoint's actor boundary.
  'pos_address_presets_v1',
])

// System-owned rows (6.0.993): written and read only by the Worker's own cron
// code, never by a person. They hold the rotating cron's cursor and per-step
// error text (lib/cronRotation.ts) and the retention sweeps' last-run stamps
// (audit_log_retention_last_run, import_retention_last_run,
// ephemeral_retention_last_run[:group]). No screen reads them (cron health has
// its own Settings-gated endpoint, /api/runtime/cron-health, which reads the
// rows directly), so they are withheld from every settings map for everyone and
// POST /api/settings refuses them for everyone, administrators included.
const SYSTEM_OWNED_KEYS = new Set(['cron_rotation_state', 'cron_heavy_state'])

export function isSystemOwnedSettingKey(key: string): boolean {
  const normalized = String(key || '').trim().toLowerCase()
  return SYSTEM_OWNED_KEYS.has(normalized) || /_last_run(:|$)/.test(normalized)
}

// The same rule as a SQL predicate on settings.key, for the table-wide
// MAX(updated_at) stamps (routes/settings.ts): the cron rewrites its rows every
// five minutes, and a stamp that moves on its own makes a user's save look
// stale. A test pins this to isSystemOwnedSettingKey.
export const NOT_SYSTEM_OWNED_SETTING_SQL = String.raw`lower(key) NOT IN ('cron_rotation_state', 'cron_heavy_state') AND lower(key) NOT LIKE '%\_last\_run' ESCAPE '\' AND lower(key) NOT LIKE '%\_last\_run:%' ESCAPE '\'`

export function isSensitiveSettingKey(key: string): boolean {
  const normalized = String(key || '').toLowerCase()
  if (isSystemOwnedSettingKey(normalized)) return true
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
