import assert from 'node:assert/strict'
import fs from 'node:fs'

const appContextSource = fs.readFileSync(new URL('../src/AppContext.jsx', import.meta.url), 'utf8')
const receiptSettingsSource = fs.readFileSync(new URL('../src/components/receipt-settings/ReceiptSettings.jsx', import.meta.url), 'utf8')
const printSettingsSource = fs.readFileSync(new URL('../src/components/receipt-settings/PrintSettings.jsx', import.meta.url), 'utf8')
const receiptPreviewSource = fs.readFileSync(new URL('../src/components/receipt-settings/ReceiptPreview.jsx', import.meta.url), 'utf8')
const receiptSource = fs.readFileSync(new URL('../src/components/receipt/Receipt.jsx', import.meta.url), 'utf8')
const printUtilSource = fs.readFileSync(new URL('../src/utils/printReceipt.js', import.meta.url), 'utf8')
const receiptConfigSource = fs.readFileSync(new URL('../src/utils/receiptAppliedConfig.ts', import.meta.url), 'utf8')
const settingsWriteOptionsSource = fs.readFileSync(new URL('../src/utils/settingsWriteOptions.ts', import.meta.url), 'utf8')

assert.match(appContextSource, /const saveSettings = useCallback\(async \(newSettings, options = \{\}\)/)
assert.match(appContextSource, /const normalizedOptions = normalizeSettingsWriteOptions\(options\)/)
assert.match(appContextSource, /window\.api\.saveSettings\(serverUpdates, normalizedOptions\)/)
assert.match(appContextSource, /if \(!normalizedOptions\.silentToast\) notify\(t\('settings_saved'\)\)/)

assert.match(receiptSettingsSource, /silentToast:\s*!options\.showToast/)
assert.match(receiptSettingsSource, /reason:\s*'receipt-template-saved'/)
assert.match(receiptSettingsSource, /source:\s*options\.showToast \? 'receipt-settings:manual-save' : 'receipt-settings:auto-save'/)
assert.match(receiptSettingsSource, /buildAppliedReceiptConfig/)

assert.match(printSettingsSource, /receipt_print_settings/)
assert.match(printSettingsSource, /saveAppSettings/)
assert.match(printSettingsSource, /reason:\s*'receipt-print-settings-saved'/)
assert.match(printSettingsSource, /printSettings:\s*ps/)

assert.match(receiptPreviewSource, /buildAppliedReceiptConfig\(\{ settings, template: tpl \}\)\.settings/)
assert.match(receiptSource, /const appliedConfig = useMemo\(\(\) => buildAppliedReceiptConfig\(\{ settings \}\), \[settings\]\)/)
assert.match(receiptSource, /printSettings:\s*appliedPrintSettings/)

assert.match(printUtilSource, /RECEIPT_PRINT_SETTINGS_STORAGE_KEY/)
assert.match(printUtilSource, /normalizeReceiptPrintSettings/)
assert.match(printUtilSource, /sourceSettings && typeof sourceSettings === 'object' && sourceSettings\.receipt_print_settings/)

assert.match(receiptConfigSource, /export const DEFAULT_RECEIPT_TEMPLATE/)
assert.match(receiptConfigSource, /export const DEFAULT_RECEIPT_PRINT_SETTINGS/)
assert.match(receiptConfigSource, /export function buildAppliedReceiptConfig/)
assert.match(settingsWriteOptionsSource, /export function normalizeSettingsWriteOptions/)

console.log('PASS receipt settings sync contract')
