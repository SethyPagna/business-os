// The POS summary after a close: Opened with -> Additional change used -> Counted
// at close, ALWAYS all three (owner, 13 Oct 2026, item 14: the shift cash lines are
// shown everywhere, always, $0 included).
//
// A summary that left the middle line out when nothing was added would show the
// cashier who had just ended a shift that never needed more change Opened with and
// Counted at close with a gap between them. This test RUNS the real EndShiftButton:
// it presses End, presses End again to write the close, and reads the fact strip the
// summary renders once the server's row comes back. Only the shell is stubbed (hooks, app context,
// the modal frame, the form fields, the transport); the rule that decides the rows
// (shiftReportModel.ts) and the component's own flow are the real code.
//
// Run: node tests/shiftCloseSummaryAdditional.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = path.dirname(fileURLToPath(import.meta.url))
const gateSource = fs.readFileSync(path.join(here, '..', 'src', 'components', 'pos', 'ShiftGate.tsx'), 'utf8')

type RenderNode = { type: unknown; props: Record<string, any> }
globalThis.window = Object.assign(new EventTarget(), {
  setInterval: () => 1, clearInterval: () => {},
  localStorage: undefined, sessionStorage: undefined,
}) as unknown as Window & typeof globalThis
const transportModule = await import('../src/api/shiftTransport.ts')
const model = await import('../src/components/shifts/shiftReportModel.ts')

const OPENED_AT = '2026-10-13T01:07:00.000Z'
const CLOSED_AT = '2026-10-13T11:30:00.000Z'
const currentShift = {
  shift: { id: 71, revision: 3, shift_code: 'S-20261013-0807-Za', opened_at: OPENED_AT, opening_float_usd: 10, opening_float_khr: 10000, capabilities: { can_close: true } },
  is_open: true, needs_registration: false, can_end: true,
}
const closedRow = (additional: { usd?: number; khr?: number }): Record<string, unknown> => ({
  id: 71, revision: 4, shift_code: 'S-20261013-0807-Za', opened_at: OPENED_AT, closed_at: CLOSED_AT,
  opening_float_usd: 10, opening_float_khr: 10000,
  ...(additional.usd === undefined ? {} : { additional_cash_usd: additional.usd }),
  ...(additional.khr === undefined ? {} : { additional_cash_khr: additional.khr }),
  closing_counted_usd: 120, closing_counted_khr: 50000, closing_note: null,
  capabilities: { can_close: false },
})

/** Press End, press End again, and return the facts the summary strip shows, label -> value, in order. */
async function summaryFacts(closed: Record<string, unknown>): Promise<Array<[string, string]>> {
  const slots: any[] = []
  let cursor = 0
  const effectQueue: Array<() => void> = []
  const hooks = {
    useState(initial: any) {
      const slot = cursor++
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial
      return [slots[slot], (value: any) => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value }]
    },
    useEffect(effect: () => void, deps: any[]) {
      const slot = cursor++
      if (!slots[slot] || deps.some((value, i) => !Object.is(value, slots[slot].deps[i]))) {
        effectQueue.push(() => { slots[slot]?.cleanup?.(); slots[slot] = { deps, cleanup: effect() } })
      }
    },
    useCallback(callback: any, deps: any[]) {
      const slot = cursor++
      if (!slots[slot] || deps.some((value, i) => !Object.is(value, slots[slot].deps[i]))) slots[slot] = { callback, deps }
      return slots[slot].callback
    },
    useRef(initial: any) { const slot = cursor++; return slots[slot] ||= { current: initial } },
  }
  const SubmitMarker = () => null
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props })
  const compiled = ts.transpileModule(gateSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module: any = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (name === 'react') return hooks
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' }
    if (name.includes('actorReadScope')) return {
      actorReadStorageKey: (key: string) => key,
      captureActorReadScope: () => ({ scope: 'shifts' }),
      isActorReadScopeCurrent: () => true,
    }
    if (name.includes('permissions')) return { isAdminControlUser: () => false }
    if (name.includes('shared/Modal')) return { default: () => null }
    if (name.includes('AppContext')) return {
      useApp: () => ({
        t: (key: string) => key, notify: () => {}, user: { id: 4 }, settings: {},
        fmtUSD: (value: unknown) => `$${Number(value).toFixed(2)}`,
        fmtKHR: (value: unknown) => `${Math.round(Number(value)).toLocaleString('en-US')}៛`,
      }),
    }
    if (name.includes('formatters')) return { fmtDate: String, fmtDateTime24: String, parseServerTimestampMs: Date.parse }
    if (name.includes('ShiftCountFields')) return { default: () => null, ShiftSubmitRow: SubmitMarker, shiftCountBlockerKey: (key: string) => key }
    if (name.includes('shiftReportModel')) return model
    if (name.includes('shiftTransport')) return {
      ...transportModule,
      fetchCurrentShift: async () => currentShift,
      pendingShiftMutation: () => null,
      closeShift: async () => ({ shift: closed, already_closed: false }),
    }
    return { default: () => null }
  }, module, module.exports)

  const render = () => {
    cursor = 0
    const tree = module.exports.EndShiftButton({ branchId: 1 })
    effectQueue.splice(0).forEach((effect) => effect())
    return tree
  }
  const nodes = (tree: any): RenderNode[] => {
    if (Array.isArray(tree)) return tree.flatMap(nodes)
    if (!tree || typeof tree !== 'object') return []
    return [tree, ...nodes(tree.props?.children)]
  }
  module.exports.publishShift(module.exports.shiftCacheKey(4, 1, 'per_account'), currentShift)

  const endButton = nodes(render()).find((node) => node.type === 'button' && node.props.children === 'shift_end')
  assert.ok(endButton, 'the header offers End shift')
  endButton!.props.onClick()
  const submit = nodes(render()).find((node) => node.type === SubmitMarker)
  assert.ok(submit, 'the close form offers the End button that writes')
  submit!.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const found = nodes(render())
  return found
    .filter((node) => typeof node.type === 'function' && node.type.name === 'ShiftFactStrip')
    .flatMap((node) => (node.props.facts as any[]) || [])
    .filter(Boolean)
    .map((fact: any): [string, string] => [fact.label, fact.value])
}

let checks = 0
const ok = (cond: unknown, message: string) => { assert.ok(cond, message); checks += 1; console.log(`  ok - ${message}`) }

// ---- nothing added: the row is there, as a measured zero -------------------------
for (const [name, additional] of [
  ['both columns stored as 0', { usd: 0, khr: 0 }],
  ['a response that does not carry the columns at all', {}],
] as const) {
  const facts = await summaryFacts(closedRow(additional))
  assert.deepEqual(facts.map(([label]) => label), [
    'shift_code', 'shift_opened_at', 'shift_closed_at', 'shift_duration',
    'shift_opened_with', 'shift_recon_additional_cash', 'shift_counted_close',
  ], `${name}: the summary reads Opened with -> Additional change used -> Counted at close\n${JSON.stringify(facts)}`)
  const value = Object.fromEntries(facts)
  assert.equal(value.shift_opened_with, '$10.00 · 10,000៛')
  assert.equal(value.shift_recon_additional_cash, '$0.00 · 0៛', `${name}: a zero, with no (+) because nothing was added`)
  assert.equal(value.shift_counted_close, '$120.00 · 50,000៛')
  ok(true, `close summary with ${name}: the Additional change used row is there and reads $0.00 · 0៛`)
}

// ---- something added: unchanged, its own figures and the (+) of an inflow -----------
{
  const facts = Object.fromEntries(await summaryFacts(closedRow({ usd: 12.5, khr: 8000 })))
  assert.equal(facts.shift_recon_additional_cash, '+ $12.50 · 8,000៛')
  const khrOnly = Object.fromEntries(await summaryFacts(closedRow({ usd: 0, khr: 20000 })))
  assert.equal(khrOnly.shift_recon_additional_cash, '+ $0.00 · 20,000៛', 'one currency is enough for the (+)')
  ok(true, 'close summary with an amount keeps its (+) and its own figures per currency')
}

// ---- the gate does not keep a rule of its own -------------------------------------
ok(/closedAdditional = closed \? shiftAdditionalCash\(closed\)/.test(gateSource), 'the summary reads the shared rule (shiftAdditionalCash)')
ok(!/Only when some was actually put in/.test(gateSource), 'the retired "only when some was added" comment is gone')

console.log(`\nshiftCloseSummaryAdditional.test.ts: ${checks} checks passed`)
