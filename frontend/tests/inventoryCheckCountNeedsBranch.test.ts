import assert from 'node:assert/strict'
import { createTasksWorld, open, pack, viewerUser } from './inventoryCheckTasksWorld.ts'
import { forgetDeviceDrafts } from './inventoryCheckDeviceDrafts.ts'

// Counts belong to one branch: they are kept per branch on this device, so none can be typed until a branch is chosen. Where the user can see exactly one active branch it is chosen for them
// at open (so there is nothing to choose and counting is open at once); where there are several, the page asks first and offers no count box, status button or Submit until they choose.
// Before: with several branches and none chosen the boxes were there, a typed count was kept only in memory, and choosing a branch dropped it without a word.
const world = await createTasksWorld()
world.user = viewerUser('employee'); world.hideIssuer = true
const countBoxes = (surface: Awaited<ReturnType<typeof world.mount>>) => surface.findAll(node => node.getAttribute('data-check-count') !== null).length
const keys = () => { const out: string[] = []; for (let index = 0; index < localStorage.length; index += 1) { const key = localStorage.key(index); if (key?.startsWith('businessos_draft_v2_')) out.push(decodeURIComponent(key)) } return out }

for (const language of ['en', 'km'] as const) {
  const words = pack(language)
  world.language = language

  // exactly one active branch: chosen automatically, counting is open at once, and a typed count is kept under that branch
  forgetDeviceDrafts(); world.calls.length = 0
  open('products'); let surface = await world.mount()
  assert.equal(world.count('list'), 1, `${language}: the one active branch is chosen at open, from the same answer (one list read)`)
  assert.ok(countBoxes(surface) > 0, `${language}: so the count boxes are there`)
  assert.equal(surface.findAll(node => node.getAttribute('data-count-needs-branch') !== null).length, 0, `${language}: and no "choose a branch" line`)
  await surface.type(surface.find(node => node.getAttribute('data-check-count') !== null, 'count'), '4'); await surface.settle()
  assert.deepEqual(keys().map(key => key.replace(/^.*_inventory-check-counts_/, '')), ['1_list'], `${language}: the count is kept under the branch`)
  await surface.unmount()

  // several branches, none chosen: nothing can be typed, and the page says why
  forgetDeviceDrafts(); world.calls.length = 0
  world.branches.push({ id: 2, name: 'Second' })
  open('products'); surface = await world.mount()
  assert.equal(world.count('overlay'), 0, `${language}: with two branches none is chosen for the user (counts are per branch, so no overlay is read)`)
  assert.equal(countBoxes(surface), 0, `${language}: no count box`)
  assert.equal(surface.findAll(node => node.getAttribute('data-selection-action') === 'submit').length, 0, `${language}: no Submit`)
  assert.equal(surface.find(node => node.getAttribute('data-count-needs-branch') !== null, 'hint').textContent, words.inventory_check_count_blocked_branch, `${language}: and the page says to choose a branch first`)
  assert.deepEqual(keys(), [], `${language}: nothing is kept on the device`)
  await surface.unmount()
  world.branches.pop()
}
world.language = 'en'
forgetDeviceDrafts()
await world.harness.close()
console.log('inventoryCheckCountNeedsBranch passed: one active branch is chosen at open; with several, no count can be typed until one is chosen')
