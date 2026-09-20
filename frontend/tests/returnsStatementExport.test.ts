import assert from 'node:assert/strict'
import { returnsStatementParams } from '../src/utils/returnsExportWindow.ts'
import { readCompleteReturnStatement, type ReturnStatementPage } from '../src/api/returnsStatementTransport.ts'
import { invalidateActorReadChannel, resetActorReadSession } from '../src/api/actorReadScope.ts'

const year = { startDate: '2024-01-01', endDate: '2024-12-31' }
for (const unsupported of ['0000', '0001', '0099', '10000']) {
  assert.throws(() => returnsStatementParams({ startDate: `${unsupported}-01-01`, endDate: `${unsupported}-01-01` }), RangeError)
}
assert.deepEqual(returnsStatementParams({ startDate: '0100-01-01', endDate: '0100-01-01' }), {
  startDate: '0100-01-01', endDate: '0100-01-01', createdFrom: '0099-12-31 17:00:00', createdTo: '0100-01-01 17:00:00',
})
assert.deepEqual(returnsStatementParams({ startDate: '9999-01-01', endDate: '9999-12-31' }), {
  startDate: '9999-01-01', endDate: '9999-12-31', createdFrom: '9998-12-31 17:00:00', createdTo: '9999-12-31 17:00:00',
}, 'local exclusive endpoint rolls into year10000, but UTC wire bounds remain four-digit years')
assert.deepEqual(returnsStatementParams(year), {
  ...year, createdFrom: '2023-12-31 17:00:00', createdTo: '2024-12-31 17:00:00',
})
assert.doesNotThrow(() => returnsStatementParams({ startDate: '2024-02-29', endDate: '2025-02-27' }))
assert.doesNotThrow(() => returnsStatementParams({ startDate: '2026-09-20', endDate: '2026-09-20', startTime: '08:00', endTime: '08:00' }))
for (const range of [
  { ...year, endDate: '2025-01-01' }, { startDate: '2024-02-29', endDate: '2025-02-28' },
  { ...year, startDate: '' }, { ...year, endDate: '2023-12-31' },
  { startDate: '2025-02-29', endDate: '2025-03-01' },
  { ...year, startTime: '24:00' },
]) assert.throws(() => returnsStatementParams(range), RangeError)

type Row = { id: number }
const input = Array.from({ length: 21001 }, (_, i) => ({ id: i + 1 }))
let inFlight = 0, maxInFlight = 0, reads = 0, verified = 0
const result = await readCompleteReturnStatement(year, { scope: 'supplier', type: 'refund' }, {
  async readPage(query, cursor, token) {
    assert.ok(Object.isFrozen(query)); assert.equal(query.limit, 500)
    assert.equal(query.scope, 'supplier'); assert.equal(query.type, 'refund')
    assert.equal(query.createdTo, '2024-12-31 17:00:00')
    maxInFlight = Math.max(maxInFlight, ++inFlight); reads++
    await Promise.resolve()
    const offset = Number(cursor || 0), rows = input.slice(offset, offset + 500)
    if (offset) assert.equal(token, 'authoritative-fixture-generation')
    inFlight--
    return { rows, total: input.length, snapshotToken: 'authoritative-fixture-generation', nextCursor: offset + rows.length < input.length ? String(offset + rows.length) : null }
  },
  async verifySnapshot(_query, token) { assert.equal(token, 'authoritative-fixture-generation'); verified++ },
})
assert.deepEqual(result.rows, input); assert.equal(reads, 43); assert.equal(maxInFlight, 1); assert.equal(verified, 1)
result.assertCurrent()
invalidateActorReadChannel('returns')
assert.throws(result.assertCurrent, { name: 'AbortError' }, 'a prepared result cannot later publish after invalidation')

let emptyVerified = false
assert.deepEqual((await readCompleteReturnStatement(year, {}, {
  readPage: async () => ({ rows: [], total: 0, snapshotToken: 'empty-generation', nextCursor: null }),
  verifySnapshot: async () => { emptyVerified = true },
})).rows, [])
assert.ok(emptyVerified)

const goodPage: ReturnStatementPage<Row> = { rows: [{ id: 1 }], total: 1, snapshotToken: 'guard', nextCursor: null }
for (const bad of [
  { ...goodPage, rows: [{ id: 1 }, { id: 1 }], total: 2 },
  { ...goodPage, total: 2 }, { ...goodPage, snapshotToken: '' },
  { ...goodPage, nextCursor: 'repeat' }, { ...goodPage, total: -1 },
  { ...goodPage, rows: [{ id: 0 }] },
]) {
  let finalized = false
  await assert.rejects(readCompleteReturnStatement(year, {}, {
    readPage: async () => bad, verifySnapshot: async () => { finalized = true },
  }))
  assert.equal(finalized, false)
}
for (const channel of ['returns', 'products', 'sales', 'customers']) {
  await assert.rejects(readCompleteReturnStatement(year, {}, {
    readPage: async () => { invalidateActorReadChannel(channel); return goodPage },
    verifySnapshot: async () => { throw Error('Must not finalize stale page') },
  }), { name: 'AbortError' })
}
await assert.rejects(readCompleteReturnStatement(year, {}, {
  readPage: async () => { resetActorReadSession(); return goodPage },
  verifySnapshot: async () => { throw Error('Must not finalize a prior actor') },
}), { name: 'AbortError' })
// The real actor guard compares permission-bearing identity, not just user ID.
const stored = new Map<string, string>()
const storage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, value) },
  removeItem: (key: string) => { stored.delete(key) },
}
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  localStorage: storage, sessionStorage: storage, location: { origin: 'https://statement.test' },
} })
stored.set('businessos_user', JSON.stringify({ id: 7, permissions: { returns_export: true } }))
await assert.rejects(readCompleteReturnStatement(year, {}, {
  readPage: async () => {
    stored.set('businessos_user', JSON.stringify({ id: 7, permissions: { returns_export: false } }))
    return goodPage
  },
  verifySnapshot: async () => { throw Error('Must not finalize after same-user revocation') },
}), { name: 'AbortError' })
await assert.rejects(readCompleteReturnStatement(year, {}, {
  readPage: async () => {
    stored.set('businessos_user', JSON.stringify({ id: 8, permissions: { returns_export: true } }))
    return goodPage
  },
  verifySnapshot: async () => { throw Error('Must not finalize after account change') },
}), { name: 'AbortError' })
Reflect.deleteProperty(globalThis, 'window')
const controller = new AbortController()
await assert.rejects(readCompleteReturnStatement(year, {}, {
  signal: controller.signal,
  readPage: async () => { controller.abort(); return goodPage },
  verifySnapshot: async () => { throw Error('Must not finalize cancellation') },
}), { name: 'AbortError' })
await assert.rejects(readCompleteReturnStatement(year, {}, {
  readPage: async () => goodPage,
  verifySnapshot: async () => { throw Error('Server generation changed') },
}), /Server generation changed/)
for (const kind of ['token', 'total', 'cursor', 'network']) {
  let count = 0
  await assert.rejects(readCompleteReturnStatement(year, {}, {
    readPage: async () => {
      count++
      if (count === 1) return { ...goodPage, total: 4, nextCursor: 'one' }
      if (kind === 'network') throw Error('network failure')
      return { rows: [{ id: 2 }], total: kind === 'total' ? 5 : 4, snapshotToken: kind === 'token' ? 'changed' : 'guard', nextCursor: kind === 'cursor' ? 'one' : null }
    },
    verifySnapshot: async () => { throw Error('Must not finalize partial result') },
  }))
  assert.equal(count, 2, 'No automatic retry combining cohorts')
}
console.log('PASS statement windows and candidate transport: 21001 rows, bounded sequential requests, complete-only handoff, scope/cancel/generation/failure fences')
