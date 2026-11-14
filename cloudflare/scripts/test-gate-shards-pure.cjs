#!/usr/bin/env node
// Offline checks for the gate shards: ops/scripts/deploy-kit/gate-shards.cjs, the
// -Part / -Shard options of release.cjs, and the shard rules of .github/workflows/gate.yml.
//
//   A. the split: every file in exactly one shard, deterministic, stable when a file is added;
//   B. the proof: the verdict refuses a missing, duplicated, red, stale or mismatched shard;
//   C. the kit: real release.cjs runs one shard of a throwaway repository and writes its manifest;
//   D. the workflow: the matrix, the shard count and the manifest upload agree.
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
const goodManifests = (count = 4, files = FULL, sha = SHA) => Array.from({ length: count }, (_, i) => shards.buildManifest({ sha, shard: { index: i + 1, count }, files: shards.selectShard(files, i + 1, count), red: [] }))
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
  m[1] = shards.buildManifest({ sha: SHA, shard: { index: 2, count: 4 }, files: m[1].files, red: ['cloudflare/scripts/test-x.cjs'] })
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
  const v = shards.buildVerdict({ sha: SHA, kitCommit: 'c'.repeat(40), repository: 'o/r', runId: 99, runAttempt: '2', inputRef: SHA, shards: 8, files: FULL })
  assert.deepStrictEqual({ ...v, created_at: 'x' }, {
    version: 1, result: 'pass', sha: SHA, kit_commit: 'c'.repeat(40), repository: 'o/r', run_id: '99', run_attempt: 2, input_ref: SHA, shards: 8, file_count: 200, files_digest: shards.filesDigest(FULL), created_at: 'x',
  })
})

// ------------------------------------------------- C. the kit on a throwaway repo

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' })
  assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

function makeRepo(fileCount, redFile) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-shards-'))
  git(dir, 'init', '-q')
  fs.mkdirSync(path.join(dir, 'cloudflare', 'scripts'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'frontend', 'tests'), { recursive: true })
  const pass = "require('fs').appendFileSync(process.env.SHARD_TRACE || require('os').devNull, process.argv[1].replace(/\\\\/g, '/').split('/').slice(-3).join('/') + '\\n')\n"
  for (let i = 0; i < fileCount; i += 1) {
    fs.writeFileSync(path.join(dir, 'cloudflare', 'scripts', `test-t${i}-pure.cjs`), pass)
    fs.writeFileSync(path.join(dir, 'frontend', 'tests', `t${i}.test.cjs`), pass)
  }
  if (redFile) fs.writeFileSync(path.join(dir, redFile), 'process.exit(1)\n')
  fs.writeFileSync(path.join(dir, 'frontend', 'package.json'), '{"name":"f","scripts":{"build":"node -e 0"}}\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'fixture')
  return { dir, sha: git(dir, 'rev-parse', 'HEAD') }
}

function runShard(repo, index, count, extra = {}) {
  const records = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-records-'))
  const trace = path.join(records, 'trace.txt')
  const r = spawnSync(process.execPath, [path.join(KIT, 'release.cjs'), 'gates', '-CI', '-ReleaseDir', repo.dir, '-Records', records, '-Part', 'tests', '-Shard', `${index}/${count}`, '-Jobs', '2', '-Retries', '1'], {
    encoding: 'utf8', env: { ...process.env, SHARD_TRACE: trace, GITHUB_STEP_SUMMARY: '', ...extra },
  })
  const manifestFile = path.join(records, shards.MANIFEST_NAME)
  return {
    status: r.status,
    out: r.stdout + r.stderr,
    records,
    manifest: fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null,
    ran: fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).sort() : [],
  }
}

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
    fs.rmSync(out)
    fs.rmSync(path.join(manifests, 's2'), { recursive: true })
    const missing = spawnSync(process.execPath, args(), { encoding: 'utf8', env })
    assert.strictEqual(missing.status, 1)
    assert.match(missing.stdout, /shard 2 never reported/)
    assert.ok(!fs.existsSync(out), 'no verdict is written for an incomplete run')
    const failedJob = spawnSync(process.execPath, args(['--static-result', 'failure']), { encoding: 'utf8', env })
    assert.strictEqual(failedJob.status, 1)
  } finally {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
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

if (!process.exitCode) console.log(`gate shards: ${passed} checks passed`)
