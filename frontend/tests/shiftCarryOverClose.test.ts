// Closing a shift that was left OPEN on an earlier business day, from POS.
//
// The defect: the non-dismissible registration modal covers POS on the new
// day, and GET /api/shifts/current only ever described TODAY -- so an earlier
// drawer could not be closed from the till at all. The cashier's only options
// were to open a second shift on top of it, or to find an admin.
//
// The Worker now answers /current with one additive field,
// `previous_open_shift` (the OLDEST still-open earlier row first: a later
// segment cannot be closed while an earlier one is open), and this file pins
// the POS half of the contract:
//
//   1. `undefined` means "the server did not say" (an older Worker, or a
//      WRITE response, which never carries the field) and must render
//      nothing. Only `?? null` reads that way.
//   2. The carry-over close lives INSIDE the one non-dismissible registration
//      modal, as its first step -- not in a second overlay, and not behind a
//      control that would double as a way out of the daily prompt. Both of
//      its states (closable, and locked to another account) offer the step
//      switch, so neither traps the cashier on a shift they cannot close.
//   3. The carry-over close ALWAYS sends an explicit closed_at, because once
//      today's shift is open the Worker refuses a close stamped after that
//      opening ("Closing time overlaps the next shift segment.", 409). The
//      LIVE close still sends none -- that is the ae45e101 clock-skew fix, and
//      neither path may acquire the other's rule.
//   4. A write response cannot refill `previous_open_shift`, so every write
//      re-reads /current through SHIFT_STATE_CHANGED_EVENT.
//
// And, since the fold, the four rules the two copies of this form disagreed
// on while there were two of them:
//
//   5. ONE form: one closeShiftById call site, one closing-time field, one
//      component rendered by both entry points.
//   6. The prefill is min(now, today's opening - 60 s) whenever a later shift
//      exists. Seeded from the bare clock, the header's default press could
//      only ever 409.
//   7. Both entry points honour the pendingShiftMutation replay contract: an
//      unacknowledged close shows its own frozen body, offers Retry, and is
//      left to the shared unresolved banner rather than a red toast.
//   8. The header control is visibly a DIFFERENT action from End shift --
//      amber, and labelled with the day it closes. A touch till has no hover,
//      so a title attribute is not a distinction.
//
// Source-shape assertions, like the rest of the shift gate suite -- but every
// positive pin is DISCRIMINATING: it is re-run against a mutated copy of the
// same source held in a temp string, and the run fails if the mutant passes.
// A pin that cannot fail proves nothing about the code it claims to hold.
//
// Run: node tests/shiftCarryOverClose.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (p: string) => fs.readFileSync(path.join(here, '..', p), 'utf8')

const gate = read('src/components/pos/ShiftGate.tsx')
const transport = read('src/api/shiftTransport.ts')
const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>

/** The source between two markers, or '' when either marker is absent. */
function between(source: string, from: string, to: string): string {
  const start = source.indexOf(from)
  if (start < 0) return ''
  const end = source.indexOf(to, start + from.length)
  return end < 0 ? '' : source.slice(start, end)
}

// The regions the rules live in. Recomputed from whatever source is passed,
// so a mutant is sliced the same way the real file is.
const carrySeed = (g: string) => between(g, 'function carryOverCloseSeedMs', 'type CarryOverCloseForm')
const carryHook = (g: string) => between(g, 'function useCarryOverClose', 'function CarryOverIntro')
const carryFields = (g: string) => between(g, 'function CarryOverCloseFields', 'export default function ShiftGate')
const openSubmit = (g: string) => between(g, 'const submitOpen', 'const needsRegistration')
const closeSubmit = (g: string) => between(g, 'const submitClose', 'const dismiss')
const liveCloseCall = (g: string) => between(closeSubmit(g), 'await closeShift(', 'setPending(false)')
const carryOverStep = (g: string) => between(g, "registerStep === 'carry_over' && carryOver", "t('shift_register_hint')")
const carryOverPanel = (g: string) => between(g, '{open && carryTarget && (', '{open && !carryTarget && (')
const endBody = (g: string) => g.slice(g.indexOf('export function EndShiftButton'))

type Source = { gate: string; transport: string }
type Pin = {
  label: string
  holds: (source: Source) => boolean
  /** The smallest edit that breaks the rule. The pin MUST reject it. */
  mutate: (source: Source) => Source
}

/** Rewrite ONE region of the gate, failing loudly if the target text moved. */
function editRegion(source: Source, region: (g: string) => string, find: string, replace: string): Source {
  const slice = region(source.gate)
  assert.ok(slice.length > 100, 'the negative control could not locate its region in ShiftGate.tsx')
  assert.ok(slice.includes(find), `the negative control's target text is gone: ${find}`)
  return { ...source, gate: source.gate.replace(slice, slice.replace(find, replace)) }
}

/** Rewrite the first occurrence anywhere in the gate. */
function editGate(source: Source, find: string, replace: string): Source {
  assert.ok(source.gate.includes(find), `the negative control's target text is gone: ${find}`)
  return { ...source, gate: source.gate.replace(find, replace) }
}

const pins: Pin[] = [
  // ---- 1. the field, and how it is read ----------------------------------
  {
    label: 'ShiftState declares previous_open_shift as an OPTIONAL nullable shift',
    holds: ({ transport: t }) => /previous_open_shift\?: Shift \| null/.test(t),
    mutate: (source) => ({ ...source, transport: source.transport.replace('previous_open_shift?: Shift | null', 'previous_open_shift: Shift | null') }),
  },
  {
    label: 'both POS consumers read it as `state?.previous_open_shift ?? null`, so "not stated" renders nothing',
    holds: ({ gate: g }) => (g.match(/const carryOver = state\?\.previous_open_shift \?\? null/g) || []).length >= 2,
    mutate: (source) => editGate(source, 'const carryOver = state?.previous_open_shift ?? null', 'const carryOver = state?.previous_open_shift as Shift'),
  },

  // ---- 2. one modal, two steps -------------------------------------------
  {
    label: 'the carry-over step is rendered INSIDE the non-dismissible registration modal',
    holds: ({ gate: g }) => {
      const step = g.indexOf("registerStep === 'carry_over' && carryOver")
      const prompt = g.indexOf('needsRegistration && (')
      const endButton = g.indexOf('export function EndShiftButton')
      return prompt > 0 && step > prompt && step < endButton
    },
    mutate: (source) => editGate(source, "{registerStep === 'carry_over' && carryOver ? (", '{false ? ('),
  },
  {
    label: 'both carry-over states offer the step switch, and none of them closes the modal',
    holds: ({ gate: g }) => {
      const step = carryOverStep(g)
      return (step.match(/setRegisterStep\('open'\)/g) || []).length >= 2 && !/onClose=/.test(step)
    },
    // The LOCKED branch's switch (the one without `disabled=`): remove it and
    // a cashier who cannot close the earlier shift can never register today's.
    mutate: (source) => editGate(source,
      `<button type="button" onClick={() => setRegisterStep('open')} className={DENSE_STEP_BUTTON}>`,
      `<button type="button" className={DENSE_STEP_BUTTON}>`),
  },

  // ---- 3. ONE form, not one per entry point ------------------------------
  {
    label: 'the carry-over close is ONE call site -- not a second copy of the same seven-field body',
    holds: ({ gate: g }) => (g.match(/closeShiftById\(/g) || []).length === 1,
    mutate: (source) => editGate(source,
      'const result = await closeShiftById(shift.id, {',
      'const result = await (pending ? closeShiftById(shift.id, {} as never) : null) ?? await closeShiftById(shift.id, {'),
  },
  {
    label: 'and ONE closing-time field, inside that one form',
    holds: ({ gate: g }) => (g.match(/<DateTimeEntryInput/g) || []).length === 1
      && /<DateTimeEntryInput/.test(carryFields(g)),
    mutate: (source) => editGate(source, '<DateTimeEntryInput', '<DateTimeEntryInput /><DateTimeEntryInput'),
  },
  {
    label: 'both entry points render that one component: the prompt step and the POS header panel',
    holds: ({ gate: g }) => (g.match(/<CarryOverCloseFields/g) || []).length === 2
      && /<CarryOverCloseFields/.test(carryOverStep(g)) && /<CarryOverCloseFields/.test(carryOverPanel(g)),
    mutate: (source) => editGate(source, '<CarryOverCloseFields form={carryForm} />', '<div />'),
  },

  // ---- 4. the two closes keep their two different rules -------------------
  {
    label: 'the carry-over close goes through closeShiftById with an explicit closedAt',
    holds: ({ gate: g }) => /closeShiftById\([\s\S]{0,400}?closedAt: shiftLocalDateTimeToIso\(/.test(carryHook(g)),
    mutate: (source) => editGate(source, 'closedAt: shiftLocalDateTimeToIso(draft.closedAt),', 'closedAt: new Date().toISOString(),'),
  },
  {
    label: 'and it never calls the live closeShift()',
    holds: ({ gate: g }) => {
      const hook = carryHook(g)
      return hook.length > 200 && !/\bcloseShift\(/.test(hook)
    },
    mutate: (source) => editRegion(source, carryHook, 'await closeShiftById(shift.id, {', 'await closeShift({'),
  },
  {
    label: 'the live close still sends NO closing time -- the server stamps its own clock',
    holds: ({ gate: g }) => {
      const live = liveCloseCall(g)
      return /closeShift\(\{/.test(live) && !/closed_?[Aa]t/.test(live)
    },
    mutate: (source) => editRegion(source, liveCloseCall, 'shiftId: target.id,', 'shiftId: target.id, closedAt: shiftLocalDateTimeToIso(closedAt),'),
  },
  {
    label: 'and the live End Shift path carries no carry-over branch at all',
    holds: ({ gate: g }) => !/carryOverMode/.test(g),
    mutate: (source) => editGate(source, 'const next = await closeShift({',
      'const next = carryOverMode ? await closeShiftById(target.id, {} as never) : await closeShift({'),
  },

  // ---- 5. the prefilled closing moment the Worker will actually accept ----
  {
    label: "the prefill is a minute before the next shift's opening, never a bare clock reading",
    holds: ({ gate: g }) => {
      const seed = carrySeed(g)
      return /parseServerTimestampMs\(nextOpenedAt\)/.test(seed)
        && /Math\.min\(nowMs, nextMs - 60_000\)/.test(seed)
        && /: nowMs/.test(seed)
    },
    mutate: (source) => editRegion(source, carrySeed,
      'return Number.isFinite(nextMs) ? Math.min(nowMs, nextMs - 60_000) : nowMs', 'return nowMs'),
  },
  {
    label: 'the form seeds through that rule, not through Date.now() directly',
    holds: ({ gate: g }) => /shiftLocalDateTimeFromMs\([\s\S]{0,120}?carryOverCloseSeedMs\(nextOpenedAt, Date\.now\(\)\)\)/.test(carryHook(g)),
    mutate: (source) => editRegion(source, carryHook, 'carryOverCloseSeedMs(nextOpenedAt, Date.now())', 'Date.now()'),
  },
  {
    label: "and BOTH entry points hand it today's opening, which is the time the Worker compares against",
    holds: ({ gate: g }) => (g.match(/useCarryOverClose\([A-Za-z]+, state\?\.shift\?\.opened_at,/g) || []).length === 2,
    mutate: (source) => editGate(source, 'useCarryOverClose(carryTarget, state?.shift?.opened_at,', 'useCarryOverClose(carryTarget, undefined,'),
  },

  // ---- 6. the retry-replay contract, on this form too --------------------
  {
    label: 'an unacknowledged close is replayed from its frozen body, never from a fresh prefill',
    holds: ({ gate: g }) => {
      const hook = carryHook(g)
      return /const saved = pendingShiftMutation\(actorId, shiftId\)/.test(hook)
        && /saved\?\.action === 'close' \? saved\.body : null/.test(hook)
        && /setPending\(body != null\)/.test(hook)
    },
    mutate: (source) => editRegion(source, carryHook, 'const saved = pendingShiftMutation(actorId, shiftId)', 'const saved = null'),
  },
  {
    label: 'an unresolved outcome defers to the shared banner instead of a red error toast',
    holds: ({ gate: g }) => {
      const hook = carryHook(g)
      return /setPending\(\(e as \{ outcome\?: string \}\)\?\.outcome === 'unknown'\)/.test(hook)
        && /if \(\(e as \{ outcome\?: string \}\)\?\.outcome === 'unknown'\) return/.test(hook)
    },
    mutate: (source) => editRegion(source, carryHook,
      "if ((e as { outcome?: string })?.outcome === 'unknown') return", '/* reported as an error instead */'),
  },
  {
    label: 'the button says Retry while it is unresolved, and the fields stay frozen on what will be sent',
    holds: ({ gate: g }) => {
      const fields = carryFields(g)
      return /const frozen = form\.busy \|\| form\.pending/.test(fields)
        && /label=\{form\.pending \? t\('retry'\) : t\('shift_action_close'\)\}/.test(fields)
        && (fields.match(/disabled=\{frozen\}/g) || []).length >= 4
    },
    mutate: (source) => editRegion(source, carryFields,
      "label={form.pending ? t('retry') : t('shift_action_close')}", "label={t('shift_action_close')}"),
  },
  {
    label: "a real failure still reaches the cashier verbatim -- it is the Worker's sentence that names the time",
    holds: ({ gate: g }) => /notify\(e instanceof Error \? e\.message : t\('shift_end_failed'\), 'error'\)/.test(carryHook(g)),
    mutate: (source) => editRegion(source, carryHook,
      "notify(e instanceof Error ? e.message : t('shift_end_failed'), 'error')", "notify(t('shift_end_failed'), 'error')"),
  },

  // ---- 7. the already-registered case ------------------------------------
  {
    label: 'the second control is gated on the server capability, never on the row merely existing',
    holds: ({ gate: g }) => /const canCloseCarryOver = carryOver\?\.capabilities\.can_close === true/.test(g),
    mutate: (source) => editGate(source,
      'const canCloseCarryOver = carryOver?.capabilities.can_close === true',
      'const canCloseCarryOver = carryOver != null'),
  },
  {
    label: 'and the early return clears it, so an already-registered day still offers the earlier close',
    holds: ({ gate: g }) => /if \(!canCloseCurrent && !canCloseCarryOver && !closed && !open\) return null/.test(g),
    mutate: (source) => editGate(source,
      'if (!canCloseCurrent && !canCloseCarryOver && !closed && !open) return null',
      'if (!canCloseCurrent && !closed && !open) return null'),
  },
  {
    label: 'the header control is visibly a different action: amber, and labelled with the day it closes',
    holds: ({ gate: g }) => {
      const end = endBody(g)
      return /border-amber-500/.test(end)
        && /\{t\('shift_action_close'\)\} · \{fmtDate\(carryOver\?\.opened_at\)\}/.test(end)
    },
    mutate: (source) => editGate(source,
      "{t('shift_action_close')} · {fmtDate(carryOver?.opened_at)}", "{t('shift_action_close')}"),
  },
  {
    label: 'its panel is a modal with ONE close affordance (the header X) and the unsaved-work guard wired',
    holds: ({ gate: g }) => {
      const panel = carryOverPanel(g)
      return /onClose=\{dismissCarryOver\}/.test(panel)
        && /closeDisabled=\{carryForm\.busy\}/.test(panel)
        && /unsavedChanges=\{\{ dirty: carryForm\.dirty \}\}/.test(panel)
        && !/<button/.test(panel)
    },
    mutate: (source) => editRegion(source, carryOverPanel, '<CarryOverCloseFields form={carryForm} />',
      '<CarryOverCloseFields form={carryForm} /><button type="button" onClick={dismissCarryOver}>close</button>'),
  },

  // ---- 8. every write re-reads /current ----------------------------------
  {
    label: 'a successful open re-reads /current, because the open response cannot carry previous_open_shift',
    holds: ({ gate: g }) => {
      const open = openSubmit(g)
      return /publish\(next\)/.test(open) && /window\.dispatchEvent\(new Event\(SHIFT_STATE_CHANGED_EVENT\)\)/.test(open)
    },
    mutate: (source) => editRegion(source, openSubmit, 'window.dispatchEvent(new Event(SHIFT_STATE_CHANGED_EVENT))', '/* no refresh */'),
  },
  {
    label: 'and so does a successful carry-over close -- a still-older row may surface behind it',
    holds: ({ gate: g }) => {
      const hook = carryHook(g)
      return /window\.dispatchEvent\(new Event\(SHIFT_STATE_CHANGED_EVENT\)\)/.test(hook) && /onClosed\(\)/.test(hook)
    },
    mutate: (source) => editRegion(source, carryHook, 'window.dispatchEvent(new Event(SHIFT_STATE_CHANGED_EVENT))', '/* no refresh */'),
  },
  {
    label: 'which returns the prompt to the register step, and closes the header panel',
    holds: ({ gate: g }) => /useCarryOverClose\(carryOver, state\?\.shift\?\.opened_at, \(\) => setRegisterStep\('open'\)\)/.test(g)
      && /useCarryOverClose\(carryTarget, state\?\.shift\?\.opened_at, \(\) => \{ setCarryTarget\(null\); setOpen\(false\) \}\)/.test(g),
    mutate: (source) => editGate(source, "() => setRegisterStep('open'))", '() => {})'),
  },
]

let checks = 0
const real: Source = { gate, transport }

for (const pin of pins) {
  assert.ok(pin.holds(real), `ShiftGate/shiftTransport does not satisfy: ${pin.label}`)
  // The negative control: the same pin, on a copy of the source with the rule
  // broken. A pin that still passes here is measuring nothing.
  assert.equal(pin.holds(pin.mutate(real)), false,
    `NOT DISCRIMINATING -- the mutated source also passes: ${pin.label}`)
  checks += 2
  console.log(`  ok - ${pin.label}`)
}

// ---- 9. both packs, four keys, real Khmer ---------------------------------
for (const key of ['shift_previous_open_title', 'shift_previous_open_hint', 'shift_previous_open_locked', 'shift_open_today_instead']) {
  assert.ok(typeof en[key] === 'string' && en[key].trim().length > 0, `en.json is missing ${key}`)
  assert.ok(typeof km[key] === 'string' && km[key].trim().length > 0, `km.json is missing ${key}`)
  assert.notEqual(km[key], en[key], `km.json falls back to the English string for ${key}`)
  assert.match(km[key], /[ក-៿]/, `km.json carries no Khmer script for ${key}`)
  assert.match(gate, new RegExp(`t\\('${key}'\\)`), `${key} is in the packs but nothing renders it`)
  checks += 5
  console.log(`  ok - ${key} is written in both packs and rendered`)
}
// The hint has to say the one thing the cashier cannot guess: the closing time
// must precede today's opening, or the Worker rejects the close with a 409.
assert.match(en.shift_previous_open_hint, /earlier than that opening/)
checks += 1
console.log('  ok - the hint states the ordering rule the Worker enforces')

// ---- 10. EXECUTED: the two rules a spelling check cannot prove ------------
//
// The seed and the replay are behaviour, not text. Both are run here against
// the real component: the header's carry-over button is pressed and the form
// it opens is read back, once with no pending request and once with an
// unacknowledged close in storage. The seed check carries its own negative
// control -- the same harness on a copy of the source that seeds from the
// bare clock, which must produce a moment the Worker would refuse.
type RenderNode = { type: unknown; props: Record<string, any> }
const oldWindow = globalThis.window
globalThis.window = Object.assign(new EventTarget(), {
  setInterval: () => 1, clearInterval: () => {},
  localStorage: undefined, sessionStorage: undefined,
}) as unknown as Window & typeof globalThis
const transportModule = await import('../src/api/shiftTransport.ts')

// Today opened well in the past, so min(now, opening - 60 s) is the opening
// side of the comparison whatever the clock says when this file is run.
const TODAY_OPENED_AT = '2026-09-01T02:00:00.000Z'
const EARLIER_OPENED_AT = '2026-08-31T01:00:00.000Z'
const currentShift = {
  shift: { id: 71, revision: 3, opened_at: TODAY_OPENED_AT, capabilities: { can_close: true } },
  is_open: true, needs_registration: false, can_end: true,
  previous_open_shift: {
    id: 60, revision: 1, shift_code: 'S-20260831-0800', opened_at: EARLIER_OPENED_AT,
    opening_float_usd: 20, opening_float_khr: 40_000, capabilities: { can_close: true },
  },
}

function openCarryOverPanel(source: string, saved: unknown) {
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
  const notices: any[] = []
  let closeCall: any = null
  let resolveClose: (value: any) => void = () => {}
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props })
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
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
    if (name.includes('AppContext')) return { useApp: () => ({ t: (key: string) => key, notify: (...args: any[]) => notices.push(args), user: { id: 4 }, settings: {}, fmtUSD: String, fmtKHR: String }) }
    if (name.includes('formatters')) return { fmtDate: String, fmtDateTime24: String, parseServerTimestampMs: Date.parse }
    if (name.includes('DateEntryInput')) return { DateTimeEntryInput: DateMarker }
    if (name.includes('ShiftCountFields')) return { default: PairMarker, ShiftSubmitRow: SubmitMarker, shiftCountBlockerKey: (key: string) => key }
    if (name.includes('shiftReportModel')) return {
      shiftCountedPairText: (usd: unknown, khr: unknown) => `${usd}|${khr}`,
      shiftAdditionalCash: () => null,
      shiftExpectedWithTypedAdditional: () => ({ usd: null, khr: null }),
    }
    if (name.includes('shiftTransport')) return {
      ...transportModule,
      fetchCurrentShift: async () => currentShift,
      pendingShiftMutation: () => saved,
      closeShiftById: (id: number, input: any) => { closeCall = { id, input }; return new Promise((resolve) => { resolveClose = resolve }) },
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
    // The shared carry-over components are pure functions of their props --
    // they hold no hooks of their own -- so the harness renders them in place
    // to reach the fields the fold moved inside them.
    const own = typeof tree.type === 'function' && /^CarryOver/.test(tree.type.name)
      ? nodes(tree.type(tree.props)) : []
    return [tree, ...own, ...nodes(tree.props?.children)]
  }
  module.exports.publishShift(module.exports.shiftCacheKey(4, 1, 'per_account'), currentShift)
  let tree = render()
  const carryButton = nodes(tree).find((node) => node.type === 'button' && String(node.props.className).includes('border-amber-500'))
  assert.ok(carryButton, 'the header offers the amber carry-over control')
  carryButton!.props.onClick()
  render()
  tree = render()
  const found = nodes(tree)
  return {
    closedAt: found.find((node) => node.type === DateMarker)?.props.value as string,
    label: found.find((node) => node.type === SubmitMarker)?.props.label as string,
    pairs: found.filter((node) => node.type === PairMarker).map((node) => node.props),
    submit: () => found.find((node) => node.type === SubmitMarker)!.props.onClick(),
    finish: (value: any) => resolveClose(value),
    call: () => closeCall,
    notices,
  }
}

try {
  const fresh = openCarryOverPanel(gate, null)
  const expectedSeed = transportModule.shiftLocalDateTimeFromMs(Date.parse(TODAY_OPENED_AT) - 60_000)
  assert.equal(fresh.closedAt, expectedSeed,
    "the panel opens on a closing time the Worker accepts (a minute before today's opening)")
  assert.ok(Date.parse(transportModule.shiftLocalDateTimeToIso(fresh.closedAt)) < Date.parse(TODAY_OPENED_AT),
    'and it is strictly before that opening, which is the whole 409 rule')
  assert.equal(fresh.label, 'shift_action_close', 'with nothing unacknowledged, the button writes rather than retries')
  checks += 3
  console.log('  ok - executed: the carry-over panel prefills a closing time the Worker will accept')

  // The negative control for the seed, run through the same harness.
  const mutant = gate.replace('carryOverCloseSeedMs(nextOpenedAt, Date.now())', 'Date.now()')
  assert.notEqual(mutant, gate, 'the seed negative control could not find its target')
  assert.notEqual(openCarryOverPanel(mutant, null).closedAt, expectedSeed,
    'NOT DISCRIMINATING -- seeding from the bare clock produced the same moment')
  checks += 1
  console.log('  ok - executed: seeding from the bare clock is caught by that same check')

  // The submitted body: the explicit closed_at, the revision, the counts.
  fresh.submit()
  assert.equal(fresh.call().id, 60, 'the close is addressed to the EARLIER shift, not today\'s')
  assert.equal(fresh.call().input.expectedRevision, 1, 'and carries that row\'s revision')
  assert.equal(fresh.call().input.closedAt, new Date(Date.parse(TODAY_OPENED_AT) - 60_000).toISOString(),
    'the explicit closed_at is the seeded moment, in UTC')
  fresh.finish({ shift: { id: 60, closing_counted_usd: 30, closing_counted_khr: 12_000, closed_at: '2026-09-01T01:59:00.000Z' } })
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  assert.ok(String(fresh.notices[0]?.[0]).includes('30|12000'),
    'and the confirmation names the drawer that was written, not a bare "done"')
  checks += 4
  console.log('  ok - executed: the write names the earlier row, its revision and an explicit closing moment')

  // The replay: an unacknowledged close owns the form until it resolves.
  const replay = openCarryOverPanel(gate, { action: 'close', body: {
    closed_at: '2026-08-31T05:00:00.000Z', closing_counted_usd: 12, closing_counted_khr: 8_000,
    additional_cash_usd: null, additional_cash_khr: null, closing_note: 'left open overnight',
  } })
  assert.equal(replay.closedAt, transportModule.shiftLocalDateTimeFromMs(Date.parse('2026-08-31T05:00:00.000Z')),
    'an unacknowledged close shows ITS closing time, never a fresh prefill')
  assert.equal(replay.label, 'retry', 'and offers Retry rather than a second write')
  assert.ok(replay.pairs.every((pair) => pair.disabled === true), 'its fields are frozen on the body that will be replayed')
  assert.equal(replay.pairs.find((pair) => pair.label === 'shift_counted_cash')?.usd, '12', 'showing the frozen counted drawer')
  checks += 4
  console.log('  ok - executed: an unacknowledged carry-over close is replayed, not re-typed')
} finally {
  globalThis.window = oldWindow
}

console.log(`\nshiftCarryOverClose: all ${checks} checks passed`)
