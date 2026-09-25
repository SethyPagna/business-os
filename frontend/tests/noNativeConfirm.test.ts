// Owner rule: a mutating action is confirmed through the ONE shared compact
// review dialog (components/shared/ConfirmDialog.tsx) -- never the browser's
// native confirm(), which is off-brand, cannot be translated, and cannot show
// the values before and after the change.
//
// U-records moved the stock record surfaces (Stock Changes, Stock-in
// Sessions) onto ConfirmDialog. Native calls still exist elsewhere in
// frontend/src, in surfaces other lanes own; they are listed below with their
// exact counts as a RATCHET:
//   - a file not on the list that calls confirm() fails;
//   - a listed file whose count GROWS fails;
//   - a listed file whose count SHRINKS also fails, so whoever removes a call
//     lowers the number here and the list can only get shorter.
// Real TypeScript parse: comments do not count, and a file's OWN function
// named `confirm` (ServerImportReviewScreen's approve step) is not the
// browser's.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.join(here, '..', 'src')

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

/** Calls to the browser's confirm(): window.confirm(...), globalThis.confirm(...), or a bare confirm(...) the file does not declare itself. */
function nativeConfirmCalls(fileName: string, source: string): number {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  let declaresConfirm = false
  let bare = 0
  let qualified = 0
  const visit = (node: ts.Node): void => {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node))
      && node.name && ts.isIdentifier(node.name) && node.name.text === 'confirm') declaresConfirm = true
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isIdentifier(callee) && callee.text === 'confirm') bare += 1
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'confirm'
        && ts.isIdentifier(callee.expression) && ['window', 'globalThis', 'self'].includes(callee.expression.text)) qualified += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return qualified + (declaresConfirm ? 0 : bare)
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : []
  })
}

// Native confirm() calls that remain, by file (relative to frontend/src).
// Lower a number -- or delete the line -- when you replace one.
const REMAINING: Record<string, number> = {
  'components/branches/TransferModal.tsx': 1,
  'components/catalog/CatalogAccountSection.tsx': 1,
  'components/contacts/CustomersTab.tsx': 2,
  'components/contacts/DeliveryTab.tsx': 2,
  'components/contacts/SuppliersTab.tsx': 2,
  'components/fees/ExpenseLabelManagerModal.tsx': 2,
  'components/fees/FeeForm.tsx': 1,
  'components/fees/FeesPage.tsx': 1,
  'components/files/FilePickerModal.tsx': 1,
  'components/files/FilesPage.tsx': 1,
  'components/inventory/Inventory.tsx': 3,
  'components/inventory/InventoryMovementsSurface.tsx': 1,
  'components/inventory/ManageBatchesModal.tsx': 2,
  'components/products/DeleteConfirmModal.tsx': 1,
  'components/products/Products.tsx': 5,
  'components/products/forms/BulkAddStockModal.tsx': 1,
  'components/products/forms/StockAdjustModal.tsx': 1,
  'components/products/import/BulkImportModal.tsx': 4,
  'components/products/lookups/ManageBrandsModal.tsx': 3,
  'components/products/lookups/ManageCategoriesModal.tsx': 2,
  'components/products/lookups/ManageUnitsModal.tsx': 2,
  'components/promotions/PromotionsPage.tsx': 1,
  'components/returns/EditReturnModal.tsx': 1,
  'components/returns/ReturnReasonManagerModal.tsx': 2,
  'components/returns/Returns.tsx': 2,
  'components/sales/Sales.tsx': 5,
  'components/server/ServerPage.tsx': 1,
  'components/shared/BackgroundImportTracker.tsx': 1,
  'components/users/DeviceApprovals.tsx': 1,
  'components/users/UserProfileModal.tsx': 1,
  'components/users/Users.tsx': 2,
  'components/utils-settings/Backup.tsx': 4,
  'components/utils-settings/Settings.tsx': 2,
}

runTest('positive control: every native form is counted, comments and a local confirm are not', () => {
  assert.equal(nativeConfirmCalls('a.tsx', `if (!window.confirm('x')) return; if (!confirm('y')) return; globalThis.confirm('z')`), 3)
  assert.equal(nativeConfirmCalls('b.tsx', `// window.confirm('x') used to be here\nconst ok = true`), 0)
  assert.equal(nativeConfirmCalls('c.tsx', `const confirm = async () => {}; void confirm()`), 0)
  assert.equal(nativeConfirmCalls('d.tsx', `dialog.confirm(); api.confirm('x')`), 0)
})

runTest('the stock record surfaces use the shared review dialog, not confirm()', () => {
  for (const rel of ['components/products/StockChangeSection.tsx', 'components/products/StockInSessionsSection.tsx']) {
    const source = fs.readFileSync(path.join(srcRoot, rel), 'utf8')
    assert.equal(nativeConfirmCalls(rel, source), 0, `${rel} calls native confirm()`)
    assert.match(source, /<ConfirmDialog\b/, `${rel} renders the shared ConfirmDialog`)
    assert.equal(REMAINING[rel], undefined, `${rel} must not be on the remaining list`)
  }
})

runTest('no new native confirm() anywhere in frontend/src, and the remaining list only shrinks', () => {
  const found: Record<string, number> = {}
  for (const file of sourceFiles(srcRoot)) {
    const count = nativeConfirmCalls(file, fs.readFileSync(file, 'utf8'))
    if (count) found[path.relative(srcRoot, file).split(path.sep).join('/')] = count
  }
  assert.deepEqual(found, REMAINING)
})

if (failed) { console.error(`\n${failed} native-confirm guard test(s) failed`); process.exit(1) }
console.log('PASS noNativeConfirm')
