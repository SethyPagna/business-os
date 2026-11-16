#!/usr/bin/env node
'use strict'
// S1, audit #5 (owner 11 Nov: "the bell may be up to 5 minutes old, with an as-of time"; lifetime from getPlanLimits, never a literal): the bell's plan-lifetime sections
// (inventory, expiry, supplier credit) live notificationSectionCacheSeconds, and that is 300 s on BOTH tiers. Paid was 45 s, which re-ran the 29k-row inventory pass six times
// as often as the owner needs.
//   1. the plan table: Free and Paid are each an integer in 1..300 (never above the owner's 5 minutes), and Paid is 300, the same as Free;
//   2. the route reads it ONLY from getPlanLimits(env), once, and stamps the cache entry with that same number (no numeric literal beside it);
//   3. the real route, on each tier, serves just inside the lifetime from the cache and recomputes at it (test-notifications-summary-trim-pure.cjs, run per tier);
//   4. a hard-coded lifetime turns step 3 red on Paid (the planted 45 is what Paid used to be), and the literal pattern of step 2 fires on the literal.
// The "as of" time and "a till's own sale does not force a read" are the frontend's (frontend/tests/bellFreshness.test.ts: isSaleWritePath, bellRelevantInvalidations, the panel's as-of text); this test pins the Worker half.
// Run: node scripts/test-bell-ttl-plan-limits-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const ts = require('typescript')

const SRC = path.join(__dirname, '..', 'src')

function loadPlanTier() {
  const file = path.join(SRC, 'lib', 'planTier.ts')
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', output)(require, mod, mod.exports)
  return mod.exports
}

function runTrim(tier, mutate) {
  const env = { ...process.env, TEST_PLAN_TIER: tier }
  if (mutate) env.TEST_MUTATE_BELL_TTL = mutate
  else delete env.TEST_MUTATE_BELL_TTL
  const run = spawnSync(process.execPath, [path.join(__dirname, 'test-notifications-summary-trim-pure.cjs')], { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { status: run.status, out: `${run.stdout}\n${run.stderr}` }
}

function main() {
  // 1. the plan table
  const planTier = loadPlanTier()
  const table = planTier.PLAN_LIMITS_BY_TIER
  for (const tier of ['free', 'paid']) {
    const seconds = table[tier].notificationSectionCacheSeconds
    assert.ok(Number.isInteger(seconds) && seconds >= 1 && seconds <= 300, `${tier}: ${seconds} must be an integer in 1..300 (the owner's 5 minutes)`)
    assert.equal(planTier.getPlanLimits({ PLAN_TIER: tier }).notificationSectionCacheSeconds, seconds, `${tier}: getPlanLimits(env) answers the table`)
  }
  assert.equal(table.paid.notificationSectionCacheSeconds, 300, 'Paid is 300 s, no longer 45 s')
  assert.equal(table.free.notificationSectionCacheSeconds, 300, 'Free stays 300 s')
  console.log('PASS plan table: Free 300 s, Paid 300 s, both within the 5 minutes')

  // 2. the route reads the plan field and nothing else
  // Code only: a comment may name the field (and does, at the head of the section cache).
  const route = fs.readFileSync(path.join(SRC, 'routes', 'notifications.ts'), 'utf8').split(/\r?\n/).filter((line) => !/^\s*\/\//.test(line)).join('\n')
  const reads = route.match(/getPlanLimits\([^)]*\)\.notificationSectionCacheSeconds/g) || []
  assert.equal(reads.length, 1, 'the lifetime is read from the plan in exactly one place')
  assert.match(route, /const ttlSeconds = getPlanLimits\(c\.env\)\.notificationSectionCacheSeconds/, 'and bound to ttlSeconds')
  const literalTtl = /ttlSeconds\s*=\s*\d|max-age=\d|age < \d+ \* 1000/
  assert.doesNotMatch(route, literalTtl, 'no numeric literal stands in for the plan lifetime (entry age check, max-age header)')
  assert.match(route, /age < ttlSeconds \* 1000/, 'the age bound is the plan lifetime')
  assert.match(route, /max-age=\$\{ttlSeconds\}/, 'and so is the cache header')
  assert.ok(literalTtl.test('const ttlSeconds = 45') && literalTtl.test("'cache-control': `public, max-age=45`"), 'control: the literal pattern fires on the literal forms it forbids')
  console.log('PASS route: lifetime from getPlanLimits(env) only, used for the age check and the max-age header')

  // 3. the real route on each tier
  for (const tier of ['free', 'paid']) {
    const run = runTrim(tier)
    assert.equal(run.status, 0, `${tier}: the summary route test is green\n${run.out.slice(-1500)}`)
    assert.match(run.out, new RegExp(`measured ${tier}: bell lifetime 300 s`), `${tier}: the route measured a 300 s lifetime`)
  }
  console.log('PASS real route: Free and Paid both serve inside 300 s from the cache and recompute at it')

  // 4. mutant: a hard-coded lifetime (what Paid used to be) is caught on Paid
  const mutant = runTrim('paid', '45')
  assert.notEqual(mutant.status, 0, 'a hard-coded 45 s lifetime must turn the route test red on Paid')
  console.log('PASS mutant: a hard-coded 45 s lifetime turns the Paid route test red')
}
main()
