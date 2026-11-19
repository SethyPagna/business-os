'use strict'
// Count tasks, round 8b (DESIGN-task-reopen Part 2, P2.3 to P2.7): the BOARD VERSION of a branch and the readers that key on it, pinned as source facts.
//   P2.3/P2.4  the task board keys on ic_tasks:<branch> (and products), NOT on inventory_checks. Only the writers that can change a figure or a row of the board at a branch move it:
//              the table below lists EVERY Inventory Check writer, and says whether it moves it. A new writer that is not in the table fails here; a writer that moves it and must not (an observation, an approval decision) fails too.
//   P2.5       GET /tasks reads each version once and answers the version its cache key holds.
//   P2.6       the restricted list of one task does not key on the count version (extra.task is not in the setVersion conditions); the check state, the day and the grouping still do.
//   P2.7       an idsOnly read (issue by filter) answers as soon as the reader has, before the capability reads.
// Run: node scripts/test-inventory-check-tasks-board-version-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8').replace(/\r\n/g, '\n')
const route = read('routes/inventoryChecks.ts')
let passed = 0
const check = (name, run) => { run(); passed++; console.log(`PASS ${name}`) }

// The route's handlers, cut at each `app.<method>(` line.
const handlers = (() => {
  const out = []
  const parts = route.split(/\n(?=app\.(?:get|post|patch|put|delete)\()/)
  for (const part of parts.slice(1)) {
    const head = /^app\.(get|post|patch|put|delete)\('([^']+)'/.exec(part)
    if (head) out.push({ method: head[1], path: head[2], text: part })
  }
  return out
})()

// EVERY writer of the route and whether it moves the branch's board. `moves: true` writers call boardWrites(c) before the writer and boardBranch(c, answer) after it.
const WRITERS = [
  { method: 'post', path: '/sessions', moves: false, why: 'a new OPEN count session holds no final count' },
  { method: 'post', path: '/tasks', moves: true, why: 'a task issued: a new row of the board' },
  { method: 'post', path: '/tasks/:id/pickup', moves: true, why: 'the board shows who has the task' },
  { method: 'post', path: '/tasks/:id/release', moves: true, why: 'the board shows who has the task' },
  { method: 'post', path: '/submissions', moves: true, why: 'a final count appears (and the auto-close it carries)' },
  { method: 'post', path: '/sessions/:id/approval', moves: false, why: 'an approval decision flips issue to done without touching the time; both states count' },
  { method: 'post', path: '/sessions/:id/approval/lines', moves: false, why: 'a line decision, the same' },
  { method: 'patch', path: '/sessions/:id/items/:productId', moves: false, why: 'an observation: an open session count is not final' },
  { method: 'patch', path: '/sessions/:id', moves: true, why: 'close of a count session (counts become final, tasks auto-close) or of a task (hand close), and the resume that takes counts back and reopens tasks' },
]

check('every writer route of Inventory Check is in the table, and the table has no stale row (a new writer must be classified)', () => {
  const found = handlers.filter((h) => h.method !== 'get').map((h) => `${h.method} ${h.path}`).sort()
  assert.deepEqual(found, WRITERS.map((w) => `${w.method} ${w.path}`).sort())
})

check('a writer that can change the board calls boardWrites(c) and boardBranch(c, answer); one that cannot calls neither (observation, approvals, a new open session)', () => {
  for (const w of WRITERS) {
    const handler = handlers.find((h) => h.method === w.method && h.path === w.path)
    assert.ok(handler, `${w.method} ${w.path}`)
    assert.equal(handler.text.includes('boardWrites(c)'), w.moves, `${w.method} ${w.path} boardWrites: ${w.why}`)
    assert.equal(handler.text.includes('boardBranch(c,'), w.moves, `${w.method} ${w.path} boardBranch: ${w.why}`)
  }
})

check('the bump middleware moves inventory_checks as before AND, for a board writer, the branch namespace in the same awaited call; an unknown branch (a 5xx) moves products, which the board also keys on', () => {
  const middleware = route.slice(route.indexOf("app.use('*', async (c, next) => {\n  await next()"), route.indexOf('// ---- ic_wired'))
  assert.ok(/bumpVersions\(c\.env, \['inventory_checks', \.\.\.board\]\)/.test(middleware), 'one call carries both')
  assert.ok(/const board = c\.get\('icBoard'\) \? \[c\.get\('icBranch'\) \? icTasksNamespace\(c\.get\('icBranch'\) as number\) : 'products'\] : \[\]/.test(middleware), 'the branch, else products')
  assert.ok(middleware.includes("status >= 400 && status < 500) return"), 'a refusal moves nothing')
  assert.equal((route.match(/c\.set\('icBranch'/g) || []).length, 1, 'the branch is set in one place, from the writer answer item.branch_id')
  assert.ok(route.includes('const branch = Number(result.item?.branch_id)'))
})

check('the Sets that close a difference, their Undo and Redo, and the plain Revert move the Set\'s own branch, beside inventory_checks', () => {
  const inventory = read('routes/inventory.ts'), batches = read('routes/batches.ts'), lot = read('lib/stockLotAdjustment.ts'), appliers = read('lib/undoAppliers.ts'), revert = read('lib/stockRevert.ts'), history = read('routes/actionHistory.ts')
  // every bump of inventory_checks outside the Inventory Check route itself names a branch board in the same statement
  for (const [name, text] of [['routes/inventory.ts', inventory], ['routes/batches.ts', batches]]) {
    const lines = text.split('\n').filter((line) => /bumpVersions?\(|\.push\(/.test(line) && line.includes("'inventory_checks'"))
    assert.ok(lines.length >= (name === 'routes/inventory.ts' ? 4 : 1), `${name} bump sites found`)
    for (const line of lines) assert.ok(line.includes('icTasksNamespace('), `${name}: ${line.trim()}`)
  }
  assert.ok(/countBranch/.test(revert) && /countBranch/.test(inventory), 'the plain Revert names the branch of the count it took back')
  assert.ok(/Promise<string\[\]>/.test(lot.slice(lot.indexOf('export async function replayStockLotSet'))), 'the Set replay answers the namespaces it moved')
  assert.ok(/const moved = await replayStockLotSet\(/.test(appliers) && /bumpChange\(ctx, moved\)/.test(appliers), 'the applier hands them to the route ONE bump')
  assert.ok(history.includes("case STOCK_LOT_SET_KIND: return ['products', 'inventory_checks']"), 'the route list is unchanged: the branch is known only inside the replay')
})

check('P2.5: the board is read through ONE version call, and GET /tasks answers the version its key holds (no second read)', () => {
  const reader = route.slice(route.indexOf('async function readTaskBoard'), route.indexOf('/** What a viewer is told of a task'))
  assert.equal((reader.match(/getVersionsWithFallback\(/g) || []).length, 1)
  assert.ok(reader.includes('[icTasksNamespace(branchId), \'products\']'), 'keyed on the branch board and products')
  assert.equal(reader.includes('inventoryChecksVersion('), false, 'not on the count version')
  assert.ok(reader.includes('order=3'), 'a new entry URL: no old entry is read')
  assert.ok(reader.includes('return { rows, version }'))
  const tasks = handlers.find((h) => h.method === 'get' && h.path === '/tasks').text
  assert.equal(tasks.includes('inventoryChecksVersion('), false, 'GET /tasks reads no version of its own')
  assert.ok(tasks.includes('const { rows, version } = await readTaskBoard(c, branchId)') && tasks.includes('c.json({ branchId, version, items'))
})

check('P2.6: the list of one task does not key on the count version; the check state, the day and the grouping still do', () => {
  assert.ok(route.includes("const groupedVersion = grouping && !setsVersion ? await inventoryChecksVersion(c.env) : setsVersion"))
  assert.ok(route.includes('...(plan.checkState || plan.checkedOn || grouping ? { setVersion: groupedVersion } : {})'))
  const page = route.slice(route.indexOf('async function readListPage'), route.indexOf("app.get('/list'"))
  assert.equal(/setVersion[^\n]*extra\.task|extra\.task[^\n]*setVersion|\(grouping \|\| extra\.task\)/.test(page), false, 'extra.task is in no version condition')
  assert.ok(page.includes('...(extra.task ? { task: { id: extra.task.id, status: extra.task.status, total: extra.task.productIds.length } } : {})'), 'the status beside the page is the live one')
})

check('P2.7: an idsOnly read answers right after the reader, before lotCountsOn, the capabilities, the projection, the grouping block and the summary', () => {
  const page = route.slice(route.indexOf('async function readListPage'), route.indexOf("app.get('/list'"))
  const early = page.indexOf('if (extra.idsOnly) return {')
  assert.ok(early > 0)
  for (const later of ['await lotCountsOn(c)', 'await submissionCaps(c', 'availableGroupings(access.fields)', 'projectInventoryList(payload', 'buildGroupingBlock(', 'await readCheckSummary(']) assert.ok(page.indexOf(later) > early, `${later} runs after the early return`)
  assert.ok(page.indexOf('await readProductSearchList(') < early)
})

console.log(`${passed} checks passed`)
