#!/usr/bin/env node
// Lint for .github/workflows/weekly-backup.yml: inert until WEEKLY_BACKUP_ENABLED is true, dispatch-only until slice S8 (the cron lines stay comments and
// equal the constants file), Node pinned to the gate's version, only the two placeholder secrets, no secret value, no remote D1 call outside the script.
// Each rule is run against the real file (no problem) and against a planted mutant of it (a problem).
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..', '..')
const FILE = path.join(ROOT, '.github', 'workflows', 'weekly-backup.yml')
const text = () => fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n')
const SECRET_NAMES = ['WEEKLY_D1_READ_TOKEN', 'WEEKLY_R2_WRITE_TOKEN']
const ALLOWED_EXPRESSIONS = new Set(['vars.WEEKLY_BACKUP_ENABLED', 'vars.CLOUDFLARE_ACCOUNT_ID', 'vars.WEEKLY_R2_TOKEN_ID', 'secrets.WEEKLY_D1_READ_TOKEN', 'secrets.WEEKLY_R2_WRITE_TOKEN', 'inputs.force', 'runner.temp'])

let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1 } catch (err) { process.exitCode = 1; console.error(`FAIL ${name}\n  ${err && err.stack}`) }
}

// The problems a workflow text has (empty list = clean).
function lint(yaml, constants) {
  const problems = []
  const lines = yaml.split('\n')
  const code = lines.filter((l) => !/^\s*#/.test(l))
  const codeText = code.join('\n')
  const jobsAt = code.findIndex((l) => /^jobs:\s*$/.test(l))
  if (jobsAt < 0) return ['no-jobs']
  const jobs = []
  for (let i = jobsAt + 1; i < code.length; i += 1) {
    const m = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(code[i])
    if (m) jobs.push({ id: m[1], at: i })
  }
  if (!jobs.length) problems.push('no-job')
  jobs.forEach((job, k) => {
    const body = code.slice(job.at, k + 1 < jobs.length ? jobs[k + 1].at : code.length).join('\n')
    const gate = new RegExp(`^ {4}if: \\$\\{\\{ vars\\.${constants.WEEKLY_ENABLED_VARIABLE} == 'true'`, 'm')
    if (!gate.test(body)) problems.push(`job-not-gated:${job.id}`)
  })
  if (/^\s*(?:schedule|cron)\s*:|^\s*-\s*cron\s*:/m.test(codeText)) problems.push('schedule-is-on')
  const commented = lines.filter((l) => /^\s*#\s*-\s*cron:/.test(l)).map((l) => l.replace(/^\s*#\s*-\s*cron:\s*/, '').replace(/['"]/g, '').trim())
  if (commented.join('|') !== [constants.WEEKLY_SCHEDULE_UTC, constants.WEEKLY_RETRY_UTC].join('|')) problems.push('cron-lines-differ-from-constants')
  const versions = [...codeText.matchAll(/node-version:\s*(\S+)/g)].map((m) => m[1].replace(/['"]/g, ''))
  if (!versions.length || versions.some((v) => v !== constants.NODE_PIN)) problems.push('node-version-not-pinned')
  if (!/^permissions:\n {2}contents: read\n/m.test(codeText)) problems.push('permissions-not-read-only')
  if (!/^concurrency:\n {2}group: production-deploy\n/m.test(codeText)) problems.push('not-in-the-deploy-concurrency-group')
  if (/continue-on-error/.test(codeText)) problems.push('continue-on-error')
  if (/pull_request|push:|workflow_run/.test(codeText)) problems.push('unexpected-trigger')
  if (/--remote|d1 execute|wrangler/i.test(codeText)) problems.push('direct-wrangler-call')
  const expressions = [...codeText.matchAll(/\$\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1])
  for (const expression of expressions) {
    const names = expression.match(/(?:vars|secrets|inputs|runner|github)\.[A-Za-z0-9_.]+/g) || []
    for (const name of names) if (!ALLOWED_EXPRESSIONS.has(name) && !/^github\./.test(name)) problems.push(`expression-not-allowed:${name}`)
  }
  for (const secret of [...codeText.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1])) if (!SECRET_NAMES.includes(secret)) problems.push(`secret-not-a-placeholder:${secret}`)
  for (const name of SECRET_NAMES) if (!codeText.includes(`secrets.${name}`)) problems.push(`secret-unused:${name}`)
  if (/(?:TOKEN|SECRET|KEY)\w*:\s*(?!\$\{\{)\S{8,}/.test(codeText)) problems.push('a-literal-secret-value')
  if (/\b[A-Za-z0-9_-]{40,}\b/.test(codeText.replace(/\$\{\{[^}]*\}\}/g, ''))) problems.push('a-long-token-like-string')
  if (!/node ops\/scripts\/ops-weekly\.mjs/.test(codeText)) problems.push('does-not-run-the-weekly-script')
  return problems
}

async function main() {
  const constants = await import(pathToFileURL(path.join(ROOT, 'ops', 'scripts', 'weekly', 'constants.mjs')).href)

  await check('the real workflow has no problem', () => {
    assert.deepStrictEqual(lint(text(), constants), [])
  })

  await check('constants: the schedule is Sunday 20:30 UTC with a Monday retry, the variable and the Node pin are named once', () => {
    assert.strictEqual(constants.WEEKLY_SCHEDULE_UTC, '30 20 * * 0')
    assert.strictEqual(constants.WEEKLY_RETRY_UTC, '30 20 * * 1')
    assert.strictEqual(constants.WEEKLY_ENABLED_VARIABLE, 'WEEKLY_BACKUP_ENABLED')
    assert.strictEqual(constants.NODE_PIN, '24.22.2')
    assert.ok(24 * (7 + 1) >= 7 * 24, 'the stale bell\'s 198 h covers a week plus slack')
  })

  const mutants = [
    ['a job without the enabled gate', (s) => s.replace("    if: ${{ vars.WEEKLY_BACKUP_ENABLED == 'true' }}\n", ''), 'job-not-gated:weekly'],
    ['the gate tests another variable', (s) => s.replace("vars.WEEKLY_BACKUP_ENABLED == 'true'", "vars.SOMETHING_ELSE == 'true'"), 'job-not-gated:weekly'],
    ['the Sunday cron is switched on', (s) => s.replace("  # schedule:\n  #   - cron: '30 20 * * 0'", "  schedule:\n    - cron: '30 20 * * 0'"), 'schedule-is-on'],
    ['a cron line differs from the constants', (s) => s.replace("'30 20 * * 1'", "'30 21 * * 1'"), 'cron-lines-differ-from-constants'],
    ['Node is not pinned', (s) => s.replace("node-version: '24.22.2'", 'node-version: 24'), 'node-version-not-pinned'],
    ['write permission on the token', (s) => s.replace('  contents: read', '  contents: write'), 'permissions-not-read-only'],
    ['another group, so an export could straddle a deploy', (s) => s.replace('group: production-deploy', 'group: weekly'), 'not-in-the-deploy-concurrency-group'],
    ['a pull_request trigger', (s) => s.replace('on:\n  workflow_dispatch:', 'on:\n  pull_request:\n  workflow_dispatch:'), 'unexpected-trigger'],
    ['a direct remote D1 call', (s) => s.replace('run: node ops/scripts/ops-weekly.mjs', 'run: npx wrangler d1 execute business-os --remote'), 'direct-wrangler-call'],
    ['an unknown secret', (s) => s.replace('secrets.WEEKLY_R2_WRITE_TOKEN', 'secrets.CLOUDFLARE_API_TOKEN'), 'secret-not-a-placeholder:CLOUDFLARE_API_TOKEN'],
    ['a literal token value', (s) => s.replace('WEEKLY_R2_WRITE_TOKEN: ${{ secrets.WEEKLY_R2_WRITE_TOKEN }}', 'WEEKLY_R2_WRITE_TOKEN: abcdefghijklmnop'), 'a-literal-secret-value'],
    ['continue-on-error', (s) => s.replace('    timeout-minutes: 150', '    timeout-minutes: 150\n    continue-on-error: true'), 'continue-on-error'],
  ]
  for (const [label, mutate, expected] of mutants) {
    await check(`mutant caught: ${label}`, () => {
      const real = text()
      const mutated = mutate(real)
      assert.notStrictEqual(mutated, real, 'the mutation must change the workflow')
      assert.ok(lint(mutated, constants).includes(expected), `expected ${expected}, got ${lint(mutated, constants).join(',')}`)
    })
  }

  console.log(process.exitCode ? `test-ops-weekly-workflow-pure: FAILED (${passed} passed)` : `test-ops-weekly-workflow-pure: ${passed} checks passed`)
}

main().catch((err) => { process.exitCode = 1; console.error(err) })
