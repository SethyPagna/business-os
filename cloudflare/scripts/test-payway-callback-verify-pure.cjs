// S1: callback verification and response parsing. The header signature is recomputed with node:crypto over the
// documented rule (values in ascending key order, arrays JSON-encoded); the per-order URL token is a pure function
// of the tran id and APP_ENCRYPTION_KEY, so a forged callback is refused without any D1 read.
// Run: node scripts/test-payway-callback-verify-pure.cjs
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { loadPayway } = require('./harness/load_payway.cjs')
const P = loadPayway()

let n = 0
async function t(name, fn) { await fn(); n += 1; console.log(`PASS ${name}`) }
const KEY = 'callback-key-not-real'
const body = {
  tran_id: 'LB4K7Q2M9X', apv: '123456', status: '00', return_params: '', original_amount: '15.50', original_currency: 'USD',
  payment_amount: '15.5', payment_currency: 'USD', total_amount: '15.50', discount_amount: '0', transaction_date: '2026-11-09 15:05:03',
  payment_type: 'KHQR', bank_name: 'Test Bank', bank_ref: 'BR1', tags: ['a', 'b'], note: null,
}
const independent = (obj, key) => crypto.createHmac('sha512', key).update(Object.keys(obj).sort().map((k) => {
  const v = obj[k]
  return v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
}).join('')).digest('base64')

;(async () => {
  await t('a correct header verifies; arrays are JSON-encoded and null is empty', async () => {
    assert.equal(await P.verifyCallbackSignature(body, independent(body, KEY), KEY), true)
    assert.equal(P.callbackSigningString({ b: 'two', a: ['x'], c: null }), '["x"]two')
  })
  await t('key order in the posted JSON does not matter, only ascending order of the keys', async () => {
    const shuffled = Object.fromEntries(Object.entries(body).reverse())
    assert.equal(await P.verifyCallbackSignature(shuffled, independent(body, KEY), KEY), true)
  })
  await t('POSITIVE CONTROL: a changed value, a changed key, a missing or malformed header all refuse', async () => {
    const good = independent(body, KEY)
    assert.equal(await P.verifyCallbackSignature({ ...body, payment_amount: '0.01' }, good, KEY), false)
    assert.equal(await P.verifyCallbackSignature(body, good, 'other-key'), false)
    assert.equal(await P.verifyCallbackSignature(body, null, KEY), false)
    assert.equal(await P.verifyCallbackSignature(body, '', KEY), false)
    assert.equal(await P.verifyCallbackSignature(body, good.slice(0, -4) + 'AAAA', KEY), false)
    assert.equal(await P.verifyCallbackSignature(body, good + 'x', KEY), false)
    assert.equal(await P.verifyCallbackSignature(body, good, ''), false)
    assert.equal(await P.verifyCallbackSignature([], good, KEY), false)
  })
  await t('constantTimeEqual answers equality only, including different lengths', async () => {
    assert.equal(P.constantTimeEqual('abc', 'abc'), true)
    assert.equal(P.constantTimeEqual('abc', 'abd'), false)
    assert.equal(P.constantTimeEqual('abc', 'abcd'), false)
    assert.equal(P.constantTimeEqual('', ''), true)
  })
  const env = { APP_ENCRYPTION_KEY: 'app-key-not-real-0123456789' }
  await t('the callback url carries a token that verifies for that tran id only', async () => {
    const url = await P.callbackUrlFor(env, 'https://admin.example.test', 'LB4K7Q2M9X')
    const parsed = new URL(url)
    assert.equal(parsed.pathname, '/api/payway/callback')
    assert.equal(parsed.searchParams.get('t'), 'LB4K7Q2M9X')
    const s = parsed.searchParams.get('s')
    assert.match(s, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(await P.verifyCallbackToken(env, 'LB4K7Q2M9X', s), true)
    assert.equal(await P.verifyCallbackToken(env, 'LB4K7Q2M9Y', s), false, 'another tran id')
    assert.equal(await P.verifyCallbackToken({ APP_ENCRYPTION_KEY: 'a-different-app-key' }, 'LB4K7Q2M9X', s), false, 'another deployment key')
    assert.equal(await P.verifyCallbackToken(env, 'LB4K7Q2M9X', s.slice(0, -1) + (s.endsWith('A') ? 'B' : 'A')), false)
    for (const bad of [null, '', undefined, 12]) assert.equal(await P.verifyCallbackToken(env, 'LB4K7Q2M9X', bad), false)
    assert.equal(await P.verifyCallbackToken(env, 'lowercase', s), false)
  })
  await t('the token is stable and is NOT the raw key or a plain hash of the tran id', async () => {
    const a = await P.callbackUrlFor(env, 'https://admin.example.test', 'LB4K7Q2M9X')
    const b = await P.callbackUrlFor(env, 'https://admin.example.test', 'LB4K7Q2M9X')
    assert.equal(a, b)
    const plain = crypto.createHmac('sha256', env.APP_ENCRYPTION_KEY).update('LB4K7Q2M9X').digest('base64url')
    assert.ok(!a.includes(plain), 'the key must be derived (HKDF), not used directly')
    assert.ok(!a.includes(env.APP_ENCRYPTION_KEY))
  })
  await t('no key, a bad origin or a bad tran id gives no url', async () => {
    assert.equal(await P.callbackUrlFor({}, 'https://admin.example.test', 'LB4K7Q2M9X'), null)
    assert.equal(await P.callbackUrlFor(env, 'http://admin.example.test', 'LB4K7Q2M9X'), null)
    assert.equal(await P.callbackUrlFor(env, 'https://admin.example.test/x', 'LB4K7Q2M9X'), null)
    assert.equal(await P.callbackUrlFor(env, 'https://admin.example.test', 'bad id'), null)
    assert.equal(await P.verifyCallbackToken({}, 'LB4K7Q2M9X', 'x'), false)
  })

  // ---- parsers ----
  await t('generate-qr answers: success keeps qrString and deeplink and drops the image; every documented code maps', async () => {
    const ok = P.parseQrResponse({ status: { code: '0', message: 'Success.', trace_id: 'x' }, qrString: '000201...', qrImage: 'A'.repeat(50000), abapay_deeplink: 'abamobilebank://pay?x' })
    assert.deepEqual(ok, { ok: true, qrString: '000201...', deeplink: 'abamobilebank://pay?x' })
    assert.ok(!JSON.stringify(ok).includes('AAAA'))
    const map = { 1: 'wrong_hash', 6: 'domain_not_whitelisted', 102: 'domain_not_whitelisted', 12: 'currency_not_supported', 23: 'option_not_enabled', 44: 'limit_exceeded', 47: 'amount_too_small', 403: 'duplicate_tran_id', 429: 'rate_limited' }
    for (const [code, reason] of Object.entries(map)) assert.deepEqual(P.parseQrResponse({ status: { code: Number(code) } }), { ok: false, reason })
    assert.deepEqual(P.parseQrResponse({ status: { code: '999' } }), { ok: false, reason: 'unknown' })
    assert.deepEqual(P.parseQrResponse({ status: { code: '0' } }), { ok: false, reason: 'bad_response' })
    for (const junk of [null, 'x', [], {}, { status: 5 }]) assert.deepEqual(P.parseQrResponse(junk), { ok: false, reason: 'bad_response' })
  })
  await t('check-transaction answers: each payment_status_code maps and amounts become numbers', async () => {
    const wrap = (data) => ({ status: { code: '00' }, data })
    const approved = P.parseCheckResponse(wrap({ payment_status_code: 0, original_amount: '15.50', total_amount: 15.5, discount_amount: 0, payment_amount: '15.5', refund_amount: 0, payment_currency: 'USD', apv: '123456', transaction_date: '2026-11-09 15:05:03' }))
    assert.deepEqual(approved, { ok: true, state: 'approved', originalAmount: 15.5, totalAmount: 15.5, discountAmount: 0, paymentAmount: 15.5, refundAmount: 0, paymentCurrency: 'USD', apv: '123456', transactionDate: '2026-11-09 15:05:03' })
    const states = { 0: 'approved', 2: 'pending', 3: 'declined', 4: 'refunded', 7: 'cancelled' }
    for (const [code, state] of Object.entries(states)) assert.equal(P.parseCheckResponse(wrap({ payment_status_code: Number(code) })).state, state)
    assert.deepEqual(P.parseCheckResponse(wrap({ payment_status_code: 9 })), { ok: false, reason: 'bad_response' })
    assert.deepEqual(P.parseCheckResponse(wrap(null)), { ok: false, reason: 'bad_response' })
    const codes = { 5: 'wrong_hash', 6: 'not_found', 8: 'wrong_merchant', 429: 'rate_limited' }
    for (const [code, reason] of Object.entries(codes)) assert.deepEqual(P.parseCheckResponse({ status: { code: String(code).padStart(2, '0') } }), { ok: false, reason })
    assert.equal(P.parseCheckResponse(wrap({ payment_status_code: 0, original_amount: 'abc' })).originalAmount, null)
  })
  await t('close answers map and the injected transport is the only way out', async () => {
    assert.deepEqual(P.parseCloseResponse({ status: { code: '00' } }), { ok: true })
    assert.deepEqual(P.parseCloseResponse({ status: { code: '6' } }), { ok: false, reason: 'not_found' })
    const calls = []
    const creds = { merchantId: 'm1', apiKey: 'k1', env: 'production' }
    const transport = async (req) => { calls.push(req); return { status: 200, json: { status: { code: '00' }, data: { payment_status_code: 2 } } } }
    const out = await P.checkTransaction(transport, creds, new Date(Date.UTC(2026, 10, 9)), 'LB4K7Q2M9X')
    assert.equal(out.state, 'pending')
    assert.equal(calls[0].url, 'https://checkout.payway.com.kh/api/payment-gateway/v1/payments/check-transaction-2')
    await P.closeTransaction(transport, { ...creds, env: 'sandbox' }, new Date(), 'LB4K7Q2M9X')
    assert.ok(calls[1].url.startsWith('https://checkout-sandbox.payway.com.kh/'))
    const limited = await P.checkTransaction(async () => ({ status: 429, json: null }), creds, new Date(), 'LB4K7Q2M9X')
    assert.deepEqual(limited, { ok: false, reason: 'rate_limited' })
    await assert.rejects(P.checkTransaction(async () => { throw new Error('socket hang up to https://secret.example') }, creds, new Date(), 'LB4K7Q2M9X'), (e) => e.reason === 'transport_failed' && !/secret/.test(e.message))
    await assert.rejects(P.checkTransaction(async () => ({ status: 502, json: null }), creds, new Date(), 'LB4K7Q2M9X'), (e) => e.reason === 'transport_failed')
  })
  await t('credentials read: both secrets required; PAYWAY_ENV other than production is sandbox', async () => {
    assert.equal(P.paywayCredentials({}), null)
    assert.equal(P.paywayCredentials({ PAYWAY_MERCHANT_ID: 'm' }), null)
    assert.deepEqual(P.paywayCredentials({ PAYWAY_MERCHANT_ID: ' m ', PAYWAY_API_KEY: 'k' }), { merchantId: 'm', apiKey: 'k', env: 'sandbox' })
    assert.equal(P.paywayCredentials({ PAYWAY_MERCHANT_ID: 'm', PAYWAY_API_KEY: 'k', PAYWAY_ENV: 'production' }).env, 'production')
    assert.equal(P.paywayConfigured({ PAYWAY_MERCHANT_ID: 'm', PAYWAY_API_KEY: 'k' }), true)
  })
  console.log(`${n} checks passed`)
})().catch((e) => { console.error(e); process.exit(1) })
