// Audit Log view state (AUDIT-LOG-ORG): the scope (All / Section / User), the
// time presets, the search and the request the page sends for them.
//
// The pure module is what the page's filter state lives in, so the rules the
// owner cares about are pinned here without a browser:
//   - time presets are business days (Cambodia), computed by date arithmetic on
//     the business "today" -- never the device's clock or zone;
//   - only the ACTIVE scope's selection is sent (a stale section pick left over
//     from Section scope must not filter the All view);
//   - counts are asked for on the first page only, never on Load more;
//   - the section ids match the Worker's mapping table exactly.
process.env.TZ = 'America/Los_Angeles'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  AUDIT_PAGE_SIZE,
  AUDIT_SECTION_IDS,
  auditCountsFor,
  auditFilterKey,
  auditPresetWindow,
  buildAuditRequestParams,
  initialAuditViewState,
  mergeAuditRows,
  setAuditPreset,
  setAuditRange,
  setAuditScope,
} from '../src/utils/auditLogView.ts'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const TODAY = '2026-09-30'

test('time presets are business-day windows computed from the business today', () => {
  assert.deepEqual(auditPresetWindow('today', TODAY), { startDate: '2026-09-30', endDate: '2026-09-30' })
  assert.deepEqual(auditPresetWindow('7d', TODAY), { startDate: '2026-09-24', endDate: '2026-09-30' })
  assert.deepEqual(auditPresetWindow('30d', TODAY), { startDate: '2026-09-01', endDate: '2026-09-30' })
  assert.deepEqual(auditPresetWindow('7d', '2026-03-01'), { startDate: '2026-02-23', endDate: '2026-03-01' }, 'crosses a month end')
  assert.deepEqual(auditPresetWindow('7d', '2028-03-01'), { startDate: '2028-02-24', endDate: '2028-03-01' }, 'and a leap day')
  assert.deepEqual(auditPresetWindow('30d', '2027-01-10'), { startDate: '2026-12-12', endDate: '2027-01-10' }, 'and a year end')
})

test('the default view is All scope, Today, newest first', () => {
  const state = initialAuditViewState()
  assert.equal(state.scope, 'all')
  assert.equal(state.preset, 'today')
  assert.equal(state.order, 'desc')
  const params = buildAuditRequestParams(state, { today: TODAY })
  assert.equal(params.startDate, TODAY)
  assert.equal(params.endDate, TODAY)
  assert.equal(params.pageSize, AUDIT_PAGE_SIZE)
  assert.ok(AUDIT_PAGE_SIZE <= 100, 'never asks for more than the Worker cap')
  for (const key of ['section', 'userId', 'search', 'cursor', 'counts', 'action', 'order']) {
    assert.equal(params[key], undefined, `${key} is not sent by default`)
  }
})

test('only the active scope\'s selection reaches the request', () => {
  let state = setAuditScope(initialAuditViewState(), 'section', true)
  state = { ...state, section: 'sales,returns' }
  assert.equal(buildAuditRequestParams(state, { today: TODAY }).section, 'sales,returns')
  assert.equal(buildAuditRequestParams(state, { today: TODAY }).userId, undefined)

  const backToAll = setAuditScope(state, 'all', true)
  const allParams = buildAuditRequestParams(backToAll, { today: TODAY })
  assert.equal(allParams.section, undefined, 'a section picked earlier does not filter the All view')
  assert.equal(backToAll.section, 'all', 'and the pick is cleared, not just hidden')

  // POSITIVE CONTROL for the two lines above: a state that still carries a stale
  // pick under scope All (what a naive reducer would leave behind) WOULD send it
  // if the request builder trusted the field instead of the scope.
  const stale = { ...initialAuditViewState(), section: 'sales', userId: '4' }
  const staleParams = buildAuditRequestParams(stale, { today: TODAY })
  assert.equal(staleParams.section, undefined)
  assert.equal(staleParams.userId, undefined)

  let byUser = setAuditScope(initialAuditViewState(), 'user', true)
  byUser = { ...byUser, userId: '4,9', section: 'sales' }
  const userParams = buildAuditRequestParams(byUser, { today: TODAY })
  assert.equal(userParams.userId, '4,9')
  assert.equal(userParams.section, undefined, 'the User scope does not carry the Section pick')
})

test('the User scope is refused for a caller who may only see their own rows', () => {
  const state = setAuditScope(initialAuditViewState(), 'user', false)
  assert.equal(state.scope, 'all')
  assert.equal(setAuditScope(initialAuditViewState(), 'section', false).scope, 'section', 'Section is fine for everyone')
})

test('counts are asked for by scope, on the first page only', () => {
  assert.equal(auditCountsFor('all'), undefined)
  assert.equal(auditCountsFor('section'), 'sections')
  assert.equal(auditCountsFor('user'), 'users')
  const byUser = setAuditScope(initialAuditViewState(), 'user', true)
  assert.equal(buildAuditRequestParams(byUser, { today: TODAY }).counts, 'users')
  const more = buildAuditRequestParams(byUser, { today: TODAY, cursor: 'abc' })
  assert.equal(more.cursor, 'abc')
  assert.equal(more.counts, undefined, 'Load more never repeats the aggregate')
  const bySection = setAuditScope(initialAuditViewState(), 'section', true)
  assert.equal(buildAuditRequestParams(bySection, { today: TODAY }).counts, 'sections')
})

test('time preset, custom range and search shape the window and the query', () => {
  let state = setAuditPreset(initialAuditViewState(), '30d', TODAY)
  assert.equal(state.preset, '30d')
  let params = buildAuditRequestParams(state, { today: TODAY })
  assert.deepEqual([params.startDate, params.endDate], ['2026-09-01', '2026-09-30'])

  state = setAuditPreset(state, 'custom', TODAY)
  assert.equal(state.preset, 'custom')
  assert.deepEqual([state.rangeStart, state.rangeEnd], ['2026-09-01', '2026-09-30'], 'Custom opens on the range the user was looking at')

  state = setAuditRange(state, '2026-08-10', '2026-08-20')
  params = buildAuditRequestParams(state, { today: TODAY })
  assert.deepEqual([params.startDate, params.endDate], ['2026-08-10', '2026-08-20'])

  const cleared = setAuditRange(state, '', '')
  const window = buildAuditRequestParams(cleared, { today: TODAY })
  assert.deepEqual([window.startDate, window.endDate], ['2026-09-01', '2026-09-30'], 'clearing the custom range falls back to the last 30 days, never an unbounded read')

  const searched = buildAuditRequestParams({ ...initialAuditViewState(), search: '  stock set  ' }, { today: TODAY })
  assert.equal(searched.search, 'stock set')
  assert.equal(buildAuditRequestParams({ ...initialAuditViewState(), search: '   ' }, { today: TODAY }).search, undefined)
  assert.equal(buildAuditRequestParams({ ...initialAuditViewState(), order: 'asc' }, { today: TODAY }).order, 'asc')
})

test('the filter key changes with a filter and not with the page', () => {
  const base = initialAuditViewState()
  const keys = new Set([
    auditFilterKey(base, TODAY),
    auditFilterKey({ ...base, search: 'a' }, TODAY),
    auditFilterKey({ ...base, order: 'asc' }, TODAY),
    auditFilterKey(setAuditScope(base, 'section', true), TODAY),
    auditFilterKey(setAuditPreset(base, '7d', TODAY), TODAY),
    auditFilterKey({ ...base, action: 'create' }, TODAY),
  ])
  assert.equal(keys.size, 6, 'each filter is its own key')
  assert.equal(auditFilterKey(base, TODAY), auditFilterKey({ ...base }, TODAY), 'a copy of the same state is the same key')
  assert.notEqual(auditFilterKey(base, TODAY), auditFilterKey(base, '2026-10-01'), 'the day rolling over reloads the window')
})

test('rows merge across pages without duplicates and keep the server order', () => {
  const page1 = [{ id: 9 }, { id: 8 }, { id: 7 }]
  const page2 = [{ id: 7 }, { id: 6 }]
  assert.deepEqual(mergeAuditRows(page1, page2).map((r) => r.id), [9, 8, 7, 6])
  assert.deepEqual(mergeAuditRows([], page1).map((r) => r.id), [9, 8, 7])
  assert.deepEqual(mergeAuditRows(page1, []).map((r) => r.id), [9, 8, 7])
})

test('the section ids and labels match the Worker mapping table', () => {
  const worker = read('../../cloudflare/src/lib/auditSections.ts')
  const block = worker.slice(worker.indexOf('export const AUDIT_SECTION_IDS'), worker.indexOf('] as const'))
  const workerIds = [...block.matchAll(/'([a-z]+)'/g)].map((m) => m[1])
  assert.deepEqual(AUDIT_SECTION_IDS.filter((id) => id !== 'other'), workerIds, 'same sections, same order')
  assert.equal(AUDIT_SECTION_IDS[AUDIT_SECTION_IDS.length - 1], 'other', "'other' comes last")
  for (const pack of ['en', 'km']) {
    const strings = JSON.parse(read(`../src/lang/${pack}.json`)) as Record<string, unknown>
    for (const id of AUDIT_SECTION_IDS) {
      assert.ok(typeof strings[`audit_section_${id}`] === 'string', `${pack}.json has audit_section_${id}`)
    }
    for (const key of ['audit_scope_all', 'audit_scope_section', 'audit_scope_user', 'audit_load_more']) {
      assert.ok(typeof strings[key] === 'string' && strings[key], `${pack}.json has ${key}`)
    }
  }
})
