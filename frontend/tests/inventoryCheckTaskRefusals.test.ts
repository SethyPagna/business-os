import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { REFUSAL_MESSAGES } from '../src/components/inventory/inventoryCheckRefusals.ts'
import { filterScopeText, pickerText, progressOrAllText, taskName, taskRefusalKey, taskRefusalSentence, taskReview, taskScopeOf } from '../src/components/inventory/inventoryCheckTaskText.ts'

// Every refusal code the Worker can answer from the count-task routes has a sentence in both packs; the codes are READ from the Worker's own source, never copied by hand.
const SRC = new URL('../../cloudflare/src/', import.meta.url)
const FILES = ['lib/inventoryCheckSessions.ts', 'routes/inventoryChecks.ts', 'lib/inventoryCheckTasks.ts']
const workerCodes = new Set<string>()
for (const file of FILES) if (existsSync(new URL(file, SRC))) for (const match of readFileSync(new URL(file, SRC), 'utf8').matchAll(/'(inventory_check_(?:task[a-z_]*|tasks_required|issue_required|release_forbidden))'/g)) workerCodes.add(match[1])
const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
const KHMER = /[ក-៿]/
const packs = (key: string) => {
  assert.ok(typeof en[key] === 'string' && en[key].trim() !== '', `${key} has English text`)
  assert.ok(typeof km[key] === 'string' && KHMER.test(km[key]), `${key} has Khmer text`)
  assert.notEqual(km[key], en[key], `${key}: the Khmer is not the English`)
}

// Contract section 6 (docs/contracts/inventory-check-tasks-20261119.md): the codes the task routes add.
const CONTRACT_CODES = ['inventory_check_issue_required', 'inventory_check_tasks_required', 'inventory_check_task_not_found', 'inventory_check_task_closed', 'inventory_check_task_picked_up', 'inventory_check_task_not_picked_up', 'inventory_check_task_too_many',
  'inventory_check_task_not_countable', 'inventory_check_release_forbidden', 'inventory_check_task_limit']
// The shared refusals the task writers raise as well (contract sections 3.2-3.6): they must also say something.
const SHARED_CODES = ['inventory_check_permission_required', 'inventory_check_baseline_changed', 'inventory_check_request_reused', 'inventory_check_conflict', 'inventory_check_invalid_request', 'inventory_check_request_id_required', 'inventory_check_invalid_id', 'inventory_check_product_ids_required', 'inventory_check_product_not_eligible']

assert.ok(workerCodes.size >= CONTRACT_CODES.length, `positive control: the Worker source names the task codes (found ${workerCodes.size})`)
for (const code of [...workerCodes, ...CONTRACT_CODES, ...SHARED_CODES]) {
  assert.ok(Object.hasOwn(REFUSAL_MESSAGES, code), `${code} has a REFUSAL_MESSAGES entry`)
  const entry = REFUSAL_MESSAGES[code]
  assert.ok(entry.fallback.trim() !== '', `${code}: a fallback sentence`)
  packs(entry.key)
}
for (const code of CONTRACT_CODES) assert.ok(workerCodes.has(code), `${code} is raised by the Worker source (the contract list is not stale)`)
// T1 round 6 added no code for a filter that is too wide; the mapping is required exactly when the Worker has it.
assert.equal(workerCodes.has('inventory_check_task_filter_too_wide'), Object.hasOwn(REFUSAL_MESSAGES, 'inventory_check_task_filter_too_wide'), 'filter_too_wide has an entry exactly when the Worker raises it')

// ---- the figures: too many, with and without atLeast, with and without figures ----
const t = (key: string) => en[key]
const tk = (key: string) => km[key]
for (const [translate, words] of [[t, 'en'], [tk, 'km']] as const) {
  const count = taskRefusalSentence(translate, { code: 'inventory_check_task_too_many', total: 301, limit: 300 }, 'filters')
  const least = taskRefusalSentence(translate, { code: 'inventory_check_task_too_many', total: 301, limit: 300, atLeast: true }, 'filters')
  assert.ok(count && count.includes('301') && count.includes('300') && !count.includes('{'), `${words}: the exact figures are in the sentence: ${count}`)
  assert.ok(least && least.includes('301') && least.includes('300') && !least.includes('{'), `${words}: the lower bound has its own sentence: ${least}`)
  assert.notEqual(count, least, `${words}: "at least" is not the same sentence as the exact count`)
  assert.equal(taskRefusalSentence(translate, { code: 'inventory_check_task_too_many' }, 'ids'), null, `${words}: no figures: the ordinary table says it`)
  assert.equal(taskRefusalSentence(translate, { code: 'inventory_check_task_too_many', total: 'x', limit: 300 }, 'ids'), null, `${words}: a figure that is not a number is never printed`)
}
for (const key of ['inventory_check_task_too_many_count', 'inventory_check_task_too_many_at_least']) for (const pack of [en, km]) assert.ok(pack[key].includes('{total}') && pack[key].includes('{limit}'), `${key} carries {total} and {limit} in both packs`)
assert.equal(taskRefusalKey({ code: 'inventory_check_task_too_many', total: 5, limit: 4 }), 'inventory_check_task_too_many_count')
assert.equal(taskRefusalKey({ code: 'inventory_check_task_too_many', total: 5, limit: 4, atLeast: true }), 'inventory_check_task_too_many_at_least')
assert.equal(taskRefusalKey({ code: 'inventory_check_task_too_many' }), null)
// ---- a filter that resolved to nothing is not "a product cannot be counted" ----
assert.equal(taskRefusalKey({ code: 'inventory_check_product_not_eligible' }, 'filters'), 'inventory_check_task_nothing_to_count')
assert.equal(taskRefusalKey({ code: 'inventory_check_product_not_eligible' }, 'ids'), null, 'with named ids the existing sentence says it')
assert.equal(taskRefusalSentence(t, { code: 'inventory_check_product_not_eligible' }, 'ids'), null)
assert.equal(taskRefusalSentence(t, { code: 'inventory_check_product_not_eligible' }, 'filters'), en.inventory_check_task_nothing_to_count)
// ---- who has it ----
assert.equal(taskRefusalSentence(t, { code: 'inventory_check_task_picked_up', pickedUpBy: 'sok', mine: false }), 'Picked up by @sok')
assert.equal(taskRefusalSentence(t, { code: 'inventory_check_task_picked_up', mine: false }), null, 'no name: the ordinary sentence')
assert.equal(taskRefusalSentence(t, { code: 'inventory_check_task_picked_up', pickedUpBy: 'sok', mine: true }), null, 'a task I hold is not a refusal to show')
assert.ok(taskRefusalSentence(tk, { code: 'inventory_check_task_picked_up', pickedUpBy: 'sok', mine: false })?.includes('@sok'))

// ---- the retired and the new keys ----
for (const key of ['inventory_check_issues_empty', 'inventory_check_discard_counts_title', 'inventory_check_discard_counts_message', 'inventory_check_open_session']) assert.ok(!(key in en) && !(key in km), `${key} is retired from both packs`)
for (const key of ['inventory_check_task_issue_review_title', 'inventory_check_task_pickup_review_title', 'inventory_check_task_release_review_title', 'inventory_check_task_close_review_title', 'inventory_check_task_issued', 'inventory_check_task_scope_needed', 'inventory_check_task_nothing_to_count',
  'inventory_check_task_removed', 'inventory_check_task_done_closed', 'inventory_check_task_handed_back', 'inventory_check_task_release_discards', 'inventory_check_draft_restored', 'inventory_check_draft_dropped']) packs(key)
assert.ok(!('inventory_check_task_already_open' in en) && !('inventory_check_task_already_open' in km), 'the "already in an open task" row has no source (lead ruling R1): its key is not added')

// ---- names, progress, reviews ----
const issued = '2026-11-19T03:00:00.000Z'
assert.equal(taskName(t, { title: 'Shelf A', issued_at: issued, selection: { kind: 'ids' }, total: 4 }), 'Shelf A', 'a title is the name')
assert.match(taskName(t, { title: '', issued_at: issued, selection: { kind: 'ids' }, total: 4 }), /^\d\d\/\d\d\/\d{4} · Products: 4$/, 'no title: date and what it holds')
assert.match(taskName(t, { title: '', issued_at: issued, selection: { kind: 'filters', filters: { brand: 'Dior', checkedOn: '2026-11-10' } }, total: 9 }), /Brand: Dior · Last checked on: /, 'a filter task names its filters')
assert.equal(progressOrAllText(t, { total: 4, done: 1, status: 'open' }), '1/4 counted')
assert.equal(progressOrAllText(t, { total: 4, done: 4, status: 'open' }), 'All counted')
assert.equal(progressOrAllText(t, { total: 4, done: 4, status: 'closed', at_close: true }), '4/4 counted at close', 'a closed task shows its figures as of the close, not the instant between the last count and the close')
assert.equal(pickerText(t, 'sok'), 'Picked up by @sok')
const task = { title: '', issued_at: issued, selection: { kind: 'ids' as const }, total: 4, done: 1, status: 'open' as const, picked_up_by: 'sok' }
const release = taskReview(t, 'release', task, 'Main', 3)
assert.equal(release.danger, true, 'handing back with typed counts is a danger review')
assert.deepEqual(release.items.map(item => [item.label, item.value]), [['Counted', '1/4'], ['Counts not submitted', 3], ['Branch', 'Main']], 'it says how many counts are not submitted; one verb (Counted), and the total is not repeated as a Products row')
assert.equal(release.message, 'Your typed counts for this task will be discarded.', 'the red banner says the typed counts are discarded, not the task name')
assert.equal(release.note, `${taskName(t, task)} · Picked up by @sok`, 'the task and whose pickup it is move to the footnote')
assert.equal(taskReview(tk, 'release', task, 'Main', 3).message, km.inventory_check_task_release_discards, 'the same banner in Khmer')
const handBack = taskReview(t, 'release', task, 'Main', 0)
assert.equal(handBack.danger, undefined, 'with none typed there is nothing to warn about')
assert.equal(handBack.message, taskName(t, task), 'then the message is the task'); assert.equal(handBack.note, 'Picked up by @sok', 'and the note says whose pickup it gives back')
assert.equal(taskReview(t, 'release', { ...task, picked_up_by: null }, 'Main', 0).note, undefined, 'a task nobody holds has no picker to name')
assert.equal(taskReview(t, 'close', task, null).note, 'Picked up by @sok')
assert.deepEqual(taskReview(t, 'close', { ...task, done: 4 }, null).items.map(item => [item.label, item.value]), [['Counted', '4/4'], ['Branch', '—']], 'a finished task reads 4/4, not a second sentence')
assert.ok(!taskReview(t, 'pickup', task, 'Main').items.some(item => item.label === 'Products' || item.label === 'Checked'), 'no review repeats the total or says Checked')
assert.equal(taskReview(t, 'pickup', task, 'Main').confirmLabel, 'Pick up')
// ---- what an issue sends ----
assert.deepEqual(taskScopeOf(new Set([9, 3, 5]), { query: 'x', filters: { brand: 'Dior' } }), { productIds: [3, 5, 9] }, 'picks win, sorted')
assert.deepEqual(taskScopeOf(new Set(), { query: ' ', filters: { brand: 'Dior', category: '', stockState: '', checkState: 'issue', checkedOn: '' } }), { filters: { brand: 'Dior', checkState: 'issue' } }, 'empties are dropped')
assert.equal(taskScopeOf(new Set(), { query: '', filters: { brand: '', category: '' } }), null, 'nothing picked and no filter: nothing to issue')
assert.equal(filterScopeText(t, 'serum', { brand: 'Dior' }), 'Search: serum · Brand: Dior')
console.log('inventoryCheckTaskRefusals passed: every task code the Worker raises says why in both packs, with figures where it has them')
