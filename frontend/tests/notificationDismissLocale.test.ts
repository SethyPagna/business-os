import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript') as typeof import('typescript')
const React = require('react') as typeof import('react')
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
const parsed = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const component = parsed.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'Notification')
assert.ok(component && ts.isFunctionDeclaration(component))
const compiled = ts.transpileModule(component.getText(parsed), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText
const packs = Object.fromEntries(['en', 'km'].map(language => [language, JSON.parse(fs.readFileSync(path.join(root, 'src/lang', language + '.json'), 'utf8'))])) as Record<string, Record<string, string>>
type ToastProps = { notification: { type: string; message: string } | null; onDismiss?: () => void }
type ToastNode = import('react').ReactElement<{ children: import('react').ReactNode }> | null
let language = 'en'
let portalCalls = 0
const translate = (key: string) => packs[language][key] ?? key
function load(browser: boolean): (props: ToastProps) => ToastNode {
  return new Function('React', 'useApp', 'getNotificationColor', 'getNotificationPrefix', 'createPortal', 'document', compiled + '\nreturn Notification')(
    React,
    () => ({ t: translate }),
    () => 'bg-red-700',
    () => '! ',
    (node: ToastNode) => { portalCalls++; return node },
    browser ? { body: {} } : undefined,
  ) as (props: ToastProps) => ToastNode
}
for (const browser of [false, true]) {
  const Notification = load(browser)
  for (const [nextLanguage, expected] of [['en', 'Dismiss notification'], ['km', 'បិទការជូនដំណឹង'], ['en', 'Dismiss notification']]) {
    language = nextLanguage
    assert.equal(packs[language].dismiss_notification, expected)
    let dismissed = 0
    const node = Notification({ notification: { type: 'error', message: 'Saved draft remains available' }, onDismiss: () => { dismissed++ } })
    assert.ok(node)
    const button = React.Children.toArray(node.props.children).find(child => React.isValidElement(child) && child.type === 'button') as import('react').ReactElement<{ 'aria-label': string; type: string; onClick: () => void }> | undefined
    assert.ok(button)
    assert.equal(button.props['aria-label'], expected, language + ': actual toast dismiss control follows the active pack')
    assert.equal(button.props.type, 'button')
    button.props.onClick()
    assert.equal(dismissed, 1)
    const html = renderToStaticMarkup(node)
    assert.ok(html.includes('aria-label="' + expected + '"'))
    assert.ok(html.includes('Saved draft remains available'))
  }
  const before = portalCalls
  assert.equal(Notification({ notification: null }), null)
  assert.equal(portalCalls, before)
  console.log('PASS actual toast locale, language changes, dismissal and empty state (' + (browser ? 'portal' : 'server') + ')')
}
assert.equal(portalCalls, 3)
