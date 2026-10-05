// Callers that read AppContext.saveSettings' answer. It does not throw for a failed
// write: it shows its own toast and answers { success: false }. These callers
// treated that as saved (a false "saved" toast, an undo entry for a write that
// never landed, a receipt template marked persisted, a dirty flag cleared) --
// and the receipt page re-read every setting after each autosave.
//
// Run: node tests/settingsCallersFailedWrite.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
let failed = 0
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}


await test('callers that ignored a failed write now read the answer: Receipt, Print, Loyalty, notification switches, session duration', () => {
  const receipt = read('../src/components/receipt-settings/ReceiptSettings.tsx')
  assert.match(receipt, /settingsSaveOutcome\(result\) === 'failed'/)
  assert.doesNotMatch(receipt, /loadSettingsRef/, 'the receipt page no longer re-reads every setting after each autosave')
  assert.doesNotMatch(receipt, /RECEIPT_SETTINGS_REFRESH_TIMEOUT_MS/)
  const failedAt = receipt.indexOf("settingsSaveOutcome(result) === 'failed'")
  assert.ok(failedAt > 0 && failedAt < receipt.indexOf('persistedTemplateRef.current = serializedTemplate'), 'a failed template is not marked persisted')
  assert.match(read('../src/components/receipt-settings/PrintSettings.tsx'), /settingsSaveSucceeded\(result\)\) notify\?\./)
  const loyalty = read('../src/components/loyalty-points/LoyaltyPointsPage.tsx')
  assert.ok(loyalty.indexOf('settingsSaveSucceeded(result)') > 0 && loyalty.indexOf('settingsSaveSucceeded(result)') < loyalty.indexOf("notify(copy('saved'"))
  assert.match(read('../src/components/shared/NotificationCenter.tsx'), /if \(!settingsSaveSucceeded\(result\)\) return\n\s+void loadSummary\(true\)/)
  assert.match(read('../src/components/users/UserProfileModal.tsx'), /if \(!settingsSaveSucceeded\(result\)\) return\n\s+actionHistory\.pushAction/)
})


if (failed) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nsettingsCallersFailedWrite: all checks passed')
