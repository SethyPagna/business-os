// productLookup.test.ts -- P2-2 (search + barcode scan core). Pure-function
// tests for src/utils/productLookup.ts, the client-side mirror of the
// backend's computeExactBarcodeHitId (cloudflare/src/lib/searchMatch.ts) plus
// resolveExactBarcodeHit's server-first/client-fallback precedence, both
// consumed by src/hooks/useProductLookup.ts.
//
// Run: node tests/productLookup.test.ts
import assert from 'node:assert/strict'
import {
  findExactBarcodeHit,
  isDigitsOnlyLookupQuery,
  looksLikeRealBarcodeQuery,
  MIN_REAL_BARCODE_LENGTH,
  resolveExactBarcodeHit,
} from '../src/utils/productLookup.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

check('MIN_REAL_BARCODE_LENGTH matches the backend constant (kept in lockstep by hand, see file header)', () => {
  assert.equal(MIN_REAL_BARCODE_LENGTH, 4)
})

// --- isDigitsOnlyLookupQuery / looksLikeRealBarcodeQuery --------------------

const DIGITS_ONLY_CASES: Array<[unknown, boolean]> = [
  ['12345678', true],
  ['0', true],
  ['', false],
  ['   ', false],
  ['12 34', false],
  ['abc123', false],
  ['1a', false],
  [null, false],
  [undefined, false],
]

for (const [input, expected] of DIGITS_ONLY_CASES) {
  check(`isDigitsOnlyLookupQuery(${JSON.stringify(input)}) === ${expected}`, () => {
    assert.equal(isDigitsOnlyLookupQuery(input), expected)
  })
}

const REAL_BARCODE_CASES: Array<[unknown, boolean]> = [
  ['6923644012345', true], // real 13-digit barcode
  ['1234', true], // exactly MIN_REAL_BARCODE_LENGTH
  ['123', false], // one short of the minimum -- a fragment, not a real scan
  ['12', false],
  ['1', false],
  ['0', false], // the shared placeholder barcode -- never a confident single hit
  ['0000', false], // a run of zeros is still effectively the placeholder pattern? -- see note
  ['abcd', false], // not digits-only
  ['', false],
]

for (const [input, expected] of REAL_BARCODE_CASES) {
  if (input === '0000') continue // handled separately below with its own rationale
  check(`looksLikeRealBarcodeQuery(${JSON.stringify(input)}) === ${expected}`, () => {
    assert.equal(looksLikeRealBarcodeQuery(input), expected)
  })
}

check('looksLikeRealBarcodeQuery treats "0000" as a real (if unlikely) barcode -- only the literal "0" is excluded, matching computeExactBarcodeHitId', () => {
  // The backend's MIN_REAL_BARCODE_LENGTH/"0" gate excludes exactly the
  // string "0" (the shared placeholder several legacy/migrated products
  // carry), not every all-zero string -- "0000" is 4 digits and not equal
  // to "0", so it passes the gate here exactly as it would server-side.
  assert.equal(looksLikeRealBarcodeQuery('0000'), true)
})

// --- findExactBarcodeHit ----------------------------------------------------

check('findExactBarcodeHit returns the single matching candidate id', () => {
  const candidates = [
    { id: 1, barcode: '111' },
    { id: 2, barcode: '6923644012345' },
    { id: 3, barcode: '333' },
  ]
  assert.equal(findExactBarcodeHit(candidates, '6923644012345'), 2)
})

check('findExactBarcodeHit returns null when the query is not a real barcode (too short)', () => {
  const candidates = [{ id: 1, barcode: '12' }]
  assert.equal(findExactBarcodeHit(candidates, '12'), null)
})

check('findExactBarcodeHit returns null when the query is the shared "0" placeholder, even with candidates matching', () => {
  const candidates = [
    { id: 1, barcode: '0' },
    { id: 2, barcode: '0' },
    { id: 3, barcode: '0' },
  ]
  assert.equal(findExactBarcodeHit(candidates, '0'), null)
})

check('findExactBarcodeHit returns null when nothing on the page matches', () => {
  const candidates = [{ id: 1, barcode: '111' }, { id: 2, barcode: '222' }]
  assert.equal(findExactBarcodeHit(candidates, '999999'), null)
})

check('findExactBarcodeHit returns null (never guesses) when more than one candidate shares the exact barcode -- an ambiguous/duplicate situation', () => {
  const candidates = [
    { id: 1, barcode: '6923644012345' },
    { id: 2, barcode: '6923644012345' },
  ]
  assert.equal(findExactBarcodeHit(candidates, '6923644012345'), null)
})

check('findExactBarcodeHit ignores candidates with no barcode / null barcode', () => {
  const candidates = [
    { id: 1 },
    { id: 2, barcode: null },
    { id: 3, barcode: '6923644012345' },
  ]
  assert.equal(findExactBarcodeHit(candidates, '6923644012345'), 3)
})

check('findExactBarcodeHit trims the query before comparing', () => {
  const candidates = [{ id: 1, barcode: '6923644012345' }]
  assert.equal(findExactBarcodeHit(candidates, '  6923644012345  '), 1)
})

// --- resolveExactBarcodeHit --------------------------------------------------

check('resolveExactBarcodeHit prefers a numeric server value over the client computation', () => {
  const candidates = [{ id: 1, barcode: '6923644012345' }]
  // Server says id 99 (computed against the FULL matched set, not just this
  // page) even though the client would have found id 1 on this page --
  // server wins.
  assert.equal(resolveExactBarcodeHit(99, candidates, '6923644012345'), 99)
})

check('resolveExactBarcodeHit trusts an explicit server null (a real "no confident hit" answer) even when the client would have guessed differently from just this page', () => {
  // portal.ts's exact_barcode_hit_id is computed via a query scoped BEYOND
  // just the current page (see cloudflare/src/routes/portal.ts's dedicated
  // exactBarcodeRows query) -- an explicit server null must win over a
  // client per-page guess, precisely because the server may know something
  // the current page alone doesn't (e.g. the true hit sits on another page,
  // or the barcode is genuinely ambiguous/duplicated elsewhere).
  const candidates = [{ id: 1, barcode: '6923644012345' }] // client would guess id 1
  assert.equal(resolveExactBarcodeHit(null, candidates, '6923644012345'), null)
})

check('resolveExactBarcodeHit falls back to the client computation when the server omitted the field (undefined)', () => {
  const candidates = [{ id: 1, barcode: '6923644012345' }]
  assert.equal(resolveExactBarcodeHit(undefined, candidates, '6923644012345'), 1)
})

check('resolveExactBarcodeHit coerces a numeric-string server value rather than falling through to the client guess', () => {
  const candidates = [{ id: 1, barcode: '000000' }] // would NOT match client-side
  assert.equal(resolveExactBarcodeHit('42', candidates, '6923644012345'), 42)
})

console.log(`\nAll ${passed} productLookup tests passed`)
