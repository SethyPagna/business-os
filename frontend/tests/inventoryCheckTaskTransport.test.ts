import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { __resetApiHealthForTests, __resetApiWriteDedupeForTests, setSyncServerUrl } from '../src/api/http.ts'
import { captureInventoryCheckWriteScope, closeInventoryCheckTask, issueInventoryCheckTask, pickupInventoryCheckTask, readInventoryCheckTasks, releaseInventoryCheckTask } from '../src/api/inventoryChecksTransport.ts'
import { taskRefusalSentence } from '../src/components/inventory/inventoryCheckTaskText.ts'

// Count-task refusals through the REAL transport: the Worker's own refusal bodies (routes/inventoryChecks.ts onError: `{ ...details, error: code, code }`,
// contract section 6) go through the real http.ts and the real task API calls, and the error they throw feeds the sentence the screen shows, in en and km.
const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
const tEn = (key: string) => en[key]
const tKm = (key: string) => km[key]
const fill = (text: string, values: Record<string, string | number>) => Object.entries(values).reduce((out, [key, value]) => out.replace(`{${key}}`, String(value)), text)

// The browser the transport runs in: readable storage with a signed-in user, and the window route() announces a failed write on.
const memoryStorage = (): Storage => {
  const values = new Map<string, string>()
  return { get length() { return values.size }, clear: () => values.clear(), key: index => [...values.keys()][index] ?? null, getItem: key => values.get(String(key)) ?? null, setItem: (key, value) => { values.set(String(key), String(value)) }, removeItem: key => { values.delete(String(key)) } }
}
const localStorage = memoryStorage()
localStorage.setItem('businessos_user', JSON.stringify({ id: 7, role_code: 'admin', permissions: { inventory: true, inventory_checks: true } }))
Object.assign(globalThis, { window: { localStorage, sessionStorage: memoryStorage(), location: { origin: 'https://admin.example.test' }, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} } })

const context = { branchId: '1', sessionId: '', epoch: 1 }
const scope = () => captureInventoryCheckWriteScope(context, () => true)
type Call = () => Promise<unknown>
const calls: Record<string, Call> = {
  issue: () => issueInventoryCheckTask(scope(), { branchId: 1, requestId: 'issue-aaaaaaaa', scope: { productIds: [5, 9] } }),
  pickup: () => pickupInventoryCheckTask(scope(), 'task-1', 'pickup-aaaaaaa'),
  release: () => releaseInventoryCheckTask(scope(), 'task-1', 'release-aaaaaa'),
  close: () => closeInventoryCheckTask(scope(), 'task-1', 3, 'close-aaaaaaaa'),
}

/** The error the page really receives: the real call, the real apiFetch, a stubbed network answer carrying the Worker's body. */
async function refusal(call: keyof typeof calls, status: number, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const saved = globalThis.fetch
  const seen: string[] = []
  globalThis.fetch = (async (input: unknown) => {
    seen.push(String(input))
    return new Response(JSON.stringify({ success: false, ...body }), { status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  setSyncServerUrl('https://admin.example.test'); __resetApiHealthForTests(); __resetApiWriteDedupeForTests()
  try {
    await calls[call]()
  } catch (error) {
    assert.equal(seen.length, 1, 'the refusal was one real request: ' + String((error as Error)?.stack))
    return error as Record<string, unknown>
  } finally { globalThis.fetch = saved }
  throw new Error(`the stub answered ${status} but ${call} did not throw`)
}
const bodyOf = (code: string, details: Record<string, unknown> = {}) => ({ ...details, error: code, code })

// 1. The open-task limit: the 409 on Issue keeps both figures and the sentence says them, in both languages.
const limit = await refusal('issue', 409, bodyOf('inventory_check_task_limit', { open: 10, limit: 10 }))
assert.equal(limit.code, 'inventory_check_task_limit'); assert.equal(limit.status, 409)
assert.equal(limit.open, 10); assert.equal(limit.limit, 10)
assert.equal(taskRefusalSentence(tEn, limit), '10 open tasks here (limit 10). Close one first.')
assert.equal(taskRefusalSentence(tKm, limit), fill(km.inventory_check_task_limit_count, { open: 10, limit: 10 }))
assert.ok(/[ក-៿]/.test(taskRefusalSentence(tKm, limit) ?? ''), 'the Khmer sentence is Khmer')

// 2. Too many products: the figures, and "at least" when the count stopped early.
const tooMany = await refusal('issue', 400, bodyOf('inventory_check_task_too_many', { total: 301, limit: 300 }))
assert.equal(tooMany.total, 301); assert.equal(tooMany.limit, 300); assert.equal(tooMany.atLeast, undefined, 'an exact count is not "at least"')
assert.equal(taskRefusalSentence(tEn, tooMany), '301 products. A task holds at most 300. Narrow the selection.')
assert.equal(taskRefusalSentence(tKm, tooMany), fill(km.inventory_check_task_too_many_count, { total: 301, limit: 300 }))
const atLeast = await refusal('issue', 400, bodyOf('inventory_check_task_too_many', { total: 120, limit: 100, atLeast: true }))
assert.equal(atLeast.atLeast, true); assert.equal(atLeast.total, 120); assert.equal(atLeast.limit, 100)
assert.equal(taskRefusalSentence(tEn, atLeast), 'At least 120 products. A task holds at most 100. Narrow the selection.')
assert.equal(taskRefusalSentence(tKm, atLeast), fill(km.inventory_check_task_too_many_at_least, { total: 120, limit: 100 }))

// 3. Pick up: who holds the task, and whether it is the caller (mine drives the page's own-pickup branch and hides the "picked up by" line).
const theirs = await refusal('pickup', 409, bodyOf('inventory_check_task_picked_up', { pickedUpBy: 'dara', mine: false }))
assert.equal(theirs.pickedUpBy, 'dara'); assert.equal(theirs.mine, false, 'mine: false survives the transport as false, not as missing')
assert.equal(taskRefusalSentence(tEn, theirs), 'Picked up by @dara')
assert.equal(taskRefusalSentence(tKm, theirs), km.inventory_check_task_picked_up_by.replace('{name}', '@dara'))
assert.ok(taskRefusalSentence(tEn, theirs)?.includes('dara'), 'the name reaches the sentence')
assert.ok(taskRefusalSentence(tKm, theirs)?.includes('dara') && !taskRefusalSentence(tKm, theirs)?.includes('{'), 'the name reaches the Khmer sentence')
const mine = await refusal('pickup', 409, bodyOf('inventory_check_task_picked_up', { pickedUpBy: 'dara', mine: true }))
assert.equal(mine.mine, true, 'mine: true survives the transport')
assert.equal(taskRefusalSentence(tEn, mine), null, 'a pickup that is the caller\'s own says nothing about who holds it')

// 4. Every other task writer carries the same fields (the figures are read for any inventory_check_task_ code, not for Issue alone).
for (const name of ['release', 'close', 'pickup'] as const) {
  const error = await refusal(name, 409, bodyOf('inventory_check_task_closed', { open: 2, limit: 10 }))
  assert.equal(error.code, 'inventory_check_task_closed', `${name}: code`)
  assert.equal(error.status, 409, `${name}: status`)
  assert.equal(error.open, 2, `${name}: open`); assert.equal(error.limit, 10, `${name}: limit`)
}

// 5. The read of the board goes through the same transport.
{
  const saved = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ success: false, ...bodyOf('inventory_check_task_limit', { open: 4, limit: 10 }) }), { status: 409, headers: { 'content-type': 'application/json' } })) as typeof fetch
  setSyncServerUrl('https://admin.example.test'); __resetApiHealthForTests(); __resetApiWriteDedupeForTests()
  try { await readInventoryCheckTasks(1); assert.fail('the board read did not throw') } catch (error) { assert.equal((error as { open?: number }).open, 4) } finally { globalThis.fetch = saved }
}

// 6. A non-task code gains no task figures, and a task code ignores values of the wrong type.
const other = await refusal('issue', 400, bodyOf('inventory_check_invalid_query', { open: 10, limit: 10, total: 3, atLeast: true, pickedUpBy: 'dara', mine: true }))
for (const key of ['open', 'limit', 'total', 'atLeast', 'pickedUpBy', 'mine']) assert.equal(other[key], undefined, `a non-task refusal has no ${key}`)
const wrongTypes = await refusal('issue', 409, bodyOf('inventory_check_task_limit', { open: '10', limit: null, total: {}, atLeast: 'true', pickedUpBy: 5, mine: 'yes' }))
for (const key of ['open', 'limit', 'total', 'atLeast', 'pickedUpBy', 'mine']) assert.equal(wrongTypes[key], undefined, `a ${key} of the wrong type is dropped`)
assert.equal(taskRefusalSentence(tEn, wrongTypes), null, 'no figures: the ordinary refusal table says it')

console.log('inventoryCheckTaskTransport ok')
