import assert from 'node:assert/strict'
import { apiFetch, route, setSyncServerUrl, __resetApiHealthForTests, __resetApiWriteDedupeForTests, WRITE_REQUEST_TIMEOUT_MS } from '../src/api/http.ts'

const saved = { fetch: globalThis.fetch, window: globalThis.window, CustomEvent: globalThis.CustomEvent, setTimeout: globalThis.setTimeout }
const events: any[] = []
globalThis.CustomEvent = class extends Event { detail: unknown; constructor(type: string, init: any = {}) { super(type); this.detail = init.detail } } as any
globalThis.window = { dispatchEvent: (event: any) => { events.push(event); return true }, addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout } as any
function reset() { events.length = 0; __resetApiHealthForTests(); __resetApiWriteDedupeForTests(); setSyncServerUrl('https://sync.example.test') }
function aborted(signal: AbortSignal | null | undefined): Promise<any> { return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })) }
try {
  reset()
  const durations: number[] = []
  globalThis.setTimeout = ((fn: any, delay: number, ...args: any[]) => { durations.push(delay); return saved.setTimeout(fn, delay, ...args) }) as any
  globalThis.fetch = async () => new Response('{}', { status: 200 })
  await apiFetch('GET', '/api/settings')
  await apiFetch('POST', '/api/settings', { theme: 'light' })
  await apiFetch('POST', '/api/settings', { theme: 'dark' }, 2345)
  assert.deepEqual(durations, [12000, WRITE_REQUEST_TIMEOUT_MS, 2345])
  assert.equal(WRITE_REQUEST_TIMEOUT_MS, 45000)
  globalThis.setTimeout = saved.setTimeout
  console.log('PASS writes have a bounded longer default; reads and explicit deadlines remain unchanged')

  reset()
  let writes = 0
  globalThis.fetch = async (_url, init) => { writes++; return aborted(init?.signal) }
  await assert.rejects(route('settings:save', () => apiFetch('POST', '/api/settings', { theme: 'dark' }, 5), null, true), (e: any) => e.code === 'request_timeout' && e.outcome === 'unknown' && e.timeoutMs === 5)
  assert.equal(writes, 1, 'lost write responses must not trigger an automatic resubmission')
  assert.equal(events.filter(e => e.type === 'sync:write-blocked').length, 0)
  const timeout = events.find(e => e.type === 'sync:error')?.detail
  assert.equal(timeout.outcome, 'unknown')
  assert.equal(timeout.code, 'request_timeout')
  assert.equal(timeout.timeoutMs, 5)
  console.log('PASS timed-out writes retain uncertainty and duration without blind retry or false write-blocked notice')

  reset()
  globalThis.fetch = async (_url, init) => ({ ok: true, status: 200, headers: new Headers(), json: () => aborted(init?.signal) }) as any
  await assert.rejects(apiFetch('POST', '/api/settings', {}, 5), (e: any) => e.code === 'request_timeout' && e.outcome === 'unknown')
  console.log('PASS write deadline covers response-body receipt, not only headers')

  for (const status of [400, 503]) {
    reset()
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Rejected', code: 'test_error' }), { status })
    await assert.rejects(route('settings:save', () => apiFetch('POST', '/api/settings', {}), null, true), (e: any) => e.status === status && e.outcome === (status === 503 ? 'unknown' : undefined))
  }
  console.log('PASS confirmed validation failures remain distinct from uncertain server failures')

  reset()
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  await assert.rejects(route('products:create', () => apiFetch('POST', '/api/products', {}), null, true), (e: any) => e.outcome === 'unknown')
  reset()
  globalThis.fetch = async (_url, init) => aborted(init?.signal)
  await assert.rejects(apiFetch('GET', '/api/settings', undefined, 5), (e: any) => e.code === 'request_timeout' && e.outcome === undefined)
  console.log('PASS network write failures are uncertain while read timeout is not a write outcome')
} finally {
  Object.assign(globalThis, saved)
  __resetApiHealthForTests(); __resetApiWriteDedupeForTests(); setSyncServerUrl('')
}
