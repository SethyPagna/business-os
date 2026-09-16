import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { resolveReplayAction } from '../src/utils/actionReplay.ts'

// Locks the K1 double-apply guard (resolveReplayAction): when the Worker has
// already replayed a reversal server-side (applied:true), the mutating closure
// must be skipped in favor of the refresh-only callback, so the client never
// writes the same reversal a second time (which under optimistic concurrency
// would also conflict). In every other case the original closure runs, exactly
// as before server appliers existed.

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const refresh = () => 'refreshed'
const action = () => 'mutated'

const actionHistorySource = fs.readFileSync(new URL('../src/utils/actionHistory.ts', import.meta.url), 'utf8')
const replayRequestHelperSource = actionHistorySource.match(/export function buildServerReplayRequest[\s\S]*?\r?\n}\r?\n/)?.[0]
assert.ok(replayRequestHelperSource, 'the server replay request helper is present')
const buildServerReplayRequest = new Function(
  `${stripTypeScriptTypes(replayRequestHelperSource.replace('export ', ''))}; return buildServerReplayRequest`,
)() as (payload: Record<string, unknown> | undefined) => Record<string, unknown>

await runTest('generation-guarded server appliers send their exact expected generation', () => {
  for (const applier of ['product.merge.group', 'product.remove', 'product.merge.bulk', 'sale.settlement', 'stock.transfer']) {
    assert.deepEqual(
      buildServerReplayRequest({ applier, generation: 0 }),
      { require_applied: true, expected_generation: 0 },
      `${applier} keeps generation zero rather than dropping it`,
    )
  }
  assert.match(actionHistorySource, /const replayRequest = buildServerReplayRequest\(payload\)/, 'Undo and Redo share the guarded request builder')
})

const transferReplaySource = actionHistorySource.match(/export async function executeTransferReplay[\s\S]*?\r?\n}\r?\n/)?.[0]
assert.ok(transferReplaySource)
const executeTransferReplay = new Function(`${stripTypeScriptTypes(transferReplaySource.replace('export ', ''))}; return executeTransferReplay`)()
for (const direction of ['undo', 'redo']) {
  await runTest(`transfer ${direction} lost committed reply reloads the exact generation before I/O`, async () => {
    const rows = new Map<string, string>()
    const store = { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value) }, removeItem: (key: string) => { rows.delete(key) } }
    const requested = { serverId: 42, operationId: 'server-operation-42', direction, generation: 0 }
    const sent: unknown[] = []
    let commits = 0
    const receipts = new Map<string, unknown>()
    const server = async (pending: any, body: any) => {
      assert.ok(rows.get('actor-7'), 'durable identity exists before network mutation')
      sent.push({ pending, body })
      const identity = JSON.stringify(pending)
      if (!receipts.has(identity)) { commits++; receipts.set(identity, { applied: true, item: { id: 42 } }) }
      if (sent.length === 1) throw new Error('Lost committed response')
      return receipts.get(identity)
    }
    await assert.rejects(executeTransferReplay(store, 'actor-7', requested, server), /Lost committed response/)
    await assert.rejects(executeTransferReplay(store, 'actor-7', { ...requested, serverId: 43 }, server), /pending transfer history/)
    assert.equal(sent.length, 1, 'a different action cannot overwrite the unresolved transition')
    await executeTransferReplay(store, 'actor-7', { ...requested, direction: direction === 'undo' ? 'redo' : 'undo', generation: 1 }, server)
    assert.deepEqual(sent[0], sent[1], 'refetched history cannot replace the pending generation or direction')
    assert.equal(commits, 1)
    assert.equal(rows.get('actor-7'), undefined)
    assert.equal(store.getItem('actor-8'), null)
  })
}
await runTest('transfer history storage failure and non-applied response preserve retry safety', async () => {
  const requested = { serverId: 42, operationId: 'operation', direction: 'undo', generation: 0 }
  let sends = 0
  const unavailable = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  await assert.rejects(executeTransferReplay(unavailable, 'actor', requested, async () => { sends++; return {} }), /could not be saved/)
  assert.equal(sends, 0)
  let raw: string | null = null
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value }, removeItem: () => { raw = null } }
  await assert.rejects(executeTransferReplay(storage, 'actor', requested, async () => ({ applied: false })), /not applied/)
  assert.ok(raw)
  await assert.rejects(executeTransferReplay(storage, 'actor', requested, async () => { throw Object.assign(new Error('edge refusal'), { status: 403, transientGateway: true }) }), /edge refusal/)
  assert.ok(raw, 'an intermediary refusal keeps its uncertain request')
  await assert.rejects(executeTransferReplay(storage, 'actor', requested, async () => { throw Object.assign(new Error('consumed lot'), { status: 409 }) }), /consumed lot/)
  assert.equal(raw, null, 'authoritative no-op releases the transition so a different history action can proceed')
})

await runTest('unguarded and generation-less server appliers retain the existing request shape', () => {
  assert.deepEqual(buildServerReplayRequest({ applier: 'product.merge', generation: 7 }), { require_applied: true })
  assert.deepEqual(buildServerReplayRequest({ applier: 'product.merge.group' }), { require_applied: true })
})

await runTest('server applied + a refresh callback -> the refresh runs, not the mutating closure', () => {
  const chosen = resolveReplayAction({ serverApplied: true, refresh, action })
  assert.strictEqual(chosen, refresh)
  assert.strictEqual(chosen?.(), 'refreshed')
})

await runTest('server applied but NO refresh callback -> falls back to the closure (never a no-op)', () => {
  const chosen = resolveReplayAction({ serverApplied: true, refresh: undefined, action })
  assert.strictEqual(chosen, action)
})

await runTest('server did NOT apply -> the closure runs even when a refresh callback exists (client-replay path unchanged)', () => {
  const chosen = resolveReplayAction({ serverApplied: false, refresh, action })
  assert.strictEqual(chosen, action)
})

await runTest('server did NOT apply and there is no closure -> undefined (nothing to run)', () => {
  const chosen = resolveReplayAction({ serverApplied: false, refresh: undefined, action: undefined })
  assert.strictEqual(chosen, undefined)
})

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll resolveReplayAction checks passed.')
