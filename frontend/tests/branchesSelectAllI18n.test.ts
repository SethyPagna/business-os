// i18n:15 -- Branches.tsx:1307 hardcoded aria-label="Select all branches" in
// English on the select-all checkbox, the second half of a finding whose
// first half (AuditLog.tsx's own select-all aria-label) was already fixed to
// use the existing select_all translation key. Same fix, same key, sibling
// surface.
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/components/branches/Branches.tsx', import.meta.url), 'utf8')
const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, unknown>
const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, unknown>

await (async function branchesSelectAllCheckboxUsesTheExistingSelectAllKey() {
  assert.doesNotMatch(source, /aria-label="Select all branches"/,
    'select-all checkbox must not hardcode an English aria-label')
  assert.match(source, /aria-label=\{t\('select_all'\)/,
    'select-all checkbox must use the existing select_all translation key')
  console.log('PASS Branches select-all checkbox aria-label uses the existing select_all key')
})()

await (async function bothPacksCarryTheKeyThisFileDependsOn() {
  assert.ok(typeof en.select_all === 'string' && en.select_all, 'en.json missing "select_all"')
  assert.ok(typeof km.select_all === 'string' && km.select_all, 'km.json missing "select_all"')
  console.log('PASS both language packs carry select_all')
})()
