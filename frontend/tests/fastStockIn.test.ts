import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// F2 (Part 419): fast stock-in -- "enter batch + supplier once, then
// per-product name→details entry; Add appends and continues, Done
// completes the batch. Backed by the same add/batch kernel as D4 -- no
// parallel write path." Source pins hold each clause of that spec.

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
  // branch + received date + the SHARED supplier picker + paid/credit --
  // the same field siblings every add-stock surface uses (D5a rule)
  assert.match(modalSource, /import SupplierPickerField, \{ type SupplierChoice \} from '\.\.\/shared\/SupplierPickerField\.tsx'/)
  // F3 slice 1: initializers became draft-aware -- the saved shipment
  // header wins over a reopened-session seed; dates intentionally start
  // blank so the app never silently filters/records a preset day.
  assert.match(modalSource, /draft\?\.receivedDate \|\| initialHeader\?\.receivedDate \|\| ''/)
  assert.match(modalSource, /draft\?\.paymentStatus \|\| initialHeader\?\.paymentStatus \|\| 'paid'/)
  // every Add sends the header fields with the line
  assert.match(modalSource, /receivedDate: receivedDate\.trim\(\) \|\| null/)
  assert.match(modalSource, /supplierId: supplier\.supplierId/)
  assert.match(modalSource, /paymentStatus,/)
  assert.match(modalSource, /grid grid-cols-2 gap-2 sm:grid-cols-4/, 'shipment fields remain compact without breaking the two-column phone layout')
  assert.match(modalSource, /hintDisplay="tooltip"/, 'supplier semantics stay available without consuming another form row')
  // credit needs its due date BEFORE any write (server enforces it too)
  assert.match(modalSource, /paymentStatus === 'credit' && !creditDueDate\.trim\(\)/)
})

runTest('F2: Add queues editable lines; completion writes through the one D4 kernel', () => {
  // the shared transport is the only write path -- no parallel writes
  assert.match(modalSource, /import \{ receiveBatchStock[^}]*\} from '\.\.\/\.\.\/api\/batchesTransport\.ts'/)
  assert.doesNotMatch(modalSource, /apiFetch|fetch\(/)
  assert.equal((modalSource.match(/receiveBatchStock\(/g) || []).length, 1) // exactly one call site
  assert.match(modalSource, /status: 'queued'/)
  assert.match(modalSource, /const editLine = \(line: ReceivedLine\)/)
  assert.match(modalSource, /const removeLine = \(key: string\)/)
  assert.match(modalSource, /status: 'saved', detail: result\?\.lotCode/)
  assert.match(modalSource, /status: 'error', detail: message/)
  // Add clears the line and refocuses for the next product
  assert.match(modalSource, /const resetLine = \(\) => \{/)
  assert.match(modalSource, /searchInputRef\.current\?\.focus\(\)/)
  // Enter in the qty field is the fast path
  assert.match(modalSource, /if \(event\.key === 'Enter'\) addLine\(\)/)
})

runTest('changed cost offers and uses the existing price-variant path', () => {
  assert.match(modalSource, /import \{ adjustStock \} from '\.\.\/\.\.\/api\/inventoryWriteTransport\.tsx?'/)
  assert.match(modalSource, /setCreatePriceVariant\(costChanged\(picked, next\)\)/, 'a changed cost enables the safe variant choice by default')
  assert.match(modalSource, /create_price_variant.*Create\/use a price variant/, 'the choice is visible beside the edited cost')
  assert.match(modalSource, /unlockPricing: true/)
  assert.match(modalSource, /pricing: pricingForVariant\(line\.product, Number\(line\.unitCost\)\)/)
  assert.match(modalSource, /sessionId: sessionIdRef\.current/, 'variant receipts remain in the same stock-in session')
  assert.match(modalSource, /const sessionCostTotal = received\.reduce/, 'the shipment exposes its total recorded cost')
  assert.match(modalSource, /Total cost'\)}: \$\{sessionCostTotal\.toFixed\(2\)\}/, 'session cost stays visible above the received rows')
})

runTest('F2: the modal portals, guards mid-save closes, and Done refreshes only after real writes', () => {
  assert.match(modalSource, /return createPortal\(/)
  assert.match(modalSource, /const closeIfIdle = \(\) => \{ if \(!saving\) \{ if \(successCount > 0\) onDone\(\); onClose\(\) \} \}/)
})

runTest('F2: Inventory launches it from the Manage menu and reloads after', () => {
  assert.match(inventorySource, /const FastStockInModal = lazyRetry\(\(\) => import\('\.\/FastStockInModal'\)/)
  assert.match(inventorySource, /label: tr\('fast_stockin_title', 'Fast stock-in'\), onClick: \(\) => setShowFastStockIn\(true\)/)
  assert.match(inventorySource, /branchOptions=\{branchSelectOptions\}/)
  assert.match(inventorySource, /onDone=\{\(\) => load\(false\)\}/)
})

runTest('STK-06: an unmatched camera scan—not typed text—offers prefilled creation', () => {
  assert.match(modalSource, /const \[scannedBarcode, setScannedBarcode\]/)
  assert.match(modalSource, /ScanSearchButton onDetected=.*setScannedBarcode\(barcode\)/s)
  assert.match(modalSource, /scannedBarcode && scannedBarcode === query\.trim\(\) && searchCompleteFor === scannedBarcode && candidates\.length === 0/s)
  assert.match(modalSource, /No product matches this scanned barcode/)
  assert.match(modalSource, /onClick=\{openCreateForUnknownScan\}/)
})

runTest('STK-06: creation reuses ProductForm and resumes without losing the stock session', () => {
  assert.match(modalSource, /lazyRetry\(\(\) => import\('\.\.\/products\/forms\/ProductForm'\)/)
  assert.match(modalSource, /product=\{\{ barcode: createBarcode, branch_id: branchId, name: '', stock_quantity: 0 \}\}/)
  assert.match(modalSource, /import\('\.\.\/\.\.\/api\/productWriteTransport\.ts'\)/)
  assert.match(modalSource, /createProduct\(\{ \.\.\.payload, barcode: createBarcode, branch_id: branchId, stock_quantity: 0 \}\)/)
  assert.match(modalSource, /const fastStockInDraftKey = scopedWorkDraftKey\('fast_stockin'\)/,
    'fast stock-in drafts should be scoped to the signed-in user')
  assert.match(modalSource, /writeWorkDraft<FastStockInDraft>\(fastStockInDraftKey/)
  assert.match(modalSource, /onClose=\{\(\) => setCreateBarcode\(''\)\}/)
  assert.match(modalSource, /setCreateBarcode\(''\)\s*\n\s*pick\(created\)/)
  assert.match(modalSource, /Product created\. Continue adding it to this stock-in session\./)
})

runTest('stock-in sessions reuse linked report data and preserve per-receipt costs', () => {
  assert.match(batchRouteSource, /unit_cost_usd, total_cost_usd, reason, reference_id/)
  assert.match(batchRouteSource, /Math\.round\(Number\(body\.unit_cost_usd\) \* quantity \* 10000\) \/ 10000/)
  assert.match(stockImportSource, /CASE WHEN @costPriceUsd IS NULL THEN NULL ELSE ROUND\(@quantity \* @costPriceUsd, 4\) END/,
    'legacy stock-history imports must preserve each event cost on its movement')
  for (const field of ['p.brand', 'p.category', 'p.tag_label', 'm.unit_cost_usd', 'm.total_cost_usd', 'b.payment_status', 'b.credit_due_date', 'b.updated_at']) {
    assert.ok(ledgerSource.includes(field), `stock-session ledger should expose ${field}`)
  }
  assert.match(ledgerSource, /COUNT\(DISTINCT COALESCE\(mx\.reference_id, -mx\.id\)\)/)
  assert.match(sessionsSource, /function sessionCost\(/)
  assert.match(sessionsSource, /Shared-lot totals are not guessed\./)
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

if (failed > 0) {
  process.exitCode = 1
}

runTest('the lot picker matches the sibling add-stock surfaces', () => {
  // Same affordance ReceiveBatchModal / InventoryStockModals already have:
  // a chip row scoped to the picked product and the shipment branch.
  assert.match(modalSource, /getProductBatches/, 'the fast modal reads lots like every other add-stock surface')
  assert.match(modalSource, /getProductBatches\(productId, parsedBranchId, false\)/, 'add shows every active lot, empty ones included')
  assert.match(modalSource, /\}, \[picked\?\.id, branchId\]\)/, 'lots refetch per picked product AND branch')
  assert.match(modalSource, /setBatchChoice\('new'\)/, "a stale lot id can never ride to submit")
  assert.match(modalSource, /batchDisplayLabel\(batch, tr\('batch', 'Batch'\)\)/, 'lot labels come from the shared helper')
  // A batch is identified by its DATE -- the code is previewed, never typed.
  assert.match(modalSource, /dateToBatchCode\(receivedDate\)/, 'the derived lot code is visible before commit')
  assert.match(modalSource, /existing_lot_keeps_date/, 'picking a lot replaces the date rather than pretending it applies')
  // The choice reaches the server, and unlocked pricing never carries one.
  assert.match(modalSource, /batchId: typeof line\.batchChoice === 'number' \? line\.batchChoice : null/)
  assert.match(modalSource, /receivedDate: line\.batchChoice === 'new' \? \(receivedDate\.trim\(\) \|\| null\) : null/)
  assert.match(modalSource, /batch_auto_new_unlocked/, 'a price variant always creates a fresh lot, and says so')
  // The lot is frozen onto the queued line and stays visible.
  assert.match(modalSource, /batchChoice: effectiveBatchChoice/)
  assert.match(modalSource, /\{line\.batchLabel\}/, 'what was chosen is visible before and after Complete')
  // Reopening a queued line must not silently drop its lot: the options
  // effect re-keys on the product and would otherwise reset it to new.
  assert.match(modalSource, /pendingBatchRestoreRef/, 'the restore survives the refetch editLine triggers')
  assert.match(modalSource, /lots\.some\(\(lot\) => Number\(lot\.id\) === restore\)/, 'a lot that no longer exists here is not restored')
})

runTest('queueing a line and committing the session are visibly different actions', () => {
  // The queue action is its own row with an explicit verb -- it no longer
  // says "Save" while writing nothing.
  assert.match(modalSource, /fast_stockin_add/, "the queue button uses the 'Add & next' key")
  assert.match(modalSource, /update_line/, 'editing a queued line says Update line, not Save')
  assert.doesNotMatch(modalSource, /tr\('save', 'Save'\)/, 'nothing that writes nothing may be labelled Save')
  // Exactly one commit control per breakpoint: header on phones, footer above.
  assert.match(modalSource, /sm:hidden[\s\S]*commitSession/, 'phones commit from the header')
  assert.match(modalSource, /hidden flex-shrink-0[\s\S]*sm:flex/, 'the desktop commit sits in a footer, not in the scroll body')
  assert.match(modalSource, /lines_queued/, 'the footer states what is queued and what it costs')
  assert.match(modalSource, /add_next_hint/, 'the difference is a tooltip, not prose on the card')
})

runTest('committing asks through ConfirmDialog, and placeholders are filled', () => {
  assert.doesNotMatch(modalSource, /window\.confirm/, 'no native confirm -- off-brand and untranslatable')
  assert.match(modalSource, /<ConfirmDialog/, 'the shared compact review dialog asks instead')
  assert.match(modalSource, /confirm_complete_stock_session/, 'the existing pack key survives the move')
  // tr() does not interpolate, so every {placeholder} must be substituted or
  // the operator reads the braces literally.
  assert.match(modalSource, /\.replace\('\{lines\}'/)
  assert.match(modalSource, /\.replace\('\{units\}'/)
  assert.match(modalSource, /\.replace\('\{branch\}'/)
  assert.match(modalSource, /\.replace\('\{count\}', String\(saved\)\)/, 'the completion toast fills its count too')
  // A failure keeps the modal and the draft, and the reason stays readable.
  assert.match(modalSource, /break-words text-\[10px\]/, 'a long server reason wraps rather than being squeezed out')
})
