// 6.0.1040 (P0.2), "verify first" for cherry-pick 9a3e0394b: GET /api/auth/bootstrap stopped handing the Settings-only
// rows (telegram_*, drive_sync_*, audit_log_retention_days) to accounts without Settings access. That needs no frontend
// change only while no screen outside Settings reads one of those rows from the settings map.
//
//   READERS  a key-shaped token (`telegram_...`, `drive_sync_...`, `audit_log_retention_days`) appears in the frontend
//            source only in the files that own them: Settings (and its Telegram and retention parts), Backup, the
//            audit-record label table. A new reader anywhere else fails here and has to be looked at.
//   FIVE     the five files the plan names only carry look-alikes: a notification message id, a portal label key, a
//            localStorage cooldown key, the audit label table. None indexes the settings map with a Settings-only key.
//   MUTANT   the scan flags a planted reader, so a green run can tell "no reader" from "scan sees nothing".
//
// The browser half, which signs in as an Employee and a Website Editor holder with and without those rows in the
// bootstrap and compares the bell and the editor, is e2e/bootstrap-settings-visibility.spec.ts.
//
// Run: node tests/bootstrapSettingsReaders.test.ts
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [full] : []
  })
}

const read = (file: string): string => readFileSync(file, 'utf8').split('\r\n').join('\n')
const relative = (file: string): string => path.relative(srcRoot, file).split(path.sep).join('/')

// A token that names a Settings-only row. The leading guard keeps `customer_portal_telegram_label`,
// `notification_system_drive_sync_summary` and `businessos_drive_sync_status_cooldown_until` (other namespaces that merely
// contain the words) out; the trailing class takes a whole key or a bare prefix such as 'telegram_'.
const SETTINGS_ONLY_TOKEN = /(?<![A-Za-z0-9_])(?:telegram_[a-z_]*|drive_sync_[a-z_]*|audit_log_retention_days)/g

function tokensIn(text: string): string[] {
  return text.split('\n').flatMap((line) => (line.trim().startsWith('//') || line.trim().startsWith('*') ? [] : line.match(SETTINGS_ONLY_TOKEN) || []))
}

const OWNERS: Record<string, string> = {
  'components/utils-settings/Settings.tsx': 'the Settings screen: Telegram automation, topics, report switches; server-owned key filter',
  'components/utils-settings/TelegramSummarySections.tsx': 'the Telegram overview switches, mounted only inside the administrator Telegram section of Settings.tsx',
  'components/utils-settings/Backup.tsx': 'Drive sync inputs: their values come from /api/system/drive-sync/status, never the settings map',
  'components/utils-settings/AuditRetentionSetting.tsx': 'the retention form, mounted in Settings for administrators',
  'utils/entityRecords.ts': 'audit-record labels keyed by the setting a /settopic row changed; text only, never a value',
}

const files = sourceFiles(srcRoot)
const found = new Map<string, string[]>()
for (const file of files) {
  const tokens = tokensIn(read(file))
  if (tokens.length) found.set(relative(file), tokens)
}

assert.ok(files.length > 500, `the scan really walked the frontend source (${files.length} files)`)

assert.deepEqual(
  [...found.keys()].sort(),
  Object.keys(OWNERS).sort(),
  `Settings-only row names appear outside the files that own them: ${[...found.entries()].filter(([file]) => !(file in OWNERS)).map(([file, tokens]) => `${file} (${tokens.slice(0, 3).join(', ')})`).join('; ') || 'none'}`,
)
console.log(`PASS READERS: Settings-only row names appear in ${found.size} files, all owners: ${[...found.keys()].join(', ')}`)

// Backup.tsx and entityRecords.ts must not index the settings map with those names.
const settingsIndex = /\b(?:settings|appSettings|form|draft)\s*(?:\?\.)?\[\s*['"`](?:telegram_|drive_sync_|audit_log_retention_days)|\b(?:settings|appSettings)\s*\??\.(?:telegram_|drive_sync_|audit_log_retention_days)/
for (const owner of ['components/utils-settings/Backup.tsx', 'utils/entityRecords.ts']) {
  assert.equal(settingsIndex.test(read(path.join(srcRoot, owner))), false, `${owner} must not read a Settings-only row from a settings map`)
}
console.log('PASS READERS: Backup.tsx and entityRecords.ts never index a settings map with those names')

const read5 = (file: string): string => read(path.join(srcRoot, file))
const lookAlikes: Array<[string, RegExp, string]> = [
  ['components/shared/NotificationCenter.tsx', /notification_system_drive_sync_(?:summary|reconnect)/, 'translated notification message ids sent by the Worker'],
  ['components/catalog/CatalogPage.tsx', /customer_portal_(?:contact_)?telegram_label/, 'Website Editor link labels (customer_portal_*)'],
  ['components/catalog/CatalogEditorSurface.tsx', /customer_portal_(?:contact_)?telegram_label/, 'Website Editor link labels (customer_portal_*)'],
  ['platform/storage/storagePolicy.ts', /businessos_drive_sync_status_cooldown_until/, 'a localStorage cooldown key'],
  ['utils/entityRecords.ts', /telegram_topic_shift_label/, 'i18n label keys for audit rows'],
]
for (const [file, shape, what] of lookAlikes) {
  const text = read5(file)
  assert.match(text, shape, `${file}: the look-alike the plan names is still there (${what})`)
  if (file !== 'utils/entityRecords.ts') assert.equal(tokensIn(text).length, 0, `${file} must carry no Settings-only row name`)
}
console.log('PASS FIVE: the five files the plan names carry look-alikes only (notification ids, portal labels, a cooldown key, audit labels)')

assert.deepEqual(tokensIn("const a = settings.telegram_chat_id\n// settings.drive_sync_enabled\nconst b = settings['audit_log_retention_days']"), ['telegram_chat_id', 'audit_log_retention_days'], 'the scan flags planted readers and skips comments')
assert.deepEqual(tokensIn("const a = 'customer_portal_telegram_label' + 'notification_system_drive_sync_summary' + 'businessos_drive_sync_status_cooldown_until'"), [], 'the scan skips look-alike namespaces')
assert.equal(settingsIndex.test("const chat = settings.telegram_chat_id"), true)
assert.equal(settingsIndex.test("const chat = settings['drive_sync_enabled']"), true)
console.log('PASS MUTANT: a planted reader is flagged, comments and look-alike namespaces are not')

console.log('bootstrapSettingsReaders: all checks passed')
