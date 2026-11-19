import assert from 'node:assert/strict'
import { act } from 'react'
import { actionIn, createTasksWorld, open, pack, task, taskRowOf, viewerUser, type Surface } from './inventoryCheckTasksWorld.ts'
import { forgetDeviceDrafts } from './inventoryCheckDeviceDrafts.ts'

// Close task sends the revision of the board row it was pressed on (ruling R2: the close is refused if the task changed since the board was read), never none and never 0.
// The test board's default revision is 0, which would hide a close that sends 0; every row here carries a real, different, nonzero one.
const words = pack('en')
const world = await createTasksWorld()
world.user = viewerUser('admin')
const reset = () => {
  forgetDeviceDrafts(); world.calls.length = 0; world.notices.length = 0; world.failures = {}
  world.taskProducts.set('a', [2, 4]); world.taskProducts.set('b', [6, 8])
  world.board = [task('a', { revision: 7, total: 2, picked_up_by: 'boss', mine: true, can_pickup: false, can_release: true, can_close: true }), task('b', { revision: 12, total: 2, can_pickup: true, can_close: true })]
}
const confirm = async (surface: Surface, label: string) => { await surface.click(surface.findAll(node => node.tagName === 'BUTTON' && node.textContent === label).at(-1)!) }
const foreground = async (surface: Surface) => { await act(async () => { document.dispatchEvent(new Event('visibilitychange')) }); await surface.settle() }
const sentRevisions = () => world.ofRoute('close').map(call => [call.params.id, call.params.revision])

// ---- from the board: the review shows the task first (title, products, progress, branch), and Close sends THAT row's revision ----
reset(); open('tasks')
let surface = await world.mount()
await surface.click(actionIn(surface, taskRowOf(surface, 'b'), 'close')!)
const review = surface.text()
assert.ok(review.includes(words.inventory_check_task_close_review_title) && review.includes(words.products) && review.includes('Main'), 'the review is whole from its first paint')
assert.equal(world.count('close'), 0, 'nothing is sent before Confirm')
await confirm(surface, words.inventory_check_task_close)
assert.deepEqual(sentRevisions(), [['b', 12]], 'row b was closed with b\'s revision (12), not a, not 0, not none')
assert.match(String(world.ofRoute('close')[0].params.requestId), /^[A-Za-z0-9_-]{8,120}$/)
await surface.click(actionIn(surface, taskRowOf(surface, 'a'), 'close')!); await confirm(surface, words.inventory_check_task_close)
assert.deepEqual(sentRevisions(), [['b', 12], ['a', 7]], 'row a is closed with a\'s own revision (7)')

// ---- the row the board read last is the one used: a task that changed since (revision 9) is closed with 9, not the one the screen first showed ----
reset(); await surface.unmount(); open('tasks'); surface = await world.mount()
world.board[0].revision = 9; await foreground(surface)
await surface.click(actionIn(surface, taskRowOf(surface, 'a'), 'close')!); await confirm(surface, words.inventory_check_task_close)
assert.deepEqual(sentRevisions(), [['a', 9]], 'the revision of the latest board read')
await surface.unmount()

// ---- from a task view: the bar's Close sends the same row's revision ----
reset(); open('tasks'); surface = await world.mount()
await surface.click(surface.find(node => node.getAttribute('data-task-open') !== null && taskRowOf(surface, 'a').contains(node), 'task row a'))
const bar = surface.find(node => node.getAttribute('data-inventory-check-task-bar') !== null, 'task bar')
await surface.click(surface.find(node => node.getAttribute('data-task-action') === 'close' && bar.contains(node), 'bar Close'))
await confirm(surface, words.inventory_check_task_close)
assert.deepEqual(sentRevisions(), [['a', 7]], 'the view\'s Close sends the board row\'s revision')
await surface.unmount()
forgetDeviceDrafts()
await world.harness.close()
console.log('inventoryCheckTaskClose passed: Close task sends the board row\'s own nonzero revision from the board and from the view')
