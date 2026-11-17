import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { lineDecisionVerdict, lineRequestBody, LINE_NOTE_MAX, type LineShape, type LineVerdict } from '../src/components/inventory/inventoryCheckLineInput.ts'

// The Worker's validator (cloudflare/src/lib/inventoryCheckLineInput.ts) is the oracle: its input-to-verdict table is the recorded fixture, which the Worker's own
// pure test (scripts/test-inventory-check-line-input-pure.cjs) holds to the Worker's code. The page's validator must give the same verdict for every row.

type Row = { name: string; body: unknown; shape: LineShape; verdict: LineVerdict }
const fixture = JSON.parse(readFileSync(new URL('../../cloudflare/scripts/fixtures/inventory-check-line-decision-verdicts.json', import.meta.url), 'utf8')) as { cases: Row[] }

assert.ok(fixture.cases.length >= 40, 'the table is the whole table')
const failures: string[] = []
for (const row of fixture.cases) {
  const got = lineDecisionVerdict(row.body, row.shape)
  try { assert.deepEqual(got, row.verdict) } catch { failures.push(`${row.name}: Worker ${JSON.stringify(row.verdict)} but page ${JSON.stringify(got)}`) }
}
assert.deepEqual(failures, [], `the page's verdict differs from the Worker's on ${failures.length} row(s):\n  ${failures.join('\n  ')}`)

// The table covers every code the validator can give (a row set that skips a branch would pass a validator that skips it too).
const codes = new Set(fixture.cases.flatMap(row => row.verdict.ok ? [] : [row.verdict.code]))
for (const code of ['inventory_check_invalid_request', 'inventory_check_request_id_required', 'inventory_check_invalid_id', 'inventory_check_invalid_action', 'inventory_check_invalid_note', 'inventory_check_quantity_required',
  'inventory_check_invalid_quantity', 'inventory_check_target_not_whole', 'inventory_check_lots_required', 'inventory_check_lots_not_allowed', 'inventory_check_line_date_not_counted']) assert.ok(codes.has(code), `the table has a row for ${code}`)
assert.equal(LINE_NOTE_MAX, 500)

// Boundaries the table does not spell out: a note counts after trimming, and 0 and the top figure are whole figures.
const shape: LineShape = { dated: false, batchIds: [] }
const ok = { requestId: 'request-0001', productId: 5, action: 'modify' }
assert.equal(lineDecisionVerdict({ ...ok, counted: 4, note: ` ${'x'.repeat(500)} ` }, shape).ok, true, 'padding around a 500 character note is trimmed away')
assert.deepEqual(lineDecisionVerdict({ ...ok, counted: 4, note: 'x'.repeat(501) }, shape), { ok: false, status: 400, code: 'inventory_check_invalid_note' })
assert.equal(lineDecisionVerdict({ ...ok, counted: 1e9 }, shape).ok, true); assert.equal(lineDecisionVerdict({ ...ok, counted: 0 }, shape).ok, true)

// What goes on the wire: no null note.
const sent = lineDecisionVerdict({ ...ok, counted: 4 }, shape)
assert.ok(sent.ok)
assert.deepEqual(lineRequestBody((sent as { ok: true; input: Parameters<typeof lineRequestBody>[0] }).input), { productId: 5, action: 'modify', counted: 4, requestId: 'request-0001' })

console.log(`PASS Inventory check line-decision validator parity: ${fixture.cases.length} Worker verdicts reproduced (status, code and normalised input)`)
