// The shift EDIT contract (owner, Sep 14 2026, verbatim):
//
//   "shift should be aditable for employees. it just leaves record basially
//    each shift have record shown one row last row of each record. like sales
//    record for any change, before and after."
//
// Four things that has to mean on screen, each of which was wrong at least
// once:
//
//   1. the amend form asks for the drawer in the order it moves -- opening,
//      then the additional change put in mid-shift, then the closing count --
//      with both notes and a required reason;
//   2. an amendment renders BEFORE -> AFTER, naming the field, the actor and
//      the moment, so the record is readable rather than a JSON blob;
//   3. the Edit button is shown when the SERVER says the caller may edit
//      (capabilities.can_edit), and hidden when it does not -- replacing the
//      old "only the cashier who opened it" rule;
//   4. a row that carries corrections says so, like a sale row does, and a
//      shift that was merely closed does not.
//
// 2 and 4 are RENDERED with react-dom/server from the real components, not
// grepped: a grep passes while the badge still prints.
//
// Run: node tests/shiftAmendForm.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { transformSync } from 'esbuild'
import type { Shift, ShiftAmendment } from '../src/api/shiftTransport.ts'

const require = createRequire(import.meta.url)
const React = require('react')
const renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup as (node: unknown) => string

const read = (rel: string): string => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
const modalSource = read('../src/components/shifts/ShiftHistoryModal.tsx')

// The shell is stubbed (app context, icons, the modal frame); everything that
// decides what a row SAYS is loaded for real.
function load(rel: string): Record<string, unknown> {
  const mod = { exports: {} as Record<string, unknown> }
  const compiled = transformSync(read(rel), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  new Function('require', 'module', 'exports', compiled)((id: string) => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id)
    if (id.includes('/AppContext')) {
      return {
        useApp: () => ({
          t: (key: string) => en[key] || key,
          fmtUSD: (value: unknown) => `$${Number(value).toFixed(2)}`,
          fmtKHR: (value: unknown) => `${Math.round(Number(value)).toLocaleString()}៛`,
        }),
      }
    }
    if (id.includes('utils/formatters')) return require('../src/utils/formatters.ts')
    if (id.includes('utils/permissions')) return require('../src/utils/permissions.ts')
    if (id.includes('shiftReportModel')) return require('../src/components/shifts/shiftReportModel.ts')
    if (id.includes('constants')) return require('../src/constants.ts')
    return { __esModule: true, default: () => null }
  }, mod, mod.exports)
  return mod.exports
}

const ShiftSummary = load('../src/components/shifts/ShiftSummary.tsx').default as unknown
const { AmendmentList } = load('../src/components/shifts/ShiftHistoryModal.tsx') as { AmendmentList: unknown }

const shiftFixture = (overrides: Partial<Shift> = {}): Shift => ({
  id: 41,
  shift_code: 'S-20260914-0800-a1b2c3',
  scope_mode: 'per_account',
  user_id: 7,
  user_name: 'rath',
  branch_id: 1,
  branch_name: 'Canonical Shop',
  business_date: '2026-09-14',
  opened_at: '2026-09-14T01:00:00.000Z',
  opening_float_usd: 10,
  opening_float_khr: 10000,
  additional_cash_usd: 0,
  additional_cash_khr: 0,
  opening_note: null,
  closed_at: '2026-09-14T11:00:00.000Z',
  closing_counted_usd: 12,
  closing_counted_khr: 12000,
  closing_note: null,
  closed_by_user_id: 7,
  closed_by_user_name: 'rath',
  revision: 2,
  capabilities: { can_edit: true, can_close: false, can_reopen: false, can_cancel: false },
  cancelled_at: null,
  cancelled_by_user_id: null,
  cancelled_by_user_name: null,
  cancel_reason: null,
  parent_shift_id: null,
  reopen_reason: null,
  reopened_by_user_id: null,
  reopened_by_user_name: null,
  ...overrides,
})

const renderSummary = (shift: Shift): string =>
  renderToStaticMarkup(React.createElement(ShiftSummary as never, { shift }))

// ---- 1. the form's fields, and their order -------------------------------

test('the amend form asks opening -> additional -> closing, with both notes and a reason', () => {
  const form = modalSource.slice(modalSource.indexOf("action === 'edit' && edit"))
  const at = (needle: string) => {
    const index = form.indexOf(needle)
    assert.ok(index > 0, `the amend form is missing ${needle}`)
    return index
  }
  const opening = at('usd={edit.openingUsd}')
  const additional = at('usd={edit.additionalUsd}')
  const closing = at('usd={edit.closingUsd}')
  assert.ok(opening < additional && additional < closing,
    'the drawer is asked for in the order it moves: opening float, the extra change put in, then the closing count')
  assert.ok(at('value={edit.openingNote}') < at('value={edit.closingNote}'), 'both notes are editable, opening first')
  assert.ok(at('value={edit.reason}') > closing, 'and the required reason closes the form')
  // Every editable field is carried into the draft the server receives, so a
  // field that renders but is never sent cannot pass the order check above.
  for (const field of ['openedAt', 'closedAt', 'openingUsd', 'openingKhr', 'additionalUsd', 'additionalKhr', 'closingUsd', 'closingKhr', 'openingNote', 'closingNote']) {
    assert.match(modalSource, new RegExp(`${field}:`), `the edit draft drops ${field}`)
  }
})

// ---- 2. before -> after ---------------------------------------------------

test('an amendment renders the field, its before value and its after value', () => {
  const before = { shift_code: 'S-1', opening_float_usd: 10, additional_cash_khr: 0, closing_note: null }
  const after = { shift_code: 'S-1', opening_float_usd: 14, additional_cash_khr: 5000, closing_note: 'Recounted' }
  const rows: ShiftAmendment[] = [{
    id: 5,
    shift_session_id: 41,
    actor_user_id: 9,
    actor_name: 'sokha',
    reason: 'Float was miscounted at open',
    before_json: JSON.stringify(before),
    after_json: JSON.stringify(after),
    created_at: '2026-09-14T12:30:00.000Z',
  }]
  const markup = renderToStaticMarkup(React.createElement(AmendmentList as never, { rows }))
  assert.match(markup, /Float was miscounted at open/, 'the reason is shown')
  assert.match(markup, /sokha/, 'and the actor who made the correction')
  assert.match(markup, /\$10\.00 → \$14\.00/, 'the changed money reads before -> after')
  assert.match(markup, /0៛ → 5,000៛/, 'including a figure that was zero before')
  assert.match(markup, /— → Recounted/, 'and a note that did not exist before reads as a dash')
  assert.doesNotMatch(markup, /shift_code/, 'fields the operator cannot edit are not listed as changes')
})

test('a record with nothing to diff still names who did it and why', () => {
  const rows: ShiftAmendment[] = [{
    id: 6,
    shift_session_id: 41,
    actor_user_id: 1,
    actor_name: 'admin',
    reason: 'Reopened to recount the drawer',
    before_json: JSON.stringify({ shift_code: 'S-1' }),
    after_json: JSON.stringify({ shift_code: 'S-2' }),
    created_at: '2026-09-14T13:00:00.000Z',
  }]
  const markup = renderToStaticMarkup(React.createElement(AmendmentList as never, { rows }))
  assert.match(markup, /Reopened to recount the drawer/)
  assert.match(markup, /admin/)
})

// ---- 3. the Edit button follows the SERVER's capability -------------------

test('the Edit button is gated on the server capability, not on who opened the shift', () => {
  const button = modalSource.indexOf("{t('shift_action_edit')}")
  assert.ok(button > 0, 'the Edit button exists')
  const guard = modalSource.slice(modalSource.lastIndexOf('{selected.capabilities', button), button)
  assert.match(guard, /capabilities\.can_edit \?/, 'the button renders only when the server says can_edit')
  assert.doesNotMatch(guard, /user_id|app\.user/, 'and never decides it from the caller identity in the browser')
  // The capability is a field of the transport type, so a server that stops
  // sending it is a type error here rather than a silently missing button.
  assert.match(read('../src/api/shiftTransport.ts'), /can_edit: boolean/)
})

// ---- 4. the Edited badge -------------------------------------------------

test('a corrected shift row says Edited, and an ordinary closed one does not', () => {
  assert.doesNotMatch(renderSummary(shiftFixture()), /Edited/, 'a shift with no corrections carries no badge')
  assert.doesNotMatch(renderSummary(shiftFixture({ amendment_count: 0 })), /Edited/, 'an explicit zero is not a badge either')
  const once = renderSummary(shiftFixture({ amendment_count: 1 }))
  assert.match(once, /Edited/, 'one correction shows the badge')
  assert.doesNotMatch(once, /Edited · /, 'a single correction does not need a count')
  assert.match(renderSummary(shiftFixture({ amendment_count: 3 })), /Edited · 3/, 'more than one is counted')
  // The badge sits WITH the status pill, not instead of it: a cancelled shift
  // that was also corrected has to say both.
  const cancelled = renderSummary(shiftFixture({ amendment_count: 2, cancelled_at: '2026-09-14T12:00:00.000Z' }))
  assert.match(cancelled, /Edited · 2/)
  assert.ok(cancelled.includes(en.shift_status_cancelled), 'the status pill is still there')
})

test('the badge and the segment list are named in both packs', () => {
  for (const key of ['shift_edited', 'shift_segments', 'shift_amendments']) {
    assert.ok(en[key] && en[key].trim(), `en.json is missing ${key}`)
    assert.ok(km[key] && km[key].trim(), `km.json is missing ${key}`)
    assert.notEqual(km[key], en[key], `km ${key} is still the English string`)
  }
})
