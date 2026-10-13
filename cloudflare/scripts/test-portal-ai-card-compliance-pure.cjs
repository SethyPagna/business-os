// G7 / G21 (compliance review, 13 Oct 2026): the public shopping assistant must not present
// model-written label facts as product facts, and must not carry a price when the store hides
// prices. This runs the REAL src/lib/portalAi.ts (transpiled) with only the database, the
// rate limiter and the provider call replaced, then reads what the model is sent and what the
// anonymous visitor would be returned.
//
// Run: node scripts/test-portal-ai-card-compliance-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'portalAi.ts')
const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: sourcePath,
})

const PROVIDER_ROW = { id: 1, provider: 'groq', name: 'Test provider', enabled: 1, provider_type: 'chat', priority: 1, default_model: 'm' }
let modelReply = ''
let sentMessages = []

const Module = require('module')
const originalLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === './db') return { getDb: () => ({ prepare: () => ({ all: async () => [PROVIDER_ROW] }) }) }
  if (request === './aiGateway') return {
    callChatProvider: async (_provider, messages) => {
      sentMessages = messages
      return { text: modelReply }
    },
    getProviderMeta: () => null,
    parseJsonSafe: (value, fallback) => {
      try { return JSON.parse(value) } catch (_) { return fallback }
    },
  }
  if (request === './rateLimit') return { checkRateLimit: async () => ({ allowed: true }) }
  return originalLoad.call(this, request, parent, isMain)
}
const moduleObj = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
  moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
)
Module._load = originalLoad
const { generatePortalAiResponse, parseAssistantPayload, selectCandidateProducts } = moduleObj.exports

const PRICE_USD = 1234.56
const PRICE_KHR = 5061696

function product(overrides = {}) {
  return {
    id: 7,
    name: 'Daily Sunscreen',
    brand: 'Acme',
    category: 'Sun care',
    unit: '50ml',
    description: 'A light daily sunscreen',
    stock_quantity: 40,
    low_stock_threshold: 10,
    out_of_stock_threshold: 0,
    selling_price_usd: PRICE_USD,
    selling_price_khr: PRICE_KHR,
    image_path: '',
    image_gallery: [],
    ...overrides,
  }
}

const MODEL_JSON_WITH_LABEL_FACTS = JSON.stringify({
  summary: 'Here is a match.',
  off_topic: false,
  recommendations: [{
    product_id: 7,
    name: 'Daily Sunscreen',
    reason: 'fits oily skin',
    fit_summary: 'light texture',
    how_to_use: 'Apply twice daily to the whole face.',
    cautions: 'Safe for pregnancy and children.',
    ingredients_focus: ['niacinamide', 'zinc oxide'],
  }],
})

async function ask(showPrices) {
  modelReply = MODEL_JSON_WITH_LABEL_FACTS
  sentMessages = []
  const result = await generatePortalAiResponse({ APP_ENCRYPTION_KEY: 'k' }, {
    config: { businessName: 'Shop', aiProviderId: null, aiDisclaimer: 'AI disclaimer', aiPrompt: '', showPrices },
    profile: {},
    question: 'sunscreen',
    products: [product()],
    visitorFingerprint: 'v',
  })
  const prompt = sentMessages.map((message) => message.content).join('\n')
  return { result, prompt }
}

let checks = 0
let failed = 0
async function check(label, fn) {
  try {
    await fn()
    checks += 1
    console.log(`PASS ${label}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${label}`)
    console.error(error.message)
  }
}

async function main() {
  await check('the model is not asked for how-to-use, cautions or ingredients, and is told it has not seen the label', async () => {
    const { prompt } = await ask(true)
    const shapeLine = prompt.split(String.fromCharCode(10)).find((line) => line.startsWith('{"summary"'))
    assert.ok(shapeLine, 'the prompt still states the JSON shape it expects')
    const requested = Object.keys(JSON.parse(shapeLine).recommendations[0])
    assert.deepStrictEqual(requested, ['product_id', 'name', 'reason', 'fit_summary'], 'a recommendation asks for the match only, never label facts')
    assert.match(prompt, /have not seen any product label/, 'the prompt tells the model it has not seen the label')
  })

  await check('model-written how-to-use, cautions and ingredients never reach the visitor, however the model answers', async () => {
    for (const showPrices of [true, false]) {
      const { result } = await ask(showPrices)
      assert.strictEqual(result.recommendations.length, 1, 'positive control: the recommendation itself is served')
      const payload = result.recommendations[0]
      assert.strictEqual(payload.reason, 'fits oily skin', 'positive control: the reason is still served')
      for (const field of ['how_to_use', 'cautions', 'ingredients_focus']) {
        assert.ok(!(field in payload), `${field} is model-written label text and must not be served (showPrices=${showPrices})`)
      }
    }
  })

  await check('showPrices true: the recommendation carries the store price, as before', async () => {
    const { result } = await ask(true)
    const payload = result.recommendations[0]
    assert.strictEqual(payload.selling_price_usd, PRICE_USD)
    assert.strictEqual(payload.selling_price_khr, PRICE_KHR)
  })

  await check('showPrices false: no price is returned to the visitor', async () => {
    const { result } = await ask(false)
    const payload = result.recommendations[0]
    assert.ok(!('selling_price_usd' in payload), 'selling_price_usd must not be served while prices are hidden')
    assert.ok(!('selling_price_khr' in payload), 'selling_price_khr must not be served while prices are hidden')
    assert.ok(!JSON.stringify(result.recommendations).includes(String(PRICE_USD)), 'the USD figure appears nowhere in the served payload')
    assert.ok(!JSON.stringify(result.recommendations).includes(String(PRICE_KHR)), 'the KHR figure appears nowhere in the served payload')
  })

  await check('an omitted showPrices flag fails closed: no price is served', async () => {
    const candidate = selectCandidateProducts([product()], {}, '')[0]
    const result = parseAssistantPayload(MODEL_JSON_WITH_LABEL_FACTS, new Map([[7, candidate]]), 'disclaimer')
    assert.ok(!('selling_price_usd' in result.recommendations[0]))
    assert.ok(!('selling_price_khr' in result.recommendations[0]))
  })

  await check('generatePortalAiResponse itself fails closed: a config without showPrices, or with a non-true value, serves no price', async () => {
    for (const config of [
      { businessName: 'Shop', aiProviderId: null, aiDisclaimer: 'AI disclaimer', aiPrompt: '' },
      { businessName: 'Shop', aiProviderId: null, aiDisclaimer: 'AI disclaimer', aiPrompt: '', showPrices: undefined },
      { businessName: 'Shop', aiProviderId: null, aiDisclaimer: 'AI disclaimer', aiPrompt: '', showPrices: 'true' },
      { businessName: 'Shop', aiProviderId: null, aiDisclaimer: 'AI disclaimer', aiPrompt: '', showPrices: 1 },
    ]) {
      modelReply = MODEL_JSON_WITH_LABEL_FACTS
      sentMessages = []
      const result = await generatePortalAiResponse({ APP_ENCRYPTION_KEY: 'k' }, { config, profile: {}, question: 'sunscreen', products: [product()], visitorFingerprint: 'v' })
      assert.strictEqual(result.recommendations.length, 1, 'positive control: the recommendation is served')
      assert.ok(!JSON.stringify(result.recommendations).includes(String(PRICE_USD)), `no price for showPrices=${String(config.showPrices)}`)
      assert.ok(!('selling_price_usd' in result.recommendations[0]) && !('selling_price_khr' in result.recommendations[0]))
      const prompt = sentMessages.map((message) => message.content).join(' ')
      assert.match(prompt, /does not show prices on its website/, 'the prompt takes the hidden-prices branch as well')
    }
  })

  await check('the model never sees a price in either mode, and is told to say prices are hidden when they are', async () => {
    for (const showPrices of [true, false]) {
      const { prompt } = await ask(showPrices)
      assert.ok(!prompt.includes(String(PRICE_USD)), `the USD price must not be in the prompt (showPrices=${showPrices})`)
      assert.ok(!prompt.includes(String(PRICE_KHR)), `the KHR price must not be in the prompt (showPrices=${showPrices})`)
      assert.ok(!/selling_price/.test(prompt), 'no price field name in the prompt')
    }
    const hidden = (await ask(false)).prompt
    assert.match(hidden, /does not show prices on its website/, 'hidden mode tells the model the store shows no prices')
    assert.ok(!/shown on the product card/.test(hidden), 'hidden mode must not send the customer to a price that is not on the card')
    const shown = (await ask(true)).prompt
    assert.match(shown, /shown on the product card/, 'positive control: shown mode keeps the original instruction')
  })

  if (failed) {
    console.error(`\n${failed} check(s) failed.`)
    process.exit(1)
  }
  console.log(`\n${checks} check(s) passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
