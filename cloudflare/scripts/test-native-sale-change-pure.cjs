// Native POS change is physical drawer money, unlike the historical pair of
// USD/KHR equivalents. This test pins the explicit intent contract, exact
// first-write validation, durable stored-row classification, and schema.
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Module = require('module')
const ts = require('typescript')

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))
  } finally { Module._load = originalLoad }
  return moduleObj.exports
}

const precision = loadReal('lib/financialPrecision.ts')
const saleTotals = loadReal('lib/saleTotals.ts')
const nativeChange = loadReal('lib/nativeSaleChange.ts', {
  './financialPrecision': precision,
  './saleTotals': saleTotals,
})

let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }
function base(overrides = {}) {
  return {
    actualIntent: true,
    rawChangeUsd: 5,
    rawChangeKhr: 0,
    amountPaidUsd: 20,
    amountPaidKhr: 0,
    totalUsd: 15,
    exchangeRate: 4100,
    changeExchangeRate: 4000,
    fallbackChangeUsd: 5,
    fallbackChangeKhr: 20000,
    ...overrides,
  }
}
function rejects(code, overrides) {
  assert.throws(
    () => nativeChange.planNativeSaleChange(base(overrides)),
    (error) => error instanceof nativeChange.NativeSaleChangeValidationError
      && error.statusCode === 400 && error.code === code,
  )
}

check('absent or false intent preserves the legacy server-computed representation', () => {
  assert.deepStrictEqual(nativeChange.planNativeSaleChange(base({ actualIntent: undefined })), {
    changeUsd: 5, changeKhr: 20000, changeIsActual: 0, changeExchangeRate: null,
  })
  assert.equal(nativeChange.planNativeSaleChange(base({ actualIntent: false })).changeIsActual, 0)
})

check('only literal true opts into actual native change and both fields are required', () => {
  rejects('invalid_actual_change_intent', { actualIntent: 'true' })
  rejects('actual_change_required', { rawChangeUsd: undefined })
  rejects('actual_change_required', { rawChangeKhr: '' })
})

check('USD-only actual change is captured at the server-resolved rate', () => {
  assert.deepStrictEqual(nativeChange.planNativeSaleChange(base()), {
    changeUsd: 5, changeKhr: 0, changeIsActual: 1, changeExchangeRate: 4000,
  })
})

check('KHR-only actual change reconciles payment at main rate and change at captured rate', () => {
  assert.deepStrictEqual(nativeChange.planNativeSaleChange(base({
    rawChangeUsd: 0, rawChangeKhr: 20000, amountPaidUsd: 0, amountPaidKhr: 82000,
  })), { changeUsd: 0, changeKhr: 20000, changeIsActual: 1, changeExchangeRate: 4000 })
})

check('mixed USD and KHR actual change is additive, not two equivalents', () => {
  assert.deepStrictEqual(nativeChange.planNativeSaleChange(base({
    rawChangeUsd: 1, rawChangeKhr: 2000, amountPaidUsd: 20, amountPaidKhr: 4100, totalUsd: 19.5,
  })), { changeUsd: 1, changeKhr: 2000, changeIsActual: 1, changeExchangeRate: 4000 })
})

check('the existing physical 100 KHR round-down is the only denomination shortage allowance', () => {
  const input = base({ rawChangeUsd: 0, rawChangeKhr: 8800, amountPaidUsd: 0, amountPaidKhr: 10000, totalUsd: 0.23 })
  assert.equal(nativeChange.planNativeSaleChange(input).changeKhr, 8800)
  rejects('invalid_actual_change_total', { ...input, rawChangeKhr: 8700 })
  rejects('invalid_actual_change_total', { ...input, rawChangeKhr: 8900 })
  const boundary = base({ rawChangeUsd: 0, rawChangeKhr: 3900, amountPaidUsd: 0, amountPaidKhr: 3999, totalUsd: 0, exchangeRate: 4000 })
  assert.equal(nativeChange.planNativeSaleChange(boundary).changeKhr, 3900, '99 KHR of round-down is allowed')
  rejects('invalid_actual_change_total', { ...boundary, rawChangeKhr: 3899 })
})

check('USD cents, KHR whole riel, sign and canonical overpayment are enforced', () => {
  rejects('invalid_actual_change_precision', { rawChangeUsd: '5.001' })
  rejects('invalid_actual_change_precision', { rawChangeUsd: '5.00001' })
  rejects('invalid_actual_change_precision', { rawChangeKhr: '0.5' })
  rejects('invalid_actual_change_precision', { rawChangeKhr: '0.00001' })
  rejects('invalid_actual_change_amount', { rawChangeUsd: -1 })
  rejects('invalid_actual_change_amount', { rawChangeUsd: '-0.00001' })
  rejects('invalid_actual_change_amount', { rawChangeKhr: '-0.00001' })
  rejects('invalid_actual_change_amount', { rawChangeUsd: '   ' })
  rejects('invalid_actual_change_amount', { rawChangeKhr: 'NaN' })
  rejects('invalid_actual_change_total', { rawChangeUsd: 6 })
  rejects('invalid_actual_change_rate', { exchangeRate: 0 })
  assert.deepStrictEqual(nativeChange.planNativeSaleChange(base({ rawChangeUsd: ' 5.00 ', rawChangeKhr: ' 0 ' })), {
    changeUsd: 5, changeKhr: 0, changeIsActual: 1, changeExchangeRate: 4000,
  })
})

check('USD-only nearest-cent reconciliation has an exact half-cent boundary', () => {
  assert.equal(nativeChange.planNativeSaleChange(base({
    rawChangeUsd: 5, rawChangeKhr: 0, amountPaidUsd: 0, amountPaidKhr: 19980,
    totalUsd: 0, exchangeRate: 4000, changeExchangeRate: 4000,
  })).changeUsd, 5, 'exactly half a cent of over-return is allowed')
  rejects('invalid_actual_change_total', {
    rawChangeUsd: 5, rawChangeKhr: 0, amountPaidUsd: 0, amountPaidKhr: 19979,
    totalUsd: 0, exchangeRate: 4000, changeExchangeRate: 4000,
  })
  assert.equal(nativeChange.planNativeSaleChange(base({
    rawChangeUsd: 5, rawChangeKhr: 0, amountPaidUsd: 0, amountPaidKhr: 20020,
    totalUsd: 0, exchangeRate: 4000, changeExchangeRate: 4000,
  })).changeUsd, 5, 'exactly half a cent of under-return is allowed')
  rejects('invalid_actual_change_total', {
    rawChangeUsd: 5, rawChangeKhr: 0, amountPaidUsd: 0, amountPaidKhr: 20021,
    totalUsd: 0, exchangeRate: 4000, changeExchangeRate: 4000,
  })
})

check('blank or invalid change setting falls back to the canonical main rate', () => {
  assert.equal(nativeChange.planNativeSaleChange(base({ changeExchangeRate: '' })).changeExchangeRate, 4100)
})

check('stored actual change validates durable shape without mutable sale totals', () => {
  assert.deepStrictEqual(nativeChange.resolveStoredNativeSaleChange({
    changeIsActual: 1, changeUsd: 1, changeKhr: 2000, changeExchangeRate: 4000,
  }), { kind: 'actual', usd: 1, khr: 2000, changeExchangeRate: 4000 })
  assert.deepStrictEqual(nativeChange.resolveStoredNativeSaleChange({
    changeIsActual: 1, changeUsd: 0, changeKhr: 0, changeExchangeRate: 4000,
  }), { kind: 'actual', usd: 0, khr: 0, changeExchangeRate: 4000 })
})

check('legacy or malformed stored change is never inferred as actual', () => {
  assert.deepStrictEqual(nativeChange.resolveStoredNativeSaleChange({
    changeIsActual: 0, changeUsd: 5, changeKhr: 20000, changeExchangeRate: null,
  }), { kind: 'unknown' })
  assert.deepStrictEqual(nativeChange.resolveStoredNativeSaleChange({
    changeIsActual: undefined, changeUsd: 0, changeKhr: 0, changeExchangeRate: null,
  }), { kind: 'none', usd: 0, khr: 0 })
  for (const row of [
    { changeIsActual: 1, changeUsd: 1.001, changeKhr: 0, changeExchangeRate: 4000 },
    { changeIsActual: 1, changeUsd: '1.00001', changeKhr: 0, changeExchangeRate: 4000 },
    { changeIsActual: 1, changeUsd: 1, changeKhr: 0.5, changeExchangeRate: 4000 },
    { changeIsActual: 1, changeUsd: 1, changeKhr: '0.00001', changeExchangeRate: 4000 },
    { changeIsActual: 1, changeUsd: -1, changeKhr: 0, changeExchangeRate: 4000 },
    { changeIsActual: 1, changeUsd: '-0.00001', changeKhr: 0, changeExchangeRate: 4000 },
    { changeIsActual: 1, changeUsd: 1, changeKhr: 0, changeExchangeRate: null },
  ]) assert.deepStrictEqual(nativeChange.resolveStoredNativeSaleChange(row), { kind: 'unknown' })
})

check('backend denomination policy stays source-locked to cashier rounding', () => {
  const frontend = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'rielRounding.ts'), 'utf8')
  const match = /export const RIEL_STEP\s*=\s*(\d+)/.exec(frontend)
  assert.ok(match, 'frontend RIEL_STEP must remain explicit')
  assert.equal(nativeChange.NATIVE_CHANGE_KHR_STEP, Number(match[1]))
})

check('migration is append-only and leaves historical provenance unknown', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0127_actual_sale_change.sql'), 'utf8')
  assert.match(migration, /ADD COLUMN change_is_actual INTEGER NOT NULL DEFAULT 0\s+CHECK \(change_is_actual IN \(0, 1\)\)/)
  assert.match(migration, /ADD COLUMN change_exchange_rate REAL;/)
  assert.doesNotMatch(migration, /\bUPDATE\s+sales\b/i, 'historical rows must not be guessed or backfilled')
})

console.log(`\n${passed} native sale change checks passed`)
