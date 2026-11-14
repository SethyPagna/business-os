#!/usr/bin/env node
'use strict'
// Splits the gate's test files across parallel runners and proves afterwards that
// every file ran exactly once. Used by release.cjs (-Shard i/n) and by the
// "Verdict" job of .github/workflows/gate.yml:
//
//   node gate-shards.cjs verdict --release <checkout> --manifests <dir> --shards <n>
//        --sha <40-hex> --kit-commit <40-hex> --input-ref <text> --out <file>
//        --plan-result <r> --static-result <r> --shard-result <r>
//   (r is the job result; the verdict is written only when all three are `success`)

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const lib = require('./lib.cjs')

const MANIFEST_NAME = 'gate-shard-manifest.json'
const MANIFEST_VERSION = 1
const VERDICT_VERSION = 1
const FULL_SHA = /^[0-9a-f]{40}$/

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

function buildManifest({ sha, shard, files, red }) {
  return {
    version: MANIFEST_VERSION,
    sha,
    shard: shard.index,
    shards: shard.count,
    files: [...files].sort(),
    red: [...red].sort(),
    ok: red.length === 0,
  }
}

function sameList(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

function checkManifests({ manifests, shards, sha, fullFiles }) {
  const problems = []
  const seen = new Map()
  for (const m of manifests) {
    if (!m || m.version !== MANIFEST_VERSION || !Array.isArray(m.files) || !Array.isArray(m.red)) { problems.push('a shard manifest is malformed'); continue }
    if (m.shards !== shards) problems.push(`shard ${m.shard} was split for ${m.shards} shards, expected ${shards}`)
    if (!Number.isInteger(m.shard) || m.shard < 1 || m.shard > shards) { problems.push(`a manifest names shard ${m.shard}, outside 1..${shards}`); continue }
    if (seen.has(m.shard)) problems.push(`shard ${m.shard} reported twice`)
    seen.set(m.shard, m)
    if (m.sha !== sha) problems.push(`shard ${m.shard} tested ${m.sha}, expected ${sha}`)
    if (m.ok !== true || m.red.length) problems.push(`shard ${m.shard} reported red files`)
    if (!sameList(m.files, selectShard(fullFiles, m.shard, shards))) problems.push(`shard ${m.shard} ran a different file list than its split`)
  }
  for (let i = 1; i <= shards; i += 1) if (!seen.has(i)) problems.push(`shard ${i} never reported`)
  const ran = [...seen.values()].flatMap((m) => m.files).sort()
  if (!sameList(ran, [...fullFiles].sort())) problems.push('the union of the shards is not the full test file list')
  if (new Set(ran).size !== ran.length) problems.push('a test file ran in more than one shard')
  return problems
}

function buildVerdict({ sha, kitCommit, repository, runId, runAttempt, inputRef, shards, files }) {
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
  problems.push(...checkManifests({ manifests: readManifests(a.manifests), shards, sha: a.sha, fullFiles }))
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
  })
  fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true })
  fs.writeFileSync(a.out, `${JSON.stringify(verdict, null, 2)}\n`)
  process.stdout.write(`Every one of ${fullFiles.length} test files ran exactly once across ${shards} shards at ${a.sha}.\n`)
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
  MANIFEST_NAME, MANIFEST_VERSION, VERDICT_VERSION, FULL_SHA,
  shardIndexOf, parseShard, selectShard, splitFiles, filesDigest, listGateFiles,
  buildManifest, checkManifests, buildVerdict, readManifests,
}
