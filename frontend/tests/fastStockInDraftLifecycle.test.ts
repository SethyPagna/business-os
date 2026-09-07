import assert from 'node:assert/strict'
import fs from 'node:fs'

import { canRestoreMinimizedWork } from '../src/utils/minimizedWork.ts'

const modal = fs.readFileSync(new URL('../src/components/inventory/FastStockInModal.tsx', import.meta.url), 'utf8')
const inventory = fs.readFileSync(new URL('../src/components/inventory/Inventory.tsx', import.meta.url), 'utf8')

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

assert.match(inventory, /draftKey: scopedWorkDraftKey\('fast_stockin'\)/)
assert.match(inventory, /requiredPermission: \{ permissionKey: 'inventory', actionKey: 'adjust' \}/)
assert.match(inventory, /!can\('inventory', 'adjust'\)/)
assert.match(inventory, /canRestoreMinimizedWork\(entry, can\)/)
assert.match(inventory, /reparkDeniedRestore\(entry\)/)

const entry = {
  key: 'fast-stockin',
  kind: 'fast_stockin' as const,
  pageId: 'branches',
  label: 'Fast stock-in',
  requiredPermission: { permissionKey: 'inventory', actionKey: 'adjust' },
  minimizedAt: 1,
}
assert.equal(canRestoreMinimizedWork(entry, () => true), true)
assert.equal(canRestoreMinimizedWork(entry, () => false), false, 'revoked inventory adjustment must block restore')

console.log('PASS Fast Stock-In draft flush and restore permission contract')
