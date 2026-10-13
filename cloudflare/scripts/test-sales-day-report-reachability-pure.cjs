'use strict'
// getSalesDayReport answers from the verified snapshot (readSalesReportSnapshot +
// the kernel reducers). Until 6.0.120 it ALSO carried ~60 lines of the retired
// SQL path (getSalesTotals / getPaymentMethodBreakdown / getDeliveryContactTotals
// plus a LIMIT 1000 per-sale SELECT) after an unconditional `return`, so the
// file read as if two implementations existed and a fix applied to the wrong
// one looked right in review (Sonnet area review of release 2, finding 10).
//
// The proof is the compiler's own control-flow analysis, not a grep: with
// allowUnreachableCode:false it reports TS7027 on every statement that cannot run.
//   1. positive control: the same instrument DOES flag a function with a dead
//      tail, so "no diagnostics" below cannot be an instrument that sees nothing;
//   2. no TS7027 inside getSalesDayReport;
//   3. the function names only the snapshot path: no `.prepare(` of its own and
//      none of the three retired helpers is called from it.
//
// Run (from cloudflare/): node scripts/test-sales-day-report-reachability-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require(path.join(__dirname, '..', 'node_modules', 'typescript'))

let checks = 0
const check = (label, fn) => { fn(); checks += 1; console.log(`PASS ${label}`) }

const OPTIONS = { allowUnreachableCode: false, noResolve: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, types: [] }

function unreachableIn(fileName, text) {
  const host = ts.createCompilerHost(OPTIONS)
  const original = host.getSourceFile.bind(host)
  host.getSourceFile = (name, ...rest) => (path.resolve(name) === path.resolve(fileName) ? ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true) : original(name, ...rest))
  host.fileExists = (name) => path.resolve(name) === path.resolve(fileName) || ts.sys.fileExists(name)
  host.readFile = (name) => (path.resolve(name) === path.resolve(fileName) ? text : ts.sys.readFile(name))
  const program = ts.createProgram([fileName], OPTIONS, host)
  const source = program.getSourceFile(fileName)
  return { source, hits: program.getSemanticDiagnostics(source).filter((d) => d.code === 7027) }
}
const functionNamed = (source, name) => {
  let found = null
  ts.forEachChild(source, (node) => { if (ts.isFunctionDeclaration(node) && node.name && node.name.text === name) found = node })
  return found
}

check('control: the instrument flags an early return followed by a retired path', () => {
  const synthetic = 'export async function demo(x: number): Promise<number> {\n  {\n    return x\n  }\n  const legacy = x + 1\n  return legacy\n}\n'
  const { hits } = unreachableIn(path.join(__dirname, '__reachability_control__.ts'), synthetic)
  assert.equal(hits.length, 1, 'TS7027 must be reported for the dead tail')
})

const file = path.join(__dirname, '..', 'src', 'lib', 'salesAnalytics.ts')
const text = fs.readFileSync(file, 'utf8')
const { source, hits } = unreachableIn(file, text)
const dayReport = functionNamed(source, 'getSalesDayReport')

check('getSalesDayReport exists and is analysed', () => {
  assert.ok(dayReport, 'getSalesDayReport declaration found')
  assert.ok(dayReport.body.statements.length >= 5, 'the live path is still there')
})

check('no statement inside getSalesDayReport is unreachable', () => {
  const inside = hits.filter((d) => d.start >= dayReport.getStart(source) && d.start <= dayReport.getEnd())
  assert.deepEqual(inside.map((d) => source.getLineAndCharacterOfPosition(d.start).line + 1), [])
})

check('getSalesDayReport reads only through the snapshot kernel', () => {
  const body = dayReport.getText(source)
  assert.ok(!/\.prepare\(/.test(body), 'no SQL of its own')
  for (const retired of ['getSalesTotals(', 'getPaymentMethodBreakdown(', 'getDeliveryContactTotals(']) {
    assert.ok(!body.includes(retired), `${retired} is not called from the day report`)
  }
  for (const live of ['readSalesReportSnapshot(', 'exactReportTotals(', 'paymentMethodBreakdownFromSnapshot(', 'deliveryContactTotalsFromSnapshot(']) {
    assert.ok(body.includes(live), `${live} carries the day report`)
  }
})

console.log(`GREEN sales day report reachability: ${checks} checks hold`)
