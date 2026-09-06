// i18n:6, i18n:15 -- the Audit Log bulk toolbar hardcoded "Export selected" in
// English even though the identical action already has a localized copy() call
// via the ExportMenu ("export_selected_logs"), and the select-all checkbox
// hardcoded its aria-label instead of using the existing select_all key.
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/components/utils-settings/AuditLog.tsx', import.meta.url), 'utf8')
const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, unknown>
const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, unknown>

await (async function bulkToolbarExportButtonReusesTheExistingLocalizedCopy() {
  // The literal JSX text node ">Export selected<" is the un-localized string
  // reported by the audit. It must be gone -- replaced by the same copy()
  // call the ExportMenu's "Export selected logs" item already uses.
  assert.doesNotMatch(source, />Export selected</,
    'bulk toolbar button must not hardcode "Export selected" in English')
  assert.match(
    source,
    /onClick=\{\(\) => exportRows\(selectedLogs, 'audit-log-selected'\)\}>\{copy\('export_selected_logs', 'Export selected logs', 'នាំចេញកំណត់ហេតុដែលបានជ្រើស'\)\}<\/button>/,
    'bulk toolbar export-selected button must render via the existing copy(\'export_selected_logs\', ...) call, matching the ExportMenu entry',
  )
  console.log('PASS bulk toolbar export-selected button reuses the existing localized copy')
})()

await (async function selectAllCheckboxUsesTheExistingSelectAllKey() {
  assert.doesNotMatch(source, /aria-label="Select all audit logs"/,
    'select-all checkbox must not hardcode an English aria-label')
  assert.match(source, /aria-label=\{t\('select_all'\)/,
    'select-all checkbox must use the existing select_all translation key')
  console.log('PASS select-all checkbox aria-label uses the existing select_all key')
})()

await (async function bothPacksCarryTheKeysThisFileNowDependsOn() {
  for (const key of ['export_selected_logs', 'select_all']) {
    assert.ok(typeof en[key] === 'string' && en[key], `en.json missing "${key}"`)
    assert.ok(typeof km[key] === 'string' && km[key], `km.json missing "${key}"`)
  }
  console.log('PASS both language packs carry export_selected_logs and select_all')
})()
