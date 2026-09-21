// The Shifts popup's CLOSE form, on a row that is still open.
//
// The defect (D12): ShiftHistoryModal's `blankClose` seeded `closedAt` from
// `new Date()`, and the form posts to the same POST /shifts/:id/close the POS
// carry-over close uses. That route refuses a closing time later than the
// opening of the segment that FOLLOWS the row -- 409 "Closing time overlaps
// the next shift segment." -- so for every drawer left open on an earlier day
// once today had been registered, the DEFAULT press was refused, and nothing
// on screen said which minute would be taken. With nothing opened after the
// row the very same press succeeded, which is why it survived so long.
//
// The fix: the Worker states the bound on the row (`close_before`, from its
// own interval helper -- cloudflare/scripts/test-shift-list-close-bound-pure.cjs
// pins that half), and this form seeds through the ONE rule the POS form
// already used, `carryOverCloseSeedMs` in api/shiftTransport.ts.
//
// Both rules are RENDERED here, not grepped: the real component is compiled
// and driven -- open the popup, pick the row, press Close -- and the form it
// opens is read back. Each assertion carries its negative control:
//
//   1. the prefill of an open row is a minute before the STATED bound, and a
//      copy of the source that seeds from the bare clock must fail that same
//      check;
//   2. the bound is SHOWN on the form, so the prefilled minute is a number the
//      operator can check, and a copy that renders it unconditionally must
//      fail the "only when stated" check;
//   3. a row with no bound stated still opens on the current minute -- only
//      the clock bounds a close then.
//
// Run: node tests/shiftModalCloseBound.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (p: string) => fs.readFileSync(path.join(here, '..', p), 'utf8')
const modalSource = read('src/components/shifts/ShiftHistoryModal.tsx')

let checks = 0
const ok = (value: unknown, message: string) => { assert.ok(value, message); checks += 1 }
const eq = (actual: unknown, expected: unknown, message: string) => { assert.equal(actual, expected, message); checks += 1 }

// A browser shell the component can mount against: it listens for the shift
// refresh events and reads the operational branch out of session storage.
const oldWindow = globalThis.window
globalThis.window = Object.assign(new EventTarget(), {
  setInterval: () => 1, clearInterval: () => {},
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
}) as unknown as Window & typeof globalThis
const transportModule = await import('../src/api/shiftTransport.ts')
const formatters = await import('../src/utils/formatters.ts')

// One account, one branch: a drawer left open on an earlier day, with today's
// shift already opened after it. That later opening IS the bound.
const OWN_OPENED_AT = '2026-09-20T01:00:00.000Z'
const BOUND = '2026-09-21T02:30:00.000Z'
const openRow = {
  id: 44, shift_code: 'S-20260920-0800-aa11bb', scope_mode: 'per_account', user_id: 7, user_name: 'sopheak',
  branch_id: 1, branch_name: 'Shop', business_date: '2026-09-20', opened_at: OWN_OPENED_AT,
  opening_float_usd: 20, opening_float_khr: 40_000, additional_cash_usd: 0, additional_cash_khr: 0,
  opening_note: null, closed_at: null, closing_counted_usd: null, closing_counted_khr: null, closing_note: null,
  closed_by_user_id: null, closed_by_user_name: null, revision: 0,
  cancelled_at: null, cancelled_by_user_id: null, cancelled_by_user_name: null, cancel_reason: null,
  parent_shift_id: null, reopen_reason: null, reopened_by_user_id: null, reopened_by_user_name: null,
  amendment_count: 0, close_before: BOUND,
  capabilities: { can_edit: true, can_close: true, can_reopen: false, can_cancel: false },
}

type RenderNode = { type: unknown; props: Record<string, any> }

/**
 * Compile the real modal, mount it with a minimal hook implementation, and
 * drive it the way the operator does: open the popup, open the row, press
 * Close. Returns what the close form actually shows.
 */
function openCloseForm(source: string, row: Record<string, unknown> = openRow, listRow: Record<string, unknown> = row) {
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
  const DateMarker = () => null
  const PairMarker = () => null
  const SubmitMarker = () => null
  const SummaryMarker = () => null
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props })
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module: any = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (name === 'react') return hooks
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' }
    if (name.includes('AppContext')) return { useApp: () => ({ t: (key: string) => key, notify: () => {}, user: { id: 7 }, fmtUSD: String, fmtKHR: String }) }
    if (name.includes('utils/formatters')) return formatters
    if (name.includes('shared/Modal')) return { default: () => null }
    if (name.includes('PaginationControls')) return { default: () => null, DEFAULT_PAGE_SIZE: 20 }
    if (name.includes('DateEntryInput')) return { DateTimeEntryInput: DateMarker }
    if (name.includes('ShiftSummary')) return { default: SummaryMarker }
    if (name.includes('ShiftCountFields')) return { default: PairMarker, ShiftSubmitRow: SubmitMarker, shiftCountBlockerKey: (key: string) => key }
    if (name.includes('pos/ShiftGate')) return { SHIFT_BRANCH_CHANGED_EVENT: 'shift-branch', SHIFT_STATE_CHANGED_EVENT: 'shift-state' }
    if (name.includes('shiftTransport')) return {
      ...transportModule,
      listShifts: async () => ({ shifts: [listRow], scope: 'all', page: 1, page_size: 20, total: 1 }),
      // The record read answers the same row -- which is the point: the popup
      // replaces `selected` with the detail response, so a surface that did
      // not carry the bound would drop it right here.
      fetchShiftHistory: async () => ({ shift: row, segments: [row], amendments: [] }),
      pendingShiftMutation: () => null,
    }
    return { default: () => null }
  }, module, module.exports)

  const render = () => {
    cursor = 0
    const tree = module.exports.default({ branchId: 1 })
    effectQueue.splice(0).forEach((effect) => effect())
    return tree
  }
  const nodes = (tree: any): RenderNode[] => {
    if (Array.isArray(tree)) return tree.flatMap(nodes)
    if (!tree || typeof tree !== 'object') return []
    return [tree, ...nodes(tree.props?.children)]
  }
  const text = (tree: any): string => {
    if (Array.isArray(tree)) return tree.map(text).join('')
    if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
    if (!tree || typeof tree !== 'object') return ''
    return text(tree.props?.children)
  }
  const settle = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() }

  return (async () => {
    let tree = render()
    const launcher = nodes(tree).find((node) => node.type === 'button' && node.props['aria-haspopup'] === 'dialog')
    assert.ok(launcher, 'the popup has a launcher button')
    launcher!.props.onClick()
    render()
    await settle()
    tree = render()
    const rowButton = nodes(tree).find((node) => node.type === 'button'
      && nodes(node.props.children).some((child) => child.type === SummaryMarker))
    assert.ok(rowButton, 'the list renders the shift row')
    rowButton!.props.onClick()
    await settle()
    tree = render()
    const closeAction = nodes(tree).find((node) => node.type === 'button' && text(node) === 'shift_action_close')
    assert.ok(closeAction, 'the selected open row offers the Close action')
    closeAction!.props.onClick()
    tree = render()
    const found = nodes(tree)
    const boundRow = found.find((node) => node.type === 'p' && text(node).includes('shift_previous_open_close_before'))
    return {
      closedAt: found.find((node) => node.type === DateMarker)?.props.value as string,
      boundText: boundRow ? text(boundRow) : null,
      submitLabel: found.find((node) => node.type === SubmitMarker)?.props.label as string,
    }
  })()
}

try {
  // ---- 1. the prefill is the latest moment the Worker will accept --------
  const form = await openCloseForm(modalSource)
  const expected = transportModule.shiftLocalDateTimeFromMs(Date.parse(BOUND) - 60_000)
  eq(form.closedAt, expected, 'the close form opens a minute before the bound the row states')
  assert.notEqual(form.closedAt, transportModule.shiftLocalDateTimeFromMs(Date.now()),
    'and NOT on the current minute, which is the value the Worker answered 409 for')
  checks += 1
  ok(Date.parse(transportModule.shiftLocalDateTimeToIso(form.closedAt)) < Date.parse(BOUND),
    'it is strictly before the bound, which is the whole interval rule')
  ok(Date.parse(transportModule.shiftLocalDateTimeToIso(form.closedAt)) >= Date.parse(OWN_OPENED_AT),
    "and not before the row's own opening, which is the 400 rule")
  console.log('  ok - executed: the open row prefills a minute before the stated bound')

  // The negative control: the same harness on a copy of the component that
  // seeds from the clock. If that produced the same moment, nothing above is
  // measuring the seed.
  const clockSeeded = modalSource.replace(
    'carryOverCloseSeedMs(shift.close_before, shift.opened_at, Date.now())', 'Date.now()')
  assert.notEqual(clockSeeded, modalSource, 'the seed negative control could not find its target')
  const clockForm = await openCloseForm(clockSeeded)
  assert.notEqual(clockForm.closedAt, expected,
    'NOT DISCRIMINATING -- seeding from the bare clock produced the same prefilled moment')
  checks += 1
  console.log('  ok - executed: seeding from the bare clock is caught by that same check')

  // ---- 2. the bound is shown beside it ----------------------------------
  ok(form.boundText, 'the close form shows the bound the prefill was computed from')
  ok(form.boundText!.includes(formatters.fmtDateTime24(BOUND)),
    "formatted by the shop's own date-time formatter, the same one the POS strip uses")
  console.log('  ok - executed: the bound is on the form, not only in the prefilled field')

  // ---- 3. no bound stated: the clock, and no bound row -------------------
  const before = Date.now()
  const unbounded = await openCloseForm(modalSource, { ...openRow, close_before: null })
  const after = Date.now()
  ok([before, after].map(transportModule.shiftLocalDateTimeFromMs).includes(unbounded.closedAt),
    'with no bound stated the form opens on the current minute -- only the clock bounds the close then')
  eq(unbounded.boundText, null, 'and shows no bound row rather than an empty one')

  // ...which is only worth asserting if a row that ALWAYS rendered would show.
  const alwaysShown = modalSource.replace('{selected.close_before ? <p', '{true ? <p')
  assert.notEqual(alwaysShown, modalSource, 'the bound-row negative control could not find its target')
  const leaking = await openCloseForm(alwaysShown, { ...openRow, close_before: null })
  assert.notEqual(leaking.boundText, null,
    'NOT DISCRIMINATING -- rendering the bound unconditionally still showed nothing')
  checks += 1
  console.log('  ok - executed: the bound row appears only when the server stated one')

  // ---- 4. the row the close is ADDRESSED to is the one it reads ----------
  //
  // Opening a list row replaces the selection with the record read's own row,
  // so the bound has to survive that hop -- a detail response that lost it
  // would seed the clock again even with a perfect list. Answered here from
  // the two reads with DIFFERENT values, so only one of them can be the source.
  const fromDetail = await openCloseForm(modalSource, openRow, { ...openRow, close_before: null })
  eq(fromDetail.closedAt, expected, 'the prefill follows the record read, which is the row the close is addressed to')
  ok(fromDetail.boundText, 'and the bound it shows comes from there too')
  console.log('  ok - executed: the bound survives the hop from list row to record read')
} finally {
  globalThis.window = oldWindow
}

console.log(`\nshiftModalCloseBound: all ${checks} checks passed`)
