import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ACTUAL_KHR_DECIMALS,
  ACTUAL_USD_DECIMALS,
  FINANCIAL_CALCULATION_DECIMALS,
  actualKhrMinorUnits,
  actualKhrValue,
  actualUsdMinorUnits,
  actualUsdValue,
  financialCalculationUnits,
  financialCalculationValue,
  formatScaledUnits,
} from '../src/utils/financialPrecision.ts'

type FixtureCase = { name: string; input: string; units: string; decimal: string }
type ErrorCase = { input: string; code: 'INVALID_DECIMAL' | 'OUT_OF_RANGE' }
type OverflowCase = ErrorCase & { kind: 'calculation' | 'actualUsd' | 'actualKhr' }

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..', '..')
const fixture = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'ops', 'fixtures', 'financial-precision-cases.json'), 'utf8'),
) as {
  policy: Record<string, unknown>
  calculation: FixtureCase[]
  actualUsd: FixtureCase[]
  actualKhr: FixtureCase[]
  invalid: ErrorCase[]
  overflow: OverflowCase[]
}

let failed = 0
let passed = 0

function check(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
    passed += 1
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => {
    return error instanceof Error
      && error.name === 'FinancialPrecisionError'
      && 'code' in error
      && error.code === code
  })
}

check('frontend and Worker precision modules remain byte-identical', () => {
  const frontend = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'utils', 'financialPrecision.ts'), 'utf8')
  const backend = fs.readFileSync(path.join(repoRoot, 'cloudflare', 'src', 'lib', 'financialPrecision.ts'), 'utf8')
  assert.equal(frontend.replace(/\r\n/g, '\n'), backend.replace(/\r\n/g, '\n'))
})

check('fixture records the owner-confirmed precision policy', () => {
  assert.deepEqual(fixture.policy, {
    calculationDecimals: 4,
    actualUsdDecimals: 2,
    actualKhrDecimals: 0,
    rounding: 'nearest-half-up-by-magnitude',
    negativeTies: 'away-from-zero',
  })
  assert.equal(FINANCIAL_CALCULATION_DECIMALS, 4)
  assert.equal(ACTUAL_USD_DECIMALS, 2)
  assert.equal(ACTUAL_KHR_DECIMALS, 0)
})

for (const testCase of fixture.calculation) {
  check(`calculation: ${testCase.name}`, () => {
    const units = financialCalculationUnits(testCase.input)
    assert.equal(units.toString(), testCase.units)
    assert.equal(formatScaledUnits(units, 4), testCase.decimal)
    assert.equal(financialCalculationValue(testCase.input), Number(testCase.decimal))
  })
}

for (const testCase of fixture.actualUsd) {
  check(`actual USD: ${testCase.name}`, () => {
    const units = actualUsdMinorUnits(testCase.input)
    assert.equal(units.toString(), testCase.units)
    assert.equal(formatScaledUnits(units, 2), testCase.decimal)
    assert.equal(actualUsdValue(testCase.input), Number(testCase.decimal))
  })
}

for (const testCase of fixture.actualKhr) {
  check(`actual KHR: ${testCase.name}`, () => {
    const units = actualKhrMinorUnits(testCase.input)
    assert.equal(units.toString(), testCase.units)
    assert.equal(formatScaledUnits(units, 0), testCase.decimal)
    assert.equal(actualKhrValue(testCase.input), Number(testCase.decimal))
  })
}

check('negative values are exact reversals, including ties', () => {
  for (const magnitude of ['0.00004', '0.00005', '1.23444', '1.23445', '999.99995']) {
    assert.equal(financialCalculationUnits(`-${magnitude}`), -financialCalculationUnits(magnitude), magnitude)
  }
})

check('number inputs use their canonical decimal string deterministically', () => {
  assert.equal(financialCalculationValue(0.1 + 0.2), 0.3)
  assert.equal(financialCalculationUnits(1.23445), 12345n)
  assert.equal(actualUsdMinorUnits(1.005), 101n)
  assert.equal(financialCalculationUnits(-0), 0n)
  assert.equal(financialCalculationUnits(123n), 1230000n)
})

for (const testCase of fixture.invalid) {
  check(`invalid input: ${JSON.stringify(testCase.input)}`, () => {
    expectCode(() => financialCalculationUnits(testCase.input), testCase.code)
  })
}

check('non-finite and unsupported runtime values fail closed', () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined, null, {}, []]) {
    expectCode(() => financialCalculationUnits(value as never), 'INVALID_DECIMAL')
  }
})

for (const testCase of fixture.overflow) {
  check(`overflow: ${testCase.kind} ${testCase.input}`, () => {
    const operation = testCase.kind === 'actualUsd'
      ? actualUsdMinorUnits
      : testCase.kind === 'actualKhr'
        ? actualKhrMinorUnits
        : financialCalculationUnits
    expectCode(() => operation(testCase.input), testCase.code)
  })
}

check('calculation and actual currency boundaries remain separate', () => {
  assert.equal(financialCalculationUnits('1.005'), 10050n)
  assert.equal(actualUsdMinorUnits('1.005'), 101n)
  assert.equal(actualKhrMinorUnits('1.005'), 1n)
})

if (failed > 0) process.exitCode = 1
console.log(`\n${passed} frontend financial-precision checks passed.`)
