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
  // Owned by lanes editing these files concurrently with U-confirm; each
  // lowers its own count when it moves onto the shared dialog.
  'components/branches/TransferModal.tsx': 1,
  'components/inventory/Inventory.tsx': 3,
  'components/inventory/ManageBatchesModal.tsx': 2,
  'components/utils-settings/Settings.tsx': 2,
  // Customer-facing storefront (rendered only by PublicCatalogPage): the
  // admin dialog does not follow the storefront's 17-language copy, so the
  // public-catalog lane decides this one.
  'components/catalog/CatalogAccountSection.tsx': 1,
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

// U-confirm: the replacements go through useConfirmDialog (promise-shaped, so
// `if (!(await askConfirm({...}))) return` keeps the native call's control
// flow). Three ways a replacement can look right and still be wrong, each
// pinned below with its own control:
//   1. askConfirm() used without await/then -- a Promise is always truthy, so
//      `if (!askConfirm(...)) return` would never cancel anything;
//   2. a file asks but never renders {confirmDialog} -- the promise never
//      settles and the action silently hangs;
//   3. {confirmDialog} rendered inside a backdrop whose onClick closes the
//      host -- React bubbles the dialog's clicks through the component tree,
//      so pressing Confirm would also close the surface underneath
//      (tests/overlayNestedFloatBubbling.test.ts pins the same rule for
//      <XxxDialog> tags; a {confirmDialog} expression is invisible to it).

/** askConfirm( calls whose promise is not awaited, voided, returned by an arrow, or chained. */
function unawaitedAskConfirm(source: string): number {
  let bad = 0
  for (const match of source.matchAll(/askConfirm\(/g)) {
    const before = source.slice(Math.max(0, match.index - 12), match.index)
    const after = source.slice(match.index)
    if (/(?:await|void|=>)\s*\(?\s*$/.test(before)) continue
    if (/^askConfirm\(\{[\s\S]*?\}\)\.then\(/.test(after.slice(0, 2000))) continue
    if (/const \{ askConfirm/.test(source.slice(Math.max(0, match.index - 20), match.index + 12))) continue
    bad += 1
  }
  return bad
}

/** {confirmDialog} expressions reachable from a closing backdrop without crossing a click-stopper. */
function confirmDialogInsideClosingBackdrop(fileName: string, source: string): number {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const attr = (element: ts.JsxOpeningLikeElement, name: string) => element.attributes.properties.find(
    (property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText() === name,
  )
  let hits = 0
  const collect = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && /stopPropagation/.test(attr(node.openingElement, 'onClick')?.getText() || '')) return
    if (ts.isJsxExpression(node) && node.expression && ts.isIdentifier(node.expression) && node.expression.text === 'confirmDialog') hits += 1
    ts.forEachChild(node, collect)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && /fixed inset-0/.test(attr(node.openingElement, 'className')?.getText() || '') && attr(node.openingElement, 'onClick')) {
      node.children.forEach(collect)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return hits
}

runTest('positive controls: an un-awaited ask and a dialog inside a closing backdrop are caught', () => {
  assert.equal(unawaitedAskConfirm(`const { askConfirm, confirmDialog } = useConfirmDialog()\nif (!askConfirm({ message: 'x' })) return`), 1)
  assert.equal(unawaitedAskConfirm(`const { askConfirm, confirmDialog } = useConfirmDialog()\nif (!(await askConfirm({ message: 'x' }))) return\nvoid askConfirm({ message: 'y' }).then((ok) => ok)\nconst f = () => askConfirm({ message: 'z' })`), 0)
  assert.equal(confirmDialogInsideClosingBackdrop('a.tsx', `const A = () => (<div className="fixed inset-0" onClick={close}><div>{confirmDialog}</div></div>)`), 1)
  assert.equal(confirmDialogInsideClosingBackdrop('b.tsx', `const B = () => (<>{confirmDialog}<div className="fixed inset-0" onClick={close}><div onClick={(e) => e.stopPropagation()}>x</div></div></>)`), 0)
})

runTest('every useConfirmDialog host awaits its asks, renders the dialog, and keeps it outside closing backdrops', () => {
  const hosts = sourceFiles(srcRoot).filter((file) => /useConfirmDialog\(\)/.test(fs.readFileSync(file, 'utf8')) && !file.endsWith('useConfirmDialog.tsx'))
  assert.ok(hosts.length >= 25, `expected the replaced surfaces to use the hook, found ${hosts.length}`)
  for (const file of hosts) {
    const rel = path.relative(srcRoot, file).split(path.sep).join('/')
    const source = fs.readFileSync(file, 'utf8')
    assert.equal(unawaitedAskConfirm(source), 0, `${rel} uses askConfirm() without awaiting its answer`)
    assert.match(source, /\{confirmDialog\}/, `${rel} asks but never renders {confirmDialog}`)
    assert.equal(confirmDialogInsideClosingBackdrop(rel, source), 0, `${rel} renders {confirmDialog} inside a closing backdrop`)
  }
})

runTest('the hook keeps native confirm() semantics: Enter confirms, Escape and every dismissal cancel', () => {
  const hook = fs.readFileSync(path.join(srcRoot, 'components/shared/useConfirmDialog.tsx'), 'utf8')
  const dialog = fs.readFileSync(path.join(srcRoot, 'components/shared/ConfirmDialog.tsx'), 'utf8')
  assert.match(hook, /<ConfirmDialog[\s\S]*?\bkeyboard\b[\s\S]*?onConfirm=\{\(\) => settle\(true\)\}[\s\S]*?onClose=\{\(\) => settle\(false\)\}/, 'Confirm resolves true; Cancel/X/Escape resolve false')
  assert.match(hook, /resolveRef\.current\?\.\(false\)\s*\n\s*resolveRef\.current = resolve/, 'a superseded ask resolves false, never hangs')
  assert.match(hook, /useEffect\(\(\) => \(\) => \{\s*resolveRef\.current\?\.\(false\)/, 'unmounting the host resolves false')
  assert.match(dialog, /autoFocus=\{keyboard\}/, 'Confirm takes focus so Enter answers yes')
  assert.match(dialog, /event\.key !== 'Escape'[\s\S]*?escapeCloseRef\.current\(\)/, 'Escape answers no')
  assert.match(dialog, /escapeCloseRef\.current = working \? \(\) => \{\} : onClose/, 'Escape cannot cancel a running action')
})

if (failed) { console.error(`\n${failed} native-confirm guard test(s) failed`); process.exit(1) }
console.log('PASS noNativeConfirm')
