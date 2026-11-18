'use strict'
// The input of a per-line decision (lib/inventoryCheckLineInput.ts), as a table of inputs and verdicts, with no database.
//   1. Every row of the table gets exactly the verdict recorded in scripts/fixtures/inventory-check-line-decision-verdicts.json (the Worker's answer is the oracle: status, code, and for an accepted
//      input the normalised input). The frontend validator is held to the SAME file (frontend tests read it), so the two can never drift.
//   2. The table is discriminating: it holds at least one input for every refusal code the validator can give, so a validator that stopped checking one rule goes red here.
// Regenerate the fixture after a deliberate rule change with: UPDATE_FIXTURE=1 node scripts/test-inventory-check-line-input-pure.cjs
// Run: node scripts/test-inventory-check-line-input-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transformSync } = require('esbuild')

const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file).exports
  const module = { exports: {} }; cache.set(file, module)
  const source = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  new Function('require', 'module', 'exports', source)(id => id.startsWith('.') ? load(path.resolve(path.dirname(file), id.endsWith('.ts') ? id : `${id}.ts`)) : require(id), module, module.exports)
  return module.exports
}
const { lineDecisionVerdict, LINE_NOTE_MAX } = load(path.join(__dirname, '../src/lib/inventoryCheckLineInput.ts'))
const fixtureFile = path.join(__dirname, 'fixtures/inventory-check-line-decision-verdicts.json')

const PLAIN = { dated: false, batchIds: [] }
const DATED = { dated: true, batchIds: [10, 11] }
const K = { requestId: 'request-0001', productId: 5 }
const cases = [
  ['reject', { ...K, action: 'reject' }, PLAIN],
  ['reject with a note, trimmed', { ...K, action: 'reject', note: '  recount  ' }, PLAIN],
  ['reject with a blank note is no note', { ...K, action: 'reject', note: '   ' }, PLAIN],
  ['reject with a null note', { ...K, action: 'reject', note: null }, PLAIN],
  ['reject with a note of exactly the limit', { ...K, action: 'reject', note: 'x'.repeat(LINE_NOTE_MAX) }, PLAIN],
  ['reject with a note one over the limit', { ...K, action: 'reject', note: 'x'.repeat(LINE_NOTE_MAX + 1) }, PLAIN],
  ['reject with a note that is not text', { ...K, action: 'reject', note: 5 }, PLAIN],
  ['reopen', { ...K, action: 'reopen' }, DATED],
  ['reopen with a figure', { ...K, action: 'reopen', counted: 1 }, PLAIN],
  ['reject with dates', { ...K, action: 'reject', lots: [{ batchId: 10, counted: 1 }] }, DATED],
  ['modify a total to 4', { ...K, action: 'modify', counted: 4 }, PLAIN],
  ['modify a total to 0', { ...K, action: 'modify', counted: 0 }, PLAIN],
  ['modify a total to the largest figure', { ...K, action: 'modify', counted: 1000000000 }, PLAIN],
  ['modify a total above the largest figure', { ...K, action: 'modify', counted: 1000000001 }, PLAIN],
  ['modify a total to a negative figure', { ...K, action: 'modify', counted: -1 }, PLAIN],
  ['modify a total to a fraction', { ...K, action: 'modify', counted: 2.5 }, PLAIN],
  ['modify a total to a figure that is text', { ...K, action: 'modify', counted: '4' }, PLAIN],
  ['modify a total to not-a-number', { ...K, action: 'modify', counted: null }, PLAIN],
  ['modify with nothing', { ...K, action: 'modify' }, PLAIN],
  ['modify with both a total and dates', { ...K, action: 'modify', counted: 1, lots: [{ batchId: 10, counted: 1 }] }, DATED],
  ['modify a total of a line counted by date', { ...K, action: 'modify', counted: 4 }, DATED],
  ['modify the dates of a line counted as a total', { ...K, action: 'modify', lots: [{ batchId: 10, counted: 4 }] }, PLAIN],
  ['modify one date', { ...K, action: 'modify', lots: [{ batchId: 10, counted: 4 }] }, DATED],
  ['modify both dates', { ...K, action: 'modify', lots: [{ batchId: 11, counted: 0 }, { batchId: 10, counted: 7 }] }, DATED],
  ['modify a date the count does not hold', { ...K, action: 'modify', lots: [{ batchId: 12, counted: 4 }] }, DATED],
  ['modify a date twice', { ...K, action: 'modify', lots: [{ batchId: 10, counted: 4 }, { batchId: 10, counted: 5 }] }, DATED],
  ['modify with no dates listed', { ...K, action: 'modify', lots: [] }, DATED],
  ['modify with dates that are not a list', { ...K, action: 'modify', lots: { batchId: 10, counted: 1 } }, DATED],
  ['modify a date to a fraction', { ...K, action: 'modify', lots: [{ batchId: 10, counted: 0.5 }] }, DATED],
  ['modify a date to a negative figure', { ...K, action: 'modify', lots: [{ batchId: 10, counted: -2 }] }, DATED],
  ['modify a date with an unknown key', { ...K, action: 'modify', lots: [{ batchId: 10, counted: 1, seen: 3 }] }, DATED],
  ['modify a date with a bad id', { ...K, action: 'modify', lots: [{ batchId: 0, counted: 1 }] }, DATED],
  ['modify a date with a text id', { ...K, action: 'modify', lots: [{ batchId: '10', counted: 1 }] }, DATED],
  ['an action that does not exist', { ...K, action: 'accept' }, PLAIN],
  ['no action', { ...K }, PLAIN],
  ['a product id of 0', { ...K, productId: 0, action: 'reject' }, PLAIN],
  ['a product id that is text', { ...K, productId: '5', action: 'reject' }, PLAIN],
  ['a product id that is a fraction', { ...K, productId: 5.5, action: 'reject' }, PLAIN],
  ['no product id', { requestId: K.requestId, action: 'reject' }, PLAIN],
  ['no request id', { productId: 5, action: 'reject' }, PLAIN],
  ['a request id that is too short', { requestId: 'short', productId: 5, action: 'reject' }, PLAIN],
  ['an unknown key', { ...K, action: 'reject', extra: 1 }, PLAIN],
  ['a body that is a list', [], PLAIN],
  ['a body that is null', null, PLAIN],
]

const table = cases.map(([name, body, shape]) => ({ name, body, shape, verdict: lineDecisionVerdict(body, shape) }))
const text = JSON.stringify({ version: 1, note: 'Generated by scripts/test-inventory-check-line-input-pure.cjs from the Worker validator (lib/inventoryCheckLineInput.ts). The frontend validator must give the same verdict for every row.', cases: table }, null, 2) + '\n'
if (process.env.UPDATE_FIXTURE === '1') { fs.mkdirSync(path.dirname(fixtureFile), { recursive: true }); fs.writeFileSync(fixtureFile, text) }
const recorded = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'))
assert.deepEqual(recorded, JSON.parse(text), 'the fixture matches the Worker validator (UPDATE_FIXTURE=1 regenerates it after a deliberate change)')

const codes = new Set(table.filter(row => !row.verdict.ok).map(row => row.verdict.code))
for (const code of ['inventory_check_invalid_request', 'inventory_check_request_id_required', 'inventory_check_invalid_id', 'inventory_check_invalid_action', 'inventory_check_invalid_note', 'inventory_check_quantity_required',
  'inventory_check_invalid_quantity', 'inventory_check_target_not_whole', 'inventory_check_lots_required', 'inventory_check_lots_not_allowed', 'inventory_check_line_date_not_counted']) assert.ok(codes.has(code), `the table covers ${code}`)
assert.ok(table.some(row => row.verdict.ok), 'and accepted inputs')
for (const row of table) assert.ok(row.verdict.ok || (row.verdict.status >= 400 && row.verdict.status < 500), `${row.name}: every refusal is a 4xx`)
const byName = new Map(table.map(row => [row.name, row.verdict]))
assert.deepEqual(byName.get('reject with a note, trimmed'), { ok: true, input: { productId: 5, action: 'reject', note: 'recount', requestId: 'request-0001' } })
assert.deepEqual(byName.get('modify both dates').input.lots, [{ batchId: 11, counted: 0 }, { batchId: 10, counted: 7 }])
console.log(`PASS test-inventory-check-line-input-pure (${table.length} rows, ${codes.size} refusal codes)`)
