// Behavioral parity between frontend/src/utils/searchMatch.ts and
// cloudflare/src/lib/searchMatch.ts -- P2-2 (Gate 2B audit) found the
// frontend copy's header actively mislabeled itself as "(Worker/backend
// copy)" and carried a set of backend-only SQL-string-building exports
// (foldDiacriticsSql/foldJoinersSql/normalizedHaystackSql) with zero call
// sites anywhere in frontend/src -- removed in the same commit as this
// test. What's genuinely shared between the two files is the pure
// normalization/fuzzy-matching logic (no DOM, no SQL): both copies must
// keep agreeing on what a search query matches, since a mismatch here
// means the client-side re-filter (Products/Inventory/POS/Returns/
// TransferModal/Catalog, all of which call matchesSearchTermGroups/
// fuzzyTextMatches directly) and the server's own JS fuzzy fallback
// (products.ts/inventory.ts/portal.ts/branches.ts, all of which call
// runFuzzyFallbackMatch, folding those same primitives) would disagree
// about the exact same typed query.
//
// Both files are self-contained (no imports of their own), so each is
// transpiled and executed in isolation the same way the cloudflare "pure"
// backend tests load lib/searchMatch.ts (see e.g.
// cloudflare/scripts/test-search-tail-parity.cjs's loadTs helper) and the
// way this frontend test suite already loads TSX/TS source directly (see
// tests/feeLabelClamp.test.ts's identical transpileModule pattern) --
// not a diff of the source text (the two files' comments and internal
// helper functions may legitimately differ), a diff of ACTUAL BEHAVIOR
// across a shared table of representative inputs.
//
// Run: node tests/searchMatchParity.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = path.dirname(fileURLToPath(import.meta.url))

function loadTs(absPath: string): Record<string, unknown> {
  const src = fs.readFileSync(absPath, 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(absPath) + '.pure.ts',
  })
  const moduleObj: { exports: Record<string, unknown> } = { exports: {} }
  new Function('exports', outputText)(moduleObj.exports)
  return moduleObj.exports
}

const frontendPath = path.join(here, '..', 'src', 'utils', 'searchMatch.ts')
const backendPath = path.join(here, '..', '..', 'cloudflare', 'src', 'lib', 'searchMatch.ts')

const fe = loadTs(frontendPath) as {
  foldDiacritics: (value: string) => string
  normalizeSearchText: (value: unknown) => string
  swapCodeLookalikeChar: (word: string) => string | null
  compactSearchText: (value: unknown) => string
  tokenizeSearchWords: (raw: unknown, maxWords?: number) => string[]
  expandAliasCandidates: (compactWord: string) => string[]
  buildHaystackIndex: (...fields: unknown[]) => { tokens: string[]; compact: string }
  matchesSearchTermGroups: (haystack: unknown, terms: readonly string[], mode?: string) => boolean
  fuzzyTextMatches: (haystack: unknown, rawQuery: unknown) => boolean
  runFuzzyFallbackMatch: (candidates: ReadonlyArray<{ id: number; haystack: string }>, searchTerms: readonly string[], mode?: string) => number[]
}

const be = loadTs(backendPath) as typeof fe

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

// --- foldDiacritics / normalizeSearchText / compactSearchText ----------

const NORMALIZE_INPUTS = [
  'Crème Cover + Concealer',
  'BS-Mall',
  'BS Mall',
  'BSMall',
  '9-piece',
  '9 piece',
  '9piece',
  'consealer',
  'Cover+Concealer',
  'e.l.f.',
  'O8Y shade 08y',
  'RT brush set',
  '  spaced   out   ',
  'Ñoño Café',
  'ស្បែក Khmer product name', // Khmer script mixed with Latin
  '',
  '   ',
  'ĐĐ Łł Þþ ß Æ æ Œ œ Ø ø',
]

for (const input of NORMALIZE_INPUTS) {
  check(`foldDiacritics parity: ${JSON.stringify(input)}`, () => {
    assert.strictEqual(fe.foldDiacritics(input), be.foldDiacritics(input))
  })
  check(`normalizeSearchText parity: ${JSON.stringify(input)}`, () => {
    assert.strictEqual(fe.normalizeSearchText(input), be.normalizeSearchText(input))
  })
  check(`compactSearchText parity: ${JSON.stringify(input)}`, () => {
    assert.strictEqual(fe.compactSearchText(input), be.compactSearchText(input))
  })
  check(`tokenizeSearchWords parity: ${JSON.stringify(input)}`, () => {
    assert.deepStrictEqual(fe.tokenizeSearchWords(input, 8), be.tokenizeSearchWords(input, 8))
  })
}

// --- swapCodeLookalikeChar ----------------------------------------------

for (const word of ['o8y', '08y', 'concealer', '123', 'o0o', '']) {
  check(`swapCodeLookalikeChar parity: ${JSON.stringify(word)}`, () => {
    assert.strictEqual(fe.swapCodeLookalikeChar(word), be.swapCodeLookalikeChar(word))
  })
}

// --- expandAliasCandidates -----------------------------------------------

for (const word of ['rt', 'nyx', 'bh', 'ofra', 'realtechniques', 'unrelatedword']) {
  check(`expandAliasCandidates parity: ${JSON.stringify(word)}`, () => {
    assert.deepStrictEqual(fe.expandAliasCandidates(word), be.expandAliasCandidates(word))
  })
}

// --- buildHaystackIndex ---------------------------------------------------

const HAYSTACK_FIXTURES: unknown[][] = [
  ['MAC Matte Lipstick 617', 'MAC-617', '6923644012345'],
  ['Cover + Concealer', null, undefined],
  ['ស្បែក Serum', 'SKU-1'],
]

for (const fields of HAYSTACK_FIXTURES) {
  check(`buildHaystackIndex parity: ${JSON.stringify(fields)}`, () => {
    assert.deepStrictEqual(fe.buildHaystackIndex(...fields), be.buildHaystackIndex(...fields))
  })
}

// --- matchesSearchTermGroups / fuzzyTextMatches ---------------------------

const MATCH_CASES: Array<{ haystack: string; terms: string[]; mode?: string }> = [
  { haystack: 'MAC Matte Lipstick 617', terms: ['mac matte'] },
  { haystack: 'MAC Matte Lipstick 617', terms: ['consealer'] },
  { haystack: 'Cover + Concealer Duo', terms: ['cover concealer'] },
  { haystack: 'Cover + Concealer Duo', terms: ['concealer cover'] },
  { haystack: 'Cover + Concealer Duo', terms: ['consealer'] },
  { haystack: 'BS Mall Brush Set', terms: ['bsmall'] },
  { haystack: 'Real Techniques Sponge', terms: ['rt'] },
  { haystack: 'Crème Anti-Aging Serum', terms: ['creme'] },
  { haystack: 'Product ស្បែក Khmer', terms: ['ស្បែក'] },
  { haystack: 'Shade O8Y', terms: ['08y'] },
  { haystack: 'red, blue', terms: ['red', 'green'], mode: 'OR' },
  { haystack: 'red, blue', terms: ['red', 'green'], mode: 'AND' },
  { haystack: '', terms: ['anything'] },
  { haystack: 'anything', terms: [] },
]

for (const { haystack, terms, mode } of MATCH_CASES) {
  check(`matchesSearchTermGroups parity: ${JSON.stringify({ haystack, terms, mode })}`, () => {
    assert.strictEqual(fe.matchesSearchTermGroups(haystack, terms, mode), be.matchesSearchTermGroups(haystack, terms, mode))
  })
}

for (const { haystack, terms } of MATCH_CASES) {
  const query = terms.join(' ')
  check(`fuzzyTextMatches parity: ${JSON.stringify({ haystack, query })}`, () => {
    assert.strictEqual(fe.fuzzyTextMatches(haystack, query), be.fuzzyTextMatches(haystack, query))
  })
}

// --- runFuzzyFallbackMatch -------------------------------------------------

const CANDIDATES = [
  { id: 1, haystack: 'MAC Matte Lipstick 617 MAC-617 6923644012345' },
  { id: 2, haystack: 'Cover + Concealer Duo CLQ-125' },
  { id: 3, haystack: 'Aveeno Eye Cream 14ml AVN-014' },
  { id: 4, haystack: 'Real Techniques Sponge RT-001' },
]

for (const { terms, mode } of [
  { terms: ['consealer'], mode: 'AND' },
  { terms: ['mac matte'], mode: 'AND' },
  { terms: ['rt'], mode: 'AND' },
  { terms: ['aveeno', 'nonexistentbrand'], mode: 'OR' },
  { terms: ['aveeno', 'nonexistentbrand'], mode: 'AND' },
]) {
  check(`runFuzzyFallbackMatch parity: ${JSON.stringify({ terms, mode })}`, () => {
    assert.deepStrictEqual(
      fe.runFuzzyFallbackMatch(CANDIDATES, terms, mode),
      be.runFuzzyFallbackMatch(CANDIDATES, terms, mode),
    )
  })
}

// --- confirm the dead SQL-facing exports were actually removed, not just
// unused -- a regression here means someone re-added backend-only SQL
// string builders to the frontend bundle without a call site again.

check('frontend copy no longer exports the backend-only SQL-string builders', () => {
  const feUntyped = fe as unknown as Record<string, unknown>
  assert.strictEqual(feUntyped.foldDiacriticsSql, undefined, 'foldDiacriticsSql should not exist on the frontend copy')
  assert.strictEqual(feUntyped.foldJoinersSql, undefined, 'foldJoinersSql should not exist on the frontend copy')
  assert.strictEqual(feUntyped.normalizedHaystackSql, undefined, 'normalizedHaystackSql should not exist on the frontend copy')
})

check('backend copy still exports its own SQL-string builders (this test only asserts the frontend dropped them)', () => {
  assert.strictEqual(typeof (be as unknown as { foldDiacriticsSql?: unknown }).foldDiacriticsSql, 'function')
})

console.log(`\nAll ${passed} searchMatch parity tests passed`)
