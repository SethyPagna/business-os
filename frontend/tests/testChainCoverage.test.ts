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

// A focused test may be statically imported by another chained test. Treat
// that as reachable too (Node executes the imported module before its parent),
// then walk imports transitively without weakening the requirement that every
// file has a real path from test:utils.
const reachable = new Set(testFiles.filter((f) => chain.includes(`tests/${f}`)))
let discovered = true
while (discovered) {
  discovered = false
  for (const importer of [...reachable]) {
    const source = fs.readFileSync(path.join(here, importer), 'utf8')
    for (const match of source.matchAll(/(?:import(?:[\s\S]*?from\s*)?|import\()\s*['"]\.\/([^'"]+\.test\.ts)['"]/g)) {
      const imported = match[1]
      if (testFiles.includes(imported) && !reachable.has(imported)) {
        reachable.add(imported)
        discovered = true
      }
    }
  }
}

const missing = testFiles.filter((f) => !reachable.has(f))
assert.deepEqual(
  missing, [],
  `these test files exist but are never run by test:utils -- append them to the chain in package.json:\n  ${missing.join('\n  ')}`,
)

console.log(`PASS all ${testFiles.length} test files are wired into the test:utils chain`)
