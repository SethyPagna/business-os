const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const cache = new Map()
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const mod = { exports: {} }; cache.set(rel, mod)
  const sourcePath = path.join(root, 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText
  const req = (name) => name.startsWith('.')
    ? load(path.posix.normalize(path.posix.join(path.posix.dirname(rel), name)) + '.ts')
    : require(name)
  new Function('require', 'module', 'exports', output)(req, mod, mod.exports)
  return mod.exports
}

const { planSaleSettlement, renameSalePaymentMethod, SettlementValidationError } = load('lib/paymentSettlement.ts')

const plan = planSaleSettlement({
  configuredMethodsRaw: '["Cash","ABA Bank"]',
  paymentDetailsRaw: [
    { method: ' cash ', amount_usd: '1.23456', amount_khr: 0 },
    { method: 'CASH', amount_usd: '1.00004', amount_khr: 0 },
    { method: 'aba bank', amount_usd: 0, amount_khr: 12600 },
  ],
  existingPaidUsd: 1.2345,
  existingPaidKhr: 0,
  totalUsd: 5,
  exchangeRate: 4200,
  changeExchangeRateRaw: 4000,
})
assert.deepEqual(plan.paymentDetails, [
  { method: 'Cash', amount_usd: 1.2346, amount_khr: 0 },
  { method: 'Cash', amount_usd: 1, amount_khr: 0 },
  { method: 'ABA Bank', amount_usd: 0, amount_khr: 12600 },
])
assert.equal(plan.amountPaidUsd, 2.2346)
assert.equal(plan.amountPaidKhr, 12600)
assert.equal(plan.paymentMethod, 'Cash + ABA Bank')
assert.equal(plan.paymentCurrency, 'MIXED')
assert.equal(plan.changeUsd, 0.2346)
assert.equal(plan.changeKhr, 938)
console.log('PASS canonical configured methods, repeated rows, native 4dp USD + whole KHR and derived totals')

for (const [label, patch, code] of [
  ['malformed config', { configuredMethodsRaw: '{' }, 'invalid_payment_methods_setting'],
  ['unknown method', { paymentDetailsRaw: [{ method: 'Wing', amount_usd: 6 }] }, 'inactive_payment_method'],
  ['negative amount', { paymentDetailsRaw: [{ method: 'Cash', amount_usd: -1 }] }, 'invalid_payment_amount'],
  ['partial reduction', { existingPaidUsd: 3 }, 'partial_payment_reduced'],
  ['underpayment', { totalUsd: 99 }, 'insufficient_payment'],
  ['too many rows', { paymentDetailsRaw: Array.from({ length: 13 }, () => ({ method: 'Cash', amount_usd: 1 })) }, 'payment_details_limit'],
]) {
  assert.throws(() => planSaleSettlement({
    configuredMethodsRaw: '["Cash","ABA Bank"]',
    paymentDetailsRaw: [{ method: 'Cash', amount_usd: 2.2346 }, { method: 'ABA Bank', amount_khr: 12600 }],
    existingPaidUsd: 1.2345,
    existingPaidKhr: 0,
    totalUsd: 5,
    exchangeRate: 4200,
    ...patch,
  }), (error) => error instanceof SettlementValidationError && error.code === code, label)
}
console.log('PASS invalid config/method/amount, partial reduction, underpayment and bounds reject before writes')

const renamed = renameSalePaymentMethod(
  'Cash + Fcb',
  JSON.stringify([
    { method: 'Cash', amount_usd: 2, amount_khr: 0 },
    { method: 'Fcb', amount_usd: 1, amount_khr: 0 },
    { method: 'fcb', amount_usd: 0, amount_khr: 4000 },
  ]),
  'fcb',
  'FCB',
)
assert.equal(renamed.ok, true)
assert.equal(renamed.paymentMethod, 'Cash + FCB')
assert.deepEqual(JSON.parse(renamed.paymentDetails), [
  { method: 'Cash', amount_usd: 2, amount_khr: 0 },
  { method: 'FCB', amount_usd: 1, amount_khr: 0 },
  { method: 'FCB', amount_usd: 0, amount_khr: 4000 },
])
assert.equal(renameSalePaymentMethod('Cash + Fcb', '{{{', 'Fcb', 'FCB').ok, false)
console.log('PASS case-only rename rebuilds split summary, preserves repeated tender rows/amounts, blocks malformed detail JSON')
