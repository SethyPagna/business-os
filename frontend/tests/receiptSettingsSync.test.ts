import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DEFAULT_RECEIPT_PRINT_SETTINGS, isReceiptCardPaper, normalizeReceiptPrintSettings, receiptRenditionPrintSettings } from '../src/utils/receiptAppliedConfig.ts'

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
// Sep 23 2026: a test prints what a sale's Print prints on the configured
// paper -- the 80x50 card on 80 x 50 paper, otherwise the full receipt -- with
// that rendition's own settings. With the card enabled the settings preview
// holds both renditions and only the card was an export root, so the roll
// test printed the card; and the card test was handed the stored roll
// margins instead of the card's own zero-margin settings.
assert.equal((printSettingsSource.match(/printSettings:\s*testPrintSettings,/g) || []).length, 3,
  'all three test buttons print with the rendition settings')
assert.doesNotMatch(printSettingsSource, /printSettings:\s*ps\b/)
assert.match(printSettingsSource, /const testRendition: ReceiptRendition = isReceiptCardPaper\(ps\) \? 'card' : 'full'/)
assert.match(printSettingsSource, /const testPrintSettings = receiptRenditionPrintSettings\(ps, testRendition\)/)
assert.match(printSettingsSource, /exportRoots\.find\(\(root\) => root\.getAttribute\('data-receipt-rendition'\) === rendition\) \|\| exportRoots\[0\]/)
assert.match(receiptSource, /data-receipt-export-root="true" data-receipt-rendition="card"/,
  'the settings preview card names itself')
assert.equal((receiptSource.match(/data-receipt-export-root="true" data-receipt-rendition="full"/g) || []).length, 2,
  'the settings preview full receipt is an export root in both preview shapes')
// The two contrast controls ship together and each stays pinned: the older
// per-print highContrastBold checkbox, and the newer Text Contrast mode.
assert.match(printSettingsSource, /setValue\('highContrastBold', event\.target\.checked\)/)
assert.match(printSettingsSource, /Extra-dark bold receipt text/)
// Test Print/PDF normally exports the REAL live preview DOM (already carrying
// Receipt.tsx's data-receipt-contrast attribute), but the synthetic fallback
// HTML used when that DOM isn't mounted must still honour Text Contrast
// instead of silently reverting to grey.
assert.match(printSettingsSource, /import \{ isReceiptCardPaper, normalizeReceiptTemplate, receiptRenditionPrintSettings, type ReceiptRendition \} from '\.\.\/\.\.\/utils\/receiptAppliedConfig'/)
assert.match(printSettingsSource, /const contrastMode = normalizeReceiptTemplate\(settings\.receipt_template\)\.text_contrast/)
assert.match(printSettingsSource, /buildSafePreviewSource\(previewNode, testRendition, testPrintSettings, T, contrastMode\)/)
assert.match(printSettingsSource, /const isMaxContrast = contrastMode === 'maximum'/)

assert.match(receiptPreviewSource, /buildAppliedReceiptConfig\(\{ settings, template: tpl \}\)\.settings/)
assert.match(receiptSource, /const appliedConfig = useMemo\(\(\) => buildAppliedReceiptConfig\(\{ settings \}\), \[settings\]\)/)
// Compact ABA receipts intentionally override the normal paper frame with
// an 80 x 50mm, zero-margin effective print configuration. The printable
// path must receive that resolved object, not the untouched stored settings.
assert.match(receiptSource, /const effectivePrintSettings = compactSalesReceipt/)
// B5: the printable path receives the RESOLVED per-variant object -- the
// forced 80x50 zero-margin configuration for the card, the roll settings
// for the full receipt (an '80x50mm' stored size maps to the 80mm roll).
assert.match(receiptSource, /const compactPrintSettings = receiptRenditionPrintSettings\(appliedPrintSettings, 'card'\)/)
assert.match(receiptSource, /const fullPrintSettings = receiptRenditionPrintSettings\(appliedPrintSettings, 'full'\)/)
assert.match(receiptSource, /const variantSettings = variant === 'compact' \? compactPrintSettings : fullPrintSettings/)
assert.match(receiptSource, /printSettings:\s*variantSettings/)
{
  const roll = { ...DEFAULT_RECEIPT_PRINT_SETTINGS, paperSize: '72mm', marginLeft: '4', scale: '90', pageSizeMode: 'driver-forms' as const }
  const card = receiptRenditionPrintSettings(roll, 'card')
  assert.deepEqual(
    [card.paperSize, card.customWidth, card.customHeight, card.marginTop, card.marginRight, card.marginBottom, card.marginLeft],
    ['80x50mm', '80', '50', '0', '0', '0', '0'],
    'the card keeps the named single-card preset on its own zero-margin sheet',
  )
  assert.equal(card.scale, '90', 'every other print setting carries over to the card')
  assert.equal(card.pageSizeMode, 'driver-forms')
  assert.equal(receiptRenditionPrintSettings(roll, 'full'), roll, 'a roll paper prints the full receipt as set')
  const cardPaper = { ...DEFAULT_RECEIPT_PRINT_SETTINGS, paperSize: '80X50MM' }
  assert.equal(isReceiptCardPaper(cardPaper), true, 'the card paper matches in any case')
  assert.equal(receiptRenditionPrintSettings(cardPaper, 'full').paperSize, '80mm', 'on card paper the full receipt prints on the 80mm roll')
  const customEightyByFifty = { ...DEFAULT_RECEIPT_PRINT_SETTINGS, paperSize: 'custom', customWidth: '80', customHeight: '50' }
  assert.equal(isReceiptCardPaper(customEightyByFifty), false,
    'an arbitrary custom 80 x 50 document is not the card')
}

assert.match(printUtilSource, /RECEIPT_PRINT_SETTINGS_STORAGE_KEY/)
assert.match(printUtilSource, /normalizeReceiptPrintSettings/)
assert.match(printUtilSource, /applyHighContrastBold\(host, printSettings\)/)
assert.match(printUtilSource, /sourceSettings && typeof sourceSettings === 'object' && sourceSettings\.receipt_print_settings/)
// 2026-09-15 (owner, real 80mm print photos): CSS Paged Media's `size`
// property never accepts a length combined with `auto` -- that declaration
// is a parse error, the whole rule is dropped, and the browser falls back
// to the printer driver's own default document size, which is exactly the
// blank lead-in band plus forced second page the owner photographed (and
// what a4d99ac0/943e9884 already learned the hard way with bare `auto`).
// `pageSizeCss` therefore stays an explicit, VALID `<width>mm <height>mm`
// for every case, continuous roll included; the roll's height is no longer
// trusted from the app's off-screen measurement but re-measured inside the
// actual print document immediately before print() (see
// remeasureContinuousRollBeforePrint / writeContinuousRollPageSize below).
assert.match(printUtilSource, /const pageSizeCss = `\$\{widthMm\}mm \$\{pageHeightMm\.toFixed\(2\)\}mm`/,
  'the @page size is always an explicit, valid width-by-height pair -- never `auto` combined with a length')
assert.doesNotMatch(printUtilSource, /size:\s*auto\s*[,;)]/,
  'the page size must never fall back to the printer default document size (width-less auto)')
assert.doesNotMatch(printUtilSource, /\$\{widthMm\}mm auto/,
  'a length combined with `auto` is invalid CSS Paged Media and must never reappear')
assert.match(printUtilSource, /remeasureContinuousRollBeforePrint/,
  'the continuous roll height is re-measured inside the actual print document right before print()')

assert.match(receiptConfigSource, /export const DEFAULT_RECEIPT_TEMPLATE/)
assert.match(receiptConfigSource, /export const DEFAULT_RECEIPT_PRINT_SETTINGS/)
assert.match(receiptConfigSource, /export function buildAppliedReceiptConfig/)
assert.match(receiptConfigSource, /parsed\.marginTop \?\? DEFAULT_RECEIPT_PRINT_SETTINGS\.marginTop/)
assert.match(receiptConfigSource, /parsed\.marginLeft \?\? DEFAULT_RECEIPT_PRINT_SETTINGS\.marginLeft/)
assert.doesNotMatch(receiptConfigSource, /parsed\.margin(?:Top|Right|Bottom|Left) \|\|/,
  'numeric zero margins must survive normalization')
assert.deepEqual(
  normalizeReceiptPrintSettings({ marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0 }),
  { ...normalizeReceiptPrintSettings({}), marginTop: '0', marginRight: '0', marginBottom: '0', marginLeft: '0' },
  'API/import numeric zero margins remain deliberate zero margins',
)
assert.match(printSettingsSource, /print_effective_dimensions/)
assert.match(printSettingsSource, /print_driver_size_note/)
// Sep 23 2026: in printer-paper mode (the default) the panel describes what
// printing does -- the printer paper's width with the capped margins, and the
// print dialog settings that mode needs (longest paper once, Copies 1) --
// instead of "select the same paper size in Chrome and the driver" and the
// roll size with the full 4mm margins.
assert.match(printSettingsSource, /const onPrinterPaper = printsOnPrinterPaper\(testPrintSettings\)/)
assert.match(printSettingsSource, /const printedSettings = onPrinterPaper \? capDriverFormMargins\(testPrintSettings\) : testPrintSettings/)
assert.match(printSettingsSource, /const paperWidthMm = onPrinterPaper \? getDriverFormWidthMm\(ps\) : getPaperWidthMm\(ps\)/)
assert.match(printSettingsSource, /marginNumber\(printedSettings\.marginLeft\)/)
assert.match(printSettingsSource, /marginNumber\(printedSettings\.marginRight\)/)
assert.match(printSettingsSource, /\{onPrinterPaper\s*\? T\('print_driver_forms_dialog_note'/)
assert.match(printSettingsSource, /\{onPrinterPaper && testRendition === 'full' \? \(/,
  'the margins section says what printer paper does with the margins, for the roll')
assert.match(printSettingsSource,
  /\['58mm', '72mm', '80mm'\]\.includes\(ps\.paperSize\) && !\['driver-forms', 'driver'\]\.includes\(ps\.pageSizeMode \|\| 'driver-forms'\) \? \(\s*<div className="mt-1">\s*\{T\('receipt_preview_driver_hint'/,
  'the roll-paper / blank-band hint is shown only for modes that send a page size, never for the printer-paper default')
// Sep 23 2026: the 80x50 card prints through the page length mode too, so its
// paper shows the mode picker and "Test print this mode" -- the card test
// print (testRendition 'card') had no reachable button before.
assert.match(printSettingsSource,
  /\{\['58mm', '72mm', '80mm', '80x50mm'\]\.includes\(ps\.paperSize\) \? \(\s*<Section icon=\{Ruler\} title=\{T\('print_page_size_mode_title'/,
  'the page length section, with its mode picker and test print, renders for 80 x 50 paper')
assert.match(settingsWriteOptionsSource, /export function normalizeSettingsWriteOptions/)

console.log('PASS receipt settings sync contract')
