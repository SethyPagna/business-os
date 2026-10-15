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
const makeButton = (name: string, attributes: Record<string, string> = {}) => ({ name, getAttribute: (key: string) => attributes[key] ?? null, getClientRects: () => [{}], closest: () => null, focus() { focusLog.push(name); doc.activeElement = this } })
const portals = new Map<string, unknown>()
const doc: Record<string, unknown> & { activeElement: unknown } = {
  activeElement: makeButton('opener'),
  addEventListener: (_type: string, fn: Listener) => { listeners.push(fn) },
  removeEventListener: (_type: string, fn: Listener) => { const at = listeners.indexOf(fn); if (at >= 0) listeners.splice(at, 1) },
  querySelector: (selector: string) => (selector.includes('data-app-select-menu') && selectMenuOpen ? {} : null),
  querySelectorAll: () => [],
  getElementById: (id: string) => portals.get(id) ?? null,
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
const panel = { querySelector: () => first, querySelectorAll: () => [first, last], closest: () => null }
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

// A dialog made inert (a confirm opened from inside it) sits under another surface: it must not answer the keyboard.
let underneathEscapes = 0
let underneathInert = true
const underneath = { querySelector: () => first, querySelectorAll: () => [first, last], closest: (selector: string) => (selector === '[inert]' && underneathInert ? {} : null) }
useDialogKeyboard({ current: underneath }, { enabled: true, promptOpen: false, onEscape: () => { underneathEscapes += 1 }, onPromptEscape: () => {} })
press('Escape')
assert.equal(underneathEscapes, 0, 'an inert dialog ignores Escape, so the surface above it can keep it')
doc.activeElement = last
assert.equal(press('Tab').defaultPrevented, false, 'and ignores Tab')
underneathInert = false
press('Escape')
assert.equal(underneathEscapes, 1, 'once the surface above is gone the dialog answers again')
cleanups.pop()!()

cleanups.pop()!()
assert.equal(listeners.length, 0, 'closing removes the listener')
assert.equal(focusLog.at(-1), 'opener', 'closing hands focus back to what opened the dialog')

const content = makeButton('named detail region', { 'aria-label': 'Read-only detail' })
const hint = makeButton('owned hint trigger', { 'aria-controls': 'owned-hint', 'aria-expanded': 'true' })
const tooltipFocus = { name: 'portaled tooltip' }
let contentVisible = true
let contentInert = false
let hintOpen = true
let hintVisible = true
const popup = { getAttribute: (key: string) => key === 'role' ? 'tooltip' : null, getClientRects: () => hintVisible ? [{}] : [], contains: (element: unknown) => element === tooltipFocus, hidden: false }
portals.set('owned-hint', popup)
const hintedPanel = {
  querySelector: (selector: string) => selector.includes('role="region"') ? { ...content, getClientRects: () => contentVisible ? [{}] : [], closest: () => contentInert ? {} : null } : hint,
  querySelectorAll: (selector: string) => selector.includes('aria-controls') ? (hintOpen ? [hint] : []) : [hint, first, content],
  closest: () => null,
}
let hintDialogEscapes = 0
const mountHinted = () => useDialogKeyboard({ current: hintedPanel }, { enabled: true, promptOpen: false, onEscape: () => { hintDialogEscapes += 1 }, onPromptEscape: () => {} })
mountHinted()
assert.equal(focusLog.at(-1), 'named detail region', 'an explicit visible named content region receives initial focus without opening header help')
assert.equal(press('Escape').defaultPrevented, false, 'the owned visible hint keeps Escape for its real close listener')
assert.equal(hintDialogEscapes, 0)
doc.activeElement = tooltipFocus
assert.equal(press('Tab').defaultPrevented, true)
assert.equal(doc.activeElement, hint, 'Tab from the owned portal returns to its trigger inside the dialog')
doc.activeElement = tooltipFocus
assert.equal(press('Tab', { shiftKey: true }).defaultPrevented, true)
assert.equal(doc.activeElement, hint, 'Shift+Tab also returns from the portal into the dialog')
hintVisible = false
press('Escape')
assert.equal(hintDialogEscapes, 1, 'a hidden help panel cannot intercept dialog Escape')
hintVisible = true
hintOpen = false
press('Escape')
assert.equal(hintDialogEscapes, 2, 'an unrelated body-level tooltip cannot intercept this dialog')
hintOpen = true
let newestEscapes = 0
useDialogKeyboard({ current: panel }, { enabled: true, promptOpen: false, onEscape: () => { newestEscapes += 1 }, onPromptEscape: () => {} })
press('Escape')
assert.equal(newestEscapes, 1, 'the newer dialog still owns Escape above a parent help panel')
assert.equal(hintDialogEscapes, 2)
cleanups.pop()!()
cleanups.pop()!()
let promptHintEscapes = 0
useDialogKeyboard({ current: hintedPanel }, { enabled: true, promptOpen: true, onEscape: () => {}, onPromptEscape: () => { promptHintEscapes += 1 } })
press('Escape')
assert.equal(promptHintEscapes, 1, 'a dirty prompt above an owned help panel keeps its Escape priority')
cleanups.pop()!()
contentVisible = false
mountHinted()
assert.equal(doc.activeElement, hint, 'hidden content preserves the original first-control focus fallback')
cleanups.pop()!()
contentVisible = true
contentInert = true
mountHinted()
assert.equal(doc.activeElement, hint, 'inert content cannot receive the preferred initial focus')
cleanups.pop()!()
assert.equal(listeners.length, 0)

console.log('PASS dialogKeyboard: focus, Escape, listbox precedence, Tab wrap, stacking, restore')
