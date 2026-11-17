const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
// The storefront AI assistant's coarse stock_status must follow the SAME rule as the cards beside it (owner, 16 Nov 2026, "Website's own levels"):
// the Website Editor's customer_portal_* levels when set, else the shop's low-stock setting -- never a fixed 10.
//
// The wiring under test: routes/portal.ts loadPortalAiCatalog maps each row's out_of_stock_threshold / low_stock_threshold to the EFFECTIVE levels
// (resolvePortalStockRule) before lib/portalAi.ts derives the status. Before this file nothing failed when that mapping was deleted (the AI path
// then fell back to the product column and a literal 10 in deriveStockStatus). This runs the REAL routes/portal.ts and the REAL lib/portalAi.ts
// selectCandidateProducts (the function that stamps stock_status on each candidate), over website rows x shop rows x products:
//   * through the exported loadPortalAiCatalog (the matrix), and
//   * through POST /ai/chat (the call-site wiring: the rule must come from the request's own settings read).
// (That no quantity or threshold reaches the model is pinned by test-portal-ai-scoring-pure.cjs and the card-compliance test.)
//
// Mutants: delete the mapping in loadPortalAiCatalog; ignore the website levels; ignore the shop fallback; a literal 10.
//
// Run from the cloudflare directory: node scripts/test-portal-ai-stock-status-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const { createPortalHarness } = require('./harness/load_portal_auth_route.cjs')

// The real lib/portalAi.ts (only its pure selector is used) next to the real portal route, with generatePortalAiResponse as a capture.
const realAi = createPortalHarness().load('lib/portalAi.ts')
const { selectCandidateProducts } = realAi
assert.equal(typeof selectCandidateProducts, 'function')

function websiteLevel(raw) {
  if (raw === undefined || raw === null) return null
  const text = String(raw).trim()
  if (text === '') return null
  const n = Number(text)
  return Number.isFinite(n) && n >= 0 ? n : null
}
// Independent oracle: website level when the editor is in 'global' mode and the level is set, else the shop's low-stock setting.
function shopLow(shop, productLow) {
  if (String(shop.low_stock_alert_enabled ?? '').trim().toLowerCase() !== '' && ['0', 'false', 'off', 'no'].includes(String(shop.low_stock_alert_enabled).trim().toLowerCase())) return -1
  const t = shop.low_stock_threshold_default
  const text = String(t ?? '').trim()
  const global = /^\d+$/.test(text) && Number(text) <= 1000000 ? Number(text) : 10
  if (String(shop.low_stock_threshold_mode ?? '').trim().toLowerCase() === 'global') return global
  const own = String(productLow ?? '').trim() === '' ? NaN : Number(productLow)
  return Number.isFinite(own) ? own : global
}
function oracle(settings, qty, low, out) {
  const useWebsite = settings.customer_portal_stock_threshold_mode === 'global'
  const webLow = useWebsite ? websiteLevel(settings.customer_portal_low_stock_threshold) : null
  const webOut = useWebsite ? websiteLevel(settings.customer_portal_out_of_stock_threshold) : null
  const productOut = Number(out)
  const outLevel = webOut !== null ? webOut : (Number.isFinite(productOut) ? productOut : 0)
  if (qty <= outLevel) return 'out_of_stock'
  const lowLevel = webLow !== null ? webLow : shopLow(settings, low)
  return qty <= lowLevel ? 'low_stock' : 'in_stock'
}

// 17 products (the prompt takes up to 18), each with its own override, out threshold and quantity.
const SPEC = [
  [null, null, 0], [null, null, 4], [null, null, 5], [null, null, 10], [null, null, 11],
  [3, 0, 3], [3, 0, 4], [10, 0, 10], [10, 0, 11], [0, 0, 0], [0, 0, 1],
  [10, 5, 5], [10, 5, 6], [2, 8, 7], [null, 2, 2], [null, 2, 3], [25, 0, 20],
]

const G = (low, out) => ({ customer_portal_stock_threshold_mode: 'global', customer_portal_low_stock_threshold: low, customer_portal_out_of_stock_threshold: out })
const COMBOS = [
  {},
  { low_stock_threshold_mode: 'global', low_stock_threshold_default: '3' },
  { low_stock_alert_enabled: 'false' },
  { low_stock_threshold_mode: 'global', low_stock_threshold_default: '25' },
  G('5', '2'),
  { ...G('5', '2'), low_stock_threshold_mode: 'global', low_stock_threshold_default: '25' },
  { ...G('5', '2'), low_stock_alert_enabled: 'false' },
  { ...G('', ''), low_stock_threshold_mode: 'global', low_stock_threshold_default: '3' },
  { ...G('', '3'), low_stock_threshold_mode: 'global', low_stock_threshold_default: '25' },
  { ...G('25', ''), low_stock_alert_enabled: 'false' },
  G('0', '0'),
  G('abc', 'abc'),
  { ...G('-4', '-1'), low_stock_threshold_mode: 'global', low_stock_threshold_default: '3' },
  { ...G('7', '1'), customer_portal_stock_threshold_mode: 'product' },
  { ...G('7', '1'), customer_portal_stock_threshold_mode: 'Global' },
]

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

// One migrated database for the whole file (building one per case costs seconds); each case rewrites the six rule rows.
const h = createPortalHarness({ settings: { customer_portal_ai_enabled: 'true' } })
{
  const insert = h.raw.prepare(`INSERT INTO products (name, brand, category, unit, description, is_active, stock_quantity, low_stock_threshold, out_of_stock_threshold)
    VALUES (@name, 'B', 'Care', 'pcs', 'fixture', 1, @qty, @low, @out)`)
  seedStockFixture(h.raw.db, () => {
    SPEC.forEach(([low, out, qty], index) => insert.run({ name: `Fixture ${index}`, qty, low, out }))
  })
}
const RULE_KEYS = ['low_stock_alert_enabled', 'low_stock_threshold_mode', 'low_stock_threshold_default', 'customer_portal_stock_threshold_mode', 'customer_portal_low_stock_threshold', 'customer_portal_out_of_stock_threshold']
function build(settings) {
  h.raw.db.exec(`DELETE FROM settings WHERE key IN (${RULE_KEYS.map((k) => `'${k}'`).join(',')})`)
  const put = h.raw.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
  for (const [key, value] of Object.entries(settings)) put.run([key, value === null ? null : String(value)])
  return h
}
const byName = (list) => Object.fromEntries(list.map((c) => [c.name, c.stock_status]))

async function main() {
  await check('loadPortalAiCatalog + the real candidate selector stamp the storefront rule on every product, for every settings combination', async () => {
    const seen = new Set()
    for (const settings of COMBOS) {
      build(settings)
      const rule = h.portal.resolvePortalStockRule(settings)
      const rows = await h.portal.loadPortalAiCatalog(h.env, true, rule)
      assert.equal(rows.length, SPEC.length)
      const got = byName(selectCandidateProducts(rows, {}, 'fixture'))
      assert.equal(Object.keys(got).length, SPEC.length, 'every product is a candidate')
      SPEC.forEach(([low, out, qty], index) => {
        const want = oracle(settings, qty, low, out)
        assert.equal(got[`Fixture ${index}`], want, `settings ${JSON.stringify(settings)}: Fixture ${index} qty=${qty} low=${low} out=${out}`)
        seen.add(want)
      })
    }
    assert.deepEqual([...seen].sort(), ['in_stock', 'low_stock', 'out_of_stock'], 'the matrix reaches all three labels')
  })

  await check('POST /ai/chat resolves the rule from the request settings (the call-site wiring)', async () => {
    for (const [index, settings] of [G('5', '2'), { low_stock_threshold_mode: 'global', low_stock_threshold_default: '3' }, { low_stock_alert_enabled: 'false' }, {}].entries()) {
      build(settings)
      const res = await h.request('/ai/chat', 'POST', { question: 'fixture', dataUseConsent: true }, { ip: `203.0.113.${20 + index}` })
      assert.equal(res.status, 200, `the assistant answers (${res.status} ${res.body && res.body.code})`)
      assert.equal(h.aiCalls.length, index + 1)
      const sent = h.aiCalls[index].products
      const got = byName(selectCandidateProducts(sent, {}, 'fixture'))
      SPEC.forEach(([low, out, qty], i) => {
        assert.equal(got[`Fixture ${i}`], oracle(settings, qty, low, out), `route, settings ${JSON.stringify(settings)}: Fixture ${i}`)
      })
    }
  })

  await check('CONTROL: the effective levels differ from the shop default, so deleting the mapping is visible', async () => {
    // Fixture 6: product low 3, qty 4. The shop rule says in_stock; the website's low 5 says low_stock.
    const settings = G('5', '2')
    const h = build(settings)
    const raw = byName(selectCandidateProducts(await h.portal.loadPortalAiCatalog(h.env, true, h.portal.DEFAULT_PORTAL_STOCK_RULE), {}, 'fixture'))
    const mapped = byName(selectCandidateProducts(await h.portal.loadPortalAiCatalog(h.env, true, h.portal.resolvePortalStockRule(settings)), {}, 'fixture'))
    assert.equal(raw['Fixture 6'], 'in_stock')
    assert.equal(mapped['Fixture 6'], 'low_stock')
  })

  console.log(`\n${passed} check(s) passed.`)
}

main().catch((error) => { console.error(error); process.exit(1) })
