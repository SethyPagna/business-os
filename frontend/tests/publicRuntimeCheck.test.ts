import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// `npm run verify:public-runtime` used to fail on a PRISTINE checkout.
//
// Git stores frontend/public/*.js with LF; this repo is checked out with
// core.autocrlf=true, so they land on disk with CRLF, while the generator
// always emits LF. The staleness check compared raw bytes, so it reported
// "Generated runtime is stale" on a tree where nothing was stale --
// runtime-noise-guard.js measured 5042 bytes in the index and 5160 on disk.
//
// That mattered far beyond one script: this check is step 2 of the
// `test:utils` chain, and the chain stops at the first red. A lane could run
// the chain, see red, and never reach a single one of its own test files --
// then report itself certified on a chain that never ran.
//
// So: the check must ignore line endings, AND must still catch real staleness.
// The second half is the one worth guarding; a check that never fails would
// "fix" the symptom by deleting the protection.

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const script = path.join(root, 'ops', 'scripts', 'frontend', 'build-public-runtime-scripts.ts')
const target = path.join(root, 'frontend', 'public', 'runtime-noise-guard.js')

const require_ = createRequire(import.meta.url)
const { normalizeEol } = require_(script)

const runCheck = () => spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' })

// 1. The helper does what its name says, and requiring the script does not run it.
assert.strictEqual(normalizeEol('a\r\nb\r\n'), 'a\nb\n', 'CRLF must normalize to LF')
assert.strictEqual(normalizeEol('a\nb\n'), 'a\nb\n', 'LF must pass through unchanged')

const original = fs.readFileSync(target)
let failures = 0

try {
  // 2. A file whose ONLY difference is CRLF must verify clean. This is the
  //    exact state a fresh Windows checkout is in.
  const asLf = original.toString('utf8').replace(/\r\n/g, '\n')
  fs.writeFileSync(target, asLf.replace(/\n/g, '\r\n'), 'utf8')
  const crlf = runCheck()
  if (crlf.status !== 0) {
    console.error(crlf.stdout, crlf.stderr)
    failures++
  }
  assert.strictEqual(crlf.status, 0, 'a CRLF checkout must not be reported stale')

  // 3. A file that is GENUINELY out of date must still fail. Without this the
  //    fix above would be indistinguishable from deleting the check.
  fs.writeFileSync(target, asLf + '\nconsole.log("drift")\n', 'utf8')
  const stale = runCheck()
  assert.strictEqual(stale.status, 1, 'real staleness must still fail the check')
  assert.match(
    String(stale.stderr || '') + String(stale.stdout || ''),
    /Generated runtime is stale/,
    'the failure must still name the stale file',
  )
} finally {
  fs.writeFileSync(target, original)
}

// 4. Restored byte-for-byte, so this test leaves no dirt behind for the lane
//    that runs it.
assert.deepStrictEqual(fs.readFileSync(target), original, 'the test must restore the file it edited')
assert.strictEqual(failures, 0, 'see the check output above')

console.log('publicRuntimeCheck.test.ts OK')
