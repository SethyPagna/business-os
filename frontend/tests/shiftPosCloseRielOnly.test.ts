// The POS close form and summary on a RIEL-ONLY shift (owner A72 + Q3, A78): riel first, and a "$" only when the SHIFT has a dollar figure.
//
// The other close-summary test (shiftCloseSummaryAdditional) opens with $10 and counts $120, so it is always a dollar shift and cannot tell
// "dollars per shift" from "dollars always". This test RUNS the real EndShiftButton on shifts with no dollar anywhere, presses End (the form),
// types in the counted-dollars box, presses End again (the summary), and reads the fact strips the component renders:
//   * riel-only shift, form and summary: no value carries a "$", every pair is the riel alone;
//   * a dollar typed into the counted-dollars box makes the form a dollar shift on every pair (typed, not yet written);
//   * a $5 closing count makes the summary a dollar shift on every pair, riel first;
//   * an opening float with dollars makes the form a dollar shift from first paint.
// Fails on the mutant `const showUsd = true` in ShiftGate.tsx, which prints "10,000៛ · $0.00" on a riel-only shift.
//
// Run: node tests/shiftPosCloseRielOnly.test.ts
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
const shiftCountRules = await import('../src/components/shifts/shiftCountRules.ts')
const shiftLateClose = await import('../src/components/shifts/shiftLateClose.ts')
const model = await import('../src/components/shifts/shiftReportModel.ts')

const OPENED_AT = '2026-11-25T01:07:00.000Z'
const CLOSED_AT = '2026-11-25T11:30:00.000Z'
type Pair = { usd: number; khr: number }
const currentShiftOf = (opening: Pair) => ({
  shift: { id: 71, revision: 3, shift_code: 'S-20261125-0807-Za', opened_at: OPENED_AT, opening_float_usd: opening.usd, opening_float_khr: opening.khr, capabilities: { can_close: true } },
  is_open: true, needs_registration: false, can_end: true,
})
const closedRowOf = (opening: Pair, counted: Pair): Record<string, unknown> => ({
  id: 71, revision: 4, shift_code: 'S-20261125-0807-Za', opened_at: OPENED_AT, closed_at: CLOSED_AT,
  opening_float_usd: opening.usd, opening_float_khr: opening.khr, additional_cash_usd: 0, additional_cash_khr: 0,
  closing_counted_usd: counted.usd, closing_counted_khr: counted.khr, closing_note: null,
  capabilities: { can_close: false },
})

type Facts = Array<[string, string]>
type Run = { form: Facts; typed: Facts; summary: Facts }

/** Press End (the form), optionally type a counted-dollars amount, press End again (the summary); the facts each step shows, label -> value. */
async function closeFlow(opening: Pair, counted: Pair, typedCountedUsd = ''): Promise<Run> {
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
  const currentShift = currentShiftOf(opening)
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
    if (name.includes('ShiftCountFields')) return { default: () => null, ShiftSubmitRow: SubmitMarker, shiftCashUsedLabels: (t: (key: string) => string) => ({ usdLabel: `${t('shift_additional_cash')}, ${t('shift_additional_usd')}`, khrLabel: `${t('shift_additional_cash')}, ${t('shift_additional_khr')}` }), shiftCountBlockerKey: (key: string) => key }
    if (name.includes('useSavingGate')) return { useSavingGate: () => ({ blocked: false, reason: '' }) }
    if (name.includes('shiftReportModel')) return model
    if (name.includes('shiftCountRules')) return shiftCountRules
    if (name.includes('shiftLateClose')) return shiftLateClose
    if (name.includes('shiftTransport')) return {
      ...transportModule,
      fetchCurrentShift: async () => currentShift,
      pendingShiftMutation: () => null,
      closeShift: async () => ({ shift: closedRowOf(opening, counted), already_closed: false }),
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
  const factsOf = (found: RenderNode[]): Facts => found
    .filter((node) => typeof node.type === 'function' && node.type.name === 'ShiftFactStrip')
    .flatMap((node) => (node.props.facts as any[]) || [])
    .filter(Boolean)
    .map((fact: any): [string, string] => [fact.label, fact.value])
  module.exports.publishShift(module.exports.shiftCacheKey(4, 1, 'per_account'), currentShift)

  const endButton = nodes(render()).find((node) => node.type === 'button' && node.props.children === 'shift_end')
  assert.ok(endButton, 'the header offers End shift')
  endButton!.props.onClick()
  const form = factsOf(nodes(render()))
  let typed: Facts = []
  if (typedCountedUsd) {
    const usdBox = nodes(render()).find((node) => typeof node.props.onUsd === 'function' && node.props.usdLabel === 'shift_counted_usd')
    assert.ok(usdBox, 'the close form offers the counted-dollars box')
    usdBox!.props.onUsd(typedCountedUsd)
    typed = factsOf(nodes(render()))
  }
  const submit = nodes(render()).find((node) => node.type === SubmitMarker)
  assert.ok(submit, 'the close form offers the End button that writes')
  submit!.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  return { form, typed, summary: factsOf(nodes(render())) }
}

let checks = 0
const ok = (cond: unknown, message: string) => { assert.ok(cond, message); checks += 1; console.log(`  ok - ${message}`) }
const MONEY = ['shift_opened_with', 'shift_recon_additional_cash', 'shift_counted_close']
const pairsOf = (facts: Facts) => facts.filter(([label]) => MONEY.includes(label))
const valueOf = (facts: Facts, label: string) => Object.fromEntries(facts)[label]

// ---- a riel-only shift: no "$" on the form, none on the summary ------------------------------------------------------------------
{
  const run = await closeFlow({ usd: 0, khr: 10000 }, { usd: 0, khr: 50000 })
  assert.equal(valueOf(run.form, 'shift_opened_with'), '10,000៛', JSON.stringify(run.form))
  ok(pairsOf(run.form).length === 1 && !JSON.stringify(run.form).includes('$'), 'riel-only shift, close form: Opened with is the riel alone and no value carries a "$"')
  assert.deepEqual(pairsOf(run.summary).map(([label]) => label), MONEY, JSON.stringify(run.summary))
  assert.equal(valueOf(run.summary, 'shift_opened_with'), '10,000៛')
  assert.equal(valueOf(run.summary, 'shift_recon_additional_cash'), '0៛')
  assert.equal(valueOf(run.summary, 'shift_counted_close'), '50,000៛')
  ok(!JSON.stringify(run.summary).includes('$'), 'riel-only shift, close summary: Opened with, Additional change used and Counted at close read the riel alone, no "$"')
}

// ---- a dollar typed into the counted box makes the form a dollar shift on every pair, riel first -----------------------------------
{
  const run = await closeFlow({ usd: 0, khr: 10000 }, { usd: 5, khr: 50000 }, '5')
  assert.equal(valueOf(run.typed, 'shift_opened_with'), '10,000៛ · $0.00', JSON.stringify(run.typed))
  ok(run.typed.every(([, value]) => !/^[+−]?\$/.test(value)), 'a typed dollar amount: the form prints Opened with riel first, then the dollar half')
}

// ---- a $5 closing count makes the summary a dollar shift on every pair ---------------------------------------------------------------
{
  const run = await closeFlow({ usd: 0, khr: 10000 }, { usd: 5, khr: 50000 })
  assert.equal(valueOf(run.summary, 'shift_opened_with'), '10,000៛ · $0.00', JSON.stringify(run.summary))
  assert.equal(valueOf(run.summary, 'shift_recon_additional_cash'), '0៛ · $0.00')
  assert.equal(valueOf(run.summary, 'shift_counted_close'), '50,000៛ · $5.00')
  ok(true, 'a $5 closing count: the summary is a dollar shift, riel first, on every pair')
}

// ---- an opening float with dollars: a dollar shift from first paint -------------------------------------------------------------------
{
  const run = await closeFlow({ usd: 10, khr: 10000 }, { usd: 0, khr: 50000 })
  assert.equal(valueOf(run.form, 'shift_opened_with'), '10,000៛ · $10.00', JSON.stringify(run.form))
  assert.equal(valueOf(run.summary, 'shift_counted_close'), '50,000៛ · $0.00', JSON.stringify(run.summary))
  ok(true, 'an opening float with dollars: the form and the summary both carry the dollar half, riel first')
}

console.log(`\nshiftPosCloseRielOnly.test.ts: ${checks} checks passed`)
