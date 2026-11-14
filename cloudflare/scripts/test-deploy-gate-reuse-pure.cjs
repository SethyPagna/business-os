#!/usr/bin/env node
// Offline checks for Deploy's gate reuse: ops/scripts/deploy-kit/gate-reuse.cjs and the
// way .github/workflows/deploy.yml wires it.
//
//   A. the decision: a matching gate run is accepted; a wrong commit, wrong workflow,
//      failed job, stale run, branch-name ref, missing or expired artifact, another
//      repository, a forged verdict field or a different kit are each refused;
//   B. the commands: `collect` (against a stubbed GitHub API) and `decide` end to end;
//   C. the workflow: gate_run_id is optional, the full sweep still runs without it,
//      and nothing the reuse path skips is a step that publishes.
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const KIT_DIR = path.join(ROOT, 'ops', 'scripts', 'deploy-kit')
const reuse = require(path.join(KIT_DIR, 'gate-reuse.cjs'))
const shards = require(path.join(KIT_DIR, 'gate-shards.cjs'))

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

const REPO = 'owner/repo'
const SHA = 'a'.repeat(40)
const KIT = 'b'.repeat(40)
const NOW = Date.parse('2026-11-14T12:00:00Z')
const HOUR = 3600 * 1000
const FILES = Array.from({ length: 50 }, (_, i) => `cloudflare/scripts/test-sample-${i}-pure.cjs`)

function fixture(over = {}) {
  const jobs = [
    { name: 'Plan', status: 'completed', conclusion: 'success' },
    { name: 'Static checks', status: 'completed', conclusion: 'success' },
    ...Array.from({ length: 8 }, (_, i) => ({ name: `Safety tests (shard ${i + 1} of 8)`, status: 'completed', conclusion: 'success' })),
    { name: 'Verdict', status: 'completed', conclusion: 'success' },
    ...['desktop-chromium', 'android-chromium', 'ios-webkit'].map((p) => ({ name: `Browser suite (${p})`, status: 'completed', conclusion: 'success' })),
  ]
  const verdict = shards.buildVerdict({ sha: SHA, kitCommit: KIT, repository: REPO, runId: 4242, runAttempt: 1, inputRef: SHA, shards: 8, files: FILES })
  return {
    deployRef: SHA,
    localHead: SHA,
    repository: REPO,
    now: NOW,
    run: {
      id: 4242, run_attempt: 1, path: '.github/workflows/gate.yml', display_title: `Gate ${SHA}`, event: 'workflow_dispatch', status: 'completed', conclusion: 'success',
      head_sha: KIT, repository: { full_name: REPO }, head_repository: { full_name: REPO }, updated_at: new Date(NOW - 2 * HOUR).toISOString(),
    },
    jobs,
    artifacts: [{ name: 'gate-verdict', expired: false, workflow_run: { id: 4242 } }],
    kit: { commit: KIT, local: {}, remote: null },
    localFiles: { count: FILES.length, digest: shards.filesDigest(FILES) },
    verdict,
    ...over,
  }
}
const withRun = (patch) => { const f = fixture(); return { ...f, run: { ...f.run, ...patch } } }
const refuses = (input, pattern) => {
  const problems = reuse.evaluate(input)
  assert.ok(problems.length > 0, 'expected a refusal, got an acceptance')
  assert.ok(problems.some((p) => pattern.test(p)), `expected ${pattern}, got:\n  ${problems.join('\n  ')}`)
}

// -------------------------------------------------------------- A. the decision

check('control: a matching, fresh, fully green gate run for the same commit and kit is accepted', () => {
  assert.deepStrictEqual(reuse.evaluate(fixture()), [])
})

check('wrong commit: a gate that tested another sha is refused', () => {
  const f = fixture()
  refuses({ ...f, verdict: { ...f.verdict, sha: 'c'.repeat(40) } }, /tested c{40}, this deploy releases a{40}/)
})

check('wrong commit: the deploy checkout is not at the deploy ref', () => {
  refuses({ ...fixture(), localHead: 'd'.repeat(40) }, /checked-out commit/)
})

check('branch-name ref (or a short sha) is refused when a gate run is reused', () => {
  for (const ref of ['main', 'lane/deploy-speed', 'a'.repeat(12), 'A'.repeat(40), `${SHA} `, '']) refuses({ ...fixture(), deployRef: ref, localHead: ref }, /full 40-character commit id/)
})

check('wrong workflow: a run of another workflow (deploy, ops, a lookalike path) is refused', () => {
  for (const p of ['.github/workflows/deploy.yml', '.github/workflows/ops.yml', '.github/workflows/gate.yml.bak', 'gate.yml', '.github/workflows/not-gate.yml']) refuses(withRun({ path: p }), /not \.github\/workflows\/gate\.yml/)
  assert.deepStrictEqual(reuse.evaluate(withRun({ path: '.github/workflows/gate.yml@refs/heads/main' })), [], 'the @ref suffix GitHub appends is ignored')
})

check('wrong trigger: a run that was not a manual dispatch is refused', () => {
  refuses(withRun({ event: 'push' }), /not a manual dispatch/)
})

check('wrong repository: a run of another repository, or one started from a fork, is refused', () => {
  refuses(withRun({ repository: { full_name: 'someone/else' } }), /belongs to someone\/else/)
  refuses(withRun({ head_repository: { full_name: 'fork/repo' } }), /fork/)
  refuses(withRun({ head_repository: null }), /fork/)
  refuses({ ...fixture(), verdict: { ...fixture().verdict, repository: 'someone/else' } }, /verdict is for someone\/else/)
})

check('a run that is still going, failed, was cancelled or is skipped is refused', () => {
  for (const [status, conclusion] of [['in_progress', null], ['completed', 'failure'], ['completed', 'cancelled'], ['completed', 'skipped'], ['completed', 'neutral']]) refuses(withRun({ status, conclusion }), /not completed\/success/)
})

check('failed job: any job that is not success is refused, the browser matrix included', () => {
  for (const [match, conclusion] of [['Safety tests (shard 3 of 8)', 'failure'], ['Static checks', 'failure'], ['Browser suite (ios-webkit)', 'failure'], ['Browser suite (desktop-chromium)', 'skipped'], ['Verdict', 'cancelled'], ['Plan', null]]) {
    const f = fixture()
    f.jobs = f.jobs.map((j) => (j.name === match ? { ...j, conclusion } : j))
    refuses(f, new RegExp(`job "${match.replace(/[()]/g, '\\$&')}" concluded`))
  }
})

check('a stripped-down run (missing shard, verdict or browser jobs) is refused even if every remaining job is green', () => {
  const f = fixture()
  refuses({ ...f, jobs: f.jobs.filter((j) => j.name !== 'Safety tests (shard 5 of 8)') }, /every test shard job/)
  refuses({ ...f, jobs: f.jobs.filter((j) => j.name !== 'Verdict') }, /"Verdict" is missing/)
  refuses({ ...f, jobs: f.jobs.filter((j) => !/^Browser suite/.test(j.name)) }, /browser suite jobs/)
  refuses({ ...f, jobs: f.jobs.filter((j) => !/^Safety tests/.test(j.name)) }, /no test shard jobs/)
  refuses({ ...f, jobs: [] }, /no jobs/)
  refuses({ ...f, verdict: { ...f.verdict, shards: 4 } }, /disagree on the shard count/)
})

check('stale run: older than 7 days is refused, 6 days and 23 hours is accepted', () => {
  refuses(withRun({ updated_at: new Date(NOW - 8 * 24 * HOUR).toISOString() }), /8 days ago/)
  refuses(withRun({ updated_at: new Date(NOW - 7 * 24 * HOUR - 1000).toISOString() }), /older than 7 days/)
  assert.deepStrictEqual(reuse.evaluate(withRun({ updated_at: new Date(NOW - 6 * 24 * HOUR - 23 * HOUR).toISOString() })), [])
  refuses(withRun({ updated_at: undefined }), /no finish time/)
  refuses(withRun({ updated_at: new Date(NOW + HOUR).toISOString() }), /in the future/)
})

check('missing or expired artifact is refused; an artifact of another run does not count', () => {
  refuses({ ...fixture(), artifacts: [] }, /no gate-verdict artifact/)
  refuses({ ...fixture(), artifacts: [{ name: 'gate-records', expired: false, workflow_run: { id: 4242 } }] }, /no gate-verdict artifact/)
  refuses({ ...fixture(), artifacts: [{ name: 'gate-verdict', expired: true, workflow_run: { id: 4242 } }] }, /expired/)
  refuses({ ...fixture(), artifacts: [{ name: 'gate-verdict', expired: false, workflow_run: { id: 1 } }] }, /does not belong to run 4242/)
})

check('missing verdict file is refused at decide time but tolerated by the pre-download check', () => {
  assert.deepStrictEqual(reuse.evaluate({ ...fixture(), verdict: null, verdictOptional: true }), [])
  refuses({ ...fixture(), verdict: null }, /verdict file is missing/)
})

check('forged or inconsistent verdict fields are refused', () => {
  const f = fixture()
  refuses({ ...f, verdict: { ...f.verdict, result: 'fail' } }, /verdict says fail/)
  refuses({ ...f, verdict: { ...f.verdict, run_id: '999' } }, /from run 999/)
  refuses({ ...f, verdict: { ...f.verdict, run_attempt: 2 } }, /attempt 2/)
  refuses({ ...f, verdict: { ...f.verdict, kit_commit: 'e'.repeat(40) } }, /disagree on the release kit commit/)
  refuses({ ...f, verdict: { ...f.verdict, version: 2 } }, /unknown version/)
  refuses({ ...f, verdict: { ...f.verdict, input_ref: 'main' } }, /does not carry the input ref "main"/)
  refuses({ ...withRun({ display_title: `Gate ${'f'.repeat(40)}` }), verdict: { ...f.verdict, input_ref: 'f'.repeat(40) } }, /dispatched with one commit id but the verdict names another/)
})

check('a gate dispatched with a branch name is accepted when its title carries that branch and the verdict names this sha', () => {
  const f = withRun({ display_title: 'Gate lane/deploy-speed' })
  assert.deepStrictEqual(reuse.evaluate({ ...f, verdict: { ...f.verdict, input_ref: 'lane/deploy-speed' } }), [])
})

check('a different set of test files than the deploy commit has is refused', () => {
  refuses({ ...fixture(), localFiles: { count: FILES.length + 1, digest: shards.filesDigest([...FILES, 'cloudflare/scripts/test-new-pure.cjs']) } }, /ran 50 test files, this commit has 51/)
  refuses({ ...fixture(), localFiles: { count: FILES.length, digest: shards.filesDigest(FILES.slice(1).concat('x')) } }, /different set of test files/)
  refuses({ ...fixture(), localFiles: null }, /local test file list/)
})

check('release kit: same commit is compatible; a different commit is compatible only when the gate workflow and every kit file are byte-identical', () => {
  const entries = { 'ops/scripts/deploy-kit/release.cjs': '1'.repeat(40), 'ops/scripts/deploy-kit/fixtures': '2'.repeat(40), '.github/workflows/gate.yml': '3'.repeat(40) }
  const other = { ...fixture().run, head_sha: 'c'.repeat(40) }
  const f = fixture()
  const base = { ...f, run: other, verdict: { ...f.verdict, kit_commit: 'c'.repeat(40) } }
  assert.deepStrictEqual(reuse.evaluate({ ...base, kit: { commit: KIT, local: entries, remote: { ...entries } } }), [])
  refuses({ ...base, kit: { commit: KIT, local: entries, remote: { ...entries, '.github/workflows/gate.yml': '9'.repeat(40) } } }, /differ between them/)
  refuses({ ...base, kit: { commit: KIT, local: entries, remote: { ...entries, 'ops/scripts/deploy-kit/release.cjs': '9'.repeat(40) } } }, /differ between them/)
  refuses({ ...base, kit: { commit: KIT, local: entries, remote: { ...entries, 'ops/scripts/deploy-kit/extra.cjs': '9'.repeat(40) } } }, /differ between them/)
  refuses({ ...base, kit: { commit: KIT, local: entries, remote: null } }, /differ between them/)
  refuses({ ...base, kit: { commit: KIT, local: {}, remote: {} } }, /differ between them/)
})

check('every refusal is reported together, so one message shows everything wrong', () => {
  const f = fixture()
  const problems = reuse.evaluate({ ...f, deployRef: 'main', run: { ...f.run, conclusion: 'failure' }, artifacts: [] })
  assert.ok(problems.length >= 3, problems.join('\n'))
})

// ------------------------------------------------------------------ B. commands

function tempRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-reuse-'))
  const run = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' })
    assert.strictEqual(r.status, 0, r.stderr)
    return r.stdout.trim()
  }
  run('init', '-q')
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text) }
  run('add', '.')
  run('commit', '-q', '-m', 'fixture')
  return { dir, sha: run('rev-parse', 'HEAD') }
}

function stubApi(dir, routes) {
  const file = path.join(dir, 'stub-fetch.cjs')
  fs.writeFileSync(file, `const routes = ${JSON.stringify(routes)}\nglobalThis.fetch = async (url) => {\n  const route = String(url).replace('https://api.github.com/repos/${REPO}', '')\n  const body = routes[route]\n  if (body === undefined) return { ok: false, status: 404, json: async () => ({}) }\n  return { ok: true, status: 200, json: async () => body }\n}\n`)
  return file
}

function cli(args, env = {}) {
  const r = spawnSync(process.execPath, [path.join(KIT_DIR, 'gate-reuse.cjs'), ...args], { encoding: 'utf8', env: { ...process.env, ...env } })
  return { status: r.status, out: r.stdout + r.stderr }
}

check('collect + decide: the real commands accept a matching run and refuse a tampered verdict (API stubbed)', () => {
  const release = tempRepo({
    'cloudflare/scripts/test-one-pure.cjs': '1',
    'cloudflare/scripts/test-two-pure.cjs': '2',
    'frontend/tests/three.test.ts': '3',
  })
  const kit = tempRepo({ 'ops/scripts/deploy-kit/release.cjs': 'x', '.github/workflows/gate.yml': 'name: Gate\n' })
  const dirs = [release.dir, kit.dir]
  try {
    const files = shards.listGateFiles(release.dir, 'HEAD')
    assert.strictEqual(files.length, 3)
    const f = fixture()
    const run = { ...f.run, id: 4242, head_sha: kit.sha, display_title: `Gate ${release.sha}`, updated_at: new Date().toISOString() }
    const routes = {
      '/actions/runs/4242': run,
      '/actions/runs/4242/jobs?filter=latest&per_page=100&page=1': { jobs: f.jobs },
      '/actions/runs/4242/artifacts?per_page=100': { artifacts: f.artifacts },
    }
    const stub = stubApi(release.dir, routes)
    const out = path.join(release.dir, '..', `collected-${process.pid}.json`)
    dirs.push(out)
    const env = { GITHUB_TOKEN: 'fixture-not-a-token', NODE_OPTIONS: `--require ${stub.replace(/\\/g, '/')}` }
    const base = ['collect', '--repo', REPO, '--run-id', '4242', '--deploy-ref', release.sha, '--release', release.dir, '--kit', kit.dir, '--out', out]
    const first = cli(base, env)
    assert.strictEqual(first.status, 0, first.out)
    assert.ok(!/fixture-not-a-token/.test(first.out), 'the token is never printed')
    const verdictFile = path.join(release.dir, '..', `verdict-${process.pid}.json`)
    dirs.push(verdictFile)
    const verdict = shards.buildVerdict({ sha: release.sha, kitCommit: kit.sha, repository: REPO, runId: 4242, runAttempt: 1, inputRef: release.sha, shards: 8, files })
    fs.writeFileSync(verdictFile, JSON.stringify(verdict))
    const ok = cli(['decide', '--collected', out, '--verdict', verdictFile])
    assert.strictEqual(ok.status, 0, ok.out)
    assert.match(ok.out, /Reusing gate run 4242/)
    fs.writeFileSync(verdictFile, JSON.stringify({ ...verdict, sha: 'c'.repeat(40) }))
    const forged = cli(['decide', '--collected', out, '--verdict', verdictFile])
    assert.strictEqual(forged.status, 1)
    assert.match(forged.out, /::error::.*will not reuse the gate run/)
    fs.rmSync(verdictFile)
    const missing = cli(['decide', '--collected', out, '--verdict', verdictFile])
    assert.strictEqual(missing.status, 1)
    assert.match(missing.out, /verdict file is missing/)
    const branch = cli(base.map((a) => (a === release.sha ? 'main' : a)), env)
    assert.strictEqual(branch.status, 1)
    assert.match(branch.out, /full 40-character commit id/)
    const noToken = cli(base, { GITHUB_TOKEN: '' })
    assert.strictEqual(noToken.status, 1)
    const badId = cli(base.map((a) => (a === '4242' ? '42; rm -rf' : a)), env)
    assert.strictEqual(badId.status, 1)
    assert.match(badId.out, /must be a number/)
  } finally {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------------ C. the workflow

const deployYml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8').replace(/\r\n/g, '\n')
const stepsOf = (text) => text.split('\n      - name: ').slice(1).map((s) => ({ name: s.split('\n')[0], text: s }))
const REUSE_ONLY = "inputs.gate_run_id != ''"
const SWEEP_ONLY = "inputs.gate_run_id == ''"

check('deploy.yml: gate_run_id is an optional string input that defaults to empty, and actions: read is the only extra permission', () => {
  const block = /^ {6}gate_run_id:\n((?: {8}.*\n)+)/m.exec(deployYml)
  assert.ok(block, 'input gate_run_id')
  assert.match(block[1], /required: false/)
  assert.match(block[1], /default: ''/)
  assert.match(block[1], /type: string/)
  assert.match(deployYml, /^permissions:\n {2}contents: read\n {2}actions: read\n/m)
  assert.ok(!/:\s*write\b/.test(deployYml))
})

check('deploy.yml: the full sweep step is untouched and runs only without gate_run_id; the reuse steps run only with it', () => {
  const steps = stepsOf(deployYml)
  const sweep = steps.find((s) => s.name.startsWith('Safety tests'))
  assert.ok(sweep && sweep.text.includes('release.cjs gates -CI -ReleaseDir release -Records "$env:RELEASE_RECORDS_ROOT" -Jobs 2\n'), 'the sweep command is unchanged')
  assert.ok(sweep.text.includes(`if: \${{ ${SWEEP_ONLY} }}`), 'the sweep runs only when no gate run is reused')
  const reusing = steps.filter((s) => s.text.includes(REUSE_ONLY))
  assert.deepStrictEqual(reusing.map((s) => s.name), ['Check the gate run to reuse', 'Download the gate verdict', 'Check the gate verdict', 'Keep the gate verdict with the release records', 'Build the app (the gate run proved its tests)'])
  assert.ok(steps.find((s) => s.name.startsWith('Install the test browser')).text.includes(`if: ${'$'}{{ ${SWEEP_ONLY} }}`), 'the test browser is installed only when the tests run here')
})

check('deploy.yml: the reuse checks come after both checkouts and before the snapshot, so a refusal stops before anything touches production', () => {
  const at = (needle) => { const i = deployYml.indexOf(needle); assert.ok(i >= 0, needle); return i }
  const check1 = at('- name: Check the gate run to reuse')
  assert.ok(check1 > at('- name: Check out the commit to release'))
  assert.ok(at('- name: Check the gate verdict') > at('- name: Download the gate verdict'))
  assert.ok(at('- name: Check the gate verdict') > check1)
  assert.ok(at('- name: Check the gate verdict') < at('- name: Safety snapshot'))
  assert.ok(at('- name: Build the app (the gate run proved its tests)') < at('- name: Safety snapshot'))
  assert.ok(at('- name: Build the app (the gate run proved its tests)') > at('- name: Record the release'))
  assert.ok(at('- name: Record the release') < at('- name: Keep the gate verdict with the release records'), 'the records folder must exist before the verdict is kept in it')
  assert.ok(at('- name: Keep the gate verdict with the release records') < at('- name: Safety snapshot'))
  assert.ok(at('- name: Check the gate verdict') < at('- name: Verify encrypted record protection'), 'the evidence step must not create the records root before the precheck')
})

check('deploy.yml: the reuse steps hold no Cloudflare secret, take inputs only through env, and a refusal exits non-zero without a fallback', () => {
  for (const s of stepsOf(deployYml).filter((x) => x.text.includes(REUSE_ONLY))) {
    assert.ok(!/secrets\./.test(s.text), `${s.name} sees a secret`)
    const run = /\n {8}run: \|?([\s\S]*?)(?=\n {6}- name: |$)/.exec(s.text)
    if (run) assert.ok(!/\$\{\{\s*inputs\./.test(run[1]), `${s.name} interpolates an input into a script`)
    assert.ok(!/continue-on-error/.test(s.text), `${s.name} may not continue on error`)
  }
  assert.ok(!/continue-on-error/.test(deployYml))
  const verify = stepsOf(deployYml).find((s) => s.name === 'Check the gate run to reuse')
  assert.ok(verify.text.includes('GITHUB_TOKEN: ${{ github.token }}'))
  assert.ok(/gate-reuse\.cjs collect/.test(verify.text) && /exit \$LASTEXITCODE/.test(verify.text), 'a refusal fails the step')
})

check('deploy.yml: every step that publishes or reads production still runs in both modes (no step after the checks has a gate_run_id condition)', () => {
  const steps = stepsOf(deployYml)
  const from = steps.findIndex((s) => s.name.startsWith('Safety snapshot'))
  assert.ok(from > 0)
  for (const s of steps.slice(from)) {
    if (/if: .*gate_run_id/.test(s.text)) assert.fail(`${s.name} depends on gate_run_id`)
  }
  for (const name of ['Safety snapshot', 'Database updates (migrations)', 'Publish (deploy)', 'Live checks and row counts after']) assert.ok(steps.some((s) => s.name.startsWith(name)), name)
})

if (!process.exitCode) console.log(`deploy gate reuse: ${passed} checks passed`)
