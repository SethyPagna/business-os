import assert from 'node:assert/strict'
import { act } from 'react'
import { APP_NAVIGATION_EVENT } from '../src/app/pathRouting.ts'
import { countInput, createTasksWorld, open, pack, task, taskRowOf, viewerUser, type Surface } from './inventoryCheckTasksWorld.ts'
import { forgetDeviceDrafts } from './inventoryCheckDeviceDrafts.ts'

// Leaving a task view (by a section chip, or by the hardware Back button) leaves the task: counts typed afterwards on Inventory belong to the plain list's key, never to the task's.
// Before the fix the task stayed selected, the screen kept its task key, and the plain list read and wrote the task's saved counts.
const words = pack('en')
const world = await createTasksWorld()
world.user = viewerUser('employee'); world.hideIssuer = true
const keys = () => { const out: string[] = []; for (let index = 0; index < localStorage.length; index += 1) { const key = localStorage.key(index); if (key?.startsWith('businessos_draft_v2_')) out.push(decodeURIComponent(key)) } return out }
const readRaw = (decoded: string) => { for (let index = 0; index < localStorage.length; index += 1) { const raw = localStorage.key(index)!; if (decodeURIComponent(raw) === decoded) return JSON.parse(localStorage.getItem(raw)!) } return null }
const stored = () => Object.fromEntries(keys().map(key => [key.replace(/^.*_inventory-check-counts_/, ''), Object.keys(readRaw(key)?.data?.entries ?? {})]))
const reset = () => {
  forgetDeviceDrafts(); world.calls.length = 0; world.notices.length = 0; world.checks.clear()
  world.taskProducts.set('t1', [2, 4, 6, 8]); world.board = [task('t1', { picked_up_by: 'sok', mine: true, can_pickup: false, can_release: true })]
}
const openView = async () => { open('tasks'); const surface = await world.mount(); await surface.click(surface.find(node => node.getAttribute('data-task-open') !== null && taskRowOf(surface, 't1').contains(node), 'task row')); return surface }
const inTaskView = (surface: Surface) => surface.findAll(node => node.getAttribute('data-inventory-check-task-bar') !== null).length === 1
const rowsShown = (surface: Surface) => surface.findAll(node => node.getAttribute('data-inventory-check-row') !== null).map(node => node.getAttribute('data-inventory-check-row'))

// The two ways out of a task view that are not its own Back button.
const byChip = async (surface: Surface) => { await surface.click(surface.button(words.inventory)) }
const byHardwareBack = async (surface: Surface) => {
  window.history.pushState(null, '', '/inventory#hub:inventory:products')
  await act(async () => { window.dispatchEvent(new CustomEvent(APP_NAVIGATION_EVENT, { detail: { page: 'inventory', path: '/inventory', anchor: 'hub:inventory:products' } })) })
  await surface.settle()
}

for (const [name, leave] of [['the Inventory chip', byChip], ['the hardware Back button', byHardwareBack]] as const) {
  reset()
  const surface = await openView()
  assert.ok(inTaskView(surface), `${name}: the view is open`)
  assert.deepEqual(rowsShown(surface), ['2', '4', '6', '8'], `${name}: it lists exactly the task's products`)
  await leave(surface)
  await surface.settle()
  assert.ok(!inTaskView(surface), `${name}: the task bar is gone`)
  assert.equal(world.ofRoute('list').at(-1)?.params.taskId, undefined, `${name}: the list is read without the task`)
  assert.ok(rowsShown(surface).includes('3'), `${name}: the whole list is shown (product 3 is not in the task)`)
  // Counts typed now are the plain list's.
  await surface.type(countInput(surface, 3), '9')
  await surface.settle()
  assert.deepEqual(stored(), { '1_list': ['3'] }, `${name}: the count is kept under the plain list's key, and nothing is stored under the task's`)
  assert.equal(world.calls.filter(call => call.route === 'submissions').length, 0, `${name}: nothing is sent`)
  await surface.unmount()
}

// A task's own counts are not shown on the plain list: counts typed IN the task stay with the task.
reset()
let surface = await openView()
await surface.type(countInput(surface, 2), '5'); await surface.settle()
assert.deepEqual(stored(), { '1_t1': ['2'] }, 'a count typed in the task view is kept under the task')
await surface.unmount()
open('products'); surface = await world.mount()
assert.equal((countInput(surface, 2) as unknown as { value: string }).value, '', 'the plain list does not show the task\'s count')
await surface.unmount()
forgetDeviceDrafts()
await world.harness.close()
console.log('inventoryCheckTaskLeave passed: leaving a task view by the chip or by hardware Back leaves the task, and counts typed afterwards go under the plain list')
