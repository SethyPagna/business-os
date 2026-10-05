// G38 P0 (design S8): daily spending cap on the storefront AI assistant.
//
// POST /api/portal/ai/chat had only a 20-per-minute window, so one script
// could make paid provider calls all day. It now counts chats per business
// day (UTC+7) per visitor network and for the whole storefront, refuses with
// 429 portal_ai_budget_exhausted BEFORE the provider is called, and resets at
// the shop's midnight. Defaults follow the plan tier (Free is smaller);
// PORTAL_AI_DAILY_MAX / PORTAL_AI_VISITOR_DAILY_MAX override them.
//
// Drives the REAL routes/portal.ts with real rate-limit rows in SQLite; the
// provider call is a counter (harness/load_portal_auth_route.cjs), so nothing
// leaves the machine. Wrong-implementation control: a mutant whose storefront
// counter ignores the business date never resets and must fail the reset
// check. SECURITY_TEST_BASE=<sha> loads that commit's portal.ts (bb639041d
// must report FAIL).
//
// Run: node scripts/test-portal-ai-daily-budget-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createPortalHarness } = require('./harness/load_portal_auth_route.cjs')

const root = path.resolve(__dirname, '..')
const PORTAL_REL = 'routes/portal.ts'
const currentPortal = fs.readFileSync(path.join(root, 'src', PORTAL_REL), 'utf8')
const portalSource = process.env.SECURITY_TEST_BASE
  ? execFileSync('git', ['show', `${process.env.SECURITY_TEST_BASE}:cloudflare/src/routes/portal.ts`], { cwd: root, encoding: 'utf8' })
  : currentPortal

// 2026-10-05 23:50 in Phnom Penh (16:50 UTC); +20 min is the next business day.
const LATE_EVENING = Date.UTC(2026, 9, 5, 16, 50)
const NEXT_MORNING = LATE_EVENING + 20 * 60 * 1000
const realNow = Date.now
let clock = LATE_EVENING
Date.now = () => clock

let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { process.exitCode = 1; console.log(`FAIL ${name}: ${error.message}`) }
}

const ask = (h, ip) => h.request('/ai/chat', 'POST', { question: 'serum for dry skin', dataUseConsent: true }, { ip })

function harness(env, source = portalSource) {
  return createPortalHarness({ env, sources: { [PORTAL_REL]: source } })
}

async function capsAndResets(source) {
  clock = LATE_EVENING
  const h = harness({ PORTAL_AI_DAILY_MAX: '3', PORTAL_AI_VISITOR_DAILY_MAX: '2' }, source)
  assert.equal((await ask(h, '203.0.113.1')).status, 200)
  assert.equal((await ask(h, '203.0.113.1')).status, 200)
  const visitorOver = await ask(h, '203.0.113.1')
  assert.equal(visitorOver.status, 429, 'the third chat from one visitor network today is refused')
  assert.equal(visitorOver.body.code, 'portal_ai_budget_exhausted')
  assert.equal(Number(visitorOver.headers.get('Retry-After')), 10 * 60, 'Retry-After points at the shop\'s midnight')
  assert.equal((await ask(h, '203.0.113.2')).status, 200, 'another visitor still has the storefront\'s third chat')
  const storeOver = await ask(h, '203.0.113.3')
  assert.equal(storeOver.status, 429, 'the storefront cap holds for a fresh visitor')
  assert.equal(storeOver.body.code, 'portal_ai_budget_exhausted')
  assert.equal(h.aiCalls.length, 3, 'a refused chat never reaches the AI provider')

  clock = NEXT_MORNING
  assert.equal((await ask(h, '203.0.113.1')).status, 200, 'both counters reset at the business day')
  assert.equal(h.aiCalls.length, 4)
}

async function main() {
  try {
    await check('per-visitor and storefront daily caps refuse before the provider, and reset at the business day', () => capsAndResets(portalSource))

    await check('a refused storefront chat does not spend the visitor\'s own allowance', async () => {
      clock = LATE_EVENING
      const h = harness({ PORTAL_AI_DAILY_MAX: '1', PORTAL_AI_VISITOR_DAILY_MAX: '2' })
      assert.equal((await ask(h, '198.51.100.1')).status, 200)
      for (let i = 0; i < 3; i++) assert.equal((await ask(h, '198.51.100.2')).status, 429)
      const rows = h.raw.prepare("SELECT COUNT(*) AS n FROM rate_limit_events WHERE bucket = 'portal:ai_chat:visitor-day'").get({})
      assert.equal(Number(rows.n), 1, 'only the admitted chat holds a visitor slot')
    })

    await check('defaults follow the plan tier: Free gets the smaller allowance', async () => {
      const free = harness({ PLAN_TIER: 'free' }).portal.portalAiDailyBudget({ PLAN_TIER: 'free' })
      const paid = harness({ PLAN_TIER: 'paid' }).portal.portalAiDailyBudget({ PLAN_TIER: 'paid' })
      assert.deepEqual(free, { daily: 100, perVisitor: 10 })
      assert.deepEqual(paid, { daily: 300, perVisitor: 30 })
    })

    await check('overrides must be positive integers; anything else keeps the tier default', async () => {
      const budget = harness({ PLAN_TIER: 'free' }).portal.portalAiDailyBudget
      assert.deepEqual(budget({ PLAN_TIER: 'free', PORTAL_AI_DAILY_MAX: '40', PORTAL_AI_VISITOR_DAILY_MAX: '4' }), { daily: 40, perVisitor: 4 })
      for (const bad of ['0', '-5', '2.5', 'lots', '', '999999999']) {
        assert.deepEqual(budget({ PLAN_TIER: 'free', PORTAL_AI_DAILY_MAX: bad, PORTAL_AI_VISITOR_DAILY_MAX: bad }), { daily: 100, perVisitor: 10 }, `override ${JSON.stringify(bad)}`)
      }
    })

    await check('control: a storefront counter that ignores the business date fails the reset check', async () => {
      const needle = "checkRateLimit(env, 'portal:ai_chat:day', day, daily"
      assert.ok(currentPortal.includes(needle), 'mutant injection point not found')
      const mutant = currentPortal.replace(needle, "checkRateLimit(env, 'portal:ai_chat:day', 'all', daily")
        .replace('const PORTAL_AI_DAY_WINDOW_MS = 26 * 60 * 60 * 1000', 'const PORTAL_AI_DAY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000')
      await assert.rejects(capsAndResets(mutant), /reset at the business day/)
    })
  } finally {
    Date.now = realNow
  }
  console.log(`\n${passed} passed${process.exitCode ? ', FAILURES above' : ''}`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
