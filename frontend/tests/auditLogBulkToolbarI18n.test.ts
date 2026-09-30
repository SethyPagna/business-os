// i18n:6, i18n:15 -- the Audit Log's export and selection copy must come from the
// language packs, never from English literals in the JSX.
//
// AUDIT-LOG-ORG replaced the per-row checkboxes and the bulk toolbar with
// compact one-line rows and inline expansion, so what remains to pin is: no
// hardcoded English selection UI came back, the export menu still uses the
// localized copy, and every label the new scope / time / load-more controls
// print resolves through both packs.
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/components/utils-settings/AuditLog.tsx', import.meta.url), 'utf8')
const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, unknown>
const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, unknown>

await (async function noHardcodedSelectionCopyRemains() {
  assert.doesNotMatch(source, />Export selected</, 'no hardcoded "Export selected" button')
  assert.doesNotMatch(source, /aria-label="Select all audit logs"/, 'no hardcoded select-all aria-label')
  assert.doesNotMatch(source, /\{selectedLogs\.length\} selected</, 'no hardcoded selection-count chip')
  console.log('PASS no hardcoded selection copy remains')
})()

await (async function exportMenuUsesTheLocalizedCopy() {
  assert.match(
    source,
    /copy\('export_visible_logs', 'Export visible logs', 'នាំចេញកំណត់ហេតុដែលកំពុងបង្ហាញ'\)/,
    'the export menu entry renders via copy(\'export_visible_logs\', ...)',
  )
  console.log('PASS export menu entry reuses the localized copy')
})()

await (async function newControlsPrintPackWordsNotLiterals() {
  assert.match(source, /vocab\(AUDIT_SCOPE_LABELS\[scope\]\[0\], AUDIT_SCOPE_LABELS\[scope\]\[1\]\)/, 'scope buttons go through the pack')
  assert.match(source, /vocab\(AUDIT_TIME_LABELS\[preset\]\[0\], AUDIT_TIME_LABELS\[preset\]\[1\]\)/, 'time presets go through the pack')
  assert.match(source, /vocab\('audit_load_more', 'Load more'\)/, 'Load more goes through the pack')
  assert.match(source, /vocab\(`audit_section_\$\{id\}`/, 'section labels go through the pack')
  for (const key of [
    'export_visible_logs', 'audit_scope_all', 'audit_scope_section', 'audit_scope_user', 'audit_load_more',
    'today', 'last_7_days', 'last_30_days', 'custom_range',
  ]) {
    assert.ok(typeof en[key] === 'string' && en[key], `en.json missing "${key}"`)
    assert.ok(typeof km[key] === 'string' && km[key], `km.json missing "${key}"`)
    assert.notEqual(km[key], en[key], `km.json "${key}" is the English string`)
  }
  console.log('PASS the scope, time and load-more labels resolve in both packs')
})()
