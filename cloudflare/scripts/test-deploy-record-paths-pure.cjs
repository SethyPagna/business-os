'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cp = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8').replace(/\r\n/g, '\n')
const original = cp.execFileSync('git', ['show', 'c22a22e61ddeb4a8ab89d1b8f3ca8864b70d43f3:.github/workflows/deploy.yml'], { cwd: root, encoding: 'utf8' }).replace(/\r\n/g, '\n')
let passed = 0
function check(name, action) { action(); passed++; console.log(`PASS ${name}`) }
// The gate_run_id feature adds steps and `if:` lines but changes no existing step. Taking exactly those
// back out must give the original steps byte for byte, so the pin on every other step stays as strict as before.
// The reuse checks live in their own job (gate_check), which comes after the deploy job in the file, and the deploy job
// gained a `needs` and an `if` before its steps; neither is inside the steps compared here.
const GATE_REUSE_STEPS = ['Download the gate evidence', 'Check the gate verdict at deploy time', 'Keep the gate verdict with the release records', 'Keep the gate test logs with the release records', 'Build the app \\(the gate run proved its tests\\)', 'Check the built app is the app the gate tested', 'Pin the tested app for the publish step']
function withoutGateReuse(source) {
  const deployJobOnly = source.slice(0, source.indexOf('\n  # Runs only with gate_run_id'))
  const added = new RegExp(`(?:      #.*\\n)*      - name: (?:${GATE_REUSE_STEPS.join('|')})\\n(?:        .*\\n|\\n(?=        ))*\\n?`, 'g')
  return deployJobOnly.replace(added, '').replace(/^ {8}if: \$\{\{ inputs\.gate_run_id [!=]= '' \}\}\n/gm, '').replace(/\n*$/, '\n')
}
function jobEnvironment(source) { return source.match(/^    env:\n((?:      .*\n)*)/m)?.[1] || '' }
function initializer(source) {
  const block = source.match(/^      - name: Initialize release record paths\n        run: \|\n((?:          .*\n|\n)*)/m)
  assert.ok(block, 'actual path initialization step exists')
  return block[1].split('\n').map(line => line.slice(10)).join('\n')
}
check('original806 job context is invalid; current paths use runner-time initialization', () => {
  assert.match(jobEnvironment(original), /\$\{\{ runner\.temp \}\}/)
  assert.doesNotMatch(jobEnvironment(workflow), /\$\{\{ runner\./)
  assert.doesNotMatch(initializer(workflow), /\$\{\{/)
})
const script = initializer(workflow)
check('confirmation precedes initialization and encryption protects every production phase', () => {
  assert.ok(workflow.indexOf('Check the confirm word') < workflow.indexOf('Initialize release record paths'))
  assert.ok(workflow.indexOf('Initialize release record paths') < workflow.indexOf('Check out the release kit'))
  assert.ok(workflow.indexOf('Verify encrypted record protection') < workflow.indexOf('Record the release'))
  const originalSteps = original.slice(original.indexOf('      - name: Check out the release kit'))
  assert.equal(withoutGateReuse(workflow.slice(workflow.indexOf('      - name: Check out the release kit'))), originalSteps)
})
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'business-os-record paths-'))
const files = []
let sequence = 0
function run(overrides = {}) {
  const envFile = path.join(temporary, `environment-${++sequence}.txt`)
  fs.writeFileSync(envFile, '')
  files.push(envFile)
  const env = { ...process.env, RUNNER_TEMP: temporary, GITHUB_ENV: envFile, GITHUB_RUN_ID: '39166792753', GITHUB_RUN_ATTEMPT: '1', ...overrides }
  const result = cp.spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { env, encoding: 'utf8', windowsHide: true, timeout: 15000 })
  assert.ifError(result.error)
  return { ...result, lines: fs.readFileSync(envFile, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(Boolean) }
}
try {
  for (const [id, attempt] of [['1', '1'], ['39166792753', '2'], ['39166792754', '12']]) check(`exact two isolated paths for run ${id} attempt ${attempt}`, () => {
    const result = run({ GITHUB_RUN_ID: id, GITHUB_RUN_ATTEMPT: attempt })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '')
    assert.deepEqual(result.lines, [`RELEASE_RECORDS_ROOT=${path.join(temporary, `records-${id}-${attempt}`)}`, `RELEASE_RECORDS_OUTPUT=${path.join(temporary, `release-records-${id}-${attempt}.enc.json`)}`])
  })
  check('shell-looking temp characters remain literal data', () => {
    const literal = path.join(temporary, 'literal $(Write-Output injected); $env:UNKNOWN')
    const result = run({ RUNNER_TEMP: literal })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '')
    assert.deepEqual(result.lines, [`RELEASE_RECORDS_ROOT=${path.join(literal, 'records-39166792753-1')}`, `RELEASE_RECORDS_OUTPUT=${path.join(literal, 'release-records-39166792753-1.enc.json')}`])
  })
  for (const [key, value] of [['GITHUB_RUN_ID', ''], ['GITHUB_RUN_ATTEMPT', '0'], ['GITHUB_RUN_ID', '1\nINJECTED=yes'], ['GITHUB_RUN_ATTEMPT', '$(Write-Output injected)'], ['RUNNER_TEMP', ''], ['RUNNER_TEMP', 'relative'], ['RUNNER_TEMP', temporary + '\nINJECTED=yes'], ['GITHUB_ENV', '']]) check(`invalid ${key} refuses before any environment write ${++sequence}`, () => {
    const result = run({ [key]: value })
    assert.notEqual(result.status, 0)
    assert.deepEqual(result.lines, [])
    assert.equal(result.stdout, '')
  })
  assert.deepEqual(fs.readdirSync(temporary).sort(), files.map(file => path.basename(file)).sort())
} finally {
  for (const file of files) fs.unlinkSync(file)
  fs.rmdirSync(temporary)
}
console.log(`${passed} passed`)
