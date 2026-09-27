// P1-3 (Release 1 auth audit). The generic POST /api/settings writes ANY key
// its caller names, gated only by the `settings` grant (or a narrower bucket).
// Some rows are not preferences but control where data goes or how long the
// evidence lives:
//   - telegram_chat_id            -> which chat receives every business report
//   - audit_log_retention_days    -> how soon the audit trail deletes itself
//   - drive_sync_*                -> the Drive connection, its tokens, and its
//                                    recorded authoriser (lib/driveSyncAuthority)
//   - *_refresh_token, *_token, *_secret, *_api_key, *_password
//                                 -> credentials, which have dedicated flows
// A settings-only account could re-point Telegram at itself, shorten the
// audit window to one day, or forge the Drive authoriser. These keys now need
// administrator control to CHANGE through the generic endpoint.
//
// Matching is on the trimmed, lower-cased key, so a case or whitespace alias
// ('Telegram_Chat_ID ') is caught too. Suffix and prefix matched so the next
// integration's credential row is covered the day it lands.

const ADMIN_ONLY_SETTING_KEYS = new Set(['telegram_chat_id', 'audit_log_retention_days'])
const ADMIN_ONLY_SETTING_PREFIXES = ['drive_sync_']
const ADMIN_ONLY_SETTING_SUFFIXES = ['_refresh_token', '_token', '_secret', '_api_key', '_password']

export function isAdminOnlySettingKey(key: string): boolean {
  const normalized = String(key || '').trim().toLowerCase()
  if (!normalized) return false
  if (ADMIN_ONLY_SETTING_KEYS.has(normalized)) return true
  if (ADMIN_ONLY_SETTING_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true
  return ADMIN_ONLY_SETTING_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
}

// The Settings screen saves its whole form, so a non-admin's ordinary save
// carries telegram_chat_id / audit_log_retention_days back UNCHANGED. Only a
// key whose stored text would actually change is refused; resending the
// current value is a no-op and stays allowed, so the non-admin save keeps
// working. `storedValues` holds the current rows for the attempted keys and
// `nextValue` gives the exact text the route would store.
export function firstChangedAdminOnlySettingKey(
  attemptedKeys: string[],
  storedValues: Record<string, string | null | undefined>,
  nextValue: (key: string) => string,
): string | null {
  for (const key of attemptedKeys) {
    if (!isAdminOnlySettingKey(key)) continue
    const stored = Object.prototype.hasOwnProperty.call(storedValues, key) ? storedValues[key] : undefined
    // A missing row and an empty value are the same "unset" state.
    if ((stored ?? '') !== nextValue(key)) return key
  }
  return null
}
