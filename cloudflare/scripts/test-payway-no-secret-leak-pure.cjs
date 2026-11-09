// S1: no secret in an error, a result or a log. Every failure path of lib/payway.ts is driven with distinctive
// merchant id / API key / app key strings; none may appear in what is thrown or returned. The source is also pinned
// to carry no network call and no logging of its own.
// Run: node scripts/test-payway-no-secret-leak-pure.cjs
const assert = require('node:assert/strict')
const { loadPayway, source } = require('./harness/load_payway.cjs')
const P = loadPayway()

const MERCHANT = 'MERCHANT-SENTINEL-7731'
const API_KEY = 'APIKEY-SENTINEL-9942'
const APP_KEY = 'APPKEY-SENTINEL-5518'
const creds = { merchantId: MERCHANT, apiKey: API_KEY, env: 'sandbox' }
const now = new Date(Date.UTC(2026, 10, 9, 1, 2, 3))
const SECRETS = [MERCHANT, API_KEY, APP_KEY]
const clean = (label, value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value) + (value && value.stack ? value.stack : '')
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `${label} leaked ${secret}`)
}
let n = 0
async function t(name, fn) { await fn(); n += 1; console.log(`PASS ${name}`) }

;(async () => {
  const logged = []
  const originals = {}
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) { originals[level] = console[level]; console[level] = (...a) => { logged.push(a.map(String).join(' ')) } }
  try {
    await t('thrown errors carry a fixed word only', async () => {
      const attempts = [
        () => P.buildGenerateQr({ now, tranId: 'bad id', amount: 1, currency: 'USD', lifetimeMinutes: 15 }, creds),
        () => P.buildGenerateQr({ now, tranId: 'ABC', amount: -3, currency: 'USD', lifetimeMinutes: 15 }, creds),
        () => P.buildCheckTransaction(now, 'x'.repeat(30), creds),
        () => P.checkTransaction(async () => { throw new Error(`boom ${API_KEY} ${MERCHANT}`) }, creds, now, 'ABC123'),
        () => P.generateQr(async () => { throw Object.assign(new Error(API_KEY), { cause: MERCHANT }) }, creds, { now, tranId: 'ABC123', amount: 1, currency: 'USD', lifetimeMinutes: 15 }),
        () => P.closeTransaction(async () => ({ status: 503, json: { echo: API_KEY } }), creds, now, 'ABC123'),
      ]
      for (const attempt of attempts) {
        const error = await attempt().then(() => null, (e) => e)
        assert.ok(error instanceof P.PaywayError, 'every failure is a PaywayError')
        assert.match(error.message, /^payway_[a-z_]+$/)
        clean('error', error.message + error.stack)
        assert.equal(error.cause, undefined)
      }
    })
    await t('parsed failures never echo the upstream message, trace id or body', async () => {
      const upstream = { status: { code: '1', message: `bad hash for ${MERCHANT} with ${API_KEY}`, trace_id: APP_KEY }, qrString: API_KEY }
      for (const result of [P.parseQrResponse(upstream), P.parseCheckResponse(upstream), P.parseCloseResponse(upstream)]) {
        assert.equal(result.ok, false)
        clean('parsed', result)
      }
    })
    await t('built requests carry the hash and merchant id the API needs, never the API key', async () => {
      for (const req of [await P.buildGenerateQr({ now, tranId: 'ABC123', amount: 1, currency: 'USD', lifetimeMinutes: 15 }, creds), await P.buildCheckTransaction(now, 'ABC123', creds), await P.buildCloseTransaction(now, 'ABC123', creds)]) {
        const text = JSON.stringify(req)
        assert.ok(!text.includes(API_KEY) && !text.includes(APP_KEY))
        assert.ok(text.includes(MERCHANT), 'merchant_id is a request field by design')
      }
    })
    await t('the callback url and token reveal neither key', async () => {
      const url = await P.callbackUrlFor({ APP_ENCRYPTION_KEY: APP_KEY }, 'https://admin.example.test', 'ABC123')
      clean('callback url', url)
    })
    await t('nothing was logged by any path above', async () => { assert.deepEqual(logged.filter((line) => !line.startsWith('PASS ')), []) })
  } finally {
    for (const level of Object.keys(originals)) console[level] = originals[level]
  }
  await t('source: no fetch, no logging, no imports at runtime, no env access outside the two reader functions', async () => {
    const code = source().replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    assert.ok(!/\bfetch\s*\(/.test(code), 'no fetch')
    assert.ok(!/\bXMLHttpRequest\b|\bWebSocket\b/.test(code))
    assert.ok(!/\bconsole\./.test(code), 'no console')
    assert.ok(!/^import\s(?!type\b)/m.test(code), 'only type imports')
    assert.ok(!/\bprocess\.env\b/.test(code))
  })
  console.log(`${n} checks passed`)
})().catch((e) => { console.error(e); process.exit(1) })
