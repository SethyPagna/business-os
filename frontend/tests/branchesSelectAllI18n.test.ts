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

// Round-2 coordinator authorization: Branches.tsx:1319, two lines below the
// select-all checkbox in the same select-mode row, hardcoded the sibling
// "{selectedCount} selected" count chip in English -- the same defect this
// lane fixed on AuditLog.tsx's own chip (auditLogBulkToolbarI18n.test.ts).
// It sits in the same select-mode block as line 1307 (this lane's declared
// region), so the one-line completion is genuine sibling parity rather than
// scope creep. Fixed to reuse the existing 'selected' key.
await (async function branchesSelectedCountChipUsesTheExistingSelectedKey() {
  assert.doesNotMatch(source, /\{`\$\{selectedCount\} selected`\}/,
    'Branches.tsx:1319 selection-count chip must not hardcode "selected" in English')
  assert.match(source, /\$\{selectedCount\}\s*\$\{t\('selected'\)/,
    'Branches.tsx:1319 selection-count chip must use the existing selected translation key')
  console.log('PASS Branches selection-count chip localized')
})()

await (async function bothPacksCarryTheSelectedKeyThisFileDependsOn() {
  assert.ok(typeof en.selected === 'string' && en.selected, 'en.json missing "selected"')
  assert.ok(typeof km.selected === 'string' && km.selected, 'km.json missing "selected"')
  console.log('PASS both language packs carry selected')
})()
