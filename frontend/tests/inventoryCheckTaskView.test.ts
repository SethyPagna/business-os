import assert from 'node:assert/strict'
import { act } from 'react'
import { countInput, createTasksWorld, open, pack, task, taskRowOf, viewerUser, type Surface } from './inventoryCheckTasksWorld.ts'

// The task view: the wired list restricted to a task, its bar from the board, Submit with the task, and the three states the board can announce meanwhile.
const words = pack('en')
const world = await createTasksWorld()
world.user = viewerUser('employee'); world.hideIssuer = true
const reset = () => {
  world.taskProducts.set('t1', [2, 4, 6, 8]); world.checks.clear(); world.calls.length = 0; world.notices.length = 0; world.forceClosed = false; world.productsPerSubmission = 40
  world.board = [task('t1', { picked_up_by: 'sok', mine: true, can_pickup: false, can_release: true, done: 1 })]
  world.checks.set(8, { at: '2026-11-18T10:00:00.000Z', state: 'done', counted_quantity: 8 }); world.board[0].done = 1
}
const confirm = async (surface: Surface, label: string) => { await surface.click(surface.findAll(node => node.tagName === 'BUTTON' && node.textContent === label).at(-1)!) }
const submitButton = (surface: Surface) => surface.find(node => node.getAttribute('data-selection-action') === 'submit', 'Submit')
const bar = (surface: Surface) => surface.find(node => node.getAttribute('data-inventory-check-task-bar') !== null, 'task bar')
const openView = async () => { open('tasks'); const surface = await world.mount(); await surface.click(surface.find(node => node.getAttribute('data-task-open') !== null && taskRowOf(surface, 't1').contains(node), 'task row')); return surface }
const foreground = async (surface: Surface) => { await act(async () => { document.dispatchEvent(new Event('visibilitychange')) }); await surface.settle() }

// ---- the bar shows the board's progress; the list is the task's, with no ids and no summary; counts submit part-way WITH the task ----
reset()
let surface = await openView()
assert.ok(bar(surface).textContent.includes('1/4 counted') && bar(surface).textContent.includes('Picked up by @sok'), 'the bar shows the progress and the picker from the board')
const list = world.ofRoute('list').at(-1)!.params
assert.equal(list.taskId, 't1'); assert.equal(list.summary, 0); assert.equal('ids' in list, false); assert.equal(world.count('products-old'), 0)
assert.deepEqual(surface.findAll(node => node.getAttribute('data-inventory-check-row') !== null).map(node => node.getAttribute('data-inventory-check-row')), ['2', '4', '6', '8'], 'exactly the task\'s products')
assert.equal(surface.findAll(node => node.getAttribute('data-day-chip') !== null).length, 0, 'no date chips in a task')
await surface.type(countInput(surface, 2), '8'); await surface.type(countInput(surface, 4), '8')
world.reset()
await surface.click(submitButton(surface)); await confirm(surface, words.inventory_check_submit)
const sent = world.ofRoute('submissions')[0]?.params as { taskId?: string; lines: Array<{ productId: number }> }
assert.equal(sent.taskId, 't1', 'the submission names the task'); assert.deepEqual(sent.lines.map(line => line.productId), [2, 4], 'part-way is allowed')
assert.equal(world.count('tasks'), 1, 'one board read after the submission')
assert.ok(bar(surface).textContent.includes('3/4 counted'), 'the bar reads the new progress')
// the last count: the answer says the task closed, no drafts are left: back to the board
await surface.type(countInput(surface, 6), '8')
await surface.click(submitButton(surface)); await confirm(surface, words.inventory_check_submit)
assert.ok(world.notices.some(notice => notice.text === words.inventory_check_task_done_closed), 'All counted. The task is closed.')
assert.equal(surface.findAll(node => node.getAttribute('data-inventory-check-task-bar') !== null).length, 0, 'and the view returns to the board')
assert.equal(taskRowOf(surface, 't1').getAttribute('data-task-status'), 'closed', 'where the task is Closed')
await surface.unmount()

// ---- closed by this submission with drafts left (the cap kept some): the view stays, shows Closed, and Submit still works ----
reset(); world.forceClosed = true; world.productsPerSubmission = 1
surface = await openView()
for (const id of [2, 4]) await surface.type(countInput(surface, id), '5')
await surface.click(submitButton(surface)); await confirm(surface, words.inventory_check_submit)
assert.equal(surface.findAll(node => node.getAttribute('data-inventory-check-task-bar') !== null).length, 1, 'with a count left over the view stays')
assert.ok(bar(surface).textContent.includes(words.shift_status_closed), 'and shows Closed')
assert.equal(submitButton(surface).getAttribute('aria-disabled'), null, 'Submit still works for the count left')
await surface.unmount()

// ---- closed by someone else meanwhile: the status line, drafts kept, Submit enabled (the Worker accepts counts for a closed task) ----
reset()
surface = await openView()
await surface.type(countInput(surface, 2), '5')
Object.assign(world.board[0], { status: 'closed', can_pickup: false, can_release: false })
await foreground(surface)
assert.ok(surface.text().includes(words.inventory_check_error_task_closed), 'the status line says the task is already closed')
assert.ok(bar(surface).textContent.includes(words.shift_status_closed))
assert.equal((countInput(surface, 2) as unknown as { value: string }).value, '5', 'the typed count is kept'); assert.equal(submitButton(surface).getAttribute('aria-disabled'), null, 'and Submit stays enabled')
assert.equal(surface.findAll(node => node.getAttribute('data-task-action') === 'pickup').length, 0, 'Pick up is hidden')
await surface.unmount()

// ---- handed back while counting (mine true, then false): its own line, Pick up again, drafts kept, Submit works ----
reset()
surface = await openView()
await surface.type(countInput(surface, 4), '6')
assert.equal(surface.text().includes(words.inventory_check_task_handed_back), false, 'no line while I still hold it')
Object.assign(world.board[0], { picked_up_by: null, mine: false, can_pickup: true, can_release: false })
world.reset()
await foreground(surface)
assert.equal(world.count('tasks'), 1, 'coming back to the app reads the board once')
assert.ok(surface.text().includes(words.inventory_check_task_handed_back), 'This task was handed back. Your counts are kept.')
assert.equal(surface.findAll(node => node.getAttribute('data-task-action') === 'pickup').length, 1, 'Pick up is offered again')
assert.equal((countInput(surface, 4) as unknown as { value: string }).value, '6', 'the draft is kept'); assert.equal(submitButton(surface).getAttribute('aria-disabled'), null)
await surface.unmount()
console.log('inventoryCheckTaskView passed: the task list, the bar, Submit with the task, close, closed elsewhere and handed back')
