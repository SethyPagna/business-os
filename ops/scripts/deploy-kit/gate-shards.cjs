#!/usr/bin/env node
'use strict'
// Splits the gate's test files across parallel runners and proves afterwards that
// every file ran exactly once. Used by release.cjs (-Shard i/n) and by the
// "Verdict" job of .github/workflows/gate.yml:
//
//   node gate-shards.cjs verdict --release <checkout> --manifests <dir> --shards <n>
//        --sha <40-hex> --kit-commit <40-hex> --input-ref <text> --out <file>
//        --plan-result <r> --static-result <r> --shard-result <r>
//   (r is the job result, `${{ needs.<job>.result }}` in the workflow; the verdict is written only when all three are `success`)
//
// Each shard builds the app (some safety tests read the built files) and records a digest of
// frontend/dist in its manifest. The verdict requires every shard to agree on that digest and
// carries it, so Deploy can prove the app it publishes is byte for byte the app the tests saw.

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const lib = require('./lib.cjs')

const MANIFEST_NAME = 'gate-shard-manifest.json'
const MANIFEST_VERSION = 2
const VERDICT_VERSION = 2
const FULL_SHA = /^[0-9a-f]{40}$/
const DIGEST = /^[0-9a-f]{64}$/
const BUILD_INFO_FILE = 'business-os-build.json'

// vite.config.ts stamps every build with a clock value (Date.now() in the build id, new Date() in
// business-os-build.json), so two builds of one commit never match byte for byte. The gate and Deploy
// builds therefore pin the build id to the commit (gateBuildHash) and the digest ignores the one clock
// field left (builtAt). Every other byte of every file counts.
function gateBuildHash(sha) {
  return crypto.createHash('sha256').update(`business-os-gate-build:${sha}`).digest('hex').slice(0, 16)
}

function digestBytes(rel, bytes) {
  if (rel !== BUILD_INFO_FILE) return bytes
  const info = JSON.parse(bytes.toString('utf8'))
  delete info.builtAt
  return Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(info).sort(([a], [b]) => (a < b ? -1 : 1)))), 'utf8')
}

function distDigest(dir) {
  const files = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile()) files.push(path.relative(dir, p).split(path.sep).join('/'))
      else throw new Error(`${p} is not a regular file`)
    }
  }
  walk(dir)
  if (!files.length) throw new Error(`${dir} has no files`)
  const hash = crypto.createHash('sha256')
  for (const rel of files.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
    const bytes = digestBytes(rel, fs.readFileSync(path.join(dir, rel)))
    hash.update(`${rel}\0${bytes.length}\0`)
    hash.update(bytes)
  }
  return { digest: hash.digest('hex'), fileCount: files.length }
}

function shardIndexOf(file, count) {
  const head = crypto.createHash('sha256').update(file).digest().readUInt32BE(0)
  return (head % count) + 1
}

function parseShard(text) {
  const m = /^([1-9][0-9]*)\/([1-9][0-9]*)$/.exec(String(text))
  if (!m || Number(m[1]) > Number(m[2])) throw new Error(`-Shard must look like 3/8 (shard 3 of 8), not ${text}`)
  return { index: Number(m[1]), count: Number(m[2]) }
}

function selectShard(files, index, count) {
  return [...files].sort().filter((f) => shardIndexOf(f, count) === index)
}

function splitFiles(files, count) {
  return Array.from({ length: count }, (_, i) => selectShard(files, i + 1, count))
}

function filesDigest(files) {
  return crypto.createHash('sha256').update([...files].sort().join('\n')).digest('hex')
}

function listGateFiles(cwd, ref) {
  const out = []
  for (const spec of Object.values(lib.GATE_TEST_FILES)) {
    const text = execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '--', spec.dir], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    out.push(...text.split(/\r?\n/).filter((f) => spec.re.test(f)))
  }
  return out.sort()
}

function buildManifest({ sha, shard, files, red, attempt, dist }) {
  return {
    version: MANIFEST_VERSION,
    sha,
    shard: shard.index,
    shards: shard.count,
    attempt,
    files: [...files].sort(),
    red: [...red].sort(),
    ok: red.length === 0,
    dist_sha256: dist,
  }
}

function sameList(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

// A re-run of the whole workflow leaves the earlier attempt's manifests next to the new ones: per shard
// the latest attempt counts. Two manifests of one shard from the same attempt are still refused.
function latestPerShard(manifests) {
  const best = new Map()
  const twice = new Set()
  for (const m of manifests) {
    const held = best.get(m.shard)
    if (!held || m.attempt > held.attempt) {
      best.set(m.shard, m)
      twice.delete(m.shard)
    } else if (m.attempt === held.attempt) twice.add(m.shard)
  }
  return { latest: [...best.values()], twice }
}

function wellFormed(m) {
  return !!m && m.version === MANIFEST_VERSION && Array.isArray(m.files) && Array.isArray(m.red) && Number.isInteger(m.attempt) && m.attempt >= 1
}

function checkManifests({ manifests, shards, sha, fullFiles, maxAttempt }) {
  const problems = []
  const usable = []
  for (const m of manifests) {
    if (!wellFormed(m)) { problems.push('a shard manifest is malformed'); continue }
    if (!Number.isInteger(m.shard) || m.shard < 1 || m.shard > shards) { problems.push(`a manifest names shard ${m.shard}, outside 1..${shards}`); continue }
    usable.push(m)
  }
  const { latest, twice } = latestPerShard(usable)
  for (const n of twice) problems.push(`shard ${n} reported twice`)
  const seen = new Map(latest.map((m) => [m.shard, m]))
  for (const m of latest) {
    if (m.shards !== shards) problems.push(`shard ${m.shard} was split for ${m.shards} shards, expected ${shards}`)
    if (maxAttempt && m.attempt > maxAttempt) problems.push(`shard ${m.shard} is from attempt ${m.attempt}, later than this run's attempt ${maxAttempt}`)
    if (m.sha !== sha) problems.push(`shard ${m.shard} tested ${m.sha}, expected ${sha}`)
    if (m.ok !== true || m.red.length) problems.push(`shard ${m.shard} reported red files`)
    if (!sameList(m.files, selectShard(fullFiles, m.shard, shards))) problems.push(`shard ${m.shard} ran a different file list than its split`)
    if (!DIGEST.test(String(m.dist_sha256))) problems.push(`shard ${m.shard} did not report a digest of the app it tested`)
  }
  for (let i = 1; i <= shards; i += 1) if (!seen.has(i)) problems.push(`shard ${i} never reported`)
  const digests = new Set(latest.map((m) => m.dist_sha256))
  if (digests.size > 1) problems.push(`the shards tested different builds of the app (${digests.size} different digests of frontend/dist)`)
  const ran = latest.flatMap((m) => m.files).sort()
  if (!sameList(ran, [...fullFiles].sort())) problems.push('the union of the shards is not the full test file list')
  if (new Set(ran).size !== ran.length) problems.push('a test file ran in more than one shard')
  return problems
}

function testedDist(manifests) {
  const digests = new Set(latestPerShard(manifests.filter(wellFormed)).latest.map((m) => m.dist_sha256))
  return digests.size === 1 ? [...digests][0] : null
}

function buildVerdict({ sha, kitCommit, repository, runId, runAttempt, inputRef, shards, files, dist }) {
  return {
    version: VERDICT_VERSION,
    result: 'pass',
    sha,
    kit_commit: kitCommit,
    repository,
    run_id: String(runId),
    run_attempt: Number(runAttempt),
    input_ref: inputRef,
    shards,
    file_count: files.length,
    files_digest: filesDigest(files),
    dist_sha256: dist,
    created_at: new Date().toISOString(),
  }
}

function readManifests(dir) {
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name === MANIFEST_NAME) out.push(JSON.parse(fs.readFileSync(p, 'utf8')))
    }
  }
  walk(dir)
  return out
}

function cliArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const m = /^--([a-z-]+)$/.exec(argv[i])
    if (!m) throw new Error(`Unexpected argument ${argv[i]}`)
    out[m[1]] = argv[i + 1]
    i += 1
  }
  return out
}

function runVerdict(a) {
  const problems = []
  for (const key of ['plan-result', 'static-result', 'shard-result']) {
    if (a[key] !== 'success') problems.push(`${key.replace('-result', '')} job result was ${a[key] || 'missing'}, not success`)
  }
  const shards = Number(a.shards)
  if (!Number.isInteger(shards) || shards < 1) throw new Error('--shards must be a positive integer')
  if (!FULL_SHA.test(a.sha || '')) throw new Error('--sha must be a full 40-hex commit id')
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: a.release, encoding: 'utf8' }).trim()
  if (head !== a.sha) problems.push(`the checkout is at ${head}, expected ${a.sha}`)
  const fullFiles = listGateFiles(a.release, a.sha)
  if (!fullFiles.length) problems.push('no test files found at the commit')
  const manifests = readManifests(a.manifests)
  problems.push(...checkManifests({ manifests, shards, sha: a.sha, fullFiles, maxAttempt: Number(process.env.GITHUB_RUN_ATTEMPT) }))
  if (problems.length) {
    for (const p of problems) process.stdout.write(`::error::${p}\n`)
    return 1
  }
  const verdict = buildVerdict({
    sha: a.sha,
    kitCommit: a['kit-commit'],
    repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    inputRef: a['input-ref'],
    shards,
    files: fullFiles,
    dist: testedDist(manifests),
  })
  fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true })
  fs.writeFileSync(a.out, `${JSON.stringify(verdict, null, 2)}\n`)
  process.stdout.write(`Every one of ${fullFiles.length} test files ran exactly once across ${shards} shards at ${a.sha}, on the app with digest ${verdict.dist_sha256}.\n`)
  return 0
}

function main(argv) {
  const [command, ...rest] = argv
  if (command === 'verdict') return runVerdict(cliArgs(rest))
  throw new Error('Usage: gate-shards.cjs verdict --release <dir> --manifests <dir> --shards <n> --sha <sha> --kit-commit <sha> --input-ref <ref> --out <file> --plan-result <r> --static-result <r> --shard-result <r>')
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)) } catch (err) { process.stdout.write(`::error::${err.message}\n`); process.exitCode = 1 }
}

module.exports = {
  MANIFEST_NAME, MANIFEST_VERSION, VERDICT_VERSION, FULL_SHA, DIGEST, BUILD_INFO_FILE,
  shardIndexOf, parseShard, selectShard, splitFiles, filesDigest, listGateFiles,
  gateBuildHash, distDigest, buildManifest, checkManifests, testedDist, buildVerdict, readManifests,
}
