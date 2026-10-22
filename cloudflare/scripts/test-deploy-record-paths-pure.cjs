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
  // The release steps were client-aware afterwards (a client check, a render and a target check, the client's expectations on
  // each step that reaches Cloudflare). What protects the records must still be the original text, step by step.
  const stepText = (source, name) => {
    const lines = source.split('\n')
    const at = lines.findIndex((line) => line === `      - name: ${name}`)
    assert.ok(at >= 0, `step "${name}" exists`)
    const end = lines.findIndex((line, i) => i > at && /^      (- name:|#)/.test(line))
    return lines.slice(at, end < 0 ? lines.length : end).join('\n').replace(/\n+$/, '')
  }
  for (const name of ['Show the commit', 'Verify encrypted record protection', 'Record the release', 'Preserve release evidence and history', 'Encrypt release records', 'Retain encrypted release records']) {
    assert.equal(stepText(workflow, name), stepText(original, name), `step "${name}" is the original text`)
  }
  assert.equal(
    stepText(workflow, 'Check out the release kit').replace('            /ops/scripts/client/\n', ''),
    stepText(original, 'Check out the release kit'),
    'the kit checkout only gained the client renderer folder',
  )
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
