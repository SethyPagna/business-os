import assert from 'node:assert/strict'
import fs from 'node:fs'

import { canRestoreMinimizedWork } from '../src/utils/minimizedWork.ts'

// The Stock Session (FastStockInModal, rewritten by UI-STOCK-2): X asks through
// the shared guard, the minus preserves, Discard clears, and the draft keeps
// the protected receipt values. Repointed by UI-STOCK-3 from the old modal's
// shape; the retired pins are listed in the UI-STOCK-3 lane report.
const read = (rel: string): string => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const modal = read('../src/components/inventory/FastStockInModal.tsx')
const header = read('../src/components/stock-session/StockSessionHeader.tsx')
const inventory = read('../src/components/inventory/Inventory.tsx')
const stockChanges = read('../src/components/products/StockChangeSection.tsx')

assert.match(modal, /import \{[^}]*flushPendingWorkDraft[^}]*\} from '\.\.\/\.\.\/utils\/workDrafts\.ts'/)

assert.match(modal, /import UnsavedChangesPrompt from '\.\.\/shared\/UnsavedChangesPrompt\.tsx'/)
assert.match(modal, /const closeGuard = useCloseGuard\(\{ dirty: closeDirty \}, discardAndClose, onMinimize \? preserveAndMinimize : undefined\)/, 'dirty X must use the shared Discard / Back / Minimize guard')
// The header X requests close; the minus preserves. Wired in the float, rendered by the header.
assert.match(modal, /<StockSessionHeader[\s\S]*?onMinimize=\{onMinimize \? preserveAndMinimize : undefined\}[\s\S]*?onClose=\{requestCloseIfIdle\}/, 'the header X must request close, not minimize')
assert.match(header, /<button\s+type="button"\s+onClick=\{onClose\}[\s\S]*?aria-label=\{tr\('close', 'Close'\)\}/)
assert.match(header, /<MinimizeButton [^\n]*onMinimize=\{onMinimize\} \/>/, 'the minus calls the direct preserve path')
assert.doesNotMatch(modal, /onClose=\{preserveAndMinimize\}/, 'the header X must never call the preserve path')

const minimizeStart = modal.indexOf('  const preserveAndMinimize = () => {')
const minimizeEnd = modal.indexOf('  const discardAndClose', minimizeStart)
assert.ok(minimizeStart >= 0 && minimizeEnd > minimizeStart)
const minimizeBody = modal.slice(minimizeStart, minimizeEnd)
assert.ok(minimizeBody.indexOf('flushPendingWorkDraft(fastStockInDraftKey)') >= 0, 'minimize flushes the draft')
assert.ok(minimizeBody.indexOf('flushPendingWorkDraft(fastStockInDraftKey)') < minimizeBody.indexOf('onMinimize(sessionLabel)'), 'minimize must flush before parking the chip')
assert.ok(minimizeBody.indexOf('onMinimize(sessionLabel)') < minimizeBody.indexOf('onClose()'), 'chip must be parked before the modal unmounts')

const discardStart = modal.indexOf('  const discardAndClose = () => {')
const discardEnd = modal.indexOf('  const closeGuard', discardStart)
const discardBody = modal.slice(discardStart, discardEnd)
assert.ok(discardBody.indexOf('clearWorkDraft(fastStockInDraftKey)') >= 0 && discardBody.indexOf('clearWorkDraft(fastStockInDraftKey)') < discardBody.indexOf('onClose()'), 'Discard clears the exact draft before unmount')
assert.doesNotMatch(discardBody, /onMinimize/, 'Discard must not park a minimized chip')

// The receipt cost restores into protected state and displays only through
// the permission-scoped entry; both draft writers go through ONE builder that
// stores the protected value, never the blank revoked display.
assert.match(modal, /const \[protectedUnitCost, setProtectedUnitCost\] = useState\(init\.draft\.unitCost\)/, 'receipt cost restores into protected draft state')
assert.match(modal, /const unitCost = String\(costEntry\.value\('unitCost', protectedUnitCost, ''\)\)/, 'restored cost displays only through the permission-scoped entry')
assert.match(modal, /const currentDraft = \(lines: StockSessionLine\[\] = received\): StockSessionDraft & \{ receivingSubmissions\?: ReceivingSubmissions \} => \(\{[\s\S]*?unitCost: protectedUnitCost,[\s\S]*?batchChoice,[\s\S]*?createdProductIds, lines,/)
assert.match(modal, /receivingSubmissions: retainReceivingSubmissions\(submissionsRef\.current, lines\)/, 'the saved draft retains exact submitted wires alongside protected values')
assert.match(modal, /const submissions = restoreReceivingSubmissions\(storedRaw, opened\.lines\)/, 'reload recovers submission facts alongside the unchanged core normalizer')
assert.match(modal, /useEffect\(\(\) => scheduleWorkDraftWrite<StockSessionDraft>\(fastStockInDraftKey, currentDraft\(\)\)/, 'the debounced autosave snapshots the live queue')
assert.match(modal, /const persistSessionDraft = \(lines: StockSessionLine\[\] = received\) => \{\s*writeWorkDraft<StockSessionDraft>\(fastStockInDraftKey, currentDraft\(lines\)\)/, 'the synchronous writer defaults to the live queue')
assert.match(modal, /const pendingBatchRestoreRef = useRef<LotChoice \| null>\(init\.draft\.picked \? init\.draft\.batchChoice : null\)/, 'a parked lot choice must be revalidated by the options effect')

// A product created inside the session: ProductForm owns its own close.
const holdStart = modal.indexOf('  const holdNewProduct = async')
const holdEnd = modal.indexOf('  const createHeldProduct', holdStart)
assert.ok(holdStart >= 0 && holdEnd > holdStart)
assert.doesNotMatch(modal.slice(holdStart, holdEnd), /setCreateForm\(null\)/, 'a held product must return to ProductForm before ProductForm clears and closes')
assert.match(modal, /onClose=\{\(\) => setCreateForm\(null\)\}/, 'ProductForm owns the child close after its successful clean latch')

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

console.log('PASS Stock Session draft flush and restore permission contract')
