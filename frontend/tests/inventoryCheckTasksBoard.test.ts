import assert from 'node:assert/strict'
import { actionIn, createTasksWorld, hasAction, open, pack, task, taskRowOf, viewerUser, type BoardTask, type Viewer } from './inventoryCheckTasksWorld.ts'

// The Tasks board, run as four viewers over one fixture board. The server decides each row's buttons (can_pickup / can_release / can_close) and whether issued_by is sent; the page draws what it is told.
const world = await createTasksWorld()
const fill = (text: string, values: Record<string, string | number>) => Object.entries(values).reduce((out, [key, value]) => out.replace(`{${key}}`, String(value)), text)
// t1 free · t2 picked up by someone else · t3 mine · t4 everything counted · t5 two products removed · t6 closed
const boardFor = (viewer: Viewer): BoardTask[] => {
  const issuer = viewer === 'admin' || viewer === 'issuer'
  const pick = viewer === 'admin' || viewer === 'employee'
  return [
    task('t1', { can_pickup: pick, can_close: issuer }),
    task('t2', { picked_up_by: 'dara', can_pickup: false, can_release: issuer, can_close: issuer }),
    task('t3', { picked_up_by: 'sok', mine: viewer === 'employee', can_pickup: false, can_release: viewer === 'employee' || issuer, can_close: issuer, done: 1 }),
    task('t4', { done: 4, can_pickup: pick, can_close: issuer }),
    task('t5', { removed: 2, total: 2, can_pickup: pick, can_close: issuer }),
    task('t6', { status: 'closed', closed_at: '2026-11-18T09:00:00.000Z', done: 4, can_pickup: false, at_close: true }),
  ]
}
const settle = async (surface: { settle: () => Promise<void> }) => { await surface.settle() }

for (const language of ['en', 'km'] as const) {
  const words = pack(language)
  world.language = language
  const KHMER = /[ក-៿]/
  for (const viewer of ['admin', 'employee', 'issuer'] as const) {
    world.user = viewerUser(viewer); world.board = boardFor(viewer); world.hideIssuer = viewer === 'employee'; world.reset()
    open('tasks')
    const surface = await world.mount()
    const where = `${language} ${viewer}`
    assert.equal(surface.button(words.inventory_check_tasks).getAttribute('aria-pressed'), 'true', `${where}: Tasks is the section shown`)
    const text = surface.text()
    assert.equal(world.count('list'), 0, `${where}: the board reads no product list`); assert.equal(world.count('overlay'), 0, `${where}: and no overlay`); assert.equal(world.count('products-old'), 0)
    assert.equal(world.count('tasks'), 1, `${where}: the board is ONE read`)
    assert.equal(taskRowOf(surface, 't6').getAttribute('data-task-status'), 'closed', `${where}: the closed task is drawn, marked closed`)
    // texts, in the viewer's language
    assert.ok(text.includes(fill(words.inventory_check_task_picked_up_by, { name: '@dara' })), `${where}: "Picked up by @dara"`)
    assert.ok(text.includes(fill(words.inventory_check_task_progress, { done: 1, total: 4 })), `${where}: "1/4 counted"`)
    assert.ok(taskRowOf(surface, 't4').textContent.includes(words.inventory_check_task_all_counted), `${where}: "All counted" on the finished open task`)
    assert.ok(!taskRowOf(surface, 't6').textContent.includes(words.inventory_check_task_all_counted), `${where}: a closed task shows its figures, not "All counted"`)
    assert.ok(taskRowOf(surface, 't5').textContent.includes(fill(words.inventory_check_task_removed, { count: 2 })), `${where}: "2 removed"`)
    if (language === 'km') assert.ok(KHMER.test(taskRowOf(surface, 't2').textContent), 'km: the row is in Khmer')
    // the picker marks my row
    assert.equal(taskRowOf(surface, 't3').getAttribute('data-task-mine') !== null, viewer === 'employee', `${where}: my own pickup is marked`)
    // the issuer
    const issuers = surface.findAll(node => node.getAttribute('data-task-issuer') !== null)
    if (viewer === 'employee') {
      assert.equal(issuers.length, 0, `${where}: no issuer drawn`)
      assert.ok(!text.includes('@boss') && !text.includes('—') && !text.includes('undefined'), `${where}: no @issuer, no placeholder, nothing in its place`)
    } else assert.equal(issuers.length, 6, `${where}: the issuer shows on every row that names one`); if (viewer !== 'employee') assert.ok(issuers.every(node => node.textContent === `${words.inventory_check_created_by} @boss`), `${where}: the issuer is labelled`)
    // the buttons
    assert.equal(hasAction(surface, 't1', 'pickup'), viewer !== 'issuer', `${where}: Pick up only for someone who may work tasks`)
    assert.equal(hasAction(surface, 't2', 'pickup'), false, `${where}: nobody picks up what someone else holds`)
    assert.equal(hasAction(surface, 't3', 'release'), true, `${where}: Hand back on a held task for the picker or an issuer`)
    assert.equal(hasAction(surface, 't2', 'release'), viewer !== 'employee', `${where}: an employee cannot hand back someone else's pickup`)
    assert.equal(hasAction(surface, 't1', 'close'), viewer !== 'employee', `${where}: Close task only for an issuer`)
    assert.equal(hasAction(surface, 't1', 'release'), false, `${where}: nothing to hand back on a free task`)
    assert.equal(surface.findAll(node => node.getAttribute('data-task-action') !== null && taskRowOf(surface, 't6').contains(node)).length, 0, `${where}: a closed task has no actions`)
    assert.equal(surface.findAll(node => node.getAttribute('data-task-issue') !== null).length, viewer === 'employee' ? 0 : 1, `${where}: the labelled Issue button only for an issuer`)
    if (viewer !== 'employee') assert.ok(surface.find(node => node.getAttribute('data-task-issue') !== null, 'Issue').textContent.includes(words.inventory_check_task_issue))
    // Pick up is the one labelled action of a row; Hand back and Close are icons named by their tooltip
    if (viewer !== 'issuer') assert.ok(actionIn(surface, taskRowOf(surface, 't1'), 'pickup')!.textContent.includes(words.inventory_check_task_pickup), `${where}: Pick up carries its word`)
    if (viewer !== 'employee') assert.equal(actionIn(surface, taskRowOf(surface, 't1'), 'close')!.getAttribute('aria-label'), words.inventory_check_task_close, `${where}: Close task is an icon with its name as tooltip`)
    await surface.unmount()
  }
}

// ---- a viewer who may neither work nor issue tasks: no Tasks chip, and an old link lands on Inventory ----
world.language = 'en'; world.user = viewerUser('neither'); world.board = boardFor('neither'); world.reset()
for (const anchor of ['tasks', 'issues']) {
  open(anchor)
  const surface = await world.mount()
  assert.equal(surface.findAll(node => node.tagName === 'BUTTON' && node.textContent === pack('en').inventory_check_tasks).length, 0, `neither (#${anchor}): no Tasks chip`)
  assert.equal(surface.button(pack('en').inventory).getAttribute('aria-pressed'), 'true', `neither (#${anchor}): the link lands on Inventory`)
  assert.equal(world.count('tasks'), 0, `neither (#${anchor}): the board is never read`)
  await surface.unmount()
}

// ---- the empty state, per viewer ----
world.board = []
for (const viewer of ['admin', 'employee'] as const) {
  world.user = viewerUser(viewer); world.reset(); open('tasks')
  const surface = await world.mount()
  assert.ok(surface.text().includes(pack('en').inventory_check_tasks_empty), `${viewer}: "No count tasks."`)
  assert.equal(surface.findAll(node => node.getAttribute('data-task-issue') !== null).length, viewer === 'admin' ? 1 : 0, `${viewer}: the Issue button is there for an issuer only`)
  await surface.unmount()
}

// ---- first open: the page and its skeleton draw at once, then the rows; a second open draws the held rows at once and reads in the background ----
world.user = viewerUser('admin'); world.board = boardFor('admin'); world.reset()
let release!: () => void
world.hold = new Promise<void>(resolve => { release = resolve })
open('tasks')
const second = await world.mount()
assert.ok(second.text().includes(pack('en').inventory_check_tasks), 'the section chips draw before the answer')
assert.equal(second.findAll(node => node.getAttribute('data-inventory-check-skeleton') !== null).length, 1, 'the first open draws the shared skeleton')
assert.equal(second.findAll(node => node.getAttribute('data-inventory-check-task') !== null).length, 0, 'and no rows yet')
release(); world.hold = null
await settle(second)
assert.equal(second.findAll(node => node.getAttribute('data-inventory-check-task') !== null).length, 6, 'then the six rows')
assert.equal(second.findAll(node => node.getAttribute('data-inventory-check-skeleton') !== null).length, 0)
await second.unmount()
world.reset(); world.board = boardFor('admin').slice(0, 5)
world.hold = new Promise<void>(resolve => { release = resolve })
open('tasks')
const third = await world.mount()
assert.equal(third.findAll(node => node.getAttribute('data-inventory-check-task') !== null).length, 6, 'a later open draws the held rows at once (the answer is still on its way)')
assert.equal(third.findAll(node => node.getAttribute('data-inventory-check-skeleton') !== null).length, 0, 'with no skeleton frame')
assert.equal(world.count('tasks'), 1, 'and sends ONE background request')
release(); world.hold = null
await settle(third)
assert.equal(third.findAll(node => node.getAttribute('data-inventory-check-task') !== null).length, 5, 'the changed answer updates the rows in place')
await third.unmount()
// ---- "{done}/{total} counted at close": a closed task WITH frozen figures says they are the ones at close on the board row, the task view bar and the sessions list; an open task keeps the live text.
// Only a task the Worker flags `at_close` says so; a task closed before the figures were stored (c2, `legacy`) has no flag and shows the plain live text, on all three surfaces.
const frozenFigures: Partial<BoardTask> = { at_close: true }
// The fixture is 5 of 10, so a closed task is not "All counted" and a wrong surface cannot hide behind the helper's 4/4 case.
for (const language of ['en', 'km'] as const) {
  const words = pack(language)
  world.language = language; world.user = viewerUser('admin'); world.hideIssuer = false
  const closedText = fill(words.inventory_check_task_progress_closed, { done: 5, total: 10 })
  const liveText = fill(words.inventory_check_task_progress, { done: 5, total: 10 })
  assert.notEqual(closedText, liveText, `${language}: the two sentences differ, so the test can tell them apart`)
  assert.ok(closedText.includes('5/10') && liveText.includes('5/10'), `${language}: both keep the figures`)
  const bothTasks = [task('c1', { status: 'closed', closed_at: '2026-11-18T09:00:00.000Z', total: 10, done: 5, can_pickup: false, ...frozenFigures }), task('c2', { status: 'closed', closed_at: '2026-11-18T08:00:00.000Z', total: 10, done: 5, can_pickup: false }), task('o1', { total: 10, done: 5, can_pickup: true })]

  // the board row
  world.reset(); world.board = bothTasks; world.taskProducts.set('c1', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); world.taskProducts.set('c2', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); world.taskProducts.set('o1', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  open('tasks')
  let surface = await world.mount()
  assert.ok(taskRowOf(surface, 'c1').textContent.includes(closedText), `${language}: the closed row reads "${closedText}"`)
  assert.ok(!taskRowOf(surface, 'c1').textContent.replace(closedText, '').includes(liveText), `${language}: and not the live sentence`)
  assert.ok(taskRowOf(surface, 'c2').textContent.includes(liveText), `${language}: a legacy closed row (no flag) reads "${liveText}"`)
  assert.ok(!taskRowOf(surface, 'c2').textContent.includes(closedText), `${language}: and never the at-close sentence`)
  assert.ok(taskRowOf(surface, 'o1').textContent.includes(liveText), `${language}: the open row reads "${liveText}"`)
  assert.ok(!taskRowOf(surface, 'o1').textContent.includes(closedText), `${language}: and not the at-close sentence`)

  // the task view bar of the closed task, and of the open one
  await surface.click(surface.find(node => node.getAttribute('data-task-open') !== null && taskRowOf(surface, 'c1').contains(node), 'closed row'))
  const closedBar = surface.find(node => node.getAttribute('data-inventory-check-task-bar') !== null, 'task bar').textContent
  assert.ok(closedBar.includes(closedText), `${language}: the closed task's view bar reads "${closedText}"`)
  await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === words.back, 'Back'))
  await surface.click(surface.find(node => node.getAttribute('data-task-open') !== null && taskRowOf(surface, 'c2').contains(node), 'legacy closed row'))
  const legacyBar = surface.find(node => node.getAttribute('data-inventory-check-task-bar') !== null, 'task bar').textContent
  assert.ok(legacyBar.includes(liveText) && !legacyBar.includes(closedText), `${language}: a legacy closed task's view bar reads "${liveText}", not at close`)
  await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === words.back, 'Back'))
  await surface.click(surface.find(node => node.getAttribute('data-task-open') !== null && taskRowOf(surface, 'o1').contains(node), 'open row'))
  const openBar = surface.find(node => node.getAttribute('data-inventory-check-task-bar') !== null, 'task bar').textContent
  assert.ok(openBar.includes(liveText) && !openBar.includes(closedText), `${language}: the open task's view bar reads "${liveText}"`)
  await surface.unmount()

  // the sessions list: a pickup row of a closed task, and of an open one
  world.reset()
  const pickupRow = (id: string, status: 'open' | 'closed') => ({ id: `p-${id}`, branch_id: 1, created_by: 7, title: '', status, revision: 0, started_at: '2026-11-19T02:00:00.000Z', updated_at: '2026-11-19T02:00:00.000Z', scope: { membership: 'pickup', task: id }, branch_name: 'Main',
    task: { id, title: '', status, total: 10, done: 5, ...(status === 'closed' && id !== 'c2' ? frozenFigures : {}) }, progress: { total: 0, done: 0, issue: 0, unstarted: 0 } })
  world.failures.sessionItems = [pickupRow('c1', 'closed'), pickupRow('c2', 'closed'), pickupRow('o1', 'open')]
  open('sessions')
  surface = await world.mount()
  const sessionRow = (id: string) => surface.find(node => node.getAttribute('data-inventory-check-session') === `p-${id}`, `session row ${id}`).textContent
  assert.ok(sessionRow('c1').includes(closedText), `${language}: the sessions list reads "${closedText}" for a closed task`)
  assert.ok(sessionRow('c2').includes(liveText) && !sessionRow('c2').includes(closedText), `${language}: and "${liveText}", never at close, for a legacy closed one (no flag)`)
  assert.ok(sessionRow('o1').includes(liveText) && !sessionRow('o1').includes(closedText), `${language}: and "${liveText}" for an open one`)
  await surface.unmount()
  delete world.failures.sessionItems
}
world.language = 'en'

// ---- the board's header says the limit before an Issue is tried: at the cap it names both figures, with room it says nothing and Issue goes on ----
for (const language of ['en', 'km'] as const) {
  const words = pack(language)
  world.language = language; world.user = viewerUser('admin'); world.hideIssuer = false
  const sentence = fill(words.inventory_check_task_limit_count, { open: 2, limit: 2 })
  const said = (surface: { findAll: (test: (node: any) => boolean) => unknown[] }) => surface.findAll(node => node.getAttribute('aria-label') === sentence || node.getAttribute('title') === sentence || node.textContent === sentence).length > 0
  world.reset(); world.capabilities = { ...world.capabilities, maxOpenTasks: 2 }
  world.board = [task('a'), task('b'), task('z', { status: 'closed', closed_at: '2026-11-18T09:00:00.000Z', done: 4, can_pickup: false })]
  open('tasks')
  let surface = await world.mount()
  assert.ok(said(surface), `${language}: at the cap (2 open of 2) the header says "${sentence}"`)
  await surface.click(surface.find(node => node.getAttribute('data-task-issue') !== null, 'Issue'))
  assert.equal(world.count('list'), 0, `${language}: and Issue does not open at the cap`)
  await surface.unmount()
  world.reset(); world.board = [task('a'), task('z', { status: 'closed', closed_at: '2026-11-18T09:00:00.000Z', done: 4, can_pickup: false })]
  surface = await world.mount()
  assert.ok(!said(surface), `${language}: with room (1 open of 2, a closed task does not count) it says nothing`)
  await surface.unmount()
  world.capabilities = { ...world.capabilities, maxOpenTasks: 30 }
}
world.language = 'en'

console.log('inventoryCheckTasksBoard passed: four viewers, both languages, the issuer left out where the server leaves it out, skeleton then held rows')
