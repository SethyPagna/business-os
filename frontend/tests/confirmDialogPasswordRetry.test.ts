// The current-password step-up dialog (useConfirmDialog.askForPassword) must never trap staff:
//   - a wrong password keeps the dialog open, shows the refusal inline, clears the field and puts focus back on it;
//   - the rate limit (429) shows its text and keeps Cancel available;
//   - success closes it; Cancel / Escape close it (a way out) and answer false.
// The real hook is transpiled and driven against a tiny hooks runtime (no DOM in this suite), with ConfirmDialog
// replaced by a component that just records the props the hook gave it.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
let failed = 0
async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

type Node = { type: unknown; props: Record<string, any> }
const slots: unknown[] = []
let cursor = 0
let rerender = () => {}
const focused: string[] = []
const react = {
  useState: (initial: unknown) => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (v: unknown) => { slots[i] = typeof v === 'function' ? (v as any)(slots[i]) : v; rerender() }] },
  useRef: (initial: unknown) => { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i] },
  useCallback: (fn: unknown) => fn,
  useEffect: () => {},
}
const jsx = (type: unknown, props: Record<string, any>): Node => ({ type, props })
const DialogStub = (): null => null

const source = fs.readFileSync(new URL('../src/components/shared/useConfirmDialog.tsx', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } })
const loaded = { exports: {} as any }
const stubs: Record<string, unknown> = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
  '../../app/AppContextCore.tsx': { useApp: () => ({ t: (key: string) => key }) },
  './ConfirmDialog': { __esModule: true, default: DialogStub },
}
new Function('exports', 'require', 'module', outputText)(loaded.exports, (id: string) => (id in stubs ? stubs[id] : require(id)), loaded)

let api: any
function render(): Node | null {
  cursor = 0
  api = loaded.exports.useConfirmDialog((key: string) => key)
  return api.confirmDialog
}
rerender = () => { render() }
function find(node: any, test: (n: Node) => boolean): Node | null {
  if (!node || typeof node !== 'object') return null
  if (test(node)) return node
  const kids = node.props?.children
  for (const kid of Array.isArray(kids) ? kids : [kids]) { const hit = find(kid, test); if (hit) return hit }
  return null
}
const dialog = () => render() as Node | null
const input = () => find(dialog(), (n) => n.type === 'input')
const alertText = () => { const p = find(dialog(), (n) => n.type === 'p' && n.props.role === 'alert'); return p ? String(p.props.children) : '' }
function type(text: string) { const el = input()!; el.props.onChange({ target: { value: text } }) }

// The hook focuses through a ref the DOM would fill in; record the focus call instead.
function attachFocus() { (slots.find((s) => s && typeof s === 'object' && 'current' in (s as any) && (s as any).current === null) as any).current = { focus: () => focused.push('focus') } }

await runTest('a wrong password keeps the dialog open, shows the text inline, clears the field and refocuses it', async () => {
  render()
  const answers = ['That password is wrong.', null]
  const tried: string[] = []
  const done = api.askForPassword({ title: 'Rename' }, async (pw: string) => { tried.push(pw); return answers.shift() ?? null })
  assert.ok(dialog(), 'dialog is open')
  attachFocus()
  assert.equal(dialog()!.props.confirmDisabled, true, 'Confirm waits for a typed password')
  type('wrong-one')
  assert.equal(dialog()!.props.confirmDisabled, false)
  dialog()!.props.onConfirm()
  await new Promise((r) => setTimeout(r, 10))
  assert.deepEqual(tried, ['wrong-one'])
  assert.ok(dialog(), 'still open after the refusal')
  assert.equal(alertText(), 'That password is wrong.')
  assert.equal(input()!.props.value, '', 'field cleared')
  assert.equal(dialog()!.props.confirmDisabled, true, 'Confirm waits for the retyped password')
  assert.deepEqual(focused, ['focus'], 'focus back on the field')
  type('right-one')
  dialog()!.props.onConfirm()
  assert.equal(await done, true)
  assert.deepEqual(tried, ['wrong-one', 'right-one'])
  assert.equal(dialog(), null, 'closed on success')
})

await runTest('the rate limit shows its text and Cancel still closes the dialog with false', async () => {
  render()
  const done = api.askForPassword({ title: 'Rename' }, async () => 'Too many wrong attempts. Wait 15 minutes.')
  type('x')
  dialog()!.props.onConfirm()
  await new Promise((r) => setTimeout(r, 10))
  assert.ok(dialog(), 'open')
  assert.equal(alertText(), 'Too many wrong attempts. Wait 15 minutes.')
  assert.equal(dialog()!.props.working, false, 'Cancel is not disabled after the refusal')
  dialog()!.props.onClose()
  assert.equal(await done, false)
  assert.equal(dialog(), null)
})

await runTest('a thrown attempt shows inline too, and Enter in the field submits', async () => {
  render()
  const done = api.askForPassword({ title: 'Rename' }, async () => { throw new Error('Network down') })
  type('abc')
  input()!.props.onKeyDown({ key: 'Enter', preventDefault() {} })
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(alertText(), 'Network down')
  dialog()!.props.onClose()
  assert.equal(await done, false)
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
