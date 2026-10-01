import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stockLineReason } from '../src/utils/stockLineReason.ts'
import { buildStockLineRequest, type StockSessionLine } from '../src/utils/stockSessionDraft.ts'

// P3-L2 (2026-09-14): "the add stock, remove, and set stock doesn't have
// reasons. it was removed. bring that back... and they didn't have like per
// product reasons 'when clicked'".
//
// N27 folded the one-by-one Add / Remove / Set modal into FastStockInModal
// and wrote one hardcoded label per line ('Stock change session' for a
// remove or set, 'Stock-in session' for an unlocked-pricing add, the
// Worker's own 'Stock received (<lot>)' for a plain add). Every line now
// carries its own reason -- the saved-reason chips plus free text the adjust
// form already had -- frozen with the line and stored as typed.
//
// UI-STOCK-2/3 (30 Sep 2026): the float is the one Stock Session; its line
// writer lives in utils/stockSessionDraft.ts and its reason row in
// StockSessionLineEntry. The Add/Create Products session, Receive stock,
// Bulk add stock and the Inventory adjust form were retired into it.
//
// Run: node tests/fastStockInReasons.test.ts

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const modal = read('../src/components/inventory/FastStockInModal.tsx')
const lineEntry = read('../src/components/stock-session/StockSessionLineEntry.tsx')
const items = read('../src/components/stock-session/StockSessionItems.tsx')
const draftModule = read('../src/utils/stockSessionDraft.ts')
const transport = read('../src/api/batchesTransport.ts')
const batchesRoute = read('../../cloudflare/src/routes/batches.ts')
const inventoryRoute = read('../../cloudflare/src/routes/inventory.ts')
const sessionsSection = read('../src/components/products/StockInSessionsSection.tsx')
const loader = read('../src/utils/useSavedStockReasons.ts')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

// tr() as the modal receives it: pack value when the key exists, else the fallback.
const tr = (key: string, fallback = key): string => (typeof en[key] === 'string' ? en[key] : fallback)

runTest('two lines with two different typed reasons produce two different movement reasons, as typed', () => {
  const damaged = stockLineReason({ mode: 'remove', reason: 'Damaged in transit' }, tr)
  const counted = stockLineReason({ mode: 'remove', reason: 'Physical count' }, tr)
  assert.equal(damaged, 'Damaged in transit')
  assert.equal(counted, 'Physical count')
  assert.notEqual(damaged, counted)
  // Never remapped onto a saved-reason id or the session label, and never
  // reformatted beyond trimming the operator's stray whitespace.
  assert.equal(stockLineReason({ mode: 'set', reason: '  Recount after audit  ' }, tr), 'Recount after audit')
  assert.equal(stockLineReason({ mode: 'add', reason: 'Late delivery' }, tr), 'Late delivery')
})

runTest('a blank reason falls back to the label the write path used before, per mode', () => {
  assert.equal(stockLineReason({ mode: 'remove', reason: '' }, tr), en.stock_change_session_reason)
  assert.equal(stockLineReason({ mode: 'set', reason: '   ' }, tr), en.stock_change_session_reason)
  assert.equal(stockLineReason({ mode: 'add', reason: '' }, tr), en.stock_in_session_reason)
  assert.equal(en.stock_change_session_reason, 'Stock change session')
  assert.equal(en.stock_in_session_reason, 'Stock-in session')
  // A pack without the key still yields a non-empty reason, because
  // POST /api/inventory/adjust refuses an empty one.
  assert.equal(stockLineReason({ mode: 'remove', reason: '' }, (_key, fallback = '') => fallback), 'Stock change session')
})

runTest('every queued line freezes its reason and every adjust write sends it', () => {
  assert.match(draftModule, /export type StockSessionLine = \{[^]*?\n  reason: string\n[^]*?\n\}/)
  assert.match(modal, /\n\s+reason: reason\.trim\(\),\n/, 'a queued line freezes the typed reason')
  assert.match(modal, /setReason\(line\.reason\)/, 'reopening a queued line restores its reason')
  assert.match(modal, /reasonFor: \(entry\) => stockLineReason\(entry, tr\)/, 'the writer reads the one reason rule')
  // Execute the real line writer for every mode, tag and reason shape.
  for (const mode of ['remove', 'set', 'add'] as const) {
    for (const conditionTag of ['', 'damaged']) {
      for (const reason of ['  Line-specific reason  ', '']) {
        const line = {
          key: 'line', requestId: 'req', product: { id: 7, name: 'Serum' }, productName: 'Serum', mode, conditionTag,
          quantity: 2, freeQuantity: 0, unitCost: '1.2345', sellingPrice: '', expiryDate: '', batchChoice: 'new',
          batchLabel: '', freeGoods: false, reason, createdProduct: false, status: 'queued', detail: '',
        } as unknown as StockSessionLine
        const request = buildStockLineRequest(line, {
          branchId: '1', receivedDate: '2026-09-20', supplier: { supplierId: 2, supplierName: 'Supplier' },
          paymentStatus: 'paid', creditDueDate: '', sessionId: 1, canEditPrice: false, reasonFor: (entry) => stockLineReason(entry, tr),
        })
        const body = request.body as Record<string, unknown>
        const isPlainReceipt = mode === 'add' && !conditionTag
        assert.equal(request.wire, isPlainReceipt ? 'receive' : 'adjust')
        // The plain add sends the text or null so the Worker keeps its lot label.
        assert.equal(body.reason, isPlainReceipt ? reason.trim() || null : stockLineReason(line, tr))
        assert.equal(body.productId, 7)
      }
    }
  }
  assert.doesNotMatch(modal, /reason: tr\('stock_change_session_reason'/, 'no hardcoded reason is left on a write')
  assert.doesNotMatch(modal, /reason: tr\('stock_in_session_reason'/, 'no hardcoded reason is left on a write')
  // The draft carries it across reload; an older draft's line without it becomes blank, not undefined.
  assert.match(draftModule, /export type StockSessionDraft = \{[^]*?\n  reason: string\n/)
  assert.match(draftModule, /reason: asString\(line\.reason\)/)
  assert.match(draftModule, /reason: asString\(draft\.reason\)/)
})

runTest('the Stock Session has ONE reason control, fed by the saved-reason catalog', () => {
  // The box lives in the float (components/shared is the catalog's app-shared chunk), fed by the saved-reason options.
  assert.match(lineEntry, /import SuggestionTextInput from '\.\.\/shared\/SuggestionTextInput\.tsx'/)
  assert.doesNotMatch(lineEntry, /StockReasonField\.tsx/)
  assert.match(modal, /import \{ useSavedStockReasonCatalog \} from '\.\.\/\.\.\/utils\/useSavedStockReasons\.ts'/)
  assert.match(modal, /const \{ reasons: savedReasons, reload: reloadReasons \} = useSavedStockReasonCatalog\('adjust'\)/)
  // The catalog fetch + type filter + { id, label } mapping lives in ONE
  // place; no surface keeps its own copy of it.
  assert.equal((loader.match(/item\?\.type === type/g) || []).length, 1, 'the adjust-type filter is written once')
  assert.match(loader, /export function useSavedStockReasons\(type = 'adjust'\)/, 'adjust is the default catalog')
  for (const surface of [modal, lineEntry]) {
    assert.doesNotMatch(surface, /getInventoryReasons\(\)/, 'no surface re-implements the catalog read')
    // The line entry maps the catalog into suggestion OPTIONS (data); no surface renders its own chip/list markup from it.
    assert.doesNotMatch(surface, /savedReasons\.map\([^]{0,160}?<(?:button|li|span|div)\b/, 'no second copy of the reason list markup')
  }
  assert.match(lineEntry, /const reasonOptions = useMemo\(\(\) => savedReasons\.map\(/, 'the options are the saved reasons')
  assert.match(lineEntry, /<SuggestionTextInput\n\s+id="stock-session-reason"\n\s+value=\{reason\}\n\s+options=\{reasonOptions\}/)
  assert.match(lineEntry, /event\.key !== 'Enter'[^]*?onAdd\(\)/, 'Enter in the reason box queues the line')
  assert.equal((lineEntry.match(/id="stock-session-reason"/g) || []).length, 1, 'one reason control')
  assert.match(modal, /savedReasons=\{savedReasons\}/, 'the modal feeds the catalog into the line entry')
  // The box stops BELOW the Worker cap (STOCK_REASON_MAX_LENGTH in
  // cloudflare/src/lib/stockReason.ts) on purpose: the headroom is what lets
  // undo/redo prepend 'Undo: ' to a full-length reason and still be accepted
  // by the same wire that stored it.
  const boxCap = Number((lineEntry.match(/const REASON_MAX_LENGTH = (\d+)/) || [])[1])
  const workerCap = Number((read('../../cloudflare/src/lib/stockReason.ts').match(/STOCK_REASON_MAX_LENGTH = (\d+)/) || [])[1])
  assert.ok(boxCap > 0 && workerCap > 0, 'both caps must be readable')
  assert.ok(boxCap + 'Undo: '.length <= workerCap, `the reason box (${boxCap}) must leave room for the undo prefix under the Worker cap (${workerCap})`)
  assert.match(lineEntry, /onReason\(next\.slice\(0, REASON_MAX_LENGTH\)\)/, 'the box enforces the same cap')
  for (const key of ['reason', 'reason_placeholder']) {
    assert.equal(typeof en[key], 'string', `en.${key}`)
    assert.equal(typeof km[key], 'string', `km.${key}`)
    assert.match(km[key], /[ក-៿]/, `km.${key} is Khmer`)
  }
})

runTest('the queued line and the sessions list show the reason where the line is', () => {
  assert.match(items, /\{line\.reason \? <span className="block break-words[^"]*">\{line\.reason\}<\/span> : null\}/, 'a queued item shows its reason, wrapping rather than truncating')
  assert.match(sessionsSection, /tr\('reason', 'Reason'\)/)
  // clicking a session line reveals its reason in the line detail panel
  assert.match(sessionsSection, /selectedLine\.reason/, 'the clicked line detail carries the reason')
})

runTest('Worker parity: /inventory/adjust still refuses a missing reason; /batches takes an optional one', () => {
  assert.match(inventoryRoute, /const reason = body\.reason != null \? String\(body\.reason\)\.trim\(\) \|\| null : null/)
  assert.match(inventoryRoute, /if \(!reason\) return c\.json\(\{ error: 'A reason is required for stock adjustments' \}, 400\)/)
  assert.match(batchesRoute, /reason\?: string \| null/)
  assert.match(batchesRoute, /const reason = String\(body\.reason \?\? ''\)\.trim\(\) \|\| null/)
  // P4-4a folded the movement INSERT into receiveBatchStock's own batch, so the
  // fallback label reads the planned lot code (planLotCode), not the post-write
  // one; the wording and the optional-reason contract are unchanged.
  assert.match(batchesRoute, /reason: appendReceiptNotes\(reason \|\| `Stock received \(\$\{planLotCode\}\)`, freeGoods \? \[FREE_GOODS_REASON_NOTE\] : \[\]\),/)
  assert.match(transport, /reason: payload\.reason \|\| null,/)
  assert.match(transport, /export type ReceiveBatchPayload = \{[^]*?\n  reason\?: string \| null\n/)
})

if (failed > 0) process.exitCode = 1
