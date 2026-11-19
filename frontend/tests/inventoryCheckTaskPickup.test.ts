import assert from 'node:assert/strict'
import { createTasksWorld, open, pack, task, taskRowOf, actionIn, viewerUser, type Surface } from './inventoryCheckTasksWorld.ts'

// Pick up: the review before anything is sent, the frozen request, the task view that opens, and every pickup refusal.
const words = pack('en')
const world = await createTasksWorld()
world.user = viewerUser('employee'); world.hideIssuer = true
world.taskProducts.set('t1', [2, 4, 6, 8])
const reset = () => { world.board = [task('t1', { can_pickup: true }), task('t2', { picked_up_by: 'dara', can_pickup: false }), task('t3', { status: 'closed', can_pickup: false })]; world.calls.length = 0; world.notices.length = 0 }
const confirm = async (surface: Surface, label: string) => { await surface.click(surface.findAll(node => node.tagName === 'BUTTON' && node.textContent === label).at(-1)!) }
const pickUp = async (surface: Surface) => { await surface.click(actionIn(surface, taskRowOf(surface, 't1'), 'pickup')!); await confirm(surface, words.inventory_check_task_pickup) }

// ---- the review shows its values first, then Confirm sends ONE request with a request id, and the task view opens on the task's own list ----
reset(); open('tasks')
let surface = await world.mount()
await surface.click(actionIn(surface, taskRowOf(surface, 't1'), 'pickup')!)
assert.equal(world.count('pickup'), 0, 'nothing is sent before the review is answered')
const dialog = surface.text()
assert.ok(dialog.includes(words.inventory_check_task_pickup_review_title) && dialog.includes('Main') && dialog.includes(words.products) && dialog.includes('0/4 counted'), 'the review shows the task, its products, its progress and the branch from its first paint')
await confirm(surface, words.inventory_check_task_pickup)
assert.equal(world.count('pickup'), 1); assert.equal(world.ofRoute('pickup')[0].params.id, 't1')
assert.match(String(world.ofRoute('pickup')[0].params.requestId), /^[A-Za-z0-9_-]{8,120}$/, 'the request carries a request id')
const list = world.ofRoute('list').at(-1)!.params
assert.equal(list.taskId, 't1', 'the view reads the task\'s own list'); assert.equal(String(list.branchId), '1'); assert.equal(list.summary, 0, 'with no branch-wide summary'); assert.equal('ids' in list, false)
assert.ok(surface.findAll(node => node.getAttribute('data-inventory-check-row') !== null).length === 4, 'exactly the task\'s four products')
assert.ok(surface.find(node => node.getAttribute('data-inventory-check-task-bar') !== null, 'task bar').textContent.includes('0/4 counted'))
await surface.unmount()

// ---- 409 with mine: true is the success this asked for ----
reset(); world.failures.pickup = Object.assign(new Error('held'), { status: 409, code: 'inventory_check_task_picked_up', mine: true, pickedUpBy: 'sok' }); open('tasks')
surface = await world.mount(); await pickUp(surface)
assert.equal(world.ofRoute('list').at(-1)?.params.taskId, 't1', 'a task I already hold opens its view')
await surface.unmount()

// ---- 409 with someone else: their name, and the board is read again ----
reset(); world.failures.pickup = Object.assign(new Error('held'), { status: 409, code: 'inventory_check_task_picked_up', mine: false, pickedUpBy: 'dara' }); open('tasks')
surface = await world.mount(); await pickUp(surface)
assert.ok(world.notices.some(notice => notice.tone === 'warning' && notice.text === 'Picked up by @dara'), 'the notice names who has it')
assert.equal(world.count('list'), 0, 'no view opens'); assert.equal(world.count('tasks'), 2, 'and the board is read again')
await surface.unmount()

// ---- closed, and gone: their sentences, then the board is read again ----
for (const [code, status, sentence] of [['inventory_check_task_closed', 409, words.inventory_check_error_task_closed], ['inventory_check_task_not_found', 404, words.inventory_check_error_task_not_found]] as const) {
  reset(); world.failures.pickup = Object.assign(new Error(code), { status, code }); open('tasks')
  surface = await world.mount(); await pickUp(surface)
  assert.ok(surface.text().includes(sentence), `${code}: its sentence is shown`)
  assert.equal(world.count('tasks'), 2, `${code}: and the board is read again`); assert.equal(world.count('list'), 0)
  await surface.unmount()
}

// ---- Count sessions: a pickup row carries the task's ring and text, and opens the task view, never the session sheet ----
reset(); world.failures.sessionItems = [{ id: 'p1', branch_id: 1, created_by: 7, title: '', status: 'open', revision: 0, started_at: '2026-11-19T02:00:00.000Z', updated_at: '2026-11-19T02:00:00.000Z', scope: { membership: 'pickup', task: 't1' }, branch_name: 'Main',
  task: { id: 't1', title: '', status: 'open', total: 4, done: 1 }, progress: { total: 0, done: 0, issue: 0, unstarted: 0 } }]
open('sessions')
surface = await world.mount()
const sessionRow = surface.find(node => node.getAttribute('data-inventory-check-session') === 'p1', 'pickup row')
assert.ok(sessionRow.getAttribute('data-session-pickup') !== null && sessionRow.textContent.includes('1/4 counted'), 'the pickup row shows its task\'s progress, not an empty 0/0')
assert.equal(sessionRow.querySelectorAll('svg[role="img"]').some(icon => icon.getAttribute('aria-label') === words.inventory_check_tasks), true, 'and the Tasks icon')
await surface.click(surface.button(/./, sessionRow))
assert.equal(world.ofRoute('list').at(-1)?.params.taskId, 't1', 'a tap opens the task view')
assert.ok(surface.find(node => node.getAttribute('data-inventory-check-task-bar') !== null, 'task bar'))
await surface.unmount()
delete world.failures.sessionItems
console.log('inventoryCheckTaskPickup passed: review first, one request with an id, the view opens, every refusal says its sentence, the pickup row opens the task')
