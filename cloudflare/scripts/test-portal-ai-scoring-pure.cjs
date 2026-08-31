// Regression tests for src/lib/portalAi.ts's product-scoring/candidate-
// selection logic (scoreProduct, selectCandidateProducts, summarizeProfile),
// the gap flagged alongside lib/backup.ts in progress.md's Big-O sweep
// writeup ("lib/backup.ts and lib/portalAi.ts both still lack a regression
// test... worth pairing the two"). backup.ts's test was added in part 46;
// this closes the other half.
//
// Same approach as the other *-pure.cjs scripts: transpile the REAL source
// and call the actual exported functions, not a re-implementation of the
// scoring logic. portalAi.ts's module-level imports (./db, ./aiGateway,
// ./rateLimit) are only used by its provider-failover/AI-request functions
// (getPortalAiUsageStatus, generatePortalAiResponse) -- untouched by this
// test, which only exercises the pure candidate-selection path -- so they're
// stubbed at require-time rather than transpiled for real, same reasoning
// as backup.ts stubbing env.DB/env.ASSETS instead of a real D1/R2.
//
// Run: node scripts/test-portal-ai-scoring-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  return { sourcePath, outputText }
}

const portalAi = transpile('lib/portalAi.ts')
const Module = require('module')
const originalLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  // Stubs -- these bindings are exercised by portalAi.ts's AI-request path
  // (generatePortalAiResponse/getPortalAiUsageStatus), not by the pure
  // scoring/candidate-selection functions this test targets, so a real DB/
  // AI-gateway/rate-limit runtime isn't needed to exercise the code under
  // test. If a future change makes scoreProduct/selectCandidateProducts/
  // summarizeProfile actually call into one of these, the corresponding
  // assertion below (or a new one) should start failing loudly rather than
  // silently no-op against a stub -- keep an eye out for that when editing
  // portalAi.ts.
  if (request === './db') return { getDb: () => ({}) }
  if (request === './aiGateway') return {
    callChatProvider: async () => ({}),
    getProviderMeta: () => null,
    // Real parse-with-fallback (not just a pass-through stub) -- this is
    // exercised for real now that parseAssistantPayload is under test
    // below, not just the scoring/candidate-selection path the stub was
    // originally written for.
    parseJsonSafe: (value, fallback) => {
      try { return JSON.parse(value) } catch (_) { return fallback }
    },
    providerCanUseWebResearch: () => false,
  }
  if (request === './rateLimit') return { checkRateLimit: async () => ({ allowed: true }) }
  return originalLoad.call(this, request, parent, isMain)
}
const portalAiModuleObj = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', portalAi.outputText)(
  portalAiModuleObj.exports, require, portalAiModuleObj, portalAi.sourcePath, path.dirname(portalAi.sourcePath),
)
Module._load = originalLoad

const { selectCandidateProducts, summarizeProfile, parseAssistantPayload } = portalAiModuleObj.exports

for (const fn of [selectCandidateProducts, summarizeProfile, parseAssistantPayload]) {
  assert.strictEqual(typeof fn, 'function', 'expected portalAi.ts export missing -- source may have changed')
}

let checks = 0
function check(label, fn) {
  fn()
  checks += 1
  console.log(`PASS ${label}`)
}

function product(overrides) {
  return {
    id: 1,
    name: 'Product',
    brand: '',
    category: '',
    description: '',
    unit: '',
    stock_quantity: 0,
    selling_price_usd: 0,
    selling_price_khr: 0,
    image_path: '',
    image_gallery: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------

check('selectCandidateProducts ranks a question-term match above a non-match', () => {
  const candidates = selectCandidateProducts(
    [
      product({ id: 1, name: 'Aloe Vera Gel', category: 'Skincare' }),
      product({ id: 2, name: 'Random Shampoo', category: 'Hair' }),
    ],
    {},
    'looking for something with aloe vera',
  )
  assert.strictEqual(candidates[0].id, 1, 'the product whose name matches the question terms should score above one that does not')
  assert.ok(candidates[0].score > candidates[1].score, 'matching product should have a strictly higher score')
})

check('selectCandidateProducts boosts an exact profile-brand match above everything else', () => {
  const candidates = selectCandidateProducts(
    [
      product({ id: 1, name: 'Brand A Serum', brand: 'Brand A' }),
      product({ id: 2, name: 'Brand B Serum', brand: 'Brand B' }),
    ],
    { brand: 'Brand A' },
    'serum',
  )
  // productMatchesPreference restricts the pool to Brand A when a preferred
  // brand is set and at least one product matches it -- Brand B should not
  // even appear as a candidate here.
  assert.strictEqual(candidates.length, 1, 'pool should be filtered down to the preferred-brand match')
  assert.strictEqual(candidates[0].id, 1)
})

check('selectCandidateProducts falls back to the full pool when no product matches the preferred brand', () => {
  const candidates = selectCandidateProducts(
    [product({ id: 1, name: 'Only Product', brand: 'Some Other Brand' })],
    { brand: 'Brand That Does Not Exist' },
    '',
  )
  assert.strictEqual(candidates.length, 1, 'should fall back to the unfiltered product list rather than returning nothing')
  assert.strictEqual(candidates[0].id, 1)
})

check('selectCandidateProducts breaks score ties alphabetically by name', () => {
  const candidates = selectCandidateProducts(
    [
      product({ id: 1, name: 'Zebra Cream' }),
      product({ id: 2, name: 'Apple Cream' }),
    ],
    {},
    '',
  )
  assert.strictEqual(candidates[0].score, candidates[1].score, 'both products should score identically with no question/profile signal')
  assert.strictEqual(candidates[0].name, 'Apple Cream', 'tied scores should sort alphabetically by name')
})

check('selectCandidateProducts caps results at MAX_PRODUCTS_IN_PROMPT (18)', () => {
  const products = []
  for (let index = 0; index < 25; index += 1) {
    products.push(product({ id: index, name: `Product ${String(index).padStart(2, '0')}` }))
  }
  const candidates = selectCandidateProducts(products, {}, '')
  assert.strictEqual(candidates.length, 18, 'should never return more than 18 candidates regardless of pool size')
})

check('selectCandidateProducts gives in-stock products a scoring boost over otherwise-identical out-of-stock ones', () => {
  const candidates = selectCandidateProducts(
    [
      product({ id: 1, name: 'Same Name', stock_quantity: 0 }),
      product({ id: 2, name: 'Same Name', stock_quantity: 10 }),
    ],
    {},
    '',
  )
  assert.strictEqual(candidates[0].id, 2, 'the in-stock product should rank first')
  assert.ok(candidates[0].score > candidates[1].score)
})

check('selectCandidateProducts output shape matches what the AI prompt-builder consumes', () => {
  const [candidate] = selectCandidateProducts(
    [product({ id: 7, name: 'Shape Check', brand: 'B', category: 'C', unit: 'ml', description: 'D', selling_price_usd: 9.5, selling_price_khr: 38000, stock_quantity: 3, image_path: '/img.png', image_gallery: ['/a.png'] })],
    {},
    '',
  )
  // selling_price_usd/khr and the raw stock_quantity still ride along on
  // the candidate object (buildRecommendationPayloads re-attaches real
  // ground-truth price/qty to whatever the model picks) but buildPrompt's
  // candidateLines never reads them -- see stock_status/on_sale below,
  // which is what the model itself is actually shown.
  assert.deepStrictEqual(Object.keys(candidate).sort(), [
    'brand', 'category', 'description', 'expiry_date', 'id', 'image_gallery', 'image_path',
    'name', 'on_sale', 'score', 'selling_price_khr', 'selling_price_usd', 'stock_quantity', 'stock_status', 'unit',
  ].sort())
  assert.strictEqual(candidate.id, 7)
  assert.strictEqual(candidate.image_gallery[0], '/a.png')
})

check('selectCandidateProducts derives stock_status from thresholds, not a raw count', () => {
  const [outOfStock] = selectCandidateProducts([product({ id: 1, stock_quantity: 0, out_of_stock_threshold: 0 })], {}, '')
  const [low] = selectCandidateProducts([product({ id: 2, stock_quantity: 5, out_of_stock_threshold: 0, low_stock_threshold: 10 })], {}, '')
  const [inStock] = selectCandidateProducts([product({ id: 3, stock_quantity: 50, out_of_stock_threshold: 0, low_stock_threshold: 10 })], {}, '')
  assert.strictEqual(outOfStock.stock_status, 'out_of_stock')
  assert.strictEqual(low.stock_status, 'low_stock')
  assert.strictEqual(inStock.stock_status, 'in_stock')
})

check('selectCandidateProducts marks on_sale from an active discount, and scores it above an identical non-sale product', () => {
  const candidates = selectCandidateProducts(
    [
      product({ id: 1, name: 'Same Name', discount_enabled: 0 }),
      product({ id: 2, name: 'Same Name', discount_enabled: 1, discount_type: 'percent', discount_percent: 20 }),
    ],
    {},
    '',
  )
  const onSale = candidates.find((c) => c.id === 2)
  const notOnSale = candidates.find((c) => c.id === 1)
  assert.strictEqual(onSale.on_sale, true)
  assert.strictEqual(notOnSale.on_sale, false)
  assert.strictEqual(candidates[0].id, 2, 'the actively-discounted product should rank first')
})

check('selectCandidateProducts defaults image_gallery to an array when the source field is not one', () => {
  const [candidate] = selectCandidateProducts(
    [product({ id: 1, name: 'No Gallery', image_gallery: null })],
    {},
    '',
  )
  assert.deepStrictEqual(candidate.image_gallery, [])
})

check('summarizeProfile trims each field to its own max length', () => {
  const longConcern = 'x'.repeat(400)
  const summary = summarizeProfile({ brand: 'B'.repeat(200), concerns: longConcern })
  assert.strictEqual(summary.brand.length, 120, 'brand should be capped at 120 chars')
  assert.strictEqual(summary.concerns.length, 220, 'concerns should be capped at 220 chars (its own, wider, limit)')
})

check('summarizeProfile returns empty strings for a profile with no fields set', () => {
  const summary = summarizeProfile()
  assert.deepStrictEqual(summary, { brand: '', skinType: '', concerns: '', shoppingFor: '', goal: '' })
})

// ---------------------------------------------------------------------
// parseAssistantPayload -- the off-topic guardrail enforcement point. The
// prompt (buildPrompt) instructs the model to set off_topic:true and empty
// its recommendations/follow_up_questions itself, but this is the actual
// gate: even a model that ignores that instruction and returns
// recommendations anyway must not have them reach the customer.

check('parseAssistantPayload drops recommendations when the model sets off_topic, even if it also returned some', () => {
  const candidatesById = new Map([[1, { id: 1, name: 'Product 1', selling_price_usd: 9 }]])
  const raw = JSON.stringify({
    summary: '',
    off_topic: true,
    recommendations: [{ product_id: 1, name: 'Product 1', reason: 'should be dropped' }],
    follow_up_questions: ['should also be dropped'],
  })
  const result = parseAssistantPayload(raw, candidatesById, 'disclaimer')
  assert.strictEqual(result.off_topic, true)
  assert.deepStrictEqual(result.recommendations, [], 'recommendations must be dropped once off_topic is true, regardless of what the model returned')
  assert.deepStrictEqual(result.follow_up_questions, [], 'follow_up_questions must be dropped once off_topic is true')
})

check('parseAssistantPayload falls back to a fixed decline message when off_topic but the model left summary blank', () => {
  const raw = JSON.stringify({ off_topic: true, summary: '' })
  const result = parseAssistantPayload(raw, new Map(), 'disclaimer')
  assert.strictEqual(result.off_topic, true)
  assert.ok(result.summary && result.summary.length > 0, 'an off_topic response must never surface an empty summary to the customer')
})

check('parseAssistantPayload keeps recommendations for a normal, on-topic response', () => {
  const candidatesById = new Map([[1, { id: 1, name: 'Product 1', selling_price_usd: 9 }]])
  const raw = JSON.stringify({
    summary: 'Here is a good match.',
    off_topic: false,
    recommendations: [{ product_id: 1, name: 'Product 1', reason: 'fits the question' }],
  })
  const result = parseAssistantPayload(raw, candidatesById, 'disclaimer')
  assert.strictEqual(result.off_topic, false)
  assert.strictEqual(result.recommendations.length, 1)
  assert.strictEqual(result.recommendations[0].product_id, 1)
})

check('parseAssistantPayload defaults off_topic to false for a legacy/malformed response with no such field', () => {
  const result = parseAssistantPayload(JSON.stringify({ summary: 'ok' }), new Map(), 'disclaimer')
  assert.strictEqual(result.off_topic, false)
})

check('the public recommendation payload NEVER carries a raw stock count -- only the coarse status', () => {
  // POST /api/portal/ai/chat returns these objects verbatim to an anonymous
  // visitor. The candidate keeps raw stock_quantity internally (so ground
  // truth never routes through the model), but the payload built from it
  // must ship the same coarse stock_status the catalog cards serve --
  // shipping the raw count bypassed attachPortalStockStatus's redaction.
  const [candidate] = selectCandidateProducts(
    [product({ id: 9, name: 'Redaction Check', stock_quantity: 7, out_of_stock_threshold: 0, low_stock_threshold: 10 })],
    {},
    '',
  )
  const raw = JSON.stringify({
    summary: 'match',
    off_topic: false,
    recommendations: [{ product_id: 9, name: 'Redaction Check', reason: 'fits' }],
  })
  const result = parseAssistantPayload(raw, new Map([[9, candidate]]), 'disclaimer')
  assert.strictEqual(result.recommendations.length, 1)
  const payload = result.recommendations[0]
  assert.ok(!('stock_quantity' in payload), 'raw stock_quantity must not reach the public AI chat response')
  assert.strictEqual(payload.stock_status, 'low_stock')
})

console.log(`\n${checks} check(s) passed.`)
