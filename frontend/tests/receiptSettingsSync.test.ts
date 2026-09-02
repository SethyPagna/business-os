import assert from 'node:assert/strict'
import fs from 'node:fs'

const appContextSource = fs.readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
const receiptSettingsSource = fs.readFileSync(new URL('../src/components/receipt-settings/ReceiptSettings.tsx', import.meta.url), 'utf8')
const printSettingsSource = fs.readFileSync(new URL('../src/components/receipt-settings/PrintSettings.tsx', import.meta.url), 'utf8')
const receiptPreviewSource = fs.readFileSync(new URL('../src/components/receipt-settings/ReceiptPreview.tsx', import.meta.url), 'utf8')
const receiptSource = fs.readFileSync(new URL('../src/components/receipt/Receipt.tsx', import.meta.url), 'utf8')
const printUtilSource = fs.readFileSync(new URL('../src/utils/printReceipt.ts', import.meta.url), 'utf8')
const receiptConfigSource = fs.readFileSync(new URL('../src/utils/receiptAppliedConfig.ts', import.meta.url), 'utf8')
const settingsWriteOptionsSource = fs.readFileSync(new URL('../src/utils/settingsWriteOptions.ts', import.meta.url), 'utf8')

assert.match(appContextSource, /const saveSettings = useCallback\(async \(newSettings: AppSettings, options: SettingsWriteOptions = \{\}\)/)
assert.match(appContextSource, /const normalizedOptions = normalizeSettingsWriteOptions\(options\)/)
assert.match(appContextSource, /const APP_SETTINGS_SAVE_TIMEOUT_MS = 15000/)
assert.match(appContextSource, /withLoaderTimeout\(\s*\(\) => api\.saveSettings\?\.\(serverUpdates, normalizedOptions\),\s*'Save settings',\s*APP_SETTINGS_SAVE_TIMEOUT_MS,\s*\)/)
assert.match(appContextSource, /if \(!normalizedOptions\.silentToast\) notify\(t\('settings_saved'\)\)/)

assert.match(receiptSettingsSource, /silentToast:\s*!options\.showToast/)
assert.match(receiptSettingsSource, /reason:\s*'receipt-template-saved'/)
assert.match(receiptSettingsSource, /source:\s*options\.showToast \? 'receipt-settings:manual-save' : 'receipt-settings:auto-save'/)
assert.match(receiptSettingsSource, /buildAppliedReceiptConfig/)

assert.match(printSettingsSource, /receipt_print_settings/)
assert.match(printSettingsSource, /saveAppSettings/)
assert.match(printSettingsSource, /reason:\s*'receipt-print-settings-saved'/)
assert.match(printSettingsSource, /printSettings:\s*ps/)
// The two contrast controls ship together and each stays pinned: the older
// per-print highContrastBold checkbox, and the newer Text Contrast mode.
assert.match(printSettingsSource, /setValue\('highContrastBold', event\.target\.checked\)/)
assert.match(printSettingsSource, /Extra-dark bold receipt text/)
// Test Print/PDF normally exports the REAL live preview DOM (already carrying
// Receipt.tsx's data-receipt-contrast attribute), but the synthetic fallback
// HTML used when that DOM isn't mounted must still honour Text Contrast
// instead of silently reverting to grey.
assert.match(printSettingsSource, /import \{ normalizeReceiptTemplate \} from '\.\.\/\.\.\/utils\/receiptAppliedConfig'/)
assert.match(printSettingsSource, /const contrastMode = normalizeReceiptTemplate\(settings\.receipt_template\)\.text_contrast/)
assert.match(printSettingsSource, /buildSafePreviewSource\(previewNode, ps, T, contrastMode\)/)
assert.match(printSettingsSource, /const isMaxContrast = contrastMode === 'maximum'/)

assert.match(receiptPreviewSource, /buildAppliedReceiptConfig\(\{ settings, template: tpl \}\)\.settings/)
assert.match(receiptSource, /const appliedConfig = useMemo\(\(\) => buildAppliedReceiptConfig\(\{ settings \}\), \[settings\]\)/)
// Compact ABA receipts intentionally override the normal paper frame with
// an 80 x 50mm, zero-margin effective print configuration. The printable
// path must receive that resolved object, not the untouched stored settings.
assert.match(receiptSource, /const effectivePrintSettings = compactSalesReceipt/)
assert.match(receiptSource, /paperSize: 'custom', customWidth: '80', customHeight: '50'/)
// B5: the printable path receives the RESOLVED per-variant object -- the
// forced 80x50 zero-margin configuration for the card, the roll settings
// for the full receipt (an '80x50mm' stored size maps to the 80mm roll).
assert.match(receiptSource, /const variantSettings = variant === 'compact' \? compactPrintSettings : fullPrintSettings/)
assert.match(receiptSource, /printSettings:\s*variantSettings/)
assert.match(receiptSource, /\? \{ \.\.\.appliedPrintSettings, paperSize: '80mm' \}/)

assert.match(printUtilSource, /RECEIPT_PRINT_SETTINGS_STORAGE_KEY/)
assert.match(printUtilSource, /normalizeReceiptPrintSettings/)
assert.match(printUtilSource, /applyHighContrastBold\(host, printSettings\)/)
assert.match(printUtilSource, /sourceSettings && typeof sourceSettings === 'object' && sourceSettings\.receipt_print_settings/)

assert.match(receiptConfigSource, /export const DEFAULT_RECEIPT_TEMPLATE/)
assert.match(receiptConfigSource, /export const DEFAULT_RECEIPT_PRINT_SETTINGS/)
assert.match(receiptConfigSource, /export function buildAppliedReceiptConfig/)
assert.match(settingsWriteOptionsSource, /export function normalizeSettingsWriteOptions/)

console.log('PASS receipt settings sync contract')
