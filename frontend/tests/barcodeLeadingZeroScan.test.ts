// The CLIENT half of the 2026-09-06 owner report, verbatim:
//
//   "I see that barcode scanner cannot scan the beginning with zero the
//    leading zero for products that actually have barcode with leading 0."
//
// The server half is pinned in
// cloudflare/scripts/test-barcode-leading-zero-scan-pure.cjs. This file
// guards the three client-side seams where a scan can still come back
// empty even when the server answered correctly:
//
//   1. THE RE-FILTER. Several pickers take the server's page and re-filter
//      it locally with fuzzyTextMatches. Given the barcode as its own
//      field, that already folded PADDING at base -- but not the
//      UPC-E/UPC-A pair, which shares no substring at all and no amount of
//      ltrim() brings together, so the client dropped a row the server had
//      just matched.
//
//   2. THE JOINED HAYSTACK. A picker that pre-joins its fields into ONE
//      string ("name sku barcode") destroys the barcode as a discrete code
//      -- no per-field fold can see it any more, so even the padding fold
//      it already had never ran. Those call sites must pass the fields
//      separately.
//
//   3. THE HANDOFF. Nothing on the decode -> search box path may coerce the
//      scanned text to a number: Number('0123') is 123, which would destroy
//      the leading zero before any matcher ever sees it.
//
// WHAT ACTUALLY DISCRIMINATES, measured rather than asserted. This file
// cannot be LOADED against base 01f0c93c at all -- expandUpcE, compressUpcA,
// barcodeSearchKeys and searchTermBarcodeKeys are not exported there -- so
// "every assertion fails on base" would be a vacuous claim. Measured
// instead by replaying each assertion against the base kernel's own
// exports, the checks split three ways:
//
//   NEW BEHAVIOUR, red at base:
//     * the whole UPC-E half -- expandUpcE / compressUpcA / the pair in
//       barcodeSearchKeys, barcodeKeysMatch, the re-filter and the tier.
//       Base returns MATCH_TIER_OTHER (3) for a UPC-E scan against the row
//       stored as its UPC-A;
//     * 'pickers that re-filter locally pass barcode as its OWN field' --
//       TransferModal and NewSupplierReturnModal joined their fields into
//       one haystack at base;
//     * the two cross-kernel source guards, which name rules base has not
//       got.
//
//   RED ON 690086ff, GREEN AT BASE -- the keyspace regression this lane
//   introduced and then closed, which is exactly why the check must stay:
//     * 'the derived UPC-E spelling never leaks into the padding keyspace'.
//       Base has no derived key at all, so it cannot leak; 690086ff carried
//       the derived spelling zero-stripped and made the ordinary 7-digit
//       code '1234565' the same article as '012345000065'.
//
//   ALREADY TRUE AT BASE -- fences, not discriminators. Kept because the
//   UPC-E rule above is exactly the kind of change that could break them:
//     * padding in the re-filter and in the tier (base folded both);
//     * the fold never collapsing two different articles, the '0'
//       placeholder, the near-miss, the unrelated code;
//     * searchTermBarcodeKey's single-key contract;
//     * ordinary word search;
//     * no numeric coercion on the decode -> search box path.
//
// Run: node tests/barcodeLeadingZeroScan.test.ts

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  barcodeKeysMatch,
  barcodeSearchKeys,
  compressUpcA,
  expandUpcE,
  fuzzyTextMatches,
  MATCH_TIER_EXACT_BARCODE,
  normalizeBarcodeKey,
  searchRelevanceTier,
  searchTermBarcodeKey,
  searchTermBarcodeKeys,
} from '../src/utils/searchMatch.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

// The same fixtures the Worker test uses, so the two halves cannot drift.
const PADDED_STORED = '0748485110011'
const PADDED_BARE = '748485110011'
const BARE_STORED = '885909950805'
const BARE_SCANNED_PADDED = '0885909950805'
const UPCE = '01234565'
const UPCA = '012345000065'

// --- 1. the kernel -----------------------------------------------------

check('UPC-E expands to the UPC-A its check digit proves', () => {
  assert.equal(expandUpcE(UPCE), UPCA)
  assert.equal(expandUpcE('04963406'), '049000006346')
  // Not a UPC-E: wrong check digit, wrong length, wrong number system.
  assert.equal(expandUpcE('20123458'), '')
  assert.equal(expandUpcE('0123456'), '')
  assert.equal(expandUpcE('91234565'), '')
})

check('UPC-A compresses back to the same UPC-E, or to nothing', () => {
  assert.equal(compressUpcA(UPCA), UPCE)
  assert.equal(compressUpcA(`0${UPCA}`), UPCE, 'the EAN-13 spelling must compress too')
  assert.equal(compressUpcA('049000006346'), '04963406')
  // A UPC-A with no zero run has no compressed form at all.
  assert.equal(compressUpcA('012345678905'), '')
})

check('barcodeSearchKeys carries every spelling one article is printed under', () => {
  // TWO keyspaces. The padding key is the zero-stripped form; the UPC pair
  // is namespaced and always the FULL printed spelling, so a derived key can
  // only ever meet another derived key.
  assert.deepEqual(barcodeSearchKeys(UPCE), ['1234565', `upce:${UPCE}`, `upca:${UPCA}`])
  assert.deepEqual(barcodeSearchKeys(UPCA), ['12345000065', `upca:${UPCA}`, `upce:${UPCE}`])
  // ...and through the EAN-13 and GTIN-14 spellings of the same UPC-A.
  assert.ok(barcodeSearchKeys(`0${UPCA}`).includes(`upce:${UPCE}`))
  assert.ok(barcodeSearchKeys(`00${UPCA}`).includes(`upce:${UPCE}`))
  // A plain code still yields exactly one key -- no invented equivalents.
  assert.deepEqual(barcodeSearchKeys(PADDED_STORED), [PADDED_BARE])
  assert.deepEqual(barcodeSearchKeys('0'), [], 'the placeholder is not a barcode')
  // The keyspace guarantee: the derived UPC-E spelling must never appear as
  // a bare zero-stripped key, because '1234565' is a legitimate 7-digit
  // internal code some other product may own.
  assert.ok(!barcodeSearchKeys(UPCA).includes('1234565'))
})

check('the derived UPC-E spelling never leaks into the padding keyspace', () => {
  // '012345000065' compresses to '01234565', which zero-strips to '1234565'.
  // Carried as a plain key that made an unrelated 7-digit internal code the
  // same article. Namespaced, it cannot.
  assert.ok(!barcodeKeysMatch(UPCA, '1234565'))
  assert.ok(!barcodeKeysMatch('1234565', UPCA))
  assert.notEqual(
    searchRelevanceTier({ name: 'Internal Seven Digit Item', barcode: '1234565' }, UPCA),
    MATCH_TIER_EXACT_BARCODE,
  )
  // A padding twin of that internal code is still its own article, both ways.
  assert.ok(barcodeKeysMatch('1234565', '01234565'), 'padding still folds')
})

check('barcodeKeysMatch folds padding AND the UPC-E pair, both directions', () => {
  assert.ok(barcodeKeysMatch(PADDED_BARE, PADDED_STORED))
  assert.ok(barcodeKeysMatch(BARE_SCANNED_PADDED, BARE_STORED))
  assert.ok(barcodeKeysMatch(BARE_STORED, BARE_SCANNED_PADDED))
  assert.ok(barcodeKeysMatch(UPCE, UPCA))
  assert.ok(barcodeKeysMatch(UPCA, UPCE))
})

check('the fold never collapses two genuinely different articles', () => {
  assert.ok(!barcodeKeysMatch(PADDED_STORED, '0748485110012'))
  assert.ok(!barcodeKeysMatch(UPCE, '01234665'))
  assert.ok(!barcodeKeysMatch('0', '0'), 'the shared placeholder is never an identity')
  assert.ok(!barcodeKeysMatch('20123458', '0123458'))
})

check('searchTermBarcodeKey keeps its single-key contract for old callers', () => {
  assert.equal(searchTermBarcodeKey(PADDED_STORED), PADDED_BARE)
  assert.equal(searchTermBarcodeKey('dior 3348901770569'), '', 'two words is a normal search')
  assert.deepEqual(searchTermBarcodeKeys('dior 3348901770569'), [])
})

// --- 2. the client re-filter ------------------------------------------

check('re-filter: a scan with a leading zero still matches the bare stored code', () => {
  // Fields passed SEPARATELY, the way a picker must do it.
  assert.ok(
    fuzzyTextMatches(['Bare Only Cleanser', null, BARE_STORED], BARE_SCANNED_PADDED),
    'the client dropped a row the server matches',
  )
})

check('re-filter: the UPC-E/UPC-A pair matches although they share no substring', () => {
  assert.ok(fuzzyTextMatches(['Small Package Balm', null, UPCA], UPCE))
  assert.ok(fuzzyTextMatches(['Compressed Tin', null, '04963406'], '049000006346'))
})

check('re-filter: an unrelated code is still rejected', () => {
  // Deliberately far apart, because the WORD path underneath is fuzzy by
  // design (it tolerates a one-character typo, which predates this lane and
  // is what keeps a mistyped name searchable). What this lane must not do
  // is make two different codes the SAME BARCODE -- asserted on the tier in
  // the next check, where "identity" actually lives.
  assert.ok(!fuzzyTextMatches(['Different Article', null, '5012345678900'], PADDED_BARE))
  assert.ok(!fuzzyTextMatches(['Small Package Balm', null, UPCA], '77712345'))
})

check('re-filter: a near-miss code is never promoted to barcode IDENTITY', () => {
  // One digit off is a different article. It may still surface through the
  // fuzzy word path (it did before this lane too), but it must never be
  // treated as the scanned code itself.
  assert.notEqual(
    searchRelevanceTier({ name: 'Different Article', barcode: '0748485110012' }, PADDED_BARE),
    MATCH_TIER_EXACT_BARCODE,
  )
  assert.notEqual(
    searchRelevanceTier({ name: 'Small Package Balm', barcode: UPCA }, '01234665'),
    MATCH_TIER_EXACT_BARCODE,
  )
  assert.notEqual(
    searchRelevanceTier({ name: 'Legacy Placeholder', barcode: '0' }, '0'),
    MATCH_TIER_EXACT_BARCODE,
  )
})

check('re-filter: ordinary word search is untouched by the barcode path', () => {
  assert.ok(fuzzyTextMatches(['Dior Backstage Highlighter', null, '3348901770569'], 'backstage'))
  assert.ok(fuzzyTextMatches(['Cover Concealer', null, ''], 'concealer cover'))
  assert.ok(!fuzzyTextMatches(['Dior Backstage', null, ''], 'chanel'))
})

check('relevance: the folded row is still the EXACT-BARCODE tier, so it leads', () => {
  assert.equal(
    searchRelevanceTier({ name: 'Bare Only Cleanser', barcode: BARE_STORED }, BARE_SCANNED_PADDED),
    MATCH_TIER_EXACT_BARCODE,
  )
  assert.equal(
    searchRelevanceTier({ name: 'Small Package Balm', barcode: UPCA }, UPCE),
    MATCH_TIER_EXACT_BARCODE,
  )
})

// --- 3. source-shape guards -------------------------------------------

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

check('no numeric coercion anywhere on the decode -> search box path', () => {
  for (const file of [
    '../src/components/products/scanning/scanbotScanner.ts',
    '../src/components/products/scanning/barcodeImageScanner.ts',
    '../src/components/products/scanning/barcodeScannerState.ts',
    '../src/components/products/scanning/BarcodeScannerModal.tsx',
    '../src/components/shared/ScanSearchButton.tsx',
  ]) {
    const src = read(file)
    // Number(...) / parseInt(...) / parseFloat(...) / unary + on the scanned
    // text would all silently drop a leading zero.
    assert.ok(!/\bparseInt\s*\(/.test(src), `${file} parses the scan as an integer`)
    assert.ok(!/\bparseFloat\s*\(/.test(src), `${file} parses the scan as a float`)
    assert.ok(!/\bNumber\s*\(/.test(src), `${file} coerces the scan to a Number`)
  }
})

check('pickers that re-filter locally pass barcode as its OWN field', () => {
  // A pre-joined "name sku barcode" string is not a barcode any more: the
  // fold cannot see a discrete code inside a sentence, so these call sites
  // must hand the fields over separately.
  for (const file of [
    '../src/components/branches/TransferModal.tsx',
    '../src/components/catalog/CatalogPage.tsx',
  ]) {
    const src = read(file)
    const joinedHaystack = /fuzzyTextMatches\(\s*\[[^\]]*\]\s*\.join\(/.test(src)
    assert.ok(!joinedHaystack, `${file} joins its haystack before fuzzyTextMatches`)
  }
})

check('the shared kernel is the ONLY place the UPC-E rule is implemented', () => {
  // One rule, one implementation: nothing outside the two searchMatch
  // copies may hand-roll an expansion.
  const offenders: string[] = []
  for (const file of [
    '../src/utils/productGrouping.ts',
    '../src/components/products/helpers/productCreateMatch.ts',
    '../src/components/returns/NewSupplierReturnModal.tsx',
  ]) {
    if (/expandUpcE\s*=|function\s+expandUpcE/.test(read(file))) offenders.push(file)
  }
  assert.deepEqual(offenders, [])
})

// --- 4. a scan never AUTO-PICKS, on any surface ------------------------
//
// Owner rule (barcode-scan-select-then-confirm): a scan fills the search
// box, the list narrows, and the OPERATOR chooses the row. It is the same
// rule as the fold above seen from the other side -- a fold that finally
// finds the right row is worth nothing if the surface then commits to a row
// on the operator's behalf.
//
// The Returns replacement search was the last surface that broke it: it
// picked a row outright on an exact barcode/SKU match. dcbaa40f (the
// one-option-sheet rewrite, already in base 01f0c93c) replaced that whole
// section with a single catalog search plus an explicit option sheet, so
// the auto-pick is gone. This guard is what stops it coming back -- and it
// is mechanical over EVERY scan surface, not a note about one of them.
const SRC_ROOT = new URL('../src/', import.meta.url)

function walkSourceFiles(dirUrl: URL): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dirUrl, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...walkSourceFiles(new URL(`${entry.name}/`, dirUrl)))
    else if (/\.tsx?$/.test(entry.name)) found.push(fileURLToPath(new URL(entry.name, dirUrl)))
  }
  return found
}

// The text between a `{` and its matching `}`, so a handler written inline
// is read whole rather than to the first brace that happens to close.
function balanced(src: string, openIndex: number, open = '{', close = '}'): string {
  let depth = 0
  for (let i = openIndex; i < src.length; i += 1) {
    if (src[i] === open) depth += 1
    else if (src[i] === close) {
      depth -= 1
      if (depth === 0) return src.slice(openIndex, i + 1)
    }
  }
  return src.slice(openIndex)
}

// A function defined in the same file, by either spelling this codebase
// uses (`const f = (…) => {…}` / `useCallback((…) => {…})`, `function f`).
function localFunctionBody(src: string, name: string): string {
  const decl = new RegExp(`(?:const\\s+${name}\\s*(?::[^=]+)?=|function\\s+${name}\\b)`).exec(src)
  if (!decl) return ''
  const brace = src.indexOf('{', decl.index)
  return brace === -1 ? '' : balanced(src, brace)
}

// "chooses a row for the operator". setPicked(null) / setXPicking(null) are
// the opposite -- they CLEAR a pick -- so only a non-null argument counts.
const AUTO_PICK_CALL = /\b(?:pick|choose|select)[A-Z]\w*\s*\(/
const AUTO_PICK_SETTER = /\bset(?:\w*Pick\w*|SelectedProduct|SelectedCandidate|SelectedRow)\s*\(\s*(?!null\b|\)|undefined\b)/

check('no scan handler on any surface picks a row for the operator', () => {
  const offenders: string[] = []
  let surfaces = 0
  for (const file of walkSourceFiles(SRC_ROOT)) {
    const src = readFileSync(file, 'utf8')
    if (!src.includes('ScanSearchButton') && !src.includes('BarcodeScannerModal')) continue
    // Windows hands back backslashes; normalize so the failure message
    // names the file the way the repo does.
    const posix = file.replace(/\\/g, '/')
    const shortName = posix.slice(posix.indexOf('/src/') + 1)
    for (const match of src.matchAll(/onDetected=\{/g)) {
      surfaces += 1
      const handler = balanced(src, match.index + 'onDetected='.length)
      // Follow the handler into whatever it calls in its own file, so a
      // one-line `onDetected={(v) => void searchX(v)}` is not a blind spot.
      // Depth 3 reaches search -> apply-results helpers.
      let text = handler
      const seen = new Set<string>()
      for (let depth = 0; depth < 3; depth += 1) {
        let grown = text
        for (const call of text.matchAll(/\b([a-zA-Z_$][\w$]*)\s*\(/g)) {
          const name = call[1]
          if (seen.has(name)) continue
          seen.add(name)
          grown += `\n${localFunctionBody(src, name)}`
        }
        if (grown === text) break
        text = grown
      }
      const picked = AUTO_PICK_CALL.exec(text) || AUTO_PICK_SETTER.exec(text)
      if (picked) offenders.push(`${shortName}: ${picked[0].trim()}`)
    }
  }
  // A sweep that finds nothing reports the same "no offenders" as a clean
  // one, so the instrument gets its own floor. 23 onDetected surfaces across
  // 19 files on 2026-09-07; the floor sits well under that so a lane may
  // retire one without a false alarm, but a broken walk cannot pass.
  assert.ok(surfaces >= 15, `only ${surfaces} scan surfaces found -- the sweep stopped seeing them`)
  assert.deepEqual(offenders, [], 'a scan handler commits to a row instead of narrowing the list')
})

check('the Returns replacement search narrows the list and stops there', () => {
  const src = read('../src/components/returns/NewReturnModal.tsx')
  const body = localFunctionBody(src, 'searchReplacementCatalog')
  assert.ok(body.includes('setReplacementResults('), 'the replacement search must still fill the candidate list')
  assert.ok(!/exactBarcode|pickReplacementRow/.test(src),
    'the exact-barcode auto-pick is back in the Returns replacement search')
  assert.ok(!AUTO_PICK_SETTER.test(body) && !AUTO_PICK_CALL.test(body),
    'the replacement search picks a row for the operator')
})

check('the frontend and Worker barcode kernels state the same rule', () => {
  const fe = read('../src/utils/searchMatch.ts')
  const cf = read('../../cloudflare/src/lib/searchMatch.ts')
  for (const fn of ['expandUpcE', 'compressUpcA', 'barcodeSearchKeys', 'upcCheckDigit']) {
    assert.ok(fe.includes(`function ${fn}`), `frontend kernel is missing ${fn}`)
    assert.ok(cf.includes(`function ${fn}`), `Worker kernel is missing ${fn}`)
  }
})

console.log(`\nOK - ${passed} checks passed.`)
