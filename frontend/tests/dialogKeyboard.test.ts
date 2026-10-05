// useDialogKeyboard, run for real against a stub DOM (no jsdom in this tree): Escape closes through
// the guard, an open AppSelect listbox owns the first Escape, Tab wraps inside the panel, only the
// newest of two stacked dialogs answers, and closing hands focus back.
//
// Run: node tests/dialogKeyboard.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/components/shared/useDialogKeyboard.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

type Listener = (event: Record<string, unknown>) => void
const listeners: Listener[] = []
let selectMenuOpen = false
const focusLog: string[] = []
const makeButton = (name: string) => ({ name, focus() { focusLog.push(name); doc.activeElement = this } })
const doc: Record<string, unknown> & { activeElement: unknown } = {
  activeElement: makeButton('opener'),
  addEventListener: (_type: string, fn: Listener) => { listeners.push(fn) },
  removeEventListener: (_type: string, fn: Listener) => { const at = listeners.indexOf(fn); if (at >= 0) listeners.splice(at, 1) },
  querySelector: (selector: string) => (selector.includes('data-app-select-menu') && selectMenuOpen ? {} : null),
  querySelectorAll: () => [],
}
;(globalThis as Record<string, unknown>).document = doc
;(globalThis as Record<string, unknown>).window = { requestAnimationFrame: (fn: () => void) => fn() }

const cleanups: Array<() => void> = []
const reactStub = {
  useRef: <T,>(value: T) => ({ current: value }),
  useEffect: (effect: () => void | (() => void)) => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) },
}
const exportsBag: { useDialogKeyboard?: (...args: unknown[]) => void } = {}
new Function('require', 'exports', js)((id: string) => { assert.equal(id, 'react'); return reactStub }, exportsBag)
const useDialogKeyboard = exportsBag.useDialogKeyboard!

const first = makeButton('first')
const last = makeButton('last')
const panel = { querySelector: () => first, querySelectorAll: () => [first, last] }
const press = (key: string, extra: Record<string, unknown> = {}) => {
  const event = { key, shiftKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true }, ...extra }
  for (const fn of [...listeners]) fn(event)
  return event
}

let escapes = 0
let promptEscapes = 0
useDialogKeyboard({ current: panel }, { enabled: true, promptOpen: false, onEscape: () => { escapes += 1 }, onPromptEscape: () => { promptEscapes += 1 } })
assert.equal(doc.activeElement, first, 'focus moves into the panel on open')

assert.equal(press('Escape').defaultPrevented, true)
assert.equal(escapes, 1, 'Escape closes through the guard')

selectMenuOpen = true
press('Escape')
assert.equal(escapes, 1, 'an open listbox owns the first Escape')
selectMenuOpen = false

doc.activeElement = last
assert.equal(press('Tab').defaultPrevented, true)
assert.equal(doc.activeElement, first, 'Tab on the last control wraps to the first')
assert.equal(press('Tab', { shiftKey: true }).defaultPrevented, true)
assert.equal(doc.activeElement, last, 'Shift+Tab on the first control wraps to the last')
doc.activeElement = makeButton('middle')
assert.equal(press('Tab').defaultPrevented, false, 'Tab between inner controls is left alone')

let outerEscapes = 0
useDialogKeyboard({ current: panel }, { enabled: true, promptOpen: false, onEscape: () => { outerEscapes += 1 }, onPromptEscape: () => {} })
press('Escape')
assert.equal(outerEscapes, 1, 'the newest stacked dialog answers')
assert.equal(escapes, 1, 'the older dialog stays silent while another is above it')
cleanups.pop()!()
press('Escape')
assert.equal(escapes, 2, 'the older dialog answers again once the top one is gone')

cleanups.pop()!()
assert.equal(listeners.length, 0, 'closing removes the listener')
assert.equal(focusLog.at(-1), 'opener', 'closing hands focus back to what opened the dialog')

console.log('PASS dialogKeyboard: focus, Escape, listbox precedence, Tab wrap, stacking, restore')
