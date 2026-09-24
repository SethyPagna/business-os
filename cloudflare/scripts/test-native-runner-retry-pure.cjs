// Discriminating self-test for scripts/harness/native_runner.cjs -- the
// supervisor added 23 Sep 2026 for the "*-native.cjs sometimes exits
// non-zero with ZERO bytes of output under concurrency" test-infrastructure
// defect (test-product-conflict-action-apply-native.cjs and
// test-dataset-operation-transition-native.cjs were the two examples that
// triggered the fix; concurrent-driver reproduction on this machine caught
// the same failure exiting with code 3221226505 / 0xC0000409 and zero bytes
// on both streams -- a Windows ucrt/V8 fail-fast, not a JS-catchable error).
//
// "Old harness" for this file means "no harness": before this fix, native
// tests were spawned directly (`node test-x-native.cjs`) with no supervisor
// at all, so a silent infra crash was indistinguishable from "nobody knows
// what happened". There is no earlier, differently-buggy native_runner.cjs
// to diff against -- checking this file out before the commit that adds
// native_runner.cjs fails outright (MODULE_NOT_FOUND), which is the
// correct discriminating result for a capability that did not exist yet.
//
// Run (from cloudflare/): node scripts/test-native-runner-retry-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { runNativeTest, classifyExit, describeCode } = require('./harness/native_runner.cjs')

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }

// --- classifyExit: the exact rule the whole fix depends on -----------------
// Every test-*-native.cjs file exits 0 (pass) or 1 (real failure) on
// purpose (grep confirms it suite-wide); anything else is not a shape this
// suite ever chooses deliberately.
check('a clean exit(0) classifies as pass', classifyExit({ code: 0, signal: null, timedOut: false }) === 'pass')
check('a deliberate exit(1) classifies as real-failure', classifyExit({ code: 1, signal: null, timedOut: false }) === 'real-failure')
check(
  'a signal beats code=1 -- a process the OS also signalled is never trusted as a clean deliberate exit(1)',
  classifyExit({ code: 1, signal: 'SIGTERM', timedOut: false }) === 'infra-crash',
)
check('code=null with a signal classifies as infra-crash', classifyExit({ code: null, signal: 'SIGTERM', timedOut: false }) === 'infra-crash')
check('an unrelated exit code (e.g. 130) is not code 0 or 1, so it classifies as infra-crash', classifyExit({ code: 130, signal: null, timedOut: false }) === 'infra-crash')
check(
  'a timeout beats code=0 -- a process we had to SIGKILL for hanging is never trusted even if code happens to read 0',
  classifyExit({ code: 0, signal: null, timedOut: true }) === 'infra-crash',
)
check(
  'the exact code seen in production (3221226505 / 0xC0000409) classifies as infra-crash, not a test result',
  classifyExit({ code: 3221226505, signal: null, timedOut: false }) === 'infra-crash',
)
check('describeCode names the known Windows fail-fast hex so a reader is never left guessing', /c0000409/.test(describeCode(3221226505)) && /fail-fast/.test(describeCode(3221226505)))

// --- runNativeTest: real child processes, no real workerd needed ----------
async function withFixtures(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-runner-selftest-'))
  try { return await fn(dir) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

function write(dir, name, source) {
  const file = path.join(dir, name)
  fs.writeFileSync(file, source)
  return file
}

async function main() {
  await withFixtures(async (dir) => {
    // A clean pass is reported once, with no retry.
    const passFile = write(dir, 'pass.cjs', "console.log('fixture pass'); process.exit(0)\n")
    const logsPass = []
    const passResult = await runNativeTest(passFile, { log: (l) => logsPass.push(l) })
    check('a clean pass resolves ok with exactly one attempt', passResult.ok === true && passResult.attempts.length === 1)
    check('a clean pass is logged as OK', logsPass.some((l) => l.startsWith('OK   ')))

    // A real, asserted failure (exit 1, with output) must NEVER be retried --
    // retrying a real failure would risk hiding an actual regression.
    const realFailFile = write(dir, 'real-failure.cjs', "console.error('fixture real failure: assertion X'); process.exitCode = 1\n")
    const logsReal = []
    const realResult = await runNativeTest(realFailFile, { log: (l) => logsReal.push(l), maxRetries: 3 })
    check('a real failure (exit 1) resolves not-ok with exactly ONE attempt, never retried', realResult.ok === false && realResult.attempts.length === 1)
    check('a real failure is reported RED with its own stderr, not swallowed', logsReal.some((l) => l.startsWith('RED  ')) && logsReal.some((l) => l.includes('fixture real failure: assertion X')))

    // A one-time infra crash (the production signature: nonstandard exit
    // code, zero output) recovers on retry -- this is the case the fix
    // exists for: test-product-conflict-action-apply-native.cjs passed
    // alone and failed only under contention.
    const marker = path.join(dir, 'flaky-marker.txt')
    const flakyFile = write(dir, 'flaky-once.cjs', [
      "const fs = require('fs')",
      `const marker = ${JSON.stringify(marker)}`,
      'if (!fs.existsSync(marker)) { fs.writeFileSync(marker, "1"); process.exit(3221226505) }',
      "console.log('fixture recovered on retry')",
      'process.exit(0)',
      '',
    ].join('\n'))
    const logsFlaky = []
    const flakyResult = await runNativeTest(flakyFile, { log: (l) => logsFlaky.push(l), maxRetries: 1 })
    check(
      'a one-time infra crash (crash code, zero output) is retried and ends up ok, with both attempts recorded',
      flakyResult.ok === true && flakyResult.attempts.length === 2 &&
      flakyResult.attempts[0].kind === 'infra-crash' && flakyResult.attempts[1].kind === 'pass',
    )
    check(
      'the retry is logged loudly with the reason -- never a silent re-run',
      logsFlaky.some((l) => l.startsWith('WARN') && l.includes('retrying') && l.includes('flaky-once.cjs')),
    )

    // A persistent infra crash (never recovers) exhausts retries and is
    // reported RED, loudly, with the evidence -- proving the fix does not
    // turn a real, reproducible problem into an infinite or silent retry.
    const alwaysCrashFile = write(dir, 'always-crash.cjs', 'process.exit(3221226505)\n')
    const logsCrash = []
    const crashResult = await runNativeTest(alwaysCrashFile, { log: (l) => logsCrash.push(l), maxRetries: 2 })
    check(
      'a persistent infra crash exhausts retries (maxRetries=2 -> 3 attempts) and resolves not-ok',
      crashResult.ok === false && crashResult.infra === true && crashResult.attempts.length === 3 &&
      crashResult.attempts.every((a) => a.kind === 'infra-crash'),
    )
    check(
      'giving up after retries is reported RED with the decoded exit code, never zero bytes of explanation',
      // Windows reports the full 32-bit 0xC0000409; POSIX truncates an exit
      // status to 8 bits (3221226505 & 0xff = 9). Assert the code the OS
      // actually delivered is decoded in the RED line, and the Windows hex on
      // Windows, so the check holds on a Linux runner too.
      logsCrash.some((l) => l.startsWith('RED  ') && l.includes('giving up after retries') &&
        l.includes(describeCode(crashResult.attempts[crashResult.attempts.length - 1].code)) &&
        (process.platform !== 'win32' || l.includes('c0000409'))),
    )

    // A hang is killed on the harness's own timeout and classified the same
    // way as a crash (infra, retryable) -- "adequate/adaptive readiness
    // wait" per the task: the harness must not hang forever either.
    const hangFile = write(dir, 'hang.cjs', 'setInterval(() => {}, 1000)\n')
    const logsHang = []
    const hangResult = await runNativeTest(hangFile, { log: (l) => logsHang.push(l), maxRetries: 0, timeoutMs: 300 })
    check(
      'a hang is killed after the timeout, classified as infra-crash, and reported RED (not left running forever)',
      hangResult.ok === false && hangResult.attempts.length === 1 && hangResult.attempts[0].kind === 'infra-crash' && hangResult.attempts[0].timedOut === true,
    )
    check('a timeout kill names itself as a timeout, not an unexplained crash', logsHang.some((l) => l.includes('timed out after 300ms')))
  })

  console.log(`\nALL ${passed} CHECKS PASSED`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
