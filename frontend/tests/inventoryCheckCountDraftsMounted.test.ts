import assert from 'node:assert/strict'
import { countInput, createTasksWorld, open, pack, rowOf, task, taskRowOf, viewerUser, type Surface } from './inventoryCheckTasksWorld.ts'
import { forgetDeviceDrafts } from './inventoryCheckDeviceDrafts.ts'
import * as dirtyWork from '../src/utils/dirtyWork.ts'

// Typed counts are kept on the device (one key per user, branch and task or the plain list), restored with a notice, judged against what the server knows now,
// and offered to the leave guard as "Save & Leave". Nothing here sends a request.
const words = pack('en')
const world = await createTasksWorld()
world.user = viewerUser('employee'); world.hideIssuer = true
const keys = () => { const out: string[] = []; for (let index = 0; index < localStorage.length; index += 1) { const key = localStorage.key(index); if (key?.startsWith('businessos_draft_v2_')) out.push(decodeURIComponent(key)) } return out }
const readRaw = (decoded: string) => { for (let index = 0; index < localStorage.length; index += 1) { const raw = localStorage.key(index)!; if (decodeURIComponent(raw) === decoded) return JSON.parse(localStorage.getItem(raw)!) } return null }
const draftOf = (needle: string) => { const key = keys().find(candidate => candidate.endsWith(needle)); return key ? readRaw(key)?.data : null }
const value = (surface: Surface, id: number) => (countInput(surface, id) as unknown as { value: string }).value
const reset = () => { forgetDeviceDrafts(); world.calls.length = 0; world.notices.length = 0; world.guard = null; world.checks.clear(); world.failures = {}; world.productCount = 25; world.board = [task('t1', { picked_up_by: 'sok', mine: true, can_pickup: false, can_release: true })]; world.taskProducts.set('t1', [2, 4]) }
const mountList = async () => { open('products'); return world.mount() }
const confirm = async (surface: Surface, label: string) => { await surface.click(surface.findAll(node => node.tagName === 'BUTTON' && node.textContent === label).at(-1)!) }

// ---- write: the key holds the branch and "list" (or the task); the data holds the typed count and the row's last-count time ----
reset()
let surface = await mountList()
await surface.type(countInput(surface, 3), '9')
await surface.settle()
assert.deepEqual(keys().map(key => key.replace(/^.*_inventory-check-counts_/, '')), ['1_list'], 'one key, for this branch and the plain list')
assert.equal(draftOf('1_list')?.entries['3'].count, '9'); assert.equal(draftOf('1_list')?.entries['3'].checkAt, null, 'the row had no count when it was typed')
assert.equal(world.calls.filter(call => ['submissions', 'issue', 'pickup'].includes(call.route)).length, 0, 'nothing is sent to the server')

// ---- the guard: every entry offers Save; Stay keeps everything; Save & Leave writes, leaves and says so; Discard & Leave clears the store ----
await surface.click(surface.button(words.inventory_check_sessions))
assert.ok(world.guard && world.guard.length === 1 && world.guard.every(entry => typeof entry.save === 'function'), 'the guard is raised, and Save & Leave is offered (every dirty entry has save)')
assert.equal(world.guard![0].label, words.inventory_check_counts_in_progress)
assert.equal(value(surface, 3), '9', 'Stay: nothing changed'); assert.equal(dirtyWork.getDirtyWork().length, 1)
world.notices.length = 0
assert.equal(await world.guard![0].save!(), true, 'Save & Leave saves')
assert.ok(world.notices.some(notice => notice.text === words.inventory_check_draft_saved && notice.tone === 'success'), 'and says so')
assert.equal(dirtyWork.getDirtyWork().length, 0, 'the guard sees nothing left dirty, so navigation goes on')
world.guard = null
await surface.unmount()

// ---- restore: a remount brings the count back, with its notice ----
world.notices.length = 0
surface = await mountList()
assert.equal(value(surface, 3), '9', 'the typed count is back'); assert.ok(world.notices.some(notice => notice.text === words.inventory_check_draft_restored && notice.tone === 'info'), 'with "Counts restored from this device."')
// Discard & Leave clears the store
await surface.click(surface.button(words.inventory_check_sessions))
world.guard![0].discard!()
await surface.settle()
assert.deepEqual(keys(), [], 'Discard & Leave leaves nothing on the device')
await surface.unmount()

// ---- the drop rule: a product counted elsewhere after it was typed loses its draft; the control keeps its own ----
reset()
surface = await mountList()
await surface.type(countInput(surface, 3), '9'); await surface.type(countInput(surface, 5), '7'); await surface.settle()
await surface.unmount()
world.checks.set(3, { at: '2026-11-19T06:00:00.000Z', state: 'done', counted_quantity: 8 })
world.notices.length = 0
surface = await mountList()
assert.equal(value(surface, 3), '', 'a row whose last-count time changed since it was typed is dropped'); assert.equal(value(surface, 5), '7', 'the control, whose time did not change, is kept')
assert.ok(world.notices.some(notice => notice.text === words.inventory_check_draft_dropped.replace('{count}', '1')), 'one notice names how many went')
assert.ok(world.notices.some(notice => notice.text === words.inventory_check_draft_restored), 'and one says the rest came back')
await surface.unmount()

// ---- off the page: judged by ONE overlay read of just those ids, with no summary ----
reset()
surface = await mountList()
await surface.click(surface.button('Next', surface.find(node => node.getAttribute('data-inventory-check-pager-lock') !== null, 'pager')))
await surface.type(countInput(surface, 22), '4'); await surface.settle()
await surface.unmount()
world.checks.set(22, { at: '2026-11-19T06:00:00.000Z', state: 'done', counted_quantity: 1 })
world.calls.length = 0
surface = await mountList()
const offPage = world.ofRoute('overlay').filter(call => call.params.ids === '22')
assert.equal(offPage.length, 1, 'ONE overlay read names the off-page product'); assert.equal(offPage[0].params.summary, false, 'with no summary')
assert.equal(draftOf('1_list') === null || !draftOf('1_list').entries['22'], true, 'and its draft is dropped')
await surface.unmount()

// ---- keys apart: a task keeps its own drafts, apart from the plain list ----
reset()
surface = await mountList()
await surface.type(countInput(surface, 3), '9'); await surface.settle(); await surface.unmount()
open('tasks'); surface = await world.mount()
await surface.click(surface.find(node => node.getAttribute('data-task-open') !== null && taskRowOf(surface, 't1').contains(node), 'task'))
assert.equal(surface.findAll(node => node.getAttribute('data-check-count') !== null && rowOf(surface, 2).contains(node)).length, 1, 'the task view is open')
assert.equal(value(surface, 2), '', 'the plain list\'s draft is not in the task')
await surface.type(countInput(surface, 2), '6'); await surface.settle()
assert.deepEqual(keys().map(key => key.replace(/^.*_inventory-check-counts_/, '')).sort(), ['1_list', '1_t1'], 'the plain list and the task are kept apart, per branch')
await surface.unmount()

// ---- pending: an unknown outcome keeps its request id across a reload, so a Retry never records the counts twice ----
reset()
surface = await mountList()
await surface.type(countInput(surface, 3), '9'); await surface.type(countInput(surface, 5), '7')
world.failures.submit = Object.assign(new Error('answer lost'), { outcome: 'unknown' })
await surface.click(surface.find(node => node.getAttribute('data-selection-action') === 'submit', 'Submit')); await confirm(surface, words.inventory_check_submit)
const first = world.ofRoute('submissions')[0].params.requestId as string
assert.ok(first, 'the first send carries a request id')
await surface.settle(); await surface.unmount()
assert.equal(draftOf('1_list')?.pending?.requestId, first, 'the frozen request is on the device')
surface = await mountList()
world.calls.length = 0
await surface.click(surface.find(node => node.getAttribute('data-selection-action') === 'submit', 'Retry'))
assert.equal(world.ofRoute('submissions')[0]?.params.requestId, first, 'after a reload the Retry sends the SAME request id (and asks nothing again)')
await surface.unmount()
await world.harness.close()
console.log('inventoryCheckCountDraftsMounted passed: write, the three-option guard with Save, restore, the drop rule, off-page judging, keys apart, pending Retry')
