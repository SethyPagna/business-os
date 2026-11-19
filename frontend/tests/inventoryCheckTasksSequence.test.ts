import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { installSteppedClock } from './mountedComponentHarness.ts'
import { actionIn, countInput, createTasksWorld, open, pack, task, taskRowOf, viewerUser, type Surface } from './inventoryCheckTasksWorld.ts'

// The request-count sequence of the Tasks screens (spec section 8): each action costs exactly these requests, and nothing polls.
const words = pack('en')
const world = await createTasksWorld()
world.user = viewerUser('employee'); world.hideIssuer = true
world.taskProducts.set('t1', [2, 4])
world.board = [task('t1', { total: 2, can_pickup: true })]
const routes = () => world.calls.map(call => call.route).join(',')
const confirm = async (surface: Surface, label: string) => { await surface.click(surface.findAll(node => node.tagName === 'BUTTON' && node.textContent === label).at(-1)!) }
const foreground = async (surface: Surface) => { await act(async () => { document.dispatchEvent(new Event('visibilitychange')) }); await surface.settle() }

// open Tasks: ONE board read, no list, no overlay; reopening: one again
open('tasks'); let surface = await world.mount()
assert.equal(routes(), 'branches,tasks', 'a cold open with no branch known: the branch list, then ONE board read')
await surface.unmount(); world.reset(); open('tasks'); surface = await world.mount()
assert.equal(routes(), 'branches,tasks', 'reopening the page: the branch is found again, then ONE board read (the held rows draw at once)')
// Pick up -> the view: 1 pickup, 1 /tasks, 1 /list, 1 /overlay
world.reset()
await surface.click(actionIn(surface, taskRowOf(surface, 't1'), 'pickup')!); await confirm(surface, words.inventory_check_task_pickup)
assert.deepEqual(routes().split(',').sort(), ['list', 'overlay', 'pickup', 'tasks'], 'pick up -> the view: 1 pickup, 1 board read, 1 list, 1 overlay')
// the app returns to the foreground: one board read
world.reset(); await foreground(surface)
assert.equal(routes(), 'tasks', 'visible: ONE board read')
// Submit in the view: the submission, the reload (list + overlay) and one board read
await surface.type(countInput(surface, 2), '5'); world.reset()
await surface.click(surface.find(node => node.getAttribute('data-selection-action') === 'submit', 'Submit')); await confirm(surface, words.inventory_check_submit)
assert.deepEqual(routes().split(',').sort(), ['list', 'overlay', 'submissions', 'tasks'], 'Submit in the view: 1 submission, the reload, 1 board read')
// Back: one board read
world.reset(); await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === words.back, 'Back'))
assert.equal(routes(), 'tasks', 'Back: ONE board read')
// nothing polls: ten minutes of the clock with the board shown send nothing
world.reset()
const clock = installSteppedClock()
try { clock.advance(10 * 60 * 1000); await surface.settle(); await new Promise(resolve => setTimeout(resolve, 100)); await surface.settle() } finally { clock.restore() }
assert.equal(routes(), '', 'ten minutes with the board shown: zero requests')
for (const file of ['useInventoryCheckTasks.ts', 'InventoryCheckTasksList.tsx']) assert.ok(!/setInterval/.test(readFileSync(new URL(`../src/components/inventory/${file}`, import.meta.url), 'utf8')), `${file} has no interval`)
await surface.unmount()
console.log('inventoryCheckTasksSequence passed: the request count of every task action, and no polling')
