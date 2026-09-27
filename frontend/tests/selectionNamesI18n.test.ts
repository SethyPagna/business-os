// Owner rule: both language packs, every time -- including the names a screen
// reader speaks. Every list's row, group and select-all checkboxes used to be
// named in hard-coded English ("Select all sales", `Select ${receipt}`,
// `Select ${customer.name}` in an sr-only label) even on a Khmer screen, while
// AuditLog and contacts/shared.tsx had already moved their select-all onto the
// select_all key. FX-ui (27 Sep 2026) moved every one of them onto the packs:
// select-all reads t('select_all'), a row or group reads `${t('select')} ${name}`.
//
// Real TypeScript parse: an English "Select ..." literal is reported when it
// is an aria-label value (plain string or template) or a {...} child of a JSX
// element (the sr-only <label> form). Translated forms and comments are not.
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

const ENGLISH_SELECT = /^Select\b/

/** The leading literal text of a string, no-substitution template or template expression; null for anything else. */
function leadingText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isTemplateExpression(node)) return node.head.text
  return null
}

/** Hard-coded English selection names in one source file, as "line: text". */
function englishSelectionNames(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const hits: string[] = []
  const report = (node: ts.Node, text: string): void => {
    hits.push(`${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: ${text}`)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && node.name.getText(file) === 'aria-label' && node.initializer) {
      const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer
      const text = value ? leadingText(value) : null
      if (text !== null && ENGLISH_SELECT.test(text)) report(node, text)
    }
    if (ts.isJsxExpression(node) && node.expression && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      const text = leadingText(node.expression)
      if (text !== null && ENGLISH_SELECT.test(text)) report(node, text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return hits
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.tsx$/.test(entry.name) ? [full] : []
  })
}

runTest('positive control: each English form is reported, translated forms and comments are not', () => {
  const bad = [
    '<input aria-label="Select all sales" />',
    '<input aria-label={"Select all returns"} />',
    '<input aria-label={`Select ${sale.receipt_number}`} />',
    '<label className="sr-only">{`Select ${customer.name}`}</label>',
    '<span>{\'Select all\'}</span>',
  ]
  for (const sample of bad) assert.equal(englishSelectionNames('bad.tsx', `const x = ${sample}`).length, 1, sample)
  const good = [
    "<input aria-label={t('select_all')} />",
    "<input aria-label={`${t('select')} ${sale.receipt_number}`} />",
    "<label className=\"sr-only\">{`${t('select')} ${customer.name}`}</label>",
    '<input aria-label={`Selected ${n}`} />',
    '// <input aria-label="Select all sales" />\nconst y = 1',
  ]
  for (const sample of good) assert.equal(englishSelectionNames('good.tsx', `const x = ${sample}`).length, 0, sample)
})

runTest('no list in frontend/src names a selection checkbox in hard-coded English', () => {
  const found: Record<string, string[]> = {}
  for (const file of sourceFiles(srcRoot)) {
    const hits = englishSelectionNames(file, fs.readFileSync(file, 'utf8'))
    if (hits.length) found[path.relative(srcRoot, file).split(path.sep).join('/')] = hits
  }
  assert.deepEqual(found, {})
})

runTest('both packs carry the keys the selection names read, with a real Khmer value', () => {
  const en = JSON.parse(fs.readFileSync(path.join(srcRoot, 'lang', 'en.json'), 'utf8')) as Record<string, unknown>
  const km = JSON.parse(fs.readFileSync(path.join(srcRoot, 'lang', 'km.json'), 'utf8')) as Record<string, unknown>
  for (const key of ['select', 'select_all', 'movement', 'row_label']) {
    assert.ok(typeof en[key] === 'string' && en[key], `en.json missing "${key}"`)
    assert.ok(typeof km[key] === 'string' && km[key], `km.json missing "${key}"`)
    assert.notEqual(km[key], en[key], `km.json "${key}" is an English placeholder`)
  }
})

if (failed) { console.error(`\n${failed} selection-name i18n test(s) failed`); process.exit(1) }
console.log('PASS selectionNamesI18n')
