'use strict'
// getSalesDayReport, getSalesGroupedTotals and getProductSalesRanking answer from the
// verified snapshot (readSalesReportSnapshot / getSalesGroupedReport / getProductSalesReport).
// Until 6.0.120 / 6.0.161 each ALSO carried 50-100 lines of the retired SQL path after an
// unconditional `return`, so the file read as if two implementations existed and a fix
// applied to the wrong one looked right in review (Sonnet area review of release 2,
// finding 10; Opus correctness hunt H6).
//
// The proof is the compiler's own control-flow analysis, not a grep: with
// allowUnreachableCode:false it reports TS7027 on every statement that cannot run.
//   1. positive control: the same instrument DOES flag a function with a dead tail, so
//      "no diagnostics" below cannot be an instrument that sees nothing;
//   2. no TS7027 inside any of the three functions;
//   3. each function names only its snapshot path: no `.prepare(` of its own and none of
//      the retired helpers is called from it.
//
// getBusinessSummaryDayRows still carries the same kind of dead tail; it is deliberately not
// asserted here (not part of this lane) -- see the lane report.
//
// Run (from cloudflare/): node scripts/test-sales-kernel-reachability-pure.cjs
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

// name -> what carries it now, and the retired helpers it must not call
const SNAPSHOT_FUNCTIONS = {
  getSalesDayReport: {
    live: ['readSalesReportSnapshot(', 'exactReportTotals(', 'paymentMethodBreakdownFromSnapshot(', 'deliveryContactTotalsFromSnapshot('],
    retired: ['getSalesTotals(', 'getPaymentMethodBreakdown(', 'getDeliveryContactTotals('],
    minStatements: 5,
  },
  getSalesGroupedTotals: {
    live: ['getSalesGroupedReport('],
    retired: ['salesGroupExprs(', 'returnedCostByBucket(', 'cancelledGroupCounts(', 'customerIdentityByGroup(', 'cohortCountsByGroup(', 'branchActivityByGroup(', 'deriveTotals('],
    minStatements: 1,
  },
  getProductSalesRanking: {
    live: ['getProductSalesReport('],
    retired: ['whereActiveSales(', 'recognizedExpr('],
    minStatements: 1,
  },
}

for (const [name, expectation] of Object.entries(SNAPSHOT_FUNCTIONS)) {
  const declaration = functionNamed(source, name)
  check(`${name} exists and its live path is still there`, () => {
    assert.ok(declaration, `${name} declaration found`)
    assert.ok(declaration.body.statements.length >= expectation.minStatements)
  })
  check(`no statement inside ${name} is unreachable`, () => {
    const inside = hits.filter((d) => d.start >= declaration.getStart(source) && d.start <= declaration.getEnd())
    assert.deepEqual(inside.map((d) => source.getLineAndCharacterOfPosition(d.start).line + 1), [])
  })
  check(`${name} reads only through the snapshot kernel`, () => {
    const body = declaration.getText(source)
    assert.ok(!/\.prepare\(/.test(body), 'no SQL of its own')
    for (const retired of expectation.retired) assert.ok(!body.includes(retired), `${retired} is not called from ${name}`)
    for (const live of expectation.live) assert.ok(body.includes(live), `${live} carries ${name}`)
  })
}

console.log(`GREEN sales kernel reachability: ${checks} checks hold`)
