#!/usr/bin/env node
// Offline checks for Deploy's gate reuse: ops/scripts/deploy-kit/gate-reuse.cjs and the
// way .github/workflows/deploy.yml wires it.
//
//   A. the decision: a matching gate run is accepted; a wrong commit, wrong workflow,
//      failed job, stale run, branch-name ref, missing or expired artifact, another
//      repository, a forged verdict field or a different kit are each refused; a partial
//      re-run (only a browser leg) does not make a good run unusable;
//   B. the commands: `collect` (against a stubbed GitHub API, same and different kit commit),
//      `decide`, `evidence` and `verify-dist` end to end;
//   C. the workflow: gate_run_id is optional, the full sweep still runs without it, the
//      reuse checks sit in their own job with the only `actions: read`, the deploy job runs
//      on both paths (condition evaluated over every combination), and nothing the reuse
//      path skips is a step that publishes.
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
const DIST = 'd'.repeat(64)
const NOW = Date.parse('2026-11-14T12:00:00Z')
const HOUR = 3600 * 1000
const FILES = Array.from({ length: 50 }, (_, i) => `cloudflare/scripts/test-sample-${i}-pure.cjs`)

const artifactsFor = (attempt, runId = 4242) => [
  { name: reuse.verdictArtifactName(attempt), expired: false, workflow_run: { id: runId } },
  { name: reuse.recordsArtifactName(attempt), expired: false, workflow_run: { id: runId } },
]

function jobsFor(attempts = {}, startedAt = NOW - 3 * HOUR) {
  const job = (name) => ({ name, status: 'completed', conclusion: 'success', run_attempt: attempts[name] || 1, started_at: new Date(startedAt).toISOString(), completed_at: new Date(startedAt + HOUR).toISOString() })
  return [
    job('Plan'),
    job('Static checks'),
    ...Array.from({ length: 8 }, (_, i) => job(`Safety tests (shard ${i + 1} of 8)`)),
    job('Verdict'),
    ...['desktop-chromium', 'android-chromium', 'ios-webkit'].map((p) => job(`Browser suite (${p})`)),
  ]
}

function fixture(over = {}) {
  const verdict = shards.buildVerdict({ sha: SHA, kitCommit: KIT, repository: REPO, runId: 4242, runAttempt: 1, inputRef: SHA, shards: 8, files: FILES, dist: DIST })
  return {
    deployRef: SHA,
    localHead: SHA,
    repository: REPO,
    now: NOW,
    run: {
      id: 4242, run_attempt: 1, path: '.github/workflows/gate.yml', display_title: `Gate ${SHA}`, event: 'workflow_dispatch', status: 'completed', conclusion: 'success',
      head_sha: KIT, repository: { full_name: REPO }, head_repository: { full_name: REPO }, updated_at: new Date(NOW - 2 * HOUR).toISOString(),
    },
    jobs: jobsFor(),
    artifacts: artifactsFor(1),
    kit: { commit: KIT, local: {}, remote: null },
    localFiles: { count: FILES.length, digest: shards.filesDigest(FILES) },
    verdict,
    ...over,
  }
}
const withRun = (patch) => { const f = fixture(); return { ...f, run: { ...f.run, ...patch } } }
const startedAt = (ms) => ({ ...fixture(), jobs: jobsFor({}, ms) })
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

check('the API omitting the repository field is a refusal, not a pass', () => {
  for (const repository of [undefined, null, {}, { full_name: '' }]) refuses(withRun({ repository }), /belongs to/)
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

check('the gate age limit is the named constant MAX_GATE_AGE_HOURS = 24, counted from the jobs\' start: a run 25 hours old is refused, 23 hours is accepted', () => {
  assert.strictEqual(reuse.MAX_GATE_AGE_HOURS, 24)
  assert.strictEqual(reuse.MAX_AGE_MS, 24 * HOUR)
  refuses(startedAt(NOW - 25 * HOUR), /started 25 hours ago; gate runs older than 24 hours/)
  refuses(startedAt(NOW - 24 * HOUR - 1000), /older than 24 hours/)
  refuses(startedAt(NOW - 8 * 24 * HOUR), /192 hours ago/)
  assert.deepStrictEqual(reuse.evaluate(startedAt(NOW - 23 * HOUR)), [])
  assert.deepStrictEqual(reuse.evaluate(startedAt(NOW - 24 * HOUR)), [], 'exactly 24 hours is still inside')
  refuses(startedAt(NOW + HOUR), /started in the future/)
  for (const started_at of [undefined, null, '', 'not a date']) {
    const f = fixture()
    refuses({ ...f, jobs: f.jobs.map((j) => (j.name === 'Plan' ? { ...j, started_at } : j)) }, /job "Plan" has no start time/)
  }
})

check('the run\'s own updated_at no longer decides the age: a fresh or missing one does not rescue an old gate, an old one does not condemn a new gate', () => {
  const old = startedAt(NOW - 30 * HOUR)
  refuses({ ...old, run: { ...old.run, updated_at: new Date(NOW - 60000).toISOString() } }, /30 hours ago/)
  refuses({ ...old, run: { ...old.run, updated_at: undefined } }, /30 hours ago/)
  const young = startedAt(NOW - 2 * HOUR)
  assert.deepStrictEqual(reuse.evaluate({ ...young, run: { ...young.run, updated_at: new Date(NOW - 40 * 24 * HOUR).toISOString() } }), [])
  assert.deepStrictEqual(reuse.evaluate({ ...young, run: { ...young.run, updated_at: undefined } }), [])
})

check('a partial re-run days later does not refresh the age: it counts from the earliest job start, so a browser leg re-run on day three leaves a day-one gate refused', () => {
  const f = fixture()
  const rerun = 'Browser suite (ios-webkit)'
  const withLeg = (safetyStart, legStart, planStart = safetyStart) => jobsFor({ [rerun]: 2 }, safetyStart).map((j) => {
    if (j.name === rerun) return { ...j, started_at: new Date(legStart).toISOString(), completed_at: new Date(legStart + HOUR).toISOString() }
    return j.name === 'Plan' ? { ...j, started_at: new Date(planStart).toISOString() } : j
  })
  const input = (jobs) => ({ ...f, run: { ...f.run, run_attempt: 2, updated_at: new Date(NOW - 30 * 60000).toISOString() }, jobs })
  refuses(input(withLeg(NOW - 49 * HOUR, NOW - HOUR)), /started 49 hours ago; gate runs older than 24 hours/)
  assert.deepStrictEqual(reuse.evaluate(input(withLeg(NOW - 10 * HOUR, NOW - HOUR))), [], 'control: the same re-run within a day is reusable')
  refuses(input(withLeg(NOW - 2 * HOUR, NOW - HOUR, NOW - 30 * HOUR)), /30 hours ago/)
  const full = jobsFor({ Verdict: 2 }, NOW - HOUR)
  assert.deepStrictEqual(reuse.evaluate({ ...f, run: { ...f.run, run_attempt: 2 }, jobs: full, verdict: { ...f.verdict, run_attempt: 2 }, artifacts: artifactsFor(2) }), [], 'control: a full re-run today is a fresh gate')
})

check('missing or expired artifacts are refused; an artifact of another run, or of another attempt, does not count', () => {
  const verdictName = reuse.verdictArtifactName(1)
  const recordsName = reuse.recordsArtifactName(1)
  assert.strictEqual(verdictName, 'gate-verdict-a1')
  assert.strictEqual(recordsName, 'gate-records-all-a1')
  refuses({ ...fixture(), artifacts: [] }, /no gate-verdict-a1 artifact/)
  refuses({ ...fixture(), artifacts: artifactsFor(1).slice(1) }, /no gate-verdict-a1 artifact/)
  refuses({ ...fixture(), artifacts: artifactsFor(1).slice(0, 1) }, /no gate-records-all-a1 artifact/)
  refuses({ ...fixture(), artifacts: [{ name: 'gate-verdict', expired: false, workflow_run: { id: 4242 } }, ...artifactsFor(1).slice(1)] }, /no gate-verdict-a1 artifact/)
  refuses({ ...fixture(), artifacts: artifactsFor(2) }, /no gate-verdict-a1 artifact/)
  refuses({ ...fixture(), artifacts: artifactsFor(1).map((a) => ({ ...a, expired: true })) }, /gate-verdict-a1 artifact has expired/)
  refuses({ ...fixture(), artifacts: artifactsFor(1, 1) }, /gate-verdict-a1 artifact does not belong to run 4242/)
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
  refuses({ ...f, verdict: { ...f.verdict, version: 1 } }, /unknown version/)
  refuses({ ...f, verdict: { ...f.verdict, input_ref: 'main' } }, /does not carry the input ref "main"/)
  refuses({ ...withRun({ display_title: `Gate ${'f'.repeat(40)}` }), verdict: { ...f.verdict, input_ref: 'f'.repeat(40) } }, /dispatched with one commit id but the verdict names another/)
})

check('a verdict without a valid digest of the tested app is refused', () => {
  const f = fixture()
  for (const dist_sha256 of [undefined, null, '', 'abc', 'D'.repeat(64), 'd'.repeat(65)]) refuses({ ...f, verdict: { ...f.verdict, dist_sha256 } }, /no digest of the app the shards tested/)
})

check('partial re-run: re-running only a browser leg (run attempt 2, Verdict job still attempt 1) leaves the run reusable', () => {
  const f = fixture()
  const jobs = jobsFor({ 'Browser suite (ios-webkit)': 2 })
  assert.deepStrictEqual(reuse.evaluate({ ...f, run: { ...f.run, run_attempt: 2 }, jobs }), [])
  refuses({ ...f, run: { ...f.run, run_attempt: 2 }, jobs: jobs.map((j) => (j.name === 'Browser suite (ios-webkit)' ? { ...j, conclusion: 'failure' } : j)) }, /Browser suite \(ios-webkit\)" concluded failure/)
  refuses({ ...f, run: { ...f.run, run_attempt: 2, conclusion: 'failure' }, jobs }, /not completed\/success/)
})

check('the verdict is compared with the Verdict job\'s own attempt, not the run\'s', () => {
  const f = fixture()
  const second = jobsFor({ Verdict: 2 })
  const verdict2 = { ...f.verdict, run_attempt: 2 }
  assert.deepStrictEqual(reuse.evaluate({ ...f, run: { ...f.run, run_attempt: 2 }, jobs: second, verdict: verdict2, artifacts: artifactsFor(2) }), [])
  refuses({ ...f, run: { ...f.run, run_attempt: 2 }, jobs: second, verdict: f.verdict, artifacts: artifactsFor(2) }, /verdict is from attempt 1, the Verdict job's attempt is 2/)
  refuses({ ...f, run: { ...f.run, run_attempt: 2 }, jobs: jobsFor(), verdict: verdict2, artifacts: artifactsFor(2) }, /verdict is from attempt 2, the Verdict job's attempt is 1/)
  refuses({ ...f, run: { ...f.run, run_attempt: 2 }, jobs: second, verdict: verdict2, artifacts: artifactsFor(1) }, /no gate-verdict-a2 artifact/)
  refuses({ ...f, run: { ...f.run, run_attempt: 1 }, jobs: second, verdict: verdict2, artifacts: artifactsFor(2) }, /later than the run's latest attempt 1/)
  for (const run_attempt of [undefined, null, 0, 'x']) {
    refuses({ ...f, jobs: f.jobs.map((j) => (j.name === 'Verdict' ? { ...j, run_attempt } : j)) }, /no single Verdict job/)
  }
  refuses({ ...f, jobs: [...f.jobs, { name: 'Verdict', status: 'completed', conclusion: 'success', run_attempt: 1 }] }, /more than one Verdict job/)
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
  assert.deepStrictEqual(reuse.evaluate({ ...base, kit: { commit: KIT, local: entries, remote: Object.fromEntries(Object.entries(entries).reverse()) } }), [], 'the order the API lists the entries in does not matter')
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

const cleanups = []
function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  cleanups.push(dir)
  return dir
}

function git(dir, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' })
  assert.strictEqual(r.status, 0, r.stderr)
  return r.stdout.trim()
}

function tempRepo(files) {
  const dir = tempDir('gate-reuse-')
  git(dir, 'init', '-q')
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text) }
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'fixture')
  return { dir, sha: git(dir, 'rev-parse', 'HEAD') }
}

function stubApi(dir, routes) {
  const file = path.join(dir, 'stub-fetch.cjs')
  fs.writeFileSync(file, `const routes = ${JSON.stringify(routes)}\nglobalThis.fetch = async (url) => {\n  const route = String(url).replace('https://api.github.com/repos/${REPO}', '')\n  const body = routes[route]\n  if (body === undefined) return { ok: false, status: 404, json: async () => ({}) }\n  return { ok: true, status: 200, json: async () => body }\n}\n`)
  return file
}

function cli(args, env = {}) {
  const r = spawnSync(process.execPath, [path.join(KIT_DIR, 'gate-reuse.cjs'), ...args], { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '', ...env } })
  return { status: r.status, out: r.stdout + r.stderr }
}

const KIT_FILES = {
  'ops/scripts/deploy-kit/release.cjs': 'x',
  'ops/scripts/deploy-kit/fixtures/data.json': '{}',
  '.github/workflows/gate.yml': 'name: Gate\n',
}

// What the contents API says about the kit at the gate run's commit: a directory listing (path and sha per entry, a
// sub-directory is one entry with its tree sha) and the gate workflow file.
function contentsRoutes(kit, runHead, overrides = {}) {
  const sha = (p) => git(kit.dir, 'rev-parse', `HEAD:${p}`)
  const dir = [
    { path: 'ops/scripts/deploy-kit/fixtures', sha: sha('ops/scripts/deploy-kit/fixtures') },
    { path: 'ops/scripts/deploy-kit/release.cjs', sha: sha('ops/scripts/deploy-kit/release.cjs') },
  ].map((e) => ({ ...e, sha: overrides[e.path] || e.sha }))
  return {
    [`/contents/ops/scripts/deploy-kit?ref=${runHead}`]: dir,
    [`/contents/.github/workflows/gate.yml?ref=${runHead}`]: { path: '.github/workflows/gate.yml', sha: overrides['.github/workflows/gate.yml'] || sha('.github/workflows/gate.yml') },
  }
}

// Runs the real `collect` then `decide` against a stubbed API. `scenario` shapes the gate run.
function pipeline(scenario = {}) {
  const release = tempRepo({
    'cloudflare/scripts/test-one-pure.cjs': '1',
    'cloudflare/scripts/test-two-pure.cjs': '2',
    'frontend/tests/three.test.ts': '3',
  })
  const kit = tempRepo(KIT_FILES)
  const work = tempDir('gate-reuse-work-')
  const files = shards.listGateFiles(release.dir, 'HEAD')
  assert.strictEqual(files.length, 3)
  const f = fixture()
  const runHead = scenario.runHead || kit.sha
  const verdictAttempt = scenario.verdictAttempt || 1
  const run = { ...f.run, id: 4242, run_attempt: scenario.runAttempt || verdictAttempt, head_sha: runHead, display_title: `Gate ${release.sha}`, updated_at: new Date().toISOString() }
  const jobs = (scenario.mapJobs || ((all) => all))(jobsFor(scenario.jobAttempts || { Verdict: verdictAttempt }, scenario.startedAt === undefined ? Date.now() - HOUR : scenario.startedAt))
  const routes = {
    '/actions/runs/4242': run,
    '/actions/runs/4242/jobs?filter=latest&per_page=100&page=1': { jobs },
    '/actions/runs/4242/artifacts?per_page=100': { artifacts: artifactsFor(verdictAttempt) },
    ...(scenario.routes ? scenario.routes(kit, runHead) : {}),
  }
  const stub = stubApi(work, routes)
  const out = path.join(work, 'nested', 'dir', 'collected.json')
  const githubOutput = path.join(work, 'github-output.txt')
  fs.writeFileSync(githubOutput, '')
  const env = { GITHUB_TOKEN: 'fixture-not-a-token', GITHUB_OUTPUT: githubOutput, NODE_OPTIONS: `--require ${stub.replace(/\\/g, '/')}` }
  const collectArgs = ['collect', '--repo', REPO, '--run-id', '4242', '--deploy-ref', release.sha, '--release', release.dir, '--kit', kit.dir, '--out', out]
  const verdictFile = path.join(work, 'verdict.json')
  const verdict = shards.buildVerdict({ sha: release.sha, kitCommit: runHead, repository: REPO, runId: 4242, runAttempt: verdictAttempt, inputRef: release.sha, shards: 8, files, dist: DIST })
  return { release, kit, work, files, run, jobs, env, collectArgs, out, githubOutput, verdictFile, verdict }
}

check('collect + decide: the real commands accept a matching run, name the artifacts to download, and refuse a tampered verdict (API stubbed)', () => {
  const p = pipeline()
  const first = cli(p.collectArgs, p.env)
  assert.strictEqual(first.status, 0, first.out)
  assert.ok(!/fixture-not-a-token/.test(first.out), 'the token is never printed')
  assert.strictEqual(fs.readFileSync(p.githubOutput, 'utf8'), 'verdict_artifact=gate-verdict-a1\nrecords_artifact=gate-records-all-a1\n')
  const collectedJobs = JSON.parse(fs.readFileSync(p.out, 'utf8')).jobs
  assert.strictEqual(collectedJobs.length, p.jobs.length)
  assert.deepStrictEqual(collectedJobs.map((j) => [j.name, j.started_at, j.completed_at]), p.jobs.map((j) => [j.name, j.started_at, j.completed_at]), 'collect keeps every job\'s start and finish time, the facts the age is counted from')
  assert.ok(collectedJobs.every((j) => Number.isFinite(Date.parse(j.started_at))))
  fs.writeFileSync(p.verdictFile, JSON.stringify(p.verdict))
  const ok = cli(['decide', '--collected', p.out, '--verdict', p.verdictFile])
  assert.strictEqual(ok.status, 0, ok.out)
  assert.match(ok.out, /Reusing gate run 4242/)
  const here = cli(['decide', '--collected', p.out, '--verdict', p.verdictFile, '--release', p.release.dir])
  assert.strictEqual(here.status, 0, here.out)
  fs.writeFileSync(p.verdictFile, JSON.stringify({ ...p.verdict, sha: 'c'.repeat(40) }))
  const forged = cli(['decide', '--collected', p.out, '--verdict', p.verdictFile])
  assert.strictEqual(forged.status, 1)
  assert.match(forged.out, /::error::.*will not reuse the gate run/)
  fs.writeFileSync(p.verdictFile, JSON.stringify({ ...p.verdict, dist_sha256: undefined }))
  assert.strictEqual(cli(['decide', '--collected', p.out, '--verdict', p.verdictFile]).status, 1)
  fs.rmSync(p.verdictFile)
  const missing = cli(['decide', '--collected', p.out, '--verdict', p.verdictFile])
  assert.strictEqual(missing.status, 1)
  assert.match(missing.out, /verdict file is missing/)
  const branch = cli(p.collectArgs.map((a) => (a === p.release.sha ? 'main' : a)), p.env)
  assert.strictEqual(branch.status, 1)
  assert.match(branch.out, /full 40-character commit id/)
  const noToken = cli(p.collectArgs, { ...p.env, GITHUB_TOKEN: '' })
  assert.strictEqual(noToken.status, 1)
  const badId = cli(p.collectArgs.map((a) => (a === '4242' ? '42; rm -rf' : a)), p.env)
  assert.strictEqual(badId.status, 1)
  assert.match(badId.out, /must be a number/)
})

check('decide in the deploy job compares the deploy job\'s own checkout, and the age is counted again at deploy time', () => {
  const p = pipeline()
  assert.strictEqual(cli(p.collectArgs, p.env).status, 0)
  fs.writeFileSync(p.verdictFile, JSON.stringify(p.verdict))
  const other = tempRepo({ 'cloudflare/scripts/test-one-pure.cjs': 'other' })
  const wrongCommit = cli(['decide', '--collected', p.out, '--verdict', p.verdictFile, '--release', other.dir])
  assert.strictEqual(wrongCommit.status, 1)
  assert.match(wrongCommit.out, /checked-out commit/)
  const sameCommitFewerFiles = tempRepo({ 'cloudflare/scripts/test-one-pure.cjs': '1' })
  git(sameCommitFewerFiles.dir, 'checkout', '-q', '--detach', sameCommitFewerFiles.sha)
  const collected = JSON.parse(fs.readFileSync(p.out, 'utf8'))
  collected.deployRef = sameCommitFewerFiles.sha
  collected.localHead = sameCommitFewerFiles.sha
  const forgedCollected = path.join(p.work, 'forged-collected.json')
  fs.writeFileSync(forgedCollected, JSON.stringify(collected))
  const fewer = cli(['decide', '--collected', forgedCollected, '--verdict', p.verdictFile, '--release', sameCommitFewerFiles.dir])
  assert.strictEqual(fewer.status, 1)
  assert.match(fewer.out, /ran 3 test files, this commit has 1/)
  collected.jobs = collected.jobs.map((j) => ({ ...j, started_at: new Date(Date.now() - 30 * HOUR).toISOString() }))
  collected.deployRef = p.release.sha
  collected.localHead = p.release.sha
  fs.writeFileSync(forgedCollected, JSON.stringify(collected))
  const stale = cli(['decide', '--collected', forgedCollected, '--verdict', p.verdictFile, '--release', p.release.dir])
  assert.strictEqual(stale.status, 1)
  assert.match(stale.out, /gate runs older than 24 hours are not reused/)
})

check('collect with the gate run made from a different kit commit: accepted when the gate workflow and every kit file are byte-identical, refused when one blob differs', () => {
  const runHead = 'c'.repeat(40)
  const same = pipeline({ runHead, routes: (kit, head) => contentsRoutes(kit, head) })
  const ok = cli(same.collectArgs, same.env)
  assert.strictEqual(ok.status, 0, ok.out)
  const collected = JSON.parse(fs.readFileSync(same.out, 'utf8'))
  assert.notStrictEqual(collected.kit.commit, runHead, 'the deploy kit is another commit than the gate kit')
  assert.deepStrictEqual(Object.keys(collected.kit.remote).sort(), ['.github/workflows/gate.yml', 'ops/scripts/deploy-kit/fixtures', 'ops/scripts/deploy-kit/release.cjs'])
  assert.deepStrictEqual(collected.kit.remote, collected.kit.local)
  fs.writeFileSync(same.verdictFile, JSON.stringify(same.verdict))
  assert.strictEqual(cli(['decide', '--collected', same.out, '--verdict', same.verdictFile]).status, 0)
  for (const [what, key] of [['a kit file', 'ops/scripts/deploy-kit/release.cjs'], ['a kit sub-directory', 'ops/scripts/deploy-kit/fixtures'], ['the gate workflow', '.github/workflows/gate.yml']]) {
    const differ = pipeline({ runHead, routes: (kit, head) => contentsRoutes(kit, head, { [key]: '9'.repeat(40) }) })
    const refused = cli(differ.collectArgs, differ.env)
    assert.strictEqual(refused.status, 1, `${what} differs: ${refused.out}`)
    assert.match(refused.out, /differ between them/)
    assert.strictEqual(fs.readFileSync(differ.githubOutput, 'utf8'), '', 'a refused run names no artifact to download')
  }
  const noRoutes = pipeline({ runHead })
  const unreachable = cli(noRoutes.collectArgs, noRoutes.env)
  assert.strictEqual(unreachable.status, 1, 'an unreadable contents API is a refusal, not a pass')
  assert.match(unreachable.out, /contents\/ops\/scripts\/deploy-kit/)
})

check('collect after a partial re-run names the artifacts of the Verdict job\'s attempt, not the run\'s latest attempt', () => {
  const p = pipeline({ runAttempt: 2, verdictAttempt: 1, jobAttempts: { Verdict: 1, 'Browser suite (ios-webkit)': 2 } })
  const r = cli(p.collectArgs, p.env)
  assert.strictEqual(r.status, 0, r.out)
  assert.strictEqual(fs.readFileSync(p.githubOutput, 'utf8'), 'verdict_artifact=gate-verdict-a1\nrecords_artifact=gate-records-all-a1\n')
  fs.writeFileSync(p.verdictFile, JSON.stringify(p.verdict))
  assert.strictEqual(cli(['decide', '--collected', p.out, '--verdict', p.verdictFile]).status, 0)
  const rerunVerdict = pipeline({ runAttempt: 2, verdictAttempt: 2 })
  assert.strictEqual(cli(rerunVerdict.collectArgs, rerunVerdict.env).status, 0)
  assert.strictEqual(fs.readFileSync(rerunVerdict.githubOutput, 'utf8'), 'verdict_artifact=gate-verdict-a2\nrecords_artifact=gate-records-all-a2\n')
})

check('collect refuses a partial re-run made days after the safety tests ran, although the run itself was updated a moment ago', () => {
  const rerun = 'Browser suite (ios-webkit)'
  const p = pipeline({ runAttempt: 2, verdictAttempt: 1, jobAttempts: { Verdict: 1, [rerun]: 2 }, startedAt: Date.now() - 49 * HOUR, mapJobs: (jobs) => jobs.map((j) => (j.name === rerun ? { ...j, started_at: new Date().toISOString() } : j)) })
  const r = cli(p.collectArgs, p.env)
  assert.strictEqual(r.status, 1, r.out)
  assert.match(r.out, /started 49 hours ago; gate runs older than 24 hours/)
  assert.strictEqual(fs.readFileSync(p.githubOutput, 'utf8'), '', 'a refused run names no artifact to download')
  const sameDay = pipeline({ runAttempt: 2, verdictAttempt: 1, jobAttempts: { Verdict: 1, [rerun]: 2 }, startedAt: Date.now() - 5 * HOUR, mapJobs: (jobs) => jobs.map((j) => (j.name === rerun ? { ...j, started_at: new Date().toISOString() } : j)) })
  assert.strictEqual(cli(sameDay.collectArgs, sameDay.env).status, 0, 'control: the same re-run on the same day is fine')
})

check('verify-dist: the app built in the deploy job must have exactly the digest the gate tested', () => {
  const dist = tempDir('gate-dist-')
  fs.mkdirSync(path.join(dist, 'assets'))
  fs.writeFileSync(path.join(dist, 'index.html'), '<html></html>')
  fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'code')
  fs.writeFileSync(path.join(dist, 'business-os-build.json'), JSON.stringify({ revision: 'r', hash: 'h', builtAt: 'now' }))
  const { digest } = shards.distDigest(dist)
  const work = tempDir('gate-verdict-')
  const verdictFile = path.join(work, 'gate-verdict.json')
  const verdictWith = (dist_sha256) => fs.writeFileSync(verdictFile, JSON.stringify({ dist_sha256 }))
  verdictWith(digest)
  const ok = cli(['verify-dist', '--dist', dist, '--verdict', verdictFile])
  assert.strictEqual(ok.status, 0, ok.out)
  assert.match(ok.out, new RegExp(digest))
  fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'code!')
  const changed = cli(['verify-dist', '--dist', dist, '--verdict', verdictFile])
  assert.strictEqual(changed.status, 1)
  assert.match(changed.out, /is not the app the gate tested/)
  fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'code')
  fs.writeFileSync(path.join(dist, 'business-os-build.json'), JSON.stringify({ revision: 'r', hash: 'h', builtAt: 'later' }))
  assert.strictEqual(cli(['verify-dist', '--dist', dist, '--verdict', verdictFile]).status, 0, 'only the build clock may differ')
  const flipAt = (i) => `${digest.slice(0, i)}${digest[i] === '0' ? '1' : '0'}${digest.slice(i + 1)}`
  for (const i of [0, 15, 16, 31, 63]) {
    verdictWith(flipAt(i))
    const nearly = cli(['verify-dist', '--dist', dist, '--verdict', verdictFile])
    assert.strictEqual(nearly.status, 1, `a digest that differs only in hex character ${i} is a different app`)
    assert.match(nearly.out, /is not the app the gate tested/)
  }
  verdictWith(digest)
  for (const bad of [undefined, 'abc', digest.toUpperCase()]) {
    verdictWith(bad)
    const refused = cli(['verify-dist', '--dist', dist, '--verdict', verdictFile])
    assert.strictEqual(refused.status, 1, String(bad))
    assert.match(refused.out, /no digest of the tested app/)
  }
  verdictWith(digest)
  assert.strictEqual(cli(['verify-dist', '--dist', path.join(work, 'missing'), '--verdict', verdictFile]).status, 1, 'no dist at all is a refusal')
})

check('evidence keeps the collected facts and the verdict, names the app digest, and writes to the step summary', () => {
  const p = pipeline()
  assert.strictEqual(cli(p.collectArgs, p.env).status, 0)
  fs.writeFileSync(p.verdictFile, JSON.stringify(p.verdict))
  const outDir = path.join(p.work, 'records', 'gate-reuse')
  const summary = path.join(p.work, 'summary.md')
  const r = cli(['evidence', '--collected', p.out, '--verdict', p.verdictFile, '--out', outDir], { GITHUB_STEP_SUMMARY: summary })
  assert.strictEqual(r.status, 0, r.out)
  const kept = JSON.parse(fs.readFileSync(path.join(outDir, 'gate-reuse.json'), 'utf8'))
  assert.strictEqual(kept.verdict.dist_sha256, DIST)
  assert.strictEqual(kept.collected.run.id, 4242)
  assert.match(fs.readFileSync(summary, 'utf8'), new RegExp(DIST))
})

// ------------------------------------------------------------------ C. the workflow

const deployYml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8').replace(/\r\n/g, '\n')
const jobBlock = (name) => {
  const m = new RegExp(`^ {2}${name}:\\n((?: {4}.*\\n|\\n)+)`, 'm').exec(`${deployYml}\n`)
  assert.ok(m, `job ${name}`)
  return m[1]
}
const deployJob = jobBlock('deploy')
const gateCheckJob = jobBlock('gate_check')
const stepsOf = (text) => text.split('\n      - name: ').slice(1).map((s) => ({ name: s.split('\n')[0], text: s }))
const runBody = (step) => {
  const m = /\n {8}run: \|\n((?: {10}.*\n?)+)/.exec(step.text)
  return m ? m[1].split('\n').map((l) => l.slice(10)).join('\n').replace(/\n+$/, '') : null
}
const REUSE_ONLY = "inputs.gate_run_id != ''"
const SWEEP_ONLY = "inputs.gate_run_id == ''"
const conditionOf = (step) => (/\n {8}if: (.+)\n/.exec(step.text) || [])[1]
const KIT_CALL = 'node kit/ops/scripts/deploy-kit/gate-reuse.cjs'

check('deploy.yml: gate_run_id is an optional string input that defaults to empty', () => {
  const block = /^ {6}gate_run_id:\n((?: {8}.*\n)+)/m.exec(deployYml)
  assert.ok(block, 'input gate_run_id')
  assert.match(block[1], /required: false/)
  assert.match(block[1], /default: ''/)
  assert.match(block[1], /type: string/)
})

check('deploy.yml: actions: read is held by the gate_check job alone; the workflow and the deploy job keep contents: read, so the full-sweep path has the permissions it always had', () => {
  assert.match(deployYml, /^permissions:\n {2}contents: read\n\nconcurrency:/m)
  assert.ok(!/^ {4}permissions:/m.test(deployJob), 'the deploy job declares no permissions of its own')
  assert.match(gateCheckJob, /^ {4}permissions:\n {6}contents: read\n {6}actions: read\n/m)
  assert.strictEqual((deployYml.match(/^\s+actions: read$/gm) || []).length, 1, 'actions: read is granted once, in gate_check')
  assert.ok(!/:\s*write\b/.test(deployYml))
  assert.ok(!/secrets\./.test(gateCheckJob), 'gate_check sees no secret')
  assert.ok(!/environment:/.test(gateCheckJob), 'gate_check does not wait for the production reviewer')
})

// GitHub evaluates this expression; the same text is evaluated here, with `inputs` and `needs` filled in.
function deployRuns(gateRunId, gateCheckResult, cancelled = false) {
  const expr = /^ {4}if: \$\{\{ (.+) \}\}$/m.exec(deployJob)[1]
  const js = expr.replace(/needs\.gate_check\.result/g, 'needsResult').replace(/inputs\.gate_run_id/g, 'gateRunId').replace(/!cancelled\(\)/g, '!isCancelled').replace(/\bcancelled\(\)/g, 'isCancelled').replace(/always\(\)/g, 'true')
  return new Function('needsResult', 'gateRunId', 'isCancelled', `return !!(${js})`)(gateCheckResult, gateRunId, cancelled)
}

check('deploy.yml: the deploy job runs on the full-sweep path (gate_check skipped) and on the reuse path only after gate_check succeeded', () => {
  assert.match(deployJob, /^ {4}needs: gate_check$/m)
  assert.match(gateCheckJob, /^ {4}if: \$\{\{ inputs\.gate_run_id != '' \}\}$/m)
  const table = [
    ['', 'skipped', false, true, 'full sweep: gate_check is skipped and the deploy still runs'],
    ['', 'failure', false, false, 'a failed check never starts the deploy, with or without a gate run id'],
    ['', 'cancelled', false, false, 'a cancelled check never starts the deploy'],
    ['4242', 'success', false, true, 'reuse: the check succeeded'],
    ['4242', 'failure', false, false, 'reuse: the check failed'],
    ['4242', 'cancelled', false, false, 'reuse: the check was cancelled'],
    ['4242', 'skipped', false, false, 'reuse: a skipped check is not a pass'],
    ['4242', '', false, false, 'reuse: no result'],
    ['', 'skipped', true, false, 'a cancelled workflow does not start the deploy'],
    ['4242', 'success', true, false, 'a cancelled workflow does not start the deploy'],
  ]
  for (const [id, result, cancelled, expected, why] of table) assert.strictEqual(deployRuns(id, result, cancelled), expected, why)
})

check('deploy.yml: the sweep step is untouched and runs only without gate_run_id; exactly the reuse steps run only with it', () => {
  const steps = stepsOf(deployJob)
  const sweep = steps.find((s) => s.name.startsWith('Safety tests'))
  assert.ok(sweep && sweep.text.includes('release.cjs gates -CI -ReleaseDir release -Records "$env:RELEASE_RECORDS_ROOT" -Jobs 2\n'), 'the sweep command is unchanged')
  assert.deepStrictEqual(steps.filter((s) => conditionOf(s) === `\${{ ${SWEEP_ONLY} }}`).map((s) => s.name), ['Install the test browser (frontend)', 'Safety tests (every test file on its own, retried on timeout)'])
  assert.deepStrictEqual(steps.filter((s) => s.text.includes(SWEEP_ONLY)).map((s) => s.name), ['Install the test browser (frontend)', 'Safety tests (every test file on its own, retried on timeout)'], 'no other step mentions the sweep-only condition')
  assert.deepStrictEqual(steps.filter((s) => conditionOf(s) === `\${{ ${REUSE_ONLY} }}`).map((s) => s.name), [
    'Download the gate evidence',
    'Check the gate verdict at deploy time',
    'Keep the gate verdict with the release records',
    'Keep the gate test logs with the release records',
    'Build the app (the gate run proved its tests)',
    'Check the built app is the app the gate tested',
    'Pin the tested app for the publish step',
  ])
  assert.deepStrictEqual(steps.filter((s) => s.text.includes(REUSE_ONLY)).length, 7, 'no other step mentions the reuse condition')
})

check('deploy.yml: the steps that must run on both paths carry no gate_run_id condition (the records precheck, the installs, the record, the snapshot, the publish, the live checks, the export)', () => {
  const steps = stepsOf(deployJob)
  const always = ['Check the confirm word', 'Initialize release record paths', 'Check out the release kit', 'Check out the commit to release', 'Show the commit', 'Set up Node', 'Verify encrypted record protection', 'Install packages (cloudflare)', 'Install packages (frontend)', 'Record the release', 'Safety snapshot', 'Database updates (migrations)', 'Publish (deploy)', 'Live checks and row counts after', 'Preserve release evidence and history', 'Encrypt release records', 'Retain encrypted release records']
  for (const name of always) {
    const s = steps.find((x) => x.name.startsWith(name))
    assert.ok(s, `step ${name} exists`)
    assert.ok(!/gate_run_id/.test(s.text), `${s.name} depends on gate_run_id`)
  }
  const verify = steps.find((s) => s.name === 'Verify encrypted record protection')
  assert.ok(!/\n {8}if:/.test(verify.text), 'the records precheck has no condition at all')
  assert.match(verify.text, /id: records_precheck/)
  const exportStep = steps.find((s) => s.name === 'Encrypt release records')
  assert.ok(exportStep.text.includes("if: always() && steps.records_precheck.outcome == 'success' && steps.record_release.outcome != 'skipped' && steps.record_release.outcome != ''"))
})

check('deploy.yml: the gate checks run after Set up Node, the record precheck and the install steps follow them, and the order inside the deploy job is download, check, precheck, record, keep, build, verify, snapshot', () => {
  const at = (needle) => { const i = deployJob.indexOf(`- name: ${needle}`); assert.ok(i >= 0, needle); return i }
  const order = ['Check out the commit to release', 'Set up Node', 'Download the gate evidence', 'Check the gate verdict at deploy time', 'Verify encrypted record protection', 'Install packages (cloudflare)', 'Record the release', 'Keep the gate verdict with the release records', 'Keep the gate test logs with the release records', 'Build the app (the gate run proved its tests)', 'Check the built app is the app the gate tested', 'Pin the tested app for the publish step', 'Safety snapshot', 'Publish (deploy)']
  order.reduce((prev, name) => { assert.ok(at(name) > at(prev), `${name} must come after ${prev}`); return name })
  assert.ok(at('Safety tests') < at('Safety snapshot'))
})

check('deploy.yml: the gate_check job checks out, sets up Node, collects, downloads the attempt-named artifacts, decides, and only then hands the evidence on', () => {
  const names = stepsOf(gateCheckJob).map((s) => s.name)
  assert.deepStrictEqual(names, ['Check out the release kit', 'Check out the commit to release', 'Set up Node', 'Check the gate run to reuse', 'Download the gate verdict', 'Download the gate test logs', 'Check the gate verdict', 'Hand the gate evidence to the deploy job', 'Hand the gate test logs to the deploy job'])
  assert.match(gateCheckJob, /name: \$\{\{ steps\.collect\.outputs\.verdict_artifact \}\}/)
  assert.match(gateCheckJob, /name: \$\{\{ steps\.collect\.outputs\.records_artifact \}\}/)
  assert.ok(!/name: gate-verdict\b|name: gate-records\b/.test(gateCheckJob), 'artifact names come from the collected facts, never a literal')
  assert.strictEqual((gateCheckJob.match(/run-id: \$\{\{ inputs\.gate_run_id \}\}/g) || []).length, 2)
  assert.match(deployJob, /name: gate-reuse-evidence-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/)
  assert.match(deployJob, /name: gate-reuse-logs-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/)
  assert.match(deployJob, /path: \$\{\{ env\.RELEASE_RECORDS_ROOT \}\}\/gate-reuse\/gate-records/, 'the gate test logs land in the encrypted release records')
})

check('deploy.yml: every call of the reuse kit ends in exit $LASTEXITCODE, so a refusal fails its step and cannot be turned into a pass', () => {
  const calls = [...stepsOf(deployJob), ...stepsOf(gateCheckJob)].filter((s) => (runBody(s) || '').includes('gate-reuse.cjs'))
  assert.deepStrictEqual(calls.map((s) => s.name), ['Check the gate verdict at deploy time', 'Keep the gate verdict with the release records', 'Check the built app is the app the gate tested', 'Check the gate run to reuse', 'Check the gate verdict'])
  for (const s of calls) {
    const lines = runBody(s).split('\n')
    assert.strictEqual(lines.length, 2, `${s.name}: exactly the kit call and the exit`)
    assert.match(lines[0], new RegExp(`^${KIT_CALL.replace(/[./]/g, '\\$&')} (collect|decide|evidence|verify-dist) [^;|&<>]*$`), `${s.name}: one plain kit call`)
    assert.strictEqual(lines[1], 'exit $LASTEXITCODE', `${s.name}: fail-closed exit`)
    assert.ok(!/\|\||;|&&|\|/.test(lines[0]), `${s.name}: no operator that could swallow the exit code`)
    assert.ok(!/continue-on-error/.test(s.text), `${s.name}: may not continue on error`)
  }
  const decide = calls.filter((s) => /gate-reuse\.cjs decide/.test(runBody(s)))
  assert.strictEqual(decide.length, 2, 'decide runs in both jobs')
  for (const s of decide) assert.match(runBody(s), /--release release\b/, `${s.name}: compares the job's own checkout`)
  assert.ok(!/continue-on-error/.test(deployYml))
})

check('deploy.yml: the reuse build step is the kit\'s -Part build, with no secret, and the digest check directly follows it', () => {
  const steps = stepsOf(deployJob)
  const i = steps.findIndex((s) => s.name === 'Build the app (the gate run proved its tests)')
  assert.ok(i > 0)
  assert.match(steps[i].text, /\n {8}run: node kit\/ops\/scripts\/deploy-kit\/release\.cjs gates -CI -ReleaseDir release -Records "\$env:RELEASE_RECORDS_ROOT" -Part build\n/)
  assert.ok(!/secrets\.|env:/.test(steps[i].text.replace(/\$env:/g, '')), 'the build step has no env block and no secret')
  assert.strictEqual(steps[i + 1].name, 'Check the built app is the app the gate tested', 'the digest check comes right after the build')
})

check('deploy.yml: the publish step is handed the verdict the digest check used, through RELEASE_EXPECT_DIST, is itself unchanged, and no step after the pin builds the app on the reuse path', () => {
  const steps = stepsOf(deployJob)
  const verdictPath = '$env:RUNNER_TEMP/gate-check/verdict/gate-verdict.json'
  const verify = steps.find((s) => s.name === 'Check the built app is the app the gate tested')
  const pin = steps.find((s) => s.name === 'Pin the tested app for the publish step')
  const publish = steps.find((s) => s.name === 'Publish (deploy)')
  assert.ok(verify && pin && publish)
  assert.ok(runBody(verify).includes(`--verdict "${verdictPath}"`), 'the digest check reads this verdict file')
  assert.strictEqual(runBody(pin), `"RELEASE_EXPECT_DIST=${verdictPath}" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8`, 'the publish step is told to expect the digest of that same file')
  assert.strictEqual(conditionOf(pin), `\${{ ${REUSE_ONLY} }}`, 'the sweep path, which builds its own app, is not pinned')
  assert.ok(!/secrets\./.test(pin.text))
  const publishRun = (/\n {8}run: (.+)\n/.exec(publish.text) || [])[1]
  assert.strictEqual(publishRun, 'node kit/ops/scripts/deploy-kit/release.cjs deploy -CI -ReleaseDir release -Records "$env:RELEASE_RECORDS_ROOT" -Plan $env:PLAN', 'the publish command is the original one')
  assert.ok(!/RELEASE_EXPECT_DIST|gate_run_id/.test(publish.text), 'the publish step itself carries no reuse condition')
  assert.ok(steps.indexOf(pin) < steps.indexOf(publish) && steps.indexOf(verify) < steps.indexOf(pin))
  for (const s of steps.slice(steps.indexOf(pin) + 1)) {
    if (/release\.cjs gates|npm run build|build:frontend|deploy:full/.test(s.text)) assert.strictEqual(conditionOf(s), `\${{ ${SWEEP_ONLY} }}`, `${s.name} may build the app only on the full-sweep path`)
  }
})

check('deploy.yml: the reuse steps hold no Cloudflare secret and take inputs only through env; the token reaches only the collect step and the cross-run downloads', () => {
  for (const s of [...stepsOf(deployJob).filter((x) => x.text.includes(REUSE_ONLY)), ...stepsOf(gateCheckJob)]) {
    assert.ok(!/secrets\./.test(s.text), `${s.name} sees a secret`)
    const body = runBody(s)
    if (body) assert.ok(!/\$\{\{\s*inputs\./.test(body), `${s.name} interpolates an input into a script`)
  }
  const collect = stepsOf(gateCheckJob).find((s) => s.name === 'Check the gate run to reuse')
  assert.ok(collect.text.includes('GITHUB_TOKEN: ${{ github.token }}'))
  assert.ok(!/github\.token/.test(deployJob), 'the deploy job never gets the token')
  assert.ok(/gate-reuse\.cjs collect/.test(runBody(collect)))
})

check('deploy.yml: every step that publishes or reads production still runs in both modes (no step after the checks has a gate_run_id condition)', () => {
  const steps = stepsOf(deployJob)
  const from = steps.findIndex((s) => s.name.startsWith('Safety snapshot'))
  assert.ok(from > 0)
  for (const s of steps.slice(from)) {
    if (/if: .*gate_run_id/.test(s.text)) assert.fail(`${s.name} depends on gate_run_id`)
  }
  for (const name of ['Safety snapshot', 'Database updates (migrations)', 'Publish (deploy)', 'Live checks and row counts after']) assert.ok(steps.some((s) => s.name.startsWith(name)), name)
})

check('DEPLOY.md documents the age limit constant, the digest check and the separate check job', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'DEPLOY.md'), 'utf8').replace(/\r\n/g, '\n')
  assert.ok(doc.includes('MAX_GATE_AGE_HOURS'), 'the constant is named')
  assert.match(doc, /MAX_GATE_AGE_HOURS.{0,300}24 hours|24 hours.{0,300}MAX_GATE_AGE_HOURS/s)
  assert.match(doc, /gate_check/)
  assert.match(doc, /digest/)
})

check('DEPLOY.md tells the owner to re-run all jobs, says what the age counts from, and does not overstate byte-for-byte', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'DEPLOY.md'), 'utf8').replace(/\s*\r?\n\s*/g, ' ')
  assert.match(doc, /Re-run all jobs/)
  assert.match(doc, /dispatch (Deploy )?again/)
  assert.match(doc, /Re-run failed jobs/)
  assert.match(doc, /earliest job/i)
  assert.match(doc, /RELEASE_EXPECT_DIST|-ExpectDist/)
  for (const m of doc.matchAll(/byte for byte/g)) {
    const around = doc.slice(Math.max(0, m.index - 400), m.index + 400)
    if (/tested|digest|app/.test(around) && /publish|gate/.test(around)) assert.ok(/builtAt/.test(around), `"byte for byte" about the tested app must name builtAt nearby: ${around.slice(300, 520)}`)
  }
})

for (const dir of cleanups) fs.rmSync(dir, { recursive: true, force: true })
if (!process.exitCode) console.log(`deploy gate reuse: ${passed} checks passed`)
