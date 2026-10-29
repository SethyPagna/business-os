import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { transformSync } from 'esbuild'
import * as arithmetic from '../src/utils/pagerState.ts'

const read = (rel: string) => readFileSync(new URL('../src/' + rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const jsx = (type: unknown, props: any) => ({ type, props })
const mod: any = { exports: {} }
let currentHooks: any
const code = ts.transpileModule(read('components/shared/PaginationControls.tsx'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText
new Function('require', 'module', 'exports', code)((name: string) => {
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
  if (name === 'react') return { useState: (...args: any[]) => currentHooks.useState(...args), useEffect: (...args: any[]) => currentHooks.useEffect(...args) }
  if (name.includes('pagerState')) return arithmetic
  if (name.includes('lucide-react')) return { __esModule: true, default: 'Icon' }
  throw new Error('unexpected pager dependency ' + name)
}, mod, mod.exports)
function harness(input: any) {
  let cursor = 0
  const slots: any[] = [], effects = new Map<number, () => void>(), calls: number[] = []
  const props: any = { ...input, onPageChange: (page: number) => { calls.push(page) } }
  const hooks = { useState(initial: unknown) { const slot = slots[cursor++] ??= { value: initial }; return [slot.value, (v: any) => { slot.value = typeof v === 'function' ? v(slot.value) : v }] },
    useEffect(fn: () => void, deps: unknown[]) { const index = cursor++, slot = slots[index] ??= {}; if (!slot.deps || deps.some((v, i) => !Object.is(v, slot.deps[i]))) { slot.deps = deps; effects.set(index, fn) } } }
  let tree: any
  const render = () => { cursor = 0; currentHooks = hooks; tree = mod.exports.default(props); return tree }
  const commit = () => { for (const effect of effects.values()) effect(); effects.clear(); return render() }
  render()
  return { props, calls, render, commit, get tree() { return tree } }
}
function nodes(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes)
  return node && typeof node === 'object' ? [node, ...nodes(node.props?.children)] : []
}
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node == null || typeof node === 'boolean' ? '' : String(node)
const input = (h: any) => nodes(h.tree).find(n => n.type === 'input')
const button = (h: any, label: string) => { const n = nodes(h.tree).find(n => n.type === 'button' && n.props['aria-label'] === label); assert.ok(n, label); return n }
let failures = 0
async function test(name: string, fn: () => void | Promise<void>) { try { await fn(); console.log('PASS ' + name) } catch (e) { failures++; console.error('FAIL ' + name); console.error(e) } }

for (const language of ['en', 'km']) {
  const pack = JSON.parse(read(`lang/${language}.json`)), t = (k: string) => pack[k] || k
  const labels = { back: pack.back || 'Back', next: pack.next || 'Next' }
  const base = { compact: true, rangeAsPageSize: true, compactCentered: true, page: 4, pageSize: 20, totalItems: null, totalItemsKnown: false, pageItems: 20, t }
  await test(`actual ${language} unknown full page4 retains61–80, arrows and manual jump`, () => {
    const h = harness(base); h.commit()
    assert.equal(input(h).props.value, '4'); assert.ok(text(h.tree).includes('61-80')); assert.ok(text(h.tree).includes('/ —')); assert.deepEqual(h.calls, [])
    assert.equal(button(h, labels.back).props.disabled, false); assert.equal(button(h, labels.next).props.disabled, false)
    button(h, labels.back).props.onClick(); button(h, labels.next).props.onClick(); assert.deepEqual(h.calls, [3, 5])
    input(h).props.onBlur({ currentTarget: { value: '17' } }); assert.equal(h.calls.at(-1), 17, 'unknown total cannot clamp a manual page to loaded rows')
    let blurred = false, prevented = false
    input(h).props.onKeyDown({ key: 'Enter', preventDefault() { prevented = true }, currentTarget: { value: '9', blur() { blurred = true } } })
    assert.equal(h.calls.at(-1), 9); assert.ok(blurred && prevented)
  })
  await test(`actual ${language} partial page4 and empty page5 keep Back without automatic clamp`, () => {
    const partial = harness({ ...base, pageItems: 7 }); partial.commit()
    assert.equal(input(partial).props.value, '4'); assert.ok(text(partial.tree).includes('61-67')); assert.equal(button(partial, labels.next).props.disabled, true); assert.equal(button(partial, labels.back).props.disabled, false); assert.deepEqual(partial.calls, [])
    const empty = harness({ ...base, page: 5, pageItems: 0 }); empty.commit()
    assert.ok(empty.tree); assert.equal(input(empty).props.value, '5'); assert.ok(text(empty.tree).includes('0-0')); assert.ok(text(empty.tree).includes('/ —'))
    assert.equal(button(empty, labels.back).props.disabled, false); assert.equal(button(empty, labels.next).props.disabled, true); assert.deepEqual(empty.calls, [])
    button(empty, labels.back).props.onClick(); assert.deepEqual(empty.calls, [4])
  })
}
await test('unknown kernel has no fabricated total and full/partial/empty states are distinct', () => {
  assert.equal(typeof arithmetic.unknownTotalPagerState, 'function')
  for (const [page, count, start, end, next] of [[4, 20, 61, 80, false], [4, 7, 61, 67, true], [5, 0, 0, 0, true]]) {
    const state = arithmetic.unknownTotalPagerState(page, 20, count)
    assert.equal(state.page, page); assert.equal(state.start, start); assert.equal(state.end, end); assert.equal(state.nextDisabled, next); assert.equal(state.backDisabled, false)
    assert.equal('total' in state, false); assert.equal('totalPages' in state, false)
  }
})
await test('known totals, explicit/default callers and other layouts retain authoritative clamps', () => {
  for (const layout of [{}, { compact: true }, { compact: true, rangeAsPageSize: true }, { layout: 'centered' }]) {
    const h = harness({ ...layout, page: 9, pageSize: 20, totalItems: 45 }); h.commit(); h.commit()
    assert.deepEqual(h.calls, [3], JSON.stringify(layout)); if (input(h)) assert.equal(input(h).props.value, '3'); else assert.ok(text(h.tree).includes('3 / 3')); assert.ok(text(h.tree).includes('/ 3'))
    const zero = harness({ ...layout, page: 4, totalItems: 0 }); zero.commit(); assert.equal(zero.tree, null); assert.deepEqual(zero.calls, [1])
  }
  for (const optOut of [{ compact: false, rangeAsPageSize: true }, { compact: true, rangeAsPageSize: false }, { compact: true, rangeAsPageSize: true, layout: 'centered' }]) {
    const h = harness({ ...optOut, totalItemsKnown: false, pageItems: 20, page: 4, totalItems: 0 }); h.commit()
    assert.deepEqual(h.calls, [1], 'unknown opt-in must not alter another layout')
  }
  const defaults = harness({ totalItems: 21 }); defaults.commit(); assert.equal(input(defaults).props.value, '1'); assert.ok(text(defaults.tree).includes('/ 2'))
})
await test('actual top and bottom Sales mounts both opt into unknown-total behavior', () => {
  const source = read('components/sales/Sales.tsx'), ast = ts.createSourceFile('Sales.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const collect = (n: ts.Node): ts.Node[] => [...(ts.isJsxSelfClosingElement(n) && n.tagName.getText(ast) === 'PaginationControls' ? [n] : []), ...n.getChildren(ast).flatMap(collect)]
  const mounts = collect(ast); assert.equal(mounts.length, 2)
  for (const [index, node] of mounts.entries()) {
    const compiled = transformSync(`const mount = (${node.getText(ast)});`, { loader: 'tsx', jsxFactory: 'jsx', jsxFragment: 'Fragment' }).code
    const make = new Function('env', `with(env){${compiled};return mount}`)
    const element = make({ jsx, PaginationControls: 'PaginationControls', salesPage: 4, salesPageSize: 20, totalSalesCount: null, currentSalesPageItems: 20,
      setSalesPage() {}, setSalesPageSize() {}, t: (key: string) => key })
    const h = harness(element.props); h.commit()
    assert.equal(input(h).props.value, '4', `Sales mount${index + 1}`); assert.deepEqual(h.calls, []); assert.ok(text(h.tree).includes('61-80')); assert.ok(text(h.tree).includes('/ —'))
  }
})
if (failures) process.exitCode = 1
