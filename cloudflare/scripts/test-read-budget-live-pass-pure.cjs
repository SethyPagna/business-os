#!/usr/bin/env node
// The live-state pass of the read-budget gate (read-budget/budgets.cjs liveProblems, runner.cjs runLivePass; D1 audit W4): the free pass certifies Free with four
// report/expense/dashboard switches ON; production runs Paid with those OFF and ic_simple ON, and a cold dashboard open there made 65 calls without the gate noticing.
// Pure: no Miniflare. The measured runs are test-read-budget-live-a/b/c-native.cjs.
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { liveProblems, passOf, loadBudgets, FREE_CALL_LIMIT } = require('./read-budget/budgets.cjs')
const { getShapes } = require('./read-budget/shapes.cjs')
const { seedContext } = require('./read-budget/seed.cjs')

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

const pass = (known = []) => ({ tier: 'paid', switches: { ic_simple: 'on' }, cold_calls_max: 45, known_failures: known })
const dash = { id: 'dashboard-startup-today', cold_calls: 65, reason: 'the stock overview and the sales report read in many calls until report_atomic is flipped' }

async function main() {
  await check('a route within 45 cold calls is green, and 46 is red (a NEW route over the ceiling is not allowed)', () => {
    assert.deepEqual(liveProblems(pass(), 'x', 45), [])
    assert.deepEqual(liveProblems(pass(), 'x', 0), [])
    assert.equal(liveProblems(pass(), 'x', 46).length, 1)
    assert.match(liveProblems(pass(), 'x', 46)[0], /live cold calls 46 > 45/)
    assert.doesNotMatch(liveProblems(pass(), 'x', 46)[0], /Free limit/, '46 is over the audit ceiling, not yet over the Free limit')
  })

  await check('over the Free hard limit of 50 is red and says so, whatever the ceiling says', () => {
    assert.equal(FREE_CALL_LIMIT, 50)
    assert.match(liveProblems(pass(), 'x', 51)[0], /over the Free limit of 50/)
    assert.equal(liveProblems({ ...pass(), cold_calls_max: 80 }, 'x', 51).length, 1, 'a raised live ceiling never lifts the Free limit')
    assert.deepEqual(liveProblems({ ...pass(), cold_calls_max: 80 }, 'x', 50), [])
  })

  await check('a known failure may stay as it is and may not get worse', () => {
    assert.deepEqual(liveProblems(pass([dash]), dash.id, 65), [])
    assert.deepEqual(liveProblems(pass([dash]), dash.id, 60), [], 'fewer calls but still over the ceiling: fine, not yet fixed')
    assert.match(liveProblems(pass([dash]), dash.id, 66)[0], /got worse: live cold calls 66 > recorded 65/)
    assert.equal(liveProblems(pass([dash]), 'another-route', 66).length, 1, 'a known failure excuses its own shape only')
  })

  await check('a known failure that is fixed is red until it is removed, so the list only shrinks', () => {
    assert.match(liveProblems(pass([dash]), dash.id, 45)[0], /known failure is fixed .*remove it from passes.live.known_failures/)
    assert.match(liveProblems(pass([dash]), dash.id, 12)[0], /remove it/)
  })

  await check('A1: a status other than the entry records is red whatever the calls; a known failure excuses calls only', () => {
    assert.deepEqual(liveProblems(pass(), 'x', 12, 200, 200), [])
    assert.deepEqual(liveProblems(pass(), 'x', 12, 400, 200), ['live status 400, budget has 200'])
    assert.deepEqual(liveProblems(pass(), 'x', 3, 500, 200), ['live status 500, budget has 200'], 'a route forced to 500 reads few calls and used to be certified')
    assert.equal(liveProblems(pass(), 'x', 12, 200, 400).length, 1, 'a shape that the budget records as refused must still refuse')
    assert.deepEqual(liveProblems(pass(), 'x', 12, 403, 403), [], 'a recorded refusal that still refuses is green')
    assert.match(liveProblems(pass(), 'x', 12, undefined, 200)[0], /status missing/)
    assert.deepEqual(liveProblems(pass([dash]), dash.id, 65, 500, 200), ['live status 500, budget has 200'], 'a known failure does not excuse a wrong status')
    assert.deepEqual(liveProblems(pass([dash]), dash.id, 65, 200, 200), [], 'a known failure with the right status is judged on calls as before')
    assert.equal(liveProblems(pass(), 'x', 46, 200, 200).length, 1, 'calls are still judged when the status matches')
  })

  await check('A1: the live pass hands the measured status and the entry status to liveProblems', () => {
    const runner = fs.readFileSync(path.join(__dirname, 'read-budget', 'runner.cjs'), 'utf8')
    assert.match(runner, /liveProblems\(pass, shape\.id, m\.calls, m\.status, entry\.status\)/)
  })

  await check('a request that gave no call count is red, known or not (a missing header must not read as zero calls)', () => {
    assert.equal(liveProblems(pass(), 'x', NaN).length, 1)
    assert.equal(liveProblems(pass([dash]), dash.id, NaN).length, 1)
    assert.equal(liveProblems(pass(), 'x', undefined).length, 1)
  })

  await check('budgets.json carries both passes as data, and the live one is Paid with ic_simple ON and the report/expense/dashboard switches not set', () => {
    const budgets = loadBudgets()
    assert.deepEqual(Object.keys(budgets.passes).sort(), ['free', 'live'])
    const live = passOf(budgets, 'live')
    assert.equal(live.tier, 'paid')
    assert.deepEqual(live.switches, { ic_simple: 'on' })
    assert.equal(live.cold_calls_max, 45)
    assert.equal(passOf(budgets, 'free').tier, 'free')
    assert.throws(() => passOf(budgets, 'nope'), /no "nope" pass/)
  })

  await check('the live pass boots from passes.live, and the three files together measure every GET shape once', () => {
    const runner = fs.readFileSync(path.join(__dirname, 'read-budget', 'runner.cjs'), 'utf8')
    assert.match(runner, /passOf\(budgets, 'live'\)/)
    assert.match(runner, /bootWorld\(\{ tier: pass\.tier, seedTier: pass\.seedTier, switches: pass\.switches \}\)/, 'tier, seed and switches all come from the data')
    assert.match(runner, /passOf\(budgets, 'free'\)\.switches/, 'the free pass reads its switches from the data too')
    const parts = [0, 1, 2].map((i) => {
      const file = fs.readFileSync(path.join(__dirname, `test-read-budget-live-${'abc'[i]}-native.cjs`), 'utf8')
      assert.match(file, new RegExp(`runLivePass\\(\\{ partIndex: ${i},`), `live-${'abc'[i]} runs part ${i}`)
      return i
    })
    const { part } = require('./read-budget/runner.cjs')
    const ids = getShapes(seedContext()).map((s) => s.id)
    const byPart = parts.map((i) => ids.filter((id) => part(id) === i).length)
    assert.equal(byPart.reduce((a, b) => a + b, 0), ids.length, 'no shape is in two parts or none')
    assert.ok(byPart.every((n) => n > 0), `each part measures shapes: ${byPart}`)
  })

  console.log(`test-read-budget-live-pass-pure: ${passed} checks passed`)
}

main().catch((e) => { console.error(e && e.stack); process.exitCode = 1 })
