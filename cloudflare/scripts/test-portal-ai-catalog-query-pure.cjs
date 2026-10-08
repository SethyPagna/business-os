// Regression: the storefront AI assistant's product query referenced
// `p.is_active` (portalVisibleProductFilter) on an UNALIASED `FROM products`,
// so every POST /api/portal/ai/chat threw "no such column: p.is_active" and
// answered 502 portal_ai_unavailable (present since cad5e3492 / 309fe194d,
// Aug 2026). Found while testing the G38 P0 AI daily budget.
//
// Drives the REAL routes/portal.ts against the migrated schema; the provider
// call is a counter. Asserts the chat succeeds and that the visibility rule
// still applies (an inactive product never reaches the provider).
// SECURITY_TEST_BASE=<sha> loads that commit's portal.ts (bb639041d FAILs).
//
// Run: node scripts/test-portal-ai-catalog-query-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createPortalHarness } = require('./harness/load_portal_auth_route.cjs')

const root = path.resolve(__dirname, '..')
const sources = process.env.SECURITY_TEST_BASE
  ? { 'routes/portal.ts': execFileSync('git', ['show', `${process.env.SECURITY_TEST_BASE}:cloudflare/src/routes/portal.ts`], { cwd: root, encoding: 'utf8' }) }
  : {}

async function main() {
  const h = createPortalHarness({ sources })
  const insert = h.raw.prepare('INSERT INTO products (name, is_active, stock_quantity, out_of_stock_threshold) VALUES (@name, @active, CASE WHEN @active=1 THEN 5 ELSE 0 END, 0)')
  insert.run({ name: 'Visible Serum', active: 1 })
  insert.run({ name: 'Retired Toner', active: 0 })
  const response = await h.request('/ai/chat', 'POST', { question: 'serum', dataUseConsent: true }, { ip: '203.0.113.5' })
  assert.equal(response.status, 200, `the assistant answers (got ${response.status} ${response.body?.code || ''})`)
  assert.equal(h.aiCalls.length, 1)
  const names = h.aiCalls[0].products.map((product) => product.name)
  assert.deepEqual(names, ['Visible Serum'], 'only visible products reach the provider')
  console.log('PASS the AI chat candidate query runs and keeps the visibility rule')
}

main().catch((error) => { process.exitCode = 1; console.log(`FAIL ${error.message}`) })
