// Pure-JS counterpart to test-search-fts-pure.cjs's new O/0 lookalike
// checks, part 234. That file confirms the FTS5-backed path (products.ts/
// inventory.ts's server-paginated search). This file confirms the OTHER
// path that goes through the exact same normalizeSearchText fold but never
// touches FTS5 at all: matchesSearchTermGroups/fuzzyTextMatches, used by
// routes/portal.ts's JS fallback (portal is deliberately not on FTS5 per
// searchMatch.ts's own header comment), and by the frontend's in-memory
// re-filter of an already-fetched page (Inventory.tsx/POS.tsx). Both call
// sites share this exact function, so one test here covers both --
// deliberately NOT re-testing the FTS5 machinery again (that's what the
// other file is for).
//
// Run: node scripts/test-search-lookalike-jspath-pure.cjs
// No native dependency needed -- pure TS-transpile-and-run, same technique
// test-search-fts-pure.cjs uses for loading searchMatch.ts.

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const searchMatchPath = path.join(__dirname, '..', 'src', 'lib', 'searchMatch.ts')
const searchMatchSource = fs.readFileSync(searchMatchPath, 'utf8')
const { outputText } = ts.transpileModule(searchMatchSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'searchMatch-pure.ts',
})
const moduleObj = { exports: {} }
new Function('exports', outputText)(moduleObj.exports)
const { normalizeSearchText, matchesSearchTermGroups, tokenizeSearchTermGroups, swapCodeLookalikeChar } = moduleObj.exports

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

check('normalizeSearchText folds a digit-bearing token\'s letter-O to digit-0 ("O8Y" -> "08y")', () => {
  assert.strictEqual(normalizeSearchText('O8Y'), '08y')
})

check('normalizeSearchText leaves an already-digit-0 token unchanged ("08Y" -> "08y", no letters left to fold)', () => {
  assert.strictEqual(normalizeSearchText('08Y'), '08y')
})

check('normalizeSearchText does NOT touch a pure-letter word (no digit present -- "Concealer" stays "concealer", not "c0ncealer")', () => {
  assert.strictEqual(normalizeSearchText('Concealer'), 'concealer')
})

check('normalizeSearchText folds only the eligible (digit-bearing) token in a multi-word string, leaving the rest alone', () => {
  assert.strictEqual(normalizeSearchText('Rare Beauty Foundation O8Y'), 'rare beauty foundation 08y')
})

check('swapCodeLookalikeChar returns null for a word with no digit (never widens plain text)', () => {
  assert.strictEqual(swapCodeLookalikeChar('concealer'), null)
})

check('swapCodeLookalikeChar returns null for a word with a digit but no o/0 to swap (e.g. "12y")', () => {
  assert.strictEqual(swapCodeLookalikeChar('12y'), null)
})

check('swapCodeLookalikeChar swaps letter-O to digit-0 when eligible', () => {
  assert.strictEqual(swapCodeLookalikeChar('o8y'), '08y')
})

check('swapCodeLookalikeChar swaps digit-0 to letter-O when eligible (reverse direction)', () => {
  assert.strictEqual(swapCodeLookalikeChar('08y'), 'o8y')
})

check('matchesSearchTermGroups: portal-style JS fallback finds a stored "O8Y" shade code via a typed "08Y" query', () => {
  const groups = tokenizeSearchTermGroups('08Y', 6, 8).map((g) => g.join(' '))
  assert.strictEqual(matchesSearchTermGroups('Foundation Stick FDN-O8Y', groups, 'AND'), true)
})

check('matchesSearchTermGroups: reverse direction, stored "08Y" found via typed "o8Y"', () => {
  const groups = tokenizeSearchTermGroups('o8Y', 6, 8).map((g) => g.join(' '))
  assert.strictEqual(matchesSearchTermGroups('Foundation Stick FDN-08Y', groups, 'AND'), true)
})

check('matchesSearchTermGroups: O/0 fold does not cause two distinct shade codes to cross-match', () => {
  const groups = tokenizeSearchTermGroups('08Y', 6, 8).map((g) => g.join(' '))
  assert.strictEqual(matchesSearchTermGroups('Blush Stick BLS-12Y', groups, 'AND'), false)
})

console.log(`\n${passed} search-lookalike JS-path checks passed`)
