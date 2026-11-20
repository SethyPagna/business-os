import assert from 'node:assert/strict'
import { act } from 'react'
import { createTasksWorld, open, pack, viewerUser, type Surface } from './inventoryCheckTasksWorld.ts'
import { forgetDeviceDrafts } from './inventoryCheckDeviceDrafts.ts'

// A task the board no longer lists (an old, closed one reached from a pickup row in Count sessions): the task bar says what the list answered about it, and stops pulsing.
// Before: it pulsed for ever, waiting for a progress the board would never send.
const words = pack('en')
const world = await createTasksWorld()
world.user = viewerUser('employee'); world.hideIssuer = true
const pickupRow = (id: string) => ({ id: `p-${id}`, branch_id: 1, created_by: 7, title: '', status: 'open', revision: 0, started_at: '2026-11-01T02:00:00.000Z', updated_at: '2026-11-01T02:00:00.000Z', scope: { membership: 'pickup', task: id }, branch_name: 'Main',
  task: { id, title: '', status: 'closed', total: 2, done: 2 }, progress: { total: 0, done: 0, issue: 0, unstarted: 0 } })
const bar = (surface: Surface) => surface.find(node => node.getAttribute('data-inventory-check-task-bar') !== null, 'task bar')
const pulsing = (surface: Surface) => bar(surface).querySelectorAll('span').filter(node => (node.getAttribute('class') ?? '').includes('animate-pulse')).length
const openOldTask = async () => {
  forgetDeviceDrafts(); world.calls.length = 0; world.board = []; world.taskProducts.set('t9', [2, 4]); world.failures.sessionItems = [pickupRow('t9')]
  open('sessions'); const surface = await world.mount()
  await surface.click(surface.button(/./, surface.find(node => node.getAttribute('data-inventory-check-session') === 'p-t9', 'pickup row')))
  return surface
}

// the board's answer has not come: the bar pulses (it is loading)
let release!: () => void
world.hold = new Promise<void>(resolve => { release = resolve })
let surface = await openOldTask()
assert.equal(pulsing(surface), 1, 'while the board is still being read the bar pulses')
await act(async () => { release() }); world.hold = null
await surface.settle()
// the board answered without this task: the list's own words about it, no pulse
assert.equal(pulsing(surface), 0, 'the board answered without the task: the pulse stops')
const line = surface.find(node => node.getAttribute('data-task-off-board') !== null, 'plain line')
assert.ok(line.textContent.includes(words.shift_status_closed) && line.textContent.includes(`${words.products}: 2`), `the plain line: the task is closed and holds 2 products (${line.textContent})`)
assert.ok(!/\d+\/\d+/.test(line.textContent), 'and it shows no progress figures')
assert.equal(surface.findAll(node => node.getAttribute('data-task-action') !== null && bar(surface).contains(node)).length, 0, 'and no task action (there is no board row to act on)')
await surface.unmount()

// the board read failed: still no pulse
world.failures.board = Object.assign(new Error('boom'), { status: 500 })
surface = await openOldTask()
assert.equal(pulsing(surface), 0, 'a failed board read does not leave the bar pulsing either')
assert.ok(surface.find(node => node.getAttribute('data-task-off-board') !== null, 'plain line').textContent.includes(`${words.products}: 2`))
await surface.unmount()

// the list answers the task without a total: never "Products: " with nothing after it (and never "Products: undefined")
world.omitTaskTotal = true
surface = await openOldTask()
const bare = surface.find(node => node.getAttribute('data-task-off-board') !== null, 'plain line').textContent
assert.ok(bare.includes(words.shift_status_closed), `the plain line still says the task is closed (${bare})`)
assert.ok(!bare.includes(`${words.products}:`) && !bare.includes('undefined') && !bare.includes('NaN'), `a missing total draws no Products figure (${bare})`)
world.omitTaskTotal = false
await surface.unmount()

delete world.failures.sessionItems
forgetDeviceDrafts()
await world.harness.close()
console.log('inventoryCheckTaskOffBoard passed: a task off the board shows the list\'s words, never a pulse that does not end')
