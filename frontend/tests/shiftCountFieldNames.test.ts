// The cash-used inputs carry their field in the accessible name (board item shiftf3, F6): "Added cash, Riel" and
// "Added cash, Dollars", joined from the two labels the packs already hold (no new word, both languages).
// The REAL ShiftCountPair is rendered (react-dom/server) and the accessible names are read off the inputs.
//
// Run: node tests/shiftCountFieldNames.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { transformSync } from 'esbuild'

const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire('react')
const renderToStaticMarkup = nodeRequire('react-dom/server').renderToStaticMarkup as (node: unknown) => string
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>

function loadFields(source = read('../src/components/shifts/ShiftCountFields.tsx').replace(/\r\n/g, '\n'), pack = en): any {
  const compiled = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, unknown> }
  const shim = (id: string): unknown => {
    if (id.includes('AppContext')) return { useApp: () => ({ t: (key: string) => pack[key] ?? key }) }
    if (id.includes('InfoHint')) return { __esModule: true, default: () => null }
    if (id.startsWith('.')) return nodeRequire(new URL(id, new URL('../src/components/shifts/', import.meta.url)).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
    return nodeRequire(id)
  }
  new Function('require', 'module', 'exports', compiled)(shim, mod, mod.exports)
  return mod.exports
}

function names(source?: string, pack = en): string[] {
  const fields = loadFields(source, pack)
  const t = (key: string) => pack[key] ?? key
  const html = renderToStaticMarkup(React.createElement(fields.default, {
    label: t('shift_additional_cash'), usd: '', khr: '', onUsd: () => undefined, onKhr: () => undefined,
    ...fields.shiftCashUsedLabels(t),
  }))
  return [...html.matchAll(/<input[^>]*aria-label="([^"]*)"/g)].map((match) => match[1])
}

test('the cash-used inputs are named "Added cash, Dollars" and "Added cash, Riel"', () => {
  assert.deepEqual(names(), ['Added cash, Riel', 'Added cash, Dollars'])
})

test('in Khmer the names join the two existing labels and add no new word', () => {
  const got = names(undefined, km)
  assert.deepEqual(got, [`${km.shift_additional_cash}, ${km.shift_additional_khr}`, `${km.shift_additional_cash}, ${km.shift_additional_usd}`])
  for (const name of got) assert.ok(!/[A-Za-z]{3}/.test(name), 'no English placeholder in the Khmer names')
})

test('every cash-used pair goes through the one helper, so no caller announces a bare "Dollars" or "Riel"', () => {
  for (const file of ['../src/components/pos/ShiftGate.tsx', '../src/components/shifts/ShiftHistoryModal.tsx']) {
    const source = read(file)
    assert.ok(!/usdLabel=\{t\('shift_additional_usd'\)\}/.test(source) && !/khrLabel=\{t\('shift_additional_khr'\)\}/.test(source), `${file} names a cash-used input by its bare currency word`)
    assert.ok(/shiftCashUsedLabels\(t\)/.test(source), `${file} uses shiftCashUsedLabels`)
  }
})

test('mutant: the helper returning the bare currency words fails the name test', () => {
  const source = read('../src/components/shifts/ShiftCountFields.tsx').replace(/\r\n/g, '\n')
  assert.ok(source.includes('shiftCashUsedLabels'), 'the helper exists')
  const mutant = source.replace(/usdLabel: `[^`]*`/, "usdLabel: t('shift_additional_usd')")
  assert.notEqual(mutant, source, 'the mutant target exists')
  assert.throws(() => assert.deepEqual(names(mutant), ['Added cash, Riel', 'Added cash, Dollars']))
})
