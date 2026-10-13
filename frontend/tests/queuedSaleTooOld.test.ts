// B1-R on the till (CLAUDE-SEC-SALE-TIME round 2; OPUS-PLAN-OFFLINE-DRAIN-B1 3a): POST /api/sales now answers 409
// sale_created_at_too_old for a queued sale whose own time is older than the Worker's window. The queued row is the
// only copy of a real sale, so the recovery must keep it, mark it failed with the code, and go on to the other rows.
//
// The REAL saleWriteTransport.ts is run (syncPendingSalesQueue -> runPendingSalesQueueSync) with an in-memory sync_queue
// and only apiFetch answered by the test, the way actorReadCacheBoundary.test.ts loads a transport.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const storage = new Map<string, string>()
const browserStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => { storage.delete(key) },
}
Object.assign(globalThis, { window: {
  location: { origin: 'https://fixture.test' }, localStorage: browserStorage, sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {},
} })
const http = await import('../src/api/http.ts')
const scopes = await import('../src/api/actorReadScope.ts')
const ownership = await import('../src/api/offlineQueueOwnership.ts')
const syncRuntime = await import('../src/api/syncRuntime.ts')
const deviceInfo = await import('../src/utils/deviceInfo.ts')
http.setSyncServerUrl('https://fixture.test')
storage.set('businessos_user', JSON.stringify({ id: 7, organization_id: 1, name: 'Cashier' }))
scopes.resetActorReadSession()
const owner = ownership.captureOfflineSaleOwner()

type Row = Record<string, unknown> & { _seq: number }
const rows = new Map<number, Row>()
const table = (name: string) => ({
  where: (field: string) => ({ equals: (value: unknown) => ({ toArray: async () => name === 'sync_queue' ? [...rows.values()].filter((row) => row[field] === value).map((row) => structuredClone(row)) : [] }) }),
  get: async (key: number) => (name === 'sync_queue' && rows.has(key) ? structuredClone(rows.get(key)) : undefined),
  put: async (row: Row) => { if (name === 'sync_queue') rows.set(row._seq, structuredClone(row)) },
  delete: async (key: number) => { if (name === 'sync_queue') rows.delete(key) },
})
const db = { table, transaction: async (...args: unknown[]) => (args.at(-1) as () => unknown)() }

type Answer = (body: Record<string, unknown>) => unknown
const posted: string[] = []
let answer: Answer = () => ({})
const fakeHttp = {
  ...http,
  apiFetch: async (method: string, path: string, body?: Record<string, unknown>) => {
    if (method === 'GET' && path === '/api/sync/owner') return { owner }
    assert.equal(`${method} ${path}`, 'POST /api/sales')
    posted.push(String(body?.client_request_id))
    return answer(body || {})
  },
}
function loadModule(path: string, dependencies: Record<string, unknown>): any {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  new Function('exports', 'require', code)(exports, (name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`)
    return dependencies[name]
  })
  return exports
}
const transport = loadModule('../src/api/saleWriteTransport.ts', {
  '../utils/deviceInfo.ts': deviceInfo,
  './http.ts': fakeHttp,
  './lazyLocalDb.ts': { getLocalDb: async () => db },
  './actorReadScope.ts': scopes,
  './offlineQueueOwnership.ts': ownership,
  './syncRuntime.ts': syncRuntime,
})

const TOO_OLD_TEXT = 'This sale was saved on this device at an earlier time and is kept there. Nothing was recorded.'
const tooOld = () => Object.assign(new Error(TOO_OLD_TEXT), { status: 409, code: 'sale_created_at_too_old', conflict: false, claimed_created_at: '2026-09-15 03:00:00' })
const queuedSale = (seq: number, id: string, createdAt: string): Row => ({
  _seq: seq, id, channel: 'sales:create', status: 'pending', created_at: createdAt, updated_at: createdAt, retry_count: 0,
  entity_table: 'sales', entity_id: -seq, entity_name: `R-${seq}`,
  payload: { client_request_id: id, offline_owner: owner, created_at: createdAt.replace('T', ' ').slice(0, 19) },
})
const accepted: Answer = (body) => ({ success: true, client_request_id: body.client_request_id, offline_owner: body.offline_owner, receiptNumber: 'R-ok' })
const refuseOld = (...ids: string[]): Answer => (body) => { if (ids.includes(String(body.client_request_id))) throw tooOld(); return accepted(body) }

function seed(...list: Row[]): void { rows.clear(); posted.length = 0; for (const row of list) rows.set(row._seq, structuredClone(row)) }
async function recover(force: boolean) {
  const reviewedRows = [...rows.values()].map((row) => structuredClone(row))
  return transport.syncPendingSalesQueue({ force, manualRecovery: true, expectedOwner: owner, reviewedRows }) as Promise<{ attempted: number; synced: number; failed: number }>
}

let failed = 0
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const OLD = '2026-09-15T03:00:00.000Z'
const NEWER = '2026-09-16T03:00:00.000Z'

await check('a queued sale the Worker refuses as too old stays in the queue, failed, with the code, and is not retried on a timer', async () => {
  seed(queuedSale(1, 'sale_old', OLD))
  answer = refuseOld('sale_old')
  const result = await recover(true)
  assert.equal(result.synced, 0)
  assert.equal(result.failed, 1)
  assert.equal(rows.size, 1, 'the only copy of the sale is still on the device')
  const kept = rows.get(1)!
  assert.equal(kept.status, 'failed')
  assert.equal(kept.error_code, 'sale_created_at_too_old')
  assert.equal(kept.retry_at, null, 'no automatic retry is scheduled')
  assert.equal(kept.error, TOO_OLD_TEXT)
  assert.equal((kept.payload as { created_at: string }).created_at, '2026-09-15 03:00:00', 'its own time is untouched')
})

await check('one refused row does not stop the others: the older row stays, the newer syncs and is removed', async () => {
  for (const force of [true, false]) {
    seed(queuedSale(1, 'sale_old', OLD), queuedSale(2, 'sale_new', NEWER))
    answer = refuseOld('sale_old')
    const result = await recover(force)
    assert.deepEqual(posted, ['sale_old', 'sale_new'], `force ${force}: both were tried`)
    assert.equal(result.synced, 1)
    assert.equal(result.failed, 1)
    assert.deepEqual([...rows.keys()], [1], `force ${force}: only the refused row is left`)
    assert.equal(rows.get(1)!.status, 'failed')
  }
})

await check('the order does not matter: an accepted older row, then a refused newer one', async () => {
  seed(queuedSale(1, 'sale_a', OLD), queuedSale(2, 'sale_b', NEWER))
  answer = refuseOld('sale_b')
  const result = await recover(false)
  assert.equal(result.synced, 1)
  assert.deepEqual([...rows.keys()], [2])
  assert.equal(rows.get(2)!.error_code, 'sale_created_at_too_old')
})

await check('it stays refused and stays kept on the next recovery (nothing is lost by trying again)', async () => {
  seed(queuedSale(1, 'sale_old', OLD))
  answer = refuseOld('sale_old')
  await recover(true)
  const second = await recover(true)
  assert.equal(second.failed, 1)
  assert.equal(rows.size, 1)
  assert.equal(rows.get(1)!.retry_count, 2)
  assert.equal(rows.get(1)!.error_code, 'sale_created_at_too_old')
})

await check('control: any other non-retryable refusal still stops an unforced recovery, so only this code is row-specific', async () => {
  seed(queuedSale(1, 'sale_a', OLD), queuedSale(2, 'sale_b', NEWER))
  answer = (body) => { if (body.client_request_id === 'sale_a') throw Object.assign(new Error('Prices changed'), { status: 409, code: 'sale_pricing_quote_conflict' }); return accepted(body) }
  const result = await recover(false)
  assert.deepEqual(posted, ['sale_a'], 'the second row was not attempted')
  assert.equal(result.failed, 1)
  assert.equal(rows.get(1)!.error_code, 'sale_pricing_quote_conflict')
})

await check('control: an accepted row is still removed (the only delete is after a 2xx)', async () => {
  seed(queuedSale(1, 'sale_ok', OLD))
  answer = accepted
  const result = await recover(true)
  assert.equal(result.synced, 1)
  assert.equal(rows.size, 0)
})

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nqueuedSaleTooOld: all checks passed')
