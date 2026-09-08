import assert from 'node:assert/strict'
import fs from 'node:fs'

import { canRestoreMinimizedWork } from '../src/utils/minimizedWork.ts'

const modal = fs.readFileSync(new URL('../src/components/inventory/FastStockInModal.tsx', import.meta.url), 'utf8')
const inventory = fs.readFileSync(new URL('../src/components/inventory/Inventory.tsx', import.meta.url), 'utf8')
const stockChanges = fs.readFileSync(new URL('../src/components/products/StockChangeSection.tsx', import.meta.url), 'utf8')

assert.match(modal, /import \{[^}]*flushPendingWorkDraft[^}]*\} from '\.\.\/\.\.\/utils\/workDrafts\.ts'/)

assert.match(modal, /import UnsavedChangesPrompt from '\.\.\/shared\/UnsavedChangesPrompt\.tsx'/)
assert.match(modal, /const closeGuard = useCloseGuard\(\{ dirty: closeDirty \}, discardAndClose, onMinimize \? preserveAndMinimize : undefined\)/, 'dirty X must use the shared Discard / Back / Minimize guard')
assert.match(modal, /<button type="button" onClick=\{requestCloseIfIdle\}[^>]*aria-label=\{tr\('close'/, 'the header X must request close, not minimize')
assert.doesNotMatch(modal, /onClick=\{preserveAndMinimize\}[^>]*aria-label=\{tr\('close'/, 'the header X must never call the preserve path')

const minimizeStart = modal.indexOf('  const preserveAndMinimize = () => {')
const minimizeEnd = modal.indexOf('  const discardAndClose', minimizeStart)
assert.ok(minimizeStart >= 0 && minimizeEnd > minimizeStart)
const minimizeBody = modal.slice(minimizeStart, minimizeEnd)
assert.ok(minimizeBody.indexOf('flushPendingWorkDraft(fastStockInDraftKey)') < minimizeBody.indexOf("onMinimize(tr('fast_stockin_title'"), 'minimize must flush before parking the chip')
assert.ok(minimizeBody.indexOf("onMinimize(tr('fast_stockin_title'") < minimizeBody.indexOf('onClose()'), 'chip must be parked before the modal unmounts')
assert.match(modal, /<MinimizeButton[\s\S]*?onMinimize=\{preserveAndMinimize\}/, 'the minus calls the direct preserve path')

const discardStart = modal.indexOf('  const discardAndClose = () => {')
const discardEnd = modal.indexOf('  const closeGuard', discardStart)
const discardBody = modal.slice(discardStart, discardEnd)
assert.ok(discardBody.indexOf('clearWorkDraft(fastStockInDraftKey)') < discardBody.indexOf('onClose()'), 'Discard clears the exact draft before unmount')
assert.doesNotMatch(discardBody, /onMinimize/, 'Discard must not park a minimized chip')

assert.match(modal, /freeGoods\?: boolean/)
assert.match(modal, /batchChoice\?: 'new' \| number/)
assert.match(modal, /setFreeGoods\]\s*=\s*useState\(Boolean\(draft\?\.freeGoods\)\)/, 'free-goods choice must restore')
assert.match(modal, /pendingBatchRestoreRef = useRef<'new' \| number \| null>\(draft\?\.batchChoice \?\? null\)/, 'a parked lot choice must be revalidated by the existing options effect')
assert.match(modal, /unitCost, freeGoods, createPriceVariant, expiryDate, batchChoice, lines: received/, 'both debounced and synchronous drafts preserve in-progress receipt values')

const createStart = modal.indexOf('  const createProductForScannedBarcode = async')
const createEnd = modal.indexOf('  const addLine', createStart)
assert.ok(createStart >= 0 && createEnd > createStart)
assert.doesNotMatch(modal.slice(createStart, createEnd), /setCreateBarcode\(''\)/, 'successful scanner creation must return to ProductForm before ProductForm clears and closes')
assert.match(modal, /onClose=\{\(\) => setCreateBarcode\(''\)\}/, 'ProductForm owns the scanner child close after its successful clean latch')

assert.match(inventory, /draftKey: scopedWorkDraftKey\('fast_stockin'\)/)
assert.match(inventory, /requiredPermission: \{ permissionKey: 'inventory', actionKey: 'adjust' \}/)
assert.match(inventory, /\.\.\.FAST_STOCK_IN_RESTORE_HOST/)
assert.match(stockChanges, /!canAdjust \|\| !canRestoreMinimizedWork\(entry, app\.can\)/)
assert.match(stockChanges, /reparkDeniedRestore\(entry\)/)
assert.match(stockChanges, /FastStockInRestoreCommit onCommit=\{commitFastStockInRestore\}/)

const entry = {
  key: 'fast-stockin',
  kind: 'fast_stockin' as const,
  pageId: 'products',
  anchor: 'hub:products:stock_changes',
  label: 'Fast stock-in',
  requiredPermission: { permissionKey: 'inventory', actionKey: 'adjust' },
  minimizedAt: 1,
}
assert.equal(canRestoreMinimizedWork(entry, () => true), true)
assert.equal(canRestoreMinimizedWork(entry, () => false), false, 'revoked inventory adjustment must block restore')

console.log('PASS Fast Stock-In draft flush and restore permission contract')
