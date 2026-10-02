import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import ts from 'typescript'
import { productEditHistoryReceipt, type ProductEditReplayIntent } from '../src/utils/productEditRequests.ts'
import { resolveReplayAction } from '../src/utils/actionReplay.ts'

const source = readFileSync(new URL('../src/utils/actionHistory.ts', import.meta.url), 'utf8')
const helper = source.match(/export function buildServerReplayRequest[\s\S]*?\r?\n}\r?\n/)?.[0]
assert.ok(helper)
const build = new Function(`${stripTypeScriptTypes(helper.replace('export ', ''))}; return buildServerReplayRequest`)()
assert.deepEqual(build({ applier: 'product.edit.v1', operation_id: '1', generation: 0 }), { require_applied: true, expected_generation: 0 })
console.log('PASS product edit replay preserves generation zero')

const { executeProductEditReplay } = await import('../src/utils/productEditRequests.ts')
for (const direction of ['undo', 'redo'] as const) {
  let raw: string | null = null
  const store = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value }, removeItem: () => { raw = null } }
  const pending = { serverId: 42, operationId: '7', direction, generation: 0 }
  const sent: unknown[] = []
  let commits = 0
  const receipts = new Map<string, unknown>()
  const send = async (intent: ProductEditReplayIntent, body: unknown) => {
    assert.ok(raw)
    sent.push({ intent, body })
    const id = JSON.stringify(intent)
    if (!receipts.has(id)) { commits++; receipts.set(id, { applied: true, generation: 1 }) }
    if (sent.length === 1) throw new Error('lost response')
    return receipts.get(id)
  }
  await assert.rejects(executeProductEditReplay(store, 'actor', pending, send, () => {}), /lost response/)
  await assert.rejects(executeProductEditReplay(store, 'actor', pending, async () => { throw Object.assign(new Error('permission revoked'), { status: 403 }) }, () => {}), /permission revoked/)
  assert.ok(raw, 'later permission refusal must preserve the earlier uncertain transition')
  await assert.rejects(executeProductEditReplay(store, 'actor', { ...pending, serverId: 43 }, send, () => {}), /pending Product Undo/)
  await executeProductEditReplay(store, 'actor', { ...pending, direction: direction === 'undo' ? 'redo' : 'undo', generation: 1 }, send, () => {})
  assert.deepEqual(sent[0], sent[1])
  assert.equal(commits, 1)
  assert.equal(raw, null)
  const queued = await executeProductEditReplay(store, 'actor', pending, async () => ({ pending: true, applied: false }), () => {})
  assert.deepEqual(queued, { pending: true, applied: false })
  assert.ok(raw, 'pending approval retains the exact transition')
  await assert.rejects(executeProductEditReplay(store, 'actor', pending, async () => ({ applied: false }), () => {}), /not confirmed/)
  assert.ok(raw)
  await assert.rejects(executeProductEditReplay(store, 'actor', pending, send, () => { throw new Error('stale actor') }), /stale actor/)
  assert.equal(commits, 1)
}
console.log('PASS exact Undo and Redo retries survive refetched generation, pending review and actor change')

const ast = ts.createSourceFile('actionHistory.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
function closure(name: string, scope: Record<string, unknown>): any {
  const matches: ts.VariableDeclaration[] = []
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) matches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(matches.length, 1)
  const javascript = ts.transpileModule(`return ${matches[0].initializer!.getText(ast)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function('useCallback', ...Object.keys(scope), javascript)((fn: unknown) => fn, ...Object.values(scope))
}
const pointer = { applier: 'product.edit.v1', operation_id: '72', generation: 0 }
const result = { applied: true, action_history_id: 88, operation_id: '72', generation: 0, history: { id: 88, undo_payload: pointer, redo_payload: pointer } }
let rows: Array<Record<string, unknown>> = [], refreshes = 0, actorCurrent = true
const adopt = closure('adoptServerAction', {
  actorScopeRef: { current: 'actor7' }, actorScope: 'actor7', readScope: {}, limit: 10,
  isActorReadScopeCurrent: () => actorCurrent, productEditHistoryReceipt,
  setServerItems: (change: (previous: typeof rows) => typeof rows) => { rows = change(rows) },
  refreshServerItems: () => { refreshes++ },
})
assert.equal(adopt(result), true)
assert.equal(adopt(result), true)
assert.equal(rows.length, 1, 'adoption deduplicates the server ID without creating another History row')
assert.equal(refreshes, 2)
actorCurrent = false
assert.equal(adopt({ ...result, action_history_id: 99 }), false)
assert.equal(rows.length, 1)

for (const direction of ['undo', 'redo'] as const) for (const response of [{ applied: true }, { pending: true, applied: false }, { applied: false }]) {
  let mutations = 0, patches = 0, moved = 0
  const entry = { id: 'local', serverId: 88, undo: () => { mutations++ }, redo: () => { mutations++ } }
  const replay = closure('runEntry', {
    undoStack: [entry], redoStack: [entry], busy: '', limit: 10, notify: () => {},
    setBusy: () => {}, refreshServerItems: () => {}, resolveReplayAction,
    setUndoStack: () => { moved++ }, setRedoStack: () => { moved++ },
    getErrorMessage: (error: unknown) => String(error),
    loadActionHistoryTransport: async () => ({ undoActionHistory: async () => response, redoActionHistory: async () => response,
      updateActionHistory: async () => { patches++ } }),
  })
  assert.equal(await replay(direction), !('pending' in response))
  assert.equal(mutations, response.applied === false && !('pending' in response) ? 1 : 0)
  assert.equal(patches, 0)
  assert.equal(moved, 'pending' in response ? 0 : 2)
}
console.log('PASS actual History adoption and replay skip legacy writes after applied and do not advance pending review')
