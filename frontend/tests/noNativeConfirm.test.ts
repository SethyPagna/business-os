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
//
// FX-ui (27 Sep 2026) replaced every admin-side call with the shared dialog.
// The one left is deliberate: CatalogAccountSection is the CUSTOMER storefront
// (its own multi-language portal packs via getPortalLanguageText, not en/km), its
// question is an informational sign-up reminder rather than an admin
// mutation, and ConfirmDialog/Modal are admin chrome. Moving it needs a
// storefront-styled dialog, which belongs to the public-website lane.
const REMAINING: Record<string, number> = {
  'components/catalog/CatalogAccountSection.tsx': 1,
}

runTest('positive control: every native form is counted, comments and a local confirm are not', () => {
  assert.equal(nativeConfirmCalls('a.tsx', `if (!window.confirm('x')) return; if (!confirm('y')) return; globalThis.confirm('z')`), 3)
  assert.equal(nativeConfirmCalls('b.tsx', `// window.confirm('x') used to be here\nconst ok = true`), 0)
  assert.equal(nativeConfirmCalls('c.tsx', `const confirm = async () => {}; void confirm()`), 0)
  assert.equal(nativeConfirmCalls('d.tsx', `dialog.confirm(); api.confirm('x')`), 0)
})

runTest('the stock record and user account surfaces use the shared review dialog, not confirm()', () => {
  for (const rel of ['components/products/StockChangeSection.tsx', 'components/products/StockInSessionsSection.tsx', 'components/users/UserProfileModal.tsx', 'components/users/Users.tsx']) {
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

// The replacements go through useConfirmDialog, whose askToConfirm() returns a
// promise so `if (!(await askToConfirm({...}))) return` keeps the native call's
// control flow. Three ways a replacement can look right and still be wrong
// (pinned in U-confirm, absorbed by FX-ui), each with its own control:
//   1. an ask that is not awaited, chained or handed back -- a Promise is
//      always truthy, so `if (!askToConfirm(...)) return` never cancels;
//   2. a host that asks but never renders {confirmDialog} -- the promise never
//      settles and the action silently hangs;
//   3. {confirmDialog} inside a backdrop whose onClick closes the host --
//      React bubbles the dialog's clicks through the component tree, so
//      pressing Confirm or Cancel also closes the surface underneath.
//      tests/overlayNestedFloatBubbling.test.ts pins the same rule for
//      <XxxDialog> tags; a {confirmDialog} expression is invisible to it.

function parseTsx(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

/** askToConfirm(...) calls whose answer is dropped: not awaited, not .then-chained, not returned to a caller. */
function unawaitedAsks(fileName: string, source: string): number[] {
  const file = parseTsx(fileName, source)
  const lines: number[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'askToConfirm') {
      let outer: ts.Node = node
      while (ts.isParenthesizedExpression(outer.parent)) outer = outer.parent
      const parent = outer.parent
      const used = ts.isAwaitExpression(parent)
        || (ts.isPropertyAccessExpression(parent) && parent.name.text === 'then')
        || (ts.isArrowFunction(parent) && parent.body === outer)
        || ts.isReturnStatement(parent)
      if (!used) lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return lines
}

function jsxAttribute(element: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return element.attributes.properties.find(
    (property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText() === name,
  )
}

/** {confirmDialog} expressions reachable from a closing backdrop without crossing a click-stopper. */
function confirmDialogInsideClosingBackdrop(fileName: string, source: string): number {
  const file = parseTsx(fileName, source)
  let hits = 0
  const collect = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && /stopPropagation/.test(jsxAttribute(node.openingElement, 'onClick')?.getText(file) || '')) return
    if (ts.isJsxExpression(node) && node.expression && ts.isIdentifier(node.expression) && node.expression.text === 'confirmDialog') hits += 1
    ts.forEachChild(node, collect)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && /fixed inset-0/.test(jsxAttribute(node.openingElement, 'className')?.getText(file) || '') && jsxAttribute(node.openingElement, 'onClick')) {
      node.children.forEach(collect)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return hits
}

runTest('positive controls: a dropped ask and a dialog inside a closing backdrop are caught', () => {
  assert.deepEqual(unawaitedAsks('a.tsx', `if (!askToConfirm({ title: 'x' })) return\nvoid askToConfirm({ title: 'y' })`), [1, 2])
  assert.deepEqual(unawaitedAsks('b.tsx', [
    `if (!(await askToConfirm({ title: 'x' }))) return`,
    `void askToConfirm({ title: 'y' }).then((ok) => ok)`,
    `const ask = (m: string) => askToConfirm({ title: m })`,
    `function f() { return askToConfirm({ title: 'z' }) }`,
  ].join('\n')), [])
  assert.equal(confirmDialogInsideClosingBackdrop('a.tsx', `const A = () => (<div className="fixed inset-0" onClick={close}><div onClick={(e) => e.stopPropagation()}>x</div>{confirmDialog}</div>)`), 1)
  assert.equal(confirmDialogInsideClosingBackdrop('b.tsx', `const B = () => (<><div className="fixed inset-0" onClick={close}><div onClick={(e) => e.stopPropagation()}>{confirmDialog}</div></div>{confirmDialog}</>)`), 0)
})

runTest('every useConfirmDialog host uses the answer, renders the dialog, and keeps it outside closing backdrops', () => {
  const hosts = sourceFiles(srcRoot).filter((file) => !file.endsWith('useConfirmDialog.tsx') && /\buseConfirmDialog\(/.test(fs.readFileSync(file, 'utf8')))
  assert.ok(hosts.length >= 25, `expected the replaced surfaces to use the hook, found ${hosts.length}`)
  const problems: string[] = []
  for (const file of hosts) {
    const rel = path.relative(srcRoot, file).split(path.sep).join('/')
    const source = fs.readFileSync(file, 'utf8')
    const dropped = unawaitedAsks(rel, source)
    if (dropped.length) problems.push(`${rel}: askToConfirm() answer not used at line ${dropped.join(', ')}`)
    if (!/\{confirmDialog\}/.test(source)) problems.push(`${rel}: asks but never renders {confirmDialog}`)
    if (confirmDialogInsideClosingBackdrop(rel, source)) problems.push(`${rel}: {confirmDialog} sits inside a backdrop that closes on click`)
  }
  assert.deepEqual(problems, [])
})

// Seven hosts call useConfirmDialog() with no translator (Inventory, stock
// movements, Manage Received Dates, the server queue, three Backup sections).
// The dialog's own words -- Cancel, Confirm, "Are you sure?", Saving... -- then
// fell back to English on a Khmer screen (Manage Received Dates' save review
// passes no cancelLabel). The hook resolves the app's translator itself when
// the host passes none.
runTest('a host that passes no translator still gets a translated dialog', () => {
  const hook = fs.readFileSync(path.join(srcRoot, 'components/shared/useConfirmDialog.tsx'), 'utf8')
  assert.match(hook, /import \{ useApp\b[^}]*\} from '\.\.\/\.\.\/app\/AppContextCore(\.tsx)?'/, 'the hook reads the app translator')
  assert.match(hook, /const translate = t \?\? /, "the host's t wins, the app's t is the fallback")
  assert.match(hook, /<ConfirmDialog[\s\S]*?\bt=\{translate\}/, 'the dialog receives the resolved translator')
  assert.doesNotMatch(hook, /\bt=\{t\}/, 'the raw, possibly undefined, host t never reaches the dialog')
})

if (failed) { console.error(`\n${failed} native-confirm guard test(s) failed`); process.exit(1) }
console.log('PASS noNativeConfirm')
