import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const nativeTypes = new Set(['date', 'time', 'datetime-local', 'month', 'week'])

function temporalInputs(source: string): number[] {
  const file = ts.createSourceFile('fixture.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const options = { noLib: true, noResolve: true, jsx: ts.JsxEmit.Preserve }
  const host = ts.createCompilerHost(options)
  host.getSourceFile = (name) => name === file.fileName ? file : undefined
  const checker = ts.createProgram([file.fileName], options, host).getTypeChecker()
  const initializer = (node: ts.Node): ts.Expression | undefined => {
    const symbol = ts.isShorthandPropertyAssignment(node)
      ? checker.getShorthandAssignmentValueSymbol(node)
      : checker.getSymbolAtLocation(node)
    const declaration = symbol?.valueDeclaration
    return declaration && (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)
      || ts.isParameter(declaration)) ? declaration.initializer : undefined
  }
  const found: number[] = []
  const visit = (node: ts.Node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(file) === 'input') {
      let temporal = false
      for (const attribute of node.attributes.properties) {
        const inspect = (key: string, value: ts.Node, seen = new Set<ts.Node>()) => {
          if (seen.has(value)) return
          seen.add(value)
          if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
            if (key === 'type' ? nativeTypes.has(value.text.toLowerCase()) : /dd\/mm\/yyyy|mm\/dd\/yyyy|hh:mm/i.test(value.text)) temporal = true
          }
          if (ts.isIdentifier(value) || ts.isPropertyAccessExpression(value) || ts.isShorthandPropertyAssignment(value)) {
            const resolved = initializer(value)
            if (resolved) { inspect(key, resolved, seen); return }
          }
          ts.forEachChild(value, (child) => inspect(key, child, seen))
        }
        const inspectSpread = (value: ts.Node, seen = new Set<ts.Node>()) => {
          if (seen.has(value)) return
          seen.add(value)
          const resolved = initializer(value)
          if (resolved) inspectSpread(resolved, seen)
          if (ts.isObjectLiteralExpression(value)) {
            for (const property of value.properties) {
              if (ts.isSpreadAssignment(property)) { inspectSpread(property.expression, seen); continue }
              const key = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
                ? property.name.text : ''
              if (key === 'type' || key === 'placeholder') {
                if (ts.isPropertyAssignment(property)) inspect(key, property.initializer)
                else if (ts.isShorthandPropertyAssignment(property)) inspect(key, property)
              }
            }
          } else if (!resolved) ts.forEachChild(value, (child) => inspectSpread(child, seen))
        }
        if (ts.isJsxSpreadAttribute(attribute)) { inspectSpread(attribute.expression); continue }
        const key = attribute.name.getText(file)
        if ((key === 'type' || key === 'placeholder') && attribute.initializer) inspect(key, attribute.initializer)
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
  '<input type="TIME" />',
  'const clockType = "time"; const x = <input type={clockType} />',
  'const props = { type: "date" }; const x = <input {...props} />',
  'const props = { placeholder: "HH:MM" }; const more = { ...props }; const x = <input {...more} />',
  'const types = { clock: "time" }; const x = <input type={types.clock} />',
]) assert.deepEqual(temporalInputs(source), [1], source)
assert.deepEqual(temporalInputs('// <input type="date" />\nconst a = <div>{/* <input type="time" /> */}<input type="text" /></div>'), [])
assert.deepEqual(temporalInputs('<input type="number" placeholder="Amount" />'), [])
assert.deepEqual(temporalInputs('const type="date"; function Field(){const type="text"; return <input type={type} />}'), [])
assert.deepEqual(temporalInputs('const props={type:"number",placeholder:"Amount"}; const x=<input {...props} />'), [])
assert.deepEqual(temporalInputs('const props={clock:"text",unused:"date"}; const x=<input type={props.clock} />'), [])

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
