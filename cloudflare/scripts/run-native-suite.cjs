#!/usr/bin/env node
// Runs every `test-*-native.cjs` file through scripts/harness/native_runner.cjs
// instead of a bare `node test-x-native.cjs`, so a workerd/Miniflare process
// that the OS kills outright under load (see native_runner.cjs's header for
// the exit-3221226505-with-zero-output evidence) is always reported with a
// reason and safely retried, instead of showing up as an unexplained red
// with no output. Sequential by default (matches the existing
// `for f in test-*.cjs; do node "$f" ...; done` sweep from AGENTS.md/
// CLAUDE.md); pass --parallel=N to fan out N at a time, which is exactly
// the contention this script exists to survive.
//
// Usage (from cloudflare/): node scripts/run-native-suite.cjs [--parallel=N] [name-substring]
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { runNativeTest } = require('./harness/native_runner.cjs')

const scriptsDir = __dirname
const args = process.argv.slice(2)
const parallelArg = args.find((a) => a.startsWith('--parallel='))
const parallel = Math.max(1, Number(parallelArg?.split('=')[1]) || 1)
const filter = args.find((a) => !a.startsWith('--'))

const files = fs.readdirSync(scriptsDir)
  .filter((f) => f.startsWith('test-') && f.endsWith('-native.cjs'))
  .filter((f) => !filter || f.includes(filter))
  .sort()

async function runPool(items, size, worker) {
  const results = new Array(items.length)
  let next = 0
  async function lane() {
    while (next < items.length) {
      const i = next++
      results[i] = await worker(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane))
  return results
}

async function main() {
  console.log(`native suite: ${files.length} files, parallel=${parallel}${filter ? `, filter="${filter}"` : ''}`)
  const results = await runPool(files, parallel, (file) =>
    runNativeTest(path.join(scriptsDir, file), { cwd: path.join(scriptsDir, '..') })
  )
  const failed = results.filter((r) => !r.ok)
  const retried = results.filter((r) => r.attempts.length > 1)
  console.log(`\nnative suite: ${results.length - failed.length}/${results.length} green` +
    (retried.length ? `, ${retried.length} needed an infra retry` : '') +
    (failed.length ? `, ${failed.length} RED: ${failed.map((r) => r.name).join(', ')}` : ''))
  if (failed.length > 0) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
