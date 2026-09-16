#!/usr/bin/env node
// Deploy the Worker WITH its provenance stamped into the bundle.
//
// Why this script exists: on 2026-09-03 a deploy from a clean, certified
// `main` replaced a production build that had been made from an unmerged
// branch and deleted 24 live commits. Nothing could detect it, because the
// running Worker could not say what commit it was. `wrangler deploy` on its
// own still cannot -- so `npm run deploy` goes through here instead, and the
// commit is substituted into the bundle at build time (see lib/buildStamp.ts).
//
// A DIRTY TREE IS STAMPED AS DIRTY. That is the whole point: the incident's
// production build came from a tree that no commit described, and a stamp
// that quietly named the nearest commit would have been worse than none. A
// `-dirty` suffix makes "this build matches no commit" visible in
// `GET /api/runtime/version`.
//
// Any extra arguments are passed through to wrangler, so
//   node scripts/deploy.cjs --dry-run --outdir .wrangler/dry
// stamps exactly the same way without deploying.
'use strict'

const path = require('path')
const { createHash } = require('crypto')
const { execFileSync, spawnSync } = require('child_process')

const CLOUDFLARE_DIR = path.join(__dirname, '..')

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: CLOUDFLARE_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function readRevision(readGit = git, env = process.env) {
  if (env.BUSINESS_OS_BUILD_REVISION) return env.BUSINESS_OS_BUILD_REVISION
  const head = readGit(['rev-parse', '--short=12', 'HEAD'])
  if (!head) return 'dev'
  // `--porcelain` lists tracked modifications and untracked files; only tracked
  // changes can alter the bundle, so untracked noise (QA scratch configs, the
  // self-rewriting frontend/public trio when it is untracked) is not counted.
  const dirty = readGit(['status', '--porcelain', '--untracked-files=no'])
  return dirty ? `${head}-dirty` : head
}

function computeStamp(readGit = git, env = process.env, now = () => new Date().toISOString()) {
  const revision = readRevision(readGit, env)
  const builtAt = now()
  const sourceHash = env.BUSINESS_OS_BUILD_HASH
    || createHash('sha256').update(`worker:${revision}:${builtAt}`).digest('hex').slice(0, 16)
  return { revision, sourceHash, builtAt }
}

// esbuild substitutes a define's value as raw source text, so a string has to
// arrive already quoted. JSON.stringify gives the correct escaping.
function buildDefineArgs(stamp) {
  return [
    ['__WORKER_BUILD_REVISION__', stamp.revision],
    ['__WORKER_BUILD_HASH__', stamp.sourceHash],
    ['__WORKER_BUILT_AT__', stamp.builtAt],
  ].flatMap(([key, value]) => ['--define', `${key}:${JSON.stringify(value)}`])
}

function main() {
  const stamp = computeStamp()
  const passthrough = process.argv.slice(2)
  console.log(`[deploy] revision  ${stamp.revision}`)
  console.log(`[deploy] hash      ${stamp.sourceHash}`)
  console.log(`[deploy] builtAt   ${stamp.builtAt}`)
  if (stamp.revision.endsWith('-dirty')) {
    console.warn('[deploy] WARNING: the tree has uncommitted tracked changes. This build matches NO commit.')
  }
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'with-wrangler-auth.cjs'), 'wrangler', 'deploy', ...buildDefineArgs(stamp), ...passthrough],
    { stdio: 'inherit', cwd: CLOUDFLARE_DIR },
  )
  if (result.error) {
    console.error('[deploy] failed to start wrangler:', result.error.message)
    process.exit(1)
  }
  process.exit(result.status == null ? 1 : result.status)
}

module.exports = { readRevision, computeStamp, buildDefineArgs }

if (require.main === module) main()
