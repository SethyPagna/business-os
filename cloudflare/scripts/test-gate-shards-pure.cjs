#!/usr/bin/env node
// Offline checks for the gate shards: ops/scripts/deploy-kit/gate-shards.cjs, the
// -Part / -Shard options of release.cjs, and the shard rules of .github/workflows/gate.yml.
//
//   A. the split: every file in exactly one shard, deterministic, stable when a file is added;
//   B. the proof: the verdict refuses a missing, duplicated, red, stale or mismatched shard, and
//      shards that tested different builds of the app (digest of frontend/dist);
//   C. the kit: real release.cjs runs one shard of a throwaway repository and writes its manifest; the
//      parts of the gate (-Part static, -Part tests) add up to the full gate; the app digest is
//      the same in every shard although the build stamps a clock value;
//   D. the workflow: the matrix, the shard count, the manifest upload, the attempt-suffixed
//      artifact names and the job results handed to the verdict proof agree.
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const KIT = path.join(ROOT, 'ops', 'scripts', 'deploy-kit')
const shards = require(path.join(KIT, 'gate-shards.cjs'))
const lib = require(path.join(KIT, 'lib.cjs'))

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

const SHA = 'a'.repeat(40)
const DIST = 'd'.repeat(64)
const names = (n) => Array.from({ length: n }, (_, i) => `cloudflare/scripts/test-sample-${i}${i % 4 === 0 ? '-native' : '-pure'}.cjs`)

function realFiles() {
  const out = []
  for (const spec of Object.values(lib.GATE_TEST_FILES)) {
    for (const f of fs.readdirSync(path.join(ROOT, spec.dir))) if (spec.re.test(`${spec.dir}/${f}`)) out.push(`${spec.dir}/${f}`)
  }
  return out.sort()
}

// ---------------------------------------------------------------- A. the split

check('every file lands in exactly one shard, for several shard counts', () => {
  const files = names(500)
  for (const count of [1, 2, 3, 7, 8, 11]) {
    const parts = shards.splitFiles(files, count)
    assert.strictEqual(parts.length, count)
    assert.deepStrictEqual(parts.flat().sort(), [...files].sort(), `union for ${count} shards`)
    assert.strictEqual(new Set(parts.flat()).size, files.length, `no duplicates for ${count} shards`)
  }
})

check('the real test files are covered once at 8 shards and no shard is starved or overloaded', () => {
  const files = realFiles()
  assert.ok(files.length > 1000, `expected the real list, got ${files.length}`)
  const parts = shards.splitFiles(files, 8)
  assert.deepStrictEqual(parts.flat().sort(), files)
  const mean = files.length / 8
  for (const p of parts) assert.ok(p.length > mean * 0.75 && p.length < mean * 1.25, `shard of ${p.length} files, mean ${mean}`)
  const native = parts.map((p) => p.filter((f) => /-native\.cjs$/.test(f)).length)
  assert.ok(native.every((n) => n > 0), `every shard runs some -native files: ${native}`)
})

check('the split is deterministic: input order and repetition do not matter', () => {
  const files = names(300)
  const a = shards.splitFiles(files, 8)
  const b = shards.splitFiles([...files].reverse(), 8)
  assert.deepStrictEqual(a, b)
  assert.deepStrictEqual(shards.splitFiles(files, 8), a)
})

check('pinned values: a changed hash would silently move files between shards', () => {
  assert.deepStrictEqual(
    ['cloudflare/scripts/test-a-pure.cjs', 'frontend/tests/a.test.ts', 'cloudflare/scripts/test-z-native.cjs'].map((f) => shards.shardIndexOf(f, 8)),
    [4, 6, 1],
  )
})

check('adding a file adds it to exactly one shard and moves no other file', () => {
  const files = names(400)
  const before = shards.splitFiles(files, 8)
  const added = 'cloudflare/scripts/test-brand-new-pure.cjs'
  const after = shards.splitFiles([...files, added], 8)
  assert.deepStrictEqual(after.flat().sort(), [...files, added].sort())
  const holders = after.map((p, i) => (p.includes(added) ? i : -1)).filter((i) => i >= 0)
  assert.strictEqual(holders.length, 1)
  after.forEach((p, i) => assert.deepStrictEqual(p.filter((f) => f !== added), before[i]))
})

check('removing a file removes it and moves no other file', () => {
  const files = names(400)
  const before = shards.splitFiles(files, 8)
  const after = shards.splitFiles(files.slice(1), 8)
  after.forEach((p, i) => assert.deepStrictEqual(p, before[i].filter((f) => f !== files[0])))
})

check('parseShard accepts i/n and refuses everything else', () => {
  assert.deepStrictEqual(shards.parseShard('3/8'), { index: 3, count: 8 })
  assert.deepStrictEqual(shards.parseShard('1/1'), { index: 1, count: 1 })
  for (const bad of ['0/8', '9/8', '3', '3/0', 'a/b', '3/8/1', '', '-1/8', '1.5/8']) assert.throws(() => shards.parseShard(bad), /-Shard/, bad)
})

check('the kit accepts -Part and -Shard and refuses a wrong value', () => {
  assert.deepStrictEqual(lib.parseArgs(['gates', '-Part', 'tests', '-Shard', '3/8']).shard, '3/8')
  assert.strictEqual(lib.parseArgs(['gates', '--part=Static']).part, 'static')
  assert.throws(() => lib.parseArgs(['gates', '-Part', 'everything']), /-Part/)
  assert.throws(() => lib.parseArgs(['gates', '-Shard', '9']), /-Shard/)
})

check('filesDigest ignores order and notices any change', () => {
  const files = names(20)
  assert.strictEqual(shards.filesDigest(files), shards.filesDigest([...files].reverse()))
  assert.notStrictEqual(shards.filesDigest(files), shards.filesDigest(files.slice(1)))
  assert.notStrictEqual(shards.filesDigest(files), shards.filesDigest([...files.slice(1), 'cloudflare/scripts/test-other.cjs']))
})

// ------------------------------------------------------------- B. the proof

const FULL = names(200)
const goodManifests = (count = 4, files = FULL, sha = SHA, attempt = 1, dist = DIST) => Array.from({ length: count }, (_, i) => shards.buildManifest({ sha, shard: { index: i + 1, count }, files: shards.selectShard(files, i + 1, count), red: [], attempt, dist }))
const problemsOf = (manifests, over = {}) => shards.checkManifests({ manifests, shards: 4, sha: SHA, fullFiles: FULL, ...over })

check('control: a complete, green, correctly split set of manifests passes', () => {
  assert.deepStrictEqual(problemsOf(goodManifests()), [])
})

check('a missing shard is refused and named', () => {
  const p = problemsOf(goodManifests().slice(0, 3))
  assert.ok(p.some((x) => /shard 4 never reported/.test(x)), p.join('\n'))
  assert.ok(p.some((x) => /union/.test(x)))
})

check('a shard reported twice is refused', () => {
  const m = goodManifests()
  assert.ok(problemsOf([...m, m[0]]).some((x) => /reported twice/.test(x)))
})

check('a red shard is refused', () => {
  const m = goodManifests()
  m[1] = shards.buildManifest({ sha: SHA, shard: { index: 2, count: 4 }, files: m[1].files, red: ['cloudflare/scripts/test-x.cjs'], attempt: 1, dist: DIST })
  assert.ok(problemsOf(m).some((x) => /shard 2 reported red/.test(x)))
})

check('a shard that tested another commit is refused', () => {
  const m = goodManifests()
  m[2] = { ...m[2], sha: 'b'.repeat(40) }
  assert.ok(problemsOf(m).some((x) => /shard 3 tested/.test(x)))
})

check('a shard that skipped a file, or ran one that is not its own, is refused', () => {
  const m = goodManifests()
  m[0] = { ...m[0], files: m[0].files.slice(1) }
  assert.ok(problemsOf(m).some((x) => /shard 1 ran a different file list/.test(x)))
  const n = goodManifests()
  n[0] = { ...n[0], files: [...n[0].files, n[1].files[0]].sort() }
  const p = problemsOf(n)
  assert.ok(p.some((x) => /shard 1 ran a different file list/.test(x)))
  assert.ok(p.some((x) => /more than one shard/.test(x)))
})

check('manifests split for another shard count are refused', () => {
  const p = problemsOf(goodManifests(3))
  assert.ok(p.some((x) => /split for 3 shards, expected 4/.test(x)))
})

check('a file added to the commit after the shards were planned is refused', () => {
  const p = problemsOf(goodManifests(), { fullFiles: [...FULL, 'cloudflare/scripts/test-late-pure.cjs'] })
  assert.ok(p.some((x) => /union/.test(x)))
})

check('malformed manifests are refused, not skipped', () => {
  assert.ok(problemsOf([...goodManifests(), { nonsense: true }]).some((x) => /malformed/.test(x)))
  assert.ok(problemsOf([...goodManifests(), null]).some((x) => /malformed/.test(x)))
})

check('the verdict carries the commit, the kit, the run and the file set', () => {
  const v = shards.buildVerdict({ sha: SHA, kitCommit: 'c'.repeat(40), repository: 'o/r', runId: 99, runAttempt: '2', inputRef: SHA, shards: 8, files: FULL, dist: DIST })
  assert.deepStrictEqual({ ...v, created_at: 'x' }, {
    version: 2, result: 'pass', sha: SHA, kit_commit: 'c'.repeat(40), repository: 'o/r', run_id: '99', run_attempt: 2, input_ref: SHA, shards: 8, file_count: 200, files_digest: shards.filesDigest(FULL), dist_sha256: DIST, created_at: 'x',
  })
})

check('shards that tested different builds of the app, or reported no app digest, are refused', () => {
  const m = goodManifests()
  m[2] = { ...m[2], dist_sha256: 'e'.repeat(64) }
  assert.ok(problemsOf(m).some((x) => /different builds of the app/.test(x)), problemsOf(m).join('\n'))
  for (const bad of [undefined, null, '', 'abc', 'D'.repeat(64), 'd'.repeat(63)]) {
    const n = goodManifests()
    n[0] = { ...n[0], dist_sha256: bad }
    assert.ok(problemsOf(n).some((x) => /shard 1 did not report a digest/.test(x)), String(bad))
  }
  assert.strictEqual(shards.testedDist(goodManifests()), DIST)
  assert.strictEqual(shards.testedDist(m), null, 'no single tested app when the shards disagree')
})

check('a re-run of the whole workflow: the latest attempt of each shard counts, the older manifests are ignored', () => {
  const stale = goodManifests(4, FULL, SHA, 1, 'e'.repeat(64)).map((x) => ({ ...x, ok: false, red: ['cloudflare/scripts/test-flaky-pure.cjs'] }))
  const fresh = goodManifests(4, FULL, SHA, 2)
  assert.deepStrictEqual(problemsOf([...stale, ...fresh], { maxAttempt: 2 }), [])
  assert.strictEqual(shards.testedDist([...stale, ...fresh]), DIST)
  const mixed = [...stale.filter((x) => x.shard !== 3), ...fresh.filter((x) => x.shard === 3)]
  assert.ok(problemsOf(mixed, { maxAttempt: 2 }).some((x) => /shard 1 reported red/.test(x)), 'a shard with only its old, red manifest still fails')
})

check('two manifests of one shard from the same attempt are refused, and so is one from an attempt that has not happened', () => {
  const m = goodManifests(4, FULL, SHA, 2)
  assert.ok(problemsOf([...m, m[0]], { maxAttempt: 2 }).some((x) => /shard 1 reported twice/.test(x)))
  assert.ok(problemsOf(m, { maxAttempt: 1 }).some((x) => /later than this run's attempt 1/.test(x)))
  const old = goodManifests(4, FULL, SHA, 1).map(({ attempt, ...rest }) => rest)
  assert.ok(problemsOf(old).some((x) => /malformed/.test(x)), 'a manifest without an attempt number is malformed')
})

check('manifests of the previous format (version 1, no app digest) are refused', () => {
  const m = goodManifests().map((x) => ({ ...x, version: 1 }))
  assert.ok(problemsOf(m).some((x) => /malformed/.test(x)))
})

// ------------------------------------------------- C. the kit on a throwaway repo

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' })
  assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

const TRACE = "require('fs').appendFileSync(process.env.SHARD_TRACE || require('os').devNull, "
const BUILD_SCRIPT = [
  "const fs = require('fs')",
  "fs.mkdirSync('dist/assets', { recursive: true })",
  "fs.writeFileSync('dist/index.html', '<html>' + process.env.BUSINESS_OS_BUILD_HASH + '</html>')",
  "fs.writeFileSync('dist/assets/app.js', 'build:' + process.env.BUSINESS_OS_BUILD_HASH)",
  "fs.writeFileSync('dist/business-os-build.json', JSON.stringify({ revision: 'r', hash: process.env.BUSINESS_OS_BUILD_HASH, builtAt: new Date().toISOString() + Math.random() }))",
].join('\n')

// The throwaway repository has the layout the kit expects. Its package scripts and test files leave a trace line, so a test
// can tell which npm scripts and which test files a run really executed. The fake build writes the clock into
// business-os-build.json like the real one does, and its output depends on BUSINESS_OS_BUILD_HASH.
function makeRepo(fileCount, redFile, extraFiles = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-shards-'))
  git(dir, 'init', '-q')
  fs.mkdirSync(path.join(dir, 'cloudflare', 'scripts'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'frontend', 'tests'), { recursive: true })
  const pass = `${TRACE}process.argv[1].replace(/\\\\/g, '/').split('/').slice(-3).join('/') + '\\n')\n`
  const script = `${TRACE}'script ' + require('path').basename(process.cwd()) + ':' + process.env.npm_lifecycle_event + '\\n')\n`
  for (let i = 0; i < fileCount; i += 1) {
    fs.writeFileSync(path.join(dir, 'cloudflare', 'scripts', `test-t${i}-pure.cjs`), pass)
    fs.writeFileSync(path.join(dir, 'frontend', 'tests', `t${i}.test.cjs`), pass)
  }
  if (redFile) fs.writeFileSync(path.join(dir, redFile), 'process.exit(1)\n')
  for (const [rel, text] of Object.entries(extraFiles)) fs.writeFileSync(path.join(dir, rel), text)
  fs.writeFileSync(path.join(dir, '.gitignore'), 'dist/\n')
  fs.writeFileSync(path.join(dir, 'cloudflare', 'script.cjs'), script)
  fs.writeFileSync(path.join(dir, 'frontend', 'script.cjs'), script)
  fs.writeFileSync(path.join(dir, 'frontend', 'build.cjs'), `${script}${BUILD_SCRIPT}\n`)
  fs.writeFileSync(path.join(dir, 'cloudflare', 'package.json'), '{"name":"c","scripts":{"typecheck":"node script.cjs"}}\n')
  fs.writeFileSync(path.join(dir, 'frontend', 'package.json'), '{"name":"f","scripts":{"typecheck":"node script.cjs","verify:i18n":"node script.cjs","build":"node build.cjs"}}\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'fixture')
  return { dir, sha: git(dir, 'rev-parse', 'HEAD') }
}

function runGates(repo, gateArgs, extra = {}) {
  const records = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-records-'))
  const trace = path.join(records, 'trace.txt')
  const r = spawnSync(process.execPath, [path.join(KIT, 'release.cjs'), 'gates', '-CI', '-ReleaseDir', repo.dir, '-Records', records, '-Jobs', '2', '-Retries', '1', ...gateArgs], {
    encoding: 'utf8', env: { ...process.env, SHARD_TRACE: trace, GITHUB_STEP_SUMMARY: '', ...extra },
  })
  const manifestFile = path.join(records, shards.MANIFEST_NAME)
  const lines = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).sort() : []
  return {
    status: r.status,
    out: r.stdout + r.stderr,
    records,
    manifest: fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null,
    ran: lines.filter((l) => !l.startsWith('script ')),
    scripts: lines.filter((l) => l.startsWith('script ')),
    steps: r.stdout.split(/\r?\n/).filter((l) => l.startsWith('- ')),
  }
}

const runShard = (repo, index, count, extra = {}) => runGates(repo, ['-Part', 'tests', '-Shard', `${index}/${count}`], extra)

check('release.cjs gates -Part tests -Shard runs only its files, once, and writes a manifest the verdict accepts', () => {
  const repo = makeRepo(12)
  const dirs = [repo.dir]
  try {
    const count = 3
    const results = [1, 2, 3].map((i) => runShard(repo, i, count))
    for (const r of results) { dirs.push(r.records); assert.strictEqual(r.status, 0, r.out.slice(-600)) }
    const full = shards.listGateFiles(repo.dir, repo.sha)
    assert.strictEqual(full.length, 24)
    const manifests = results.map((r) => r.manifest)
    assert.deepStrictEqual(shards.checkManifests({ manifests, shards: count, sha: repo.sha, fullFiles: full }), [])
    const ranAll = results.flatMap((r) => r.ran.map((l) => l.replace(/^.*?\/(scripts|tests)\//, (m, d) => `${d}/`))).sort()
    assert.strictEqual(ranAll.length, 24, `every file ran once: ${ranAll.length}`)
    results.forEach((r, i) => assert.strictEqual(r.ran.length, shards.selectShard(full, i + 1, count).length, `shard ${i + 1} ran only its own files`))
  } finally {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
  }
})

check('a red file fails its shard (after the retry), is named, and the manifest says not ok', () => {
  const repo = makeRepo(6, 'cloudflare/scripts/test-red-pure.cjs')
  const dirs = [repo.dir]
  try {
    const owner = shards.shardIndexOf('cloudflare/scripts/test-red-pure.cjs', 2)
    const bad = runShard(repo, owner, 2)
    dirs.push(bad.records)
    assert.notStrictEqual(bad.status, 0)
    assert.match(bad.out, /retrying scripts\/test-red-pure\.cjs/)
    assert.ok(bad.manifest && bad.manifest.ok === false && bad.manifest.red.includes('cloudflare/scripts/test-red-pure.cjs'))
    const other = runShard(repo, owner === 1 ? 2 : 1, 2)
    dirs.push(other.records)
    assert.strictEqual(other.status, 0)
    const full = shards.listGateFiles(repo.dir, repo.sha)
    const p = shards.checkManifests({ manifests: [bad.manifest, other.manifest], shards: 2, sha: repo.sha, fullFiles: full })
    assert.ok(p.some((x) => /reported red/.test(x)))
  } finally {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
  }
})

check('gate-shards verdict writes the verdict only when every shard reported, and exits 1 otherwise', () => {
  const repo = makeRepo(8)
  const dirs = [repo.dir]
  try {
    const count = 2
    const results = [1, 2].map((i) => runShard(repo, i, count))
    const manifests = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-manifests-'))
    dirs.push(manifests, ...results.map((r) => r.records))
    results.forEach((r, i) => { fs.mkdirSync(path.join(manifests, `s${i + 1}`)); fs.writeFileSync(path.join(manifests, `s${i + 1}`, shards.MANIFEST_NAME), JSON.stringify(r.manifest)) })
    const out = path.join(manifests, 'out', 'gate-verdict.json')
    const args = (extra = []) => [path.join(KIT, 'gate-shards.cjs'), 'verdict', '--release', repo.dir, '--manifests', manifests, '--shards', String(count), '--sha', repo.sha, '--kit-commit', 'c'.repeat(40), '--input-ref', 'main', '--out', out, '--plan-result', 'success', '--static-result', 'success', '--shard-result', 'success', ...extra]
    const env = { ...process.env, GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '7', GITHUB_RUN_ATTEMPT: '1' }
    const ok = spawnSync(process.execPath, args(), { encoding: 'utf8', env })
    assert.strictEqual(ok.status, 0, ok.stdout)
    const v = JSON.parse(fs.readFileSync(out, 'utf8'))
    assert.strictEqual(v.sha, repo.sha)
    assert.strictEqual(v.file_count, 16)
    assert.match(v.dist_sha256, /^[0-9a-f]{64}$/)
    assert.strictEqual(v.dist_sha256, results[0].manifest.dist_sha256)
    assert.strictEqual(results[0].manifest.dist_sha256, results[1].manifest.dist_sha256, 'two shards, two builds, one digest')
    for (const [flag, jobName] of [['--plan-result', 'plan'], ['--static-result', 'static'], ['--shard-result', 'shard']]) {
      for (const result of ['failure', 'cancelled', 'skipped', '']) {
        fs.rmSync(out, { force: true })
        const refused = spawnSync(process.execPath, args([flag, result]), { encoding: 'utf8', env })
        assert.strictEqual(refused.status, 1, `${jobName}=${result || 'empty'}: ${refused.stdout}`)
        assert.match(refused.stdout, new RegExp(`${jobName} job result was ${result || 'missing'}, not success`))
        assert.ok(!/ran exactly once/.test(refused.stdout), 'the manifests are complete, so only the job result can be the reason')
        assert.ok(!fs.existsSync(out), `no verdict is written when the ${jobName} job result is ${result || 'empty'}`)
      }
    }
    fs.rmSync(out, { force: true })
    const noResults = spawnSync(process.execPath, args().slice(0, -6), { encoding: 'utf8', env })
    assert.strictEqual(noResults.status, 1, 'omitting the job results is not a pass')
    assert.ok(!fs.existsSync(out))
    const again = spawnSync(process.execPath, args(), { encoding: 'utf8', env })
    assert.strictEqual(again.status, 0, again.stdout)
    fs.rmSync(out)
    fs.rmSync(path.join(manifests, 's2'), { recursive: true })
    const missing = spawnSync(process.execPath, args(), { encoding: 'utf8', env })
    assert.strictEqual(missing.status, 1)
    assert.match(missing.stdout, /shard 2 never reported/)
    assert.ok(!fs.existsSync(out), 'no verdict is written for an incomplete run')
  } finally {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
  }
})

check('the parts add up to the gate: -Part static plus -Part tests run exactly the npm scripts and test files of the full gates run', () => {
  const repo = makeRepo(6)
  const runs = []
  try {
    const full = runGates(repo, [])
    const staticPart = runGates(repo, ['-Part', 'static'])
    const tests = runGates(repo, ['-Part', 'tests', '-Shard', '1/1'])
    runs.push(full, staticPart, tests)
    for (const r of runs) assert.strictEqual(r.status, 0, r.out.slice(-800))
    const scripts = (r) => [...new Set(r.scripts)].sort()
    assert.deepStrictEqual(scripts(full), ['script cloudflare:typecheck', 'script frontend:build', 'script frontend:typecheck', 'script frontend:verify:i18n'], 'the full gate runs these four scripts')
    assert.deepStrictEqual([...new Set([...scripts(staticPart), ...scripts(tests)])].sort(), scripts(full), 'static + tests = gates, by npm script')
    assert.deepStrictEqual(scripts(staticPart), ['script cloudflare:typecheck', 'script frontend:build', 'script frontend:typecheck', 'script frontend:verify:i18n'], 'static runs the typechecks, the i18n check and the build')
    assert.deepStrictEqual(scripts(tests), ['script frontend:build'], 'the tests part builds because some tests read dist')
    assert.deepStrictEqual(tests.ran, full.ran, 'the one shard of one runs every test file the full gate runs')
    assert.strictEqual(full.ran.length, 12)
    assert.deepStrictEqual(staticPart.ran, [], 'static runs no test file')
    const labels = (r) => [...new Set(r.steps.map((l) => l.replace(/ \(some tests read dist\)$/, '').replace(/^- frontend: digest of dist.*$/, '')).filter(Boolean))].sort()
    assert.deepStrictEqual([...new Set([...labels(staticPart), ...labels(tests)])].sort(), labels(full), 'static + tests = gates, by logged step')
  } finally {
    for (const r of runs) fs.rmSync(r.records, { recursive: true, force: true })
    fs.rmSync(repo.dir, { recursive: true, force: true })
  }
})

check('every shard reports the same app digest although the build stamps a clock value, and the digest follows the commit', () => {
  const repo = makeRepo(8)
  const runs = []
  try {
    const a = [1, 2, 3, 4].map((i) => runShard(repo, i, 4))
    const b = runShard(repo, 1, 4)
    runs.push(...a, b)
    for (const r of runs) assert.strictEqual(r.status, 0, r.out.slice(-800))
    const digests = new Set(runs.map((r) => r.manifest.dist_sha256))
    assert.strictEqual(digests.size, 1, `five builds, ${digests.size} digests`)
    assert.match([...digests][0], /^[0-9a-f]{64}$/)
    const other = runShard(repo, 1, 4, { BUSINESS_OS_BUILD_HASH: 'ffffffffffffffff' })
    runs.push(other)
    assert.strictEqual(other.manifest.dist_sha256, a[0].manifest.dist_sha256, 'a build id from the environment cannot change the tested app: the kit pins it to the commit')
    assert.match(fs.readFileSync(path.join(repo.dir, 'frontend', 'dist', 'index.html'), 'utf8'), new RegExp(shards.gateBuildHash(repo.sha)))
  } finally {
    for (const r of runs) fs.rmSync(r.records, { recursive: true, force: true })
    fs.rmSync(repo.dir, { recursive: true, force: true })
  }
})

check('a test that changes frontend/dist turns its shard red, and a build that makes no dist is no pass', () => {
  const mutator = makeRepo(2, null, { 'frontend/tests/zz-mutates-dist.test.cjs': "require('fs').appendFileSync('dist/index.html', 'changed by a test')\n" })
  const noDist = makeRepo(2)
  const runs = []
  try {
    const r = runGates(mutator, ['-Part', 'tests', '-Shard', '1/1'])
    runs.push(r)
    assert.notStrictEqual(r.status, 0)
    assert.match(r.out, /dist changed while the tests ran/)
    assert.strictEqual(r.manifest.ok, false)
    assert.strictEqual(r.manifest.dist_sha256, null)
    fs.writeFileSync(path.join(noDist.dir, 'frontend', 'build.cjs'), 'process.exit(0)\n')
    git(noDist.dir, 'commit', '-q', '-am', 'build makes no dist')
    const n = runGates({ dir: noDist.dir }, ['-Part', 'tests', '-Shard', '1/1'])
    runs.push(n)
    assert.notStrictEqual(n.status, 0)
    assert.match(n.out, /dist could not be read/)
    assert.ok(n.manifest.dist_sha256 === undefined || n.manifest.dist_sha256 === null)
  } finally {
    for (const r of runs) fs.rmSync(r.records, { recursive: true, force: true })
    fs.rmSync(mutator.dir, { recursive: true, force: true })
    fs.rmSync(noDist.dir, { recursive: true, force: true })
  }
})

check('the app digest sees every byte of every file and every path, and ignores only the build clock', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-digest-'))
  try {
    const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text) }
    const info = (extra = {}) => JSON.stringify({ revision: 'r1', hash: 'h1', builtAt: '2026-11-14T00:00:00.000Z', ...extra }, null, 2)
    put('index.html', '<html></html>')
    put('assets/a.js', 'one')
    put('assets/b.js', 'two')
    put('business-os-build.json', info())
    const base = shards.distDigest(dir)
    assert.strictEqual(base.fileCount, 4)
    assert.strictEqual(shards.distDigest(dir).digest, base.digest, 'stable')
    put('business-os-build.json', info({ builtAt: '2030-01-01T00:00:00.000Z' }))
    assert.strictEqual(shards.distDigest(dir).digest, base.digest, 'the build clock is ignored')
    for (const [what, change] of [
      ['a changed byte', () => put('assets/a.js', 'onf')],
      ['an appended byte', () => put('assets/a.js', 'one ')],
      ['a new file', () => put('assets/c.js', '')],
      ['a different build id', () => put('business-os-build.json', info({ hash: 'h2' }))],
      ['a different revision', () => put('business-os-build.json', info({ revision: 'r2' }))],
      ['an extra field in the build file', () => put('business-os-build.json', info({ more: 1 }))],
    ]) {
      change()
      assert.notStrictEqual(shards.distDigest(dir).digest, base.digest, what)
      put('assets/a.js', 'one')
      fs.rmSync(path.join(dir, 'assets', 'c.js'), { force: true })
      put('business-os-build.json', info())
    }
    assert.strictEqual(shards.distDigest(dir).digest, base.digest, 'restored')
    fs.renameSync(path.join(dir, 'assets', 'b.js'), path.join(dir, 'assets', 'bb.js'))
    assert.notStrictEqual(shards.distDigest(dir).digest, base.digest, 'a renamed file')
    fs.renameSync(path.join(dir, 'assets', 'bb.js'), path.join(dir, 'assets', 'b.js'))
    const split = shards.distDigest(dir).digest
    fs.rmSync(path.join(dir, 'assets'), { recursive: true })
    put('assets/a.jsone', '')
    put('assets/b.js', 'two')
    assert.notStrictEqual(shards.distDigest(dir).digest, split, 'bytes moved across a file boundary')
    fs.rmSync(dir, { recursive: true })
    fs.mkdirSync(dir)
    assert.throws(() => shards.distDigest(dir), /has no files/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------ D. the workflow

const gateYml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'gate.yml'), 'utf8').replace(/\r\n/g, '\n')

check('gate.yml: the matrix lists exactly shards 1..GATE_SHARDS and every shard passes -Shard i/GATE_SHARDS', () => {
  const total = Number((/^ {2}GATE_SHARDS: (\d+)$/m.exec(gateYml) || [])[1])
  assert.ok(total >= 6 && total <= 8, `GATE_SHARDS ${total}`)
  const matrix = (/^ {8}shard: \[([\d, ]+)\]$/m.exec(gateYml) || [])[1]
  assert.deepStrictEqual(matrix.split(',').map((s) => Number(s.trim())), Array.from({ length: total }, (_, i) => i + 1))
  assert.ok(/-Part tests -Shard "\$\{\{ matrix\.shard \}\}\/\$env:GATE_SHARDS"/.test(gateYml), 'the shard step passes -Part tests -Shard i/n')
  assert.ok(/--shards "\$GATE_SHARDS"/.test(gateYml), 'the verdict job counts the same shards')
})

const jobText = (name) => {
  const m = new RegExp(`^ {2}${name}:\\n((?: {4}.*\\n|\\n)+)`, 'm').exec(`${gateYml}\n`)
  assert.ok(m, `job ${name}`)
  return m[1]
}
const stepText = (job, name) => {
  const m = new RegExp(`\\n {6}- name: ${name.replace(/[()]/g, '\\$&')}\\n((?: {8}.*\\n|\\n(?= {8}))+)`).exec(`\n${job}`)
  assert.ok(m, `step ${name}`)
  return m[1]
}
const runBody = (step) => /^ {8}run: \|\n((?: {10}.*\n)+)/m.exec(step)[1].split('\n').map((l) => l.slice(10)).join('\n')

check('gate.yml: the verdict proof receives the real results of the plan, static and shard jobs, never a literal', () => {
  const step = stepText(jobText('verdict'), 'Prove every test file ran exactly once')
  assert.match(step, /^ {10}PLAN_RESULT: \$\{\{ needs\.plan\.result \}\}$/m)
  assert.match(step, /^ {10}STATIC_RESULT: \$\{\{ needs\.static\.result \}\}$/m)
  assert.match(step, /^ {10}SHARD_RESULT: \$\{\{ needs\.gate\.result \}\}$/m)
  const body = runBody(step)
  assert.ok(body.includes('--plan-result "$PLAN_RESULT" --static-result "$STATIC_RESULT" --shard-result "$SHARD_RESULT"'), body)
  assert.ok(!/--(plan|static|shard)-result\s+(success|failure)/.test(body), 'no literal job result')
  assert.strictEqual((body.match(/-result/g) || []).length, 3)
})

check('gate.yml: the first verdict step refuses every combination in which a plan, static or shard job did not succeed', () => {
  const body = runBody(stepText(jobText('verdict'), 'Every earlier job must have succeeded'))
  const bash = spawnSync('bash', ['-c', 'true'], { encoding: 'utf8' })
  if (bash.error || bash.status !== 0) {
    assert.ok(/\[ "\$PLAN_RESULT" != success \] \|\| \[ "\$STATIC_RESULT" != success \] \|\| \[ "\$SHARD_RESULT" != success \]/.test(body), 'no bash here: pinned statically')
    return
  }
  const run = (plan, stat, shard) => spawnSync('bash', ['-e', '-c', body], { encoding: 'utf8', env: { ...process.env, PLAN_RESULT: plan, STATIC_RESULT: stat, SHARD_RESULT: shard } }).status
  assert.strictEqual(run('success', 'success', 'success'), 0)
  for (const bad of ['failure', 'cancelled', 'skipped', '']) {
    assert.strictEqual(run(bad, 'success', 'success'), 1, `plan ${bad}`)
    assert.strictEqual(run('success', bad, 'success'), 1, `static ${bad}`)
    assert.strictEqual(run('success', 'success', bad), 1, `shard ${bad}`)
  }
})

check('gate.yml: artifacts carry the attempt, so a re-run never reuses a name; the merged log is not matched by its own collection pattern', () => {
  const uploads = [...gateYml.matchAll(/uses: actions\/upload-artifact@v4\n {8}with:\n {10}name: (.+)\n/g)].map((m) => m[1])
  assert.ok(uploads.length >= 6, uploads.join())
  for (const name of uploads) assert.match(name, /-a\$\{\{ github\.run_attempt \}\}$/, `${name} has no attempt suffix`)
  assert.strictEqual(new Set(uploads).size, uploads.length, 'every upload name is distinct')
  for (const wanted of ['gate-shard-${{ matrix.shard }}-a', 'gate-verdict-a', 'gate-records-all-a', 'gate-records-static-a', 'gate-records-shard-${{ matrix.shard }}-a', 'e2e-report-${{ matrix.project }}-a']) {
    assert.ok(uploads.some((u) => u.startsWith(wanted)), wanted)
  }
  const pattern = /pattern: (gate-records-\S+)\n/.exec(jobText('verdict'))[1]
  const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
  const concrete = (n) => n.replace('${{ matrix.shard }}', '3').replace('${{ github.run_attempt }}', '2')
  assert.ok(re.test(concrete('gate-records-static-a${{ github.run_attempt }}')) && re.test(concrete('gate-records-shard-${{ matrix.shard }}-a${{ github.run_attempt }}')))
  assert.ok(!re.test(concrete(uploads.find((u) => u.startsWith('gate-records-all-a')))), 'the merged artifact must not match the pattern that collects into it')
  assert.match(jobText('verdict'), /pattern: gate-shard-\*\n/)
})

if (!process.exitCode) console.log(`gate shards: ${passed} checks passed`)
