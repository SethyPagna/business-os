// G21 wiring lock: the hidden-prices rule must survive the whole path
//   settings row -> buildPortalConfig -> POST /ai/chat -> generatePortalAiResponse -> served JSON.
// The unit test (test-portal-ai-card-compliance-pure.cjs) calls generatePortalAiResponse directly, so
// a route that hard-coded `showPrices: true`, or dropped the line, left every other test green.
// Here the REAL routes/portal.ts and the REAL lib/portalAi.ts run against in-memory SQLite carrying
// every migration; only the provider call is replaced by a fixed model reply.
//
// Run (from cloudflare/): node scripts/test-portal-ai-chat-prices-route-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')
const SRC = path.join(__dirname, '..', 'src')

function wrap(rawDb) {
  return {
    prepare(sql) {
      const stmt = rawDb.prepare(sql)
      return {
        get: async (p) => stmt.get(p),
        all: async (p) => stmt.all(p) || [],
        run: async (p) => {
          const r = stmt.run(p)
          return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
        },
      }
    },
    batch: (items) => rawDb.batch(items),
  }
}

const moduleCache = new Map()
const overrides = new Map()

function resolveTs(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return base
}

function loadFile(sourcePath) {
  const key = path.normalize(sourcePath)
  if (overrides.has(key)) return overrides.get(key)
  if (moduleCache.has(key)) return moduleCache.get(key)
  const { outputText } = ts.transpileModule(fs.readFileSync(key, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: key,
  })
  const moduleObj = { exports: {} }
  moduleCache.set(key, moduleObj.exports)
  const packageRequire = Module.createRequire(key)
  const scopedRequire = (request) => (
    request.startsWith('.') ? loadFile(resolveTs(path.resolve(path.dirname(key), request))) : packageRequire(request)
  )
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, scopedRequire, moduleObj, key, path.dirname(key),
  )
  moduleCache.set(key, moduleObj.exports)
  return moduleObj.exports
}

function override(relPath, exportsObject) {
  overrides.set(path.normalize(path.join(SRC, relPath)), exportsObject)
}
function loadReal(relPath) {
  return loadFile(resolveTs(path.join(SRC, relPath)))
}

const rawDb = openDb(fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort().map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')))
const db = wrap(rawDb)

const PRICE_USD = 1234.56
const PRICE_KHR = 5061696
let modelReply = ''

override('lib/db.ts', { getDb: () => db })
override('durable-objects/broadcastHub.ts', { broadcast: async () => {} })
override('lib/imageAudit.ts', { enqueueImageNormalization: async () => {} })
override('lib/auth.ts', { requireAuth: async (c) => c.json({ error: 'Unauthorized' }, 401) })
override('lib/aiGateway.ts', {
  ...loadReal('lib/aiGateway.ts'),
  callChatProvider: async () => ({ text: modelReply }),
  getProviderMeta: () => null,
})

const app = loadReal('routes/portal.ts').default
const env = { PORTAL_ABUSE_HMAC_SECRET: 'portal-test-secret-is-at-least-thirty-two-characters', APP_ENCRYPTION_KEY: 'k' }
const ctx = { waitUntil: (promise) => { if (promise && typeof promise.catch === 'function') promise.catch(() => {}) }, passThroughOnException() {} }
const JSON_HEADERS = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }

function setSetting(key, value) {
  rawDb.prepare('INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run({ key, value: String(value) })
}
function clearSetting(key) { rawDb.prepare('DELETE FROM settings WHERE key = ?').run([key]) }

rawDb.prepare(`INSERT INTO ai_provider_configs (name, provider, provider_type, api_key_encrypted, default_model, enabled, priority)
  VALUES ('Test provider', 'groq', 'chat', 'x', 'm', 1, 1)`).run({})
rawDb.prepare(`INSERT INTO products (name, brand, category, unit, description, selling_price_usd, selling_price_khr, stock_quantity, is_active)
  VALUES ('Daily Sunscreen', 'Acme', 'Sun care', '50ml', 'A light daily sunscreen', @usd, @khr, 40, 1)`).run({ usd: PRICE_USD, khr: PRICE_KHR })
const productId = Number(rawDb.prepare('SELECT id FROM products').get().id)

async function ask(reply) {
  modelReply = JSON.stringify(reply || {
    summary: 'Here is a match.',
    off_topic: false,
    recommendations: [{ product_id: productId, name: 'Daily Sunscreen', reason: 'fits oily skin', fit_summary: 'light texture' }],
  })
  const res = await app.request('/ai/chat', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ question: 'sunscreen', dataUseConsent: true }),
  }, env, ctx)
  const text = await res.text()
  assert.strictEqual(res.status, 200, `the assistant route must answer: ${res.status} ${text}`)
  return { payload: JSON.parse(text), text }
}

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

async function run() {
  await check('prices switched OFF in settings: the served answer carries no price field and no price figure', async () => {
    setSetting('customer_portal_show_prices', 'false')
    const { payload, text } = await ask()
    assert.strictEqual(payload.recommendations.length, 1, 'positive control: the recommendation is served')
    assert.strictEqual(payload.recommendations[0].reason, 'fits oily skin')
    assert.ok(!('selling_price_usd' in payload.recommendations[0]) && !('selling_price_khr' in payload.recommendations[0]), 'no price field while prices are hidden')
    assert.ok(!text.includes(String(PRICE_USD)) && !text.includes(String(PRICE_KHR)), 'no price figure anywhere in the response body')
  })

  await check('prices switched ON in settings: the served answer carries the store price', async () => {
    setSetting('customer_portal_show_prices', 'true')
    const { payload } = await ask()
    assert.strictEqual(payload.recommendations[0].selling_price_usd, PRICE_USD)
    assert.strictEqual(payload.recommendations[0].selling_price_khr, PRICE_KHR)
  })

  await check('no prices setting row: the catalog default (prices shown) applies to the assistant too', async () => {
    clearSetting('customer_portal_show_prices')
    const { payload } = await ask()
    assert.strictEqual(payload.recommendations[0].selling_price_usd, PRICE_USD)
  })

  await check('flipping the setting back OFF takes effect on the next answer', async () => {
    setSetting('customer_portal_show_prices', 'false')
    const { payload } = await ask()
    assert.ok(!('selling_price_usd' in payload.recommendations[0]))
  })

  console.log(`\n${passed} check(s) passed.`)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
