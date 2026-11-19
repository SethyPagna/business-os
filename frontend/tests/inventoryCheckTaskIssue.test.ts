import assert from 'node:assert/strict'
import { createTasksWorld, open, pack, rowOf, viewerUser, type Surface } from './inventoryCheckTasksWorld.ts'
import { forgetDeviceDrafts } from './inventoryCheckDeviceDrafts.ts'

// Issue mode: ticks on product rows, the scope sent (ids or filters), the review, and every refusal said in its own sentence.
const words = pack('en')
const world = await createTasksWorld()
world.user = viewerUser('admin')
const reset = () => { forgetDeviceDrafts(); world.calls.length = 0; world.notices.length = 0; world.failures = {}; world.board = [] }
const issueButton = (surface: Surface) => surface.find(node => node.getAttribute('data-issue-action') === 'issue', 'Issue')
const ticks = (surface: Surface) => surface.findAll(node => node.getAttribute('data-check-pick') !== null)
// A checkbox answers its change event (the memory DOM does not turn a click into one).
const tick = async (surface: Surface, id: number) => { await surface.call(surface.find(node => node.getAttribute('data-check-pick') !== null && rowOf(surface, id).contains(node), `tick ${id}`), 'onChange', [{ target: { checked: true } }]) }
const confirm = async (surface: Surface, label: string) => { await surface.click(surface.findAll(node => node.tagName === 'BUTTON' && node.textContent === label).at(-1)!) }
const enter = async (surface: Surface) => { await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === words.inventory_check_task_issue && !node.hasAttribute('data-issue-action'), 'Issue entry')) }

reset(); open('products')
let surface = await world.mount()
assert.equal(ticks(surface).length, 0, 'no ticks outside Issue mode')
await enter(surface)
assert.equal(ticks(surface).length, 20, 'a tick on every countable row of the page')
assert.equal(surface.findAll(node => node.getAttribute('data-check-count') !== null).length, 0, 'the Count inputs are hidden while picking')
assert.ok(issueButton(surface).textContent.includes(words.inventory_check_task_issue), 'the one labelled action is "Issue"')
// nothing picked and no filter: blocked with the sentence, and no request
assert.equal(issueButton(surface).getAttribute('aria-disabled'), 'true'); assert.equal(issueButton(surface).getAttribute('title'), words.inventory_check_task_scope_needed)
await surface.click(issueButton(surface))
assert.equal(world.count('issue'), 0, 'no request'); assert.equal(surface.findAll(node => node.tagName === 'DL').length, 0, 'and no review')
// picks survive a page step; the body is the ids, sorted
await tick(surface, 9); await tick(surface, 3)
await surface.click(surface.button('Next', surface.find(node => node.getAttribute('data-inventory-check-pager-lock') !== null, 'pager')))
await tick(surface, 22)
await surface.click(issueButton(surface))
assert.ok(surface.text().includes(words.inventory_check_task_issue_review_title) && surface.text().includes('Main') && surface.text().includes(words.products), 'the review shows Products and Branch from its first paint')
assert.ok(!surface.text().includes('Already in an open task'), 'no "already in an open task" row (lead ruling R1)')
await confirm(surface, words.inventory_check_task_issue)
const body = world.ofRoute('issue')[0].params as { branchId: number; requestId: string; scope: { productIds: number[] } }
assert.deepEqual([body.branchId, body.scope.productIds], [1, [3, 9, 22]], 'branch and the picked ids, sorted, across the page step')
assert.match(body.requestId, /^[A-Za-z0-9_-]{8,120}$/)
assert.ok(world.notices.some(notice => notice.text === words.inventory_check_task_issued.replace('{count}', '3') && notice.tone === 'success'), 'Task issued · 3 products')
assert.equal(ticks(surface).length, 0, 'Issue mode exits'); assert.equal(world.count('tasks') + world.count('list') >= 0, true)
await surface.unmount()

// ---- refusals: each one's own sentence, the mode and the picks stay ----
const refuse = (code: string, status: number, extra: Record<string, unknown> = {}) => Object.assign(new Error(code), { code, status, ...extra })
const cases: Array<[Error, string]> = [
  [refuse('inventory_check_task_too_many', 400, { total: 301, limit: 300 }), words.inventory_check_task_too_many_count.replace('{total}', '301').replace('{limit}', '300')],
  [refuse('inventory_check_task_too_many', 400, { total: 301, limit: 300, atLeast: true }), words.inventory_check_task_too_many_at_least.replace('{total}', '301').replace('{limit}', '300')],
  [refuse('inventory_check_task_too_many', 400), words.inventory_check_error_task_too_many],
  [refuse('inventory_check_task_limit', 409, { open: 30, limit: 30 }), words.inventory_check_error_task_limit],
  [refuse('inventory_check_product_not_eligible', 400), words.inventory_check_error_product_not_eligible],
  [refuse('inventory_check_invalid_query', 400), words.inventory_check_save_failed],
]
for (const [failure, sentence] of cases) {
  reset(); open('products'); world.failures.issue = failure
  surface = await world.mount(); await enter(surface); await tick(surface, 3)
  await surface.click(issueButton(surface)); await confirm(surface, words.inventory_check_task_issue)
  assert.ok(surface.text().includes(sentence), `${(failure as unknown as { code: string }).code}: ${sentence}`)
  assert.equal(ticks(surface).length, 20, 'Issue mode stays open'); assert.ok((surface.find(node => node.getAttribute('data-check-pick') !== null && rowOf(surface, 3).contains(node), 'tick 3') as unknown as { checked?: boolean }).checked !== false, 'and the pick stays')
  await surface.unmount()
}
// a filter scope: the body is exactly the listed keys with empties dropped; a filter that resolves to nothing says so
reset(); open('products'); world.failures.issue = refuse('inventory_check_product_not_eligible', 400)
surface = await world.mount()
await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'Filters', 'Filters'))
await surface.click(surface.button(/Brand/i, surface.find(node => node.getAttribute('data-filter-menu-section') === 'brand', 'Brand section')))
await surface.click(surface.find(node => node.getAttribute('role') === 'option' && node.textContent === 'Dior', 'Dior'))
await enter(surface)
await surface.click(issueButton(surface))
assert.ok(surface.text().includes(words.inventory_check_task_issue_review_title) && surface.text().includes('Brand: Dior'), 'the review shows the filters')
await confirm(surface, words.inventory_check_task_issue)
assert.deepEqual((world.ofRoute('issue')[0].params as { scope: unknown }).scope, { filters: { brand: 'Dior' } }, 'exactly the listed keys, empties dropped')
assert.ok(surface.text().includes(words.inventory_check_task_nothing_to_count), 'a filter that resolves to nothing says so')
await surface.unmount()
console.log('inventoryCheckTaskIssue passed: ticks, the scope sent, the review, every refusal in its own sentence')
