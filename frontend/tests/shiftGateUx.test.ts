// a2 shiftux -- the shift register/close forms never block silently.
//
// Owner, 2026-09-06: "it seems the shift is not working, it did not allow to
// continue, i can enter numbers but it did not allow to continue when save"
// -> "I found the reason. i had to enter the usd as well as khmer riel".
//
// The Start/End button was `disabled` until BOTH currency counts parsed, and
// nothing on screen said so. A drawer that holds only dollars, or only riel,
// is a normal drawer. So:
//
//   1. A blank count field means unknown and is SENT as null. An explicit 0
//      remains a measured zero.
//   2. The primary action is enabled with either or both fields blank. Invalid
//      non-blank input is explained next to the button.
//   3. Both packs carry the "0" placeholder hint and the two reasons.
//   4. Every sibling with the same two-currency count pattern (the Shifts
//      popup's amend / close / reopen forms) uses the same shared fields.
//   5. None of this touches the daily prompt: the register modal is still
//      driven by needs_registration and still cannot be dismissed.
//
// Run: node tests/shiftGateUx.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { openShift, shiftCountPairBlocker, shiftOpeningCounts } from '../src/api/shiftTransport.ts'
import {
  __resetApiHealthForTests,
  __resetApiWriteDedupeForTests,
  getSyncServerUrl,
  setSyncServerUrl,
} from '../src/api/http.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (p: string) => fs.readFileSync(path.join(here, '..', p), 'utf8')

const gate = read('src/components/pos/ShiftGate.tsx')
const modal = read('src/components/shifts/ShiftHistoryModal.tsx')
const fields = read('src/components/shifts/ShiftCountFields.tsx')
const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>

let checks = 0
const ok = (cond: unknown, label: string) => {
  assert.ok(cond, label)
  checks += 1
  console.log(`  ok - ${label}`)
}

// ---- 1. Blank is unknown; explicit zero remains measured ------------------
assert.deepEqual(shiftOpeningCounts('', ''), { usd: null, khr: null })
assert.deepEqual(shiftOpeningCounts('   ', '0'), { usd: null, khr: 0 })
assert.deepEqual(shiftOpeningCounts('12.50', '4000'), { usd: 12.5, khr: 4000 })
assert.deepEqual(shiftOpeningCounts('-1', 'abc'), { usd: null, khr: null })
checks += 4
console.log('  ok - blank and explicit zero remain distinct; invalid values are rejected')

// ---- 2. The blocker names the reason, and there is none once EITHER field has a value
assert.equal(shiftCountPairBlocker('', ''), 'both_blank')
assert.equal(shiftCountPairBlocker('  ', ''), 'both_blank')
assert.equal(shiftCountPairBlocker('', '', { blankMeansUncounted: true }), null)
assert.equal(shiftCountPairBlocker('5', '', { blankMeansUncounted: true }), null, 'USD alone is enough')
assert.equal(shiftCountPairBlocker('', '20000', { blankMeansUncounted: true }), null, 'KHR alone is enough')
assert.equal(shiftCountPairBlocker('0', '', { blankMeansUncounted: true }), null, 'an explicit 0 is a value')
assert.equal(shiftCountPairBlocker('5', '20000'), null)
assert.equal(shiftCountPairBlocker('-1', '', { blankMeansUncounted: true }), 'invalid')
assert.equal(shiftCountPairBlocker('5', 'abc', { blankMeansUncounted: true }), 'invalid')
assert.equal(shiftCountPairBlocker('', '-100', { blankMeansUncounted: true }), 'invalid')
checks += 9
console.log('  ok - optional registration allows blanks, while required pairs still name both_blank / invalid')

// ---- 3. No primary action is disabled on "both counts non-null" -------------
const bothNullDisabled = /disabled=\{[^}\n]*parseShiftCount\([^)]*\) == null[^}\n]*\|\|[^}\n]*parseShiftCount\([^)]*\) == null/
ok(!bothNullDisabled.test(gate), 'ShiftGate has no button disabled on both counts being non-null')
ok(!bothNullDisabled.test(modal), 'ShiftHistoryModal has no button disabled on both counts being non-null')
ok(!/parseShiftCount\(/.test(gate), 'ShiftGate no longer treats a blank count as unparseable')
ok(/shiftClosingCounts\(edit\.closingUsd, edit\.closingKhr\)/.test(modal),
  'ShiftHistoryModal uses the shared independent parser for closing counts')

// ---- 4. Opening and closing blanks remain independently unknown ------------
const registerBody = gate.slice(gate.indexOf('const submitOpen'), gate.indexOf('const needsRegistration'))
ok(/shiftOpeningCounts\(floatUsd, floatKhr\)/.test(registerBody),
  'the register step uses the shared nullable opening parser')
const closeBody = gate.slice(gate.indexOf('const submitClose'), gate.indexOf('const dismiss'))
ok(/const counts = shiftClosingCounts\(countedUsd, countedKhr\)/.test(closeBody),
  'the POS close step preserves two blanks as an unknown report count')
ok(modal.includes('shiftOpeningCounts(edit.openingUsd, edit.openingKhr)'), 'the Shifts popup preserves nullable opening counts when amending')
ok(modal.includes('shiftOpeningCounts(reopen.openingUsd, reopen.openingKhr)'), 'the Shifts popup preserves nullable opening counts when reopening')
ok(modal.includes('shiftClosingCounts(edit.closingUsd, edit.closingKhr)'), 'the Shifts popup applies the shared close-count rule when amending')
ok(modal.includes('shiftClosingCounts(close.closingUsd, close.closingKhr)'), 'the Shifts popup applies the shared close-count rule when closing')
ok(!/Number\((?:float|counted|edit|close|reopen)[^)]+\) \|\| 0/.test(gate + modal),
  'no surface coerces a blank or invalid count to 0')

// Executed: an opening blank travels through the transport as null.
const originalFetch = globalThis.fetch
const originalServerUrl = getSyncServerUrl()
const posted: Array<{ url: string; body: Record<string, unknown> }> = []
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  posted.push({ url: String(input), body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown> })
  return new Response(JSON.stringify({
    shift: null, policy: { scope_mode: 'per_account', admin_exempt: true },
    exempt: false, needs_registration: false, is_open: true, can_end: true,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}) as typeof fetch
try {
  __resetApiHealthForTests()
  __resetApiWriteDedupeForTests()
  setSyncServerUrl('https://sync.example.test')
  const opening = shiftOpeningCounts('50', '')
  await openShift({ branchId: 2, branchName: 'shop', openingFloatUsd: opening.usd, openingFloatKhr: opening.khr })
  assert.equal(posted[posted.length - 1].body.opening_float_usd, 50)
  assert.equal(posted[posted.length - 1].body.opening_float_khr, null)
  checks += 2
  console.log('  ok - opening posts the blank side as null and the typed side untouched')
} finally {
  globalThis.fetch = originalFetch
  setSyncServerUrl(originalServerUrl)
  __resetApiHealthForTests()
  __resetApiWriteDedupeForTests()
}

// ---- 5. One shared pair of count fields, with the "0" placeholder and hint --
ok(/export default function ShiftCountPair\(/.test(fields) || /export function ShiftCountPair\(/.test(fields),
  'the two-currency count pair is one shared component')
ok((fields.match(/placeholder="0"/g) || []).length >= 2, 'both count inputs show 0 as the placeholder')
ok(/t\('shift_blank_count_hint'\)/.test(fields), 'the shared pair carries the one-line blank/zero hint')
ok((gate.match(/hint=\{t\('shift_registered_cash_hint'\)\}/g) || []).length >= 1
  && (modal.match(/hint=\{t\('shift_registered_cash_hint'\)\}/g) || []).length >= 2,
  'close forms explain that registered counts are report-only')
ok(/export function ShiftSubmitRow\(/.test(fields), 'the reason-next-to-button footer is shared too')
const submitRow = fields.slice(fields.indexOf('export function ShiftSubmitRow('))
ok(/shift_count_needed/.test(fields) && /shift_count_invalid/.test(fields), 'the two blockers are translated through the pack')
ok(/reason[\s\S]{0,600}<button/.test(submitRow), 'the reason is rendered in the same row as the button, before it')
ok(/<ShiftCountPair\b/.test(gate) && (gate.match(/<ShiftCountPair\b/g) || []).length >= 2,
  'ShiftGate renders the shared pair on both the register and the close step')
ok((modal.match(/<ShiftCountPair\b/g) || []).length >= 4,
  'the Shifts popup renders the shared pair for amend (opening + closing), close and reopen')
ok((gate.match(/<ShiftSubmitRow\b/g) || []).length >= 2, 'both POS steps use the shared submit row')
ok((modal.match(/<ShiftSubmitRow\b/g) || []).length >= 3, 'amend, close and reopen use the shared submit row')

// ---- 6. Both packs ----------------------------------------------------------
for (const key of ['shift_blank_count_hint', 'shift_count_needed', 'shift_count_invalid', 'shift_drawer_total_typed', 'shift_add_note']) {
  ok(typeof en[key] === 'string' && en[key].trim().length > 0, `en.json has ${key}`)
  ok(typeof km[key] === 'string' && km[key].trim().length > 0 && /[ក-៿]/.test(km[key]), `km.json has ${key} in Khmer script`)
}
ok(/\b0\b/.test(en.shift_blank_count_hint) && /0/.test(km.shift_blank_count_hint), 'the hint literally names 0 in both packs')

// ---- 7. The daily prompt is untouched -------------------------------------
ok(/const needsRegistration = state\?\.needs_registration === true/.test(gate),
  'the register step is still driven by the server\'s needs_registration')
ok(/\{needsRegistration && \(\s*<Modal/.test(gate), 'needs_registration still renders the register modal')
ok(/onClose=\{\(\) => \{ \/\* intentionally not dismissible/.test(gate), 'the register modal still cannot be dismissed')
ok(/t\('shift_register_hint'\)/.test(gate), 'the register modal still explains itself')
ok(!/needsRegistration && !dismissed|needsRegistration && !snoozed|localStorage[^\n]*shift_register/.test(gate),
  'no dismiss / snooze / remembered flag was introduced')

// Execute the actual POS component callbacks with a hook renderer. This
// covers state transitions, without claiming CSS or physical-device proof.
type RenderNode = { type: unknown; props: Record<string, any> }
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
    if (!slots[slot] || deps.some((value, i) => !Object.is(value, slots[slot][i]))) { slots[slot] = deps; effectQueue.push(effect) }
  },
  useCallback(callback: any, deps: any[]) {
    const slot = cursor++
    if (!slots[slot] || deps.some((value, i) => !Object.is(value, slots[slot].deps[i]))) slots[slot] = { callback, deps }
    return slots[slot].callback
  },
  useRef(initial: any) { const slot = cursor++; return slots[slot] ||= { current: initial } },
}
const ModalMarker = () => null
const SubmitMarker = () => null
let currentShift: any = { shift: { id: 71, revision: 3, opened_at: '2026-09-05T01:00:00.000Z', capabilities: { can_close: true } }, is_open: true }
let resolveClose: (value: any) => void = () => {}
let submitted: any
const oldWindow = globalThis.window
globalThis.window = Object.assign(new EventTarget(), { setInterval: () => 1, clearInterval: () => {}, sessionStorage: { getItem: () => null } }) as unknown as Window & typeof globalThis
const jsx = (type: unknown, props: Record<string, any>) => ({ type, props })
const compiled = ts.transpileModule(gate, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
const gateModule: any = { exports: {} }
new Function('require', 'module', 'exports', compiled)((name: string) => {
  if (name === 'react') return hooks
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' }
  if (name.includes('shared/Modal')) return { default: ModalMarker }
  if (name.includes('AppContext')) return { useApp: () => ({ t: (key: string) => key, notify: () => {}, user: { id: 4 }, settings: {}, fmtUSD: String, fmtKHR: String }) }
  if (name.includes('formatters')) return { fmtDateTime24: String, parseServerTimestampMs: Date.parse }
  if (name.includes('shiftTransport')) return { fetchCurrentShift: async () => currentShift, pendingShiftMutation: () => null,
    shiftClosingCounts: (usd: string, khr: string) => ({ usd: usd === '' ? null : Number(usd), khr: khr === '' ? null : Number(khr) }),
    closeShift: (input: any) => { submitted = input; return new Promise((resolve) => { resolveClose = resolve }) } }
  if (name.includes('ShiftCountFields')) return { default: () => null, ShiftSubmitRow: SubmitMarker }
  if (name.includes('shiftReportModel')) return { shiftCountedPairText: () => '—' }
  return { default: () => null }
}, gateModule, gateModule.exports)
const render = () => {
  cursor = 0
  const tree = gateModule.exports.EndShiftButton({ branchId: 1 })
  effectQueue.splice(0).forEach((effect) => effect())
  return tree
}
function nodes(tree: any): RenderNode[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...nodes(tree.props?.children)]
}
try {
  gateModule.exports.publishShift('4:1:per_account', currentShift)
  let tree = render()
  nodes(tree).find((node) => node.type === 'button')!.props.onClick()
  tree = render()
  assert.equal(nodes(tree).find((node) => node.type === ModalMarker)!.props.closeDisabled, false)
  nodes(tree).find((node) => node.type === SubmitMarker)!.props.onClick()
  tree = render()
  const busyModal = nodes(tree).find((node) => node.type === ModalMarker)!
  assert.equal(busyModal.props.closeDisabled, true, 'X/Escape/discard are guarded while close is in flight')
  busyModal.props.onClose()
  assert.ok(nodes(render()).some((node) => node.type === ModalMarker), 'direct dismiss cannot discard the in-flight panel')
  assert.equal(submitted.shiftId, 71)
  assert.equal(submitted.expectedRevision, 3)
  currentShift = { shift: { id: 72, revision: 0, opened_at: '2026-09-05T09:00:00.000Z', capabilities: { can_close: true } }, is_open: true }
  resolveClose({ shift: { id: 71, closed_at: '2026-09-05T09:00:00.000Z' } })
  await Promise.resolve(); await Promise.resolve()
  tree = render()
  const summary = nodes(tree).find((node) => node.type === ModalMarker)!
  assert.equal(summary.props.title, 'shift_summary_title')
  assert.equal(summary.props.closeDisabled, false)
  summary.props.onClose()
  assert.equal(nodes(render()).some((node) => node.type === ModalMarker), false, 'successful summary dismisses cleanly')
  checks += 8
  slots.length = 0
  effectQueue.length = 0
  const actualTransport = await import('../src/api/shiftTransport.ts')
  const historyShift: any = { ...currentShift.shift, id: 81, revision: 2, business_date: '2026-09-05', shift_code: 'SHIFT-81',
    opened_at: '2026-09-05T01:00:00.000Z', closed_at: null, capabilities: { can_edit: true, can_close: true, can_cancel: true } }
  let historyResult = historyShift
  let resolveHistoryClose: (value: any) => void = () => {}
  const historyModule: any = { exports: {} }
  const compiledHistory = ts.transpileModule(modal, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'module', 'exports', compiledHistory)((name: string) => {
    if (name === 'react') return hooks
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' }
    if (name.includes('shared/Modal')) return { default: ModalMarker }
    if (name.includes('AppContext')) return { useApp: () => ({ t: (key: string) => key, user: { id: 4 } }) }
    if (name.includes('constants')) return { BUSINESS_TIME_ZONE: 'Asia/Phnom_Penh' }
    if (name.includes('formatters')) return { fmtDateOnly: String }
    if (name.includes('shiftTransport')) return { ...actualTransport, pendingShiftMutation: () => null,
      listShifts: async () => ({ shifts: [historyShift], scope: 'own' }), fetchShiftHistory: async () => ({ shift: historyResult, amendments: [] }),
      closeShiftById: () => new Promise((resolve) => { resolveHistoryClose = resolve }) }
    if (name.includes('ShiftCountFields')) return { default: () => null, ShiftSubmitRow: SubmitMarker }
    return { default: () => null }
  }, historyModule, historyModule.exports)
  const renderHistory = () => {
    cursor = 0
    const tree = historyModule.exports.default({ branchId: 1 })
    effectQueue.splice(0).forEach((effect) => effect())
    return tree
  }
  tree = renderHistory()
  nodes(tree).find((node) => node.type === 'button')!.props.onClick()
  renderHistory(); await Promise.resolve()
  tree = renderHistory()
  nodes(tree).find((node) => node.type === 'button' && node.props.children?.props?.shift)!.props.onClick()
  await Promise.resolve()
  tree = renderHistory()
  nodes(tree).find((node) => node.type === 'button' && node.props.children === 'shift_action_close')!.props.onClick()
  tree = renderHistory()
  nodes(tree).find((node) => node.type === SubmitMarker)!.props.onClick()
  tree = renderHistory()
  const historyBusy = nodes(tree).find((node) => node.type === ModalMarker)!
  assert.equal(historyBusy.props.closeDisabled, true)
  historyBusy.props.onClose()
  assert.ok(nodes(renderHistory()).some((node) => node.type === ModalMarker))
  const backButton = nodes(tree).find((node) => node.type === 'button' && Array.isArray(node.props.children) && node.props.children.includes('back'))!
  assert.equal(backButton.props.disabled, true, 'history Back cannot leave the in-flight action')
  assert.ok(nodes(tree).filter((node) => node.type === 'fieldset').every((node) => node.props.disabled), 'all submitted fields are frozen')
  historyResult = { ...historyShift, closed_at: '2026-09-05T09:00:00.000Z', revision: 3 }
  resolveHistoryClose({ shift: historyResult })
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  tree = renderHistory()
  assert.equal(nodes(tree).find((node) => node.type === ModalMarker)!.props.closeDisabled, false)
  assert.equal(nodes(tree).some((node) => node.type === SubmitMarker), false, 'committed history close exits the draft')
  checks += 6
} finally { globalThis.window = oldWindow }
console.log(`\nshiftGateUx: all ${checks} checks passed`)
