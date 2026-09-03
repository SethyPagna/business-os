// Pins the two halves of the Sep 3 2026 ask (user, verbatim):
//
//   "for smaller screens the receipt id must be shown clearly fully, no
//    scroll; can push to second row and copy easily... also has the returns
//    button right in the sales receipt directly in addition to being in
//    returns section."
//
// Half 1 -- the id. Before this, the sale detail rendered the receipt number
// inside `.detail-scroll-text` (one line, horizontal touch scroll) and the
// phone sales card rendered it with `truncate` (an ellipsis eats the tail,
// which is exactly the part that tells two receipts from the same day
// apart). Neither is "shown clearly fully, no scroll".
//
// Half 2 -- the action. The Return button on the receipt must open the SAME
// returns/NewReturnModal the Returns section opens (no forked return logic),
// pre-filled with the sale, behind the SAME `returns:add` grant the backend
// enforces, and inert with a stated reason when the sale cannot be returned.
//
// Run: node tests/saleReceiptIdAndReturnAction.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { getSaleReturnBlockReason } from '../src/utils/saleReturnGuard.ts'

const read = (rel: string): string => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

const copyableId = read('src/components/shared/CopyableId.tsx')
const saleDetail = read('src/components/sales/SaleDetailModal.tsx')
const sales = read('src/components/sales/Sales.tsx')
const salesList = read('src/components/sales/SalesListSurface.tsx')
const receipt = read('src/components/receipt/Receipt.tsx')
const newReturn = read('src/components/returns/NewReturnModal.tsx')
const returnDetail = read('src/components/returns/ReturnDetailModal.tsx')
const printReceipt = read('src/utils/printReceipt.ts')
const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>

// --- 1. the shared id element wraps, stays selectable, and copies ---------

assert.match(copyableId, /whitespace-normal break-all/, 'CopyableId must wrap the id instead of clipping or scrolling it')
assert.match(copyableId, /select-all/, 'the id must stay selectable in one tap')
assert.match(copyableId, /navigator\.clipboard\?\.writeText/, 'CopyableId must copy through the browser clipboard API')
assert.match(copyableId, /setCopied\(true\)/, 'CopyableId must show a brief copied state')
// Class usage only -- the prose above the component is allowed to say the
// word "truncate" while explaining why it is not used.
const classAttributes = (source: string): string => (source.match(/className=(?:"[^"]*"|\{`[^`]*`\})/g) || []).join('\n')
assert.doesNotMatch(classAttributes(copyableId), /\btruncate\b|detail-scroll-text|overflow-x-auto/, 'an id is never truncated and never a horizontal scroll container')

console.log('PASS CopyableId wraps, selects, and copies the identifier with a copied state')

// --- 2. the sale detail receipt id uses it, and pushes to its own row -----

assert.match(saleDetail, /import CopyableId from '\.\.\/shared\/CopyableId\.tsx'/, 'the sale detail must use the shared copyable id')
const saleHeader = saleDetail.slice(saleDetail.indexOf('flex-shrink-0 flex-col'), saleDetail.indexOf('modal-scroll'))
assert.ok(saleHeader.length > 200, 'expected to find the sale detail modal header block')
assert.match(saleHeader, /flex-shrink-0 flex-col gap-2[\s\S]*?sm:flex-row/, 'below sm the receipt id takes a full-width row of its own and the actions drop beneath it')
assert.match(saleHeader, /<CopyableId[\s\S]*?value=\{sale\.receipt_number \|\| ''\}/, 'the receipt number itself must render through CopyableId')
assert.match(saleHeader, /copy_receipt_number/, 'the copy control must carry a translated label')
assert.doesNotMatch(saleHeader, /detail-scroll-text|truncate/, 'the sale receipt id must not be scrolled sideways or ellipsised')

console.log('PASS SaleDetailModal renders the receipt id full-width, wrapping, with a copy control and no truncation')

// --- 3. the Return action, its gate, and its guards ----------------------

assert.match(saleDetail, /onReturn\?: \(sale: SaleDetail\) => void/, 'SaleDetailModal must accept an onReturn callback')
assert.match(saleHeader, /onClick=\{\(\) => onReturn\(sale\)\}/, 'the Return button must invoke onReturn with the sale')
assert.match(saleHeader, /disabled=\{returnBlockedReason !== ''\}/, 'a sale that cannot be returned leaves the button inert')
assert.match(saleHeader, /<InfoHint text=\{returnBlockedReason\}/, 'the reason belongs behind an InfoHint, not as inline prose')
// One close affordance per modal: the header X, and nothing else.
assert.equal((saleDetail.match(/aria-label=\{t\('close'\) \|\| 'Close'\}/g) || []).length, 1, 'the sale detail modal keeps exactly one close affordance')

assert.match(saleDetail, /getSaleReturnBlockReason/, 'the sale detail must use the shared return guard, not its own copy of the rule')

// The gate is the Returns section's own create action, which
// cloudflare/src/routes/returns.ts enforces on POST /api/returns.
assert.match(sales, /const canAddReturn = can\('returns', 'add'\)/, "the Return action must be gated on the returns:add grant")
assert.match(sales, /onReturn=\{canAddReturn \? \(sale\) => startReturnForSale\(sale as SaleRecord\) : undefined\}/, 'without returns:add the prop is omitted and the action never renders')

// The SAME component the Returns section opens -- not a fork.
assert.match(sales, /lazyRetry\(\(\) => import\('\.\.\/returns\/NewReturnModal'\)/, 'Sales must open returns/NewReturnModal itself')
assert.match(sales, /<NewReturnModal[\s\S]*?initialReceiptQuery=\{returnForSale\.receipt_number \|\| String\(returnForSale\.id \|\| ''\)\}/, 'the return modal must open pre-filled with the sale')
assert.match(newReturn, /initialReceiptQuery\?: string \| null/, 'NewReturnModal must accept the additive prefill prop')
assert.match(newReturn, /useState\(\(\) => String\(initialReceiptQuery \|\| ''\)\.trim\(\)\)/, 'the prefill seeds step 1 of the existing flow')
// The seed is not a shortcut around the operator: it drives the SAME debounced
// receipt typeahead a typed query drives (pre-filled box, matching receipts
// listed, first one highlighted) and never opens a sale by itself -- a seed,
// like a scan, narrows the list; the person picks. (Reworked Sep 3 2026 when
// the receipt search became a typeahead; the old autoSearchedRef one-shot went
// with it.)
assert.match(newReturn, /useEffect\(\(\) => \{\s*const query = searchQuery\.trim\(\)[\s\S]*?lookupReceiptSuggestions\(query, RECEIPT_SUGGEST_LIMIT\)[\s\S]*?\}, \[searchQuery, step\]\)/, 'the seeded query must flow through the debounced receipt typeahead effect')
assert.doesNotMatch(newReturn, /autoSearchedRef|autoResolvedRef/, 'no one-shot auto-search may open a sale on the seed alone')
assert.equal((newReturn.match(/\[initialReceiptQuery\]/g) || []).length, 0, 'nothing but the initial state may key off the seed prop')

console.log('PASS the Return action opens the same NewReturnModal prefilled, behind returns:add, inert with a reason when blocked')

// --- 4. the guard itself -------------------------------------------------

assert.equal(getSaleReturnBlockReason({ sale_status: 'cancelled', items: [] }), 'cancelled')
assert.equal(getSaleReturnBlockReason({ sale_status: 'returned', items: [] }), 'fully_returned')
assert.equal(
  getSaleReturnBlockReason({ sale_status: 'completed', items: [{ quantity: 2, returned_quantity: 2 }, { quantity: 1, returned_quantity: 1 }] }),
  'fully_returned',
)
assert.equal(
  getSaleReturnBlockReason({ sale_status: 'completed', items: [{ quantity: 2, returned_quantity: 1 }] }),
  '',
  'a partially returned sale can still be returned',
)
assert.equal(
  getSaleReturnBlockReason({ sale_status: 'completed', items: [{ quantity: 3 }] }),
  '',
  'a row with no returned_quantity must err toward allowing the action',
)
assert.equal(
  getSaleReturnBlockReason({ sale_status: 'completed', items: '[{"quantity":1,"returned_quantity":0}]' }),
  '',
  'items arriving as a JSON string must be parsed, not treated as empty',
)
assert.equal(getSaleReturnBlockReason(null), '')

console.log('PASS the shared sale-return guard blocks cancelled and fully-returned sales only')

// --- 5. every other surface that shows a receipt / return id -------------

// The phone sales card (<768px) -- no ellipsis on the id.
const mobileCardStart = salesList.indexOf('<div className="space-y-2 md:hidden">')
assert.ok(mobileCardStart > 0, 'expected to find the md:hidden phone card list in SalesListSurface')
const mobileCard = salesList.slice(mobileCardStart)
assert.match(mobileCard, /whitespace-normal break-all font-mono text-sm font-semibold[^"]*text-blue-600/, 'the phone sales card must wrap the receipt id')
assert.doesNotMatch(mobileCard, /truncate font-mono text-sm font-semibold text-blue-600/, 'the phone sales card must not ellipsise the receipt id')

// The printable receipt view and its print template.
assert.match(receipt, /value=\{rNum\} bold breakAll/, 'the printed receipt number must break rather than overflow its column')
assert.match(receipt, /breakAll \? 'break-all' : 'break-words'/, 'Row must honour breakAll for identifiers')
assert.match(printReceipt, /overflow-wrap: anywhere;\s*\n\s*word-break: break-word;/, 'the print template must already wrap long identifiers')

// The receipt view's own Return action, same gate, same guard.
assert.match(receipt, /onReturn\?: \(\) => void/, 'the receipt view must accept the Return action')
assert.match(receipt, /disabled=\{returnDisabledReason !== ''\}/, 'the receipt view Return button obeys the same block reason')
assert.match(sales, /onReturn=\{canAddReturn \? \(\) => \{ setSelectedSale\(null\); startReturnForSale\(selectedSale\) \} : undefined\}/, 'the receipt view is wired behind the same grant')
assert.match(sales, /returnDisabledReason=\{returnBlockedReasonFor\(selectedSale\)\}/, 'the receipt view is wired to the same guard')

// The return detail id.
assert.match(returnDetail, /import CopyableId from '\.\.\/shared\/CopyableId\.tsx'/, 'the return detail must use the shared copyable id')
assert.match(returnDetail, /<CopyableId[\s\S]*?value=\{ret\.return_number \|\| ''\}[\s\S]*?copy_return_id/, 'the return id gets the same wrap + copy treatment')

console.log('PASS the phone sales card, printable receipt, print template and return detail all show ids in full')

// --- 6. both language packs ---------------------------------------------

for (const key of ['copy_receipt_number', 'copy_return_id', 'return_blocked_cancelled_sale', 'return_blocked_fully_returned']) {
  assert.ok(en[key], `en.json needs ${key}`)
  assert.ok(km[key], `km.json needs ${key}`)
  assert.notEqual(en[key], km[key], `${key} must actually be translated in km.json`)
  assert.match(km[key], /[ក-៿]/, `${key} must be Khmer script in km.json`)
}
// Reuse, not duplication: "Return" and "Copied" already exist in both packs.
assert.equal(en.return, 'Return')
assert.match(km.return, /[ក-៿]/)
assert.equal(en.copied, 'Copied')
assert.match(km.copied, /[ក-៿]/)

console.log('PASS the new receipt-id and return-guard strings exist in both language packs')

console.log('saleReceiptIdAndReturnAction tests passed')
