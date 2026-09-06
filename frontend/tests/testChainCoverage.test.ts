// Guard: `npm run test:utils` must run every tests/*.test.ts, and it must find
// them by discovery, never through a hand-maintained list.
//
// History. The gate began as an `&&` list in package.json. Three files were
// never appended -- one of them, portalProductGrouping.test.ts, was genuinely
// FAILING while the chain reported green -- and e0fe20aa added this test to
// close that omission half. On Sep 6 2026 the list itself became the failure:
// at 8485 characters it exceeded the ~8171-character command line Windows will
// launch, so `npm run test:utils` died with "The command line is too long"
// before running anything, while five parallel lanes were each appending to
// the same line. The chain is now tests/runTestChain.ts, which reads the
// directory and keeps going after a red. This test pins both properties so a
// list cannot quietly come back.
//
// Run: node tests/testChainCoverage.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'))
const script: string = String(pkg.scripts?.['test:utils'] || '')

assert.equal(script, 'node tests/runTestChain.ts', 'test:utils must be the discovery runner, not a hand-maintained && list')
assert.ok(script.length < 1000, 'test:utils must stay far below the Windows command-line limit')

const runnerPath = path.join(here, 'runTestChain.ts')
assert.ok(fs.existsSync(runnerPath), 'tests/runTestChain.ts must exist')
const runner = fs.readFileSync(runnerPath, 'utf8')

assert.match(runner, /readdirSync\(here\)[\s\S]{0,200}endsWith\('\.test\.ts'\)/, 'the runner discovers test files by reading tests/')
assert.match(runner, /spawnSync\(process\.execPath, \[path\.join\(here, f\)\]/, 'the runner executes each discovered file with the current Node')
assert.doesNotMatch(runner, /node tests\/\w+\.test\.ts/, 'the runner must not carry a list of test files')
assert.match(runner, /PREFLIGHT = \['typecheck', 'verify:public-runtime', 'check:source'\]/, 'the preflight gates the old chain ran first still run')
assert.match(runner, /if \(flags\.has\('--bail'\)\) \{\s*console\.log\([^)]*\)\s*break/, 'the runner only stops at the first red when --bail is given')
assert.match(runner, /reds\.push\(f\)/, 'the runner records every red file for the summary')

const testFiles = fs.readdirSync(here).filter((f) => f.endsWith('.test.ts')).sort()
assert.ok(testFiles.length > 50, `expected to find the test suite, found ${testFiles.length} files`)

console.log(`PASS test:utils discovers all ${testFiles.length} test files through tests/runTestChain.ts`)
