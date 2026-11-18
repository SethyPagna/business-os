'use strict'
// The products a count approval's claim holds (lib/inventoryCheckPlan.ts), with no database. One function answers two questions: the decision check of the Worker refuses a line decision on these
// products (inventory_check_line_in_progress), and the approval's planned_lines names them for the panel. A plan entry that is not a whole plan is skipped by both.
// Run: node scripts/test-inventory-check-plan-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transformSync } = require('esbuild')

const source = transformSync(fs.readFileSync(path.join(__dirname, '../src/lib/inventoryCheckPlan.ts'), 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code
const module_ = { exports: {} }
new Function('require', 'module', 'exports', source)(require, module_, module_.exports)
const { productsInFlight, plansOf } = module_.exports

const plan = (lot = 10) => ({ lot, scope: 'lot', counted: 3, seen: 5 })
const cases = [
  ['nothing claimed', ['{}', '{"lines":{}}'], []],
  ['a plan key of a plain line', [JSON.stringify({ 3: plan(30) }), '{"lines":{}}'], [3]],
  ['a plan key of a dated line is its product', [JSON.stringify({ '2:20': plan(20), '2:21': plan(21) }), '{"lines":{}}'], [2]],
  ['a part-written date holds its product though the plan is empty', ['{}', JSON.stringify({ lines: {}, units: { '2:20': { before: 5, after: 3 } } })], [2]],
  ['plan and written dates of different products, ascending and once', [JSON.stringify({ 5: plan(), '1:10': plan() }), JSON.stringify({ lines: {}, units: { '1:11': {}, '4': {} } })], [1, 4, 5]],
  ['a malformed plan entry holds nothing: a string, null, an array, a missing figure, a bad scope', [JSON.stringify({ 2: 'x', 3: null, 4: [], 5: { lot: 1, scope: 'lot', counted: 3 }, 6: { lot: 1, scope: 'unit', counted: 3, seen: 5 }, 7: { lot: '1', scope: 'lot', counted: 3, seen: 5 } }), '{"lines":{}}'], []],
  ['a malformed entry beside a whole one: only the whole one holds', [JSON.stringify({ 2: { lot: 1 }, 3: plan(30) }), '{"lines":{}}'], [3]],
  ['a plan that is not an object', ['[1,2]', '{"lines":{}}'], []],
  ['a plan that is not JSON', ['{not json', '{"lines":{}}'], []],
  ['no plan column', [undefined, '{"lines":{}}'], []],
  ['a null plan column', [null, '{"lines":{}}'], []],
  ['units that are not an object', ['{}', '{"units":[1,2]}'], []],
  ['an applied column that is not JSON', ['{}', 'nope'], []],
  ['a key that is not a product id', [JSON.stringify({ abc: plan(), '0': plan(), '-3': plan() }), '{"lines":{}}'], []],
]
for (const [name, [planJson, appliedJson], expected] of cases) assert.deepEqual(productsInFlight(planJson, appliedJson), expected, name)
assert.deepEqual(Object.keys(plansOf(JSON.stringify({ 2: { lot: 1 }, 3: plan() }))), ['3'], 'plansOf keeps whole plans only')
console.log(`PASS test-inventory-check-plan-pure (${cases.length} cases)`)
