// The Worker's "still owed" after a line change reads the one definition of
// paid (lib/saleStatusResolution.ts): zero when the recorded tender covers the
// new total to within half a US cent, otherwise the exact shortfall in cents.
//
// Both line-change responses report it: the add-items route (inline) and every
// amendment through buildAmendmentResponsePayload. They used to compute
// round2(total - paidUsd - paidKhr / rate), which prints $0.01 owed for a sale
// short by exactly half a cent -- a tender the POS records Completed and the
// status rules call paid.
//
// DISCRIMINATING: the real buildAmendmentResponsePayload is extracted from
// routes/sales.ts and run. On the tree before this change it answers 0.01 at
// the 50-unit edge ($9.995 paid on $10, and 37,980 riel for $9.50 at 4,000),
// so those cases are red there; the 51-unit, exact, partial and owner cases
// pass on both and pin that the band did not swallow a real debt.
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

const { round2 } = load('lib/saleTotals.ts')
const { recordedSaleOutstandingUsd } = load('lib/saleStatusResolution.ts')

const routeText = fs.readFileSync(path.join(root, 'src/routes/sales.ts'), 'utf8').replace(/\r\n/g, '\n')
const ast = ts.createSourceFile('sales.ts', routeText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const wanted = new Set(['outstandingAfterLineChangeUsd', 'buildAmendmentResponsePayload'])
const extracted = ast.statements
  .filter((statement) => ts.isFunctionDeclaration(statement) && wanted.has(statement.name?.text))
  .map((statement) => statement.getText(ast)).join('\n')
const compiled = ts.transpileModule(`${extracted}\nexports.buildAmendmentResponsePayload = buildAmendmentResponsePayload`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exported = {}
new Function('exports', 'round2', 'recordedSaleOutstandingUsd', compiled)(exported, round2, recordedSaleOutstandingUsd)

const owed = (sale, totalUsd, exchangeRate) => exported.buildAmendmentResponsePayload({
  saleId: 1, sale: { receipt_number: 'R1', ...sale },
  money: { totalUsd, totalKhr: 0, subtotalUsd: totalUsd },
  exchangeRate, stockMoved: false, unitsMoved: 0, stockSkipped: false,
  tax: { taxUsd: 0, recomputed: false, reason: 'no_tax_on_sale' },
}, null).outstandingUsd
const v1 = (paidUsd, paidKhr, total) => ({ amount_paid_usd: paidUsd, amount_paid_khr: paidKhr, money_precision_version: 1, calculated_total_usd: total })

let failed = 0
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

check('half a cent short owes nothing (the 50-unit edge)', () => {
  assert.equal(owed(v1(9.995, 0, 10), 10, 4100), 0, '$9.995 paid on $10')
  assert.equal(owed(v1(0, 37980, 9.5), 9.5, 4000), 0, '37,980 riel for $9.50 at 4,000 is $0.0050 short')
  assert.equal(owed({ amount_paid_usd: 9.995, amount_paid_khr: 0 }, 10, 4100), 0, 'a legacy row reads the same rule')
})

check('the owner tender (39,400 riel for $9.61 at 4,100) owes nothing', () => {
  assert.equal(owed(v1(0, 39400, 9.61), 9.61, 4100), 0)
})

check('one unit past the band is owed, in cents', () => {
  assert.equal(owed(v1(9.9949, 0, 10), 10, 4100), 0.01, '$0.0051 short')
  assert.equal(owed(v1(0, 40979, 10), 10, 4100), 0.01, '21 riel short at 4,100')
})

check('exact payment, overpayment and a real partial tender are unchanged', () => {
  assert.equal(owed(v1(10, 0, 10), 10, 4100), 0)
  assert.equal(owed(v1(20, 0, 10), 10, 4100), 0, 'an overpayment is change, never a balance')
  assert.equal(owed(v1(3, 12300, 10), 10, 4100), 4, 'a partial tender names its balance')
  assert.equal(owed(v1(0, 0, 10), 12.5, 4100), 12.5, 'a line added to an unpaid sale owes the new total')
})

check('money that cannot be read owes the whole total', () => {
  assert.equal(owed(v1(10, 0, 10), 10, 0), 10, 'a zero rate is not evidence of payment')
})

check('both line-change responses ask the same function, and no float shortfall remains', () => {
  const calls = routeText.match(/outstandingUsd: outstandingAfterLineChangeUsd\(/g) || []
  assert.equal(calls.length, 2, 'add-items and buildAmendmentResponsePayload')
  assert.match(routeText, /outstandingUsd: outstandingAfterLineChangeUsd\(sale, moneyAfter\.total_usd, exchangeRate\)/)
  assert.doesNotMatch(routeText, /amount_paid_khr\) \|\| 0\) \/ (input\.)?exchangeRate/, 'the float formula is gone')
})

if (failed > 0) {
  console.error(`${failed} check(s) failed`)
  process.exit(1)
}
