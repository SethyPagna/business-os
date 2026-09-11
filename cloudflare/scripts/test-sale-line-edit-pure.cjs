const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const assert = require('node:assert/strict')

function compile(file, stubs = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', file)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const moduleObj = { exports: {} }
  const localRequire = (request) => Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : require(request)
  new Function('exports', 'require', 'module', output)(moduleObj.exports, localRequire, moduleObj)
  return moduleObj.exports
}

const { planSaleLinePriceEdit } = compile('saleLineEdit.ts', { './saleTotals': compile('saleTotals.ts') })

assert.deepStrictEqual(planSaleLinePriceEdit({ basePriceUsd: 30, discountType: 'fixed', discountValue: 3, claimedManualDiscountUsd: 3, claimedAppliedPriceUsd: 27 }), {
  ok: true, basePriceUsd: 30, discountType: 'fixed', discountValue: 3, manualDiscountUsd: 3, appliedPriceUsd: 27,
})
assert.deepStrictEqual(planSaleLinePriceEdit({ basePriceUsd: 30, discountType: 'percent', discountValue: 10, claimedManualDiscountUsd: 3, claimedAppliedPriceUsd: 27 }), {
  ok: true, basePriceUsd: 30, discountType: 'percent', discountValue: 10, manualDiscountUsd: 3, appliedPriceUsd: 27,
})
assert.equal(planSaleLinePriceEdit({ basePriceUsd: 30, discountType: 'percent', discountValue: 10, claimedAppliedPriceUsd: 26 }).ok, false)
assert.equal(planSaleLinePriceEdit({ basePriceUsd: 30, discountType: 'fixed', discountValue: 31, claimedAppliedPriceUsd: 0 }).ok, false)
assert.equal(planSaleLinePriceEdit({ basePriceUsd: 30, discountType: 'percent', discountValue: 101, claimedAppliedPriceUsd: 0 }).ok, false)
assert.equal(planSaleLinePriceEdit({ basePriceUsd: 30, discountType: null, discountValue: 99, claimedAppliedPriceUsd: 30 }).ok, true)

console.log('sale line layered price kernel: all cases pass')
