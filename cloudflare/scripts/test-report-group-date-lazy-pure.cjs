'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createHash } = require('node:crypto')
const ts = require('typescript')
const { transformSync } = require('esbuild')

const sourcePath = path.resolve(__dirname, '../src/lib/salesAnalytics.ts')
const sha = text => createHash('sha256').update(text).digest('hex')

function declaration(text) {
  const file = ts.createSourceFile(sourcePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  assert.equal(file.parseDiagnostics.length, 0, 'Actual TypeScript source parses')
  const nodes = file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'reportGroupIdentity')
  assert.equal(nodes.length, 1, 'Exactly one actual reportGroupIdentity declaration')
  assert.ok(nodes[0].body, 'Actual declaration has a body')
  return { text: nodes[0].getText(file), bodyStart: nodes[0].body.getStart(file) - nodes[0].getStart(file) + 1 }
}

function probe(text) {
  let constructions = 0
  const ForwardDate = new Proxy(Date, { construct(target, args, newTarget) {
    constructions += 1
    return Reflect.construct(target, args, newTarget)
  } })
  const compiled = transformSync(text, { loader: 'ts', format: 'cjs', target: 'es2022', sourcefile: sourcePath }).code
  const context = vm.createContext({ module: { exports: {} }, Date: ForwardDate })
  new vm.Script(compiled + '\nmodule.exports = reportGroupIdentity;', { filename: sourcePath }).runInContext(context, { timeout: 1000 })
  assert.equal(typeof context.module.exports, 'function', 'Actual helper is callable')
  assert.equal(new vm.Script("new Date('2026-10-25T17:00:00Z').getUTCHours()").runInContext(context, { timeout: 1000 }), 17, 'Forwarding Date preserves native UTC behavior')
  assert.equal(constructions, 1, 'Date construction observer is active')
  const invoke = new vm.Script('module.exports(__row, __group)', { filename: sourcePath })
  return {
    compiled_sha256: sha(compiled),
    invoke(row, group) {
      constructions = 0
      context.__row = row
      context.__group = group
      const result = invoke.runInContext(context, { timeout: 1000 })
      assert.ok(result && typeof result === 'object' && !Array.isArray(result), 'Identity returns a flat object')
      return { value: { ...result }, constructions }
    },
  }
}

const base = { id: 1, customer_id: 7, customer_name: '  Ada  ', customer_is_anonymous: 0,
  cashier_id: 4, cashier_name: '  MiA  ', payment_method: '  CaSH  ', branch_id: 2, branch_name: '  Shop  ',
  created_at: '2026-10-25 17:00:00' }
const identity = (key, label, entity_id) => ({ key, label, entity_id })
const withoutAnonymous = { ...base }; delete withoutAnonymous.customer_is_anonymous
const vectors = [
  { name: 'customer-id', group: 'customer', row: base, expected: identity('id:7', 'Ada', 7) },
  { name: 'customer-anonymous', group: 'customer', row: { ...base, customer_is_anonymous: 1 }, expected: identity('general', '', null) },
  { name: 'customer-null', group: 'customer', row: { ...base, customer_id: null, customer_name: 'Walk in' }, expected: identity('general', '', null) },
  { name: 'customer-zero', group: 'customer', row: { ...base, customer_id: 0 }, expected: identity('id:0', 'Ada', 0) },
  { name: 'customer-missing-anonymous', group: 'customer', row: withoutAnonymous, expected: identity('general', '', null) },
  { name: 'customer-null-anonymous', group: 'customer', row: { ...base, customer_is_anonymous: null }, expected: identity('id:7', 'Ada', 7) },
  { name: 'customer-string-zero-anonymous', group: 'customer', row: { ...base, customer_is_anonymous: '0' }, expected: identity('id:7', 'Ada', 7) },
  { name: 'customer-empty-name', group: 'customer', row: { ...base, customer_name: '' }, expected: identity('id:7', '', 7) },
  { name: 'cashier-id', group: 'cashier', row: base, expected: identity('id:4', 'MiA', 4) },
  { name: 'cashier-name-case', group: 'cashier', row: { ...base, cashier_id: null }, expected: identity('name:mia', 'MiA', null) },
  { name: 'cashier-zero', group: 'cashier', row: { ...base, cashier_id: 0 }, expected: identity('id:0', 'MiA', 0) },
  { name: 'cashier-empty', group: 'cashier', row: { ...base, cashier_id: null, cashier_name: '' }, expected: identity('name:', '', null) },
  { name: 'payment-case-trim', group: 'payment_method', row: base, expected: identity('cash', 'CaSH', null) },
  { name: 'payment-blank', group: 'payment_method', row: { ...base, payment_method: '   ' }, expected: identity('unknown', '', null) },
  { name: 'payment-null', group: 'payment_method', row: { ...base, payment_method: null }, expected: identity('unknown', '', null) },
  { name: 'payment-numeric-zero', group: 'payment_method', row: { ...base, payment_method: 0 }, expected: identity('unknown', '', null) },
  { name: 'branch-raw-label', group: 'branch', row: base, expected: identity('2', '  Shop  ', 2) },
  { name: 'branch-null', group: 'branch', row: { ...base, branch_id: null }, expected: identity('0', '  Shop  ', null) },
  { name: 'branch-zero', group: 'branch', row: { ...base, branch_id: 0 }, expected: identity('0', '  Shop  ', 0) },
  { name: 'branch-empty-label', group: 'branch', row: { ...base, branch_name: null }, expected: identity('2', '', 2) },
  { name: 'runtime-fallback-branch', group: 'not-a-public-group', row: base, expected: identity('2', '  Shop  ', 2) },
]
const timeVectors = [
  ['utc-before-midnight', '2026-10-25 16:59:59', '23', '0'],
  ['utc-midnight', '2026-10-25 17:00:00', '00', '1'],
  ['iso-z', '2026-10-25T17:00:00Z', '00', '1'],
  ['iso-lowercase-z', '2026-10-25T17:00:00z', '00', '1'],
  ['positive-offset', '2026-10-26T00:00:00+07:00', '00', '1'],
  ['compact-offset', '2026-10-26T00:00:00+0700', '00', '1'],
  ['negative-offset', '2026-10-25T12:00:00-05:00', '00', '1'],
  ['fraction-before-midnight', '2026-10-25T16:59:59.999Z', '23', '0'],
  ['month-boundary', '2026-10-31 17:00:00', '00', '0'],
  ['year-boundary', '2026-12-31 17:00:00', '00', '5'],
  ['leap-boundary', '2028-02-28 17:00:00', '00', '2'],
  ['invalid-text', 'not-a-date', 'NaN', 'NaN'],
  ['empty-text', '', 'NaN', 'NaN'],
  ['null-date', null, 'NaN', 'NaN'],
  ['numeric-zero-date', 0, 'NaN', 'NaN'],
]
for (const [name, created_at, hour, weekday] of timeVectors) {
  vectors.push({ name: name + ':hour', group: 'hour', row: { ...base, created_at }, expected: identity(hour, hour, null) })
  vectors.push({ name: name + ':weekday', group: 'weekday', row: { ...base, created_at }, expected: identity(weekday, weekday, null) })
}
for (const [group, expected] of [
  ['customer', identity('id:7', 'Ada', 7)], ['cashier', identity('id:4', 'MiA', 4)],
  ['payment_method', identity('cash', 'CaSH', null)], ['branch', identity('2', '  Shop  ', 2)],
]) vectors.push({ name: 'non-temporal-invalid-date:' + group, group, row: { ...base, created_at: 'not-a-date' }, expected })

function semanticGoldens(instance) {
  return vectors.map(vector => {
    const result = instance.invoke(vector.row, vector.group)
    assert.deepEqual(Object.keys(result.value).sort(), ['entity_id', 'key', 'label'], vector.name + ': flat fields')
    assert.deepEqual(result.value, vector.expected, vector.name + ': identity')
    return { ...vector, constructions: result.constructions }
  })
}
function allocationContract(records) {
  for (const row of records) {
    if (row.group === 'hour' || row.group === 'weekday') assert.ok(row.constructions > 0, row.name + ': temporal Date observer is positive')
    else assert.equal(row.constructions, 0, row.name + ': non-temporal Date constructions')
  }
}
function replaceOnce(text, before, after) {
  assert.equal(text.split(before).length - 1, 1, 'Private semantic mutant has one exact source anchor')
  return text.replace(before, () => after)
}
function killed(name, run, message, operator) {
  let failure
  try { run() } catch (error) { failure = error }
  assert.ok(failure instanceof assert.AssertionError, name + ': semantic AssertionError required, not a loader/runtime failure')
  assert.equal(failure.operator, operator, name + ': intended value assertion')
  assert.ok(failure.message.includes(message), name + ': intended semantic witness')
  return name
}

function run(sourceText) {
  assert.equal(typeof sourceText, 'string', 'Actual source text is required')
  const source = sourceText.replace(/\r\n/g, '\n')
  let stage = 'source-declaration', manualPassed = 0, actual
  try {
    actual = declaration(source)
    stage = 'manual-goldens'
    const instance = probe(actual.text), records = semanticGoldens(instance)
    manualPassed = records.length
    console.log('PASS all ' + manualPassed + ' manual identity/date goldens before allocation checks')
    stage = 'allocation-contract'
    allocationContract(records)
    console.log('PASS zero non-temporal Date allocations and positive temporal controls')
    stage = 'private-semantic-controls'
    const controls = [
      killed('wrong-UTC-offset', () => semanticGoldens(probe(replaceOnce(actual.text, '+ 7 * 3_600_000', '+ 6 * 3_600_000'))), 'utc-before-midnight:hour: identity', 'deepStrictEqual'),
      killed('wrong-anonymous-customer', () => semanticGoldens(probe(replaceOnce(actual.text, 'Number(row.customer_is_anonymous) !== 0', 'Number(row.customer_is_anonymous) === 0'))), 'customer-id: identity', 'deepStrictEqual'),
      killed('eager-Date-allocation', () => {
        const mutated = actual.text.slice(0, actual.bodyStart) + '\n  void new Date(0)' + actual.text.slice(actual.bodyStart)
        allocationContract(semanticGoldens(probe(mutated)))
      }, 'customer-id: non-temporal Date constructions', 'strictEqual'),
    ]
    return { status: 'PASS', manual_vectors: manualPassed,
      non_temporal_vectors: records.filter(row => row.group !== 'hour' && row.group !== 'weekday').length,
      temporal_vectors: records.filter(row => row.group === 'hour' || row.group === 'weekday').length,
      controls, source_lf_sha256: sha(source), actual_function_sha256: sha(actual.text), compiled_function_sha256: instance.compiled_sha256,
      scope: 'Actual AST identity declaration/manual scalar goldens and isolated Date-work regression; existing full-kernel/native/permission tests cover composition. No CPU/provider/heap/Free certificate.' }
  } catch (error) {
    const report = { status: 'FAIL', stage, manual_vectors_passed: manualPassed, source_lf_sha256: sha(source),
      actual_function_sha256: actual ? sha(actual.text) : null, error: String(error?.stack ?? error) }
    const failure = error && typeof error === 'object' ? error : new Error(String(error))
    failure.groupDateReport = report
    throw failure
  }
}

module.exports = { run }
if (require.main === module) {
  try {
    assert.equal(process.argv.length, 2, 'This regression reads the current checkout without arguments')
    console.log(JSON.stringify(run(fs.readFileSync(sourcePath, 'utf8'))))
  } catch (error) {
    console.error(JSON.stringify(error.groupDateReport ?? { status: 'FAIL', stage: 'loader-or-main', error: String(error?.stack ?? error) }))
    process.exitCode = 1
  }
}
