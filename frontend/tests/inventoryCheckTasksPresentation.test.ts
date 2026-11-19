import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createTasksWorld, open, pack, rowOf, task, taskRowOf, viewerUser, type Surface } from './inventoryCheckTasksWorld.ts'
import { forgetDeviceDrafts } from './inventoryCheckDeviceDrafts.ts'

// T2 round 3b: what the Tasks screens show and how a row answers a tap. The progress is written once, the board row is one tap target with a real
// button for its name, Issue mode ticks on a row tap, and the copy keeps its meaning in both packs.
const world = await createTasksWorld()
world.user = viewerUser('admin')
const occurrences = (text: string, figure: string) => text.split(figure).length - 1
const reset = () => { forgetDeviceDrafts(); world.calls.length = 0; world.notices.length = 0; world.failures = {}; world.board = []; world.taskProducts.clear() }

// ---- the board row: one figure, a named button, a tap anywhere opens it ----
for (const language of ['en', 'km'] as const) {
  const words = pack(language)
  world.language = language
  reset(); world.board = [task('t1', { total: 4, done: 0, title: 'Shelf A' }), task('t4', { total: 4, done: 4 }), task('t6', { status: 'closed', done: 4, closed_at: '2026-11-18T09:00:00.000Z' })]
  world.taskProducts.set('t1', [1, 2, 3, 4])
  open('tasks')
  const surface = await world.mount()
  const first = taskRowOf(surface, 't1')
  assert.equal(occurrences(first.textContent, '0/4'), 1, `${language}: "0/4" is written once on a board row`)
  // a phone shows the issued day only (the name already carries it and a phone row is two lines); the full date and time come from xl
  const issued = surface.find(node => node.getAttribute('data-task-issued') !== null && first.contains(node), 'issued cell')
  const parts = issued.querySelectorAll('span')
  assert.equal(parts.length, 2, `${language}: the issued cell has a phone part and a wide part`)
  assert.match(parts[0].textContent, /^\d\d\/\d\d\/\d{4}$/, `${language}: the phone part is the day only`); assert.ok(String(parts[0].getAttribute('class')).includes('xl:hidden'))
  assert.match(parts[1].textContent, /^\d\d\/\d\d\/\d{4} \d\d:\d\d$/, `${language}: the wide part is the date and time`); assert.ok(String(parts[1].getAttribute('class')).includes('hidden xl:inline'))
  const closedCell = taskRowOf(surface, 't6').textContent
  assert.ok(closedCell.includes(`${words.shift_status_closed} 18/11/2026`) && closedCell.includes('18/11/2026 16:00'), `${language}: a closed row carries the closed day and the closed date-time (one is hidden by width)`)
  assert.equal(occurrences(taskRowOf(surface, 't6').textContent, '4/4'), 1, `${language}: and once on a closed row`)
  assert.equal(occurrences(taskRowOf(surface, 't4').textContent, '4/4'), 0, `${language}: "All counted" is not followed by the figure again`)
  const ring = first.querySelectorAll('svg')[0]
  assert.ok(ring, `${language}: the ring is drawn`)
  assert.equal(ring.getAttribute('aria-hidden'), 'true', `${language}: the ring is hidden from screen readers (the words beside it name the progress)`)
  assert.equal(ring.getAttribute('role'), null)
  assert.ok(!first.textContent.includes(words.inventory_check_progress), `${language}: a task never says "${words.inventory_check_progress}" (Checked)`)
  // the name is the row's one real button; its full text is the tooltip
  const names = first.querySelectorAll('button').filter(node => node.getAttribute('data-task-name') !== null)
  assert.equal(names.length, 1, `${language}: one name button per row`)
  assert.equal(names[0].getAttribute('title'), 'Shelf A', `${language}: the full name is its tooltip`)
  assert.equal(names[0].textContent, 'Shelf A')
  assert.equal(names[0].getAttribute('tabindex'), null, `${language}: the name button is a normal tab stop`)
  const opener = surface.find(node => node.getAttribute('data-task-open') !== null && first.contains(node), 'row opener')
  assert.equal(opener.getAttribute('tabindex'), null, `${language}: the row itself is not a second tab stop: the name button is the keyboard control`)
  await surface.click(names[0])
  assert.equal(world.ofRoute('list').filter(call => call.params.taskId === 't1').length, 1, `${language}: a tap on the name opens the task, once (a click is not handled by both the button and the row)`)
  assert.equal(occurrences(surface.find(node => node.getAttribute('data-inventory-check-task-bar') !== null, 'task bar').textContent, '0/4'), 1, `${language}: the task bar writes the progress once too`)
  await surface.unmount()
  // a tap on the row outside the name opens it too
  world.reset(); open('tasks')
  const again = await world.mount()
  await again.click(again.find(node => node.getAttribute('data-task-open') !== null && taskRowOf(again, 't1').contains(node), 'row'))
  assert.equal(world.ofRoute('list').filter(call => call.params.taskId === 't1').length, 1, `${language}: a tap on the row opens the task`)
  await again.unmount()
}

// ---- Count sessions: a pickup row writes its progress once too ----
world.language = 'en'; reset()
world.failures.sessionItems = [{ id: 'p1', branch_id: 1, created_by: 7, title: '', status: 'open', revision: 0, started_at: '2026-11-19T02:00:00.000Z', updated_at: '2026-11-19T02:00:00.000Z', scope: { membership: 'pickup', task: 't1' }, branch_name: 'Main',
  task: { id: 't1', title: '', status: 'open', total: 4, done: 1 }, progress: { total: 0, done: 0, issue: 0, unstarted: 0 } },
{ id: 's2', branch_id: 1, created_by: 7, title: '', status: 'open', revision: 0, started_at: '2026-11-19T01:00:00.000Z', updated_at: '2026-11-19T01:00:00.000Z', scope: {}, branch_name: 'Main', progress: { total: 5, done: 2, issue: 1, unstarted: 2 } }]
open('sessions')
{
  const surface = await world.mount()
  const pickup = surface.find(node => node.getAttribute('data-inventory-check-session') === 'p1', 'pickup row')
  assert.equal(occurrences(pickup.textContent, '1/4'), 1, 'a pickup row writes "1/4 counted" once')
  const own = surface.find(node => node.getAttribute('data-inventory-check-session') === 's2', 'session row')
  assert.equal(occurrences(own.textContent, '3/5'), 1, 'a plain session keeps its ring figure (the default is unchanged)')
  assert.ok(own.querySelectorAll('svg').some(node => node.getAttribute('role') === 'img' && /3\/5/.test(node.getAttribute('aria-label') ?? '')), 'and the ring keeps its accessible name')
  await surface.unmount()
}
delete world.failures.sessionItems

// ---- Issue mode: a tap on a row ticks it; the image still opens the product ----
reset(); world.language = 'en'; open('products')
{
  const words = pack('en')
  const surface: Surface = await world.mount()
  await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === words.inventory_check_task_issue && !node.hasAttribute('data-issue-action'), 'Issue entry'))
  const picked = () => surface.findAll(node => node.getAttribute('data-picked-pill') !== null).map(node => node.textContent).join('')
  assert.equal(picked(), '', 'nothing ticked')
  await surface.click(rowOf(surface, 3))
  assert.equal(picked(), '1', 'a tap on the row ticks it')
  await surface.click(rowOf(surface, 5))
  assert.equal(picked(), '2', 'a second row')
  await surface.click(rowOf(surface, 3))
  assert.equal(picked(), '1', 'a second tap unticks it')
  assert.ok(rowOf(surface, 3).getAttribute('aria-label')?.startsWith('Product 3'), 'the row is named by the product while ticking, not "Open product"')
  await surface.unmount()
}

// ---- a reopened task says why, when and (when the server names them) by whom; a row without the field draws nothing ----
for (const language of ['en', 'km'] as const) {
  const words = pack(language)
  world.language = language; reset()
  const at = '2026-11-19T07:30:00.000Z'
  const reopen = (id: string, reopened: { at: string; reason: string; by?: string }) => ({ ...task(id), reopened })
  world.board = [reopen('r1', { at, reason: 'count_reopened', by: 'dara' }), reopen('r2', { at, reason: 'set_undone' }), reopen('r3', { at, reason: 'set_undone', by: 'sok' }), reopen('r4', { at, reason: 'count_reopened' }), task('r5')]
  open('tasks')
  const surface = await world.mount()
  const line = (id: string) => taskRowOf(surface, id).querySelectorAll('p').filter(node => node.getAttribute('data-task-reopened') !== null)
  const stamp = line('r4')[0].textContent.split(' · ')[1]
  assert.match(stamp, /^\d\d\/\d\d\/\d{4} \d\d:\d\d$/, `${language}: the app's own date-time format`)
  assert.equal(line('r1')[0].textContent, `${words.inventory_check_task_reopened_count} · ${stamp} · @dara`, `${language}: a count taken back, with the name`)
  assert.equal(line('r2')[0].textContent, `${words.inventory_check_task_reopened_set} · ${stamp}`, `${language}: a Set undone, no name when the server sends none`)
  assert.equal(line('r3')[0].textContent, `${words.inventory_check_task_reopened_set} · ${stamp} · @sok`, `${language}: a Set undone, with the name`)
  assert.equal(line('r4')[0].textContent, `${words.inventory_check_task_reopened_count} · ${stamp}`, `${language}: a count taken back, no name`)
  assert.equal(line('r5').length, 0, `${language}: no field, no line`)
  assert.notEqual(words.inventory_check_task_reopened_count, words.inventory_check_task_reopened_set, `${language}: one string per reason`)
  await surface.unmount()
}

// ---- icons: Tasks, Issue and pickups each have their own ----
const read = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
const issueBar = read('components/inventory/InventoryCheckListRows.tsx'), board = read('components/inventory/InventoryCheckTasksList.tsx'), sessions = read('components/inventory/InventoryCheckSessionsList.tsx'), tiles = read('components/navigation/mobileSectionIcons.ts')
assert.match(tiles, /'inventory:tasks': ListTodo,/); assert.match(tiles, /'inventory:sessions': ClipboardList,/, 'Count sessions keeps the clipboard')
assert.match(sessions, /<ListTodo className=/, 'the pickup marker is the Tasks icon'); assert.ok(!/<ClipboardList/.test(sessions), 'and no clipboard-list is left on Count sessions rows')
assert.ok(/<ClipboardPlus /.test(board) && /<ClipboardPlus /.test(issueBar), 'Issue is a clipboard with a plus on the board and in Issue mode')
// ---- the pick box is a 44 px target on a phone and 40 px from lg ----
assert.ok(/<label className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center lg:h-10 lg:w-10">/.test(issueBar) && !/lg:h-9 lg:w-9">\s*<input type="checkbox"/.test(issueBar), 'the pick box label is h-11 w-11, lg:h-10 lg:w-10 (never 36 px)')
// ---- the board row starts its one-line layout at xl, where its columns fit ----
const layout = board.replace(/lg:(h|min-h|w)-1\d/g, '')
assert.ok(!/\blg:(w-|flex-nowrap|contents|order-|ml-0|shrink-0|block|text-xs)/.test(layout), 'no column or wrap rule of the board row starts at lg')
assert.ok(/xl:flex-nowrap/.test(board) && /xl:w-36/.test(board) && /xl:contents/.test(board), 'the one-line row starts at xl')

// ---- the copy: same placeholders in both packs, nothing English in Khmer, the review's own wording ----
const en = pack('en'), km = pack('km')
const keys = Object.keys(en).filter(key => /^inventory_check_(tasks?(_|$)|draft_|error_(task|issue|tasks))/.test(key))
assert.ok(keys.length >= 30, `positive control: ${keys.length} task keys found`)
const holes = (text: string) => (text.match(/\{[a-z]+\}/g) ?? []).sort().join(',')
for (const key of keys) {
  assert.ok(typeof km[key] === 'string' && /[ក-៿]/.test(km[key]), `${key}: Khmer text`)
  assert.equal(holes(km[key]), holes(en[key]), `${key}: the same {placeholders} in both packs`)
  assert.ok(!/[A-Za-z]{4,}/.test(km[key].replace(/\{[a-z]+\}/g, '')), `${key}: no English word in the Khmer`)
}
assert.equal(en.inventory_check_task_release_discards, 'Your typed counts for this task will be discarded.')
assert.equal(km.inventory_check_task_release_discards, 'ការរាប់ដែលអ្នកបានវាយសម្រាប់កិច្ចការនេះ នឹងត្រូវបោះចោល។')
for (const key of ['inventory_check_task_too_many_count', 'inventory_check_task_too_many_at_least']) {
  assert.ok(en[key].includes('{total}') && en[key].includes('{limit}') && km[key].includes('{total}') && km[key].includes('{limit}'))
  assert.ok(km[key].includes('កិច្ចការមួយអាចមានផលិតផលបានច្រើនបំផុត {limit}'), `${key}: the pack's "at most" pattern (អាច … បានច្រើនបំផុត)`)
  assert.ok(!km[key].includes('មានបានច្រើនបំផុត'), `${key}: the ungrammatical "មានបានច្រើនបំផុត" is gone`)
}
assert.ok(en.inventory_check_draft_dropped.includes('counted again after you typed them') && !/elsewhere/.test(en.inventory_check_draft_dropped), 'en: "counted again", not "elsewhere"')
assert.ok(km.inventory_check_draft_dropped.includes('ត្រូវបានរាប់ម្ដងទៀត') && !km.inventory_check_draft_dropped.includes('កន្លែងផ្សេង'), 'km: "counted again", not "at another place"')
assert.equal(en.inventory_check_task_issued, 'Task issued · Products: {count}', 'the figure is a label, so one product never reads "1 products"')
assert.equal(km.inventory_check_task_issued, 'បានចាត់កិច្ចការ · ផលិតផល៖ {count}')
console.log('inventoryCheckTasksPresentation passed: one figure per row, one button and one tap per row, Issue ticks on a row tap, own icons, the row layout at xl, both packs in step')
