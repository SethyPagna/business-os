// The Shifts popup's record of a shift that was closed late (owner A74-A76): the detail carries the "Closed late" tag and
// the reason the closer typed, read from the standing time review the Worker journals with the close
// (after_json.time_review, entry code closed_late). The newest journal row that evaluated the times is the standing review.
//
// Run: node tests/shiftClosedLateDetail.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { transformSync } from 'esbuild'
import type { ShiftAmendment } from '../src/api/shiftTransport.ts'

const require = createRequire(import.meta.url)
const React = require('react')
const renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup as (node: unknown) => string

const read = (rel: string): string => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>

function load(rel: string): Record<string, unknown> {
  const mod = { exports: {} as Record<string, unknown> }
  const compiled = transformSync(read(rel), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  new Function('require', 'module', 'exports', compiled)((id: string) => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id)
    if (id.includes('/AppContext')) return { useApp: () => ({ t: (key: string) => en[key] || key, fmtUSD: String, fmtKHR: String }) }
    if (id.includes('utils/formatters')) return require('../src/utils/formatters.ts')
    if (id.includes('shiftReportModel')) return require('../src/components/shifts/shiftReportModel.ts')
    return { __esModule: true, default: () => null }
  }, mod, mod.exports)
  return mod.exports
}

const { ClosedLateNote } = load('../src/components/shifts/ShiftHistoryModal.tsx') as { ClosedLateNote: unknown }

const row = (id: number, afterJson: unknown): ShiftAmendment => ({
  id, shift_session_id: 41, actor_user_id: 9, actor_name: 'sokha', reason: 'Late close: Forgot to close',
  before_json: '{}', after_json: JSON.stringify(afterJson), created_at: '2026-11-22T16:59:59.000Z',
})
const render = (rows: ShiftAmendment[]) => renderToStaticMarkup(React.createElement(ClosedLateNote as never, { rows }))

test('a shift closed late shows the Closed late tag and the reason the closer typed', () => {
  const markup = render([row(3, { revision: 1, time_review: [{ code: 'closed_late', by: 'sokha', reason: 'Forgot to close' }] })])
  assert.ok(markup.includes(en.shift_closed_late), 'the tag')
  assert.match(markup, /sokha: Forgot to close/, 'and who closed it and why')
})

test('a shift closed on time shows no tag, and neither does one whose standing review no longer carries it', () => {
  assert.equal(render([row(3, { revision: 1, time_review: [] })]), '', 'a review with no closed_late entry')
  assert.equal(render([row(3, { revision: 1 })]), '', 'no review at all')
  assert.equal(render([]), '', 'no records')
  const cleared = render([
    row(3, { revision: 1, time_review: [{ code: 'closed_late', by: 'sokha', reason: 'Forgot to close' }] }),
    row(4, { revision: 2, time_review: [] }),
  ])
  assert.equal(cleared, '', 'the newest review is the standing one, and a later edit cleared it')
})

test('the Shifts popup renders the note in the detail of a closed record, and the key is in both packs', () => {
  const source = read('../src/components/shifts/ShiftHistoryModal.tsx')
  assert.ok(/selected\.closed_at \? <ClosedLateNote rows=\{amendments\.filter\(\(row\) => row\.shift_session_id === selected\.id\)\} \/> : null/.test(source))
  const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
  assert.ok(en.shift_closed_late && km.shift_closed_late && en.shift_closed_late !== km.shift_closed_late)
})
