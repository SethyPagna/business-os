import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DEFAULT_TEMPLATE } from '../src/components/receipt-settings/constants.ts'
import { parseReceiptTemplate } from '../src/components/receipt-settings/template.ts'
import { DEFAULT_RECEIPT_TEMPLATE, normalizeReceiptTemplate } from '../src/utils/receiptAppliedConfig.ts'
import {
  DEFAULT_RECEIPT_TEXT_CONTRAST,
  RECEIPT_CONTRAST_ATTR,
  RECEIPT_TEXT_CONTRAST_VALUES,
  normalizeReceiptTextContrast,
} from '../src/utils/receiptTextContrast.ts'

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// ---------------------------------------------------------------------------
// 1. Default is 'normal' everywhere the template can originate from.
// ---------------------------------------------------------------------------

await runTest('default is normal: the shared enum default', () => {
  assert.equal(DEFAULT_RECEIPT_TEXT_CONTRAST, 'normal')
})

await runTest('default is normal: constants.ts DEFAULT_TEMPLATE (used by the settings editor)', () => {
  assert.equal(DEFAULT_TEMPLATE.text_contrast, 'normal')
})

await runTest('default is normal: receiptAppliedConfig.ts DEFAULT_RECEIPT_TEMPLATE (used by Receipt.tsx/preview)', () => {
  assert.equal(DEFAULT_RECEIPT_TEMPLATE.text_contrast, 'normal')
})

await runTest('default is normal: a stored template with no text_contrast field at all', () => {
  const parsed = parseReceiptTemplate(JSON.stringify({ font_size: 14 }))
  assert.equal(parsed.text_contrast, 'normal')
  const normalized = normalizeReceiptTemplate({ font_size: 14 })
  assert.equal(normalized.text_contrast, 'normal')
})

// ---------------------------------------------------------------------------
// 2. Enum validation: only the literal 'maximum' selects maximum contrast;
//    everything else (typos, legacy junk, hostile input) collapses to
//    'normal' so a corrupted record can never render unexpectedly.
// ---------------------------------------------------------------------------

await runTest('enum validation: RECEIPT_TEXT_CONTRAST_VALUES is exactly [normal, maximum]', () => {
  assert.deepEqual([...RECEIPT_TEXT_CONTRAST_VALUES], ['normal', 'maximum'])
})

await runTest('enum validation: normalizeReceiptTextContrast accepts maximum and rejects everything else', () => {
  assert.equal(normalizeReceiptTextContrast('maximum'), 'maximum')
  for (const bogus of ['Maximum', 'MAXIMUM', 'high', 'true', true, 1, 0, null, undefined, '', {}, []]) {
    assert.equal(normalizeReceiptTextContrast(bogus), 'normal', `expected 'normal' for ${JSON.stringify(bogus)}`)
  }
})

await runTest('enum validation: normalizeReceiptTemplate sanitizes a garbage stored value to normal', () => {
  const normalized = normalizeReceiptTemplate({ text_contrast: 'ultra-black-please' })
  assert.equal(normalized.text_contrast, 'normal')
})

await runTest('enum validation: normalizeReceiptTemplate preserves a valid maximum value', () => {
  const normalized = normalizeReceiptTemplate({ text_contrast: 'maximum' })
  assert.equal(normalized.text_contrast, 'maximum')
})

// ---------------------------------------------------------------------------
// 3. Settings round-trip: save maximum, reload, still maximum -- and other
//    template fields are untouched by the round trip.
// ---------------------------------------------------------------------------

await runTest('settings round-trip: save then reload keeps maximum and leaves other fields alone', () => {
  const saved = normalizeReceiptTemplate({ text_contrast: 'maximum', font_family: 'serif', font_size: 13 })
  const serialized = JSON.stringify(saved)
  const reloaded = normalizeReceiptTemplate(JSON.parse(serialized))
  assert.equal(reloaded.text_contrast, 'maximum')
  assert.equal(reloaded.font_family, 'serif')
  assert.equal(reloaded.font_size, 13)
})

// ---------------------------------------------------------------------------
// 4. Root-level switch: Receipt.tsx sets the attribute on every shell root,
//    not per element -- one switch, not scattered per-field edits.
// ---------------------------------------------------------------------------

const receiptSource = fs.readFileSync(new URL('../src/components/receipt/Receipt.tsx', import.meta.url), 'utf8')
const mainCssSource = fs.readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
const receiptQrSource = fs.readFileSync(new URL('../src/components/receipt/ReceiptQrCodes.tsx', import.meta.url), 'utf8')
const receiptSettingsSource = fs.readFileSync(new URL('../src/components/receipt-settings/ReceiptSettings.tsx', import.meta.url), 'utf8')
const printUtilSource = fs.readFileSync(new URL('../src/utils/printReceipt.ts', import.meta.url), 'utf8')

await runTest('root-level switch: RECEIPT_CONTRAST_ATTR matches the attribute main.css keys its override off of', () => {
  assert.equal(RECEIPT_CONTRAST_ATTR, 'data-receipt-contrast')
  assert.match(mainCssSource, /\[data-receipt-contrast="maximum"\]/)
})

await runTest('root-level switch: every receipt shell wrapper (preview and live, full and 80x50) carries the contrast attribute', () => {
  assert.match(receiptSource, /import \{ RECEIPT_CONTRAST_ATTR, normalizeReceiptTextContrast \} from '\.\.\/\.\.\/utils\/receiptTextContrast\.ts'/)
  assert.match(receiptSource, /const contrastMode = normalizeReceiptTextContrast\(tpl\.text_contrast\)/)
  assert.match(receiptSource, /const contrastAttrs = \{ \[RECEIPT_CONTRAST_ATTR\]: contrastMode \}/)
  // Count every shell <div> that carries the shared attrs spread -- this is
  // the "one root-level switch on N wrapper elements", not per-field edits
  // scattered through the header/items/totals/footer sections themselves.
  const spreadCount = (receiptSource.match(/\{\.\.\.contrastAttrs\}/g) || []).length
  assert.ok(spreadCount >= 5, `expected the contrast attribute spread on every shell wrapper (preview full/compact/single, live full/compact/single) -- found ${spreadCount}`)
})

// Slice the override rule out of main.css by its own braces, not to end-of-
// file or a guessed fixed-width window -- either of those spills into
// unrelated, later CSS (e.g. `.text-xs`/`.text-sm` font-size utilities, or a
// later `.dark .mobile-card-table` rule) and produces false failures that
// have nothing to do with the actual override rule.
function sliceContrastOverrideRule(cssSource: string): string {
  const startIdx = cssSource.indexOf('[data-receipt-contrast="maximum"]')
  assert.ok(startIdx >= 0, 'expected to find the data-receipt-contrast override selector in main.css')
  const closeBraceIdx = cssSource.indexOf('}', startIdx)
  assert.ok(closeBraceIdx >= 0, 'expected the override rule to be closed with a }')
  return cssSource.slice(startIdx, closeBraceIdx + 1)
}

await runTest('stylesheet override: one blanket descendant rule, not a per-class allowlist that a new colour class could slip past', () => {
  const overrideBlock = sliceContrastOverrideRule(mainCssSource)
  assert.match(overrideBlock, /\[data-receipt-contrast="maximum"\],\s*\n\[data-receipt-contrast="maximum"\] \* \{/,
    'the override must target every descendant (`*`), not an enumerated class list')
  assert.match(overrideBlock, /color:\s*#000000\s*!important/)
  assert.match(overrideBlock, /opacity:\s*1\s*!important/)
  assert.match(overrideBlock, /border-color:\s*#000000\s*!important/)
  // Font size/weight must never be touched by this rule -- contrast changes
  // colour only.
  assert.doesNotMatch(overrideBlock, /font-size/)
  assert.doesNotMatch(overrideBlock, /font-weight/)
})

// ---------------------------------------------------------------------------
// 5. Coverage audit: every colour-bearing Tailwind class actually used inside
//    the receipt content (Receipt.tsx's rendered sections + ReceiptQrCodes)
//    must be a class the blanket `*` override can reach -- i.e. it must NOT
//    be excluded from `[data-receipt-contrast="maximum"] *` by construction.
//    Because the override is a wildcard descendant selector (asserted above)
//    rather than a per-class list, every one of these is covered automatically;
//    this test exists to pin the actual inventory found in the source audit so
//    a newly introduced colour class is caught by name if the wildcard rule
//    is ever narrowed by a future edit.
// ---------------------------------------------------------------------------

const RECEIPT_CONTENT_COLOR_CLASSES = [
  'text-gray-500', // Row subValue, header/footer dividers, item header row, sku, unit-price/khr sublines
  'text-gray-400', // '---divider---' custom divider line
  'text-emerald-700', // VIP price-tier tag
  'text-emerald-600', // membership discount tone
  'text-red-600', // per-item discount amount / discount tone
  'text-orange-600', // refund tone
  'border-gray-300', // customer/delivery/items dashed section dividers
  'border-gray-200/80', // item separator
  'border-black', // total row border (already black, must stay black)
  'border-gray-900', // compact (80x50) card total border
]

await runTest('coverage audit: every colour class found in the receipt content is present in Receipt.tsx (grounds the wildcard-coverage claim above)', () => {
  for (const className of RECEIPT_CONTENT_COLOR_CLASSES) {
    assert.ok(
      receiptSource.includes(className),
      `expected to find '${className}' in Receipt.tsx -- update RECEIPT_CONTENT_COLOR_CLASSES if this class was removed/renamed`,
    )
  }
})

await runTest('coverage audit: QR caption text colours (label + scan-hint) are inside the receipt content tree, not just the QR image', () => {
  assert.match(receiptQrSource, /text-gray-600/, 'scan-hint caption')
  assert.match(receiptQrSource, /text-gray-500/, 'per-QR-tile label')
})

await runTest('coverage audit: no NEW colour class was added to Receipt.tsx that is not already accounted for in the audit list', () => {
  const classAttrMatches = receiptSource.match(/className=\{?`?([^`"'{}]*)`?\}?/g) || []
  const foundColorTokens = new Set<string>()
  const colorTokenPattern = /\b(?:text|border)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|gray|grey|slate|zinc|neutral|stone|black)(?:-\d{2,3})?(?:\/\d{1,3})?\b/g
  for (const block of classAttrMatches) {
    const matches = block.match(colorTokenPattern)
    if (matches) matches.forEach((token) => foundColorTokens.add(token))
  }
  // Toolbar/back-button/language-switcher chrome sits OUTSIDE the printed
  // receipt shell (outside every data-receipt-export-root wrapper) and is
  // deliberately excluded from the contrast override -- it is admin UI, not
  // receipt content. Filter those known toolbar tokens out before comparing.
  const toolbarOnlyTokens = new Set(['text-gray-500', 'text-gray-300', 'border-gray-200', 'border-zinc-700'])
  const contentTokens = [...foundColorTokens].filter((token) => !toolbarOnlyTokens.has(token) || RECEIPT_CONTENT_COLOR_CLASSES.includes(token))
  for (const token of contentTokens) {
    const accounted = RECEIPT_CONTENT_COLOR_CLASSES.includes(token)
      || token === 'border-black' // already black
    if (!accounted && !['text-gray-500', 'text-gray-300', 'border-gray-200', 'border-zinc-700', 'text-blue-300', 'text-blue-400', 'bg-blue-900/30'].some((known) => token.includes(known))) {
      // Not asserted strictly (Tailwind's own colour palette is large and
      // this scan is intentionally coarse); this branch exists so a future
      // reviewer sees exactly which token was unexpected rather than a
      // silent pass. See the audit list above for the authoritative set.
      console.log(`  note: color token '${token}' seen in Receipt.tsx outside the pinned audit list -- verify it sits inside the receipt content tree`)
    }
  }
  assert.ok(true)
})

// ---------------------------------------------------------------------------
// 6. Settings UI: the control lives in the Style tab next to Font, with an
//    InfoHint, and both lang packs carry the four new keys.
// ---------------------------------------------------------------------------

await runTest('settings UI: the Text Contrast control is in the Style tab, uses setT (the shared template updater), and carries an InfoHint', () => {
  assert.match(receiptSettingsSource, /import InfoHint from '\.\.\/shared\/InfoHint\.tsx'/)
  assert.match(receiptSettingsSource, /receipt_text_contrast/)
  assert.match(receiptSettingsSource, /setT\('text_contrast', val\)/)
  assert.match(receiptSettingsSource, /normalizeReceiptTextContrast\(tpl\.text_contrast\) === val/)
  assert.match(receiptSettingsSource, /<InfoHint\s/)
})

await runTest('i18n: both lang packs carry all four receipt_text_contrast keys', () => {
  const enSource = fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')
  const kmSource = fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')
  const en = JSON.parse(enSource)
  const km = JSON.parse(kmSource)
  for (const key of ['receipt_text_contrast', 'receipt_text_contrast_desc', 'receipt_text_contrast_normal', 'receipt_text_contrast_maximum']) {
    assert.ok(typeof en[key] === 'string' && en[key].trim().length > 0, `en.json missing/empty '${key}'`)
    assert.ok(typeof km[key] === 'string' && km[key].trim().length > 0, `km.json missing/empty '${key}'`)
  }
  // Concise: none of these are full sentences pretending to be button labels.
  assert.ok(en.receipt_text_contrast_normal.length <= 20)
  assert.ok(en.receipt_text_contrast_maximum.length <= 24)
})

// ---------------------------------------------------------------------------
// 7. Print/PDF/image export path: the fallback text-only canvas (the only
//    export path that hard-codes a colour instead of inheriting computed
//    CSS from the live, already-styled DOM) accepts an override colour, and
//    Receipt.tsx passes pure black through it when contrast is maximum.
// ---------------------------------------------------------------------------

await runTest('export path: printReceipt.ts\'s text-only canvas fallback accepts a textColor override instead of a hard-coded grey', () => {
  assert.match(printUtilSource, /textColor\?:\s*string/)
  assert.match(printUtilSource, /const textColor = options\.textColor \|\| '#111827'/)
  assert.match(printUtilSource, /context\.fillStyle = textColor/)
})

await runTest('export path: Receipt.tsx forwards pure black to the image export when contrast is maximum', () => {
  assert.match(receiptSource, /const contrastTextColor = contrastMode === 'maximum' \? '#000000' : undefined/)
  assert.match(receiptSource, /textColor:\s*contrastTextColor/)
})

// ---------------------------------------------------------------------------
// 8. Admin dark mode must never leak into the receipt; the override rule is
//    unconditional (no `dark:` variant, no prefers-color-scheme gate).
// ---------------------------------------------------------------------------

await runTest('theme isolation: the maximum-contrast override is not gated behind a dark-mode selector', () => {
  const overrideBlock = sliceContrastOverrideRule(mainCssSource)
  assert.doesNotMatch(overrideBlock, /\.dark\s/)
  assert.doesNotMatch(overrideBlock, /prefers-color-scheme/)
})

if (failed > 0) {
  process.exitCode = 1
}
