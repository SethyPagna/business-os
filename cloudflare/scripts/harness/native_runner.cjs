// Supervises a single `test-*-native.cjs` file as a child process and
// retries it when -- and only when -- the process itself died in a way no
// test in this suite ever produces on purpose.
//
// Root cause (reproduced 22-23 Sep 2026, see the commit that added this
// file for the concurrency-driver evidence): every native test's own
// `main().catch(...)` exits with EXACTLY `process.exitCode = 1` or
// `process.exit(1)` on a real (thrown/asserted) failure -- confirmed by
// grepping every `test-*-native.cjs` file, none ever exits any other
// non-zero code on purpose. Each of these tests spins up its own `workerd`
// via Miniflare (some also shell out to esbuild or load the native
// `better-sqlite3` addon in-process). Run several at once under real
// CPU/memory contention (several other native tests, or other agents on
// the same machine) and the *node process itself* can be killed by the OS
// before it runs a single line of JS, or mid-run: observed exit code
// 3221226505 (0xC0000409, Windows' STATUS_STACK_BUFFER_OVERRUN -- the
// generic code the ucrt/V8 fail-fast path reports on this platform, not a
// literal stack overrun) with zero bytes on both stdout and stderr, and
// once with a handful of bytes of partial output before the same code.
// Because this is a native, whole-process abort -- not a thrown JS error --
// nothing INSIDE the test file can ever catch it: no try/catch and no
// `uncaughtException`/`unhandledRejection` listener runs before an OS
// fail-fast kill reaps the process. The only place that can see it, name
// it, and safely retry it is a process watching from the outside, which is
// what this module is. See test-native-runner-retry-pure.cjs for the
// discriminating self-test.
'use strict'
const { spawn } = require('node:child_process')
const path = require('node:path')

const DEFAULT_TIMEOUT_MS = Number(process.env.NATIVE_TEST_TIMEOUT_MS) || 240000
const DEFAULT_MAX_RETRIES = Number(process.env.NATIVE_TEST_MAX_RETRIES) || 1

// The only two exit codes any test in this suite produces on purpose are 0
// (pass) and 1 (a real, asserted/thrown failure -- grep every
// `test-*-native.cjs`'s `main().catch`/`process.exitCode` line to confirm).
// A signal, a timeout, or any other code is not a shape this suite ever
// chooses deliberately, so it is classified as an infrastructure crash
// rather than a test result. `timedOut` and `signal` are checked before
// `code` on purpose: a process we had to SIGKILL for hanging, or one the OS
// terminated with a signal, cannot be trusted to report a meaningful `code`
// even if one happens to come back as 0 or 1.
function classifyExit({ code, signal, timedOut }) {
  if (timedOut) return 'infra-crash'
  if (signal) return 'infra-crash'
  if (code === 0) return 'pass'
  if (code === 1) return 'real-failure'
  return 'infra-crash'
}

function describeCode(code) {
  if (code === null || code === undefined) return 'null'
  const hex = (code < 0 ? code >>> 0 : code).toString(16)
  const known = {
    c0000409: 'STATUS_STACK_BUFFER_OVERRUN / ucrt-V8 fail-fast on Windows -- not a code this suite sets deliberately',
  }
  const note = known[hex]
  return `${code} (0x${hex})${note ? ` -- ${note}` : ''}`
}

function runOnce(file, { cwd, timeoutMs, env }) {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(process.execPath, [file], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    child.stdout.on('data', (d) => { stdout = Buffer.concat([stdout, d]) })
    child.stderr.on('data', (d) => { stderr = Buffer.concat([stderr, d]) })
    child.on('error', (spawnError) => {
      clearTimeout(timer)
      resolve({ code: null, signal: null, timedOut, spawnError, ms: Date.now() - started, stdout, stderr })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, timedOut, ms: Date.now() - started, stdout, stderr })
    })
  })
}

// Runs `file` (a `test-*-native.cjs` path) as its own process, retrying only
// on a positively identified infrastructure crash, and always logging why.
// Resolves to { ok, name, attempts, stdout, stderr }; never throws.
async function runNativeTest(file, options = {}) {
  const {
    cwd = path.join(__dirname, '..', '..'),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    log = (line) => console.log(line),
    env = process.env,
  } = options
  const name = path.basename(file)
  const attempts = []
  const totalTries = maxRetries + 1
  for (let attempt = 1; attempt <= totalTries; attempt++) {
    const result = await runOnce(file, { cwd, timeoutMs, env })
    const kind = classifyExit(result)
    attempts.push({ attempt, kind, code: result.code, signal: result.signal, timedOut: result.timedOut, ms: result.ms })
    const stdoutText = result.stdout.toString('utf8')
    const stderrText = result.stderr.toString('utf8')

    if (kind === 'pass') {
      log(`OK   ${name}  ${result.ms}ms${attempt > 1 ? ` (passed on retry ${attempt}/${totalTries})` : ''}`)
      return { ok: true, name, attempts, stdout: stdoutText, stderr: stderrText }
    }

    if (kind === 'real-failure') {
      log(`RED  ${name}  exit=1 (real test failure) -- ${result.ms}ms`)
      if (stdoutText.trim()) log(stdoutText.trimEnd())
      if (stderrText.trim()) log(stderrText.trimEnd())
      return { ok: false, name, attempts, stdout: stdoutText, stderr: stderrText }
    }

    // infra-crash: never silent, and only ever retried for this exact reason.
    const reason = result.timedOut
      ? `timed out after ${timeoutMs}ms and was killed`
      : result.spawnError
        ? `failed to spawn: ${result.spawnError.message || result.spawnError}`
        : `exited abnormally with code=${describeCode(result.code)} signal=${result.signal ?? 'null'}`
    const bytes = `stdout=${result.stdout.length}B stderr=${result.stderr.length}B`
    const willRetry = attempt < totalTries
    log(
      `${willRetry ? 'WARN' : 'RED '} ${name}  ${reason}, ${bytes}, ${result.ms}ms (attempt ${attempt}/${totalTries}) -- ` +
      `not a real test failure (this suite always exits 1 on a real failure); ` +
      `${willRetry ? 'retrying once (infrastructure crash under load)' : 'giving up after retries -- reporting RED'}`
    )
    if (stdoutText.trim()) log('  stdout so far: ' + stdoutText.trim().split('\n').slice(-6).join('\n  stdout so far: '))
    if (stderrText.trim()) log('  stderr so far: ' + stderrText.trim().split('\n').slice(-6).join('\n  stderr so far: '))
    if (!willRetry) {
      return { ok: false, name, attempts, infra: true, stdout: stdoutText, stderr: stderrText }
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
  }
  /* c8 ignore next */
  return { ok: false, name, attempts }
}

module.exports = { runNativeTest, classifyExit, describeCode, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_RETRIES }

if (require.main === module) {
  const target = process.argv[2]
  if (!target) {
    console.error('usage: node harness/native_runner.cjs <test-file.cjs>')
    process.exit(2)
  }
  const full = path.isAbsolute(target) ? target : path.join(process.cwd(), target)
  runNativeTest(full).then((result) => { process.exitCode = result.ok ? 0 : 1 })
}
