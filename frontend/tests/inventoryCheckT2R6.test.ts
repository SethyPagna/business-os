import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { REFUSAL_MESSAGES } from '../src/components/inventory/inventoryCheckRefusals.ts'
import { openTasksLimitText, progressOrAllText, taskRefusalKey, taskRefusalSentence } from '../src/components/inventory/inventoryCheckTaskText.ts'

// Count tasks T2 round 6: each assertion failed on the round-5 tip.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
const KHMER = /[ក-៿]/
const tEn = (key: string) => en[key]
const tKm = (key: string) => km[key]

// 1. A closed task's figures say they are the ones at close; an open (or reopened) task keeps the live text.
for (const key of ['inventory_check_task_progress_closed', 'inventory_check_task_limit_count']) {
  assert.ok(typeof en[key] === 'string' && en[key].trim() !== '' && !KHMER.test(en[key]), `${key}: English text`)
  assert.ok(typeof km[key] === 'string' && KHMER.test(km[key]), `${key}: Khmer text`)
}
assert.equal(progressOrAllText(tEn, { total: 10, done: 5, status: 'closed' }), '5/10 counted at close')
assert.equal(progressOrAllText(tEn, { total: 4, done: 4, status: 'closed' }), '4/4 counted at close', 'a fully counted closed task says at close too, never "All counted"')
assert.equal(progressOrAllText(tKm, { total: 10, done: 5, status: 'closed' }), km.inventory_check_task_progress_closed.replace('{done}', '5').replace('{total}', '10'))
assert.ok(progressOrAllText(tKm, { total: 10, done: 5, status: 'closed' }).includes('5/10'), 'the Khmer keeps both numbers')
assert.equal(progressOrAllText(tEn, { total: 10, done: 5, status: 'open' }), '5/10 counted', 'an open or reopened task is live: no "at close"')
assert.equal(progressOrAllText(tEn, { total: 4, done: 4, status: 'open' }), 'All counted')
assert.equal(progressOrAllText(tKm, { total: 10, done: 5, status: 'open' }), km.inventory_check_task_progress.replace('{done}', '5').replace('{total}', '10'))
assert.equal(progressOrAllText(() => undefined, { total: 3, done: 2, status: 'closed' }), '2/3 counted at close', 'no pack: the fallback is the English text')
assert.equal(en.inventory_check_task_progress_closed, '{done}/{total} counted at close')

// 2. The open-task limit refusal shows the numbers when the 409 carries both, else the old sentence.
const limit = { code: 'inventory_check_task_limit', open: 10, limit: 10 }
assert.equal(taskRefusalSentence(tEn, limit), '10 open tasks here (limit 10). Close one first.')
assert.equal(taskRefusalSentence(tKm, { ...limit, open: 11 }), km.inventory_check_task_limit_count.replace('{open}', '11').replace('{limit}', '10'))
assert.ok(taskRefusalSentence(tKm, limit)?.includes('10') && !taskRefusalSentence(tKm, limit)?.includes('{'), 'no placeholder is left')
assert.equal(taskRefusalSentence(() => undefined, limit), '10 open tasks here (limit 10). Close one first.', 'no pack: the fallback equals the English text')
assert.equal(openTasksLimitText(tEn, 3, 10), '3 open tasks here (limit 10). Close one first.')
assert.equal(taskRefusalKey(limit), 'inventory_check_task_limit_count')
for (const partial of [{ code: 'inventory_check_task_limit' }, { code: 'inventory_check_task_limit', open: 10 }, { code: 'inventory_check_task_limit', limit: 10 }, { code: 'inventory_check_task_limit', open: 'x', limit: 10 }]) {
  assert.equal(taskRefusalSentence(tEn, partial), null, 'a figure missing or not a number: the ordinary table says it')
  assert.equal(taskRefusalKey(partial), null)
}
assert.equal(REFUSAL_MESSAGES.inventory_check_task_limit.key, 'inventory_check_error_task_limit', 'the old key still answers a refusal without figures')
assert.equal(REFUSAL_MESSAGES.inventory_check_task_limit.fallback, en.inventory_check_error_task_limit)
assert.equal(taskRefusalSentence(tEn, { code: 'inventory_check_task_too_many', open: 3, limit: 4, total: 5 }), '5 products. A task holds at most 4. Narrow the selection.', 'the other refusals are untouched')

// 3. The wiring: both surfaces use progressOrAllText, and the header line says the numbers as well.
assert.ok(read('../src/components/inventory/InventoryCheckTasksList.tsx').includes('progressOrAllText(t, task)'), 'the board row')
assert.ok(read('../src/components/inventory/InventoryChecksPage.tsx').includes('progressOrAllText(t, taskRow)'), 'the task view bar')
assert.ok(read('../src/components/inventory/InventoryChecksPage.tsx').includes('openTasksLimitText(t, openTasks, tasks.board.capabilities.maxOpenTasks)'), 'the pre-emptive header line')

// 4. The figures reach the screen: the transport's error carries them (before this, only the code did, so no figure was ever shown in production).
const http = read('../src/api/http.ts')
assert.ok(http.includes("parsed.code.startsWith('inventory_check_task_')"), 'createApiError keeps count-task figures')
for (const key of ["'open', 'limit', 'total'", 'error.atLeast = true', 'error.pickedUpBy = parsed.pickedUpBy', 'error.mine = parsed.mine']) assert.ok(http.includes(key), `createApiError carries ${key}`)

console.log('inventoryCheckT2R6 ok')
