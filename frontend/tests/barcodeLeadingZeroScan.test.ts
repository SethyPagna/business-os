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
//       one haystack at base. The check is now a CLOSED SWEEP over every
//       call site of the shared matcher rather than a two-file spot check:
//       it enumerates POS.tsx, productFilterHelpers.ts, CatalogPage.tsx,
//       TransferModal.tsx (array shape -- these inherit the fold through
//       buildHaystackIndex's per-field flatMap) and Inventory.tsx,
//       Returns.tsx, DeliveryTab.tsx (joined shape -- lawful only because
//       none of those haystacks carries a barcode field), and fails if a
//       new picker calls the matcher without declaring which it is;
//     * the two cross-kernel source guards, which name rules base has not
//       got.
//
//   RED ON A LATER COMMIT OF THIS LANE, GREEN AT BASE -- keyspace
//   regressions this lane introduced and then closed, which is exactly why
//   these checks must stay. Neither discriminates against base (base derives
//   no equivalent key at all, so it passes both vacuously); each names the
//   commit it actually caught:
//     * 'the derived UPC-E spelling never leaks into the padding keyspace'.
//       Red on 690086ff, which carried the derived spelling zero-stripped
//       and made the ordinary 7-digit code '1234565' the same article as
//       '012345000065'.
//     * 'the literal spellings the Worker probes agree with what the JS fold
//       matches'. Red on ece45a28, where barcodeKeyPlan padded BOTH halves of
//       the pair, so the Worker emitted '00000001234565' and '000001234565'
//       as literal index probes for a UPC-A scan. Those are ordinary padded
//       spellings of that same unrelated '1234565', and barcodeKeysMatch says
//       so -- this is the one check that holds the SQL builder and the JS
//       kernel to the same answer, which matters because the Worker matches
//       on the spellings it emits, not on what barcodeKeysMatch would say.
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
import { barcodeKeyPlan as workerBarcodeKeyPlan, barcodeSearchKeys as workerBarcodeSearchKeys } from '../../cloudflare/src/lib/searchMatch.ts'

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

// EVERY call site of the shared client matcher, enumerated. The fold lives
// at utils/searchMatch.ts:306 (termMatchesBarcode, tried at the head of
// termMatchesHaystack) and reaches a record only through
// buildHaystackIndex's per-field pass (utils/searchMatch.ts:261): the index
// flatMaps an ARRAY of fields and derives barcodeSearchKeys from each field
// on its own. A caller that pre-joins its fields into one string hands the
// index a sentence, and no per-field fold can find a discrete code inside a
// sentence -- so a pre-joined haystack that carries a barcode silently loses
// the fold and drops rows the server just matched.
//
// Two lawful shapes, and this sweep pins which one each call site is:
//   * ARRAY -- passes its fields as an array, so it inherits the fold;
//   * JOINED -- pre-joins, which is only lawful because the haystack it
//     builds carries NO barcode field at all (movements, returns and
//     delivery contacts do not hold one), so there is no fold to lose.
// The enumeration is closed: a picker file that starts calling the matcher
// and is not listed here fails the sweep rather than silently choosing a
// shape.
const LOCAL_REFILTER_CALL_SITES: Array<{
  file: string
  shape: 'array' | 'joined'
  // JOINED sites only: the local/imported builders whose text IS the
  // haystack, read whole and required to hold no barcode field.
  builders?: Array<{ file: string, name: string }>
}> = [
  { file: '../src/components/branches/TransferModal.tsx', shape: 'array' },
  { file: '../src/components/catalog/CatalogPage.tsx', shape: 'array' },
  { file: '../src/components/pos/POS.tsx', shape: 'array' },
  { file: '../src/components/products/helpers/productFilterHelpers.ts', shape: 'array' },
  {
    file: '../src/components/contacts/DeliveryTab.tsx',
    shape: 'joined',
    builders: [],
  },
  {
    file: '../src/components/inventory/Inventory.tsx',
    shape: 'joined',
    builders: [
      { file: '../src/components/inventory/Inventory.tsx', name: 'movHay' },
      { file: '../src/components/inventory/movementGroups.ts', name: 'movementGroupHaystack' },
    ],
  },
  {
    file: '../src/components/returns/Returns.tsx',
    shape: 'joined',
    builders: [{ file: '../src/components/returns/Returns.tsx', name: 'buildReturnHaystack' }],
  },
]

const MATCHER_CALL = /\b(?:fuzzyTextMatches|matchesSearchTermGroups)\s*\(/g

// Comments in this codebase name the matcher constantly ("Routed through
// fuzzyTextMatches (searchMatch.ts)"), so the sweep reads code only. `//`
// preceded by `:` is left alone so a URL inside a string is not treated as
// the start of a comment.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

// The first argument of a call, read by balanced parentheses so a nested
// call or array literal is taken whole rather than to the first comma.
function firstCallArgument(src: string, callEnd: number): string {
  const open = src.lastIndexOf('(', callEnd)
  const whole = balanced(src, open, '(', ')').slice(1, -1)
  let depth = 0
  for (let i = 0; i < whole.length; i += 1) {
    const c = whole[i]
    if (c === '(' || c === '[' || c === '{') depth += 1
    else if (c === ')' || c === ']' || c === '}') depth -= 1
    else if (c === ',' && depth === 0) return whole.slice(0, i)
  }
  return whole
}

// Several call sites bind the haystack a line above the call
// (`const haystack = [...]`, `const hay = [...]`). Resolve a bare identifier
// to that binding so the shape check reads the real expression; anything
// that is not a local const (a function parameter, for instance) resolves to
// '' and is covered by its declared builders instead.
function resolveHaystackExpression(src: string, arg: string): string {
  const name = arg.trim()
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return arg
  const decl = new RegExp(`\\bconst\\s+${name}\\s*(?::[^=\\n]+)?=\\s*`).exec(src)
  if (!decl) return ''
  const start = decl.index + decl[0].length
  if (src[start] === '[') return balanced(src, start, '[', ']')
  return src.slice(start, src.indexOf('\n', start))
}

check('pickers that re-filter locally pass barcode as its OWN field', () => {
  // 1. The enumeration is closed: sweep src for matcher calls and require
  //    every file that makes one to be listed above.
  const srcRoot = new URL('../src/', import.meta.url)
  const listed = new Set(LOCAL_REFILTER_CALL_SITES.map((site) => site.file))
  const unlisted: string[] = []
  for (const abs of walkSourceFiles(srcRoot)) {
    const rel = `../src/${abs.slice(fileURLToPath(srcRoot).length).split(/[\\/]/).join('/')}`
    if (/\/utils\/searchMatch\.ts$/.test(rel)) continue // the kernel itself
    if (!MATCHER_CALL.test(stripComments(readFileSync(abs, 'utf8')))) { MATCHER_CALL.lastIndex = 0; continue }
    MATCHER_CALL.lastIndex = 0
    if (!listed.has(rel)) unlisted.push(rel)
  }
  assert.deepEqual(unlisted, [],
    'a picker calls the shared matcher without declaring whether it passes barcode as its own field')

  // 2. Every ARRAY site really passes an array, and never a joined one.
  //    Every JOINED site really joins nothing that holds a barcode.
  for (const site of LOCAL_REFILTER_CALL_SITES) {
    const src = stripComments(read(site.file))
    MATCHER_CALL.lastIndex = 0
    let hit: RegExpExecArray | null
    let calls = 0
    while ((hit = MATCHER_CALL.exec(src))) {
      const arg = resolveHaystackExpression(src, firstCallArgument(src, hit.index + hit[0].length - 1))
      calls += 1
      if (site.shape === 'array') {
        assert.ok(arg.trimStart().startsWith('['),
          `${site.file}: the matcher's haystack is not an array literal (${arg.trim().slice(0, 60)})`)
        assert.ok(!/\.join\s*\(/.test(arg),
          `${site.file} joins its haystack before the matcher -- the per-field barcode fold cannot see a code inside a sentence`)
        assert.ok(/barcode/.test(arg),
          `${site.file}: the product haystack no longer carries barcode as its own field`)
      } else {
        assert.ok(!/barcode/.test(arg),
          `${site.file}: a pre-joined haystack now carries a barcode -- pass the fields as an array instead, or the fold is lost`)
      }
    }
    assert.ok(calls > 0, `${site.file} no longer calls the shared matcher; drop it from the enumeration`)
    for (const builder of site.builders || []) {
      const body = localFunctionBody(read(builder.file), builder.name)
      assert.ok(body, `${builder.file}: ${builder.name} not found`)
      assert.ok(!/barcode/.test(body),
        `${builder.file}: ${builder.name} joins a barcode into its haystack -- the fold cannot see it there`)
    }
  }

  // 3. The one picker that folds explicitly instead of through the index.
  //    NewSupplierReturnModal keeps a joined `.includes()` haystack for the
  //    word path but calls barcodeKeysMatch on the barcode FIELD first, so
  //    the fold is present; if that call goes, the joined haystack is all
  //    that is left and a UPC-E scan comes back empty.
  const supplierReturn = read('../src/components/returns/NewSupplierReturnModal.tsx')
  assert.ok(/barcodeKeysMatch\s*\(\s*raw\s*,\s*product\.barcode\s*\)/.test(supplierReturn),
    'NewSupplierReturnModal no longer folds the barcode field before its joined haystack')
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

// The JS kernel and the SQL the Worker builds are two implementations of one
// rule, and only the JS half is exercised by the checks above. This is the
// place they are made to agree on the case that actually went wrong: the
// Worker does not compare strings, it emits LITERAL spellings for an index
// probe, so a spelling it emits is a row it will match REGARDLESS of what
// barcodeKeysMatch would have said about that row.
check('the literal spellings the Worker probes agree with what the JS fold matches', () => {
  // Every padded spelling of the UPC-E half is a code some unrelated short
  // internal item legitimately owns, and the JS fold already says so.
  assert.ok(!barcodeKeysMatch(UPCA, '00000001234565'), 'JS: a GTIN-14 padding of 1234565 is its own article')
  assert.ok(!barcodeKeysMatch(UPCA, '000001234565'), 'JS: a 12-wide padding of 1234565 is its own article')
  // So the Worker may not probe those spellings either. It probes the BARE
  // printed UPC-E and the UPC-A at the widths one article is really stored
  // at (12 / EAN-13 / GTIN-14).
  const plan = workerBarcodeKeyPlan(workerBarcodeSearchKeys(UPCA))
  const probed = [...plan.equivalentLiterals, ...plan.paddingLiterals]
  for (const spelling of ['00000001234565', '000001234565', '0000001234565', '001234565']) {
    assert.ok(!probed.includes(spelling),
      `the Worker probes ${spelling}, a padded spelling of the unrelated internal code 1234565, which the JS fold rejects`)
  }
  assert.ok(plan.equivalentLiterals.includes(UPCE), 'the bare printed UPC-E must still be probed')
  assert.ok(plan.equivalentLiterals.includes(UPCA), 'the UPC-A itself must still be probed')
  assert.ok(plan.equivalentLiterals.includes('00' + UPCA), 'the UPC-A at GTIN-14 must still be probed')
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
