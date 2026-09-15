// P7-receipt-page-modes: `pageSizeMode` (measured | fixed | driver |
// auto-longest) and `fixedPageLengthMm` inside the receipt_print_settings
// JSON blob. Verifies the server-side enum/numeric guard routes/settings.ts's
// POST / applies before the blob is ever written to the settings table --
// same "copied verbatim against real SQLite, minus D1/Env plumbing" technique
// as test-receipt-text-contrast-settings.cjs, and the frontend parity
// counterpart normalizeReceiptPrintSettings in
// frontend/src/utils/receiptAppliedConfig.ts must accept exactly the same
// four literal values with the same 'measured' fallback.
//
// Run: node scripts/test-receipt-page-size-mode-settings.cjs

const assert = require('assert')
const Database = require('better-sqlite3')

// Copied verbatim from routes/settings.ts's sanitizeReceiptPrintSettingsValue.
const RECEIPT_PAGE_SIZE_MODES = new Set(['measured', 'fixed', 'driver', 'auto-longest'])
function sanitizeReceiptPrintSettingsValue(raw) {
  const asString = typeof raw === 'string' ? raw : JSON.stringify(raw)
  let parsed
  try {
    const candidate = JSON.parse(asString)
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return asString
    parsed = candidate
  } catch {
    return asString
  }
  parsed.pageSizeMode = RECEIPT_PAGE_SIZE_MODES.has(String(parsed.pageSizeMode)) ? String(parsed.pageSizeMode) : 'measured'
  const fixedLength = Number.parseFloat(String(parsed.fixedPageLengthMm ?? ''))
  parsed.fixedPageLengthMm = Number.isFinite(fixedLength) && fixedLength > 0 ? String(fixedLength) : '100'
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

check('default: settings with no pageSizeMode field are written as measured with a 100mm fallback length', () => {
  const stored = sanitizeReceiptPrintSettingsValue(JSON.stringify({ paperSize: '80mm' }))
  const parsed = JSON.parse(stored)
  assert.strictEqual(parsed.pageSizeMode, 'measured')
  assert.strictEqual(parsed.fixedPageLengthMm, '100')
  assert.strictEqual(parsed.paperSize, '80mm', 'other print settings fields pass through untouched')
})

check('enum validation: every real mode is accepted and preserved', () => {
  for (const mode of ['measured', 'fixed', 'driver', 'auto-longest']) {
    const stored = sanitizeReceiptPrintSettingsValue(JSON.stringify({ pageSizeMode: mode }))
    assert.strictEqual(JSON.parse(stored).pageSizeMode, mode)
  }
})

check('enum validation: any other value (typo, garbage, injected script) collapses to measured', () => {
  for (const bogus of ['Fixed', 'FIXED', 'auto', '', null, 0, false, '<script>alert(1)</script>', 'measured; DROP TABLE settings']) {
    const stored = sanitizeReceiptPrintSettingsValue(JSON.stringify({ pageSizeMode: bogus }))
    assert.strictEqual(JSON.parse(stored).pageSizeMode, 'measured', `expected 'measured' for bogus value ${JSON.stringify(bogus)}`)
  }
})

check('fixedPageLengthMm: a valid positive number round-trips as a string', () => {
  const stored = sanitizeReceiptPrintSettingsValue(JSON.stringify({ pageSizeMode: 'fixed', fixedPageLengthMm: 150 }))
  const parsed = JSON.parse(stored)
  assert.strictEqual(parsed.pageSizeMode, 'fixed')
  assert.strictEqual(parsed.fixedPageLengthMm, '150')
})

check('fixedPageLengthMm: zero, negative and non-numeric values fall back to 100', () => {
  for (const bogus of [0, -50, 'abc', null, undefined, '']) {
    const stored = sanitizeReceiptPrintSettingsValue(JSON.stringify({ fixedPageLengthMm: bogus }))
    assert.strictEqual(JSON.parse(stored).fixedPageLengthMm, '100', `expected fallback 100 for bogus value ${JSON.stringify(bogus)}`)
  }
})

check('a non-string body value (already-parsed object) is handled the same as the client\'s JSON string', () => {
  const stored = sanitizeReceiptPrintSettingsValue({ pageSizeMode: 'driver', paperSize: '80mm' })
  const parsed = JSON.parse(stored)
  assert.strictEqual(parsed.pageSizeMode, 'driver')
  assert.strictEqual(parsed.paperSize, '80mm')
})

check('malformed JSON is preserved as-is, never discarded (matches the rest of this route\'s "never guess at unparsable legacy data" stance)', () => {
  const malformed = '{not valid json'
  assert.strictEqual(sanitizeReceiptPrintSettingsValue(malformed), malformed)
})

check('end-to-end: POST /\'s upsert of a sanitized receipt_print_settings round-trips through real SQLite as fixed/150', () => {
  const incoming = JSON.stringify({ paperSize: '80mm', pageSizeMode: 'fixed', fixedPageLengthMm: '150' })
  upsertSetting('receipt_print_settings', sanitizeReceiptPrintSettingsValue(incoming))
  const stored = readSetting('receipt_print_settings')
  const parsed = JSON.parse(stored)
  assert.strictEqual(parsed.pageSizeMode, 'fixed')
  assert.strictEqual(parsed.fixedPageLengthMm, '150')
})

check('end-to-end: a bogus pageSizeMode sent by a stray/legacy client is normalized before it ever reaches the row', () => {
  const incoming = JSON.stringify({ paperSize: '80mm', pageSizeMode: 'ultra-fast-mode' })
  upsertSetting('receipt_print_settings', sanitizeReceiptPrintSettingsValue(incoming))
  const stored = readSetting('receipt_print_settings')
  assert.strictEqual(JSON.parse(stored).pageSizeMode, 'measured')
})

check('save-reload round trip: saving driver then reloading returns driver unchanged (settings round-trip)', () => {
  upsertSetting('receipt_print_settings', sanitizeReceiptPrintSettingsValue(JSON.stringify({ pageSizeMode: 'driver' })))
  const firstLoad = JSON.parse(readSetting('receipt_print_settings')).pageSizeMode
  assert.strictEqual(firstLoad, 'driver')
  // Simulate a second, unrelated settings save touching a different key --
  // must not perturb the already-stored page size mode.
  upsertSetting('business_name', 'Acme Co')
  const secondLoad = JSON.parse(readSetting('receipt_print_settings')).pageSizeMode
  assert.strictEqual(secondLoad, 'driver', 'pageSizeMode must survive an unrelated settings save')
})

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nAll receipt-page-size-mode-settings checks passed.')
