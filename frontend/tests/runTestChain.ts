// The `npm run test:utils` gate.
//
// Until Sep 6 2026 this was a hand-maintained `a && b && c` list in
// package.json. It grew to 8485 characters, and Windows refuses to launch a
// command line longer than ~8171 ("The command line is too long"), so the gate
// died before running anything -- found by the sales lane's verifier while
// five lanes were each appending their own test files to the same line. A list
// also lied in two directions (see testChainCoverage.test.ts): a file nobody
// appended never ran, and the first red hid every file after it.
//
// This runner discovers every tests/*.test.ts by reading the directory, runs
// the same preflight scripts the chain ran first, and keeps going after a red
// so the summary names every failing file. `--bail` restores stop-at-first.
//
// Usage:
//   node tests/runTestChain.ts                    preflight + every test file
//   node tests/runTestChain.ts receipt lowStock   only files whose name contains a term
//   node tests/runTestChain.ts --no-preflight     skip typecheck / public-runtime / check:source
//   node tests/runTestChain.ts --bail             stop at the first red
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const terms = args.filter((a) => !a.startsWith('--')).map((t) => t.toLowerCase())

const PREFLIGHT = ['typecheck', 'verify:public-runtime', 'check:source']
const NOISE = /ExperimentalWarning|--trace-warnings|Type Stripping/

function runNpmScript(script: string): boolean {
  const started = Date.now()
  console.log(`>>> npm run ${script}`)
  const result = spawnSync(`npm run ${script}`, { cwd: root, stdio: 'inherit', shell: true })
  const ok = result.status === 0
  console.log(`${ok ? 'PASS' : 'RED '} npm run ${script} (${Date.now() - started} ms)`)
  return ok
}

if (!flags.has('--no-preflight') && terms.length === 0) {
  for (const script of PREFLIGHT) {
    if (!runNpmScript(script)) {
      console.log(`\ntest:utils stopped: preflight step "${script}" is red; no test file was run`)
      process.exit(1)
    }
  }
}

const files = fs
  .readdirSync(here)
  .filter((f) => f.endsWith('.test.ts'))
  .filter((f) => terms.length === 0 || terms.some((t) => f.toLowerCase().includes(t)))
  .sort()

if (files.length === 0) {
  console.log(`test:utils: no test file matches ${JSON.stringify(terms)}`)
  process.exit(1)
}
// A near-empty discovery means the directory read or the cwd broke, not that
// the suite shrank; refuse to report a false green on a handful of files.
if (terms.length === 0 && files.length < 50) {
  console.log(`test:utils: found only ${files.length} tests/*.test.ts files, expected the full suite (50+); refusing to report a false green`)
  process.exit(1)
}

const reds: string[] = []
const startedAll = Date.now()
for (const f of files) {
  const started = Date.now()
  const result = spawnSync(process.execPath, [path.join(here, f)], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  })
  const ms = Date.now() - started
  if (result.status === 0) {
    console.log(`PASS ${f} (${ms} ms)`)
    continue
  }
  reds.push(f)
  console.log(`RED  ${f} (exit ${result.status ?? result.signal ?? result.error?.message}, ${ms} ms)`)
  const tail = `${result.stdout || ''}\n${result.stderr || ''}`
    .split(/\r?\n/)
    .filter((line) => line.trim() && !NOISE.test(line))
    .slice(-30)
  for (const line of tail) console.log(`     ${line}`)
  if (flags.has('--bail')) {
    console.log('\n--bail: stopping at the first red')
    break
  }
}

const passed = files.length - reds.length
console.log(`\ntest:utils: ${passed} passed, ${reds.length} red of ${files.length} files (${Date.now() - startedAll} ms)`)
if (reds.length) {
  console.log(`RED files:\n  ${reds.join('\n  ')}`)
  process.exit(1)
}
