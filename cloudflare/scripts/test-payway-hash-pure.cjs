// S1: the PayWay request hashes. The expected values come from an INDEPENDENT node:crypto implementation over the
// documented field order, so a reordered or dropped field in lib/payway.ts turns this red.
// Run: node scripts/test-payway-hash-pure.cjs
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { loadPayway } = require('./harness/load_payway.cjs')
const P = loadPayway()

const creds = { merchantId: 'ttestmerchant', apiKey: 'test-key-not-real-0001', env: 'sandbox' }
const now = new Date(Date.UTC(2026, 10, 9, 8, 5, 3))
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64')
const sign = (message) => crypto.createHmac('sha512', creds.apiKey).update(message).digest('base64')
const DOCUMENTED = ['req_time', 'merchant_id', 'tran_id', 'amount', 'items', 'first_name', 'last_name', 'email', 'phone',
  'purchase_type', 'payment_option', 'callback_url', 'return_deeplink', 'currency', 'custom_fields', 'return_params', 'payout', 'lifetime', 'qr_image_template']
let n = 0
async function t(name, fn) { await fn(); n += 1; console.log(`PASS ${name}`) }

;(async () => {
  const items = [{ name: 'Serum', quantity: 2, price: 7.5 }]
  const input = {
    now, tranId: 'LB4K7Q2M9X', amount: 15.5, currency: 'USD', lifetimeMinutes: 15, items,
    callbackUrl: 'https://admin.example.test/api/payway/callback?t=LB4K7Q2M9X&s=abc', returnDeeplink: 'https://shop.example.test/order/x',
    firstName: 'Dara', phone: '012345678',
  }
  const values = {
    req_time: '20261109080503', merchant_id: creds.merchantId, tran_id: 'LB4K7Q2M9X', amount: '15.50', items: b64(JSON.stringify(items)),
    first_name: 'Dara', last_name: '', email: '', phone: '012345678', purchase_type: '', payment_option: 'abapay_khqr',
    callback_url: b64(input.callbackUrl), return_deeplink: b64(input.returnDeeplink), currency: 'USD', custom_fields: '', return_params: '',
    payout: '', lifetime: '15', qr_image_template: P.DEFAULT_QR_IMAGE_TEMPLATE,
  }
  const expected = sign(DOCUMENTED.map((k) => values[k]).join(''))

  await t('generate-qr hash equals the independent computation over the documented order', async () => {
    const req = await P.buildGenerateQr(input, creds)
    assert.equal(req.path, '/api/payment-gateway/v1/payments/generate-qr')
    assert.equal(req.body.hash, expected)
    assert.deepEqual([...P.GENERATE_QR_HASH_FIELDS], DOCUMENTED)
  })
  await t('callback_url, return_deeplink and items are sent base64; blank optional fields are left out of the body but hashed as empty', async () => {
    const { body } = await P.buildGenerateQr(input, creds)
    assert.equal(body.callback_url, values.callback_url)
    assert.equal(body.return_deeplink, values.return_deeplink)
    assert.equal(body.items, values.items)
    assert.equal(body.amount, '15.50')
    assert.ok(!('last_name' in body) && !('email' in body) && !('payout' in body))
    assert.equal(body.payment_option, 'abapay_khqr')
  })
  await t('with EVERY field filled, the hash equals the independent one and any adjacent swap changes it', async () => {
    const full = { ...input, firstName: 'Dara', lastName: 'Sok', email: 'a@example.test', phone: '012345678', purchaseType: 'purchase',
      customFields: 'cf', returnParams: 'rp', payout: 'po', qrImageTemplate: 'tpl' }
    const fv = { ...values, first_name: 'Dara', last_name: 'Sok', email: 'a@example.test', purchase_type: 'purchase', custom_fields: 'cf',
      return_params: 'rp', payout: 'po', qr_image_template: 'tpl' }
    const fullExpected = sign(DOCUMENTED.map((k) => fv[k]).join(''))
    assert.equal((await P.buildGenerateQr(full, creds)).body.hash, fullExpected)
    let swaps = 0
    for (let i = 0; i < DOCUMENTED.length - 1; i += 1) {
      const swapped = [...DOCUMENTED]
      ;[swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]]
      assert.notEqual(sign(swapped.map((k) => fv[k]).join('')), fullExpected, `swap at ${i}`)
      swaps += 1
    }
    assert.equal(swaps, DOCUMENTED.length - 1)
    assert.notEqual(sign(DOCUMENTED.filter((k) => k !== 'tran_id').map((k) => fv[k]).join('')), fullExpected)
  })
  await t('the key is the API key: a different key changes the hash', async () => {
    const other = await P.buildGenerateQr(input, { ...creds, apiKey: 'another-key' })
    assert.notEqual(other.body.hash, expected)
  })
  await t('check and close hash req_time + merchant_id + tran_id', async () => {
    const want = sign(`20261109080503${creds.merchantId}LB4K7Q2M9X`)
    const check = await P.buildCheckTransaction(now, 'LB4K7Q2M9X', creds)
    const close = await P.buildCloseTransaction(now, 'LB4K7Q2M9X', creds)
    assert.equal(check.path, '/api/payment-gateway/v1/payments/check-transaction-2')
    assert.equal(close.path, '/api/payment-gateway/v1/payments/close-transaction')
    assert.deepEqual(check.body, { req_time: '20261109080503', merchant_id: creds.merchantId, tran_id: 'LB4K7Q2M9X', hash: want })
    assert.deepEqual(close.body, check.body)
    assert.notEqual(sign(`${creds.merchantId}20261109080503LB4K7Q2M9X`), want)
  })
  await t('amounts: USD whole cents as 2dp, KHR integer >= 100, everything else refused', async () => {
    assert.equal(P.amountString(0.01, 'USD'), '0.01')
    assert.equal(P.amountString(24.5, 'USD'), '24.50')
    assert.equal(P.amountString(100, 'KHR'), '100')
    for (const [a, c] of [[0, 'USD'], [0.005, 'USD'], [1.234, 'USD'], [-1, 'USD'], [99, 'KHR'], [100.5, 'KHR'], [NaN, 'USD'], [5, 'EUR']]) {
      assert.throws(() => P.amountString(a, c), /payway_invalid_input/, `${a} ${c}`)
    }
  })
  await t('tran id and lifetime limits are enforced before anything is signed', async () => {
    for (const bad of ['', 'lower', 'HAS SPACE', 'A'.repeat(21)]) await assert.rejects(P.buildCheckTransaction(now, bad, creds), /payway_invalid_input/)
    for (const minutes of [2, 120 * 24 * 60 + 1, 1.5]) await assert.rejects(P.buildGenerateQr({ ...input, lifetimeMinutes: minutes }, creds), /payway_invalid_input/)
    assert.equal(P.reqTime(new Date(Date.UTC(2026, 0, 2, 3, 4, 5))), '20260102030405')
  })
  await t('makeTranId is at most 20 chars of [A-Z0-9], prefixed, and uses the injected random', async () => {
    const id = P.makeTranId('lb-x', Uint8Array.from({ length: 20 }, (_, i) => i * 7))
    assert.match(id, /^[A-Z0-9]{1,20}$/)
    assert.equal(id.length, 20)
    assert.ok(id.startsWith('LBX'))
    assert.notEqual(id, P.makeTranId('lb-x', Uint8Array.from({ length: 20 }, (_, i) => i * 5)))
    assert.ok(P.validTranId(id))
  })
  console.log(`${n} checks passed`)
})().catch((e) => { console.error(e); process.exit(1) })
