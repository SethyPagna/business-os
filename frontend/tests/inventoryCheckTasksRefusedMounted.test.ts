import assert from 'node:assert/strict'
import { act } from 'react'
import { actionIn, createTasksWorld, open, pack, rowOf, task, taskRowOf, viewerUser, type Surface } from './inventoryCheckTasksWorld.ts'
import { forgetDeviceDrafts } from './inventoryCheckDeviceDrafts.ts'
import { wiredMode } from '../src/components/inventory/inventoryWired.ts'

// What the Tasks screens say when the server (or the device) refuses: offline writes, a task the server cannot find, and a board an account may not read.
const world = await createTasksWorld()
const refuse = (code: string, status: number, extra: Record<string, unknown> = {}) => Object.assign(new Error(code), { code, status, ...extra })
const reset = () => { forgetDeviceDrafts(); world.calls.length = 0; world.notices.length = 0; world.failures = {}; world.online = true; world.taskProducts.set('t1', [2, 4]); world.board = [] }
const dialogs = (surface: Surface) => surface.findAll(node => node.tagName === 'DL').length
const foreground = async (surface: Surface) => { await act(async () => { document.dispatchEvent(new Event('visibilitychange')) }); await surface.settle() }
const writes = () => world.calls.filter(call => ['issue', 'pickup', 'release', 'close', 'submissions'].includes(call.route)).length

// ---- offline: Issue, Pick up, Hand back and Close task are refused with the page's own sentence, as every other save is; no review opens and nothing is sent ----
for (const language of ['en', 'km'] as const) {
  const words = pack(language)
  const offline = words.inventory_check_count_blocked_offline
  assert.ok(offline && offline !== 'inventory_check_count_blocked_offline', `${language}: the sentence exists`)
  world.language = language

  reset(); world.user = viewerUser('admin'); world.online = false
  world.board = [task('open', { can_pickup: true, total: 2 }), task('mine', { picked_up_by: 'boss', mine: true, can_pickup: false, can_release: true, can_close: true })]
  open('tasks')
  let surface = await world.mount()
  const readsBefore = world.count('tasks')
  for (const [action, id] of [['pickup', 'open'], ['release', 'mine'], ['close', 'mine']] as const) {
    await surface.click(actionIn(surface, taskRowOf(surface, id), action)!)
    assert.equal(dialogs(surface), 0, `${language}: ${action} offline opens no review`)
    assert.ok(surface.text().includes(offline), `${language}: ${action} offline says "${offline}"`)
    assert.equal(writes(), 0, `${language}: ${action} offline sends nothing`)
  }
  assert.equal(world.count('tasks'), readsBefore, `${language}: and the refused actions read no board`)
  await surface.unmount()

  // Issue: the Issue button at the board opens the picking mode; tick a row and press Issue.
  reset(); world.user = viewerUser('admin'); world.online = false
  open('products'); surface = await world.mount()
  await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === words.inventory_check_task_issue && !node.hasAttribute('data-issue-action'), 'Issue entry'))
  await surface.call(surface.find(node => node.getAttribute('data-check-pick') !== null && rowOf(surface, 3).contains(node), 'tick 3'), 'onChange', [{ target: { checked: true } }])
  await surface.click(surface.find(node => node.getAttribute('data-issue-action') === 'issue', 'Issue'))
  assert.equal(dialogs(surface), 0, `${language}: Issue offline opens no review`)
  assert.ok(surface.text().includes(offline), `${language}: Issue offline says "${offline}"`)
  assert.equal(writes(), 0, `${language}: Issue offline sends nothing`)
  assert.equal(surface.findAll(node => node.getAttribute('data-check-pick') !== null).length > 0, true, `${language}: and Issue mode stays, with its pick`)
  await surface.unmount()
}
world.language = 'en'
const words = pack('en')

// ---- a task the server cannot find: its own sentence, and the tab stays on the wired list ----
for (const [code, status, key] of [['inventory_check_task_not_found', 404, 'inventory_check_error_task_not_found'], ['inventory_check_tasks_required', 403, 'inventory_check_error_tasks_required']] as const) {
  reset(); world.user = viewerUser('employee'); world.hideIssuer = true
  world.board = [task('t1', { picked_up_by: 'sok', mine: true, can_pickup: false, can_release: true })]
  open('tasks')
  const surface = await world.mount()
  world.failures.list = refuse(code, status)
  await surface.click(surface.find(node => node.getAttribute('data-task-open') !== null && taskRowOf(surface, 't1').contains(node), 'task row'))
  const alert = surface.findAll(node => node.getAttribute('role') === 'alert').map(node => node.textContent).join(' | ')
  assert.ok(alert.includes(words[key]), `${code}: the view says "${words[key]}" (got: ${alert})`)
  assert.ok(!alert.includes(words.inventory_check_load_failed), `${code}: and not the generic line`)
  assert.notEqual(wiredMode(), 'old', `${code}: the tab did not learn that ic_wired is off`)
  assert.equal(world.count('products-old'), 0, `${code}: and read no older list`)
  // back out and open Inventory: the wired list answers
  await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === words.back, 'Back'))
  await surface.click(surface.button(words.inventory))
  assert.equal(world.ofRoute('list').at(-1)?.params.taskId, undefined, `${code}: the plain list is read next`)
  assert.equal(world.count('products-old'), 0, `${code}: from the wired list, never the older one`)
  assert.ok(surface.findAll(node => node.getAttribute('data-inventory-check-row') !== null).length > 0, `${code}: and it shows rows`)
  await surface.unmount()
}
// any other failure of the task view is still the generic line
reset(); world.user = viewerUser('employee'); world.hideIssuer = true
world.board = [task('t1', { picked_up_by: 'sok', mine: true, can_pickup: false, can_release: true })]
open('tasks')
let surface = await world.mount()
world.failures.list = refuse('boom', 500)
await surface.click(surface.find(node => node.getAttribute('data-task-open') !== null && taskRowOf(surface, 't1').contains(node), 'task row'))
assert.ok(surface.findAll(node => node.getAttribute('role') === 'alert').some(node => node.textContent.includes(words.inventory_check_load_failed)), 'a 500 in the task view is the generic load-failed line')
await surface.unmount()

// ---- the board answers 403 inventory_check_tasks_required: the rows held from before (and their buttons) go, and its sentence shows ----
reset(); world.user = viewerUser('employee'); world.hideIssuer = true
world.board = [task('t1', { can_pickup: true }), task('t2', { can_pickup: true })]
open('tasks')
surface = await world.mount()
assert.equal(surface.findAll(node => node.getAttribute('data-inventory-check-task') !== null).length, 2, 'the board shows its rows')
assert.ok(actionIn(surface, taskRowOf(surface, 't1'), 'pickup'), 'with a Pick up button')
world.failures.board = refuse('inventory_check_tasks_required', 403)
await foreground(surface)
assert.equal(surface.findAll(node => node.getAttribute('data-inventory-check-task') !== null).length, 0, 'the held rows are gone')
assert.equal(surface.findAll(node => node.getAttribute('data-task-action') !== null).length, 0, 'and so are their buttons')
assert.ok(surface.text().includes(words.inventory_check_error_tasks_required), 'the refusal says its own sentence')
assert.ok(!surface.text().includes(words.inventory_check_load_failed), 'not the generic line')
assert.equal(surface.findAll(node => node.getAttribute('data-inventory-check-skeleton') !== null).length, 0, 'and no skeleton keeps pulsing')
// access comes back: the next read shows the rows again and the sentence is gone
await foreground(surface)
assert.equal(surface.findAll(node => node.getAttribute('data-inventory-check-task') !== null).length, 2, 'the next successful read shows the rows')
assert.ok(!surface.text().includes(words.inventory_check_error_tasks_required), 'and the sentence goes')
await surface.unmount()
// ...and a reopen of the page does not draw the old rows from memory either
world.failures.board = refuse('inventory_check_tasks_required', 403)
open('tasks'); surface = await world.mount()
assert.ok(surface.text().includes(words.inventory_check_error_tasks_required), 'after the refusal the page opens with its sentence')
await surface.unmount()
open('tasks'); surface = await world.mount()
assert.equal(surface.findAll(node => node.getAttribute('data-inventory-check-task') !== null).length, 2)
await surface.unmount()

// ---- a cold Tasks open whose branch list fails to load: the load-failed line and a Retry, never "Choose a branch first." with nothing to choose ----
for (const language of ['en', 'km'] as const) {
  const text = pack(language)
  world.language = language
  reset(); world.user = viewerUser('employee'); world.hideIssuer = true
  world.branches.push({ id: 2, name: 'Second' })
  world.failures.branches = refuse('boom', 500)
  open('tasks')
  const cold = await world.mount()
  assert.ok(cold.text().includes(text.inventory_check_load_failed), `${language}: the failed branch list says so`)
  assert.ok(!cold.text().includes(text.inventory_check_count_blocked_branch), `${language}: and does not ask for a branch it cannot offer`)
  assert.equal(cold.findAll(node => node.getAttribute('data-inventory-check-skeleton') !== null).length, 0, `${language}: no skeleton pulses behind it`)
  const retry = cold.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === text.retry, 'Retry')
  world.calls.length = 0
  await cold.click(retry)
  assert.equal(world.count('branches'), 1, `${language}: Retry reads the branch list again`)
  assert.ok(cold.text().includes(text.inventory_check_count_blocked_branch) && cold.text().includes('Second'), `${language}: and the branches to choose from are there`)
  assert.ok(!cold.text().includes(text.inventory_check_load_failed), `${language}: the failed line is gone`)
  world.branches.pop()
  await cold.unmount()
}
world.language = 'en'

forgetDeviceDrafts()
await world.harness.close()
console.log('inventoryCheckTasksRefusedMounted passed: offline writes refused in en and km, a missing task says so and keeps the tab wired, a refused board drops its held rows, a failed branch list offers Retry')
