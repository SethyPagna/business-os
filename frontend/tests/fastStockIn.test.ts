import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { nullableMoney4, multiplyMoney4 } from '../src/utils/moneyPrecision.ts'
import { buildStockLineRequest, type StockSessionLine } from '../src/utils/stockSessionDraft.ts'

// F2 (Part 419): fast stock-in -- "enter batch + supplier once, then
// per-product name→details entry; Add appends and continues, Done
// completes the batch. Backed by the same add/batch kernel as D4 -- no
// parallel write path." Source pins hold each clause of that spec.
//
// UI-STOCK-2 (30 Sep 2026) rewrote the modal as the one Stock Session (parts
// in components/stock-session, the line writer in utils/stockSessionDraft.ts)
// and UI-STOCK-3 repointed these pins to it; what the session deliberately
// changed (a Review step instead of a confirm popup, "Add" instead of "Add &
// next", no separate "Total cost" strip) is listed in the UI-STOCK-3 report.

let failed = 0

type TestCallback = () => void

function runTest(name: string, fn: TestCallback): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const modalSource = readFileSync(new URL('../src/components/inventory/FastStockInModal.tsx', import.meta.url), 'utf8')
const sharedDetailsSource = readFileSync(new URL('../src/components/stock-session/StockSessionSharedDetails.tsx', import.meta.url), 'utf8')
const lineEntrySource = readFileSync(new URL('../src/components/stock-session/StockSessionLineEntry.tsx', import.meta.url), 'utf8')
const itemsSource = readFileSync(new URL('../src/components/stock-session/StockSessionItems.tsx', import.meta.url), 'utf8')
const footerSource = readFileSync(new URL('../src/components/stock-session/StockSessionFooter.tsx', import.meta.url), 'utf8')
const reviewSource = readFileSync(new URL('../src/components/stock-session/StockSessionReviewStep.tsx', import.meta.url), 'utf8')
const draftSource = readFileSync(new URL('../src/utils/stockSessionDraft.ts', import.meta.url), 'utf8')

// One Add line through the real writer, with a given header.
function lineRequest(over: Record<string, unknown>, header: { paymentStatus?: 'paid' | 'credit'; creditDueDate?: string } = {}) {
  const line = {
    key: 'l', requestId: 'r', product: { id: 7, name: 'Soap' }, productName: 'Soap', mode: 'add', quantity: 3, freeQuantity: 0,
    unitCost: '2.5', sellingPrice: '', freeGoods: false, expiryDate: '', batchChoice: 'new', batchLabel: '', reason: '',
    conditionTag: '', createdProduct: false, status: 'queued', detail: '', ...over,
  } as unknown as StockSessionLine
  const request = buildStockLineRequest(line, {
    branchId: '2', receivedDate: '2026-09-30', supplier: { supplierId: 5, supplierName: 'Bong Long' },
    paymentStatus: header.paymentStatus || 'paid', creditDueDate: header.creditDueDate || '', sessionId: 99, canEditPrice: false,
    reasonFor: () => 'Reason',
  })
  return { wire: request.wire, body: request.body as Record<string, unknown> }
}
const inventorySource = readFileSync(new URL('../src/components/inventory/Inventory.tsx', import.meta.url), 'utf8')
const sessionsSource = readFileSync(new URL('../src/components/products/StockInSessionsSection.tsx', import.meta.url), 'utf8')
const batchTransportSource = readFileSync(new URL('../src/api/batchesTransport.ts', import.meta.url), 'utf8')
const ledgerSource = readFileSync(new URL('../../cloudflare/src/lib/stockLedgerQuery.ts', import.meta.url), 'utf8')
const batchRouteSource = readFileSync(new URL('../../cloudflare/src/routes/batches.ts', import.meta.url), 'utf8')
const stockImportSource = readFileSync(new URL('../../cloudflare/src/lib/stockActionCommit.ts', import.meta.url), 'utf8')
const productsRouteSource = readFileSync(new URL('../../cloudflare/src/routes/products.ts', import.meta.url), 'utf8')
const productReadTransportSource = readFileSync(new URL('../src/api/productReadTransport.ts', import.meta.url), 'utf8')
const stockSessionQuerySource = readFileSync(new URL('../../cloudflare/src/lib/stockInSessionsQuery.ts', import.meta.url), 'utf8')

runTest('F2: the shipment header is entered once and rides every line', () => {
  // branch + received date + the SHARED supplier picker + paid/credit -- the
  // same field siblings every stock surface uses (D5a rule), in one row group
  assert.match(sharedDetailsSource, /import SupplierPickerField, \{ type SupplierChoice \} from '\.\.\/shared\/SupplierPickerField\.tsx'/)
  assert.match(sharedDetailsSource, /grid grid-cols-2 gap-1\.5 sm:grid-cols-4/, 'shared details stay compact without breaking the two-column phone layout')
  // a reopened session's header seeds the new one; the date is today otherwise
  assert.match(modalSource, /receivedDate: initialHeader\?\.receivedDate \|\| todayStr\(\)/)
  assert.match(modalSource, /paymentStatus: initialHeader\?\.paymentStatus/)
  // every line carries the header, executed through the real writer
  const paid = lineRequest({})
  assert.equal(paid.wire, 'receive')
  assert.equal(paid.body.branchId, 2)
  assert.equal(paid.body.receivedDate, '2026-09-30')
  assert.equal(paid.body.supplierId, 5)
  assert.equal(paid.body.supplierName, 'Bong Long')
  assert.equal(paid.body.paymentStatus, 'paid')
  assert.equal(paid.body.sessionId, 99)
  assert.equal(lineRequest({}, { paymentStatus: 'credit', creditDueDate: '2026-10-15' }).body.creditDueDate, '2026-10-15')
  // credit needs its due date BEFORE any write (server enforces it too)
  assert.match(modalSource, /dueInvalid=\{paymentStatus === 'credit' && !creditDueDate\.trim\(\)\}/)
})

runTest('F2: Add queues editable lines; completion writes through the one D4 kernel', () => {
  // the shared transports are the only write paths -- no parallel writes
  assert.match(modalSource, /import \{ receiveBatchStock[^}]*\} from '\.\.\/\.\.\/api\/batchesTransport\.ts'/)
  assert.doesNotMatch(modalSource, /apiFetch|[^.a-zA-Z]fetch\(/)
  assert.equal((modalSource.match(/receiveBatchStock\(/g) || []).length, 1) // exactly one call site
  assert.match(modalSource, /\s+status: 'queued',\s/)
  assert.match(modalSource, /function editLine\(line: StockSessionLine\)/)
  assert.match(modalSource, /const removeLine = \(key: string\)/)
  // a saved Add shows its received date; remove / set say what they did
  assert.match(modalSource, /const describeLineResult = \(line: StockSessionLine, result[^)]*\): string => \(\s*line\.mode === 'remove'[^]*?: line\.mode === 'set'[^]*?: result\?\.lotCode/)
  assert.equal((modalSource.match(/detail: describeLineResult\(line, result/g) || []).length, 2, 'both the batched-result branch and the sequential fallback report through the same function')
  // every failure detail goes through one helper (a guard refusal is a translated sentence)
  assert.match(modalSource, /const failureText = \(error: unknown, fallback: string\): string => \{[^]*?stockFailureText\(error, tr, fallback\)/)
  assert.ok((modalSource.match(/detail: failureText\(/g) || []).length >= 3, 'sequential, batched and creation failures all report through one helper')
  // Add clears the line and refocuses for the next product
  assert.match(modalSource, /const resetLine = \(\) => \{/)
  assert.match(modalSource, /searchInputRef\.current\?\.focus\(\)/)
  // Enter in the reason box is the fast path
  assert.match(lineEntrySource, /onEnter=\{onAdd\}/)
})

runTest('the same product cannot be added twice in one stock session', () => {
  assert.match(modalSource, /findSessionProductDuplicate\(duplicateRows, candidate, editingKey\)/,
    'selecting a duplicate redirects before another line is opened')
  assert.match(modalSource, /findSessionProductDuplicate\(duplicateRows, picked, editingKey\)/,
    'Add rechecks the rule immediately before queueing')
  assert.match(modalSource, /create_products_session_duplicate', 'Duplicate: You added this item already\.'/)
  assert.equal((modalSource.match(/duplicate\.row\.status !== 'saved'\) editLine\(duplicate\.row/g) || []).length, 2,
    'queued duplicates reopen for quantity editing; saved lines remain immutable')
  assert.match(modalSource, /if \(saving \|\| line\.status === 'saved' \|\| line\.needsRemoval\) return/, 'a saved line never reopens')
  assert.match(modalSource, /sessionDuplicateCheck=\{\(candidate\) => Boolean\(findSessionProductDuplicate\(duplicateRows, candidate\)\)\}/,
    'nested product creation sees saved and queued session lines too')
})

runTest('changed receipt cost retains the original product instead of offering a price-only variant', () => {
  assert.match(modalSource, /import \{ adjustStock[^}]*\} from '\.\.\/\.\.\/api\/inventoryWriteTransport\.tsx?'/)
  assert.doesNotMatch(modalSource + draftSource, /setCreatePriceVariant|create_price_variant|unlockPricing: true|pricingForVariant/)
  // A changed cost rides the same product id and the same session.
  const changed = lineRequest({ unitCost: '9.9999' })
  assert.equal(changed.body.productId, 7)
  assert.equal(changed.body.unitCostUsd, 9.9999)
  assert.equal(changed.body.sessionId, 99, 'receipts remain in the same stock-in session')
  // The shipment exposes its total recorded cost beside Next / Complete Session.
  assert.match(footerSource, /total/)
})

runTest('known zero catalog cost is prefetched and the two read surfaces agree on missing', () => {
  assert.match(draftSource, /export function catalogCostOf/)
  assert.match(modalSource, /unitCost: canViewCosts && cost != null \? String\(cost\) : ''/, 'a known $0 prefills 0; an unknown cost prefills nothing')
  assert.match(sessionsSource, /movementTotal != null && Number\.isFinite\(movementTotal\) && movementTotal >= 0/)
  // The SQL that decides recorded-vs-missing is tested where it can be RUN,
  // against real rows: cloudflare/scripts/test-stock-in-sessions-pure.cjs.
  // What belongs here is the pair that can silently split: the desktop table
  // cell and the phone card render the same figure.
  assert.equal((sessionsSource.match(/unitCost == null \?/g) || []).length, 2,
    'the table cell and the card must both test for null only')
  assert.equal((sessionsSource.match(/unitCost == null \|\| Number\(unitCost\) <= 0/g) || []).length, 0,
    'a recorded $0.00 unit cost is a cost, on both surfaces')
})

runTest('F2: the modal portals, guards mid-save closes, and Done refreshes only after real writes', () => {
  assert.match(modalSource, /return createPortal\(/)
  assert.match(modalSource, /const requestCloseIfIdle = \(\) => \{ if \(!saving\) closeGuard\.requestClose\(\) \}/)
  assert.match(modalSource, /const closeGuard = useCloseGuard\(\{ dirty: closeDirty \}, discardAndClose, onMinimize \? preserveAndMinimize : undefined\)/)
  assert.match(modalSource, /if \(received\.some\(\(line\) => line\.status === 'saved'\)\) onDone\(\)\s+onClose\(\)/)
})

runTest('F2: Inventory launches it from the Manage menu (Adjust) and reloads after', () => {
  assert.match(inventorySource, /const FastStockInModal = lazyRetry\(\(\) => import\('\.\/FastStockInModal'\)/)
  assert.match(inventorySource, /label: tr\('adjust', 'Adjust'\), onClick: \(\) => openFastStockIn\(null\)/)
  assert.match(inventorySource, /branchOptions=\{branchSelectOptions\}/)
  assert.match(inventorySource, /onDone=\{\(\) => load\(false\)\}/)
})

runTest('STK-06: an unmatched scan or search offers prefilled creation', () => {
  // UI-STOCK-2 (spec 5.7): any unmatched search of 2+ characters offers
  // "+ Create"; a scanned code or a digit run lands in the barcode field.
  assert.match(modalSource, /const \[scannedBarcode, setScannedBarcode\]/)
  assert.match(modalSource, /onScan=\{\(value\) => \{[^]*?setScannedBarcode\(barcode\)/s)
  assert.match(modalSource, /const createText = mode === 'add' && canCreate && !picked && query\.trim\(\)\.length >= 2 && searchCompleteFor === query\.trim\(\) \? query\.trim\(\) : null/)
  assert.match(modalSource, /const looksLikeBarcode = \/\^\\d\{6,\}\$\/\.test\(text\) \|\| \(scannedBarcode && scannedBarcode === text\)/)
  assert.match(modalSource, /setCreateForm\(\{ name: looksLikeBarcode \? '' : text, barcode: looksLikeBarcode \? text : '' \}\)/)
})

runTest('STK-06: creation reuses ProductForm and resumes without losing the stock session', () => {
  assert.match(modalSource, /lazyRetry\(\(\) => import\('\.\.\/products\/forms\/ProductForm'\)/)
  assert.match(modalSource, /import\('\.\.\/\.\.\/api\/productWriteTransport\.ts'\)/)
  // The product is created only when the session completes, with no stock of its own.
  assert.match(modalSource, /const result = await createProduct\(\{[^]*?client_request_id: line\.createRequestId,[^]*?stock_quantity: 0,/)
  assert.match(modalSource, /const fastStockInDraftKey = scopedWorkDraftKey\('fast_stockin'\)/,
    'stock session drafts should be scoped to the signed-in user')
  assert.match(modalSource, /writeWorkDraft<StockSessionDraft>\(fastStockInDraftKey/)
  assert.match(modalSource, /onClose=\{\(\) => setCreateForm\(null\)\}/)
  const holdStart = modalSource.indexOf('  const holdNewProduct = async')
  const hold = modalSource.slice(holdStart, modalSource.indexOf('\n  const ', holdStart + 1))
  assert.ok(holdStart > 0 && hold.length > 0)
  assert.match(hold, /applyEntry\(\{[^]*?picked: product/, 'the held product becomes the picked line')
  assert.doesNotMatch(hold, /setCreateForm\(null\)/, 'ProductForm must clear its draft before its onClose unmounts the form')
})

runTest('stock-in sessions reuse linked report data and preserve per-receipt costs', () => {
  assert.match(batchRouteSource, /unit_cost_usd, total_cost_usd, reason, reference_id/)
  assert.match(batchRouteSource, /unitCostUsd = nullableMoney4\(body\.unit_cost_usd\)/)
  // Since free units (UI-STOCK-1): the supplier is owed for the paid units only.
  assert.match(batchRouteSource, /totalCostUsd = unitCostUsd == null \? null : multiplyMoney4\(unitCostUsd, paidQuantity\)/)
  assert.ok(batchRouteSource.indexOf('totalCostUsd = unitCostUsd') < batchRouteSource.indexOf('received = await receiveBatchStock'),
    'receipt cost must be calculated and range-checked before stock mutation')
  assert.match(stockImportSource, /totalCostUsd = costPriceUsd == null \? null : multiplyMoney4\(costPriceUsd, quantity\)/)
  assert.match(stockImportSource, /@costPriceUsd,\s*@totalCostUsd,/,
    'stock-history imports bind the exact per-event snapshot into the movement')
  assert.equal(nullableMoney4(null), null, 'unknown cost is not zero')
  assert.equal(nullableMoney4(0), 0, 'explicit zero remains known')
  assert.equal(multiplyMoney4(.0003, .5), .0002, 'halfway event cost rounds nearest4, not binary Math.round')
  assert.equal(multiplyMoney4(.3333, 3), .9999, 'per-receipt cost retains four decimals')
  assert.throws(() => multiplyMoney4(1e11, 2), /money_overflow/, 'unsafe event totals refuse before writes')
  for (const field of ['p.brand', 'p.category', 'p.tag_label', 'm.unit_cost_usd', 'm.total_cost_usd', 'b.payment_status', 'b.credit_due_date', 'b.updated_at']) {
    assert.ok(ledgerSource.includes(field), `stock-session ledger should expose ${field}`)
  }
  assert.match(ledgerSource, /COUNT\(DISTINCT COALESCE\(mx\.reference_id, -mx\.id\)\)/)
  assert.match(sessionsSource, /function sessionCost\(/)
  assert.match(sessionsSource, /Shared received-date totals are not guessed\./)
  assert.match(sessionsSource, /fmtDateTime24\(session\.createdAt\)/)
  assert.match(sessionsSource, /selectedLine\.brand[\s\S]*selectedLine\.category/,
    'brand and category should remain available after opening a stock-in line')
  assert.match(sessionsSource, /\[row\.barcode, row\.unit, row\.tag_label\]/,
    'compact mobile rows should keep identity details while folding brand/category into the opened detail')
  assert.match(productsRouteSource, /app\.get\('\/stock-in-sessions'/)
  assert.match(productsRouteSource, /app\.get\('\/stock-in-session-lines'/)
  assert.match(stockSessionQuerySource, /GROUP BY session_key/)
  assert.match(sessionsSource, /getStockInSessions\(\{ page, pageSize, search \}\)/,
    'session history should page grouped summaries server-side instead of downloading a fixed movement prefix')
  assert.match(sessionsSource, /getStockInSessionLines\(summary\.key\)/,
    'full linked lines should load only when a session opens')
  assert.match(sessionsSource, /!payload \|\| !Array\.isArray\(payload\.rows\)/,
    'a broken detail response must stay contained as an inline session error, never become a fake empty receipt')
  assert.match(productReadTransportSource, /\/api\/products\/stock-in-sessions/)
})

runTest('stock-in header edits are collision- and concurrency-safe', () => {
  assert.match(sessionsSource, /selected\.hasSharedBatch/)
  assert.match(sessionsSource, /expectedUpdatedAt: row\.batch_updated_at/)
  assert.match(sessionsSource, /editPayment === 'credit' && !editCreditDueDate\.trim\(\)/)
  assert.match(batchTransportSource, /body\.payment_status = patch\.paymentStatus/)
  assert.match(batchTransportSource, /body\.credit_due_date = patch\.creditDueDate/)
})

runTest('the lot picker reads the product lots at the session branch', () => {
  assert.match(modalSource, /getProductBatches\(productIdNumber, Number\(branchId\), false\)/, 'add shows every active lot, empty ones included')
  assert.match(modalSource, /setBatchChoice\(mode === 'add' \? 'new' : 'none'\)/, 'a stale lot id can never ride to submit')
  assert.match(modalSource, /batchDisplayLabel\(lot, tr\('batch', 'Received date'\)\)/, 'lot labels come from the shared helper')
  // A batch is identified by its DATE; a new one shows the session date.
  assert.match(modalSource, /tr\('received_date_new', 'New · \{date\}'\)\.replace\('\{date\}', formatBatchReceivedDate\(receivedDate\) \|\| receivedDate\)/)
  // The choice reaches the server: a chosen lot by id; only 'new' takes the session date.
  assert.equal(lineRequest({ batchChoice: 4 }).body.batchId, 4)
  assert.equal(lineRequest({ batchChoice: 4 }).body.receivedDate, null)
  assert.equal(lineRequest({ batchChoice: 'new' }).body.receivedDate, '2026-09-30')
  // The lot is frozen onto the queued line and stays visible.
  assert.match(modalSource, /\s+batchChoice,\s+batchLabel: lotLabelFor\(batchChoice\),/)
  assert.match(itemsSource, /line\.batchLabel \? ` · \$\{shortDate\(line\.batchLabel\)\}` : ''/, 'what was chosen is visible before and after Complete')
  // Reopening a queued line must not silently drop its lot.
  assert.match(modalSource, /pendingBatchRestoreRef\.current = line\.batchChoice/, 'the restore survives the refetch editLine triggers')
  assert.match(modalSource, /typeof restore === 'number' && choices\.some\(\(lot\) => Number\(lot\.id\) === restore\)/, 'a lot that no longer exists here is not restored')
})

runTest('queueing a line and completing the session are visibly different actions', () => {
  // The line button reads "Add" (owner, 30 Sep), a text button, no icon.
  // Editing a queued line currently reads "Save" although it writes nothing;
  // the old "Update line" rule is handed to UI-STOCK-2 (UI-STOCK-3 HANDOFF).
  assert.match(lineEntrySource, /\{editing \? tr\('[a-z_]+', '[^']+'\) : tr\('add', 'Add'\)\}/)
  assert.doesNotMatch(modalSource, /tr\('save', 'Save'\)/, 'the float itself labels nothing Save')
  assert.match(modalSource, /tr\('complete_session', 'Complete Session'\)/, 'the commit says Complete Session, on the Review step')
  // ONE primary at every width, in the footer (modalPrimaryPlacement rule).
  assert.equal((footerSource.match(/onClick=\{onPrimary\}/g) || []).length, 1, 'exactly ONE commit control, not one per breakpoint')
  assert.doesNotMatch(footerSource, /(^|["'`\s])(sm:|md:|lg:|xl:)hidden(?=["'`\s]|$)/, 'the primary is never hidden at any width')
})

runTest('completing reviews in the session itself, and placeholders are filled', () => {
  assert.doesNotMatch(modalSource, /window\.confirm/, 'no native confirm -- off-brand and untranslatable')
  // Spec 4.3: the Review step IS the confirmation, so no popup follows it.
  assert.match(modalSource, /<StockSessionReviewStep /)
  assert.match(reviewSource, /It is the review the confirm-dialog rule asks for, so no popup follows it\./)
  // tr() does not interpolate, so every {placeholder} must be substituted.
  assert.match(modalSource, /\.replace\('\{count\}', String\(saved\)\)/, 'the completion toast fills its count')
  assert.match(modalSource, /\.replace\('\{n\}', String\(failed\)\)/, 'the partial toast fills its count')
  // A failure keeps the session and the draft, and the reason stays readable.
  assert.match(itemsSource, /line\.status === 'error' && line\.detail \? <span className="block break-words/, 'a long server reason wraps rather than being squeezed out')
})

// Every money figure the modal prints uses the Settings currency symbol
// (owner, 24 Sep 2026: the currency settings must actually apply). Rendered,
// not grepped: the modal is bundled with the app context, the portal and the
// draft store stubbed, restoring one queued 3 x 2.5 line under a custom "US$".
{
  const { build } = await import('esbuild')
  const React = (await import('react')).default
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { createRequire } = await import('node:module')
  const { fileURLToPath } = await import('node:url')
  const stubs: Record<string, string> = {
    context: 'export const useApp = () => globalThis.__fastStockInTestContext;',
    portal: 'export const createPortal = (node) => node;',
    drafts: `export const readWorkDraft = () => ({ data: globalThis.__fastStockInTestDraft });
      export const scopedWorkDraftKey = (key) => key;
      export const scheduleWorkDraftWrite = () => {}; export const clearWorkDraft = () => {};
      export const flushPendingWorkDraft = () => {}; export const writeWorkDraft = () => {};`,
  }
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/components/inventory/FastStockInModal.tsx', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
    external: ['react', 'react-dom/server'],
    plugins: [{ name: 'fast-stock-in-currency', setup(builder) {
      // Only the modal's own imports: siblings bundled with it (never rendered
      // here) take other exports from the real modules.
      const own = (path: string) => (args: { importer: string }) => (/FastStockInModal\.tsx$/.test(args.importer) ? { path, namespace: 'fsi-stub' } : undefined)
      builder.onResolve({ filter: /(?:^|\/)AppContext(?:\.tsx)?$/ }, own('context'))
      builder.onResolve({ filter: /^react-dom$/ }, own('portal'))
      builder.onResolve({ filter: /utils\/workDrafts(?:\.ts)?$/ }, own('drafts'))
      builder.onLoad({ filter: /.*/, namespace: 'fsi-stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }))
    } }],
  })
  const bundled = { exports: {} as { default: (props: Record<string, unknown>) => unknown } }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports)
  Object.assign(globalThis, {
    __fastStockInTestContext: { user: { permissions: { product_cost_view: true, product_cost_edit: true } }, exchangeRate: 4250, usdSymbol: 'US$', khrSymbol: 'KHR' },
    __fastStockInTestDraft: { lines: [{
      key: 'l1', requestId: 'r1', product: { id: 1, name: 'Soap', barcode: '' }, productName: 'Soap', quantity: 3, unitCost: '2.5',
      freeGoods: false, createPriceVariant: false, expiryDate: '', batchChoice: 'new', batchLabel: 'New', mode: 'add', reason: '', conditionTag: '', createdProduct: false, status: 'queued',
    }] },
  })
  // The portal target is only named, never touched, by the stubbed createPortal.
  const hadDocument = 'document' in globalThis
  if (!hadDocument) Object.assign(globalThis, { document: { body: null } })
  const markup = renderToStaticMarkup(React.createElement(bundled.exports.default as never, {
    branchOptions: [{ value: '1', label: 'Main' }], defaultBranchId: '1',
    tr: (_key: string, fallback?: string) => fallback ?? _key, notify: () => {}, onClose: () => {}, onDone: () => {},
  }))
  if (!hadDocument) delete (globalThis as { document?: unknown }).document

  runTest('the item cost and the footer total print the Settings currency symbol, never a hard-coded $', () => {
    assert.ok((markup.match(/US\$7\.50/g) || []).length >= 2, 'the queued item and the footer total both print US$7.50')
    assert.doesNotMatch(markup, /(?<!US)\$7\.50/, 'no money figure falls back to a literal $')
  })
}

// The exit guard MUST be the last statement in this file. It previously sat
// at line 152 with three runTest() calls after it, so a failure in any of
// those three incremented a counter nothing re-read: the file printed FAIL
// and still exited 0. test:utils chains with &&, so the whole gate reported
// green over a real red. Anything appended below this guard is invisible.
if (failed > 0) {
  process.exitCode = 1
}
