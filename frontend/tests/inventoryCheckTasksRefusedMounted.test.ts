import assert from 'node:assert/strict'
import { act } from 'react'
import { actionIn, createTasksWorld, open, pack, rowOf, task, taskRowOf, viewerUser, type Surface } from './inventoryCheckTasksWorld.ts'
import { forgetDeviceDrafts } from './inventoryCheckDeviceDrafts.ts'
import { wiredMode } from '../src/components/inventory/inventoryWired.ts'
import { __resetApiHealthForTests, __resetApiWriteDedupeForTests, apiFetch, setSyncServerUrl } from '../src/api/http.ts'

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

// ---- a task write whose answer was lost ('unknown' outcome): the page says so, and the repeat sends the SAME request id with no second review; a fresh action later gets a NEW one ----
const lost = () => Object.assign(new Error('answer lost'), { outcome: 'unknown' })
const confirmWith = async (surface: Surface, label: string) => { await surface.click(surface.findAll(node => node.tagName === 'BUTTON' && node.textContent === label).at(-1)!) }
const idsOf = (route: string) => world.ofRoute(route).map(call => String(call.params.requestId))
for (const language of ['en', 'km'] as const) {
  const text = pack(language)
  world.language = language
  const unknownSentence = text.inventory_check_save_unknown
  assert.ok(unknownSentence && unknownSentence !== 'inventory_check_save_unknown', `${language}: the unknown-save sentence exists`)
  const said = (surface: Surface) => surface.text().includes(unknownSentence) || world.notices.some(notice => notice.text === unknownSentence)

  // Pick up, Hand back and Close task from the board: the first press asks the review, the repeat after the lost answer does not and reuses the id.
  for (const [action, label, mine] of [['pickup', text.inventory_check_task_pickup, false], ['release', text.inventory_check_task_release, true], ['close', text.inventory_check_task_close, true]] as const) {
    reset(); world.user = viewerUser('admin')
    const held = { picked_up_by: 'boss', mine: true, can_pickup: false, can_release: true, can_close: true }
    const free = { can_pickup: true, can_close: true }
    world.board = [task('a', { total: 2, ...(mine ? held : free) }), task('b', { total: 2, ...(mine ? held : free) })]
    world.taskProducts.set('a', [2, 4]); world.taskProducts.set('b', [6, 8])
    open('tasks')
    const surface = await world.mount()
    world.failures[action] = lost()
    await surface.click(actionIn(surface, taskRowOf(surface, 'a'), action)!)
    assert.ok(dialogs(surface) > 0, `${language} ${action}: the first press asks the review`)
    await confirmWith(surface, label)
    assert.equal(world.count(action), 1, `${language} ${action}: the first send`)
    assert.ok(said(surface), `${language} ${action}: the page says the result is unknown`)
    await surface.click(actionIn(surface, taskRowOf(surface, 'a'), action)!)
    assert.equal(world.count(action), 2, `${language} ${action}: the repeat is sent at once, with no second review`)
    const [first, second] = idsOf(action)
    assert.equal(second, first, `${language} ${action}: the repeat after a lost answer keeps the SAME request id`)
    assert.equal(world.ofRoute(action)[1].params.id, 'a', `${language} ${action}: for the same task`)
    if (action === 'pickup') await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === text.back, 'Back'))
    await surface.click(actionIn(surface, taskRowOf(surface, 'b'), action)!)
    await confirmWith(surface, label)
    assert.equal(world.count(action), 3, `${language} ${action}: a fresh action on another task is sent`)
    const third = idsOf(action)[2]
    assert.notEqual(third, first, `${language} ${action}: and gets a NEW request id`)
    await surface.unmount()
  }

  // Issue: the Issue button reads Retry after the lost answer, and pressing it sends the same id and the same products.
  reset(); world.user = viewerUser('admin')
  open('products')
  const surface = await world.mount()
  const enter = () => surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === text.inventory_check_task_issue && !node.hasAttribute('data-issue-action'), 'Issue entry'))
  const issueButton = () => surface.find(node => node.getAttribute('data-issue-action') === 'issue', 'Issue')
  const tick = (id: number) => surface.call(surface.find(node => node.getAttribute('data-check-pick') !== null && rowOf(surface, id).contains(node), `tick ${id}`), 'onChange', [{ target: { checked: true } }])
  await enter(); await tick(3); await tick(9)
  world.failures.issue = lost()
  await surface.click(issueButton())
  await confirmWith(surface, text.inventory_check_task_issue)
  assert.equal(world.count('issue'), 1, `${language} issue: the first send`)
  assert.ok(said(surface), `${language} issue: the page says the result is unknown`)
  await surface.click(issueButton())
  assert.equal(world.count('issue'), 2, `${language} issue: Retry sends at once, with no second review`)
  const [firstIssue, secondIssue] = world.ofRoute('issue')
  assert.equal(secondIssue.params.requestId, firstIssue.params.requestId, `${language} issue: Retry keeps the SAME request id`)
  assert.deepEqual(secondIssue.params.scope, firstIssue.params.scope, `${language} issue: and the same products`)
  assert.equal(world.board.length, 1, `${language} issue: one task exists after the retry`)
  await enter(); await tick(5)
  await surface.click(issueButton()); await confirmWith(surface, text.inventory_check_task_issue)
  assert.equal(world.count('issue'), 3, `${language} issue: a fresh Issue is sent`)
  assert.notEqual(world.ofRoute('issue')[2].params.requestId, firstIssue.params.requestId, `${language} issue: and gets a NEW request id`)
  await surface.unmount()
}
world.language = 'en'

// ---- the Issue refusal with its figures, mounted, in both languages: the error is the one the REAL apiFetch builds from the Worker's body (not a hand-built one), so the figures reach the sentence only if the transport kept them ----
async function realRefusal(body: Record<string, unknown>, status: number): Promise<Error> {
  const saved = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ success: false, ...body }), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch
  setSyncServerUrl('https://admin.example.test'); __resetApiHealthForTests(); __resetApiWriteDedupeForTests()
  try { await apiFetch('POST', '/api/inventory-checks/tasks', { requestId: 'issue-aaaaaaaa' }); throw new Error('the stub answered a refusal but apiFetch did not throw') } catch (error) { return error as Error } finally { globalThis.fetch = saved }
}
for (const language of ['en', 'km'] as const) {
  const text = pack(language)
  world.language = language
  const fill = (sentence: string, values: Record<string, number>) => Object.entries(values).reduce((out, [key, value]) => out.replace(`{${key}}`, String(value)), sentence)
  const cases: Array<[Record<string, unknown>, number, string]> = [
    [{ error: 'inventory_check_task_limit', code: 'inventory_check_task_limit', open: 10, limit: 10 }, 409, fill(text.inventory_check_task_limit_count, { open: 10, limit: 10 })],
    [{ error: 'inventory_check_task_too_many', code: 'inventory_check_task_too_many', total: 120, limit: 100, atLeast: true }, 400, fill(text.inventory_check_task_too_many_at_least, { total: 120, limit: 100 })],
    [{ error: 'inventory_check_task_too_many', code: 'inventory_check_task_too_many', total: 301, limit: 300 }, 400, fill(text.inventory_check_task_too_many_count, { total: 301, limit: 300 })],
  ]
  for (const [body, status, sentence] of cases) {
    reset(); world.user = viewerUser('admin')
    world.failures.issue = await realRefusal(body, status)
    open('products')
    const surface = await world.mount()
    await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === text.inventory_check_task_issue && !node.hasAttribute('data-issue-action'), 'Issue entry'))
    await surface.call(surface.find(node => node.getAttribute('data-check-pick') !== null && rowOf(surface, 3).contains(node), 'tick 3'), 'onChange', [{ target: { checked: true } }])
    await surface.click(surface.find(node => node.getAttribute('data-issue-action') === 'issue', 'Issue'))
    await surface.click(surface.findAll(node => node.tagName === 'BUTTON' && node.textContent === text.inventory_check_task_issue).at(-1)!)
    assert.equal(world.count('issue'), 1, `${language} ${String(body.code)}: the issue was sent once`)
    assert.ok(surface.text().includes(sentence), `${language} ${String(body.code)}: the page says "${sentence}" (it reads: ${surface.text().slice(0, 300)})`)
    assert.ok(!/[{}]/.test(sentence), `${language}: no placeholder is left in the sentence`)
    if (language === 'km') assert.ok(/[ក-៿]/.test(sentence), 'km: the sentence is Khmer')
    assert.ok(surface.findAll(node => node.getAttribute('data-check-pick') !== null).length > 0, `${language}: Issue mode stays open with its pick`)
    await surface.unmount()
  }
}
world.language = 'en'

forgetDeviceDrafts()
await world.harness.close()
console.log('inventoryCheckTasksRefusedMounted passed: offline writes refused in en and km, a missing task says so and keeps the tab wired, a refused board drops its held rows, a failed branch list offers Retry')
