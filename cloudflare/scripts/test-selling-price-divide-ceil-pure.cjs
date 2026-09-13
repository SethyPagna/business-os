const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const files = ['cloudflare/src/lib/moneyPrecision.ts', 'frontend/src/utils/moneyPrecision.ts']
const sources = files.map((file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n'))
assert.equal(sources[0], sources[1], 'frontend and Worker money kernels must remain byte-identical')

function transpile(source) {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', output)(mod, mod.exports)
  return mod.exports
}

for (const [index, source] of sources.entries()) {
  const native = require(path.join(root, files[index]))
  const compiled = transpile(source)
  for (const kernel of [native, compiled]) {
    const ceil = kernel.sellingPriceDivideCeilCent
    assert.equal(ceil('4000.01', '4000'), 1.01, 'must not round the quotient to four places before ceiling')
    assert.equal(kernel.sellingPriceCeilCent(kernel.divideMoney4('4000.01', '4000')), 1,
      'fixture must reproduce the lossy former composition')
    assert.equal(ceil('4040', '4000'), 1.01, 'an exact cent remains unchanged')
    assert.equal(ceil('1e-24', '1e24'), 0.01, 'any positive sub-cent rational reaches one cent')
    assert.equal(ceil(0, '4000.01'), 0)
    assert.equal(ceil(kernel.MAX_MONEY_ABS, kernel.MAX_MONEY_ABS), 1)
    assert.throws(() => ceil('-0.0001', 4000), (error) => error instanceof kernel.MoneyPrecisionError
      && error.code === 'negative_selling_price')
    assert.throws(() => ceil(1, 0), (error) => error instanceof kernel.MoneyPrecisionError
      && error.code === 'division_by_zero')
    assert.throws(() => ceil(1, -4000), (error) => error instanceof kernel.MoneyPrecisionError
      && error.code === 'invalid_decimal')
    assert.throws(() => ceil(1, Infinity), (error) => error instanceof kernel.MoneyPrecisionError
      && error.code === 'invalid_decimal')
    assert.throws(() => ceil(kernel.MAX_MONEY_ABS, '0.000001'), (error) => error instanceof kernel.MoneyPrecisionError
      && error.code === 'money_overflow')
  }
}

console.log('PASS exact selling-price divide-then-ceil for native/transpiled frontend and Worker twins')
