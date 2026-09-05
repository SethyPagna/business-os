// Guard: every tests/*.test.ts must be reachable from `npm run test:utils`.
//
// Originally this was a hand-maintained `&&` list in package.json, so a new
// test file was only ever run if someone remembered to append it. Three had
// been missed -- including mergeSameDetailRows.test.ts, which covers the
// product identity rule itself, and portalProductGrouping.test.ts, which was
// genuinely FAILING while the chain reported green. The failure only
// surfaced from running every file individually, which the project's rules
// require precisely because a chain can lie in both directions: it stops at
// the first failure (hiding everything after it) and silently omits
// whatever was never added.
//
// On 2026-09-06 the hand-maintained chain also hit a SECOND failure mode:
// it is a single `npm run test:utils` command line, and Windows caps how
// long a command line this harness launches can be. At 9ab9fd7a the chain
// was 8148 chars and ran; one more lane's test file pushed it to 8188 chars
// and `npm run test:utils` died with "The command line is too long" before
// executing anything. A per-lane `npm run test:<id>` alias indirection was
// tried as a mitigation and *also* failed empirically -- bisecting this
// worktree's real launch ceiling (by actually launching `npm run <probe>`
// at controlled lengths, not by reasoning about it) found the true boundary
// is 8154 chars OK / 8155 chars FAIL, not the 8171 an earlier bisection had
// reported, leaving only ~6 chars of slack -- less than even the shortest
// possible alias reference (~14 chars minimum). No per-lane string-shrinking
// trick can hold once more than one or two lanes append to the one line.
//
// The durable fix: test:utils now runs tests/runTests.ts, a small script
// that globs tests/*.test.ts itself (see that file), so the command line
// package.json launches is a fixed ~100 chars regardless of suite size, and
// every test file is reachable by construction -- no chain entry to forget,
// no ceiling to hit as the suite grows. This test now guards the two ways
// THAT can quietly break: test:utils stops invoking the runner, or the
// runner's own glob gets narrowed (e.g. a future hardcoded exclude list).
//
// Run: node tests/testChainCoverage.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listTestFiles } from './runTests.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'))
const chain: string = String(pkg.scripts?.['test:utils'] || '')

assert.ok(chain, 'package.json should define a test:utils script')
assert.ok(
  chain.includes('tests/runTests.ts'),
  `test:utils no longer invokes the glob-based runner (tests/runTests.ts) -- ` +
    `found: ${chain}. Whatever replaced it must still make every tests/*.test.ts ` +
    `file reachable, or this guard (and the tests it can no longer see) is dead.`,
)

// Bisected on this harness 2026-09-06 by actually launching `npm run <probe>`
// at controlled lengths: launches fine at 8154 chars, fails at 8155. Keep a
// safety margin rather than riding the exact edge. test:utils itself is now
// ~100 chars and has enormous headroom, but keep the guard so nobody
// reintroduces the old hand-maintained one-liner and slowly grows back into
// this ceiling.
const LAUNCH_CEILING = 8140
assert.ok(
  chain.length <= LAUNCH_CEILING,
  `test:utils is ${chain.length} chars, over the ${LAUNCH_CEILING}-char launch ceiling for this harness -- ` +
    `npm run test:utils will die with "The command line is too long" before running anything.`,
)

// Independently recompute the directory listing (do not just call
// listTestFiles() and trust it) so a future hardcoded exclude list inside
// runTests.ts would make these two disagree instead of both being wrong
// the same way.
const testsDir = path.join(here)
const onDisk = fs.readdirSync(testsDir).filter((f) => f.endsWith('.test.ts')).sort()
const fromRunner = listTestFiles(testsDir)

assert.ok(onDisk.length > 50, `expected to find the test suite, found ${onDisk.length} files`)
assert.deepEqual(
  fromRunner, onDisk,
  `runTests.ts's listTestFiles() disagrees with the tests/ directory listing -- ` +
    `it must glob every tests/*.test.ts file, not a narrowed/hardcoded subset.\n` +
    `  runner returned: ${fromRunner.length} files\n  on disk: ${onDisk.length} files`,
)

console.log(`PASS all ${onDisk.length} test files are wired into the test:utils chain via runTests.ts (chain length ${chain.length}/${LAUNCH_CEILING})`)
