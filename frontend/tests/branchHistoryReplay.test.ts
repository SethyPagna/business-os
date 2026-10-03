// An in-tab Undo / Redo of a branch edit -- the one Branches.tsx runs itself
// when the history row has no server id yet, or its create request failed --
// refuses to overwrite a later edit (FX-undo2, refuter R-undo C7, 27 Sep 2026).
//
// Before: the closures PUT the old snapshot with no version, and
// PUT /branches/:id checks a version only when one is sent, so a later edit
// was silently overwritten. Drives the real
// components/branches/branchHistoryReplay.ts against a branch store that
// behaves like the route, pins the Branches.tsx call site that feeds it, and
// pins its field list to the Worker applier's.
//
// Run: node tests/branchHistoryReplay.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let failed = 0
const runTest = async (name: string, fn: () => void | Promise<void>): Promise<void> => {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

type Row = Record<string, unknown>
type Request = {
  id: string | number
  fields: Row
  expected: Row
  readBranch: (id: string | number) => Promise<Row | null | undefined>
  writeBranch: (id: string | number, body: Row) => Promise<{ success?: boolean; error?: string; pending?: boolean; branch?: Row } | null | undefined>
  refusal: string
  failure: string
}
type Module = {
  BRANCH_REPLAY_TEXT_FIELDS: readonly string[]
  staleBranchReplayFields: (current: Row, expected: Row) => string[]
  replayBranchEdit: (request: Request) => Promise<Row>
}
let mod: Module | null = null
try {
  mod = (await import('../src/components/branches/branchHistoryReplay.ts')) as unknown as Module
} catch (error) {
  console.error('branchHistoryReplay.ts could not be loaded:', (error as Error).message)
}
const need = (): Module => { assert.ok(mod, 'components/branches/branchHistoryReplay.ts exists'); return mod! }

const UNDO_REFUSED = 'Undo refused, in the page language'
const REDO_REFUSED = 'Redo refused, in the page language'

// Small store models complete-row content tokens and committed response snapshots.
function branchStore(initial: Row) {
  let tick = 0
  const stamp = () => `2026-09-27 10:00:${String(tick++).padStart(2, '0')}`
  const stored = (fields: Row): Row => {
    const next: Row = {}
    for (const key of ['location', 'phone', 'manager', 'notes']) if (key in fields) next[key] = fields[key] || null
    if ('is_default' in fields) next.is_default = fields.is_default === true || Number(fields.is_default) === 1 ? 1 : 0
    return next
  }
  let row: Row = { ...initial, ...stored(initial), updated_at: stamp() }
  const token = () => { const { edit_etag: _old, ...state } = row; row.edit_etag = JSON.stringify(state) }
  token()
  const before = { ...row }
  let after = { ...row }
  const writes: Row[] = []
  return {
    get row(): Row { return row },
    writes, before,
    get after(): Row { return after },
    captureAfter(): void { after = { ...row } },
    // Another device's save, or the forward edit itself.
    edit(fields: Row): void { row = { ...row, ...stored(fields), updated_at: stamp() }; token() },
    sameSecondEdit(fields: Row): void { row = { ...row, ...fields }; token() },
    read: async (id: string | number): Promise<Row | null> => (String(id) === String(row.id) ? { ...row } : null),
    async write(id: string | number, body: Row): Promise<Row> {
      writes.push(body)
      if (String(id) !== String(row.id)) throw Object.assign(new Error('Branch not found'), { status: 404 })
      const expected = String(body.expectedUpdatedAt ?? body.expected_updated_at ?? body.updated_at ?? body.updatedAt ?? '').trim()
      if (!body.expectedEditEtag || body.expectedEditEtag !== row.edit_etag || (expected && expected !== row.updated_at)) {
        throw Object.assign(new Error('This branch changed on another device. Refresh and try again.'), {
          status: 409, code: 'branch_edit_conflict', conflict: true,
        })
      }
      this.edit(body)
      return { success: true, branch: { ...row } }
    },
  }
}

// The two snapshots Branches.tsx's handleSaveBranch keeps (existingSnapshot,
// nextSnapshot) and the body buildBranchPayload makes from one.
const BEFORE: Row = { id: 1, name: 'Shop', location: 'Phnom Penh', phone: '', manager: 'Dara', notes: null, is_default: 1, is_active: 1 }
const AFTER: Row = { ...BEFORE, phone: '012 345 678', notes: 'Opens at 7' }
const body = (snapshot: Row): Row => ({
  name: snapshot.name || '', location: snapshot.location || '', phone: snapshot.phone || '', manager: snapshot.manager || '',
  notes: snapshot.notes || '', is_default: snapshot.is_default ? 1 : 0, is_active: snapshot.is_active ?? 1, userId: 9, userName: 'Owner',
})

type Store = ReturnType<typeof branchStore>
const undoOf = (store: Store, over: Partial<Request> = {}): Request => ({
  id: 1, fields: body(BEFORE), expected: store.after, readBranch: store.read, writeBranch: (id, b) => store.write(id, b),
  refusal: UNDO_REFUSED, failure: 'Failed to restore branch', ...over,
})
const redoOf = (store: Store, over: Partial<Request> = {}): Request => ({
  id: 1, fields: body(AFTER), expected: store.before, readBranch: store.read, writeBranch: (id, b) => store.write(id, b),
  refusal: REDO_REFUSED, failure: 'Failed to reapply branch changes', ...over,
})
const edited = (): Store => {
  const store = branchStore(BEFORE)
  store.edit(AFTER)
  store.captureAfter()
  return store
}
const refusedWith = (message: string) => (error: unknown) => (error as Error)?.message === message

await runTest('DISCRIMINATING: an in-tab Undo refuses once a later edit changed a field it would restore, and sends nothing', async () => {
  const store = edited()
  store.edit({ phone: '099 999 999' })
  await assert.rejects(need().replayBranchEdit(undoOf(store)), refusedWith(UNDO_REFUSED))
  assert.equal(store.writes.length, 0, 'no PUT may be sent')
  assert.equal(store.row.phone, '099 999 999', 'the later edit survives')
})

await runTest('DISCRIMINATING: a later edit to a field the edit itself left alone refuses too (the Undo would rewrite it)', async () => {
  const store = edited()
  store.edit({ manager: 'Sokha' })
  await assert.rejects(need().replayBranchEdit(undoOf(store)), refusedWith(UNDO_REFUSED))
  assert.equal(store.writes.length, 0)
  assert.equal(store.row.manager, 'Sokha')
})

await runTest('DISCRIMINATING: an in-tab Redo refuses once a later edit changed what the Undo restored', async () => {
  const store = edited()
  Object.assign(store.before, await need().replayBranchEdit(undoOf(store)))
  store.edit({ is_default: 0 })
  await assert.rejects(need().replayBranchEdit(redoOf(store)), refusedWith(REDO_REFUSED))
  assert.equal(store.writes.length, 1, 'only the Undo was sent')
  assert.equal(store.row.is_default, 0, 'the later edit survives')
})

await runTest('a clean Undo then Redo restores each side, each write held to the version it read', async () => {
  const store = edited()
  const beforeUndo = store.row.updated_at
  Object.assign(store.before, await need().replayBranchEdit(undoOf(store)))
  assert.equal(store.writes[0].expectedUpdatedAt, beforeUndo, 'the Undo carries the version it read')
  assert.equal(store.row.phone, null)
  assert.equal(store.row.notes, null)
  const beforeRedo = store.row.updated_at
  await need().replayBranchEdit(redoOf(store))
  assert.equal(store.writes[1].expectedUpdatedAt, beforeRedo, 'the Redo carries the version it read')
  assert.equal(store.row.phone, '012 345 678')
  assert.equal(store.row.notes, 'Opens at 7')
  const { expectedUpdatedAt: _undoVersion, expectedEditEtag: _undoToken, ...undoBody } = store.writes[0]
  assert.deepEqual(undoBody, body(BEFORE), 'the Undo sends the restored snapshot unchanged')
})

await runTest('DISCRIMINATING: an edit landing between the read and the write is refused by the version, in the page language', async () => {
  const store = edited()
  const racing: Request = undoOf(store, {
    readBranch: async (id) => {
      const current = await store.read(id)
      store.edit({ notes: 'Raced in' })
      return current
    },
  })
  await assert.rejects(need().replayBranchEdit(racing), refusedWith(UNDO_REFUSED))
  assert.equal(store.writes.length, 1, 'the PUT went out, holding the version it read')
  assert.equal(store.row.notes, 'Raced in', 'and the route refused it')
})

await runTest('a blank field and the default flag compare as the Worker stores them', () => {
  const { staleBranchReplayFields } = need()
  assert.deepEqual(staleBranchReplayFields({ phone: null, notes: '', is_default: 1 }, { phone: '', notes: null, is_default: true }), [])
  assert.deepEqual(staleBranchReplayFields({ is_default: 1 }, { is_default: '1' }), [])
  assert.deepEqual(staleBranchReplayFields({ is_default: 0 }, { is_default: 'true' }), ['is_default'])
  assert.deepEqual(staleBranchReplayFields({ location: 'A', phone: '1' }, { location: 'B', phone: '1' }), ['location'])
  assert.deepEqual(staleBranchReplayFields({ location: 'A' }, {}), [], 'a field the snapshot lacks is not compared')
})

await runTest('a branch that is gone, or carries no version to hold the write to, refuses without writing', async () => {
  const store = edited()
  await assert.rejects(need().replayBranchEdit(undoOf(store, { readBranch: async () => null })), refusedWith(UNDO_REFUSED))
  await assert.rejects(need().replayBranchEdit(undoOf(store, { readBranch: async (id) => ({ ...(await store.read(id)), updated_at: null }) })), refusedWith(UNDO_REFUSED))
  assert.equal(store.writes.length, 0)
})

await runTest('any other failure keeps its own message', async () => {
  const store = edited()
  const failing = (outcome: () => Promise<{ success?: boolean; error?: string } | null>) => undoOf(store, { writeBranch: outcome })
  await assert.rejects(need().replayBranchEdit(failing(async () => { throw Object.assign(new Error('Server error'), { status: 500 }) })), refusedWith('Server error'))
  await assert.rejects(need().replayBranchEdit(failing(async () => ({ success: false, error: 'Access denied' }))), refusedWith('Access denied'))
  await assert.rejects(need().replayBranchEdit(failing(async () => ({ success: false }))), refusedWith('Failed to restore branch'))
})

await runTest('the fields compared are the ones the Worker applier compares', () => {
  const worker = code(read('../../cloudflare/src/lib/branchWrites.ts'))
  const listed = worker.match(/export const BRANCH_REPLAY_TEXT_FIELDS = \[([^\]]*)\] as const/)
  assert.ok(listed, 'branchWrites.ts still declares BRANCH_REPLAY_TEXT_FIELDS')
  const workerFields = [...listed[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
  assert.deepEqual([...need().BRANCH_REPLAY_TEXT_FIELDS], workerFields)
  assert.match(worker, /export function staleBranchReplayFields[\s\S]*?has\(expected, 'is_default'\)[\s\S]*?stale\.push\('is_default'\)/,
    'the Worker compares the default flag, as the client does')
})

await runTest('Branches.tsx sends both closures through the guarded replay, never the bare snapshot', () => {
  const branches = code(read('../src/components/branches/Branches.tsx'))
  assert.match(branches, /import \{[^}]*\breplayBranchEdit\b[^}]*\} from '\.\/branchHistoryReplay\.ts'/)
  assert.match(branches, /undo: async \(\) => \{\s*Object\.assign\(existingSnapshot, await replayBranchEdit\(branchReplayRequest\('undo', existingSnapshot, nextSnapshot\)\)/,
    'Undo restores the pre-edit snapshot only while the branch holds the edit')
  assert.match(branches, /redo: async \(\) => \{\s*Object\.assign\(nextSnapshot, await replayBranchEdit\(branchReplayRequest\('redo', nextSnapshot, existingSnapshot\)\)/,
    'Redo reapplies the edit only while the branch holds what the Undo restored')
  assert.match(branches, /fields: buildBranchPayload\(restore\),\s*expected,/)
  assert.match(branches, /tr\('undo_refused_record_changed',/)
  assert.match(branches, /tr\('redo_refused_record_changed',/)
  assert.doesNotMatch(branches, /updateBranch\((?:existingSnapshot|nextSnapshot)\.id/, 'no closure PUTs a snapshot directly')
})

await runTest('DISCRIMINATING: same-second canonical metadata change refuses the stored token without replacing it from GET', async () => {
  const store = edited()
  const timestamp = store.row.updated_at
  store.sameSecondEdit({ successor_branch_id: 3 })
  assert.equal(store.row.updated_at, timestamp)
  await assert.rejects(need().replayBranchEdit(undoOf(store)), refusedWith(UNDO_REFUSED))
  assert.equal(store.writes.length, 0)
})

await runTest('DISCRIMINATING: legacy history without captured token refuses even when fresh row text matches', async () => {
  const store = edited()
  await assert.rejects(need().replayBranchEdit(undoOf(store, { expected: AFTER })), refusedWith(UNDO_REFUSED))
  assert.equal(store.writes.length, 0)
})

await runTest('DISCRIMINATING: same-second read-to-write race is refused by the stored token', async () => {
  const store = edited()
  const timestamp = store.row.updated_at
  const request = undoOf(store, { readBranch: async (id) => {
    const current = await store.read(id)
    store.sameSecondEdit({ notes: 'racing edit' })
    return current
  } })
  await assert.rejects(need().replayBranchEdit(request), refusedWith(UNDO_REFUSED))
  assert.equal(store.row.updated_at, timestamp)
  assert.equal(store.row.notes, 'racing edit')
  assert.equal(store.writes.length, 1)
  assert.equal(store.writes[0].expectedEditEtag, store.after.edit_etag)
})

await runTest('queued replay and missing committed state cannot claim local application', async () => {
  const store = edited()
  for (const result of [{ success: true, pending: true }, { success: true }]) {
    await assert.rejects(need().replayBranchEdit(undoOf(store, { writeBranch: async () => result })), refusedWith(UNDO_REFUSED))
  }
})

if (failed) {
  console.error(`${failed} failed`)
  process.exitCode = 1
}
