// Pure policy test for src/lib/financialPrecision.ts.
// Run: node scripts/test-financial-precision-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const cloudflareRoot = path.join(__dirname, '..')
const repoRoot = path.join(cloudflareRoot, '..')
const sourcePath = path.join(cloudflareRoot, 'src', 'lib', 'financialPrecision.ts')
const fixture = JSON.parse(fs.readFileSync(path.join(repoRoot, 'ops', 'fixtures', 'financial-precision-cases.json'), 'utf8'))

let passed = 0
function check(name, fn) {
  try {
    fn()
    console.log('PASS', name)
    passed += 1
  } catch (error) {
    console.error('FAIL', name, '-', error.message)
    process.exitCode = 1
  }
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.name === 'FinancialPrecisionError' && error.code === code)
}

async function main() {
  const precision = await import(pathToFileURL(sourcePath).href)

  check('fixture records the owner-confirmed precision policy', () => {
    assert.deepEqual(fixture.policy, {
      calculationDecimals: 4,
      actualUsdDecimals: 2,
      actualKhrDecimals: 0,
      rounding: 'nearest-half-up-by-magnitude',
      negativeTies: 'away-from-zero',
    })
    assert.equal(precision.FINANCIAL_CALCULATION_DECIMALS, 4)
    assert.equal(precision.ACTUAL_USD_DECIMALS, 2)
    assert.equal(precision.ACTUAL_KHR_DECIMALS, 0)
  })

  for (const testCase of fixture.calculation) {
    check(`calculation: ${testCase.name}`, () => {
      const units = precision.financialCalculationUnits(testCase.input)
      assert.equal(units.toString(), testCase.units)
      assert.equal(precision.formatScaledUnits(units, 4), testCase.decimal)
      assert.equal(precision.financialCalculationValue(testCase.input), Number(testCase.decimal))
    })
  }

  for (const testCase of fixture.actualUsd) {
    check(`actual USD: ${testCase.name}`, () => {
      const units = precision.actualUsdMinorUnits(testCase.input)
      assert.equal(units.toString(), testCase.units)
      assert.equal(precision.formatScaledUnits(units, 2), testCase.decimal)
      assert.equal(precision.actualUsdValue(testCase.input), Number(testCase.decimal))
    })
  }

  for (const testCase of fixture.actualKhr) {
    check(`actual KHR: ${testCase.name}`, () => {
      const units = precision.actualKhrMinorUnits(testCase.input)
      assert.equal(units.toString(), testCase.units)
      assert.equal(precision.formatScaledUnits(units, 0), testCase.decimal)
      assert.equal(precision.actualKhrValue(testCase.input), Number(testCase.decimal))
    })
  }

  check('negative values are exact reversals, including ties', () => {
    for (const magnitude of ['0.00004', '0.00005', '1.23444', '1.23445', '999.99995']) {
      assert.equal(
        precision.financialCalculationUnits(`-${magnitude}`),
        -precision.financialCalculationUnits(magnitude),
        magnitude,
      )
    }
  })

  check('number inputs use their canonical decimal string deterministically', () => {
    assert.equal(precision.financialCalculationValue(0.1 + 0.2), 0.3)
    assert.equal(precision.financialCalculationUnits(1.23445), 12345n)
    assert.equal(precision.actualUsdMinorUnits(1.005), 101n)
    assert.equal(precision.financialCalculationUnits(-0), 0n)
    assert.equal(precision.financialCalculationUnits(123n), 1230000n)
  })

  for (const testCase of fixture.invalid) {
    check(`invalid input: ${JSON.stringify(testCase.input)}`, () => {
      expectCode(() => precision.financialCalculationUnits(testCase.input), testCase.code)
    })
  }

  check('non-finite and unsupported runtime values fail closed', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined, null, {}, []]) {
      expectCode(() => precision.financialCalculationUnits(value), 'INVALID_DECIMAL')
    }
  })

  for (const testCase of fixture.overflow) {
    check(`overflow: ${testCase.kind} ${testCase.input}`, () => {
      const operation = testCase.kind === 'actualUsd'
        ? precision.actualUsdMinorUnits
        : testCase.kind === 'actualKhr'
          ? precision.actualKhrMinorUnits
          : precision.financialCalculationUnits
      expectCode(() => operation(testCase.input), testCase.code)
    })
  }

  check('calculation and actual currency boundaries remain separate', () => {
    assert.equal(precision.financialCalculationUnits('1.005'), 10050n)
    assert.equal(precision.actualUsdMinorUnits('1.005'), 101n)
    assert.equal(precision.actualKhrMinorUnits('1.005'), 1n)
  })

  console.log(`\n${passed} financial-precision checks passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
