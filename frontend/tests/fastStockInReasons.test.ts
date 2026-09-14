import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stockLineReason } from '../src/utils/stockLineReason.ts'

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
// Run: node tests/fastStockInReasons.test.ts

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const modal = read('../src/components/inventory/FastStockInModal.tsx')
const adjustForm = read('../src/components/inventory/InventoryStockModals.tsx')
const field = read('../src/components/shared/StockReasonField.tsx')
const transport = read('../src/api/batchesTransport.ts')
const batchesRoute = read('../../cloudflare/src/routes/batches.ts')
const inventoryRoute = read('../../cloudflare/src/routes/inventory.ts')
const sessionsSection = read('../src/components/products/StockInSessionsSection.tsx')
const productsSession = read('../src/components/products/CreateProductsSessionModal.tsx')
const receiveModal = read('../src/components/inventory/ReceiveBatchModal.tsx')
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
  assert.match(modal, /interface ReceivedLine \{[^]*?\n  reason: string\n[^]*?\n\}/)
  assert.match(modal, /const next: ReceivedLine = \{[^]*?\n\s+reason: reason\.trim\(\),\n[^]*?\}/)
  assert.match(modal, /function editLine\(line: ReceivedLine\) \{[^]*?setReason\(line\.reason\)/, 'reopening a queued line restores its reason')
  // remove, set and the unlocked-pricing add all resolve through the one helper
  assert.equal((modal.match(/reason: stockLineReason\(line, tr\), branchId: Number\(branchId\),/g) || []).length, 3)
  assert.doesNotMatch(modal, /reason: tr\('stock_change_session_reason'/, 'no hardcoded reason is left on a write')
  assert.doesNotMatch(modal, /reason: tr\('stock_in_session_reason'/, 'no hardcoded reason is left on a write')
  // the plain add sends the text or null so the Worker keeps its lot label
  assert.match(modal, /await receiveBatchStock\(\{[^]*?reason: line\.reason\.trim\(\) \|\| null,[^]*?\}\)/)
  // the draft carries it across reload like every other in-progress value
  assert.match(modal, /type FastStockInDraft = \{[^]*?\n  reason\?: string\n/)
  assert.match(modal, /const \[reason, setReason\] = useState\(draft\?\.reason \|\| ''\)/)
  // an older draft's lines without the field become blank-reason lines, not undefined
  assert.match(modal, /reason: line\.reason \|\| ''/)
})

runTest('the fast flow and the adjust form share ONE reason control, fed by the saved-reason catalog', () => {
  assert.match(modal, /import StockReasonField, \{ type SavedStockReason \} from '\.\.\/shared\/StockReasonField\.tsx'/)
  assert.match(modal, /import \{ getInventoryReasons, searchProducts \} from '\.\.\/\.\.\/api\/methods\.ts'/)
  assert.match(modal, /item\?\.type === 'adjust'/, 'the fast flow offers the adjust-type saved reasons, same as the adjust form')
  assert.match(modal, /<StockReasonField\n\s+id="fast-stockin-reason"[^]*?onEnter=\{addLine\}[^]*?savedReasons=\{savedReasons\}/, 'Enter in the reason box queues the line')
  assert.match(adjustForm, /<StockReasonField\n\s+id="inventory-adjust-reason"[^]*?savedReasons=\{reasonsByType\.adjust\}/)
  // no second copy of the chip markup survives in either surface
  assert.doesNotMatch(adjustForm, /reasonsByType\.adjust\.map/)
  assert.doesNotMatch(modal, /savedReasons\.map/)
  assert.equal((field.match(/savedReasons\.map/g) || []).length, 1)
  assert.match(field, /aria-pressed=\{value === entry\.label\}/)
  // the explanation is a tooltip, not prose in the form
  assert.match(modal, /tr\('fast_stock_reason_hint'/)
  assert.doesNotMatch(modal, /<p[^>]*>\{tr\('fast_stock_reason_hint'/)
  for (const key of ['fast_stock_reason_hint', 'reason', 'reason_placeholder']) {
    assert.equal(typeof en[key], 'string', `en.${key}`)
    assert.equal(typeof km[key], 'string', `km.${key}`)
    assert.match(km[key], /[ក-៿]/, `km.${key} is Khmer`)
  }
  assert.match(km.fast_stock_reason_hint, /មូលហេតុ|វគ្គ/, 'the Khmer hint uses the glossary words')
})

runTest('the queued line and the sessions list show the reason where the line is', () => {
  assert.match(modal, /\{line\.reason \? <span className="block break-words[^"]*">\{line\.reason\}<\/span> : null\}/, 'a queued line shows its reason, wrapping rather than truncating')
  assert.match(sessionsSection, /tr\('reason', 'Reason'\)/)
  // clicking a session line reveals its reason in the line detail panel
  assert.match(sessionsSection, /selectedLine\.reason/, 'the clicked line detail carries the reason')
})

runTest("the Add/Create Products session asks for a reason and its payload builder sends it", () => {
  // The second session surface: the Worker has taken a session-default and a
  // per-line reason since the line-reason commit, but this modal produced
  // neither, so every product added from the Products page still landed on
  // the generated 'Stock-in session <id>' label.
  assert.match(productsSession, /import StockReasonField from '\.\.\/shared\/StockReasonField\.tsx'/)
  assert.match(productsSession, /import \{ useSavedStockReasons \} from '\.\.\/\.\.\/utils\/useSavedStockReasons\.ts'/)
  assert.match(productsSession, /<StockReasonField\n\s+id="create-products-reason"[^]*?savedReasons=\{savedReasons\}/, 'the shared control, in the shared details')
  assert.doesNotMatch(productsSession, /savedReasons\.map/, 'no second copy of the chip markup')
  // Frozen per line exactly like the free-goods declaration, so editing the
  // shared details later only changes lines queued after the edit.
  assert.match(productsSession, /type SessionLine = \{[^]*?\n  reason: string\n[^]*?\n\}/)
  assert.equal((productsSession.match(/freeGoods, reason: reason\.trim\(\)/g) || []).length, 3, 'every queued line freezes the reason')
  // The payload builder sends it, and only when there is one -- a session
  // without a reason must serialize exactly as before (idempotency).
  assert.match(productsSession, /\.\.\.\(line\.reason \? \{ reason: line\.reason \} : \{\}\),/)
  // The draft carries it across a reload like every other shared detail.
  assert.match(productsSession, /type UnifiedSessionDraft = [^]*?\n  reason\?: string\n/)
  assert.match(productsSession, /const \[reason, setReason\] = useState\(draft\?\.reason \|\| ''\)/)
  // Visible where the line is, same as the fast flow's queue.
  assert.match(productsSession, /\{row\.reason \? <span className="block break-words text-\[10px\] text-gray-500 dark:text-gray-400">\{row\.reason\}<\/span> : null\}/)
})

runTest("the branch Receive stock modal asks for a reason and sends it", () => {
  // The third receipt surface (Branches hub -> Receive stock). POST /api/batches
  // has taken an optional reason since the fast-flow commit; this modal is the
  // other caller of that wire and had no way to give one.
  assert.match(receiveModal, /import StockReasonField from '\.\.\/shared\/StockReasonField\.tsx'/)
  assert.match(receiveModal, /import \{ useSavedStockReasons \} from '\.\.\/\.\.\/utils\/useSavedStockReasons\.ts'/)
  assert.match(receiveModal, /<StockReasonField\n\s+id="receive-batch-reason"[^]*?savedReasons=\{savedReasons\}/)
  assert.doesNotMatch(receiveModal, /savedReasons\.map/, 'no second copy of the chip markup')
  // Blank sends null so the Worker keeps its own "Stock received (<lot>)" label.
  assert.match(receiveModal, /await receiveBatchStock\(\{[^]*?reason: reason\.trim\(\) \|\| null,[^]*?\}\)/)
  // In-progress work: dirty guard, draft write, draft restore, and the reset
  // that runs when another product is opened -- same as every other field.
  assert.match(receiveModal, /notes !== '' \|\| reason !== ''/)
  assert.match(receiveModal, /scheduleWorkDraftWrite\(draftKey, \{ quantity, receivedDate, expiryDate, notes, reason,/)
  assert.match(receiveModal, /if \(draft\.reason !== undefined\) setReason\(draft\.reason\)/)
  assert.match(receiveModal, /setNotes\(''\)\r?\n\s+setReason\(''\)/)
  for (const key of ['receive_batch_reason_hint']) {
    assert.equal(typeof en[key], 'string', `en.${key}`)
    assert.equal(typeof km[key], 'string', `km.${key}`)
    assert.match(km[key], /[ក-៿]/, `km.${key} is Khmer`)
  }
})

runTest('Worker parity: /inventory/adjust still refuses a missing reason; /batches takes an optional one', () => {
  assert.match(inventoryRoute, /const reason = body\.reason != null \? String\(body\.reason\)\.trim\(\) \|\| null : null/)
  assert.match(inventoryRoute, /if \(!reason\) return c\.json\(\{ error: 'A reason is required for stock adjustments' \}, 400\)/)
  assert.match(batchesRoute, /reason\?: string \| null/)
  assert.match(batchesRoute, /const reason = String\(body\.reason \?\? ''\)\.trim\(\) \|\| null/)
  assert.match(batchesRoute, /reason: appendReceiptNotes\(reason \|\| `Stock received \(\$\{lotCode\}\)`, freeGoods \? \[FREE_GOODS_REASON_NOTE\] : \[\]\),/)
  assert.match(transport, /reason: payload\.reason \|\| null,/)
  assert.match(transport, /export type ReceiveBatchPayload = \{[^]*?\n  reason\?: string \| null\n/)
})

if (failed > 0) process.exitCode = 1
