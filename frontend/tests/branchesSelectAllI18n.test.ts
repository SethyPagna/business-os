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

// EXPECTED RED until the Branches.tsx owner lands the fix -- this lane's
// region for Branches.tsx is line 1307 only (the select-all checkbox's
// aria-label, fixed above). Line 1319, two lines below in the same
// select-mode row, hardcodes the sibling "{selectedCount} selected" count
// chip in English -- the same defect this lane fixed on AuditLog.tsx's own
// chip (auditLogBulkToolbarI18n.test.ts). Left unfixed here deliberately
// (out of region); pinned so the defect cannot silently regress out of view
// and so the eventual one-line fix --
//   {`${selectedCount} ${t('selected') || 'Selected'}`}
// -- (the 'selected' key already exists in both packs) turns this green the
// moment the Branches.tsx owner lands it.
await (async function branchesSelectedCountChipStillHardcodedNotDoneThisLane() {
  assert.doesNotMatch(source, /\$\{selectedCount\} selected/,
    'KNOWN NOT-DONE (out of region for this lane): Branches.tsx:1319 selection-count chip must not hardcode "selected" in English -- assign to the Branches.tsx owner')
  console.log('PASS Branches selection-count chip localized')
})()
