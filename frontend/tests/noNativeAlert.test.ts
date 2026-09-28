// A failure the operator must read is a translated notify() toast, not the
// browser's alert(): the native popup is off-brand, blocks the page, and its
// text is whatever string the call site built -- "Failed to analyze CSV: ..."
// in BulkImportModal reached a Khmer screen in English.
//
// RATCHET like tests/noNativeConfirm.test.ts: the files below still call
// alert() with already-translated text, with their exact counts. A new file,
// a count that grows, or a count that shrinks without lowering it here fails.
// Real TypeScript parse: comments do not count, and a file's own `alert`
// binding is not the browser's.
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

/** Calls to the browser's alert(): window.alert(...), globalThis.alert(...), or a bare alert(...) the file does not declare itself. */
function nativeAlertCalls(fileName: string, source: string): number {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  let declaresAlert = false
  let bare = 0
  let qualified = 0
  const visit = (node: ts.Node): void => {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node))
      && node.name && ts.isIdentifier(node.name) && node.name.text === 'alert') declaresAlert = true
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isIdentifier(callee) && callee.text === 'alert') bare += 1
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'alert'
        && ts.isIdentifier(callee.expression) && ['window', 'globalThis', 'self'].includes(callee.expression.text)) qualified += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return qualified + (declaresAlert ? 0 : bare)
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : []
  })
}

// Remaining native alert() calls by file (relative to frontend/src). Each
// already shows translated text; lower the number when you move one onto
// notify().
const REMAINING: Record<string, number> = {
  'components/products/forms/ProductForm.tsx': 6,
  'components/receipt-settings/PrintSettings.tsx': 2,
  'components/receipt/Receipt.tsx': 1,
  'components/sales/ExportModal.tsx': 2,
}

runTest('positive control: every native form is counted, comments and a local alert are not', () => {
  assert.equal(nativeAlertCalls('a.tsx', `alert('x'); window.alert('y'); globalThis.alert('z')`), 3)
  assert.equal(nativeAlertCalls('b.tsx', `// alert('x') used to be here\nconst ok = true`), 0)
  assert.equal(nativeAlertCalls('c.tsx', `const alert = (m: string) => m; alert('x')`), 0)
  assert.equal(nativeAlertCalls('d.tsx', `toast.alert('x'); api.alert()`), 0)
})

runTest('no new native alert() anywhere in frontend/src, and the remaining list only shrinks', () => {
  const found: Record<string, number> = {}
  for (const file of sourceFiles(srcRoot)) {
    const count = nativeAlertCalls(file, fs.readFileSync(file, 'utf8'))
    if (count) found[path.relative(srcRoot, file).split(path.sep).join('/')] = count
  }
  assert.deepEqual(found, REMAINING)
})

runTest('the product import reports a CSV it cannot read in the operator language', () => {
  const source = fs.readFileSync(path.join(srcRoot, 'components/products/import/BulkImportModal.tsx'), 'utf8')
  assert.doesNotMatch(source, /Failed to analyze CSV: \$\{/, 'the English-only template is gone')
  assert.match(source, /notify\(`\$\{T\('csv_analyze_failed', 'Failed to analyze CSV'\)\}: \$\{getErrorMessage\(error, T\('unknown_error', 'Unknown error'\)\)\}`, 'error'\)/)
  const en = JSON.parse(fs.readFileSync(path.join(srcRoot, 'lang', 'en.json'), 'utf8')) as Record<string, string>
  const km = JSON.parse(fs.readFileSync(path.join(srcRoot, 'lang', 'km.json'), 'utf8')) as Record<string, string>
  assert.equal(en.csv_analyze_failed, 'Failed to analyze CSV')
  assert.ok(km.csv_analyze_failed && /[ក-៿]/.test(km.csv_analyze_failed), 'km.json csv_analyze_failed is Khmer')
})

if (failed) { console.error(`\n${failed} native-alert guard test(s) failed`); process.exit(1) }
console.log('PASS noNativeAlert')
