import assert from 'node:assert/strict'
import { createTasksWorld, open, pack, task, taskRowOf, viewerUser } from './inventoryCheckTasksWorld.ts'
import { forgetDeviceDrafts } from './inventoryCheckDeviceDrafts.ts'

// Inside a task view the status chips carry no figures: the task's list is read with summary=0, and a branch-wide count (Not checked 25, ...) beside four rows of a task would be wrong.
// Also the task bar's Back is a 44 px target on a phone and the app's 40 px on a desktop.
const words = pack('en')
const world = await createTasksWorld()
world.user = viewerUser('employee'); world.hideIssuer = true
forgetDeviceDrafts()
world.taskProducts.set('t1', [2, 4, 6, 8]); world.board = [task('t1', { picked_up_by: 'sok', mine: true, can_pickup: false, can_release: true })]

open('products'); let surface = await world.mount()
const rail = () => surface.find(node => node.getAttribute('data-inventory-check-status-rail') !== null, 'status rail').textContent
assert.ok(/\d/.test(rail()), `the plain list shows figures on its chips (${rail()})`)
await surface.unmount()

open('tasks'); surface = await world.mount()
await surface.click(surface.find(node => node.getAttribute('data-task-open') !== null && taskRowOf(surface, 't1').contains(node), 'task row'))
assert.equal(world.ofRoute('list').at(-1)?.params.summary, 0, 'the task list is read without a summary')
const chips = surface.findAll(node => node.getAttribute('data-inventory-check-status-rail') !== null).map(node => node.textContent).join('')
assert.ok(!/\d/.test(chips), `no figure on the chips inside a task (${chips})`)
assert.ok(chips.includes(words.inventory_check_status_not_checked), 'the chips themselves are still there')

const back = surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === words.back, 'Back')
const cls = back.getAttribute('class') ?? ''
assert.ok(cls.includes('!h-11') && cls.includes('!w-11') && cls.includes('lg:!h-10') && cls.includes('lg:!w-10'), `the task bar's Back is 44 px on a phone, 40 px from lg (${cls})`)
await surface.unmount()
forgetDeviceDrafts()
await world.harness.close()
console.log('inventoryCheckTaskViewChips passed: no branch-wide figures on a task view\'s chips; Back is a 44 px touch target')
