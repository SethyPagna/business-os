import assert from 'node:assert/strict'
import fs from 'node:fs'

import { canRestoreMinimizedWork } from '../src/utils/minimizedWork.ts'

const modal = fs.readFileSync(new URL('../src/components/inventory/FastStockInModal.tsx', import.meta.url), 'utf8')
const inventory = fs.readFileSync(new URL('../src/components/inventory/Inventory.tsx', import.meta.url), 'utf8')
const stockChanges = fs.readFileSync(new URL('../src/components/products/StockChangeSection.tsx', import.meta.url), 'utf8')

assert.match(modal, /import \{[^}]*flushPendingWorkDraft[^}]*\} from '\.\.\/\.\.\/utils\/workDrafts\.ts'/)

const closeStart = modal.indexOf('  const closeIfIdle = () => {')
const closeEnd = modal.indexOf('  const closeBackdropIfIdle', closeStart)
assert.ok(closeStart >= 0 && closeEnd > closeStart)
const closeBody = modal.slice(closeStart, closeEnd)
assert.ok(closeBody.indexOf('flushPendingWorkDraft(fastStockInDraftKey)') < closeBody.indexOf('onClose()'), 'close must flush the exact draft before unmount')

const minimizeStart = modal.indexOf('onMinimize={() => {')
const minimizeEnd = modal.indexOf('}}', minimizeStart)
assert.ok(minimizeStart >= 0 && minimizeEnd > minimizeStart)
const minimizeBody = modal.slice(minimizeStart, minimizeEnd)
assert.ok(minimizeBody.indexOf('flushPendingWorkDraft(fastStockInDraftKey)') < minimizeBody.indexOf("onMinimize(tr('fast_stockin_title'"), 'minimize must flush before parking the chip')
assert.ok(minimizeBody.indexOf("onMinimize(tr('fast_stockin_title'") < minimizeBody.indexOf('onClose()'), 'chip must be parked before the modal unmounts')

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
