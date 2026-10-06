#!/usr/bin/env node
// Lint for .github/workflows/ops.yml and the ops scripts it runs.
//
// This repository is PUBLIC, and so are its Actions logs, job summaries and
// artifacts. The lint holds the workflow to:
//   - running only by hand, and only after the confirm box repeats the task
//     name exactly: the confirm checks are EXECUTED under PowerShell, the way
//     GitHub runs a `shell: pwsh` step, including look-alike words that
//     PowerShell's own -cne lets through;
//   - sharing the production-deploy concurrency group with Deploy and Deploy
//     rollback;
//   - giving the Cloudflare secrets only to the ops script steps, through env,
//     and interpolating nothing into a shell script;
//   - uploading only ${{ runner.temp }}/ops-out/*.enc.json, kept 3 days;
// and holds the scripts it runs to printing only through ops-common's
// public-log formatter, writing only the encrypted report and the job
// summary, calling Cloudflare's REST API with GET (and one DELETE, of the
// temporary Worker), running only fixed wrangler commands, and passing the
// copy Worker's bearer secret only on wrangler's stdin and in a request
// header. settings-upsert is a dry run unless apply is exactly true, takes its
// settings only from the run's event payload (never an expression), and sends
// one write: the batch it built and re-verified, after the apply decision.
//
// The YAML is read with a strict subset reader: anything it cannot see into
// (flow collections, anchors, folded blocks, tabs, duplicate keys, multi-line
// plain scalars) fails the lint instead of hiding a step from it.

'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn, spawnSync } = require('child_process')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..', '..')
// Normalise CRLF: Windows checkouts (core.autocrlf=true) must read the same text as CI.
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n')
const load = (...p) => import(pathToFileURL(path.join(ROOT, ...p)).href)

let passed = 0
const notes = []
async function check(name, fn) {
  try {
    await fn()
    passed += 1
  } catch (err) {
    process.exitCode = 1
    console.error(`FAIL ${name}\n  ${err && err.message ? err.message.split('\n').join('\n  ') : err}`)
  }
}

// ------------------------------------------------------ strict YAML subset

function parseYaml(text) {
  const raw = String(text).replace(/\r\n/g, '\n').split('\n')
  let i = 0
  const fail = (msg) => { throw new Error(`yaml line ${i + 1}: ${msg}`) }
  const blank = (line) => /^\s*(#.*)?$/.test(line)
  const skip = () => { while (i < raw.length && blank(raw[i])) i += 1 }
  const indentOf = (line) => {
    if (/^ *\t/.test(line)) fail('a tab in the indentation')
    return /^ */.exec(line)[0].length
  }
  const isItem = (body) => body === '-' || body.startsWith('- ')
  const KEY = /^([A-Za-z0-9_-]+):(?:\s+(.*))?$/

  function scalar(text) {
    let s = text.trim()
    if (s.startsWith("'")) {
      const m = /^'((?:[^']|'')*)'$/.exec(s)
      if (!m) fail(`a malformed single-quoted scalar: ${s}`)
      return m[1].replace(/''/g, "'")
    }
    if (s.startsWith('"')) {
      const m = /^"((?:[^"\\]|\\["\\/bfnrt])*)"$/.exec(s)
      if (!m) fail(`a malformed double-quoted scalar: ${s}`)
      return JSON.parse(`"${m[1]}"`)
    }
    if (/^([[\]{}&*!|>%@`,?]|- |-$)/.test(s)) fail(`an unsupported YAML construct: ${s}`)
    const comment = s.search(/\s#/)
    if (comment >= 0) s = s.slice(0, comment).trimEnd()
    if (/:\s|:$/.test(s)) fail(`a plain scalar holding ": " (quote it): ${s}`)
    return s
  }

  function block(parentIndent, header) {
    const m = /^\|(-?)$/.exec(header.replace(/\s+#.*$/, ''))
    if (!m) fail(`an unsupported block scalar header "${header}" (only | and |-)`)
    const lines = []
    let indent = null
    while (i < raw.length) {
      const line = raw[i]
      if (/^\s*$/.test(line)) { lines.push(''); i += 1; continue }
      const ind = indentOf(line)
      if (ind <= parentIndent) break
      if (indent === null) indent = ind
      if (ind < indent) fail('a block scalar line indented less than its first line')
      lines.push(line.slice(indent))
      i += 1
    }
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    if (!lines.length) fail('an empty block scalar')
    return m[1] === '-' ? lines.join('\n') : `${lines.join('\n')}\n`
  }

  function value(rest, indent) {
    if (rest === '' || rest.startsWith('#')) {
      skip()
      if (i >= raw.length) return null
      const ind = indentOf(raw[i])
      if (ind > indent) return node(ind)
      if (ind === indent && isItem(raw[i].slice(ind))) return sequence(ind)
      return null
    }
    if (rest.startsWith('|') || rest.startsWith('>')) return block(indent, rest)
    return scalar(rest)
  }

  function node(indent) {
    skip()
    const ind = indentOf(raw[i])
    if (ind !== indent) fail('unexpected indentation')
    return isItem(raw[i].slice(ind)) ? sequence(indent) : mapping(indent)
  }

  function mapping(indent) {
    const out = {}
    for (;;) {
      skip()
      if (i >= raw.length) return out
      const ind = indentOf(raw[i])
      if (ind < indent) return out
      if (ind > indent) fail('unexpected indentation')
      const body = raw[i].slice(ind)
      if (isItem(body)) fail('a sequence item where a key was expected')
      const m = KEY.exec(body)
      if (!m) fail(`expected "key: value", got: ${body}`)
      if (Object.prototype.hasOwnProperty.call(out, m[1])) fail(`a duplicate key ${m[1]}`)
      i += 1
      out[m[1]] = value(m[2] === undefined ? '' : m[2].trim(), indent)
    }
  }

  function sequence(indent) {
    const out = []
    for (;;) {
      skip()
      if (i >= raw.length) return out
      const ind = indentOf(raw[i])
      if (ind < indent) return out
      if (ind > indent) fail('unexpected indentation in a sequence')
      const body = raw[i].slice(ind)
      if (!isItem(body)) return out
      const dash = /^-\s*/.exec(body)[0].length
      const rest = body.slice(dash)
      if (rest === '' || rest.startsWith('#')) {
        i += 1
        skip()
        if (i >= raw.length || indentOf(raw[i]) <= indent) fail('an empty sequence item')
        out.push(node(indentOf(raw[i])))
      } else if (/^[A-Za-z0-9_-]+:(\s|$)/.test(rest)) {
        raw[i] = `${' '.repeat(ind + dash)}${rest}` // the item's first key, at its own column
        out.push(mapping(ind + dash))
      } else {
        i += 1
        out.push(rest.startsWith('|') || rest.startsWith('>') ? block(ind, rest) : scalar(rest))
      }
    }
  }

  const doc = mapping(0)
  skip()
  if (i < raw.length) fail('content after the document')
  return doc
}

// ------------------------------------------------------ strict TOML subset

// Enough TOML for the copy Worker's config: `key = "string" | true | false`
// and [[array-of-tables]]. Anything else throws.
function parseSimpleToml(text) {
  const out = {}
  let table = out
  for (const [n, rawLine] of text.replace(/\r\n/g, '\n').split('\n').entries()) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    let m = /^\[\[([a-z0-9_]+)\]\]$/.exec(line)
    if (m) {
      if (out[m[1]] !== undefined && !Array.isArray(out[m[1]])) throw new Error(`toml line ${n + 1}: ${m[1]} is not an array of tables`)
      out[m[1]] = out[m[1]] || []
      table = {}
      out[m[1]].push(table)
      continue
    }
    if (/^\[/.test(line)) throw new Error(`toml line ${n + 1}: a [table] is not allowed here: ${line}`)
    m = /^([a-z0-9_]+)\s*=\s*(.+)$/.exec(line)
    if (!m) throw new Error(`toml line ${n + 1}: unsupported syntax: ${line}`)
    let v
    const s = /^"([^"\\]*)"$/.exec(m[2].trim())
    if (s) v = s[1]
    else if (m[2].trim() === 'true' || m[2].trim() === 'false') v = m[2].trim() === 'true'
    else throw new Error(`toml line ${n + 1}: only plain strings and booleans are allowed: ${line}`)
    if (Object.prototype.hasOwnProperty.call(table, m[1])) throw new Error(`toml line ${n + 1}: duplicate key ${m[1]}`)
    table[m[1]] = v
  }
  return out
}

// ------------------------------------------------------ source helpers

// Code with its full-line // comments and /* */ comment blocks blanked (line
// numbers kept), so prose about console output or secrets never trips a check.
function codeOf(text) {
  let inBlock = false
  return text.split('\n').map((line) => {
    const t = line.trim()
    if (inBlock) {
      if (t.includes('*/')) inBlock = false
      return ''
    }
    if (t.startsWith('/*')) {
      inBlock = !t.includes('*/')
      return ''
    }
    return t.startsWith('//') ? '' : line
  }).join('\n')
}

const count = (text, re) => [...text.matchAll(re)].length

// Every string in a parsed YAML tree, with its path.
function strings(node, at = [], out = []) {
  if (typeof node === 'string') out.push([at.join('.'), node])
  else if (Array.isArray(node)) node.forEach((v, n) => strings(v, [...at, n], out))
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) strings(v, [...at, k], out)
  return out
}

// ------------------------------------------------------ what ops.yml must be

const TASKS = ['d1-export', 'r2-apac-copy', 'secret-names', 'settings-upsert', 'd1-physical-export']
const OUT_DIR = '${{ runner.temp }}/ops-out'
const UPLOAD_PATH = '${{ runner.temp }}/ops-out/*.enc.json'
// The only job allowed to run from any ref other than main is none: d1-physical-export reads production wholesale, so it
// runs only from refs/heads/main (its job `if`, repeated by the script).
const MAIN_ONLY = new Set(['d1-physical-export'])
const jobCondition = (task) => (MAIN_ONLY.has(task) ? `inputs.task == '${task}' && github.ref == 'refs/heads/main'` : `inputs.task == '${task}'`)
const AFTER_CHECKOUT = "always() && steps.checkout.outcome == 'success'"
const SECRET_ENV = {
  CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
  CLOUDFLARE_ACCOUNT_ID: '${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
}
const JOB_KEYS = new Set(['name', 'needs', 'if', 'runs-on', 'environment', 'timeout-minutes', 'defaults', 'steps'])

const GATE_SCRIPT = [
  'if ([string]::IsNullOrEmpty($env:CONFIRM) -or -not [string]::Equals($env:CONFIRM, $env:TASK, [System.StringComparison]::Ordinal)) {',
  "  Write-Output '::error::Type the task name, exactly as chosen, in the confirm box.'",
  '  exit 1',
  '}',
  '',
].join('\n')

const confirmScript = (task) => [
  `if (-not [string]::Equals($env:CONFIRM, '${task}', [System.StringComparison]::Ordinal)) {`,
  `  Write-Output '::error::Type ${task} in the confirm box to run this job.'`,
  '  exit 1',
  '}',
  '',
].join('\n')

const scriptStep = (run, env = {}, extra = {}) => ({ kind: 'script', run, env: { ...SECRET_ENV, OPS_OUT_DIR: OUT_DIR, ...env }, ...extra })
const PRELUDE = [{ kind: 'confirm' }, { kind: 'checkout' }, { kind: 'setup-node' }, { kind: 'npm-ci' }]

// Each task job, step by step. The delete step and the uploads carry
// AFTER_CHECKOUT; everything else has no `if`, so it runs only while every
// step before it (the confirm check first) has passed.
const TASK_STEPS = {
  'd1-export': [
    ...PRELUDE,
    scriptStep('node ops/scripts/ops-d1-export.mjs', { OPS_QUERY: '${{ inputs.query }}' }),
    { kind: 'upload' },
  ],
  'r2-apac-copy': [
    ...PRELUDE,
    // The mode decides whether a missing destination is created (copy only).
    scriptStep('node ops/scripts/ops-r2.mjs buckets', { OPS_R2_MODE: '${{ inputs.mode }}' }),
    scriptStep('node ops/scripts/ops-r2.mjs run', { OPS_R2_MODE: '${{ inputs.mode }}' }, { stepTimeout: true }),
    scriptStep('node ops/scripts/ops-r2.mjs delete-worker', {}, { if: AFTER_CHECKOUT }),
    { kind: 'upload' },
  ],
  // REST only (no wrangler), so no package install.
  'secret-names': [
    { kind: 'confirm' }, { kind: 'checkout' }, { kind: 'setup-node' },
    scriptStep('node ops/scripts/ops-secret-names.mjs'),
    { kind: 'upload' },
  ],
  // The settings input is read from the event payload file, so the job's only
  // task-specific expression is the apply flag.
  'settings-upsert': [
    ...PRELUDE,
    scriptStep('node ops/scripts/ops-settings-upsert.mjs', { OPS_APPLY: '${{ inputs.apply }}' }),
    { kind: 'upload' },
  ],
  // Personal data in the artifact: the only job whose upload is kept one day, not three. The export step stops
  // 30 minutes before the job (stepTimeout) so the upload still runs after a timeout.
  'd1-physical-export': [
    ...PRELUDE,
    scriptStep('node ops/scripts/ops-d1-physical-export.mjs', {}, { stepTimeout: true }),
    { kind: 'upload', retention: '1' },
  ],
}

// The scripts the workflow runs, and everything they import.
const ENTRY_SCRIPTS = ['ops/scripts/ops-d1-export.mjs', 'ops/scripts/ops-r2.mjs', 'ops/scripts/ops-secret-names.mjs', 'ops/scripts/ops-settings-upsert.mjs', 'ops/scripts/ops-d1-physical-export.mjs']
const RUNNER_SCRIPTS = [
  'ops/scripts/ops-common.mjs',
  'ops/scripts/ops-crypto.mjs',
  'ops/scripts/ops-sql-guard.mjs',
  'ops/scripts/ops-d1-export.mjs',
  'ops/scripts/ops-d1-physical-export.mjs',
  'ops/scripts/ops-d1-physical-lib.mjs',
  'ops/scripts/ops-r2.mjs',
  'ops/scripts/ops-r2-lib.mjs',
  'ops/scripts/ops-secret-names.mjs',
  'ops/scripts/ops-settings-upsert.mjs',
]
const WORKER_SCRIPTS = ['ops/r2-copy-worker/src/index.mjs', 'ops/r2-copy-worker/src/core.mjs']
const BUILTINS = new Set(['node:crypto', 'node:fs', 'node:path', 'node:os', 'node:child_process', 'node:url'])

function checkStep(task, job, step, spec, where) {
  const keys = Object.keys(step).sort()
  if (spec.kind === 'confirm') {
    assert.deepStrictEqual(keys, ['env', 'name', 'run'], `${where}: keys`)
    assert.deepStrictEqual(step.env, { CONFIRM: '${{ inputs.confirm }}' }, `${where}: env`)
    assert.strictEqual(step.run, confirmScript(task), `${where}: must be exactly the ordinal compare against '${task}'`)
  } else if (spec.kind === 'checkout') {
    assert.deepStrictEqual(keys, ['id', 'name', 'uses', 'with'], `${where}: keys`)
    assert.strictEqual(step.id, 'checkout', `${where}: id`)
    assert.strictEqual(step.uses, 'actions/checkout@v4', `${where}: uses`)
    assert.deepStrictEqual(step.with, { 'persist-credentials': 'false' }, `${where}: with (no ref, no stored credentials)`)
  } else if (spec.kind === 'setup-node') {
    assert.deepStrictEqual(keys, ['name', 'uses', 'with'], `${where}: keys`)
    assert.strictEqual(step.uses, 'actions/setup-node@v4', `${where}: uses`)
    const extra = Object.keys(step.with || {}).filter((k) => !['node-version', 'cache', 'cache-dependency-path'].includes(k))
    assert.deepStrictEqual(extra, [], `${where}: with`)
  } else if (spec.kind === 'npm-ci') {
    assert.deepStrictEqual(keys, ['name', 'run', 'working-directory'], `${where}: keys`)
    assert.strictEqual(step.run, 'npm ci --no-audit --no-fund', `${where}: run`)
    assert.strictEqual(step['working-directory'], 'cloudflare', `${where}: working-directory`)
  } else if (spec.kind === 'script') {
    const want = ['env', 'name', 'run', ...(spec.if ? ['if'] : []), ...(spec.stepTimeout ? ['timeout-minutes'] : [])].sort()
    assert.deepStrictEqual(keys, want, `${where}: keys`)
    assert.strictEqual(step.run, spec.run, `${where}: run`)
    assert.deepStrictEqual(step.env, spec.env, `${where}: env must be exactly what the script needs`)
    if (spec.if) assert.strictEqual(step.if, spec.if, `${where}: if`)
    if (spec.stepTimeout) {
      const slack = Number(job['timeout-minutes']) - Number(step['timeout-minutes'])
      assert.ok(slack >= 20, `${where}: the step must time out at least 20 minutes before the job, so the delete step still runs (slack ${slack})`)
    }
  } else if (spec.kind === 'upload') {
    assert.deepStrictEqual(keys, ['if', 'name', 'uses', 'with'], `${where}: keys`)
    assert.strictEqual(step.uses, 'actions/upload-artifact@v4', `${where}: uses`)
    assert.strictEqual(step.if, AFTER_CHECKOUT, `${where}: if`)
    assert.deepStrictEqual(step.with, {
      name: `ops-${task}`,
      path: UPLOAD_PATH,
      'retention-days': spec.retention || '3',
      'if-no-files-found': 'ignore',
    }, `${where}: only the encrypted files, kept ${spec.retention || '3'} day(s)`)
  } else {
    throw new Error(`unknown step kind ${spec.kind}`)
  }
}

// ------------------------------------------------------ PowerShell

const SOFT_HYPHEN = '\u00ad'
const ZERO_WIDTH_JOINER = '\u200d'

function findPowerShell() {
  for (const shell of ['pwsh', 'powershell']) {
    const r = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', 'exit 7'], { stdio: 'ignore', windowsHide: true, timeout: 120000 })
    if (!r.error && r.status === 7) return shell
  }
  return null
}

// Runs a step's script the way GitHub's runner runs a `shell: pwsh` step:
// written to a .ps1 between $ErrorActionPreference = 'stop' and the
// LASTEXITCODE hand-off, then dot-sourced.
function runStepScript(shell, script, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-lint-'))
  const file = path.join(dir, 'step.ps1')
  fs.writeFileSync(file, `\ufeff$ErrorActionPreference = 'stop'\n${script}\nif ((Test-Path -LiteralPath variable:\\LASTEXITCODE)) { exit $LASTEXITCODE }\n`)
  const args = ['-NoProfile', '-NonInteractive']
  if (process.platform === 'win32') args.push('-ExecutionPolicy', 'Bypass')
  args.push('-Command', `. '${file.replace(/'/g, "''")}'`)
  const childEnv = {}
  for (const [k, v] of Object.entries(process.env)) if (!/^(CONFIRM|TASK)$/i.test(k)) childEnv[k] = v
  for (const [k, v] of Object.entries(env)) if (v !== undefined) childEnv[k] = v
  return new Promise((resolve) => {
    const done = (result) => {
      clearTimeout(timer)
      fs.rmSync(dir, { recursive: true, force: true })
      resolve(result)
    }
    const child = spawn(shell, args, { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const timer = setTimeout(() => child.kill(), 120000)
    let out = ''
    child.stdout.on('data', (c) => { out += c })
    child.stderr.on('data', (c) => { out += c })
    child.on('error', (err) => done({ status: null, out: String(err.code || err.message) }))
    child.on('close', (status) => done({ status, out }))
  })
}

async function pool(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const n = next
      next += 1
      results[n] = await fn(items[n])
    }
  }))
  return results
}

// ------------------------------------------------------------------ tests

async function main() {
  const common = await load('ops', 'scripts', 'ops-common.mjs')
  const d1 = await load('ops', 'scripts', 'ops-d1-export.mjs')
  const driver = await load('ops', 'scripts', 'ops-r2.mjs')
  const lib = await load('ops', 'scripts', 'ops-r2-lib.mjs')
  const secretNames = await load('ops', 'scripts', 'ops-secret-names.mjs')

  const WF_TEXT = read('.github', 'workflows', 'ops.yml')
  let WF = null
  const src = Object.fromEntries([...RUNNER_SCRIPTS, ...WORKER_SCRIPTS].map((f) => [f, read(f)]))
  const code = Object.fromEntries(Object.entries(src).map(([f, t]) => [f, codeOf(t)]))

  await check('the strict YAML reader reads what ops.yml uses and refuses what it cannot see into', () => {
    assert.deepStrictEqual(parseYaml([
      'a: 1', 'b:', '  c: "x"', "  d: 'it''s'", '  e:', '    - p', '    - q: 1', '      r: 2', 'f:', '- g', 's: |', '  one', '', '  two', '# end',
    ].join('\n')), { a: '1', b: { c: 'x', d: "it's", e: ['p', { q: '1', r: '2' }] }, f: ['g'], s: 'one\n\ntwo\n' })
    for (const bad of [
      'a: [1, 2]', 'a: {b: 1}', 'a: &x 1', 'a: *x', 'a: !!str 1', 'a: >\n  folded', 'a:\n\tb: 1', 'a: 1\na: 2',
      'a:b', 'a: one\n  two', 'a: x: y', '---\na: 1', 'a:\n  b: 1\n- c', 's: |+\n  keep',
    ]) assert.throws(() => parseYaml(bad), /yaml line/, `must refuse: ${JSON.stringify(bad)}`)
    WF = parseYaml(WF_TEXT)
  })

  await check('ops.yml: manual trigger only, a read-only token, no env or permissions above the steps', () => {
    assert.deepStrictEqual(Object.keys(WF).sort(), ['concurrency', 'jobs', 'name', 'on', 'permissions'])
    assert.deepStrictEqual(Object.keys(WF.on), ['workflow_dispatch'])
    assert.deepStrictEqual(Object.keys(WF.on.workflow_dispatch), ['inputs'])
    assert.deepStrictEqual(WF.permissions, { contents: 'read' })
    for (const [id, job] of Object.entries(WF.jobs)) {
      const extra = Object.keys(job).filter((k) => !JOB_KEYS.has(k))
      assert.deepStrictEqual(extra, [], `job ${id} must not set ${extra.join(', ')}`)
    }
    assert.ok(!/continue-on-error/.test(WF_TEXT), 'no step or job may continue on error')
  })

  await check('ops.yml: shares the production-deploy concurrency group with Deploy and Deploy rollback', () => {
    assert.deepStrictEqual(WF.concurrency, { group: 'production-deploy', 'cancel-in-progress': 'false' })
    for (const file of ['deploy.yml', 'deploy-rollback.yml']) {
      const m = /^concurrency:\n {2}group: (\S+)\n/m.exec(read('.github', 'workflows', file))
      assert.ok(m, `${file} has no workflow-level concurrency group`)
      assert.strictEqual(m[1], WF.concurrency.group, `${file} must share the group`)
    }
  })

  await check('ops.yml: the task choices are the task jobs; confirm is required and has no default', () => {
    const inputs = WF.on.workflow_dispatch.inputs
    assert.deepStrictEqual(Object.keys(inputs).sort(), ['apply', 'confirm', 'mode', 'query', 'settings', 'task'])
    assert.deepStrictEqual(Object.keys(WF.jobs), ['gate', ...TASKS])
    assert.strictEqual(inputs.task.type, 'choice')
    assert.strictEqual(inputs.task.required, 'true')
    assert.deepStrictEqual(inputs.task.options, TASKS)
    assert.strictEqual(inputs.mode.type, 'choice')
    assert.deepStrictEqual(inputs.mode.options, driver.MODES)
    assert.strictEqual(inputs.mode.default, 'copy')
    assert.strictEqual(inputs.query.type, 'string')
    assert.strictEqual(inputs.settings.type, 'string')
    assert.strictEqual(inputs.settings.required, 'false')
    assert.strictEqual(inputs.settings.default, '')
    assert.strictEqual(inputs.apply.type, 'boolean')
    assert.strictEqual(inputs.apply.default, 'false', 'a settings-upsert run is a dry run unless apply is ticked')
    assert.strictEqual(inputs.confirm.type, 'string')
    assert.strictEqual(inputs.confirm.required, 'true')
    assert.ok(!('default' in inputs.confirm), 'a default confirm word would confirm by itself')
  })

  await check('ops.yml: a wrong confirm word stops the run before approval, and every job re-checks its own name first', () => {
    const gate = WF.jobs.gate
    for (const k of ['environment', 'needs', 'if']) assert.ok(!(k in gate), `the gate job must not have ${k}`)
    assert.deepStrictEqual(gate.defaults, { run: { shell: 'pwsh' } })
    assert.strictEqual(gate.steps.length, 1)
    assert.deepStrictEqual(Object.keys(gate.steps[0]).sort(), ['env', 'name', 'run'])
    assert.deepStrictEqual(gate.steps[0].env, { TASK: '${{ inputs.task }}', CONFIRM: '${{ inputs.confirm }}' })
    assert.strictEqual(gate.steps[0].run, GATE_SCRIPT, 'the gate must be exactly the ordinal compare of confirm with task')
    for (const task of TASKS) {
      const job = WF.jobs[task]
      assert.strictEqual(job.needs, 'gate', `${task}: needs gate`)
      // No status function in the `if`, so GitHub adds success(): a failed gate skips the job.
      assert.strictEqual(job.if, jobCondition(task), `${task}: if`)
      assert.strictEqual(job.environment, 'production', `${task}: environment`)
      assert.deepStrictEqual(job.defaults, { run: { shell: 'pwsh' } }, `${task}: shell`)
      assert.ok(Array.isArray(job.steps) && job.steps.length, `${task}: steps`)
      checkStep(task, job, job.steps[0], { kind: 'confirm' }, `${task} step 1`)
      const checkout = job.steps[1]
      assert.ok(checkout && checkout.id === 'checkout' && !('if' in checkout), `${task}: the checkout must directly follow the confirm check, unconditionally`)
      for (const step of job.steps.slice(1)) {
        if ('if' in step) assert.strictEqual(step.if, AFTER_CHECKOUT, `${task} step "${step.name}": an if may only be ${AFTER_CHECKOUT}`)
      }
    }
  })

  await check('ops.yml: the confirm checks refuse every inexact word when run under PowerShell', async () => {
    const shell = findPowerShell()
    if (!shell) {
      assert.notStrictEqual(process.platform, 'win32', 'PowerShell is required on Windows to run the confirm checks')
      notes.push('the confirm checks were verified statically only: no PowerShell on this machine')
      return
    }
    const cases = []
    for (const task of TASKS) {
      const other = TASKS.find((t) => t !== task)
      const script = WF.jobs[task].steps[0].run
      for (const [confirm, want] of [
        [task, 0], [task.toUpperCase(), 1], [` ${task}`, 1], [`${task} `, 1], [`${task}${SOFT_HYPHEN}`, 1],
        [`${task}${ZERO_WIDTH_JOINER}`, 1], [other, 1], ['', 1], [undefined, 1],
      ]) cases.push({ label: `${task} job, confirm ${JSON.stringify(confirm)}`, script, env: { CONFIRM: confirm }, want })
    }
    const gate = WF.jobs.gate.steps[0].run
    for (const task of TASKS) {
      const other = TASKS.find((t) => t !== task)
      for (const [confirm, want] of [[task, 0], [task.toUpperCase(), 1], [other, 1], [`${task}${SOFT_HYPHEN}`, 1], [` ${task}`, 1]]) {
        cases.push({ label: `gate, task ${task}, confirm ${JSON.stringify(confirm)}`, script: gate, env: { TASK: task, CONFIRM: confirm }, want })
      }
    }
    cases.push({ label: 'gate, both empty', script: gate, env: { TASK: '', CONFIRM: '' }, want: 1 })
    cases.push({ label: 'gate, both unset', script: gate, env: {}, want: 1 })
    // The counterexample: the culture-aware -cne these checks replaced.
    const control = { label: 'control', script: `if ($env:CONFIRM -cne '${TASKS[0]}') {\n  exit 1\n}\n`, env: { CONFIRM: `${TASKS[0]}${SOFT_HYPHEN}` } }
    const results = await pool([...cases, control], 6, (c) => runStepScript(shell, c.script, c.env))
    const wrong = []
    cases.forEach((c, n) => {
      const r = results[n]
      const printed = r.out.trim()
      if (r.status !== c.want) wrong.push(`${c.label}: exit ${r.status}, want ${c.want} (${printed.slice(0, 200)})`)
      else if (c.want === 1 && !printed.includes('::error::')) wrong.push(`${c.label}: refused without the error message (${printed.slice(0, 200)})`)
      else if (c.want === 0 && printed !== '') wrong.push(`${c.label}: printed ${printed.slice(0, 200)}`)
    })
    assert.deepStrictEqual(wrong, [], wrong.join('\n'))
    const admitted = results[cases.length].status === 0
    notes.push(`${cases.length} confirm cases run under ${shell}; the replaced -cne ${admitted ? 'DOES' : 'does not'} admit a soft-hyphen look-alike here`)
  })

  await check('all three workflows: every confirm check is ordinal and refuses soft-hyphen, zero-width and Cyrillic look-alikes under PowerShell', async () => {
    // The one confirm step of Deploy and Deploy rollback, read as GitHub would hand it to pwsh.
    const deployStep = (file) => {
      const text = read('.github', 'workflows', file)
      assert.strictEqual(count(text, /- name: Check the confirm word\n/g), 1, `${file}: one confirm step`)
      const m = /\n( +)- name: Check the confirm word\n\1 {2}env:\n\1 {4}CONFIRM: \$\{\{ inputs\.confirm \}\}\n\1 {2}run: \|\n((?:\1 {4}.*\n)+)/.exec(text)
      assert.ok(m, `${file}: the confirm step is not env CONFIRM + a run block`)
      const script = m[2].split('\n').map((l) => l.slice(m[1].length + 4)).join('\n')
      assert.ok(!/\s-[ci]?(ne|eq|like|notlike|match|notmatch)\b/i.test(script), `${file}: a culture-aware comparison operator in the confirm check`)
      assert.ok(/\[string\]::Equals\(\$env:CONFIRM, '[A-Z]+', \[System\.StringComparison\]::Ordinal\)/.test(script), `${file}: not the ordinal compare`)
      return script
    }
    for (const [, script] of strings(WF).filter(([w]) => /\.run$/.test(w))) {
      if (/CONFIRM/.test(script)) assert.ok(!/\s-[ci]?(ne|eq|like|notlike|match|notmatch)\b/i.test(script), 'ops.yml: a culture-aware comparison in a confirm check')
    }
    const shell = findPowerShell()
    if (!shell) {
      assert.notStrictEqual(process.platform, 'win32', 'PowerShell is required on Windows to run the confirm checks')
      deployStep('deploy.yml')
      deployStep('deploy-rollback.yml')
      notes.push('the Deploy / Deploy rollback confirm checks were verified statically only: no PowerShell on this machine')
      return
    }
    // Look-alikes: invisible characters appended or inside the word, and one
    // Latin letter swapped for its Cyrillic twin.
    const CYRILLIC = { A: 'А', E: 'Е', O: 'О', C: 'С', a: 'а', e: 'е', o: 'о', c: 'с', p: 'р' }
    const cyrillicTwin = (word) => {
      const i = [...word].findIndex((ch) => CYRILLIC[ch])
      assert.ok(i >= 0, `no Cyrillic twin for ${word}`)
      return word.slice(0, i) + CYRILLIC[word[i]] + word.slice(i + 1)
    }
    const lookAlikes = (word) => [
      `${word}${SOFT_HYPHEN}`,
      `${word.slice(0, 2)}${SOFT_HYPHEN}${word.slice(2)}`,
      `${word}${ZERO_WIDTH_JOINER}`,
      `${word.slice(0, 3)}​${word.slice(3)}`,
      `﻿${word}`,
      cyrillicTwin(word),
      word.toLowerCase() === word ? word.toUpperCase() : word.toLowerCase(),
      ` ${word}`, `${word} `, '', undefined,
    ]
    const cases = []
    for (const [file, word] of [['deploy.yml', 'DEPLOY'], ['deploy-rollback.yml', 'ROLLBACK']]) {
      const script = deployStep(file)
      cases.push({ label: `${file}, confirm ${word}`, script, env: { CONFIRM: word }, want: 0 })
      for (const bad of lookAlikes(word)) cases.push({ label: `${file}, confirm ${JSON.stringify(bad)}`, script, env: { CONFIRM: bad }, want: 1 })
    }
    for (const task of TASKS) {
      const script = WF.jobs[task].steps[0].run
      for (const bad of lookAlikes(task)) cases.push({ label: `ops.yml ${task} job, confirm ${JSON.stringify(bad)}`, script, env: { CONFIRM: bad }, want: 1 })
      for (const bad of lookAlikes(task)) cases.push({ label: `ops.yml gate, task ${task}, confirm ${JSON.stringify(bad)}`, script: WF.jobs.gate.steps[0].run, env: { TASK: task, CONFIRM: bad }, want: 1 })
    }
    // Counterexamples: what the replaced -cne let through, per word (a note, not a gate:
    // it depends on the ICU build of the machine that runs the test).
    const controls = ['DEPLOY', 'ROLLBACK'].map((word) => ({ script: `if ($env:CONFIRM -cne '${word}') {\n  exit 1\n}\n`, env: { CONFIRM: `${word.slice(0, 2)}${SOFT_HYPHEN}${word.slice(2)}` } }))
    const results = await pool([...cases, ...controls], 6, (c) => runStepScript(shell, c.script, c.env))
    const wrong = []
    cases.forEach((c, n) => {
      const r = results[n]
      const printed = r.out.trim()
      if (r.status !== c.want) wrong.push(`${c.label}: exit ${r.status}, want ${c.want} (${printed.slice(0, 200)})`)
      else if (c.want === 1 && !printed.includes('::error::')) wrong.push(`${c.label}: refused without the error message (${printed.slice(0, 200)})`)
      else if (c.want === 0 && printed !== '') wrong.push(`${c.label}: printed ${printed.slice(0, 200)}`)
    })
    assert.deepStrictEqual(wrong, [], wrong.join('\n'))
    const admitted = results.slice(cases.length).filter((r) => r.status === 0).length
    notes.push(`${cases.length} look-alike confirm cases across ops.yml, deploy.yml and deploy-rollback.yml run under ${shell}; the replaced -cne admits ${admitted} of 2 soft-hyphen DEPLOY/ROLLBACK words here`)
  })

  await check('ops.yml: every step is a known one, in an order that deletes the Worker after any failure', () => {
    const allowedUses = new Set(['actions/checkout@v4', 'actions/setup-node@v4', 'actions/upload-artifact@v4'])
    for (const task of TASKS) {
      const job = WF.jobs[task]
      const specs = TASK_STEPS[task]
      assert.strictEqual(job.steps.length, specs.length, `${task}: ${job.steps.length} steps, want ${specs.length}`)
      job.steps.forEach((step, n) => {
        if (step.uses) assert.ok(allowedUses.has(step.uses), `${task}: ${step.uses} is not an allowed action`)
        checkStep(task, job, step, specs[n], `${task} step ${n + 1} ("${step.name}")`)
      })
    }
    for (const [where, value] of strings(WF)) {
      if (/\.uses$/.test(where)) assert.ok(/@v\d+$/.test(value), `${where}: pin actions to a major version`)
    }
  })

  await check('ops.yml: only the ops script steps get the Cloudflare secrets, through env, under their own names', () => {
    for (const [n, line] of WF_TEXT.split('\n').entries()) {
      if (/^\s*#/.test(line)) continue
      if (/secrets/.test(line)) {
        assert.ok(/^\s+(CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID): \$\{\{ secrets\.\1 \}\}$/.test(line), `line ${n + 1}: secrets only as env, named after themselves: ${line.trim()}`)
      }
      assert.ok(!/github\.token|GITHUB_TOKEN|ACTIONS_(STEP|RUNNER)_DEBUG|Set-PSDebug|set -x|DebugPreference|VerbosePreference|add-mask|GITHUB_ENV|GITHUB_OUTPUT|GITHUB_PATH|toJSON/i.test(line), `line ${n + 1}: ${line.trim()}`)
    }
    const found = strings(WF).filter(([, v]) => v.includes('secrets')).map(([where]) => where).sort()
    const expected = []
    for (const task of TASKS) {
      WF.jobs[task].steps.forEach((step, n) => {
        if (TASK_STEPS[task][n].kind === 'script') for (const name of Object.keys(SECRET_ENV)) expected.push(`jobs.${task}.steps.${n}.env.${name}`)
      })
    }
    assert.deepStrictEqual(found, expected.sort())
  })

  await check('ops.yml: nothing is interpolated into a shell script, and every expression is on the allowlist', () => {
    const allowed = new Set([
      '${{ inputs.task }}', '${{ inputs.confirm }}', '${{ inputs.query }}', '${{ inputs.mode }}', '${{ inputs.apply }}',
      SECRET_ENV.CLOUDFLARE_API_TOKEN, SECRET_ENV.CLOUDFLARE_ACCOUNT_ID, OUT_DIR, UPLOAD_PATH,
    ])
    for (const [where, value] of strings(WF)) {
      if (!value.includes('${{')) continue
      assert.ok(!/\.run$/.test(where), `${where}: no expression inside a run script`)
      assert.ok(/\.env\.[A-Z0-9_]+$/.test(where) || /\.with\.path$/.test(where), `${where}: an expression outside env/with.path`)
      assert.ok(allowed.has(value), `${where}: ${value} is not on the allowlist`)
    }
    const where = (value) => strings(WF).filter(([, v]) => v === value).map(([w]) => w.replace(/\.steps\.\d+\./, '.steps.N.'))
    assert.deepStrictEqual(where('${{ inputs.task }}'), ['jobs.gate.steps.N.env.TASK'])
    assert.deepStrictEqual(where('${{ inputs.confirm }}'), ['jobs.gate.steps.N.env.CONFIRM', ...TASKS.map((t) => `jobs.${t}.steps.N.env.CONFIRM`)])
    assert.deepStrictEqual(where('${{ inputs.query }}'), ['jobs.d1-export.steps.N.env.OPS_QUERY'])
    assert.deepStrictEqual(where('${{ inputs.mode }}'), ['jobs.r2-apac-copy.steps.N.env.OPS_R2_MODE', 'jobs.r2-apac-copy.steps.N.env.OPS_R2_MODE'])
    assert.deepStrictEqual(where('${{ inputs.apply }}'), ['jobs.settings-upsert.steps.N.env.OPS_APPLY'])
    // The topic ids never pass through an expression or a step env (whose
    // values the public log prints): the script reads the event payload file.
    assert.deepStrictEqual(strings(WF).filter(([, v]) => /inputs\.settings|github\.event|OPS_SETTINGS/.test(v)).map(([w]) => w), [])
    const r2 = code['ops/scripts/ops-r2.mjs']
    assert.ok(r2.includes("  if (mode === 'copy' && !out.problems.length && !dest.present && dest.missing) {\n    const r = await create()") && count(r2, /\bcreate\(\)/g) === 1, 'only copy mode may create the destination bucket')
    assert.strictEqual(count(r2, /const mode = String\(process\.env\.OPS_R2_MODE \|\| 'copy'\)\.trim\(\)/g), 2, 'buckets and run both take the mode from the workflow input')
    assert.ok(r2.includes('const b = await checkBuckets({ api, accountId, mode, create })'), 'the bucket step passes on the mode it was given')
  })

  await check('prune is mirror-only and says so: one /prune call, gated on copy mode before the switch; the old bucket is never deleted', () => {
    const r2 = code['ops/scripts/ops-r2.mjs']
    assert.strictEqual(count(r2, /'\/prune'/g), 1, 'exactly one /prune call site')
    const fn = r2.indexOf('async function pruneDestination(client, mode, productionState, keys) {\n  if (!pruneAllowed(mode, productionState)) return []\n')
    assert.ok(fn > 0 && r2.indexOf("'/prune'") > fn && r2.indexOf("'/prune'") < r2.indexOf('\n}\n', fn), 'the /prune call lives in pruneDestination, behind pruneAllowed')
    assert.ok(r2.includes("export function pruneAllowed(mode, productionState) {\n  return mode === 'copy' && productionState === 'source'\n}"), 'pruneAllowed: copy mode, production on the source')
    assert.strictEqual(count(r2, /pruneDestination\(/g), 2, 'one definition, one caller')
    // No bucket is ever deleted: the only REST DELETE is the copy Worker's and the only wrangler commands are fixed (checked below).
    const mode = WF.on.workflow_dispatch.inputs.mode.description
    for (const phrase of ['prune deletes only DESTINATION keys the old bucket lacks', 'topup (copies missing or older objects; never overwrites newer, never prunes or deletes)', 'No mode writes or deletes the old bucket.']) {
      assert.ok(mode.includes(phrase), `the mode help must say: ${phrase}`)
    }
    assert.ok(/deleting it\n#\s+later is a manual owner step outside this workflow\./.test(WF_TEXT), 'ops.yml must say deleting the old bucket is a manual owner step')
  })

  await check('ops scripts: write only the encrypted report and the job summary', () => {
    const WRITES = /\b(writeFileSync|appendFileSync|writeFile|appendFile|createWriteStream|copyFileSync|copyFile|cpSync|renameSync|symlinkSync|linkSync|openSync|writeSync|truncateSync|ftruncateSync)\s*\(/g
    for (const [file, text] of Object.entries(code)) {
      const calls = [...text.matchAll(WRITES)].map((m) => m[1]).sort()
      const want = file === 'ops/scripts/ops-common.mjs' ? ['appendFileSync', 'writeFileSync'] : []
      assert.deepStrictEqual(calls, want, `${file} writes files: ${calls.join(', ')}`)
      assert.ok(!/fs\/promises|fs\.promises/.test(text), `${file}: no fs/promises`)
    }
    const c = code['ops/scripts/ops-common.mjs']
    assert.ok(c.includes("fs.appendFileSync(file, `- ${line}\\n`)") && /const line = formatPublic\(template, values\)/.test(c), 'the summary gets only formatted lines')
    assert.ok(c.includes('const envelope = encryptEnvelope(') && c.includes("const file = path.join(outDir, `${baseName}.enc.json`)") && c.includes('fs.writeFileSync(file, `${JSON.stringify(envelope)}\\n`)'), 'the one written file is the envelope, named *.enc.json')
    // And for real: a canary never reaches the disk in the clear.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-lint-out-'))
    try {
      const canary = 'uploads/products/canary-object-key.jpg'
      const r = common.writeEncryptedReport(tmp, 'lint-check', { canary, rows: [{ name: canary }] }, { kind: 'lint', commit: 'unknown', runId: 'local', createdAt: '2026-09-26T00:00:00.000Z' })
      assert.deepStrictEqual(fs.readdirSync(tmp), ['lint-check.enc.json'])
      assert.strictEqual(r.file, path.join(tmp, 'lint-check.enc.json'))
      const text = fs.readFileSync(r.file, 'utf8')
      assert.ok(!text.includes('canary'), 'the report is not encrypted')
      JSON.parse(text)
      assert.throws(() => common.writeEncryptedReport(tmp, '../escape', {}, {}), (e) => e.code === 'bad-report-name')
      assert.deepStrictEqual(fs.readdirSync(tmp), ['lint-check.enc.json'])
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  await check('ops scripts: print only through the public-log formatter and never hand a child the log', () => {
    for (const [file, text] of Object.entries(code)) {
      assert.strictEqual(count(text, /\bconsole\./g), 0, `${file}: console`)
      assert.strictEqual(count(text, /process\.stderr/g), 0, `${file}: stderr`)
      assert.strictEqual(count(text, /process\.stdout\.write\(/g), file === 'ops/scripts/ops-common.mjs' ? 2 : 0, `${file}: stdout`)
      assert.strictEqual(count(text, /inherit/g), 0, `${file}: an inherited stdio`)
      // (a RegExp's .exec() is not child_process.exec)
      assert.strictEqual(count(text, /(?<![.\w])(execSync|spawnSync|execFileSync|execFile|fork|exec|import|require)\s*\(/g), 0, `${file}: another way to run or load code`)
      assert.strictEqual(count(text, /\bspawn\s*\(/g), file === 'ops/scripts/ops-common.mjs' ? 1 : 0, `${file}: spawn`)
      for (const m of text.matchAll(/\b(say|summary|formatPublic)\(/g)) {
        const rest = text.slice(m.index + m[0].length)
        const literal = /^'([^'\\\n]*)'\s*[,)]/.exec(rest)
        const ok = (literal && !literal[1].includes('${')) || /^template\s*[,)]/.test(rest)
        assert.ok(ok, `${file}: ${m[1]}(${rest.slice(0, 40)} -- the template must be a literal`)
      }
      for (const m of text.matchAll(/\blines\.push\(\s*(.)/g)) assert.strictEqual(m[1], '[', `${file}: lines.push must push a [template, values] pair`)
      for (const m of text.matchAll(/\blines\.push\(\[\s*(.)/g)) assert.strictEqual(m[1], "'", `${file}: a pushed template must be a literal`)
      for (const m of text.matchAll(/\bconst lines = \[\s*(.)(.)?/g)) {
        assert.ok(m[1] === ']' || (m[1] === '[' && m[2] === "'"), `${file}: lines must start empty or with a literal template`)
      }
      for (const m of text.matchAll(/new OpsError\(\s*([^,)]*)/g)) {
        assert.ok(/^'[a-z][a-z0-9-]*'$/.test(m[1]) || m[1] === 'problem' || (file === 'ops/scripts/ops-sql-guard.mjs' && m[1] === 'code'), `${file}: new OpsError(${m[1]})`)
      }
      for (const m of text.matchAll(/\bproblems\.push\(\s*([^)]*)\)/g)) {
        assert.ok(/^'[a-z][a-z0-9-]*'$/.test(m[1]) || m[1] === "err instanceof OpsError ? err.code : 'internal-error'" || m[1] === '...v.problems', `${file}: problems.push(${m[1]})`)
      }
    }
    assert.ok(code['ops/scripts/ops-common.mjs'].includes("stdio: ['pipe', 'pipe', 'pipe']"), 'wrangler output is captured, never inherited')
    assert.deepStrictEqual(code['ops/scripts/ops-common.mjs'].split('\n').filter((l) => /child_process/.test(l)), ["import { spawn } from 'node:child_process'"])
    for (const m of code['ops/scripts/ops-sql-guard.mjs'].matchAll(/\breject\(\s*([^,)]*)/g)) {
      assert.ok(/^'[a-z][a-z0-9-]*'$/.test(m[1]) || m[1] === 'code', `ops-sql-guard: reject(${m[1]})`)
    }
    const tokens = []
    for (const [file, text] of Object.entries(code)) for (const m of text.matchAll(/publicToken\(((?:[^()]|\([^()]*\))*)\)/g)) tokens.push(`${file}: ${m[1]}`)
    assert.deepStrictEqual(tokens.sort(), [
      'ops/scripts/ops-common.mjs: value',
      'ops/scripts/ops-d1-export.mjs: codesText(errorCodes)',
      'ops/scripts/ops-d1-export.mjs: name',
      'ops/scripts/ops-d1-physical-export.mjs: codesText(errorCodes)',
    ], 'publicToken() only for the query FILE name and Cloudflare error-code numbers')
    // secret-names prints counts only: no secret's name, not even an expected one.
    const sn = code['ops/scripts/ops-secret-names.mjs']
    assert.ok(!/publicToken/.test(sn), 'secret-names must not vet any name for the public log')
    assert.ok(/\nexport const EXPECTED_SECRETS = Object\.freeze\(\[\n(  '[A-Z][A-Z0-9_]*',\n)+\]\)\n/.test(sn), 'EXPECTED_SECRETS is a frozen list of literals')
    assert.ok(Object.isFrozen(secretNames.EXPECTED_SECRETS) && secretNames.EXPECTED_SECRETS.length === 8)
    const d = code['ops/scripts/ops-d1-export.mjs']
    const vetted = d.indexOf('const query = loadQuery(name)')
    assert.ok(vetted > 0 && vetted < d.indexOf('of publicLines({ name') && count(d, /(?<!function )publicLines\(/g) === 1, 'the query name is vetted by the guard before it is printed')
    for (const file of ENTRY_SCRIPTS) assert.ok(/\bfor \(const \[template, values\] of /.test(code[file]), `${file}: prints through the template loop`)
  })

  await check('ops scripts: the copy Worker secret is made once and goes only to wrangler stdin and a request header', () => {
    const r2 = code['ops/scripts/ops-r2.mjs']
    assert.strictEqual(count(r2, /randomToken\(/g), 1)
    const lines = r2.split('\n').filter((l) => /copyToken/.test(l)).map((l) => l.trim())
    assert.deepStrictEqual(lines, [
      'async function deployWorker(copyToken, report) {',
      'report.deploy = { exitCode: d.code, timedOut: d.timedOut, stdout: scrub(d.stdout, copyToken), stderr: scrub(d.stderr, copyToken) }',
      "const s = await runWrangler(['secret', 'put', 'COPY_TOKEN', ...config], { cwd: WORKER_DIR, input: copyToken, timeoutMs: 2 * 60 * 1000 })",
      'report.secret = { exitCode: s.code, timedOut: s.timedOut, stdout: scrub(s.stdout, copyToken), stderr: scrub(s.stderr, copyToken) }',
      'const copyToken = randomToken(32)',
      'await deployWorker(copyToken, report)',
      'const client = workerClient({ baseUrl, token: copyToken })',
    ])
    const tokenLines = r2.split('\n').filter((l) => /\btoken\b/.test(l)).map((l) => l.trim())
    assert.deepStrictEqual(tokenLines, [
      'export function workerClient({ baseUrl, token, fetchImpl = fetch, timeoutMs = 15 * 60 * 1000, attempts = 3, pause = sleep }) {',
      "headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },",
      'const client = workerClient({ baseUrl, token: copyToken })',
    ])
    assert.strictEqual(count(r2, /\binput:/g), 1, 'only secret put reads stdin')
    assert.strictEqual(count(r2, /\bCOPY_TOKEN\b/g), 1)
    assert.ok(/function scrub\(text, secret\) \{\n\s+return truncate\(String\(text \|\| ''\)\.split\(secret\)\.join\('\[redacted\]'\), 20000\)/.test(r2), 'scrub() redacts the secret from wrangler output')
    const w = code['ops/r2-copy-worker/src/index.mjs']
    assert.strictEqual(count(w, /env\.COPY_TOKEN/g), 2, 'the Worker reads its secret in one place')
  })

  await check('ops scripts: wrangler runs only the fixed commands, the Worker ones on its own config', () => {
    const calls = []
    for (const [file, text] of Object.entries(code)) {
      for (const m of text.matchAll(/(?<!function )\brunWrangler\(/g)) {
        const rest = text.slice(m.index + m[0].length)
        const arg = /^(\[[^\]]*\]|[A-Za-z]+\([^()]*(?:\([^()]*\))?[^()]*\))\s*,/.exec(rest)
        calls.push(`${file}: ${arg ? arg[1] : rest.slice(0, 40)}`)
      }
    }
    assert.strictEqual(count(code['ops/scripts/ops-common.mjs'], /export function runWrangler\(args, /g), 1)
    assert.deepStrictEqual(calls.sort(), [
      'ops/scripts/ops-d1-export.mjs: wranglerArgs(query.sql)',
      'ops/scripts/ops-d1-physical-export.mjs: wranglerArgs(canonical)',
      "ops/scripts/ops-r2.mjs: ['deploy', ...config]",
      "ops/scripts/ops-r2.mjs: ['r2', 'bucket', 'create', DEST_BUCKET, '--location', DEST_LOCATION]",
      "ops/scripts/ops-r2.mjs: ['secret', 'put', 'COPY_TOKEN', ...config]",
      'ops/scripts/ops-settings-upsert.mjs: wranglerArgs(sql)',
    ].sort())
    const r2 = code['ops/scripts/ops-r2.mjs']
    assert.strictEqual(count(r2, /const config = \['--config', WORKER_TOML\]/g), 1)
    assert.strictEqual(driver.WORKER_DIR, path.join(ROOT, 'ops', 'r2-copy-worker'))
    assert.strictEqual(driver.WORKER_TOML, path.join(ROOT, 'ops', 'r2-copy-worker', 'wrangler.toml'))
    assert.ok(!/CLOUDFLARE_DIR|cloudflare\/wrangler|wrangler\.free/.test(r2), 'ops-r2 never touches the production Worker config')
    assert.strictEqual(lib.DEST_LOCATION, 'apac')
    assert.deepStrictEqual(d1.wranglerArgs('SELECT 1'), ['d1', 'execute', 'business-os', '--remote', '--json', '--command', 'SELECT 1'])
    assert.ok(/database_name = "business-os"/.test(read('cloudflare', 'wrangler.toml')), 'the exported database is the production one')
    const d = code['ops/scripts/ops-d1-export.mjs']
    assert.strictEqual(count(d, /requireEnv\('OPS_QUERY'\)/g), 1)
    assert.ok(/const query = loadQuery\(name\)/.test(d) && /runWrangler\(wranglerArgs\(query\.sql\)/.test(d), 'the SQL comes only from the guarded query file')
  })

  await check('ops scripts: REST calls are GETs, except one DELETE of the temporary Worker; nothing else fetches', () => {
    const methods = []
    for (const [file, text] of Object.entries(code)) {
      for (const m of text.matchAll(/\b(api|apiImpl|cfApi)\(\s*('[A-Z]+'|method\b)/g)) methods.push(`${file}: ${m[1]}(${m[2]}`)
      if (!file.startsWith('ops/scripts/ops-common')) assert.strictEqual(count(text, /\bfetch\(/g) - (file === 'ops/r2-copy-worker/src/index.mjs' ? 1 : 0), 0, `${file}: fetch`)
    }
    const kinds = methods.map((m) => m.replace(/^.*: /, ''))
    assert.ok(kinds.every((k) => /\('GET'$|\('DELETE'$|\(method$/.test(k)), `REST methods: ${kinds}`)
    assert.deepStrictEqual(methods.filter((m) => /DELETE/.test(m)), ["ops/scripts/ops-r2.mjs: apiImpl('DELETE'"])
    const r2 = code['ops/scripts/ops-r2.mjs']
    assert.ok(r2.includes('const base = `/accounts/${accountId}/workers/scripts/${COPY_WORKER}`') && r2.includes("await apiImpl('DELETE', `${base}?force=true`)"), 'the DELETE targets the copy Worker only')
    assert.notStrictEqual(lib.COPY_WORKER, lib.PRODUCTION_WORKER)
    assert.strictEqual(count(code['ops/scripts/ops-common.mjs'], /\bfetch\(/g), 1, 'ops-common fetches only in cfApi')
    assert.ok(code['ops/scripts/ops-common.mjs'].includes("export const API_BASE = 'https://api.cloudflare.com/client/v4'"))
    assert.ok(code['ops/r2-copy-worker/src/index.mjs'].includes('fetch(request, env) {'), 'the Worker fetch is its own handler, not an outbound call')
  })

  await check('settings-upsert: dry run unless apply is exactly true; one write, of the re-verified batch, after the decision; settings only from the event payload', () => {
    const s = code['ops/scripts/ops-settings-upsert.mjs']
    assert.strictEqual(count(s, /requireEnv\('OPS_APPLY'\)/g), 1)
    assert.ok(s.includes("const apply = parseApplyFlag(requireEnv('OPS_APPLY'))"), 'the apply flag goes through parseApplyFlag')
    assert.ok(s.includes("  if (raw === 'true') return true\n  if (raw === 'false') return false\n  throw new OpsError('apply-input-invalid'"), 'only true and false are accepted')
    assert.ok(s.includes("  if (apply !== true) return 'dry-run'\n"), 'anything but a real true is a dry run')
    assert.strictEqual(count(s, /process\.env\.GITHUB_EVENT_PATH/g), 1)
    assert.ok(s.includes('rawInput = readSettingsInput(process.env.GITHUB_EVENT_PATH)'), 'the settings come from the event payload')
    // Every D1 call: the state read (twice, through readState), the one write, the audit read-back.
    const calls = [...s.matchAll(/\bd1\(((?:[^()]|\([^()]*\))*)\)/g)].map((m) => m[1]).sort()
    assert.deepStrictEqual(calls, ['build.sql', 'buildAuditReadSql(report.write.auditId)', 'sql'].sort())
    assert.strictEqual(count(s, /readState\(d1, stateSql, allowList\)/g), 2)
    assert.ok(s.includes('const stateSql = buildStateSql(allowList)') && s.includes('d1: runD1,'), 'reads are the guarded state read; production D1 is runD1')
    const checked = s.indexOf('report.batchCheck = batchShapeProblems(build.sql, allowList)')
    const decided = s.indexOf("if (action !== 'write') {")
    const saved = s.indexOf('const bytes = await checkpoint(report)')
    const write = s.indexOf('const w = await d1(build.sql)')
    assert.ok(checked > 0 && decided > checked && saved > decided && write > saved, 'the batch is re-verified, the action decided and the previous values saved, in that order, before the write')
    assert.ok(s.includes('  let build = null\n') && s.includes('    build = buildBatch(plan, context)\n'), 'the written SQL is the builder output')
  })

  await check('d1-physical-export: main only (job if and script), and wrangler never writes a debug log of the result pages', () => {
    for (const task of TASKS) assert.strictEqual(WF.jobs[task].if.includes('github.ref'), MAIN_ONLY.has(task), `${task}: only the main-only tasks may test the ref`)
    const d = code['ops/scripts/ops-d1-physical-export.mjs']
    assert.ok(d.includes("if (!isMainRef(process.env.GITHUB_REF)) throw new OpsError('ref-not-main'"), 'main() refuses before any other work')
    assert.ok(d.indexOf("isMainRef(process.env.GITHUB_REF)") < d.indexOf("requireEnv('OPS_OUT_DIR')"), 'the ref check comes first')
    assert.strictEqual(count(d, /process\.env\.GITHUB_REF/g), 1)
    assert.ok(/export function isMainRef\(ref\) \{\n  return ref === 'refs\/heads\/main'\n\}/.test(d))
    const c = code['ops/scripts/ops-common.mjs']
    assert.ok(c.includes("WRANGLER_WRITE_LOGS: 'false',") && c.includes('WRANGLER_LOG_PATH: WRANGLER_LOG_DIR,'), 'wrangler logging to disk is off')
    assert.ok(c.indexOf('...extra,') < c.indexOf("WRANGLER_WRITE_LOGS: 'false'"), 'a caller env cannot switch it back on')
    assert.ok(c.includes('env: wranglerEnv(env),') && count(c, /env:\s*\{?\s*\.\.\.process\.env/g) === 0, 'the child env is built only by wranglerEnv')
    assert.ok(c.includes('fs.rmSync(WRANGLER_LOG_DIR, { recursive: true, force: true })'), 'the scratch log folder is deleted after each run')
    const env = common.wranglerEnv({})
    assert.strictEqual(env.WRANGLER_WRITE_LOGS, 'false')
    assert.strictEqual(path.resolve(env.WRANGLER_LOG_PATH), path.resolve(os.tmpdir(), path.basename(env.WRANGLER_LOG_PATH)))
    // the real child: spawn a probe through the same env builder and read the variables back
    const probe = spawnSync(process.execPath, ['-e', 'process.stdout.write(process.env.WRANGLER_WRITE_LOGS + "|" + process.env.WRANGLER_LOG_PATH)'], { env, encoding: 'utf8' })
    assert.strictEqual(probe.stdout, `false|${common.WRANGLER_LOG_DIR}`)
  })

  await check('ops scripts: they import only each other and node built-ins, and read only listed environment variables', () => {
    for (const [file, text] of Object.entries(code)) {
      for (const m of text.matchAll(/\bfrom '([^']+)'/g)) {
        const spec = m[1]
        if (spec.startsWith('node:')) {
          assert.ok(BUILTINS.has(spec), `${file}: ${spec}`)
          if (spec === 'node:child_process') assert.strictEqual(file, 'ops/scripts/ops-common.mjs', `${file}: child_process`)
        } else {
          const target = path.posix.join(path.posix.dirname(file), spec)
          assert.ok(RUNNER_SCRIPTS.includes(target) || WORKER_SCRIPTS.includes(target), `${file} imports ${spec}, which this lint does not read`)
        }
      }
    }
    const dotted = new Set()
    let indexed = 0
    let spread = 0
    const required = new Map()
    for (const [file, text] of Object.entries(code)) {
      for (const m of text.matchAll(/process\.env\.([A-Za-z0-9_]+)/g)) dotted.add(m[1])
      indexed += count(text, /process\.env\[/g)
      spread += count(text, /\.\.\.process\.env\b/g)
      for (const m of text.matchAll(/requireEnv\(\s*([^)]*)\)/g)) {
        if (m[1] === 'name') continue // the definition
        assert.ok(/^'[A-Z_]+'$/.test(m[1]), `${file}: requireEnv(${m[1]})`)
        required.set(file, [...(required.get(file) || []), m[1].slice(1, -1)])
      }
    }
    assert.deepStrictEqual([...dotted].sort(), ['CLOUDFLARE_API_TOKEN', 'GITHUB_EVENT_PATH', 'GITHUB_REF', 'GITHUB_RUN_ID', 'GITHUB_SHA', 'GITHUB_STEP_SUMMARY', 'OPS_R2_MODE'])
    assert.strictEqual(indexed, 1, 'process.env[name] only in requireEnv')
    assert.strictEqual(spread, 1, 'the environment is passed on only to wrangler')
    // Every step gives its script what the script requires.
    for (const task of TASKS) {
      WF.jobs[task].steps.forEach((step, n) => {
        const spec = TASK_STEPS[task][n]
        if (spec.kind !== 'script') return
        const file = spec.run.split(' ')[1]
        for (const name of required.get(file) || []) assert.ok(name in step.env, `${task} step ${n + 1}: ${file} requires ${name}`)
      })
    }
  })

  await check('copy Worker: its own config, two buckets, workers.dev only, the production account; SOURCE only read-only', () => {
    const toml = parseSimpleToml(read('ops', 'r2-copy-worker', 'wrangler.toml'))
    assert.deepStrictEqual(Object.keys(toml).sort(), ['account_id', 'compatibility_date', 'main', 'name', 'preview_urls', 'r2_buckets', 'workers_dev'])
    assert.strictEqual(toml.name, lib.COPY_WORKER)
    assert.strictEqual(toml.main, 'src/index.mjs')
    assert.strictEqual(toml.workers_dev, true)
    assert.strictEqual(toml.preview_urls, false)
    assert.deepStrictEqual(toml.r2_buckets, [
      { binding: 'SOURCE', bucket_name: lib.SOURCE_BUCKET },
      { binding: 'DESTINATION', bucket_name: lib.DEST_BUCKET },
    ])
    const prod = read('cloudflare', 'wrangler.toml')
    const head = prod.slice(0, prod.search(/^\[/m))
    assert.strictEqual(toml.account_id, /^account_id = "([0-9a-f]{32})"$/m.exec(head)[1], 'the same account as production')
    assert.strictEqual(lib.PRODUCTION_WORKER, /^name = "([^"]+)"$/m.exec(head)[1])
    assert.notStrictEqual(toml.name, lib.PRODUCTION_WORKER)
    assert.deepStrictEqual([lib.SOURCE_BUCKET, lib.DEST_BUCKET], ['business-os-assets', 'business-os-assets-apac'])
    for (const bad of ['routes = ["x"]', '[triggers]', 'route = 1', '[vars]', 'workers_dev = yes']) {
      assert.throws(() => parseSimpleToml(`name = "x"\n${bad}\n`), /toml line/, `the TOML reader must refuse ${bad}`)
    }
    const w = code['ops/r2-copy-worker/src/index.mjs']
    const uses = [...w.matchAll(/(.{0,16})env\.SOURCE\b(.?)/g)].map((m) => `${m[1].trim()}env.SOURCE${m[2]}`)
    assert.ok(uses.length === 2 && uses.every((u) => /!env\.SOURCE /.test(`${u} `) || /readOnlyBucket\(env\.SOURCE\)$/.test(u)), `SOURCE uses: ${uses}`)
  })

  await check('production config: ASSETS points at one of the two buckets, the same in wrangler.toml and wrangler.free.toml', () => {
    const assets = (file) => {
      const text = read('cloudflare', file)
      assert.strictEqual(count(text, /^binding = "ASSETS"$/gm), 1, `${file}: one ASSETS binding`)
      const m = /^\[\[r2_buckets\]\]\nbinding = "ASSETS"\nbucket_name = "([a-z0-9-]+)"$/m.exec(text)
      assert.ok(m, `${file}: ASSETS is not a plain r2 binding`)
      return m[1]
    }
    const main = assets('wrangler.toml')
    assert.strictEqual(assets('wrangler.free.toml'), main)
    assert.ok([lib.SOURCE_BUCKET, lib.DEST_BUCKET].includes(main), `ASSETS is ${main}`)
  })

  await check('no private key is referenced, and ops/keys holds only the public key', () => {
    assert.deepStrictEqual(fs.readdirSync(path.join(ROOT, 'ops', 'keys')), ['ops-export-public.pem'])
    assert.ok(/^-----BEGIN PUBLIC KEY-----\n[\s\S]+\n-----END PUBLIC KEY-----\n?$/.test(read('ops', 'keys', 'ops-export-public.pem')))
    const offenders = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules') walk(full)
          continue
        }
        if (fs.statSync(full).size > 2 * 1024 * 1024) continue
        const text = fs.readFileSync(full, 'utf8')
        const rel = path.relative(ROOT, full).split(path.sep).join('/')
        if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) offenders.push(`${rel}: private key material`)
        for (const m of text.matchAll(/[\w./\\<>-]*\.pem\b/g)) {
          if (!m[0].endsWith('ops-export-public.pem') && !m[0].startsWith('<')) offenders.push(`${rel}: ${m[0]}`)
        }
      }
    }
    walk(path.join(ROOT, 'ops'))
    walk(path.join(ROOT, '.github'))
    assert.deepStrictEqual(offenders, [])
  })

  for (const note of notes) console.log(`note: ${note}`)
  if (process.exitCode) console.error(`test-ops-workflow-pure: FAILED (${passed} passed)`)
  else console.log(`test-ops-workflow-pure: ${passed} checks passed`)
}

main().catch((err) => {
  process.exitCode = 1
  console.error(err)
})
