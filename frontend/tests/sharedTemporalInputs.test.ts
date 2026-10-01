import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const nativeTypes = new Set(['date', 'time', 'datetime-local', 'month', 'week'])

function temporalInputs(source: string): number[] {
  const file = ts.createSourceFile('fixture.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: number[] = []
  const visit = (node: ts.Node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(file) === 'input') {
      let temporal = false
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue
        const key = attribute.name.getText(file)
        if (key !== 'type' && key !== 'placeholder') continue
        const inspect = (value: ts.Node) => {
          if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
            if (key === 'type' ? nativeTypes.has(value.text) : /dd\/mm\/yyyy|mm\/dd\/yyyy|hh:mm/i.test(value.text)) temporal = true
          }
          ts.forEachChild(value, inspect)
        }
        if (attribute.initializer) inspect(attribute.initializer)
      }
      if (temporal) found.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

for (const source of [
  '<input type="date" />',
  '<input\n type = {\n "time"\n } />',
  '<input type={kind ? "datetime-local" : "text"} />',
  '<input\n placeholder="HH:MM"\n />',
  '<input type={`month`} />',
]) assert.deepEqual(temporalInputs(source), [1], source)
assert.deepEqual(temporalInputs('// <input type="date" />\nconst a = <div>{/* <input type="time" /> */}<input type="text" /></div>'), [])
assert.deepEqual(temporalInputs('<input type="number" placeholder="Amount" />'), [])

const offenders: string[] = []
function walk(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) { walk(path); continue }
    if (!/\.(tsx?|jsx?)$/.test(entry.name)) continue
    const name = relative(root, path).replaceAll('\\', '/')
    if (name === 'components/shared/DateEntryInput.tsx') continue
    for (const line of temporalInputs(readFileSync(path, 'utf8'))) offenders.push(`${name}:${line}`)
  }
}
walk(root)
assert.deepEqual(offenders, [], `Temporal inputs must use the shared date/time entry: ${offenders.join(', ')}`)
const picker = readFileSync(resolve(root, 'components/shared/DateTimeRangePicker.tsx'), 'utf8')
assert.match(picker, /<TimeEntryInput/)
assert.match(picker, /fmtDateOnly/)
assert.match(picker, /STATS_PRESETS\.map/)
assert.match(picker, /flex-nowrap[^"\n]*overflow-x-auto/)
const entry = readFileSync(resolve(root, 'components/shared/DateEntryInput.tsx'), 'utf8')
assert.match(entry, /data-temporal-input-label/)
const reportCss = readFileSync(resolve(root, 'components/sales/reports/reports-surface.css'), 'utf8')
assert.match(reportCss, /\.reports-mobile-range\s*\{[^}]*display:\s*flex/)
assert.doesNotMatch(reportCss, /\.reports-mobile-range \[data-date-range-trigger-values\]/)
console.log('PASS AST temporal source guard, shared time entry, app formatter and scrolling preset contract')
