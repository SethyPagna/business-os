#!/usr/bin/env node
// Offline checks for the "Browser suite" job of .github/workflows/gate.yml and
// for ops/scripts/deploy-kit/e2e-summary.cjs, the script that prints its verdict.
// Nothing here touches the network, a browser or Cloudflare.
//
//   A. the summary: counts, verdict, escaping, and that it never prints an
//      assertion message (the Actions logs of this repository are public);
//   B. the workflow: the job runs BESIDE the safety job, is report-only through
//      one job-level switch, has a read-only token and no secrets, installs only
//      its own browser, and uploads where the reporters write;
//   C. positive controls: the real workflow text is mutated one defect at a time
//      and rule B must name each defect, so a green B is not a rule that cannot fail.
//
// If you flip the switch for good (gate.yml input `e2e_blocking`, `default: true`),
// the rule "defaults to report-only" goes red on purpose: change its expectation
// and its comment in the same commit, so the decision is visible.
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const SUMMARY = path.join(ROOT, 'ops', 'scripts', 'deploy-kit', 'e2e-summary.cjs')
const summary = require(SUMMARY)

let passed = 0
function check(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    console.error(`FAIL ${name}\n  ${err.message}`)
    process.exitCode = 1
  }
}
// Normalise CRLF: Windows checkouts (core.autocrlf=true) must read the same text as CI.
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n')

// ------------------------------------------------ A. the summary script

// The shape of Playwright's json reporter: file suite > describe suite > spec > test.
const test = (status) => ({ projectName: 'p', status, expectedStatus: 'passed', results: [{ status: status === 'expected' ? 'passed' : 'failed', error: { message: 'SECRET-ASSERTION-TEXT https://example.invalid/x' } }] })
const spec = (file, line, title, status) => ({ title, ok: status === 'expected', file, line, column: 3, tests: [test(status)] })
function report(specs, { errors = [], duration = 61000 } = {}) {
  // Half the specs sit in a nested describe so the walker is proven to recurse.
  const half = Math.ceil(specs.length / 2)
  return { config: {}, suites: specs.length ? [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: specs.slice(0, half), suites: [{ title: 'Describe', file: 'a.spec.ts', specs: specs.slice(half) }] }] : [], errors, stats: { duration } }
}
const leg = (rep, extra = {}) => summary.format({ project: 'desktop-chromium', sha: '06182639b535aaaaaaaaaaaaaaaaaaaaaaaaaaaa', blocking: false, summary: summary.summarize(rep), ...extra })

check('all green: counts are exact, verdict GREEN, no annotation, no failure list', () => {
  const out = leg(report([spec('a.spec.ts', 1, 'one', 'expected'), spec('a.spec.ts', 2, 'two', 'expected'), spec('a.spec.ts', 3, 'three', 'skipped')], { duration: 125000 }))
  assert.strictEqual(out.verdict, 'GREEN')
  assert.strictEqual(out.line, 'Browser suite desktop-chromium @ 06182639b535: GREEN - 2 passed, 0 failed, 0 flaky, 1 skipped in 2m05s [report-only]')
  assert.strictEqual(out.annotation, '')
  assert.deepStrictEqual(out.details, [])
})

check('one unexpected test is RED, named by file:line and title, as a warning while report-only', () => {
  const out = leg(report([spec('a.spec.ts', 1, 'fine', 'expected'), spec('website-editor.spec.ts', 102, 'second Save keeps the stored value', 'unexpected')]))
  assert.strictEqual(out.verdict, 'RED')
  assert.match(out.line, /RED - 1 passed, 1 failed, 0 flaky, 0 skipped/)
  assert.deepStrictEqual(out.details, ['  FAILED website-editor.spec.ts:102  second Save keeps the stored value'])
  assert.match(out.annotation, /^::warning title=Browser suite desktop-chromium \(report-only\)::desktop-chromium: 1 failed: website-editor\.spec\.ts:102$/)
})

check('the same red is an error annotation and says blocking once the switch is on', () => {
  const out = leg(report([spec('a.spec.ts', 1, 'x', 'unexpected')]), { blocking: true })
  assert.match(out.line, /\[blocking\]$/)
  assert.match(out.annotation, /^::error title=Browser suite desktop-chromium \(blocking\)::/)
})

check('a flaky test (failed, then passed on retry) is reported as flaky and does not turn the leg red', () => {
  const out = leg(report([spec('a.spec.ts', 1, 'solid', 'expected'), spec('ios.spec.ts', 9, 'load flake', 'flaky')]))
  assert.strictEqual(out.verdict, 'GREEN')
  assert.match(out.line, /1 passed, 0 failed, 1 flaky/)
  assert.deepStrictEqual(out.details, ['  FLAKY  ios.spec.ts:9  load flake (failed, then passed on retry)'])
})

check('a run where nothing passed is RED even with zero failures (all skipped, or no tests at all)', () => {
  assert.strictEqual(leg(report([spec('a.spec.ts', 1, 'x', 'skipped')])).verdict, 'RED')
  const empty = leg(report([]))
  assert.strictEqual(empty.verdict, 'RED')
  assert.match(empty.line, /no test passed/)
})

check('a harness error with no failed test (fixture server did not start) is RED and shows its first line only', () => {
  const out = leg(report([], { errors: [{ message: 'Error: http://127.0.0.1:4318/__e2e/state is already used\n    at C:\\runner\\secret\\path' }] }))
  assert.strictEqual(out.verdict, 'RED')
  assert.match(out.line, /1 harness error\(s\)/)
  assert.deepStrictEqual(out.details, ['  ERROR  Error: http://127.0.0.1:4318/__e2e/state is already used'])
})

check('an unknown test status counts as failed, never as passed', () => {
  const out = leg(report([spec('a.spec.ts', 1, 'x', 'expected'), spec('a.spec.ts', 2, 'y', 'someFutureStatus')]))
  assert.match(out.line, /1 passed, 1 failed/)
})

check('the annotation lists each file:line once (parametrised specs share a line) and escapes % and newlines', () => {
  const rows = [1, 2, 3].map((n) => spec('receipt-assets.spec.ts', 201, `variant ${n}`, 'unexpected'))
  const out = leg(report(rows))
  assert.strictEqual(out.annotation.split('receipt-assets.spec.ts:201').length - 1, 1)
  assert.match(out.annotation, /3 failed: receipt-assets\.spec\.ts:201$/)
  assert.strictEqual(summary.escapeData('100%\r\nnext'), '100%25%0D%0Anext')
  assert.strictEqual(summary.escapeProperty('a:b,c'), 'a%3Ab%2Cc')
})

check('the failure list is capped so a collapsed suite cannot flood the public log', () => {
  const rows = Array.from({ length: summary.MAX_LISTED + 7 }, (_, i) => spec('a.spec.ts', i + 1, `t${i}`, 'unexpected'))
  const out = leg(report(rows))
  assert.strictEqual(out.details.length, summary.MAX_LISTED + 1)
  assert.strictEqual(out.details[out.details.length - 1], '  ... and 7 more')
})

function runCli(args, env = {}) {
  // On the Gate runner this very process has GITHUB_STEP_SUMMARY set: a child that
  // inherited it would write test noise into the real job summary.
  const clean = { ...process.env }
  delete clean.GITHUB_STEP_SUMMARY
  return spawnSync(process.execPath, [SUMMARY, ...args], { encoding: 'utf8', env: { ...clean, ...env } })
}
check('the CLI exits 0 whatever the verdict, writes the job summary, and prints no assertion text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-summary-'))
  try {
    const results = path.join(dir, 'results.json')
    const md = path.join(dir, 'step-summary.md')
    fs.writeFileSync(results, JSON.stringify(report([spec('a.spec.ts', 1, 'broken', 'unexpected')])))
    const r = runCli(['--project', 'ios-webkit', '--sha', 'abcdef0123456789', '--results', results, '--blocking', 'false'], { GITHUB_STEP_SUMMARY: md })
    assert.strictEqual(r.status, 0, 'information only: a red verdict must not fail the summary step')
    assert.match(r.stdout, /Browser suite ios-webkit @ abcdef012345: RED - 0 passed, 1 failed/)
    assert.match(fs.readFileSync(md, 'utf8'), /### Browser suite: ios-webkit - RED \(report-only\)/)
    assert.ok(!/SECRET-ASSERTION-TEXT|example\.invalid/.test(r.stdout + fs.readFileSync(md, 'utf8')), 'assertion messages must never reach the public log')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

check('the CLI says NO REPORT, still exits 0, for a missing file and for garbage JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-summary-'))
  try {
    const bad = path.join(dir, 'bad.json')
    fs.writeFileSync(bad, '{ not json')
    for (const results of [path.join(dir, 'missing.json'), bad]) {
      const r = runCli(['--project', 'desktop-chromium', '--sha', '06182639b535', '--results', results])
      assert.strictEqual(r.status, 0)
      assert.match(r.stdout, /NO REPORT/)
      assert.match(r.stdout, /^::warning title=Browser suite desktop-chromium \(report-only\)::desktop-chromium: no report$/m)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ------------------------------------------------------- B. the workflow

// Full-line comments are explanation, not configuration: strip them so a rule never
// matches the words of its own comment.
const codeOf = (text) => text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')

function jobsOf(code) {
  const body = code.slice(code.indexOf('\njobs:\n') + 7)
  const heads = [...body.matchAll(/^ {2}([A-Za-z0-9_-]+):\n/gm)]
  const out = {}
  heads.forEach((m, i) => { out[m[1]] = body.slice(m.index, i + 1 < heads.length ? heads[i + 1].index : body.length) })
  return out
}
const stepOf = (job, titleStart) => (job.split('\n      - ').find((s) => s.startsWith(`name: ${titleStart}`)) || '')
const minutesOf = (job) => Number((/^ {4}timeout-minutes: (\d+)$/m.exec(job) || [])[1])

function configProjects() {
  return [...read('frontend', 'playwright.config.ts').matchAll(/^\s+name: '([a-z0-9-]+)',?$/gm)].map((m) => m[1]).sort()
}

// [rule, predicate({code, jobs, e2e, gate})]. Every rule is a sentence about behaviour.
const BASE = '${{ runner.temp }}/e2e/${{ matrix.project }}'
const RULES = [
  ['the workflow has exactly two jobs: gate and e2e', ({ jobs }) => Object.keys(jobs).sort().join() === 'e2e,gate'],
  ['no job has needs: e2e runs beside the safety job and nothing waits for it', ({ code }) => !/^\s+needs:/m.test(code)],
  ['the safety job never mentions the browser suite', ({ gate }) => !/e2e|playwright test/i.test(gate)],
  ['the only continue-on-error is the e2e JOB-level switch, derived from the input', ({ code, e2e }) =>
    (code.match(/continue-on-error:/g) || []).length === 1 && /^ {4}continue-on-error: \$\{\{ inputs\.e2e_blocking != true \}\}$/m.test(e2e)],
  ['input e2e_blocking is a boolean that defaults to report-only (false)', ({ code }) => {
    const block = /^ {6}e2e_blocking:\n((?: {8}.*\n)+)/m.exec(code)
    return !!block && /^ {8}default: false$/m.test(block[1]) && /^ {8}type: boolean$/m.test(block[1])
  }],
  ['the trigger is workflow_dispatch only', ({ code }) => /^on:\n {2}workflow_dispatch:\n/m.test(code) && !/pull_request|^ {2}push:|schedule:/m.test(code)],
  ['one leg per Playwright project in playwright.config.ts, Chromium for *-chromium and WebKit for the iPhone', ({ e2e }) => {
    const legs = [...e2e.matchAll(/- project: ([a-z0-9-]+)\n\s+browser: (\w+)/g)].map((m) => [m[1], m[2]])
    return legs.map((l) => l[0]).sort().join() === configProjects().join() && legs.every(([p, b]) => b === (p.endsWith('webkit') ? 'webkit' : 'chromium'))
  }],
  ['a red leg does not cancel the others (fail-fast: false)', ({ e2e }) => /^ {6}fail-fast: false$/m.test(e2e)],
  ['only the leg\'s own browser is installed', ({ e2e }) => {
    const installs = [...e2e.matchAll(/playwright install(.*)/g)].map((m) => m[1].trim())
    return installs.length === 1 && installs[0] === '$env:E2E_BROWSER'
  }],
  ['install, then build, then run the suite for the leg\'s project with html and json reporters', ({ e2e }) => {
    const at = (s) => e2e.indexOf(s)
    return at('npm ci') > 0 && at('npm run build') > at('npm ci') && at('npx playwright test "--project=$env:E2E_PROJECT" "--reporter=list,html,json"') > at('npm run build')
  }],
  ['the worker count follows the runner\'s CPUs', ({ e2e }) => /ProcessorCount/.test(e2e) && /\$env:E2E_WORKERS = /.test(e2e)],
  ['the suite step fails the job when Playwright fails', ({ e2e }) => /exit \$LASTEXITCODE/.test(stepOf(e2e, 'Browser suite (app tier'))],
  ['the HTML report, the JSON file and the upload agree, and the JSON is a sibling of the report folder', ({ e2e }) => {
    // Values hold spaces (${{ runner.temp }}), so capture to the end of the line.
    const html = (/PLAYWRIGHT_HTML_OUTPUT_DIR: (.+)$/m.exec(e2e) || [])[1]
    const json = (/PLAYWRIGHT_JSON_OUTPUT_FILE: (.+)$/m.exec(e2e) || [])[1]
    const results = (/E2E_RESULTS: (.+)$/m.exec(e2e) || [])[1]
    const upload = (/^ {10}path: (.+)$/m.exec(stepOf(e2e, 'Keep the browser report')) || [])[1]
    return html === `${BASE}/report` && json === `${BASE}/results.json` && results === json && upload === BASE
  }],
  ['the browser report is uploaded even when the suite fails, per project, for 14 days', ({ e2e }) => {
    const s = stepOf(e2e, 'Keep the browser report')
    return /^ {8}if: always\(\)$/m.test(s) && /uses: actions\/upload-artifact@v\d+/.test(s) && /name: e2e-report-\$\{\{ matrix\.project \}\}/.test(s) && /retention-days: 14\b/.test(s)
  }],
  ['the summary runs even when the suite fails and reads the same JSON file', ({ e2e }) => {
    const s = stepOf(e2e, 'Summary line')
    return /^ {8}if: always\(\)$/m.test(s) && /deploy-kit\/e2e-summary\.cjs/.test(s) && /--results \$env:E2E_RESULTS/.test(s) && fs.existsSync(SUMMARY)
  }],
  ['no secret is referenced anywhere in the workflow', ({ code }) => !/secrets\./.test(code)],
  ['the tokens are read-only: workflow and e2e job both say contents: read and nothing is write', ({ code, e2e }) =>
    /^permissions:\n {2}contents: read\n/m.test(code) && /^ {4}permissions:\n {6}contents: read\n/m.test(e2e) && !/:\s*write\b/.test(code)],
  ['the e2e job names no Cloudflare, wrangler, remote flag or URL: loopback only', ({ e2e }) => !/cloudflare|wrangler|--remote|with-wrangler-auth|https?:\/\/|workers\.dev|leangbeauty/i.test(e2e)],
  ['every action is pinned to a major version, as the safety job does', ({ code }) => {
    const uses = [...code.matchAll(/uses: (\S+)/g)].map((m) => m[1])
    return uses.length > 0 && uses.every((u) => /^[\w-]+\/[\w-]+@v\d+$/.test(u))
  }],
  ['every checkout drops its credentials after cloning', ({ code }) => (code.match(/uses: actions\/checkout@/g) || []).length === (code.match(/persist-credentials: false/g) || []).length],
  ['the e2e job can never outlive the safety job\'s timeout', ({ gate, e2e }) => minutesOf(e2e) > 0 && minutesOf(e2e) <= minutesOf(gate)],
]

function verifyWorkflow(text) {
  const code = codeOf(text)
  const jobs = jobsOf(code)
  const ctx = { code, jobs, gate: jobs.gate || '', e2e: jobs.e2e || '' }
  return RULES.filter(([, pass]) => { try { return !pass(ctx) } catch { return true } }).map(([rule]) => rule)
}

const GATE = read('.github', 'workflows', 'gate.yml')

check('gate.yml satisfies every browser-suite rule', () => {
  assert.deepStrictEqual(verifyWorkflow(GATE), [])
})

check('the config really has three projects (a fourth would silently never run in the gate)', () => {
  assert.deepStrictEqual(configProjects(), ['android-chromium', 'desktop-chromium', 'ios-webkit'])
})

check('Playwright still reads the environment variables the job relies on (else the artifact would be empty and upload-artifact would not say so)', () => {
  const runner = path.join(ROOT, 'frontend', 'node_modules', 'playwright', 'lib', 'runner', 'index.js')
  if (!fs.existsSync(runner)) return // packages not installed here; the gate runner installs them before this file runs
  const src = fs.readFileSync(runner, 'utf8')
  assert.ok(src.includes('PLAYWRIGHT_HTML_OUTPUT_DIR'), 'HTML reporter no longer reads PLAYWRIGHT_HTML_OUTPUT_DIR')
  assert.ok(src.includes('PLAYWRIGHT_HTML_OPEN'), 'HTML reporter no longer reads PLAYWRIGHT_HTML_OPEN')
  assert.ok(src.includes('`PLAYWRIGHT_${name}_OUTPUT_FILE`'), 'JSON reporter no longer reads PLAYWRIGHT_JSON_OUTPUT_FILE')
})

// ------------------------------------------- C. positive controls (mutants)

// Each mutant must change the text (a no-op mutant would pass vacuously) and rule B
// must name exactly the defect.
function mutate(text, from, to) {
  assert.ok(text.includes(from), `mutation target not found: ${from.slice(0, 60)}`)
  return text.replace(from, () => to) // a function, so "$" in the replacement stays literal
}
// The e2e job is the second job in the file, so its copy is the LAST occurrence.
function mutateLast(text, from, to) {
  const at = text.lastIndexOf(from)
  assert.ok(at >= 0, `mutation target not found: ${from.slice(0, 60)}`)
  return text.slice(0, at) + to + text.slice(at + from.length)
}
const SWITCH = 'continue-on-error: ${{ inputs.e2e_blocking != true }}'
const MUTANTS = [
  ['the job-level switch is removed', (t) => mutate(t, `    ${SWITCH}\n`, ''), 'the only continue-on-error'],
  ['the switch is hard-coded true, so the input does nothing', (t) => mutate(t, SWITCH, 'continue-on-error: true'), 'the only continue-on-error'],
  ['a step-level continue-on-error is added (the job would read green)', (t) => mutate(t, '        run: npm run build\n', '        continue-on-error: true\n        run: npm run build\n'), 'the only continue-on-error'],
  ['the safety job is made to wait for the browser suite', (t) => mutate(t, '    name: Safety tests\n', '    name: Safety tests\n    needs: e2e\n'), 'no job has needs'],
  ['the browser suite is made to wait for the safety job', (t) => mutate(t, '    name: Browser suite (${{ matrix.project }})\n', '    name: Browser suite (${{ matrix.project }})\n    needs: gate\n'), 'no job has needs'],
  ['a secret is passed to the browser suite', (t) => mutate(t, '      E2E_BLOCKING: ${{ inputs.e2e_blocking }}\n', '      E2E_BLOCKING: ${{ inputs.e2e_blocking }}\n      TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n'), 'no secret is referenced'],
  ['the job token can write', (t) => mutate(t, '    permissions:\n      contents: read\n', '    permissions:\n      contents: write\n'), 'the tokens are read-only'],
  ['an action floats on a branch', (t) => mutateLast(t, 'actions/setup-node@v4', 'actions/setup-node@main'), 'pinned to a major version'],
  ['a checkout keeps the token in git config', (t) => mutateLast(t, 'persist-credentials: false', 'persist-credentials: true'), 'every checkout drops'],
  ['fail-fast is switched on', (t) => mutate(t, '      fail-fast: false\n', '      fail-fast: true\n'), 'fail-fast'],
  ['the iPhone leg is dropped from the matrix', (t) => mutate(t, '          - project: ios-webkit\n            browser: webkit\n', ''), 'one leg per Playwright project'],
  ['the iPhone leg installs Chromium', (t) => mutate(t, 'browser: webkit', 'browser: chromium'), 'one leg per Playwright project'],
  ['every browser is installed for every leg', (t) => mutate(t, 'npx playwright install $env:E2E_BROWSER', 'npx playwright install'), 'only the leg\'s own browser'],
  ['the build is skipped', (t) => mutate(t, '        run: npm run build\n', '        run: echo skipped\n'), 'install, then build'],
  ['the JSON file is moved inside the report folder (the HTML reporter would delete it)', (t) => mutate(t, 'PLAYWRIGHT_JSON_OUTPUT_FILE: ${{ runner.temp }}/e2e/${{ matrix.project }}/results.json', 'PLAYWRIGHT_JSON_OUTPUT_FILE: ${{ runner.temp }}/e2e/${{ matrix.project }}/report/results.json'), 'the HTML report, the JSON file and the upload agree'],
  ['the artifact is kept for 90 days', (t) => mutateLast(t, 'retention-days: 14', 'retention-days: 90'), 'for 14 days'],
  ['the report upload only runs on success', (t) => mutate(t, '      - name: Keep the browser report\n        if: always()\n', '      - name: Keep the browser report\n        if: success()\n'), 'uploaded even when the suite fails'],
  ['the summary only runs on success', (t) => mutate(t, '      - name: Summary line\n        if: always()\n', '      - name: Summary line\n        if: success()\n'), 'the summary runs even when'],
  ['the suite step swallows the exit code', (t) => mutate(t, '          exit $LASTEXITCODE\n', '          exit 0\n'), 'fails the job when Playwright fails'],
  ['the job reaches a remote URL', (t) => mutate(t, '          Write-Output "Browser suite $env:E2E_PROJECT:', '          Invoke-WebRequest https://admin.leangbeauty.com\n          Write-Output "Browser suite $env:E2E_PROJECT:'), 'loopback only'],
  ['a push trigger is added', (t) => mutate(t, 'on:\n  workflow_dispatch:\n', 'on:\n  push:\n  workflow_dispatch:\n'), 'workflow_dispatch only'],
  ['the switch defaults to blocking', (t) => mutate(t, '        default: false\n        type: boolean\n', '        default: true\n        type: boolean\n'), 'defaults to report-only'],
  ['the e2e job may run longer than the safety job', (t) => mutate(t, '    timeout-minutes: 90\n', '    timeout-minutes: 400\n'), 'can never outlive'],
  ['a third job is added without anyone deciding it belongs in the gate', (t) => `${t.replace(/\n*$/, '\n')}\n  extra:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`, 'exactly two jobs'],
  ['the worker count is hard-coded, so a 2-CPU runner would be oversubscribed', (t) => mutate(t, '$cpus = [Environment]::ProcessorCount', '$cpus = 4'), 'worker count follows'],
]
for (const [what, apply, rule] of MUTANTS) {
  check(`mutant, ${what}: the workflow rules name it`, () => {
    const problems = verifyWorkflow(apply(GATE))
    assert.ok(problems.some((p) => p.includes(rule)), `expected a rule containing "${rule}", got: ${JSON.stringify(problems)}`)
  })
}

check('control: the comment words of the header do not satisfy or break a rule (comments are stripped)', () => {
  const noisy = `# continue-on-error: true\n# needs: gate\n# secrets.X\n${GATE}`
  assert.deepStrictEqual(verifyWorkflow(noisy), [])
})

if (!process.exitCode) console.log(`gate browser-suite job: ${passed} checks passed`)
