// FX-sec item 4 (security hunt H-sec): the anonymous storefront config
// (GET /api/portal/config and the `config` inside GET /api/portal/bootstrap)
// published two internal AI settings: aiPrompt -- the merchant's private
// system instructions for the shop assistant -- and aiProviderId, the id of
// the backing ai_provider_configs row. No visitor feature reads either (the
// storefront only needs aiEnabled/aiTitle/aiIntro/aiDisclaimer).
//
// Pins, against the REAL routes/portal.ts:
//   - GET /config, driven through the real Hono app, carries neither field
//     even when both settings are stored, and still carries the public AI
//     fields;
//   - /config and /bootstrap build their config with the one public builder,
//     and no public route returns the internal config raw;
//   - the internal buildPortalConfig() still carries both, because the AI
//     chat route (lib/portalAi.ts) forwards aiPrompt into the model prompt
//     and routes on aiProviderId.
//
// Run: node scripts/test-portal-public-config-ai-private-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { load } = require('./test-request-body-guard-pure.cjs')

const SECRET_PROMPT = 'INTERNAL: never mention competitor X; margin floor 40%'
const settingsRows = [
  { key: 'customer_portal_ai_enabled', value: 'true' },
  { key: 'customer_portal_ai_title', value: 'Beauty Assistant' },
  { key: 'customer_portal_ai_prompt', value: SECRET_PROMPT },
  { key: 'customer_portal_ai_provider_id', value: '7' },
]
const fakeDb = {
  prepare: (sql) => ({
    all: async () => (/FROM settings/.test(sql) ? settingsRows : []),
    get: async () => null,
    run: async () => ({}),
  }),
}

const portal = load('routes/portal.ts', {
  '../lib/db': { getDb: () => fakeDb },
  '../lib/cache': {
    getVersionWithFallback: async () => 'v1',
    cachedJsonResponse: async (_request, _ctx, _version, _ttl, produce) => produce(),
  },
  '../lib/requestBodyGuard': { SMALL_BODY_BYTES: 65536, PORTAL_SCREENSHOT_BODY_BYTES: 1 },
  '../lib/safeLinkUrl': load('lib/safeLinkUrl.ts'),
  '../lib/portalText': load('lib/portalText.ts'),
  '../lib/sqlBinding': {},
})

let failures = 0
async function check(name, fn) {
  try { await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) }
}

const env = { CACHE: { get: async () => null }, PORTAL_PUBLIC_URL: '' }
const ctx = { waitUntil(p) { p?.catch?.(() => {}) }, passThroughOnException() {} }

;(async () => {
  await check('GET /config publishes neither aiPrompt nor aiProviderId', async () => {
    const res = await portal.default.request('https://shop.test/config', {}, env, ctx)
    const text = await res.text()
    assert.equal(res.status, 200, text)
    const body = JSON.parse(text)
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'aiPrompt'), false, 'aiPrompt key must be absent')
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'aiProviderId'), false, 'aiProviderId key must be absent')
    assert.equal(text.includes(SECRET_PROMPT), false, 'the prompt text appears nowhere in the response')
    // The public AI fields the storefront does read are still there.
    assert.equal(body.aiEnabled, true)
    assert.equal(body.aiTitle, 'Beauty Assistant')
    assert.equal(typeof body.aiDisclaimer, 'string')
  })

  await check('the internal config keeps both (the AI chat route depends on them)', async () => {
    const settings = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]))
    const internal = portal.buildPortalConfig(settings, env)
    assert.equal(internal.aiPrompt, SECRET_PROMPT)
    assert.equal(internal.aiProviderId, 7)
  })

  await check('/config and /bootstrap both use the public builder; no public route returns the raw config', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'portal.ts'), 'utf8')
    for (const route of ["app.get('/config'", "app.get('/bootstrap'"]) {
      const at = src.indexOf(route)
      assert.ok(at > -1, route)
      const body = src.slice(at, src.indexOf('\n})', at))
      assert.match(body, /buildPublicPortalConfig\(settings, c\.env\)/, `${route} must build the public config`)
      assert.equal(/buildPortalConfig\(/.test(body), false, `${route} must not build the internal config`)
    }
    // Every other internal use stays server-side: the returned JSON of the
    // two /ai routes never spreads the whole config.
    assert.equal(/c\.json\(\s*config\s*\)/.test(src), false)
    assert.equal(/\.\.\.config\b/.test(src), false)
  })

  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
