// Runs every tests/*.test.ts file in this directory, stopping at the first
// failure -- replacing the old hand-maintained `&&` chain that used to live
// directly in package.json's `test:utils` script.
//
// That chain was a flat `node tests/a.test.ts && node tests/b.test.ts && ...`
// one-liner that every lane appended its new test file to. On 2026-09-06 it
// grew past this harness's Windows command-line launch ceiling: `npm run
// test:utils` failed with "The command line is too long" before running
// anything, at a chain length (8188 chars) barely 40 chars past the last
// known-good commit (8148 chars). A short `npm run <alias>` indirection was
// tried first and still failed -- bisecting this worktree's actual ceiling
// (via repeated `npm run <probe>` launches of controlled length, not just
// reasoning about it) found the true boundary is 8154 chars OK / 8155 chars
// FAIL, not the 8171 an earlier bisection had reported; the alias-indirection
// budget per lane (~14-27 chars minimum) doesn't fit inside the ~6 chars of
// slack the base chain had left, so no per-lane string-shrinking trick can
// hold once more than one or two lanes append to the same line.
//
// This runner removes the scaling problem instead of budgeting around it:
// test:utils now runs a fixed ~100-char command regardless of how many test
// files exist, and every tests/*.test.ts file is reachable by construction
// (globbed, not hand-listed) -- no chain entry to remember, and no ceiling
// to hit as the suite grows. tests/testChainCoverage.test.ts still guards
// against a *future* hardcoded exclude-list silently narrowing that glob.
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Every tests/*.test.ts file in `dir`, alphabetically. Exported so
 * testChainCoverage.test.ts can independently verify this glob is not
 * quietly narrowed (e.g. by a hardcoded exclude list) without actually
 * spawning the whole suite. */
export function listTestFiles(dir = here) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.test.ts'))
    .sort()
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) {
  const files = listTestFiles()
  if (files.length < 50) {
    // A near-empty result means the glob (or cwd) broke, not that the suite
    // shrank -- refuse to report a false green.
    console.error(`runTests.ts found only ${files.length} tests/*.test.ts files -- expected the full suite (50+). Refusing to report a false green.`)
    process.exit(1)
  }
  for (const file of files) {
    const result = spawnSync(process.execPath, [path.join(here, file)], { stdio: 'inherit' })
    if (result.status !== 0) {
      console.error(`RED ${file}`)
      process.exit(result.status ?? 1)
    }
  }
  console.log(`PASS all ${files.length} test files (tests/*.test.ts)`)
}
