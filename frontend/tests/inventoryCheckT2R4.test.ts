import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { REFUSAL_MESSAGES } from '../src/components/inventory/inventoryCheckRefusals.ts'
import { createTasksWorld, open, pack, viewerUser } from './inventoryCheckTasksWorld.ts'
import { forgetDeviceDrafts } from './inventoryCheckDeviceDrafts.ts'

// Count tasks round 4 (after deploy 7): each assertion failed on the deploy-7 tip.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const page = read('../src/components/inventory/InventoryChecksPage.tsx')
const list = read('../src/components/inventory/InventoryCheckTasksList.tsx')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
const KHMER = /[ក-៿]/

// 1. PC columns: the action area has one fixed width from xl, so every row's columns start at the same x (measured in a browser by inventoryCheckTasksLayoutBrowser).
assert.ok(list.includes('xl:order-last xl:ml-0 xl:flex xl:w-40 xl:shrink-0 xl:justify-end'), 'the action area has a fixed width from xl')

// 2. The issuer is labelled, fits its column and stays truncated; absent without issued_by.
const issuer = list.slice(list.indexOf('task.issued_by === \'string\''), list.indexOf('</span> : null}', list.indexOf('data-task-issuer')))
assert.ok(issuer.includes('xl:w-36') && !issuer.includes('xl:w-28') && /className="truncate /.test(issuer), 'the issuer column is 36 wide and truncates')
// On a phone the second line has no room for the words (a held task would take a third line), so the title carries them there and the column shows them from xl.
assert.ok(issuer.includes('<span className="hidden xl:inline">{label(t, \'inventory_check_created_by\', \'Created by\')} </span>@{task.issued_by}') && issuer.includes('title={`${label(t, \'inventory_check_created_by\', \'Created by\')} @${task.issued_by}`}'), 'the issuer reads "Created by @name" from xl, and its title says it everywhere')
assert.ok(en.inventory_check_created_by && KHMER.test(km.inventory_check_created_by), 'both packs have the label')

// 3. One count reads correctly in English; Khmer says the same in the same order; the fallback is the pack's text.
assert.equal(en.inventory_check_draft_dropped, 'Counts removed: {count}. They were counted again after you typed them.')
assert.ok(km.inventory_check_draft_dropped.startsWith('ការរាប់ដែលបានដកចេញ៖ {count}។') && km.inventory_check_draft_dropped.includes('ត្រូវបានរាប់ម្ដងទៀត'), 'km: "Counts removed: {count}." then the reason')
assert.ok(page.includes(`'${en.inventory_check_draft_dropped}'`), 'the page fallback is the English text')

// 7. Stale fallbacks equal the pack text.
const fallbacks: Array<[string, RegExp]> = [
  ['inventory_check_load_failed', /tr\('inventory_check_load_failed', '([^']*)'\)/g],
  ['inventory_check_page_session', /tr\('inventory_check_page_session', '([^']*)'/g],
]
for (const [key, pattern] of fallbacks) {
  const found = [...page.matchAll(pattern)].map(match => match[1])
  assert.ok(found.length >= 1, `${key} is used`)
  for (const fallback of found) assert.equal(fallback, en[key], `${key}: every page fallback is the current copy`)
}
// The shared save fallbacks: "not saved" reads as the pack; an unknown outcome reads as the pack's unknown text, never as "not saved".
assert.ok(!page.includes('Save not confirmed. Retry the same operation or reload.') && !page.includes('Inventory checks are unavailable') && !page.includes('Visible page check'), 'no stale fallback is left on the page')
assert.ok(page.includes(`'${en.inventory_check_save_unknown}'`) && page.includes(`'${en.inventory_check_save_failed}'`), 'both save fallbacks are the pack text')
for (const code of ['inventory_check_lot_counts_off', 'inventory_check_baseline_changed', 'maintenance_active', 'selected_lot_unavailable']) {
  const entry = REFUSAL_MESSAGES[code]; assert.ok(entry, code); assert.equal(entry.fallback, en[entry.key], `${code}: the refusal fallback is the current copy`)
}

// 4 + 5, mounted.
const world = await createTasksWorld({ branches: [{ id: 1, name: 'Main' }] })
world.user = viewerUser('admin')
for (const language of ['en', 'km'] as const) {
  const words = pack(language)
  world.language = language
  // 4. In Issue mode the one Issue control is the labelled button: the entry icon is gone.
  forgetDeviceDrafts(); world.calls.length = 0; world.failures = {}; world.board = []
  open('products'); let surface = await world.mount()
  const entryIcon = () => surface.findAll(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === words.inventory_check_task_issue && !node.hasAttribute('data-issue-action'))
  assert.equal(entryIcon().length, 1, `${language}: the Issue entry icon is there before Issue mode`)
  await surface.click(entryIcon()[0])
  assert.equal(surface.findAll(node => node.getAttribute('data-issue-action') === 'issue').length, 1, `${language}: the labelled Issue button`)
  assert.equal(entryIcon().length, 0, `${language}: and no second Issue control while issuing`)
  await surface.unmount()
}
// 5. With no branch known at all the page says to choose one, instead of showing nothing.
world.user = viewerUser('employee'); world.hideIssuer = true; world.branches.length = 0
for (const language of ['en', 'km'] as const) {
  const words = pack(language)
  world.language = language
  forgetDeviceDrafts(); world.calls.length = 0
  open('products'); const surface = await world.mount()
  assert.equal(surface.find(node => node.getAttribute('data-count-needs-branch') !== null, 'hint').textContent, words.inventory_check_count_blocked_branch, `${language}: no branch known: the hint is shown`)
  await surface.unmount()
}
world.language = 'en'
forgetDeviceDrafts()
await world.harness.close()
console.log('inventoryCheckT2R4 passed: fixed action column, labelled issuer, one count, one Issue button, no-branch hint, current fallbacks')
