#!/usr/bin/env node
'use strict'
// Decides whether Deploy may reuse a finished Gate run instead of running the
// whole test sweep again. Used by .github/workflows/deploy.yml when `gate_run_id`
// is given:
//
//   node gate-reuse.cjs collect --repo <owner/name> --run-id <id> --deploy-ref <sha>
//        --release <checkout> --kit <checkout> --out <file>
//   (the workflow then downloads the run's `gate-verdict` artifact)
//   node gate-reuse.cjs decide --collected <file> --verdict <file>
//   node gate-reuse.cjs evidence --collected <file> --verdict <file> --out <dir>
//   (evidence runs after `decide` succeeded: it keeps both files with the release records)
//
// Every fact except the verdict file comes from the GitHub API, which a gate run
// cannot write to. The verdict only adds what the API does not carry (the tested
// commit) and is cross-checked against the API on every field it repeats.

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const shards = require('./gate-shards.cjs')

const GATE_WORKFLOW_PATH = '.github/workflows/gate.yml'
const KIT_DIR = 'ops/scripts/deploy-kit'
const VERDICT_ARTIFACT = 'gate-verdict'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MIN_BROWSER_LEGS = 3
const SHARD_JOB = /^Safety tests \(shard ([1-9][0-9]*) of ([1-9][0-9]*)\)$/
const REQUIRED_JOBS = ['Plan', 'Static checks', 'Verdict']

const stripRef = (p) => String(p || '').replace(/@.*$/, '')

function kitCompatible({ kitCommit, gateHeadSha, localEntries, remoteEntries }) {
  if (gateHeadSha === kitCommit) return { ok: true, why: 'same kit commit' }
  const local = JSON.stringify(localEntries || null)
  const remote = JSON.stringify(remoteEntries || null)
  if (localEntries && Object.keys(localEntries).length && local === remote) {
    return { ok: true, why: 'the gate workflow and every file under the deploy kit are byte-identical at both commits' }
  }
  return { ok: false, why: `the gate ran with release kit ${gateHeadSha}, this deploy uses ${kitCommit}, and the gate workflow or deploy kit files differ between them` }
}

function evaluate(input) {
  const { deployRef, localHead, repository, run, jobs, artifacts, kit, localFiles, now, verdict, verdictOptional } = input
  const maxAge = input.maxAgeMs || MAX_AGE_MS
  const problems = []
  const bad = (msg) => problems.push(msg)

  if (!shards.FULL_SHA.test(String(deployRef || ''))) {
    bad(`the deploy ref must be a full 40-character commit id when a gate run is reused, not "${deployRef}" (a branch name can move after the gate ran)`)
  } else if (localHead !== deployRef) {
    bad(`the checked-out commit ${localHead} is not the deploy ref ${deployRef}`)
  }

  if (!run || typeof run !== 'object') return [...problems, 'the gate run could not be read']

  if (run.repository && run.repository.full_name !== repository) bad(`the run belongs to ${run.repository.full_name}, not ${repository}`)
  if (!run.head_repository || run.head_repository.full_name !== repository) bad('the run was started from a fork or an unknown repository')
  if (stripRef(run.path) !== GATE_WORKFLOW_PATH) bad(`the run is workflow "${run.path}", not ${GATE_WORKFLOW_PATH}`)
  if (run.event !== 'workflow_dispatch') bad(`the run was triggered by ${run.event}, not a manual dispatch`)
  if (run.status !== 'completed' || run.conclusion !== 'success') bad(`the run is ${run.status}/${run.conclusion}, not completed/success`)

  const finished = Date.parse(run.updated_at || '')
  if (!Number.isFinite(finished)) bad('the run has no finish time')
  else if (now - finished > maxAge) bad(`the run finished ${Math.floor((now - finished) / 86400000)} days ago; gate runs older than ${Math.floor(maxAge / 86400000)} days are not reused`)
  else if (finished - now > 5 * 60 * 1000) bad('the run finish time is in the future')

  if (!Array.isArray(jobs) || !jobs.length) bad('the run has no jobs')
  else {
    for (const j of jobs) if (j.conclusion !== 'success') bad(`job "${j.name}" concluded ${j.conclusion || j.status}, not success`)
    const names = jobs.map((j) => j.name)
    for (const need of REQUIRED_JOBS) if (!names.includes(need)) bad(`job "${need}" is missing from the run`)
    const shardJobs = names.map((n) => SHARD_JOB.exec(n)).filter(Boolean)
    const counts = new Set(shardJobs.map((m) => m[2]))
    if (!shardJobs.length) bad('the run has no test shard jobs')
    else if (counts.size !== 1 || shardJobs.length !== Number([...counts][0])) bad('the run does not have every test shard job it was split into')
    const legs = names.filter((n) => /^Browser suite \(/.test(n)).length
    if (legs < MIN_BROWSER_LEGS) bad(`only ${legs} browser suite jobs ran, expected at least ${MIN_BROWSER_LEGS}`)
    if (verdict && shardJobs.length && Number(verdict.shards) !== shardJobs.length) bad('the verdict and the run disagree on the shard count')
  }

  const art = (artifacts || []).filter((a) => a.name === VERDICT_ARTIFACT)
  if (!art.length) bad(`the run has no ${VERDICT_ARTIFACT} artifact`)
  else if (art.every((a) => a.expired)) bad(`the ${VERDICT_ARTIFACT} artifact has expired`)
  else if (!art.some((a) => !a.expired && a.workflow_run && Number(a.workflow_run.id) === Number(run.id))) bad(`the ${VERDICT_ARTIFACT} artifact does not belong to run ${run.id}`)

  const compat = kitCompatible({ kitCommit: kit && kit.commit, gateHeadSha: run.head_sha, localEntries: kit && kit.local, remoteEntries: kit && kit.remote })
  if (!compat.ok) bad(compat.why)

  if (!verdict) {
    if (!verdictOptional) bad('the verdict file is missing')
    return problems
  }

  if (verdict.version !== shards.VERDICT_VERSION) bad('the verdict has an unknown version')
  if (verdict.result !== 'pass') bad(`the verdict says ${verdict.result}`)
  if (verdict.sha !== deployRef) bad(`the gate tested ${verdict.sha}, this deploy releases ${deployRef}`)
  if (verdict.repository !== repository) bad(`the verdict is for ${verdict.repository}, not ${repository}`)
  if (String(verdict.run_id) !== String(run.id)) bad(`the verdict is from run ${verdict.run_id}, not ${run.id}`)
  if (Number(verdict.run_attempt) !== Number(run.run_attempt)) bad(`the verdict is from attempt ${verdict.run_attempt}, the run's latest attempt is ${run.run_attempt}`)
  if (verdict.kit_commit !== run.head_sha) bad('the verdict and the run disagree on the release kit commit')
  if (run.display_title !== `Gate ${verdict.input_ref}`) bad(`the run title "${run.display_title}" does not carry the input ref "${verdict.input_ref}" the verdict claims`)
  if (shards.FULL_SHA.test(String(verdict.input_ref)) && verdict.input_ref !== verdict.sha) bad('the gate was dispatched with one commit id but the verdict names another')
  if (localFiles) {
    if (verdict.file_count !== localFiles.count) bad(`the gate ran ${verdict.file_count} test files, this commit has ${localFiles.count}`)
    if (verdict.files_digest !== localFiles.digest) bad('the gate ran a different set of test files than this commit has')
  } else bad('the local test file list was not collected')
  return problems
}

async function api(repo, route, token) {
  for (let attempt = 1; ; attempt += 1) {
    const res = await fetch(`https://api.github.com/repos/${repo}${route}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'business-os-deploy' },
    })
    if (res.ok) return res.json()
    if (res.status >= 500 && attempt < 3) continue
    throw new Error(`GitHub API ${route} answered ${res.status}`)
  }
}

function localKitEntries(kitDir) {
  const map = {}
  for (const target of [KIT_DIR, GATE_WORKFLOW_PATH]) {
    const text = execFileSync('git', ['ls-tree', 'HEAD', target.endsWith('.yml') ? target : `${target}/`], { cwd: kitDir, encoding: 'utf8' })
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      const m = /^\d+ \w+ ([0-9a-f]{40})\t(.+)$/.exec(line)
      if (m) map[m[2].replace(/\/$/, '')] = m[1]
    }
  }
  return map
}

async function remoteKitEntries(repo, sha, token) {
  const map = {}
  const dir = await api(repo, `/contents/${KIT_DIR}?ref=${sha}`, token)
  for (const e of dir) map[e.path] = e.sha
  const gate = await api(repo, `/contents/${GATE_WORKFLOW_PATH}?ref=${sha}`, token)
  map[gate.path] = gate.sha
  return map
}

function cliArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    const m = /^--([a-z-]+)$/.exec(argv[i])
    if (!m || argv[i + 1] === undefined) throw new Error(`Bad argument ${argv[i]}`)
    out[m[1]] = argv[i + 1]
  }
  return out
}

function report(problems, okLine) {
  if (problems.length) {
    process.stdout.write('::error::This deploy will not reuse the gate run. Run the full sweep (leave gate_run_id empty) or start a fresh Gate run:\n')
    for (const p of problems) process.stdout.write(`::error::  - ${p}\n`)
    return 1
  }
  process.stdout.write(`${okLine}\n`)
  return 0
}

async function collect(a) {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('GITHUB_TOKEN is not set')
  if (!/^[1-9][0-9]*$/.test(a['run-id'])) throw new Error('gate_run_id must be a number')
  if (!shards.FULL_SHA.test(a['deploy-ref'])) return report([`the deploy ref must be a full 40-character commit id when a gate run is reused, not "${a['deploy-ref']}" (a branch name can move after the gate ran)`], '')
  const run = await api(a.repo, `/actions/runs/${a['run-id']}`, token)
  const jobs = []
  for (let page = 1; page <= 5; page += 1) {
    const r = await api(a.repo, `/actions/runs/${a['run-id']}/jobs?filter=latest&per_page=100&page=${page}`, token)
    jobs.push(...r.jobs)
    if (r.jobs.length < 100) break
  }
  const artifacts = (await api(a.repo, `/actions/runs/${a['run-id']}/artifacts?per_page=100`, token)).artifacts
  const kitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: a.kit, encoding: 'utf8' }).trim()
  const localHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: a.release, encoding: 'utf8' }).trim()
  const files = shards.listGateFiles(a.release, 'HEAD')
  const collected = {
    repository: a.repo,
    deployRef: a['deploy-ref'],
    localHead,
    run: { id: run.id, run_attempt: run.run_attempt, path: run.path, display_title: run.display_title, event: run.event, status: run.status, conclusion: run.conclusion, head_sha: run.head_sha, repository: run.repository && { full_name: run.repository.full_name }, head_repository: run.head_repository && { full_name: run.head_repository.full_name }, updated_at: run.updated_at },
    jobs: jobs.map((j) => ({ name: j.name, status: j.status, conclusion: j.conclusion })),
    artifacts: artifacts.map((x) => ({ name: x.name, expired: x.expired, workflow_run: x.workflow_run && { id: x.workflow_run.id } })),
    kit: { commit: kitCommit, local: localKitEntries(a.kit), remote: null },
    localFiles: { count: files.length, digest: shards.filesDigest(files) },
  }
  if (run.head_sha !== kitCommit) collected.kit.remote = await remoteKitEntries(a.repo, run.head_sha, token)
  fs.writeFileSync(a.out, `${JSON.stringify(collected, null, 2)}\n`)
  return report(evaluate({ ...collected, now: Date.now(), verdictOptional: true }), `Gate run ${run.id} passes every API check at ${collected.deployRef}; checking its verdict next.`)
}

function decide(a) {
  const collected = JSON.parse(fs.readFileSync(a.collected, 'utf8'))
  let verdict = null
  if (fs.existsSync(a.verdict)) verdict = JSON.parse(fs.readFileSync(a.verdict, 'utf8'))
  const problems = evaluate({ ...collected, now: Date.now(), verdict })
  return report(problems, `Reusing gate run ${collected.run.id}: it tested exactly ${collected.deployRef}. The full test sweep is skipped.`)
}

function evidence(a) {
  const collected = JSON.parse(fs.readFileSync(a.collected, 'utf8'))
  const verdict = JSON.parse(fs.readFileSync(a.verdict, 'utf8'))
  fs.mkdirSync(a.out, { recursive: true })
  fs.writeFileSync(path.join(a.out, 'gate-reuse.json'), `${JSON.stringify({ decidedAt: new Date().toISOString(), collected, verdict }, null, 2)}\n`)
  const lines = [
    '### Gate reused',
    '',
    `- Gate run: ${collected.run.id} (attempt ${collected.run.run_attempt}), finished ${collected.run.updated_at}`,
    `- Tested commit: \`${verdict.sha}\``,
    `- Gate release kit: \`${verdict.kit_commit}\``,
    `- Full test sweep: skipped, proven by that run (${verdict.file_count} files in ${verdict.shards} shards)`,
  ]
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`)
  process.stdout.write('Kept the gate verdict with the release records.\n')
  return 0
}

async function main(argv) {
  const [command, ...rest] = argv
  if (command === 'collect') return collect(cliArgs(rest))
  if (command === 'decide') return decide(cliArgs(rest))
  if (command === 'evidence') return evidence(cliArgs(rest))
  throw new Error('Usage: gate-reuse.cjs collect|decide|evidence ...')
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code }, (err) => { process.stdout.write(`::error::${err.message}\n`); process.exitCode = 1 })
}

module.exports = { GATE_WORKFLOW_PATH, KIT_DIR, VERDICT_ARTIFACT, MAX_AGE_MS, MIN_BROWSER_LEGS, evaluate, kitCompatible, localKitEntries }
