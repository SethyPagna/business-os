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
  // Effects run for real: the hook's Escape handler is registered through useEffect and must be driven by a key event.
  useEffect: (fn: () => unknown, deps?: unknown[]) => {
    const i = cursor++; const prev = slots[i] as { deps?: unknown[]; cleanup: () => void } | undefined
    if (prev && deps && prev.deps && deps.every((d, k) => Object.is(d, prev.deps![k]))) return
    prev?.cleanup()
    const cleanup = fn()
    slots[i] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : () => {} }
  },
}
// Minimal document: addEventListener/removeEventListener for keydown, plus a dispatcher.
const listeners = new Set<(e: any) => void>()
;(globalThis as any).document = { addEventListener: (_: string, fn: any) => listeners.add(fn), removeEventListener: (_: string, fn: any) => listeners.delete(fn) }
function pressEscape() { const event = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }; for (const fn of [...listeners]) fn(event); return event }
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

await runTest('Escape closes an idle password dialog with false (a way out)', async () => {
  render()
  const done = api.askForPassword({ title: 'Rename' }, async () => null)
  assert.ok(dialog())
  const event = pressEscape()
  assert.equal(event.defaultPrevented, true)
  assert.equal(await done, false)
  assert.equal(dialog(), null)
})

await runTest('while an attempt is in flight Escape and the X do nothing, and the dialog still resolves true when the write commits', async () => {
  render()
  let release: (v: string | null) => void = () => {}
  let committed = false
  const done = api.askForPassword({ title: 'Rename' }, () => new Promise<string | null>((resolve) => { release = (v) => { if (v === null) committed = true; resolve(v) } }))
  let settledEarly: boolean | undefined
  void done.then((v: boolean) => { settledEarly = v })
  type('right-one')
  dialog()!.props.onConfirm()
  assert.equal(dialog()!.props.working, true, 'attempt is in flight')
  pressEscape()
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(settledEarly, undefined, 'Escape must not answer cancelled while the write can still commit')
  assert.ok(dialog(), 'still open')
  // A second submit in the same tick (Enter then click) must not start another attempt.
  dialog()!.props.onConfirm()
  release(null)
  assert.equal(await done, true)
  assert.equal(committed, true)
  assert.equal(dialog(), null)
})

await runTest('a second submit before the first attempt settles runs the attempt once', async () => {
  render()
  let calls = 0
  let release: (v: string | null) => void = () => {}
  const done = api.askForPassword({ title: 'Rename' }, () => { calls += 1; return new Promise<string | null>((resolve) => { release = resolve }) })
  type('pw')
  const submit = dialog()!.props.onConfirm
  submit(); submit()
  release(null)
  await done
  assert.equal(calls, 1)
})

await runTest('the dialog hands the working flag to the Modal as closeDisabled (source pin; the Modal disables the X on it)', async () => {
  const dialogSource = fs.readFileSync(new URL('../src/components/shared/ConfirmDialog.tsx', import.meta.url), 'utf8')
  assert.match(dialogSource, /closeDisabled=\{working\}/)
})

await runTest('a 429 current_password_rate_limited error maps to its translated text; other errors are not mapped', async () => {
  const settingsSource = fs.readFileSync(new URL('../src/components/utils-settings/Settings.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const start = settingsSource.indexOf('const STEP_UP_REFUSAL_CODES')
  const end = settingsSource.indexOf('export default function Settings')
  const out = ts.transpileModule(settingsSource.slice(start, end) + '\nexports.stepUpRefusalText = stepUpRefusalText', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} as any }
  new Function('exports', 'module', out)(mod.exports, mod)
  const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'))
  const t = (key: string) => en[key]
  const rate = Object.assign(new Error('raw server text'), { code: 'current_password_rate_limited' })
  assert.equal(mod.exports.stepUpRefusalText(rate, t), en.current_password_rate_limited)
  assert.equal(mod.exports.stepUpRefusalText(Object.assign(new Error('x'), { code: 'incorrect_password' }), t), en.incorrect_password)
  assert.equal(mod.exports.stepUpRefusalText(Object.assign(new Error('boom'), { code: 'write_conflict' }), t), null)
  assert.equal(mod.exports.stepUpRefusalText(new Error('plain'), t), null)
  assert.equal(mod.exports.stepUpRefusalText(rate, () => undefined), 'raw server text', 'falls back to the server text when the pack lacks the key')
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
