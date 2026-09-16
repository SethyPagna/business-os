// Section 4 (2026-09-02 RC): "Text contrast" (Normal | Maximum black) receipt
// setting. Verifies the server-side enum guard routes/settings.ts's POST /
// applies to the receipt_template JSON blob before it is ever written to the
// settings table, using the exact SQL upsert shape that route runs (same
// "copied verbatim against real SQLite, minus D1/Env plumbing" technique as
// test-settings-meta-scoping.cjs).
//
// Run: node scripts/test-receipt-text-contrast-settings.cjs

const assert = require('assert')
const Database = require('better-sqlite3')

// Copied verbatim from routes/settings.ts's sanitizeReceiptTemplateValue.
// Any value other than the literal 'maximum' resolves to 'normal' -- this is
// the ONLY field-level validation POST / performs on the receipt_template
// blob; every other template field stays opaque JSON the frontend already
// normalizes on its own.
function sanitizeReceiptTemplateValue(raw) {
  const asString = typeof raw === 'string' ? raw : JSON.stringify(raw)
  let parsed
  try {
    const candidate = JSON.parse(asString)
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return asString
    parsed = candidate
  } catch {
    return asString
  }
  parsed.text_contrast = parsed.text_contrast === 'maximum' ? 'maximum' : 'normal'
  return JSON.stringify(parsed)
}

const db = new Database(':memory:')
db.exec(`
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT
  );
`)

// Copied verbatim (same SQL shape) from routes/settings.ts's POST / upsert.
function upsertSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  ).run(key, value)
}

function readSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? row.value : null
}

let failed = 0
function check(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

check('default: a template with no text_contrast field is written as normal', () => {
  const stored = sanitizeReceiptTemplateValue(JSON.stringify({ font_family: 'monospace', font_size: 12 }))
  const parsed = JSON.parse(stored)
  assert.strictEqual(parsed.text_contrast, 'normal')
  assert.strictEqual(parsed.font_family, 'monospace', 'other template fields must pass through untouched')
})

check('enum validation: the literal "maximum" is accepted and preserved', () => {
  const stored = sanitizeReceiptTemplateValue(JSON.stringify({ text_contrast: 'maximum' }))
  assert.strictEqual(JSON.parse(stored).text_contrast, 'maximum')
})

check('enum validation: any other value (typo, garbage, injected script) collapses to normal', () => {
  for (const bogus of ['Maximum', 'MAXIMUM', 'high', '', null, 0, false, '<script>alert(1)</script>', 'normal; DROP TABLE settings']) {
    const stored = sanitizeReceiptTemplateValue(JSON.stringify({ text_contrast: bogus }))
    assert.strictEqual(JSON.parse(stored).text_contrast, 'normal', `expected 'normal' for bogus value ${JSON.stringify(bogus)}`)
  }
})

check('enum validation: a non-string body value (already-parsed object) is handled the same as the client\'s JSON string', () => {
  const stored = sanitizeReceiptTemplateValue({ text_contrast: 'maximum', font_size: 14 })
  const parsed = JSON.parse(stored)
  assert.strictEqual(parsed.text_contrast, 'maximum')
  assert.strictEqual(parsed.font_size, 14)
})

check('malformed JSON is preserved as-is, never discarded (matches the rest of this route\'s "never guess at unparsable legacy data" stance)', () => {
  const malformed = '{not valid json'
  assert.strictEqual(sanitizeReceiptTemplateValue(malformed), malformed)
})

check('end-to-end: POST /\'s upsert of a sanitized receipt_template round-trips through real SQLite as maximum', () => {
  const incoming = JSON.stringify({ font_family: 'sans', text_contrast: 'maximum' })
  upsertSetting('receipt_template', sanitizeReceiptTemplateValue(incoming))
  const stored = readSetting('receipt_template')
  assert.strictEqual(JSON.parse(stored).text_contrast, 'maximum')
})

check('end-to-end: a bogus text_contrast sent by a stray/legacy client is normalized before it ever reaches the row', () => {
  const incoming = JSON.stringify({ font_family: 'serif', text_contrast: 'ultra-black-please' })
  upsertSetting('receipt_template', sanitizeReceiptTemplateValue(incoming))
  const stored = readSetting('receipt_template')
  assert.strictEqual(JSON.parse(stored).text_contrast, 'normal')
})

check('save-reload round trip: saving maximum then reloading returns maximum unchanged (settings round-trip)', () => {
  upsertSetting('receipt_template', sanitizeReceiptTemplateValue(JSON.stringify({ text_contrast: 'maximum' })))
  const firstLoad = JSON.parse(readSetting('receipt_template')).text_contrast
  assert.strictEqual(firstLoad, 'maximum')
  // Simulate a second, unrelated settings save touching a different key --
  // must not perturb the already-stored contrast value.
  upsertSetting('business_name', 'Acme Co')
  const secondLoad = JSON.parse(readSetting('receipt_template')).text_contrast
  assert.strictEqual(secondLoad, 'maximum', 'text_contrast must survive an unrelated settings save')
})

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nAll receipt-text-contrast-settings checks passed.')
