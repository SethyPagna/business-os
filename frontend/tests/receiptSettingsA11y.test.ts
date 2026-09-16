import assert from 'node:assert/strict'
import fs from 'node:fs'

// i18n:12 -- Receipt settings: the ABA inputs' aria-labels must use the same
// translation keys as their own placeholders (not a hardcoded English
// literal that never follows the km pack), and the three remaining literal
// strings (default footer placeholder, custom header placeholder, close
// preview aria-label) must be translated too.

const receiptSettingsSource = fs.readFileSync(
  new URL('../src/components/receipt-settings/ReceiptSettings.tsx', import.meta.url),
  'utf8',
)
const enPack = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'))
const kmPack = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8'))

// The three ABA inputs: aria-label must read the SAME key as the input's own
// placeholder, not a hardcoded English literal.
for (const key of ['aba_account_name', 'aba_account_number', 'aba_qr_image']) {
  const ariaRe = new RegExp(`aria-label=\\{t\\('${key}'\\)[^}]*\\}[^>]*placeholder=\\{t\\('${key}'\\)`)
  assert.match(
    receiptSettingsSource,
    ariaRe,
    `expected aria-label and placeholder on the ${key} input to both read t('${key}')`,
  )
}

// None of the three ABA inputs may carry a hardcoded English aria-label literal any more.
assert.doesNotMatch(receiptSettingsSource, /aria-label="ABA account name"/)
assert.doesNotMatch(receiptSettingsSource, /aria-label="ABA account number"/)
assert.doesNotMatch(receiptSettingsSource, /aria-label="ABA QR image"/)

// The other three literals called out by the audit must now be translated.
assert.match(receiptSettingsSource, /placeholder=\{t\('default_footer_placeholder'\)/)
assert.match(receiptSettingsSource, /placeholder=\{t\('custom_header_placeholder'\)/)
assert.match(receiptSettingsSource, /aria-label=\{t\('close_preview'\)/)

assert.doesNotMatch(receiptSettingsSource, /placeholder="Thank you!"/)
assert.doesNotMatch(receiptSettingsSource, /placeholder="e\.g\. \*\* OFFICIAL RECEIPT \*\*"/)
assert.doesNotMatch(receiptSettingsSource, /aria-label="Close preview"/)

// Every new key must resolve in BOTH packs with non-empty, distinct-from-English Khmer text.
for (const key of ['default_footer_placeholder', 'custom_header_placeholder', 'close_preview']) {
  assert.equal(typeof enPack[key], 'string', `missing en.json key ${key}`)
  assert.ok(enPack[key].length > 0, `en.json key ${key} is empty`)
  assert.equal(typeof kmPack[key], 'string', `missing km.json key ${key}`)
  assert.ok(kmPack[key].length > 0, `km.json key ${key} is empty`)
  assert.notEqual(kmPack[key], enPack[key], `km.json key ${key} was not actually translated`)
}

console.log('PASS receipt settings a11y labels use their own translation keys (i18n:12)')
