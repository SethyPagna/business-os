import { getPermissionTier, hasPermission, type PermissionUser } from './permissions'
import { isSystemOwnedSettingKey, stripSensitiveSettings } from './settingsSensitive'

// GET /api/settings hands the settings table to every signed-in account,
// because the POS, receipts, sales, returns, shifts, the notification bell, the
// theme and the storefront-loyalty displays all read the same map. So this is a
// DENYLIST of rows that only the Settings screen (and the Worker itself) reads.
// A key goes on the list only after its readers were checked, because listing it
// hides it from every account without Settings access; a key left off stays
// visible. Every route that returns the settings map to a signed-in account calls
// settingsVisibleTo below (GET /api/settings and the settings block of GET
// /api/auth/bootstrap), so the two cannot drift apart.
//
//   - telegram_*        where reports go (chat and topic ids), what is sent, in which language
//   - drive_sync_*      Google Drive sync configuration; the Backup screen reads a curated
//                       status endpoint (/api/system/drive-sync/status), never these rows
//   - audit_log_retention_days
//
// Withheld unless the account has Settings access (tier full or view, the same
// test the Settings screen itself uses), so a view-only Settings account still
// sees what it is shown.
const SETTINGS_ONLY_KEY_PREFIXES = ['telegram_', 'drive_sync_']
const SETTINGS_ONLY_KEYS = new Set(['audit_log_retention_days'])

// The website assistant's prompt and provider are not public (the portal config
// omits them) and are read only by the Website Editor, which loads them from
// this map. They are therefore also visible to the `customer_portal` grant that
// edits them.
const PORTAL_ASSISTANT_KEYS = new Set(['customer_portal_ai_prompt', 'customer_portal_ai_provider_id'])

function normalizedKey(key: string): string {
  return String(key || '').trim().toLowerCase()
}

// System-owned rows (cron state, *_last_run stamps; lib/settingsSensitive.ts) are
// readable by nobody through the settings maps, a Settings account included.
function isSettingsOnlyKey(key: string): boolean {
  return SETTINGS_ONLY_KEYS.has(key) || SETTINGS_ONLY_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
}

type SettingsReader = (key: string) => boolean

function settingsReaderFor(user: PermissionUser): SettingsReader {
  if (getPermissionTier(user, 'settings') !== 'none') return (key) => !isSystemOwnedSettingKey(key)
  const portalEditor = hasPermission(user, 'customer_portal')
  return (key) => {
    const normalized = normalizedKey(key)
    if (isSystemOwnedSettingKey(normalized) || isSettingsOnlyKey(normalized)) return false
    return portalEditor || !PORTAL_ASSISTANT_KEYS.has(normalized)
  }
}

export function canReadSettingKey(user: PermissionUser, key: string): boolean {
  return settingsReaderFor(user)(key)
}

export function settingsReadableBy<T>(user: PermissionUser, settings: Record<string, T>): Record<string, T> {
  const canRead = settingsReaderFor(user)
  const readable: Record<string, T> = {}
  for (const [key, value] of Object.entries(settings)) {
    if (canRead(key)) readable[key] = value
  }
  return readable
}

// The one rule for "the settings map this account may be handed": secret-bearing
// and system-owned rows never leave the Worker (stripSensitiveSettings), then the
// Settings-only rows are withheld from accounts without Settings access. Any route
// that returns the map to a signed-in account goes through this, not through
// either half alone.
export function settingsVisibleTo<T>(user: PermissionUser, settings: Record<string, T>): Record<string, T> {
  return settingsReadableBy(user, stripSensitiveSettings(settings))
}
