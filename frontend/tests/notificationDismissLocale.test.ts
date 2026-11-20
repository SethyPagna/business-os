import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { toastStackTop } from '../src/utils/mobileNavChrome.ts'
import { limitForDialog, releaseHeldToasts } from '../src/app/useToastStack.ts'

const require = createRequire(import.meta.url)
const ts = require('typescript') as typeof import('typescript')
const React = require('react') as typeof import('react')
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
const parsed = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const pick = (name: string) => parsed.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name) as import('typescript').FunctionDeclaration
const paths = parsed.statements.find(statement => ts.isVariableStatement(statement) && statement.getText(parsed).startsWith('const TOAST_ICON_PATHS')) as import('typescript').VariableStatement
assert.ok(pick('Notification') && pick('ToastIcon') && paths)
const compiled = ts.transpileModule([paths.getText(parsed), pick('ToastIcon').getText(parsed), pick('Notification').getText(parsed)].join('\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText
const packs = Object.fromEntries(['en', 'km'].map(language => [language, JSON.parse(fs.readFileSync(path.join(root, 'src/lang', language + '.json'), 'utf8'))])) as Record<string, Record<string, string>>
type ToastProps = { notification: { type: string; message: string } | null; onDismiss?: () => void }
type Node = import('react').ReactElement<{ children?: import('react').ReactNode }> | null
let language = 'en'
let portalCalls = 0
const translate = (key: string) => packs[language][key] ?? key
const find = (node: unknown, test: (props: Record<string, unknown>) => boolean, found: Array<{ props: Record<string, any> }> = []): Array<{ props: Record<string, any> }> => {
  if (!node || typeof node !== 'object') return found
  if (Array.isArray(node)) { node.forEach(child => find(child, test, found)); return found }
  const element = node as { props?: Record<string, any> }
  if (element.props && test(element.props)) found.push(element as { props: Record<string, any> })
  if (element.props?.children) find(element.props.children, test, found)
  return found
}
function load(browser: boolean, channelDismissed: string[]): (props: ToastProps) => Node {
  // A message from the context's own slot is drawn by the stack with fromSlot, a channel message without it.
  const useToastStack = (slot: { type: string; message: string } | null) => ({
    visible: slot ? [{ key: 'channel-1', message: 'Channel notice', type: 'warning', duration: 1 }] : [],
    slot: slot ? { key: 'slot-1', message: slot.message, type: slot.type, duration: Infinity, fromSlot: true } : null,
    dismiss: (key: string) => { channelDismissed.push(key) }, pause() {}, resume() {},
  })
  return new Function('React', 'useEffect', 'releaseHeldToasts', 'useRef', 'useApp', 'useToastStack', 'useDialogOpen', 'useNarrowViewport', 'limitForDialog', 'toastStackTop', 'getNotificationColor', 'getNotificationKind', 'createPortal', 'document', 'window', compiled + '\nreturn Notification')(
    React,
    () => {},
    releaseHeldToasts,
    (initial: unknown) => ({ current: initial }),
    () => ({ t: translate }),
    useToastStack,
    () => false,
    () => false,
    limitForDialog,
    toastStackTop,
    () => 'bg-red-700',
    (type: string) => (type === 'success' || type === 'error' || type === 'warning' ? type : 'info'),
    (node: Node) => { portalCalls++; return node },
    browser ? { body: {}, activeElement: null } : undefined,
    { requestAnimationFrame: () => 1 },
  ) as (props: ToastProps) => Node
}
for (const browser of [false, true]) {
  const channelDismissed: string[] = []
  const Notification = load(browser, channelDismissed)
  for (const [nextLanguage, expected] of [['en', 'Dismiss notification'], ['km', 'បិទការជូនដំណឹង'], ['en', 'Dismiss notification']]) {
    language = nextLanguage
    assert.equal(packs[language].dismiss_notification, expected)
    let dismissed = 0
    const node = Notification({ notification: { type: 'error', message: 'Saved draft remains available' }, onDismiss: () => { dismissed++ } })
    assert.ok(node)
    const buttons = find(node, props => props['data-toast-dismiss'] !== undefined)
    assert.equal(buttons.length, 2, 'the context slot message and the channel pop-up each carry a dismiss control')
    for (const button of buttons) {
      assert.equal(button.props['aria-label'], expected, language + ': actual toast dismiss control follows the active pack')
      assert.equal(button.props.type, 'button')
    }
    // The slot message is drawn above the stack and dismissing it tells the context; a channel pop-up goes to the stack.
    buttons[0].props.onClick({ detail: 1, currentTarget: {} })
    assert.equal(dismissed, 1)
    assert.deepEqual(channelDismissed.splice(0), [])
    buttons[1].props.onClick({ detail: 1, currentTarget: {} })
    assert.equal(dismissed, 1)
    assert.deepEqual(channelDismissed.splice(0), ['channel-1'])
    const html = renderToStaticMarkup(node)
    assert.ok(html.includes('aria-label="' + expected + '"'))
    assert.ok(html.includes('Saved draft remains available'))
    assert.ok(html.includes('Channel notice'))
  }
  // Nothing to show: the stack is absent but the two live regions stay mounted.
  const empty = renderToStaticMarkup(Notification({ notification: null }) as never)
  assert.ok(empty.includes('aria-live="polite"') && empty.includes('aria-live="assertive"'))
  assert.ok(!empty.includes('data-toast-dismiss'))
  console.log('PASS actual toast locale, language changes, dismissal and live regions (' + (browser ? 'portal' : 'server') + ')')
}
assert.ok(portalCalls > 0)
