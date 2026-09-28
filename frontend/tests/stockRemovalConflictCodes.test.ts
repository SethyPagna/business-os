import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stockFailureText, stockLineNeedsRemoval } from '../src/utils/stockAdjustOutcome.ts'

// SCAN1 STK-C / STK-D, the client half.
//
// The Worker now refuses a stock removal whose stock changed between the read
// and the write with a 409 and a code -- `stock_removal_conflict` for
// POST /inventory/adjust and /move-row, `tagged_lot_conflict` for the tagged
// Restore / Dispose. Nothing was written, so the operator's move is refresh and
// retry. Before this the same race surfaced as a 400 carrying SQLite's raw
// "malformed JSON" text, in English, on a Khmer screen.
//
// The tagged Restore / Dispose also joined the per-request receipt guard
// (client_request_id), so a click whose reply was lost replays instead of
// disposing or restoring the units twice. The id has to be minted ONCE per
// dialog: a fresh id per click is the plausible wrong fix, and it dedups
// nothing -- the retry is a new request.
//
// See cloudflare/scripts/test-stock-remove-atomic-pure.cjs for the Worker half.

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const repo = (relative: string) => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8')
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const CONFLICT_CODES = ['stock_removal_conflict', 'tagged_lot_conflict'] as const

runTest('the Worker still emits exactly these conflict codes', () => {
  // Parity: a renamed server code would silently fall back to the English
  // server message. Pin the code where each route answers it.
  const inventory = repo('cloudflare/src/routes/inventory.ts')
  assert.match(inventory, /code: 'stock_removal_conflict'/)
  assert.match(inventory, /code: TAGGED_LOT_CONFLICT_CODE \}, 409\)/)
  assert.match(repo('cloudflare/src/lib/damagedLotActions.ts'), /export const TAGGED_LOT_CONFLICT_CODE = 'tagged_lot_conflict'/)
})

runTest('both conflict codes translate to the refresh-and-retry sentence', () => {
  const seen: string[] = []
  const tr = (key: string, fallback: string) => { seen.push(key); return `T:${key}|${fallback}` }
  for (const code of CONFLICT_CODES) {
    seen.length = 0
    const text = stockFailureText({ code, message: 'The stock changed while this was being saved.' }, tr, 'fallback')
    // Not the server's English, and not a neighbouring guard sentence -- the
    // "Remove this line" ones would send the operator the wrong way.
    assert.deepEqual(seen, ['stock_changed_retry'], `${code} must use the stock_changed_retry key`)
    assert.match(text, /Nothing was changed/)
    assert.match(text, /try again/i)
  }
})

runTest('a conflict is retryable, never a remove-this-line refusal', () => {
  for (const code of CONFLICT_CODES) {
    assert.equal(stockLineNeedsRemoval({ code }), false, `${code} must leave Retry available`)
  }
})

runTest('the sentence exists in both packs and is actually translated', () => {
  const en = JSON.parse(repo('frontend/src/lang/en.json')) as Record<string, string>
  const km = JSON.parse(repo('frontend/src/lang/km.json')) as Record<string, string>
  assert.ok(en.stock_changed_retry, 'en.json')
  assert.ok(km.stock_changed_retry, 'km.json')
  assert.notEqual(en.stock_changed_retry, km.stock_changed_retry)
  assert.match(km.stock_changed_retry, /[ក-៿]/, 'km must be Khmer text')
  assert.match(en.stock_changed_retry, /Nothing was changed/)
})

runTest('the tagged dialog mints its request id once, and sends it', () => {
  const rows = stripComments(repo('frontend/src/components/products/TaggedStockRows.tsx'))
  assert.match(rows, /const \[requestId\] = useState\(\(\) => createClientRequestId\('tagged'\)\)/)
  const submit = rows.match(/const submit = async \(\) => \{[\s\S]*?\n {2}\}\r?\n/)
  assert.ok(submit, 'submit() not found')
  assert.match(submit[0], /client_request_id: requestId,/)
  // The wrong fix: a new id per click. The retry would then be a new request.
  assert.doesNotMatch(submit[0], /createClientRequestId\(/)
  // And the failure goes through the shared translator, not error.message.
  assert.match(submit[0], /stockFailureText\(error, tr, /)
  assert.doesNotMatch(submit[0], /error instanceof Error \? error\.message/)
})

runTest('the tagged transport always carries an id', () => {
  const transport = stripComments(repo('frontend/src/api/damagedLotsTransport.ts'))
  assert.match(transport, /client_request_id\?: string/)
  // Every caller is covered, not only the dialog: the id is ensured at the
  // transport and a supplied one is kept (ensureClientRequestId).
  const dispose = transport.match(/export function disposeTaggedLot[\s\S]*?\n\}/)
  const restore = transport.match(/export function restoreTaggedLot[\s\S]*?\n\}/)
  assert.ok(dispose && restore)
  assert.match(dispose[0], /ensureClientRequestId\(payload, 'tagged'\)/)
  assert.match(restore[0], /ensureClientRequestId\(payload, 'tagged'\)/)
})

if (failed) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll stock removal conflict code tests passed')
