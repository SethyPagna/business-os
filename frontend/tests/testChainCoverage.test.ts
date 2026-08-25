// Guard: every tests/*.test.ts must be reachable from `npm run test:utils`.
//
// The chain is a hand-maintained `&&` list in package.json, so a new test
// file is only ever run if someone remembers to append it. Three had been
// missed -- including mergeSameDetailRows.test.ts, which covers the product
// identity rule itself, and portalProductGrouping.test.ts, which was
// genuinely FAILING while the chain reported green. The failure only
// surfaced from running every file individually, which the project's rules
// require precisely because the chain can lie in both directions: it stops
// at the first failure (hiding everything after it) and silently omits
// whatever was never added.
//
// This test closes the omission half. It cannot close the stop-at-first-
// failure half -- that still needs the per-file sweep.
//
// Run: node tests/testChainCoverage.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'))
const chain: string = String(pkg.scripts?.['test:utils'] || '')

assert.ok(chain, 'package.json should define a test:utils script')

const testFiles = fs.readdirSync(here).filter((f) => f.endsWith('.test.ts')).sort()
assert.ok(testFiles.length > 50, `expected to find the test suite, found ${testFiles.length} files`)

const missing = testFiles.filter((f) => !chain.includes(`tests/${f}`))
assert.deepEqual(
  missing, [],
  `these test files exist but are never run by test:utils -- append them to the chain in package.json:\n  ${missing.join('\n  ')}`,
)

console.log(`PASS all ${testFiles.length} test files are wired into the test:utils chain`)
