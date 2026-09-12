const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const paths = ['cloudflare/src/lib/moneyPrecision.ts', 'frontend/src/utils/moneyPrecision.ts']
const texts = paths.map(file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n'))
assert.equal(texts[0], texts[1], 'portable twins must be identical, not merely expose the same API')
function load(text) {
  const { outputText } = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const mod = { exports: {} }
  new Function('module', 'exports', outputText)(mod, mod.exports)
  return mod.exports
}
const signatures = []
for (const [index, text] of texts.entries()) {
  const m = load(text), results = []
  const check = (name, args, expected) => {
    const value = m[name](...args)
    assert.deepEqual(value, expected, `${paths[index]} ${name}(${JSON.stringify(args)})`)
    results.push([name, args, value])
  }
  const rejects = (name, args, code) => assert.throws(() => m[name](...args), e => e instanceof m.MoneyPrecisionError && e.code === code)
  check('roundMoney4', ['1.2345'], 1.2345)
  check('roundMoney4', ['1.23455'], 1.2346)
  check('roundMoney4', ['-1.23455'], -1.2346)
  check('roundMoney4', ['0.00015'], 0.0002)
  check('roundMoney4', [-0], 0)
  assert.equal(Object.is(m.roundMoney4('-0.00001'), -0), false)
  check('roundMoney4', [' +.12345e1 '], 1.2345)
  check('roundMoney4', [1e-7], 0)
  check('nullableMoney4', [null], null)
  check('nullableMoney4', [undefined], null)
  check('nullableMoney4', ['  '], null)
  check('nullableMoney4', [0], 0)
  check('roundMoney2', ['10.075'], 10.08)
  check('roundMoney2', ['-10.075'], -10.08)
  check('addMoney4', ['0.1', '0.2'], 0.3)
  check('subtractMoney4', ['1.2345', '1.23'], 0.0045)
  check('multiplyMoney4', ['1.2345', '100'], 123.45)
  check('multiplyMoney4', ['0.0003', '0.5'], 0.0002)
  check('multiplyMoney4', ['-0.0003', '0.5'], -0.0002)
  check('multiplyMoney4', ['1.2345', '0.00012345'], 0.0002)
  check('divideMoney4', ['1', '3'], 0.3333)
  check('divideMoney4', ['-1', '6'], -0.1667)
  check('divideMoney4', ['0.0001', '0.00001'], 10)
  check('sumMoney4', [['0.00004', '0.00004']], 0.0001)
  check('sumMoney4', [[]], 0)
  check('sumMoney4', [[m.MAX_MONEY_ABS, m.MAX_MONEY_ABS, -m.MAX_MONEY_ABS]], m.MAX_MONEY_ABS)
  check('meanMoney4', [['1', '1.0001', '1.0003']], 1.0001)
  check('meanMoney4', [[m.MAX_MONEY_ABS, m.MAX_MONEY_ABS]], m.MAX_MONEY_ABS)
  check('sellingPriceCeilCent', ['1.2345'], 1.24)
  check('sellingPriceCeilCent', ['1.2300'], 1.23)
  check('sellingPriceCeilCent', ['0.0001'], 0.01)
  check('sellingPriceCeilCent', ['0'], 0)
  check('settlementRounding4', ['1.2345'], { internalTotal4: 1.2345, payableTotal2: 1.23, roundingAdjustment4: -0.0045 })
  check('settlementRounding4', ['1.2350'], { internalTotal4: 1.235, payableTotal2: 1.24, roundingAdjustment4: 0.005 })
  check('settlementRounding4', ['-1.2350'], { internalTotal4: -1.235, payableTotal2: -1.24, roundingAdjustment4: -0.005 })
  check('settlementRounding4', ['0'], { internalTotal4: 0, payableTotal2: 0, roundingAdjustment4: 0 })
  for (const bad of [null, undefined, '', ' ', true, false, NaN, Infinity, -Infinity, 'Infinity', 'NaN', '1,000', '$1.23', '1x', '0x10', '1e999', '1e25', '0.' + '0'.repeat(24) + '1', '1'.repeat(41), {}, []]) {
    rejects('roundMoney4', [bad], 'invalid_decimal')
  }
  rejects('nullableMoney4', [Infinity], 'invalid_decimal')
  rejects('multiplyMoney4', [0, Infinity], 'invalid_decimal')
  rejects('sellingPriceCeilCent', [-0.0001], 'negative_selling_price')
  rejects('divideMoney4', [1, 0], 'division_by_zero')
  rejects('divideMoney4', [1, '-0.0000'], 'division_by_zero')
  rejects('meanMoney4', [[]], 'division_by_zero')
  rejects('sumMoney4', [Array(m.MAX_MONEY_SUM_ITEMS + 1).fill(0)], 'too_many_terms')
  rejects('roundMoney4', ['100000000000.0001'], 'money_overflow')
  rejects('multiplyMoney4', [m.MAX_MONEY_ABS, 2], 'money_overflow')
  rejects('divideMoney4', [1, '1e-24'], 'money_overflow')
  rejects('addMoney4', [m.MAX_MONEY_ABS, '0.0001'], 'money_overflow')
  check('roundMoney4', ['999999999.9999'], 999999999.9999)
  check('roundMoney4', ['8000000000.1234'], 8000000000.1234)
  check('roundMoney4', ['99999999999.9999'], 99999999999.9999)
  check('roundMoney4', [m.MAX_MONEY_ABS], m.MAX_MONEY_ABS)
  check('roundMoney4', [-m.MAX_MONEY_ABS], -m.MAX_MONEY_ABS)
  for (let n = 0n; n < 2000n; n++) {
    const units = 1000000000000000n - n
    const input = `${units / 10000n}.${String(units % 10000n).padStart(4, '0')}`
    for (const sign of ['', '-']) {
      const result = m.roundMoney4(sign + input)
      assert.equal(m.roundMoney4(JSON.parse(JSON.stringify(result))), result)
      assert.equal(result, Number(sign + input))
    }
  }

  // Independent integer expectations over every midpoint near zero. No float
  // intermediate is used to construct the expected rounded four-decimal unit.
  for (let i = -2000; i <= 2000; i++) {
    const scaled5 = BigInt(i), negative = scaled5 < 0n, absolute = negative ? -scaled5 : scaled5
    const text5 = `${negative ? '-' : ''}${absolute / 100000n}.${String(absolute % 100000n).padStart(5, '0')}`
    const expectedUnits = (absolute + 5n) / 10n * (negative ? -1n : 1n)
    assert.equal(m.roundMoney4(text5), Number(expectedUnits) / 10000 || 0)
    const rounded = m.roundMoney4(text5)
    assert.equal(m.roundMoney4(rounded), rounded, 'numeric JSON boundary is idempotent')
    const settlement = m.settlementRounding4(text5)
    assert.equal(m.addMoney4(settlement.internalTotal4, settlement.roundingAdjustment4), settlement.payableTotal2)
    assert.ok(Math.abs(settlement.roundingAdjustment4) <= 0.005)
  }
  signatures.push(JSON.stringify(results))
  console.log(`${paths[index]}: PASS explicit vectors,4001 signed rounding cases,settlement conservation,invalid/range guards`)
}
assert.equal(signatures[0], signatures[1], 'execution parity')
console.log('test-money-precision-kernel: PASS source and execution parity')
