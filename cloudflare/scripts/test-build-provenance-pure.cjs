#!/usr/bin/env node
// Pins the deploy-provenance stamp.
//
// The 2026-09-03 incident: a deploy from a clean, certified `main` replaced a
// production build made from an unmerged branch and deleted 24 live commits.
// Nothing detected it because the running Worker could not say what commit it
// was -- runtime.ts returned `revision: ''` and `sourceHash: ''` as literals.
// These checks fail if that regresses, and if a dirty tree is ever stamped as
// though it were a commit.
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const CF = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(CF, p), 'utf8').replace(/\r\n/g, '\n')

let checks = 0
const check = (label, fn) => { fn(); checks++; process.stdout.write(`  ok  ${label}\n`) }

const deploy = require('./deploy.cjs')

// --- the stamp itself -------------------------------------------------------

check('an unstamped build reports dev, never an empty string', () => {
  const stamp = deploy.computeStamp(() => '', {}, () => '2026-01-01T00:00:00.000Z')
  assert.strictEqual(stamp.revision, 'dev')
  assert.notStrictEqual(stamp.revision, '')
  assert.ok(stamp.sourceHash && stamp.sourceHash !== 'dev', 'hash is still computed without git')
})

check('a clean tree is stamped with the bare commit', () => {
  const git = (args) => (args[0] === 'rev-parse' ? 'a486d82ef747' : '')
  const stamp = deploy.computeStamp(git, {}, () => '2026-01-01T00:00:00.000Z')
  assert.strictEqual(stamp.revision, 'a486d82ef747')
})

check('a DIRTY tree is stamped -dirty, never as a plain commit', () => {
  const git = (args) => (args[0] === 'rev-parse' ? 'a486d82ef747' : ' M cloudflare/src/index.ts')
  const stamp = deploy.computeStamp(git, {}, () => '2026-01-01T00:00:00.000Z')
  assert.strictEqual(stamp.revision, 'a486d82ef747-dirty')
})

check('untracked files alone do NOT make a build dirty', () => {
  // `--untracked-files=no` is what makes this true; the self-rewriting
  // frontend/public trio and per-session QA scratch must not flip the stamp.
  const calls = []
  const git = (args) => { calls.push(args.join(' ')); return args[0] === 'rev-parse' ? 'abc123456789' : '' }
  deploy.computeStamp(git, {}, () => '2026-01-01T00:00:00.000Z')
  assert.ok(
    calls.some((c) => c.includes('--untracked-files=no')),
    'the dirty probe must exclude untracked files',
  )
})

check('an explicit revision override wins', () => {
  const stamp = deploy.computeStamp(() => 'aaaaaaaaaaaa', { BUSINESS_OS_BUILD_REVISION: 'ci-1234' }, () => 'x')
  assert.strictEqual(stamp.revision, 'ci-1234')
})

check('define values are JSON-quoted so esbuild sees a string literal', () => {
  const args = deploy.buildDefineArgs({ revision: 'abc', sourceHash: 'def', builtAt: 'ts' })
  assert.deepStrictEqual(args, [
    '--define', '__WORKER_BUILD_REVISION__:"abc"',
    '--define', '__WORKER_BUILD_HASH__:"def"',
    '--define', '__WORKER_BUILT_AT__:"ts"',
  ])
})

// --- the wiring that made the incident invisible ----------------------------

const runtime = read('src/routes/runtime.ts')

check('runtime.ts no longer returns empty provenance literals', () => {
  assert.ok(!/revision:\s*''/.test(runtime), "runtime.ts still hard-codes revision: ''")
  assert.ok(!/sourceHash:\s*''/.test(runtime), "runtime.ts still hard-codes sourceHash: ''")
})

check('runtime.ts reports the computed stamp', () => {
  assert.ok(runtime.includes("import { getBuildStamp } from '../lib/buildStamp'"), 'buildStamp is not imported')
  assert.ok(runtime.includes('revision: stamp.revision'), 'revision is not the computed one')
  assert.ok(runtime.includes('sourceHash: stamp.sourceHash'), 'sourceHash is not the computed one')
  assert.ok(runtime.includes('builtAt: stamp.builtAt'), 'builtAt is not reported')
})

const buildStamp = read('src/lib/buildStamp.ts')

check('an un-defined build still compiles and runs', () => {
  for (const name of ['__WORKER_BUILD_REVISION__', '__WORKER_BUILD_HASH__', '__WORKER_BUILT_AT__']) {
    assert.ok(
      buildStamp.includes(`typeof ${name} !== 'undefined'`),
      `${name} is read without a typeof guard -- a build without --define would throw`,
    )
  }
})

const pkg = JSON.parse(read('package.json'))

check('npm run deploy goes through the stamping script', () => {
  assert.strictEqual(pkg.scripts.deploy, 'node scripts/deploy.cjs')
  assert.ok(
    !/wrangler deploy/.test(pkg.scripts.deploy),
    'deploy must not call wrangler directly -- that is the unstamped path',
  )
})

check('deploy:full still ends in the stamped deploy', () => {
  assert.ok(/npm run deploy(\s|$)/.test(pkg.scripts['deploy:full']), 'deploy:full lost its deploy step')
})

console.log(`\n${checks} checks passed`)
