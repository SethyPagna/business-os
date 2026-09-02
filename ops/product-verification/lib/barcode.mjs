// Barcode classification shared by verify-products.mjs and reconcile.mjs.
//
// The threshold for "too short to identify a product" (4 characters) mirrors
// cloudflare/src/lib/productIdentity.ts's MIN_REAL_BARCODE_LENGTH -- that file
// notes 238 production rows share the placeholder barcode "0" -- but this
// module is intentionally standalone (no import from cloudflare/src) so the
// ops/ verification tooling never depends on the Worker bundle. If the two
// ever need to diverge, that is a decision to make explicitly, not a bug.
const MIN_REAL_BARCODE_LENGTH = 4

const VALID_GTIN_LENGTHS = new Set([8, 12, 13, 14])

/**
 * Validates a GTIN-8/12/13/14 check digit using the standard modulo-10
 * algorithm (weights 3/1 alternating from the digit immediately left of the
 * check digit). Verified against 15 real barcodes independently checked by
 * the prior migration's web-verification pass (see
 * ops/product-verification/fixtures/barcode-web-evidence.json) -- all 15
 * expected/actual verdicts match this implementation exactly.
 * @param {string} digits
 * @returns {boolean}
 */
export function gtinCheckDigitValid(digits) {
  if (!/^\d+$/.test(digits)) return false
  if (!VALID_GTIN_LENGTHS.has(digits.length)) return false
  const nums = digits.split('').map(Number)
  const check = nums.pop()
  let sum = 0
  for (let i = 0; i < nums.length; i += 1) {
    const posFromRight = nums.length - i
    const weight = posFromRight % 2 === 1 ? 3 : 1
    sum += nums[i] * weight
  }
  const expected = (10 - (sum % 10)) % 10
  return expected === check
}

/**
 * @typedef {Object} BarcodeClassification
 * @property {string} raw
 * @property {string} digits          digits-only form (for GTIN-shaped codes)
 * @property {boolean} isJunk         true when this barcode cannot serve as corroborating evidence
 * @property {'blank'|'zero'|'too_short'|'non_numeric'|'invalid_check_digit'|'valid_gtin'} reason
 */

/**
 * Classifies a single barcode string. A barcode is "junk" -- unusable as
 * corroborating evidence -- when it is blank, the legacy placeholder "0",
 * shorter than MIN_REAL_BARCODE_LENGTH, contains non-digit characters (a
 * SKU-shaped placeholder like "arigrande10ml", never a real GTIN), or is
 * GTIN-length but fails its check digit. Anything else is a usable GTIN.
 * @param {unknown} rawValue
 * @returns {BarcodeClassification}
 */
export function classifyBarcode(rawValue) {
  const raw = String(rawValue ?? '').trim()
  if (!raw) return { raw, digits: '', isJunk: true, reason: 'blank' }
  if (raw === '0') return { raw, digits: '0', isJunk: true, reason: 'zero' }
  if (raw.length < MIN_REAL_BARCODE_LENGTH) return { raw, digits: raw.replace(/\D/g, ''), isJunk: true, reason: 'too_short' }
  const digits = raw.replace(/\D/g, '')
  if (digits !== raw.replace(/\s/g, '')) {
    // Contains non-digit, non-whitespace characters (letters, punctuation
    // beyond spaces) -- not a GTIN, a placeholder SKU string.
    return { raw, digits, isJunk: true, reason: 'non_numeric' }
  }
  if (VALID_GTIN_LENGTHS.has(digits.length)) {
    if (!gtinCheckDigitValid(digits)) return { raw, digits, isJunk: true, reason: 'invalid_check_digit' }
    return { raw, digits, isJunk: false, reason: 'valid_gtin' }
  }
  // Numeric but not a standard GTIN length (e.g. an internal SKU number).
  // Not long enough/shaped enough to trust as a GTIN, but not the classic
  // junk cases either -- treat conservatively as junk (cannot be checked).
  return { raw, digits, isJunk: true, reason: 'non_numeric' }
}

/**
 * The canonical form used to compare two barcode strings for "are these
 * really the same code" -- strips a single leading zero pad (the recurring
 * real-data case: "0819265008016" vs "819265008016" is one 13-digit GTIN
 * recorded with and without a leading zero, not two different barcodes).
 * @param {unknown} rawValue
 * @returns {string}
 */
export function canonicalBarcodeKey(rawValue) {
  const raw = String(rawValue ?? '').trim()
  if (!raw) return ''
  if (!/^\d+$/.test(raw)) return raw.toLowerCase()
  return raw.replace(/^0+(?=\d)/, '')
}

/**
 * Deduplicates a barcode list by canonical key, preserving first-seen order
 * and the original (non-canonicalized) string for display.
 * @param {unknown[]} barcodes
 * @returns {string[]}
 */
export function dedupeBarcodes(barcodes) {
  const seen = new Set()
  const out = []
  for (const value of Array.isArray(barcodes) ? barcodes : []) {
    const raw = String(value ?? '').trim()
    if (!raw) continue
    const key = canonicalBarcodeKey(raw)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(raw)
  }
  return out
}

/**
 * True when two barcode sets are the same after canonicalization (order and
 * leading-zero padding ignored).
 * @param {unknown[]} a
 * @param {unknown[]} b
 * @returns {boolean}
 */
export function sameBarcodeSet(a, b) {
  const keysA = new Set((Array.isArray(a) ? a : []).map(canonicalBarcodeKey).filter(Boolean))
  const keysB = new Set((Array.isArray(b) ? b : []).map(canonicalBarcodeKey).filter(Boolean))
  if (keysA.size !== keysB.size) return false
  for (const key of keysA) if (!keysB.has(key)) return false
  return true
}

export { MIN_REAL_BARCODE_LENGTH }
