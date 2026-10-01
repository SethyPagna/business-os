import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

// UI-STOCK-3 (owner, 30 Sep 2026): every way into a stock change opens the
// ONE Stock Session float, and the saved stock reasons are managed from the
// Manage menus ("manage menu in products pages should also add a reasons
// function"). Each check below also runs against the pre-lane shape
// (base 57cf2db5a) and must refuse it.

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function jsxBlock(source: string, tag: string, from = 0): string {
  const start = source.indexOf(`<${tag}`, from)
  if (start < 0) return ''
  const end = source.indexOf('/>', start)
  return end < 0 ? '' : source.slice(start, end)
}

// Products header: Add is one button (icon + "Add"), never a menu.
function headerAddIsOneButton(header: string): boolean {
  return /onClick=\{onAdd\}/.test(header)
    && /const addLabel = tr\('add', 'Add'\)/.test(header)
    && !/addMenuItems|onAddStock/.test(header)
}

// Header Add opens the session in Add with the create-product hooks wired.
function headerAddOpensSession(products: string): boolean {
  const modal = jsxBlock(products, 'FastStockInModal', products.indexOf('{stockSession ? ('))
  return /onAdd=\{\(canAddProduct \|\| canAdjustInventoryStock\)[^\n]*\? \(\) => setStockSession\(\{ mode: 'add' \}\) : undefined\}/.test(products)
    && /onPrepareProduct=\{canAddProduct \? prepareProductForSession : undefined\}/.test(modal)
    && /brandOptions=\{brandOptions\}/.test(modal)
    && /canCreateProducts=\{canAddProduct\}/.test(modal)
}

// Manage > Reasons: same Tags icon on both pages, gated on the grant the
// Worker checks for PUT /api/inventory/reasons (inventory edit_reasons).
function productsManageHasReasons(header: string, products: string): boolean {
  return /\.\.\.\(onManageReasons \? \[\{ label: reasonsLabel, onClick: onManageReasons, icon: <Tags className=\{iconClass\} \/> \}\] : \[\]\)/.test(header)
    && /const reasonsLabel = tr\('reasons', 'Reasons'\)/.test(header)
    && /onManageReasons=\{canEditStockReasons \? \(\) => setReasonsManagerOpen\(true\) : undefined\}/.test(products)
    && /const canEditStockReasons = can\('inventory', 'edit_reasons'\)/.test(products)
    && /<StockReasonsManagerModal initialTab="adjust" onClose=\{\(\) => setReasonsManagerOpen\(false\)\} \/>/.test(products)
}

function inventoryManageHasReasons(inventory: string): boolean {
  return /\.\.\.\(canEditStockReasons \? \[\{ label: tr\('reasons', 'Reasons'\), onClick: \(\) => setReasonsManagerOpen\(true\), icon: <Tags className="h-4 w-4 shrink-0" \/> \}\] : \[\]\)/.test(inventory)
    && /const canEditStockReasons = can\('inventory', 'edit_reasons'\)/.test(inventory)
    && /<StockReasonsManagerModal initialTab="adjust"/.test(inventory)
}

// Every reason manager is the one shared modal, on the right tab.
function oneReasonsManager(inventory: string, modals: string, deleteModal: string): boolean {
  return !/InventoryReasonManagerModal|saveReasonCatalog|renameSavedReason|window\.prompt/.test(inventory + modals + deleteModal)
    && /<StockReasonsManagerModal initialTab="transfer"[^\n]*onChanged=\{reloadTransferReasons\} \/>/.test(modals)
    && /<StockReasonsManagerModal initialTab="delete"[^\n]*onChanged=\{reloadDeleteReasons\} \/>/.test(deleteModal)
}

// Select-mode stock panel: the selected products become Items in the panel's mode.
function bulkPanelQueuesItems(products: string): boolean {
  return /const openBulkStockSession = \(\) => \{[\s\S]*?setStockSession\(\{ mode, lines \}\)/.test(products)
    && /onClick=\{openBulkStockSession\}/.test(products)
    && /initialLines=\{stockSession\.lines\}/.test(products)
    && !/BulkAddStockModal|setBulkAddModal/.test(products)
}

// A failed attempt resumes in its mode with its lines queued. It leaves the
// list only once that session has written (onDone), never at open, and a busy
// session (the float ignores new lines then) never takes it.
function resumeQueuesAttempt(ledger: string): boolean {
  const resume = ledger.slice(ledger.indexOf('const resumeFailedAttempt = useCallback('), ledger.indexOf('}, [blurLedgerSearch])', ledger.indexOf('const resumeFailedAttempt = useCallback(')))
  return /setFastStockInResume\(stockSessionHasItems\(\) \? null : \{ lines, branchId: first\.branchId \?\? null, attemptId: attempt\.id \}\)/.test(resume)
    && /setFastStockInMode\(mode\)/.test(resume)
    && !/discardFailedAttempt/.test(resume)
    && /initialLines=\{fastStockInResume\?\.lines\}/.test(ledger)
    && /onDone=\{\(\) => \{\s*if \(fastStockInResume\) discardFailedAttempt\(fastStockInResume\.attemptId\)/.test(ledger)
    && !/StockAdjustModal|setAdjustType/.test(ledger)
}

// A parked legacy chip converts only into an empty session draft (the float
// would overwrite one with items), and the stock_adjust chip is consumed only
// once the lazy float has committed.
function legacyRestoresGuardBusySession(products: string, branches: string): boolean {
  const busyReparks = products.match(/if \((?:entry && )?stockSessionHasItems\(\)\) \{\s*reparkDeniedRestore\(entry\)\s*setStockSession\(\{ mode: 'add' \}\)\s*return/g) || []
  return busyReparks.length === 2
    && /\{restoringStockAdjustRef\.current \? <StockAdjustRestoreCommit onCommit=\{commitStockAdjustRestore\} \/> : null\}/.test(products)
    && /const commitStockAdjustRestore = useCallback\([\s\S]*?canRestoreMinimizedWork\(entry, can\)[\s\S]*?reparkDeniedRestore\(entry\)[\s\S]*?markRestoreHandled\('stock_adjust'\)/.test(products)
    && /if \(quantity > 0 && stockSessionHasItems\(\)\) \{[\s\S]*?reparkDeniedRestore\(entry\)/.test(branches)
    && /onClose=\{\(\) => \{\s*if \(receiveTarget\.legacyDraftKey\) clearWorkDraft\(receiveTarget\.legacyDraftKey\)/.test(branches)
    && !/clearWorkDraft\(draftKey\)\s*setReceiveTarget/.test(branches)
}

// "Add more" on a stock-in session keeps the session header.
function addMoreKeepsHeader(sessions: string): boolean {
  return /\{addMore \? <Suspense fallback=\{null\}><FastStockInModal[^\n]*initialHeader=\{\{ branchId: addMore\.branchId, receivedDate: addMore\.receivedDate, supplier: addMore\.supplier/.test(sessions)
}

// Chips parked by the retired forms reopen as the session with legacyDraft.
function legacyChipsRestoreIntoSession(products: string): boolean {
  return /setStockSession\(\{ mode: draft\.initialType, legacyDraft: \{ kind: 'stock_adjust', data: draft \} \}\)/.test(products)
    && /legacyDraft: \{ kind: 'create_products_session', data: readWorkDraft\(draftKey\)\?\.data \?\? null \} \}\)/.test(products)
    // The float clears a converted legacy key and keeps a blocked one as
    // evidence; the host must not discard it on close.
    && !/discardStockAdjustDraft/.test(products)
    && /legacyDraft=\{stockSession\.legacyDraft \?\? null\}/.test(products)
}

const OLD_HEADER = `
  const addMenuItems: PortalMenuItem[] = [
    ...(onAddStock ? [{ label: addStockLabel, onClick: onAddStock, color: 'blue' as const, icon: <Boxes className={iconClass} /> }] : []),
    ...(onAdd ? [{ label: addNewProductLabel, onClick: onAdd, color: 'green' as const, icon: <PackagePlus className={iconClass} /> }] : []),
  ]
  const productLabel = tr('add_products', 'Add products')
          onClick={(addMenuItems[0] as { onClick?: () => void }).onClick}
`
const OLD_PRODUCTS = `
            onManageCats={canManageLookups ? ()=>setModal('cats') : undefined}
            onAdd={(canAddProduct || canAdjustInventoryStock) && activeProductSection !== 'stock_changes' && activeProductSection !== 'stock_in_sessions' ? ()=>{setSelected(null);setFormInitialTab('basic');setCreateSessionInitialMode(canAddProduct ? 'new' : 'existing');setModal('create_session')} : undefined}
  const [bulkAddModal, setBulkAddModal] = useState<BulkAddModalState>(null)
          <button disabled={bulkActionBusy} onClick={handleBulkAddStock}>Apply</button>
          <BulkAddStockModal productIds={bulkAddModal.ids} />
          <StockAdjustModal initialProduct={adjustStockProduct} restoreDraftKey={restoreStockAdjustDraftKey} />
`
const OLD_INVENTORY = `
            { label: tr('fast_stockin_title', 'Fast stock-in'), onClick: () => setShowFastStockIn(true), color: 'green', icon: <Zap className="h-4 w-4 shrink-0" /> },
          <InventoryReasonManagerModal addSavedReason={addSavedReason} />
`
const OLD_RESUME_AT_OPEN = `
  const resumeFailedAttempt = useCallback((attempt: FailedStockAttempt) => {
    blurLedgerSearch()
    discardFailedAttempt(attempt.id)
    setFastStockInResume({ lines, branchId: first.branchId ?? null })
    setFastStockInMode(mode)
  }, [blurLedgerSearch])
            initialLines={fastStockInResume?.lines}
            onDone={() => { void load() }}
`
const OLD_BRANCHES_RESTORE = `
    const quantity = Number(draft?.quantity) || 0
    clearWorkDraft(draftKey)
    setReceiveTarget(quantity > 0
`
const OLD_LEDGER = `
    setResumeAttempt(attempt)
    setAdjustType(row.type === 'remove' || row.type === 'set' ? row.type : 'add')
          <StockAdjustModal initialType={adjustType} />
`

const header = read('../src/components/products/surfaces/HeaderActions.tsx')
const products = read('../src/components/products/Products.tsx')
const inventory = read('../src/components/inventory/Inventory.tsx')
const modals = read('../src/components/inventory/InventoryStockModals.tsx')
const deleteModal = read('../src/components/products/DeleteConfirmModal.tsx')
const ledger = read('../src/components/products/StockChangeSection.tsx')
const sessions = read('../src/components/products/StockInSessionsSection.tsx')
const branches = read('../src/components/branches/Branches.tsx')

await runTest('the checks refuse the pre-lane sources', () => {
  assert.equal(headerAddIsOneButton(OLD_HEADER), false)
  assert.equal(headerAddOpensSession(OLD_PRODUCTS), false)
  assert.equal(productsManageHasReasons(OLD_HEADER, OLD_PRODUCTS), false)
  assert.equal(inventoryManageHasReasons(OLD_INVENTORY), false)
  assert.equal(oneReasonsManager(OLD_INVENTORY, '', ''), false)
  assert.equal(bulkPanelQueuesItems(OLD_PRODUCTS), false)
  assert.equal(resumeQueuesAttempt(OLD_LEDGER), false)
  assert.equal(legacyChipsRestoreIntoSession(OLD_PRODUCTS), false)
  assert.equal(resumeQueuesAttempt(OLD_RESUME_AT_OPEN), false, 'dropping the attempt at open loses it when the session is closed or busy')
  assert.equal(legacyRestoresGuardBusySession(OLD_PRODUCTS, OLD_BRANCHES_RESTORE), false)
})

await runTest('Products header Add is one button reading Add, opening the session in Add', () => {
  assert.ok(headerAddIsOneButton(header))
  assert.ok(headerAddOpensSession(products))
})

await runTest('Products and Inventory Manage menus have Reasons, gated on inventory edit_reasons', () => {
  assert.ok(productsManageHasReasons(header, products))
  assert.ok(inventoryManageHasReasons(inventory))
})

await runTest('the transfer form and the delete review use the one stock reasons manager', () => {
  assert.ok(oneReasonsManager(inventory, modals, deleteModal))
  assert.equal(existsSync(new URL('../src/components/inventory/InventoryReasonManagerModal.tsx', import.meta.url)), false)
})

await runTest('the select-mode stock panel queues the selected products as Items', () => {
  assert.ok(bulkPanelQueuesItems(products))
})

await runTest('a failed attempt resumes as the session with its lines queued', () => {
  assert.ok(resumeQueuesAttempt(ledger))
})

await runTest('stock-in session "add more" keeps its header', () => {
  assert.ok(addMoreKeepsHeader(sessions))
})

await runTest('chips parked by the retired forms restore into the session', () => {
  assert.ok(legacyChipsRestoreIntoSession(products))
})

await runTest('a busy session never swallows a parked chip, a Receive draft or a failed attempt', () => {
  assert.ok(legacyRestoresGuardBusySession(products, branches))
})

await runTest('stockSessionHasItems reads the one session draft and never throws', async () => {
  const memory = new Map<string, string>()
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value) },
    removeItem: (key: string) => { memory.delete(key) },
  }
  const globals = globalThis as Record<string, unknown>
  globals.localStorage = storage
  globals.sessionStorage = storage
  const { stockSessionHasItems } = await import('../src/utils/stockSessionBusy.ts')
  const { scopedWorkDraftKey, writeWorkDraft } = await import('../src/utils/workDrafts.ts')
  assert.equal(stockSessionHasItems(), false, 'no draft')
  writeWorkDraft(scopedWorkDraftKey('fast_stockin'), { version: 2, lines: [] })
  assert.equal(stockSessionHasItems(), false, 'an empty session takes new lines')
  writeWorkDraft(scopedWorkDraftKey('fast_stockin'), { version: 2, lines: [{ key: 'a' }] })
  assert.equal(stockSessionHasItems(), true, 'a session with items is busy')
  writeWorkDraft(scopedWorkDraftKey('stock_adjust'), { version: 2, lines: [{ key: 'b' }] })
  globals.localStorage = { getItem: () => { throw new Error('blocked') } }
  assert.equal(stockSessionHasItems(), false, 'blocked storage reads as not busy')
})

await runTest('the retired stock forms are gone', () => {
  for (const rel of [
    '../src/components/products/forms/StockAdjustModal.tsx',
    '../src/components/products/forms/BulkAddStockModal.tsx',
    '../src/components/products/CreateProductsSessionModal.tsx',
    '../src/components/inventory/ReceiveBatchModal.tsx',
    '../src/utils/createProductsSessionPayment.ts',
    '../src/utils/useRestoredStockAdjustDirty.ts',
    '../src/utils/stockAdjustReview.ts',
  ]) assert.equal(existsSync(new URL(rel, import.meta.url)), false, rel)
  assert.doesNotMatch(modals, /adjustModal|pricingLocked|lock_current_pricing/, 'the adjust half of InventoryStockModals is gone')
})

await runTest('the select-mode stock panel keeps Add / Remove / Set on its own row at 360 px', () => {
  // Seen in the browser at 360: with flex-1 + min-w-0 the mode group shrank to one clipped chip beside Qty and a long Apply label.
  const panel = products.slice(products.indexOf("bulkEditMode === 'stock' && ("), products.indexOf("bulkEditMode === 'branch' && ("))
  assert.ok(panel.length > 0, 'panel located')
  assert.match(panel, /role="group"[^]*?className="grid basis-full grid-cols-3[^"]*sm:basis-auto"/, 'the mode group takes a full row on a phone')
  assert.doesNotMatch(panel, /grid min-w-0 flex-1 grid-cols-3/, 'the shrinking flex-1 form is gone')
  assert.match(panel, /className="btn-primary h-9 min-w-0 flex-1[^"]*sm:flex-none"[^>]*onClick=\{openBulkStockSession\}/, 'Apply fills the second row')
})

if (failed > 0) process.exitCode = 1
