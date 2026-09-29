import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import { newPasswordProblem } from '../src/utils/passwordRules.ts'

// AUTH-P1: components/auth/password/NewPasswordFields.tsx, the new + confirm
// pair every set-a-password screen uses.
//   - 'self': autocomplete="new-password" and Safari's passwordrules, so the
//     person's own password manager offers to save it;
//   - 'other-user' (an administrator setting someone else's password): off
//     plus the 1Password / LastPass / Bitwarden ignore attributes, so it never
//     lands in the administrator's vault;
//   - Show never switches the input to type=text (a submit while revealed can
//     skip the browsers' save logic): the value appears in a line below;
//   - Suggest fills both inputs with one suggestion; Copy writes the clipboard
//     only when pressed.

type TestCallback = () => void | Promise<void>
let failed = 0
async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const require = createRequire(import.meta.url)
const React = require('react')
const renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup as (node: unknown) => string
const source = fs.readFileSync(new URL('../src/components/auth/password/NewPasswordFields.tsx', import.meta.url), 'utf8')
const compiled = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code

type Element = { type: unknown; props: Record<string, unknown> }
type Hooks = { useState: <T>(initial: T) => [T, (value: T) => void] }

// Loads the component. With `hooks`, React is replaced by a stub whose
// useState answers from `hooks` and whose JSX builds plain {type, props}
// objects, so a handler can be called without a DOM.
function loadFields(clipboard: string[], hooks?: Hooks): (props: Record<string, unknown>) => unknown {
  const mod = { exports: {} as Record<string, unknown> }
  const toElement = (type: unknown, props: Record<string, unknown>): Element => ({ type, props })
  new Function('require', 'module', 'exports', compiled)((id: string) => {
    if (id.endsWith('/passwordManager.ts')) return { copyPasswordToClipboard: async (value: string) => { clipboard.push(value); return true } }
    if (id.endsWith('/passwordSuggest.ts')) return require('../src/utils/passwordSuggest.ts')
    if (hooks && id === 'react') return hooks
    if (hooks && id === 'react/jsx-runtime') return { jsx: toElement, jsxs: toElement, Fragment: 'Fragment' }
    return require(id)
  }, mod, mod.exports)
  return mod.exports.default as (props: Record<string, unknown>) => unknown
}

const tr = (_key: string, fallback: string) => fallback
const baseProps = (overrides: Record<string, unknown> = {}) => ({
  tr, idPrefix: 'p', password: '', confirm: '', onPasswordChange: () => {}, onConfirmChange: () => {}, ...overrides,
})

type Tag = Record<string, string>
function inputsOf(html: string): Tag[] {
  return [...html.matchAll(/<input\b([^>]*)>/g)].map((match) => {
    const attributes: Tag = {}
    for (const attribute of match[1].matchAll(/([a-zA-Z0-9_:-]+)(?:="([^"]*)")?/g)) attributes[attribute[1].toLowerCase()] = attribute[2] ?? ''
    return attributes
  })
}

function walk(node: unknown, visit: (element: Element) => void): void {
  if (Array.isArray(node)) { node.forEach((child) => walk(child, visit)); return }
  if (!node || typeof node !== 'object' || !('props' in node)) return
  visit(node as Element)
  walk((node as Element).props.children, visit)
}

function buttonLabelled(tree: unknown, label: string): Element {
  let found: Element | null = null
  walk(tree, (element) => { if (element.props.label === label) found = element })
  assert.ok(found, `button "${label}"`)
  return found
}

await runTest('self: both inputs are named new-password fields that Safari\'s generator can fill', () => {
  const html = renderToStaticMarkup(React.createElement(loadFields([]), baseProps()))
  const [fresh, confirm] = inputsOf(html)
  assert.deepEqual([fresh.type, fresh.name, fresh.autocomplete], ['password', 'new_password', 'new-password'])
  assert.deepEqual([confirm.type, confirm.name, confirm.autocomplete], ['password', 'confirm_password', 'new-password'])
  assert.match(fresh.passwordrules, /required: upper; required: digit;/)
  assert.equal('data-1p-ignore' in fresh, false)
})

await runTest('other-user: autocomplete off and every password-manager ignore attribute, on both inputs', () => {
  const html = renderToStaticMarkup(React.createElement(loadFields([]), baseProps({ mode: 'other-user' })))
  for (const input of inputsOf(html)) {
    assert.equal(input.type, 'password')
    assert.equal(input.autocomplete, 'off')
    assert.equal(input['data-1p-ignore'], 'true')
    assert.equal(input['data-lpignore'], 'true')
    assert.equal(input['data-bwignore'], 'true')
    assert.equal('passwordrules' in input, false)
  }
})

await runTest('Suggest fills both inputs with the same valid suggestion and copies nothing', async () => {
  const filled: string[] = []
  const confirmed: string[] = []
  const clipboard: string[] = []
  const Fields = loadFields(clipboard, { useState: (initial) => [initial, () => {}] })
  const tree = Fields(baseProps({ onPasswordChange: (value: string) => filled.push(value), onConfirmChange: (value: string) => confirmed.push(value) }))
  ;(buttonLabelled(tree, 'Suggest a strong password').props.onClick as () => void)()
  assert.equal(filled.length, 1)
  assert.deepEqual(confirmed, filled)
  assert.equal(newPasswordProblem(filled[0]), null)
  assert.equal(filled[0].length, 19)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(clipboard, [], 'a suggestion is never copied on its own')
})

await runTest('Show keeps the inputs type=password and shows the value in a line below', () => {
  const revealedFirst: Hooks = { useState: (initial) => [(typeof initial === 'boolean' ? true : initial) as typeof initial, () => {}] }
  const tree = loadFields([], revealedFirst)(baseProps({ password: 'Kept-Secret-7', confirm: 'Kept-Secret-7' }))
  const inputs: Element[] = []
  const shown: Element[] = []
  walk(tree, (element) => {
    if (element.type === 'input') inputs.push(element)
    if (element.type === 'div' && element.props.children === 'Kept-Secret-7') shown.push(element)
  })
  assert.deepEqual(inputs.map((element) => element.props.type), ['password', 'password'])
  assert.equal(shown.length, 1, 'the revealed value is a read-only line')
  assert.equal(buttonLabelled(tree, 'Hide password').props.pressed, true)
})

await runTest('Copy writes the clipboard only when pressed', async () => {
  const clipboard: string[] = []
  const Fields = loadFields(clipboard, { useState: (initial) => [initial, () => {}] })
  const tree = Fields(baseProps({ password: 'Kept-Secret-7', confirm: 'Kept-Secret-7' }))
  renderToStaticMarkup(React.createElement(loadFields(clipboard), baseProps({ password: 'Kept-Secret-7', confirm: 'Kept-Secret-7' })))
  assert.deepEqual(clipboard, [], 'rendering copies nothing')
  ;(buttonLabelled(tree, 'Copy new password').props.onClick as () => void)()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(clipboard, ['Kept-Secret-7'])
})

await runTest('the strength meter renders from the first paint and names the level', () => {
  const Fields = loadFields([])
  const empty = renderToStaticMarkup(React.createElement(Fields, baseProps()))
  assert.match(empty, /Strength: -/)
  assert.match(renderToStaticMarkup(React.createElement(Fields, baseProps({ password: 'abcdef' }))), /Strength: Weak/)
  assert.match(renderToStaticMarkup(React.createElement(Fields, baseProps({ password: 'Abcdefgh1234xy' }))), /Strength: Strong/)
})

await runTest('columns: new and confirm side by side, both label rows as tall as the icon row so the inputs line up', () => {
  const Fields = loadFields([])
  const confirmLabelClass = (html: string) => /<label for="p-confirm" class="([^"]*)"/.exec(html)?.[1] || ''
  const columns = renderToStaticMarkup(React.createElement(Fields, baseProps({ layout: 'columns' })))
  assert.match(columns, /^<div class="grid gap-2 sm:grid-cols-2">/)
  assert.match(confirmLabelClass(columns), /\bh-7\b/)
  assert.match(columns, /<button[^>]*class="[^"]*\bh-7\b/, 'the icon buttons set the new-password row height')
  const stacked = renderToStaticMarkup(React.createElement(Fields, baseProps()))
  assert.match(stacked, /^<div class="space-y-2">/)
  assert.doesNotMatch(confirmLabelClass(stacked), /\bh-7\b/, 'stacked screens stay compact')
})

if (failed > 0) process.exitCode = 1
