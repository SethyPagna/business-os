const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const files = ['frontend/src/utils/moneyPrecision.ts', 'cloudflare/src/lib/moneyPrecision.ts']
const texts = files.map(file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n'))
assert.equal(texts[0], texts[1], 'portable source twins remain identical')
const modules = files.flatMap((file, i) => {
  const { outputText } = ts.transpileModule(texts[i], { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const mod = { exports: {} }
  new Function('module', 'exports', outputText)(mod, mod.exports)
  return [{ label: file + ' native', m: require(path.join(root, file)) }, { label: file + ' transpiled', m: mod.exports }]
})
const vectors = [
  [['.01', '3', '33.3333'], .01],
  [['.0001', '.5', '50'], 0], // A rounded product first incorrectly yields .0001.
  [['.01', '.015', '33.3333'], 0],
  [['.01', '.0150001', '33.3333'], .0001],
  [['.01', '.015', '33.333333333333333333333333'], 0],
  [['.01', '.015', '33.333333333333333333333334'], .0001],
  [['.0001', '.999999', '50'], 0],
  [['.0001', '1', '50'], .0001],
  [['.0001', '1.000001', '50'], .0001],
  [['-.0001', '1', '50'], -.0001],
  [['.0001', '-1', '50'], -.0001],
  [['.0001', '1', '-50'], -.0001],
  [['-.0001', '-1', '-50'], -.0001],
  [['1e-12', '1e12', '100'], 1], // Quantity is not a monetary amount.
  [['1e-24', '100', '1e24'], 1], // Percent is not a monetary amount.
  [['1e11', '100', '1'], 1e11], // No rounded/bounded intermediate product.
  [['0', '5', '100'], 0], [['5', '0', '100'], 0], [['5', '3', '0'], 0],
  [[0, 0, 0], 0], [[.01, 3, 33.3333], .01],
]
// Independent integer oracle: generated decimal operands have exactly six
// places, hence product/100 has denominator 10^20. Convert directly to ticks.
function text6(value) {
  const digits = String(value < 0n ? -value : value).padStart(7, '0')
  return (value < 0n ? '-' : '') + digits.slice(0, -6) + '.' + digits.slice(-6)
}
function oracle6(a, q, p) {
  const n = a * q * p, magnitude = n < 0n ? -n : n
  const ticks = (magnitude + 5_000_000_000_000_000n) / 10_000_000_000_000_000n
  return (Number(ticks) * (n < 0n ? -1 : 1)) / 10000 || 0
}
let seed = 1729n
function next() { seed = (seed * 48271n) % 2147483647n; return seed - 1073741823n }
const generated = Array.from({ length: 400 }, () => {
  const a = next(), q = next(), p = next()
  return [[text6(a), text6(q), text6(p)], oracle6(a, q, p)]
})
for (const { label, m } of modules) {
  for (const [args, expected] of [...vectors, ...generated]) {
    assert.equal(m.percentageProductMoney4(...args), expected, `${label}: ${JSON.stringify(args)}`)
  }
  assert.notEqual(m.multiplyMoney4(m.percentageMoney4('.01', '33.3333'), '3'), .01,
    'positive control detects per-unit intermediate rounding')
  assert.notEqual(m.percentageMoney4(m.multiplyMoney4('.0001', '.5'), '50'), 0,
    'positive control detects product intermediate rounding')
  assert.equal(Object.is(m.percentageProductMoney4('-0.00001', '1', '1'), -0), false)
  const rejects = (args, code) => assert.throws(() => m.percentageProductMoney4(...args),
    e => e instanceof m.MoneyPrecisionError && e.code === code, `${label}: ${JSON.stringify(args)}`)
  for (const invalid of [null, undefined, true, '', ' ', 'bad', '1,000', Infinity, NaN, '1e25', '0.' + '1'.repeat(25)]) {
    for (let index = 0; index < 3; index++) {
      const args = ['0', '0', '0']; args[index] = invalid
      rejects(args, 'invalid_decimal') // Zero must not hide an invalid other operand.
    }
  }
  rejects(['100000000000.000001', '0', '0'], 'money_overflow')
  rejects(['-100000000000.000001', '0', '0'], 'money_overflow')
  rejects(['1e11', '2', '100'], 'money_overflow')
  rejects(['-1e11', '2', '100'], 'money_overflow')
  assert.equal(m.percentageMoney4('.01', '33.3333'), .0033, 'existing primitive unchanged')
  assert.equal(m.multiplyMoney4('.0001', '.5'), .0001, 'existing primitive unchanged')
}
console.log(`percentage product money kernel: ${modules.length} native/transpiled twin modes, ${vectors.length + generated.length} exact vectors each PASS`)
