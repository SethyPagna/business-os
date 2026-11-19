import assert from 'node:assert/strict'
import { act } from 'react'
import { advanceSourceTimers, installSteppedClock } from './mountedComponentHarness.ts'
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
// A Submit that finishes the task reads the board ONCE: the board it returns to reads itself (it used to be read here as well)
await surface.click(surface.find(node => node.getAttribute('data-task-open') !== null && taskRowOf(surface, 't1').contains(node), 'task row'))
await surface.type(countInput(surface, 4), '5'); world.reset()
await surface.click(surface.find(node => node.getAttribute('data-selection-action') === 'submit', 'Submit')); await confirm(surface, words.inventory_check_submit)
assert.equal(routes(), 'submissions,tasks', 'a Submit that closes the task: the submission and ONE board read')
assert.equal(taskRowOf(surface, 't1').getAttribute('data-task-status'), 'closed', 'and the board shows it closed')
// nothing polls: ten minutes on fake timers (every timeout and interval the page set runs, in order, with Date moving too) with the board shown send nothing
const tenMinutes = async () => {
  const clock = installSteppedClock()
  try { await act(async () => { await advanceSourceTimers(10 * 60 * 1000, clock) }); await surface.settle() } finally { clock.restore() }
}
world.reset(); await tenMinutes()
assert.equal(routes(), '', 'ten minutes with the board shown: zero requests')
// a pickup answered 409 "mine: true" opens the task I already hold: ONE board read (the view reads it when it opens), not two
world.taskProducts.set('t2', [6, 8]); world.board.push(task('t2', { total: 2, can_pickup: true }))
await foreground(surface); world.reset()
world.failures.pickup = Object.assign(new Error('mine'), { status: 409, code: 'inventory_check_task_picked_up', mine: true })
await surface.click(actionIn(surface, taskRowOf(surface, 't2'), 'pickup')!); await confirm(surface, words.inventory_check_task_pickup)
assert.deepEqual(routes().split(',').sort(), ['list', 'overlay', 'pickup', 'tasks'], 'pickup answered mine: the pickup, the list, the overlay and ONE board read')
world.reset(); await tenMinutes()
assert.equal(routes(), '', 'ten minutes in a task view: zero requests')
await surface.unmount()
await world.harness.close()

// The proof has teeth: a poll written as setTimeout, or as setInterval, planted in the board hook is caught by the same ten minutes.
const AFTER = 'useEffect(() => { if (enabled) void refresh() }, [enabled, refresh])'
const planted = {
  setTimeout: `${AFTER}\n  useEffect(() => { if (!enabled) return; let timer: ReturnType<typeof setTimeout>; const loop = () => { void refresh(); timer = setTimeout(loop, 30000) }; timer = setTimeout(loop, 30000); return () => clearTimeout(timer) }, [enabled, refresh])`,
  setInterval: `${AFTER}\n  useEffect(() => { if (!enabled) return; const timer = setInterval(() => { void refresh() }, 30000); return () => clearInterval(timer) }, [enabled, refresh])`,
}
for (const [kind, code] of Object.entries(planted)) {
  const bad = await createTasksWorld({ mutateSource: (key, source) => key.endsWith('useInventoryCheckTasks.ts') ? (source.includes(AFTER) ? source.replace(AFTER, code) : (() => { throw new Error('the planted poll found no anchor') })()) : source })
  bad.user = viewerUser('employee'); bad.hideIssuer = true; bad.board = [task('t1', { total: 2, can_pickup: true })]
  open('tasks'); const board = await bad.mount()
  bad.reset()
  const clock = installSteppedClock()
  try { await act(async () => { await advanceSourceTimers(10 * 60 * 1000, clock) }); await board.settle() } finally { clock.restore() }
  assert.ok(bad.count('tasks') >= 15, `a ${kind} poll every 30 seconds is caught: ${bad.count('tasks')} board reads in ten minutes`)
  await board.unmount(); await bad.harness.close()
}
console.log('inventoryCheckTasksSequence passed: the request count of every task action, and no polling (ten minutes of fake timers; a planted setTimeout and setInterval poll both fail it)')
