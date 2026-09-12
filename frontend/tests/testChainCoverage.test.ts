// Guard: `npm run test:utils` must run every tests/*.test.ts / *.test.cjs, and find
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
import { spawnSync } from 'node:child_process'
import os from 'node:os'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'))
const script: string = String(pkg.scripts?.['test:utils'] || '')

assert.equal(script, 'node tests/runTestChain.ts', 'test:utils must be the discovery runner, not a hand-maintained && list')
assert.ok(script.length < 1000, 'test:utils must stay far below the Windows command-line limit')

const runnerPath = path.join(here, 'runTestChain.ts')
assert.ok(fs.existsSync(runnerPath), 'tests/runTestChain.ts must exist')
const runner = fs.readFileSync(runnerPath, 'utf8')

assert.match(runner, /spawnSync\(process\.execPath, \[path\.join\(here, f\)\]/, 'the runner executes each discovered file with the current Node')
assert.doesNotMatch(runner, /node tests\/\w+\.test\.ts/, 'the runner must not carry a list of test files')
assert.match(runner, /PREFLIGHT = \['typecheck', 'verify:public-runtime', 'check:source'\]/, 'the preflight gates the old chain ran first still run')
assert.match(runner, /if \(flags\.has\('--bail'\)\) \{\s*console\.log\([^)]*\)\s*break/, 'the runner only stops at the first red when --bail is given')
assert.match(runner, /reds\.push\(f\)/, 'the runner records every red file for the summary')

const testFiles = fs.readdirSync(here).filter((f) => /\.test\.(?:ts|cjs)$/.test(f)).sort()
assert.ok(testFiles.length > 50, `expected to find the test suite, found ${testFiles.length} files`)

console.log(`PASS test:utils discovers all ${testFiles.length} test files through tests/runTestChain.ts`)

// Execute the unchanged runner in a private fixture tree, not a mirrored
// discovery implementation. Child filenames are literal argv, never a shell glob.
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-runner-'))
try {
  const tests = path.join(fixture, 'tests')
  fs.mkdirSync(tests)
  fs.writeFileSync(path.join(fixture, 'package.json'), '{"type":"module"}')
  fs.copyFileSync(runnerPath, path.join(tests, 'runTestChain.ts'))
  const names = ['fixture-a.test.cjs', 'fixture-b.test.ts', 'fixture-c space.test.cjs']
  for (let i = 0; i < 50; i++) names.push(`padding-${String(i).padStart(2, '0')}.test.ts`)
  for (const name of names) fs.writeFileSync(path.join(tests, name), '')
  for (const name of ['fixture.test.js', 'fixture.test.cjs.bak', 'fixture.test.tsx', 'helper.ts']) {
    fs.writeFileSync(path.join(tests, name), 'throw new Error("must not execute")')
  }
  fs.mkdirSync(path.join(tests, 'directory.test.cjs'))
  const run = (...args: string[]) => spawnSync(process.execPath, [path.join(tests, 'runTestChain.ts'), '--no-preflight', ...args], { encoding: 'utf8', timeout: 60_000 })
  const passedFiles = (stdout: string) => [...stdout.matchAll(/^PASS (.+) \(\d+ ms\)$/gm)].map(match => match[1])
  const all = run()
  assert.equal(all.status, 0, all.stdout + all.stderr)
  assert.deepEqual(passedFiles(all.stdout), [...names].sort(), 'both suffixes run exactly once in deterministic order; all other entries excluded')
  const filtered = run('FIXTURE', 'fixture-a')
  assert.equal(filtered.status, 0, filtered.stdout + filtered.stderr)
  assert.deepEqual(passedFiles(filtered.stdout), names.slice(0, 3), 'overlapping case-insensitive terms do not double-run a file')
  const wildcard = run('*')
  assert.equal(wildcard.status, 1)
  assert.deepEqual(passedFiles(wildcard.stdout), [], 'filter strings do not expand as shell wildcards')
  fs.writeFileSync(path.join(tests, names[0]), 'process.exit(7)')
  const failed = run('fixture')
  assert.equal(failed.status, 1)
  assert.deepEqual(passedFiles(failed.stdout), names.slice(1, 3), 'a failed CJS test cannot hide later tests')
  assert.match(failed.stdout, /2 passed, 1 red of 3 executed files/)
  const bail = run('fixture', '--bail')
  assert.equal(bail.status, 1)
  assert.deepEqual(passedFiles(bail.stdout), [])
  assert.match(bail.stdout, /0 passed, 1 red of 1 executed files \(2 skipped;/, 'unexecuted tests must not be reported as passed')
} finally {
  fs.rmSync(fixture, { recursive: true, force: true })
}
console.log('PASS executable TS/CJS discovery, exclusions, literal filters, failure continuation and truthful bail summary')
